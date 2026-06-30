@echo off
cd /d "%~dp0"
start "CRM editor server" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0crm-proxy.ps1"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8787/index.html"
