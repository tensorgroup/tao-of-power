# Passkey journal sync — design

Date: 2026-11-25. Status: approved by Billy (approach A, sync on by default,
draw history removable). Revised after a builder check and a five-seat review.

## Intent

A reader uses the app on a phone and on a desktop browser. Today each browser
has its own journal, and the only way to move it is Export and Import files.
The reader signs in with a passkey on any device and sees the same journal:
entries, margin tabs, and draw history. The passkey is the only credential.
There is no email, no username, and no password. Anyone can make a passkey.

Synced passkeys (iCloud Keychain, Google Password Manager) are already on
both devices, so signing in on the second device is one tap.

## Goals

- Sync is offered by default: the first time a reader does a draw or opens the
  journal, a small card asks them to turn it on. One tap makes or uses a
  passkey. (A passkey always needs a tap; it cannot start silently.)
- After sign-in, each device holds the merge of its local journal and the
  server journal. After that, sync runs by itself.
- A reader can remove a draw from the draw history. The removal syncs.
- Works in Brave on iPhone (WebKit) and Brave on macOS with iCloud Keychain
  passkeys, and in other browsers with passkeys.

## Non-goals

- No end-to-end encryption. No email, recovery codes, or account recovery: a
  lost passkey loses the server copy; each device keeps its local copy.
- No sharing between readers. No real-time push.
- Drafts and settings do not sync. `lastExportAt` does not sync (it describes
  one device's backups).

## Anti-goals

- An entry that exists on only one device is never lost by a sync.
  Deletions do sync: an entry or draw removed on one device is removed on the
  others. When two devices edit the same entry before a sync, the newer edit
  wins (stated limit; see Merge).
- Readers who do not turn on sync send no journal data anywhere.
- Journal text never reaches analytics or logs, and errors never echo it.

## Constraints

- No bundler or framework in `app/`. The client uses `navigator.credentials`
  directly. CSP stays same-origin (the API is `/api/*` on the same origin).
- Wrangler bundles the Worker, so the Worker may import npm packages.
- The export format stays backward compatible. New fields are optional.
- `CLAUDE.md` rule "Journal data lives only in the user's browser" becomes
  "…and on the server only when the reader turns on sync".

## Approaches

- **A. Passkey sign-in; the server stores the journal as JSON in D1. Chosen.**
- B. A plus end-to-end encryption with the WebAuthn PRF extension. Rejected
  for now: PRF support in Brave on macOS is uncertain.
- C. Sync code or link, no passkey. Rejected: not what was asked; a leaked
  code exposes the journal.

## Merge (shared by client and server: `app/js/journal.js`)

- `merge()` keeps its rules for entries. New: a tombstone also removes a
  draw with the same id, and a draw tombstone is never revived (draws have no
  edit time).
- New `deleteDraw(j, id)` adds a tombstone and removes the draw.
- Clock skew: `updateEntry` and `deleteEntry` stamp
  `max(now, previous updatedAt + 1 ms)`. An edit made after a sync always
  beats the version it edits, even on a device with a slow clock.
- Sync compares and stores only `entries`, `draws`, `tombstones`. Each device
  keeps its own `lastExportAt`.

## Server (Worker + D1)

New D1 database `tao-sync`, binding `tao_sync`. Schema `worker/sync-schema.sql`:

```sql
users       (id TEXT PK, label TEXT, created INTEGER)
credentials (id TEXT PK, user_id TEXT, public_key BLOB, counter INTEGER, created INTEGER)
sessions    (token_hash TEXT PK, user_id TEXT, expires INTEGER, refreshed INTEGER)
challenges  (id TEXT PK, challenge TEXT, kind TEXT, user_id TEXT, expires INTEGER)
journals    (user_id TEXT PK, data TEXT, rev INTEGER, updated INTEGER)
```

WebAuthn: `@simplewebauthn/server` 14.1.0 (exact pin, committed
`package-lock.json`). `rpID` and `origin` come from Worker vars (`RP_ID`,
`ORIGIN`), never from request headers. User verification is `required` in
the options and in both verify calls. Resident key required.

| Endpoint | Behavior |
|---|---|
| `POST /api/auth/register/options` | New user id; challenge row with `kind='reg'` and that `user_id`. Passkey name: `Tao journal · 25 Nov 2026`. |
| `POST /api/auth/register/verify` | Consume the challenge row once (`DELETE … RETURNING`), check kind. Read the user id only from the row. Insert user, credential, an empty journal row (rev 0), session. |
| `POST /api/auth/login/options` | Challenge row `kind='auth'`, empty `allowCredentials`. |
| `POST /api/auth/login/verify` | Consume challenge. Find credential by id (unknown → `404 unknown-passkey`). `userHandle` must match. Verify, store counter, start session. |
| `POST /api/auth/logout` | Delete session, clear cookie. |
| `GET /api/session` | `{ account: { id, label } }` or `{ account: null }`. |
| `POST /api/journal/sync` | Body `{ journal }`. Server: validate, `merge(stored, incoming)`, write with `UPDATE … WHERE rev=?` (retry up to 3 times inside the Worker), return `{ journal, rev }`. No write when nothing changed. |
| `DELETE /api/account` | Delete journal, sessions, credentials, user. |

The server does the merge, so the client needs no compare-and-set or 409 loop.

Security and limits:

- Cookie `__Host-tao_s`: `HttpOnly; Secure; SameSite=Strict; Path=/`,
  400 days. Only a SHA-256 of the token is stored. Expiry slides at most once
  a day, with a new `Set-Cookie`.
- Every non-GET `/api/` request except `/api/e`: `Origin` must equal `ORIGIN`,
  or, when `Origin` is missing, `Sec-Fetch-Site` must be `same-origin`.
  Otherwise `403`.
- Every `/api/` response: `Cache-Control: no-store`.
- Rate limit (Workers Rate Limiting binding, keyed by `cf-connecting-ip`,
  never stored): auth endpoints 20/min, sync 60/min.
- New accounts: at most 300 per 24 hours (`503` after that).
- Journal body: at most 512 KB (`413`).
- Expired challenges and sessions are deleted lazily on each auth request.

## Client (`app/js/sync.js`)

- Local record `tao.sync` = `{ account, label, at }` (last synced time).
- On start (when `PublicKeyCredential` exists): `GET /api/session`. This finds
  a session that the cookie has but localStorage lost (an installed iOS app
  copies cookies, not localStorage). A missing session clears the record.
- `syncNow()`: one run at a time; a trigger during a run queues one more run.
  It sends the journal without `lastExportAt`, then sets
  `state.journal = merge(state.journal, response)` and saves — it reads the
  current `state.journal` after the network wait, so a save made during the
  request is kept and goes up on the queued run.
- Triggers when signed in: app start, right after each `state.persist()`
  (no debounce), tab becomes visible, tab becomes hidden (`keepalive`), and
  back online.
- After a sync changes the journal, the app sends `tao:journal-synced`. The
  app re-renders only `#/journal` and `#/`, and not while a text field has
  focus (then on its blur).
- Errors: `401` clears the record ("Signed out. Sign in again to sync.").
  `413` shows "Journal too large to sync. Export keeps a full copy." Network
  errors are silent and retried at the next trigger.
- Account switch: if the record names another account and the local journal
  is not empty, sign-in asks: "Merge this browser's journal into this
  account" or "Use only the account's journal" (the local copy goes to the
  Replace snapshot first).
- Sign-out asks whether to also remove the journal from this browser.

UI:

- **Prompt card** (after a draw, on the passage page; and on the journal page),
  shown until the reader signs in or taps "Not now" (remembered per device):
  ```
  Keep this journal on all your devices.
  [ Sign in with passkey ]  [ New passkey ]   Not now
  ```
- **Journal page, Sync section:** signed out — the same two buttons and one
  line of privacy text. Signed in:
  ```
  Sync is on · Tao journal · 25 Nov 2026 · synced 2 min ago
  [ Sync now ]  [ Sign out ]  [ Delete synced copy ]
  ```
- "Delete synced copy" confirms in the page, deletes the account, keeps the
  local journal, and says to remove the passkey from the passwords app.
- An unknown passkey at sign-in says the same, and calls
  `PublicKeyCredential.signalUnknownCredential` where it exists.
- While sync is on: Replace is hidden (a replace would be merged back), and
  the "only in this browser, export" note becomes the sync line.
- Draw history (journal page): each draw gets a Remove button with an
  in-page confirm.
- Without `PublicKeyCredential`, the section says passkeys are not available
  in this browser, and no card is shown.

Privacy text: "Sync is optional. When it is on, your journal is stored on our
server so your other devices can get it. It is not end-to-end encrypted.
Delete synced copy removes it; database backups expire within 30 days."

## Service worker and analytics

- `sw.js` returns early for `/api/` paths. Run `npm run precache`.
- New events (no detail): `sync-on`, `sync-signin`, `sync-off`, `sync-delete`,
  `draw-remove`. Add to `EVENTS`.

## Tests

- `tests/journal.test.js`: draw tombstones, monotonic stamps.
- `tests/sync.test.js`: `syncNow()` with fake fetch/storage — edit during
  request is kept and re-sent, single flight, 401, 413, `lastExportAt` kept.
- `tests/sync-worker.test.js`: Worker routes against an in-memory SQLite
  stand-in for D1 (`node:sqlite`): Origin check, no-store, no session → 401,
  sync merges and bumps rev, no-op sync keeps rev, size limit, challenge kind
  and single use, signup cap, account delete. WebAuthn verify is stubbed.
- Manual (Billy): new passkey in Brave on macOS, sign in in Brave on iPhone,
  write and remove a draw on each, check both. If Brave on macOS does not
  offer iCloud Keychain, make the passkey on the iPhone and use the QR option
  on the Mac.

## Left to the builder

- Module split inside the Worker (`worker/sync.js` expected).
- CSS for the card and section, from existing tokens and button classes.
- `wrangler d1 create tao-sync`, schema apply, and the rate-limit binding go
  in the plan.
