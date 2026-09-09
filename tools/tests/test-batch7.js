// RiftJudge 감사 7차 묶음(work-7.json, 카드 #207~#315) 검증 — 헤드리스(vm) 엔진 테스트
//  ① 영광의 부름(207) — 추가 비용(버프 소모) 직후 클린업: 치명 피해 유닛은 주문 해결 전에 죽는다(319.6 · #10458)
//  ② 미래의 용광로(212) — 재활용 대상은 발동 시점(자기 자신 제외 · #11013), 상대 [반응] 응수 창(#5445)
//  ③ 미끼 바늘(242) — 발동 시점 대상·응수 뒤 대상 소실/존야 구원 → 5장 보고 전부 재활용(#11249 · #8203)
//  ④ 안면 분쇄(220) — 한쪽 대상이 사라져도 남은 쪽은 기절(356.3.e · #10273)
//  ⑤ 황제의 칙령(221) — 기절 유닛 처치의 귀속은 칙령 시전자(416 · #5587)
//  ⑥ 레드로스 사령관(231) — 존야로 살아난 유닛은 할인에서 제외(415.5.c · #377)
//  ⑦ 신성한 심판(244) — 보드 전체에서 턴 플레이어부터 고르고 합집합만 남김(#5977 · #3107)
//  ⑧ 이케시아 소나기(248) — 격발마다 클린업(319.7 · #6282) · 존야 두 번 죽이기 · 꿈꾸는 나무 미격발(#386) · 카이사 굴절(#4616)
//  ⑨ 초강력 초토화 로켓(252) — 폐기장의 장수만큼 격발(#6974)
//  ⑩ 여우불(256) — 고른 유닛마다 굴절(#7798) · 숨김에서 내면 그 전장만(737 · #7068)
//  ⑪ 최후의 숨결(260) — 적 대상 없으면 플레이 불가(352.8 · #5305)
//  ⑫ 힘 착취(266) — 최소 1 감소는 스냅샷(454.3.d.2 · #7780)
//  ⑬ 쌍권총 난사(268) — 힘 0 지불에도 관문 +1(#5791)
//  ⑭ 요새화된 진지(279) — 적 유닛에게도 [보호막 2] 가능(#5211)
//  ⑮ 히라나 수도원(282)·정복 격발 순서 — 정복 시점 버프 필요(#8738), 순서 선택(#10196 · #8242)
//  ⑯ 약탈자의 거리(285) — 무주공산 전장의 방어자(경합을 나중에 건 쪽)가 쓴다(#4985)
//  ⑰ 폭풍의 인장(287) — 재활용할 룬 선택·준비 룬은 먼저 탈진해 에너지 유지(#2810)
//  ⑱ 타곤의 정상(289) — 종료 단계 진입 후 정복은 룬 준비 없음(#7424)
//  ⑲ 꿈꾸는 나무(292) — 전장별 턴 1회(#9241)
//  ⑳ 바일마우의 둥지(295)+물결을 바꾸는 자 — 교환 일부만 실행(#7241)
//  ㉑ 공허의 관문(296) — 능력 피해(티모)도 +1(#3674)
//  ㉒ 점멸(311) — 기지 유닛도 대상(이동 없음 · #10257)
//  ㉓ 선봉대 소집(315) — 4기 같은 위치(#2710)
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
const unit=(n,p,loc,o)=>{ const u=makeUnit(n,p,{loc,ready:true}); placeUnit(u,loc); Object.assign(u,o||{}); return u; };
const gear=(n,p)=>{ const g={n,ex:false,attachedTo:null}; G.players[p].gear.push(g); return g; };
const play=async(n,p)=>{ p=p||0; G.players[p].hand=[n]; return await playCardFromHand(p,0,{}); };
const resolve=async()=>{ await showdownPass(); await showdownPass(); };
const find=(p,n)=>allUnits(p).find(u=>u.n===n);
const totalPower=p=>Object.values(G.players[p].power).reduce((a,b)=>a+b,0);
(async()=>{
  // ══ ① 영광의 부름(207) — 버프 소모 직후 클린업 ══
  fresh(); let s=unit(219,0,0,{buff:1,dmg:4}); PICK=u=>u===s; CONFIRM=t=>/추가 비용/.test(t);
  ok('영광의 부름: 플레이 가능(4피해 5위력 버프 유닛)', await play(207)===true);
  ok('영광의 부름: 버프 소모 직후 클린업으로 사망 — +3 전에 죽는다', !onBoard(s), 'onBoard='+onBoard(s)+' m='+(onBoard(s)?might(s):'-'));
  fresh(); s=unit(219,0,0,{buff:1,dmg:3}); PICK=u=>u===s; CONFIRM=t=>/추가 비용/.test(t);
  await play(207);
  ok('영광의 부름: 치명이 아니면 살아서 +3', onBoard(s) && might(s)===7, 'm='+(onBoard(s)?might(s):'-'));

  // ══ ② 미래의 용광로(212) ══
  fresh(); const forge=gear(212,0); G.players[0].trash=[210,219]; G.players[1].trash=[175]; G.players[1].hand=[311];
  const d0=G.players[0].deck.length;
  await activateAbility(0,{kind:'gear',g:forge},FX[212].activated[0]);
  const recOpts=OPTLIST.filter(x=>/재활용할 카드/.test(x.t));
  ok('용광로: 재활용 후보에 자기 자신(212)이 없다 — 발동 시점엔 보드에 있다', recOpts.length>0 && recOpts.every(x=>!x.o.some(o=>o.n===212)), JSON.stringify(recOpts.map(x=>x.o.map(o=>o.n))));
  ok('용광로: 자신은 폐기장에 남고 고른 3장은 재활용', G.players[0].trash.includes(212) && G.players[0].deck.length===d0+2 && G.players[1].trash.length===0, 'trash='+JSON.stringify(G.players[0].trash)+' deck+'+(G.players[0].deck.length-d0));
  ok('용광로: 발동에 상대 [반응] 응수 창이 열린다', REACTS.length===1 && /발동/.test(REACTS[0]), JSON.stringify(REACTS));
  fresh(); const forge2=gear(212,0); G.players[0].trash=[37]; G.players[1].hand=[311];
  REACT=()=>{ G.players[0].trash.splice(G.players[0].trash.indexOf(37),1); return null; };   // 응수로 불사조가 폐기장을 떠남
  const d1=G.players[0].deck.length;
  await activateAbility(0,{kind:'gear',g:forge2},FX[212].activated[0]);
  ok('용광로: 응수로 폐기장을 떠난 카드는 재활용되지 않는다(대상 고정)', G.players[0].deck.length===d1 && G.players[0].trash.length===1 && G.players[0].trash[0]===212, 'trash='+JSON.stringify(G.players[0].trash));

  // ══ ③ 미끼 바늘(242) ══
  fresh(); let hook=gear(242,0); let v=unit(210,0,'base'); G.players[1].hand=[311]; G.players[0].deck.unshift(210,210,210,210,210);
  const dl=G.players[0].deck.length;
  REACT=()=>{ removeUnit(v); v._dead=true; return null; };   // 응수로 대상이 제거됨
  await activateAbility(0,{kind:'gear',g:hook},FX[242].activated[0]);
  ok('미끼 바늘: 대상은 발동 시점 — 응수로 사라지면 5장 보고 전부 재활용, 유닛 플레이 없음', REACTS.length===1 && !OPTLIST.some(x=>/플레이할 유닛/.test(x.t)) && G.players[0].deck.length===dl && allUnits(0).length===0, 'deck='+G.players[0].deck.length+'/'+dl+' opts='+JSON.stringify(OPTS));
  fresh(); hook=gear(242,0); gear(77,0); v=unit(210,0,'base'); G.players[0].deck.unshift(219,210,210,210,210);
  await activateAbility(0,{kind:'gear',g:hook},FX[242].activated[0]);
  ok('미끼 바늘: 존야로 살아나면 "처치된 유닛"이 없어 유닛 플레이 없음', onBoard(v) && !OPTLIST.some(x=>/플레이할 유닛/.test(x.t)) && !find(0,219), 'v='+onBoard(v)+' opts='+JSON.stringify(OPTS));
  fresh(); hook=gear(242,0); v=unit(210,0,'base'); G.players[0].deck.unshift(219,210,210,210,210);
  OPT=(t,o)=>{ if(/플레이할 유닛/.test(t)) return 219; return o[0].v; };
  await activateAbility(0,{kind:'gear',g:hook},FX[242].activated[0]);
  ok('미끼 바늘: 정상 처치 → 위력+1(3) 이하 유닛 플레이 (회귀)', !onBoard(v) && !!find(0,219), 'units='+allUnits(0).map(u=>u.n).join(','));
  fresh(); hook=gear(242,0); const e0=G.players[0].energy;
  await activateAbility(0,{kind:'gear',g:hook},FX[242].activated[0]);
  ok('미끼 바늘: 아군이 없으면 발동 불가(비용 없음)', G.players[0].energy===e0 && !hook.ex, 'e='+G.players[0].energy+' ex='+hook.ex);

  // ══ ④ 안면 분쇄(220) — 한쪽 소실 시 남은 쪽만 기절 ══
  fresh(); openSd(0); let fa=unit(210,0,0), eb=unit(219,1,0);
  await play(220);
  removeUnit(eb); eb._dead=true;          // 응수로 적이 사라짐
  await resolve();
  ok('안면 분쇄: 적이 사라져도 아군은 기절(356.3.e)', fa.stunned===true, 'fa.stunned='+fa.stunned);
  fresh(); openSd(0); fa=unit(210,0,0); eb=unit(219,1,0);
  await play(220);
  removeUnit(fa); fa._dead=true;
  await resolve();
  ok('안면 분쇄: 아군이 사라져도 적은 기절(#10273)', eb.stunned===true, 'eb.stunned='+eb.stunned);

  // ══ ⑤ 황제의 칙령(221) — 기절 처치 귀속 ══
  fresh(); gear(72,1); G.turn=1; G.actingPlayer=1; let st=unit(210,0,0,{stunned:true}); unit(219,1,0);
  TF().dmgKill=true; TF().dmgKillBy=0;    // A가 칙령을 시전
  dealDamage(st,1,'combat'); await cleanupDeaths();
  ok('칙령: A의 칙령으로 죽은 A의 기절 유닛 — B의 솔라리 성소는 격발하지 않는다', !onBoard(st) && !CONFIRMS.some(t=>/솔라리|드로우|탈진/.test(t)), JSON.stringify(CONFIRMS));
  fresh(); gear(72,1); G.turn=1; G.actingPlayer=1; st=unit(210,0,0,{stunned:true}); unit(219,1,0);
  dealDamage(st,2,'combat'); await cleanupDeaths();
  ok('칙령 없음: 전투 피해로 죽은 기절 유닛 — B의 성소 격발(회귀)', !onBoard(st) && CONFIRMS.length>=1, JSON.stringify(CONFIRMS));

  // ══ ⑥ 레드로스 사령관(231) ══
  fresh(); let sac=unit(210,0,'base'); PICK=u=>u===sac; let o0=G.players[0].power.Order;
  ok('레드로스: 아군 1기 처치 → 질서 힘 3만 지불', await play(231)===true && G.players[0].power.Order===o0-3 && !onBoard(sac), 'Order '+o0+'→'+G.players[0].power.Order);
  fresh(); sac=unit(210,0,'base'); gear(77,0); PICK=u=>u===sac; o0=G.players[0].power.Order;
  ok('레드로스: 존야로 살아난 유닛은 처치가 아니다 → 힘 4 지불', await play(231)===true && onBoard(sac) && G.players[0].power.Order===o0-4, 'Order '+o0+'→'+G.players[0].power.Order+' alive='+onBoard(sac));

  // ══ ⑦ 신성한 심판(244) ══
  fresh(); const a1=unit(210,0,'base'), b1=unit(219,1,'base'), b2=unit(219,1,'base'), b3=unit(175,1,'base');
  gear(242,0); gear(72,1); gear(77,1); gear(160,1); G.players[1].hand=[210,219,175];
  G.players[0].runes=[{n:7,ex:false},{n:7,ex:false},{n:7,ex:true}]; G.players[1].runes=[{n:214,ex:false},{n:214,ex:false},{n:214,ex:true}];
  PICK=u=>{ const q=PICKS.length; if(q===1) return u===a1; if(q===2) return u===b1; if(q===3) return u===b3; return u===b2; };
  await play(244);
  ok('신성한 심판: 턴 플레이어(A)부터 보드 전체에서 2기 — 아군 1기뿐이면 상대 것도 고른다', PICKS.length===4 && /A: 남길 유닛/.test(PICKS[0]) && /B: 남길 유닛/.test(PICKS[2]), JSON.stringify(PICKS));
  ok('신성한 심판: 두 사람의 선택 합집합이 남는다 — B 3기 전부 유지', allUnits(0).length===1 && allUnits(1).length===3, 'A='+allUnits(0).length+' B='+allUnits(1).length);
  ok('신성한 심판: 도구도 보드 전체에서 2개씩 — 합집합 2개만 남음', G.players[0].gear.length===1 && G.players[1].gear.length===1 && G.players[1].gear[0].n===72, 'A='+G.players[0].gear.map(g=>g.n)+' B='+G.players[1].gear.map(g=>g.n));
  ok('신성한 심판: 손패는 자기 것 2장만', G.players[1].hand.length===2 && G.players[0].hand.length===0, 'B hand='+JSON.stringify(G.players[1].hand));
  ok('신성한 심판: 룬도 선택 합집합(A 2개 남음)', G.players[0].runes.length===2 && G.players[1].runes.length===0, 'A='+G.players[0].runes.length+' B='+G.players[1].runes.length);

  // ══ ⑧ 이케시아 소나기(248) ══
  fresh(); let t1=unit(219,1,0), t2=unit(175,1,0);
  await play(248);
  ok('소나기: 격발마다 클린업 — 4위력이 죽은 뒤 남은 격발은 다음 유닛으로(둘 다 사망)', !onBoard(t1) && !onBoard(t2), 't1='+onBoard(t1)+' t2='+onBoard(t2)+' dmg='+t1.dmg);
  fresh(); gear(77,1); t1=unit(219,1,0);
  await play(248);
  ok('소나기: 존야가 한 번 살려도 남은 격발로 다시 죽인다(#6282)', !onBoard(t1) && G.players[1].gear.length===0, 'alive='+onBoard(t1)+' gear='+G.players[1].gear.length);
  fresh([292,297]); let mine=unit(219,0,0); PICK=u=>u===mine;
  await play(248);
  ok('소나기: 반사 격발이 내 유닛을 골라도 「꿈꾸는 나무」 미격발(#386)', G.players[0].hand.length===0, 'hand='+G.players[0].hand.length);
  fresh([292,297]); mine=unit(219,0,0); PICK=u=>u===mine;
  await play(4);
  ok('꿈꾸는 나무: 일반 주문(가르기)이 고르면 드로우(회귀)', G.players[0].hand.length===1, 'hand='+G.players[0].hand.length);
  // 카이사 전설의 주문 전용 힘 — 일반 주문의 굴절엔 쓰고, 반사 격발의 굴절엔 못 쓴다
  fresh(); G.players[0].legendN=247; let df=unit(161,1,0); G.players[0].runes=[]; Object.keys(G.players[0].power).forEach(k=>G.players[0].power[k]=0); G.players[0].powerSpell=1; G.players[0].energy=5;
  PICK=u=>u===df; CONFIRM=t=>/굴절/.test(t);
  ok('카이사 전용 힘: 일반 주문(가르기)의 굴절 지불에 사용', await play(4)===true && G.players[0].powerSpell===0 && (effKw(df).assault||0)===3, 'ps='+G.players[0].powerSpell+' assault='+effKw(df).assault);
  fresh(); G.players[0].legendN=247; df=unit(161,1,0); G.players[0].runes=[]; Object.keys(G.players[0].power).forEach(k=>G.players[0].power[k]=0); G.players[0].powerSpell=1;
  CONFIRM=t=>/굴절/.test(t);
  const rfl=await payDeflect(0, df);                                   // 해결 시점(반사 격발·능력) 굴절 — 주문 비용이 아니다
  const pre=await payDeflect(0, df, {energy:0,pips:[],spellOK:true});  // 플레이 시점 굴절 — 주문 비용의 일부
  ok('카이사 전용 힘: 해결 시점 굴절(반사 격발)엔 못 쓰고, 플레이 시점 굴절엔 쓴다(#4616)', rfl===false && pre===true && G.players[0].powerSpell===0, 'rfl='+rfl+' pre='+pre+' ps='+G.players[0].powerSpell);

  // ══ ⑨ 초강력 초토화 로켓(252) ══
  fresh(); G.players[0].trash=[252,252,252]; G.players[0].hand=[210,219,175]; CONFIRM=t=>/회수/.test(t);
  await fireEvent('onConquerYou',{p:0,bfIdx:0});
  ok('로켓: 폐기장 3장 → 정복 1회에 3회 격발, 3장 모두 회수', CONFIRMS.filter(t=>/회수/.test(t)).length===3 && G.players[0].hand.filter(n=>n===252).length===3, 'hand='+JSON.stringify(G.players[0].hand)+' trash='+JSON.stringify(G.players[0].trash));
  fresh(); G.players[0].trash=[252,252,252]; G.players[0].hand=[210]; CONFIRM=t=>/회수/.test(t);
  await fireEvent('onConquerYou',{p:0,bfIdx:0});
  ok('로켓: 방금 회수한 로켓을 다음 격발의 버림 비용으로', CONFIRMS.filter(t=>/회수/.test(t)).length===3 && G.players[0].hand.length===1 && G.players[0].hand[0]===252, 'hand='+JSON.stringify(G.players[0].hand)+' trash='+JSON.stringify(G.players[0].trash));

  // ══ ⑩ 여우불(256) ══
  fresh(); let dfl=unit(210,1,0); dfl.grants.deflect=1; PICK=u=>u===dfl; CONFIRM=t=>/굴절/.test(t); let pw=totalPower(0);
  await play(256);
  ok('여우불: 고른 [굴절] 유닛마다 힘 1 지불 후 처치', !onBoard(dfl) && totalPower(0)===pw-1 && CONFIRMS.some(t=>/굴절/.test(t)), 'alive='+onBoard(dfl)+' power '+pw+'→'+totalPower(0));
  fresh(); dfl=unit(210,1,0); dfl.grants.deflect=1; PICK=u=>u===dfl; CONFIRM=()=>false;
  await play(256);
  ok('여우불: 굴절 지불 거부 → 처치 없음', onBoard(dfl), 'alive='+onBoard(dfl));
  fresh(); G.turnCount=5; let far=unit(210,1,1); G.bfs[0].controller=0; G.bfs[0].hiddenCards.push({n:256,by:0,turn:1});
  await playHidden(0,0);
  ok('여우불: 숨김에서 내면 그 전장의 유닛만(737) — 다른 전장 유닛은 후보 아님', onBoard(far) && G.bfs[0].hiddenCards.length===0, 'alive='+onBoard(far)+' hidden='+G.bfs[0].hiddenCards.length);

  // ══ ⑪ 최후의 숨결(260) — 적 대상 없으면 플레이 불가 ══
  fresh(); unit(210,0,'base',{ex:true});
  ok('최후의 숨결: 전장에 적이 없으면 플레이 불가(352.8)', await play(260)===false && G.players[0].hand.length===1, 'hand='+G.players[0].hand.length);
  fresh(); let ys=unit(210,0,'base',{ex:true}), en=unit(219,1,0); PICK=u=>u.ctrl===0?u===ys:u===en;
  ok('최후의 숨결: 아군·적 모두 있으면 플레이 — 준비 후 위력만큼 피해', await play(260)===true && ys.ex===false && en.dmg===2, 'ex='+ys.ex+' dmg='+en.dmg);

  // ══ ⑫ 힘 착취(266) — 최소 1 감소 스냅샷 ══
  fresh(); G.bfs[0].controller=1; const tok=makeUnit(0,1,{loc:0,isToken:true,tokenMight:1,tokenName:'Recruit'}); placeUnit(tok,0);
  OPT=(t,o)=>0;
  await play(266,0);
  ok('힘 착취: 1위력 적은 -0으로 고정', might(tok)===1, 'm='+might(tok));
  G.turn=1; G.actingPlayer=1; await play(266,1);
  ok('힘 착취: 이후 +1을 받으면 2 (스냅샷 · #7780)', might(tok)===2, 'm='+might(tok));

  // ══ ⑬ 쌍권총 난사(268) — 힘 0 + 관문 ══
  fresh([296,297]); let vg=unit(219,1,0); OPT=(t,o)=>0; NUM=()=>0;
  await play(268);
  ok('쌍권총 난사: 힘 0을 내도 관문의 +1 피해', vg.dmg===1, 'dmg='+vg.dmg);
  fresh([296,297]); vg=unit(219,1,0); OPT=(t,o)=>0; NUM=()=>0; TF().nextSpellBonus[0]=1;
  await play(268);
  ok('쌍권총 난사: 힘 0 + 관문 + 서적 = 2', vg.dmg===2, 'dmg='+vg.dmg);

  // ══ ⑭ 요새화된 진지(279) — 적 유닛에게도 보호막 ══
  fresh([279,297]); G.bfs[0].controller=1; let atk=unit(210,0,0), dfd=unit(219,1,0); PICK=u=>u===atk;
  await startShowdown(0,0,true);
  ok('요새화된 진지: 방어자가 적(공격) 유닛을 골라 [보호막 2] 부여 가능', (effKw(atk).shield||0)===2 && !(effKw(dfd).shield), 'atk.shield='+effKw(atk).shield);

  // ══ ⑮ 히라나 수도원(282) + 세트(164) — 정복 시점 버프 · 격발 순서 ══
  fresh([282,297]); G.bfs[0].controller=1; let sett=unit(164,0,0), vic=unit(210,1,0); openSd(0); CONFIRM=t=>/버프를 소모/.test(t);
  let h0=G.players[0].hand.length;
  await resolve();
  ok('수도원: 버프 없던 세트가 정복 — 정복으로 얻은 버프로는 드로우 불가(#8738)', G.bfs[0].controller===0 && sett.buff===1 && G.players[0].hand.length===h0 && !CONFIRMS.some(t=>/버프를 소모/.test(t)), 'buff='+sett.buff+' hand+'+(G.players[0].hand.length-h0)+' '+JSON.stringify(CONFIRMS));
  fresh([282,297]); G.bfs[0].controller=1; sett=unit(164,0,0,{buff:1}); vic=unit(210,1,0); openSd(0); CONFIRM=t=>/버프를 소모/.test(t); h0=G.players[0].hand.length;
  await resolve();
  ok('수도원: 순서 선택 프롬프트(전장 격발이 첫 선택지)', OPTLIST.some(x=>/정복 격발 해결 순서/.test(x.t) && /전장/.test(x.o[0].label)), JSON.stringify(OPTLIST.filter(x=>/정복 격발/.test(x.t)).map(x=>x.o.map(o=>o.label))));
  ok('수도원: 기존 버프 소모 → 드로우 → 세트 격발로 새 버프(#10196)', sett.buff===1 && G.players[0].hand.length===h0+1, 'buff='+sett.buff+' hand+'+(G.players[0].hand.length-h0));
  fresh([282,297]); G.bfs[0].controller=1; sett=unit(164,0,0,{buff:1}); vic=unit(210,1,0); openSd(0); CONFIRM=t=>/버프를 소모/.test(t); h0=G.players[0].hand.length;
  OPT=(t,o)=>{ if(/정복 격발 해결 순서/.test(t)){ const s=o.find(x=>/유닛/.test(x.label)); return s?s.v:o[0].v; } return o[0].v; };
  await resolve();
  ok('수도원: 세트를 먼저 해결하면 버프 중복 불가 → 수도원이 소모해 버프 0·드로우 1', sett.buff===0 && G.players[0].hand.length===h0+1, 'buff='+sett.buff+' hand+'+(G.players[0].hand.length-h0));

  // ══ ⑯ 약탈자의 거리(285) — 무주공산 전장의 방어자 ══
  fresh([285,297]); G.bfs[0].controller=null; let p1=unit(210,0,0); let p2=unit(219,1,0);
  ok('약탈자의 거리: 먼저 들어간 A가 경합 적용자', G.bfs[0].contestedBy===0);
  await cleanup(1);
  ok('약탈자의 거리: 통제자가 아니어도 방어자(B)가 유닛을 기지로(#4985)', G.state==='showdown' && G.showdown.defender===1 && p2.loc==='base', 'state='+G.state+' def='+(G.showdown&&G.showdown.defender)+' p2.loc='+p2.loc);

  // ══ ⑰ 폭풍의 인장(287) — 룬 선택·에너지 유지 ══
  fresh(); G.players[0].runes=[{n:7,ex:true},{n:7,ex:false},{n:7,ex:true}]; G.players[0].energy=0;
  await execOps([{op:'recycleRune'}],{p:0});
  ok('인장: 색이 같아도 어느 룬을 돌릴지 묻고(탈진 룬이 첫 선택지) 기본은 탈진 룬', OPTLIST.some(x=>/재활용할 룬/.test(x.t) && /탈진/.test(x.o[0].label)) && G.players[0].runes.length===2 && G.players[0].runes.some(r=>!r.ex) && G.players[0].energy===0, JSON.stringify(OPTLIST.map(x=>x.o.map(o=>o.label))));
  fresh(); G.players[0].runes=[{n:7,ex:true},{n:7,ex:false}]; G.players[0].energy=0;
  OPT=(t,o)=>{ const s=o.find(x=>/준비/.test(x.label)); return s?s.v:o[0].v; };
  await execOps([{op:'recycleRune'}],{p:0});
  ok('인장: 준비 룬을 돌리면 먼저 탈진해 에너지 1을 풀에 유지(#2810)', G.players[0].runes.length===1 && G.players[0].runes[0].ex && G.players[0].energy===1, 'e='+G.players[0].energy);

  // ══ ⑱ 타곤의 정상(289) ══
  fresh([289,297]); G._endingTurn={p:0};
  await fireBfTrigger(0,'onConquerHere',{p:0,bfIdx:0});
  ok('타곤의 정상: 종료 단계 진입 후 정복은 룬 준비 없음(#7424)', (TF().readyRunesAtEnd[0]||0)===0, 'n='+TF().readyRunesAtEnd[0]);
  G._endingTurn=null; await fireBfTrigger(0,'onConquerHere',{p:0,bfIdx:0});
  ok('타곤의 정상: 평소 정복은 2 (회귀)', (TF().readyRunesAtEnd[0]||0)===2, 'n='+TF().readyRunesAtEnd[0]);

  // ══ ⑲ 꿈꾸는 나무(292) — 전장별 ══
  fresh([292,292]); G.bfs[0].controller=0; G.bfs[1].controller=0; let ta=unit(210,0,0), tb=unit(219,0,1);
  PICK=u=>u===ta; await play(4); const hA=G.players[0].hand.length;
  PICK=u=>u===tb; await play(4); const hB=G.players[0].hand.length;
  PICK=u=>u===ta; await play(4); const hC=G.players[0].hand.length;
  ok('꿈꾸는 나무: 두 전장이 모두 나무면 전장마다 1장(#9241) — 같은 전장 두 번째는 없음', hA===1 && hB===1 && hC===0, [hA,hB,hC].join(','));

  // ══ ⑳ 바일마우의 둥지(295) + 물결을 바꾸는 자(199) ══
  fresh([295,297]); let lair=unit(210,0,0); OPT=(t,o)=>{ if(/배치할 위치/.test(t)) return 'base'; return o[0].v; };
  await play(199);
  const tt=find(0,199);
  ok('둥지: 교환 일부만 — 물결을 바꾸는 자는 둥지로, 둥지의 유닛은 기지로 못 감(#7241)', tt && tt.loc===0 && lair.loc===0, 'tt.loc='+(tt&&tt.loc)+' lair.loc='+lair.loc);

  // ══ ㉑ 공허의 관문(296) — 능력 피해 ══
  fresh([296,297]); let tm=unit(121,0,0), tg=unit(219,1,0); G.players[0].deck.unshift(256,220,210,210,210); PICK=u=>u===tg;
  await EXTRA_OPS.teemoDefend({}, {p:0, unit:tm, kind:'effect'}, {it:()=>null,setIt(){}});
  ok('관문: 티모의 능력 피해(숨김 2장)에도 +1 → 3', tg.dmg===3, 'dmg='+tg.dmg);

  // ══ ㉒ 점멸(311) — 기지 유닛 대상 ══
  fresh(); let bu=unit(210,0,'base');
  OPT=(t,o)=>{ const s=o.find(x=>/이동 없음/.test(x.label)); return s?s.v:(o.find(x=>x.v===null)?null:o[0].v); };
  ok('점멸: 기지의 유닛도 대상으로 고를 수 있다(이동 없음 · #10257)', await play(311)===true && OPTLIST.some(x=>x.o.some(o=>/이동 없음/.test(o.label))) && bu.loc==='base', JSON.stringify(OPTLIST.map(x=>x.o.map(o=>o.label))));

  // ══ ㉓ 선봉대 소집(315) — 같은 위치 ══
  fresh(); G.bfs[0].controller=0; OPT=(t,o)=>{ if(/배치할 위치/.test(t)) return 0; return o[0].v; };
  await play(315);
  ok('선봉대 소집: 위치를 한 번만 묻고 4기 모두 같은 곳(#2710)', OPTLIST.filter(x=>/배치할 위치/.test(x.t)).length===1 && G.bfs[0].units.filter(u=>u.isToken).length===4, 'prompts='+OPTLIST.filter(x=>/배치할 위치/.test(x.t)).length+' tokens='+G.bfs[0].units.filter(u=>u.isToken).length);

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack||e.message));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-batch7.js' });
