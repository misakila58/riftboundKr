// ══════════ 턴 제한 시간 · 밧줄 연출 · 시작 단계 무응답 무효 (2026-10-02) ══════════
// ① 온라인 대전에서 지금 응답해야 하는 좌석(내 턴·결전 우선권·선택 대기)이 1분 동안 아무 행동도 하지 않으면 시간 초과.
//    행동·선택 응답이 하나라도 오가면 다시 1분부터. 마지막 20초에는 보드 가운데에 하스스톤처럼 타들어 가는 밧줄을 띄운다(양쪽 화면 모두).
//    시간 초과 처리는 그 좌석의 클라이언트만 한다 — 버튼을 누른 것과 똑같은 행동을 보내므로 락스텝 순서가 어긋나지 않는다:
//    열린 선택은 기본값(패스·건너뛰기 우선, 없으면 첫 후보)으로 답하고, 결전이면 패스, 내 턴이면 턴 종료.
// ② 첫 게임 시작 단계(주사위·선후공·사이드보딩·멀리건)에서 상대 선택을 1분 넘게 기다리면 "이번 경기를 무효로 할까요?"를 묻는다.
//    확인하면 서버(voidMatch)가 상대의 마지막 응답 시각을 확인해 무효 처리(등급 미반영, 양쪽 로비로), 취소하면 1분 더 기다린 뒤 다시 묻는다.
// 턴 제한 시간은 방을 만들 때 고른다(기본 켬, 등급전은 항상 켬 — 서버 start.turnTimer). P2P 직결은 끔. 관전자는 밧줄만 본다. 봇전·핫시트·리플레이는 해당 없음. 재접속 따라잡기 중에는 멈춘다.
const TURN_TIMER = {
  LIMIT_MS: 60 * 1000,      // 무행동 제한
  ROPE_MS: 20 * 1000,       // 밧줄이 보이는 마지막 구간
  VOID_MS: 60 * 1000,       // 시작 단계 상대 무응답 → 무효 질문
  activity: 0,              // 행동 실행·선택 응답마다 +1 (양쪽 화면이 같은 흐름을 본다)
  _key: null, _since: 0, _act: -1, forced: false, _forcedAt: 0, _toasted: false,
  _vKey: null, _vSince: 0, _vAct: -1, _vOpen: false,
  bump(){ this.activity++; },
};

// 활동 감지: 행동 실행과 선택 응답(내 것·상대 것 모두)
(function(){
  if(typeof NET === 'undefined') return;
  const ex = NET._execAction;
  if(typeof ex === 'function') NET._execAction = function(a){ if(a && a.k !== '_rejoinDone') TURN_TIMER.bump(); return ex.apply(this, arguments); };
  const rc = NET._resolveChoice;
  if(typeof rc === 'function') NET._resolveChoice = function(m){ TURN_TIMER.bump(); return rc.apply(this, arguments); };
})();

// 턴 제한 시간은 방 설정(start.turnTimer — 등급전은 서버가 항상 켬)을 따른다
function ttActive(){
  return typeof G !== 'undefined' && G && G.winner === null && NET.online
    && !NET.catchingUp && !NET.reconnecting && !NET.startPending
    && !(typeof REPLAY !== 'undefined' && REPLAY.viewing);
}
// 지금 누구의 응답을 기다리는가 (행동 단계에서만 — 시작 단계는 ②가 맡는다)
function ttWaitingSeat(){
  if(!ttActive() || !NET.lastStart?.turnTimer || !['action', 'ending'].includes(G.phase)) return null;
  const pend = Object.values(NET.pendingChoices || {});
  let seat = pend.length ? pend[0].p : (G.state === 'showdown' ? G.actingPlayer : G.turn);
  if(typeof seat !== 'number' || seat < 0) return null;
  if(seat !== NET.seat && NET.oppAway) return null;   // 상대 연결 끊김 — 재접속 유예(서버)가 따로 처리한다
  return seat;
}
function ttMyPickOpen(){
  return typeof _turnGlowPick !== 'undefined' && _turnGlowPick && _turnGlowPick.game === G && _turnGlowPick.p === NET.seat;
}
// 열린 선택에 기본값으로 답한다 — 화면의 버튼/후보를 사람이 누른 것처럼 누른다(같은 경로라 동기화가 그대로 유지된다)
function ttAutoAnswer(){
  const SKIP = /패스|건너뛰|선택 안 함|안 함|하지 않|넘기|사용 안|그만|취소|아니/;
  const BAN = /항복|설정|체인|숨기기|보드 보기|나가기/;
  const visible = el => !!el && el.offsetParent !== null;
  const scopes = ['#placement-overlay', '#modal-box', '#prompt-area', '#spell-stage'].map(s => document.querySelector(s)).filter(visible);
  const btns = scopes.flatMap(s => [...s.querySelectorAll('button')])
    .filter(b => !b.disabled && visible(b) && b.id !== 'modal-visibility-toggle' && !BAN.test(b.textContent));
  const skip = btns.find(b => SKIP.test(b.textContent.trim()));
  if(skip){ skip.click(); return true; }
  const target = [...document.querySelectorAll('#game-screen .targetable, #game-screen [data-board-choice]')].find(visible);
  if(target){ target.click(); return true; }
  if(btns.length){ btns[0].click(); return true; }
  return false;
}
// 시간 초과된 내 차례를 한 걸음 진행한다 (0.7초마다 다시 불려 차례가 넘어갈 때까지 이어 간다)
function ttForceStep(){
  const modalOpen = document.getElementById('modal-overlay')?.style.display !== 'none';
  if(modalOpen && !ttMyPickOpen()){ closeModal(); return; }   // 턴 종료 확인·설정 같은 선택 아닌 창
  if(UI.spellStage && !UI.spellStage.submitted){ UI.cancelSpellStage?.(); return; }
  if(typeof _reactionPick !== 'undefined' && _reactionPick && canPassReaction()){ _boardCardPick.finish(_reactionPick.passIndex); return; }
  if(ttMyPickOpen() || _resolver || UI.placementPending){ ttAutoAnswer(); return; }
  if(UI.canShowdownPass()){ NET.dispatch({k:'pass'}, () => showdownPass()); return; }
  if(pendingCombatMove()){ cancelCombatMove(); return; }
  if(typeof _moveArmed !== 'undefined' && _moveArmed){ _moveArmed = false; _moveSel.clear(); }
  if(UI.canEndTurn()){ NET.dispatch({k:'endTurn'}, () => endTurn()); return; }
}

// ---------- 밧줄 ----------
function ttRopeEl(){
  let el = document.getElementById('turn-rope');
  if(el) return el;
  const host = document.getElementById('battlefields'); if(!host) return null;
  el = document.createElement('div'); el.id = 'turn-rope'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="rope-ash"></div><div class="rope-burn"><div class="rope-cord"></div><div class="rope-spark"></div></div><div class="rope-label"></div>';
  host.appendChild(el);
  return el;
}
function ttRope(seat, remain){
  const el = document.getElementById('turn-rope') || (seat !== null && remain <= TURN_TIMER.ROPE_MS ? ttRopeEl() : null);
  if(!el) return;
  if(seat === null || remain > TURN_TIMER.ROPE_MS || remain <= 0){ el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.querySelector('.rope-burn').style.width = (100 * remain / TURN_TIMER.ROPE_MS).toFixed(2) + '%';
  const s = Math.ceil(remain / 1000);
  const who = seat === NET.seat ? '내 시간' : (typeof pname === 'function' ? pname(seat) : '상대') + '의 시간';
  el.querySelector('.rope-label').textContent = `⏳ ${who} ${s}초`;
  el.classList.toggle('mine', seat === NET.seat);
  el.classList.toggle('urgent', s <= 5);
}

// ---------- 시작 단계 무응답 → 무효 질문 ----------
function ttVoidClose(){
  TURN_TIMER._vOpen = false;
  document.getElementById('void-ask')?.remove();
}
function ttVoidAsk(){
  TURN_TIMER._vOpen = true;
  const box = document.createElement('div'); box.id = 'void-ask'; box.setAttribute('role', 'dialog');
  box.innerHTML = '<div class="void-title">⏳ 상대가 1분 동안 응답이 없습니다</div>'
    + '<div class="void-copy">이번 경기를 무효로 할까요? 무효로 하면 ' + (NET.lastStart?.ranked ? '등급 점수에 반영되지 않고 ' : '') + '두 사람 모두 로비로 돌아갑니다.</div>';
  const btns = document.createElement('div'); btns.className = 'void-btns';
  const yes = document.createElement('button'); yes.className = 'primary'; yes.textContent = '무효로 하고 나가기';
  yes.onclick = () => { yes.disabled = true; NET.send({t:'voidMatch'}); setTimeout(() => { if(document.getElementById('void-ask')) ttVoidClose(); TURN_TIMER._vSince = Date.now(); }, 4000); };
  const no = document.createElement('button'); no.textContent = '계속 기다리기';
  no.onclick = () => { ttVoidClose(); TURN_TIMER._vSince = Date.now(); };   // 1분 더 기다린 뒤 다시 묻는다
  btns.append(yes, no); box.appendChild(btns);
  document.body.appendChild(box);
}
function ttVoidTick(now){
  const T = TURN_TIMER;
  let waiting = false;
  const p2p = typeof P2P !== 'undefined' && P2P.active;
  if(ttActive() && !p2p && !NET.spectating && typeof NET.seat === 'number' && NET.seat >= 0
     && !['action', 'ending'].includes(G.phase) && !(typeof MATCH !== 'undefined' && MATCH.active() && MATCH.game > 1)){
    const pend = Object.values(NET.pendingChoices || {});
    waiting = pend.some(pc => pc.p === 1 - NET.seat) && !pend.some(pc => pc.p === NET.seat);
  }
  const key = waiting ? 'wait' : null;
  if(key !== T._vKey || T.activity !== T._vAct){ T._vKey = key; T._vSince = now; T._vAct = T.activity; if(T._vOpen) ttVoidClose(); }
  if(waiting && !T._vOpen && now - T._vSince >= T.VOID_MS) ttVoidAsk();
}

// ---------- 주기 ----------
function ttTick(){
  const T = TURN_TIMER, now = Date.now();
  try{ ttVoidTick(now); }catch(e){ console.warn('void tick', e); }
  const seat = ttWaitingSeat();
  const key = seat === null ? null : `${seat}|${G.turn}|${G.turnCount}|${G.state}`;
  if(key !== T._key){ T._key = key; T._since = now; T._act = T.activity; T.forced = false; T._toasted = false; }
  else if(!T.forced && T.activity !== T._act){ T._act = T.activity; T._since = now; }
  const remain = seat === null ? Infinity : T.LIMIT_MS - (now - T._since);
  ttRope(seat, remain);
  if(seat === null || seat !== NET.seat || NET.spectating || remain > 0) return;
  // 내 시간이 다 됐다 — 차례가 넘어갈 때까지 자동 진행
  T.forced = true;
  if(!T._toasted){ T._toasted = true; T.timeouts = (T.timeouts || 0) + 1; UI.toast('⏰ 시간 초과 — 자동으로 진행합니다', 'warn'); }
  if(now - T._forcedAt < 700) return;
  T._forcedAt = now;
  try{ ttForceStep(); }catch(e){ console.warn('turn timeout step', e); }
}
setInterval(ttTick, 250);
