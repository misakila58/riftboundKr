// ══════════ 서버 오라클 — 숨김 정보 2단계 (2026-10-15) ══════════
// 온라인 대전은 두 클라이언트가 같은 엔진을 돌리는 락스텝이다. 1단계(2026-10-14)는 좌석별 비공개 시드로 '상대' 손패·덱 순서를 숨겼지만,
// 자기 시드는 자기 클라이언트가 가져 ① 상대 덱 목록(40장)은 여전히 양쪽에 있었고 ② 없는 카드를 냈다는 조작을 서버가 검증하지 못했으며
// ③ 자기 덱의 다음 드로우를 자기 클라이언트가 계산할 수 있었다.
// 2단계: 비공개 시드를 서버만 갖고, 방마다 '모든 것을 아는' 엔진 사본(이 파일)을 돌린다. 클라이언트는 두 좌석 모두 HID(비공개 카드)만 보고
//  · 공개(revealCards — 낸 카드·버린 카드·공개 효과)는 오라클이 답을 보내고(상대 화면이 아니라 서버가 정체의 출처),
//  · 주인 전용 공개(ownerReveal — 드로우한 손패·덱 위 엿보기)는 그 좌석에만 정체를 보낸다(dataFor: 좌석별 데이터, 다른 화면은 null),
//  · 주인 결정(privateChoice — 덱 위에서 고르기 등)은 전처럼 주인 화면이 답하고 오라클은 받아서 같은 상태 변경을 한다.
// 선택 순번(choice id)은 클라이언트의 NET.choice 호출 순서를 그대로 따라야 한다 — 엔진 밖에서 선택을 소비하는 곳(설정 화면 주사위·
// 사이드덱 교체·Bo3 전장 선택)도 여기서 같은 순서로 소비한다(아래 UI 스텁). 행동은 클라이언트와 같은 NET._authorized 검사 뒤 실행하고,
// 거부되거나 실행이 false로 끝나면 위반으로 보고한다(정직한 클라이언트도 같은 행동을 거부하므로 상태는 어긋나지 않는다).
// 재시작 복원: 방 로그(행동·선택·오라클 공개)를 처음부터 다시 먹이면 같은 상태가 된다(replay 모드에서는 공개를 보내지 않고 기록과 대조).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ENGINE_FILES = ['cards.js', 'loc.js', 'effects.js', 'cardscripts.js', 'engine.js', 'bot-eval.js', 'bot-sim.js', 'bot-policy.js'];
const HID = -1;

// ── 엔진 스크립트 (파일이 바뀌면 다시 컴파일) ──
let compiled = null;
function loadEngine(webRoot) {
  const js = path.join(webRoot, 'js');
  const key = ENGINE_FILES.concat('net.js').map(f => { try { return f + ':' + fs.statSync(path.join(js, f)).mtimeMs; } catch (e) { return f + ':x'; } }).join('|');
  if (compiled && compiled.key === key) return compiled;
  const src = ENGINE_FILES.map(f => fs.readFileSync(path.join(js, f), 'utf8')).join('\n;\n');
  // 클라이언트의 행동 권한 검사(net.js NET._authorized)를 그대로 쓴다 — 양쪽이 같은 행동을 같은 이유로 버려야 상태가 같다
  let authSrc = 'function(a, seat){ return true; }';
  try {
    const net = fs.readFileSync(path.join(js, 'net.js'), 'utf8');
    const m = net.match(/NET\._authorized = (function\s*\(a, seat\)\{[\s\S]*?\n\};)/);
    if (m) authSrc = m[1].replace(/\n\};$/, '\n}');
  } catch (e) {}
  const script = new vm.Script([STUB, src, RUNTIME, 'var __authorized = ' + authSrc + ';', 'compileAllCards();'].join('\n;\n'), { filename: 'oracle-engine.js' });
  compiled = { key, script };
  return compiled;
}

// UI 스텁: 엔진이 부르는 표시 함수는 전부 무동작, 선택 함수는 클라이언트의 선택 응답을 기다린다(아래 RUNTIME에서 덮어씀)
const STUB = `
var UI = {
  log(){}, render(){}, toast(){}, toastP(){}, prompt(){}, promptShowdown(){}, manualNotice(){},
  showVictory(){}, inspect(){}, inspectUnit(){}, hideZoom(){}, showZoom(){}, promptForState(){},
  isPicking(){ return false; }, logEntryEl(){ return null; },
  fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  revealAurora:()=>Promise.resolve(),
};
var REPLAY = { viewing:false, recording:false, capture(){}, _onNewGame(){}, _onVictory(){} };
var BUILDINFO = { version:'oracle', built:'' };
if(typeof globalThis.withBattlefieldSource==='undefined') globalThis.withBattlefieldSource=(s,fn)=>fn();
`;

const RUNTIME = `
var ORC = { gen:0, choiceSeq:0, pending:{}, early:{}, clockReady:false, chain:Promise.resolve(), cfg:null, undo:[], replay:null, gameNo:0 };
var UNDO_KINDS = new Set(['play','move','ability','endTurn','pass','hide','playHidden','equip','runeFloat','manual']);
function __json(v){ return v===undefined ? null : JSON.parse(JSON.stringify(v)); }   // 클라이언트가 받는 값과 같게
function waitChoice(p){
  const id=++ORC.choiceSeq, gen=ORC.gen;
  const e=ORC.early[id];
  if(e){ delete ORC.early[id]; if(e.seat!==p){ __violation(e.seat, {k:'choice', id}, 'wrong-seat'); return new Promise(()=>{}); } return Promise.resolve(e.data); }
  return new Promise(res=>{ ORC.pending[id]={p,res,gen}; });
}
function emitReveal(p, dataFor, why){
  const id=++ORC.choiceSeq;
  const msg={t:'choice', id, seat:p, from:'oracle', why, dataFor};
  if(ORC.replay){   // 재시작 복원: 기록에 있는 공개(이 게임·이 번호)는 보내지 않고 대조만, 기록에 없는 새 공개는 보낸다
    const recs=ORC.replay.games[ORC.gameNo]; const rec=recs && recs[id];
    if(rec){ if(JSON.stringify(rec.dataFor)!==JSON.stringify(dataFor)) __violation(-1, {k:'reveal', id}, 'replay-mismatch'); return; }
  }
  __emit(msg);
}
var NET = {
  online:true, seat:null, spectating:false, lastStart:null, catchingUp:false, reconnecting:false, pendingChoices:{}, _localOnly:0,
  get choiceSeq(){ return ORC.choiceSeq; }, set choiceSeq(v){ ORC.choiceSeq=v; },
  dispatch(a,fn){ if(fn) return fn(); },
  revealChoice(p,getter,why){ const v=__json(getter()); emitReveal(p,[v,v,v],why); return Promise.resolve(v); },
  ownerReveal(p,getter,why){ const v=__json(getter()); emitReveal(p,[p===0?v:null, p===1?v:null, null],why); return Promise.resolve(v); },
  privateChoice(p,fn,why){ return waitChoice(p); },
  choice(p,fn,ser,deser){ return waitChoice(p).then(d=>deser?deser(d):d); },
};
function __feedChoice(m){
  const pc=ORC.pending[m.id];
  if(!pc){ ORC.early[m.id]=m; return; }
  if(pc.gen!==ORC.gen) return;
  if(m.seat!==pc.p){ __violation(m.seat, {k:'choice', id:m.id}, 'wrong-seat'); return; }
  delete ORC.pending[m.id]; pc.res(m.data);
}
// ── 선택 함수: 클라이언트 UI.pick*와 같은 조기 반환·직렬화(ui.js routedPick 직렬화와 일치해야 한다) ──
async function pre(){ await syncPrivateHands(); }   // 클라이언트 routedPick 입구와 같은 지점의 손패 동기화
UI.pickUnitFrom = async (p,c)=>{ if(!c.length) return null; await pre(); const d=await waitChoice(p); return d?(c.find(u=>u.uid===d.uid)||everyUnit().find(u=>u.uid===d.uid)||null):null; };
UI.pickOption   = async (p,t,o)=>{ await pre(); const i=await waitChoice(p); if(i===null||i===undefined) return null; const x=o[i]; return x?x.v:null; };
UI.confirmP     = async (p)=>{ await pre(); return !!(await waitChoice(p)); };
UI.pickNumber   = async (p)=>{ await pre(); return await waitChoice(p); };
UI.pickHandCard = async (p)=>{ if(!G.players[p].hand.length) return null; await pre(); const i=await waitChoice(p); return (i===null||i===undefined)?null:i; };
UI.pickBuffs    = async (p)=>{ await pre(); const v=await waitChoice(p); return Array.isArray(v)?v:[]; };
UI.pickBoardOrder = async (p,t,o)=>{ if(o.length<2) return o.map((_,i)=>i); await pre(); const v=await waitChoice(p); return Array.isArray(v)?v:o.map((_,i)=>i); };
UI.pickMulligan = async (p)=>{ await pre(); const v=await waitChoice(p); return Array.isArray(v)?v:[]; };
UI.pickReaction = async (p,t,o)=>{ await pre(); const w=await waitChoice(p); return REACTION_WIRE.decode(o, w); };
// ── 설정 화면(setup-preview.js)·사이드덱(main.js)·Bo3 전장 선택(main.js)이 소비하는 선택을 같은 순서로 소비 ──
UI.reviewSetup = async ()=>true;
UI.rollSetupDice = async ()=>({instant:false});     // decideFirstPlayer의 animated 판정용 — 실제로는 rollSetupDiceBoth가 쓰인다
UI.rollSetupDiceBoth = async (d0,d1,round)=>{
  if(round>1){ const a=waitChoice(0), b=waitChoice(1); await a; await b; return; }   // 재굴림: 완료 확인만(좌석 순 등록)
  if(!ORC.clockReady){ await waitChoice(0); await waitChoice(1); await waitChoice(0); ORC.clockReady=true; }   // 시계 동기화 0·1·0
  await waitChoice(0);                                       // 시작 시각(방장)
  const a=waitChoice(0), b=waitChoice(1); await a; await b;   // 연출 완료 확인(좌석 순 등록)
};
UI.pickSetupOrder = (p)=>UI.pickOption(p,'선후공',[{v:'first'},{v:'second'}]);
function validChampion(deck){
  const champion=card(deck.champN), legend=card(deck.legendN);
  return !!(deck.main?.includes(deck.champN) && champion?.type==='Unit' && champion.super==='Champion'
    && (champion.tags||[]).some(t=>(legend?.tags||[]).includes(t)));
}
UI.sideboardStep = async ()=>{
  const cfg=ORC.cfg; if(!cfg || (cfg.format||'bo3')==='bo3') return;
  const w=[waitChoice(0), waitChoice(1)]; const results=[await w[0], await w[1]];
  for(const p of [0,1]){
    const r=results[p]; if(!r || !Array.isArray(r.main) || r.main.length!==40) continue;
    const P=G.players[p]; const main=r.main.map(Number); const champN=r.champN;
    if(!validChampion({legendN:P.legendN,main,champN})) continue;
    const list=[...main]; list.splice(list.indexOf(champN),1);
    P.deckList=[...main]; P.deck=shuffleFor(p, list); P.champN=champN; P.champInZone=true;
  }
};
// ── 게임 시작 (startOnlineGame과 같은 순서: 시드 → Bo3 전장 선택(선택 소비) / 단판 무작위 전장 → newGame → 멀리건 → 첫 턴) ──
async function __startGame(cfg){
  ORC.cfg=cfg; ORC.clockReady=false; ORC.undo=[]; NET.lastStart=cfg;
  seedRng(cfg.seed);
  let bfs;
  if((cfg.format||'bo1')==='bo3'){
    const used=(cfg.match && cfg.match.used) || [[],[]];
    const rem=p=>{ const u=[...(used[p]||[])]; return (cfg.players[p].deck.bfs||[]).filter(n=>{ const i=u.indexOf(n); if(i>=0){ u.splice(i,1); return false; } return true; }); };
    const rs=[rem(0), rem(1)];
    const waits=[0,1].map(p=> rs[p].length<=1 ? Promise.resolve(rs[p][0] ?? cfg.players[p].deck.bfs[0]) : waitChoice(p));
    bfs=[await waits[0], await waits[1]];
  } else bfs=cfg.players.map(pl=>pl.deck.bfs[Math.floor(rng()*pl.deck.bfs.length)]);
  newGame({ seed:cfg.seed, priv:cfg.priv, oracle:true, reviewSetup:true, manual:cfg.manual,
    orderChooser:(cfg.format==='bo3' && cfg.match && cfg.match.game>1) ? cfg.match.chooser : undefined,
    players:cfg.players.map(pl=>({ name:pl.id, legendN:pl.deck.legendN, champN:pl.deck.champN, deck:pl.deck.main, runes:pl.deck.runes, recruitToken:271 })),
    bfs });
  await mulliganPhase(); if(!G || G.winner!==null) return;
  await startTurn();
}
async function __execAct(a){
  if(a.k==='undo'){
    if(!ORC.cfg || !ORC.cfg.undo) return;
    const top=ORC.undo[ORC.undo.length-1]; if(!top || top.actor!==a.p) return;
    const s=ORC.undo.pop(); G=s.G; UID=s.UID; _rngState=s.rng; ORC.choiceSeq=s.choiceSeq; return;
  }
  if(ORC.cfg && ORC.cfg.undo && UNDO_KINDS.has(a.k) && G){
    const actor=typeof a.p==='number' ? a.p : (a.k==='pass' ? G.actingPlayer : G.turn);
    ORC.undo.push({ G:cloneG(G), UID, rng:_rngState, choiceSeq:ORC.choiceSeq, actor }); if(ORC.undo.length>40) ORC.undo.shift();
  }
  switch(a.k){
    case 'play':      return await playCardFromHand(a.p, a.handIdx, a.opts||{});
    case 'hide':      return await hideCard(a.p, a.handIdx, a.bfIdx, a.opts||{});
    case 'playHidden':return await playHidden(a.p, a.bfIdx, G.bfs[a.bfIdx]?.hiddenCards[a.hiddenIndex]);
    case 'move': { const units=a.uids.map(uid=>everyUnit().find(u=>u.uid===uid)).filter(Boolean); if(units.length) return await moveUnits(a.p, units, a.dest); return; }
    case 'endTurn':   return await endTurn();
    case 'pass':      return await showdownPass();
    case 'runeFloat': return await runeFloat(a.p, a.idx, a.mode);
    case 'ability': {
      let src=null;
      if(a.src.kind==='legend') src={kind:'legend'};
      else if(a.src.kind==='unit'){ const u=everyUnit().find(u=>u.uid===a.src.uid); if(!u) return; src={kind:'unit',u}; }
      else if(a.src.kind==='gear'){ const g=G.players[a.p].gear[a.src.gearIdx]; if(!g) return; src={kind:'gear',g}; }
      if(a.copy && src && src.u){
        const P=G.players[a.p]; let found=null;
        const scan=(f,name)=>{ if(found||!f||name!==a.copy.srcName) return; found=(f.activated||[]).find(x=>x.label===a.copy.label)||null; };
        scan(FX[P.legendN], card(P.legendN).ko); P.gear.forEach(g=>scan(FX[g.n], card(g.n).ko)); everyUnit().filter(x=>x.ctrl===a.p&&x!==src.u&&!x.isToken).forEach(x=>scan(unitFx(x), unitName(x)));
        if(found) return await activateAbility(a.p, src, {...found, copied:true});
        return;
      }
      const fx = a.src.kind==='legend' ? FX[G.players[a.p].legendN] : (src.u?unitFx(src.u):FX[src.g.n]);
      const ab=(fx.activated||[])[a.abIdx]; if(ab) return await activateAbility(a.p, src, ab); return; }
    case 'equip': return await equipGear(a.p, a.gearIdx);
    case 'surrender': surrender(a.p); return;
    case 'manual': {
      const fn=ManualTools[a.tool]; if(!fn) return;
      const args=a.args.map(x=>{ if(x && typeof x==='object' && x.uid!==undefined) return everyUnit().find(u=>u.uid===x.uid); return x; });
      if(args.some(x=>x===undefined)) return;
      fn(...args); return; }
  }
}
function __run(fn){ return Promise.resolve().then(fn).catch(e=>__fail(e)); }
function __feed(m){
  if(m.t==='choice'){ __feedChoice(m); return; }
  const a=m.action; if(!a) return;
  if(a.k==='rematchGo'){
    const cfg=__cfgFromGo(m);
    ORC.gen++; ORC.gameNo++; ORC.choiceSeq=0; ORC.pending={}; ORC.early={};
    ORC.chain=__run(()=>__startGame(cfg)); return;
  }
  if(['rematch','rematchDecline','playmat','_rejoinDone'].includes(a.k)) return;
  ORC.chain=ORC.chain.then(()=>__run(async()=>{
    if(!G) return;
    if(!__authorized(a, m.seat)){ __violation(m.seat, a, 'unauthorized'); return; }
    const r=await __execAct(a);
    if(r===false) __violation(m.seat, a, 'rejected');
    await syncPrivateHands();
  }));
}
function __cfgFromGo(m){
  const a=m.action, base=ORC.cfg||{};
  return { seed:a.seed, priv:m.privAll||base.priv, format:base.format, manual:base.manual, banRule:base.banRule, undo:base.undo,
    match:a.pregame ? null : (a.match||null), players:[0,1].map(i=>({ id:(base.players&&base.players[i]&&base.players[i].id)||('p'+i), deck:a.decks[i] })) };
}
function __start(cfg){ ORC.gen++; ORC.gameNo=0; ORC.choiceSeq=0; ORC.pending={}; ORC.early={}; ORC.chain=__run(()=>__startGame(cfg)); }
function __digest(){
  if(!G) return null;
  const pl=G.players.map(P=>({ hand:P.hand.length, deck:P.deck.length, trash:P.trash.slice(), points:P.points, energy:P.energy,
    runes:P.runes.map(r=>r.n+(r.ex?'x':'')), base:P.base.map(u=>[u.uid,u.n,u.ex?1:0,u.dmg,u.buff].join(':')) }));
  const bfs=G.bfs.map(bf=>({ c:bf.controller, u:bf.units.map(u=>[u.uid,u.n,u.ctrl,u.ex?1:0,u.dmg,u.buff].join(':')), h:bf.hiddenCards.length }));
  return JSON.stringify({ turn:G.turn, tc:G.turnCount, phase:G.phase, state:G.state, winner:G.winner, pl, bfs, seq:ORC.choiceSeq, pend:Object.keys(ORC.pending).length });
}
`;

// ── 방 하나의 오라클 ──
// hooks: emit(msg) 공개 메시지 송신 · violation(seat, action, why) · fail(err)
function createOracle(webRoot, cfg, hooks) {
  const { script } = loadEngine(webRoot);
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Boolean,
    Date, isNaN, parseInt, parseFloat, structuredClone, Error, TypeError, RangeError, Symbol, Reflect, Proxy, WeakMap, WeakSet, RegExp, encodeURIComponent, decodeURIComponent });
  ctx.globalThis = ctx;
  let dead = false;
  ctx.__emit = msg => { if (!dead) try { hooks.emit(msg); } catch (e) { console.log('[오라클] emit 오류', e.message); } };
  ctx.__violation = (seat, action, why) => { if (!dead) try { hooks.violation(seat, action, why); } catch (e) {} };
  ctx.__fail = err => { if (dead) return; dead = true; try { hooks.fail(err); } catch (e) {} };
  script.runInContext(ctx);
  const o = {
    start(c) { if (dead) return; try { ctx.__cfg = c; vm.runInContext('__start(__cfg)', ctx); } catch (e) { ctx.__fail(e); } },
    feed(m) { if (dead) return; try { ctx.__m = m; vm.runInContext('__feed(__m)', ctx); } catch (e) { ctx.__fail(e); } },
    // 재시작 복원: 기록된 오라클 공개(게임별 id→메시지)와 대조만 하고 보내지 않는다. live() 뒤부터 모두 보낸다
    replay(revealsByGame) { ctx.__r = revealsByGame; vm.runInContext('ORC.replay={games:__r}', ctx); },
    live() { vm.runInContext('ORC.replay=null', ctx); },
    digest() { try { return vm.runInContext('__digest()', ctx); } catch (e) { return null; } },
    eval(code) { return vm.runInContext(code, ctx); },   // 테스트·진단용
    settled() { return vm.runInContext('ORC.chain', ctx); },
    get dead() { return dead; },
    dispose() { dead = true; },
  };
  return o;
}

// 좌석 seat이 받는 모습으로 가린다: 상대 덱의 메인 40장은 전부 HID (전설·선발·룬·전장은 공개 정보)
function maskDeck(deck) {
  if (!deck || !Array.isArray(deck.main)) return deck;
  const { side, ...rest } = deck;
  return { ...rest, main: deck.main.map(() => HID) };
}

module.exports = { createOracle, loadEngine, maskDeck, HID, ENGINE_FILES };
