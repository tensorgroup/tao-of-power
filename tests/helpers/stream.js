// A request body as a chunked upload sends it (no content-length). seen counts the chunks the server
// pulled and says whether it cancelled the stream. With highWaterMark 0 the stream pulls a chunk only when
// the server reads one, so seen.pulled is what was read.
export function chunked(chunks) {
  const seen = { pulled: 0, cancelled: false };
  const body = new ReadableStream({
    pull(c) { if (seen.pulled === chunks.length) c.close(); else c.enqueue(chunks[seen.pulled++]); },
    cancel() { seen.cancelled = true; },
  }, { highWaterMark: 0 });
  return { body, seen };
}
