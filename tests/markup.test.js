import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarked, noteIds, hanChars } from '../app/js/markup.js';

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
