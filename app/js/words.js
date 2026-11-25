// English word spans for the Listen player. The word rule lives only in wordsOf (markup.js).
// splitPlan and wordCell are pure; DOM access happens only inside wrapWords.
import { wordsOf } from './markup.js';

/**
 * Map the words of the joined node texts back onto the nodes.
 * A word that crosses a node edge gives one piece per node, under one word index.
 */
export function splitPlan(nodeTexts) {
  const found = wordsOf(nodeTexts.join(''));
  const words = found.map((w) => w.word);
  const pieces = found.map(() => []);
  let base = 0;
  nodeTexts.forEach((t) => {
    const top = base + t.length;
    found.forEach((w, i) => {
      const s = Math.max(w.start, base);
      const e = Math.min(w.end, top);
      if (s < e) pieces[i].push({ start: s - base, end: e - base, word: t.slice(s - base, e - base) });
    });
    base = top;
  });
  return { words, pieces };
}

/**
 * Wrap each word of lineEl's text in span.w (data-w = offset + index).
 * Returns the word strings and, per word, the spans that make it up.
 */
export function wrapWords(lineEl, offset = 0) {
  const doc = lineEl.ownerDocument;
  const walker = doc.createTreeWalker(lineEl, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  const { words, pieces } = splitPlan(nodes.map((n) => n.data));
  const cells = words.map(() => []);
  // Which node holds each piece: pieces of a word run in node order, so walk the node text lengths.
  const perNode = nodes.map(() => []);
  const bases = [];
  let base = 0;
  nodes.forEach((n) => { bases.push(base); base += n.data.length; });
  const joinedStarts = wordsOf(nodes.map((n) => n.data).join('')).map((w) => w.start);
  pieces.forEach((ps, wi) => {
    let pos = joinedStarts[wi];
    for (const p of ps) {
      let ni = bases.length - 1;
      while (bases[ni] > pos) ni -= 1;
      perNode[ni].push({ wi, p });
      pos += p.end - p.start;
    }
  });
  nodes.forEach((node, ni) => {
    // split from the end so earlier offsets stay valid
    for (const { wi, p } of perNode[ni].sort((x, y) => y.p.start - x.p.start)) {
      const tail = node.splitText(p.start);
      tail.splitText(p.end - p.start);
      const span = doc.createElement('span');
      span.className = 'w';
      span.dataset.w = String(offset + wi);
      tail.replaceWith(span);
      span.appendChild(tail);
      cells[wi].unshift(span);
    }
  });
  return { words, cells };
}

/**
 * One cell for the player, over the spans of one word.
 * Class calls reach every span; aria-current and the rect use the first span.
 */
export function wordCell(spans) {
  const first = spans[0];
  return {
    classList: {
      add: (...c) => spans.forEach((s) => s.classList.add(...c)),
      remove: (...c) => spans.forEach((s) => s.classList.remove(...c)),
      toggle: (c, on) => spans.forEach((s) => s.classList.toggle(c, on)),
    },
    setAttribute: (k, v) => first.setAttribute(k, v),
    removeAttribute: (k) => first.removeAttribute(k),
    getBoundingClientRect: () => first.getBoundingClientRect(),
  };
}
