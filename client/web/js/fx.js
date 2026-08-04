// ══════════ 연출(이펙트) ══════════
// 전부 표시 전용 — 게임 상태(G)를 건드리지 않고, 아무것도 await 하지 않는다.
// (온라인 락스텝 결정론과 봇 진행 속도에 영향이 없어야 하므로 모두 비동기 fire-and-forget)
// 유닛 연출은 보드가 매 렌더마다 다시 그려져도 살아남도록, 유닛 위치에 별도 레이어를 띄운다.

UI.fx = {
  on: (localStorage.getItem('rb_fx') !== 'off'),
  setOn(v){ UI.fx.on = !!v; localStorage.setItem('rb_fx', v ? 'on' : 'off'); },
};

function fxLayer(){
  let l = document.getElementById('fx-layer');
  if(!l){ l = document.createElement('div'); l.id = 'fx-layer'; document.body.appendChild(l); }
  return l;
}
function fxAdd(el, ms){
  fxLayer().appendChild(el);
  setTimeout(()=>el.remove(), ms);
  return el;
}
function fxUnitEl(u){
  return u ? document.querySelector(`#board [data-uid="${u.uid}"]`) : null;
}

// ── 유닛 반응: 피해 / 버프 / 준비 / 처치 ──
// kind: 'hit' | 'buff' | 'ready' | 'die' | 'stun'
UI.fx.unit = function(u, kind, text){
  if(!UI.fx.on) return;
  const el = fxUnitEl(u); if(!el) return;
  const r = el.getBoundingClientRect();
  if(!r.width) return;
  const box = document.createElement('div');
  box.className = 'fx-unit fx-' + kind;
  box.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  if(text){
    const t = document.createElement('span');
    t.className = 'fx-num'; t.textContent = text;
    box.appendChild(t);
  }
  fxAdd(box, kind === 'die' ? 700 : 900);
};

// ── 카드/능력 발동 연출: 화면 가운데에 잠깐 크게 ──
UI.fx.cast = function(c, p, label){
  if(!UI.fx.on || !c) return;
  const box = document.createElement('div');
  box.className = 'fx-cast fx-cast-p' + (p === 1 ? 1 : 0);
  if(c.img){
    const im = document.createElement('img');
    im.src = cardImgUrl(c.img, 280);
    box.appendChild(im);
  }
  const cap = document.createElement('div');
  cap.className = 'fx-cast-cap';
  cap.textContent = (label ? label + ' · ' : '') + (c.ko || c.name || '');
  box.appendChild(cap);
  fxAdd(box, 1100);
};

// ── 체인 적재: 누구의 카드/능력이 쌓였는지 2초간 표시 ──
UI.fx.chainAdd = function(c, p, num){
  if(!UI.fx.on || !c) return;
  const box = document.createElement('div');
  box.className = 'fx-cast fx-chain fx-cast-p' + (p === 1 ? 1 : 0);
  if(c.img){
    const im = document.createElement('img');
    im.src = cardImgUrl(c.img, 280);
    box.appendChild(im);
  }
  const cap = document.createElement('div');
  cap.className = 'fx-cast-cap';
  cap.textContent = `🔗 체인 #${num} — ${pname(p)}: ${c.ko || c.name || ''}`;
  box.appendChild(cap);
  fxAdd(box, 2000);
};

// ── 턴 종료: 화면을 가로지르는 띠 ──
UI.fx.turnEnd = function(p){
  if(!UI.fx.on) return;
  const box = document.createElement('div');
  box.className = 'fx-band fx-band-p' + (p === 1 ? 1 : 0);
  const t = document.createElement('span');
  t.textContent = `${pname(p)} · 턴 종료`;
  box.appendChild(t);
  fxAdd(box, 1000);
};

// ── 행동 차례 전환(패스/우선권 이동): 간단히 배지 + 해당 진영 테두리 펄스 ──
UI.fx.priority = function(p){
  if(!UI.fx.on) return;
  const box = document.createElement('div');
  box.className = 'fx-turnbadge fx-turnbadge-p' + (p === 1 ? 1 : 0);
  box.textContent = `▶ ${pname(p)}의 차례`;
  fxAdd(box, 900);
  const area = document.getElementById('parea-' + p);
  if(area){
    area.classList.remove('fx-pulse');
    void area.offsetWidth;              // 애니메이션 재시작
    area.classList.add('fx-pulse');
    setTimeout(()=>area.classList.remove('fx-pulse'), 900);
  }
};

// ── 득점 ──
UI.fx.score = function(p, n){
  if(!UI.fx.on || !(n > 0)) return;
  const box = document.createElement('div');
  box.className = 'fx-score fx-score-p' + (p === 1 ? 1 : 0);
  box.textContent = `+${n}점`;
  fxAdd(box, 1200);
};

// 행동 차례가 바뀌었는지 UI.render에서 확인 (모든 경로를 한 곳에서 잡는다)
let _fxActing = null, _fxTurn = null;
UI.fx.check = function(){
  if(!G || G.winner !== null){ _fxActing = null; _fxTurn = null; return; }
  const key = G.turnCount + ':' + G.actingPlayer;
  if(_fxActing === null){ _fxActing = key; _fxTurn = G.turnCount; return; }   // 첫 렌더는 조용히
  if(key === _fxActing) return;
  const sameTurn = (G.turnCount === _fxTurn);
  _fxActing = key; _fxTurn = G.turnCount;
  // 턴이 넘어간 경우는 페이즈 배너/턴 종료 연출이 이미 알려주므로 중복 표시하지 않는다
  if(sameTurn) UI.fx.priority(G.actingPlayer);
};
