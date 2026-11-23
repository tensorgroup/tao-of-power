// Validate app/data: passages vs pinned source, notes, lexicon, pinyin.
// Usage: node scripts/check-content.mjs [--all]   (--all requires all 81 passages)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { hanOnly } from './normalize.mjs';
import { noteIds, isHan } from '../app/js/markup.js';

const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root)));
const src = read('sources/zh-wangbi.json');
const uni = read('sources/unihan.json');
const lex = read('app/data/lexicon.json');

const KINDS = new Set(['etymology', 'gap', 'history', 'geopolitics', 'wordplay', 'variant', 'wangbi', 'legge', 'practice']);
const LENSES = new Set(['ground', 'inner', 'leading', 'body', 'nature', 'practice']);
const THEMES = new Set(['way', 'seeing', 'self', 'leading', 'yielding', 'conflict', 'simplicity']);
const KEYS = ['n', 'title', 'theme', 'zh', 'rendering', 'notes', 'lenses', 'glyph'];
const stripTone = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ü/g, 'v');

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

// Lexicon pinyin must be a Unihan reading.
for (const [c, e] of Object.entries(lex)) {
  const u = uni[c];
  if (!u) { err(`lexicon ${c}`, 'not in Unihan extract'); continue; }
  for (const p of e.py || []) {
    if (!u.readings.includes(p) && !(e.pyNote && u.readings.map(stripTone).includes(stripTone(p)))) {
      err(`lexicon ${c}`, `pinyin ${p} not in Unihan readings ${u.readings.join(',')}`);
    }
  }
}

const dir = new URL('app/data/passages/', root);
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d\d\.json$/.test(f)).sort() : [];
if (process.argv.includes('--all') && files.length !== 81) err('passages', `expected 81 files, found ${files.length}`);

for (const f of files) {
  const where = `passage ${f}`;
  let p;
  try { p = read(`app/data/passages/${f}`); } catch (e) { err(where, `bad JSON: ${e.message}`); continue; }
  for (const k of KEYS) if (!(k in p)) err(where, `missing key ${k}`);
  if (p.n !== Number(f.slice(0, 2))) err(where, `n=${p.n} does not match file name`);
  if (!THEMES.has(p.theme)) err(where, `unknown theme ${p.theme}`);
  const srcText = hanOnly(src[p.n - 1].segments.map((s) => s.zh).join(''));
  const ourText = hanOnly((p.zh || []).map((s) => s.text).join(''));
  if (srcText !== ourText) err(where, 'zh text differs from pinned source');
  for (const [i, seg] of (p.zh || []).entries()) {
    const chars = [...seg.text];
    for (const k of Object.keys(seg.gloss || {})) {
      if (!isHan(chars[Number(k)] || '')) err(where, `zh[${i}].gloss key ${k} is not a Han char offset`);
    }
    for (const c of chars) if (isHan(c) && !lex[c]) err(where, `no lexicon entry for ${c}`);
  }
  const notes = p.notes || {};
  const used = new Set();
  const checkText = (txt, w) => {
    for (const id of noteIds(txt)) { used.add(id); if (!notes[id]) err(where, `${w}: note "${id}" not defined`); }
  };
  (p.rendering || []).forEach((l, i) => checkText(l, `rendering[${i}]`));
  for (const [id, n] of Object.entries(notes)) {
    if (!KINDS.has(n.kind)) err(where, `note ${id}: bad kind ${n.kind}`);
    if (!n.title || !n.body) err(where, `note ${id}: title and body required`);
    checkText(n.body || '', `note ${id}`);
  }
  for (const [k, v] of Object.entries(p.lenses || {})) {
    if (!LENSES.has(k)) err(where, `bad lens ${k}`);
    checkText(v, `lens ${k}`);
  }
  if (Object.keys(p.lenses || {}).length < 4) err(where, 'fewer than 4 lenses');
  const marked = (p.rendering || []).flatMap((l) => noteIds(l)).length;
  if (marked < 8) err(where, `only ${marked} marked phrases in rendering (min 8)`);
  if (!lex[p.glyph]) err(where, `glyph ${p.glyph} not in lexicon`);
  const plates = p.plates || [];
  if (plates.length < 1 || plates.length > 3) err(where, `needs 1–3 plates, has ${plates.length}`);
  if (plates[0] && plates[0].c !== p.glyph) err(where, 'glyph must equal the first plate character');
  const passageHan = new Set(hanOnly((p.zh || []).map((x) => x.text).join('')));
  for (const [i, pl] of plates.entries()) {
    if (!pl.c || !isHan(pl.c)) err(where, `plate ${i}: bad character`);
    else if (!passageHan.has(hanOnly(pl.c))) err(where, `plate ${i}: ${pl.c} does not appear in the passage`);
    if (!pl.title || !pl.lesson || !pl.brush) err(where, `plate ${i}: title, lesson, brush required`);
    checkText(pl.lesson || '', `plate ${i} lesson`);
    checkText(pl.brush || '', `plate ${i} brush`);
  }
  for (const id of Object.keys(notes)) if (!used.has(id)) err(where, `note ${id} is never referenced`);
}

console.log(`checked ${files.length} passages, ${Object.keys(lex).length} lexicon entries`);
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} problem(s)`);
  process.exit(1);
}
console.log('content OK');
