// 2026-09-22 카드 효과·RiftJudge 판정 감사 수정 회귀 테스트 — 헤드리스(vm) 엔진 테스트
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
  // ══ ① 화염 폭풍(302) — 전장은 플레이 시점 대상(355.10.d · #12460) ══
  fresh(); G.bfs[0].controller=1; G.bfs[1].controller=1; const e1=unit(219,1,0), e2=unit(219,1,1); OPT=(t,o)=>{ if(/전장/.test(t)) return 0; return o[0].v; };
  await play(302);
  ok('① 화염 폭풍: 사전 지정 전장0의 적만 피해 3', e1.dmg===3 && e2.dmg===0, 'e1='+e1.dmg+' e2='+e2.dmg);

  // ══ ② 신난다!(8) — '그 카드'는 이 해결에서 버린 카드뿐 ══
  fresh(); G.bfs[0].controller=1; const t2=unit(219,1,0); G._lastDiscard={p:0,n:92}; G.players[0].hand=[8];
  await playCardFromHand(0,0,{});
  ok('② 신난다: 손패 0장이면 피해 없음(이전 버림 기록 무관)', t2.dmg===0, 'dmg='+t2.dmg);
  fresh(); G.bfs[0].controller=1; const t2b=unit(219,1,0); G.players[0].hand=[8,92];
  await playCardFromHand(0,0,{});
  ok('② 신난다: 버린 렉스(6) 비용만큼 피해', t2b.dmg===6 || !onBoard(t2b), 'dmg='+t2b.dmg);

  // ══ ③ 태양 원반(21) — [군단]은 '다른 카드'(812.1.c · 813.1) ══
  fresh(); await play(21); const g21=G.players[0].gear.find(g=>g.n===21); const ab21=FX[21].activated[0];
  await activateAbility(0,{kind:'gear',g:g21},ab21);
  ok('③ 태양 원반: 첫 카드로 내고 발동 → 군단 불성립', !TF().nextUnitReady[0] && !g21.ex, 'ready='+TF().nextUnitReady[0]+' ex='+g21.ex);
  await play(210); await activateAbility(0,{kind:'gear',g:g21},ab21);
  ok('③ 태양 원반: 다른 카드를 낸 뒤엔 발동', TF().nextUnitReady[0]===true && g21.ex===true, 'ready='+TF().nextUnitReady[0]+' ex='+g21.ex);

  // ══ ④ 코그모 - 부식(190) — 기지 사망 종소리는 '내 전장'이 없어 무효(#7905) ══
  fresh(); const kog=unit(190,0,'base'); const a4=unit(219,0,0), b4=unit(219,1,1);
  await killUnit(kog);
  ok('④ 코그모: 기지 사망 → 아무도 피해 없음', a4.dmg===0 && b4.dmg===0, 'a='+a4.dmg+' b='+b4.dmg);
  fresh(); const kog2=unit(190,0,0); const a5=unit(219,0,0), b5=unit(219,1,0), c5=unit(219,1,1);
  await killUnit(kog2);
  ok('④ 코그모: 전장 사망 → 그 전장 전원 4', a5.dmg===4 && b5.dmg===4 && c5.dmg===0, [a5.dmg,b5.dmg,c5.dmg].join(','));

  // ══ ⑤ 산봉우리 수호자(223) — 등장 격발 응수로 죽으면 '내가 전장에 있다면' 거짓(359.3.f) ══
  fresh(); G.bfs[0].controller=0; const ally=unit(219,0,0); G.bfs[0].hiddenCards.push({n:213,by:1,turn:0});   // 숨김 카드의 대상은 그 전장 안(737)
  OPT=(t,o)=>{ if(/배치|위치/.test(t)){ const x=o.find(x=>x.v===0); return x?x.v:o[0].v; } return o[0].v; };
  REACT=(p,t,o)=>{ const h=o.find(x=>x.v&&x.v.hidden); return h?h.v:null; };
  PICK=(u,p)=>p===1 ? u.n===223 : true;
  await play(223);
  ok('⑤ 수호자: 숨겨진 칼날 응수로 처치됨', !find(0,223), 'units='+allUnits(0).map(u=>u.n).join(','));
  ok('⑤ 수호자: 다른 아군 버프 없음', ally.buff===0, 'buff='+ally.buff);

  // ══ ⑥ 시간선 역전(201) — 손패의 고철 더미(182)는 '버려질 때' 드로우(#11607) ══
  fresh(); G.players[1].hand=[182,210]; G.players[0].hand=[201];
  await playCardFromHand(0,0,{});
  ok('⑥ 시간선 역전: 고철 더미 버림 격발 → B 5장, A 4장', G.players[1].hand.length===5 && G.players[0].hand.length===4, 'B='+G.players[1].hand.length+' A='+G.players[0].hand.length);

  // ══ ⑦ 카이사 - 진화자(112) — 폐기장 주문의 힘 비용은 지불(#11602) ══
  fresh(); openSd(0,false); unit(112,0,0); G.bfs[0].contestedBy=0; G.players[0].points=5; G.players[0].trash=[9]; unit(219,1,'base');
  Object.keys(G.players[0].power).forEach(k=>G.players[0].power[k]=0); G.players[0].runes=[];
  await resolve();
  ok('⑦ 카이사: 힘을 못 내면 폐기장 주문(마법공학 광선 힘1) 플레이 안 됨', G.players[0].trash.includes(9) && !G.players[0].deck.includes(9), 'trash='+G.players[0].trash.join(',')+' state='+G.state);

  // ══ ⑧ 게릴라전(264) — 같은 이름 [숨겨짐] 2장 모두 회수 ══
  fresh(); G.players[0].trash=[57,57]; await play(264);
  ok('⑧ 게릴라전: 막기 2장 회수', G.players[0].hand.filter(n=>n===57).length===2 && !G.players[0].trash.includes(57), 'hand='+G.players[0].hand.join(',')+' trash='+G.players[0].trash.join(','));

  // ══ ⑨ 갈까마귀 마도서(32) — 카운터당한 주문도 '다음 주문'(420.3.b) ══
  fresh(); const g32=gear(32,0); await activateAbility(0,{kind:'gear',g:g32},FX[32].activated[0]);
  ok('⑨ 마도서: 보너스 대기', TF().nextSpellBonus[0]===1, 'b='+TF().nextSpellBonus[0]);
  G.bfs[0].controller=1; const v9=unit(219,1,0); G.players[1].hand=[45];   // B가 통제하는 전장(클린업 결전 방지)
  REACT=(p,t,o)=>{ const c=o.find(x=>x.isCounter); return c?c.v:null; };
  await play(303);
  ok('⑨ 마도서: 카운터당해도 보너스 소모', TF().nextSpellBonus[0]===0 && v9.dmg===0, 'b='+TF().nextSpellBonus[0]+' dmg='+v9.dmg);
  REACT=null; await play(303);
  ok('⑨ 마도서: 그다음 주문엔 보너스 없음(피해 2)', v9.dmg===2, 'dmg='+v9.dmg);

  // ══ ⑩ 유망한 미래(115) — 주문은 LIFO, 유닛·도구는 즉시(#11941 · #11793) ══
  fresh(); G.players[0].deck.unshift(160,303,303,303,303); G.players[1].deck.unshift(22,303,303,303,303);
  await play(115);
  ok('⑩ 유망한 미래: B의 열 광선이 A의 오로라 등장 뒤 해결 → 오로라 처치', !G.players[0].gear.some(g=>g.n===160) && G.players[0].trash.includes(160), 'gear='+G.players[0].gear.map(g=>g.n).join(',')+' trash='+G.players[0].trash.join(','));

  // ══ ⑪ 바람 타기(173) + 바일마우의 둥지(295) — 기지 지정은 적법, 이동만 생략·준비(#11771) ══
  fresh([295,297]); const w=unit(210,0,0,{ex:true}); PICK=u=>u===w; OPT=(t,o)=>{ if(/효과 이동/.test(t)){ const x=o.find(x=>/기지/.test(x.label)); return x?x.v:o[0].v; } return o[0].v; };
  await play(173);
  ok('⑪ 둥지: 이동 없이 제자리에서 준비', w.loc===0 && w.ex===false, 'loc='+w.loc+' ex='+w.ex);

  // ══ ⑫ 블리츠크랭크(67) — "When you play me to a battlefield": 기지 플레이엔 격발 없음 ══
  fresh(); OPT=(t,o)=>{ if(/배치|위치/.test(t)) return 'base'; return o[0].v; }; const rw0=REACTS.length;
  await play(67);
  ok('⑫ 블리츠: 기지 플레이 → 등장 격발·응수 창 없음', REACTS.length===rw0 && !!find(0,67), 'reacts='+(REACTS.length-rw0));

  // ══ ⑬ 차원문 구출(102) — 효과로 플레이된 렉스의 등장 격발은 효과가 끝난 뒤 체인·응수 창(#3110 · #383) ══
  fresh(); G.bfs[0].controller=1; const rex=unit(92,0,'base'); const tgt=unit(219,1,0); PICK=(u,p)=>p===0?(u===rex||u===tgt):true;
  await play(102);
  ok('⑬ 차원문 구출: 렉스 등장 격발에 응수 창 열림', REACTS.some(t=>/격랑의 렉스 격발/.test(t)), REACTS.join('|'));
  ok('⑬ 차원문 구출: 격발 해결(피해 6)', tgt.dmg===6 || !onBoard(tgt), 'dmg='+tgt.dmg);

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-audit-0922.js' });
