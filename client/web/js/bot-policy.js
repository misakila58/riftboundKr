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
  // skilled trick:1 — 예전엔 탐색 티어(move)만 결전 트릭을 냈다. 사람은 중수 봇 상대로도 판당 1.0장을 체인에 올리는데 봇은 0.08장(리플레이 2026-09-22).
  // 정밀 결전 판단(sdx)은 정적 계산이라 비용이 없고, 셀프플레이 300판 52%(중립)로 회귀 없음 → 룰·사람 플레이에 맞춰 켠다.
  skilled: { smart:1, move:0, think:0, reserve:0, peek:0, moves:1, rep:1, trick:1 },  skilledT:{ smart:1, move:0, think:0, reserve:0, peek:0, moves:1, rep:1, trick:1 },   // skilledT 실험용: 중수 + 결전 트릭
  expert:  { smart:1, move:1, think:1, reserve:0, peek:0, moves:1, rep:1 },
  // master: 예전엔 self:1(플랜 평가 때 상대 턴을 두지 않는 국면형 판단)이었다 — 상대 손패 결정화+상대 턴 롤아웃 쪽이 셀프플레이 80판 58:22(p<0.0001)로
  // 압도했고, 사람전 리플레이에서도 초고수의 유닛 교환비(0.76)가 고수(0.97)보다 나빴다 (2026-09-22). 이제 고수와 같은 방식에 예산·표본만 크다.
  master:  { smart:1, move:1, think:1, reserve:0, peek:0, moves:3, rep:2 },
  masterD: { smart:1, move:1, think:1, reserve:0, peek:0, moves:3, rep:2 },           // 실험용: master와 같되 상대 손패 결정화+상대 턴 롤아웃
  oracle:  { smart:1, move:1, think:1, reserve:0, peek:1, moves:3, rep:2 },
  // 구 식별자 호환
  easy:    { smart:0, move:0, think:0, reserve:0, peek:0, moves:1, rep:0 },
  normal:  { smart:1, move:0, think:0, reserve:0, peek:0, moves:1, rep:1 },
  hard:    { smart:1, move:1, think:0, reserve:0, peek:0, moves:2, rep:2 },
};
function polTier(){ return POL_TIERS[POLICY.level] || POL_TIERS.skilled; }

// 일반 초고수의 카이사 전설 덱. 개별 연계는 실제 카드·자원·공개 상태로 확인한다.
function polKaisaDeck(p){
  return POLICY.level==='master' && !POLICY.peek && !!G?.players?.[p] && G.players[p].legendN===247;
}

// No nested search on a spent deadline. Keep an already evaluated action when
// possible; otherwise use a legal body or static move without optional costs.
function polKaisaFastFallback(p,ctx){
  const P=G.players[p], choices=[];
  for(const n of new Set(P.hand)){
    if(ctx.tried?.has('h'+n)||card(n).type!=='Unit'||!polCanPlay(p,card(n))) continue;
    choices.push({kind:'play',idx:P.hand.indexOf(n),n,kaisaAccel:false});
  }
  if(P.champInZone&&!ctx.tried?.has('champ')&&polCanPlay(p,card(P.champN)))
    choices.push({kind:'champ',n:P.champN,kaisaAccel:false});
  choices.sort((a,b)=>((card(b.n).m||0)*2-polCost(card(b.n)))-((card(a.n).m||0)*2-polCost(card(a.n)))||a.n-b.n);
  if(choices.length)return choices[0];
  if(ctx.movesLeft>0){const move=POLICY.movePlan(p);if(move)return {kind:'move',units:move.units,dest:move.dest};}
  return {kind:'end'};
}

// One decision owns one deadline. Restore it before runAction: a planning
// timeout must never interrupt real payment or a real target-selection prompt.
async function polKaisaNextAction(p,ctx){
  if(!polKaisaDeck(p)||NET.online||SIM.active||SIM.lock||G.turn!==p||
    G.state!=='neutral'||G.phase!=='action'||G.winner!==null) return null;
  const previousDeadline=SIM.deadline;
  SIM.deadline=Math.min(previousDeadline||Infinity,Date.now()+Math.min(POLICY.budget||5000,5000));
  const timeLeft=()=>Date.now()<SIM.deadline;
  let fallback=null;
  try{
    if(typeof polKaisaWarpChoice==='function'){
      const warp=await polKaisaWarpChoice(p,ctx);
      if(warp) return warp;
    }
    let emergency=null;
    if(timeLeft()&&POLICY.race(p).oppLethal){
      const outer=SIM.deadline;
      SIM.deadline=Math.min(outer,Date.now()+1500);
      try{emergency=await polEmergencyAction(p,ctx);}finally{SIM.deadline=outer;}
      fallback=emergency;
    }
    let core=timeLeft()?await polKaisaSequencePlan(p,ctx):null;
    if(!core&&timeLeft()) core=await POLICY.playPlan(p,ctx);
    // Keep the first move of the ordinary split-army plan as an executable
    // baseline. A one-move temporary-buff probe would otherwise pile both
    // Students onto the first empty field instead of conquering two fields.
    if(!core&&timeLeft()&&ctx.movesLeft>0){
      const move=POLICY.movePlan(p);
      if(move) core={kind:'move',units:move.units,dest:move.dest};
    }
    fallback=emergency||core;
    if(core?.kaisaWin) return core;
    if(timeLeft()&&typeof polKaisaTurnChoice==='function')
      core=await polKaisaTurnChoice(p,ctx,core);
    fallback=emergency||core;
    if(core?.kaisaWin) return core;
    if(emergency) return emergency;
    if(timeLeft()&&typeof polKaisaSpellCycle==='function'){
      const cycle=await polKaisaSpellCycle(p,ctx);
      if(cycle){
        if(!core||core.kind==='end') return cycle;
        if(timeLeft()&&typeof polKaisaTurnProbe==='function'){
          const before=await polKaisaTurnProbe(p,ctx,core,{counterplay:true});
          const after=timeLeft()?await polKaisaTurnProbe(p,ctx,cycle,{counterplay:true}):null;
          if(before&&after&&!after.lost&&after.value+0.12>before.value+BOT_W.moveNeed) return cycle;
        }
      }
    }
    return core||(!timeLeft()?polKaisaFastFallback(p,ctx):null);
  }catch(e){
    if(!(e instanceof SimBudget)){
      SIM.stats.errors++;
      polSay('kaisa-fallback','기본 정책','전용 후보 평가 실패',{message:String(e?.message||e)});
    }
    return fallback||polKaisaFastFallback(p,ctx);
  }finally{SIM.deadline=previousDeadline;}
}

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
// 공격 주문의 적법 대상과 유익한 대상을 구분한다. 아군 희생을 명시한 비용/효과는 제외한다.
function polOffensiveOp(op){
  return !!op && !op.self && op.spec?.side!=='friendly' &&
    (['damage','damageAll','kill','stun','dealSplit','dmgEqMyMight'].includes(op.op)
      || op.op==='might' && op.n<0);
}
function polOffensivePlayable(p,n,bfIdx,fromHidden=false){
  if(card(n).type!=='Spell') return true;
  const fx=FX[n]||{}, saved=[_ctxBf,_hiddenBf,_ctxUnit,_curKind];
  _ctxBf=bfIdx??null; _hiddenBf=fromHidden&&!fx.hiddenFreeTarget?bfIdx:null;
  _ctxUnit=null; _curKind='spell';
  try{
    const c=card(n), cost=fromHidden?{energy:0,pips:[],spellOK:true}:
      {energy:applyCostMods(p,c,c.e||0),pips:powerPips(c),spellOK:true};
    const prev=[];
    for(const group of fx.playOps||[]){
      if(group.legion && G.players[p].playedCards<1) continue;
      for(const op of group.ops||[]){
        const offensive=polOffensiveOp(op);
        const specs=preTargetSpecs(op);
        // 대상을 지정하지 않는 광역 공격도 실제 범위 안에 적이 있어야 한다.
        if(offensive && !specs.length && op.spec){
          if(!unitsBySpec(op.spec,p).some(u=>u.ctrl!==p)) return false;
        }
        for(const entry of specs){
          const spec=typeof entry==='function'?entry(p,prev):entry;
          if(spec.battlefield) continue;
          const eligible=unitsBySpec(spec,p).filter(u=>canPayDeflect(p,u,cost));
          const useful=offensive?eligible.filter(u=>u.ctrl!==p||polKaisaSpellFriendly(p,n,u)):eligible;
          if(offensive && !useful.length && !spec.optional) return false;
          // 첫 선택부터 적이 전혀 없는 선택적 공격도 카드만 낭비하지 않는다.
          if(offensive && !useful.length && spec.optional && !prev.some(u=>u&&u.ctrl!==p)) return false;
          prev.push(useful[0]||null);
        }
      }
    }
    return true;
  }finally{ [_ctxBf,_hiddenBf,_ctxUnit,_curKind]=saved; }
}

// 굴절은 실제로 고르는 대상마다 비용에 더해진다. 같은 유닛을 두 번 고르면 두 번,
// 서로 다른 대상이면 각자의 굴절을 합산한다. 추가 핍은 모두 Any이므로 가능한 대상
// 조합의 최소 합계만 알아도 충당 가능성을 판정할 수 있다(비싼 조합이 더 쉬울 수 없다).
function polSpellTargetPips(p,c){
  const fx=FX[c.n];
  if(!fx || fx.reflexive || fx.counter || fx.steal ||
    !everyUnit().some(u=>u.ctrl!==p && deflectPips(p,u).length)) return [];
  const saved=[_ctxBf,_hiddenBf,_ctxUnit,_curKind];
  _ctxBf=null;_hiddenBf=null;_ctxUnit=null;_curKind='spell';
  try{
    const steps=[];
    for(const group of fx.playOps||[]){
      if(group.legion && G.players[p].playedCards<1) continue;
      for(const op of group.ops||[]){
        const offensive=polOffensiveOp(op), specs=preTargetSpecs(op);
        // 분할 피해는 적어도 한 적에게 피해를 줄 수 있어야 공격 수단으로 센다.
        if(op.op==='dealSplit' && offensive) steps.push({entry:{...op.spec,optional:false},offensive});
        else for(const entry of specs) steps.push({entry,offensive});
      }
    }
    let best=Infinity;
    const visit=(i,prev,total)=>{
      if(total>=best) return;
      if(i===steps.length){best=total;return;}
      const {entry,offensive}=steps[i], spec=typeof entry==='function'?entry(p,prev):entry;
      if(spec.battlefield){if(G.bfs.length) visit(i+1,[...prev,null],total);return;}
      let choices;
      if(spec.custom){
        choices=preTargetCustomOptions(p,spec).map(o=>({
          u:o.v?.t==='u'?everyUnit().find(u=>u.uid===o.v.uid):null, custom:true
        }));
      } else choices=unitsBySpec(spec,p).map(u=>({u,custom:false}));
      if(offensive) choices=choices.filter(x=>x.u && (x.u.ctrl!==p||polKaisaSpellFriendly(p,c.n,x.u)));
      if(spec.optional && (!offensive || prev.some(u=>u && u.ctrl!==p)))
        choices.push({u:null,custom:false});
      choices.sort((a,b)=>deflectPips(p,a.u).length-deflectPips(p,b.u).length);
      for(const x of choices){
        visit(i+1,[...prev,x.u],total+deflectPips(p,x.u).length);
        if(best===0) break;
      }
    };
    visit(0,[],0);
    return Number.isFinite(best)?Array(best).fill('Any'):null;
  }finally{[_ctxBf,_hiddenBf,_ctxUnit,_curKind]=saved;}
}

function polCanPlay(p, c, allowFunding=true){
  try {
    const e = (typeof applyCostMods==='function') ? applyCostMods(p, c, c.e||0) : (c.e||0);
    const pips=powerPips(c), spellOK=c.type==='Spell';
    const targetPips=spellOK?polSpellTargetPips(p,c):[];
    if(targetPips===null) return false;
    const paymentPips=[...pips,...targetPips];
    const payable=()=>{
      if(!canPay(p,e,paymentPips,spellOK) || !polOffensivePlayable(p,c.n)) return false;
      if(polMfAuroraDeck(p) && c.n===180 && !polMfMemoryTargets(p,
        {energy:e,pips,spellOK}).length) return false;
      // 대상/굴절 검사도 충당된 풀을 사용한다. 능력 발동 비용 자체에는 주문 전용 자원을 쓰지 않는다.
      if(spellOK && typeof spellHasTargets==='function' && !(FX[c.n]&&(FX[c.n].counter||FX[c.n].steal)))
        return spellHasTargets(c.n,p);
      return true;
    };
    if(payable()) return true;
    return allowFunding && !!polResourceFundingPlan(p,e,paymentPips,spellOK,payable);
  } catch(err){ return false; }
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
// Linked targets are one decision: a fight's opponent depends on its friendly
// participant, and a unit-dealt damage target depends on the unit readied first.
// Keep the announced prefix fixed while comparing the remaining legal pairs.
let polLinkedTargetDepth=0;
function polLinkedTargetOps(selection){
  const ops=selection?.ops||[];
  return ops.some(o=>['challenge','facebreaker','itDealsTo'].includes(o.op))?ops:null;
}
function polTargetPlanPayable(p,cost,pips){
  if(cost?.noDeflect) return true;
  const pay=cost?.deferDeflect?canPayWithFunding:canPay;
  return pay(p,cost?.energy||0,[...(cost?.pips||[]),...pips],!!cost?.spellOK);
}
function polLinkedTargetScore(p,ops,pre,ctx){
  const find=id=>everyUnit().find(u=>u.uid===id), damage=new Map();
  let it=ctx.it||null, score=0;
  const hit=(u,n)=>{
    if(!u || n<=0 || unitFx(u).noDmgIfMoved2 && (u.turnMoves||0)>=2) return;
    damage.set(u,(damage.get(u)||0)+n);
  };
  for(const op of ops){
    const raw=pre.get(op), ids=Array.isArray(raw)?raw:[raw], us=ids.map(find);
    if(op.op==='ready'){
      it=us[0]||null;
      if(it?.ex) score+=(it.ctrl===p?1:-1)*targetMight(it)*0.002;
    }else if(op.op==='itDealsTo') hit(us[0],it?targetMight(it):0);
    else if(op.op==='challenge'){
      if(us[0]&&us[1]){hit(us[1],targetMight(us[0]));hit(us[0],targetMight(us[1]));}
    }else if(op.op==='facebreaker'){
      for(const u of us) if(u&&!u.stunned) score+=(u.ctrl===p?-1:1)*targetMight(u);
    }
  }
  for(const [u,n] of damage){
    const left=Math.max(0,targetMight(u)-u.dmg), sign=u.ctrl===p?-1:1;
    if(n>=left || u._guillotine || TF().dmgKill) score+=sign*(10*targetMight(u)+1);
    score+=sign*Math.min(n,left)*0.01;
  }
  return score;
}
async function polLinkedTargetPlan(p,candidates,selection){
  const ops=polLinkedTargetOps(selection);
  if(!ops) return null;
  const ctx=selection.ctx||{p}, prefix=selection.prev||[], original=G;
  const entries=ops.flatMap(op=>preTargetSpecs(op).map(entry=>({op,entry})));
  const plans=[];
  function collect(i,ids,prev,pre,pips){
    if(plans.length>=256) return;
    if(i===entries.length){plans.push({ids,pre,score:polLinkedTargetScore(p,ops,pre,ctx)});return;}
    const {op,entry}=entries[i], spec=typeof entry==='function'?entry(p,prev):entry;
    if(spec.custom || spec.battlefield) return;
    let choices=unitsBySpec(spec,p);
    if(i<prefix.length) choices=choices.filter(u=>u.uid===prefix[i]);
    if(i===prefix.length) choices=choices.filter(u=>candidates.some(c=>c.uid===u.uid));
    for(const u of choices){
      const nextPips=i<prefix.length||selection.cost?.noDeflect?pips:[...pips,...deflectPips(p,u)];
      if(!polTargetPlanPayable(p,selection.cost,nextPips)) continue;
      const next=new Map(pre), old=next.get(op);
      next.set(op,old===undefined?u.uid:Array.isArray(old)?[...old,u.uid]:[old,u.uid]);
      collect(i+1,[...ids,u.uid],[...prev,u],next,nextPips);
    }
  }
  collect(0,[],[],new Map(),[]);
  if(!plans.length) return null;
  plans.sort((a,b)=>b.score-a.score);
  let best=plans[0];
  const canProbe=!polLinkedTargetDepth && typeof simTry==='function' && !NET.online &&
    (SIM.movementDepth||0)<2 && !_dyingBatch && !_deferDeathFx;
  if(canProbe){
    const savedDeadline=SIM.deadline;
    const deadline=Math.min(savedDeadline||Infinity,Date.now()+Math.min(POLICY.budget||400,1000));
    SIM.deadline=deadline;
    polLinkedTargetDepth++;
    try{
      let bestValue=-Infinity;
      for(const plan of plans){
        if(bestValue>-Infinity && Date.now()>deadline) break;
        const value=await simTry(p,async()=>{
          const find=u=>u?everyUnit().find(x=>x.uid===u.uid):null;
          await execOps(ops,{...ctx,p,unit:find(ctx.unit),it:find(ctx.it),pre:plan.pre});
          await cleanup(p);
        },POLICY,true,false);
        if(value!==null && value>bestValue+1e-7){best=plan;bestValue=value;}
      }
    }finally{
      SIM.deadline=savedDeadline;
      polLinkedTargetDepth--;
      if(G!==original) throw new Error('Linked target probe did not restore game state');
    }
  }
  return candidates.find(u=>u.uid===best.ids[prefix.length])||null;
}

// A capped group removal spends a shared Might budget. Compare legal subsets,
// not the largest next unit; previously announced group members stay fixed.
let polGroupKillDepth=0;
async function polGroupKillTarget(p,candidates,selection){
  if(selection?.op?.op!=='foxfire' || !selection.group) return undefined;
  const group=selection.group, fixed=(group.picked||[]).map(id=>everyUnit().find(u=>u.uid===id)).filter(Boolean);
  const required=!!group.required, resolving=Array.isArray(group.initialTargets);
  let eligible=candidates.filter(u=>!fixed.some(x=>x.uid===u.uid) && (required||u.ctrl!==p));
  if(resolving) eligible=eligible.filter(u=>group.initialTargets.includes(u.uid));
  eligible.sort((a,b)=>(b.ctrl!==p)-(a.ctrl!==p) || targetMight(b)-targetMight(a));
  const plans=[];
  const score=us=>us.reduce((sum,u)=>sum+(u.ctrl===p?-1:1)*(targetMight(u)+0.1),0);
  function collect(index,extra,left,bf,pips){
    if(plans.length>=256) return;
    const compatible=u=>(bf===null||bf===undefined||u.loc===bf) && targetMight(u)<=left &&
      !extra.includes(u) && (resolving||polTargetPlanPayable(p,selection.cost,[...pips,...deflectPips(p,u)]));
    if(!required || !eligible.some(compatible)) plans.push({extra,score:score([...fixed,...extra])});
    for(let i=index;i<eligible.length;i++){
      const u=eligible[i]; if(!compatible(u)) continue;
      collect(i+1,[...extra,u],left-targetMight(u),u.loc,resolving?pips:[...pips,...deflectPips(p,u)]);
    }
  }
  collect(0,[],group.remaining,group.battlefield,[]);
  if(!plans.length) return required?(eligible[0]||null):null;
  plans.sort((a,b)=>b.score-a.score);
  let best=plans[0], bestValue=-Infinity;
  if(!polGroupKillDepth && typeof simTry==='function' && !NET.online &&
     (SIM.movementDepth||0)<2 && !_dyingBatch && !_deferDeathFx){
    const original=G, savedDeadline=SIM.deadline;
    const deadline=Math.min(savedDeadline||Infinity,Date.now()+Math.min(POLICY.budget||400,1000));
    SIM.deadline=deadline;
    polGroupKillDepth++;
    try{
      for(const plan of plans){
        if(bestValue>-Infinity && Date.now()>deadline) break;
        const ids=[...fixed,...plan.extra].map(u=>u.uid);
        const value=await simTry(p,async()=>{
          const us=ids.map(id=>everyUnit().find(u=>u.uid===id)).filter(Boolean);
          if(selection.ctx?.kind==='spell') G._casting=p;
          await killUnitsTogether(us);
          await cleanup(p);
        },POLICY,true,false);
        if(value!==null && value>bestValue+1e-7){best=plan;bestValue=value;}
      }
    }finally{
      SIM.deadline=savedDeadline;
      polGroupKillDepth--;
      if(G!==original) throw new Error('Group target probe did not restore game state');
    }
  }
  const u=best.extra[0];
  return u|| (required?(eligible[0]||null):null);
}
async function polSelectionChoice(p,candidates,selection){
  const group=await polGroupKillTarget(p,candidates,selection);
  if(group!==undefined) return group;
  if(!polLinkedTargetOps(selection)) return undefined;
  return polLinkedTargetPlan(p,candidates,selection);
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
// Resolve the whole remaining damage allocation before choosing its next target.
// Reservations live in this cast's pre Map, never on units or in a global bot plan.
function polDamageAmount(p,u,n,selection,split=false){
  const kind=selection?.ctx?.kind||_curKind||'effect';
  const raw=split?n:dmgPlus(n,u,p);
  return projectedDamage(u,raw,kind,kind==='spell'?p:null);
}
function polDamageValue(p,u,amount){
  if(amount<=0) return 0;
  const hp=Math.max(1,targetMight(u)), need=Math.max(0,hp-(u.dmg||0));
  if(!need || u._decree) return 0;
  const lethal=TF().dmgKill || u._guillotine || amount>=need;
  const value=hp+1+(unitCard(u).e||0)*0.08;
  let reward=value*(lethal?1:0.2*Math.min(amount,need)/need);
  if(lethal && u.loc!=='base'){
    const bf=G.bfs[u.loc];
    if(bf.controller===u.ctrl){
      reward+=2/Math.max(1,bf.units.filter(x=>x.ctrl===u.ctrl).length);
      const reduced=G.bfs.map(b=>({...b,units:b.units.filter(x=>x!==u)}));
      reward+=Math.max(0,evalHoldThreatValue(p,reduced)-evalHoldThreatValue(p));
    }
  }
  return reward;
}
function polDamageTaxBudget(p,cost,max){
  if(cost?.noDeflect) return max;
  const can=n=>{
    const pips=[...(cost?.pips||[]),...Array(n).fill('Any')];
    return cost?.deferDeflect?canPayWithFunding(p,cost.energy||0,pips,!!cost.spellOK)
      :canPay(p,cost?.energy||0,pips,!!cost?.spellOK);
  };
  if(can(max)) return max;
  let lo=0,hi=max;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(can(mid))lo=mid;else hi=mid-1;}
  return lo;
}
function polDamagePlan(p,candidates,selection){
  const current=selection?.op;
  if(!current || !['damage','damageAll'].includes(current.op) || !Number.isFinite(current.n)) return null;
  // A count='all' effect has no choice; the ordinary damageAll branch handles it.
  if(current.op==='damageAll' && typeof current.spec?.count!=='number') return null;
  const pre=selection.pre, ops=selection.ops||[current], units=everyUnit().filter(u=>u.ctrl!==p);
  const prior=new Map(), slots=[];
  let reached=false;
  for(const op of ops){
    if(op===current) reached=true;
    if(!['damage','damageAll'].includes(op.op) || !Number.isFinite(op.n)) continue;
    const count=op.op==='damage'?1:typeof op.spec?.count==='number'?op.spec.count:0;
    if(!count || op.spec?.side==='friendly') continue;
    const recorded=pre?.has(op)?pre.get(op):undefined;
    const committed=recorded===undefined?[]:Array.isArray(recorded)?recorded:[recorded];
    for(const uid of committed){
      const u=units.find(x=>x.uid===uid);
      if(u) prior.set(uid,(prior.get(uid)||0)+polDamageAmount(p,u,op.n,selection));
    }
    if(!reached) continue;
    for(let index=committed.length;index<count;index++){
      const spec={...op.spec,count:1};
      const eligible=unitsBySpec(spec,p).filter(u=>u.ctrl!==p &&
        (op.op!=='damageAll' || !committed.includes(u.uid)));
      slots.push({op,index,optional:op.op==='damageAll'||!!spec.optional,
        eligible:slots.length===0?eligible.filter(u=>candidates.includes(u)):eligible});
    }
  }
  if(!slots.length || !slots[0].eligible.length) return null;
  // Origins has at most six independent hits (Icathian Rain). Bound future sets
  // without an exponential search; retain a useful single-hit fallback if extended.
  if(slots.length>8) slots.splice(1);
  const size=1<<slots.length, required=slots.reduce((m,s,i)=>s.optional?m:m|(1<<i),0);
  const tax=u=>selection.cost?.noDeflect?0:deflectPips(p,u).length;
  const taxLimit=polDamageTaxBudget(p,selection.cost,slots.length*Math.max(0,...units.map(tax)));
  let states=new Map([['0:0',{mask:0,tax:0,value:0,ids:Array(slots.length).fill(null)}]]);
  for(const u of units){
    let available=0;
    slots.forEach((s,i)=>{if(s.eligible.includes(u))available|=1<<i;});
    if(!available) continue;
    const options=[];
    for(let subset=available;subset;subset=(subset-1)&available){
      // "Each of up to N units" cannot select one unit twice in the same op.
      const seen=new Set();let valid=true,amount=prior.get(u.uid)||0,picks=0;
      for(let i=0;i<slots.length;i++) if(subset&(1<<i)){
        const op=slots[i].op;
        if(op.op==='damageAll' && seen.has(op)){valid=false;break;}
        seen.add(op); picks++;amount+=polDamageAmount(p,u,op.n,selection);
      }
      const cost=picks*tax(u);
      if(valid && cost<=taxLimit) options.push({mask:subset,tax:cost,
        value:polDamageValue(p,u,amount)-polDamageValue(p,u,prior.get(u.uid)||0)});
    }
    options.reverse(); // Equal plans keep earlier target slots on earlier board candidates.
    const next=new Map(states);
    for(const state of states.values()) for(const option of options){
      if(state.mask&option.mask || state.tax+option.tax>taxLimit) continue;
      const mask=state.mask|option.mask,fee=state.tax+option.tax;
      const value=state.value+option.value,key=mask+':'+fee,old=next.get(key);
      if(!old || value>old.value+1e-7){
        const ids=[...state.ids];for(let i=0;i<slots.length;i++)if(option.mask&(1<<i))ids[i]=u.uid;
        next.set(key,{mask,tax:fee,value,ids});
      }
    }
    states=next;
  }
  let best=null;
  for(const state of states.values()){
    if((state.mask&required)!==required) continue;
    if(!best || state.value>best.value+1e-7 || Math.abs(state.value-best.value)<1e-7 && state.tax<best.tax) best=state;
  }
  return best;
}
function polSplitDamagePlan(p,candidates,selection){
  if(selection?.op?.op!=='dealSplit' || !selection.split) return null;
  const remain=selection.split.remaining|0;
  if(remain<=0) return null;
  const used=selection.split.used||[],forced=selection.split.target;
  const resolving=selection.split.phase==='resolve',retaining=selection.split.phase==='retain',eligible=selection.split.eligible;
  const required=new Set(selection.split.required || (resolving?eligible||[]:[]));
  const units=unitsBySpec(selection.op.spec,p).filter(u=>u.ctrl!==p && !used.includes(u.uid) &&
    (!eligible || eligible.includes(u.uid)));
  const tax=u=>selection.cost?.noDeflect?0:deflectPips(p,u).length;
  const maxTax=units.reduce((n,u)=>n+tax(u),0),limit=polDamageTaxBudget(p,selection.cost,maxTax);
  // A number prompt comes after its target's Deflect was paid/reserved.
  const costOf=u=>forced===u.uid || selection.split.phase==='declare'&&required.has(u.uid)?0:tax(u);
  let states=new Map([['0:0',{spent:0,tax:0,value:0,parts:[]}]]);
  for(const u of units){
    const options=[];
    for(let n=1;n<=remain;n++){
      const amount=polDamageAmount(p,u,n,selection,true),value=polDamageValue(p,u,amount);
      if(value>0 || resolving || retaining || required.has(u.uid) || forced===u.uid) options.push({n,value});
    }
    const next=forced===u.uid || required.has(u.uid)?new Map():new Map(states);
    for(const state of states.values())for(const option of options){
      const spent=state.spent+option.n,fee=state.tax+costOf(u);
      if(spent>remain || fee>limit)continue;
      const value=state.value+option.value,key=spent+':'+fee+':'+(state.parts.length+1),old=next.get(key);
      if(!old||value>old.value+1e-7)next.set(key,{spent,tax:fee,value,parts:[...state.parts,{uid:u.uid,n:option.n}]});
    }
    states=next;
  }
  let best=null;
  for(const state of states.values()){
    if(!state.parts.length || forced && !state.parts.some(x=>x.uid===forced) ||
      (resolving||retaining) && state.spent!==remain ||
      selection.split.count!==undefined && state.parts.length!==selection.split.count)continue;
    if(selection.split.phase!=='declare' && !forced && candidates && !state.parts.some(x=>candidates.some(u=>u.uid===x.uid)))continue;
    if(!best||state.value>best.value+1e-7||Math.abs(state.value-best.value)<1e-7 &&
      (state.tax<best.tax || state.tax===best.tax&&state.spent<best.spent))best=state;
  }
  return best;
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
let polReadyTargetDepth=0;
async function polReadyTarget(p,candidates,optional,selection){
  // A linked instruction such as "ready it, then it deals damage" can need an
  // already-ready target for the later effect. This branch handles pure ready.
  if(selection?.op?.op!=='ready' || selection.ops?.length!==1) return undefined;
  const mine=candidates.filter(u=>u.ctrl===p);
  const exhausted=mine.filter(u=>u.ex);
  if(!exhausted.length){
    const harmless=mine.length?mine:candidates.filter(u=>!u.ex);
    if(harmless.length) return polStrongest(harmless);
    return optional?null:polWeakest(candidates);
  }
  const immediate=u=>!!(G.turn===p && G.phase==='action' && !u.stunned &&
    (u.loc==='base'||effKw(u).ganking));
  const ranked=[...exhausted].sort((a,b)=>Number(immediate(b))-Number(immediate(a)) || might(b)-might(a));
  if(ranked.length===1 || polReadyTargetDepth || NET.online || !polHard() ||
      (SIM.movementDepth||0)>=2 || _dyingBatch || _deferDeathFx) return ranked[0];
  const savedDeadline=SIM.deadline;
  SIM.deadline=Math.min(savedDeadline||Infinity,Date.now()+Math.min(POLICY.budget||400,600));
  polReadyTargetDepth++;
  try{
    let best=null;
    for(const candidate of ranked){
      if(Date.now()>SIM.deadline) break;
      const value=await simTry(p,async()=>{
        const u=everyUnit().find(x=>x.uid===candidate.uid);
        if(!u) return;
        await readyUnit(u,p);
        await simSettle(null,POLICY);
        if(G.winner===null && G.turn===p && G.phase==='action' && G.state==='neutral'){
          POLICY.turnPlan=null;
          const move=POLICY.movePlan(p);
          if(move){await moveUnits(p,move.units,move.dest);await simSettle(null,POLICY);}
        }
      },POLICY,true,false);
      if(value!==null && (!best || value>best.value+BOT_W.moveNeed)) best={candidate,value};
    }
    return best?.candidate||ranked[0];
  }finally{polReadyTargetDepth--;SIM.deadline=savedDeadline;}
}
POLICY.unit = async function(p, candidates, promptText, optional, selection){
  if(!candidates || !candidates.length) return null;
  const kaisaTarget=POLICY._kaisaSpellTarget;
  if(kaisaTarget?.pending && (G._rwFor!==p || G._returnPending?.pre!==kaisaTarget.pending.pre ||
    G._returnPending?.n!==kaisaTarget.pending.n)) POLICY._kaisaSpellTarget=null;
  if(POLICY._kaisaSpellTarget && kaisaTarget.p===p && kaisaTarget.tc===G.turnCount &&
    selection?.ctx?.n===kaisaTarget.n){
    const chosen=candidates.find(u=>u.uid===kaisaTarget.uid);
    POLICY._kaisaSpellTarget=null;
    if(chosen) return chosen;
    return null; // A reserved target that left is never silently replaced.
  }
  // UI가 비용 확인과 대상 선택을 합쳐도 봇은 기존 수락 여부와 대상 평가를 유지한다.
  if(selection?.costConfirmation){
    const c=selection.costConfirmation;
    if(!POLICY.confirm(p,c.text,c.preview)) return null;
    return candidates.length===1?candidates[0]:POLICY.unit(p,candidates,c.pickTitle,false);
  }
  if(polOffensiveOp(selection?.op)){
    candidates=candidates.filter(u=>u.ctrl!==p||polKaisaSpellFriendly(p,selection?.ctx?.n,u));
    if(!candidates.length) return null;
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
  const selected=await polSelectionChoice(p,candidates,selection);
  if(selected!==undefined) return selected;
  const ready=await polReadyTarget(p,candidates,optional,selection);
  if(ready!==undefined) return ready;
  if(selection?.op?.op==='dealSplit' && selection.split){
    const plan=polSplitDamagePlan(p,candidates,selection);
    const part=plan?.parts.find(x=>candidates.some(u=>u.uid===x.uid));
    return part?candidates.find(u=>u.uid===part.uid):null;
  }
  const damagePlan=polDamagePlan(p,candidates,selection);
  if(damagePlan){
    const u=candidates.find(x=>x.uid===damagePlan.ids[0])||null;
    polSay('unit',u&&unitName(u),'남은 피해 전체 배분 — 확정 피해·치사량·굴절 반영');
    return u;
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

  // ⓪ '유닛 준비'(일등 항해사 132 등 — 플레이 시점 대상 프롬프트 「…」 대상 선택 — 유닛 준비): 탈진한 아군에게. 준비된 아군은 무의미하고
  //   적을 준비시키면 자해다 (예전엔 문구가 POL_BENEFIT에 안 잡혀 '해로운 효과 → 적 최강'으로 상대 유닛을 준비시켜 줬다)
  if(selection?.op?.op==='ready' || /유닛 준비|준비시킬/.test(txt)){
    const tired=mine.filter(u=>u.ex);
    if(tired.length){ const u=polStrongest(tired); polSay('unit', u&&unitName(u), '유닛 준비 → 탈진한 아군 최강', {txt}); return u; }
    if(optional){ polSay('unit', null, '준비시킬 탈진 아군 없음 — 선택 안 함', {txt}); return null; }
    if(mine.length){ const u=polStrongest(mine); polSay('unit', u&&unitName(u), '유닛 준비 → 아군(효과 없음, 적에게 주지 않음)', {txt}); return u; }
  }
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
  const kaisa=polKaisaTurnConfirm(p,text,previewCard,context);
  if(kaisa!==undefined)return kaisa;
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
  if(context?.op?.op==='dealSplit' && context.split){
    const plan=polSplitDamagePlan(p,null,context);
    const part=plan?.parts.find(x=>x.uid===context.split.target);
    return clamp(part?.n??lo);
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

// Teemo's mandatory target is chosen from the actual offered legal objects.
// Recovering a stolen unit is useful; removing a safe holder is a material/control
// loss. The full ability probe below includes its energy and exhaust payment.
function polTeemoFetchOption(p,options){
  const score=o=>{
    if(o.v?.t==='champ') return -0.01; // same play/hide access without spending energy
    const u=everyUnit().find(x=>x.uid===o.v?.uid);
    if(!u) return -Infinity;
    const owner=u.owner??u.ctrl, sign=u.ctrl===p?-1:1;
    const after=G.bfs.map(b=>({...b,units:b.units.filter(x=>x.uid!==u.uid)}));
    return sign*(might(u)*(u.loc==='base'?BOT_W.unitBase:BOT_W.unitBf)
      +(!u.ex ? .05 : 0)) + (u.isToken?0:(owner===p?1:-1)*(BOT_W.card+(card(u.n).m||0)*BOT_W.unitBase*.5))
      +evalHoldThreatValue(p,after)-evalHoldThreatValue(p);
  };
  return [...options].sort((a,b)=>score(b)-score(a))[0]?.v??null;
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
  const kp=POLICY._kaisaSpellTarget;
  if(kp?.n===104 && kp.p===p && kp.tc===G.turnCount && options?.some(o=>o.returnHand)){
    POLICY._kaisaSpellTarget=null;
    if(kp.pending && (G._rwFor!==p||G._returnPending?.pre!==kp.pending.pre||G._returnPending?.n!==kp.pending.n))return null;
    return options.find(o=>o.returnHand?.uid===kp.uid)?.v??null;
  }
  if(!options || !options.length) return null;
  if(options.some(o=>o.resourceOps)) return polResourceFundingChoice(p,options);
  const confirmation=options.find(o=>o.costConfirmation)?.costConfirmation;
  if(confirmation){
    if(!POLICY.confirm(p,confirmation.text)) return null;
    return POLICY.option(p,confirmation.pickTitle,options.map(({costConfirmation,...o})=>o));
  }
  if(options.some(o=>o.placement)) return polPlacementPlan(p,options).then(r=>r.option.v);
  if(options.some(o=>o.teemoFetch)) return polTeemoFetchOption(p,options);
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
// Neutral response options include all face-down card types. Resolve a
// copied pending spell or ability after each reveal, retaining its declared targets.
async function polHiddenReaction(p,options,pending){
  if(!pending || G.showdown || !POLICY.ab.hide || polTier().rep<1 ||
      SIM.lock || NET.online) return null;
  const candidates=[];
  for(const o of options){
    const key=o.v?.hidden;
    if(!key) continue;
    const h=G.bfs[key.bf]?.hiddenCards[key.index];
    if(!h || h.by!==p || o.card?.n!==h.n) continue;
    candidates.push({option:o,act:polHiddenAction(p,key.bf,h)});
  }
  if(!candidates.length) return null;
  const original=G, had=Object.hasOwn(original,'_returnPending'), previous=original._returnPending;
  const deadline=SIM.deadline;
  SIM.deadline=Math.min(deadline||Infinity,Date.now()+Math.max(1,Math.min(POLICY.budget||1000,1000)));
  try{
    original._returnPending=pending;
    const probe=act=>simTry(p,async()=>{
      // Evaluate the public pending action without reading unknown enemy replies.
      UI.pickReaction=async()=>null;
      const prior=new Map(everyUnit().map(u=>[u.uid,new Set(u.tempM)]));
      if(act){
        G._rwFor=p;
        if(await POLICY.runAction(p,act)===false) throw new Error('hidden response became invalid');
      }
      G._rwFor=null;
      await polResolveReturnPending();
      await cleanup(pending.p);
      await simSettle(null,POLICY);
      for(const u of everyUnit()){
        const old=prior.get(u.uid); if(!old) continue;
        u.tempM=u.tempM.filter(m=>old.has(m)||m.dur!=='turn');
      }
    },POLICY,false,false);
    const before=await probe(null);
    if(before===null) return null;
    let best=null;
    for(const {option,act} of candidates){
      if(Date.now()>SIM.deadline) break;
      const value=await probe(act);
      if(value!==null && value>before+BOT_W.moveNeed && (!best||value>best.value)) best={option,value};
    }
    if(best) polSay('reaction',best.option.label,'숨김 공개 뒤 대기 효과의 실제 해결 결과 개선',{delta:best.value-before});
    return best?.option.v||null;
  }finally{
    if(had) original._returnPending=previous; else delete original._returnPending;
    SIM.deadline=deadline;
  }
}
POLICY.reaction = async function(p, title, options){
  if(!options || !options.length) return null;
  if(!polSmart()) return null;
  const pending=options.find(o=>o.pendingSpell)?.pendingSpell;
  // The caster receives priority too. A legal counter option does not mean
  // countering our own pending spell is useful. Legacy options omit metadata.
  const counter=options.find(o=>o.isCounter && o.pendingSpell?.p!==p);
  if(!POLICY.ab.reaction) return counter?counter.v:null;
  // 카운터는 체인에 상대 주문이 실제로 있을 때만 (없으면 효과 없이 폐기된다)
  const chainHasEnemy = G.showdown && G.showdown.chain &&
    G.showdown.chain.some(it => it.p !== p && it.kind !== 'ability');
  if(counter && (chainHasEnemy || !G.showdown && pending?.p!==p)){
    polSay('reaction', counter.label, '카운터 사용');
    return counter.v;
  }
  const kaisaReaction=await polKaisaSpellReaction(p,options,pending);
  if(kaisaReaction?.handled && kaisaReaction.value!==null) return kaisaReaction.value;
  const hiddenPending=pending||options.find(o=>o.pendingAbility)?.pendingAbility;
  const hiddenReaction=await polHiddenReaction(p,options,hiddenPending);
  if(hiddenReaction!==null) return hiddenReaction;
  if(kaisaReaction?.handled) return null;
  // 지금 지불할 수 없어 손패 선택지에 없는 카운터도, 실제로 제공된 자원 능력을
  // 먼저 쓰면 같은 응수 창의 다음 반복에서 선택할 수 있다. 완성 가능한 계획만 연다.
  if(pending && !G.showdown && !TF().noPlay[p] && polTier().rep>=2){
    const target=card(pending.n);
    if(target.type==='Spell' && pending.p!==p){
      for(const n of G.players[p].hand){
        const c=card(n),fx=FX[n];
        if(c.type!=='Spell' || !fx?.kw?.reaction || !(fx.counter||fx.steal)) continue;
        if(fx.counter?.maxE!==undefined && (target.e||0)>fx.counter.maxE) continue;
        if(fx.counter?.maxPips!==undefined && powerPips(target).length>fx.counter.maxPips) continue;
        const plan=polResourceFundingPlan(p,applyCostMods(p,c,c.e||0),powerPips(c),true);
        if(!plan?.length) continue;
        const option=options.find(o=>o.v?.ab?.key===plan[0].key);
        if(!option) continue;
        polSay('reaction',option.label,'카운터 비용 충당',{counter:n,pending:pending.n});
        return option.v;
      }
    }
  }
  const returns=options.filter(o=>Number.isInteger(o.v?.hand) && o.card && polIsReturnSpell(o.card.n));
  if(pending && returns.length && !SIM.lock && !NET.online){
    // 응수 창이 닫힌 뒤의 해결·클린업 — G._rwFor(닫힌 상태 표시)를 지워야 샌드박스의 cleanup이 통제 해제·결전 개시를 한다 (190.6 · 341)
    // 대기 주문을 보드와 같은 그래프로 복제해야 도구 등의 객체 참조가 유지된다.
    // 복제 뒤 원본 pending을 넣으면 실제로 남아 있는 대상도 사라진 것으로 판단한다.
    const probe=async act=>{
      const original=G,had=Object.prototype.hasOwnProperty.call(original,'_returnPending');
      const previous=original._returnPending;
      try{original._returnPending=pending;return await simTry(p,act,POLICY);}
      finally{if(had) original._returnPending=previous;else delete original._returnPending;}
    };
    const finish=async()=>{G._rwFor=null;await polResolveReturnPending();await cleanup(pending.p);};
    const before=await probe(finish);
    let best=null;
    for(const o of returns){
      const after=await probe(async()=>{
        G._rwFor=p;
        await playCardFromHand(p,o.v.hand);
        await finish();
      });
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
function polOpeningDevelopment(n,runes){
  const c=card(n),fx=FX[n]||{};
  if(!c || Math.max(c.e||0,powerPips(c).length)>runes) return false;
  if(c.type==='Unit') return true;
  // A cheap support gear is not a first-turn body. Only count independent
  // resource production or an unconditional draw/channel/token effect.
  const independent=ops=>(ops||[]).some(op=>['draw','channel','channelOrDraw','token'].includes(op.op)) &&
    (ops||[]).every(op=>!preTargetSpecs(op).length);
  if(c.type==='Gear' && (fx.activated||[]).some(ab=>isResourceAbility(ab)&&
    !(ab.cost?.discard||ab.cost?.killFriendly||ab.cost?.spendBuff||ab.cost?.recycleTrash))) return true;
  const groups=c.type==='Gear'?fx.triggers?.onPlay:fx.playOps;
  return (groups||[]).some(g=>!g.cond&&!g.legion&&independent(g.ops)) &&
    (groups||[]).every(g=>!(g.ops||[]).some(op=>preTargetSpecs(op).length));
}
function polOpeningReplacementOrder(hand,runes){
  const indexes=hand.map((_,i)=>i);
  // When looking for an opening play, preserve one unit already known to be
  // playable on turn two. Throwing it away while keeping two targetless combat
  // tricks would merely move the same deployment problem to the next turn.
  const nextUnit=indexes.filter(i=>card(hand[i]).type==='Unit' &&
    Math.max(card(hand[i]).e||0,powerPips(card(hand[i])).length)<=runes+2)
    .sort((a,b)=>(card(hand[a]).e||0)-(card(hand[b]).e||0))[0];
  const priority=i=>{
    const c=card(hand[i]);
    if(i===nextUnit) return -1;
    if((c.e||0)>runes+2) return 4;
    if(c.type==='Gear'&&!polOpeningDevelopment(c.n,runes)) return 3;
    if(c.type==='Spell'){
      const draws=(FX[c.n]?.playOps||[]).some(g=>(g.ops||[]).some(op=>op.op==='draw'));
      return draws?1:2;
    }
    return 0;
  };
  return indexes.sort((a,b)=>priority(b)-priority(a)||(card(hand[b]).e||0)-(card(hand[a]).e||0)||a-b);
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
  // Count a real opening body or independent setup, including the public
  // Champion Zone. Zhonya and combat buffs cannot develop an empty board.
  // This reads card text and our hand only, never either deck's hidden order.
  const cheap = idxs.filter(i=>polOpeningDevelopment(h[i],openingRunes));
  const P=G.players[p];
  const champOpening=P.champInZone && polOpeningDevelopment(P.champN,openingRunes);
  const worst = [...idxs].sort((a,b)=>cost(b)-cost(a));
  const swap = cheap.length||champOpening ? worst.filter(i=>cost(i)>=5).slice(0,2)
    : polOpeningReplacementOrder(h,openingRunes).slice(0,2);
  polSay('mulligan', swap.length+'장 교체', `${G.turn===p?'선공':'후공'} ${openingRunes}룬 초반 전개 확보 · 다음 턴 유닛 보존`);
  return swap;
};

// ══════════ 전투 피해 배분 순서 ══════════
// assignDamage enforces mandatory target priority. Within the legal candidates,
// use the same aggregate casualty-value plan as combat prediction.
POLICY.assignTarget = function(p, candidates, remain, role){
  if(!candidates.length) return null;
  if(!polSmart()) return candidates[0];
  const entries=candidates.map(u=>({u,lethal:Math.max(1,might(u,role,{forKill:true})-(u.dmg||0)),
    value:evalCombatRemovalValue(u),tank:!!effKw(u).tank,last:!!unitFx(u).combatLast,immune:!canTakeCombatDamage(u)}));
  const u=evalCombatAllocation(remain,entries).order[0]?.u||candidates[0];
  polSay('assign',unitName(u),'치사량·처치 가치·강제 우선순위를 함께 계산',{remain});
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
  'recall','recallAll','recallIt','recallSelf','retreatOp','portalRescue','teemoFetch',
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
  // reactionWindow removes its current display item before the real effect
  // executes. Keep an outer unresolved item, but release this copied window so
  // chainClosed()/cleanup can advance control and combat at the same time.
  const chain=G.pendingChain,top=chain?.[chain.length-1];
  if(top && top.p===pending.p && top.n===pending.n) chain.pop();
  if(pending.ab && pending.ctx){
    // Response options retain a declared ability's targets and source graph.
    // Triggered "here" follows a surviving source, but a departed source loses
    // it; Deathknell keeps the location where that unit died.
    const ctx=pending.ctx,u=ctx.unit,onBoard=!!(u&&everyUnit().includes(u));
    const gone=!!(u&&!onBoard&&!ctx.deathTrigger);
    const moved=!!(u&&onBoard&&!ctx.deathTrigger&&ctx.bfIdx!=null&&u.loc!==ctx.bfIdx);
    const current=pending.triggered
      ? gone?{...ctx,bfIdx:null,sourceGone:true}:moved?{...ctx,bfIdx:u.loc==='base'?null:u.loc}:ctx
      : {...ctx,bfIdx:u&&u.loc!=='base'?u.loc:null};
    await execOps(pending.ab.ops,current);
    return;
  }
  await resolveSpellEffects(pending.p,pending.n,FX[pending.n],pending);
}
// 결전의 패스 결과(체인과 전투 포함)와 카드 사용 결과를 비용까지 포함해 비교한다.
function polHasCombatEngineOp(value){
  if(!value || typeof value!=='object') return false;
  if(Array.isArray(value)) return value.some(polHasCombatEngineOp);
  if(['damage','damageAll','kill','killAll'].includes(value.op) ||
    value.op==='might' && (value.n<0 || value.all || value.spec?.count==='all')) return true;
  return ['ops','elseOps','inner','branches'].some(k=>polHasCombatEngineOp(value[k]));
}
function polEngineTrick(n){
  // 피해·처치는 사망 격발까지, 광역 효과는 다른 전장의 병력·통제까지 비교한다.
  // 전체 강화/위력 감소도 대상 수와 적용 직후 치명 판정을 엔진에 맡긴다.
  return polIsReturnSpell(n)||n===128||n===203||polHasCombatEngineOp(FX[n]?.playOps);
}
async function polReturnShowdownAction(p,excluded=[]){
  if(!POLICY.ab.showdown || (SIM.lock && !SIM.settling) || NET.online) return null;
  const candidates=[];
  G.players[p].hand.forEach((n,idx)=>{
    if(!excluded.includes(n) && polEngineTrick(n) && polCanPlay(p,card(n)) && !playRestriction(card(n),p,false))
      candidates.push({kind:'play',idx,n});
  });
  // Every face-down card has Reaction (737.6), including Units, Gear and
  // printed Actions. Compare the resulting chain and combat before revealing.
  // A printed-keyword gate here stranded Zhonya and hidden defenders.
  if(POLICY.ab.hide && polTier().rep>=1) G.bfs.forEach((bf,bfIdx)=>{
    for(const h of bf.hiddenCards){
      if(!polHiddenPlayable(p,bfIdx,h,{tried:polSdTried()})) continue;
      const fx=FX[h.n]||{};
      if(fx.counter||fx.steal) continue; // handled by its target-aware comparison
      if(polAssaultBonus(h.n) || polMfTimelineBlocked(p,h.n)) continue;
      if(!polOffensivePlayable(p,h.n,bfIdx,true)) continue;
      candidates.push(polHiddenAction(p,bfIdx,h));
    }
  });
  if(!candidates.length) return null;
  const deadline=SIM.deadline; SIM.deadline=deadline||Date.now()+1000;
  try{
    const probe=act=>simTry(p,async()=>{
        const prior=new Map(everyUnit().map(u=>[u.uid,new Set(u.tempM)]));
        if(act && await POLICY.runAction(p,act)===false) throw new Error('showdown action became invalid');
        await simSettle(null,POLICY);
        // 결전에서 얻은 처치·생존·통제는 보존한다. 생존자에게 남은 이번 턴 위력은
        // 영구 병력 이득으로 세지 않는다(단일 강화 대상 평가와 같은 기준).
        for(const u of everyUnit()){
          const old=prior.get(u.uid); if(!old) continue;
          u.tempM=u.tempM.filter(m=>old.has(m)||m.dur!=='turn');
        }
      },POLICY,false,false);
    const before=await probe(null);
    if(before===null) return null;
    let best=null;
    for(const act of candidates){
      if(Date.now()>SIM.deadline) break;
      const after=await probe(act);
      if(after!==null && after>before+BOT_W.moveNeed && (!best || after>best.value)) best={act,value:after};
    }
    if(best) polSay('showdown',card(best.act.n).ko,'실제 주문 해결로 결전 결과 개선',{delta:best.value-before});
    return best?.act||null;
  }finally{SIM.deadline=deadline;}
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
      // 이미 탈진해 기지에 있는 유닛은 이번 턴 추가 위력을 이동·전투에 쓰지 못한다.
      // 새 일시 위력만 제외해 회수 주문의 부수 격발을 영구 전력처럼 세지 않는다.
      // 준비되거나 전장으로 나갔다면 실제 활용 가능성이 생겼으므로 그대로 평가한다.
      const idle=new Map(everyUnit().filter(u=>u.ctrl===p && u.loc==='base' && u.ex)
        .map(u=>[u.uid,new Set(u.tempM)]));
      const i=G.players[p].hand.indexOf(c.n);
      if(i>=0) await playCardFromHand(p,i);
      await simSettle();
      for(const u of everyUnit()){
        const prior=idle.get(u.uid);
        if(prior && u.ctrl===p && u.loc==='base' && u.ex)
          u.tempM=u.tempM.filter(m=>prior.has(m)||m.dur!=='turn');
      }
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
// Action/Reaction describe timing, not whether a card needs a combat target.
// Drawing and channeling have lasting value on a neutral turn. Keep temporary
// combat tricks for an outcome comparison, even when the hand is large.
function polNeutralResourceSpell(fx){
  const ops=(fx.playOps||[]).flatMap(group=>group.ops||[]);
  return ops.length>0 && ops.every(op=>['draw','channel','channelOrDraw'].includes(op.op));
}
function polReadyDeployment(p,n){
  // Kai'Sa already compares acceleration, targets and card order in its full
  // turn planner. Keep that planner's baseline free of a second readiness search.
  if(polKaisaDeck(p)) return false;
  const fx=FX[n]||{};
  return card(n).type==='Unit' && (fx.entersReady || fx.kw?.accelerate || TF().enterReady[p] ||
    (fx.triggers?.onPlay||[]).some(group=>(group.ops||[]).some(op=>op.op==='ready')));
}
function polReadySetup(p,n){
  if(polKaisaDeck(p) || TF().enterReady[p] || card(n).type!=='Spell') return false;
  const ops=(FX[n]?.playOps||[]).flatMap(g=>g.ops||[]);
  const ready=op=>op.op==='setFlag' && op.flag==='enterReady' && op.val===true;
  return ops.some(ready) && ops.every(op=>ready(op)||op.op==='draw');
}
POLICY.pickPlay = async function(p, blocked){
  const P = G.players[p];
  const budget = readyRunes(p).length - POLICY.reserve(p);
  let cands = [];
  P.hand.forEach((n,i)=>{
    if(blocked && blocked.has('h'+n)) return;
    if(polKaisaDeck(p) && n===122) return; // Extra turns require the dedicated full-turn comparison.
    const c = card(n);
    if(polAssaultBonus(n)) return; // 공격 결전의 전용 평가까지 보류
    if(!polOffensivePlayable(p,n)) return;
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
    else if(polHard() && (fx.kw.action||fx.kw.reaction) && !polNeutralResourceSpell(fx)) score = -1;
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
  if(top.score < 0) return -1;   // Hand size never turns an unused combat trick into value.
  POLICY._playScore = top.score;
  polSay('play', card(top.n).ko, '가치 순', {score:top.score});
  return top.i;
};

// 중립 열린 상태의 제거 주문도 유닛 전개와 직접 비교한다. 카드 종류별 고정 점수만
// 쓰면 룬을 싼 유닛부터 소진해, 두 전장을 비울 수 있는 제거 주문이 사라진다.
// 기본은 한 행동과 남은 이동을 비교한다. 준비 전개 주문은 기존 손패 유닛을 잇고,
// 비교 기준에도 같은 두 번째 유닛 전개 기회를 준다. 실제 덱 순서나
// 상대 손패의 응수를 사용하지 않으며, 임시 위력 자체를 영구 병력으로 평가하지 않는다.
let polNeutralRemovalDepth=0;
async function polNeutralRemovalChoice(p,ctx,core){
  if(!polHard() || NET.online || !G || G.turn!==p || G.state!=='neutral' || G.phase!=='action'
    || polNeutralRemovalDepth || (SIM.movementDepth||0)>=2) return core;
  // 덱 전용 자원 보존/엔진 우선순위는 해당 정책에서 판단한다.
  if(polMfAuroraDeck(p)) return core;
  const P=G.players[p], seen=new Set(), candidates=[];
  P.hand.forEach((n,idx)=>{
    if(seen.has(n) || ctx.tried?.has('h'+n)) return;
    seen.add(n);
    const readyDeployment=polReadyDeployment(p,n), fx=FX[n]||{};
    const enhancement=!polKaisaDeck(p) && card(n).type==='Spell' &&
      polEnhanceOps((fx.playOps||[]).flatMap(g=>g.ops||[]));
    if(!readyDeployment && !enhancement && (card(n).type!=='Spell' || !polHasCombatEngineOp(fx.playOps))) return;
    if(core?.kind==='play' && core.n===n) return;
    if(!polCanPlay(p,card(n)) || playRestriction(card(n),p,false)) return;
    candidates.push({kind:'play',idx,n,readyDeployment});
  });
  if(P.champInZone && core?.kind!=='champ' && !ctx.tried?.has('champ') &&
      polReadyDeployment(p,P.champN) && polCanPlay(p,card(P.champN)) && !playRestriction(card(P.champN),p,false))
    candidates.push({kind:'champ',n:P.champN,readyDeployment:true});
  // Enter-ready setup needs a second, known card. Never justify it using the
  // identity of the card that its draw might reveal.
  const stock=P.hand.reduce((m,n)=>m.set(n,(m.get(n)||0)+1),new Map());
  const units=[...stock.keys()].filter(n=>card(n).type==='Unit' && !ctx.tried?.has('h'+n))
    .map(n=>({kind:'play',n}));
  if(P.champInZone && !ctx.tried?.has('champ')) units.push({kind:'champ',n:P.champN});
  for(const [idx,n] of P.hand.entries()){
    if(P.hand.indexOf(n)!==idx || ctx.tried?.has('h'+n) || !polReadySetup(p,n) ||
        !polCanPlay(p,card(n)) || playRestriction(card(n),p,false)) continue;
    for(const unit of units) candidates.push({kind:'play',idx,n,readySetupUnit:unit});
  }
  if(!candidates.length) return core;
  const savedDeadline=SIM.deadline;
  SIM.deadline=Math.min(savedDeadline||Infinity,Date.now()+Math.min(POLICY.budget||400,1000));
  polNeutralRemovalDepth++;
  try{
    const probe=async (act,followup=act?.readySetupUnit)=>{
      let result=null;
      const value=await simTry(p,async()=>{
        const enemies=new Set(everyUnit().filter(u=>u.ctrl!==p).map(u=>u.uid));
        // Own remaining composition is known; card order is not. Every candidate
        // draws from the same canonical order without touching the real deck.
        G.players[p].deck.sort((a,b)=>a-b);
        // Neutral response windows are separate from simSettle: explicitly pass
        // them as well so hidden opposing counters cannot steer this comparison.
        UI.pickReaction=async()=>null;
        POLICY.turnPlan=null;
        if(act && await POLICY.runAction(p,act)===false) return;
        await simSettle(null,POLICY);
        if(followup && G.winner===null){
          const remaining=(stock.get(followup.n)||0)-Number(act?.kind==='play' && act.n===followup.n);
          if(followup.kind==='play' && remaining<1 ||
              followup.kind==='champ' && (!G.players[p].champInZone || act?.kind==='champ')) return;
          const next=followup.kind==='champ'?followup:
            {...followup,idx:G.players[p].hand.indexOf(followup.n)};
          if(next.kind==='play' && next.idx<0 || await POLICY.runAction(p,next)===false) return;
          await simSettle(null,POLICY);
        }
        const followups=Math.max(0,Math.min(ctx.movesLeft||0,polTier().moves||1));
        for(let m=0;m<followups && G.winner===null && G.turn===p && G.state==='neutral';m++){
          const move=POLICY.movePlan(p);
          if(!move) break;
          const beforeMove=simHash(G);
          await moveUnits(p,move.units,move.dest);await simSettle(null,POLICY);
          if(simHash(G)===beforeMove) break;
        }
        const surviving=new Set(everyUnit().filter(u=>u.ctrl!==p).map(u=>u.uid));
        const removed=[...enemies].filter(uid=>!surviving.has(uid)).length;
        // Damage and this-turn Might that failed to secure removal/control expire;
        // they are not a material advantage to carry into the next turn.
        for(const u of everyUnit()){
          u.tempM=u.tempM.filter(m=>m.dur!=='turn');
          u.dmg=0;
        }
        result={removed,won:G.winner===p,points:G.players[p].points,holds:evalHolds(p)};
      },POLICY,!!SIM.lock,false);
      return value===null || !result ? null : {...result,value};
    };
    const baseline=await probe(core);
    if(!baseline) return core;
    // Give the ordinary line the same second-card opportunity as setup+unit.
    // Only initial hand/champion stock is eligible on both sides.
    let setupBaseline=baseline;
    if(candidates.some(act=>act.readySetupUnit)){
      for(const unit of units){
        if(Date.now()>SIM.deadline) break;
        const other=await probe(core,unit);
        if(other && other.value>setupBaseline.value) setupBaseline=other;
      }
    }
    let best=null;
    for(const act of candidates){
      if(Date.now()>SIM.deadline) break;
      const result=await probe(act);
      const reference=act.readySetupUnit?setupBaseline:baseline;
      if(!result || (!act.readyDeployment && !act.readySetupUnit && !result.won && !result.removed)) continue;
      if(act.readySetupUnit && !result.won && result.removed<=reference.removed &&
          result.points<=reference.points && result.holds<=reference.holds) continue;
      if(result.value>reference.value+BOT_W.moveNeed && (!best || result.value>best.value+1e-9))
        best={act,...result,baselineValue:reference.value};
    }
    if(best){
      polSay('play-check',card(best.act.n).ko,best.act.readySetupUnit?
        '준비 전개 주문과 현재 손패 유닛의 후속 정복 비교':best.act.readyDeployment?
        '준비 등장·준비 효과와 후속 이동을 실제 해결로 비교':'중립 제거와 전개를 같은 범위로 비교',
        {delta:best.value-best.baselineValue,removed:best.removed});
      return best.act;
    }
    return core;
  }finally{polNeutralRemovalDepth--;SIM.deadline=savedDeadline;}
}

// ══════════ 손패 플레이 vs 챔피언 ══════════
// 예전엔 손패를 다 소진한 뒤에야 챔피언을 냈다. 챔피언은 대개 덱에서 가장 강한 유닛이라
// 순서를 뒤로 미루는 것 자체가 손해다 — 같은 잣대로 견줘 더 좋은 쪽을 먼저 낸다.
POLICY.playPlan = async function(p, ctx){
  const P = G.players[p];
  const idx = await POLICY.pickPlay(p, ctx.tried);
  const handAct = idx >= 0 ? { kind:'play', idx, n:P.hand[idx] } : null;
  const champOk = P.champInZone && !ctx.tried.has('champ') && polCanPlay(p, card(P.champN))
    && !polMfNeutralCardBlocked(p,P.champN);
  if(!champOk) return await polNeutralRemovalChoice(p,ctx,handAct);
  if(!POLICY.ab.champ || !polSmart()) return await polNeutralRemovalChoice(p,ctx,handAct || { kind:'champ' });
  const cs = card(P.champN);
  const champScore = 100 + (cs.m||0)*2 - polCost(cs) + await polPlacementBonus(p,cs.n,-1,{champZone:true});
  if(handAct && POLICY._playScore > champScore) return await polNeutralRemovalChoice(p,ctx,handAct);
  polSay('play', cs.ko, '챔피언 우선', {champScore, best:POLICY._playScore});
  return await polNeutralRemovalChoice(p,ctx,{ kind:'champ' });
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
  if(SIM.active||NET.online||!polHard()) return fallback;
  const ready=everyUnit().filter(u=>u.ctrl===p&&!u.ex&&!u.stunned&&(u.loc==='base'||effKw(u).ganking));
  if(!ready.length) return null;
  // An expiring combat advantage must be used now. This is common to all decks,
  // including global reductions: an earlier focus/no-attack plan may be stale.
  const temporaryWindow=ready.some(u=>u.tempM.some(t=>t.dur==='turn'&&t.v>0)) ||
    G.bfs.some(b=>b.units.some(u=>u.ctrl!==p&&u.tempM.some(t=>t.dur==='turn'&&t.v<0)));
  if(!polMfAuroraDeck(p)&&!temporaryWindow) return fallback;
  const plan=POLICY.turnPlan?.p===p&&POLICY.turnPlan.tc===G.turnCount?POLICY.turnPlan:null;
  if(plan?.noAttack&&!temporaryWindow) return fallback;
  const deadline=SIM.deadline;SIM.deadline=deadline||Date.now()+1200;
  try{
    const probe=action=>simTry(p,async()=>{
      POLICY.turnPlan=null;
      if(action){
        const ids=action.units.map(u=>u.uid);
        await moveUnits(p,everyUnit().filter(u=>ids.includes(u.uid)),action.dest);
      }
      await simSettle(null,POLICY);
      // Compare surviving material at the same horizon. Leave combat resolution,
      // death triggers, returns, and control changes to the actual engine.
      if(temporaryWindow&&G.winner===null){
        for(const u of everyUnit()) u.tempM=u.tempM.filter(t=>t.dur!=='turn');
        G.tflags.buffPlus=[0,0];
      }
    },POLICY,false,false);
    const base=await probe(null);
    if(base===null) return fallback;
    const candidates=[];
    if(fallback)candidates.push(fallback);
    for(let dest=0;dest<G.bfs.length;dest++){
      if(plan?.focusBf!==undefined&&dest!==plan.focusBf&&!temporaryWindow) continue;
      if(G.bfs[dest].controller===p&&!G.bfs[dest].units.some(u=>u.ctrl!==p))continue;
      const legal=ready.filter(u=>u.loc!==dest);
      for(const units of polMfAttackGroups(legal)) candidates.push({units,dest});
      // A weaker unit can cash in a temporary reduction while the strongest one
      // takes a different battlefield; strong prefixes alone omit that exchange.
      if(temporaryWindow) for(const u of legal)candidates.push({units:[u],dest});
    }
    let best=null;const seen=new Set();
    for(const a of candidates){
      if(SIM.deadline&&Date.now()>SIM.deadline)break;
      const ids=a.units.map(u=>u.uid),key=a.dest+':'+[...ids].sort((a,b)=>a-b).join(',');
      if(seen.has(key))continue;seen.add(key);
      const value=await probe(a);
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
    // Full-army attacks already occur in the strongest-prefix candidates.
    // A macro plan cannot add fictitious value to a material-losing attack.
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
  // The current tactical threshold also applies to a previously chosen focus.
  // Public hold-win prevention is already valued by evalAttackValue itself.
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

// 도구에는 엔진 uid가 없다. 보드/리플레이를 변경하지 않고 개체마다 식별자를 보관한다.
// cloneG는 이 매핑을 사본에 전달하여 같은 개체의 시뮬레이션 키를 유지한다.
const POL_GEAR_IDS = new WeakMap();
const POL_HIDDEN_IDS = new WeakMap();
let POL_NEXT_GEAR_ID = 1, POL_NEXT_HIDDEN_ID = 1;
function polGearId(g){
  if(!POL_GEAR_IDS.has(g)) POL_GEAR_IDS.set(g,POL_NEXT_GEAR_ID++);
  return POL_GEAR_IDS.get(g);
}
function polCopySourceIdentity(original, copy){
  if(POL_GEAR_IDS.has(original)) POL_GEAR_IDS.set(copy,POL_GEAR_IDS.get(original));
  if(POL_HIDDEN_IDS.has(original)) POL_HIDDEN_IDS.set(copy,POL_HIDDEN_IDS.get(original));
}
// 밴들 나무에는 같은 이름의 숨김 카드도 둘까지 놓인다. 선택한 개체와 재시도 기록을
// 분리해서 보관해야, 다른 카드를 다시 고르거나 두 번째 사본까지 차단하지 않는다.
function polHiddenKey(p,bfIdx,h){
  if(!POL_HIDDEN_IDS.has(h)) POL_HIDDEN_IDS.set(h,POL_NEXT_HIDDEN_ID++);
  return 'v'+p+':'+bfIdx+':hidden:'+POL_HIDDEN_IDS.get(h);
}
function polHiddenAction(p,bfIdx,h){
  return {kind:'hidden',bfIdx,n:h.n,hiddenIndex:G.bfs[bfIdx].hiddenCards.indexOf(h),
    hiddenKey:polHiddenKey(p,bfIdx,h),label:'숨김 '+card(h.n).ko};
}
function polHiddenForAction(p,act){
  const cards=G.bfs[act.bfIdx]?.hiddenCards||[];
  const h=act.hiddenKey ? cards.find(x=>polHiddenKey(p,act.bfIdx,x)===act.hiddenKey)
    : act.hiddenIndex!==undefined ? cards[act.hiddenIndex]
    : cards.find(x=>x.by===p && x.n===act.n && x.turn<G.turnCount);
  return h && h.by===p && h.n===act.n && h.turn<G.turnCount ? h : null;
}
function polHiddenPlayable(p,bfIdx,h,ctx){
  const bf=G.bfs[bfIdx];
  if(!bf || bf.controller!==p || !h || !bf.hiddenCards.includes(h) || h.by!==p ||
      !(h.turn<G.turnCount) || ctx?.tried?.has(polHiddenKey(p,bfIdx,h))) return false;
  if(bf.units.some(u=>u.ctrl!==p && unitFx(u).blockReveal)) return false;
  const c=card(h.n);
  if(!c || playRestriction(c,p,true,bfIdx)) return false;
  if(c.type==='Unit' && !unitPlayLocationOptions(p,h.n).some(o=>o.v===bfIdx)) return false;
  return true;
}
function polAbilitySourceKey(p,src){
  if(src.kind==='unit') return p+':unit:'+src.u.uid;
  if(src.kind==='gear') return p+':gear:'+polGearId(src.g);
  return p+':legend';
}

// 전설·도구·유닛의 활성화 능력을 한 목록으로
function polAbList(p){
  const P = G.players[p], out = [];
  const push = (src, name, fx) => ((fx && fx.activated) || []).forEach((ab, i) => {
    out.push({ src, ab, name, key: polAbilitySourceKey(p,src)+'#'+i });
  });
  push({kind:'legend'}, card(P.legendN).ko, FX[P.legendN]);
  P.gear.forEach(g => push({kind:'gear', g}, card(g.n).ko, FX[g.n]));
  everyUnit().filter(u => u.ctrl === p).forEach(u => push({kind:'unit', u}, unitName(u), unitFx(u)));
  // 하이머딩거(111) '아군 전설·유닛·도구의 모든 탈진 능력을 가진다' — 복사 능력은 하이머딩거 자신의 능력(자원 충당 357.1.a·응수 창·봇 공용,
  // RiftJudge #2679 · #4686). 원 카드의 위치 제한(onlyAtBf)은 복사하지 않는다(#8631) — engine activateAbility가 ab.copied로 건너뛴다.
  everyUnit().filter(u => u.ctrl === p && unitFx(u).copyAllExhaust).forEach(h => {
    const add = (fx, name, origin) => ((fx && fx.activated) || []).forEach((ab, i) => {
      if(!ab.cost || !ab.cost.exhaustSelf) return;
      const src={kind:'unit',u:h};
      out.push({src,ab:{...ab,copied:true},name:unitName(h)+'(복사: '+name+')',
        key:polAbilitySourceKey(p,src)+'#copy:'+origin+'#'+i});
    });
    add(FX[P.legendN],card(P.legendN).ko,polAbilitySourceKey(p,{kind:'legend'}));
    P.gear.forEach(g=>add(FX[g.n],card(g.n).ko,polAbilitySourceKey(p,{kind:'gear',g})));
    everyUnit().filter(x=>x.ctrl===p && x!==h && !x.isToken).forEach(x=>
      add(unitFx(x),unitName(x),polAbilitySourceKey(p,{kind:'unit',u:x})));
  });
  return out;
}

// 엔진 activateAbility의 게이트를 그대로 미리 확인한다.
// (엔진은 조건 미달이면 토스트만 띄우고 끝나므로, 미리 거르지 않으면 봇이 헛수에 갇힌다)
function polAbLegal(p, c){
  const P = G.players[p], ab = c.ab, cost = ab.cost || {};
  if(typeof canActivateAbilityTiming==='function' && !canActivateAbilityTiming(p,ab)) return false;
  if(G.state === 'showdown'){
    if(!(ab.reaction || ab.action)) return false;
    if(G.showdown && G.showdown.chain.length && !ab.reaction) return false;
  } else if(G.turn !== p || G.phase !== 'action'){
    if(!ab.reaction) return false;   // [반응] 능력은 중립 닫힌 상태(상대 턴 응수 창)에서도 가능 (룰 309.2)
  }
  if(ab.legion && !legionOKFor(p, c.src)) return false;   // '다른 카드' 기준(engine legionOKFor) — 이 턴에 낸 발동원 자신은 제외
  if(ab.onlyAtBf && !ab.copied && c.src.kind === 'unit' && c.src.u.loc === 'base') return false;
  if(typeof abilityHasTargets === 'function' && !abilityHasTargets(p, c.src, ab)) return false;   // 대상 없으면 발동 불가 (404 — 엔진 preTargetAbility와 같은 판단)
  // 봇은 효과가 없는 추가 버프를 피한다. 사람은 경고를 확인한 뒤 규칙상 적법한 대상을 유지할 수 있다.
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

// 현재 허용하는 충당은 자원 비용/희생/버림 없이 발동하는 [반응] 자원 능력이다.
// 복사된 능력 여러 개가 같은 유닛을 탈진시키면 그 중 하나만 쓸 수 있다.
function polSafeResource(c){
  const cost=c.ab.cost||{};
  // raw 등 컴파일러 메타데이터는 지불이 아니다. 실제 비용 필드만 검사한다.
  const paid=['energy','power','pips','recycleTrash','discard','spendBuff','killFriendlyOrGear','killSelfGear'];
  return c.ab.reaction && polAbIsResource(c) &&
    paid.every(k=>!cost[k] || Array.isArray(cost[k]) && !cost[k].length);
}
function polProbeResource(p,c,check){
  const P=G.players[p], fields=['energy','energySpell','powerSpell','power'];
  const saved=fields.map(k=>({k,value:P[k],had:Object.prototype.hasOwnProperty.call(P,k)}));
  const source=c.src.kind==='legend'?P:c.src.kind==='unit'?c.src.u:c.src.g;
  const exKey=c.src.kind==='legend'?'legendEx':'ex';
  const wasEx=source[exKey], hadEx=Object.prototype.hasOwnProperty.call(source,exKey);
  try{
    P.power={...P.power};
    if(c.ab.cost?.exhaustSelf) source[exKey]=true;
    for(const op of c.ab.ops||[]){
      if(!(op.n>0)) continue;
      if(op.op==='addEnergy') P.energy=(P.energy||0)+op.n;
      else if(op.op==='addSpellEnergy') P.energySpell=(P.energySpell||0)+op.n;
      else if(op.op==='addSpellPower') P.powerSpell=(P.powerSpell||0)+op.n;
      else if(op.op==='addPower') P.power[op.dom||'Any']=(P.power[op.dom||'Any']||0)+op.n;
    }
    return check();
  }finally{
    for(const {k,value,had} of saved){ if(had) P[k]=value; else delete P[k]; }
    if(hadEx) source[exKey]=wasEx; else delete source[exKey];
  }
}
function polResourceFundingPlan(p,energy,pips,spellOK,check){
  const payable=check||(()=>canPay(p,energy,pips,spellOK));
  if(payable()) return [];
  const candidates=polAbList(p).filter(c=>polSafeResource(c) && polAbLegal(p,c));
  // 같은 발생원의 같은 추가 효과는 한 번만 검사한다(하이머의 중복 복사).
  const seen=new Set(), funds=candidates.filter(c=>{
    const signature=polAbilitySourceKey(p,c.src)+'|'+JSON.stringify(c.ab.ops);
    if(seen.has(signature)) return false; seen.add(signature); return true;
  });
  let visits=0;
  const search=(start,path)=>{
    if(payable()) return path;
    if(path.length>=8 || ++visits>256) return null; // 엔진의 충당 루프는 최대 8회
    // 엔진의 합산은 같은 발생원의 대안을 중복 계산할 수 있으므로 부정 판정에만 사용한다.
    if(typeof canPayWithFunding==='function'){
      const pool=G.players[p].power;
      let possible;
      try{ G.players[p].power={...pool}; possible=canPayWithFunding(p,energy,pips,spellOK); }
      finally{ G.players[p].power=pool; }
      if(!possible) return null;
    }
    for(let i=start;i<funds.length;i++){
      const c=funds[i];
      if(!polAbLegal(p,c) || !resourceAbilityHelpsPay(p,c.ab,energy,pips,spellOK)) continue;
      const plan=polProbeResource(p,c,()=>search(i+1,[...path,c]));
      if(plan) return plan;
    }
    return null;
  };
  return search(0,[]);
}
// 지불 가능성과 룬을 보존하는 지불은 별개다. 실제 payCost와 같은 순서로
// 지불해 본 뒤 남는 룬/준비 룬을 비교하되, 원래 플레이어와 자원 개체는 건드리지 않는다.
function polRunePaymentAfter(p,energy,pips,spellOK){
  if(!canPay(p,energy,pips,spellOK)) return null;
  const original=G.players[p], probe={...original,
    power:{...original.power},runes:original.runes.map(r=>({...r})),runeDeck:[...original.runeDeck]};
  try{
    G.players[p]=probe;
    payCost(p,energy,pips,true,spellOK);
    return {runes:probe.runes.length,ready:probe.runes.filter(r=>!r.ex).length};
  }finally{ G.players[p]=original; }
}
function polResourceSavingPlan(p,energy,pips,spellOK,offered){
  const baseline=polRunePaymentAfter(p,energy,pips,spellOK);
  if(!baseline) return null;
  const abilities=polAbList(p);
  let best=null, outcome=baseline;
  for(const c of offered){
    // 준비 유닛은 이동/전투에 쓸 수 있다. 이미 낼 수 있는 비용을 아끼기 위해
    // 유닛을 탈진시키거나 다른 유용한 탈진 능력을 포기하지 않는다.
    if(c.src.kind==='unit' || !polSafeResource(c) || !polAbLegal(p,c)) continue;
    if(c.ab.cost?.exhaustSelf && abilities.some(other=>other.key!==c.key &&
      polAbilitySourceKey(p,other.src)===polAbilitySourceKey(p,c.src) &&
      other.ab.cost?.exhaustSelf && !polAbIsResource(other) && polAbLegal(p,other))) continue;
    const next=polProbeResource(p,c,()=>polRunePaymentAfter(p,energy,pips,spellOK));
    if(next && (next.runes>outcome.runes || next.runes===outcome.runes && next.ready>outcome.ready)){
      best=c; outcome=next;
    }
  }
  return best?[best]:[];
}
function polResourceFundingChoice(p,options){
  const skip=options.find(o=>o.skipResourcePrompt), payment=skip?.resourcePayment;
  if(!payment) return skip?.v??null;
  const {energy,pips}=payment, spellOK=!!payment.spellOK;
  // 가속/할인/대상 굴절 등이 반영된 엔진의 실제 지불 금액을 사용한다.
  // 카드의 인쇄 비용이나 새 대상 후보로 다시 판정하면 이미 확정된 선택과 어긋난다.
  const payable=()=>canPay(p,energy,pips,spellOK);
  const offered=listResourceFunding(p,energy,pips,spellOK);
  const plan=payable()?polResourceSavingPlan(p,energy,pips,spellOK,offered):
    polResourceFundingPlan(p,energy,pips,spellOK,payable);
  if(!plan?.length) return skip.v;
  const index=offered.findIndex(c=>c.key===plan[0].key);
  const option=options.find(o=>o.resourceOps && o.v===index);
  return option?option.v:skip.v;
}

// 이 [추가] 능력을 쓰면 카드 n을 낼 수 있게 되는가.
// 자원 풀을 잠깐 부풀렸다 되돌려 엔진의 canPay에게 직접 물어본다 — 룬은 에너지와 힘을
// 둘 다 낼 수 있어서 "모자란 게 에너지인가 힘인가"를 손으로 계산하면 양방향으로 틀린다.
// (동기 구간이라 중간에 다른 코드가 끼어들 수 없다)
function polWouldFund(p, c, n){
  if(!polSafeResource(c) || !polAbLegal(p,c)) return false;
  try{ return polProbeResource(p,c,()=>polCanPlay(p,card(n),false)); }
  catch(err){ return false; }
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
    if(polAbOps(c).includes('teemoFetch') && !teemoFetchOptions(p).some(o=>o.v.t==='u')) continue;
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
  let best = null, bestC = 1;
  const candidates=P.hand.map((n,idx)=>({n,idx}));
  if(P.champInZone) candidates.push({n:P.champN,idx:'champ'});
  for(const candidate of candidates){
    const {n}=candidate;
    if(!(FX[n] || {kw:{}}).kw.hidden) continue;
    if(ctx && ctx.tried.has('x' + n)) continue;
    const c = polCost(card(n));
    if(c > bestC){ bestC=c; best=candidate; }
  }
  if(!best) return null;
  polSay('hide', card(best.n).ko, '비용 ' + bestC + ' 절약');
  return {kind:'hide',...best};
};

// Neutral turns may develop hidden units/gear. Showdown reveals, of every
// card type, are compared with passing by polReturnShowdownAction instead.
POLICY.hiddenPlan = function(p, ctx, wantTrick){
  if(!POLICY.ab.hide || polTier().rep<1 || wantTrick) return null;
  for(let i=0;i<G.bfs.length;i++){
    for(const h of G.bfs[i].hiddenCards){
      if(!polHiddenPlayable(p,i,h,ctx)) continue;
      const c=card(h.n), fx=FX[h.n]||{kw:{}};
      if(!polOffensivePlayable(p,h.n,i,true) || polAssaultBonus(h.n) || polMfTimelineBlocked(p,h.n)) continue;
      // Keep ordinary hand-trick timing as the neutral-development preference;
      // it never limits the acquired Reaction of a face-down card in a window.
      if(fx.kw.action || fx.kw.reaction) continue;
      polSay('hidden',c.ko,'숨긴 카드 무료 플레이 (#'+i+')');
      return polHiddenAction(p,i,h);
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

// 카운터에는 전투 스냅샷을 바꾸는 playOps가 없다. 공개된 체인의 적법한 상대
// 주문 각각에 대해, 패스 결과와 실제 비용을 내고 대응한 결과를 같은 엔진으로 비교한다.
async function polCounterShowdownAction(p){
  const sd=G.showdown;
  if(!sd || !sd.chain.length || !POLICY.ab.showdown || !polSmart() ||
      (!polHard() && !polTier().trick) || typeof simTry!=='function' ||
      (SIM.lock && !SIM.settling) || NET.online) return null;
  const candidates=[], seen=new Set();
  const add=act=>{
    const fx=FX[act.n]||{};
    if(!(fx.counter||fx.steal)) return;
    if(playRestriction(card(act.n),p,act.kind==='hidden',act.bfIdx)) return;
    if(act.kind==='play' && !polCanPlay(p,card(act.n))) return;
    for(const target of counterTargets(p,fx)){
      if(target.p===p || (target.execAs??target.p)===p) continue;
      candidates.push({...act,counterTarget:{index:sd.chain.indexOf(target),
        displayId:target.displayId,n:target.n,p:target.p}});
    }
  };
  G.players[p].hand.forEach((n,idx)=>{
    if(seen.has(n)) return; seen.add(n); add({kind:'play',idx,n});
  });
  if(POLICY.ab.hide && polTier().rep>=1) G.bfs.forEach((bf,bfIdx)=>{
    if(bf.units.some(u=>u.ctrl!==p && unitFx(u).blockReveal)) return;
    for(const h of bf.hiddenCards){
      if(polHiddenPlayable(p,bfIdx,h,{tried:polSdTried()}))
        add(polHiddenAction(p,bfIdx,h));
    }
  });
  if(!candidates.length) return null;
  // 실전 결전 호출에는 외부 탐색 예산이 없을 수 있다. 기존 전술 탐색과 같은
  // 예산 설정을 쓰되 1초로 제한하고, 더 짧은 바깥 예산은 연장하지 않는다.
  const oldDeadline=SIM.deadline;
  const localDeadline=Date.now()+Math.max(1,Math.min(POLICY.budget||400,1000));
  SIM.deadline=oldDeadline ? Math.min(oldDeadline,localDeadline) : localDeadline;
  try{
    if(Date.now()>SIM.deadline) return null;
    // ownActions=false: 비교 중에는 양쪽 모두 패스하여 카운터 검색 재귀를 막는다.
    const before=await simTry(p,async()=>{},POLICY,false,false);
    if(before===null) return null;
    let best=null;
    for(const act of candidates){
      if(Date.now()>SIM.deadline) break;
      const after=await simTry(p,async()=>{
        if(await POLICY.runAction(p,act)===false) throw new Error('counter action became invalid');
      },POLICY,false,false);
      if(after!==null && after>before+Math.max(0,BOT_W.moveNeed||0) && (!best || after>best.value))
        best={act,value:after};
    }
    if(best) polSay('showdown',card(best.act.n).ko,'공개 체인 대응의 실제 해결 결과 개선',
      {target:best.act.counterTarget.n,delta:best.value-before});
    return best?.act||null;
  }finally{SIM.deadline=oldDeadline;}
}

// 선택한 체인 항목을 시뮬레이션과 실제 실행 양쪽에서 그대로 지정한다.
// Map/객체 참조를 행동에 보관하지 않고, 복제 후에도 유지되는 표시 ID와 인덱스로 찾는다.
async function polRunCounterAction(p,act){
  const sd=G.showdown, key=act.counterTarget, fx=FX[act.n]||{};
  if(!sd || !key || !(fx.counter||fx.steal)) return false;
  const target=key.displayId===undefined ? sd.chain[key.index]
    : sd.chain.find(it=>it.displayId===key.displayId);
  if(!target || target.n!==key.n || target.p!==key.p || target.p===p || (target.execAs??target.p)===p ||
      !counterTargets(p,fx).includes(target)) return false;
  if(act.kind==='play' && G.players[p].hand[act.idx]!==act.n) return false;
  const hidden=act.kind==='hidden' ? polHiddenForAction(p,act) : null;
  if(act.kind==='hidden' && !hidden) return false;
  const option=POLICY.option;
  POLICY.option=function(q,title,options){
    if(q===p && title==='대응할 주문 선택') return options.find(o=>o.v===target)?.v??null;
    return option.call(this,q,title,options);
  };
  try{
    if(act.kind==='hidden'){
      await playHidden(p,act.bfIdx,hidden);
      return !G.bfs[act.bfIdx].hiddenCards.includes(hidden);
    }
    return await playCardFromHand(p,act.idx);
  }finally{ POLICY.option=option; }
}

// ══════════ 정밀 결전 예측 (sdx) ══════════
// 지금 양측이 패스하면 벌어질 전투를 계산한다 — 실제 배분과 같은 합산 처치 가치 기준.
// 스냅샷: {m: 역할 위력, lethal: 처치에 필요한 피해, stun, might: 소재 가치}
function polSdSnap(p, sd){
  const us = unitsAt(sd.bfIdx);
  const role = u => u.ctrl === sd.attacker ? 'attacker' : 'defender';
  const mk = u => ({ uid:u.uid, m: might(u, role(u)), killM:might(u,role(u),{forKill:true}), dmg:u.dmg,
                     lethal: Math.max(1, might(u, role(u), {forKill:true}) - u.dmg),
                     stun: !!u.stunned, might: might(u), value:evalCombatRemovalValue(u), tank:!!effKw(u).tank, last:!!unitFx(u).combatLast, immune:!canTakeCombatDamage(u) });
  return { mine: us.filter(u=>u.ctrl===p).map(mk), theirs: us.filter(u=>u.ctrl!==p).map(mk), spellExch:0 };
}
// 결과 클래스 (p 관점): 공격자면 2=정복 성공 / 1=실패, 수비자면 1=정복 저지 / 0=정복당함.
// exch = 처치 교환 손익 (상대가 잃는 위력 − 내가 잃는 위력)
function polSdOutcome(p, sd, snap){
  const sum = a => a.reduce((s,x)=>s+(x.stun?0:x.m),0);
  const myM = sum(snap.mine), opM = sum(snap.theirs);
  const deadOf=(total,arr)=>evalCombatAllocation(total,arr).dead;
  const opDead=deadOf(myM, snap.theirs), myDead=deadOf(opM, snap.mine);
  const opLeft=snap.theirs.length-opDead.length, myLeft=snap.mine.length-myDead.length;
  let cls;
  if(sd.attacker===p) cls = (opLeft===0 && myLeft>0) ? 2 : 1;
  else cls = (myLeft===0 && opLeft>0) ? 0 : 1;
  const exch = (snap.spellExch||0) + opDead.reduce((s,x)=>s+x.might,0) - myDead.reduce((s,x)=>s+x.might,0);
  return { cls, exch, myM, opM, myLeft, opLeft };
}
// 트릭의 컴파일된 op를 스냅샷 사본에 근사 적용. 전투와 무관한 카드(드로우 등)는 false.
function polSdApplyOps(p, sd, snap, ops){
  let touched=false;
  const myBest = () => snap.mine.filter(x=>!x.stun).sort((a,b)=>b.m-a.m)[0];
  const opBestAlive = () => snap.theirs.filter(x=>!x.stun).sort((a,b)=>b.m-a.m)[0];
  const remove=(side,x)=>{
    const i=side.indexOf(x); if(i<0) return;
    snap.spellExch=(snap.spellExch||0)+(side===snap.mine?-1:1)*x.might;
    side.splice(i,1);
  };
  const changeMight=(t,n,min)=>{
    const old=t.killM??t.m, next=Math.max(min??0,old+n), delta=next-old;
    t.killM=next; t.m=Math.max(0,t.m+delta);
    t.lethal=Math.max(1,t.lethal+delta);
    // 감소 하한은 위력에만 적용한다. 이미 쌓인 피해가 새 위력 이상이면 즉시 죽는다.
    if((t.dmg||0)>0 && t.dmg>=next) remove(snap.mine.includes(t)?snap.mine:snap.theirs,t);
  };
  for(const op of ops||[]){
    if(!op) continue;
    if(op.op==='optional' && op.inner){ if(polSdApplyOps(p,sd,snap,[op.inner])) touched=true; }
    else if(op.op==='might' && (op.all || op.spec?.count==='all')){
      const ids=new Set(unitsBySpec({...op.spec,count:'all'},p).map(u=>u.uid));
      for(const t of [...snap.mine,...snap.theirs]) if(ids.has(t.uid)){
        changeMight(t,op.n,op.min); touched=true;
      }
    }
    else if(op.op==='might' && op.n>0 && (op.self || !op.spec || op.spec.side!=='enemy')){
      const t=myBest(); if(t){ changeMight(t,op.n,op.min); touched=true; }
    }
    else if(op.op==='might' && op.n<0){
      const t=opBestAlive(); if(t){ changeMight(t,op.n,op.min); touched=true; }
    }
    else if(op.op==='damageAll'){
      // 숫자 count는 서로 다른 대상을 직접 고르는 주문이므로 위의 실제 엔진 평가가 담당한다.
      if(typeof op.spec?.count==='number' || !(op.n>0) || TF().preventSpellDmg) continue;
      const spec=op.spec||{side:'enemy',where:'any',count:'all'};
      const targets=new Map(unitsBySpec({...spec,count:'all'},p).map(u=>[u.uid,u]));
      for(const side of [snap.mine,snap.theirs]) for(const x of [...side]){
        const u=targets.get(x.uid);
        if(!u || !canTakeCombatDamage(u)) continue;
        const damage=dmgPlus(op.n,u,p)+(TF().nextSpellBonus[p]||0);
        if(damage<=0) continue;
        if(x.lethal<=damage || TF().dmgKill || u._guillotine) remove(side,x);
        else { x.lethal-=damage; x.dmg=(x.dmg||0)+damage; }
        touched=true;
      }
    }
    else if(op.op==='damage' && (!op.spec || op.spec.side!=='friendly')){
      const killable = snap.theirs.filter(x=>x.lethal<=op.n).sort((a,b)=>b.might-a.might)[0];
      if(killable){ remove(snap.theirs,killable); touched=true; }
      else { const t=[...snap.theirs].sort((a,b)=>b.lethal-a.lethal)[0]; if(t){ t.lethal=Math.max(1,t.lethal-op.n); t.dmg=(t.dmg||0)+op.n; touched=true; } }
    }
    else if((op.op==='kill') && op.spec && op.spec.side!=='friendly'){
      const el=snap.theirs.filter(x=>op.spec.mightMax===undefined||x.might<=op.spec.mightMax).sort((a,b)=>b.might-a.might)[0];
      if(el){ remove(snap.theirs,el); touched=true; }
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
  const snap={ mine:snap0.mine.map(x=>({...x})), theirs:snap0.theirs.map(x=>({...x})), spellExch:snap0.spellExch||0 };
  if(!polSdApplyOps(p, sd, snap, ops)) return null;    // 전투 무관 카드 — 결전에 태우지 않는다
  const out=polSdOutcome(p, sd, snap);
  return { gain:(out.cls-base.cls)*10 + (out.exch-base.exch), cls:out.cls };
}

// 결전에서 취할 행동 하나. 손패 트릭 → 자금 조달(자원 능력) → 숨겨둔 트릭 순.
POLICY.showdownAction = async function(p){
  const sd = G.showdown;
  if(!sd) return null;
  const counter=await polCounterShowdownAction(p);
  if(counter) return counter;
  const kaisa=await polKaisaSpellShowdown(p);
  if(kaisa?.action) return kaisa.action;
  const assault=!kaisa?.handled && await polAssaultShowdownAction(p);
  if(assault) return assault;
  if(polSmart()){
    const bounce=await polReturnShowdownAction(p,kaisa?.handled?POL_KAISA_SPELLS:[]);
    if(bounce) return bounce;
  }
  if(!polHard() && !polTier().trick) return null;   // trick: 탐색 없는 티어도 정밀 결전 판단(sdx, 정적 계산)으로 트릭을 낸다
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
    if(fx.counter || fx.steal) return false; // 전용 체인 비교가 거절한 카운터는 정적 근사로 재선택하지 않는다
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
      if(best && (best.cls>base.cls || best.gain>=BOT_W.sdGain)){
        polSay('showdown', card(best.n).ko, '정밀 트릭', {myM, opM, gain:+best.gain.toFixed(1)});
        return { kind:'play', idx:best.i, n:best.n };
      }
    }
    // 자금 조달 대상도 '내면 결과가 좋아지는데 돈이 모자란' 카드로 한정
    want = P.hand.filter(n => {
      if(!usable(n) || polCanPlay(p, card(n))) return false;
      const r=polSdTrickGain(p, sd, snap0, base, n);
      return !!r && (r.cls>base.cls || r.gain>=BOT_W.sdGain);
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
  // All face-down cards were already compared through the actual engine.
  // Do not blindly reveal a declined card through a printed-keyword fallback.
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
// 같은 공개 보드에서 행동 + 남은 횟수 내의 후속 이동을 비교한다.
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
    const availableMoves=Math.max(0,(ctx.movesLeft||0)-(kind==='move'?1:0));
    const followups=polMfAuroraDeck(p)?Math.min(1,availableMoves):Math.min(availableMoves,polKaisaDeck(p)?6:(polTier().moves||1));
    for(let m=0;m<followups && G.winner===null && G.state==='neutral';m++){
      const mv=POLICY.movePlan(p);
      if(!mv) break;
      const beforeMove=simHash(G);
      await moveUnits(p,mv.units,mv.dest);await simSettle();
      if(simHash(G)===beforeMove) break;
    }
    // Generic emergency play must finish its immediate movement sequence first.
    // A Watcher debuff can enable a second attack, but its surviving -3 is not
    // permanent enemy material removed after this turn ends.
    if(!polMfAuroraDeck(p)) for(const u of everyUnit()){
      u.tempM=u.tempM.filter(m=>m.dur!=='turn');
      u.dmg=0;
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
// A single capture may still leave a second battlefield supplying the winning
// hold. Search a bounded sequence of our known cards and visible attackers;
// execute only its first action, then re-evaluate the actual response/result.
function polEmergencySequenceActions(p,ctx,remaining){
  const P=G.players[p],out=[],seen=new Set();
  const add=a=>{const key=a.kind==='move'?'m:'+a.dest+':'+a.uids.join(','):a.kind+':'+a.n;
    if(!seen.has(key)){seen.add(key);out.push(a);}};
  for(const n of new Set(P.hand)){
    if(!(remaining.get(n)>0)||ctx.tried?.has('h'+n)||!polCanPlay(p,card(n))||playRestriction(card(n),p,false))continue;
    if(polMfNeutralCardBlocked(p,n))continue;
    add({kind:'play',n});
  }
  if(P.champInZone&&!ctx.tried?.has('champ')&&polCanPlay(p,card(P.champN))&&!polMfNeutralCardBlocked(p,P.champN))
    add({kind:'champ',n:P.champN});
  if(ctx.movesLeft>0){
    const movable=everyUnit().filter(u=>u.ctrl===p&&!u.ex&&!u.stunned&&(u.loc==='base'||effKw(u).ganking));
    for(let i=0;i<G.bfs.length;i++){
      const bf=G.bfs[i];
      if(bf.controller===p&&!bf.units.some(u=>u.ctrl!==p))continue;
      const legal=movable.filter(u=>u.loc!==i),groups=polMfAttackGroups(legal);
      for(const u of legal)groups.push([u]);
      for(const units of groups)add({kind:'move',uids:units.map(u=>u.uid).sort((a,b)=>a-b),dest:i});
    }
  }
  return out;
}
function polEmergencySequenceAction(p,a){
  if(a.kind==='play'){
    const idx=G.players[p].hand.indexOf(a.n);
    return idx<0?null:{...a,idx};
  }
  if(a.kind==='champ')return G.players[p].champInZone&&G.players[p].champN===a.n?{...a}:null;
  if(a.kind==='move'){
    const units=a.uids.map(uid=>everyUnit().find(u=>u.uid===uid&&u.ctrl===p));
    return units.every(Boolean)?{...a,units}:null;
  }
  return null;
}
async function polEmergencySequenceProbe(p,ctx,steps,stock){
  let result=null;
  const value=await simTry(p,async()=>{
    // Canonical own composition, concealed opponent placeholders, and no
    // neutral hidden response. A drawn card cannot become a promised follow-up.
    polKaisaTurnPublicSample(p,0);
    const originalDraw=drawCard;
    drawCard=function(q,silent){
      const before=G.players[q].hand.length,result=originalDraw(q,silent);
      // Rune 7 is an inert unknown-card marker only inside this probe. A fresh
      // draw must not impersonate a known same-name copy discarded earlier.
      if(q===p&&G.players[q].hand.length>before)G.players[q].hand[G.players[q].hand.length-1]=7;
      return result;
    };
    try{
    const remaining=new Map(stock),response=polKaisaSequenceResponse(p,remaining);
    const local={...ctx,tried:new Set(ctx.tried||[])};
    for(const step of steps){
      if(G.winner!==null)break;
      if(G.turn!==p||G.state!=='neutral'||G.phase!=='action')return;
      if(step.kind==='play'&&!(remaining.get(step.n)>0))return;
      if(step.kind==='move'&&local.movesLeft<=0)return;
      const a=polEmergencySequenceAction(p,step);if(!a)return;
      const before=simHash(G);
      if(await POLICY.runAction(p,a)===false)return;
      if(a.kind==='play')remaining.set(a.n,remaining.get(a.n)-1);
      if(a.kind==='move')local.movesLeft--;
      await simSettle(p,response);
      if(simHash(G)===before)return;
    }
    const won=G.winner===p,forecast=evalHoldForecast(opp(p));
    const safe=won||(G.winner===null&&!forecast.win);
    const actions=G.winner===null&&G.turn===p&&G.state==='neutral'?polEmergencySequenceActions(p,local,remaining):[];
    const key=simHash(G)+':'+local.movesLeft+':'+JSON.stringify([...remaining]);
    // Temporary Might and unconverted damage expire before the next hold.
    for(const u of everyUnit()){u.dmg=0;u.tempM=u.tempM.filter(m=>m.dur!=='turn');}
    result={won,safe,points:forecast.points,actions,key};
    }finally{drawCard=originalDraw;}
  },POLICY,false,false);
  return value===null||!result?null:{...result,value,steps};
}
async function polEmergencySequence(p,ctx){
  if(SIM.active||SIM.lock||!POLICY.race(p).oppLethal)return null;
  const stock=new Map();for(const n of G.players[p].hand)stock.set(n,(stock.get(n)||0)+1);
  let frontier=[{steps:[],actions:polEmergencySequenceActions(p,ctx,stock)}],best=null;
  const initial=evalHoldForecast(opp(p)).points,seen=new Set();
  for(let depth=0;depth<4&&frontier.length;depth++){
    const next=[];
    for(const node of frontier)for(const action of node.actions){
      if(SIM.deadline&&Date.now()>SIM.deadline)return best;
      const r=await polEmergencySequenceProbe(p,ctx,[...node.steps,action],stock);
      if(!r)continue;
      if(r.safe){
        const rank=(r.won?10000:1000)+r.value;
        if(!best||rank>best.rank+1e-9)best={...r,rank};
        continue;
      }
      if(seen.has(r.key))continue;seen.add(r.key);
      next.push({...r,rank:(initial-r.points)*10+r.value});
    }
    if(best)return best;
    next.sort((a,b)=>b.rank-a.rank);
    frontier=next.slice(0,8);
  }
  return best;
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
        if(h.by!==p||h.turn===G.turnCount||ctx.tried.has(polHiddenKey(p,i,h))) continue;
        if(!polOffensivePlayable(p,h.n,i,true)) continue;
        const act=polHiddenAction(p,i,h);
        if(candidates.some(a=>a.hiddenKey===act.hiddenKey)) continue;
        candidates.push({...act,run:()=>POLICY.runAction(p,act)});
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
    if(!best&&danger){
      const sequence=await polEmergencySequence(p,ctx);
      if(sequence){
        const first=polEmergencySequenceAction(p,sequence.steps[0]);
        if(first){
          polSay('survival-sequence',first.kind==='move'?'이동 → #'+first.dest:card(first.n).ko,
            '기존 손패와 후속 이동으로 모든 유지 패배 조건 차단',{steps:sequence.steps});
          return {...first,emergency:true,emergencySequence:sequence.steps};
        }
      }
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
// Kai'Sa's card order is a small public-state plan, not a fixed card ranking.
// Plans use cards already in hand/the chosen champion; draws never manufacture
// a promised second card. Resolve each action in the engine, then replan live.
let polKaisaSequenceDepth=0;
function polKaisaSequenceAction(p,a){
  if(!a) return null;
  if(a.kind==='play'){
    const idx=G.players[p].hand.indexOf(a.n);
    if(idx<0)return null;
    if(a.kaisaSequenceDariusTarget){
      const d=everyUnit().filter(u=>u.ctrl===p&&u.n===27&&u.loc==='base').sort((x,y)=>y.uid-x.uid)[0];
      if(!d)return null;
      return {...a,idx,kaisaTargets:[d.uid]};
    }
    return {...a,idx};
  }
  if(a.kind==='champ') return G.players[p].champInZone?{...a,n:G.players[p].champN}:null;
  if(a.kind==='move'){
    const ids=a.uids||a.units.map(u=>u.uid),units=everyUnit().filter(u=>ids.includes(u.uid));
    return units.length===ids.length?{...a,units}:null;
  }
  return {...a};
}
function polKaisaSequenceCard(a){return a?.kind==='play'||a?.kind==='champ';}
function polKaisaSequenceRoles(p){
  const P=G.players[p], spells=P.hand.filter(n=>card(n).type==='Spell' && (card(n).e||0)<=2);
  let value=0;
  for(const u of everyUnit().filter(u=>u.ctrl===p)){
    // Small future utility only; newly accumulated temporary Might is removed
    // after immediate attacks. It must never be scored as permanent material.
    if(u.n===103) value+=Math.min(0.18,spells.length*0.06);
    if(u.n===13 && G.players[opp(p)].runes.length) value+=0.08;
    if(u.n===96) value+=0.04; // public replacement draw on a later trade
    if(u.n===87 && u.loc!=='base' && unitsAt(u.loc).some(v=>v.ctrl===p&&v.uid!==u.uid&&evalMaterialMight(v)>2)) value+=0.12;
  }
  return value;
}
// Check a concrete one/two-spell reserve with the real payment algorithm.
// Floating pools expire at turn end; an unspent legend may fund only once.
function polKaisaSequenceCanReserve(p,ns,pipExtras=[]){
  const original=G.players[p], P={...original,runes:original.runes.map(r=>({...r})),
    runeDeck:[...original.runeDeck],gear:original.gear.map(g=>({...g})),energy:0,energySpell:0,powerSpell:0,
    power:Object.fromEntries(Object.keys(original.power).map(k=>[k,0]))};
  try{
    G.players[p]=P;
    const pay=i=>{
      if(i===ns.length)return true;
      const c=card(ns[i]), e=applyCostMods(p,c,c.e||0),pips=[...powerPips(c),...(pipExtras[i]||[])];
      if(canPay(p,e,pips,true)){payCost(p,e,pips,true,true);return pay(i+1);}
      for(const ability of polAbList(p).filter(a=>a.src.kind!=='unit'&&polSafeResource(a)&&polAbLegal(p,a))){
        if(!resourceAbilityHelpsPay(p,ability.ab,e,pips,true))continue;
        const runes=P.runes.map(r=>({...r})), deck=[...P.runeDeck];
        const success=polProbeResource(p,ability,()=>canPay(p,e,pips,true)?(payCost(p,e,pips,true,true),pay(i+1)):false);
        if(success)return true;
        P.runes=runes;P.runeDeck=deck;
      }
      return false;
    };
    return pay(0);
  }finally{G.players[p]=original;}
}
function polKaisaSequenceReserve(p){
  const P=G.players[p],o=opp(p), attackers=G.players[o].base.filter(u=>!effKw(u).temporary).map(polNextTurnUnit);
  if(!attackers.length)return 0;
  let value=0;
  for(let i=0;i<G.bfs.length;i++){
    if(G.bfs[i].controller!==p)continue;
    const original=G;
    try{
      G={...G,bfs:G.bfs.map(b=>({...b,units:b.units.map(polNextTurnUnit)}))};
      const combat=evalCombat(o,i,attackers), lost=combat.defDead.filter(u=>u.ctrl===p);
      if(!lost.length)continue;
      // Retreat has a concrete prospective victim; reserve no mana merely
      // because a Reaction exists in hand. One saved unit is the upper bound.
      if(P.hand.includes(104)&&polKaisaSequenceCanReserve(p,[104]))
        value=Math.max(value,Math.min(1.8,Math.max(...lost.map(u=>evalMaterialMight(u)))*BOT_W.unitBase+0.15));
      const darius=unitsAt(i).find(u=>u.ctrl===p&&u.n===27);
      const tricks=P.hand.filter(n=>n===95||n===9);
      const choices=tricks.map(n=>[n]);
      if(darius)for(let a=0;a<tricks.length;a++)for(let b=a+1;b<tricks.length;b++)choices.push([tricks[a],tricks[b]]);
      for(const ns of choices){
        const target=[...attackers].sort((a,b)=>might(b)-might(a))[0];
        const extra=ns.map(()=>deflectPips(p,target));
        if(!polKaisaSequenceCanReserve(p,ns,extra))continue;
        const temps=new Map(unitsAt(i).map(u=>[u.uid,[...u.tempM]]));
        const before=evalAttackValue(o,i,attackers), projected=attackers.map(u=>({...u,tempM:[...u.tempM]}));
        const t=projected.find(u=>u.uid===target.uid);
        for(const n of ns){
          if(n===95)t.tempM.push({v:-1,dur:'turn',min:1});
          else t.dmg+=3;
        }
        // Spell-play triggers are a resolved effect, not a chain-enqueue bonus.
        for(const u of unitsAt(i).filter(u=>u.ctrl===p)){
          if(u.n===103)u.tempM.push({v:ns.length,dur:'turn'});
          if(u.n===27&&ns.length===2)u.tempM.push({v:2,dur:'turn'});
        }
        const alive=projected.filter(u=>u.dmg<Math.max(1,might(u,'attacker',{forKill:true})));
        const after=evalAttackValue(o,i,alive), gain=before-after;
        // Remove probe-only triggers before the next payment/target alternative.
        for(const u of unitsAt(i).filter(u=>u.ctrl===p))u.tempM=temps.get(u.uid)||[];
        if(gain>0.1)value=Math.max(value,Math.min(1.8,gain*0.6));
      }
    }finally{G=original;}
  }
  return value;
}
// Restrict response selection to copies known before the probe. A new draw
// contributes a card to hand value but cannot supply a promised combo card.
function polKaisaSequenceResponse(p,remaining){
  return {...POLICY,showdownAction:async q=>{
    if(q!==p)return null;
    const P=G.players[p],hand=P.hand,counts=new Map(remaining),visible=[];
    for(const n of hand)if(counts.get(n)>0){visible.push(n);counts.set(n,counts.get(n)-1);}
    let act;
    try{P.hand=visible;act=await POLICY.showdownAction(p);}
    finally{P.hand=hand;}
    if(act?.kind==='play'){
      const n=act.n??visible[act.idx],idx=hand.indexOf(n);
      if(idx<0||!(remaining.get(n)>0))return null;
      return {...act,n,idx};
    }
    return act;
  },runAction:async(q,a)=>{
    const ok=await POLICY.runAction(q,a);
    if(ok!==false&&q===p&&a.kind==='play')remaining.set(a.n,(remaining.get(a.n)||0)-1);
    return ok;
  }};
}
// Only for a caller's already cloned board. Runtime dispatch executes the
// first action normally; this previews the complete winning-order candidate.
async function polKaisaSequencePreview(p,act){
  const remaining=new Map(act.kaisaSequenceStock||[]),response=polKaisaSequenceResponse(p,remaining);
  const oldReaction=UI.pickReaction,oldPlan=POLICY.turnPlan;
  try{
    UI.pickReaction=async()=>null;POLICY.turnPlan=null;
    for(const descriptor of act.kaisaSequenceSteps||[]){
      if(G.winner!==null)break;
      const a=polKaisaSequenceAction(p,descriptor);if(!a)return false;
      if(await POLICY.runAction(p,a)===false)return false;
      if(a.kind==='play')remaining.set(a.n,(remaining.get(a.n)||0)-1);
      await simSettle(p,response);
    }
    return true;
  }finally{UI.pickReaction=oldReaction;POLICY.turnPlan=oldPlan;}
}
async function polKaisaSequenceProbe(p,ctx,steps,stock,greedy=false){
  let result=null;
  const score=await simTry(p,async()=>{
    UI.pickReaction=async()=>null;
    G.players[p].deck.sort((a,b)=>a-b);
    POLICY.turnPlan=null;
    const remaining=new Map(stock),executed=[];
    const response=polKaisaSequenceResponse(p,remaining);
    let moves=Math.max(0,ctx.movesLeft||0),used=0,first=null,changed=false;
    const run=async descriptor=>{
      const a=polKaisaSequenceAction(p,descriptor);
      if(!a)return false;
      if(polKaisaSequenceCard(a)){
        if(a.kind==='play' && !(remaining.get(a.n)>0))return false;
        if(!polCanPlay(p,card(a.n)))return false;
      }
      if(a.kind==='move'&&moves<=0)return false;
      const before=simHash(G);
      if(await POLICY.runAction(p,a)===false)return false;
      // Remove this declared card before any triggered response window.
      if(a.kind==='play')remaining.set(a.n,remaining.get(a.n)-1);
      await simSettle(p,response);
      if(simHash(G)===before)return false;
      executed.push({...descriptor});
      if(!first)first={...descriptor};changed=true;
      if(a.kind==='move')moves--;
      else if(polKaisaSequenceCard(a)){used++;}
      return true;
    };
    for(const a of steps){if(G.winner!==null)break;if(!await run(a))return;}
    while((greedy||used>0)&&used<3&&G.winner===null&&G.state==='neutral'){
      const a=await POLICY.playPlan(p,{...ctx,tried:new Set(ctx.tried||[]),movesLeft:moves});
      if(!a || a.n===122 || (a.kind==='play'&&!(remaining.get(a.n)>0)) || !await run(a))break;
    }
    while(moves>0&&G.winner===null&&G.state==='neutral'){
      const mv=POLICY.movePlan(p);if(!mv)break;
      if(!await run({kind:'move',uids:mv.units.map(u=>u.uid),dest:mv.dest}))break;
    }
    // A Student/Watcher turn bonus counts only through actual achieved combat.
    for(const u of everyUnit()){u.tempM=u.tempM.filter(m=>m.dur!=='turn');u.dmg=0;}
    const bonus=G.winner===null?polKaisaSequenceRoles(p)+polKaisaSequenceReserve(p):0;
    result={first,changed,bonus,used,executed,won:G.winner===p};
  },POLICY,!!SIM.lock,false);
  return score===null||!result?null:{...result,value:score+result.bonus};
}
async function polKaisaSequencePlan(p,ctx,options={}){
  if(!polKaisaDeck(p)||NET.online||(SIM.active&&!(options.inTurnProbe&&(SIM.movementDepth||0)<1))||polKaisaSequenceDepth||G.turn!==p||G.state!=='neutral'||G.phase!=='action')return null;
  const P=G.players[p], hasStudent=P.hand.includes(103),
    hasRoles=new Set(P.hand.filter(n=>[13,96,87,103].includes(n))).size>1, hasLegion=P.playedCards===0&&P.hand.some(n=>FX[n]?.selfCost?.legion),
    hasDarius=P.playedSeq<2&&(P.hand.includes(27)||(P.champInZone&&P.champN===27)||everyUnit().some(u=>u.ctrl===p&&u.n===27));
  const reserve=polKaisaSequenceReserve(p);
  if(!hasStudent&&!hasRoles&&!hasLegion&&!hasDarius&&!reserve)return null;
  const deadline=SIM.deadline;
  SIM.deadline=Math.min(deadline||Infinity,Date.now()+Math.min(1300,options.maxMs||1300));
  polKaisaSequenceDepth++;
  try{
    const stock=new Map();for(const n of P.hand)stock.set(n,(stock.get(n)||0)+1);
    const core=await POLICY.playPlan(p,ctx);
    if(core?.n===122)return null; // dedicated extra-turn horizon owns Time Warp
    const coreStep=core?{...core,n:core.kind==='champ'?P.champN:core.n}:null;
    const baseline=await polKaisaSequenceProbe(p,ctx,coreStep?[coreStep]:[],stock,true);
    if(!baseline)return null;
    const cards=[...stock.keys()].filter(n=>n!==122&&!ctx.tried?.has('h'+n)&&(!polAssaultBonus(n)||(n===4&&hasDarius)))
      .flatMap(n=>{
        if([9,95,104].includes(n)&&typeof polKaisaSpellCandidates==='function'){
          const targets=polKaisaSpellCandidates(p,[n]);
          if(targets.length) return targets;
        }
        return [{kind:'play',n,...(n===4?{kaisaSequenceDariusTarget:true}:{}),
          ...(n===27?{kaisaPlayLoc:'base'}:{})}];
      });
    if(P.champInZone&&!ctx.tried?.has('champ'))cards.push({kind:'champ',n:P.champN,
      ...(P.champN===27?{kaisaPlayLoc:'base'}:{})});
    const plans=[];
    // Unit roles may break a true tie; spells are never thrown away only to
    // increase Legion/Darius counters. Their real resolved outcome is compared.
    for(const a of cards){
      if(card(a.n).type==='Unit'||a.n===4&&P.playedSeq===1)plans.push({steps:[a],greedy:true});
      for(const b of cards){
        if(a.kind===b.kind&&a.n===b.n&&(a.kind==='champ'||stock.get(a.n)<2))continue;
        const legion=hasLegion&&FX[b.n]?.selfCost?.legion;
        const darius=hasDarius&&(a.n===27||b.n===27||everyUnit().some(u=>u.ctrl===p&&u.n===27));
        const student=a.n===103&&card(b.n).type==='Spell';
        if(legion||darius||student)plans.push({steps:[a,b]});
      }
    }
    // Ready after a held field: return BEFORE resolving card two. No Gank or
    // extra free readiness is assumed; moveUnits verifies both standard moves.
    if(hasDarius && (ctx.movesLeft||0)>=2)for(const u of everyUnit().filter(u=>u.ctrl===p&&u.n===27&&u.loc!=='base'&&!u.ex&&!u.stunned)){
      if(P.playedSeq===1)for(const a of cards)plans.unshift({steps:[{kind:'move',uids:[u.uid],dest:'base'},a]});
      else for(const a of cards)for(const b of cards){
        if(a.kind===b.kind&&a.n===b.n&&(a.kind==='champ'||stock.get(a.n)<2))continue;
        plans.unshift({steps:[a,{kind:'move',uids:[u.uid],dest:'base'},b]});
      }
    }
    if(reserve)plans.push({steps:[]});
    let best=null;
    for(const plan of plans){
      if(Date.now()>SIM.deadline)break;
      const r=await polKaisaSequenceProbe(p,ctx,plan.steps,stock,plan.greedy);
      if(!r||r.value<=baseline.value+BOT_W.moveNeed)continue;
      if(!best||r.value>best.value+1e-8)best=r;
    }
    if(!best)return null;
    const act=polKaisaSequenceAction(p,best.first)||{kind:'end'};
    polSay('kaisa-sequence',act.kind==='play'?card(act.n).ko:act.kind,'카드 순서·준비·응수 비용을 실제 해결로 비교',
      {delta:best.value-baseline.value,steps:best.used});
    return {...act,kaisaWin:best.won,kaisaSequenceValue:best.value,kaisaSequenceDelta:best.value-baseline.value,
      kaisaSequenceSteps:best.executed,kaisaSequenceStock:[...stock]};
  }finally{polKaisaSequenceDepth--;SIM.deadline=deadline;}
}

POLICY.nextAction = async function(p, ctx){
  const kaisa=await polKaisaNextAction(p,ctx);
  if(kaisa) return kaisa;
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
  if(act.kind==='play' && act.kaisaTargets) return await polKaisaSpellRun(p,act);
  if(polKaisaDeck(p)&&(typeof act.kaisaAccel==='boolean'||Object.hasOwn(act,'kaisaPlayLoc')))
    return polKaisaTurnRun(p,act);
  if(act.counterTarget) return await polRunCounterAction(p,act);
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
    case 'hidden': {
      if(act.n===undefined && act.hiddenIndex===undefined && !act.hiddenKey) return await playHidden(p,act.bfIdx);
      const h=polHiddenForAction(p,act);
      if(!h) return false;
      await playHidden(p,act.bfIdx,h);
      return !G.bfs[act.bfIdx].hiddenCards.includes(h);
    }
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
  // Kai'Sa's card/target/movement search owns the decision budget. Do not run
  // another macro search first or suppress the moves it has actually verified.
  if(!polKaisaDeck(p) && polTier().think && POLICY.ab.think && !POLICY.race(p).oppLethal) await polPlanTurn(p, ctx);
  let act = await POLICY.nextAction(p, ctx);
  if(!act || act.kind === 'end') return true;
  const P = G.players[p];
  const hadHand = P.hand.length, hadChamp = P.champInZone;
  if(onPlay && (act.kind === 'play' || act.kind === 'hidden')) onPlay(act.n);
  // 탐색이 고른 후보는 자기 run()을 들고 있다 (클론에서 검증된 실행 경로)
  const ok = act.run ? await act.run() : await POLICY.runAction(p, act);
  if(act.kind === 'play'  && ok === false && G.players[p].hand.length === hadHand) ctx.tried.add('h' + act.n);
  if(act.kind === 'champ' && ok === false && hadChamp && G.players[p].champInZone) ctx.tried.add('champ');
  if(act.kind === 'hide' && G.players[p].hand.length === hadHand
    && (act.idx!=='champ' || G.players[p].champInZone===hadChamp)) ctx.tried.add('x' + act.n);
  if(act.kind === 'move'){   ctx.movesLeft--;
    // 이동은 국면을 가장 크게 바꾼다 — 탐색 티어는 이동 직후 턴 플랜을 다시 세운다 (수용 지평선)
    if(polTier().think && POLICY.ab.think && !(typeof SIM!=='undefined' && (SIM.active||SIM.lock))) ctx.plannedTc = -1;
  }
  if(act.kind === 'ability') ctx.tried.add('a' + act.key);
  if(act.kind === 'hidden')  ctx.tried.add(act.hiddenKey || 'v' + act.bfIdx + ':' + act.n);
  return false;
};

// 턴이 바뀌면 재시도 차단·이동 횟수를 초기화한다
POLICY.newCtx = function(){ return { tried:new Set(), movesLeft:0, tc:-1 }; };
POLICY.syncCtx = function(ctx){
  if(ctx.tc === G.turnCount) return ctx;
  ctx.tc = G.turnCount; ctx.tried.clear();
  // Garrison, return, resolved-card readiness and a new attack are separate
  // standard moves. Six is a bounded search budget, never a source of readiness.
  ctx.movesLeft = polKaisaDeck(G.turn) ? 6 : (polTier().moves || 1);
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
//   원본을 가리켜 아무 일도 일어나지 않는다. 반드시 발생원 개체 식별자로 다시 찾을 것.
function polActionCandidates(p, ctx){
  const P = G.players[p];
  const blocked = ctx && ctx.tried;
  const out = [];
  // 손패 플레이 (같은 카드 번호는 한 번만 — 사본은 결과가 같다)
  const seen = new Set();
  P.hand.forEach((n, i) => {
    if(blocked && blocked.has('h'+n)) return;
    if(polKaisaDeck(p) && n===122) return;
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
    const gid = c.src.kind === 'gear' ? polGearId(c.src.g) : null;
    out.push({ kind:'ability', key:c.key, label:c.name + ' ' + c.ab.label,
      run: async()=>{
        let src = { kind:c.src.kind };
        if(uid !== null){ const u = everyUnit().find(x => x.uid === uid); if(!u) return; src.u = u; }
        else if(gid !== null){ const g = G.players[p].gear.find(x => polGearId(x)===gid); if(!g) return; src.g = g; }
        await activateAbility(p, src, c.ab);
      } });
  }
  // 숨겨둔 카드 꺼내기 / 새로 숨기기
  const hid = POLICY.hiddenPlan(p, ctx, false);
  if(hid) out.push({ ...hid, run:()=>POLICY.runAction(p,hid) });
  const hd = POLICY.hidePlan(p, ctx);
  if(hd) out.push({kind:'hide',n:hd.n,idx:hd.idx,label:'숨기기 '+card(hd.n).ko,
    run:async()=>{
      const P=G.players[p];
      if(hd.idx==='champ'){
        if(P.champInZone && P.champN===hd.n) return await hideCard(p,'champ');
        return false;
      }
      const j=P.hand.indexOf(hd.n); return j>=0 ? await hideCard(p,j) : false;
    }});
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
  // 일반 초고수는 상대 손패를 고려하지 않는 현재 국면형 판단을 쓴다.
  // 나머지 비열람 탐색 티어는 상대 손패 결정화 표본을 여러 개 평균해 추측 노이즈를 줄인다.
  const selfOnly = !!polTier().self;
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

// Kai'Sa's cheap spells share one outcome comparison. Plans carry target UIDs,
// not a future hand index: each response window rechecks the remaining hand.
const POL_KAISA_SPELLS=[4,9,95,104];
let polKaisaSpellDepth=0;
function polKaisaSpellFriendly(p,n,u){
  if(n!==95 || !polKaisaDeck(p) || u.ctrl!==p) return false;
  // Stupefy resolves before Student's play trigger and lethal cleanup. A wounded
  // Student must survive the -1 itself; a later +1 cannot resurrect it.
  return (u.dmg||0)<Math.max(1,targetMight(u)-1);
}
function polKaisaSpellTargets(p,n){
  const sd=G.showdown;
  let units=everyUnit();
  if(n===4){
    // Assault itself contributes only on attack. On defense a fully resolved
    // spell can still trigger Student or the second-card Darius effect; the
    // engine comparison must prove that benefit rather than adding Assault.
    units=units.filter(u=>u.ctrl===p&&!u.stunned);
  }else if(n===9) units=units.filter(u=>u.ctrl!==p&&u.loc!=='base');
  else if(n===95){
    const enemy=units.some(u=>u.ctrl!==p);
    units=units.filter(u=>u.ctrl!==p||polKaisaSpellFriendly(p,n,u)&&(!enemy||
      u.loc!=='base'&&FX[G.bfs[u.loc].n]?.dreamingTree&&!TF().bf292[p]?.[u.loc]));
  }
  else if(n===104) units=units.filter(u=>u.ctrl===p);
  else return [];
  const cost={energy:applyCostMods(p,card(n),card(n).e||0),pips:powerPips(card(n)),spellOK:true,deferDeflect:true};
  return units.filter(u=>canPayDeflect(p,u,cost)).sort((a,b)=>{
    const local=u=>sd&&u.loc===sd.bfIdx?100:0;
    return local(b)+targetMight(b)-local(a)-targetMight(a);
  }).slice(0,8);
}
function polKaisaSpellCandidates(p,only){
  const seen=new Set(),out=[];
  for(const n of G.players[p].hand){
    if(seen.has(n)||!POL_KAISA_SPELLS.includes(n)||only&&!only.includes(n)) continue;
    seen.add(n);
    if(playRestriction(card(n),p,false)||!polCanPlay(p,card(n))) continue;
    for(const u of polKaisaSpellTargets(p,n)) out.push({kind:'play',n,idx:G.players[p].hand.indexOf(n),kaisaTargets:[u.uid]});
  }
  return out;
}
async function polKaisaSpellRun(p,act){
  const P=G.players[p],idx=P.hand[act.idx]===act.n?act.idx:P.hand.indexOf(act.n);
  const uid=act.kaisaTargets?.[0],u=everyUnit().find(x=>x.uid===uid);
  if(idx<0||!u||!polKaisaSpellTargets(p,act.n).some(x=>x.uid===uid)||playRestriction(card(act.n),p,false))return false;
  const old=POLICY._kaisaSpellTarget;
  POLICY._kaisaSpellTarget={p,tc:G.turnCount,n:act.n,uid};
  try{return await playCardFromHand(p,idx);}
  finally{POLICY._kaisaSpellTarget=old;}
}
async function polKaisaSpellOpenChain(){
  // Resolve pending spells/triggers but stop before the next open combat pass.
  // Action cards are legal again only after this loop leaves an empty chain.
  for(let i=0;i<32 && G.winner===null && G.showdown?.chain.length;i++)await showdownPass();
  if(G.showdown?.chain.length)throw new SimBudget('KaiSa spell chain limit');
}
function polKaisaSpellFinishMaterial(){
  for(const u of everyUnit()){
    // Compare the lasting board after the response/combat is settled. Damage
    // clears together with this-turn Might; never leave impossible survivors.
    u.dmg=0;u.tempM=u.tempM.filter(m=>m.dur!=='turn'&&m.dur!=='combat');
  }
}
function polKaisaSpellBoardKey(){
  return JSON.stringify({winner:G.winner,points:G.players.map(x=>x.points),
    board:everyUnit().map(u=>[u.uid,u.ctrl,u.loc,u.ex,might(u)]),control:G.bfs.map(b=>b.controller)});
}
async function polKaisaSpellProbe(p,plan,finish,observe){
  const old=POLICY._kaisaSpellTarget;
  let replayValue=0;
  try{
    const value=await simTry(p,async()=>{
      POLICY._kaisaSpellTarget=null;
      // Card identities in the remaining composition are known, their order is
      // not. Never optimize a spell plan around the actual next hidden draw.
      G.players[p].deck.sort((a,b)=>a-b);
      UI.pickReaction=async()=>null;
      if(finish)G._rwFor=p;
      for(let i=0;i<plan.length;i++){
        if(await polKaisaSpellRun(p,plan[i])===false)throw new SimBudget('KaiSa spell plan invalid');
        if(i+1<plan.length)await polKaisaSpellOpenChain();
        if(G.winner!==null)break;
      }
      if(finish)await finish();
      else await simSettle(null,POLICY);
      polKaisaSpellFinishMaterial();
      if(observe)observe(polKaisaSpellBoardKey());
      // Replaying a Lecturer has an immediate draw; Kai'Sa needs a later
      // conquest as well. Discount both by printed replay cost and availability
      // instead of treating returned utility as a free second card this turn.
      if(G.winner===null)for(const r of SIM.returned||[]){
        if(r.owner!==p||![39,87].includes(r.n)||G.players[p].hand.filter(n=>n===r.n).length<=r.before)continue;
        const c=card(r.n),runes=G.players[p].runes.length+Math.min(2,G.players[p].runeDeck.length);
        const affordable=runes>=(c.e||0),discount=(affordable?1:0.35)/(1+(c.e||0)/4);
        replayValue+=BOT_W.card*(r.n===87?1:0.5)*discount;
      }
    },POLICY,!!SIM.lock,false);
    return value===null?null:value+replayValue;
  }finally{POLICY._kaisaSpellTarget=old;}
}
async function polKaisaSpellShowdown(p){
  if(!polKaisaDeck(p)||!G.showdown||NET.online||polKaisaSpellDepth||(SIM.movementDepth||0)>=2)return null;
  const candidates=polKaisaSpellCandidates(p);
  if(!candidates.length)return null;
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+Math.min(POLICY.budget||700,1200));
  polKaisaSpellDepth++;
  try{
    let beforeBoard;
    const before=await polKaisaSpellProbe(p,[],null,key=>beforeBoard=key);
    if(before===null)return null;
    let best=null;
    const consider=async plan=>{
      if(Date.now()>SIM.deadline)return;
      let afterBoard;
      const value=await polKaisaSpellProbe(p,plan,null,key=>afterBoard=key);
      const concrete=afterBoard!==beforeBoard||plan.some(a=>a.n===104);
      if(concrete&&value!==null&&value>before+BOT_W.moveNeed&&(!best||value>best.value+1e-6))best={action:plan[0],value,length:plan.length};
    };
    for(const c of candidates)await consider([c]);
    // The first card may be unprofitable alone. Only already-owned second cards
    // count; a cantrip's unknown draw cannot manufacture the second half.
    const pairGroups=new Map();
    for(const first of candidates)for(const second of candidates){
      if(first.n===second.n&&G.players[p].hand.filter(n=>n===first.n).length<2)continue;
      if(first.n===104||second.n===104)continue; // rescuing a unit is evaluated as a complete action
      const key=first.n+':'+second.n;
      if(!pairGroups.has(key))pairGroups.set(key,[]);
      pairGroups.get(key).push([first,second]);
    }
    const groups=[...pairGroups.values()];
    for(const group of groups)group.sort((a,b)=>
      Number(b[0].kaisaTargets[0]===b[1].kaisaTargets[0])-Number(a[0].kaisaTargets[0]===a[1].kaisaTargets[0]));
    // Give every ordered card-type pair a turn before expanding target pairs.
    // Eight Cleave targets must not consume all 96 slots before Ray + Ray.
    // Within a group, cumulative damage to the same UID is tried first.
    let pairs=0;
    for(let offset=0;pairs<96&&Date.now()<=SIM.deadline;offset++){
      let found=false;
      for(const group of groups){
        if(!group[offset])continue;
        found=true;await consider(group[offset]);pairs++;
        if(pairs>=96||Date.now()>SIM.deadline)break;
      }
      if(!found)break;
    }
    if(best)polSay('showdown',card(best.action.n).ko,'카이사 — 주문·대상·후속 주문 결과 비교',{delta:best.value-before,cards:best.length});
    return {handled:true,action:best?.action||null};
  }finally{polKaisaSpellDepth--;SIM.deadline=deadline;}
}
async function polKaisaSpellCycle(p,ctx={}){
  if(!polKaisaDeck(p)||G.turn!==p||G.state!=='neutral'||G.phase!=='action'||NET.online||SIM.lock||polKaisaSpellDepth)return null;
  const P=G.players[p];
  if(!P.hand.includes(95)||P.hand.length>3||!P.deck.length||ctx.tried?.has('h95'))return null;
  // A cycle must leave a real response budget and useful new-card spending room.
  const reserve=P.hand.some(n=>n===9||n===104)?1:0;
  if(readyRunes(p).length+(P.energy||0)+(P.energySpell||0)<3+reserve)return null;
  const candidates=polKaisaSpellCandidates(p,[95]);if(!candidates.length)return null;
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+400);
  polKaisaSpellDepth++;
  try{
    const before=await polKaisaSpellProbe(p,[]);if(before===null)return null;
    let best=null;
    for(const act of candidates){
      if(Date.now()>SIM.deadline)break;
      const value=await polKaisaSpellProbe(p,[act]);
      // A one-for-one cantrip converts otherwise idle energy into a fresh draw.
      // The small option value is not awarded to a dead/deckless target or a
      // spent response reserve; substantial board/control losses still dominate.
      const rank=value===null?-Infinity:value+0.12;
      if(rank>before+BOT_W.moveNeed&&(!best||rank>best.rank))best={act,rank};
    }
    return best?.act||null;
  }finally{polKaisaSpellDepth--;SIM.deadline=deadline;}
}
async function polKaisaSpellReaction(p,options,pending){
  if(!polKaisaDeck(p)||G.showdown||!pending||pending.p===p||NET.online||SIM.lock||polKaisaSpellDepth)return null;
  const trigger=everyUnit().some(u=>u.ctrl===p&&(u.n===103||u.n===27&&G.players[p].playedSeq===1));
  const opts=options.filter(o=>Number.isInteger(o.v?.hand)&&
    (o.card?.n===104||o.card?.n===95&&trigger));
  if(!opts.length)return null;
  const original=G,had=Object.hasOwn(original,'_returnPending'),prior=original._returnPending;
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+700);polKaisaSpellDepth++;
  try{
    original._returnPending=pending;
    const finish=async()=>{G._rwFor=null;await polResolveReturnPending();await cleanup(pending.p);};
    const before=await polKaisaSpellProbe(p,[],finish);if(before===null)return null;
    let best=null;
    for(const o of opts){
      for(const u of polKaisaSpellTargets(p,o.card.n)){
        if(Date.now()>SIM.deadline)break;
        const act={kind:'play',idx:o.v.hand,n:o.card.n,kaisaTargets:[u.uid]};
        const value=await polKaisaSpellProbe(p,[act],finish);
        if(value!==null&&value>before+BOT_W.moveNeed&&(!best||value>best.value))best={o,act,value};
      }
    }
    if(best){
      // Engine executes a reaction's hand option directly, without runAction.
      // Scope the reservation to this exact pending event and this response window.
      POLICY._kaisaSpellTarget={p,tc:G.turnCount,n:best.act.n,uid:best.act.kaisaTargets[0],pending};
      return {handled:true,value:best.o.v};
    }
    return {handled:true,value:null};
  }finally{
    if(had)original._returnPending=prior;else delete original._returnPending;
    polKaisaSpellDepth--;SIM.deadline=deadline;
  }
}

// Kai'Sa uses the actual engine for extra turns, acceleration and deployment
// rotations. These helpers are deliberately separate from the generic policy:
// their candidates never change another legend or difficulty's action space.
let polKaisaTurnDepth=0;
function polKaisaTurnAllowed(p){
  return polKaisaDeck(p)&&!NET.online&&!SIM.active&&!polKaisaTurnDepth&&
    G.turn===p&&G.phase==='action'&&G.state==='neutral'&&G.winner===null;
}
function polKaisaTurnCard(act,p){
  return act?.kind==='champ'?G.players[p].champN:act?.n;
}
// Fast fallback used when no explicit candidate survived the planning budget.
// It is conservative: ready entry needs a visible use this turn, not merely
// enough runes. The bounded engine comparison above this fallback is preferred.
function polKaisaTurnConfirm(p,text,c,context){
  if(!polKaisaDeck(p)||![39,116].includes(c?.n)||
    !(context?.decision?.title==='가속'||/^\[가속\]/.test(String(text))))return undefined;
  if(G.turn!==p||G.phase!=='action')return false;
  const old=G;
  try{
    G=cloneG(G);
    if(c.n===116)for(const u of everyUnit().filter(u=>u.ctrl!==p))
      u.tempM.push({v:Math.max(1,might(u)-3)-might(u),dur:'turn'});
    const u={n:c.n,uid:-987654,ctrl:p,owner:p,loc:'base',ex:false,stunned:false,dmg:0,buff:0,tempM:[],grants:{},gear:[],isToken:false,turnMoves:0};
    const ready=G.players[p].base.filter(x=>!x.ex&&!x.stunned);
    const empty=G.bfs.filter(b=>b.controller!==p&&!b.units.some(x=>x.ctrl!==p)).length;
    if(empty>ready.length)return true;
    for(let i=0;i<G.bfs.length;i++){
      if(G.bfs[i].controller===p)continue;
      let before=-Infinity,after=evalAttackValue(p,i,[u]);
      const send=[];
      for(const r of [...ready].sort((a,b)=>might(b)-might(a))){
        send.push(r);before=Math.max(before,evalAttackValue(p,i,send));
        after=Math.max(after,evalAttackValue(p,i,[u,...send]));
      }
      if(after>0.1&&after>Math.max(0,before)+0.45)return true;
    }
    return false;
  }finally{G=old;}
}
// This is also the live execution contract. The rest of the engine still owns
// costs, legal locations, triggers and whether acceleration can be offered.
async function polKaisaTurnRun(p,act){
  if(!act) return false;
  if(act.kind==='move'){
    const ids=(act.units||[]).map(u=>u.uid);
    const units=everyUnit().filter(u=>ids.includes(u.uid));
    if(units.length!==ids.length) return false;
    return moveUnits(p,units,act.dest);
  }
  if(act.kind!=='play'&&act.kind!=='champ')
    return act.run?act.run():POLICY.runAction(p,act);
  const n=polKaisaTurnCard(act,p), P=G.players[p];
  const index=act.kind==='champ'?-1:(P.hand[act.idx]===n?act.idx:P.hand.indexOf(n));
  if(act.kind!=='champ'&&index<0) return false;
  const confirm=UI.confirmP;
  if(typeof act.kaisaAccel==='boolean') UI.confirmP=(q,t,c,context)=>
    q===p&&c?.n===n&&(context?.decision?.title==='가속'||/^\[가속\]/.test(t))
      ?Promise.resolve(act.kaisaAccel):confirm(q,t,c,context);
  try{
    const opts=act.kind==='champ'?{champZone:true}:{};
    if(Object.hasOwn(act,'kaisaPlayLoc')) opts.playLoc=act.kaisaPlayLoc;
    return await playCardFromHand(p,index,opts);
  }finally{UI.confirmP=confirm;}
}
function polKaisaTurnPublicSample(p,sample=0){
  // Preserve the known remaining composition, never the live unknown order.
  const deck=[...G.players[p].deck].sort((a,b)=>a-b);
  let seed=((G.turnCount+1)*4099+p*131+(sample+1)*17)>>>0;
  for(let i=deck.length-1;i>0;i--){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const j=seed%(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];
  }
  G.players[p].deck=deck;
  const O=G.players[opp(p)];
  O.hand=O.hand.map(()=>13);O.deck=O.deck.map(()=>13);
  // Neutral response windows must not select the actual concealed cards.
  UI.pickReaction=async()=>null;
  POLICY.turnPlan=null;
}
function polKaisaTurnFieldValue(p){
  if(G.winner!==null) return 0;
  // These probes have already resolved the visible attack/counterattack. Do
  // not pay an extra resource merely to station a 7-Might body where a 2-Might
  // holder achieved exactly the same control and survived. Generic evalState's
  // location/margin premiums otherwise double-count that completed combat.
  let position=0;
  for(const b of G.bfs){
    const mine=b.units.filter(u=>u.ctrl===p).reduce((s,u)=>s+might(u),0);
    const theirs=b.units.filter(u=>u.ctrl!==p).reduce((s,u)=>s+might(u),0);
    position-=(mine-theirs)*(BOT_W.unitBf-BOT_W.unitBase);
    position-=BOT_W.bfMargin*Math.tanh((mine-theirs)/3);
  }
  const worth=q=>G.bfs.reduce((s,b)=>{
    if(b.controller!==q||!b.units.some(u=>u.ctrl===q&&!effKw(u).temporary))return s;
    if(b.n===280) return s+(G.players[q].hand.length<6?BOT_W.card:BOT_W.cardGlut)*0.65;
    if(b.n===288&&G.players[q].runeDeck.length) return s+(BOT_W.runeTotal-BOT_W.runeDeck)*0.65;
    return s;
  },0);
  return position+worth(p)-worth(opp(p));
}
async function polKaisaTurnMoves(p,count){
  for(let m=0;m<count&&G.winner===null&&G.turn===p&&G.state==='neutral';m++){
    if(SIM.deadline&&Date.now()>SIM.deadline) throw new SimBudget('deadline');
    const move=POLICY.movePlan(p);if(!move)break;
    const before=simHash(G);
    await moveUnits(p,move.units,move.dest);await simSettle(p,POLICY);
    if(simHash(G)===before)break;
  }
}
async function polKaisaTurnOpponentMoves(p){
  const o=opp(p);
  // Only the publicly visible army can move. No opponent hand cards are played.
  for(let i=0;i<2&&G.winner===null&&G.turn===o&&G.phase==='action'&&G.state==='neutral';i++){
    const move=POLICY.movePlan(o);if(!move)break;
    const before=simHash(G);
    await moveUnits(o,move.units,move.dest);await simSettle(p,POLICY);
    if(simHash(G)===before)break;
  }
}
async function polKaisaTurnActions(p,ctx){
  const local={...ctx,tried:new Set(ctx.tried||[]),tc:G.turnCount};
  if(typeof polKaisaSequencePlan==='function'&&(SIM.movementDepth||0)<1){
    const sequence=await polKaisaSequencePlan(p,local,{inTurnProbe:true,maxMs:200});
    if(sequence?.kaisaSequenceSteps&&typeof polKaisaSequencePreview==='function'){
      if(await polKaisaSequencePreview(p,sequence)===false)throw new SimBudget('KaiSa sequence changed');
      local.movesLeft=Math.max(0,local.movesLeft-sequence.kaisaSequenceSteps.filter(a=>a.kind==='move').length);
    }
  }
  for(let i=0;i<10&&G.winner===null&&G.turn===p&&G.phase==='action';i++){
    if(SIM.deadline&&Date.now()>SIM.deadline)throw new SimBudget('deadline');
    const before=simHash(G);
    if(await POLICY.step(p,local))return;
    await simSettle(p,POLICY);
    if(simHash(G)===before)return;
  }
  if(G.winner===null&&G.turn===p&&G.phase==='action')throw new SimBudget('KaiSa action horizon');
}
async function polKaisaTurnProbe(p,ctx,act,options={}){
  let result=null;
  const value=await simTry(p,async()=>{
    polKaisaTurnPublicSample(p,options.sample||0);
    const originalDraw=drawCard;
    // A certainty probe may still receive the draw's hand-count value, but it
    // cannot spend an unknown drawn card. Known starting cards stay playable.
    if(options.knownHandOnly)drawCard=function(q,silent){
      const before=G.players[q].hand.length,result=originalDraw(q,silent);
      if(q===p&&G.players[q].hand.length>before)G.players[q].hand[G.players[q].hand.length-1]=122;
      return result;
    };
    try{
    const startPoints=G.players[p].points;
    let moveCount=act?.kind==='move'?1:0;
    if(act?.kaisaSequenceSteps&&typeof polKaisaSequencePreview==='function'){
      const preview=await polKaisaSequencePreview(p,act);
      if(preview===false)return;
      moveCount=act.kaisaSequenceSteps.filter(a=>a.kind==='move').length;
    }else if(act&&act.kind!=='end'){
      const runnable=act.kind==='move'?{...act,units:(act.units||[]).map(u=>everyUnit().find(x=>x.uid===u.uid)).filter(Boolean)}:act;
      if(act.kind==='move'&&runnable.units.length!==(act.units||[]).length)return;
      if(await (act.run?act.run():POLICY.runAction(p,runnable))===false)return;
    }
    await simSettle(p,POLICY);
    // A garrison play is one live action. Its possible next return is previewed
    // here, then re-evaluated against the real board on the following decision.
    if(act?.kaisaReturnAfter&&G.winner===null&&G.turn===p&&G.state==='neutral'){
      const u=everyUnit().find(u=>u.uid===act.kaisaReturnAfter&&u.ctrl===p&&!u.ex&&!u.stunned);
      if(u&&u.loc!=='base'&&G.bfs[u.loc].units.some(x=>x.ctrl===p&&x!==u)){
        if(await moveUnits(p,[u],'base')!==false)moveCount++;
        await simSettle(p,POLICY);
      }
    }
    const remaining=Math.max(0,Math.min(4,(ctx.movesLeft??3)-moveCount));
    if(options.playOutCurrent)await polKaisaTurnActions(p,{...ctx,movesLeft:remaining});
    else if(!options.quick)await polKaisaTurnMoves(p,remaining);
    if(G.winner===null&&G.turn===p&&G.phase==='action')await endTurn();
    await simSettle(p,POLICY);
    if(options.extra){
      for(let extraTurn=0;extraTurn<3&&G.winner===null&&G.turn===p&&G.phase==='action';extraTurn++){
        const extra=POLICY.newCtx();POLICY.syncCtx(extra);
        await polKaisaTurnActions(p,extra);
        if(G.winner===null&&G.turn===p&&G.phase==='action')await endTurn();
        await simSettle(p,POLICY);
      }
      if(G.winner===null&&G.turn===p)throw new SimBudget('KaiSa extra-turn horizon');
    }
    if(options.counterplay&&G.winner===null)await polKaisaTurnOpponentMoves(p);
    const raw=evalState(G,p);
    const sequenceBonus=G.winner===null?(typeof polKaisaSequenceRoles==='function'?polKaisaSequenceRoles(p):0)+
      (typeof polKaisaSequenceReserve==='function'?polKaisaSequenceReserve(p):0):0;
    result={value:G.winner!==null?raw:raw+polKaisaTurnFieldValue(p)+sequenceBonus,won:G.winner===p,
      lost:G.winner===opp(p),points:G.players[p].points,pointsGained:G.players[p].points-startPoints,
      holds:evalHolds(p),turn:G.turn,tc:G.turnCount,hand:G.players[p].hand.length};
    }finally{drawCard=originalDraw;}
  },POLICY,false,false);
  return value===null?null:result;
}
// This is called before generic turn planning: immediate hold wins must not
// lose their ten energy to a cheap unit or lose the planning budget first.
async function polKaisaWarpChoice(p,ctx){
  if(!polKaisaTurnAllowed(p))return null;
  const P=G.players[p],idx=P.hand.indexOf(122);
  if(idx<0||ctx.tried?.has('h122')||!polCanPlay(p,card(122))||playRestriction(card(122),p,false))return null;
  const deadline=SIM.deadline;
  SIM.deadline=Math.min(deadline||Infinity,Date.now()+1500);
  polKaisaTurnDepth++;
  try{
    const act={kind:'play',idx,n:122};
    if(evalHoldForecast(p).win&&G.extraTurns?.[0]!==p){
      const quick=await polKaisaTurnProbe(p,ctx,act,{quick:true});
      if(quick?.won){polSay('kaisa-warp','시간 왜곡','추가 턴 유지로 즉시 승리');return {...act,kaisaWin:true};}
    }
    const samples=new Set(P.deck).size>1?2:1;
    const deltas=[];let allWon=true,allSafe=true;
    for(let sample=0;sample<samples;sample++){
      if(Date.now()>SIM.deadline)return null;
      const base=await polKaisaTurnProbe(p,ctx,null,{sample,extra:true,playOutCurrent:true});
      const future=await polKaisaTurnProbe(p,ctx,act,{sample,extra:true,playOutCurrent:true});
      if(!base||!future)return null;
      if(base.won)return null;
      allWon=allWon&&future.won;allSafe=allSafe&&!future.lost;
      deltas.push(future.won?20:future.value-base.value);
    }
    const gain=deltas.reduce((a,b)=>a+b,0)/deltas.length;
    if(allWon||(allSafe&&Math.min(...deltas)>0.02&&gain>0.55)){
      const proof=allWon?await polKaisaTurnProbe(p,ctx,act,{extra:true,playOutCurrent:true,knownHandOnly:true}):null;
      const proven=!!proof?.won;
      polSay('kaisa-warp','시간 왜곡',proven?'알고 있는 카드와 추가 턴 행동으로 승리':allWon?'추가 드로우 표본에서 승리 기회':'같은 상대 행동 시작 시점에서 추가 턴 비교',{gain,samples,drawDependent:allWon&&!proven});
      return {...act,kaisaWin:proven,kaisaDrawDependent:allWon&&!proven};
    }
    return null;
  }finally{polKaisaTurnDepth--;SIM.deadline=deadline;}
}
function polKaisaTurnCandidates(p,ctx,core){
  const P=G.players[p], candidates=[],seen=new Set();
  const select=()=>{
    // A target-rich spell must not consume the whole cap before deployment or
    // preservation is represented. Deal one candidate per family per round;
    // keep each unit's accelerate/non-accelerate pair in the same first round.
    const chosen=core&&candidates.includes(core)?[core]:[],groups=new Map();
    for(const a of candidates){
      if(a===core)continue;
      let key,rank,batch=1;
      if(a.kind==='move'&&a.dest==='base'){key='return';rank=0;}
      else if(a.kaisaReturnAfter){key='garrison';rank=1;}
      else if(a.kind==='move'){key='conquer';rank=2;}
      else if(typeof a.kaisaAccel==='boolean'){key='enter:'+a.kind+':'+a.n;rank=3;batch=2;}
      else if(a.kaisaTargets){key='spell:'+a.n;rank=4;}
      else{key='other';rank=5;}
      if(!groups.has(key))groups.set(key,{items:[],rank,batch});
      groups.get(key).items.push(a);
    }
    const ordered=[...groups.values()].sort((a,b)=>a.rank-b.rank);
    while(chosen.length<12){
      let added=false;
      for(const group of ordered){
        for(let k=0;k<group.batch&&group.items.length&&chosen.length<12;k++){
          chosen.push(group.items.shift());added=true;
        }
      }
      if(!added)break;
    }
    return chosen;
  };
  const add=a=>{
    const key=a.kind+':'+(a.n??'')+':'+String(a.kaisaAccel)+':'+String(a.kaisaPlayLoc)+':'+String(a.dest)+':'+
      (a.units||[]).map(u=>u.uid).sort((a,b)=>a-b).join(',')+':'+(a.kaisaReturnAfter||'')+':'+(a.kaisaTargets||[]).join(',');
    if(!seen.has(key)){seen.add(key);candidates.push(a);}
  };
  if(core&&core.kind!=='end')add(core);
  // Ray + an ordinary weak attack needs no Student/Darius/Legion trigger.
  // Preserve explicit target UIDs through the same live spell dispatcher.
  if(typeof polKaisaSpellCandidates==='function')for(const a of polKaisaSpellCandidates(p,[9,95])){
    if(!ctx.tried?.has('h'+a.n))add(a);
  }
  const cards=[...new Set(P.hand.filter(n=>n===39||n===116))].map(n=>({kind:'play',idx:P.hand.indexOf(n),n}));
  if(P.champInZone&&[39,116].includes(P.champN)&&!ctx.tried?.has('champ'))cards.push({kind:'champ',n:P.champN});
  for(const a of cards){
    if(ctx.tried?.has('h'+a.n)||!polCanPlay(p,card(a.n)))continue;
    add({...a,kaisaAccel:false});
    const c=card(a.n),e=applyCostMods(p,c,c.e||0)+1,pips=[...powerPips(c),c.dom?.length===1?c.dom[0]:'Any'];
    if(canPay(p,e,pips,false)||polResourceFundingPlan(p,e,pips,false)!==null)add({...a,kaisaAccel:true});
  }
  if((ctx.movesLeft??3)<=0)return select();
  const ready=everyUnit().filter(u=>u.ctrl===p&&!u.ex&&!u.stunned);
  for(const u of ready.filter(u=>u.loc==='base'&&u.n===39)){
    for(let dest=0;dest<G.bfs.length;dest++){
      const b=G.bfs[dest];
      if(b.controller!==p&&!b.units.some(x=>x.ctrl!==p))add({kind:'move',units:[u],dest});
    }
  }
  for(const u of ready.filter(u=>u.loc!=='base'&&(u.n!==27||P.playedSeq>=2)&&(u.n===39||evalMaterialMight(u)>=4))){
    const b=G.bfs[u.loc];
    if(b.n===BF_STATIC.NO_RETREAT||b.controller!==p||polThreatAt(p,u.loc)<=0.05)continue;
    add({kind:'move',units:[u],dest:'base'});
    // Legal unit placement can leave a cheap holder before the valuable unit
    // returns. A fresh unit never gains a free standard move in this preview.
    for(const n of [...new Set(P.hand)].filter(n=>card(n).type==='Unit'&&(card(n).m||0)<=3&&(card(n).e||0)<=3)){
      if(ctx.tried?.has('h'+n)||!polCanPlay(p,card(n)))continue;
      if(!unitPlayLocationOptions(p,n).some(o=>o.v===u.loc))continue;
      add({kind:'play',n,idx:P.hand.indexOf(n),kaisaPlayLoc:u.loc,kaisaReturnAfter:u.uid});
    }
  }
  return select();
}
async function polKaisaTurnChoice(p,ctx,core){
  if(!polKaisaTurnAllowed(p))return core;
  const candidates=polKaisaTurnCandidates(p,ctx,core);
  if(!candidates.length||(candidates.length===1&&candidates[0]===core))return core;
  const deadline=SIM.deadline;
  SIM.deadline=Math.min(deadline||Infinity,Date.now()+1000);
  polKaisaTurnDepth++;
  try{
    const base=await polKaisaTurnProbe(p,ctx,core,{counterplay:true});
    if(!base)return core;
    let best=null;
    for(const act of candidates){
      if(act===core||Date.now()>SIM.deadline)continue;
      const result=await polKaisaTurnProbe(p,ctx,act,{counterplay:true});
      if(!result||result.value<=base.value+0.04)continue;
      if(!best||result.value>best.value+0.04)best={act,...result};
    }
    if(best){
      polSay('kaisa-turn',best.act.kind==='move'?(best.act.dest==='base'?'기지 복귀':'카이사 정복'):card(polKaisaTurnCard(best.act,p)).ko,
        '가속·주둔·공개 반격을 같은 종료 시점에서 비교',{gain:best.value-base.value});
      return best.act;
    }
    return core;
  }finally{polKaisaTurnDepth--;SIM.deadline=deadline;}
}
