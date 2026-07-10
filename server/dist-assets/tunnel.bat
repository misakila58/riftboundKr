@echo off
chcp 65001 >nul
title Riftbound Tunnel (Cloudflare)
cd /d "%~dp0"
set PORT=%1
if "%PORT%"=="" set PORT=8321

rem Download cloudflared once (single exe, no account needed)
if not exist cloudflared.exe (
  echo Downloading cloudflared.exe ...
  powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
  if not exist cloudflared.exe (
    echo [ERROR] download failed. Download manually from:
    echo https://github.com/cloudflare/cloudflared/releases
    pause
    exit /b 1
  )
)

echo.
echo ============================================================
echo  Starting internet tunnel for http://localhost:%PORT%
echo  Look for the https://xxxx.trycloudflare.com URL below
echo  and share that URL with other players.
echo  (Keep start-server.bat running in another window!)
echo ============================================================
echo.
cloudflared.exe tunnel --url http://localhost:%PORT%
pause
