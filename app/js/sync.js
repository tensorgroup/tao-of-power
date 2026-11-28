// Optional journal sync with a passkey. Off until the reader turns it on.
// The server merges; this module sends the journal, merges the answer into the
// current journal (so a save made during the request is kept), and runs again.
// Each request names the account it is for: the Worker refuses it under another account's session, and
// the answer is used only while this browser is still signed in to that account (tabs share one sign-in).
import { merge, syncCore, sameCore, emptyJournal, load } from './journal.js';

export const REC = 'tao.sync';               // { account, label, at, error } while signed in
export const LAST = 'tao.sync.last';         // the account whose journal this browser holds (kept after sign-out and delete)
export const DISMISSED = 'tao.sync.dismissed';
export const WIPED = 'tao.sync.wiped';       // a new value at each "Remove it from this browser": other tabs clear their pages
const KEEPALIVE_MAX = 60000;                 // browsers cap keepalive bodies at 64 KB

const ENDED = 'Your sync session ended, so nothing was deleted. Sign in again, then delete.';
const SWITCHED = 'The sync account changed in another tab, so nothing was deleted.';
const NOT_DELETED = 'The server could not delete the synced copy. Try again later.';
const NEWER = 'Something new reached the synced copy, so nothing was deleted. Try again.';
const NOT_SAVED = 'This browser could not save the synced copy, so nothing was deleted. Free some storage, or Export first.';
const NOT_REMOVED = 'This browser could not remove the journal. Nothing changed.';
const ENDED_OUT = 'Your sync session ended in another tab, so nothing changed.';
const SWITCHED_OUT = 'The sync account changed in another tab, so nothing changed.';
const LOCK = 'tao-sync-account'; // one sign-out or delete at a time, across this browser's tabs

const get = (storage, k) => { try { return storage.getItem(k); } catch { return null; } };
const put = (storage, k, v) => { try { if (v == null) storage.removeItem(k); else storage.setItem(k, v); } catch {} };

/** Testable core: every browser API is passed in. */
export const PENDING_LOGOUT = 'tao.sync.logout'; // a sign-out the server has not confirmed yet

const bytes = (s) => new TextEncoder().encode(s).length;

/** True when journal `a` holds everything in `b` (b adds nothing to a). */
const covers = (a, b) => sameCore(merge(a, b), merge(a, emptyJournal()));

/**
 * Testable core: every browser API is passed in. `wipe()` removes local extras (snapshot, drafts).
 * `setJournal(j, { replace })` saves j and returns false when it could not.
 */
export function makeSyncer({ fetch, getJournal, setJournal, snapshot = () => true, wipe = () => {}, storage, now = () => Date.now(), onChange = () => {}, locks = null }) {
  const record = () => { try { return JSON.parse(get(storage, REC) || 'null'); } catch { return null; } };
  const setRecord = (r) => put(storage, REC, r ? JSON.stringify(r) : null);
  const accountNow = () => record()?.account ?? null;
  let running = null;
  let again = null;
  let confirmed = null; // { account, journal, rev }: the server's copy in the last answer; the server holds all of it
  let lastStatus = null; // the HTTP status of the last sync request (0: no answer)

  // Runs fn while no other tab of this browser runs a sign-out or a delete (navigator.locks). Without locks
  // (old browsers, tests), fn runs at once.
  const exclusive = (fn) => (locks?.request ? locks.request(LOCK, fn) : fn());
  // After an await: true when this browser is still signed in to `account`, or to none.
  const stillOrNone = (account) => { const a = accountNow(); return a === null || a === account; };

  async function api(method, path, body, extra = {}) {
    return fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      ...extra,
    });
  }

  /** End the server session. Until the server confirms, remember to retry. */
  async function logout() {
    put(storage, PENDING_LOGOUT, '1');
    try {
      const res = await api('POST', '/api/auth/logout', {});
      if (res.ok) put(storage, PENDING_LOGOUT, null);
    } catch { /* retried by check() */ }
  }

  /**
   * One request, for the account signed in when it starts. True when the server copy now holds everything this
   * device had, and this device saved what the answer brought.
   */
  async function once({ keepalive = false } = {}) {
    const r = record();
    if (!r) return false;
    const { account } = r;
    const body = JSON.stringify({ account, journal: syncCore(getJournal()) });
    const sent = JSON.parse(body).journal; // a copy: saves during the request must not change it
    let res;
    lastStatus = 0;
    try {
      res = await api('POST', '/api/journal/sync', body, { keepalive: keepalive && bytes(body) < KEEPALIVE_MAX });
    } catch { return false; } // offline: the next trigger retries
    lastStatus = res.status;
    // Another tab may have signed out, or in to another account, while this request was out: then its answer
    // (even a 401) is not news about the account signed in now.
    const still = () => accountNow() === account;
    if (res.status === 401) { if (still()) { setRecord(null); onChange({ signedOut: true, expired: true }); } return false; }
    if (res.status === 413) { if (still()) { setRecord({ ...record(), error: 'too-large' }); onChange({ status: true }); } return false; }
    if (!res.ok) return false; // 409 busy or account-changed, 429, 5xx: nothing merged; the next trigger retries
    let remote, rev;
    try { ({ journal: remote, rev } = await res.json()); } catch { return false; }
    if (!still()) return false; // signed out, or another account now: drop the answer
    confirmed = { account, journal: remote, rev };
    const cur = getJournal(); // read after the wait: keeps anything saved meanwhile
    const merged = merge(cur, remote);
    const changed = !sameCore(merged, cur);
    const saved = !changed || setJournal(merged) !== false; // false: storage full, so the answer lives in memory only
    setRecord({ ...record(), at: now(), error: null });
    onChange({ changed, status: true });
    return saved && sameCore(merge(remote, sent), remote);
  }

  /** True when everything this browser holds (this tab's journal and the stored one) is in the server copy of the last answer. */
  function heldOnServer() {
    if (!confirmed || confirmed.account !== accountNow()) return false;
    const held = merge(getJournal(), load(storage));
    return sameCore(merge(confirmed.journal, held), confirmed.journal);
  }

  /** One sync at a time; a call during a run queues exactly one more run. Resolves true when the last run reached the server. */
  function syncNow(opts = {}) {
    if (!record()) return Promise.resolve(false);
    if (running) { again = { keepalive: !!(opts.keepalive || again?.keepalive) }; return running; }
    running = (async () => {
      let ok = false;
      try {
        let next = opts;
        do { again = null; ok = await once(next); next = again || {}; } while (again);
      } finally { running = null; }
      return ok;
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
      if (choice === 'cancel') { await logout(); return false; }
      if (choice === 'replace') {
        if (!snapshot(j)) { await logout(); throw new Error('Could not keep a copy of this browser’s journal (storage full). Export it first.'); }
        setJournal({ ...emptyJournal(), lastExportAt: j.lastExportAt ?? null }, { replace: true });
      }
    }
    put(storage, PENDING_LOGOUT, null);
    put(storage, LAST, account.id);
    setRecord({ account: account.id, label: account.label, at: null, error: null });
    onChange({ status: true });
    await syncNow();
    return true;
  }

  /** On app start: trust the server's session, not localStorage alone. */
  async function check() {
    if (get(storage, PENDING_LOGOUT)) {
      // A sign-out that did not reach the server: finish it, never resume that session.
      await logout();
      if (record()) { setRecord(null); onChange({ signedOut: true }); }
      return;
    }
    let res;
    try { res = await api('GET', '/api/session'); } catch { return; }
    if (!res.ok) return;
    let account = null;
    try { ({ account } = await res.json()); } catch { return; }
    const r = record();
    if (!account) { if (r) { setRecord(null); onChange({ signedOut: true, expired: true }); } return; }
    if (!r || r.account !== account.id) {
      // A session this browser's storage forgot (e.g. an installed iPhone app copies
      // cookies, not localStorage). Resume it, unless this browser holds another
      // account's journal: then sign out, and the reader decides at the next sign-in.
      const last = get(storage, LAST);
      const j = getJournal();
      if (last && last !== account.id && (j.entries.length || j.draws.length)) {
        await logout();
        setRecord(null);
        onChange({ signedOut: true });
        return;
      }
      await adopt(account);
      return;
    }
    await syncNow();
  }

  /**
   * Sign out of `account`, the account the page showed. With `clearLocal` ("Remove it from this browser"), the
   * journal leaves this browser only after the server confirms it holds everything this browser holds, also
   * what another tab saved since; otherwise this throws and nothing changes. Then WIPED gets a new value, so
   * other tabs rebuild their pages (onWipedElsewhere), and onChange gets `wiped`, so this tab does too.
   * Runs under the account lock, so a delete in another tab cannot run at the same time.
   * The lock does not cover ordinary saves in another tab (state.persist): a save in the milliseconds between
   * the last check and the wipe is an accepted race.
   */
  function signOut({ clearLocal = false, account = accountNow() } = {}) {
    return exclusive(async () => {
      // Checked again inside the lock: another tab may have signed out, or in to another account, meanwhile.
      if (accountNow() !== account) throw new Error(account && !record() ? ENDED_OUT : SWITCHED_OUT);
      if (clearLocal) {
        if (!(await syncNow())) {
          throw new Error('Could not reach the server, so the journal stays in this browser. Try again online, or Export first.');
        }
        if (accountNow() !== account) throw new Error(SWITCHED_OUT);
        if (!heldOnServer()) throw new Error('Something new was saved in another tab, so the journal stays in this browser. Try again.');
        // Save the empty journal first: when storage refuses it, nothing has changed yet.
        if (setJournal(emptyJournal(), { replace: true }) === false) throw new Error(NOT_REMOVED);
        setRecord(null); // no tab starts a sync from here on
        wipe();
        put(storage, WIPED, `${now()}.${Math.random().toString(36).slice(2)}`);
        onChange({ signedOut: true, changed: true, wiped: true }); // before the logout wait: no editor here saves meanwhile
        await logout();
        return;
      }
      await logout();
      // A late answer: another tab may have signed in to another account meanwhile. Leave that one alone.
      if (!stillOrNone(account)) return;
      setRecord(null);
      onChange({ signedOut: true });
    });
  }

  /** The last answer pulled with an empty journal: for a journal too large to upload (413). True when it arrived. */
  async function pull(account) {
    let res;
    try { res = await api('POST', '/api/journal/sync', { account, journal: syncCore(emptyJournal()) }); } catch { return false; }
    if (res.status === 401) { if (accountNow() === account) { setRecord(null); onChange({ signedOut: true, expired: true }); } return false; }
    if (!res.ok) return false;
    let remote, rev;
    try { ({ journal: remote, rev } = await res.json()); } catch { return false; }
    if (accountNow() !== account) return false;
    confirmed = { account, journal: remote, rev };
    const cur = getJournal();
    const merged = merge(cur, remote);
    if (!sameCore(merged, cur)) setJournal(merged);
    onChange({ changed: !sameCore(merged, cur), status: true });
    return true;
  }

  /**
   * "Delete synced copy" of `account`, the account the page showed. A final sync brings entries from other
   * devices here first (for a journal too large to upload, a pull only). The server copy is deleted only when
   * this browser's STORAGE holds everything in that answer, and only while the server still has that answer's
   * rev (another device may upload after it). LAST stays: the journal here was that account's, so a later
   * sign-in to another account asks first (merge or keep apart). Runs under the account lock.
   */
  function deleteAccount({ account = accountNow() } = {}) {
    return exclusive(async () => {
      if (!account || accountNow() !== account) throw new Error(record() ? SWITCHED : ENDED);
      if (!(await syncNow())) {
        if (accountNow() !== account) throw new Error(record() ? SWITCHED : ENDED);
        const pulled = lastStatus === 413 && (await pull(account));
        if (!pulled) {
          if (accountNow() !== account) throw new Error(record() ? SWITCHED : ENDED);
          throw new Error('Could not sync first, so nothing was deleted. Try again online, or Export first.');
        }
      }
      if (!confirmed || confirmed.account !== account || accountNow() !== account) throw new Error(record() ? SWITCHED : ENDED);
      const { journal: remote, rev } = confirmed;
      // Memory may hold the answer while storage does not (a save failed on an earlier try): save it again.
      if (!covers(load(storage), remote)) setJournal(merge(getJournal(), remote));
      if (!covers(load(storage), remote)) throw new Error(NOT_SAVED);
      let res;
      const body = typeof rev === 'number' ? { account, rev } : { account };
      try { res = await api('DELETE', '/api/account', body); } catch { throw new Error(NOT_DELETED); } // offline: not "Failed to fetch"
      if (res.status === 401) {
        if (accountNow() === account) { setRecord(null); onChange({ signedOut: true }); }
        throw new Error(ENDED);
      }
      if (res.status === 409) {
        let error = null;
        try { ({ error } = await res.json()); } catch {}
        throw new Error(error === 'changed' ? NEWER : SWITCHED);
      }
      if (!res.ok) throw new Error(NOT_DELETED);
      if (!stillOrNone(account)) return; // another tab signed in to another account meanwhile: leave it alone
      setRecord(null);
      onChange({ signedOut: true });
    });
  }

  /** fn() runs in this tab when another tab removed the journal from this browser (signOut with clearLocal). */
  function onWipedElsewhere(fn, target = globalThis) {
    target.addEventListener?.('storage', (e) => { if (e.key === WIPED && e.newValue) fn(); });
  }

  return { record, syncNow, adopt, check, signOut, deleteAccount, onWipedElsewhere, api };
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

/**
 * Use an existing passkey. Returns { ok, message, none }. `none` means no passkey
 * was chosen: the reader closed the sheet.
 */
export async function signIn(syncer, { onSwitch } = {}) {
  const o = await post(syncer, '/api/auth/login/options', {});
  if (!o.res.ok) return { ok: false, message: SERVER_MSG[o.data.error] || 'Sync is not available right now.' };
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: requestOptions(o.data.options) });
  } catch (e) {
    const message = ceremonyError(e);
    return { ok: false, message, none: message === null };
  }
  if (!cred) return { ok: false, message: null, none: true };
  const v = await post(syncer, '/api/auth/login/verify', { challengeId: o.data.challengeId, response: authJSON(cred) });
  if (!v.res.ok) {
    return { ok: false, message: SERVER_MSG[v.data.error] || 'The passkey could not be checked. Try again.', none: v.data.error === 'unknown-passkey' };
  }
  return { ok: await syncer.adopt(v.data.account, { onSwitch }) };
}
