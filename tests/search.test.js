import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenize, loadModel, embed, keywords, rank, toInt8 } from '../app/js/search-core.js';

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
