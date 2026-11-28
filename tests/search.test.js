import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenize, loadModel, embed, keywords, rank, toInt8, bytesHash, indexFromFiles, makeIndexLoader, knowsAWord, visibleResults, searchResults, MEANING_FLOOR } from '../app/js/search-core.js';

const root = new URL('../', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('app/model/potion-r29k-256-q4.json', root)));
const bin = readFileSync(new URL('app/model/potion-r29k-256-q4.bin', root));
const model = loadModel(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

test('tokenizer matches the reference WordPiece tokenizer (fixture from HF tokenizers)', () => {
  const fx = JSON.parse(readFileSync(new URL('tests/fixtures/wordpiece.json', root)));
  for (const { text, tokens } of fx) assert.deepEqual(tokenize(text, model.ids), tokens, text.slice(0, 60));
});

test('embeddings are normalized and deterministic; unknown-only text gives null', () => {
  const a = embed(model, 'water wears away stone');
  const n = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(n - 1) < 1e-5);
  assert.deepEqual(embed(model, 'water wears away stone'), a);
  assert.equal(embed(model, '🙂🙂'), null);
});

test('keywords keep content words and single Han characters', () => {
  assert.deepEqual(keywords('What is the Dao of 無為?'), ['dao', '無', '為']);
  assert.deepEqual(keywords('Zhuangzi’s cook'), ['zhuangzi', 'cook']);
});

test('rank: meaning beats wording, and exact names get a bonus', () => {
  const texts = ['one who knows does not speak; one who speaks does not know', 'the price of grain and the tax on salt', 'cook ding carves the ox with a knife that never dulls'];
  const dim = model.dim;
  const vecs = new Int8Array(texts.length * dim);
  texts.forEach((t, i) => vecs.set(toInt8(embed(model, t)), i * dim));
  const idx = { vecs, dim, texts, titles: ['silence', 'tax', 'cook ding'] };
  assert.equal(rank(model, 'talking too much', idx)[0][0], 0);
  assert.equal(rank(model, 'butcher', idx)[0][0], 2);
  assert.equal(rank(model, 'tax', idx, { filter: (d) => d !== 1 })[0][0] === 1, false);
});

// ---- An index and vectors from different builds ----

const toBuf = (a) => new Int8Array(a).buffer;
const IX = { dim: 2, count: 2, vecsHash: '15fa0829', docs: [{ title: 'Café Night' }, { title: 'MORNING' }], text: ['cafe night', 'morning'] };

test('indexFromFiles refuses vectors of the wrong size or another build', () => {
  assert.equal(bytesHash(toBuf([1, -2, 3, -4])), '15fa0829'); // FNV-1a of the bytes 01 fe 03 fc
  const ok = indexFromFiles(IX, toBuf([1, -2, 3, -4]));
  assert.deepEqual([...ok.vecs], [1, -2, 3, -4]);
  assert.deepEqual([ok.dim, ok.titles, ok.texts], [2, ['café night', 'morning'], ['cafe night', 'morning']]);
  const mismatch = (e) => e.code === 'index-mismatch';
  for (const n of [0, 3, 6]) assert.throws(() => indexFromFiles(IX, new Int8Array(n).buffer), mismatch, `${n} values`);
  assert.throws(() => indexFromFiles(IX, toBuf([3, -4, 1, -2])), mismatch, 'same size, other bytes');
  assert.throws(() => indexFromFiles({ ...IX, vecsHash: undefined }, toBuf([1, -2, 3, -4])), mismatch, 'an index that names no hash');
});

// A fetch that serves real Response objects and records each request: [path, init.cache].
function fakeFetch(serve) {
  const asked = [];
  const fn = async (path, init) => { asked.push([path, init?.cache ?? null]); const body = serve(path, asked.length); return body == null ? new Response('no', { status: 404 }) : new Response(body); };
  return { fn, asked };
}
const F = ['data/search/index.json', 'data/search/vecs.bin'];
const good = (path) => (path === F[0] ? JSON.stringify(IX) : toBuf([1, -2, 3, -4]));

test('makeIndexLoader: a mismatch forgets both files and fetches once more; a second mismatch rejects; a failed load is retried', async () => {
  // One mismatched pair, then a good pair after the forget.
  let forgot = [];
  let fixed = false;
  const a = fakeFetch((p) => (fixed ? good(p) : (p === F[0] ? JSON.stringify({ ...IX, vecsHash: '16fa09bc' }) : toBuf([1, -2, 3, -4]))));
  const load = makeIndexLoader({ fetchFn: a.fn, forget: async (paths) => { forgot.push(paths); fixed = true; } });
  const ix = await load();
  assert.deepEqual([...ix.vecs], [1, -2, 3, -4]);
  assert.deepEqual(forgot, [F]);
  assert.deepEqual(a.asked.slice(0, 2).map((x) => x[1]), [null, null]);
  assert.deepEqual(a.asked.slice(2).sort(), [[F[0], 'reload'], [F[1], 'reload']]);
  assert.equal(await load(), ix, 'loaded once');
  assert.equal(a.asked.length, 4);

  // A second mismatch rejects, after one retry only; the next call starts over.
  forgot = [];
  const b = fakeFetch((p) => (p === F[0] ? JSON.stringify({ ...IX, vecsHash: '16fa09bc' }) : toBuf([1, -2, 3, -4])));
  const loadB = makeIndexLoader({ fetchFn: b.fn, forget: async (paths) => { forgot.push(paths); } });
  await assert.rejects(loadB(), (e) => e.code === 'index-mismatch');
  assert.deepEqual([forgot.length, b.asked.length], [1, 4]);
  await assert.rejects(loadB(), (e) => e.code === 'index-mismatch');
  assert.deepEqual([forgot.length, b.asked.length], [2, 8]);

  // Another failure (404) is not retried at once, and the next call tries again.
  let up = false;
  forgot = [];
  const c = fakeFetch((p) => (p === F[0] ? JSON.stringify(IX) : (up ? toBuf([1, -2, 3, -4]) : null)));
  const loadC = makeIndexLoader({ fetchFn: c.fn, forget: async (paths) => { forgot.push(paths); } });
  await assert.rejects(loadC(), /404/);
  assert.deepEqual([forgot.length, c.asked.length], [0, 2]);
  up = true;
  assert.deepEqual([...(await loadC()).vecs], [1, -2, 3, -4]);
});

test('the shipped index names the hash of the shipped vecs.bin', () => {
  const ix = JSON.parse(readFileSync(new URL('app/data/search/index.json', root)));
  const v = readFileSync(new URL('app/data/search/vecs.bin', root));
  const out = indexFromFiles(ix, v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  assert.equal(out.docs.length, ix.count);
});

// ---- Made-up words find nothing ----

test('knowsAWord: zzqxv and asdf qwer are unknown; loneliness and water are known', () => {
  // Made-up words split into word pieces (zzqxv: z ##z ##q ##x ##v): the mean of the pieces is noise.
  for (const q of ['zzqxv', 'asdf qwer', 'xyz', 'qqq', 'blorp', 'the', 'what is it', '', '井', '🙂']) assert.equal(knowsAWord(model, q), false, q);
  for (const q of ['loneliness', 'water', 'my mother died', 'Feeling stuck?']) assert.equal(knowsAWord(model, q), true, q);
  assert.equal(knowsAWord(null, 'water'), false, 'no model yet');
});

test('visibleResults drops meaning-only results for an unknown word and keeps exact ones', () => {
  // [doc, score, exact]: exact = a query word is in the doc's text.
  const shown = (ranked, o) => visibleResults(ranked, o).map(([d]) => d);
  const f = MEANING_FLOOR;
  assert.equal(f, 0.2);
  assert.deepEqual(shown([[0, f + 0.1, false], [1, f, false], [2, f - 0.01, false]]), [0, 1]);
  assert.deepEqual(shown([[0, f + 0.1, false], [1, 0.2, true]], { meaning: false }), [1]);
  // The 60 % cutoff counts only the results that may show.
  assert.deepEqual(shown([[0, 0.5, false], [1, 0.2, true]], { meaning: false }), [1]);
  assert.deepEqual(shown([[0, 0.5, false], [1, 0.2, true]]), [0]);
  assert.deepEqual(shown([[0, 0.3, true], [1, f + 0.02, false]]), [0, 1]);
  assert.deepEqual(shown([]), []);
});

test('rank marks each result exact (a query word is in the text) or meaning only', () => {
  const texts = ['the well in the town', 'water and stone', 'a deep spring'];
  const vecs = new Int8Array(texts.length * model.dim);
  texts.forEach((t, i) => vecs.set(toInt8(embed(model, t)), i * model.dim));
  const idx = { dim: model.dim, vecs, texts, titles: ['the well', 'stone', 'spring'] };
  const exact = (q) => Object.fromEntries(rank(model, q, idx).map(([d, , e]) => [d, e]));
  assert.deepEqual(exact('well'), { 0: true, 1: false, 2: false });
  assert.deepEqual(exact('zzqxv'), { 0: false, 1: false, 2: false });
});

test('shipped index: "zzqxv" shows nothing; "water" and "letting go of control" still show results', () => {
  const ix = JSON.parse(readFileSync(new URL('app/data/search/index.json', root)));
  const v = readFileSync(new URL('app/data/search/vecs.bin', root));
  const index = indexFromFiles(ix, v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  const shown = (q) => visibleResults(rank(model, q, index, { limit: 40 }), { meaning: knowsAWord(model, q) });
  for (const q of ['zzqxv', 'asdf qwer', 'xyz', 'qqq', 'blorp']) assert.equal(shown(q).length, 0, q);
  for (const q of ['water', 'letting go of control']) assert.ok(shown(q).length > 0, q);
});

test('shipped index: an exact word past rank 40 still shows ("Handan" finds its note)', () => {
  const ix = JSON.parse(readFileSync(new URL('app/data/search/index.json', root)));
  const v = readFileSync(new URL('app/data/search/vecs.bin', root));
  const index = indexFromFiles(ix, v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  const shown = searchResults(model, 'Handan', index);
  assert.ok(shown.length > 0, 'Handan shows results');
  assert.ok(shown.some(([d]) => index.docs[d].type === 'note' && index.texts[d].includes('handan')), 'a note that names Handan shows');
  assert.ok(shown.length <= 40, 'at most 40 are shown');
  assert.ok(searchResults(model, 'water', index).length <= 40);
});
