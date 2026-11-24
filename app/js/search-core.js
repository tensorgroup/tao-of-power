// Static-embedding search: a BERT WordPiece tokenizer and a Model2Vec-style lookup.
// A text's vector is the mean of its tokens' vectors, normalized. No neural network
// runs here: the model is a table of 4-bit token vectors (app/model/, see
// scripts/vendor-search-model.py). Pure functions; used by the browser and by
// scripts/build-search.mjs so that queries and documents share one code path.

const isCjk = (o) => (o >= 0x4E00 && o <= 0x9FFF) || (o >= 0x3400 && o <= 0x4DBF) || (o >= 0x20000 && o <= 0x2A6DF)
  || (o >= 0x2A700 && o <= 0x2CEAF) || (o >= 0xF900 && o <= 0xFAFF) || (o >= 0x2F800 && o <= 0x2FA1F);
const isPunct = (ch) => {
  const o = ch.codePointAt(0);
  if ((o >= 33 && o <= 47) || (o >= 58 && o <= 64) || (o >= 91 && o <= 96) || (o >= 123 && o <= 126)) return true;
  return /\p{P}/u.test(ch);
};
const isControl = (ch) => (ch === '\t' || ch === '\n' || ch === '\r') ? false : /[\p{Cc}\p{Cf}]/u.test(ch);
const isSpace = (ch) => /\s/u.test(ch);

/** BertNormalizer (clean text, space around CJK, lowercase, strip accents) + BertPreTokenizer. */
export function preTokenize(text) {
  let s = '';
  for (const ch of String(text)) {
    const o = ch.codePointAt(0);
    if (o === 0 || o === 0xFFFD || isControl(ch)) continue;
    if (isSpace(ch)) s += ' ';
    else if (isCjk(o)) s += ` ${ch} `;
    else s += ch;
  }
  s = s.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
  const words = [];
  for (const w of s.split(' ')) {
    if (!w) continue;
    let cur = '';
    for (const ch of w) {
      if (isPunct(ch)) { if (cur) words.push(cur); words.push(ch); cur = ''; } else cur += ch;
    }
    if (cur) words.push(cur);
  }
  return words;
}

/** Greedy longest-match WordPiece. A word that cannot be split becomes [UNK]. */
export function wordPiece(word, vocab, unk = '[UNK]') {
  const chars = [...word];
  if (chars.length > 100) return [unk];
  const out = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length, piece = null;
    while (start < end) {
      const sub = (start > 0 ? '##' : '') + chars.slice(start, end).join('');
      if (vocab.has(sub)) { piece = sub; break; }
      end--;
    }
    if (piece == null) return [unk];
    out.push(piece);
    start = end;
  }
  return out;
}

export function tokenize(text, vocab) {
  return preTokenize(text).flatMap((w) => wordPiece(w, vocab));
}

/** meta: the model JSON; buf: ArrayBuffer of the model .bin. */
export function loadModel(meta, buf) {
  const { dim, rows } = meta;
  const scale = new Float32Array(buf, 0, rows);
  const packed = new Uint8Array(buf, rows * 4, rows * dim / 2);
  const ids = new Map(meta.tokens.map((t, i) => [t, i]));
  return { dim, rows, scale, packed, ids, vocab: ids, unk: meta.unk };
}

/** Normalized Float32Array for a text, or null when no token is known. */
export function embed(model, text) {
  const { dim, scale, packed, ids, unk } = model;
  const v = new Float32Array(dim);
  let n = 0;
  for (const t of tokenize(text, ids)) {
    const r = ids.get(t);
    if (r == null || r === unk) continue;
    const s = scale[r], base = r * dim / 2;
    for (let j = 0; j < dim / 2; j++) {
      const b = packed[base + j];
      const lo = b & 15, hi = b >> 4;
      v[2 * j] += (lo > 7 ? lo - 16 : lo) * s;
      v[2 * j + 1] += (hi > 7 ? hi - 16 : hi) * s;
    }
    n++;
  }
  if (!n) return null;
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

/** Quantize a normalized vector to int8 (x127) for the document index. */
export function toInt8(v) {
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
  return q;
}

const STOP = new Set('the a an and or of to in on at for with by from is are was were be been it its this that these those what which who whom how why when where do does did not no yes i me my you your we our they them their he she his her as if so but than then there here about into over under up down out very can could would should will just'.split(' '));

/** Query terms for the keyword part: words of 3+ letters (not stop words) and single Han characters. */
export function keywords(q) {
  const lower = String(q).toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
  const words = (lower.match(/[\p{L}\p{N}]+/gu) || []).flatMap((w) => (/\p{Script=Han}/u.test(w) ? [...w] : [w]));
  return [...new Set(words.filter((w) => /\p{Script=Han}/u.test(w) || (w.length >= 3 && !STOP.has(w))))];
}

/**
 * Rank documents (model may be null: keyword part only). vecs: Int8Array (n x dim); texts: lower-cased search text per doc.
 * Score = cosine similarity + a keyword bonus (exact terms, with a bonus for the title).
 */
export function rank(model, query, { vecs, dim, texts, titles }, { limit = 40, filter } = {}) {
  const qv = model ? embed(model, query) : null;
  const terms = keywords(query);
  const n = texts.length;
  const out = [];
  for (let d = 0; d < n; d++) {
    if (filter && !filter(d)) continue;
    let s = 0;
    if (qv) {
      const off = d * dim;
      for (let i = 0; i < dim; i++) s += qv[i] * vecs[off + i];
      s /= 127;
    }
    if (terms.length) {
      let hit = 0, inTitle = 0;
      for (const t of terms) {
        if (texts[d].includes(t)) hit++;
        if (titles[d].includes(t)) inTitle++;
      }
      s += 0.12 * (hit / terms.length) + 0.06 * (inTitle / terms.length);
    }
    out.push([d, s]);
  }
  out.sort((a, b) => b[1] - a[1]);
  return out.slice(0, limit);
}
