/**
 * Cloudflare Pages Function — thin wrapper around lib/api-core.js.
 * Placed at functions/api/[[path]].js so it catches /api, /api/tickers,
 * /api/candles?id=&tf=, /api/calendar, /api/news, /api/health.
 */
import { route } from '../../lib/api-core.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export async function onRequest(context) {
  const { request, params } = context;
  const url = new URL(request.url);
  // route = first path segment after /api (or 'health' default via catch-all)
  const segs = (params.path || []);
  const rt = segs[0] || 'health';
  const q = {};
  url.searchParams.forEach((v, k) => { q[k] = v; });
  const out = await route(rt, q);
  const statusCode = out._404 ? 404 : 200;
  delete out._404;
  return new Response(JSON.stringify(out), { status: statusCode, headers: JSON_HEADERS });
}
