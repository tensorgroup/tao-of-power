// Extract stroke data (Make Me a Hanzi graphics.txt, Arphic Public License) for every
// plate character, plus a few always-present ones, into app/data/strokes/<hex>.json.
// Source: github.com/skishore/makemeahanzi graphics.txt → sources/raw/hanzi/graphics.txt
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const src = new URL('sources/raw/hanzi/graphics.txt', root);
const outDir = new URL('app/data/strokes/', root);
if (!existsSync(src)) { console.log('build-strokes: graphics.txt missing, skipped'); process.exit(0); }

const want = new Set('道德經'); // home page / about
const pdir = new URL('app/data/passages/', root);
for (const f of existsSync(pdir) ? readdirSync(pdir).filter((x) => x.endsWith('.json')) : []) {
  const p = JSON.parse(readFileSync(new URL(f, pdir)));
  for (const pl of p.plates || []) want.add(pl.c);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const found = new Set();
for (const line of readFileSync(src, 'utf8').split('\n')) {
  if (!line) continue;
  const d = JSON.parse(line);
  if (!want.has(d.character)) continue;
  const round = (m) => m.map(([x, y]) => [Math.round(x), Math.round(y)]);
  const out = { c: d.character, strokes: d.strokes, medians: d.medians.map(round) };
  writeFileSync(new URL(`${d.character.codePointAt(0).toString(16)}.json`, outDir), JSON.stringify(out));
  found.add(d.character);
}
const missing = [...want].filter((c) => !found.has(c));
console.log(`strokes: ${found.size} characters${missing.length ? `; no stroke data (font fallback): ${missing.join('')}` : ''}`);
