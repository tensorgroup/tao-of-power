#!/usr/bin/env python3
"""Fetch outlines for rare Han characters (outside the Basic Multilingual Plane).

Phones often have no font for CJK Extension B+ characters, so they show as
blanks. This finds every such character in app/data and lexicon-add, fetches
its outline from GlyphWiki (https://glyphwiki.org, glyphs free to use), and
writes app/data/rare-glyphs.json: {char: path data in a 0 0 200 200 box}.
The app draws them inline in the text colour. Re-run after adding content.
"""
import json, re, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
H = {'User-Agent': 'TaoGlyphVendor/1.0'}


def rare_chars():
    text = ''
    for p in list((ROOT / 'app' / 'data').rglob('*.json')) + list((ROOT / 'lexicon-add').rglob('*.json')):
        if p.name in ('rare-glyphs.json',) or 'search' in p.parts:
            continue
        text += p.read_text(encoding='utf-8')
    return sorted({c for c in text if ord(c) > 0xFFFF and re.match(r'\w', c)})


def main():
    out_path = ROOT / 'app' / 'data' / 'rare-glyphs.json'
    have = json.loads(out_path.read_text()) if out_path.exists() else {}
    for c in rare_chars():
        if c in have:
            continue
        url = f'https://glyphwiki.org/glyph/u{ord(c):x}.svg'
        try:
            svg = urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=30).read().decode()
        except Exception as e:
            print(f'skip {c} U+{ord(c):X}: {e}')
            continue
        paths = re.findall(r'<path d="([^"]+)"', svg)
        if not paths:
            print(f'skip {c}: no outline'); continue
        # Round coordinates to one decimal to keep the file small.
        d = re.sub(r'(\d+\.\d)\d+', r'\1', ' '.join(paths))
        have[c] = d
        time.sleep(0.2)
    out_path.write_text(json.dumps(have, ensure_ascii=False, separators=(',', ':')))
    print(f'rare glyphs: {len(have)} ({out_path.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
