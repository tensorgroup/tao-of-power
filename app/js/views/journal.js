// All entries, edit/delete, export/import with merge.
import { h, fill, fmtDate, toast, keepAboveKeyboard } from '../ui.js';
import { state, syncer } from '../app.js';
import { syncSection, onSyncNews } from './sync-ui.js';
import {
  reviseEntry, deleteEntry, deleteDraw, replaceJournal, validate, merge, toExport, exportFilename, snapshot, emptyJournal, SNAPSHOT_KEY,
  keptSnapshot,
} from '../journal.js';
import { getIndex } from '../data.js';
import { track } from '../track.js';
import { jumpTo } from '../margin.js';
import { typedText } from '../drafts.js';

const DAY = 86400000;

export async function journalView() {
  const idx = await getIndex();
  const root = h('section', {});
  // After a save: build the page again, but not over typed text in an open edit (the item that saved shows
  // its new text by itself).
  const rerender = () => { if (!typedText(root)) render(); };
  const render = () => {
    const j = state.journal;
    const entries = [...j.entries].reverse().filter((e) => !e.at);
    const tabs = [...j.entries].filter((e) => e.at).sort((a, b) => a.passage - b.passage || Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const last = j.lastExportAt ? Date.parse(j.lastExportAt) : null;
    const newer = j.entries.filter((e) => !last || Date.parse(e.updatedAt) > last).length;
    const exportBtn = h('button', { class: 'btn', type: 'button', text: 'Export', onclick: () => doExport(rerender) });
    const local = !syncer.record(); // sync is off: the export is the only copy, so Export stays in view
    fill(root,
      h('h1', { text: 'Journal' }),
      h('p', { class: 'muted', text: `${j.entries.length} entr${j.entries.length === 1 ? 'y' : 'ies'} · ${j.draws.length} draw${j.draws.length === 1 ? '' : 's'}` }),
      local ? backupNote(last, newer) : null,
      local ? h('div', { class: 'row' }, exportBtn) : null,
      syncSection(render, { more: [
        local ? null : exportBtn,
        h('button', { class: 'btn', type: 'button', text: 'Import', onclick: () => doImport(rerender) }),
      ] }),
      restoreBox(rerender),
      tabs.length ? h('details', { class: 'legge tab-list', open: true }, h('summary', { text: `Margin tabs (${tabs.length})` }),
        entryList(tabs, { showPassage: true, idx, onChange: rerender })) : null,
      entries.length ? entryList(entries, { showPassage: true, idx, onChange: rerender })
        : tabs.length ? null : h('div', { class: 'empty' },
          h('p', { class: 'muted', text: 'No entries yet. Draw a passage and write what arises.' }),
          h('a', { class: 'btn red', href: '#/', text: 'Draw a passage' })),
      draws(j, idx, rerender));
  };
  render();
  onSyncNews(root, render, { onlyWhenChanged: true }); // a status-only sync must not close open confirm boxes
  return root;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The journal kept aside by the last Replace, with a button to merge it back (none when it is empty: keptSnapshot). */
function restoreBox(render) {
  const kept = keptSnapshot();
  if (!kept) return null;
  const what = [kept.entries ? plural(kept.entries, 'entry', 'entries') : null, kept.draws ? plural(kept.draws, 'draw', 'draws') : null].filter(Boolean).join(', ');
  return h('p', { class: 'backup' }, `A journal saved before your last Replace is kept (${what}). `,
    h('button', { class: 'btn quiet small-btn', type: 'button', text: 'Restore it (merge)', onclick: () => {
      // Read the snapshot again inside the change: a removal in another tab may have removed it meanwhile.
      state.change(() => { const k = keptSnapshot(); if (!k) return false; state.journal = merge(state.journal, k.journal); return true; }, () => {
        try { localStorage.removeItem(SNAPSHOT_KEY); } catch {}
        toast('Restored and merged.');
        render();
      }, 'The kept journal is gone (removed in another tab). Nothing changed.');
    } }));
}

function backupNote(last, newer) {
  if (!newer) return last ? h('p', { class: 'muted small', text: `Last backup ${Math.round((Date.now() - last) / DAY)} day(s) ago.` }) : null;
  const age = last ? `Last backup ${Math.round((Date.now() - last) / DAY)} day(s) ago. ` : 'Not backed up yet. ';
  return h('p', { class: 'backup', text: `${age}${newer} entr${newer === 1 ? 'y is' : 'ies are'} only in this browser. Turn on sync, or Export it now.` });
}

export function entryList(entries, { showPassage, idx, onChange }) {
  const change = state.editor(); // the list was built from this account's journal: its edits belong to it
  return h('ul', { class: 'entries' }, entries.map((e) => entryItem(e, { showPassage, idx, onChange, change })));
}

// One entry, with Edit and Delete. A save shows its result in this item; onChange() then builds the list
// again, unless another open edit holds typed text.
function entryItem(e, { showPassage, idx, onChange, change }) {
  const li = h('li', { class: 'entry' });
  let cur = e; // the entry as last saved
  const view = () => fill(li,
    h('div', { class: 'meta' },
      h('time', { datetime: cur.createdAt, text: fmtDate(cur.createdAt) }),
      cur.updatedAt !== cur.createdAt ? h('span', { text: `edited ${fmtDate(cur.updatedAt)}` }) : null,
      showPassage ? h('a', { href: `#/p/${cur.passage}`, onclick: cur.at ? () => jumpTo(cur.passage, cur.at.key) : null, text: `${cur.passage}${idx?.passages?.[cur.passage]?.title ? ` · ${idx.passages[cur.passage].title}` : ''}` }) : null),
    cur.at?.snip && showPassage ? h('p', { class: 'entry-q entry-at', text: `Beside: ${cur.at.snip}` }) : null,
    cur.q?.claim ? h('p', { class: 'entry-q', text: cur.q.claim }) : null,
    h('div', { class: 'text', text: cur.text }),
    h('div', { class: 'tools' },
      h('button', { class: 'btn quiet', type: 'button', text: 'Edit', onclick: edit }),
      h('button', { class: 'btn quiet', type: 'button', text: 'Delete', onclick: askDelete })));
  const edit = () => {
    const ta = keepAboveKeyboard(h('textarea', { 'aria-label': 'Edit entry' }));
    ta.defaultValue = cur.text; // typedText() compares with it
    ta.value = cur.text;
    li.replaceChildren(h('div', { class: 'jedit' }, ta, h('div', { class: 'tools' },
      h('button', { class: 'btn primary', type: 'button', text: 'Save', onclick: () => {
        const t = ta.value.trim();
        if (!t) return;
        let saved = null;
        // During a removal the save waits: it then saves the text in the box at that time (typed on since).
        // An entry removed meanwhile is saved as a new entry (reviseEntry), so the text is never lost.
        change(() => (saved = reviseEntry(state.journal, cur, (ta.isConnected && ta.value.trim()) || t)), () => {
          cur = saved;
          view();
          onChange();
        });
      } }),
      h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: view }))));
    ta.focus();
  };
  const askDelete = () => {
    li.append(h('div', { class: 'confirm' }, h('span', { text: 'Delete this entry?' }),
      h('button', { class: 'btn red', type: 'button', text: 'Delete', onclick: () => {
        change(() => { deleteEntry(state.journal, cur.id); return true; }, () => { li.remove(); onChange(); });
      } }),
      h('button', { class: 'btn quiet', type: 'button', text: 'Keep', onclick: view })));
  };
  view();
  return li;
}

function draws(j, idx, render) {
  const list = [...j.draws].reverse().slice(0, 30);
  if (!list.length) return null;
  const item = (d) => {
    const li = h('li', { class: 'entry' });
    const view = () => fill(li, h('div', { class: 'meta draw-row' },
      h('time', { datetime: d.at, text: fmtDate(d.at) }),
      h('a', { href: `#/p/${d.passage}`, text: `${d.passage}${idx?.passages?.[d.passage]?.title ? ` · ${idx.passages[d.passage].title}` : ''}` }),
      h('button', { class: 'btn quiet small-btn', type: 'button', text: 'Remove', 'aria-label': `Remove draw of passage ${d.passage} from history`, onclick: ask })));
    const ask = () => li.append(h('div', { class: 'confirm' }, h('span', { text: 'Remove this draw from the history?' }),
      h('button', { class: 'btn red', type: 'button', text: 'Remove', onclick: () => {
        state.change(() => { deleteDraw(state.journal, d.id); return true; }, () => { track('draw-remove'); li.remove(); render(); });
      } }),
      h('button', { class: 'btn quiet', type: 'button', text: 'Keep', onclick: view })));
    view();
    return li;
  };
  return h('details', { class: 'legge draw-history' }, h('summary', { text: `Draw history (${j.draws.length})` }),
    h('ul', { class: 'entries' }, list.map(item)));
}

async function doExport(render) {
  const at = new Date().toISOString();
  const name = exportFilename();
  const blob = new Blob([toExport({ ...state.journal, lastExportAt: at })], { type: 'application/json' });
  const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  try {
    if (file && standalone && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Tao journal' });
    } else {
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    state.change(() => { state.journal.lastExportAt = at; return true; });
    track('journal-export');
    toast('Journal exported.');
  } catch (e) {
    if (e?.name !== 'AbortError') toast(`Export failed: ${e.message || e}`, { warn: true });
  }
  render();
}

function doImport(render) {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    let obj;
    try { obj = JSON.parse(await f.text()); } catch { toast('That file is not valid JSON. Nothing changed.', { warn: true }); return; }
    const r = validate(obj);
    if (!r.ok) { toast(`${r.reason} Nothing changed.`, { warn: true, ms: 6000 }); return; }
    const before = state.journal.entries.length;
    track('journal-import');
    showImportChoice(r.journal, before, render);
  });
  input.click();
}

function showImportChoice(incoming, before, render) {
  const view = document.getElementById('view');
  const box = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Import' },
    h('span', { text: `File has ${incoming.entries.length} entries. Merge combines both journals; where they disagree, the newer edit or deletion wins.` }),
    h('button', { class: 'btn primary', type: 'button', text: 'Merge', onclick: () => {
      let added = 0, removed = 0;
      state.change(() => {
        const beforeIds = new Set(state.journal.entries.map((e) => e.id));
        state.journal = merge(state.journal, incoming);
        const afterIds = new Set(state.journal.entries.map((e) => e.id));
        added = [...afterIds].filter((id) => !beforeIds.has(id)).length;
        removed = [...beforeIds].filter((id) => !afterIds.has(id)).length;
        return true;
      }, () => {
        toast(`Merged: ${added} added${removed ? `, ${removed} removed by newer deletions` : ''}.`);
        render();
      });
    } }),
    syncer.record() ? null : h('button', { class: 'btn quiet', type: 'button', text: 'Replace…', onclick: () => {
      box.replaceChildren(h('span', { text: 'Replace deletes this browser’s journal (a snapshot is kept). Sure?' }),
        h('button', { class: 'btn red', type: 'button', text: 'Replace', onclick: () => {
          // The snapshot is written inside the change, so it goes through the same gate as the save.
          state.change(() => {
            if (!snapshot(state.journal)) return false;
            state.journal = replaceJournal(state.journal, incoming);
            return true;
          }, () => {
            toast('Replaced. The previous journal is saved — use “Restore” on this page to bring it back.');
            render();
          }, 'Could not save a snapshot (storage full). Export first, then replace.');
        } }),
        h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => box.remove() }));
    } }),
    h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => box.remove() }));
  const anchor = view.querySelector('.sync-box');
  if (anchor) anchor.after(box); else view.querySelector('section')?.prepend(box);
}
