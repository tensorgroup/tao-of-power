// English word spans for the Listen player. The word rule lives only in wordsOf (markup.js).
// splitPlan and wordCell are pure; DOM access happens only inside wrapWords.
import { wordsOf } from './markup.js';

/**
 * Map the words of the joined node texts back onto the nodes.
 * A word that crosses a node edge gives one piece per node, under one word index.
 * Each piece names its node (index into nodeTexts) and its offsets inside that node.
 */
export function splitPlan(nodeTexts) {
  const found = wordsOf(nodeTexts.join(''));
  const words = found.map((w) => w.word);
  const pieces = found.map(() => []);
  let base = 0;
  nodeTexts.forEach((t, node) => {
    const top = base + t.length;
    found.forEach((w, i) => {
      const s = Math.max(w.start, base);
      const e = Math.min(w.end, top);
      if (s < e) pieces[i].push({ node, start: s - base, end: e - base, word: t.slice(s - base, e - base) });
    });
    base = top;
  });
  return { words, pieces };
}

/** The text nodes of lineEl and their splitPlan. Reads the line; changes nothing. */
export function planLine(lineEl) {
  const walker = lineEl.ownerDocument.createTreeWalker(lineEl, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  return { nodes, ...splitPlan(nodes.map((n) => n.data)) };
}

/**
 * Wrap each word of lineEl's text in span.w (data-w = offset + index).
 * plan is planLine(lineEl), made before any change to the line.
 * Returns the word strings and, per word, the spans that make it up.
 */
export function wrapWords(lineEl, offset = 0, plan = planLine(lineEl)) {
  const doc = lineEl.ownerDocument;
  const { nodes, words, pieces } = plan;
  const cells = words.map(() => []);
  const perNode = nodes.map(() => []);
  pieces.forEach((ps, wi) => { for (const p of ps) perNode[p.node].push({ wi, p }); });
  // Nodes in order, so the spans of a word come in reading order.
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
      cells[wi].push(span);
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
