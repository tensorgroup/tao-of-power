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

// One sound at a time. A fresh module instance per test, because the index is cached per module.
let n = 0;
async function harness(fetchImpl, { playFails = false } = {}) {
  const saved = ['fetch', 'Audio', 'dispatchEvent', 'addEventListener', 'speechSynthesis', 'SpeechSynthesisUtterance']
    .map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const counts = { play: 0, pause: 0, sound: 0, speak: 0 };
  globalThis.fetch = fetchImpl || (async () => ({ json: async () => ['dao4'] }));
  globalThis.Audio = class {
    play() { counts.play++; return playFails ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(); }
    pause() { counts.pause++; }
  };
  Object.defineProperty(globalThis, 'speechSynthesis', {
    value: { cancel() {}, getVoices: () => [], speak() { counts.speak++; } }, configurable: true, writable: true,
  });
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  const et = new EventTarget();
  Object.defineProperty(globalThis, 'dispatchEvent', { value: et.dispatchEvent.bind(et), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'addEventListener', { value: et.addEventListener.bind(et), configurable: true, writable: true });
  et.addEventListener('tao:sound', () => counts.sound++);
  const mod = await import(`../app/js/audio.js?t=${++n}`);
  const restore = () => { for (const [k, d] of saved) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } };
  return { mod, counts, restore };
}

test('say announces tao:sound once and plays', async () => {
  const { mod, counts, restore } = await harness();
  try {
    assert.equal(await mod.say('dào', '道'), true);
    assert.equal(counts.sound, 1);
    assert.equal(counts.play, 1);
  } finally { restore(); }
});

test('stopSay pauses the current sound', async () => {
  const { mod, counts, restore } = await harness();
  try {
    await mod.say('dào', '道');
    const before = counts.pause;
    mod.stopSay();
    assert.equal(counts.pause, before + 1);
  } finally { restore(); }
});

test('stopSay while the index is loading cancels that say', async () => {
  let release;
  const pending = new Promise((r) => { release = r; });
  const { mod, counts, restore } = await harness(() => pending.then(() => ({ json: async () => ['dao4'] })));
  try {
    const p = mod.say('dào', '道');
    mod.stopSay();
    release();
    assert.equal(await p, false);
    assert.equal(counts.play, 0);
  } finally { restore(); }
});

test('a failed play falls back to speech and announces tao:sound only once', async () => {
  const { mod, counts, restore } = await harness(undefined, { playFails: true });
  try {
    assert.equal(await mod.say('dào', '道'), true);
    assert.equal(counts.speak, 1);
    assert.equal(counts.sound, 1);
  } finally { restore(); }
});

test('a tao:sound listener that stops sound cancels the say before it plays', async () => {
  const { mod, counts, restore } = await harness();
  try {
    globalThis.addEventListener('tao:sound', () => mod.stopSay(), { once: true });
    assert.equal(await mod.say('dào', '道'), false);
    assert.equal(counts.play, 0);
  } finally { restore(); }
});
