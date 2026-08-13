# Panduan Deploy Trading Dashboard ke Windows VPS

Cocok untuk Windows VPS (akses via Remote Desktop / RDP), termasuk VPS trading
yang dipakai untuk MT4/MT5. Aplikasi ini jalan di Node.js dan akan di-set
sebagai **Windows Service** supaya otomatis aktif + restart saat VPS reboot.

---

## Prasyarat
- Windows Server 2016/2019/2022 atau Windows 10/11
- Akses administrator
- IP publik untuk VPS

---

## Langkah 1 — Install Node.js

Pilih salah satu:

**A. Installer resmi (paling mudah):**
1. Download Node.js LTS: https://nodejs.org (pilih Windows Installer .msi 64-bit)
2. Jalankan installer → Next sampai selesai.

**B. Via PowerShell (jika `winget` tersedia):**
```powershell
winget install OpenJS.NodeJS.LTS
```

Verifikasi (buka Command Prompt):
```cmd
node --version
```
Harus muncul versi >= 18 (contoh: v20.x).

> Penting: setelah install, **restart RDP** dulu supaya PATH ter-update.

---

## Langkah 2 — Copy aplikasi ke VPS

1. Download/zip folder `trading-dashboard` dari komputer lokal.
2. Extract ke: `C:\trading-dashboard`

Struktur yang harus ada:
```
C:\trading-dashboard\
  server.js
  ecosystem.config.js
  public\
    index.html, app.js, style.css, lib\...
```

> Aplikasi TIDAK butuh `npm install` — memakai modul bawaan Node.js.

---

## Langkah 3 — Jalankan sebagai Windows Service (NSSM)

Cara paling andal di Windows = pakai **NSSM** (Non-Sucking Service Manager).

**Cara otomatis (disarankan):** jalankan script yang sudah disediakan:

```powershell
# buka PowerShell SEBAGAI ADMINISTRATOR, lalu:
cd C:\trading-dashboard
powershell -ExecutionPolicy Bypass -File deploy\setup-windows-service.ps1
```

**Cara manual** (jika mau paham langkahnya):
```cmd
:: 1. download NSSM (sekali saja)
::    buka https://nssm.cc/download -> ambil zip -> extract nssm.exe ke C:\nssm\nssm.exe

:: 2. install service
C:\nssm\nssm.exe install TradingDashboard "C:\Program Files\nodejs\node.exe" "C:\trading-dashboard\server.js"

:: 3. atur folder kerja & log
C:\nssm\nssm.exe set TradingDashboard AppDirectory "C:\trading-dashboard"
C:\nssm\nssm.exe set TradingDashboard AppStdout "C:\trading-dashboard\logs\out.log"
C:\nssm\nssm.exe set TradingDashboard AppStderr "C:\trading-dashboard\logs\err.log"
C:\nssm\nssm.exe set TradingDashboard AppRotateFiles 1
C:\nssm\nssm.exe set TradingDashboard Start SERVICE_AUTO_START

:: 4. jalankan
C:\nssm\nssm.exe start TradingDashboard
```

Verifikasi:
```cmd
C:\nssm\nssm.exe status TradingDashboard
:: -> harus "SERVICE_RUNNING"
```

Atau buka browser di VPS: `http://localhost:8080/api/health` → `{"ok":true,...}`

---

## Langkah 4 — Buka port di Windows Firewall

Aplikasi jalan di **port 8080**. Izinkan akses dari luar:

```powershell
# PowerShell sebagai ADMINISTRATOR
New-NetFirewallRule -DisplayName "Trading Dashboard" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

> Opsional: jika ingin akses langsung di port 80 (tanpa angka port di URL),
> ubah `PORT: 8080` di `ecosystem.config.js` jadi `80` lalu restart service.

---

## Langkah 5 — Arahkan domain (DNS)

Di panel domain Anda (Cloudflare, dll), buat record:

| Type | Name | Value |
|---|---|---|
| A | @ | IP_publik_VPS_Anda |
| A | www | IP_publik_VPS_Anda |

Test: `http://domainanda.com:8080` (sampai SSL terpasang).

---

## Langkah 6 — Pasang SSL gratis (HTTPS) — win-acme

Di Windows, tool Let's Encrypt yang direkomendasikan = **win-acme**:

1. Download: https://www.win-acme.com
2. Jalankan `wacs.exe` → pilih **N** (create new certificate)
3. Pilih binding/domain Anda → selesai, sertifikat terpasang otomatis.
4. win-acme akan auto-renewal sendiri (via Task Scheduler).

Setelah SSL aktif, akses via `https://domainanda.com`.

> Catatan: win-acme paling mudah jika aplikasi di port 80/443 lewat IIS.
> Cara paling simpel: ganti PORT ke 80 (Langkah 4) lalu minta win-acme
> pasang sertifikat untuk domain itu.

---

## Langkah 6b — AKSES PUBLIK TANPA BUKA PORT: Cloudflare Tunnel ⭐

Untuk VPS trading (misal WikiFX/Tencent Cloud) yang port masuknya dikunci
dan TIDAK bisa dibuka dari panel, gunakan **Cloudflare Tunnel** — membuat
koneksi KELUAR (selalu diizinkan) ke Cloudflare, tanpa perlu buka port masuk.

### A. Quick tunnel (tes cepat, URL acak)
```powershell
C:\nssm\cloudflared.exe tunnel --url http://localhost:8080
```
Muncul URL `https://xxx.trycloudflare.com` yang bisa dibuka dari HP.
(URL acak & berubah tiap restart.)

### B. Tunnel permanen + domain sendiri (disarankan)
1. Buat akun gratis di https://dash.cloudflare.com
2. Tambahkan domain Anda ke Cloudflare (ganti nameserver di registrar).
3. Login cloudflared di VPS:
   ```powershell
   C:\nssm\cloudflared.exe tunnel login
   ```
   → buka URL yang muncul di browser, pilih domain, authorize.
4. Buat tunnel:
   ```powershell
   C:\nssm\cloudflared.exe tunnel create trading-dashboard
   ```
5. Salin file config:
   ```powershell
   Copy-Item C:\trading-dashboard\deploy\cloudflared-config.yml C:\Users\Administrator\.cloudflared\config.yml
   ```
   lalu edit `config.yml` (ganti hostname ke domain Anda).
6. Arahkan DNS:
   ```powershell
   C:\nssm\cloudflared.exe tunnel route dns trading-dashboard dashboard.domainanda.com
   ```
7. Install sebagai service (auto-start):
   ```powershell
   C:\nssm\cloudflared.exe service install
   C:\nssm\cloudflared.exe service start
   ```
8. Buka `https://dashboard.domainanda.com` — permanen, SSL otomatis.

---

## Perintah operasional sehari-hari

```cmd
:: cek status
C:\nssm\nssm.exe status TradingDashboard

:: restart (setelah update file)
C:\nssm\nssm.exe restart TradingDashboard

:: stop / start
C:\nssm\nssm.exe stop TradingDashboard
C:\nssm\nssm.exe start TradingDashboard

:: lihat log
type C:\trading-dashboard\logs\out.log
```

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| `node` tidak dikenali | Restart RDP, atau pakai path penuh `"C:\Program Files\nodejs\node.exe"` |
| Service jalan tapi web tidak bisa diakses | Cek Firewall (Langkah 4), cek `localhost:8080` di VPS dulu |
| Service langsung stop | `type C:\trading-dashboard\logs\err.log` lihat error |
| Kalender kosong | Wajar — data dimuat dari ForexFactory, tunggu beberapa menit |
| Port 8080 dipakai aplikasi lain | Ganti `PORT` di `ecosystem.config.js`, restart service, update firewall |
