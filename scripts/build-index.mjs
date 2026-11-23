// Write app/data/index.json: titles and themes of the passages written so far.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const dir = new URL('app/data/passages/', root);
const passages = {};
for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => /^\d\d\.json$/.test(x)).sort() : []) {
  const p = JSON.parse(readFileSync(new URL(f, dir)));
  passages[p.n] = { title: p.title, theme: p.theme, glyph: p.glyph };
}
writeFileSync(new URL('app/data/index.json', root), JSON.stringify({ passages }));
console.log(`index.json: ${Object.keys(passages).length} passages`);
