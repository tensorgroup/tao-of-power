// All entries, edit/delete, export/import with merge.
import { h, fill, fmtDate, toast, keepAboveKeyboard } from '../ui.js';
import { state, syncer } from '../app.js';
import { syncSection, onSyncNews } from './sync-ui.js';
import {
  updateEntry, deleteEntry, deleteDraw, replaceJournal, validate, merge, toExport, exportFilename, snapshot, emptyJournal, SNAPSHOT_KEY,
} from '../journal.js';
import { getIndex } from '../data.js';
import { track } from '../track.js';
import { jumpTo } from '../margin.js';

const DAY = 86400000;

export async function journalView() {
  const idx = await getIndex();
  const root = h('section', {});
  const render = () => {
    const j = state.journal;
    const entries = [...j.entries].reverse().filter((e) => !e.at);
    const tabs = [...j.entries].filter((e) => e.at).sort((a, b) => a.passage - b.passage || Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const last = j.lastExportAt ? Date.parse(j.lastExportAt) : null;
    const newer = j.entries.filter((e) => !last || Date.parse(e.updatedAt) > last).length;
    fill(root,
      h('h1', { text: 'Journal' }),
      h('p', { class: 'muted', text: `${j.entries.length} entr${j.entries.length === 1 ? 'y' : 'ies'} · ${j.draws.length} draw${j.draws.length === 1 ? '' : 's'}` }),
      syncer.record() ? null : backupNote(last, newer),
      syncSection(render, { more: [
        h('button', { class: 'btn', type: 'button', text: 'Export', onclick: () => doExport(render) }),
        h('button', { class: 'btn', type: 'button', text: 'Import', onclick: () => doImport(render) }),
      ] }),
      restoreBox(render),
      tabs.length ? h('details', { class: 'legge tab-list', open: true }, h('summary', { text: `Margin tabs (${tabs.length})` }),
        entryList(tabs, { showPassage: true, idx, onChange: render })) : null,
      entries.length ? entryList(entries, { showPassage: true, idx, onChange: render })
        : tabs.length ? null : h('div', { class: 'empty' },
          h('p', { class: 'muted', text: 'No entries yet. Draw a passage and write what arises.' }),
          h('a', { class: 'btn red', href: '#/', text: 'Draw a passage' })),
      draws(j, idx, render));
  };
  render();
  onSyncNews(root, render, { onlyWhenChanged: true }); // a status-only sync must not close open confirm boxes
  return root;
}

function restoreBox(render) {
  let snap = null;
  try { snap = validate(JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null')); } catch { snap = null; }
  if (!snap?.ok) return null;
  return h('p', { class: 'backup' }, `A journal saved before your last Replace is kept (${snap.journal.entries.length} entries). `,
    h('button', { class: 'btn quiet small-btn', type: 'button', text: 'Restore it (merge)', onclick: () => {
      state.journal = merge(state.journal, snap.journal);
      if (state.persist()) { try { localStorage.removeItem(SNAPSHOT_KEY); } catch {} toast('Restored and merged.'); }
      render();
    } }));
}

function backupNote(last, newer) {
  if (!newer) return last ? h('p', { class: 'muted small', text: `Last backup ${Math.round((Date.now() - last) / DAY)} day(s) ago.` }) : null;
  const age = last ? `Last backup ${Math.round((Date.now() - last) / DAY)} day(s) ago. ` : 'Not backed up yet. ';
  return h('p', { class: 'backup', text: `${age}${newer} entr${newer === 1 ? 'y is' : 'ies are'} only in this browser. Turn on sync, or use Export under More.` });
}

export function entryList(entries, { showPassage, idx, onChange }) {
  return h('ul', { class: 'entries' }, entries.map((e) => entryItem(e, { showPassage, idx, onChange })));
}

function entryItem(e, { showPassage, idx, onChange }) {
  const li = h('li', { class: 'entry' });
  const view = () => fill(li,
    h('div', { class: 'meta' },
      h('time', { datetime: e.createdAt, text: fmtDate(e.createdAt) }),
      e.updatedAt !== e.createdAt ? h('span', { text: `edited ${fmtDate(e.updatedAt)}` }) : null,
      showPassage ? h('a', { href: `#/p/${e.passage}`, onclick: e.at ? () => jumpTo(e.passage, e.at.key) : null, text: `${e.passage}${idx?.passages?.[e.passage]?.title ? ` · ${idx.passages[e.passage].title}` : ''}` }) : null),
    e.at?.snip && showPassage ? h('p', { class: 'entry-q entry-at', text: `Beside: ${e.at.snip}` }) : null,
    e.q?.claim ? h('p', { class: 'entry-q', text: e.q.claim }) : null,
    h('div', { class: 'text', text: e.text }),
    h('div', { class: 'tools' },
      h('button', { class: 'btn quiet', type: 'button', text: 'Edit', onclick: edit }),
      h('button', { class: 'btn quiet', type: 'button', text: 'Delete', onclick: askDelete })));
  const edit = () => {
    const ta = keepAboveKeyboard(h('textarea', { 'aria-label': 'Edit entry' }));
    ta.value = e.text;
    li.replaceChildren(h('div', { class: 'jedit' }, ta, h('div', { class: 'tools' },
      h('button', { class: 'btn primary', type: 'button', text: 'Save', onclick: () => {
        const t = ta.value.trim();
        if (!t) return;
        updateEntry(state.journal, e.id, t);
        if (state.persist()) onChange();
      } }),
      h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: view }))));
    ta.focus();
  };
  const askDelete = () => {
    li.append(h('div', { class: 'confirm' }, h('span', { text: 'Delete this entry?' }),
      h('button', { class: 'btn red', type: 'button', text: 'Delete', onclick: () => {
        deleteEntry(state.journal, e.id);
        if (state.persist()) onChange();
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
        deleteDraw(state.journal, d.id);
        if (state.persist()) { track('draw-remove'); render(); }
      } }),
      h('button', { class: 'btn quiet', type: 'button', text: 'Keep', onclick: view })));
    view();
    return li;
  };
  return h('details', { class: 'legge draw-history' }, h('summary', { text: `Draw history (${j.draws.length})` }),
    h('ul', { class: 'entries' }, list.map(item)));
}

async function doExport(render) {
  const j = state.journal;
  const prev = j.lastExportAt;
  j.lastExportAt = new Date().toISOString();
  const name = exportFilename();
  const blob = new Blob([toExport(j)], { type: 'application/json' });
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
    state.persist();
    track('journal-export');
    toast('Journal exported.');
  } catch (e) {
    j.lastExportAt = prev;
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
      const beforeIds = new Set(state.journal.entries.map((e) => e.id));
      state.journal = merge(state.journal, incoming);
      const afterIds = new Set(state.journal.entries.map((e) => e.id));
      const added = [...afterIds].filter((id) => !beforeIds.has(id)).length;
      const removed = [...beforeIds].filter((id) => !afterIds.has(id)).length;
      if (state.persist()) toast(`Merged: ${added} added${removed ? `, ${removed} removed by newer deletions` : ''}.`);
      render();
    } }),
    syncer.record() ? null : h('button', { class: 'btn quiet', type: 'button', text: 'Replace…', onclick: () => {
      box.replaceChildren(h('span', { text: 'Replace deletes this browser’s journal (a snapshot is kept). Sure?' }),
        h('button', { class: 'btn red', type: 'button', text: 'Replace', onclick: () => {
          if (!snapshot(state.journal)) { toast('Could not save a snapshot (storage full). Export first, then replace.', { warn: true, ms: 7000 }); return; }
          state.journal = replaceJournal(state.journal, incoming);
          if (state.persist()) toast('Replaced. The previous journal is saved — use “Restore” on this page to bring it back.');
          render();
        } }),
        h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => box.remove() }));
    } }),
    h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => box.remove() }));
  const anchor = view.querySelector('.sync-box');
  if (anchor) anchor.after(box); else view.querySelector('section')?.prepend(box);
}
