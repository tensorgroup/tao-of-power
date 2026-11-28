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

// The names of the recordings (audio/index.json), loaded once. A failed load is forgotten, so a later say()
// tries again (for example, back online); until then every reading uses the device voice.
let indexP = null;
const index = () => (indexP ||= fetch('audio/index.json')
  .then((r) => { if (!r.ok) throw new Error(`audio/index.json: ${r.status}`); return r.json(); })
  .then((l) => new Set(l))
  .catch(() => { indexP = null; return new Set(); }));

let current = null; // the recording of the newest say(), while it may still play
let generation = 0; // every say() and stopSay() moves it: an older say() that is still waiting gives up

/** Stop the recording and the device voice that are playing. */
function halt() {
  current?.pause();
  current = null;
  globalThis.speechSynthesis?.cancel();
}

/** Stop whatever sound is playing or about to play (a pending say() returns false). */
export function stopSay() {
  generation += 1;
  halt();
}

const announce = () => globalThis.dispatchEvent?.(new Event('tao:sound'));

/** Speak with the device's voice (tao:sound is already sent). Returns the utterance, or null. */
function speakFallback(char) {
  const synth = globalThis.speechSynthesis;
  if (!synth || !char) return null;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(char);
  u.lang = 'zh-CN';
  u.rate = 0.8;
  const voice = synth.getVoices().find((v) => /^zh[-_](CN|Hans)/i.test(v.lang)) || synth.getVoices().find((v) => /^zh/i.test(v.lang));
  if (voice) u.voice = voice;
  synth.speak(u);
  return u;
}

/**
 * Play one reading of a character: its recording, else the device's voice. Resolves the Audio or the
 * utterance that plays, or null. A newer say() first stops this one (its recording, its speech); a play()
 * that ends with AbortError was interrupted, so this say is over and never falls back to speech.
 */
async function sound(py, char) {
  track('say', `${char} ${py}`);
  const gen = ++generation;
  halt(); // the sound of an earlier say(): its pending play() ends with AbortError
  const have = await index();
  if (gen !== generation) return null;
  const file = candidates(py).find((c) => have.has(c));
  announce();
  if (gen !== generation) return null; // a tao:sound listener stopped sound
  if (!file) return speakFallback(char);
  const audio = new Audio(`audio/${file}.mp3`);
  current = audio;
  try {
    await audio.play();
  } catch (e) {
    if (gen !== generation || e?.name === 'AbortError') return null;
    current = null;
    return speakFallback(char); // the recording cannot play here (e.g. NotAllowedError)
  }
  return gen === generation ? audio : null;
}

/** Play one reading of a character. Returns false when nothing can be played. */
export async function say(py, char) {
  return (await sound(py, char)) != null;
}

/** A small "▶ dào" button, marked "playing" until the sound it started ends (1.8 s at most). */
export function sayButton(py, char, label = py) {
  const b = h('button', { class: 'say-btn', type: 'button', 'aria-label': `Hear ${char} spoken in Mandarin: ${py}` },
    h('span', { class: 'say-icon', 'aria-hidden': 'true', text: '▶' }), ` ${label}`);
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    b.classList.add('playing');
    const s = await sound(py, char);
    const done = () => b.classList.remove('playing');
    if (s) { s.onended = done; s.onend = done; } // an Audio ends with 'ended', an utterance with 'end'
    setTimeout(done, 1800);
  });
  return b;
}
