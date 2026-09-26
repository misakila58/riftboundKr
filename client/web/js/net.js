// ══════════ 온라인: 인증/덱 API + WebSocket 락스텝 동기화 ══════════
const NET = {
  online:false, token:null, userId:null, ws:null, seat:null,
  base:'',   // 서버 origin (예: https://my.ngrok-free.app 또는 http://192.168.0.5:8321). 데스크톱 클라이언트에서 설정.
  choiceSeq:0, pendingChoices:{}, actionQueue:[], processing:false,
  earlyChoices:{},          // 엔진이 묻기 전에 도착한 선택 응답 (관전자가 진행 중 게임을 따라잡을 때)
  spectating:false,         // 관전자: 좌석 없이(-1) 액션·선택을 받아 같은 게임을 그린다
  spectView:'both',         // 관전자가 손패를 보는 쪽: 'both' | 0 | 1 | 'none'
  onRooms:null, onStart:null, onErr:null, onOppLeft:null,
  // 재접속: 연결이 끊긴 진행 중 대전에 같은 계정으로 다시 붙어 서버의 행동/선택 로그를 재생해 따라잡는다 (2026-09-24)
  reconnecting:false,       // 끊김 뒤 재연결 시도 중 (행동 입력 차단)
  catchingUp:false,         // 로그 재생으로 따라잡는 중 (연출 생략·입력 차단·핸드셰이크 전송 금지)
  rejoined:false,           // 이번 게임은 재접속으로 이어받았다 (부분 기록이라 리플레이 공유 제외)
  startPending:false,       // 재대결 신호로 새 게임 시작을 예약함 — newGame 전까지 행동 펌프 정지
  leaving:false,            // 사용자가 방을 나가는 중 — 소켓 종료를 끊김으로 보지 않는다
  oppAway:false,            // 상대 좌석이 끊겨 재접속 대기 중
};

// 방 입장·P2P·채팅 버전 확인에 쓰는 클라이언트 버전 문자열
// 주문 준비 선택과 주사위 완료 동기화가 없는 원본 클라이언트와의 혼합 매치를 막는다.
NET.clientVersion = ()=>(typeof BUILDINFO!=='undefined'?BUILDINFO.version:'?');   // 빌드마다 버전이 오르므로 별도 접미사는 두지 않는다

// 서버 주소 설정/정규화 (끝 슬래시 제거)
NET.setBase = function(url){
  NET.base = String(url||'').trim().replace(/\/+$/,'');
  return NET.base;
};
// 서버 주소 → WebSocket URL (http→ws, https→wss)
NET.wsUrl = function(){
  if(NET.base) return NET.base.replace(/^http/i,'ws');
  const proto = location.protocol==='https:'?'wss':'ws';
  return `${proto}://${location.host}`;
};
// 헬스체크 (서버 주소 유효성 확인)
NET.health = async function(){
  const r = await fetch(NET.base + '/api/health', { method:'GET' });
  if(!r.ok) throw new Error('서버 응답 오류 ('+r.status+')');
  const d = await r.json();
  if(!d || !d.ok) throw new Error('리프트바운드 서버가 아닙니다');
  NET.requiresAccess = !!d.requiresAccess;
  return d;
};

// ---------- REST ----------
NET.api = async function(path, method='GET', body){
  const r = await fetch(NET.base + path, {
    method,
    headers: { 'Content-Type':'application/json', ...(NET.token?{Authorization:'Bearer '+NET.token}:{}) },
    body: body?JSON.stringify(body):undefined,
  });
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||('HTTP '+r.status));
  return data;
};
NET.requiresAccess=false; // 서버가 접근 코드를 요구하는지 (health에서 갱신)
NET.register = (id,pw,invite)=>NET.api('/api/register','POST',{id,pw,invite}).then(d=>{NET.token=d.token;NET.userId=d.id;localStorage.setItem('rb_token',d.token);localStorage.setItem('rb_id',d.id);return d;});
NET.login    = (id,pw)=>NET.api('/api/login','POST',{id,pw}).then(d=>{NET.token=d.token;NET.userId=d.id;localStorage.setItem('rb_token',d.token);localStorage.setItem('rb_id',d.id);return d;});
NET.getDecks = ()=>NET.api('/api/decks').then(d=>d.decks);
NET.saveDeck = (deck,index)=>NET.api('/api/decks','POST',{deck,index}).then(d=>d.decks);
NET.delDeck  = (idx)=>NET.api('/api/decks/'+idx,'DELETE').then(d=>d.decks);
// 개인 전적 (익명 통계와 별개 — 내 계정에만 쌓이고 나만 본다)
NET.getRecord   = ()=>NET.api('/api/record');
NET.putRecord   = (body)=>NET.api('/api/record','POST',body);
NET.clearRecord = ()=>NET.api('/api/record','DELETE');

// ---------- WebSocket ----------
NET.connect = function(){
  return new Promise((res,rej)=>{
    const ws = new WebSocket(NET.wsUrl());
    NET.ws = ws;
    let authed=false;
    ws.onopen = ()=>ws.send(JSON.stringify({t:'auth',token:NET.token}));
    ws.onerror = ()=>{ if(!authed) rej(new Error('서버에 연결할 수 없습니다')); };
    ws.onmessage = ev=>{
      const m = JSON.parse(ev.data);
      switch(m.t){
        case 'authOk': authed=true; res(); break;
        case 'authFail': rej(new Error('인증 실패 — 다시 로그인하세요')); break;
        case 'rooms': NET.onRooms && NET.onRooms(m.rooms); break;
        case 'roomCreated': NET.onRoomCreated && NET.onRoomCreated(m.room); break;
        case 'spectating': NET.onSpectating && NET.onSpectating(m.room); break;
        case 'start':
          if(m.rejoin){ NET.catchingUp=true; NET.rejoined=true; NET.reconnecting=false; }   // 로그 재생 시작 — 끝은 rejoinDone
          NET.onStart && NET.onStart(m);
          if(!m.spectate && !m.rejoin) NET._verSendCheck();   // 서버를 못 믿는 경로 대비: 채팅 채널로 클라끼리 버전 검증 (관전자·재접속은 제외)
          break;
        case 'rejoinDone': NET._enqueueAction({ action:{k:'_rejoinDone'}, seat:-1 }); break;   // 로그 뒤에 줄을 서서, 다 재생된 뒤 복귀 처리
        case 'rejoinNone': NET._onRejoinNone(); break;
        case 'opponentAway': NET.oppAway=true; UI.toast('상대 연결이 끊겼습니다 — 재접속을 기다립니다 (최대 2분)','warn'); UI.promptForState?.(); break;
        case 'opponentBack': NET.oppAway=false; UI.toast('상대가 다시 접속했습니다'); UI.promptForState?.(); break;
        case 'err': NET.onErr && NET.onErr(m.msg); break;
        case 'opponentLeft': NET.oppAway=false; NET.clearRejoinFlag(); NET.onOppLeft && NET.onOppLeft(); break;
        case 'chat':
          if(NET._verIntercept(m)) break;    // 버전 확인 메시지는 채팅으로 표시하지 않고 가로챈다
          NET.onChat && NET.onChat(m);
          break;
        case 'act': NET._enqueueAction(m); break;
        case 'choice': NET._resolveChoice(m); break;
      }
    };
    ws.onclose = ()=>{
      if(!authed){ rej(new Error('서버에 연결할 수 없습니다')); return; }
      if(NET.ws!==ws) return;              // 이미 새 소켓으로 바뀐 옛 소켓
      if(!NET.online) return;
      const inGame = typeof G!=='undefined' && G && G.winner===null;
      // 대전 중 끊김: 로비로 내보내지 않고 재접속을 시도한다 — 서버가 좌석을 2분 비워 두고(재시작 뒤 복원 포함) 로그를 다시 보내 준다
      if(inGame && !NET.spectating && !NET.leaving){ NET.reconnect(); return; }
      NET.online = false;
      if(inGame){
        UI.prompt('⚠ 서버 연결이 끊어졌습니다 — 이 대전은 이어서 진행할 수 없습니다');
        setTimeout(()=>{
          alert('서버와의 연결이 끊어졌습니다.\n\n'
              + '서버가 갱신 중이거나 네트워크가 끊긴 경우입니다.\n'
              + '진행 중이던 대전은 이어서 둘 수 없습니다 — 로비로 돌아갑니다.');
          location.reload();
        }, 100);
      } else {
        UI.toast('서버 연결이 끊어졌습니다','warn');
      }
    };
  });
};
// ── 재접속 ──
// 끊긴 뒤 2분까지 점점 간격을 늘려 다시 연결하고 rejoin을 보낸다. 서버는 start(rejoin)+행동/선택 로그+rejoinDone으로 답한다.
NET.reconnect = async function(){
  if(NET.reconnecting) return;
  NET.reconnecting=true;
  UI.prompt('⚠ 서버 연결이 끊어졌습니다 — 재접속 시도 중… (최대 2분, 그동안 상대는 기다립니다)');
  const delays=[1000,2000,3000,5000], t0=Date.now(); let n=0;
  while(Date.now()-t0 < 2*60*1000+15000){   // 서버 유예(2분)보다 조금 더 — 만료 뒤엔 rejoinNone으로 정리된다
    await new Promise(r=>setTimeout(r, delays[Math.min(n++, delays.length-1)]));
    if(!NET.reconnecting) return;                      // 그 사이 사용자가 나갔거나 복귀가 끝남
    try{
      await NET.connect();
      NET.send({t:'rejoin'});
      return;                                          // 이후 흐름은 start(rejoin)/rejoinNone 메시지가 이끈다
    }catch(e){ UI.prompt(`⚠ 재접속 시도 중… (${n}회 실패, 계속 시도합니다)`); }
  }
  NET.reconnecting=false;
  alert('서버에 다시 연결하지 못했습니다.\n\n로비로 돌아갑니다.');
  location.reload();
};
NET._onRejoinNone = function(){
  NET.clearRejoinFlag();
  NET.reconnecting=false;
  const inGame = typeof G!=='undefined' && G && G.winner===null && NET.online;
  if(inGame){ alert('복귀할 대전이 없습니다 (상대가 나갔거나 대기 시간이 지났습니다).\n\n로비로 돌아갑니다.'); location.reload(); }
  else UI.toast('복귀할 진행 중 대전이 없습니다');
};
// 로그 재생이 끝났다 — 연출·입력 잠금을 풀고 지금 상태에 맞는 안내로
NET.finishCatchUp = function(){
  if(!NET.catchingUp) return;   // 한 번만 (라이브 경계 감지와 rejoinDone 표식 둘 다 부른다)
  NET.catchingUp=false; NET.reconnecting=false; NET.startPending=false;
  try{ UI.render(); UI.promptForState(); }catch(e){}
  UI.toast('진행 중이던 대전에 복귀했습니다');
};
// 새로고침·앱 재시작 뒤 자동 복귀용 표식 (기기 저장). 게임 시작 때 켜고, 방을 나가거나 상대가 나가면 끈다.
NET.setRejoinFlag   = function(){ try{ localStorage.setItem('rb_rejoin', JSON.stringify({server:NET.base, at:Date.now()})); }catch(e){} };
NET.clearRejoinFlag = function(){ try{ localStorage.removeItem('rb_rejoin'); }catch(e){} };
NET.readRejoinFlag  = function(){ try{ return JSON.parse(localStorage.getItem('rb_rejoin')||'null'); }catch(e){ return null; } };
// ── 클라이언트 간 버전 검증 (서버 무관) ──
// 서버는 채팅을 그대로 릴레이하므로, 게임 시작 직후 채팅 채널로 버전 확인 메시지를 보낸다.
// 신버전 클라는 이 메시지를 가로채 비교하고(화면에 안 보임), 구버전 클라는 채팅으로 그대로
// 표시되므로 안내문 자체가 "당신이 구버전"이라는 경고가 된다. 서버를 업데이트하지 않아도 동작.
const VERCHK_PREFIX = '[버전 확인] v';
NET._peerVer = null;
NET._verSendCheck = function(){
  NET._peerVer = null; NET._verEcho = false;
  const my = NET.clientVersion();
  NET.send({ t:'chat', msg: VERCHK_PREFIX + my + ' — 이 메시지가 채팅에 보이면 이 앱이 구버전입니다. 최신 버전으로 업데이트해 주세요.' });
  // 상대의 버전 확인이 일정 시간 안 오면 = 상대가 이 기능 이전 버전 → 어긋남 위험 경고.
  // 내 에코조차 없으면 서버가 채팅 릴레이 자체를 모르는 아주 옛 서버 — 판정 불가라 침묵한다
  setTimeout(()=>{
    if(!NET.online || NET._peerVer !== null || !NET._verEcho) return;
    if(typeof G==='undefined' || !G || G.winner!==null) return;
    const msg = '⚠ 상대 클라이언트가 구버전으로 보입니다 (버전 응답 없음). 게임이 어긋날 수 있으니 두 분 모두 최신 버전(v'+my+')으로 맞춰 주세요.';
    UI.toast(msg, 'warn'); UI.log(msg, 'sys');
  }, 7000);
};
NET._verIntercept = function(m){
  if(typeof m.msg !== 'string' || !m.msg.startsWith(VERCHK_PREFIX)) return false;
  if(m.from === NET.userId){ NET._verEcho = true; return true; }   // 내 에코는 숨기기만
  const peer = (m.msg.slice(VERCHK_PREFIX.length).split(' ')[0] || '?');
  NET._peerVer = peer;
  const my = NET.clientVersion();
  if(peer !== my){
    const msg = `🔄 앱 버전이 다릅니다 (나 v${my} / 상대 v${peer}) — 진행하면 게임이 어긋날 수 있습니다. 두 분 모두 최신 버전으로 업데이트한 뒤 다시 시작하세요.`;
    UI.toast(msg, 'warn'); UI.log(msg, 'sys');
    if(UI.chatMuted !== undefined && NET.onChat) NET.onChat({ from:'시스템', msg });   // 채팅 팝업에도 남겨 눈에 띄게
  }
  return true;
};
NET.send = obj=>{
  if(typeof P2P!=='undefined' && P2P.active){ P2P.netSend(obj); return; } // P2P 직접 대전 경로
  if(NET.ws && NET.ws.readyState===1){ NET.ws.send(JSON.stringify(obj)); return; }
  // 소켓이 닫힌 뒤의 행동을 말없이 버리면, 화면은 멀쩡한데 아무 반응이 없는 상태가 된다
  UI.toast('서버에 연결되어 있지 않아 행동이 전달되지 않았습니다','warn');
};

// ---------- 락스텝: 액션 ----------
// 사용자가 취한 행동은 서버로 전송 → 서버가 순서를 부여해 양측에 에코 → 양측이 동일하게 실행
NET.sendAction = function(action){
  NET.send({t:'act', action});
};
NET._enqueueAction = function(m){
  if(m.action?.k==='play' && m.action.opts?.stageSpell && m.seat===NET.seat){
    UI.spellStageSubmitting=false;
  }
  // 외형 정보는 선택 대기로 멈춘 액션 큐와 게임/리플레이 기록을 거치지 않는다.
  if(m.action?.k==='playmat'){
    PLAYMAT.receive(m.action,m.seat);
    return;
  }
  // 서버가 확정한 발신 좌석을 함께 큐잉 (위장 방지 검증에 사용)
  NET.actionQueue.push({ a:m.action, seat:m.seat });
  NET._pump();
};
NET._pump = async function(){
  if(NET.processing) return;
  NET.processing = true;
  while(NET.actionQueue.length){
    // 재대결 신호로 새 게임 시작이 예약됐으면 newGame이 만들어질 때까지 기다린다 (그 전에 다음 행동을 실행하면 옛 게임에 적용된다)
    while(NET.startPending) await new Promise(r=>setTimeout(r,20));
    // 준비 단계(주사위·멀리건·시작 단계) 동안은 행동을 실행하지 않는다 — 재접속·관전 따라잡기에서 로그가 한꺼번에 오고,
    // 평소에도 상대 클라이언트가 먼저 행동 단계에 들어가 행동을 보낼 수 있다
    while(typeof G!=='undefined' && G && G.winner===null && !['action','ending'].includes(G.phase) && !NET.startPending) await new Promise(r=>setTimeout(r,50));
    // 턴 시작 연출이 끝날 때까지 큐를 멈추되, 연출이 어떤 이유로든 안 끝나도 3초 뒤엔 진행한다
    if(G?.phase==='turn-intro' && UI.turnIntroDone) await Promise.race([UI.turnIntroDone, new Promise(r=>setTimeout(r,3000))]);
    const { a, seat } = NET.actionQueue.shift();
    if(a && a.k==='_rejoinDone'){ NET.finishCatchUp(); continue; }   // 로그 재생 완료 표식 (서버 rejoinDone)
    try {
      if(!NET._authorized(a, seat)){ console.warn('rejected unauthorized action', a, 'seat', seat); updateButtons(); continue; }
      await NET._execAction(a);
    }
    catch(e){
      console.error('action error', a, e); UI.toast('동기화 오류: '+e.message,'warn');
      // 행동 도중 예외가 나면 화면이 중간 상태로 남는다 — 지금 상태로 다시 그려 버튼·안내가 잠기지 않게 한다
      try{ UI.render(); UI.promptForState(); }catch(e2){}
    }
  }
  NET.processing = false;
};
// 발신 좌석이 해당 행동을 할 권한이 있는지 검증 (상대 명의 조작·턴 훔치기 차단)
NET._authorized = function(a, seat){
  // 게임 시작 전(첫 게임 사이드보딩)에는 덱 교환 핸드셰이크만 받는다
  if(!G) return ['rematch','rematchGo','rematchDecline'].includes(a.k) && (typeof a.p !== 'number' || a.p === seat);
  // 행동 주체가 명시된 경우: 발신 좌석과 일치해야 함
  if(typeof a.p === 'number' && a.p !== seat) return false;
  switch(a.k){
    case 'endTurn':   return seat === G.turn && G.phase === 'action' && G.state === 'neutral'
      && G.turn === G.actingPlayer && !G._endingTurn;
    case 'pass':      return G.state === 'showdown' && seat === G.actingPlayer && G.showdown
      && !G.showdown.resolvingItem && !G.showdown.finalizingTriggers && !G.showdown.pendingTriggers?.length;
    case 'move': {
      if(seat!==G.turn || G.turn!==G.actingPlayer || G.winner!==null
        || G.state!=='neutral' || G.phase!=='action' || a.p!==seat
        || !Array.isArray(a.uids) || !a.uids.length || new Set(a.uids).size!==a.uids.length
        || !(a.dest==='base' || (Number.isInteger(a.dest) && G.bfs[a.dest]))) return false;
      const units=everyUnit();
      return a.uids.every(uid=>Number.isInteger(uid) && units.some(u=>u.uid===uid && u.ctrl===seat));
    }
    case 'play': case 'hide': case 'playHidden': case 'ability': case 'equip':
      // 자기 카드/능력만 (a.p 검증으로 이미 보장). 결전 중엔 acting 좌석만.
      if(G.state==='showdown') return seat === G.actingPlayer;
      return seat === G.turn;
    case 'manual':
      // 수동 도구는 현재 행동 좌석(자기 턴 또는 결전 응답 차례)만 사용 가능
      return seat === G.actingPlayer;
    case 'runeFloat': return seat === G.actingPlayer;   // 자원 띄우기는 행동 차례에만
    default: return true;
  }
};
NET._execAction = async function(a){
  if(a.k==='play' && a.opts?.stageSpell && a.p===NET.seat) UI.spellStageSubmitting=false;
  switch(a.k){
    case 'play':      await playCardFromHand(a.p, a.handIdx, a.opts||{}); break;
    case 'hide':      await hideCard(a.p, a.handIdx); break;
    case 'playHidden':await playHidden(a.p, a.bfIdx, G.bfs[a.bfIdx]?.hiddenCards[a.hiddenIndex]); break;
    case 'move': {
      if(typeof UI.finishCombatMove==='function') UI.finishCombatMove();
      const units = a.uids.map(uid=>everyUnit().find(u=>u.uid===uid)).filter(Boolean);
      if(units.length) await moveUnits(a.p, units, a.dest);
      break; }
    case 'endTurn':   await endTurn(); break;
    case 'pass':      await showdownPass(); break;
    case 'runeFloat': await runeFloat(a.p, a.idx, a.mode); break;
    case 'ability': {
      let src=null;
      if(a.src.kind==='legend') src={kind:'legend'};
      else if(a.src.kind==='unit'){ const u=everyUnit().find(u=>u.uid===a.src.uid); if(!u) return; src={kind:'unit',u}; }
      else if(a.src.kind==='gear'){ const g=G.players[a.p].gear[a.src.gearIdx]; if(!g) return; src={kind:'gear',g}; }
      if(a.copy && src && src.u){   // 하이머딩거(111) 복사 능력(ui.js copy 경로) — 원 카드 이름·라벨로 찾아 복사 표시로 발동 (예전엔 abIdx가 없어 상대 화면에서 무시됐다)
        const P=G.players[a.p]; let found=null;
        const scan=(f,name)=>{ if(found||!f||name!==a.copy.srcName) return; found=(f.activated||[]).find(x=>x.label===a.copy.label)||null; };
        scan(FX[P.legendN], card(P.legendN).ko); P.gear.forEach(g=>scan(FX[g.n], card(g.n).ko)); everyUnit().filter(x=>x.ctrl===a.p&&x!==src.u&&!x.isToken).forEach(x=>scan(unitFx(x), unitName(x)));
        if(found) await activateAbility(a.p, src, {...found, copied:true});
        break;
      }
      const fx = a.src.kind==='legend' ? FX[G.players[a.p].legendN] : (src.u?unitFx(src.u):FX[src.g.n]);
      const ab = (fx.activated||[])[a.abIdx];
      if(ab) await activateAbility(a.p, src, ab);
      break; }
    case 'equip': await equipGear(a.p, a.gearIdx); break;
    case 'surrender': surrender(a.p); break;
    // 재대결 핸드셰이크 (게임 액션 아님 — 릴레이만 이용, 처리는 main.js의 RM)
    case 'rematch':        if(typeof RM!=='undefined') RM.onRequest(a); break;
    case 'rematchDecline': if(typeof RM!=='undefined') RM.onDecline(a); break;
    case 'rematchGo':      if(typeof RM!=='undefined') RM.onGo(a); break;
    case 'manual': {
      const fn = ManualTools[a.tool]; if(!fn) return;
      const args = a.args.map(x=>{
        if(x && typeof x==='object' && x.uid!==undefined) return everyUnit().find(u=>u.uid===x.uid);
        return x;
      });
      if(args.some(x=>x===undefined)) return;
      fn(...args);
      break; }
  }
};

// 로컬 UI가 액션을 개시할 때 호출: 온라인이면 서버 경유, 오프라인이면 즉시 실행
NET.dispatch = function(action, localFn){
  if(G?.phase==='turn-intro' && !['surrender','playmat'].includes(action.k)) return;
  // 리플레이 관전 중에는 어떤 행동도 게임 상태를 바꾸지 못하게 한다 (최종 차단선)
  if(typeof REPLAY!=='undefined' && REPLAY.viewing) return;
  if(NET.spectating){ UI.toast('관전 중에는 조작할 수 없습니다','warn'); return; }
  if(NET.reconnecting || NET.catchingUp){ UI.toast('재접속 중입니다 — 잠시만 기다려 주세요','warn'); return; }
  if(UI.spellStage || UI.spellStageSubmitting){
    UI.toast('준비 중인 주문을 확인하거나 손패로 되돌려 주세요','warn'); return;
  }
  if(UI.placementPending){ UI.toast('강조된 위치의 선택을 먼저 마쳐 주세요','warn'); return; }
  if(UI.unitSelectionPending){ UI.toast('카드 선택을 먼저 마쳐 주세요','warn'); return; }
  if(typeof UI.combatMoveBlocks==='function' && UI.combatMoveBlocks(action)) return;
  if(action.k==='endTurn' && UI.canEndTurn && !UI.canEndTurn()){
    UI.toast('지금은 턴을 종료할 수 없습니다','warn'); return;
  }
  if(action.k==='pass' && UI.canShowdownPass && !UI.canShowdownPass()){
    const why=UI.passBlockReason?.();
    UI.toast('지금은 패스할 수 없습니다'+(why?' — '+why:''),'warn'); return;
  }
  if(NET.online){
    if(action.k==='play' && action.opts?.stageSpell){
      UI.spellStageSubmitting=true;
      updateButtons();
      // 서버 에코가 오지 않으면(연결 문제·서버 거부) 영구히 잠기지 않게 8초 뒤 풀어 준다
      clearTimeout(NET._stageTimer);
      NET._stageTimer=setTimeout(()=>{ if(UI.spellStageSubmitting){ UI.spellStageSubmitting=false; UI.toast('주문 전송 응답이 없어 잠금을 풀었습니다 — 다시 시도해 주세요','warn'); updateButtons(); } }, 8000);
    }
    NET.sendAction(action);
  } else {
    localFn();
  }
};

// ---------- 락스텝: 선택(프롬프트) ----------
// 엔진이 플레이어 p의 선택을 요구할 때:
//  - 내 좌석이면 인터랙티브 UI 실행 → 결과를 서버로 전송 (해결은 에코 수신 시)
//  - 상대 좌석이면 "상대 선택 중..." 표시 후 대기
NET.choice = function(p, interactiveFn, serialize, deserialize){
  const id = ++NET.choiceSeq;
  const label0=NET._nextChoiceLabel||null; NET._nextChoiceLabel=null;   // routedPick이 넘긴 라벨 — 이 선택 한 번만 쓴다
  const pr = new Promise(res=>{ NET.pendingChoices[id] = { res, deserialize, p }; });
  // 관전자가 진행 중인 게임을 따라잡을 때는 선택 응답이 엔진이 묻기 전에 먼저 와 있다 — 그걸 바로 쓴다
  const earlyQ=NET.earlyChoices[id];
  // 따라잡는 중인데 이 선택의 답이 로그에 없다 = 끊기기 전 마지막 지점에 닿았다(그 뒤 행동은 이 답 없이는 생길 수 없다) → 여기서부터 라이브
  if(NET.catchingUp && !(earlyQ && earlyQ.length)) NET.finishCatchUp();
  if(earlyQ && earlyQ.length){ const early=earlyQ.shift(); if(!earlyQ.length) delete NET.earlyChoices[id]; queueMicrotask(()=>NET._resolveChoice(early)); return pr; }
  if(p===NET.seat){
    interactiveFn().then(v=>{ NET.send({t:'choice', id, data:serialize(v)}); });
  } else {
    // 게임 시작 전(Bo3 전장 선택 등)에는 G가 없을 수 있다 — 시작 메시지의 이름으로 대신한다
    const nm=(typeof G!=='undefined'&&G&&G.players&&G.players[p])?pname(p):(NET.lastStart?.players?.[p]?.id||'상대');
    const label=String(label0||'').replace(/\s+/g,' ').trim();   // 무엇을 고르는 중인지 — 멈춘 게 아니라는 걸 알 수 있게
    UI.prompt(`⏳ ${nm} 선택 대기 중${label?' — '+(label.length>48?label.slice(0,47)+'…':label):'...'}`);
  }
  return pr;
};
NET._resolveChoice = function(m){
  const pc = NET.pendingChoices[m.id];
  if(!pc){ if(typeof m.id==='number') (NET.earlyChoices[m.id]||(NET.earlyChoices[m.id]=[])).push(m); return; }   // 아직 묻기 전 — id별 큐(게임마다 번호가 1부터 다시 시작)
  // 선택 응답은 반드시 그 선택을 요구받은 좌석에서만 와야 함 (상대 선택 가로채기 차단)
  if(typeof m.seat === 'number' && m.seat !== pc.p){
    // 두 클라이언트의 선택 순번이 어긋난 상태 — 조용히 버리면 게임이 영원히 멈춘다. 알려서 제보할 수 있게 한다
    console.warn('rejected choice from wrong seat', m, 'expected seat', pc.p);
    UI.toast('동기화 오류: 선택 응답 순서가 어긋났습니다 (상대와 앱 버전이 다르거나 연결 문제) — 이 대전은 이어가기 어려울 수 있습니다','warn');
    return;
  }
  delete NET.pendingChoices[m.id];
  pc.res(pc.deserialize(m.data));
  // 기다리던 선택이 끝났으니 안내를 지금 상태에 맞게 되돌린다.
  // pc.res는 Promise를 풀어 줄 뿐이라 엔진은 다음 마이크로태스크에서 이어진다 →
  // 엔진이 새 안내(다음 대기·결전 등)를 띄우면 그쪽이 덮어쓴다.
  if(!Object.keys(NET.pendingChoices).length && UI.promptForState) UI.promptForState();
};

// ---------- 게임 종료/이탈 정리 ----------
// full=true(방을 나감·리플레이 진입): 큐까지 모두 비운다. 기본(재대결·새 게임 시작): 선택 번호와 대기 선택만 초기화하고,
// 먼저 도착한 다음 게임의 행동/선택(actionQueue·earlyChoices)은 남긴다 — 비우면 상대가 먼저 시작해 보낸 행동이 사라져 어긋난다
NET.resetGameSync = function(full){
  UI.resetScorePresentation?.();
  UI.resetSpellStage?.();
  NET.choiceSeq=0; NET.pendingChoices={};
  if(full){ NET.earlyChoices={}; NET.actionQueue=[]; NET.processing=false; NET.startPending=false; NET.catchingUp=false; NET.rejoined=false; NET.oppAway=false; }
};
