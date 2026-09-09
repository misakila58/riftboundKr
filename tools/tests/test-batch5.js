// RiftJudge 감사 5차 묶음(work-5.json, 카드 #5~#80) 검증:
//  ① 붕괴(5) — "이것으로 처치되면"은 클린업 잣대(결전 역할 위력)로 판정(#7148)
//  ② 와작와작 죠스(6) — 정식 플레이 경로: 기지/통제 전장 선택(#5470)·방어 중 결전 전장(#3111)·플레이 이벤트(#4866) · 로켓(252) 버림 격발(#6209)
//  ③ 무허가 무기고(23) — 대상 없으면 발동 불가(#3642)·대상은 비용 전(#2485)·여러 장은 하나씩 소모(#686)
//  ④ 신비한 반전(80) — 탈취자 기준 시전(마도서 보너스 없음 #1393)·새 대상 선택(#4630)
//  ⑤ 열 광선(22) — 장착 장비도 폐기(#3302) · 눈먼 분노(25) — 정식 플레이(배치·[가속]·소유자 #2434·#4963)·브린히르 금지(#10521)
//  ⑥ 격노한 화염룡(31) — 할인은 지불 시 소모(#4039) · 볼리베어(158) — 전장에 있을 때만(#8279) · 매혹(43) — 이동 강제(#9277)·숨김 카드로 응수(#10372)
//  ⑦ 태엽 수호자(44) — 숨김 공개도 추가 비용(#2488) · 저항(45) — 자기 주문 카운터(#8450) · 간수(70) — 숨김 유닛 공개 불가(#4573)
//  ⑧ 솔라리 성소(72) — 처치자 귀속(#5587) · 최후의 저항(69) — 결전 위력 스냅샷(#2568) · 회귀: 규율(58)/광선(9) 대상 없으면 불가, 카운터된 주문 미집계, 무혈 결전 무치유, 간수 사후 다리우스 준비
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '../../client/web/js');
const r = f => fs.readFileSync(path.join(JS, f), 'utf8');
const BOOT = `
if(typeof globalThis.withBattlefieldSource==='undefined') globalThis.withBattlefieldSource=(s,fn)=>fn();
var PICK=null;        // pickUnitFrom 선택 함수 (null이면 적 전장 유닛 우선)
var OPT=null;         // pickOption 선택 함수 (title, options)→v (null이면 첫 항목)
var NUM=null;         // pickNumber 선택 함수 (null이면 최댓값)
var CONFIRM=()=>false; // confirmP 응답 함수(prompt)
var REACT=null;       // pickReaction 선택 함수 (title, options)→v (null이면 응수 안 함)
var PICKS=[], OPTS=[], NUMS=[], CONFIRMS=[], OPTLIST=[], CANDS=[];   // 프롬프트 기록
var UI = { log(){}, render(){}, toast(){}, fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:(p,t)=>{ CONFIRMS.push(String(t||'')); return Promise.resolve(!!CONFIRM(String(t||''),p)); },
  pickUnitFrom:(p,c,t)=>{ PICKS.push(String(t||'')); CANDS.push({t:String(t||''),c:[...c]}); return Promise.resolve(PICK ? (c.find(u=>PICK(u))||c[0]) : (c.find(u=>u.ctrl===1&&u.loc!=='base')||c[0])); },
  pickOption:(p,t,o)=>{ OPTS.push(String(t||'')); OPTLIST.push({t:String(t||''),o,p,state:G.state}); return Promise.resolve(OPT ? OPT(String(t||''),o,p) : o[0].v); },
  pickReaction:(p,t,o)=>Promise.resolve(REACT ? REACT(String(t||''),o,p) : null),
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
  PICK=null; OPT=null; NUM=null; CONFIRM=()=>false; REACT=null; PICKS.length=0; OPTS.length=0; NUMS.length=0; CONFIRMS.length=0; OPTLIST.length=0; CANDS.length=0;
}
function openSd(attacker, hasCombat){ attacker=attacker||0; G.state='showdown'; G.actingPlayer=attacker;
  G.showdown={bfIdx:0,attacker,defender:opp(attacker),hasCombat:hasCombat!==false,passes:0,chain:[],chainStarter:null}; }
const onBoard=u=>everyUnit().includes(u);
const unit=(n,p,loc,o)=>{ const u=makeUnit(n,p,{loc,ready:true}); placeUnit(u,loc); Object.assign(u,o||{}); return u; };
const gear=(n,p)=>{ G.players[p].gear.push({n,ex:false,attachedTo:null}); return G.players[p].gear[G.players[p].gear.length-1]; };
const play=async(n,p)=>{ p=p||0; G.players[p].hand=[n]; return await playCardFromHand(p,0,{}); };
const resolveOne=async()=>{ await showdownPass(); await showdownPass(); };
const find=(p,n)=>allUnits(p).find(u=>u.n===n);
const A=()=>G.players[0], B=()=>G.players[1];
(async()=>{
  // ══ ① 붕괴(5) — 전투 결전 중 공격자 [맹공 2]는 위력 4: 피해 3으로는 죽지 않으므로 드로우 없음(#7148) ══
  fresh(); openSd(1,true); const enf=unit(3,1,0); unit(210,0,0); PICK=u=>u===enf;
  await play(5); await resolveOne();
  ok('붕괴: 맹공 공격자(2+2)에 피해 3 → 생존·드로우 없음', onBoard(enf) && enf.dmg===3 && A().hand.length===0, 'alive='+onBoard(enf)+' hand='+A().hand.length);
  fresh(); openSd(1,true); const poro=unit(210,1,0); unit(210,0,0); PICK=u=>u===poro;
  await play(5); await resolveOne();
  ok('붕괴: 맹공 1 공격자(2+1)에 피해 3 → 사망·드로우 1', !onBoard(poro) && A().hand.length===1, 'alive='+onBoard(poro)+' hand='+A().hand.length);

  // ══ ② 와작와작 죠스(6) — 정식 플레이 경로 ══
  fresh(); G.bfs[0].controller=0; const cit=unit(139,0,'base'); A().hand=[6];
  CONFIRM=t=>/죠스/.test(t); OPT=(t,o)=>{ if(/배치할 위치/.test(t)) return 0; return o[0].v; };
  await discardFromHand(0,0);
  ok('죠스: 버림 → 분노 지불 → 통제 전장 선택지가 있고 그곳에 등장(#5470)', OPTS.some(t=>/배치할 위치/.test(t)) && find(0,6) && find(0,6).loc===0, 'loc='+(find(0,6)&&find(0,6).loc)+' opts='+JSON.stringify(OPTS));
  ok('죠스: 플레이 이벤트(시트리아 버프)·playedCards(#4866)', cit.buff===1 && A().playedCards===1, 'buff='+cit.buff+' played='+A().playedCards);
  ok('죠스: 폐기장에 남지 않음', !A().trash.includes(6), JSON.stringify(A().trash));
  fresh(); G.bfs[0].controller=0; unit(210,0,0); unit(210,1,0); openSd(1,true); A().hand=[6];
  CONFIRM=t=>/죠스/.test(t); OPT=(t,o)=>{ if(/배치할 위치/.test(t)) return 0; return o[0].v; };
  await discardFromHand(0,0);
  ok('죠스: 방어 중인 결전 전장에 바로 등장(#3111)', find(0,6) && find(0,6).loc===0, 'loc='+(find(0,6)&&find(0,6).loc));
  fresh(); TF().noPlay[0]=true; A().hand=[6]; CONFIRM=()=>true;
  await discardFromHand(0,0);
  ok('죠스: 플레이 금지(브린히르) 중엔 제안 없음·폐기장 유지', !find(0,6) && A().trash.includes(6) && !CONFIRMS.length, JSON.stringify(CONFIRMS));
  // ── 로켓(252): 회수 비용의 버림도 정식 버림 → 죠스가 격발하고 로켓도 회수(#6209) ──
  fresh(); A().trash=[252]; A().hand=[6]; CONFIRM=()=>true;
  await EXTRA_OPS.rocketRecover({}, {p:0}, null);
  ok('로켓: 죠스를 버려 플레이하고 로켓은 손패로', find(0,6) && A().hand.includes(252) && !A().trash.includes(6) && !A().trash.includes(252), 'hand='+JSON.stringify(A().hand)+' trash='+JSON.stringify(A().trash));

  // ══ ③ 무허가 무기고(23) ══
  fresh(); let g23=gear(23,0); A().hand=[6,210];
  await activateAbility(0,{kind:'gear',g:g23},FX[23].activated[0]);
  ok('무기고: 아군 유닛이 없으면 발동 불가 — 탈진·버림 없음(#3642)', g23.ex===false && A().hand.length===2, 'ex='+g23.ex+' hand='+A().hand.length);
  fresh(); g23=gear(23,0); const ax=unit(210,0,'base'); A().hand=[6,210]; CONFIRM=t=>/죠스/.test(t); PICK=u=>u===ax;
  await activateAbility(0,{kind:'gear',g:g23},FX[23].activated[0]);
  const armCands=CANDS.find(x=>/사망 방지/.test(x.t));
  ok('무기고: 대상은 버림 전에 고르고, 버려서 등장한 죠스는 후보가 아니다(#2485)', armCands && !armCands.c.some(u=>u.n===6) && find(0,6) && ax._armory===1 && g23.ex===true, 'cands='+(armCands&&armCands.c.map(u=>u.n).join(','))+' jaws='+!!find(0,6)+' arm='+ax._armory);
  fresh(); const ay=unit(210,0,'base',{_armory:2}); CONFIRM=()=>true;
  await killUnit(ay);
  ok('무기고: 두 장 걸린 유닛 사망 시 하나만 소모(#686)', onBoard(ay) && ay.loc==='base' && ay.ex===true && ay._armory===1, 'arm='+ay._armory+' on='+onBoard(ay));

  // ══ ④ 신비한 반전(80): 탈취자가 새 대상을 고르고(#4630) 원 시전자의 마도서 보너스는 붙지 않는다(#1393) ══
  fresh(); openSd(0,true); const ua=unit(210,0,0), ub=unit(210,1,0); TF().nextSpellBonus[0]=1;
  PICK=u=>u===ub; await play(9,0);
  B().hand=[80]; await playCardFromHand(1,0,{});
  ok('반전: 체인에 광선(A)·반전(B)', G.showdown.chain.length===2 && G.showdown.chain[1].kind==='counter' && G.showdown.chain[1].target===G.showdown.chain[0], 'chain='+G.showdown.chain.map(x=>x.kind).join(','));
  PICK=u=>u===ua; await resolveOne(); await resolveOne();
  ok('반전: 탈취자(B)가 새 대상(A 유닛)을 골라 피해 3 — 원 시전자 마도서 +1 없음', ua.dmg===3 && ub.dmg===0, 'ua='+ua.dmg+' ub='+ub.dmg);
  ok('반전: 플레이 수는 탈취자에게(#6678 유지)', B().playedCards>=1, 'B='+B().playedCards+' A='+A().playedCards);

  // ══ ⑤ 열 광선(22) · 눈먼 분노(25) ══
  fresh(); const eq=unit(210,0,'base'); eq.gear.push(32); gear(23,1);
  await play(22);
  ok('열 광선: 장착 장비도 폐기(#3302)', eq.gear.length===0 && A().trash.includes(32) && B().gear.length===0, 'ug='+eq.gear.length+' trash='+JSON.stringify(A().trash));
  fresh(); G.bfs[0].controller=0; B().deck.unshift(10);
  CONFIRM=t=>/가속/.test(t); OPT=(t,o)=>{ if(/배치할 위치/.test(t)) return 0; return o[0].v; };
  await play(25);
  const bl=find(0,10);
  ok('눈먼 분노: 정식 플레이 — 배치 위치 선택·통제 전장 등장·[가속] 지불 준비 등장(#2434)', bl && bl.loc===0 && bl.ex===false && OPTS.some(t=>/배치할 위치/.test(t)) && CONFIRMS.some(t=>/가속/.test(t)), 'u='+!!bl+' loc='+(bl&&bl.loc)+' ex='+(bl&&bl.ex));
  ok('눈먼 분노: 통제자는 나, 소유자는 상대(#4963)·추방 해제·플레이 이벤트', bl && bl.ctrl===0 && bl.owner===1 && !B().banish.includes(10) && A().playedCards===2, 'owner='+(bl&&bl.owner)+' played='+A().playedCards);
  fresh(); TF().noPlay[0]=true; B().deck.unshift(10);
  await EXTRA_OPS.blindRage({}, {p:0}, null);
  ok('눈먼 분노: 브린히르 금지 중엔 공개 유닛도 플레이 불가 → 추방 유지(#10521)', !find(0,10) && B().banish.includes(10) && !A().hand.includes(10), 'banish='+JSON.stringify(B().banish));

  // ══ ⑥ 격노한 화염룡(31) · 볼리베어(158) · 매혹(43) ══
  fresh(); openSd(0,true); unit(210,1,0); TF().nextSpellDisc[0]=5; const e0=A().energy;
  await play(9);
  ok('화염룡: 할인은 비용 지불 시 소모 — 체인 해결 전에 이미 0(#4039)', TF().nextSpellDisc[0]===0 && A().energy===e0 && G.showdown.chain.length===1, 'disc='+TF().nextSpellDisc[0]+' e='+A().energy);
  fresh(); unit(158,0,'base'); const vb=unit(210,1,'base'); PICK=u=>u===vb;
  await play(43);
  ok('볼리베어: 기지에 있으면 적 유닛이 전장으로 이동해도 드로우 없음(#8279)', vb.loc===0 && A().hand.length===0, 'loc='+vb.loc+' hand='+A().hand.length);
  fresh(); G.bfs[1].controller=0; unit(158,0,1); const vb2=unit(210,1,'base'); PICK=u=>u===vb2;
  await play(43);
  ok('볼리베어: 전장에 있고 적이 다른 전장으로 이동하면 드로우', vb2.loc===0 && A().hand.length===1, 'loc='+vb2.loc+' hand='+A().hand.length);
  fresh(); const mv=unit(210,1,'base'); PICK=u=>u===mv; OPT=(t,o)=>{ if(/효과 이동/.test(t)) return null; return o[0].v; };
  await play(43);
  ok('매혹: 이동은 강제 — 취소해도 이동한다(#9277)', mv.loc!=='base' && OPTS.filter(t=>/효과 이동/.test(t)).length>=2, 'loc='+mv.loc+' asks='+OPTS.filter(t=>/효과 이동/.test(t)).length);
  fresh(); G.bfs[0].controller=1; const tt=unit(210,1,0); G.bfs[0].hiddenCards.push({n:77,by:1,turn:1});
  PICK=u=>u===tt; REACT=(t,o)=>{ const h=o.find(x=>x.v&&x.v.hidden); return h?h.v:null; };
  await play(43);
  ok('매혹: 중립 응수 창에서 숨김 카드(존야)를 공개해 응수(#10372)', B().gear.some(g=>g.n===77) && G.bfs[0].hiddenCards.length===0, 'gear='+JSON.stringify(B().gear.map(g=>g.n))+' hidden='+G.bfs[0].hiddenCards.length);

  // ══ ⑦ 태엽 수호자(44) · 저항(45) · 간수(70) ══
  fresh(); G.bfs[0].controller=0; G.bfs[0].hiddenCards.push({n:44,by:0,turn:1}); CONFIRM=t=>/추가 비용/.test(t);
  await playHidden(0,0);
  ok('태엽 수호자: 숨김 공개도 추가 비용(평정 힘)을 묻고 지불하면 드로우(#2488)', find(0,44) && find(0,44).loc===0 && CONFIRMS.some(t=>/추가 비용/.test(t)) && A().hand.length===1, 'u='+!!find(0,44)+' hand='+A().hand.length+' c='+JSON.stringify(CONFIRMS));
  fresh(); openSd(0,true); const cb=unit(210,1,0); PICK=u=>u===cb;
  await play(9); const okc=await play(45);
  ok('저항: 자기 주문도 카운터 대상(#8450)', okc===true && G.showdown.chain.length===2 && G.showdown.chain[1].target===G.showdown.chain[0], 'ok='+okc+' chain='+G.showdown.chain.length);
  await resolveOne(); await resolveOne();
  ok('저항: 자기 광선이 무효화되어 피해 없음', cb.dmg===0 && A().playedCards===1, 'dmg='+cb.dmg+' played='+A().playedCards);
  fresh(); openSd(0,true); const cb2=unit(210,1,0); unit(210,0,0); PICK=u=>u===cb2;
  await play(9); B().hand=[45]; await playCardFromHand(1,0,{});
  ok('저항: 상대 주문이 먼저 후보(단일 자동 선택이 상대 주문)', G.showdown.chain[1].target===G.showdown.chain[0] && G.showdown.chain[1].p===1, '');
  fresh(); G.bfs[0].controller=0; G.bfs[1].controller=1; unit(70,1,1); G.bfs[0].hiddenCards.push({n:6,by:0,turn:1});
  await playHidden(0,0);
  ok('간수: 상대 간수가 전장에 있으면 숨김 유닛 공개 불가(#4573)', !find(0,6) && G.bfs[0].hiddenCards.length===1, 'u='+!!find(0,6)+' hidden='+G.bfs[0].hiddenCards.length);
  fresh(); G.bfs[0].controller=0; G.bfs[0].hiddenCards.push({n:6,by:0,turn:1});
  await playHidden(0,0);
  ok('간수 없음: 숨김 유닛은 그 전장에 공개', find(0,6) && find(0,6).loc===0, '');

  // ══ ⑧ 솔라리 성소(72) · 최후의 저항(69) · 회귀 ══
  fresh(); gear(72,1); const st=unit(210,0,'base',{stunned:true}); st._decree=true; st._decreeBy=0; CONFIRM=()=>true; const bh=B().hand.length;
  await cleanupDeaths();
  ok('솔라리: 내 칙령으로 죽은 내 기절 유닛 — 상대 성소 미발동(#5587)', !onBoard(st) && B().hand.length===bh && B().gear[0].ex===false, 'hand='+B().hand.length+' ex='+B().gear[0].ex);
  fresh(); gear(72,1); const st2=unit(210,0,'base',{stunned:true,dmg:9}); st2._spellDmgBy=null; CONFIRM=()=>true; const bh2=B().hand.length;
  await cleanupDeaths();
  ok('솔라리: 상대가 죽인 기절 유닛 — 성소 발동', !onBoard(st2) && B().hand.length===bh2+1 && B().gear[0].ex===true, 'hand='+B().hand.length);
  fresh(); openSd(1,true); const shp=unit(52,0,0); unit(210,1,0); PICK=u=>u===shp;
  await play(69); await resolveOne();
  ok('최후의 저항: 방어자 [보호막] 포함 현재 위력(3)을 2배 → 전투 중 6, 전투 밖 5(#2568)', might(shp,'defender')===6 && might(shp)===5, 'def='+might(shp,'defender')+' base='+might(shp));
  // 회귀
  fresh(); const r58=await play(58); const r9=await play(9);
  ok('규율/광선: 적법 대상 없으면 플레이 불가(#8139 · #3502)', r58===false && r9===false, 'r58='+r58+' r9='+r9);
  fresh(); openSd(0,true); const cq=unit(210,1,0); PICK=u=>u===cq;
  await play(9); B().hand=[45]; await playCardFromHand(1,0,{}); await resolveOne(); await resolveOne();
  ok('카운터된 주문은 플레이 수에 들지 않음(#9459)', A().playedCards===0 && cq.dmg===0, 'played='+A().playedCards);
  fresh(); openSd(0,false); const nh=unit(210,0,0,{dmg:1});
  await resolveShowdown();
  ok('무혈 결전 종료엔 치유 없음(#11147)', nh.dmg===1, 'dmg='+nh.dmg);
  fresh(); G.bfs[0].controller=1; const jl=unit(70,1,0,{dmg:2}); const dr=unit(27,0,'base',{ex:true}); A().playedCards=1; PICK=u=>u===jl;
  await play(5);
  ok('간수: 주문 플레이 격발은 클린업 뒤 — 간수가 죽은 뒤 다리우스 준비(#7846)', !onBoard(jl) && dr.ex===false, 'jl='+onBoard(jl)+' ex='+dr.ex);

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack||e.message));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-batch5.js' });
