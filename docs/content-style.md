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
