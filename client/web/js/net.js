// ══════════ 온라인: 인증/덱 API + WebSocket 락스텝 동기화 ══════════
const NET = {
  online:false, token:null, userId:null, ws:null, seat:null,
  base:'',   // 서버 origin (예: https://my.ngrok-free.app 또는 http://192.168.0.5:8321). 데스크톱 클라이언트에서 설정.
  choiceSeq:0, pendingChoices:{}, actionQueue:[], processing:false,
  earlyChoices:{},          // 엔진이 묻기 전에 도착한 선택 응답 (관전자가 진행 중 게임을 따라잡을 때)
  spectating:false,         // 관전자: 좌석 없이(-1) 액션·선택을 받아 같은 게임을 그린다
  spectView:'both',         // 관전자가 손패를 보는 쪽: 'both' | 0 | 1 | 'none'
  onRooms:null, onStart:null, onErr:null, onOppLeft:null,
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
    ws.onopen = ()=>ws.send(JSON.stringify({t:'auth',token:NET.token}));
    ws.onmessage = ev=>{
      const m = JSON.parse(ev.data);
      switch(m.t){
        case 'authOk': res(); break;
        case 'authFail': rej(new Error('인증 실패 — 다시 로그인하세요')); break;
        case 'rooms': NET.onRooms && NET.onRooms(m.rooms); break;
        case 'roomCreated': NET.onRoomCreated && NET.onRoomCreated(m.room); break;
        case 'spectating': NET.onSpectating && NET.onSpectating(m.room); break;
        case 'start':
          NET.onStart && NET.onStart(m);
          if(!m.spectate) NET._verSendCheck();   // 서버를 못 믿는 경로 대비: 채팅 채널로 클라끼리 버전 검증 (관전자는 제외)
          break;
        case 'err': NET.onErr && NET.onErr(m.msg); break;
        case 'opponentLeft': NET.onOppLeft && NET.onOppLeft(); break;
        case 'chat':
          if(NET._verIntercept(m)) break;    // 버전 확인 메시지는 채팅으로 표시하지 않고 가로챈다
          NET.onChat && NET.onChat(m);
          break;
        case 'act': NET._enqueueAction(m); break;
        case 'choice': NET._resolveChoice(m); break;
      }
    };
    ws.onclose = ()=>{
      if(!NET.online) return;
      // 대전 중이었다면 조용히 두면 안 된다 — 보드는 그대로인데 어떤 행동도 전달되지 않는다.
      // (서버가 재시작되면 방 자체가 사라지므로 이어서 둘 방법이 없다)
      const inGame = typeof G!=='undefined' && G && G.winner===null;
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
    // 턴 시작 연출이 끝날 때까지 큐를 멈추되, 연출이 어떤 이유로든 안 끝나도 3초 뒤엔 진행한다
    if(G?.phase==='turn-intro' && UI.turnIntroDone) await Promise.race([UI.turnIntroDone, new Promise(r=>setTimeout(r,3000))]);
    const { a, seat } = NET.actionQueue.shift();
    try {
      if(!NET._authorized(a, seat)){ console.warn('rejected unauthorized action', a, 'seat', seat); updateButtons(); continue; }
      await NET._execAction(a);
    }
    catch(e){ console.error('action error', a, e); UI.toast('동기화 오류: '+e.message,'warn'); }
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
    case 'move':      return seat === G.turn && G.turn === G.actingPlayer;
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
    UI.toast('지금은 패스할 수 없습니다','warn'); return;
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
  const pr = new Promise(res=>{ NET.pendingChoices[id] = { res, deserialize, p }; });
  // 관전자가 진행 중인 게임을 따라잡을 때는 선택 응답이 엔진이 묻기 전에 먼저 와 있다 — 그걸 바로 쓴다
  if(NET.earlyChoices[id]){ const early=NET.earlyChoices[id]; delete NET.earlyChoices[id]; queueMicrotask(()=>NET._resolveChoice(early)); return pr; }
  if(p===NET.seat){
    interactiveFn().then(v=>{ NET.send({t:'choice', id, data:serialize(v)}); });
  } else {
    // 게임 시작 전(Bo3 전장 선택 등)에는 G가 없을 수 있다 — 시작 메시지의 이름으로 대신한다
    const nm=(typeof G!=='undefined'&&G&&G.players&&G.players[p])?pname(p):(NET.lastStart?.players?.[p]?.id||'상대');
    UI.prompt(`⏳ ${nm} 선택 대기 중...`);
  }
  return pr;
};
NET._resolveChoice = function(m){
  const pc = NET.pendingChoices[m.id];
  if(!pc){ if(typeof m.id==='number') NET.earlyChoices[m.id]=m; return; }
  // 선택 응답은 반드시 그 선택을 요구받은 좌석에서만 와야 함 (상대 선택 가로채기 차단)
  if(typeof m.seat === 'number' && m.seat !== pc.p){ console.warn('rejected choice from wrong seat', m); return; }
  delete NET.pendingChoices[m.id];
  pc.res(pc.deserialize(m.data));
  // 기다리던 선택이 끝났으니 안내를 지금 상태에 맞게 되돌린다.
  // pc.res는 Promise를 풀어 줄 뿐이라 엔진은 다음 마이크로태스크에서 이어진다 →
  // 엔진이 새 안내(다음 대기·결전 등)를 띄우면 그쪽이 덮어쓴다.
  if(!Object.keys(NET.pendingChoices).length && UI.promptForState) UI.promptForState();
};

// ---------- 게임 종료/이탈 정리 ----------
NET.resetGameSync = function(){
  UI.resetScorePresentation?.();
  UI.resetSpellStage?.();
  NET.choiceSeq=0; NET.pendingChoices={}; NET.earlyChoices={}; NET.actionQueue=[]; NET.processing=false;
};
