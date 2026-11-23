// The draw: 64 sticks, four casts, one tetragram.
import { h, s, tetragram, lineNames, fmtDate } from '../ui.js';
import { drawTetragram, bundleRemainder } from '../draw.js';
import { recordDraw } from '../journal.js';
import { state } from '../app.js';
import { getIndex } from '../data.js';

const N = 64;
const PITCH = 9;          // stick spacing
const W = 3.4;            // stick width
const GAP = 42;           // space between bundles
const VB_W = N * PITCH + GAP * 2 + 20;
const TOP = 38, STICK_H = 120;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const LINE_WORD = ['solid', 'broken once', 'broken twice'];

export async function drawView() {
  const idx = await getIndex();
  const root = h('section', { class: 'draw' });
  const start = h('div', {},
    h('p', { class: 'big', lang: 'zh-Hant', 'aria-hidden': 'true', text: '道' }),
    h('h1', { class: 'sr-title', text: 'Draw a passage' }),
    h('p', { class: 'lede', text: 'Settle. Hold a question lightly, or none at all. Then let the sticks fall.' }),
    h('div', { class: 'row actions' }, h('button', { class: 'btn red', type: 'button', text: 'Draw', onclick: () => run(root) })),
  );
  root.append(start, recentList(idx));
  return root;
}

function recentList(idx) {
  const draws = [...state.journal.draws].reverse().slice(0, 6);
  if (!draws.length) return h('div');
  return h('div', { class: 'recent' }, h('h2', { text: 'Recent draws' }), h('ul', {},
    draws.map((d) => h('li', {}, h('a', { href: `#/p/${d.passage}` },
      tetragram(d.lines || [], { size: 26 }),
      h('span', {}, h('b', { text: `${d.passage}` }), ' ', h('span', { class: 'muted', text: idx.passages?.[d.passage]?.title || '' })),
      h('span', { class: 'muted small', text: fmtDate(d.at) }))))));
}

async function run(root) {
  const result = drawTetragram();
  let skip = reduced();
  const wait = (ms) => (skip ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

  const svg = s('svg', { class: 'sticks', viewBox: `0 0 ${VB_W} 200`, role: 'img', 'aria-label': 'Sixty-four sticks' });
  const sticks = [];
  for (let i = 0; i < N; i++) {
    const r = s('rect', { class: 'stick', x: 10 + i * PITCH + GAP, y: TOP, width: W, height: STICK_H, rx: 1.4 });
    sticks.push(r); svg.append(r);
  }
  const status = h('p', { class: 'cast-state', 'aria-live': 'polite' });
  const build = h('div', { class: 'build' }, tetragram([0, 0, 0, 0], { size: 92, ghostFrom: 0 }));
  const skipBtn = h('button', { class: 'btn quiet', type: 'button', text: 'Skip', onclick: () => { skip = true; } });
  const stage = h('div', { class: 'stage' }, svg, status, build, h('div', { class: 'row actions' }, skipBtn));
  root.replaceChildren(stage);

  const lines = [];
  for (let c = 0; c < 4; c++) {
    const cast = result.casts[c];
    const ord = ['first', 'second', 'third', 'fourth'][c];
    status.textContent = `The ${ord} cast. The sticks divide.`;
    reset(sticks);
    await wait(c === 0 ? 500 : 350);
    // Bundles laid out left→right as [left, middle, right]; the book counts the right one first.
    const [right, middle, left] = cast.bundles;
    const sizes = [left, middle, right];
    let k = 0;
    const groups = sizes.map((size, b) => {
      const g = sticks.slice(k, k + size);
      const dx = (b - 1) * GAP * 0.6;
      g.forEach((st) => { st.style.transform = `translateX(${dx}px)`; });
      k += size;
      return g;
    });
    await wait(800);
    // Count right, middle, left — by threes.
    let total = 0;
    for (const b of [2, 1, 0]) {
      const g = groups[b];
      const rem = bundleRemainder(g.length);
      total += rem;
      const keep = new Set(g.slice(g.length - rem));
      const counted = g.filter((st) => !keep.has(st));
      for (let i = 0; i < counted.length; i += 3) {
        counted.slice(i, i + 3).forEach((st) => st.classList.add('counted'));
        await wait(Math.max(18, 260 / Math.ceil(g.length / 3)));
      }
      keep.forEach((st) => { st.classList.add('kept'); st.style.transform += ' translateY(-26px)'; });
      status.replaceChildren(`Counting by threes… `, h('b', { text: `${total}` }), ` set aside.`);
      await wait(380);
    }
    lines.push(cast.line);
    build.replaceChildren(tetragram([...lines, 0, 0, 0].slice(0, 4), { size: 92, ghostFrom: lines.length }));
    status.replaceChildren(h('b', { text: `${cast.total}` }), ` sticks — the ${ord} line is ${LINE_WORD[cast.line]}.`);
    await wait(900);
  }

  const d = recordDraw(state.journal, { passage: result.n, lines: result.lines, bundles: result.casts.map((x) => x.bundles) });
  state.persist();
  skipBtn.remove();
  build.replaceChildren(h('div', { class: 'badge' }, tetragram(result.lines, { size: 92, label: lineNames(result.lines) }), h('span', { class: 'num', text: `${result.n}` })));
  status.textContent = `Passage ${result.n}.`;
  const go = () => { location.hash = `#/p/${result.n}?d=${d.id}`; };
  stage.append(h('div', { class: 'row actions' }, h('button', { class: 'btn primary', type: 'button', text: 'Read the passage', onclick: go })));
  if (!skip) await wait(1400);
  if (location.hash === '' || location.hash === '#/' ) go();
}

function reset(sticks) {
  for (const st of sticks) { st.classList.remove('counted', 'kept'); st.style.transform = ''; }
}

