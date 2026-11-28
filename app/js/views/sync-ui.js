// The sync card (offered after a draw) and the Sync section on the Journal page.
import { h, fill, toast } from '../ui.js';
import { syncer } from '../app.js';
import { available, signIn, signUp, DISMISSED, LAST, REC } from '../sync.js';
import { track } from '../track.js';
import { keptSnapshot } from '../journal.js';

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
 * The passkey buttons. A browser that synced before gets "Sign in with passkey".
 * Otherwise "Turn on sync" opens a choice: create a passkey, or sign in with one
 * made on another device. Nothing opens a passkey sheet until the reader picks.
 * Returns { row, msg }; `extra` are buttons kept at the end of the row.
 */
function passkeyFlow(box, after, extra = []) {
  const msg = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const note = h('p', { class: 'muted small', text: PRIVACY, hidden: true });
  const row = h('div', { class: 'row' });
  const onSwitch = () => switchPrompt(box);
  const busy = (on) => { for (const b of row.querySelectorAll('button')) b.disabled = on; };
  const done = (ev) => { track(ev); toast('Sync is on.'); after(); };
  const attempt = async (fn) => {
    busy(true);
    msg.textContent = '';
    try { return await fn(); } catch (e) { msg.textContent = e?.message || String(e); return { ok: false }; } finally { busy(false); }
  };
  const signInBtn = (primary) => h('button', { class: primary ? 'btn primary' : 'btn', type: 'button', text: 'Sign in with passkey', onclick: async () => {
    const r = await attempt(() => signIn(syncer, { onSwitch }));
    if (r.ok) return done('sync-signin');
    msg.textContent = r.message || 'No passkey was chosen. If it is on your phone, choose the option to use a phone or another device.';
    if (!row.querySelector('.create')) fill(row, signInBtn(true), createBtn(), ...extra); // e.g. its account was deleted
  } });
  const createBtn = () => h('button', { class: 'btn create', type: 'button', text: 'Create a passkey', onclick: async () => {
    const r = await attempt(() => signUp(syncer, { onSwitch }));
    if (r.ok) return done('sync-on');
    msg.textContent = r.message || 'No passkey was made.';
  } });
  const showChoice = () => {
    fill(row, signInBtn(true), createBtn(), ...extra);
    msg.textContent = 'Made a passkey on another device? Sign in with it. New here? Create one.';
    note.hidden = false;
    row.querySelector('button')?.focus();
  };
  if (syncedHereBefore()) fill(row, signInBtn(true), ...extra);
  else fill(row, h('button', { class: 'btn primary', type: 'button', text: 'Turn on sync', onclick: showChoice }), ...extra);
  return { row, msg, note };
}

/** Offered after a draw until the reader turns sync on or says "Not now". */
export function syncCard() {
  if (!available() || syncer.record() || dismissed()) return null;
  const card = h('aside', { class: 'sync-card', 'aria-label': 'Sync' });
  const notNow = h('button', { class: 'btn quiet', type: 'button', text: 'Not now', onclick: () => { try { localStorage.setItem(DISMISSED, '1'); } catch {} card.remove(); } });
  const { row, msg, note } = passkeyFlow(card, () => card.remove(), [notNow]);
  fill(card,
    h('p', { class: 'sync-lead', text: 'Keep this journal on all your devices.' }),
    h('p', { class: 'muted small', text: 'A passkey signs you in: no email, no password.' }),
    row,
    msg,
    note);
  return card;
}

/**
 * The Sync section of the Journal page. Outside "More": the status and one action
 * (Turn on sync / Sign in, or Sign out). `more` holds the page's other controls
 * (Export, Import); Sync now and Delete synced copy join them there.
 */
export function syncSection(render, { more = [], moreOpen = false } = {}) {
  const box = h('section', { class: 'sync-box', 'aria-label': 'Sync' });
  const area = h('div', {});
  const moreBox = (...items) => h('details', { class: 'more', open: moreOpen || null },
    h('summary', { text: 'More' }), h('div', { class: 'row' }, ...items.filter(Boolean)));
  const r = syncer.record();
  const shown = r?.account ?? null; // the account this section shows: its confirm boxes act on it only
  // Only while on the page: built off the page, the new section would take `more` out of the live one.
  const refresh = () => { if (box.isConnected) box.replaceWith(syncSection(render, { more, moreOpen: !!box.querySelector('details.more')?.open })); };
  const stop = () => { removeEventListener('tao:sync', onNews); removeEventListener('storage', onStorage); };
  const onNews = () => {
    if (!box.isConnected) { stop(); return; }
    // An open confirm waits for the reader, unless the account changed (here or in another tab): then its
    // words and its action are about an account this browser has left.
    if (box.querySelector('.confirm') && (syncer.record()?.account ?? null) === shown) return;
    stop();
    refresh();
  };
  const onStorage = (e) => { if (e.key === REC) onNews(); }; // another tab signed in or out
  addEventListener('tao:sync', onNews);
  addEventListener('storage', onStorage);

  if (!r) {
    if (!available()) {
      return fill(box,
        h('h2', { text: 'Sync' }),
        h('p', { class: 'muted small', text: 'Passkeys are not available in this browser, so sync is off here. Export keeps a full copy.' }),
        moreBox(...more));
    }
    const { row, msg, note } = passkeyFlow(box, render);
    return fill(box,
      h('h2', { text: 'Sync' }),
      h('p', { text: 'Use a passkey to see this journal on your other devices.' }),
      row, msg, note, area,
      moreBox(...more));
  }

  const status = r.error === 'too-large'
    ? h('p', { class: 'backup', text: 'The journal is too large to sync. Export keeps a full copy.' })
    : h('p', { class: 'muted small', text: `Sync is on · ${r.label} · ${r.at ? `synced ${ago(r.at)}` : 'not synced yet'}` });
  // While a sign-out or delete runs, its confirm buttons stay disabled: a second tap must not start another.
  const running = (on) => { for (const b of area.querySelectorAll('button')) b.disabled = on; };
  const out = async (clearLocal) => {
    running(true);
    try { await syncer.signOut({ clearLocal, account: shown }); } catch (e) { fill(area, h('p', { class: 'backup', text: e.message })); return; }
    track('sync-off');
    toast(clearLocal ? 'Signed out. The journal is on the server, not in this browser.' : 'Signed out. The journal stays in this browser.');
    render();
  };
  // A confirm box in `area`: focus goes to its first button (to Cancel with `focusCancel`, for a destructive
  // one), and Cancel gives it back to the button that opened it.
  const ask = (opener, label, text, buttons, after = [], { focusCancel = false } = {}) => {
    const cancel = h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => { fill(area); opener.focus(); } });
    fill(area, h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': label }, h('span', { text }), ...buttons, ...after, cancel));
    (focusCancel ? cancel : buttons[0]).focus();
  };
  // "Remove it from this browser" also removes the journal kept by the last Replace: say so, with its counts.
  const snapshotLine = () => {
    const kept = keptSnapshot();
    if (!kept) return null;
    const what = [kept.entries ? `${kept.entries} entr${kept.entries === 1 ? 'y' : 'ies'}` : null,
      kept.draws ? `${kept.draws} draw${kept.draws === 1 ? '' : 's'}` : null].filter(Boolean).join(', ');
    return h('span', { class: 'small', text: `Removing also deletes the journal kept from before your last Replace (${what}). Restore or Export it first.` });
  };
  const signOutBtn = h('button', { class: 'btn', type: 'button', text: 'Sign out', onclick: () => ask(signOutBtn, 'Sign out',
    'Sign out of sync on this browser. Keep the journal here too?', [
      h('button', { class: 'btn', type: 'button', text: 'Keep it here', onclick: () => out(false) }),
      h('button', { class: 'btn red', type: 'button', text: 'Remove it from this browser', onclick: () => out(true) }),
    ], [h('span', { class: 'muted small', text: 'Removing also deletes unsaved drafts here.' }), snapshotLine()].filter(Boolean)) });
  const deleteBtn = h('button', { class: 'btn quiet', type: 'button', text: 'Delete synced copy', onclick: () => ask(deleteBtn, 'Delete synced copy',
    'Delete the synced copy from the server? This browser keeps its journal. Your other devices stop syncing.', [
      h('button', { class: 'btn red', type: 'button', text: 'Delete synced copy', onclick: async () => {
        running(true);
        try {
          await syncer.deleteAccount({ account: shown });
          track('sync-delete');
          toast(`Deleted. You can also remove the passkey “${r.label}” from your passwords app.`, { ms: 8000 });
          render();
        } catch (e) { toast(e.message, { warn: true }); render(); }
      } }),
    ], [], { focusCancel: true }) });
  return fill(box,
    h('h2', { text: 'Sync' }),
    status,
    h('div', { class: 'row' }, signOutBtn),
    area,
    moreBox(
      h('button', { class: 'btn', type: 'button', text: 'Sync now', onclick: async () => { await syncer.syncNow(); refresh(); } }),
      ...more,
      deleteBtn));
}

/**
 * Re-render on sync news while `root` is on screen. Never while the reader is in
 * the middle of something (an open editor or confirm box): the save or cancel that
 * ends it re-renders anyway, from the merged journal.
 */
export function onSyncNews(root, render, { onlyWhenChanged = false } = {}) {
  const handler = (e) => {
    if (!root.isConnected) { removeEventListener('tao:sync', handler); return; }
    if (onlyWhenChanged && !e.detail?.changed && !e.detail?.signedOut) return;
    if (root.querySelector('textarea, input, .confirm')) return;
    render();
  };
  addEventListener('tao:sync', handler);
}
