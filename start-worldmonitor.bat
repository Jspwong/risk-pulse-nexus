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
echo [INFO] Open this URL in your browser: %WM_URL%
echo [INFO] Keep this window open while using the app.
echo.

call npm.cmd run dev -- --host 127.0.0.1 --port 3000 --strictPort

echo.
echo [INFO] WorldMonitor dev server stopped.
pause
