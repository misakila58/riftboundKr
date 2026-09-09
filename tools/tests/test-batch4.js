// RiftJudge 감사 4차 묶음(work-4.json) 검증 — 덱·폐기장·효과로 '플레이'하는 경로의 정식 플레이(playCardFromHand) 통일:
//  ① 차원문 구출(102) — 등장 준비(워윅)·[가속] 선택·소유자가 기지에 플레이(에라타)·플레이 이벤트(시트리아)·토큰은 소멸(182)
//  ② 미끼 바늘(242)·증원(62) — [가속]·추가 비용(잔혹한 후원자, 불가 시 추방 유지)·비워진 통제 전장 배치·다리우스 '두 번째 카드'·증원 할인은 가속 에너지까지(#5164)
//  ③ 유망한 미래(115) — 힘 비용 지불(불가 시 후보 제외)·배치 위치·주문 플레이 이벤트(럭스 전설)·도구 등장 격발·브린히르 금지 시 추방 유지·카르마 재활용 격발은 플레이 뒤
//  ④ 시간 왜곡(122) — 추가 턴 큐(2장 = 2턴, 양측 각 1장)
//  ⑤ 스프라이트 부름(94) — 손패에서 내면 기지/통제 전장 선택 · 보석세공 예언자(100) — 토큰마다 [통찰]
//  ⑥ 녹턴(194) — 조작된 덱(183)·[통찰]에서 추방 → ✳ 지불 플레이
//  ⑦ 눈부신 오로라 2장 + 죽음꽃 포식자(161) — 종료 격발을 모두 해결한 뒤 결전 개시(342.1.b · #9290)
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '../../client/web/js');
const r = f => fs.readFileSync(path.join(JS, f), 'utf8');
const BOOT = `
if(typeof globalThis.withBattlefieldSource==='undefined') globalThis.withBattlefieldSource=(s,fn)=>fn();
var PICK=null;        // pickUnitFrom 선택 함수 (null이면 적 전장 유닛 우선)
var OPT=null;         // pickOption 선택 함수 (title, options)→v (null이면 첫 항목)
var NUM=null;         // pickNumber 선택 함수 (null이면 최댓값)
var CONFIRM=()=>false; // confirmP 응답 함수(prompt)
var PICKS=[], OPTS=[], NUMS=[], CONFIRMS=[], OPTLIST=[];   // 프롬프트 기록
var UI = { log(){}, render(){}, toast(){}, fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:(p,t)=>{ CONFIRMS.push(String(t||'')); return Promise.resolve(!!CONFIRM(String(t||''),p)); },
  pickUnitFrom:(p,c,t)=>{ PICKS.push(String(t||'')); return Promise.resolve(PICK ? (c.find(u=>PICK(u))||c[0]) : (c.find(u=>u.ctrl===1&&u.loc!=='base')||c[0])); },
  pickOption:(p,t,o)=>{ OPTS.push(String(t||'')); OPTLIST.push({t:String(t||''),o,p,state:G.state}); return Promise.resolve(OPT ? OPT(String(t||''),o,p) : o[0].v); },
  pickReaction:()=>Promise.resolve(null),
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
  PICK=null; OPT=null; NUM=null; CONFIRM=()=>false; PICKS.length=0; OPTS.length=0; NUMS.length=0; CONFIRMS.length=0; OPTLIST.length=0;
}
function openSd(attacker, hasCombat){ attacker=attacker||0; G.state='showdown'; G.actingPlayer=attacker;
  G.showdown={bfIdx:0,attacker,defender:opp(attacker),hasCombat:hasCombat!==false,passes:0,chain:[],chainStarter:null}; }
const onBoard=u=>everyUnit().includes(u);
const unit=(n,p,loc,o)=>{ const u=makeUnit(n,p,{loc,ready:true}); placeUnit(u,loc); Object.assign(u,o||{}); return u; };
const gear=(n,p)=>{ G.players[p].gear.push({n,ex:false,attachedTo:null}); };
const play=async(n,p)=>{ p=p||0; G.players[p].hand=[n]; return await playCardFromHand(p,0,{}); };
const resolve=async()=>{ await showdownPass(); await showdownPass(); };
const find=(p,n)=>allUnits(p).find(u=>u.n===n);
const locOpts=t=>OPTLIST.filter(x=>x.t===t).map(x=>x.o.map(o=>o.v));
(async()=>{
  // ══ ① 차원문 구출(102) ══
  // ── 워윅(159)은 준비 등장(#8348) · 시트리아(139)는 '유닛 플레이'를 본다(#5416 취지) ──
  fresh();
  let ww=unit(159,0,0,{ex:true,dmg:2}), cit=unit(139,0,'base'); PICK=u=>u===ww;
  await play(102);
  let ww2=find(0,159);
  ok('차원문: 워윅 새 객체로 기지에 준비 등장', ww2 && ww2!==ww && ww2.loc==='base' && ww2.ex===false && ww2.dmg===0, ww2&&JSON.stringify({loc:ww2.loc,ex:ww2.ex}));
  ok('차원문: 시트리아 버프(onYouPlayUnit)', cit.buff===1, 'buff='+cit.buff);
  ok('차원문: 플레이 이벤트 반영(playedCards)', G.players[0].playedCards>=1, 'played='+G.players[0].playedCards);
  // ── [가속] 선택 가능(#7891) — 군단 후위병(10) ──
  fresh(); const lr=unit(10,0,'base',{ex:true}); PICK=u=>u===lr; CONFIRM=t=>/가속/.test(t);
  await play(102);
  ok('차원문: [가속] 추가 비용을 묻고 지불하면 준비 등장', CONFIRMS.some(t=>/가속/.test(t)) && find(0,10).ex===false, JSON.stringify(CONFIRMS));
  // ── 빙의로 뺏은 유닛은 소유자가 자기 기지에 플레이(에라타 #8127) ──
  fresh(); const st=unit(210,0,0,{owner:1}); PICK=u=>u===st;
  await play(102);
  ok('차원문: 소유자(B) 기지로 돌아가 B가 통제', !onBoard(st) && find(1,210) && find(1,210).loc==='base' && !find(0,210), 'A='+!!find(0,210)+' B='+!!find(1,210));
  // ── 토큰은 고를 수 있지만 소멸(#2895) ──
  fresh(); const tk=makeUnit(0,0,{loc:'base',isToken:true,tokenMight:1,tokenName:'Recruit'}); placeUnit(tk,'base'); PICK=u=>u===tk;
  await play(102);
  ok('차원문: 토큰 추방 → 소멸(재소환 없음)', !onBoard(tk) && allUnits(0).length===0, 'units='+allUnits(0).length);

  // ══ ② 미끼 바늘(242) · 증원(62) ══
  // ── 미끼 바늘: [가속] 선택(#10924) · 비워진 통제 전장에 배치 가능(#10517) ──
  fresh(); G.bfs[0].controller=0; const bait=unit(210,0,0); PICK=u=>u===bait; CONFIRM=t=>/가속/.test(t);
  G.players[0].deck.unshift(10,210,210,210,210);
  OPT=(t,o)=>{ if(/배치할 위치/.test(t)) return 0; return o[0].v; };
  await EXTRA_OPS.luredHook({}, {p:0}, null);
  ok('미끼 바늘: 후위병 추방 후 플레이 — [가속] 묻고 준비 등장', CONFIRMS.some(t=>/가속/.test(t)) && find(0,10) && find(0,10).ex===false, JSON.stringify(CONFIRMS));
  ok('미끼 바늘: 비워진 통제 전장이 배치 후보에 있고 거기 배치', locOpts('유닛을 배치할 위치').some(l=>l.includes(0)) && find(0,10).loc===0, JSON.stringify(locOpts('유닛을 배치할 위치'))+' loc='+find(0,10).loc);
  ok('미끼 바늘: 남은 4장 재활용', G.players[0].deck.slice(0,1)[0]===210 && !G.players[0].banish.includes(10), 'banish='+JSON.stringify(G.players[0].banish));
  // ── 잔혹한 후원자(208): 추가 비용(아군 처치)을 내야 하고, 아군이 없으면 추방 유지(#5989) ──
  fresh(); const only=unit(159,0,'base'); PICK=u=>u===only;   // 워윅(5⚔) 처치 → 위력 6까지
  G.players[0].deck.unshift(208,210,210,210,210);
  await EXTRA_OPS.luredHook({}, {p:0}, null);
  ok('미끼 바늘: 잔혹한 후원자 — 처치할 아군이 없어 플레이 실패 → 추방 유지', !find(0,208) && G.players[0].banish.includes(208) && !G.players[0].hand.includes(208), 'banish='+JSON.stringify(G.players[0].banish)+' hand='+JSON.stringify(G.players[0].hand));
  fresh(); const v1=unit(159,0,'base'), v2=unit(210,0,'base'); PICK=u=>u===v1 ? true : u===v2;
  G.players[0].deck.unshift(208,210,210,210,210);
  await EXTRA_OPS.luredHook({}, {p:0}, null);
  ok('미끼 바늘: 잔혹한 후원자 — 남은 아군을 추가 비용으로 처치하고 등장', find(0,208) && !onBoard(v1) && !onBoard(v2), 'v2='+onBoard(v2)+' 208='+!!find(0,208));
  // ── 다리우스(27)를 미끼 바늘로 내면 '두 번째 카드'로 자기 준비(#8008) ──
  fresh(); G.players[0].playedCards=1; const d0=unit(159,0,'base'); PICK=u=>u===d0;
  G.players[0].deck.unshift(27,210,210,210,210);
  await EXTRA_OPS.luredHook({}, {p:0}, null);
  ok('미끼 바늘: 다리우스 두 번째 카드 → 준비', find(0,27) && find(0,27).ex===false, 'ex='+(find(0,27)&&find(0,27).ex));
  // ── 증원(62): 통제 전장 선택(#2074) · 할인은 [가속] 에너지까지(#5164) — 크라켄 사냥꾼(150, 3에너지) ──
  fresh(); G.bfs[0].controller=0; unit(210,0,0); G.players[0].deck.unshift(150,210,210,210,210);
  G.players[0].energy=5; CONFIRM=t=>/가속/.test(t);
  await play(62);
  ok('증원: 크라켄 사냥꾼 [가속] 등장, 가속 에너지도 할인(에너지 5→0)', find(0,150) && find(0,150).ex===false && G.players[0].energy===0, 'e='+G.players[0].energy+' ex='+(find(0,150)&&find(0,150).ex));
  ok('증원: 통제 전장이 배치 후보에 포함', locOpts('유닛을 배치할 위치').some(l=>l.includes(0)), JSON.stringify(locOpts('유닛을 배치할 위치')));

  // ══ ③ 유망한 미래(115) ══
  // ── 상대: 시간 왜곡(122) → 상대 추가 턴 큐 · 나: 미래의 용광로(212) → 신병 토큰(등장 격발) · 럭스 전설(321) 5비용 주문 드로우(#7470) ──
  fresh(); G.players[0].legendN=321;
  G.players[0].deck.unshift(212,210,210,210,210); G.players[1].deck.unshift(122,210,210,210,210);
  OPT=(t,o)=>{ if(/추방\\(플레이 예약\\)/.test(t)) return o.find(x=>x.v===212||x.v===122).v; return o[0].v; };
  const h0=G.players[0].hand.length;
  await play(115);
  ok('유망한 미래: 상대 시간 왜곡 → 추가 턴 큐에 상대', G.extraTurns && G.extraTurns.includes(1), JSON.stringify(G.extraTurns));
  ok('유망한 미래: 시간 왜곡은 추방(banishSelf)', G.players[1].banish.includes(122) && !G.players[1].trash.includes(122), 'banish='+JSON.stringify(G.players[1].banish));
  ok('유망한 미래: 용광로 도구 등장 격발 → 신병 토큰', G.players[0].gear.some(g=>g.n===212) && allUnits(0).some(u=>u.isToken), 'tokens='+allUnits(0).filter(u=>u.isToken).length);
  ok('유망한 미래: 럭스 전설 — 5비용 주문 플레이로 드로우', G.players[0].hand.length>=h0+1, 'hand='+G.players[0].hand.length);
  // ── 힘을 낼 수 없으면 후보에서 제외(#3727) — 다리우스(27, 힘 1) ──
  fresh(); G.players[1].runes=[]; Object.keys(G.players[1].power).forEach(k=>G.players[1].power[k]=0);
  G.players[1].deck.unshift(27,210,210,210,210);
  await play(115);
  ok('유망한 미래: 힘 비용 못 내는 다리우스는 후보에서 제외되고 5장 재활용', !find(1,27) && !G.players[1].banish.includes(27) && G.players[1].deck.includes(27), 'banish='+JSON.stringify(G.players[1].banish));
  // ── 브린히르(26) 금지 중인 상대는 추방만 하고 플레이 못 함(#6039) ──
  fresh(); TF().noPlay[1]=true; G.players[1].deck.unshift(210,210,210,210,210);
  await play(115);
  ok('유망한 미래: 브린히르 금지 → 상대 카드는 추방 상태로 남음', !find(1,210) && G.players[1].banish.includes(210) && !G.players[1].hand.includes(210), 'banish='+JSON.stringify(G.players[1].banish)+' hand='+JSON.stringify(G.players[1].hand));
  // ── 카르마(235): 재활용 격발은 플레이가 끝난 뒤 → 새 유닛도 버프 후보(#3319) ──
  fresh(); unit(235,0,'base'); G.players[0].deck.unshift(219,210,210,210,210);
  OPT=(t,o)=>{ if(/추방\\(플레이 예약\\)/.test(t)&&o.some(x=>x.v===219)) return 219; return o[0].v; };
  PICK=u=>u.n===219;
  await play(115);
  ok('유망한 미래: 카르마 버프 대상에 새 유닛 포함', find(0,219) && find(0,219).buff===1, 'buff='+(find(0,219)&&find(0,219).buff));
  // ── 배치 위치 선택(#3804): 통제 전장 후보 ──
  fresh(); G.bfs[1].controller=0; unit(210,0,1); G.players[0].deck.unshift(219,210,210,210,210);
  OPT=(t,o)=>{ if(/추방\\(플레이 예약\\)/.test(t)&&o.some(x=>x.v===219)) return 219; if(/배치할 위치/.test(t)) return 1; return o[0].v; };
  await play(115);
  ok('유망한 미래: 유닛을 통제 전장에 배치', find(0,219) && find(0,219).loc===1, 'loc='+(find(0,219)&&find(0,219).loc));

  // ══ ④ 시간 왜곡(122) 큐 ══
  fresh(); await play(122); await play(122);
  ok('시간 왜곡 2장 → 추가 턴 2개', G.extraTurns.length===2, JSON.stringify(G.extraTurns));
  await endTurn();
  ok('첫 추가 턴: 여전히 A의 턴', G.turn===0 && G.extraTurns.length===1, 'turn='+G.turn+' q='+JSON.stringify(G.extraTurns));
  G.phase='action'; G.state='neutral';
  await endTurn();
  ok('둘째 추가 턴: 여전히 A', G.turn===0 && G.extraTurns.length===0, 'turn='+G.turn);
  G.phase='action'; G.state='neutral';
  await endTurn();
  ok('추가 턴 소진 후 B의 턴', G.turn===1, 'turn='+G.turn);

  // ══ ⑤ 스프라이트 부름(94) · 보석세공 예언자(100) ══
  fresh(); G.bfs[0].controller=0; unit(210,0,0);
  OPT=(t,o)=>{ if(/토큰을 배치할 위치/.test(t)) return 0; return o[0].v; };
  await play(94);
  ok('스프라이트 부름: 기지/통제 전장 선택 → 전장에 준비 스프라이트', locOpts('토큰을 배치할 위치').length===1 && G.bfs[0].units.some(u=>u.isToken&&u.tokenName==='Sprite'&&!u.ex), JSON.stringify(locOpts('토큰을 배치할 위치')));
  fresh(); openSd(1); G.bfs[0].controller=0; unit(219,0,0); unit(210,1,0);
  OPT=(t,o)=>{ if(/토큰을 배치할 위치/.test(t)) return 0; return o[0].v; };
  await play(94); await resolve();
  ok('스프라이트 부름: 방어 중 결전 전장에 직접 소환', G.bfs[0].units.some(u=>u.isToken&&u.tokenName==='Sprite'), 'units='+G.bfs[0].units.map(u=>unitName(u)).join(','));
  fresh(); unit(100,0,'base');
  await play(315);
  ok('예언자 오라: 신병 4기 각각 [통찰]', CONFIRMS.filter(t=>/통찰/.test(t)).length===4, JSON.stringify(CONFIRMS));

  // ══ ⑥ 녹턴(194) ══
  fresh(); G.players[0].deck.unshift(194,210,219); CONFIRM=t=>/녹턴/.test(t);
  await play(183);
  ok('조작된 덱: 녹턴 추방 → ✳ 지불 플레이, 손패 1장은 별개', find(0,194) && G.players[0].hand.length===1 && G.players[0].hand[0]!==194, 'hand='+JSON.stringify(G.players[0].hand));
  fresh(); G.players[0].deck.unshift(194); CONFIRM=t=>/녹턴/.test(t);
  await play(171);
  ok('[통찰]로 본 녹턴도 플레이', find(0,194) && !CONFIRMS.some(t=>/덱 맨 위/.test(t)), JSON.stringify(CONFIRMS));
  fresh(); G.players[0].deck.unshift(194,210,219); CONFIRM=()=>false;
  await play(183);
  ok('녹턴 거절 시 손패 후보에 남음', !find(0,194) && OPTLIST.some(x=>/손패에 넣을/.test(x.t)&&x.o.some(o=>o.v===194)), '');

  // ══ ⑦ 오로라 2장 + 죽음꽃 포식자 — 결전은 종료 격발을 모두 해결한 뒤(#9290) ══
  fresh(); gear(160,0); gear(160,0); G.bfs[0].controller=1; unit(210,1,0);
  G.players[0].deck.unshift(161,161);
  OPT=(t,o)=>{ if(/유닛을 배치할 위치/.test(t)){ const e=o.find(x=>/적 전장/.test(x.label)); return e?e.v:o[0].v; } return o[0].v; };
  await endTurn();
  const auroraStates=OPTLIST.filter(x=>/유닛을 배치할 위치/.test(x.t)).map(x=>x.state);
  ok('오로라 2장: 두 번째 오로라도 결전 전(중립)에 해결', auroraStates.length===2 && auroraStates.every(s=>s==='neutral'), JSON.stringify(auroraStates));
  ok('오로라 2장: 포식자 둘 다 적 전장에 → 결전 개시', G.state==='showdown' && G.bfs[0].units.filter(u=>u.n===161).length===2, 'state='+G.state+' n='+G.bfs[0].units.filter(u=>u.n===161).length);

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack||e.message));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-batch4.js' });
