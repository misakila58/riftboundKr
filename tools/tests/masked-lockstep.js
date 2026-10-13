// 숨김 정보 락스텝 검증 (2026-10-14)
// 온라인 대전은 두 클라이언트가 각자 엔진을 돌리는 락스텝이다. 숨김 모드(G.masked)에서는 각 화면이 상대 손패·덱을 모른다(HID).
// 이 검사는 '모든 것을 아는' 기준 게임(오라클)을 봇끼리 두게 하면서 행동·선택·공개(reveal)를 기록하고,
// 그 기록을 '좌석 0만 아는 화면'과 '좌석 1만 아는 화면' 두 엔진에 그대로 재생해, 매 행동 뒤 공개 정보가 셋 모두 같은지 본다.
// 실제 온라인과 같은 방식으로 선택 응답을 직렬화(선택지 번호·유닛 uid 등)해서 넘기므로, 상대 화면에서 선택지 목록이 달라지는 곳도 잡힌다.
//   node tools/tests/masked-lockstep.js [-n 판수] [--seed 시작시드] [--verbose]
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '../../client/web/js');
const read = f => fs.readFileSync(path.join(JS, f), 'utf8');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const N = +arg('-n', 6), SEED0 = +arg('--seed', 20261014), VERBOSE = argv.includes('--verbose');
const MAX_TURNS = +arg('--max-turns', 60);

const UI_STUB = `
var UI = {
  log(){}, render(){}, toast(){}, prompt(){}, promptShowdown(){}, manualNotice(){},
  showVictory(){}, inspect(){}, inspectUnit(){}, hideZoom(){}, showZoom(){},
  isPicking(){ return false; }, logEntryEl(){ return null; },
  fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  revealAurora:()=>Promise.resolve(),
};
var REPLAY = { viewing:false, recording:false, capture(){}, _onNewGame(){}, _onVictory(){} };
var BUILDINFO = { version:'masked-test', built:'' };
var RS = 1;
function rrand(){ RS = (RS * 1103515245 + 12345) & 0x7fffffff; return RS / 0x7fffffff; }
`;

// 오라클: 봇이 답하고 기록한다
const ORACLE = `
var REC = [], OFF = 0;
var recording = () => OFF===0 && !(typeof SIM!=='undefined' && SIM.active);
var NET = { online:false, seat:null, dispatch(a,fn){ if(fn) fn(); },
  revealChoice(p, getter, why){ const v = getter(); if(recording()) REC.push({t:'reveal', p, v:JSON.parse(JSON.stringify(v===undefined?null:v)), why}); return Promise.resolve(v); },
  async privateChoice(p, fn, why){ const rec=recording(); OFF++; let v; try{ v=await fn(); } finally{ OFF--; } if(rec) REC.push({t:'reveal', p, v:JSON.parse(JSON.stringify(v===undefined?null:v)), why:'private:'+why}); return v; } };
function recPick(fn, p, data){ if(recording()) REC.push({t:'pick', fn, p, data}); }
var SEATP = p => { POLICY.level='skilled'; POLICY.think=0; POLICY.budget=0; POLICY.peek=false; return POLICY; };
UI.pickUnitFrom = async (p,c,t,o,x) => { const u = await SEATP(p).unit(p,c,t,o,x); recPick('unit', p, u ? u.uid : null); return u; };
UI.pickOption   = async (p,t,o,b) => { const v = await SEATP(p).option(p,t,o); let i = o.findIndex(x=>x.v===v); if(i<0) i = o.findIndex(x=>JSON.stringify(x.v)===JSON.stringify(v)); recPick('option', p, {i: v===null||v===undefined? null : i, label: i>=0? o[i].label : null, n:o.length}); return v; };
UI.confirmP     = async (p,t,c,x) => { const v = !!(await SEATP(p).confirm(p,t,c,x)); recPick('confirm', p, v); return v; };
UI.pickNumber   = async (p,t,mn,mx,x) => { const v = await SEATP(p).number(p,t,mn,mx,x); recPick('number', p, v); return v; };
UI.pickHandCard = async (p,t) => { const v = await SEATP(p).hand(p,t); recPick('hand', p, v); return v; };
UI.pickMulligan = async (p) => { const v = await SEATP(p).mulligan(p); recPick('mulligan', p, v); return v; };
UI.pickBuffs    = async (p,t,c) => { const v = POLICY.buffs ? await POLICY.buffs(p,t,c) : []; recPick('buffs', p, v); return v; };
UI.pickBoardOrder = async (p,t,o) => { const v = o.map((_,i)=>i); recPick('order', p, v); return v; };
UI.pickReaction = async (p,t,o) => { const v = await SEATP(p).reaction(p,t,o); recPick('reaction', p, reactionWire(o, v)); return v; };
// 봇이 실행 경로에서 UI 선택 함수를 잠깐 바꿔 끼워 기록을 건너뛰지 못하게 고정한다 (시뮬레이션은 UI 객체 자체를 갈아 끼우므로 영향 없음)
for(const k of ['pickUnitFrom','pickOption','confirmP','pickNumber','pickHandCard','pickMulligan','pickBuffs','pickBoardOrder','pickReaction'])
  Object.defineProperty(UI, k, { value: UI[k], writable:false, configurable:false });
`;

// 재생 화면: 기록에서 차례로 꺼내 쓴다 (실제 클라이언트의 역직렬화와 같게)
const MASKED = `
var REC = null, PTR = 0, ERR = null;
function take(t, fn, p){
  const r = REC[PTR];
  if(!r){ throw new Error('기록이 모자람: '+t+' '+(fn||'')+' p'+p); }
  if(r.t!==t || (fn && r.fn!==fn) || r.p!==p) throw new Error('순서 어긋남: 화면은 '+t+':'+(fn||'')+':p'+p+' 을 기다리는데 기록은 '+JSON.stringify(r).slice(0,160)+' (위치 '+PTR+')');
  PTR++; return r;
}
var NET = { online:false, seat:null, dispatch(a,fn){ if(fn) fn(); },
  revealChoice(p, getter, why){ const r = take('reveal', null, p);
    if(knows(p)){ const mine = JSON.stringify(getter()); if(mine!==JSON.stringify(r.v)) throw new Error('공개값 불일치 p'+p+' '+why+': 이 화면 '+mine+' / 기록 '+JSON.stringify(r.v)); }
    return Promise.resolve(r.v); },
  async privateChoice(p, fn, why){ return take('reveal', null, p).v; } };
UI.pickUnitFrom = async (p,c) => { const r = take('pick','unit',p); if(r.data===null) return null; const u = c.find(x=>x.uid===r.data) || everyUnit().find(x=>x.uid===r.data); if(!u) throw new Error('유닛 없음 uid '+r.data); return u; };
UI.pickOption   = async (p,t,o) => { const r = take('pick','option',p); if(r.data.i===null) return null;
  if(o.length!==r.data.n) throw new Error('선택지 수 다름 「'+t+'」 화면 '+o.length+' / 기록 '+r.data.n);
  return o[r.data.i].v; };
UI.confirmP     = async (p) => take('pick','confirm',p).data;
UI.pickNumber   = async (p) => take('pick','number',p).data;
UI.pickHandCard = async (p) => take('pick','hand',p).data;
UI.pickMulligan = async (p) => take('pick','mulligan',p).data;
UI.pickBuffs    = async (p) => take('pick','buffs',p).data;
UI.pickBoardOrder = async (p) => take('pick','order',p).data;
UI.pickReaction = async (p,t,o) => reactionUnwire(o, take('pick','reaction',p).data);
`;

// 공통: 응수 선택의 직렬화(엔진의 UI.pickReaction 직렬화와 같아야 한다) · 공개 상태 요약 · 행동 실행
const COMMON = `
function reactionWire(o, v){
  if(v===null || v===undefined) return null;
  if(typeof REACTION_WIRE!=='undefined') return REACTION_WIRE.encode(o, v);
  const i = o.findIndex(x=>x.v===v); return {i};
}
function reactionUnwire(o, d){
  if(d===null || d===undefined) return null;
  if(typeof REACTION_WIRE!=='undefined') return REACTION_WIRE.decode(o, d);
  if(!o[d.i]) throw new Error('응수 선택지 없음 '+d.i+' / '+o.length);
  return o[d.i].v;
}
function digest(){
  const pl = G.players.map(P=>({ hand:P.hand.length, deck:P.deck.length, trash:P.trash.slice(), banish:P.banish.slice(),
    points:P.points, energy:P.energy, power:P.power, runes:P.runes.map(r=>r.n+(r.ex?'x':'')), runeDeck:P.runeDeck.length,
    legendEx:P.legendEx, champInZone:P.champInZone, gear:P.gear.map(g=>g.n+(g.ex?'x':'')),
    base:P.base.map(u=>[u.uid,u.n,u.ex?1:0,u.dmg,u.buff].join(':')) }));
  const bfs = G.bfs.map(bf=>({ c:bf.controller, u:bf.units.map(u=>[u.uid,u.n,u.ctrl,u.ex?1:0,u.dmg,u.buff].join(':')), h:bf.hiddenCards.map(h=>h.by) }));
  return JSON.stringify({ turn:G.turn, tc:G.turnCount, phase:G.phase, state:G.state, winner:G.winner, pl, bfs, chain:G.showdown?G.showdown.chain.length:0 });
}
function ownHand(p){ return JSON.stringify(G.players[p].hand); }
async function execAct(a){
  switch(a.k){
    case 'play': return await playCardFromHand(a.p, a.handIdx, a.opts||{});
    case 'hide': return await hideCard(a.p, a.handIdx, a.bfIdx, a.opts||{});
    case 'playHidden': return await playHidden(a.p, a.bfIdx, G.bfs[a.bfIdx]?.hiddenCards[a.hiddenIndex]);
    case 'move': { const us=a.uids.map(uid=>everyUnit().find(u=>u.uid===uid)).filter(Boolean); if(us.length) return await moveUnits(a.p, us, a.dest); return; }
    case 'endTurn': return await endTurn();
    case 'pass': return await showdownPass();
    case 'ability': {
      let src=null;
      if(a.src.kind==='legend') src={kind:'legend'};
      else if(a.src.kind==='unit'){ const u=everyUnit().find(u=>u.uid===a.src.uid); if(!u) return; src={kind:'unit',u}; }
      else if(a.src.kind==='gear'){ const g=G.players[a.p].gear[a.src.gearIdx]; if(!g) return; src={kind:'gear',g}; }
      const fx = a.src.kind==='legend' ? FX[G.players[a.p].legendN] : (src.u?unitFx(src.u):FX[src.g.n]);
      const ab=(fx.activated||[])[a.abIdx]; if(ab) return await activateAbility(a.p, src, ab); return; }
    case 'equip': return await equipGear(a.p, a.gearIdx);
    case 'step': if(a.name==='mulligan') return await mulliganPhase(); if(a.name==='startTurn') return await startTurn(); return;
  }
}
`;

// 오라클: 최상위 엔진 호출을 행동으로 기록 (중첩·시뮬레이션 호출은 기록하지 않는다)
const WRAP = `
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
wrapAct('hideCard', (p,i,bf,o)=>({k:'hide',p,handIdx:i,bfIdx:bf}));
wrapAct('playHidden', (p,bf,hc)=>({k:'playHidden',p,bfIdx:bf,hiddenIndex:G.bfs[bf].hiddenCards.indexOf(hc)}));
wrapAct('moveUnits', (p,us,dest)=>({k:'move',p,uids:us.map(u=>u.uid),dest}));
wrapAct('endTurn', ()=>({k:'endTurn'}));
wrapAct('showdownPass', ()=>({k:'pass'}));
wrapAct('equipGear', (p,gi)=>({k:'equip',p,gearIdx:gi}));
wrapAct('activateAbility', (p,src,ab)=>{
  const s = src.kind==='legend'?{kind:'legend'}:src.kind==='unit'?{kind:'unit',uid:src.u.uid}:{kind:'gear',gearIdx:G.players[p].gear.indexOf(src.g)};
  const fx = src.kind==='legend' ? FX[G.players[p].legendN] : (src.u?unitFx(src.u):FX[src.g.n]);
  const abIdx=(fx.activated||[]).indexOf(ab); if(abIdx<0) return null;
  return {k:'ability',p,src:s,abIdx};
});
`;

function mkDecks(seed){
  // 덱: 봇 덱 목록에서 시드로 두 개 고른다 (밴 카드 없는 것)
  const ctx={}; vm.createContext(ctx);
  vm.runInContext(read('botdecks.js')+';globalThis.__T=BOT_DECKS;', ctx);
  const arr=(Array.isArray(ctx.__T)?ctx.__T:Object.values(ctx.__T||{}));
  const a=arr[seed % arr.length], b=arr[(seed*7+3) % arr.length];
  const d=x=>({legendN:x.legendN, champN:x.champN, deck:[...x.main], runes:[...x.runes], bfs:[...x.bfs]});
  return [d(a), d(b)];
}

const ENGINE = ['cards.js','loc.js','effects.js','cardscripts.js','engine.js','bot-eval.js','bot-sim.js','bot-policy.js'].map(read).join('\n;\n');
function makeCtx(kind){
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, globalThis:undefined });
  ctx.globalThis = ctx;
  const src = [UI_STUB, ENGINE, COMMON, kind==='oracle' ? ORACLE + WRAP : MASKED, 'compileAllCards();'].join('\n;\n');
  vm.runInContext(src, ctx, { filename: 'masked-'+kind+'.js' });
  return ctx;
}

async function runGame(gi){
  const seed = SEED0 + gi*101;
  const [dA, dB] = mkDecks(gi);
  const priv = [ (seed*2654435761)>>>0, (seed*40503+12345)>>>0 ];
  const boot = (ctx, privView) => {
    ctx.__cfg = { seed, manual:false, priv:privView, bfs:[dA.bfs[0], dB.bfs[1]],
      players:[ {name:'A', legendN:dA.legendN, champN:dA.champN, deck:dA.deck, runes:dA.runes},
                {name:'B', legendN:dB.legendN, champN:dB.champN, deck:dB.deck, runes:dB.runes} ] };
    vm.runInContext('newGame(__cfg)', ctx);
  };
  const O = makeCtx('oracle'), M = [makeCtx('masked'), makeCtx('masked')];
  boot(O, priv); boot(M[0], [priv[0], null]); boot(M[1], [null, priv[1]]);
  // 오라클 진행: 멀리건 → 턴 반복 (봇)
  vm.runInContext(`
    var __drive = async function(maxTurns){
      REC.push({t:'act', a:{k:'step', name:'mulligan'}}); DEPTH++; try{ await mulliganPhase(); } finally{ DEPTH--; }
      REC.push({t:'act', a:{k:'step', name:'startTurn'}}); DEPTH++; try{ await startTurn(); } finally{ DEPTH--; }
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
    };`, O);
  try { await vm.runInContext(`__drive(${MAX_TURNS})`, O); }
  catch(e){ return { gi, ok:false, where:'oracle', err:e.stack.split('\n').slice(0,3).join(' | ') }; }
  const REC = O.REC;
  // 재생
  for(const s of [0,1]){ M[s].REC = REC; M[s].PTR = 0; }
  const acts = REC.map((r,i)=>[r,i]).filter(([r])=>r.t==='act');
  // 오라클의 행동별 요약을 다시 얻기 위해 오라클도 처음부터 다시 재생한다(기록 모드로)
  const O2 = makeCtx('masked'); boot(O2, priv); O2.REC = REC; O2.PTR = 0;
  const views = [O2, M[0], M[1]];
  for(let k=0; k<acts.length; k++){
    const [rec, idx] = acts[k];
    const next = k+1<acts.length ? acts[k+1][1] : REC.length;
    for(const [vi, V] of views.entries()){
      if(V.PTR!==idx) return { gi, ok:false, where:`view${vi} act#${k} 시작`, err:`기록 위치 ${V.PTR} ≠ ${idx} (선택 응답이 남거나 모자람) ${JSON.stringify(REC[V.PTR]).slice(0,200)}` };
      V.PTR = idx+1; V.__a = rec.a;
      try { await vm.runInContext('execAct(__a)', V); }
      catch(e){ const m=/위치 (\d+)/.exec(String(e)); const at=m?+m[1]:V.PTR; const ctxRec=REC.slice(Math.max(0,at-6),at+3).map((r,j)=>'      '+(Math.max(0,at-6)+j)+' '+JSON.stringify(r).slice(0,150)).join('\n'); return { gi, ok:false, where:`view${vi} act#${k} ${JSON.stringify(rec.a).slice(0,120)}`, err:String(e.stack||e).split('\n').slice(0,4).join(' | ')+(VERBOSE?'\n'+ctxRec:'') }; }
      if(V.PTR!==next) return { gi, ok:false, where:`view${vi} act#${k} 끝 ${JSON.stringify(rec.a).slice(0,120)}`, err:`기록 위치 ${V.PTR} ≠ ${next} — 다음 기록 ${JSON.stringify(REC[V.PTR]).slice(0,200)}` };
    }
    const dg = views.map(V=>vm.runInContext('digest()', V));
    if(dg[1]!==dg[0] || dg[2]!==dg[0]){
      const which = dg[1]!==dg[0] ? 1 : 2;
      return { gi, ok:false, where:`act#${k} ${JSON.stringify(rec.a).slice(0,120)} 뒤 공개 상태`, err:`view${which} 다름\n  오라클 ${dg[0].slice(0,600)}\n  화면   ${dg[which].slice(0,600)}` };
    }
    for(const s of [0,1]){
      const a = vm.runInContext(`ownHand(${s})`, O2), b = vm.runInContext(`ownHand(${s})`, M[s]);
      if(a!==b) return { gi, ok:false, where:`act#${k} 뒤 좌석${s} 손패`, err:`오라클 ${a} / 화면 ${b}` };
    }
  }
  const leak = [0,1].map(s => vm.runInContext(`G.players[${1-s}].hand.filter(n=>n!==HID).length + '/' + G.players[${1-s}].hand.length`, M[s]));
  return { gi, ok:true, acts:acts.length, recs:REC.length, winner:vm.runInContext('G.winner',O), turns:vm.runInContext('G.turnCount',O), leak };
}

(async()=>{
  let ok=0, bad=0;
  const ONLY = arg('--only', null);
  for(let gi=0; gi<N; gi++){
    if(ONLY!==null && gi!==+ONLY) continue;
    const r = await runGame(gi);
    if(r.ok){ ok++; if(VERBOSE) console.log(`  ✓ game ${gi}: 행동 ${r.acts} · 기록 ${r.recs} · ${r.turns}턴 · 승자 ${r.winner} · 상대 손패 중 아는 카드 ${r.leak.join(' , ')}`); }
    else { bad++; console.log(`  ✗ game ${gi} [${r.where}]\n    ${r.err}`); }
  }
  console.log(`${ok}/${ok+bad} 통과` + (bad ? ` ← 실패 ${bad}` : ''));
  process.exit(bad?1:0);
})().catch(e=>{ console.log('CRASH', e.stack); process.exit(2); });
