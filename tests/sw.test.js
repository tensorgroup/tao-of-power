// The service worker, run in a sandbox with in-memory caches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const ORIGIN = 'https://app.example';
// In a service worker a relative URL resolves against the worker's own address.
class SwRequest extends Request { constructor(input, init) { super(typeof input === 'string' ? new URL(input, `${ORIGIN}/`).href : input, init); } }
/** store: the CacheStorage, shared by two worker versions in one test; src: the worker's code. */
function loadSw(fetchLog, { store = new Map(), src = read('app/sw.js') } = {}) {
  const on = {};
  let online = true;
  const keyOf = (r, ignoreSearch) => { const u = new URL(typeof r === 'string' ? r : r.url, `${ORIGIN}/`); if (ignoreSearch) u.search = ''; return u.href; };
  const open = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      match: async (r, o) => m.get(keyOf(r, o?.ignoreSearch))?.clone(),
      put: async (r, res) => { m.set(keyOf(r), res); },
      // All or nothing, as the Cache API: one failed request leaves the cache as it was.
      addAll: async (list) => { if (!online) throw new TypeError('Failed to fetch'); for (const r of list) m.set(keyOf(r), new Response(`file ${keyOf(r)}`)); },
      keys: async () => [...m.keys()].map((u) => new Request(u)),
      delete: async (r) => m.delete(keyOf(r)),
    };
  };
  const sandbox = {
    self: { addEventListener: (t, f) => { on[t] = f; }, skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => [] }, registration: { scope: `${ORIGIN}/` } },
    caches: { open: async (n) => open(n), has: async (n) => store.has(n), keys: async () => [...store.keys()], delete: async (n) => store.delete(n) },
    fetch: async (req) => {
      if (!online) throw new TypeError('Failed to fetch');
      fetchLog.push(new URL(req.url).pathname);
      return new Response(`net ${req.url}`, { status: 200 });
    },
    location: new URL(`${ORIGIN}/`), URL, Request: SwRequest, Response, console,
  };
  // As in a worker: the scripts run in the worker's own global scope, paths relative to the worker (app/).
  sandbox.importScripts = (...paths) => { for (const p of paths) vm.runInContext(read(`app/${p}`), ctx); };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src, ctx);
  const names = vm.runInContext('({ CACHE, MODEL_CACHE, SEARCH_CACHE, AUDIO_CACHE, LISTEN_CACHE })', ctx);
  const run = async (type, extra = {}) => { const waits = []; on[type]({ waitUntil: (p) => waits.push(p), ...extra }); await Promise.all(waits); };
  async function get(path, headers = {}, init = {}) {
    let answer = null;
    const waits = [];
    on.fetch({ request: new Request(`${ORIGIN}${path}`, { headers, ...init }), respondWith: (p) => { answer = Promise.resolve(p); }, waitUntil: (p) => waits.push(p) });
    const res = answer && await answer;
    await Promise.all(waits);
    return res;
  }
  return { store, names, run, get, setOnline: (v) => { online = v; } };
}

test('a failed update never deletes the shell cache that the running worker serves', async () => {
  const store = new Map();
  const v1 = loadSw([], { store });
  await v1.run('install');
  const shell = v1.names.CACHE;
  const before = [...store.get(shell).keys()];
  assert.ok(before.length > 50, `${before.length} files in the shell`);
  // A release that changes only a lazy folder: sw.js has new bytes, so the browser installs it, under the same shell name.
  const src = read('app/sw.js').replace(/const MODEL_VERSION = '[0-9a-f]+';/, "const MODEL_VERSION = '00000000';");
  const v2 = loadSw([], { store, src });
  assert.equal(v2.names.CACHE, shell);
  assert.notEqual(v2.names.MODEL_CACHE, v1.names.MODEL_CACHE);
  v2.setOnline(false); // the update fails half way: the phone went offline
  await assert.rejects(v2.run('install'));
  assert.deepEqual([...(store.get(shell)?.keys() ?? [])], before, 'the old shell keeps every file');
  v1.setOnline(false);
  assert.equal(await (await v1.get('/')).text(), `file ${ORIGIN}/`, 'and the app still opens offline');
});

test('a failed first install deletes the cache it made', async () => {
  const sw = loadSw([]);
  sw.setOnline(false);
  await assert.rejects(sw.run('install'));
  assert.equal(sw.store.has(sw.names.CACHE), false);
});

test('a lazy file asked for with cache reload comes from the network and replaces the cached copy', async () => {
  const log = [];
  const sw = loadSw(log);
  await sw.run('install');
  const path = '/data/search/index.json';
  const first = await sw.get(path);
  assert.equal(await first.text(), `net ${ORIGIN}${path}`);
  const cache = sw.store.get(sw.names.SEARCH_CACHE);
  cache.set(`${ORIGIN}${path}`, new Response('stale copy'));
  log.length = 0;
  assert.equal(await (await sw.get(path)).text(), 'stale copy', 'a plain request is answered from the cache');
  assert.deepEqual(log, []);
  const fresh = await sw.get(path, {}, { cache: 'reload' });
  assert.equal(await fresh.text(), `net ${ORIGIN}${path}`, 'reload goes to the network');
  assert.deepEqual(log, [path]);
  assert.equal(await cache.get(`${ORIGIN}${path}`).text(), `net ${ORIGIN}${path}`, 'and replaces the cached copy');
});
