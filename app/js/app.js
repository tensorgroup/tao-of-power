// Router, service worker, and app-wide state.
import { h, clear, toast, showUpdate } from './ui.js';
import { closeAll } from './sheet.js';
import * as journalStore from './journal.js';
import { makeSyncer, available as passkeysAvailable } from './sync.js';
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

export const state = {
  journal: journalStore.load(),
  persist() {
    const r = journalStore.save(state.journal);
    if (!r.ok) toast(`Could not save: ${r.error}. Export your journal now.`, { warn: true, ms: 8000 });
    else { askPersistentStorage(); syncer.syncNow(); }
    return r.ok;
  },
};

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
  setJournal: (j) => {
    state.journal = j;
    const r = journalStore.save(j);
    if (!r.ok) toast(`Could not save: ${r.error}. Export your journal now.`, { warn: true, ms: 8000 });
  },
  snapshot: (j) => journalStore.snapshot(j),
  // "Remove it from this browser" also removes the Replace snapshot and unsent drafts.
  wipe: () => {
    try {
      localStorage.removeItem(journalStore.SNAPSHOT_KEY);
      const drafts = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('tao.draft')) drafts.push(k); }
      for (const k of drafts) localStorage.removeItem(k); // passage drafts, question drafts, margin-note drafts
    } catch { /* storage blocked: nothing to remove */ }
  },
  onChange: (detail) => {
    if (detail.expired) toast('Signed out of sync. Sign in again on the Journal page.', { warn: true, ms: 6000 });
    dispatchEvent(new CustomEvent('tao:sync', { detail }));
  },
});

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
  const navKey = { art: 'browse', stories: 'browse', culture: 'browse' }[section] || section;
  for (const a of document.querySelectorAll('[data-nav]')) {
    const on = a.dataset.nav === (section === 'p' ? '' : navKey || 'draw');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (!hash.startsWith('#/p/')) window.scrollTo(0, 0);
  trackView(hash);
  view.focus({ preventScroll: true });
}

addEventListener('hashchange', route);
await Promise.all([getGlossary().then(setGlossary), getRareGlyphs().then(setRareGlyphs)]);
// Another tab changed the journal.
addEventListener('storage', (e) => {
  if (e.key !== journalStore.KEY) return;
  state.journal = journalStore.load();
  if (location.hash === '#/journal') route();
});
route();

if (passkeysAvailable() || syncer.record()) {
  syncer.check();
  document.addEventListener('visibilitychange', () => syncer.syncNow({ keepalive: document.visibilityState === 'hidden' }));
  addEventListener('online', () => syncer.syncNow());
}

// Service worker: offline + update flow.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller; // first visit: no reload on claim
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (w) => showUpdate(() => w.postMessage('skipWaiting'));
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data === 'incomplete') toast('Offline copy incomplete. It will retry next time.', { warn: true });
  });
}
