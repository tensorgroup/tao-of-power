// Seed app/data/lexicon.json with {py, def} for every Han char of the text and Wang Bi notes.
// Never overwrites enriched fields (senses, shuowen, parts, story, gap, …).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const uni = JSON.parse(readFileSync(new URL('sources/unihan.json', root)));
const path = new URL('app/data/lexicon.json', root);
const lex = existsSync(path) ? JSON.parse(readFileSync(path)) : {};

for (const [c, u] of Object.entries(uni)) {
  const e = (lex[c] ??= {});
  e.py ??= u.readings.length ? u.readings.slice(0, 3) : u.mandarin;
  e.def = u.def;
}
const sorted = Object.fromEntries(Object.entries(lex).sort(([a], [b]) => a.codePointAt(0) - b.codePointAt(0)));
writeFileSync(path, JSON.stringify(sorted, null, 1));
console.log(`lexicon: ${Object.keys(sorted).length} entries`);
