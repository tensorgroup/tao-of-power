# Passkey Journal Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional passkey sign-in that syncs the journal (entries, margin tabs, draws, removals) between a reader's devices, offered by default after a draw or on the journal page.

**Architecture:** The Worker gains `/api/auth/*`, `/api/session`, `/api/journal/sync`, `/api/account` backed by a new D1 database. The server merges with the same `merge()` from `app/js/journal.js`. The client module `app/js/sync.js` runs single-flight syncs after each save and on focus changes.

**Tech Stack:** Cloudflare Workers + D1, `@simplewebauthn/server` 14.1.0, plain ES modules, `node:test` with `node:sqlite` as a D1 stand-in.

**Spec:** `docs/superpowers/specs/2026-11-25-passkey-sync-design.md`

## Global Constraints

- RP ID `tao.tensor.group`, origin `https://tao.tensor.group` (Worker vars `RP_ID`, `ORIGIN`).
- Cookie `__Host-tao_s`, `HttpOnly; Secure; SameSite=Strict; Path=/`, Max-Age 400 days; slide at most once per day.
- User verification `required` everywhere; resident key required.
- Journal body max 512 KB; 300 new accounts per 24 h; rate limits auth 20/min, sync 60/min per IP (IP never stored).
- Every `/api/` response `Cache-Control: no-store`. Non-GET (except `/api/e`) needs `Origin === ORIGIN`, or no Origin and `Sec-Fetch-Site: same-origin`; else 403.
- `lastExportAt` never leaves the device.
- No `innerHTML`, DOM via `h()`/`fill()`, colors from CSS tokens, `npm run precache` after `app/` changes.
- Export format stays backward compatible.

## Review Focus

- Save during an in-flight sync: the new entry must survive and go up on the next run (Task 3 test `keeps an entry saved during the request`).
- Same journal synced twice: second sync must not bump `rev` (Task 2 test `no-op sync keeps rev`).
- Draw removed on device A while device B still has it: B loses it after sync, and it never comes back (Task 1 test `draw tombstone wins`).
- Edit on a device whose clock is behind the server copy: the edit wins (Task 1 test `edit stamps past previous updatedAt`).
- Challenge reuse or wrong kind: rejected (Task 2 test `challenge is single use and kind-bound`).

---

### Task 1: Journal merge — draw removal and monotonic stamps

**Files:** Modify `app/js/journal.js`; Test `tests/journal.test.js`.

**Interfaces — Produces:**
- `deleteDraw(j, id, now?) -> boolean`
- `syncCore(j) -> { version:1, entries, draws, tombstones }` (no `lastExportAt`)
- `sameCore(a, b) -> boolean` (JSON-equal cores)
- `merge()` drops draws whose id has a tombstone; draw tombstones are kept.
- `updateEntry`/`deleteEntry` stamp `max(now, prev updatedAt + 1ms)`.

- [ ] Tests: `draw tombstone wins` (A deletes draw, merge(A,B) and merge(B,A) both lack it, tombstone kept); `edit stamps past previous updatedAt` (entry updatedAt in the future, updateEntry result is > it); `delete stamps past previous updatedAt`; `syncCore drops lastExportAt`.
- [ ] Run `npm test` → new tests fail. Implement. Run → pass. Commit.

### Task 2: Worker sync backend

**Files:** Create `worker/sync.js`, `worker/sync-schema.sql`, `tests/sync-worker.test.js`, `tests/helpers/fake-d1.js`; Modify `worker/index.js`, `wrangler.jsonc`, `package.json` (+ `package-lock.json`).

**Interfaces — Produces:** `handleApi(request, env, deps?) -> Promise<Response|null>` (null = not a sync route). `deps.verifyRegistration`, `deps.verifyAuthentication`, `deps.generateRegistrationOptions`, `deps.generateAuthenticationOptions` default to the library; tests stub them. `env`: `tao_sync` (D1), `RP_ID`, `ORIGIN`, `AUTH_LIMIT`, `SYNC_LIMIT` (rate-limit bindings, optional in tests).

- [ ] `fake-d1.js`: wraps `node:sqlite` `DatabaseSync` with D1's `prepare().bind().first()/all()/run()` and `batch()`; `run()` returns `{ meta: { changes } }`.
- [ ] Tests: Origin check (403 on foreign Origin, OK on `Sec-Fetch-Site: same-origin`); all `/api/` responses no-store; `/api/journal/sync` without session → 401; register flow (stubbed verify) sets `__Host-tao_s` and creates rev-0 journal; sync merges and bumps rev; `no-op sync keeps rev`; body > 512 KB → 413; invalid journal → 400; `challenge is single use and kind-bound`; login with unknown credential → 404 `unknown-passkey`; signup cap → 503; DELETE account removes rows; GET /api/session returns account label.
- [ ] Implement; `wrangler.jsonc`: `tao_sync` D1 binding, `vars`, `ratelimits` (AUTH_LIMIT 20/60s, SYNC_LIMIT 60/60s); add `sync-*`, `draw-remove` to `EVENTS`.
- [ ] `npm test` pass; `npx wrangler deploy --dry-run` bundles. Commit.

### Task 3: Client sync module

**Files:** Create `app/js/sync.js`, `tests/sync.test.js`; Modify `app/js/app.js`, `app/sw.js`.

**Interfaces — Produces (sync.js):** `syncState() -> {account,label,at,error}|null`; `available() -> boolean`; `start()`; `syncNow() -> Promise<void>`; `signUp()`, `signIn()`, `signOut({ clearLocal })`, `deleteAccount()`; `onChange(fn)`. Testable core `makeSyncer({ fetch, getJournal, setJournal, storage, now })`.
**Consumes:** `merge`, `syncCore`, `sameCore` (Task 1); API (Task 2).

- [ ] Tests: `keeps an entry saved during the request`; single flight (two calls → one fetch in flight, one queued); 401 clears record; 413 sets `error: 'too-large'`; local `lastExportAt` kept; body never contains `lastExportAt`.
- [ ] `app.js`: `state.persist()` calls `sync.after()`; `start()` on boot; listen for `tao:journal-synced` → re-route only `#/journal` or `#/`, deferred while a textarea/input has focus.
- [ ] `sw.js`: return early for `/api/`. Commit.

### Task 4: UI — prompt card, Sync section, draw removal

**Files:** Create `app/js/views/sync-ui.js`; Modify `app/js/views/journal.js`, `app/js/views/passage.js`, `app/css/app.css`, `app/js/views/about.js` (privacy line).

**Interfaces — Produces:** `syncCard() -> Node|null` (null when signed in, dismissed, or no passkeys), `syncSection(render) -> Node`.

- [ ] Card on passage page when opened from a draw (`?d=`) and on the journal page; "Not now" stores `tao.sync.dismissed`.
- [ ] Sync section with copy from the spec; account switch prompt; sign-out "also remove from this browser" choice; delete confirm; unknown-passkey message.
- [ ] Draw history: Remove button + in-page confirm → `deleteDraw`, `persist`, `track('draw-remove')`.
- [ ] Hide Replace and the export nag when signed in.
- [ ] `npm test`, `npm run check`, `npm run precache`; check at 400px in a browser. Commit.

### Task 5: Ship

- [ ] `npx wrangler d1 create tao-sync`; put id in `wrangler.jsonc`; `npx wrangler d1 execute tao-sync --remote --file worker/sync-schema.sql`.
- [ ] Update `CLAUDE.md` (journal rule, sync section, commands).
- [ ] Whole-branch review; fix findings.
- [ ] Merge to main, push, `npm run deploy`; smoke-test `/api/session` and Origin rejection on the live site.
