// Write the precache list and a content version into app/sw.js (between markers).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../app/', import.meta.url));
const SKIP = new Set(['sw.js', 'index.html']);
const LAZY = ['art/', 'model/', 'data/search/'];

/** Hash every file under app/<dir>, recursively, in a stable order. */
function hashDir(dir) {
  const hh = createHash('sha256');
  const walk = (d) => {
    let names = [];
    try { names = readdirSync(d).sort(); } catch { return; }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else { hh.update(relative(app, p)); hh.update(readFileSync(p)); }
    }
  };
  walk(join(app, dir));
  return hh.digest('hex').slice(0, 8);
}

export function listFiles(dir = app) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else {
      const rel = relative(app, p).split('\\').join('/');
      // Art, the search model, and the search index are cached on first use, not at install.
      if (!SKIP.has(rel) && !LAZY.some((d) => rel.startsWith(d))) out.push(rel);
    }
  }
  return out.sort();
}

export function build() {
  const files = listFiles();
  const h = createHash('sha256');
  for (const f of ['index.html', ...files]) { h.update(f); h.update(readFileSync(join(app, f))); }
  const version = h.digest('hex').slice(0, 12);
  const artVersion = hashDir('art');
  const searchVersion = hashDir('data/search');
  const modelVersion = hashDir('model');
  const swPath = join(app, 'sw.js');
  const sw = readFileSync(swPath, 'utf8');
  const block = `// <precache>\nconst VERSION = '${version}';\nconst ART_VERSION = '${artVersion}';\nconst SEARCH_VERSION = '${searchVersion}';\nconst MODEL_VERSION = '${modelVersion}';\nconst FILES = ${JSON.stringify(['./', ...files], null, 1)};\n// </precache>`;
  const next = sw.replace(/\/\/ <precache>[\s\S]*?\/\/ <\/precache>/, block);
  if (next === sw && !sw.includes(block)) throw new Error('precache markers missing in sw.js');
  writeFileSync(swPath, next);
  return { version, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version, files } = build();
  const passages = files.filter((f) => f.startsWith('data/passages/')).length;
  console.log(`precache ${version}: ${files.length + 1} files, ${passages} passages`);
}
