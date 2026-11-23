#!/usr/bin/env bash
# Subset the OFL fonts to the characters the app uses. Dev only.
# Needs: pip install fonttools brotli   (set PYFTSUBSET if not on PATH)
# Sources: sources/raw/fonts/{ebgaramond,ebgaramond-italic,notoseriftc,wenkaitc}.ttf from github.com/google/fonts (ofl/).
set -euo pipefail
cd "$(dirname "$0")/.."
PYFTSUBSET="${PYFTSUBSET:-pyftsubset}"
SRC=sources/raw/fonts
OUT=app/fonts
mkdir -p "$OUT"

# Every Han character in the lexicon and passage files, plus CJK punctuation.
node -e '
const fs=require("fs");
const set=new Set(Object.keys(JSON.parse(fs.readFileSync("app/data/lexicon.json"))));
const dir="app/data/passages/";
for (const f of fs.existsSync(dir)?fs.readdirSync(dir):[]) for (const c of fs.readFileSync(dir+f,"utf8")) if (/\p{Script=Han}/u.test(c)) set.add(c);
for (const c of "道德經") set.add(c);
for (const c of "，。、；：？！「」『』（）《》〈〉…—·﹕﹑") set.add(c);
fs.writeFileSync("sources/raw/fonts/han-chars.txt",[...set].join(""));
console.log("han chars:",set.size);
'

LATIN="U+0000-024F,U+0250-02AF,U+02B0-02FF,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+00D7"
FLAGS=(--flavor=woff2 --layout-features='*' --no-hinting --desubroutinize)

"$PYFTSUBSET" "$SRC/ebgaramond.ttf" --unicodes="$LATIN" "${FLAGS[@]}" --output-file="$OUT/ebgaramond.woff2"
"$PYFTSUBSET" "$SRC/ebgaramond-italic.ttf" --unicodes="$LATIN" "${FLAGS[@]}" --output-file="$OUT/ebgaramond-italic.woff2"
"$PYFTSUBSET" "$SRC/notoseriftc.ttf" --text-file="$SRC/han-chars.txt" --unicodes="U+0020-007E,U+3000-303F,U+FF00-FFEF,U+FE10-FE6F" "${FLAGS[@]}" --output-file="$OUT/notoseriftc.woff2"
"$PYFTSUBSET" "$SRC/wenkaitc.ttf" --text-file="$SRC/han-chars.txt" --unicodes="U+3000-303F,U+FF00-FFEF" "${FLAGS[@]}" --output-file="$OUT/wenkaitc.woff2"
ls -l "$OUT"
