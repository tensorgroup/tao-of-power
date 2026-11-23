// Local-only guard: shipped English must not share 6-word runs with Wing's OCR,
// and must not use his titles or coined terms. Needs Billy's local book files.
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const ocrPath = new URL('taoofpower/TaoOfPower.ocr.txt', root);
if (!existsSync(ocrPath)) { console.log('copyright-guard: OCR not present, skipped'); process.exit(0); }

const N = 6;
const words = (s) => s.toLowerCase().replace(/\[\[([^|\]]*)\|[^\]]*\]\]/g, '$1').match(/[a-z0-9']+/g) || [];
const grams = (ws) => { const g = new Set(); for (let i = 0; i + N <= ws.length; i++) g.add(ws.slice(i, i + N).join(' ')); return g; };

const wing = grams(words(readFileSync(ocrPath, 'utf8')));
const allowPath = new URL('scripts/ngram-allow.txt', root);
const allow = new Set(existsSync(allowPath) ? readFileSync(allowPath, 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean) : []);
const legge = JSON.parse(readFileSync(new URL('sources/legge.json', root)));
const leggeText = legge.flatMap((c) => c.paras).join(' ').toLowerCase();
const leggeGrams = grams(words(leggeText));

const deny = [];
const studyDir = new URL('docs/study/wing/', root);
if (existsSync(studyDir)) {
  for (const f of readdirSync(studyDir).filter((x) => x.startsWith('denylist'))) {
    for (const l of readFileSync(new URL(f, studyDir), 'utf8').split('\n')) {
      const t = l.replace(/^[-*\s]+/, '').trim().toLowerCase();
      // Skip single words and phrases Legge (public domain) also uses: they are common, not Wing's.
      if (t.split(/\s+/).length >= 2 && !leggeText.includes(t)) deny.push(t);
    }
  }
}

const problems = [];
const dir = new URL('app/data/passages/', root);
for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith('.json')) : []) {
  const p = JSON.parse(readFileSync(new URL(f, dir)));
  const texts = [p.title, ...p.rendering, ...Object.values(p.lenses || {}),
    ...Object.values(p.notes || {}).flatMap((n) => [n.title, n.body]),
    ...(p.plates || []).flatMap((x) => [x.title, x.lesson, x.brush])];
  for (const t of texts) {
    for (const g of grams(words(t || ''))) {
      // Shared with Legge (public domain) is fine: both quote the same old idioms.
      if (wing.has(g) && !allow.has(g) && !leggeGrams.has(g)) problems.push(`${f}: shares "${g}"`);
    }
    const low = (t || '').toLowerCase();
    for (const d of deny) if (low.includes(d)) problems.push(`${f}: uses deny-listed "${d}"`);
  }
}
// Lexicon text (stories, gaps) is shipped too.
const lexAll = JSON.parse(readFileSync(new URL('app/data/lexicon.json', root)));
const addDir = new URL('lexicon-add/', root);
const lexFiles = [['lexicon.json', lexAll], ...(existsSync(addDir) ? readdirSync(addDir).filter((x) => x.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(new URL(f, addDir)))]) : [])];
for (const [f, obj] of lexFiles) {
  for (const [c, e] of Object.entries(obj)) {
    for (const t of [e.story, e.gap, ...(e.senses || [])]) {
      for (const g of grams(words(t || ''))) if (wing.has(g) && !allow.has(g) && !leggeGrams.has(g)) problems.push(`${f} ${c}: shares "${g}"`);
    }
  }
}
if (problems.length) { console.error([...new Set(problems)].join('\n')); process.exit(1); }
console.log('copyright-guard OK');
