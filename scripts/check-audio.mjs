// Check the Listen recordings: each entry matches its passage text and readings, its timings make sense, and no stray MP3 is left.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, basename } from 'node:path';
import { segmentsFor, passageChars } from '../app/js/markup.js';
import { resolveReading, buildSsml, sourceHash, validateReadings, validateGlobalReadings } from './lib/listen-ssml.mjs';
import { enSource, enSourceHash } from './lib/listen-en.mjs';

const app = fileURLToPath(new URL('../app/', import.meta.url));
const scripts = fileURLToPath(new URL('./', import.meta.url));

/** English word starts closer than this (s) are an error. */
const MIN_EN_GAP = 0.03;

/** The 8 hex digits in a recording's name (NN.<zh|en>.<h8>.mp3), or null. */
const nameHash = (file) => /\.([0-9a-f]{8})\.mp3$/.exec(file)?.[1] ?? null;

/**
 * Return a list of error strings; an empty list means the recordings are good.
 * `mp3s` holds file basenames; `exists(rel)` and `hashOf(rel)` (SHA-256 hex) take app-relative paths.
 * `renderingOf(n)` gives passage n's English lines (or null) and `ipa` the romanized-word table; both are used only for `en` entries.
 * `passages` lists the passage numbers in text.json: each needs a `zh` entry, and each with a rendering an `en` entry.
 */
export function checkListen({ manifest, passages = [], segmentsOf, renderingOf, ipa, readings, lex, exists, hashOf, mp3s }) {
  const global = validateGlobalReadings(readings, lex);
  const errs = [...global];
  const named = new Set();
  // A named file must exist, and its bytes must hash to its name.
  const checkFile = (n, what, file) => {
    named.add(basename(file));
    if (!exists(file)) { errs.push(`Passage ${n}: ${what} ${file} does not exist.`); return; }
    const want = nameHash(file);
    const got = hashOf(file)?.slice(0, 8);
    if (got !== want) errs.push(`Passage ${n}: ${file} hashes to ${got}, not the ${want} in its name.`);
  };
  const checkFiles = (n, e) => {
    checkFile(n, 'file', e.file);
    if (e.prev != null) checkFile(n, 'prev', e.prev);
  };
  for (const n of passages) {
    if (!manifest.zh?.[n]) errs.push(`Passage ${n} has no Chinese recording. Run \`npm run audio -- ${n}\`.`);
    if (renderingOf?.(n)?.length && !manifest.en?.[n]) errs.push(`Passage ${n} has no English recording. Run \`npm run audio -- --en ${n}\`.`);
  }
  // n and t match the passage's count of units (characters or words), t starts at 0 or later and increases, end is after the last mark.
  const checkEntry = (who, n, e, count, unit) => {
    if (e.t.length !== e.n) errs.push(`${who}: t has ${e.t.length} times, but n is ${e.n}.`);
    else if (e.n !== count) errs.push(`${who}: n is ${e.n} and t has ${e.t.length} times, but the passage has ${count} ${unit}.`);
    if (e.t.length && !(e.t[0] >= 0)) errs.push(`${who}: the first time (${e.t[0]}) is before 0.`);
    for (let i = 1; i < e.t.length; i++) {
      if (!(e.t[i] > e.t[i - 1])) { errs.push(`${who}: t does not increase at mark ${i}.`); break; }
    }
    if (e.t.length && !(e.end > e.t[e.t.length - 1])) errs.push(`${who}: end (${e.end}) is not after the last mark (${e.t[e.t.length - 1]}).`);
    checkFiles(n, e);
  };
  for (const [key, e] of Object.entries(manifest.zh ?? {})) {
    const n = Number(key);
    const segments = segmentsOf(n);
    const bad = validateReadings(n, segments, readings, lex);
    errs.push(...bad);
    if (!bad.length && !global.length) {
      const src = sourceHash(buildSsml(segments, (c) => resolveReading(n, c, readings)));
      if (e.src !== src) errs.push(`Passage ${n} text or readings changed after the recording. Run \`npm run audio -- ${n}\`, or \`npm run audio -- --drop ${n}\`.`);
    }
    checkEntry(`Passage ${n}`, n, e, passageChars(segments).length, 'characters');
  }
  for (const [key, e] of Object.entries(manifest.en ?? {})) {
    const n = Number(key);
    const who = `Passage ${n} English`;
    const rendering = renderingOf(n);
    if (!rendering?.length) { errs.push(`${who}: the passage has no rendering.`); checkFiles(n, e); continue; }
    const source = enSource(rendering, ipa);
    if (e.src !== enSourceHash(source)) {
      errs.push(`${who} changed after the recording. Run \`npm run audio -- --en ${n}\`, or \`npm run audio -- --en --drop ${n}\`.`);
    }
    checkEntry(who, n, e, source.count, 'words');
    // build-audio spreads close starts (spreadTimes): two words must not light at once.
    for (let i = 1; i < e.t.length; i++) {
      const d = e.t[i] - e.t[i - 1];
      if (d < MIN_EN_GAP) { errs.push(`${who}: words ${i - 1} and ${i} start ${Number(d.toFixed(3))} s apart (under ${MIN_EN_GAP} s).`); break; }
    }
  }
  for (const f of mp3s) if (!named.has(f)) errs.push(`audio/passages/${f} is not named by any entry in listen.json.`);
  return errs;
}

function main() {
  const mf = join(app, 'data/listen.json');
  if (!existsSync(mf)) { console.log('no recordings'); return 0; }
  const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
  const text = readJson(join(app, 'data/text.json'));
  const passageFile = (n) => {
    const pf = join(app, `data/passages/${String(n).padStart(2, '0')}.json`);
    return existsSync(pf) ? readJson(pf) : null;
  };
  const segmentsOf = (n) => segmentsFor(text[n - 1], passageFile(n));
  const dir = join(app, 'audio/passages');
  const errs = checkListen({
    manifest: readJson(mf),
    passages: text.map((_, i) => i + 1),
    segmentsOf,
    renderingOf: (n) => passageFile(n)?.rendering ?? null,
    ipa: readJson(join(scripts, 'audio-en-lexicon.json')),
    readings: readJson(join(scripts, 'audio-readings.json')),
    lex: readJson(join(app, 'data/lexicon.json')),
    exists: (rel) => existsSync(join(app, rel)),
    hashOf: (rel) => createHash('sha256').update(readFileSync(join(app, rel))).digest('hex'),
    mp3s: existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.mp3')) : [],
  });
  for (const e of errs) console.error(e);
  console.log(errs.length ? `audio check: ${errs.length} error(s)` : 'audio check: ok');
  return errs.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
