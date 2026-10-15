// 서버 헤드리스 테스트 공용 하네스 — 임시 데이터 폴더에 세션 픽스처(tokA/tokB)를 넣고 server.js를 자식 프로세스로 띄운 뒤 ws 클라이언트로 시나리오를 돌린다.
// 실제 계정 생성·비밀번호 입력 없음(테스트용 세션 토큰을 db.json 픽스처에 직접 기록). 사용: const H=require('./harness')(이름, 포트, env)
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const WS = require(path.join(REPO, 'server', 'node_modules', 'ws'));

module.exports = function (name, PORT, env = {}) {
  const DIR = path.join(__dirname, 'tmp-' + name);
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(path.join(DIR, 'data'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'server', 'server.js'), path.join(DIR, 'server.js'));
  fs.copyFileSync(path.join(REPO, 'server', 'cards.json'), path.join(DIR, 'cards.json'));
  fs.copyFileSync(path.join(REPO, 'server', 'oracle.js'), path.join(DIR, 'oracle.js'));   // 숨김 정보 2단계 오라클(서버가 require)
  const far = Date.now() + 30 * 24 * 3600 * 1000;
  fs.writeFileSync(path.join(DIR, 'data', 'db.json'), JSON.stringify({
    users: { t1: { id: 't1', salt: 'x', hash: 'x', decks: [], created: Date.now() }, t2: { id: 't2', salt: 'x', hash: 'x', decks: [], created: Date.now() } },
    sessions: { tokA: { userId: 't1', expires: far }, tokB: { userId: 't2', expires: far } } }));
  const cards = JSON.parse(fs.readFileSync(path.join(REPO, 'server', 'cards.json'), 'utf8'));
  const arr = Array.isArray(cards) ? cards : (cards.cards || Object.values(cards));
  const mainPool = arr.filter(c => ['Unit', 'Spell', 'Gear'].includes(c.type) && !(c.tags || []).length && c.super !== 'Champion' && c.super !== 'Token').map(c => c.n).slice(0, 14);
  const main = []; for (const n of mainPool) { for (let i = 0; i < 3; i++) main.push(n); } main.length = 40;
  const deck = (legendN, champN) => ({ name: 'T', legendN, champN, main: [...main], runes: [7, 7, 7, 7, 42, 42, 42, 42, 89, 89, 89, 89], bfs: [294, 297, 280] });
  const DA = deck(253, 27), DB = deck(265, 246);

  let srv = null;
  function startServer() {
    return new Promise((res, rej) => {
      srv = spawn(process.execPath, ['server.js', String(PORT)], { cwd: DIR, env: { ...process.env, NODE_PATH: path.join(REPO, 'server', 'node_modules'), RB_REJOIN_GRACE_MS: '3000', RB_VOID_IDLE_MS: '1500', RB_WEB_ROOT: path.join(REPO, 'client', 'web'), ...env } });
      let out = ''; srv.stdout.on('data', d => { out += d; if (/실행!/.test(out)) res(out); }); srv.stderr.on('data', d => { out += d; });
      srv.on('exit', c => { if (!/실행!/.test(out)) rej(new Error('server exit ' + c + '\n' + out)); });
      setTimeout(() => rej(new Error('server start timeout\n' + out)), 8000);
    });
  }
  function stopServer() { return new Promise(res => { if (!srv) return res(); srv.on('exit', () => res()); srv.kill(); }); }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function client(token) {
    const ws = new WS('ws://127.0.0.1:' + PORT); const inbox = []; const waiters = [];
    ws.on('message', d => { const m = JSON.parse(d); inbox.push(m); for (const w of [...waiters]) { if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); } } });
    const c = { ws, inbox, send: o => ws.send(JSON.stringify(o)),
      wait: (pred, ms = 3000) => new Promise((res, rej) => { const hit = inbox.find(pred); if (hit) return res(hit); const w = { pred, res }; waiters.push(w); setTimeout(() => { if (waiters.includes(w)) { waiters.splice(waiters.indexOf(w), 1); rej(new Error('wait timeout')); } }, ms); }),
      close: () => ws.close() };
    return new Promise((res, rej) => { ws.on('open', () => { c.send({ t: 'auth', token }); }); ws.on('error', rej); c.wait(m => m.t === 'authOk').then(() => res(c), rej); });
  }
  let pass = 0, fail = 0;
  const ok = (name, cond, info) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, info || ''); } };
  const done = async () => { await stopServer(); console.log(`${pass}/${pass + fail} 통과${fail ? ' ← 실패 ' + fail : ''}`); process.exit(fail ? 1 : 0); };
  const crash = async e => { console.log('CRASH', e.stack); await stopServer(); process.exit(1); };
  return { DIR, PORT, startServer, stopServer, sleep, client, ok, done, crash, DA, DB, fs, path };
};
