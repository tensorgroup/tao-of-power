# Back-port Book of Changes Core Fixes to the Tao App: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Per-commit verdicts

Book of Changes (BoC) commits are in `/Users/billyz/code/book-of-changes`. Tao paths are relative to `/Users/billyz/code/tao-of-power`. Each verdict below was checked against the current Tao code at `ca25405`.

| BoC commit | Fix | Tao location | Verdict | Reason | Task |
|---|---|---|---|---|---|
| ec86bbc | A failed SW install deletes the live shell cache | `app/sw.js:351-356` | applies | `caches.delete(CACHE)` runs on every failure. A lazy-only release keeps the same `tao-${VERSION}` name. | 1 |
| 223b68a | Analytics body read without a cap | `worker/index.js:16-17` | applies | `request.text()` reads the whole body first. The limit also counts UTF-16 units, not bytes. | 2 |
| 4eade92 | Sync body read without a cap (chunked) | `worker/sync.js:106-111` | applies | The same `request.text()` before the size check. | 2 |
| e4852c5 | Lost counter race still gets a session | `worker/sync.js:191` | applies | `counter <= ?`, and the changed-row count is not checked. | 3 |
| c26d3fd | A missing rate-limit binding fails open | `worker/sync.js:61-66` | applies | `if (!binding?.limit) return false`. | 3 |
| d748b1c (sync part) | DELETE account has no rate limit | `worker/sync.js:267` | applies | `deleteAccount` runs with no `limited()` call. | 3 |
| 2048f06 (Worker part) | Sync and delete are not tied to an account | `worker/sync.js:196-232` | applies | The Worker uses the cookie's account only. | 3 |
| 9c7e5b6 | Worker stores DNT/GPC, foreign-origin, and unlimited events | `worker/index.js:14-29` | applies | No header check, no Origin check, no limit. | 4 |
| d748b1c (analytics part) | Analytics POST with no Origin and no Sec-Fetch-Site | `worker/index.js:14` | applies | No Origin rule at all. | 4 |
| c56df0c | workers.dev and preview URLs on | `wrangler.jsonc` (keys not set) | applies | Passkeys fail there, and that copy keeps its own journal. | 5 |
| 2048f06 (client part) | Answer merged into another account; delete after a failed sync | `app/js/sync.js:44-66`, `:156-168`; `app/js/app.js:44-50` | applies | Same code shape as the BoC code before the fix. | 6 |
| 0a26ddd | Wipe does not reach other tabs; wipe after the logout trip | `app/js/sync.js:145-154`; `app/js/app.js:121-125` | applies | The other tabs re-render only on `#/journal`. Drafts can come back. | 7 |
| 2048f06 (UI part) | Confirm box stays after an account change; refresh off the page | `app/js/views/sync-ui.js:102-109` | applies | Same `refresh`/`onNews` code. | 8 |
| b73bb3c | Confirm boxes do not move focus; no h2; empty restore offer | `app/js/views/sync-ui.js:111-113`, `:132-148`; `app/js/views/journal.js:44-54` | applies | Same gaps. Tao also shows "(0 entries)" and does not count draws. | 8 |
| 85ed6ba | Export hidden in "More" while sync is off | `app/js/views/journal.js:26-29`, `:56-61` | applies | Export sits in More, and `backupNote` says "use Export under More". | 8 |
| adefee3 | Analytics sends any fragment as the path | `app/js/track.js:34-40`; `app/js/app.js:115` | applies | The not-found route sends its raw fragment. | 9 |
| a1c2ebe | vecs.bin size not checked | `app/js/views/search.js:14-22` | applies | `new Int8Array(buf)` with no count × dim check. | 10 |
| 9a746e7 | Index and vectors from different builds | `app/js/views/search.js:14-22`; `scripts/build-search.mjs:61-72` | applies | No hash pairs the two files. The old SW stores a newer vecs.bin in the old versioned cache. | 10 |
| 3b189c4 | Search counted twice, counted under the next page, count not cleared | `app/js/views/search.js:99-115` | applies | `track` is scheduled in every `run()`, also when the index or model arrives. | 11 |
| 599a5d0 (from the 80-commit scan) | Made-up words show 40 weak results | `app/js/search-core.js:118-143`; `app/js/views/search.js:110-114` | applies | Same cutoff. No exact flag, no known-word test. | 12 |
| 88c3f02 | Quick taps speak the old character | `app/js/audio.js:52-78` | applies | Same shared-generation code. `onended` goes on the wrong sound. | 13 |
| 7254195 | A failed recording list load is kept for the visit | `app/js/audio.js:23` | applies | `.catch(() => new Set())` is cached. `r.ok` is not checked. | 13 |
| 37a31c5 | Two lit cells when another row starts | `app/js/listen.js:201` | applies | Tao has a Chinese row and an English row on each passage page. | 14 |
| 9c3e5ba | A take that check-audio would refuse is written | `scripts/build-audio.mjs:192-196`, `:231-232`; `scripts/check-audio.mjs:77-81` | applies | `enCheckTimes` has no 30 ms gap rule. spreadTimes can leave 20 ms gaps. | 15 |
| e98059d | Loose flag parsing; shared tmp file; no lock | `scripts/build-audio.mjs:313-384`, `:67-69` | applies | A misspelled flag is ignored. `--drop 3 5` ignores 5. `--list` beats `--drop`. One `listen.json.tmp` is shared. (Tao has no `--estimate` flag.) | 15 |
| 1f0936d | Cells lit from a recording of another text | `app/js/views/passage.js:285-287`; `scripts/build-audio.mjs:267-281` | applies (low) | The page checks counts only. `npm run check` (src hash) gates deploys, so this is defense in depth. | 16 (optional) |
| e08643a | `--ink-3` under WCAG AA | `app/css/app.css:12` | applies | `#7c7466` gives 4.03 on paper, 3.65 on paper-2, and 3.60 on the sync-card wash. | 17 |
| c33b52b (scan) | Search result links 38 px tall | `app/css/app.css:611` | applies | `min-height: 38px`. | 17 |
| 9227b98 (scan) | Sticky Listen row is two lines, text shows under it | `app/css/app.css:258-260` | applies | Same 11.5em button and `bottom: env(...)`. | 17 |
| 37a31c5/1f0936d/7254195 `app/sw.js` hunks | Precache version bumps | n/a | not relevant | Generated. Task 18 runs `npm run precache`. | 18 |
| e98059d `.gitignore` | `.listen.lock` ignored | `.gitignore` | applies | This change goes with Task 15. | 15 |
| 5383d27 (scan) | Header too wide at 320 px | `app/css/app.css:587-589` | already fixed | Tao has its own `max-width: 22rem` rule. Check it at 320 px in Task 18. | 18 (check only) |
| 3cc23aa (scan) | `.assetsignore` precached, install 404 | `scripts/build-precache.mjs:18,32` | already fixed | Names that start with "." are skipped. | none |
| 2a41651 (scan) | `sources/raw` ignored as a symlink too | `.gitignore:5` | not relevant now | `sources/raw` is a real folder. Optional one-character change in Task 5. | 5 (optional) |
| cfef016 (scan) | A query that names a document ranks first | n/a | not relevant | This is a feature, not a bug fix. | none |
| 79e8d31, a56bd1c, a72e03f, 765fd6b, 2cde6b5 (scan) | Tests, comments, docs, and precache bumps of the BoC core | n/a | not relevant | Nothing to port. | none |

---

**Goal:** Fix the bugs in the Tao app that the BoC review panels found and fixed in the core that was ported from Tao.

**Architecture:** Each task ports one BoC fix (or a tight group of fixes) into the Tao file that has the same code. Tao names stay: `tao.` storage keys, `tao:` events, the `tao-` cache prefix, the D1 bindings `tao_sync` and `tao_analytics`. Where the Tao code has no seam for tests (views that touch the DOM), move the logic into a small pure function and test that function.

**Tech Stack:** Plain ES modules, node:test (Node 22), Cloudflare Workers + D1 + rate-limit bindings, wrangler 4.168.0.

**Spec:** The BoC commit messages and diffs above (`git -C /Users/billyz/code/book-of-changes show <sha>`). Read the diff for your task before you start. The BoC code is the reference behavior. Adapt the names to Tao.

## Global Constraints

- Run `npm test` and `npm run check` before you say a task is done. The baseline is 268 tests, all passing.
- Run `npm run precache` after any change under `app/` (Task 18 does it once at the end; run it earlier if you test the PWA).
- New test files go in `tests/*.test.js` (top level). `npm test` runs only `tests/*.test.js`.
- DOM: build nodes with `h()`. Replace children with `fill()`. Never use `innerHTML`.
- Never log or echo journal text in the Worker or the client.
- The journal export format stays backward compatible. New fields are optional.
- No new external origins in the CSP.
- Analytics: never send typed text, journal content, IPs, or UA strings.
- Do not change `/Users/billyz/code/tensor-tarot` or `/Users/billyz/code/book-of-changes`.
- Commit only when Billy asks (global rule). The "Commit" steps below are commit points: stage the files, and commit only with his go.

## Review Focus

1. **Old installed clients after the deploy.** An installed PWA can run the old JS for days. That JS sends `/api/journal/sync` with no `account` field and `DELETE /api/account` with no body. The Worker must accept a missing `account` and refuse only a mismatched one (Task 3). Otherwise sync stops for every reader who has not updated yet.
2. **Analytics from Safari or Brave on iOS.** The new rule drops a POST that has neither `Origin` nor `Sec-Fetch-Site: same-origin`. Test on the phone that `sendBeacon` from tao.tensor.group still lands (Task 4 deploy step).
3. **A wipe while another tab has an open draft.** The other tab must show the empty journal and must not save the draft back (Task 7, manual two-tab check).
4. **Rate-limit namespace sharing with tensor-tarot.** If both Workers are on one account, Tao `AUTH_LIMIT` (4101) and tarot `REFLECT_LIMIT` (4101) share counters (Task 5).
5. **A search typed while the model loads.** It must count once, not under the next page, and not after the box is cleared (Task 11 tests).

---

### Task 1: The SW install keeps the running worker's shell cache (ec86bbc)

**Files:**
- Modify: `app/sw.js:349-362` (install handler; outside the `<precache>` markers)
- Create: `tests/sw.test.js`

**Interfaces:**
- Produces: `loadSw(fetchLog, { store, src })` in `tests/sw.test.js`. Port it from `book-of-changes/tests/core/precache.test.js:102-150`. Use `importScripts` → `app/js/sw-range.js`. The cache names are `CACHE`, `MODEL_CACHE`, and the others; Tao has no `APP` name.

- [ ] **Step 1: Write the failing test.** Add `test('a failed update never deletes the shell cache that the running worker serves')`. v1 installs into a shared `store`. v2 is `app/sw.js` with `const MODEL_VERSION = '…'` replaced by `'00000000'`. Assert `v2.names.CACHE === v1.names.CACHE`. Go offline, `await assert.rejects(v2.run('install'))`, then assert that the shell keys are unchanged and that `v1.get('/')` still answers. The fake `addAll` throws while offline and changes nothing. The fake `caches` has `has()`.
- [ ] **Step 2: Add a second test.** Name it `test('a failed first install deletes the cache it made')`. With an empty store and offline, the install rejects and `store.has(CACHE)` is false.
- [ ] **Step 3: Run the tests and see the first one fail.** Run `node --test tests/sw.test.js`. Expected: the first test fails ("the old shell keeps every file").
- [ ] **Step 4: Implement.** In install, add `const existed = await caches.has(CACHE);` before `caches.open`. In the catch, delete only when `!existed`. Copy the comment from the BoC diff.
- [ ] **Step 5: Run the tests and see them pass.** Run `node --test tests/sw.test.js`. Then run `npm test`.
- [ ] **Step 6: Commit point.** `fix(sw): a failed update keeps the running worker's shell cache`.

### Task 2: Capped body reads for sync and analytics (223b68a, 4eade92)

**Files:**
- Create: `worker/body.js`
- Modify: `worker/sync.js:106-111` (`readJson`), `worker/index.js:16-17` (`record`)
- Create: `tests/helpers/stream.js` (port `book-of-changes/tests/core/helpers/stream.js`, `chunked(chunks)`)
- Test: `tests/sync-worker.test.js`, `tests/analytics-worker.test.js` (new; Task 4 adds to it)

**Interfaces:**
- Produces: `export async function readCapped(request: Request, max: number): Promise<string | null>`. It refuses a content-length over `max` before any read. It reads chunk by chunk and cancels at the first chunk past `max`. It returns `''` when there is no body. Copy it from `book-of-changes/worker/body.js`.
- Produces: `chunked(chunks: Uint8Array[]) → { body: ReadableStream, seen: { pulled, cancelled } }`.

- [ ] **Step 1: Write the failing tests.** In `tests/sync-worker.test.js`, add `test('a chunked sync body over 512 KB stops early with 413')`. Send 32 chunks of 64 KiB through `chunked()` with `duplex: 'half'`. Assert status 413, `seen.pulled <= 10`, and `seen.cancelled`. Also add `test('a body under the cap with a character split across chunks still syncs')`: split "é" (2 bytes) across two chunks and assert 200. In the new `tests/analytics-worker.test.js`, import `worker from '../worker/index.js'`. Use `env = { tao_analytics: fakeD1(new URL('../worker/schema.sql', import.meta.url).pathname), ORIGIN, ASSETS: { fetch: () => new Response('asset') } }`. Add `test('analytics refuses a chunked body over 4000 bytes')`: assert 413, the early stop, and no rows. Add `test('analytics counts bytes, not characters')`: a 1500-character Han `detail` is about 4.5 KB, so assert 413.
- [ ] **Step 2: Run the tests.** Run `node --test tests/sync-worker.test.js tests/analytics-worker.test.js`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** Create `worker/body.js`. Change `readJson` to `const text = await readCapped(request, MAX_BODY); if (text === null) return { tooLarge: true };`. In `record`, use `readCapped(request, 4000)`, and answer 413 on null. Delete the old `request.text()` lines. Keep the `enc` import in sync.js: the merged-size check uses it.
- [ ] **Step 4: Run the tests and see them pass.** Then run `npm test`.
- [ ] **Step 5: Commit point.** `fix(worker): read request bodies only up to their cap`.

### Task 3: Sync Worker hardening (e4852c5, c26d3fd, d748b1c, 2048f06 Worker part)

**Files:**
- Modify: `worker/sync.js:61-66`, `:191`, `:196-232`, `:243-267`
- Create: `tests/helpers/limits.js` (`openLimits()`, from `book-of-changes/tests/core/helpers/limits.js`)
- Modify: `tests/sync-worker.test.js` (`setup()` env, `stubLib()`), `tests/sync-fuzz.test.js:28` (env)

**Interfaces:**
- Produces: `async function overLimit(binding, request, env): Promise<Response | null>`. A missing binding gives 503 `unavailable`, except when `env.RP_ID === 'localhost'`. Over the limit gives 429 `slow-down`. Otherwise it gives null.
- Produces (wire contract, used by Task 6): the body of `POST /api/journal/sync` is `{ account?: string, journal }`, and the body of `DELETE /api/account` is `{ account?: string }`. **Tao adaptation:** a missing `account` is accepted (old installed clients). A present `account !== user.id` gives 409 `{ error: 'account-changed' }`. BoC refuses a missing account; Tao must not, at least for now (see Open Questions).

- [ ] **Step 1: Update the test setup.** Give `setup()` and the fuzz env `...openLimits()`. Change `stubLib()` so that `verifyAuthenticationResponse` returns `newCounter: stub.nextCounter` (default 0). Run `npm test`. Expected: still green.
- [ ] **Step 2: Write the failing tests.**
  - `test('a login whose counter does not move past the stored one starts no session; counter-0 passkeys still sign in')`: port the e4852c5 test. Use `env.tao_sync.raw` and the cookie `__Host-tao_s`.
  - `test('a missing rate-limit binding answers 503, except on localhost')`: delete `env.AUTH_LIMIT`. Assert 503 on `/api/auth/login/options`. With `env.RP_ID = 'localhost'`, assert 200. Do the same for `SIGNUP_LIMIT` (register/options) and `SYNC_LIMIT` (sync).
  - `test('delete account shares the sync rate limit')`: `SYNC_LIMIT` refuses, so the DELETE gives 429 and every row stays.
  - `test('a sync that names another account takes nothing (409); no account named is still accepted')`: sign up A and B. Sync with B's cookie and `account: A` gives 409, and B's `rev` stays 0. With no `account`, the sync gives 200.
  - `test('delete that names another account deletes nothing; no body still deletes')`.
- [ ] **Step 3: Run the tests.** Run `node --test tests/sync-worker.test.js`. Expected: the new tests fail.
- [ ] **Step 4: Implement.**
  - Replace `limited` with `overLimit` at all three call sites (`:245`, `:248`, `:264`), and add it before `deleteAccount` (`:267`).
  - At `:191`, use `const next = newCounter || 0; if (next > 0 || cred.counter > 0) { const res = …'… AND counter < ?'…; if (res.meta?.changes !== 1) return err(400, 'verify'); }`.
  - In `sync`, add `if (!body || typeof body !== 'object') return err(400, 'invalid'); if (body.account !== undefined && body.account !== user.id) return err(409, 'account-changed');`.
  - `deleteAccount(request, env, user)` reads `readJson(request)` and applies the same rule.
- [ ] **Step 5: Run the tests and see them pass.** Run `node --test tests/sync-worker.test.js tests/sync-fuzz.test.js`, then `npm test`.
- [ ] **Step 6: Commit point.** `fix(sync): counter must rise, limits fail closed, delete is limited and tied to its account`.

### Task 4: The analytics Worker drops opted-out, foreign, and over-limit events (9c7e5b6, d748b1c)

**Files:**
- Modify: `worker/index.js:14-29`
- Modify: `wrangler.jsonc` `ratelimits` (add `EVENTS_LIMIT`; the id comes from Task 5)
- Test: `tests/analytics-worker.test.js`

**Interfaces:**
- Consumes: `readCapped` (Task 2), `env.ORIGIN` (already in `vars`).
- Produces: binding `EVENTS_LIMIT`, `{ limit: 60, period: 60 }`. It fails open: with no binding, the events are stored.

- [ ] **Step 1: Write the failing tests.** Use a helper `post(body, headers)`. The default headers are `{ origin: ORIGIN }`. Count rows in `events`.
  - `test('DNT: 1 or Sec-GPC: 1 stores nothing and answers 204')`
  - `test('another site\'s Origin stores nothing')`
  - `test('no Origin: stored only with Sec-Fetch-Site same-origin')`
  - `test('over EVENTS_LIMIT stores nothing; no binding still stores')`
  - `test('a known event from our page is stored; an unknown name is not')`: this guards the old behavior.
- [ ] **Step 2: Run the tests.** Run `node --test tests/analytics-worker.test.js`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** Port the order from `book-of-changes/worker/analytics.js` `recordEvents`. Order: no DB, then DNT/GPC, then the Origin rule (`origin ? origin !== env.ORIGIN : sec-fetch-site !== 'same-origin'`), then `EVENTS_LIMIT` keyed by `cf-connecting-ip` (count only), then `readCapped`. Answer 204 when a request is dropped. Update the file comment.
- [ ] **Step 4: Run the tests and see them pass.** Then run `npm test`.
- [ ] **Step 5: Commit point.** `fix(analytics): Worker drops DNT/GPC, foreign, and over-limit events`.

**Cloudflare/deploy:** `EVENTS_LIMIT` is a new binding in `wrangler.jsonc`. `wrangler deploy` creates it. No dashboard step is needed. After the deploy, open tao.tensor.group in Brave on the iPhone. Then run `scripts/analytics.sh 1` and confirm that `view` rows still arrive (Review Focus 2).

### Task 5: Wrangler config: one domain only, and rate-limit ids (c56df0c, optional 2a41651)

**Files:**
- Modify: `wrangler.jsonc`
- Create: `tests/wrangler.test.js` (port `readJsonc` from `book-of-changes/tests/worker-pack.test.js:55-75`)
- Optional: `.gitignore:5` `sources/raw/` → `sources/raw`

**Rate-limit ids:**
- **EVENTS_LIMIT id: 4114.** It is outside 4101–4104 (tarot) and 4201–4204 (BoC).
- **Recommended:** move Tao's own limits to the same new block: AUTH 4111, SYNC 4112, SIGNUP 4113, EVENTS 4114. Reason: Tao's 4101–4103 are the same ids as tarot's `REFLECT_LIMIT`/`REFLECT_GLOBAL`/`AUTH_LIMIT`. Tarot's `wrangler.jsonc` has no `account_id`, so it may deploy to the same account (`cb08826e…`). If it does, the two apps share counters for the same IP key. For example, Tao sign-ins use up tarot's 6/min reflect quota. The move changes only Tao. The only cost is that the counters reset once at deploy.

- [ ] **Step 1: Write the failing test.** Add `test('the Worker answers only on tao.tensor.group: no workers.dev or preview URLs')`. Assert `workers_dev === false`, `preview_urls === false`, `routes` deep-equals `[{ pattern: 'tao.tensor.group', custom_domain: true }]`, and `vars.RP_ID === 'tao.tensor.group'`. Add `test('every rate limit the Worker reads is bound, ids 4111-4114, none shared')`. Assert that the names `AUTH_LIMIT`, `SYNC_LIMIT`, `SIGNUP_LIMIT`, and `EVENTS_LIMIT` exist, that no id repeats, that each id is in 4111–4114, and that `EVENTS_LIMIT.simple` deep-equals `{ limit: 60, period: 60 }`.
- [ ] **Step 2: Run the test.** Run `node --test tests/wrangler.test.js`. Expected: it fails.
- [ ] **Step 3: Implement.** Add `"workers_dev": false, "preview_urls": false` with the BoC comment. Set the ids and add `EVENTS_LIMIT`. Update the comment so that it says the ids are per account, and name the 41xx/42xx blocks that are taken.
- [ ] **Step 4: Run the tests and see them pass.** Then run `npm test`.
- [ ] **Step 5: Commit point.** `chore(wrangler): serve only tao.tensor.group; own rate-limit block 4111-4114`.

**Cloudflare/deploy:** After the deploy, `tao.<subdomain>.workers.dev` stops answering. Check that no bookmark, monitor, or script uses it. Check tarot's account with `cd /Users/billyz/code/tensor-tarot && npx wrangler whoami` (read-only). Report the tarot collision to Billy. Do not change tarot.

### Task 6: The sync client is tied to its account; delete only after a sync that worked (2048f06 client part)

**Files:**
- Modify: `app/js/sync.js:7` (LAST comment), `:44-66` (`once`), `:156-168` (`deleteAccount`)
- Modify: `app/js/app.js:44-50` (`setJournal` returns `r.ok`)
- Test: `tests/sync.test.js`

**Interfaces:**
- Consumes: the wire contract of Task 3.
- Produces: `deleteAccount({ account = accountNow() } = {})`. It throws `Error` with one of the messages `ENDED`, `SWITCHED`, `NOT_DELETED`, or `'Could not sync first, so nothing was deleted. Try again online, or Export first.'`. Copy the text from the BoC diff.
- Produces: the `setJournal` contract `(j, o) => boolean | void`. `false` means that storage could not save.

- [ ] **Step 1: Write the failing tests.** Port the cases from `book-of-changes/tests/core/sync.test.js` that 2048f06 added, and adapt them to the Tao `harness()`. Add a `setSaves(false)` knob and an `account` switch through `storage.setItem(REC, …)`.
  - `test('each sync names its account')`: `sent[0].account === 'u1'`.
  - `test('an answer that arrives after another tab signed in to another account is dropped')`: hold the response, write REC with account `u2`, release, and assert the journal is unchanged.
  - `test('a late 401 for the old account does not sign out the new one')`.
  - `test('delete refuses when the final sync fails (offline, 409, 413, 429, save failed) and sends no DELETE')`
  - `test('delete names the account it showed; a switched account throws SWITCHED and deletes nothing')`
  - `test('delete keeps LAST: a later sign-in to another account asks before upload')`
  - `test('a network error on DELETE says the copy could not be deleted')`
- [ ] **Step 2: Run the tests.** Run `node --test tests/sync.test.js`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** Port `once()` and `deleteAccount()` from the BoC diff. Use the Tao imports (`merge`, `syncCore`, `sameCore` from `./journal.js`; no `journal.` prefix). Remove `put(storage, LAST, null)`. In `app.js`, add `return r.ok;` to `setJournal`.
- [ ] **Step 4: Run the tests and see them pass.** Then run `npm test`. The old test `signOut syncs first, can clear local; deleteAccount keeps local` must still pass.
- [ ] **Step 5: Commit point.** `fix(sync): tie each sync and delete to its account; delete only after a sync that worked`.

### Task 7: "Remove it from this browser" reaches every tab (0a26ddd)

**Files:**
- Modify: `app/js/sync.js` (add `WIPED = 'tao.sync.wiped'`, `confirmed`, `heldOnServer()`, `signOut`, `onWipedElsewhere`, and the return object)
- Modify: `app/js/app.js` (`onChange`: `if (detail.wiped) afterWipe()`; `afterWipe()`; `syncer.onWipedElsewhere(afterWipe)`)
- Test: `tests/sync.test.js`

**Interfaces:**
- Consumes: `once()` from Task 6.
- Produces: `export const WIPED = 'tao.sync.wiped'`. `syncer.onWipedElsewhere(fn, target = globalThis)` listens for a `storage` event with `key === WIPED` and a new value. `onChange` detail gets `wiped: boolean`.
- `heldOnServer()` uses `load(storage)` from `./journal.js`. It already takes a storage argument, and the syncer's `storage` is `lsProxy`.
- Tao `afterWipe()`: call the `wipe` closure (`app.js:53-60`, drafts and snapshot), set `state.journal = journalStore.load()`, then `dispatchEvent(new HashChangeEvent('hashchange'))`. The event runs `route()` and stops the Listen rows. Lift the `wipe` closure into a named function so that both callers share it.

- [ ] **Step 1: Write the failing tests.**
  - `test('remove-from-browser refuses when another tab saved since the last answer')`: after `syncNow`, write a new entry into the stored journal (the `KEY` in `storage`). `signOut({ clearLocal: true })` rejects. REC and the journal are unchanged.
  - `test('remove-from-browser clears REC before the logout request and writes WIPED')`: record the order of `fetch('/api/auth/logout')` and `storage.getItem(REC)`.
  - `test('onWipedElsewhere fires on a storage event for WIPED only')`: use an `EventTarget` target.
  - `test('onChange gets wiped: true after a clear-local sign-out')`
  - The harness needs `storage` to hold the journal under `tao.journal.v1`, so that `load(storage)` sees it. Set it in `harness()`.
- [ ] **Step 2: Run the tests.** Run `node --test tests/sync.test.js`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** Follow the BoC diff.
- [ ] **Step 4: Run the tests and see them pass.** Then run `npm test`.
- [ ] **Step 5: Manual two-tab check** (`npm run dev`, localhost passkey). Open tab A on `#/journal` and tab B on `#/p/1` with a draft typed. In A, use Sign out → Remove it from this browser. B must show no entries and an empty draft box. Type in B: nothing of the old text comes back.
- [ ] **Step 6: Commit point.** `fix(sync): remove-from-browser reaches every tab and removes only what the server holds`.

### Task 8: Sync UI and Journal page fixes (2048f06 UI part, b73bb3c, 85ed6ba)

**Files:**
- Modify: `app/js/views/sync-ui.js:96-158`
- Modify: `app/js/views/journal.js:24-30`, `:44-61`
- Modify: `app/js/journal.js` (add `keptSnapshot`)
- Test: `tests/journal.test.js`

**Interfaces:**
- Consumes: `syncer.deleteAccount({ account })` (Task 6). `REC` from `../sync.js`.
- Produces: `export function keptSnapshot(storage = ls()): { journal, entries: number, draws: number } | null`. It returns null for a missing, invalid, or empty snapshot (no entries and no draws).

- [ ] **Step 1: Write the failing test.** In `tests/journal.test.js`, add `test('keptSnapshot: null for none, invalid, or empty; counts entries and draws')`.
- [ ] **Step 2: Run the test.** Run `node --test tests/journal.test.js`. Expected: it fails (no export).
- [ ] **Step 3: Implement `keptSnapshot`.** Change `restoreBox` to use it. Show "N entries, M draws" with plurals. Drop the zero parts.
- [ ] **Step 4: Change `syncSection`.** The changes are listed here. Tao has no DOM fake, so check these by hand in Step 6.
  - `shown = r?.account ?? null`.
  - `refresh` runs only while `box.isConnected`.
  - `onNews` stays put while a `.confirm` is open, unless `syncer.record()?.account !== shown`.
  - Listen for `storage` with `e.key === REC`, and stop both listeners together.
  - Add `h2 'Sync'` in the "not available" branch.
  - Add an `ask(opener, label, text, buttons, after)` helper. It focuses `buttons[0]`. Cancel calls `opener.focus()`.
  - The delete button calls `syncer.deleteAccount({ account: shown })`.
- [ ] **Step 5: Change the Journal page.** When `!syncer.record()`, show a row with Export under the intro (the backup note). Then leave Export out of `more`. Change the `backupNote` text "use Export under More" to "or Export it now".
- [ ] **Step 6: Manual check at 390 px.** Use `npm run dev` and DevTools at iPhone width. Check each item:
  - Sign out and Delete each move focus to their first button.
  - Cancel gives focus back to the opener.
  - When tab B signs in to another account, tab A's open Delete confirm closes.
  - "Sync now" keeps Export and Import in More.
  - With sync off, Export shows without opening More.
- [ ] **Step 7: Run `npm test`.**
- [ ] **Step 8: Commit point.** `fix(sync-ui): confirm focus, account-bound confirms, Export in view while sync is off`.

### Task 9: Analytics sends only known routes (adefee3)

**Files:**
- Modify: `app/js/track.js:33-40`
- Modify: `app/js/app.js:115`
- Create: `tests/track.test.js`

**Interfaces:**
- Produces: `export const UNKNOWN_ROUTE = 'unknown'` and `export function viewPath(hash: string, patterns: RegExp[]): string`. For a hash that matches a pattern, it returns the route without its query (the current rule). Otherwise it returns `'unknown'`. `trackView(hash, patterns = [])` uses `viewPath`.

- [ ] **Step 1: Write the failing test.** Add `test('viewPath: a known route without its query; any other fragment is unknown')`. Use the patterns from `app.js` routes (import nothing from app.js; copy three patterns into the test). The cases:
  - `'#/p/59?d=x'` → `'/p/59'`
  - `'#/search?q=grief'` → `'/search'`
  - `'#/search/private-words'` → `'unknown'`
  - `''` → `'/'`

  Importing `track.js` in node is safe: `off` becomes true, because `location` is undefined in the try.
- [ ] **Step 2: Run the test.** Run `node --test tests/track.test.js`. Expected: it fails.
- [ ] **Step 3: Implement.** In `app.js:115`, call `trackView(hash, routes.map(([re]) => re))`.
- [ ] **Step 4: Run the tests and see them pass.** Then run `npm test`.
- [ ] **Step 5: Commit point.** `fix(analytics): send the route of a known page, 'unknown' otherwise`.

### Task 10: Search refuses an index and vectors that do not pair (a1c2ebe, 9a746e7)

**Files:**
- Modify: `app/js/search-core.js` (add `bytesHash`, `indexFromFiles`, `makeIndexLoader`)
- Modify: `scripts/build-search.mjs:66-72` (write `vecsHash`)
- Modify: `app/js/views/search.js:14-22` (use `makeIndexLoader`)
- Regenerate: `app/data/search/index.json` (`node scripts/build-search.mjs`)
- Test: `tests/search.test.js`

**Interfaces:**
- Produces: `bytesHash(buf: ArrayBuffer): string`. It is FNV-1a, 32 bits, 8 hex digits. Copy it from BoC `search.js`.
- Produces: `indexFromFiles(ix, buf) → { docs, dim, vecs, texts, titles }`. It throws an `Error` with `code: 'index-mismatch'` when `vecs.length !== ix.count * ix.dim` or `bytesHash(buf) !== ix.vecsHash`.
- Produces: `makeIndexLoader({ fetchFn, forget, dir = 'data/search/' }) → () => Promise<index>`. It loads once. On `index-mismatch`, it calls `forget([index.json, vecs.bin])` and fetches both once more with `{ cache: 'reload' }`. Any other failure is forgotten, so the next call retries. The browser `forget` deletes both paths from every `caches.keys()` cache. Put it in `views/search.js`, in a try with an empty catch.

- [ ] **Step 1: Write the failing tests.**
  - `test('indexFromFiles refuses vectors of the wrong size or another build')`
  - `test('makeIndexLoader: a mismatch forgets both files and fetches once more; a second mismatch rejects; a failed load is retried')`: use a fake `fetchFn` that counts calls and records `init.cache`.
  - `test('the shipped index names the hash of the shipped vecs.bin')`: read `app/data/search/index.json` and `vecs.bin`, and assert `indexFromFiles` does not throw.
- [ ] **Step 2: Run the tests.** Run `node --test tests/search.test.js`. Expected: they fail.
- [ ] **Step 3: Implement.** Then run `node scripts/build-search.mjs` to rewrite `index.json` with `vecsHash`.
- [ ] **Step 4: Run the tests and see them pass.** Then run `npm test`.
- [ ] **Step 5: Commit point.** `fix(search): refuse an index and vectors from different builds, then fetch both again`.

### Task 11: Count each search once (3b189c4)

**Files:**
- Create: `app/js/search-count.js`
- Modify: `app/js/views/search.js:79-131`
- Create: `tests/search-count.test.js`

**Interfaces:**
- Produces: `export function makeSearchCounter({ track, onPage, delay = 1500, setTimer = setTimeout, clearTimer = clearTimeout }) → { count(query: string, filter: string): void, cancel(): void }`.
  - `count` cancels a pending send.
  - An empty query sends nothing.
  - After `delay`, it sends `track('search', filter)` only if `onPage()` is true and the key (`filter + '\u0001' + query`) differs from the last key sent.
  - The query is kept in memory only and is never sent.

- [ ] **Step 1: Write the failing tests** (fake timers).
  - `test('one search typed in steps is counted once, with its filter')`
  - `test('the same query and filter twice is counted once; a new filter counts again')`
  - `test('a search left before the delay is not counted')`: `onPage` returns false at fire time.
  - `test('clearing the box cancels the pending count')`
- [ ] **Step 2: Run the tests.** Run `node --test tests/search-count.test.js`. Expected: they fail.
- [ ] **Step 3: Implement.**
  - In the view, remove `searchTimer` and its scheduling from `run()`.
  - Add `search = () => { run(); counter.count(input.value.trim(), filter); }`.
  - Use `search` for input, Enter, the form submit, a filter chip, and a suggestion. The index and model arrivals keep calling `run()` only.
  - In `run()`, an empty query does `fill(results); setStatus(); return;`, so no "N results" stays over an empty list.
  - Use `onPage = () => input.isConnected && location.hash.startsWith('#/search')`.
- [ ] **Step 4: Run the tests and see them pass.** Then run `npm test`.
- [ ] **Step 5: Commit point.** `fix(search): count each search once, never under the next page`.

### Task 12: Made-up words find nothing (599a5d0)

**Files:**
- Modify: `app/js/search-core.js:118-143` (`rank` returns `[doc, score, exact]`; add `knowsAWord`, `visibleResults`, `MEANING_FLOOR = 0.2`)
- Modify: `app/js/views/search.js:107-114`
- Test: `tests/search.test.js`

**Interfaces:**
- Produces: `knowsAWord(model, query): boolean`. It is true when a `preTokenize` word with 2 or more letters, not a stop word, is in `model.ids` (a `Map`).
- Produces: `visibleResults(ranked, { meaning = true }): Array<[doc, score, exact]>`. Port it from the BoC diff (60 % of the top score among results that may show, floor 0.12).
- `rank` sets `exact = hit > 0` (a keyword in the text). Tao has no `names` field, so `exact` is the keyword hit only.

- [ ] **Step 1: Write the failing tests.**
  - `test('knowsAWord: zzqxv and asdf qwer are unknown; loneliness and water are known')`
  - `test('visibleResults drops meaning-only results for an unknown word and keeps exact ones')`
  - `test('shipped index: "zzqxv" shows nothing; "water" and "letting go of control" still show results')`: use the real model and index from `app/`.
- [ ] **Step 2: Run the tests.** Run `node --test tests/search.test.js`. Expected: they fail.
- [ ] **Step 3: Implement.** In the view, use `visibleResults(ranked, { meaning: knowsAWord(model, q) })`. With the model loaded and no result, the status is `'No close matches.'`.
- [ ] **Step 4: Run the tests and see them pass.** Then run `npm test`. Test the eight `SUGGEST` queries in the browser too: each must still show results.
- [ ] **Step 5: Commit point.** `fix(search): made-up words find nothing, and the status says so`.

### Task 13: Pronunciation taps and the recording list (88c3f02, 7254195)

**Files:**
- Modify: `app/js/audio.js:22-78`
- Test: `tests/audio.test.js` (the `harness()` already exists)

**Interfaces:**
- Produces: internal `async function sound(py, char): Promise<Audio | Utterance | null>`. `say()` returns `(await sound(...)) != null`. `stopSay()` and `say()` keep their signatures. The event name stays `tao:sound`.

- [ ] **Step 1: Write the failing tests.**
  - Change the harness fake `fetch` to return `{ ok: true, json }`.
  - `test('a second quick tap stops the first; the first play\'s AbortError never speaks')`: the fake `play()` rejects with `name: 'AbortError'` when `pause()` was called before it settled. Assert `counts.speak === 0`.
  - `test('a new tap cancels speech of the tap before')`: count `speechSynthesis.cancel` calls.
  - `test('a failed or non-ok recording list is retried at the next say')`: the first fetch rejects (or returns `ok: false`), and the second succeeds. Assert 2 fetches and that the second say plays the recording.
  - `test('sayButton marks the sound it started, also an utterance')`: read `onend` on the utterance.
- [ ] **Step 2: Run the tests.** Run `node --test tests/audio.test.js`. Expected: they fail.
- [ ] **Step 3: Implement.** Port the BoC diffs. Keep the Tao `announce()` with `tao:sound`.
- [ ] **Step 4: Run the tests and see them pass.** Then run `npm test`.
- [ ] **Step 5: Commit point.** `fix(audio): a new tap cancels the one before; retry the recording list`.

### Task 14: Listen: another row's start clears the lit cell (37a31c5)

**Files:**
- Modify: `app/js/listen.js:201`
- Test: `tests/listen-player.test.js`

- [ ] **Step 1: Write the failing tests.** Port the three BoC tests. Use `t.events.dispatchEvent(new CustomEvent('tao:listen', { detail: 'row-b' }))` and `t.events.dispatchEvent(new Event('tao:sound'))`. Read the classes from `t.cells` as the existing tests do.
- [ ] **Step 2: Run the tests.** Run `node --test tests/listen-player.test.js`. Expected: the first two fail.
- [ ] **Step 3: Implement.** Change the listener to `{ if (e.detail !== id) { pauseIfActive(); stopLoop(); clearMarks(); } }`. Copy the BoC comment.
- [ ] **Step 4: Run the tests and see them pass.** Then run `npm test`.
- [ ] **Step 5: Commit point.** `fix(listen): a row that starts clears the lit cell of every other row`.

### Task 15: Recording script safety (e98059d, 9c3e5ba)

**Files:**
- Modify: `scripts/build-audio.mjs` (`main`, `saveManifest:67-69`, `writeMp3` tmp name, `enCheckTimes`, zh `speak` path near `:188`)
- Modify: `scripts/check-audio.mjs:46-81` (extract `timingErrors`)
- Modify: `.gitignore` (add `.listen.lock`)
- Test: `tests/listen.test.js` (it already imports build-audio)

**Interfaces:**
- Produces: `export function parseArgs(argv): { mode: 'record'|'drop'|'list'|'plain', en, all, nums, out } | { error: string }`. It reads the whole line first. An unknown flag, a repeated flag, a mix of modes, `--drop` or `--list` with more than one number, or `--list` with `--en` returns `{ error }`. `main` prints the error and `USAGE` and returns 2 before it reads any file.
- Produces: `export function timingErrors(who, e, { count, unit, minGap = null }): string[]`. These are the rules now in `checkEntry` plus the English 30 ms gap. `check-audio` and `build-audio` both call it. `build-audio` runs it on each new take, before `writeMp3`, and throws "nothing written" on any error.
- Produces: a lock file `join(app, '..', '.listen.lock')` that holds the pid. A second run while that pid lives exits 1. A stale lock (its process is gone) is taken over. The manifest tmp file is `listen.json.<pid>.tmp`, and the MP3 tmp file carries the pid too.

- [ ] **Step 1: Write the failing tests.** Assert that each of these returns `{ error }`:
  - `parseArgs(['n','s','--al'])`
  - `['--drop','3','5']`
  - `['--list','3','--drop','4']`
  - `['--en','--en','3']`
  - `['--list','3','--en']`

  Assert that `main(['n','s','--dorp','5'])` returns 2. Add `test('timingErrors refuses English words under 30 ms apart')`. Add `test('enTimes throws when spreadTimes leaves words under 30 ms apart')`: five heard words within 4 ms, the next 0.1 s later. Add `test('a second run refuses while the lock pid lives; a stale lock is taken over')`: use a temp app folder.
- [ ] **Step 2: Run the tests.** Run `node --test tests/listen.test.js`. Expected: they fail.
- [ ] **Step 3: Implement.** Follow the BoC `scripts/core/listen-build.mjs` and `listen-check.mjs` diffs. Keep Tao's flag set (no `--estimate`). Release the lock in a `finally`.
- [ ] **Step 4: Run the tests and see them pass.** Then run `npm test` and `npm run check`. `check-audio` must still pass for all 162 entries.
- [ ] **Step 5: Commit point.** `fix(audio-build): parse the whole command line first; one run at a time; refuse a take check-audio would refuse`.

### Task 16 (optional, low): Light Listen cells only when the page holds what was recorded (1f0936d)

Do this task only with Billy's go. `npm run check` already blocks a deploy with a stale `src`.

**Files:** `app/js/markup.js` (`seqHash`), `app/js/listen.js` (`recordingFits`), `app/js/views/passage.js:200-210`, `:285-339`, `scripts/build-audio.mjs` (`seq` on record; a seq-only rewrite when up to date), `scripts/check-audio.mjs` (seq check), `app/data/listen.json` (backfill), tests in `tests/listen.test.js`, `tests/listen-player.test.js`, `tests/markup.test.js`.

- [ ] **Step 1: Write the failing tests.** Port the BoC tests for `seqHash` (`['ab','c']` ≠ `['a','bc']`), for `recordingFits` → `null`/`'unlit'`/`'lit'`, and for "an up-to-date entry gets only its seq, with no API call". Give the test fake `speak`/`ffmpeg` functions that throw.
- [ ] **Step 2: Implement.** Then backfill. First confirm `node scripts/check-audio.mjs` is clean. Then run `npm run audio -- --all` and `npm run audio -- --en --all` with the Google credentials unset, so that any API call fails. Expect "seq written" for each entry and no API call.
- [ ] **Step 3: Verify.** Run `npm test` and `npm run check`.
- [ ] **Step 4: Commit point.**

### Task 17: CSS: contrast and tap sizes (e08643a, c33b52b, 9227b98)

**Files:** `app/css/app.css:12`, `:611`, `:258-260`

- [ ] **Step 1: Change `--ink-3`.** Change it to `#6b6457`. This value was measured in planning: 5.11 on `--paper`, 4.62 on `--paper-2`, 4.56 on the sync-card wash. The dark theme `#8f8573` passes already (4.51 or more). Add a one-line comment with these ratios.
- [ ] **Step 2: Change the search result links.** At `.r-links a` (`:611`), change `min-height: 38px` to `var(--tap)`.
- [ ] **Step 3: Change the active Listen row.** Use `bottom: 0`, `border-top: 1px solid var(--rule)`, `padding-top: .4rem`, `padding-bottom: calc(.4rem + env(safe-area-inset-bottom, 0px))`. Add `.listen-row.active .listen-btn { min-width: 7em; }`.
- [ ] **Step 4: Check at 390 px and 320 px.** Check in both light and dark themes. The active Listen row is one line. No text shows under it in iPhone Safari or Brave. The `.han-rule` lines still look right. At 320 px the header does not scroll sideways (the 5383d27 check).
- [ ] **Step 5: Run `npm test` and `npm run check`.** Commit point: `fix(css): --ink-3 passes AA; 44 px result links; one-line sticky Listen row`.

### Task 18: Finish: precache, docs, deploy

**Files:** `app/sw.js` (generated block), `CLAUDE.md` (Analytics and Sync rules)

- [ ] **Step 1: Run `npm run precache`.** Confirm that `app/js/search-count.js` is in `FILES` and that `VERSION` changed.
- [ ] **Step 2: Update `CLAUDE.md`.** Add one line each, with nothing more:
  - Under **Analytics**: the Worker drops DNT/GPC, foreign-origin, and over-`EVENTS_LIMIT` events, and fails open without the binding.
  - Under **Sync**: a missing rate-limit binding answers 503, except with `RP_ID` localhost. Each sync and delete names its account (a missing name is accepted for old clients).
  - Under **Commands** or **Security**: the rate-limit ids are 4111–4114.
- [ ] **Step 3: Run `npm test`, `npm run check`, and `node scripts/check-content.mjs --all`.** All three must pass.
- [ ] **Step 4: Run code review** (requesting-code-review, with the diff from the merge-base), and convene the panel per the global rules.
- [ ] **Step 5: Deploy.** Run `npm run deploy` only with Billy's go. It is outward-facing.
- [ ] **Step 6: Check after the deploy.**
  - `curl -sI https://tao.tensor.group/` answers 200.
  - A POST to `/api/e` with `DNT: 1` answers 204, and `scripts/analytics.sh 1` shows no new row from it.
  - On the iPhone (Brave): views still arrive.
  - Sync still works on an old installed PWA before it updates (Review Focus 1). Then update it and sync again.
  - The workers.dev URL no longer answers.

---

## Verification commands

```sh
npm test                                   # all tests, including the new tests/sw, analytics-worker, wrangler, track, search-count
npm run check                              # content + copyright + art + audio
node scripts/check-content.mjs --all
npm run precache                           # after app/ changes
npm run dev                                # passkey + two-tab manual checks (Tasks 7, 8)
```

## Cloudflare and deploy steps

- **New binding:** `EVENTS_LIMIT` (namespace 4114, 60/60 s). `wrangler deploy` creates it from `wrangler.jsonc`. No dashboard step is needed.
- **Changed bindings (recommended):** AUTH/SYNC/SIGNUP move from 4101–4103 to 4111–4113. The counters reset once.
- **workers_dev/preview_urls false:** after the deploy, the `*.workers.dev` URL stops. Check that nothing uses it.
- **No D1 schema change.** No new secrets.
- **Search index:** Task 10 changes `app/data/search/index.json`. `SEARCH_VERSION` changes through precache, so old clients fetch both files again.

## Risks

- **Old clients and the account field (high).** Task 3 must accept a missing `account`. If an executor copies the BoC rule (missing gives 409), sync breaks for every reader on an old PWA.
- **Analytics Origin rule (medium).** A browser that sends neither `Origin` nor `Sec-Fetch-Site` on `sendBeacon` loses its events. Modern Chromium, Brave, and Safari 16.4+ send them. Check this after the deploy.
- **Fail-closed limits (medium).** If a binding goes missing at deploy, sync answers 503. `tests/wrangler.test.js` guards the config, but not the live account.
- **Search floor (low).** `MEANING_FLOOR = 0.2` was tuned on the BoC corpus. Check the Tao `SUGGEST` queries (Task 12, Step 4).
- **localStorage has no cross-tab compare-and-swap (accepted).** A save in another tab in the few milliseconds between the check and the wipe can still bring text back. BoC accepts the same limit.

## Open questions

1. **When do we tighten the account rule?** Should the Worker refuse a sync or delete with no `account` after old clients have updated (for example, 30 days after the deploy)? Recommendation: yes, in a later one-line change.
2. **Tarot and the rate-limit ids.** Is tensor-tarot on account `cb08826e…`? If it is, the current Tao 4101–4103 already share counters with tarot. Task 5 fixes this from the Tao side. Tell Billy, and leave tarot alone.
3. **Task 16 (Listen seq).** Do it now, or defer it? Recommendation: defer, because `npm run check` already gates deploys on `src`.


## Decisions (2026-11-27)

- Old clients: a sync or delete with no `account` is accepted; a wrong `account` gets 409 (Task 3). Tighten later.
- Rate-limit ids: Tao moves to 4111–4114 (4101–4104 is tensor-tarot, 4201–4204 Book of Changes, 4301+ is kept for the next app).
- Task 16 (Listen seq) is deferred: `npm run check` already gates deploys on `src`.
