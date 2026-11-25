import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plainLine, wordsOf } from '../app/js/markup.js';
import { SETTINGS_EN, buildEnSsml, enSourceHash, romanizedCandidates } from '../scripts/lib/listen-en.mjs';

const IPA = JSON.parse(readFileSync(new URL('../scripts/audio-en-lexicon.json', import.meta.url), 'utf8'));
const pad = (n) => String(n).padStart(2, '0');
const rendering = (n) => JSON.parse(readFileSync(new URL(`../app/data/passages/${pad(n)}.json`, import.meta.url), 'utf8')).rendering;
const BREAK = '<break time="700ms"/>';
const breaks = (parts) => parts.map((p) => p.ssml.split(BREAK).length - 1).reduce((a, b) => a + b, 0);

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
  assert.deepEqual(SETTINGS_EN, { voice: 'en-US-Neural2-D', lang: 'en-US', rate: 0.9, encoding: 'LINEAR16', mp3: 'mono-48k' });
});
test('two lines are joined with one space and marks count across lines', () => {
  const [p] = buildEnSsml(['a way', 'is not'], {});
  assert.equal(p.ssml, '<speak><mark name="0"/>a <mark name="1"/>way <mark name="2"/>is <mark name="3"/>not</speak>');
  assert.equal(p.first, 0);
  assert.equal(p.count, 4);
});
test('an empty line gives exactly one break', () => {
  const parts = buildEnSsml(['a way', '', 'is not'], {});
  assert.equal(parts[0].ssml, `<speak><mark name="0"/>a <mark name="1"/>way${BREAK} <mark name="2"/>is <mark name="3"/>not</speak>`);
});
test('an empty line on a part boundary still gives exactly one break', () => {
  const where = new Set(); // which part holds the break when there are two
  for (let n = 200; n <= 208; n++) {
    const line = Array.from({ length: n }, () => 'way').join(' ');
    const parts = buildEnSsml([line, '', 'is not'], {});
    assert.equal(breaks(parts), 1, `n=${n}`);
    for (const p of parts) assert.ok(Buffer.byteLength(p.ssml) <= 4500);
    if (parts.length === 2) where.add(parts[0].ssml.includes(BREAK) ? 'end of first' : 'start of second');
  }
  assert.deepEqual([...where].sort(), ['end of first', 'start of second']);
});
test('a romanized word is spoken with its IPA, case-insensitive', () => {
  const [p] = buildEnSsml(['the Dao'], IPA);
  assert.ok(p.ssml.includes('<mark name="1"/><phoneme alphabet="ipa" ph="daʊ">Dao</phoneme>'), p.ssml);
});
test('the lexicon has the required readings', () => {
  for (const [w, ph] of Object.entries({ dao: 'daʊ', de: 'dʌ', qi: 'tʃiː', yin: 'jɪn', yang: 'jɑːŋ', wu: 'wuː', laozi: 'ˈlaʊdzə' })) {
    assert.equal(IPA[w], ph, w);
  }
});
test('curly quotes and dashes pass through; & < > are escaped', () => {
  const [p] = buildEnSsml(['“So” — it is; A & B <c>'], {});
  assert.equal(p.ssml, '<speak>“<mark name="0"/>So” — <mark name="1"/>it <mark name="2"/>is; <mark name="3"/>A &amp; <mark name="4"/>B &lt;<mark name="5"/>c&gt;</speak>');
});
test('markup is removed before the SSML is built', () => {
  const [p] = buildEnSsml(['[[the sage|sage]]’s way'], {});
  assert.equal(p.ssml, '<speak><mark name="0"/>the <mark name="1"/>sage’s <mark name="2"/>way</speak>');
});
test('passage 39 splits into parts under 4500 bytes with contiguous marks', () => {
  const r = rendering(39);
  const parts = buildEnSsml(r, IPA);
  assert.ok(parts.length > 1);
  const total = r.reduce((s, l) => s + wordsOf(plainLine(l)).length, 0);
  let next = 0;
  for (const p of parts) {
    assert.ok(Buffer.byteLength(p.ssml) <= 4500);
    assert.equal(p.first, next);
    assert.equal((p.ssml.match(/<mark /g) ?? []).length, p.count);
    next += p.count;
  }
  assert.equal(next, total);
  assert.equal(breaks(parts), r.filter((l) => l.trim() === '').length);
});
test('a long text splits only at clause or line ends', () => {
  const line = Array.from({ length: 200 }, () => 'the way is long; ').join('').trim();
  const parts = buildEnSsml([line], {});
  assert.ok(parts.length > 1);
  for (const p of parts.slice(0, -1)) assert.match(p.ssml, /; <\/speak>$/);
});
test('the hash changes with one word', () => {
  assert.notEqual(enSourceHash(buildEnSsml(['a way'], {})), enSourceHash(buildEnSsml(['a wax'], {})));
  assert.equal(enSourceHash(buildEnSsml(['a way'], {})), enSourceHash(buildEnSsml(['a way'], {})));
});
test('romanizedCandidates finds pinyin-like words that are not in the table', () => {
  assert.deepEqual(romanizedCandidates([['The Dao and de', 'Zhuangzi said']], { dao: 'daʊ' }), ['de', 'zhuangzi']);
});
test('romanizedCandidates over all 81 renderings is empty', () => {
  const all = Array.from({ length: 81 }, (_, i) => rendering(i + 1));
  assert.deepEqual(romanizedCandidates(all, IPA), []);
});
