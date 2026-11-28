// Writers of unsaved drafts (passage box, question line, margin notes).
// Every write goes through the gate (the app sets it to the syncer's gate): during a removal in another tab
// it waits, and then writes the text of that time. The last writer wins, with two rules: a writer made before
// the latest removal ("Remove it from this browser") writes nothing until the reader types again, and saving
// an entry clears its draft only if the draft still holds the saved text.

const open = new Set();
let gate = (fn) => { fn(); return true; };
let generation = () => null;

/** Set the gate every draft write goes through, and how to read the removal count (the WIPED value). */
export function setDraftGate(fn, gen = () => null) { gate = fn; generation = gen; }

/**
 * A draft writer for one open editor. `load()` reads the stored draft ('' when none), `save(v)` stores it
 * ('' removes it; false when storage refused it), `value()` is the editor's draft now. `delay` (ms) waits for
 * a pause in typing.
 * schedule(): the reader changed something; write after the delay (at once when delay is 0). flush(): write
 * now if something is unsaved. clearIf(v): remove the draft if it still holds v (the text just saved).
 * release(): the editor goes away; write what is unsaved, then stop.
 */
export function draftWriter({ load, save, value, delay = 0 }) {
  let gen = generation(); // the removal this writer last saw the reader type after
  let timer = null;
  let pending = false; // changed since the last write that storage took
  let queued = false; // a write waits at the gate: it writes the value of that time
  let live = true;
  const write = () => {
    clearTimeout(timer);
    timer = null;
    if (queued) return;
    queued = true;
    gate(() => {
      queued = false;
      if (generation() !== gen) return; // removed since the reader last typed: the old text stays removed
      if (save(value()) !== false) pending = false;
    });
  };
  const w = {
    schedule() {
      if (!live) return;
      gen = generation();
      pending = true;
      if (!delay) { write(); return; }
      clearTimeout(timer);
      timer = setTimeout(write, delay);
    },
    flush() { if (live && pending) write(); },
    clearIf(v) { gate(() => { if (load() === v) save(''); }); },
    release() { if (!live) return; w.flush(); live = false; clearTimeout(timer); open.delete(w); },
  };
  open.add(w);
  return w;
}

/** Leaving the page: every open writer writes what is unsaved, then stops. */
export function releaseDrafts() { for (const w of [...open]) w.release(); }

/**
 * True when a text box under `root` holds typed text that is not saved: its text differs from the text it
 * opened with (defaultValue: '' for a new note, the entry's text for an edit).
 */
export function typedText(root = document) {
  return [...root.querySelectorAll('textarea')].some((t) => t.value.trim() !== t.defaultValue.trim());
}
