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
