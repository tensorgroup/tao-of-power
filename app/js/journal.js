// Journal store: localStorage, merge-safe export/import.

export const KEY = 'tao.journal.v1';
export const SNAPSHOT_KEY = 'tao.journal.snapshot';
const DRAFT = (n) => `tao.draft.${String(n).padStart(2, '0')}`;

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

export function addEntry(j, { passage, text, drawId }, now = new Date().toISOString()) {
  const e = { id: uuid(), createdAt: now, updatedAt: now, passage, text };
  if (drawId) e.drawId = drawId;
  j.entries.push(e);
  return e;
}

export function updateEntry(j, id, text, now = new Date().toISOString()) {
  const e = j.entries.find((x) => x.id === id);
  if (e) { e.text = text; e.updatedAt = now; }
  return e;
}

export function deleteEntry(j, id, now = new Date().toISOString()) {
  j.entries = j.entries.filter((x) => x.id !== id);
  j.tombstones = j.tombstones.filter((t) => t.id !== id);
  j.tombstones.push({ id, deletedAt: now });
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
      entries: obj.entries.map((e) => ({ ...e, text: String(e.text) })),
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
    if (!cur || t(e.updatedAt) > t(cur.updatedAt)) entries.set(e.id, { ...e });
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
  for (const d of [...local.draws, ...incoming.draws]) if (!draws.has(d.id)) draws.set(d.id, { ...d });
  const le = [local.lastExportAt, incoming.lastExportAt].filter(Boolean).sort();
  return {
    version: 1,
    lastExportAt: local.lastExportAt ?? le.at(-1) ?? null,
    entries: [...entries.values()].sort(byTime('createdAt')),
    draws: [...draws.values()].sort(byTime('at')),
    tombstones: [...tombs.values()].sort(byTime('deletedAt')),
  };
}

export function toExport(j) {
  return JSON.stringify(j, null, 2);
}

export function exportFilename(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `tao-journal-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

export function saveDraft(n, text, storage = ls()) {
  try {
    if (text) storage.setItem(DRAFT(n), text); else storage.removeItem(DRAFT(n));
  } catch { /* draft is best effort */ }
}
export function loadDraft(n, storage = ls()) {
  try { return storage.getItem(DRAFT(n)) || ''; } catch { return ''; }
}
export function clearDraft(n, storage = ls()) {
  try { storage.removeItem(DRAFT(n)); } catch { /* ignore */ }
}
