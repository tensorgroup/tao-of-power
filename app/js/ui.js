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
