// POST /api/e in worker/index.js: anonymous usage events into D1 (tao_analytics).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { fakeD1 } from './helpers/fake-d1.js';
import { chunked } from './helpers/stream.js';

const ORIGIN = 'https://tao.tensor.group';
const URL_E = `${ORIGIN}/api/e`;
const SCHEMA = new URL('../worker/schema.sql', import.meta.url).pathname;

const env = (extra = {}) => ({ tao_analytics: fakeD1(SCHEMA), ORIGIN, ASSETS: { fetch: () => new Response('asset') }, ...extra });
const rows = (e) => e.tao_analytics.raw.prepare('SELECT * FROM events ORDER BY id').all();
const post = (body, headers = { origin: ORIGIN }) => new Request(URL_E, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('analytics refuses a chunked body over 4000 bytes', async () => {
  const e = env();
  const { body, seen } = chunked(Array.from({ length: 64 }, () => new Uint8Array(1024).fill(0x20))); // 64 KiB
  const req = new Request(URL_E, { method: 'POST', headers: { origin: ORIGIN }, body, duplex: 'half' });
  assert.equal(req.headers.get('content-length'), null);
  assert.equal((await worker.fetch(req, e)).status, 413);
  assert.equal(seen.pulled, 4, 'the 4th chunk passes 4000 bytes: no chunk after it is read');
  assert.equal(seen.cancelled, true);
  assert.equal(rows(e).length, 0);
});

test('analytics refuses a content-length over the cap before any read', async () => {
  const e = env();
  const { body, seen } = chunked([new TextEncoder().encode(JSON.stringify({ ev: 'view' }))]);
  const req = new Request(URL_E, { method: 'POST', headers: { origin: ORIGIN, 'content-length': '4001' }, body, duplex: 'half' });
  assert.equal((await worker.fetch(req, e)).status, 413);
  assert.equal(seen.pulled, 0);
  assert.equal(rows(e).length, 0);
});

test('analytics counts bytes, not characters', async () => {
  const e = env();
  const body = JSON.stringify({ ev: 'view', detail: '道'.repeat(1500) });
  assert.ok(body.length < 4000);
  assert.ok(new TextEncoder().encode(body).length > 4000);
  assert.equal((await worker.fetch(post(body), e)).status, 413);
  assert.equal(rows(e).length, 0);
});

test('a chunked analytics body under the cap is stored, with a character split across chunks', async () => {
  const e = env();
  const bytes = new TextEncoder().encode(JSON.stringify({ ev: 'say', detail: '道 dào', vid: 't' }));
  const cut = bytes.indexOf(0xE9) + 1; // after the first of 道's three bytes (E9 81 93)
  assert.ok(cut > 0);
  const { body } = chunked([bytes.slice(0, cut), bytes.slice(cut)]);
  const res = await worker.fetch(new Request(URL_E, { method: 'POST', headers: { origin: ORIGIN }, body, duplex: 'half' }), e);
  assert.equal(res.status, 204);
  assert.deepEqual(rows(e).map((x) => [x.ev, x.detail]), [['say', '道 dào']]);
});

const count = (e) => rows(e).length;

test('DNT: 1 or Sec-GPC: 1 stores nothing and answers 204', async () => {
  for (const extra of [{ dnt: '1' }, { 'sec-gpc': '1' }]) {
    const e = env();
    const { body, seen } = chunked([new TextEncoder().encode(JSON.stringify({ ev: 'view', path: '/p/1' }))]);
    const res = await worker.fetch(new Request(URL_E, { method: 'POST', headers: { origin: ORIGIN, ...extra }, body, duplex: 'half' }), e);
    assert.equal(res.status, 204, JSON.stringify(extra));
    assert.equal(seen.pulled, 0, 'the body is not read');
    assert.equal(count(e), 0);
  }
  const e = env();
  await worker.fetch(post({ ev: 'view' }, { origin: ORIGIN, dnt: '0', 'sec-gpc': '0' }), e);
  assert.equal(count(e), 1, 'a 0 is no opt-out');
});

test('another site\'s Origin stores nothing', async () => {
  const e = env();
  const res = await worker.fetch(post({ ev: 'view', path: '/x' }, { origin: 'https://evil.example' }), e);
  assert.equal(res.status, 204);
  assert.equal(count(e), 0);
});

test('no Origin: stored only with Sec-Fetch-Site same-origin', async () => {
  const e = env();
  for (const headers of [{}, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
    assert.equal((await worker.fetch(post({ ev: 'view', path: '/x' }, headers), e)).status, 204);
  }
  assert.equal(count(e), 0);
  await worker.fetch(post({ ev: 'view', path: '/ok' }, { 'sec-fetch-site': 'same-origin' }), e);
  assert.deepEqual(rows(e).map((x) => x.path), ['/ok']);
});

test('over EVENTS_LIMIT stores nothing; no binding still stores', async () => {
  const keys = [];
  let allow = true;
  const e = env({ EVENTS_LIMIT: { limit: async ({ key }) => { keys.push(key); return { success: allow }; } } });
  await worker.fetch(post({ ev: 'view', path: '/a' }, { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.9' }), e);
  allow = false;
  const res = await worker.fetch(post({ ev: 'view', path: '/b' }, { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.9' }), e);
  assert.equal(res.status, 204);
  assert.deepEqual(rows(e).map((x) => x.path), ['/a']);
  assert.deepEqual(keys, ['203.0.113.9', '203.0.113.9']);
  assert.ok(!JSON.stringify(rows(e)).includes('203.0.113.9'), 'the IP is never stored');
  const open = env(); // no binding: analytics fails open (unlike sync)
  await worker.fetch(post({ ev: 'view' }), open);
  assert.equal(count(open), 1);
});

test('a known event from our page is stored; an unknown name is not', async () => {
  const e = env();
  const res = await worker.fetch(post([{ ev: 'view', path: '/p/1', vid: 'v' }, { ev: 'made-up', path: '/x' }]), e);
  assert.equal(res.status, 204);
  assert.deepEqual(rows(e).map((x) => [x.ev, x.path, x.vid]), [['view', '/p/1', 'v']]);
});

test('a path or prev that is not in the shape of a route is stored as unknown', async () => {
  const e = env();
  await worker.fetch(post([
    { ev: 'view', path: '/p/12', prev: '/journal' },
    { ev: 'view', path: '/', prev: null },
    { ev: 'view', path: '/search?q=private words', prev: '/p/1?d=abc' },
    { ev: 'view', path: 'unknown', prev: '#/search/grief' },
    { ev: 'view', path: '/Journal', prev: 42 },
  ]), e);
  assert.deepEqual(rows(e).map((x) => [x.path, x.prev]), [
    ['/p/12', '/journal'],
    ['/', null],
    ['unknown', 'unknown'],
    ['unknown', 'unknown'],
    ['unknown', 'unknown'],
  ]);
});
