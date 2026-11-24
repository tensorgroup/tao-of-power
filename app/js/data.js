// Data loading with in-memory caches. Passage files are optional; text.json is not.
import { pad2 } from './ui.js';

const cache = new Map();

async function json(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(path).then((r) => {
    if (!r.ok) throw Object.assign(new Error(`${path}: ${r.status}`), { status: r.status });
    return r.json();
  });
  cache.set(path, p);
  p.catch(() => cache.delete(path));
  return p;
}

export const getText = () => json('data/text.json');
export const getLexicon = () => json('data/lexicon.json');
export const getArt = () => json('data/art.json').catch(() => ({ catalog: {}, passages: {}, stories: {} }));
export const getEchoes = () => json('data/echoes.json').catch(() => ({ passages: {} }));
export const getGlossary = () => json('data/glossary.json').catch(() => ({}));
export const getWing = () => json('data/wing.json').catch(() => ({ passages: {} }));
export const getCulture = () => json('data/culture.json').catch(() => ({ passages: {} }));
export const getIndex = () => json('data/index.json').catch(() => ({ passages: {} }));

/** {text, rich|null}. rich is null when the passage file is not written yet. */
export async function getPassage(n) {
  const [all, rich] = await Promise.all([
    getText(),
    json(`data/passages/${pad2(n)}.json`).catch((e) => (e.status === 404 ? null : Promise.reject(e))),
  ]);
  return { text: all[n - 1], rich };
}

export function charLinks(c) {
  const e = encodeURIComponent(c);
  return [
    { label: 'Wiktionary', href: `https://en.wiktionary.org/wiki/${e}` },
    { label: 'ctext dictionary', href: `https://ctext.org/dictionary.pl?if=en&char=${e}` },
    { label: 'Ancient forms (CUHK)', href: `https://humanum.arts.cuhk.edu.hk/Lexis/lexi-mf/search.php?word=${e}` },
    { label: 'Shuowen (zi.tools)', href: `https://zi.tools/zi/${e}` },
  ];
}
