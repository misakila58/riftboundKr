// 이동 격발(onMoveSelf)의 체인·응수 검증 (2026-09-22) — 녹서스 군악병(222): 응수로 죽거나 손패로 가면 '이곳'이 없어 토큰 없음
//  ① 표준 이동 + 숨겨진 칼날 ② 응수 없음 ③ 돌풍 손패 복귀 ④ 효과 이동(바람 타기) 뒤 격발
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '../../client/web/js');
const r = f => fs.readFileSync(path.join(JS, f), 'utf8');
const BOOT = `
if(typeof globalThis.withBattlefieldSource==='undefined') globalThis.withBattlefieldSource=(s,fn)=>fn();
var PICK=null;        // pickUnitFrom 선택 함수 (null이면 적 전장 유닛 우선)
var OPT=null;         // pickOption 선택 함수 (title, options)→v (null이면 첫 항목)
var NUM=null;         // pickNumber 선택 함수 (null이면 최댓값)
var CONFIRM=()=>false; // confirmP 응답 함수(prompt)
var REACT=null;       // pickReaction 응답 함수 (p,title,options)→v (null이면 응수 없음)
var PICKS=[], OPTS=[], NUMS=[], CONFIRMS=[], OPTLIST=[], REACTS=[];   // 프롬프트 기록
var UI = { log(){}, render(){}, toast(){}, fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:(p,t)=>{ CONFIRMS.push(String(t||'')); return Promise.resolve(!!CONFIRM(String(t||''),p)); },
  revealAurora:()=>Promise.resolve(), pickBoardOrder:(p,t,o)=>Promise.resolve(o.map((_,i)=>i)),
  pickUnitFrom:(p,c,t,o,x)=>{ if(x&&x.costConfirmation){ const ct=String(x.costConfirmation.text||''); CONFIRMS.push(ct); if(!CONFIRM(ct)) return Promise.resolve(null); } PICKS.push(String(t||'')); return Promise.resolve(PICK ? (c.find(u=>PICK(u,p))||c[0]) : (c.find(u=>u.ctrl===1&&u.loc!=='base')||c[0])); },
  pickOption:(p,t,o)=>{ OPTS.push(String(t||'')); OPTLIST.push({t:String(t||''),o,p,state:G.state}); return Promise.resolve(OPT ? OPT(String(t||''),o,p) : o[0].v); },
  pickReaction:(p,t,o)=>{ REACTS.push(String(t||'')); return Promise.resolve(REACT && o.length ? REACT(p,String(t||''),o) : null); },   // 응수 창은 후보가 없어도 열린다(정보 노출 방지) — 후보 없으면 패스,
  pickNumber:(p,t,mn,mx)=>{ NUMS.push(String(t||'')); return Promise.resolve(NUM ? NUM(mn,mx) : mx); },
  pickBuffs:(p,t,c)=>{ const total=c.reduce((s,u)=>s+u.buff,0); let n=NUM?NUM(0,total):total; return Promise.resolve(c.map(u=>{ const k=Math.min(n,u.buff); n-=k; return {uid:u.uid,count:k}; }).filter(x=>x.count>0)); },
  pickHandCard:()=>Promise.resolve(0), pickMulligan:()=>Promise.resolve([]),
  isPicking(){return false;}, logEntryEl(){return null;}, prompt(){}, promptShowdown(){}, manualNotice(){}, showVictory(){}, inspect(){}, inspectUnit(){}, hideZoom(){}, showZoom(){} };
var NET = { online:false, seat:null, dispatch(a,fn){ if(fn) fn(); } };
var REPLAY = { viewing:false, recording:false, capture(){}, _onNewGame(){}, _onVictory(){} };
var BUILDINFO = { version:'test', built:'' };
`;
const TEST = `
var withBattlefieldSource=(s,fn)=>fn();
compileAllCards();
let pass=0,fail=0; const ok=(n,c,i)=>{ if(c){pass++;} else {fail++; console.log('  ✗ FAIL:',n,i||'');} };
function fresh(bfs){
  seedRng(6);
  newGame({seed:6,manual:false,bfs:bfs||[280,297],players:[{name:'A',legendN:253,champN:27,deck:Array(39).fill(210),runes:Array(12).fill(7)},{name:'B',legendN:265,champN:112,deck:Array(39).fill(210),runes:Array(12).fill(214)}]});
  G.turn=0;G.phase='action';G.state='neutral';G.turnCount=5;G.actingPlayer=0;
  G.players.forEach(P=>{P.hand=[];P.energy=20;Object.keys(P.power).forEach(k=>P.power[k]=9);});
  PICK=null; OPT=null; NUM=null; CONFIRM=()=>false; REACT=null;
  PICKS.length=0; OPTS.length=0; NUMS.length=0; CONFIRMS.length=0; OPTLIST.length=0; REACTS.length=0;
}
function openSd(attacker, hasCombat){ attacker=attacker||0; G.state='showdown'; G.actingPlayer=attacker;
  G.showdown={bfIdx:0,attacker,defender:opp(attacker),hasCombat:hasCombat!==false,passes:0,chain:[],chainStarter:null}; }
const onBoard=u=>everyUnit().includes(u);
const unit=(n,p,loc,o)=>{ const u=makeUnit(n,p,{loc,ready:true}); placeUnit(u,loc); Object.assign(u,o||{}); return u; };
const gear=(n,p)=>{ const g={n,ex:false,attachedTo:null}; G.players[p].gear.push(g); return g; };
const play=async(n,p)=>{ p=p||0; G.players[p].hand=[n]; return await playCardFromHand(p,0,{}); };
const resolve=async()=>{ await showdownPass(); await showdownPass(); };
// 전투 격발은 체인에 적재된다(465 4단계) — 쌓인 격발을 전부 해결하고 결전은 유지한다
const settle=async()=>{ for(let i=0;i<8;i++){ const sd=G.showdown; if(!sd) return; if(sd.pendingTriggers&&sd.pendingTriggers.length) await flushCombatTriggers(sd); if(!sd.chain.length) return; await showdownPass(); await showdownPass(); } };
const find=(p,n)=>allUnits(p).find(u=>u.n===n);
const totalPower=p=>Object.values(G.players[p].power).reduce((a,b)=>a+b,0);
(async()=>{
  const DRUM=222, BLADE=213, GUST=169, RIDE=173;
  const tokens=()=>everyUnit().filter(u=>u.isToken);
  // ══ ① 표준 이동 → 이동 격발에 응수: 숨겨진 칼날로 군악병 처치 → '이곳' 없음 → 토큰 없음 (#2410 · #6592) ══
  fresh(); G.bfs[0].controller=1; unit(219,1,0); G.bfs[0].hiddenCards.push({n:BLADE,by:1,turn:0});
  const d1=unit(DRUM,0,'base'); REACT=(p,t,o)=>{ const h=o.find(x=>x.v&&x.v.hidden); return h?h.v:null; }; PICK=(u,p)=>p===1?u.n===DRUM:true;
  await moveUnits(0,[d1],0);
  ok('① 이동 격발에 응수 창 열림', REACTS.some(t=>/군악병 격발/.test(t)), REACTS.join('|'));
  ok('① 군악병 처치됨 → 토큰 없음', !onBoard(d1) && tokens().length===0, 'onBoard='+onBoard(d1)+' tokens='+tokens().length);

  // ══ ② 응수 없음 → 토큰이 그 전장에 ══
  fresh(); G.bfs[0].controller=1; unit(219,1,0); const d2=unit(DRUM,0,'base');
  await moveUnits(0,[d2],0);
  ok('② 응수 없으면 토큰이 전장0에', tokens().length===1 && tokens()[0].loc===0 && tokens()[0].ctrl===0, 'tokens='+tokens().map(t=>t.loc).join(','));

  // ══ ③ 돌풍(169)으로 손패에 되돌리면 토큰 없음 (#1685 · #6849) ══
  fresh(); G.bfs[0].controller=1; unit(219,1,0); const d3=unit(DRUM,0,'base'); G.players[1].hand=[GUST];
  REACT=(p,t,o)=>{ const h=o.find(x=>Number.isInteger(x.v?.hand)); return h?h.v:null; }; PICK=(u,p)=>p===1?u.n===DRUM:true;
  await moveUnits(0,[d3],0);
  ok('③ 돌풍 응수 → 군악병 손패, 토큰 없음', G.players[0].hand.includes(DRUM) && tokens().length===0, 'hand='+G.players[0].hand.join(',')+' tokens='+tokens().length);

  // ══ ④ 효과 이동(바람 타기 173) → 주문이 끝난 뒤 이동 격발 응수 창 → 토큰 ══
  fresh(); G.bfs[0].controller=0; const d4=unit(DRUM,0,'base',{ex:true}); G.players[1].hand=[GUST]; PICK=(u,p)=>p===0?u===d4:false;   // B에게 돌풍(응수 후보)이 있어야 창이 열린다 — B는 응수하지 않음(REACT null)
  OPT=(t,o)=>{ if(/효과 이동/.test(t)){ const x=o.find(x=>x.movement&&x.movement.dest===0); return x?x.v:o[0].v; } return o[0].v; };
  await play(RIDE);
  ok('④ 바람 타기 뒤 이동 격발 응수 창', REACTS.some(t=>/군악병 격발/.test(t)), REACTS.join('|'));
  ok('④ 군악병 전장0·준비, 토큰 전장0', d4.loc===0 && d4.ex===false && tokens().length===1 && tokens()[0].loc===0, 'loc='+d4.loc+' ex='+d4.ex+' tokens='+tokens().map(t=>t.loc).join(','));

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-move-trigger.js' });
