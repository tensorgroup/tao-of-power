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
 * True when a word of the query (not a stop word, 2+ letters) is one whole token of the model. A made-up
 * word splits into word pieces ("zzqxv" is z ##z ##q ##x ##v), and the mean of those pieces lands near random
 * texts with a meaning score as high as a real query's, so meaning-only results show only for a query with a known word.
 */
export function knowsAWord(model, query) {
  if (!model) return false;
  return preTokenize(query).some((w) => w.length >= 2 && /\p{L}/u.test(w) && !STOP.has(w) && model.ids.has(w));
}

/** The lowest score of a result that no query word is in (meaning only). */
export const MEANING_FLOOR = 0.2;

/**
 * The results worth showing, from rank()'s [doc, score, exact]: within 60 % of the top score and over a floor of
 * 0.12. The cutoff is relative because scores vary a lot by query (a Chinese term scores only on exact matches).
 * A meaning-only result (exact false) shows only when meaning is true (knowsAWord) and its score is MEANING_FLOOR
 * or more. The 60 % counts only the results that may show.
 */
export function visibleResults(ranked, { meaning = true } = {}) {
  const may = ranked.filter(([, s, exact = true]) => s > 0.01 && (exact || (meaning && s >= MEANING_FLOOR)));
  const top = may[0]?.[1] || 0;
  return may.filter(([, s]) => s >= Math.max(0.12, top * 0.6));
}

/**
 * Rank documents (model may be null: keyword part only). vecs: Int8Array (n x dim); texts: lower-cased search text per doc.
 * Score = cosine similarity + a keyword bonus (exact terms, with a bonus for the title).
 * Each result is [doc, score, exact]: exact when a query keyword is in the doc's text.
 */
export function rank(model, query, { vecs, dim, texts, titles }, { limit = 40, filter } = {}) {
  const qv = model ? embed(model, query) : null;
  const terms = keywords(query);
  const n = texts.length;
  const out = [];
  for (let d = 0; d < n; d++) {
    if (filter && !filter(d)) continue;
    let s = 0, exact = false;
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
      exact = hit > 0;
    }
    out.push([d, s, exact]);
  }
  out.sort((a, b) => b[1] - a[1]);
  return out.slice(0, limit);
}

/** How many results the Search page shows. */
export const SHOW = 40;

/**
 * The results the Search page shows: rank every document, keep what visibleResults() allows, then the first
 * `show`. rank() scores and sorts every document anyway, so the whole list costs only the filter. Cutting to `show` before visibleResults() would drop an exact word match ranked past it under
 * meaning-only results that visibleResults() then removes ("Handan" showed "No close matches").
 */
export function searchResults(model, query, index, { filter = null, show = SHOW } = {}) {
  const ranked = rank(model, query, index, { limit: Infinity, filter });
  return visibleResults(ranked, { meaning: knowsAWord(model, query) }).slice(0, show);
}

/**
 * A short hash of the bytes of an ArrayBuffer (FNV-1a, 32 bits, 8 hex digits): index.json names the vecs.bin it
 * was built with (vecsHash). Not a security hash: it tells two builds apart, with no async call.
 */
export function bytesHash(buf) {
  const b = new Uint8Array(buf);
  let x = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) x = Math.imul(x ^ b[i], 0x01000193) >>> 0;
  return x.toString(16).padStart(8, '0');
}

const mismatch = (message) => Object.assign(new Error(`search index: ${message}`), { code: 'index-mismatch' });

/**
 * The index as rank() reads it, from index.json (ix) and the ArrayBuffer of vecs.bin. Throws (code 'index-mismatch')
 * when vecs.bin does not hold count x dim values or does not hash to the vecsHash that index.json names: the two
 * files come from different builds (one of them cached), and a pair of the same size would score each doc on
 * another doc's vector.
 */
export function indexFromFiles(ix, buf) {
  const vecs = new Int8Array(buf);
  if (vecs.length !== ix.count * ix.dim) throw mismatch(`vecs.bin holds ${vecs.length} values; index.json needs ${ix.count} x ${ix.dim}`);
  const got = bytesHash(buf);
  if (got !== ix.vecsHash) throw mismatch(`vecs.bin hashes to ${got}; index.json names ${ix.vecsHash ?? 'no hash'}`);
  return { docs: ix.docs, dim: ix.dim, vecs, texts: ix.text, titles: ix.docs.map((d) => d.title.toLowerCase()) };
}

/**
 * A loader for the index files. It loads once; a failed load is forgotten, so the next call tries again (for
 * example, back online). When the two files do not pair, forget(paths) drops both from the cache and both are
 * fetched once more from the server; only a second mismatch is an error.
 */
export function makeIndexLoader({ fetchFn = (...a) => fetch(...a), forget = async () => {}, dir = 'data/search/' } = {}) {
  const files = [`${dir}index.json`, `${dir}vecs.bin`];
  const get = (path, as, init) => fetchFn(path, init).then((r) => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r[as](); });
  const loadPair = (init) => Promise.all([get(files[0], 'json', init), get(files[1], 'arrayBuffer', init)]).then(([ix, buf]) => indexFromFiles(ix, buf));
  let indexP = null;
  return () => {
    indexP ||= loadPair()
      .catch(async (e) => {
        if (e?.code !== 'index-mismatch') throw e;
        await forget(files);
        return loadPair({ cache: 'reload' });
      })
      .catch((e) => { indexP = null; throw e; });
    return indexP;
  };
}
