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

// audio/index.json as the site serves it.
const list = (names) => ({ ok: true, json: async () => names });

// One sound at a time. A fresh module instance per test, because the index is cached per module.
let n = 0;
async function harness(fetchImpl, { playFails = false } = {}) {
  const saved = ['fetch', 'Audio', 'dispatchEvent', 'addEventListener', 'speechSynthesis', 'SpeechSynthesisUtterance']
    .map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const counts = { play: 0, pause: 0, sound: 0, speak: 0 };
  globalThis.fetch = fetchImpl || (async () => list(['dao4']));
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
  const { mod, counts, restore } = await harness(() => pending.then(() => list(['dao4'])));
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

/**
 * Like harness(), with an Audio whose play() stays pending until the test settles it, and rejects with
 * AbortError when pause() comes first (as browsers do). log: 'play:<src>', 'pause', 'speak:<text>', 'cancel'.
 */
async function pendingHarness({ abortOnPause = true } = {}) {
  const saved = ['fetch', 'Audio', 'dispatchEvent', 'addEventListener', 'speechSynthesis', 'SpeechSynthesisUtterance', 'document', 'Node']
    .map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const log = [];
  const audios = [];
  const spoken = [];
  globalThis.fetch = async () => list(['dao4', 'de2']);
  globalThis.Audio = class {
    constructor(src) { this.src = src; audios.push(this); }
    play() {
      log.push(`play:${this.src}`);
      return new Promise((resolve, reject) => { this.settle = resolve; this.abort = reject; });
    }
    pause() {
      log.push('pause');
      if (abortOnPause) this.abort?.(Object.assign(new Error('The play() request was interrupted by a call to pause().'), { name: 'AbortError' }));
    }
  };
  Object.defineProperty(globalThis, 'speechSynthesis', {
    value: { cancel() { log.push('cancel'); }, getVoices: () => [], speak(u) { log.push(`speak:${u.text}`); spoken.push(u); } }, configurable: true, writable: true,
  });
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  const et = new EventTarget();
  Object.defineProperty(globalThis, 'dispatchEvent', { value: et.dispatchEvent.bind(et), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'addEventListener', { value: et.addEventListener.bind(et), configurable: true, writable: true });
  // A minimal document: just enough for h() to build a button that can be clicked.
  class FakeNode {}
  class FakeEl extends FakeNode {
    constructor() { super(); this.attrs = {}; this.listeners = {}; this.kids = []; this.classes = new Set(); this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), contains: (c) => this.classes.has(c) }; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(t, f) { this.listeners[t] = f; }
    append(...n) { this.kids.push(...n); }
    click() { return this.listeners.click({ stopPropagation() {} }); }
  }
  globalThis.Node = FakeNode;
  globalThis.document = { createElement: () => new FakeEl(), createElementNS: () => new FakeEl(), createTextNode: (t) => ({ t }) };
  const mod = await import(`../app/js/audio.js?t=${++n}`);
  const restore = () => { for (const [k, d] of saved) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } };
  return { mod, log, audios, spoken, restore };
}
const turn = () => new Promise((r) => setImmediate(r));

test('a second quick tap stops the first; the first play\'s AbortError never speaks', async () => {
  const t = await pendingHarness();
  try {
    const first = t.mod.say('dào', '道');
    await turn();
    const second = t.mod.say('dé', '德');
    await turn();
    assert.equal(await first, false, 'the interrupted say plays nothing');
    t.audios[1].settle();
    assert.equal(await second, true);
    assert.ok(!t.log.some((l) => l.startsWith('speak:')), t.log.join(' '));
    assert.deepEqual(t.log.filter((l) => l.startsWith('play:')), ['play:audio/dao4.mp3', 'play:audio/de2.mp3']);
  } finally { t.restore(); }
});

test('a new tap cancels speech of the tap before', async () => {
  const t = await pendingHarness();
  try {
    await t.mod.say('lǜ', '律'); // no recording: the device voice
    t.log.length = 0;
    const p = t.mod.say('dào', '道');
    await turn();
    assert.deepEqual(t.log, ['cancel', 'play:audio/dao4.mp3'], 'the old speech is cancelled before the recording starts');
    t.audios[0].settle();
    await p;
  } finally { t.restore(); }
});

test('an older say whose play fails after a newer say started does not speak its character', async () => {
  const t = await pendingHarness({ abortOnPause: false });
  try {
    const first = t.mod.say('dào', '道');
    await turn();
    const second = t.mod.say('dé', '德');
    await turn();
    t.audios[0].abort(Object.assign(new Error('no supported source'), { name: 'NotSupportedError' }));
    assert.equal(await first, false);
    t.audios[1].settle();
    assert.equal(await second, true);
    assert.ok(!t.log.some((l) => l.startsWith('speak:')), t.log.join(' '));
  } finally { t.restore(); }
});

test('a play interrupted with no newer say (AbortError) is over: no device voice', async () => {
  const t = await pendingHarness();
  try {
    const p = t.mod.say('dào', '道');
    await turn();
    t.audios[0].abort(Object.assign(new Error('The play() request was interrupted by a new load request.'), { name: 'AbortError' }));
    assert.equal(await p, false);
    assert.ok(!t.log.some((l) => l.startsWith('speak:')), t.log.join(' '));
  } finally { t.restore(); }
});

test('a failed or non-ok recording list is retried at the next say', async () => {
  let loads = 0;
  const { mod, counts, restore } = await harness(async () => {
    loads++;
    if (loads === 1) throw new TypeError('Failed to fetch');
    if (loads === 2) return { ok: false, status: 503, json: async () => [] };
    return list(['dao4']);
  });
  try {
    assert.equal(await mod.say('dào', '道'), true);
    assert.deepEqual([counts.play, counts.speak], [0, 1], 'offline: the device voice');
    assert.equal(await mod.say('dào', '道'), true);
    assert.deepEqual([counts.play, counts.speak], [0, 2], 'a server error: the device voice again');
    assert.equal(await mod.say('dào', '道'), true);
    assert.deepEqual([counts.play, counts.speak], [1, 2], 'the list loads: the recording plays');
    await mod.say('dào', '道');
    assert.equal(loads, 3, 'a list that loaded is kept');
  } finally { restore(); }
});

test('sayButton marks the sound it started, also an utterance', async () => {
  const t = await pendingHarness();
  try {
    const one = t.mod.sayButton('dào', '道');
    const two = t.mod.sayButton('lǜ', '律'); // no recording: the device voice
    one.click();
    await turn();
    t.audios[0].settle();
    await turn();
    const a = t.audios[0];
    assert.equal(typeof a.onended, 'function');
    two.click();
    await turn();
    const u = t.spoken.at(-1);
    assert.ok(two.classList.contains('playing'));
    a.onended(); // the old recording ends: that is the first button's sound
    assert.deepEqual([one.classList.contains('playing'), two.classList.contains('playing')], [false, true]);
    u.onend(); // the device voice ends
    assert.equal(two.classList.contains('playing'), false);
  } finally { t.restore(); }
});
