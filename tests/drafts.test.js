import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftWriter, releaseDrafts, setDraftGate, typedText } from '../app/js/drafts.js';

/** One draft key in storage. */
function key(v = '') {
  let s = v;
  return { load: () => s, save: (x) => { s = x; }, get v() { return s; }, set v(x) { s = x; } };
}
const writer = (k, value, opts = {}) => draftWriter({ load: k.load, save: k.save, value, ...opts });
const openGate = (fn) => { fn(); return true; };

test('a delayed draft write runs once after the delay; flush writes at once, and only when something is unsaved', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const k = key();
  let text = 'a';
  const w = writer(k, () => text, { delay: 600 });
  w.schedule(); w.schedule();
  t.mock.timers.tick(599);
  assert.equal(k.v, '');
  t.mock.timers.tick(1);
  assert.equal(k.v, 'a');
  text = 'ab';
  w.schedule();
  w.flush();
  assert.equal(k.v, 'ab');
  k.v = 'changed elsewhere';
  w.flush();
  assert.equal(k.v, 'changed elsewhere', 'nothing unsaved: flush writes nothing');
  w.release();
});

test('A8: the last writer wins: an editor writes its text over a draft another tab wrote', () => {
  const k = key('first');
  const w = writer(k, () => 'this editor');
  k.v = 'from another tab';
  w.schedule();
  assert.equal(k.v, 'this editor');
  w.release();
});

test('S4: clearIf removes the draft only while it still holds the saved text', () => {
  const k = key();
  let text = 'saved text';
  const w = writer(k, () => text);
  w.schedule();
  w.clearIf('saved text');
  assert.equal(k.v, '');
  text = 'typed after';
  w.schedule();
  w.clearIf('saved text');
  assert.equal(k.v, 'typed after', 'newer text stays');
  w.release();
});

test('S4: margin note: the editor released after a save writes nothing, so the saved text does not come back as a draft', () => {
  const k = key();
  const ta = { value: '' };
  const w = writer(k, () => ta.value);
  ta.value = 'a note'; w.schedule(); // written as typed
  w.flush(); // Save
  w.clearIf('a note'); // saved: the draft goes
  w.release(); // render() builds a new editor and releases this one; its box still shows the text
  assert.equal(k.v, '');
});

test('S2: while the gate is closed a write is queued once, and writes the text of that time, also after release', () => {
  const queue = [];
  setDraftGate((fn) => { queue.push(fn); return false; });
  const k = key();
  let text = 'a';
  const w = writer(k, () => text);
  w.schedule(); text = 'ab'; w.schedule(); text = 'abc';
  w.release();
  assert.equal(queue.length, 1, 'one queued write, not one per key');
  setDraftGate(openGate);
  queue[0]();
  assert.equal(k.v, 'abc');
});

test('S4: releaseDrafts writes what is unsaved and ends every open writer (the text box and the question line)', () => {
  const t = key(); const q = key('null');
  let text = ''; let qv = 'null';
  const a = writer(t, () => text, { delay: 600 });
  const b = writer(q, () => qv, { delay: 600 });
  text = 'half a thought'; a.schedule();
  qv = '{"id":"q1"}'; b.schedule();
  releaseDrafts(); // navigation: both timers are still waiting
  assert.deepEqual([t.v, q.v], ['half a thought', '{"id":"q1"}']);
  text = 'later'; a.schedule(); a.flush();
  assert.equal(t.v, 'half a thought', 'ended');
});

test('A8: a writer made before a removal writes nothing until the reader types again after it', () => {
  let gen = 'g1';
  setDraftGate(openGate, () => gen);
  const k = key();
  let text = 'before';
  const w = writer(k, () => text);
  w.schedule();
  assert.equal(k.v, 'before');
  text = 'typed, not yet written';
  gen = 'g2'; k.v = ''; // "Remove it from this browser" in another tab
  w.flush(); // pagehide: the old text must not come back
  assert.equal(k.v, '');
  text = 'typed after the removal';
  w.schedule();
  assert.equal(k.v, 'typed after the removal', 'then it writes as usual');
  w.release();
  setDraftGate(openGate);
});

test('A8: a released writer\'s queued write keeps its latest text; a removal before the queue runs still stops it', () => {
  let gen = 'g1';
  const queue = [];
  setDraftGate((fn) => { queue.push(fn); return false; }, () => gen);
  const k = key('stored');
  let text = 'more';
  const w = writer(k, () => text);
  w.schedule();
  w.release();
  text = 'more, typed on';
  gen = 'g2'; k.v = ''; // the removal ended
  queue.shift()();
  assert.equal(k.v, '', 'the removal wins over text typed before it');
  const k2 = key('stored');
  const w2 = writer(k2, () => text);
  w2.schedule(); w2.release();
  queue.shift()(); // the removal stopped: no new value
  assert.equal(k2.v, 'more, typed on');
  setDraftGate(openGate);
});

test('A8: a write that storage refused (full) is still unsaved: the next flush tries again', () => {
  let full = true;
  let v = '';
  const w = draftWriter({ load: () => v, save: (x) => { if (full) return false; v = x; return true; }, value: () => 'text' });
  w.schedule();
  assert.equal(v, '');
  full = false;
  w.flush();
  assert.equal(v, 'text');
  w.release();
});

test('A7: typedText is true when a text box holds text that differs from its saved text (defaultValue)', () => {
  const a = { value: '  ', defaultValue: '' }; const b = { value: 'words', defaultValue: '' };
  const root = { querySelectorAll: () => [a, b] };
  assert.equal(typedText(root), true, 'a new box with text');
  b.value = '';
  assert.equal(typedText(root), false);
  const edit = { value: 'saved text', defaultValue: 'saved text' };
  assert.equal(typedText({ querySelectorAll: () => [edit] }), false, 'an open edit with no change');
  edit.value = 'saved text, revised';
  assert.equal(typedText({ querySelectorAll: () => [edit] }), true);
});
