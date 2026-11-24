// Search by idea: static-embedding similarity plus exact-word matches, all in the browser.
import { h, fill } from '../ui.js';
import { loadModel, rank } from '../search-core.js';
import { getArt, getEchoes, getWing, getPassage } from '../data.js';
import { openNote, openGlossary } from '../notes.js';
import { openArt, openStory, openEcho, openWingNote } from './passage.js';
import { libraryLinks } from './library.js';
import { track } from '../track.js';

const MODEL = 'potion-r29k-256-q4';
let indexP = null;
let modelP = null;

function loadIndex() {
  indexP ||= Promise.all([
    fetch('data/search/index.json').then((r) => { if (!r.ok) throw new Error(`index ${r.status}`); return r.json(); }),
    fetch('data/search/vecs.bin').then((r) => { if (!r.ok) throw new Error(`vectors ${r.status}`); return r.arrayBuffer(); }),
  ]).then(([ix, buf]) => ({
    docs: ix.docs, dim: ix.dim, vecs: new Int8Array(buf), texts: ix.text, titles: ix.docs.map((d) => d.title.toLowerCase()),
  })).catch((e) => { indexP = null; throw e; });
  return indexP;
}

function loadSearchModel() {
  modelP ||= Promise.all([
    fetch(`model/${MODEL}.json`).then((r) => { if (!r.ok) throw new Error(`model ${r.status}`); return r.json(); }),
    fetch(`model/${MODEL}.bin`).then((r) => { if (!r.ok) throw new Error(`model ${r.status}`); return r.arrayBuffer(); }),
  ]).then(([meta, buf]) => loadModel(meta, buf)).catch((e) => { modelP = null; throw e; });
  return modelP;
}

const LABEL = {
  passage: 'Passage', note: 'Note', question: 'Question to sit with', plate: 'Character', story: 'Story',
  art: 'Art', echo: 'Echo', wing: 'R. L. Wing (summary)', glossary: 'Glossary', culture: 'In our time',
};
const FILTERS = [
  ['all', 'All', null],
  ['passage', 'Passages', ['passage', 'question', 'plate']],
  ['note', 'Notes', ['note']],
  ['story', 'Stories', ['story']],
  ['art', 'Art', ['art']],
  ['culture', 'In our time', ['culture']],
  ['more', 'Echoes & more', ['echo', 'wing', 'glossary']],
];
const SUGGEST = ['letting go of control', 'fear of death', 'knowing when to stop', 'water', 'leading without force', 'a newborn child', 'emptiness', 'Cook Ding'];

async function openResult(d) {
  const k = d.key;
  if (d.type === 'note') { const { rich: p } = await getPassage(k[0]); if (p?.notes?.[k[1]]) openNote(k[1], { notes: p.notes }, { passage: k[0] }); return; }
  if (d.type === 'story') { const art = await getArt(); const st = art.stories?.[k]; if (st) openStory(st, {}, { links: true }); return; }
  if (d.type === 'art') {
    const art = await getArt();
    const a = art.catalog?.[k];
    const used = Object.entries(art.passages || {}).flatMap(([n, l]) => l.filter((e) => e.id === k).map((e) => [Number(n), e]));
    if (a && used.length) openArt(a, used[0][1], {}, { passages: used.map(([n]) => n) });
    return;
  }
  if (d.type === 'echo') { const ec = await getEchoes(); const e = (ec.passages?.[k[0]] || []).find((x) => x.id === k[1]); if (e) openEcho(e, {}, { passages: [k[0]] }); return; }
  if (d.type === 'wing') { const w = await getWing(); const note = w.passages?.[k[0]]?.[k[1]]; if (note) openWingNote(note, w.book); return; }
  if (d.type === 'glossary') openGlossary(k);
}

const opensSheet = (type) => !['passage', 'question', 'plate', 'culture'].includes(type);

function resultRow(d) {
  const main = [h('span', { class: 'kind', text: LABEL[d.type] || d.type }), h('span', { class: 'r-title', text: d.title }),
    d.snippet && d.type !== 'question' ? h('span', { class: 'r-snip', text: d.snippet }) : null];
  const target = opensSheet(d.type)
    ? h('button', { class: 'r-main', type: 'button', onclick: () => openResult(d) }, main)
    : h('a', { class: 'r-main', href: `#/p/${d.passages[0]}` }, main);
  // A culture item links to its passage, where the item sits with its Wikipedia link.
  const chips = opensSheet(d.type) && d.passages?.length
    ? h('span', { class: 'r-links' }, [...new Set(d.passages)].sort((a, b) => a - b).slice(0, 6).map((n) => h('a', { href: `#/p/${n}`, text: `№ ${n}` })))
    : null;
  return h('li', { class: 'result' }, target, chips);
}

export async function searchView(initial = '') {
  let filter = 'all';
  let index = null;
  let model = null;
  let timer;
  let searchTimer;
  const input = h('input', {
    type: 'search', id: 'q', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: 'An idea, a feeling, a name…', 'aria-label': 'Search by idea or word',
  });
  input.value = initial;
  const status = h('p', { class: 'muted small search-status', role: 'status', 'aria-live': 'polite' });
  const chips = h('div', { class: 'filters', role: 'group', 'aria-label': 'Show' });
  const results = h('ol', { class: 'results' });
  const suggest = h('p', { class: 'suggest' }, 'Try: ', SUGGEST.map((s) => h('button', { class: 'chip', type: 'button', text: s, onclick: () => { input.value = s; run(); } })));

  const setStatus = () => {
    if (!index) status.textContent = 'Loading the index…';
    else if (!model) status.textContent = 'Loading meaning search (about 4 MB, once; then it works offline). Showing word matches for now.';
    else status.textContent = '';
  };
  const run = () => {
    if (!input.isConnected || !location.hash.startsWith('#/search')) return; // the user has left Search
    const q = input.value.trim();
    history.replaceState(null, '', q ? `#/search?q=${encodeURIComponent(q)}` : '#/search');
    suggest.hidden = !!q;
    if (!q || !index) { fill(results); return; }
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => track('search', filter), 1500); // that a search happened, never its words
    const types = FILTERS.find(([k]) => k === filter)[2];
    const ranked = rank(model, q, index, { limit: 40, filter: types ? (d) => types.includes(index.docs[d].type) : null });
    // Relative cutoff: scores vary a lot by query (a Chinese term scores only on exact matches).
    const top = ranked[0]?.[1] || 0;
    const shown = ranked.filter(([, s]) => s > 0.01 && s >= Math.max(0.12, top * 0.6));
    fill(results, ...shown.map(([d]) => resultRow(index.docs[d])));
    if (!shown.length) results.append(h('li', { class: 'muted', text: 'Nothing close. Try other words, or fewer.' }));
    if (model) status.textContent = shown.length ? `${shown.length} result${shown.length === 1 ? '' : 's'}` : '';
  };
  const drawChips = () => fill(chips, ...FILTERS.map(([k, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(filter === k), text: label, onclick: () => { filter = k; drawChips(); run(); },
  })));
  drawChips();
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 160); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(); input.blur(); } });

  setStatus();
  // setTimeout: when the files are already loaded, these resolve before route() attaches the view.
  loadIndex().then((ix) => { index = ix; setTimeout(() => { setStatus(); run(); }, 0); })
    .catch(() => { status.textContent = 'The search index could not load. If you are offline, open Search once while online.'; });
  loadSearchModel().then((m) => { model = m; setTimeout(() => { setStatus(); run(); }, 0); })
    .catch(() => { if (index) status.textContent = 'Meaning search could not load; showing word matches only.'; });

  // After route() has put the view on the page and focused it.
  setTimeout(() => { if (!initial && input.isConnected) input.focus({ preventScroll: true }); }, 0);
  return h('section', { class: 'library search' },
    libraryLinks('search'),
    h('h1', { text: 'Search' }),
    h('p', { class: 'muted', text: 'Search by idea, not only by word: “letting go”, “grief”, “a ruler who taxes too much”. It looks through the passages, notes, questions, stories, art, and echoes. Everything runs on this device.' }),
    h('form', { class: 'search-box', role: 'search', onsubmit: (e) => { e.preventDefault(); run(); input.blur(); } }, input),
    chips, status, suggest, results);
}
