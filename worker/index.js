// Static site + one endpoint: POST /api/e stores an anonymous usage event in D1.
// Everything else is served from ./app by the assets binding.

const EVENTS = new Set(['view', 'draw', 'search', 'say', 'char', 'note', 'art', 'story', 'echo', 'culture', 'question', 'journal-save', 'journal-export', 'journal-import', 'install', 'listen']);
const clip = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, n) : null);

function device(ua = '') {
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'phone';
  return 'desktop';
}

async function record(request, env) {
  if (!env.tao_analytics) return new Response(null, { status: 204 });
  const body = await request.text();
  if (body.length > 4000) return new Response(null, { status: 413 });
  let list;
  try { list = JSON.parse(body); } catch { return new Response(null, { status: 400 }); }
  if (!Array.isArray(list)) list = [list];
  const ts = Date.now();
  const dev = device(request.headers.get('user-agent') || '');
  const country = clip(request.cf?.country, 2);
  const rows = list.slice(0, 20).filter((e) => e && EVENTS.has(e.ev)).map((e) => env.tao_analytics.prepare(
    'INSERT INTO events (ts, vid, sid, ev, path, prev, detail, country, device, standalone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(ts, clip(e.vid, 40), clip(e.sid, 40), e.ev, clip(e.path, 80), clip(e.prev, 80), clip(e.detail, 64), country, dev, e.standalone ? 1 : 0));
  if (rows.length) await env.tao_analytics.batch(rows);
  return new Response(null, { status: 204 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/e') {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      try { return await record(request, env); } catch { return new Response(null, { status: 204 }); }
    }
    return env.ASSETS.fetch(request);
  },
};
