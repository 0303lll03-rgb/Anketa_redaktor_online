@echo off
setlocal
cd /d "%~dp0"
set "PORT=8788"
set "FOUND_PID="

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set "FOUND_PID=%%P"
)

if defined FOUND_PID (
  echo.
  echo CRM proxy port %PORT% is already busy.
  echo PID: %FOUND_PID%
  echo.
  echo Check it with:
  echo   netstat -ano ^| findstr :%PORT%
  echo   tasklist /FI "PID eq %FOUND_PID%"
  echo.
  echo Stop it with:
  echo   taskkill /PID %FOUND_PID% /F
  echo.
  pause
  exit /b 1
)

start "Anketa CRM proxy" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0crm-proxy.ps1" -Port %PORT%
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/index.html"
