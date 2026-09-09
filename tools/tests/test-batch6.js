// RiftJudge 감사 6차 묶음(work-6.json) 검증 — 카드 개별 항목(#83~#206):
//  ① 과거에게 묻다(83) — 상대 턴 중립 응수 창에서 숨김 카드 공개(739.1) · 스프라이트 부름(94)+간수(70) — 토큰만 불발(#3977)
//  ② 이케시아 소나기(248)+경계하는 보초(96) — 격발 사이 클린업으로 종소리 먼저(#272) · 후퇴(104)+빅토르(117) — 플레이 격발은 해결 뒤(#7951)
//  ③ 성취자 아바(107) — 손패 플레이(수도승 +2 없음, 유닛은 아바의 전장)(#10475) · 카이사(112)+시간 왜곡(122) — 추방되면 재활용 없음(#4642)
//  ④ 도전(128)+다리우스(27) — 도전 피해 뒤 +2(#5184) · 맞대결(129) — 토큰도 준비 등장(#8620) · 크라켄 사냥꾼(150) — 가속 힘까지 할인(#4836)
//  ⑤ 파괴 공작(156) — 취소 불가(#4264) · 눈부신 오로라(160) — 플레이 불가면 추방 유지(#6096) · 죽음꽃 포식자(161)+티모(121) — 굴절 지불(#3529)
//  ⑥ 타곤의 정상(289) — 종료 단계 중 정복은 룬 준비 없음(#5875) · 세트(164)+히라나(282) — 정복 버프로 비용 못 냄(#8738)
//  ⑦ 질책(172)·사망 — 장착 도구 기지 회수(#1391) · 빙의(203) — 소유자 폐기장(#2250) · 은밀한 추적자(177) — 기지·탈진·효과 이동 동행(#6119 #2230)
//  ⑧ 희미해지는 기억(180) — 도구 [일시적](#6709) · 경이의 꾸러미(181) — 장착 도구 회수(#10398) · 회오리바람(187) — 어느 유닛이든(#3563)
//  ⑨ 괴롭히는 밤(198)+애니(310) — 먼저 폐기장에(#6899) · 물결을 바꾸는 자(199)+바일마우(295) — 부분 해결(#7241)
//  ⑩ 시간선 역전(201) — 시전자 먼저 번아웃(#8457) · 등을 맞대고(206) — 아군 2기 필요(#1462)
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '../../client/web/js');
const r = f => fs.readFileSync(path.join(JS, f), 'utf8');
const BOOT = `
if(typeof globalThis.withBattlefieldSource==='undefined') globalThis.withBattlefieldSource=(s,fn)=>fn();
var PICK=null;        // pickUnitFrom 선택 함수 (null이면 적 전장 유닛 우선)
var OPT=null;         // pickOption 선택 함수 (title, options)→v (null이면 첫 항목)
var NUM=null;         // pickNumber 선택 함수 (null이면 최댓값)
var CONFIRM=()=>false; // confirmP 응답 함수(prompt)
var REACT=null;       // pickReaction 선택 함수 (title, options, p)→v (null이면 응수 안 함)
var PICKS=[], OPTS=[], NUMS=[], CONFIRMS=[], OPTLIST=[], REACTS=[];   // 프롬프트 기록
var UI = { log(){}, render(){}, toast(){}, fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:(p,t)=>{ CONFIRMS.push(String(t||'')); return Promise.resolve(!!CONFIRM(String(t||''),p)); },
  pickUnitFrom:(p,c,t)=>{ PICKS.push(String(t||'')); return Promise.resolve(PICK ? (c.find(u=>PICK(u,t))||c[0]) : (c.find(u=>u.ctrl===1&&u.loc!=='base')||c[0])); },
  pickOption:(p,t,o)=>{ OPTS.push(String(t||'')); OPTLIST.push({t:String(t||''),o,p,state:G.state}); return Promise.resolve(OPT ? OPT(String(t||''),o,p) : o[0].v); },
  pickReaction:(p,t,o)=>{ REACTS.push({t:String(t||''),o,p}); return Promise.resolve(REACT ? REACT(String(t||''),o,p) : null); },
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
const unit=(n,p,loc,o)=>{ const u=makeUnit(n,p,{loc,ready:true}); placeUnit(u,loc); Object.assign(u,o||{}); return u; };
const gear=(n,p)=>{ G.players[p].gear.push({n,ex:false,attachedTo:null}); };
const play=async(n,p)=>{ p=p||0; G.players[p].hand=[n]; return await playCardFromHand(p,0,{}); };
const resolve=async()=>{ await showdownPass(); await showdownPass(); };
const find=(p,n)=>allUnits(p).find(u=>u.n===n);
const powerSum=p=>Object.values(G.players[p].power).reduce((a,b)=>a+b,0);
(async()=>{
  // ══ ① 과거에게 묻다(83) — 상대 턴 중립 상태 응수 창에서 숨김 카드 공개 (739.1 · #7188) ══
  fresh(); G.bfs[0].controller=1; G.bfs[0].hiddenCards.push({n:83,by:1,turn:1});
  REACT=(t,o)=>{ const h=o.find(x=>x.v&&x.v.hidden); return h?h.v:null; };
  await play(129,0);
  ok('과거에게 묻다: 상대 주문에 숨김 공개 → 2장 드로우, 숨김 슬롯 비움', G.players[1].hand.length===2 && G.bfs[0].hiddenCards.length===0 && G.players[1].trash.includes(83),
    'hand='+G.players[1].hand.length+' hidden='+G.bfs[0].hiddenCards.length);
  ok('과거에게 묻다: 응수 선택지에 [숨김 공개] 항목', REACTS.length>=1 && REACTS[0].o.some(x=>/숨김 공개/.test(x.label)), JSON.stringify(REACTS.map(x=>x.o.map(y=>y.label))));
  // 공개가 봉쇄된 전장(blockReveal 유닛)의 숨김 카드는 후보에 나오지 않는다
  fresh(); G.bfs[0].controller=1; G.bfs[0].hiddenCards.push({n:83,by:1,turn:1}); const blocker=unit(210,0,0); FX[210].blockReveal=true;
  REACT=(t,o)=>{ const h=o.find(x=>x.v&&x.v.hidden); return h?h.v:null; };
  await play(129,0); delete FX[210].blockReveal;
  ok('과거에게 묻다: 공개 봉쇄 전장의 숨김 카드는 응수 후보 아님', G.bfs[0].hiddenCards.length===1 && !REACTS.some(x=>x.o.some(y=>y.v&&y.v.hidden)), '');

  // ── 스프라이트 부름(94) 숨김 + 마법사냥꾼 간수(70): 주문은 해결되되 토큰만 불발 (#3977) ──
  fresh(); G.bfs[0].controller=0; G.bfs[0].hiddenCards.push({n:94,by:0,turn:1}); unit(70,1,1);
  await playHidden(0,0);
  ok('스프라이트 부름+간수: 토큰 없음, 주문은 폐기장으로', !everyUnit().some(u=>u.isToken) && G.players[0].trash.includes(94) && G.bfs[0].hiddenCards.length===0, 'tokens='+everyUnit().filter(u=>u.isToken).length);
  fresh(); G.bfs[0].controller=0; G.bfs[0].hiddenCards.push({n:94,by:0,turn:1});
  await playHidden(0,0);
  ok('스프라이트 부름 숨김(간수 없음): 그 전장에 토큰', G.bfs[0].units.some(u=>u.isToken&&u.tokenName==='Sprite'), '');

  // ══ ② 이케시아 소나기(248) + 경계하는 보초(96): 격발 사이 클린업 → 종소리가 남은 격발보다 먼저 (#272) ══
  fresh(); const sentry=unit(96,1,0); unit(219,1,0); const handAt=[];
  PICK=(u,t)=>{ if(/피해 2/.test(t)) handAt.push(G.players[1].hand.length); return u===sentry; };
  await play(248,0);
  ok('소나기: 첫 격발로 보초 사망 → 둘째 격발 대상 선택 전에 이미 1장 드로우', handAt.length>=2 && handAt[0]===0 && handAt[1]===1, JSON.stringify(handAt));

  // ── 후퇴(104)로 빅토르 - 혁신가(117)를 상대 턴에 되돌리면 '플레이할 때' 격발 없음 (#7951, 이미 수정됨 확인) ──
  fresh(); openSd(1); G.bfs[0].controller=0; const vik=unit(117,0,0); unit(219,1,0); PICK=u=>u===vik;
  await play(104,0); await resolve();
  ok('후퇴+빅토르: 손패로 돌아간 뒤 격발 → 신병 토큰 없음', G.players[0].hand.includes(117) && !everyUnit().some(u=>u.isToken), 'tokens='+everyUnit().filter(u=>u.isToken).length);

  // ══ ③ 성취자 아바(107): '손패에서' 플레이 — 잉걸불 수도승(167) +2 없음, 유닛은 아바의 전장에 (#10475 · #1893) ══
  fresh(); const ava=unit(107,0,0); const monk=unit(167,0,'base'); G.players[0].hand=[94]; CONFIRM=()=>true;
  await EXTRA_OPS.avaHidden({}, {p:0, unit:ava}, null);
  ok('아바: 주문 플레이 — 수도승 +2 없음, 토큰 생성, 주문 플레이 수 반영', monk.tempM.length===0 && everyUnit().some(u=>u.isToken) && G.players[0].playedCards===1 && G.players[0].hand.length===0,
    'tempM='+monk.tempM.length+' played='+G.players[0].playedCards);
  fresh(); const ava2=unit(107,0,0); G.players[0].hand=[199]; CONFIRM=()=>true;
  await EXTRA_OPS.avaHidden({}, {p:0, unit:ava2}, null);
  ok('아바: 유닛은 아바의 전장(미통제)에 등장', find(0,199) && find(0,199).loc===0, 'loc='+(find(0,199)||{}).loc);

  // ── 카이사 - 진화자(112) + 시간 왜곡(122): 자기 추방 → 재활용 없음 (#4642) ──
  fresh(); G.players[0].points=11; G.players[0].trash=[122]; CONFIRM=()=>true;
  await EXTRA_OPS.kaisaTrashSpell({}, {p:0}, null);
  ok('카이사+시간 왜곡: 추방 상태 유지, 덱 밑 재활용 없음, 추가 턴은 부여', G.players[0].banish.includes(122) && !G.players[0].deck.includes(122) && (G.extraTurns||[]).includes(0), 'banish='+JSON.stringify(G.players[0].banish));
  fresh(); G.players[0].points=G.victory-1; G.players[0].trash=[129]; CONFIRM=()=>true;
  await EXTRA_OPS.kaisaTrashSpell({}, {p:0}, null);
  ok('카이사+일반 주문: 해결 후 덱 맨 아래로 재활용', G.players[0].deck[G.players[0].deck.length-1]===129 && !G.players[0].trash.includes(129) && G.players[0].hand.length===1, '');

  // ══ ④ 도전(128) + 다리우스(27): 도전 피해가 먼저, +2는 해결 뒤 (#5184, 이미 수정됨 확인) ══
  fresh(); G.players[0].playedCards=1; const dar=unit(27,0,0); const en=unit(219,1,0);
  PICK=(u,t)=>/아군/.test(t)?u===dar:u===en;
  await play(128,0);
  ok('도전+다리우스: 적은 5 피해(7 아님), 다리우스는 해결 뒤 +2', en.dmg===5 && might(dar)===7, 'dmg='+en.dmg+' m='+might(dar));

  // ── 맞대결(129): 이번 턴 토큰도 준비 등장 (#8620) ──
  fresh(); await play(129,0);
  await execOps([{op:'token',count:1,might:1,name:'Recruit',where:'base'}], {p:0});
  ok('맞대결: 신병 토큰 준비 등장', everyUnit().some(u=>u.isToken&&u.ex===false), '');
  fresh(); await execOps([{op:'token',count:1,might:1,name:'Recruit',where:'base'}], {p:0});
  ok('(대조) 맞대결 없이는 탈진 등장', everyUnit().some(u=>u.isToken&&u.ex===true), '');

  // ── 크라켄 사냥꾼(150): 버프 할인이 [가속] 힘까지 (#4836) ──
  fresh(); const buffed=unit(210,0,'base',{buff:3}); G.players[0].runes=[]; Object.keys(G.players[0].power).forEach(k=>G.players[0].power[k]=0);
  NUM=()=>3; CONFIRM=t=>/가속/.test(t);
  await play(150,0);
  ok('크라켄 사냥꾼: 버프 3개로 가속 힘까지 0 → 가속 지불·준비 등장', CONFIRMS.some(t=>/가속/.test(t)) && find(0,150) && find(0,150).ex===false && buffed.buff===0, JSON.stringify(CONFIRMS)+' ex='+(find(0,150)||{}).ex);

  // ══ ⑤ 파괴 공작(156): 비유닛 후보가 있으면 취소 불가 (#4264) ══
  fresh(); G.players[1].hand=[129,210]; OPT=()=>null;
  await play(156,0);
  ok('파괴 공작: 취소해도 비유닛 카드 재활용', !G.players[1].hand.includes(129) && G.players[1].deck[G.players[1].deck.length-1]===129, 'hand='+JSON.stringify(G.players[1].hand));

  // ── 눈부신 오로라(160): 플레이할 수 없는 유닛(잔혹한 후원자 208 — 처치할 아군 없음)은 추방 유지 (#6096) ──
  fresh(); gear(160,0); G.players[0].deck.unshift(208);
  await endTurn();
  ok('오로라: 강제 추가 비용 불가 → 추방 상태, 기지 배치 없음', G.players[0].banish.includes(208) && !find(0,208), 'banish='+JSON.stringify(G.players[0].banish)+' onBoard='+!!find(0,208));

  // ── 티모 - 전략가(121) vs 죽음꽃 포식자(161): [굴절] 지불 (#3529) ──
  fresh(); G.bfs[0].controller=0; const teemo=unit(121,0,0); unit(161,1,0); CONFIRM=t=>/굴절/.test(t); const pw0=powerSum(0);
  await EXTRA_OPS.teemoDefend({}, {p:0, unit:teemo}, null);
  ok('티모: 포식자 대상 → 굴절 1 지불', CONFIRMS.some(t=>/굴절/.test(t)) && powerSum(0)===pw0-1, JSON.stringify(CONFIRMS)+' pw='+powerSum(0));
  fresh(); G.bfs[0].controller=0; const teemo2=unit(121,0,0); const pred=unit(161,1,0); CONFIRM=()=>false;
  await EXTRA_OPS.teemoDefend({}, {p:0, unit:teemo2}, null);
  ok('티모: 굴절 거부 시 피해 없음', pred.dmg===0, 'dmg='+pred.dmg);

  // ══ ⑥ 타곤의 정상(289): 종료 단계 진입 후 정복은 룬 준비 없음 (#5875) ══
  fresh(); G._endingTurn={p:0};
  await EXTRA_OPS.targonConquer({}, {p:0}, null);
  ok('타곤: 종료 단계 중 정복 → 플래그 없음', !(TF().readyRunesAtEnd[0]), 'flag='+TF().readyRunesAtEnd[0]);
  G._endingTurn=null; await EXTRA_OPS.targonConquer({}, {p:0}, null);
  ok('타곤: 행동 단계 정복 → 2', TF().readyRunesAtEnd[0]===2, 'flag='+TF().readyRunesAtEnd[0]);

  // ── 세트 - 싸움꾼(164) + 히라나 수도원(282): 정복으로 얻은 버프는 비용으로 못 낸다 (#8738) ──
  fresh([282,297]); openSd(0,true); const sett=unit(164,0,0); unit(210,1,0); CONFIRM=()=>true;
  await resolve();
  ok('세트+히라나: 정복 버프 획득, 버프 소모 프롬프트 없음, 드로우 없음', sett.buff===1 && !CONFIRMS.some(t=>/버프를 소모/.test(t)) && G.players[0].hand.length===0 && G.bfs[0].controller===0,
    'buff='+sett.buff+' '+JSON.stringify(CONFIRMS)+' ctrl='+G.bfs[0].controller);
  fresh([282,297]); openSd(0,true); const sett2=unit(164,0,0,{buff:1}); unit(210,1,0); CONFIRM=()=>true;
  await resolve();
  ok('세트+히라나: 기존 버프는 소모 가능 → 드로우', CONFIRMS.some(t=>/버프를 소모/.test(t)) && G.players[0].hand.length===1, JSON.stringify(CONFIRMS));

  // ══ ⑦ 질책(172): 장착 도구는 분리되어 기지로 (#1391 · #9348) ══
  fresh(); const eq=unit(210,1,0,{gear:[160],gearCtrl:[1]}); PICK=u=>u===eq;
  await play(172,0);
  ok('질책: 유닛은 손패, 장착 도구는 B 기지에 준비 상태', G.players[1].hand.includes(210) && G.players[1].gear.some(g=>g.n===160&&!g.ex) && !G.players[1].hand.includes(160), 'gear='+JSON.stringify(G.players[1].gear));
  fresh(); const dy=unit(210,1,0,{gear:[160],gearCtrl:[1]});
  await killUnit(dy);
  ok('사망: 장착 도구 폐기 아님 → 기지로 회수', G.players[1].gear.some(g=>g.n===160) && !G.players[1].trash.includes(160), 'gear='+JSON.stringify(G.players[1].gear)+' trash='+JSON.stringify(G.players[1].trash));
  // ── 빙의(203)로 뺏은 유닛의 사망 → 원 소유자 폐기장 (#2250) ──
  fresh(); const stolen=unit(210,0,0,{owner:1});
  await killUnit(stolen);
  ok('빙의 유닛 사망: 소유자(B) 폐기장', G.players[1].trash.includes(210) && !G.players[0].trash.includes(210), '');

  // ── 은밀한 추적자(177): 기지에서 탈진 상태여도 동행 (#2230) · 효과 이동(바람 타기)에도 동행 (#6119) ──
  fresh(); const pur=unit(177,0,'base',{ex:true}); const mv=unit(210,0,'base'); CONFIRM=t=>/함께 이동/.test(t);
  await moveUnits(0,[mv],0);
  ok('추적자: 기지 출발·탈진 상태에서도 동행', pur.loc===0 && mv.loc===0, 'pur='+pur.loc);
  fresh(); const pur2=unit(177,0,0,{ex:true}); const rider=unit(210,0,0); CONFIRM=t=>/함께 이동/.test(t); PICK=u=>u===rider;
  OPT=(t,o)=>{ const m=o.find(x=>x.movement&&x.movement.uid===rider.uid&&x.movement.dest===1); return m?m.v:o[0].v; };
  await play(173,0);
  ok('추적자: 바람 타기 효과 이동에도 동행', rider.loc===1 && pur2.loc===1, 'rider='+rider.loc+' pur='+pur2.loc);

  // ══ ⑧ 희미해지는 기억(180): 도구에 [일시적] → 통제자 개시 단계에 처치 (#6709) ══
  fresh(); gear(181,1); OPT=(t,o)=>{ const g=o.find(x=>/도구/.test(x.label)); return g?g.v:o[0].v; };
  await play(180,0);
  ok('희미해지는 기억: 도구에 [일시적] 부여', G.players[1].gear[0] && G.players[1].gear[0].temporary===true, '');
  G.turn=1; await startTurn();
  ok('희미해지는 기억: B 개시 단계에 도구 처치', G.players[1].gear.length===0 && G.players[1].trash.includes(181), 'gear='+G.players[1].gear.length);

  // ── 경이의 꾸러미(181): 장착 도구도 회수 (#10398) ──
  fresh(); gear(181,0); const wearer=unit(210,0,'base',{gear:[160],gearCtrl:[0]}); OPT=(t,o)=>{ const g=o.find(x=>/장착 도구/.test(x.label)); return g?g.v:o[0].v; };
  await EXTRA_OPS.wonderBundle({}, {p:0}, null);
  ok('꾸러미: 장착 도구를 분리해 손패로', G.players[0].hand.includes(160) && wearer.gear.length===0, 'hand='+JSON.stringify(G.players[0].hand));

  // ── 회오리바람(187): 각자 어느 유닛이든 — B가 A의 포식자를 되돌려도 굴절 없음 (#3563 · #9057) ──
  fresh(); const myPred=unit(161,0,0); unit(219,1,0);
  OPT=(t,o,p)=>{ if(p===1){ const x=o.find(x=>x.returnHand&&x.returnHand.uid===myPred.uid); return x?x.v:o[0].v; } const none=o.find(x=>x.v===null); return none?none.v:o[0].v; };
  await play(187,0);
  ok('회오리바람: 상대가 내 포식자를 되돌림, 굴절 프롬프트 없음', G.players[0].hand.includes(161) && !onBoard(myPred) && !CONFIRMS.some(t=>/굴절/.test(t)), 'hand='+JSON.stringify(G.players[0].hand));

  // ══ ⑨ 괴롭히는 밤(198) + 애니 - 고집쟁이(310): 밤이 먼저 폐기장에 → 애니가 회수 가능 (#6899) ══
  fresh(); G.players[0].trash=[310]; OPT=(t,o)=>{ if(/손패로 가져올/.test(t)){ const x=o.find(x=>x.v===198); return x?x.v:o[0].v; } return o[0].v; };
  await play(198,0);
  ok('괴롭히는 밤+애니: 밤을 손패로 회수, 폐기장에 이중 사본 없음', find(0,310) && G.players[0].hand.includes(198) && !G.players[0].trash.includes(198), 'hand='+JSON.stringify(G.players[0].hand)+' trash='+JSON.stringify(G.players[0].trash));

  // ── 물결을 바꾸는 자(199) + 바일마우의 둥지(295): 부분 해결 (#7241) ──
  fresh([295,297]); const lair=unit(210,0,0);
  OPT=(t,o)=>{ const m=o.find(x=>x.movement); return m?m.v:o[0].v; };
  await play(199,0);
  ok('물결을 바꾸는 자: 자신은 둥지로 이동, 상대 유닛은 기지로 못 나감', find(0,199) && find(0,199).loc===0 && lair.loc===0, 'tt='+(find(0,199)||{}).loc+' u='+lair.loc);

  // ══ ⑩ 시간선 역전(201): 시전자부터 번아웃 → 7:7이면 시전자가 진다 (#8457) ══
  fresh(); G.turn=1; G.actingPlayer=1; G.players[0].points=G.victory-1; G.players[1].points=G.victory-1;
  G.players[0].deck=[210,210,210]; G.players[1].deck=[210,210,210]; G.players[0].trash=[210,210,210,210,210]; G.players[1].trash=[210,210,210,210,210];
  await play(201,1);
  ok('시간선 역전: B 시전 → B가 먼저 번아웃 → A 승리', G.winner===0, 'winner='+G.winner);

  // ── 등을 맞대고(206): 아군 2기 미만이면 플레이 불가, 2기면 둘 다 +2 (#1462) ──
  fresh(); unit(210,0,0);
  const r1=await play(206,0);
  ok('등을 맞대고: 아군 1기 → 플레이 불가', r1===false && G.players[0].hand.includes(206), 'r='+r1);
  fresh(); const b1=unit(210,0,0), b2=unit(219,0,'base'); PICK=(u,t)=>/1\\/2/.test(t)?u===b1:u===b2;
  const r2=await play(206,0);
  ok('등을 맞대고: 아군 2기 → 각각 +2', r2===true && might(b1)===4 && might(b2)===6, 'm='+might(b1)+','+might(b2));

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack||e.message));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-batch6.js' });
