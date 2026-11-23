"""Render the seal icon (道 in LXGW WenKai TC on seal red). Dev only: needs Pillow."""
from PIL import Image, ImageDraw, ImageFont
import sys
font_path = 'sources/raw/fonts/wenkaitc.ttf'
RED, CREAM = (166, 58, 42), (255, 248, 239)

def icon(size, pad_ratio, radius_ratio, out):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=RED)
    inner = int(size * (1 - 2 * pad_ratio))
    f = ImageFont.truetype(font_path, inner)
    box = d.textbbox((0, 0), '道', font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), '道', font=f, fill=CREAM)
    img.save(out)

icon(192, 0.16, 0.12, 'app/icons/icon-192.png')
icon(512, 0.16, 0.12, 'app/icons/icon-512.png')
icon(512, 0.26, 0.0, 'app/icons/icon-maskable.png')   # full-bleed, safe zone
icon(180, 0.16, 0.0, 'app/icons/apple-touch-icon.png')  # iOS rounds corners itself
icon(64, 0.14, 0.14, 'app/icons/favicon.png')
print('icons ok')
