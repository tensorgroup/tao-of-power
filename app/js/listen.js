// Listen: play a passage's recording and light each character as it is spoken.
// createPlayer() holds the logic and touches no DOM, so tests can drive it with fakes.
// listenRow() builds the button and speed chips and wires the player to the browser.
import { h, fill } from './ui.js';
import { stopSay } from './audio.js';
import { sheetOpen } from './sheet.js';
import { track } from './track.js';

/** Seconds added to currentTime before the lookup. Tune on the phone (speaker, Bluetooth). */
export const LEAD = 0;
const RATE_KEY = 'tao-listen-rate';
const RATES = [[0.8, '0.8×'], [1, '1×'], [1.2, '1.2×']];
const LABEL = { idle: 'Listen', loading: 'Loading…', playing: 'Pause', paused: 'Resume', error: 'Listen' };
const GLYPH = { idle: '▶ ', loading: '', playing: '❚❚ ', paused: '▶ ', error: '▶ ' };
const ERROR_TEXT = 'Audio did not load. Check the connection and try again.';

/** The last i with times[i] <= now, or -1. times is sorted. */
export function indexAt(times, now) {
  let lo = 0, hi = times.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= now) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

function savedRate(storage) {
  try {
    const r = Number(storage?.getItem(RATE_KEY));
    return RATES.some(([v]) => v === r) ? r : 1;
  } catch { return 1; }
}

/**
 * The playback controller. deps: { raf, cancelRaf, isSheetOpen, events, doc, wakeLock, stopSay, track, storage }.
 * events gets tao:sound, hashchange, pagehide; doc gets visibilitychange.
 */
export function createPlayer({ media, n, indexNow, cells, deps, onIndex = () => {}, onState = () => {} }) {
  let state = 'idle';
  let tracked = false;
  let stopped = false;
  let frame = null;
  let last = -1;
  let rate = savedRate(deps.storage);
  let lock = null, lockPending = false, lockWanted = false;
  const added = [];

  const on = (target, type, fn) => { target.addEventListener(type, fn); added.push([target, type, fn]); };
  const set = (s) => { if (s !== state) { state = s; onState(s); } };

  function applyRate() {
    media.defaultPlaybackRate = rate; // load() resets playbackRate to this
    media.playbackRate = rate;
    media.preservesPitch = true;
  }

  function mark(i) {
    if (i === last) return;
    last = i;
    cells.forEach((c, j) => { c.classList.toggle('now', j === i); c.classList.toggle('done', j < i); });
    if (i >= 0 && i < cells.length) onIndex(i); // past the end: all done, no current cell
  }
  function clearMarks() {
    last = -1;
    for (const c of cells) c.classList.remove('now', 'done');
  }

  function loop() {
    frame = null;
    if (deps.isSheetOpen()) { media.pause(); return; } // a note opened: pause, never resume by itself
    mark(indexNow());
    frame = deps.raf(loop);
  }
  function startLoop() { if (frame == null) frame = deps.raf(loop); }
  function stopLoop() { if (frame != null) deps.cancelRaf(frame); frame = null; }

  function holdLock() {
    lockWanted = true;
    if (!deps.wakeLock || lock || lockPending) return;
    lockPending = true;
    Promise.resolve().then(() => deps.wakeLock.request('screen')).then((l) => {
      lockPending = false;
      if (lockWanted && !stopped) lock = l; else l?.release?.()?.catch?.(() => {});
    }, () => { lockPending = false; }); // no lock: play anyway
  }
  function dropLock() {
    lockWanted = false;
    const l = lock;
    lock = null;
    try { l?.release?.()?.catch?.(() => {}); } catch { /* already released */ }
  }

  function play() {
    Promise.resolve(media.play()).catch((e) => { if (e?.name !== 'AbortError' && !stopped) set('error'); });
  }

  on(media, 'play', () => { if (state !== 'playing') set('loading'); });
  on(media, 'waiting', () => set('loading'));
  on(media, 'playing', () => { set('playing'); holdLock(); startLoop(); });
  on(media, 'pause', () => { set('paused'); dropLock(); stopLoop(); });
  on(media, 'ended', () => { stopLoop(); dropLock(); clearMarks(); set('idle'); });
  on(media, 'error', () => { stopLoop(); dropLock(); set('error'); });
  on(deps.events, 'tao:sound', () => { if (state === 'playing' || state === 'loading') media.pause(); });
  on(deps.events, 'hashchange', stop);
  on(deps.events, 'pagehide', stop);
  on(deps.doc, 'visibilitychange', () => {
    if (deps.doc.visibilityState !== 'visible' || state !== 'playing') return;
    if (lock?.released) lock = null; // the browser drops the lock when the page hides
    holdLock();
  });
  applyRate();

  function toggle() {
    if (stopped) return;
    if (state === 'playing' || state === 'loading') { media.pause(); return; }
    if (state === 'idle') {
      deps.stopSay();
      if (!tracked) { tracked = true; deps.track('listen', 'zh ' + n); }
    }
    if (state === 'error') { media.load(); applyRate(); }
    set('loading');
    play();
  }

  function setRate(r) {
    rate = r;
    applyRate();
    try { deps.storage?.setItem(RATE_KEY, String(r)); } catch { /* private mode */ }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    for (const [t, type, fn] of added.splice(0)) t.removeEventListener(type, fn);
    media.pause();
    media.removeAttribute('src');
    media.load();
    dropLock();
    stopLoop();
    clearMarks();
    set('idle');
  }

  return {
    toggle, setRate, stop,
    get state() { return state; },
    get rate() { return rate; },
    get stopped() { return stopped; },
  };
}

/** The Listen button and speed chips, or null when the timings do not match the cells. */
export function listenRow({ n, file, times, end, cells, onIndex, onStart, onStop }) {
  if (!Array.isArray(times) || times.length !== cells.length) return null;
  let player = null;
  let started = false;

  const btn = h('button', { type: 'button', class: 'btn', onclick: press });
  const chips = h('div', { class: 'filters', role: 'group', 'aria-label': 'Speed' });
  const err = h('p', { class: 'small muted', role: 'status', text: ERROR_TEXT });
  chips.hidden = true;
  err.hidden = true;

  function label(s) {
    btn.textContent = GLYPH[s] + LABEL[s];
    btn.setAttribute('aria-label', LABEL[s]);
    err.hidden = s !== 'error';
  }
  function drawChips() {
    fill(chips, ...RATES.map(([r, text]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(player?.rate === r), text,
      onclick: () => { player?.setRate(r); drawChips(); },
    })));
  }
  function finish() {
    if (started) { started = false; onStop?.(); }
  }

  function press() {
    if (!player || player.stopped) {
      const media = new Audio();
      media.preload = 'none';
      media.src = file;
      player = createPlayer({
        media, n, cells,
        indexNow: () => {
          const t = media.currentTime + LEAD;
          return Number.isFinite(end) && t >= end ? cells.length : indexAt(times, t);
        },
        deps: {
          raf: (fn) => requestAnimationFrame(fn),
          cancelRaf: (id) => cancelAnimationFrame(id),
          isSheetOpen: sheetOpen,
          events: window,
          doc: document,
          wakeLock: navigator.wakeLock ?? null,
          stopSay, track,
          storage: (() => { try { return localStorage; } catch { return null; } })(),
        },
        onIndex,
        onState: (s) => {
          label(s);
          if (s === 'playing' && !started) { started = true; onStart?.(); }
          if (s === 'idle') {
            finish();
            if (player?.stopped) { player = null; chips.hidden = true; } // a later press starts fresh
          }
        },
      });
      drawChips();
      chips.hidden = false;
    }
    player.toggle();
  }

  label('idle');
  return h('div', { class: 'listen-row' }, btn, chips, err);
}
