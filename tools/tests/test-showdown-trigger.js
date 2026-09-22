// 결전 종료 정복 격발이 플레이하는 주문의 소실 방지 검증 (2026-09-22)
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
const KAISA=112, BURN=303;   // 카이사 - 진화자(정복 시 폐기장의 주문을 점수 미만 비용이면 플레이 후 재활용) · 소각(피해 2)
(async()=>{
  // ── 결전 종료 정복 격발이 플레이한 주문은 결전 체인에 남지 않고 즉시 해결·재활용된다 (봇전 로그 2026-09-22 「유망한 미래」 증발) ──
  fresh();
  G.state='showdown'; G.actingPlayer=0;
  const k=makeUnit(KAISA,0,{loc:0,ready:true}); placeUnit(k,0);
  const b=makeUnit(219,1,{loc:'base',ready:true}); placeUnit(b,'base');
  G.bfs[0].contestedBy=0; G.showdown={bfIdx:0,attacker:0,defender:1,hasCombat:false,passes:0,chain:[],chainStarter:null};
  G.players[0].points=5; G.players[0].trash=[BURN]; RQ.length=0;
  const deckBefore=G.players[0].deck.length;
  await showdownPass(); await showdownPass();
  ok('정복 후 결전 종료', G.showdown===null && G.state==='neutral', 'state='+G.state);
  ok('정복 격발의 폐기장 주문이 해결됨(피해 2)', everyUnit().some(u=>u.dmg===2), everyUnit().map(u=>unitName(u)+':'+u.dmg).join(','));
  ok('그 주문은 재활용되어 덱으로(소실 없음)', G.players[0].deck.includes(BURN) && !G.players[0].trash.includes(BURN) && G.players[0].deck.length===deckBefore+1,
     'deck+'+(G.players[0].deck.length-deckBefore)+' trash='+G.players[0].trash.join(','));
  ok('점수 6', G.players[0].points===6, 'pts='+G.players[0].points);
  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process }), { filename: 'test-showdown-trigger.js' });
