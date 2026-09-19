// 브린히르 썬더송(26) "상대는 이번 턴에 카드를 플레이할 수 없다" — 응수 창(카운터·[반응] 주문)에도 걸리는지 검증
// (제보 2026-09-14: 브린히르를 써도 상대가 카드를 그냥 쓸 수 있다 — 중립 응수 창의 손패 목록이 noPlay를 보지 않았다)
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = require('path').join(__dirname,'..','..','client','web','js');
const r = f => fs.readFileSync(path.join(JS, f), 'utf8');
const BOOT = `
var SEEN=[];   // 응수 창에 실제로 제시된 선택지 기록
var RQ=[];     // pickReaction 응답 큐: 'counter'|'any'|null
var UI = { log(){}, render(){}, toast(){}, fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:()=>Promise.resolve(false),
  revealAurora:()=>Promise.resolve(), pickBoardOrder:(p,t,o)=>Promise.resolve(o.map((_,i)=>i)),
  pickUnitFrom:(p,c)=>Promise.resolve(c.find(u=>u.ctrl===1&&u.loc!=='base')||c[0]),
  pickOption:(p,t,o)=>Promise.resolve((o.find(x=>/기지/.test(x.label||''))||o[0]).v),   // 유닛 배치는 기지로 (결전을 열지 않게)
  pickReaction:(p,t,opts)=>{ SEEN.push(opts.map(o=>o.label)); const w=RQ.shift();
    if(w==='counter'){ const c=opts.find(o=>o.isCounter); return Promise.resolve(c?c.v:null); }
    if(w==='any'){ const c=opts.find(o=>o.v&&o.v.hand!==undefined); return Promise.resolve(c?c.v:null); }
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
  SEEN.length=0; RQ.length=0;
}
(async()=>{
  // ── ① 브린히르 없이: B의 카운터(저항 45)가 응수 창에 제시되고 통한다 (대조군) ──
  fresh();
  const t1=makeUnit(219,1,{loc:0,ready:true}); placeUnit(t1,0);
  G.players[0].hand=[303]; G.players[1].hand=[45];
  RQ.push('counter'); RQ.push(null);
  await playCardFromHand(0,0,{});
  ok('① 대조군: 카운터가 제시됨', SEEN.length>0 && SEEN[0].some(l=>l.includes('저항')), JSON.stringify(SEEN));
  ok('① 대조군: 카운터 통과 → 피해 0', t1.dmg===0, 'dmg='+t1.dmg);

  // ── ② 브린히르(26) 플레이 → 같은 턴 A의 소각에 B는 카운터할 수 없다 ──
  fresh();
  const t2=makeUnit(219,1,{loc:0,ready:true}); placeUnit(t2,0); G.bfs[0].controller=1;   // B가 이미 통제 중 → 브린히르 배치 뒤 정리에서 결전이 열리지 않게
  G.players[0].hand=[26,303]; G.players[1].hand=[45];
  await playCardFromHand(0,0,{});                       // 브린히르 등장 → 상대 noPlay
  ok('② 브린히르 등장 → 상대 noPlay 플래그', TF().noPlay[1]===true && TF().noPlay[0]!==true, JSON.stringify(TF().noPlay));
  SEEN.length=0; RQ.push('counter'); RQ.push(null);
  await playCardFromHand(0,0,{});                       // 소각(303)
  ok('② 응수 창에 손패 카드가 제시되지 않음', !SEEN.some(list=>list.some(l=>l.includes('저항'))), JSON.stringify(SEEN));
  ok('② 소각이 그대로 해결 → 피해 2', t2.dmg===2, 'dmg='+t2.dmg);
  ok('② B의 저항은 손패에 그대로', G.players[1].hand.includes(45), JSON.stringify(G.players[1].hand));

  // ── ③ 브린히르 뒤 B의 일반 [반응] 주문도 응수 창에 안 뜬다 · 손패 직접 플레이도 거부 ──
  fresh();
  const t3=makeUnit(219,1,{loc:0,ready:true}); placeUnit(t3,0); G.bfs[0].controller=1;
  G.players[0].hand=[26,303]; G.players[1].hand=[303];   // B도 소각([반응] 주문) 보유
  await playCardFromHand(0,0,{});
  SEEN.length=0; RQ.push('any'); RQ.push(null);
  await playCardFromHand(0,0,{});
  ok('③ [반응] 주문도 응수 창에 없음', !SEEN.some(list=>list.some(l=>l.includes('소각'))), JSON.stringify(SEEN));
  const before=G.players[1].hand.length;
  const res=await playCardFromHand(1,0,{});
  ok('③ 상대의 직접 플레이는 거부', res===false && G.players[1].hand.length===before, 'res='+res);

  // ── ④ 턴이 바뀌면 플래그가 사라진다 (이번 턴 한정) ──
  G.tflags=null;                                        // 새 턴의 tflags (startTurn이 freshTF로 초기화하는 것과 동일)
  ok('④ 다음 턴엔 noPlay 없음', TF().noPlay[1]!==true);

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.message,e.stack));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process }), { filename: 'test-noplay.js' });
