import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSyncer, REC, LAST, PENDING_LOGOUT } from '../app/js/sync.js';
import { emptyJournal, addEntry, merge } from '../app/js/journal.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

const T = (s) => `2026-11-25T10:00:${String(s).padStart(2, '0')}.000Z`;
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fake server that merges like the real one; `gate` lets a test hold a response. */
function harness({ signedIn = true } = {}) {
  const storage = memStorage();
  if (signedIn) storage.setItem(REC, JSON.stringify({ account: 'u1', label: 'L', at: null }));
  let server = emptyJournal();
  let journal = emptyJournal();
  const sent = [];
  const events = [];
  let hold = null;
  const fetch = async (path, init) => {
    if (path === '/api/journal/sync') {
      const body = JSON.parse(init.body);
      sent.push(body);
      if (hold) await hold;
      server = merge(server, body.journal);
      delete server.lastExportAt;
      return reply(200, { journal: server, rev: sent.length });
    }
    if (path === '/api/session') return reply(200, { account: signedIn ? { id: 'u1', label: 'L' } : null });
    if (path === '/api/auth/logout') return reply(200, { ok: true });
    if (path === '/api/account') return reply(200, { ok: true });
    throw new Error(`unexpected ${path}`);
  };
  const snaps = [];
  const s = makeSyncer({
    fetch: (...a) => h.fetch(...a), storage, now: () => 1000,
    getJournal: () => journal, setJournal: (j) => { journal = j; },
    snapshot: (j) => { snaps.push(j); return true; }, onChange: (e) => events.push(e),
  });
  const h = {
    s, storage, sent, events, snaps, fetch,
    get journal() { return journal; }, set journal(j) { journal = j; },
    get server() { return server; }, set server(j) { server = j; },
    hold(p) { hold = p; },
  };
  return h;
}

test('first sync uploads the local journal and pulls the server copy', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'here' }, T(1));
  const other = emptyJournal();
  addEntry(other, { passage: 2, text: 'there' }, T(2));
  h.server = other;
  await h.s.syncNow();
  assert.deepEqual(h.journal.entries.map((e) => e.text), ['here', 'there']);
  assert.equal(JSON.parse(h.storage.getItem(REC)).at, 1000);
});

test('keeps an entry saved during the request, and the queued run sends it', async () => {
  const h = harness();
  let release;
  h.hold(new Promise((r) => { release = r; }));
  const first = h.s.syncNow();
  await Promise.resolve();
  addEntry(h.journal, { passage: 7, text: 'typed meanwhile' }, T(5));
  const second = h.s.syncNow();
  assert.equal(h.sent.length, 1); // single flight
  release();
  h.hold(null);
  await first; await second;
  assert.ok(h.journal.entries.some((e) => e.text === 'typed meanwhile'));
  assert.equal(h.sent.length, 2);
  assert.ok(h.sent[1].journal.entries.some((e) => e.text === 'typed meanwhile'));
});

test('a sync with no news does not start another', async () => {
  const h = harness();
  await h.s.syncNow();
  await h.s.syncNow();
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.events.map((e) => e.changed), [false, false]);
});

test('lastExportAt stays on the device and never goes up', async () => {
  const h = harness();
  h.journal.lastExportAt = T(9);
  await h.s.syncNow();
  assert.equal('lastExportAt' in h.sent[0].journal, false);
  assert.equal(h.journal.lastExportAt, T(9));
});

test('401 clears the record and keeps the local journal', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'mine' }, T(1));
  h.fetch = async () => reply(401, { error: 'signed-out' });
  await h.s.syncNow();
  assert.equal(h.storage.getItem(REC), null);
  assert.equal(h.journal.entries.length, 1);
  assert.ok(h.events.some((e) => e.signedOut));
});

test('413 marks the record too-large', async () => {
  const h = harness();
  h.fetch = async () => reply(413, { error: 'too-large' });
  await h.s.syncNow();
  assert.equal(JSON.parse(h.storage.getItem(REC)).error, 'too-large');
});

test('offline: no throw, record unchanged', async () => {
  const h = harness();
  h.fetch = async () => { throw new TypeError('offline'); };
  await h.s.syncNow();
  assert.equal(JSON.parse(h.storage.getItem(REC)).at, null);
});

test('signed out: syncNow sends nothing', async () => {
  const h = harness({ signedIn: false });
  await h.s.syncNow();
  assert.equal(h.sent.length, 0);
});

test('keepalive only for small bodies', async () => {
  const h = harness();
  let init;
  h.fetch = async (p, i) => { init = i; return reply(200, { journal: emptyJournal(), rev: 1 }); };
  await h.s.syncNow({ keepalive: true });
  assert.equal(init.keepalive, true);
  addEntry(h.journal, { passage: 1, text: 'x'.repeat(70000) }, T(1));
  await h.s.syncNow({ keepalive: true });
  assert.equal(init.keepalive, false);
});

test('adopt on a new device merges without asking', async () => {
  const h = harness({ signedIn: false });
  addEntry(h.journal, { passage: 1, text: 'local' }, T(1));
  let asked = false;
  assert.equal(await h.s.adopt({ id: 'u1', label: 'L' }, { onSwitch: async () => { asked = true; return 'merge'; } }), true);
  assert.equal(asked, false);
  assert.equal(h.storage.getItem(LAST), 'u1');
  assert.ok(h.sent[0].journal.entries.some((e) => e.text === 'local'));
});

test('adopt a different account: replace snapshots first and uploads nothing local', async () => {
  const h = harness({ signedIn: false });
  h.storage.setItem(LAST, 'someone-else');
  addEntry(h.journal, { passage: 1, text: 'their journal' }, T(1));
  await h.s.adopt({ id: 'u1', label: 'L' }, { onSwitch: async () => 'replace' });
  assert.equal(h.snaps.length, 1);
  assert.equal(h.snaps[0].entries[0].text, 'their journal');
  assert.equal(h.sent[0].journal.entries.length, 0);
  assert.equal(h.journal.entries.length, 0);
});

test('adopt a different account: merge uploads; cancel signs out and sends nothing', async () => {
  const m = harness({ signedIn: false });
  m.storage.setItem(LAST, 'someone-else');
  addEntry(m.journal, { passage: 1, text: 'x' }, T(1));
  await m.s.adopt({ id: 'u1', label: 'L' }, { onSwitch: async () => 'merge' });
  assert.equal(m.sent[0].journal.entries.length, 1);

  const c = harness({ signedIn: false });
  c.storage.setItem(LAST, 'someone-else');
  addEntry(c.journal, { passage: 1, text: 'x' }, T(1));
  const paths = [];
  const inner = c.fetch;
  c.fetch = async (p, i) => { paths.push(p); return inner(p, i); };
  assert.equal(await c.s.adopt({ id: 'u1', label: 'L' }, { onSwitch: async () => 'cancel' }), false);
  assert.deepEqual(paths, ['/api/auth/logout']);
  assert.equal(c.storage.getItem(REC), null);
  assert.equal(c.storage.getItem(LAST), 'someone-else');
});

test('replace refuses when the snapshot cannot be saved', async () => {
  const h = harness({ signedIn: false });
  h.storage.setItem(LAST, 'someone-else');
  addEntry(h.journal, { passage: 1, text: 'keep me' }, T(1));
  const s = makeSyncer({
    fetch: async () => reply(200, {}), storage: h.storage, getJournal: () => h.journal, setJournal: (j) => { h.journal = j; },
    snapshot: () => false,
  });
  await assert.rejects(s.adopt({ id: 'u1', label: 'L' }, { onSwitch: async () => 'replace' }));
  assert.equal(h.journal.entries[0].text, 'keep me');
  assert.equal(h.storage.getItem(REC), null);
});

test('check: a session that storage forgot is resumed; no session clears the record', async () => {
  const h = harness({ signedIn: true });
  h.storage.removeItem(REC);
  await h.s.check();
  assert.equal(JSON.parse(h.storage.getItem(REC)).account, 'u1');
  assert.equal(h.sent.length, 1);

  const g = harness({ signedIn: false });
  g.storage.setItem(REC, JSON.stringify({ account: 'u1' }));
  addEntry(g.journal, { passage: 1, text: 'stay' }, T(1));
  await g.s.check();
  assert.equal(g.storage.getItem(REC), null);
  assert.equal(g.journal.entries.length, 1);
});

test('signOut syncs first, can clear local; deleteAccount keeps local', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  await h.s.signOut({ clearLocal: true });
  assert.equal(h.sent.length, 1);
  assert.equal(h.journal.entries.length, 0);
  assert.equal(h.storage.getItem(REC), null);

  const d = harness();
  addEntry(d.journal, { passage: 1, text: 'b' }, T(1));
  await d.s.deleteAccount();
  assert.equal(d.journal.entries.length, 1);
  assert.equal(d.storage.getItem(REC), null);
});

test('check: a session for another account does not merge this browser\'s journal', async () => {
  const h = harness({ signedIn: true });
  h.storage.removeItem(REC);
  h.storage.setItem(LAST, 'someone-else');
  addEntry(h.journal, { passage: 1, text: 'their words' }, T(1));
  const paths = [];
  const inner = h.fetch;
  h.fetch = async (p, i) => { paths.push(p); return inner(p, i); };
  await h.s.check();
  assert.deepEqual(paths, ['/api/session', '/api/auth/logout']);
  assert.equal(h.storage.getItem(REC), null);
  assert.equal(h.sent.length, 0);
});

test('remove-from-browser refuses when the server did not confirm', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'offline words' }, T(1));
  h.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(h.s.signOut({ clearLocal: true }));
  assert.equal(h.journal.entries.length, 1);
  assert.ok(h.storage.getItem(REC));
});

test('remove-from-browser wipes snapshot and drafts after a confirmed sync', async () => {
  const h = harness();
  let wiped = false;
  const s = makeSyncer({ fetch: (...a) => h.fetch(...a), storage: h.storage, getJournal: () => h.journal, setJournal: (j) => { h.journal = j; }, wipe: () => { wiped = true; } });
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  await s.signOut({ clearLocal: true });
  assert.equal(wiped, true);
  assert.equal(h.journal.entries.length, 0);
  assert.equal(h.server.entries.length, 1);
});

test('a sign-out the server never confirmed is finished at the next start, not resumed', async () => {
  const h = harness();
  const real = h.fetch;
  h.fetch = async (p, i) => { if (p === '/api/auth/logout') throw new TypeError('offline'); return real(p, i); };
  await h.s.signOut();
  assert.equal(h.storage.getItem(PENDING_LOGOUT), '1');
  const paths = [];
  h.fetch = async (p, i) => { paths.push(p); return real(p, i); };
  await h.s.check();
  assert.deepEqual(paths, ['/api/auth/logout']);
  assert.equal(h.storage.getItem(PENDING_LOGOUT), null);
  assert.equal(h.storage.getItem(REC), null);
});

test('a hide during a running sync still sends the queued run with keepalive', async () => {
  const h = harness();
  const inits = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  h.fetch = async (p, i) => { inits.push(i); if (inits.length === 1) await gate; return reply(200, { journal: emptyJournal(), rev: 1 }); };
  const a = h.s.syncNow();
  h.s.syncNow({ keepalive: true });
  release();
  await a;
  assert.equal(inits.length, 2);
  assert.equal(inits[1].keepalive, true);
});

test('delete with an ended session says nothing was deleted', async () => {
  const h = harness();
  h.fetch = async () => reply(401, { error: 'signed-out' });
  await assert.rejects(h.s.deleteAccount(), /nothing was deleted/);
  assert.equal(h.storage.getItem(REC), null);
});

test('service worker never handles /api/ requests', async () => {
  const { readFileSync } = await import('node:fs');
  const sw = readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /if \(url\.pathname\.startsWith\('\/api\/'\)\) return;/);
});

test('an answer that arrives after sign-out is dropped', async () => {
  const h = harness();
  let release;
  h.hold(new Promise((r) => { release = r; }));
  const other = emptyJournal();
  addEntry(other, { passage: 4, text: 'server only' }, T(1));
  h.server = other;
  const run = h.s.syncNow();
  await Promise.resolve();
  h.storage.removeItem(REC); // another tab signed out and cleared
  release();
  await run;
  assert.equal(h.journal.entries.length, 0);
});
