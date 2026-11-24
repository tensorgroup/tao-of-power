// All 81 tetragrams, filterable by theme.
import { h, tetragram } from '../ui.js';
import { linesFor } from '../draw.js';
import { getIndex } from '../data.js';
import { libraryLinks } from './library.js';

const THEMES = [
  ['all', 'All'], ['way', 'The Way'], ['seeing', 'Seeing'], ['self', 'Self'], ['leading', 'Leading'],
  ['yielding', 'Yielding'], ['conflict', 'Conflict'], ['simplicity', 'Simplicity'],
];

export async function browseView() {
  const idx = await getIndex();
  let theme = 'all';
  const grid = h('div', { class: 'grid' });
  const chips = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter by theme' });
  const draw = () => {
    chips.replaceChildren(...THEMES.map(([k, label]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(theme === k), text: label,
      onclick: () => { theme = k; draw(); },
    })));
    grid.replaceChildren(...Array.from({ length: 81 }, (_, i) => {
      const n = i + 1;
      const info = idx.passages?.[n];
      const dim = theme !== 'all' && info?.theme !== theme;
      return h('a', {
        class: `cell${dim ? ' dim' : ''}${info ? ' ready' : ''}`, href: `#/p/${n}`,
        'aria-label': `Passage ${n}${info?.title ? `: ${info.title}` : ''}`,
      }, tetragram(linesFor(n), { size: 34 }), h('span', { class: 'n', text: `${n}` }));
    }));
  };
  draw();
  return h('section', {}, libraryLinks('browse'), h('h1', { text: 'The 81 passages' }),
    h('p', { class: 'muted', text: 'Each passage has its own tetragram of four lines, read from the bottom up. Choose one directly, or return to the draw.' }),
    chips, grid);
}
