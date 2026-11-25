// Share the current page, and add the app to the phone's home screen.
import { h, s, fill, toast } from './ui.js';
import { track } from './track.js';

const SITE = 'Tao Te Ching · Tao of Power';

/** What to share for a page. A passage link drops the private draw id (?d=…). */
export function shareTarget(href) {
  const u = new URL(href);
  const hash = u.hash || '#/';
  const m = hash.match(/^#\/p\/(\d{1,2})/);
  u.hash = m ? `#/p/${m[1]}` : hash;
  const url = u.hash === '#/' ? `${u.origin}${u.pathname}` : u.href;
  const title = m ? `Tao Te Ching, passage ${m[1]}` : SITE;
  const text = m
    ? `Passage ${m[1]} of the Tao Te Ching, with notes on the Chinese.`
    : 'Draw a passage of the Tao Te Ching, read it slowly, and write what arises.';
  return { title, text, url, path: m ? `/p/${m[1]}` : (hash.slice(1).split('?')[0] || '/') };
}

/** Share with the phone's share sheet; else copy the link. */
export async function sharePage() {
  const t = shareTarget(location.href);
  if (navigator.share) {
    try {
      await navigator.share({ title: t.title, text: t.text, url: t.url });
      track('share', t.path);
    } catch (e) {
      if (e?.name !== 'AbortError') copyLink(t);
    }
    return;
  }
  copyLink(t);
}

async function copyLink(t) {
  try {
    await navigator.clipboard.writeText(t.url);
    track('share', t.path);
    toast('Link copied.');
  } catch {
    toast(`Copy this link: ${t.url}`, { ms: 9000 });
  }
}

// ---- Add to home screen ----

/** Which help a browser needs. "prompt": the browser can install on a tap. */
export function installMode({ standalone, canPrompt, ua = '', platform = '', touch = 0 }) {
  if (standalone) return 'installed';
  if (canPrompt) return 'prompt';
  const ios = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touch > 1);
  return ios ? 'ios' : 'menu';
}

/** The iPhone Share icon: a square with an arrow up. */
const shareIcon = () => s('svg', { class: 'ios-share', viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' },
  s('path', { d: 'M8 9H6v12h12V9h-2M12 3v12M8 7l4-4 4 4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

function hint(mode) {
  if (mode !== 'ios') return [h('p', { text: 'Open the browser menu (⋮ or ☰), then “Add to Home screen” or “Install app”.' })];
  return [
    h('p', { class: 'install-lead', text: 'On iPhone or iPad:' }),
    h('ol', {},
      h('li', {}, 'Tap the Share button ', shareIcon(), '. In Safari it is at the bottom of the screen, or under the ••• button. In Brave or Chrome, look beside the address bar or in the menu.'),
      h('li', {}, 'Scroll down the list and tap ', h('b', { text: 'Add to Home Screen' }), '.'),
      h('li', {}, 'If you see ', h('b', { text: 'Open as Web App' }), ', leave it on. Tap ', h('b', { text: 'Add' }), '.')),
    h('p', { text: 'The 道 icon is now on your home screen. It opens the app full screen, and it works offline.' }),
  ];
}

let deferred = null;
let installed = false;
let onChange = null; // the home page's button, when it is on screen
const changed = () => onChange?.();

/** Call once, early, so the browser's install offer is not lost. */
export function initInstall() {
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; changed(); });
  addEventListener('appinstalled', () => { deferred = null; installed = true; track('install', 'done'); changed(); });
}

function currentMode() {
  let standalone = installed;
  try { standalone ||= matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { /* old browser */ }
  return installMode({
    standalone, canPrompt: !!deferred,
    ua: navigator.userAgent, platform: navigator.platform, touch: navigator.maxTouchPoints || 0,
  });
}

/** The "Add to Home Screen" button and its help text. Hidden when the app already runs from the home screen. */
function installParts() {
  const help = h('div', { class: 'muted small install-hint', hidden: true });
  const btn = h('button', { class: 'btn quiet', type: 'button', text: 'Add to Home Screen', onclick: async () => {
    const mode = currentMode();
    if (mode === 'prompt' && deferred) {
      const e = deferred;
      deferred = null;
      e.prompt();
      const choice = await e.userChoice.catch(() => null);
      track('install', choice?.outcome || 'prompt');
      return;
    }
    if (help.hidden) fill(help, hint(mode));
    help.hidden = !help.hidden;
    btn.setAttribute('aria-expanded', String(!help.hidden));
    if (!help.hidden) track('install', mode);
  } });
  const sync = () => {
    const done = currentMode() === 'installed';
    btn.hidden = done;
    if (done) help.hidden = true;
  };
  onChange = sync;
  sync();
  return { btn, help };
}

/** The home page row: share and add to home screen. */
export function homeShareRow() {
  const { btn, help } = installParts();
  return h('div', { class: 'home-share' },
    h('div', { class: 'row' },
      h('button', { class: 'btn quiet', type: 'button', text: 'Share', onclick: sharePage }),
      btn),
    help);
}
