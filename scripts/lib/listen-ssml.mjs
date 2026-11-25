// Pure helpers for the Listen read-aloud audio: SSML parts, reading choices, source hash.
import { createHash } from 'node:crypto';
import { isHan, passageChars } from '../../app/js/markup.js';

export const SETTINGS = Object.freeze({ voice: 'cmn-CN-Wavenet-B', rate: 0.8, encoding: 'LINEAR16', mp3: 'mono-48k' });

const LIMIT = 4500;
const KEEP = new Set([...'，。；：、！？「」『』（）《》,.;:!?']);
const MAP = { '﹗': '！', '﹑': '、', '﹕': '：' };
const CLAUSE_END = new Set([...'，；。：！？']);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
export const escapeXml = (s) => s.replace(/[&<>]/g, (c) => ESC[c]);
const PINYIN = /^[a-z]+[1-5]$/;
// Like stripTone in check-content.mjs, but ǖǘǚǜ also become v (NFD would turn them into u).
const stripTone = (s) => s.replace(/[üǖǘǚǜ]/g, 'v').normalize('NFD').replace(/[̀-ͯ]/g, '');

const AT_KEY = /^\d+:\d+:\d+$/;

/** The forced reading of one character and where it came from ('at', 'chars', 'extra'), or null. */
function readingOf(n, c, readings) {
  if (readings.engine.includes(c.ch)) return null;
  const at = readings.at[`${n}:${c.seg}:${c.k}`]?.py;
  if (at != null) return { py: at, from: 'at' };
  if (readings.chars[c.ch] != null) return { py: readings.chars[c.ch], from: 'chars' };
  if (readings.extra[c.ch]?.py != null) return { py: readings.extra[c.ch].py, from: 'extra' };
  return null;
}

export function resolveReading(n, c, readings) {
  return readingOf(n, c, readings)?.py ?? null;
}

/** Every forced character of passage n: { seg, k, ch, ctx, py, from }. ctx is up to 4 characters each side. */
export function forcedReadings(n, segments, readings) {
  const rows = [];
  for (const c of passageChars(segments)) {
    const r = readingOf(n, c, readings);
    if (!r) continue;
    const cps = [...segments[c.seg]];
    rows.push({ seg: c.seg, k: c.k, ch: c.ch, ctx: cps.slice(Math.max(0, c.k - 4), c.k + 5).join(''), ...r });
  }
  return rows;
}

export function needsDecision(ch, lex, readings) {
  if (readings.engine.includes(ch)) return false;
  return (lex[ch]?.py?.length ?? 0) > 1 || !!readings.extra[ch];
}

export function buildSsml(segments, forced) {
  const clauses = []; // { text, count }
  let cur = { text: '', count: 0 };
  let i = 0;
  const close = () => { if (cur.text) clauses.push(cur); cur = { text: '', count: 0 }; };
  segments.forEach((seg, s) => {
    [...seg].forEach((raw, k) => {
      if (raw === ' ' || raw === '　') return;
      const ch = MAP[raw] ?? raw;
      if (isHan(ch)) {
        const py = forced({ ch, seg: s, k, i });
        const body = py ? `<phoneme alphabet="pinyin" ph="${py}">${ch}</phoneme>` : ch;
        cur.text += `<mark name="${i}"/>${body}`;
        cur.count++;
        i++;
      } else if (ESC[ch]) {
        cur.text += escapeXml(ch);
      } else if (KEEP.has(ch)) {
        cur.text += ch;
        if (CLAUSE_END.has(ch)) close();
      } else {
        throw new Error(`passage text has unexpected character: ${raw}`);
      }
    });
    close();
  });
  return packClauses(clauses);
}

/** Pack clauses ({ text, count } = SSML body and its mark count) into <speak> parts under the byte limit. */
export function packClauses(clauses) {
  const overhead = Buffer.byteLength('<speak></speak>');
  const parts = [];
  let body = '', count = 0, first = 0;
  const flush = () => {
    if (!body) return;
    parts.push({ ssml: `<speak>${body}</speak>`, first, count });
    first += count; body = ''; count = 0;
  };
  for (const cl of clauses) {
    const size = Buffer.byteLength(cl.text);
    if (size + overhead > LIMIT) throw new Error(`one clause is over ${LIMIT} bytes: ${cl.text.slice(0, 40)}`);
    if (body && Buffer.byteLength(body) + size + overhead > LIMIT) flush();
    body += cl.text; count += cl.count;
  }
  flush();
  return parts;
}

/** SHA-256 over the part texts and the settings object, nothing else. */
export function hashParts(parts, settings) {
  const h = createHash('sha256');
  for (const p of parts) h.update(p.ssml);
  h.update(JSON.stringify(settings));
  return h.digest('hex');
}

export const sourceHash = (parts) => hashParts(parts, SETTINGS);

/** Push an error when py is not numbered pinyin, or (unless exempt) not a lexicon syllable of ch. */
function checkPy(errs, lex, where, ch, py, exempt) {
  if (!PINYIN.test(py)) { errs.push(`${where}: "${py}" is not numbered pinyin`); return; }
  const toneless = new Set((lex[ch]?.py ?? []).map(stripTone));
  if (!exempt && !toneless.has(py.slice(0, -1))) errs.push(`${where}: "${py}" is not a lexicon syllable of ${ch}`);
}

/** The checks that do not depend on a passage: chars, extra, and the shape of at keys. Run once. */
export function validateGlobalReadings(readings, lex) {
  const errs = [];
  const engine = new Set(readings.engine);
  for (const key of Object.keys(readings.at)) {
    if (!AT_KEY.test(key)) errs.push(`at ${key}: key must be N:seg:k (three whole numbers)`);
  }
  for (const [ch, py] of Object.entries(readings.chars)) {
    if (engine.has(ch)) errs.push(`chars ${ch}: ${ch} is an engine character`);
    checkPy(errs, lex, `chars ${ch}`, ch, py, false);
  }
  for (const [ch, e] of Object.entries(readings.extra)) {
    checkPy(errs, lex, `extra ${ch}`, ch, e.py, !!e.why);
  }
  return errs;
}

/** The checks for one passage: every character that needs a decision has one, and its at entries fit the text. */
export function validateReadings(n, segments, readings, lex) {
  const errs = [];
  const engine = new Set(readings.engine);

  for (const c of passageChars(segments)) {
    if (needsDecision(c.ch, lex, readings) && resolveReading(n, c, readings) == null) {
      errs.push(`passage ${n} ${c.seg}:${c.k} ${c.ch}: needs a reading decision`);
    }
  }
  for (const [key, e] of Object.entries(readings.at)) {
    if (!AT_KEY.test(key)) continue; // validateGlobalReadings reports it
    const [kn, kseg, kk] = key.split(':');
    if (Number(kn) !== n) continue;
    const seg = Number(kseg), k = Number(kk);
    const where = `at ${key}`;
    const ch = [...(segments[seg] ?? '')][k];
    if (ch !== e.ch) { errs.push(`${where}: character at that place is ${ch ?? 'nothing'}, not ${e.ch}`); continue; }
    if (engine.has(e.ch)) errs.push(`${where}: ${e.ch} is an engine character`);
    if (e.ctx != null) {
      const cps = [...segments[seg]], ctx = [...e.ctx];
      let ok = false;
      for (let o = Math.max(0, k - ctx.length + 1); o <= k && !ok; o++) {
        ok = ctx.every((x, j) => cps[o + j] === x);
      }
      if (!ok) errs.push(`${where}: ctx "${e.ctx}" does not cover position ${k}`);
    }
    checkPy(errs, lex, where, e.ch, e.py, false);
  }
  return errs;
}
