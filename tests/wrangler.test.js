// wrangler.jsonc: the Worker's domain and rate-limit bindings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** JSONC as Wrangler reads it: line and block comments, trailing commas; a string may hold "//". */
function readJsonc(url) {
  const src = readFileSync(url, 'utf8');
  let out = '';
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (src.startsWith('/*', i)) {
      i = src.indexOf('*/', i + 2) + 1;
    } else out += src[i];
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const cfg = () => readJsonc(new URL('../wrangler.jsonc', import.meta.url));

test('the Worker answers only on tao.tensor.group: no workers.dev or preview URLs', () => {
  // Passkeys are bound to RP_ID; on a *.workers.dev or preview origin they fail, and that copy of the
  // site would keep a separate journal in the browser.
  const c = cfg();
  assert.equal(c.workers_dev, false);
  assert.equal(c.preview_urls, false);
  assert.deepEqual(c.routes, [{ pattern: 'tao.tensor.group', custom_domain: true }]);
  assert.equal(c.vars.RP_ID, 'tao.tensor.group');
});

test('every rate limit the Worker reads is bound, ids 4111-4114, none shared', () => {
  // EVENTS_LIMIT fails open (analytics), so a missing binding would never show as an error.
  const c = cfg();
  const byName = Object.fromEntries(c.ratelimits.map((r) => [r.name, r]));
  for (const name of ['AUTH_LIMIT', 'SYNC_LIMIT', 'SIGNUP_LIMIT', 'EVENTS_LIMIT']) assert.ok(byName[name], name);
  const ids = c.ratelimits.map((r) => Number(r.namespace_id));
  assert.equal(new Set(ids).size, ids.length, 'no id is used twice');
  for (const id of ids) assert.ok(id >= 4111 && id <= 4114, String(id));
  assert.deepEqual(byName.EVENTS_LIMIT.simple, { limit: 60, period: 60 });
});
