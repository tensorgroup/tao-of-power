// The app's journal in memory, and the one path that saves a change to it.
import { merge } from './journal.js';

/**
 * `gate(fn)` is the syncer's gate: it runs fn now, or later when a removal in another tab ends (it then
 * returns false). Before fn runs, the gate reads the journal again if another tab removed it or changed the
 * account. `onSaved()` runs after each save. `stamp()` names the journal in memory now (sync.js): an
 * editor's saves carry the stamp of the moment it opened, and the gate refuses one that another account
 * would receive.
 */
export function makeState({ load, save, gate = (fn) => { fn(); return true; }, stamp = () => null, toast, onSaved = () => {} }) {
  const state = {
    journal: load(),
    /**
     * Make one change and save it. fn() changes or replaces state.journal and returns a true value; false,
     * null, or undefined means nothing changed: then nothing is saved, after() does not run (an editor stays
     * open), and the toast says `notSaved`. after() runs once the change is saved. During a removal the
     * change waits and then runs on the journal in memory at that time, so the caller keeps the reader's text
     * on screen until after() runs. A change that storage cannot hold (full) stays in memory, and the toast
     * says Export. True when saved now.
     */
    change(fn, after = () => {}, notSaved = 'Not saved.', st = undefined) {
      let ok = false;
      gate(() => {
        if (!fn()) { toast(notSaved, { warn: true, ms: 6000 }); return; }
        // Merge with what is stored: another tab may have saved since this tab last loaded.
        state.journal = merge(state.journal, load());
        const r = save(state.journal);
        if (!r.ok) { toast(`Could not save: ${r.error}. Export your journal now.`, { warn: true, ms: 8000 }); return; }
        ok = true;
        onSaved();
        after();
      }, st);
      return ok;
    },
    /**
     * Call when an editor opens (or a list with Edit buttons is built). It returns a change() for that
     * editor's saves: each carries the stamp of this moment.
     */
    editor() {
      const st = stamp();
      return (fn, after, notSaved) => state.change(fn, after, notSaved, st);
    },
  };
  return state;
}
