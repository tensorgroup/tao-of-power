// Listen: play a passage's recording and light each character as it is spoken.
// createPlayer() holds the logic and touches no DOM, so tests can drive it with fakes.
// listenRow() builds the button and speed chips and wires the player to the browser.
import { h, fill } from './ui.js';
import { stopSay } from './audio.js';
import { sheetOpen } from './sheet.js';
import { track } from './track.js';

/** Seconds added to currentTime before the lookup. Tune on the phone (speaker, Bluetooth). */
export const LEAD = 0;
// One speed per language. The stage 1 key (Chinese only) is still read as the Chinese default.
const RATE_KEY = (kind) => 'tao-listen-rate-' + kind;
const OLD_RATE_KEY = 'tao-listen-rate';
const RATES = [[0.8, '0.8×'], [1, '1×'], [1.2, '1.2×']];
const LABEL = {
  idle: (l) => 'Listen in ' + l, loading: () => 'Loading…', playing: () => 'Pause', paused: () => 'Resume', error: (l) => 'Listen in ' + l,
};
// U+FE0E asks for the text form of ▶, so Android does not draw an emoji.
const PLAY = '\u25B6\uFE0E ';
const GLYPH = { idle: PLAY, loading: '', playing: '❚❚ ', paused: PLAY, error: PLAY };
const ERROR_TEXT = (l) => l + ' audio did not load. Check the connection and try again.';
const LANGUAGE = { zh: 'Chinese', en: 'English' };
const ARIA = {
  idle: (l) => 'Listen to the ' + l, loading: (l) => 'Loading the ' + l + '…', playing: (l) => 'Pause the ' + l + ' reading',
  paused: (l) => 'Resume the ' + l + ' reading', error: (l) => 'Listen to the ' + l,
};

/**
 * What the row shows in a state: button text, button aria-label, the error line (empty
 * unless error), and the speed group's aria-label. All name the language; kind is 'zh' or 'en'.
 */
export function rowView(s, kind = 'zh') {
  const l = LANGUAGE[kind];
  return { text: GLYPH[s] + LABEL[s](l), aria: ARIA[s](l), error: s === 'error' ? ERROR_TEXT(l) : '', speed: l + ' speed' };
}

/** The last i with times[i] <= now, or -1. times is sorted. */
export function indexAt(times, now) {
  let lo = 0, hi = times.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= now) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** Manual scrolls pause the column follow for this long (ms). */
const FOLLOW_PAUSE = 4000;

/**
 * The scrollLeft that keeps a cell in view: at least margin px inside the box's left edge
 * (the "← more" fade sits there, and reading moves left), and inside its right edge.
 * Positive scrollLeft: a larger value moves the content left. Clamped to [0, maxScroll].
 */
export function followTarget({ cellLeft, cellRight, boxLeft, boxRight, scrollLeft, maxScroll, margin }) {
  let next = scrollLeft;
  if (cellLeft < boxLeft + margin) next -= boxLeft + margin - cellLeft;
  else if (cellRight > boxRight) next += cellRight - boxRight;
  return Math.min(Math.max(next, 0), Math.max(maxScroll, 0));
}

/**
 * Pixels to scroll the window so a line stays in view: at least margin px below the
 * sticky bar (or the visual viewport top, whichever is lower) and above the view bottom.
 * 0 when the line is inside. A line taller than the space keeps its top in view.
 */
export function pageFollowDelta({ top, bottom, barBottom, viewTop, viewBottom, margin }) {
  const upper = Math.max(barBottom, viewTop) + margin;
  const lower = viewBottom - margin;
  if (top < upper) return top - upper;
  if (bottom > lower) return Math.min(bottom - lower, top - upper);
  return 0;
}

/**
 * The English page follow, once per spoken word. line: the word's line index; last: the line
 * the follow last took; held: true after a manual scroll; visible: the line is on screen
 * (lineOnScreen); gesture: a touch or pointer is down. Scroll only when the line changes.
 * A manual scroll holds the follow until the spoken line is on screen again (or the reader
 * presses the row's button, which the caller handles); there is no timed pull back.
 * Returns the next { scroll, held, last }.
 */
export function pageFollowStep({ line, last, held, visible, gesture }) {
  if (gesture) return { scroll: false, held, last };
  if (held) return visible ? { scroll: false, held: false, last: line } : { scroll: false, held: true, last };
  return line === last ? { scroll: false, held: false, last } : { scroll: true, held: false, last: line };
}

/** True when some part of the line is below the sticky bar (or the view top, whichever is lower) and above the view bottom. */
export function lineOnScreen({ top, bottom, barBottom, viewTop, viewBottom }) {
  return bottom > Math.max(barBottom, viewTop) && top < viewBottom;
}

/** A gesture older than this counts as ended (ms): a lost end event must not stop the follow for good. */
const GESTURE_STALE = 10000;

/**
 * Follow only when no gesture is under way and the last manual scroll is 4 s old.
 * gestureStart (when the gesture began) lets a gesture whose end event was lost expire.
 */
export function followAllowed(now, lastManual, gestureActive, gestureStart = now) {
  return !gestureLive(now, gestureActive, gestureStart) && now - lastManual >= FOLLOW_PAUSE;
}

/** True while a gesture is down and younger than 10 s. */
export function gestureLive(now, gestureActive, gestureStart) {
  return gestureActive && now - gestureStart < GESTURE_STALE;
}

function savedRate(storage, kind) {
  const known = (v) => v != null && RATES.some(([x]) => x === Number(v));
  try {
    const r = storage?.getItem(RATE_KEY(kind));
    if (known(r)) return Number(r);
    const old = kind === 'zh' ? storage?.getItem(OLD_RATE_KEY) : null;
    return known(old) ? Number(old) : 1;
  } catch { return 1; }
}

/**
 * The playback controller. deps: { raf, cancelRaf, isSheetOpen, events, doc, wakeLock, stopSay, track, storage }.
 * events gets tao:sound, tao:listen, hashchange, pagehide; doc gets visibilitychange.
 * kind ('zh' or 'en') names the track detail; id names this row in tao:listen, so one row plays at a time.
 * indexNow(lead) returns the cell index; lead is the seconds to add to currentTime.
 */
export function createPlayer({
  media, n, indexNow, cells, deps, kind = 'zh', id, lead = 0, onIndex = () => {}, onState = () => {},
}) {
  let state = 'idle';
  let tracked = false;
  let stopped = false;
  let frame = null;
  let last = -1;
  let rate = savedRate(deps.storage, kind);
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
    cells.forEach((c, j) => {
      c.classList.toggle('now', j === i);
      c.classList.toggle('done', j < i);
      if (j === i) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
    });
    if (i >= 0 && i < cells.length) onIndex(i); // past the end: all done, no current cell
  }
  function clearMarks() {
    last = -1;
    for (const c of cells) { c.classList.remove('now', 'done'); c.removeAttribute('aria-current'); }
  }

  function loop() {
    frame = null;
    if (deps.isSheetOpen()) { media.pause(); return; } // a note opened: pause, never resume by itself
    mark(indexNow(lead));
    frame = deps.raf(loop);
  }
  function startLoop() { if (frame == null) frame = deps.raf(loop); }
  function stopLoop() { if (frame != null) deps.cancelRaf(frame); frame = null; }

  function holdLock() {
    lockWanted = true;
    if (lock?.released) lock = null; // the browser drops the lock when the page hides
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
    deps.events.dispatchEvent(new CustomEvent('tao:listen', { detail: id })); // other rows pause
    Promise.resolve(media.play()).catch((e) => { if (e?.name !== 'AbortError' && !stopped) set('error'); });
  }

  on(media, 'play', () => { if (state !== 'playing') set('loading'); });
  on(media, 'waiting', () => set('loading'));
  on(media, 'playing', () => { set('playing'); holdLock(); startLoop(); });
  on(media, 'pause', () => { set('paused'); dropLock(); stopLoop(); });
  on(media, 'ended', () => { stopLoop(); dropLock(); clearMarks(); set('idle'); });
  on(media, 'error', () => { stopLoop(); dropLock(); set('error'); });
  const pauseIfActive = () => { if (state === 'playing' || state === 'loading') media.pause(); };
  on(deps.events, 'tao:sound', pauseIfActive);
  on(deps.events, 'tao:listen', (e) => { if (e.detail !== id) pauseIfActive(); });
  on(deps.events, 'hashchange', stop);
  on(deps.events, 'pagehide', stop);
  on(deps.doc, 'visibilitychange', () => {
    if (deps.doc.visibilityState !== 'visible' || state !== 'playing') return;
    holdLock();
  });
  applyRate();

  function toggle() {
    if (stopped) return;
    if (state === 'playing' || state === 'loading') { media.pause(); return; }
    deps.stopSay(); // every start: from idle, on resume, and on retry
    if (state === 'idle' && !tracked) { tracked = true; deps.track('listen', kind + ' ' + n); }
    if (state === 'error') { media.load(); applyRate(); }
    set('loading');
    play();
  }

  function setRate(r) {
    rate = r;
    applyRate();
    try { deps.storage?.setItem(RATE_KEY(kind), String(r)); } catch { /* private mode */ }
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

let rowCount = 0;

/**
 * While a row plays or is paused, it sticks to the bottom of the screen (class active), so
 * Pause stays in reach. Only the row that started last sticks: two stuck rows would cover each other.
 */
let stuckRow = null;
function stick(row, s) {
  if (s === 'loading' || s === 'playing') {
    if (stuckRow && stuckRow !== row) stuckRow.classList.remove('active');
    stuckRow = row;
  } else if (s !== 'paused' && stuckRow === row) stuckRow = null;
  row.classList.toggle('active', stuckRow === row);
}

/**
 * The Listen button and speed chips, or null when the timings do not match the cells.
 * kind is 'zh' or 'en'; cells may be wordCell objects (one per English word).
 * onPress runs on every press of the button, before the player acts.
 */
export function listenRow({ kind = 'zh', n, file, times, end, cells, onIndex, onStart, onStop, onPress, lead = LEAD }) {
  if (!Array.isArray(times) || times.length !== cells.length) return null;
  const id = 'listen-' + ++rowCount;
  let player = null;
  let started = false;

  const btn = h('button', { type: 'button', class: 'btn listen-btn', onclick: press });
  const chips = h('div', { class: 'filters', role: 'group', 'aria-label': rowView('idle', kind).speed });
  // Always present and empty unless there is an error: screen readers announce a text change.
  const err = h('p', { class: 'small listen-error', role: 'status' });
  chips.hidden = true;

  function label(s) {
    const v = rowView(s, kind);
    btn.textContent = v.text;
    btn.setAttribute('aria-label', v.aria);
    err.textContent = v.error;
  }
  function drawChips() {
    fill(chips, h('span', { class: 'small listen-speed', 'aria-hidden': 'true', text: 'Speed' }), ...RATES.map(([r, text]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(player?.rate === r), text,
      onclick: () => { player?.setRate(r); drawChips(); },
    })));
  }
  function finish() {
    if (started) { started = false; onStop?.(); }
  }

  function press() {
    onPress?.();
    if (!player || player.stopped) {
      const media = new Audio();
      media.preload = 'none';
      media.src = file;
      player = createPlayer({
        media, n, cells, kind, id, lead,
        indexNow: (ahead) => {
          const t = media.currentTime + ahead;
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
          stick(row, s);
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

  const row = h('div', { class: 'listen-row' }, btn, chips, err);
  label('idle');
  return row;
}
