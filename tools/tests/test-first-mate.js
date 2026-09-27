// 일등 항해사(132) 「내가 플레이될 때, 다른 유닛 하나를 준비」 진행 멈춤 재현 — 헤드리스(vm) 엔진 테스트
//  ① 화염 폭풍 전장 사전 지정 ② 신난다 '이 해결의 버림' ③ 태양 원반 [군단] 자기 제외 ④ 코그모 기지 사망 ⑤ 수호자 응수 사망
//  ⑥ 시간선 역전 버림 격발 ⑦ 카이사 힘 비용 ⑧ 게릴라전 동명 2장 ⑨ 마도서 카운터 소모 ⑩ 유망한 미래 LIFO ⑪ 둥지 제자리 준비
//  ⑫ 블리츠 기지 플레이 ⑬ 효과 플레이 유닛의 등장 격발 응수 창
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
  const withTimeout=(name,fn)=>Promise.race([fn().then(()=>'done'), new Promise(r=>setTimeout(()=>r('HANG'),3000))]).then(v=>{ ok(name+' 진행 (멈춤 없음)', v==='done', v+' PICKS='+PICKS.join('|')+' OPTS='+OPTS.join('|')+' CONFIRMS='+CONFIRMS.join('|')); return v; });
  // A: 다른 아군 유닛(탈진)이 기지에 있을 때
  fresh(); const a1=unit(219,0,'base'); a1.ex=true; PICK=(u)=>u===a1;
  await withTimeout('A 아군 탈진 유닛 있음', ()=>play(132));
  ok('A 대상 준비됨', a1.ex===false, 'ex='+a1.ex);
  // B: 다른 유닛 없음
  fresh(); await withTimeout('B 다른 유닛 없음', ()=>play(132));
  ok('B 일등 항해사 등장', !!find(0,132));
  // C: 적 유닛만
  fresh(); G.bfs[0].controller=1; const c1=unit(219,1,0); c1.ex=true; PICK=null;
  await withTimeout('C 적 유닛만', ()=>play(132));
  // E: 아군이 준비된 유닛만 (탈진 아님)
  fresh(); const e1=unit(219,0,'base'); PICK=(u)=>u===e1;
  await withTimeout('E 아군 준비 유닛만', ()=>play(132));
  // F: 상대(p1)가 플레이, 자기 탈진 유닛 있음
  fresh(); G.turn=1; G.actingPlayer=1; const f1=unit(219,1,'base'); f1.ex=true; PICK=(u)=>u===f1;
  await withTimeout('F 상대가 플레이', ()=>play(132,1));
  ok('F 대상 준비됨', f1.ex===false, 'ex='+f1.ex);
  // G: 응수 창(B에게 돌풍) — 격발이 체인에 오르고 응수 후 해결
  fresh(); G.bfs[0].controller=1; const g1=unit(219,0,'base'); g1.ex=true; unit(210,1,0); G.players[1].hand=[169]; PICK=(u,p)=>p===0?u===g1:true;
  await withTimeout('G 응수 창 열림', ()=>play(132));
  ok('G 대상 준비됨', g1.ex===false, 'ex='+g1.ex+' REACTS='+REACTS.join('|'));
  // H: 숨김 카드로 두었다가 공개 플레이
  fresh(); G.bfs[0].controller=0; const h1=unit(219,0,0); h1.ex=true; const hx=unit(210,1,1); G.players[0].hand=[132]; PICK=(u)=>u===h1;
  await withTimeout('H 숨김', ()=>hideCard(0,0));
  const hc=G.bfs[0].hiddenCards[0]; console.log('H hidden=', !!hc, JSON.stringify(hc));
  if(hc){ G.turnCount++; G.turn=1; G.actingPlayer=1; openSd(1,true); G.showdown.bfIdx=0; await withTimeout('H 숨김 공개 플레이', ()=>playHidden(0,0,hc)); await withTimeout('H 결전 해결', ()=>settle()); }
  console.log('H fm=', !!find(0,132), 'h1.ex=', h1.ex, 'PICKS=', PICKS.join('|'));
  // I: 동시 격발 (139 온라인 유닛 플레이 격발 + 항해사 등장 격발)
  fresh(); const i1=unit(139,0,'base'); i1.ex=true; const i2=unit(219,0,'base'); i2.ex=true; PICK=(u)=>u===i2; OPT=(t,o)=>o[0].v;
  await withTimeout('I 동시 격발', ()=>play(132));
  ok('I 대상 준비됨', i2.ex===false, 'ex='+i2.ex+' OPTS='+OPTS.join('|'));
  // J: 굴절 유닛이 후보 (굴절 비용 확인 프롬프트)
  const defl=CARDS.find(c=>c.type==='Unit' && (c.tko||'').includes('[굴절'));
  if(defl){ fresh(); G.bfs[0].controller=1; const j1=unit(defl.n,1,0); j1.ex=true; const j2=unit(219,0,'base'); j2.ex=true; PICK=(u)=>u===j1; CONFIRM=()=>true;
    await withTimeout('J 굴절 후보 ('+defl.ko+')', ()=>play(132)); console.log('J j1.ex=', j1.ex, 'CONFIRMS=', CONFIRMS.join('|'), 'PICKS=', PICKS.join('|')); }
  // K: 전장에 배치
  fresh(); G.bfs[0].controller=0; const k1=unit(219,0,0); k1.ex=true; PICK=(u)=>u===k1; G.players[0].hand=[132];
  await withTimeout('K 전장 배치', async()=>{ await playCardFromHand(0,0,{loc:0}); });
  console.log('K fm loc=', find(0,132)&&find(0,132).loc, 'k1.ex=', k1.ex);
  // L: 효과로 플레이 (차원문 구출 102 — 덱에서 유닛)
  fresh(); G.players[0].deck=[132,210,210]; const l1=unit(219,0,'base'); l1.ex=true; PICK=(u,p)=>u===l1; OPT=(t,o)=>o[0].v;
  await withTimeout('L 효과 플레이(102)', ()=>play(102));
  console.log('L fm=', !!find(0,132), 'l1.ex=', l1.ex, 'PICKS=', PICKS.join('|'), 'OPTS=', OPTS.join('|'));
  // M: '아군 유닛을 준비시킬 때' 격발 카드가 보드에 있을 때 (준비 → 리스너 격발 → 대기열 flush)
  const listeners=Object.keys(FX).map(Number).filter(n=>FX[n]&&FX[n].triggers&&FX[n].triggers.onYouReadyUnit&&card(n)&&card(n).type==='Unit');
  console.log('M listeners:', listeners.map(n=>n+':'+card(n).ko).join(', '));
  for(const n of listeners){
    fresh(); const m0=unit(n,0,'base'); const m1=unit(219,0,'base'); m1.ex=true; PICK=(u)=>u===m1; OPT=(t,o)=>o[0].v;
    const v=await withTimeout('M '+card(n).ko+' 리스너', ()=>play(132));
    console.log('M', card(n).ko, 'm1.ex=', m1.ex, 'PICKS=', PICKS.join('|'), 'OPTS=', OPTS.join('|'));
    // 리스너 유닛 자체가 탈진해 First Mate 대상이 되는 경우
    fresh(); const m2=unit(n,0,'base'); m2.ex=true; PICK=(u)=>u===m2; OPT=(t,o)=>o[0].v;
    await withTimeout('M2 '+card(n).ko+' 자기 준비', ()=>play(132));
    console.log('M2', card(n).ko, 'm2.ex=', m2.ex, 'PICKS=', PICKS.join('|'));
  }
  // N2: 내가 통제하는 빈 전장에 배치
  fresh(); G.bfs[0].controller=0; const q2=unit(219,0,'base'); q2.ex=true; PICK=(u)=>u===q2; G.players[0].hand=[132];
  await withTimeout('N2 내 전장 배치', async()=>{ await playCardFromHand(0,0,{playLoc:0}); });
  console.log('N2 fm.loc=', find(0,132)&&find(0,132).loc, 'q2.ex=', q2.ex);
  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-132.js' });
