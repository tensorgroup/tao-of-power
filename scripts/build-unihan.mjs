// Extract Unihan readings + definitions for every Han character in the source.
// In:  sources/raw/unihan/Unihan_Readings.txt (download Unihan.zip from unicode.org, unzip there)
// Out: sources/unihan.json  { "道": { "mandarin": ["dào"], "readings": ["dào", "dǎo"], "def": "…" } }
import { readFileSync, writeFileSync } from 'node:fs';
import { hanOnly } from './normalize.mjs';

const root = new URL('../', import.meta.url);
const src = JSON.parse(readFileSync(new URL('sources/zh-wangbi.json', root)));
const want = new Set();
for (const ch of src) for (const s of ch.segments) for (const c of hanOnly(s.zh)) want.add(c);
// Also cover characters in Wang Bi notes so notes can be tappable.
for (const ch of src) for (const s of ch.segments) for (const c of hanOnly(s.wangbi || '')) want.add(c);

const out = {};
const lines = readFileSync(new URL('sources/raw/unihan/Unihan_Readings.txt', root), 'utf8').split('\n');
for (const line of lines) {
  if (!line.startsWith('U+')) continue;
  const [cp, field, value] = line.split('\t');
  const c = String.fromCodePoint(parseInt(cp.slice(2), 16));
  if (!want.has(c)) continue;
  const e = (out[c] ??= { mandarin: [], readings: [], def: '' });
  if (field === 'kMandarin') e.mandarin = value.split(' ');
  if (field === 'kDefinition') e.def = value;
  if (field === 'kHanyuPinyin' || field === 'kXHC1983' || field === 'kTGHZ2013') {
    // formats: "10001.010:dào,dǎo"  or  "0123.010:dào 0124.020:dǎo"
    for (const part of value.split(' ')) {
      const r = part.split(':')[1];
      if (r) for (const p of r.split(',')) e.readings.push(p);
    }
  }
}
for (const e of Object.values(out)) {
  e.readings = [...new Set([...e.mandarin, ...e.readings])];
}
const missing = [...want].filter((c) => !out[c]);
writeFileSync(new URL('sources/unihan.json', root), JSON.stringify(out, null, 0));
console.log(`unihan: ${Object.keys(out).length} chars; missing: ${missing.join('') || 'none'}`);
