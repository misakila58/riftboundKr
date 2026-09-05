@echo off
rem Launcher only. All Korean UI lives in server-admin.ps1 so that cmd never has to
rem parse multibyte text (it shifts byte offsets and truncates the following lines).
setlocal
set "PS1=%~dp0server-admin.ps1"
if not exist "%PS1%" (
  echo Cannot find server-admin.ps1 next to this file.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
