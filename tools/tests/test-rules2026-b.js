// 2026-07-16판 종합 규칙 대조 2차(rules-audit-2026 work-B/D/E) 검증 — 헤드리스(vm) 엔진 테스트
//  ① 356.4.c.1/d 할인 최소값은 '그 할인만' — 견습생(84)+「하늘 가르기」/'다음 주문 -5' → 0
//  ② 377.3.b.2 · 403.1.b · 404 활성화 능력: 대상은 발동 시점(비용 전), 후보 없으면 발동 불가, 중립에서도 [반응] 응수 창 (전설 포함)
//  ③ 420.3.b · 812.2/813.1 비격발 '플레이' 판정은 파이널라이즈 기준 — 카운터된 주문·체인 위 미해결 주문도 셈, 격발 순번(playedSeq)은 해결 기준
//  ④ 358/359.2.d 비용 지불 중 취소 → 아무것도 내지 않음 (말자하 113)
//  ⑤ 383.4.c 「꿈꾸는 나무」(292) 격발은 파이널라이즈 뒤 — 굴절 거부로 플레이가 취소되면 드로우 없음
//  ⑥ 817.2 인쇄 [통찰]+오라 [통찰]은 각각 격발  ⑦ 정령의 안식처(63) 'if they didn't already'  ⑧ 717.3 피해 0엔 보너스 없음
//  ⑨ 431.3/431.4 번아웃 반복  ⑩ 428.6 'Kill all' 동시 처치(존야 선택)  ⑪ 417.1 동시 재활용 무작위 순서(scryTop)
//  ⑫ 423.1/414.1 'a unit' 기절·탈진은 아군도 가능  ⑬ 416.6 효과 재활용 강제  ⑭ 431.1.b 「맹목적 분노」(25) 덱 비면 번아웃
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
  PICKS.length=0; OPTS.length=0; NUMS.length=0; CONFIRMS.length=0; OPTLIST.length=0; REACTS.length=0;
}
function openSd(attacker, hasCombat){ attacker=attacker||0; G.state='showdown'; G.actingPlayer=attacker;
  G.showdown={bfIdx:0,attacker,defender:opp(attacker),hasCombat:hasCombat!==false,passes:0,chain:[],chainStarter:null}; }
const onBoard=u=>everyUnit().includes(u);
const A=()=>G.players[0], B=()=>G.players[1];
const unit=(n,p,loc,o)=>{ const u=makeUnit(n,p,{loc,ready:true}); placeUnit(u,loc); Object.assign(u,o||{}); return u; };
const gear=(n,p,o)=>{ const g={n,ex:false,attachedTo:null,...(o||{})}; G.players[p].gear.push(g); return g; };
const play=async(n,p)=>{ p=p||0; G.players[p].hand=[n]; return await playCardFromHand(p,0,{}); };
const resolve=async()=>{ await showdownPass(); await showdownPass(); };
const powerSum=p=>Object.values(G.players[p].power).reduce((a,b)=>a+b,0);
(async()=>{
  // ══ ① 356.4 할인 최소값은 그 할인에만 ══
  fresh(); unit(84,0,0);                                    // 열성적인 견습생 (전장) — 주문 -1, 최소 1
  ok('356.4: 견습생만 — 2코 주문은 1', applyCostMods(0, card(50), 2)===1, 'e='+applyCostMods(0, card(50), 2));
  ok('356.4: 견습생 — 0코 주문은 0 그대로(최소값이 비용을 올리지 않는다)', applyCostMods(0, card(50), 0)===0, 'e='+applyCostMods(0, card(50), 0));
  TF().nextSpellDisc[0]=5;                                  // 격노한 화염룡 '다음 주문 -5'
  ok('356.4: 견습생(최소 1) + 다음 주문 -5 → 0 (예전엔 1)', applyCostMods(0, card(50), 2)===0, 'e='+applyCostMods(0, card(50), 2));
  TF().nextSpellDisc[0]=0;
  const big=unit(219,0,'base'); big.tempM=[{v:4,dur:'turn'}];   // 위력 높은 유닛 흉내
  const hi=Math.max(...allUnits(0).map(u=>might(u)));
  ok('356.4: 견습생 + 「하늘 가르기」(최고 위력만큼 감소) → 8-1-'+hi+' = '+Math.max(0,7-hi)+' (룰북 예시 순서)', applyCostMods(0, card(14), 8)===Math.max(0,7-hi), 'e='+applyCostMods(0, card(14), 8));
  fresh(); unit(140,0,'base');                              // 비늘의 전령: 용 -2 최소 1
  ok('356.4: 전령 — 6코 용(31)은 4', applyCostMods(0, card(31), 6)===4, 'e='+applyCostMods(0, card(31), 6));

  // ══ ② 활성화 능력 — 대상은 발동 시점·후보 없으면 불가·중립 응수 창 ══
  fresh(); const g17=gear(17,0); B().hand=[311];
  await activateAbility(0,{kind:'gear',g:g17},FX[17].activated[0]);
  ok('404: 「강철 발리스타」 전장 유닛이 없으면 발동 불가 — 탈진 없음·프롬프트 없음', g17.ex===false && PICKS.length===0 && REACTS.length===0, 'ex='+g17.ex+' picks='+PICKS.length);
  const abc=polAbList(0).find(c=>c.src.g===g17);
  ok('404(봇): polAbLegal도 대상 없으면 false', abc && polAbLegal(0,abc)===false);
  const foe=unit(219,1,0);
  ok('404(봇): 대상이 생기면 polAbLegal true', polAbLegal(0,abc)===true);
  await activateAbility(0,{kind:'gear',g:g17},FX[17].activated[0]);
  ok('403.1.b: 대상은 발동 시점에 고른다(프롬프트에 능력 이름·피해 2) → 상대 [반응] 응수 창 → 피해 2', PICKS.length===1 && /강철 발리스타 능력.*피해 2/.test(PICKS[0]) && REACTS.length===1 && /발동/.test(REACTS[0]) && foe.dmg===2 && g17.ex===true, JSON.stringify([PICKS,REACTS,foe.dmg]));
  fresh(); const g17b=gear(17,0); const foe2=unit(219,1,0); B().hand=[311];
  REACT=()=>{ removeUnit(foe2); foe2._dead=true; return null; };   // 응수로 대상이 사라짐
  await activateAbility(0,{kind:'gear',g:g17b},FX[17].activated[0]);
  ok('356.3.e: 응수로 대상이 사라지면 그 지시만 불발 — 비용(탈진)은 낸 채', foe2.dmg===0 && g17b.ex===true && PICKS.length===1, 'dmg='+foe2.dmg+' ex='+g17b.ex);
  // 전설 능력(리 신 257 '아군 유닛 버프')도 중립에서 응수 창이 열리고, 아군이 없으면 발동 불가
  fresh(); A().legendN=257; B().hand=[311];
  await activateAbility(0,{kind:'legend'},FX[257].activated[0]);
  ok('404: 리 신 전설 — 아군 유닛 없으면 발동 불가(탈진·에너지 없음)', A().legendEx===false && A().energy===20, 'ex='+A().legendEx+' e='+A().energy);
  const mine=unit(210,0,'base');
  await activateAbility(0,{kind:'legend'},FX[257].activated[0]);
  ok('377.3.b.2: 전설 능력도 중립에서 [반응] 응수 창 → 해결(버프)', REACTS.length===1 && mine.buff===1 && A().legendEx===true && A().energy===19, 'reacts='+REACTS.length+' buff='+mine.buff);
  // [추가] 자원 능력(다리우스 253)은 응수 창 없음
  fresh(); A().playedCards=1; B().hand=[311]; const e0=A().energy;
  await activateAbility(0,{kind:'legend'},FX[253].activated[0]);
  ok('333.1.c: [추가] 자원 능력은 응수 창 없이 즉시', REACTS.length===0 && A().energy===e0+1, 'reacts='+REACTS.length+' e='+A().energy);

  // ══ ③ 파이널라이즈 기준 플레이 수 ══
  // 중립: A의 「광선」(9)이 B의 「저항」(45)에 카운터당해도 파이널라이즈됐으므로 이어 낸 「다리우스 - 처형자」(243) [군단] 준비 등장
  fresh(); unit(219,1,0); G.bfs[0].controller=1; B().hand=[45]; REACT=(p,t,o)=>o[0].v;   // (B 통제 전장 — 결전이 열리지 않게)
  await play(9);
  ok('420.3.b: 카운터당한 주문 — 플레이 수 1, 격발 순번 0', A().playedCards===1 && A().playedSeq===0, 'played='+A().playedCards+' seq='+A().playedSeq);
  B().hand=[]; REACT=null; await play(243);
  const dar=allUnits(0).find(u=>u.n===243);
  ok('813.1: 카운터당한 주문 뒤의 [군단] 카드 활성 — 다리우스 준비 상태로 등장', dar && dar.ex===false, 'ex='+(dar&&dar.ex));
  // 결전 체인: 군단 주문이 먼저 적재되고 그 위에 다른 주문이 오르면, 해결 시점에 군단 조건 충족 (813.1 '파이널라이즈됐는가'를 다시 본다)
  fresh(); openSd(0); unit(219,1,0);
  const savedOps=FX[133].playOps; FX[133].playOps=[...savedOps, {legion:true, ops:[{op:'draw',n:1}]}];   // 「칼날 세례」([반응])에 군단 드로우를 덧붙여 검증
  try{
    await play(133); const it1=G.showdown.chain[0];
    ok('812.2: 첫 주문 적재 시점엔 군단 미충족(다른 카드 없음)', it1.legionOK===false && A().playedCards===1, 'legionOK='+it1.legionOK);
    await play(133); const it2=G.showdown.chain[1];
    ok('813.1: 두 번째 주문은 적재 시점에 군단 충족(첫 주문은 미해결이지만 파이널라이즈됨)', it2.legionOK===true && A().playedCards===2, 'legionOK='+it2.legionOK);
    const h0=A().hand.length; await resolve(); await resolve();
    ok('813.1: 해결 시점 재평가 — 두 주문 모두 군단 드로우(+2)', A().hand.length===h0+2, 'hand '+h0+'→'+A().hand.length);
  } finally { FX[133].playOps=savedOps; }

  // ══ ④ 비용 지불 중 취소 → 되돌림 (말자하 113: 아군 유닛/도구 처치 + 탈진) ══
  fresh(); const mal=unit(113,0,'base'); unit(210,0,'base'); const pw0=powerSum(0);
  OPT=(t,o)=>/처치할 아군/.test(t)?null:o[0].v;
  await activateAbility(0,{kind:'unit',u:mal},FX[113].activated[0]);
  ok('359.2.d: 처치 선택을 취소하면 탈진·자원 변화 없음(선택은 지불 전)', mal.ex===false && powerSum(0)===pw0 && allUnits(0).length===2, 'ex='+mal.ex+' pw='+powerSum(0));
  OPT=null; await activateAbility(0,{kind:'unit',u:mal},FX[113].activated[0]);
  ok('말자하: 정상 발동 — 유닛 처치·탈진·힘 +2', mal.ex===true && allUnits(0).length===1 && powerSum(0)===pw0+2, 'ex='+mal.ex+' pw='+powerSum(0));

  // ══ ⑤ 꿈꾸는 나무 격발은 파이널라이즈 뒤 ══
  // 「도전」(128): 아군(꿈꾸는 나무 전장) → 적 [굴절] 포식자(161). 굴절 거부 → 플레이 취소 → 드로우 없음·턴 플래그 미소모
  fresh([292,297]); unit(210,0,0); unit(161,1,0); CONFIRM=()=>false;
  ok('383.4.c: 굴절 거부로 플레이 취소 — 「꿈꾸는 나무」 드로우 없음', await play(128)===false && A().hand.length===1 && !(TF().bf292[0]&&TF().bf292[0][0]), 'hand='+A().hand.length+' flag='+JSON.stringify(TF().bf292[0]));
  CONFIRM=t=>/굴절/.test(t);
  ok('383.4.c: 굴절 지불 후 파이널라이즈 → 드로우 1', await play(128)===true && A().hand.length===1 && TF().bf292[0][0]===true, 'hand='+A().hand.length);

  // ══ ⑥ 817.2 통찰 인스턴스마다 ══
  fresh(); unit(100,0,'base'); unit(100,0,'base');   // 예언자 2기(오라 [통찰]) + 인쇄 [통찰] 보석 거상(86)
  await play(86);
  ok('817.2: 인쇄 [통찰] + 예언자 오라 2 → 3회', CONFIRMS.filter(t=>/통찰/.test(t)).length===3, JSON.stringify(CONFIRMS));

  // ══ ⑦ 정령의 안식처 'if they didn't already' ══
  fresh(); gear(63,0); const pred=unit(161,0,'base',{buff:1}); const poro=unit(210,0,'base',{buff:1});
  ok('안식처: 인쇄 [굴절] 유닛은 그대로 1, 없는 유닛은 1 부여', effKw(pred).deflect===1 && effKw(poro).deflect===1, 'pred='+effKw(pred).deflect+' poro='+effKw(poro).deflect);

  // ══ ⑧ 717.3 피해 0 인스턴스에는 보너스 없음 ══
  fresh([296,297]); const t0=unit(219,1,0); TF().nextSpellBonus[0]=1; G._casting=0;
  ok('717.3: 기본 피해 0이면 관문·서적 보너스 없음', dmgPlus(0,t0,0)===0 && dealDamage(t0,0,'spell')===0 && t0.dmg===0, 'dmg='+t0.dmg);
  ok('717.3: 기본 피해 1이면 관문 +1 · 서적 +1 = 3', dealDamage(t0,dmgPlus(1,t0,0),'spell')===3, 'dmg='+t0.dmg);
  G._casting=null;

  // ══ ⑨ 431.3/431.4 번아웃 반복 ══
  fresh(); A().deck=[]; A().trash=[]; G.victory=8;
  drawCard(0);
  ok('431.4: 덱·폐기장 모두 비면 드로우 1회에 번아웃 반복 → 상대 승리', B().points>=8 && G.winner===1, 'pts='+B().points+' winner='+G.winner);
  fresh(); A().deck=[]; A().trash=[210,210];
  drawCard(0);
  ok('431.3: 폐기장이 있으면 1회 번아웃 뒤 드로우 완료', B().points===1 && A().hand.length===1 && A().deck.length===1, 'pts='+B().points+' hand='+A().hand.length);

  // ══ ⑩ 428.6 'Kill all' 동시 처치 ══
  fresh(); gear(77,1); const k1=unit(210,1,0), k2=unit(210,1,0); PICK=u=>u===k2;
  await execOps([{op:'killAll',spec:{side:'enemy',where:'any'}}],{p:0,kind:'spell'});
  ok('428.6: 존야 통제자가 어느 죽음을 대체할지 고른다(동시 처치) — 고른 k2 회수, k1 사망', PICKS.some(t=>/존야/.test(t)) && onBoard(k2) && k2.loc==='base' && !onBoard(k1), 'picks='+JSON.stringify(PICKS)+' k2='+onBoard(k2)+' k1='+onBoard(k1));

  // ══ ⑪ 417.1 동시 재활용은 덱 밑에 무작위 순서 (촛불 밝힌 성소 scryTop) ══
  fresh(); A().deck=[9,45,...Array(10).fill(210)]; CONFIRM=()=>true;
  await execOps([{op:'scryTop',n:2}],{p:0,kind:'effect'});
  const bot2=A().deck.slice(-2);
  ok('417.1: 재활용한 2장이 덱 맨 아래에(순서는 무작위)', A().deck.length===12 && bot2.includes(9) && bot2.includes(45) && A().deck[0]===210, JSON.stringify(bot2));

  // ══ ⑫ 'a unit' 기절·탈진은 아군도 고를 수 있다 ══
  fresh(); const fr=unit(210,0,0); unit(219,1,0); PICK=u=>u===fr;
  await play(50);
  ok('423.1: 「룬 감옥」으로 아군 유닛 기절 가능(플레이 시점 지정이 해결 때도 적법)', fr.stunned===true, 'stunned='+fr.stunned);
  fresh(); const fr2=unit(210,0,0); unit(219,1,0); PICK=u=>u===fr2;
  await execOps([{op:'exhaust',spec:{type:'unit',side:'any',where:'any',count:1}}],{p:0,kind:'spell'});
  ok('414.1: exhaust op도 아군 선택 가능', fr2.ex===true, 'ex='+fr2.ex);

  // ══ ⑬ 416.6 효과 재활용은 강제 ══
  fresh(); A().trash=[9,45,50,14]; OPT=()=>null; const d0=A().deck.length;
  await EXTRA_OPS.recycleFromTrash({n:3},{p:0},null);
  ok('416.6: 취소해도 3장 재활용(폐기장 1장 남음)', A().trash.length===1 && A().deck.length===d0+3, 'trash='+A().trash.length);

  // ══ ⑭ 431.1.b 「맹목적 분노」 — 상대 덱 비면 번아웃 뒤 진행 ══
  fresh(); B().deck=[]; B().trash=[210]; OPT=(t,o)=>o[0].v;
  await EXTRA_OPS.blindRage({},{p:0},null);
  ok('431.1.b: B 덱 비어 번아웃(A +1) 뒤 폐기장의 포로를 공개·추방·플레이', A().points===1 && B().deck.length===0 && allUnits(0).some(u=>u.n===210 && u.owner===1), 'pts='+A().points+' units='+allUnits(0).map(u=>u.n));
  fresh(); B().deck=[]; B().trash=[]; G.victory=8;
  await EXTRA_OPS.blindRage({},{p:0},null);
  ok('431.3: B 덱·폐기장 모두 비면 번아웃 반복 → A 승리', G.winner===0 && A().points>=8, 'winner='+G.winner+' pts='+A().points);

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack||e.message));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-rules2026-b.js' });
