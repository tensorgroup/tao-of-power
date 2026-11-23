// Write app/data/text.json: the pinned Chinese, Wang Bi notes, and Legge for all 81 passages.
// Every passage can render from this alone; the rich passage files add the rest.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const zh = JSON.parse(readFileSync(new URL('sources/zh-wangbi.json', root)));
const legge = JSON.parse(readFileSync(new URL('sources/legge.json', root)));

const out = zh.map((ch, i) => ({
  n: ch.n,
  zh: ch.segments.map((s) => s.zh),
  wangbi: ch.segments.map((s) => s.wangbi || ''),
  legge: legge[i].paras,
}));
if (out.length !== 81 || out.some((x, i) => x.n !== i + 1 || legge[i].n !== i + 1)) throw new Error('source misaligned');
writeFileSync(new URL('app/data/text.json', root), JSON.stringify(out));
console.log(`text.json: ${out.length} passages, ${JSON.stringify(out).length} bytes`);
