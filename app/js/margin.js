// Margin tabs: notes the reader pins beside any block of a passage page, like notes in a book's margin.
// A tab is a journal entry with `at: { key, snip }`; the page marks its blocks with data-mark="key".
// The tabs live in one overlay layer, so the blocks' own DOM (and the Listen word spans) stay untouched.
import { h, fill, toast, keepAboveKeyboard } from './ui.js';
import { state } from './app.js';
import { addEntry } from './journal.js';
import { openSheet } from './sheet.js';
import { entryList } from './views/journal.js';
import { track } from './track.js';

const JUMP = 'tao.jump';
const SNIP = 90;

/** Before a link to passage n: ask the page to scroll to the block `key` once it is drawn. */
export function jumpTo(n, key) {
  try { sessionStorage.setItem(JUMP, `${n}|${key}`); } catch { /* best effort */ }
}

const snipOf = (el) => {
  const t = (el?.textContent || '').replace(/\s+/g, ' ').trim();
  return t.length > SNIP ? `${t.slice(0, SNIP)}…` : t;
};

/**
 * root: the passage <article>. fallback: the key that holds tabs whose block is gone
 * (a content edit can remove a line or a question). onChange: the journal changed.
 */
export function marginTabs(root, n, { fallback, onChange } = {}) {
  const layer = h('div', { class: 'mlayer' });
  root.classList.add('has-margin');
  root.append(layer);
  let marking = false;

  const blocks = () => new Map([...root.querySelectorAll('[data-mark]')].map((b) => [b.dataset.mark, b]));
  const groups = (byKey = blocks()) => {
    const g = new Map();
    for (const e of state.journal.entries) {
      if (e.passage !== n || !e.at) continue;
      const key = byKey.has(e.at.key) ? e.at.key : fallback;
      if (!g.has(key)) g.set(key, []);
      g.get(key).push(e);
    }
    return g;
  };

  let queued = false;
  const draw = () => {
    queued = false;
    if (!root.isConnected) return;
    const byKey = blocks();
    const g = groups(byKey);
    const base = root.getBoundingClientRect().top;
    const spots = [];
    for (const [key, b] of byKey) {
      const list = g.get(key) || [];
      if ((!list.length && !marking) || !b.getClientRects().length) continue; // nothing to show, or hidden
      spots.push({ key, b, list, top: b.getBoundingClientRect().top - base });
    }
    spots.sort((x, y) => x.top - y.top);
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    let last = -Infinity;
    fill(layer, spots.map(({ key, b, list, top }) => {
      const y = Math.max(top, last + 1.7 * rem); // close blocks: stack the tabs, never overlap
      last = y;
      const tab = h('button', {
        class: list.length ? 'mtab' : 'mtab add', type: 'button',
        'aria-label': list.length ? `Margin notes here (${list.length})` : 'Add a margin note here',
        text: list.length > 1 ? String(list.length) : list.length ? '' : '+',
        onclick: () => open(key, b),
      });
      tab.style.top = `${y}px`;
      return tab;
    }));
  };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };

  const changed = () => { later(); onChange?.(); };

  const open = (key, b) => {
    track('margin', n);
    openSheet({
      title: 'Margin note',
      kind: 'Your tab',
      build: () => {
        const box = h('div', { class: 'mnote' });
        const render = () => {
          const list = groups().get(key) || [];
          const ta = keepAboveKeyboard(h('textarea', { 'aria-label': 'New margin note', placeholder: 'A note in the margin' }));
          const save = () => {
            const text = ta.value.trim();
            if (!text) { ta.focus(); return; }
            addEntry(state.journal, { passage: n, text, at: { key, snip: snipOf(b) } });
            if (state.persist()) { toast('Saved.'); render(); changed(); }
          };
          fill(box,
            b && key !== fallback ? h('p', { class: 'mnote-at', text: `Beside: ${snipOf(b)}` }) : null,
            list.length ? entryList(list, { showPassage: false, onChange: () => { render(); changed(); } }) : null,
            h('div', { class: 'jedit' }, ta,
              h('div', { class: 'tools' }, h('button', { class: 'btn primary', type: 'button', text: 'Save', onclick: save }))));
        };
        render();
        return box;
      },
    });
  };

  const toggle = h('button', {
    class: 'btn quiet small-btn mark-toggle', type: 'button', 'aria-pressed': 'false', text: 'Margin tabs',
    onclick: () => {
      marking = !marking;
      toggle.setAttribute('aria-pressed', String(marking));
      root.classList.toggle('marking', marking);
      draw();
    },
  });

  // Draw now, and again whenever the page's layout moves (images load, Listen rows appear, details open).
  new ResizeObserver(later).observe(root);
  addEventListener('resize', later, { passive: true });
  addEventListener('hashchange', () => removeEventListener('resize', later), { once: true });

  // A link from the Journal page asked for one block: scroll to it once the page is in the document.
  let want = null;
  try { want = sessionStorage.getItem(JUMP); sessionStorage.removeItem(JUMP); } catch { /* ignore */ }
  const [wn, wkey] = (want || '').split('|');
  if (Number(wn) === n && wkey) {
    let tries = 0;
    const go = () => {
      if (!root.isConnected) { if (tries++ < 120) requestAnimationFrame(go); return; }
      const b = blocks().get(wkey) || blocks().get(fallback);
      if (!b) return;
      b.scrollIntoView({ block: 'center' });
      b.classList.add('mflash');
      setTimeout(() => b.classList.remove('mflash'), 1600);
    };
    requestAnimationFrame(go);
  }

  return { toggle, refresh: later };
}
