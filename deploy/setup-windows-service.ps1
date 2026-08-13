# ============================================================
#  Setup Windows Service untuk Trading Dashboard (via NSSM)
#  Jalankan SEBAGAI ADMINISTRATOR:
#     powershell -ExecutionPolicy Bypass -File setup-windows-service.ps1
# ============================================================

$ErrorActionPreference = "Stop"

$AppDir   = "C:\trading-dashboard"
$NssmDir  = "C:\nssm"
$Service  = "TradingDashboard"
$Port     = 8080

Write-Host "=== Trading Dashboard - Setup Windows Service ===" -ForegroundColor Cyan

# 1. Cek Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "ERROR: Node.js tidak ditemukan." -ForegroundColor Red
    Write-Host "Install dulu dari https://nodejs.org (LTS), lalu restart RDP." -ForegroundColor Yellow
    exit 1
}
$nodePath = (Get-Command node).Source
Write-Host "[OK] Node.js terdeteksi: $nodePath" -ForegroundColor Green

# 2. Cek folder aplikasi
if (-not (Test-Path "$AppDir\server.js")) {
    Write-Host "ERROR: $AppDir\server.js tidak ditemukan." -ForegroundColor Red
    Write-Host "Extract folder trading-dashboard ke C:\trading-dashboard dulu." -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Aplikasi ditemukan di $AppDir" -ForegroundColor Green

# 3. Siapkan NSSM
$nssm = "$NssmDir\nssm.exe"
if (-not (Test-Path $nssm)) {
    Write-Host "Download NSSM..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $NssmDir | Out-Null
    $zip = "$env:TEMP\nssm.zip"
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath "$env:TEMP\nssm_extract" -Force
    $exe = Get-ChildItem "$env:TEMP\nssm_extract" -Recurse -Filter "nssm.exe" |
           Where-Object { $_.FullName -like "*win64*" } | Select-Object -First 1
    Copy-Item $exe.FullName $nssm
}
Write-Host "[OK] NSSM siap: $nssm" -ForegroundColor Green

# 4. Buat folder log
New-Item -ItemType Directory -Force -Path "$AppDir\logs" | Out-Null

# 5. Hentikan service lama jika ada
& $nssm stop $Service *> $null
Start-Sleep -Seconds 2

# 6. Install service
& $nssm install $Service $nodePath "$AppDir\server.js"
& $nssm set $Service AppDirectory $AppDir
& $nssm set $Service AppEnvironmentExtra "PORT=$Port"
& $nssm set $Service AppStdout "$AppDir\logs\out.log"
& $nssm set $Service AppStderr "$AppDir\logs\err.log"
& $nssm set $Service AppRotateFiles 1
& $nssm set $Service AppRotateBytes 10485760
& $nssm set $Service Start SERVICE_AUTO_START
& $nssm set $Service DisplayName "Trading Dashboard"
& $nssm set $Service Description "Realtime forex/crypto/gold analysis dashboard"

# 7. Jalankan
& $nssm start $Service
Start-Sleep -Seconds 3

$status = & $nssm status $Service
Write-Host ""
Write-Host "=== Status service: $status ===" -ForegroundColor Cyan

# 8. Buka firewall port
Write-Host "Membuka port $Port di firewall..." -ForegroundColor Yellow
New-NetFirewallRule -DisplayName "Trading Dashboard" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
Write-Host "[OK] Firewall port $Port dibuka." -ForegroundColor Green

# 9. Test lokal
try {
    $r = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 10
    Write-Host "[OK] Aplikasi merespons: $($r.Content)" -ForegroundColor Green
} catch {
    Write-Host "[WARNING] Belum bisa akses localhost:$Port - cek log:" -ForegroundColor Yellow
    Write-Host "  type $AppDir\logs\err.log" -ForegroundColor White
}

Write-Host ""
Write-Host "SELESAI. Akses dashboard: http://IP_VPS:$Port" -ForegroundColor Green
Write-Host "Selanjutnya: arahkan domain (A record -> IP VPS), lalu pasang SSL (win-acme)." -ForegroundColor Cyan
