// Pure helpers for the English Listen audio: SSML parts, source hash, romanized-word check.
import { plainLine, wordsOf } from '../../app/js/markup.js';
import { escapeXml, packClauses, hashParts } from './listen-ssml.mjs';

export const SETTINGS_EN = Object.freeze({ voice: 'en-US-Neural2-D', lang: 'en-US', rate: 0.9, encoding: 'LINEAR16', mp3: 'mono-48k' });

const BREAK = '<break time="700ms"/>';
const CLAUSE_END = /[.;:!?]/;

/** The SSML for one word: its mark, then the word, or its IPA phoneme when the table has it. */
function wordSsml(word, i, ipa) {
  const ph = ipa[word.toLowerCase()];
  const body = ph ? `<phoneme alphabet="ipa" ph="${escapeXml(ph)}">${word}</phoneme>` : word;
  return `<mark name="${i}"/>${body}`;
}

/** Rendering lines ("" = stanza gap) to <speak> parts: one mark per wordsOf word, numbered across lines. */
export function buildEnSsml(rendering, ipa) {
  const clauses = []; // { text, count }
  let cur = { text: '', count: 0 };
  let i = 0;
  let started = false;
  const close = () => { if (cur.text) clauses.push(cur); cur = { text: '', count: 0 }; };
  for (const line of rendering) {
    const plain = plainLine(line);
    if (plain.trim() === '') { clauses.push({ text: BREAK, count: 0 }); continue; }
    if (started) cur.text += ' ';
    started = true;
    let last = 0;
    for (const w of wordsOf(plain)) {
      const gap = plain.slice(last, w.start);
      cur.text += escapeXml(gap);
      if (CLAUSE_END.test(gap)) close();
      cur.text += wordSsml(w.word, i, ipa);
      cur.count++;
      i++;
      last = w.end;
    }
    cur.text += escapeXml(plain.slice(last));
    close();
  }
  return packClauses(clauses);
}

export const enSourceHash = (parts) => hashParts(parts, SETTINGS_EN);

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
