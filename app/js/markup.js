// `[[visible text|noteId]]` → tappable segments. Anything malformed stays literal.

const MARK = /\[\[([^\[\]|]+)\|([A-Za-z0-9_\-]+)\]\]/g;

export function parseMarked(s) {
  const out = [];
  let last = 0;
  for (const m of s.matchAll(MARK)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: m[1], note: m[2] });
    last = m.index + m[0].length;
  }
  if (last < s.length || out.length === 0) out.push({ text: s.slice(last) });
  return out;
}

export function noteIds(s) {
  return [...s.matchAll(MARK)].map((m) => m[2]);
}

const HAN = /\p{Script=Han}/u;
export const isHan = (ch) => HAN.test(ch);
export function hanChars(s) {
  return [...s].filter(isHan);
}

// Every Han character of a passage, in reading order. `k` is the code-point index in its
// segment (the key of zh[seg].gloss); `i` counts Han characters across the whole passage.
export function passageChars(segments) {
  const out = [];
  segments.forEach((seg, s) => {
    [...seg].forEach((ch, k) => { if (isHan(ch)) out.push({ ch, seg: s, k, i: out.length }); });
  });
  return out;
}

// The passage file's Chinese text wins over text.json (the two differ in punctuation).
export const segmentsFor = (text, rich) => text.zh.map((seg, i) => rich?.zh?.[i]?.text ?? seg);

/** The visible text of a rendering line: markup removed, note text kept. */
export const plainLine = (line) => parseMarked(line).map((t) => t.text).join('');

/** The words of a plain line with UTF-16 offsets. This is the only word rule; other modules call it. */
export function wordsOf(text) {
  return [...text.matchAll(/[A-Za-z0-9'’]+/g)].map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }));
}
