# Listen with the Device Voice (Option 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: saved for later.** Do this only after Billy has used the WaveNet Listen (stage 1) and asks for it. It depends on stage 1 being merged.

**Goal:** Let the reader hear a passage in the phone's own Chinese voice, with the same character highlight, for passages that have no recording or as a second voice to compare.

**Architecture:** A second time source for the stage 1 player. `app/js/listen-device.js` speaks one clause per `SpeechSynthesisUtterance`. Clause start and end come from the utterance `start`/`end` events (exact). Inside a clause, the character time comes from `boundary` events when the engine sends them with a `charIndex`, else from an estimate. The estimate spreads the clause's characters evenly over the expected clause length. The expected length uses the measured seconds per character of the clauses already spoken. Polyphones use homophone substitution, because Web Speech engines do not take SSML.

**Tech Stack:** Web Speech API (`speechSynthesis`), plain ES modules, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-24-listen-design.md` (Approaches, option 1; Player). This plan adds the device-voice design below, because the spec chose option 3 (WaveNet B).

## Global Constraints

- Same player look, copy, and controls as stage 1 (`app/js/listen.js`). The device voice is a time source, not a second player.
- Voice: prefer a voice with `localService === true`; among those, the first whose `lang` matches `/^zh[-_](CN|Hans)/i`, else `/^zh/i`. A remote-only Chinese voice is used only when the probe (Task 1) shows it works offline or Billy accepts the network use. No Chinese voice → no button. Share the rule with `app/js/audio.js:33`.
- Utterance `lang = 'zh-CN'`, `rate = 0.8`.
- No network, no CSP change.
- Run `npm test`, `npm run check`, `npm run precache` as in stage 1. Commit only when Billy has asked.

## Review Focus

1. Brave with fingerprinting protection set to strict can return an empty or short voice list. Expected: no button, no error (Task 1 probe finds out; Task 3 test).
2. `getVoices()` is empty until `voiceschanged` on Chrome for Android. Expected: the button appears when the voices arrive (Task 3 test).
3. Android drops `end` events when the page goes to the background. Expected: on `visibilitychange` to hidden, cancel and reset; no stuck "Pause" label (Task 3 test).
4. `speechSynthesis.cancel()` during an utterance fires `error` with `interrupted` on some engines. Expected: treated as a stop, not as an error line (Task 3 test).
5. A homophone with a different tone sandhi context reads wrong (for example before 一 or 不). Expected: substitution only for characters in `audio-readings.json` decisions, never for `engine` characters (Task 2 test).

---

### Task 1: Probe page on Billy's phone

**Files:**
- Create: a private test page (scratchpad, published as a private artifact). Not in the repo.

- [ ] **Step 1: Build the page.** It lists every voice (`name`, `lang`, `localService`), and plays passage 1, clause by clause, in the selected Chinese voice. It logs each `start`, `boundary` (`charIndex`, `charLength`, `elapsedTime`, `name`), `end`, and `error` with time stamps. It shows the estimated highlight next to the boundary highlight.
- [ ] **Step 2: Billy opens it in Brave on Android,** once with Shields at the default and once with fingerprinting protection set to strict. He sends the log (a "Copy log" area of selectable text).
- [ ] **Step 3: Decide from the log.** If no Chinese voice exists in default Brave, stop the plan and tell Billy. If `boundary` events come with usable `charIndex` values, Task 2 uses them first. Write the result into this plan.

### Task 2: Device time source

**Files:**
- Create: `app/js/listen-device.js`
- Test: `tests/listen-device.test.js`

**Interfaces:**
- Consumes: `passageChars`, `segmentsFor` (stage 1, `app/js/markup.js`); `resolveReading` (stage 1, `scripts/lib/listen-ssml.mjs`, moved to `app/js/readings.js` so the browser can import it; the build keeps importing it from there); `app/data/readings.json`, a copy of `scripts/audio-readings.json` written by a new step in `scripts/build-text.mjs` (skip with a warning when the source file is missing). `check-content.mjs` does not read the copy.
- Produces:
  - `clauses(n: number, segments: string[], readings, lex) -> Array<{ text: string, first: number, count: number, offsets: number[] }>` — split at `，；。：！？`; `text` is the spoken string with substitutions applied (`resolveReading(n, c, readings)` → `homophone`); `offsets[j]` is the UTF-16 offset in `text` of the clause's j-th Han character, so a `boundary` `charIndex` maps to `first + j` (the largest `j` with `offsets[j] <= charIndex`). Small punctuation (`﹑`, `﹗`) stays in `text` and is skipped by `offsets`.
  - `homophone(py: string, lex, counts) -> string | null` — the lexicon character with exactly one reading equal to `py`, most frequent in the 81 passages (`counts`). No candidate → `null`: the character is spoken as written, and `clauses` reports it once in the console.
  - `estimateIndex(clause, elapsed: number, secPerChar: number) -> number` — `clause.first + min(count-1, floor(elapsed / secPerChar))`.
  - `deviceMedia({ n, segments, readings, lex, counts, synth, voice }) -> { media, indexNow }` — `media` implements the stage 1 `createPlayer` media contract (`play(): Promise`, `pause()`, `playbackRate`, `addEventListener` for `play|pause|waiting|playing|ended|error`, `removeAttribute`, `load()`); `indexNow()` returns the current index. `pause()` is `synth.cancel()` plus remembering the clause; `play()` after a pause speaks that clause again. An `error` whose `error` is `interrupted` or `canceled` after our own `cancel()` is not passed on.
- Rules: `secPerChar` starts at 0.32 (from passage 1 at rate 0.8: 23.8 s / 59 characters, minus pauses) and becomes the running mean of finished clauses. A `boundary` event maps through `offsets` and wins over the estimate. Substitution applies to every character that `resolveReading` forces (`at`, `chars`, `extra`); `engine` characters stay.

- [ ] **Step 1: Failing tests:** `clauses` on passage 1 (expected clause counts and `first` values); `offsets` on passage 42's `唯孤﹑寡﹑不穀` map each `charIndex` to the right index; `homophone('e4')` returns a character whose lexicon `py` is only `è`; `homophone` with no candidate → `null`; `estimateIndex` at 0, mid, past end; `一` is never substituted; 沒 (an `extra` decision) is substituted.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Stage.**

### Task 3: Player takes a source; device voice in the page

**Files:**
- Modify: `app/js/listen.js` (`listenRow` takes `{ media, indexNow }` from `deviceMedia` as an alternative to `file` + `times`; the length guard compares `cells.length` with the passage character count)
- Modify: `app/js/views/passage.js` (button for passages with no recording; a small "Voice: recorded / phone" chip where both exist)
- Test: `tests/listen-player.test.js`, `tests/listen-device.test.js`

- [ ] **Step 1: Failing tests** with a stub `speechSynthesis` (`speak`, `cancel`, `getVoices`, `voiceschanged`): no Chinese voice → no row; voices arrive late → row appears; `visibilitychange` hidden → stop and label reset; `error` with `interrupted` after `cancel()` → no error line; `tao:sound` pauses (cancel) as in stage 1.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** No change to `createPlayer`: it already takes any media object. Only `listenRow` and the page choose the source.
- [ ] **Step 4: Run `npm test && npm run check && npm run precache`.** Expected: PASS.
- [ ] **Step 5: Billy compares** recorded and phone voice on passages 1, 2, 23 on his phone. Record which he prefers and whether to keep the phone voice for passages without a recording.
- [ ] **Step 6: Stage.**
