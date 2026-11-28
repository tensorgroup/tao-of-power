import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeState } from '../app/js/store.js';
import { emptyJournal, addEntry, recordDraw, replaceJournal, load, save, snapshot, keptSnapshot, SNAPSHOT_KEY } from '../app/js/journal.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

/** `open`: no tab removes the journal. Closed, the gate keeps each write in `queue` (as the syncer does). */
function setup() {
  const st = memStorage();
  const toasts = [];
  const queue = [];
  let open = true;
  let full = false;
  let saved = 0;
  let before = () => {}; // what the gate does first (the syncer reloads a tab that missed a removal)
  const state = makeState({
    load: () => load(st),
    save: (j) => (full ? { ok: false, error: 'storage full' } : save(j, st)),
    gate: (fn) => { before(); if (open) { fn(); return true; } queue.push(fn); return false; },
    toast: (m) => toasts.push(m),
    onSaved: () => { saved++; },
  });
  return {
    st, state, toasts, queue,
    set open(v) { open = v; }, set full(v) { full = v; }, set before(f) { before = f; },
    get saved() { return saved; },
    drain() { open = true; for (const fn of queue.splice(0)) fn(); },
  };
}
const texts = (j) => j.entries.map((e) => e.text);

test('a change saves, merged with what another tab stored; after() runs', () => {
  const s = setup();
  const there = emptyJournal();
  addEntry(there, { passage: 2, text: 'other tab' });
  save(there, s.st);
  let after = 0;
  assert.equal(s.state.change(() => addEntry(s.state.journal, { passage: 1, text: 'here' }), () => { after++; }), true);
  assert.deepEqual(texts(load(s.st)).sort(), ['here', 'other tab']);
  assert.deepEqual([s.saved, after], [1, 1]);
});

test('S2: during a removal a change waits; it runs later on the journal then in memory, and after() runs then (the editor keeps its text until then)', () => {
  const s = setup();
  s.open = false;
  let after = 0;
  assert.equal(s.state.change(() => addEntry(s.state.journal, { passage: 1, text: 'typed during the removal' }), () => { after++; }), false);
  assert.deepEqual([load(s.st).entries.length, after, s.toasts.length], [0, 0, 0], 'nothing yet; the syncer tells the reader');
  s.state.journal = emptyJournal(); // the removal ended and emptied the journal
  s.drain();
  assert.deepEqual(texts(load(s.st)), ['typed during the removal'], 'the text was not lost');
  assert.equal(after, 1);
});

test('S3: a save that finds the journal removed applies its change to the reloaded journal and brings nothing removed back', () => {
  const s = setup();
  addEntry(s.state.journal, { passage: 1, text: 'removed in another tab' });
  s.before = () => { s.state.journal = load(s.st); }; // the gate reloads first (WIPED changed)
  assert.equal(s.state.change(() => addEntry(s.state.journal, { passage: 2, text: 'new' })), true);
  assert.deepEqual(texts(load(s.st)), ['new']);
  assert.deepEqual(texts(s.state.journal), ['new']);
});

test('S5: a draw made during a removal keeps its id, so its ?d= link works once the queue runs', () => {
  const s = setup();
  s.open = false;
  const d = recordDraw({ draws: [] }, { passage: 7, lines: [1, 2, 1, 2], bundles: [] });
  s.state.change(() => s.state.journal.draws.push(d));
  assert.equal(load(s.st).draws.length, 0);
  s.drain();
  assert.equal(load(s.st).draws[0].id, d.id);
});

test('S2: the Replace snapshot is written inside the gate: while a removal runs, no snapshot is written', () => {
  const s = setup();
  addEntry(s.state.journal, { passage: 1, text: 'old' });
  s.open = false;
  const replace = () => { if (!snapshot(s.state.journal, s.st)) return false; s.state.journal = replaceJournal(s.state.journal, emptyJournal()); return true; };
  s.state.change(replace);
  assert.equal(s.st.getItem(SNAPSHOT_KEY), null);
  s.state.journal = emptyJournal(); // removed meanwhile
  s.drain();
  assert.equal(keptSnapshot(s.st), null, 'nothing removed can be restored');
});

test('a change that storage cannot hold stays in memory, the toast says Export, and after() does not run', () => {
  const s = setup();
  s.full = true;
  let after = 0;
  assert.equal(s.state.change(() => addEntry(s.state.journal, { passage: 1, text: 'kept for export' }), () => { after++; }), false);
  assert.match(s.toasts.pop(), /Export/);
  assert.deepEqual(texts(s.state.journal), ['kept for export']);
  assert.deepEqual([after, s.saved], [0, 0]);
});

test('A6: fn() returning false, null, or undefined changed nothing: no save, after() does not run, and the toast says so', () => {
  for (const r of [false, null, undefined]) {
    const s = setup();
    let after = 0;
    assert.equal(s.state.change(() => r, () => { after++; }), false);
    assert.deepEqual([s.saved, after], [0, 0]);
    assert.equal(s.st.getItem('tao.journal.v1'), null);
    assert.deepEqual(s.toasts, ['Not saved.']);
  }
});

test('A6: a caller can name why nothing was saved (a Replace whose snapshot failed)', () => {
  const s = setup();
  assert.equal(s.state.change(() => false, () => {}, 'Could not save a snapshot.'), false);
  assert.deepEqual(s.toasts, ['Could not save a snapshot.']);
});

test('E1: state.editor() takes a stamp when the editor opens and passes it with every save from it', () => {
  const seen = [];
  let n = 0;
  const state = makeState({
    load: () => emptyJournal(), save: () => ({ ok: true }), toast: () => {},
    stamp: () => ({ account: 'u1', gen: `g${n++}` }),
    gate: (fn, st) => { seen.push(st); fn(); return true; },
  });
  const change = state.editor();
  change(() => addEntry(state.journal, { passage: 1, text: 'a' }));
  change(() => addEntry(state.journal, { passage: 1, text: 'b' }));
  state.change(() => true);
  assert.deepEqual(seen, [{ account: 'u1', gen: 'g0' }, { account: 'u1', gen: 'g0' }, undefined]);
});
