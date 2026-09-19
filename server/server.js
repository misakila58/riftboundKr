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

// 배포 시 build-dist.js가 남긴 커밋 정보 (개발 중 실행이면 파일이 없다)
let BUILD = { commit:'dev', date:'', subject:'', built:'' };
try {
  const bf = path.join(BASE, 'build.json');
  if (fs.existsSync(bf)) BUILD = { ...BUILD, ...JSON.parse(fs.readFileSync(bf, 'utf8')) };
} catch (e) {}

// ══════════ 익명 사용 통계 ══════════
// 세는 것: 모드별 게임 수, 평균 턴, 중도 이탈, 덱 조합별 승률, 날짜별 접속 수, 버전 분포.
// 저장하지 않는 것: IP·설치 ID·계정·닉네임·덱 목록·개별 요청. 도착 즉시 카운터만 올리고 버린다.
// 시각은 날짜(YYYY-MM-DD)까지만 남긴다. 남는 것은 집계 숫자뿐이라 개인을 특정할 수 없다.
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
let STATS = {};
try { if (fs.existsSync(STATS_FILE)) STATS = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch (e) { STATS = {}; }
// 봇전을 빼기 전에 쌓인 집계가 있으면 지운다. 모드는 항상 키의 한 조각이라
// ':bot'으로 끝나거나 ':bot:'을 포함하는 키만 골라내면 된다.
{
  const drop = Object.keys(STATS).filter(k => k.endsWith(':bot') || k.includes(':bot:'));
  if (drop.length) { for (const k of drop) delete STATS[k]; console.log(`봇전 집계 ${drop.length}건 제거`); }
}
let statsTimer = null, statsDirty = false;
function statsSave() {
  statsDirty = true;
  if (statsTimer) return;
  statsTimer = setTimeout(() => {
    statsTimer = null;
    if (!statsDirty) return;
    statsDirty = false;
    const tmp = STATS_FILE + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(STATS)); fs.renameSync(tmp, STATS_FILE); } catch (e) {}
  }, 5000);   // 5초에 한 번만 디스크에 쓴다 (요청마다 쓰지 않게)
}
const statsBump = (k, by) => { STATS[k] = (STATS[k] || 0) + (by || 1); };
// 시간 단위 버킷 (h:YYYY-MM-DDTHH:mode). 날짜 버킷만으로는 '최근 24시간'을 낼 수 없다.
// 48시간이 지난 버킷은 지운다 — 집계 파일이 무한히 커지지 않게.
const statHourKey = d => d.toISOString().slice(0, 13);
function statsPruneHours(now) {
  const cut = statHourKey(new Date(now.getTime() - 48 * 3600e3));
  for (const k of Object.keys(STATS)) {
    if (k.startsWith('h:') && k.slice(2, 15) < cut) delete STATS[k];
  }
}
// 지금부터 24시간 뒤로 세어 모드별 시작 판수를 합산한다
function stats24h(now) {
  const out = { total: 0 };
  for (const m of STAT_MODES) out[m] = 0;
  for (let i = 0; i < 24; i++) {
    const hk = statHourKey(new Date(now.getTime() - i * 3600e3));
    for (const m of STAT_MODES) {
      const v = STATS[`h:${hk}:${m}`] || 0;
      out[m] += v; out.total += v;
    }
  }
  return out;
}
// 봇전은 집계하지 않는다 — 봇 상대 승률은 사람 대전 판단에 쓸 수 없어 표를 흐리기만 한다.
// 목록에 없는 모드는 statsRecord가 통째로 버리므로, 옛 클라이언트가 보내와도 쌓이지 않는다.
const STAT_MODES = ['hotseat', 'p2p', 'online'];
const STAT_ENDS  = ['normal', 'surrender', 'left'];
const statInt = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

// 클라이언트가 보낸 이벤트 하나를 집계에 반영한다. 알 수 없는 값은 통째로 버린다.
function statsRecord(b) {
  if (!b || typeof b !== 'object') return;
  const d = new Date().toISOString().slice(0, 10);
  const ver = (typeof b.v === 'string' && /^[0-9.]{1,12}$/.test(b.v)) ? b.v : 'unknown';

  if (b.ev === 'active_day') { statsBump(`day:${d}:active`); statsBump(`ver:${ver}:active`); return statsSave(); }

  const mode = STAT_MODES.includes(b.mode) ? b.mode : null;
  if (!mode) return;

  if (b.ev === 'game_start') {
    const now = new Date();
    statsBump(`day:${d}:start:${mode}`);
    statsBump(`total:start:${mode}`);
    statsBump(`h:${statHourKey(now)}:${mode}`);
    statsPruneHours(now);
    return statsSave();
  }

  if (b.ev === 'game_end') {
    const end = STAT_ENDS.includes(b.end) ? b.end : 'normal';
    statsBump(`day:${d}:end:${mode}`);
    statsBump(`total:end:${mode}:${end}`);
    if (statInt(b.turns, 500)) { statsBump(`total:turnsum:${mode}`, b.turns); statsBump(`total:turncnt:${mode}`); }
    const a = b.a, c = b.b;
    if (a && c && statInt(a.legend, 999) && statInt(a.champ, 999) && statInt(c.legend, 999) && statInt(c.champ, 999)
        && (b.winner === 0 || b.winner === 1)) {
      const A = `${a.legend}-${a.champ}`, B = `${c.legend}-${c.champ}`;
      // 두 덱을 정렬해 한 방향으로만 저장한다 (A대B와 B대A가 갈라지지 않게)
      const [lo, hi] = A <= B ? [A, B] : [B, A];
      const loWon = (A <= B) ? b.winner === 0 : b.winner === 1;
      statsBump(`mu:${mode}:${lo}|${hi}:games`);
      if (loWon) statsBump(`mu:${mode}:${lo}|${hi}:lowin`);
      statsBump(`deck:${mode}:${A}:games`);
      statsBump(`deck:${mode}:${B}:games`);
      statsBump(`deck:${mode}:${b.winner === 0 ? A : B}:wins`);
    }
    statsSave();
  }
}

// ---------- 모바일/브라우저용 웹앱 제공 경로 ----------
// 배포판(dist): exe 옆 web/ · 개발: ../client/web
const WEB_ROOT = fs.existsSync(path.join(BASE, 'web', 'index.html'))
  ? path.join(BASE, 'web')
  : path.join(__dirname, '..', 'client', 'web');
const SERVE_WEB = fs.existsSync(path.join(WEB_ROOT, 'index.html'));
// 지금 서비스 중인 웹 클라이언트의 버전. 데스크톱 exe와 이 값이 다르면 서로 방에 못 들어가므로
// (입장 시 버전 검사) 배포가 밀렸는지 한눈에 보이도록 상태에 함께 싣는다.
const WEB_VERSION = (() => {
  try {
    const m = fs.readFileSync(path.join(WEB_ROOT, 'js', 'buildinfo.js'), 'utf8').match(/version:"([^"]+)"/);
    return m ? m[1] : null;
  } catch (e) { return null; }
})();

// ---------- 접근 암호(입장 통제) ----------
// 우선순위: 환경변수 ACCESS_CODE > access-code.txt 파일. 값이 있으면 '아는 사람만' 입장.
function loadAccessCode() {
  if (process.env.ACCESS_CODE && process.env.ACCESS_CODE.trim()) return process.env.ACCESS_CODE.trim();
  for (const f of [path.join(BASE, 'access-code.txt'), path.join(__dirname, 'access-code.txt')]) {
    try { const v = fs.readFileSync(f, 'utf8').trim(); if (v) return v; } catch (e) {}
  }
  return null;
}
let ACCESS_CODE = loadAccessCode();
// 파일 변경 즉시 반영(암호 변경/회수) — 30초마다 재로딩
setInterval(() => { ACCESS_CODE = loadAccessCode(); }, 30000).unref?.();
// 입력한 접근 코드가 일치하는지 (상수시간 비교)
function accessCodeOK(code) {
  if (!ACCESS_CODE) return true; // 미설정 = 공개
  if (typeof code !== 'string') return false;
  const a = Buffer.from(code), b = Buffer.from(ACCESS_CODE);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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
  MAX_SIDE: 10,             // 사이드덱 최대 (2026-07-24 대회 규정)
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
const VALID = { legend: new Set(), champ: new Set(), main: new Set(), rune: new Set(), bf: new Set(), sig: new Set(), tags: {}, size: 0 };
(function loadCards() {
  const candidates = [path.join(BASE, 'cards.json'), path.join(__dirname, 'cards.json')];
  for (const f of candidates) {
    try {
      const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const c of arr) {
        if (c.type === 'Legend') { VALID.legend.add(c.n); if (c.tags) VALID.tags[c.n] = c.tags; }
        else if (c.type === 'Rune') VALID.rune.add(c.n);
        else if (c.type === 'Battlefield') VALID.bf.add(c.n);
        else if (['Unit', 'Spell', 'Gear'].includes(c.type) && c.super !== 'Token') {
          VALID.main.add(c.n);
          if (c.super === 'Signature') { VALID.sig.add(c.n); if (c.tags) VALID.tags[c.n] = c.tags; }
          if (c.type === 'Unit' && c.super === 'Champion') { VALID.champ.add(c.n); if (c.tags) VALID.tags[c.n] = c.tags; }
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
// 세션은 db.json에 함께 저장한다. 메모리에만 두면 서버를 재시작할 때마다(=배포할 때마다)
// 모두 로그아웃되어, 덱을 저장하려던 사람이 "로그인이 필요합니다"를 만나게 된다.
const sessions = new Map();
(function loadSessions() {
  const saved = db.sessions;
  if (!saved || typeof saved !== 'object') return;
  const now = Date.now();
  let n = 0;
  for (const [t, sv] of Object.entries(saved)) {
    if (sv && typeof sv.userId === 'string' && Number.isFinite(sv.expires) && sv.expires > now) {
      sessions.set(t, { userId: sv.userId, expires: sv.expires });
      n++;
    }
  }
  if (n) console.log(`로그인 세션 ${n}개 복원`);
})();
function persistSessions() {
  const out = {};
  for (const [t, sv] of sessions) out[t] = sv;
  db.sessions = out;
  saveDB();
}
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
  persistSessions();
  return token;
}
function userFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  const s = sessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (s.expires < now) { sessions.delete(token); persistSessions(); return null; }
  // 계속 쓰는 동안에는 만료되지 않게 기간을 밀어 준다.
  // 매 요청마다 디스크에 쓰지 않도록, 남은 기간이 하루 이상 줄었을 때만 갱신한다.
  const full = now + LIMITS.TOKEN_TTL_MS;
  if (full - s.expires > 24 * 3600 * 1000) { s.expires = full; persistSessions(); }
  return db.users[s.userId] || null;
}
setInterval(() => {
  const now = Date.now();
  let gone = 0;
  for (const [t, s] of sessions) if (s.expires < now) { sessions.delete(t); gone++; }
  if (gone) persistSessions();
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
// 이진 본문(리플레이 파일) 읽기 — JSON readBody와 달리 상한을 호출자가 정한다
function readRawBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, over = false;
    req.on('data', c => {
      if (over) return;
      size += c.length;
      if (size > max) { over = true; reject(new Error('TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', () => reject(new Error('REQ_ERROR')));
  });
}

// ---------- 봇 개선용 리플레이 수집 (/api/replay) ----------
// 클라이언트가 경기 종료 시 보내는 .rbr 파일을 data/replays/<YYYY-MM>/ 에 그대로 보관하고 index.jsonl에 한 줄씩 적는다.
// 닉네임은 클라이언트가 '플레이어 1/2'로 바꿔 보내며(replay.js rpAnonymize), 서버는 IP를 저장하지 않는다(속도 제한에만 잠시 씀).
// 분석은 tools/replay-extract.js · tools/replay-analyze.js — 파일은 scp로 내려받는다.
const REPLAY_DIR = path.join(DATA_DIR, 'replays');
const REPLAY_LIMITS = { MAX_BYTES: 1500 * 1024, MAX_FILES: 20000, MAX_TOTAL: 1024 * 1024 * 1024, PER_IP_WINDOW_MS: 3600e3, PER_IP_MAX: 40 };
const REPLAYS = { files: 0, bytes: 0 };
(function scanReplays() {
  try {
    if (!fs.existsSync(REPLAY_DIR)) return;
    for (const d of fs.readdirSync(REPLAY_DIR)) {
      const dp = path.join(REPLAY_DIR, d);
      if (!fs.statSync(dp).isDirectory()) continue;
      for (const f of fs.readdirSync(dp)) {
        if (!f.endsWith('.rbr')) continue;
        REPLAYS.files++; REPLAYS.bytes += fs.statSync(path.join(dp, f)).size;
      }
    }
    if (REPLAYS.files) console.log(`리플레이 보관: ${REPLAYS.files}개 (${(REPLAYS.bytes / 1048576).toFixed(1)}MB)`);
  } catch (e) {}
})();
// .rbr 앞부분의 비압축 헤더 JSON만 읽는다 ("RBRP" + 포맷 1B + 압축 1B + 헤더길이 4B LE + 헤더)
function replayHeader(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 4) !== 'RBRP' || buf[4] !== 1) return null;
  const hl = buf.readUInt32LE(6);
  if (hl <= 0 || hl > 64 * 1024 || 10 + hl > buf.length) return null;
  try { return JSON.parse(buf.toString('utf8', 10, 10 + hl)); } catch (e) { return null; }
}
function replayStore(buf, h) {
  const day = new Date().toISOString().slice(0, 10), month = day.slice(0, 7);
  const dir = path.join(REPLAY_DIR, month);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${day}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}.rbr`;
  fs.writeFileSync(path.join(dir, name), buf);
  REPLAYS.files++; REPLAYS.bytes += buf.length;
  const idx = {
    file: `${month}/${name}`, day, app: h.app || null, mode: h.modeKey || null, bot: h.bot || null,
    players: h.players.map(p => ({ legend: p.legendN | 0, champ: p.champN | 0 })),
    winner: h.result.winner, turns: h.result.turns, size: buf.length,
  };
  fs.appendFileSync(path.join(REPLAY_DIR, 'index.jsonl'), JSON.stringify(idx) + '\n');
  return idx;
}
// 봇전 집계 — 익명 통계에는 없던 "어떤 덱이 어느 난이도의 봇을 얼마나 이기는가". 헤더의 숫자만 쓴다.
function replayStats(h) {
  const b = h.bot;
  if (!b || !(b.seat === 0 || b.seat === 1)) return;
  const lv = String(b.level || 'unknown').replace(/[^a-z]/g, '') || 'unknown';
  const human = h.players[1 - b.seat];
  if (!human) return;
  const humanWon = h.result.winner === (1 - b.seat);
  statsBump(`bot:${lv}:games`);
  if (humanWon) statsBump(`bot:${lv}:humanwin`);
  if (Number.isInteger(h.result.turns) && h.result.turns >= 0 && h.result.turns <= 500) {
    statsBump(`bot:${lv}:turnsum`, h.result.turns); statsBump(`bot:${lv}:turncnt`);
  }
  const deck = `${human.legendN | 0}-${human.champN | 0}`;
  statsBump(`botdeck:${lv}:${deck}:games`);
  if (humanWon) statsBump(`botdeck:${lv}:${deck}:wins`);
  statsSave();
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
  // 선발 챔피언은 전설과 같은 챔피언 태그여야 한다 (룰 103) — 마스터 이 전설에 키아나 선발 불가. 태그 정보가 있을 때만 검사.
  {
    const ct = VALID.tags[d.champN], lt = VALID.tags[d.legendN];
    if (ct && lt && !ct.some(t => lt.includes(t))) return '선발 챔피언은 전설과 같은 챔피언 유닛이어야 합니다 (룰 103)';
  }
  if (!Array.isArray(d.main) || d.main.length !== 40) return '메인 덱은 40장이어야 합니다';
  if (!Array.isArray(d.runes) || d.runes.length !== 12) return '룬은 12개여야 합니다';
  if (!Array.isArray(d.bfs) || d.bfs.length !== 3) return '전장은 3개여야 합니다';
  const counts = {};
  for (const n of d.main) {
    if (!Number.isInteger(n)) return '메인 덱 카드 오류';
    if (VALID.main.size && !VALID.main.has(n)) return '유효하지 않은 카드가 포함됨';
    counts[n] = (counts[n] || 0) + 1;
    if (counts[n] > 3) return '같은 카드는 3장까지입니다';
    // 시그니처 카드는 같은 챔피언의 전설 덱에만 (예: 티버스는 애니 전설)
    if (VALID.sig.has(n)) {
      const st = VALID.tags[n] || [], lt = VALID.tags[d.legendN] || [];
      if (!st.some(t => lt.includes(t))) return '시그니처 카드는 같은 챔피언의 전설 덱에만 넣을 수 있습니다';
    }
  }
  // 사이드덱 — 없어도 되고, 있으면 10장 이하 (2026-07-24 대회 규정: "8장 이하"에서 상향).
  // 메인 덱에 넣을 수 있는 카드 종류만 들어가고(룬·전설·전장 불가),
  // 같은 카드 3장 제한은 메인과 합쳐서 센다 → 위에서 만든 counts를 이어 쓴다.
  if (d.side !== undefined) {
    if (!Array.isArray(d.side)) return '사이드덱 형식 오류';
    if (d.side.length > LIMITS.MAX_SIDE) return `사이드덱은 ${LIMITS.MAX_SIDE}장까지입니다`;
    for (const n of d.side) {
      if (!Number.isInteger(n)) return '사이드덱 카드 오류';
      if (VALID.main.size && !VALID.main.has(n)) return '사이드덱에 넣을 수 없는 카드가 있습니다';
      counts[n] = (counts[n] || 0) + 1;
      if (counts[n] > 3) return '같은 카드는 메인·사이드를 합쳐 3장까지입니다';
      if (VALID.sig.has(n)) {
        const st = VALID.tags[n] || [], lt = VALID.tags[d.legendN] || [];
        if (!st.some(t => lt.includes(t))) return '시그니처 카드는 같은 챔피언의 전설 덱에만 넣을 수 있습니다';
      }
    }
  }

  // 일러스트 선택(표시용) — 없어도 되고, 있으면 { 카드번호: 인덱스 } 형태여야 한다
  if (d.arts !== undefined) {
    if (typeof d.arts !== 'object' || d.arts === null || Array.isArray(d.arts)) return '일러스트 설정 형식 오류';
    const keys = Object.keys(d.arts);
    if (keys.length > 400) return '일러스트 설정이 너무 많습니다';
    for (const k of keys) {
      const v = d.arts[k];
      if (!/^\d{1,4}$/.test(k) || !Number.isInteger(v) || v < 0 || v > 20) return '일러스트 설정 값 오류';
    }
  }
  for (const n of d.runes) if (!Number.isInteger(n) || (VALID.rune.size && !VALID.rune.has(n))) return '유효하지 않은 룬이 포함됨';
  for (const n of d.bfs) if (!Number.isInteger(n) || (VALID.bf.size && !VALID.bf.has(n))) return '유효하지 않은 전장이 포함됨';
  return null;
}
// 대전에 실어 보낼 덱 (사이드덱 제외). 저장용 덱은 그대로 둔다.
function deckWithoutSide(d) {
  if (!d || d.side === undefined) return d;
  const { side, ...rest } = d;
  return rest;
}

function sanitizeDeck(d) {
  const out = { name: d.name.trim().slice(0, LIMITS.MAX_DECK_NAME), legendN: d.legendN, champN: d.champN,
                main: d.main.map(Number), runes: d.runes.map(Number), bfs: d.bfs.map(Number) };
  // 사이드덱은 경기 사이 교체에 쓰이므로 저장·전달 모두 그대로 유지한다
  if (Array.isArray(d.side) && d.side.length) out.side = d.side.map(Number);
  // 일러스트 선택은 표시용이라 규칙에 영향이 없지만, 상대 화면에도 보여야 하므로 함께 실어 보낸다
  if (d.arts && typeof d.arts === 'object' && !Array.isArray(d.arts)) {
    const a = {};
    for (const k of Object.keys(d.arts)) {
      const v = Number(d.arts[k]);
      if (/^\d{1,4}$/.test(k) && Number.isInteger(v) && v > 0 && v <= 20) a[k] = v;
    }
    if (Object.keys(a).length) out.arts = a;
  }
  return out;
}

// ---------- HTTP (API 전용) ----------
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
  const p = url.pathname;

  // CORS 프리플라이트
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  // 헬스체크 (클라이언트가 서버 주소 유효성 확인 + 접근 코드 필요 여부 확인용)
  if (p === '/api/health' && req.method === 'GET')
    return json(res, 200, { ok: true, name: 'riftbound-sim', version: 2, requiresAccess: !!ACCESS_CODE,
      commit: BUILD.commit, commitDate: BUILD.date, built: BUILD.built });

  // 서버 관리 도구가 읽는 한 줄 요약. 숫자와 커밋 해시뿐이라 민감하지 않다.
  // 배치 파일에서 그대로 출력할 수 있게 JSON이 아닌 평문으로 준다.
  if (p === '/api/status' && req.method === 'GET') {
    const now = new Date();
    const s = stats24h(now);
    const label = { hotseat:'핫시트', p2p:'친구', online:'온라인' };
    const parts = STAT_MODES.filter(m => s[m] > 0).map(m => `${label[m]} ${s[m]}`);
    // KEY|값 한 줄씩 — 배치 파일이 delims=| 로 그대로 나눠 읽는다
    // 지금 실제로 진행 중인 대전 — 서버를 재시작하면 이 게임들이 끊긴다.
    // 방은 메모리에만 있어 재시작으로 사라지고, 클라이언트에는 이어 붙일 방법이 없다.
    const live = [...rooms.values()].filter(r => r.started);
    const playing = live.length;
    const waiting = rooms.size - playing;
    // 배포해도 되는 상황인지 판단하려면 숫자만으로는 부족하다 — 누가 얼마나 두고 있는지 같이 준다.
    // 다만 이 응답은 인증이 없는 공개 정보이므로 아이디는 첫 글자만 남기고 가린다.
    const mask = id => { const t = String(id || '?'); return t.slice(0, 1) + '●'.repeat(Math.max(1, t.length - 1)); };
    const mins = t => t ? Math.max(0, Math.round((Date.now() - t) / 60000)) : 0;
    const lines = [
      `PLAYING|${playing}`,
      `WAITING|${waiting}`,
      ...live.map(r => `GAME|${mins(r.startedAt)}분째|${r.players.map(pl => mask(pl.id)).join(' vs ')}|v${r.players[0]?.ver || '?'}`),
      `GAMES|${s.total}판${parts.length ? ' (' + parts.join(' · ') + ')' : ''}`,
      `REPLAYS|${REPLAYS.files}개 (${(REPLAYS.bytes / 1048576).toFixed(1)}MB)`,
      `BUILD|${BUILD.commit}${BUILD.date ? ' (' + BUILD.date + ')' : ''}${BUILD.subject ? ' ' + BUILD.subject : ''}`,
      `COMMIT|${BUILD.commit}`,
      ...(WEB_VERSION ? [`WEBVER|${WEB_VERSION}`] : []),
    ];
    res.writeHead(200, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' });
    return res.end(lines.join('\n') + '\n');
  }

  // 익명 통계 — 계정 없이도 보낼 수 있어야 하므로 인증 앞에 둔다.
  // 요청 본문만 보고 카운터를 올린다 (IP·헤더는 읽지 않는다).
  if (p === '/api/stats' && req.method === 'POST') {
    return readBody(req).then(b => { statsRecord(b); json(res, 200, { ok: true }); })
                        .catch(() => json(res, 200, { ok: true }));   // 실패해도 게임에 영향 없음
  }
  // 집계 조회 (숫자만 있어 민감하지 않다)
  if (p === '/api/stats' && req.method === 'GET') return json(res, 200, STATS);

  // 봇 개선용 리플레이 수신 — 계정 없이 보낼 수 있다. 완료된 자동 모드 경기만 받고, 응답은 항상 200(게임에 영향 없음).
  if (p === '/api/replay' && req.method === 'POST') {
    if (!rateHit('replay:' + clientIp(req), REPLAY_LIMITS.PER_IP_WINDOW_MS, REPLAY_LIMITS.PER_IP_MAX))
      return json(res, 200, { ok: false, why: 'rate' });
    return readRawBody(req, REPLAY_LIMITS.MAX_BYTES).then(buf => {
      const h = replayHeader(buf);
      if (!h || !h.result || !Array.isArray(h.players) || h.players.length !== 2 || h.manual
          || !(h.result.winner === 0 || h.result.winner === 1))
        return json(res, 200, { ok: false, why: 'invalid' });
      if (REPLAYS.files >= REPLAY_LIMITS.MAX_FILES || REPLAYS.bytes + buf.length > REPLAY_LIMITS.MAX_TOTAL)
        return json(res, 200, { ok: false, why: 'full' });
      replayStore(buf, h); replayStats(h);
      json(res, 200, { ok: true });
    }).catch(() => json(res, 200, { ok: false }));
  }

  // 정적 웹앱 제공 (모바일/브라우저용). 화이트리스트만 — data/·소스는 노출 안 함
  if (!p.startsWith('/api/')) {
    if (!SERVE_WEB) {
      if (p === '/' || p === '') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...CORS });
        return res.end('리프트바운드 시뮬레이터 서버 실행 중. (웹앱 파일 없음 — 데스크톱 클라이언트로 접속)');
      }
      res.writeHead(404, CORS); return res.end();
    }
    let rel;
    if (p === '/' || p === '') rel = 'index.html';
    else { try { rel = decodeURIComponent(p).replace(/^\/+/, ''); } catch (e) { rel = null; } }  // '%zz' 같은 입력
    // 파일명에 한글이 들어가는 자산이 있다 (assets/playmat/아리.png).
    // \w는 ASCII만 매치하므로 문자 종류로 거르면 그런 파일이 통째로 404가 된다.
    // 역슬래시·제어문자·'..'만 막고, 경로 이탈 판정은 아래 WEB_ROOT 검사에 맡긴다.
    if (rel === null || !/^(index\.html|manifest\.webmanifest|(css|js|assets)\/[^\\\x00-\x1f]+)$/.test(rel)
        || rel.split('/').includes('..')) {
      res.writeHead(404, CORS); return res.end();
    }
    const full = path.join(WEB_ROOT, rel);
    if (!full.startsWith(WEB_ROOT + path.sep) && full !== path.join(WEB_ROOT, 'index.html')) { res.writeHead(403); return res.end(); }
    return fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404, CORS); return res.end(); }
      const ext = path.extname(full).toLowerCase();
      // 카드 이미지(webp)를 서버가 직접 제공하면서 이미지 MIME이 필요해졌다 (octet-stream + nosniff면 브라우저가 거부할 수 있다)
      const TEXT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
      const BIN = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };
      const mime = TEXT[ext] ? TEXT[ext] + '; charset=utf-8' : (BIN[ext] || 'application/octet-stream');
      // 카드 이미지·플레이매트는 내용이 바뀌지 않는 파일이라 하루 캐시 — 덱 편집기가 매번 수백 장을 다시 받지 않게
      const cache = rel.startsWith('assets/') ? 'public, max-age=86400' : 'no-cache';
      res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cache });
      res.end(data);
    });
  }

  const ip = clientIp(req);
  try {
    if (p === '/api/register' && req.method === 'POST') {
      if (!rateHit('auth:' + ip, LIMITS.AUTH_WINDOW_MS, LIMITS.AUTH_MAX) ||
          !rateHit('reg:' + ip, LIMITS.REG_WINDOW_MS, LIMITS.REG_MAX))
        return json(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' });
      const { id, pw, invite } = await readBody(req);
      if (!accessCodeOK(invite)) return json(res, 403, { error: '접근 코드가 올바르지 않습니다. 방장에게 받은 코드를 입력하세요.' });
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
    // ── 내 전적 ──
    // 상대 덱(전설+선발 챔피언)별 승패를 누적한다. 카드 번호는 공개 정보라 민감하지 않다.
    // 결과는 클라이언트가 보고하므로 거짓 보고가 가능하지만, 본인 기록만 더럽혀질 뿐이다.
    if (p === '/api/record' && req.method === 'GET')
      return json(res, 200, { record: user.record || {}, total: user.recordTotal || { win: 0, lose: 0 } });
    if (p === '/api/record' && req.method === 'POST') {
      const b = await readBody(req);
      const num = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
      if (!b || !b.opp || !num(b.opp.legend, 999) || !num(b.opp.champ, 999) || typeof b.win !== 'boolean')
        return json(res, 400, { error: '전적 형식 오류' });
      const key = `${b.opp.legend}-${b.opp.champ}`;
      user.record = user.record || {};
      user.recordTotal = user.recordTotal || { win: 0, lose: 0 };
      // 계정당 상대 덱 종류가 무한정 늘지 않게 (실제로는 수십 종을 넘지 않는다).
      // 새 조합을 만들기 전에 확인해야 한도가 실제로 걸린다.
      if (!user.record[key] && Object.keys(user.record).length >= 300) return json(res, 200, { ok: true });
      const r = (user.record[key] = user.record[key] || { win: 0, lose: 0 });
      if (b.win) { r.win++; user.recordTotal.win++; } else { r.lose++; user.recordTotal.lose++; }
      if (num(b.turns, 500)) { r.turns = (r.turns || 0) + b.turns; r.games = (r.games || 0) + 1; }
      saveDB();
      return json(res, 200, { ok: true });
    }
    if (p === '/api/record' && req.method === 'DELETE') {
      delete user.record; delete user.recordTotal; saveDB();
      return json(res, 200, { ok: true });
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
function roomInfo(r) {
  return { id: r.id, name: r.name, host: r.players[0]?.id, count: r.players.length, started: r.started, banRule: !!r.banRule,
    allowSpectate: !!r.allowSpectate, spectators: (r.spectators || []).length, locked: !!r.password };
}
// 로비에 보이는 방: 아직 시작 전이거나, 시작했어도 관전을 허용한 방
function lobbyRooms() { return [...rooms.values()].filter(r => !r.started || r.allowSpectate).map(roomInfo); }
// 게임 시작 메시지 — 플레이어는 자기 좌석, 관전자는 좌석 -1
function startMsg(r, seat) {
  return { t: 'start', seed: r.seed, yourSeat: seat, spectate: seat < 0, manual: r.manual !== false, banRule: !!r.banRule,
    // 사이드덱은 본인만 쓰는 비공개 정보 — 상대 클라이언트로 보내지 않는다
    players: r.players.map(q => ({ id: q.id, deck: deckWithoutSide(q.deck) })) };
}
function roomEveryone(r) { return [...r.players, ...(r.spectators || [])]; }
// 밴 리스트 (한국 KR 기준 = 글로벌 공통, 2026-09-18 개정 확인) — client/web/js/banlist.js와 반드시 함께 갱신할 것
// 168 투쟁 혹은 도피 · 177 은밀한 추적자 · 182 고철 더미 · 276 지망자의 등반
// 284 힘의 오벨리스크 · 285 약탈자의 거리 · 290 투기장 최고의 강자 · 292 꿈꾸는 나무 · 110 에코 - 회귀자 · 183 조작된 덱
const BANNED = new Set([110, 168, 177, 182, 183, 276, 284, 285, 290, 292]);   // 2026-09-18 개정: 에코 - 회귀자(110)·조작된 덱(183) 추가
function deckBannedNs(d) {
  const all = [d.legendN, d.champN, ...(d.main || []), ...(d.bfs || [])];
  return [...new Set(all)].filter(n => n != null && BANNED.has(n));
}
// 방 생성/입장 시 사용할 덱 결정: 기기 로컬 덱(원본 전달, 서버 미저장) 또는 계정 저장 덱(deckIdx)
// 로컬 덱을 허용하면 무료 호스팅에서 서버 데이터가 초기화돼도 플레이어의 덱은 유지된다.
function resolveDeck(ws, m) {
  if (m.deck && typeof m.deck === 'object') {
    if (validDeck(m.deck)) return null; // 검증 실패
    return sanitizeDeck(m.deck);
  }
  const u = db.users[ws._userId];
  return (u && u.decks[m.deckIdx]) || null;
}
function broadcastLobby() {
  const list = lobbyRooms();
  wss.clients.forEach(c => { if (c._authed && !c._room) wsSend(c, { t: 'rooms', rooms: list }); });
}
function leaveRoom(ws, notify = true) {
  const r = ws._room; if (!r) return;
  ws._room = null;
  r.spectators = r.spectators || [];
  if (ws._spectator) {                       // 관전자 퇴장: 아무에게도 알리지 않는다 (인원 수만 로비에 반영)
    ws._spectator = false;
    r.spectators = r.spectators.filter(sp => sp.ws !== ws);
    broadcastLobby();
    return;
  }
  const i = r.players.findIndex(pl => pl.ws === ws);
  if (i >= 0) r.players.splice(i, 1);
  if (r.players.length === 0) {
    rooms.delete(r.id);
    r.spectators.forEach(sp => { sp.ws._room = null; sp.ws._spectator = false; wsSend(sp.ws, { t: 'opponentLeft' }); });
  } else if (notify) roomEveryone(r).forEach(pl => wsSend(pl.ws, { t: 'opponentLeft' }));
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
        wsSend(ws, { t: 'rooms', rooms: lobbyRooms() });
        break;
      case 'createRoom': {
        if (ws._room) return;
        if (rooms.size >= LIMITS.MAX_ROOMS) return wsSend(ws, { t: 'err', msg: '서버 방이 가득 찼습니다.' });
        const deck = resolveDeck(ws, m);
        if (!deck) return wsSend(ws, { t: 'err', msg: '덱을 선택하세요 (덱 형식 오류 포함)' });
        const wantBan = m.banRule === true;
        if (wantBan && deckBannedNs(deck).length)
          return wsSend(ws, { t: 'err', msg: '🚫 밴 적용을 선택한 경우 밴 카드가 포함된 덱은 사용할 수 없습니다' });
        const nm = (typeof m.name === 'string' && m.name.trim()) ? m.name.trim().slice(0, LIMITS.MAX_ROOM_NAME) : (ws._userId + '의 방');
        // 관전 허용은 방장이 정한다(기본 불가). 비밀번호는 입장·관전 모두에 필요하다. 액션 로그는 중간에 들어온 관전자를 따라잡게 하는 용도.
        const password = (typeof m.password === 'string' && m.password.trim()) ? m.password.trim().slice(0, 32) : null;
        const r = { id: 'r' + (roomSeq++), name: nm, players: [], started: false, seq: 0, manual: m.manual !== false, banRule: wantBan,
          allowSpectate: m.allowSpectate === true, password, spectators: [], log: [] };
        rooms.set(r.id, r);
        r.players.push({ ws, id: ws._userId, deck, seat: 0, ver: String(m.ver || '?').slice(0, 20) });
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
        if (r.password && String(m.password || '') !== r.password) return wsSend(ws, { t: 'err', msg: '🔒 비밀번호가 틀렸습니다' });
        const deck = resolveDeck(ws, m);
        if (!deck) return wsSend(ws, { t: 'err', msg: '덱을 선택하세요 (덱 형식 오류 포함)' });
        // 밴 규칙은 '방장이 정한다'. 밴 적용 방이면 입장자 덱도 밴 카드가 없어야 한다.
        const banActive = !!r.banRule;
        if (banActive) {
          const mine = deckBannedNs(deck);
          if (mine.length)
            return wsSend(ws, { t: 'err', msg: '🚫 밴 적용 방입니다 — 밴 카드가 포함된 덱으로는 입장할 수 없습니다 (' + mine.length + '종). 다른 덱을 선택하세요.' });
          if (deckBannedNs(r.players[0].deck).length)
            return wsSend(ws, { t: 'err', msg: '🚫 방장 덱에 밴 카드가 있어 입장할 수 없습니다' });
        }
        // 앱 버전이 다르면 락스텝이 어긋난다(한쪽만 선택 프롬프트가 뜨는 등) — 시작 전에 차단
        const joinVer = String(m.ver || '?').slice(0, 20);
        if (r.players[0].ver !== joinVer)
          return wsSend(ws, { t: 'err', msg: `🔄 앱 버전이 달라 입장할 수 없습니다 (방장 v${r.players[0].ver} / 나 v${joinVer}). 두 분 모두 최신 버전으로 업데이트해 주세요.` });
        r.players.push({ ws, id: ws._userId, deck, seat: 1, ver: joinVer });
        ws._room = r;
        r.started = true;
        r.startedAt = Date.now();   // 배포 전 '몇 분째 두는 중인지' 보여주는 데 쓴다
        r.seed = crypto.randomBytes(4).readUInt32LE(0);
        r.players.forEach(pl => wsSend(pl.ws, startMsg(r, pl.seat)));
        (r.spectators || []).forEach(sp => wsSend(sp.ws, startMsg(r, -1)));
        broadcastLobby();
        break;
      }
      case 'spectate': {
        // 관전: 방장이 허용한 방만. 비밀번호 방이면 비밀번호도. 시작 전이면 시작할 때 함께 start를 받고,
        // 이미 진행 중이면 start + 지금까지의 액션/선택 로그를 순서대로 받아 같은 상태까지 따라간다(락스텝 재생).
        if (ws._room) return;
        const r = rooms.get(m.roomId);
        if (!r || !r.allowSpectate) return wsSend(ws, { t: 'err', msg: '관전을 허용하지 않는 방입니다' });
        if (r.password && String(m.password || '') !== r.password) return wsSend(ws, { t: 'err', msg: '🔒 비밀번호가 틀렸습니다' });
        r.spectators = r.spectators || [];
        if (r.spectators.length >= 10) return wsSend(ws, { t: 'err', msg: '관전 인원이 가득 찼습니다 (10명)' });
        r.spectators.push({ ws, id: ws._userId });
        ws._room = r; ws._spectator = true;
        wsSend(ws, { t: 'spectating', room: roomInfo(r) });
        if (r.started) { wsSend(ws, startMsg(r, -1)); (r.log || []).forEach(o => wsSend(ws, o)); }
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
        if (r.allowSpectate) { r.log = r.log || []; r.log.push(out); if (r.log.length > 20000) r.log.splice(0, r.log.length - 20000); }
        roomEveryone(r).forEach(pl => wsSend(pl.ws, out));
        break;
      }
      case 'chat': {
        const r = ws._room; if (!r) return;
        const msg = String(m.msg == null ? '' : m.msg).slice(0, LIMITS.MAX_CHAT);
        const from = ws._spectator ? ws._userId + ' (관전)' : ws._userId;
        roomEveryone(r).forEach(pl => wsSend(pl.ws, { t: 'chat', from, msg }));
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
