#!/usr/bin/env python3
"""Make gallery thumbnails: app/art/thumbs/<name>.jpg, 360 px on the long side.
Run after adding art (needs Pillow). Existing thumbnails newer than their image are kept."""
from pathlib import Path
from PIL import Image

ART = Path(__file__).resolve().parent.parent / 'app' / 'art'
OUT = ART / 'thumbs'
OUT.mkdir(exist_ok=True)
made = 0
for src in sorted(ART.glob('*.jpg')):
    dst = OUT / src.name
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        continue
    im = Image.open(src).convert('RGB')
    im.thumbnail((360, 360), Image.LANCZOS)
    im.save(dst, 'JPEG', quality=72, optimize=True, progressive=True)
    made += 1
for old in OUT.glob('*.jpg'):
    if not (ART / old.name).exists():
        old.unlink()
print(f'thumbs: {made} made, {len(list(OUT.glob("*.jpg")))} total')
