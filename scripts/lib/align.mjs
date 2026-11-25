// Word times for a recording with no marks: Speech-to-Text (chirp_2) hears the words, and an
// LCS-style match puts each of our words on the heard word it matches.

export const STT_ENDPOINT = 'https://us-central1-speech.googleapis.com/v2/projects/tao-of-power/locations/us-central1/recognizers/_:recognize';
const STT_CONFIG = { autoDecodingConfig: {}, languageCodes: ['en-US'], model: 'chirp_2', features: { enableWordTimeOffsets: true } };
const MAX_PIECE = 55; // seconds; synchronous recognize takes up to 60 s
const TAIL_STEP = 0.35; // seconds per word after the last match
const RATE = 16000;

/** Lower case, letters and digits only (apostrophes dropped, so its = it's). */
const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = ' ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
const ORDINAL = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

function cardinal(n) {
  if (n < 20) return [ONES[n]];
  if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
  if (n < 1000) return [ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? cardinal(n % 100) : [])];
  return [...cardinal(Math.floor(n / 1000)), 'thousand', ...(n % 1000 ? cardinal(n % 1000) : [])];
}

/** A heard number ("10,000", "3rd") as English words, or null when it is not one (up to 999,999). */
export function numberWords(token) {
  const m = /^(\d{1,3}(?:,\d{3})*|\d+)(st|nd|rd|th)?$/.exec(token.toLowerCase());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (n >= 1e6) return null;
  const w = cardinal(n);
  if (m[2]) {
    const last = w.pop();
    w.push(ORDINAL[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`));
  }
  return w;
}

/** Heard words to normalised tokens: hyphens split, numbers become words; the parts share the word's time evenly. */
function heardTokens(heard) {
  const out = [];
  for (const h of heard) {
    const parts = h.word.split(/[-\s]+/).flatMap((p) => numberWords(p) ?? [norm(p)]).filter(Boolean);
    const end = h.end ?? h.start;
    const at = (k) => h.start + ((end - h.start) * k) / parts.length;
    parts.forEach((w, k) => out.push({ w, start: at(k), end: at(k + 1) }));
  }
  return out;
}

// Match scores: one exact word outscores any number of lexicon wildcards (each wildcard is 1, and
// there are fewer than EXACT words), so wildcards never take a token that an exact word could use.

/**
 * A best match of our words a (wild[i] = a lexicon word, matches any one token) against heard
 * tokens b. A heard token may also match two of our words joined (fullgrown = full grown).
 * Returns [i, j, k, isWild] steps: our words i..i+k-1 sit on token j.
 */
function match(a, wild, b) {
  const m = a.length, n = b.length;
  const EXACT = m + 1, WILD = 1;
  const L = Array.from({ length: m + 2 }, () => new Int32Array(n + 1));
  const one = (i, j) => (a[i] === b[j] ? EXACT : wild[i] ? WILD : 0);
  const two = (i, j) => i + 1 < m && a[i] + a[i + 1] === b[j];
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      let v = Math.max(L[i + 1][j], L[i][j + 1]);
      const s = one(i, j);
      if (s) v = Math.max(v, L[i + 1][j + 1] + s);
      if (two(i, j)) v = Math.max(v, L[i + 2][j + 1] + 2 * EXACT);
      L[i][j] = v;
    }
  }
  const steps = [];
  for (let i = 0, j = 0; i < m && j < n;) {
    const s = one(i, j);
    if (s && L[i][j] === L[i + 1][j + 1] + s) { steps.push([i, j, 1, s === WILD]); i++; j++; }
    else if (two(i, j) && L[i][j] === L[i + 2][j + 1] + 2 * EXACT) { steps.push([i, j, 2]); i += 2; j++; }
    else if (L[i + 1][j] === L[i][j]) i++;
    else j++;
  }
  return steps;
}

/**
 * Our words (as written) against heard { word, start, end? }: matched words take the heard start
 * (the second of a joined pair takes the middle of the heard word). An unmatched run is spread
 * evenly between its matched neighbours (from 0 before the first match). After the last match the
 * words are TAIL_STEP apart, or closer, so that they stay before opts.end. opts.wild holds the
 * lexicon words (lower case). Pure.
 */
export function alignWords(ours, heard, { wild = new Set(), end = Infinity } = {}) {
  const tokens = heardTokens(heard);
  const t = new Array(ours.length).fill(null);
  const steps = match(ours.map(norm), ours.map((w) => wild.has(w.toLowerCase())), tokens.map((x) => x.w));
  for (const [i, j, k] of steps) {
    t[i] = tokens[j].start;
    if (k === 2) t[i + 1] = (tokens[j].start + tokens[j].end) / 2;
  }
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== null) continue;
    let j = i;
    while (j < t.length && t[j] === null) j++;
    const lo = i ? t[i - 1] : 0;
    const n = j - i + 1;
    const step = j < t.length ? (t[j] - lo) / n : Math.min(TAIL_STEP, (end - lo) / n);
    for (let k = i; k < j; k++) t[k] = lo + step * (k - i + 1);
    i = j;
  }
  const wildCount = steps.filter((x) => x[3]).length;
  return { t, matched: steps.reduce((sum, [, , k]) => sum + k, 0), wild: wildCount };
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
