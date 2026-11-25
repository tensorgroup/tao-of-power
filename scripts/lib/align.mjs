// Word times for a recording with no marks: Speech-to-Text (chirp_2) hears the words, and an
// LCS match puts each of our words on the heard word it matches.

export const STT_ENDPOINT = 'https://us-central1-speech.googleapis.com/v2/projects/tao-of-power/locations/us-central1/recognizers/_:recognize';
const STT_CONFIG = { autoDecodingConfig: {}, languageCodes: ['en-US'], model: 'chirp_2', features: { enableWordTimeOffsets: true } };
const MAX_PIECE = 55; // seconds; synchronous recognize takes up to 60 s
const TAIL_STEP = 0.35; // seconds per word after the last match
const RATE = 16000;

/** Lower case, letters and digits only, with ’ as '. */
const norm = (w) => w.toLowerCase().replace(/’/g, "'").replace(/[^\p{L}\p{N}']/gu, '');

/** Index pairs [i, j] of a longest common subsequence of a and b, in order. */
function lcs(a, b) {
  const m = a.length, n = b.length;
  const L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const pairs = [];
  for (let i = 0, j = 0; i < m && j < n;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return pairs;
}

/**
 * Our words (as written) against heard { word, start }: matched words take the heard start;
 * an unmatched run is spread evenly between its matched neighbours (from 0 before the first
 * match, TAIL_STEP apart after the last). Pure.
 */
export function alignWords(ours, heard) {
  const t = new Array(ours.length).fill(null);
  const pairs = lcs(ours.map(norm), heard.map((h) => norm(h.word)));
  for (const [i, j] of pairs) t[i] = heard[j].start;
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== null) continue;
    let j = i;
    while (j < t.length && t[j] === null) j++;
    const lo = i ? t[i - 1] : 0;
    const steps = j - i + 1;
    for (let k = i; k < j; k++) t[k] = j < t.length ? lo + ((t[j] - lo) * (k - i + 1)) / steps : lo + TAIL_STEP * (k - i + 1);
    i = j;
  }
  return { t, matched: pairs.length };
}

/** Midpoints (s) of the silences in ffmpeg silencedetect output. */
export function silenceMids(stderr) {
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return ends.map((e, k) => (starts[k] + e) / 2);
}

/** Cut times from 0 to duration: each piece ends at the silence nearest before MAX_PIECE s, or at MAX_PIECE s. */
export function cutPoints(duration, mids) {
  const cuts = [0];
  while (duration - cuts[cuts.length - 1] > MAX_PIECE) {
    const last = cuts[cuts.length - 1];
    const before = mids.filter((m) => m > last && m < last + MAX_PIECE);
    cuts.push(before.length ? before[before.length - 1] : last + MAX_PIECE);
  }
  cuts.push(duration);
  return cuts;
}

const seconds = (s) => (s ? Number(String(s).replace(/s$/, '')) : 0);
const PCM_IN = ['-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', '-'];

/**
 * Hear the words in 16 kHz mono 16-bit PCM. deps.ffmpeg(args, input) -> { stdout, stderr };
 * deps.post(url, body) -> response JSON. Returns [{ word, start, end }] in passage seconds.
 */
export async function recognize(pcm16k, deps) {
  const duration = pcm16k.length / 2 / RATE;
  const { stderr } = deps.ffmpeg(['-hide_banner', ...PCM_IN, '-af', 'silencedetect=n=-35dB:d=0.35', '-f', 'null', '-'], pcm16k);
  const cuts = cutPoints(duration, silenceMids(String(stderr)));
  const words = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k];
    const piece = pcm16k.subarray(Math.round(a * RATE) * 2, Math.round(cuts[k + 1] * RATE) * 2);
    const flac = deps.ffmpeg(['-loglevel', 'error', ...PCM_IN, '-f', 'flac', '-'], piece).stdout;
    const json = await deps.post(STT_ENDPOINT, { config: STT_CONFIG, content: Buffer.from(flac).toString('base64') });
    for (const res of json.results ?? []) {
      for (const w of res.alternatives?.[0]?.words ?? []) {
        words.push({ word: w.word, start: a + seconds(w.startOffset), end: a + seconds(w.endOffset) });
      }
    }
  }
  return words;
}
