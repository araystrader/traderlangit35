# Trading Dashboard — Forex · Crypto · Emas (Realtime)

Dashboard analisa trading **realtime** dan interaktif untuk **Forex, Crypto, dan Emas (Gold)**, lengkap dengan **harga Entry, Stop Loss (SL), dan Take Profit (TP)** untuk 5 metode trading.

## ✨ Fitur
- **Realtime**: harga live (polling 5 detik), candlestick chart, kalender ekonomi & berita otomatis ter-update.
- **13 instrumen**: 7 pasangan forex, 5 crypto (BTC/ETH/SOL/BNB/XRP), dan Emas (XAU/USD).
- **6 timeframe**: 1m, 5m, 15m, 1h, 4h, 1d.
- **5 metode trading** (tab, masing-masing dengan sinyal + Entry/SL/TP otomatis + kalkulator risiko):
  1. **EMA135 Zona** — EMA(135) pada High & Low membentuk zona; entry saat close breakout zona.
  2. **BBMA Oma Ally** — Bollinger Bands (20,2) + MA5/10 High/Low + EMA50; deteksi Extreme & Re-Entry (Line of Fire).
  3. **F5 Bystra Nora Karim** — Quasimodo (QMR/QMC) + SNRC (RBR/DBD) di zona Support (V)/Resistance (A).
  4. **ICT / SMC** — Market Structure (BOS), Order Block, Fair Value Gap, Liquidity, zona Premium/Discount.
  5. **Fundamental & News** — Kalender ekonomi dengan **hitungan mundur WIB (GMT+7)** + berita realtime.

## 🛠 Sumber Data (gratis, tanpa API key)
| Data | Sumber |
|---|---|
| Forex (candle + harga) | Yahoo Finance (`query1.finance.yahoo.com`) |
| Emas (candle + harga) | Yahoo Finance `GC=F` (COMEX futures) |
| Crypto (candle + harga) | OKX public API |
| Kalender Ekonomi | ForexFactory (mirror JSON + fallback HTML) |
| Berita | Cointelegraph + CoinDesk (RSS) |

> Catatan: Binance di-block untuk IP datacenter, sehingga dipakai OKX sebagai sumber crypto. Harga emas memakai kontrak futures COMEX (GC=F) agar konsisten antara chart dan ticker.

## 🚀 Menjalankan (lokal)
```bash
cd trading-dashboard
node server.js        # butuh Node.js >= 18
# buka http://localhost:8080
```
Tidak ada dependensi npm — server memakai modul bawaan Node.js (`http`, `fetch`).

## ☁️ Deploy gratis ke web

Aplikasi ini butuh backend (ambil data realtime), jadi backend-nya dikemas sebagai **serverless function**. Tersedia 2 opsi, keduanya **gratis**.

### ⭐ Opsi 1 — Cloudflare Pages (disarankan, paling hemat)
Gratis & bandwidth statis tanpa batas. **Kuota fungsi 100.000 request/hari** (~3 juta/bln) — jauh lebih besar dari Netlify.

**Cara A — via GitHub (paling mudah):**
1. Push folder `trading-dashboard` ke repo GitHub.
2. Buka https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → pilih repo.
3. Setting build (atau biarkan otomatis terdeteksi):
   - **Build command**: (kosong)
   - **Build output directory**: `public`
4. **Save and Deploy** → dapat URL `https://nama.pages.dev`.

**Cara B — via Wrangler CLI:**
```bash
npm install -g wrangler
wrangler login
cd trading-dashboard
wrangler pages deploy public   # otomatis ikut deploy folder functions/
```

### Opsi 2 — Netlify
Klik import dari Git (config `netlify.toml` sudah disiapkan), atau:
```bash
npm install -g netlify-cli
netlify login
cd trading-dashboard
netlify deploy --prod
# publish directory -> public
# functions directory -> netlify/functions
```
⚠️ Kuota ± 125.000 request/bln — polling tiap 5 dtk bisa cepat habis. Cloudflare jauh lebih lega.

### Struktur yang dipakai (satu backend, dua platform)
```
lib/api-core.js            # inti logika API (dipakai bersama)
functions/api/[[path]].js  # wrapper Cloudflare Pages Function
netlify/functions/api.js   # wrapper Netlify Function
netlify.toml               # config Netlify (redirect /api/*)
public/                    # frontend statis
```

### 💡 Menghemat kuota (opsional)
Perbesar interval polling di `public/app.js`:
- `setInterval(loadTickers, 5000)` → `10000` (10 dtk)
- `setInterval(loadCandles, 30000)` → `60000` (1 mnt)

## ⚠️ Disclaimer
Alat bantu analisa & edukasi. Bukan saran finansial. Trading forex/crypto/emas berisiko tinggi — gunakan manajemen risiko yang ketat (1–2% per trade).
