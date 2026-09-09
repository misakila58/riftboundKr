// RiftJudge 감사 3차 묶음(work-3.json) 검증:
//  ① 결전 정리 — 무혈 결전은 치유 없음(142.4·437), 전투 사망 [죽음의 종소리]는 치유 뒤 해결(322), 동시 사망 존야 선택권(376.3 원칙),
//     '전투 중' 대상은 전투 결전만(437), 솔라리 무승부=양측 잔존, 칙령+치명 피해 2회 처치, 클린업 반복(322), 약자 도태 동시 사망(376.3.b)
//  ② 공격/방어 지정 — 전투가 있어야 지정(378·전투 1단계): 무혈 결전 합류 방어자의 [공격 시] 없음·전환 시 공격자 [공격 시],
//     한 전투 1회, 예지의 가면은 전투에서만·장수만큼·지정 순간 스냅샷
//  ③ 유닛 주체 피해(kind 'unit', 405~406) — 불굴의 정신이 못 막고 서적 보너스 없음·전투 중 지정 보정 포함
//  ④ 불멸의 불사조 — 피해 주문의 클린업 사망(416)·자기 유닛 처치(376.2.c)·단두대 지연 처치·장수만큼·통제 전장 배치
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
var withBattlefieldSource=(s,fn)=>fn();   // 전장 격발(fireBfTrigger)이 쓰는 UI 래퍼 — vm 전역에 직접 둔다
compileAllCards();
let pass=0,fail=0; const ok=(n,c,i)=>{ if(c){pass++;} else {fail++; console.log('  ✗ FAIL:',n,i||'');} };
function fresh(bfs){
  seedRng(6);
  newGame({seed:6,manual:false,bfs:bfs||[280,297],players:[{name:'A',legendN:253,champN:27,deck:Array(39).fill(210),runes:Array(12).fill(7)},{name:'B',legendN:265,champN:112,deck:Array(39).fill(210),runes:Array(12).fill(214)}]});
  G.turn=0;G.phase='action';G.state='neutral';G.turnCount=5;G.actingPlayer=0;
  G.players.forEach(P=>{P.hand=[];P.energy=20;Object.keys(P.power).forEach(k=>P.power[k]=9);});
  PICK=null; OPT=null; NUM=null; CONFIRM=()=>false; PICKS.length=0; OPTS.length=0; NUMS.length=0; CONFIRMS.length=0;
}
function openSd(attacker, hasCombat){ attacker=attacker||0; G.state='showdown'; G.actingPlayer=attacker;
  G.showdown={bfIdx:0,attacker,defender:opp(attacker),hasCombat:hasCombat!==false,passes:0,chain:[],chainStarter:null}; }
const onBoard=u=>everyUnit().includes(u);
const unit=(n,p,loc,o)=>{ const u=makeUnit(n,p,{loc,ready:true}); placeUnit(u,loc); Object.assign(u,o||{}); return u; };
const gear=(n,p)=>{ G.players[p].gear.push({n,ex:false,attachedTo:null}); };
const play=async(n,p)=>{ p=p||0; G.players[p].hand=[n]; return await playCardFromHand(p,0,{}); };
const resolve=async()=>{ await showdownPass(); await showdownPass(); };
const tempSum=u=>u.tempM.reduce((s,t)=>s+t.v,0);
(async()=>{
  // ══ ① 결전 정리 ══
  // ── 무혈 결전은 치유하지 않는다(142.4·437) / 전투 결전은 전장 밖 유닛까지 치유 ──
  fresh();
  let x=unit(219,0,'base',{dmg:1}), y=unit(210,0,'base');
  await moveUnits(0,[y],0);
  ok('무혈 결전 개시(hasCombat=false)', G.showdown && G.showdown.hasCombat===false, JSON.stringify(G.showdown&&G.showdown.hasCombat));
  await resolve();
  ok('무혈 결전 종료: 치유 없음', x.dmg===1 && G.state==='neutral', 'dmg='+x.dmg);
  fresh(); openSd();
  x=unit(219,0,'base',{dmg:1}); unit(219,0,0); unit(210,1,0);
  await resolve();
  ok('전투 결전 종료: 전장 밖 유닛도 치유', x.dmg===0, 'dmg='+x.dmg);

  // ── 전투 사망 [죽음의 종소리]는 치유 뒤에 해결 — 코그모(190) 종소리 4가 살아남은 공격자를 죽인다(#7226·#10750) ──
  fresh(); openSd();
  const poro=unit(210,0,0), kog=unit(190,1,0);
  await resolve();
  ok('종소리: 코그모 사망', !onBoard(kog));
  ok('종소리: 치유 뒤 종소리 4피해로 포로 사망(예전엔 치유에 지워짐)', !onBoard(poro), 'poro dmg='+poro.dmg+' onBoard='+onBoard(poro));

  // ── 동시 사망 + 존야(77): 통제자가 구할 유닛을 고른다(#10768·#8618) ──
  fresh(); gear(77,0);
  const za=unit(210,0,0,{dmg:2}), zb=unit(219,0,0,{dmg:4});
  PICK=u=>u===zb;
  await cleanup(0);
  ok('존야: 구할 유닛을 물었다', PICKS.some(t=>/존야/.test(t)), JSON.stringify(PICKS));
  ok('존야: 고른 유닛(두 번째)이 회수·첫 유닛은 사망', zb.loc==='base' && onBoard(zb) && !onBoard(za) && G.players[0].gear.length===0, 'zb.loc='+zb.loc+' za='+onBoard(za));
  fresh(); gear(77,0);
  const zc=unit(210,0,0,{dmg:2});
  await cleanup(0);
  ok('존야: 하나만 죽으면 묻지 않고 대체', PICKS.length===0 && zc.loc==='base' && onBoard(zc), JSON.stringify(PICKS));

  // ── '전투 중'(where:'combat')은 전투 결전만(#11269 포탄 세례) ──
  fresh(); openSd(1,false); unit(176,1,0);
  ok('무혈 결전: 전투 중인 적 없음', unitsBySpec({side:'enemy',where:'combat'},0).length===0);
  G.showdown.hasCombat=true;
  ok('전투 결전: 전투 중인 적 1', unitsBySpec({side:'enemy',where:'combat'},0).length===1);

  // ── 솔라리의 상징(227): 무승부 = 양측 잔존 → 전원 귀환·통제 변동 없음(#10142) ──
  fresh(); openSd(); gear(227,0); G.bfs[0].controller=1;
  const sa=unit(219,0,0,{stunned:true}), sb=unit(219,1,0,{stunned:true});
  await resolve();
  ok('솔라리: 양측 잔존 무승부 → 모두 기지 귀환', sa.loc==='base' && sb.loc==='base' && onBoard(sa) && onBoard(sb), 'sa='+sa.loc+' sb='+sb.loc);
  ok('솔라리: 득점·통제 변경 없음', G.players[0].points===0 && G.bfs[0].controller!==0, 'pts='+G.players[0].points+' ctrl='+G.bfs[0].controller);
  fresh(); openSd(); gear(227,0);
  const sc=unit(210,0,0), sd_=unit(219,1,0);
  await resolve();
  ok('솔라리: 전멸은 무승부가 아니다 — 사망 정상 처리', !onBoard(sc) && onBoard(sd_), 'sc='+onBoard(sc));

  // ── 황제의 칙령(221) + 치명 피해: 존야가 첫 사망을 막아도 칙령이 다시 처치(#7440) / 비치명이면 생존(#8420) ──
  fresh(); gear(77,0); TF().dmgKill=true; TF().dmgKillBy=1;
  const da=unit(210,0,'base'); dealDamage(da,5,'spell');
  await cleanup(0);
  ok('칙령+치명: 존야 소모 후 다시 처치', !onBoard(da) && G.players[0].gear.length===0, 'onBoard='+onBoard(da)+' gear='+G.players[0].gear.length);
  fresh(); gear(77,0); TF().dmgKill=true; TF().dmgKillBy=1;
  const db=unit(219,0,'base'); dealDamage(db,1,'spell');
  await cleanup(0);
  ok('칙령+비치명: 존야가 구한다', onBoard(db) && db.dmg===0 && G.players[0].gear.length===0, 'onBoard='+onBoard(db));

  // ── 클린업 반복(322): 리 신(151) 오라 소실로 치명이 된 유닛은 같은 클린업에서 죽는다(#6390) ──
  fresh();
  const lee=unit(151,1,0,{dmg:6}), fan=unit(210,1,0,{buff:1,dmg:4});
  ok('리 신 오라: 버프 유닛 5⚔', might(fan)===5, 'm='+might(fan));
  await cleanup(1);
  ok('클린업 반복: 리 신 사망 → 오라 소실 → 같은 클린업에서 함께 사망', !onBoard(lee) && !onBoard(fan), 'fan='+onBoard(fan));

  // ── 약자 도태(209): 각자 고른 뒤 한 배치로 사망 — 두 종소리 모두 해결(#9900) ──
  fresh();
  const ca=unit(96,0,'base'), cb=unit(96,1,'base'); const d0=G.players[0].deck.length, d1=G.players[1].deck.length;
  await play(209);
  ok('약자 도태: 양측 유닛 사망 + 각자 종소리 드로우', !onBoard(ca) && !onBoard(cb) && G.players[0].deck.length===d0-1 && G.players[1].deck.length===d1-1, 'd0 '+d0+'→'+G.players[0].deck.length);

  // ══ ② 공격/방어 지정 ══
  // ── 무혈 결전에 바람 타기로 합류한 야스오(76)는 방어자 — [공격 시] 없음(#278) ──
  fresh();
  const a1=unit(219,0,'base'); await moveUnits(0,[a1],0);
  const ys=unit(76,1,'base'); await effectMove(1, ys, 0);
  ok('무혈 결전 합류 방어자: [공격 시] 미격발', a1.dmg===0, 'dmg='+a1.dmg);
  await resolve();
  ok('무혈→전투 전환: 공격자는 경합 적용자(A)', G.showdown && G.showdown.hasCombat && G.showdown.attacker===0, JSON.stringify(G.showdown&&[G.showdown.attacker,G.showdown.hasCombat]));
  ok('전환 뒤에도 방어자 야스오 [공격 시] 없음', a1.dmg===0, 'dmg='+a1.dmg);
  // ── 반대로 먼저 빈 전장에 들어간 야스오는 전투 전환 때 [공격 시]가 난다(#9303) ──
  fresh();
  const ya=unit(76,0,'base'); await moveUnits(0,[ya],0);
  const b1=unit(219,1,'base'); await effectMove(1, b1, 0);
  ok('무혈 결전 중엔 아직 [공격 시] 없음', b1.dmg===0, 'dmg='+b1.dmg);
  await resolve();
  ok('전투 전환 시 공격자 야스오 [공격 시] 6피해', b1.dmg===6, 'dmg='+b1.dmg);
  // ── 한 전투에서 [공격 시]는 한 번 — 나갔다 다시 들어와도 재격발 없음(#2091) ──
  fresh(); G.bfs[0].controller=1;   // 통제자의 유닛은 경합을 걸지 않는다 — 진입하는 A가 공격자
  const t1=unit(219,1,0), t2=unit(219,1,0); const yb=unit(76,0,'base'); PICK=u=>u===t1;
  await moveUnits(0,[yb],0);
  ok('적 전장 진입 → 전투 결전 + [공격 시]', G.showdown && G.showdown.hasCombat && t1.dmg===6, 'dmg='+t1.dmg);
  await effectMove(0, yb, 'base'); await effectMove(0, yb, 0);
  ok('재진입: [공격 시] 재격발 없음', t2.dmg===0 && t1.dmg===6, 't2='+t2.dmg);
  // ── 진행 중인 전투에 합류한 방어자 티모(121)의 [방어 시] 격발(#5199·#9174) ──
  fresh(); openSd(1); unit(219,1,0); G.bfs[0].controller=0;
  const tm=unit(121,0,'base'); await effectMove(0, tm, 0);
  ok('전투 중 합류한 방어측 유닛: [방어 시] 격발(덱 5장 공개 프롬프트)', PICKS.some(t=>/대상 적 유닛/.test(t)), JSON.stringify(PICKS));
  // ── 예지의 가면(60): 무혈 결전엔 없음(#4707) · 장수만큼(#6946) · 약탈자의 거리 귀환 전 스냅샷(#8304) ──
  fresh(); gear(60,0); gear(60,0);
  const m1=unit(219,0,'base'); await moveUnits(0,[m1],0);
  ok('가면: 무혈 결전엔 +0', tempSum(m1)===0, 'temp='+tempSum(m1));
  await resolve();
  fresh(); gear(60,0); gear(60,0); unit(210,1,0);
  const m2=unit(219,0,'base'); await moveUnits(0,[m2],0);
  ok('가면 2장: 혼자 공격 +2', tempSum(m2)===2, 'temp='+tempSum(m2));
  fresh([285,297]); gear(60,1); G.bfs[0].controller=1;
  const r1=unit(219,1,0), r2=unit(219,1,0); const m3=unit(210,0,'base');
  await moveUnits(0,[m3],0);
  ok('약탈자의 거리: 방어 유닛 하나 귀환', (r1.loc==='base')!==(r2.loc==='base'), 'r1='+r1.loc+' r2='+r2.loc);
  ok('가면: 귀환 전 스냅샷(둘이었으므로) +0', tempSum(r1)===0 && tempSum(r2)===0, 'temp='+tempSum(r1)+'/'+tempSum(r2));

  // ══ ③ 유닛 주체 피해 ══
  // ── 도전(128): 불굴의 정신(145)이 못 막고, 레이븐본 서적 보너스도 안 붙는다(#8394·#8373) ──
  fresh(); TF().preventSpellDmg=true; TF().nextSpellBonus[0]=1;
  const c1=unit(219,0,'base'), c2=unit(210,1,0); G.players[0].trash.push(37); CONFIRM=()=>true;
  await play(128);
  ok('도전: 불굴의 정신에도 서로 피해(서적 보너스 없음)', c1.dmg===2 && !onBoard(c2), 'c1.dmg='+c1.dmg+' c2='+onBoard(c2));
  ok('도전 처치는 주문 처치가 아니다 — 불사조 미격발', !CONFIRMS.some(t=>/폐기장/.test(t)), JSON.stringify(CONFIRMS));
  // ── 신사의 결투(308)·최후의 숨결(260): 유닛 주체 피해 ──
  fresh(); TF().preventSpellDmg=true;
  const g1=unit(219,0,'base'), g2=unit(210,1,0);
  await play(308);
  ok('신사의 결투: 불굴의 정신에도 피해(+3 반영)', g1.dmg===2 && !onBoard(g2), 'g1.dmg='+g1.dmg);
  fresh(); TF().preventSpellDmg=true;
  unit(219,0,'base',{ex:true}); const l2=unit(210,1,0);
  await play(260);
  ok('최후의 숨결: 유닛이 주는 피해는 방지되지 않음', !onBoard(l2), 'l2 onBoard');
  // ── 전투 중 도전은 지정 보정([맹공]) 포함 위력(#5261) ──
  fresh(); openSd();
  const p1=unit(210,0,0), p2=unit(219,1,0);
  await play(128); await resolve();
  ok('결전 중 도전: 공격자 [맹공] +1 반영 → 적 3피해', p2.dmg===3, 'dmg='+p2.dmg);

  // ══ ④ 불멸의 불사조(37) ══
  // ── 피해 주문(마법공학 광선 9)의 클린업 사망도 주문 처치(416·#3101) ──
  fresh(); G.players[0].trash.push(37); CONFIRM=()=>true; unit(210,1,0);
  await play(9);
  ok('광선 처치 → 불사조 프롬프트', CONFIRMS.some(t=>/불멸의 불사조.*폐기장/.test(t)), JSON.stringify(CONFIRMS));
  ok('불사조 폐기장에서 플레이됨', !G.players[0].trash.includes(37) && allUnits(0).some(u=>u.n===37), 'trash='+JSON.stringify(G.players[0].trash));
  // ── 자기 불사조를 숨겨진 칼날(213)로 처치해도 격발(376.2.c·#9024) ──
  fresh(); CONFIRM=()=>true;
  const ph=unit(37,0,0); PICK=u=>u===ph;
  await play(213);
  ok('자기 유닛 처치: 불사조 재플레이', !onBoard(ph) && allUnits(0).some(u=>u.n===37 && u!==ph) && !G.players[0].trash.includes(37), 'trash='+JSON.stringify(G.players[0].trash));
  // ── 여러 장이면 각각(#6871) ──
  fresh(); G.players[0].trash.push(37,37); CONFIRM=()=>true; unit(210,1,0);
  await play(9);
  ok('불사조 2장: 두 번 묻고 둘 다 플레이', CONFIRMS.filter(t=>/폐기장/.test(t)).length===2 && allUnits(0).filter(u=>u.n===37).length===2, JSON.stringify(CONFIRMS));
  // ── 단두대(254) 지연 처치도 주문 처치(#7364) ──
  fresh(); G.players[0].trash.push(37); CONFIRM=()=>true;
  const gu=unit(210,1,0);
  await play(254);
  ok('단두대: 표식만', onBoard(gu) && gu._guillotine===true && CONFIRMS.length===0, 'g='+gu._guillotine);
  dealDamage(gu,1,'combat'); await cleanup(0);
  ok('단두대 표식 처치 → 불사조 격발', !onBoard(gu) && allUnits(0).some(u=>u.n===37), JSON.stringify(CONFIRMS));
  // ── 방어 중인 통제 전장에도 배치 가능(#10688) ──
  fresh(); openSd(1); G.bfs[0].controller=0; unit(219,0,0); unit(210,1,0);
  G.players[0].trash.push(37); CONFIRM=()=>true; let locOpts=null; OPT=(t,o)=>{ if(/위치/.test(t)) locOpts=o; return o[0].v; };
  await play(9); await resolve();
  ok('방어 중: 불사조 배치 선택지에 통제 전장 포함', locOpts && locOpts.some(o=>o.v===0) && locOpts.some(o=>o.v==='base'), JSON.stringify(locOpts&&locOpts.map(o=>o.v)));

  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack||e.message));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-batch3.js' });
