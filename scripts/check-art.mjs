// Validate app/data/art.json: public-domain licenses, files present, coverage, story links.
import { readFileSync, existsSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const path = new URL('app/data/art.json', root);
const hasArt = existsSync(path);
if (!hasArt) console.log('check-art: no art.json yet (echoes still checked)');
const art = hasArt ? JSON.parse(readFileSync(path)) : { catalog: {}, passages: {}, stories: {} };
const errors = [];
const PD = /(public domain|^pd\b|pd-|cc0)/i;

for (const [id, a] of Object.entries(art.catalog || {})) {
  if (!PD.test(a.license || '')) errors.push(`${id}: license "${a.license}" is not public domain`);
  for (const k of ['file', 'title', 'source', 'alt', 'w', 'h']) if (!a[k]) errors.push(`${id}: missing ${k}`);
  const f = new URL(`app/${a.file}`, root);
  if (!existsSync(f)) errors.push(`${id}: file ${a.file} missing`);
  else if (statSync(f).size > 260_000) errors.push(`${id}: ${a.file} is ${Math.round(statSync(f).size / 1024)} KB (max 260)`);
  if (!existsSync(new URL(`app/${a.file.replace(/^art\//, 'art/thumbs/')}`, root))) errors.push(`${id}: no thumbnail (run scripts/make-thumbs.py)`);
  // Wikimedia Commons, or a museum open-access record (CC0 for public-domain works).
  if (!/^https:\/\/(commons\.wikimedia\.org\/|www\.clevelandart\.org\/art\/|www\.artic\.edu\/artworks\/)/.test(a.source || '')) errors.push(`${id}: source must be Commons, Cleveland, or Art Institute of Chicago`);
  if (!/commons\.wikimedia/.test(a.source || '') && !/museum|institute|collection|gallery/i.test(a.collection || '')) errors.push(`${id}: a museum source needs its collection named`);
}
const missing = [];
for (let n = 1; n <= 81; n++) {
  const list = art.passages?.[n] || [];
  if (hasArt && !list.length) missing.push(n);
  for (const e of list) if (!art.catalog?.[e.id]) errors.push(`passage ${n}: unknown art id ${e.id}`);
}
for (const [id, st] of Object.entries(art.stories || {})) {
  if (!st.title || !st.text || !st.source) errors.push(`story ${id}: title, text, source required`);
  for (const n of st.passages || []) if (!(n >= 1 && n <= 81)) errors.push(`story ${id}: bad passage ${n}`);
}
const ePath = new URL('app/data/echoes.json', root);
if (existsSync(ePath)) {
  const ec = JSON.parse(readFileSync(ePath));
  let count = 0;
  for (const [n, list] of Object.entries(ec.passages || {})) {
    if (!(Number(n) >= 1 && Number(n) <= 81)) errors.push(`echoes: bad passage ${n}`);
    for (const e of list) {
      count++;
      for (const k of ['id', 'source', 'title', 'body']) if (!e[k]) errors.push(`echo ${n}/${e.id}: missing ${k}`);
      if ((e.quote || '').length > 80) errors.push(`echo ${n}/${e.id}: quote longer than 80 characters`);
    }
  }
  console.log(`echoes: ${count}`);
}
const wPath = new URL('app/data/wing.json', root);
if (existsSync(wPath)) {
  const w = JSON.parse(readFileSync(wPath));
  let c = 0;
  for (const [n, list] of Object.entries(w.passages || {})) for (const e of list) {
    c++;
    if (!e.title || !e.body || !e.kind) errors.push(`wing ${n}: title, body, kind required`);
    if (!['idea', 'story', 'interpretation', 'contrast'].includes(e.kind)) errors.push(`wing ${n}: bad kind ${e.kind}`);
    if ((e.body || '').split(/\s+/).length > 160) errors.push(`wing ${n}: body over 160 words`);
  }
  console.log(`wing notes: ${c}`);
}
const cPath = new URL('app/data/culture.json', root);
if (existsSync(cPath)) {
  const KINDS = ['song', 'poem', 'film', 'tv', 'episode', 'anime', 'manga', 'comic', 'novel', 'short-story', 'book', 'ad', 'game', 'music', 'album'];
  let c = 0;
  for (const [n, list] of Object.entries(JSON.parse(readFileSync(cPath)).passages || {})) {
    const ids = new Set();
    for (const e of list) {
      c++;
      const w = `culture ${n}/${e.id}`;
      if (!e.id || ids.has(e.id)) errors.push(`${w}: missing or duplicate id`);
      ids.add(e.id);
      for (const k of ['title', 'kind', 'why', 'link']) if (!e[k]) errors.push(`${w}: missing ${k}`);
      if (!KINDS.includes(e.kind)) errors.push(`${w}: bad kind ${e.kind}`);
      if (!/^https:\/\/en\.wikipedia\.org\/wiki\/\S+$/.test(e.link || '')) errors.push(`${w}: link must be an English Wikipedia article`);
      const words = String(e.why || '').split(/\s+/).length;
      if (words > 110) errors.push(`${w}: why is ${words} words (max 110)`);
    }
  }
  console.log(`culture: ${c}`);
}
if (missing.length) errors.push(`passages without art: ${missing.join(', ')}`);
console.log(`art: ${Object.keys(art.catalog || {}).length} images, ${Object.keys(art.stories || {}).length} stories`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('art OK');
