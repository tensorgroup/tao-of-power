import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  randInt, splitSticks, bundleRemainder, castLine, drawTetragram,
  passageNumber, linesFor, lineFromTotal,
} from '../app/js/draw.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/arrangement.json', import.meta.url)));

test('formula basics', () => {
  assert.equal(passageNumber([0, 0, 0, 0]), 1);
  assert.equal(passageNumber([2, 2, 2, 2]), 81);
  assert.equal(passageNumber([0, 1, 0, 0]), 4);
  assert.equal(passageNumber([1, 0, 0, 0]), 2);
});

test('linesFor round-trips for all 81', () => {
  for (let n = 1; n <= 81; n++) assert.equal(passageNumber(linesFor(n)), n);
});

test('matches hand-read Tetragram Arrangement page', () => {
  for (const [n, topToBottom] of Object.entries(fixture.cells)) {
    const bottomToTop = [...topToBottom].reverse();
    assert.equal(passageNumber(bottomToTop), Number(n), `passage ${n}`);
  }
});

test('every split gives 3/4/5 with exact odds 630/693/630', () => {
  const counts = [0, 0, 0];
  for (let a = 1; a <= 62; a++) {
    for (let b = 1; a + b <= 63; b++) {
      const c = 64 - a - b;
      const total = bundleRemainder(a) + bundleRemainder(b) + bundleRemainder(c);
      assert.ok([3, 4, 5].includes(total), `total ${total}`);
      counts[lineFromTotal(total)]++;
    }
  }
  assert.deepEqual(counts, [630, 693, 630]);
});

test('bundleRemainder: 0 becomes 1', () => {
  assert.equal(bundleRemainder(3), 1);
  assert.equal(bundleRemainder(4), 1);
  assert.equal(bundleRemainder(5), 2);
});

test('randInt rejects values in the biased zone', () => {
  // max=3: limit = floor(2^32 / 3) * 3 = 4294967295; value 4294967295 is rejected.
  const values = [4294967295, 7];
  let calls = 0;
  const rng = (arr) => { arr[0] = values[calls++]; };
  assert.equal(randInt(3, rng), 7 % 3);
  assert.equal(calls, 2);
});

test('splitSticks: three non-empty bundles summing to 64', () => {
  for (let i = 0; i < 2000; i++) {
    const b = splitSticks();
    assert.equal(b.length, 3);
    assert.equal(b[0] + b[1] + b[2], 64);
    assert.ok(b.every((x) => x >= 1));
  }
});

test('castLine and drawTetragram are consistent', () => {
  const c = castLine();
  assert.equal(c.total, c.bundles.reduce((s, x) => s + bundleRemainder(x), 0));
  assert.equal(c.line, lineFromTotal(c.total));
  const d = drawTetragram();
  assert.equal(d.casts.length, 4);
  assert.deepEqual(d.lines, d.casts.map((x) => x.line));
  assert.equal(d.n, passageNumber(d.lines));
});
