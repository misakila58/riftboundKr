// 되돌리기(undo.js) 회귀 테스트 — 봇전: 사람 행동 직전 사본 → 되돌리면 그 행동과 뒤따른 상태 변화가 모두 사라지고, 다시 해도 같은 결과(난수 상태 복원)
// 온라인: 양쪽이 모든 행동 직전에 같은 사본을 쌓고 {k:'undo'}는 맨 위 사본의 행동자가 요청자일 때만 적용 (2026-10-02)
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '../../client/web/js');
const r = f => fs.readFileSync(path.join(JS, f), 'utf8');
const BOOT = `
if(typeof globalThis.withBattlefieldSource==='undefined') globalThis.withBattlefieldSource=(s,fn)=>fn();
var LOGS=[];
var UI = { log(m){ LOGS.push(String(m)); }, render(){}, toast(){}, promptForState(){}, fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:()=>Promise.resolve(false), revealAurora:()=>Promise.resolve(), pickBoardOrder:(p,t,o)=>Promise.resolve(o.map((_,i)=>i)),
  pickUnitFrom:(p,c)=>Promise.resolve(c[0]||null), pickOption:(p,t,o)=>Promise.resolve(o[0].v), pickReaction:()=>Promise.resolve(null),
  pickNumber:(p,t,mn,mx)=>Promise.resolve(mx), pickBuffs:()=>Promise.resolve([]), pickHandCard:()=>Promise.resolve(0), pickMulligan:()=>Promise.resolve([]),
  isPicking(){return false;}, logEntryEl(){return null;}, prompt(){}, promptShowdown(){}, manualNotice(){}, showVictory(){}, inspect(){}, inspectUnit(){}, hideZoom(){}, showZoom(){} };
var NET = { online:false, seat:null, choiceSeq:0, pendingChoices:{}, lastStart:null, dispatch(a,fn){ if(fn) return fn(); }, _execAction:async function(a){ EXEC.push(a.k); } };
var EXEC=[];
var REPLAY = { viewing:false, recording:false, capture(){}, _onNewGame(){}, _onVictory(){} };
var BUILDINFO = { version:'test', built:'' };
var BOT = { active:true, seat:1, busy:false, ctx:null };
var document = { getElementById:()=>({ style:{ display:'none' }, remove(){} }), addEventListener(){}, querySelector:()=>null };
var window = { addEventListener(){} };
var setInterval = ()=>0;
function pendingCombatMove(){ return null; } function cancelCombatMove(){} function closeModal(){} function clearPicking(){}
var _moveArmed=false, _moveSel=new Set(), _resolver=null, _pickableUids=null, _boardCardPick=null, _reactionPick=null;
`;
const TEST = `
var withBattlefieldSource=(s,fn)=>fn();
compileAllCards();
let pass=0,fail=0; const ok=(n,c,i)=>{ if(c){pass++;} else {fail++; console.log('  ✗ FAIL:',n,i||'');} };
function fresh(){
  seedRng(11);
  newGame({seed:11,manual:false,bfs:[280,297],players:[{name:'나',legendN:253,champN:27,deck:Array(39).fill(210),runes:Array(12).fill(7)},{name:'봇',legendN:265,champN:112,deck:Array(39).fill(210),runes:Array(12).fill(7)}]});
  G.turn=0;G.phase='action';G.state='neutral';G.turnCount=5;G.actingPlayer=0;
  G.players.forEach(P=>{P.hand=[];P.energy=20;Object.keys(P.power).forEach(k=>P.power[k]=9);});
}
const unit=(n,p,loc)=>{ const u=makeUnit(n,p,{loc,ready:true}); placeUnit(u,loc); return u; };
const sig=()=>JSON.stringify({t:G.turn,tc:G.turnCount,pts:G.players.map(P=>P.points),hand:G.players.map(P=>P.hand.length),deck:G.players.map(P=>P.deck.length),
  units:everyUnit().map(u=>[u.uid,u.ctrl,u.loc,u.ex,u.dmg]).sort((a,b)=>a[0]-b[0]), uid:UID, rng:_rngState});
(async()=>{
  // ① 봇전: 이동 → 되돌리기 → 이동 전 상태 그대로
  fresh(); BOT.active=true; NET.online=false;
  const a=unit(210,0,'base'); const s0=sig();
  ok('① 처음엔 되돌릴 것 없음', UNDO.stack.length===0);
  await NET.dispatch({k:'move',p:0,uids:[a.uid],dest:0}, ()=>moveUnits(0,[a],0));
  ok('① 이동함', a.loc===0, 'loc='+a.loc);
  ok('① 사본 1개', UNDO.stack.length===1);
  ok('① 되돌리기 가능', undoAvailable());
  UI.undo();
  ok('① 되돌린 뒤 상태 = 이동 전', sig()===s0, sig()+' vs '+s0);
  ok('① 되돌린 G의 유닛은 기지 (새 객체)', everyUnit().find(u=>u.uid===a.uid).loc==='base');
  ok('① 로그 남김', LOGS.some(l=>/되돌리기/.test(l)));
  // ② 턴 종료(드로우·상대 턴 진행 포함) → 되돌리기 → 다시 턴 종료 = 같은 결과 (난수 상태 복원)
  fresh(); G.players.forEach(P=>{ P.deck=Array.from({length:20},(_,i)=>[210,64,173,311][i%4]); });
  const t0=sig();
  await NET.dispatch({k:'endTurn'}, ()=>endTurn());
  const t1=sig();
  ok('② 턴이 넘어감', G.turn===1, 'turn='+G.turn);
  UI.undo();
  ok('② 되돌리면 턴 종료 전', sig()===t0, sig()+' vs '+t0);
  await NET.dispatch({k:'endTurn'}, ()=>endTurn());
  ok('② 다시 해도 같은 결과(드로우 동일)', sig()===t1, sig()+' vs '+t1);
  // ③ 여러 번 되돌리기 (스택 순서)
  fresh(); const b=unit(210,0,'base'); const c=unit(210,0,'base'); const m0=sig();
  await NET.dispatch({k:'move',p:0,uids:[b.uid],dest:0}, ()=>moveUnits(0,[b],0)); const m1=sig();
  await NET.dispatch({k:'move',p:0,uids:[c.uid],dest:1}, ()=>moveUnits(0,[everyUnit().find(u=>u.uid===c.uid)],1));
  UI.undo(); ok('③ 한 번 되돌리면 첫 이동 뒤', sig()===m1);
  UI.undo(); ok('③ 두 번 되돌리면 처음', sig()===m0);
  ok('③ 더는 없음', !undoAvailable());
  // ④ 새 게임이면 비움
  await NET.dispatch({k:'move',p:0,uids:[b.uid],dest:0}, ()=>moveUnits(0,[everyUnit().find(u=>u.uid===b.uid)],0));
  fresh(); ok('④ 새 게임 → 스택 비움', UNDO.stack.length===0);
  // ⑤ 온라인(되돌리기 허용 방): 모든 행동 직전 사본, 맨 위가 요청자 행동일 때만 적용
  fresh(); BOT.active=false; NET.online=true; NET.seat=0; NET.lastStart={undo:true}; UNDO.clear();
  const d=unit(210,0,'base'); const o0=sig(); NET.choiceSeq=3;
  await NET._execAction({k:'move',p:0,uids:[d.uid],dest:0}); moveUnits(0,[d],0);   // 실제 실행은 원래 _execAction 대신 직접
  ok('⑤ 사본 쌓임 (행동자 0)', UNDO.stack.length===1 && UNDO.stack[0].actor===0);
  NET.choiceSeq=9;
  await NET._execAction({k:'undo',p:1});
  ok('⑤ 상대(1)의 되돌리기 요청은 무시', UNDO.stack.length===1 && d.loc===0);
  await NET._execAction({k:'undo',p:0});
  ok('⑤ 내 되돌리기 적용 → 이동 전', sig()===o0 && UNDO.stack.length===0, sig()+' vs '+o0);
  ok('⑤ 선택 번호도 복원', NET.choiceSeq===3, 'seq='+NET.choiceSeq);
  NET.lastStart={undo:false}; await NET._execAction({k:'move',p:0,uids:[d.uid],dest:0});
  ok('⑤ 허용 안 된 방은 사본 안 쌓음', UNDO.stack.length===0);
  console.log(pass+'/'+(pass+fail)+' 통과'+(fail?' ← 실패 '+fail:''));
})().catch(e=>console.log('CRASH',e.stack));
`;
const src = [BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'), r('undo.js'), TEST].join('\n;\n');
vm.runInContext(src, vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, globalThis }), { filename: 'test-undo.js' });
