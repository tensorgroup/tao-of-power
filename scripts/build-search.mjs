// Build the search index: one entry per passage, note, question, story, artwork,
// echo, plate, glossary term, and Wing note, each with a 256-d int8 vector made
// by app/js/search-core.js (the same code the browser runs on the query).
// Writes app/data/search/index.json and app/data/search/vecs.bin.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { loadModel, embed, toInt8 } from '../app/js/search-core.js';

const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const MODEL = 'potion-r29k-256-q4';

const meta = read(`app/model/${MODEL}.json`);
const bin = readFileSync(new URL(`app/model/${MODEL}.bin`, root));
const model = loadModel(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

const plain = (s) => String(s || '').replace(/\[\[([^|\]]*)\|[^\]]*\]\]/g, '$1').replace(/\s+/g, ' ').trim();
const snip = (s, n = 170) => { const t = plain(s); return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t; };
const fold = (s) => plain(s).toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');

const docs = [];
const add = (type, key, title, body, passages = [], snippetFrom = body) => {
  docs.push({ type, key, title: plain(title), snippet: snip(snippetFrom), passages, body: `${plain(title)}. ${plain(body)}` });
};

const files = readdirSync(new URL('app/data/passages/', root)).filter((f) => /^\d\d\.json$/.test(f)).sort();
for (const f of files) {
  const p = read(`app/data/passages/${f}`);
  const n = p.n;
  const rendering = p.rendering.filter((l) => l.trim()).map(plain).join(' / ');
  add('passage', n, `${n} · ${p.title}`, `${rendering} ${Object.values(p.lenses || {}).join(' ')}`, [n], rendering);
  for (const [id, note] of Object.entries(p.notes || {})) add('note', [n, id], note.title, note.body, [n]);
  for (const q of p.questions || []) add('question', [n, q.id], q.claim, `${q.claim} ${q.prompts.join(' ')}`, [n], q.prompts[0]);
  (p.plates || []).forEach((pl, i) => add('plate', [n, i], `${pl.c} ${pl.title || ''}`, `${pl.lesson} ${pl.brush}`, [n], pl.lesson));
}

const art = read('app/data/art.json');
for (const [id, st] of Object.entries(art.stories || {})) add('story', id, st.title, `${st.text} ${st.source}`, st.passages || [], st.text);
const uses = {};
for (const [n, list] of Object.entries(art.passages || {})) for (const e of list) (uses[e.id] ||= []).push([Number(n), e]);
for (const [id, a] of Object.entries(art.catalog || {})) {
  const u = uses[id] || [];
  const words = u.map(([, e]) => `${e.caption || ''} ${e.look || ''}`).join(' ');
  add('art', id, a.title, `${a.titleZh || ''} ${a.artist || ''} ${a.date || ''} ${a.alt || ''} ${words}`, u.map(([n]) => n), u[0]?.[1]?.caption || a.alt);
}

const echoes = read('app/data/echoes.json');
for (const [n, list] of Object.entries(echoes.passages || {})) {
  for (const e of list) add('echo', [Number(n), e.id], e.title, `${e.source} ${e.quote || ''} ${e.quoteEn || ''} ${e.body}`, [Number(n)], e.quoteEn || e.body);
}
const wing = read('app/data/wing.json');
for (const [n, list] of Object.entries(wing.passages || {})) {
  list.forEach((w, i) => add('wing', [Number(n), i], w.title, w.body, Number(n) ? [Number(n)] : []));
}
let culture = { passages: {} };
try { culture = read('app/data/culture.json'); } catch { /* not written yet */ }
for (const [n, list] of Object.entries(culture.passages || {})) {
  for (const c of list) add('culture', [Number(n), c.id], c.title, `${c.kind} ${c.creator || ''} ${c.year || ''} ${c.why}`, [Number(n)], `${[c.creator, c.year].filter(Boolean).join(', ')}. ${c.why}`);
}
for (const [k, g] of Object.entries(read('app/data/glossary.json'))) add('glossary', k, g.term, `${g.zh || ''} ${g.short} ${g.body || ''}`, [], g.short);

const dim = meta.dim;
const vecs = new Int8Array(docs.length * dim);
docs.forEach((d, i) => { const v = embed(model, d.body); if (v) vecs.set(toInt8(v), i * dim); });

const out = new URL('app/data/search/', root);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('index.json', out), JSON.stringify({
  model: MODEL, dim, count: docs.length,
  docs: docs.map(({ type, key, title, snippet, passages }) => ({ type, key, title, snippet, passages })),
  text: docs.map((d) => fold(d.body)),
}));
writeFileSync(new URL('vecs.bin', out), Buffer.from(vecs.buffer));
const by = docs.reduce((m, d) => ((m[d.type] = (m[d.type] || 0) + 1), m), {});
console.log(`search: ${docs.length} entries`, by);
