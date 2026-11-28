// One passage: rendering with notes, the Chinese column, lenses, plate, Legge, journal.
import { h, fill, tetragram, lineNames, fmtDate, toast, keepAboveKeyboard } from '../ui.js';
import { linesFor } from '../draw.js';
import { getPassage, getLexicon, getArt, getEchoes, getWing, getCulture } from '../data.js';
import { openSheet } from '../sheet.js';
import { rich, openChar, hanify, linkRefs } from '../notes.js';
import { isHan, passageChars, segmentsFor, plainLine, wordsOf } from '../markup.js';
import { planLine, wrapWords, wordCell } from '../words.js';
import { state } from '../app.js';
import { syncCard } from './sync-ui.js';
import { addEntry, saveDraft, loadDraft, saveDraftQ, loadDraftQ } from '../journal.js';
import { draftWriter, releaseDrafts, typedText } from '../drafts.js';
import { entryList } from './journal.js';
import { marginTabs } from '../margin.js';
import { brushPanel } from '../brush.js';
import { sayButton } from '../audio.js';
import { track } from '../track.js';
import { listenRow, followTarget, followAllowed, gestureLive, pageFollowDelta, pageFollowStep, lineOnScreen } from '../listen.js';
import { openInYouTubeApp } from '../applink.js';

// Small forms (﹕ ﹗) occur in the source text too; they end a clause like the normal marks.
const CLAUSE_END = new Set(['，', '；', '。', '：', '！', '？', ',', '﹕', '﹗']);
// Opening quotes belong to the character after them, so a column never ends with one.
const OPENERS = new Set(['「', '『']);
const LAYOUT_KEY = 'tao.colLayout';
const getLayout = () => { try { return localStorage.getItem(LAYOUT_KEY) === 'printed' ? 'printed' : 'lines'; } catch { return 'lines'; } };

// Vertical presentation forms: in a vertical column, commas and stops sit at the top right of the cell.
const VERTICAL_PUNCT = { '，': '︐', '、': '︑', '﹑': '︑', '。': '︒', '：': '︓', '﹕': '︓', '；': '︔', '！': '︕', '﹗': '︕', '？': '︖', '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄' };

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
  let tabBar = h('p', { class: 'muted small tab-hint' }); // holds the Margin tabs button

  root.append(h('div', { class: 'p-head' },
    h('div', {},
      h('p', { class: 'theme', text: p ? THEME[p.theme] || '' : '' }),
      h('h1', { text: p?.title || `Passage ${n}` }),
      draw ? h('p', { class: 'muted small', text: `Drawn ${fmtDate(draw.at)}` }) : null),
    h('div', { class: 'badge' }, tetragram(lines, { size: 46, label: lineNames(lines) }), h('span', { class: 'num', text: `${n}` }))));

  // The Listen manifest, fetched once for both rows. The view does not wait for it.
  const manifest = fetch('data/listen.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  let left = false; // the route changed: add no window listeners after this
  addEventListener('hashchange', () => { left = true; }, { once: true });

  // Rendering
  if (p) {
    const r = h('div', { class: 'rendering' });
    const lineEls = []; // the non-empty lines, in order
    for (const [i, line] of p.rendering.entries()) {
      const el = line.trim() === '' ? h('p', { class: 'gap' }) : rich(line, ctx, { block: true });
      if (!el.classList.contains('gap')) { lineEls.push(el); el.dataset.mark = `line:${i}`; }
      r.append(el);
    }
    root.append(r);
    manifest.then((m) => {
      const rec = m?.en?.[n];
      if (rec && !left) englishRow(n, p.rendering, r, lineEls, rec);
    }).catch((e) => console.error(e)); // no English row
    root.append(tabBar = h('p', { class: 'muted small tab-hint' }, h('span', { text: 'Tap an underlined phrase or any Chinese character to look deeper.' })));
  } else {
    root.append(h('div', { class: 'pending' },
      h('p', { text: 'The new rendering and notes for this passage are still being written. The Chinese and Legge’s 1891 translation are below; tap any character.' })));
    root.append(tabBar);
  }

  // Chinese column
  const col = h('div', { class: 'column', lang: 'zh-Hant' });
  const segments = segmentsFor(text, p);
  const chars = passageChars(segments);
  const hanButtons = []; // the button.han elements, in passageChars order
  let listenOk = true; // false when the column and passageChars disagree: no Listen row then
  segments.forEach((segText, i) => {
    const gloss = p?.zh?.[i]?.gloss || {};
    const span = h('span', { class: 'seg' });
    // Each character and the punctuation after it share one unbreakable cell,
    // so a column never starts with a comma. Clauses (ended by ，；。：！？) are
    // wrapped so the "Lines" layout can start each one at the top of a column.
    let cell = null;
    let opener = []; // opening quotes waiting for the next character's cell
    let clause = h('span', { class: 'clause' });
    [...segText].forEach((c, k) => {
      if (isHan(c)) {
        const entry = chars[hanButtons.length];
        if (listenOk && (entry?.ch !== c || entry.seg !== i || entry.k !== k)) {
          console.error(`passage ${n}: column and passageChars disagree at ${hanButtons.length}`);
          listenOk = false;
        }
        const occ = gloss[String(k)];
        const btn = h('button', {
          type: 'button', class: occ ? 'han glossed' : 'han',
          'aria-label': `${c} ${(lex[c]?.py || []).join(' ')}`,
          onclick: () => openChar(c, occ, ctx),
        }, c);
        hanButtons.push(btn);
        cell = h('span', { class: 'zh-cell' }, ...opener, btn);
        opener = [];
        clause.append(cell);
      } else {
        const mark = h('span', { class: 'punct', 'aria-hidden': 'true', text: VERTICAL_PUNCT[c] || c });
        // An opening quote waits for the next character; other punctuation joins the
        // character before it, even across a clause break (as in ？」).
        if (OPENERS.has(c)) { mark.classList.add('opener'); opener.push(mark); return; }
        (cell || clause).append(mark);
        if (CLAUSE_END.has(c) && clause.querySelector('.zh-cell')) { span.append(clause); clause = h('span', { class: 'clause' }); }
      }
    });
    if (opener.length) (cell || clause).append(...opener); // a quote with no character after it
    if (clause.querySelector('.zh-cell')) span.append(clause);
    else if (clause.childNodes.length) (cell || span).append(...clause.childNodes);
    col.append(span);
  });
  // Reading starts at the right edge: scroll there once the column is laid out.
  const colWrap = h('div', { class: 'column-wrap' }, col);
  // When the columns are wider than the screen, a fade and "← more" at the left say so,
  // until the reader has scrolled to the end (the left edge, where the text finishes).
  const more = h('span', { class: 'col-more', 'aria-hidden': 'true' });
  const colBox = h('div', { class: 'column-box', 'data-mark': 'zh' }, colWrap, more);
  const updateMore = () => {
    const overflow = colWrap.scrollWidth > colWrap.clientWidth + 4;
    colBox.classList.toggle('has-more', overflow && colWrap.scrollLeft > 6);
  };
  colWrap.addEventListener('scroll', updateMore, { passive: true });
  const toRight = () => { colWrap.scrollLeft = colWrap.scrollWidth; updateMore(); };
  // Land on the right edge, where reading starts, whenever the layout settles (first attach,
  // the Chinese font arriving), until the reader touches the column themselves.
  let touched = false;
  for (const ev of ['pointerdown', 'touchstart', 'wheel', 'keydown']) colWrap.addEventListener(ev, () => { touched = true; }, { passive: true });
  // Listen follow: keep the spoken character in view, but leave the column alone while the
  // reader scrolls it by hand, and for 4 s after. A touch and a pointer are tracked apart,
  // because Android sends pointercancel once a touch turns into a scroll. A gesture starts
  // in the column but can end anywhere, so the end events are heard on window, until the
  // route changes (passages opened in turn must not pile up listeners).
  let current = -1; // the cell being spoken, or -1
  let pointerDown = false, touchDown = false, gestureStart = 0, lastManual = -Infinity;
  // A stuck flag (end event lost) expires, so the follow's own scrolls never count as manual.
  const gestureActive = () => gestureLive(Date.now(), pointerDown || touchDown, gestureStart);
  const release = () => { lastManual = Date.now(); };
  colWrap.addEventListener('pointerdown', () => { pointerDown = true; gestureStart = Date.now(); }, { passive: true });
  colWrap.addEventListener('touchstart', () => { touchDown = true; gestureStart = Date.now(); }, { passive: true });
  const pointerEnd = () => { if (pointerDown) { pointerDown = false; release(); } };
  const touchEnd = () => { if (touchDown) { touchDown = false; release(); } };
  const ends = [['pointerup', pointerEnd], ['pointercancel', pointerEnd], ['touchend', touchEnd], ['touchcancel', touchEnd]];
  for (const [ev, fn] of ends) addEventListener(ev, fn, { passive: true });
  addEventListener('hashchange', () => { for (const [ev, fn] of ends) removeEventListener(ev, fn, { passive: true }); }, { once: true });
  for (const ev of ['wheel', 'keydown']) colWrap.addEventListener(ev, release, { passive: true });
  colWrap.addEventListener('scroll', () => { if (gestureActive()) release(); }, { passive: true });
  const reveal = (i) => {
    const cell = hanButtons[i].getBoundingClientRect();
    const box = colWrap.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    colWrap.scrollLeft = followTarget({
      cellLeft: cell.left, cellRight: cell.right, boxLeft: box.left, boxRight: box.right,
      scrollLeft: colWrap.scrollLeft, maxScroll: colWrap.scrollWidth - colWrap.clientWidth,
      margin: Math.max(2 * cell.width, 3.2 * rem),
    });
    updateMore();
  };
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (!touched) toRight(); }).observe(col);
  document.fonts?.ready.then(() => { if (!touched && colWrap.isConnected) toRight(); });
  // Layout: "Lines" starts each clause at the top of a column (as many modern
  // editions set the text); "As printed" runs it on continuously, as old books did.
  let layout = getLayout();
  // In "Lines", size the column to its longest clause (each cell is about 1.2em tall).
  // A clause's height in glyphs: its characters, plus an opening quote and any mark inside
  // the clause (孤︑寡︑), which take their own space. The clause's last mark is covered below.
  const units = (c) => {
    const marks = c.querySelectorAll('.punct').length;
    return c.querySelectorAll('.zh-cell').length + (marks ? marks - 1 : 0);
  };
  const longest = Math.max(1, ...[...col.querySelectorAll('.clause')].map(units));
  const applyLayout = () => {
    col.classList.toggle('lines', layout === 'lines');
    // Tall enough for the longest clause, so a line never wraps; capped at 70% of the screen.
    col.style.height = layout === 'lines' ? `min(70svh, ${(longest * 1.22 + 1.1).toFixed(2)}em)` : '';
  };
  applyLayout();
  const layoutBtns = h('div', { class: 'filters col-layout', role: 'group', 'aria-label': 'Layout of the Chinese' });
  const drawLayout = () => fill(layoutBtns, ...[['lines', 'Lines'], ['printed', 'As printed']].map(([k, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(layout === k), text: label,
    onclick: () => { layout = k; try { localStorage.setItem(LAYOUT_KEY, k); } catch { /* ignore */ } applyLayout(); drawLayout(); if (current >= 0) reveal(current); else toRight(); },
  })));
  drawLayout();
  toRight();
  // The Listen row, right under the column, once the manifest says this passage is recorded.
  if (listenOk) manifest.then((m) => {
    const rec = m?.zh?.[n];
    if (!rec) return;
    const row = listenRow({
      n, file: rec.file, times: rec.t, end: rec.end, cells: hanButtons,
      onStart: () => { touched = true; },
      onIndex: (i) => { current = i; if (followAllowed(Date.now(), lastManual, gestureActive())) reveal(i); },
      onStop: () => { current = -1; },
    });
    if (row) layoutBtns.before(row);
  }).catch(() => { /* no Listen row */ });
  root.append(h('h2', { text: 'The Chinese' }),
    colBox, layoutBtns,
    h('p', { class: 'column-hint', text: 'Read top to bottom, right to left. Tap any character to look it up; red ones carry a note for this line.' }));

  // Lenses
  if (p?.lenses) {
    const box = h('section', { 'aria-label': 'Commentary' });
    for (const [k, label] of LENS) {
      if (!p.lenses[k]) continue;
      box.append(h('div', { class: 'lens', 'data-mark': `lens:${k}` }, h('h3', { text: label }), rich(p.lenses[k], ctx, { block: true })));
    }
    root.append(h('h2', { text: 'Reflections' }), box);
  }

  // Old masters: paintings, prints, rubbings, and stories
  const artBox = artSection(n, art, ctx);
  if (artBox) { artBox.dataset.mark = 'sec:art'; root.append(artBox); }

  // Echoes from other classics
  const echoBox = echoSection(n, echoes, ctx);
  if (echoBox) { echoBox.dataset.mark = 'sec:echoes'; root.append(echoBox); }

  // Songs, films, books, shows: the passage in modern culture
  const cultureBox = cultureSection(n, culture);
  if (cultureBox) { cultureBox.dataset.mark = 'sec:culture'; root.append(cultureBox); }

  // A reference to R. L. Wing's reading (our summary, not his words)
  const wingBox = wingSection(n, wing, ctx);
  if (wingBox) { wingBox.dataset.mark = 'sec:wing'; root.append(wingBox); }

  // Calligraphy plates
  const plates = p?.plates?.length ? p.plates : (p?.glyph ? [{ c: p.glyph }] : []);
  if (plates.length) {
    const box = h('section', { class: 'plates', 'aria-label': 'Characters' }, h('h2', { text: plates.length > 1 ? 'Characters to sit with' : 'A character to sit with' }));
    for (const [i, pl] of plates.entries()) { const el = await plate(pl, lex[pl.c] || {}, ctx); el.dataset.mark = `plate:${pl.c}:${i}`; box.append(el); }
    root.append(box);
  }

  // Wang Bi + Legge
  const wb = text.wangbi.map((w, i) => (w ? [text.zh[i], w] : null)).filter(Boolean);
  if (wb.length) {
    root.append(h('details', { class: 'legge', 'data-mark': 'sec:wangbi' }, h('summary', { text: 'Wang Bi’s commentary (3rd century, Chinese)' }),
      wb.map(([z, w]) => h('p', { lang: 'zh-Hant' }, h('b', {}, hanify(z)), h('br'), hanify(w)))));
  }
  root.append(h('details', { class: 'legge', 'data-mark': 'sec:legge' }, h('summary', { text: 'James Legge’s translation (1891)' }),
    text.legge.map((para) => h('p', { text: para }))));

  const jbox = journalBox(n, draw);
  const qBox = questionSection(p?.questions, jbox);
  root.append(h('hr', { class: 'rule' }));
  if (qBox) root.append(qBox);
  const card = draw ? syncCard() : null;
  if (card) root.append(card);
  root.append(jbox);

  // Margin tabs: the reader's own notes beside any marked block. Tabs whose block is gone sit by the journal.
  const tabs = marginTabs(root, n, { fallback: 'sec:journal', onChange: jbox.refresh });
  tabBar.append(tabs.toggle);
  return root;
}

/**
 * The English Listen row, right after the rendering. Wraps each word of each line in span.w,
 * but only when the words on the page match the plain lines and the recording's count
 * (else no row and no spans).
 */
function englishRow(n, rendering, r, lineEls, rec) {
  const plans = lineEls.map(planLine);
  const words = plans.flatMap((pl) => pl.words);
  const expected = rendering.flatMap((l) => wordsOf(plainLine(l)).map((w) => w.word));
  if (words.length !== expected.length || words.some((w, i) => w !== expected[i]) || words.length !== rec.n
    || !Array.isArray(rec.t) || rec.t.length !== words.length) {
    console.error(`passage ${n}: English words and the recording disagree (${words.length} on the page, ${expected.length} in the text, ${rec.n} recorded)`);
    return;
  }
  const cells = [], lineOf = [];
  lineEls.forEach((el, li) => {
    for (const c of wrapWords(el, cells.length, plans[li]).cells) { cells.push(c); lineOf.push(li); }
  });
  // Page follow: keep the spoken line below the sticky bar and above the view bottom. It
  // scrolls only when the spoken line changes. A manual scroll holds it until the spoken line
  // is on screen again, or the reader presses the row's button (pageFollowStep). A scroll
  // counts as manual only during a touch or pointer gesture (a plain tap scrolls nothing); a
  // wheel turn or a scroll key counts at once. Touch and pointer are tracked apart (see the column).
  let pointerDown = false, touchDown = false, gestureStart = 0, scrolled = false;
  let step = { held: false, last: -1 };
  const gestureActive = () => gestureLive(Date.now(), pointerDown || touchDown, gestureStart);
  const release = () => { step = { ...step, held: true }; };
  const begin = () => { gestureStart = Date.now(); scrolled = false; };
  const endGesture = () => { if (scrolled) release(); scrolled = false; }; // momentum runs on after the lift
  const listeners = [
    ['pointerdown', () => { pointerDown = true; begin(); }],
    ['touchstart', () => { touchDown = true; begin(); }],
    ['pointerup', () => { if (pointerDown) { pointerDown = false; endGesture(); } }],
    ['pointercancel', () => { if (pointerDown) { pointerDown = false; endGesture(); } }],
    ['touchend', () => { if (touchDown) { touchDown = false; endGesture(); } }],
    ['touchcancel', () => { if (touchDown) { touchDown = false; endGesture(); } }],
    ['wheel', release],
    // Enter or Space on a button presses it (Listen, a note); that is not a scroll.
    ['keydown', (e) => { if (!((e.key === ' ' || e.key === 'Enter') && e.target?.closest?.('button'))) release(); }],
    ['scroll', () => { if (gestureActive()) { scrolled = true; release(); } }],
  ];
  for (const [ev, fn] of listeners) addEventListener(ev, fn, { passive: true });
  addEventListener('hashchange', () => { for (const [ev, fn] of listeners) removeEventListener(ev, fn, { passive: true }); }, { once: true });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const follow = (i) => {
    const line = lineEls[lineOf[i]].getBoundingClientRect();
    const vv = window.visualViewport;
    const view = {
      top: line.top, bottom: line.bottom,
      barBottom: document.querySelector('.bar')?.getBoundingClientRect().bottom ?? 0,
      // The row sits after the rendering, stuck to the screen bottom while it plays: lines under it are hidden.
      viewBottom: Math.min(vv ? vv.offsetTop + vv.height : innerHeight, row.getBoundingClientRect().top),
      viewTop: vv ? vv.offsetTop : 0,
    };
    const next = pageFollowStep({ line: lineOf[i], ...step, visible: lineOnScreen(view), gesture: gestureActive() });
    step = { held: next.held, last: next.last };
    if (!next.scroll) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const d = pageFollowDelta({ ...view, margin: 2.5 * rem });
    if (d) scrollBy({ top: d, behavior: reduced.matches ? 'auto' : 'smooth' });
  };
  // A press of the button brings the follow back, and the next word scrolls to its line.
  const onPress = () => { step = { held: false, last: -1 }; };
  const row = listenRow({ kind: 'en', n, file: rec.file, times: rec.t, end: rec.end, cells: cells.map(wordCell), onIndex: follow, onPress });
  if (row) r.after(row);
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

/** Links that let a reader see, hear, read, or play the work now. Searches, not guessed video ids. */
export function cultureLinks(c) {
  const out = [];
  if (c.play) out.push([c.playLabel || '▶ Play in browser', c.play, 'game']);
  if (LISTEN.has(c.kind)) out.push(['▶ Listen on YouTube', yt(`${bare(c.title)} ${firstName(c.creator)}`), 'play']);
  else if (c.kind === 'episode') out.push(['▶ Watch on YouTube', yt(`${c.title} clip`), 'play']);
  else if (c.kind === 'game') out.push(['▶ Watch on YouTube', yt(`${bare(c.title)} ${c.year || ''} trailer`), 'play']);
  else if (c.kind === 'ad') out.push(['▶ Watch on YouTube', yt(`${bare(c.title)} ${firstName(c.creator)} ad`), 'play']);
  else if (WATCH.has(c.kind)) out.push(['▶ Watch on YouTube', yt(`${bare(c.title)} ${c.year || ''} trailer`), 'play']);
  if (c.kind === 'poem' || c.kind === 'short-story') out.push(['▶ Hear a reading', yt(`${bare(c.title)} ${firstName(c.creator)} reading`), 'play']);
  if (READ.has(c.kind) && c.year && c.year < 1929) out.push(['Read free', `https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(`${bare(c.title)} ${firstName(c.creator)}`)}`, 'read']);
  out.push(['Wikipedia', c.link, 'wiki']);
  return h('p', { class: 'c-links' }, out.map(([label, href, kind]) => h('a', { class: `c-link ${kind}`, href, target: '_blank', rel: 'noopener noreferrer', text: label, onclick: (e) => { track('culture', `${c.kind}:${kind}:${c.id}`); if (kind === 'play') openInYouTubeApp(e, href); } })));
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
    box.append(h('div', { class: 'sit-q', 'data-mark': `q:${q.id}` },
      h('p', { class: 'sit-claim', text: q.claim }),
      h('ul', {}, q.prompts.map((pr) => h('li', { text: pr }))),
      h('button', { class: 'btn quiet small-btn', type: 'button', text: 'Write about this', onclick: () => { track('question', q.id); jbox.ask(q); } })));
  }
  return box;
}

// One set of global listeners saves the drafts on screen (the text box and the question line). Leaving the
// page writes what is unsaved and ends every writer (releaseDrafts), so a timer cannot write later.
let current = [];
addEventListener('pagehide', () => { for (const w of current) w.flush(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const w of current) w.flush(); });
addEventListener('hashchange', () => { releaseDrafts(); current = []; });

const qText = (q) => (q ? JSON.stringify({ id: q.id, claim: q.claim }) : ''); // '' is "no draft", as for text

function journalBox(n, draw) {
  const ta = keepAboveKeyboard(h('textarea', { id: 'jtext', 'aria-label': 'Your thoughts on this passage', placeholder: 'What arises?' }));
  ta.value = loadDraft(n);
  let q = loadDraftQ(n);
  for (const w of current) w.release();
  const writer = draftWriter({ load: () => loadDraft(n), save: (v) => saveDraft(n, v), value: () => ta.value, delay: 600 });
  const qWriter = draftWriter({ load: () => qText(loadDraftQ(n)), save: (v) => saveDraftQ(n, v ? JSON.parse(v) : null), value: () => qText(q) });
  current = [writer, qWriter];
  const qLine = h('div', { class: 'jq', hidden: true });
  const showQ = () => {
    qLine.hidden = !q;
    if (q) qLine.replaceChildren(h('span', { class: 'kind', text: 'Writing on' }), h('span', { class: 'jq-claim', text: q.claim }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Stop writing on this question', text: '×', onclick: () => { q = null; qWriter.schedule(); showQ(); } }));
  };
  showQ();
  ta.addEventListener('input', () => writer.schedule());
  const list = h('div');
  // Built again after a save, but never over an open entry edit with typed text (that edit has no draft).
  const refresh = () => { if (!typedText(list)) list.replaceChildren(entryList(state.journal.entries.filter((e) => e.passage === n && !e.at), { showPassage: false, onChange: refresh })); };
  // During a removal in another tab the save waits (store.js): the text and its draft stay until it is saved.
  // Then each is cleared only if it still holds what was saved (the reader may have typed on).
  const change = state.editor(); // the box belongs to the account it opened under (with its question line)
  const save = () => {
    const raw = ta.value;
    const text = raw.trim();
    if (!text) { ta.focus(); return; }
    writer.flush();
    const asked = q;
    change(() => addEntry(state.journal, { passage: n, text, drawId: draw?.id, q: asked }), () => {
      track('journal-save', n);
      writer.clearIf(raw);
      if (ta.value === raw) ta.value = '';
      qWriter.clearIf(qText(asked));
      if (q === asked) { q = null; showQ(); }
      toast('Saved.');
      refresh();
    });
  };
  refresh();
  const el = h('section', { class: 'jbox', 'aria-label': 'Journal', 'data-mark': 'sec:journal' },
    h('h2', { text: 'Journal' }),
    h('label', { for: 'jtext', class: 'muted small', text: new Date().toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) }),
    qLine,
    ta,
    h('div', { class: 'row' }, h('span', { class: 'muted small', text: 'Saved in this browser. Export from Journal.' }),
      h('button', { class: 'btn primary', type: 'button', text: 'Save', onclick: save })),
    list);
  el.refresh = refresh;
  el.ask = (next) => {
    q = { id: next.id, claim: next.claim };
    qWriter.schedule();
    showQ();
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    ta.focus({ preventScroll: true });
  };
  return el;
}
