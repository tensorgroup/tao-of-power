// Print each segment of chapter N with code-point offsets, for writing gloss keys.
// Usage: node scripts/show-offsets.mjs 4
import { readFileSync } from 'node:fs';
const n = Number(process.argv[2]);
const src = JSON.parse(readFileSync(new URL('../sources/zh-wangbi.json', import.meta.url)));
src[n - 1].segments.forEach((s, i) => {
  console.log(`zh[${i}]: ${s.zh}`);
  console.log('   ' + [...s.zh].map((c, k) => `${k}:${c}`).join(' '));
});
