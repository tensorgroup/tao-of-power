# Listen (Stage 2: English) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Listen row under the English rendering of every passage plays a recording of our English and lights each word as it is spoken; and all 81 passages get both recordings.

**Architecture:** The stage 1 pipeline gets a language parameter. One word rule (`wordsOf`) in `app/js/markup.js` is used by the build, the check, and the page. The build writes `NN.en.<h8>.mp3` and an `en` manifest entry. The page splits the rendered English into word spans with a pure planner (`splitPlan`) and a thin DOM step, only when the passage has an English recording. The stage 1 player is reused; a `tao:listen` event keeps one row playing.

**Tech Stack:** As stage 1: plain ES modules, `node:test`, ffmpeg, Google Text-to-Speech `v1beta1`, gcloud configuration `tao`.

**Spec:** `docs/superpowers/specs/2026-11-24-listen-design.md` ("Stage 2: English", and everything stage 1 settled).

## Global Constraints

- Everything in the stage 1 plan's Global Constraints holds, except where this section changes it.
- English voice `en-US-Neural2-D`, language code `en-US`, `speakingRate: 0.9`, LINEAR16, `enableTimePointing: ["SSML_MARK"]`. Measured: Neural2 D returns one mark per word and accepts `<phoneme alphabet="ipa">` with marks. Studio voices reject `<mark>`. The voice lives in one constant, `SETTINGS_EN`; Billy may change it after his listening test (a full re-record costs cents).
- A word is a match of `/[A-Za-z0-9'’]+/g` on the plain line (markup removed with `parseMarked`). This rule lives only in `wordsOf`; every other module calls it.
- SSML: every other character passes through as escaped text (curly quotes, commas, dashes). Non-empty lines are joined with one space. Each empty line becomes exactly one `<break time="700ms"/>`, also across part boundaries.
- Romanized Chinese words are spoken with English-sound IPA from `scripts/audio-en-lexicon.json` (`<phoneme alphabet="ipa" ph="…">word</phoneme>`, whole word, case-insensitive): `Dao` daʊ, `de` dʌ, `qi` tʃiː, `yin` jɪn, `yang` jɑːŋ, `wu` wuː, `Laozi` ˈlaʊdzə. Only sounds in Google's en-US phoneme inventory.
- English parts split at `. ; : ! ?` and at line ends, under 4,500 UTF-8 bytes; never inside a `<phoneme>`.
- Files: `app/audio/passages/NN.en.<h8>.mp3`; manifest key `en`, same entry shape as `zh` (`n` = word count). The top-level `voice`/`rate` fields stay the Chinese ones; the English voice is inside each `src` hash.
- Copy: both rows use the stage 1 visible labels. `aria-label`s name the language: `Listen to the Chinese`, `Pause the Chinese`, `Resume the Chinese`, and the same with `English`. Track `listen` with `zh N` / `en N`.
- Total audio size target: about 35 MB (81 Chinese + 81 English; this replaces the spec's 15 MB, which counted Chinese only).
- Work on branch `listen-en` in a worktree; Billy has authorized commits there; never commit on main.

## Review Focus

1. A word across a markup boundary (`sage’s` in passage 3: "the sage" in a glossary button, then "’s"): one index, two spans, both lit; `aria-current` on the first span only (Task 3, Task 4a tests).
2. The DOM text of a rendered line differs from the plain line: the page compares the ordered word lists and shows no English row (Task 4b).
3. Two rows on one page: starting, resuming, or retrying one pauses the other, also while it is loading (Task 4a test).
4. The current English word leaves the screen on a phone: the page scrolls so the word's line sits below the sticky bar and above the bottom of `visualViewport`, but not during a manual page gesture and not for 4 s after it (Task 4b tests of `pageFollowDelta`).
5. A long passage (39, 208 words) splits into several parts with correct times (Task 1, Task 2).

---

### Task 1: Word rule and English SSML

**Files:**
- Modify: `app/js/markup.js` (add `plainLine`, `wordsOf`)
- Create: `scripts/lib/listen-en.mjs`
- Create: `scripts/audio-en-lexicon.json`
- Test: `tests/listen-en.test.js`

**Interfaces:**
- Produces: `plainLine(line) -> string` (parseMarked texts joined); `wordsOf(text) -> Array<{ word, start, end }>` (UTF-16 offsets).
- Produces: `SETTINGS_EN` (frozen: `voice`, `lang`, `rate`, `encoding`, `mp3`); `buildEnSsml(rendering: string[], ipa) -> Array<{ ssml, first, count }>`; `enSourceHash(parts) -> string` (SHA-256 over the parts, `SETTINGS_EN`, and nothing else); `romanizedCandidates(renderings: string[][], ipa) -> string[]` (words in the renderings that look like pinyin — a word made only of pinyin syllables, from a fixed syllable list — and are not in `ipa`).

- [ ] **Step 1: Failing tests:** `wordsOf('the sage’s way')` gives 3 words with offsets; two lines `a way` / `is not` give `…way <mark name="2"/>is…` (space kept); an empty line gives exactly one break, also when it falls on a part boundary; `Dao` becomes `<mark name="i"/><phoneme alphabet="ipa" ph="daʊ">Dao</phoneme>`; curly quotes and dashes pass through; passage 39 splits into parts ≤ 4,500 bytes, contiguous `first`/`count`, counts summing to `wordsOf` total; the hash changes with one word; `romanizedCandidates` over all 81 renderings returns `[]` once the lexicon file is complete.
- [ ] **Step 2: Run (FAIL). Step 3: Implement; fill `audio-en-lexicon.json` until the candidates test passes (each entry English-sound IPA). Step 4: Run (PASS).**
- [ ] **Step 5: Commit.**

### Task 2: Build and check for English; record pilots

**Files:**
- Modify: `scripts/build-audio.mjs`, `scripts/check-audio.mjs`
- Test: `tests/listen.test.js`

**Interfaces:**
- `record` takes a language object `{ key: 'zh'|'en', build(n) -> parts, hash(parts), validate(n) -> string[], voice: { languageCode, name }, rate }`. `writeMp3(dir, n, key, …)` and `removeOld(dir, n, key, keep)` take the key; nothing in the file-name logic is hard-coded to `zh`. The Chinese readings check runs only through the Chinese `validate`.
- CLI: `--en [N…]` (no number: every passage already in `en`); `--all` (every passage); `--en --all` (every passage with a rendering); `--en --drop N`.
- `checkListen` takes `renderingOf(n)` too; it checks every `en` entry like a `zh` entry (hash from the current rendering + IPA table, `n` and `t.length` equal to the `wordsOf` count over all lines, file and `prev` checks), and its stray-file set includes both languages. Stale English message: ``Passage N English changed after the recording. Run `npm run audio -- --en N`, or `npm run audio -- --en --drop N`.``

- [ ] **Step 1: Failing tests:** recording English for passage N keeps `NN.zh.*` files (`removeOld` with key `en`); the English language object's hash and count for a small rendering; `checkListen` stale-English message; an `NN.en.*.mp3` named by an `en` entry is not a stray.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS).**
- [ ] **Step 5: Record the English pilots** `npm run audio -- --en 1 3 38 39`: marks = words for each (passage 1: 80); passage 39 uses more than one part. Then `npm run precache && npm test && npm run check`.
- [ ] **Step 6: Commit.**

### Task 3: Word spans

**Files:**
- Create: `app/js/words.js`
- Test: `tests/words.test.js`

**Interfaces:**
- `splitPlan(nodeTexts: string[]) -> { words: string[], pieces: Array<Array<{ start, end, word }>> }` — calls `wordsOf` on the joined text and maps each word's range onto the nodes (a word over two nodes gives two pieces with one index). Pure.
- `wrapWords(lineEl, offset) -> { words: string[], cells: HTMLSpanElement[][] }` — TreeWalker over text nodes, `splitPlan`, `splitText`, wraps pieces in `span.w`. DOM only.
- `wordCell(spans) -> { classList: { add(...c), remove(...c), toggle(c, on) }, setAttribute(k, v), removeAttribute(k), getBoundingClientRect() }` — class calls go to every span; `aria-current` goes to the first span only; the rect is the first span's.

- [ ] **Step 1: Failing tests:** `splitPlan(['…the sage', '’s way'])` gives words `['the','sage’s','way']` (abbreviated) with `sage’s` in two pieces; punctuation-only and empty nodes; `words` equals `wordsOf(joined)`. `wordCell` over two fake spans: `add`/`remove`/`toggle` reach both; `aria-current` only the first.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS).** Step 5: Commit.

### Task 4a: Player changes

**Files:**
- Modify: `app/js/listen.js`
- Test: `tests/listen-player.test.js`

**Interfaces:**
- `createPlayer({ …stage 1…, kind: 'zh'|'en', id, lead = 0 })`. Before every `media.play()` (start, resume, retry) it dispatches `new CustomEvent('tao:listen', { detail: id })` on `deps.events`; on another id's `tao:listen` it pauses when its state is `playing` or `loading`. It tracks `listen` with `kind + ' ' + n` once. `indexNow` uses `lead`.
- `rowView(state, kind)` returns the language-named `aria` labels; update the stage 1 `rowView` tests.
- `listenRow({ kind, n, file, times, end, cells, onIndex, onStart, onStop, lead })` passes these through; `cells` may be `wordCell` objects.

- [ ] **Step 1: Failing tests:** another row's `tao:listen` pauses a playing player and a loading player; its own does not; resume and retry dispatch `tao:listen`; `kind: 'en'` tracks `en N`; `ended` and `stop()` with `wordCell` cells clear both spans; `rowView('playing','en').aria === 'Pause the English'`.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS).** Step 5: `npm run precache`; commit.

### Task 4b: English row on the passage page

**Files:**
- Modify: `app/js/views/passage.js` (rendering block ~52-56 and the manifest fetch ~170)
- Modify: `app/js/listen.js` (add `pageFollowDelta`)
- Modify: `app/css/app.css`
- Test: `tests/listen-player.test.js`

**Interfaces:**
- `pageFollowDelta({ top, bottom, barBottom, viewTop, viewBottom, margin }) -> number` — pixels to scroll the window (0 when the line is inside `[barBottom + margin, viewBottom - margin]`). Pure.
- Page: fetch `listen.json` once. The Chinese row depends on `listenOk` as now; the English row does not. When `en[n]` exists: wrap each rendered line (`wrapWords`, running offset), compare the ordered words with `rendering.flatMap(l => wordsOf(plainLine(l)).map(w => w.word))`; if they are equal and their count is `en[n].n`, insert the English row right after the rendering with `kind: 'en'`. Without `en[n]`, do not wrap.
- Page follow for English: window listeners for `touchstart`/`touchend`/`touchcancel`/`pointerdown`/`pointerup`/`pointercancel`/`wheel`/`keydown` set the gesture state; a `scroll` counts as manual only during a gesture; `followAllowed` decides; `onIndex` scrolls by `pageFollowDelta` using the line rect, the bottom of `.bar`, and `visualViewport` (fallback `innerHeight`). All window listeners are removed on `hashchange`.
- CSS: `.rendering .w.now { background: var(--seal); color: var(--seal-ink); border-radius: 3px; }`; `.rendering .w.done` dims by color mix and keeps ≥ 4.5:1 in both themes (ratios in the report). Note and glossary buttons keep their look and tap behaviour.

- [ ] **Step 1: Failing tests** for `pageFollowDelta` (inside → 0; above → negative to `barBottom + margin`; below → positive; bar covering the top).
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS).**
- [ ] **Step 5: Headless check at 400 px** on passages 1, 3, 38, 39: words light in order; `sage’s` lights as one word; a note opens on tap and pauses; starting English pauses Chinese and back; the page follows below the bar; a manual scroll pauses the follow for 4 s.
- [ ] **Step 6: `npm test && npm run check && npm run precache`. Commit.**

### Task 5: Record all passages and release

**Files:**
- Modify: `scripts/audio-readings.json` (the reviewed readings for all 81 passages, prepared outside this plan)
- Modify: `NOTICE` (the English recordings: Google Cloud Text-to-Speech Neural2, from the project's own English)
- Generated: MP3s, `app/data/listen.json`, `app/sw.js`

- [ ] **Step 1:** Install the reviewed readings file; `validateReadings` for 1–81 gives no errors. (The batch readings review with Neon replaces the per-passage `--list N` step for this first full build; record that in the report.)
- [ ] **Step 2:** `npm run audio -- --all` and `npm run audio -- --en --all`. No mark-count error; list every gap warning.
- [ ] **Step 3:** `npm run precache && npm test && npm run check`; report the total size of `app/audio/passages/`.
- [ ] **Step 4:** Final review (whole branch), merge to main, `npm run deploy`, and check that the live `data/listen.json` has 81 `zh` and 81 `en` entries.
