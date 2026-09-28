// 이동 주문의 목적지 플레이 시점 지정(355.8) 회귀 테스트 — 바람 타기 173·점멸 311·용의 분노 258 (제보 2026-09-28: 목적지를 해결 때 물었음)
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
  pickReaction:(p,t,o)=>{ if(!globalThis.REACT_SELF && String(t||'').startsWith(pname(p)+'이(가) ')) return Promise.resolve(null); REACTS.push(String(t||'')); return Promise.resolve(REACT && o.length ? REACT(p,String(t||''),o) : null); },   // 응수 창은 후보가 없어도 열린다(정보 노출 방지) — 후보 없으면 패스,
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
  const DEST=/목적지/;
  const destPrompts=()=>OPTLIST.filter(x=>DEST.test(x.t));
  // ① 바람 타기(173): 플레이 시점에 유닛+목적지를 함께 묻고(응수 창보다 먼저), 해결 때 다시 묻지 않는다 — 고른 전장으로 이동·준비
  fresh(); const a=unit(210,0,'base'); a.ex=true; G.players[1].hand=[64];
  let sawBefore=null; REACT=(p,t,o)=>{ sawBefore=destPrompts().length; return null; };
  OPT=(t,o)=>{ if(DEST.test(t)){ const x=o.find(x=>x.movement&&x.movement.dest===1); return x?x.v:o[0].v; } return o[0].v; };
  let r=await play(173);
  ok('① 응수 창 전에 목적지 선택이 1회 있었다', sawBefore===1, 'before='+sawBefore);
  ok('① 해결 때 목적지를 다시 묻지 않는다(총 1회)', destPrompts().length===1, 'n='+destPrompts().length);
  ok('① 고른 전장(2번째)으로 이동하고 준비됨', a.loc===1 && a.ex===false, 'loc='+a.loc+' ex='+a.ex);
  // ② 응수 중 유닛이 이미 그 목적지에 가 있으면(이동 불가) 이동만 생략하고 준비는 실행 (359.3.e)
  fresh(); const b=unit(210,0,'base'); b.ex=true; G.players[1].hand=[64];
  REACT=(p,t,o)=>{ removeUnit(b); placeUnit(b,1); return null; };
  OPT=(t,o)=>{ if(DEST.test(t)){ const x=o.find(x=>x.movement&&x.movement.dest===1); return x?x.v:o[0].v; } return o[0].v; };
  await play(173);
  ok('② 목적지 부적법 → 이동 생략·준비는 실행', b.loc===1 && b.ex===false && onBoard(b), 'loc='+b.loc+' ex='+b.ex);
  // ③ 응수 중 유닛이 사라지면 지시 전체 생략 (오류 없이 해결)
  fresh(); const c=unit(210,0,'base'); G.players[1].hand=[64];
  REACT=(p,t,o)=>{ removeUnit(c); return null; };
  OPT=(t,o)=>{ if(DEST.test(t)){ const x=o.find(x=>x.movement&&x.movement.dest===0); return x?x.v:o[0].v; } return o[0].v; };
  let crashed=false; try{ await play(173); }catch(e){ crashed=true; console.log(e.stack); }
  ok('③ 유닛 소실 → 오류 없이 지시 생략', !crashed && !onBoard(c) && G.players[0].hand.length===0);
  // ④ 점멸(311) '최대 2기': 플레이 시점에 두 번 묻고, 두 번째는 첫 유닛을 제외 — 둘 다 기지로
  fresh(); const d1=unit(210,0,0), d2=unit(210,0,0), d3=unit(210,0,1);
  let second=null;
  OPT=(t,o)=>{ if(DEST.test(t)){ const n=destPrompts().length; if(n===1){ return o.find(x=>x.movement&&x.movement.uid===d1.uid).v; } second=o; const x=o.find(x=>x.movement&&x.movement.uid===d2.uid); return x?x.v:null; } return o[0].v; };
  await play(311);
  ok('④ 점멸: 목적지 선택 2회', destPrompts().length===2, 'n='+destPrompts().length);
  ok('④ 두 번째 선택지에 첫 유닛 없음', !!second && !second.some(x=>x.movement&&x.movement.uid===d1.uid) && second.some(x=>x.movement&&x.movement.uid===d3.uid));
  ok('④ 둘 다 기지로', d1.loc==='base' && d2.loc==='base' && d3.loc===1, d1.loc+','+d2.loc+','+d3.loc);
  // ⑤ 아군 유닛이 없으면 바람 타기 플레이 불가(352.8)
  fresh(); unit(210,1,0);
  r=await play(173);
  ok('⑤ 아군 없으면 플레이 불가', r===false && G.players[0].hand.length===1, 'r='+r+' hand='+G.players[0].hand.length);
  // ⑥ 플레이 시점 선택을 취소하면 플레이가 취소된다 (손패·에너지 그대로)
  fresh(); const e=unit(210,0,'base'); const en=G.players[0].energy;
  OPT=(t,o)=>DEST.test(t)?null:o[0].v;
  r=await play(173);
  ok('⑥ 목적지 선택 취소 → 플레이 취소', G.players[0].hand.length===1 && G.players[0].energy===en && e.loc==='base', 'r='+r+' hand='+G.players[0].hand.length+' e='+G.players[0].energy);
  // ⑦ 용의 분노(258): 적 유닛+목적지를 플레이 시점에 — 도착지의 다른 적과 상호 피해
  fresh(); const f1=unit(210,1,0), f2=unit(210,1,1);
  OPT=(t,o)=>{ if(DEST.test(t)){ const x=o.find(x=>x.movement&&x.movement.uid===f1.uid&&x.movement.dest===1); return x?x.v:o[0].v; } return o[0].v; };
  await play(258);
  ok('⑦ 용의 분노: 플레이 시점 목적지 선택 1회·이동·상호 피해', destPrompts().length===1 && f1.loc===1 && f1.dmg>0 && f2.dmg>0, 'n='+destPrompts().length+' loc='+f1.loc+' dmg='+f1.dmg+'/'+f2.dmg);
  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-move-dest.js' });
