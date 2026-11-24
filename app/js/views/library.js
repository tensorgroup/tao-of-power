// Index pages: every painting and object (#/art) and every story (#/stories).
import { h, fill } from '../ui.js';
import { getArt, getCulture, getIndex } from '../data.js';
import { openArt, openStory, CULTURE_KIND, cultureLinks } from './passage.js';

/** artId -> [[passage, entry], ...] in passage order. */
function uses(art) {
  const u = {};
  for (const [n, list] of Object.entries(art.passages || {})) for (const e of list) (u[e.id] ||= []).push([Number(n), e]);
  for (const v of Object.values(u)) v.sort((a, b) => a[0] - b[0]);
  return u;
}

export function libraryLinks(current) {
  const link = (href, text, key) => (key === current ? h('span', { class: 'chip', 'aria-current': 'page', text })
    : h('a', { class: 'chip', href, text }));
  return h('nav', { class: 'lib-links', 'aria-label': 'Library' },
    link('#/browse', 'Passages', 'browse'), link('#/art', 'Art', 'art'), link('#/stories', 'Stories', 'stories'), link('#/culture', 'In our time', 'culture'), link('#/search', 'Search', 'search'));
}

export async function galleryView() {
  const art = await getArt();
  const u = uses(art);
  const items = Object.entries(art.catalog).map(([id, a]) => ({ id, a, used: u[id] || [] }))
    .filter((x) => x.used.length)
    .sort((x, y) => x.used[0][0] - y.used[0][0] || x.a.title.localeCompare(y.a.title));
  const grid = h('ul', { class: 'gallery' }, items.map(({ id, a, used }) => {
    const [n, entry] = used[0];
    const passages = used.map(([p]) => p);
    return h('li', {},
      h('button', { class: 'g-tile', type: 'button', 'aria-label': `${a.title}, passage ${passages.join(', ')}`, onclick: () => openArt(a, entry, {}, { passages }) },
        h('img', { src: a.file.replace(/^art\//, 'art/thumbs/'), alt: a.alt || a.title, loading: 'lazy', decoding: 'async' }),
        h('span', { class: 'g-title', text: a.title }),
        h('span', { class: 'g-meta', text: `${passages.map((p) => `№ ${p}`).join(' · ')}${a.artist ? ` · ${a.artist}` : ''}` })));
  }));
  return h('section', { class: 'library' },
    libraryLinks('art'),
    h('h1', { text: 'Art' }),
    h('p', { class: 'muted', text: `${items.length} paintings, prints, rubbings, and objects, in passage order. Tap one to look closer.` }),
    grid);
}

/** "Zhuangzi, chapter 19 (…)" -> "Zhuangzi". */
const work = (src) => (String(src).split(/[,;(]|\s(?:ch\.?|chapter|book)\s?\d|\s\d/i)[0] || 'Other').trim();

export async function storiesView() {
  const art = await getArt();
  const all = Object.entries(art.stories || {}).map(([id, st]) => ({ id, st, w: work(st.source) }));
  let by = 'work';
  const list = h('div');
  const toggle = h('div', { class: 'filters', role: 'group', 'aria-label': 'Order' });
  const item = ({ st }) => h('li', {},
    h('button', { class: 'story-btn', type: 'button', onclick: () => openStory(st, {}, { links: true }) },
      h('span', { class: 'kind', text: st.source }), h('span', { text: st.title }),
      st.passages?.length ? h('span', { class: 'g-meta', text: [...st.passages].sort((a, b) => a - b).map((p) => `№ ${p}`).join(' · ') }) : null));
  const render = () => {
    fill(toggle, ...[['work', 'By source'], ['passage', 'By passage']].map(([k, label]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(by === k), text: label, onclick: () => { by = k; render(); },
    })));
    const groups = new Map();
    if (by === 'work') {
      for (const x of [...all].sort((a, b) => a.st.title.localeCompare(b.st.title))) (groups.get(x.w) || groups.set(x.w, []).get(x.w)).push(x);
      fill(list, ...[...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([w, xs]) => h('section', {}, h('h2', { text: `${w} (${xs.length})` }), h('ul', { class: 'story-list' }, xs.map(item)))));
    } else {
      for (const x of all) for (const p of x.st.passages || []) (groups.get(p) || groups.set(p, []).get(p)).push(x);
      fill(list, ...[...groups].sort((a, b) => a[0] - b[0])
        .map(([p, xs]) => h('section', {}, h('h2', {}, h('a', { href: `#/p/${p}`, text: `Passage ${p}` })), h('ul', { class: 'story-list' }, xs.map(item)))));
    }
  };
  render();
  return h('section', { class: 'library' },
    libraryLinks('stories'),
    h('h1', { text: 'Stories' }),
    h('p', { class: 'muted', text: `${all.length} stories from the old books, retold from the originals. Each one sheds light on one or more passages.` }),
    toggle, list);
}

const KIND_GROUPS = [
  ['all', 'All', null], ['film', 'Films', ['film']], ['tv', 'TV', ['tv', 'episode']], ['song', 'Music', ['song', 'music', 'album']],
  ['book', 'Books', ['novel', 'book', 'short-story', 'poem']], ['anime', 'Anime & comics', ['anime', 'manga', 'comic']],
  ['game', 'Games & ads', ['game', 'ad']],
];

export async function cultureView() {
  const [culture, idx] = await Promise.all([getCulture(), getIndex()]);
  const entries = Object.entries(culture.passages || {}).map(([n, l]) => [Number(n), l]).sort((a, b) => a[0] - b[0]);
  const total = entries.reduce((s, [, l]) => s + l.length, 0);
  let group = 'all';
  const chips = h('div', { class: 'filters', role: 'group', 'aria-label': 'Kind' });
  const list = h('div');
  const render = () => {
    const kinds = KIND_GROUPS.find(([k]) => k === group)[2];
    fill(chips, ...KIND_GROUPS.map(([k, label]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(group === k), text: label, onclick: () => { group = k; render(); },
    })));
    fill(list, ...entries.map(([n, l]) => {
      const shown = l.filter((c) => !kinds || kinds.includes(c.kind));
      if (!shown.length) return null;
      return h('section', {},
        h('h2', {}, h('a', { href: `#/p/${n}`, text: `${n} · ${idx.passages?.[n]?.title || `Passage ${n}`}` })),
        h('ul', { class: 'culture-list' }, shown.map((c) => h('li', {},
          h('p', { class: 'c-head' },
            h('span', { class: 'kind', text: `${CULTURE_KIND[c.kind] || c.kind}${c.contrast ? ' · by contrast' : ''}` }),
            h('a', { href: c.link, target: '_blank', rel: 'noopener noreferrer', class: 'c-title', text: c.title }),
            h('span', { class: 'muted small', text: [c.creator, c.year].filter(Boolean).join(', ') })),
          h('p', { class: 'c-why', text: c.why }),
          cultureLinks(c)))));
    }));
  };
  render();
  return h('section', { class: 'library' },
    libraryLinks('culture'),
    h('h1', { text: 'In our time' }),
    h('p', { class: 'muted', text: `${total} songs, films, shows, books, poems, games, and ads that explore a passage, or show its opposite. “Watch” and “Listen” open a YouTube search for the work; titles link to Wikipedia.` }),
    chips, list);
}
