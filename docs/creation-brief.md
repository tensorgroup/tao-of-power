# Creation Brief — writing a passage file

You write `app/data/passages/NN.json` for the passages you are given, plus
`lexicon-add/NN.json` with character entries. Read `docs/content-style.md`
first and follow it exactly. Spec: `docs/superpowers/specs/2026-11-23-tao-of-power-app-design.md` §5.

## Inputs you may read
- `sources/zh-wangbi.json` — the pinned Chinese text, split into segments, with
  Wang Bi's 3rd-century commentary (`wangbi`) on some segments. Chapter n is
  at index n-1.
- `sources/legge.json` — Legge 1891, public domain (for discussion in `legge`
  notes; the app shows it separately — do not copy it into your file).
- `sources/unihan.json` — pinyin readings and short definitions.
- `app/data/lexicon.json` — the current lexicon.
- `docs/study/wing/NN.md` and `docs/study/wing/overview.md` — notes in our
  own words on how a 1986 modern translation framed each passage: what it
  stressed, what it missed. Use them to know what to go past. Do not try to
  reconstruct that translation's wording.
- Your own knowledge of classical Chinese, the Warring States, the
  commentarial tradition (Heshang Gong, Wang Bi), the excavated texts
  (Mawangdui silk A/B, Guodian bamboo, Beida), the Shuowen Jiezi.

## Inputs you must NOT open
`taoofpower/`, `Tao of Power/`, `google-books-images/`, any `denylist*.txt`.

## Output: `app/data/passages/NN.json`
```json
{
  "n": 11,
  "title": "Our own title, 2–5 words",
  "theme": "way|seeing|self|leading|yielding|conflict|simplicity",
  "zh": [ { "text": "<segment exactly as in zh-wangbi.json>", "gloss": { "<code point offset>": "<sense in THIS line>" } } ],
  "rendering": [ "line with [[marked phrase|noteId]]", "", "blank string = stanza break" ],
  "notes": { "noteId": { "kind": "etymology|gap|history|geopolitics|wordplay|variant|wangbi|legge|practice", "title": "…", "body": "…", "src": ["…"] } },
  "lenses": { "ground": "…", "inner": "…", "leading": "…", "body": "…", "nature": "…", "practice": "…" },
  "glyph": "<one featured character from this passage>"
}
```
- `zh`: one object per source segment, same order, `text` copied exactly
  (punctuation included). Gloss offsets index `[...text]` (code points,
  punctuation counts) and must point at a Han character. Gloss 4–12 key
  occurrences per passage, especially where a character's sense here differs
  from its usual sense, or the same character appears twice with two senses.
- `rendering`: 8–20 marked phrases. Note ids: lowercase ascii, `-` allowed.
- `notes`: every note must be referenced from the rendering, a lens, or another
  note body (`[[text|id]]`). 8–20 notes. Mix the kinds; every passage should
  have at least one `etymology`, one `gap`, and — where Wang Bi comments — one
  `wangbi` note with his Chinese quoted and freshly translated. Use `variant`
  notes where Mawangdui/Guodian differ in a way that changes meaning (say
  "the Mawangdui silk texts read …"); if unsure of an excavated reading, do
  not state it.
- Any Chinese characters in note bodies and lenses become tappable — use them.
- Body length 40–180 words each. Many end with an open question or an
  invitation to notice — not all.

## Output: `lexicon-add/NN.json`
Entries for the featured glyph and 3–8 other key characters of the passage
that are not yet enriched in `app/data/lexicon.json`:
`{ "沖": { "senses": ["…"], "shuowen": "…", "shuowenEn": "…", "parts": [ {"c":"氵","m":"water"} ], "story": "…", "gap": "…" } }`
- `shuowen`: the actual Shuowen Jiezi entry text in Chinese. Only if you are
  confident of it; otherwise omit the field. Never invent.
- `py` only if you must add a classical reading; it must be in Unihan readings
  for that char (set `"pyNote": "…"` to explain).

## Self-check before you finish
Run `node scripts/check-content.mjs` and `node scripts/copyright-guard.mjs`
from the repo root and fix every problem they report for your passages.
(copyright-guard checks against a local file you must not open; just fix
any flagged phrase by rewriting it in your own words.)
