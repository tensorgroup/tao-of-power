import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSearchCounter } from '../app/js/search-count.js';

// Fake timers: tick(ms) moves the clock and fires the timers that fall due.
function setup({ onPage = () => true } = {}) {
  let now = 0;
  let next = 1;
  const timers = new Map();
  const calls = [];
  const counter = makeSearchCounter({
    track: (...a) => calls.push(a),
    onPage: () => onPage(),
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
  });
  const tick = (ms) => {
    now += ms;
    for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
  };
  return { counter, calls, tick };
}

test('one search typed in steps is counted once, with its filter', () => {
  const t = setup();
  for (const q of ['g', 'gr', 'gri', 'grief']) { t.counter.count(q, 'note'); t.tick(300); }
  assert.deepEqual(t.calls, []);
  t.tick(1500);
  assert.deepEqual(t.calls, [['search', 'note']]);
});

test('the same query and filter twice is counted once; a new filter counts again', () => {
  const t = setup();
  t.counter.count('grief', 'all'); t.tick(1500);
  t.counter.count('grief', 'all'); t.tick(1500);
  assert.deepEqual(t.calls, [['search', 'all']]);
  t.counter.count('grief', 'story'); t.tick(1500);
  assert.deepEqual(t.calls, [['search', 'all'], ['search', 'story']]);
});

test('a search left before the delay is not counted', () => {
  let here = true;
  const t = setup({ onPage: () => here });
  t.counter.count('grief', 'all');
  t.tick(1000);
  here = false; // the reader went to another page
  t.tick(1000);
  assert.deepEqual(t.calls, []);
});

test('clearing the box cancels the pending count', () => {
  const t = setup();
  t.counter.count('grief', 'all');
  t.tick(500);
  t.counter.count('', 'all');
  t.tick(3000);
  assert.deepEqual(t.calls, []);
  t.counter.count('rain', 'all');
  t.counter.cancel();
  t.tick(3000);
  assert.deepEqual(t.calls, []);
});
