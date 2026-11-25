// Record the Listen read-aloud audio: one MP3 per passage + timings in listen.json.
// Chinese: Google TTS with SSML marks. English: Chirp 3 HD markup, word times from Speech-to-Text.
// Usage: node scripts/build-audio.mjs [--en] [N... | --all] | [--en] --drop N | --list N | --no-force --out <path> N
import { readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { segmentsFor } from '../app/js/markup.js';
import { SETTINGS, resolveReading, buildSsml, sourceHash, validateReadings, validateGlobalReadings, forcedReadings } from './lib/listen-ssml.mjs';
import { SETTINGS_EN, enSource, enSourceHash, romanizedCandidates } from './lib/listen-en.mjs';
import { alignWords, recognize } from './lib/align.mjs';

const app = fileURLToPath(new URL('../app/', import.meta.url));
const scripts = fileURLToPath(new URL('./', import.meta.url));
const MANIFEST = join(app, 'data/listen.json');
const OUT_DIR = join(app, 'audio/passages');
const ENDPOINT = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';
const ENDPOINT_EN = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const USAGE = 'Usage: npm run audio -- [--en] [N... | --all] | [--en] --drop N | --list N | --no-force --out <path> N';
const FFMPEG = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';

/** Read a WAV buffer: find the fmt and data chunks (the header length varies). */
export function parseWav(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let pos = 12, sampleRate = 0, channels = 0, bits = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') { channels = buf.readUInt16LE(body + 2); sampleRate = buf.readUInt32LE(body + 4); bits = buf.readUInt16LE(body + 14); }
    if (id === 'data') {
      if (!sampleRate) throw new Error('WAV data chunk before fmt chunk');
      if (bits !== 16) throw new Error(`WAV has ${bits}-bit samples; expected 16-bit`);
      return { sampleRate, channels, pcm: buf.subarray(body, Math.min(body + size, buf.length)) };
    }
    pos = body + size + (size & 1);
  }
  throw new Error('WAV has no data chunk');
}

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Join per-part mark times into passage time: part k starts after all earlier samples. */
export function joinTimes(parts, sampleRate) {
  const t = [];
  let offset = 0;
  for (const p of parts) {
    for (const x of p.times) t.push(r3(x + offset / sampleRate));
    offset += p.samples;
  }
  return { t, end: r3(offset / sampleRate) };
}

const pad = (n) => String(n).padStart(2, '0');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function loadManifest() {
  if (!existsSync(MANIFEST)) return { v: 1, voice: SETTINGS.voice, rate: SETTINGS.rate, zh: {}, en: {} };
  return readJson(MANIFEST);
}

function saveManifest(m) {
  const line = (o) => Object.keys(o).sort((a, b) => a - b).map((k) => `${JSON.stringify(k)}:${JSON.stringify(o[k])}`).join(',\n');
  const text = `{"v":${m.v},"voice":${JSON.stringify(m.voice)},"rate":${m.rate},"zh":{\n${line(m.zh)}\n},"en":{${Object.keys(m.en).length ? '\n' + line(m.en) + '\n' : ''}}}\n`;
  const tmp = `${MANIFEST}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, MANIFEST);
}

/** Delete passage n's MP3s of one language (key) in dir except the basenames in keep (the new file and prev). */
export function removeOld(dir, n, key, keep) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (f.startsWith(`${pad(n)}.${key}.`) && f.endsWith('.mp3') && !keep.includes(f)) unlinkSync(join(dir, f));
  }
}

/** Nothing to record: same SSML source, and the MP3 it names is on disk. */
export function isUpToDate(stored, src, exists) {
  return stored?.src === src && typeof stored.file === 'string' && exists(stored.file);
}

/**
 * The new entry with prev: the file the stored entry named, kept one release for readers
 * whose page still names it. When the bytes did not change, the stored prev carries over.
 */
export function withPrev(entry, stored, exists) {
  const prev = stored && stored.file !== entry.file ? stored.file : stored?.prev;
  if (!prev || prev === entry.file || !exists(prev)) return entry;
  const { file, ...rest } = entry;
  return { file, prev, ...rest };
}

/** Encode to NN.<key>.tmp.mp3, then rename to NN.<key>.<h8>.mp3. The tmp file never stays behind. */
export function writeMp3(dir, n, key, pcm, rate, encode = encodeMp3) {
  const tmp = join(dir, `${pad(n)}.${key}.tmp.mp3`);
  try {
    encode(pcm, rate, tmp);
    const name = `${pad(n)}.${key}.${sha(readFileSync(tmp)).slice(0, 8)}.mp3`;
    renameSync(tmp, join(dir, name));
    return name;
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

let token;
const getToken = () => (token ??= execFileSync('gcloud', ['--configuration=tao', 'auth', 'print-access-token'], { encoding: 'utf8' }).trim());

/** POST JSON to a Google API with the gcloud token; what names the API in errors. */
async function post(url, body, what) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'x-goog-user-project': 'tao-of-power', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${what} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const synth = (ssml, voice, rate) => post(ENDPOINT, {
  input: { ssml },
  voice,
  audioConfig: { audioEncoding: 'LINEAR16', speakingRate: rate },
  enableTimePointing: ['SSML_MARK'],
}, 'TTS');

const synthEn = ({ markup, pronunciations }, voice, rate) => post(ENDPOINT_EN, {
  input: { markup, ...(pronunciations.length ? { customPronunciations: { pronunciations } } : {}) },
  voice,
  audioConfig: { audioEncoding: SETTINGS_EN.encoding, speakingRate: rate },
}, 'TTS');

const runFfmpeg = (args, input) => {
  const r = spawnSync(FFMPEG, args, { input, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  return { stdout: r.stdout, stderr: r.stderr.toString() };
};

/** Mono 16-bit PCM at sampleRate to 16 kHz, for the recognizer. */
const to16k = (pcm, sampleRate) => runFfmpeg(['-loglevel', 'error', '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', '-',
  '-ar', '16000', '-f', 's16le', '-'], pcm).stdout;

function encodeMp3(pcm, sampleRate, outPath) {
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', '-',
    '-codec:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3', outPath], { input: pcm, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

/**
 * The Chinese language object. With noForce, no reading is forced and the readings check is off
 * (the src gets ':plain', so a plain test recording is never taken as up to date).
 */
export function zhLanguage(ctx, noForce = false) {
  return {
    key: 'zh',
    label: (n) => `passage ${n}`,
    build: (n) => buildSsml(segmentsOf(n, ctx.text), noForce ? () => null : (c) => resolveReading(n, c, ctx.readings)),
    hash: (parts) => sourceHash(parts) + (noForce ? ':plain' : ''),
    validate: (n) => (noForce ? [] : [...ctx.globalErrs, ...validateReadings(n, segmentsOf(n, ctx.text), ctx.readings, ctx.lex)]),
    voice: { languageCode: 'cmn-CN', name: SETTINGS.voice },
    rate: SETTINGS.rate,
    speak: speakZh,
  };
}

/** Chinese: one TTS request per SSML part; mark times give t. */
async function speakZh(parts, lang, who) {
  const got = [];
  let rate = 0;
  for (const part of parts) {
    const json = await synth(part.ssml, lang.voice, lang.rate);
    const tp = json.timepoints ?? [];
    const names = tp.map((x) => x.markName);
    const want = Array.from({ length: part.count }, (_, j) => String(part.first + j));
    if (tp.length !== part.count || names.some((nm, j) => nm !== want[j])) {
      throw new Error(`${who}: got ${tp.length} marks, wanted ${part.count} (${part.first}..${part.first + part.count - 1}); nothing written`);
    }
    const wav = parseWav(Buffer.from(json.audioContent, 'base64'));
    if (wav.channels !== 1) throw new Error(`${who}: expected mono audio`);
    if (rate && rate !== wav.sampleRate) throw new Error(`${who}: sample rate changed between parts`);
    rate = wav.sampleRate;
    got.push({ times: tp.map((x) => x.timeSeconds), samples: wav.pcm.length / 2, pcm: wav.pcm });
  }
  const { t, end } = joinTimes(got, rate);
  for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] < 0.08) console.warn(`${who}: marks ${i - 1}-${i} are ${r3(t[i] - t[i - 1])} s apart`);
  return { t, end, rate, pcm: Buffer.concat(got.map((g) => g.pcm)) };
}

/** Throw unless t starts at 0 or later, strictly increases, and ends before end (the check-audio rules). */
export function enCheckTimes(t, end, who) {
  if (t.length && !(t[0] >= 0)) throw new Error(`${who}: the first time is ${t[0]}; nothing written`);
  for (let i = 1; i < t.length; i++) if (!(t[i] > t[i - 1])) throw new Error(`${who}: t does not increase at word ${i}; nothing written`);
  if (t.length && !(end > t[t.length - 1])) throw new Error(`${who}: end (${end}) is not after the last time (${t[t.length - 1]}); nothing written`);
}

/**
 * English word times (s) from heard words: alignWords (wild = lexicon words), minus
 * SETTINGS_EN.alignBias (not below 0), in whole ms, each at least 1 ms after the one before
 * and 1 ms before end. Throws when fewer than 90 % of the words matched, or the times fail the check rules.
 */
export function enTimes(words, heard, end, who, wild = new Set()) {
  const { t, matched } = alignWords(words, heard, { wild, end });
  if (matched < 0.9 * words.length) throw new Error(`${who}: matched ${matched} of ${words.length} words (under 90 %); nothing written`);
  const ms = t.map((x) => Math.max(0, Math.round((x - SETTINGS_EN.alignBias) * 1000)));
  for (let i = 1; i < ms.length; i++) ms[i] = Math.max(ms[i], ms[i - 1] + 1);
  for (let i = ms.length - 1, cap = Math.round(end * 1000) - 1; i >= 0; i--) { ms[i] = Math.min(ms[i], cap); cap = ms[i] - 1; }
  const out = ms.map((x) => x / 1000);
  enCheckTimes(out, end, who);
  return { t: out, matched };
}

/** The English language object: renderingOf(n) gives the rendering lines (or null); ipa is the romanized-word table. */
export function enLanguage(renderingOf, ipa) {
  return {
    key: 'en',
    label: (n) => `passage ${n} English`,
    build: (n) => enSource(renderingOf(n), ipa),
    hash: enSourceHash,
    validate: (n) => {
      const r = renderingOf(n);
      if (!r?.length) return [`passage ${n}: no English rendering`];
      return romanizedCandidates([r], ipa).map((w) => `passage ${n}: "${w}" looks romanized; add it to scripts/audio-en-lexicon.json`);
    },
    voice: { languageCode: SETTINGS_EN.lang, name: SETTINGS_EN.voice },
    rate: SETTINGS_EN.rate,
    wild: new Set(Object.keys(ipa)),
    speak: speakEn,
  };
}

/** English: one Chirp request for the passage; the recognizer hears the words and alignWords times them. */
async function speakEn(built, lang, who) {
  const wav = parseWav(Buffer.from((await synthEn(built, lang.voice, lang.rate)).audioContent, 'base64'));
  if (wav.channels !== 1) throw new Error(`${who}: expected mono audio`);
  const heard = await recognize(to16k(wav.pcm, wav.sampleRate), { ffmpeg: runFfmpeg, post: (url, body) => post(url, body, 'STT') });
  const end = r3(wav.pcm.length / 2 / wav.sampleRate);
  const { t, matched } = enTimes(built.words, heard, end, who, lang.wild);
  console.log(`${who}: matched ${matched} of ${built.count} words (${heard.length} heard)`);
  return { t, end, rate: wav.sampleRate, pcm: wav.pcm };
}

/** Record one passage in one language. Returns the manifest entry (or null when --out is used or nothing changed). */
async function record(n, lang, { out, stored }) {
  const who = lang.label(n);
  const errs = lang.validate(n);
  if (errs.length) throw new Error(`${who}:\n  ${errs.join('\n  ')}`);
  const built = lang.build(n);
  const src = lang.hash(built);
  if (!out && isUpToDate(stored, src, (rel) => existsSync(join(app, rel)))) { console.log(`${who}: up to date`); return null; }

  const { t, end, rate, pcm } = await lang.speak(built, lang, who);

  if (out) { encodeMp3(pcm, rate, out); console.log(`${who}: wrote ${out} (${end} s)`); return null; }
  mkdirSync(OUT_DIR, { recursive: true });
  const name = writeMp3(OUT_DIR, n, lang.key, pcm, rate);
  console.log(`${who}: ${name}, ${t.length} marks, ${end} s`);
  return { file: `audio/passages/${name}`, src, n: t.length, end, t };
}

const readContext = () => ({
  text: readJson(join(app, 'data/text.json')),
  lex: readJson(join(app, 'data/lexicon.json')),
  readings: readJson(join(scripts, 'audio-readings.json')),
});

const passageFile = (n) => {
  const pf = join(app, `data/passages/${pad(n)}.json`);
  return existsSync(pf) ? readJson(pf) : null;
};

function segmentsOf(n, text) {
  const t = text.find((e) => e.n === n);
  if (!t) throw new Error(`passage ${n}: not in text.json`);
  return segmentsFor(t, passageFile(n));
}

const renderingOf = (n) => passageFile(n)?.rendering ?? null;

/** --list N: every forced reading in passage N, for review before recording. No API call. */
function listForced(n) {
  const ctx = readContext();
  for (const r of forcedReadings(n, segmentsOf(n, ctx.text), ctx.readings)) {
    console.log(`${r.seg}:${r.k}\t${r.ch}\t${r.ctx}\t${r.py}\t${r.from}`);
  }
  return 0;
}

/** A passage number after a flag, or null. */
const numberAfter = (args, i) => (/^\d+$/.test(args[i + 1] ?? '') ? Number(args[i + 1]) : null);

export async function main(argv) {
  const args = argv.slice(2);
  const en = args.includes('--en');
  const all = args.includes('--all');
  const noForce = args.includes('--no-force');
  const oi = args.indexOf('--out');
  const out = oi >= 0 ? args[oi + 1] : null;
  const li = args.indexOf('--list');
  if (li >= 0) {
    const n = numberAfter(args, li);
    if (n == null || en) { console.error(USAGE); return 2; }
    return listForced(n);
  }
  const key = en ? 'en' : 'zh';
  const di = args.indexOf('--drop');
  if (di >= 0) {
    const n = numberAfter(args, di);
    if (n == null) { console.error(USAGE); return 2; }
    const m = loadManifest();
    const e = m[key][n];
    if (!e) { console.log(`passage ${n}: no ${key} entry in listen.json`); return 0; }
    delete m[key][n];
    saveManifest(m);
    for (const rel of [e.file, e.prev]) {
      const f = rel && join(app, rel);
      if (f && existsSync(f)) unlinkSync(f);
    }
    console.log(`passage ${n}: ${key} dropped`);
    return 0;
  }
  const skip = new Set(oi >= 0 ? [oi, oi + 1] : []);
  const nums = args.filter((a, i) => !skip.has(i) && /^\d+$/.test(a)).map(Number);
  if ((noForce || out) && !(noForce && out && nums.length === 1 && !en && !all)) {
    console.error('--no-force and --out go together, with exactly one passage number, Chinese only'); return 2;
  }
  if (all && nums.length) { console.error(USAGE); return 2; }

  const ctx = readContext();
  let lang;
  if (en) {
    lang = enLanguage(renderingOf, readJson(join(scripts, 'audio-en-lexicon.json')));
  } else {
    ctx.globalErrs = noForce ? [] : validateGlobalReadings(ctx.readings, ctx.lex); // once, not once per passage
    lang = zhLanguage(ctx, noForce);
  }
  const m = loadManifest();
  let list;
  if (nums.length) list = nums;
  else if (!all) list = Object.keys(m[key]).map(Number);
  else if (en) list = ctx.text.map((t) => t.n).filter((n) => renderingOf(n)?.length);
  else list = ctx.text.map((t) => t.n);
  let code = 0;
  for (const n of list) {
    try {
      const prev = m[key][n];
      const entry = await record(n, lang, { out, stored: prev });
      if (entry) {
        const fresh = loadManifest(); // keep other entries
        const next = withPrev(entry, prev, (rel) => existsSync(join(app, rel)));
        fresh[key][n] = next;
        saveManifest(fresh);
        removeOld(OUT_DIR, n, key, [next.file, next.prev].filter(Boolean).map((f) => f.split('/').pop()));
      }
    } catch (e) {
      console.error(e.message);
      code = 1;
    }
  }
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv);
}
