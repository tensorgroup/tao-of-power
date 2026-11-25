// Check the Listen recordings: each entry matches its passage text and readings, its timings make sense, and no stray MP3 is left.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, basename } from 'node:path';
import { segmentsFor } from '../app/js/markup.js';
import { resolveReading, buildSsml, sourceHash, validateReadings } from './lib/listen-ssml.mjs';

const app = fileURLToPath(new URL('../app/', import.meta.url));
const scripts = fileURLToPath(new URL('./', import.meta.url));

/** Return a list of error strings; an empty list means the recordings are good. `mp3s` holds file basenames. */
export function checkListen({ manifest, segmentsOf, readings, lex, exists, mp3s }) {
  const errs = [];
  const named = new Set();
  for (const [key, e] of Object.entries(manifest.zh ?? {})) {
    const n = Number(key);
    const segments = segmentsOf(n);
    named.add(basename(e.file));
    const bad = validateReadings(n, segments, readings, lex);
    errs.push(...bad);
    if (!bad.length) {
      const src = sourceHash(buildSsml(segments, (c) => resolveReading(n, c, readings)));
      if (e.src !== src) errs.push(`Passage ${n} text or readings changed after the recording. Run \`npm run audio -- ${n}\`, or \`npm run audio -- --drop ${n}\`.`);
    }
    if (e.t.length !== e.n) errs.push(`Passage ${n}: t has ${e.t.length} times, but n is ${e.n}.`);
    for (let i = 1; i < e.t.length; i++) {
      if (!(e.t[i] > e.t[i - 1])) { errs.push(`Passage ${n}: t does not increase at mark ${i}.`); break; }
    }
    if (e.t.length && !(e.end > e.t[e.t.length - 1])) errs.push(`Passage ${n}: end (${e.end}) is not after the last mark (${e.t[e.t.length - 1]}).`);
    if (!exists(e.file)) errs.push(`Passage ${n}: file ${e.file} does not exist.`);
  }
  for (const f of mp3s) if (!named.has(f)) errs.push(`audio/passages/${f} is not named by any entry in listen.json.`);
  return errs;
}

function main() {
  const mf = join(app, 'data/listen.json');
  if (!existsSync(mf)) { console.log('no recordings'); return 0; }
  const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
  const text = readJson(join(app, 'data/text.json'));
  const segmentsOf = (n) => {
    const pf = join(app, `data/passages/${String(n).padStart(2, '0')}.json`);
    return segmentsFor(text[n - 1], existsSync(pf) ? readJson(pf) : null);
  };
  const dir = join(app, 'audio/passages');
  const errs = checkListen({
    manifest: readJson(mf),
    segmentsOf,
    readings: readJson(join(scripts, 'audio-readings.json')),
    lex: readJson(join(app, 'data/lexicon.json')),
    exists: (rel) => existsSync(join(app, rel)),
    mp3s: existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.mp3')) : [],
  });
  for (const e of errs) console.error(e);
  console.log(errs.length ? `audio check: ${errs.length} error(s)` : 'audio check: ok');
  return errs.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
