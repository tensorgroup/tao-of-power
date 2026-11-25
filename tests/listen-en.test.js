import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plainLine, wordsOf } from '../app/js/markup.js';
import { SETTINGS_EN, LINE_PAUSE, STANZA_PAUSE, buildEnMarkup, enPronunciations, enSource, enSourceHash, romanizedCandidates } from '../scripts/lib/listen-en.mjs';

const IPA = JSON.parse(readFileSync(new URL('../scripts/audio-en-lexicon.json', import.meta.url), 'utf8'));
const pad = (n) => String(n).padStart(2, '0');
const rendering = (n) => JSON.parse(readFileSync(new URL(`../app/data/passages/${pad(n)}.json`, import.meta.url), 'utf8')).rendering;

test('wordsOf gives words with UTF-16 offsets', () => {
  assert.deepEqual(wordsOf('the sage’s way'), [
    { word: 'the', start: 0, end: 3 },
    { word: 'sage’s', start: 4, end: 10 },
    { word: 'way', start: 11, end: 14 },
  ]);
});
test('plainLine removes markup and keeps the note text', () => {
  assert.equal(plainLine('[[the sage|sage]]’s way'), 'the sage’s way');
});
test('SETTINGS_EN is frozen and names the English voice', () => {
  assert.ok(Object.isFrozen(SETTINGS_EN));
  assert.deepEqual(SETTINGS_EN, { voice: 'en-US-Chirp3-HD-Callirrhoe', lang: 'en-US', rate: 1.0, encoding: 'LINEAR16', mp3: 'mono-48k', input: 'markup', aligner: 'chirp_2', alignBias: 0.066 });
});
test('buildEnMarkup on passage 1: one [pause] per stanza gap, [pause short] after other lines, 80 words', () => {
  const r = rendering(1);
  const { markup, count } = buildEnMarkup(r);
  assert.equal(count, 80);
  const gaps = r.filter((l, i) => l.trim() === '' && i > 0 && r[i - 1].trim() !== '').length;
  assert.equal(gaps, 3);
  assert.equal(markup.split(STANZA_PAUSE).length - 1, gaps);
  assert.equal(markup.split(LINE_PAUSE).length - 1, r.filter((l) => l.trim() !== '').length - gaps);
  assert.ok(markup.startsWith('A way that can be told as a way [pause short] is not the constant Dao. [pause short] A name that can be given as a name [pause short] is not the constant name. [pause] Nameless: the beginning'), markup);
  assert.ok(markup.endsWith('the gate of all fineness. [pause short]'), markup);
  assert.ok(!markup.includes('  '), 'no double spaces');
  assert.ok(!markup.includes('[pause] [pause]'), 'no doubled pause');
});
test('buildEnMarkup: two empty lines still give one [pause]', () => {
  assert.deepEqual(buildEnMarkup(['a way', '', '', 'is not']), { markup: 'a way [pause] is not [pause short]', count: 4 });
});
test('buildEnMarkup: markup is removed and other characters pass through', () => {
  assert.deepEqual(buildEnMarkup(['“So” — [[the sage|sage]]’s way;']), { markup: '“So” — the sage’s way; [pause short]', count: 4 });
});
test('enPronunciations: only words in the passage, one entry per word whatever its case (first spelling)', () => {
  assert.deepEqual(enPronunciations(['the Dao and the qi', 'dao'], IPA), [
    { phrase: 'Dao', phoneticEncoding: 'PHONETIC_ENCODING_IPA', pronunciation: 'daʊ' },
    { phrase: 'qi', phoneticEncoding: 'PHONETIC_ENCODING_IPA', pronunciation: 'tʃiː' },
  ]);
  assert.deepEqual(enPronunciations(['de and De'], IPA).map((p) => p.phrase), ['de']);
  assert.deepEqual(enPronunciations(['a way'], IPA), []);
});
test('the lexicon has the required readings', () => {
  for (const [w, ph] of Object.entries({ dao: 'daʊ', de: 'dʌ', qi: 'tʃiː', yin: 'jɪn', yang: 'jɑːŋ', wu: 'wuː', laozi: 'ˈlaʊdzə' })) {
    assert.equal(IPA[w], ph, w);
  }
});
test('the hash changes with one word and with a pronunciation', () => {
  const h = (lines, ipa) => enSourceHash(enSource(lines, ipa));
  assert.equal(h(['a way'], {}), h(['a way'], {}));
  assert.notEqual(h(['a way'], {}), h(['a wax'], {}));
  assert.notEqual(h(['the Dao'], { dao: 'daʊ' }), h(['the Dao'], { dao: 'daː' }));
  assert.notEqual(h(['the Dao'], { dao: 'daʊ' }), h(['the Dao'], {}));
  assert.equal(h(['a way'], { dao: 'daʊ' }), h(['a way'], {}), 'a pronunciation for a word not in the passage does not count');
});
test('romanizedCandidates finds pinyin-like words that are not in the table', () => {
  assert.deepEqual(romanizedCandidates([['The Dao and de', 'Zhuangzi said']], { dao: 'daʊ' }), ['de', 'zhuangzi']);
});
test('romanizedCandidates over all 81 renderings is empty', () => {
  const all = Array.from({ length: 81 }, (_, i) => rendering(i + 1));
  assert.deepEqual(romanizedCandidates(all, IPA), []);
});
