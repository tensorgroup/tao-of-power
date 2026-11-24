import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// audio.js imports ui.js, which only touches the DOM when called; stub nothing.
const { candidates } = await import('../app/js/audio.js');
const root = new URL('../', import.meta.url);

test('pinyin with tone marks maps to recording names', () => {
  assert.equal(candidates('dào')[0], 'dao4');
  assert.equal(candidates('lǜ')[0], 'lv4');
  assert.equal(candidates('de')[0], 'de5');
  assert.ok(candidates('jù').includes('jv4'));
  assert.ok(candidates('ǎn').includes('_an3') || candidates('ǎn').includes('an3'));
});

test('almost every lexicon reading has a recording', () => {
  const lex = JSON.parse(readFileSync(new URL('app/data/lexicon.json', root)));
  const have = new Set(JSON.parse(readFileSync(new URL('app/audio/index.json', root))));
  const missing = new Set();
  for (const e of Object.values(lex)) for (const py of e.py || []) if (!candidates(py).some((c) => have.has(c))) missing.add(py);
  assert.ok(missing.size <= 12, `readings without a recording: ${[...missing].join(', ')}`);
});
