// 플레이 시점 대상 지정(룰 352.8.a) + 해결 시 부적법 대상 불발(룰 356.3.e) 검증
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '../../client/web/js');
const r = f => fs.readFileSync(path.join(JS, f), 'utf8');
const BOOT = `
if(typeof globalThis.withBattlefieldSource==='undefined') globalThis.withBattlefieldSource=(s,fn)=>fn();
var PICKS=[];   // pickUnitFrom 호출 기록 (프롬프트)
var UI = { log(){}, render(){}, toast(){}, fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:()=>Promise.resolve(false),
  pickUnitFrom:(p,c,t)=>{ PICKS.push(String(t||'')); return Promise.resolve(c.find(u=>u.ctrl===1&&u.loc!=='base')||c[0]); },
  pickOption:(p,t,o)=>Promise.resolve(o[0].v),
  pickReaction:()=>Promise.resolve(null),
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
  PICKS.length=0;
}
// 유닛을 기지로 옮긴다 (응수로 도망간 상황을 흉내)
function toBase(u){ const bf=G.bfs[u.loc]; bf.units.splice(bf.units.indexOf(u),1); u.loc='base'; G.players[u.ctrl].base.push(u); }
function toBf(u,i){ const B=G.players[u.ctrl].base; B.splice(B.indexOf(u),1); u.loc=i; G.bfs[i].units.push(u); }
function openSd(){ G.state='showdown'; G.actingPlayer=0; G.showdown={bfIdx:0,attacker:0,defender:1,hasCombat:true,passes:0,chain:[],chainStarter:null}; }
(async()=>{
  // ── ① 결전: 소각(303, 피해 2) 적재 시점에 대상을 고른다 ──
  fresh(); openSd();
  const t1=makeUnit(219,1,{loc:0,ready:true}); placeUnit(t1,0);
  G.players[0].hand=[303];
  await playCardFromHand(0,0,{});
  ok('① 적재 시점에 대상 선택 프롬프트', PICKS.length===1 && /소각/.test(PICKS[0]), JSON.stringify(PICKS));
  ok('① 체인 항목이 대상 uid 보유', G.showdown.chain[0].pre && [...G.showdown.chain[0].pre.values()][0]===t1.uid);
  // 대상이 그대로 → 해결 시 피해
  await showdownPass(); await showdownPass();
  ok('① 대상 유지 → 피해 2', t1.dmg===2, 'dmg='+t1.dmg);
  ok('① 해결 때 다시 묻지 않음', PICKS.length===1, 'picks='+PICKS.length);

  // ── ② 결전: 적재 후 대상이 기지로 도망 → 그 지시 불발, 카드는 폐기 ──
  fresh(); openSd();
  const t2=makeUnit(219,1,{loc:0,ready:true}); placeUnit(t2,0);
  G.players[0].hand=[303];
  await playCardFromHand(0,0,{});
  toBase(t2);
  await showdownPass(); await showdownPass();
  ok('② 대상이 전장을 떠남 → 피해 없음(불발)', t2.dmg===0, 'dmg='+t2.dmg);
  ok('② 주문은 폐기장으로', G.players[0].trash.includes(303));

  // ── ③ 결전: 기지로 갔다가 돌아온 같은 유닛은 다시 적법 (356.3.e.5) ──
  fresh(); openSd();
  const t3=makeUnit(219,1,{loc:0,ready:true}); placeUnit(t3,0);
  G.players[0].hand=[303];
  await playCardFromHand(0,0,{});
  toBase(t3); toBf(t3,0);
  await showdownPass(); await showdownPass();
  ok('③ 돌아온 같은 유닛 → 피해 2', t3.dmg===2, 'dmg='+t3.dmg);

  // ── ④ 결전: 보이드 시커형(피해+드로우) — 대상 불발이어도 드로우는 된다 ──
  const vs=CARDS.find(c=>c.type==='Spell' && FX[c.n] && FX[c.n].playOps.length && FX[c.n].playOps.some(po=>po.ops.some(o=>o.op==='damage')&&po.ops.some(o=>o.op==='draw')));
  if(vs){
    fresh(); openSd();
    const t4=makeUnit(219,1,{loc:0,ready:true}); placeUnit(t4,0);
    G.players[0].hand=[vs.n]; const h0=G.players[0].hand.length, d0=G.players[0].deck.length;
    await playCardFromHand(0,0,{});
    toBase(t4);
    await showdownPass(); await showdownPass();
    ok('④ 「'+vs.ko+'」: 대상 불발 + 드로우는 실행', t4.dmg===0 && G.players[0].deck.length<d0, 'dmg='+t4.dmg+' deck '+d0+'→'+G.players[0].deck.length);
  } else console.log('  (④ 피해+드로우 주문 없음 — 생략)');

  // ── ⑤ 중립: 응수 창 전에 대상 지정 (프롬프트가 해결 전에 1회) ──
  fresh();
  const t5=makeUnit(219,1,{loc:0,ready:true}); placeUnit(t5,0);
  G.players[0].hand=[303];
  await playCardFromHand(0,0,{});
  ok('⑤ 중립 플레이도 대상 1회 선택 후 해결', PICKS.length===1 && t5.dmg===2, 'picks='+PICKS.length+' dmg='+t5.dmg);

  // ── ⑥ 특이점(105) "each of up to two units": 대상은 플레이 시점(응수 전)에 최대 2기·서로 다른 유닛, 해결 때 재선택 없음 ──
  fresh();   // 중립 상태(특이점은 [행동] 태그가 없어 결전 중엔 낼 수 없다) — 대상 지정 → 응수 창 → 해결 순
  const s1=makeUnit(219,1,{loc:0,ready:true}); placeUnit(s1,0); const s2=makeUnit(210,1,{loc:0,ready:true}); placeUnit(s2,0);
  G.players[0].hand=[105]; G.players[0].energy=20; PICKS.length=0;
  const played=await playCardFromHand(0,0,{});
  ok('⑥ 특이점: 플레이 시점에 대상 2기 선택 프롬프트(서로 다른 유닛)', played!==false && PICKS.length===2 && PICKS.every(t=>t.includes('피해 6')), 'played='+played+' '+JSON.stringify(PICKS));
  ok('⑥ 특이점: 두 유닛에 각 6, 해결 때 추가 선택 없음', s1.dmg>=6 && s2.dmg>=6 && PICKS.length===2, 's1='+s1.dmg+' s2='+s2.dmg+' picks='+PICKS.length);

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.message,(e.stack||'').split(String.fromCharCode(10))[1]));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-target.js' });
