// One passage: rendering with notes, the Chinese column, lenses, plate, Legge, journal.
import { h, tetragram, lineNames, fmtDate, toast } from '../ui.js';
import { linesFor } from '../draw.js';
import { getPassage, getLexicon } from '../data.js';
import { rich, openChar, hanify } from '../notes.js';
import { isHan } from '../markup.js';
import { state } from '../app.js';
import { addEntry, saveDraft, loadDraft, clearDraft } from '../journal.js';
import { entryList } from './journal.js';
import { brushPanel } from '../brush.js';

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
  const [{ text, rich: p }, lex] = await Promise.all([getPassage(n), getLexicon()]);
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
    [...segText].forEach((c, k) => {
      if (isHan(c)) {
        const occ = gloss[String(k)];
        span.append(h('button', {
          type: 'button', class: occ ? 'han glossed' : 'han',
          'aria-label': `${c} ${(lex[c]?.py || []).join(' ')}`,
          onclick: () => openChar(c, occ, ctx),
        }, c));
      } else span.append(h('span', { class: 'punct', 'aria-hidden': 'true', text: c }));
    });
    col.append(span);
  });
  root.append(h('h2', { text: 'The Chinese' }),
    h('div', { class: 'column-wrap' }, col),
    h('p', { class: 'column-hint', text: 'Read top to bottom, right to left. Red characters carry a note for this line.' }));

  // Lenses
  if (p?.lenses) {
    const box = h('section', { 'aria-label': 'Commentary' });
    for (const [k, label] of LENS) {
      if (!p.lenses[k]) continue;
      box.append(h('div', { class: 'lens' }, h('h3', { text: label }), rich(p.lenses[k], ctx, { block: true })));
    }
    root.append(h('h2', { text: 'Reflections' }), box);
  }

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

  root.append(h('hr', { class: 'rule' }), journalBox(n, draw));
  return root;
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
      h('p', { class: 'py', text: (e.py || []).join(' · ') })),
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

function journalBox(n, draw) {
  const ta = h('textarea', { id: 'jtext', 'aria-label': 'Your thoughts on this passage', placeholder: 'What arises?' });
  ta.value = loadDraft(n);
  let t;
  const flush = () => saveDraft(n, ta.value);
  ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(flush, 600); });
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  const list = h('div');
  const refresh = () => list.replaceChildren(entryList(state.journal.entries.filter((e) => e.passage === n), { showPassage: false, onChange: refresh }));
  const save = () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    addEntry(state.journal, { passage: n, text, drawId: draw?.id });
    if (state.persist()) { ta.value = ''; clearDraft(n); toast('Saved.'); refresh(); }
  };
  refresh();
  return h('section', { class: 'jbox', 'aria-label': 'Journal' },
    h('h2', { text: 'Journal' }),
    h('label', { for: 'jtext', class: 'muted small', text: new Date().toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) }),
    ta,
    h('div', { class: 'row' }, h('span', { class: 'muted small', text: 'Saved in this browser. Export from Journal.' }),
      h('button', { class: 'btn primary', type: 'button', text: 'Save', onclick: save })),
    list);
}
