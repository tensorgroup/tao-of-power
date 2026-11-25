// The sync card (offered after a draw) and the Sync section on the Journal page.
import { h, fill, toast } from '../ui.js';
import { syncer } from '../app.js';
import { available, signIn, signUp, canCheckSilently, DISMISSED, LAST } from '../sync.js';
import { track } from '../track.js';

const PRIVACY = 'Sync is optional. When it is on, your journal is stored on our server so your other devices can get it. It is not end-to-end encrypted. “Delete synced copy” removes it; database backups expire within 30 days.';

const dismissed = () => { try { return localStorage.getItem(DISMISSED) === '1'; } catch { return false; } };

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

/** Ask, inside `box`, what to do with another account's journal. Resolves 'merge' | 'replace' | 'cancel'. */
function switchPrompt(box) {
  return new Promise((resolve) => {
    const done = (v) => { prompt.remove(); resolve(v); };
    const prompt = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Another journal' },
      h('span', { text: 'This browser holds a journal from another sync account.' }),
      h('button', { class: 'btn primary', type: 'button', text: 'Merge it into this account', onclick: () => done('merge') }),
      h('button', { class: 'btn', type: 'button', text: 'Use only this account’s journal', onclick: () => done('replace') }),
      h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => done('cancel') }));
    box.append(prompt);
    prompt.querySelector('button')?.focus();
  });
}

const syncedHereBefore = () => { try { return !!localStorage.getItem(LAST); } catch { return false; } };

/**
 * One passkey button that fits what we know. A page cannot ask the browser whether
 * a passkey exists, so: a browser that synced before gets "Sign in"; otherwise
 * "Turn on sync" looks for a passkey first (silently where the browser allows it),
 * and only when none is chosen does the button become "Create a passkey".
 * Returns { row, msg }; `extra` are buttons kept at the end of the row.
 */
function passkeyFlow(box, after, extra = []) {
  const msg = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const row = h('div', { class: 'row' });
  const onSwitch = () => switchPrompt(box);
  const busy = (on) => { for (const b of row.querySelectorAll('button')) b.disabled = on; };
  const done = (ev) => { track(ev); toast('Sync is on.'); after(); };

  const attempt = async (fn) => {
    busy(true);
    msg.textContent = '';
    try { return await fn(); } catch (e) { msg.textContent = e?.message || String(e); return { ok: false }; } finally { busy(false); }
  };

  const showSignIn = (lead) => fill(row, h('button', { class: 'btn primary', type: 'button', text: lead, onclick: async () => {
    const r = await attempt(() => signIn(syncer, { onSwitch }));
    if (r.ok) return done('sync-signin');
    if (r.message) msg.textContent = r.message;
    if (r.none) showCreate(r.message ? null : 'No passkey was chosen. If you have never made one for this site, create one now.');
  } }), ...extra);

  const showCreate = (note) => {
    if (note) msg.textContent = note;
    fill(row,
      h('button', { class: 'btn primary', type: 'button', text: 'Create a passkey', onclick: async () => {
        const r = await attempt(() => signUp(syncer, { onSwitch }));
        if (r.ok) return done('sync-on');
        if (r.message) msg.textContent = r.message;
      } }),
      h('button', { class: 'btn quiet', type: 'button', text: 'I have one: sign in', onclick: () => { msg.textContent = ''; showSignIn('Sign in with passkey'); } }),
      ...extra);
  };

  const showStart = () => fill(row, h('button', { class: 'btn primary', type: 'button', text: 'Turn on sync', onclick: async () => {
    const silent = await canCheckSilently();
    const r = await attempt(() => signIn(syncer, { onSwitch, immediate: silent }));
    if (r.ok) return done('sync-signin');
    if (r.message) msg.textContent = r.message;
    if (r.none) showCreate(r.message ? null : silent ? 'No passkey for this site on this device yet.' : 'No passkey was chosen. If you have never made one for this site, create one now.');
  } }), ...extra);

  if (syncedHereBefore()) showSignIn('Sign in with passkey'); else showStart();
  return { row, msg };
}

/** Offered after a draw until the reader turns sync on or says "Not now". */
export function syncCard() {
  if (!available() || syncer.record() || dismissed()) return null;
  const card = h('aside', { class: 'sync-card', 'aria-label': 'Sync' });
  const notNow = h('button', { class: 'btn quiet', type: 'button', text: 'Not now', onclick: () => { try { localStorage.setItem(DISMISSED, '1'); } catch {} card.remove(); } });
  const { row, msg } = passkeyFlow(card, () => card.remove(), [notNow]);
  fill(card,
    h('p', { class: 'sync-lead', text: 'Keep this journal on all your devices.' }),
    h('p', { class: 'muted small', text: 'A passkey signs you in: no email, no password.' }),
    row,
    msg);
  return card;
}

/** The Sync section of the Journal page. `render()` redraws the page. */
export function syncSection(render) {
  const box = h('section', { class: 'sync-box', 'aria-label': 'Sync' });
  if (!available() && !syncer.record()) {
    return fill(box, h('p', { class: 'muted small', text: 'Passkeys are not available in this browser, so sync is off here. Export keeps a full copy.' }));
  }
  const r = syncer.record();
  if (!r) {
    const { row, msg } = passkeyFlow(box, render);
    return fill(box,
      h('h2', { text: 'Sync' }),
      h('p', { text: 'Use a passkey to see this journal on your other devices.' }),
      row,
      msg,
      h('p', { class: 'muted small', text: PRIVACY }));
  }
  const status = r.error === 'too-large'
    ? h('p', { class: 'backup', text: 'The journal is too large to sync. Export keeps a full copy.' })
    : h('p', { class: 'muted small', text: `Sync is on · ${r.label} · ${r.at ? `synced ${ago(r.at)}` : 'not synced yet'}` });
  const area = h('div', {});
  const signOutAsk = () => fill(area, h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Sign out' },
    h('span', { text: 'Sign out of sync on this browser. Keep the journal here too?' }),
    h('button', { class: 'btn', type: 'button', text: 'Keep it here', onclick: () => out(false) }),
    h('button', { class: 'btn red', type: 'button', text: 'Remove it from this browser', onclick: () => out(true) }),
    h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => fill(area) })));
  const out = async (clearLocal) => {
    await syncer.signOut({ clearLocal });
    track('sync-off');
    toast(clearLocal ? 'Signed out. The journal is on the server, not in this browser.' : 'Signed out. The journal stays in this browser.');
    render();
  };
  const deleteAsk = () => fill(area, h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Delete synced copy' },
    h('span', { text: 'Delete the synced copy from the server? This browser keeps its journal. Your other devices stop syncing.' }),
    h('button', { class: 'btn red', type: 'button', text: 'Delete synced copy', onclick: async () => {
      try {
        await syncer.deleteAccount();
        track('sync-delete');
        toast(`Deleted. You can also remove the passkey “${r.label}” from your passwords app.`, { ms: 8000 });
        render();
      } catch (e) { toast(e.message, { warn: true }); }
    } }),
    h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => fill(area) })));
  return fill(box,
    h('h2', { text: 'Sync' }),
    status,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', text: 'Sync now', onclick: async () => { await syncer.syncNow(); render(); } }),
      h('button', { class: 'btn quiet', type: 'button', text: 'Sign out', onclick: signOutAsk }),
      h('button', { class: 'btn quiet', type: 'button', text: 'Delete synced copy', onclick: deleteAsk })),
    area);
}

/** Re-render `render` on sync news while `root` is on screen, but not under a text field in use. */
export function onSyncNews(root, render, { onlyWhenChanged = false } = {}) {
  let waiting = false;
  const handler = (e) => {
    if (!root.isConnected) { removeEventListener('tao:sync', handler); return; }
    if (onlyWhenChanged && !e.detail?.changed) return;
    const busy = () => {
      const a = document.activeElement;
      return a && root.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT');
    };
    if (!busy()) { render(); return; }
    if (waiting) return;
    waiting = true;
    root.addEventListener('focusout', function later() {
      setTimeout(() => {
        if (busy() || !root.isConnected) return;
        root.removeEventListener('focusout', later);
        waiting = false;
        render();
      }, 0);
    });
  };
  addEventListener('tao:sync', handler);
}
