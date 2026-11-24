import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document ??= { createDocumentFragment: () => ({}), createTextNode: (t) => t };
const { refSegments } = await import('../app/js/notes.js');
const links = (t) => refSegments(t).filter((s) => s.n).map((s) => s.n);

test('passage references link, with lists and ranges', () => {
  assert.deepEqual(links('see passage 73'), [73]);
  assert.deepEqual(links('passages 22, 24, and 57'), [22, 24, 57]);
  assert.deepEqual(links('passages 22, 28 and 39'), [22, 28, 39]);
  assert.deepEqual(links('the Dao part (chapters 1–37)'), [1, 37]);
  assert.deepEqual(links('it becomes vessels” (28). The'), [28]);
  assert.deepEqual(links('admires itself (22, 24). And'), [22, 24]);
  assert.deepEqual(links('see (1–3) and (40 and 41)'), [1, 3, 40, 41]);
  assert.deepEqual(links('Laozi 24 uses it; Daodejing 40'), [24, 40]);
  assert.deepEqual(links('Daodejing ch.63: plan'), [63]);
});

test('other books and out-of-range numbers do not link', () => {
  assert.deepEqual(links('The Zhuangzi (chapter 14) tells'), []);
  assert.deepEqual(links('The Zhuangzi has a near twin. Chapter 12 lists'), []); // the Zhuangzi's chapter 12
  assert.deepEqual(links('as the Zhuangzi says of fish (6). Then'), []);
  assert.deepEqual(links('Baoyu reads it again in chapter 5'), []);
  assert.deepEqual(links('passage 99'), []);
  assert.deepEqual(links('in 1993 (a year)'), []);
});

test('text is preserved exactly', () => {
  const t = 'Compare passages 22, 24, and 57 (and 61) with Laozi 40.';
  assert.equal(refSegments(t).map((s) => s.text).join(''), t);
});

test('"to" ranges link both ends', () => {
  assert.deepEqual(links('passages 29 to 31 address'), [29, 31]);
  assert.deepEqual(links('Passages 72 to 75 stand together'), [72, 75]);
  assert.deepEqual(links('passage 5 to the end'), [5]);
});
