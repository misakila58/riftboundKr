// ══════════ Electron 메인 프로세스 ══════════
// 데스크톱 클라이언트 창을 열고 web/index.html(게임 UI)을 로드한다.
// 게임 로직·네트워크는 모두 렌더러(web/)에서 동작하며, 서버 주소는 앱 안에서 입력한다.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

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

  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
