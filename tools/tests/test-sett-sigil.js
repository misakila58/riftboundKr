// 세트 - 우두머리(269) 사망 대체: ✳ 비용을 힘의 문장(163) 같은 [반응] 자원 능력으로 충당 (제보 2026-10-13 "세트 전설 효과에 문장 안 써짐"). node tools/tests/test-sett-sigil.js
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
  const SETT=/세트/, FUND=/자원 능력/;
  const setup=(runes)=>{ fresh(); const P=G.players[0]; P.legendN=269; P.legendEx=false; P.energy=0; Object.keys(P.power).forEach(k=>P.power[k]=0); P.runes=runes; return P; };
  // ① 룬 없음 + 힘의 문장(준비) → 충당 질문 → 문장 사용 → 회수 (예전엔 "힘이 부족해" 로그만 남고 죽었다)
  let P=setup([]); let sig=gear(163,0); let u=unit(210,0,0,{buff:1});
  CONFIRM=t=>SETT.test(t); OPT=(t,o)=>{ if(FUND.test(t)){ const f=o.find(x=>/문장/.test(x.label)); return f?f.v:o[0].v; } return o[0].v; };
  await killUnit(u);
  ok('① 룬 없이 힘의 문장만 있어도 세트 회수 선택지가 나온다', CONFIRMS.some(t=>SETT.test(t)), JSON.stringify(CONFIRMS));
  ok('① 충당 질문이 뜨고 문장이 후보', OPTLIST.some(x=>FUND.test(x.t) && x.o.some(o=>/문장/.test(o.label))), JSON.stringify(OPTLIST.map(x=>x.t)));
  ok('① 문장 탈진·전설 탈진·버프 소모 후 기지로 회수', onBoard(u) && u.loc==='base' && u.ex && sig.ex===true && P.legendEx===true && u.buff===0, 'on='+onBoard(u)+' loc='+u.loc+' sig.ex='+sig.ex+' legendEx='+P.legendEx+' buff='+u.buff);
  // ② 룬이 있어도 "룬을 쓰기 전에 먼저 쓸까요?"를 물어 문장으로 내면 룬은 그대로
  P=setup([{n:7,ex:true}]); sig=gear(163,0); u=unit(210,0,0,{buff:1});
  CONFIRM=t=>SETT.test(t); OPT=(t,o)=>{ if(FUND.test(t)){ const f=o.find(x=>/문장/.test(x.label)); return f?f.v:o[0].v; } return o[0].v; };
  await killUnit(u);
  ok('② 룬이 있어도 먼저 문장을 쓸지 묻는다', OPTLIST.some(x=>/먼저 쓸까요/.test(x.t)), JSON.stringify(OPTLIST.map(x=>x.t)));
  ok('② 문장으로 내면 룬은 재활용되지 않고 회수', onBoard(u) && u.loc==='base' && P.runes.length===1 && sig.ex===true, 'runes='+P.runes.length+' sig.ex='+sig.ex+' on='+onBoard(u));
  // ③ 충당 질문에서 취소하면 그대로 죽는다
  P=setup([]); sig=gear(163,0); u=unit(210,0,0,{buff:1});
  CONFIRM=t=>SETT.test(t); OPT=(t,o)=>{ if(FUND.test(t)) return 'stop'; return o[0].v; };
  await killUnit(u);
  ok('③ 충당을 취소하면 사망', !onBoard(u) && sig.ex===false && P.legendEx===false, 'on='+onBoard(u)+' sig.ex='+sig.ex);
  // ④ 문장도 룬도 없으면 선택지 없이 죽는다 (회귀)
  P=setup([]); u=unit(210,0,0,{buff:1}); CONFIRM=t=>SETT.test(t);
  await killUnit(u);
  ok('④ 자원이 전혀 없으면 세트 선택지 없음', !onBoard(u) && !CONFIRMS.some(t=>SETT.test(t)), JSON.stringify(CONFIRMS));
  // ⑤ 무허가 무기고(23)도 분노 힘을 분노의 문장(?)/룬으로 — 룬 없음 + 분노 인장 없으면 선택지 없음, 룬 있으면 회수 (회귀)
  P=setup([{n:7,ex:true}]); u=unit(210,0,0,{_armory:1}); CONFIRM=t=>/무허가 무기고/.test(t);
  await killUnit(u);
  ok('⑤ 무허가 무기고: 분노 룬으로 회수(회귀)', onBoard(u) && u.loc==='base' && P.runes.length===0, 'on='+onBoard(u)+' runes='+P.runes.length);
  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-sett-sigil.js' });
