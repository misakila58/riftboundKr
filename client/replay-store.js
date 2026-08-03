// ══════════ 리플레이 파일 보관함 (Electron 메인 프로세스) ══════════
// 렌더러는 sandbox라 fs에 접근할 수 없으므로 .rbr 파일 입출력은 전부 여기서 처리한다.
// 저장 위치는 문서 폴더 — 사용자가 파일을 직접 꺼내 다른 사람에게 전달할 수 있게 한다.
const { app, shell, ipcMain, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fsp = require('fs').promises;

const HEADER_PROBE = 64 * 1024;   // 목록용: 파일 앞부분(비압축 헤더)만 읽는다

function replayDir() {
  let base;
  try { base = app.getPath('documents'); } catch (e) { base = app.getPath('userData'); }
  return path.join(base, 'RiftboundSim', 'Replays');
}

async function ensureReplayDir() {
  const dir = replayDir();
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

// 경로 탈출·잘못된 파일명 차단: 파일명만 허용하고 확장자는 .rbr 고정
function replayPath(name) {
  const base = path.basename(String(name || ''));
  if (!base || base === '.' || base === '..') throw new Error('잘못된 파일 이름입니다');
  if (!/\.rbr$/i.test(base)) throw new Error('.rbr 파일만 사용할 수 있습니다');
  if (/[\\/:*?"<>|]/.test(base)) throw new Error('파일 이름에 사용할 수 없는 문자가 있습니다');
  return path.join(replayDir(), base);
}

// .rbr 헤더: "RBRP" + 포맷(1) + 압축(1) + 헤더길이(4, LE) + 헤더 JSON(비압축)
function parseReplayHeader(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 4) !== 'RBRP') return null;
  const hlen = buf.readUInt32LE(6);
  if (hlen <= 0 || 10 + hlen > buf.length) return null;
  try { return JSON.parse(buf.toString('utf8', 10, 10 + hlen)); } catch (e) { return null; }
}

async function listReplays() {
  const dir = await ensureReplayDir();
  let names;
  try { names = await fsp.readdir(dir); } catch (e) { return []; }
  const out = [];
  for (const n of names) {
    if (!/\.rbr$/i.test(n)) continue;
    const full = path.join(dir, n);
    let st;
    try { st = await fsp.stat(full); } catch (e) { continue; }
    if (!st.isFile()) continue;
    let header = null;
    try {
      const fh = await fsp.open(full, 'r');
      try {
        const buf = Buffer.alloc(Math.min(HEADER_PROBE, st.size));
        await fh.read(buf, 0, buf.length, 0);
        header = parseReplayHeader(buf);
      } finally { await fh.close(); }
    } catch (e) { /* 손상된 파일은 헤더 없이 목록에만 표시 */ }
    out.push({ id: n, size: st.size, mtime: st.mtimeMs, header });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function registerReplayIpc() {
  ipcMain.handle('replay:dir', () => ensureReplayDir());
  ipcMain.handle('replay:list', () => listReplays());

  ipcMain.handle('replay:save', async (_e, name, bytes) => {
    await ensureReplayDir();
    const full = replayPath(name);
    // 렌더러에서 Uint8Array / ArrayBuffer 어느 쪽으로 와도 받아들인다
    const buf = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
    await fsp.writeFile(full, buf);
    return { id: path.basename(full), path: full };
  });

  ipcMain.handle('replay:read', async (_e, name) => {
    const buf = await fsp.readFile(replayPath(name));
    return new Uint8Array(buf);
  });

  ipcMain.handle('replay:delete', async (_e, name) => {
    await fsp.unlink(replayPath(name));
    return true;
  });

  ipcMain.handle('replay:openDir', async () => {
    const dir = await ensureReplayDir();
    await shell.openPath(dir);
    return dir;
  });

  // 다른 사람에게 전달하기 위해 원하는 위치로 복사
  ipcMain.handle('replay:exportAs', async (e, name, suggested) => {
    const src = replayPath(name);
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: '리플레이 내보내기',
      defaultPath: path.basename(String(suggested || name)),
      filters: [{ name: '리프트바운드 리플레이', extensions: ['rbr'] }],
    };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { canceled: true };
    await fsp.copyFile(src, r.filePath);
    return { canceled: false, path: r.filePath };
  });
}

module.exports = { registerReplayIpc, replayDir, ensureReplayDir, replayPath, listReplays, parseReplayHeader };
