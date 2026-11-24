// Turn marked text into tappable phrases and characters; open notes and character sheets.
import { h } from './ui.js';
import { parseMarked, isHan } from './markup.js';
import { openSheet } from './sheet.js';
import { getLexicon, charLinks } from './data.js';

// ---- Glossary: terms like "Shuowen" become tappable (title gives a hover tooltip) ----
let GLOSS = null;
let GLOSS_RE = null;
const ALIAS = new Map();
export function setGlossary(g) {
  GLOSS = g || {};
  ALIAS.clear();
  for (const [key, e] of Object.entries(GLOSS)) for (const a of [e.term, ...(e.aliases || [])]) ALIAS.set(a.toLowerCase(), key);
  const alts = [...ALIAS.keys()].sort((a, b) => b.length - a.length).map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  GLOSS_RE = alts.length ? new RegExp(`(?<![A-Za-z])(${alts.join('|')})(?![A-Za-z])`, 'gi') : null;
}

export function openGlossary(key, ctx = {}) {
  const e = GLOSS?.[key];
  if (!e) return;
  openSheet({
    kind: 'Glossary', title: e.zh ? `${e.term}  ${e.zh}` : e.term,
    build: () => {
      const box = h('div', {}, h('p', {}, h('b', { text: e.short })));
      const gctx = { ...ctx, notes: Object.fromEntries(Object.keys(GLOSS).map((k) => [k, null])), glossSeen: new Set([key]) };
      for (const para of String(e.body || '').split(/\n{2,}/)) box.append(glossText(para, gctx, true));
      return box;
    },
  });
}

// ---- Passage references: "passage 76", "chapters 1–37", "passages 22, 28 and 39" link to #/p/N ----
const REF_RE = /\b(passages?|chapters?|chs?\.)(\s*)(\d{1,2}(?:\s*(?:,|–|-|and|or|&)\s*\d{1,2})*)(?!\d)/gi;
// "chapter N" of another book must not link to our passage N.
const OTHER_BOOK = /(Zhuangzi|Han ?Feizi|Huainanzi|Xunzi|Liezi|Mencius|Analects|Zuozhuan|Lüshi|Shiji|Sunzi|Yijing|Guanzi|Liji|Red Chamber|Story of the Stone|Illusion Land|Baoyu|Five Rings|Wumenguan|Hongloumeng)/i;

/** Split text into plain pieces (rendered by `plain`) and links to passages. */
export function linkRefs(text, plain = (t) => document.createTextNode(t)) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of String(text).matchAll(new RegExp(REF_RE))) { // a fresh copy: lastIndex starts at 0
    const word = m[1].toLowerCase();
    if (word.startsWith('ch') && OTHER_BOOK.test(text.slice(Math.max(0, m.index - 80), m.index))) continue;
    if (m.index > last) frag.append(plain(text.slice(last, m.index)));
    frag.append(plain(m[1] + m[2]));
    for (const part of m[3].split(/(\d{1,2})/)) {
      if (!part) continue;
      const n = Number(part);
      if (/^\d+$/.test(part) && n >= 1 && n <= 81) frag.append(h('a', { class: 'ref', href: `#/p/${n}`, text: part }));
      else frag.append(plain(part));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(plain(text.slice(last)));
  return frag;
}

/** Walk a built subtree and link passage references in its plain text (skips buttons and links). */
export function linkRefsIn(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('a, button, h1, h2, h3, svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (new RegExp(REF_RE).test(n.textContent)) n.replaceWith(linkRefs(n.textContent));
  }
  return root;
}

/** Plain text → text + glossary buttons + tappable Han characters. Marks each term once per ctx.glossSeen. */
const refHan = (t, ctx) => linkRefs(t, (x) => hanify(x, ctx));

function glossify(text, ctx) {
  const frag = document.createDocumentFragment();
  if (!GLOSS_RE) { frag.append(refHan(text, ctx)); return frag; }
  const seen = ctx.glossSeen || (ctx.glossSeen = new Set());
  let last = 0;
  for (const m of text.matchAll(GLOSS_RE)) {
    const key = ALIAS.get(m[1].toLowerCase());
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (m.index > last) frag.append(refHan(text.slice(last, m.index), ctx));
    frag.append(h('button', {
      type: 'button', class: 'gloss', title: GLOSS[key].short, 'aria-haspopup': 'dialog',
      onclick: (ev) => { ev.stopPropagation(); openGlossary(key, ctx); },
    }, m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(refHan(text.slice(last), ctx));
  return frag;
}

/** Glossary-body text: [[Term|glossKey]] links to other glossary entries. */
function glossText(str, ctx, block) {
  const frag = document.createDocumentFragment();
  for (const seg of parseMarked(str || '')) {
    if (seg.note && GLOSS?.[seg.note]) frag.append(h('button', { type: 'button', class: 'gloss', onclick: () => openGlossary(seg.note, ctx) }, seg.text));
    else frag.append(glossify(seg.text, ctx));
  }
  return block ? h('p', {}, frag) : frag;
}

const KIND_LABEL = {
  etymology: 'Etymology', gap: 'Translation gap', history: 'History', geopolitics: 'Geopolitics',
  wordplay: 'Wordplay', variant: 'Variant reading', wangbi: 'Wang Bi’s comment', legge: 'Legge’s frame',
  practice: 'Practice', pair: 'Paired opposites',
};

/**
 * Render a string with [[text|id]] marks and inline Han characters.
 * ctx = { notes: {id: note}, gloss?: (char, i) => string }
 */
export function rich(str, ctx, { block = false } = {}) {
  const frag = document.createDocumentFragment();
  ctx = { ...ctx, glossSeen: new Set() }; // each paragraph marks its own first mention
  for (const seg of parseMarked(str || '')) {
    if (seg.note && ctx.notes?.[seg.note]) {
      frag.append(h('button', {
        type: 'button', class: 'mark', 'aria-haspopup': 'dialog',
        onclick: (e) => openNote(seg.note, ctx, e.currentTarget),
      }, hanify(seg.text, ctx)));
    } else {
      frag.append(glossify(seg.text, ctx));
    }
  }
  return block ? h('p', {}, frag) : frag;
}

/** Wrap runs of Han characters in tappable buttons; leave other text plain. */
export function hanify(text, ctx = {}) {
  const frag = document.createDocumentFragment();
  let buf = '';
  const flush = () => { if (buf) { frag.append(document.createTextNode(buf)); buf = ''; } };
  for (const c of text) {
    if (isHan(c)) {
      flush();
      frag.append(h('button', { type: 'button', class: 'han', lang: 'zh-Hant', onclick: () => openChar(c, null, ctx) }, c));
    } else buf += c;
  }
  flush();
  return frag;
}

export function openNote(id, ctx, { passage } = {}) {
  const n = ctx.notes[id];
  openSheet({
    kind: KIND_LABEL[n.kind] || n.kind,
    title: n.title,
    build: () => {
      const box = h('div', {});
      for (const para of String(n.body).split(/\n{2,}/)) box.append(rich(para, ctx, { block: true }));
      if (n.src?.length) box.append(h('p', { class: 'src' }, 'Sources: ', glossify(n.src.join('; '), { ...ctx, glossSeen: new Set() })));
      if (passage) box.append(h('p', { class: 'links' }, h('a', { href: `#/p/${passage}`, text: `Passage ${passage}` })));
      return box;
    },
  });
}

export async function openChar(c, occurrence, ctx = {}) {
  const lex = await getLexicon().catch(() => ({}));
  const e = lex[c] || {};
  openSheet({
    kind: 'Character',
    title: `${c}  ${(e.py || []).join(' / ')}`,
    build: () => {
      const box = h('div', {});
      box.append(h('div', { class: 'big-han', lang: 'zh-Hant', 'aria-hidden': 'true', text: c }));
      if (e.py?.length) box.append(h('p', { class: 'py', text: e.py.join(' · ') }));
      const dl = h('dl', {});
      const row = (label, node) => { if (node) dl.append(h('dt', { text: label }), h('dd', {}, node)); };
      if (occurrence) row('Here', rich(occurrence, ctx));
      if (e.senses?.length) row('Senses', h('span', { text: e.senses.join('; ') }));
      else if (e.def) row('Dictionary (Unihan)', h('span', { text: e.def }));
      if (e.parts?.length) {
        row('Parts', h('span', {}, e.parts.map((p, i) => [i ? ' + ' : '', h('span', { lang: 'zh-Hant', class: 'zh-quote', text: p.c }), ` ${p.m}`])));
      }
      if (e.shuowen) row('Shuowen Jiezi (c. 100 CE)', h('span', {}, h('span', { class: 'zh-quote', lang: 'zh-Hant', text: e.shuowen }), e.shuowenEn ? h('span', { text: ` — ${e.shuowenEn}` }) : null));
      if (e.story) row('Story', rich(e.story, ctx));
      if (e.gap) row('Where English fails', rich(e.gap, ctx));
      box.append(dl);
      box.append(h('div', { class: 'links' }, charLinks(c).map((l) => h('a', { href: l.href, target: '_blank', rel: 'noopener noreferrer', text: l.label }))));
      return box;
    },
  });
}
