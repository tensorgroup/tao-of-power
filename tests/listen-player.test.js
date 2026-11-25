import { test } from 'node:test';
import assert from 'node:assert/strict';

// listen.js keeps all DOM access inside functions, so it imports cleanly in Node.
const { indexAt, createPlayer } = await import('../app/js/listen.js');

test('indexAt: empty, before first, exact hit, between, after last', () => {
  assert.equal(indexAt([], 5), -1);
  const t = [0.5, 1.0, 1.5, 2.0];
  assert.equal(indexAt(t, 0.2), -1);
  assert.equal(indexAt(t, 0.5), 0);
  assert.equal(indexAt(t, 1.5), 2);
  assert.equal(indexAt(t, 1.2), 1);
  assert.equal(indexAt(t, 9), 3);
});

// An EventTarget that counts its listeners.
class Target extends EventTarget {
  constructor() { super(); this.count = 0; }
  addEventListener(type, fn, o) { this.count++; super.addEventListener(type, fn, o); }
  removeEventListener(type, fn, o) { this.count--; super.removeEventListener(type, fn, o); }
  fire(type) { this.dispatchEvent(new Event(type)); }
}

class FakeMedia extends Target {
  constructor() {
    super();
    this.paused = true; this.playbackRate = 1; this.defaultPlaybackRate = 1; this.preservesPitch = false;
    this.calls = { play: 0, pause: 0, load: 0, removeSrc: 0 };
  }
  play() { this.calls.play++; this.paused = false; this.fire('play'); return Promise.resolve(); }
  pause() { this.calls.pause++; if (!this.paused) { this.paused = true; this.fire('pause'); } }
  removeAttribute(name) { if (name === 'src') this.calls.removeSrc++; }
  load() { this.calls.load++; }
}

const cell = () => {
  const set = new Set();
  return { set, classList: { toggle: (c, on) => (on ? set.add(c) : set.delete(c)), remove: (...cs) => cs.forEach((c) => set.delete(c)) } };
};
const classes = (cells) => cells.map((c) => [...c.set].sort().join(' ') || '-');

function setup({ n = 3, rate } = {}) {
  const media = new FakeMedia();
  const cells = Array.from({ length: n }, cell);
  const frames = [];
  const events = new Target();
  const doc = new Target();
  doc.visibilityState = 'visible';
  const lock = { requests: 0, releases: 0 };
  const log = { stopSay: 0, track: [], states: [], index: [] };
  const store = new Map(rate ? [['tao-listen-rate', rate]] : []);
  let idx = -1;
  let sheet = false;
  const deps = {
    raf: (fn) => frames.push(fn),
    cancelRaf: () => { frames.length = 0; },
    isSheetOpen: () => sheet,
    events, doc,
    wakeLock: { request: () => { lock.requests++; return Promise.resolve({ release: () => { lock.releases++; return Promise.resolve(); } }); } },
    stopSay: () => { log.stopSay++; },
    track: (ev, d) => log.track.push([ev, d]),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  };
  const player = createPlayer({
    media, n: 7, cells, deps, indexNow: () => idx,
    onIndex: (i) => log.index.push(i), onState: (s) => log.states.push(s),
  });
  const step = () => { const q = frames.splice(0); q.forEach((f) => f()); };
  return { media, cells, frames, events, doc, lock, log, store, player, step, at: (i) => { idx = i; }, sheet: (v) => { sheet = v; } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('first toggle stops other sound, tracks once, and plays', async () => {
  const t = setup();
  t.player.toggle();
  assert.equal(t.log.stopSay, 1);
  assert.deepEqual(t.log.track, [['listen', 'zh 7']]);
  assert.equal(t.media.calls.play, 1);
  assert.equal(t.player.state, 'loading');
  t.media.fire('playing');
  assert.equal(t.player.state, 'playing');
  t.player.toggle();
  assert.equal(t.player.state, 'paused');
  t.player.toggle();
  assert.equal(t.media.calls.play, 2);
  assert.equal(t.log.track.length, 1);
});

test('classes follow indexNow, and onIndex fires on change only', () => {
  const t = setup();
  t.player.toggle();
  t.media.fire('playing');
  t.at(0); t.step();
  assert.deepEqual(classes(t.cells), ['now', '-', '-']);
  t.step();
  t.at(2); t.step();
  assert.deepEqual(classes(t.cells), ['done', 'done', 'now']);
  assert.deepEqual(t.log.index, [0, 2]);
  t.at(3); t.step();
  assert.deepEqual(classes(t.cells), ['done', 'done', 'done']);
  assert.deepEqual(t.log.index, [0, 2], 'onIndex is never called past the last cell');
});

test('an open sheet pauses, and later frames do not resume', () => {
  const t = setup();
  t.player.toggle();
  t.media.fire('playing');
  t.at(1); t.step();
  t.sheet(true); t.step();
  assert.equal(t.media.paused, true);
  assert.equal(t.player.state, 'paused');
  t.sheet(false); t.step(); t.step();
  assert.equal(t.media.calls.play, 1);
  assert.equal(t.player.state, 'paused');
});

test('tao:sound pauses', () => {
  const t = setup();
  t.player.toggle();
  t.media.fire('playing');
  t.events.fire('tao:sound');
  assert.equal(t.media.paused, true);
  assert.equal(t.player.state, 'paused');
});

test('wake lock: requested on playing, released on pause, asked again when visible', async () => {
  const t = setup();
  t.player.toggle();
  t.media.fire('playing');
  await tick();
  assert.equal(t.lock.requests, 1);
  t.player.toggle();
  assert.equal(t.lock.releases, 1);
  t.player.toggle();
  t.media.fire('playing');
  await tick();
  assert.equal(t.lock.requests, 2);
  t.doc.fire('visibilitychange');
  await tick();
  assert.equal(t.lock.requests, 2, 'a held lock is not asked for again');
});

test('hashchange stops: pause, src removed, load, release, no listeners left', async () => {
  const t = setup();
  t.player.toggle();
  t.media.fire('playing');
  await tick();
  t.at(1); t.step();
  t.events.fire('hashchange');
  assert.equal(t.media.paused, true);
  assert.equal(t.media.calls.removeSrc, 1);
  assert.equal(t.media.calls.load, 1);
  assert.equal(t.lock.releases, 1);
  assert.equal(t.events.count, 0);
  assert.equal(t.doc.count, 0);
  assert.equal(t.media.count, 0);
  assert.equal(t.frames.length, 0);
  assert.deepEqual(classes(t.cells), ['-', '-', '-']);
});

test('pagehide stops too', () => {
  const t = setup();
  t.player.toggle();
  t.events.fire('pagehide');
  assert.equal(t.media.calls.load, 1);
  assert.equal(t.events.count, 0);
});

test('ended clears the highlight and resets to idle', () => {
  const t = setup();
  t.player.toggle();
  t.media.fire('playing');
  t.at(1); t.step();
  t.media.paused = true;
  t.media.fire('pause');
  t.media.fire('ended');
  assert.deepEqual(classes(t.cells), ['-', '-', '-']);
  assert.equal(t.player.state, 'idle');
  assert.equal(t.log.states.at(-1), 'idle');
});

test('error state', () => {
  const t = setup();
  t.player.toggle();
  t.media.fire('error');
  assert.equal(t.player.state, 'error');
});

test('speed comes from storage and setRate keeps it', () => {
  const t = setup({ rate: '1.2' });
  assert.equal(t.media.playbackRate, 1.2);
  assert.equal(t.media.preservesPitch, true);
  t.player.setRate(0.8);
  assert.equal(t.media.playbackRate, 0.8);
  assert.equal(t.media.defaultPlaybackRate, 0.8);
  assert.equal(t.store.get('tao-listen-rate'), '0.8');
  assert.equal(setup({ rate: 'junk' }).media.playbackRate, 1);
});
