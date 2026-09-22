// 2026-09-22 보류 항목 반영 회귀 테스트 — ① 다리우스 기지 오라 ② 우디르 발동 시점 모드/대상 ③ [일시적] 격발+존야 공개
//  ④ 신성한 심판 장착 도구 ⑤ 희미해지는 기억 플레이 시점 대상 ⑥ 인양 도구 대상 ⑦ 하이머딩거 복사 능력 목록 ⑧ 물결을 바꾸는 자 격발 시점 대상
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
  // ══ ① 다리우스 - 처형자(243): 'here' 오라는 기지에서도 (RiftJudge #4514 · 198.1) ══
  fresh(); const dar=unit(243,0,'base'), ally=unit(210,0,'base'), far=unit(210,0,0), foe=unit(210,1,'base');
  ok('① 다리우스 기지: 같은 기지의 아군 +1', might(ally)===3 && might(far)===2 && might(foe)===2, 'ally='+might(ally)+' far='+might(far)+' foe='+might(foe));

  // ══ ② 우디르 - 야인(157): 모드·대상은 발동 시점(#2111) — 응수 뒤 대상이 없으면 불발 ══
  fresh(); G.bfs[0].controller=1; const ud=unit(157,0,0,{buff:1}); const t2=unit(219,1,0);
  OPT=(t,o)=>{ if(/우디르/.test(t)) return 'dmg'; return o[0].v; }; PICK=(u,p)=>u===t2;
  await activateAbility(0,{kind:'unit',u:ud},FX[157].activated[0]);
  ok('② 우디르: 발동 시점 모드/대상 → 피해 2', t2.dmg===2 && ud.buff===0, 'dmg='+t2.dmg+' buff='+ud.buff);
  fresh(); G.bfs[0].controller=1; const ud2=unit(157,0,0,{buff:1}); unit(219,1,0);
  OPT=(t,o)=>{ if(/우디르/.test(t)) return null; return o[0].v; };
  await activateAbility(0,{kind:'unit',u:ud2},FX[157].activated[0]);
  ok('② 우디르: 발동 취소면 비용(버프) 유지', ud2.buff===1, 'buff='+ud2.buff);

  // ══ ③ [일시적] 처치는 개시 격발 — 처치 전 숨긴 존야(77)를 공개해 구한다 (#10806) ══
  fresh(); G.bfs[0].controller=0; const sp=unit(210,0,0); sp.grants.temporary=true; G.bfs[0].hiddenCards.push({n:77,by:0,turn:0});
  OPT=(t,o)=>{ if(/일시적\] 처치 전에/.test(t)){ const x=o.find(x=>/공개:/.test(x.label)); return x?x.v:o[0].v; } return o[0].v; };
  await startTurn();
  ok('③ 일시적: 존야 공개 → 사망 대체(기지로 회수), 존야 폐기', onBoard(sp) && sp.loc==='base' && G.players[0].trash.includes(77) && G.bfs[0].hiddenCards.length===0, 'on='+onBoard(sp)+' loc='+sp.loc+' trash='+G.players[0].trash.join(','));
  fresh(); G.bfs[0].controller=0; const sp2=unit(210,0,0); sp2.grants.temporary=true; G.bfs[0].hiddenCards.push({n:77,by:0,turn:0});
  await startTurn();   // 기본 선택 '공개 안 함' → 처치
  ok('③ 일시적: 공개 안 하면 처치(전장 통제 상실로 숨김 카드도 폐기 106.4.e)', !onBoard(sp2) && G.players[0].trash.includes(77), 'on='+onBoard(sp2)+' trash='+G.players[0].trash.join(','));

  // ══ ④ 신성한 심판(244): 장착 도구도 후보(#12053) — 소실 없이 남거나 재활용 ══
  fresh(); const ju=unit(219,0,0); ju.gear=[21]; ju.gearCtrl=[0]; gear(32,0); gear(60,1); unit(210,1,0);
  await play(244);
  const gearWhere = G.players[0].deck.includes(21) ? 'deck' : (G.players[0].gear.some(g=>g.n===21) ? 'base' : ((ju.gear||[]).includes(21) ? 'attached' : 'LOST'));
  ok('④ 심판: 장착 도구가 후보에 오르고 소실되지 않음', OPTLIST.some(x=>/남길 도구/.test(x.t) && x.o.some(o=>/장착/.test(o.label))) && gearWhere!=='LOST', 'where='+gearWhere);

  // ══ ⑤ 희미해지는 기억(180): 대상(도구)은 플레이 시점 지정 ══
  fresh(); const bg=gear(60,1); OPT=(t,o)=>{ if(/일시적\]를 부여할 대상/.test(t)){ const x=o.find(x=>/도구/.test(x.label)); return x?x.v:o[0].v; } return o[0].v; };
  await play(180);
  ok('⑤ 희미해지는 기억: 플레이 시점에 고른 도구에 [일시적]', bg.temporary===true && OPTS.filter(t=>/일시적\]를 부여할 대상/.test(t)).length===1, 'temp='+bg.temporary+' prompts='+OPTS.filter(t=>/부여할 대상/.test(t)).length);
  fresh();   // 후보(전장 유닛·도구)가 없으면 플레이 불가
  G.players[0].hand=[180]; const r5=await playCardFromHand(0,0,{});
  ok('⑤ 희미해지는 기억: 대상 없으면 플레이 불가', r5===false && G.players[0].hand.includes(180), 'r='+r5);

  // ══ ⑥ 인양(224): 도구 대상(선택)은 플레이 시점 — 해결 때 처치 + 드로우 ══
  fresh(); const kg=gear(60,1); OPT=(t,o)=>{ if(/처치할 도구/.test(t)){ const x=o.find(x=>/도구/.test(x.label)); return x?x.v:o[0].v; } return o[0].v; }; const h6=G.players[0].hand.length;
  await play(224);
  ok('⑥ 인양: 플레이 시점에 고른 도구 처치 + 1드로우', !G.players[1].gear.includes(kg) && G.players[0].hand.length===h6+1, 'gear='+G.players[1].gear.length+' hand='+(G.players[0].hand.length-h6));

  // ══ ⑦ 하이머딩거(111): 복사한 탈진 능력이 봇/충당/응수 목록에 오른다(#2679) ══
  fresh(); unit(111,0,'base'); gear(120,0);
  const copied=polAbList(0).filter(c=>c.ab.copied);
  ok('⑦ 하이머딩거: 통찰의 인장 능력 복사 항목', copied.length>=1 && copied.every(c=>c.src.u.n===111), 'copied='+copied.map(c=>c.name).join('|'));

  // ══ ⑧ 물결을 바꾸는 자(199): 교환 상대는 격발 시점(대상) ══
  fresh(); G.bfs[0].controller=0; const mate=unit(210,0,0); OPT=(t,o)=>{ if(/배치|위치/.test(t)) return 'base'; return o[0].v; }; PICK=(u,p)=>u===mate;
  await play(199);
  const tt=find(0,199);
  ok('⑧ 물결을 바꾸는 자: 격발 시점에 교환 상대 지정 → 자리 교환', tt && tt.loc===0 && mate.loc==='base' && PICKS.some(t=>/교환할 아군/.test(t)), 'tt.loc='+(tt&&tt.loc)+' mate='+mate.loc);

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-audit-0922b.js' });
