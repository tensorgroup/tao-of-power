import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSyncer, REC, LAST, PENDING_LOGOUT, WIPED } from '../app/js/sync.js';
import { emptyJournal, addEntry, merge, load, save, sameCore, KEY } from '../app/js/journal.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

const T = (s) => `2026-11-25T10:00:${String(s).padStart(2, '0')}.000Z`;
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fake server that merges like the real one; `gate` lets a test hold a response. */
function harness({ signedIn = true } = {}) {
  const storage = memStorage();
  if (signedIn) { // as adopt() leaves a signed-in browser
    storage.setItem(REC, JSON.stringify({ account: 'u1', label: 'L', at: null }));
    storage.setItem(LAST, 'u1');
  }
  let saves = true; // false: storage is full, setJournal saves nothing
  let server = emptyJournal();
  let rev = 0;
  const deletes = [];
  let journal = emptyJournal();
  const sent = [];
  const events = [];
  let hold = null;
  const fetch = async (path, init) => {
    if (path === '/api/journal/sync') {
      const body = JSON.parse(init.body);
      sent.push(body);
      if (hold) await hold;
      const next = merge(server, body.journal);
      delete next.lastExportAt;
      if (!sameCore(next, server)) rev++;
      server = next;
      return reply(200, { journal: server, rev });
    }
    if (path === '/api/session') return reply(200, { account: signedIn ? { id: 'u1', label: 'L' } : null });
    if (path === '/api/auth/logout') return reply(200, { ok: true });
    if (path === '/api/account') { deletes.push(init.body === undefined ? undefined : JSON.parse(init.body)); return reply(200, { ok: true }); }
    throw new Error(`unexpected ${path}`);
  };
  const snaps = [];
  const s = makeSyncer({
    fetch: (...a) => h.fetch(...a), storage, now: () => 1000,
    // As the app does: a merge result goes into memory even when storage is full; a replace changes nothing then.
    getJournal: () => journal,
    setJournal: (j, { replace = false } = {}) => {
      if (!saves && replace) return false;
      journal = j;
      if (!saves) return false;
      save(j, storage);
      return true;
    },
    snapshot: (j) => { snaps.push(j); return true; }, onChange: (e) => events.push(e),
  });
  const h = {
    s, storage, sent, events, snaps, fetch, deletes,
    get rev() { return rev; },
    get journal() { return journal; }, set journal(j) { journal = j; },
    get server() { return server; }, set server(j) { server = j; },
    hold(p) { hold = p; },
    setSaves(v) { saves = v; },
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

// ---- Each sync and each delete belongs to the account it was sent for ----

test('each sync names its account', async () => {
  const h = harness();
  await h.s.syncNow();
  assert.equal(h.sent[0].account, 'u1');
});

test('an answer that arrives after another tab signed in to another account is dropped', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'A only' }, T(1));
  const other = emptyJournal();
  addEntry(other, { passage: 2, text: 'on A\'s server' }, T(2));
  h.server = other;
  let release;
  h.hold(new Promise((r) => { release = r; }));
  const run = h.s.syncNow();
  await Promise.resolve();
  // Meanwhile another tab signs out of A, into B, and keeps B's journal apart.
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
  h.journal = emptyJournal();
  h.hold(null);
  release();
  assert.equal(await run, false);
  assert.equal(h.journal.entries.length, 0, 'nothing of A was merged into B');
  assert.deepEqual(JSON.parse(h.storage.getItem(REC)), { account: 'u2', label: 'B', at: null }, 'B is not marked as synced by A\'s answer');
  await h.s.syncNow();
  assert.deepEqual(h.sent.map((b) => b.account), ['u1', 'u2']);
  assert.equal(h.sent[1].journal.entries.length, 0, 'nothing of A goes up to B');
});

test('a late 401 for the old account does not sign out the new one', async () => {
  const h = harness();
  let release;
  const gate = new Promise((r) => { release = r; });
  h.fetch = async () => { await gate; return reply(401, { error: 'signed-out' }); };
  const run = h.s.syncNow();
  await Promise.resolve();
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null })); // another tab signed in to B
  release();
  await run;
  assert.equal(JSON.parse(h.storage.getItem(REC)).account, 'u2');
  assert.ok(!h.events.some((e) => e.signedOut), 'no "signed out" news');
});

const FAILED_SYNCS = [
  ['offline', () => { throw new TypeError('Failed to fetch'); }],
  ['409 busy', () => reply(409, { error: 'busy' })],
  ['409 account-changed', () => reply(409, { error: 'account-changed' })],
  ['413 too-large', () => reply(413, { error: 'too-large' })],
  ['429 slow-down', () => reply(429, { error: 'slow-down' })],
];

test('delete refuses when the final sync fails (offline, 409, 413, 429, save failed) and sends no DELETE', async () => {
  for (const [what, answer] of FAILED_SYNCS) {
    const h = harness();
    const paths = [];
    h.fetch = async (p) => { paths.push(p); return p === '/api/journal/sync' ? answer() : reply(200, { ok: true }); };
    await assert.rejects(h.s.deleteAccount({ account: 'u1' }), /^Error: Could not sync first, so nothing was deleted\. Try again online, or Export first\.$/, what);
    // 413: the journal is too large to upload, so a pull (an empty upload) follows; here it gets 413 too.
    assert.deepEqual(paths, what.startsWith('413') ? ['/api/journal/sync', '/api/journal/sync'] : ['/api/journal/sync'], what);
    assert.equal(JSON.parse(h.storage.getItem(REC)).account, 'u1', `${what}: still signed in`);
  }
  // This browser cannot save what the final sync brought down.
  const h = harness();
  const other = emptyJournal();
  addEntry(other, { passage: 2, text: 'only on the server' }, T(2));
  h.server = other;
  h.setSaves(false);
  const paths = [];
  const inner = h.fetch;
  h.fetch = async (p, i) => { paths.push(p); return inner(p, i); };
  // The sync reached the server, but this browser could not save the answer: say that, not "try again online".
  await assert.rejects(h.s.deleteAccount({ account: 'u1' }), /^Error: This browser could not save the synced copy, so nothing was deleted\./);
  assert.deepEqual(paths, ['/api/journal/sync']);
});

test('delete names the account it showed; a switched account throws SWITCHED and deletes nothing', async () => {
  const h = harness();
  const calls = [];
  const inner = h.fetch;
  h.fetch = async (p, i) => { calls.push([p, i.method, i.body === undefined ? undefined : JSON.parse(i.body)]); return inner(p, i); };
  await h.s.deleteAccount({ account: 'u1' });
  assert.deepEqual(calls.find(([p]) => p === '/api/account'), ['/api/account', 'DELETE', { account: 'u1', rev: 0 }]);

  const g = harness();
  g.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null })); // another tab signed in to B
  const seen = [];
  g.fetch = async (p) => { seen.push(p); return reply(200, { ok: true }); };
  await assert.rejects(g.s.deleteAccount({ account: 'u1' }), /changed in another tab, so nothing was deleted/);
  assert.deepEqual(seen, [], 'no sync and no DELETE');
  assert.equal(JSON.parse(g.storage.getItem(REC)).account, 'u2');

  const k = harness(); // the server's session is another account: 409
  const kin = k.fetch;
  k.fetch = async (p, i) => (p === '/api/account' ? reply(409, { error: 'account-changed' }) : kin(p, i));
  await assert.rejects(k.s.deleteAccount({ account: 'u1' }), /changed in another tab, so nothing was deleted/);
  assert.ok(k.storage.getItem(REC));
});

test('delete keeps LAST: a later sign-in to another account asks before upload', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'written while synced to A' }, T(1));
  await h.s.deleteAccount({ account: 'u1' });
  assert.deepEqual([h.storage.getItem(REC), h.storage.getItem(LAST), h.journal.entries.length], [null, 'u1', 1]);
  const before = h.sent.length;
  let uploadsBeforeChoice = null;
  await h.s.adopt({ id: 'u2', label: 'B' }, { onSwitch: async () => { uploadsBeforeChoice = h.sent.length - before; return 'cancel'; } });
  assert.equal(uploadsBeforeChoice, 0, 'the reader is asked, before any upload');
  assert.equal(h.sent.length, before, 'Cancel: nothing went up to B');
});

test('a network error on DELETE says the copy could not be deleted', async () => {
  const h = harness();
  const inner = h.fetch;
  h.fetch = async (p, i) => { if (p === '/api/account') throw new TypeError('Failed to fetch'); return inner(p, i); };
  await assert.rejects(h.s.deleteAccount({ account: 'u1' }), (e) => /could not delete/.test(e.message) && !/Failed to fetch/.test(e.message));
  assert.ok(h.storage.getItem(REC), 'still signed in');
});

// ---- "Remove it from this browser" reaches every tab, and removes only what the server holds ----

test('remove-from-browser refuses when another tab saved since the last answer', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'synced' }, T(1));
  save(h.journal, h.storage); // as persist() does
  await h.s.syncNow();
  // Another tab saves a new entry; this tab's journal does not have it.
  const there = load(h.storage);
  addEntry(there, { passage: 2, text: 'saved in another tab' }, T(3));
  save(there, h.storage);
  const rec = h.storage.getItem(REC);
  const stored = h.storage.getItem(KEY);
  let wiped = false;
  const s = makeSyncer({
    fetch: (...a) => h.fetch(...a), storage: h.storage, now: () => 1000,
    getJournal: () => h.journal, setJournal: (j) => { h.journal = j; save(j, h.storage); }, wipe: () => { wiped = true; },
  });
  await assert.rejects(s.signOut({ clearLocal: true }), /another tab/);
  assert.equal(h.storage.getItem(REC), rec, 'still signed in: the reader can try again');
  assert.equal(h.storage.getItem(KEY), stored, 'the stored journal is unchanged');
  assert.deepEqual(load(h.storage).entries.map((e) => e.text), ['synced', 'saved in another tab']);
  assert.equal(wiped, false);
  assert.equal(h.storage.getItem(WIPED), null);
});

test('remove-from-browser clears REC before the logout request and writes WIPED', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  const order = [];
  const inner = h.fetch;
  h.fetch = async (p, i) => {
    if (p === '/api/auth/logout') order.push(['logout', h.storage.getItem(REC), h.storage.getItem(WIPED), load(h.storage).entries.length]);
    return inner(p, i);
  };
  await h.s.signOut({ clearLocal: true });
  assert.equal(order.length, 1);
  const [, rec, mark, entries] = order[0];
  assert.equal(rec, null, 'REC is gone before the logout request: no tab starts a sync in between');
  assert.ok(mark, 'WIPED is written before the logout request');
  assert.equal(entries, 0, 'the journal is removed before the logout request');
  const first = h.storage.getItem(WIPED);
  h.storage.setItem(REC, JSON.stringify({ account: 'u1', label: 'L', at: null })); // signed in again
  await h.s.signOut({ clearLocal: true });
  assert.notEqual(h.storage.getItem(WIPED), first, 'a new mark each time, so other tabs get a storage event again');
  h.storage.setItem(REC, JSON.stringify({ account: 'u1', label: 'L', at: null }));
  const mark2 = h.storage.getItem(WIPED);
  await h.s.signOut();
  assert.equal(h.storage.getItem(WIPED), mark2, 'a plain sign-out marks nothing');
});

test('onWipedElsewhere fires on a storage event for WIPED only', () => {
  const h = harness();
  const tab = new EventTarget();
  let runs = 0;
  h.s.onWipedElsewhere(() => { runs++; }, tab);
  const storageEvent = (key, newValue) => Object.assign(new Event('storage'), { key, newValue });
  tab.dispatchEvent(storageEvent(KEY, '{}'));
  tab.dispatchEvent(storageEvent(REC, null));
  tab.dispatchEvent(storageEvent(WIPED, null));
  assert.equal(runs, 0);
  tab.dispatchEvent(storageEvent(WIPED, '1000.x'));
  assert.equal(runs, 1);
});

test('onChange gets wiped: true after a clear-local sign-out', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  await h.s.signOut({ clearLocal: true });
  assert.ok(h.events.some((e) => e.wiped === true && e.signedOut), 'this tab hears of it too');
  const g = harness();
  await g.s.signOut();
  assert.ok(g.events.every((e) => !e.wiped), 'a plain sign-out is no wipe');
});

// ---- Delete only what this browser's storage holds; tie the delete to the server revision ----

test('delete refuses while storage lacks the server copy, even when memory has it (a save failed on an earlier try)', async () => {
  const h = harness();
  const other = emptyJournal();
  addEntry(other, { passage: 2, text: 'only on the server' }, T(2));
  h.server = other;
  h.setSaves(false);
  await assert.rejects(h.s.deleteAccount({ account: 'u1' }), /^Error: This browser could not save the synced copy, so nothing was deleted\./);
  assert.equal(h.journal.entries.length, 1, 'memory holds the answer');
  assert.equal(load(h.storage).entries.length, 0, 'storage does not');
  // The retry: the sync sees "no change" in memory. Storage still lacks the entry, so nothing is deleted.
  await assert.rejects(h.s.deleteAccount({ account: 'u1' }), /^Error: This browser could not save the synced copy, so nothing was deleted\./);
  assert.deepEqual(h.deletes, [], 'no DELETE was sent');
  assert.equal(JSON.parse(h.storage.getItem(REC)).account, 'u1');
  // Storage works again: the next try saves the answer, then deletes.
  h.setSaves(true);
  await h.s.deleteAccount({ account: 'u1' });
  assert.deepEqual(load(h.storage).entries.map((e) => e.text), ['only on the server']);
  assert.equal(h.deletes.length, 1);
});

test('delete of a journal over the sync cap pulls the server copy, saves it, then deletes', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'too large to upload' }, T(1));
  save(h.journal, h.storage);
  const other = emptyJournal();
  addEntry(other, { passage: 2, text: 'from another device' }, T(2));
  h.server = other;
  const inner = h.fetch;
  h.fetch = async (p, i) => {
    if (p === '/api/journal/sync' && JSON.parse(i.body).journal.entries.length) return reply(413, { error: 'too-large' });
    return inner(p, i);
  };
  await h.s.deleteAccount({ account: 'u1' });
  assert.deepEqual(h.sent.map((b) => [b.account, b.journal.entries.length]), [['u1', 0]], 'the pull sends an empty journal');
  assert.deepEqual(load(h.storage).entries.map((e) => e.text), ['too large to upload', 'from another device']);
  assert.deepEqual(h.deletes, [{ account: 'u1', rev: h.rev }]);
  assert.equal(h.storage.getItem(REC), null);

  // The same, when this browser cannot save what the pull brought: nothing is deleted.
  const g = harness();
  addEntry(g.journal, { passage: 1, text: 'big' }, T(1));
  save(g.journal, g.storage);
  g.server = other;
  const gin = g.fetch;
  g.fetch = async (p, i) => (p === '/api/journal/sync' && JSON.parse(i.body).journal.entries.length ? reply(413, { error: 'too-large' }) : gin(p, i));
  g.setSaves(false);
  await assert.rejects(g.s.deleteAccount({ account: 'u1' }), /could not save the synced copy, so nothing was deleted/);
  assert.deepEqual(g.deletes, []);
});

test('delete sends the rev of the confirmed answer; 409 changed says something new arrived', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  const inner = h.fetch;
  h.fetch = async (p, i) => (p === '/api/account' ? (h.deletes.push(JSON.parse(i.body)), reply(409, { error: 'changed' })) : inner(p, i));
  await assert.rejects(h.s.deleteAccount({ account: 'u1' }), /^Error: Something new reached the synced copy, so nothing was deleted\. Try again\.$/);
  assert.deepEqual(h.deletes, [{ account: 'u1', rev: 1 }]);
  assert.equal(JSON.parse(h.storage.getItem(REC)).account, 'u1', 'still signed in');
});

// ---- Two tabs: one account operation at a time; each is pinned to the account the page showed ----

/** A stand-in for navigator.locks: one holder at a time, in order. */
function fakeLocks() {
  let tail = Promise.resolve();
  return { request(name, fn) { const run = tail.then(() => fn()); tail = run.catch(() => {}); return run; } };
}

test('a delete in one tab and remove-from-browser in another never both run: one copy stays', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'the only words' }, T(1));
  save(h.journal, h.storage);
  const locks = fakeLocks();
  let release;
  const gate = new Promise((r) => { release = r; });
  let serverGone = false;
  const fetch = async (p, i) => {
    if (p === '/api/account') { await gate; serverGone = true; return reply(200, { ok: true }); }
    return h.fetch(p, i);
  };
  let tab2Journal = load(h.storage);
  const mk = (getJournal, setJournal) => makeSyncer({ fetch, storage: h.storage, now: () => 1000, locks, getJournal, setJournal });
  const tab1 = mk(() => h.journal, (j) => { h.journal = j; save(j, h.storage); return true; });
  const tab2 = mk(() => tab2Journal, (j) => { tab2Journal = j; save(j, h.storage); return true; });
  const del = tab1.deleteAccount({ account: 'u1' });
  for (let i = 0; i < 20; i++) await Promise.resolve(); // tab 1 is waiting on the DELETE answer
  const out = tab2.signOut({ clearLocal: true, account: 'u1' });
  release();
  await del;
  await assert.rejects(out, /nothing changed|changed in another tab/i);
  assert.equal(serverGone, true);
  assert.deepEqual(load(h.storage).entries.map((e) => e.text), ['the only words'], 'this browser keeps the journal');
});

test('the lock wraps signOut and deleteAccount; without locks they still run', async () => {
  const names = [];
  const h = harness();
  const locks = { request: (name, fn) => { names.push(name); return fn(); } };
  const s = makeSyncer({ fetch: (...a) => h.fetch(...a), storage: h.storage, locks, getJournal: () => h.journal, setJournal: () => true });
  await s.signOut({ account: 'u1' });
  h.storage.setItem(REC, JSON.stringify({ account: 'u1', label: 'L', at: null }));
  await s.deleteAccount({ account: 'u1' });
  assert.deepEqual(names, ['tao-sync-account', 'tao-sync-account']);
});

test('signOut names the account the page showed; another account signed in meanwhile is left alone', async () => {
  const h = harness();
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
  const paths = [];
  const inner = h.fetch;
  h.fetch = async (p, i) => { paths.push(p); return inner(p, i); };
  await assert.rejects(h.s.signOut({ account: 'u1' }), /changed in another tab/);
  await assert.rejects(h.s.signOut({ clearLocal: true, account: 'u1' }), /changed in another tab/);
  assert.deepEqual(paths, [], 'no sync, no logout');
  assert.equal(JSON.parse(h.storage.getItem(REC)).account, 'u2');
});

test('a late logout answer does not sign out the account another tab signed in to', async () => {
  const h = harness();
  let release;
  const gate = new Promise((r) => { release = r; });
  const inner = h.fetch;
  h.fetch = async (p, i) => { if (p === '/api/auth/logout') await gate; return inner(p, i); };
  const out = h.s.signOut({ account: 'u1' });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
  release();
  await out;
  assert.equal(JSON.parse(h.storage.getItem(REC)).account, 'u2');
  assert.ok(!h.events.some((e) => e.signedOut), 'no "signed out" news for B');
});

test('a late DELETE answer does not sign out the account another tab signed in to', async () => {
  const h = harness();
  let release;
  const gate = new Promise((r) => { release = r; });
  const inner = h.fetch;
  h.fetch = async (p, i) => { if (p === '/api/account') await gate; return inner(p, i); };
  const del = h.s.deleteAccount({ account: 'u1' });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(h.deletes.length, 0);
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
  release();
  await del;
  assert.equal(JSON.parse(h.storage.getItem(REC)).account, 'u2');
  assert.ok(!h.events.some((e) => e.signedOut));
});

test('remove-from-browser stops when the empty journal cannot be saved: nothing changes', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'keep' }, T(1));
  save(h.journal, h.storage);
  let wiped = false;
  const s = makeSyncer({
    fetch: (...a) => h.fetch(...a), storage: h.storage, now: () => 1000, getJournal: () => h.journal,
    setJournal: (j, { replace = false } = {}) => { if (replace) return false; h.journal = j; save(j, h.storage); return true; },
    wipe: () => { wiped = true; },
  });
  await assert.rejects(s.signOut({ clearLocal: true }), /^Error: This browser could not remove the journal\. Nothing changed\.$/);
  assert.equal(JSON.parse(h.storage.getItem(REC)).account, 'u1', 'still signed in');
  assert.deepEqual(load(h.storage).entries.map((e) => e.text), ['keep']);
  assert.equal(wiped, false);
  assert.equal(h.storage.getItem(WIPED), null);
});

test('remove-from-browser tells this tab of the wipe before the logout request', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  let seen = null;
  const inner = h.fetch;
  h.fetch = async (p, i) => { if (p === '/api/auth/logout') seen = h.events.map((e) => !!e.wiped); return inner(p, i); };
  await h.s.signOut({ clearLocal: true });
  assert.ok(seen?.includes(true), 'the wiped news came before logout');
});

// ---- Review 2 ----

test('replace stops when the empty journal cannot be saved: no new account, no sync', async () => {
  const h = harness({ signedIn: false });
  h.storage.setItem(LAST, 'someone-else');
  addEntry(h.journal, { passage: 1, text: 'their journal' }, T(1));
  save(h.journal, h.storage);
  h.setSaves(false); // a replace now returns false
  const paths = [];
  const inner = h.fetch;
  h.fetch = async (p, i) => { paths.push(p); return inner(p, i); };
  await assert.rejects(h.s.adopt({ id: 'u1', label: 'L' }, { onSwitch: async () => 'replace' }),
    /^Error: This browser could not clear its journal \(storage full\), so sync did not start\. Export it first\.$/);
  assert.deepEqual(paths, ['/api/auth/logout'], 'no sync was sent');
  assert.equal(h.sent.length, 0);
  assert.equal(h.storage.getItem(REC), null);
  assert.equal(h.storage.getItem(LAST), 'someone-else');
  assert.equal(h.journal.entries[0].text, 'their journal');
});

test('a sync answer that arrives after a wipe in another tab is dropped', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'stale in memory' }, T(1));
  const other = emptyJournal();
  addEntry(other, { passage: 2, text: 'from the server' }, T(2));
  h.server = other;
  let release;
  h.hold(new Promise((r) => { release = r; }));
  const run = h.s.syncNow();
  await new Promise((r) => setTimeout(r, 0));
  // Another tab removed the journal, and this browser signed in to the same account again; this tab's storage event is late.
  h.storage.setItem(WIPED, 'w2');
  release();
  assert.equal(await run, false);
  assert.equal(load(h.storage).entries.length, 0, 'nothing was saved back');
  assert.deepEqual(h.journal.entries.map((e) => e.text), ['stale in memory'], 'the answer was not merged');
});

test('check: a /api/session answer after a wipe or a pending sign-out does not resume', async () => {
  for (const [what, during] of [
    ['wipe', (st) => st.setItem(WIPED, 'w2')],
    ['pending sign-out', (st) => st.setItem(PENDING_LOGOUT, '1')],
  ]) {
    const h = harness({ signedIn: true });
    h.storage.removeItem(REC); // a session that storage forgot: check() would adopt it
    const inner = h.fetch;
    h.fetch = async (p, i) => { if (p === '/api/session') during(h.storage); return inner(p, i); };
    await h.s.check();
    assert.equal(h.storage.getItem(REC), null, `${what}: not resumed`);
    assert.equal(h.sent.length, 0, `${what}: no sync sent`);
  }
  // Same account signed in: no resume sync either.
  const h = harness({ signedIn: true });
  const inner = h.fetch;
  h.fetch = async (p, i) => { if (p === '/api/session') h.storage.setItem(WIPED, 'w3'); return inner(p, i); };
  await h.s.check();
  assert.equal(h.sent.length, 0);
});

test('remove-from-browser with a journal too large to sync says so, not "try again online"', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'big' }, T(1));
  h.fetch = async (p) => (p === '/api/journal/sync' ? reply(413, { error: 'too-large' }) : reply(200, { ok: true }));
  await assert.rejects(h.s.signOut({ clearLocal: true }),
    /^Error: The journal is too large to sync, so it stays in this browser\. Export keeps a full copy\.$/);
  assert.equal(h.journal.entries.length, 1);
  assert.equal(JSON.parse(h.storage.getItem(REC)).account, 'u1');
});
