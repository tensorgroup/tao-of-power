import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSyncer, REC, LAST, PENDING_LOGOUT, WIPED, WIPING, LOGGING_OUT, DELETING, wiping, signIn, signUp } from '../app/js/sync.js';
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
    fetch: (...a) => h.fetch(...a), storage, now: () => h.now,
    sleep: (ms) => h.sleep(ms), locks: { request: (name, fn) => h.locks.request(name, fn) },
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
    reload: () => { h.reloads++; journal = load(storage); }, onDefer: () => { h.deferred++; },
  });
  const h = {
    s, storage, sent, events, snaps, fetch, deletes, now: 1000, reloads: 0, deferred: 0,
    sleep: async () => {}, // tests run without real waits; a test may set its own
    locks: { request: (name, fn) => fn() }, // one tab: the lock is free
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
  assert.equal(h.sent.length, 2, 'a final sync, and one more after the wiping marker');
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
  const s = makeSyncer({ locks: h.locks, fetch: (...a) => h.fetch(...a), storage: h.storage, getJournal: () => h.journal, setJournal: (j) => { h.journal = j; }, wipe: () => { wiped = true; } });
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
  const s = makeSyncer({ locks: h.locks,
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
  h.storage.setItem(WIPED, '1000.x'); // as the other tab left it
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

test('the lock wraps signOut and deleteAccount', async () => {
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
  const s = makeSyncer({ locks: h.locks,
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

// ---- Races (R1-R3, B2) ----

test('wiping(): a fresh marker blocks writers; a stale one (over 10 s) or none does not', () => {
  const st = memStorage();
  assert.equal(wiping(st, 50000), false);
  st.setItem(WIPING, '45000.abc');
  assert.equal(wiping(st, 50000), true, '5 s old: fresh');
  assert.equal(wiping(st, 56000), false, '11 s old: a crashed tab, ignored');
  st.setItem(WIPING, 'junk');
  assert.equal(wiping(st, 50000), false);
  assert.equal(wiping({ getItem() { throw new Error('blocked'); } }, 50000), false);
});

test('remove-from-browser writes the wiping marker, waits, syncs again, and removes the marker', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  const seen = [];
  h.sleep = async (ms) => { seen.push([ms, h.storage.getItem(WIPING), h.sent.length]); };
  await h.s.signOut({ clearLocal: true });
  assert.equal(seen.length, 1);
  const [ms, mark, sentBefore] = seen[0];
  assert.equal(ms, 300);
  assert.match(mark, /^1000\./, 'the marker holds the time it was written');
  assert.equal(sentBefore, 1, 'the first sync came before the marker');
  assert.equal(h.sent.length, 2, 'a second sync after the wait');
  assert.equal(h.storage.getItem(WIPING), null, 'the marker is gone at the end');
  assert.equal(h.journal.entries.length, 0);
});

test('a save that landed in another tab just before the marker is caught: nothing is removed, marker gone', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'synced' }, T(1));
  save(h.journal, h.storage);
  h.sleep = async () => {
    // During the wait: a save in another tab that passed its check before the marker came.
    const there = load(h.storage);
    addEntry(there, { passage: 2, text: 'saved in another tab' }, T(4));
    save(there, h.storage);
  };
  await assert.rejects(h.s.signOut({ clearLocal: true }), /another tab/);
  assert.deepEqual(load(h.storage).entries.map((e) => e.text), ['synced', 'saved in another tab']);
  assert.equal(h.storage.getItem(WIPING), null, 'removed on the failure path too');
  assert.ok(h.storage.getItem(REC), 'still signed in');
  assert.equal(h.storage.getItem(WIPED), null);
});

test('the marker is removed when the second sync fails', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  h.sleep = async () => { h.fetch = async () => { throw new TypeError('offline'); }; };
  await assert.rejects(h.s.signOut({ clearLocal: true }), /Could not reach the server/);
  assert.equal(h.storage.getItem(WIPING), null);
  assert.equal(h.journal.entries.length, 1);
});

test('a sync answer in another tab is not merged or saved while a fresh marker exists; a stale one is ignored', async () => {
  const h = harness();
  const other = emptyJournal();
  addEntry(other, { passage: 2, text: 'from the server' }, T(2));
  h.server = other;
  h.storage.setItem(WIPING, '995.other-tab');
  assert.equal(await h.s.syncNow(), false);
  assert.equal(h.journal.entries.length, 0, 'not merged');
  assert.equal(load(h.storage).entries.length, 0, 'not saved');
  h.storage.setItem(WIPING, '-20000.crashed-tab'); // 21 s old
  assert.equal(await h.s.syncNow(), true);
  assert.equal(h.journal.entries.length, 1);
});

test('B2: remove-from-browser whose final sync was answered but not saved says so, not "could not reach"', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'here' }, T(1));
  const other = emptyJournal();
  addEntry(other, { passage: 2, text: 'from the server' }, T(2));
  h.server = other;
  h.setSaves(false);
  await assert.rejects(h.s.signOut({ clearLocal: true }), (e) => {
    assert.doesNotMatch(e.message, /reach the server/);
    assert.match(e.message, /could not save the synced copy/);
    return true;
  });
  assert.ok(h.storage.getItem(REC), 'still signed in');
  assert.equal(h.storage.getItem(WIPING), null);
});

test('R3: DELETE sets the deleting marker while it is out, and removes it after', async () => {
  const h = harness();
  let during = null;
  const inner = h.fetch;
  h.fetch = async (p, i) => { if (p === '/api/account') during = h.storage.getItem(DELETING); return inner(p, i); };
  await h.s.deleteAccount({ account: 'u1' });
  assert.equal(during, '1000');
  assert.equal(h.storage.getItem(DELETING), null);
  const f = harness();
  f.fetch = async (p, i) => { if (p === '/api/account') throw new TypeError('offline'); return harness().fetch(p, i); };
  await assert.rejects(f.s.deleteAccount({ account: 'u1' }));
  assert.equal(f.storage.getItem(DELETING), null, 'removed on failure too');
});

test('R3: settle() finishes a pending logout and waits while a fresh deleting marker exists', async () => {
  const h = harness({ signedIn: false });
  const paths = [];
  const inner = h.fetch;
  h.fetch = async (p, i) => { paths.push(p); return inner(p, i); };
  h.storage.setItem(PENDING_LOGOUT, '1');
  h.storage.setItem(DELETING, '995');
  let waits = 0;
  h.sleep = async (ms) => { assert.equal(ms, 200); if (++waits === 3) h.storage.removeItem(DELETING); };
  await h.s.settle();
  assert.deepEqual(paths, ['/api/auth/logout']);
  assert.equal(h.storage.getItem(PENDING_LOGOUT), null);
  assert.equal(waits, 3, 'waited until the delete ended');
  h.storage.setItem(DELETING, '-40000'); // stale (over 30 s): a crashed tab
  waits = 0;
  await h.s.settle();
  assert.equal(waits, 0);
  h.storage.setItem(DELETING, '1000'); // fresh, never removed: give up after 30 s
  h.sleep = async () => { waits++; };
  await h.s.settle();
  assert.equal(waits, 150);
});

test('R3: sign-in and sign-up finish a pending logout before the verify request', async (t) => {
  const buf = (n) => new Uint8Array([n]).buffer;
  const cred = { id: 'c', rawId: buf(1), type: 'public-key', response: { clientDataJSON: buf(2), authenticatorData: buf(3), signature: buf(4), attestationObject: buf(5) } };
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: { get: async () => cred, create: async () => cred } } });
  t.after(() => { if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete globalThis.navigator; });
  for (const [fn, verify] of [[signIn, '/api/auth/login/verify'], [signUp, '/api/auth/register/verify']]) {
    const h = harness({ signedIn: false });
    const paths = [];
    h.fetch = async (p) => {
      paths.push(p);
      if (p === '/api/auth/logout') return reply(200, { ok: true });
      if (p.endsWith('/options')) return reply(200, { challengeId: 'x', options: { challenge: 'AA', user: { id: 'AA' } } });
      if (p === verify) return reply(400, { error: 'verify' });
      throw new Error(p);
    };
    // A sign-out in another tab is waiting for the server, and starts while the passkey sheet is open.
    const get = globalThis.navigator.credentials.get;
    globalThis.navigator.credentials.get = globalThis.navigator.credentials.create = async () => { h.storage.setItem(PENDING_LOGOUT, '1'); return cred; };
    await fn(h.s);
    globalThis.navigator.credentials.get = globalThis.navigator.credentials.create = get;
    assert.ok(paths.indexOf('/api/auth/logout') >= 0 && paths.indexOf('/api/auth/logout') < paths.indexOf(verify), `${verify}: ${paths}`);
  }
});

// ---- Races v2 (V1-V5b, V8) ----

const otherTab = (h, extra = {}) => makeSyncer({
  fetch: async () => reply(200, { ok: true }), storage: h.storage, now: () => h.now, sleep: async () => {},
  getJournal: () => emptyJournal(), setJournal: () => true, ...extra,
});

test('V3: a marker whose random part starts with "e4" is still fresh', () => {
  const st = memStorage();
  st.setItem(WIPING, '1764301887000.e4r');
  assert.equal(wiping(st, 1764301888000), true);
  st.setItem(WIPING, '');
  assert.equal(wiping(st, 5000), false, 'an empty value is no marker');
});

test('V2: the storage event and the guard run the wipe handler once for one WIPED value', () => {
  const h = harness();
  let handled = 0;
  const listeners = [];
  h.s.onWipedElsewhere(() => { handled++; }, { addEventListener: (t, fn) => listeners.push(fn) });
  h.storage.setItem(WIPED, '2000.other');
  assert.equal(h.s.guardWrite(), true);
  listeners[0]({ key: WIPED, newValue: '2000.other' }); // the late event
  assert.equal(handled, 1);
});

test('V2: the removing tab remembers its own WIPED value', async () => {
  const h = harness();
  let handled = 0;
  h.s.onWipedElsewhere(() => { handled++; }, { addEventListener() {} });
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  await h.s.signOut({ clearLocal: true });
  assert.ok(h.storage.getItem(WIPED));
  assert.equal(h.s.guardWrite(), true);
  assert.equal(handled, 0);
});

test('V3: when the marker cannot be written (storage full), the removal stops and nothing changes', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  const set = h.storage.setItem;
  h.storage.setItem = (k, v) => { if (k === WIPING) throw new Error('QuotaExceededError'); return set(k, v); };
  await assert.rejects(h.s.signOut({ clearLocal: true }), /^Error: This browser could not prepare the removal, so nothing changed\.$/);
  assert.equal(h.journal.entries.length, 1);
  assert.ok(h.storage.getItem(REC));
});

test('V3: the marker is written again (new time, same id) before the second sync', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  const marks = [];
  h.sleep = async () => { marks.push(h.storage.getItem(WIPING)); h.now = 1300; };
  const inner = h.fetch;
  h.fetch = async (p, i) => { if (p === '/api/journal/sync') marks.push(h.storage.getItem(WIPING)); return inner(p, i); };
  await h.s.signOut({ clearLocal: true });
  const [first, , second] = [marks[1], null, marks[2]];
  assert.equal(marks[0], null, 'no marker during the first sync');
  assert.match(first, /^1000\./);
  assert.match(second, /^1300\./);
  assert.equal(first.split('.')[1], second.split('.')[1], 'same id');
});

test('V3: a marker that went stale or changed owner during the second sync stops the removal', async () => {
  for (const spoil of [(h) => { h.now += 11000; }, (h) => { h.storage.setItem(WIPING, `${h.now}.other-tab`); }]) {
    const h = harness();
    addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
    let n = 0;
    const inner = h.fetch;
    h.fetch = async (p, i) => { const r = await inner(p, i); if (p === '/api/journal/sync' && ++n === 2) spoil(h); return r; };
    await assert.rejects(h.s.signOut({ clearLocal: true }), /Try again\.$/);
    assert.equal(h.journal.entries.length, 1, 'nothing removed');
    assert.ok(h.storage.getItem(REC));
  }
});

test('V5: logout writes the logging-out marker while its request is out, and removes it after', async () => {
  const h = harness({ signedIn: false });
  let during = null;
  h.fetch = async (p) => { if (p === '/api/auth/logout') { during = h.storage.getItem(LOGGING_OUT); throw new TypeError('offline'); } throw new Error(p); };
  h.storage.setItem(PENDING_LOGOUT, '1');
  await h.s.check();
  assert.match(during, /^1000/);
  assert.equal(h.storage.getItem(LOGGING_OUT), null, 'removed on an error too');
});

test('V5: settle() waits for another tab\'s logout and sends no second one while it is out', async () => {
  const h = harness({ signedIn: false });
  const paths = [];
  h.fetch = async (p) => { paths.push(p); return reply(200, { ok: true }); };
  h.storage.setItem(PENDING_LOGOUT, '1');
  h.storage.setItem(LOGGING_OUT, '995.other');
  let waits = 0;
  h.sleep = async (ms) => {
    assert.equal(ms, 200);
    if (++waits === 4) { h.storage.removeItem(LOGGING_OUT); h.storage.removeItem(PENDING_LOGOUT); } // its answer came
  };
  await h.s.settle();
  assert.equal(waits, 4);
  assert.deepEqual(paths, [], 'no duplicate logout');
});

test('V5: settle() waits up to 30 s for a deleting or logging-out marker; 25 s old is still fresh', async () => {
  for (const key of [DELETING, LOGGING_OUT]) {
    const h = harness({ signedIn: false });
    h.storage.setItem(key, String(1000 - 25000));
    let waits = 0;
    h.sleep = async () => { waits++; };
    await h.s.settle();
    assert.equal(waits, 150, `${key}: 150 x 200 ms`);
  }
});

test('V5b: sign-in and sign-up open the passkey prompt before any wait; the waits come before verify', async (t) => {
  const buf = (n) => new Uint8Array([n]).buffer;
  const cred = { id: 'c', rawId: buf(1), type: 'public-key', response: { clientDataJSON: buf(2), authenticatorData: buf(3), signature: buf(4), attestationObject: buf(5) } };
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => { if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete globalThis.navigator; });
  for (const [fn, verify] of [[signIn, '/api/auth/login/verify'], [signUp, '/api/auth/register/verify']]) {
    const h = harness({ signedIn: false });
    const log = [];
    h.storage.setItem(LOGGING_OUT, '995.other');
    h.storage.setItem(DELETING, '995');
    h.sleep = async () => { log.push('wait'); h.storage.removeItem(LOGGING_OUT); h.storage.removeItem(DELETING); };
    h.fetch = async (p) => {
      log.push(p);
      if (p.endsWith('/options')) return reply(200, { challengeId: 'x', options: { challenge: 'AA', user: { id: 'AA' } } });
      if (p === verify) return reply(400, { error: 'verify' });
      throw new Error(p);
    };
    const prompt = async () => { log.push('prompt'); return cred; };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: { get: prompt, create: prompt } } });
    await fn(h.s);
    assert.deepEqual(log.slice(0, 2), [log[0], 'prompt'], `${verify}: ${log}`);
    assert.ok(log[0].endsWith('/options'));
    assert.ok(log.indexOf('wait') > log.indexOf('prompt') && log.indexOf('wait') < log.indexOf(verify), `${verify}: ${log}`);
  }
});

test('V8: busy() is true while a sign-out or delete runs, and a status event follows its end', async () => {
  const h = harness();
  let release;
  const gate = new Promise((r) => { release = r; });
  h.sleep = () => gate;
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  assert.equal(h.s.busy(), false);
  const run = h.s.signOut({ clearLocal: true });
  assert.equal(h.s.busy(), true);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(h.s.busy(), true, 'still busy during the wait');
  h.events.length = 0;
  release();
  await run;
  assert.equal(h.s.busy(), false);
  assert.ok(h.events.some((e) => e.status), 'the page can enable its buttons again');
  const f = harness();
  f.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(f.s.deleteAccount({ account: 'u1' }));
  assert.equal(f.s.busy(), false, 'also after a failure');
});

test('V8: adopt() does not write while another tab removes the journal', async () => {
  const h = harness({ signedIn: false });
  h.s.onWipedElsewhere(() => {}, { addEventListener() {} });
  h.storage.setItem(WIPING, '995.other');
  const paths = [];
  h.fetch = async (p) => { paths.push(p); return reply(200, { ok: true }); };
  await assert.rejects(h.s.adopt({ id: 'u1', label: 'L' }), /Another tab is removing the journal from this browser/);
  assert.equal(h.storage.getItem(REC), null);
  assert.equal(h.storage.getItem(LAST), null);
  assert.deepEqual(paths, ['/api/auth/logout'], 'the new session is ended');
});

// ---- Races v3 (S1-S8): Web Locks only; writes during a removal wait, they are never refused ----

const tick = () => new Promise((r) => setTimeout(r, 0));

test('S1: without Web Locks, remove-from-browser and delete refuse; plain sign-out and sync still work', async () => {
  const st = memStorage();
  st.setItem(REC, JSON.stringify({ account: 'u1', label: 'L', at: null }));
  const paths = [];
  const fetch = async (p) => { paths.push(p); return p === '/api/journal/sync' ? reply(200, { journal: emptyJournal(), rev: 0 }) : reply(200, { ok: true }); };
  const s = makeSyncer({ fetch, storage: st, getJournal: () => emptyJournal(), setJournal: () => true });
  const unsafe = /^Error: This browser cannot do this safely\. Export your journal, then clear this site’s data in the browser settings\.$/;
  await assert.rejects(s.signOut({ clearLocal: true, account: 'u1' }), unsafe);
  await assert.rejects(s.deleteAccount({ account: 'u1' }), unsafe);
  assert.deepEqual(paths, [], 'nothing was sent');
  assert.equal(await s.syncNow(), true);
  await s.signOut({ account: 'u1' });
  assert.equal(st.getItem(REC), null);
  assert.deepEqual([...st.m.keys()].filter((k) => k.endsWith('.lock')), [], 'no storage lease');
});

test('S2: the marker is read back as the exact string written, also when the clock ticks between calls', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'a' }, T(1));
  let t = 1000;
  Object.defineProperty(h, 'now', { get: () => t++, set() {} });
  await h.s.signOut({ clearLocal: true });
  assert.equal(h.journal.entries.length, 0, 'removed: no false "could not prepare" or "took too long"');
  assert.equal(h.storage.getItem(WIPING), null);
});

test('S2: writes during a removal wait (this tab and others), the reader is told once, and they land after it on the reloaded journal', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'synced' }, T(1));
  save(h.journal, h.storage);
  let bJournal = load(h.storage);
  const bSleeps = [];
  let bTold = 0;
  const b = otherTab(h, {
    getJournal: () => bJournal, reload: () => { bJournal = load(h.storage); }, onDefer: () => { bTold++; },
    sleep: async (ms) => { bSleeps.push(ms); await tick(); },
  });
  const ran = [];
  h.sleep = async (ms) => {
    if (ms !== 300) { await tick(); return; } // this tab's own queue polls every 500 ms
    // The 300 ms wait: a Save in another tab, twice, and one in this tab.
    assert.equal(b.gate(() => ran.push(['b1', bJournal.entries.length])), false);
    assert.equal(b.gate(() => ran.push(['b2', bJournal.entries.length])), false);
    assert.equal(h.s.gate(() => ran.push(['own', h.journal.entries.length])), false, 'this tab waits too');
    assert.deepEqual(ran, []);
  };
  await h.s.signOut({ clearLocal: true });
  assert.equal(h.journal.entries.length, 0, 'the removal ended: nothing refused it');
  for (let i = 0; i < 50 && ran.length < 3; i++) await tick();
  assert.deepEqual(ran.sort(), [['b1', 0], ['b2', 0], ['own', 0]], 'every change ran, on the reloaded (empty) journal');
  assert.equal(bTold, 1, 'the other tab told the reader once');
  assert.equal(h.deferred, 1);
  assert.ok(bSleeps.length > 0 && bSleeps.every((ms) => ms === 500), 'retried every 500 ms');
});

test('S2: a gated write runs at once when no tab removes the journal; a stale marker (over 10 s) does not hold it', () => {
  const h = harness();
  const ran = [];
  assert.equal(h.s.gate(() => ran.push(1)), true);
  h.storage.setItem(WIPING, '-20000.crashed');
  assert.equal(h.s.gate(() => ran.push(2)), true);
  assert.deepEqual(ran, [1, 2]);
  assert.equal(h.deferred, 0);
});

test('S2: a tab that missed a WIPED change reloads its journal once, runs its wipe handler, then writes', () => {
  const h = harness();
  let handled = 0;
  h.s.onWipedElsewhere(() => { handled++; }, { addEventListener() {} });
  addEntry(h.journal, { passage: 1, text: 'removed in another tab' }, T(1));
  h.storage.setItem(WIPED, '2000.other');
  assert.equal(h.s.guardWrite(), true);
  assert.equal(h.journal.entries.length, 0, 'memory reloaded from storage');
  assert.deepEqual([h.reloads, handled], [1, 1]);
  assert.equal(h.s.guardWrite(), true);
  assert.deepEqual([h.reloads, handled], [1, 1], 'once per value');
});

test('S3: a tab with old memory (back-forward cache) sends storage\'s journal after a removal and a sign-in to another account', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'account u1, memory only' }, T(1));
  // Meanwhile another tab removed the journal and signed in to u2. This tab got no storage events.
  h.storage.setItem(WIPED, '2000.other');
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
  await h.s.syncNow();
  assert.equal(h.sent[0].account, 'u2');
  assert.deepEqual(h.sent[0].journal.entries, [], 'not the old account\'s entries');
});

test('S3: a sign-in to another account in another tab (no removal) also makes the next sync body come from storage', async () => {
  const h = harness();
  addEntry(h.journal, { passage: 1, text: 'account u1, memory only' }, T(1));
  const theirs = emptyJournal();
  addEntry(theirs, { passage: 2, text: 'u2 journal' }, T(2));
  save(theirs, h.storage); // "Use only this account's journal" in another tab
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
  await h.s.syncNow();
  assert.deepEqual(h.sent[0].journal.entries.map((e) => e.text), ['u2 journal']);
});

test('S3: catchUp() (pageshow from the back-forward cache) reloads only when WIPED or the account changed', () => {
  const h = harness();
  h.s.catchUp();
  assert.equal(h.reloads, 0);
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
  h.s.catchUp();
  assert.equal(h.reloads, 1);
  h.s.catchUp();
  assert.equal(h.reloads, 1);
});

test('S3: Replace at sign-in keeps a copy of the journal as it is after the prompt (a save made meanwhile is in it)', async () => {
  const h = harness({ signedIn: false });
  h.storage.setItem(LAST, 'u-old');
  addEntry(h.journal, { passage: 1, text: 'before' }, T(1));
  const onSwitch = async () => {
    const j = structuredClone(h.journal);
    addEntry(j, { passage: 2, text: 'saved during the prompt' }, T(2));
    h.journal = j; // state.change() puts a new object in memory
    return 'replace';
  };
  assert.equal(await h.s.adopt({ id: 'u1', label: 'L' }, { onSwitch }), true);
  assert.deepEqual(h.snaps[0].entries.map((e) => e.text), ['before', 'saved during the prompt']);
});

test('S2: delete writes nothing while a fresh marker exists (a removing tab crashed): the pull and the storage retry are gated', async () => {
  const big = harness();
  addEntry(big.journal, { passage: 1, text: 'too large to upload' }, T(1));
  save(big.journal, big.storage);
  const other = emptyJournal();
  addEntry(other, { passage: 2, text: 'from another device' }, T(2));
  big.server = other;
  const inner = big.fetch;
  big.fetch = async (p, i) => (p === '/api/journal/sync' && JSON.parse(i.body).journal.entries.length ? reply(413, { error: 'too-large' }) : inner(p, i));
  big.storage.setItem(WIPING, '995.crashed');
  await assert.rejects(big.s.deleteAccount({ account: 'u1' }), /^Error: Another tab is removing the journal from this browser, so nothing was deleted\. Try again in a moment\.$/);
  assert.deepEqual(load(big.storage).entries.map((e) => e.text), ['too large to upload'], 'the pull saved nothing');
  assert.deepEqual(big.deletes, []);

  const g = harness();
  g.server = other;
  g.setSaves(false);
  await assert.rejects(g.s.deleteAccount({ account: 'u1' })); // memory holds the answer, storage does not
  g.setSaves(true);
  g.events.push = () => { g.storage.setItem(WIPING, `${g.now}.crashed`); return 0; }; // the marker comes after the sync
  await assert.rejects(g.s.deleteAccount({ account: 'u1' }), /so nothing was deleted\. Try again in a moment\.$/);
  assert.equal(load(g.storage).entries.length, 0, 'the storage retry saved nothing');
  assert.deepEqual(g.deletes, []);
});

test('S6: settle() ends after 30 s in all, even when this tab\'s own logout never answers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness({ signedIn: false });
  h.fetch = () => new Promise(() => {}); // the logout request hangs
  h.s.signOut({ account: null });
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  await flush();
  let done = false;
  h.s.settle().then(() => { done = true; });
  await flush();
  t.mock.timers.tick(29999);
  await flush();
  assert.equal(done, false);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(done, true);
});

test('S6: check() sends no second logout while another tab\'s logout is out', async () => {
  const h = harness();
  const paths = [];
  h.fetch = async (p) => { paths.push(p); return reply(200, { ok: true }); };
  h.storage.setItem(PENDING_LOGOUT, '1');
  h.storage.setItem(LOGGING_OUT, '995.other');
  await h.s.check();
  assert.deepEqual(paths, []);
  assert.equal(h.storage.getItem(REC), null, 'the session is not resumed');
});

// ---- Races v4 (A1-A5) ----

test('A1: a storage-event load while another account is signed in binds memory to that account; when the first account comes back, the next sync body comes from storage', async () => {
  const h = harness(); // u1
  const theirs = emptyJournal();
  addEntry(theirs, { passage: 2, text: 'u2 journal' }, T(2));
  save(theirs, h.storage);
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
  h.s.reloadJournal(); // the journal storage event (app.js)
  assert.deepEqual(h.journal.entries.map((e) => e.text), ['u2 journal']);
  // u2 signs out keeping the journal; another tab signs in to u1 and chooses Replace. No storage event yet.
  save(emptyJournal(), h.storage);
  h.storage.setItem(REC, JSON.stringify({ account: 'u1', label: 'L', at: null }));
  await h.s.syncNow();
  assert.equal(h.sent[0].account, 'u1');
  assert.deepEqual(h.sent[0].journal.entries, [], 'u2\'s entries were not sent to u1');
});

test('A5: catchUp() after a storage-event load does not read the journal again when nothing changed', () => {
  const h = harness();
  h.s.reloadJournal();
  const n = h.reloads;
  h.s.catchUp(); // pageshow from the back-forward cache
  assert.equal(h.reloads, n);
});

test('A2: adopt() decides on storage, not memory: a tab with empty memory still asks before it takes another account\'s journal', async () => {
  const h = harness({ signedIn: false });
  h.storage.setItem(LAST, 'u-old');
  const stored = emptyJournal();
  addEntry(stored, { passage: 1, text: 'u-old, saved in another tab' }, T(1));
  save(stored, h.storage); // this tab's memory is still empty
  let asked = 0;
  const onSwitch = async () => {
    asked++;
    const j = load(h.storage);
    addEntry(j, { passage: 2, text: 'saved in another tab during the prompt' }, T(2));
    save(j, h.storage); // no storage event reached this tab yet
    return 'replace';
  };
  assert.equal(await h.s.adopt({ id: 'u1', label: 'L' }, { onSwitch }), true);
  assert.equal(asked, 1);
  assert.deepEqual(h.snaps[0].entries.map((e) => e.text), ['u-old, saved in another tab', 'saved in another tab during the prompt'], 'the snapshot holds what storage held after the prompt');
  assert.deepEqual(h.sent.at(-1).journal.entries, [], 'nothing of the old account went up');
});

test('A3: a write queued during a removal is not applied when the journal was removed and another account then signed in; the reader is told', async () => {
  const h = harness();
  let blocked = 0;
  const b = otherTab(h, { onBlocked: () => { blocked++; }, sleep: async () => { await tick(); } });
  h.storage.setItem(WIPING, `${h.now}.x`);
  const ran = [];
  assert.equal(b.gate(() => ran.push('A note of u1')), false);
  // The removal ends (WIPED changes), and u2 signs in to the emptied browser before the queue runs.
  h.storage.setItem(WIPED, '2000.x');
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
  h.storage.removeItem(WIPING);
  for (let i = 0; i < 20 && !blocked; i++) await tick();
  assert.deepEqual(ran, []);
  assert.equal(blocked, 1);
});

test('A3: a queued write still runs after a removal when no account (or the same one) is signed in (v5: another account refuses it, E5)', async () => {
  for (const [wiped, rec] of [[true, null], [false, 'u1'], [true, 'u1']]) {
    const h = harness();
    const b = otherTab(h, { sleep: async () => { await tick(); } });
    h.storage.setItem(WIPING, `${h.now}.x`);
    const ran = [];
    b.gate(() => ran.push(1));
    if (wiped) h.storage.setItem(WIPED, '2000.x');
    if (rec) h.storage.setItem(REC, JSON.stringify({ account: rec, label: 'B', at: null })); else h.storage.removeItem(REC);
    h.storage.removeItem(WIPING);
    for (let i = 0; i < 20 && !ran.length; i++) await tick();
    assert.deepEqual(ran, [1], `wiped=${wiped} rec=${rec}`);
  }
});

test('A4: onWaiting(true) while writes wait in the queue, onWaiting(false) once they ran (the app asks before the tab closes)', async () => {
  const h = harness();
  const seen = [];
  const b = otherTab(h, { onWaiting: (v) => seen.push(v), sleep: async () => { await tick(); } });
  h.storage.setItem(WIPING, `${h.now}.x`);
  b.gate(() => {});
  b.gate(() => {});
  assert.deepEqual(seen, [true]);
  h.storage.removeItem(WIPING);
  for (let i = 0; i < 20 && seen.length < 2; i++) await tick();
  assert.deepEqual(seen, [true, false]);
});

// v5: an editor belongs to the account it opened under. stamp() is taken when an editor opens (or a list
// with Edit buttons is built); gate(fn, stamp) refuses at once, as the queue does (one check: refused()).
test('E1: an editor stamped u1 saves nothing after another tab signed in to u2 with Replace (no removal); the reader is told', () => {
  const h = harness();
  let blocked = 0;
  const b = otherTab(h, { onBlocked: () => { blocked++; } });
  const st = b.stamp();
  assert.deepEqual(st, { account: 'u1', gen: null });
  save(emptyJournal(), h.storage); // adopt saves the empty journal, then sets REC
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
  const ran = [];
  assert.equal(b.gate(() => ran.push('A entry'), st), false);
  assert.deepEqual(ran, []);
  assert.equal(blocked, 1);
  assert.equal(b.gate(() => ran.push('new box'), b.stamp()), true, 'an editor opened now belongs to u2');
});

test('E2: an editor stamped u1 saves nothing after the journal was removed and u2 signed in (the kept box)', () => {
  const h = harness();
  let blocked = 0;
  const b = otherTab(h, { onBlocked: () => { blocked++; } });
  const st = b.stamp();
  h.storage.setItem(WIPED, '2000.x');
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
  const ran = [];
  assert.equal(b.gate(() => ran.push(1), st), false);
  assert.deepEqual([ran, blocked], [[], 1]);
});

test('E3: an editor stamped u1 still saves after a removal when nobody (or u1 again) is signed in', () => {
  for (const rec of [null, 'u1']) {
    const h = harness();
    const b = otherTab(h);
    const st = b.stamp();
    h.storage.setItem(WIPED, '2000.x');
    if (rec) h.storage.setItem(REC, JSON.stringify({ account: rec, label: 'L', at: null })); else h.storage.removeItem(REC);
    const ran = [];
    assert.equal(b.gate(() => ran.push(1), st), true, `rec=${rec}`);
    assert.deepEqual(ran, [1]);
  }
});

test('E4: an editor opened signed out saves after a sign-in without a removal (the signed-out journal goes into that account); after a removal it does not', () => {
  for (const [wiped, ok] of [[false, true], [true, false]]) {
    const h = harness({ signedIn: false });
    const b = otherTab(h);
    const st = b.stamp();
    assert.equal(st.account, null);
    if (wiped) h.storage.setItem(WIPED, '2000.x');
    h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
    const ran = [];
    assert.equal(b.gate(() => ran.push(1), st), ok, `wiped=${wiped}`);
    assert.equal(ran.length, ok ? 1 : 0);
  }
});

test('E5: a queued write with a stamp is refused by the same check when the account changed during the wait', async () => {
  const h = harness();
  let blocked = 0;
  const b = otherTab(h, { onBlocked: () => { blocked++; }, sleep: async () => { await tick(); } });
  const st = b.stamp();
  h.storage.setItem(WIPING, `${h.now}.x`);
  const ran = [];
  assert.equal(b.gate(() => ran.push(1), st), false);
  h.storage.setItem(REC, JSON.stringify({ account: 'u2', label: 'B', at: null }));
  h.storage.removeItem(WIPING);
  for (let i = 0; i < 20 && !blocked; i++) await tick();
  assert.deepEqual([ran, blocked], [[], 1]);
});
