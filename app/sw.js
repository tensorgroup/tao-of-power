/* Offline service worker. The precache block is written by scripts/build-precache.mjs. */
// <precache>
const VERSION = '44cbc0c12a6b';
const FILES = [
 "./",
 "css/app.css",
 "data/index.json",
 "data/lexicon.json",
 "data/passages/01.json",
 "data/passages/04.json",
 "data/passages/11.json",
 "data/strokes/540d.json",
 "data/strokes/5668.json",
 "data/strokes/5875.json",
 "data/strokes/5fb7.json",
 "data/strokes/6c96.json",
 "data/strokes/7121.json",
 "data/strokes/7384.json",
 "data/strokes/7d93.json",
 "data/strokes/8c61.json",
 "data/strokes/8eca.json",
 "data/strokes/9053.json",
 "data/text.json",
 "fonts/ebgaramond-italic.woff2",
 "fonts/ebgaramond.woff2",
 "fonts/notoseriftc.woff2",
 "fonts/wenkaitc.woff2",
 "icons/apple-touch-icon.png",
 "icons/favicon.png",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "icons/icon-maskable.png",
 "js/app.js",
 "js/brush.js",
 "js/data.js",
 "js/draw.js",
 "js/journal.js",
 "js/markup.js",
 "js/notes.js",
 "js/sheet.js",
 "js/theme.js",
 "js/ui.js",
 "js/views/about.js",
 "js/views/browse.js",
 "js/views/draw.js",
 "js/views/journal.js",
 "js/views/passage.js",
 "manifest.webmanifest"
];
// </precache>
const CACHE = `tao-${VERSION}`;
const ART_CACHE = 'tao-art'; // runtime cache: paintings are cached when first viewed

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      // `reload` bypasses the HTTP cache so a new version never stores stale files.
      await cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })));
    } catch (e) {
      await caches.delete(CACHE);
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach((c) => c.postMessage('incomplete'));
      throw e;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('tao-') && k !== CACHE && k !== ART_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Any navigation gets the app shell (hash routing).
    if (req.mode === 'navigate') {
      const shell = await cache.match('./');
      if (shell) return shell;
      return fetch(req);
    }
    if (url.pathname.includes('/art/')) {
      const art = await caches.open(ART_CACHE);
      const got = await art.match(req);
      if (got) return got;
      const res = await fetch(req);
      if (res.ok) art.put(req, res.clone());
      return res;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(req);
  })());
});
