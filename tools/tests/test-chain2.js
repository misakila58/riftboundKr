// 카운터의 카운터(중립·결전) + 중립 [반응] 능력 응수 검증
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = require('path').join(__dirname,'..','..','client','web','js');
const r = f => fs.readFileSync(path.join(JS, f), 'utf8');
const BOOT = `
var RQ=[];   // pickReaction 응답 큐: 'counter'|'ability'|null
var UI = { log(){}, render(){}, toast(){}, fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:()=>Promise.resolve(false),
  pickUnitFrom:(p,c)=>Promise.resolve(c.find(u=>u.ctrl===1&&u.loc!=='base')||c[0]),
  pickOption:(p,t,o)=>Promise.resolve(o[0].v),
  pickReaction:(p,t,opts)=>{ const w=RQ.shift();
    if(w==='counter'){ const c=opts.find(o=>o.isCounter); return Promise.resolve(c?c.v:null); }
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
(async()=>{
  // ── ① 중립: 카운터의 카운터 ──
  // A가 소각(303, 피해2) 시전 → B가 저항(45)으로 카운터 → A가 저항으로 그 카운터를 카운터
  // → B의 카운터 무효 → 소각이 그대로 해결되어 적 유닛 피해
  fresh();
  const tgt=makeUnit(219,1,{loc:0,ready:true}); placeUnit(tgt,0);   // 4⚔
  G.players[0].hand=[303,45]; G.players[1].hand=[45];
  RQ.length=0; RQ.push('counter');   // B: 소각에 카운터
  RQ.push('counter');   // A: B의 카운터에 카운터 (재귀 창)
  RQ.push(null);        // B: 재차 응수 포기
  RQ.push(null);        // (여분)
  await playCardFromHand(0,0,{});
  ok('① 카운터의 카운터 → 원 주문 해결', tgt.dmg===2, 'dmg='+tgt.dmg);
  ok('① 양측 카운터 소모', !G.players[0].hand.includes(45) && !G.players[1].hand.includes(45));

  // ── ② 중립: 카운터가 통과하는 기존 동작 유지 ──
  fresh();
  const tgt2=makeUnit(219,1,{loc:0,ready:true}); placeUnit(tgt2,0);
  G.players[0].hand=[303]; G.players[1].hand=[45];
  RQ.length=0; RQ.push('counter');   // B 카운터
  RQ.push(null);        // A 재응수 없음(손패 없음이지만 큐 소진용)
  await playCardFromHand(0,0,{});
  ok('② 단일 카운터는 여전히 무효화', tgt2.dmg===0, 'dmg='+tgt2.dmg);

  // ── ③ 중립: [반응] 능력(럭스 314) 응수 ──
  fresh();
  const lux=makeUnit(314,1,{loc:'base',ready:true}); placeUnit(lux,'base');
  const t3=makeUnit(219,1,{loc:0,ready:true}); placeUnit(t3,0);
  G.players[0].hand=[303];
  RQ.length=0; RQ.push('ability');   // B: 럭스 능력으로 응수
  RQ.push(null);
  await playCardFromHand(0,0,{});
  ok('③ 반응 능력 발동(주문 에너지+2)', (G.players[1].energySpell||0)===2 && lux.ex===true,
     'es='+G.players[1].energySpell+' ex='+lux.ex);
  ok('③ 원 주문은 해결됨', t3.dmg===2, 'dmg='+t3.dmg);

  // ── ④ 결전: 카운터의 카운터 ──
  fresh();
  G.state='showdown'; G.actingPlayer=0;
  const u0=makeUnit(210,0,{loc:0,ready:true}); placeUnit(u0,0);
  const u1=makeUnit(219,1,{loc:0,ready:true}); placeUnit(u1,0);
  G.showdown={bfIdx:0,attacker:0,defender:1,hasCombat:true,passes:0,chain:[],chainStarter:null};
  G.players[0].hand=[303,45]; G.players[1].hand=[45];
  await playCardFromHand(0,0,{});                    // A: 소각 적재 (chain1)
  G.actingPlayer=1;
  await playCardFromHand(1,0,{});                    // B: 저항 적재 — 소각 대상 (chain2)
  ok('④ B 카운터 적재', G.showdown.chain.length===2 && G.showdown.chain[1].kind==='counter');
  G.actingPlayer=0;
  const rA=await playCardFromHand(0,0,{});           // A: 저항 적재 — B의 카운터를 대상 (핵심!)
  ok('④ 카운터를 대상으로 적재 가능', rA===true && G.showdown.chain.length===3,
     'r='+rA+' chain='+(G.showdown&&G.showdown.chain.length));
  // 해결: A저항 → B저항 무효 → 소각 정상 해결
  await showdownPass(); await showdownPass();        // A카운터 해결 (B저항 무효화)
  await showdownPass(); await showdownPass();        // B저항 해결(무효)
  await showdownPass(); await showdownPass();        // 소각 해결
  ok('④ 원 주문 정상 해결', u1.dmg===2, 'dmg='+u1.dmg+' chain='+(G.showdown?G.showdown.chain.length:'-'));

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.message));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process }), { filename: 'test-chain2.js' });
