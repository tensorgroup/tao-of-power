import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPlan, wrapWords, wordCell } from '../app/js/words.js';
import { wordsOf } from '../app/js/markup.js';

test('a word split over two nodes gives two pieces with one index', () => {
  const nodes = ['Be like the sage', '’s way'];
  const plan = splitPlan(nodes);
  assert.deepEqual(plan.words, ['Be', 'like', 'the', 'sage’s', 'way']);
  assert.deepEqual(plan.pieces[3], [
    { start: 12, end: 16, word: 'sage' },
    { start: 0, end: 2, word: '’s' },
  ]);
  assert.equal(plan.pieces[4].length, 1);
  assert.deepEqual(plan.pieces[4][0], { start: 3, end: 6, word: 'way' });
});

test('words equal wordsOf on the joined text', () => {
  const nodes = ['“Know the male,', '', ' — ', 'keep the female.”'];
  assert.deepEqual(splitPlan(nodes).words, wordsOf(nodes.join('')).map((w) => w.word));
});

test('punctuation-only and empty nodes give no words', () => {
  assert.deepEqual(splitPlan(['', ' — ', '“”']), { words: [], pieces: [] });
  assert.deepEqual(splitPlan([]), { words: [], pieces: [] });
});

function fakeSpan() {
  const set = new Set(); const attrs = {};
  return {
    set, attrs,
    classList: {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      toggle: (c, on) => { if (on) set.add(c); else set.delete(c); return !!on; },
    },
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
    getBoundingClientRect: () => ({ left: 7 }),
  };
}

test('wordCell sends class calls to every span, aria to the first, rect from the first', () => {
  const a = fakeSpan(); const b = fakeSpan(); b.getBoundingClientRect = () => ({ left: 99 });
  const cell = wordCell([a, b]);
  cell.classList.add('now', 'done');
  assert.deepEqual([...a.set], ['now', 'done']);
  assert.deepEqual([...b.set], ['now', 'done']);
  cell.classList.remove('now', 'done');
  assert.equal(a.set.size + b.set.size, 0);
  cell.classList.toggle('now', true);
  assert.ok(a.set.has('now') && b.set.has('now'));
  cell.classList.toggle('now', false);
  assert.equal(a.set.size + b.set.size, 0);
  cell.setAttribute('aria-current', 'true');
  assert.equal(a.attrs['aria-current'], 'true');
  assert.equal('aria-current' in b.attrs, false);
  cell.removeAttribute('aria-current');
  assert.equal('aria-current' in a.attrs, false);
  assert.deepEqual(cell.getBoundingClientRect(), { left: 7 });
});

// Minimal fake DOM: text nodes with splitText/replaceWith, spans, a tree walker over the initial text nodes.
function fakeDoc(texts) {
  const text = (data, parent) => ({
    data, parent,
    splitText(i) {
      const t = text(this.data.slice(i), this.parent);
      this.data = this.data.slice(0, i);
      this.parent.kids.splice(this.parent.kids.indexOf(this) + 1, 0, t);
      return t;
    },
    replaceWith(el) { el.parent = this.parent; this.parent.kids.splice(this.parent.kids.indexOf(this), 1, el); },
  });
  const line = { kids: [] };
  line.kids = texts.map((t) => text(t, line));
  const initial = [...line.kids];
  line.ownerDocument = {
    createTreeWalker: () => { let i = 0; return { nextNode: () => initial[i++] || null }; },
    createElement: () => ({ kids: [], dataset: {}, appendChild(k) { k.parent = this; this.kids.push(k); }, get textContent() { return this.kids.map((k) => k.data).join(''); } }),
  };
  return line;
}

test('wrapWords returns the spans of a split word in node order', () => {
  const line = fakeDoc(['Be like the sage', '’s way']);
  const { words, cells } = wrapWords(line, 10);
  assert.deepEqual(words, ['Be', 'like', 'the', 'sage’s', 'way']);
  assert.deepEqual(cells[3].map((s) => s.textContent), ['sage', '’s']);
  assert.deepEqual(cells.map((c) => c[0].dataset.w), ['10', '11', '12', '13', '14']);
});
