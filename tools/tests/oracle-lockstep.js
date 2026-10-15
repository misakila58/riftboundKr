// 서버 오라클 락스텝 검증 (숨김 정보 2단계, 2026-10-15)
// 세 엔진을 실제 프로토콜로 잇는다: 서버 오라클(server/oracle.js, 모든 것을 앎) ↔ 좌석 0 화면 ↔ 좌석 1 화면(둘 다 비공개 시드 없음).
// '두뇌'(모든 것을 아는 봇 엔진)가 행동·선택·주인 결정을 기록하면, 각 화면은 자기 좌석 차례에 그 기록을 답으로 보내고
// 상대 차례에는 중계(가짜 서버)로 받는다. 오라클은 공개(revealCards)·주인 전용 공개(hand-sync·peek)를 보낸다.
// 매 행동 뒤 ① 공개 상태(오라클·화면 0·화면 1)가 같은지 ② 자기 손패가 오라클과 같은지 ③ 상대 손패·자기 덱이 HID로 남는지(누설 없음) 본다.
//   node tools/tests/oracle-lockstep.js [-n 판수] [--seed 시작시드] [--verbose] [--only k]
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '../../client/web/js');
const WEB = path.join(__dirname, '../../client/web');
const ORACLE = require('../../server/oracle.js');
const read = f => fs.readFileSync(path.join(JS, f), 'utf8');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const N = +arg('-n', 6), SEED0 = +arg('--seed', 20261015), VERBOSE = argv.includes('--verbose');
const MAX_TURNS = +arg('--max-turns', 60);
const HID = -1;

const UI_STUB = `
var UI = {
  log(){}, render(){}, toast(){}, toastP(){}, prompt(){}, promptShowdown(){}, manualNotice(){},
  showVictory(){}, inspect(){}, inspectUnit(){}, hideZoom(){}, showZoom(){}, promptForState(){},
  isPicking(){ return false; }, logEntryEl(){ return null; },
  fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  revealAurora:()=>Promise.resolve(),
};
var REPLAY = { viewing:false, recording:false, capture(){}, _onNewGame(){}, _onVictory(){} };
var BUILDINFO = { version:'oracle-test', built:'' };
var RS = 1;
function rrand(){ RS = (RS * 1103515245 + 12345) & 0x7fffffff; return RS / 0x7fffffff; }
function validChampion(deck){
  const champion=card(deck.champN), legend=card(deck.legendN);
  return !!(deck.main?.includes(deck.champN) && champion?.type==='Unit' && champion.super==='Champion'
    && (champion.tags||[]).some(t=>(legend?.tags||[]).includes(t)));
}
`;

// 두뇌: 모든 것을 아는 봇 엔진. 행동(act)·선택(pick)·주인 결정(reveal private)을 기록한다. 공개·주인 전용 공개는 스스로 계산(기록 안 함).
const BRAIN = `
var REC = [], OFF = 0;
var recording = () => OFF===0 && !(typeof SIM!=='undefined' && SIM.active);
var NET = { online:true, seat:null, spectating:false, lastStart:null, _localOnly:0, choiceSeq:0, pendingChoices:{}, dispatch(a,fn){ if(fn) fn(); },
  revealChoice(p, getter, why){ return Promise.resolve(getter()); },
  ownerReveal(p, getter, why){ return Promise.resolve(getter()); },
  async privateChoice(p, fn, why){ const rec=recording(); OFF++; let v; try{ v=await fn(); } finally{ OFF--; } if(rec) REC.push({t:'reveal', p, v:JSON.parse(JSON.stringify(v===undefined?null:v)), why}); return v; },
  choice(p, fn, ser, deser){ return Promise.resolve(fn()).then(v=>deser?deser(ser?ser(v):v):v); } };
function recPick(fn, p, data){ if(recording()) REC.push({t:'pick', fn, p, data}); }
var SEATP = p => { POLICY.level='skilled'; POLICY.think=0; POLICY.budget=0; POLICY.peek=false; return POLICY; };
UI.pickUnitFrom = async (p,c,t,o,x) => { if(!c.length) return null; const u = await SEATP(p).unit(p,c,t,o,x); recPick('unit', p, u ? u.uid : null); return u; };
UI.pickOption   = async (p,t,o,b) => { const v = await SEATP(p).option(p,t,o); let i = o.findIndex(x=>x.v===v); if(i<0) i = o.findIndex(x=>JSON.stringify(x.v)===JSON.stringify(v)); recPick('option', p, {i: v===null||v===undefined||i<0?null:i, n:o.length}); return i<0?null:o[i].v; };
UI.confirmP     = async (p,t,c,x) => { const v = !!(await SEATP(p).confirm(p,t,c,x)); recPick('confirm', p, v); return v; };
UI.pickNumber   = async (p,t,mn,mx,x) => { const v = await SEATP(p).number(p,t,mn,mx,x); recPick('number', p, v); return v; };
UI.pickHandCard = async (p,t) => { if(!G.players[p].hand.length) return null; const v = await SEATP(p).hand(p,t); recPick('hand', p, v); return v; };
UI.pickMulligan = async (p) => { const v = await SEATP(p).mulligan(p); recPick('mulligan', p, v); return v; };
UI.pickBuffs    = async (p,t,c) => { const v = POLICY.buffs ? await POLICY.buffs(p,t,c) : []; recPick('buffs', p, v); return v; };
UI.pickBoardOrder = async (p,t,o) => { if(o.length<2) return o.map((_,i)=>i); const v = o.map((_,i)=>i); recPick('order', p, v); return v; };
UI.pickReaction = async (p,t,o) => { const v = await SEATP(p).reaction(p,t,o); recPick('reaction', p, REACTION_WIRE.encode(o, v)); return v; };
for(const k of ['pickUnitFrom','pickOption','confirmP','pickNumber','pickHandCard','pickMulligan','pickBuffs','pickBoardOrder','pickReaction'])
  Object.defineProperty(UI, k, { value: UI[k], writable:false, configurable:false });
// 주문 준비 화면(spell-stage.js) 흐름: 확인 선택을 'stage' 기록으로 남긴다(항상 확인)
var SPELL_STAGE_CANCEL = Symbol('spellStageCancel'); UI.spellStage=null;
UI.beginSpellStage = (p,handIdx,n,opts={})=>{ const draft={game:G,p,handIdx,n,mode:opts.mode||'cast',committed:false,confirming:false}; UI.spellStage=draft; return draft; };
UI.confirmSpellStage = async (draft,targets)=>{ draft.confirming=true; recPick('stage', draft.p, true); draft.committed=true; UI.endSpellStage(draft); };
UI.endSpellStage = (draft)=>{ if(UI.spellStage===draft) UI.spellStage=null; };
UI.resumeSpellStage = (draft)=>{ if(draft.game!==G || (UI.spellStage && UI.spellStage!==draft)) return false; draft.committed=false; draft.confirming=false; UI.spellStage=draft; return true; };
// 사이드덱 교체: 화면·오라클과 같은 재구성(변경 없음) — 덱 순서(비공개 난수 소비)가 같아야 기록된 선택이 맞는다
UI.sideboardStep = async ()=>{ if(NET.lastStart && NET.lastStart.format==='bo3') return; for(const p of [0,1]){ const P=G.players[p]; const main=[...P.deckList]; const champN=P.champN; const list=[...main]; list.splice(list.indexOf(champN),1); P.deckList=[...main]; P.deck=shuffleFor(p, list); P.champN=champN; P.champInZone=true; } };
var DEPTH = 0;
function wrapAct(name, mk){
  const orig = globalThis[name];
  globalThis[name] = async function(...args){
    const top = DEPTH===0 && recording();
    if(top){ const a = mk(...args); if(a) REC.push({t:'act', a}); }
    DEPTH++;
    try{ return await orig.apply(this, args); } finally{ DEPTH--; }
  };
}
wrapAct('playCardFromHand', (p,i,o)=>({k:'play',p,handIdx:i,opts:JSON.parse(JSON.stringify(o||{}))}));
wrapAct('hideCard', (p,i,bf,o)=>({k:'hide',p,handIdx:i,bfIdx:bf,opts:JSON.parse(JSON.stringify(o||{}))}));
wrapAct('playHidden', (p,bf,hc)=>({k:'playHidden',p,bfIdx:bf,hiddenIndex:G.bfs[bf].hiddenCards.indexOf(hc)}));
wrapAct('moveUnits', (p,us,dest)=>({k:'move',p,uids:us.map(u=>u.uid),dest}));
wrapAct('endTurn', ()=>({k:'endTurn', p:G.turn}));
wrapAct('showdownPass', ()=>({k:'pass', p:G.actingPlayer}));
wrapAct('equipGear', (p,gi)=>({k:'equip',p,gearIdx:gi}));
wrapAct('activateAbility', (p,src,ab)=>{
  const s = src.kind==='legend'?{kind:'legend'}:src.kind==='unit'?{kind:'unit',uid:src.u.uid}:{kind:'gear',gearIdx:G.players[p].gear.indexOf(src.g)};
  const fx = src.kind==='legend' ? FX[G.players[p].legendN] : (src.u?unitFx(src.u):FX[src.g.n]);
  const abIdx=(fx.activated||[]).indexOf(ab); if(abIdx<0) return null;
  return {k:'ability',p,src:s,abIdx};
});
// 실제 클라이언트는 손패의 주문을 준비 화면(stageSpell)으로, 숨김은 stageHide로 낸다 — 봇의 호출에도 같은 옵션을 넣어 같은 경로를 기록한다
{ const orig=globalThis.playCardFromHand;
  globalThis.playCardFromHand=async function(p,i,o){ o=o||{}; const n=G.players[p]?.hand?.[i];
    if(DEPTH===0 && !o.champZone && !o.fromHidden && !o.byEffect && !o.fromDeck && !o.fromTrash && card(n)?.type==='Spell') o={...o, stageSpell:true};
    return orig.call(this,p,i,o); }; }
{ const orig=globalThis.hideCard;
  globalThis.hideCard=async function(p,i,bf,o){ o=o||{}; if(DEPTH===0 && i!=='champ') o={...o, stageHide:true}; return orig.call(this,p,i,bf,o); }; }
function remainingBfs(cfg, p){ const u=[...(((cfg.match&&cfg.match.used)||[[],[]])[p]||[])]; return (cfg.players[p].deck.bfs||[]).filter(n=>{ const i=u.indexOf(n); if(i>=0){ u.splice(i,1); return false; } return true; }); }
var __drive = async function(cfg, maxTurns){
  REC=[]; NET.lastStart=cfg; seedRng(cfg.seed);
  const bfs=(cfg.format==='bo3') ? [0,1].map(p=>{ const r=remainingBfs(cfg,p); return r[0] ?? cfg.players[p].deck.bfs[0]; })   // 화면은 남은 전장 중 첫 번째를 고른다
    : cfg.players.map(pl=>pl.deck.bfs[Math.floor(rng()*pl.deck.bfs.length)]);
  newGame({ seed:cfg.seed, priv:cfg.priv, oracle:true, reviewSetup:true, manual:false,
    orderChooser:(cfg.format==='bo3' && cfg.match && cfg.match.game>1) ? cfg.match.chooser : undefined,
    players:cfg.players.map(pl=>({ name:pl.id, legendN:pl.deck.legendN, champN:pl.deck.champN, deck:pl.deck.main, runes:pl.deck.runes, recruitToken:271 })), bfs });
  DEPTH++; try{ await mulliganPhase(); await startTurn(); } finally{ DEPTH--; }
  const ctx = POLICY.newCtx();
  for(let t=0; G.winner===null && t<maxTurns; t++){
    const p=G.turn;
    for(let g=0; g<200; g++){
      if(G.winner!==null) return;
      if(G.state==='showdown'){ const ap=G.actingPlayer; const act=await POLICY.showdownAction(ap); if(!act || (await POLICY.runAction(ap, act))===false) await showdownPass(); continue; }
      if(G.turn!==p || G.phase!=='action') break;
      POLICY.syncCtx(ctx);
      if(await POLICY.step(p, ctx, ()=>{})) break;
    }
    if(G.winner===null && G.turn===p) await endTurn();
  }
};
`;

// 화면: 자기 좌석 차례엔 기록을 답으로 보내고, 상대 차례·공개는 중계로 받는다 (실제 클라이언트 NET.choice/routedPick과 같은 순번 규칙)
const VIEW = `
var REC = null, PTR = 0, SEAT = 0, __send = null, choiceSeq = 0, pending = {}, early = {};
function take(t, fn, p){
  const r = REC[PTR];
  if(!r){ throw new Error('기록이 모자람: '+t+' '+(fn||'')+' p'+p); }
  if(r.t!==t || (fn && r.fn!==fn) || r.p!==p) throw new Error('순서 어긋남: 화면은 '+t+':'+(fn||'')+':p'+p+' 을 기다리는데 기록은 '+JSON.stringify(r).slice(0,160)+' (위치 '+PTR+')');
  PTR++; return r;
}
function waitId(id){ const e=early[id]; if(e){ delete early[id]; return Promise.resolve(e); } return new Promise(res=>{ pending[id]=res; }); }
function __recv(m){ const res=pending[m.id]; if(res){ delete pending[m.id]; res(m); } else early[m.id]=m; }
// NET.choice: 내 좌석이면 answer()로 답을 만들어 보내고(실제 클라와 같이 에코를 기다려 해결), 아니면 기다린다
function netChoice(p, answer, deser, waitOnly){
  const id=++choiceSeq;
  if(p===SEAT && !waitOnly){ Promise.resolve(answer()).then(v=>{ __send({t:'choice', id, seat:SEAT, data:JSON.parse(JSON.stringify(v===undefined?null:v))}); }); }
  return waitId(id).then(m=>{ if(typeof m.seat==='number' && m.seat!==p) throw new Error('선택 응답 좌석 불일치 id '+id+' 기대 p'+p+' 실제 '+m.seat); return deser?deser(m.data):m.data; });
}
var NET = { online:true, seat:SEAT, spectating:false, lastStart:null, _localOnly:0, pendingChoices:{}, catchingUp:false, reconnecting:false,
  get choiceSeq(){ return choiceSeq; }, set choiceSeq(v){ choiceSeq=v; },
  dispatch(a,fn){ if(fn) fn(); },
  revealChoice(p, getter, why){ return netChoice(p, null, v=>v, true); },
  ownerReveal(p, getter, why){ return netChoice(p, null, v=>v, true); },
  privateChoice(p, fn, why){ const r=take('reveal', null, p); return netChoice(p, ()=>r.v, v=>v); },
  choice(p, fn, ser, deser){ return netChoice(p, fn, deser); } };
async function pre(){ if(!(NET._localOnly>0)) await syncPrivateHands(); }   // ui.js routedPick 입구와 같다
var SPELL_STAGE_CANCEL = Symbol('spellStageCancel'); UI.spellStage=null;
function stageDraftFor(p){ const d=UI.spellStage; return (d && d.game===G && d.p===p && !d.committed) ? d : null; }
UI.beginSpellStage = (p,handIdx,n,opts={})=>{ const draft={game:G,p,handIdx,n,mode:opts.mode||'cast',committed:false,confirming:false}; UI.spellStage=draft; return draft; };
UI.confirmSpellStage = async (draft,targets)=>{ draft.confirming=true; await pre(); const r=take('pick','stage',draft.p); const v=await netChoice(draft.p, ()=>r.data, x=>x); if(v!==true) throw SPELL_STAGE_CANCEL; draft.committed=true; UI.endSpellStage(draft); };
UI.endSpellStage = (draft)=>{ if(UI.spellStage===draft) UI.spellStage=null; };
UI.resumeSpellStage = (draft)=>{ if(draft.game!==G || (UI.spellStage && UI.spellStage!==draft)) return false; draft.committed=false; draft.confirming=false; UI.spellStage=draft; return true; };
UI.pickUnitFrom = async (p,c) => { if(!c.length) return null; await pre(); const r=take('pick','unit',p); const d=await netChoice(p, ()=>r.data===null?null:{uid:r.data}, v=>v); if(!d) return null; const u = c.find(x=>x.uid===d.uid) || everyUnit().find(x=>x.uid===d.uid); if(!u) throw new Error('유닛 없음 uid '+d.uid); return u; };
UI.pickOption   = async (p,t,o) => { await pre(); const r=take('pick','option',p); if(o.length!==r.data.n) throw new Error('선택지 수 다름 「'+t+'」 화면 '+o.length+' / 기록 '+r.data.n); const i=await netChoice(p, ()=>r.data.i, v=>v); if(i===null||i===undefined) return null; const x=o[i]; return x?x.v:null; };
UI.confirmP     = async (p) => { await pre(); const r=take('pick','confirm',p); return !!(await netChoice(p, ()=>r.data, v=>v)); };
UI.pickNumber   = async (p) => { await pre(); const r=take('pick','number',p); return await netChoice(p, ()=>r.data, v=>v); };
UI.pickHandCard = async (p) => { if(!G.players[p].hand.length) return null; await pre(); const r=take('pick','hand',p); const i=await netChoice(p, ()=>r.data, v=>v); return (i===null||i===undefined)?null:i; };
UI.pickMulligan = async (p) => { await pre(); const r=take('pick','mulligan',p); return await netChoice(p, ()=>r.data, v=>v); };
UI.pickBuffs    = async (p) => { await pre(); const r=take('pick','buffs',p); return await netChoice(p, ()=>r.data, v=>v); };
UI.pickBoardOrder = async (p,t,o) => { if(o.length<2) return o.map((_,i)=>i); await pre(); const r=take('pick','order',p); return await netChoice(p, ()=>r.data, v=>v); };
UI.pickReaction = async (p,t,o) => { await pre(); const r=take('pick','reaction',p); const w=await netChoice(p, ()=>r.data, v=>v); return REACTION_WIRE.decode(o, w); };
// 설정 화면·사이드덱 — 실제 클라이언트(setup-preview.js·main.js)와 같은 선택 소비
var clockReady=false;
function setupChoice(p, v){ return netChoice(p, ()=>v, x=>x); }
UI.reviewSetup = async ()=>true;
UI.rollSetupDice = async ()=>({instant:false});
UI.rollSetupDiceBoth = async (d0,d1,round)=>{
  if(round>1){ await Promise.all([setupChoice(0,true), setupChoice(1,true)]); return; }
  if(!clockReady){ await setupChoice(0, 1); await setupChoice(1, {received:1,sent:2}); await setupChoice(0, 0); clockReady=true; }
  await setupChoice(0, 123);
  await Promise.all([setupChoice(0,true), setupChoice(1,true)]);
};
UI.pickSetupOrder = (p)=>UI.pickOption(p,'주사위 승리 — 선공과 후공 선택',[{v:'first',label:'선공'},{v:'second',label:'후공'}]);
UI.sideboardStep = async ()=>{
  if(NET.lastStart && (NET.lastStart.format||'bo3')==='bo3') return;
  const results=await Promise.all([0,1].map(p=>{ const mine=p===SEAT; const P=G.players[p];
    return NET.choice(p, ()=>mine?{main:[...P.deckList], champN:P.champN}:null, v=>v, v=>v); }));
  for(const p of [0,1]){
    const r=results[p]; if(!r || !Array.isArray(r.main) || r.main.length!==40) continue;
    const P=G.players[p]; const main=r.main.map(Number); const champN=r.champN;
    if(!(main.every(n=>n===HID) && G.oracle) && !validChampion({legendN:P.legendN,main,champN})) continue;
    let deck; const list=[...main]; const ci=list.indexOf(champN); if(ci>=0) list.splice(ci,1); else list.pop(); deck=shuffleFor(p, list);
    P.deckList=[...main]; P.deck=deck; P.champN=champN; P.champInZone=true;
  }
};
function remainingBfs(cfg, p){ const u=[...(((cfg.match&&cfg.match.used)||[[],[]])[p]||[])]; return (cfg.players[p].deck.bfs||[]).filter(n=>{ const i=u.indexOf(n); if(i>=0){ u.splice(i,1); return false; } return true; }); }
async function __start(cfg){
  choiceSeq=0; pending={}; early={}; clockReady=false; NET.lastStart=cfg;
  seedRng(cfg.seed);
  let bfs;
  if(cfg.format==='bo3'){   // main.js MATCH.chooseBattlefields: 남은 전장이 2개 이상인 좌석만 선택(좌석 순 번호), 각자 동시에
    const rs=[remainingBfs(cfg,0), remainingBfs(cfg,1)];
    const waits=[0,1].map(p=> rs[p].length<=1 ? Promise.resolve(rs[p][0] ?? cfg.players[p].deck.bfs[0]) : NET.choice(p, ()=>rs[p][0], v=>v, v=>v));
    bfs=[await waits[0], await waits[1]];
  } else bfs=cfg.players.map(pl=>pl.deck.bfs[Math.floor(rng()*pl.deck.bfs.length)]);
  newGame({ seed:cfg.seed, priv:cfg.priv, oracle:true, reviewSetup:true, manual:false,
    orderChooser:(cfg.format==='bo3' && cfg.match && cfg.match.game>1) ? cfg.match.chooser : undefined,
    players:cfg.players.map(pl=>({ name:pl.id, legendN:pl.deck.legendN, champN:pl.deck.champN, deck:pl.deck.main, runes:pl.deck.runes, recruitToken:271 })), bfs });
  await mulliganPhase(); await startTurn();
}
async function execAct(a){
  let r;
  switch(a.k){
    case 'play': r=await playCardFromHand(a.p, a.handIdx, a.opts||{}); break;
    case 'hide': r=await hideCard(a.p, a.handIdx, a.bfIdx, a.opts||{}); break;
    case 'playHidden': r=await playHidden(a.p, a.bfIdx, G.bfs[a.bfIdx]?.hiddenCards[a.hiddenIndex]); break;
    case 'move': { const us=a.uids.map(uid=>everyUnit().find(u=>u.uid===uid)).filter(Boolean); if(us.length) r=await moveUnits(a.p, us, a.dest); break; }
    case 'endTurn': r=await endTurn(); break;
    case 'pass': r=await showdownPass(); break;
    case 'ability': {
      let src=null;
      if(a.src.kind==='legend') src={kind:'legend'};
      else if(a.src.kind==='unit'){ const u=everyUnit().find(u=>u.uid===a.src.uid); if(!u) break; src={kind:'unit',u}; }
      else if(a.src.kind==='gear'){ const g=G.players[a.p].gear[a.src.gearIdx]; if(!g) break; src={kind:'gear',g}; }
      const fx = a.src.kind==='legend' ? FX[G.players[a.p].legendN] : (src.u?unitFx(src.u):FX[src.g.n]);
      const ab=(fx.activated||[])[a.abIdx]; if(ab) r=await activateAbility(a.p, src, ab); break; }
    case 'equip': r=await equipGear(a.p, a.gearIdx); break;
  }
  await syncPrivateHands();   // net.js _pumpLoop: 행동 끝 동기화
  return r;
}
function digest(){
  const pl = G.players.map(P=>({ hand:P.hand.length, deck:P.deck.length, trash:P.trash.slice(), banish:P.banish.slice(),
    points:P.points, energy:P.energy, power:P.power, runes:P.runes.map(r=>r.n+(r.ex?'x':'')), runeDeck:P.runeDeck.length,
    legendEx:P.legendEx, champInZone:P.champInZone, gear:P.gear.map(g=>g.n+(g.ex?'x':'')),
    base:P.base.map(u=>[u.uid,u.n,u.ex?1:0,u.dmg,u.buff].join(':')) }));
  const bfs = G.bfs.map(bf=>({ c:bf.controller, u:bf.units.map(u=>[u.uid,u.n,u.ctrl,u.ex?1:0,u.dmg,u.buff].join(':')), h:bf.hiddenCards.map(h=>h.by) }));
  return JSON.stringify({ turn:G.turn, tc:G.turnCount, phase:G.phase, state:G.state, winner:G.winner, pl, bfs, chain:G.showdown?G.showdown.chain.length:0, seq:choiceSeq });
}
`;

function mkDecks(seed){
  const ctx={}; vm.createContext(ctx);
  vm.runInContext(read('botdecks.js')+';globalThis.__T=BOT_DECKS;', ctx);
  const arr=(Array.isArray(ctx.__T)?ctx.__T:Object.values(ctx.__T||{}));
  const a=arr[seed % arr.length], b=arr[(seed*7+3) % arr.length];
  const d=x=>({legendN:x.legendN, champN:x.champN, main:[...x.main], runes:[...x.runes], bfs:[...x.bfs]});
  return [d(a), d(b)];
}

const ENGINE = ORACLE.ENGINE_FILES.map(read).join('\n;\n');
function makeCtx(kind){
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, globalThis:undefined });
  ctx.globalThis = ctx;
  const src = [UI_STUB, ENGINE, kind==='brain' ? BRAIN : VIEW, 'compileAllCards();'].join('\n;\n');
  vm.runInContext(src, ctx, { filename: 'oracle-'+kind+'.js' });
  return ctx;
}
const maskFor = (cfg, seat) => ({ ...cfg, priv:[null,null], players: cfg.players.map((pl,i)=>({ ...pl, deck: i===seat ? pl.deck : ORACLE.maskDeck(pl.deck) })) });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const BO3 = argv.includes('--bo3');
async function runGame(gi){
  const seed = SEED0 + gi*101;
  const [dA, dB] = mkDecks(gi);
  const priv = [ (seed*2654435761)>>>0 || 1, (seed*40503+12345)>>>0 || 1 ];
  const cfg = { seed, priv, format:BO3?'bo3':'bo1', manual:false, banRule:false, undo:false, match:null,
    players:[ {id:'A', deck:dA}, {id:'B', deck:dB} ] };
  // ① 두뇌 — 기록
  const B = makeCtx('brain'); B.__cfg = cfg;
  try { await vm.runInContext(`__drive(__cfg, ${MAX_TURNS})`, B); }
  catch(e){ return { gi, ok:false, where:'brain', err:e.stack.split('\n').slice(0,3).join(' | ') }; }
  let REC = B.REC;
  // ② 오라클(실제 모듈) + 화면 둘 + 가짜 중계
  const V = [makeCtx('view'), makeCtx('view')];
  const inbox = { o:[], v:[[],[]] }; const log = [];
  let oracleErr = null, violations = [];
  const deliverToViews = (m, maskData) => { for(const s of [0,1]){ const mm = maskData ? maskData(m, s) : m; V[s].__m = mm; vm.runInContext('__recv(__m)', V[s]); } };
  const O = ORACLE.createOracle(WEB, cfg, {
    emit(msg){ log.push(msg); deliverToViews(msg, (m, s)=>({ t:'choice', id:m.id, seat:m.seat, from:'oracle', data:m.dataFor[s] })); },
    violation(seat, a, why){ violations.push({seat, a, why}); },
    fail(err){ oracleErr = err; },
  });
  for(const s of [0,1]){
    V[s].REC = REC; V[s].PTR = 0; V[s].SEAT = s; vm.runInContext(`NET.seat=${s}; SEAT=${s};`, V[s]);
    V[s].__send = m => {   // 클라이언트 → 서버: 오라클에 전체, 상대 화면에는 덱 가림 — 자기 화면에도 에코
      const full = { ...m, seat: s }; log.push(full);
      O.feed(full);
      const masked = (full.data && Array.isArray(full.data.main)) ? { ...full, data: { ...full.data, main: full.data.main.map(()=>HID) } } : full;
      V[s].__m = full; vm.runInContext('__recv(__m)', V[s]);
      V[1-s].__m = masked; vm.runInContext('__recv(__m)', V[1-s]);
    };
  }
  O.start(cfg);
  const starts = [0,1].map(s => { V[s].__cfg = maskFor(cfg, s); return vm.runInContext('__start(__cfg)', V[s]); });
  const settle = async () => {
    const t0 = Date.now();
    while(true){
      const o = await Promise.race([O.settled().then(()=>'o'), sleep(50).then(()=>'t')]);
      const chain = V.map(s=>vm.runInContext('Object.keys(pending).length', s));
      if(o==='o' && chain.every(c=>c===0)) { await sleep(0); return true; }
      if(oracleErr) return false;
      if(Date.now()-t0 > 8000) return false;
    }
  };
  // 시작(멀리건·첫 턴)
  try { await Promise.all([...starts, O.settled()]); } catch(e){ return { gi, ok:false, where:'start', err:String(e&&e.stack||e).split('\n').slice(0,3).join(' | ') }; }
  if(oracleErr) return { gi, ok:false, where:'oracle start', err:String(oracleErr.stack||oracleErr).split('\n').slice(0,3).join(' | ') };
  let acts = REC.map((r,i)=>[r,i]).filter(([r])=>r.t==='act');
  const check = (k, label) => {
    const dg = [O.digest(), ...V.map(s=>vm.runInContext('digest()', s))];
    // 오라클 요약은 필드가 다르므로 화면끼리 비교하고, 오라클과는 공통 필드만 비교
    if(dg[1]!==dg[2]) return `화면 0·1 공개 상태 다름 (${label})\n  v0 ${dg[1].slice(0,500)}\n  v1 ${dg[2].slice(0,500)}`;
    const o = JSON.parse(dg[0]), v = JSON.parse(dg[1]);
    for(const f of ['turn','tc','phase','state','winner']) if(o[f]!==v[f]) return `오라클·화면 ${f} 다름 (${label}): 오라클 ${o[f]} / 화면 ${v[f]}`;
    for(const s of [0,1]){ if(o.pl[s].hand!==v.pl[s].hand || o.pl[s].deck!==v.pl[s].deck || JSON.stringify(o.pl[s].trash)!==JSON.stringify(v.pl[s].trash) || o.pl[s].points!==v.pl[s].points)
      return `오라클·화면 좌석${s} 장수/폐기장/점수 다름 (${label})\n  오라클 ${JSON.stringify(o.pl[s]).slice(0,300)}\n  화면 ${JSON.stringify(v.pl[s]).slice(0,300)}`; }
    if(JSON.stringify(o.bfs.map(b=>[b.c,b.u]))!==JSON.stringify(v.bfs.map(b=>[b.c,b.u]))) return `오라클·화면 전장 다름 (${label})`;
    if(o.seq!==v.seq) return `선택 순번 다름 (${label}): 오라클 ${o.seq} / 화면 ${v.seq}`;
    // 자기 손패 = 오라클의 그 좌석 손패 (주인 전용 공개로 맞춰진다)
    for(const s of [0,1]){
      const vh = vm.runInContext(`JSON.stringify(G.players[${s}].hand)`, V[s]);
      const oh = O.eval(`JSON.stringify(G.players[${s}].hand)`);
      if(vh!==oh) return `좌석${s} 자기 손패가 오라클과 다름 (${label}): 화면 ${vh} / 오라클 ${oh}`;
    }
    return null;
  };
  const replay = async (tag) => { for(let k=0; k<acts.length; k++){
    const [rec, idx] = acts[k];
    for(const s of [0,1]){
      if(V[s].PTR!==idx) return { gi, ok:false, where:`${tag}view${s} act#${k} 시작`, err:`기록 위치 ${V[s].PTR} ≠ ${idx} ${JSON.stringify(REC[V[s].PTR]).slice(0,200)}` };
      V[s].PTR = idx+1; V[s].__a = rec.a;
    }
    const full = { t:'act', seat: rec.a.p ?? 0, action: rec.a }; log.push(full);
    O.feed(full);
    const execs = [0,1].map(s => vm.runInContext('execAct(__a)', V[s]));
    let err = null;
    try { await Promise.all(execs); } catch(e){ err = e; }
    const ok = await settle();
    if(err) return { gi, ok:false, where:`act#${k} ${JSON.stringify(rec.a).slice(0,120)}`, err:String(err.stack||err).split('\n').slice(0,3).join(' | ') };
    if(oracleErr) return { gi, ok:false, where:`oracle act#${k} ${JSON.stringify(rec.a).slice(0,120)}`, err:String(oracleErr.stack||oracleErr).split('\n').slice(0,4).join(' | ') };
    if(!ok) return { gi, ok:false, where:`act#${k} ${JSON.stringify(rec.a).slice(0,120)}`, err:'대기 시간 초과 — 선택 응답이 오지 않음 (오라클 pending '+JSON.stringify(JSON.parse(O.digest()||'{}').pend)+', 화면 pending '+V.map(s=>vm.runInContext('JSON.stringify(Object.keys(pending))', s)).join('/')+')' };
    const next = k+1<acts.length ? acts[k+1][1] : REC.length;
    for(const s of [0,1]) if(V[s].PTR!==next) return { gi, ok:false, where:`view${s} act#${k} 끝 ${JSON.stringify(rec.a).slice(0,120)}`, err:`기록 위치 ${V[s].PTR} ≠ ${next} — 다음 기록 ${JSON.stringify(REC[V[s].PTR]).slice(0,200)}` };
    const bad = check(k, `act#${k} ${JSON.stringify(rec.a).slice(0,100)}`);
    if(bad) return { gi, ok:false, where:`act#${k}`, err:bad };
    // 누설: 화면 s의 상대 손패는 전부 HID(공개 효과로 알려진 것 제외 — 공개된 카드는 오라클 공개 메시지에 있다), 자기 덱도 HID(엿본 위 몇 장 제외)
    for(const s of [0,1]){
      const oppKnown = +vm.runInContext(`G.players[${1-s}].hand.filter(n=>n!==HID).length`, V[s]);
      const ownDeckKnown = +vm.runInContext(`G.players[${s}].deck.filter(n=>n!==HID).length`, V[s]);
      const ownHandHid = +vm.runInContext(`G.players[${s}].hand.filter(n=>n===HID).length`, V[s]);
      if(ownHandHid) return { gi, ok:false, where:`act#${k} 좌석${s} 자기 손패`, err:`동기화 뒤에도 HID가 ${ownHandHid}장 남음 (hand-sync 누락)` };
      if(ownDeckKnown>5) return { gi, ok:false, where:`act#${k} 좌석${s} 자기 덱`, err:`자기 덱에 아는 카드 ${ownDeckKnown}장 — 엿보기(최대 5장) 이상이면 덱 순서 누설` };
      V[s].__leak = (V[s].__leak||0) + oppKnown;
    }
  } return null; };
  const r1 = await replay(''); if(r1) return r1;
  if(BO3){   // ② 2게임: 재대결 신호(rematchGo) — 오라클은 새 시드·덱으로 새 게임, 화면은 전장 선택(남은 2개)·이전 패자 선후공 선택
    const w1 = JSON.parse(O.digest()).winner; if(w1===null) return { gi, ok:false, where:'bo3 game1', err:'1게임이 끝나지 않음 (턴 상한)' };
    const used = [[ vm.runInContext('G.bfs[0].n', V[0]) ],[ vm.runInContext('G.bfs[1].n', V[0]) ]];
    const seed2 = (seed*7919+17)>>>0, priv2 = [ (seed2*2654435761)>>>0 || 1, (seed2*40503+12345)>>>0 || 1 ];
    const cfg2 = { ...cfg, seed:seed2, priv:priv2, match:{ format:'bo3', wins:[w1===0?1:0, w1===1?1:0], game:2, used, chooser:1-w1 } };
    const B2 = makeCtx('brain'); B2.__cfg = cfg2;
    try { await vm.runInContext(`__drive(__cfg, 8)`, B2); } catch(e){ return { gi, ok:false, where:'brain game2', err:e.stack.split('\n').slice(0,3).join(' | ') }; }
    REC = B2.REC; acts = REC.map((r,i)=>[r,i]).filter(([r])=>r.t==='act');
    for(const s of [0,1]){ V[s].REC = REC; V[s].PTR = 0; }
    O.feed({ t:'act', seat:0, action:{ k:'rematchGo', p:0, seed:seed2, decks:[dA,dB], pregame:false, match:cfg2.match }, privAll:priv2 });
    const starts2 = [0,1].map(s => { V[s].__cfg = maskFor(cfg2, s); return vm.runInContext('__start(__cfg)', V[s]); });
    try { await Promise.all([...starts2, O.settled()]); } catch(e){ return { gi, ok:false, where:'bo3 game2 start', err:String(e&&e.stack||e).split('\n').slice(0,3).join(' | ') }; }
    if(oracleErr) return { gi, ok:false, where:'oracle game2 start', err:String(oracleErr.stack||oracleErr).split('\n').slice(0,3).join(' | ') };
    const bad2 = check(-1, 'bo3 2게임 시작'); if(bad2) return { gi, ok:false, where:'bo3 game2 start', err:bad2 };
    const bfs2 = vm.runInContext('G.bfs.map(b=>b.n)', V[0]);
    if(bfs2[0]===used[0][0] && cfg.players[0].deck.bfs.filter(n=>n!==used[0][0]).length) return { gi, ok:false, where:'bo3 game2 bfs', err:'이긴 게임의 전장이 다시 쓰임' };
    const r2 = await replay('2게임 '); if(r2) return r2;
  }
  // 승자 확인
  const w = JSON.parse(O.digest()).winner;
  if(VERBOSE && violations.length) console.log('    위반:', JSON.stringify(violations.slice(0,4)).slice(0,600));
  return { gi, ok:true, acts:acts.length, recs:REC.length, reveals:log.filter(m=>m.from==='oracle').length, winner:w, violations:violations.length, turns:JSON.parse(O.digest()).tc, stages:REC.filter(r=>r.t==='pick'&&r.fn==='stage').length };
}

module.exports = { makeCtx, mkDecks, maskFor, BRAIN, VIEW, UI_STUB, HID, WEB };
if(require.main===module) (async()=>{
  let ok=0, bad=0;
  const ONLY = arg('--only', null);
  for(let gi=0; gi<N; gi++){
    if(ONLY!==null && gi!==+ONLY) continue;
    const r = await runGame(gi);
    if(r.ok){ ok++; if(VERBOSE) console.log(`  ✓ game ${gi}: 행동 ${r.acts} · 기록 ${r.recs} · 공개 ${r.reveals} · ${r.turns}턴 · 승자 ${r.winner} · 위반 ${r.violations} · 준비화면 ${r.stages}`); }
    else { bad++; console.log(`  ✗ game ${gi} [${r.where}]\n    ${r.err}`); }
  }
  console.log(`${ok}/${ok+bad} 통과` + (bad ? ` ← 실패 ${bad}` : ''));
  process.exit(bad?1:0);
})().catch(e=>{ console.log('CRASH', e.stack); process.exit(2); });
