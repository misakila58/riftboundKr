@echo off
chcp 65001 >nul
title Riftbound Tunnel (ngrok - Fixed Address)
cd /d "%~dp0"
setlocal enabledelayedexpansion

rem ── 포트 (인자 > 기본 8321) ──
set PORT=%1
if "%PORT%"=="" set PORT=8321

rem ── 설정 파일 읽기 (ngrok-config.txt) ──
if not exist ngrok-config.txt (
  echo [설정 필요] ngrok-config.txt 파일이 없습니다.
  echo.
  echo 1) https://ngrok.com 에서 무료 회원가입
  echo 2) 대시보드 → Your Authtoken 복사
  echo 3) 대시보드 → Domains → "Create Domain" 으로 무료 고정 도메인 1개 생성
  echo    (예: my-riftbound.ngrok-free.app)
  echo 4) 이 폴더의 ngrok-config.txt 를 열어 아래처럼 채우세요:
  echo.
  echo    AUTHTOKEN=여기에_토큰
  echo    DOMAIN=여기에_고정도메인.ngrok-free.app
  echo.
  echo 샘플 파일을 생성해두었습니다. 값을 채운 뒤 다시 실행하세요.
  (echo AUTHTOKEN=& echo DOMAIN=)> ngrok-config.txt
  pause
  exit /b 1
)
for /f "usebackq tokens=1,* delims==" %%a in ("ngrok-config.txt") do (
  if /i "%%a"=="AUTHTOKEN" set AUTHTOKEN=%%b
  if /i "%%a"=="DOMAIN" set DOMAIN=%%b
)
if "%AUTHTOKEN%"=="" ( echo [오류] ngrok-config.txt 에 AUTHTOKEN 을 입력하세요. & pause & exit /b 1 )
if "%DOMAIN%"=="" ( echo [오류] ngrok-config.txt 에 DOMAIN 을 입력하세요. & pause & exit /b 1 )

rem ── ngrok.exe 없으면 자동 다운로드 ──
if not exist ngrok.exe (
  echo ngrok 다운로드 중...
  powershell -Command "Invoke-WebRequest -Uri 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip' -OutFile 'ngrok.zip'; Expand-Archive -Force 'ngrok.zip' '.'; Remove-Item 'ngrok.zip'"
  if not exist ngrok.exe (
    echo [오류] ngrok 다운로드 실패. https://ngrok.com/download 에서 수동 설치하세요.
    pause
    exit /b 1
  )
)

ngrok.exe config add-authtoken %AUTHTOKEN% >nul 2>&1

echo.
echo ============================================================
echo  고정 주소로 터널을 엽니다 (껐다 켜도 주소 동일)
echo  접속 주소:  https://%DOMAIN%
echo  이 주소를 친구들에게 공유하세요.
echo  (start-server.bat 을 다른 창에서 계속 실행해 두세요!)
echo ============================================================
echo.
ngrok.exe http --domain=%DOMAIN% %PORT%
pause
