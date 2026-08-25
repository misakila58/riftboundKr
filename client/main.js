// ══════════ Electron 메인 프로세스 ══════════
// 데스크톱 클라이언트 창을 열고 web/index.html(게임 UI)을 로드한다.
// 게임 로직·네트워크는 모두 렌더러(web/)에서 동작하며, 서버 주소는 앱 안에서 입력한다.
// 리플레이(.rbr) 파일 입출력만 메인 프로세스가 담당한다 (replay-store.js).
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// P2P 연결용: 크롬 기본값은 로컬 IP를 mDNS(.local) 이름으로 가려서 상대가 해석할 수 없다.
// 이걸 끄면 같은 공유기(집/카페)에 있는 두 사람이 인터넷을 돌지 않고 바로 붙고, 초대 코드도 짧아진다.
// 노출되는 건 사설 IP(192.168.x.x)뿐이며, 상대는 직접 대전을 수락한 친구다.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
const { registerReplayIpc } = require('./replay-store');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0e1420',
    title: '리프트바운드 시뮬레이터',
    icon: path.join(__dirname, 'web', 'assets', 'logo.png'),
    webPreferences: {
      contextIsolation: true,   // 렌더러와 Node 분리 (보안)
      nodeIntegration: false,   // 렌더러에서 Node API 사용 안 함
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false,
      backgroundThrottling: false, // 창 최소화 중에도 게임/튜토리얼 타이머 유지
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'web', 'index.html'));

  // 외부 링크는 기본 브라우저로. kakaoopen:은 카카오톡 앱 딥링크(오픈톡방 참여)라 함께 허용
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|kakaoopen):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  registerReplayIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
