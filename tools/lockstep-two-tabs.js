// 온라인 락스텝·재접속(rejoin) 재현 하네스 — 서버·계정 없이 브라우저 탭 두 개로 (2026-09-24 재접속 기능 검증에 사용)
//
// 쓰는 법
//  1) cd client/web && python -m http.server 8777  → 탭 두 개에서 http://localhost:8777/ 을 연다 (같은 출처여야 BroadcastChannel 로 이어진다)
//  2) 각 탭 콘솔에 이 파일 내용을 붙여 넣고, 좌석 1 탭에서 __lock(1) → 좌석 0 탭에서 __lock(0) 순으로 부른다 (좌석 0 탭이 서버 역할: 로그 보관·중계·rejoin 응답)
//  3) 좌석 0 탭에서 __startGame() — 실제 서버처럼 start 를 배포하고 사이드보딩 핸드셰이크(rematch/rematchGo)부터 흘러간다
//  4) 끊김 흉내: 좌석 1 탭에서 __bc.postMessage({kind:'away'}) 뒤 그 탭을 새로고침 → 다시 이 파일 붙여 넣고 __lock(1); NET.reconnecting=true; NET.ws.send(JSON.stringify({t:'rejoin'}))
//     → 서버 탭이 start(rejoin)+로그+rejoinDone 을 내려보내고 클라이언트가 따라잡는다. 양쪽 __hash() 가 같아야 한다. __status() 로 큐·선택 번호 확인
//  주의: 진짜 서버가 아니므로 양쪽이 동시에 보내면 순서가 뒤섞일 수 있다 — 한 번에 한 탭만 조작할 것

// 두 탭 락스텝 + 재접속(rejoin) 흉내. seat 0 탭이 서버 역할(로그 보관·중계·rejoin 응답)
window.__lock=function(SEAT){
  window.SEAT=SEAT; window.__isServer=(SEAT===0);
  NET.online=true; NET.seat=SEAT; NET.userId='P'+(SEAT+1); NET.token='x'; NET.spectating=false; NET.leaving=false;
  window.__log=window.__log||[];
  const bc=new BroadcastChannel('rbrejoin'); window.__bc=bc;
  const D1={legendN:253,champN:27,main:[27,...Array(4).fill(169),...Array(35).fill(210)],runes:Array(12).fill(7),bfs:[294,297,280],arts:null};
  const D2={legendN:265,champN:246,main:[246,...Array(4).fill(185),...Array(35).fill(210)],runes:Array(12).fill(7),bfs:[294,297,280],arts:null};
  window.__START=seat=>({t:'start',seed:777,yourSeat:seat,spectate:false,manual:false,banRule:false,format:'bo1',players:[{id:'P1',deck:D1},{id:'P2',deck:D2}]});
  window.__deliver=m=>{
    switch(m.t){
      case 'act': NET._enqueueAction(m); break;
      case 'choice': NET._resolveChoice(m); break;
      case 'start': if(m.rejoin){ NET.catchingUp=true; NET.rejoined=true; NET.reconnecting=false; } startOnlineGame(m); break;
      case 'rejoinDone': NET._enqueueAction({action:{k:'_rejoinDone'},seat:-1}); break;
      case 'opponentAway': NET.oppAway=true; UI.toast('상대 연결 끊김'); UI.promptForState?.(); break;
      case 'opponentBack': NET.oppAway=false; UI.toast('상대 복귀'); UI.promptForState?.(); break;
    }
  };
  // 서버 역할: 로그에 쌓고 양쪽에 내려보낸다
  window.__srvRelay=out=>{ __log.push(out); bc.postMessage({kind:'down',msg:out}); __deliver(out); };
  NET.ws={readyState:1, send:str=>{
    const m=JSON.parse(str);
    if(m.t==='act'||m.t==='choice'){
      const out={t:m.t,seat:SEAT,from:'P'+(SEAT+1)}; if(m.t==='act') out.action=m.action; else { out.id=m.id; out.data=m.data; }
      if(__isServer) __srvRelay(out); else bc.postMessage({kind:'up',msg:out});
    } else if(m.t==='rejoin'){ bc.postMessage({kind:'rejoin',seat:SEAT}); }
  }};
  bc.onmessage=e=>{
    const d=e.data;
    if(__isServer){
      if(d.kind==='up') __srvRelay(d.msg);
      else if(d.kind==='rejoin'){ const msgs=[{...__START(d.seat),rejoin:true}, ...__log, {t:'rejoinDone'}]; bc.postMessage({kind:'downTo',seat:d.seat,msgs}); __deliver({t:'opponentBack'}); }
      else if(d.kind==='away'){ __deliver({t:'opponentAway'}); }
    } else {
      if(d.kind==='down') __deliver(d.msg);
      else if(d.kind==='downTo' && d.seat===SEAT){ for(const m of d.msgs) __deliver(m); }
    }
  };
  return 'locked seat '+SEAT+(__isServer?' (server)':'');
};
// 서버 탭에서 게임 시작: 양쪽에 start 배포 (사이드보딩 핸드셰이크부터 — 실제 서버와 같은 경로)
window.__startGame=function(){ __bc.postMessage({kind:'downTo',seat:1,msgs:[__START(1)]}); __deliver(__START(0)); return 'started'; };
// 상태 요약 해시 (양쪽 비교용)
window.__hash=function(){
  if(!G) return null;
  const u=x=>x.n+'#'+x.uid+'@'+x.loc+'/'+x.ctrl+(x.ex?'x':'')+'d'+x.dmg;
  return JSON.stringify({turn:G.turn,tc:G.turnCount,phase:G.phase,state:G.state,acting:G.actingPlayer,seq:NET.choiceSeq,
    P:G.players.map(p=>({h:p.hand.join(','),d:p.deck.length,e:p.energy,pts:p.points,base:p.base.map(u),runes:p.runes.map(r=>r.n+(r.ex?'x':'')).join(',')})),
    bfs:G.bfs.map(b=>({n:b.n,c:b.controller,u:b.units.map(u),h:b.hiddenCards.length})),
    sd:G.showdown&&{bf:G.showdown.bfIdx,chain:G.showdown.chain.length,passes:G.showdown.passes}});
};
window.__status=function(){ return {seq:NET.choiceSeq, pc:Object.keys(NET.pendingChoices), early:Object.keys(NET.earlyChoices), q:NET.actionQueue.length, proc:NET.processing, catching:NET.catchingUp, pending:NET.startPending, phase:G&&G.phase, turn:G&&G.turn, state:G&&G.state, acting:G&&G.actingPlayer, prompt:document.getElementById('prompt-area')?.innerText.slice(0,70), modal:document.getElementById('modal-overlay')?.style.display, screen:currentScreen&&currentScreen()}; };
