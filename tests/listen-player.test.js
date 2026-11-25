import { test } from 'node:test';
import assert from 'node:assert/strict';

// listen.js keeps all DOM access inside functions, so it imports cleanly in Node.
const { indexAt, createPlayer, followTarget, followAllowed, gestureLive, rowView } = await import('../app/js/listen.js');
const { wordCell } = await import('../app/js/words.js');

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
  const attrs = new Map();
  return {
    set, attrs,
    classList: { toggle: (c, on) => (on ? set.add(c) : set.delete(c)), remove: (...cs) => cs.forEach((c) => set.delete(c)) },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
  };
};
const current = (cells) => cells.map((c) => c.attrs.get('aria-current') ?? '-');
const classes = (cells) => cells.map((c) => [...c.set].sort().join(' ') || '-');

function setup({ n = 3, rate, kind, id = 'row-a', lead, cells: given } = {}) {
  const media = new FakeMedia();
  const cells = given ?? Array.from({ length: n }, cell);
  const frames = [];
  const events = new Target();
  const doc = new Target();
  doc.visibilityState = 'visible';
  const lock = { requests: 0, releases: 0, last: null };
  const log = { stopSay: 0, track: [], states: [], index: [], listen: [], leads: [] };
  // Bypass the count: the stop tests check that the player leaves no listeners of its own.
  EventTarget.prototype.addEventListener.call(events, 'tao:listen', (e) => log.listen.push(e.detail));
  const store = new Map(rate ? [['tao-listen-rate', rate]] : []);
  let idx = -1;
  let sheet = false;
  const deps = {
    raf: (fn) => frames.push(fn),
    cancelRaf: () => { frames.length = 0; },
    isSheetOpen: () => sheet,
    events, doc,
    wakeLock: {
      request: () => {
        lock.requests++;
        lock.last = { released: false, release() { lock.releases++; this.released = true; return Promise.resolve(); } };
        return Promise.resolve(lock.last);
      },
    },
    stopSay: () => { log.stopSay++; },
    track: (ev, d) => log.track.push([ev, d]),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  };
  const player = createPlayer({
    media, n: 7, cells, deps, kind, id, lead, indexNow: (l) => { log.leads.push(l); return idx; },
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

test('resume after a tao:sound pause stops other sound again, but tracks once', () => {
  const t = setup();
  t.player.toggle();
  t.media.fire('playing');
  t.events.fire('tao:sound');
  assert.equal(t.player.state, 'paused');
  t.player.toggle();
  assert.equal(t.log.stopSay, 2);
  assert.equal(t.log.track.length, 1);
});

test('retry after an error stops other sound too', () => {
  const t = setup();
  t.player.toggle();
  t.media.fire('error');
  t.player.toggle();
  assert.equal(t.log.stopSay, 2);
  assert.equal(t.media.calls.load, 1);
  assert.equal(t.log.track.length, 1);
});

test('aria-current is on the now cell only', () => {
  const t = setup();
  t.player.toggle();
  t.media.fire('playing');
  t.at(1); t.step();
  assert.deepEqual(current(t.cells), ['-', 'true', '-']);
  t.at(2); t.step();
  assert.deepEqual(current(t.cells), ['-', '-', 'true']);
  t.at(3); t.step();
  assert.deepEqual(current(t.cells), ['-', '-', '-']);
  t.at(0); t.step();
  t.media.fire('ended');
  assert.deepEqual(current(t.cells), ['-', '-', '-']);
});

test('wake lock: a lock the browser released while loading is asked for again on playing', async () => {
  const t = setup();
  t.player.toggle();
  t.media.fire('playing');
  await tick();
  assert.equal(t.lock.requests, 1);
  t.media.fire('waiting'); // loading; then the page hides and the browser drops the lock
  t.lock.last.released = true;
  t.doc.fire('visibilitychange'); // visible again, still loading
  await tick();
  t.media.fire('playing');
  await tick();
  assert.equal(t.lock.requests, 2);
});

test('rowView: labels with a text-style play glyph, language-named aria, error text only in error', () => {
  assert.deepEqual(rowView('idle'), { text: '\u25B6\uFE0E Listen', aria: 'Listen to the Chinese', error: '' });
  assert.deepEqual(rowView('loading'), { text: 'Loading…', aria: 'Loading…', error: '' });
  assert.deepEqual(rowView('playing'), { text: '❚❚ Pause', aria: 'Pause the Chinese', error: '' });
  assert.deepEqual(rowView('paused'), { text: '\u25B6\uFE0E Resume', aria: 'Resume the Chinese', error: '' });
  assert.deepEqual(rowView('error'), { text: '\u25B6\uFE0E Listen', aria: 'Listen to the Chinese', error: 'Audio did not load. Check the connection and try again.' });
  assert.deepEqual(rowView('idle', 'zh'), rowView('idle'));
});

test('rowView en: same visible text, aria names the English', () => {
  assert.deepEqual(rowView('idle', 'en'), { text: '\u25B6\uFE0E Listen', aria: 'Listen to the English', error: '' });
  assert.equal(rowView('playing', 'en').aria, 'Pause the English');
  assert.equal(rowView('paused', 'en').aria, 'Resume the English');
  assert.equal(rowView('error', 'en').aria, 'Listen to the English');
  assert.equal(rowView('playing', 'en').text, '❚❚ Pause');
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

// A 300px box at x 50..350; content can scroll 0..1000 (positive scrollLeft, reading moves toward 0).
const box = { boxLeft: 50, boxRight: 350, maxScroll: 1000, margin: 60 };

test('followTarget: a cell inside the box leaves scrollLeft unchanged', () => {
  assert.equal(followTarget({ ...box, cellLeft: 200, cellRight: 230, scrollLeft: 500 }), 500);
  assert.equal(followTarget({ ...box, cellLeft: 110, cellRight: 140, scrollLeft: 500 }), 500); // exactly at the margin
});

test('followTarget: past the left margin, the cell lands at boxLeft + margin', () => {
  // cellLeft 80 is 30px short of 110; scrolling left by 30 moves the content right by 30.
  assert.equal(followTarget({ ...box, cellLeft: 80, cellRight: 110, scrollLeft: 500 }), 470);
  assert.equal(followTarget({ ...box, cellLeft: -400, cellRight: -370, scrollLeft: 900 }), 390);
});

test('followTarget: past the right edge, the cell comes back inside', () => {
  assert.equal(followTarget({ ...box, cellLeft: 400, cellRight: 430, scrollLeft: 100 }), 180);
});

test('followTarget: clamped to [0, maxScroll]', () => {
  assert.equal(followTarget({ ...box, cellLeft: -400, cellRight: -370, scrollLeft: 100 }), 0);
  assert.equal(followTarget({ ...box, cellLeft: 2000, cellRight: 2030, scrollLeft: 900 }), 1000);
});

test('followAllowed: never during a gesture; only 4 s after the last manual scroll', () => {
  assert.equal(followAllowed(100000, 0, true), false);
  assert.equal(followAllowed(10000, 6100, false), false); // 3.9 s
  assert.equal(followAllowed(10000, 6000, false), true); // 4 s
  assert.equal(followAllowed(10000, -Infinity, false), true); // never scrolled by hand
});

test('followAllowed: a gesture older than 10 s counts as ended (a lost end event)', () => {
  assert.equal(followAllowed(19900, -Infinity, true, 10000), false); // 9.9 s: still a gesture
  assert.equal(followAllowed(20000, -Infinity, true, 10000), true); // 10 s: stale
  assert.equal(followAllowed(20000, 17000, true, 10000), false); // stale, but a scroll 3 s ago still holds the follow
});

test('gestureLive: down and younger than 10 s', () => {
  assert.equal(gestureLive(19900, true, 10000), true);
  assert.equal(gestureLive(20000, true, 10000), false);
  assert.equal(gestureLive(10500, false, 10000), false);
});

const listenEvent = (id) => new CustomEvent('tao:listen', { detail: id });

test("another row's tao:listen pauses a playing player", () => {
  const t = setup();
  t.player.toggle();
  t.media.fire('playing');
  t.events.dispatchEvent(listenEvent('row-b'));
  assert.equal(t.media.paused, true);
  assert.equal(t.player.state, 'paused');
});

test("another row's tao:listen pauses a loading player", () => {
  const t = setup();
  t.player.toggle();
  assert.equal(t.player.state, 'loading');
  t.events.dispatchEvent(listenEvent('row-b'));
  assert.equal(t.media.calls.pause, 1);
  assert.equal(t.player.state, 'paused');
});

test('its own tao:listen does not pause it', () => {
  const t = setup();
  t.player.toggle();
  assert.deepEqual(t.log.listen, ['row-a'], 'start dispatches tao:listen with its id');
  t.media.fire('playing');
  t.events.dispatchEvent(listenEvent('row-a'));
  assert.equal(t.player.state, 'playing');
  assert.equal(t.media.calls.pause, 0);
});

test('tao:listen from another row leaves an idle or paused player alone', () => {
  const t = setup();
  t.events.dispatchEvent(listenEvent('row-b'));
  assert.equal(t.media.calls.pause, 0);
  assert.equal(t.player.state, 'idle');
});

test('resume and retry dispatch tao:listen before play', () => {
  const t = setup();
  const playsAtListen = [];
  EventTarget.prototype.addEventListener.call(t.events, 'tao:listen', () => playsAtListen.push(t.media.calls.play));
  t.player.toggle();
  t.media.fire('playing');
  t.player.toggle(); // pause
  t.player.toggle(); // resume
  assert.deepEqual(t.log.listen, ['row-a', 'row-a']);
  t.media.fire('error');
  t.player.toggle(); // retry
  assert.deepEqual(t.log.listen, ['row-a', 'row-a', 'row-a']);
  assert.deepEqual(playsAtListen, [0, 1, 2], 'each dispatch comes before its media.play()');
  assert.equal(t.log.stopSay, 3, 'stopSay still runs on every start');
});

test("kind 'en' tracks en N once", () => {
  const t = setup({ kind: 'en' });
  t.player.toggle();
  t.media.fire('playing');
  t.player.toggle();
  t.player.toggle();
  assert.deepEqual(t.log.track, [['listen', 'en 7']]);
});

test('indexNow gets lead (0 by default)', () => {
  const a = setup();
  a.player.toggle(); a.media.fire('playing'); a.step();
  assert.deepEqual(a.log.leads, [0]);
  const b = setup({ lead: 0.15 });
  b.player.toggle(); b.media.fire('playing'); b.step();
  assert.deepEqual(b.log.leads, [0.15]);
});

// A span fake with a real class set and attributes, for wordCell.
const span = () => {
  const set = new Set();
  const attrs = new Map();
  return {
    set, attrs,
    classList: {
      add: (...cs) => cs.forEach((c) => set.add(c)),
      remove: (...cs) => cs.forEach((c) => set.delete(c)),
      toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    getBoundingClientRect: () => ({ left: 0, right: 0 }),
  };
};

function wordSetup() {
  const spans = [[span(), span()], [span()]]; // word 0 is split over two spans
  return { spans, t: setup({ kind: 'en', cells: spans.map(wordCell) }) };
}
const spanClasses = (spans) => spans.flat().map((s) => [...s.set].sort().join(' ') || '-');

test('wordCell cells: both spans of a split word light, and ended clears both', () => {
  const { spans, t } = wordSetup();
  t.player.toggle();
  t.media.fire('playing');
  t.at(0); t.step();
  assert.deepEqual(spanClasses(spans), ['now', 'now', '-']);
  assert.equal(spans[0][0].attrs.get('aria-current'), 'true');
  t.at(1); t.step();
  assert.deepEqual(spanClasses(spans), ['done', 'done', 'now']);
  t.media.fire('ended');
  assert.deepEqual(spanClasses(spans), ['-', '-', '-']);
  assert.equal(spans.flat().some((s) => s.attrs.has('aria-current')), false);
});

test('wordCell cells: stop() clears both spans', () => {
  const { spans, t } = wordSetup();
  t.player.toggle();
  t.media.fire('playing');
  t.at(0); t.step();
  assert.deepEqual(spanClasses(spans), ['now', 'now', '-']);
  t.player.stop();
  assert.deepEqual(spanClasses(spans), ['-', '-', '-']);
  assert.equal(spans.flat().some((s) => s.attrs.has('aria-current')), false);
});

test('stop() removes the tao:listen listener too', () => {
  const t = setup();
  const before = t.events.count;
  t.player.stop();
  assert.equal(t.events.count, before - 4, 'tao:sound, tao:listen, hashchange, pagehide');
});
