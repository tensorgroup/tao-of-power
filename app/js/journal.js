// Journal store: localStorage, merge-safe export/import.

export const KEY = 'tao.journal.v1';
export const SNAPSHOT_KEY = 'tao.journal.snapshot';
const DRAFT = (n) => `tao.draft.${String(n).padStart(2, '0')}`;
const DRAFT_Q = (n) => `tao.draftq.${String(n).padStart(2, '0')}`;

const ls = () => globalThis.localStorage;

export function emptyJournal() {
  return { version: 1, lastExportAt: null, entries: [], draws: [], tombstones: [] };
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function load(storage = ls()) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return emptyJournal();
    const r = validate(JSON.parse(raw));
    return r.ok ? r.journal : emptyJournal();
  } catch {
    return emptyJournal();
  }
}

export function save(j, storage = ls()) {
  try {
    storage.setItem(KEY, JSON.stringify(j));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `${error?.name || 'Error'}: ${error?.message || error}` };
  }
}

export function snapshot(j, storage = ls()) {
  try { storage.setItem(SNAPSHOT_KEY, JSON.stringify(j)); return true; } catch { return false; }
}

/**
 * The journal that Replace ("Use only this account's journal") kept aside here, or null when there is none,
 * it is not valid, or it is empty (no entries and no draws: nothing to restore).
 * @returns {{ journal: object, entries: number, draws: number } | null}
 */
export function keptSnapshot(storage = ls()) {
  let snap;
  try { snap = validate(JSON.parse(storage.getItem(SNAPSHOT_KEY) || 'null')); } catch { return null; }
  if (!snap?.ok) return null;
  const { entries, draws } = snap.journal;
  if (!entries.length && !draws.length) return null;
  return { journal: snap.journal, entries: entries.length, draws: draws.length };
}

export function addEntry(j, { passage, text, drawId, q, at }, now = new Date().toISOString()) {
  const e = { id: uuid(), createdAt: now, updatedAt: now, passage, text };
  if (drawId) e.drawId = drawId;
  if (q?.id && q?.claim) e.q = { id: String(q.id), claim: String(q.claim) };
  // A margin note: the block of the passage page it is pinned to, and a few words of that block.
  if (isStr(at?.key)) e.at = { key: at.key, snip: typeof at.snip === 'string' ? at.snip : '' };
  j.entries.push(e);
  return e;
}

// A change must beat the version it changes, even when this device's clock is
// behind the device that wrote that version (sync merges by time).
function after(prev, now) {
  const p = Date.parse(prev);
  return Number.isNaN(p) || Date.parse(now) > p ? now : new Date(p + 1).toISOString();
}

export function updateEntry(j, id, text, now = new Date().toISOString()) {
  const e = j.entries.find((x) => x.id === id);
  if (e) { e.text = text; e.updatedAt = after(e.updatedAt, now); }
  return e;
}

/**
 * Save an edit of entry `e`. When the entry is gone (removed meanwhile, e.g. "Remove it from this browser"
 * in another tab), the text becomes a new entry in the same place (passage, question, margin block).
 * Returns the saved entry.
 */
export function reviseEntry(j, e, text, now = new Date().toISOString()) {
  return updateEntry(j, e.id, text, now) || addEntry(j, { passage: e.passage, text, drawId: e.drawId, q: e.q, at: e.at }, now);
}

export function deleteEntry(j, id, now = new Date().toISOString()) {
  const e = j.entries.find((x) => x.id === id);
  j.entries = j.entries.filter((x) => x.id !== id);
  j.tombstones = j.tombstones.filter((t) => t.id !== id);
  j.tombstones.push({ id, deletedAt: e ? after(e.updatedAt, now) : now });
}

/** Remove a draw from the history; the tombstone carries the removal to other devices. */
export function deleteDraw(j, id, now = new Date().toISOString()) {
  if (!j.draws.some((d) => d.id === id)) return false;
  j.draws = j.draws.filter((d) => d.id !== id);
  j.tombstones = j.tombstones.filter((t) => t.id !== id);
  j.tombstones.push({ id, deletedAt: now });
  return true;
}

export function recordDraw(j, { passage, lines, bundles }, now = new Date().toISOString()) {
  const d = { id: uuid(), at: now, passage, lines, bundles };
  j.draws.push(d);
  return d;
}

const isStr = (x) => typeof x === 'string' && x.length > 0;
const isPassage = (n) => Number.isInteger(n) && n >= 1 && n <= 81;
const isTime = (x) => isStr(x) && !Number.isNaN(Date.parse(x));

export function validate(obj) {
  const fail = (reason) => ({ ok: false, reason });
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail('Not a journal file.');
  if (obj.version !== 1) return fail(`Unsupported journal version: ${obj.version}`);
  if (!Array.isArray(obj.entries)) return fail('Missing entries list.');
  const draws = obj.draws ?? [];
  const tombstones = obj.tombstones ?? [];
  if (!Array.isArray(draws) || !Array.isArray(tombstones)) return fail('Bad draws or tombstones.');
  for (const e of obj.entries) {
    if (!e || !isStr(e.id) || !isPassage(e.passage) || typeof e.text !== 'string'
      || !isTime(e.createdAt) || !isTime(e.updatedAt)) return fail('An entry is malformed.');
  }
  for (const d of draws) {
    if (!d || !isStr(d.id) || !isPassage(d.passage) || !isTime(d.at)) return fail('A draw is malformed.');
  }
  for (const t of tombstones) {
    if (!t || !isStr(t.id) || !isTime(t.deletedAt)) return fail('A deletion record is malformed.');
  }
  return {
    ok: true,
    journal: {
      version: 1,
      lastExportAt: isTime(obj.lastExportAt) ? obj.lastExportAt : null,
      entries: obj.entries.map((e) => {
        const out = { ...e, text: String(e.text) };
        if (!(e.q && isStr(e.q.id) && isStr(e.q.claim))) delete out.q; // drop a malformed question link
        if (!(e.at && isStr(e.at.key) && typeof e.at.snip === 'string')) delete out.at; // and a malformed margin anchor
        return out;
      }),
      draws: draws.map((d) => ({ ...d })),
      tombstones: tombstones.map((t) => ({ ...t })),
    },
  };
}

const t = (s) => Date.parse(s);
const byTime = (key) => (a, b) => t(a[key]) - t(b[key]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function merge(local, incoming) {
  const entries = new Map();
  for (const e of [...local.entries, ...incoming.entries]) {
    const cur = entries.get(e.id);
    // Same time on two devices: pick by text, so every device and the server agree.
    if (!cur || t(e.updatedAt) > t(cur.updatedAt) || (t(e.updatedAt) === t(cur.updatedAt) && e.text > cur.text)) entries.set(e.id, { ...e });
  }
  const tombs = new Map();
  for (const x of [...local.tombstones, ...incoming.tombstones]) {
    const cur = tombs.get(x.id);
    if (!cur || t(x.deletedAt) > t(cur.deletedAt)) tombs.set(x.id, { ...x });
  }
  for (const [id, tomb] of tombs) {
    const e = entries.get(id);
    if (e && t(tomb.deletedAt) >= t(e.updatedAt)) entries.delete(id);
    else if (e) tombs.delete(id); // a newer edit revives the entry
  }
  const draws = new Map();
  for (const d of [...local.draws, ...incoming.draws]) if (!draws.has(d.id) && !tombs.has(d.id)) draws.set(d.id, { ...d });
  const le = [local.lastExportAt, incoming.lastExportAt].filter(Boolean).sort();
  return {
    version: 1,
    lastExportAt: local.lastExportAt ?? le.at(-1) ?? null,
    entries: [...entries.values()].sort(byTime('createdAt')),
    draws: [...draws.values()].sort(byTime('at')),
    tombstones: [...tombs.values()].sort(byTime('deletedAt')),
  };
}

/**
 * Import "Replace": the result holds `incoming`, and everything else that `current`
 * had is marked removed, so a later merge (another tab, sync) cannot bring it back.
 */
export function replaceJournal(current, incoming, now = new Date().toISOString()) {
  const out = merge(emptyJournal(), incoming);
  const keep = new Set([...out.entries.map((e) => e.id), ...out.draws.map((d) => d.id)]);
  const gone = new Set(out.tombstones.map((t) => t.id));
  for (const e of current.entries) if (!keep.has(e.id) && !gone.has(e.id)) out.tombstones.push({ id: e.id, deletedAt: after(e.updatedAt, now) });
  for (const d of current.draws) if (!keep.has(d.id) && !gone.has(d.id)) out.tombstones.push({ id: d.id, deletedAt: now });
  out.lastExportAt = current.lastExportAt ?? null;
  return out;
}

/** The part of a journal that syncs: everything but this device's lastExportAt. */
export function syncCore(j) {
  return { version: 1, entries: j.entries, draws: j.draws, tombstones: j.tombstones };
}

export function sameCore(a, b) {
  return JSON.stringify(syncCore(a)) === JSON.stringify(syncCore(b));
}

export function toExport(j) {
  return JSON.stringify(j, null, 2);
}

export function exportFilename(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `tao-journal-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

/** False when storage refused the write (full): the draft writer tries again later. */
export function saveDraft(n, text, storage = ls()) {
  try {
    if (text) storage.setItem(DRAFT(n), text); else storage.removeItem(DRAFT(n));
    return true;
  } catch { return false; }
}
export function loadDraft(n, storage = ls()) {
  try { return storage.getItem(DRAFT(n)) || ''; } catch { return ''; }
}
export function clearDraft(n, storage = ls()) {
  try { storage.removeItem(DRAFT(n)); storage.removeItem(DRAFT_Q(n)); } catch { /* ignore */ }
}
/** The question a draft answers: { id, claim } or null. */
export function saveDraftQ(n, q, storage = ls()) {
  try {
    if (q) storage.setItem(DRAFT_Q(n), JSON.stringify({ id: q.id, claim: q.claim })); else storage.removeItem(DRAFT_Q(n));
    return true;
  } catch { return false; }
}
export function loadDraftQ(n, storage = ls()) {
  try {
    const q = JSON.parse(storage.getItem(DRAFT_Q(n)) || 'null');
    return q && typeof q.id === 'string' && typeof q.claim === 'string' ? q : null;
  } catch { return null; }
}
