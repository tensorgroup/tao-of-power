import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, resolveReading, needsDecision, buildSsml, sourceHash, validateReadings, validateGlobalReadings, forcedReadings } from '../scripts/lib/listen-ssml.mjs';
import { mkdtempSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('marks precede every character and phoneme wraps forced ones', () => {
  const parts = buildSsml(['斯惡已；'], (c) => (c.ch === '惡' ? 'e4' : null));
  assert.equal(parts[0].ssml, '<speak><mark name="0"/>斯<mark name="1"/><phoneme alphabet="pinyin" ph="e4">惡</phoneme><mark name="2"/>已；</speak>');
});
test('small punctuation is mapped and spaces are dropped', () => {
  assert.equal(buildSsml(['知﹗ 行﹑'], () => null)[0].ssml, '<speak><mark name="0"/>知！<mark name="1"/>行、</speak>');
});
test('an unknown character throws', () => {
  assert.throws(() => buildSsml(['道x'], () => null), /unexpected character: x/);
});
test('ampersand and angle brackets are escaped', () => {
  assert.equal(buildSsml(['道&<>'], () => null)[0].ssml, '<speak><mark name="0"/>道&amp;&lt;&gt;</speak>');
});
test('a long segment splits at clause ends under 4500 bytes, never inside a phoneme', () => {
  const seg = Array.from({ length: 50 }, () => '長長長長長長長長，').join('');
  const parts = buildSsml([seg], () => 'chang2');
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(Buffer.byteLength(p.ssml) <= 4500 && /，<\/speak>$/.test(p.ssml));
  assert.equal(parts[1].first, parts[0].count);
});
test('one clause over the limit throws', () => {
  assert.throws(() => buildSsml(['長'.repeat(400) + '，'], () => 'chang2'), /clause/);
});
test('sourceHash is stable and changes with one character or one reading', () => {
  const a = sourceHash(buildSsml(['道可道'], () => null));
  assert.equal(a, sourceHash(buildSsml(['道可道'], () => null)));
  assert.notEqual(a, sourceHash(buildSsml(['道可導'], () => null)));
  assert.notEqual(a, sourceHash(buildSsml(['道可道'], (c) => (c.i === 1 ? 'ke3' : null))));
});
test('SETTINGS is frozen', () => {
  assert.ok(Object.isFrozen(SETTINGS));
  assert.equal(SETTINGS.voice, 'cmn-CN-Wavenet-B');
});

const R = (o) => ({ chars: {}, extra: {}, at: {}, engine: [], ...o });
test('resolveReading: engine wins, then at, chars, extra', () => {
  const c = { ch: '長', seg: 0, k: 2 };
  assert.equal(resolveReading(1, c, R({ engine: ['長'], at: { '1:0:2': { py: 'zhang3' } }, chars: { 長: 'chang2' } })), null);
  assert.equal(resolveReading(1, c, R({ at: { '1:0:2': { py: 'zhang3' } }, chars: { 長: 'chang2' }, extra: { 長: { py: 'x1' } } })), 'zhang3');
  assert.equal(resolveReading(1, c, R({ chars: { 長: 'chang2' }, extra: { 長: { py: 'x1' } } })), 'chang2');
  assert.equal(resolveReading(1, c, R({ extra: { 長: { py: 'x1' } } })), 'x1');
  assert.equal(resolveReading(1, c, R()), null);
  assert.equal(resolveReading(2, c, R({ at: { '1:0:2': { py: 'zhang3' } } })), null);
});
test('needsDecision', () => {
  const lex = { 長: { py: ['cháng', 'zhǎng'] }, 道: { py: ['dào'] }, 一: { py: ['yī', 'yí'] } };
  assert.equal(needsDecision('長', lex, R()), true);
  assert.equal(needsDecision('道', lex, R()), false);
  assert.equal(needsDecision('道', lex, R({ extra: { 道: { py: 'dao4' } } })), true);
  assert.equal(needsDecision('一', lex, R({ engine: ['一'] })), false);
});

const lex = { 長: { py: ['cháng', 'zhǎng'] }, 一: { py: ['yī', 'yí', 'yì'] }, 沒: { py: ['méi'] }, 女: { py: ['nǚ'] } };
test('validateReadings (one passage) reports a missing decision, a moved at-key, a ctx off the key, and an engine at-override', () => {
  const segs = ['長一沒女，長長'];
  const base = { engine: ['一'], extra: { 沒: { py: 'mo4', why: 'test' } } };
  assert.deepEqual(validateReadings(1, segs, R({ ...base, chars: { 長: 'chang2', 女: 'nv3' } }), lex), []);
  // missing decision for 長 (three occurrences)
  const miss = validateReadings(1, segs, R(base), lex);
  assert.equal(miss.length, 3);
  assert.ok(miss[0].includes('1') && miss[0].includes('0:0') && miss[0].includes('長'));
  // moved at-key
  let e = validateReadings(1, segs, R({ ...base, chars: { 長: 'chang2' }, at: { '1:0:1': { ch: '長', py: 'zhang3' } } }), lex);
  assert.equal(e.length, 1); assert.match(e[0], /1:0:1/);
  // ctx covering k, and ctx not covering k
  const at = (k, ctx) => R({ ...base, chars: { 長: 'chang2' }, at: { [`1:0:${k}`]: { ch: '長', py: 'zhang3', ctx } } });
  assert.deepEqual(validateReadings(1, segs, at(5, '，長長'), lex), []);
  assert.equal(validateReadings(1, segs, at(5, '長一'), lex).length, 1);
  assert.equal(validateReadings(1, segs, at(5, '無此'), lex).length, 1);
  // at for another passage is ignored
  assert.deepEqual(validateReadings(1, segs, R({ ...base, chars: { 長: 'chang2' }, at: { '2:0:9': { ch: '長', py: 'zhang3' } } }), lex), []);
  // engine at-override
  e = validateReadings(1, segs, R({ ...base, chars: { 長: 'chang2' }, at: { '1:0:1': { ch: '一', py: 'yi1' } } }), lex);
  assert.ok(e.some((m) => m.includes('一')));
  // a bad chars entry is not reported per passage (validateGlobalReadings does that once)
  assert.deepEqual(validateReadings(1, segs, R({ ...base, chars: { 長: 'wang2' } }), lex), []);
});

test('validateGlobalReadings reports chars and extra once: engine override, bad tone, a syllable the lexicon lacks, extra without why, bad at keys', () => {
  const base = { engine: ['一'], extra: { 沒: { py: 'mo4', why: 'test' } } };
  assert.deepEqual(validateGlobalReadings(R({ ...base, chars: { 長: 'chang2', 女: 'nv3' } }), lex), []);
  let e = validateGlobalReadings(R({ ...base, chars: { 長: 'chang2', 一: 'yi1' } }), lex);
  assert.equal(e.length, 1); assert.match(e[0], /一/);
  e = validateGlobalReadings(R({ ...base, chars: { 長: 'chang6' } }), lex);
  assert.equal(e.length, 1); assert.match(e[0], /chang6/);
  e = validateGlobalReadings(R({ ...base, chars: { 長: 'wang2' } }), lex);
  assert.equal(e.length, 1); assert.match(e[0], /wang2/);
  e = validateGlobalReadings(R({ ...base, extra: { 沒: { py: 'mo4' } } }), lex);
  assert.equal(e.length, 1);
  e = validateGlobalReadings(R({ ...base, at: { '1:0': { ch: '長', py: 'zhang3' }, '1:0:2:9': { ch: '長', py: 'zhang3' }, '1:0:x': { ch: '長', py: 'zhang3' } } }), lex);
  assert.equal(e.length, 3);
  for (const m of e) assert.match(m, /N:seg:k/);
});

test('forcedReadings lists every forced character with place, context, reading, and source', () => {
  const segs = ['長一沒長，', '長長'];
  const rows = forcedReadings(1, segs, R({ engine: ['一'], chars: { 長: 'chang2' }, extra: { 沒: { py: 'mo4', why: 't' } }, at: { '1:1:1': { ch: '長', py: 'zhang3' } } }));
  assert.deepEqual(rows.map((x) => [`${x.seg}:${x.k}`, x.ch, x.py, x.from]), [
    ['0:0', '長', 'chang2', 'chars'], ['0:2', '沒', 'mo4', 'extra'], ['0:3', '長', 'chang2', 'chars'],
    ['1:0', '長', 'chang2', 'chars'], ['1:1', '長', 'zhang3', 'at'],
  ]);
  assert.equal(rows[1].ctx, '長一沒長，');
  assert.ok(rows[4].ctx.includes('長長'));
});

import { joinTimes, parseWav, main as buildMain, isUpToDate, withPrev, removeOld, writeMp3, enLanguage, enTimes, enCheckTimes } from '../scripts/build-audio.mjs';
import { SETTINGS_EN, enSourceHash, enSource } from '../scripts/lib/listen-en.mjs';

test('joinTimes shifts later parts by the samples before them', () => {
  const r = joinTimes([{ times: [0.015, 0.5], samples: 24000 }, { times: [0.015], samples: 24000 }], 24000);
  assert.deepEqual(r.t, [0.015, 0.5, 1.015]);
  assert.equal(r.end, 2);
});
test('parseWav finds the data chunk after an extra LIST chunk', () => {
  const fmt = Buffer.alloc(24); fmt.write('fmt ', 0); fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10); fmt.writeUInt32LE(24000, 12);
  fmt.writeUInt32LE(48000, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22);
  const list = Buffer.alloc(8 + 5 + 1); list.write('LIST', 0); list.writeUInt32LE(5, 4); list.write('abcde', 8); // odd size, padded
  const pcm = Buffer.from([1, 0, 2, 0, 3, 0]);
  const data = Buffer.concat([Buffer.from('data'), Buffer.from([6, 0, 0, 0]), pcm]);
  const body = Buffer.concat([Buffer.from('WAVE'), fmt, list, data]);
  const head = Buffer.alloc(8); head.write('RIFF', 0); head.writeUInt32LE(body.length, 4);
  const w = parseWav(Buffer.concat([head, body]));
  assert.equal(w.sampleRate, 24000);
  assert.equal(w.channels, 1);
  assert.deepEqual([...w.pcm], [1, 0, 2, 0, 3, 0]);
  fmt.writeUInt16LE(24, 22); // 24-bit samples
  const body24 = Buffer.concat([Buffer.from('WAVE'), fmt, list, data]);
  head.writeUInt32LE(body24.length, 4);
  assert.throws(() => parseWav(Buffer.concat([head, body24])), /16-bit/);
});

test('build-audio: --drop without a passage number prints usage and exits 2', async () => {
  const saved = console.error;
  const lines = [];
  console.error = (m) => lines.push(String(m));
  try {
    assert.equal(await buildMain(['node', 'build-audio.mjs', '--drop']), 2);
    assert.equal(await buildMain(['node', 'build-audio.mjs', '--drop', 'x']), 2);
    assert.equal(await buildMain(['node', 'build-audio.mjs', '--list']), 2);
  } finally { console.error = saved; }
  assert.ok(lines.every((l) => /Usage/.test(l)));
});

test('build-audio: up to date needs the same src and the MP3 file', () => {
  const stored = { file: 'audio/passages/01.zh.aaaaaaaa.mp3', src: 'S' };
  assert.equal(isUpToDate(stored, 'S', () => true), true);
  assert.equal(isUpToDate(stored, 'S', () => false), false);
  assert.equal(isUpToDate(stored, 'T', () => true), false);
  assert.equal(isUpToDate(undefined, 'S', () => true), false);
});

test('build-audio: a re-recording keeps the old file as prev', () => {
  const entry = { file: 'audio/passages/01.zh.bbbbbbbb.mp3', src: 'S2', n: 1, end: 1, t: [0] };
  const yes = () => true;
  const e1 = withPrev(entry, { file: 'audio/passages/01.zh.aaaaaaaa.mp3' }, yes);
  assert.equal(e1.prev, 'audio/passages/01.zh.aaaaaaaa.mp3');
  assert.deepEqual(Object.keys(e1), ['file', 'prev', 'src', 'n', 'end', 't']);
  // same bytes again: the old prev stays
  assert.equal(withPrev(entry, { file: entry.file, prev: 'audio/passages/01.zh.cccccccc.mp3' }, yes).prev, 'audio/passages/01.zh.cccccccc.mp3');
  assert.equal(withPrev(entry, undefined, yes).prev, undefined);
  assert.equal(withPrev(entry, { file: 'audio/passages/01.zh.aaaaaaaa.mp3' }, () => false).prev, undefined, 'a missing file is not kept as prev');
});

test('build-audio: removeOld keeps file and prev, deletes older files of that passage only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tao-audio-'));
  try {
    for (const f of ['01.zh.00000000.mp3', '01.zh.aaaaaaaa.mp3', '01.zh.bbbbbbbb.mp3', '02.zh.cccccccc.mp3']) writeFileSync(join(dir, f), 'x');
    removeOld(dir, 1, 'zh', ['01.zh.bbbbbbbb.mp3', '01.zh.aaaaaaaa.mp3']);
    assert.deepEqual(readdirSync(dir).sort(), ['01.zh.aaaaaaaa.mp3', '01.zh.bbbbbbbb.mp3', '02.zh.cccccccc.mp3']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build-audio: writeMp3 names the file by its hash, and a failed encode leaves no tmp file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tao-audio-'));
  try {
    const name = writeMp3(dir, 1, 'zh', Buffer.alloc(2), 24000, (_pcm, _rate, out) => writeFileSync(out, 'mp3 bytes'));
    const h8 = createHash('sha256').update('mp3 bytes').digest('hex').slice(0, 8);
    assert.equal(name, `01.zh.${h8}.mp3`);
    assert.throws(() => writeMp3(dir, 2, 'zh', Buffer.alloc(2), 24000, (_pcm, _rate, out) => { writeFileSync(out, 'half'); throw new Error('ffmpeg failed'); }), /ffmpeg failed/);
    assert.equal(existsSync(join(dir, '02.zh.tmp.mp3')), false);
    assert.deepEqual(readdirSync(dir), [name]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

import { checkListen } from '../scripts/check-audio.mjs';

const CL_READ = { engine: ['一'], at: {}, chars: {}, extra: {} };
const CL_SEGS = { 1: ['道可道，非常道。'] };
function clGood() {
  const parts = buildSsml(CL_SEGS[1], (c) => resolveReading(1, c, CL_READ));
  const m = { v: 1, voice: SETTINGS.voice, rate: SETTINGS.rate, en: {},
    zh: { 1: { file: 'audio/passages/01.zh.aaaaaaaa.mp3', src: sourceHash(parts), n: 6, end: 5, t: [0.1, 0.5, 1, 1.5, 2, 3] } } }; // 道可道非常道: 6 characters
  return { manifest: m, segmentsOf: (n) => CL_SEGS[n], readings: CL_READ, lex: {}, exists: () => true, mp3s: ['01.zh.aaaaaaaa.mp3'],
    hashOf: (rel) => rel.match(/\.([0-9a-f]{8})\.mp3$/)[1] + '0'.repeat(56) };
}
const clRun = (mut) => { const a = clGood(); mut(a); return checkListen(a); };

test('checkListen: a manifest made by the builder has no errors', () => {
  assert.deepEqual(checkListen(clGood()), []);
});
test('checkListen: changed text gives the exact message', () => {
  const e = clRun((a) => { a.segmentsOf = () => ['道可道，非常名。']; });
  assert.deepEqual(e, ['Passage 1 text or readings changed after the recording. Run `npm run audio -- 1`, or `npm run audio -- --drop 1`.']);
});
test('checkListen: changed reading is also stale', () => {
  const e = clRun((a) => { a.readings = { ...CL_READ, chars: { 道: 'dao4' } }; a.lex = { 道: { py: ['dào'] } }; });
  assert.equal(e.length, 1); assert.match(e[0], /^Passage 1 text or readings changed/);
});
test('checkListen: t length must equal n', () => {
  const e = clRun((a) => { a.manifest.zh[1].n = 8; });
  assert.deepEqual(e, ['Passage 1: t has 6 times, but n is 8.']);
});
test('checkListen: n and t must match the passage characters', () => {
  const e = clRun((a) => { a.manifest.zh[1].n = 5; a.manifest.zh[1].t = [0.1, 0.5, 1, 1.5, 2]; });
  assert.deepEqual(e, ['Passage 1: n is 5 and t has 5 times, but the passage has 6 characters.']);
});
test('checkListen: an MP3 whose bytes do not match its name is an error', () => {
  const e = clRun((a) => { a.hashOf = () => 'ffffffff' + '0'.repeat(56); });
  assert.equal(e.length, 1); assert.match(e[0], /01\.zh\.aaaaaaaa\.mp3.*ffffffff/);
});
test('checkListen: prev is kept, must exist, and is hashed; other strays still fail', () => {
  const withPrevFile = (a) => { a.manifest.zh[1].prev = 'audio/passages/01.zh.bbbbbbbb.mp3'; a.mp3s.push('01.zh.bbbbbbbb.mp3'); };
  assert.deepEqual(clRun(withPrevFile), []);
  let e = clRun((a) => { withPrevFile(a); a.exists = (rel) => !rel.includes('bbbbbbbb'); });
  assert.equal(e.length, 1); assert.match(e[0], /prev.*01\.zh\.bbbbbbbb\.mp3/);
  e = clRun((a) => { withPrevFile(a); a.mp3s.push('01.zh.00000000.mp3'); });
  assert.equal(e.length, 1); assert.match(e[0], /01\.zh\.00000000\.mp3 is not named/);
});
test('checkListen: a bad chars entry is reported once, not once per passage', () => {
  const e = clRun((a) => {
    a.readings = { ...CL_READ, chars: { 道: 'wang2' } }; a.lex = { 道: { py: ['dào'] } };
    a.manifest.zh[2] = { ...a.manifest.zh[1] };
    CL_SEGS[2] = CL_SEGS[1];
  });
  delete CL_SEGS[2];
  assert.equal(e.filter((x) => /wang2/.test(x)).length, 1);
});
test('checkListen: t must increase', () => {
  const e = clRun((a) => { a.manifest.zh[1].t[3] = 0.5; });
  assert.equal(e.length, 1); assert.match(e[0], /increas/);
});
test('checkListen: end must be after the last mark', () => {
  const e = clRun((a) => { a.manifest.zh[1].end = 3; });
  assert.equal(e.length, 1); assert.match(e[0], /end/);
});
test('checkListen: a missing file is an error', () => {
  const e = clRun((a) => { a.exists = () => false; });
  assert.equal(e.length, 1); assert.match(e[0], /01\.zh\.aaaaaaaa\.mp3/);
});
test('checkListen: an MP3 no entry names is an error', () => {
  const e = clRun((a) => { a.mp3s.push('01.zh.tmp.mp3'); });
  assert.equal(e.length, 1); assert.match(e[0], /01\.zh\.tmp\.mp3/);
});
test('checkListen: readings errors are reported', () => {
  const e = clRun((a) => { a.lex = { 道: { py: ['dao4', 'dao3'] } }; });
  assert.ok(e.some((x) => /needs a reading decision/.test(x)));
});

test('build-audio: recording English keeps the Chinese files of that passage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tao-audio-'));
  try {
    for (const f of ['01.zh.aaaaaaaa.mp3', '01.en.11111111.mp3', '01.en.22222222.mp3', '01.en.33333333.mp3', '02.en.44444444.mp3']) writeFileSync(join(dir, f), 'x');
    removeOld(dir, 1, 'en', ['01.en.33333333.mp3', '01.en.22222222.mp3']);
    assert.deepEqual(readdirSync(dir).sort(), ['01.en.22222222.mp3', '01.en.33333333.mp3', '01.zh.aaaaaaaa.mp3', '02.en.44444444.mp3']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build-audio: writeMp3 with key en names NN.en.<h8>.mp3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tao-audio-'));
  try {
    const name = writeMp3(dir, 3, 'en', Buffer.alloc(2), 24000, (_pcm, _rate, out) => writeFileSync(out, 'en bytes'));
    assert.equal(name, `03.en.${createHash('sha256').update('en bytes').digest('hex').slice(0, 8)}.mp3`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build-audio: the English language object builds, hashes, and counts words', () => {
  const lines = ['A way, the [[Dao|dao]].', '', 'is not.'];
  const lang = enLanguage((n) => (n === 1 ? lines : null), { dao: 'daʊ' });
  assert.equal(lang.key, 'en');
  assert.deepEqual(lang.voice, { languageCode: SETTINGS_EN.lang, name: SETTINGS_EN.voice });
  assert.equal(lang.rate, SETTINGS_EN.rate);
  const built = lang.build(1);
  assert.deepEqual(built, enSource(lines, { dao: 'daʊ' }));
  assert.deepEqual(built.words, ['A', 'way', 'the', 'Dao', 'is', 'not']);
  assert.deepEqual([...lang.wild], ['dao']);
  assert.equal(built.count, 6);
  assert.equal(built.pronunciations.length, 1);
  assert.equal(lang.hash(built), enSourceHash(built));
  assert.deepEqual(lang.validate(1), []);
  assert.equal(lang.validate(2).length, 1);
  assert.match(lang.validate(2)[0], /no English rendering/);
  assert.match(enLanguage(() => ['the qi rises'], {}).validate(1)[0], /qi/);
});
test('build-audio: enTimes subtracts the bias (not below 0), rounds to 3 decimals, and fails under 90 % matched', () => {
  const heard = [{ word: 'a', start: 0.03 }, { word: 'way', start: 0.5 }, { word: 'is', start: 1.0004 }];
  assert.deepEqual(enTimes(['a', 'way', 'is'], heard, 5, 'p'), { t: [0, 0.434, 0.934], matched: 3, wild: 0 });
  const ten = Array.from({ length: 10 }, (_, i) => `w${i}`);
  const nine = ten.slice(0, 9).map((word, i) => ({ word, start: i + 1 }));
  assert.equal(enTimes(ten, nine, 20, 'p').matched, 9);
  assert.throws(() => enTimes(ten, nine.slice(1), 20, 'p'), /p: matched 8 of 10 words/);
});
test('build-audio: enTimes makes times strictly increase when two words clamp to 0', () => {
  const heard = [{ word: 'a', start: 0.01 }, { word: 'way', start: 0.05 }, { word: 'is', start: 0.5 }];
  assert.deepEqual(enTimes(['a', 'way', 'is'], heard, 5, 'p').t, [0, 0.001, 0.434]);
});
test('build-audio: enTimes makes times strictly increase when starts are equal', () => {
  const heard = [{ word: 'a', start: 1.08 }, { word: 'way', start: 1.08 }, { word: 'is', start: 1.08 }];
  assert.deepEqual(enTimes(['a', 'way', 'is'], heard, 5, 'p').t, [1.014, 1.015, 1.016]);
});
test('build-audio: enTimes keeps every time before end', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `w${i}`);
  const heard = ten.map((word, i) => ({ word, start: i === 9 ? 5.2 : i * 0.5 }));
  const { t } = enTimes(ten, heard, 5, 'p');
  assert.ok(t.at(-1) < 5 && t.at(-1) <= 4.999, String(t));
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], String(t));
});
test('build-audio: enTimes spreads an unmatched tail before end', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `w${i}`);
  const heard = ten.slice(0, 9).map((word, i) => ({ word, start: i * 0.3 + 0.066 }));
  const { t } = enTimes(ten, heard, 2.7, 'p');
  assert.ok(t[9] > t[8] && t[9] < 2.7, String(t));
});
test('build-audio: enCheckTimes throws on times the check would reject', () => {
  assert.doesNotThrow(() => enCheckTimes([0, 0.5], 1, 'p'));
  assert.throws(() => enCheckTimes([0, 0], 1, 'p'), /p: t does not increase/);
  assert.throws(() => enCheckTimes([0, 1], 1, 'p'), /p: end/);
});
test('build-audio: --en --drop without a passage number prints usage and exits 2', async () => {
  const saved = console.error;
  const lines = [];
  console.error = (m) => lines.push(String(m));
  try {
    assert.equal(await buildMain(['node', 'build-audio.mjs', '--en', '--drop']), 2);
    assert.equal(await buildMain(['node', 'build-audio.mjs', '--en', '--no-force', '--out', 'x.mp3', '1']), 2);
  } finally { console.error = saved; }
  assert.equal(lines.length, 2);
});

const EN_IPA = { dao: 'daʊ' };
const EN_LINES = { 1: ['The [[Dao|dao]] that can be told', '', 'is not the constant Dao.'] };
function enGood() {
  const a = clGood();
  a.manifest.en = { 1: { file: 'audio/passages/01.en.cccccccc.mp3', src: enSourceHash(enSource(EN_LINES[1], EN_IPA)), n: 11, end: 9, t: Array.from({ length: 11 }, (_, i) => 0.1 + i * 0.5) } };
  a.mp3s.push('01.en.cccccccc.mp3');
  a.renderingOf = (n) => EN_LINES[n] ?? null;
  a.ipa = EN_IPA;
  return a;
}
const enRun = (mut) => { const a = enGood(); mut(a); return checkListen(a); };

test('checkListen: an English entry made by the builder has no errors; its MP3 is not a stray', () => {
  assert.deepEqual(checkListen(enGood()), []);
});
test('checkListen: changed English gives the exact message', () => {
  assert.deepEqual(enRun((a) => { a.renderingOf = () => ['The [[Dao|dao]] that can be said', '', 'is not the constant Dao.']; }),
    ['Passage 1 English changed after the recording. Run `npm run audio -- --en 1`, or `npm run audio -- --en --drop 1`.']);
  assert.equal(enRun((a) => { a.ipa = { dao: 'daʊ', the: 'ðə' }; }).length, 1, 'a changed IPA table is stale too');
});
test('checkListen: English n and t must match the word count', () => {
  const e = enRun((a) => { a.manifest.en[1].n = 10; a.manifest.en[1].t.pop(); });
  assert.deepEqual(e, ['Passage 1 English: n is 10 and t has 10 times, but the passage has 11 words.']);
});
test('checkListen: English file and prev are checked, and an unnamed English MP3 is a stray', () => {
  let e = enRun((a) => { a.exists = (rel) => !rel.includes('cccccccc'); });
  assert.equal(e.length, 1); assert.match(e[0], /01\.en\.cccccccc\.mp3 does not exist/);
  e = enRun((a) => { a.manifest.en[1].prev = 'audio/passages/01.en.dddddddd.mp3'; a.mp3s.push('01.en.dddddddd.mp3'); });
  assert.deepEqual(e, []);
  e = enRun((a) => { a.mp3s.push('01.en.eeeeeeee.mp3'); });
  assert.deepEqual(e, ['audio/passages/01.en.eeeeeeee.mp3 is not named by any entry in listen.json.']);
});
test('checkListen: an English entry with no rendering is an error', () => {
  const e = enRun((a) => { a.renderingOf = () => null; });
  assert.equal(e.length, 1); assert.match(e[0], /Passage 1 English.*no rendering/);
});
