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
const TOO_LARGE_OUT = 'The journal is too large to sync, so it stays in this browser. Export keeps a full copy.';
const NOT_CLEARED = 'This browser could not clear its journal (storage full), so sync did not start. Export it first.';
const NOT_SAVED_OUT = 'This browser could not save the synced copy, so the journal stays in this browser. Free some storage, or Export first.';
const LOCK = 'tao-sync-account'; // one sign-out or delete at a time, across this browser's tabs (Web Locks)
export const WIPING = 'tao.sync.wiping';     // `<ms>.<id>` while "Remove it from this browser" runs: writes wait
export const DELETING = 'tao.sync.deleting'; // `<ms>` while a DELETE /api/account is out: no sign-in verifies
export const LOGGING_OUT = 'tao.sync.logging-out'; // `<ms>.<id>` while a POST /api/auth/logout is out: no sign-in verifies
const FRESH_MS = 10000;                      // an older wiping marker is left by a tab that crashed: ignore it
const COOKIE_MS = 30000;                     // the same for the deleting and logging-out markers, and the most a sign-in waits
const WIPE_WAIT_MS = 300;                    // other tabs see the marker; a save already past its check ends
const RETRY_MS = 500;                        // a write that waits for a removal checks again this often
export const NO_LOCKS = 'This browser cannot do this safely. Export your journal, then clear this site’s data in the browser settings.';
export const BLOCKED = 'Not saved: another account is signed in here now. Copy your text if you need it.';
const WIPING_DEL = 'Another tab is removing the journal from this browser, so nothing was deleted. Try again in a moment.';
const REFUSED = 'Something new was saved in another tab, so the journal stays in this browser. Try again.';
const NOT_PREPARED = 'This browser could not prepare the removal, so nothing changed.';
const TOO_SLOW = 'The removal took too long, so the journal stays in this browser. Try again.';
export const WIPING_NOW = 'Another tab is removing the journal from this browser, so sync did not start. Try again in a moment.';

const get = (storage, k) => { try { return storage.getItem(k); } catch { return null; } };
const put = (storage, k, v) => { try { if (v == null) storage.removeItem(k); else storage.setItem(k, v); } catch {} };

/** Testable core: every browser API is passed in. */
export const PENDING_LOGOUT = 'tao.sync.logout'; // a sign-out the server has not confirmed yet

const bytes = (s) => new TextEncoder().encode(s).length;

/** The time in a marker value (`<ms>` or `<ms>.<id>`): only the text before the first '.' (the id may read as a number). */
const timeOf = (v) => {
  const head = String(v ?? '').split('.')[0];
  return head === '' ? NaN : Number(head);
};
const idOf = (v) => (v == null ? null : String(v).split('.').slice(1).join('.') || null);
const newId = () => Math.random().toString(36).slice(2);

/** True when a marker value was written less than `ms` ago (10 s by default). */
const fresh = (v, now, ms = FRESH_MS) => {
  const t = timeOf(v);
  return Number.isFinite(t) && Math.abs(now - t) < ms;
};

/** True while a tab removes the journal from this browser ("Remove it from this browser"). Writers use gate(). */
export const wiping = (storage = globalThis.localStorage, now = Date.now()) => fresh(get(storage, WIPING), now);

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when journal `a` holds everything in `b` (b adds nothing to a). */
const covers = (a, b) => sameCore(merge(a, b), merge(a, emptyJournal()));

/** p, but at most `ms` long: a real deadline (the timer is real, also in tests with fake waits). */
const within = (p, ms) => {
  let t;
  return Promise.race([p, new Promise((r) => { t = setTimeout(r, ms); })]).finally(() => clearTimeout(t));
};

/**
 * Testable core: every browser API is passed in. `wipe()` removes local extras (snapshot, drafts).
 * `setJournal(j, { replace })` saves j and returns false when it could not. `reload()` reads the journal in
 * memory again from storage. `onDefer()` tells the reader that a write waits for a removal in another tab.
 * `onWaiting(true)` when writes start to wait in the queue, `onWaiting(false)` when they ran (the app asks
 * before the tab closes meanwhile). `onBlocked()`: a waiting write was not applied (see drain()).
 */
export function makeSyncer({ fetch, getJournal, setJournal, snapshot = () => true, wipe = () => {}, reload = () => {}, storage, now = () => Date.now(), onChange = () => {}, onDefer = () => {}, onWaiting = () => {}, onBlocked = () => {}, locks = null, sleep = defaultSleep }) {
  const record = () => { try { return JSON.parse(get(storage, REC) || 'null'); } catch { return null; } };
  const accountNow = () => record()?.account ?? null;
  let loadedFor = accountNow(); // the account signed in when the journal in memory was last read from storage
  const setRecord = (r) => { put(storage, REC, r ? JSON.stringify(r) : null); loadedFor = r?.account ?? null; };
  let running = null;
  let again = null;
  let confirmed = null; // { account, journal, rev }: the server's copy in the last answer; the server holds all of it
  let lastStatus = null; // the HTTP status of the last sync request (0: no answer)
  let notSaved = false; // the last sync reached the server, but this browser could not save its answer
  let ownId = null; // the id in the wiping marker this tab wrote: its own syncs still save
  let seenWiped = get(storage, WIPED); // the WIPED value this tab last handled
  let onWiped = () => {}; // set by onWipedElsewhere: rebuilds this tab from the emptied journal
  let ops = 0; // sign-outs and deletes running in this tab (busy())
  let loggingOut = null; // this tab's logout request while it is out
  const queue = []; // { fn, st }: writes that wait for a removal in another tab (or this one) to end
  let draining = false;

  /**
   * Bring memory up to date before a write or a sync body: another tab may have removed the journal (WIPED
   * changed) or signed in to another account while this tab slept (a frozen tab, the back-forward cache, late
   * storage events). Then the journal is read again from storage. A removal also runs the wipe handler. Once
   * per change.
   */
  function catchUp() {
    const v = get(storage, WIPED);
    const account = accountNow();
    if (v === seenWiped && account === loadedFor) return;
    const wiped = v !== seenWiped;
    seenWiped = v;
    reloadJournal();
    if (wiped) onWiped();
  }

  /** Read the journal in memory again from storage. It now belongs to the account signed in at this moment. */
  function reloadJournal() {
    loadedFor = accountNow();
    reload();
  }

  /**
   * True when a journal, draft, or snapshot write may happen now: after catchUp(), no fresh wiping marker is
   * there. `mine`: this tab's own syncs during its own removal still save.
   */
  function guardWrite({ mine = false } = {}) {
    catchUp();
    const mark = get(storage, WIPING);
    return !fresh(mark, now()) || (mine && !!ownId && idOf(mark) === ownId);
  }

  /**
   * The account and WIPED value of the journal in memory (the one the page on screen was built from). An
   * editor takes it when it opens (or a list with Edit buttons is built) and passes it with every save.
   */
  const stamp = () => ({ account: loadedFor, gen: seenWiped });
  /**
   * True when a write stamped `st` must not go into the journal signed in now: another account is signed in,
   * and either the stamp has an account (the account changed, with or without a removal) or the journal was
   * removed since (WIPED changed). An editor opened signed out still saves after a sign-in without a removal:
   * the signed-out journal is this browser's own, and Merge puts it into that account anyway.
   */
  function refused(st) {
    const a = accountNow();
    return !!st && a !== null && a !== st.account && (st.account !== null || st.gen !== get(storage, WIPED));
  }

  /**
   * Every write of journal, draft, or snapshot data goes through here, in every tab. fn() runs now when
   * guardWrite() allows it (true). Otherwise it waits in a queue with its stamp (by default the account and
   * WIPED value of that time), and the reader is told once (onDefer). Every 500 ms the queue checks again;
   * once no fresh marker is left, each fn runs through gate() again, on the journal then in memory. A write
   * that refused() stops is not applied (now or from the queue): it returns false, the editor keeps its text
   * on screen (its after() does not run), and onBlocked() says so.
   */
  function gate(fn, st = null) {
    if (guardWrite()) {
      if (refused(st)) { onBlocked(); return false; }
      fn(); return true;
    }
    queue.push({ fn, st: st || stamp() }); // guardWrite() caught up: stamp() is the account and WIPED of now
    if (!draining) { draining = true; onDefer(); onWaiting(true); drain(); }
    return false;
  }
  async function drain() {
    while (wiping(storage, now())) await sleep(RETRY_MS);
    draining = false;
    let blocked = false;
    for (const it of queue.splice(0)) {
      if (refused(it.st)) { blocked = true; continue; }
      gate(it.fn, it.st);
    }
    if (blocked) onBlocked();
    if (!draining) onWaiting(false);
  }

  /** Counts a sign-out or delete as running (busy()); its end sends a status event, so pages enable buttons again. */
  const op = (p) => { ops++; return p.finally(() => { ops--; onChange({ status: true }); }); };

  // Runs fn while no other tab of this browser runs a sign-out or a delete. Only Web Locks do this safely:
  // without them, a removal and a delete throw NO_LOCKS (see signOut and deleteAccount), and the rest runs.
  const exclusive = (fn) => op(Promise.resolve().then(() => (locks?.request ? locks.request(LOCK, fn) : fn())));
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

  /**
   * End the server session. Until the server confirms, remember to retry. While the request is out,
   * LOGGING_OUT says so to every tab: its answer clears the cookie, so no sign-in may verify before it ends.
   */
  function logout() {
    const run = (async () => {
      put(storage, PENDING_LOGOUT, '1');
      const mark = `${now()}.${newId()}`;
      put(storage, LOGGING_OUT, mark);
      try {
        const res = await api('POST', '/api/auth/logout', {});
        if (res.ok) put(storage, PENDING_LOGOUT, null);
      } catch { /* retried by check() */ } finally {
        if (get(storage, LOGGING_OUT) === mark) put(storage, LOGGING_OUT, null);
      }
    })();
    loggingOut = run; // never rejects
    run.finally(() => { if (loggingOut === run) loggingOut = null; });
    return run;
  }

  /**
   * One request, for the account signed in when it starts. True when the server copy now holds everything this
   * device had, and this device saved what the answer brought.
   */
  async function once({ keepalive = false } = {}) {
    catchUp(); // the body comes from memory: it must be this account's journal, not an old one
    const r = record();
    if (!r) return false;
    const { account } = r;
    const body = JSON.stringify({ account, journal: syncCore(getJournal()) });
    const sent = JSON.parse(body).journal; // a copy: saves during the request must not change it
    // A wipe in another tab while this request is out: this tab's journal may be the old one (storage events
    // arrive late), so its answer must not save it back.
    const wiped = get(storage, WIPED);
    let res;
    lastStatus = 0;
    notSaved = false;
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
    // Removed from this browser meanwhile, or another tab is removing it now: save nothing. This answer is
    // not queued: it holds only what the server has, and the next sync brings it again.
    if (get(storage, WIPED) !== wiped || !guardWrite({ mine: true })) return false;
    confirmed = { account, journal: remote, rev };
    const cur = getJournal(); // read after the wait: keeps anything saved meanwhile
    const merged = merge(cur, remote);
    const changed = !sameCore(merged, cur);
    const saved = !changed || setJournal(merged) !== false; // false: storage full, so the answer lives in memory only
    notSaved = !saved;
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
    // Storage decides, not memory: another tab may have saved entries this tab has not read yet.
    const held = () => merge(getJournal(), load(storage));
    const before = held();
    const hasLocal = before.entries.length > 0 || before.draws.length > 0;
    let choice = 'merge';
    if (hasLocal && last && last !== account.id) {
      choice = await onSwitch();
      if (choice === 'cancel') { await logout(); return false; }
    }
    // Another tab is removing the journal now: write nothing, and end the new session (a sign-in is not queued).
    if (!guardWrite()) { await logout(); throw new Error(WIPING_NOW); }
    const j = held(); // read again after the prompt: a save made meanwhile goes into the snapshot too
    if (choice === 'replace') {
      if (!snapshot(j)) { await logout(); throw new Error('Could not keep a copy of this browser’s journal (storage full). Export it first.'); }
      // Storage refused the empty journal: this browser still holds the other account's journal. Stop before
      // this account owns it or a sync uploads it.
      if (setJournal({ ...emptyJournal(), lastExportAt: j.lastExportAt ?? null }, { replace: true }) === false) {
        await logout();
        throw new Error(NOT_CLEARED);
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
      // A sign-out that did not reach the server: finish it, never resume that session. While another tab's
      // logout is out, that one finishes it: a second request could end before it and remove its markers.
      if (!fresh(get(storage, LOGGING_OUT), now(), COOKIE_MS)) await logout();
      if (record()) { setRecord(null); onChange({ signedOut: true }); }
      return;
    }
    // Another tab may remove the journal or sign out while this request is out: then its answer must not
    // resume a session or sync this tab's (perhaps old) journal.
    const wiped = get(storage, WIPED);
    let res;
    try { res = await api('GET', '/api/session'); } catch { return; }
    if (!res.ok) return;
    let account = null;
    try { ({ account } = await res.json()); } catch { return; }
    if (get(storage, WIPED) !== wiped || get(storage, PENDING_LOGOUT)) return;
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
   * Runs under the Web Lock, so a delete in another tab cannot run at the same time. Without Web Locks it
   * throws NO_LOCKS and changes nothing.
   * Saves in every tab: after the first sync this writes the WIPING marker `<ms>.<id>` and reads back that
   * exact string. While it is fresh, every write waits (gate()), also in this tab. Then it waits 300 ms (a
   * save already past its check ends), writes the marker again (new time), syncs again, and checks again, so
   * a save that landed before the marker stops the removal. Right before the empty journal is saved, the
   * marker must still be ours and fresh. The marker is removed at the end, also on failure; then the waiting
   * writes run on the emptied journal, so no text is lost.
   */
  function signOut({ clearLocal = false, account = accountNow() } = {}) {
    if (clearLocal && !locks?.request) return Promise.reject(new Error(NO_LOCKS));
    return exclusive(async () => {
      // Checked again inside the lock: another tab may have signed out, or in to another account, meanwhile.
      if (accountNow() !== account) throw new Error(account && !record() ? ENDED_OUT : SWITCHED_OUT);
      if (clearLocal) {
        const finalSync = async () => {
          if (await syncNow()) return;
          if (accountNow() !== account) throw new Error(record() ? SWITCHED_OUT : ENDED_OUT);
          if (ownId && idOf(get(storage, WIPING)) !== ownId) throw new Error(TOO_SLOW); // our marker is gone: its answer was dropped
          if (lastStatus === 413) throw new Error(TOO_LARGE_OUT);
          if (notSaved) throw new Error(NOT_SAVED_OUT); // the server answered; this browser's storage is the problem
          throw new Error('Could not reach the server, so the journal stays in this browser. Try again online, or Export first.');
        };
        await finalSync();
        if (accountNow() !== account) throw new Error(SWITCHED_OUT);
        const id = newId();
        ownId = id;
        const ours = () => { const v = get(storage, WIPING); return idOf(v) === id && fresh(v, now()); };
        const mark = () => { const v = `${now()}.${id}`; put(storage, WIPING, v); return get(storage, WIPING) === v; };
        try {
          if (!mark()) throw new Error(NOT_PREPARED); // storage full: no other tab would see it
          await sleep(WIPE_WAIT_MS);
          if (!ours() || !mark()) throw new Error(TOO_SLOW);
          await finalSync(); // brings in a save that landed before the marker
          if (accountNow() !== account) throw new Error(SWITCHED_OUT);
          if (!heldOnServer()) throw new Error(REFUSED);
          if (!ours()) throw new Error(TOO_SLOW); // the Web Lock cannot be lost, but the marker can go stale
          // Save the empty journal first: when storage refuses it, nothing has changed yet.
          if (setJournal(emptyJournal(), { replace: true }) === false) throw new Error(NOT_REMOVED);
          setRecord(null); // no tab starts a sync from here on
          wipe();
          seenWiped = `${now()}.${newId()}`; // this tab handles its own wipe (onChange below)
          put(storage, WIPED, seenWiped);
        } finally {
          ownId = null;
          if (idOf(get(storage, WIPING)) === id) put(storage, WIPING, null);
        }
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
    if (!guardWrite()) throw new Error(WIPING_DEL); // a removing tab crashed less than 10 s ago
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
   * sign-in to another account asks first (merge or keep apart). Runs under the Web Lock; without Web Locks it
   * throws NO_LOCKS and sends nothing.
   */
  function deleteAccount({ account = accountNow() } = {}) {
    if (!locks?.request) return Promise.reject(new Error(NO_LOCKS));
    return exclusive(async () => {
      if (!account || accountNow() !== account) throw new Error(record() ? SWITCHED : ENDED);
      if (!(await syncNow())) {
        if (accountNow() !== account) throw new Error(record() ? SWITCHED : ENDED);
        const pulled = lastStatus === 413 && (await pull(account));
        if (!pulled) {
          if (accountNow() !== account) throw new Error(record() ? SWITCHED : ENDED);
          if (notSaved) throw new Error(NOT_SAVED); // the server answered; this browser's storage is the problem
          throw new Error('Could not sync first, so nothing was deleted. Try again online, or Export first.');
        }
      }
      if (!confirmed || confirmed.account !== account || accountNow() !== account) throw new Error(record() ? SWITCHED : ENDED);
      const { journal: remote, rev } = confirmed;
      // Memory may hold the answer while storage does not (a save failed on an earlier try): save it again.
      if (!covers(load(storage), remote)) {
        if (!guardWrite()) throw new Error(WIPING_DEL);
        setJournal(merge(getJournal(), remote));
      }
      if (!covers(load(storage), remote)) throw new Error(NOT_SAVED);
      let res;
      const body = typeof rev === 'number' ? { account, rev } : { account };
      // While the DELETE is out, a sign-in waits (settle()): a late answer clears the cookie.
      put(storage, DELETING, String(now()));
      try { res = await api('DELETE', '/api/account', body); } catch { throw new Error(NOT_DELETED); } // offline: not "Failed to fetch"
      finally { put(storage, DELETING, null); }
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

  /**
   * Right before a sign-in or sign-up sends its verify request (after the passkey prompt: a wait before the
   * prompt can expire the tap, and phones then refuse the prompt). A logout or DELETE answer clears the
   * cookie, so each one out must end before the new session cookie arrives: wait for this tab's own logout,
   * then while another tab's logout or a DELETE is out (polled every 200 ms). Then finish a sign-out the
   * server has not confirmed. No second logout is sent while one is out. All of it ends after 30 s at most.
   * A late answer can still sign this tab out (see CLAUDE.md); no journal text is lost then.
   */
  async function settle() {
    const out = () => fresh(get(storage, LOGGING_OUT), now(), COOKIE_MS) || fresh(get(storage, DELETING), now(), COOKIE_MS);
    const work = async () => {
      if (loggingOut) await loggingOut;
      for (let i = 0; i < COOKIE_MS / 200 && out(); i++) await sleep(200);
      if (get(storage, PENDING_LOGOUT) && !fresh(get(storage, LOGGING_OUT), now(), COOKIE_MS)) await logout();
    };
    await within(work(), COOKIE_MS);
  }

  /**
   * fn() runs in this tab when another tab removed the journal from this browser (signOut with clearLocal),
   * after the journal in memory was read again: on the storage event, or earlier, when a write or a sync here
   * finds WIPED changed (catchUp). Once per value.
   */
  function onWipedElsewhere(fn, target = globalThis) {
    onWiped = fn;
    target.addEventListener?.('storage', (e) => { if (e.key === WIPED && e.newValue) catchUp(); });
  }

  return { record, syncNow, adopt, check, signOut, deleteAccount, onWipedElsewhere, settle, api, gate, stamp, guardWrite, catchUp, reloadJournal, busy: () => ops > 0 };
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
  await syncer.settle?.();
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
  await syncer.settle?.();
  const v = await post(syncer, '/api/auth/login/verify', { challengeId: o.data.challengeId, response: authJSON(cred) });
  if (!v.res.ok) {
    return { ok: false, message: SERVER_MSG[v.data.error] || 'The passkey could not be checked. Try again.', none: v.data.error === 'unknown-passkey' };
  }
  return { ok: await syncer.adopt(v.data.account, { onSwitch }) };
}
