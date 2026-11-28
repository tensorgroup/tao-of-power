// Static site + POST /api/e (anonymous usage events in D1) + optional journal sync (worker/sync.js).
// Everything else is served from ./app by the assets binding.
// Analytics stores only known event names, with every field clipped; no IP and no user-agent string.
// Nothing is stored for a request that says Do Not Track or Global Privacy Control, that comes from
// another site, or that is over the per-IP limit (binding EVENTS_LIMIT).
import { handleApi } from './sync.js';
import { readCapped } from './body.js';

const MAX_BODY = 4000; // bytes

const EVENTS = new Set(['view', 'draw', 'search', 'say', 'char', 'note', 'art', 'story', 'echo', 'culture', 'question', 'journal-save', 'journal-export', 'journal-import', 'install', 'listen', 'margin', 'share', 'sync-on', 'sync-signin', 'sync-off', 'sync-delete', 'draw-remove']);
// The shape of every path the app's router sends ('/', '/journal', '/p/12'). Old installed clients send the raw
// fragment, which may hold search words: anything else is stored as 'unknown'.
const ROUTE_PATH = /^\/(?:[a-z]+(?:\/\d{1,2})?)?$/;
const routePath = (v) => (v == null ? null : (typeof v === 'string' && (v === 'unknown' || ROUTE_PATH.test(v)) ? v : 'unknown'));
const clip = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, n) : null);

function device(ua = '') {
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'phone';
  return 'desktop';
}

const dropped = () => new Response(null, { status: 204 });

async function record(request, env) {
  if (!env.tao_analytics) return dropped();
  // The client sends nothing under DNT or GPC; a browser or tool may set only the header, so check it here too.
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return dropped();
  const origin = request.headers.get('origin');
  // A page of this app always sends Origin (fetch and sendBeacon both do) or at least Sec-Fetch-Site.
  if (origin ? origin !== env.ORIGIN : request.headers.get('sec-fetch-site') !== 'same-origin') return dropped();
  // Per-IP limit (the IP is used for counting only, never stored). Without the binding the events are stored:
  // analytics fails open, unlike sync, because a lost limit costs only junk rows, never a journal.
  if (env.EVENTS_LIMIT?.limit) {
    const { success } = await env.EVENTS_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
    if (!success) return dropped();
  }
  const body = await readCapped(request, MAX_BODY);
  if (body === null) return new Response(null, { status: 413 });
  let list;
  try { list = JSON.parse(body); } catch { return new Response(null, { status: 400 }); }
  if (!Array.isArray(list)) list = [list];
  const ts = Date.now();
  const dev = device(request.headers.get('user-agent') || '');
  const country = clip(request.cf?.country, 2);
  const rows = list.slice(0, 20).filter((e) => e && EVENTS.has(e.ev)).map((e) => env.tao_analytics.prepare(
    'INSERT INTO events (ts, vid, sid, ev, path, prev, detail, country, device, standalone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(ts, clip(e.vid, 40), clip(e.sid, 40), e.ev, routePath(e.path), routePath(e.prev), clip(e.detail, 64), country, dev, e.standalone ? 1 : 0));
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
    const api = await handleApi(request, env);
    if (api) return api;
    return env.ASSETS.fetch(request);
  },
};
