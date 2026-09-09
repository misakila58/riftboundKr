// RiftJudge 감사 1차 묶음(work-1.json) 검증:
//  ① 주문 '플레이할 때' 격발은 완전 해결 뒤(룰 407.3.a) — 레이븐블룸 학생·빙의·탈취(execAs) ② 카운터된 주문은
//  플레이 수에 안 셈(룰 408.2) — 숨김 onPlayFromHidden 포함 ③ 볼리베어 '위력적 유닛 플레이'는 등장 격발 전 판정
//  ④ 오라의 수치 키워드 합산(룰 Shield/Assault Value summed) ⑤ 카운터 주문은 대상 없이는 플레이 불가(룰 352)
//  ⑥ 토큰도 플레이된 유닛(룰 351.3) — 오라 [통찰]·'유닛 플레이' 리스너
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '../../client/web/js');
const r = f => fs.readFileSync(path.join(JS, f), 'utf8');
const BOOT = `
if(typeof globalThis.withBattlefieldSource==='undefined') globalThis.withBattlefieldSource=(s,fn)=>fn();
var RQ=[];            // pickReaction 응답 큐: 'counter'|'steal'|null
var PICK=null;        // pickUnitFrom 선택 함수 (null이면 적 전장 유닛 우선)
var CONFIRM=()=>false; // confirmP 응답 함수(prompt)
var CONFIRMS=[];      // confirmP 프롬프트 기록
var UI = { log(){}, render(){}, toast(){}, fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:(p,t)=>{ CONFIRMS.push(String(t||'')); return Promise.resolve(!!CONFIRM(String(t||''))); },
  pickUnitFrom:(p,c,t)=>Promise.resolve(PICK ? (c.find(u=>PICK(u))||c[0]) : (c.find(u=>u.ctrl===1&&u.loc!=='base')||c[0])),
  pickOption:(p,t,o)=>Promise.resolve(o[0].v),
  pickReaction:(p,t,opts)=>{ const w=RQ.shift();
    if(w==='counter'){ const c=opts.find(o=>o.isCounter&&o.card&&FX[o.card.n].counter); return Promise.resolve(c?c.v:null); }
    if(w==='steal'){ const c=opts.find(o=>o.isCounter&&o.card&&FX[o.card.n].steal); return Promise.resolve(c?c.v:null); }
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
function fresh(legendA){
  seedRng(6);
  newGame({seed:6,manual:false,bfs:[280,297],players:[{name:'A',legendN:legendA||253,champN:27,deck:Array(39).fill(210),runes:Array(12).fill(7)},{name:'B',legendN:265,champN:112,deck:Array(39).fill(210),runes:Array(12).fill(214)}]});
  G.turn=0;G.phase='action';G.state='neutral';G.turnCount=5;G.actingPlayer=0;
  G.players.forEach(P=>{P.hand=[];P.energy=20;Object.keys(P.power).forEach(k=>P.power[k]=9);});
  RQ.length=0; PICK=null; CONFIRM=()=>false; CONFIRMS.length=0;
}
function openSd(){ G.state='showdown'; G.actingPlayer=0; G.showdown={bfIdx:0,attacker:0,defender:1,hasCombat:true,passes:0,chain:[],chainStarter:null}; }
const onBoard=u=>everyUnit().includes(u);
(async()=>{
  // ── ④ 오라 수치 키워드 합산 ──
  fresh();
  const taric=makeUnit(74,0,{loc:0,ready:true}); placeUnit(taric,0);
  const poro=makeUnit(52,0,{loc:0,ready:true}); placeUnit(poro,0);
  ok('④ 포로: 자체 [보호막 1]+타릭 오라 = 방어 시 4⚔', might(poro,'defender')===4, 'm='+might(poro,'defender'));
  ok('④ 타릭 자신은 오라 대상 아님 = 방어 시 5⚔', might(taric,'defender')===5, 'm='+might(taric,'defender'));
  fresh();
  placeUnit(makeUnit(15,0,{loc:0,ready:true}),0); placeUnit(makeUnit(15,0,{loc:0,ready:true}),0);
  const sgt=makeUnit(219,0,{loc:0,ready:true}); placeUnit(sgt,0);
  ok('④ 패론 대위 2기 = [맹공 2] (4⚔→공격 시 6⚔)', might(sgt,'attacker')===6, 'm='+might(sgt,'attacker'));
  ok('④ 효과 키워드값 assault=2', effKw(sgt).assault===2, 'assault='+effKw(sgt).assault);

  // ── ① 학생 격발은 주문 완전 해결 뒤 — 자기 학생에게 피해 2 → 죽는다 ──
  fresh();
  const st1=makeUnit(103,0,{loc:0,ready:true}); placeUnit(st1,0);
  G.players[0].hand=[303]; PICK=u=>u===st1;
  await playCardFromHand(0,0,{});
  ok('① 자기 학생에게 소각 → +1 전에 치명 판정으로 사망', !onBoard(st1), 'onBoard='+onBoard(st1)+' m='+might(st1));
  // 적에게 쓰면 해결 뒤 +1
  fresh();
  const st2=makeUnit(103,0,{loc:0,ready:true}); placeUnit(st2,0);
  const foe=makeUnit(219,1,{loc:0,ready:true}); placeUnit(foe,0);
  G.players[0].hand=[303];
  await playCardFromHand(0,0,{});
  ok('① 해결된 주문 → 학생 +1, 플레이 수 1', might(st2)===3 && G.players[0].playedCards===1, 'm='+might(st2)+' played='+G.players[0].playedCards);

  // ── ② 카운터된 주문은 플레이한 것이 아니다 ──
  fresh();
  const st3=makeUnit(103,0,{loc:0,ready:true}); placeUnit(st3,0);
  placeUnit(makeUnit(219,1,{loc:0,ready:true}),0);
  G.players[0].hand=[303]; G.players[1].hand=[45];
  RQ.push('counter'); RQ.push(null);
  await playCardFromHand(0,0,{});
  ok('② 카운터된 주문: 학생 +0, A 플레이 수 0', might(st3)===2 && G.players[0].playedCards===0, 'm='+might(st3)+' played='+G.players[0].playedCards);
  ok('② 카운터(저항)는 B가 플레이한 주문으로 셈', G.players[1].playedCards===1, 'B played='+G.players[1].playedCards);

  // ── ① 탈취(신비한 반전): 해결 시 통제자가 '플레이한' 사람 ──
  fresh();
  const stA=makeUnit(103,0,{loc:0,ready:true}); placeUnit(stA,0);
  const stB=makeUnit(103,1,{loc:'base',ready:true}); placeUnit(stB,'base');
  placeUnit(makeUnit(219,1,{loc:0,ready:true}),0);
  G.players[0].hand=[303]; G.players[1].hand=[80];
  RQ.push('steal'); RQ.push(null); RQ.push(null);
  await playCardFromHand(0,0,{});
  // B의 학생은 반전(+1)과 탈취한 소각(+1)을 모두 본다
  ok('① 탈취된 주문: B의 학생 +2(반전+소각), A의 학생 +0', might(stB)===4 && might(stA)===2, 'B='+might(stB)+' A='+might(stA));
  ok('① 탈취된 주문의 플레이 수는 B 몫 (반전+소각=2), A는 0', G.players[1].playedCards===2 && G.players[0].playedCards===0,
     'B='+G.players[1].playedCards+' A='+G.players[0].playedCards);

  // ── ② 숨김 주문 카운터 → 잉걸불 수도승 +2 없음 / 해결되면 +2 ──
  fresh();
  const monk=makeUnit(167,0,{loc:0,ready:true}); placeUnit(monk,0);
  placeUnit(makeUnit(219,1,{loc:0,ready:true}),0);
  G.players[1].hand=[45]; RQ.push('counter'); RQ.push(null);
  await playCardFromHand(0,-1,{fromHidden:true,bfIdx:0,directN:303});
  ok('② 숨김 주문이 카운터되면 수도승 +0', might(monk)===4, 'm='+might(monk));
  fresh();
  const monk2=makeUnit(167,0,{loc:0,ready:true}); placeUnit(monk2,0);
  const foe2=makeUnit(219,1,{loc:0,ready:true}); placeUnit(foe2,0);
  await playCardFromHand(0,-1,{fromHidden:true,bfIdx:0,directN:303});
  ok('② 숨김 주문 해결 → 수도승 +2 (효과 뒤)', might(monk2)===6 && foe2.dmg===2, 'm='+might(monk2)+' dmg='+foe2.dmg);
  // 결전 중 체인 적재 시점에는 아직 격발 없음, 해결 때 격발
  fresh(); openSd();
  const monk3=makeUnit(167,0,{loc:0,ready:true}); placeUnit(monk3,0);
  placeUnit(makeUnit(219,1,{loc:0,ready:true}),0);
  await playCardFromHand(0,-1,{fromHidden:true,bfIdx:0,directN:303});
  ok('② 결전: 적재 시점엔 수도승 +0', might(monk3)===4 && G.showdown.chain.length===1, 'm='+might(monk3));
  await showdownPass(); await showdownPass();
  ok('② 결전: 해결 시점에 수도승 +2', might(monk3)===6, 'm='+might(monk3));

  // ── ③ 볼리베어: 등장 격발 전 판정 ──
  fresh(249); CONFIRM=()=>true;
  G.players[0].playedCards=1;                       // [군단] 충족
  const duo=makeUnit(16,0); G.players[0].hand=[16]; PICK=u=>u.n===16;
  await playCardFromHand(0,0,{playLoc:'base'});
  const duoU=G.players[0].base.find(u=>u.n===16);
  ok('③ 위험한 2인조(3⚔, 자기 +2) → 5⚔지만 볼리베어 격발 없음', duoU && might(duoU)===5 && !G.players[0].legendEx,
     'm='+(duoU&&might(duoU))+' legendEx='+G.players[0].legendEx);
  fresh(249); CONFIRM=()=>true;
  G.players[0].hand=[1];                            // 작열하는 화염룡 5⚔
  await playCardFromHand(0,0,{playLoc:'base'});
  ok('③ 인쇄 5⚔ 유닛은 볼리베어 격발', G.players[0].legendEx===true, 'legendEx='+G.players[0].legendEx);

  // ── ⑤ 바람 장막: 대상 주문 없이는 플레이 불가 ──
  fresh();
  G.players[0].hand=[64];
  const rW=await playCardFromHand(0,0,{});
  ok('⑤ 중립: 대상 없는 카운터 주문 거부 (손패·에너지 유지)', rW===false && G.players[0].hand.includes(64) && G.players[0].energy===20,
     'r='+rW+' hand='+G.players[0].hand+' e='+G.players[0].energy);
  fresh(); openSd();
  G.players[0].hand=[64];
  const rW2=await playCardFromHand(0,0,{});
  ok('⑤ 결전: 체인에 상대 주문 없으면 거부', rW2===false && G.players[0].hand.includes(64), 'r='+rW2);

  // ── ① 빙의를 두 번째 카드로: 뺏어온 다리우스가 '두 번째 카드'를 본다 ──
  fresh();
  G.players[0].playedCards=1;
  const dar=makeUnit(27,1,{loc:0,ready:false}); placeUnit(dar,0);
  G.players[0].hand=[203];
  await playCardFromHand(0,0,{});
  ok('① 빙의 뒤 다리우스: A 통제·준비·+2 (7⚔)', dar.ctrl===0 && dar.ex===false && might(dar)===7, 'ctrl='+dar.ctrl+' ex='+dar.ex+' m='+might(dar));

  // ── ⑥ 선봉대 소집 토큰: 오라 [통찰] 4회 + 시트리아 버프 ──
  fresh();
  placeUnit(makeUnit(100,0,{loc:'base',ready:true}),'base');
  const cith=makeUnit(139,0,{loc:'base',ready:true}); placeUnit(cith,'base');
  G.players[0].hand=[315];
  await playCardFromHand(0,0,{});
  const visions=CONFIRMS.filter(t=>t.includes('[통찰]')).length;
  ok('⑥ 신병 토큰 4개 → [통찰] 4회', visions===4, 'visions='+visions);
  ok('⑥ 시트리아 버프 1', cith.buff===1, 'buff='+cith.buff);
  ok('⑥ 토큰은 카드가 아니다 — 플레이 수는 주문 1장만', G.players[0].playedCards===1, 'played='+G.players[0].playedCards);

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack||e.message));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process }), { filename: 'test-batch1.js' });
