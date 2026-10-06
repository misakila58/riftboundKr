// 녹턴(194) '덱 맨 위에서 보거나 공개할 때' 회귀 테스트 — 티모 전략가 121 공개·촛불 성소 291 보기 (제보 2026-10-06: 티모 공개에 녹턴이 안 나옴)
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
  const NOC=/추방하고 힘 1/;
  // ① 티모 전략가 방어 격발: 덱 위 5장 공개 중 녹턴 → 추방·플레이 제안, 수락하면 보드에 나오고 재활용 목록에서 빠진다
  fresh(); const enemy=unit(210,1,0);
  G.players[0].deck=[210,194,210,210,210,...Array(30).fill(210)];
  CONFIRM=t=>NOC.test(t);
  await execOps([OPX('teemoDefend')],{p:0,bfIdx:0});
  ok('① 티모 공개 → 녹턴 제안', CONFIRMS.some(t=>NOC.test(t)), JSON.stringify(CONFIRMS));
  ok('① 녹턴이 보드에 나옴', everyUnit().some(u=>u.n===194&&u.ctrl===0));
  ok('① 녹턴은 덱으로 재활용되지 않음', !G.players[0].deck.includes(194) && G.players[0].deck.length===34, 'deck='+G.players[0].deck.length);
  // ② 거절하면 녹턴도 다른 공개 카드와 함께 재활용(덱 맨 아래)
  fresh(); unit(210,1,0);
  G.players[0].deck=[194,210,210,210,210,...Array(30).fill(210)];
  CONFIRM=()=>false;
  await execOps([OPX('teemoDefend')],{p:0,bfIdx:0});
  ok('② 거절 → 녹턴 재활용', G.players[0].deck.length===35 && G.players[0].deck.slice(-5).includes(194) && !everyUnit().some(u=>u.n===194));
  // ③ 촛불 성소(덱 위 2장 보기)도 녹턴 제안
  fresh();
  G.players[0].deck=[210,194,...Array(30).fill(210)];
  CONFIRM=t=>NOC.test(t);
  await execOps([{op:'scryTop',n:2}],{p:0});
  ok('③ 촛불 성소 → 녹턴 제안·플레이', CONFIRMS.some(t=>NOC.test(t)) && everyUnit().some(u=>u.n===194), JSON.stringify(CONFIRMS));
  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-nocturne.js' });
