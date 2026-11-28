// Small DOM helpers. Text always goes in via textContent — never innerHTML.

export function h(tag, attrs = {}, ...children) {
  const el = tag === 'svg' || attrs.svg
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false || k === 'svg') continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function s(tag, attrs = {}, ...children) {
  return h(tag, { ...attrs, svg: true }, ...children);
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replace an element's children. Like native replaceChildren(), but skips null and false (which it would print as "null"). */
export function fill(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

/** Tetragram SVG. lines bottom→top; 0 solid, 1 one break, 2 two breaks. */
export function tetragram(lines, { size = 44, ghostFrom = 4, label } = {}) {
  const w = size;
  const lh = Math.max(3, Math.round(size / 10));
  const gap = Math.round(lh * 1.25);
  const hgt = lh * 4 + gap * 3;
  const svg = s('svg', {
    class: 'tetra', width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`,
    role: label ? 'img' : null, 'aria-label': label || null, 'aria-hidden': label ? null : 'true',
  });
  for (let i = 0; i < 4; i++) {
    const y = hgt - lh - i * (lh + gap); // i = 0 is the bottom line
    const v = lines[i] ?? 0;
    const g = s('g', { class: i >= ghostFrom ? 'ghost' : null, 'data-line': i });
    const pieces = v + 1;
    const cut = Math.round(w * 0.12);
    const seg = (w - cut * v) / pieces;
    for (let p = 0; p < pieces; p++) g.append(s('rect', { x: p * (seg + cut), y, width: seg, height: lh, rx: 0.6 }));
    svg.append(g);
  }
  return svg;
}

export function lineNames(lines) {
  const name = ['solid', 'one break', 'two breaks'];
  return lines.map((v) => name[v]).join(', ');
}

/** A persistent "Update ready" banner that other toasts cannot replace. */
export function showUpdate(onRefresh, { text = 'Update ready. ', label = 'Refresh' } = {}) {
  let el = document.getElementById('update');
  if (!el) {
    el = h('div', { id: 'update', role: 'status' });
    document.body.append(el);
  }
  el.replaceChildren(text, h('button', { type: 'button', text: label, onclick: () => { el.remove(); onRefresh(); } }));
}

let toastTimer;
export function toast(msg, { action, onAction, warn = false, ms = 3500 } = {}) {
  const t = document.getElementById('toast');
  clear(t);
  t.className = warn ? 'warn' : '';
  t.append(document.createTextNode(msg));
  if (action) t.append(h('button', { type: 'button', text: action, onclick: () => { t.hidden = true; onAction?.(); } }));
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export const pad2 = (n) => String(n).padStart(2, '0');

export function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Keep a text box above the phone keyboard while the reader types.
 * The keyboard shrinks the visual viewport. On the page, scroll so the box sits between the top bar
 * and the keyboard. In the bottom sheet (position: fixed), lift the sheet above the keyboard instead,
 * and scroll the sheet's own body. Runs on focus and when the keyboard resizes the viewport, never
 * per keystroke: while typing, the browser keeps the caret in view.
 */
export function keepAboveKeyboard(el) {
  const vv = window.visualViewport;
  if (!vv) return el;
  let queued = false;
  let sheet = null;
  const gap = 12;
  const fitPage = () => {
    const r = el.getBoundingClientRect();
    const top = Math.max(vv.offsetTop, document.querySelector('.bar')?.getBoundingClientRect().bottom ?? 0) + gap;
    const bottom = vv.offsetTop + vv.height - gap;
    if (r.height > bottom - top) return; // taller than the free space: the browser owns the caret
    const d = r.bottom > bottom ? r.bottom - bottom : r.top < top ? r.top - top : 0;
    if (Math.abs(d) > 1) scrollBy({ top: d, behavior: 'auto' });
  };
  const fitSheet = () => {
    const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop); // keyboard height over the layout viewport
    sheet.style.bottom = kb ? `${kb}px` : '';
    sheet.style.maxHeight = kb ? `${Math.max(160, vv.height - gap)}px` : '';
    const body = el.closest('.body');
    if (!body) return;
    const r = el.getBoundingClientRect(); const b = body.getBoundingClientRect();
    if (r.bottom > b.bottom - gap && r.height < b.height) body.scrollTop += r.bottom - b.bottom + gap;
  };
  const fit = () => {
    queued = false;
    if (!el.isConnected || document.activeElement !== el) { stop(); return; }
    if (sheet) fitSheet(); else fitPage();
  };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(fit); } };
  function stop() {
    vv.removeEventListener('resize', later);
    if (sheet) { sheet.style.bottom = ''; sheet.style.maxHeight = ''; }
  }
  el.addEventListener('focus', () => {
    sheet = el.closest('.sheet');
    vv.addEventListener('resize', later);
    later(); setTimeout(later, 350); // the keyboard opens after focus
  });
  el.addEventListener('blur', stop);
  return el;
}
