@echo off
setlocal

set "PORT=3000"
if not "%~1"=="" set "PORT=%~1"

cd /d "%~dp0"

echo.
echo [WorldMonitor] Preparing dev server on port %PORT%...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = [int]$env:PORT; " ^
  "$connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; " ^
  "if (-not $connections) { Write-Host ('[WorldMonitor] Port ' + $port + ' is free.'); exit 0 } " ^
  "foreach ($connection in $connections) { " ^
  "  $pidToStop = $connection.OwningProcess; " ^
  "  $process = Get-Process -Id $pidToStop -ErrorAction SilentlyContinue; " ^
  "  if ($process) { " ^
  "    Write-Host ('[WorldMonitor] Stopping process ' + $pidToStop + ' (' + $process.ProcessName + ') on port ' + $port + '...'); " ^
  "    Stop-Process -Id $pidToStop -Force; " ^
  "  } " ^
  "}"

if errorlevel 1 (
  echo [WorldMonitor] Failed to free port %PORT%.
  pause
  exit /b 1
)

echo.
echo [WorldMonitor] Starting Vite on http://127.0.0.1:%PORT%/
echo.

npm run dev -- --host 127.0.0.1 --port %PORT% --strictPort

if errorlevel 1 (
  echo.
  echo [WorldMonitor] Dev server exited with an error.
  pause
  exit /b 1
)

endlocal
