#!/usr/bin/env python3
"""Vendor a small static embedding model for the in-browser search.

One-time step. Reads Model2Vec potion-retrieval-32M (MIT, MinishLab) from a
local download and writes a phone-sized copy to app/model/:

  - keeps the BERT word pieces for Latin text and CJK (about 29k tokens),
  - projects the 512-d vectors to 256-d with PCA (centered),
  - stores each row as 4-bit integers with a float32 scale.

Usage: python3 scripts/vendor-search-model.py <dir with model.safetensors and tokenizer.json>
Needs numpy. Download from https://huggingface.co/minishlab/potion-retrieval-32M
"""
import json, re, struct, sys, unicodedata
from pathlib import Path
import numpy as np

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / 'app' / 'model'
NAME = 'potion-r29k-256-q4'
DIM = 256
BASE_VOCAB = 30522  # the original BERT vocabulary; ids above are added whole words


def allowed(tok: str) -> bool:
    if tok.startswith('[unused'):
        return False
    t = tok[2:] if tok.startswith('##') else tok
    for ch in t:
        o = ord(ch)
        if o < 0x250:  # ASCII, Latin-1, Latin Extended
            continue
        if 0x2000 <= o <= 0x206F or 0x3000 <= o <= 0x303F or 0xFF00 <= o <= 0xFFEF:  # punctuation, CJK punctuation, full-width
            continue
        if 0x4E00 <= o <= 0x9FFF or 0x3400 <= o <= 0x4DBF or 0xF900 <= o <= 0xFAFF:  # CJK ideographs
            continue
        return False
    return True


def main():
    f = open(SRC / 'model.safetensors', 'rb')
    n = struct.unpack('<Q', f.read(8))[0]
    head = json.loads(f.read(n))
    a, b = head['embeddings']['data_offsets']
    f.seek(8 + n + a)
    E = np.frombuffer(f.read(b - a), dtype=np.float32).reshape(head['embeddings']['shape'])

    tok = json.loads((SRC / 'tokenizer.json').read_text())
    vocab = tok['model']['vocab']
    inv = sorted(vocab, key=vocab.get)
    keep = [i for i, t in enumerate(inv) if i < BASE_VOCAB and (t == '[UNK]' or allowed(t))]
    tokens = [inv[i] for i in keep]
    X = E[keep]
    mu = X.mean(0)
    _, _, vt = np.linalg.svd(X - mu, full_matrices=False)
    P = (X - mu) @ vt[:DIM].T
    assert np.isfinite(P).all(), "PCA produced non-finite values"

    scale = (np.abs(P).max(1) / 7).astype(np.float32)
    scale[scale == 0] = 1
    q = np.clip(np.round(P / scale[:, None]), -8, 7).astype(np.int8)
    nib = (q & 0x0F).astype(np.uint8)
    packed = (nib[:, 0::2] | (nib[:, 1::2] << 4)).astype(np.uint8)

    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / f'{NAME}.bin', 'wb') as w:
        w.write(scale.tobytes())
        w.write(packed.tobytes())
    meta = {
        'name': NAME, 'dim': DIM, 'rows': len(tokens), 'unk': tokens.index('[UNK]'),
        'source': 'minishlab/potion-retrieval-32M (MIT), via scripts/vendor-search-model.py',
        'layout': 'float32 scale[rows], then uint8 nibbles[rows*dim/2] (low nibble = even column), signed 4-bit',
        'tokens': tokens,
    }
    (OUT / f'{NAME}.json').write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':')))
    print(f'{len(tokens)} tokens x {DIM} -> {(OUT / (NAME + ".bin")).stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
