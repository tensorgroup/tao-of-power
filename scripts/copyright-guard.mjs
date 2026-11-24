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
    ...(p.plates || []).flatMap((x) => [x.title, x.lesson, x.brush]),
    ...(p.questions || []).flatMap((q) => [q.claim, ...(q.prompts || [])])];
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
// Echoes, stories, and Wing reference notes are shipped prose too.
const scanFile = (rel, pick, n = N) => {
  const fp = new URL(rel, root);
  if (!existsSync(fp)) return;
  const wingN = n === N ? wing : (() => { const g = new Set(); const ws = words(readFileSync(ocrPath, 'utf8')); for (let i = 0; i + n <= ws.length; i++) g.add(ws.slice(i, i + n).join(' ')); return g; })();
  const leggeN = n === N ? leggeGrams : (() => { const g = new Set(); const ws = words(leggeText); for (let i = 0; i + n <= ws.length; i++) g.add(ws.slice(i, i + n).join(' ')); return g; })();
  for (const [where, t] of pick(JSON.parse(readFileSync(fp)))) {
    const ws = words(t || '');
    for (let i = 0; i + n <= ws.length; i++) {
      const g = ws.slice(i, i + n).join(' ');
      if (wingN.has(g) && !allow.has(g) && !leggeN.has(g)) problems.push(`${rel} ${where}: shares "${g}"`);
    }
  }
};
scanFile('app/data/echoes.json', (d) => Object.entries(d.passages || {}).flatMap(([n, l]) => l.flatMap((e) => [[`${n}/${e.id}`, e.title], [`${n}/${e.id}`, e.body], [`${n}/${e.id}`, e.quoteEn]])));
scanFile('app/data/art.json', (d) => [
  ...Object.entries(d.stories || {}).flatMap(([id, st]) => [[id, st.title], [id, st.text]]),
  ...Object.entries(d.passages || {}).flatMap(([n, l]) => l.flatMap((e) => [[`${n}`, e.caption], [`${n}`, e.look]])),
]);
scanFile('app/data/culture.json', (d) => Object.entries(d.passages || {}).flatMap(([n, l]) => l.map((e) => [`${n}/${e.id}`, e.why])));
scanFile('app/data/wing.json', (d) => Object.entries(d.passages || {}).flatMap(([n, l]) => l.flatMap((e) => [[`${n}`, e.title], [`${n}`, e.body]])), 5);

if (problems.length) { console.error([...new Set(problems)].join('\n')); process.exit(1); }
console.log('copyright-guard OK');
