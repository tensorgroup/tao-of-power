// Bottom sheet with a back stack. openSheet() pushes; chained notes push again.
// Each level also pushes a browser history entry, so the phone's back gesture
// steps back through the notes and then closes the sheet, and never leaves the page.
import { h, clear } from './ui.js';

let stack = [];
let root, scrim, panel, titleEl, kindEl, crumbsEl, bodyEl, backBtn, lastFocus, closeTimer;

// True when the current history entry is the one we pushed for the top level.
const ownsHistory = () => stack.length > 0 && history.state?.sheet === stack.length;
const stateDepth = () => history.state?.sheet || 0;

// History steps we started with history.go() and whose popstate has not come yet,
// and note levels opened meanwhile (their pushState waits until the step lands).
let pending = 0, queued = 0;

function go(n) { pending++; history.go(n); }

// Keep the note stack and browser history in step after any history move.
function onPopState() {
  const depth = stateDepth();
  if (pending) {
    pending--;
    if (pending) return;
    const base = stack.length - queued; // levels that history should show now
    if (depth > base) { go(base - depth); return; } // landed on stale entries: keep going back
    const trimmed = depth < base;
    if (trimmed) stack.splice(depth, base - depth); // the step we started removed levels
    for (let i = 1; i <= queued; i++) history.pushState({ sheet: depth + i }, '');
    queued = 0;
    if (trimmed) { if (stack.length) render(); else hide(); }
    return;
  }
  // A move by the reader (back or forward gesture, browser buttons).
  if (depth < stack.length) popTo(depth);
  else if (depth > stack.length) go(stack.length - depth); // stale entries (after a link or a forward move)
}

if (typeof window !== 'undefined') {
  // A reload keeps history.state; a sheet entry with no sheet on screen is stale.
  if (history.state?.sheet) history.replaceState(null, '');
  addEventListener('popstate', onPopState);
}

function ensure() {
  if (panel) return;
  root = document.getElementById('sheet-root');
  scrim = h('div', { class: 'scrim', onclick: closeAll });
  backBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', text: '‹', onclick: back });
  kindEl = h('span', { class: 'kind' });
  titleEl = h('h2', { id: 'sheet-title' });
  crumbsEl = h('nav', { class: 'crumbs', 'aria-label': 'Notes you opened' });
  bodyEl = h('div', { class: 'body' });
  panel = h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    h('div', { class: 'grab', 'aria-hidden': 'true' }),
    h('header', {}, backBtn, h('div', { class: 'ttl' }, kindEl, titleEl),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', text: '×', onclick: closeAll })),
    crumbsEl,
    bodyEl);
  enableDrag();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) closeAll(); });
}

// An element between the touch and the panel that scrolls sideways keeps its swipe.
function inSideScroller(el) {
  for (; el && el !== panel; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

// Pull down to close, or swipe left to right to go back one note (close on the first).
// The sheet follows the finger; a long or fast move acts, a short one springs back.
// A pull that starts in the scrolled body only counts when the body is at its top,
// so reading still scrolls normally.
function enableDrag() {
  let x0 = null, y0 = null, t0 = 0, dx = 0, dy = 0, mode = null, fromBody = false, sideOk = false, inSide = false;
  // Clear the gesture and any half-moved position, so the sheet is never stuck.
  const reset = () => {
    x0 = y0 = null; dx = dy = 0; mode = null;
    panel.classList.remove('dragging');
    panel.style.transform = '';
    scrim.style.opacity = '';
  };
  panel.addEventListener('touchstart', (e) => {
    if (!stack.length || e.touches.length !== 1) { reset(); return; } // closing, or a second finger
    const t = e.touches[0];
    fromBody = bodyEl.contains(e.target);
    // The left screen edge belongs to the browser's own back gesture.
    inSide = inSideScroller(e.target);
    sideOk = t.clientX > 24 && !inSide;
    x0 = t.clientX; y0 = t.clientY; t0 = e.timeStamp; dx = dy = 0; mode = null;
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dx = e.touches[0].clientX - x0;
    dy = e.touches[0].clientY - y0;
    if (!mode) {
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (sideOk && dx > 10 && ax > ay * 1.5) mode = 'x';
      else if (ax > 10 && ax > ay) { reset(); return; } // a sideways move we do not own
      else {
        if (dy < -4 || (fromBody && bodyEl.scrollTop > 0)) { reset(); return; } // an upward move is a scroll
        // Claim a clearly downward move at once, so the page and pull-to-refresh never start.
        // iOS decides native panning on the first move, so never claim a sideways start
        // or a touch on a sideways scroller (it would freeze that scroller).
        if (dy > 0 && ay > ax && !inSide && e.cancelable) e.preventDefault();
        if (dy < 8) return;
        mode = 'y';
      }
      panel.classList.add('dragging');
    }
    if (e.cancelable) e.preventDefault();
    if (mode === 'x') {
      const d = Math.max(0, dx);
      panel.style.transform = `translateX(${d}px)`;
      if (stack.length === 1) scrim.style.opacity = String(Math.max(0, 1 - d / (panel.offsetWidth || 1)));
    } else {
      const d = Math.max(0, dy);
      panel.style.transform = `translateY(${d}px)`;
      scrim.style.opacity = String(Math.max(0, 1 - d / (panel.offsetHeight || 1)));
    }
  }, { passive: false });
  panel.addEventListener('touchend', (e) => {
    const ms = Math.max(1, e.timeStamp - t0);
    const m = mode;
    const goBack = m === 'x' && (dx > Math.min(110, panel.offsetWidth * 0.3) || (dx / ms > 0.5 && dx > 40));
    const close = m === 'y' && (dy > Math.min(140, panel.offsetHeight * 0.3) || (dy / ms > 0.6 && dy > 30));
    reset();
    if (goBack) back();
    else if (close) closeAll();
  }, { passive: true });
  // An interrupted gesture springs back; it never closes the sheet.
  panel.addEventListener('touchcancel', reset, { passive: true });
}

const crumbLabel = (s) => s.title || s.kind || 'Note';

// The trail of notes above the current one. Tap a step to jump back to it.
function renderCrumbs() {
  clear(crumbsEl);
  crumbsEl.hidden = stack.length < 2;
  if (crumbsEl.hidden) return;
  stack.forEach((s, i) => {
    const last = i === stack.length - 1;
    if (i) crumbsEl.append(h('span', { class: 'sep', 'aria-hidden': 'true', text: '›' }));
    crumbsEl.append(last
      ? h('span', { class: 'crumb here', 'aria-current': 'page', text: crumbLabel(s) })
      : h('button', { class: 'crumb', type: 'button', text: crumbLabel(s), onclick: () => jumpTo(i + 1) }));
  });
  crumbsEl.scrollLeft = crumbsEl.scrollWidth; // show the newest steps
}

function render() {
  const top = stack.at(-1);
  kindEl.textContent = top.kind || '';
  titleEl.textContent = top.title || '';
  backBtn.hidden = stack.length < 2;
  renderCrumbs();
  clear(bodyEl).append(top.build());
  bodyEl.scrollTop = 0;
}

/** build: () => Node. Pushes onto the stack (so chained notes can go back). */
export function openSheet({ title, kind, build }) {
  ensure();
  clearTimeout(closeTimer);
  const opening = stack.length === 0 || !panel.isConnected;
  stack.push({ title, kind, build });
  if (pending) queued++; else history.pushState({ sheet: stack.length }, '');
  render();
  if (opening) {
    lastFocus = document.activeElement;
    root.append(scrim, panel);
    requestAnimationFrame(() => { scrim.classList.add('in'); panel.classList.add('in'); });
    panel.querySelector('.icon-btn[aria-label="Close"]').focus({ preventScroll: true });
  }
}

// Show level `depth` (1 = the first note); 0 closes. Does not touch history.
function popTo(depth) {
  stack.length = Math.min(stack.length, depth);
  if (stack.length) render(); else hide();
}

// Go to level `depth` through history, so the browser's back and forward stay in step.
function jumpTo(depth) {
  if (depth >= stack.length) return;
  if (ownsHistory() && !pending) go(depth - stack.length); // popstate trims the stack
  else popTo(depth);
}

function back() { jumpTo(stack.length - 1); }

function hide() {
  stack = []; queued = 0;
  scrim.classList.remove('in');
  panel.classList.remove('in');
  closeTimer = setTimeout(() => { if (!stack.length) { scrim.remove(); panel.remove(); } }, 280);
  lastFocus?.focus?.({ preventScroll: true });
}

export function closeAll() {
  if (!panel || !stack.length) return;
  // Remove our history entries too, so a later back gesture leaves the page as expected.
  // After a route change the current entry is the new page, not ours: just hide.
  const steps = ownsHistory() && !pending ? stack.length : 0;
  hide();
  if (steps) go(-steps);
}

export const sheetOpen = () => stack.length > 0;
