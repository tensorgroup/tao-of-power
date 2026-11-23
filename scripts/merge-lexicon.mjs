// Fold lexicon-add/*.json (repo root) (written per passage by creation agents) into app/data/lexicon.json.
// Fields from an add file fill empty fields; an existing enriched field is kept unless the add file sets "replace": true.
// Add files are dev inputs: they are removed from the deployed tree after merging (kept in git history).
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const lexPath = new URL('app/data/lexicon.json', root);
const addDir = new URL('lexicon-add/', root);
const doneDir = new URL('lexicon-add/merged/', root);
const lex = JSON.parse(readFileSync(lexPath));
const ENRICHED = ['senses', 'shuowen', 'shuowenEn', 'parts', 'story', 'gap', 'pyNote'];

if (!existsSync(addDir)) { console.log('no lexicon-add directory'); process.exit(0); }
mkdirSync(doneDir, { recursive: true });
let n = 0;
for (const f of readdirSync(addDir).filter((x) => x.endsWith('.json')).sort()) {
  const add = JSON.parse(readFileSync(new URL(f, addDir)));
  for (const [c, e] of Object.entries(add)) {
    const cur = (lex[c] ??= {});
    for (const k of [...ENRICHED, 'py']) {
      if (e[k] == null) continue;
      if (cur[k] == null || (k !== 'py' && e.replace) || (k === 'py' && e.pyNote)) { cur[k] = e[k]; n++; }
    }
  }
  renameSync(new URL(f, addDir), new URL(f, doneDir));
}
writeFileSync(lexPath, JSON.stringify(lex, null, 1));
console.log(`merge-lexicon: ${n} fields merged`);
