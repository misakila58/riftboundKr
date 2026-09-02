// ══════════ 봇 국면 평가 (evalState) ══════════
// "지금 판이 나에게 얼마나 좋은가"를 하나의 점수로 환산한다.
// 탐색(bot-sim.js)이 후보 수를 두어 본 뒤 결과를 비교할 때 쓰는 잣대.
// 단위는 '승점'으로 통일한다 — 8점이면 승리이므로 1.0 = 1점의 가치.
//
// 값의 근거:
//  · 통제 전장은 매 개시마다 1점을 낳는 '수입원'이므로 남은 턴 수(τ)만큼 곱해 본다.
//  · 전투는 전장별로 따로 본다. 전역 위력 합은 (3+3)과 (6+0)을 구분하지 못한다.
//  · 추정값은 5단계 셀프플레이 튜닝으로 교정한다 (BOT_W를 바꿔가며 승률로 검증).

const BOT_W = {
  point:        1.00,   // 실제 승점 1점
  control:      0.85,   // 전장 통제 1개 (유지 수입의 현재가치)
  bfMargin:     0.35,   // 전장별 위력 우위 (tanh로 눌러 과대평가 방지)
  card:         0.22,   // 손패 1장
  cardGlut:     0.10,   // 6장 초과분은 가치 체감
  // 룬은 각성 단계에서 매 턴 전부 재준비된다 → 내 턴에 안 쓰고 남긴 룬은 사실상 버린 자원이다.
  // 여기에 큰 값을 주면 "카드를 내는 것"이 손해로 계산되어 봇이 아무것도 하지 않게 된다.
  // 남는 가치는 상대 턴 [반응]에 쓸 가능성뿐이므로 아주 작게 잡는다.
  rune:         0.04,
  runeDeck:     0.05,   // 룬 덱에 남은 장수 (장기 자원)
  unitBase:     0.20,   // 기지 유닛의 위력 1당 (예비 전력)
  unitBf:       0.30,   // 전장 유닛의 위력 1당 (즉시 압박)
  buff:         0.20,   // 버프 1개
  hidden:       0.30,   // 숨겨둔 카드 1장
  champReady:   0.25,   // 챔피언 존에 남아 있음
  legendReady:  0.15,   // 전설 능력 사용 가능
  nearWinBonus: 0.60,   // 승리 사거리 진입 가산
  // ── 행동 선택 계수 (평가 함수가 아니라 정책의 손잡이 — 셀프플레이 스윕으로 정한다) ──
  playCost:     1.00,   // 손패 우선순위에서 비용을 얼마나 깎을지 (크면 값싼 카드 우선)
  moveNeed:     0.02,   // 이 값보다 이득이 커야 이동한다 (크면 소극적)
  finalRule:    1,      // 최종 점수 제한을 계산에 넣는가 (0이면 옛 동작 — 분리 측정용)
  sdMargin:     2,      // 결전에서 이 차이 이상 앞서면 트릭을 아낀다
  peekTrick:    0.25,   // (열람 티어) 상대 트릭 1장당 공격 기준을 얼마나 높일지
  peekBold:    -0.12,   // (열람 티어) 상대에게 트릭이 없을 때 공격 기준을 얼마나 낮출지
};

// 남은 턴 수 추정 — 승리까지 몇 번 더 개시를 맞이하는가.
// 통제 전장의 현재가치 = 남은 개시 횟수. 게임이 끝나갈수록 통제의 가치는 줄어든다.
function evalTau(p){
  const P = G.players[p];
  const need = Math.max(1, G.victory - P.points);
  return Math.max(1, Math.min(4, need));
}

// 이 전장을 p가 '유지'로 득점할 수 있는 상태인가 (유닛이 주둔한 통제 전장)
function evalHolds(p){
  return G.bfs.filter(bf => bf.controller === p && bf.units.some(u => u.ctrl === p)).length;
}

// ══════════ 국면 점수 ══════════
// 반환값이 클수록 p에게 좋다. 상대 관점 점수를 빼서 '차이'로 만든다.
function evalState(G_, p){
  const o = opp(p);
  const W = BOT_W;
  let s = 0;

  // 승패가 확정되면 그것으로 끝
  if(G.winner === p) return 999;
  if(G.winner === o) return -999;

  const P = G.players[p], O = G.players[o];
  const tau = evalTau(p);

  // ① 승점 — 가장 직접적
  s += (P.points - O.points) * W.point;

  // ② 전장 통제 — 유지 수입의 현재가치
  const myHold = evalHolds(p), opHold = evalHolds(o);
  s += (myHold - opHold) * W.control * Math.min(tau, 3) / 2;

  // ③ 승리 사거리 — 유지만으로 이기는 상태면 큰 가산 (최종 점수 제한은 유지에 적용되지 않는다)
  if(P.points + myHold >= G.victory) s += W.nearWinBonus;
  if(O.points + opHold >= G.victory) s -= W.nearWinBonus * 1.2;   // 상대 리썰은 더 무겁게

  // ④ 전장별 위력 균형 — 전역 합이 아니라 전장마다 따로
  G.bfs.forEach((bf, i) => {
    const mine = bf.units.filter(u=>u.ctrl===p).reduce((a,u)=>a+might(u),0);
    const theirs = bf.units.filter(u=>u.ctrl===o).reduce((a,u)=>a+might(u),0);
    if(mine || theirs) s += W.bfMargin * Math.tanh((mine - theirs) / 3);
  });

  // ⑤ 보드 전력
  const power = (q, loc) => everyUnit()
    .filter(u => u.ctrl===q && (loc==='base' ? u.loc==='base' : u.loc!=='base'))
    .reduce((a,u)=>a+might(u),0);
  s += (power(p,'base') - power(o,'base')) * W.unitBase;
  s += (power(p,'bf')   - power(o,'bf'))   * W.unitBf;

  // ⑥ 카드·자원
  const handVal = h => Math.min(h,6)*W.card + Math.max(0,h-6)*W.cardGlut;
  s += handVal(P.hand.length) - handVal(O.hand.length);
  s += (readyRunes(p).length - readyRunes(o).length) * W.rune;
  s += (P.runeDeck.length - O.runeDeck.length) * W.runeDeck;

  // ⑦ 부가 자원
  const buffs = q => everyUnit().filter(u=>u.ctrl===q).reduce((a,u)=>a+u.buff,0);
  s += (buffs(p) - buffs(o)) * W.buff;
  const hidden = q => G.bfs.reduce((a,bf)=>a+bf.hiddenCards.filter(h=>h.by===q).length, 0);
  s += (hidden(p) - hidden(o)) * W.hidden;
  if(P.champInZone) s += W.champReady;
  if(O.champInZone) s -= W.champReady;
  if(!P.legendEx) s += W.legendReady;
  if(!O.legendEx) s -= W.legendReady;

  return s;
}

// ══════════ 전투 임계 계산 ══════════
// 전장 i를 units로 공격하면 어떻게 되는가를 실제 규칙대로 계산한다.
//  · 양측 위력 합을 비교하고, 각 유닛의 치사량(위력-이미받은피해)으로 처치 수를 센다.
//  · 양측이 전멸하면 남는 유닛이 없어 통제 확립이 일어나지 않는다 → 정복 0점.
//  · 방어측이 남으면 공격 유닛은 기지로 귀환한다.
// extraDef: 아직 그 전장에 없지만 '보낸다면' 방어에 합류할 유닛들.
// 수비 보강의 값을 매기려면 "보강한 뒤에도 상대가 이길까"를 물어야 하는데,
// G를 실제로 건드리지 않고 물어보려면 이 인자가 필요하다.
function evalCombat(p, bfIdx, units, extraDef){
  const bf = G.bfs[bfIdx];
  const o = opp(p);
  const def = bf.units.filter(u=>u.ctrl===o).concat(extraDef||[]);
  const atk = units;
  const atkM = atk.reduce((s,u)=>s+might(u,'attacker'),0);
  const defM = def.reduce((s,u)=>s+might(u,'defender'),0);

  // 처치: 치사량이 작은 것부터 채우면 수가 최대가 된다. 어떤 유닛이 죽는지도 함께 반환해
  // 교환 손익 계산이 실제 처치 대상과 어긋나지 않게 한다 (예전엔 정렬 전 목록의 앞 N개를 합산했다)
  const kills = (total, targets, role) => {
    const order = targets.map(u=>({u, l:Math.max(1, might(u,role,{forKill:true})-u.dmg)}))  // 기절 유닛도 원래 위력만큼 필요 (룰 410.1.c)
      .sort((a,b)=>a.l-b.l);
    let rest = total; const dead=[];
    for(const t of order){ if(rest >= t.l){ rest -= t.l; dead.push(t.u); } else break; }
    return dead;
  };
  const defDead = kills(atkM, def, 'defender');
  const atkDead = kills(defM, atk, 'attacker');
  const defKilled = defDead.length, atkKilled = atkDead.length;
  const defLeft = def.length - defKilled;
  const atkLeft = atk.length - atkKilled;

  let result;
  if(defLeft > 0)       result = 'repelled';    // 방어 성공 — 공격 유닛은 기지 귀환, 득점 없음
  else if(atkLeft > 0)  result = 'conquer';     // 공격 성공 — 통제 확립
  else                  result = 'mutual';      // 양측 전멸 — 아무도 통제하지 못함, 득점 없음

  // 이번 턴 이미 득점한 전장이면 정복해도 점수는 없다 (통제 자체는 여전히 가치가 있다)
  let scoresPoint = (result === 'conquer') && !bf.scored[p];
  // 최종 점수 제한(공식 RUP4, engine addPoints 231행): 승리까지 1점 남은 뒤의 정복은
  // '이번 턴 모든 전장을 득점'했을 때만 점수가 된다 — 아니면 카드 1장으로 대체된다.
  // 이걸 모르면 봇이 마지막 1점을 유령 점수로 착각하고 헛공격에 병력을 태운다.
  if(scoresPoint && typeof BOT_W.finalRule !== 'undefined' && BOT_W.finalRule){
    const P = G.players[p];
    if(P.points >= G.victory - 1)
      scoresPoint = G.bfs.every((b, i) => i === bfIdx || P.scoredBf[i]);
  }
  return { result, atkM, defM, defKilled, atkKilled, defLeft, atkLeft, scoresPoint,
           defDead, atkDead,
           lostMight: atkDead.reduce((s,u)=>s+might(u),0) };
}

// 공격 후보의 가치 — 얻는 것(정복·통제·처치) 대비 잃는 것(내 유닛)
function evalAttackValue(p, bfIdx, units, extraDef){
  const c = evalCombat(p, bfIdx, units, extraDef);
  const bf = G.bfs[bfIdx];
  let v = 0;
  if(c.result === 'conquer'){
    if(c.scoresPoint) v += BOT_W.point;                       // 정복 1점
    if(bf.controller !== p) v += BOT_W.control * Math.min(evalTau(p),3)/2;  // 통제 획득
  } else if(c.result === 'repelled'){
    v -= 0.15;                                                // 헛공격 — 템포 손실
  } else if(c.result === 'mutual'){
    v -= 0.05;                                                // 상호 전멸 — 득점 없음
  }
  // 교환 손익 (내 잃은 위력 vs 상대 잃은 위력) — 실제 처치 대상 기준
  const defLost = c.defDead.reduce((s,u)=>s+might(u),0);
  v += (defLost * BOT_W.unitBf) - (c.lostMight * BOT_W.unitBf);
  return v;
}
