// One passage: rendering with notes, the Chinese column, lenses, plate, Legge, journal.
import { h, tetragram, lineNames, fmtDate, toast } from '../ui.js';
import { linesFor } from '../draw.js';
import { getPassage, getLexicon, getArt, getEchoes, getWing, getCulture } from '../data.js';
import { openSheet } from '../sheet.js';
import { rich, openChar, hanify, linkRefs } from '../notes.js';
import { isHan } from '../markup.js';
import { state } from '../app.js';
import { addEntry, saveDraft, loadDraft, clearDraft, saveDraftQ, loadDraftQ } from '../journal.js';
import { entryList } from './journal.js';
import { brushPanel } from '../brush.js';
import { sayButton } from '../audio.js';
import { track } from '../track.js';

// Vertical presentation forms: in a vertical column, commas and stops sit at the top right of the cell.
const VERTICAL_PUNCT = { '，': '︐', '、': '︑', '。': '︒', '：': '︓', '；': '︔', '！': '︕', '？': '︖', '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄' };

const THEME = {
  way: 'The Way', seeing: 'Seeing', self: 'Self', leading: 'Leading',
  yielding: 'Yielding', conflict: 'Conflict', simplicity: 'Simplicity',
};
const LENS = [
  ['ground', 'Ground — what the characters say'],
  ['inner', 'Inner'],
  ['leading', 'Leading'],
  ['body', 'Body & strategy'],
  ['nature', 'Nature'],
  ['practice', 'Practice'],
];

export async function passageView(n, drawId) {
  if (!(n >= 1 && n <= 81)) return h('p', { text: 'There are 81 passages.' });
  const [{ text, rich: p }, lex, art, echoes, wing, culture] = await Promise.all([getPassage(n), getLexicon(), getArt(), getEchoes(), getWing(), getCulture()]);
  const ctx = { notes: p?.notes || {} };
  const lines = linesFor(n);
  const draw = drawId ? state.journal.draws.find((d) => d.id === drawId) : null;
  const root = h('article', { class: 'passage' });

  root.append(h('div', { class: 'p-head' },
    h('div', {},
      h('p', { class: 'theme', text: p ? THEME[p.theme] || '' : '' }),
      h('h1', { text: p?.title || `Passage ${n}` }),
      draw ? h('p', { class: 'muted small', text: `Drawn ${fmtDate(draw.at)}` }) : null),
    h('div', { class: 'badge' }, tetragram(lines, { size: 46, label: lineNames(lines) }), h('span', { class: 'num', text: `${n}` }))));

  // Rendering
  if (p) {
    const r = h('div', { class: 'rendering' });
    for (const line of p.rendering) r.append(line.trim() === '' ? h('p', { class: 'gap' }) : rich(line, ctx, { block: true }));
    root.append(r);
    root.append(h('p', { class: 'muted small', text: 'Tap an underlined phrase or any Chinese character to look deeper.' }));
  } else {
    root.append(h('div', { class: 'pending' },
      h('p', { text: 'The new rendering and notes for this passage are still being written. The Chinese and Legge’s 1891 translation are below; tap any character.' })));
  }

  // Chinese column
  const col = h('div', { class: 'column', lang: 'zh-Hant' });
  text.zh.forEach((seg, i) => {
    const gloss = p?.zh?.[i]?.gloss || {};
    const segText = p?.zh?.[i]?.text ?? seg;
    const span = h('span', { class: 'seg' });
    // Each character and the punctuation after it share one unbreakable cell,
    // so a column never starts with a comma.
    let cell = null;
    [...segText].forEach((c, k) => {
      if (isHan(c)) {
        const occ = gloss[String(k)];
        cell = h('span', { class: 'zh-cell' }, h('button', {
          type: 'button', class: occ ? 'han glossed' : 'han',
          'aria-label': `${c} ${(lex[c]?.py || []).join(' ')}`,
          onclick: () => openChar(c, occ, ctx),
        }, c));
        span.append(cell);
      } else {
        const mark = h('span', { class: 'punct', 'aria-hidden': 'true', text: VERTICAL_PUNCT[c] || c });
        (cell || span).append(mark);
      }
    });
    col.append(span);
  });
  // Reading starts at the right edge: scroll there once the column is laid out.
  const colWrap = h('div', { class: 'column-wrap' }, col);
  requestAnimationFrame(() => { colWrap.scrollLeft = colWrap.scrollWidth; });
  root.append(h('h2', { text: 'The Chinese' }),
    colWrap,
    h('p', { class: 'column-hint', text: 'Read top to bottom, right to left. Tap any character to look it up; red ones carry a note for this line.' }));

  // Lenses
  if (p?.lenses) {
    const box = h('section', { 'aria-label': 'Commentary' });
    for (const [k, label] of LENS) {
      if (!p.lenses[k]) continue;
      box.append(h('div', { class: 'lens' }, h('h3', { text: label }), rich(p.lenses[k], ctx, { block: true })));
    }
    root.append(h('h2', { text: 'Reflections' }), box);
  }

  // Old masters: paintings, prints, rubbings, and stories
  const artBox = artSection(n, art, ctx);
  if (artBox) root.append(artBox);

  // Echoes from other classics
  const echoBox = echoSection(n, echoes, ctx);
  if (echoBox) root.append(echoBox);

  // Songs, films, books, shows: the passage in modern culture
  const cultureBox = cultureSection(n, culture);
  if (cultureBox) root.append(cultureBox);

  // A reference to R. L. Wing's reading (our summary, not his words)
  const wingBox = wingSection(n, wing, ctx);
  if (wingBox) root.append(wingBox);

  // Calligraphy plates
  const plates = p?.plates?.length ? p.plates : (p?.glyph ? [{ c: p.glyph }] : []);
  if (plates.length) {
    const box = h('section', { class: 'plates', 'aria-label': 'Characters' }, h('h2', { text: plates.length > 1 ? 'Characters to sit with' : 'A character to sit with' }));
    for (const pl of plates) box.append(await plate(pl, lex[pl.c] || {}, ctx));
    root.append(box);
  }

  // Wang Bi + Legge
  const wb = text.wangbi.map((w, i) => (w ? [text.zh[i], w] : null)).filter(Boolean);
  if (wb.length) {
    root.append(h('details', { class: 'legge' }, h('summary', { text: 'Wang Bi’s commentary (3rd century, Chinese)' }),
      wb.map(([z, w]) => h('p', { lang: 'zh-Hant' }, h('b', {}, hanify(z)), h('br'), hanify(w)))));
  }
  root.append(h('details', { class: 'legge' }, h('summary', { text: 'James Legge’s translation (1891)' }),
    text.legge.map((para) => h('p', { text: para }))));

  const jbox = journalBox(n, draw);
  const qBox = questionSection(p?.questions, jbox);
  root.append(h('hr', { class: 'rule' }));
  if (qBox) root.append(qBox);
  root.append(jbox);
  return root;
}

function credit(a) {
  return [a.artist, a.date, a.collection].filter(Boolean).join(' · ');
}

function sourceName(url) {
  if (/clevelandart\.org/.test(url)) return 'Cleveland Museum of Art (open access)';
  if (/artic\.edu/.test(url)) return 'Art Institute of Chicago (open access)';
  return 'Wikimedia Commons';
}

export function openArt(a, entry, ctx, { passages } = {}) {
  track('art', String(a.file).replace(/^art\//, '').replace(/\.jpg$/, ''));
  openSheet({
    kind: 'Painting', title: a.title,
    build: () => h('div', {},
      h('img', { class: 'art-full', src: a.file, alt: a.alt || a.title, width: a.w, height: a.h }),
      a.titleZh ? h('p', { class: 'zh-quote', lang: 'zh-Hant' }, hanify(a.titleZh, ctx)) : null,
      h('p', { class: 'muted small', text: credit(a) }),
      entry.look ? rich(entry.look, ctx, { block: true }) : null,
      h('p', { class: 'src' }, `${a.license}. `, h('a', { href: a.source, target: '_blank', rel: 'noopener noreferrer', text: `Source: ${sourceName(a.source)}` })),
      passageLinks(passages)),
  });
}

/** "Read passage N" chips, for sheets opened outside a passage page. */
export function passageLinks(passages) {
  if (!passages?.length) return null;
  return h('p', { class: 'links' }, [...new Set(passages)].sort((x, y) => x - y).map((n) => h('a', { href: `#/p/${n}`, text: `Passage ${n}` })));
}

export function openStory(st, ctx = {}, { links = false } = {}) {
  track('story', st.title);
  openSheet({
    kind: 'A story', title: st.title,
    build: () => {
      const box = h('div', {});
      for (const para of String(st.text).split(/\n{2,}/)) box.append(rich(para, ctx, { block: true }));
      if (st.source) box.append(h('p', { class: 'src', text: `From ${st.source}. Retold for this page.` }));
      if (links) { const l = passageLinks(st.passages); if (l) box.append(l); }
      return box;
    },
  });
}

const WING_KIND = { idea: 'An idea', story: 'A story he tells', interpretation: 'His reading', contrast: 'Where we differ' };

export function openWingNote(note, book, ctx = {}) {
  openSheet({
    kind: `R. L. Wing · ${WING_KIND[note.kind] || 'Reference'}`, title: note.title,
    build: () => h('div', {},
      ...String(note.body || '').split(/\n{2,}/).map((para) => rich(para, ctx, { block: true })),
      h('p', { class: 'src' }, `${note.ref || 'The Tao of Power'}. Summarized in our own words; not quoted. `,
        book?.link ? h('a', { href: book.link, target: '_blank', rel: 'noopener noreferrer', text: `${book.title} (${book.year})` }) : null)),
  });
}

function wingSection(n, wing, ctx) {
  const list = wing.passages?.[n] || [];
  if (!list.length) return null;
  const box = h('section', { class: 'echoes wing-ref', 'aria-label': 'A reference to R. L. Wing' },
    h('h2', { text: 'A reference: R. L. Wing' }),
    h('p', { class: 'muted small', text: 'The 1986 book that inspired this page. These are short summaries in our own words.' }));
  for (const note of list) {
    box.append(h('button', { class: 'story-btn wing-btn', type: 'button', onclick: () => openWingNote(note, wing.book, ctx) },
      h('span', { class: 'kind', text: WING_KIND[note.kind] || 'Reference' }), h('span', { text: note.title })));
  }
  return box;
}

export function openEcho(e, ctx = {}, { passages } = {}) {
  track('echo', e.id);
  const lang = /musashi|five rings|五輪/i.test(e.source) ? 'ja' : 'zh-Hant';
  openSheet({
    kind: e.source, title: e.title,
    build: () => h('div', {},
      e.quote ? h('blockquote', { class: 'echo-quote' },
        h('p', { lang }, hanify(e.quote, ctx)),
        e.quoteEn ? h('p', { class: 'muted', text: e.quoteEn }) : null) : null,
      ...String(e.body || '').split(/\n{2,}/).map((para) => rich(para, ctx, { block: true })),
      passageLinks(passages)),
  });
}

export const CULTURE_KIND = {
  song: 'Song', poem: 'Poem', film: 'Film', tv: 'TV', episode: 'TV episode', anime: 'Anime', manga: 'Manga',
  comic: 'Comic', music: 'Music', album: 'Album', novel: 'Novel', 'short-story': 'Short story', book: 'Book', ad: 'Ad', game: 'Game',
};

const WATCH = new Set(['film', 'tv', 'episode', 'anime', 'ad', 'game']);
const LISTEN = new Set(['song', 'music', 'album']);
const READ = new Set(['poem', 'novel', 'book', 'short-story']);
const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
const firstName = (c) => String(c || '').split(/[;(]| and |, /)[0].trim();
const bare = (t) => String(t).replace(/\s*\([^)]*\)\s*$/, '');

/** Links that let a reader see, hear, or read the work now. Searches, not guessed video ids. */
export function cultureLinks(c) {
  const out = [];
  if (LISTEN.has(c.kind)) out.push(['▶ Listen on YouTube', yt(`${bare(c.title)} ${firstName(c.creator)}`), 'play']);
  else if (c.kind === 'episode') out.push(['▶ Watch on YouTube', yt(`${c.title} clip`), 'play']);
  else if (c.kind === 'game') out.push(['▶ Watch on YouTube', yt(`${bare(c.title)} ${c.year || ''} trailer`), 'play']);
  else if (c.kind === 'ad') out.push(['▶ Watch on YouTube', yt(`${bare(c.title)} ${firstName(c.creator)} ad`), 'play']);
  else if (WATCH.has(c.kind)) out.push(['▶ Watch on YouTube', yt(`${bare(c.title)} ${c.year || ''} trailer`), 'play']);
  if (c.kind === 'poem' || c.kind === 'short-story') out.push(['▶ Hear a reading', yt(`${bare(c.title)} ${firstName(c.creator)} reading`), 'play']);
  if (READ.has(c.kind) && c.year && c.year < 1929) out.push(['Read free', `https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(`${bare(c.title)} ${firstName(c.creator)}`)}`, 'read']);
  out.push(['Wikipedia', c.link, 'wiki']);
  return h('p', { class: 'c-links' }, out.map(([label, href, kind]) => h('a', { class: `c-link ${kind}`, href, target: '_blank', rel: 'noopener noreferrer', text: label, onclick: () => track('culture', `${c.kind}:${kind}:${c.id}`) })));
}

function cultureSection(n, culture) {
  const list = culture.passages?.[n] || [];
  if (!list.length) return null;
  return h('section', { class: 'culture', 'aria-label': 'In our time' },
    h('h2', { text: 'In our time' }),
    h('p', { class: 'muted small', text: 'Songs, films, books, and shows that explore this passage, or show its opposite. “Watch” and “Listen” open a YouTube search for the work.' }),
    h('ul', { class: 'culture-list' }, list.map((c) => h('li', { id: `c-${c.id}` },
      h('p', { class: 'c-head' },
        h('span', { class: 'kind', text: `${CULTURE_KIND[c.kind] || c.kind}${c.contrast ? ' · by contrast' : ''}` }),
        h('a', { href: c.link, target: '_blank', rel: 'noopener noreferrer', class: 'c-title', text: c.title }),
        h('span', { class: 'muted small', text: [c.creator, c.year].filter(Boolean).join(', ') })),
      h('p', { class: 'c-why' }, linkRefs(c.why)),
      cultureLinks(c)))));
}

function echoSection(n, echoes, ctx) {
  const list = echoes.passages?.[n] || [];
  if (!list.length) return null;
  const box = h('section', { class: 'echoes', 'aria-label': 'Echoes in other classics' }, h('h2', { text: 'Echoes' }));
  for (const e of list) {
    box.append(h('button', { class: 'story-btn echo-btn', type: 'button', onclick: () => openEcho(e, ctx) },
      h('span', { class: 'kind', text: e.source }), h('span', { text: e.title })));
  }
  return box;
}

function artSection(n, art, ctx) {
  const entries = (art.passages?.[n] || []).filter((e) => art.catalog?.[e.id]);
  const stories = Object.values(art.stories || {}).filter((st) => (st.passages || []).includes(n));
  if (!entries.length && !stories.length) return null;
  const box = h('section', { class: 'old-masters', 'aria-label': 'Paintings and stories' }, h('h2', { text: 'From the old masters' }));
  for (const e of entries) {
    const a = art.catalog[e.id];
    box.append(h('figure', { class: 'art' },
      h('button', { class: 'art-btn', type: 'button', 'aria-label': `Look closer: ${a.title}`, onclick: () => openArt(a, e, ctx) },
        h('img', { src: a.file, alt: a.alt || a.title, width: a.w, height: a.h, loading: 'lazy', decoding: 'async' })),
      h('figcaption', {},
        h('b', { text: a.title }), ' ', h('span', { class: 'muted small', text: credit(a) }),
        e.caption ? h('span', { class: 'art-cap' }, rich(e.caption, ctx)) : null,
        h('button', { class: 'btn quiet small-btn', type: 'button', text: 'How to look at it', onclick: () => openArt(a, e, ctx) }))));
  }
  for (const st of stories) {
    box.append(h('button', { class: 'story-btn', type: 'button', onclick: () => openStory(st, ctx) },
      h('span', { class: 'kind', text: 'A story' }), h('span', { text: st.title })));
  }
  return box;
}

async function plate(pl, e, ctx) {
  const c = pl.c;
  const panel = await brushPanel(c, { label: `${c} written with a brush` });
  let order = false;
  const orderBtn = h('button', { class: 'btn quiet', type: 'button', 'aria-pressed': 'false', text: 'Stroke order',
    onclick: () => { order = !order; panel.showOrder(order); orderBtn.setAttribute('aria-pressed', String(order)); } });
  const el = h('section', { class: 'frame plate', 'aria-label': `Character ${c}` },
    h('span', { class: 'chop', lang: 'zh-Hant', 'aria-hidden': 'true', text: '道' }),
    h('div', { class: 'plate-top' },
      panel.el,
      panel.hasStrokes ? h('div', { class: 'controls' },
        h('button', { class: 'btn quiet', type: 'button', text: 'Write it again', onclick: () => panel.write() }), orderBtn) : null,
      h('h3', {}, h('span', { lang: 'zh-Hant', text: `${c} ` }), pl.title || ''),
      h('p', { class: 'py', text: (e.py || []).join(' · ') }),
      e.py?.length ? h('p', { class: 'say-row' }, e.py.map((py) => sayButton(py, c, `Hear ${py}`))) : null),
    pl.lesson ? [h('h4', { text: 'The character' }), rich(pl.lesson, ctx, { block: true })] : (e.story ? rich(e.story, ctx, { block: true }) : null),
    pl.brush ? [h('h4', { text: 'The brush' }), rich(pl.brush, ctx, { block: true })] : null,
    h('div', { class: 'controls' }, h('button', { class: 'btn quiet', type: 'button', text: 'Dictionary & ancient forms', onclick: () => openChar(c, null, ctx) })));
  if (panel.hasStrokes && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((ents) => {
      if (ents.some((x) => x.isIntersecting)) { io.disconnect(); panel.write(); }
    }, { threshold: 0.6 });
    io.observe(panel.el);
  }
  return el;
}

// Questions to sit with: each one can be taken into the journal box below.
function questionSection(qs, jbox) {
  if (!qs?.length) return null;
  const box = h('section', { class: 'sit', 'aria-label': 'Questions to sit with' },
    h('h2', { text: 'Sit with it' }),
    h('p', { class: 'muted small', text: 'Test the passage against your own life. Take your time with each question. Then write what arises.' }));
  for (const q of qs) {
    box.append(h('div', { class: 'sit-q' },
      h('p', { class: 'sit-claim', text: q.claim }),
      h('ul', {}, q.prompts.map((pr) => h('li', { text: pr }))),
      h('button', { class: 'btn quiet small-btn', type: 'button', text: 'Write about this', onclick: () => { track('question', q.id); jbox.ask(q); } })));
  }
  return box;
}

// One pair of global listeners saves whichever draft is on screen.
let currentFlush = null;
addEventListener('pagehide', () => currentFlush?.());
document.addEventListener('visibilitychange', () => { if (document.hidden) currentFlush?.(); });
addEventListener('hashchange', () => { currentFlush?.(); currentFlush = null; });

function journalBox(n, draw) {
  const ta = h('textarea', { id: 'jtext', 'aria-label': 'Your thoughts on this passage', placeholder: 'What arises?' });
  ta.value = loadDraft(n);
  let q = loadDraftQ(n);
  const qLine = h('div', { class: 'jq', hidden: true });
  const showQ = () => {
    qLine.hidden = !q;
    if (q) qLine.replaceChildren(h('span', { class: 'kind', text: 'Writing on' }), h('span', { class: 'jq-claim', text: q.claim }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Stop writing on this question', text: '×', onclick: () => { q = null; saveDraftQ(n, null); showQ(); } }));
  };
  showQ();
  let t;
  const flush = () => saveDraft(n, ta.value);
  ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(flush, 600); });
  currentFlush = flush;
  const list = h('div');
  const refresh = () => list.replaceChildren(entryList(state.journal.entries.filter((e) => e.passage === n), { showPassage: false, onChange: refresh }));
  const save = () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    addEntry(state.journal, { passage: n, text, drawId: draw?.id, q });
    if (state.persist()) { track('journal-save', n); ta.value = ''; q = null; clearDraft(n); showQ(); toast('Saved.'); refresh(); }
  };
  refresh();
  const el = h('section', { class: 'jbox', 'aria-label': 'Journal' },
    h('h2', { text: 'Journal' }),
    h('label', { for: 'jtext', class: 'muted small', text: new Date().toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) }),
    qLine,
    ta,
    h('div', { class: 'row' }, h('span', { class: 'muted small', text: 'Saved in this browser. Export from Journal.' }),
      h('button', { class: 'btn primary', type: 'button', text: 'Save', onclick: save })),
    list);
  el.ask = (next) => {
    q = { id: next.id, claim: next.claim };
    saveDraftQ(n, q);
    showQ();
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    ta.focus({ preventScroll: true });
  };
  return el;
}
