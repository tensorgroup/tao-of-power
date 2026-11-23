// Router, service worker, and app-wide state.
import { h, clear, toast } from './ui.js';
import { closeAll } from './sheet.js';
import * as journalStore from './journal.js';
import { drawView } from './views/draw.js';
import { passageView } from './views/passage.js';
import { journalView } from './views/journal.js';
import { browseView } from './views/browse.js';
import { aboutView } from './views/about.js';
import { setGlossary } from './notes.js';
import { getGlossary } from './data.js';

export const state = {
  journal: journalStore.load(),
  persist() {
    const r = journalStore.save(state.journal);
    if (!r.ok) toast(`Could not save: ${r.error}. Export your journal now.`, { warn: true, ms: 8000 });
    else askPersistentStorage();
    return r.ok;
  },
};

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
  [/^#\/about$/, () => aboutView()],
];

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
  const section = hash.split('/')[1] || 'draw';
  for (const a of document.querySelectorAll('[data-nav]')) {
    const on = a.dataset.nav === (section === 'p' ? '' : section || 'draw');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (!hash.startsWith('#/p/')) window.scrollTo(0, 0);
  view.focus({ preventScroll: true });
}

addEventListener('hashchange', route);
await getGlossary().then(setGlossary);
// Another tab changed the journal.
addEventListener('storage', (e) => { if (e.key === journalStore.KEY) state.journal = journalStore.load(); });
route();

// Service worker: offline + update flow.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (w) => toast('Update ready.', {
      action: 'Refresh', ms: 0,
      onAction: () => w.postMessage('skipWaiting'),
    });
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
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data === 'incomplete') toast('Offline copy incomplete. It will retry next time.', { warn: true });
  });
}
