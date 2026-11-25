# Listen: read-aloud with highlighting — design

Date: 2026-11-24. Status: approved by Billy in conversation ("go for it").

## Intent

A **Listen** button on each passage page plays a recording of the Chinese
text. Each character lights up while the voice says it. A second stage adds
the same for the English rendering, one word at a time.

The main reader uses a phone in Brave. The reader wants to hear how the
classical text sounds and to follow it character by character. The
highlight must keep time with the voice on every phone. This is why the
audio and timings are made once at build time and shipped as files.

## Goals

- Natural, clear Mandarin reading of every passage (81), with an exact
  character highlight.
- The same player for the English rendering (stage 2), with a word highlight.
- Works offline after the first play (service worker cache).
- No change to the CSP. No third-party requests at run time.

## Non-goals

- Reading Wang Bi's commentary, notes, or Legge.
- Tap a character to seek the audio to it.
- Device text-to-speech (Option 1). That is a separate, later plan
  `docs/superpowers/plans/2026-11-24-listen-device-voice.md`.

## Anti-goals (failure even if it works)

- The highlight runs ahead of or behind the voice. (The spike showed this
  with speech-recognition timings. WaveNet marks did not have it.)
- A wrong reading of a polyphonic character goes out without a decision.
- Listen breaks the notes, the column scroll, or the "Lines" layout.
- The precache grows by megabytes. Audio is cached on first play only.

## Spike results (2026-11-24)

Test page: passage 1 in five voices (WaveNet B, Chirp 3 HD Charon and
Sulafat, Gemini TTS Charon and Sulafat). Billy selected **WaveNet B**
(`cmn-CN-Wavenet-B`, male). It sounded good and its highlight matched
the voice best. The other four voices took timings from Speech-to-Text
word offsets. Their highlight ran about one character ahead.

Facts the spike proved:

- `v1beta1/text:synthesize` with `enableTimePointing: ["SSML_MARK"]` returns
  one `timeSeconds` for each `<mark name="i"/>` placed before a character.
  59 marks for 59 characters in passage 1.
- `<phoneme alphabet="pinyin" ph="jiao3">徼</phoneme>` changes the tone
  (measured pitch curve: tone 3 dip). `ph="jiao4"` gives tone 4. A
  tone-mark form (`jiǎo`) is ignored silently. Use numbered pinyin only.
- A mark before a `<phoneme>` element still returns a time.
- Plain 徼 in passage 1 is read jiào (correct).
- Passage 1 at `speakingRate: 0.8` is 23.8 s and 190 KB at the default
  MP3 bitrate.

## Approaches considered

1. **Device voice (Web Speech API).** No build step. Voice quality depends
   on the phone. `boundary` events are unreliable for Chinese on Android,
   so the highlight would guess. Kept as the later Option 1 plan.
2. **Natural voice (Chirp 3 HD / Gemini TTS) + speech-recognition timings.**
   Best sound. Timings ran one character ahead in the spike, and the build
   needs a second API and an alignment step.
3. **WaveNet B with SSML marks (chosen).** Exact timings from the engine,
   forced readings with `<phoneme>`, one API call per passage. Billy picked
   it after listening.

## Design

Revised 2026-11-24 after a builder check and a design review. The review
decisions are in "Review decisions" at the end.

### Cloud access

- GCP project `tao-of-power`, owner billzajac@gmail.com. Text-to-Speech API
  is on. Use the gcloud configuration `tao`:
  `gcloud --configuration=tao auth print-access-token`.
- REST calls with user credentials need the header
  `x-goog-user-project: tao-of-power`.
- No API key or credential goes in the repo.

### Shared character rule

- Add `passageChars(segments)` to `app/js/markup.js`. It returns one entry
  per Han code point, in reading order: `{ ch, seg, k, i }`, where `seg`
  is the segment number, `k` the code-point index inside the segment
  (the same index as `zh[seg].gloss`), and `i` the index across the
  passage.
- `passage.js` uses it to build the column, so the column, the build, and
  the check use one rule. Segments come from `text.zh` with the
  `p.zh[i].text` override, as today (`passage.js:63-65`).
- Add a check in `check-content.mjs`: the passage file and `text.json`
  have the same number of segments.

### Readings: `scripts/audio-readings.json`

Every multi-reading character in a recorded passage has a recorded,
forced reading. The engine's default is never trusted.

- `"chars"`: one default reading per character, for example
  `"長": "chang2"`. Required for every character that has more than one
  `py` in the lexicon and occurs in a recorded passage, and for every
  character in `"extra"`.
- `"extra"`: characters whose lexicon lists only one reading but which
  take another reading in this text. The first list: 沒 (mò), 伯 (bǎi in
  什伯). The reviewer adds more while reading all 81 passages.
- `"at"`: per-occurrence exceptions, keyed `"<passage>:<seg>:<k>"`, for
  example `"2:0:10": { "ch": "惡", "py": "e4", "ctx": "斯惡已" }`. `ctx`
  is a short run of the text around the character. The check finds the
  same `ch` and `ctx` at that key, so a text edit cannot move a decision
  onto another character silently.
- `"engine"`: characters left to the engine because their reading follows
  tone sandhi: 一, 不. These are never forced.
- Pinyin is always numbered (`[a-z]+[1-5]`, `v` for ü). The check strips
  the tone and requires the syllable to be one of the lexicon readings of
  the character, or the entry has a `"why"` text (used for `"extra"`).
- The build wraps every forced character in
  `<phoneme alphabet="pinyin" ph="…">`.
- Who decides: Claude proposes the `"chars"` defaults and the `"at"`
  exceptions from the line `gloss`, the rendering, and the lexicon
  `senses`, and reads all 81 passages for `"extra"` characters. A second
  reviewer checks the batch. A reading with no clear support goes to Billy
  as a short list. This task gates the build of all 81 passages, not the
  three test passages.
- **Stage 1 test of forcing:** build passage 2 two ways, with and without
  forced readings, and listen. If forcing makes the voice worse, force
  only where the decision differs from the engine (found by listening),
  and record that as a decision.

### Build script: `scripts/build-audio.mjs`

- Run by hand: `npm run audio -- [N ...]` (all recorded passages when no
  number is given). `npm run audio -- --drop N` removes passage N from the
  manifest, so a deploy can go ahead without Google access after a text
  edit. The output is committed, so `npm run build` and `npm run deploy`
  need no Google access.
- A pure module `scripts/lib/listen-ssml.mjs` makes the SSML and its
  hash. The build, the check, and the tests use it.
- SSML: before each character, `<mark name="i"/>`. Forced characters are
  wrapped in `<phoneme>`. Punctuation stays as text, so it makes the
  pauses. Small or rare forms are mapped for SSML only (`﹗`→`！`,
  `﹑`→`、`). A space is dropped. Any other non-Han character fails the
  build. Escape `& < >`.
- Request: voice `cmn-CN-Wavenet-B`, `speakingRate: 0.8`,
  `audioEncoding: LINEAR16`, `enableTimePointing: ["SSML_MARK"]`.
- Size: measure the final UTF-8 SSML. If it is over 4,500 bytes, split it
  at clause ends (，；。：！？) into parts under the limit. Never split
  inside a phoneme element. Passages 31 and 38 need this split.
- Join: concatenate the PCM parts. Add each part's exact start offset
  (samples ÷ rate) to that part's mark times. Then encode the MP3 once
  with ffmpeg (mono, 48 kbps; a lower rate is a builder call if it sounds
  the same). One encode only, so the timings stay exact.
- Fail, and write nothing for that passage, when the number of marks
  differs from the number of characters.
- Warn when two marks are less than 0.08 s apart. This can mean the voice
  skipped a rare character (for example 儽, 飂, 琭). Listen to it.
- Output:
  - `app/audio/passages/NN.zh.<h8>.mp3`. `<h8>` is the first 8 hex
    characters of the MP3's SHA-256. The name changes when the audio
    changes.
  - `app/data/listen.json` (the manifest). It is small, so it is
    precached with the text, and the text and the timings always come
    from the same release:
    ```
    { "v": 1, "voice": "cmn-CN-Wavenet-B", "rate": 0.8,
      "zh": { "1": { "file": "audio/passages/01.zh.1a2b3c4d.mp3",
                     "src": "<sha256 of SSML + encoder settings>",
                     "n": 59, "end": 23.83, "t": [0.015, 0.265, …] } },
      "en": {} }
    ```
  - Old MP3 files of a passage are deleted when its new file is written.
- Cache: skip a passage when the new `src` equals the stored `src`.

### `scripts/check-audio.mjs` (added to `npm run check`)

For each passage in `listen.json`:

- Rebuild the SSML hash from the current text and readings. It must equal
  `src`. If not, fail with: "Passage N text or readings changed after the
  recording. Run `npm run audio -- N`, or `npm run audio -- --drop N`."
- `t.length === n`, `t` is increasing, `end > t[n-1]`, and the MP3 file
  exists.
- Every multi-reading character in the passage resolves to a reading
  (`"at"`, else `"chars"`, else `"engine"`). Every `"at"` key holds its
  `ch` and `ctx`. Every `py` is valid (see Readings).

### Service worker (`app/sw.js`, `scripts/build-precache.mjs`)

- `listen.json` is in the precache (it is under `app/data/`).
- MP3s go in a new lazy cache, `tao-listen`, that has no version. The
  file names carry the hash, so a cached file never goes stale. In
  `activate`, delete entries in `tao-listen` that `listen.json` no longer
  names. Add `tao-listen` to the keep-list.
- The `/audio/passages/` rule comes before the `/audio/` rule in `LAZY`.
  `AUDIO_VERSION` hashes `app/audio/` without `passages/`, so a new
  recording does not clear the 790 cached syllables.
- **Range requests.** A media element sends `Range`. The network answers
  `206`, which is `ok`, but `cache.put` rejects a `206` (`sw.js:364-366`),
  so the audio is never cached. For all of `/audio/` (passages and the
  existing syllables): fetch the URL without the `Range` header, store the
  full `200`, and answer each `Range` request with a `206` sliced from the
  cached body (`Content-Range`, `Accept-Ranges: bytes`, correct
  `Content-Length`).
- The worker registers only on `https:` (`app.js:87`), so test the worker
  on the deployed site, not on `npm run serve`.

### Player: `app/js/listen.js`

- API: `listenRow({ file, times, end, cells, onIndex, onStart, onStop })`
  returns the whole row (the button and the speed chips). `cells` are the
  `button.han` elements in order.
- If `times.length !== cells.length`, return nothing. The page shows no
  Listen button.
- The `Audio` element is made on the first press, with `preload="none"`,
  so opening a page does not download audio.
- A `requestAnimationFrame` loop finds the last index whose time is
  `<= currentTime + LEAD` (`LEAD` is a constant, 0 at first; tune it on the
  phone with speaker and with Bluetooth earbuds). It sets `now` on that
  cell and `done` on earlier cells, and calls `onIndex(i)`.
- Look: `now` has a filled `--seal` background and `--seal-ink` text.
  `done` lowers the opacity and keeps the red of glossed characters. No
  change of font weight (it would reflow the column).
- Controls: one button. Its label changes: "▶ Listen", "Loading…",
  "❚❚ Pause", "▶ Resume". `aria-label` follows the label. No
  `aria-pressed`. Speed chips 0.8× 1× 1.2× (`playbackRate`,
  `preservesPitch`), shown after the first press. The speed is kept in
  `localStorage`. At the end, the row resets.
- The button state comes from the audio events (`play`, `pause`,
  `waiting`, `playing`, `ended`, `error`), so a pause from the Android
  media notification or a phone call shows correctly.
- One sound at a time. `audio.js` gets `stopSay()`, and `say()` sends a
  `tao:sound` event. Listen calls `stopSay()` on start and pauses on
  `tao:sound`. This covers the plate "Hear" buttons (`passage.js:353`),
  which play outside the sheet.
- Pause when a note sheet opens. Check `sheetOpen()` from `sheet.js` in
  the loop, or add a small event in `sheet.js`. Do not resume by itself.
- Screen Wake Lock (`navigator.wakeLock.request('screen')`) while playing.
  Release it on pause, end, and stop. Request it again on
  `visibilitychange` when the page is visible and audio still plays.
  Without the API, play anyway.
- Stop and clean up on `hashchange` and `pagehide`: pause, remove `src`,
  call `load()`, release the wake lock.
- An error shows one line: "Audio did not load. Check the connection and
  try again."
- `track('listen', 'zh N')` on the first play of a page.

### Passage page (`app/js/views/passage.js`)

```
 The Chinese
 ┌──────────────────────────┐
 │ 名 非 道 非 道 可 道     │  current character: filled seal
 │ ...                      │  read characters: dimmed
 └──────────────────────────┘
 [Lines] [As printed]
 [▶ Listen]   0.8×  1×  1.2×
```

- The Listen row goes under the layout chips. The view renders first. The
  row is added when `listen.json` has the passage (the manifest is
  precached, but the view does not wait for it).
- `passage.js` owns the column scroll, through `onIndex` and `onStart`:
  - `onStart` sets `touched = true`, so the right-edge logic
    (`passage.js:106-112`) does not move the column during play.
  - `onIndex` keeps the current cell in view. Compute `scrollLeft` from
    `getBoundingClientRect()` of the cell and the column, and clamp it.
    Do not use `scrollIntoView`, because it can scroll the page. Keep a
    margin of about two columns on the left, because the "← more" fade
    covers the left 3.2rem (`app.css:675-679`).
  - After the reader scrolls the column by hand, stop following for 4 s.
  - A layout change during play or pause reveals the current cell, not
    `toRight()` (`passage.js:123`).

### Analytics

- Add `listen` to `EVENTS` in `worker/index.js`.

### Licence

- Add one line to `NOTICE`: the passage recordings in
  `app/audio/passages/` are made with Google Cloud Text-to-Speech from the
  public-domain Chinese text. Narrow the existing audio-cmn line to the
  syllable files.

### Stage 2: English (its own plan, after the English voice test)

- Voice: an English voice that supports SSML marks, chosen by Billy from
  a second listening test on passage 1.
- Words: tokenize each plain rendering line once (markup removed with
  `parseMarked`). A word is a run of letters, digits, `'`, and `’`
  (U+2019). Han characters are not English words. Map each word's
  character offsets onto the DOM text nodes of the rendered line. One word
  can span two nodes (for example "the sage" in a glossary button and "’s"
  after it, passage 3), and then both spans get the same index. Passage 3
  is a regression test.
- Romanized words ("de" in passage 38) get an alias table with
  `<sub alias="…">`.
- Passage 38's English SSML is about 4 KB, so the same split applies.

### Rollout

1. Stage 1 test: passages 1, 2, and one passage with 樂 or 行. Build
   passage 2 with and without forcing, and Billy listens. Deploy, and
   Billy tests on his phone: play, pause, speed, column follow, note open
   during play, a Hear button during play, route change, screen stays on,
   and offline replay.
2. Readings for all 81 (the review task above), then build all 81. One
   full listening pass before the deploy.
3. Stage 2 plan.

### Tests

- `tests/listen.test.js`: `passageChars` against the passage files;
  SSML builder (marks, phoneme, escape, small punctuation, a failing
  unknown character, clause split under the byte limit, no split inside
  a phoneme); hash stability; time-to-index lookup; readings resolution
  and `ctx` check.
- The SW range slicer as a pure function with a test (start, end,
  open-ended range, out of range → 416).
- `check-audio.mjs` in `npm run check`.

## Review decisions (2026-11-24)

From an independent design review.

- The cache uses hashed MP3 names, and the manifest is precached.
  (Old timings could play with a new MP3, and a per-file key with the
  manifest in the lazy cache would stay stale.)
- All multi-reading characters are forced, and Stage 1 tests forcing by
  ear.
- Readings are keyed by `seg:k` with `ctx`.
- The candidate list comes from the lexicon plus `"extra"`, because the
  lexicon lacks some readings (沒 has only méi; 伯 lacks bǎi).
- PCM join with one MP3 encode.
- Clause split, because single segments in passages 31 and 38 exceed the
  limit when forced readings are included.
- Wake lock, left-fade margin, one sound at a time, layout change keeps
  the position, small punctuation forms, skipped-character warning,
  `--drop`.

## Left to the builder

- Names inside the new modules.
- The exact ffmpeg flags and bitrate (within about 15 MB in total).
- The scroll animation details.
- The third test passage.
- Event or polling for the sheet-open pause.
