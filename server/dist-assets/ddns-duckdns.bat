@echo off
chcp 65001 >nul
title Riftbound DDNS (DuckDNS - Fixed Hostname)
cd /d "%~dp0"
setlocal enabledelayedexpansion

rem 포트포워딩 + DuckDNS 조합으로 고정 주소를 만드는 방식입니다.
rem 집 공인IP가 바뀌어도 이 스크립트가 DuckDNS 호스트를 현재 IP로 계속 갱신합니다.
rem 결과 주소(예): http://내이름.duckdns.org:8321  (껐다 켜도 동일)

if not exist ddns-config.txt (
  echo [설정 필요] ddns-config.txt 가 없습니다.
  echo.
  echo 1) https://www.duckdns.org 에서 로그인(구글/깃허브 등)
  echo 2) 원하는 서브도메인 생성 (예: my-riftbound)  -^> my-riftbound.duckdns.org
  echo 3) 페이지 상단의 token 값 복사
  echo 4) ddns-config.txt 를 열어 아래처럼 채우세요:
  echo.
  echo    DOMAIN=my-riftbound
  echo    TOKEN=여기에_duckdns_token
  echo.
  echo 그리고 공유기에서 외부 8321 -^> 이 PC 8321 (TCP) 포트포워딩을 설정하세요.
  (echo DOMAIN=& echo TOKEN=)> ddns-config.txt
  pause
  exit /b 1
)
for /f "usebackq tokens=1,* delims==" %%a in ("ddns-config.txt") do (
  if /i "%%a"=="DOMAIN" set DOMAIN=%%b
  if /i "%%a"=="TOKEN" set TOKEN=%%b
)
if "%DOMAIN%"=="" ( echo [오류] DOMAIN 을 입력하세요. & pause & exit /b 1 )
if "%TOKEN%"=="" ( echo [오류] TOKEN 을 입력하세요. & pause & exit /b 1 )

echo ============================================================
echo  DuckDNS 갱신 시작 (5분마다 현재 IP로 자동 갱신)
echo  접속 주소:  http://%DOMAIN%.duckdns.org:8321
echo  (start-server.bat 을 계속 실행해 두고, 공유기 포트포워딩 필요)
echo  ※ 평문 HTTP 입니다 - 접속자에게 "다른 곳과 다른 비밀번호 사용" 안내 권장
echo ============================================================
echo.
:loop
powershell -Command "try { $r = Invoke-WebRequest -UseBasicParsing ('https://www.duckdns.org/update?domains=%DOMAIN%&token=%TOKEN%&ip='); Write-Host ('[' + (Get-Date -Format HH:mm:ss) + '] DuckDNS 갱신: ' + $r.Content) } catch { Write-Host '갱신 실패 (인터넷 확인)' }"
timeout /t 300 /nobreak >nul
goto loop
