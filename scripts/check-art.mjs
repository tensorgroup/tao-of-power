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
  if (!/^https:\/\/commons\.wikimedia\.org\//.test(a.source || '')) errors.push(`${id}: source is not a Commons URL`);
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
if (missing.length) errors.push(`passages without art: ${missing.join(', ')}`);
console.log(`art: ${Object.keys(art.catalog || {}).length} images, ${Object.keys(art.stories || {}).length} stories`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('art OK');
