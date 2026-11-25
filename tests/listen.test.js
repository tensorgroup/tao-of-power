import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, resolveReading, needsDecision, buildSsml, sourceHash, validateReadings } from '../scripts/lib/listen-ssml.mjs';

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
test('validateReadings reports a missing decision, a moved at-key, a ctx off the key, an engine override, a bad tone, and a syllable the lexicon lacks', () => {
  const segs = ['長一沒女，長長'];
  const base = { engine: ['一'], extra: { 沒: { py: 'mo4', why: 'test' } } };
  // clean: 長 decided by chars, 女 as nv3 (ü -> v)
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
  // engine override
  e = validateReadings(1, segs, R({ ...base, chars: { 長: 'chang2', 一: 'yi1' } }), lex);
  assert.equal(e.length, 1); assert.match(e[0], /一/);
  e = validateReadings(1, segs, R({ ...base, chars: { 長: 'chang2' }, at: { '1:0:1': { ch: '一', py: 'yi1' } } }), lex);
  assert.ok(e.some((m) => m.includes('一')));
  // bad tone format
  e = validateReadings(1, segs, R({ ...base, chars: { 長: 'chang6' } }), lex);
  assert.equal(e.length, 1); assert.match(e[0], /chang6/);
  // syllable the lexicon lacks
  e = validateReadings(1, segs, R({ ...base, chars: { 長: 'wang2' } }), lex);
  assert.equal(e.length, 1); assert.match(e[0], /wang2/);
  // extra without why is held to the lexicon
  e = validateReadings(1, segs, R({ ...base, extra: { 沒: { py: 'mo4' } }, chars: { 長: 'chang2' } }), lex);
  assert.equal(e.length, 1);
});

import { joinTimes, parseWav } from '../scripts/build-audio.mjs';

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
});
