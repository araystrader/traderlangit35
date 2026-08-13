# Panduan Deploy Trading Dashboard ke VPS (domain sendiri)

Cocok untuk VPS dengan akses SSH/root (DigitalOcean, Vultr, IDCloudHost VPS, dsb).
Asumsi OS: Ubuntu / Debian. Semua langkah sekali jalan, hasilnya permanen (auto-restart saat reboot).

---

## 1. Upload aplikasi ke VPS

Dari komputer lokal Anda:

```bash
# zip dulu foldernya (tanpa node_modules)
cd /path/ke/proyek
zip -r trading-dashboard.zip trading-dashboard

# kirim ke VPS
scp trading-dashboard.zip root@IP_VPS:/var/www/
```

Di VPS:
```bash
cd /var/www
unzip trading-dashboard.zip
cd trading-dashboard
```

> Aplikasi ini TIDAK butuh `npm install` — server.js memakai modul bawaan Node.js.

---

## 2. Install Node.js (sekali saja)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node --version    # pastikan >= 18
```

---

## 3. Install PM2 + jalankan (auto-restart)

```bash
npm install -g pm2

cd /var/www/trading-dashboard
pm2 start ecosystem.config.js
pm2 save

# jalankan otomatis saat VPS reboot
pm2 startup
# -> copy & jalankan perintah yang ditampilkan PM2

pm2 status        # pastikan status "online"
```

Tes langsung (tanpa domain):
```bash
curl http://localhost:8080/api/health
# -> {"ok":true,"time":"..."}
```

---

## 4. Install Nginx (reverse proxy)

```bash
apt-get install -y nginx

# copy file config (sudah disediakan di folder deploy/)
cp deploy/nginx.conf /etc/nginx/sites-available/trading-dashboard

# GANTI domain di dalam file:
nano /etc/nginx/sites-available/trading-dashboard
#   cari "YOURDOMAIN.com" -> ganti dengan domain Anda

ln -s /etc/nginx/sites-available/trading-dashboard /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default   # hapus halaman default (opsional)

nginx -t               # test config, harus "syntax is ok"
systemctl reload nginx
```

---

## 5. Arahkan domain (DNS)

Di panel domain Anda (Cloudflare, Niagahoster, dsb), buat record:

| Type | Name | Value |
|---|---|---|
| A | @ | IP_VPS_Anda |
| A | www | IP_VPS_Anda |

Tunggu propagasi 5–30 menit.

---

## 6. Pasang SSL (HTTPS) gratis — Let's Encrypt

```bash
apt-get install -y certbot python3-certbot-nginx

certbot --nginx -d YOURDOMAIN.com -d www.YOURDOMAIN.com
# pilih opsi "2" (redirect HTTP -> HTTPS) saat ditanya

# auto-renewal otomatis sudah terpasang. Test:
certbot renew --dry-run
```

Selesai 🎉 — buka `https://YOURDOMAIN.com` di browser.

---

## 7. Keamanan dasar (disarankan)

```bash
# firewall: hanya izinkan SSH, HTTP, HTTPS
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable

# update otomatis
apt-get install -y unattended-upgrades
dpkg-reconfigure --priority=low unattended-upgrades
```

---

## Perintah operasional sehari-hari

```bash
pm2 status                # cek status
pm2 logs trading-dashboard  # lihat log realtime
pm2 restart trading-dashboard  # restart
pm2 stop trading-dashboard    # berhenti

# update aplikasi (setelah upload file baru)
cd /var/www/trading-dashboard
pm2 restart trading-dashboard
```

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| `pm2 status` = errored | `pm2 logs trading-dashboard` lihat error-nya |
| Port 8080 konflik | ganti `PORT` di `ecosystem.config.js` & `proxy_pass` di nginx |
| Kalender kosong | wajar — data dimuat dari ForexFactory; refresh beberapa menit |
| `nginx -t` gagal | cek salah ketik di path file config |
