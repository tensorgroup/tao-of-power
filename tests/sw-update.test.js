import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controllerChange } from '../app/js/sw-update.js';

test('V10: the first visit\'s claim does not reload; a later update\'s controllerchange does, once', () => {
  let reloads = 0;
  const on = controllerChange({ hadController: false, chosen: () => true, reload: () => { reloads++; } });
  on(); // the first service worker claims the page
  assert.equal(reloads, 0);
  on(); // "Refresh" on a later update: skipWaiting, then controllerchange
  assert.equal(reloads, 1);
  on();
  assert.equal(reloads, 1, 'one reload only');
});

test('V10: a page that had a controller reloads on its first controllerchange', () => {
  let reloads = 0;
  const on = controllerChange({ hadController: true, chosen: () => true, reload: () => { reloads++; } });
  on();
  assert.equal(reloads, 1);
});

test('A9: only the tab that tapped Refresh reloads; another tab is told and reloads only when its reader asks', () => {
  let reloads = 0; let told = 0; let chose = false;
  const on = controllerChange({ hadController: true, chosen: () => chose, reload: () => { reloads++; }, onOther: () => { told++; } });
  on(); // Refresh was tapped in another tab
  assert.deepEqual([reloads, told], [0, 1]);
  chose = true; // (a later update, tapped here)
  on();
  assert.deepEqual([reloads, told], [1, 1]);
});
