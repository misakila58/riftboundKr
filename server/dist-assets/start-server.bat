@echo off
chcp 65001 >nul
title Riftbound Server
cd /d "%~dp0"

rem Allow through Windows Firewall (works only when run as admin; ignore failure)
netsh advfirewall firewall show rule name="Riftbound Server" >nul 2>&1
if errorlevel 1 (
  netsh advfirewall firewall add rule name="Riftbound Server" dir=in action=allow protocol=TCP localport=8321 >nul 2>&1
)

if exist riftbound-server.exe (
  riftbound-server.exe %1
) else (
  where node >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] riftbound-server.exe not found and Node.js is not installed.
    echo Install Node.js from https://nodejs.org or copy riftbound-server.exe here.
    pause
    exit /b 1
  )
  node riftbound-server.js %1
)
pause
