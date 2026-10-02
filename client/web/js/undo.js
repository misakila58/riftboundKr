// ══════════ 되돌리기 (2026-10-02) ══════════
// 봇전: 항상 사용 가능 — 내 행동 직전의 상태(G 사본 + UID + 난수 상태)를 쌓아 두고, 되돌리면 그 행동과 그 뒤 봇의 행동까지 함께 되돌린다.
//       난수 상태도 되돌리므로 다시 해도 드로우·셔플 결과는 같다.
// 온라인: 방장이 방을 만들 때 '되돌리기 허용'을 켠 방만(등급전은 서버가 항상 끈다). 되돌리기도 하나의 행동({k:'undo'})으로 서버를 거쳐
//       양쪽(관전자 포함)이 같은 순서로 실행하고, 양쪽 모두 모든 행동 직전에 같은 사본을 쌓으므로 같은 상태로 돌아간다(락스텝 유지).
//       맨 마지막 행동이 자기 것일 때만 되돌릴 수 있다 — 상대가 그 뒤에 한 행동을 지우지 않게.
// 사본은 엔진이 쉬는 지점(행동 사이)에서만 뜨고, 되돌리기도 그때만 한다. bot-sim.js의 cloneG를 쓴다.
const UNDO = {
  MAX: 40,
  stack: [],          // { G, UID, rng, choiceSeq, actor }
  busy: 0,            // 봇전: 내 행동이 아직 실행 중
  KINDS: new Set(['play', 'move', 'ability', 'endTurn', 'pass', 'hide', 'playHidden', 'equip', 'runeFloat', 'manual']),
  clear(){ this.stack.length = 0; },
};

function undoBotGame(){ return typeof BOT !== 'undefined' && BOT.active && !NET.online; }
function undoOnlineGame(){ return NET.online && !!NET.lastStart?.undo && !(typeof P2P !== 'undefined' && P2P.active); }
function undoSnapshot(actor){
  if(typeof cloneG !== 'function' || !G) return;
  UNDO.stack.push({ G: cloneG(G), UID, rng: _rngState, choiceSeq: NET.choiceSeq, actor });
  if(UNDO.stack.length > UNDO.MAX) UNDO.stack.shift();
}
function undoRestore(s, who){
  G = s.G; UID = s.UID; _rngState = s.rng;
  if(NET.online) NET.choiceSeq = s.choiceSeq;
  // 화면에 남은 로컬 조작(주문 준비·이동 선택·대기 이동·창)을 모두 걷는다
  try{ if(UI.spellStage) UI.cancelSpellStage?.(); }catch(e){}
  try{ if(pendingCombatMove()) cancelCombatMove(); }catch(e){}
  try{
    _moveArmed = false; _moveSel.clear();
    _resolver = null; _pickableUids = null; _boardCardPick = null; _reactionPick = null;
    UI.unitSelectionPending = false; UI.placementPending = false;
    document.getElementById('placement-overlay')?.remove();
    closeModal(); UI.hideZoom?.(); UI.hideMagnify?.(); clearPicking?.();
  }catch(e){}
  if(typeof BOT !== 'undefined' && BOT.active) BOT.ctx = POLICY.newCtx();
  if(typeof TURN_TIMER !== 'undefined') TURN_TIMER.bump();
  UI.log(`↩ 되돌리기 — ${who}의 마지막 행동 전으로 돌아갔습니다`, 'sys');
  UI.render(); UI.promptForState();
}

// 엔진이 쉬고 있고 화면에 열린 선택이 없는가 (되돌리기 가능 시점)
function undoIdle(){
  return !!G && G.winner === null && G.phase === 'action' && !G._endingTurn
    && (typeof _execDepth === 'undefined' || _execDepth === 0)
    && !(G.state === 'showdown' && (G.showdown?.resolvingItem || G.showdown?.finalizingTriggers || G.showdown?.pendingTriggers?.length))
    && !UI.isPicking() && document.getElementById('modal-overlay')?.style.display === 'none'
    && !(typeof REPLAY !== 'undefined' && REPLAY.viewing);
}
function undoAvailable(){
  if(!UNDO.stack.length) return false;
  if(undoBotGame()) return UNDO.busy === 0 && !BOT.busy && undoIdle();
  if(undoOnlineGame()){
    if(NET.spectating || NET.catchingUp || NET.reconnecting || Object.keys(NET.pendingChoices || {}).length) return false;
    return UNDO.stack[UNDO.stack.length - 1].actor === NET.seat && undoIdle();
  }
  return false;
}
UI.undo = function(){
  if(!undoAvailable()) return;
  if(undoBotGame()){ undoRestore(UNDO.stack.pop(), pname(1 - BOT.seat)); return; }
  NET.dispatch({k:'undo', p:NET.seat}, ()=>{});
};

// 새 게임마다 비운다
(function(){
  const ng = newGame;
  newGame = function(){ UNDO.clear(); return ng.apply(this, arguments); };
})();

// 봇전: 사람의 행동이 실제로 실행되기 직전에 사본을 뜬다 (dispatch의 막힘 검사를 통과한 뒤 — localFn 안에서)
(function(){
  const dispatch = NET.dispatch;
  NET.dispatch = function(action, localFn){
    if(undoBotGame() && action && UNDO.KINDS.has(action.k) && typeof localFn === 'function'){
      const fn = localFn;
      localFn = function(){
        undoSnapshot(1 - BOT.seat);
        UNDO.busy++;
        let r;
        try{ r = fn.apply(this, arguments); }
        catch(e){ UNDO.busy--; throw e; }
        if(r && typeof r.then === 'function') r.then(() => UNDO.busy--, () => UNDO.busy--);
        else UNDO.busy--;
        return r;
      };
    }
    return dispatch.call(this, action, localFn);
  };
})();

// 온라인: 모든 행동 직전에 사본(양쪽 같은 순서) · 되돌리기 행동 처리
(function(){
  const exec = NET._execAction;
  NET._execAction = async function(a){
    if(a && a.k === 'undo'){
      if(!undoOnlineGame()) return;                         // 허용하지 않는 방 (서버도 걸러 낸다)
      const top = UNDO.stack[UNDO.stack.length - 1];
      if(!top || top.actor !== a.p) return;                 // 그 사이 상대가 행동했다 — 양쪽 모두 무시
      undoRestore(UNDO.stack.pop(), pname(a.p));
      return;
    }
    if(undoOnlineGame() && a && UNDO.KINDS.has(a.k) && G){
      const actor = typeof a.p === 'number' ? a.p : (a.k === 'pass' ? G.actingPlayer : G.turn);
      undoSnapshot(actor);
    }
    return exec.apply(this, arguments);
  };
})();

// 버튼 (턴 종료 옆) — 되돌리기를 쓸 수 있는 게임에서만 보인다
setInterval(() => {
  const btn = document.getElementById('btn-undo'); if(!btn) return;
  const show = !!G && G.winner === null && (undoBotGame() || (undoOnlineGame() && !NET.spectating));
  btn.style.display = show ? '' : 'none';
  if(show) btn.disabled = !undoAvailable();
}, 300);
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-undo')?.addEventListener('click', () => UI.undo());
});
document.addEventListener('keydown', e => {
  if(!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
  if(e.target.closest?.('input,textarea,[contenteditable="true"]')) return;
  if(document.getElementById('game-screen')?.style.display === 'none') return;
  if(undoAvailable()){ e.preventDefault(); UI.undo(); }
});
