// Count each search the reader makes once: that a search happened, and its filter; never the words.
// Only the reader's actions call count() (typing, Enter, a filter, a suggestion). The results running
// again when the index or the model arrives is not a new search.

/**
 * track(ev, detail): the analytics call; onPage(): true while the page is still Search.
 * count(query, filter) waits `delay` ms after the last call, then sends track('search', filter) when the reader is
 * still on the page and this query and filter were not the last one counted. An empty query cancels and sends
 * nothing. The query is kept in memory only, to compare; it is never sent.
 */
export function makeSearchCounter({ track, onPage, delay = 1500, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let last = null;
  const cancel = () => { if (timer != null) clearTimer(timer); timer = null; };
  return {
    count(query, filter) {
      cancel();
      if (!query) return;
      const key = `${filter}\u0001${query}`;
      timer = setTimer(() => {
        timer = null;
        if (!onPage() || key === last) return;
        last = key;
        track('search', filter);
      }, delay);
    },
    cancel,
  };
}
