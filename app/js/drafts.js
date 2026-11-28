// Writers of unsaved drafts (passage box, question line, margin notes). "Remove it from this browser" must
// stop every open editor at once, without a save, so no timer or late flush writes a removed draft back.

const open = new Set();

/**
 * A draft writer for one open editor. `write()` saves the draft; `delay` (ms) waits for a pause in typing.
 * schedule(): write after the delay (at once when delay is 0). flush(): write now and stop the timer.
 * release(): the editor closed normally; stop, write nothing more. Every writer stops on discardDrafts().
 */
export function draftWriter(write, { delay = 0 } = {}) {
  let timer = null;
  let live = true;
  const stop = () => { clearTimeout(timer); timer = null; };
  const w = {
    schedule() {
      if (!live) return;
      if (!delay) { write(); return; }
      stop();
      timer = setTimeout(() => { timer = null; if (live) write(); }, delay);
    },
    flush() { if (!live) return; stop(); write(); },
    release() { live = false; stop(); open.delete(w); },
  };
  open.add(w);
  return w;
}

/** Stop every open draft writer without a save. */
export function discardDrafts() { for (const w of [...open]) w.release(); }

/** How many writers are open (for tests). */
export const openDrafts = () => open.size;
