# Listen (Stage 1: Chinese) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Listen button on each recorded passage plays a WaveNet B reading of the Chinese and lights each character as it is spoken.

**Architecture:** A hand-run build script (`scripts/build-audio.mjs`) makes SSML with one `<mark>` per character, gets LINEAR16 audio and mark times from Google Text-to-Speech, joins the parts, encodes one MP3 per passage with a hashed name, and writes a precached manifest `app/data/listen.json`. A DOM-free player controller (`createPlayer` in `app/js/listen.js`) drives any media object and reports the current character index; a thin DOM wrapper (`listenRow`) makes the controls; `passage.js` lights and scrolls the column. The service worker stores the MP3s in an unversioned cache and answers `Range` requests from it.

**Tech Stack:** Plain ES modules (browser + Node 22), `node:test`, ffmpeg, Google Cloud Text-to-Speech `v1beta1` REST, gcloud CLI (configuration `tao`).

**Spec:** `docs/superpowers/specs/2026-11-24-listen-design.md`

## Global Constraints

- Voice `cmn-CN-Wavenet-B`, `speakingRate: 0.8`, `audioEncoding: LINEAR16`, `enableTimePointing: ["SSML_MARK"]`, endpoint `https://texttospeech.googleapis.com/v1beta1/text:synthesize`.
- Auth: `gcloud --configuration=tao auth print-access-token`; header `x-goog-user-project: tao-of-power`. Never change the `default` gcloud configuration. No credential in the repo.
- Passage text always comes from `segmentsFor(text, rich)` (Task 1): the passage file's `zh[i].text` overrides `text.json`, and the two differ in punctuation (passage 1, passage 2). Build, check, and page all use it.
- Pinyin in SSML is numbered only (`[a-z]+[1-5]`, `v` for ü), inside `<phoneme alphabet="pinyin" ph="…">`. `engine` characters (一, 不) are never forced.
- SSML part limit: 4,500 UTF-8 bytes. Split only at `，；。：！？`; never inside a `<phoneme>`. Mark names are the passage-wide index `i`, in every part.
- MP3: mono, 48 kbps, encoded once from the joined PCM, with ffmpeg's LAME/Xing header kept. Name `app/audio/passages/NN.zh.<h8>.mp3` (`h8` = first 8 hex of the MP3 SHA-256).
- DOM through `h()` and `fill()` from `app/js/ui.js`; text through `textContent`; no `innerHTML`; never `append()` a value that can be `null`; no inline styles or scripts (CSP). All colors from the CSS tokens in `app/css/app.css`.
- Main reader: phone, Brave, Android. Test at phone width.
- Copy (exact): button labels `▶ Listen`, `Loading…`, `❚❚ Pause`, `▶ Resume`; speeds `0.8×`, `1×`, `1.2×`; error `Audio did not load. Check the connection and try again.`
- Test passages for stage 1: 1, 2, 23.
- Scripts that tests import guard their CLI with `if (import.meta.url === pathToFileURL(process.argv[1]).href)`.
- Run `npm test` and `npm run check` before a task is called done. Run `npm run precache` in every task that changes a file under `app/`.
- Never name private review tooling in repo files. Commit only when Billy has asked for commits; otherwise stage the files and leave them.

## Review Focus

1. A passage whose text changes after recording: the check fails with the exact rerun message, and the page shows no button when `t.length !== cells.length` (Task 5, Task 8).
2. Seeking and offline replay: a `Range` request after the first play gets a `206` from the cache with the network off, also after a page reload (Task 6 handler test + Task 11 manual step).
3. A sheet or a plate "Hear" button during play: Listen pauses and does not resume by itself; a `say()` still waiting for its index does not start after Listen starts (Task 7, Task 8 tests).
4. The reader scrolls the column by hand during play: no follow during the gesture, and none for 4 s after the last manual scroll (Task 9 test of `followAllowed`, plus manual).
5. Leaving the page during play (`hashchange`, `pagehide`): audio stops and the wake lock is released, and no listener stays behind (Task 8 test).

---

### Task 1: One character rule for column, build, and check

**Files:**
- Modify: `app/js/markup.js` (add exports)
- Modify: `app/js/views/passage.js:62-88`
- Modify: `scripts/check-content.mjs`
- Test: `tests/markup.test.js`

**Interfaces:**
- Produces: `passageChars(segments: string[]) -> Array<{ ch: string, seg: number, k: number, i: number }>` in `app/js/markup.js`. `k` is the code-point index in the segment (same as `zh[seg].gloss` keys); `i` counts Han characters across the passage.
- Produces: `segmentsFor(text: { zh: string[] }, rich: { zh?: { text: string }[] } | null) -> string[]` in `app/js/markup.js`: `rich?.zh?.[i]?.text ?? text.zh[i]` for each `i` of `text.zh`. (`text` is one entry of the `text.json` array.)
- Produces (in `passage.js`, used by Task 9): `hanButtons: HTMLButtonElement[]`, the `button.han` elements in `passageChars` order.

- [ ] **Step 1: Write the failing tests**

```js
test('passageChars counts Han code points per segment and across the passage', () => {
  const c = passageChars(['道可道，非', '常道。']);
  assert.equal(c.length, 6);
  assert.deepEqual(c[3], { ch: '非', seg: 0, k: 4, i: 3 });
  assert.deepEqual(c[5], { ch: '道', seg: 1, k: 1, i: 5 });
});
test('segmentsFor prefers the passage file text', () => {
  // text.json passage 1 seg 0 ends '；' after 非常名, 01.json seg 0 is '道可道，非常道；名可名，非常名。'
  assert.equal(segmentsFor(text[0], p1)[0], p1.zh[0].text);
});
test('passage 1 has 59 characters and passage 2 has 惡 at i 9, seg 0, k 10', () => {
  assert.equal(passageChars(segmentsFor(text[0], p1)).length, 59);
  assert.deepEqual(passageChars(segmentsFor(text[1], p2))[9], { ch: '惡', seg: 0, k: 10, i: 9 });
});
```

- [ ] **Step 2: Run `node --test tests/markup.test.js`.** Expected: FAIL, `passageChars` is not exported.
- [ ] **Step 3: Implement both functions** with `[...seg]` and the existing `isHan`.
- [ ] **Step 4: In `passage.js`,** take the segments from `segmentsFor(text, p)`. Make each Han cell from the `passageChars` entry for that position (walk the segment's code points; at a Han code point, take the next `passageChars` entry and assert its `ch` matches). Push each `button.han` to `hanButtons`. Punctuation handling stays as it is.
- [ ] **Step 5: In `check-content.mjs`,** read `app/data/text.json` once as `allText`; for each passage file, `err` when `p.zh.length !== allText[p.n - 1].zh.length`.
- [ ] **Step 6: Run `npm test && npm run check && npm run precache`.** Expected: all pass.
- [ ] **Step 7: Stage** the changed files.

### Task 2: SSML builder, readings resolver, source hash

**Files:**
- Create: `scripts/lib/listen-ssml.mjs`
- Test: `tests/listen.test.js`

**Interfaces:**
- Consumes: `passageChars`, `segmentsFor` (Task 1).
- Produces, all pure:
  - `SETTINGS = { voice: 'cmn-CN-Wavenet-B', rate: 0.8, encoding: 'LINEAR16', mp3: 'mono-48k' }` (frozen). Build and check both import it.
  - `resolveReading(n: number, c: { ch, seg, k }, readings) -> string | null` — the numbered pinyin to force, or `null`. Order: `readings.engine` has `ch` → `null`; `readings.at["n:seg:k"]?.py`; `readings.chars[ch]`; `readings.extra[ch]?.py`; `null`.
  - `needsDecision(ch, lex, readings) -> boolean` — `(lex[ch]?.py?.length ?? 0) > 1 || !!readings.extra[ch]`, and `ch` not in `readings.engine`.
  - `buildSsml(segments: string[], forced: (c: { ch, seg, k, i }) => string | null) -> Array<{ ssml: string, first: number, count: number }>` — one `<speak>` per part; `<mark name="i"/>` before each Han character (passage-wide `i`); phoneme wrap when `forced` returns a value; allowed punctuation kept as text: `，。；：、！？「」『』（）《》` and ASCII `,.;:!?`; `﹗`→`！`, `﹑`→`、`; spaces dropped; any other character throws `Error('passage text has unexpected character: X')`; `& < >` escaped; a new part starts at a clause end when the next clause would pass 4,500 UTF-8 bytes; one clause over the limit throws.
  - `sourceHash(parts) -> string` — SHA-256 hex over each part's `ssml` (in order) and `JSON.stringify(SETTINGS)`.
  - `validateReadings(n: number, segments: string[], readings, lex) -> string[]` — errors: an unresolved `needsDecision` character (message names passage, `seg:k`, and the character); an `at` key for passage `n` whose `segments[seg]` code point `k` is not `ch`; an `at` whose `ctx` does not occur in `segments[seg]` at an offset `o` with `o <= k < o + ctx.length`; an `at` or `chars` entry for an `engine` character; a `py` not matching `/^[a-z]+[1-5]$/`; a `py` whose toneless syllable (`ü`→`v`) is not one of the toneless `lex[ch].py`, unless it is an `extra` entry with a `why`.

- [ ] **Step 1: Write the failing tests**

```js
test('marks precede every character and phoneme wraps forced ones', () => {
  const parts = buildSsml(['斯惡已；'], (c) => (c.ch === '惡' ? 'e4' : null));
  assert.equal(parts[0].ssml, '<speak><mark name="0"/>斯<mark name="1"/><phoneme alphabet="pinyin" ph="e4">惡</phoneme><mark name="2"/>已；</speak>');
});
test('small punctuation is mapped and spaces are dropped', () => {
  assert.equal(buildSsml(['知﹗ 行﹑'], () => null)[0].ssml, '<speak><mark name="0"/>知！<mark name="1"/>行、</speak>');
});
test('an unknown character throws', () => {
  assert.throws(() => buildSsml(['道x'], () => null), /unexpected character: x/);
});
test('a long segment splits at clause ends under 4500 bytes, never inside a phoneme', () => {
  const seg = Array.from({ length: 50 }, () => '長長長長長長長長，').join('');
  const parts = buildSsml([seg], () => 'chang2');
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(Buffer.byteLength(p.ssml) <= 4500 && /，<\/speak>$/.test(p.ssml));
  assert.equal(parts[1].first, parts[0].count);
});
test('sourceHash is stable and changes with one character or one reading', () => {
  const a = sourceHash(buildSsml(['道可道'], () => null));
  assert.equal(a, sourceHash(buildSsml(['道可道'], () => null)));
  assert.notEqual(a, sourceHash(buildSsml(['道可導'], () => null)));
  assert.notEqual(a, sourceHash(buildSsml(['道可道'], (c) => (c.i === 1 ? 'ke3' : null))));
});
test('resolveReading: engine wins, then at, chars, extra', () => {});
test('validateReadings reports a missing decision, a moved at-key, a ctx off the key, an engine override, a bad tone, and a syllable the lexicon lacks', () => {
  // tiny lex { 長: { py: ['cháng','zhǎng'] }, 一: { py: ['yī','yí','yì'] }, 沒: { py: ['méi'] } };
  // readings { chars: {}, extra: { 沒: { py: 'mo4', why: 'test' } }, at: {}, engine: ['一'] } — 沒 'mo4' is accepted.
});
```

- [ ] **Step 2: Run `node --test tests/listen.test.js`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `scripts/lib/listen-ssml.mjs`.**
- [ ] **Step 4: Run `node --test tests/listen.test.js`.** Expected: PASS.
- [ ] **Step 5: Stage** both files.

### Task 3: Readings for the three test passages

**Files:**
- Create: `scripts/audio-readings.json`

**Interfaces:**
- Produces: `{ "chars": {}, "extra": { "沒": { "py": "mo4", "why": "沒身: to the end of life" }, "伯": { "py": "bai3", "why": "什伯: tens and hundreds" } }, "at": {}, "engine": ["一", "不"] }`, filled for passages 1, 2, 23.

- [ ] **Step 1: List the decisions needed.** A one-off Node command prints, for passages 1, 2, 23, every character where `needsDecision` is true: `seg:k`, the segment text, the `gloss` at `k`, and the lexicon `py` and `senses`.
- [ ] **Step 2: Write the decisions.** A character's usual reading in this text goes in `chars`. An occurrence that differs goes in `at` with `ch` and a `ctx` of 3–5 characters around it. Each choice follows the line's gloss and our rendering. Known: 惡 in 斯惡已 is è (`e4`); 和 in 音聲相和 is hè (`he4`, gloss in `02.json`); 長 in 長短 is cháng; 易 in 難易 is yì.
- [ ] **Step 3: Run `validateReadings` for 1, 2, 23** (Node one-liner). Expected: no errors.
- [ ] **Step 4: Second reviewer (does not block Task 4 for these three passages).** Send the decision list (character, context, reading, reason) to the translation reviewer. Fix what it shows to be wrong against the gloss. List any reading without clear support for Billy.
- [ ] **Step 5: Stage** the file.

### Task 4: Build script

**Files:**
- Create: `scripts/build-audio.mjs`
- Modify: `package.json` (`"audio": "node scripts/build-audio.mjs"`)
- Modify: `scripts/build-precache.mjs:12,51` (`hashDir(dir, skip = [])`; `AUDIO_VERSION = hashDir('audio', ['passages'])`)
- Test: `tests/listen.test.js` (pure helpers only)

**Interfaces:**
- Consumes: Task 1, Task 2, `scripts/audio-readings.json`.
- Produces: `app/data/listen.json` `{ v: 1, voice, rate, zh: { "<n>": { file, src, n, end, t } }, en: {} }` (`file` relative to `app/`, for example `audio/passages/01.zh.1a2b3c4d.mp3`); MP3 files under `app/audio/passages/`.
- Produces (exported): `joinTimes(parts: Array<{ times: number[], samples: number }>, sampleRate: number) -> { t: number[], end: number }` (part k's times plus earlier samples ÷ rate; 3 decimals; `end` = all samples ÷ rate); `parseWav(buf: Buffer) -> { sampleRate, channels, pcm: Buffer }` (find the `data` chunk; do not assume a 44-byte header).
- CLI: `node scripts/build-audio.mjs [N…]` (no number: every passage already in `listen.json`); `--drop N`; `--no-force --out <path> N` (one passage, no phonemes, written only to `<path>`, manifest and `app/` untouched).

- [ ] **Step 1: Failing tests** for `joinTimes` (two parts of 24000 samples at 24000 Hz: the second part's first time is 1.0 more; `end` is 2.0) and `parseWav` (a hand-made header with an extra `LIST` chunk before `data`).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** For each passage, in this order: segments by `segmentsFor`; `validateReadings` (errors → exit 1 for that passage before any API call); parts by `buildSsml` with `resolveReading`; `sourceHash`; skip when equal to the stored `src`; one API call per part; check `timepoints.length === part.count` and names `first … first+count-1` in order (else exit 1, write nothing); join PCM; encode with `ffmpeg -f s16le -ar <rate> -ac 1 -i - -codec:a libmp3lame -b:a 48k <tmp>.mp3`; hash and rename to the final name; write `listen.json` (temp file + rename; keep other entries; one passage per line); then delete that passage's older `NN.zh.*.mp3`. Warn on stderr for mark gaps under 0.08 s. `--drop N`: remove the entry (temp + rename), then delete its MP3.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Record passage 1.** `npm run audio -- 1`. Expected: `t` has 59 entries, `end` near 23.8, the MP3 near 140 KB.
- [ ] **Step 6: Run `npm run precache`.** Expected: `AUDIO_VERSION` in `sw.js` is unchanged from before Step 5.
- [ ] **Step 7: Stage** the script, `package.json`, `build-precache.mjs`, the test, and the generated files.

### Task 5: Audio check

**Files:**
- Create: `scripts/check-audio.mjs`
- Modify: `package.json` (`check` adds `&& node scripts/check-audio.mjs`)
- Test: `tests/listen.test.js`

**Interfaces:**
- Produces: `checkListen({ manifest, segmentsOf: (n) => string[], readings, lex, exists: (relPath) => boolean, mp3s: string[] }) -> string[]`, exported. The CLI passes `segmentsOf = (n) => segmentsFor(allText[n - 1], passageFile(n))` and `mp3s` = the files in `app/audio/passages/`. A missing `app/data/listen.json` → print `no recordings` and exit 0.
- Errors: `src` differs from `sourceHash(buildSsml(segmentsOf(n), …resolveReading))` → exactly ``Passage N text or readings changed after the recording. Run `npm run audio -- N`, or `npm run audio -- --drop N`.``; `t.length !== n`; `t` not increasing; `end <= t[n-1]`; the `file` does not exist; an MP3 in `mp3s` that no entry names; every `validateReadings` error.

- [ ] **Step 1: Failing tests,** one per error above, plus: no errors for a correct manifest made by the same builder.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test && npm run check`.** Expected: PASS.
- [ ] **Step 5: Stage.**

### Task 6: Service worker: listen cache and Range answers

**Files:**
- Create: `app/js/sw-range.js` (classic script, no `import`/`export`; sets `globalThis.taoRange = { parseRange, sliceResponse, audioFetch }`)
- Modify: `app/sw.js` (outside the precache markers)
- Test: `tests/sw-range.test.js`

**Interfaces:**
- Produces:
  - `parseRange(header: string | null, size: number) -> { start, end } | null | 'invalid'` (`null` = no header; an `end` past the size is clamped to `size - 1`).
  - `sliceResponse(full: Response, header: string | null) -> Promise<Response>` — `206` with `Content-Range: bytes S-E/SIZE`, `Accept-Ranges: bytes`, `Content-Length`, the original `Content-Type`; `416` with `Content-Range: bytes */SIZE` when invalid; `full` unchanged when there is no header.
  - `audioFetch(req: Request, cache: Cache, fetchFn: typeof fetch) -> Promise<Response>` — key `new Request(new URL(req.url).href)` (no `Range`); cached → slice; else `fetchFn` that key; a non-`200` is returned as it is and not stored; a `200` is stored (`await cache.put`) and then sliced.

- [ ] **Step 1: Failing tests** (load with `await import('../app/js/sw-range.js')`, then `globalThis.taoRange`; Node 22 has `Request`, `Response`, `Headers`; the `Cache` is a small `Map`-backed stub): `bytes=0-`; `bytes=100-199`; `bytes=100-`; `bytes=-50`; `bytes=0-999999` on size 100 → `0-99`; `bytes=5000-` on size 100 → 416; sliced bytes equal the source; `audioFetch` with `Range` calls `fetchFn` once with no `Range` header, stores the `200`, returns a `206`; a second call with `fetchFn` that throws still returns a `206` from the cache; a `404` is returned and not stored.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `sw-range.js`.**
- [ ] **Step 4: Change `sw.js`.** `importScripts('js/sw-range.js')` at the top. `const LISTEN_CACHE = 'tao-listen';`. `LAZY` gets `['/audio/passages/', LISTEN_CACHE]` before `['/audio/', AUDIO_CACHE]`. In the lazy branch, a path under `/audio/` returns `taoRange.audioFetch(req, c, fetch)`; other lazy paths keep their code. `activate` keeps `LISTEN_CACHE` and then prunes it: read `data/listen.json` from `CACHE`; if it is missing or unreadable, skip; else delete each `LISTEN_CACHE` entry whose `new URL(key.url).pathname` is not in the set of `new URL(entry.file, self.registration.scope).pathname`.
- [ ] **Step 5: Run `npm test && npm run precache`.** Expected: PASS; `sw.js` has a new `VERSION`.
- [ ] **Step 6: Stage.**

### Task 7: One sound at a time in `audio.js`

**Files:**
- Modify: `app/js/audio.js`
- Test: `tests/audio.test.js`

**Interfaces:**
- Produces: `stopSay()` — adds 1 to a module generation counter, pauses `current`, and calls `globalThis.speechSynthesis?.cancel()`. `say()` takes the counter value at its start and returns `false` without playing if the value changed after any `await` (the index, and before the speech fallback after a failed `play()`). `say()` calls `globalThis.dispatchEvent?.(new Event('tao:sound'))` before it plays, in the file branch and in the speech branch.

- [ ] **Step 1: Failing tests.** Harness: set `globalThis.fetch` to return `['dao4']` before the first `say()` (the index is cached per module); a stub `globalThis.Audio` with `play()`/`pause()` counters; an `EventTarget` whose `dispatchEvent`/`addEventListener` are bound onto `globalThis`; restore all globals after each test. Tests: `say('dào','道')` dispatches `tao:sound` once and plays; `stopSay()` pauses the stub; `stopSay()` called while the index fetch is still pending (a `fetch` that resolves later) → that `say()` returns `false` and never calls `play()`.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS).**
- [ ] **Step 5: Run `npm run precache`. Stage.**

### Task 8: Player controller and controls

**Files:**
- Create: `app/js/listen.js`
- Modify: `app/css/app.css` (`.listen-row`, `.column .han.now`, `.column .han.done`)
- Test: `tests/listen-player.test.js`

**Interfaces:**
- Consumes: `stopSay` (Task 7), `sheetOpen()` (`app/js/sheet.js`), `track` (`app/js/track.js`), `h` (`app/js/ui.js`).
- Produces:
  - `indexAt(times: number[], now: number) -> number` — last `i` with `times[i] <= now`, else `-1` (binary search).
  - `createPlayer({ media, indexNow, cells, deps, onIndex, onState }) -> { toggle(), setRate(r), stop(), state }` — no DOM access. `media` is any object with `play(): Promise`, `pause()`, `playbackRate`, `preservesPitch`, `addEventListener(type, fn)` for `play|pause|waiting|playing|ended|error`, `removeAttribute`, `load()`. `indexNow()` returns the current index (for audio: `indexAt(times, media.currentTime + LEAD)`, `LEAD = 0`). `deps = { raf, cancelRaf, isSheetOpen, events: EventTarget, wakeLock: { request(): Promise<{ release() }> } | null, stopSay, track, storage }`. `onState(state)` gets one of `idle | loading | playing | paused | error`. `cells` get `now`/`done` classes through `classList`.
  - Behaviour: first `toggle()` calls `deps.stopSay()`, `track('listen', 'zh ' + n)` once, `media.play()`. Each frame: index → classes → `onIndex(i)` when it changes; `isSheetOpen()` true → pause. `tao:sound` on `deps.events` → pause. Wake lock requested on `playing`, released on `pause`, `ended`, and `stop()`; re-requested on `visibilitychange` when visible and playing. `hashchange` and `pagehide` on `deps.events` → `stop()`. `stop()` pauses, removes `src`, calls `load()`, releases the lock, cancels the frame, clears the classes, and removes every listener it added. Speed from `deps.storage` key `tao-listen-rate` (try/catch).
  - `listenRow({ n, file, times, end, cells, onIndex, onStart, onStop }) -> HTMLElement | null` — `null` when `times.length !== cells.length`. Builds the button and speed chips with `h()`, makes the `Audio` (`preload = 'none'`, `src = file`) on the first press, and wires `createPlayer` with real deps (`requestAnimationFrame`, `sheetOpen`, `window`, `navigator.wakeLock ?? null`, `stopSay`, `track`, `localStorage`). Labels from `onState`. Speed chips appear after the first press. `onStart` on the first `playing`; `onStop` on `stop()` and `ended`.
- CSS (after `.column .han.glossed`, so source order wins): `.column .han.now { background: var(--seal); color: var(--seal-ink); border-radius: 4px; }`, `.column .han.done { opacity: .55; }`. No font-weight change.

- [ ] **Step 1: Failing tests** for `indexAt` (empty, before first, exact hit, between, after last) and for `createPlayer` with a fake media (an `EventTarget` with the methods above), fake cells (`{ classList }` sets), a manual `raf` queue, and a stub wake lock: classes follow `indexNow`; `isSheetOpen` true pauses and later frames do not resume; `tao:sound` pauses; `hashchange` stops, calls `load()`, calls `release()`, and leaves no listener on `deps.events`; `ended` clears `now`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `listenRow` is not unit-tested (it needs a DOM); Task 9 Step 6 checks it by hand.
- [ ] **Step 4: Run `npm test && npm run precache`.** Expected: PASS.
- [ ] **Step 5: Stage.**

### Task 9: Passage page integration and column follow

**Files:**
- Modify: `app/js/views/passage.js` (Chinese column block, lines 62-129)
- Test: `tests/listen-player.test.js`

**Interfaces:**
- Consumes: `listenRow` (Task 8), `hanButtons` (Task 1), `app/data/listen.json`.
- Produces, exported from `listen.js`:
  - `followTarget({ cellLeft, cellRight, boxLeft, boxRight, scrollLeft, maxScroll, margin }) -> number` — the new `scrollLeft` that keeps the cell at least `margin` px inside the box's left edge and inside its right edge, clamped to `[0, maxScroll]`. This container uses positive `scrollLeft`: `toRight()` sets it to `scrollWidth` (`passage.js:105`), and reading moves toward 0.
  - `followAllowed(now: number, lastManual: number, gestureActive: boolean) -> boolean` — `!gestureActive && now - lastManual >= 4000`.

- [ ] **Step 1: Failing tests** for `followTarget` (cell inside → unchanged; past the left margin → cell's left lands at `boxLeft + margin`; clamped at both ends) and `followAllowed` (during a gesture → false; 3.9 s after → false; 4 s after → true).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement both.**
- [ ] **Step 4: Wire the page.** Do not `await` the manifest in the view: `fetch('data/listen.json').then(r => r.json()).then(...)`, errors ignored. When `zh[n]` exists: `const row = listenRow({ n, file, times: t, end, cells: hanButtons, onStart, onIndex, onStop }); if (row) layoutBtns.after(row);`. `onStart`: `touched = true`. Keep `current` = the last `onIndex` value. Gesture tracking on `colWrap`: `pointerdown`/`touchstart` set `gestureActive`; `pointerup`/`touchend`/`pointercancel` clear it and set `lastManual = Date.now()`; `wheel`, `keydown`, and `scroll` while `gestureActive` set `lastManual`. `onIndex(i)`: if `followAllowed(...)`, set `colWrap.scrollLeft = followTarget(...)` from `getBoundingClientRect()` of `hanButtons[i]` and `colWrap`, `maxScroll = scrollWidth - clientWidth`, and `margin = max(2 × one cell width, 3.2rem in px)`. The layout chip handler: when `current >= 0`, reveal `hanButtons[current]` with `followTarget`; else `toRight()`.
- [ ] **Step 5: Run `npm test && npm run check && npm run precache`.** Expected: PASS.
- [ ] **Step 6: Manual check at 400 px** (`npm run serve`; the SW is off on http): passage 1 plays; the highlight follows and stays clear of the "← more" fade; a tap on a character opens the note and pauses; a plate "Hear" pauses Listen; a layout chip while paused keeps the current character in view; a hand scroll stops the follow for 4 s.
- [ ] **Step 7: Stage.**

### Task 10: Analytics event and licence

**Files:**
- Modify: `worker/index.js:4` (add `'listen'` to `EVENTS`)
- Modify: `NOTICE` (narrow the audio-cmn line to the syllable files `app/audio/*.mp3`; add: the passage recordings in `app/audio/passages/` are made with Google Cloud Text-to-Speech from the public-domain Chinese text)

- [ ] **Step 1: Edit both files.**
- [ ] **Step 2: Run `npm test && npm run check`.** Expected: PASS.
- [ ] **Step 3: Stage.**

### Task 11: Record the test passages and check them on the phone

**Files:**
- Generated: `app/audio/passages/01.zh.*.mp3`, `02.zh.*.mp3`, `23.zh.*.mp3`, `app/data/listen.json`, `app/sw.js` precache block

- [ ] **Step 1: Forcing test.** `npm run audio -- 2` and `npm run audio -- --no-force --out <scratchpad>/02-plain.mp3 2`. Put both on one private test page (the same style as the first voice test page) and ask Billy which sounds right. If forcing sounds worse: listen for where the engine already says the decided reading; for those characters, add them to `engine` in `audio-readings.json` with a `"why"` note in a sibling `"engineWhy"` map. Rebuild passage 2.
- [ ] **Step 2: Record 1, 2, 23.** `npm run audio -- 1 2 23`. Expected: no mark-count error. Listen to the spots in any gap warning.
- [ ] **Step 3: `npm run precache && npm test && npm run check`.** Expected: PASS.
- [ ] **Step 4: Preview deploy.** Try `npx wrangler versions upload` for a preview URL. Ask Billy before any production deploy.
- [ ] **Step 5: Billy's phone test (Brave, Android).** Play, pause, resume, each speed, column follow, a note during play, a plate "Hear" during play, back to the list during play, the screen stays on past 30 s (passage 23), airplane mode then reload and replay (offline cache through the worker). Tune `LEAD` if the highlight is late with the speaker or with earbuds.
- [ ] **Step 6: Stage the generated files.**

### Later (not in this plan)

- Readings for all 81 passages, full build, full listening pass (spec "Rollout" step 2), with Task 3's process and the reviewer step as a gate.
- Stage 2 English: its own plan after the English voice test.
