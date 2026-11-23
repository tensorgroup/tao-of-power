// All entries, edit/delete, export/import with merge.
import { h, fmtDate, toast } from '../ui.js';
import { state } from '../app.js';
import {
  updateEntry, deleteEntry, validate, merge, toExport, exportFilename, snapshot, emptyJournal, SNAPSHOT_KEY,
} from '../journal.js';
import { getIndex } from '../data.js';

const DAY = 86400000;

export async function journalView() {
  const idx = await getIndex();
  const root = h('section', {});
  const render = () => {
    const j = state.journal;
    const entries = [...j.entries].reverse();
    const last = j.lastExportAt ? Date.parse(j.lastExportAt) : null;
    const newer = j.entries.filter((e) => !last || Date.parse(e.updatedAt) > last).length;
    root.replaceChildren(
      h('h1', { text: 'Journal' }),
      h('p', { class: 'muted', text: `${j.entries.length} entr${j.entries.length === 1 ? 'y' : 'ies'} · ${j.draws.length} draw${j.draws.length === 1 ? '' : 's'}` }),
      backupNote(last, newer),
      restoreBox(render),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', text: 'Export', onclick: () => doExport(render) }),
        h('button', { class: 'btn', type: 'button', text: 'Import', onclick: () => doImport(render) })),
      entries.length ? entryList(entries, { showPassage: true, idx, onChange: render })
        : h('p', { class: 'muted', style: null, text: 'No entries yet. Draw a passage and write what arises.' }),
      draws(j, idx),
    );
  };
  render();
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
  return h('p', { class: 'backup', text: `${age}${newer} entr${newer === 1 ? 'y is' : 'ies are'} only in this browser. Export to keep them safe.` });
}

export function entryList(entries, { showPassage, idx, onChange }) {
  return h('ul', { class: 'entries' }, entries.map((e) => entryItem(e, { showPassage, idx, onChange })));
}

function entryItem(e, { showPassage, idx, onChange }) {
  const li = h('li', { class: 'entry' });
  const view = () => li.replaceChildren(
    h('div', { class: 'meta' },
      h('time', { datetime: e.createdAt, text: fmtDate(e.createdAt) }),
      e.updatedAt !== e.createdAt ? h('span', { text: `edited ${fmtDate(e.updatedAt)}` }) : null,
      showPassage ? h('a', { href: `#/p/${e.passage}`, text: `${e.passage}${idx?.passages?.[e.passage]?.title ? ` · ${idx.passages[e.passage].title}` : ''}` }) : null),
    h('div', { class: 'text', text: e.text }),
    h('div', { class: 'tools' },
      h('button', { class: 'btn quiet', type: 'button', text: 'Edit', onclick: edit }),
      h('button', { class: 'btn quiet', type: 'button', text: 'Delete', onclick: askDelete })));
  const edit = () => {
    const ta = h('textarea', { 'aria-label': 'Edit entry' });
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

function draws(j, idx) {
  const list = [...j.draws].reverse().slice(0, 30);
  if (!list.length) return null;
  return h('details', { class: 'legge' }, h('summary', { text: `Draw history (${j.draws.length})` }),
    h('ul', { class: 'entries' }, list.map((d) => h('li', { class: 'entry' }, h('div', { class: 'meta' },
      h('time', { datetime: d.at, text: fmtDate(d.at) }),
      h('a', { href: `#/p/${d.passage}`, text: `${d.passage}${idx?.passages?.[d.passage]?.title ? ` · ${idx.passages[d.passage].title}` : ''}` }))))));
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
    h('button', { class: 'btn quiet', type: 'button', text: 'Replace…', onclick: () => {
      box.replaceChildren(h('span', { text: 'Replace deletes this browser’s journal (a snapshot is kept). Sure?' }),
        h('button', { class: 'btn red', type: 'button', text: 'Replace', onclick: () => {
          if (!snapshot(state.journal)) { toast('Could not save a snapshot (storage full). Export first, then replace.', { warn: true, ms: 7000 }); return; }
          state.journal = merge(emptyJournal(), incoming);
          if (state.persist()) toast('Replaced. The previous journal is saved — use “Restore” on this page to bring it back.');
          render();
        } }),
        h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => box.remove() }));
    } }),
    h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => box.remove() }));
  view.querySelector('section')?.insertBefore(box, view.querySelector('section').children[3] || null);
}
