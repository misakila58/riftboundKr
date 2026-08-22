// ══════════ P2P 직접 대전 (서버 불필요 · 초대 코드 방식) ══════════
// WebRTC 데이터채널로 두 클라이언트가 직접 연결된다.
// 방장이 '초대 코드'를 만들어 메신저로 전달 → 상대가 '응답 코드'를 돌려주면 연결.
// 연결 후에는 호스트가 서버 릴레이 역할(좌석/순번 확정)을 대신 수행한다.
const P2P = {
  pc:null, ch:null, isHost:false, active:false, seq:0,
  myName:'', myDeck:null, peerName:'상대',
  onStatus:null,
  sig:null,        // 시그널링 채널 (연결되면 즉시 닫는다)
  roomCode:null,   // 6자리 방 코드
  _sigTimer:null,
};

P2P._newPc = function(){
  return new RTCPeerConnection({
    iceServers:[{ urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302'] }],
    iceCandidatePoolSize:0,   // 후보를 미리 쌓지 않는다 — 코드 길이/대기시간 절약
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
// ══════════ 초대 코드 압축 ══════════
// SDP는 대부분 양쪽에서 똑같이 만들 수 있는 보일러플레이트다.
// 실제로 상대에게 필요한 건 ice-ufrag / ice-pwd / DTLS 지문 / 후보 IP:PORT 뿐이라
// 이것만 바이너리로 담아 base64url로 낸다 (약 100자 — 예전엔 2000자 이상).
// 받는 쪽은 SDP를 재조립하고 후보는 addIceCandidate로 따로 넣는다.
P2P._CTYPE = ['host','srflx','relay'];
P2P._CPRI  = { host:2130706431, srflx:1694498815, relay:16777471 };

P2P._ip4 = s => {
  const p=s.split('.');
  if(p.length!==4) return null;
  const o=new Uint8Array(4);
  for(let i=0;i<4;i++){ const v=+p[i]; if(!(v>=0&&v<=255)) return null; o[i]=v; }
  return o;
};
P2P._ip6 = s => {
  const half = s.split('::');
  if(half.length>2 || s.includes('.')) return null;   // IPv4 매핑 표기는 다루지 않는다(ICE에선 거의 없음)
  const head = half[0] ? half[0].split(':').filter(Boolean) : [];
  const tail = half.length>1 ? (half[1] ? half[1].split(':').filter(Boolean) : []) : null;
  const o = new Uint8Array(16);
  let i=0;
  for(const h of head){ const v=parseInt(h,16); if(isNaN(v)) return null; o[i++]=v>>8; o[i++]=v&255; }
  if(tail){
    let j=16;
    for(let k=tail.length-1;k>=0;k--){ const v=parseInt(tail[k],16); if(isNaN(v)) return null; o[--j]=v&255; o[--j]=v>>8; }
    if(j<i) return null;
  } else if(i!==16) return null;
  return o;
};
P2P._ip6Str = u8 => { const g=[]; for(let i=0;i<16;i+=2) g.push(((u8[i]<<8)|u8[i+1]).toString(16)); return g.join(':'); };

P2P._b64u = u8 => btoa(String.fromCharCode.apply(null,u8)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
P2P._unb64u = s => {
  const t = s.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(t + '==='.slice((t.length+3)%4)), c=>c.charCodeAt(0));
};

// SDP에서 쓸 만한 후보만 골라낸다.
// - UDP / component 1 만 (TCP 후보는 상대가 거의 못 쓰는데 자리만 차지한다)
// - mDNS(.local) 후보 제거: 상대에게는 해석 불가능한 이름이다
// - srflx(공인 IP) 우선, 최대 4개
P2P._pickCands = function(sdp){
  const re = /^a=candidate:(\S+) (\d+) (\S+) (\d+) (\S+) (\d+) typ (host|srflx|prflx|relay)/gim;
  const out = [], seen = new Set();
  let m;
  while((m = re.exec(sdp))){
    const comp=+m[2], transport=m[3].toLowerCase(), ip=m[5], port=+m[6], type=m[7];
    if(comp!==1 || transport!=='udp') continue;
    if(type==='prflx') continue;
    if(/\.local$/i.test(ip)) continue;
    if(!(port>0 && port<65536)) continue;
    const v6 = ip.includes(':');
    const bytes = v6 ? P2P._ip6(ip) : P2P._ip4(ip);
    if(!bytes) continue;
    const k = type+'|'+ip+'|'+port;
    if(seen.has(k)) continue;
    seen.add(k);
    out.push({ type, ip, port, v6, bytes });
  }
  const rank = { srflx:0, host:1, relay:2 };
  out.sort((a,b)=>rank[a.type]-rank[b.type]);
  return out.slice(0,4);
};

P2P._pack = function(desc, isOffer){
  const sdp = (desc && desc.sdp) || '';
  const ufrag = (sdp.match(/^a=ice-ufrag:(\S+)/m)||[])[1] || '';
  const pwd   = (sdp.match(/^a=ice-pwd:(\S+)/m)||[])[1] || '';
  const fpHex = (sdp.match(/^a=fingerprint:sha-256 (\S+)/mi)||[])[1] || '';
  const fp = fpHex.split(':').map(h=>parseInt(h,16));
  if(!ufrag || !pwd || ufrag.length>63 || pwd.length>63 || fp.length!==32 || fp.some(isNaN))
    throw new Error('연결 정보를 만들지 못했습니다. 다시 시도해 주세요.');
  const cands = P2P._pickCands(sdp);
  const parts = [];
  parts.push([isOffer ? 0x10 : 0x11]);          // 상위 4비트=버전1, 하위=타입(0 offer / 1 answer)
  parts.push([ufrag.length], Array.from(new TextEncoder().encode(ufrag)));
  parts.push([pwd.length],   Array.from(new TextEncoder().encode(pwd)));
  parts.push(fp);
  parts.push([cands.length]);
  for(const c of cands){
    parts.push([P2P._CTYPE.indexOf(c.type) | (c.v6 ? 4 : 0)]);
    parts.push(Array.from(c.bytes));
    parts.push([c.port>>8, c.port&255]);
  }
  return P2P._b64u(new Uint8Array([].concat.apply([], parts)));
};

P2P._unpack = function(code){
  const b = P2P._unb64u(String(code));
  if(b.length < 40 || (b[0]>>4) !== 1) throw new Error('BADFMT');
  const isOffer = (b[0] & 0x0f) === 0;
  let i = 1;
  const take = n => { if(i+n > b.length) throw new Error('BADFMT'); const s = b.subarray(i, i+n); i += n; return s; };
  const ufrag = new TextDecoder().decode(take(b[i++]));
  const pwd   = new TextDecoder().decode(take(b[i++]));
  const fp    = take(32);
  const n     = b[i++];
  const cands = [];
  for(let k=0;k<n;k++){
    const f = b[i++], v6 = !!(f & 4), type = P2P._CTYPE[f & 3];
    const ipb = take(v6 ? 16 : 4);
    const p = take(2);
    if(!type) continue;
    cands.push({ type, ip: v6 ? P2P._ip6Str(ipb) : Array.from(ipb).join('.'), port: (p[0]<<8)|p[1] });
  }
  return { isOffer, ufrag, pwd, fp, cands };
};

// 뼈대만 남긴 최소 SDP를 재조립한다 (데이터채널 전용이라 나머지는 전부 상수)
P2P._buildSdp = function(o){
  const fp = Array.from(o.fp).map(x=>x.toString(16).padStart(2,'0').toUpperCase()).join(':');
  return [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=ice-ufrag:' + o.ufrag,
    'a=ice-pwd:' + o.pwd,
    'a=ice-options:trickle',
    'a=fingerprint:sha-256 ' + fp,
    'a=setup:' + (o.isOffer ? 'actpass' : 'active'),
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n');
};
// 후보는 SDP에 끼워 넣지 않고 addIceCandidate로 따로 넣는다 (파싱 사고가 적다)
P2P._addCands = async function(pc, cands){
  let f = 1;
  for(const c of cands){
    const line = 'candidate:' + (f++) + ' 1 udp ' + P2P._CPRI[c.type] + ' ' + c.ip + ' ' + c.port + ' typ ' + c.type
      + (c.type==='host' ? '' : ' raddr 0.0.0.0 rport 0');
    try{ await pc.addIceCandidate({ candidate:line, sdpMid:'0', sdpMLineIndex:0 }); }catch(e){}
  }
  try{ await pc.addIceCandidate({ candidate:'', sdpMid:'0', sdpMLineIndex:0 }); }catch(e){}
};

// 코드 해석. 메신저를 거치며 섞이는 줄바꿈·보이지 않는 문자는 제거하고,
// 구버전(긴 base64 JSON) 코드도 계속 받아 준다.
P2P._decode = function(code, wantOffer){
  const s = String(code||'').replace(/[^A-Za-z0-9+/=_-]/g,'');
  let o = null;
  try{ o = P2P._unpack(s); }
  catch(e){
    try{
      const j = JSON.parse(decodeURIComponent(escape(atob(s.replace(/[^A-Za-z0-9+/=]/g,'')))));
      if(j && j.sdp && j.t) o = { legacy:j, isOffer: j.t==='offer' };
    }catch(e2){ o = null; }
  }
  if(!o) throw new Error('코드가 손상되어 읽을 수 없습니다. 코드 전체가 빠짐없이 복사됐는지 확인하세요 — 일부 메신저는 긴 글을 자르거나 문자를 바꿉니다 (파일/메모로 전달하면 안전합니다).');
  if(o.isOffer !== wantOffer)
    throw new Error(wantOffer
      ? '초대 코드가 아닙니다. 방장이 만든 "초대 코드"를 붙여넣으세요.'
      : '응답 코드가 아닙니다. 상대가 만든 "응답 코드"를 붙여넣으세요.');
  return o;
};
P2P._applyRemote = async function(pc, o){
  if(o.legacy) return pc.setRemoteDescription(o.legacy.sdp);
  await pc.setRemoteDescription({ type: o.isOffer ? 'offer' : 'answer', sdp: P2P._buildSdp(o) });
  await P2P._addCands(pc, o.cands);
};

// ---------- 호스트 (방 만들기) ----------
P2P.host = async function(name, deck, manual, ban){
  P2P.reset(); P2P.isHost=true; P2P.myName=name; P2P.myDeck=deck; P2P.manual=manual!==false; P2P.ban=ban===true;
  const pc=P2P._newPc(); P2P.pc=pc;
  P2P._bindChannel(pc.createDataChannel('game',{ordered:true}));
  P2P._watchConn(pc);
  await pc.setLocalDescription(await pc.createOffer());
  await P2P._waitIce(pc);
  return P2P._pack(pc.localDescription, true);
};
P2P.acceptAnswer = async function(code){
  await P2P._applyRemote(P2P.pc, P2P._decode(code, false));
  P2P._startConnWatch(20000);   // 방장: 연결하기 후 20초 내에 안 열리면 안내
};

// ---------- 게스트 (참여하기) ----------
P2P.join = async function(name, deck, hostCode, ban){
  P2P.reset(); P2P.isHost=false; P2P.myName=name; P2P.myDeck=deck; P2P.ban=ban===true;
  const o=P2P._decode(hostCode, true);
  const pc=P2P._newPc(); P2P.pc=pc;
  pc.ondatachannel=(ev)=>P2P._bindChannel(ev.channel);
  P2P._watchConn(pc);
  await P2P._applyRemote(pc, o);
  await pc.setLocalDescription(await pc.createAnswer());
  await P2P._waitIce(pc);
  P2P._startConnWatch(60000);   // 게스트: 방장의 [연결하기] 대기 포함이라 넉넉히
  return P2P._pack(pc.localDescription, false);
};

// ══════════ 6자리 방 코드로 연결 (signal.js 사용) ══════════
// 방장이 만든 코드 하나만 알려주면 offer/answer 교환을 signal.js가 대신 해 준다.
// 연결이 맺어지는 즉시 시그널링 채널은 닫는다.
P2P._closeSignal = function(){
  if(P2P.sig){ try{ P2P.sig.close(); }catch(e){} P2P.sig=null; }
  if(P2P._sigTimer){ clearTimeout(P2P._sigTimer); P2P._sigTimer=null; }
};

// 방장: 코드를 만들어 반환한다. 상대가 붙으면 알아서 게임이 시작된다.
P2P.hostViaCode = async function(name, deck, manual, ban, opts){
  const code = SIGNAL.newCode();
  const offer = await P2P.host(name, deck, manual, ban);   // reset()이 여기서 먼저 돈다
  let sig;
  try{ sig = await SIGNAL.open(code, opts); }
  catch(e){ P2P.reset(); throw e; }
  P2P.sig = sig; P2P.roomCode = code;
  sig.subscribe('a', async ans=>{
    try{
      await P2P.acceptAnswer(ans);
      sig.stopPublish('o');
      P2P.onStatus && P2P.onStatus('answered');
    }catch(err){ P2P.onStatus && P2P.onStatus('sigerror', err.message); }
  });
  await sig.publish('o', offer);
  return code;
};

// 참여자: 코드를 넣으면 방장의 초대를 받아 자동으로 응답한다.
P2P.joinViaCode = async function(name, deck, rawCode, ban, opts){
  const code = SIGNAL.normalize(rawCode);
  if(!code) throw new Error('방 코드는 ' + SIGNAL.CODE_LEN + '글자입니다. 다시 확인해 주세요.');
  const sig = await SIGNAL.open(code, opts);
  P2P.sig = sig; P2P.roomCode = code;
  let got = false;
  sig.subscribe('o', async offer=>{
    if(got) return;
    got = true;
    if(P2P._sigTimer){ clearTimeout(P2P._sigTimer); P2P._sigTimer=null; }
    try{
      // join() 안의 reset()이 이 채널을 닫아 버리면 응답을 못 보낸다 → 잠시 떼어 놓는다
      P2P.sig = null;
      const ans = await P2P.join(name, deck, offer, ban);
      P2P.sig = sig; P2P.roomCode = code;
      await sig.publish('a', ans);
      P2P.onStatus && P2P.onStatus('answered');
    }catch(err){
      P2P.sig = sig;
      P2P._closeSignal();
      P2P.onStatus && P2P.onStatus('sigerror', err.message);
    }
  });
  // 방이 없거나 코드가 틀리면 아무 소식이 없다 → 시간 제한을 둔다
  P2P._sigTimer = setTimeout(()=>{
    if(got) return;
    P2P._closeSignal();
    P2P.onStatus && P2P.onStatus('sigerror', '방을 찾지 못했습니다. 코드를 확인하거나, 방장에게 방을 다시 만들어 달라고 하세요.');
  }, 25000);
  return code;
};

// ---------- 채널/연결 관리 ----------
// 연결 지연 감시: 일정 시간 내에 데이터채널이 안 열리면 안내 (상태는 'stalled'로 통지)
P2P._connTimer=null;
P2P._startConnWatch = function(ms){
  clearTimeout(P2P._connTimer);
  P2P._connTimer=setTimeout(()=>{
    if(!P2P.active) P2P.onStatus && P2P.onStatus('stalled');
  }, ms);
};

P2P._bindChannel = function(ch){
  P2P.ch=ch;
  ch.onopen=()=>{
    clearTimeout(P2P._connTimer);
    P2P._closeSignal();   // 연결됐으면 시그널링은 더 필요 없다
    P2P.active=true;
    P2P.onStatus && P2P.onStatus('connected');
    if(!P2P.isHost){
      ch.send(JSON.stringify({t:'hello', name:P2P.myName, deck:P2P.myDeck, ban:P2P.ban===true}));
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
    const s=pc.connectionState;
    if(s==='failed'){
      clearTimeout(P2P._connTimer);
      P2P._closeSignal();
      // 연결 수립 전 실패 = ICE 경로를 못 뚫음 (사내망/방화벽/대칭 NAT의 P2P 차단)
      if(!P2P.active) P2P.onStatus && P2P.onStatus('failed');
      P2P._bye();
    } else if(s==='disconnected'||s==='closed'){
      P2P._bye();
    }
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
        // 밴 규칙: 양쪽 모두 선택했을 때만 적용 — 위반 덱이 있으면 시작하지 않음
        const banRule = P2P.ban===true && m.ban===true;
        if(banRule){
          const offenders=[];
          if(deckBannedCards(P2P.myDeck).length) offenders.push(P2P.myName+'(방장)');
          if(deckBannedCards(m.deck||{}).length) offenders.push(P2P.peerName);
          if(offenders.length){
            const msg='🚫 밴 적용 대전: 밴 카드가 포함된 덱은 사용할 수 없습니다 — '+offenders.join(', ')+'. 덱을 바꾼 뒤 처음부터 다시 연결하세요.';
            try{ P2P.ch.send(JSON.stringify({t:'err', msg})); }catch(e){}
            P2P.active=false;  // 미시작 종료 — 이후 연결이 끊겨도 '상대가 나갔습니다' 리로드가 뜨지 않게
            NET.onErr && NET.onErr(msg);
            break;
          }
        }
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        const players = [ {id:P2P.myName, deck:P2P.myDeck}, {id:P2P.peerName, deck:m.deck} ];
        const manual = P2P.manual!==false;
        P2P.ch.send(JSON.stringify({t:'start', seed, players, yourSeat:1, manual, banRule}));
        NET.onStart && NET.onStart({t:'start', seed, players, yourSeat:0, manual, banRule});
        break;
      }
      case 'act': case 'choice': P2P.relay(m, 1); break;
      case 'chat': NET.onChat && NET.onChat({t:'chat', from:P2P.peerName, msg:m.msg}); break;
    }
  } else {
    switch(m.t){
      case 'start': {
        // 게스트도 밴 규칙을 검증한다 (호스트 클라이언트만 믿지 않음 — 서버 모드와 대칭)
        if(m.banRule){
          const offenders=m.players.filter(pl=>deckBannedCards(pl.deck||{}).length).map(pl=>pl.id);
          if(offenders.length){
            P2P.active=false;
            NET.onErr && NET.onErr('🚫 밴 적용 대전: 밴 카드가 포함된 덱은 사용할 수 없습니다 — '+offenders.join(', '));
            break;
          }
        }
        P2P.peerName=m.players[0].id; NET.onStart && NET.onStart(m);
        break;
      }
      case 'err': P2P.active=false; NET.onErr && NET.onErr(m.msg); break;
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
  clearTimeout(P2P._connTimer);
  P2P._closeSignal();
  P2P.roomCode=null;
  try{ P2P.ch && P2P.ch.close(); }catch(e){}
  try{ P2P.pc && P2P.pc.close(); }catch(e){}
  P2P.pc=null; P2P.ch=null; P2P.active=false; P2P.seq=0; P2P.isHost=false; P2P.ban=false;
};
