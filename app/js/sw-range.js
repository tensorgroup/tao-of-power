/* Range answers for cached audio, and which recordings to keep. A classic script (no import/export): the
   service worker loads it with importScripts, and node tests with import().
   Both set globalThis.taoRange. Media elements ask for `Range: bytes=…`; a
   cached full 200 must be sliced into a 206, or seeking and playback fail. */
(() => {
  // null = no header; 'invalid' = cannot be satisfied; else { start, end } with end clamped.
  function parseRange(header, size) {
    if (header == null) return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
    if (!m || (m[1] === '' && m[2] === '') || size <= 0) return 'invalid';
    let start;
    let end;
    if (m[1] === '') {
      const n = Number(m[2]);
      if (n <= 0) return 'invalid';
      start = Math.max(0, size - n);
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (start >= size || start > end) return 'invalid';
    return { start, end };
  }

  async function sliceResponse(full, header) {
    if (header == null) return full;
    const buf = await full.arrayBuffer();
    const size = buf.byteLength;
    const range = parseRange(header, size);
    const type = full.headers.get('Content-Type');
    if (range === 'invalid') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const headers = {
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(range.end - range.start + 1),
    };
    if (type) headers['Content-Type'] = type;
    return new Response(buf.slice(range.start, range.end + 1), { status: 206, headers });
  }

  // Cache key has no Range header, so one full file serves every range.
  async function audioFetch(req, cache, fetchFn) {
    const key = new Request(new URL(req.url).href);
    const range = req.headers.get('Range');
    const hit = await cache.match(key);
    if (hit) return sliceResponse(hit, range);
    const res = await fetchFn(key);
    if (res.status !== 200) return res;
    // A failed store (quota, restricted storage) must not lose the good bytes.
    try { await cache.put(key, res.clone()); } catch { /* serve uncached */ }
    return sliceResponse(res, range);
  }

  // Only recordings go through audioFetch; audio/index.json takes the plain lazy path.
  const isRangedAudio = (pathname) => /\/audio\/.*\.mp3$/.test(pathname);

  // The recording paths a data/listen.json names: each entry's file, and its prev
  // (kept one release, for readers whose page still names the old file).
  function listenKeep(listen, scope) {
    const keep = new Set();
    for (const lang of ['zh', 'en']) {
      for (const entry of Object.values((listen && listen[lang]) || {})) {
        for (const f of [entry?.file, entry?.prev]) if (typeof f === 'string') keep.add(new URL(f, scope).pathname);
      }
    }
    return keep;
  }

  globalThis.taoRange = { parseRange, sliceResponse, audioFetch, isRangedAudio, listenKeep };
})();
