// Optional journal sync with a passkey. Off until the reader turns it on.
// The server merges; this module sends the journal, merges the answer into the
// current journal (so a save made during the request is kept), and runs again.
import { merge, syncCore, sameCore, emptyJournal } from './journal.js';

export const REC = 'tao.sync';               // { account, label, at, error } while signed in
export const LAST = 'tao.sync.last';         // the account this browser last synced with (kept after sign-out)
export const DISMISSED = 'tao.sync.dismissed';
const KEEPALIVE_MAX = 60000;                 // browsers cap keepalive bodies at 64 KB

const get = (storage, k) => { try { return storage.getItem(k); } catch { return null; } };
const put = (storage, k, v) => { try { if (v == null) storage.removeItem(k); else storage.setItem(k, v); } catch {} };

/** Testable core: every browser API is passed in. */
export function makeSyncer({ fetch, getJournal, setJournal, snapshot = () => true, storage, now = () => Date.now(), onChange = () => {} }) {
  const record = () => { try { return JSON.parse(get(storage, REC) || 'null'); } catch { return null; } };
  const setRecord = (r) => put(storage, REC, r ? JSON.stringify(r) : null);
  let running = null;
  let again = false;

  async function api(method, path, body, extra = {}) {
    return fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      ...extra,
    });
  }

  async function once({ keepalive = false } = {}) {
    const r = record();
    if (!r) return;
    const body = JSON.stringify({ journal: syncCore(getJournal()) });
    let res;
    try {
      res = await api('POST', '/api/journal/sync', body, { keepalive: keepalive && body.length < KEEPALIVE_MAX });
    } catch { return; } // offline: the next trigger retries
    if (res.status === 401) { setRecord(null); onChange({ signedOut: true, expired: true }); return; }
    if (res.status === 413) { setRecord({ ...r, error: 'too-large' }); onChange({}); return; }
    if (!res.ok) return;
    let remote;
    try { ({ journal: remote } = await res.json()); } catch { return; }
    const cur = getJournal(); // read after the wait: keeps anything saved meanwhile
    const merged = merge(cur, remote);
    const changed = !sameCore(merged, cur);
    if (changed) setJournal(merged);
    if (record()) setRecord({ ...record(), at: now(), error: null });
    onChange({ changed });
  }

  /** One sync at a time; a call during a run queues exactly one more run. */
  function syncNow(opts) {
    if (!record()) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
      try {
        do { again = false; await once(opts); } while (again);
      } finally { running = null; }
    })();
    return running;
  }

  /**
   * Begin syncing as `account`. When this browser last synced with another
   * account and holds journal data, `onSwitch()` decides first:
   * 'merge' | 'replace' (local copy goes to the Replace snapshot) | 'cancel'.
   */
  async function adopt(account, { onSwitch = async () => 'merge' } = {}) {
    const last = get(storage, LAST);
    const j = getJournal();
    const hasLocal = j.entries.length > 0 || j.draws.length > 0;
    if (hasLocal && last && last !== account.id) {
      const choice = await onSwitch();
      if (choice === 'cancel') { await api('POST', '/api/auth/logout', {}).catch(() => {}); return false; }
      if (choice === 'replace') {
        if (!snapshot(j)) { await api('POST', '/api/auth/logout', {}).catch(() => {}); throw new Error('Could not keep a copy of this browser’s journal (storage full). Export it first.'); }
        setJournal({ ...emptyJournal(), lastExportAt: j.lastExportAt ?? null });
      }
    }
    put(storage, LAST, account.id);
    setRecord({ account: account.id, label: account.label, at: null, error: null });
    onChange({});
    await syncNow();
    return true;
  }

  /** On app start: trust the server's session, not localStorage alone. */
  async function check() {
    let res;
    try { res = await api('GET', '/api/session'); } catch { return; }
    if (!res.ok) return;
    let account = null;
    try { ({ account } = await res.json()); } catch { return; }
    const r = record();
    if (!account) { if (r) { setRecord(null); onChange({ signedOut: true, expired: true }); } return; }
    if (!r || r.account !== account.id) {
      // A session this browser's storage forgot (e.g. an installed iPhone app copies
      // cookies, not localStorage). Same account as last time: resume. Otherwise ask.
      await adopt(account);
      return;
    }
    await syncNow();
  }

  async function signOut({ clearLocal = false } = {}) {
    await syncNow();
    await api('POST', '/api/auth/logout', {}).catch(() => {});
    setRecord(null);
    if (clearLocal) setJournal(emptyJournal());
    onChange({ signedOut: true, changed: clearLocal });
  }

  async function deleteAccount() {
    const res = await api('DELETE', '/api/account');
    if (!res.ok && res.status !== 401) throw new Error('The server could not delete the synced copy. Try again later.');
    setRecord(null);
    onChange({ signedOut: true });
  }

  return { record, syncNow, adopt, check, signOut, deleteAccount, api };
}

// ---- Browser glue: WebAuthn ceremonies ------------------------------------

const toB64url = (buf) => {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

export const available = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials?.create && window.isSecureContext;

function creationOptions(o) {
  return {
    ...o,
    challenge: fromB64url(o.challenge),
    user: { ...o.user, id: fromB64url(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: fromB64url(c.id) })),
  };
}

function requestOptions(o) {
  return { ...o, challenge: fromB64url(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: fromB64url(c.id) })) };
}

function regJSON(c) {
  const r = c.response;
  return {
    id: c.id, rawId: toB64url(c.rawId), type: c.type,
    authenticatorAttachment: c.authenticatorAttachment ?? undefined,
    clientExtensionResults: c.getClientExtensionResults?.() || {},
    response: {
      clientDataJSON: toB64url(r.clientDataJSON), attestationObject: toB64url(r.attestationObject),
      transports: r.getTransports?.() || [],
    },
  };
}

function authJSON(c) {
  const r = c.response;
  return {
    id: c.id, rawId: toB64url(c.rawId), type: c.type,
    authenticatorAttachment: c.authenticatorAttachment ?? undefined,
    clientExtensionResults: c.getClientExtensionResults?.() || {},
    response: {
      clientDataJSON: toB64url(r.clientDataJSON), authenticatorData: toB64url(r.authenticatorData),
      signature: toB64url(r.signature), userHandle: r.userHandle ? toB64url(r.userHandle) : undefined,
    },
  };
}

/** A failed ceremony as a reader-facing message (null when the reader just cancelled). */
function ceremonyError(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return null;
  if (e?.name === 'InvalidStateError') return 'This device already has a passkey for this site. Use “Sign in with passkey”.';
  return e?.message || String(e);
}

async function post(syncer, path, body) {
  const res = await syncer.api('POST', path, body);
  let data = {};
  try { data = await res.json(); } catch {}
  return { res, data };
}

const SERVER_MSG = {
  'unknown-passkey': 'This passkey is not known here. Its synced copy may have been deleted. You can remove it from your passwords app.',
  'signups-full': 'Too many new accounts today. Please try again tomorrow.',
  'slow-down': 'Too many tries. Wait a minute and try again.',
};

/** Make a new passkey and account. Returns { ok, message }. */
export async function signUp(syncer, { onSwitch } = {}) {
  const o = await post(syncer, '/api/auth/register/options', {});
  if (!o.res.ok) return { ok: false, message: SERVER_MSG[o.data.error] || 'Sync is not available right now.' };
  let cred;
  try { cred = await navigator.credentials.create({ publicKey: creationOptions(o.data.options) }); } catch (e) { return { ok: false, message: ceremonyError(e) }; }
  const v = await post(syncer, '/api/auth/register/verify', { challengeId: o.data.challengeId, response: regJSON(cred) });
  if (!v.res.ok) return { ok: false, message: SERVER_MSG[v.data.error] || 'The passkey could not be checked. Try again.' };
  return { ok: await syncer.adopt(v.data.account, { onSwitch }) };
}

/** True when the browser can look for a passkey without showing any dialog. */
export async function canCheckSilently() {
  try { return (await PublicKeyCredential.getClientCapabilities?.())?.immediateGet === true; } catch { return false; }
}

/**
 * Use an existing passkey. Returns { ok, message, none }. `none` means no passkey
 * was chosen: the reader closed the sheet, or (with `immediate`) this device has none.
 */
export async function signIn(syncer, { onSwitch, immediate = false } = {}) {
  const o = await post(syncer, '/api/auth/login/options', {});
  if (!o.res.ok) return { ok: false, message: SERVER_MSG[o.data.error] || 'Sync is not available right now.' };
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: requestOptions(o.data.options), ...(immediate ? { mediation: 'immediate' } : {}) });
  } catch (e) {
    const message = ceremonyError(e);
    return { ok: false, message, none: message === null };
  }
  if (!cred) return { ok: false, message: null, none: true };
  const v = await post(syncer, '/api/auth/login/verify', { challengeId: o.data.challengeId, response: authJSON(cred) });
  if (!v.res.ok) {
    if (v.data.error === 'unknown-passkey') {
      PublicKeyCredential.signalUnknownCredential?.({ rpId: location.hostname, credentialId: cred.id }).catch?.(() => {});
    }
    return { ok: false, message: SERVER_MSG[v.data.error] || 'The passkey could not be checked. Try again.', none: v.data.error === 'unknown-passkey' };
  }
  return { ok: await syncer.adopt(v.data.account, { onSwitch }) };
}
