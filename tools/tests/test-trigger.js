// 유닛 '내가 플레이될 때' 격발의 체인 처리 검증 (2026-09-22): 대상 선지정 → 중립 응수 창(숨김 카드 공개 가능) / 결전 체인 적재
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = require('path').join(__dirname,'..','..','client','web','js');
const r = f => fs.readFileSync(path.join(JS, f), 'utf8');
const BOOT = `
var RQ=[];   // pickReaction 응답 큐: 'hidden'|'ability'|null
var RW=0;    // 응수 창이 열린 횟수
var UI = { log(){}, render(){}, toast(){}, fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:()=>Promise.resolve(false),
  revealAurora:()=>Promise.resolve(), pickBoardOrder:(p,t,o)=>Promise.resolve(o.map((_,i)=>i)),
  pickUnitFrom:(p,c)=>Promise.resolve(c.find(u=>u.ctrl===1&&u.loc!=='base')||c[0]),
  pickOption:(p,t,o)=>Promise.resolve(o[0].v),
  pickReaction:(p,t,opts)=>{ RW++; const w=RQ.shift();
    if(w==='hidden'){ const h=opts.find(o=>o.v&&o.v.hidden); return Promise.resolve(h?h.v:null); }
    if(w==='ability'){ const a=opts.find(o=>o.v&&o.v.ab); return Promise.resolve(a?a.v:null); }
    return Promise.resolve(null); },
  pickNumber:(p,t,mn,mx)=>Promise.resolve(mx), pickHandCard:()=>Promise.resolve(0), pickMulligan:()=>Promise.resolve([]),
  isPicking(){return false;}, logEntryEl(){return null;}, prompt(){}, promptShowdown(){}, manualNotice(){}, showVictory(){}, inspect(){}, inspectUnit(){}, hideZoom(){}, showZoom(){} };
var NET = { online:false, seat:null, dispatch(a,fn){ if(fn) fn(); } };
var REPLAY = { viewing:false, recording:false, capture(){}, _onNewGame(){}, _onVictory(){} };
var BUILDINFO = { version:'test', built:'' };
`;
const TEST = `
compileAllCards();
let pass=0,fail=0; const ok=(n,c,i)=>{ if(c){pass++;} else {fail++; console.log('  ✗ FAIL:',n,i||'');} };
function fresh(){
  seedRng(6);
  newGame({seed:6,manual:false,bfs:[280,297],players:[{name:'A',legendN:253,champN:27,deck:Array(39).fill(210),runes:Array(12).fill(7)},{name:'B',legendN:265,champN:112,deck:Array(39).fill(210),runes:Array(12).fill(214)}]});
  G.turn=0;G.phase='action';G.state='neutral';G.turnCount=5;G.actingPlayer=0;
  G.players.forEach(P=>{P.hand=[];P.energy=20;Object.keys(P.power).forEach(k=>P.power[k]=9);});
}
const REX=92, BLADE=213, SGT=219;   // 격랑의 렉스(플레이 시 전장의 적 유닛에 피해 6) · 숨겨진 칼날([숨겨짐] 유닛 처치, 통제자 2드로우) · 선봉대 하사(4⚔)
(async()=>{
  // ── ① 중립: 렉스 격발에 숨겨진 칼날로 응수 — 대상이 된 내 유닛을 처치해 피해 6 불발 + 2드로우 ──
  fresh();
  const tgt=makeUnit(SGT,1,{loc:0,ready:true}); placeUnit(tgt,0);
  G.bfs[0].controller=1; G.bfs[0].hiddenCards.push({n:BLADE, by:1, turn:0});
  G.players[0].hand=[REX]; const h1=G.players[1].hand.length;
  RQ.length=0; RQ.push('hidden'); RQ.push(null); RQ.push(null);
  RW=0;
  await playCardFromHand(0,0,{loc:'base'});
  ok('① 렉스 격발에 응수 창이 열림', RW>=1, 'RW='+RW);
  ok('① 숨겨진 칼날 공개 → 대상 유닛 처치', !G.bfs[0].units.includes(tgt) && G.bfs[0].hiddenCards.length===0,
     'units='+G.bfs[0].units.length+' hidden='+G.bfs[0].hiddenCards.length);
  ok('① 처치된 유닛의 통제자 2드로우', G.players[1].hand.length===h1+2, 'hand='+G.players[1].hand.length);
  ok('① 렉스는 보드에 있음(유닛 자체는 즉시 해결)', everyUnit().some(u=>u.n===REX && u.ctrl===0));
  ok('① 피해 6은 대상이 사라져 불발(다른 유닛 무피해)', everyUnit().every(u=>u.dmg===0));

  // ── ② 중립: 응수 없음 → 렉스 피해 6이 그대로 들어가 4⚔ 유닛 사망 ──
  fresh();
  const t2=makeUnit(SGT,1,{loc:0,ready:true}); placeUnit(t2,0);
  G.players[0].hand=[REX];
  RQ.length=0; RQ.push(null);
  await playCardFromHand(0,0,{loc:'base'});
  ok('② 응수 없으면 피해 6 → 사망', !G.bfs[0].units.includes(t2) && G.players[1].trash.includes(SGT), 'units='+G.bfs[0].units.length);

  // ── ③ 중립: 적법 대상이 없으면 응수 창을 열지 않고 효과 없음 ──
  fresh();
  G.players[0].hand=[REX];
  RQ.length=0; RW=0;
  await playCardFromHand(0,0,{loc:'base'});
  ok('③ 대상 없는 격발은 응수 창 없이 종료', RW===0 && everyUnit().some(u=>u.n===REX), 'RW='+RW);

  // ── ④ 결전: 숨겨 둔 렉스 공개 → 격발이 체인에 적재되고 양측 패스 뒤 해결 ──
  fresh();
  G.state='showdown'; G.actingPlayer=0;
  const a0=makeUnit(210,0,{loc:0,ready:true}); placeUnit(a0,0);
  const b1=makeUnit(SGT,1,{loc:0,ready:true}); placeUnit(b1,0);
  G.showdown={bfIdx:0,attacker:0,defender:1,hasCombat:true,passes:0,chain:[],chainStarter:null};
  G.bfs[0].controller=0; G.bfs[0].hiddenCards.push({n:REX, by:0, turn:0});   // 숨긴 전장은 내가 통제하는 전장(유닛 배치 가능)
  await playHidden(0,0);
  const item=G.showdown && G.showdown.chain.find(it=>it.kind==='ability' && it.triggered && it.n===REX);
  ok('④ 렉스 격발이 체인에 적재', !!item, 'chain='+(G.showdown?G.showdown.chain.map(i=>i.kind+':'+i.n).join(','):'-'));
  ok('④ 적재 시점엔 미해결', b1.dmg===0, 'dmg='+b1.dmg);
  await showdownPass(); await showdownPass();
  ok('④ 해결 후 피해 6 → 사망', b1.dmg>=6 || !G.bfs[0].units.includes(b1), 'dmg='+b1.dmg+' on='+G.bfs[0].units.includes(b1));

  // ── ⑤ 자원 [추가] 격발은 체인 없이 즉시 (333.1.c) ──
  const resN=Object.keys(FX).map(Number).find(n=>{ const c=card(n), f=FX[n]; return c && c.type==='Unit' && f.triggers?.onPlay?.length && f.triggers.onPlay.every(t=>isResourceAbility(t)); });
  if(resN){
    fresh(); G.players[0].hand=[resN]; RQ.length=0; RW=0;
    const before=G.players[0].energy;
    await playCardFromHand(0,0,{loc:'base'});
    ok('⑤ 자원 격발('+card(resN).ko+')은 응수 창 없이 즉시', RW===0, 'RW='+RW+' e='+before+'→'+G.players[0].energy);
  } else console.log('  (⑤ 자원 전용 등장 격발 유닛 없음 — 생략)');

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process }), { filename: 'test-trigger.js' });
