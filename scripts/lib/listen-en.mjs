// Pure helpers for the English Listen audio: Chirp 3 HD markup, custom pronunciations, source hash, romanized-word check.
import { createHash } from 'node:crypto';
import { plainLine, wordsOf } from '../../app/js/markup.js';

export const SETTINGS_EN = Object.freeze({
  voice: 'en-US-Chirp3-HD-Callirrhoe', lang: 'en-US', rate: 1.0, encoding: 'LINEAR16', mp3: 'mono-48k',
  input: 'markup', aligner: 'chirp_2', alignBias: 0.066,
});

// The pacing knobs: what joins lines, what follows a line, and what follows a stanza.
export const LINE_JOIN = ' ';
export const LINE_PAUSE = '[pause short]';
export const STANZA_PAUSE = '[pause]';

const isEmpty = (line) => line.trim() === '';

/** The markup and the words (as written, in order) of the rendering lines. */
function markupAndWords(rendering) {
  const out = [];
  const words = [];
  rendering.forEach((line, i) => {
    if (isEmpty(line)) return;
    const plain = plainLine(line).trim();
    for (const w of wordsOf(plain)) words.push(w.word);
    const next = rendering[i + 1];
    out.push(`${plain} ${next !== undefined && isEmpty(next) ? STANZA_PAUSE : LINE_PAUSE}`);
  });
  return { markup: out.join(LINE_JOIN), words };
}

/** Rendering lines ("" = stanza gap) to Chirp markup and the wordsOf count. */
export function buildEnMarkup(rendering) {
  const { markup, words } = markupAndWords(rendering);
  return { markup, count: words.length };
}

/** Custom pronunciations from the IPA table for these words, each spelling as written, first-seen order. */
function pronunciationsOf(words, ipa) {
  const seen = new Map();
  for (const word of words) {
    const ph = ipa[word.toLowerCase()];
    if (ph && !seen.has(word)) seen.set(word, { phrase: word, phoneticEncoding: 'PHONETIC_ENCODING_IPA', pronunciation: ph });
  }
  return [...seen.values()];
}

/** Custom pronunciations for the words that occur in the passage. */
export const enPronunciations = (rendering, ipa) => pronunciationsOf(markupAndWords(rendering).words, ipa);

/** Everything one English request needs: { markup, count, words, pronunciations }. The hash uses markup and pronunciations. */
export function enSource(rendering, ipa) {
  const { markup, words } = markupAndWords(rendering);
  return { markup, count: words.length, words, pronunciations: pronunciationsOf(words, ipa) };
}

/** SHA-256 over the markup, the pronunciations used, and SETTINGS_EN. */
export function enSourceHash({ markup, pronunciations }) {
  return createHash('sha256').update(markup).update(JSON.stringify(pronunciations)).update(JSON.stringify(SETTINGS_EN)).digest('hex');
}

// The pinyin rule. A word looks like pinyin when it splits into syllables, each an initial
// plus a final from that initial's group (toneless, ü written u). Two limits follow pinyin
// spelling and keep out most English: a syllable with no initial (a, o, e, ...) only starts
// a word (pinyin writes an apostrophe elsewhere), and a word of two or more syllables does not
// end in a consonant + bare e (gate, made, sage are English silent e). ENGLISH lists the
// English words that still pass.
const GROUPS = [
  ['b p m f', 'a o ai ei ao ou an en ang eng u i ie iao iu ian in ing'],
  ['d t n l', 'a e ai ei ao ou an en ang eng ong u uo ui uan un i ia ie iao iu ian in ing iang ue'],
  ['g k h', 'a e ai ei ao ou an en ang eng ong u ua uo uai ui uan uang un'],
  ['zh ch sh r z c s', 'a e ai ei ao ou an en ang eng ong u ua uo uai ui uan uang un i'],
  ['j q x', 'i ia ie iao iu ian in ing iang iong u ue uan un'],
  ['y', 'a e ao ou an ang o i in ing u ue uan un ong'],
  ['w', 'a o ai ei an en ang eng u'],
];
const words = (s) => s.split(' ');
const SYLLABLES = new Set(GROUPS.flatMap(([ini, fin]) => words(ini).flatMap((i) => words(fin).map((f) => i + f))));
const NO_INITIAL = new Set(words('a o e ai ei ao ou an en ang eng er'));
const ENGLISH = new Set(words('a an can ten long die open taken hen omen run sun along anyone '
  + 'wanting ruling hunting binding lending running saying'));

/** True when the word (lower case) follows the pinyin rule above. */
function isPinyin(w) {
  if (!/^[a-z]+$/.test(w)) return false;
  const ok = [true];
  for (let e = 1; e <= w.length; e++) {
    ok[e] = false;
    for (let s = Math.max(0, e - 6); s < e && !ok[e]; s++) {
      const y = w.slice(s, e);
      const fits = SYLLABLES.has(y) || (s === 0 && NO_INITIAL.has(y));
      const silentE = s > 0 && e === w.length && /^[^aeiou]+e$/.test(y);
      ok[e] = ok[s] && fits && !silentE;
    }
  }
  return ok[w.length];
}

/** Words (lower case, first-seen order) in the renderings that look like pinyin and have no IPA entry. */
export function romanizedCandidates(renderings, ipa) {
  const out = new Set();
  for (const r of renderings) {
    for (const line of r) {
      for (const { word } of wordsOf(plainLine(line))) {
        const w = word.toLowerCase();
        if (!ipa[w] && !ENGLISH.has(w) && isPinyin(w)) out.add(w);
      }
    }
  }
  return [...out];
}
