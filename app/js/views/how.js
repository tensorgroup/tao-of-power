// "How the draw works": a step-by-step, animated explainer.
// Mode 1 — a full practical draw: four random casts build a tetragram and name a passage.
// Mode 2 — one line up close, with worked examples.
import { h, tetragram, lineNames } from '../ui.js';
import { bundleRemainder, lineFromTotal, splitSticks, drawTetragram, passageNumber } from '../draw.js';
import { getIndex } from '../data.js';
import { openSheet } from '../sheet.js';

const EXAMPLES = [
  { label: '20 · 25 · 19', bundles: [20, 25, 19], note: 'An ordinary cast.' },
  { label: '21 · 22 · 21', bundles: [21, 22, 21], note: 'Two bundles come out even.' },
  { label: '17 · 30 · 17', bundles: [17, 30, 17], note: 'The most sticks set aside.' },
  { label: '31 · 2 · 31', bundles: [31, 2, 31], note: 'A tiny middle bundle.' },
];
const LINE_NAME = ['a solid line', 'a line broken once', 'a line broken twice'];
const PLACE = ['first (bottom)', 'second', 'third', 'fourth (top)'];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));

/** One line on its own (not a whole tetragram). */
export function lineGlyph(v, width = 72) {
  const svg = tetragram([v], { size: width, ghostFrom: 1 });
  svg.querySelectorAll('g').forEach((g) => { if (g.getAttribute('data-line') !== '0') g.remove(); });
  const r = svg.querySelector('rect');
  const y = Number(r?.getAttribute('y') || 0);
  const lh = Number(r?.getAttribute('height') || 6);
  svg.setAttribute('viewBox', `0 ${y} ${width} ${lh}`);
  svg.setAttribute('height', lh);
  svg.classList.add('line-glyph');
  return svg;
}

/** Rows of sticks grouped by threes; count() animates one bundle. */
function stickRow(name, n, { whole = false } = {}) {
  const sticks = Array.from({ length: n }, () => h('span', { class: 'st' }));
  const groups = [];
  const box = h('div', { class: whole ? 'sticks-row whole' : 'sticks-row' });
  if (whole) box.append(...sticks);
  else for (let k = 0; k < n; k += 3) { const g = h('span', { class: 'grp' }, ...sticks.slice(k, k + 3)); groups.push(g); box.append(g); }
  const tally = h('span', { class: 'row-tally' });
  const el = h('div', { class: 'how-row' }, h('div', { class: 'row-head' }, h('span', { class: 'row-label', text: whole ? name : `${name}: ${n}` }), tally), box);
  return {
    el,
    /** Returns the caption text for this bundle. */
    async count(alive) {
      const rem = n % 3;
      const toCount = groups.length - 1;
      for (let gi = 0; gi < toCount; gi++) {
        if (!alive()) return '';
        groups[gi].classList.add('counted');
        tally.textContent = `counted ${(gi + 1) * 3}`;
        await wait(Math.max(50, 650 / Math.max(1, toCount)));
      }
      const last = groups[groups.length - 1];
      if (rem === 0) {
        const [s1, s2, s3] = last.children;
        s1.classList.add('dim'); s2.classList.add('dim'); s3.classList.add('kept');
        tally.textContent = 'even → 1 set aside';
        return `${name}: ${n} is exactly ${n / 3} threes, nothing left. The rule: take one stick out and set it aside. This bundle gives 1.`;
      }
      last.classList.add('kept-grp');
      tally.textContent = `${rem} left → ${rem} set aside`;
      if (n < 3) return `${name}: only ${n} ${n > 1 ? 'sticks' : 'stick'} — fewer than three, so there is nothing to count off. Set ${n > 1 ? 'both' : 'it'} aside. This bundle gives ${rem}.`;
      return `${name}: ${Math.floor(n / 3)} threes make ${n - rem}; ${rem} ${rem > 1 ? 'sticks are' : 'stick is'} left. Set ${rem > 1 ? 'them' : 'it'} aside. This bundle gives ${rem}.`;
    },
  };
}

/** Build the step list for one cast. hooks.onLine(v, total, rem) runs on the last step. */
function castSteps(bundles, ui, { intro, onLine }) {
  const rows = [];
  const steps = [];
  steps.push(() => {
    ui.stage.replaceChildren(stickRow('All 64 sticks (two rows of 32)', 64, { whole: true }).el);
    ui.caption.textContent = intro;
  });
  steps.push(() => {
    rows.length = 0;
    ['Right bundle', 'Middle bundle', 'Left bundle'].forEach((name, i) => rows.push(stickRow(name, bundles[i])));
    ui.stage.replaceChildren(...rows.map((r) => r.el));
    ui.caption.textContent = `Divide them at random into three bundles: ${bundles.join(', ')} (together 64). Count the right one first.`;
  });
  [0, 1, 2].forEach((i) => steps.push(async () => { const alive = ui.alive; const text = await rows[i].count(alive); if (alive() && text) ui.caption.textContent = text; }));
  steps.push(() => {
    const rem = bundles.map(bundleRemainder);
    const total = rem.reduce((s, x) => s + x, 0);
    const v = lineFromTotal(total);
    ui.caption.textContent = `Add what was set aside: ${rem.join(' + ')} = ${total}. ${total} gives ${LINE_NAME[v]}.`;
    onLine(v, total, rem);
  });
  return steps;
}

function whyThreeToFive() {
  openSheet({
    kind: 'Why?', title: 'Why the total is always 3, 4, or 5',
    build: () => h('div', {},
      h('p', {}, h('b', { text: 'Never less than 3. ' }), 'Every bundle gives at least 1 stick. If a bundle leaves 1 or 2, you set those aside. If it comes out even (nothing left), the rule says to take one stick out anyway. So three bundles always give at least 1 + 1 + 1 = 3. That is why 0, 1, or 2 can never happen.'),
      h('p', {}, h('b', { text: 'Never more than 5. ' }), 'Every bundle gives at most 2, so the most you could imagine is 2 + 2 + 2 = 6. But for all three bundles to leave 2, each bundle must be a multiple of 3 plus 2. Add three of those and you get a multiple of 3 plus 6 — which is a multiple of 3. 64 is not: it is 63 + 1. So 6 can never happen.'),
      h('p', {}, h('b', { text: 'Why 64 matters. ' }), 'The three remainders (before the take-one rule) must add up to what 64 leaves when divided by 3 — that is 1, or 1 + 3 = 4. With 63 sticks they would have to add up to 0, 3, or 6, and all three bundles could come out even at once. The 64th stick is what tilts every cast into 3, 4, or 5.'),
      h('div', { class: 'how-key' },
        h('div', {}, lineGlyph(0, 64), h('span', { text: '3 → solid' })),
        h('div', {}, lineGlyph(1, 64), h('span', { text: '4 → broken once' })),
        h('div', {}, lineGlyph(2, 64), h('span', { text: '5 → broken twice' })))),
  });
}

/** Two stacked lines: [lower, upper], bottom→top. */
function bigramGlyph(pair, width = 40) {
  const svg = tetragram([pair[0], pair[1], 0, 0], { size: width });
  svg.querySelectorAll('g').forEach((g) => { if (Number(g.getAttribute('data-line')) > 1) g.remove(); });
  const rects = [...svg.querySelectorAll('rect')];
  const ys = rects.map((r) => Number(r.getAttribute('y')));
  const lh = Number(rects[0].getAttribute('height'));
  const top = Math.min(...ys);
  const bottom = Math.max(...ys) + lh;
  svg.setAttribute('viewBox', `0 ${top} ${width} ${bottom - top}`);
  svg.setAttribute('height', bottom - top);
  svg.classList.add('bigram');
  return svg;
}

/** All 81 figures: column = top two lines, row = bottom two lines. n = 1 + 9·(column) + (row). */
function figureTable() {
  const pairs = [];
  for (let hi = 0; hi < 3; hi++) for (let lo = 0; lo < 3; lo++) pairs.push([lo, hi]); // index = 3·hi + lo
  const head = h('tr', {}, h('th', { class: 'corner', scope: 'col' }, h('span', { text: 'top two →' }), h('br'), h('span', { text: 'bottom two ↓' })),
    ...pairs.map((p) => h('th', { scope: 'col', title: `top two lines: ${lineNames(p).replace(', ', ' below ')}` }, bigramGlyph(p))));
  const rows = pairs.map((low, l) => h('tr', {},
    h('th', { scope: 'row' }, bigramGlyph(low)),
    ...pairs.map((up, u) => {
      const n = 1 + 9 * u + l;
      const lines = [low[0], low[1], up[0], up[1]];
      return h('td', {}, h('a', { href: `#/p/${n}`, class: 'fig-cell', 'aria-label': `Passage ${n}: ${lineNames(lines)}` },
        tetragram(lines, { size: 40 }), h('span', { text: String(n) })));
    })));
  return h('div', { class: 'fig-wrap' }, h('table', { class: 'fig-table' }, h('thead', {}, head), h('tbody', {}, ...rows)));
}

export function howSection({ standalone = false } = {}) {
  const root = h('section', { class: 'how' });
  const stage = h('div', { class: 'how-stage', 'aria-live': 'polite' });
  const caption = h('p', { class: 'how-caption' });
  const result = h('div', { class: 'how-result' });
  const builder = h('div', { class: 'how-builder' });
  let mode = 'full';
  let selected = null;
  let token = 0;
  let steps = [];
  let i = 0;
  let playing = false;

  const ui = { stage, caption, alive: null };
  const modeChips = h('div', { class: 'filters', role: 'group', 'aria-label': 'Mode' });
  const exChips = h('div', { class: 'filters', role: 'group', 'aria-label': 'Examples' });
  const playBtn = h('button', { class: 'btn primary', type: 'button', text: 'Play', onclick: play });
  const nextBtn = h('button', { class: 'btn quiet', type: 'button', text: 'Next step', onclick: next });
  const newBtn = h('button', { class: 'btn quiet', type: 'button', text: 'Restart', onclick: () => (mode === 'line' && selected ? load(selected, { jump: true }) : load()) });

  function setMode(m) { mode = m; selected = null; renderChips(); load(); }
  function renderChips() {
    modeChips.replaceChildren(
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(mode === 'full'), text: 'A full draw, step by step', onclick: () => setMode('full') }),
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(mode === 'line'), text: 'One line up close', onclick: () => setMode('line') }));
    exChips.hidden = mode !== 'line';
    exChips.replaceChildren(...EXAMPLES.map((ex) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(selected === ex), text: ex.label,
      onclick: () => { selected = ex; renderChips(); load(ex, { jump: true }); },
    })));
  }

  function load(example, { jump = false } = {}) {
    const my = ++token;
    ui.alive = () => my === token;
    playing = false;
    i = 0;
    result.replaceChildren();
    builder.replaceChildren();
    if (mode === 'line') {
      const bundles = example?.bundles || splitSticks();
      steps = castSteps(bundles, ui, {
        intro: `${example?.note || 'A random split.'} Start with all 64 sticks.`,
        onLine: (v, total) => result.replaceChildren(
          h('div', { class: 'how-sum' }, h('b', { text: String(total) }), ` sticks → ${LINE_NAME[v]}`),
          lineGlyph(v, 120),
          h('p', { class: 'muted small', text: 'That is one line. A full draw does this four times.' })),
      });
    } else {
      const draw = drawTetragram();
      const lines = [];
      const tetraBox = h('div', { class: 'how-tetra' }, tetragram([0, 0, 0, 0], { size: 84, ghostFrom: 0 }));
      const log = h('ol', { class: 'how-log' });
      builder.append(h('div', { class: 'how-builder-in' }, tetraBox, h('div', {}, h('p', { class: 'small muted', text: 'The figure grows from the bottom.' }), log)));
      steps = [];
      draw.casts.forEach((cast, c) => {
        steps.push(...castSteps(cast.bundles, ui, {
          intro: `Cast ${c + 1} of 4 — the ${PLACE[c]} line. Gather all 64 sticks again.`,
          onLine: (v, total, rem) => {
            lines.push(v);
            tetraBox.replaceChildren(tetragram([...lines, 0, 0, 0].slice(0, 4), { size: 84, ghostFrom: lines.length }));
            log.append(h('li', {}, `${PLACE[c]}: ${rem.join('+')} = ${total} → `, h('b', { text: LINE_NAME[v].replace(/^a /, '') })));
          },
        }).slice(c === 0 ? 0 : 0));
      });
      steps.push(async () => {
        const n = passageNumber(lines);
        const idx = await getIndex();
        const title = idx.passages?.[n]?.title;
        caption.textContent = `Four lines, read from the bottom: ${lineNames(lines)}. That figure is number ${n}.`;
        stage.replaceChildren();
        result.replaceChildren(
          h('div', { class: 'how-sum' }, 'Passage ', h('b', { text: String(n) }), title ? ` — ${title}` : ''),
          h('p', {}, h('a', { class: 'btn red', href: `#/p/${n}`, text: `Read passage ${n}` })),
          h('p', { class: 'muted small' }, 'This was a real random draw, made the same way as ', h('a', { class: 'ref', href: '#/', text: 'the Draw page' }), '. Restart for another.'));
      });
    }
    run(0).then(() => { if (jump) play(); });
  }

  let busy = false;
  async function run(k) {
    const my = token;
    i = k;
    busy = true;
    nextBtn.disabled = true;
    await steps[i]();
    if (my !== token) return; // a newer load took over
    busy = false;
    nextBtn.disabled = playBtn.disabled = i >= steps.length - 1;
  }
  async function next() { if (!busy && i < steps.length - 1) await run(i + 1); }
  async function play() {
    const my = token;
    if (playing === my) return;
    playing = my;
    while (i < steps.length - 1 && my === token) {
      await next();
      await wait(1100);
    }
    if (playing === my) playing = false;
  }

  renderChips();
  root.append(
    standalone ? h('h1', { text: 'How the draw works' }) : h('h3', { text: 'How the draw works' }),
    h('p', { text: 'The draw uses 64 sticks to make one line at a time. Four lines make a figure, and the figure names one of the 81 passages.' }),
    h('ol', { class: 'how-steps' },
      h('li', {}, h('b', { text: 'Split. ' }), 'Divide the 64 sticks at random into three bundles.'),
      h('li', {}, h('b', { text: 'Count by threes. ' }), 'Take one bundle and remove sticks three at a time until fewer than three are left.'),
      h('li', {}, h('b', { text: 'Set aside the rest. ' }), 'One or two sticks are left: set them aside. If none are left, take one stick out and set that aside instead. So every bundle gives 1 or 2.'),
      h('li', {}, h('b', { text: 'Repeat ' }), 'for the other two bundles, then add up what you set aside. ',
        h('button', { type: 'button', class: 'mark', 'aria-haspopup': 'dialog', onclick: whyThreeToFive }, 'The total is always 3, 4, or 5.'),
        h('sup', { class: 'fn-q', 'aria-hidden': 'true', text: ' why?' })),
      h('li', {}, h('b', { text: 'Make a line, ' }), 'then do it all again — four times. Stack the lines from the bottom up.')),
    h('div', { class: 'how-key' },
      h('div', {}, lineGlyph(0, 64), h('span', { text: '3 → solid' })),
      h('div', {}, lineGlyph(1, 64), h('span', { text: '4 → broken once' })),
      h('div', {}, lineGlyph(2, 64), h('span', { text: '5 → broken twice' }))),
    modeChips, exChips,
    h('div', { class: 'frame how-box' }, builder, stage, caption, result,
      h('div', { class: 'row how-controls' }, playBtn, nextBtn, newBtn)),
    h('h3', { text: 'The 81 figures' }),
    h('p', { text: 'Three kinds of line in four places make 3 × 3 × 3 × 3 = 81 figures — every possible combination, one per passage. To find a figure, take its top two lines to choose the column and its bottom two lines to choose the row. The order follows the Taixuan jing (太玄經), Yang Xiong’s book of 81 figures from about 2 BCE: the bottom line changes fastest, so numbers count down each column. Tap any figure to open its passage.' }),
    figureTable(),
    h('p', { text: 'Chance, fairly: the app splits the sticks with your device’s cryptographic random generator. The method itself is not perfectly even, and the app keeps that: a solid line comes 10 times in 31, a once-broken line 11 times in 31, a twice-broken line 10 times in 31 — as with real sticks.' }),
  );
  load();
  return root;
}

export function howView() {
  return howSection({ standalone: true });
}
