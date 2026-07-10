// ══════════ 온라인: 인증/덱 API + WebSocket 락스텝 동기화 ══════════
const NET = {
  online:false, token:null, userId:null, ws:null, seat:null,
  base:'',   // 서버 origin (예: https://my.ngrok-free.app 또는 http://192.168.0.5:8321). 데스크톱 클라이언트에서 설정.
  choiceSeq:0, pendingChoices:{}, actionQueue:[], processing:false,
  onRooms:null, onStart:null, onErr:null, onOppLeft:null,
};

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
NET.register = (id,pw)=>NET.api('/api/register','POST',{id,pw}).then(d=>{NET.token=d.token;NET.userId=d.id;localStorage.setItem('rb_token',d.token);localStorage.setItem('rb_id',d.id);return d;});
NET.login    = (id,pw)=>NET.api('/api/login','POST',{id,pw}).then(d=>{NET.token=d.token;NET.userId=d.id;localStorage.setItem('rb_token',d.token);localStorage.setItem('rb_id',d.id);return d;});
NET.getDecks = ()=>NET.api('/api/decks').then(d=>d.decks);
NET.saveDeck = (deck,index)=>NET.api('/api/decks','POST',{deck,index}).then(d=>d.decks);
NET.delDeck  = (idx)=>NET.api('/api/decks/'+idx,'DELETE').then(d=>d.decks);

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
        case 'start': NET.onStart && NET.onStart(m); break;
        case 'err': NET.onErr && NET.onErr(m.msg); break;
        case 'opponentLeft': NET.onOppLeft && NET.onOppLeft(); break;
        case 'chat': NET.onChat && NET.onChat(m); break;
        case 'act': NET._enqueueAction(m); break;
        case 'choice': NET._resolveChoice(m); break;
      }
    };
    ws.onclose = ()=>{ if(NET.online){ UI.toast('서버 연결이 끊어졌습니다','warn'); } };
  });
};
NET.send = obj=>{
  if(typeof P2P!=='undefined' && P2P.active){ P2P.netSend(obj); return; } // P2P 직접 대전 경로
  if(NET.ws&&NET.ws.readyState===1) NET.ws.send(JSON.stringify(obj));
};

// ---------- 락스텝: 액션 ----------
// 사용자가 취한 행동은 서버로 전송 → 서버가 순서를 부여해 양측에 에코 → 양측이 동일하게 실행
NET.sendAction = function(action){
  NET.send({t:'act', action});
};
NET._enqueueAction = function(m){
  // 서버가 확정한 발신 좌석을 함께 큐잉 (위장 방지 검증에 사용)
  NET.actionQueue.push({ a:m.action, seat:m.seat });
  NET._pump();
};
NET._pump = async function(){
  if(NET.processing) return;
  NET.processing = true;
  while(NET.actionQueue.length){
    const { a, seat } = NET.actionQueue.shift();
    try {
      if(!NET._authorized(a, seat)){ console.warn('rejected unauthorized action', a, 'seat', seat); continue; }
      await NET._execAction(a);
    }
    catch(e){ console.error('action error', a, e); UI.toast('동기화 오류: '+e.message,'warn'); }
  }
  NET.processing = false;
};
// 발신 좌석이 해당 행동을 할 권한이 있는지 검증 (상대 명의 조작·턴 훔치기 차단)
NET._authorized = function(a, seat){
  if(!G) return false;
  // 행동 주체가 명시된 경우: 발신 좌석과 일치해야 함
  if(typeof a.p === 'number' && a.p !== seat) return false;
  switch(a.k){
    case 'endTurn':   return seat === G.turn && G.state !== 'showdown';
    case 'pass':      return G.state === 'showdown' && seat === G.actingPlayer;
    case 'move':      return seat === G.turn && G.turn === G.actingPlayer;
    case 'play': case 'hide': case 'playHidden': case 'ability': case 'equip':
      // 자기 카드/능력만 (a.p 검증으로 이미 보장). 격돌 중엔 acting 좌석만.
      if(G.state==='showdown') return seat === G.actingPlayer;
      return seat === G.turn;
    case 'manual':
      // 수동 도구는 현재 행동 좌석(자기 턴 또는 격돌 응답 차례)만 사용 가능
      return seat === G.actingPlayer;
    default: return true;
  }
};
NET._execAction = async function(a){
  switch(a.k){
    case 'play':      await playCardFromHand(a.p, a.handIdx, a.opts||{}); break;
    case 'hide':      await hideCard(a.p, a.handIdx); break;
    case 'playHidden':await playHidden(a.p, a.bfIdx); break;
    case 'move': {
      const units = a.uids.map(uid=>everyUnit().find(u=>u.uid===uid)).filter(Boolean);
      if(units.length) await moveUnits(a.p, units, a.dest);
      break; }
    case 'endTurn':   await endTurn(); break;
    case 'pass':      await showdownPass(); break;
    case 'ability': {
      let src=null;
      if(a.src.kind==='legend') src={kind:'legend'};
      else if(a.src.kind==='unit'){ const u=everyUnit().find(u=>u.uid===a.src.uid); if(!u) return; src={kind:'unit',u}; }
      else if(a.src.kind==='gear'){ const g=G.players[a.p].gear[a.src.gearIdx]; if(!g) return; src={kind:'gear',g}; }
      const fx = a.src.kind==='legend' ? FX[G.players[a.p].legendN] : (src.u?unitFx(src.u):FX[src.g.n]);
      const ab = (fx.activated||[])[a.abIdx];
      if(ab) await activateAbility(a.p, src, ab);
      break; }
    case 'equip': await equipGear(a.p, a.gearIdx); break;
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
  if(NET.online){
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
  if(p===NET.seat){
    interactiveFn().then(v=>{ NET.send({t:'choice', id, data:serialize(v)}); });
  } else {
    UI.prompt(`⏳ ${pname(p)} 선택 대기 중...`);
  }
  return pr;
};
NET._resolveChoice = function(m){
  const pc = NET.pendingChoices[m.id];
  if(!pc) return;
  // 선택 응답은 반드시 그 선택을 요구받은 좌석에서만 와야 함 (상대 선택 가로채기 차단)
  if(typeof m.seat === 'number' && m.seat !== pc.p){ console.warn('rejected choice from wrong seat', m); return; }
  delete NET.pendingChoices[m.id];
  pc.res(pc.deserialize(m.data));
};

// ---------- 게임 종료/이탈 정리 ----------
NET.resetGameSync = function(){
  NET.choiceSeq=0; NET.pendingChoices={}; NET.actionQueue=[]; NET.processing=false;
};
