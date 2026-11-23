// Calligraphy: draw a character in textured ink and write it stroke by stroke.
// Stroke data: Make Me a Hanzi (Arphic Public License), 1024-unit em box, y up.
import { s, h } from './ui.js';

let uid = 0;
const cache = new Map();

export function loadStrokes(c) {
  const key = c.codePointAt(0).toString(16);
  if (!cache.has(key)) {
    cache.set(key, fetch(`data/strokes/${key}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return cache.get(key);
}

const polyLen = (pts) => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

function inkFilter(id) {
  return s('filter', { id, x: '-5%', y: '-5%', width: '110%', height: '110%' },
    s('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.032', numOctaves: '2', seed: String(7 + (uid % 5)), result: 'noise' }),
    s('feDisplacementMap', { in: 'SourceGraphic', in2: 'noise', scale: '13', xChannelSelector: 'R', yChannelSelector: 'G', result: 'rough' }),
    s('feGaussianBlur', { in: 'rough', stdDeviation: '1.1', result: 'soft' }),
    s('feMerge', {}, s('feMergeNode', { in: 'soft' }), s('feMergeNode', { in: 'rough' })));
}

/**
 * Build a calligraphy panel for character c.
 * Returns { el, write(), showOrder(bool) }. Falls back to the brush font if no data.
 */
export async function brushPanel(c, { size = 260, label } = {}) {
  const data = await loadStrokes(c);
  const wrap = h('div', { class: 'brush' });
  if (!data) {
    wrap.append(h('div', { class: 'brush-fallback', lang: 'zh-Hant', text: c, role: 'img', 'aria-label': label || c }));
    return { el: wrap, write: () => {}, showOrder: () => {}, hasStrokes: false };
  }
  const id = `b${++uid}`;
  const svg = s('svg', { class: 'brush-svg', viewBox: '0 0 1024 1024', width: size, height: size, role: 'img', 'aria-label': label || `The character ${c}, brushed` });
  const defs = s('defs', {}, inkFilter(`${id}-ink`));
  const g = s('g', { transform: 'scale(1,-1) translate(0,-900)' });
  const guide = s('g', { class: 'brush-guide' });
  const ink = s('g', { class: 'brush-ink', filter: `url(#${id}-ink)` });
  const anim = [];
  data.strokes.forEach((d, i) => {
    guide.append(s('path', { d }));
    const clip = s('clipPath', { id: `${id}-c${i}` }, s('path', { d }));
    defs.append(clip);
    const med = data.medians[i];
    const len = Math.ceil(polyLen(med)) + 140;
    const path = s('path', {
      class: 'brush-stroke',
      d: `M ${med.map((p) => p.join(' ')).join(' L ')}`,
      'clip-path': `url(#${id}-c${i})`,
      'stroke-dasharray': `${len} ${len}`,
      'stroke-dashoffset': '0',
    });
    ink.append(path);
    anim.push({ path, len });
  });
  // Stroke-order numbers in unflipped coordinates (y down).
  const nums = s('g', { class: 'brush-order', 'aria-hidden': 'true' });
  data.medians.forEach((med, i) => {
    const [x, y] = med[0];
    nums.append(s('circle', { cx: x, cy: 900 - y, r: 34 }), s('text', { x, y: 900 - y + 12, 'text-anchor': 'middle' }, String(i + 1)));
  });
  g.append(guide, ink);
  svg.append(defs, g, nums);
  wrap.append(svg);

  let running = 0;
  async function write() {
    const run = ++running;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const { path, len } of anim) {
      path.style.transition = 'none';
      path.style.strokeDashoffset = String(reduced ? 0 : len);
    }
    if (reduced) return;
    svg.getBoundingClientRect(); // commit the hidden state
    for (const { path, len } of anim) {
      if (run !== running) return;
      const ms = Math.round(180 + (len / 1024) * 650);
      path.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(.45,.05,.4,1)`;
      path.style.strokeDashoffset = '0';
      await new Promise((r) => setTimeout(r, ms + 110));
    }
  }
  const showOrder = (on) => wrap.classList.toggle('show-order', on);
  return { el: wrap, write, showOrder, hasStrokes: true };
}
