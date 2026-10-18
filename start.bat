@echo off
rem Quick Share — nháy đúp file này để chạy server + Cloudflare Tunnel
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
