// ══════════ 리플레이: 기록 · 저장 · 재생 ══════════
// [기록 방식] 재시뮬레이션이 아니라 "상태 스냅샷"을 남긴다.
//   · UI.log / UI.render 시점마다 게임 상태(G) 전체를 JSON으로 떠서 보관.
//   · 엔진 규칙이 나중에 바뀌어도 과거 리플레이가 어긋나지 않는다(재현 불필요).
//   · 스냅샷에는 양측 손패·덱이 모두 들어 있어 관전 시 두 선수의 상황을 전부 볼 수 있다.
//   · 동일한 상태는 하나만 저장(중복 제거)하고 프레임은 그 인덱스만 가리켜 용량을 줄인다.
// [파일 포맷] .rbr (바이너리)
//   "RBRP" + 포맷버전(1B) + 압축플래그(1B, 1=gzip) + 헤더길이(4B, LE) + 헤더JSON(비압축) + 본문
//   헤더를 압축하지 않으므로 보관함 목록은 파일 앞부분만 읽어 빠르게 만들 수 있다.

const RP_MAGIC = 'RBRP';
const RP_FORMAT = 1;
const RP_MAX_STATES = 4000;    // 안전 상한 (메모리 폭주 방지)
const RP_MAX_FRAMES = 60000;

const REPLAY = {
  // 기록
  recording:false, rec:null,
  // 재생
  viewing:false, data:null, idx:0, timer:null,
  speedMs:700, realtime:false,
  // 내부
  _t0:0, _lastState:-1, _stateIdx:null, _tutStarting:false,
  _returnScreen:'connect-screen', _logUpTo:-1, _overflow:false,
};

// ---------- 유틸 ----------
function rpPad(n){ return String(n).padStart(2,'0'); }
function rpStamp(d){ return `${d.getFullYear()}${rpPad(d.getMonth()+1)}${rpPad(d.getDate())}-${rpPad(d.getHours())}${rpPad(d.getMinutes())}${rpPad(d.getSeconds())}`; }
function rpDateText(iso){
  const d=new Date(iso);
  if(isNaN(d)) return '(날짜 없음)';
  return `${d.getFullYear()}-${rpPad(d.getMonth()+1)}-${rpPad(d.getDate())} ${rpPad(d.getHours())}:${rpPad(d.getMinutes())}`;
}
function rpBytesText(n){
  if(!(n>0)) return '-';
  return n<1024 ? n+'B' : n<1024*1024 ? (n/1024).toFixed(0)+'KB' : (n/1048576).toFixed(1)+'MB';
}
// 파일명에 쓸 수 없는 문자 제거 (윈도/안드로이드 공통 안전 집합)
function rpSafeName(s){
  return String(s||'').replace(/[\\/:*?"<>|]/g,'').replace(/[\x00-\x1f]/g,'')
    .replace(/\s+/g,' ').trim().slice(0,40) || 'replay';
}
function rpEl(id){ return document.getElementById(id); }

// G → JSON 문자열. '_'로 시작하는 내부 필드와 중복/순환 참조는 제외한다.
// (결전 체인 항목이 보드 유닛을 참조하므로 seen 집합으로 두 번째 등장을 잘라낸다 —
//  players/bfs가 showdown보다 먼저 직렬화되므로 보드 쪽이 항상 살아남는다.)
function rpSerialize(obj){
  const seen = new Set();
  return JSON.stringify(obj, function(k, v){
    if(typeof k==='string' && k.charCodeAt(0)===95) return undefined;
    if(typeof v==='function') return undefined;
    if(v && typeof v==='object'){
      if(seen.has(v)) return undefined;
      seen.add(v);
    }
    return v;
  });
}
function rpClone(o){
  try { return structuredClone(o); } catch(e){ return JSON.parse(JSON.stringify(o)); }
}

// ---------- gzip ----------
async function rpGzip(u8){
  if(typeof CompressionStream==='undefined') return null;
  try{
    const st = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(st).arrayBuffer());
  }catch(e){ return null; }
}
async function rpGunzip(u8){
  const st = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(st).arrayBuffer());
}

// ---------- 파일 빌드 / 파싱 ----------
function rpHeaderOf(rec){
  return {
    v: RP_FORMAT,
    app: rec.app,
    created: rec.created,
    mode: rec.meta.modeText,
    manual: !!rec.meta.manual,
    victory: rec.meta.victory,
    players: rec.meta.players.map(p=>({ name:p.name, legendN:p.legendN })),
    result: rec.result,
    frames: rec.frames.length,
    states: rec.states.length,
    partial: !rec.result,
  };
}

async function rpBuildFile(rec){
  // rec.states는 이미 JSON 문자열 배열 → 재파싱/이스케이프 없이 그대로 이어붙인다.
  const body =
    '{"v":' + RP_FORMAT +
    ',"app":' + JSON.stringify(rec.app||'') +
    ',"created":' + JSON.stringify(rec.created) +
    ',"meta":' + JSON.stringify(rec.meta) +
    ',"result":' + JSON.stringify(rec.result||null) +
    ',"frames":' + JSON.stringify(rec.frames) +
    ',"states":[' + rec.states.join(',') + ']}';

  const enc = new TextEncoder();
  const rawBody = enc.encode(body);
  const gz = await rpGzip(rawBody);
  const payload = gz || rawBody;
  const headBytes = enc.encode(JSON.stringify(rpHeaderOf(rec)));

  const out = new Uint8Array(4 + 1 + 1 + 4 + headBytes.length + payload.length);
  out.set(enc.encode(RP_MAGIC), 0);
  out[4] = RP_FORMAT;
  out[5] = gz ? 1 : 0;
  new DataView(out.buffer).setUint32(6, headBytes.length, true);
  out.set(headBytes, 10);
  out.set(payload, 10 + headBytes.length);
  return out;
}

function rpReadHeader(u8){
  if(!u8 || u8.length < 10) throw new Error('리플레이 파일이 아닙니다');
  const dec = new TextDecoder();
  if(dec.decode(u8.subarray(0,4)) !== RP_MAGIC) throw new Error('리프트바운드 리플레이 파일이 아닙니다 (.rbr)');
  const fmt = u8[4], gz = u8[5];
  if(fmt > RP_FORMAT) throw new Error('더 최신 버전에서 만든 리플레이입니다 — 앱을 업데이트하세요');
  const hlen = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(6, true);
  if(hlen > u8.length - 10) throw new Error('리플레이 파일이 손상되었습니다');
  let header;
  try{ header = JSON.parse(dec.decode(u8.subarray(10, 10+hlen))); }
  catch(e){ throw new Error('리플레이 헤더를 읽을 수 없습니다'); }
  return { fmt, gz, hlen, header, bodyAt: 10+hlen };
}

async function rpParseFile(u8){
  const h = rpReadHeader(u8);
  let body = u8.subarray(h.bodyAt);
  if(h.gz){
    try{ body = await rpGunzip(body); }
    catch(e){ throw new Error('리플레이 파일이 손상되었거나 전송 중 잘렸습니다'); }
  }
  let data;
  try{ data = JSON.parse(new TextDecoder().decode(body)); }
  catch(e){ throw new Error('리플레이 본문을 읽을 수 없습니다 (파일 손상)'); }
  rpValidate(data);
  data.header = h.header;
  return data;
}

// 외부에서 받은 파일도 열리므로 최소한의 구조 검증을 한다.
function rpValidate(d){
  if(!d || !Array.isArray(d.states) || !Array.isArray(d.frames))
    throw new Error('리플레이 구조가 올바르지 않습니다');
  if(!d.states.length || !d.frames.length) throw new Error('빈 리플레이입니다');
  for(const f of d.frames){
    if(!f || typeof f.s!=='number' || f.s<0 || f.s>=d.states.length)
      throw new Error('리플레이 프레임이 손상되었습니다');
  }
  const s0 = d.states[0];
  if(!s0 || !Array.isArray(s0.players) || s0.players.length!==2 || !Array.isArray(s0.bfs))
    throw new Error('리플레이 상태가 올바르지 않습니다');
  for(const P of s0.players){
    if(!card(P.legendN)) throw new Error('이 리플레이의 카드 데이터를 찾을 수 없습니다 (다른 카드 세트)');
  }
}

// ══════════ 저장소 (데스크톱=파일 / 웹·모바일=IndexedDB) ══════════
const RPIdb = {
  _db:null,
  open(){
    if(RPIdb._db) return Promise.resolve(RPIdb._db);
    return new Promise((res,rej)=>{
      if(!window.indexedDB) return rej(new Error('이 환경에서는 리플레이를 저장할 수 없습니다'));
      const r = indexedDB.open('rb_replays', 1);
      r.onupgradeneeded = ()=>{ if(!r.result.objectStoreNames.contains('replays')) r.result.createObjectStore('replays',{keyPath:'id'}); };
      r.onsuccess = ()=>{ RPIdb._db=r.result; res(r.result); };
      r.onerror = ()=>rej(r.error||new Error('저장소를 열 수 없습니다'));
    });
  },
  async _tx(mode, fn){
    const db = await RPIdb.open();
    return new Promise((res,rej)=>{
      const tx = db.transaction('replays', mode);
      const req = fn(tx.objectStore('replays'));
      tx.onerror = ()=>rej(tx.error||new Error('저장소 오류'));
      tx.oncomplete = ()=>res(req && req.result);
    });
  },
  list(){ return RPIdb._tx('readonly', st=>st.getAll()); },
  put(rec){ return RPIdb._tx('readwrite', st=>st.put(rec)); },
  get(id){ return RPIdb._tx('readonly', st=>st.get(id)); },
  del(id){ return RPIdb._tx('readwrite', st=>st.delete(id)); },
};

const RPStore = {
  get native(){ return !!(window.desktop && window.desktop.replay); },

  async where(){
    if(RPStore.native){
      try{ return await window.desktop.replay.dir(); }catch(e){ return ''; }
    }
    return '';
  },
  // [{id, size, mtime, header}]
  async list(){
    if(RPStore.native) return await window.desktop.replay.list();
    const rows = await RPIdb.list();
    return (rows||[]).map(r=>({ id:r.id, size:(r.bytes&&r.bytes.byteLength)||r.size||0, mtime:r.mtime||0, header:r.header }))
      .sort((a,b)=>b.mtime-a.mtime);
  },
  async save(id, bytes, header){
    if(RPStore.native) return await window.desktop.replay.save(id, bytes);
    await RPIdb.put({ id, bytes, header, size:bytes.byteLength, mtime:Date.now() });
    return { id };
  },
  async read(id){
    if(RPStore.native){
      const b = await window.desktop.replay.read(id);
      return b instanceof Uint8Array ? b : new Uint8Array(b);
    }
    const r = await RPIdb.get(id);
    if(!r) throw new Error('리플레이를 찾을 수 없습니다');
    return r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes);
  },
  async del(id){
    if(RPStore.native) return await window.desktop.replay.del(id);
    return await RPIdb.del(id);
  },
};

// 파일 내보내기 (다른 사람에게 전달용)
async function rpExport(id, bytes){
  if(RPStore.native){
    const r = await window.desktop.replay.exportAs(id, id);
    if(r && r.canceled) return null;
    return r && r.path;
  }
  // 웹/모바일: 브라우저 다운로드
  const blob = new Blob([bytes], { type:'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = id;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 8000);
  return id;
}

// ══════════ 기록 ══════════
REPLAY._modeText = function(){
  if(REPLAY.rec && REPLAY.rec.meta.tutorial) return '🎓 튜토리얼';
  const ni = rpEl('net-info');
  const t = ni ? ni.textContent.trim() : '';
  if(t) return t;
  if(NET.online) return '🌐 온라인 대전';
  if(typeof BOT!=='undefined' && BOT.active) return '🤖 BOT 대전';
  return '💺 오프라인 대전';
};

REPLAY.startRecording = function(meta){
  REPLAY.rec = {
    app: (typeof BUILDINFO!=='undefined' && BUILDINFO.version) ? BUILDINFO.version : '',
    created: new Date().toISOString(),
    meta, states: [], frames: [], result: null,
  };
  REPLAY._stateIdx = new Map();
  REPLAY._t0 = Date.now();
  REPLAY._lastState = -1;
  REPLAY._overflow = false;
  REPLAY.willSave = false;
  REPLAY.recording = true;
  REPLAY.capture();                 // 시작 상태 (멀리건 전)
};

// 상태 스냅샷 + (있으면) 로그 한 줄을 프레임으로 남긴다.
REPLAY.capture = function(log, cls){
  if(!REPLAY.recording || REPLAY.viewing || typeof G==='undefined' || !G) return;
  const rec = REPLAY.rec; if(!rec) return;
  if(REPLAY._overflow) return;

  let s;
  try { s = rpSerialize(G); } catch(e){ return; }   // 직렬화 실패 시 그 프레임만 건너뜀

  let idx = REPLAY._stateIdx.get(s);
  if(idx === undefined){
    if(rec.states.length >= RP_MAX_STATES || rec.frames.length >= RP_MAX_FRAMES){
      REPLAY._overflow = true;
      UI.toast('리플레이가 너무 길어 기록을 중단합니다','warn');
      return;
    }
    idx = rec.states.length;
    rec.states.push(s);
    REPLAY._stateIdx.set(s, idx);
  }
  if(log === undefined && idx === REPLAY._lastState) return;   // 변화 없음 → 프레임 불필요

  const f = { s: idx, t: Date.now() - REPLAY._t0 };
  if(log !== undefined){ f.l = String(log); f.c = cls || 'sys'; }
  rec.frames.push(f);
  REPLAY._lastState = idx;
};

REPLAY._onNewGame = function(cfg){
  if(REPLAY.viewing) return;
  REPLAY.startRecording({
    tutorial: !!REPLAY._tutStarting,
    modeText: '',
    manual: !!G.manual,
    victory: G.victory,
    seed: (cfg && cfg.seed) || null,
    players: G.players.map(P=>({ name:P.name, legendN:P.legendN, champN:P.champN })),
    bfs: G.bfs.map(b=>b.n),
  });
};

REPLAY._onVictory = function(p){
  if(!REPLAY.recording || !REPLAY.rec) return;
  REPLAY.capture();
  REPLAY.rec.meta.modeText = REPLAY._modeText();
  REPLAY.rec.result = { winner:p, points:G.players.map(P=>P.points), turns:Math.ceil(G.turnCount/2) };
  REPLAY.recording = false;
  if(REPLAY.rec.meta.tutorial) return;             // 튜토리얼은 보관함을 어지럽히지 않도록 자동 저장 제외
  REPLAY.willSave = true;                          // 승리 모달 문구용 (저장은 비동기)
  REPLAY.save(true);
};

// 저장 (auto=true면 조용히, 실패해도 게임 흐름을 막지 않음)
REPLAY.save = async function(auto){
  const rec = REPLAY.rec;
  if(!rec || !rec.frames.length){
    if(!auto) UI.toast('저장할 리플레이가 없습니다','warn');
    return null;
  }
  if(!rec.meta.modeText) rec.meta.modeText = REPLAY._modeText();
  try{
    const bytes = await rpBuildFile(rec);
    const id = `${rpStamp(new Date(rec.created))}_${rpSafeName(rec.meta.players.map(p=>p.name).join(' vs '))}.rbr`;
    await RPStore.save(id, bytes, rpHeaderOf(rec));
    const where = await RPStore.where();
    UI.toast(`🎬 리플레이 저장됨 · ${rpBytesText(bytes.length)}${where?' → '+where:' (앱 보관함)'}`);
    return id;
  }catch(e){
    console.error('replay save failed', e);
    UI.toast('리플레이 저장 실패: '+(e.message||e),'warn');
    return null;
  }
};

// 진행 중인 경기를 지금까지만 저장
REPLAY.saveNow = function(){
  if(!REPLAY.rec){ UI.toast('기록 중인 경기가 없습니다','warn'); return; }
  REPLAY.rec.meta.modeText = REPLAY._modeText();
  REPLAY.save(false);
};

// ══════════ 보관함 화면 ══════════
REPLAY.openLibrary = function(from){
  REPLAY._returnScreen = from || (NET.token ? 'menu-screen' : 'connect-screen');
  showScreen('replay-screen');
  REPLAY.refreshLibrary();
};

REPLAY.refreshLibrary = async function(){
  const list = rpEl('rp-list');
  const pathEl = rpEl('rp-path');
  list.textContent = '';
  const loading = document.createElement('div');
  loading.className = 'hint'; loading.textContent = '불러오는 중...';
  list.appendChild(loading);

  const where = await RPStore.where();
  pathEl.textContent = where
    ? `저장 위치: ${where} — 이 폴더의 .rbr 파일을 그대로 전달하면 상대도 같은 방식으로 볼 수 있습니다.`
    : '저장 위치: 앱 내부 보관함 — [📤 내보내기]로 .rbr 파일을 저장해 전달할 수 있습니다.';
  rpEl('btn-rp-folder').style.display = RPStore.native ? '' : 'none';

  let rows;
  try{ rows = await RPStore.list(); }
  catch(e){
    list.textContent='';
    const err=document.createElement('div'); err.className='err-msg';
    err.textContent='보관함을 열 수 없습니다: '+(e.message||e);
    list.appendChild(err); return;
  }

  list.textContent = '';
  if(!rows.length){
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = '아직 저장된 리플레이가 없습니다. 경기가 끝나면 자동으로 저장됩니다.';
    list.appendChild(empty);
    return;
  }
  rows.forEach(r=>list.appendChild(rpCardEl(r)));
};

function rpCardEl(row){
  const h = row.header || {};
  const el = document.createElement('div');
  el.className = 'deck-card rp-card';

  const title = document.createElement('h3');
  title.textContent = '🎬 ' + rpDateText(h.created);
  el.appendChild(title);

  const info = document.createElement('div');
  info.className = 'dk-info';
  // 이름/모드는 외부에서 받은 파일일 수 있으므로 반드시 textContent로만 넣는다.
  const pl = Array.isArray(h.players) ? h.players : [];
  const vs = document.createElement('div');
  vs.textContent = pl.map(p=>`${p.name}${card(p.legendN)?' ('+card(p.legendN).ko+')':''}`).join('  vs  ') || '(정보 없음)';
  info.appendChild(vs);

  const mode = document.createElement('div');
  mode.textContent = h.mode || '';   // 모드 문구에 이미 자동/수동 표기가 들어 있다
  info.appendChild(mode);

  const res = document.createElement('div');
  if(h.result){
    const w = pl[h.result.winner];
    const pts = Array.isArray(h.result.points) ? h.result.points.join(' : ') : '';
    res.textContent = `🏆 ${w?w.name:'?'} 승 (${pts}) · ${h.result.turns||'?'}턴`;
    res.style.color = '#ffe07f';
  } else {
    res.textContent = '⏸ 진행 중 저장 (미완료 경기)';
    res.style.color = '#9aa4bd';
  }
  info.appendChild(res);

  const meta2 = document.createElement('div');
  meta2.textContent = `${h.frames||0}스텝 · ${rpBytesText(row.size)}${h.app?' · v'+h.app:''}`;
  meta2.style.color = '#7d879e';
  info.appendChild(meta2);
  el.appendChild(info);

  const btns = document.createElement('div');
  btns.className = 'dk-btns';
  const bPlay = document.createElement('button');
  bPlay.textContent = '▶ 재생'; bPlay.className = 'rp-play';
  bPlay.onclick = ()=>REPLAY.playFromStore(row.id);
  const bExp = document.createElement('button');
  bExp.textContent = '📤 내보내기';
  bExp.onclick = async ()=>{
    try{
      const bytes = await RPStore.read(row.id);
      const out = await rpExport(row.id, bytes);
      if(out) UI.toast('내보냈습니다: '+out);
    }catch(e){ UI.toast('내보내기 실패: '+(e.message||e),'warn'); }
  };
  const bDel = document.createElement('button');
  bDel.textContent = '🗑';
  bDel.onclick = ()=>rpConfirmDelete(row.id);
  btns.appendChild(bPlay); btns.appendChild(bExp); btns.appendChild(bDel);
  el.appendChild(btns);
  return el;
}

function rpConfirmDelete(id){
  const box = rpEl('modal-box');
  box.innerHTML = '<h3>리플레이 삭제</h3>';
  const p = document.createElement('div');
  p.style.cssText = 'font-size:13px;line-height:1.7;margin-bottom:6px;word-break:break-all';
  p.textContent = id + ' 을(를) 삭제할까요? 되돌릴 수 없습니다.';
  box.appendChild(p);
  const btns = document.createElement('div'); btns.className = 'modal-btns';
  const yes = document.createElement('button'); yes.className = 'primary'; yes.textContent = '삭제';
  yes.onclick = async ()=>{
    closeModal();
    try{ await RPStore.del(id); UI.toast('삭제했습니다'); }
    catch(e){ UI.toast('삭제 실패: '+(e.message||e),'warn'); }
    REPLAY.refreshLibrary();
  };
  const no = document.createElement('button'); no.textContent = '취소'; no.onclick = closeModal;
  btns.appendChild(yes); btns.appendChild(no);
  box.appendChild(btns);
  openModal(); markModalDismissable();
}

// 파일 가져오기 (다른 사람이 보내준 .rbr)
REPLAY.importFile = async function(file){
  if(!file) return;
  try{
    const buf = new Uint8Array(await file.arrayBuffer());
    const data = await rpParseFile(buf);           // 검증 겸 파싱
    const id = rpSafeName(file.name.replace(/\.rbr$/i,'')) + '.rbr';
    await RPStore.save(id, buf, data.header);
    UI.toast('가져왔습니다: ' + id);
    REPLAY.refreshLibrary();
  }catch(e){
    UI.toast('가져오기 실패: '+(e.message||e),'warn');
  }
};

REPLAY.playFromStore = async function(id){
  try{
    const bytes = await RPStore.read(id);
    const data = await rpParseFile(bytes);
    REPLAY.open(data, id);
  }catch(e){
    UI.toast('재생할 수 없습니다: '+(e.message||e),'warn');
  }
};

// ══════════ 재생 ══════════
REPLAY.open = function(data, id){
  // 재생은 전역 G를 덮어쓰므로, 자동 진행 주체를 모두 멈춘다.
  if(typeof BOT!=='undefined') BOT.active = false;
  NET.online = false; NET.seat = null;
  if(typeof NET.resetGameSync === 'function') NET.resetGameSync();

  REPLAY.data = data;
  REPLAY.title = id || '리플레이';
  REPLAY.viewing = true;
  REPLAY.recording = false;
  REPLAY.idx = 0;
  REPLAY._logUpTo = -1;
  REPLAY.realtime = false;
  REPLAY.speedMs = 700;

  document.body.classList.add('replay-mode');
  rpEl('replay-bar').style.display = 'flex';
  rpEl('log').textContent = '';
  UI.prompt('');
  const ni = rpEl('net-info');
  const h = data.header || {};
  ni.textContent = `🎬 리플레이 관전 — ${h.mode||''} · ${rpDateText(h.created)}`;

  rpEl('rb-slider').max = String(data.frames.length - 1);
  rpEl('rb-speed').value = '700';
  showScreen('game-screen');
  REPLAY.seek(0);
  UI.toast('🎬 리플레이 관전 모드 — 양측 손패가 모두 공개됩니다');
};

REPLAY.close = function(){
  REPLAY.pause();
  REPLAY.viewing = false;
  REPLAY.data = null;
  document.body.classList.remove('replay-mode');
  rpEl('replay-bar').style.display = 'none';
  rpEl('log').textContent = '';
  rpEl('net-info').textContent = '';
  rpEl('showdown-banner').style.display = 'none';
  UI.prompt('');
  G = null;
  showScreen('replay-screen');
  REPLAY.refreshLibrary();
};

REPLAY.seek = function(i){
  const d = REPLAY.data; if(!d) return;
  i = Math.max(0, Math.min(d.frames.length-1, i|0));
  REPLAY.idx = i;
  const f = d.frames[i];
  try{
    G = rpClone(d.states[f.s]);
  }catch(e){
    UI.toast('이 구간을 표시할 수 없습니다','warn');
    return;
  }
  REPLAY._syncLog(i);
  try{
    UI.render();
    if(G.state==='showdown' && G.showdown) UI.promptShowdown();
    else rpEl('showdown-banner').style.display = 'none';
  }catch(e){
    console.error('replay render failed', e);
    UI.toast('이 구간을 그릴 수 없습니다 (카드 데이터 불일치)','warn');
  }
  REPLAY._updateBar();
};

// 현재 프레임까지의 로그를 화면에 맞춘다 (앞으로 갈 땐 이어 붙이고, 뒤로 갈 땐 다시 그린다)
REPLAY._syncLog = function(i){
  const d = REPLAY.data, box = rpEl('log');
  let from;
  if(i > REPLAY._logUpTo){ from = REPLAY._logUpTo + 1; }
  else { box.textContent = ''; from = 0; }
  const frag = document.createDocumentFragment();
  for(let k=from; k<=i; k++){
    const f = d.frames[k];
    if(f && f.l !== undefined) frag.appendChild(UI.logEntryEl(f.l, f.c));
  }
  box.appendChild(frag);
  box.scrollTop = box.scrollHeight;
  REPLAY._logUpTo = i;
};

REPLAY.step = function(delta){
  REPLAY.pause();
  REPLAY.seek(REPLAY.idx + delta);
};

// 턴 단위 이동: turnCount가 바뀌는 프레임으로 점프
REPLAY.jumpTurn = function(dir){
  const d = REPLAY.data; if(!d) return;
  REPLAY.pause();
  const tcOf = k => {
    const st = d.states[d.frames[k].s];
    return st ? (st.turnCount|0) : 0;
  };
  const cur = tcOf(REPLAY.idx);
  if(dir > 0){
    for(let k=REPLAY.idx+1; k<d.frames.length; k++) if(tcOf(k) > cur){ REPLAY.seek(k); return; }
    REPLAY.seek(d.frames.length-1);
  } else {
    // 현재 턴의 시작으로, 이미 시작이면 이전 턴의 시작으로
    let start = REPLAY.idx;
    while(start > 0 && tcOf(start-1) === cur) start--;
    if(start < REPLAY.idx){ REPLAY.seek(start); return; }
    const prevTc = start > 0 ? tcOf(start-1) : cur;
    let k = start - 1;
    while(k > 0 && tcOf(k-1) === prevTc) k--;
    REPLAY.seek(Math.max(0, k));
  }
};

REPLAY.play = function(){
  const d = REPLAY.data; if(!d) return;
  if(REPLAY.idx >= d.frames.length-1) REPLAY.seek(0);
  REPLAY.pause();
  const tick = ()=>{
    if(!REPLAY.viewing) return;
    if(REPLAY.idx >= d.frames.length-1){ REPLAY.pause(); return; }
    REPLAY.seek(REPLAY.idx + 1);
    let wait = REPLAY.speedMs;
    if(REPLAY.realtime){
      const a = d.frames[REPLAY.idx-1], b = d.frames[REPLAY.idx];
      wait = Math.max(120, Math.min(3000, (b.t||0) - (a ? a.t||0 : 0)));
    }
    REPLAY.timer = setTimeout(tick, wait);
  };
  REPLAY.timer = setTimeout(tick, REPLAY.realtime ? 400 : REPLAY.speedMs);
  REPLAY._updateBar();
};

REPLAY.pause = function(){
  if(REPLAY.timer){ clearTimeout(REPLAY.timer); REPLAY.timer = null; }
  REPLAY._updateBar();
};

REPLAY.toggle = function(){ REPLAY.timer ? REPLAY.pause() : REPLAY.play(); };

REPLAY._updateBar = function(){
  const d = REPLAY.data; if(!d) return;
  const total = d.frames.length;
  rpEl('rb-slider').value = String(REPLAY.idx);
  const btn = rpEl('rb-play');
  btn.textContent = REPLAY.timer ? '⏸ 일시정지' : '▶ 재생';
  const st = d.states[d.frames[REPLAY.idx].s] || {};
  const turnNo = Math.ceil((st.turnCount||0)/2);
  const who = (st.players && st.players[st.turn]) ? st.players[st.turn].name : '';
  rpEl('rb-pos').textContent = `${REPLAY.idx+1} / ${total} · 턴 ${turnNo}${who?' · '+who:''}`;
};

// ══════════ 훅 (기록 연결) ══════════
(function(){
  // 1) 게임 시작 → 기록 시작
  const _newGame = newGame;
  newGame = function(cfg){
    const r = _newGame(cfg);
    try{ REPLAY._onNewGame(cfg); }catch(e){ console.error('replay start failed', e); }
    return r;
  };
  // 2) 로그 / 렌더 → 스냅샷
  const _log = UI.log;
  UI.log = function(msg, cls){ _log.call(UI, msg, cls); try{ REPLAY.capture(msg, cls); }catch(e){} };
  const _render = UI.render;
  UI.render = function(){ _render.call(UI); try{ REPLAY.capture(); }catch(e){} };
  // 3) 승리 → 결과 기록 + 자동 저장
  const _victory = UI.showVictory;
  UI.showVictory = function(p){ try{ REPLAY._onVictory(p); }catch(e){ console.error(e); } _victory.call(UI, p); };
  // 4) 튜토리얼 게임 표시 (자동 저장 제외용)
  if(typeof TUT!=='undefined' && typeof TUT.start==='function'){
    const _tstart = TUT.start;
    TUT.start = function(){
      REPLAY._tutStarting = true;
      try{ return _tstart.apply(TUT, arguments); }
      finally{ REPLAY._tutStarting = false; }
    };
  }
})();

// ══════════ 버튼 바인딩 ══════════
window.addEventListener('DOMContentLoaded', ()=>{
  const on = (id, fn, ev)=>{ const e=rpEl(id); if(e) e[ev||'onclick']=fn; };

  on('btn-rp-back', ()=>showScreen(REPLAY._returnScreen));
  on('btn-rp-import', ()=>rpEl('rp-file').click());
  on('rp-file', function(){ const f=this.files&&this.files[0]; this.value=''; REPLAY.importFile(f); }, 'onchange');
  on('btn-rp-folder', async ()=>{
    try{ await window.desktop.replay.openDir(); }
    catch(e){ UI.toast('폴더를 열 수 없습니다','warn'); }
  });

  on('rb-close', ()=>REPLAY.close());
  on('rb-first', ()=>{ REPLAY.pause(); REPLAY.seek(0); });
  on('rb-last',  ()=>{ REPLAY.pause(); REPLAY.seek(REPLAY.data.frames.length-1); });
  on('rb-prev',  ()=>REPLAY.step(-1));
  on('rb-next',  ()=>REPLAY.step(1));
  on('rb-turnprev', ()=>REPLAY.jumpTurn(-1));
  on('rb-turnnext', ()=>REPLAY.jumpTurn(1));
  on('rb-play',  ()=>REPLAY.toggle());
  on('rb-slider', function(){ REPLAY.pause(); REPLAY.seek(+this.value); }, 'oninput');
  on('rb-speed', function(){
    REPLAY.realtime = (this.value === 'real');
    if(!REPLAY.realtime) REPLAY.speedMs = +this.value;
    if(REPLAY.timer){ REPLAY.pause(); REPLAY.play(); }
  }, 'onchange');

  // 관전 중 단축키: Space=재생/정지, ←/→=한 스텝
  document.addEventListener('keydown', (e)=>{
    if(!REPLAY.viewing) return;
    if(rpEl('modal-overlay').style.display !== 'none') return;
    if(e.key === ' '){ e.preventDefault(); REPLAY.toggle(); }
    else if(e.key === 'ArrowRight'){ e.preventDefault(); REPLAY.step(1); }
    else if(e.key === 'ArrowLeft'){ e.preventDefault(); REPLAY.step(-1); }
  });
});
