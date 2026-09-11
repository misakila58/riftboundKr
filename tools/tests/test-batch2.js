// RiftJudge 감사 2차 묶음(work-2.json) 검증:
//  ① 전용 op(돌풍·후퇴·질책·가르기·도전·앙 가르드·빙의·단두대·수렴 변이·신난다!·신사의 결투·안면 분쇄·용의 분노·쌍권총 난사)도
//     플레이 시점에 대상을 지정(룰 352.8.a)하고 해결 때 부적법하면 그 지시만 불발(356.3.e) — 재지정 없음
//  ② 적법 대상이 없으면 대상 주문을 낼 수 없다(352.8) · 굴절(735) 거부/불가면 그 유닛은 못 고른다(다른 대상 없으면 플레이 취소)
//  ③ 'Do this N번' 반사 격발 주문(떨어지는 별)은 플레이 시점 대상이 없다(352.8.b · 383)
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '../../client/web/js');
const r = f => fs.readFileSync(path.join(JS, f), 'utf8');
const BOOT = `
if(typeof globalThis.withBattlefieldSource==='undefined') globalThis.withBattlefieldSource=(s,fn)=>fn();
var PICK=null;        // pickUnitFrom 선택 함수 (null이면 적 전장 유닛 우선)
var OPT=null;         // pickOption 선택 함수 (title, options)→v (null이면 첫 항목)
var NUM=null;         // pickNumber 선택 함수 (null이면 최댓값)
var CONFIRM=()=>false; // confirmP 응답 함수(prompt)
var PICKS=[], OPTS=[], NUMS=[], CONFIRMS=[];   // 프롬프트 기록
var UI = { log(){}, render(){}, toast(){}, fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:(p,t)=>{ CONFIRMS.push(String(t||'')); return Promise.resolve(!!CONFIRM(String(t||''))); },
  pickUnitFrom:(p,c,t)=>{ PICKS.push(String(t||'')); return Promise.resolve(PICK ? (c.find(u=>PICK(u))||c[0]) : (c.find(u=>u.ctrl===1&&u.loc!=='base')||c[0])); },
  pickOption:(p,t,o)=>{ OPTS.push(String(t||'')); return Promise.resolve(OPT ? OPT(String(t||''),o) : o[0].v); },
  pickReaction:()=>Promise.resolve(null),
  pickNumber:(p,t,mn,mx)=>{ NUMS.push(String(t||'')); return Promise.resolve(NUM ? NUM(mn,mx) : mx); },
  pickHandCard:()=>Promise.resolve(0), pickMulligan:()=>Promise.resolve([]),
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
  PICK=null; OPT=null; NUM=null; CONFIRM=()=>false; PICKS.length=0; OPTS.length=0; NUMS.length=0; CONFIRMS.length=0;
}
function openSd(){ G.state='showdown'; G.actingPlayer=0; G.showdown={bfIdx:0,attacker:0,defender:1,hasCombat:true,passes:0,chain:[],chainStarter:null}; }
function toBase(u){ const bf=G.bfs[u.loc]; bf.units.splice(bf.units.indexOf(u),1); u.loc='base'; G.players[u.ctrl].base.push(u); }
function gone(u){ removeUnit(u); G.players[u.ctrl].hand.push(u.n); }   // 응수로 손패에 돌아간 상황
const onBoard=u=>everyUnit().includes(u);
const unit=(n,p,loc)=>{ const u=makeUnit(n,p,{loc,ready:true}); placeUnit(u,loc); return u; };
const play=async(n)=>{ G.players[0].hand=[n]; return await playCardFromHand(0,0,{}); };
const resolve=async()=>{ await showdownPass(); await showdownPass(); };
const power=p=>Object.values(G.players[p].power).reduce((a,b)=>a+b,0);
const optUnit=u=>(t,o)=>{ const m=o.find(x=>x.returnHand&&x.returnHand.uid===u.uid); return m?m.v:o[0].v; };
(async()=>{
  // ── 돌풍(169): 플레이 시점 대상 → 응수로 4위력이 되면 불발, 다른 3위력 이하 유닛으로 재지정 없음 ──
  fresh(); openSd();
  const g1=unit(210,1,0), g2=unit(210,1,0);
  OPT=optUnit(g1);
  ok('돌풍 플레이 가능', await play(169)===true);
  ok('돌풍: 적재 시점에 대상을 물었다', OPTS.length===1 && /되돌릴/.test(OPTS[0]), JSON.stringify(OPTS));
  g1.tempM.push({v:2,dur:'turn'});   // 응수: 위력 2→4
  await resolve();
  ok('돌풍: 대상이 4위력 → 불발(보드에 남음)', onBoard(g1), 'g1 gone');
  ok('돌풍: 다른 유닛으로 재지정 안 함', onBoard(g2) && OPTS.length===1, 'g2 gone or re-asked '+OPTS.length);
  ok('돌풍: 카드는 폐기장', G.players[0].trash.includes(169));

  // ── 후퇴(104): 대상이 먼저 사라지면 룬 전개 없음·재지정 불가 ──
  fresh(); openSd();
  const r1=unit(210,0,0), r2=unit(219,0,'base');
  OPT=optUnit(r1);
  ok('후퇴 플레이 가능', await play(104)===true);
  const runes0=G.players[0].runes.length;
  gone(r1); const hand0=G.players[0].hand.length;
  await resolve();
  ok('후퇴: 대상 소실 → 룬 전개 없음', G.players[0].runes.length===runes0, 'runes '+runes0+'→'+G.players[0].runes.length);
  ok('후퇴: 다른 아군으로 재지정 없음', onBoard(r2) && G.players[0].hand.length===hand0, 'r2 gone');

  // ── 질책(172): 대상 소실 → 재지정 없음 ──
  fresh(); openSd();
  const q1=unit(210,1,0), q2=unit(219,1,0);
  OPT=optUnit(q1);
  await play(172); gone(q1); await resolve();
  ok('질책: 대상 소실 → 다른 유닛 안 되돌림', onBoard(q2));

  // ── 가르기(4)·막기(57): grantKw 대상도 플레이 시점 지정 ──
  fresh(); openSd();
  const c1=unit(210,0,0), c2=unit(219,0,0);
  PICK=u=>u===c1;
  await play(4);
  ok('가르기: 적재 시점에 [맹공 3] 대상 선택', PICKS.length===1 && /맹공 3/.test(PICKS[0]), JSON.stringify(PICKS));
  gone(c1); await resolve();
  ok('가르기: 대상 소실 → 다른 유닛에 부여 안 함', !c2.grants.assault && PICKS.length===1, JSON.stringify(c2.grants));
  fresh(); openSd();
  ok('막기: 유닛이 없으면 플레이 불가', await play(57)===false && G.players[0].hand.length===1);

  // ── 도전(128): 두 대상 모두 플레이 시점, 한쪽이 죽으면 양쪽 피해 없음 ──
  fresh(); openSd();
  const d1=unit(219,0,0), d2=unit(210,1,0);
  await play(128);
  ok('도전: 적재 시점에 두 대상 선택', PICKS.length===2, JSON.stringify(PICKS));
  await killUnit(d1); await resolve();
  ok('도전: 아군 소실 → 적도 피해 없음', d2.dmg===0 && PICKS.length===2, 'dmg='+d2.dmg);

  // ── 앙 가르드(46) ──
  fresh(); openSd();
  const e1=unit(210,0,0), e2=unit(219,0,0);
  PICK=u=>u===e1;
  await play(46); gone(e1); await resolve();
  ok('앙 가르드: 대상 소실 → 다른 아군 위력 그대로', might(e2)===4 && PICKS.length===1, 'm='+might(e2));

  // ── 갈취(33): 적 유닛 없으면 플레이 불가 ──
  fresh(); openSd(); unit(210,0,0);
  ok('갈취: 적 유닛 없음 → 플레이 불가', await play(33)===false);

  // ── 수렴 변이(108): 아군 2기 미만이면 불가, 둘 다 플레이 시점 지정 ──
  fresh(); openSd(); const m1=unit(210,0,0);
  ok('수렴 변이: 아군 1기 → 플레이 불가', await play(108)===false);
  const m2=unit(219,0,'base'); PICK=u=>u===m1;
  ok('수렴 변이: 아군 2기 → 플레이 가능', await play(108)===true);
  ok('수렴 변이: 적재 시점에 두 유닛 선택', PICKS.length===2, JSON.stringify(PICKS));
  await resolve();
  ok('수렴 변이: 위력 복사(2→4)', might(m1)===4 && PICKS.length===2, 'm='+might(m1));

  // ── 빙의(203): 응수로 기지로 가면 불발 ──
  fresh(); openSd(); const p1=unit(210,1,0);
  await play(203); toBase(p1); await resolve();
  ok('빙의: 대상이 기지로 → 통제권 그대로', p1.ctrl===1);

  // ── 녹서스의 단두대(254) ──
  fresh(); openSd(); const n1=unit(210,1,0), n2=unit(219,1,0); PICK=u=>u===n1;
  await play(254); gone(n1); await resolve();
  ok('단두대: 대상 소실 → 다른 유닛에 표식 없음', !n2._guillotine && PICKS.length===1);

  // ── 안면 분쇄(220): 같은 전장의 아군+적 쌍이 있어야 플레이 ──
  fresh(); openSd(); const f1=unit(210,0,0), f2=unit(210,1,1);
  ok('안면 분쇄: 같은 전장 쌍 없음 → 플레이 불가', await play(220)===false);
  toBase(f2); const B=G.players[1].base; B.splice(B.indexOf(f2),1); f2.loc=0; G.bfs[0].units.push(f2);
  ok('안면 분쇄: 쌍 있음 → 플레이 가능', await play(220)===true && PICKS.length===2, JSON.stringify(PICKS));
  await resolve();
  ok('안면 분쇄: 둘 다 기절', f1.stunned && f2.stunned);

  // ── 용의 분노(258): 이동 유닛은 플레이 시점, 소실이면 이동·피해 없음 ──
  fresh(); const v1=unit(210,1,0), v2=unit(219,1,1);
  ok('용의 분노: 플레이 시점에 이동 유닛 선택', await play(258)===true && /이동시킬 적 유닛/.test(PICKS[0]||''), JSON.stringify(PICKS));
  fresh(); const w1=unit(210,1,0), w2=unit(219,1,1);
  const dop=FX[258].playOps[0].ops[0]; gone(w1);
  await resolveSpellEffects(0,258,FX[258],{pre:new Map([[dop,w1.uid]]),execAs:0});
  ok('용의 분노: 대상 소실 → 다른 적 이동·피해 없음', w2.loc===1 && w2.dmg===0 && OPTS.length===0, 'loc='+w2.loc);

  // ── 쌍권총 난사(268): 전장은 적재 시점, 힘 액수는 해결 시점 ──
  fresh(); openSd(); const b1=unit(219,1,0); NUM=()=>2;
  await play(268);
  ok('난사: 적재 시점에 전장 선택, 힘 액수는 아직', OPTS.some(t=>/피해를 줄 전장/.test(t)) && NUMS.length===0, JSON.stringify([OPTS,NUMS]));
  await resolve();
  ok('난사: 해결 때 힘 지불·피해', NUMS.length===1 && b1.dmg===2, 'dmg='+b1.dmg);

  // ── 신난다!(8): 대상은 플레이 시점, 버림은 해결 시점, 대상 소실이어도 버림 ──
  fresh(); openSd(); const x1=unit(219,1,0);
  G.players[0].hand=[8,210]; await playCardFromHand(0,0,{});
  ok('신난다!: 적재 시점에 대상 선택, 아직 안 버림', PICKS.length===1 && G.players[0].hand.length===1, JSON.stringify(PICKS));
  await resolve();
  ok('신난다!: 버린 카드 비용(2)만큼 피해', x1.dmg===2 && G.players[0].hand.length===0, 'dmg='+x1.dmg);
  fresh(); openSd(); const x2=unit(219,1,0);
  G.players[0].hand=[8,210]; await playCardFromHand(0,0,{}); gone(x2); await resolve();
  ok('신난다!: 대상 소실 → 버리기는 하고 피해 없음', x2.dmg===0 && G.players[0].hand.length===0 && G.players[0].trash.includes(210), 'hand='+G.players[0].hand.length);

  // ── 신사의 결투(308) ──
  fresh(); openSd(); const s1=unit(219,0,0), s2=unit(210,1,0);
  await play(308);
  ok('결투: 적재 시점에 두 대상 선택', PICKS.length===2, JSON.stringify(PICKS));
  gone(s1); await resolve();
  ok('결투: 아군 소실 → 적 피해 없음', s2.dmg===0);

  // ── 공허의 추적자(24)·혼미(95)·단결된 의지(53): 대상 없으면 플레이 불가 ──
  fresh(); openSd();
  ok('공허의 추적자: 전장 유닛 없음 → 플레이 불가', await play(24)===false && G.players[0].hand.length===1 && G.players[0].energy===20);
  ok('봇 polCanPlay도 같은 판정', polCanPlay(0,card(24))===false);
  const vs=unit(210,1,0);
  ok('공허의 추적자: 대상 있으면 가능', polCanPlay(0,card(24))===true && await play(24)===true);
  fresh(); ok('혼미: 유닛 없음 → 플레이 불가', await play(95)===false);
  fresh(); ok('단결된 의지: 아군 없음 → 플레이 불가', await play(53)===false);
  unit(210,0,'base'); ok('단결된 의지: 아군 있으면 가능', await play(53)===true);

  // ── 굴절(735): 거부하면 그 대상을 고를 수 없다 — 다른 대상이 없으면 플레이 취소 ──
  fresh(); openSd(); const poro=unit(13,1,0);
  ok('굴절 거부(유일한 대상) → 플레이 취소', await play(303)===false && G.players[0].hand.length===1 && G.players[0].energy===20 && power(0)===power(0), 'hand='+G.players[0].hand.length);
  ok('굴절 거부: 체인에 안 올라감', G.showdown.chain.length===0);
  CONFIRM=()=>true; const pw=power(0);
  ok('굴절 지불 → 플레이', await play(303)===true && power(0)===pw-1 && CONFIRMS.some(t=>/굴절/.test(t)));
  await resolve(); ok('굴절 지불 후 피해', poro.dmg===2, 'dmg='+poro.dmg);
  // 거부하면 다른 대상을 다시 고른다 (RiftJudge #6944)
  fresh(); openSd(); const poro2=unit(13,1,0), other=unit(219,1,0); PICK=u=>u.n===13;
  ok('굴절 거부 → 다른 대상 재선택', await play(303)===true && PICKS.length===2, JSON.stringify(PICKS));
  await resolve();
  ok('굴절 거부: 포로는 무사, 다른 유닛 피해', poro2.dmg===0 && other.dmg===2, 'poro='+poro2.dmg+' other='+other.dmg);
  // 힘이 모자라 굴절을 못 내는 유닛은 후보가 아니다 → 유일한 대상이면 플레이 불가
  fresh(); openSd(); unit(13,1,0); Object.keys(G.players[0].power).forEach(k=>G.players[0].power[k]=0); G.players[0].runes=[];
  ok('굴절 지불 불가(유일한 대상) → 플레이 불가', await play(303)===false);

  // ── 떨어지는 별(29): 반사 격발 — 플레이 시점 대상 없음, 유닛 없어도 플레이 가능 ──
  fresh();
  // 에라타(Spiritforged FAQ 2026-01-14): 반사 격발이 아니라 보통 주문 — 낼 때 대상 2개를 고르고(같은 유닛 가능), 유닛이 없으면 낼 수 없다
  ok('떨어지는 별: 에라타 뒤 보통 주문 — 반사 격발 아님', !FX[29].reflexive && FX[29].playOps.length===2);
  ok('떨어지는 별: 유닛이 없으면 플레이 불가(대상 필요)', await play(29)===false && !G.players[0].trash.includes(29));

  // ── 숨김(737): 그 전장에 대상 없는 주문은 공개 불가 — playRestriction이 bfIdx로 본다 ──
  fresh(); unit(210,1,0);
  ok('막기 숨김: 전장 1에 유닛 없음 → 공개 불가', !!playRestriction(card(57),0,true,1));
  ok('막기 숨김: 전장 0에 유닛 있음 → 공개 가능', playRestriction(card(57),0,true,0)===null);

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack||e.message));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-batch2.js' });
