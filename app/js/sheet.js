// Bottom sheet with a back stack. openSheet() pushes; chained notes push again.
import { h, clear } from './ui.js';

let stack = [];
let root, scrim, panel, titleEl, kindEl, bodyEl, backBtn, lastFocus;

function ensure() {
  if (panel) return;
  root = document.getElementById('sheet-root');
  scrim = h('div', { class: 'scrim', onclick: closeAll });
  backBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', text: '‹', onclick: back });
  kindEl = h('span', { class: 'kind' });
  titleEl = h('h2', { id: 'sheet-title' });
  bodyEl = h('div', { class: 'body' });
  panel = h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    h('div', { class: 'grab', 'aria-hidden': 'true' }),
    h('header', {}, backBtn, h('div', { class: 'ttl' }, kindEl, titleEl),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', text: '×', onclick: closeAll })),
    bodyEl);
  // Swipe down on the header to close.
  let y0 = null;
  panel.addEventListener('touchstart', (e) => { if (bodyEl.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  panel.addEventListener('touchend', (e) => {
    if (y0 != null && e.changedTouches[0].clientY - y0 > 70) closeAll();
    y0 = null;
  }, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) closeAll(); });
}

function render() {
  const top = stack.at(-1);
  kindEl.textContent = top.kind || '';
  titleEl.textContent = top.title || '';
  backBtn.hidden = stack.length < 2;
  clear(bodyEl).append(top.build());
  bodyEl.scrollTop = 0;
}

/** build: () => Node. Pushes onto the stack (so chained notes can go back). */
export function openSheet({ title, kind, build }) {
  ensure();
  const opening = stack.length === 0;
  stack.push({ title, kind, build });
  render();
  if (opening) {
    lastFocus = document.activeElement;
    root.append(scrim, panel);
    requestAnimationFrame(() => { scrim.classList.add('in'); panel.classList.add('in'); });
    panel.querySelector('.icon-btn[aria-label="Close"]').focus({ preventScroll: true });
  }
}

function back() {
  stack.pop();
  if (stack.length) render(); else closeAll();
}

export function closeAll() {
  if (!panel || !stack.length) return;
  stack = [];
  scrim.classList.remove('in');
  panel.classList.remove('in');
  setTimeout(() => { scrim.remove(); panel.remove(); }, 280);
  lastFocus?.focus?.({ preventScroll: true });
}

export const sheetOpen = () => stack.length > 0;
