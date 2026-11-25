// Many random changes on three devices, synced in random order through the real
// Worker code and a real SQLite stand-in for D1. Sync must merge, never overwrite:
// every entry or draw that was added and never removed ends up on every device,
// nothing removed comes back, and all copies end up the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../worker/sync.js';
import { makeSyncer, REC } from '../app/js/sync.js';
import { fakeD1 } from './helpers/fake-d1.js';
import { emptyJournal, addEntry, updateEntry, deleteEntry, recordDraw, deleteDraw, merge, syncCore } from '../app/js/journal.js';

const ORIGIN = 'https://tao.tensor.group';
const SCHEMA = new URL('../worker/sync-schema.sql', import.meta.url).pathname;

function rng(seed) {
  let x = seed >>> 0;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2 ** 32; };
}

const lib = {
  generateRegistrationOptions: async () => ({ challenge: `c${Math.random()}` }),
  verifyRegistrationResponse: async (o) => ({ verified: true, registrationInfo: { credential: { id: o.response.id, publicKey: new Uint8Array([1]), counter: 0 } } }),
  generateAuthenticationOptions: async () => ({ challenge: 'x' }),
  verifyAuthenticationResponse: async () => ({ verified: true, authenticationInfo: { newCounter: 0 } }),
};

async function world(seed) {
  const env = { tao_sync: fakeD1(SCHEMA), RP_ID: 'tao.tensor.group', ORIGIN };
  let clock = Date.parse('2026-11-25T00:00:00Z');
  const tick = () => new Date(clock += 1000).toISOString();
  const call = (path, init = {}, cookie) => handleApi(new Request(`${ORIGIN}${path}`, {
    ...init, headers: { ...(init.headers || {}), origin: ORIGIN, ...(cookie ? { cookie: `__Host-tao_s=${cookie}` } : {}) },
  }), env, { lib, now: clock });
  const o = await (await call('/api/auth/register/options', { method: 'POST', body: '{}' })).json();
  const v = await call('/api/auth/register/verify', { method: 'POST', body: JSON.stringify({ challengeId: o.challengeId, response: { id: 'cred' } }) });
  const account = (await v.json()).account;
  const token = v.headers.get('set-cookie').match(/__Host-tao_s=([^;]*)/)[1];

  const r = rng(seed);
  const devices = [0, 1, 2].map((n) => {
    const m = new Map();
    const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, val) => m.set(k, String(val)), removeItem: (k) => m.delete(k) };
    storage.setItem(REC, JSON.stringify({ account: account.id, label: account.label, at: null }));
    const d = { n, journal: emptyJournal(), online: true };
    d.syncer = makeSyncer({
      storage,
      fetch: async (path, init) => {
        if (!d.online) throw new TypeError('offline');
        return call(path, { method: init.method, body: init.body, headers: init.headers }, token);
      },
      getJournal: () => d.journal,
      setJournal: (j) => { d.journal = j; },
    });
    return d;
  });
  return { devices, r, tick, env, account };
}

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  test(`random changes on three devices merge and converge (seed ${seed})`, async () => {
    const { devices, r, tick, env, account } = await world(seed);
    const added = new Map();      // id -> kind
    const removed = new Set();    // ids removed by a device that had them
    const lastText = new Map();   // id -> text of the newest edit anywhere
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const pending = [];

    for (let step = 0; step < 400; step++) {
      const d = pick(devices);
      const j = d.journal;
      const roll = r();
      if (roll < 0.25) {
        const e = addEntry(j, { passage: 1 + Math.floor(r() * 81), text: `e${step}` }, tick());
        added.set(e.id, 'entry'); lastText.set(e.id, e.text);
      } else if (roll < 0.4 && j.entries.length) {
        const e = pick(j.entries);
        if (!removed.has(e.id)) { updateEntry(j, e.id, `edit${step}`, tick()); lastText.set(e.id, `edit${step}`); }
      } else if (roll < 0.47 && j.entries.length) {
        const e = pick(j.entries);
        deleteEntry(j, e.id, tick()); removed.add(e.id);
      } else if (roll < 0.62) {
        const dr = recordDraw(j, { passage: 1 + Math.floor(r() * 81), lines: [0, 1, 2, 0], bundles: [] }, tick());
        added.set(dr.id, 'draw');
      } else if (roll < 0.67 && j.draws.length) {
        const dr = pick(j.draws);
        deleteDraw(j, dr.id, tick()); removed.add(dr.id);
      } else if (roll < 0.75) {
        d.online = !d.online; // go offline or back online
      } else {
        // Start a sync and sometimes let it run while more changes happen.
        const p = d.syncer.syncNow();
        if (r() < 0.5) await p; else pending.push(p);
      }
    }
    await Promise.all(pending);
    for (const d of devices) d.online = true;
    // Two full rounds: everyone uploads, then everyone downloads.
    for (let round = 0; round < 2; round++) for (const d of devices) await d.syncer.syncNow();

    const server = JSON.parse(env.tao_sync.raw.prepare('SELECT data FROM journals WHERE user_id = ?').get(account.id).data);
    for (const d of devices) {
      assert.deepEqual(syncCore(merge(d.journal, server)), syncCore(d.journal), `device ${d.n} lacks something the server has`);
      assert.deepEqual(JSON.stringify(syncCore(d.journal)), JSON.stringify(server), `device ${d.n} differs from the server`);
    }
    const j = devices[0].journal;
    const have = new Set([...j.entries.map((e) => e.id), ...j.draws.map((x) => x.id)]);
    for (const [id, kind] of added) {
      if (removed.has(id)) assert.equal(have.has(id), false, `removed ${kind} ${id} came back`);
      else assert.equal(have.has(id), true, `${kind} ${id} was lost`);
    }
    for (const e of j.entries) assert.equal(e.text, lastText.get(e.id), `entry ${e.id} lost its newest edit`);
    assert.ok(added.size > 50, 'the run made enough changes to mean something');
  });
}
