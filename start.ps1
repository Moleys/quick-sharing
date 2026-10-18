<#
.SYNOPSIS
  Quick Share — khởi động server và (tuỳ chọn) Cloudflare Tunnel để có link online.

.EXAMPLE
  .\start.ps1              # port 3000 + tạo tunnel
  .\start.ps1 -Port 8080   # dùng port khác
  .\start.ps1 -NoTunnel    # chỉ chạy local / mạng LAN
#>
param(
  [int]$Port = 3000,
  [switch]$NoTunnel
)

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot

Write-Host ""
Write-Host "  ⚡ Quick Share" -ForegroundColor Cyan
Write-Host ""

# --- Kiểm tra Node.js ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  ✗ Chưa cài Node.js. Tải về tại: https://nodejs.org" -ForegroundColor Red
  exit 1
}

# --- 1) Khởi động server ---
$node = Start-Process -FilePath "node" `
  -ArgumentList @("`"$dir\server.js`"", "$Port") `
  -WorkingDirectory $dir -WindowStyle Hidden -PassThru

$up = $false
$pingUrl = "http://127.0.0.1:$Port/api/ping"
foreach ($i in 1..40) {
  Start-Sleep -Milliseconds 300
  # Dùng curl.exe (ổn định trên mọi máy Windows 10+), fallback sang Invoke-WebRequest
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    $null = curl.exe -s --max-time 2 $pingUrl 2>$null
    if ($LASTEXITCODE -eq 0) { $up = $true; break }
  }
  else {
    try {
      Invoke-WebRequest -UseBasicParsing $pingUrl -TimeoutSec 2 | Out-Null
      $up = $true; break
    } catch { }
  }
}
if (-not $up) {
  Write-Host "  ✗ Không khởi động được server (port $Port có thể đang bị chiếm)." -ForegroundColor Red
  Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "  ✓ Server : http://localhost:$Port" -ForegroundColor Green
Start-Process "http://localhost:$Port"

# --- 2) Cloudflare Tunnel (link online) ---
$cf = $null
$tunnelUrl = $null

if ($NoTunnel) {
  Write-Host "  - Bỏ qua tunnel (-NoTunnel). Trang chỉ truy cập được trong mạng LAN." -ForegroundColor Yellow
}
elseif (-not (Test-Path (Join-Path $dir "cloudflared.exe")) -and -not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host "  ✗ Không tìm thấy cloudflared — chưa có link online." -ForegroundColor Yellow
  Write-Host "    Tải cloudflared.exe về thư mục project, hoặc cài:" -ForegroundColor Yellow
  Write-Host "    winget install --id Cloudflare.cloudflared" -ForegroundColor Yellow
  Write-Host "    Sau đó chạy lại start.ps1." -ForegroundColor Yellow
}
else {
  # Ưu tiên cloudflared.exe nằm ngay trong project, fallback ra PATH
  $cfExe = Join-Path $dir "cloudflared.exe"
  if (-not (Test-Path $cfExe)) { $cfExe = "cloudflared" }

  Write-Host "  - Đang tạo Cloudflare Tunnel (link tạm, miễn phí, không cần tài khoản)..." -ForegroundColor Cyan
  $outLog = Join-Path $env:TEMP "quick-sharing-cf-out.log"
  $errLog = Join-Path $env:TEMP "quick-sharing-cf-err.log"
  Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue

  $cf = Start-Process -FilePath $cfExe `
    -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$Port") `
    -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

  # cloudflared in link ra log — đợi tối đa 60 giây
  # (mở file bằng FileShare.ReadWrite vì cloudflared đang giữ file để ghi)
  foreach ($i in 1..120) {
    Start-Sleep -Milliseconds 500
    $text = ""
    foreach ($f in @($outLog, $errLog)) {
      if (Test-Path $f) {
        try {
          $fs = [System.IO.File]::Open($f, 'Open', 'Read', [System.IO.FileShare]'ReadWrite, Delete')
          $sr = New-Object System.IO.StreamReader($fs)
          $text += $sr.ReadToEnd()
          $sr.Close()
        } catch { }
      }
    }
    if ($text -match 'https://[a-z0-9-]+\.trycloudflare\.com/?') { $tunnelUrl = $Matches[0]; break }
    if ($cf.HasExited) { break }
  }

  if ($tunnelUrl) {
    Write-Host "  ✓ Online : $tunnelUrl" -ForegroundColor Green
    try { Set-Clipboard $tunnelUrl; Write-Host "    (Đã copy link vào clipboard)" } catch { }
  }
  else {
    Write-Host "  ✗ Không lấy được link tunnel. Xem log: $errLog" -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "  Nhấn Ctrl+C để dừng." -ForegroundColor Cyan
Write-Host ""

try {
  if ($cf -and -not $cf.HasExited) { Wait-Process -Id $cf.Id }
  else { Wait-Process -Id $node.Id }
}
finally {
  foreach ($proc in @($cf, $node)) {
    if ($proc -and -not $proc.HasExited) {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
  }
}
