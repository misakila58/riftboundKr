// ══════════ 봇 정책층 (POLICY) ══════════
// 봇의 "선택"을 한곳에 모은 순수 판단 모듈.
//  · DOM·타이머·window에 의존하지 않는다 → 브라우저와 Node 셀프플레이 러너가 같은 파일을 쓴다.
//    (bot.js와 tools/selfplay.js가 각자 사본을 들면 반드시 어긋나므로, 판단은 전부 여기 둔다)
//  · G를 읽기만 한다. 상태를 바꾸지 않는다.
//  · Math.random 대신 결정론 해시를 쓴다 — 같은 국면이면 같은 선택(재현·디버깅 가능).
//  · 엔진 rng()는 절대 호출하지 않는다 (_rngState를 전진시키면 리플레이·락스텝이 깨진다).

const POLICY = {
  // 기존 버프 개수 판단과 소모 순서를 유지한다. 사람은 같은 결과를 유닛별로 고른다.
  buffs(p,title,candidates){
    const total=candidates.reduce((s,u)=>s+u.buff,0);
    let left=POLICY.number(p,title,0,total)||0;
    const picks=[];
    for(const u of candidates){
      const count=Math.min(left,u.buff);
      if(count>0) picks.push({uid:u.uid,count});
      left-=count; if(!left) break;
    }
    return picks;
  },
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
    if(!canPay(p, e, powerPips(c))) return false;
    if(polMfAuroraDeck(p) && c.n===180 && !polMfMemoryTargets(p,
      {energy:e,pips:powerPips(c),spellOK:true}).length) return false;
    // 대상 주문은 적법 대상(굴절 지불 가능한 유닛)이 있어야 낼 수 있다(룰 352.8) — 엔진 playRestriction과 같은 판정
    if(c.type==='Spell' && typeof spellHasTargets==='function' && !(FX[c.n]&&(FX[c.n].counter||FX[c.n].steal)))
      return spellHasTargets(c.n, p);
    return true;
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

// 희미해지는 기억: 아군 희생 조합은 아직 평가하지 않으므로 적 제거에만 쓴다.
// 이미 일시적인 대상에 다시 부여하는 낭비도 제외한다.
// 사용 전에는 주문 비용까지, 대상 선택 때는 남은 자원으로 굴절을 확인한다.
function polMfMemoryTargets(p, base){
  const targets=unitsBySpec({side:'enemy',where:'bf',count:1},p)
    .filter(u=>!effKw(u).temporary && canPayDeflect(p,u,base))
    .map(u=>({v:{t:'u',uid:u.uid},score:100+might(u)}));
  G.players[opp(p)].gear.forEach((g,i)=>{
    if(!g.temporary) targets.push({v:{t:'g',pi:opp(p),i},
      score:g.n===POL_MF.aurora?1000:50+polCost(card(g.n))});
  });
  return targets.sort((a,b)=>b.score-a.score);
}

// 현재 힘 풀로 못 내는 힘 비용은 전개된 룬을 재활용하게 된다. 오로라 전에는
// 다음 턴 오로라 비용을 유지하는 카드 사용은 허용한다. 시간선 역전은
// 실제 손패를 늘리며 오로라를 찾는 경우만 별도 예외로 둔다.
function polRuneRecycleNeed(p, pips){
  const pool={...G.players[p].power}; let need=0;
  for(const pip of pips){
    if(takeFromPool(pool, pip)) continue;   // engine 헬퍼 — 'Mind|Order'(여러 속성 중 하나) 핍도 처리
    need++;
  }
  return need;
}
// 등록 덱과 내 손패·공개 영역으로 판단하며 비공개 덱 순서는 보지 않는다.
function polMfBuildingAurora(p){
  if(!polMfAuroraDeck(p)||polMfAuroraOnline(p)) return false;
  const P=G.players[p];
  if(P.hand.includes(POL_MF.aurora)) return true;
  const copies=(P.deckList||[]).filter(n=>n===POL_MF.aurora).length;
  const lost=[...P.trash,...P.banish].filter(n=>n===POL_MF.aurora).length;
  if(copies && lost>=copies) return false;
  // 파괴된 엔진을 후반에 다시 찾느라 지금 낼 병력을 묶지 않는다.
  return !(lost && Math.max(P.points,G.players[opp(p)].points)>=G.victory-3);
}
function polMfTimelineValue(p){
  const P=G.players[p], O=G.players[opp(p)], building=polMfBuildingAurora(p);
  const remaining=[...P.hand]; const i=remaining.indexOf(POL_MF.invert);
  if(i>=0) remaining.splice(i,1);
  const stale=remaining.filter((n,i)=>card(n).e>=7 &&
    (!polCanPlay(p,card(n)) || remaining.indexOf(n)<i)).length;
  const core=building?remaining.filter(n=>n===POL_MF.aurora).length*1.5:0;
  // 역전 자신도 소비한다. 내 증가분과 상대 증가분을 같은 잣대로 비교한다.
  return ((4-P.hand.length)-(4-O.hand.length))*BOT_W.card
    +Math.min(3,stale)*0.15+(building&&!P.hand.includes(POL_MF.aurora)?0.25:0)-core;
}
function polMfTimelineBlocked(p,n){
  return polMfAuroraDeck(p)&&n===POL_MF.invert
    && (POLICY.race(p).oppLethal || polMfTimelineValue(p)<=0.05);
}
function polMfRampPriority(p,n){
  if(!polMfBuildingAurora(p)) return 20-polCost(card(n));
  const P=G.players[p], hand=P.hand;
  const withRamp=polMfAuroraTurns(p,null,true);
  let withoutRamp;
  try{
    P.hand=[...hand]; const i=P.hand.indexOf(n); if(i>=0) P.hand.splice(i,1);
    withoutRamp=polMfAuroraTurns(p,null,true);
  }finally{P.hand=hand;}
  return withRamp<withoutRamp?(n===POL_MF.catalyst?9000:8500):20-polCost(card(n));
}
function polMfWorstRuneOrder(deck){
  // 오로라는 신체 힘 2개를 요구한다. 신체를 마지막에 놓은 순서는
  // 남은 구성에서 신체 확보가 가장 늦는 경우이며 비공개 배열 순서와 무관하다.
  return [...deck].sort((a,b)=>Number(runeDomain(a)==='Body')-Number(runeDomain(b)==='Body') || a-b);
}
function polMfCanSpendBeforeAurora(p, c){
  return polMfCanPayAndKeepAurora(p,{energy:applyCostMods(p,c,c.e||0),pips:powerPips(c),spellOK:c.type==='Spell'});
}
// 공개 공격 병력이 있고, 손에 실제 대응 수단이 있을 때만 준비 자원을 남긴다.
function polMfResponseReserve(p){
  if(!polMfAuroraDeck(p)||!polMfAuroraOnline(p)||G.turn!==p||G.state!=='neutral'||POLICY._mfEmergency===p) return null;
  const held=G.bfs.map((bf,i)=>({bf,i})).filter(x=>x.bf.controller===p&&x.bf.units.some(u=>u.ctrl===p));
  if(!held.length) return null;
  const incoming=everyUnit().filter(u=>u.ctrl!==p&&!effKw(u).temporary
    &&(u.loc==='base'||effKw(u).ganking));
  if(!incoming.length) return null;
  if(!held.some(({i})=>polThreatAt(p,i)>0.05)) return null;
  // 이미 숨긴 이동/회수 주문으로 그 전장을 지킬 수 있으면 같은 용도의 에너지 예약은 불필요하다.
  const covered=!incoming.some(u=>unitFx(u).blockReveal)&&held.every(({bf})=>bf.hiddenCards.some(h=>h.by===p
    &&[168,172].includes(h.n)) && !bf.units.some(u=>u.ctrl!==p&&unitFx(u).blockReveal));
  if(covered) return null;
  const choices=[];
  for(const n of new Set(G.players[p].hand)){
    if(![169,172,168,268].includes(n)) continue;
    const targets=incoming.filter(u=>n!==169||might(u,undefined,{forKill:true})<=3);
    if(!targets.length) continue;
    const c=card(n), cost={energy:applyCostMods(p,c,c.e||0),pips:powerPips(c),spellOK:true,cardN:n};
    if(n===268){
      const damage=Math.min(...targets.map(u=>{
        let n=1;while(n<=polMfBulletPower(p)&&polMfBulletDamage(p,u,n)<might(u,undefined,{forKill:true})) n++;
        return n;
      }));
      cost.pips=[...cost.pips,...Array(damage).fill('Any')];
    }
    if(canPay(p,cost.energy,cost.pips,true)) choices.push(cost);
  }
  choices.sort((a,b)=>(a.energy+a.pips.length)-(b.energy+b.pips.length));
  return choices[0]||null;
}
function polMfResponseCostBlocked(p,cost){
  const reserve=polMfResponseReserve(p);
  if(!reserve||cost.cardN===reserve.cardN) return false;
  const original=G.players[p];
  try{
    G.players[p]={...original,runes:original.runes.map(r=>({...r})),runeDeck:[...original.runeDeck],power:{...original.power}};
    if(!canPay(p,cost.energy||0,cost.pips||[],!!cost.spellOK)) return true;
    payCost(p,cost.energy||0,cost.pips||[],true,!!cost.spellOK);
    return !canPay(p,reserve.energy,reserve.pips,true);
  }finally{G.players[p]=original;}
}
function polMfExtraAuroraValue(p){
  const P=G.players[p], before=evalGearValue(p,p), c=card(POL_MF.aurora);
  const original=G.players[p];
  try{
    G.players[p]={...P,gear:[...P.gear,{n:POL_MF.aurora}]};
    return evalGearValue(p,p)-before-BOT_W.card
      -applyCostMods(p,c,c.e||0)*BOT_W.rune-powerPips(c).length*BOT_W.runeTotal;
  }finally{G.players[p]=original;}
}
function polMfCostBlocked(p, cost){
  return (polMfBuildingAurora(p)
    && polRuneRecycleNeed(p,cost.pips||[])>0 && !polMfCanPayAndKeepAurora(p,cost))
    || polMfResponseCostBlocked(p,cost);
}
function polMfCanPayAndKeepAurora(p, {energy=0,pips=[],spellOK=false,channel=0}, turns=POLICY._mfEmergency===p?2:1){
  const P=G.players[p], aurora=card(POL_MF.aurora);
  // 동기 비용 함수만 복사본에 적용하고 즉시 복원한다. 실제 지불과 같은 룬을
  // 재활용해야 다음 턴 신체 힘 2개가 남는지도 정확히 판단할 수 있다.
  const next={...P,runes:P.runes.map(r=>({...r})),runeDeck:[...P.runeDeck],power:{...P.power}};
  try{
    G.players[p]=next;
    if(!canPay(p,energy,pips,spellOK)) return false;
    payCost(p,energy,pips,true,spellOK);
    next.runeDeck=polMfWorstRuneOrder(next.runeDeck);
    next.runes.forEach(r=>r.ex=false);
    for(let i=0;i<2*turns+channel && next.runeDeck.length;i++)
      next.runes.push({n:next.runeDeck.shift(),ex:false});
    // 현재 풀은 다음 내 턴까지 남지 않는다. 추가 가속/드로우 효과 없이
    // 자연 전개만으로 오로라의 에너지와 영역별 힘을 모두 확보해야 한다.
    next.energy=0; next.energySpell=0; next.powerSpell=0;
    next.power=Object.fromEntries(Object.keys(next.power).map(k=>[k,0]));
    return canPay(p,aurora.e||0,powerPips(aurora));
  }finally{
    G.players[p]=P;
  }
}
function polMfNeutralCardBlocked(p, n){
  if(!polMfAuroraDeck(p)) return false;
  const nc=card(n);
  if(polMfResponseCostBlocked(p,{energy:applyCostMods(p,nc,nc.e||0),pips:powerPips(nc),spellOK:nc.type==='Spell',cardN:n})) return true;
  if(n===POL_MF.aurora&&polMfAuroraOnline(p)&&POLICY._mfEmergency!==p&&polMfExtraAuroraValue(p)<=0) return true;
  if(n===POL_MF.bulletTime) return !polMfBulletPlan(p,false);
  if(n===POL_MF.invert) return polMfTimelineBlocked(p,n);
  if(!polMfBuildingAurora(p) || n===POL_MF.aurora) return false;
  const c=card(n);
  return polRuneRecycleNeed(p,powerPips(c))>0 && !polMfCanSpendBeforeAurora(p,c);
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
      if(takeFromPool(pool, pip)) continue;
      const i=s.runes.findIndex((r,j)=>!used.has(j)&&pipAllowsDom(pip, runeDomain(r.n))); if(i<0)return false; used.add(i);
    }
    return true;
  };
  let frontier=[{runes:P.runes.map(r=>({...r})),deck:polMfWorstRuneOrder(P.runeDeck),energy:P.energy||0,
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
function polMfBulletSignature(p){
  return JSON.stringify([everyUnit(),TF().preventSpellDmg,TF().nextSpellBonus[p],
    G.players.map(P=>[P.gear,P.points]),G.bfs.map(b=>[b.n,b.controller,b.scored])]);
}
function polMfBulletPower(p){
  const P=G.players[p];
  return Object.values(P.power).reduce((a,b)=>a+b,0)+P.runes.length;
}
function polMfBulletDamage(p,u,power){
  if(power<=0 || TF().preventSpellDmg || !canTakeCombatDamage(u)) return 0;
  return dmgPlus(power,u,p)+(TF().nextSpellBonus[p]||0);
}
function polMfBulletPlan(p,showdown,fixedBf=null,resolving=false){
  if(!polMfAuroraDeck(p)||TF().preventSpellDmg) return null;
  const c=card(POL_MF.bulletTime), max=polMfBulletPower(p), original=G;
  const baseline=evalState(G,p), sd=G.showdown;
  let best=null;
  for(let bfIdx=0;bfIdx<G.bfs.length;bfIdx++){
    if(fixedBf!==null&&bfIdx!==fixedBf || showdown&&(!sd||sd.bfIdx!==bfIdx)) continue;
    if(!G.bfs[bfIdx].units.some(u=>u.ctrl!==p&&polMfBulletDamage(p,u,1)>0)) continue;
    const beforeCombat=showdown?polSdOutcome(p,sd,polSdSnap(p,sd)):null;
    const attackers=!showdown?G.players[p].base.filter(u=>!u.ex&&!u.stunned):[];
    const beforeAttack=attackers.length?Math.max(0,evalAttackValue(p,bfIdx,attackers)):0;
    for(let damage=1;damage<=max;damage++){
      const cost={energy:resolving?0:applyCostMods(p,c,c.e||0),pips:Array(damage).fill('Any'),spellOK:true,cardN:POL_MF.bulletTime};
      if(!canPay(p,cost.energy,cost.pips,true)||(!showdown&&polMfCostBlocked(p,cost))) continue;
      try{
        G=cloneG(original);payCost(p,cost.energy,cost.pips,true,true);
        const bf=G.bfs[bfIdx];
        for(const u of bf.units.filter(u=>u.ctrl!==p)) u.dmg+=polMfBulletDamage(p,u,damage);
        bf.units=bf.units.filter(u=>u.dmg<Math.max(1,might(u,undefined,{forKill:true})));
        // 처치 근사는 후보 생성용이다. 실제 선택은 엔진 비교로 확인한다.
        let score=evalState(G,p)-baseline-(resolving?0:BOT_W.card);
        if(showdown){
          const after=polSdOutcome(p,G.showdown,polSdSnap(p,G.showdown));
          score+=(after.cls-beforeCombat.cls)*3+(after.exch-beforeCombat.exch)*BOT_W.unitBase;
        }else if(attackers.length){
          const us=G.players[p].base.filter(u=>attackers.some(a=>a.uid===u.uid));
          score+=Math.max(0,evalAttackValue(p,bfIdx,us))-beforeAttack;
        }
        if(score>BOT_W.moveNeed && (!best||score>best.score+0.0001)) best={bfIdx,damage,score};
      }finally{G=original;}
    }
  }
  return best;
}
// 최소 지불액부터 실제 주문 해결과 후속 공격을 '사용하지 않음'과 비교한다.
// UI 강제 선택은 사본 안에서만 적용한다. 실제 손패·룬·전장 대상은 그대로 남는다.
async function polMfBulletChoice(p,showdown){
  if(!polMfAuroraDeck(p)||TF().preventSpellDmg) return null;
  if(SIM.active||NET.online) return polMfBulletPlan(p,showdown);
  const deadline=SIM.deadline; SIM.deadline=deadline||Date.now()+2000;
  try{
    const ctx={movesLeft:showdown?0:1,tried:new Set()};
    const baseline=await polMfProbeAction(p,null,ctx,null);
    if(!baseline) return null;
    const c=card(POL_MF.bulletTime), max=polMfBulletPower(p);
    const fields=showdown?[G.showdown.bfIdx]:G.bfs.map((_,i)=>i);
    let best=null;
    for(const bfIdx of fields){
      if(!G.bfs[bfIdx].units.some(u=>u.ctrl!==p&&polMfBulletDamage(p,u,1)>0)) continue;
      for(let damage=1;damage<=max;damage++){
        if(SIM.deadline&&Date.now()>SIM.deadline) break;
        const cost={energy:applyCostMods(p,c,c.e||0),pips:Array(damage).fill('Any'),spellOK:true,cardN:POL_MF.bulletTime};
        if(!canPay(p,cost.energy,cost.pips,true)||(!showdown&&polMfCostBlocked(p,cost))) continue;
        const result=await polMfProbeAction(p,async()=>{
          const option=UI.pickOption, number=UI.pickNumber;
          UI.pickOption=(q,t,opts)=>q===p&&/피해를 줄 전장/.test(t)?bfIdx:option(q,t,opts);
          UI.pickNumber=(q,t,lo,hi,x)=>q===p&&/지불할 힘/.test(t)?Math.min(hi,damage):number(q,t,lo,hi,x);
          return playCardFromHand(p,G.players[p].hand.indexOf(POL_MF.bulletTime));
        },ctx,'play',POLICY._mfEmergency===p);
        if(!result||!result.changed) continue;
        const rank=(result.won&&!baseline.won?10000:0)
          +(result.safe&&!baseline.safe?1000:0)+result.value-baseline.value;
        if(rank>BOT_W.moveNeed&&(!best||rank>best.score+0.0001)) best={bfIdx,damage,score:rank};
      }
    }
    return best;
  }finally{SIM.deadline=deadline;}
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
          v+=evalConquestReward(p,dest).value;
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
const POL_BENEFIT = /버프할|위력 \+|준비시킬|준비할|치유|회복|사망 방지|부여할|장착할|복사할|재소환|남길/;   // '남길'(신성한 심판 244 — 보드 전체에서 남길 유닛)은 아군 우선
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
// Structured effect information is shared by live picks and spell evaluation.
// Probes use the existing engine on its cloned state, never another player's hand.
let polEnhanceDepth = 0;
function polEnhanceOps(ops){
  const copy=(ops||[]).some(o=>o.op==='mightSetToOther');
  const out=(ops||[]).filter(o=>o.op==='buff' || o.op==='might' && o.n>0 ||
    ['engarde','mightDouble','mightSetToOther','mightTwoDistinct','gentlemenDuel'].includes(o.op) ||
    copy && o.op==='chooseUnit' || o.op==='setFlag' && o.flag==='buffPlus' ||
    o.op==='grantKw' && o.kws?.some(([k])=>['Shield','Tank','Temporary'].includes(k)));
  return out.some(o=>preTargetSpecs(o).length)?out:null;
}
function polCanBuff(u){ return u.buff<1 || unitFx(u).multiBuff; }
function polEnhanceFallback(p,candidates,selection){
  const op=selection.op||selection.ops[0], prev=selection.prev||[];
  const copy=selection.ops.some(o=>o.op==='mightSetToOther');
  const first=everyUnit().find(u=>u.uid===prev[0])||selection.ctx?.it;
  const score=u=>{
    if(op.op==='gentlemenDuel' && prev.length){
      const m=first?targetMight(first)+3:0;
      return (m>=targetMight(u)-u.dmg?might(u):0)-(targetMight(u)>=m-(first?.dmg||0)?m:0);
    }
    if(u.ctrl!==p) return -1e6;
    if(op.op==='buff' && !polCanBuff(u)) return -1e5;
    if(copy && (op.op==='mightSetToOther' || prev.length)) return might(u);
    const gain=copy?Math.max(0,...everyUnit().filter(x=>x.ctrl===p&&x!==u).map(x=>might(x)-might(u))):
      op.op==='mightDouble'?targetMight(u):op.op==='engarde'?(aloneAt(u)?2:1):op.n||1;
    const active=G.showdown && u.loc===G.showdown.bfIdx;
    return (active?100:!u.ex&&G.turn===p&&G.phase==='action'?10:0)*gain +
      (op.op==='buff'?1:0) + gain*0.01;
  };
  return [...candidates].sort((a,b)=>score(b)-score(a))[0];
}
async function polEnhancePlan(p, selection, candidates){
  const ops=polEnhanceOps(selection.ops);
  if(!ops || polEnhanceDepth || typeof simTry!=='function' || NET.online || (SIM.movementDepth||0)>=2 ||
    _dyingBatch || _deferDeathFx) return null; // Do not re-enter an unfinished death batch; use the structured fallback.
  const prefix=selection.prev||[], ctx=selection.ctx||{p}, original=G;
  const entries=ops.flatMap(op=>preTargetSpecs(op).map(spec=>({op,spec})));
  if(!entries.length) return null;
  const plans=[];
  function collect(index, ids, prev, pre){
    if(index===entries.length){ plans.push({ids,pre}); return; }
    const {op,spec:entry}=entries[index], spec=typeof entry==='function'?entry(p,prev):entry;
    if(spec.battlefield) return;
    let eligible=unitsBySpec(spec,p).filter(u=>canPayDeflect(p,u,selection.cost));
    if(op.op!=='gentlemenDuel' || spec.side!=='enemy') eligible=eligible.filter(u=>u.ctrl===p);
    if(index<prefix.length) eligible=eligible.filter(u=>u.uid===prefix[index]);
    if(index===prefix.length && candidates) eligible=eligible.filter(u=>candidates.some(c=>c.uid===u.uid));
    if(op.op==='buff' && eligible.some(polCanBuff)) eligible=eligible.filter(polCanBuff);
    for(const u of eligible){
      const next=new Map(pre), old=next.get(op);
      next.set(op,old===undefined?u.uid:Array.isArray(old)?[...old,u.uid]:[old,u.uid]);
      collect(index+1,[...ids,u.uid],[...prev,u],next);
    }
  }
  collect(0,[],ctx.it?[ctx.it]:[],new Map());
  if(!plans.length) return null;
  // Try promising ready/combat recipients first if the enclosing turn search runs out of time.
  const fallback=candidates?.length?polEnhanceFallback(p,candidates,selection):null;
  if(fallback) plans.sort((a,b)=>(b.ids[prefix.length]===fallback.uid)-(a.ids[prefix.length]===fallback.uid));
  const deadline=SIM.deadline || Date.now()+Math.min(POLICY.budget||400,1000);
  polEnhanceDepth++;
  try{
    async function probe(plan){
      let burden=0;
      const value=await simTry(p,async()=>{
        const before=new Map(everyUnit().map(u=>[u.uid,{temp:u.tempM.length,grants:{...u.grants},m:might(u)}]));
        if(plan){
          const find=u=>u?everyUnit().find(x=>x.uid===u.uid):null;
          await execOps(ops,{...ctx,p,unit:find(ctx.unit),it:find(ctx.it),pre:plan.pre});
          await cleanup(p);
        }
        await simSettle(null,POLICY);
        if(G.winner===null && G.turn===p && G.phase==='action' && G.state==='neutral'){
          const move=POLICY.movePlan(p);
          if(move){ await moveUnits(p,move.units,move.dest); await simSettle(null,POLICY); }
        }
        // A turn-only bonus left on a survivor is not permanent board material.
        // Keep permanent buff counters; charge surviving Temporary units for their coming loss.
        for(const u of everyUnit()){
          const old=before.get(u.uid); if(!old) continue;
          u.tempM=u.tempM.filter((m,i)=>i<old.temp || m.dur!=='turn');
          for(const k of ['shield','tank']){
            if(old.grants[k]===undefined) delete u.grants[k]; else u.grants[k]=old.grants[k];
          }
          if(u.ctrl===p && u.grants.temporary && !old.grants.temporary)
            burden+=old.m*BOT_W.unitBase+(u.loc==='base'?0:BOT_W.point);
        }
      },POLICY,true,false);
      return value===null?null:value-burden;
    }
    const base=await probe(null);
    if(base===null) return null;
    let best=null;
    for(const plan of plans){
      if(best && Date.now()>deadline) break;
      const value=await probe(plan);
      if(value!==null && (!best || value>best.value+1e-7)) best={...plan,value,gain:value-base};
    }
    return best;
  }finally{ polEnhanceDepth--; if(G!==original) throw new Error('Enhancement probe did not restore game state'); }
}
let polHoldTargetDepth=0;
async function polHoldRemovalTarget(p,candidates,selection){
  const op=selection?.op;
  if(!op || !['kill','damage','damageAll'].includes(op.op) || !evalHoldForecast(opp(p)).win
    || polHoldTargetDepth || NET.online || (SIM.movementDepth||0)>=2 || _dyingBatch || _deferDeathFx) return null;
  const before=evalHoldThreatValue(p);
  let best=null;
  polHoldTargetDepth++;
  try{
    for(const candidate of candidates.filter(u=>u.ctrl!==p)){
      let gain=0;
      const value=await simTry(p,async()=>{
        const targeted={...op,spec:{...op.spec,count:1}};
        await execOps([targeted],{...selection.ctx,p,pre:new Map([[targeted,candidate.uid]])});
        await cleanup(p);
        gain=evalHoldThreatValue(p)-before;
      },POLICY,true,false);
      if(value!==null && gain>0 && (!best || value>best.value)) best={unit:candidate,value};
    }
    return best?.unit||null;
  }finally{polHoldTargetDepth--;}
}
POLICY.unit = async function(p, candidates, promptText, optional, selection){
  if(!candidates || !candidates.length) return null;
  // UI가 비용 확인과 대상 선택을 합쳐도 봇은 기존 수락 여부와 대상 평가를 유지한다.
  if(selection?.costConfirmation){
    const c=selection.costConfirmation;
    if(!POLICY.confirm(p,c.text,c.preview)) return null;
    return candidates.length===1?candidates[0]:POLICY.unit(p,candidates,c.pickTitle,false);
  }
  const txt = String(promptText||'');
  const damage=txt.match(/피해를 배분할 유닛 선택 \(남은 피해 (\d+)\)/);
  if(damage){
    const role=candidates[0].ctrl===G.showdown?.attacker?'attacker':'defender';
    return POLICY.assignTarget(p,candidates,+damage[1],role);
  }
  const assault=txt.match(/\[맹공 (\d+)\]/);
  if(assault) return polAssaultTarget(p,candidates,+assault[1])?.unit||null;
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
  if(selection && polEnhanceOps(selection.ops)){
    const plan=await polEnhancePlan(p,selection,candidates);
    const uid=plan?.ids[(selection.prev||[]).length];
    if(optional && selection.op?.op==='buff' && !candidates.some(u=>u.ctrl===p&&polCanBuff(u))) return null;
    const u=candidates.find(u=>u.uid===uid)||polEnhanceFallback(p,candidates,selection);
    if(u) return u;
  }
  const prevention=await polHoldRemovalTarget(p,candidates,selection);
  if(prevention) return prevention;
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
POLICY.confirm = function(p, text, previewCard, context){
  const txt = String(text||'');
  if(!POLICY.ab.confirm) return true;
  if(!polSmart()) return polHash('c', G.turnCount, txt) < 0.5;

  if(context?.cost && polMfCostBlocked(p,context.cost)) return false;
  if(context?.trashCosts && polMfAuroraDeck(p) && !polMfAuroraOnline(p))
    return context.trashCosts.some(cost=>!polMfCostBlocked(p,cost));

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
POLICY.number = function(p, text, min, max, context){
  const lo = Math.min(min, max), hi = Math.max(min, max);
  if(!POLICY.ab.number) return hi;
  const clamp = v => Math.max(lo, Math.min(hi, v));
  if(!polSmart()) return clamp(lo + Math.floor(polHash('n', G.turnCount, text) * (hi-lo+1)));
  const txt = String(text||'');
  if(polMfAuroraDeck(p) && /지불할 힘\(✳\) 수/.test(txt)){
    // 전장은 플레이 시점에 이미 골랐다(352.8 — option 핸들러가 플랜을 남긴다). 같은 플랜의 액수를 쓰고, 없으면 새로 세운다.
    const bp=POLICY._mfBulletPlan; POLICY._mfBulletPlan=null;
    const bf=context?.bfIdx??((bp&&bp.p===p&&bp.tc===G.turnCount)?bp.bfIdx:null);
    const plan=bp&&bp.p===p&&bp.bfIdx===bf&&bp.signature===polMfBulletSignature(p)
      && bp.damage<=hi ? bp : polMfBulletPlan(p,!!G.showdown,bf,true);
    let n=plan?clamp(plan.damage):clamp(0);
    if(!G.showdown && polMfCostBlocked(p,{pips:Array(n).fill('Any'),cardN:POL_MF.bulletTime})) n=clamp(0);
    polSay('number',n,plan?'미스 포츈 — 비용 대비 유효한 난사 피해':'미스 포츈 — 유효한 난사 경로 없음');
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
        const after=G.bfs.map(b=>({...b,units:b.units.filter(x=>x.uid!==u.uid)}));
        return sign*(might(u)*BOT_W.unitBf + (u.loc!=='base' && G.bfs[u.loc].controller===u.ctrl?BOT_W.control:0))
          + (u.isToken?0:owner===p?BOT_W.card:-BOT_W.card)
          + evalHoldThreatValue(p,after)-evalHoldThreatValue(p);
      };
      return [...options].sort((a,b)=>score(b)-score(a))[0].v;
    }
    if(skip) return skip.v;
    const score=o=>{
      const m=o.movement, u=everyUnit().find(x=>x.uid===m.uid);
      if(!u) return -Infinity;
      const sign=u.ctrl===p?1:-1;
      const holdGain=m.dest==='base'?evalHoldThreatValue(p,G.bfs.map(b=>({...b,units:b.units.filter(x=>x.uid!==u.uid)})))-evalHoldThreatValue(p):0;
      return holdGain+sign*((m.dest==='base'?0:evalAttackValue(u.ctrl,m.dest,[u]))-polMoveSourceLoss(u.ctrl,[u]));
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
let polPlacementDepth=0;
function polPlacementValue(p){
  let value=evalState(G,p);
  if(G.winner!==null) return value;
  // Do not prefer an occupied friendly battlefield merely for its material weight.
  for(let i=0;i<G.bfs.length;i++){
    value-=G.bfs[i].units.filter(u=>u.ctrl===p).reduce((s,u)=>s+might(u),0)*(BOT_W.unitBf-BOT_W.unitBase);
    if(G.bfs[i].controller!==p) continue;
    const threat=polThreatAt(p,i);
    if(Number.isFinite(threat)) value-=Math.max(0,threat);
  }
  return value;
}
async function polPlacementPlan(p,options){
  const data=options.find(o=>o.placement)?.placement;
  const base=options.find(o=>o.v==='base')||options[0];
  if(!data || options.length===1 || !polSmart() || !POLICY.ab.place) return {option:base,gain:0};
  if(polPlacementDepth || NET.online || (SIM.movementDepth||0)>=2 || _dyingBatch || _deferDeathFx){
    const v=data.n!==undefined?polMfEndingPlacement(p,data.n,options):base.v;
    return {option:options.find(o=>o.v===v)||base,gain:0};
  }
  const original=G, ordered=[base,...options.filter(o=>o!==base)];
  let best=null, baseValue=null;
  polPlacementDepth++;
  try{
    for(const option of ordered){
      let value=null;
      const probe=await simTry(p,async()=>{
        // The remaining composition is known to its owner, the order is not.
        G.players[p].deck.sort((a,b)=>a-b);
        if(data.token){
          const pick=UI.pickOption;
          UI.pickOption=(q,t,opts)=>q===p&&/배치할/.test(t)?option.v:pick(q,t,opts);
          try{ await execOps([data.token],{...data.ctx,p,unit:everyUnit().find(u=>u.uid===data.ctx?.unit?.uid)}); }
          finally{ UI.pickOption=pick; }
        }else{
          const ok=await playCardFromHand(p,data.handIdx,{...data.opts,playLoc:option.v});
          if(ok===false) return;
        }
        await cleanup(p);
        await simSettle(null,POLICY);
        if(G.winner===null && G.phase==='action' && G.turn===p && G.state==='neutral'){
          const move=POLICY.movePlan(p);
          if(move){await moveUnits(p,move.units,move.dest);await simSettle(null,POLICY);}
        }
        value=polPlacementValue(p);
      },POLICY,true,false);
      if(probe===null || value===null) continue;
      if(option===base) baseValue=value;
      if(!best || value>best.value+BOT_W.moveNeed) best={option,value};
    }
    return best?{...best,gain:baseValue===null?0:Math.max(0,best.value-baseValue)}:{option:base,gain:0};
  }finally{polPlacementDepth--;if(G!==original)throw new Error('Placement probe did not restore game state');}
}
async function polPlacementBonus(p,n,handIdx,opts={}){
  if(polPlacementDepth || !polSmart() || !POLICY.ab.place) return 0;
  const options=unitPlayLocationOptions(p,n).map(o=>({...o,placement:{n,handIdx,opts}}));
  if(options.length<2) return 0;
  return (await polPlacementPlan(p,options)).gain*100;
}
function polMfEndingPlacement(p,n,options){
  const unit={n,uid:-1,ctrl:p,owner:p,loc:'base',isToken:false,ex:true,stunned:false,
    dmg:0,buff:0,tempM:[],gear:[],grants:{},turnMoves:0};
  let best=options.find(o=>o.v==='base')||options[0], value=0;
  for(const o of options){
    if(typeof o.v!=='number') continue;
    const bf=G.bfs[o.v]; let score=0;
    if(bf.controller===p){
      const before=polThreatAt(p,o.v), after=polThreatAt(p,o.v,[unit]);
      if(Number.isFinite(before)&&Number.isFinite(after)) score=Math.max(0,before-after);
      // 상대의 마지막 정복 점수를 막는 수비를 우선한다.
      if(before>0 && after<=0 && G.players[opp(p)].points>=G.victory-1) score+=BOT_W.point;
    }else{
      const combat=evalCombat(p,o.v,[unit]);
      if(combat.result!=='conquer') continue;
      score=evalAttackValue(p,o.v,[unit]);
      const original=G;
      try{
        G={...G,bfs:G.bfs.map((b,i)=>i===o.v?{...b,controller:p,units:b.units.filter(u=>u.ctrl===p)}:b)};
        const counter=polThreatAt(p,o.v,[unit]);
        if(Number.isFinite(counter)) score-=Math.max(0,counter);
      }finally{G=original;}
      if(G.players[opp(p)].points+evalHolds(opp(p))>=G.victory) score+=BOT_W.point;
    }
    if(score>value+BOT_W.moveNeed){best=o;value=score;}
  }
  polSay('placement',best.label,'종료 소환 — 다음 상대 턴 수비·정복 비교',{value});
  return best.v;
}
async function polMfReadyOption(p,options){
  const P=G.players[p];
  const fallback=o=>o.v.t==='u'?might(o.v.u):o.v.t==='g'?2:o.v.t==='l'?1:0.25;
  const ranked=options.map(o=>({o,base:fallback(o)})).sort((a,b)=>b.base-a.base);
  let best=null; const seenRunes=new Set();
  for(const {o,base} of ranked){
    const v=o.v;
    if(v.t==='r'){if(seenRunes.has(v.r.n)) continue;seenRunes.add(v.r.n);}
    const uid=v.u?.uid, gi=v.g?P.gear.indexOf(v.g):-1, ri=v.r?P.runes.indexOf(v.r):-1;
    const value=await simTry(p,async()=>{
      if(v.t==='u') await readyUnit(everyUnit().find(u=>u.uid===uid),p);
      else if(v.t==='g') G.players[p].gear[gi].ex=false;
      else if(v.t==='r') G.players[p].runes[ri].ex=false;
      else G.players[p].legendEx=false;
      await simSettle();
      if(G.winner!==null || G.turn!==p || G.state!=='neutral') return;
      POLICY.turnPlan=null;
      const ctx=POLICY.newCtx(); POLICY.syncCtx(ctx);
      const act=await POLICY.nextAction(p,ctx);
      if(act && act.kind!=='end') await POLICY.runAction(p,act);
      await simSettle();
      if(G.winner===null && G.state==='neutral' && act?.kind!=='move'){
        const mv=POLICY.movePlan(p);
        if(mv) await moveUnits(p,mv.units,mv.dest);
      }
    },POLICY,true);
    if(value!==null && (!best || value>best.value+1e-6 || Math.abs(value-best.value)<1e-6&&base>best.base))
      best={o,value,base};
  }
  const pick=best?.o||ranked[0].o;
  polSay('ready',pick.label,best?'준비 후 카드·능력·이동 결과 비교':'탐색 예산 부족 — 유닛 위력 우선');
  return pick.v;
}
async function polMfDiscardChoice(p,options){
  const online=polMfAuroraOnline(p),o=opp(p),P=G.players[p];
  const handCount=G.players[o].hand.length;
  const strategic=n=>{
    const hasEngine=online||P.hand.includes(160),hasGear=P.gear.length>0;
    const handAttack=(POL_MF_HAND_ATTACK.get(n)||0)/700;
    const gearAttack=(POL_MF_AURORA_HATE.get(n)||0)/600;
    return (online?(hasGear?gearAttack*2:0)+handAttack*0.25
      :(hasEngine?handAttack*2:handAttack*0.5)+(hasGear?gearAttack:0));
  };
  const fallback=[...options].sort((a,b)=>strategic(b.n)-strategic(a.n))[0];
  if(SIM.active||NET.online) return fallback.v;
  const deadline=SIM.deadline;SIM.deadline=deadline||Date.now()+1800;
  const prepare=async n=>{
    const O=G.players[o], naturalEnergy=Math.min(2,O.runeDeck.length);
    // 현재 공개 효과를 낸 주문은 이 선택 뒤 체인을 떠난다. 다음 턴 번아웃 계산에 포함한다.
    const source=options[0]?.resolvingSpell;
    if(source&&G._spellPreTrashed!==source.n)
      G.players[source.owner][G._banishSpell?'banish':'trash'].push(source.n);
    G.turn=o;G.actingPlayer=o;G.phase='action';G.state='neutral';G.showdown=null;
    G._endingTurn=null;G._rwFor=null;G._casting=null;
    O.hand=[];O.deck=O.deck.map(()=>POL_MF.mobilize);
    // 시작 단계·유지 득점은 엔진으로 처리한다. 새 룬의 비공개 힘 영역은 가정하지 않는다.
    O.runeDeck=[];
    await startTurn();
    O.hand=options.map(option=>option.n);
    while(O.hand.length<handCount)O.hand.push(POL_MF.mobilize);
    O.energy+=naturalEnergy;
  };
  try{
    let baseWon=false;
    const base=await simTry(p,async()=>{
      await prepare(POL_MF.mobilize);
      const mv=POLICY.movePlan(o);if(mv){await moveUnits(o,mv.units,mv.dest);await simSettle();}
      baseWon=G.winner===o;
    },POLICY,false,false);
    let best=null;
    for(const option of options){
      if(SIM.deadline&&Date.now()>SIM.deadline)break;
      let legal=false,won=false;
      const after=await simTry(p,async()=>{
        await prepare(option.n);
        if(G.winner!==null)return;
        if(!polCanPlay(o,card(option.n)))return;
        const before=simHash(G),ok=await playCardFromHand(o,G.players[o].hand.indexOf(option.n));
        if(ok===false||before===simHash(G))return;
        legal=true;await simSettle();
        if(G.state==='neutral'&&G.winner===null){
          const mv=POLICY.movePlan(o);if(mv){await moveUnits(o,mv.units,mv.dest);await simSettle();}
        }
        won=G.winner===o;
      },POLICY,false,false);
      const copies=options.filter(x=>x.n===option.n).length;
      const loss=base!==null&&after!==null?Math.max(0,base-after):0;
      const score=((won&&!baseWon?10000:0)+loss+strategic(option.n)*(legal?1:0.1))/(1+0.5*(copies-1));
      if(!best||score>best.score)best={option,score};
    }
    const pick=best?.option||fallback;
    polSay('option',pick.label,'미스 포츈 — 공개 카드의 사용 가능성·승리 위험·남은 복사본');
    return pick.v;
  }finally{SIM.deadline=deadline;}
}
POLICY.option = function(p, title, options){
  if(!options || !options.length) return null;
  const confirmation=options.find(o=>o.costConfirmation)?.costConfirmation;
  if(confirmation){
    if(!POLICY.confirm(p,confirmation.text)) return null;
    return POLICY.option(p,confirmation.pickTitle,options.map(({costConfirmation,...o})=>o));
  }
  if(options.some(o=>o.placement)) return polPlacementPlan(p,options).then(r=>r.option.v);
  if(options.some(o=>o.hidePayment)) return (options.find(o=>o.v==='energy')||options[0]).v;
  if(options.every(o=>o.combatTrigger)){
    // 공개된 효과만 비교: 피해를 먼저, 워윅의 피해받은 적 처치는 나중에 해결한다.
    const score=o=>o.combatTrigger.n===159?-10:
      o.combatTrigger.ops.some(op=>['damage','damageAll','dealSplit','dmgEqMyMight','teemoDefend','tfFury'].includes(op.op))?10:0;
    return [...options].sort((a,b)=>score(b)-score(a))[0].v;
  }
  // 선후공 선택(주사위 승리): 선공을 고른다
  if(options.some(o=>o.v==='first') && options.some(o=>o.v==='second')){ polSay('option','선공','주사위 승리 — 선공 선택'); return 'first'; }
  if(options.some(o=>o.movement || o.returnHand)) return polMovementOption(p,options);
  const txt = String(title||'');
  if(polMfAuroraDeck(p)){
    if(txt==='준비시킬 대상 (선택)') return polMfReadyOption(p,options);
    if(txt==='소유자의 손패로 되돌릴 대상'){
      const treasure=options.find(o=>o.v?.t==='gear' && G.players[p].gear[o.v.i]?.n===186);
      if(treasure) return treasure.v;
      if(polMfAuroraOnline(p)) return null;
    }
    if(txt==='폐기장에서 플레이할 카드'){
      const safe=options.filter(o=>!o.powerCost || !polMfCostBlocked(p,{pips:o.powerCost}));
      return safe.sort((a,b)=>(card(b.n).m||0)-(card(a.n).m||0))[0]?.v??null;
    }
    if(txt==='[일시적]를 부여할 대상 (전장의 유닛 또는 도구)'){
      for(const target of polMfMemoryTargets(p)){
        const pick=options.find(o=>o.v?.t===target.v.t && (target.v.t==='u'
          ? o.v.uid===target.v.uid : o.v.pi===target.v.pi && o.v.i===target.v.i));
        if(pick) return pick.v;
      }
      return null;
    }
    if(/피해를 줄 전장/.test(txt)){
      // 전장은 플레이 시점에 고른다(352.8) — 플랜을 여기서 세우고 힘 액수(number, 해결 시점)가 이어받는다
      let bp=POLICY._mfBulletPlan;
      if(!(bp && bp.p===p && bp.tc===G.turnCount && bp.sd===(G.showdown||null)
        && bp.signature===polMfBulletSignature(p))){
        const plan=polMfBulletPlan(p,!!G.showdown);
        bp=plan?{p,tc:G.turnCount,sd:G.showdown||null,signature:polMfBulletSignature(p),...plan}:null;
      }
      POLICY._mfBulletPlan=bp;
      if(bp){
        const pick=options.find(o=>o.v===bp.bfIdx);
        if(pick){ polSay('option',pick.label,'미스 포츈 — 쌍권총 난사 목표 전장'); return pick.v; }
      }
    }
    // 오로라가 무료 플레이한 죽음꽃 포식자 같은 유닛은 자체 허용 효과에 따라
    // 유지된 적 전장에 직접 배치할 수 있다. 정복 가치가 양수인 적 전장이면 기지보다 우선한다.
    if(/유닛을 배치할 위치/.test(txt)){
      const unitN=options.find(o=>o.unitN!==undefined)?.unitN;
      const fx=unitN!==undefined?(FX[unitN]||{}):{};
      if(unitN!==undefined && G.phase==='ending') return polMfEndingPlacement(p,unitN,options);
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
    if(/버리게 할 카드|재활용시킬 카드/.test(txt)) return polMfDiscardChoice(p,options);
    // 조작된 덱: 엔진 조각을 찾되, 선택지가 전부 유닛이면 오로라가 공짜로 뽑을
    // 고비용 유닛을 덱에 남기고 가장 작은 유닛을 손으로 가져온다.
    if(/손패에 넣을 카드/.test(txt)) return polMfStackedChoice(p,options);
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
  const returns=options.filter(o=>Number.isInteger(o.v?.hand) && o.card && polIsReturnSpell(o.card.n));
  if(pending && returns.length && !SIM.lock && !NET.online){
    // 응수 창이 닫힌 뒤의 해결·클린업 — G._rwFor(닫힌 상태 표시)를 지워야 샌드박스의 cleanup이 통제 해제·결전 개시를 한다 (190.6 · 341)
    const finish=async()=>{ G._rwFor=null;G._returnPending=pending;await polResolveReturnPending();await cleanup(pending.p); };
    const before=await simTry(p,finish,POLICY);
    let best=null;
    for(const o of returns){
      const after=await simTry(p,async()=>{
        G._rwFor=p;G._returnPending=pending;
        await playCardFromHand(p,o.v.hand);
        await finish();
      },POLICY);
      polSay('reaction-check',o.label,before===null||after===null
        ? '회수 응수 시뮬레이션 실패' : '회수 응수 결과 비교',{before,after});
      if(before!==null && after!==null && after>before+BOT_W.moveNeed && (!best || after>best.value)) best={v:o.v,value:after};
    }
    if(best) return best.v;
  }
  return null;   // 일반 [반응]은 결전용으로 아낀다
};

// ══════════ 멀리건 ══════════
function polMfDeckStyle(p){
  const list=G.players[p].deckList||[];
  return list.includes(186)&&list.includes(181)?'treasure':list.includes(196)?'spell':'midrange';
}
// 알려진 시작 손패만 첫 3번의 내 턴에 배분한다. 이후 드로우 성공을 가정하지 않는다.
function polMfOpeningValue(p,hand){
  const original=G.players[p], style=polMfDeckStyle(p);
  const pool=[...original.runeDeck,...original.runes.map(r=>r.n)].sort((a,b)=>a-b);
  const groups=[...new Set(pool)].map(n=>pool.filter(x=>x===n)), order=[];
  while(groups.some(g=>g.length)) for(const g of groups) if(g.length) order.push(g.pop());
  const P={...original,hand:[...hand],runes:[],runeDeck:order,gear:[],base:[],
    energy:0,energySpell:0,powerSpell:0,power:Object.fromEntries(Object.keys(original.power).map(k=>[k,0]))};
  let value=hand.includes(160)?1.2:0,treasure=false,bundle=false;
  if(!hand.includes(160)&&hand.includes(183)) value+=0.65;
  try{
    G.players[p]=P;
    for(let turn=0;turn<3;turn++){
      P.runes.forEach(r=>r.ex=false);P.energy=0;P.energySpell=0;P.powerSpell=0;
      Object.keys(P.power).forEach(k=>P.power[k]=0);
      const obelisk=turn===0?G.bfs.reduce((s,b)=>s+(FX[b.n]?.triggers?.onFirstBeginning||[])
        .flatMap(g=>g.ops||[]).filter(op=>op.op==='channel').reduce((n,op)=>n+op.n,0),0):0;
      const add=(turn===0?(G.turn===p?2:3):2)+obelisk;
      for(let i=0;i<add&&P.runeDeck.length;i++) P.runes.push({n:P.runeDeck.shift(),ex:false});
      for(let step=0;step<hand.length;step++){
        const candidates=P.hand.map((n,i)=>{
          const c=card(n), cost=applyCostMods(p,c,c.e||0);
          if(!canPay(p,cost,powerPips(c),c.type==='Spell')) return null;
          let score=0;
          if(n===160) score=10;
          else if(n===138&&P.runeDeck.length) score=5;
          else if(n===134&&P.runeDeck.length) score=4;
          else if(n===186&&style==='treasure') score=3;
          else if(n===181&&style==='treasure'&&(treasure||P.hand.includes(186))) score=2;
          else if(c.type==='Unit') score=1+(c.m||0)/10;
          else if(n===183) score=0.8;
          return score?{n,i,c,cost,score}:null;
        }).filter(Boolean).sort((a,b)=>b.score-a.score);
        if(!candidates.length) break;
        const a=candidates[0];payCost(p,a.cost,powerPips(a.c),true,a.c.type==='Spell');P.hand.splice(a.i,1);
        if(a.n===160){value+=4/(turn+1);P.gear.push({n:160});}
        else if(a.n===134||a.n===138){
          const n=Math.min(a.n===138?2:1,P.runeDeck.length);
          for(let i=0;i<n;i++) P.runes.push({n:P.runeDeck.shift(),ex:true});
          value+=n*0.5/(turn+1);
        }else if(a.n===186){treasure=true;value+=0.65/(turn+1);}
        else if(a.n===181){bundle=true;value+=(treasure?0.8:0.15)/(turn+1);}
        else if(a.c.type==='Unit') value+=(a.c.m||0)*(style==='midrange'?0.45:0.22)/(turn+1);
        else if(a.n===183) value+=(hand.includes(160)?0.12:0.4)/(turn+1);
      }
      // 보물의 드로우/재전개는 실제로 힘을 낼 수 있을 때만 시작 패의 장점으로 센다.
      if(treasure&&(bundle||canPay(p,0,['Chaos']))){
        if(!bundle) payCost(p,0,['Chaos'],true);
        if(P.runeDeck.length) P.runes.push({n:P.runeDeck.shift(),ex:true});
        value+=0.25/(turn+1);treasure=false;
        if(bundle) P.hand.push(186);
      }
    }
    return value;
  }finally{G.players[p]=original;}
}
function polMfMulligan(p){
  const P=G.players[p], hand=P.hand, pool=[...(P.deckList||[])];
  for(const n of hand){const i=pool.indexOf(n);if(i>=0)pool.splice(i,1);}
  if(P.champInZone){const i=pool.indexOf(P.champN);if(i>=0)pool.splice(i,1);}
  if(!pool.length) return [];
  pool.sort((a,b)=>a-b);
  const swaps=[[]];for(let i=0;i<hand.length;i++){
    swaps.push([i]);for(let j=i+1;j<hand.length;j++)swaps.push([i,j]);
  }
  const memo=new Map(), value=h=>{
    const key=[...h].sort((a,b)=>a-b).join(',');
    if(!memo.has(key)) memo.set(key,polMfOpeningValue(p,h));
    return memo.get(key);
  };
  let best={swap:[],value:value(hand)};
  // 알려진 남은 구성에서 같은 표본을 비교한다. 실제 덱 순서는 읽지 않는다.
  for(const swap of swaps.slice(1)){
    if(pool.length<swap.length) continue;
    let total=0;const samples=Math.min(16,pool.length);
    for(let sample=0;sample<samples;sample++){
      const remaining=[...pool], h=hand.filter((_,i)=>!swap.includes(i));
      for(let k=0;k<swap.length;k++){
        const index=(Math.floor(sample*remaining.length/samples)+k*Math.floor(remaining.length*0.618))%remaining.length;h.push(remaining.splice(index,1)[0]);
      }
      total+=value(h);
    }
    const average=total/samples-0.03*swap.length;
    if(average>best.value+0.001) best={swap,value:average};
  }
  polSay('mulligan',best.swap.length+'장 교체','미스 포츈 — '+polMfDeckStyle(p)+' 초기 3턴 전개 비교');
  return best.swap;
}
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
  if(polMfAuroraDeck(p)) return polMfMulligan(p);
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
function polEngineTrick(n){ return polIsReturnSpell(n)||n===128||n===203; }
async function polReturnShowdownAction(p){
  if(!POLICY.ab.showdown || (SIM.lock && !SIM.settling) || NET.online) return null;
  const candidates=[];
  G.players[p].hand.forEach((n,idx)=>{
    if(polEngineTrick(n) && polCanPlay(p,card(n))) candidates.push({kind:'play',idx,n});
  });
  G.bfs.forEach((bf,bfIdx)=>{
    const h=bf.hiddenCards.find(x=>x.by===p && !(x.turn===G.turnCount && G.turn===p));
    if(h && polEngineTrick(h.n)) candidates.push({kind:'hidden',bfIdx,n:h.n});
  });
  if(!candidates.length) return null;
  const before=await simTry(p,async()=>{},POLICY,false,false);
  if(before===null) return null;
  let best=null;
  for(const act of candidates){
    const after=await simTry(p,()=>POLICY.runAction(p,act),POLICY,false,false);
    if(after!==null && after>before+BOT_W.moveNeed && (!best || after>best.value)) best={act,value:after};
  }
  if(best) polSay('showdown',card(best.act.n).ko,'실제 주문 해결로 결전 결과 개선',{delta:best.value-before});
  return best?.act||null;
}
function polIsRelocationSpell(n){
  const c=card(n), fx=FX[n]||{};
  return c.type==='Spell' && polHasRelocateOp(fx.playOps||[]);
}

// 맹공 부여 주문은 공격 중인 결전에서 실제 처치·생존 결과를 개선할 때만 쓴다.
function polAssaultBonus(n){
  if(card(n).type!=='Spell') return 0;
  return (FX[n]?.playOps||[]).flatMap(g=>g.ops||[])
    .filter(op=>op.op==='grantKw').flatMap(op=>op.kws||[])
    .reduce((sum,[kw,v])=>sum+(kw==='Assault'?Number(v)||0:0),0);
}
function polAssaultTarget(p,candidates,bonus){
  const sd=G.showdown;
  if(!sd?.hasCombat || sd.attacker!==p || bonus<=0) return null;
  const snap0=polSdSnap(p,sd), base=polSdOutcome(p,sd,snap0);
  let best=null;
  for(const u of candidates){
    if(u.ctrl!==p || u.loc!==sd.bfIdx || u.stunned) continue;
    const snap={mine:snap0.mine.map(x=>({...x})),theirs:snap0.theirs.map(x=>({...x}))};
    const t=snap.mine.find(x=>x.uid===u.uid);
    if(!t) continue;
    const boosted={...u,grants:{...u.grants,assault:(Number(u.grants.assault)||0)+bonus}};
    t.m=might(boosted,'attacker');
    t.lethal=Math.max(1,might(boosted,'attacker',{forKill:true})-u.dmg);
    const out=polSdOutcome(p,sd,snap);
    const gain=(out.cls-base.cls)*10+out.exch-base.exch;
    if(gain>0 && (!best || gain>best.gain)) best={unit:u,gain};
  }
  return best;
}
async function polAssaultShowdownAction(p){
  const sd=G.showdown;
  if(!sd?.hasCombat || sd.attacker!==p || sd.chain.length || (SIM.lock && !SIM.settling) || NET.online) return null;
  const candidates=[];
  G.players[p].hand.forEach((n,idx)=>{
    const bonus=polAssaultBonus(n);
    if(bonus && polCanPlay(p,card(n)) && polAssaultTarget(p,unitsAt(sd.bfIdx),bonus))
      candidates.push({kind:'play',idx,n});
  });
  if(!candidates.length) return null;
  const before=await simTry(p,async()=>{},POLICY,false,false);
  if(before===null) return null;
  let best=null;
  for(const act of candidates){
    const after=await simTry(p,async()=>{
      await POLICY.runAction(p,act);
      await simSettle(); // 비교 중에는 추가 트릭 없이 이 주문의 효과만 해결
    },POLICY,false,false);
    if(after!==null && after>before+Math.max(0,BOT_W.moveNeed||0) && (!best || after>best.value))
      best={act,value:after};
  }
  if(best) polSay('showdown',card(best.act.n).ko,'맹공: 공격 전투 개선·사용 비용 확인',{delta:best.value-before});
  return best?.act||null;
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
      c.score=Math.max(c.score,30-polCost(card(c.n)));
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
function polMfFaceOffFollowup(p,blocked){
  if(TF().enterReady[p]) return false;
  const P=G.players[p], c=card(129);
  const next={...P,runes:P.runes.map(r=>({...r})),runeDeck:[...P.runeDeck],power:{...P.power}};
  try{
    G.players[p]=next;
    const e=applyCostMods(p,c,c.e||0);
    if(!canPay(p,e,powerPips(c),true)) return false;
    payCost(p,e,powerPips(c),true,true);
    const units=P.hand.filter(n=>card(n).type==='Unit' && !blocked?.has('h'+n));
    if(P.champInZone&&!blocked?.has('champ')) units.push(P.champN);
    return units.some(n=>polCanPlay(p,card(n))&&!polMfNeutralCardBlocked(p,n));
  }finally{G.players[p]=P;}
}
function polMfStackedDefault(p,options){
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
    const baseline=polMfAuroraTurns(p,null,true);
    const ranked=rampOpts.map((o,i)=>({o,i,turns:polMfAuroraTurns(p,o.n,true),
      channel:o.n===POL_MF.catalyst?2:1,
      now:polCanPlay(p,card(o.n))?1:0})).filter(x=>x.turns<baseline).sort((a,b)=>
        a.turns-b.turns || b.now-a.now || b.channel-a.channel || a.i-b.i);
    const pick=ranked[0];
    if(pick){
      polSay('option',pick.o.label,'미스 포츈 — 오로라 자원 가속 선택',{turns:pick.turns});
      return pick.o.v;
    }
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
async function polMfStackedChoice(p,options){
  const fallback=polMfStackedDefault(p,options), P=G.players[p];
  const danger=POLICY.race(p).oppLethal;
  const enemyPower=everyUnit().filter(u=>u.ctrl!==p).reduce((s,u)=>s+might(u),0);
  const ownPower=everyUnit().filter(u=>u.ctrl===p).reduce((s,u)=>s+might(u),0);
  const need=enemyPower>ownPower || G.bfs.some((bf,i)=>bf.controller===p&&polThreatAt(p,i)>0.05);
  if(!danger&&!need) return fallback;
  const firstAurora=options.some(o=>o.v===fallback&&o.n===POL_MF.aurora)
    && !P.hand.includes(POL_MF.aurora)&&!polMfAuroraOnline(p);
  if(!SIM.active&&!NET.online){
    const deadline=SIM.deadline; SIM.deadline=deadline||Date.now()+1500;
    try{
      const ctx={movesLeft:1,tried:new Set()};
      const base=await polMfProbeAction(p,null,ctx,null);
      let best=null;
      for(const o of options){
        if(SIM.deadline&&Date.now()>SIM.deadline) break;
        if(!o.n || !polCanPlay(p,card(o.n))) continue;
        const result=await polMfProbeAction(p,async()=>{
          G.players[p].hand.push(o.n);
          if(polMfNeutralCardBlocked(p,o.n)) return false;
          return playCardFromHand(p,G.players[p].hand.length-1);
        },ctx,'play',danger);
        if(!result||!base||!result.changed) continue;
        const urgent=result.won || (danger&&!base.safe&&result.safe);
        const gain=result.value-base.value-BOT_W.card;
        const defended=result.opHolds<base.opHolds || result.threat<base.threat-0.05;
        if(!urgent && (danger||firstAurora||!defended||gain<=0.4)) continue;
        const rank=(urgent?1000:0)+gain;
        if(!best||rank>best.rank) best={o,rank};
      }
      if(best){polSay('option',best.o.label,'미스 포츈 — 공개 위협에 필요한 카드');return best.o.v;}
    }finally{SIM.deadline=deadline;}
  }
  // 즉시 해결 수가 없을 때, 다음 내 턴 직접 낼 수 있는 병력도 선택한다.
  // 다음 드로우 내용은 모르므로 자연 룬 2개만 더하며, 첫 오로라 탐색은 보존한다.
  if(!danger&&!firstAurora){
    const candidates=options.filter(o=>o.n&&card(o.n).type==='Unit').filter(o=>{
      const c=card(o.n), saved=G.players[p];
      const future={...saved,runes:saved.runes.map(r=>({...r,ex:false})),
        runeDeck:polMfWorstRuneOrder(saved.runeDeck),energy:0,energySpell:0,powerSpell:0,
        power:Object.fromEntries(Object.keys(saved.power).map(k=>[k,0]))};
      try{
        G.players[p]=future;
        for(let i=0;i<2&&future.runeDeck.length;i++) future.runes.push({n:future.runeDeck.shift(),ex:false});
        return canPay(p,applyCostMods(p,c,c.e||0),powerPips(c)) && !polMfCostBlocked(p,
          {energy:applyCostMods(p,c,c.e||0),pips:powerPips(c)});
      }finally{G.players[p]=saved;}
    }).sort((a,b)=>(card(b.n).m||0)-(card(a.n).m||0));
    if(candidates.length){polSay('option',candidates[0].label,'미스 포츈 — 다음 턴 직접 전개할 병력');return candidates[0].v;}
  }
  return fallback;
}
POLICY.pickPlay = async function(p, blocked){
  const P = G.players[p];
  const budget = readyRunes(p).length - POLICY.reserve(p);
  let cands = [];
  P.hand.forEach((n,i)=>{
    if(blocked && blocked.has('h'+n)) return;
    const c = card(n);
    if(polAssaultBonus(n)) return; // 공격 결전의 전용 평가까지 보류
    if(POLICY.ab.canpay ? !polCanPlay(p, c) : polCost(c) > readyRunes(p).length) return;
    if(POLICY.ab.reserve && polCost(c) > Math.max(0, budget)) return;  // 상대 턴 응수분은 남긴다
    if(polMfNeutralCardBlocked(p,n)) return;
    // 일반 행동 난사는 부분 제거·후속 공격도 비교하며 오로라 자원 기준을 유지한다.
    if(polMfAuroraDeck(p) && n===POL_MF.bulletTime
      && !polMfBulletPlan(p,false)) return;
    const fx = FX[n]||{kw:{}};
    if(polMfAuroraDeck(p) && n===129 && !polMfFaceOffFollowup(p,blocked)) return;
    let score;
    // 준비 룬이 생기는 다음 내 턴을 앞당기는 순서. 오로라를 지금 낼 수 있으면
    // 추가 가속보다 먼저 설치해 이번 종료 단계부터 무료 소환을 받는다.
    if(polMfAuroraDeck(p) && n===POL_MF.invert) score=100+polMfTimelineValue(p)*100;
    else if(polMfAuroraDeck(p) && n===POL_MF.bulletTime) score=500;
    else if(polMfAuroraDeck(p) && !polMfAuroraOnline(p) && n===POL_MF.aurora) score=10000;
    else if(polMfAuroraDeck(p) && !polMfAuroraOnline(p)
      && n===POL_MF.catalyst && P.runeDeck.length>=2) score=polMfRampPriority(p,n);
    else if(polMfAuroraDeck(p) && !polMfAuroraOnline(p)
      && n===POL_MF.mobilize && P.runeDeck.length>=1) score=polMfRampPriority(p,n);
    else if(polMfBuildingAurora(p)
      && n===POL_MF.stacked && !P.hand.includes(POL_MF.aurora)) score=7000;
    else if(polMfAuroraDeck(p) && n===129) score=600;
    else if(c.type==='Unit') score = 100 + (c.m||0)*2 - polCost(c)*BOT_W.playCost;
    else if(polMfAuroraDeck(p)&&n===POL_MF.aurora) score=50+polMfExtraAuroraValue(p)*100;
    else if(c.type==='Gear') score = 50 - polCost(c);
    else if(polHard() && (fx.kw.action||fx.kw.reaction)) score = -1;   // 결전용으로 아낌
    else score = 30 - polCost(c);
    cands.push({ i, n, score });
  });
  for(const c of cands) if(card(c.n).type==='Unit') c.score+=await polPlacementBonus(p,c.n,c.i);
  cands = await polGateRelocationSpells(p,cands);
  if(polMfAuroraDeck(p) && !SIM.active && cands.some(c=>c.n===POL_MF.bulletTime)){
    const plan=await polMfBulletChoice(p,false);
    if(!plan) cands=cands.filter(c=>c.n!==POL_MF.bulletTime);
    else POLICY._mfBulletPlan={p,tc:G.turnCount,sd:G.showdown||null,signature:polMfBulletSignature(p),...plan};
  }
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
  const champScore = 100 + (cs.m||0)*2 - polCost(cs) + await polPlacementBonus(p,cs.n,-1,{champZone:true});
  if(handAct && POLICY._playScore > champScore) return handAct;
  polSay('play', cs.ko, '챔피언 우선', {champScore, best:POLICY._playScore});
  return { kind:'champ' };
};

// ══════════ 승점 레이스 ══════════
POLICY.race = function(p){
  const o = opp(p), V = G.victory;
  // 일시적은 그 통제자의 개시 단계에서 유지 득점 전에 사라진다.
  const mine=evalHoldForecast(p), theirs=evalHoldForecast(o);
  const myPts = G.players[p].points, opPts = G.players[o].points;
  return {
    V, myPts, opPts,
    myCtrl: mine.holds, opCtrl: theirs.holds,
    // 상대가 다음 개시에 유지만으로 이기는가
    oppLethal: theirs.win,
    // 내가 유지만으로 이기는가 (유지는 최종 점수 제한 면제)
    myLethal: mine.win,
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
function polNextTurnUnit(u){
  return {...u,ex:false,stunned:false,dmg:0,turnMoves:0,
    tempM:u.tempM.filter(t=>t.dur!=='turn'),grants:u.grants.temporary?{temporary:true}:{}};
}
function polThreatAt(p, i, extra, nextTurn=true){
  const original=G, o=opp(p);
  try{
    if(nextTurn){
      G={...G,players:G.players.map((P,q)=>q===o?{...P,scoredBf:{}}:P),
        bfs:G.bfs.map(bf=>({...bf,scored:{...bf.scored,[o]:false},units:bf.units.map(polNextTurnUnit)}))};
    }
    const atk=(nextTurn?G.players[o].base.filter(u=>!effKw(u).temporary).map(polNextTurnUnit)
      :G.players[o].base.filter(u=>!u.ex&&!u.stunned)).concat(polPeekIncoming(p))
      .sort((a,b)=>might(b)-might(a));
    if(!atk.length) return -Infinity;
    let best=-Infinity; const send=[];
    for(const u of atk){
      send.push(u);
      const v=evalAttackValue(o,i,[...send],nextTurn?(extra||[]).map(polNextTurnUnit):extra);
      if(v>best) best=v;
    }
    return best;
  }finally{G=original;}
}

// ══════════ 이동 계획 ══════════
function polMfAttackGroups(units){
  const strong=[...units].sort((a,b)=>might(b)-might(a)), groups=[],seen=new Set();
  const add=us=>{const key=us.map(u=>u.uid).sort((a,b)=>a-b).join(',');if(us.length&&!seen.has(key)){seen.add(key);groups.push(us);}};
  for(let i=1;i<=strong.length;i++)add(strong.slice(0,i));
  for(const u of strong.filter(u=>u.n===162||unitFx(u).triggers?.onAttack?.length||effKw(u).deflect)){
    const rest=strong.filter(x=>x!==u);
    add([u]);add([u,...rest.slice(0,1)]);add([u,...rest.slice(0,2)]);
  }
  add(strong.filter(u=>!effKw(u).tank)); // 방패/탱커는 다음 수비에 남기는 후보
  return groups;
}
function polMfExtraMove(p){
  return polMfAuroraDeck(p)&&everyUnit().some(u=>u.ctrl===p&&!u.ex&&!u.stunned&&(u.turnMoves||0)>0);
}
// 첫 공격 격발의 공개 피해만 빠르게 반영한다. 실제 선택은 아래 엔진 비교로 확인한다.
function polMfAttackEstimate(p,bfIdx,units){
  const original=G;
  try{
    G=cloneG(original);const bf=G.bfs[bfIdx];
    for(const source of units){
      const ops=(unitFx(source).triggers?.onAttack||[]).flatMap(g=>g.ops||[]);
      for(const op of ops.filter(op=>op.op==='damageAll'&&op.spec?.side==='enemy'&&!TF().preventSpellDmg))
        for(const u of bf.units.filter(u=>u.ctrl!==p)) if(canTakeCombatDamage(u)) u.dmg+=dmgPlus(op.n,u,p);
    }
    const killed=bf.units.filter(u=>u.ctrl!==p&&u.dmg>=Math.max(1,might(u,undefined,{forKill:true})));
    const triggerValue=killed.reduce((s,u)=>s+might(u)*BOT_W.unitBf,0);
    bf.units=bf.units.filter(u=>!killed.includes(u));
    const mapped=units.map(u=>everyUnit().find(x=>x.uid===u.uid));
    return triggerValue+evalAttackValue(p,bfIdx,mapped)-polMoveSourceLoss(p,mapped);
  }finally{G=original;}
}
async function polMfMoveChoice(p){
  const fallback=POLICY.movePlan(p);
  if(!polMfAuroraDeck(p)||SIM.active||NET.online) return fallback;
  const plan=POLICY.turnPlan?.p===p&&POLICY.turnPlan.tc===G.turnCount?POLICY.turnPlan:null;
  if(plan?.noAttack) return fallback;
  const ready=everyUnit().filter(u=>u.ctrl===p&&!u.ex&&!u.stunned&&(u.loc==='base'||effKw(u).ganking));
  if(!ready.length) return null;
  const deadline=SIM.deadline;SIM.deadline=deadline||Date.now()+1200;
  try{
    const base=await simTry(p,async()=>{},POLICY,false,false);
    if(base===null) return fallback;
    const candidates=[];
    if(fallback)candidates.push(fallback);
    for(let dest=0;dest<G.bfs.length;dest++){
      if(plan?.focusBf!==undefined&&dest!==plan.focusBf) continue;
      if(G.bfs[dest].controller===p&&!G.bfs[dest].units.some(u=>u.ctrl!==p))continue;
      for(const units of polMfAttackGroups(ready.filter(u=>u.loc!==dest)))
        candidates.push({units,dest});
    }
    let best=null;const seen=new Set();
    for(const a of candidates){
      if(SIM.deadline&&Date.now()>SIM.deadline)break;
      const ids=a.units.map(u=>u.uid),key=a.dest+':'+[...ids].sort((a,b)=>a-b).join(',');
      if(seen.has(key))continue;seen.add(key);
      const value=await simTry(p,async()=>{POLICY.turnPlan=null;
        await moveUnits(p,everyUnit().filter(u=>ids.includes(u.uid)),a.dest);
      },POLICY,false,false);
      if(value!==null&&value>base+BOT_W.moveNeed&&(!best||value>best.value)) best={...a,value};
    }
    return best;
  }finally{SIM.deadline=deadline;}
}
async function polMfCompareExtraAurora(p,ctx,act){
  if(SIM.active||!act||act.n!==160||!polMfAuroraOnline(p))return act;
  if(ctx.movesLeft<=0&&!polMfExtraMove(p)) return act;
  const mv=await polMfMoveChoice(p);if(!mv)return act;
  const ids=mv.units.map(u=>u.uid);
  const play=await simTry(p,()=>POLICY.runAction(p,act),POLICY,false,false);
  const move=await simTry(p,()=>moveUnits(p,everyUnit().filter(u=>ids.includes(u.uid)),mv.dest),POLICY,false,false);
  return move!==null&&(play===null||move>play)?{kind:'move',units:mv.units,dest:mv.dest}:act;
}
POLICY.movePlan = function(p){
  const o = opp(p);
  const baseMovable = G.players[p].base.filter(u=>!u.ex && !u.stunned);
  // 덱에 관계없이 전설로 얻거나 원래 가진 [개입]을 이동 후보로 쓴다.
  const gankMovable = everyUnit().filter(u=>u.ctrl===p && u.loc!=='base'
    && !u.ex && !u.stunned && effKw(u).ganking);
  const movable = baseMovable.concat(gankMovable);
  if(!movable.length) return null;
  if(!polSmart()){
    if(polHash('m', G.turnCount) < 0.4) return null;
    const dest=Math.floor(polHash('md', G.turnCount)*G.bfs.length);
    const units = movable.filter((u,i)=>u.loc!==dest && polHash('mu', G.turnCount, i) < 0.6);
    if(!units.length) return null;
    return { units, dest };
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
        v += evalConquestReward(p,i).value;          // 정복 1점
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
    const mustDefend=evalHoldForecast(o).win;
    if(!mustDefend && plan && plan.noAttack) continue;
    if(!mustDefend && plan && plan.focusBf!==undefined && plan.focusBf!==i) continue;
    const send = [];
    for(const u of byStrong){
      send.push(u);
      const v = evalAttackValue(p, i, [...send]) - polMoveSourceLoss(p,send);
      cands.push({ units:[...send], dest:i, v, why:'공격 '+send.length+'기' });
    }
    for(const u of byStrong.slice(1)) cands.push({units:[u],dest:i,
      v:evalAttackValue(p,i,[u])-polMoveSourceLoss(p,[u]),why:'단독 공격'});
    if(polMfAuroraDeck(p)){
      for(const group of polMfAttackGroups(legal)) cands.push({units:group,dest:i,
        v:polMfAttackEstimate(p,i,group),why:'카드 기능을 반영한 공격'});
    }
    // 총공격 플랜: 출격 가능 전원을 이 전장에 (평가와 무관하게 최우선 후보로)
    if(!mustDefend && plan && plan.allin && plan.focusBf===i && byStrong.length)
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
const POL_AB_RESOURCE = new Set(['addEnergy','addPower','addSpellEnergy','addSpellPower']);

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
  if(typeof abilityHasTargets === 'function' && !abilityHasTargets(p, c.src, ab)) return false;   // 대상 없으면 발동 불가 (404 — 엔진 preTargetAbility와 같은 판단)
  // A legal target can still gain no buff. Preserve the engine's legal choices for humans.
  if(ab.ops?.length===1 && ab.ops[0].op==='buff' &&
    !unitsBySpec(ab.ops[0].spec,p).some(u=>u.ctrl===p&&polCanBuff(u))) return false;
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
const polMfTreasure = (p,c) => polMfAuroraDeck(p) && c.src.kind==='gear' && c.src.g.n===186;
const polMfBundleTreasure = (p,c) => polMfAuroraDeck(p) && c.src.kind==='gear' && c.src.g.n===181
  && G.players[p].gear.some(g=>g.n===186);
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
  for(const c of polAbList(p).sort((a,b)=>Number(polMfBundleTreasure(p,b))-Number(polMfBundleTreasure(p,a)))){
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
      && c.src.kind==='gear' && c.src.g.n===181 && !polMfBundleTreasure(p,c)) continue;
    const cost = c.ab.cost || {};
    const costPips=[...(cost.pips||[])];
    for(let i=0;i<(cost.power||0);i++) costPips.push('Any');
    if(polMfCostBlocked(p,{energy:cost.energy||0,pips:costPips,channel:polMfTreasure(p,c)?1:0})) continue;
    if(POL_AB_HARDCOST.some(k => cost[k])) continue;
    if(polAbOps(c).some(o => POL_AB_BADOPS.has(o)) && !polMfTreasure(p,c)) continue;
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
    && polMfCostBlocked(p,{pips:['Any']})) return null;
  // 통제를 잃으면 숨긴 카드는 그대로 폐기된다(engine 1263행). 적이 있는 전장에는 깔지 않는다.
  if(!G.bfs.some(bf => bf.controller === p && bf.hiddenCards.length < polHideCap(bf)
                    && !bf.units.some(u => u.ctrl !== p))) return null;
  // 비용: 힘 1 (티모 전설은 에너지 1로 대체, [게릴라전] 중엔 무료)
  if(!hideCosts(p).length) return null;
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
      if(polAssaultBonus(h.n)) continue;
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
  const mk = u => ({ uid:u.uid, m: might(u, role(u)), lethal: Math.max(1, might(u, role(u), {forKill:true}) - u.dmg),
                     stun: !!u.stunned, might: might(u), tank:!!effKw(u).tank, last:!!unitFx(u).combatLast, immune:!canTakeCombatDamage(u) });
  return { mine: us.filter(u=>u.ctrl===p).map(mk), theirs: us.filter(u=>u.ctrl!==p).map(mk) };
}
// 결과 클래스 (p 관점): 공격자면 2=정복 성공 / 1=실패, 수비자면 1=정복 저지 / 0=정복당함.
// exch = 처치 교환 손익 (상대가 잃는 위력 − 내가 잃는 위력)
function polSdOutcome(p, sd, snap){
  const sum = a => a.reduce((s,x)=>s+(x.stun?0:x.m),0);
  const myM = sum(snap.mine), opM = sum(snap.theirs);
  const deadOf = (total, arr) => {
    let rest=total; const dead=[];
    for(const x of evalDamageOrder(arr)){ if(rest>=x.lethal){ rest-=x.lethal; dead.push(x); } else break; }
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
        if((kw==='Assault' && sd.attacker===p) || (kw==='Shield' && sd.defender===p)){
          t.m+=v; t.lethal+=v; touched=true;
        } }
    }
  }
  return touched;
}
// 손패 트릭 하나의 기대 이득 — 클래스 개선은 크게, 교환 개선은 위력 단위로
function polSdTrickGain(p, sd, snap0, base, n){
  const fx=FX[n]||{}; const ops=(fx.playOps||[]).filter(g=>!g.legion).flatMap(g=>g.ops||[]);
  if(polEnhanceOps(ops)) return null; // Evaluated with the same engine and targets used by actual casting.
  const snap={ mine:snap0.mine.map(x=>({...x})), theirs:snap0.theirs.map(x=>({...x})) };
  if(!polSdApplyOps(p, sd, snap, ops)) return null;    // 전투 무관 카드 — 결전에 태우지 않는다
  const out=polSdOutcome(p, sd, snap);
  return { gain:(out.cls-base.cls)*10 + (out.exch-base.exch), cls:out.cls };
}

// 결전에서 취할 행동 하나. 손패 트릭 → 자금 조달(자원 능력) → 숨겨둔 트릭 순.
POLICY.showdownAction = async function(p){
  const sd = G.showdown;
  if(!sd) return null;
  const assault=await polAssaultShowdownAction(p);
  if(assault) return assault;
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
    if(polAssaultBonus(n)) return false; // 전용 평가가 거절한 주문을 일반 트릭으로 재선택하지 않는다
    if(polEngineTrick(n)) return false; // 위의 실제 엔진 평가에서 이미 검사했다
    const fx = FX[n] || {kw:{}};
    if(!(fx.kw.action || fx.kw.reaction)) return false;
    if(sd.chain.length && !fx.kw.reaction) return false;     // 체인 진행 중엔 [반응]만
    // 카운터는 체인에 상대 주문이 있을 때만 (없으면 효과 없이 폐기된다)
    if((fx.counter || fx.steal) && !sd.chain.some(it => it.p !== p && it.kind !== 'ability')) return false;
    if(polMfTimelineBlocked(p,n)) return false;
    return true;
  };
  // 가변 광역 피해는 정적 op 근사로 계산할 수 없으므로 별도 전투 시뮬레이션을 쓴다.
  // 오로라 설치 여부와 무관하게 미사용 대비 전투 결과·교환 이익과 실제 비용을 비교한다.
  if(polMfAuroraDeck(p)){
    const bi=P.hand.findIndex(n=>n===POL_MF.bulletTime && usable(n) && polCanPlay(p,card(n)));
    const bp=bi>=0?await polMfBulletChoice(p,true):null;
    if(bp){
      POLICY._mfBulletPlan={p,tc:G.turnCount,sd:G.showdown||null,signature:polMfBulletSignature(p),...bp};
      polSay('showdown',card(POL_MF.bulletTime).ko,'최소 피해로 전장 유지·정복',{damage:bp.damage,bfIdx:bp.bfIdx});
      return {kind:'play',idx:bi,n:POL_MF.bulletTime};
    }
  }
  let want;
  const enhanceWant=[];
  if(!polEnhanceDepth){
    let best=null;
    for(let i=0;i<P.hand.length;i++){
      const n=P.hand[i], fx=FX[n]||{};
      if(!usable(n)) continue;
      const playable=polCanPlay(p,card(n));
      if(!playable && (!POLICY.ab.sdfund || polTier().rep<2)) continue;
      const ops=(fx.playOps||[]).filter(g=>!g.legion||P.playedCards>0).flatMap(g=>g.ops||[]);
      if(!polEnhanceOps(ops)) continue;
      const plan=await polEnhancePlan(p,{ops,op:ops[0],prev:[],ctx:{p,n,kind:'spell'},
        cost:{energy:applyCostMods(p,card(n),card(n).e||0),pips:powerPips(card(n)),spellOK:true}});
      const gain=plan?plan.gain-BOT_W.card-(card(n).e||0)*BOT_W.rune:-Infinity;
      if(gain>BOT_W.moveNeed){
        if(!playable) enhanceWant.push(n);
        else if(!best||gain>best.gain) best={i,n,gain};
      }
    }
    if(best) return {kind:'play',idx:best.i,n:best.n};
  }
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
  want=[...new Set([...want,...enhanceWant])];
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
// 공개된 다음 유지 승리를 막는 수만 긴급 예외로 허용한다.
// 일반 비용 보존보다 최대 한 턴 늦은 오로라(다다음 내 턴)를 보장해야 한다.
async function polMfWithEmergency(p,emergency,run){
  const saved=POLICY._mfEmergency;
  if(emergency) POLICY._mfEmergency=p;
  try{return await run();}finally{POLICY._mfEmergency=saved;}
}
// 같은 공개 보드에서 행동 + 최대 한 번의 후속 이동을 비교한다.
// 상대는 응수를 가정하지 않으며 사본 밖에서는 아무 비용도 지불하지 않는다.
async function polMfProbeAction(p,run,ctx,kind,emergency=false){
  let won=false,safe=false,changed=false,opHolds=0,threat=0;
  const value=await simTry(p,async()=>polMfWithEmergency(p,emergency,async()=>{
    POLICY.turnPlan=null;
    // 내 남은 구성은 알지만 순서는 모른다. 정렬한 구성에서 고정 표본을 만들어
    // 실제 덱 맨 위를 바꿔도 같은 판단을 하게 한다. 상대 비공개 카드는 장수만 보존한다.
    const deck=[...G.players[p].deck].sort((a,b)=>a-b);
    let seed=(G.turnCount+1)*103+p;
    for(let i=deck.length-1;i>0;i--){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const j=seed%(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];
    }
    G.players[p].deck=deck;
    const other=G.players[opp(p)];
    other.hand=other.hand.map(()=>POL_MF.mobilize);
    other.deck=other.deck.map(()=>POL_MF.mobilize);
    const before=simHash(G);
    const runesBefore=G.players[p].runes.map(r=>r.n);
    if(run && await run()===false) return;
    await simSettle();
    changed=simHash(G)!==before;
    if(G.winner===null && G.state==='neutral' && ctx.movesLeft>(kind==='move'?1:0)){
      const mv=POLICY.movePlan(p);
      if(mv){await moveUnits(p,mv.units,mv.dest);await simSettle();}
    }
    won=G.winner===p;
    safe=won || (G.winner===null && !POLICY.race(p).oppLethal);
    opHolds=evalHolds(opp(p));
    threat=G.bfs.reduce((sum,bf,i)=>sum+(bf.controller===p?Math.max(0,polThreatAt(p,i)):0),0);
    const spentRunes=[...new Set(runesBefore)].some(n=>
      G.players[p].runes.filter(r=>r.n===n).length<runesBefore.filter(r=>r===n).length);
    // 아직 오로라까지 멀어도, 룬을 줄이지 않는 이동·무료 방어는 지연 예외가 필요 없다.
    if(!won && emergency && spentRunes && polMfBuildingAurora(p) && !polMfCanPayAndKeepAurora(p,{},2)) safe=false;
  }),POLICY,false,false);
  return value===null?null:{value,won,safe,changed,opHolds,threat};
}
// 모든 고급 봇의 공개 유지 패배 차단. 미스 포츈의 기존 즉시 승리 탐색도 유지한다.
async function polEmergencyAction(p,ctx){
  if(!polHard()||G.turn!==p||G.state!=='neutral'||SIM.active||NET.online) return null;
  const danger=POLICY.race(p).oppLethal;
  const nearWin=polMfAuroraDeck(p)&&G.players[p].points>=G.victory-G.bfs.length;
  if(!danger&&!nearWin) return null;
  const oldDeadline=SIM.deadline,oldPlan=POLICY.turnPlan;
  SIM.deadline=oldDeadline||Date.now()+Math.max(1000,Math.min(POLICY.budget||2000,3000));
  POLICY.turnPlan=null;
  try{
    const candidates=await polMfWithEmergency(p,true,async()=>polActionCandidates(p,ctx));
    // 일반 숨김 정책은 행동/반응 주문을 결전까지 아낀다. 승패가 걸리면 지금 공개하는 수도 비교한다.
    for(let i=0;i<G.bfs.length;i++){
      const bf=G.bfs[i];
      if(bf.units.some(u=>u.ctrl!==p&&unitFx(u).blockReveal)) continue;
      for(const h of bf.hiddenCards){
        if(h.by!==p||h.turn===G.turnCount||ctx.tried.has('v'+i+':'+h.n)) continue;
        if(candidates.some(a=>a.kind==='hidden'&&a.bfIdx===i)) continue;
        candidates.push({kind:'hidden',n:h.n,bfIdx:i,label:'숨김 '+card(h.n).ko,
          run:()=>playHidden(p,i)});
      }
    }
    // 즉시 이동을 먼저 검증하되, 방어보다 즉시 승리를 우선한다.
    candidates.sort((a,b)=>(a.kind==='move'?0:1)-(b.kind==='move'?0:1));
    let best=null;
    for(const act of candidates){
      if(SIM.deadline&&Date.now()>SIM.deadline) break;
      if(act.kind==='hide') continue;
      const result=await polMfProbeAction(p,act.run,ctx,act.kind,true);
      if(!result || !result.changed || (!result.won && !(danger&&result.safe))) continue;
      const rank=(result.won?10000:1000)+result.value;
      if(!best||rank>best.rank) best={act,rank};
    }
    if(!best) return null;
    const act=best.act;
    polSay('survival',act.label,'즉시 승리 / 다음 유지 패배 차단 우선');
    return {...act,run:()=>polMfWithEmergency(p,true,act.run)};
  }finally{SIM.deadline=oldDeadline;POLICY.turnPlan=oldPlan;}
}
async function polMfValueBeforeRamp(p,ctx){
  if(!polMfAuroraDeck(p)||SIM.active||NET.online) return null;
  const P=G.players[p];
  if(!P.hand.some(n=>(n===POL_MF.catalyst||n===POL_MF.mobilize)&&polCanPlay(p,card(n))&&polMfRampPriority(p,n)<100)) return null;
  const old=SIM.deadline;SIM.deadline=old||Date.now()+1500;
  try{
    const baseline=await polMfProbeAction(p,null,ctx,null);
    if(!baseline) return null;
    let best=null;
    for(const act of polActionCandidates(p,ctx)){
      if(SIM.deadline&&Date.now()>SIM.deadline) break;
      if(act.kind==='hide') continue;
      const result=await polMfProbeAction(p,act.run,ctx,act.kind);
      if(result?.changed && result.value>baseline.value+BOT_W.moveNeed &&
        (!best||result.value>best.value)) best={act,value:result.value};
    }
    return best?.act||null;
  }finally{SIM.deadline=old;}
}
POLICY.nextAction = async function(p, ctx){
  const emergency=await polEmergencyAction(p,ctx);
  if(emergency) return emergency;
  let core=null;
  if(polMfAuroraDeck(p)){
    core=await POLICY.playPlan(p,ctx);
    core=await polMfCompareExtraAurora(p,ctx,core);
    if(core?.kind==='move') return core;
    if(core&&POLICY._playScore>=7000) return core;
    const value=await polMfValueBeforeRamp(p,ctx);
    if(value) return value;
  }
  let a = POLICY.hiddenPlan(p, ctx, false);
  if(a) return a;
  a = core || await POLICY.playPlan(p, ctx);
  if(a) return a;
  a = await POLICY.abilityPlan(p, ctx, false);
  if(a) return a;
  if(ctx.movesLeft > 0 || polMfExtraMove(p)){
    const mv = await polMfMoveChoice(p);
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
  if(act.emergency && (act.kind==='play'||act.kind==='champ')){
    const saved=POLICY._mfEmergency;
    POLICY._mfEmergency=p;
    try{return await playCardFromHand(p,act.kind==='champ'?-1:act.idx,act.kind==='champ'?{champZone:true}:{});}
    finally{POLICY._mfEmergency=saved;}
  }
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
    if(polAssaultBonus(n)) return;
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
    if(polMfAuroraDeck(p) && polMfAuroraOnline(p) && c.src.kind==='gear'
      && c.src.g.n===181 && !polMfBundleTreasure(p,c)) continue;
    const cost = c.ab.cost || {};
    const costPips=[...(cost.pips||[])];
    for(let i=0;i<(cost.power||0);i++) costPips.push('Any');
    if(polMfCostBlocked(p,{energy:cost.energy||0,pips:costPips,channel:polMfTreasure(p,c)?1:0})) continue;
    if(POL_AB_HARDCOST.some(k => cost[k])) continue;
    if(polAbOps(c).some(o => POL_AB_BADOPS.has(o)) && !polMfTreasure(p,c)) continue;
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
  if(!ctx || ctx.movesLeft > 0 || polMfExtraMove(p)){
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
