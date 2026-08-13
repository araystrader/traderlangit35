/* ============================================================
   Trading Dashboard — frontend (indicators, 5 strategy engines,
   charting, realtime UI). Vanilla JS + Lightweight Charts v4.
   ============================================================ */
'use strict';

/* ---------------- state ---------------- */
const S = {
  instruments: [],
  byId: {},
  tickers: {},
  active: 'EURUSD',
  tf: '15m',
  candles: [],
  calendar: [],
  news: [],
  tab: 'ema135',
  dp: 5,
  lastSignal: null,
  needsFit: true,
  visibleTimeRange: null,
  candleReq: 0,
  lastDir: null,
  alertInit: false,
  alertCount: 0,
  alertSettings: { sound: true, notif: false },
  alerts: [],
};

const TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const TABS = [
  { id: 'ema135', name: '1 · EMA135 Zona' },
  { id: 'bbma',  name: '2 · BBMA Oma Ally' },
  { id: 'f5',    name: '3 · F5 Bystra' },
  { id: 'ict',   name: '4 · ICT / SMC' },
  { id: 'fund',  name: '5 · Fundamental & News' },
];

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ============================================================
   INDICATOR MATH
   ============================================================ */
function emaArr(vals, n) {
  const k = 2 / (n + 1), out = new Array(vals.length).fill(null);
  let prev = vals[0]; out[0] = prev;
  for (let i = 1; i < vals.length; i++) { prev = vals[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
function smaArr(vals, n) {
  const out = new Array(vals.length).fill(null); let s = 0;
  for (let i = 0; i < vals.length; i++) {
    s += vals[i]; if (i >= n) s -= vals[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
function last(arr) { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; }

function stddev(vals, mean, i, n) {
  let s = 0; for (let j = i - n + 1; j <= i; j++) s += (vals[j] - mean) * (vals[j] - mean);
  return Math.sqrt(s / n);
}
function bollinger(closes, n = 20, mult = 2) {
  const mid = smaArr(closes, n), up = [], lo = [];
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] == null) { up.push(null); lo.push(null); continue; }
    const sd = stddev(closes, mid[i], i, n);
    up.push(mid[i] + mult * sd); lo.push(mid[i] - mult * sd);
  }
  return { mid, up, lo };
}
function atr(candles, n = 14) {
  if (candles.length < n + 1) return (candles[candles.length - 1].h - candles[candles.length - 1].l) || 0.0001;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].h, l = candles[i].l, pc = candles[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let a = trs.slice(0, n).reduce((s, x) => s + x, 0) / n;
  for (let i = n; i < trs.length; i++) a = (a * (n - 1) + trs[i]) / n;
  return a || 0.0001;
}
function swings(candles, left = 3, right = 3) {
  const highs = [], lows = [];
  for (let i = left; i < candles.length - right; i++) {
    let isH = true, isL = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isH = false;
      if (candles[j].l <= candles[i].l) isL = false;
    }
    if (isH) highs.push({ i, t: candles[i].t, p: candles[i].h });
    if (isL) lows.push({ i, t: candles[i].t, p: candles[i].l });
  }
  return { highs, lows };
}
function findFVGs(candles) {
  const fvgs = [];
  for (let i = 2; i < candles.length; i++) {
    if (candles[i].l > candles[i - 2].h) fvgs.push({ type: 'bull', top: candles[i].l, bottom: candles[i - 2].h, i });
    if (candles[i].h < candles[i - 2].l) fvgs.push({ type: 'bear', top: candles[i - 2].l, bottom: candles[i].h, i });
  }
  // filter unfilled
  const unfilled = fvgs.filter(f => {
    for (let j = f.i + 1; j < candles.length; j++) {
      if (candles[j].l <= f.top && candles[j].h >= f.bottom) return false; // mitigated
    }
    return true;
  });
  return { all: fvgs, unfilled };
}
function lastOrderBlocks(candles) {
  const { highs, lows } = swings(candles, 2, 2);
  const findOB = (idx, dir) => { // dir: 'bull' => last bearish candle before a low
    for (let j = idx - 1; j >= Math.max(0, idx - 6); j--) {
      const bullish = candles[j].c > candles[j].o;
      if (dir === 'bull' && !bullish) return { i: j, top: candles[j].h, bottom: candles[j].l };
      if (dir === 'bear' && bullish) return { i: j, top: candles[j].h, bottom: candles[j].l };
    }
    return null;
  };
  const bullOB = lows.length ? findOB(lows[lows.length - 1].i, 'bull') : null;
  const bearOB = highs.length ? findOB(highs[highs.length - 1].i, 'bear') : null;
  return { bullOB, bearOB, highs, lows };
}

/* ============================================================
   STRATEGY 1 — EMA135 HIGH/LOW ZONE
   ============================================================ */
function stratEMA135(candles, dp) {
  const highs = candles.map(c => c.h), lows = candles.map(c => c.l), closes = candles.map(c => c.c);
  const emaH = emaArr(highs, 135), emaL = emaArr(lows, 135);
  const eH = last(emaH), eL = last(emaL);
  const close = closes[closes.length - 1];
  const a = atr(candles);
  let dir = 'WAIT', entry = null, sl = null, reason = '';
  if (close > eH) {
    dir = 'BUY'; entry = close; sl = eL; reason = 'Harga breakout (close) di atas EMA135 High → zona atas, momentum bullish.';
  } else if (close < eL) {
    dir = 'SELL'; entry = close; sl = eH; reason = 'Harga breakout (close) di bawah EMA135 Low → zona bawah, momentum bearish.';
  } else {
    reason = `Harga masih di DALAM zona (${fmt(eL, dp)} – ${fmt(eH, dp)}). Tunggu close breakout untuk entry.`;
  }
  const tp1 = dir === 'WAIT' ? null : (dir === 'BUY' ? entry + 1.5 * Math.abs(entry - sl) : entry - 1.5 * Math.abs(entry - sl));
  const tp2 = dir === 'WAIT' ? null : (dir === 'BUY' ? entry + 2.5 * Math.abs(entry - sl) : entry - 2.5 * Math.abs(entry - sl));
  return {
    dir, entry, sl, tp1, tp2,
    rr1: dir === 'WAIT' ? null : (Math.abs(tp1 - entry) / Math.abs(entry - sl)).toFixed(2),
    reason,
    levels: [
      { k: 'EMA135 High (resistance zona)', v: eH, c: '#ea3943' },
      { k: 'EMA135 Low (support zona)', v: eL, c: '#16c784' },
      { k: 'Harga sekarang', v: close, c: '#e6ebf5' },
    ],
    atr: a,
    desc: `Zona dibentuk oleh <b>EMA(135) pada High</b> (garis atas) dan <b>EMA(135) pada Low</b> (garis bawah). Strategi: <b>tunggu harga breakout (tutup candle) di luar zona</b>. Close di atas EMA135 High = sinyal BUY; close di bawah EMA135 Low = sinyal SELL. Selama harga di dalam zona = netral / menunggu. SL ditempatkan di sisi zona yang berlawanan, TP memakai rasio 1:1.5 dan 1:2.5 dari risiko.`,
  };
}

/* ============================================================
   STRATEGY 2 — BBMA OMA ALLY
   ============================================================ */
function stratBBMA(candles, dp) {
  const closes = candles.map(c => c.c), highs = candles.map(c => c.h), lows = candles.map(c => c.l);
  const bb = bollinger(closes, 20, 2);
  const ma5h = smaArr(highs, 5), ma10h = smaArr(highs, 10), ma5l = smaArr(lows, 5), ma10l = smaArr(lows, 10);
  const ema50 = emaArr(closes, 50);
  const c = closes[closes.length - 1];
  const up = last(bb.up), mid = last(bb.mid), lo = last(bb.lo);
  const e50 = last(ema50);
  const m5h = last(ma5h), m5l = last(ma5l);
  const trend = c > e50 ? 'UPTREND' : 'DOWNTREND';
  const a = atr(candles);

  // Extreme detection
  let extreme = null;
  if (c > up) extreme = 'EXTREME ATAS (candle close di luar BB atas) — waspada reversal / jenuh beli';
  else if (c < lo) extreme = 'EXTREME BAWAH (candle close di luar BB bawah) — waspada reversal / jenuh jual';

  // Re-entry zone
  let dir = 'WAIT', entry = null, sl = null, reason = '';
  const near = (x, y) => Math.abs(x - y) <= 0.25 * a;
  if (trend === 'UPTREND' && (near(c, m5h) || near(c, ma10h[ma10h.length - 1]))) {
    dir = 'SELL'; entry = c; sl = up + 0.3 * a; reason = 'Uptrend, harga pullback ke zona MA5/10 High (Line of Fire / Killzone) → Re-Entry SELL (CS Direction).';
  } else if (trend === 'DOWNTREND' && (near(c, m5l) || near(c, ma10l[ma10l.length - 1]))) {
    dir = 'BUY'; entry = c; sl = lo - 0.3 * a; reason = 'Downtrend, harga pullback ke zona MA5/10 Low (Line of Fire / Killzone) → Re-Entry BUY.';
  } else if (trend === 'UPTREND') {
    dir = 'WAIT'; reason = 'Uptrend (harga di atas EMA50). Tunggu pullback ke MA5/10 High untuk Re-Entry SELL.';
  } else {
    dir = 'WAIT'; reason = 'Downtrend (harga di bawah EMA50). Tunggu pullback ke MA5/10 Low untuk Re-Entry BUY.';
  }
  const tp1 = dir === 'WAIT' ? null : (dir === 'BUY' ? entry + Math.abs(entry - sl) : entry - Math.abs(entry - sl));
  const tp2 = dir === 'WAIT' ? null : (dir === 'BUY' ? entry + 2 * Math.abs(entry - sl) : entry - 2 * Math.abs(entry - sl));
  return {
    dir, entry, sl, tp1, tp2,
    rr1: dir === 'WAIT' ? null : (Math.abs(tp1 - entry) / Math.abs(entry - sl)).toFixed(2),
    reason,
    trend, extreme,
    levels: [
      { k: 'BB Atas', v: up, c: '#ea3943' },
      { k: 'BB Tengah (Mid / CSD)', v: mid, c: '#f0b90b' },
      { k: 'BB Bawah', v: lo, c: '#16c784' },
      { k: 'EMA 50 (penentu trend)', v: e50, c: '#22d3ee' },
      { k: 'MA5 High', v: m5h, c: '#f87171' },
      { k: 'MA5 Low', v: m5l, c: '#f0abfc' },
    ],
    atr: a,
    desc: `<b>BBMA Oma Ally</b> = Bollinger Bands (20,2,Close) + 5 Moving Average (MA5 High, MA10 High, MA5 Low, MA10 Low, EMA50). <b>EMA50</b> menentukan trend (di atas = uptrend, di bawah = downtrend). Entry utama: <b>Re-Entry</b> saat harga pullback ke zona MA5/10 (Line of Fire/Killzone) searah trend, dan <b>Extreme</b> saat candle menutup di luar Bollinger (early reversal). Mid BB (CSD) jadi support/resistance + target profit pertama.`,
  };
}

/* ============================================================
   STRATEGY 3 — F5 BYSTRA (Fantastic Five)
   ============================================================ */
function stratF5(candles, dp) {
  const { highs, lows } = swings(candles, 2, 2);
  const c = candles[candles.length - 1].c;
  const a = atr(candles);

  // --- Quasimodo (QMR/QMC) detection ---
  const pts = [...highs.map(p => ({ ...p, kind: 'H' })), ...lows.map(p => ({ ...p, kind: 'L' }))].sort((x, y) => x.i - y.i);
  let qm = null;
  if (pts.length >= 4) {
    const [p0, p1, p2, p3] = pts.slice(-4);
    if (p0.kind === 'H' && p1.kind === 'L' && p2.kind === 'H' && p2.p > p0.p) {
      const neck = p1.p, broke = c < neck;
      qm = { dir: 'SELL', name: 'QMR (Quasimodo Reversal) bearish', entry: neck, sl: p2.p, tp: p2.p - (p2.p - neck), broke, invalidation: p2.p };
    } else if (p0.kind === 'L' && p1.kind === 'H' && p2.kind === 'L' && p2.p < p0.p) {
      const neck = p1.p, broke = c > neck;
      qm = { dir: 'BUY', name: 'QMR (Quasimodo Reversal) bullish', entry: neck, sl: p2.p, tp: p2.p + (neck - p2.p), broke, invalidation: p2.p };
    }
  }

  // --- Support (V) / Resistance (A) ---
  const v = lows.length ? lows[lows.length - 1].p : null;   // nearest support
  const A = highs.length ? highs[highs.length - 1].p : null; // nearest resistance
  const e50 = last(emaArr(candles.map(x => x.c), 50));
  const trend = c > e50 ? 'UP' : 'DOWN';

  let dir = 'WAIT', entry = null, sl = null, tp1 = null, reason = '';
  if (qm && qm.broke) {
    dir = qm.dir; entry = qm.entry; sl = qm.sl; tp1 = qm.tp;
    reason = `${qm.name} TEREKONFIRMASI (harga menembus neckline ${fmt(qm.entry, dp)}). Entry searah break, SL di ${fmt(qm.sl, dp)}, TP di ${fmt(qm.tp, dp)}.`;
  } else if (qm) {
    dir = 'WAIT'; reason = `${qm.name} sedang terbentuk — tunggu penembusan neckline ${fmt(qm.entry, dp)}.`;
  } else if (trend === 'UP' && v != null && Math.abs(c - v) <= 0.5 * a) {
    dir = 'BUY'; entry = c; sl = v - 0.4 * a; tp1 = c + 1.5 * Math.abs(c - sl);
    reason = 'SNRC1 (continuation) — harga kembali ke Support (V) di tengah uptrend (RBR/Demand). Entry BUY di zona support.';
  } else if (trend === 'DOWN' && A != null && Math.abs(c - A) <= 0.5 * a) {
    dir = 'SELL'; entry = c; sl = A + 0.4 * a; tp1 = c - 1.5 * Math.abs(c - sl);
    reason = 'SNRC1 (continuation) — harga kembali ke Resistance (A) di tengah downtrend (DBD/Supply). Entry SELL di zona resistance.';
  } else {
    dir = 'WAIT'; reason = 'Belum ada setup F5 yang valid. Pantau penembusan neckline Quasimodo atau pullback ke zona Support/Resistance.';
  }
  const tp2 = dir === 'WAIT' ? null : (dir === 'BUY' ? entry + 2.5 * Math.abs(entry - sl) : entry - 2.5 * Math.abs(entry - sl));
  return {
    dir, entry, sl, tp1, tp2,
    rr1: dir === 'WAIT' ? null : (Math.abs(tp1 - entry) / Math.abs(entry - sl)).toFixed(2),
    reason,
    levels: [
      { k: 'Resistance (A)', v: A, c: '#ea3943' },
      { k: 'Support (V)', v: v, c: '#16c784' },
      ...(qm ? [{ k: `Neckline QM`, v: qm.entry, c: '#f0b90b' }] : []),
    ],
    atr: a,
    desc: `<b>F5 (Fantastic Five) Bystra Nora Karim</b> terdiri dari 5 setup: <b>QMR</b> (Quasimodo Reversal), <b>QMC</b> (Quasimodo Continuation), <b>SNRC1</b> (RBR/DBD di Support-Resistance), <b>SNRC2</b>, dan <b>QMM</b>. Inti-nya: entry di <b>zona Support (V)/Resistance (A)</b> dengan konfirmasi arah (DMD1/DMD2) dan struktur Quasimodo. Gunakan konfirmasi timeframe lebih tinggi (Engulfing) untuk menaikkan winrate.`,
  };
}

/* ============================================================
   STRATEGY 4 — ICT / SMC
   ============================================================ */
function stratICT(candles, dp) {
  const { highs, lows } = swings(candles, 3, 3);
  const c = candles[candles.length - 1].c;
  const a = atr(candles);
  const fvgs = findFVGs(candles);
  const { bullOB, bearOB } = lastOrderBlocks(candles);

  // major swing range + equilibrium
  let dir = 'WAIT', entry = null, sl = null, tp1 = null, reason = '', pos = '';
  const majorHigh = highs.length ? Math.max(...highs.slice(-3).map(x => x.p)) : null;
  const majorLow = lows.length ? Math.min(...lows.slice(-3).map(x => x.p)) : null;
  const eq = (majorHigh != null && majorLow != null) ? (majorHigh + majorLow) / 2 : c;

  pos = c >= eq ? 'PREMIUM' : 'DISCOUNT';

  // nearest unmitigated FVG
  const bullFVG = [...fvgs.unfilled].filter(f => f.type === 'bull').pop();
  const bearFVG = [...fvgs.unfilled].filter(f => f.type === 'bear').pop();

  // Break of structure
  const lastSwingHigh = highs.length ? highs[highs.length - 1].p : null;
  const lastSwingLow = lows.length ? lows[lows.length - 1].p : null;
  let bos = '';
  if (lastSwingHigh != null && c > lastSwingHigh) bos = 'BOS bullish (break swing high)';
  else if (lastSwingLow != null && c < lastSwingLow) bos = 'BOS bearish (break swing low)';
  else bos = 'Belum ada Break of Structure';

  // liquidity
  const liqHigh = highs.length ? Math.round(highs.slice(-4).reduce((s, x) => s + x.p, 0) / highs.slice(-4).length * 100) / 100 : null;

  if (pos === 'DISCOUNT' && bullFVG && c > bullFVG.bottom) {
    dir = 'BUY'; entry = c; sl = bullFVG.bottom - 0.2 * a; tp1 = eq;
    reason = `Harga di zona DISCOUNT + terdapat Fair Value Gap bullish (${fmt(bullFVG.bottom, dp)}–${fmt(bullFVG.top, dp)}). Entry BUY menuju equilibrium ${fmt(eq, dp)} / liquidity di atas.`;
  } else if (pos === 'PREMIUM' && bearFVG && c < bearFVG.top) {
    dir = 'SELL'; entry = c; sl = bearFVG.top + 0.2 * a; tp1 = eq;
    reason = `Harga di zona PREMIUM + Fair Value Gap bearish (${fmt(bearFVG.bottom, dp)}–${fmt(bearFVG.top, dp)}). Entry SELL menuju equilibrium ${fmt(eq, dp)} / liquidity di bawah.`;
  } else if (pos === 'DISCOUNT') {
    dir = 'WAIT'; reason = 'Harga di zona DISCOUNT (area beli institusi). Tunggu konfirmasi FVG / Order Block bullish + BOS untuk entry BUY.';
  } else {
    dir = 'WAIT'; reason = 'Harga di zona PREMIUM (area jual institusi). Tunggu konfirmasi FVG / Order Block bearish + BOS untuk entry SELL.';
  }
  const tp2 = dir === 'WAIT' ? null : (dir === 'BUY' ? entry + 2 * Math.abs(entry - sl) : entry - 2 * Math.abs(entry - sl));
  const lvls = [];
  if (eq != null) lvls.push({ k: 'Equilibrium (50% range)', v: eq, c: '#f0b90b' });
  if (bullOB) lvls.push({ k: 'Order Block bullish', v: (bullOB.top + bullOB.bottom) / 2, c: '#16c784' });
  if (bearOB) lvls.push({ k: 'Order Block bearish', v: (bearOB.top + bearOB.bottom) / 2, c: '#ea3943' });
  if (bullFVG) lvls.push({ k: 'FVG bullish (tengah)', v: (bullFVG.top + bullFVG.bottom) / 2, c: '#34d399' });
  if (bearFVG) lvls.push({ k: 'FVG bearish (tengah)', v: (bearFVG.top + bearFVG.bottom) / 2, c: '#f87171' });

  return {
    dir, entry, sl, tp1, tp2,
    rr1: dir === 'WAIT' ? null : (Math.abs(tp1 - entry) / Math.abs(entry - sl)).toFixed(2),
    reason, bos, pos, liqHigh,
    levels: lvls,
    atr: a,
    desc: `<b>ICT / Smart Money Concepts</b> menganalisa jejak institusi: <b>Market Structure</b> (BOS/CHoCH), <b>Order Block</b>, <b>Fair Value Gap</b>, <b>Liquidity</b> (equal highs/lows), dan zona <b>Premium/Discount</b> dari range swing. Logika: beli di area DISCOUNT (murah) dekat Order Block/FVG, jual di area PREMIUM (mahal), dengan target liquidity/equilibrium. <b>Killzone waktu</b> (Asia/London/NY) ditampilkan di panel Fundamental.`,
  };
}

/* ============================================================
   STRATEGY 5 — FUNDAMENTAL (calendar + news + countdown)
   ============================================================ */
function stratFund() {
  const high = S.calendar.filter(e => e.impact === 'High' && e.ts > Date.now());
  const next = high.length ? high[0] : S.calendar.find(e => e.ts > Date.now());
  const cd = next ? countdown(next.ts - Date.now()) : null;
  let advice = '';
  if (next && next.ts - Date.now() < 30 * 60e3) {
    advice = `<span class="bad">⚠️ Event berdampak TINGGI dalam &lt; 30 menit</span> — hindari entry baru atau kurangi size.`;
  } else if (next) {
    advice = `Event berdampak tinggi berikutnya: <b>${esc(next.title)}</b> (${esc(next.country)}) dalam <b>${cd}</b>. Rencanakan posisi sebelum rilis.`;
  } else {
    advice = 'Tidak ada event berdampak tinggi dalam waktu dekat.';
  }
  return {
    dir: 'WAIT', entry: null, sl: null, tp1: null, tp2: null, rr1: null,
    reason: advice, next, cd,
    levels: [],
    atr: null,
    desc: `<b>Analisa Fundamental</b> memakai <b>Kalender Ekonomi</b> (ForexFactory) dengan hitungan mundur waktu <b>WIB (GMT+7)</b> dan <b>berita realtime</b> (Cointelegraph &amp; CoinDesk). Aturan umum: hindari buka posisi 15–30 menit sebelum/sesudah rilis berdampak <span class="bad">Tinggi</span> (NFP, CPI, FOMC, GDP, dsb) karena spread melebar &amp; volatilitas ekstrem. Gunakan berita untuk konfirmasi bias arah, bukan sebagai pemicu entry.`,
  };
}

/* ============================================================
   CHART
   ============================================================ */
let chart = null, candleSeries = null, volSeries = null;
let overlaySeries = [], priceLines = [], markers = [];

function fmt(v, dp) {
  if (v == null || isNaN(v)) return '—';
  const p = Math.pow(10, dp);
  return (Math.round(v * p) / p).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function buildChart() {
  if (chart) return;
  const wrap = $('#chartWrap');
  chart = LightweightCharts.createChart(wrap, {
    width: wrap.clientWidth, height: wrap.clientHeight,
    layout: { background: { color: '#11151f' }, textColor: '#8b95ab', fontSize: 11 },
    grid: { vertLines: { color: '#1a2130' }, horzLines: { color: '#1a2130' } },
    rightPriceScale: { borderColor: '#232b3d' },
    timeScale: { borderColor: '#232b3d', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  candleSeries = chart.addCandlestickSeries({
    upColor: '#16c784', downColor: '#ea3943', wickUpColor: '#16c784', wickDownColor: '#ea3943', borderVisible: false,
  });
  // Pantau rentang waktu yang terlihat (di-cache), dipakai autoscaleInfoProvider.
  // (Menghindari memanggil getVisibleRange() dari dalam perhitungan autoscale.)
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    try { S.visibleTimeRange = chart.timeScale().getVisibleRange(); } catch (e) { S.visibleTimeRange = null; }
  });
  // Kunci auto-scale sumbu harga: hanya mengikuti candle yang TERLIHAT,
  // supaya overlay (EMA/Bollinger/price line FVG/OB) tidak menggeser skala.
  candleSeries.applyOptions({
    autoscaleInfoProvider: () => {
      const candles = S.candles;
      if (!candles.length) return null;
      let lo = Infinity, hi = -Infinity;
      const vr = S.visibleTimeRange;
      if (vr && vr.from < vr.to) {
        for (const c of candles) {
          const t = Math.floor(c.t / 1000);
          if (t < vr.from || t > vr.to) continue;
          if (c.l < lo) lo = c.l;
          if (c.h > hi) hi = c.h;
        }
      }
      if (!isFinite(lo) || !isFinite(hi)) {
        for (const c of candles.slice(-120)) {
          if (c.l < lo) lo = c.l;
          if (c.h > hi) hi = c.h;
        }
      }
      if (!isFinite(lo) || !isFinite(hi)) return null;
      const pad = (hi - lo) * 0.08;
      return { priceRange: { minValue: lo - pad, maxValue: hi + pad } };
    },
  });
  volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
  chart.priceScale('').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  window.addEventListener('resize', () => {
    chart.applyOptions({ width: wrap.clientWidth, height: wrap.clientHeight });
  });
}

function clearOverlays() {
  overlaySeries.forEach(s => { try { chart.removeSeries(s); } catch (e) {} });
  priceLines.forEach(p => { try { candleSeries.removePriceLine(p); } catch (e) {} });
  overlaySeries = []; priceLines = [];
}

function addLine(data, color, width = 1, style = LightweightCharts.LineStyle.Solid) {
  // buang titik dengan nilai null/NaN (warmup EMA/SMA) supaya tidak merusak chart
  const pts = data.filter(d => d.value != null && isFinite(d.value));
  if (pts.length < 2) return null;
  const s = chart.addLineSeries({
    color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    // jangan ikut hitung auto-scale (skala harga dikontrol candle series)
    autoscaleInfoProvider: () => null,
  });
  s.setData(pts);
  overlaySeries.push(s);
  return s;
}
function addPriceLine(price, color, title, style = LightweightCharts.LineStyle.Dashed) {
  const p = candleSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
  priceLines.push(p);
}

function renderChart() {
  buildChart();
  if (!S.candles.length) return;

  // sort + buang duplikat timestamp (defensif — mencegah error "data asc ordered"
  // yang bisa bikin candle hilang saat ganti timeframe)
  const seen = new Set();
  const clean = [];
  for (const c of S.candles) {
    const t = Math.floor(c.t / 1000);
    if (seen.has(t)) continue;
    seen.add(t);
    clean.push(c);
  }
  clean.sort((a, b) => a.t - b.t);

  try {
    const cd = clean.map(c => ({ time: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c }));
    const vol = clean.map(c => ({ time: Math.floor(c.t / 1000), value: c.v, color: c.c >= c.o ? 'rgba(22,199,132,.4)' : 'rgba(234,57,67,.4)' }));
    candleSeries.setData(cd);
    volSeries.setData(vol);
    candleSeries.setMarkers([]);
    // fit dulu (sebelum overlay) supaya rentang waktu selalu pas dengan data baru
    if (S.needsFit) { chart.timeScale().fitContent(); S.needsFit = false; }
  } catch (e) {
    console.error('renderChart data error', e);
  }

  try {
    drawOverlays(clean);
  } catch (e) {
    console.error('renderChart overlay error', e);
  }
}

function drawOverlays(candles) {
  clearOverlays();
  const closes = candles.map(c => c.c), highs = candles.map(c => c.h), lows = candles.map(c => c.l);
  const time = c => Math.floor(c.t / 1000);
  const sig = S.lastSignal;

  // markers entry / SL / TP
  const lastTime = Math.floor(candles[candles.length - 1].t / 1000);
  const mk = [];
  if (sig && sig.dir !== 'WAIT' && sig.entry != null) {
    const upDir = sig.dir === 'BUY';
    mk.push({ time: lastTime, position: upDir ? 'belowBar' : 'aboveBar', color: upDir ? '#16c784' : '#ea3943', shape: upDir ? 'arrowUp' : 'arrowDown', text: 'ENTRY' });
    if (sig.sl != null) { addPriceLine(sig.sl, '#ea3943', 'SL'); mk.push({ time: lastTime, position: upDir ? 'belowBar' : 'aboveBar', color: '#f87171', shape: 'circle', text: 'SL' }); }
    if (sig.tp1 != null) { addPriceLine(sig.tp1, '#16c784', 'TP1'); }
    if (sig.tp2 != null) { addPriceLine(sig.tp2, '#16c784', 'TP2'); }
  }
  candleSeries.setMarkers(mk);

  if (S.tab === 'ema135') {
    const eH = emaArr(highs, 135), eL = emaArr(lows, 135);
    addLine(candles.map((c, i) => ({ time: time(c), value: eH[i] })), '#ea3943', 2);
    addLine(candles.map((c, i) => ({ time: time(c), value: eL[i] })), '#16c784', 2);
  } else if (S.tab === 'bbma') {
    const bb = bollinger(closes, 20, 2);
    addLine(candles.map((c, i) => ({ time: time(c), value: bb.up[i] })), '#ea3943', 1);
    addLine(candles.map((c, i) => ({ time: time(c), value: bb.mid[i] })), '#f0b90b', 1);
    addLine(candles.map((c, i) => ({ time: time(c), value: bb.lo[i] })), '#16c784', 1);
    const e50 = emaArr(closes, 50);
    addLine(candles.map((c, i) => ({ time: time(c), value: e50[i] })), '#22d3ee', 2);
    const m5h = smaArr(highs, 5), m5l = smaArr(lows, 5);
    addLine(candles.map((c, i) => ({ time: time(c), value: m5h[i] })), '#f87171', 1, LightweightCharts.LineStyle.Dotted);
    addLine(candles.map((c, i) => ({ time: time(c), value: m5l[i] })), '#f0abfc', 1, LightweightCharts.LineStyle.Dotted);
  } else if (S.tab === 'f5') {
    const { highs: sh, lows: sl2 } = swings(candles, 2, 2);
    sh.slice(-3).forEach(x => addPriceLine(x.p, '#ea3943', ''));
    sl2.slice(-3).forEach(x => addPriceLine(x.p, '#16c784', ''));
  } else if (S.tab === 'ict') {
    if (sig) sig.levels.forEach(l => addPriceLine(l.v, l.c, l.k));
  }
}

// Efficient live update of the forming candle (no full re-render, preserves zoom)
function liveUpdateLastCandle() {
  const t = S.tickers[S.active];
  if (!t || !S.candles.length || !candleSeries) return;
  const last = S.candles[S.candles.length - 1];
  if (Math.abs(last.c - t.price) < 1e-12) return;
  last.c = t.price; last.h = Math.max(last.h, t.price); last.l = Math.min(last.l, t.price);
  const bar = { time: Math.floor(last.t / 1000), open: last.o, high: last.h, low: last.l, close: last.c };
  candleSeries.update(bar);
  volSeries.update({ time: bar.time, value: last.v, color: last.c >= last.o ? 'rgba(22,199,132,.4)' : 'rgba(234,57,67,.4)' });
}

/* ============================================================
   UI RENDER
   ============================================================ */
function renderInstruments() {
  const groups = { forex: '#forexList', crypto: '#cryptoList', gold: '#goldList' };
  Object.values(groups).forEach(el => { $(el).innerHTML = ''; });
  S.instruments.forEach(inst => {
    const sel = groups[inst.type];
    if (!sel) return;
    const el = document.createElement('div');
    el.className = 'sym-item' + (inst.id === S.active ? ' active' : '');
    el.innerHTML = `<span class="s-name">${esc(inst.label)}</span><span class="s-px" id="side-${inst.id}">—</span>`;
    el.onclick = () => { setActive(inst.id); };
    $(sel).appendChild(el);
  });
}

function renderTickerStrip() {
  const strip = $('#tickerStrip');
  strip.innerHTML = '';
  S.instruments.forEach(inst => {
    const t = S.tickers[inst.id];
    const el = document.createElement('div');
    el.className = 'ticker' + (inst.id === S.active ? ' active' : '');
    const chg = t ? t.change : 0;
    el.innerHTML = `
      <div class="tk-sym">${esc(inst.label)}</div>
      <div class="tk-price ${chg >= 0 ? 'up' : 'down'}">${t ? fmt(t.price, inst.dp) : '—'}</div>
      <div class="tk-chg ${chg >= 0 ? 'up' : 'down'}">${t ? (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%' : ''}</div>`;
    el.onclick = () => setActive(inst.id);
    strip.appendChild(el);
  });
}

function renderSidePrices() {
  S.instruments.forEach(inst => {
    const t = S.tickers[inst.id];
    const el = document.getElementById('side-' + inst.id);
    if (el && t) {
      el.textContent = fmt(t.price, inst.dp);
      el.className = 's-px ' + (t.change >= 0 ? 'up' : 'down');
    }
  });
}

function renderChartHead() {
  const inst = S.byId[S.active];
  $('#chartSymbol').textContent = inst.label;
  const t = S.tickers[S.active];
  if (t) {
    $('#chartPrice').textContent = fmt(t.price, inst.dp);
    const chg = $('#chartChange');
    chg.textContent = (t.change >= 0 ? '+' : '') + t.change.toFixed(2) + '%';
    chg.className = 'chg ' + (t.change >= 0 ? 'up' : 'down');
  }
}

function renderTF() {
  const sw = $('#tfSwitch');
  sw.innerHTML = '';
  TFS.forEach(tf => {
    const b = document.createElement('button');
    b.className = 'tf-btn' + (tf === S.tf ? ' active' : '');
    b.textContent = tf.toUpperCase();
    b.onclick = () => { S.tf = tf; S.needsFit = true; renderTF(); loadCandles(); };
    sw.appendChild(b);
  });
}

function renderTabs() {
  const tabs = $('#strategyTabs');
  tabs.innerHTML = '';
  TABS.forEach(t => {
    const b = document.createElement('button');
    b.className = 'tab' + (t.id === S.tab ? ' active' : '');
    b.textContent = t.name;
    b.onclick = () => { S.tab = t.id; S.alertInit = false; S.lastDir = null; renderTabs(); renderPanels(); renderChart(); };
    tabs.appendChild(b);
  });
}

function signalCard(label, val, sub, cls = '') {
  return `<div class="signal-card"><div class="sc-label">${label}</div><div class="sc-val ${cls}">${val}</div>${sub ? `<div class="sc-sub">${sub}</div>` : ''}</div>`;
}

function riskCalculator(sig) {
  if (!sig || sig.dir === 'WAIT' || sig.entry == null || sig.sl == null) return '';
  return `
  <div class="desc" style="margin-top:12px">
    <b>Kalkulator Risiko</b> (jarak SL = <span class="hint2">${fmt(Math.abs(sig.entry - sig.sl), S.dp)}</span>)
    <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;align-items:center">
      Saldo <input id="rk-bal" type="number" value="1000" style="width:90px;background:#0b0e14;border:1px solid #232b3d;color:#e6ebf5;padding:5px 8px;border-radius:6px">
      Risiko <input id="rk-risk" type="number" value="1" step="0.1" style="width:60px;background:#0b0e14;border:1px solid #232b3d;color:#e6ebf5;padding:5px 8px;border-radius:6px"> %
      <span id="rk-out" style="font-weight:700;color:#22d3ee"></span>
    </div>
    <div style="font-size:11px;color:#8b95ab;margin-top:6px">Ukuran posisi (unit) = (Saldo × Risiko%) ÷ jarak SL. Untuk forex 1 lot standar = 100.000 unit.</div>
  </div>`;
}

function bindRiskCalc(sig) {
  const bal = $('#rk-bal'), risk = $('#rk-risk'), out = $('#rk-out');
  if (!bal || !risk || !out) return;
  const calc = () => {
    const b = parseFloat(bal.value) || 0, r = (parseFloat(risk.value) || 0) / 100;
    const dist = Math.abs(sig.entry - sig.sl);
    const units = dist > 0 ? (b * r) / dist : 0;
    out.textContent = `${units.toFixed(0)} unit ≈ ${(units / 100000).toFixed(3)} lot`;
  };
  bal.oninput = calc; risk.oninput = calc; calc();
}

function computeSignal() {
  const C = S.candles;
  let sig = null;
  if (S.tab === 'ema135') sig = stratEMA135(C, S.dp);
  else if (S.tab === 'bbma') sig = stratBBMA(C, S.dp);
  else if (S.tab === 'f5') sig = stratF5(C, S.dp);
  else if (S.tab === 'ict') sig = stratICT(C, S.dp);
  else if (S.tab === 'fund') sig = stratFund();
  return sig;
}

function renderPanels() {
  const wrap = $('#strategyPanels');
  wrap.innerHTML = '';
  const sig = computeSignal();
  S.lastSignal = sig;

  const badge = sig.dir === 'BUY' ? '<span class="badge buy">▲ BUY</span>' : sig.dir === 'SELL' ? '<span class="badge sell">▼ SELL</span>' : '<span class="badge wait">● WAIT / NETRAL</span>';

  let html = `<div class="panel active">
    <div class="signal-row">
      ${signalCard('Sinyal', badge, '', '')}
      ${signalCard('Entry', sig.entry != null ? fmt(sig.entry, S.dp) : '—', sig.entry != null ? 'harga saat sinyal' : 'menunggu konfirmasi')}
      ${signalCard('Stop Loss', sig.sl != null ? fmt(sig.sl, S.dp) : '—', sig.sl != null ? 'level SL' : '')}
      ${signalCard('Take Profit 1', sig.tp1 != null ? fmt(sig.tp1, S.dp) : '—', sig.rr1 != null ? 'R:R ' + sig.rr1 : '')}
      ${signalCard('Take Profit 2', sig.tp2 != null ? fmt(sig.tp2, S.dp) : '—', '')}
    </div>`;

  if (sig.trend) html += `<div class="desc" style="margin-bottom:10px">Trend saat ini: <b>${esc(sig.trend)}</b>${sig.extreme ? ' &nbsp;|&nbsp; <b class="hint2">' + esc(sig.extreme) + '</b>' : ''}</div>`;
  if (sig.pos) html += `<div class="desc" style="margin-bottom:10px">Posisi harga: <b>${esc(sig.pos)}</b> &nbsp;|&nbsp; ${esc(sig.bos)}</div>`;

  html += `<div class="desc">${sig.reason}</div>`;

  // levels
  if (sig.levels && sig.levels.length) {
    html += `<div class="legend-chips" style="margin-top:12px">`;
    sig.levels.forEach(l => { if (l.v != null) html += `<span class="chip"><i style="background:${l.c}"></i>${esc(l.k)}: <b>${fmt(l.v, S.dp)}</b></span>`; });
    html += `</div>`;
  }

  // strategy description
  html += `<div class="desc" style="margin-top:10px">${sig.desc}</div>`;

  // risk calculator
  html += riskCalculator(sig);

  html += `</div>`;
  wrap.innerHTML = html;
  if (sig && sig.dir !== 'WAIT') bindRiskCalc(sig);
}

function countdown(ms) {
  if (ms < 0) return '00:00:00';
  const d = Math.floor(ms / 86400e3), h = Math.floor(ms / 3600e3) % 24, m = Math.floor(ms / 60e3) % 60, s = Math.floor(ms / 1e3) % 60;
  const pad = n => String(n).padStart(2, '0');
  return (d > 0 ? d + 'd ' : '') + `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function wibTime(ts) {
  return new Date(ts).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false });
}
function wibDate(ts) {
  return new Date(ts).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short', day: '2-digit', month: 'short' });
}

function impactClass(im) { return im === 'High' ? 'high' : im === 'Medium' ? 'med' : 'low'; }
const FLAGS = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', AUD: '🇦🇺', NZD: '🇳🇿', CAD: '🇨🇦', CHF: '🇨🇭', CNY: '🇨🇳' };

function renderCalendar() {
  const list = $('#calendarList');
  const nextEl = $('#nextEvent');
  const now = Date.now();
  const upcoming = S.calendar.filter(e => e.ts > now).slice(0, 12);
  const nextHigh = upcoming.find(e => e.impact === 'High');
  const next = nextHigh || upcoming[0];
  if (next) {
    nextEl.innerHTML = `
      <div class="ne-title">${esc(next.title)} <i class="ic ${impactClass(next.impact)}"></i></div>
      <div class="ne-meta">${FLAGS[next.country] || '🌐'} ${esc(next.country)} · ${esc(wibDate(next.ts))} ${esc(wibTime(next.ts))} WIB · Forecast ${esc(next.forecast || '—')} · Sebelumnya ${esc(next.previous || '—')}</div>
      <div class="ne-count" id="nextCount">${countdown(next.ts - now)}</div>`;
  } else {
    nextEl.innerHTML = '<div class="ne-title">Tidak ada event mendatang</div>';
  }
  list.innerHTML = upcoming.map(e => `
    <div class="cal-item">
      <span class="c-flag">${FLAGS[e.country] || '🌐'} ${esc(e.country)}</span>
      <div class="c-body">
        <div class="c-title">${esc(e.title)}</div>
        <div class="c-time">${esc(wibDate(e.ts))} · ${esc(wibTime(e.ts))} WIB</div>
      </div>
      <i class="ic ${impactClass(e.impact)}"></i>
      <span class="c-cd">${countdown(e.ts - now)}</span>
    </div>`).join('');
}

function renderNews() {
  const list = $('#newsList');
  if (!S.news.length) { list.innerHTML = 'tidak ada berita'; return; }
  list.innerHTML = S.news.slice(0, 14).map(n => `
    <div class="news-item">
      <a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
      <div class="n-meta"><span>${esc(n.source)}</span><span>${timeAgo(n.date)}</span></div>
    </div>`).join('');
}
function timeAgo(dstr) {
  const t = new Date(dstr).getTime();
  if (isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'baru saja';
  if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  return Math.floor(s / 86400) + ' hari lalu';
}

function renderClock() {
  $('#clockWIB').textContent = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
  const h = new Date().getUTCHours();
  let sess = '', sub = '';
  if (h >= 21 || h < 6) { sess = 'Sydney / Tokyo'; sub = 'sepi–sedang'; }
  else if (h < 11) { sess = 'Tokyo + London'; sub = 'sedang'; }
  else if (h < 16) { sess = 'London + New York'; sub = 'RAMAI 🔥'; }
  else if (h < 21) { sess = 'New York'; sub = 'ramai'; }
  $('#sessionBadge').textContent = `Sesi: ${sess} (${sub})`;
  $('#sessionBadge').style.color = sub.includes('RAMAI') ? '#f0b90b' : '#8b95ab';
}

/* ============================================================
   ALERT ENGINE (sound + notification + toast + history)
   ============================================================ */
let audioCtx = null;
function beep(freq = 880, dur = 0.22, times = 3, gap = 0.12) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const start = audioCtx.currentTime + 0.01;
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      o.connect(g); g.connect(audioCtx.destination);
      const t = start + i * (dur + gap);
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    }
  } catch (e) { /* audio unavailable */ }
}

function notify(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'trading-signal' });
    }
  } catch (e) { /* notifications unavailable */ }
}

function showToast(sig, instLabel) {
  const stack = $('#toastStack');
  if (!stack) return;
  const up = sig.dir === 'BUY';
  const el = document.createElement('div');
  el.className = 'toast ' + (up ? 'buy' : 'sell');
  el.innerHTML = `
    <div class="t-head">${up ? '▲ BUY' : '▼ SELL'} · ${esc(instLabel)}
      <span class="t-close">×</span></div>
    <div class="t-body">Entry <b>${fmt(sig.entry, S.dp)}</b> · SL <b>${fmt(sig.sl, S.dp)}</b> · TP1 <b>${sig.tp1 != null ? fmt(sig.tp1, S.dp) : '—'}</b></div>`;
  el.onclick = () => setActive(S.active);
  el.querySelector('.t-close').onclick = e => { e.stopPropagation(); el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  stack.prepend(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, 8000);
}

function logAlert(sig, instLabel) {
  S.alertCount++;
  const b = $('#alertCount'); if (b) b.textContent = S.alertCount;
  const item = {
    dir: sig.dir, sym: instLabel, time: new Date(),
    text: `Entry ${fmt(sig.entry, S.dp)} · SL ${fmt(sig.sl, S.dp)} · TP1 ${sig.tp1 != null ? fmt(sig.tp1, S.dp) : '—'}`,
  };
  S.alerts.unshift(item); S.alerts = S.alerts.slice(0, 15);
  const log = $('#alertLog');
  if (!log) return;
  log.innerHTML = S.alerts.map(a => `
    <div class="alert-item ${a.dir === 'BUY' ? 'buy' : 'sell'}">
      <div class="a-top"><span>${a.dir === 'BUY' ? '▲ BUY' : '▼ SELL'}</span><span class="a-sym">${esc(a.sym)}</span></div>
      <div class="a-desc">${esc(a.text)}</div>
      <div class="a-time">${a.time.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })} WIB</div>
    </div>`).join('');
}

function fireAlert(sig) {
  const instLabel = S.byId[S.active].label;
  const tabName = TABS.find(t => t.id === S.tab).name;
  if (S.alertSettings.sound) {
    beep(sig.dir === 'BUY' ? 1046 : 523, 0.22, 3);
  }
  if (S.alertSettings.notif) {
    notify(`Sinyal ${sig.dir} · ${instLabel}`, `${tabName}\nEntry ${fmt(sig.entry, S.dp)} · SL ${fmt(sig.sl, S.dp)} · TP1 ${sig.tp1 != null ? fmt(sig.tp1, S.dp) : ''}`);
  }
  showToast(sig, instLabel);
  logAlert(sig, instLabel);
}

// Check signal transition on every realtime tick (5s)
function checkAlert() {
  if (!S.candles.length) return;
  const sig = computeSignal();
  if (sig.dir === 'WAIT' || sig.entry == null) {
    S.lastDir = sig.dir;
    S.alertInit = true;
    return;
  }
  if (!S.alertInit) { S.lastDir = sig.dir; S.alertInit = true; return; }
  if (sig.dir !== S.lastDir) fireAlert(sig);
  S.lastDir = sig.dir;
}

/* ============================================================
   DATA FLOW
   ============================================================ */
function setActive(id) {
  S.active = id;
  S.dp = S.byId[id].dp;
  S.needsFit = true;
  S.alertInit = false; S.lastDir = null;
  renderInstruments(); renderTickerStrip(); renderChartHead();
  closeMobileOverlays();
  loadCandles();
}

async function loadCandles() {
  // token: cegah respons lama menimpa data baru saat ganti timeframe dengan cepat
  const token = ++S.candleReq;
  try {
    const r = await fetch(`/api/candles?id=${S.active}&tf=${S.tf}`);
    const j = await r.json();
    if (token !== S.candleReq) return; // ada request lebih baru, abaikan
    if (j.candles) { S.candles = j.candles; renderPanels(); renderChart(); }
  } catch (e) { console.error('candles', e); }
}

async function loadTickers() {
  try {
    const r = await fetch('/api/tickers');
    const j = await r.json();
    j.data.forEach(t => { S.tickers[t.id] = t; });
    renderTickerStrip(); renderSidePrices(); renderChartHead();
    liveUpdateLastCandle();
    checkAlert();
    const st = $('#connStatus');
    st.classList.add('on'); st.innerHTML = '<span class="dot"></span> terhubung';
  } catch (e) {
    const st = $('#connStatus');
    st.classList.remove('on'); st.innerHTML = '<span class="dot"></span> terputus';
  }
}

async function loadCalendar() {
  try {
    const r = await fetch('/api/calendar');
    const j = await r.json();
    S.calendar = j.data;
    renderCalendar();
    if (S.tab === 'fund') renderPanels();
  } catch (e) { console.error('calendar', e); }
}

async function loadNews() {
  try {
    const r = await fetch('/api/news');
    const j = await r.json();
    S.news = j.data;
    renderNews();
  } catch (e) { console.error('news', e); }
}

function closeMobileOverlays() {
  document.body.classList.remove('view-symbols', 'view-info');
  const nav = $('#mobileNav');
  if (nav) nav.querySelectorAll('.mn-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'chart'));
}

function wireMobileNav() {
  const nav = $('#mobileNav');
  if (!nav) return;
  nav.querySelectorAll('.mn-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      nav.querySelectorAll('.mn-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.body.classList.toggle('view-symbols', view === 'symbols');
      document.body.classList.toggle('view-info', view === 'info');
    });
  });
}

function wireAlertControls() {  const snd = $('#soundToggle'), ntf = $('#notifToggle');
  const sync = () => {
    snd.classList.toggle('on', S.alertSettings.sound);
    ntf.classList.toggle('on', S.alertSettings.notif);
  };
  if (snd) snd.onclick = () => { S.alertSettings.sound = !S.alertSettings.sound; sync(); if (S.alertSettings.sound) beep(880, 0.15, 1); };
  if (ntf) ntf.onclick = async () => {
    if (!S.alertSettings.notif) {
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') S.alertSettings.notif = true;
      } catch (e) {}
    } else {
      S.alertSettings.notif = false;
    }
    sync();
    if (S.alertSettings.notif) notify('Notifikasi aktif', 'Anda akan menerima alert saat sinyal BUY/SELL muncul.');
  };
  sync();
}

async function init() {
  const r = await fetch('/api/instruments');
  const insts = await r.json();
  S.instruments = insts;
  S.byId = Object.fromEntries(insts.map(i => [i.id, i]));
  S.dp = S.byId[S.active].dp;
  renderInstruments(); renderTF(); renderTabs(); buildChart();
  wireAlertControls();
  wireMobileNav();
  await Promise.all([loadTickers(), loadCandles(), loadCalendar(), loadNews()]);
  renderClock();

  setInterval(renderClock, 1000);
  setInterval(() => { renderCalendar(); if (S.tab === 'fund') renderPanels(); }, 1000);
  // Interval polling dioptimalkan untuk hosting gratis (hemat kuota).
  // Harga masih terasa realtime (ticker 10 dtk), tapi konsumsi request jauh lebih kecil.
  setInterval(loadTickers, 10000);   // harga live tiap 10 detik
  setInterval(loadCandles, 60000);   // refresh candle tiap 60 detik
  setInterval(loadCalendar, 300000); // kalender ekonomi tiap 5 menit
  setInterval(loadNews, 600000);     // berita tiap 10 menit
}

init();
