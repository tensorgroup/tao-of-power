# Content Style Guide

This guide governs every file in `app/data/`. Read it fully before you write.

## 1. Purpose

Billy does not read Chinese. The app must let him feel the text as a reader of
classical Chinese feels it: the images in the characters, the wordplay, the
open grammar, the history behind the words, and the places where English must
choose and so loses something. The footnotes carry this. The rendering stays
clean and quiet; the depth sits one tap away.

## 2. Hard rules

1. Work from the Chinese first (`sources/zh-wangbi.json`), character by
   character. Use Legge (`sources/legge.json`) and Wang Bi's commentary as
   checks and as objects of discussion, not as the base.
2. Never use R.L. Wing's English. You do not receive it. Do not write from
   memory of any modern copyrighted translation (Wing, Mitchell, Le Guin,
   Feng & English, Lau, Henricks, Ames & Hall, Red Pine, Waley, Blakney …).
   Write each line new from the characters.
3. No invented scholarship. Etymology claims need a source you can name:
   Shuowen Jiezi (quote the line in Chinese and translate it), the shape of
   the modern components, or a widely documented reading (say "commonly
   explained as" when scholars disagree). If the early form is disputed, say
   so. Never describe an oracle-bone or bronze form you have not verified;
   link out instead (`links`).
4. Pinyin from Unihan (`sources/unihan.json`). Mark a classical reading that
   differs (e.g., 惡 è / wù) in the occurrence gloss.
5. The Chinese segments in a passage file must join, after normalization, to
   the pinned source text with punctuation removed. Do not "fix" the text; put
   other editions (Mawangdui silk, Guodian bamboo, Heshang Gong, Fu Yi) in
   `variant` notes.

## 2b. Lessons from the pilot review (binding)

1. Copy every Shuowen quote from `sources/shuowen.txt` with its radical
   section. Never quote from memory. A rare variant graph is a different
   entry until the text shows otherwise. `check-content` verifies quotes.
2. Variant readings: no reliable silk A/B transcription is in the repo yet.
   Mark every Mawangdui reading "reported" (e.g. "the silk texts are
   reported to read …") unless the reviewer confirms it. `sources/mawangdui-collated.json` is a
   modern merged reconstruction that mixes in Guodian wording (e.g. its
   ch.19 has 絕知棄辯, which is Guodian, not silk) — never cite it as "the
   Mawangdui text". For Guodian or Beida, say "reported" unless certain,
   and never invent wording.
3. Stroke order: read `app/data/strokes/<hex>.json` (hex = code point).
   State the stroke count and name the strokes in order; do not group them.
4. Before reading a line with new punctuation, test each unit as a known
   compound (無有, 有無, 自然 …) — search the other chapters.
5. Give every character cousin its basis: "the Shuowen says", "commonly
   explained as", or "modern homophone only". Mandarin sound is not Old
   Chinese sound; give rhyme groups, not reconstructions.
6. The rendering adds no subject ("you", "we", "a man") and no intensifier
   ("never", "hidden") that the characters lack. If English forces one,
   name it in a note.
7. If a note holds two facts that seem to conflict, resolve them there.
8. Note ids are free-form; note `kind` must be one of the listed kinds.

## 3. The rendering

- Short lines. Plain, living English. No archaism ("thee", "doth"), no
  New-Age gloss, no business jargon.
- Keep the Chinese images: valley, water, uncarved wood, infant, bellows,
  mother, gate. Do not turn an image into an abstraction when the image works.
- Keep the openness of the grammar where English allows. When a line has two
  real readings, render one and put the other in a `gap` note.
- Untranslated terms, always with a note on first use in a passage:
  **Dao** (道), **de** (德) may be rendered "inner power" / "virtue-power"
  with a note, **wu wei** (無為) may be rendered "not-forcing" / "doing
  without doing" with a note. **聖人**: "the sage" is allowed but the note
  must say what it is not (not a saint, not merely a wise man; a person whose
  ear 耳 and mouth 口 are attuned, who rules by attunement).
- Gender: Chinese is not gendered here. Do not add "he". Prefer "the sage",
  "they", or restructure.
- Mark tappable phrases: `[[visible text|noteId]]`. Every passage marks
  8–20 phrases. Mark the phrase where the English carries a hidden choice.

## 4. Note kinds

Each note: `{ "kind", "title", "body", "src"? , "see"? }`.
`body` may contain `[[text|otherNoteId]]` to chain, and Chinese characters
(each becomes tappable). 40–180 words. One idea per note. End many notes
with a quiet question or an invitation to notice something, but not all.

- `etymology` — the parts of a character and what they picture; Shuowen line.
- `gap` — where the Chinese concept maps badly to English; what the English
  word drags in (Greek, Christian, Enlightenment frames) and what it drops.
- `history` — Warring States context, the Zhou collapse, who Laozi may have
  been, how the text was compiled, how it was used by rulers and religions.
- `geopolitics` — states at war, the shi class, legalism vs. Confucian
  ritual, how later empires, Buddhism, the Jesuits, and 19th-c. British
  scholarship (Legge was a missionary) shaped what the West received.
- `wordplay` — repetition, pun, rhyme, paradox, the same graph in two senses.
- `variant` — what other editions read, and why it matters.
- `wangbi` — Wang Bi's comment: quote the Chinese (public domain), translate
  it freshly, say what it opens.
- `legge` — where Legge's Victorian or Christian frame bends a line.
- `practice` — something to try in the body or the day.

## 5. Lenses (the commentary)

Each 60–160 words, our own voice. Not every passage needs every lens; use
at least four.
- `ground` — what the characters literally say; the picture.
- `inner` — the contemplative reading; nondual, without "mystic" fog.
- `leading` — influence, organizations, family, teams.
- `body` — movement, timing, yielding, martial sense, breath.
- `nature` — cycles, water, growth, ecology.
- `practice` — one small, concrete thing to try today.

Strategy is welcome (Sunzi and the Laozi share a world), but do not let it
swallow the text: the Laozi is not a manual for winning.

## 6. Titles and themes

Title: 2–5 words, our own, from an image in the passage when possible
(e.g., "The Hub's Empty Center"). Never a book's chapter title.
Themes (our own grouping): `way` (the nature of Dao), `seeing` (perception
and knowing), `self` (inner cultivation), `leading` (rule and influence),
`yielding` (softness, water, not-contending), `conflict` (war, force,
weapons), `simplicity` (the uncarved, enough).

## 7. Lexicon entries (`app/data/lexicon.json`)

Base fields from scripts: `py` (array), `def` (Unihan). Enriched fields for
key characters: `senses` (array of short senses, classical first),
`shuowen` (Chinese line), `shuowenEn` (our translation), `parts` (array of
`{ "c": "辶", "m": "walk, movement" }`), `story` (60–150 words), `gap`
(where English fails), `links` (generated by the app; do not write).

## 8. Plates and calligraphy

Every passage has 1–3 plates: a character taught in depth (`lesson`) and seen
as brushwork (`brush`). Teach like a patient teacher at a table: parts,
pictures, combinations, old forms, growth of meaning, cousins. Then look at
it as calligraphy: order, pressure, balance, script history, famous copies.
The book that inspired this app had full-page character plates; ours are
new writing and the brushwork is generated from open stroke data.

## 9. Passage JSON

See spec §5.4. `zh` is an array of segments as in the source; `gloss` maps a
character offset (string) to an occurrence-specific sense. `legge` is copied
by script, not by hand.

## 10. Paired opposites (binding, 2026-11-23)

The Laozi thinks in pairs: 有/無, 難/易, 長/短, 高/下, 剛/柔, 強/弱, 雌/雄,
白/黑, 榮/辱, 動/靜, 先/後, 實/虛, 曲/全, 損/益, 生/死. Its claim is that each
side of a pair arises with the other (有無相生, ch. 2), that each turns into the
other (反者道之動, ch. 40), and that the sage holds both. Translations often
lose this. They make one side "good" and the other "bad", or they freeze a
cycle into a fixed rule ("weak always wins").

For every passage:
1. Find each pair, named or implied. Check that the rendering does not
   moralize one side, rank the pair where the Chinese only relates it, or
   add "always", "never", "better", "only" that the characters lack.
2. Where the text does favor one side (soft over hard in ch. 76), say in a
   note what that preference is for. It is usually a correction against a
   world that over-values the other side. It is not a rule for all time.
   Say that the favored side also turns.
3. Add at least one note of kind `pair` ("Paired opposites") per passage
   that has a pair. It names the pair, shows how the two sides depend on
   and become each other, and says what a one-sided reading would miss.
   Mark it in the rendering on the phrase where the pair sits.
4. Do not force a pair into a passage that has none. Say so in your report.

## 11. Questions to sit with (`questions`, binding, 2026-11-23)

Each passage has 2–3 questions in `questions`. They feed the journal.
Each one starts from a claim or an assumption that the passage makes, and
asks the reader to test it against their own life.

```json
"questions": [
  {
    "id": "finite-store",
    "claim": "The body has a finite store, and sparing it is the root of long life.",
    "prompts": [
      "Do you agree? Where in your own life did you learn this, or learn the opposite?",
      "If you believe it, what might that belief come from: a scarcity, a fear, an illness, a parent's voice?",
      "Now take the opposite: what you give out returns, and the store grows when it is spent. Stay with that for a minute. What feelings and thoughts arise?",
      "Which side feels natural to you, and which side resists? Why might that be worth knowing?"
    ]
  }
]
```

Rules:
- `claim`: one plain sentence, 8–25 words, in our own words. State the idea
  as the passage holds it, fairly, not as a straw man.
- `prompts`: 3–5 questions. Cover, in some order: agree or disagree; where
  the view comes from in the reader's past, or in their "shadow" (what they
  deny, fear, or judge in others); the opposite view, held for a while,
  and the feelings and thoughts it raises; why one side aligns or clashes
  with what they believe or have lived, and why that is worth knowing.
- Use the paired-opposites work (§10): the opposite view is often the other
  side of the passage's own pair.
- Speak to the reader as "you". No therapy jargon, no diagnosis, no
  New-Age gloss. Do not tell the reader what they should feel.
- Vary the wording between passages. Do not paste the same four prompts.
