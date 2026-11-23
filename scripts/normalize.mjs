// One orthography for comparing passage text with the pinned source.
export const NORMALIZE = {
  爲: '為', 强: '強', 眞: '真', 敎: '教', 兊: '兌', 无: '無', 歎: '嘆', 静: '靜',
  恆: '恒', 箇: '個', 乃: '乃',
};

const HAN = /\p{Script=Han}/u;

export function normalize(s) {
  return [...s].map((c) => NORMALIZE[c] ?? c).join('');
}

/** Han characters only, normalized — for text equality checks. */
export function hanOnly(s) {
  return [...normalize(s)].filter((c) => HAN.test(c)).join('');
}
