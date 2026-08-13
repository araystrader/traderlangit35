/**
 * Netlify Function — thin wrapper around lib/api-core.js.
 */
const { route } = require('../../lib/api-core.js');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

exports.handler = async (event) => {
  let path = event.path || '';
  if (!path.includes('/api/') && event.rawUrl) { try { path = new URL(event.rawUrl).pathname; } catch (e) {} }
  const rt = (path.match(/\/api\/([^/?]+)/) || [])[1] || '';
  const params = event.queryStringParameters || {};
  const out = await route(rt, params);
  const statusCode = out._404 ? 404 : 200;
  delete out._404;
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(out) };
};
