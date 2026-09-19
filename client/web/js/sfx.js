// ══════════ 효과음 ══════════
// 파일 없이 WebAudio로 짧은 음을 합성한다 (턴 전환 · 카드/능력 사용 · 체인 적재 · 이동 · 득점 · 내 차례 알림).
// 설정(⚙ → 화면 설정 → 효과음)에서 끌 수 있다. 저장 키 rb_sound ('off'면 꺼짐, 기본 켜짐).
// 시각 이펙트(rb_fx)와 독립 — 이펙트를 꺼도 소리는 나고, 그 반대도 된다.
const SFX = {
  on: localStorage.getItem('rb_sound') !== 'off',
  setOn(v){ SFX.on = !!v; localStorage.setItem('rb_sound', v ? 'on' : 'off'); if(v) SFX.play('act', true); },
  _ctx: null,
  ctx(){
    if(!SFX._ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return null;
      try{ SFX._ctx = new AC(); }catch(e){ return null; }
    }
    // 브라우저는 사용자 입력 전엔 소리를 막는다 — 첫 클릭 뒤 자동으로 풀린다
    if(SFX._ctx.state === 'suspended') SFX._ctx.resume().catch(()=>{});
    return SFX._ctx;
  },
  // f: 주파수(Hz) · dur: 초 · at: 시작 지연 · slide: 끝 주파수(글리산도)
  tone(f, dur, o={}){
    const c = SFX.ctx(); if(!c || c.state !== 'running') return;
    const t = c.currentTime + (o.at || 0), gain = o.gain ?? 0.06;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if(o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + dur + 0.03);
  },
  _last: {},
  // 같은 종류가 80ms 안에 연달아 오면(동시 다발 연출) 한 번만 낸다
  play(kind, force){
    if(!SFX.on && !force) return;
    const now = performance.now();
    if(now - (SFX._last[kind] || 0) < 80) return;
    SFX._last[kind] = now;
    const T = SFX.tone;
    try{
      switch(kind){
        case 'turn':   T(440, 0.12, {type:'triangle'}); T(330, 0.2, {type:'triangle', at:0.12}); break;          // 턴이 상대에게
        case 'myturn': T(523, 0.1, {type:'triangle'}); T(659, 0.1, {type:'triangle', at:0.1}); T(784, 0.22, {type:'triangle', at:0.2}); break; // 내 턴
        case 'act':    T(880, 0.06, {type:'square', gain:0.025}); break;                                            // 카드·능력 사용
        case 'chain':  T(660, 0.08, {gain:0.05}); T(990, 0.1, {at:0.08, gain:0.04}); break;                       // 체인 적재
        case 'move':   T(320, 0.16, {slide:640, gain:0.05}); break;                                                // 유닛 이동
        case 'score':  [523, 659, 784, 1046].forEach((f,i)=>T(f, 0.16, {at:i*0.09, type:'triangle', gain:0.06})); break; // 득점
        case 'prompt': T(740, 0.08, {gain:0.05}); T(740, 0.08, {at:0.14, gain:0.05}); break;                      // 내 응수/선택 차례
      }
    }catch(e){}
  },
};

// ── 게임 훅에 붙이기 (fx.js가 만든 UI.fx 뒤에 로드된다) ──
(function(){
  // '나'의 좌석: 온라인은 내 좌석, 봇전은 봇의 반대, 핫시트·리플레이·관전은 없음
  const mine = ()=> (typeof NET!=='undefined' && NET.online) ? (NET.spectating ? null : NET.seat)
    : (typeof BOT!=='undefined' && BOT.active) ? 1-BOT.seat : null;
  const wrap = (obj, key, fn)=>{
    const orig = obj[key]; if(typeof orig !== 'function') return;
    obj[key] = function(){ try{ fn.apply(this, arguments); }catch(e){} return orig.apply(this, arguments); };
  };
  wrap(UI.fx, 'turnEnd', p=>{ const m = mine(); SFX.play(m !== null && opp(p) === m ? 'myturn' : 'turn'); });
  wrap(UI.fx, 'cast',     ()=>SFX.play('act'));
  wrap(UI.fx, 'chainAdd', ()=>SFX.play('chain'));
  wrap(UI.fx, 'score',    ()=>SFX.play('score'));
  // 결전에서 우선권이 나에게 올 때 한 번 (같은 결전·같은 차례에 여러 번 그리는 것은 무시)
  let lastKey = null;
  wrap(UI, 'promptShowdown', ()=>{
    const m = mine(); if(m === null || typeof G === 'undefined' || !G || !G.showdown) return;
    const key = G.showdown === lastKey?.sd && G.actingPlayer === lastKey.p ? null : {sd:G.showdown, p:G.actingPlayer};
    if(!key) return;
    lastKey = key;
    if(G.actingPlayer === m) SFX.play('prompt');
  });
  // 결전 밖(내 턴이 아닐 때) 상대 주문에 대한 응수 창이 나에게 열릴 때
  wrap(UI, 'pickReaction', p=>{ if(p === mine()) SFX.play('prompt'); });
  // 유닛 이동 (기본 이동 — 효과 이동은 카드 사용음이 이미 난다)
  if(typeof moveUnits === 'function'){
    const orig = moveUnits;
    moveUnits = function(){ SFX.play('move'); return orig.apply(this, arguments); };
  }
})();
