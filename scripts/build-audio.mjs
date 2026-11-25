// Record the Listen read-aloud audio: Google TTS (SSML marks) -> one MP3 per passage + timings in listen.json.
// Usage: node scripts/build-audio.mjs [N...] | --drop N | --list N | --no-force --out <path> N
import { readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { segmentsFor } from '../app/js/markup.js';
import { SETTINGS, resolveReading, buildSsml, sourceHash, validateReadings, validateGlobalReadings, forcedReadings } from './lib/listen-ssml.mjs';

const app = fileURLToPath(new URL('../app/', import.meta.url));
const scripts = fileURLToPath(new URL('./', import.meta.url));
const MANIFEST = join(app, 'data/listen.json');
const OUT_DIR = join(app, 'audio/passages');
const ENDPOINT = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';
const USAGE = 'Usage: npm run audio -- [N...] | --drop N | --list N | --no-force --out <path> N';
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

/** Delete passage n's MP3s in dir except the basenames in keep (the new file and prev). */
export function removeOld(dir, n, keep) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (f.startsWith(`${pad(n)}.zh.`) && f.endsWith('.mp3') && !keep.includes(f)) unlinkSync(join(dir, f));
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

/** Encode to NN.zh.tmp.mp3, then rename to NN.zh.<h8>.mp3. The tmp file never stays behind. */
export function writeMp3(dir, n, pcm, rate, encode = encodeMp3) {
  const tmp = join(dir, `${pad(n)}.zh.tmp.mp3`);
  try {
    encode(pcm, rate, tmp);
    const name = `${pad(n)}.zh.${sha(readFileSync(tmp)).slice(0, 8)}.mp3`;
    renameSync(tmp, join(dir, name));
    return name;
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

let token;
const getToken = () => (token ??= execFileSync('gcloud', ['--configuration=tao', 'auth', 'print-access-token'], { encoding: 'utf8' }).trim());

async function synth(ssml) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'x-goog-user-project': 'tao-of-power', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { ssml },
      voice: { languageCode: 'cmn-CN', name: SETTINGS.voice },
      audioConfig: { audioEncoding: SETTINGS.encoding, speakingRate: SETTINGS.rate },
      enableTimePointing: ['SSML_MARK'],
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function encodeMp3(pcm, sampleRate, outPath) {
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', '-',
    '-codec:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3', outPath], { input: pcm, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

/** Record one passage. Returns the manifest entry (or null when --out is used or nothing changed). */
async function record(n, ctx, { noForce, out, stored }) {
  const segments = segmentsOf(n, ctx.text);
  const errs = [...ctx.globalErrs, ...validateReadings(n, segments, ctx.readings, ctx.lex)];
  if (errs.length && !noForce) throw new Error(`passage ${n} readings:\n  ${errs.join('\n  ')}`);
  const forced = noForce ? () => null : (c) => resolveReading(n, c, ctx.readings);
  const parts = buildSsml(segments, forced);
  const src = sourceHash(parts) + (noForce ? ':plain' : '');
  if (!out && isUpToDate(stored, src, (rel) => existsSync(join(app, rel)))) { console.log(`passage ${n}: up to date`); return null; }

  const got = [];
  let rate = 0;
  for (const part of parts) {
    const json = await synth(part.ssml);
    const tp = json.timepoints ?? [];
    const names = tp.map((x) => x.markName);
    const want = Array.from({ length: part.count }, (_, j) => String(part.first + j));
    if (tp.length !== part.count || names.some((nm, j) => nm !== want[j])) {
      throw new Error(`passage ${n}: got ${tp.length} marks, wanted ${part.count} (${part.first}..${part.first + part.count - 1}); nothing written`);
    }
    const wav = parseWav(Buffer.from(json.audioContent, 'base64'));
    if (wav.channels !== 1) throw new Error(`passage ${n}: expected mono audio`);
    if (rate && rate !== wav.sampleRate) throw new Error(`passage ${n}: sample rate changed between parts`);
    rate = wav.sampleRate;
    got.push({ times: tp.map((x) => x.timeSeconds), samples: wav.pcm.length / 2, pcm: wav.pcm });
  }
  const { t, end } = joinTimes(got, rate);
  for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] < 0.08) console.warn(`passage ${n}: marks ${i - 1}-${i} are ${r3(t[i] - t[i - 1])} s apart`);

  const pcm = Buffer.concat(got.map((g) => g.pcm));
  if (out) { encodeMp3(pcm, rate, out); console.log(`passage ${n}: wrote ${out} (${end} s)`); return null; }
  mkdirSync(OUT_DIR, { recursive: true });
  const name = writeMp3(OUT_DIR, n, pcm, rate);
  console.log(`passage ${n}: ${name}, ${t.length} marks, ${end} s`);
  return { file: `audio/passages/${name}`, src, n: t.length, end, t };
}

const readContext = () => ({
  text: readJson(join(app, 'data/text.json')),
  lex: readJson(join(app, 'data/lexicon.json')),
  readings: readJson(join(scripts, 'audio-readings.json')),
});

function segmentsOf(n, text) {
  const t = text.find((e) => e.n === n);
  if (!t) throw new Error(`passage ${n}: not in text.json`);
  const pf = join(app, `data/passages/${pad(n)}.json`);
  return segmentsFor(t, existsSync(pf) ? readJson(pf) : null);
}

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
  const noForce = args.includes('--no-force');
  const oi = args.indexOf('--out');
  const out = oi >= 0 ? args[oi + 1] : null;
  const li = args.indexOf('--list');
  if (li >= 0) {
    const n = numberAfter(args, li);
    if (n == null) { console.error(USAGE); return 2; }
    return listForced(n);
  }
  const di = args.indexOf('--drop');
  if (di >= 0) {
    const n = numberAfter(args, di);
    if (n == null) { console.error(USAGE); return 2; }
    const m = loadManifest();
    const e = m.zh[n];
    if (!e) { console.log(`passage ${n}: not in listen.json`); return 0; }
    delete m.zh[n];
    saveManifest(m);
    for (const rel of [e.file, e.prev]) {
      const f = rel && join(app, rel);
      if (f && existsSync(f)) unlinkSync(f);
    }
    console.log(`passage ${n}: dropped`);
    return 0;
  }
  const skip = new Set(oi >= 0 ? [oi, oi + 1] : []);
  const nums = args.filter((a, i) => !skip.has(i) && /^\d+$/.test(a)).map(Number);
  if ((noForce || out) && !(noForce && out && nums.length === 1)) { console.error('--no-force and --out go together, with exactly one passage number'); return 2; }

  const ctx = readContext();
  ctx.globalErrs = validateGlobalReadings(ctx.readings, ctx.lex); // once, not once per passage
  const m = loadManifest();
  const list = nums.length ? nums : Object.keys(m.zh).map(Number);
  let code = 0;
  for (const n of list) {
    try {
      const prev = m.zh[n];
      const entry = await record(n, ctx, { noForce, out, stored: prev });
      if (entry) {
        const fresh = loadManifest(); // keep other entries
        const next = withPrev(entry, prev, (rel) => existsSync(join(app, rel)));
        fresh.zh[n] = next;
        saveManifest(fresh);
        removeOld(OUT_DIR, n, [next.file, next.prev].filter(Boolean).map((f) => f.split('/').pop()));
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
