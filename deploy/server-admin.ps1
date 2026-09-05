# ══════════════════════════════════════════════════════════════════
#  리프트바운드 서버 관리 (Vultr)
#  서버관리.bat이 이 스크립트를 실행한다.
#
#  배치 파일 대신 PowerShell을 쓰는 이유: cmd는 UTF-8 배치 파일을 바이트
#  오프셋으로 읽어, 한글이 든 줄 뒤의 줄이 앞부분부터 잘려 나가는 일이 있다.
#  (실제로 set 줄과 echo 줄이 잘리는 것을 확인했다)
# ══════════════════════════════════════════════════════════════════

# ── 설정: 서버가 바뀌면 이 세 줄만 고치면 된다 ──
$HostName   = 'riftboundsimkr.duckdns.org'
$SshUser    = 'root'
$ExportDir  = Join-Path $env:USERPROFILE 'Downloads\리프트바운드-통계'
# 승률 표에 넣을 최소 표본 수
$MinSample  = 3
# 접속 키는 저장소 밖(내 계정 폴더)에 둔다 — 깃허브에 올라가면 안 되는 파일이다
$KeyPath    = Join-Path $env:USERPROFILE '.ssh\riftbound'
$RepoRaw    = 'https://raw.githubusercontent.com/misakila58/riftboundKr/master/deploy'

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$ReportTool = Join-Path $RepoRoot 'tools\stats-report.js'

chcp 65001 > $null
$OutputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = '리프트바운드 서버 관리 (Vultr)'

function Test-Command($name) { $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

if (-not (Test-Command ssh)) {
  Write-Host ''
  Write-Host '  [!] ssh 명령을 찾을 수 없습니다.' -ForegroundColor Yellow
  Write-Host '      설정 > 시스템 > 선택적 기능 > "OpenSSH 클라이언트"를 설치하세요.'
  Write-Host ''
  Read-Host '  Enter를 누르면 닫힙니다'
  exit 1
}

# 키가 있으면 자동으로 쓴다 (없으면 비밀번호를 묻는 평소 방식)
function Get-SshArgs {
  if (Test-Path $KeyPath) { return @('-i', $KeyPath) }
  return @()
}

function Invoke-Remote([string]$command) {
  $sshArgs = @(Get-SshArgs) + @("$SshUser@$HostName")
  if ($command) { $sshArgs += $command }
  & ssh @sshArgs
}

# ── 서버 현황 (SSH 없이 HTTPS 한 번) ──
# 서버가 KEY|값 을 한 줄씩 돌려준다. 이 커밋이 배포되기 전 서버는 404를 준다.
function Get-ServerStatus {
  $s = [ordered]@{
    Games  = '읽지 못함 - 아직 배포 전이거나 서버가 꺼져 있습니다'
    Build  = '알 수 없음'
    Commit = $null
  }
  try {
    $raw = Invoke-RestMethod -Uri "https://$HostName/api/status" -TimeoutSec 6 -ErrorAction Stop
    foreach ($line in ($raw -split "`n")) {
      $i = $line.IndexOf('|')
      if ($i -lt 1) { continue }
      $key = $line.Substring(0, $i); $val = $line.Substring($i + 1).TrimEnd("`r")
      switch ($key) {
        'GAMES'  { $s.Games  = $val }
        'BUILD'  { $s.Build  = $val }
        'COMMIT' { $s.Commit = $val }
      }
    }
  } catch { }
  return $s
}

# 내 저장소가 서버보다 몇 커밋 앞서 있나
function Get-LocalState($serverCommit) {
  if (-not (Test-Command git)) { return 'git이 없어 비교할 수 없음' }
  $head = (& git -C $RepoRoot rev-parse --short HEAD 2>$null)
  if (-not $head) { return 'git 저장소를 찾지 못함' }
  if (-not $serverCommit) { return $head }
  $ahead = (& git -C $RepoRoot rev-list --count "$serverCommit..HEAD" 2>$null)
  if (-not $ahead) { return "$head - 서버 커밋을 이 저장소에서 찾지 못함" }
  if ($ahead -eq '0') { return "$head - 서버와 같음" }
  return "$head - 서버보다 $ahead커밋 앞섬, 1번으로 배포하세요"
}

function Pause-Return {
  Write-Host ''
  Read-Host '  Enter를 누르면 메뉴로 돌아갑니다' | Out-Null
}

function Need-Node {
  if (Test-Command node) { return $true }
  Write-Host '  [!] Node.js가 없어 통계를 처리할 수 없습니다.' -ForegroundColor Yellow
  Write-Host "      브라우저에서 https://$HostName/api/stats 를 열면 원본 숫자를 볼 수 있습니다."
  return $false
}

# ══════════════════════════ 각 기능 ══════════════════════════

function Do-Deploy {
  Write-Host ''
  Write-Host '  == 최신 버전 배포 중 (2~4분) ==' -ForegroundColor Cyan
  Write-Host '  깃허브에 push한 내용이 서버에 반영됩니다. 계정/덱 데이터는 그대로 보존됩니다.'
  Write-Host ''
  Invoke-Remote "curl -fsSL $RepoRaw/update.sh | bash"
  Write-Host ''
  if ($LASTEXITCODE -eq 0) {
    Write-Host '  배포 완료 - 웹 접속자는 새로고침만 하면 최신 버전입니다.' -ForegroundColor Green
  } else {
    Write-Host '  [!] 배포에 실패했습니다. 위 메시지를 확인하세요.' -ForegroundColor Yellow
  }
}

function Do-Status($st) {
  Write-Host ''
  Write-Host "  최근 24시간: $($st.Games)"
  Write-Host "  서버 빌드  : $($st.Build)"
  Write-Host ''
  Invoke-Remote "systemctl status riftbound --no-pager -l | head -n 20; echo; echo '-- 디스크 --'; df -h / | tail -n 1"
}

function Do-Logs    { Write-Host ''; Invoke-Remote 'journalctl -u riftbound -n 60 --no-pager' }
function Do-Restart { Write-Host ''; Invoke-Remote 'systemctl restart riftbound && sleep 2 && systemctl is-active riftbound' }

function Do-Stats {
  Write-Host ''
  if (-not (Need-Node)) { return }
  Write-Host '  기간을 고르세요.'
  Write-Host '    1. 전체 누적 (기본)     2. 최근 7일     3. 최근 30일'
  $per = Read-Host '  번호'
  $cmdArgs = @($ReportTool, "https://$HostName", '--min', "$MinSample")
  if ($per -eq '2') { $cmdArgs += @('--days', '7') }
  if ($per -eq '3') { $cmdArgs += @('--days', '30') }
  Write-Host ''
  & node @cmdArgs
}

function Do-Export {
  Write-Host ''
  if (-not (Need-Node)) { return }
  Write-Host '  == 통계 데이터를 파일로 저장합니다 ==' -ForegroundColor Cyan
  Write-Host "  저장 위치: $ExportDir"
  Write-Host ''
  & node $ReportTool "https://$HostName" '--min' '1' '--out' $ExportDir
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  [!] 저장에 실패했습니다. 서버가 켜져 있는지 확인하세요.' -ForegroundColor Yellow
    return
  }
  Write-Host ''
  Write-Host '  폴더를 엽니다...'
  Start-Process explorer.exe $ExportDir
}

function Do-Shell {
  Write-Host ''
  Write-Host '  == 서버에 직접 접속합니다. 나올 때는 exit 입력 ==' -ForegroundColor Cyan
  Write-Host ''
  Invoke-Remote $null
}

function Do-SetupKey {
  Write-Host ''
  Write-Host '  == 비밀번호 없이 접속하도록 SSH 키를 등록합니다 ==' -ForegroundColor Cyan
  Write-Host ''
  if (Test-Path $KeyPath) {
    Write-Host "  키가 이미 있습니다: $KeyPath"
  } else {
    $sshDir = Split-Path -Parent $KeyPath
    if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Path $sshDir -Force | Out-Null }
    Write-Host '  [1/2] 이 PC에 키를 만듭니다...'
    & ssh-keygen -t ed25519 -f $KeyPath -N '""' -C 'riftbound-server' | Out-Null
    if (-not (Test-Path $KeyPath)) {
      Write-Host '  [!] 키 생성에 실패했습니다.' -ForegroundColor Yellow
      return
    }
    Write-Host "        만들어짐: $KeyPath"
  }
  Write-Host ''
  Write-Host '  [2/2] 서버에 공개키를 등록합니다.'
  Write-Host '        이번 한 번만 root 비밀번호를 물어봅니다 - 여기에 직접 입력하세요.' -ForegroundColor Yellow
  Write-Host ''
  Get-Content "$KeyPath.pub" | & ssh "$SshUser@$HostName" 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 등록완료'
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  [!] 등록에 실패했습니다. 비밀번호가 맞는지 확인하고 다시 시도하세요.' -ForegroundColor Yellow
    return
  }
  Write-Host ''
  Write-Host '  확인 중...'
  & ssh -i $KeyPath -o BatchMode=yes "$SshUser@$HostName" 'echo 접속 성공'
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  [!] 키로 접속되지 않습니다. 8번을 다시 실행해 보세요.' -ForegroundColor Yellow
  } else {
    Write-Host ''
    Write-Host '  이제부터 비밀번호를 묻지 않습니다.' -ForegroundColor Green
    Write-Host "  키 파일은 $KeyPath 에 있습니다 - 남에게 주거나 깃허브에 올리지 마세요."
  }
}

# ══════════════════════════ 메뉴 ══════════════════════════

while ($true) {
  $keyState = if (Test-Path $KeyPath) { 'SSH 키 사용 중 (비밀번호 안 물음)' }
              else { '비밀번호 입력 필요  <- 8번으로 키를 등록하면 안 묻습니다' }
  $st = Get-ServerStatus
  $local = Get-LocalState $st.Commit

  Clear-Host
  Write-Host ''
  Write-Host '  ================================================'
  Write-Host "    리프트바운드 서버 관리   $SshUser@$HostName"
  Write-Host "    접속 방식: $keyState"
  Write-Host '  ------------------------------------------------'
  Write-Host "    최근 24시간: $($st.Games)"
  Write-Host "    서버 빌드  : $($st.Build)"
  Write-Host "    내 로컬    : $local"
  Write-Host '  ================================================'
  Write-Host ''
  Write-Host '    1. 최신 버전 배포        (git 최신본으로 서버 갱신)'
  Write-Host '    2. 서버 상태 확인'
  Write-Host '    3. 최근 로그 보기'
  Write-Host '    4. 서버 재시작'
  Write-Host '    5. 집계된 통계 보기      (게임 수 / 덱별·매치업 승률)'
  Write-Host '    6. 통계 데이터 내려받기  (엑셀용 CSV + 원본 JSON)'
  Write-Host '    7. SSH 직접 접속'
  Write-Host '    8. 비밀번호 없이 접속 설정 (SSH 키 등록 - 최초 1회)'
  Write-Host '    0. 종료'
  Write-Host ''
  $sel = Read-Host '  번호 (그냥 Enter = 1)'
  if ($sel -eq '') { $sel = '1' }

  switch ($sel) {
    '1' { Do-Deploy;   Pause-Return }
    '2' { Do-Status $st; Pause-Return }
    '3' { Do-Logs;     Pause-Return }
    '4' { Do-Restart;  Pause-Return }
    '5' { Do-Stats;    Pause-Return }
    '6' { Do-Export;   Pause-Return }
    '7' { Do-Shell;    Pause-Return }
    '8' { Do-SetupKey; Pause-Return }
    '0' { exit 0 }
    default { }
  }
}
