# Tao — Personal Draw, Study & Journal App — Design (v2)

Date: 2026-11-23 · Owner: Billy · Status: approved direction; v2 folds in the
deep design panel (Opus, Fable, Kimi, Flash; Astra pending) and Billy's
follow-up requests (footnotes, Brave on phone, GitHub + tao.tensor.group).

## 1. Intent

A light, quick, beautiful mobile web app for personal reflection. Billy opens
it, makes a draw with a virtual 64-stick method, and reads one of the 81
passages of the Tao Te Ching. He writes journal entries about what arises.

R.L. Wing's *The Tao of Power* (1986) is the model. The aim is to go further:
- closer to each Chinese character, less Western-dualistic;
- more lenses than Wing's leadership / strategy lens;
- **many tap-to-open footnotes** on characters, etymology, history,
  geopolitics, wordplay, text variants, and where a Chinese concept maps badly
  onto English. The translation gap is the heart of the app: the footnotes show
  Billy what an English reader cannot see, and invite thought and meditation.

Success: Billy reaches for it on his phone (Brave), the draw feels like a small
ritual, the passage page rewards slow reading and tapping, and his journal is
safe and portable.

## 2. Goals, non-goals, anti-goals

Goals
- Faithful virtual stick method with cryptographically secure randomness.
- All 81 passages: pinned Chinese text, positional character glosses, a new
  English rendering with inline footnote anchors, Legge (1891), Wang Bi's
  commentary (3rd c., public domain) in footnotes, commentary in lenses, a
  featured character with etymology, the tetragram.
- A study of Wing's perspective, per passage and overall, in our own words.
- Journal: textarea + Save, timestamped, linked to the passage, listed on the
  page; Export and Import (merge by default).
- Offline, installable, fast on a phone.
- Private GitHub repo; deployed to Cloudflare at `tao.tensor.group`.

Non-goals: accounts, sync, servers, analytics, dice method.

Anti-goals
- Copying or lightly re-wording Wing's English, commentary, titles, coined
  terms, or calligraphy. The creation step never sees Wing's text (§5).
- Invented scholarship: made-up etymologies, made-up ancient forms, pinyin from
  memory.
- Flattening the Chinese into Western dual terms (有/無 → "being/non-being" as
  substances, 聖人 → "saint", 德 → "virtue" only). Each choice is traceable to
  the characters and is footnoted when the English loses something.
- Slow, heavy, busy UI. No framework.

## 3. The draw — facts from the book (structure only)

- 64 sticks, split at random into 3 non-empty bundles. Count each bundle by
  threes; remainder 0 → set aside 1 stick instead (so each bundle gives 1 or 2).
  Because of that rule and 64 ≡ 1 (mod 3), the sum is always 3, 4, or 5.
  3 = solid, 4 = one break, 5 = two breaks (book p.18 diagram). Four casts,
  bottom line first.
- Passage number: with solid=0, one break=1, two breaks=2, L1 = bottom … L4 =
  top: `n = 1 + 27·L4 + 9·L3 + 3·L2 + L1` (Tai Xuan Jing order).
- Test oracle: the **Tetragram Arrangement** page (book p.17), transcribed by
  hand into a fixture independent of the formula. The **Bigram Chart (book
  p.19) has a misprint**: three cells read 10, 11, 12 where 16, 17, 18 belong.
  Do not use it as the oracle.
- Split model (our decision; the book gives no distribution): two distinct cut
  points chosen uniformly from 1..63. Exact line odds: solid 630, one break
  693, two breaks 630, out of 1,953 splits (10/31, 11/31, 10/31). The app keeps
  these odds. About 1 cast in 11 has a one-stick bundle.

## 4. Approach

Static PWA, no runtime dependencies, no framework: `app/index.html`, one CSS
file, ES modules, `app/data/`. Dev-only Node/Python scripts generate derived
files (precache manifest, font subsets, passage index); their output is
committed, so the deployed folder is plain static files.

Rejected: Vite + framework (weight, no gain); single HTML file (too large to
edit or load).

## 5. Content pipeline

### 5.1 Sources (pinned)
- Chinese: Wang Bi received text from zh.wikisource `道德經 (王弼本)`, fetched
  2026-11-23 → `sources/zh-wangbi.json` (81 chapters, text + Wang Bi notes).
  Normalize to one traditional orthography (爲→為 etc. via a table). Where
  Wing's column or other editions differ (e.g., ch.2 相形 vs 相較), record a
  `variant` footnote. Mawangdui / Guodian readings may appear in footnotes.
- Legge 1891: en.wikisource `Tâo Teh King` → `sources/legge.json`.
- Lexicon facts: Unihan (pinyin, definitions; Unicode license notice),
  Shuowen Jiezi (public domain; quote the line), Wiktionary (CC BY-SA:
  paraphrase facts, credit, no long quotes). External links per character to
  Wiktionary, ctext dictionary, and 漢語多功能字庫 for ancient forms.
- Wing: Billy's PDF, scans, OCR — read only by study agents.

### 5.2 Two separated passes
1. **Study pass** (agents that read Wing): `docs/study/wing/NN.md` — what
   Wing stresses, his lens, his coined terms, where he narrows or widens the
   Chinese, what to keep in spirit and what to go past. Own words; no line of
   his English beyond 3–4 identifying words. Plus `docs/study/wing/overview.md`.
   Not in git (§7).
2. **Creation pass** (agents that never receive the PDF, scans, OCR, or
   `tao.go`): input = pinned Chinese + Wang Bi + Legge + lexicon + the study
   notes + the style guide. Output = `app/data/passages/NN.json`.

### 5.3 Pilot, then scale
Produce passages 1, 4, and 11 first. Fable reviews translation and
interpretation (Billy's routing: Fable / highest-thinking seats for
translation; Opus for code). Lock the style guide and term list from that
review, then produce the rest in batches of 9.

### 5.4 Data model
`app/data/lexicon.json` — shared, keyed by character:
`{ "道": { "py": ["dào"], "senses": [...], "shuowen": "…", "parts": [...],
"forms": "words only", "links": {...}, "gap": "where English fails" } }`

`app/data/passages/NN.json`:
```json
{
  "n": 4,
  "title": "our own title",
  "theme": "our own grouping",
  "zh": [ { "text": "道沖而用之或不盈", "gloss": { "1": "沖-specific sense" } } ],
  "rendering": [ "The Way is a [[hollow vessel|chong]] — use it, …" ],
  "notes": {
    "chong": { "kind": "gap", "title": "沖 chōng", "body": "…", "src": ["Shuowen"] }
  },
  "lenses": { "ground": "…", "inner": "…", "leading": "…", "body": "…",
              "nature": "…", "practice": "…" },
  "glyph": "沖",
  "legge": [ "…" ]
}
```
- `zh[i].gloss` keys are character offsets within the segment and override the
  lexicon for that occurrence (so 道可道 can gloss each 道 differently).
- `[[visible text|noteId]]` marks a tappable phrase in English; any Chinese
  character is tappable and opens lexicon + occurrence gloss.
- Note kinds: `etymology`, `gap` (concept mapping), `history`, `geopolitics`,
  `wordplay`, `variant`, `wangbi`, `legge` (where Legge's Victorian frame
  bends the text), `practice`. Many per passage is the goal (≈8–20).
- `lines` is derived from `n`; not stored.

### 5.5 Checks (scripts, run before commit)
- Schema validation of all 81 files; every `[[…|id]]` resolves; every Chinese
  character has a lexicon entry; joined `zh` text equals the pinned source
  after normalization.
- Pinyin of every lexicon entry is in Unihan's readings.
- Copyright guard (local only, needs Billy's OCR): no 6-word sequence shared
  between shipped English and Wing's OCR; deny-list of Wing's 81 titles and
  coined terms (e.g., "Evolved Individuals"). Short common phrases allowed
  via an allow-list.
- Font coverage: every character in data exists in the subset fonts.

## 6. The app

Routes (hash): `#/` draw · `#/p/NN` passage · `#/journal` · `#/browse` ·
`#/about` (sources, licenses, how the draw works).

**Draw** — 64 sticks drawn in SVG. Per cast: the sticks part into 3 bundles,
count off by threes, the remainder glows, the line inks in from the bottom.
Tap to advance or let it play (~1.5 s per cast); reduced motion → instant.
Then the passage opens. Each draw is recorded (passage, lines, bundles, time).

**Passage** — tetragram badge + number, title, rendering with dotted-underline
tappable phrases; vertical Chinese column (tap any character); lenses as quiet
sections; featured glyph plate (large character, parts diagram, story, links);
Legge folded; journal box for this passage; past entries for it.
**Notes open in a bottom sheet** (thumb-reachable on a phone; swipe or tap
outside to close; can chain: a note can link to another note or character).

**Journal** — all entries newest first, date/time + passage link; edit and
delete; Export / Import; "last backup N days ago" with a reminder after new
entries.

**Browse** — 81 tetragrams in the book's 9×9 order (top bigram = column),
plus the theme groups.

Randomness: `crypto.getRandomValues` on `Uint32Array`, rejection sampling for
unbiased integers; random source injected for tests.

Journal storage (localStorage key `tao.journal.v1`):
```json
{ "version": 1, "lastExportAt": null,
  "entries": [ { "id", "createdAt", "updatedAt", "passage", "drawId?", "text" } ],
  "draws":   [ { "id", "at", "passage", "lines", "bundles" } ],
  "tombstones": [ { "id", "deletedAt" } ] }
```
- IDs: `crypto.randomUUID()` with a `getRandomValues` fallback.
- Merge: union by id; same id → newer `updatedAt` wins; a tombstone wins when
  `deletedAt ≥ updatedAt`. Draws union by id.
- Import: validate fully before any write; unknown/old version → refuse with a
  message; "Replace" takes a snapshot (`tao.journal.snapshot`) first.
- Draft autosave per passage (`tao.draft.NN`), restored on reload.
- `navigator.storage.persist()` on first save. A failed `setItem` keeps the
  text on screen and shows the error.
- Export: Blob download `tao-journal-YYYY-MM-DD.json`; if the platform can
  share files, offer `navigator.share({files})` (iOS home-screen apps).
- All user text rendered with `textContent`. Strict CSP (`default-src 'self'`).
- Storage warning on the About page: data lives in this browser on this
  device; Brave Shields "forget me" or Safari's 7-day rule can delete it;
  export often.

Offline: service worker precaches the shell, fonts, lexicon, and all 81
passages from a generated `app/precache.json` (list + content hash). Cache name
includes the hash. A new version shows "Update ready — tap to refresh".
Install failures surface as "Offline copy incomplete".

Look: paper and ink. Light: warm paper `#f4efe4`, ink `#1d1b18`, cinnabar seal
red accent `#a63a2a`. Dark (system): ink-black paper, bone text. Thin
double-rule frames echo a book page. Fonts (all OFL, self-hosted, subset):
EB Garamond (English), Noto Serif TC (Chinese column and glosses), LXGW WenKai
TC (large glyph plates, brush-like kai). `lang="zh-Hant"` on Chinese. Large
touch targets, safe-area insets, no layout shift.

## 7. Repo and deploy

- New git repo at the project root, private GitHub repo `billzajac/tao`.
- `.gitignore` before the first commit: `Tao of Power/`,
  `google-books-images/`, `taoofpower/`, `sources/raw/`, `docs/study/`.
- Deploy only `app/` to Cloudflare Workers static assets (`wrangler.jsonc`,
  `assets.directory: ./app`), custom domain `tao.tensor.group` on the Tensor
  Group account. HTTPS gives the secure context for crypto and the service
  worker; local phone testing uses the deployed preview.
- The old public repo `billzajac/taoofpower` holds Wing's text — Billy's call
  to make it private (pre-existing, not changed by this project).

## 8. Testing

- node:test: formula vs hand-made fixture (all 81); stick counts by full
  enumeration of the 1,953 splits (630/693/630); sampler with a stub byte
  source (rejection bound); journal merge (update wins, tombstone wins, old
  import cannot resurrect); import validation; render escaping.
- Content checks of §5.5.
- Manual on phone (Brave): draw, notes sheet, journal save/reload, export,
  import merge, offline after install, update flow.

## 9. Left to the builder

Animation timing details, exact layout spacing, theme groupings and titles
(our own), font subset tooling.
