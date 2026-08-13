/**
 * Shared API core — used by both the Netlify function and the Cloudflare
 * Pages function. Exposes route(route, params) -> { statusCode, body }.
 * Data sources (all free, no key):
 *   Forex/Gold : Yahoo Finance    Crypto : OKX
 *   Calendar   : ForexFactory     News   : Cointelegraph + CoinDesk RSS
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const FOREX = [
  { id: 'EURUSD', label: 'EUR/USD', yahoo: 'EURUSD=X', dp: 5 },
  { id: 'GBPUSD', label: 'GBP/USD', yahoo: 'GBPUSD=X', dp: 5 },
  { id: 'USDJPY', label: 'USD/JPY', yahoo: 'USDJPY=X', dp: 3 },
  { id: 'AUDUSD', label: 'AUD/USD', yahoo: 'AUDUSD=X', dp: 5 },
  { id: 'USDCAD', label: 'USD/CAD', yahoo: 'USDCAD=X', dp: 5 },
  { id: 'USDCHF', label: 'USD/CHF', yahoo: 'USDCHF=X', dp: 5 },
  { id: 'NZDUSD', label: 'NZD/USD', yahoo: 'NZDUSD=X', dp: 5 },
];
const CRYPTO = [
  { id: 'BTCUSDT', label: 'BTC/USDT', okx: 'BTC-USDT', dp: 1 },
  { id: 'ETHUSDT', label: 'ETH/USDT', okx: 'ETH-USDT', dp: 2 },
  { id: 'SOLUSDT', label: 'SOL/USDT', okx: 'SOL-USDT', dp: 3 },
  { id: 'BNBUSDT', label: 'BNB/USDT', okx: 'BNB-USDT', dp: 2 },
  { id: 'XRPUSDT', label: 'XRP/USDT', okx: 'XRP-USDT', dp: 5 },
];
const GOLD = [{ id: 'XAUUSD', label: 'XAU/USD (Emas)', yahoo: 'GC=F', dp: 2 }];
const ALL = [...FOREX, ...CRYPTO, ...GOLD];
const byId = Object.fromEntries(ALL.map(i => [i.id, i]));

const YAHOO_TF = {
  '1m': { interval: '1m', range: '1d' },
  '5m': { interval: '5m', range: '5d' },
  '15m': { interval: '15m', range: '10d' },
  '1h': { interval: '1h', range: '3mo' },
  '4h': { interval: '1h', range: '6mo', agg: 4 },
  '1d': { interval: '1d', range: '2y' },
};
const OKX_TF = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D' };

async function jfetch(url, opts = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

function aggregate(candles, n) {
  const out = [];
  for (let i = 0; i < candles.length; i += n) {
    const bucket = candles.slice(i, i + n);
    if (!bucket.length) continue;
    out.push({
      t: bucket[0].t, o: bucket[0].o,
      h: Math.max(...bucket.map(c => c.h)),
      l: Math.min(...bucket.map(c => c.l)),
      c: bucket[bucket.length - 1].c,
      v: bucket.reduce((s, c) => s + (c.v || 0), 0),
    });
  }
  return out;
}

async function yahooCandles(symbol, tf) {
  const cfg = YAHOO_TF[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${cfg.interval}&range=${cfg.range}&includePrePost=false`;
  const j = await (await jfetch(url)).json();
  const r = j.chart?.result?.[0];
  if (!r) throw new Error('no yahoo data');
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    out.push({ t: ts[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume?.[i] || 0 });
  }
  if (cfg.agg) return aggregate(out, cfg.agg).slice(-500);
  return out.slice(-500);
}

async function okxCandles(instId, tf) {
  const bar = OKX_TF[tf];
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=300`;
  const j = await (await jfetch(url)).json();
  if (j.code !== '0' || !j.data) throw new Error('okx error ' + j.msg);
  return j.data.map(c => ({ t: +c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] })).reverse().slice(-500);
}

async function fetchTicker(inst) {
  try {
    if (inst.okx) {
      const j = await (await jfetch(`https://www.okx.com/api/v5/market/ticker?instId=${inst.okx}`)).json();
      const d = j.data?.[0];
      return { id: inst.id, price: +d.last, open: +d.open24h, high: +d.high24h, low: +d.low24h, change: (+d.last - +d.open24h) / +d.open24h * 100 };
    }
    if (inst.yahoo) {
      const j = await (await jfetch(`https://query1.finance.yahoo.com/v8/finance/chart/${inst.yahoo}?interval=1m&range=1d`)).json();
      const m = j.chart?.result?.[0]?.meta || {};
      const change = m.chartPreviousClose ? (m.regularMarketPrice - m.chartPreviousClose) / m.chartPreviousClose * 100 : 0;
      return { id: inst.id, price: m.regularMarketPrice, open: m.chartPreviousClose, high: m.regularMarketDayHigh, low: m.regularMarketDayLow, change };
    }
  } catch (e) { console.error('ticker fail', inst.id, e.message); }
  return null;
}

function parseFFHtml(html) {
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const nthSun = (y, mo, n) => { const d = new Date(Date.UTC(y, mo, 1)); return 1 + ((n - 1) * 7) + ((7 - d.getUTCDay()) % 7); };
  const isDST = (y, mo, day) => { const mar = nthSun(y, 2, 2), nov = nthSun(y, 10, 1); const k = mo * 100 + day; return k >= 200 + mar && k < 1000 + nov; };
  const events = [];
  let curDate = null, curTime = '', curYear = new Date().getUTCFullYear();
  const rowRe = /<tr\b[^>]*class="calendar__row[^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const head = m[0], body = m[1];
    if (body.includes('calendar__row--day-breaker')) {
      const dm = body.match(/<span>([A-Z][a-z]{2}) (\d+)<\/span>/);
      if (dm) curDate = { mo: MON[dm[1]], day: +dm[2] };
      continue;
    }
    if (!/data-event-id/.test(head)) continue;
    const dl = head.match(/data-day-dateline="(\d+)"/);
    if (dl) {
      const d = new Date(+dl[1] * 1000);
      const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
      const g = t => (p.find(x => x.type === t) || {}).value;
      curYear = +g('year'); curDate = { mo: +g('month') - 1, day: +g('day') };
    }
    const time = (body.match(/calendar__time[^>]*>([\s\S]*?)<\/td>/) || [])[1] || '';
    if (time.trim()) curTime = time.trim();
    const country = (body.match(/calendar__currency[^>]*>\s*([A-Z]{3})/) || [])[1] || '';
    const impact = body.includes('impact-red') ? 'High' : body.includes('impact-yel') ? 'Medium' : 'Low';
    const title = (body.match(/calendar__event-title">([^<]+)</) || [])[1] || '';
    const forecast = ((body.match(/calendar__forecast[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '').trim();
    const previous = ((body.match(/calendar__previous[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '').trim();
    if (!curDate || !title) continue;
    let hh = 0, mm = 0;
    const tm = curTime.match(/(\d+):(\d+)(am|pm)/i);
    if (tm) { hh = +tm[1] % 12; if (/pm/i.test(tm[3])) hh += 12; mm = +tm[2]; }
    const etAsUtc = new Date(Date.UTC(curYear, curDate.mo, curDate.day, hh, mm));
    const off = isDST(curYear, curDate.mo, curDate.day) ? 4 : 5;
    events.push({ title, country, impact, forecast, previous, date: new Date(etAsUtc.getTime() + off * 3600e3).toISOString() });
  }
  return events;
}

async function fetchCalendar() {
  let out = [];
  try {
    const j = await (await jfetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json')).json();
    out = j.map(e => ({ title: e.title, country: e.country, impact: e.impact, forecast: e.forecast, previous: e.previous, date: e.date }));
  } catch (e) { console.error('calendar (faireconomy) fail, trying FF html:', e.message); }
  if (!out.length) {
    const html = await (await jfetch('https://www.forexfactory.com/calendar?week=this')).text();
    out = parseFFHtml(html);
  }
  return out;
}

function parseRss(xml, limit) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[1];
    const grab = tag => { const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block); return r ? r[1] : ''; };
    const title = grab('title').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
    const link = grab('link').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const pub = grab('pubDate');
    const desc = grab('description').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim().slice(0, 180);
    if (title) items.push({ title, link, date: pub, desc, source: '' });
  }
  return items;
}

async function fetchNews() {
  const sources = [
    { url: 'https://cointelegraph.com/rss', name: 'Cointelegraph' },
    { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', name: 'CoinDesk' },
  ];
  const all = [];
  for (const s of sources) {
    try {
      const xml = await (await jfetch(s.url)).text();
      const items = parseRss(xml, 12);
      items.forEach(i => (i.source = s.name));
      all.push(...items);
    } catch (e) { console.error('news fail', s.name, e.message); }
  }
  return all.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20);
}

/* ---- in-memory cache (persists across warm invocations) ---- */
const tickerCache = {};
let tickerTs = 0;
const candleCache = {};
const calendarCache = { ts: 0, data: [] };
const newsCache = { ts: 0, data: [] };

async function getTickers() {
  if (Date.now() - tickerTs > 4000) {
    const results = await Promise.all(ALL.map(fetchTicker));
    for (const r of results) if (r) tickerCache[r.id] = r;
    tickerTs = Date.now();
  }
  return Object.keys(tickerCache).map(k => tickerCache[k]).filter(Boolean);
}

async function getCandles(id, tf) {
  const key = `${id}|${tf}`;
  const now = Date.now();
  const c = candleCache[key];
  const ttl = tf === '1m' ? 15000 : 30000;
  if (c && now - c.ts < ttl) return c.candles;
  const inst = byId[id];
  if (!inst) throw new Error('unknown instrument');
  const candles = inst.okx ? await okxCandles(inst.okx, tf) : await yahooCandles(inst.yahoo, tf);
  candleCache[key] = { ts: now, candles };
  return candles;
}

async function getCalendar() {
  if (Date.now() - calendarCache.ts > 300000) {
    try { calendarCache.data = await fetchCalendar(); } catch (e) { console.error('calendar fail', e.message); }
    calendarCache.ts = Date.now();
  }
  const now = Date.now();
  return calendarCache.data
    .map(e => ({ ...e, ts: new Date(e.date).getTime() }))
    .filter(e => e.ts > now - 3600e3)
    .sort((a, b) => a.ts - b.ts);
}

async function getNews() {
  if (Date.now() - newsCache.ts > 300000) {
    try { newsCache.data = await fetchNews(); } catch (e) { console.error('news fail', e.message); }
    newsCache.ts = Date.now();
  }
  return newsCache.data;
}

/* ---- route dispatcher ---- */
async function route(route, params) {
  try {
    if (route === 'instruments') return { data: ALL.map(i => ({ id: i.id, label: i.label, dp: i.dp, type: i.okx ? 'crypto' : 'forex' })) };
    if (route === 'tickers') return { ts: Date.now(), data: await getTickers() };
    if (route === 'candles') {
      const id = params.id || 'EURUSD', tf = params.tf || '15m';
      return { id, tf, candles: await getCandles(id, tf) };
    }
    if (route === 'calendar') return { ts: Date.now(), data: await getCalendar() };
    if (route === 'news') return { ts: Date.now(), data: await getNews() };
    if (route === 'health') return { ok: true, time: new Date().toISOString() };
    return { error: 'not found', _404: true };
  } catch (e) {
    console.error('route error', route, e.message);
    return { error: e.message };
  }
}

module.exports = { route, ALL, byId };
