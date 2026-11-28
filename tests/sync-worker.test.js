import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../worker/sync.js';
import { fakeD1 } from './helpers/fake-d1.js';
import { chunked } from './helpers/stream.js';
import { openLimits } from './helpers/limits.js';
import { emptyJournal, addEntry, recordDraw, deleteDraw } from '../app/js/journal.js';

const ORIGIN = 'https://tao.tensor.group';
const SCHEMA = new URL('../worker/sync-schema.sql', import.meta.url).pathname;
const T0 = Date.parse('2026-11-25T12:00:00Z');
const DAY = 86400000;

function stubLib() {
  const calls = { regOpts: [], authOpts: [], regVerify: [], authVerify: [] };
  let n = 0;
  const stub = {
    calls,
    nextCounter: 0, // the signature counter the next login reports (many passkeys always send 0)
    generateRegistrationOptions: async (o) => { calls.regOpts.push(o); return { challenge: `reg-${++n}`, rp: { id: o.rpID } }; },
    generateAuthenticationOptions: async (o) => { calls.authOpts.push(o); return { challenge: `auth-${++n}` }; },
    verifyRegistrationResponse: async (o) => {
      calls.regVerify.push(o);
      if (!o.response?.ok || o.response.challenge !== o.expectedChallenge) throw new Error('bad');
      return { verified: true, registrationInfo: { credential: { id: o.response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0 } } };
    },
    verifyAuthenticationResponse: async (o) => {
      calls.authVerify.push(o);
      if (!o.response?.ok || o.response.challenge !== o.expectedChallenge) throw new Error('bad');
      return { verified: true, authenticationInfo: { newCounter: stub.nextCounter } };
    },
  };
  return stub;
}

function setup({ origin: site = ORIGIN, ...over } = {}) {
  const env = { tao_sync: fakeD1(SCHEMA), RP_ID: 'tao.tensor.group', ORIGIN, ...openLimits(), ...over };
  const lib = stubLib();
  let now = T0;
  const call = async (method, path, body, { cookie, origin = site, headers = {} } = {}) => {
    const h = { ...headers };
    if (origin) h.origin = origin;
    if (cookie) h.cookie = `__Host-tao_s=${cookie}`;
    const req = new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const res = await handleApi(req, env, { lib, now });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  const tokenOf = (res) => res.headers.get('set-cookie')?.match(/__Host-tao_s=([^;]*)/)?.[1];
  const signUp = async (credId = 'cred-1') => {
    const o = await call('POST', '/api/auth/register/options', {});
    const v = await call('POST', '/api/auth/register/verify', { challengeId: o.body.challengeId, response: { id: credId, ok: true, challenge: o.body.options.challenge } });
    return { res: v, token: tokenOf(v), id: v.body?.account?.id };
  };
  return { env, lib, call, signUp, tokenOf, setNow: (t) => { now = t; } };
}

test('non-sync paths return null; unknown /api path is 404', async () => {
  const env = { tao_sync: fakeD1(SCHEMA), RP_ID: 'x', ORIGIN };
  assert.equal(await handleApi(new Request(`${ORIGIN}/index.html`), env), null);
  assert.equal((await handleApi(new Request(`${ORIGIN}/api/nope`), env)).status, 404);
});

test('writes need our Origin, or Sec-Fetch-Site same-origin when Origin is missing', async () => {
  const { call } = setup();
  assert.equal((await call('POST', '/api/auth/login/options', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', '/api/auth/login/options', {}, { origin: null })).status, 403);
  assert.equal((await call('POST', '/api/auth/login/options', {}, { origin: null, headers: { 'sec-fetch-site': 'same-origin' } })).status, 200);
});

test('every /api response is no-store', async () => {
  const { call } = setup();
  for (const r of [await call('GET', '/api/session'), await call('POST', '/api/journal/sync', {}), await call('POST', '/api/auth/login/options', {})]) {
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});

test('register: options use env RP and require UV + resident key; cookie is hardened; token stored hashed', async () => {
  const { call, signUp, lib, env } = setup();
  const { res, token } = await signUp();
  assert.equal(res.status, 200);
  const o = lib.calls.regOpts[0];
  assert.equal(o.rpID, 'tao.tensor.group');
  assert.equal(o.authenticatorSelection.userVerification, 'required');
  assert.equal(o.authenticatorSelection.residentKey, 'required');
  assert.equal(o.userName, 'Tao journal · 25 Nov 2026');
  const v = lib.calls.regVerify[0];
  assert.equal(v.expectedOrigin, ORIGIN);
  assert.equal(v.expectedRPID, 'tao.tensor.group');
  assert.equal(v.requireUserVerification, true);
  const cookie = res.headers.get('set-cookie');
  for (const part of ['__Host-tao_s=', 'Path=/', `Max-Age=${400 * 86400}`, 'HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(cookie.includes(part), part);
  assert.ok(!cookie.includes('Domain'));
  const rows = env.tao_sync.raw.prepare('SELECT token_hash FROM sessions').all();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
  const s = await call('GET', '/api/session', undefined, { cookie: token });
  assert.deepEqual(s.body.account.label, 'Tao journal · 25 Nov 2026');
  assert.equal(env.tao_sync.raw.prepare('SELECT rev FROM journals').get().rev, 0);
});

test('register uses the user id from the challenge row, not the client', async () => {
  const { call, env } = setup();
  const o = await call('POST', '/api/auth/register/options', {});
  const want = env.tao_sync.raw.prepare('SELECT user_id FROM challenges').get().user_id;
  const v = await call('POST', '/api/auth/register/verify', { challengeId: o.body.challengeId, userId: 'attacker', response: { id: 'c', ok: true, challenge: o.body.options.challenge } });
  assert.equal(v.body.account.id, want);
});

test('challenge is single use, kind-bound, and expires', async () => {
  const { call, setNow } = setup();
  const o = await call('POST', '/api/auth/register/options', {});
  const resp = { id: 'c', ok: true, challenge: o.body.options.challenge };
  // wrong kind: a registration challenge used to log in is consumed and refused
  const a = await call('POST', '/api/auth/login/options', {});
  assert.equal((await call('POST', '/api/auth/login/verify', { challengeId: o.body.challengeId, response: resp })).status, 400);
  assert.equal((await call('POST', '/api/auth/register/verify', { challengeId: o.body.challengeId, response: resp })).status, 400);
  // expired
  const o2 = await call('POST', '/api/auth/register/options', {});
  setNow(T0 + 6 * 60000);
  assert.equal((await call('POST', '/api/auth/register/verify', { challengeId: o2.body.challengeId, response: { id: 'c2', ok: true, challenge: o2.body.options.challenge } })).status, 400);
  assert.ok(a.body.challengeId);
});

test('login: unknown passkey is 404; mismatched userHandle is refused; good login starts a session', async () => {
  const { call, signUp, lib, tokenOf } = setup();
  const { res } = await signUp('cred-A');
  const userId = res.body.account.id;
  let o = await call('POST', '/api/auth/login/options', {});
  assert.equal(lib.calls.authOpts[0].userVerification, 'required');
  let v = await call('POST', '/api/auth/login/verify', { challengeId: o.body.challengeId, response: { id: 'nope', ok: true, challenge: o.body.options.challenge } });
  assert.equal(v.status, 404);
  assert.equal(v.body.error, 'unknown-passkey');
  o = await call('POST', '/api/auth/login/options', {});
  v = await call('POST', '/api/auth/login/verify', { challengeId: o.body.challengeId, response: { id: 'cred-A', ok: true, challenge: o.body.options.challenge, response: { userHandle: 'other' } } });
  assert.equal(v.status, 400);
  o = await call('POST', '/api/auth/login/options', {});
  v = await call('POST', '/api/auth/login/verify', { challengeId: o.body.challengeId, response: { id: 'cred-A', ok: true, challenge: o.body.options.challenge, response: { userHandle: userId } } });
  assert.equal(v.status, 200);
  assert.equal(v.body.account.id, userId);
  assert.ok(tokenOf(v));
  assert.equal(lib.calls.authVerify.at(-1).requireUserVerification, true);
});

test('sync needs a session; expired session is 401', async () => {
  const { call, signUp, setNow } = setup();
  assert.equal((await call('POST', '/api/journal/sync', { journal: emptyJournal() })).status, 401);
  const { token } = await signUp();
  setNow(T0 + 401 * DAY);
  assert.equal((await call('POST', '/api/journal/sync', { journal: emptyJournal() }, { cookie: token })).status, 401);
});

test('sync merges two devices, strips lastExportAt, and a repeat sync keeps rev', async () => {
  const { call, signUp, env } = setup();
  const { token } = await signUp();
  const phone = emptyJournal();
  addEntry(phone, { passage: 1, text: 'phone' }, '2026-11-25T10:00:00.000Z');
  phone.lastExportAt = '2026-11-20T00:00:00.000Z';
  const desk = emptyJournal();
  addEntry(desk, { passage: 2, text: 'desk' }, '2026-11-25T11:00:00.000Z');
  const r1 = await call('POST', '/api/journal/sync', { journal: phone }, { cookie: token });
  assert.equal(r1.body.rev, 1);
  assert.equal('lastExportAt' in r1.body.journal, false);
  const r2 = await call('POST', '/api/journal/sync', { journal: desk }, { cookie: token });
  assert.equal(r2.body.rev, 2);
  assert.deepEqual(r2.body.journal.entries.map((e) => e.text), ['phone', 'desk']);
  assert.ok(!env.tao_sync.raw.prepare('SELECT data FROM journals').get().data.includes('lastExportAt'));
  const r3 = await call('POST', '/api/journal/sync', { journal: r2.body.journal }, { cookie: token });
  assert.equal(r3.body.rev, 2);
});

test('a removed draw stays removed on the server', async () => {
  const { call, signUp } = setup();
  const { token } = await signUp();
  const a = emptyJournal();
  const d = recordDraw(a, { passage: 5, lines: [0, 0, 0, 0], bundles: [] }, '2026-11-25T10:00:00.000Z');
  await call('POST', '/api/journal/sync', { journal: a }, { cookie: token });
  const b = structuredClone(a);
  deleteDraw(a, d.id, '2026-11-25T10:05:00.000Z');
  await call('POST', '/api/journal/sync', { journal: a }, { cookie: token });
  const r = await call('POST', '/api/journal/sync', { journal: b }, { cookie: token });
  assert.equal(r.body.journal.draws.length, 0);
});

test('a stale rev is re-read and merged, not overwritten', async () => {
  const { call, signUp, env } = setup();
  const { token } = await signUp();
  // Another device writes between our read and our update: simulate by bumping rev and data once.
  const db = env.tao_sync;
  const realPrepare = db.prepare;
  let raced = false;
  db.prepare = (sql) => {
    if (!raced && sql.startsWith('UPDATE journals')) {
      raced = true;
      const other = emptyJournal();
      addEntry(other, { passage: 9, text: 'other device' }, '2026-11-25T09:00:00.000Z');
      db.raw.prepare('UPDATE journals SET data = ?, rev = rev + 1').run(JSON.stringify({ version: 1, entries: other.entries, draws: [], tombstones: [] }));
    }
    return realPrepare(sql);
  };
  const mine = emptyJournal();
  addEntry(mine, { passage: 1, text: 'mine' }, '2026-11-25T10:00:00.000Z');
  const r = await call('POST', '/api/journal/sync', { journal: mine }, { cookie: token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.journal.entries.map((e) => e.text).sort(), ['mine', 'other device']);
  assert.equal(r.body.rev, 2);
});

test('sync refuses a body over 512 KB and an invalid journal', async () => {
  const { call, signUp } = setup();
  const { token } = await signUp();
  const big = emptyJournal();
  addEntry(big, { passage: 1, text: 'x'.repeat(530 * 1024) }, '2026-11-25T10:00:00.000Z');
  assert.equal((await call('POST', '/api/journal/sync', { journal: big }, { cookie: token })).status, 413);
  assert.equal((await call('POST', '/api/journal/sync', { journal: { version: 2 } }, { cookie: token })).status, 400);
  assert.equal((await call('POST', '/api/journal/sync', 'not json', { cookie: token })).status, 400);
});

test('session slides at most once a day', async () => {
  const { call, signUp, setNow } = setup();
  const { token } = await signUp();
  setNow(T0 + 3600000);
  assert.equal((await call('GET', '/api/session', undefined, { cookie: token })).headers.get('set-cookie'), null);
  setNow(T0 + 2 * DAY);
  assert.ok((await call('GET', '/api/session', undefined, { cookie: token })).headers.get('set-cookie').includes('__Host-tao_s='));
});

test('signups stop at 300 a day', async () => {
  const { call, env } = setup();
  const ins = env.tao_sync.raw.prepare('INSERT INTO users (id, label, created) VALUES (?, ?, ?)');
  for (let i = 0; i < 300; i++) ins.run(`u${i}`, 'x', T0 - 1000);
  assert.equal((await call('POST', '/api/auth/register/options', {})).status, 503);
});

test('rate limit binding refuses with 429 when over', async () => {
  const { call, env } = setup();
  env.AUTH_LIMIT = { limit: async () => ({ success: false }) };
  assert.equal((await call('POST', '/api/auth/login/options', {})).status, 429);
});

test('logout ends the session; delete account removes every row', async () => {
  const { call, signUp, env } = setup();
  const s1 = await signUp('c1');
  const out = await call('POST', '/api/auth/logout', {}, { cookie: s1.token });
  assert.ok(out.headers.get('set-cookie').includes('Max-Age=0'));
  assert.equal((await call('GET', '/api/session', undefined, { cookie: s1.token })).body.account, null);
  const s2 = await signUp('c2');
  assert.equal((await call('DELETE', '/api/account', undefined, { cookie: s2.token })).status, 200);
  const id = s2.res.body.account.id;
  const count = (sql) => env.tao_sync.raw.prepare(sql).get(id).n;
  assert.equal(count('SELECT COUNT(*) AS n FROM journals WHERE user_id = ?'), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?'), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?'), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?'), 0);
  assert.equal((await call('POST', '/api/journal/sync', { journal: emptyJournal() }, { cookie: s2.token })).status, 401);
});

test('sign-up has its own per-IP limit', async () => {
  const { call, env } = setup();
  env.SIGNUP_LIMIT = { limit: async () => ({ success: false }) };
  assert.equal((await call('POST', '/api/auth/register/options', {})).status, 429);
  assert.equal((await call('POST', '/api/auth/login/options', {})).status, 200);
});

test('a sync after the account is gone does not re-create its journal', async () => {
  const { call, signUp, env } = setup();
  const { token, res } = await signUp();
  env.tao_sync.raw.prepare('DELETE FROM journals').run();
  env.tao_sync.raw.prepare('DELETE FROM users').run();
  const r = await call('POST', '/api/journal/sync', { journal: emptyJournal() }, { cookie: token });
  assert.equal(r.status, 401);
  assert.equal(env.tao_sync.raw.prepare('SELECT COUNT(*) AS n FROM journals WHERE user_id = ?').get(res.body.account.id).n, 0);
});

test('the sign-up cap is checked again at verify', async () => {
  const { call, env } = setup();
  const o = await call('POST', '/api/auth/register/options', {});
  const ins = env.tao_sync.raw.prepare('INSERT INTO users (id, label, created) VALUES (?, ?, ?)');
  for (let i = 0; i < 300; i++) ins.run(`u${i}`, 'x', T0 - 1000);
  const v = await call('POST', '/api/auth/register/verify', { challengeId: o.body.challengeId, response: { id: 'c', ok: true, challenge: o.body.options.challenge } });
  assert.equal(v.status, 503);
});

test('an oversized body is refused from content-length before it is read', async () => {
  const { env, signUp } = setup();
  const { token } = await signUp();
  const req = new Request(`${ORIGIN}/api/journal/sync`, { method: 'POST', headers: { origin: ORIGIN, cookie: `__Host-tao_s=${token}`, 'content-length': String(600 * 1024) }, body: JSON.stringify({ journal: emptyJournal() }) });
  const res = await handleApi(req, env, { lib: stubLib(), now: T0 });
  assert.equal(res.status, 413);
});

test('a chunked sync body over 512 KB stops early with 413', async () => {
  const { env, lib, signUp } = setup();
  const { token } = await signUp();
  const { body, seen } = chunked(Array.from({ length: 32 }, () => new Uint8Array(64 * 1024).fill(0x20))); // 2 MiB, four times the cap
  const req = new Request(`${ORIGIN}/api/journal/sync`, { method: 'POST', headers: { origin: ORIGIN, cookie: `__Host-tao_s=${token}` }, body, duplex: 'half' });
  assert.equal(req.headers.get('content-length'), null);
  const res = await handleApi(req, env, { lib, now: T0 });
  assert.equal(res.status, 413);
  assert.ok(seen.pulled <= 10, `${seen.pulled} of 32 chunks read`); // 8 chunks fill the cap; the 9th passes it
  assert.equal(seen.cancelled, true);
});

test('a body under the cap with a character split across chunks still syncs', async () => {
  const { env, lib, signUp } = setup();
  const { token } = await signUp();
  const j = emptyJournal();
  addEntry(j, { passage: 1, text: 'é under water' });
  const bytes = new TextEncoder().encode(JSON.stringify({ journal: j }));
  const cut = bytes.indexOf(0xC3) + 1; // after the first of é's two bytes (C3 A9)
  assert.ok(cut > 0);
  const { body } = chunked([bytes.slice(0, cut), bytes.slice(cut)]);
  const req = new Request(`${ORIGIN}/api/journal/sync`, { method: 'POST', headers: { origin: ORIGIN, cookie: `__Host-tao_s=${token}` }, body, duplex: 'half' });
  const res = await handleApi(req, env, { lib, now: T0 });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).journal.entries.map((e) => e.text), ['é under water']);
});

test('a login whose counter does not move past the stored one starts no session; counter-0 passkeys still sign in', async () => {
  const { call, signUp, lib, env, tokenOf } = setup();
  const { id } = await signUp('cred-c');
  // The stub does not check counters, as if each login had read the stored counter before the other wrote it.
  const login = async (counter) => {
    lib.nextCounter = counter;
    const o = await call('POST', '/api/auth/login/options', {});
    return call('POST', '/api/auth/login/verify', { challengeId: o.body.challengeId, response: { id: 'cred-c', ok: true, challenge: o.body.options.challenge, response: { userHandle: id } } });
  };
  const sessions = () => env.tao_sync.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  const stored = () => env.tao_sync.raw.prepare('SELECT counter FROM credentials').get().counter;
  for (let i = 0; i < 2; i++) assert.equal((await login(0)).status, 200, 'a passkey that always sends 0');
  assert.equal((await login(7)).status, 200);
  assert.equal(stored(), 7);
  const before = sessions();
  for (const c of [6, 7, 0]) {
    const r = await login(c);
    assert.deepEqual([r.status, r.body, tokenOf(r)], [400, { error: 'verify' }, undefined], `counter ${c} after 7`);
  }
  assert.equal(sessions(), before, 'no session for a counter that did not advance');
  assert.equal(stored(), 7);
  assert.equal((await login(8)).status, 200);
  assert.equal(stored(), 8);
});

const LIMITS = [['AUTH_LIMIT', '/api/auth/login/options'], ['SIGNUP_LIMIT', '/api/auth/register/options'], ['SYNC_LIMIT', '/api/journal/sync']];

test('a missing rate-limit binding answers 503, except on localhost', async () => {
  for (const [name, path] of LIMITS) {
    const { call, env, lib, signUp } = setup();
    const { token, id } = await signUp();
    const before = lib.calls.regOpts.length + lib.calls.authOpts.length;
    delete env[name];
    const r = await call('POST', path, path === '/api/journal/sync' ? { account: id, journal: emptyJournal() } : {}, { cookie: token });
    assert.deepEqual([r.status, r.body], [503, { error: 'unavailable' }], name);
    assert.equal(lib.calls.regOpts.length + lib.calls.authOpts.length, before, name);
  }
  {
    const { call, env, signUp } = setup();
    const who = await signUp();
    delete env.SYNC_LIMIT;
    assert.equal((await call('DELETE', '/api/account', { account: who.id }, { cookie: who.token })).status, 503, 'delete too');
    delete env.AUTH_LIMIT;
    assert.equal((await call('GET', '/api/session')).status, 200); // a read has no limit
    assert.equal((await call('POST', '/api/auth/logout', {})).status, 200); // nor does signing out
  }
  const dev = 'http://localhost:8787';
  const { call, env, signUp } = setup({ RP_ID: 'localhost', ORIGIN: dev, origin: dev });
  for (const [name] of LIMITS) delete env[name];
  const who = await signUp();
  assert.equal(who.res.status, 200);
  assert.equal((await call('POST', '/api/auth/login/options', {})).status, 200);
  assert.equal((await call('POST', '/api/journal/sync', { account: who.id, journal: emptyJournal() }, { cookie: who.token })).status, 200);
});

test('delete account shares the sync rate limit', async () => {
  const { call, signUp, env } = setup();
  const who = await signUp();
  env.SYNC_LIMIT = { limit: async () => ({ success: false }) };
  const r = await call('DELETE', '/api/account', { account: who.id }, { cookie: who.token });
  assert.deepEqual([r.status, r.body], [429, { error: 'slow-down' }]);
  const count = (sql) => env.tao_sync.raw.prepare(sql).get(who.id).n;
  assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM journals WHERE user_id = ?'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?'), 1);
});

test('a sync that names another account takes nothing (409); no account named is still accepted', async () => {
  const { call, signUp, env } = setup();
  const a = await signUp('cred-a');
  const b = await signUp('cred-b');
  const mine = emptyJournal();
  addEntry(mine, { passage: 1, text: 'A only' }, '2026-11-25T10:00:00.000Z');
  const stored = (id) => env.tao_sync.raw.prepare('SELECT data, rev FROM journals WHERE user_id = ?').get(id);
  // Another tab signed in to B, so this tab's request for A goes out with B's cookie.
  const r = await call('POST', '/api/journal/sync', { account: a.id, journal: mine }, { cookie: b.token });
  assert.deepEqual([r.status, r.body], [409, { error: 'account-changed' }]);
  assert.equal(stored(b.id).rev, 0, "B's journal is untouched");
  assert.ok(!stored(b.id).data.includes('A only'));
  // An old installed client sends no account: still accepted.
  assert.equal((await call('POST', '/api/journal/sync', { journal: mine }, { cookie: a.token })).status, 200);
  assert.ok(stored(a.id).data.includes('A only'));
  assert.equal((await call('POST', '/api/journal/sync', { account: a.id, journal: mine }, { cookie: a.token })).status, 200);
  assert.equal((await call('POST', '/api/journal/sync', '[1]', { cookie: a.token })).status, 400);
});

test('delete that names another account deletes nothing; no body still deletes', async () => {
  const { call, signUp, env } = setup();
  const a = await signUp('cred-a');
  const b = await signUp('cred-b');
  const c = await signUp('cred-c');
  const rows = (id) => env.tao_sync.raw.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(id).n
    + env.tao_sync.raw.prepare('SELECT COUNT(*) AS n FROM journals WHERE user_id = ?').get(id).n;
  const r = await call('DELETE', '/api/account', { account: a.id }, { cookie: b.token }); // the confirm showed A; the cookie is B's now
  assert.deepEqual([r.status, r.body], [409, { error: 'account-changed' }]);
  assert.deepEqual([rows(a.id), rows(b.id)], [2, 2], 'both accounts are whole');
  assert.equal((await call('DELETE', '/api/account', { account: b.id }, { cookie: b.token })).status, 200);
  assert.deepEqual([rows(a.id), rows(b.id)], [2, 0]);
  // An old installed client sends DELETE with no body: still accepted.
  assert.equal((await call('DELETE', '/api/account', undefined, { cookie: c.token })).status, 200);
  assert.equal(rows(c.id), 0);
});

// ---- Delete is tied to the server revision; only an empty body is the legacy request ----

test('delete with the confirmed rev deletes; a newer rev is 409 changed and deletes nothing', async () => {
  const { call, signUp, env } = setup();
  const a = await signUp('cred-a');
  const rows = (id) => ['users WHERE id', 'journals WHERE user_id', 'sessions WHERE user_id', 'credentials WHERE user_id']
    .map((t) => env.tao_sync.raw.prepare(`SELECT COUNT(*) AS n FROM ${t} = ?`).get(id).n);
  const mine = emptyJournal();
  addEntry(mine, { passage: 1, text: 'first' }, '2026-11-25T10:00:00.000Z');
  const s1 = await call('POST', '/api/journal/sync', { account: a.id, journal: mine }, { cookie: a.token });
  assert.equal(s1.body.rev, 1);
  // Another device uploads rev 2 after this device's final sync.
  const other = emptyJournal();
  addEntry(other, { passage: 2, text: 'from the other device' }, '2026-11-25T10:00:01.000Z');
  assert.equal((await call('POST', '/api/journal/sync', { account: a.id, journal: other }, { cookie: a.token })).body.rev, 2);
  const r = await call('DELETE', '/api/account', { account: a.id, rev: 1 }, { cookie: a.token });
  assert.deepEqual([r.status, r.body], [409, { error: 'changed' }]);
  assert.deepEqual(rows(a.id), [1, 1, 1, 1], 'every row is still there');
  assert.equal((await call('DELETE', '/api/account', { account: a.id, rev: 2 }, { cookie: a.token })).status, 200);
  assert.deepEqual(rows(a.id), [0, 0, 0, 0]);
  // No rev (an old client): accepted.
  const b = await signUp('cred-b');
  assert.equal((await call('DELETE', '/api/account', { account: b.id }, { cookie: b.token })).status, 200);
  assert.deepEqual(rows(b.id), [0, 0, 0, 0]);
});

test('delete: a non-empty body that is not JSON is 400; over the cap is 413; an empty body still deletes', async () => {
  const { call, signUp, env } = setup();
  const a = await signUp('cred-a');
  const users = () => env.tao_sync.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const bad = await call('DELETE', '/api/account', '{not json', { cookie: a.token });
  assert.deepEqual([bad.status, bad.body], [400, { error: 'invalid' }]);
  const big = await call('DELETE', '/api/account', JSON.stringify({ account: a.id, pad: 'x'.repeat(600 * 1024) }), { cookie: a.token });
  assert.deepEqual([big.status, big.body], [413, { error: 'too-large' }]);
  assert.equal(users(), 1, 'nothing was deleted');
  assert.equal((await call('DELETE', '/api/account', '', { cookie: a.token })).status, 200);
  assert.equal(users(), 0);
});

test('non-GET routes answer 503 when RP_ID or ORIGIN is missing', async () => {
  for (const missing of ['RP_ID', 'ORIGIN']) {
    const env = { tao_sync: fakeD1(SCHEMA), RP_ID: 'tao.tensor.group', ORIGIN, ...openLimits() };
    delete env[missing];
    const req = new Request(`${ORIGIN}/api/auth/login/options`, { method: 'POST', headers: { origin: ORIGIN }, body: '{}' });
    const res = await handleApi(req, env, { lib: stubLib() });
    assert.equal(res.status, 503, missing);
    assert.deepEqual(await res.json(), { error: 'unavailable' });
  }
});
