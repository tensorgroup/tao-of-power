/* Offline service worker. The precache block is written by scripts/build-precache.mjs. */
importScripts('js/sw-range.js'); // taoRange: Range (206) answers for cached audio
// <precache>
const VERSION = '38ef5bd172e0';
const ART_VERSION = '3cfa7432';
const SEARCH_VERSION = 'dffb8a05';
const MODEL_VERSION = 'a31ada72';
const AUDIO_VERSION = 'a8506e97';
const FILES = [
 "./",
 "css/app.css",
 "data/art.json",
 "data/culture.json",
 "data/echoes.json",
 "data/glossary.json",
 "data/index.json",
 "data/lexicon.json",
 "data/listen.json",
 "data/map.json",
 "data/passages/01.json",
 "data/passages/02.json",
 "data/passages/03.json",
 "data/passages/04.json",
 "data/passages/05.json",
 "data/passages/06.json",
 "data/passages/07.json",
 "data/passages/08.json",
 "data/passages/09.json",
 "data/passages/10.json",
 "data/passages/11.json",
 "data/passages/12.json",
 "data/passages/13.json",
 "data/passages/14.json",
 "data/passages/15.json",
 "data/passages/16.json",
 "data/passages/17.json",
 "data/passages/18.json",
 "data/passages/19.json",
 "data/passages/20.json",
 "data/passages/21.json",
 "data/passages/22.json",
 "data/passages/23.json",
 "data/passages/24.json",
 "data/passages/25.json",
 "data/passages/26.json",
 "data/passages/27.json",
 "data/passages/28.json",
 "data/passages/29.json",
 "data/passages/30.json",
 "data/passages/31.json",
 "data/passages/32.json",
 "data/passages/33.json",
 "data/passages/34.json",
 "data/passages/35.json",
 "data/passages/36.json",
 "data/passages/37.json",
 "data/passages/38.json",
 "data/passages/39.json",
 "data/passages/40.json",
 "data/passages/41.json",
 "data/passages/42.json",
 "data/passages/43.json",
 "data/passages/44.json",
 "data/passages/45.json",
 "data/passages/46.json",
 "data/passages/47.json",
 "data/passages/48.json",
 "data/passages/49.json",
 "data/passages/50.json",
 "data/passages/51.json",
 "data/passages/52.json",
 "data/passages/53.json",
 "data/passages/54.json",
 "data/passages/55.json",
 "data/passages/56.json",
 "data/passages/57.json",
 "data/passages/58.json",
 "data/passages/59.json",
 "data/passages/60.json",
 "data/passages/61.json",
 "data/passages/62.json",
 "data/passages/63.json",
 "data/passages/64.json",
 "data/passages/65.json",
 "data/passages/66.json",
 "data/passages/67.json",
 "data/passages/68.json",
 "data/passages/69.json",
 "data/passages/70.json",
 "data/passages/71.json",
 "data/passages/72.json",
 "data/passages/73.json",
 "data/passages/74.json",
 "data/passages/75.json",
 "data/passages/76.json",
 "data/passages/77.json",
 "data/passages/78.json",
 "data/passages/79.json",
 "data/passages/80.json",
 "data/passages/81.json",
 "data/rare-glyphs.json",
 "data/strokes/4e0b.json",
 "data/strokes/4e3b.json",
 "data/strokes/4e45.json",
 "data/strokes/4ea1.json",
 "data/strokes/4ea4.json",
 "data/strokes/4ec1.json",
 "data/strokes/4f01.json",
 "data/strokes/4f0f.json",
 "data/strokes/4f10.json",
 "data/strokes/4fe1.json",
 "data/strokes/5109.json",
 "data/strokes/5146.json",
 "data/strokes/5148.json",
 "data/strokes/514c.json",
 "data/strokes/5175.json",
 "data/strokes/517c.json",
 "data/strokes/5203.json",
 "data/strokes/52c7.json",
 "data/strokes/5316.json",
 "data/strokes/5320.json",
 "data/strokes/53ad.json",
 "data/strokes/53cd.json",
 "data/strokes/53d6.json",
 "data/strokes/53f8.json",
 "data/strokes/540d.json",
 "data/strokes/5473.json",
 "data/strokes/548e.json",
 "data/strokes/54c0.json",
 "data/strokes/5584.json",
 "data/strokes/55aa.json",
 "data/strokes/55c7.json",
 "data/strokes/5668.json",
 "data/strokes/570b.json",
 "data/strokes/5716.json",
 "data/strokes/57a2.json",
 "data/strokes/5875.json",
 "data/strokes/5916.json",
 "data/strokes/5927.json",
 "data/strokes/5937.json",
 "data/strokes/5949.json",
 "data/strokes/5951.json",
 "data/strokes/596a.json",
 "data/strokes/59d3.json",
 "data/strokes/5a01.json",
 "data/strokes/5b30.json",
 "data/strokes/5b54.json",
 "data/strokes/5b57.json",
 "data/strokes/5b5d.json",
 "data/strokes/5b69.json",
 "data/strokes/5b6b.json",
 "data/strokes/5ba2.json",
 "data/strokes/5bb0.json",
 "data/strokes/5bcc.json",
 "data/strokes/5bd2.json",
 "data/strokes/5bf5.json",
 "data/strokes/5bf6.json",
 "data/strokes/5de6.json",
 "data/strokes/5e2b.json",
 "data/strokes/5ec9.json",
 "data/strokes/5f31.json",
 "data/strokes/5f35.json",
 "data/strokes/5f37.json",
 "data/strokes/5fa1.json",
 "data/strokes/5fb7.json",
 "data/strokes/6028.json",
 "data/strokes/60a3.json",
 "data/strokes/611a.json",
 "data/strokes/6148.json",
 "data/strokes/61f7.json",
 "data/strokes/6236.json",
 "data/strokes/62d9.json",
 "data/strokes/6559.json",
 "data/strokes/6613.json",
 "data/strokes/6642.json",
 "data/strokes/665a.json",
 "data/strokes/66f2.json",
 "data/strokes/672b.json",
 "data/strokes/679c.json",
 "data/strokes/67d4.json",
 "data/strokes/67e2.json",
 "data/strokes/6839.json",
 "data/strokes/68c4.json",
 "data/strokes/68d8.json",
 "data/strokes/6b63.json",
 "data/strokes/6b66.json",
 "data/strokes/6b78.json",
 "data/strokes/6b7b.json",
 "data/strokes/6bcd.json",
 "data/strokes/6c11.json",
 "data/strokes/6c23.json",
 "data/strokes/6c34.json",
 "data/strokes/6c5f.json",
 "data/strokes/6c96.json",
 "data/strokes/6cd5.json",
 "data/strokes/6d89.json",
 "data/strokes/6de1.json",
 "data/strokes/70ba.json",
 "data/strokes/70f9.json",
 "data/strokes/7121.json",
 "data/strokes/7136.json",
 "data/strokes/71d5.json",
 "data/strokes/722d.json",
 "data/strokes/725d.json",
 "data/strokes/72d7.json",
 "data/strokes/7368.json",
 "data/strokes/7384.json",
 "data/strokes/7389.json",
 "data/strokes/7518.json",
 "data/strokes/751f.json",
 "data/strokes/754f.json",
 "data/strokes/755c.json",
 "data/strokes/75c5.json",
 "data/strokes/76c8.json",
 "data/strokes/76ca.json",
 "data/strokes/76dc.json",
 "data/strokes/76f2.json",
 "data/strokes/77e5.json",
 "data/strokes/795e.json",
 "data/strokes/796d.json",
 "data/strokes/798f.json",
 "data/strokes/79ae.json",
 "data/strokes/79c1.json",
 "data/strokes/7a05.json",
 "data/strokes/7b11.json",
 "data/strokes/7cbe.json",
 "data/strokes/7cde.json",
 "data/strokes/7d00.json",
 "data/strokes/7d20.json",
 "data/strokes/7d93.json",
 "data/strokes/7db2.json",
 "data/strokes/7f6a.json",
 "data/strokes/7f8e.json",
 "data/strokes/7fa9.json",
 "data/strokes/7fd2.json",
 "data/strokes/807e.json",
 "data/strokes/80b2.json",
 "data/strokes/80fd.json",
 "data/strokes/81e3.json",
 "data/strokes/81ea.json",
 "data/strokes/81f3.json",
 "data/strokes/82bb.json",
 "data/strokes/856a.json",
 "data/strokes/864e.json",
 "data/strokes/865f.json",
 "data/strokes/8863.json",
 "data/strokes/88dc.json",
 "data/strokes/89c0.json",
 "data/strokes/8a25.json",
 "data/strokes/8c37.json",
 "data/strokes/8c61.json",
 "data/strokes/8c6b.json",
 "data/strokes/8cac.json",
 "data/strokes/8cb4.json",
 "data/strokes/8ce2.json",
 "data/strokes/8d64.json",
 "data/strokes/8db3.json",
 "data/strokes/8eca.json",
 "data/strokes/8f14.json",
 "data/strokes/8faf.json",
 "data/strokes/8fb1.json",
 "data/strokes/9053.json",
 "data/strokes/914d.json",
 "data/strokes/91cd.json",
 "data/strokes/9589.json",
 "data/strokes/9593.json",
 "data/strokes/967d.json",
 "data/strokes/96de.json",
 "data/strokes/9748.json",
 "data/strokes/975c.json",
 "data/strokes/9806.json",
 "data/strokes/98a8.json",
 "data/strokes/98df.json",
 "data/strokes/99ac.json",
 "data/strokes/99b3.json",
 "data/strokes/9a55.json",
 "data/strokes/9aa8.json",
 "data/strokes/9b3c.json",
 "data/strokes/9b5a.json",
 "data/strokes/9bae.json",
 "data/strokes/9ed1.json",
 "data/text.json",
 "data/wing.json",
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
 "js/audio.js",
 "js/brush.js",
 "js/data.js",
 "js/draw.js",
 "js/journal.js",
 "js/markup.js",
 "js/notes.js",
 "js/search-core.js",
 "js/sheet.js",
 "js/sw-range.js",
 "js/theme.js",
 "js/track.js",
 "js/ui.js",
 "js/views/about.js",
 "js/views/browse.js",
 "js/views/draw.js",
 "js/views/how.js",
 "js/views/journal.js",
 "js/views/library.js",
 "js/views/passage.js",
 "js/views/search.js",
 "manifest.webmanifest"
];
// </precache>
const CACHE = `tao-${VERSION}`;
const ART_CACHE = `tao-art-${typeof ART_VERSION === 'string' ? ART_VERSION : 'dev'}`; // paintings cached on first view; versioned so replaced art refreshes
// The search model (4 MB) and index load the first time Search opens; versioned like art.
const SEARCH_CACHE = `tao-search-${typeof SEARCH_VERSION === 'string' ? SEARCH_VERSION : 'dev'}`;
const MODEL_CACHE = `tao-model-${typeof MODEL_VERSION === 'string' ? MODEL_VERSION : 'dev'}`;
const AUDIO_CACHE = `tao-audio-${typeof AUDIO_VERSION === 'string' ? AUDIO_VERSION : 'dev'}`;
// Passage recordings (Listen). Not versioned: activate prunes files no longer named in data/listen.json.
const LISTEN_CACHE = 'tao-listen';
// Order matters: the first match wins, so '/audio/passages/' comes before '/audio/'.
const LAZY = [['/art/', ART_CACHE], ['/model/', MODEL_CACHE], ['/data/search/', SEARCH_CACHE], ['/audio/passages/', LISTEN_CACHE], ['/audio/', AUDIO_CACHE]];

// Delete cached recordings that the current data/listen.json no longer names.
async function pruneListen() {
  let listen;
  try {
    const res = await (await caches.open(CACHE)).match('data/listen.json');
    if (!res) return;
    listen = await res.json();
  } catch { return; }
  const keep = new Set();
  for (const lang of ['zh', 'en']) {
    for (const entry of Object.values((listen && listen[lang]) || {})) {
      if (entry && typeof entry.file === 'string') keep.add(new URL(entry.file, self.registration.scope).pathname);
    }
  }
  const c = await caches.open(LISTEN_CACHE);
  for (const key of await c.keys()) if (!keep.has(new URL(key.url).pathname)) await c.delete(key);
}

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
    for (const k of await caches.keys()) if (k.startsWith('tao-') && ![CACHE, ART_CACHE, SEARCH_CACHE, MODEL_CACHE, AUDIO_CACHE, LISTEN_CACHE].includes(k)) await caches.delete(k);
    await pruneListen().catch(() => {}); // never block activation on pruning
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
    const lazy = LAZY.find(([dir]) => url.pathname.includes(dir));
    if (lazy) {
      const c = await caches.open(lazy[1]);
      // Audio is stored whole and sliced here: media elements send Range and need a 206.
      if (url.pathname.includes('/audio/')) return taoRange.audioFetch(req, c, fetch);
      const got = await c.match(req);
      if (got) return got;
      const res = await fetch(req);
      if (res.ok) event.waitUntil(c.put(req, res.clone()).catch(() => {})); // keep the worker alive until stored
      return res;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(req);
  })());
});
