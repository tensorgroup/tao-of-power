import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMarked, noteIds, hanChars, passageChars, segmentsFor } from '../app/js/markup.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../app/data/${f}`, import.meta.url)));
const text = load('text.json');
const p1 = load('passages/01.json');
const p2 = load('passages/02.json');

test('plain text is one segment', () => {
  assert.deepEqual(parseMarked('just words'), [{ text: 'just words' }]);
});

test('two marks in one line', () => {
  assert.deepEqual(parseMarked('a [[Way|dao]] and [[name|ming]].'), [
    { text: 'a ' }, { text: 'Way', note: 'dao' }, { text: ' and ' }, { text: 'name', note: 'ming' }, { text: '.' },
  ]);
  assert.deepEqual(noteIds('a [[Way|dao]] and [[name|ming]].'), ['dao', 'ming']);
});

test('unclosed mark stays literal', () => {
  assert.deepEqual(parseMarked('a [[Way|dao and'), [{ text: 'a [[Way|dao and' }]);
});

test('empty string gives one empty segment', () => {
  assert.deepEqual(parseMarked(''), [{ text: '' }]);
});

test('hanChars keeps only Han characters', () => {
  assert.deepEqual(hanChars('道可道，非常道'), ['道', '可', '道', '非', '常', '道']);
});

test('passageChars counts Han code points per segment and across the passage', () => {
  const c = passageChars(['道可道，非', '常道。']);
  assert.equal(c.length, 6);
  assert.deepEqual(c[3], { ch: '非', seg: 0, k: 4, i: 3 });
  assert.deepEqual(c[5], { ch: '道', seg: 1, k: 1, i: 5 });
});

test('segmentsFor prefers the passage file text', () => {
  assert.equal(segmentsFor(text[0], p1)[0], p1.zh[0].text);
  assert.deepEqual(segmentsFor(text[0], null), text[0].zh);
});

test('passage 1 has 59 characters and passage 2 has 惡 at i 9, seg 0, k 10', () => {
  assert.equal(passageChars(segmentsFor(text[0], p1)).length, 59);
  assert.deepEqual(passageChars(segmentsFor(text[1], p2))[9], { ch: '惡', seg: 0, k: 10, i: 9 });
});
