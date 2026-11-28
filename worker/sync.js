// Optional journal sync: passkey sign-in and one merged journal per account.
// Routes: /api/auth/*, /api/session, /api/journal/sync, /api/account.
// The server merges with the same merge() the browser uses, so a sync never drops
// an entry that only one side has.
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { readCapped } from './body.js';
import { validate, merge, syncCore, sameCore, emptyJournal } from '../app/js/journal.js';

const DAY = 86400000;
const COOKIE = '__Host-tao_s';
const SESSION_DAYS = 400;
const CHALLENGE_MS = 5 * 60000;
const MAX_BODY = 512 * 1024;
const SIGNUPS_PER_DAY = 300;
const RP_NAME = 'Tao Te Ching · Tao of Power';

const LIB = { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse };

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const randomId = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(s) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}
const err = (status, error) => json({ error }, status);

function label(now) {
  const d = new Date(now);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `Tao journal · ${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`;
}

const setCookie = (token) => `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;
const clearCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

function readCookie(request) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

/** Same-site writes only: Origin must be ours, or (no Origin) the browser says same-origin. */
function sameOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (origin) return origin === env.ORIGIN;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

/**
 * The refusal when this client is over a per-IP limit, else null. A missing binding fails closed (503),
 * so a deploy that loses its limits cannot take sign-ups and syncs without them; only on localhost
 * (`npm run dev`, RP_ID "localhost") may a request go on without one.
 */
async function overLimit(binding, request, env) {
  if (!binding?.limit) return env.RP_ID === 'localhost' ? null : err(503, 'unavailable');
  const key = request.headers.get('cf-connecting-ip') || 'unknown'; // used for the count only, never stored
  const { success } = await binding.limit({ key });
  return success ? null : err(429, 'slow-down');
}

async function startSession(db, userId, now) {
  const token = randomId();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires, refreshed) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now + SESSION_DAYS * DAY, now).run();
  return setCookie(token);
}

/** The signed-in account, or null. Slides the expiry at most once a day. */
async function currentUser(request, db, now) {
  const token = readCookie(request);
  if (!token) return null;
  const hash = await sha256(token);
  const row = await db.prepare(
    'SELECT s.user_id AS id, s.refreshed AS refreshed, u.label AS label FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?',
  ).bind(hash, now).first();
  if (!row) return null;
  let cookie = null;
  if (now - row.refreshed > DAY) {
    await db.prepare('UPDATE sessions SET expires = ?, refreshed = ? WHERE token_hash = ?').bind(now + SESSION_DAYS * DAY, now, hash).run();
    cookie = setCookie(token);
  }
  return { id: row.id, label: row.label, cookie, hash };
}

async function sweep(db, now) {
  await db.batch([
    db.prepare('DELETE FROM challenges WHERE expires < ?').bind(now),
    db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
  ]);
}

async function takeChallenge(db, id, kind, now) {
  if (typeof id !== 'string') return null;
  const row = await db.prepare('DELETE FROM challenges WHERE id = ? RETURNING challenge, kind, user_id, label, expires').bind(id).first();
  if (!row || row.kind !== kind || row.expires < now) return null;
  return row;
}

async function readJson(request) {
  const text = await readCapped(request, MAX_BODY);
  if (text === null) return { tooLarge: true };
  try { return { body: JSON.parse(text) }; } catch { return { body: null }; }
}

async function registerOptions(request, env, lib, now) {
  const db = env.tao_sync;
  await sweep(db, now);
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE created > ?').bind(now - DAY).first();
  if (n >= SIGNUPS_PER_DAY) return err(503, 'signups-full');
  const userBytes = crypto.getRandomValues(new Uint8Array(16));
  const name = label(now);
  const options = await lib.generateRegistrationOptions({
    rpName: RP_NAME, rpID: env.RP_ID, userID: userBytes, userName: name, userDisplayName: name,
    attestationType: 'none', supportedAlgorithmIDs: [-7, -257],
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
  });
  const challengeId = randomId(16);
  await db.prepare('INSERT INTO challenges (id, challenge, kind, user_id, label, expires) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(challengeId, options.challenge, 'reg', b64url(userBytes), name, now + CHALLENGE_MS).run();
  return json({ challengeId, options });
}

async function registerVerify(request, env, lib, now) {
  const db = env.tao_sync;
  const { body } = await readJson(request);
  const ch = await takeChallenge(db, body?.challengeId, 'reg', now);
  if (!ch) return err(400, 'challenge');
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE created > ?').bind(now - DAY).first();
  if (n >= SIGNUPS_PER_DAY) return err(503, 'signups-full'); // again here: options fetched early must not pass the cap
  let info;
  try {
    const r = await lib.verifyRegistrationResponse({
      response: body.response, expectedChallenge: ch.challenge, expectedOrigin: env.ORIGIN, expectedRPID: env.RP_ID,
      requireUserVerification: true, supportedAlgorithmIDs: [-7, -257],
    });
    if (!r.verified) return err(400, 'verify');
    info = r.registrationInfo;
  } catch { return err(400, 'verify'); }
  const { credential } = info;
  const empty = JSON.stringify(syncCore(emptyJournal()));
  await db.batch([
    db.prepare('INSERT INTO users (id, label, created) VALUES (?, ?, ?)').bind(ch.user_id, ch.label, now),
    db.prepare('INSERT INTO credentials (id, user_id, public_key, counter, created) VALUES (?, ?, ?, ?, ?)')
      .bind(credential.id, ch.user_id, b64url(credential.publicKey), credential.counter || 0, now),
    db.prepare('INSERT INTO journals (user_id, data, rev, updated) VALUES (?, ?, 0, ?)').bind(ch.user_id, empty, now),
  ]);
  const cookie = await startSession(db, ch.user_id, now);
  return json({ account: { id: ch.user_id, label: ch.label } }, 200, { 'set-cookie': cookie });
}

async function loginOptions(request, env, lib, now) {
  const db = env.tao_sync;
  await sweep(db, now);
  const options = await lib.generateAuthenticationOptions({ rpID: env.RP_ID, userVerification: 'required', allowCredentials: [] });
  const challengeId = randomId(16);
  await db.prepare('INSERT INTO challenges (id, challenge, kind, user_id, label, expires) VALUES (?, ?, ?, NULL, NULL, ?)')
    .bind(challengeId, options.challenge, 'auth', now + CHALLENGE_MS).run();
  return json({ challengeId, options });
}

async function loginVerify(request, env, lib, now) {
  const db = env.tao_sync;
  const { body } = await readJson(request);
  const ch = await takeChallenge(db, body?.challengeId, 'auth', now);
  if (!ch) return err(400, 'challenge');
  const credId = body?.response?.id;
  if (typeof credId !== 'string') return err(400, 'verify');
  const cred = await db.prepare(
    'SELECT c.id, c.user_id, c.public_key, c.counter, u.label FROM credentials c JOIN users u ON u.id = c.user_id WHERE c.id = ?',
  ).bind(credId).first();
  if (!cred) return err(404, 'unknown-passkey');
  const handle = body.response.response?.userHandle;
  if (handle && handle !== cred.user_id) return err(400, 'verify');
  let newCounter;
  try {
    const r = await lib.verifyAuthenticationResponse({
      response: body.response, expectedChallenge: ch.challenge, expectedOrigin: env.ORIGIN, expectedRPID: env.RP_ID,
      credential: { id: cred.id, publicKey: unb64url(cred.public_key), counter: cred.counter }, requireUserVerification: true,
    });
    if (!r.verified) return err(400, 'verify');
    newCounter = r.authenticationInfo.newCounter;
  } catch { return err(400, 'verify'); }
  // A counter must move up. Two logins can check against the same stored counter; only the one that still
  // raises it here gets a session. A passkey that always sends 0 (many do) has nothing to raise.
  const next = newCounter || 0;
  if (next > 0 || cred.counter > 0) {
    const res = await db.prepare('UPDATE credentials SET counter = ? WHERE id = ? AND counter < ?').bind(next, cred.id, next).run();
    if (res.meta?.changes !== 1) return err(400, 'verify');
  }
  const cookie = await startSession(db, cred.user_id, now);
  return json({ account: { id: cred.user_id, label: cred.label } }, 200, { 'set-cookie': cookie });
}

async function sync(request, env, user, now) {
  const db = env.tao_sync;
  const { body, tooLarge } = await readJson(request);
  if (tooLarge) return err(413, 'too-large');
  if (!body || typeof body !== 'object') return err(400, 'invalid');
  // The client names the account it sent this journal for. When another tab signed in to another account,
  // the cookie is that account's: its journal must not take this one. An old installed client names no
  // account; it is still accepted until those clients have updated.
  if (body.account !== undefined && body.account !== user.id) return err(409, 'account-changed');
  const r = validate(body.journal);
  if (!r.ok) return err(400, 'invalid');
  const incoming = r.journal;
  // Only for a live account: a sync racing an account delete must not re-create the row.
  await db.prepare('INSERT OR IGNORE INTO journals (user_id, data, rev, updated) SELECT ?, ?, 0, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)')
    .bind(user.id, JSON.stringify(syncCore(emptyJournal())), now, user.id).run();
  for (let i = 0; i < 3; i++) {
    const row = await db.prepare('SELECT data, rev FROM journals WHERE user_id = ?').bind(user.id).first();
    if (!row) return err(401, 'signed-out');
    const stored = validate(JSON.parse(row.data));
    const base = stored.ok ? stored.journal : emptyJournal();
    const merged = syncCore(merge(base, incoming));
    if (sameCore(merged, base)) return json({ journal: syncCore(base), rev: row.rev });
    const data = JSON.stringify(merged);
    if (enc.encode(data).length > MAX_BODY) return err(413, 'too-large');
    const res = await db.prepare('UPDATE journals SET data = ?, rev = rev + 1, updated = ? WHERE user_id = ? AND rev = ?')
      .bind(data, now, user.id, row.rev).run();
    if (res.meta?.changes === 1) return json({ journal: merged, rev: row.rev + 1 });
  }
  return err(409, 'busy');
}

async function deleteAccount(request, env, user) {
  const db = env.tao_sync;
  // Only an empty body is the old installed client's request (no account, no rev); it is still accepted.
  // A body that is there must be valid JSON under the cap.
  const text = await readCapped(request, MAX_BODY);
  if (text === null) return err(413, 'too-large');
  let body = null;
  if (text !== '') {
    try { body = JSON.parse(text); } catch { return err(400, 'invalid'); }
    if (!body || typeof body !== 'object') return err(400, 'invalid');
  }
  // The client names the account the reader confirmed; a session switched since (in another tab) is not deleted.
  if (body?.account !== undefined && body.account !== user.id) return err(409, 'account-changed');
  // The client names the rev of the server copy it last confirmed it holds. Another device can upload a newer
  // rev after that; then nothing is deleted. Every statement checks the rev in the same batch, and the journal
  // row goes last, so the check sees the row until the end.
  if (typeof body?.rev === 'number') {
    const guard = 'EXISTS (SELECT 1 FROM journals WHERE user_id = ? AND rev = ?)';
    const out = await db.batch([
      db.prepare(`DELETE FROM sessions WHERE user_id = ? AND ${guard}`).bind(user.id, user.id, body.rev),
      db.prepare(`DELETE FROM credentials WHERE user_id = ? AND ${guard}`).bind(user.id, user.id, body.rev),
      db.prepare(`DELETE FROM users WHERE id = ? AND ${guard}`).bind(user.id, user.id, body.rev),
      db.prepare('DELETE FROM journals WHERE user_id = ? AND rev = ?').bind(user.id, body.rev),
    ]);
    if (out[3]?.meta?.changes !== 1) return err(409, 'changed');
    return json({ ok: true }, 200, { 'set-cookie': clearCookie });
  }
  await db.batch([
    db.prepare('DELETE FROM journals WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM credentials WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return json({ ok: true }, 200, { 'set-cookie': clearCookie });
}

/** Answers a sync route, or returns null when the path is not one. */
export async function handleApi(request, env, { lib = LIB, now = Date.now() } = {}) {
  const { pathname } = new URL(request.url);
  const route = `${request.method} ${pathname}`;
  const routes = new Set([
    'POST /api/auth/register/options', 'POST /api/auth/register/verify', 'POST /api/auth/login/options',
    'POST /api/auth/login/verify', 'POST /api/auth/logout', 'GET /api/session', 'POST /api/journal/sync', 'DELETE /api/account',
  ]);
  if (!routes.has(route)) return pathname.startsWith('/api/') ? err(404, 'not-found') : null;
  if (!env.tao_sync) return err(503, 'unavailable');
  // Without these two vars no passkey can be checked and no Origin can be compared: refuse every write.
  if (request.method !== 'GET' && (!env.RP_ID || !env.ORIGIN)) return err(503, 'unavailable');
  if (request.method !== 'GET' && !sameOrigin(request, env)) return err(403, 'origin');
  try {
    if (pathname.startsWith('/api/auth/') && pathname !== '/api/auth/logout') {
      const refused = await overLimit(env.AUTH_LIMIT, request, env);
      if (refused) return refused;
    }
    switch (route) {
      case 'POST /api/auth/register/options':
        return (await overLimit(env.SIGNUP_LIMIT, request, env)) || await registerOptions(request, env, lib, now);
      case 'POST /api/auth/register/verify': return await registerVerify(request, env, lib, now);
      case 'POST /api/auth/login/options': return await loginOptions(request, env, lib, now);
      case 'POST /api/auth/login/verify': return await loginVerify(request, env, lib, now);
      default: break;
    }
    const user = await currentUser(request, env.tao_sync, now);
    const withCookie = (res) => { if (user?.cookie && !res.headers.has('set-cookie')) res.headers.set('set-cookie', user.cookie); return res; };
    if (route === 'GET /api/session') return withCookie(json({ account: user ? { id: user.id, label: user.label } : null }));
    if (route === 'POST /api/auth/logout') {
      if (user) await env.tao_sync.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.hash).run();
      return json({ ok: true }, 200, { 'set-cookie': clearCookie });
    }
    if (!user) return json({ error: 'signed-out' }, 401, { 'set-cookie': clearCookie });
    if (route === 'POST /api/journal/sync') return (await overLimit(env.SYNC_LIMIT, request, env)) || withCookie(await sync(request, env, user, now));
    return (await overLimit(env.SYNC_LIMIT, request, env)) || await deleteAccount(request, env, user);
  } catch {
    return err(500, 'server'); // never echo the body: it may hold journal text
  }
}
