// Bottom sheet with a back stack. openSheet() pushes; chained notes push again.
import { h, clear } from './ui.js';

let stack = [];
let root, scrim, panel, titleEl, kindEl, bodyEl, backBtn, lastFocus, closeTimer;

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
  enableDrag();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) closeAll(); });
}

// Pull down to close. The sheet follows the finger; a long or fast pull closes it,
// a short one springs back. A pull that starts in the scrolled body only counts
// when the body is at its top, so reading still scrolls normally.
function enableDrag() {
  let y0 = null, t0 = 0, dy = 0, dragging = false, fromBody = false;
  // Clear the gesture and any half-pulled position, so the sheet is never stuck.
  const reset = () => {
    y0 = null; dy = 0; dragging = false;
    panel.classList.remove('dragging');
    panel.style.transform = '';
    scrim.style.opacity = '';
  };
  panel.addEventListener('touchstart', (e) => {
    if (!stack.length || e.touches.length !== 1) { reset(); return; } // closing, or a second finger
    fromBody = bodyEl.contains(e.target);
    if (fromBody && bodyEl.scrollTop > 0) { reset(); return; }
    y0 = e.touches[0].clientY; t0 = e.timeStamp; dy = 0; dragging = false;
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (!dragging) {
      if (dy < -4 || (fromBody && bodyEl.scrollTop > 0)) { reset(); return; } // an upward move is a scroll
      // Claim a downward move at once, so the page and pull-to-refresh never start.
      if (dy > 0 && e.cancelable) e.preventDefault();
      if (dy < 8) return;
      dragging = true;
      panel.classList.add('dragging');
    }
    if (e.cancelable) e.preventDefault();
    const d = Math.max(0, dy);
    panel.style.transform = `translateY(${d}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - d / (panel.offsetHeight || 1)));
  }, { passive: false });
  panel.addEventListener('touchend', (e) => {
    const v = dy / Math.max(1, e.timeStamp - t0); // px per ms
    const close = dragging && (dy > Math.min(140, panel.offsetHeight * 0.3) || (v > 0.6 && dy > 30));
    reset();
    if (close) closeAll();
  }, { passive: true });
  // An interrupted gesture springs back; it never closes the sheet.
  panel.addEventListener('touchcancel', reset, { passive: true });
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
  clearTimeout(closeTimer);
  const opening = stack.length === 0 || !panel.isConnected;
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
  closeTimer = setTimeout(() => { if (!stack.length) { scrim.remove(); panel.remove(); } }, 280);
  lastFocus?.focus?.({ preventScroll: true });
}

export const sheetOpen = () => stack.length > 0;
