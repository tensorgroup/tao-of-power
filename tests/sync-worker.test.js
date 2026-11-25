import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../worker/sync.js';
import { fakeD1 } from './helpers/fake-d1.js';
import { emptyJournal, addEntry, recordDraw, deleteDraw } from '../app/js/journal.js';

const ORIGIN = 'https://tao.tensor.group';
const SCHEMA = new URL('../worker/sync-schema.sql', import.meta.url).pathname;
const T0 = Date.parse('2026-11-25T12:00:00Z');
const DAY = 86400000;

function stubLib() {
  const calls = { regOpts: [], authOpts: [], regVerify: [], authVerify: [] };
  let n = 0;
  return {
    calls,
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
      return { verified: true, authenticationInfo: { newCounter: 0 } };
    },
  };
}

function setup() {
  const env = { tao_sync: fakeD1(SCHEMA), RP_ID: 'tao.tensor.group', ORIGIN };
  const lib = stubLib();
  let now = T0;
  const call = async (method, path, body, { cookie, origin = ORIGIN, headers = {} } = {}) => {
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
    return { res: v, token: tokenOf(v) };
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
