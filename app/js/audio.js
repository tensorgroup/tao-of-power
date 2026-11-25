// Mandarin pronunciation: recorded syllables (app/audio, CC BY-SA, see LICENSE.txt),
// with the device's own Chinese voice as a fallback for readings we have no file for.
import { h } from './ui.js';
import { track } from './track.js';

const MARKS = { 'ā': 'a1', 'á': 'a2', 'ǎ': 'a3', 'à': 'a4', 'ē': 'e1', 'é': 'e2', 'ě': 'e3', 'è': 'e4', 'ī': 'i1', 'í': 'i2', 'ǐ': 'i3', 'ì': 'i4',
  'ō': 'o1', 'ó': 'o2', 'ǒ': 'o3', 'ò': 'o4', 'ū': 'u1', 'ú': 'u2', 'ǔ': 'u3', 'ù': 'u4', 'ǖ': 'ü1', 'ǘ': 'ü2', 'ǚ': 'ü3', 'ǜ': 'ü4' };

/** 'dào' -> ['dao4', '_dao4', ...]; the same rule as scripts/vendor-audio.py. */
export function candidates(py) {
  let tone = '5', base = '';
  for (const ch of String(py).toLowerCase().trim()) {
    if (MARKS[ch]) { base += MARKS[ch][0]; tone = MARKS[ch][1]; } else base += ch;
  }
  const out = [];
  for (const b of [base.replace(/ü/g, 'v'), base.replace(/ü/g, 'u'), base.replace(/u/g, 'v')]) {
    for (const c of [`${b}${tone}`, `_${b}${tone}`]) if (!out.includes(c)) out.push(c);
  }
  return out;
}

let indexP = null;
const index = () => (indexP ||= fetch('audio/index.json').then((r) => r.json()).then((l) => new Set(l)).catch(() => new Set()));

let current = null;
let generation = 0;

/** Stop whatever sound is playing or about to play (a pending say() returns false). */
export function stopSay() {
  generation += 1;
  current?.pause();
  globalThis.speechSynthesis?.cancel();
}

const announce = () => globalThis.dispatchEvent?.(new Event('tao:sound'));

/** Speak with the device's voice. announced: tao:sound was already sent for this say(). */
function speakFallback(char, announced = false) {
  const synth = globalThis.speechSynthesis;
  if (!synth || !char) return false;
  synth.cancel();
  if (!announced) announce();
  const u = new SpeechSynthesisUtterance(char);
  u.lang = 'zh-CN';
  u.rate = 0.8;
  const voice = synth.getVoices().find((v) => /^zh[-_](CN|Hans)/i.test(v.lang)) || synth.getVoices().find((v) => /^zh/i.test(v.lang));
  if (voice) u.voice = voice;
  synth.speak(u);
  return true;
}

/** Play one reading of a character. Returns false when nothing can be played. */
export async function say(py, char) {
  track('say', `${char} ${py}`);
  const gen = generation;
  const have = await index();
  if (gen !== generation) return false;
  const file = candidates(py).find((c) => have.has(c));
  current?.pause();
  if (!file) return speakFallback(char);
  announce();
  if (gen !== generation) return false; // a tao:sound listener stopped sound
  current = new Audio(`audio/${file}.mp3`);
  try { await current.play(); return true; } catch { return gen === generation && speakFallback(char, true); }
}

/** A small "▶ dào" button. */
export function sayButton(py, char, label = py) {
  const b = h('button', { class: 'say-btn', type: 'button', 'aria-label': `Hear ${char} spoken in Mandarin: ${py}` },
    h('span', { class: 'say-icon', 'aria-hidden': 'true', text: '▶' }), ` ${label}`);
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    b.classList.add('playing');
    const ok = await say(py, char);
    if (current && ok) current.onended = () => b.classList.remove('playing');
    setTimeout(() => b.classList.remove('playing'), 1800);
  });
  return b;
}
