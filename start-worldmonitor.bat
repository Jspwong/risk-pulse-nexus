@echo off
setlocal

cd /d "%~dp0"
title WorldMonitor One-Click Start

echo.
echo ========================================
echo   WorldMonitor - One-Click Start
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Please install Node.js, then run this file again.
  echo.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found in PATH.
  echo Please reinstall Node.js or fix PATH, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] package.json was not found.
  echo This file must be run from the WorldMonitor project folder.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [INFO] node_modules not found. Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
  echo.
)

set "WM_URL=http://127.0.0.1:3000"
echo [INFO] Starting WorldMonitor dev server...
echo [INFO] Browser will open once when the server is ready: %WM_URL%
echo [INFO] Keep this window open while using the app.
echo.

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='%WM_URL%'; for ($i=0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -ge 200) { Start-Process $url; exit 0 } } catch { Start-Sleep -Milliseconds 500 } }"

call npm.cmd run dev -- --host 127.0.0.1 --port 3000

echo.
echo [INFO] WorldMonitor dev server stopped.
pause
