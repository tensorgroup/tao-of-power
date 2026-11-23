// The 64-stick method: secure randomness, faithful counting.
// Lines: 0 solid, 1 one break, 2 two breaks. Arrays run bottom → top.

const STICKS = 64;
const TWO32 = 2 ** 32;

const cryptoFill = (arr) => globalThis.crypto.getRandomValues(arr);

/** Unbiased integer in [0, maxExclusive) by rejection sampling over Uint32. */
export function randInt(maxExclusive, rng = cryptoFill) {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > TWO32) {
    throw new RangeError('maxExclusive out of range');
  }
  const limit = TWO32 - (TWO32 % maxExclusive); // values >= limit are biased
  const buf = new Uint32Array(1);
  for (;;) {
    rng(buf);
    if (buf[0] < limit) return buf[0] % maxExclusive;
  }
}

/** Two distinct cut points in 1..63 → three non-empty bundles (right, middle, left). */
export function splitSticks(rng = cryptoFill) {
  const a = 1 + randInt(STICKS - 1, rng);
  let b;
  do { b = 1 + randInt(STICKS - 1, rng); } while (b === a);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return [lo, hi - lo, STICKS - hi];
}

/** Count by threes; a remainder of 0 sets aside one stick instead. */
export function bundleRemainder(size) {
  return size % 3 || 1;
}

/** Total of set-aside sticks (3, 4, 5) → line value (0, 1, 2). */
export function lineFromTotal(total) {
  if (total < 3 || total > 5) throw new RangeError(`impossible total ${total}`);
  return total - 3;
}

export function castLine(rng = cryptoFill) {
  const bundles = splitSticks(rng);
  const total = bundles.reduce((s, x) => s + bundleRemainder(x), 0);
  return { bundles, total, line: lineFromTotal(total) };
}

export function drawTetragram(rng = cryptoFill) {
  const casts = [castLine(rng), castLine(rng), castLine(rng), castLine(rng)];
  const lines = casts.map((c) => c.line);
  return { casts, lines, n: passageNumber(lines) };
}

/** Tai Xuan order: top line most significant. lines = [L1 bottom, L2, L3, L4 top]. */
export function passageNumber(lines) {
  const [l1, l2, l3, l4] = lines;
  return 1 + 27 * l4 + 9 * l3 + 3 * l2 + l1;
}

export function linesFor(n) {
  let k = n - 1;
  const l1 = k % 3; k = (k - l1) / 3;
  const l2 = k % 3; k = (k - l2) / 3;
  const l3 = k % 3; k = (k - l3) / 3;
  return [l1, l2, l3, k];
}
