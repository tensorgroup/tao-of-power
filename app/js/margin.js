// Margin tabs: notes the reader pins beside any block of a passage page, like notes in a book's margin.
// A tab is a journal entry with `at: { key, snip }`; the page marks its blocks with data-mark="key".
// The tabs live in one overlay layer, so the blocks' own DOM (and the Listen word spans) stay untouched.
import { h, fill, toast, keepAboveKeyboard } from './ui.js';
import { state } from './app.js';
import { addEntry, saveDraft, loadDraft, clearDraft } from './journal.js';
import { draftWriter } from './drafts.js';
import { openSheet } from './sheet.js';
import { entryList } from './views/journal.js';
import { track } from './track.js';

const JUMP = 'tao.jump';
const SNIP = 90;

/** Before a link to passage n: ask the page to scroll to the block `key` once it is drawn. */
export function jumpTo(n, key) {
  try { sessionStorage.setItem(JUMP, `${n}|${key}`); } catch { /* best effort */ }
}

const flat = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const snipOf = (el) => { const t = flat(el); return t.length > SNIP ? `${t.slice(0, SNIP)}…` : t; };
// A line key is an index into the rendering, so a content edit can shift it onto another line.
// Such a tab keeps its place only while the line still starts with the words it was pinned to.
const stillThere = (at, b) => !at.key.startsWith('line:') || !at.snip || flat(b).startsWith(at.snip.replace(/…$/, ''));
const draftKey = (n, key) => `m${n}|${key}`;

/**
 * root: the passage <article>. fallback: the key that holds tabs whose block is gone
 * (a content edit can remove a line or a question). onChange: the journal changed.
 */
export function marginTabs(root, n, { fallback, onChange } = {}) {
  const layer = h('div', { class: 'mlayer' });
  root.classList.add('has-margin');
  root.append(layer);
  let marking = false;
  const buttons = new Map();

  const blocks = () => new Map([...root.querySelectorAll('[data-mark]')].map((b) => [b.dataset.mark, b]));
  const groups = (byKey = blocks()) => {
    const g = new Map();
    for (const e of state.journal.entries) {
      if (e.passage !== n || !e.at) continue;
      const b = byKey.get(e.at.key);
      const key = b && stillThere(e.at, b) ? e.at.key : fallback;
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
    const keep = new Set();
    for (const { key, b, list, top } of spots) {
      const y = Math.max(top, last + 2 * rem); // close blocks: stack the tabs, never overlap
      last = y;
      keep.add(key);
      // One button per key, kept across redraws, so focus (and the sheet's return focus) survives.
      let tab = buttons.get(key);
      if (!tab) { tab = h('button', { type: 'button', onclick: () => open(key, b) }); buttons.set(key, tab); }
      const where = key === fallback ? 'the journal' : snipOf(b).slice(0, 40);
      tab.className = list.length ? 'mtab' : 'mtab add';
      tab.setAttribute('aria-label', list.length ? `Margin notes beside “${where}” (${list.length})` : `Add a margin note beside “${where}”`);
      tab.textContent = list.length > 1 ? String(list.length) : list.length ? '' : '+';
      tab.style.top = `${y}px`;
    }
    for (const [key, tab] of buttons) if (!keep.has(key)) { tab.remove(); buttons.delete(key); }
    // DOM order follows the page, so the Tab key moves down the page.
    for (const { key } of spots) layer.append(buttons.get(key));
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
        let writer = null; // stopped by discardDrafts() ("Remove it from this browser")
        const render = () => {
          const list = groups().get(key) || [];
          const ta = keepAboveKeyboard(h('textarea', { 'aria-label': 'New margin note', placeholder: 'A note in the margin' }));
          ta.value = loadDraft(draftKey(n, key)); // a closed sheet keeps what was typed
          writer?.release();
          writer = draftWriter(() => saveDraft(draftKey(n, key), ta.value));
          ta.addEventListener('input', () => writer.schedule());
          const save = () => {
            const text = ta.value.trim();
            if (!text) { ta.focus(); return; }
            addEntry(state.journal, { passage: n, text, at: { key, snip: key === fallback ? '' : snipOf(b) } });
            if (state.persist()) { clearDraft(draftKey(n, key)); toast('Saved.'); render(); changed(); }
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
