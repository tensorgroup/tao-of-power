// Anonymous usage events: which pages and features are used, and the paths people take.
// Sends a random visitor id and session id, the route, and short action names. Never journal
// text, search words, or anything typed. Skipped when the browser asks not to be tracked.

const off = (() => {
  try { return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || location.protocol !== 'https:'; } catch { return true; }
})();

const rid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
function id(store, key) {
  try {
    let v = store.getItem(key);
    if (!v) { v = rid(); store.setItem(key, v); }
    return v;
  } catch { return null; }
}

let prev = null;
let path = null;
const standalone = (() => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } })();

function send(ev, detail) {
  if (off) return;
  const e = { ev, path, prev, detail: detail == null ? null : String(detail).slice(0, 64), vid: id(localStorage, 'tao.vid'), sid: id(sessionStorage, 'tao.sid'), standalone };
  const body = JSON.stringify(e);
  try {
    if (!navigator.sendBeacon?.('/api/e', new Blob([body], { type: 'text/plain' }))) {
      fetch('/api/e', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  } catch { /* never break the app for analytics */ }
}

/** The path sent for a fragment that matches none of the router's routes: its text may be anything. */
export const UNKNOWN_ROUTE = 'unknown';

/** The route of a fragment that matches one of the router's patterns (query dropped), else UNKNOWN_ROUTE. */
export function viewPath(hash, patterns) {
  const h = String(hash || '#/'); // as the router reads it
  if (!patterns.some((re) => re.test(h))) return UNKNOWN_ROUTE;
  return (h.replace(/^#/, '') || '/').split('?')[0];
}

/** Call on every route change with the hash and the router's patterns; a view is sent only when the path changes. */
export function trackView(hash, patterns = []) {
  const next = viewPath(hash, patterns);
  if (next === path) return;
  prev = path;
  path = next;
  send('view');
}

/** A named action, e.g. track('draw', 59). */
export function track(ev, detail) { send(ev, detail); }
