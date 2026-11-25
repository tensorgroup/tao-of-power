import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyJournal, load, save, addEntry, updateEntry, deleteEntry, recordDraw,
  validate, merge, toExport, exportFilename, saveDraft, loadDraft, clearDraft,
  saveDraftQ, loadDraftQ, KEY,
} from '../app/js/journal.js';

function memStorage(throwOnSet = false) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (throwOnSet) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
  };
}

const T = (s) => `2026-11-23T10:00:${String(s).padStart(2, '0')}.000Z`;

test('load returns empty journal when nothing stored', () => {
  assert.deepEqual(load(memStorage()), emptyJournal());
});

test('save then load round-trips', () => {
  const s = memStorage();
  const j = emptyJournal();
  addEntry(j, { passage: 4, text: 'hello' }, T(1));
  assert.deepEqual(save(j, s), { ok: true });
  assert.deepEqual(load(s), j);
});

test('save reports quota errors', () => {
  const r = save(emptyJournal(), memStorage(true));
  assert.equal(r.ok, false);
  assert.match(String(r.error), /full|Quota/);
});

test('newer updatedAt wins on merge', () => {
  const a = emptyJournal();
  const e = addEntry(a, { passage: 1, text: 'old' }, T(1));
  const b = structuredClone(a);
  updateEntry(b, e.id, 'new', T(5));
  assert.equal(merge(a, b).entries[0].text, 'new');
  assert.equal(merge(b, a).entries[0].text, 'new');
});

test('tombstone beats older import', () => {
  const local = emptyJournal();
  const e = addEntry(local, { passage: 1, text: 'x' }, T(1));
  const backup = structuredClone(local);
  deleteEntry(local, e.id, T(9));
  const m = merge(local, backup);
  assert.equal(m.entries.length, 0);
  assert.equal(m.tombstones.length, 1);
});

test('incoming tombstone deletes older local entry', () => {
  const local = emptyJournal();
  const e = addEntry(local, { passage: 1, text: 'x' }, T(1));
  const other = structuredClone(local);
  deleteEntry(other, e.id, T(9));
  assert.equal(merge(local, other).entries.length, 0);
});

test('edit after delete survives (newer update beats older tombstone)', () => {
  const local = emptyJournal();
  const e = addEntry(local, { passage: 1, text: 'x' }, T(1));
  const other = structuredClone(local);
  deleteEntry(other, e.id, T(3));
  updateEntry(local, e.id, 'kept', T(8));
  assert.equal(merge(local, other).entries[0].text, 'kept');
});

test('draws union by id', () => {
  const a = emptyJournal();
  const b = emptyJournal();
  recordDraw(a, { passage: 3, lines: [2, 0, 0, 0], bundles: [] }, T(1));
  recordDraw(b, { passage: 9, lines: [2, 2, 0, 0], bundles: [] }, T(2));
  const m = merge(a, b);
  assert.equal(m.draws.length, 2);
  assert.equal(merge(m, a).draws.length, 2);
});

test('merge is idempotent', () => {
  const a = emptyJournal();
  addEntry(a, { passage: 1, text: 'a' }, T(1));
  const b = emptyJournal();
  addEntry(b, { passage: 2, text: 'b' }, T(2));
  const ab = merge(a, b);
  assert.deepEqual(merge(a, ab), ab);
});

test('rejects invalid import without writing', () => {
  for (const bad of [null, 42, {}, { version: 2, entries: [] }, { version: 1, entries: 'x' },
    { version: 1, entries: [{ text: 'no id' }] }, { version: 1, entries: [{ id: 'a', passage: 99, text: '', createdAt: T(1), updatedAt: T(1) }] }]) {
    assert.equal(validate(bad).ok, false, JSON.stringify(bad));
  }
  const good = emptyJournal();
  addEntry(good, { passage: 81, text: 'ok' }, T(1));
  assert.equal(validate(JSON.parse(toExport(good))).ok, true);
});

test('validate fills missing optional arrays', () => {
  const r = validate({ version: 1, entries: [] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.journal.draws, []);
  assert.deepEqual(r.journal.tombstones, []);
});

test('export filename', () => {
  assert.equal(exportFilename(new Date(2026, 10, 3)), 'tao-journal-2026-11-03.json');
});

test('drafts round-trip', () => {
  const s = memStorage();
  saveDraft(7, 'thinking…', s);
  assert.equal(loadDraft(7, s), 'thinking…');
  clearDraft(7, s);
  assert.equal(loadDraft(7, s), '');
});

test('storage key', () => assert.equal(KEY, 'tao.journal.v1'));

test('an entry keeps the question it answers, through export and import', () => {
  const j = emptyJournal();
  const e = addEntry(j, { passage: 59, text: 'x', q: { id: 'finite-store', claim: 'The body has a finite store.', extra: 1 } });
  assert.deepEqual(e.q, { id: 'finite-store', claim: 'The body has a finite store.' });
  const back = validate(JSON.parse(toExport(j)));
  assert.equal(back.ok, true);
  assert.deepEqual(back.journal.entries[0].q, e.q);
  assert.equal(addEntry(j, { passage: 1, text: 'y', q: null }).q, undefined);
});

test('validate drops a malformed question link but keeps the entry', () => {
  const now = new Date().toISOString();
  const r = validate({ version: 1, entries: [{ id: 'a', passage: 2, text: 't', createdAt: now, updatedAt: now, q: { id: 3 } }] });
  assert.equal(r.ok, true);
  assert.equal('q' in r.journal.entries[0], false);
});

test('draft question round-trips and clears with the draft', () => {
  const st = memStorage();
  saveDraft(5, 'hi', st);
  saveDraftQ(5, { id: 'q1', claim: 'c' }, st);
  assert.deepEqual(loadDraftQ(5, st), { id: 'q1', claim: 'c' });
  clearDraft(5, st);
  assert.equal(loadDraftQ(5, st), null);
  assert.equal(loadDraft(5, st), '');
});

test('a margin note keeps its anchor, through export, import, and merge', () => {
  const j = emptyJournal();
  const e = addEntry(j, { passage: 33, text: 'moss', at: { key: 'line:8', snip: 'One who dies and is not lost', x: 1 } });
  assert.deepEqual(e.at, { key: 'line:8', snip: 'One who dies and is not lost' });
  const back = validate(JSON.parse(toExport(j)));
  assert.equal(back.ok, true);
  assert.deepEqual(back.journal.entries[0].at, e.at);
  assert.deepEqual(merge(emptyJournal(), back.journal).entries[0].at, e.at);
  assert.equal(addEntry(j, { passage: 1, text: 'y', at: { key: '' } }).at, undefined);
  assert.equal(addEntry(j, { passage: 1, text: 'z', at: { key: 'q:a' } }).at.snip, '');
});

test('validate drops a malformed margin anchor but keeps the entry', () => {
  const now = new Date().toISOString();
  const r = validate({ version: 1, entries: [{ id: 'a', passage: 2, text: 't', createdAt: now, updatedAt: now, at: { key: 7 } }] });
  assert.equal(r.ok, true);
  assert.equal('at' in r.journal.entries[0], false);
});
