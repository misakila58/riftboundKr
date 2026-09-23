// 온라인 락스텝 어긋남·잠김 제보를 서버·계정 없이 재현하는 브라우저 스니펫 (2026-09-23, 떠돌이 상인 패스 불가 제보 조사에 사용)
//
// 쓰는 법
//  1) client/web 을 정적 서버로 띄운다:  cd client/web && python -m http.server 8777
//  2) 브라우저 탭 두 개에서 http://localhost:8777/ 을 연다 (같은 출처여야 BroadcastChannel 로 서로 이어진다)
//  3) 각 탭 콘솔에 이 파일 내용을 붙여 넣고, 좌석 1 탭에서 먼저 lockstep(1), 그 다음 좌석 0 탭에서 lockstep(0) 을 부른다
//     (좌석 0이 먼저 선택 응답을 보내므로 좌석 1 탭이 먼저 듣고 있어야 한다)
//  4) 게임 시작은 두 가지 —
//     · 실제 시작 절차(주사위·멀리건·턴 시작 연출)까지 재현: 각 탭에서 startOnlineGame(startMsg(seat, D1, D2)) 을 좌석 1 → 0 순으로
//     · 특정 국면부터: 서버 리플레이(.rbr)의 상태 스냅샷(rpLoad(...).states[i])을 JSON 으로 client/web 에 두고 두 탭에서 loadState(url, maxUid+1)
//       (리플레이 상태는 '_'로 시작하는 키가 빠져 있다 — _pendingTriggers 등은 비어 있다고 가정)
//  5) 이후 한쪽 탭에서 UI 로 행동(이동·플레이·패스)하면 서버 에코와 같은 경로(NET._enqueueAction / NET._resolveChoice)로 양쪽에 전달된다.
//     양쪽의 NET.choiceSeq · Object.keys(NET.pendingChoices) 가 항상 같아야 한다 — 다르면 선택 순번 어긋남(락스텝 붕괴).
//  6) 잠김 진단: UI.canShowdownPass() · UI.passBlockReason() · UI.isPicking() · _turnGlowPick · _resolver · NET.processing · NET.actionQueue
//
// 주의: 서버 릴레이가 없으므로 양쪽이 동시에 보내면 순서가 뒤섞일 수 있다 — 한 번에 한 탭만 조작할 것.

function lockstep(SEAT, channel='rb-lockstep'){
  window.SEAT=SEAT;
  NET.online=true; NET.seat=SEAT; NET.userId='P'+(SEAT+1); NET.token='x'; NET.spectating=false;
  const bc=new BroadcastChannel(channel); window.__bc=bc;
  const deliver=m=>{ if(m.t==='act') NET._enqueueAction(m); else if(m.t==='choice') NET._resolveChoice(m); };
  NET.ws={readyState:1, send:str=>{
    const m=JSON.parse(str); if(m.t!=='act' && m.t!=='choice') return;
    const out={t:m.t, seat:SEAT, from:'P'+(SEAT+1)};
    if(m.t==='act') out.action=m.action; else { out.id=m.id; out.data=m.data; }
    bc.postMessage(out); deliver(out);
  }};
  bc.onmessage=e=>deliver(e.data);
  NET.resetGameSync();
  return 'lockstep seat '+SEAT;
}
// 서버의 startMsg 와 같은 모양. 덱은 {legendN, champN, main[40], runes[12], bfs[3], arts}
function startMsg(seat, D1, D2, seed=777){
  return {t:'start', seed, yourSeat:seat, spectate:false, manual:false, banRule:false, format:'bo1', sideboarded:true,
    players:[{id:'P1',deck:D1},{id:'P2',deck:D2}]};
}
// 리플레이 상태 스냅샷을 그대로 G 로 (두 탭 모두 같은 파일·같은 uid 로)
async function loadState(url, nextUid){
  const s=await (await fetch(url+'?x='+Date.now())).json();
  G=s; UID=nextUid; G.players.forEach(P=>{ P.name='P'+(P.idx+1); });
  showScreen('game-screen'); UI.render(); UI.promptForState();
  return {turn:G.turn, acting:G.actingPlayer, state:G.state, seq:NET.choiceSeq};
}
// 두 탭에서 같은 값이어야 하는 동기화 지표
function lockstepStatus(){
  return {seq:NET.choiceSeq, pending:Object.keys(NET.pendingChoices), early:Object.keys(NET.earlyChoices), processing:NET.processing,
    queue:NET.actionQueue.length, state:G&&G.state, acting:G&&G.actingPlayer, canPass:UI.canShowdownPass(), why:UI.passBlockReason(),
    picking:UI.isPicking(), glow:!!(_turnGlowPick&&_turnGlowPick.game===G), resolver:!!_resolver};
}
