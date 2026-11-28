// Request bodies with a size cap, for every route that reads one (analytics, sync).

/**
 * The body of request as text, or null when it is over max bytes. A content-length over max is refused
 * before any read. A chunked upload (no content-length) is read chunk by chunk, and the read stops at the
 * first chunk past max, so a large upload is never read to its end.
 * @param {Request} request
 * @param {number} max  bytes
 * @returns {Promise<string | null>}
 */
export async function readCapped(request, max) {
  if (Number(request.headers.get('content-length')) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(bytes);
}
