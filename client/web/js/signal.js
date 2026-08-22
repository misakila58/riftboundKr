// ══════════ 6자리 방 코드 시그널링 (SIGNAL) ══════════
// 목적: 긴 SDP 코드를 두 번 주고받는 대신, 방장이 6자리 코드 하나만 알려주면 연결되게 한다.
// 원리: 두 클라이언트가 "같은 코드에서 유도한 채널"에 접속해 offer/answer만 잠깐 스쳐 보낸다.
//       게임 데이터는 여기로 흐르지 않는다 — 연결이 맺어지면 채널은 즉시 닫힌다.
//
// 전송 방식 2가지 (P2PCFG.signalUrl 로 선택)
//   1) 공개 MQTT 브로커  — 기본값. 계정·배포 불필요. 아주 가끔 불안정할 수 있음.
//   2) 자체 WebSocket 서버 — server/signal-worker (Cloudflare) 배포 후 URL 입력. 안정적.
//
// 안전장치: 공개 브로커를 쓰므로 payload는 코드에서 유도한 키로 AES-GCM 암호화한다.
//           코드를 모르면 토픽 이름도, 내용도 알 수 없다.
const SIGNAL = {
  // 혼동되는 글자(0/1/I/L/O/U) 제외 — 카톡으로 불러줘도 헷갈리지 않게
  ALPHABET: '23456789ABCDEFGHJKMNPQRSTVWXYZ',
  CODE_LEN: 6,
  REPUB_MS: 2500,   // 공개 브로커는 보존(retain)을 안 쓰므로 주기적으로 재발행
  BROKERS: [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
  ],
};

// ---------- 코드 생성/정규화 ----------
SIGNAL.newCode = function(){
  const a = SIGNAL.ALPHABET;
  const lim = 256 - (256 % a.length);   // 모듈로 편향을 없애려고 범위 밖 값은 버린다
  let s = '';
  while(s.length < SIGNAL.CODE_LEN){
    for(const v of crypto.getRandomValues(new Uint8Array(SIGNAL.CODE_LEN))){
      if(v < lim && s.length < SIGNAL.CODE_LEN) s += a[v % a.length];
    }
  }
  return s;
};
SIGNAL.normalize = function(raw){
  const s = String(raw||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(s.length !== SIGNAL.CODE_LEN) return null;
  for(const c of s) if(!SIGNAL.ALPHABET.includes(c)) return null;
  return s;
};
SIGNAL.pretty = c => c ? c.slice(0,3) + '-' + c.slice(3) : '';

// ---------- 코드 → 토픽/키 유도 ----------
SIGNAL._sha256 = async function(str){
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return new Uint8Array(b);
};
SIGNAL._hex = u8 => Array.from(u8).map(b=>b.toString(16).padStart(2,'0')).join('');

SIGNAL._derive = async function(code){
  const room = SIGNAL._hex(await SIGNAL._sha256('riftbound-sim/room/' + code)).slice(0, 24);
  let key = null;
  try{
    const raw = await SIGNAL._sha256('riftbound-sim/key/' + code);
    key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt','decrypt']);
  }catch(e){ key = null; }  // crypto.subtle 불가 환경 → 평문 전송(토픽은 여전히 코드 유도)
  return { room, key };
};

// ---------- 암복호 (base64) ----------
SIGNAL._b64e = u8 => btoa(String.fromCharCode.apply(null, u8));
SIGNAL._b64d = s => Uint8Array.from(atob(s), c=>c.charCodeAt(0));

SIGNAL._seal = async function(key, text){
  if(!key) return 'p:' + text;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, new TextEncoder().encode(text)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return 'e:' + SIGNAL._b64e(out);
};
SIGNAL._open = async function(key, blob){
  const s = String(blob||'');
  if(s.startsWith('p:')) return s.slice(2);
  if(!s.startsWith('e:') || !key) throw new Error('시그널 데이터를 해독할 수 없습니다.');
  const raw = SIGNAL._b64d(s.slice(2));
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv: raw.subarray(0,12)}, key, raw.subarray(12));
  return new TextDecoder().decode(pt);
};

// ══════════ 채널 열기 ══════════
// 반환: { publish(slot,text), subscribe(slot,cb), stopPublish(slot), close() }
//   slot 'o' = 방장의 초대(offer), 'a' = 참여자의 응답(answer)
SIGNAL.open = async function(code, opts){
  const cfg = opts || {};
  const d = await SIGNAL._derive(code);
  const url = String(cfg.signalUrl||'').trim();
  const chan = url ? await SIGNAL._openWs(url, d.room) : await SIGNAL._openMqtt(d.room);

  const subs = {}, seen = {};
  chan.onData = async (slot, blob) => {
    if(!subs[slot]) return;
    if(seen[slot] === blob) return;   // 재발행분 중복 무시
    seen[slot] = blob;
    let text;
    try{ text = await SIGNAL._open(d.key, blob); }catch(e){ return; }
    try{ subs[slot](text); }catch(e){}
  };
  return {
    async publish(slot, text){ chan.publish(slot, await SIGNAL._seal(d.key, text)); },
    subscribe(slot, cb){ subs[slot] = cb; chan.subscribe(slot); },
    stopPublish(slot){ chan.stopPublish(slot); },
    close(){ try{ chan.close(); }catch(e){} },
  };
};

// ══════════ 전송 1: 자체 WebSocket 서버 (Cloudflare Worker 등) ══════════
// 프로토콜: 접속 시 방의 마지막 메시지를 슬롯별로 재생해 주므로 재발행이 필요 없다.
SIGNAL._openWs = function(baseUrl, room){
  return new Promise((res, rej)=>{
    const u = baseUrl.replace(/\/+$/,'').replace(/^http/,'ws') + '/r/' + room;
    let ws;
    try{ ws = new WebSocket(u); }catch(e){ return rej(new Error('시그널링 주소가 올바르지 않습니다.')); }
    const to = setTimeout(()=>{ try{ws.close();}catch(e){} rej(new Error('시그널링 서버 응답이 없습니다.')); }, 8000);
    const api = {
      onData: null,
      publish(slot, data){ try{ ws.send(JSON.stringify({slot: slot, data: data})); }catch(e){} },
      subscribe(){},            // 서버가 방 전체를 브로드캐스트하므로 별도 구독 불필요
      stopPublish(){},          // 재발행을 안 하므로 할 일 없음
      close(){ try{ ws.close(); }catch(e){} },
    };
    ws.onopen = ()=>{ clearTimeout(to); res(api); };
    ws.onerror = ()=>{ clearTimeout(to); rej(new Error('시그널링 서버에 연결하지 못했습니다.')); };
    ws.onmessage = ev=>{
      let m; try{ m = JSON.parse(ev.data); }catch(e){ return; }
      if(m && typeof m.slot==='string' && typeof m.data==='string') api.onData && api.onData(m.slot, m.data);
    };
  });
};

// ══════════ 전송 2: 공개 MQTT 브로커 (의존성 없이 직접 구현) ══════════
// MQTT 3.1.1 over WebSocket. 필요한 패킷만 다룬다: CONNECT/SUBSCRIBE/PUBLISH(QoS0)/PINGREQ.
SIGNAL._cat = arrs => {
  let n = 0;
  for(const a of arrs) n += a.length;
  const o = new Uint8Array(n);
  let i = 0;
  for(const a of arrs){ o.set(a, i); i += a.length; }
  return o;
};
SIGNAL._mqStr = s => {
  const b = new TextEncoder().encode(s);
  return SIGNAL._cat([new Uint8Array([b.length>>8, b.length&255]), b]);
};
SIGNAL._varint = n => {
  const o = [];
  do { let d = n % 128; n = Math.floor(n/128); if(n>0) d |= 128; o.push(d); } while(n>0);
  return new Uint8Array(o);
};
SIGNAL._mqPkt = (type, body) => SIGNAL._cat([new Uint8Array([type]), SIGNAL._varint(body.length), body]);

SIGNAL._openMqtt = async function(room){
  let lastErr = null;
  for(const url of SIGNAL.BROKERS){
    try{ return await SIGNAL._mqttOne(url, room); }
    catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('시그널링 서버에 연결하지 못했습니다.');
};

SIGNAL._mqttOne = function(url, room){
  return new Promise((res, rej)=>{
    const base = 'rbsim/' + room + '/';
    let ws;
    try{ ws = new WebSocket(url, 'mqtt'); }catch(e){ return rej(new Error('브로커 연결 실패')); }
    ws.binaryType = 'arraybuffer';

    let buf = new Uint8Array(0), pingTimer = null, pid = 1, done = false;
    const repub = {};   // slot -> {timer}
    const to = setTimeout(()=>{
      if(done) return;
      done = true; try{ws.close();}catch(e){} rej(new Error('브로커 응답 없음'));
    }, 8000);

    const api = {
      onData: null,
      publish(slot, data){
        api._send(slot, data);
        if(repub[slot]) clearInterval(repub[slot].timer);
        repub[slot] = { timer: setInterval(()=>api._send(slot, data), SIGNAL.REPUB_MS) };
      },
      _send(slot, data){
        try{ ws.send(SIGNAL._mqPkt(0x30, SIGNAL._cat([SIGNAL._mqStr(base+slot), new TextEncoder().encode(data)]))); }catch(e){}
      },
      subscribe(slot){
        const p = pid++ & 0xffff;
        const body = SIGNAL._cat([new Uint8Array([p>>8, p&255]), SIGNAL._mqStr(base+slot), new Uint8Array([0])]);
        try{ ws.send(SIGNAL._mqPkt(0x82, body)); }catch(e){}
      },
      stopPublish(slot){ if(repub[slot]){ clearInterval(repub[slot].timer); delete repub[slot]; } },
      close(){
        for(const k in repub) clearInterval(repub[k].timer);
        clearInterval(pingTimer);
        try{ ws.close(); }catch(e){}
      },
    };

    ws.onopen = ()=>{
      const cid = 'rb' + SIGNAL._hex(crypto.getRandomValues(new Uint8Array(8)));
      // protocol name + level 4 + clean session + keepalive 60s + client id
      const body = SIGNAL._cat([SIGNAL._mqStr('MQTT'), new Uint8Array([0x04, 0x02, 0x00, 0x3c]), SIGNAL._mqStr(cid)]);
      try{ ws.send(SIGNAL._mqPkt(0x10, body)); }catch(e){}
    };
    ws.onerror = ()=>{ if(!done){ done = true; clearTimeout(to); rej(new Error('브로커 연결 실패')); } };
    ws.onclose  = ()=>{ clearInterval(pingTimer); if(!done){ done = true; clearTimeout(to); rej(new Error('브로커 연결이 끊겼습니다.')); } };

    ws.onmessage = ev=>{
      buf = SIGNAL._cat([buf, new Uint8Array(ev.data)]);
      // 스트림에서 완성된 패킷만 꺼내 처리
      for(;;){
        if(buf.length < 2) return;
        let mult = 1, len = 0, i = 1, d;
        do{
          if(i >= buf.length) return;          // 길이 필드가 아직 안 도착
          d = buf[i++]; len += (d & 127) * mult; mult *= 128;
        } while(d & 128);
        if(buf.length < i + len) return;       // 본문이 아직 안 도착
        const type = buf[0] & 0xf0, body = buf.subarray(i, i + len);
        buf = buf.slice(i + len);
        if(type === 0x20){                     // CONNACK
          if(body[1] !== 0){
            if(!done){ done = true; clearTimeout(to); try{ws.close();}catch(e){} rej(new Error('브로커가 접속을 거부했습니다.')); }
            return;
          }
          pingTimer = setInterval(()=>{ try{ ws.send(new Uint8Array([0xc0, 0x00])); }catch(e){} }, 30000);
          if(!done){ done = true; clearTimeout(to); res(api); }
        } else if(type === 0x30){              // PUBLISH (QoS0 → 패킷 ID 없음)
          const tl = (body[0] << 8) | body[1];
          const topic = new TextDecoder().decode(body.subarray(2, 2 + tl));
          const data  = new TextDecoder().decode(body.subarray(2 + tl));
          if(topic.startsWith(base)) api.onData && api.onData(topic.slice(base.length), data);
        }
      }
    };
  });
};
