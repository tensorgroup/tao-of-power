import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignWords, cutPoints, silenceMids, recognize, numberWords, STT_ENDPOINT } from '../scripts/lib/align.mjs';

const heard = (pairs) => pairs.map(([word, start]) => ({ word, start }));

test('alignWords: an exact match takes the heard starts', () => {
  const r = alignWords(['The', 'Dao', 'is'], heard([['the', 0.1], ['dao', 0.4], ['is', 0.9]]));
  assert.deepEqual(r, { t: [0.1, 0.4, 0.9], matched: 3 });
});
test('alignWords: case, curly apostrophes, and punctuation do not matter', () => {
  const r = alignWords(['sage’s', 'way;'], heard([["Sage's", 0.2], ['way.', 0.7]]));
  assert.deepEqual(r, { t: [0.2, 0.7], matched: 2 });
});
test('alignWords: a missed word is interpolated between its matched neighbours', () => {
  const r = alignWords(['a', 'way', 'that', 'can'], heard([['a', 1], ['that', 2], ['can', 3]]));
  assert.equal(r.matched, 3);
  assert.deepEqual(r.t, [1, 1.5, 2, 3]);
});
test('alignWords: two missed words in a row are spread evenly', () => {
  const r = alignWords(['a', 'b', 'c', 'd'], heard([['a', 1], ['d', 4]]));
  assert.deepEqual(r, { t: [1, 2, 3, 4], matched: 2 });
});
test('alignWords: an extra heard word is skipped', () => {
  const r = alignWords(['a', 'way', 'is'], heard([['a', 0.5], ['uh', 0.8], ['way', 1.1], ['is', 1.6]]));
  assert.deepEqual(r, { t: [0.5, 1.1, 1.6], matched: 3 });
});
test('alignWords: a missed first word is spread from 0', () => {
  const r = alignWords(['so', 'always', 'without'], heard([['always', 1.2], ['without', 1.8]]));
  assert.deepEqual(r, { t: [0.6, 1.2, 1.8], matched: 2 });
});
test('alignWords: words after the last match step by 0.35 s', () => {
  const r = alignWords(['a', 'b', 'c'], heard([['a', 2]]));
  assert.equal(r.matched, 1);
  assert.deepEqual(r.t, [2, 2.35, 2.7]);
});
test('alignWords: nothing heard gives 0.35 s steps from 0', () => {
  assert.deepEqual(alignWords(['a', 'b'], []), { t: [0.35, 0.7], matched: 0 });
});
test('alignWords: a repeated word matches in order', () => {
  const r = alignWords(['dark', 'and', 'dark'], heard([['dark', 1], ['dark', 3]]));
  assert.deepEqual(r, { t: [1, 2, 3], matched: 2 });
});

test('alignWords: a lexicon word matches any one heard token at its place', () => {
  const wild = new Set(['dao', 'de']);
  const r = alignWords(['the', 'Dao', 'and', 'de'], heard([['the', 0.2], ['dow', 0.5], ['and', 0.9], ['duh', 1.2]]), { wild });
  assert.deepEqual(r, { t: [0.2, 0.5, 0.9, 1.2], matched: 4 });
});
test('alignWords: an exact match wins over a lexicon wildcard', () => {
  const r = alignWords(['the', 'Dao', 'is'], heard([['the', 0.5], ['is', 1]]), { wild: new Set(['dao']) });
  assert.deepEqual(r, { t: [0.5, 0.75, 1], matched: 2 });
});
test('alignWords: a hyphenated heard word splits into its parts', () => {
  const r = alignWords(['full', 'grown'], [{ word: 'full-grown', start: 1, end: 2 }]);
  assert.deepEqual(r, { t: [1, 1.5], matched: 2 });
});
test('alignWords: a joined heard word matches our split pair', () => {
  const r = alignWords(['a', 'full', 'grown', 'tree'], [{ word: 'a', start: 0.5 }, { word: 'fullgrown', start: 1, end: 2 }, { word: 'tree', start: 2.2 }]);
  assert.deepEqual(r, { t: [0.5, 1, 1.5, 2.2], matched: 4 });
});
test('alignWords: apostrophes do not count', () => {
  assert.deepEqual(alignWords(['its', 'sage’s'], heard([["it's", 1], ['sages', 2]])), { t: [1, 2], matched: 2 });
});
test('alignWords: heard digits match our number words', () => {
  const r = alignWords(['the', 'ten', 'thousand', 'things', 'the', 'third'],
    [{ word: 'the', start: 0 }, { word: '10,000', start: 1, end: 2 }, { word: 'things', start: 2.1 }, { word: 'the', start: 3 }, { word: '3rd', start: 3.5 }]);
  assert.deepEqual(r, { t: [0, 1, 1.5, 2.1, 3, 3.5], matched: 6 });
});
test('alignWords: with end, the tail after the last match is spread before end', () => {
  const r = alignWords(['a', 'b', 'c', 'd'], heard([['a', 9]]), { end: 9.8 });
  assert.deepEqual(r.t.map((x) => Math.round(x * 1000) / 1000), [9, 9.2, 9.4, 9.6]);
  assert.deepEqual(alignWords(['a', 'b'], heard([['a', 1]]), { end: 9 }).t, [1, 1.35], 'a long gap keeps 0.35 s steps');
});
test('numberWords: cardinals and ordinals', () => {
  assert.deepEqual(numberWords('3'), ['three']);
  assert.deepEqual(numberWords('10,000'), ['ten', 'thousand']);
  assert.deepEqual(numberWords('81'), ['eighty', 'one']);
  assert.deepEqual(numberWords('300'), ['three', 'hundred']);
  assert.deepEqual(numberWords('1st'), ['first']);
  assert.deepEqual(numberWords('12th'), ['twelfth']);
  assert.deepEqual(numberWords('20th'), ['twentieth']);
  assert.equal(numberWords('abc'), null);
});

test('silenceMids reads ffmpeg silencedetect output', () => {
  const err = '[silencedetect @ 0x1] silence_start: 1.5\n[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1\n'
    + '[silencedetect @ 0x1] silence_start: 10\n[silencedetect @ 0x1] silence_end: 10.4 | silence_duration: 0.4\n';
  assert.deepEqual(silenceMids(err), [2, 10.2]);
});
test('cutPoints: short audio is not cut', () => {
  assert.deepEqual(cutPoints(40, [10, 20]), [0, 40]);
});
test('cutPoints: long audio is cut at the silence nearest before 55 s', () => {
  assert.deepEqual(cutPoints(120, [20, 50, 54, 56, 90, 104, 110]), [0, 54, 104, 120]);
});
test('cutPoints: with no silence, cut at 55 s', () => {
  assert.deepEqual(cutPoints(70, []), [0, 55, 70]);
});

test('recognize: cuts long audio, sends FLAC per piece, and adds the offsets back', async () => {
  const rate = 16000;
  const pcm = Buffer.alloc(rate * 2 * 70); // 70 s of 16-bit mono
  const sent = [];
  const deps = {
    ffmpeg: (args, input) => {
      if (args.join(' ').includes('silencedetect')) return { stdout: Buffer.alloc(0), stderr: 'silence_start: 39.8\nsilence_end: 40.2 | silence_duration: 0.4\n' };
      return { stdout: Buffer.from(`flac:${input.length}`), stderr: '' };
    },
    post: async (url, body) => {
      sent.push({ url, body });
      const words = sent.length === 1
        ? [{ word: 'a', startOffset: '0.5s', endOffset: '0.8s' }, { word: 'way', endOffset: '1.2s' }]
        : [{ word: 'is', startOffset: '1s', endOffset: '1.3s' }];
      return { results: [{ alternatives: [{ words }] }, { alternatives: [{}] }] };
    },
  };
  const words = await recognize(pcm, deps);
  assert.deepEqual(words, [
    { word: 'a', start: 0.5, end: 0.8 },
    { word: 'way', start: 0, end: 1.2 },
    { word: 'is', start: 41, end: 41.3 },
  ]);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, STT_ENDPOINT);
  assert.deepEqual(sent[0].body.config, { autoDecodingConfig: {}, languageCodes: ['en-US'], model: 'chirp_2', features: { enableWordTimeOffsets: true } });
  assert.equal(Buffer.from(sent[0].body.content, 'base64').toString(), `flac:${rate * 2 * 40}`);
  assert.equal(Buffer.from(sent[1].body.content, 'base64').toString(), `flac:${rate * 2 * 30}`);
});
