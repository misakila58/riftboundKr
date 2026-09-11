// 2026-07-16판 종합 규칙 대조(rules-audit-2026 work-A/work-C) 검증 — 헤드리스(vm) 엔진 테스트
//  ① 무혈 결전 → 전투 결전 승격(316.9.b.1 · 318 10a · 460.1 · 464): 상대 유닛이 들어온 뒤의 열린 클린업에서 진행 중인 결전이
//     그대로 전투 결전이 된다 — 새 결전 없음, 지정·전장 [방어 시]·[공격 시] 즉시, 포커스·체인 이어짐. 폴백(클린업 없이 진입)도 결전 유지
//  ② 빈 전장 통제 상실 시점(190.6 · 318 4단계 · 323.11): 체인에 항목이 남은 닫힌 상태(결전 체인·중립 응수 창)에선 유지,
//     열린 상태의 클린업에서 해제(숨김 카드 폐기 포함)
//  ③ 전투 해결 순서(466.3 · 466.7 · 467): 전투 정리(치유·귀환) → 종소리 해결·치명 판정 → 승패 → 정복(지정·'이번 전투' 효과 유지) → 전투 종료
//  ④ 중립 닫힌 상태(응수 창 안)에서는 결전이 열리지 않는다(341)
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
  pickUnitFrom:(p,c,t)=>{ PICKS.push(String(t||'')); return Promise.resolve(PICK ? (c.find(u=>PICK(u,p))||c[0]) : (c.find(u=>u.ctrl===1&&u.loc!=='base')||c[0])); },
  pickOption:(p,t,o)=>{ OPTS.push(String(t||'')); OPTLIST.push({t:String(t||''),o,p,state:G.state}); return Promise.resolve(OPT ? OPT(String(t||''),o,p) : o[0].v); },
  pickReaction:(p,t,o)=>{ REACTS.push(String(t||'')); return Promise.resolve(REACT ? REACT(p,String(t||''),o) : null); },
  pickNumber:(p,t,mn,mx)=>{ NUMS.push(String(t||'')); return Promise.resolve(NUM ? NUM(mn,mx) : mx); },
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
  PICKS.length=0; OPTS.length=0; NUMS.length=0; CONFIRMS.length=0; OPTLIST.length=0; REACTS.length=0; REL.length=0;
}
function openSd(attacker, hasCombat){ attacker=attacker||0; G.state='showdown'; G.actingPlayer=attacker;
  G.showdown={bfIdx:0,attacker,defender:opp(attacker),hasCombat:hasCombat!==false,passes:0,chain:[],chainStarter:null}; }
const onBoard=u=>everyUnit().includes(u);
const unit=(n,p,loc,o)=>{ const u=makeUnit(n,p,{loc,ready:true}); placeUnit(u,loc); Object.assign(u,o||{}); return u; };
const play=async(n,p)=>{ p=p||0; G.players[p].hand=[n]; return await playCardFromHand(p,0,{}); };
const resolve=async()=>{ await showdownPass(); await showdownPass(); };
// releaseEmptyBattlefields 호출 시점의 상태 기록 (닫힌 상태 표시와 1번 전장 통제자)
var REL=[]; const _rel=releaseEmptyBattlefields;
releaseEmptyBattlefields=function(){ const e={rw:G._rwFor??null, chain:G.showdown?G.showdown.chain.length:-1, ctrl:G.bfs[1].controller}; REL.push(e); const ret=_rel(); e.after=G.bfs[1].controller; return ret; };
(async()=>{
  // ══ ① 무혈 결전 → 전투 결전 승격 ══
  // ── A의 야스오(76)가 빈 전장에 들어가 무혈 결전. B가 「바람 타기」(173)로 선봉대 하사(219)를 들여보내면
  //    그 해결 뒤의 클린업에서 같은 결전이 전투 결전이 되고 야스오 [공격 시] 6피해로 하사(4)가 죽는다 ──
  fresh([279,297]);
  const ya=unit(76,0,'base'); await moveUnits(0,[ya],0);
  ok('승격: 빈 전장 진입은 무혈 결전(hasCombat=false)', G.state==='showdown' && G.showdown.hasCombat===false && G.showdown.attacker===0, JSON.stringify(G.showdown&&[G.showdown.attacker,G.showdown.hasCombat]));
  const sd0=G.showdown;
  const b1=unit(219,1,'base');
  PICK=u=>u===b1; OPT=(t,o)=>{ const s=o.find(x=>x.movement&&x.movement.dest===0); return s?s.v:o[0].v; };
  G.actingPlayer=1; ok('승격: B가 결전 중 「바람 타기」 적재', await play(173,1)===true && sd0.chain.length===1, 'chain='+sd0.chain.length);
  await resolve();
  ok('승격: 해결 뒤 클린업에서 같은 결전이 전투 결전이 된다 (새 결전 없음)', G.showdown===sd0 && sd0.hasCombat===true && sd0.attacker===0 && sd0.defender===1, JSON.stringify(G.showdown&&[G.showdown===sd0,G.showdown.hasCombat,G.showdown.attacker]));
  ok('승격: 공격자 야스오 [공격 시] 즉시 격발 → 하사 6피해 사망 (같은 클린업의 치명 판정)', !onBoard(b1) && b1.loc===0, 'onBoard='+onBoard(b1)+' dmg='+b1.dmg);
  ok('승격: 전장 「요새화된 진지」 [방어 시] 격발 — 방어자 B가 유닛을 골라 이번 전투 [보호막 2]', (G._combatGrants||[]).length===1 && PICKS.some(t=>/보호막|유닛/.test(t)), 'grants='+JSON.stringify(G._combatGrants&&G._combatGrants.map(g=>g.key)));
  ok('승격: 체인이 닫히며 포커스는 체인 시작자(B)의 상대(A) — 추가 패스 라운드 없이 결전 계속', G.state==='showdown' && G.actingPlayer===0 && sd0.passes===0, 'acting='+G.actingPlayer+' passes='+sd0.passes);
  await resolve();
  ok('승격: 이어지는 전투 — 방어자 없음 → A 정복 득점', G.state==='neutral' && G.bfs[0].controller===0 && G.players[0].points===1, 'ctrl='+G.bfs[0].controller+' pts='+G.players[0].points);
  // ── 폴백: 클린업 없이 들어온 유닛(effectMove 직접) → 빈 체인 양측 패스 시 결전을 닫지 않고 승격 ──
  fresh();
  const a1=unit(219,0,'base'); await moveUnits(0,[a1],0);
  const sd1=G.showdown; const ys=unit(76,1,'base'); await effectMove(1, ys, 0);
  ok('폴백: 클린업 전엔 아직 무혈', sd1.hasCombat===false && a1.dmg===0);
  await resolve();
  ok('폴백: 같은 결전이 전투 결전으로 (공격자는 경합 적용자 A, 방어자 야스오 [공격 시] 없음)', G.showdown===sd1 && sd1.hasCombat && sd1.attacker===0 && a1.dmg===0, JSON.stringify([G.showdown===sd1, sd1.hasCombat, sd1.attacker, a1.dmg]));
  // ── 승격은 열린 상태(빈 체인)에서만 — 체인 아래 항목이 남아 있으면 그 항목까지 해결된 뒤 ──
  fresh();
  const a2=unit(219,0,'base'); await moveUnits(0,[a2],0); const sd2=G.showdown;
  G.actingPlayer=0; PICK=u=>u===a2; await play(207,0);                 // A: 영광의 부름(체인 #1, 시작자 A)
  const b2=unit(219,1,0);                                               // 클린업 없이 진입(체인 위 항목 해결 상황 모사)
  G.actingPlayer=1; G.players[1].hand=[133]; PICK=null; await playCardFromHand(1,0,{});   // B: 칼날 세례(체인 #2)
  ok('열린 상태 조건: 체인 2개 적재', sd2.chain.length===2, 'chain='+sd2.chain.length);
  await resolve();                                                       // #2 해결 → 체인에 #1 남음(닫힌 상태)
  ok('열린 상태 조건: 체인이 남아 있으면 아직 무혈 결전', G.showdown===sd2 && sd2.hasCombat===false, JSON.stringify([sd2.hasCombat, sd2.chain.length]));
  await resolve();                                                       // #1 해결 → 빈 체인 클린업 → 승격
  ok('열린 상태 조건: 체인이 비는 클린업에서 승격', G.showdown===sd2 && sd2.hasCombat===true && sd2.attacker===0, JSON.stringify([sd2.hasCombat, sd2.chain.length]));

  // ══ ② 빈 전장 통제 상실 시점 ══
  // ── 결전 체인: A의 1번 전장(통제, 보초 96 하나·숨김 카드)이 B의 「칼날 세례」(체인 위)로 비어도 아래 항목(A의 207)이 남은 동안 유지 ──
  fresh(); openSd(0); unit(219,0,0); unit(219,1,0);
  G.bfs[1].controller=0; const sentry=unit(96,0,1); G.bfs[1].hiddenCards.push({n:311,by:0,turn:1});
  G.actingPlayer=0; PICK=u=>u.loc===0&&u.ctrl===0; await play(207,0);
  G.actingPlayer=1; await play(133,1);
  ok('통제 유지: 체인 [207, 133]', G.showdown.chain.length===2);
  await resolve();
  ok('통제 유지: 칼날 세례로 보초 사망 — 체인에 항목이 남아 통제·숨김 카드 유지', !onBoard(sentry) && G.bfs[1].units.length===0 && G.bfs[1].controller===0 && G.bfs[1].hiddenCards.length===1, 'ctrl='+G.bfs[1].controller+' hidden='+G.bfs[1].hiddenCards.length+' chain='+G.showdown.chain.length);
  ok('통제 유지: 닫힌 상태 클린업(chain=1)이 실제로 돌았고 통제를 풀지 않았다', REL.some(x=>x.chain===1 && x.ctrl===0 && x.after===0), JSON.stringify(REL));
  await resolve();
  ok('통제 상실: 체인이 빈 열린 클린업에서 무주공산 + 숨김 카드 폐기', G.bfs[1].controller===null && G.bfs[1].hiddenCards.length===0 && G.players[0].trash.includes(311), 'ctrl='+G.bfs[1].controller);
  // ── 중립 응수 창: A의 주문에 B가 「칼날 세례」로 응수해 A의 1번 전장이 비어도 원 주문이 해결될 때까지 유지 ──
  fresh(); G.bfs[1].controller=0; const s2=unit(96,0,1); const tgt=unit(219,0,0); G.bfs[0].controller=0;
  G.players[1].hand=[133]; REACT=(p,t,o)=>o[0].v; PICK=u=>u===tgt;
  await play(207,0);
  ok('중립 응수: 보초 사망·응수 뒤 원 주문 해결 → 지금은 무주공산', !onBoard(s2) && G.bfs[1].controller===null && might(tgt)===7, 'ctrl='+G.bfs[1].controller+' m='+might(tgt));
  ok('중립 응수: 응수 카드 해결 직후의 클린업(닫힌 상태)에서는 통제 유지, 원 주문 해결 뒤 열린 클린업에서 해제', REL.some(x=>x.rw===1 && x.ctrl===0 && x.after===0) && REL.some(x=>x.rw===null && x.ctrl===0 && x.after===null), JSON.stringify(REL));

  // ══ ③ 전투 해결 순서 ══
  // ── 공격자 코그모(190, 1위력)가 죽고 방어자 포로(210)만 남지만, 종소리 4피해가 승패 판정 전에 포로를 죽인다 → 유닛 없음: 통제 없음·정복 없음 ──
  fresh(); openSd(0); G.bfs[0].controller=null; G.bfs[0].contestedBy=0;
  const kog=unit(190,0,0), poro=unit(210,1,0);
  await resolve();
  ok('순서: 코그모·포로 모두 사망', !onBoard(kog) && !onBoard(poro));
  ok('순서: 종소리가 승패 판정 전 → 방어자 잔존 없음 — B 통제 확립·정복 없음(예전엔 B 득점 뒤 사망)', G.bfs[0].controller===null && G.players[1].points===0 && !G.bfs[0].scored[1], 'ctrl='+G.bfs[0].controller+' pts='+G.players[1].points);
  ok('순서: 전투 종료 후 중립', G.state==='neutral' && !G.showdown);
  // ── 정복 격발 중에도 지정이 살아 있다(467 전투 종료가 마지막): 정복 유닛의 임시 [정복 시] 격발에서 '전투 중' 아군 1·G.showdown 존재 ──
  fresh(); openSd(0); G.bfs[0].controller=null; G.bfs[0].contestedBy=0;
  const SPY=[]; EXTRA_OPS.__spy=async(op,ctx)=>{ SPY.push({state:G.state, sd:!!G.showdown, combat:unitsBySpec({side:'friendly',where:'combat'},0).length, m:might(ctx.unit,'attacker')}); };
  const savedFx=FX[210].triggers.onConquer; FX[210].triggers.onConquer=[{ops:[{op:'__spy'}]}];
  const ap=unit(210,0,0); G._combatGrants=[{u:ap,key:'shield',v:2,numeric:true}]; ap.grants.shield=2;
  try{ await resolve(); } finally{ if(savedFx) FX[210].triggers.onConquer=savedFx; else delete FX[210].triggers.onConquer; delete EXTRA_OPS.__spy; }
  ok('지정 유지: 정복 격발 시점에 결전·지정이 남아 있어 where:combat 대상 1, [맹공] 반영 위력 3', SPY.length===1 && SPY[0].sd && SPY[0].state==='showdown' && SPY[0].combat===1 && SPY[0].m===3, JSON.stringify(SPY));
  ok('지정 유지: 정복 격발 뒤 전투 종료 — 이번 전투 [보호막] 만료·결전 해제', G.state==='neutral' && !G.showdown && ap.grants.shield===undefined && G._combatGrants.length===0 && G.players[0].points===1, 'shield='+ap.grants.shield+' pts='+G.players[0].points);

  // ══ ④ 중립 닫힌 상태(응수 창 안)에서는 결전이 열리지 않는다(341) ══
  fresh(); unit(219,0,0);   // 무주공산 전장에 A 유닛 → 경합
  G._rwFor=1; await cleanup(0);
  ok('341: 응수 창 안(닫힌 상태) 클린업은 결전을 열지 않는다', G.state==='neutral' && !G.showdown, 'state='+G.state);
  G._rwFor=null; await cleanup(0);
  ok('341: 열린 상태 클린업에서 결전 개시', G.state==='showdown' && G.showdown && G.showdown.bfIdx===0, 'state='+G.state);

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack||e.message));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-rules2026-a.js' });
