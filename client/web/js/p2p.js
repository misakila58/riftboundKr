// ══════════ P2P 직접 대전 (서버 불필요 · 초대 코드 방식) ══════════
// WebRTC 데이터채널로 두 클라이언트가 직접 연결된다.
// 방장이 '초대 코드'를 만들어 메신저로 전달 → 상대가 '응답 코드'를 돌려주면 연결.
// 연결 후에는 호스트가 서버 릴레이 역할(좌석/순번 확정)을 대신 수행한다.
const P2P = {
  pc:null, ch:null, isHost:false, active:false, seq:0,
  myName:'', myDeck:null, peerName:'상대',
  onStatus:null,
};

P2P._newPc = function(){
  return new RTCPeerConnection({
    iceServers:[{ urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302'] }],
  });
};
// ICE 후보 수집 완료까지 대기 (코드 하나에 연결 정보를 전부 담기 위해)
P2P._waitIce = function(pc){
  return new Promise(res=>{
    if(pc.iceGatheringState==='complete') return res();
    const t=setTimeout(res, 5000);
    pc.addEventListener('icegatheringstatechange', ()=>{
      if(pc.iceGatheringState==='complete'){ clearTimeout(t); res(); }
    });
  });
};
P2P._enc = o=>btoa(unescape(encodeURIComponent(JSON.stringify(o))));
P2P._dec = s=>JSON.parse(decodeURIComponent(escape(atob(String(s).replace(/\s+/g,'')))));

// ---------- 호스트 (방 만들기) ----------
P2P.host = async function(name, deck){
  P2P.reset(); P2P.isHost=true; P2P.myName=name; P2P.myDeck=deck;
  const pc=P2P._newPc(); P2P.pc=pc;
  P2P._bindChannel(pc.createDataChannel('game',{ordered:true}));
  P2P._watchConn(pc);
  await pc.setLocalDescription(await pc.createOffer());
  await P2P._waitIce(pc);
  return P2P._enc({t:'offer', sdp:pc.localDescription});
};
P2P.acceptAnswer = async function(code){
  const m=P2P._dec(code);
  if(m.t!=='answer') throw new Error('응답 코드가 아닙니다. 상대가 만든 "응답 코드"를 붙여넣으세요.');
  await P2P.pc.setRemoteDescription(m.sdp);
};

// ---------- 게스트 (참여하기) ----------
P2P.join = async function(name, deck, hostCode){
  P2P.reset(); P2P.isHost=false; P2P.myName=name; P2P.myDeck=deck;
  const m=P2P._dec(hostCode);
  if(m.t!=='offer') throw new Error('초대 코드가 아닙니다. 방장이 만든 "초대 코드"를 붙여넣으세요.');
  const pc=P2P._newPc(); P2P.pc=pc;
  pc.ondatachannel=(ev)=>P2P._bindChannel(ev.channel);
  P2P._watchConn(pc);
  await pc.setRemoteDescription(m.sdp);
  await pc.setLocalDescription(await pc.createAnswer());
  await P2P._waitIce(pc);
  return P2P._enc({t:'answer', sdp:pc.localDescription});
};

// ---------- 채널/연결 관리 ----------
P2P._bindChannel = function(ch){
  P2P.ch=ch;
  ch.onopen=()=>{
    P2P.active=true;
    P2P.onStatus && P2P.onStatus('connected');
    if(!P2P.isHost){
      ch.send(JSON.stringify({t:'hello', name:P2P.myName, deck:P2P.myDeck}));
    }
  };
  ch.onmessage=(ev)=>{
    let m; try{ m=JSON.parse(ev.data); }catch(e){ return; }
    P2P._onMsg(m);
  };
  ch.onclose=()=>P2P._bye();
  ch.onerror=()=>{};
};
P2P._watchConn = function(pc){
  pc.onconnectionstatechange=()=>{
    if(['failed','disconnected','closed'].includes(pc.connectionState)) P2P._bye();
  };
};
P2P._bye = function(){
  if(!P2P.active) return;
  P2P.active=false;
  NET.onOppLeft && NET.onOppLeft();
};

// ---------- 메시지 처리 ----------
P2P._onMsg = function(m){
  if(P2P.isHost){
    switch(m.t){
      case 'hello': {
        // 게스트 정보 수신 → 시드 생성, 양측 게임 시작 (호스트=좌석0)
        P2P.peerName = String(m.name||'상대').slice(0,16);
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        const players = [ {id:P2P.myName, deck:P2P.myDeck}, {id:P2P.peerName, deck:m.deck} ];
        P2P.ch.send(JSON.stringify({t:'start', seed, players, yourSeat:1}));
        NET.onStart && NET.onStart({t:'start', seed, players, yourSeat:0});
        break;
      }
      case 'act': case 'choice': P2P.relay(m, 1); break;
      case 'chat': NET.onChat && NET.onChat({t:'chat', from:P2P.peerName, msg:m.msg}); break;
    }
  } else {
    switch(m.t){
      case 'start': P2P.peerName=m.players[0].id; NET.onStart && NET.onStart(m); break;
      case 'act': NET._enqueueAction(m); break;
      case 'choice': NET._resolveChoice(m); break;
      case 'chat': NET.onChat && NET.onChat(m); break;
    }
  }
};

// 호스트 = 릴레이: 발신 좌석/순번을 확정해 양쪽(자신 포함)에 배포 — 서버와 동일 규약
P2P.relay = function(m, seat){
  const out={ t:m.t, seq:++P2P.seq, seat, from: seat===0?P2P.myName:P2P.peerName };
  if(m.t==='act') out.action=m.action;
  else { out.id=m.id; out.data=m.data; }
  try{ P2P.ch.send(JSON.stringify(out)); }catch(e){}
  if(m.t==='act') NET._enqueueAction(out);
  else NET._resolveChoice(out);
};

// NET.send 후킹 대상: P2P 활성 시 게임 메시지를 데이터채널로
P2P.netSend = function(m){
  if(m.t==='act'||m.t==='choice'||m.t==='chat'){
    if(P2P.isHost) (m.t==='chat') ? P2P.ch.send(JSON.stringify(m)) : P2P.relay(m, 0);
    else { try{ P2P.ch.send(JSON.stringify(m)); }catch(e){} }
  }
  // 로비 관련 메시지는 P2P에서 의미 없음 → 무시
};

P2P.reset = function(){
  try{ P2P.ch && P2P.ch.close(); }catch(e){}
  try{ P2P.pc && P2P.pc.close(); }catch(e){}
  P2P.pc=null; P2P.ch=null; P2P.active=false; P2P.seq=0; P2P.isHost=false;
};
