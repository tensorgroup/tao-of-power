import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftWriter, discardDrafts, openDrafts } from '../app/js/drafts.js';

test('a delayed draft write runs once after the delay; flush writes at once and stops the timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const w = draftWriter(() => writes.push('w'), { delay: 600 });
  w.schedule(); w.schedule();
  t.mock.timers.tick(599);
  assert.equal(writes.length, 0);
  t.mock.timers.tick(1);
  assert.equal(writes.length, 1);
  w.schedule();
  w.flush();
  assert.equal(writes.length, 2);
  t.mock.timers.tick(1000);
  assert.equal(writes.length, 2, 'the timer stopped at flush: no late write');
  w.release();
});

test('discardDrafts stops every open writer without writing; a late timer or flush writes nothing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const a = draftWriter(() => writes.push('a'), { delay: 600 });
  const b = draftWriter(() => writes.push('b'));
  a.schedule();
  discardDrafts();
  t.mock.timers.tick(1000);
  a.flush(); a.schedule(); b.schedule(); b.flush();
  assert.deepEqual(writes, []);
});

test('release ends a writer: it leaves the open set and writes nothing more', () => {
  const writes = [];
  const before = openDrafts();
  const w = draftWriter(() => writes.push('w'));
  assert.equal(openDrafts(), before + 1);
  w.release();
  assert.equal(openDrafts(), before);
  w.schedule(); w.flush();
  assert.deepEqual(writes, []);
});
