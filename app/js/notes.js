// Turn marked text into tappable phrases and characters; open notes and character sheets.
import { h } from './ui.js';
import { parseMarked, isHan } from './markup.js';
import { openSheet } from './sheet.js';
import { getLexicon, charLinks } from './data.js';

const KIND_LABEL = {
  etymology: 'Etymology', gap: 'Translation gap', history: 'History', geopolitics: 'Geopolitics',
  wordplay: 'Wordplay', variant: 'Variant reading', wangbi: 'Wang Bi’s comment', legge: 'Legge’s frame',
  practice: 'Practice',
};

/**
 * Render a string with [[text|id]] marks and inline Han characters.
 * ctx = { notes: {id: note}, gloss?: (char, i) => string }
 */
export function rich(str, ctx, { block = false } = {}) {
  const frag = document.createDocumentFragment();
  for (const seg of parseMarked(str || '')) {
    if (seg.note && ctx.notes?.[seg.note]) {
      frag.append(h('button', {
        type: 'button', class: 'mark', 'aria-haspopup': 'dialog',
        onclick: (e) => openNote(seg.note, ctx, e.currentTarget),
      }, hanify(seg.text, ctx)));
    } else {
      frag.append(hanify(seg.text, ctx));
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

export function openNote(id, ctx) {
  const n = ctx.notes[id];
  openSheet({
    kind: KIND_LABEL[n.kind] || n.kind,
    title: n.title,
    build: () => {
      const box = h('div', {});
      for (const para of String(n.body).split(/\n{2,}/)) box.append(rich(para, ctx, { block: true }));
      if (n.src?.length) box.append(h('p', { class: 'src', text: `Sources: ${n.src.join('; ')}` }));
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
