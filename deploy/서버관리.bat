@echo off
chcp 65001 >nul
title 리프트바운드 서버 관리 (Vultr)

rem ══════════════════════════════════════════════════════════════════
rem  Vultr에 올려둔 게임 서버를 이 PC에서 관리한다.
rem  서버가 바뀌면 아래 두 줄만 고치면 된다.
rem ══════════════════════════════════════════════════════════════════
set "HOST=riftboundsimkr.duckdns.org"
set "USERNAME_SSH=root"
rem ══════════════════════════════════════════════════════════════════
rem  접속 키는 저장소 밖(내 계정 폴더)에 둔다 — 깃허브에 올라가면 안 되는 파일이다.
rem  7번 메뉴로 만들면 그 뒤로는 비밀번호를 묻지 않는다.
set "KEYPATH=%USERPROFILE%\.ssh\riftbound"

set "REPO=https://raw.githubusercontent.com/misakila58/riftboundKr/master/deploy"

where ssh >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [!] ssh 명령을 찾을 수 없습니다.
  echo       설정 ^> 시스템 ^> 선택적 기능 ^> "OpenSSH 클라이언트"를 설치하세요.
  echo.
  pause
  exit /b 1
)

:menu
rem 키가 있으면 자동으로 쓴다 (없으면 비밀번호를 묻는 평소 방식)
set "SSHOPT="
set "KEYSTATE=비밀번호 입력 필요  ^<- 7번으로 키를 등록하면 안 묻습니다"
if exist "%KEYPATH%" set SSHOPT=-i "%KEYPATH%"
if exist "%KEYPATH%" set "KEYSTATE=SSH 키 사용 중 (비밀번호 안 물음)"
call :readstatus
cls
echo.
echo   ================================================
echo     리프트바운드 서버 관리   %USERNAME_SSH%@%HOST%
echo     접속 방식: %KEYSTATE%
echo   ------------------------------------------------
echo     최근 24시간: %S_GAMES%
echo     서버 빌드  : %S_BUILD%
echo     내 로컬    : %L_STATE%
echo   ================================================
echo.
echo     1. 최신 버전 배포        (git 최신본으로 서버 갱신)
echo     2. 서버 상태 확인
echo     3. 최근 로그 보기
echo     4. 서버 재시작
echo     5. 익명 통계 리포트      (전체 게임 수 / 매치업 승률)
echo     6. SSH 직접 접속
echo     7. 비밀번호 없이 접속 설정 (SSH 키 등록 — 최초 1회)
echo     0. 종료
echo.
set "sel="
set /p "sel=  번호 (그냥 Enter = 1): "
if "%sel%"=="" set "sel=1"
if "%sel%"=="1" goto deploy
if "%sel%"=="2" goto status
if "%sel%"=="3" goto logs
if "%sel%"=="4" goto restart
if "%sel%"=="5" goto stats
if "%sel%"=="6" goto shell
if "%sel%"=="7" goto setupkey
if "%sel%"=="0" exit /b 0
goto menu

:deploy
echo.
echo   == 최신 버전 배포 중 (2~4분) ==
echo   깃허브에 push한 내용이 서버에 반영됩니다. 계정/덱 데이터는 그대로 보존됩니다.
echo.
ssh %SSHOPT% %USERNAME_SSH%@%HOST% "curl -fsSL %REPO%/update.sh | bash"
if errorlevel 1 (
  echo.
  echo   [!] 배포에 실패했습니다. 위 메시지를 확인하세요.
) else (
  echo.
  echo   배포 완료 — 웹 접속자는 새로고침만 하면 최신 버전입니다.
)
goto done

:status
echo.
echo   최근 24시간: %S_GAMES%
echo   서버 빌드  : %S_BUILD%
echo   내 로컬    : %L_STATE%
echo.
ssh %SSHOPT% %USERNAME_SSH%@%HOST% "systemctl status riftbound --no-pager -l | head -n 20; echo; echo '-- 디스크 --'; df -h / | tail -n 1"
goto done

:logs
echo.
ssh %SSHOPT% %USERNAME_SSH%@%HOST% "journalctl -u riftbound -n 60 --no-pager"
goto done

:restart
echo.
ssh %SSHOPT% %USERNAME_SSH%@%HOST% "systemctl restart riftbound && sleep 2 && systemctl is-active riftbound"
goto done

:stats
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo   [!] Node.js가 없어 리포트를 만들 수 없습니다.
  echo       브라우저에서 https://%HOST%/api/stats 를 열면 원본 숫자를 볼 수 있습니다.
  goto done
)
node "%~dp0..\tools\stats-report.js" "https://%HOST%"
goto done

:shell
echo.
echo   == 서버에 직접 접속합니다. 나올 때는 exit 입력 ==
echo.
ssh %SSHOPT% %USERNAME_SSH%@%HOST%
goto done

:setupkey
echo.
echo   == 비밀번호 없이 접속하도록 SSH 키를 등록합니다 ==
echo.
if exist "%KEYPATH%" (
  echo   키가 이미 있습니다: %KEYPATH%
) else (
  if not exist "%USERPROFILE%\.ssh" mkdir "%USERPROFILE%\.ssh"
  echo   [1/2] 이 PC에 키를 만듭니다...
  ssh-keygen -t ed25519 -f "%KEYPATH%" -N "" -C "riftbound-server" >nul
  if errorlevel 1 (
    echo   [!] 키 생성에 실패했습니다.
    goto done
  )
  echo         만들어짐: %KEYPATH%
)
echo.
echo   [2/2] 서버에 공개키를 등록합니다.
echo         이번 한 번만 root 비밀번호를 물어봅니다 — 여기에 직접 입력하세요.
echo.
type "%KEYPATH%.pub" | ssh %USERNAME_SSH%@%HOST% "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 등록완료"
if errorlevel 1 (
  echo.
  echo   [!] 등록에 실패했습니다. 비밀번호가 맞는지 확인하고 다시 시도하세요.
  goto done
)
echo.
echo   확인 중...
ssh -i "%KEYPATH%" -o BatchMode=yes %USERNAME_SSH%@%HOST% "echo 접속 성공"
if errorlevel 1 (
  echo   [!] 키로 접속되지 않습니다. 7번을 다시 실행해 보세요.
) else (
  echo.
  echo   이제부터 비밀번호를 묻지 않습니다.
  echo   키 파일은 %KEYPATH% 에 있습니다 — 남에게 주거나 깃허브에 올리지 마세요.
)
goto done

:done
echo.
pause
goto menu

rem ══════════════════════════════════════════════════════════════════
rem  서버 현황 읽기 — SSH 없이 HTTPS 한 번.
rem  서버는 KEY^|값 을 한 줄씩 돌려준다. -f 라서 옛 서버(404)면 아무것도 안 나오고
rem  기본 안내 문구가 그대로 남는다.
rem ══════════════════════════════════════════════════════════════════
:readstatus
set "S_GAMES=읽지 못함 - 아직 배포 전이거나 서버가 꺼져 있습니다"
set "S_BUILD=알 수 없음"
set "S_COMMIT="
for /f "usebackq tokens=1,* delims=|" %%A in (`curl -s -f --max-time 6 "https://%HOST%/api/status" 2^>nul`) do call :setfield "%%A" "%%B"

rem 내 저장소가 서버보다 몇 커밋 앞서 있나
set "L_STATE="
for /f "usebackq delims=" %%C in (`git -C "%~dp0.." rev-parse --short HEAD 2^>nul`) do set "L_STATE=%%C"
if not defined L_STATE set "L_STATE=git 저장소를 찾지 못함"
if not defined S_COMMIT goto :eof
for /f "usebackq delims=" %%N in (`git -C "%~dp0.." rev-list --count %S_COMMIT%..HEAD 2^>nul`) do call :setahead %%N
goto :eof

:setfield
if "%~1"=="GAMES"  set "S_GAMES=%~2"
if "%~1"=="BUILD"  set "S_BUILD=%~2"
if "%~1"=="COMMIT" set "S_COMMIT=%~2"
goto :eof

:setahead
if "%~1"=="0" set "L_STATE=%L_STATE% - 서버와 같음"
if not "%~1"=="0" set "L_STATE=%L_STATE% - 서버보다 %~1커밋 앞섬, 1번으로 배포하세요"
goto :eof
