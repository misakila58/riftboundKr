// ══════════ 리프트바운드 시뮬레이터 서버 (데스크톱 클라이언트용 · API+WS 전용) ══════════
// 데스크톱(Electron) 클라이언트가 접속하는 백엔드.
// 계정/덱 저장(REST) + 로비·게임 릴레이(WebSocket)만 담당하며 정적 파일은 서빙하지 않는다.
// 불특정 다수 공개 전제: 자격증명 보호 · DoS 완화 · 입력 검증 · CORS 허용.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const WebSocket = require('ws');

// ---------- 설정 ----------
const PORT = parseInt(process.argv[2], 10) || parseInt(process.env.PORT, 10) || 8321;
const IS_PKG = typeof process.pkg !== 'undefined';
const BASE = IS_PKG ? path.dirname(process.execPath) : __dirname;
const DATA_DIR = path.join(BASE, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');

const LIMITS = {
  MAX_DECKS: 20,
  MAX_USERS: 5000,
  MIN_PW: 8,
  MAX_PW: 128,
  BODY_BYTES: 64 * 1024,
  WS_PAYLOAD: 128 * 1024,
  TOKEN_TTL_MS: 30 * 24 * 3600 * 1000,  // 데스크톱 앱: 토큰 30일
  MAX_ROOMS: 500,
  MAX_DECK_NAME: 30,
  MAX_ROOM_NAME: 24,
  MAX_CHAT: 200,
  AUTH_WINDOW_MS: 15 * 60 * 1000,
  AUTH_MAX: 20,
  REG_WINDOW_MS: 60 * 60 * 1000,
  REG_MAX: 5,
  WS_MSG_WINDOW_MS: 10 * 1000,
  WS_MSG_MAX: 120,
  CONCURRENT_HASH: 4,
  AUTH_DEADLINE_MS: 15000,
};

// ---------- 카드 검증 데이터 로드 ----------
const VALID = { legend: new Set(), champ: new Set(), main: new Set(), rune: new Set(), bf: new Set(), size: 0 };
(function loadCards() {
  const candidates = [path.join(BASE, 'cards.json'), path.join(__dirname, 'cards.json')];
  for (const f of candidates) {
    try {
      const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const c of arr) {
        if (c.type === 'Legend') VALID.legend.add(c.n);
        else if (c.type === 'Rune') VALID.rune.add(c.n);
        else if (c.type === 'Battlefield') VALID.bf.add(c.n);
        else if (['Unit', 'Spell', 'Gear'].includes(c.type) && c.super !== 'Token') {
          VALID.main.add(c.n);
          if (c.type === 'Unit' && c.super === 'Champion') VALID.champ.add(c.n);
        }
      }
      VALID.size = arr.length;
      console.log(`카드 검증 데이터 로드: ${arr.length}장`);
      return;
    } catch (e) {}
  }
  console.warn('경고: cards.json 로드 실패 — 덱 카드 ID 검증이 완화됩니다.');
})();

// ---------- DB (원자적 저장) ----------
let db = { users: {} };
try {
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (raw && typeof raw === 'object' && raw.users) db = raw;
} catch (e) {}
let saveTimer = null, saving = false;
function saveDB() { clearTimeout(saveTimer); saveTimer = setTimeout(doSave, 300); }
function doSave() {
  if (saving) { saveDB(); return; }
  saving = true;
  const tmp = DB_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), err => {
    if (!err) { try { fs.renameSync(tmp, DB_FILE); } catch (e) {} }
    saving = false;
  });
}
const userCount = () => Object.keys(db.users).length;

// ---------- 인증 ----------
const sessions = new Map();
let hashInFlight = 0;
function scryptAsync(pw, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, dk) => {
      err ? reject(err) : resolve(dk.toString('hex'));
    });
  });
}
async function hashPw(pw, salt) {
  if (hashInFlight >= LIMITS.CONCURRENT_HASH) throw new Error('BUSY');
  hashInFlight++;
  try { return await scryptAsync(pw, salt); } finally { hashInFlight--; }
}
function makeToken() { return crypto.randomBytes(32).toString('hex'); }
function issueToken(userId) {
  const token = makeToken();
  sessions.set(token, { userId, expires: Date.now() + LIMITS.TOKEN_TTL_MS });
  return token;
}
function userFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  return db.users[s.userId] || null;
}
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t);
}, 3600 * 1000).unref?.();

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), 'hex'), bb = Buffer.from(String(b), 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}
const DUMMY_SALT = crypto.randomBytes(12).toString('hex');
let DUMMY_HASH = '';
scryptAsync('dummy-password', DUMMY_SALT).then(h => DUMMY_HASH = h);

// ---------- Rate limit ----------
const rl = new Map();
function rateHit(key, windowMs, max) {
  const now = Date.now();
  let arr = rl.get(key);
  if (!arr) { arr = []; rl.set(key, arr); }
  while (arr.length && arr[0] <= now - windowMs) arr.shift();
  if (arr.length >= max) return false;
  arr.push(now);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of rl) {
    while (arr.length && arr[0] <= now - LIMITS.AUTH_WINDOW_MS) arr.shift();
    if (!arr.length) rl.delete(k);
  }
}, 10 * 60 * 1000).unref?.();
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// ---------- 유틸 ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...CORS,
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '', over = false;
    req.on('data', c => {
      if (over) return;
      buf += c;
      if (buf.length > LIMITS.BODY_BYTES) { over = true; reject(new Error('TOO_LARGE')); req.destroy(); }
    });
    req.on('end', () => { if (over) return; try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(new Error('BAD_JSON')); } });
    req.on('error', () => reject(new Error('REQ_ERROR')));
  });
}
const ID_RE = /^[a-zA-Z0-9가-힣_]{2,16}$/;
function validDeck(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return '덱 형식 오류';
  if (typeof d.name !== 'string') return '덱 이름 오류';
  const name = d.name.trim();
  if (!name || name.length > LIMITS.MAX_DECK_NAME) return `덱 이름은 1~${LIMITS.MAX_DECK_NAME}자`;
  if (!Number.isInteger(d.legendN)) return '전설이 없습니다';
  if (VALID.legend.size && !VALID.legend.has(d.legendN)) return '유효하지 않은 전설';
  if (!Number.isInteger(d.champN)) return '챔피언이 없습니다';
  if (VALID.champ.size && !VALID.champ.has(d.champN)) return '유효하지 않은 챔피언';
  if (!Array.isArray(d.main) || d.main.length !== 40) return '메인 덱은 40장이어야 합니다';
  if (!Array.isArray(d.runes) || d.runes.length !== 12) return '룬은 12개여야 합니다';
  if (!Array.isArray(d.bfs) || d.bfs.length !== 3) return '전장은 3개여야 합니다';
  const counts = {};
  for (const n of d.main) {
    if (!Number.isInteger(n)) return '메인 덱 카드 오류';
    if (VALID.main.size && !VALID.main.has(n)) return '유효하지 않은 카드가 포함됨';
    counts[n] = (counts[n] || 0) + 1;
    if (counts[n] > 3) return '같은 카드는 3장까지입니다';
  }
  for (const n of d.runes) if (!Number.isInteger(n) || (VALID.rune.size && !VALID.rune.has(n))) return '유효하지 않은 룬이 포함됨';
  for (const n of d.bfs) if (!Number.isInteger(n) || (VALID.bf.size && !VALID.bf.has(n))) return '유효하지 않은 전장이 포함됨';
  return null;
}
function sanitizeDeck(d) {
  return { name: d.name.trim().slice(0, LIMITS.MAX_DECK_NAME), legendN: d.legendN, champN: d.champN,
           main: d.main.map(Number), runes: d.runes.map(Number), bfs: d.bfs.map(Number) };
}

// ---------- HTTP (API 전용) ----------
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
  const p = url.pathname;

  // CORS 프리플라이트
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  // 헬스체크 (클라이언트가 서버 주소 유효성 확인용)
  if (p === '/api/health' && req.method === 'GET')
    return json(res, 200, { ok: true, name: 'riftbound-sim', version: 2 });

  // 루트: 사람이 브라우저로 들어왔을 때 안내
  if (p === '/' || p === '') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...CORS });
    return res.end('리프트바운드 시뮬레이터 서버가 실행 중입니다.\n데스크톱 클라이언트 프로그램에서 이 주소를 입력해 접속하세요.');
  }
  if (!p.startsWith('/api/')) { res.writeHead(404, CORS); return res.end(); }

  const ip = clientIp(req);
  try {
    if (p === '/api/register' && req.method === 'POST') {
      if (!rateHit('auth:' + ip, LIMITS.AUTH_WINDOW_MS, LIMITS.AUTH_MAX) ||
          !rateHit('reg:' + ip, LIMITS.REG_WINDOW_MS, LIMITS.REG_MAX))
        return json(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' });
      const { id, pw } = await readBody(req);
      if (typeof id !== 'string' || !ID_RE.test(id)) return json(res, 400, { error: '아이디는 2~16자 (한글/영문/숫자/_)' });
      if (typeof pw !== 'string' || pw.length < LIMITS.MIN_PW || pw.length > LIMITS.MAX_PW)
        return json(res, 400, { error: `비밀번호는 ${LIMITS.MIN_PW}~${LIMITS.MAX_PW}자` });
      if (userCount() >= LIMITS.MAX_USERS) return json(res, 503, { error: '서버 계정 수가 가득 찼습니다.' });
      if (db.users[id]) return json(res, 409, { error: '이미 존재하는 아이디입니다' });
      const salt = crypto.randomBytes(16).toString('hex');
      let hash;
      try { hash = await hashPw(pw, salt); } catch (e) { return json(res, 503, { error: '서버가 혼잡합니다. 잠시 후 다시 시도하세요.' }); }
      if (db.users[id]) return json(res, 409, { error: '이미 존재하는 아이디입니다' });
      db.users[id] = { id, salt, hash, decks: [], created: Date.now() };
      saveDB();
      return json(res, 200, { token: issueToken(id), id });
    }
    if (p === '/api/login' && req.method === 'POST') {
      if (!rateHit('auth:' + ip, LIMITS.AUTH_WINDOW_MS, LIMITS.AUTH_MAX))
        return json(res, 429, { error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요.' });
      const { id, pw } = await readBody(req);
      const u = (typeof id === 'string') ? db.users[id] : null;
      let ok = false;
      try {
        const salt = u ? u.salt : DUMMY_SALT;
        const h = await hashPw(typeof pw === 'string' ? pw : '', salt);
        ok = !!u && safeEqualHex(h, u.hash);
      } catch (e) { return json(res, 503, { error: '서버가 혼잡합니다. 잠시 후 다시 시도하세요.' }); }
      if (!ok) return json(res, 401, { error: '아이디 또는 비밀번호가 올바르지 않습니다' });
      return json(res, 200, { token: issueToken(id), id });
    }

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
    const user = userFromToken(token);
    if (!user) return json(res, 401, { error: '로그인이 필요합니다' });

    if (p === '/api/decks' && req.method === 'GET')
      return json(res, 200, { decks: user.decks });
    if (p === '/api/decks' && req.method === 'POST') {
      const { deck, index } = await readBody(req);
      const err = validDeck(deck);
      if (err) return json(res, 400, { error: err });
      const clean = sanitizeDeck(deck);
      if (index !== undefined && index !== null) {
        if (!Number.isInteger(index) || !user.decks[index]) return json(res, 404, { error: '덱이 없습니다' });
        user.decks[index] = clean;
      } else {
        if (user.decks.length >= LIMITS.MAX_DECKS) return json(res, 400, { error: `덱은 최대 ${LIMITS.MAX_DECKS}개까지 저장할 수 있습니다` });
        user.decks.push(clean);
      }
      saveDB();
      return json(res, 200, { decks: user.decks });
    }
    if (p.startsWith('/api/decks/') && req.method === 'DELETE') {
      const idx = Number(p.split('/').pop());
      if (!Number.isInteger(idx) || !user.decks[idx]) return json(res, 404, { error: '덱이 없습니다' });
      user.decks.splice(idx, 1);
      saveDB();
      return json(res, 200, { decks: user.decks });
    }
    return json(res, 404, { error: 'API 없음' });
  } catch (e) {
    const msg = e.message === 'TOO_LARGE' ? '요청이 너무 큽니다'
              : e.message === 'BAD_JSON' ? '잘못된 요청 형식' : '서버 오류';
    const code = (e.message === 'TOO_LARGE' || e.message === 'BAD_JSON') ? 400 : 500;
    return json(res, code, { error: msg });
  }
});

// ---------- WebSocket: 로비 & 게임 릴레이 ----------
const wss = new WebSocket.Server({ server, maxPayload: LIMITS.WS_PAYLOAD });
const rooms = new Map();
let roomSeq = 1;
function wsSend(ws, obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function roomInfo(r) { return { id: r.id, name: r.name, host: r.players[0]?.id, count: r.players.length, started: r.started }; }
function broadcastLobby() {
  const list = [...rooms.values()].filter(r => !r.started).map(roomInfo);
  wss.clients.forEach(c => { if (c._authed && !c._room) wsSend(c, { t: 'rooms', rooms: list }); });
}
function leaveRoom(ws, notify = true) {
  const r = ws._room; if (!r) return;
  ws._room = null;
  const i = r.players.findIndex(pl => pl.ws === ws);
  if (i >= 0) r.players.splice(i, 1);
  if (r.players.length === 0) rooms.delete(r.id);
  else if (notify) r.players.forEach(pl => wsSend(pl.ws, { t: 'opponentLeft' }));
  if (r.players.length === 0 || !r.started) broadcastLobby();
}

wss.on('connection', (ws, req) => {
  ws._authed = false; ws._room = null; ws._ip = clientIp(req);
  ws._authTimer = setTimeout(() => { if (!ws._authed) ws.close(); }, LIMITS.AUTH_DEADLINE_MS);
  ws.on('message', raw => {
    if (!rateHit('ws:' + ws._ip, LIMITS.WS_MSG_WINDOW_MS, LIMITS.WS_MSG_MAX)) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'auth') {
      const user = userFromToken(m.token);
      if (!user) return wsSend(ws, { t: 'authFail' });
      clearTimeout(ws._authTimer);
      wss.clients.forEach(c => { if (c !== ws && c._userId === user.id) { leaveRoom(c); c.close(); } });
      ws._authed = true; ws._userId = user.id;
      wsSend(ws, { t: 'authOk', id: user.id });
      broadcastLobby();
      return;
    }
    if (!ws._authed) return;

    switch (m.t) {
      case 'listRooms':
        wsSend(ws, { t: 'rooms', rooms: [...rooms.values()].filter(r => !r.started).map(roomInfo) });
        break;
      case 'createRoom': {
        if (ws._room) return;
        if (rooms.size >= LIMITS.MAX_ROOMS) return wsSend(ws, { t: 'err', msg: '서버 방이 가득 찼습니다.' });
        const u = db.users[ws._userId];
        const deck = u && u.decks[m.deckIdx];
        if (!deck) return wsSend(ws, { t: 'err', msg: '덱을 선택하세요' });
        const nm = (typeof m.name === 'string' && m.name.trim()) ? m.name.trim().slice(0, LIMITS.MAX_ROOM_NAME) : (ws._userId + '의 방');
        const r = { id: 'r' + (roomSeq++), name: nm, players: [], started: false, seq: 0 };
        rooms.set(r.id, r);
        r.players.push({ ws, id: ws._userId, deck, seat: 0 });
        ws._room = r;
        wsSend(ws, { t: 'roomCreated', room: roomInfo(r) });
        broadcastLobby();
        break;
      }
      case 'joinRoom': {
        if (ws._room) return;
        const r = rooms.get(m.roomId);
        if (!r || r.started || r.players.length >= 2) return wsSend(ws, { t: 'err', msg: '입장할 수 없는 방입니다' });
        if (r.players[0].id === ws._userId) return wsSend(ws, { t: 'err', msg: '자신의 방에는 입장할 수 없습니다' });
        const u = db.users[ws._userId];
        const deck = u && u.decks[m.deckIdx];
        if (!deck) return wsSend(ws, { t: 'err', msg: '덱을 선택하세요' });
        r.players.push({ ws, id: ws._userId, deck, seat: 1 });
        ws._room = r;
        r.started = true;
        const seed = crypto.randomBytes(4).readUInt32LE(0);
        r.players.forEach(pl => wsSend(pl.ws, {
          t: 'start', seed, yourSeat: pl.seat,
          players: r.players.map(q => ({ id: q.id, deck: q.deck })),
        }));
        broadcastLobby();
        break;
      }
      case 'leaveRoom': leaveRoom(ws); break;
      case 'act':
      case 'choice': {
        const r = ws._room; if (!r || !r.started) return;
        const me = r.players.find(pl => pl.ws === ws);
        if (!me) return;
        const out = { t: m.t, seq: ++r.seq, from: ws._userId, seat: me.seat };
        if (m.t === 'act') out.action = m.action;
        else { out.id = m.id; out.data = m.data; }
        r.players.forEach(pl => wsSend(pl.ws, out));
        break;
      }
      case 'chat': {
        const r = ws._room; if (!r) return;
        const msg = String(m.msg == null ? '' : m.msg).slice(0, LIMITS.MAX_CHAT);
        r.players.forEach(pl => wsSend(pl.ws, { t: 'chat', from: ws._userId, msg }));
        break;
      }
    }
  });
  ws.on('close', () => { clearTimeout(ws._authTimer); leaveRoom(ws); });
  ws.on('error', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(ni => {
    if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
  }));
  console.log('════════════════════════════════════════════════');
  console.log('  리프트바운드 시뮬레이터 서버 실행! (API+WS 전용)');
  console.log('════════════════════════════════════════════════');
  console.log('  플레이어는 데스크톱 클라이언트에서 아래 주소를 입력합니다:');
  console.log(`  이 컴퓨터:      http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  같은 네트워크:  http://${ip}:${PORT}`));
  console.log('');
  console.log('  [인터넷 공개 — 고정 HTTPS 주소 권장]');
  console.log('  tunnel-ngrok.bat (고정 도메인) 또는 tunnel.bat (임시)');
  console.log('  자세한 방법: 서버_실행_가이드.md');
  console.log('');
  console.log('  종료: Ctrl+C  ·  포트 변경: 실행 인자 (예: 9000)');
  console.log('════════════════════════════════════════════════');
});
