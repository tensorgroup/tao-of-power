import { test } from 'node:test';
import assert from 'node:assert/strict';

// sw-range.js is a classic script (the service worker loads it with importScripts).
await import('../app/js/sw-range.js');
const { parseRange, sliceResponse, audioFetch } = globalThis.taoRange;

const bytes = (n) => Uint8Array.from({ length: n }, (_, i) => i % 256);
const full = (n = 100) => new Response(bytes(n), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });

// A small Map-backed stand-in for the Cache API (keys by URL).
function stubCache() {
  const m = new Map();
  return {
    m,
    async match(req) { const r = m.get(req.url); return r ? r.clone() : undefined; },
    async put(req, res) { m.set(req.url, res.clone()); },
  };
}

test('parseRange reads the usual forms', () => {
  assert.equal(parseRange(null, 100), null);
  assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(parseRange('bytes=100-', 1000), { start: 100, end: 999 });
  assert.deepEqual(parseRange('bytes=-50', 1000), { start: 950, end: 999 });
  assert.deepEqual(parseRange('bytes=0-999999', 100), { start: 0, end: 99 });
});

test('parseRange marks unsatisfiable or malformed ranges invalid', () => {
  assert.equal(parseRange('bytes=5000-', 100), 'invalid');
  assert.equal(parseRange('bytes=50-10', 100), 'invalid');
  assert.equal(parseRange('bytes=-0', 100), 'invalid');
  assert.equal(parseRange('items=0-5', 100), 'invalid');
  assert.equal(parseRange('bytes=0-', 0), 'invalid');
});

test('sliceResponse answers 206 with the right bytes and headers', async () => {
  const res = await sliceResponse(full(1000), 'bytes=100-199');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('Content-Range'), 'bytes 100-199/1000');
  assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(res.headers.get('Content-Length'), '100');
  assert.equal(res.headers.get('Content-Type'), 'audio/mpeg');
  const got = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual(got, bytes(1000).slice(100, 200));
});

test('sliceResponse answers 416 for an unsatisfiable range', async () => {
  const res = await sliceResponse(full(100), 'bytes=5000-');
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('Content-Range'), 'bytes */100');
});

test('sliceResponse returns the response unchanged with no Range header', async () => {
  const f = full(100);
  assert.equal(await sliceResponse(f, null), f);
});

test('audioFetch fetches without Range, stores the 200, answers 206', async () => {
  const cache = stubCache();
  const calls = [];
  const fetchFn = async (r) => { calls.push(r); return full(100); };
  const req = new Request('https://x.test/audio/passages/01.zh.abc.mp3', { headers: { Range: 'bytes=10-19' } });
  const res = await audioFetch(req, cache, fetchFn);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get('Range'), null);
  assert.equal(calls[0].url, 'https://x.test/audio/passages/01.zh.abc.mp3');
  assert.equal(cache.m.size, 1);
  assert.equal(cache.m.get(req.url).status, 200);
  assert.equal(res.status, 206);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes(100).slice(10, 20));

  // Second call: offline, served from the cache.
  const res2 = await audioFetch(req, cache, async () => { throw new Error('offline'); });
  assert.equal(res2.status, 206);
  assert.equal(res2.headers.get('Content-Range'), 'bytes 10-19/100');
});

test('audioFetch returns a 404 as it is and does not store it', async () => {
  const cache = stubCache();
  const req = new Request('https://x.test/audio/nope.mp3', { headers: { Range: 'bytes=0-' } });
  const res = await audioFetch(req, cache, async () => new Response('no', { status: 404 }));
  assert.equal(res.status, 404);
  assert.equal(cache.m.size, 0);
});
