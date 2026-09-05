// ══════════ 봇 정책층 (POLICY) ══════════
// 봇의 "선택"을 한곳에 모은 순수 판단 모듈.
//  · DOM·타이머·window에 의존하지 않는다 → 브라우저와 Node 셀프플레이 러너가 같은 파일을 쓴다.
//    (bot.js와 tools/selfplay.js가 각자 사본을 들면 반드시 어긋나므로, 판단은 전부 여기 둔다)
//  · G를 읽기만 한다. 상태를 바꾸지 않는다.
//  · Math.random 대신 결정론 해시를 쓴다 — 같은 국면이면 같은 선택(재현·디버깅 가능).
//  · 엔진 rng()는 절대 호출하지 않는다 (_rngState를 전진시키면 리플레이·락스텝이 깨진다).

const POLICY = {
  level: 'hard',
  explain: [],          // 최근 결정 로그 (디버깅용)
  explainMax: 200,
  // 기능별 스위치 — 끄면 정책층 도입 이전 동작으로 되돌아간다.
  // 셀프플레이로 "어느 변경이 실제로 이득인가"를 하나씩 분리 측정하기 위한 장치.
  // 셀프플레이 실측 결과 반영 (2026-08, 각 400~3000판. 검증법은 CLAUDE.md '봇 검증'):
  //   canpay +6%p / move +1.7%p / champ +4.2%p / ability +3.1%p  ← 유의
  //   place +1.5%p / hide·sdfund·defend 중립(발동 빈도가 낮다 — 규칙상 옳아 유지)
  //   unit·mulligan·showdown·hand·number·reaction·confirm 중립
  //   option -1.9%p, reserve -4.1%p → 기본 끔. 레퍼토리를 넓힌 뒤 재측정했지만 여전히 손해였다.
  //   (reserve는 남긴 룬이 상대 턴 [반응]에 거의 안 쓰여 순수 템포 손실이 된다)
  ab: { unit:1, option:0, confirm:1, number:1, hand:1, reaction:1, mulligan:1,
        reserve:0, canpay:1, move:1, showdown:1, ability:1, hide:1, sdfund:1,
        place:1, champ:1, defend:1, sdx:1, think:1 },
};

// 난이도별 능력 — 티어 차이는 '무엇을 할 줄 아는가'로 만든다.
//   move  : 평가 함수로 공격/점거 가치를 계산해 부분 출격까지 고려 (아니면 단순 위력 비교)
//   think : 후보 수를 샌드박스에서 실제로 두어 보고 고름
//   reserve: 상대 턴 [반응]을 위해 룬을 남김
//   peek  : 상대 손패·덱 열람 (마지막 티어 전용, 이름에 명시)
//   rep   : 레퍼토리 — 0 카드만 / 1 활성화 능력·[숨겨짐] / 2 결전 중 자원 능력으로 트릭 자금 조달
const POL_TIERS = {
  novice:  { smart:0, move:0, think:0, reserve:0, peek:0, moves:1, rep:0 },
  skilled: { smart:1, move:0, think:0, reserve:0, peek:0, moves:1, rep:1 },
  expert:  { smart:1, move:1, think:1, reserve:0, peek:0, moves:1, rep:1 },
  master:  { smart:1, move:1, think:1, reserve:0, peek:0, moves:3, rep:2 },
  oracle:  { smart:1, move:1, think:1, reserve:0, peek:1, moves:3, rep:2 },
  // 구 식별자 호환
  easy:    { smart:0, move:0, think:0, reserve:0, peek:0, moves:1, rep:0 },
  normal:  { smart:1, move:0, think:0, reserve:0, peek:0, moves:1, rep:1 },
  hard:    { smart:1, move:1, think:0, reserve:0, peek:0, moves:2, rep:2 },
};
function polTier(){ return POL_TIERS[POLICY.level] || POL_TIERS.skilled; }

// ---------- 유틸 ----------
function polHash(...parts){
  let h = 2166136261;
  const s = parts.join('|');
  for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h>>>0) % 100000) / 100000;   // 0~1
}
function polSmart(){ return !!polTier().smart; }
function polHard(){ return !!polTier().move; }
function polSay(kind, chosen, reason, extra){
  POLICY.explain.push({ t: (typeof G!=='undefined'&&G) ? G.turnCount : 0, kind, chosen, reason, ...(extra||{}) });
  if(POLICY.explain.length > POLICY.explainMax) POLICY.explain.shift();
}
const polStrongest = a => [...a].sort((x,y)=>might(y)-might(x))[0];
const polWeakest   = a => [...a].sort((x,y)=>might(x)-might(y))[0];

// 엔진과 동일한 기준으로 "지금 낼 수 있는가"를 묻는다.
// 룬 1개가 에너지(탈진)와 힘(재활용)을 모두 낼 수 있으므로 e+pips 단순합은 양방향으로 틀린다.
function polCanPlay(p, c){
  try {
    const e = (typeof applyCostMods==='function') ? applyCostMods(p, c, c.e||0) : (c.e||0);
    return canPay(p, e, powerPips(c));
  } catch(err){ return (c.e||0) + powerPips(c).length <= readyRunes(p).length; }
}
function polCost(c){ return (c.e||0) + powerPips(c).length; }

// 미스 포츈 오로라 컨트롤의 핵심 엔진.
// 일반 카드 가치만으로 판단하면 9비용 오로라는 멀리건하고, 값싼 유닛/도구를 먼저 내느라
// 동원 → 영겁의 촉매 → 눈부신 오로라의 3턴 가속선을 놓친다. 상대 패를 보지 않는
// master에서만 이 공개된 덱 플랜을 사용한다(다른 난이도와 덱의 기존 성향은 유지).
const POL_MF = { legend:267, mobilize:134, catalyst:138, aurora:160, stacked:183, invert:201, bulletTime:268 };
// 상대 손패를 본 뒤 제거할 카드의 미스 포츈 전용 위협도.
// 오로라 제거는 실제 성공 가능성이 높은 순서(전부/직접 처치 → 지연·대칭 → 조건부)다.
const POL_MF_HAND_ATTACK = new Map([
  [156,220],  // 파괴 공작: 2비용이라 오로라를 가장 먼저 끊을 수 있음
  [192,200],  // 정신을 가르는 자: 7비용 유닛이라 대응까지 시간이 더 있음
]);
const POL_MF_AURORA_HATE = new Map([
  [22,600],   // 열 광선: 모든 도구 폐기
  [224,560],  // 인양: 도구 하나 직접 폐기
  [180,520],  // 희미해지는 기억: 도구에 [일시적]
  [179,480],  // 감수할 만한 손실: 각자 도구 하나 폐기
  [56,400],   // 어댑타트론: 정복해야 도구 폐기
  [244,250],  // 신성한 심판: 도구가 2개를 넘을 때 재활용
]);
function polMfAuroraDeck(p){
  return POLICY.level === 'master' && G.players[p].legendN === POL_MF.legend;
}
function polMfAuroraOnline(p){
  return G.players[p].gear.some(g => g.n === POL_MF.aurora);
}

// 현재 힘 풀로 못 내는 힘 비용은 전개된 룬을 재활용하게 된다. 오로라 전에는
// 이 수를 보존하되, 시간선 역전은 실제 손패를 늘리며 오로라를 찾는 경우만 예외로 둔다.
function polRuneRecycleNeed(p, pips){
  const pool={...G.players[p].power}; let need=0;
  for(const pip of pips){
    if(pip==='Any'){
      const d=Object.keys(pool).find(k=>pool[k]>0);
      if(d){pool[d]--;continue;}
    }else{
      if(pool[pip]>0){pool[pip]--;continue;}
      if(pool.Any>0){pool.Any--;continue;}
    }
    need++;
  }
  return need;
}
function polMfTimelineBlocked(p, n){
  const P=G.players[p];
  return polMfAuroraDeck(p) && !polMfAuroraOnline(p) && n===POL_MF.invert
    && (P.hand.length>=5 || P.hand.includes(POL_MF.aurora));
}
function polMfNeutralCardBlocked(p, n){
  if(!polMfAuroraDeck(p) || polMfAuroraOnline(p) || n===POL_MF.aurora) return false;
  if(n===POL_MF.invert) return polMfTimelineBlocked(p,n); // 적은 손으로 오로라를 찾는 사용은 허용
  return polRuneRecycleNeed(p,powerPips(card(n)))>0;
}

// 조작된 덱 선택용 짧은 자원 시뮬레이션. 현재 행동 단계에서 손패의 동원/촉매를
// 가능한 순서로 사용하고, 이후 내 턴마다 룬 2개를 자연 전개했을 때 오로라를
// 처음 낼 수 있는 턴(0=이번 턴)을 구한다. 실제 G는 변경하지 않는다.
function polMfAuroraTurns(p, extraN, assumeAurora){
  const P=G.players[p], aurora=card(POL_MF.aurora);
  const available=P.hand.includes(POL_MF.aurora) || extraN===POL_MF.aurora || !!assumeAurora;
  if(!available) return Infinity;
  const ramps={
    [POL_MF.mobilize]:P.hand.filter(n=>n===POL_MF.mobilize).length+(extraN===POL_MF.mobilize?1:0),
    [POL_MF.catalyst]:P.hand.filter(n=>n===POL_MF.catalyst).length+(extraN===POL_MF.catalyst?1:0),
  };
  const zeroPower=()=>Object.fromEntries(Object.keys(P.power).map(k=>[k,0]));
  const clone=s=>({runes:s.runes.map(r=>({...r})),deck:[...s.deck],energy:s.energy,
    energySpell:s.energySpell,power:{...s.power},ramps:{...s.ramps}});
  const ready=s=>s.runes.filter(r=>!r.ex).length;
  const spendSpellEnergy=(s,cost)=>{
    let need=cost, use=Math.min(s.energySpell,need); s.energySpell-=use; need-=use;
    use=Math.min(s.energy,need); s.energy-=use; need-=use;
    for(const r of s.runes){ if(need<=0) break; if(!r.ex){r.ex=true;need--;} }
    return need===0;
  };
  const canAurora=s=>{
    const energy=applyCostMods(p,aurora,aurora.e||0);
    if(s.energy+ready(s)<energy) return false; // 오로라는 도구라 주문 전용 에너지를 못 쓴다
    const pool={...s.power}, used=new Set();
    for(const pip of powerPips(aurora)){
      if(pip==='Any'){
        const d=Object.keys(pool).find(k=>pool[k]>0);
        if(d){pool[d]--;continue;}
        const i=s.runes.findIndex((r,j)=>!used.has(j)); if(i<0)return false; used.add(i);
      }else{
        if(pool[pip]>0){pool[pip]--;continue;}
        if(pool.Any>0){pool.Any--;continue;}
        const i=s.runes.findIndex((r,j)=>!used.has(j)&&runeDomain(r.n)===pip); if(i<0)return false; used.add(i);
      }
    }
    return true;
  };
  let frontier=[{runes:P.runes.map(r=>({...r})),deck:[...P.runeDeck],energy:P.energy||0,
    energySpell:P.energySpell||0,power:{...P.power},ramps}];
  for(let turn=0;turn<=4;turn++){
    const ends=[]; let found=false;
    const visit=s=>{
      if(canAurora(s)){found=true;return;}
      ends.push(s);
      for(const n of [POL_MF.catalyst,POL_MF.mobilize]){
        if(!s.ramps[n]||!s.deck.length) continue;
        const ns=clone(s), cost=applyCostMods(p,card(n),card(n).e||0);
        if(ns.energy+ns.energySpell+ready(ns)<cost || !spendSpellEnergy(ns,cost)) continue;
        ns.ramps[n]--;
        const add=Math.min(n===POL_MF.catalyst?2:1,ns.deck.length);
        for(let i=0;i<add;i++) ns.runes.push({n:ns.deck.shift(),ex:true});
        visit(ns);
      }
    };
    frontier.forEach(visit);
    if(found) return turn;
    const next=[], seen=new Set();
    for(const end of ends){
      const ns=clone(end); ns.runes.forEach(r=>r.ex=false);
      for(let i=0;i<2&&ns.deck.length;i++) ns.runes.push({n:ns.deck.shift(),ex:false});
      ns.energy=0;ns.energySpell=0;ns.power=zeroPower();
      const key=ns.runes.map(r=>r.n).sort((a,b)=>a-b).join(',')+'|'+ns.deck.join(',')+'|'+ns.ramps[POL_MF.mobilize]+','+ns.ramps[POL_MF.catalyst];
      if(!seen.has(key)){seen.add(key);next.push(ns);}
    }
    frontier=next;
  }
  return Infinity;
}

// 쌍권총 난사로 실제 지불할 수 있는 힘. 에너지 비용으로 탈진한 룬도 이어서
// 힘으로 재활용할 수 있으므로 준비 상태가 아니라 현재 전개된 룬 전체를 센다.
function polMfBulletPower(p){
  const P=G.players[p];
  return Math.min(10,Object.values(P.power).reduce((a,b)=>a+b,0)+P.runes.length);
}
function polMfBulletPlan(p, showdown){
  if(!polMfAuroraDeck(p)) return null;
  try{ if(TF().preventSpellDmg) return null; }catch(e){}
  const maxP=polMfBulletPower(p);
  if(maxP<1) return null;

  if(showdown){
    const sd=G.showdown;
    if(!sd || !unitsAt(sd.bfIdx).some(u=>u.ctrl===p)) return null;
    const snap0=polSdSnap(p,sd), base=polSdOutcome(p,sd,snap0);
    const succeeds=out=>sd.attacker===p
      ? out.opLeft===0 && out.myLeft>0       // 공격: 적 전멸 + 생존 병력이 있어야 정복
      : out.myLeft>0;                       // 방어: 수비 병력이 살아야 유지
    if(succeeds(base)) return null;          // 이미 유지/정복하는 결전에는 쓰지 않는다
    for(let n=1;n<=maxP;n++){
      const snap={mine:snap0.mine.map(x=>({...x})),theirs:snap0.theirs.map(x=>({...x}))};
      snap.theirs=snap.theirs.filter(x=>{
        if(n>=x.lethal) return false;
        x.lethal-=n; return true;
      });
      const out=polSdOutcome(p,sd,snap);
      if(succeeds(out)) return {bfIdx:sd.bfIdx,damage:n,score:(out.cls-base.cls)*10+(out.exch-base.exch)};
    }
    return null;
  }

  // 일반 행동 단계: 선택한 전장의 모든 적을 한 번에 제거할 수 있을 때만 사용한다.
  let best=null;
  G.bfs.forEach((bf,bfIdx)=>{
    const enemies=bf.units.filter(u=>u.ctrl!==p);
    if(!enemies.length) return;
    if(enemies.some(u=>unitFx(u).noDmgIfMoved2 && (u.turnMoves||0)>=2)) return;
    const damage=Math.max(...enemies.map(u=>Math.max(1,might(u,undefined,{forKill:true})-u.dmg)));
    if(damage>maxP) return;
    const score=enemies.reduce((s,u)=>s+might(u),0)+enemies.length*.5+(bf.controller===opp(p)?1:0);
    if(!best || score>best.score || (score===best.score&&damage<best.damage)) best={bfIdx,damage,score};
  });
  return best;
}

// 전장 병력이 [개입]으로 떠날 때 잃는 기존 통제 가치. 이 비용을 빼지 않으면
// 새 전장 하나를 얻으려고 유지 중인 전장 하나를 비우는 무의미한 횡이동을 한다.
function polMoveSourceLoss(p, units){
  const moving=new Set(units);
  const origins=[...new Set(units.map(u=>u.loc).filter(loc=>loc!=='base'))];
  let loss=0;
  for(const loc of origins){
    const bf=G.bfs[loc];
    if(!bf || bf.controller!==p) continue;
    if(bf.units.some(u=>u.ctrl===p && !moving.has(u))) continue;
    loss += BOT_W.control * Math.min(evalTau(p),3) / 2;
    loss += bf.hiddenCards.filter(h=>h.by===p).length * BOT_W.hidden;
  }
  return loss;
}

// 미스 포츈 전설의 [개입]을 부여하면 실제 정복/무혈 점거가 가능해지는 유닛을 찾는다.
// 기지 병력과 합류하는 경우도 함께 계산한다. 반환값이 없으면 전설을 헛되이 탈진하지 않는다.
function polMfGankTarget(p){
  if(!polMfAuroraDeck(p)) return null;
  const base=G.players[p].base.filter(u=>!u.ex&&!u.stunned).sort((a,b)=>might(b)-might(a));
  const cands=everyUnit().filter(u=>u.ctrl===p && u.loc!=='base' && !u.ex && !u.stunned && !effKw(u).ganking);
  let best=null;
  for(const u of cands){
    for(let dest=0;dest<G.bfs.length;dest++){
      if(dest===u.loc) continue;
      const bf=G.bfs[dest], def=bf.units.filter(x=>x.ctrl!==p);
      if(!def.length && bf.controller===p) continue;
      const send=[u];
      for(let k=0;k<=base.length;k++){
        if(k>0) send.push(base[k-1]);
        let v;
        if(!def.length){
          v=BOT_W.control*Math.min(evalTau(p),3)/2;
          if(!bf.scored[p]) v+=BOT_W.point;
          v-=send.filter(x=>x.loc==='base').reduce((s,x)=>s+might(x),0)*(BOT_W.unitBase-BOT_W.unitBf);
        } else v=evalAttackValue(p,dest,[...send]);
        v-=polMoveSourceLoss(p,send);
        if(!best || v>best.v) best={u,dest,v};
      }
    }
  }
  return best && best.v>BOT_W.moveNeed ? best.u : null;
}

// ══════════ 대상 선택 ══════════
// 카드 텍스트에 "friendly"가 없으면 파서가 spec.side='any'로 두므로(effects.js parseTargetSpec)
// 이로운 효과에도 적 유닛이 후보로 들어온다. 그대로 두면 적을 버프·준비시켜 준다.
// → 프롬프트 문구로 '극성'을 판정해 이로운 효과만 아군으로 돌린다.
//   그 외 경로는 기존 동작(적 최강 / 아군 최강)을 그대로 유지한다 — 중립 문구의 기본값을
//   바꾸면 buff류 chooseUnit이 최약체를 고르게 되어 오히려 퇴행한다(셀프플레이로 확인).
const POL_BENEFIT = /버프할|위력 \+|준비시킬|준비할|치유|회복|사망 방지|부여할|장착할|복사할|재소환/;
const POL_HARM    = /피해|처치|파괴|기절|탈진시킬|위력 -|제거|손패로|통제권|되돌릴 적/;
const POL_SACRI   = /처치|탈진|희생|제물|파괴|버릴|소모/;

function polLegacyUnit(p, c, txt, optional){
  const foes=c.filter(u=>u.ctrl!==p), mine=c.filter(u=>u.ctrl===p);
  const sac=!foes.length && /처치|탈진|희생|제물|파괴|버릴/.test(txt);
  if(sac && optional) return null;
  if(sac) return polWeakest(mine);
  if(foes.length) return polStrongest(foes);
  return polStrongest(mine);
}
POLICY.unit = function(p, candidates, promptText, optional){
  if(!candidates || !candidates.length) return null;
  const txt = String(promptText||'');
  // abilityPlan이 정복 가치까지 계산해 예약한 미스 포츈 전설의 [개입] 대상.
  // 같은 문구를 쓰는 다른 카드 효과와 섞이지 않도록 uid·턴·좌석을 모두 확인한다.
  const gp=POLICY._mfGankTarget;
  if(gp && gp.p===p && gp.tc===G.turnCount && /키워드를 부여할 유닛/.test(txt)){
    const u=candidates.find(x=>x.ctrl===p && x.uid===gp.uid);
    POLICY._mfGankTarget=null;
    if(u){ polSay('unit', unitName(u), '미스 포츈 — 전장 간 정복 경로'); return u; }
  }
  if(!POLICY.ab.unit) return polLegacyUnit(p, candidates, txt, optional);
  if(!polSmart()){
    const i = Math.floor(polHash('u', G.turnCount, txt, candidates.length) * candidates.length);
    return (optional && polHash('uo', G.turnCount, txt) < 0.2) ? null : candidates[i];
  }
  const foes = candidates.filter(u=>u.ctrl!==p);
  const mine = candidates.filter(u=>u.ctrl===p);

  // ① 비용·희생 (후보가 전부 아군인 파괴류) — 가장 약한 것, 선택 가능하면 지불하지 않는다
  if(!foes.length && POL_SACRI.test(txt)){
    if(optional){ polSay('unit', null, '선택적 아군 희생 거절', {txt}); return null; }
    const u = polWeakest(mine);
    polSay('unit', u&&unitName(u), '희생 비용 — 최약체', {txt});
    return u;
  }
  // ② 이로운 효과 — 반드시 아군에게 (자해 방지)
  if(POL_BENEFIT.test(txt) && !POL_HARM.test(txt) && mine.length){
    const u = polStrongest(mine);
    polSay('unit', u&&unitName(u), '이로운 효과 → 아군 최강', {txt});
    return u;
  }
  // ③ 해로운 효과 — 적 중 가장 강한 것
  if(foes.length){
    const u = polStrongest(foes);
    polSay('unit', u&&unitName(u), '해로운 효과 → 적 최강', {txt});
    return u;
  }
  // ④ 그 외(중립 문구·아군 전용) — 기존 동작 유지
  const u = polStrongest(mine);
  polSay('unit', u&&unitName(u), '기본 → 아군 최강', {txt});
  return u;
};

// ══════════ 확인(예/아니오) ══════════
// 기본값을 '예'로 두면 손해가 누적된다([통찰]로 매 턴 자기 드로우를 버리는 등).
// 이득이 분명한 것만 수락한다.
POLICY.confirm = function(p, text, previewCard){
  const txt = String(text||'');
  if(!POLICY.ab.confirm) return true;
  if(!polSmart()) return polHash('c', G.turnCount, txt) < 0.5;

  // 오로라 설치 전 유닛의 [가속]·추가 힘 비용은 룬 수를 줄인다. 이미 만들어 둔
  // 힘 풀로 지불할 수 있는 경우가 아니라면 선택 비용을 거절한다.
  if(polMfAuroraDeck(p) && !polMfAuroraOnline(p)
    && (/\[가속\].*힘 1/.test(txt) || /추가 비용:.*힘/.test(txt))
    && polRuneRecycleNeed(p,['Any'])>0){
    polSay('confirm',false,'미스 포츈 — 오로라 전 룬 재활용 보존');
    return false;
  }

  // [통찰] 덱 맨 위를 아래로 보낼까 — 손패 평균보다 나쁠 때만
  if(/덱 맨 위/.test(txt)){
    const top = previewCard;
    const P = G.players[p];
    if(!top) return false;
    const bad = (top.type==='Rune') || (top.e||0) > 5 || !polCanPlay(p, top);
    polSay('confirm', bad, '[통찰] 덱 맨 위 재활용 판단', {txt:txt.slice(0,30)});
    return bad;
  }
  // [굴절] 추가 지불 — 지불 여력이 있을 때만 (없으면 주문만 날린다)
  if(/굴절/.test(txt)) return true;   // 여기 도달했다는 건 엔진이 canPay를 이미 통과시킨 것
  // 유닛 회수·부활류는 이득
  if(/회수할까요|재소환|되돌릴까요\?$/.test(txt) && /유닛|챔피언/.test(txt)) return true;
  // 전설 능력 발동 — 매 턴 재준비되는 공짜 자원이므로 적극 사용
  if(/전설.*탈진하고 효과를 발동/.test(txt)) return true;
  // 도구를 폐기·탈진하는 대가 — 얻는 것이 분명할 때만
  if(/도구.*폐기/.test(txt)) return false;
  if(/도구를 탈진하고 카드를 뽑/.test(txt)) return true;
  // 버프 소모류 — 버프가 2개 이상 남을 때만
  if(/버프를 소모/.test(txt)){
    const mine = everyUnit().filter(u=>u.ctrl===p && u.buff>0);
    return mine.length >= 2;
  }
  // 추가 비용 지불류 — 자원이 넉넉할 때만
  if(/추가 비용|지불하고|지불할까요/.test(txt)) return readyRunes(p).length >= 3;
  // 함께 이동 — 공격 병력을 늘리는 쪽이므로 수락
  if(/함께 이동/.test(txt)) return true;
  // 폐기장에서 플레이 — 이득
  if(/폐기장/.test(txt)) return true;
  polSay('confirm', true, '기본 수락', {txt:txt.slice(0,30)});
  return true;
};

// ══════════ 수치 선택 ══════════
// 항상 최댓값은 손해다 — spendBuffs는 엔진이 힘 핍 수까지만 할인하는데 보드 전체 버프를 태운다.
POLICY.number = function(p, text, min, max){
  const lo = Math.min(min, max), hi = Math.max(min, max);
  if(!POLICY.ab.number) return hi;
  const clamp = v => Math.max(lo, Math.min(hi, v));
  if(!polSmart()) return clamp(lo + Math.floor(polHash('n', G.turnCount, text) * (hi-lo+1)));
  const txt = String(text||'');
  if(polMfAuroraDeck(p) && /지불할 힘\(✳\) 수/.test(txt)){
    const plan=polMfBulletPlan(p,!!G.showdown);
    POLICY._mfBulletPlan=plan?{p,tc:G.turnCount,sd:G.showdown||null,...plan}:null;
    const n=plan?clamp(plan.damage):clamp(0);
    polSay('number',n,plan?'미스 포츈 — 쌍권총 난사 최소 승리 피해':'미스 포츈 — 유효한 난사 경로 없음');
    return n;
  }
  // 버프 소모 개수 — 필요한 만큼만
  if(/버프/.test(txt)){
    const owned = everyUnit().filter(u=>u.ctrl===p).reduce((s,u)=>s+u.buff,0);
    return clamp(Math.min(owned, lo));
  }
  // 피해 분배는 치사량 단위로 (기본은 최대)
  polSay('number', hi, '기본 최대', {txt:txt.slice(0,24)});
  return clamp(hi);
};

// 이동으로 생긴 전투·득점·이동 트리거까지 실제 엔진으로 비교한다.
// 카드 탐색 중에도 별도 사본을 쓸 수 있지만, 그 안에서 연쇄 이동이 발생하면
// 추가 탐색을 멈춰 비용을 제한한다. 선택 결과는 현재 프롬프트의 번호뿐이다.
async function polMovementOption(p,options){
  const skip=options.find(o=>o.v===null);
  if(typeof SIM==='undefined' || SIM.movementDepth || typeof NET!=='undefined' && NET.online){
    if(options.some(o=>o.returnHand)){
      // 연쇄 효과 안에서는 추가 탐색을 하지 않는다. 소유자·통제자와 토큰을 구분한다.
      const score=o=>{
        if(!o.returnHand) return 0;
        const u=everyUnit().find(x=>x.uid===o.returnHand.uid);
        if(!u) return -1;
        const sign=u.ctrl===p?-1:1, owner=u.owner??u.ctrl;
        return sign*(might(u)*BOT_W.unitBf + (u.loc!=='base' && G.bfs[u.loc].controller===u.ctrl?BOT_W.control:0))
          + (u.isToken?0:owner===p?BOT_W.card:-BOT_W.card);
      };
      return [...options].sort((a,b)=>score(b)-score(a))[0].v;
    }
    if(skip) return skip.v;
    const score=o=>{
      const m=o.movement, u=everyUnit().find(x=>x.uid===m.uid);
      if(!u) return -Infinity;
      const sign=u.ctrl===p?1:-1;
      return sign*((m.dest==='base'?0:evalAttackValue(u.ctrl,m.dest,[u]))-polMoveSourceLoss(u.ctrl,[u]));
    };
    return [...options].sort((a,b)=>score(b)-score(a))[0].v;
  }
  let best=null;
  for(const o of options){
    const value=await simTry(p,async()=>{
      if(o.movement) await resolveEffectMove(p,o.movement);
      if(o.returnHand) await resolveReturnToHand(p,o.returnHand);
      if(options.some(x=>x.returnHand) && G._returnPending && !G.showdown) await polResolveReturnPending();
      await cleanup(p);
    },POLICY,true);
    if(value!==null && (!best || value>best.value+1e-6 || Math.abs(value-best.value)<=1e-6 && o.v===null))
      best={v:o.v,value};
  }
  return best?best.v:skip?skip.v:options[0].v;
}

// ══════════ 옵션 선택 ══════════
// 무작위였다. 배치 위치가 특히 치명적 — 유닛 1기를 적 전장에 떨구면 즉시 결전으로 죽는다.
POLICY.option = function(p, title, options){
  if(!options || !options.length) return null;
  if(options.some(o=>o.movement || o.returnHand)) return polMovementOption(p,options);
  const txt = String(title||'');
  if(polMfAuroraDeck(p)){
    if(/피해를 줄 전장/.test(txt)){
      const bp=POLICY._mfBulletPlan;
      POLICY._mfBulletPlan=null;
      if(bp && bp.p===p && bp.tc===G.turnCount && bp.sd===(G.showdown||null)){
        const pick=options.find(o=>o.v===bp.bfIdx);
        if(pick){ polSay('option',pick.label,'미스 포츈 — 쌍권총 난사 목표 전장'); return pick.v; }
      }
    }
    // 오로라가 무료 플레이한 죽음꽃 포식자 같은 유닛은 자체 허용 효과에 따라
    // 유지된 적 전장에 직접 배치할 수 있다. 정복 가치가 양수인 적 전장이면 기지보다 우선한다.
    if(/유닛을 배치할 위치/.test(txt)){
      const unitN=options.find(o=>o.unitN!==undefined)?.unitN;
      const fx=unitN!==undefined?(FX[unitN]||{}):{};
      if(unitN!==undefined && fx.playToEnemyBf){
        const vu={n:unitN,uid:-1,ctrl:p,loc:'base',isToken:false,ex:false,stunned:false,
          dmg:0,buff:0,tempM:[],gear:[],grants:{},turnMoves:0};
        const enemy=options.filter(o=>/^적 전장:/.test(o.label) && typeof o.v==='number')
          .map((o,i)=>{ let v=-Infinity; try{ v=evalAttackValue(p,o.v,[vu]); }catch(e){} return {o,i,v}; })
          .sort((a,b)=>b.v-a.v || a.i-b.i)[0];
        if(enemy && enemy.v>BOT_W.moveNeed){
          polSay('option',enemy.o.label,'미스 포츈 — 오로라 무료 유닛으로 적 전장 정복',{value:enemy.v});
          return enemy.o.v;
        }
      }
    }
    // 파괴 공작/정신을 가르는 자가 공개한 상대 손패.
    // 오로라 전에는 엔진 조각을 손에서 끊을 카드를 먼저 없애고, 설치 후에는
    // 오로라 자체를 보드에서 지울 수 있는 카드를 최우선으로 없앤다.
    if(/버리게 할 카드|재활용시킬 카드/.test(txt)){
      const online=polMfAuroraOnline(p);
      const ranked=options.map((o,i)=>{
        const primary=(online?POL_MF_AURORA_HATE:POL_MF_HAND_ATTACK).get(o.n)||0;
        const secondary=(online?POL_MF_HAND_ATTACK:POL_MF_AURORA_HATE).get(o.n)||0;
        return {o,i,score:primary*1000+secondary};
      }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score || a.i-b.i);
      if(ranked.length){
        const pick=ranked[0].o;
        polSay('option', pick.label, online
          ? '미스 포츈 — 눈부신 오로라 제거 위협 차단'
          : '미스 포츈 — 손패 파괴 위협 차단');
        return pick.v;
      }
    }
    // 조작된 덱: 엔진 조각을 찾되, 선택지가 전부 유닛이면 오로라가 공짜로 뽑을
    // 고비용 유닛을 덱에 남기고 가장 작은 유닛을 손으로 가져온다.
    if(/손패에 넣을 카드/.test(txt)){
      const P=G.players[p], online=polMfAuroraOnline(p);
      const auroraOpt=options.find(o=>o.n===POL_MF.aurora);
      const rampOpts=options.filter(o=>o.n===POL_MF.catalyst||o.n===POL_MF.mobilize);
      const hasAurora=P.hand.includes(POL_MF.aurora);
      const auroraTurns=auroraOpt&&!hasAurora&&!online ? polMfAuroraTurns(p,POL_MF.aurora,false) : Infinity;

      // 다음 1~2번의 내 턴 안에 낼 수 있으면 먼저 확보한다. 특히 현재 손패 가속과
      // 다음 턴 자연 전개 2개로 1턴 뒤 가능한 경우가 최우선이다.
      if(auroraOpt && !hasAurora && !online && auroraTurns<=2){
        polSay('option',auroraOpt.label,'미스 포츈 — '+auroraTurns+'턴 내 오로라 확보');
        return auroraOpt.v;
      }
      // 이미 오로라가 손에 있거나, 지금 집어도 3턴 이상 걸리면 자원 병목부터 푼다.
      if(!online && rampOpts.length && (hasAurora || auroraTurns>=3)){
        const ranked=rampOpts.map((o,i)=>({o,i,turns:polMfAuroraTurns(p,o.n,true),
          channel:o.n===POL_MF.catalyst?2:1,
          now:polCanPlay(p,card(o.n))?1:0})).sort((a,b)=>
            a.turns-b.turns || b.now-a.now || b.channel-a.channel || a.i-b.i);
        const pick=ranked[0];
        polSay('option',pick.o.label,'미스 포츈 — 오로라 자원 가속 선택',{turns:pick.turns});
        return pick.o.v;
      }
      // 가속 선택지가 없으면 오로라를 놓치지는 않는다.
      if(auroraOpt && !hasAurora && !online){
        polSay('option',auroraOpt.label,'미스 포츈 — 오로라 확보 (가속 선택지 없음)',{turns:auroraTurns});
        return auroraOpt.v;
      }

      const score=o=>{
        const n=o.n, c=n!==undefined?card(n):null;
        if(n===POL_MF.stacked && !polMfAuroraOnline(p)) return 7000;
        if(!c) return -10000;
        if(c.type!=='Unit') return 1000-polCost(c);
        return -(c.e||0)*10-(c.m||0); // 가장 작은 오로라 표적부터 손으로
      };
      const pick=[...options].sort((a,b)=>score(b)-score(a))[0];
      polSay('option', pick.label, '미스 포츈 — 엔진 탐색·고비용 유닛 보존');
      return pick.v;
    }
    // 상대 효과 등으로 도구를 잃어야 할 때 오로라를 가능한 한 보존한다.
    if(/폐기할 도구 선택/.test(txt)){
      const pick=options.find(o=>o.n!==POL_MF.aurora) || options[0];
      polSay('option', pick.label, '미스 포츈 — 눈부신 오로라 보존');
      return pick.v;
    }
    // 경이의 꾸러미가 이미 가동 중인 오로라를 손으로 되돌리는 것을 막는다.
    if(/손패로 되돌릴 대상/.test(txt)){
      const pick=options.find(o=>o.n!==POL_MF.aurora) || options[0];
      polSay('option', pick.label, '미스 포츈 — 눈부신 오로라 유지');
      return pick.v;
    }
  }
  // 숨길 전장은 반드시 안전한 곳으로. 아래 일반 '전장' 분기는 적이 많은 곳을 고르는데,
  // 숨기기에 한해서는 그게 정확히 최악의 선택이다 (통제를 잃으면 폐기된다).
  if(/숨길 전장/.test(txt)){
    const safe = options.find(o => {
      const i = G.bfs.findIndex(bf => o.label && o.label.includes(card(bf.n).ko));
      return i >= 0 && !G.bfs[i].units.some(u => u.ctrl !== p);
    });
    const pick = safe || options[0];
    polSay('option', pick.label, '숨기기 — 적 없는 전장');
    return pick.v;
  }
  // 유닛 배치 위치 — 기지가 기본이다.
  // 기지에 두면 같은 턴에 어디로든 이동할 수 있으니 전장 직행보다 정보가 늦게 굳는다.
  // 예외는 '통제 중인데 유닛이 없는 전장' — 그대로 두면 다음 개시에 무주공산이 되어 유지 수입이 끊긴다.
  // (전장 보강을 기본으로 삼는 쪽은 실측에서 오히려 나빴다 — 수비적 배치가 곧 소극적 플레이가 된다)
  if(POLICY.ab.place && /배치할 위치|배치/.test(txt)){
    const bfOpt = i => options.find(o => /^전장:/.test(o.label) && o.label.includes(card(G.bfs[i].n).ko));
    for(let i = 0; i < G.bfs.length; i++){
      if(G.bfs[i].controller !== p) continue;
      if(G.bfs[i].units.some(u => u.ctrl === p)) continue;
      const o = bfOpt(i);
      if(o){ polSay('option', o.label, '빈 통제 전장 지키기'); return o.v; }
    }
    const base = options.find(o => /기지/.test(o.label));
    if(base){ polSay('option', base.label, '기지 — 이동 여지를 남긴다'); return base.v; }
  }
  if(!POLICY.ab.option) return options[Math.floor(polHash('o',G.turnCount,txt,options.length)*options.length)].v;
  if(!polSmart()) return options[Math.floor(polHash('o', G.turnCount, txt, options.length)*options.length)].v;

  // 유닛 배치 위치 — label이 '기지' / '전장: 이름' / '⚠ ... 미통제' 형태
  if(/배치할 위치|배치/.test(txt)){
    const base = options.find(o=>/기지/.test(o.label));
    const safe = options.filter(o=>/^전장:/.test(o.label));
    // 통제 중인 전장에 보강할 가치가 있으면 그쪽, 아니면 기지 (적 전장 단독 배치 금지)
    for(const o of safe){
      const i = G.bfs.findIndex(bf=>o.label.includes(card(bf.n).ko));
      if(i>=0 && G.bfs[i].controller===p){
        polSay('option', o.label, '통제 전장 보강');
        return o.v;
      }
    }
    if(base){ polSay('option', base.label, '안전한 기지 배치'); return base.v; }
    return options[0].v;
  }
  // 전장 선택 — 적 유닛이 가장 많은 곳(효과 대상이 많음)
  if(/전장/.test(txt)){
    let best=options[0], bestN=-1;
    options.forEach(o=>{
      const i = G.bfs.findIndex(bf=>o.label && o.label.includes(card(bf.n).ko));
      if(i<0) return;
      const n = G.bfs[i].units.filter(u=>u.ctrl!==p).length;
      if(n>bestN){ bestN=n; best=o; }
    });
    polSay('option', best.label, '적 유닛이 많은 전장');
    return best.v;
  }
  return options[0].v;
};

// ══════════ 손패에서 버릴 카드 ══════════
// 비용만 보고 '가장 비싼 카드 = 가장 나쁜 카드'로 판단하면 덱의 피니셔를 항상 먼저 버린다.
POLICY.hand = function(p, title){
  const h = G.players[p].hand;
  if(!h.length) return null;
  if(!POLICY.ab.hand){ let b=0; h.forEach((n,i)=>{ if((card(n).e||0)>(card(h[b]).e||0)) b=i; }); return b; }
  if(!polSmart()) return Math.floor(polHash('h', G.turnCount, h.length) * h.length);
  const myDoms = new Set(G.players[p].runes.map(r=>runeDomain(r.n)));
  const score = (n) => {
    const c = card(n);
    let s = 0;
    // 내 룬 영역과 안 맞는 카드가 최우선 폐기 대상
    if(c.dom && c.dom.length && !c.dom.some(d=>myDoms.has(d) || d==='Colorless')) s += 100;
    // 같은 카드를 여러 장 들고 있으면 하나는 버려도 됨
    if(h.filter(x=>x===n).length > 1) s += 30;
    // 이번 턴 못 내는 카드
    if(!polCanPlay(p, c)) s += 20;
    s += polCost(c);           // 비싼 쪽이 약간 더 버리기 쉬움
    if(c.super==='Champion') s -= 60;   // 챔피언은 지킨다
    if(polMfAuroraDeck(p) && !polMfAuroraOnline(p)){
      if(n===POL_MF.aurora || n===POL_MF.catalyst || n===POL_MF.mobilize) s -= 200;
      else if(n===POL_MF.stacked && !h.includes(POL_MF.aurora)) s -= 100;
    }
    return s;
  };
  let best = 0;
  h.forEach((n,i)=>{ if(score(n) > score(h[best])) best = i; });
  polSay('hand', card(h[best]).ko, '영역 불일치·중복 우선 폐기');
  return best;
};

// ══════════ 응수(반응) ══════════
POLICY.reaction = async function(p, title, options){
  if(!options || !options.length) return null;
  if(!polSmart()) return null;
  if(!POLICY.ab.reaction){ const c=options.find(o=>o.isCounter); return c?c.v:null; }
  // 카운터는 체인에 상대 주문이 실제로 있을 때만 (없으면 효과 없이 폐기된다)
  const chainHasEnemy = G.showdown && G.showdown.chain &&
    G.showdown.chain.some(it => it.p !== p && it.kind !== 'ability');
  const counter = options.find(o=>o.isCounter);
  if(counter && (chainHasEnemy || !G.showdown)){
    polSay('reaction', counter.label, '카운터 사용');
    return counter.v;
  }
  const pending=options[0].pendingSpell;
  const returns=options.filter(o=>o.card && polIsReturnSpell(o.card.n));
  if(pending && returns.length && !SIM.lock && !NET.online){
    const finish=async()=>{ G._returnPending=pending;await polResolveReturnPending();await cleanup(pending.p); };
    const before=await simTry(p,finish,POLICY);
    let best=null;
    for(const o of returns){
      const after=await simTry(p,async()=>{
        G._rwFor=p;G._returnPending=pending;
        await playCardFromHand(p,o.v);
        await finish();
      },POLICY);
      if(before!==null && after!==null && after>before+BOT_W.moveNeed && (!best || after>best.value)) best={v:o.v,value:after};
    }
    if(best) return best.v;
  }
  return null;   // 일반 [반응]은 결전용으로 아낀다
};

// ══════════ 멀리건 ══════════
POLICY.mulligan = function(p){
  const h = G.players[p].hand;
  // 선공의 첫 전개는 룬 2개, 후공의 첫 전개는 룬 3개다. G.turn은 멀리건 동안
  // 첫 턴 플레이어를 유지하므로, 봇 좌석과 비교해 어느 쪽인지 판단할 수 있다.
  const openingRunes = G.turn===p ? 2 : 3;
  const cost=i=>(card(h[i]).e||0);
  const openingPlay=i=>{
    const c=card(h[i]);
    // 룬 하나는 에너지와 힘을 함께 낼 수 있으므로 둘 중 큰 요구량만큼의 룬이 필요하다.
    return ['Unit','Gear'].includes(c.type) && Math.max(cost(i), powerPips(c).length)<=openingRunes;
  };
  if(polMfAuroraDeck(p)){
    // 엔진 조각은 비용과 무관하게 한 장씩 보존한다. 중복 조각과 오로라가 공짜로
    // 소환해야 할 고비용 유닛을 우선 되돌리고, 조각이 빠졌을 때만 일반 카드를 교체한다.
    const core=new Set([POL_MF.mobilize,POL_MF.catalyst,POL_MF.aurora]);
    const missing=[...core].some(n=>!h.includes(n));
    const seen=new Set();
    const ranked=[];
    h.forEach((n,i)=>{
      const c=card(n); let score=-Infinity;
      if(core.has(n)){
        if(seen.has(n)) score=300+polCost(c); else seen.add(n);
      } else if(c.type==='Unit' && (c.e||0)>=7) score=250+(c.e||0);
      else if(missing && n!==POL_MF.stacked) score=100+polCost(c);
      if(score>-Infinity) ranked.push({i,score});
    });
    const swap=ranked.sort((a,b)=>b.score-a.score).slice(0,2).map(x=>x.i);
    polSay('mulligan', swap.length+'장 교체', '미스 포츈 — 동원·촉매·오로라 조립');
    return swap;
  }
  if(!POLICY.ab.mulligan){ const idxs=h.map((n,i)=>i);
    const cheap=idxs.filter(openingPlay);
    const bw=[...idxs].sort((a,b)=>cost(b)-cost(a));
    return cheap.length?bw.filter(i=>cost(i)>=5).slice(0,2):bw.slice(0,2); }
  if(!polSmart()){
    const idxs=h.map((n,i)=>i);
    const worst=[...idxs].sort((a,b)=>cost(b)-cost(a));
    const cheap=idxs.filter(openingPlay);
    return cheap.length ? worst.filter(i=>cost(i)>=5).slice(0,2) : worst.slice(0,2);
  }
  const idxs = h.map((n,i)=>i);
  // 첫 턴 룬 수에 맞는 유닛·기어를 확보하고, 고비용부터 교체한다.
  // 영역(색) 불일치는 멀리건 판단에 고려하지 않는다.
  const cheap = idxs.filter(openingPlay);
  const worst = [...idxs].sort((a,b)=>cost(b)-cost(a));
  const swap = cheap.length ? worst.filter(i=>cost(i)>=5).slice(0,2) : worst.slice(0,2);
  polSay('mulligan', swap.length+'장 교체', `${G.turn===p?'선공':'후공'} ${openingRunes}룬 플레이 확보 · 고비용 우선`);
  return swap;
};

// ══════════ 전투 피해 배분 순서 ══════════
// assignDamage는 고른 유닛에 정확히 치사량만 준다 → 치사량이 작은 것부터 골라야 처치 수가 최대가 된다.
// (공격 4 vs 방어 [3,2,2]: 최강자부터면 1처치, 치사량 오름차순이면 2처치)
POLICY.assignTarget = function(p, candidates, remain, role){
  if(!candidates.length) return null;
  if(!polSmart()) return candidates[0];
  const lethal = u => Math.max(1, might(u, role, {forKill:true}) - u.dmg);  // 기절 유닛도 원래 위력만큼 필요 (룰 410.1.c)
  const killable = candidates.filter(u=>lethal(u) <= remain);
  const pool = killable.length ? killable : candidates;
  const u = [...pool].sort((a,b)=>lethal(a)-lethal(b))[0];
  polSay('assign', unitName(u), '치사량 오름차순 — 처치 수 최대화', {remain});
  return u;
};

// ══════════ 자원 예약 ══════════
// 엔진은 endTurn에서 룬 상태를 건드리지 않으므로, 내 턴에 안 쓴 준비 룬이
// 상대 턴 [반응]의 유일한 자원이다. 전부 소진하면 응수 창 자체가 열리지 않는다.
POLICY.reserve = function(p){
  if(!POLICY.ab.reserve || !polTier().reserve) return 0;
  if(!polHard()) return 0;
  const P = G.players[p], o = opp(p);
  // 상대가 칠 게 없으면 예약은 순수 낭비
  const threat = everyUnit().some(u=>u.ctrl===o && !u.ex) || G.bfs.some(bf=>bf.controller===p);
  if(!threat) return 0;
  const tricks = P.hand.filter(n=>{ const fx=FX[n]||{kw:{}}; return fx.kw.action||fx.kw.reaction; });
  if(!tricks.length) return 0;
  const cheapest = Math.min(...tricks.map(n=>polCost(card(n))));
  return Math.min(3, cheapest);
};

// 보드의 유닛 위치를 바꾸는 주문은 일반 주문 점수만으로 내면 안 된다. 카드명 대신
// 컴파일된 효과 op를 보므로 같은 효과를 쓰는 새 카드도 자동으로 이 경로를 탄다.
// 규칙상 '이동'이 아닌 귀환/손패 복귀도 전장 통제를 비우는 판단은 같아서 함께 본다.
const POL_RELOCATE_OPS = new Set([
  'moveUnit','moveSpec','moveItToBf','moveFriendlyToItsBf','tideTurner','buffAndMove','yasuoMove',
  'stormbringer','dragonRage','bounce','bounceSpec','whirlwind','wonderBundle',
  'recall','recallAll','recallIt','recallSelf','retreatOp','portalRescue',
]);
function polHasRelocateOp(value, seen, ops=POL_RELOCATE_OPS){
  if(!value || typeof value!=='object') return false;
  if(!seen) seen=new Set();
  if(seen.has(value)) return false;
  seen.add(value);
  if(Array.isArray(value)) return value.some(v=>polHasRelocateOp(v,seen,ops));
  if(ops.has(value.op)) return true;
  // chooseOne/optional/조건부 op 안쪽까지 훑는다. 숫자·spec 같은 일반 필드는 즉시 끝난다.
  return ['ops','elseOps','inner','branches'].some(k=>polHasRelocateOp(value[k],seen,ops));
}
const POL_RETURN_OPS=new Set(['bounce','bounceSpec','retreatOp','whirlwind','wonderBundle']);
function polIsReturnSpell(n){
  return card(n).type==='Spell' && polHasRelocateOp(FX[n]?.playOps,null,POL_RETURN_OPS);
}
async function polResolveReturnPending(){
  const pending=G._returnPending;
  if(!pending) return;
  G._returnPending=null;
  await resolveSpellEffects(pending.p,pending.n,FX[pending.n],pending);
}
// 결전의 패스 결과(체인과 전투 포함)와 카드 사용 결과를 비용까지 포함해 비교한다.
async function polReturnShowdownAction(p){
  if(!POLICY.ab.showdown || SIM.lock || NET.online) return null;
  const candidates=[];
  G.players[p].hand.forEach((n,idx)=>{
    if(polIsReturnSpell(n) && polCanPlay(p,card(n))) candidates.push({kind:'play',idx,n});
  });
  G.bfs.forEach((bf,bfIdx)=>{
    const h=bf.hiddenCards.find(x=>x.by===p && !(x.turn===G.turnCount && G.turn===p));
    if(h && polIsReturnSpell(h.n)) candidates.push({kind:'hidden',bfIdx,n:h.n});
  });
  if(!candidates.length) return null;
  const before=await simTry(p,async()=>{},POLICY);
  if(before===null) return null;
  let best=null;
  for(const act of candidates){
    const after=await simTry(p,()=>POLICY.runAction(p,act),POLICY);
    if(after!==null && after>before+BOT_W.moveNeed && (!best || after>best.value)) best={act,value:after};
  }
  if(best) polSay('showdown',card(best.act.n).ko,'손패 복귀로 결전 결과 개선',{delta:best.value-before});
  return best?.act||null;
}
function polIsRelocationSpell(n){
  const c=card(n), fx=FX[n]||{};
  return c.type==='Spell' && polHasRelocateOp(fx.playOps||[]);
}

// 실제 엔진으로 카드를 한 번 사용한 결과와 현재 상태(=사용 안 함)를 비교한다.
// simTry가 결전까지 해결하고 원본 G를 복원하므로, 대상 없음·헛이동·통제 약화가 모두
// 같은 evalState 잣대로 걸러진다. 샌드박스 안에서는 재진입하지 않는다.
async function polGateRelocationSpells(p, cands){
  if(!cands.some(c=>polIsRelocationSpell(c.n))) return cands;
  if(typeof simTry!=='function' || typeof evalState!=='function') return cands;
  if(typeof NET!=='undefined' && NET.online) return cands;
  if(typeof SIM!=='undefined' && (SIM.active||SIM.lock)) return cands;
  const base=evalState(G,p), need=Math.max(0,BOT_W.moveNeed||0), kept=[];
  for(const c of cands){
    if(!polIsRelocationSpell(c.n)){ kept.push(c); continue; }
    const v=await simTry(p,async()=>{
      const i=G.players[p].hand.indexOf(c.n);
      if(i>=0) await playCardFromHand(p,i);
    },POLICY);
    if(v!==null && v>base+need){
      c.stateDelta=v-base;
      if(polIsReturnSpell(c.n)) c.score=Math.max(c.score,30-polCost(card(c.n)));
      kept.push(c);
      polSay('play-check',card(c.n).ko,'이동 주문 사용 이득',{before:base,after:v,delta:v-base});
    }else{
      polSay('play-check',card(c.n).ko,v===null?'이동 주문 시뮬레이션 실패':'이동 주문 사용 안 함 우세',
        {before:base,after:v,delta:v===null?null:v-base});
    }
  }
  return kept;
}

// ══════════ 플레이할 카드 고르기 ══════════
POLICY.pickPlay = async function(p, blocked){
  const P = G.players[p];
  const budget = readyRunes(p).length - POLICY.reserve(p);
  let cands = [];
  P.hand.forEach((n,i)=>{
    if(blocked && blocked.has('h'+n)) return;
    const c = card(n);
    if(POLICY.ab.canpay ? !polCanPlay(p, c) : polCost(c) > readyRunes(p).length) return;
    if(POLICY.ab.reserve && polCost(c) > Math.max(0, budget)) return;  // 상대 턴 응수분은 남긴다
    if(polMfNeutralCardBlocked(p,n)) return;
    // 일반 행동 단계의 난사는 오로라를 설치한 뒤, 한 전장을 완전히 쓸어버릴 때만 후보가 된다.
    if(polMfAuroraDeck(p) && n===POL_MF.bulletTime
      && (!polMfAuroraOnline(p) || !polMfBulletPlan(p,false))) return;
    const fx = FX[n]||{kw:{}};
    let score;
    // 준비 룬이 생기는 다음 내 턴을 앞당기는 순서. 오로라를 지금 낼 수 있으면
    // 추가 가속보다 먼저 설치해 이번 종료 단계부터 무료 소환을 받는다.
    if(polMfAuroraDeck(p) && !polMfAuroraOnline(p) && n===POL_MF.invert) score=6500;
    else if(polMfAuroraDeck(p) && n===POL_MF.bulletTime) score=500;
    else if(polMfAuroraDeck(p) && !polMfAuroraOnline(p) && n===POL_MF.aurora) score=10000;
    else if(polMfAuroraDeck(p) && !polMfAuroraOnline(p)
      && n===POL_MF.catalyst && P.runeDeck.length>=2) score=9000;
    else if(polMfAuroraDeck(p) && !polMfAuroraOnline(p)
      && n===POL_MF.mobilize && P.runeDeck.length>=1) score=8500;
    else if(polMfAuroraDeck(p) && !polMfAuroraOnline(p)
      && n===POL_MF.stacked && !P.hand.includes(POL_MF.aurora)) score=7000;
    else if(c.type==='Unit') score = 100 + (c.m||0)*2 - polCost(c)*BOT_W.playCost;
    else if(c.type==='Gear') score = 50 - polCost(c);
    else if(polHard() && (fx.kw.action||fx.kw.reaction)) score = -1;   // 결전용으로 아낌
    else score = 30 - polCost(c);
    cands.push({ i, n, score });
  });
  cands = await polGateRelocationSpells(p,cands);
  POLICY._playScore = -Infinity;
  if(!cands.length) return -1;
  cands.sort((a,b)=>b.score-a.score);
  const top = cands[0];
  if(top.score < 0 && P.hand.length <= 4) return -1;   // 아껴둔 트릭만 남음
  POLICY._playScore = top.score;
  polSay('play', card(top.n).ko, '가치 순', {score:top.score});
  return top.i;
};

// ══════════ 손패 플레이 vs 챔피언 ══════════
// 예전엔 손패를 다 소진한 뒤에야 챔피언을 냈다. 챔피언은 대개 덱에서 가장 강한 유닛이라
// 순서를 뒤로 미루는 것 자체가 손해다 — 같은 잣대로 견줘 더 좋은 쪽을 먼저 낸다.
POLICY.playPlan = async function(p, ctx){
  const P = G.players[p];
  const idx = await POLICY.pickPlay(p, ctx.tried);
  const handAct = idx >= 0 ? { kind:'play', idx, n:P.hand[idx] } : null;
  const champOk = P.champInZone && !ctx.tried.has('champ') && polCanPlay(p, card(P.champN))
    && !polMfNeutralCardBlocked(p,P.champN);
  if(!champOk) return handAct;
  if(!POLICY.ab.champ || !polSmart()) return handAct || { kind:'champ' };
  const cs = card(P.champN);
  const champScore = 100 + (cs.m||0)*2 - polCost(cs);
  if(handAct && POLICY._playScore > champScore) return handAct;
  polSay('play', cs.ko, '챔피언 우선', {champScore, best:POLICY._playScore});
  return { kind:'champ' };
};

// ══════════ 승점 레이스 ══════════
POLICY.race = function(p){
  const o = opp(p), V = G.victory;
  const ctrl = q => G.bfs.filter(bf=>bf.controller===q && bf.units.some(u=>u.ctrl===q)).length;
  const myPts = G.players[p].points, opPts = G.players[o].points;
  return {
    V, myPts, opPts,
    myCtrl: ctrl(p), opCtrl: ctrl(o),
    // 상대가 다음 개시에 유지만으로 이기는가
    oppLethal: opPts + ctrl(o) >= V,
    // 내가 유지만으로 이기는가 (유지는 최종 점수 제한 면제)
    myLethal: myPts + ctrl(p) >= V,
    // 최종 점수 제한: 7점 이상이면 정복은 그 턴 모든 전장 득점 시에만
    finalPointRule: myPts >= V-1,
  };
};

// 상대가 '다음 턴에 손패에서 꺼내 보낼' 유닛들 (열람 티어 전용).
// 봇끼리는 낸 유닛을 곧바로 전장으로 보내기 때문에 상대 기지는 대개 비어 있다
// (실측: 위협 측정의 62%가 '상대 병력 없음'). 즉 현재 보드만 보면 위협이 영원히 0이다.
// 손패를 볼 수 있는 티어만 진짜 위협 — 아직 내지 않은 유닛 — 을 계산에 넣을 수 있다.
// 반환: might()가 그대로 동작하는 가상 유닛 배열 (보드에 넣지 않으므로 G는 그대로다)
function polPeekIncoming(p){
  if(!polTier().peek) return [];
  const o = opp(p);
  let budget = readyRunes(o).length + 2;      // 다음 턴 전개(각성+전개 2개)까지 감안
  const out = [];
  G.players[o].hand.map(n => ({n, c:card(n)}))
    .filter(x => x.c.type === 'Unit')
    .sort((a,b) => (b.c.m||0) - (a.c.m||0))
    .forEach(x => {
      const cost = polCost(x.c);
      if(cost > budget) return;
      budget -= cost;
      out.push({ n:x.n, uid:-1, ctrl:o, loc:'base', isToken:false, ex:false, stunned:false,
                 dmg:0, buff:0, tempM:[], gear:[], grants:{}, turnMoves:0 });
    });
  return out;
}

// 전장 i가 얼마나 위험한가 — 상대 시점에서 최선의 공격이 상대에게 주는 값.
// 내 잣대(evalAttackValue)를 상대 좌석으로 돌려 쓴다. 규칙이 한 곳에만 있으므로 어긋나지 않는다.
// extra: 내가 보강하려는 유닛들 (아직 보내지 않았지만 방어에 합류한다고 가정)
function polThreatAt(p, i, extra){
  const o = opp(p);
  const atk = G.players[o].base.filter(u=>!u.ex && !u.stunned)
    .concat(polPeekIncoming(p))
    .sort((a,b)=>might(b)-might(a));
  if(!atk.length) return -Infinity;
  let best = -Infinity;
  const send = [];
  for(const u of atk){
    send.push(u);
    const v = evalAttackValue(o, i, [...send], extra);
    if(v > best) best = v;
  }
  return best;
}

// ══════════ 이동 계획 ══════════
POLICY.movePlan = function(p){
  const o = opp(p);
  const baseMovable = G.players[p].base.filter(u=>!u.ex && !u.stunned);
  // master 미스 포츈은 전설로 얻은 [개입]과 원래 가진 [개입]을 실제 이동 후보로 쓴다.
  const gankMovable = polMfAuroraDeck(p) ? everyUnit().filter(u=>u.ctrl===p && u.loc!=='base'
    && !u.ex && !u.stunned && effKw(u).ganking) : [];
  const movable = baseMovable.concat(gankMovable);
  if(!movable.length) return null;
  if(!polSmart()){
    if(polHash('m', G.turnCount) < 0.4) return null;
    const units = movable.filter((u,i)=>polHash('mu', G.turnCount, i) < 0.6);
    if(!units.length) return null;
    return { units, dest: Math.floor(polHash('md', G.turnCount)*2) };
  }
  const weakestFirst = [...movable].sort((a,b)=>might(a)-might(b));
  if(!POLICY.ab.move || !polTier().move){
    const empty0=G.bfs.map((bf,i)=>({bf,i})).filter(x=>x.bf.units.length===0&&x.bf.controller!==p);
    let margin0 = polHard()?0:1;
    if(polHard() && G.players[o].points>=G.victory-2) margin0=-2;
    if(empty0.length) return { units: weakestFirst.slice(0, polHard()?1:2), dest: empty0[0].i };
    for(let i=0;i<G.bfs.length;i++){
      const bf=G.bfs[i]; const def=bf.units.filter(u=>u.ctrl===o);
      if(!def.length) continue;
      const dm=def.reduce((s,u)=>s+might(u,'defender'),0);
      const atk=[...movable].sort((a,b)=>might(b)-might(a));
      let sum=0; const send=[];
      for(const u of atk){ send.push(u); sum+=might(u,'attacker'); if(sum>dm+margin0) break; }
      if(sum>dm+margin0) return { units:send, dest:i };
    }
    return null;
  }

  // ── 평가 함수 기반: 후보를 만들어 값이 가장 큰 것을 고른다 ──
  // 전군 올인만 보던 것을 부분 출격까지 넓힌다. 빈 전장 점거는 이번 턴 득점 여부와 무관하게
  // 통제 자체가 다음 턴 유지 수입이므로 후보에 넣는다.
  const cands = [];
  for(let i=0;i<G.bfs.length;i++){
    const bf = G.bfs[i];
    const def = bf.units.filter(u=>u.ctrl===o);
    // 기지 유닛은 모든 전장으로, [개입] 유닛은 현재 위치가 아닌 전장으로 갈 수 있다.
    const legal=movable.filter(u=>u.loc==='base' || u.loc!==i);
    if(!legal.length) continue;
    const byStrong=[...legal].sort((a,b)=>might(b)-might(a));
    if(!def.length){
      // 무혈 점거 — 최소 병력만 보낸다 (기지를 비우면 반격에 취약)
      if(bf.controller !== p){
        // 이미 통제 중인 전장을 비우기보다 기지의 가장 약한 병력을 먼저 쓴다.
        const send = [...legal].sort((a,b)=>
          (a.loc==='base'?0:1)-(b.loc==='base'?0:1) || might(a)-might(b)).slice(0,1);
        let v = BOT_W.control * Math.min(evalTau(p),3)/2;
        if(!bf.scored[p]) v += BOT_W.point;          // 정복 1점
        v -= send.filter(u=>u.loc==='base').reduce((s,u)=>s+might(u),0) * (BOT_W.unitBase - BOT_W.unitBf);
        v -= polMoveSourceLoss(p,send);
        cands.push({ units:send, dest:i, v, why:'무혈 점거' });
        continue;
      }
      // 이미 통제 중인 전장 지키기 — 봇은 여기를 한 번도 보강하지 않았다.
      // 통제 전장은 매 개시 1점이므로, 빼앗기는 것은 유닛 하나를 잃는 것보다 비싸다.
      // 상대 기지의 출격 가능 병력이 내 주둔군을 넘어설 때만, 넘길 만큼만 보낸다.
      if(!POLICY.ab.defend) continue;
      if(!bf.units.some(u=>u.ctrl===p)) continue;
      // 위협의 크기는 '상대가 이 전장을 쳤을 때 상대가 얻는 값'으로 잰다.
      // 위력 합 비교로는 상대가 애초에 공격할 생각이 없는 전장까지 지키려 들었다(실측: 판당 0.09회).
      const t0 = polThreatAt(p, i);
      if(t0 <= 0.05) continue;
      const send = [];
      for(const u of byStrong){
        send.push(u);
        const t1 = polThreatAt(p, i, send);
        if(t1 < 0){                                   // 보강 후엔 상대가 쳐도 손해
          cands.push({ units:[...send], dest:i, why:'수비 보강 '+send.length+'기',
            v: t0 * 0.6 - polMoveSourceLoss(p,send) }); // 막아낸 위협의 60% (상대가 실제로 칠지는 모른다)
          break;
        }
      }
      continue;
    }
    // 부분 출격: 강한 순 프리픽스 집합을 전부 후보로 — 턴 플랜(탐색)이 있으면 그에 따른다
    const plan = (POLICY.turnPlan && POLICY.turnPlan.p===p && POLICY.turnPlan.tc===G.turnCount) ? POLICY.turnPlan : null;
    if(plan && plan.noAttack) continue;
    if(plan && plan.focusBf!==undefined && plan.focusBf!==i) continue;
    const send = [];
    for(const u of byStrong){
      send.push(u);
      const v = evalAttackValue(p, i, [...send]) - polMoveSourceLoss(p,send);
      cands.push({ units:[...send], dest:i, v, why:'공격 '+send.length+'기' });
    }
    // 총공격 플랜: 출격 가능 전원을 이 전장에 (평가와 무관하게 최우선 후보로)
    if(plan && plan.allin && plan.focusBf===i && byStrong.length)
      cands.push({ units:[...byStrong], dest:i,
        v: evalAttackValue(p, i, [...byStrong]) - polMoveSourceLoss(p,byStrong) + 100,
        why:'총공격 '+byStrong.length+'기' });
  }
  if(!cands.length) return null;
  // 상대 손패를 볼 수 있는 티어: 결전 트릭을 들고 있으면 공격 기준을 높인다
  // (읽을 수 없는 티어는 이 보정을 받지 못한다 — 정보 우위가 그대로 실력 차가 된다)
  let need = BOT_W.moveNeed;
  if(polTier().peek){
    const O = G.players[opp(p)];
    const tricks = O.hand.filter(n=>{ const fx=FX[n]||{kw:{}};
      return (fx.kw.action||fx.kw.reaction) && polCanPlay(opp(p), card(n)); }).length;
    // 트릭이 없으면 반격을 두려워할 이유가 없다 — 더 과감하게 친다.
    // 있으면 그만큼 여유를 요구한다. 이 양방향 보정이 정보 우위의 실체다.
    need += tricks ? BOT_W.peekTrick * Math.min(tricks, 3) : BOT_W.peekBold;
  }
  cands.sort((a,b)=>b.v-a.v);
  const best = cands[0];
  // 집중 공격 플랜: 롤아웃 비교에서 이 전장을 치는 편이 낫다고 판정됐다 — 문턱을 낮춰 실행한다
  if(POLICY.turnPlan && POLICY.turnPlan.p===p && POLICY.turnPlan.tc===G.turnCount
     && POLICY.turnPlan.focusBf!==undefined && best.dest===POLICY.turnPlan.focusBf)
    need = Math.min(need, -0.3);
  if(best.v <= need) return null;                     // 이득이 없으면 움직이지 않는다
  polSay('move', best.why+' → #'+best.dest, '가치 '+best.v.toFixed(2));
  return { units: best.units, dest: best.dest, why: best.why };
};

// ══════════ 활성화 능력 ══════════
// 298장 중 32장이 활성화 능력을 갖고 있는데 봇은 한 번도 쓰지 않았다 — 순수한 손실이었다.
// 핵심 근거: 룬·탈진은 각성 단계에서 매 턴 전부 재준비된다. 즉 턴이 끝날 때 남긴 자원은 사라진다.
// 그러므로 "할 일을 다 한 뒤" 남은 자원으로 낼 수 있는 능력은 사실상 공짜다 → 낼 수 있으면 낸다.
// 예외는 되돌릴 수 없는 대가(손패 버리기·아군 처치·버프 소모)뿐이다.

const POL_AB_HARDCOST = ['discard','killFriendlyOrGear','killSelfGear','spendBuff'];
// 자기 파괴·아군 희생 op — 이득이 분명하지 않으면 손대지 않는다
const POL_AB_BADOPS   = new Set(['killThisGear','luredHook']);
// [추가] 자원 능력 — 중립 턴에 쓰면 턴 종료 시 풀이 비워져 그냥 버리는 셈이 된다. 결전용으로 아낀다.
const POL_AB_RESOURCE = new Set(['addEnergy','addPower']);

// 전설·도구·유닛의 활성화 능력을 한 목록으로
function polAbList(p){
  const P = G.players[p], out = [];
  const push = (src, name, fx) => ((fx && fx.activated) || []).forEach((ab, i) => {
    out.push({ src, ab, name, key: name + '#' + i });
  });
  push({kind:'legend'}, card(P.legendN).ko, FX[P.legendN]);
  P.gear.forEach(g => push({kind:'gear', g}, card(g.n).ko, FX[g.n]));
  everyUnit().filter(u => u.ctrl === p).forEach(u => push({kind:'unit', u}, unitName(u), unitFx(u)));
  return out;
}

// 엔진 activateAbility의 게이트를 그대로 미리 확인한다.
// (엔진은 조건 미달이면 토스트만 띄우고 끝나므로, 미리 거르지 않으면 봇이 헛수에 갇힌다)
function polAbLegal(p, c){
  const P = G.players[p], ab = c.ab, cost = ab.cost || {};
  if(G.state === 'showdown'){
    if(!(ab.reaction || ab.action)) return false;
    if(G.showdown && G.showdown.chain.length && !ab.reaction) return false;
  } else if(G.turn !== p || G.phase !== 'action'){
    if(!ab.reaction) return false;   // [반응] 능력은 중립 닫힌 상태(상대 턴 응수 창)에서도 가능 (룰 309.2)
  }
  if(ab.legion && !(P.playedCards >= 1)) return false;
  if(ab.onlyAtBf && c.src.kind === 'unit' && c.src.u.loc === 'base') return false;
  if(cost.exhaustSelf){
    if(c.src.kind === 'unit'   && c.src.u.ex) return false;
    if(c.src.kind === 'legend' && P.legendEx) return false;
    if(c.src.kind === 'gear'   && c.src.g.ex) return false;
  }
  const pips = [...(cost.pips || [])];
  for(let i = 0; i < (cost.power || 0); i++) pips.push('Any');
  if(!canPay(p, cost.energy || 0, pips)) return false;
  if(cost.killFriendlyOrGear && !everyUnit().some(u => u.ctrl === p) && !P.gear.length) return false;
  if(cost.recycleTrash && P.trash.length < cost.recycleTrash) return false;
  if(cost.discard && P.hand.length < cost.discard) return false;
  if(cost.spendBuff && c.src.kind === 'unit' && c.src.u.buff <= 0) return false;
  return true;
}
const polAbOps = c => (c.ab.ops || []).map(o => o.op);
const polAbIsResource = c => { const o = polAbOps(c); return o.length > 0 && o.every(x => POL_AB_RESOURCE.has(x)); };

// 이 [추가] 능력을 쓰면 카드 n을 낼 수 있게 되는가.
// 자원 풀을 잠깐 부풀렸다 되돌려 엔진의 canPay에게 직접 물어본다 — 룬은 에너지와 힘을
// 둘 다 낼 수 있어서 "모자란 게 에너지인가 힘인가"를 손으로 계산하면 양방향으로 틀린다.
// (동기 구간이라 중간에 다른 코드가 끼어들 수 없다)
function polWouldFund(p, c, n){
  const P = G.players[p];
  const e0 = P.energy, pw0 = {...P.power};
  try {
    (c.ab.ops || []).forEach(o => {
      if(o.op === 'addEnergy') P.energy += (o.n || 0);
      else if(o.op === 'addPower') P.power[o.dom] = (P.power[o.dom] || 0) + (o.n || 0);
    });
    return polCanPlay(p, card(n));
  } catch(err){ return false; }
  finally { P.energy = e0; P.power = pw0; }
}

// 중립 턴에 쓸 능력 하나. onlyUnits로 유닛 능력만/유닛 아닌 것만 구분한다 —
// 유닛 탈진 능력은 이동을 막으므로 반드시 이동 계획이 끝난 뒤에 쓴다.
POLICY.abilityPlan = async function(p, ctx, onlyUnits){
  if(!POLICY.ab.ability || polTier().rep < 1) return null;
  for(const c of polAbList(p)){
    if((c.src.kind === 'unit') !== !!onlyUnits) continue;
    if(ctx && ctx.tried.has('a' + c.key)) continue;
    if(!polAbLegal(p, c)) continue;
    if(polMfAuroraDeck(p) && c.src.kind==='legend' && G.players[p].legendN===POL_MF.legend){
      const target=polMfGankTarget(p);
      if(!target) continue;
      POLICY._mfGankTarget={p,tc:G.turnCount,uid:target.uid};
    }
    // 오로라 설치 뒤 경이의 꾸러미로 무료 소환 유닛이나 오로라 자체를 회수하면
    // 엔진의 누적 이득을 스스로 되돌린다.
    if(polMfAuroraDeck(p) && polMfAuroraOnline(p)
      && c.src.kind==='gear' && c.src.g.n===181) continue;
    const cost = c.ab.cost || {};
    const costPips=[...(cost.pips||[])];
    for(let i=0;i<(cost.power||0);i++) costPips.push('Any');
    if(polMfAuroraDeck(p) && !polMfAuroraOnline(p) && polRuneRecycleNeed(p,costPips)>0) continue;
    if(POL_AB_HARDCOST.some(k => cost[k])) continue;
    if(polAbOps(c).some(o => POL_AB_BADOPS.has(o))) continue;
    if(polAbIsResource(c)) continue;
    if(polHasRelocateOp(c.ab.ops) && typeof simTry==='function' && !SIM.lock && !NET.online){
      const before=evalState(G,p), uid=c.src.u?.uid, gi=c.src.g?G.players[p].gear.indexOf(c.src.g):-1;
      const after=await simTry(p,async()=>{
        const src={kind:c.src.kind};
        if(uid!==undefined) src.u=everyUnit().find(u=>u.uid===uid);
        if(gi>=0) src.g=G.players[p].gear[gi];
        await activateAbility(p,src,c.ab);
      },POLICY);
      if(after===null || after<=before+BOT_W.moveNeed) continue;
    }
    polSay('ability', c.name + ' — ' + c.ab.label, onlyUnits ? '유닛 능력(이동 뒤)' : '전설·도구 능력');
    return { kind:'ability', src:c.src, ab:c.ab, key:c.key, label:c.name + ' ' + c.ab.label };
  }
  return null;
};

// ══════════ [숨겨짐] ══════════
// 힘 1을 내고 통제 중인 전장에 뒷면으로 깔아 두면, 다음 턴부터 비용 없이 꺼낼 수 있다(engine 649행).
// 비싼 카드일수록 아끼는 값이 크다. 여기까지 왔다는 건 지금 낼 수 있는 카드가 없다는 뜻이므로,
// 숨기는 쪽이 손패에 썩히는 것보다 무조건 낫다.
const polHideCap = bf => bf.n === BF_STATIC.DOUBLE_HIDE ? 2 : 1;

POLICY.hidePlan = function(p, ctx){
  if(!POLICY.ab.hide || polTier().rep < 1) return null;
  if(G.turn !== p || G.state !== 'neutral') return null;
  const P = G.players[p];
  if(polMfAuroraDeck(p) && !polMfAuroraOnline(p) && !TF().freeHide[p]
    && polRuneRecycleNeed(p,['Any'])>0) return null;
  // 통제를 잃으면 숨긴 카드는 그대로 폐기된다(engine 1263행). 적이 있는 전장에는 깔지 않는다.
  if(!G.bfs.some(bf => bf.controller === p && bf.hiddenCards.length < polHideCap(bf)
                    && !bf.units.some(u => u.ctrl !== p))) return null;
  // 비용: 힘 1 (티모 전설은 에너지 1로 대체, [게릴라전] 중엔 무료)
  const teemo = FX[P.legendN] && FX[P.legendN].altHideCost;
  if(!TF().freeHide[p] && !canPay(p, 0, ['Any']) && !(teemo && canPay(p, 1, []))) return null;
  let best = -1, bestC = 1;
  P.hand.forEach((n, i) => {
    if(!(FX[n] || {kw:{}}).kw.hidden) return;
    if(ctx && ctx.tried.has('x' + n)) return;
    const c = polCost(card(n));
    if(c > bestC){ bestC = c; best = i; }     // 힘 1보다 비싼 카드만 (아낄 게 있어야 한다)
  });
  if(best < 0) return null;
  polSay('hide', card(P.hand[best]).ko, '비용 ' + bestC + ' 절약');
  return { kind:'hide', idx:best, n:P.hand[best] };
};

// 숨겨둔 카드 꺼내기 — 비용이 0이므로 낼 수 있으면 무조건 이득.
// 주문만은 결전 기습용으로 남긴다(중립에서 태우면 그냥 소모다).
POLICY.hiddenPlan = function(p, ctx, wantTrick){
  if(!POLICY.ab.hide || polTier().rep < 1) return null;
  for(let i = 0; i < G.bfs.length; i++){
    const bf = G.bfs[i];
    if(bf.units.some(u => u.ctrl !== p && unitFx(u).blockReveal)) continue;   // 녹서스 파괴공작원
    for(const h of bf.hiddenCards){
      if(h.by !== p) continue;
      if(h.turn === G.turnCount && G.turn === p) continue;                    // 숨긴 턴에는 못 낸다
      if(ctx && ctx.tried.has('v' + i + ':' + h.n)) continue;
      const c = card(h.n), fx = FX[h.n] || {kw:{}};
      if(polMfTimelineBlocked(p,h.n)) continue;
      const trick = !!(fx.kw.action || fx.kw.reaction);
      if(wantTrick && polIsReturnSpell(h.n)) continue; // 전용 결전 평가가 사용/보류를 결정한다
      if(wantTrick){
        if(!trick) continue;
        if(G.showdown && G.showdown.chain.length && !fx.kw.reaction) continue;
      } else if(trick) continue;   // [행동]/[반응]만 결전용으로 남긴다 (나머지는 지금 꺼내는 게 이득)
      polSay('hidden', c.ko, '숨긴 카드 무료 플레이 (#' + i + ')');
      return { kind:'hidden', bfIdx:i, n:h.n, label:'숨김 ' + c.ko };
    }
  }
  return null;
};

// ══════════ 결전 행동 ══════════
// 결전당 1회 제한을 두면 상대가 체인을 쌓은 뒤 응수할 수 없다. 체인은 여러 겹 쌓인다.
POLICY._sdSeen = null;
POLICY._sdKey = null;
POLICY._sdTried = new Set();
function polSdTried(){
  if(POLICY._sdKey !== G.showdown){ POLICY._sdKey = G.showdown; POLICY._sdTried = new Set(); }
  return POLICY._sdTried;
}

// ══════════ 정밀 결전 예측 (sdx) ══════════
// 지금 양측이 패스하면 벌어질 전투를 그대로 계산한다 — 처치는 치사량 오름차순(엔진과 동일).
// 스냅샷: {m: 역할 위력, lethal: 처치에 필요한 피해, stun, might: 소재 가치}
function polSdSnap(p, sd){
  const us = unitsAt(sd.bfIdx);
  const role = u => u.ctrl === sd.attacker ? 'attacker' : 'defender';
  const mk = u => ({ m: might(u, role(u)), lethal: Math.max(1, might(u, role(u), {forKill:true}) - u.dmg),
                     stun: !!u.stunned, might: might(u) });
  return { mine: us.filter(u=>u.ctrl===p).map(mk), theirs: us.filter(u=>u.ctrl!==p).map(mk) };
}
// 결과 클래스 (p 관점): 공격자면 2=정복 성공 / 1=실패, 수비자면 1=정복 저지 / 0=정복당함.
// exch = 처치 교환 손익 (상대가 잃는 위력 − 내가 잃는 위력)
function polSdOutcome(p, sd, snap){
  const sum = a => a.reduce((s,x)=>s+(x.stun?0:x.m),0);
  const myM = sum(snap.mine), opM = sum(snap.theirs);
  const deadOf = (total, arr) => {
    let rest=total; const dead=[];
    for(const x of [...arr].sort((a,b)=>a.lethal-b.lethal)){ if(rest>=x.lethal){ rest-=x.lethal; dead.push(x); } else break; }
    return dead;
  };
  const opDead=deadOf(myM, snap.theirs), myDead=deadOf(opM, snap.mine);
  const opLeft=snap.theirs.length-opDead.length, myLeft=snap.mine.length-myDead.length;
  let cls;
  if(sd.attacker===p) cls = (opLeft===0 && myLeft>0) ? 2 : 1;
  else cls = (myLeft===0 && opLeft>0) ? 0 : 1;
  const exch = opDead.reduce((s,x)=>s+x.might,0) - myDead.reduce((s,x)=>s+x.might,0);
  return { cls, exch, myM, opM, myLeft, opLeft };
}
// 트릭의 컴파일된 op를 스냅샷 사본에 근사 적용. 전투와 무관한 카드(드로우 등)는 false.
function polSdApplyOps(p, sd, snap, ops){
  let touched=false;
  const myBest = () => snap.mine.filter(x=>!x.stun).sort((a,b)=>b.m-a.m)[0];
  const opBestAlive = () => snap.theirs.filter(x=>!x.stun).sort((a,b)=>b.m-a.m)[0];
  for(const op of ops||[]){
    if(!op) continue;
    if(op.op==='optional' && op.inner){ if(polSdApplyOps(p,sd,snap,[op.inner])) touched=true; }
    else if(op.op==='might' && op.n>0 && (op.self || !op.spec || op.spec.side!=='enemy')){
      const t=myBest(); if(t){ t.m+=op.n; t.lethal+=op.n; touched=true; }
    }
    else if(op.op==='might' && op.n<0){
      const t=opBestAlive(); if(t){ t.m=Math.max(op.min||0,t.m+op.n); t.lethal=Math.max(1,t.lethal+op.n); touched=true; }
    }
    else if((op.op==='damage'||op.op==='damageAll') && (!op.spec || op.spec.side!=='friendly')){
      const times = op.op==='damageAll' ? snap.theirs.length : 1;
      for(let i=0;i<times && snap.theirs.length;i++){
        const killable = snap.theirs.filter(x=>x.lethal<=op.n).sort((a,b)=>b.might-a.might)[0];
        if(killable) snap.theirs.splice(snap.theirs.indexOf(killable),1);
        else { const t=[...snap.theirs].sort((a,b)=>b.lethal-a.lethal)[0]; if(t) t.lethal=Math.max(1,t.lethal-op.n); }
        touched=true;
      }
    }
    else if((op.op==='kill') && op.spec && op.spec.side!=='friendly'){
      const el=snap.theirs.filter(x=>op.spec.mightMax===undefined||x.might<=op.spec.mightMax).sort((a,b)=>b.might-a.might)[0];
      if(el){ snap.theirs.splice(snap.theirs.indexOf(el),1); touched=true; }
    }
    else if(op.op==='stun' && (!op.spec || op.spec.side!=='friendly')){
      const t=opBestAlive(); if(t){ t.stun=true; touched=true; }
    }
    else if(op.op==='grantKw' && op.kws){
      const t=myBest();
      if(t) for(const kv of op.kws){ const kw=kv[0], v=kv[1]||1;
        if(/^(Assault|Shield)/.test(kw)){ t.m+=v; t.lethal+=v; touched=true; } }
    }
  }
  return touched;
}
// 손패 트릭 하나의 기대 이득 — 클래스 개선은 크게, 교환 개선은 위력 단위로
function polSdTrickGain(p, sd, snap0, base, n){
  const fx=FX[n]||{}; const ops=(fx.playOps||[]).filter(g=>!g.legion).flatMap(g=>g.ops||[]);
  const snap={ mine:snap0.mine.map(x=>({...x})), theirs:snap0.theirs.map(x=>({...x})) };
  if(!polSdApplyOps(p, sd, snap, ops)) return null;    // 전투 무관 카드 — 결전에 태우지 않는다
  const out=polSdOutcome(p, sd, snap);
  return { gain:(out.cls-base.cls)*10 + (out.exch-base.exch), cls:out.cls };
}

// 결전에서 취할 행동 하나. 손패 트릭 → 자금 조달(자원 능력) → 숨겨둔 트릭 순.
POLICY.showdownAction = async function(p){
  const sd = G.showdown;
  if(!sd) return null;
  if(polSmart()){
    const bounce=await polReturnShowdownAction(p);
    if(bounce) return bounce;
  }
  if(!polHard()) return null;
  if(!POLICY.ab.showdown){ if(POLICY._sdSeen === sd) return null; POLICY._sdSeen = sd; }
  const us = unitsAt(sd.bfIdx);
  const role = u => u.ctrl === sd.attacker ? 'attacker' : 'defender';
  const myM = us.filter(u => u.ctrl === p).reduce((s,u) => s + might(u, role(u)), 0);
  const opM = us.filter(u => u.ctrl !== p).reduce((s,u) => s + might(u, role(u)), 0);
  if(opM <= 0 || !us.some(u => u.ctrl === p)) return null;   // 무혈 결전엔 아낀다
  if(!POLICY.ab.sdx && myM > opM + BOT_W.sdMargin) return null;  // (구식 마진 게이트 — sdx는 정밀 예측으로 대체)
  const P = G.players[p];
  // 이 결전에서 낼 수 있는 트릭인가 (자금 문제는 따로 본다)
  const usable = n => {
    if(polIsReturnSpell(n)) return false; // 위의 실제 엔진 평가에서 이미 검사했다
    const fx = FX[n] || {kw:{}};
    if(!(fx.kw.action || fx.kw.reaction)) return false;
    if(sd.chain.length && !fx.kw.reaction) return false;     // 체인 진행 중엔 [반응]만
    // 카운터는 체인에 상대 주문이 있을 때만 (없으면 효과 없이 폐기된다)
    if((fx.counter || fx.steal) && !sd.chain.some(it => it.p !== p && it.kind !== 'ability')) return false;
    if(polMfTimelineBlocked(p,n)) return false;
    return true;
  };
  // 가변 광역 피해는 정적 op 근사로 계산할 수 없으므로 별도 전투 시뮬레이션을 쓴다.
  // 오로라 설치 여부와 무관하게, 현재 패배할 결전을 최소 힘으로 유지/정복할 때만 낸다.
  if(polMfAuroraDeck(p)){
    const bi=P.hand.findIndex(n=>n===POL_MF.bulletTime && usable(n) && polCanPlay(p,card(n)));
    const bp=bi>=0?polMfBulletPlan(p,true):null;
    if(bp){
      polSay('showdown',card(POL_MF.bulletTime).ko,'최소 피해로 전장 유지·정복',{damage:bp.damage,bfIdx:bp.bfIdx});
      return {kind:'play',idx:bi,n:POL_MF.bulletTime};
    }
  }
  let want;
  if(POLICY.ab.sdx){
    // ── 정밀 결전 판단: 결과(정복/저지)를 실제로 계산하고, 그걸 바꾸는 트릭만 낸다 ──
    const snap0 = polSdSnap(p, sd);
    const base = polSdOutcome(p, sd, snap0);
    const bestCls = sd.attacker===p ? 2 : 1;
    if(!(base.cls===bestCls && base.exch>=0)){        // 이미 최선+교환 무손해면 전부 아낀다
      let best=null;
      P.hand.forEach((n,i)=>{
        if(!usable(n) || !polCanPlay(p, card(n))) return;
        const r=polSdTrickGain(p, sd, snap0, base, n);
        if(!r) return;
        const better = !best || r.gain>best.gain+1e-9
          || (Math.abs(r.gain-best.gain)<1e-9 && (card(n).e||0)<(card(best.n).e||0));
        if(better) best={i, n, gain:r.gain, cls:r.cls};
      });
      // 클래스가 오르거나(정복 성사·정복 저지) 교환이 위력 2 이상 좋아질 때만 태운다
      if(best && (best.cls>base.cls || best.gain>=2)){
        polSay('showdown', card(best.n).ko, '정밀 트릭', {myM, opM, gain:+best.gain.toFixed(1)});
        return { kind:'play', idx:best.i, n:best.n };
      }
    }
    // 자금 조달 대상도 '내면 결과가 좋아지는데 돈이 모자란' 카드로 한정
    want = P.hand.filter(n => {
      if(!usable(n) || polCanPlay(p, card(n))) return false;
      const r=polSdTrickGain(p, sd, snap0, base, n);
      return !!r && (r.cls>base.cls || r.gain>=2);
    });
  } else {
    const idx = P.hand.findIndex(n => usable(n) && polCanPlay(p, card(n)));
    if(idx >= 0){
      polSay('showdown', card(P.hand[idx]).ko, '결전 트릭', {myM, opM});
      return { kind:'play', idx, n:P.hand[idx] };
    }
    want = P.hand.filter(n => usable(n));
  }
  // ── 자금 조달 ──
  // 인장 7종과 카이사·다리우스 전설은 결전 중 [추가] 자원 능력이다(즉시 해결·우선권 유지).
  // 낼 수 없는 트릭이 손에 있을 때 이걸 켜면 "돈이 모자라 못 쓰던 카드"가 살아난다.
  if(POLICY.ab.sdfund && polTier().rep >= 2 && want.length){
    const tried = polSdTried();
    for(const c of polAbList(p)){
      if(!polAbIsResource(c)) continue;
      if(tried.has(c.key)) continue;
      const cost = c.ab.cost || {};
      if((cost.energy||0) || (cost.power||0) || (cost.pips||[]).length) continue;  // 탈진만으로 나오는 것만
      if(!polAbLegal(p, c)) continue;
      // 이 한 번으로 실제로 낼 수 있게 되는 카드가 있어야 켠다.
      // (조건 없이 켜면 아무것도 못 사면서 인장만 다 태운다)
      if(!want.some(n => polWouldFund(p, c, n))) continue;
      tried.add(c.key);
      polSay('showdown', c.name + ' — ' + c.ab.label, '트릭 자금 조달', {myM, opM});
      return { kind:'ability', src:c.src, ab:c.ab, key:c.key, label:c.name + ' ' + c.ab.label };
    }
  }
  // ── 숨겨둔 트릭 기습 (비용 0) ──
  const hid = POLICY.hiddenPlan(p, {tried:polSdTried()}, true);
  if(hid){ polSdTried().add('v' + hid.bfIdx + ':' + hid.n); return hid; }
  return null;
};

// ══════════ 턴 진행 ══════════
// 예전엔 bot.js와 tools/selfplay.js가 각자 행동 순서를 들고 있어, 능력 하나를 추가할 때마다
// 브라우저와 검증 러너가 어긋났다. 순서와 실행을 여기로 모아 두 곳이 같은 봇을 쓰게 한다.
//
// 순서의 근거:
//  ① 숨겨둔 카드는 비용 0 — 가장 먼저 꺼낸다
//  ② 손패 → 챔피언 (본 플레이)
//  ③ 전설·도구 능력 (이동을 막지 않는다)
//  ④ 이동 (탈진되므로 유닛 능력보다 먼저)
//  ⑤ 유닛 능력 (이동을 끝낸 유닛으로)
//  ⑥ [숨겨짐] 깔기 (남은 힘 처리)
POLICY.nextAction = async function(p, ctx){
  let a = POLICY.hiddenPlan(p, ctx, false);
  if(a) return a;
  a = await POLICY.playPlan(p, ctx);
  if(a) return a;
  a = await POLICY.abilityPlan(p, ctx, false);
  if(a) return a;
  if(ctx.movesLeft > 0){
    const mv = POLICY.movePlan(p);
    if(mv) return { kind:'move', units:mv.units, dest:mv.dest };
    ctx.movesLeft = 0;
  }
  a = await POLICY.abilityPlan(p, ctx, true);
  if(a) return a;
  a = POLICY.hidePlan(p, ctx);
  if(a) return a;
  return { kind:'end' };
};

// 행동 하나를 실제로 실행한다. 엔진 함수만 부르므로 브라우저·러너 양쪽에서 같다.
POLICY.runAction = async function(p, act){
  switch(act.kind){
    case 'play':    return await playCardFromHand(p, act.idx);
    case 'champ':   return await playCardFromHand(p, -1, {champZone:true});
    case 'ability': return await activateAbility(p, act.src, act.ab);
    case 'move':    return await moveUnits(p, act.units, act.dest);
    case 'hidden':  return await playHidden(p, act.bfIdx);
    case 'hide':    return await hideCard(p, act.idx);
  }
  return null;
};

// 한 번 호출에 행동 하나. true를 반환하면 더 할 게 없다는 뜻(호출자가 턴을 끝낸다).
// 실패한 행동은 같은 턴에 다시 고르지 않는다 — 엔진이 토스트만 띄우고 끝나는 수가 있어
// 재시도 차단이 없으면 봇이 그 자리에서 무한히 맴돈다.
POLICY.step = async function(p, ctx, onPlay){
  // 탐색 티어: 턴 시작에 '턴 플랜'(기본/공격 자제/집중 공격)을 롤아웃으로 비교해 하나 고른다.
  // 예전의 행동 단위 탐색은 롤아웃 미래 평가를 현재 정적 평가와 비교하는 결함(조기 턴 종료 남발)과
  // 평가 노이즈에 묻히는 미시 후보 문제로 두 번 실패했다 — 플랜 단위 비교는 기준선(기본 플랜)도
  // 같은 깊이로 롤아웃하므로 공정하고, 후보 간 평가 차이가 커서 노이즈 위에 선다.
  if(polTier().think && POLICY.ab.think) await polPlanTurn(p, ctx);
  let act = await POLICY.nextAction(p, ctx);
  if(!act || act.kind === 'end') return true;
  const P = G.players[p];
  const hadHand = P.hand.length, hadChamp = P.champInZone;
  if(onPlay && (act.kind === 'play' || act.kind === 'hidden')) onPlay(act.n);
  // 탐색이 고른 후보는 자기 run()을 들고 있다 (클론에서 검증된 실행 경로)
  const ok = act.run ? await act.run() : await POLICY.runAction(p, act);
  if(act.kind === 'play'  && ok === false && G.players[p].hand.length === hadHand) ctx.tried.add('h' + act.n);
  if(act.kind === 'champ' && ok === false && hadChamp && G.players[p].champInZone) ctx.tried.add('champ');
  if(act.kind === 'hide'  && G.players[p].hand.length === hadHand) ctx.tried.add('x' + act.n);
  if(act.kind === 'move'){   ctx.movesLeft--;
    // 이동은 국면을 가장 크게 바꾼다 — 탐색 티어는 이동 직후 턴 플랜을 다시 세운다 (수용 지평선)
    if(polTier().think && POLICY.ab.think && !(typeof SIM!=='undefined' && (SIM.active||SIM.lock))) ctx.plannedTc = -1;
  }
  if(act.kind === 'ability') ctx.tried.add('a' + act.key);
  if(act.kind === 'hidden')  ctx.tried.add('v' + act.bfIdx + ':' + act.n);
  return false;
};

// 턴이 바뀌면 재시도 차단·이동 횟수를 초기화한다
POLICY.newCtx = function(){ return { tried:new Set(), movesLeft:0, tc:-1 }; };
POLICY.syncCtx = function(ctx){
  if(ctx.tc === G.turnCount) return ctx;
  ctx.tc = G.turnCount; ctx.tried.clear();
  ctx.movesLeft = polTier().moves || 1;
  return ctx;
};


// ══════════ 탐색 기반 행동 선택 (고수 이상) ══════════
// 후보 수를 샌드박스에서 실제로 두어 보고 국면 평가가 가장 좋은 것을 고른다.
// 규칙을 재구현하지 않고 엔진에 물어보므로 카드 298장과 자동으로 호환된다.
// think===0(초보·중수)이면 이 경로를 타지 않는다.

POLICY.think = 0;      // 0=휴리스틱 / 1=1수 탐색 / 2=턴 계획
POLICY.budget = 0;     // 한 수당 시간 상한(ms)
POLICY.peek = false;   // 상대 손패를 봐도 되는가 (마지막 티어 전용)

// 이번 턴에 취할 수 있는 행동 후보를 만든다.
// ★ run()은 '클론된 G' 위에서 돌아간다 — 유닛·도구 객체를 클로저에 그대로 담으면
//   원본을 가리켜 아무 일도 일어나지 않는다. 반드시 uid·카드번호로 다시 찾을 것.
function polActionCandidates(p, ctx){
  const P = G.players[p];
  const blocked = ctx && ctx.tried;
  const out = [];
  // 손패 플레이 (같은 카드 번호는 한 번만 — 사본은 결과가 같다)
  const seen = new Set();
  P.hand.forEach((n, i) => {
    if(blocked && blocked.has('h'+n)) return;
    if(seen.has(n)) return; seen.add(n);
    if(!polCanPlay(p, card(n))) return;
    if(polMfNeutralCardBlocked(p,n)) return;
    out.push({ kind:'play', n, label:'플레이 '+card(n).ko,
      run: async()=>{ const j = G.players[p].hand.indexOf(n); if(j>=0) await playCardFromHand(p, j); } });
  });
  // 챔피언
  if(P.champInZone && !(blocked && blocked.has('champ')) && polCanPlay(p, card(P.champN))
    && !polMfNeutralCardBlocked(p,P.champN)){
    out.push({ kind:'champ', label:'챔피언 '+card(P.champN).ko,
      run: async()=>{ await playCardFromHand(p, -1, {champZone:true}); } });
  }
  // 활성화 능력 — 휴리스틱은 목록 순서대로 첫 번째를 쓴다. 어느 것을 먼저 쓸지는
  //              탐색이 판단할 수 있는 대표적인 선택지다.
  for(const c of polAbList(p)){
    if(blocked && blocked.has('a'+c.key)) continue;
    if(!polAbLegal(p, c)) continue;
    const cost = c.ab.cost || {};
    const costPips=[...(cost.pips||[])];
    for(let i=0;i<(cost.power||0);i++) costPips.push('Any');
    if(polMfAuroraDeck(p) && !polMfAuroraOnline(p) && polRuneRecycleNeed(p,costPips)>0) continue;
    if(POL_AB_HARDCOST.some(k => cost[k])) continue;
    if(polAbOps(c).some(o => POL_AB_BADOPS.has(o))) continue;
    if(polAbIsResource(c)) continue;
    const uid = c.src.kind === 'unit' ? c.src.u.uid : null;
    const gn  = c.src.kind === 'gear' ? c.src.g.n : null;
    out.push({ kind:'ability', key:c.key, label:c.name + ' ' + c.ab.label,
      run: async()=>{
        let src = { kind:c.src.kind };
        if(uid !== null){ const u = everyUnit().find(x => x.uid === uid); if(!u) return; src.u = u; }
        else if(gn !== null){ const g = G.players[p].gear.find(x => x.n === gn); if(!g) return; src.g = g; }
        await activateAbility(p, src, c.ab);
      } });
  }
  // 숨겨둔 카드 꺼내기 / 새로 숨기기
  const hid = POLICY.hiddenPlan(p, ctx, false);
  if(hid) out.push({ kind:'hidden', bfIdx:hid.bfIdx, n:hid.n, label:hid.label,
    run: async()=>{ await playHidden(p, hid.bfIdx); } });
  const hd = POLICY.hidePlan(p, ctx);
  if(hd) out.push({ kind:'hide', n:hd.n, label:'숨기기 '+card(hd.n).ko,
    run: async()=>{ const j = G.players[p].hand.indexOf(hd.n); if(j>=0) await hideCard(p, j); } });
  // 이동 — 평가 기반 movePlan이 이미 최적 후보를 고르므로 그 하나만 넣는다
  //        (모든 부분집합을 탐색에 넣으면 예산만 소모하고 결과는 같다)
  if(!ctx || ctx.movesLeft > 0){
    const mv = POLICY.movePlan(p);
    if(mv){
      const uids = mv.units.map(u=>u.uid);
      out.push({ kind:'move', label:'이동 '+uids.length+'기 → #'+mv.dest,
        run: async()=>{ const us = everyUnit().filter(u=>uids.includes(u.uid)); if(us.length) await moveUnits(p, us, mv.dest); } });
    }
  }
  return out;
}

// ══════════ 턴 플랜 탐색 (재설계 2026-08-29) ══════════
// 턴 시작에 한 번, 거시 전략 후보를 샌드박스에서 비교한다.
//  · 후보: 기본 휴리스틱 / 공격 자제 / 전장별 집중 공격 (최대 4개)
//  · 모든 후보가 같은 깊이에서 평가되므로 기준선이 공정하다 (구식 탐색의 조기 종료 결함 제거)
//  · 일반 초고수는 내 손패와 공개 보드만으로 내 턴을 평가한다. 상대 손패·다음 행동은 가정하지 않는다.
//  · 그 외 비열람 탐색 티어는 상대 손패를 덱과 섞어 다시 뽑는 결정화로 정보 누수를 막는다.
POLICY.turnPlan = null;   // {noAttack:true} | {focusBf:i} | null — movePlan이 존중한다
function polDeterminize(p, salt){
  if(polTier().peek) return;                       // 열람 티어는 실제 손패 그대로
  const O = G.players[opp(p)];
  if(!O.hand.length) return;
  const pool = [...O.hand, ...O.deck];
  // 표본(salt)마다 다른 셔플이어야 평균에 의미가 있다 — 엔진 rng는 simTry마다 복원되어
  // 같은 수열이 나오므로, (턴, 표본) 기반의 자체 수열을 쓴다
  let s = ((polHash('det', G.turnCount, salt||0) * 0x7fffffff) | 1) >>> 0;
  const rnd = ()=>{ s=(Math.imul(s,1103515245)+12345)&0x7fffffff; return s/0x7fffffff; };
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); const t=pool[i]; pool[i]=pool[j]; pool[j]=t; }
  O.hand = pool.slice(0, O.hand.length);
  O.deck = pool.slice(O.hand.length);
}
async function polPlanTurn(p, ctx){
  // 롤아웃 내부 재진입 가드가 turnPlan 초기화보다 먼저여야 한다 — 아니면 후보 플랜이 지워진다
  if(typeof SIM !== 'undefined' && (SIM.active || SIM.lock)) return;
  if(ctx.plannedTc === G.turnCount) return;        // 턴당 1회
  ctx.plannedTc = G.turnCount;
  POLICY.turnPlan = null;
  if(typeof simTry !== 'function') return;
  if(typeof NET !== 'undefined' && NET.online) return;
  const o = opp(p);
  const plans = [ {label:'기본', plan:null}, {label:'공격 자제', plan:{noAttack:true}} ];
  const atkBfs = G.bfs.map((bf,i)=>i)
    .filter(i => G.bfs[i].units.some(u=>u.ctrl===o) || G.bfs[i].controller===o);
  for(const i of atkBfs.slice(0,3)) plans.push({ label:'집중 공격 #'+i, plan:{focusBf:i} });
  for(const i of atkBfs.slice(0,2)) plans.push({ label:'총공격 #'+i, plan:{focusBf:i, allin:true} });
  // 일반 초고수는 상대 손패를 고려하지 않는 현재 국면형 판단을 쓴다.
  // 나머지 비열람 탐색 티어는 상대 손패 결정화 표본을 여러 개 평균해 추측 노이즈를 줄인다.
  const selfOnly = POLICY.level==='master';
  const budget = Math.min(POLICY.budget || 400, 5000);
  const D = (selfOnly || polTier().peek) ? 1 : 3;
  const deadline = Date.now() + budget;
  let best = null;
  for(const c of plans){
    if(best && Date.now() > deadline) break;
    let sum = 0, cnt = 0;
    for(let d=0; d<D; d++){
      if(best && Date.now() > deadline) break;
      SIM.deadline = deadline + 600;               // 개별 롤아웃 상한 (기본 플랜은 반드시 평가)
      const v = await simTry(p, async()=>{
        if(!selfOnly) polDeterminize(p, d);
        // 플랜은 {p, tc} 스코프를 갖는다 — 상대 좌석·다음 턴으로 새지 않게 movePlan이 검증한다
        POLICY.turnPlan = c.plan ? { p, tc:G.turnCount, ...c.plan } : null;
        try {
          await simPlayOutTurn(p);
          await simSettle();
          if(!selfOnly && G.winner===null && G.turn===o) await simPlayOutTurn(o);
        } finally { POLICY.turnPlan = null; }
      });
      SIM.deadline = 0;
      if(v !== null){ sum += v; cnt++; }
    }
    if(!cnt) continue;
    const avg = sum / cnt;
    if(!best || avg > best.v + 1e-9) best = { ...c, v: avg };
  }
  POLICY.turnPlan = (best && best.plan) ? { p, tc:G.turnCount, ...best.plan } : null;
  if(typeof process!=='undefined' && process.env && process.env.PLANDBG)
    console.error('PLAN', p, 'tc'+G.turnCount, plans.length+'후보', best?best.label+'='+best.v.toFixed(2):'전부실패');
  if(best && best.plan) polSay('think', best.label, '턴 플랜 (평가 '+best.v.toFixed(2)+')');
}

// (구식) 탐색으로 다음 한 수를 고른다 — 현재 미사용, 플랜 탐색으로 대체됨
POLICY.searchAction = async function(p, ctx){
  if(!polTier().think || typeof simBest !== 'function') return null;
  const cands = polActionCandidates(p, ctx);
  if(!cands.length) return null;
  // 기준점은 '지금 이 자리'다. 턴 종료를 후보에 넣으면 상대 턴 상태와 비교하게 되어
  // 손해인 카드도 "종료보다는 낫다"고 판단하게 된다.
  const base = evalState(G, p);
  const best = await simBest(p, cands, POLICY.budget || 0, POLICY.think);
  if(!best) return null;
  if(best.v <= base + 0.02){
    polSay('search', '턴 종료', '이득 없음 (최선 '+best.v.toFixed(2)+' ≤ 현재 '+base.toFixed(2)+')');
    return { kind:'end', label:'턴 종료' };
  }
  polSay('search', best.label, '평가 '+best.v.toFixed(2)+' (현재 '+base.toFixed(2)+')', {후보수:cands.length});
  return best;
};
