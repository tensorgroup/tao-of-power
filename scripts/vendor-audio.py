#!/usr/bin/env python3
"""Vendor Mandarin syllable recordings for the readings in app/data/lexicon.json.

Recordings: hugolpz/audio-cmn, 24k-abr/syllabs (Chen Wang, CC BY-SA). One file
per syllable and tone (cmn-dao4.mp3). This copies only the syllables our
dictionary uses into app/audio/<syllable>.mp3 and writes app/audio/index.json,
the list the app uses to map a pinyin reading to a file. Re-run after adding
lexicon entries; existing files are kept.
"""
import json, re, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'app' / 'audio'
BASE = 'https://raw.githubusercontent.com/hugolpz/audio-cmn/master/24k-abr/syllabs/'
TREE = 'https://api.github.com/repos/hugolpz/audio-cmn/git/trees/master?recursive=1'
H = {'User-Agent': 'TaoAudioVendor/1.0'}
MARKS = {'ā': 'a1', 'á': 'a2', 'ǎ': 'a3', 'à': 'a4', 'ē': 'e1', 'é': 'e2', 'ě': 'e3', 'è': 'e4', 'ī': 'i1', 'í': 'i2', 'ǐ': 'i3', 'ì': 'i4',
         'ō': 'o1', 'ó': 'o2', 'ǒ': 'o3', 'ò': 'o4', 'ū': 'u1', 'ú': 'u2', 'ǔ': 'u3', 'ù': 'u4', 'ǖ': 'ü1', 'ǘ': 'ü2', 'ǚ': 'ü3', 'ǜ': 'ü4'}


def candidates(py):
    """'dào' -> ['dao4', '_dao4'], 'lǜ' -> ['lv4', ...]; same rule as app/js/audio.js."""
    tone, base = '5', ''
    for ch in py.lower().strip():
        if ch in MARKS:
            base += MARKS[ch][0]; tone = MARKS[ch][1]
        else:
            base += ch
    out = []
    for b in (base.replace('ü', 'v'), base.replace('ü', 'u'), base.replace('u', 'v')):
        for c in (f'{b}{tone}', f'_{b}{tone}'):
            if c not in out:
                out.append(c)
    return out


def main():
    lex = json.loads((ROOT / 'app' / 'data' / 'lexicon.json').read_text())
    tree = json.load(urllib.request.urlopen(urllib.request.Request(TREE, headers=H), timeout=60))
    have = {p['path'].split('/')[-1][4:-4] for p in tree['tree'] if p['path'].startswith('24k-abr/syllabs/cmn-')}
    want = set()
    for e in lex.values():
        for py in e.get('py', []):
            hit = next((c for c in candidates(py) if c in have), None)
            if hit:
                want.add(hit)
    OUT.mkdir(exist_ok=True)
    got = 0
    for s in sorted(want):
        f = OUT / f'{s}.mp3'
        if f.exists():
            continue
        f.write_bytes(urllib.request.urlopen(urllib.request.Request(f'{BASE}cmn-{s}.mp3', headers=H), timeout=60).read())
        got += 1
        time.sleep(0.05)
    files = sorted(p.stem for p in OUT.glob('*.mp3'))
    (OUT / 'index.json').write_text(json.dumps(files, separators=(',', ':')))
    (OUT / 'LICENSE.txt').write_text('Mandarin syllable recordings by Chen Wang, from https://github.com/hugolpz/audio-cmn (24k-abr/syllabs).\nLicense: Creative Commons Attribution-ShareAlike (CC BY-SA). Copied unchanged.\n')
    print(f'audio: {got} downloaded, {len(files)} files')


if __name__ == '__main__':
    main()
