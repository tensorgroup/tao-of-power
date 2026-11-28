// Router, service worker, and app-wide state.
import { h, clear, toast, showUpdate } from './ui.js';
import { closeAll } from './sheet.js';
import * as journalStore from './journal.js';
import { makeSyncer, available as passkeysAvailable, REC, WIPED, BLOCKED } from './sync.js';
import { setDraftGate, typedText } from './drafts.js';
import { makeState } from './store.js';
import { controllerChange } from './sw-update.js';
import { drawView } from './views/draw.js';
import { passageView } from './views/passage.js';
import { journalView } from './views/journal.js';
import { browseView } from './views/browse.js';
import { aboutView } from './views/about.js';
import { howView } from './views/how.js';
import { searchView } from './views/search.js';
import { galleryView, storiesView, cultureView } from './views/library.js';
import { setGlossary, setRareGlyphs } from './notes.js';
import { trackView } from './track.js';
import { getGlossary, getRareGlyphs } from './data.js';
import { initInstall, sharePage } from './share.js';

initInstall(); // before any await, so the browser's install offer is caught
document.getElementById('share-btn')?.addEventListener('click', sharePage);

// state.change(fn, after) is the one way to change and save the journal (store.js). Every save, every draft
// write, and every snapshot write goes through syncer.gate(): while a tab removes the journal, it waits.
export const state = makeState({
  load: () => journalStore.load(),
  save: (j) => journalStore.save(j),
  gate: (fn, st) => syncer.gate(fn, st),
  stamp: () => syncer.stamp(), // an editor's saves carry it: another account never receives them (sync.js)
  toast,
  onSaved: () => { askPersistentStorage(); syncer.syncNow(); },
});

// Optional passkey sync. A sync saves straight to storage (not persist), so it never triggers itself.
const lsProxy = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
};
export const syncer = makeSyncer({
  fetch: (...a) => fetch(...a),
  storage: lsProxy,
  getJournal: () => state.journal,
  setJournal: (j, { replace = false } = {}) => {
    // A sync result merges with storage (another tab may have saved); only the
    // reader's explicit "use only the account's journal" / "remove it" replace it.
    const next = replace ? j : journalStore.merge(j, journalStore.load());
    const r = journalStore.save(next);
    // A merge result stays in memory even when storage is full (sync.js checks storage, not memory, before a
    // delete). A replace that could not be saved changes nothing: "Nothing changed" must be true.
    if (r.ok || !replace) state.journal = next;
    if (!r.ok) toast(`Could not save: ${r.error}. Export your journal now.`, { warn: true, ms: 8000 });
    return r.ok; // false: "Delete synced copy" and "Remove it from this browser" must not go on
  },
  snapshot: (j) => journalStore.snapshot(j),
  wipe: wipeLocal,
  reload: () => { state.journal = journalStore.load(); },
  onDefer: () => toast('Another tab is removing the journal from this browser. This will be saved when it is done.', { warn: true, ms: 8000 }),
  // While a save waits, closing or reloading the tab would lose it: the browser asks first.
  onWaiting: (on) => { if (on) addEventListener('beforeunload', askFirst); else removeEventListener('beforeunload', askFirst); },
  onBlocked: () => toast(BLOCKED, { warn: true, ms: 12000 }),
  locks: navigator.locks, // one sign-out or delete at a time across tabs
  onChange: (detail) => {
    if (detail.expired) toast('Signed out of sync. Sign in again on the Journal page.', { warn: true, ms: 6000 });
    if (detail.wiped) afterWipe();
    dispatchEvent(new CustomEvent('tao:sync', { detail }));
  },
});

function askFirst(e) { e.preventDefault(); e.returnValue = ''; }

/** "Remove it from this browser" also removes the Replace snapshot and unsent drafts. Only the tab that runs it calls this (sync.js). */
function wipeLocal() {
  try {
    localStorage.removeItem(journalStore.SNAPSHOT_KEY);
    const drafts = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('tao.draft')) drafts.push(k); }
    for (const k of drafts) localStorage.removeItem(k); // passage drafts, question drafts, margin-note drafts
  } catch { /* storage blocked: nothing to remove */ }
}

/**
 * "Remove it from this browser", in this tab or another. The journal in memory was read again already (the
 * syncer did it). A text box that holds typed text keeps it: the page is not built again, and the reader is
 * told. Its draft writer writes the draft again only after the reader types again (drafts.js). With no typed text, the router builds
 * the page from the emptied journal (the hashchange event also stops a playing Listen row). Storage is never
 * removed here: only the tab that ran the wipe removes it (sync.js calls wipeLocal).
 */
function afterWipe() {
  if (typedText()) {
    toast('The journal was removed from this browser in another tab. Your unsaved text is still here; Save keeps it.', { warn: true, ms: 10000 });
    return;
  }
  dispatchEvent(new HashChangeEvent('hashchange'));
}
syncer.onWipedElsewhere(afterWipe);
setDraftGate((fn) => syncer.gate(fn), () => { try { return localStorage.getItem(WIPED); } catch { return null; } });

// While a passkey sign-in or sign-up runs, the Journal page is not built again from another tab's change (its
// account prompt must stay on screen). A change skipped meanwhile builds the page when the ceremony ends.
let signingIn = 0;
let skipped = false;
export async function duringSignIn(fn) {
  signingIn++;
  try { return await fn(); } finally {
    if (!--signingIn && skipped) { skipped = false; rebuildJournal(); }
  }
}
// Another tab changed the journal or the account: build the Journal page again, but never over typed text
// (an open entry edit has no draft). The save or cancel that ends the edit builds it anyway.
function rebuildJournal() {
  if (location.hash !== '#/journal') return;
  if (signingIn) skipped = true;
  else if (!typedText()) route();
}

let asked = false;
function askPersistentStorage() {
  if (asked || !navigator.storage?.persist) return;
  asked = true;
  navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {});
}

const routes = [
  [/^#?\/?$/, () => drawView()],
  [/^#\/p\/(\d{1,2})(?:\?d=([\w-]+))?$/, (m) => passageView(Number(m[1]), m[2])],
  [/^#\/journal$/, () => journalView()],
  [/^#\/browse$/, () => browseView()],
  [/^#\/about(?:\?s=([\w-]+))?$/, (m) => aboutView(m[1])],
  [/^#\/how$/, () => howView()],
  [/^#\/search(?:\?q=([^&]*))?$/, (m) => searchView(m[1] ? safeDecode(m[1]) : '')],
  [/^#\/art$/, () => galleryView()],
  [/^#\/stories$/, () => storiesView()],
  [/^#\/culture$/, () => cultureView()],
];

const accountOf = (v) => { try { return JSON.parse(v || 'null')?.account ?? null; } catch { return null; } };
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

async function route() {
  closeAll();
  const view = document.getElementById('view');
  const hash = location.hash || '#/';
  let node;
  try {
    for (const [re, fn] of routes) {
      const m = hash.match(re);
      if (m) { node = await fn(m); break; }
    }
    if (!node) node = h('p', {}, 'Nothing here. ', h('a', { href: '#/', text: 'Return to the draw.' }));
  } catch (e) {
    console.error(e);
    node = h('div', { class: 'pending' }, h('p', { text: 'This page could not load. If you are offline, the offline copy may be incomplete.' }), h('p', { class: 'small', text: String(e.message || e) }));
  }
  clear(view).append(node);
  const section = (hash.split('/')[1] || 'draw').split('?')[0];
  // The home page has its own Share row; the footer button would be a second one.
  const footShare = document.querySelector('.foot-share');
  if (footShare) footShare.hidden = section === 'draw';
  const navKey = { art: 'browse', stories: 'browse', culture: 'browse' }[section] || section;
  for (const a of document.querySelectorAll('[data-nav]')) {
    const on = a.dataset.nav === (section === 'p' ? '' : navKey || 'draw');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (!hash.startsWith('#/p/')) window.scrollTo(0, 0);
  trackView(hash, routes.map(([re]) => re));
  view.focus({ preventScroll: true });
}

addEventListener('hashchange', route);
// Another tab changed the journal. Installed before the first await: during that wait another tab can switch
// the sync account and replace the journal, and a sync from this tab must not send the old account's journal.
addEventListener('storage', (e) => {
  if (e.key === journalStore.KEY) {
    syncer.reloadJournal(); // memory now belongs to the account signed in now
    rebuildJournal();
  } else if (e.key === REC && accountOf(e.oldValue) !== accountOf(e.newValue)) {
    rebuildJournal(); // signed in or out in another tab: Export, the backup note and the Sync section all change
  }
});
// Back from the back-forward cache: storage events were missed. Read the journal again if another tab removed
// it or changed the account, before any sync sends it.
addEventListener('pageshow', (e) => { if (e.persisted) syncer.catchUp(); });
await Promise.all([getGlossary().then(setGlossary), getRareGlyphs().then(setRareGlyphs)]);
route();

if (passkeysAvailable() || syncer.record()) {
  syncer.check();
  document.addEventListener('visibilitychange', () => syncer.syncNow({ keepalive: document.visibilityState === 'hidden' }));
  addEventListener('online', () => syncer.syncNow());
}

// Service worker: offline + update flow.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller; // first visit: no reload on claim
  let refreshedHere = false; // this tab's reader tapped Refresh: only this tab reloads by itself
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (w) => showUpdate(() => { refreshedHere = true; w.postMessage('skipWaiting'); });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', controllerChange({
    hadController, chosen: () => refreshedHere, reload: () => location.reload(), onOther: offerReload,
  }));
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data === 'incomplete') toast('Offline copy incomplete. It will retry next time.', { warn: true });
  });
}

/** Another tab installed an update. Reload only when the reader taps Reload; ask first over unsaved text. */
function offerReload() {
  showUpdate(() => {
    if (!typedText()) { location.reload(); return; }
    showUpdate(() => location.reload(), { text: 'This page holds text that is not saved. Reload anyway? ', label: 'Reload' });
  }, { text: 'A new version is ready. Reload when you are done. ', label: 'Reload' });
}
