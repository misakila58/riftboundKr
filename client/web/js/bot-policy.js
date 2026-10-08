// ══════════ 봇 정책층 (POLICY) ══════════
// 봇의 "선택"을 한곳에 모은 순수 판단 모듈.
//  · DOM·타이머·window에 의존하지 않는다 → 브라우저와 Node 셀프플레이 러너가 같은 파일을 쓴다.
//    (bot.js와 tools/selfplay.js가 각자 사본을 들면 반드시 어긋나므로, 판단은 전부 여기 둔다)
//  · G를 읽기만 한다. 상태를 바꾸지 않는다.
//  · Math.random 대신 결정론 해시를 쓴다 — 같은 국면이면 같은 선택(재현·디버깅 가능).
//  · 엔진 rng()는 절대 호출하지 않는다 (_rngState를 전진시키면 리플레이·락스텝이 깨진다).

const POLICY = {
  // 기존 버프 개수 판단과 소모 순서를 유지한다. 사람은 같은 결과를 유닛별로 고른다.
  buffs(p,title,candidates,context){
    if(context?.op?.op==='albus'&&polSmart()) return polAlbusBuffChoice(p,candidates);
    if(context?.cardN===150){
      const plan=POLICY._buffPaymentPlan;
      if(plan?.n===150&&plan.p===p&&plan.picks)return plan.picks.filter(x=>
        candidates.some(u=>u.uid===x.uid&&u.buff>=x.count&&u.dmg<might(u)-x.count));
      const c=card(150),{pips:base,energy:e}=polBasePlayCost(p,c,context.playOpts);
      const safe=candidates.filter(u=>u.dmg<might(u)-1).sort((a,b)=>Number(a.loc!=='base')-Number(b.loc!=='base')||might(a)-might(b));
      let count=0;
      while(count<Math.min(safe.length,base.length)&&!canPay(p,e,base.slice(0,base.length-count)))count++;
      return safe.slice(0,count).map(u=>({uid:u.uid,count:1}));
    }
    const total=candidates.reduce((s,u)=>s+u.buff,0);
    let left=POLICY.number(p,title,0,total)||0;
    const picks=[];
    for(const u of candidates){const count=Math.min(left,u.buff);if(count>0)picks.push({uid:u.uid,count});left-=count;if(!left)break;}
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
    const ending=timeLeft()?await polNextTurnOutcome(p):null;
    if(ending?.won) return {kind:'end'};
    if(typeof polKaisaWarpChoice==='function'){
      const warp=await polKaisaWarpChoice(p,ctx);
      if(warp) return warp;
    }
    let emergency=null;
    if(timeLeft()&&(ending?ending.lost:POLICY.race(p).oppLethal)){
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
    (['damage','damageAll','kill','stun','dealSplit','dmgEqMyMight','dmgLastDiscardCost','guillotine','extortion','foxfire'].includes(op.op)
      || op.op==='might' && op.n<0);
}
function polOffensivePlayable(p,n,bfIdx,fromHidden=false,paymentCost){
  if(card(n).type!=='Spell') return true;
  const fx=FX[n]||{}, saved=[_ctxBf,_hiddenBf,_ctxUnit,_curKind];
  _ctxBf=bfIdx??null; _hiddenBf=fromHidden&&!fx.hiddenFreeTarget?bfIdx:null;
  _ctxUnit=null; _curKind='spell';
  try{
    const c=card(n), cost=paymentCost|| (fromHidden?{energy:0,pips:[],spellOK:true}:
      {energy:applyCostMods(p,c,c.e||0),pips:powerPips(c),spellOK:true});
    const prev=[];
    for(const group of fx.playOps||[]){
      if(group.legion && G.players[p].playedCards<1) continue;
      for(const op of group.ops||[]){
        if(op.op==='eachPlayerKills' && !everyUnit().length) return false;
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

// 선택 추가 비용은 엔진과 같은 순서로 할인한 뒤 비용 수정을 적용한다.
function polBasePlayCost(p,c,opts={}){
  return {energy:opts.ignoreEnergy?0:Math.max(0,applyCostMods(p,c,opts.fromHidden?0:(c.e||0))-(opts.discountE||0)),
    pips:opts.fromHidden||opts.ignorePower?[]:powerPips(c)};
}
function polLedrosSacrifices(p,c,opts={}){
  const cost=polBasePlayCost(p,c,opts),picks=[];
  if(G.players[p].gear.some(g=>FX[g.n]?.zhonya))return canPay(p,cost.energy,cost.pips)?[]:null;
  const candidates=everyUnit().filter(u=>u.ctrl===p&&!u._highlander).sort((a,b)=>evalCombatRemovalValue(a)-evalCombatRemovalValue(b));
  let loss=0;
  for(const u of candidates){
    if(canPay(p,cost.energy,cost.pips.slice(0,Math.max(0,cost.pips.length-picks.length))))return picks;
    loss+=evalCombatRemovalValue(u);
    // 여러 작은 유닛도 합치면 큰 병력이다. 새 유닛보다 비싼 희생은 하지 않는다.
    if(loss>=1+(c.m||0)+(c.e||0)*0.08)return null;
    picks.push(u);
  }
  return canPay(p,cost.energy,cost.pips.slice(0,Math.max(0,cost.pips.length-picks.length)))?picks:null;
}
function polAlternativePlayCost(p,c){
  const ac=FX[c.n]?.addCost;
  if(ac?.optional===false) return null;
  if(ac?.kind==='spendBuff' && ac.ignoreCost){
    if(!everyUnit().some(u=>u.ctrl===p && u.buff>0 && u.dmg<might(u)-1)) return null;
    return {energy:applyCostMods(p,c,0),pips:[]};
  }
  if(ac?.kind==='spendBuffs' && ac.pipDiscountPer){
    const safe=everyUnit().filter(u=>u.ctrl===p&&u.buff>0&&u.dmg<might(u)-1).length;
    return safe?{energy:applyCostMods(p,c,c.e||0),pips:powerPips(c).slice(0,Math.max(0,powerPips(c).length-safe))}:null;
  }
  if(ac?.kind==='killUnits' && ac.pipDiscountPer){
    const sacrifices=polLedrosSacrifices(p,c)?.length||0;
    return sacrifices?{energy:applyCostMods(p,c,c.e||0),pips:powerPips(c).slice(0,Math.max(0,powerPips(c).length-sacrifices))}:null;
  }
  if(ac?.kind==='discard' && ac.discountE){
    const hand=G.players[p].hand;
    if(hand.length-(hand.includes(c.n)?1:0)<1) return null;
    return {energy:applyCostMods(p,c,Math.max(0,(c.e||0)-ac.discountE)),pips:powerPips(c)};
  }
  return null;
}
function polCanPlay(p, c, allowFunding=true){
  try {
    if(FX[c.n]?.addCost?.kind==='killUnit'&&!everyUnit().some(u=>u.ctrl===p))return false;
    const spellOK=c.type==='Spell';
    const targetPips=spellOK?polSpellTargetPips(p,c):[];
    if(targetPips===null) return false;
    const costs=[{energy:applyCostMods(p,c,c.e||0),pips:powerPips(c)}];
    const alternate=polAlternativePlayCost(p,c);
    if(alternate) costs.push(alternate);
    return costs.some(({energy:e,pips})=>{
      const paymentPips=[...pips,...targetPips];
      const payable=()=>{
        if(!canPay(p,e,paymentPips,spellOK) || !polOffensivePlayable(p,c.n,undefined,false,{energy:e,pips,spellOK})) return false;
        if(polMfAuroraDeck(p) && c.n===180 && !polMfMemoryTargets(p,
          {energy:e,pips,spellOK}).length) return false;
        if(spellOK && typeof spellHasTargets==='function' && !(FX[c.n]&&(FX[c.n].counter||FX[c.n].steal)))
          return spellHasTargets(c.n,p,undefined,false,{energy:e,pips,spellOK});
        return true;
      };
      if(payable()) return true;
      return allowFunding && !!polResourceFundingPlan(p,e,paymentPips,spellOK,payable);
    });
  } catch(err){ return false; }
}
function polCost(c){ return (c.e||0) + powerPips(c).length; }

// 미스 포츈 오로라 컨트롤의 핵심 엔진.
// 일반 카드 가치만으로 판단하면 9비용 오로라는 멀리건하고, 값싼 유닛/도구를 먼저 내느라
// 동원 → 억겁의 카탈리스트 → 눈부신 오로라의 3턴 가속선을 놓친다. 상대 패를 보지 않는
// master에서만 이 공개된 덱 플랜을 사용한다(다른 난이도와 덱의 기존 성향은 유지).
const POL_MF = { legend:267, mobilize:134, catalyst:138, aurora:160, stacked:183, invert:201, bulletTime:268 };
// 상대 손패를 본 뒤 제거할 카드의 미스 포츈 전용 위협도.
// 오로라 제거는 실제 성공 가능성이 높은 순서(전부/직접 처치 → 지연·대칭 → 조건부)다.
const POL_MF_HAND_ATTACK = new Map([
  [156,220],  // 파괴 공작: 저비용으로 손패의 오로라를 끊을 수 있음
  [192,200],  // 정신 분쇄자: 7비용 유닛이라 대응까지 시간이 더 있음
]);
const POL_MF_AURORA_HATE = new Map([
  [22,600],   // 발열 광선: 모든 도구 폐기
  [224,560],  // 인양: 도구 하나 직접 폐기
  [180,520],  // 바래지는 기억: 도구에 [일시적]
  [179,480],  // 허용 손실: 각자 도구 하나 폐기
  [56,400],   // 적응형 기기: 정복해야 도구 폐기
  [244,250],  // 신성한 심판: 도구가 2개를 넘을 때 재활용
]);
function polMfAuroraDeck(p){
  return POLICY.level === 'master' && G.players[p].legendN === POL_MF.legend;
}
function polMfAuroraOnline(p){
  return G.players[p].gear.some(g => g.n === POL_MF.aurora);
}

// 바래지는 기억: 아군 희생 조합은 아직 평가하지 않으므로 적 제거에만 쓴다.
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

// 속임수 덱 선택용 짧은 자원 시뮬레이션. 현재 행동 단계에서 손패의 동원/촉매를
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
  if(TF().preventSpellDmg) return null;
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
  if(TF().preventSpellDmg) return null;
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

// 개입 자체의 정적 공격 예상 대신 같은 능력 비용과 실제 후속 이동을 비교한다.
// 공격 격발, 이동 격발, 합류 병력과 떠나는 전장의 손실도 기존 엔진 평가에 맡긴다.
async function polMfGankTarget(p,c,ctx){
  if(G.players[p].legendN!==POL_MF.legend||!polHard()||NET.online||polPaidChoiceDepth||(SIM.movementDepth||0)>=2||
      ctx?.movesLeft<=0&&!polMfExtraMove(p))return null;
  const candidates=everyUnit().filter(u=>u.ctrl===p&&u.loc!=='base'&&!u.ex&&!effKw(u).ganking)
    .sort((a,b)=>might(b)-might(a));
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+700);
  let best=null;
  try{
    for(const target of candidates){
      if(Date.now()>SIM.deadline)break;
      const gain=await polPaidActionGain(p,()=>POLICY.runAction(p,{
        kind:'ability',src:c.src,ab:c.ab,mfGankUid:target.uid}),ctx,{counterplay:true});
      if(gain!==null&&gain>BOT_W.moveNeed&&(!best||gain>best.gain+1e-7))best={target,gain};
    }
    return best?.target||null;
  }finally{SIM.deadline=deadline;}
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
  return ops.some(o=>['challenge','facebreaker','itDealsTo','fightMutual','stunOrKillIt'].includes(o.op))?ops:null;
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
    if(op.op==='chooseUnit')it=us[0]||null;
    else if(op.op==='ready'){
      it=us[0]||null;
      if(it?.ex) score+=(it.ctrl===p?1:-1)*targetMight(it)*0.002;
    }else if(op.op==='itDealsTo') hit(us[0],it?targetMight(it):0);
    else if(op.op==='challenge'){
      if(us[0]&&us[1]){hit(us[1],targetMight(us[0]));hit(us[0],targetMight(us[1]));}
    }else if(op.op==='fightMutual'){
      if(it&&ctx.unit){hit(it,targetMight(ctx.unit));hit(ctx.unit,targetMight(it));}
    }else if(op.op==='stunOrKillIt'){
      if(it)score+=(it.ctrl===p?-1:1)*targetMight(it)*(it.stunned?10:0.01);
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

// Special scripts still use the rules engine. Compare their announced target
// and their actual cost choices rather than treating the op name as no effect.
let polSpecialChoiceDepth=0;
async function polSpecialEffectProbe(p,selection,value,discardN,publicSample){
  const ctx=selection.ctx||{p},op=selection.op,gears=G.players.map(P=>P.gear);
  const gearIndex=value?.g?gears[value.pi].indexOf(value.g):value?.i;
  let applied=false;
  const result=await simTry(p,async()=>{
    if(publicSample){
      polKaisaTurnPublicSample(p,publicSample.sample);
      G.players[p].runeDeck=[...publicSample.runes.own.order];
      G.players[opp(p)].runeDeck=[...publicSample.runes.other.order];
    }
    const target=value?.g?{...value,g:G.players[value.pi].gear[gearIndex]}:value;
    const pre=new Map(selection.pre||[]);pre.set(op,target);
    const P=G.players[p],legionOK=P.playedCards>=1;
    // Declaration happens before the spell leaves hand. Do not let it pay
    // its own discard, or leave its hand-card value in the target comparison.
    if(ctx.n!==undefined && card(ctx.n).type==='Spell'){
      const idx=P.hand.indexOf(ctx.n);if(idx>=0)P.hand.splice(idx,1);
    }
    if(selection.cost){
      const cost=selection.cost,uid=value?.t==='u'?value.uid:typeof value==='number'&&!preTargetSpecs(op).some(s=>s.battlefield)?value:null;
      const u=everyUnit().find(x=>x.uid===uid);
      const pips=[...(cost.pips||[]),...(cost.noDeflect?[]:deflectPips(p,u))];
      if(!canPay(p,cost.energy||0,pips,!!cost.spellOK))return;
      payCost(p,cost.energy||0,pips,true,!!cost.spellOK);
    }
    if(discardN!==undefined){
      const handPick=UI.pickHandCard;
      UI.pickHandCard=(q,t,x)=>q===p&&x?.ops?.some(o=>o.op==='dmgLastDiscardCost')?
        G.players[p].hand.indexOf(discardN):handPick(q,t,x);
    }
    const unit=ctx.unit?everyUnit().find(u=>u.uid===ctx.unit.uid):undefined;
    await execOps(selection.ops||[op],{...ctx,p,unit,pre,legionOK,resolvingSpell:ctx.resolvingSpell||{n:ctx.n,owner:p}});
    applied=true;
    await cleanup(p);
    if(['tideTurner','ready'].includes(op.op)&&G.showdown?.resolvingItem){
      // The pending on-play choice finishes before the remaining combat chain.
      const sd=G.showdown;sd.resolvingItem=false;await flushCombatTriggers(sd);sd.passes=0;
      if(sd.chain.length)G.actingPlayer=sd.chain[sd.chain.length-1].p;
    }
    await simSettle(null,POLICY);
    if(G.turn===p&&G.phase==='action'&&G.state==='neutral'&&G.winner===null){
      POLICY.turnPlan=null;
      const activeCtx=typeof BOT!=='undefined'&&BOT.seat===p?BOT.ctx:null;
      const moves=typeof activeCtx?.movesLeft==='number'?activeCtx.movesLeft:polTier().moves;
      if(op.op==='ready'){
        const planCtx={tried:new Set(),movesLeft:moves};
        const ability=await POLICY.abilityPlan(p,planCtx,false)||await POLICY.abilityPlan(p,planCtx,true);
        if(ability){await POLICY.runAction(p,ability);await simSettle(null,POLICY);}
      }
      const mv=op.op==='ready'?(moves>0||polMfExtraMove(p)?await polMfMoveChoice(p,true):null):POLICY.movePlan(p);
      if(mv&&G.winner===null){await moveUnits(p,mv.units,mv.dest);await simSettle(null,POLICY);}
    }
    for(const u of everyUnit())u.tempM=u.tempM.filter(m=>m.dur!=='turn');
  },POLICY,true,false);
  return applied?result:null;
}
async function polEffectOptionChoice(p,options,selection){
  const op=selection.op;
  const score=o=>{
    const v=o.v;if(v===null)return 0;
    if(op.op==='pickKillGear')return (v.pi===p?-1:1)*polKeepCardValue(v.pi,v.g.n);
    if(op.op==='fadingMemory'){
      if(v.t==='u'){const u=everyUnit().find(u=>u.uid===v.uid);return u&&!effKw(u).temporary?(u.ctrl===p?-1:1)*evalCombatRemovalValue(u):0;}
      return (v.pi===p?-1:1)*polKeepCardValue(v.pi,v.g.n);
    }
    return Number(G.showdown?.bfIdx===v)*100+G.bfs[v].units.filter(u=>u.ctrl!==p).reduce((s,u)=>s+evalCombatRemovalValue(u),0);
  };
  const ranked=[...options].sort((a,b)=>score(b)-score(a));
  if(polSpecialChoiceDepth||NET.online||(SIM.movementDepth||0)>=2)return ranked[0].v;
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+Math.min(POLICY.budget||400,800));
  polSpecialChoiceDepth++;
  try{
    let best=null;
    for(const o of ranked){
      if(Date.now()>SIM.deadline)break;
      const value=await polSpecialEffectProbe(p,selection,preTargetSpecs(op).some(s=>s.battlefield)?{bf:o.v}:o.v);
      if(value!==null&&(!best||value>best.value+1e-7))best={o,value};
    }
    return (best?.o||ranked[0]).v;
  }finally{polSpecialChoiceDepth--;SIM.deadline=deadline;}
}
async function polSpecialUnitChoice(p,candidates,selection){
  const op=selection?.op;
  if(!['dmgLastDiscardCost','guillotine','highlanderMark','extortion'].includes(op?.op))return undefined;
  const legal=candidates.filter(u=>op.op==='highlanderMark'?u.ctrl===p:u.ctrl!==p);
  if(!legal.length)return null;
  const ranked=[...legal].sort((a,b)=>evalCombatRemovalValue(b)-evalCombatRemovalValue(a));
  if(polSpecialChoiceDepth||NET.online||(SIM.movementDepth||0)>=2)return ranked[0];
  let hand=[...G.players[p].hand];const own=hand.indexOf(selection.ctx?.n);if(own>=0)hand.splice(own,1);
  const discards=op.op==='dmgLastDiscardCost'?[...new Set(hand)]:[undefined];
  if(!discards.length)return ranked[0];
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+Math.min(POLICY.budget||400,800));
  polSpecialChoiceDepth++;
  try{
    let best=null;
    for(const u of ranked)for(const n of discards){
      if(Date.now()>SIM.deadline)break;
      const value=await polSpecialEffectProbe(p,selection,u.uid,n);
      if(value!==null&&(!best||value>best.value+1e-7))best={u,value};
    }
    return best?.u||ranked[0];
  }finally{polSpecialChoiceDepth--;SIM.deadline=deadline;}
}
async function polTideTurnerTarget(p,candidates,optional,selection){
  if(selection?.op?.op!=='tideTurner')return undefined;
  const me=selection.ctx?.unit;
  const legal=candidates.filter(u=>u.ctrl===p&&u.uid!==me?.uid&&u.loc!==me?.loc);
  const fallback=optional?null:polStrongest(legal);
  if(!me||!legal.length||polSpecialChoiceDepth||NET.online||(SIM.movementDepth||0)>=2)return fallback;
  const planningDeadline=Math.min(SIM.deadline||Infinity,Date.now()+700);
  if(Date.now()>planningDeadline)return fallback;
  const entries=[...(G.showdown?.chain||[]),...(G._pendingTriggers||[]).map(x=>({p:x.ctx.p,ab:x.t})),
    ...legal.flatMap(u=>(unitFx(u).triggers?.onAttack||[]).map(ab=>({p:u.ctrl,ab})))];
  const outcomes=polCombatRuneOutcomes(p,entries,planningDeadline);if(!outcomes)return fallback;
  const samples=new Set(G.players[p].deck).size>1?3:1,deadline=SIM.deadline;
  SIM.deadline=planningDeadline;polSpecialChoiceDepth++;
  try{
    let best=fallback,bestValue=-Infinity;
    for(const u of optional?[null,...legal]:legal){
      if(Date.now()>SIM.deadline)break;
      let total=0,complete=true;
      outcomes:for(const runes of outcomes)for(let sample=0;sample<samples;sample++){
        const value=await polSpecialEffectProbe(p,selection,u?.uid??null,undefined,{sample,runes});
        if(value===null){complete=false;break outcomes;}
        total+=value*runes.weight/samples;
      }
      if(complete&&total>bestValue+1e-7){best=u;bestValue=total;}
      if(complete&&Math.abs(total-999)<1e-7)break;
    }
    return best;
  }finally{polSpecialChoiceDepth--;SIM.deadline=deadline;}
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
    async function probe(plan, afterChain=false){
      let burden=0, valid=true;
      const value=await simTry(p,async()=>{
        const before=new Map(everyUnit().map(u=>[u.uid,{temp:u.tempM.length,grants:{...u.grants},m:might(u)}]));
        if(afterChain){
          const sd=G.showdown;
          // 실제 해결 순서대로 대기 효과만 처리한다. 빈 체인의 전투까지 패스하지 않는다.
          for(let i=0;i<40 && G.showdown===sd && sd.chain.length;i++) await showdownPass();
          const cost=selection.cost;
          if(G.showdown!==sd || sd.chain.length || G.winner!==null ||
             !plan.ids.every(uid=>everyUnit().some(u=>u.uid===uid)) ||
             !G.players[p].hand.includes(ctx.n) || playRestriction(card(ctx.n),p,false) ||
             cost && !canPay(p,cost.energy||0,cost.pips||[],!!cost.spellOK)){
            valid=false; return;
          }
        }
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
      return value===null || !valid?null:value-burden;
    }
    const base=await probe(null);
    if(base===null) return null;
    let best=null, delayed=null;
    for(const plan of plans){
      if(best && Date.now()>deadline) break;
      const value=await probe(plan);
      if(value!==null && (!best || value>best.value+1e-7)) best={...plan,value,gain:value-base};
      if(selection.waitForChain && G.showdown?.chain.length && Date.now()<=deadline){
        const later=await probe(plan,true);
        if(later!==null && (!delayed || later>delayed.value+1e-7)) delayed={value:later};
      }
    }
    if(best && delayed && delayed.value>=best.value-1e-7) best.defer=true;
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
    if(mine.length) return polStrongest(mine);
    const tax=u=>selection.cost?.noDeflect?0:deflectPips(p,u).length;
    // Ordinary enemies cannot move on our turn and awaken before their next
    // move. Readying them does not improve defense either. Exhaust abilities
    // usable in reactions/showdowns (including Heimerdinger copies) do benefit.
    const enemyAbilities=polAbList(opp(p));
    const harmless=candidates.filter(u=>!u.ex ||
      everyUnit().some(x=>x.ctrl!==u.ctrl&&x.loc!=='base'&&unitFx(x).jailerReady) ||
      G.turn===p&&!G._endingTurn&&!enemyAbilities.some(a=>a.src.u===u&&a.ab.cost?.exhaustSelf&&
        (a.ab.reaction||a.ab.action)&&(!a.ab.onlyAtBf||a.ab.copied||u.loc!=='base')));
    const ranked=[...(harmless.length?harmless:candidates)].sort((a,b)=>
      (harmless.length?tax(a)-tax(b)||Number(a.ex)-Number(b.ex):0)||might(a)-might(b)||tax(a)-tax(b));
    // A pure optional ready with no friendly benefit need not pay or help an enemy.
    if(optional&&(!harmless.length||tax(ranked[0])>0)) return null;
    return ranked[0];
  }
  const immediate=u=>!!(G.turn===p && G.phase==='action' &&
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
      // Declaration costs and readiness share the same actual effect probe;
      // its follow-up executes activated abilities and movement triggers too.
      const value=await polSpecialEffectProbe(p,selection,candidate.uid);
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
  if(selection?.addCostCard===231){
    const plan=polLedrosSacrifices(p,card(231),selection.playOpts);
    return plan?.[selection.paidCount||0]||null;
  }
  if(promptText==='버프를 소모할 유닛'){
    const plan=POLICY._buffPaymentPlan;
    if(plan?.p===p&&plan.uid!==undefined)return candidates.find(u=>u.uid===plan.uid&&u.buff>0&&u.dmg<might(u)-1)||null;
  }
  if(promptText==='탈진할 아군 유닛'){
    return [...candidates].sort((a,b)=>Number(!a.stunned)-Number(!b.stunned)||might(a)-might(b))[0];
  }
  if(String(promptText).includes('존야의 모래시계')){
    return [...candidates].sort((a,b)=>Number(a.isToken)-Number(b.isToken)||evalCombatRemovalValue(b)-evalCombatRemovalValue(a))[0];
  }
  if(selection?.judgmentKeep){
    if(polSmart()&&selection.scriptChoice)return polScriptChoice(p,candidates.map(u=>({v:u.uid,n:u.n})),selection.scriptChoice)
      .then(uid=>candidates.find(u=>u.uid===uid)||null);
    return [...candidates].sort((a,b)=>polJudgmentValue(p,{kind:'unit',p:b.ctrl,u:b,kept:selection.kept.includes(b.uid)})
      -polJudgmentValue(p,{kind:'unit',p:a.ctrl,u:a,kept:selection.kept.includes(a.uid)}))[0];
  }
  if(promptText==='버프를 소모할 유닛'||promptText==='버프를 소모할 유닛 선택'){
    return candidates.filter(u=>u.ctrl===p && u.buff>0 && u.dmg<might(u)-1)
      .sort((a,b)=>(a.loc==='base'?0:1)-(b.loc==='base'?0:1) || might(a)-might(b))[0]||null;
  }
  if(selection?.costConfirmation){
    const c=selection.costConfirmation;
    if(['buffDraw','buffBloom'].includes(c.context?.botChoice?.kind)&&c.context.botChoice.inner&&polSmart())
      return polTriggeredCostChoice(p,candidates,c.context.botChoice);
    if(!POLICY.confirm(p,c.text,c.preview,c.context)) return null;
    return candidates.length===1?candidates[0]:POLICY.unit(p,candidates,c.pickTitle,false);
  }
  if(polOffensiveOp(selection?.op)){
    candidates=candidates.filter(u=>u.ctrl!==p||polKaisaSpellFriendly(p,selection?.ctx?.n,u));
    if(!candidates.length) return null;
  }
  const txt = String(promptText||'');
  if(txt==='[보호막 2]를 줄 유닛 선택' && polSmart()){
    const defenders=candidates.filter(u=>u.ctrl===p && G.showdown?.defender===p && u.loc===G.showdown.bfIdx);
    if(defenders.length) return polStrongest(defenders);
  }
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
  const tide=await polTideTurnerTarget(p,candidates,optional,selection);
  if(tide!==undefined)return tide;
  const selected=await polSelectionChoice(p,candidates,selection);
  if(selected!==undefined) return selected;
  const special=await polSpecialUnitChoice(p,candidates,selection);
  if(special!==undefined)return special;
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
  // The stun trick forecast removes a combatant's damage. Its actual target
  // must come from that same combat, rather than a stronger idle base unit.
  if(selection?.op?.op==='stun'&&G.showdown?.hasCombat){
    const sd=G.showdown,role=u=>u.ctrl===sd.attacker?'attacker':'defender';
    const fighting=candidates.filter(u=>u.ctrl!==p&&u.loc===sd.bfIdx&&!u.stunned);
    if(fighting.length)return fighting.sort((a,b)=>might(b,role(b))-might(a,role(a)))[0];
  }
  const foes = candidates.filter(u=>u.ctrl!==p);
  const mine = candidates.filter(u=>u.ctrl===p);

  // ⓪ '유닛 준비'(일등항해사 132 등 — 플레이 시점 대상 프롬프트 「…」 대상 선택 — 유닛 준비): 탈진한 아군에게. 준비된 아군은 무의미하고
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
  // 약탈자의 노: 이길 방어를 포기해 상대에게 전장을 넘기지 않는다.
  // 상대의 비공개 응수는 가정하지 않고 현재 공개 병력의 전투 결과를 비교한다.
  if(previewCard?.n===285 && /공격\/방어 효과/.test(txt) && polSmart()){
    const sd=G.showdown;
    if(sd?.defender===p){
      const attackers=G.bfs[sd.bfIdx].units.filter(u=>u.ctrl===sd.attacker);
      const fight=evalCombat(sd.attacker,sd.bfIdx,attackers);
      return fight.result!=='repelled';
    }
  }
  if(context?.decision?.title==='가속'&&previewCard){
    const plan=POLICY._buffPaymentPlan;
    if(plan?.p===p&&plan.n===previewCard.n&&plan.accelerate!==undefined)return plan.accelerate;
    return polAccelerateChoice(p,previewCard,context);
  }
  if(context?.botChoice){
    const q=context.botChoice,P=G.players[p];
    if(q.kind==='rocketRecover'&&polSmart()){
      return polScriptChoice(p,P.hand.map((n,i)=>({v:i,n})),q).then(i=>{
        q.discardIndex=i;q.discardN=i===null?null:P.hand[i];return i!==null;
      });
    }
    if(q.kind==='freeRune')return P.runeDeck.length>0;
    if(q.kind==='drawExhaust'){
      const gear=P.gear[q.gearIndex];
      if(q.inner&&gear&&polSmart())return polTriggeredCostChoice(p,[gear],q).then(Boolean);
      return P.deck.length>0;
    }
    if(q.kind==='legendChannel')return !P.legendEx&&P.runeDeck.length>0;
    if(q.kind==='effectPlay'){
      if(TF().noPlay[p]||!canPay(p,q.energy||0,q.pips||[])||
        FX[q.n]?.addCost?.kind==='killUnit'&&!everyUnit().some(u=>u.ctrl===p))return false;
      if(['jawsReplay','spellKillReactionPlay','nocturnePlay'].includes(q.op?.op)&&polSmart())
        return polScriptChoice(p,[{v:true,n:q.n,powerCost:q.pips}],q).then(v=>v!==null);
      return true;
    }
    if(q.kind==='hiddenPlay'){
      if(TF().noPlay[p]||!canPay(p,0,['Mind']))return false;
      const options=q.candidates.map(n=>({n,hiddenEffectLoc:q.loc,hiddenEffectSourceUid:q.unitUid}));
      return polAvaHiddenChoice(p,options,q).then(choice=>choice!==null);
    }
    if(q.kind==='gearBuff')return G.players[opp(p)].gear.length>0||
      everyUnit().some(u=>u.uid===q.unitUid&&polCanBuff(u))&&G.players[p].gear.some(g=>polKeepCardValue(p,g.n)<3);
    if(q.kind==='buffDraw')return P.deck.length>0&&everyUnit().some(u=>u.ctrl===p&&u.buff>0&&u.dmg<might(u)-1);
    if(q.kind==='buffReady'||q.kind==='paidReady'){
      const u=everyUnit().find(u=>u.uid===q.uid);
      const activated=!!u&&unitFx(u).activated?.some(a=>a.cost?.exhaustSelf&&canActivateAbilityTiming(p,a));
      // Stun suppresses combat Might, not legal movement or its triggers.
      // Paid readiness still has to prove a useful follow-up below.
      const legal=!!u&&u.ex&&(!q.pips||canPay(p,0,q.pips))&&
        !everyUnit().some(x=>x.ctrl!==p&&x.loc!=='base'&&unitFx(x).jailerReady)&&
        // Open Plan replaces the spent buff within the same effect, before cleanup.
        (q.kind!=='buffReady'||u.dmg<might(u)-(q.restoresBuff?0:1));
      if(!legal)return false;
      if(q.kind==='buffReady')return true;
      if(polMfCostBlocked(p,{energy:0,pips:q.pips||[]}))return false;
      // Next awakening is free; only actions still available justify paying now.
      const activeCtx=typeof BOT!=='undefined'&&BOT.seat===p?BOT.ctx:null;
      const moves=typeof activeCtx?.movesLeft==='number'?activeCtx.movesLeft:polTier().moves;
      const immediate=G.turn===p&&G.phase==='action'&&(moves>0||polMfExtraMove(p))&&
        (u.loc==='base'||effKw(u).ganking)||activated;
      if(!immediate)return false;
      if(q.inner&&polSmart())return polTriggeredCostChoice(p,[u],q).then(Boolean);
      return true;
    }
    if(q.kind==='deathSave'){
      if(q.costCard===231)return false; // 방금 선택한 희생을 유료 회수로 취소해 힘 할인을 잃지 않는다.
      const u=everyUnit().find(u=>u.uid===q.uid);
      if(!u||!canPay(p,0,q.pips))return false;
      if(q.op?.op==='deathSave'&&polSmart())
        return polScriptChoice(p,[{v:true,n:q.n,powerCost:q.pips}],q).then(v=>v!==null);
      if(u.isToken||unitFx(u).temporary||effKw(u).temporary)return false;
      if(q.legend){
        const others=[...(_dyingBatch||[])].filter(x=>x.ctrl===p&&x.buff>0&&!x._dead&&!x.isToken&&!x._highlander&&!unitFx(x).temporary&&!effKw(x).temporary);
        if(others.some(x=>evalCombatRemovalValue(x)>evalCombatRemovalValue(u)))return false;
      }
      return true;
    }
  }
  if(context?.decision?.title==='전설 효과')return !G.players[p].legendEx&&G.players[p].runeDeck.length>0;
  if(/^추가 비용:/.test(txt)&&previewCard?.n===44)return G.players[p].deck.length>0&&
    canPayWithFunding(p,context.cost.energy,context.cost.pips,false)&&!polMfCostBlocked(p,context.cost);
  if(/^추가 비용:/.test(txt)&&previewCard?.n===48)return G.players[p].deck.length>0&&
    everyUnit().some(u=>u.ctrl===p&&!u.ex&&(u.stunned||G.turn!==p||u.loc!=='base'&&!effKw(u).ganking));
  if(!POLICY.ab.confirm) return true;
  if(!polSmart()) return polHash('c', G.turnCount, txt) < 0.5;

  const buffPayment=POLICY._buffPaymentPlan;
  if(/^추가 비용:/.test(txt)&&previewCard&&buffPayment?.p===p&&buffPayment.n===previewCard.n&&buffPayment.spend){
    if(context?.fromHidden||context?.ignoreEnergy&&context?.ignorePower)return false;
    return everyUnit().some(u=>u.ctrl===p&&u.uid===buffPayment.uid&&u.buff>0&&u.dmg<might(u)-1);
  }
  // 비용을 이미 낼 수 있으면 손패/버프를 보존하고, 부족할 때만 대체 비용을 선택한다.
  if(/^추가 비용:/.test(txt) && previewCard && polAlternativePlayCost(p,previewCard)){
    if(context?.fromHidden || context?.ignoreEnergy && context?.ignorePower) return false;
    const extra=previewCard.type==='Spell'?polSpellTargetPips(p,previewCard):[];
    if(extra===null) return false;
    const base=polBasePlayCost(p,previewCard,context);
    const normal=canPayWithFunding(p,base.energy,[...base.pips,...extra],previewCard.type==='Spell');
    return !normal && polCanPlay(p,previewCard);
  }
  if(/^추가 비용:/.test(txt) && previewCard &&
      ['spendBuff','discard'].includes(FX[previewCard.n]?.addCost?.kind) &&
      (FX[previewCard.n]?.addCost?.ignoreCost || FX[previewCard.n]?.addCost?.discountE)) return false;

  if(context?.cost && polMfCostBlocked(p,context.cost)) return false;
  if(context?.trashCosts && polMfAuroraDeck(p) && !polMfAuroraOnline(p))
    return context.trashCosts.some(cost=>!polMfCostBlocked(p,cost));

  // [통찰] 덱 맨 위를 아래로 보낼까 — 손패 평균보다 나쁠 때만
  if(/덱 맨 위|^덱 위 \d+장:/.test(txt)){
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

// 선택 비용은 같은 엔진으로 사용/미사용 후 남은 이동까지 비교한다.
let polPaidChoiceDepth=0;
let polTriggeredCostDepth=0;
async function polTriggeredCostChoice(p,candidates,context){
  const P=G.players[p],bloom=context.kind==='buffBloom',ready=context.kind==='paidReady',gearDraw=context.kind==='drawExhaust',
    me=bloom?everyUnit().find(u=>u.uid===context.ctx?.unit?.uid):null;
  // The Shaman's own buff is restored before cleanup; Mistfall spends power, not a buff.
  const safe=candidates.filter(u=>gearDraw?P.gear[context.gearIndex]===u&&!u.ex:
    u.ctrl===p&&(ready||u.buff>0&&(u.dmg<might(u)-1||bloom&&u===me)));
  const usesBuff=u=>unitFx(u).activated?.some(a=>a.cost?.spendBuff);
  const ranked=gearDraw?safe:[...safe].sort((a,b)=>Number(usesBuff(a))-Number(usesBuff(b))||
    Number(a.loc!=='base')-Number(b.loc!=='base')||might(a)-might(b));
  const usefulReady=me?.ex&&!me.stunned&&!everyUnit().some(u=>u.ctrl!==p&&u.loc!=='base'&&unitFx(u).jailerReady);
  const fallbackAllowed=ready||(bloom?usefulReady:P.deck.length>0);
  const fallback=fallbackAllowed?ranked[0]||null:null;
  if(!safe.length||NET.online||polTriggeredCostDepth||polPaidChoiceDepth||polScriptChoiceDepth||(SIM.movementDepth||0)>=2)return fallback;
  const planningDeadline=Math.min(SIM.deadline||Infinity,Date.now()+700);
  if(Date.now()>planningDeadline)return fallback;
  const pending=context.remaining,entries=[...(G.showdown?.chain||[]),
    ...[...(pending?.ordered||[]),...(pending?.unordered||[]),...(G._pendingTriggers||[])].map(x=>({p:x.ctx.p,ab:x.t}))];
  const outcomes=polCombatRuneOutcomes(p,entries,planningDeadline);if(!outcomes)return fallback;
  const samples=new Set([...P.deck,...P.trash]).size>1?3:1;
  const followups=[null,...[...new Set(P.hand)].slice(0,8).map(n=>({kind:'play',n}))];
  const turnHorizon=ready&&P.hand.includes(122)||gearDraw&&[...P.hand,...P.deck,...P.trash].includes(122);
  if(turnHorizon&&!followups.some(a=>a?.n===122))followups.push({kind:'play',n:122});
  if(P.champInZone)followups.push({kind:'champ',n:P.champN});
  // After the simulated draw its result is visible in that sample. This is an
  // adaptive decision, never a reservation of the real unknown top card.
  followups.push({kind:'observedPlay'});
  const activeCtx=typeof BOT!=='undefined'&&BOT.seat===p?BOT.ctx:null;
  const moves=typeof activeCtx?.movesLeft==='number'?activeCtx.movesLeft:polTier().moves;
  const original=G,had=Object.hasOwn(original,'_botBuffDraw'),previous=original._botBuffDraw,deadline=SIM.deadline;
  original._botBuffDraw=context;SIM.deadline=planningDeadline;polTriggeredCostDepth++;
  try{
    let best=fallback,bestValue=-Infinity;
    for(const source of [null,...ranked]){
      if(Date.now()>SIM.deadline)break;
      let total=0,complete=true;
      outcomes:for(const runes of outcomes)for(let sample=0;sample<samples;sample++){
        let sampleBest=-Infinity;
        for(const followup of followups){
          let valid=false,ending=null;
          const value=await simTry(p,async()=>{
            polKaisaTurnPublicSample(p,sample);
            G.players[p].runeDeck=[...runes.own.order];G.players[opp(p)].runeDeck=[...runes.other.order];
            // Future recycling shuffles are unknown too; do not reuse the live RNG prediction.
            _rngState=(Math.floor(polHash('buff-draw-sample',G.turnCount,p,sample)*0x7fffffff)|1)>>>0;
            const q=G._botBuffDraw;delete G._botBuffDraw;delete G._botTriggerRemainder;
            if(source){
              const u=gearDraw?null:everyUnit().find(x=>x.uid===source.uid);
              if(!gearDraw&&(!u||!ready&&u.buff<=0))return;
              if(gearDraw){
                const g=G.players[p].gear[q.gearIndex];if(!g||g.ex||g.n!==q.ctx.gear?.n)return;
                const confirm=UI.confirmP;
                UI.confirmP=(pi,t,c,x)=>pi===p&&x?.botChoice?.kind==='drawExhaust'&&
                  x.botChoice.gearIndex===q.gearIndex?true:confirm(pi,t,c,x);
                try{await execOps([q.inner],{...q.ctx,gear:g});}finally{UI.confirmP=confirm;}
              }else if(bloom){
                const target=everyUnit().find(x=>x.uid===q.ctx.unit?.uid);if(!target)return;
                const pick=UI.pickUnitFrom;
                UI.pickUnitFrom=(pi,us,t,o,sel)=>pi===p&&
                  sel?.costConfirmation?.context?.botChoice?.kind==='buffBloom'&&
                  sel.costConfirmation.context.botChoice.ctx.unit?.uid===target.uid?u:pick(pi,us,t,o,sel);
                try{await execOps([q.inner],{...q.ctx,unit:target});}finally{UI.pickUnitFrom=pick;}
              }else if(ready){
                const g=G.players[p].gear[q.gearIndex];if(!g||g.ex||g.n!==q.ctx.gear?.n)return;
                const confirm=UI.confirmP;
                UI.confirmP=(pi,t,c,x)=>pi===p&&x?.botChoice?.kind==='paidReady'&&
                  x.botChoice.uid===u.uid&&x.botChoice.gearIndex===q.gearIndex?true:confirm(pi,t,c,x);
                try{await execOps([q.inner],{...q.ctx,it:u,gear:g});}finally{UI.confirmP=confirm;}
              }else{u.buff--;await execOps([q.inner],q.ctx);}
            }
            for(const x of q.remaining?.ordered||[]){if(G.winner!==null)break;await fireTriggeredAbility(x.t,x.ctx);}
            if(G.winner===null&&q.remaining?.unordered?.length){
              (G._pendingTriggers||(G._pendingTriggers=[])).push(...q.remaining.unordered);await flushPendingTriggers();
            }
            await cleanup(p);
            if(G.winner===null&&G.showdown?.ending){
              // Conquest has already scored and its queued triggers have now finished.
              G.showdown.stage='scoring';await resolveShowdown();
            }else if(G.showdown?.resolvingItem){
              const sd=G.showdown;sd.resolvingItem=false;await flushCombatTriggers(sd);sd.passes=0;
              if(sd.chain.length)G.actingPlayer=sd.chain[sd.chain.length-1].p;
            }
            await simSettle(null,POLICY);
            if(G.winner===null&&G.turn===p&&G.phase==='action'&&G.state==='neutral'){
              if(followup){
                const act=followup.kind==='observedPlay'
                  ?await POLICY.playPlan(p,{tried:new Set(),movesLeft:moves}):polOrderAction(p,followup);
                if(!act&&followup.kind!=='observedPlay')return;
                if(act&&await POLICY.runAction(p,act)===false)return;await simSettle(null,POLICY);
              }
              if(G.winner===null){
                const ctx={tried:new Set(),movesLeft:moves};
                const ability=await POLICY.abilityPlan(p,ctx,false)||await POLICY.abilityPlan(p,ctx,true);
                if(ability){await POLICY.runAction(p,ability);await simSettle(null,POLICY);}
                if(moves>0&&G.winner===null){const mv=await polMfMoveChoice(p,true);
                  if(mv){await moveUnits(p,mv.units,mv.dest);await simSettle(null,POLICY);}}
              }
            }
            if(turnHorizon&&G.winner===null){ending=await polNextTurnOutcome(p,true);if(!ending)return;}
            valid=true;
          },POLICY,!!SIM.lock,false);
          if(valid&&value!==null)sampleBest=Math.max(sampleBest,ending?.value??value);
          if(sampleBest===999)break;
          if(Date.now()>SIM.deadline){complete=false;break;}
        }
        if(sampleBest===-Infinity)complete=false;
        if(!complete)break outcomes;total+=sampleBest*runes.weight/samples;
      }
      if(complete&&total>bestValue+1e-7){best=source;bestValue=total;}
      if(complete&&Math.abs(total-999)<1e-7)break;
    }
    return best;
  }finally{
    if(had)original._botBuffDraw=previous;else delete original._botBuffDraw;
    SIM.deadline=deadline;polTriggeredCostDepth--;
  }
}
async function polPaidActionGain(p,run,ctx,publicSample=false){
  if(polPaidChoiceDepth||NET.online||(SIM.movementDepth||0)>=2)return null;
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+500);
  polPaidChoiceDepth++;
  try{
    const probe=async act=>{let valid=true,position=0;const value=await simTry(p,async()=>{
      UI.pickReaction=async()=>null;
      if(publicSample){
        polKaisaTurnPublicSample(p,0);
        G.players[p].runeDeck=publicSample.runeOrder?[...publicSample.runeOrder]:
          [...G.players[p].runeDeck].sort((a,b)=>a-b);
      }
      else G.players[p].deck.sort((a,b)=>a-b);
      if(act&&await act()===false){valid=false;return;}
      await simSettle(null,POLICY);
      if(G.winner===null&&G.turn===p&&G.phase==='action'&&G.state==='neutral'&&
          (!(typeof ctx?.movesLeft==='number'&&ctx.movesLeft<=0)||polMfExtraMove(p))){
        POLICY.turnPlan=null;
        const count=publicSample?.counterplay?Math.max(0,Math.min(ctx?.movesLeft??1,polTier().moves||1)):1;
        for(let i=0;i<count&&G.winner===null&&G.turn===p&&G.state==='neutral';i++){
          if(SIM.deadline&&Date.now()>SIM.deadline)throw new SimBudget('deadline');
          const mv=await polMfMoveChoice(p,true,count-i);if(!mv)break;
          const before=simHash(G);
          await moveUnits(p,mv.units,mv.dest);await simSettle(null,POLICY);
          if(simHash(G)===before)break;
        }
      }
      if(publicSample?.counterplay){
        if(G.winner===null&&G.turn===p&&G.phase==='action'&&G.state==='neutral')await endTurn();
        await simSettle(null,POLICY);
        if(G.winner===null)await polKaisaTurnOpponentMoves(p);
        position=polKaisaTurnFieldValue(p);
      }else for(const u of everyUnit())u.tempM=u.tempM.filter(x=>x.dur!=='turn');
    },POLICY,!!SIM.lock,false);return valid&&value!==null?value+position:null;};
    const before=await probe(null),after=await probe(run);
    return before===null||after===null?null:after-before;
  }finally{polPaidChoiceDepth--;SIM.deadline=deadline;}
}
async function polAccelerateChoice(p,c,context){
  if(!canPay(p,context.cost.energy,context.cost.pips,false)&&!canPayWithFunding(p,context.cost.energy,context.cost.pips,false))return false;
  const P=G.players[p],idx=P.hand.indexOf(c.n),source=context.playOpts||{};
  // 비교 기준은 같은 카드의 가속하지 않은 플레이다.
  if(!polPaidChoiceDepth&&!NET.online&&(SIM.movementDepth||0)<2){
    const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+500);polPaidChoiceDepth++;
    try{
      const probe=accel=>simTry(p,async()=>{
        G.players[p].deck.sort((a,b)=>a-b);
        const confirm=UI.confirmP;
        UI.confirmP=(q,t,preview,x)=>q===p&&preview?.n===c.n&&/^\[가속\]/.test(t)?accel:confirm(q,t,preview,x);
        if(await playCardFromHand(p,source.champZone?-1:idx,source)===false)throw new Error('acceleration candidate invalid');
        await simSettle(null,POLICY);
        if(G.winner===null&&G.turn===p&&G.phase==='action'&&G.state==='neutral'){
          POLICY.turnPlan=null;const mv=await polMfMoveChoice(p,true);if(mv){await moveUnits(p,mv.units,mv.dest);await simSettle(null,POLICY);}
        }
        for(const u of everyUnit())u.tempM=u.tempM.filter(x=>x.dur!=='turn');
      },POLICY,!!SIM.lock,false);
      const no=await probe(false),yes=await probe(true);
      if(no!==null&&yes!==null)return yes>no+BOT_W.moveNeed;
    }finally{polPaidChoiceDepth--;SIM.deadline=deadline;}
  }
  // 중첩 탐색에서는 명확한 준비 공격 기회가 없으면 추가 자원을 보존한다.
  if(G.turn!==p||G.phase!=='action'||G.state!=='neutral'||TF().enterReady[p]||TF().nextUnitReady[p]||FX[c.n]?.entersReady===true||collectStatics().some(x=>x.p===p&&x.s.kind==='enterReadyAura'))return false;
  const u={n:c.n,uid:-987653,ctrl:p,owner:p,loc:'base',ex:false,stunned:false,dmg:0,buff:0,tempM:[],grants:{},gear:[],turnMoves:0};
  return G.bfs.some((b,i)=>{
    if(b.controller===p)return false;
    const allies=everyUnit().filter(x=>x.ctrl===p&&!x.ex&&
      (x.loc==='base'||x.loc!==i&&effKw(x).ganking));
    const before=allies.length?evalAttackValue(p,i,allies):0;
    return evalAttackValue(p,i,[u,...allies])>Math.max(0,before)+BOT_W.moveNeed;
  });
}
// ══════════ 수치 선택 ══════════
let polAlbusBuffDepth=0;
async function polAlbusBuffChoice(p,candidates){
  const P=G.players[p],limit=P.runeDeck.length;
  if(!polSmart() || !limit || polAlbusBuffDepth || NET.online ||
      (SIM.movementDepth||0)>=2 || G.turn!==p || G.phase!=='action') return [];
  const safe=candidates.filter(u=>u.ctrl===p&&u.buff>0&&u.dmg<might(u)-1)
    .sort((a,b)=>Number(a.loc!=='base')-Number(b.loc!=='base')||a.uid-b.uid);
  if(!safe.length)return [];
  const plans=[[]];
  function collect(i,picks,total){
    if(plans.length>=128)return;
    if(i===safe.length){if(total)plans.push(picks);return;}
    const u=safe[i],max=Math.min(u.buff,limit-total,Math.ceil(might(u)-u.dmg)-1);
    for(let count=0;count<=max;count++)collect(i+1,count?[...picks,{uid:u.uid,count}]:picks,total+count);
  }
  collect(0,[],0);
  const count=plan=>plan.reduce((n,x)=>n+x.count,0);
  plans.sort((a,b)=>count(a)-count(b));
  // Only cards present before the draw are continuations. All allocations,
  // including zero, receive the same card/ability/movement opportunity.
  const nextCards=[null,...new Set(P.hand)].map(n=>n===null?null:{kind:'play',n});
  if(P.champInZone)nextCards.push({kind:'champ',n:P.champN});
  const ctx=typeof BOT!=='undefined'&&BOT.seat===p?BOT.ctx:null;
  const moves=typeof ctx?.movesLeft==='number'?ctx.movesLeft:polTier().moves;
  const runeCounts=new Map();for(const n of P.runeDeck)runeCounts.set(n,(runeCounts.get(n)||0)+1);
  const types=[...runeCounts].sort((a,b)=>a[0]-b[0]);
  const choose=(n,k)=>{let value=1;for(let i=1;i<=k;i++)value=value*(n-i+1)/i;return value;};
  // Rune identity is unknown, but the remaining composition is known. A small
  // random sample can overestimate a barely profitable conversion. Enumerate
  // the unordered channel outcomes with their without-replacement weights.
  const runeOutcomes=n=>{
    const out=[],denominator=choose(limit,n);
    function add(i,left,prefix,suffix,weight){
      if(i===types.length){if(!left)out.push({prefix,suffix,weight:weight/denominator});return;}
      const [type,available]=types[i];
      for(let take=0;take<=Math.min(left,available);take++)add(i+1,left-take,
        [...prefix,...Array(take).fill(type)],[...suffix,...Array(available-take).fill(type)],weight*choose(available,take));
    }
    add(0,n,[],[],1);return out;
  };
  const samples=new Set(P.deck).size>1?3:1;
  const deadline=SIM.deadline;
  SIM.deadline=Math.min(deadline||Infinity,Date.now()+700);polAlbusBuffDepth++;
  let best=[],baseline=null,bestValue=-Infinity;
  try{
    for(const plan of plans){
      if(Date.now()>SIM.deadline)break;
      let total=0,complete=true;
      outcomes: for(const outcome of runeOutcomes(count(plan)))for(let sample=0;sample<samples;sample++){
        let sampleBest=-Infinity;
        for(const followup of nextCards){
          let valid=false,ending=null;
          const value=await simTry(p,async()=>{
            polKaisaTurnPublicSample(p,sample);
            const suffix=[...outcome.suffix];
            let seed=(Math.floor(polHash('albus-runes',G.turnCount,sample)*0x7fffffff)|1)>>>0;
            for(let i=suffix.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;
              const j=seed%(i+1);[suffix[i],suffix[j]]=[suffix[j],suffix[i]];}
            G.players[p].runeDeck=[...outcome.prefix,...suffix];
            for(const x of plan){const u=everyUnit().find(u=>u.uid===x.uid);u.buff-=x.count;}
            channelRunes(p,count(plan),true);await cleanup(p);await simSettle(null,POLICY);
            if(followup&&G.winner===null){
              const a=polOrderAction(p,followup);if(!a)return;
              if(await POLICY.runAction(p,a)===false)return;await simSettle(null,POLICY);
            }
            if(G.winner===null&&G.turn===p&&G.phase==='action'&&G.state==='neutral'){
              const local={tried:new Set(),movesLeft:moves};
              const ability=await POLICY.abilityPlan(p,local,false)||await POLICY.abilityPlan(p,local,true);
              if(ability){await POLICY.runAction(p,ability);await simSettle(null,POLICY);}
              if(moves>0){const mv=await polMfMoveChoice(p,true);
                if(mv){await moveUnits(p,mv.units,mv.dest);await simSettle(null,POLICY);}}
            }
            for(const u of everyUnit()){u.tempM=u.tempM.filter(t=>t.dur!=='turn');u.dmg=0;}
            valid=true;
          },POLICY,true,false);
          if(value!==null&&valid)sampleBest=Math.max(sampleBest,value);
          if(Date.now()>SIM.deadline){complete=false;break;}
        }
        if(sampleBest===-Infinity)complete=false;
        if(!complete)break outcomes;total+=sampleBest*outcome.weight/samples;
      }
      if(!complete)break;
      const value=total;
      if(baseline===null){baseline=value;bestValue=value;}
      else if(value>bestValue+1e-7){best=plan;bestValue=value;}
    }
    return best;
  }finally{polAlbusBuffDepth--;SIM.deadline=deadline;}
}
// 항상 최댓값은 손해다 — spendBuffs는 엔진이 힘 핍 수까지만 할인하는데 보드 전체 버프를 태운다.
POLICY.number = function(p, text, min, max, context){
  const lo = Math.min(min, max), hi = Math.max(min, max);
  if(!POLICY.ab.number) return hi;
  const clamp = v => Math.max(lo, Math.min(hi, v));
  if(!polSmart()) return clamp(lo + Math.floor(polHash('n', G.turnCount, text) * (hi-lo+1)));
  const txt = String(text||'');
  if(/지불할 힘\(✳\) 수/.test(txt)){
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
    const mine=G.bfs[i].units.filter(u=>u.ctrl===p).reduce((s,u)=>s+might(u),0);
    value-=mine*(BOT_W.unitBf-BOT_W.unitBase);
    if(G.bfs[i].controller!==p) continue;
    // A safe garrison also receives evalState's generic Might-margin bonus.
    // Remove that positional premium here; actual incoming combat below still
    // rewards necessary defense without stranding the next ready attacker.
    const theirs=G.bfs[i].units.filter(u=>u.ctrl!==p).reduce((s,u)=>s+might(u),0);
    if(polKaisaDeck(p))value-=BOT_W.bfMargin*Math.tanh((mine-theirs)/3);
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
  // A static Might comparison cannot see a visible on-attack damage/stun.
  // Resolve the next public attack before declaring this garrison safe.
  const counterplay=polKaisaDeck(p)&&G.turn===p&&G.phase==='action'&&G.state==='neutral'&&
    everyUnit().some(u=>u.ctrl===opp(p)&&(u.loc==='base'||effKw(u).ganking)&&
      unitFx(u).triggers?.onAttack?.length);
  // A ready token can need a known buff before its first attack. Comparing
  // only its unbuffed attack incorrectly strands it at an occupied battlefield.
  const followups=data.token?.ready?[null,...[...new Set(G.players[p].hand)].slice(0,8)
    .map(n=>({kind:'play',n}))]:[null];
  let best=null, baseValue=null;
  polPlacementDepth++;
  try{
    for(const option of ordered)for(const followup of followups){
      let value=null;
      const probe=await simTry(p,async()=>{
        // The remaining composition is known to its owner, the order is not.
        if(counterplay)polKaisaTurnPublicSample(p,0);
        else G.players[p].deck.sort((a,b)=>a-b);
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
          if(followup){
            const act=polOrderAction(p,followup);if(!act)return;
            if(await POLICY.runAction(p,act)===false)return;await simSettle(null,POLICY);
          }
          if(G.winner===null){
            const move=POLICY.movePlan(p);
            if(move){await moveUnits(p,move.units,move.dest);await simSettle(null,POLICY);}
          }
        }
        if(counterplay){
          if(G.winner===null&&G.turn===p&&G.phase==='action'&&G.state==='neutral')await endTurn();
          await simSettle(null,POLICY);
          if(G.winner===null)await polKaisaTurnOpponentMoves(p);
          value=evalState(G,p)+polKaisaTurnFieldValue(p);
        }else value=polPlacementValue(p);
      },POLICY,true,false);
      if(probe===null || value===null) continue;
      if(option===base) baseValue=baseValue===null?value:Math.max(baseValue,value);
      if(!best || value>best.value+BOT_W.moveNeed) best={option,value};
      if(value===999)break;
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
// 룬의 속성은 현재 알려진 손패/챔피언의 힘 수요와 남은 준비 룬으로 비교한다.
function polRuneValue(p,r,observer=p){
  const P=G.players[p],dom=runeDomain(r.n);
  const ns=[...(p===observer?P.hand:[]),...(P.champInZone?[P.champN]:[])];
  let need=0,interest=0,reactionNeed=false;
  for(const n of ns){
    const c=card(n),k=powerPips(c).filter(d=>d===dom).length;
    need=Math.max(need,k);interest+=Math.min(1,k);
    if(k && (G._endingTurn||G.turn!==p) && FX[n]?.kw?.reaction) reactionNeed=true;
  }
  const available=(G._endingTurn?0:(P.power[dom]||0)+(P.power.Any||0))+P.runes.filter(x=>x!==r&&!x.ex&&runeDomain(x.n)===dom).length;
  return (need>available?5:0)+(need>0&&available===0?2:0)+(reactionNeed?4:0)+Math.min(3,interest)*0.5;
}
function polKeepCardValue(p,n){
  const c=card(n),fx=FX[n]||{};
  let v=2+(c.e||0)*0.2+(c.type==='Unit'?(c.m||0):0);
  if(n===160) v+=8; // 무료 전개의 지속 엔진
  if(fx.zhonya)v+=4; // 사망 방지 도구를 단순 저비용 카드로 희생하지 않는다.
  if(c.super==='Champion') v+=2;
  if((fx.activated||[]).length) v+=1;
  if(c.dom?.some(d=>G.players[p].runes.some(r=>runeDomain(r.n)===d))) v+=1;
  return v;
}
function polJudgmentValue(p,x){
  const value=x.kind==='rune' ? 2+(!x.r.ex?2:0)+polRuneValue(x.p,x.r,p)
    : x.kind==='unit' ? 2+evalCombatRemovalValue(x.u)
    : polKeepCardValue(x.p,x.n);
  // 이미 보존된 대상을 다시 골라도 남는 카드 수는 늘지 않는다.
  return x.kept?0:(x.p===p?value:-value);
}
function polReadyGearUseful(n){
  const fx=FX[n];
  return !!fx&&(fx.activated?.some(a=>a.cost?.exhaustSelf)||
    Object.values(fx.triggers||{}).some(ts=>ts.some(t=>t.ops?.some(op=>['mistfall','exhThisDraw'].includes(op.op)))));
}
function polReadyOptionValue(p,o){
  return o.v.t==='u'?might(o.v.u)*(o.v.u.stunned?0.1:1):o.v.t==='g'?2:o.v.t==='l'?1:0.5+polRuneValue(p,o.v.r);
}
async function polMfReadyOption(p,options){
  const P=G.players[p];
  const fallback=o=>polReadyOptionValue(p,o);
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
  const pick=best?.o||ranked[0]?.o;
  if(!pick) return null;
  polSay('ready',pick.label,best?'준비 후 카드·능력·이동 결과 비교':'탐색 예산 부족 — 유닛 위력 우선');
  return pick.v;
}
function polMfDiscardPriority(p,n){
  const online=polMfAuroraOnline(p),o=opp(p),P=G.players[p];
  const hasEngine=online||P.hand.includes(160),hasGear=P.gear.length>0;
  const handAttack=(POL_MF_HAND_ATTACK.get(n)||0)/700;
  const gearAttack=(POL_MF_AURORA_HATE.get(n)||0)/600;
  return (online?(hasGear?gearAttack*2:0)+handAttack*0.25
    :(hasEngine?handAttack*2:handAttack*0.5)+(hasGear?gearAttack:0));
}
async function polMfDiscardChoice(p,options){
  const o=opp(p),handCount=G.players[o].hand.length,strategic=n=>polMfDiscardPriority(p,n);
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
function polAvaPlayable(p,n,loc,abilityPips=[]){
  if(TF().noPlay[p])return false;
  const c=card(n);
  if(c.type==='Unit')return loc!==null&&loc!==undefined&&
    !(loc!=='base'&&everyUnit().some(u=>u.ctrl!==p&&u.loc!=='base'&&unitFx(u).jailerUnits));
  if(c.type!=='Spell')return true;
  const cost={energy:0,pips:abilityPips,spellOK:true},extra=polSpellTargetPips(p,c);
  // 에이바는 손패에서 효과로 플레이한다. 숨겨 둔 전장만 대상으로 제한하지 않는다.
  return extra!==null&&canPayWithFunding(p,0,[...abilityPips,...extra],true)&&
    spellHasTargets(n,p,undefined,false,cost)&&polOffensivePlayable(p,n,undefined,false,cost);
}
let polExtortionDepth=0;
async function polExtortionOption(p,options){
  const {uid,caster}=options[0].extortion,u=everyUnit().find(x=>x.uid===uid);
  if(!u)return 'dmg';
  const damage=TF().preventSpellDmg?0:6+effDmgBonus(u,caster);
  const fallback=damage>=targetMight(u)-u.dmg && evalCombatRemovalValue(u)*BOT_W.unitBase>BOT_W.card*2?'draw':'dmg';
  if(polExtortionDepth||NET.online||(SIM.movementDepth||0)>=2)return fallback;
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+Math.min(POLICY.budget||400,600));
  polExtortionDepth++;
  try{
    let best=null;const op=FX[33].playOps[0].ops[0];
    for(const option of [...options].sort((a,b)=>Number(b.v===fallback)-Number(a.v===fallback))){
      if(Date.now()>SIM.deadline)break;
      const value=await simTry(p,async()=>{
        const pick=UI.pickOption;UI.pickOption=(q,t,opts)=>q===p&&opts.some(o=>o.extortion?.uid===uid)?option.v:pick(q,t,opts);
        await execOps([op],{p:caster,kind:'spell',pre:new Map([[op,uid]])});
        await cleanup(caster);await simSettle(null,POLICY);
      },POLICY,true,false);
      if(value!==null&&(!best||value>best.value+1e-7))best={option,value};
    }
    return best?.option.v||fallback;
  }finally{polExtortionDepth--;SIM.deadline=deadline;}
}
let polVisibleCardDepth=0;
async function polVisibleCardChoice(p,options,selection){
  // These identities are supplied only after the card effect has shown them.
  // The unresolved deck order and the other player's concealed hand are never
  // consulted to decide which visible card to take or play.
  const cards=options.filter((o,i,all)=>o.n!==undefined&&all.findIndex(x=>x.n===o.n&&x.v===o.v)===i);
  const skip=options.find(o=>o.v==='skip');
  const ranked=[...cards].sort((a,b)=>polKeepCardValue(p,b.n)-polKeepCardValue(p,a.n));
  if(!ranked.length)return skip?.v??options[0]?.v;
  if(polVisibleCardDepth||NET.online||Date.now()>SIM.deadline&&SIM.deadline)
    return ranked[0].v;
  const savedDeadline=SIM.deadline;
  SIM.deadline=Math.min(savedDeadline||Infinity,Date.now()+Math.min(POLICY.budget||500,900));
  polVisibleCardDepth++;
  try{
    const probe=async(o,play)=>{let applied=!o;
      const value=await simTry(p,async()=>{
      UI.pickReaction=async()=>null;
      G.players[p].deck.sort((a,b)=>a-b);
      if(o){
        if(selection.recycleBeforePlay&&selection.kind==='play')await fireEvent('onYouRecycle',{p});
        if(selection.kind==='hand'){
          putCardInHand(p,o.n,'#deck-'+p);
          applied=true;
          if(selection.recycleBeforePlay)await fireEvent('onYouRecycle',{p});
          if(play && polCanPlay(p,card(o.n)) && !playRestriction(card(o.n),p,false))
            await playCardFromHand(p,G.players[p].hand.length-1);
        }else {
          if(await playCardByEffect(p,o.n,selection.playOpts||{})===false)return;applied=true;
          if(selection.recycleAfterPlay)await fireEvent('onYouRecycle',{p});
        }
      }else if(selection.recycleBeforePlay)await fireEvent('onYouRecycle',{p});
      await simSettle(null,POLICY);
      if(G.winner===null&&G.turn===p&&G.state==='neutral'&&G.phase==='action'){
        const move=POLICY.movePlan(p);
        if(move){await moveUnits(p,move.units,move.dest);await simSettle(null,POLICY);}
      }
      for(const u of everyUnit()){u.tempM=u.tempM.filter(x=>x.dur!=='turn');u.dmg=0;}
    },POLICY,!!SIM.lock,false);return applied?value:null;};
    let best=skip?{v:skip.v,value:await probe(null,false)}:null;
    for(const o of ranked){
      if(Date.now()>SIM.deadline)break;
      let value=await probe(o,false);
      if(selection.kind==='hand'&&Date.now()<=SIM.deadline){
        const played=await probe(o,true);
        if(played!==null&&(value===null||played>value))value=played;
      }
      // A retained card still has distinct future value when neither can be
      // played now; evalState otherwise counts both as one identical card.
      if(value!==null&&selection.kind==='hand')value+=polKeepCardValue(p,o.n)*0.05;
      if(value!==null&&(!best||best.value===null||value>best.value+1e-9))best={v:o.v,value};
    }
    return best?.v??ranked[0].v;
  }finally{polVisibleCardDepth--;SIM.deadline=savedDeadline;}
}
function polPartyFavorChoice(p,options){
  const o=opp(p), P=G.players[p],O=G.players[o];
  const exhaustedRunes=q=>{
    const Q=G.players[q];
    return Math.min(1,Q.runeDeck.length)*(BOT_W.runeTotal-BOT_W.runeDeck);
  };
  // Drawing into an empty deck gives the other player a point before any
  // recycled card is drawn. This public risk takes precedence over card value.
  let cardValue=BOT_W.card*(1/(P.hand.length+1)-1/(O.hand.length+1));
  for(const q of [o,p])if(!G.players[q].deck.length){
    const winner=opp(q),sign=winner===p?1:-1;
    if(G.players[winner].points+1>=G.victory){cardValue=sign*10000;break;}
    cardValue+=sign*BOT_W.point;
  }
  const runeValue=exhaustedRunes(p)-exhaustedRunes(o);
  const want=cardValue>runeValue?'card':'rune';
  return options.find(x=>x.v===want)?.v??options[0].v;
}
let polResourceBranchDepth=0;
async function polResourceBranchChoice(p,options){
  const P=G.players[p],runes=P.runeDeck;
  const score=o=>{
    const op=o.effectBranch.ops[0];
    if(op.op==='draw')return P.deck.length?(P.hand.length<6?BOT_W.card:BOT_W.cardGlut):
      G.players[opp(p)].points+1>=G.victory?-10000:-BOT_W.point+(P.trash.length?BOT_W.card:0);
    return runes.length?BOT_W.runeTotal-BOT_W.runeDeck:0;
  };
  const fallback=[...options].sort((a,b)=>score(b)-score(a))[0];
  if(polResourceBranchDepth||NET.online||(SIM.movementDepth||0)>=2)return fallback.v;
  const counts=new Map();for(const n of runes)counts.set(n,(counts.get(n)||0)+1);
  const known=[...new Set(P.hand)].sort((a,b)=>polKeepCardValue(p,b)-polKeepCardValue(p,a)).slice(0,8);
  const turnHorizon=P.hand.includes(122);
  if(turnHorizon&&!known.includes(122))known.push(122);
  const follows=[null,...known.map(n=>({kind:'play',n}))];
  if(P.champInZone)follows.push({kind:'champ',n:P.champN});
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+600);
  polResourceBranchDepth++;
  try{
    let best=null;
    for(const option of options){
      const branch=option.effectBranch,channel=branch.ops[0].op==='channel';
      const outcomes=channel&&runes.length?[...counts].sort((a,b)=>a[0]-b[0]):[[undefined,1]];
      let total=0,complete=true;
      for(const [rune,count] of outcomes){
        let value=null;
        for(const follow of follows){
          if(Date.now()>SIM.deadline){complete=false;break;}
          let applied=false,ending=null;
          const result=await simTry(p,async()=>{
            polKaisaTurnPublicSample(p,0);
            if(rune!==undefined){const deck=G.players[p].runeDeck.sort((a,b)=>a-b),i=deck.indexOf(rune);deck.unshift(deck.splice(i,1)[0]);}
            await execOps(branch.ops,{p,n:branch.n,bfIdx:branch.bfIdx,
              unit:everyUnit().find(u=>u.uid===branch.unitUid),kind:'effect'});
            await cleanup(p);await simSettle(null,POLICY);
            if(follow&&G.winner===null){
              if(G.turn!==p||G.phase!=='action'||G.state!=='neutral'||!polCanPlay(p,card(follow.n))||playRestriction(card(follow.n),p,false))return;
              const act=follow.kind==='champ'?follow:{...follow,idx:G.players[p].hand.indexOf(follow.n)};
              if(act.kind==='play'&&act.idx<0||await POLICY.runAction(p,act)===false)return;
              await simSettle(null,POLICY);
            }
            // A funded extra turn and a normal resource reward must be priced
            // after the same End/Beginning horizon, including the no-play line.
            if(turnHorizon&&G.winner===null){ending=await polNextTurnOutcome(p,true);if(!ending)return;}
            applied=true;
          },POLICY,true,false);
          const resolved=ending?.value??result;
          if(applied&&result!==null&&(value===null||resolved>value))value=resolved;
        }
        if(!complete||value===null){complete=false;break;}
        total+=value*(channel&&runes.length?count/runes.length:1);
      }
      if(complete&&(!best||total>best.value+1e-7))best={v:option.v,value:total};
    }
    return best?.v??fallback.v;
  }finally{polResourceBranchDepth--;SIM.deadline=deadline;}
}
let polTriggerOrderDepth=0;
async function polTriggerOrderChoice(p,options){
  if(polTriggerOrderDepth || NET.online || !polSmart() || (SIM.movementDepth||0)>=2) return options[0].v;
  const items=options[0].triggerOrder.items, original=G;
  // Vanguard Helm's queued friendly buffs do not refer to the dying unit or
  // their gear copy. Identical Helm effects are interchangeable, including
  // combat deaths after a prepared march. Keep mixed effects on the normal
  // order search; the buff recipients are still chosen through the engine.
  if(items.every(x=>x.ctx.p===p&&x.ctx.n===228&&x.ctx.gear&&!x.ctx.unit&&!x.ctx.it&&
      x.ctx.ev==='onUnitDeath'&&polOrderDeathBuff(x.ctx.n)&&x.t.ops?.length===1&&
      x.t.ops[0].op==='buff'&&(x.t.ops[0].count||1)===1&&x.t.ops[0].spec?.side==='friendly'))return options[0].v;
  const had=Object.hasOwn(original,'_botTriggerOrder'), previous=original._botTriggerOrder;
  const deadline=SIM.deadline;
  SIM.deadline=Math.min(deadline||Infinity,Date.now()+Math.min(POLICY.budget||400,1000));
  original._botTriggerOrder=items;polTriggerOrderDepth++;
  try{
    let best=options[0],bestValue=-Infinity;
    for(const option of options){
      if(Date.now()>SIM.deadline)break;
      const value=await simTry(p,async()=>{
        UI.pickReaction=async()=>null;
        G.players[p].deck=polOwnDeckSample(p,0);
        const choices=G._botTriggerOrder, first=option.triggerOrder.index;
        const ordered=[choices[first],...choices.filter((_,i)=>i!==first)];
        (G._pendingTriggers||(G._pendingTriggers=[])).push(...ordered);
        await flushPendingTriggers();
      },POLICY,!!SIM.lock,false);
      if(value!==null&&value>bestValue+1e-7){best=option;bestValue=value;}
    }
    return best.v;
  }finally{
    if(had)original._botTriggerOrder=previous;else delete original._botTriggerOrder;
    SIM.deadline=deadline;polTriggerOrderDepth--;
  }
}
function polCombatTriggerFallback(options){
  const score=o=>o.combatTrigger.n===159?-10:
    o.combatTrigger.ops.some(op=>['damage','damageAll','dealSplit','dmgEqMyMight','teemoDefend','tfFury'].includes(op.op))?10:0;
  return options.map((o,i)=>i).sort((a,b)=>score(options[b])-score(options[a]));
}
let polCombatTriggerDepth=0;
function polCombatRuneOutcomes(p,entries,planningDeadline,otherChannel=false){
  const runeOrders=q=>{
    const deck=G.players[q].runeDeck,count=entries.filter(t=>t.p===q&&t.ab?.ops?.some(o=>o.op==='tfGamble')).length;
    if(q!==p){
      const types=CARDS.filter(c=>c.type==='Rune'&&card(G.players[q].legendN).dom.includes(c.dom[0])).map(c=>c.n);
      return (types.length?types:[7]).map(n=>({order:Array(deck.length).fill(n),weight:1/(types.length||1)}));
    }
    const counts=new Map();for(const n of deck)counts.set(n,(counts.get(n)||0)+1);
    const types=[...counts].sort((a,b)=>a[0]-b[0]),out=[];let truncated=false;
    function addPrefix(prefix,left,weight){
      if(truncated)return;
      if(out.length>=128||Date.now()>planningDeadline){truncated=true;return;}
      if(prefix.length===Math.min(count,deck.length)){
        out.push({order:[...prefix,...types.flatMap(([n],i)=>Array(left[i]).fill(n))],weight});return;
      }
      const total=left.reduce((s,n)=>s+n,0);
      left.forEach((available,i)=>{if(available){const next=[...left];next[i]--;addPrefix([...prefix,types[i][0]],next,weight*available/total);}});
    }
    addPrefix([],types.map(([,n])=>n),1);return truncated?null:out;
  };
  const ownRunes=runeOrders(p),otherRunes=otherChannel&&G.players[opp(p)].runeDeck.length>0||entries.some(t=>t.p!==p&&t.ab?.ops?.some(o=>o.op==='tfGamble'))
    ?runeOrders(opp(p)):[runeOrders(opp(p))[0]];
  if(!ownRunes)return null;
  if(otherRunes.length===1)otherRunes[0].weight=1;
  return ownRunes.flatMap(own=>otherRunes.map(other=>({own,other,weight:own.weight*other.weight})));
}
let polAvaHiddenDepth=0;
let polScriptChoiceDepth=0;
async function polRevealedHandOutcome(p,known){
  if(G.winner!==null||G.turn!==p||G.state!=='neutral'||G.phase!=='action')return null;
  const other=opp(p),turnOps=new Set(['extraTurn']),cards=[...new Set(known)].sort((a,b)=>
    Number(polHasRelocateOp(FX[b]?.playOps,null,turnOps))-Number(polHasRelocateOp(FX[a]?.playOps,null,turnOps))||
    polKeepCardValue(other,b)-polKeepCardValue(other,a));
  const counts=known.reduce((m,n)=>m.set(n,(m.get(n)||0)+1),new Map()),pairs=[],readyOps=new Set(['ready','openPlan']);
  for(const first of cards)for(const second of cards){
    if(first!==second||counts.get(first)>1)pairs.push([first,second]);
  }
  // Check deployment followed by readiness, and enter-ready setup followed by
  // deployment, before ordinary pairs. The actual engine still decides whether
  // the order, costs, targets and resulting attack are legal.
  const readyEntrant=n=>card(n).type==='Unit'&&(FX[n]?.entersReady||FX[n]?.kw?.accelerate);
  const pairPriority=plan=>Number(card(plan[0]).type==='Unit'&&polHasRelocateOp(FX[plan[1]]?.playOps,null,readyOps))+
    Number(polReadySetup(other,plan[0])&&card(plan[1]).type==='Unit')+Number(plan.every(readyEntrant));
  pairs.sort((a,b)=>pairPriority(b)-pairPriority(a));
  const triples=[];
  for(const pair of pairs){
    if(!pair.every(n=>card(n).type==='Unit'))continue;
    for(const effect of cards){
      const profile=polOrderProfile(effect);
      const readySupplier=profile.readyAura||profile.fx.activated?.some(ab=>
        polOrderProfile(effect,{kind:'ability',ab}).readyAura);
      if(!profile.team&&!readySupplier)continue;
      const group=[...pair,effect];
      if(group.some(n=>group.filter(x=>x===n).length>counts.get(n)))continue;
      if(profile.team)triples.push(group);
      if(readySupplier)triples.push([effect,...pair]);
    }
  }
  // Keep immediate extra-turn threats first, then inspect known formations:
  // ready-entry setup before both bodies, or a team effect after both bodies.
  // A played source may provide readiness through its public ability. Existing
  // prefix activations still pay costs and enforce Legion and copied-source rules.
  const extra=n=>polHasRelocateOp(FX[n]?.playOps,null,turnOps);
  const plans=[[],...cards.filter(extra).map(n=>[n]),...triples,
    ...cards.filter(n=>!extra(n)).map(n=>[n]),...pairs].flatMap(cards=>{
    // A known formation may need both bodies at base after ready-entry setup
    // or before a team enhancement.
    // Its actual ready entry can also come from a public aura. Native play owns
    // affordability, acceleration, funding and the effect's actual targets.
    if(cards.length!==3&&(cards.length!==2||!cards.every(readyEntrant)))return [{cards}];
    let accelerations=[{}];
    cards.forEach((n,i)=>{
      if(FX[n]?.kw?.accelerate)accelerations=accelerations.flatMap(a=>[false,true].map(value=>({...a,[i]:value})));
    });
    return [...accelerations.map(accelerate=>({cards,base:true,accelerate})),{cards}];
  });
  let worst=null;
  const partial=()=>worst===null?null:{value:worst,complete:false};
  // Each branch starts with the same actual End and Beginning. Only previously
  // shown cards may be played; a masked new draw is never a promised followup.
  for(let at=0;at<plans.length;at++){
    const plan=plans[at];
    if(SIM.deadline&&Date.now()>SIM.deadline)return partial();
    let valid=false;
    const value=await simTry(p,async()=>{
      await endTurn();await simSettle(null,POLICY);
      if(G.winner!==null||G.turn!==other||G.state!=='neutral'||G.phase!=='action'){valid=true;return;}
      const chain=plan.abilities||[];let used=0;
      for(let i=0;i<=plan.cards.length;i++){
        if(G.winner!==null||G.turn!==other||G.state!=='neutral'||G.phase!=='action')break;
        // Replay the chosen public abilities at their actual card prefix.
        // Legality is checked again after each activation: Sun Disc can make
        // Viktor's subsequent Recruit ready, whereas the reverse order cannot.
        while(chain[used]?.at===i){
          const abilities=polAbList(other).filter(c=>polAbLegal(other,c));
          const c=abilities[chain[used].ability];if(!c)return;
          if(await activateAbility(other,c.src,c.ab)===false)return;
          await simSettle(null,POLICY);used++;
          if(G.winner!==null||G.turn!==other||G.state!=='neutral'||G.phase!=='action')break;
        }
        if(G.winner!==null||G.turn!==other||G.state!=='neutral'||G.phase!=='action')break;
        // Extend only an already replayed prefix, including a second ability
        // at the same slot. Keep no-ability and single-ability plans; normal
        // costs and the caller's existing budget still bound the comparison.
        if(used===chain.length&&chain.length<2){
          const abilities=polAbList(other).filter(c=>polAbLegal(other,c));
          plans.splice(at+1,0,...abilities.map((_,ability)=>({...plan,
            abilities:[...chain,{at:i,ability}]})));
        }
        if(i===plan.cards.length||G.winner!==null||G.turn!==other||G.state!=='neutral'||G.phase!=='action')break;
        const n=plan.cards[i];
        const action=polOrderAction(other,{kind:'play',n});
        if(!action)return;
        const played=plan.base&&card(n).type==='Unit'?await polKaisaTurnRun(other,{...action,kaisaPlayLoc:'base',kaisaAccel:plan.accelerate?.[i]}):await POLICY.runAction(other,action);
        if(played===false)return;
        await simSettle(null,POLICY);
      }
      for(let m=0;m<Math.min(polTier().moves||1,2)&&G.winner===null&&G.turn===other&&G.state==='neutral';m++){
        const move=POLICY.movePlan(other);if(!move)break;
        await moveUnits(other,move.units,move.dest);await simSettle(null,POLICY);
      }
      if(G.winner===null&&G.turn===other&&G.state==='neutral'&&G.phase==='action'){
        await endTurn();await simSettle(null,POLICY);
      }
      valid=true;
    },POLICY,true,false);
    if(valid&&value!==null)worst=worst===null?value:Math.min(worst,value);
    else if(!plan.cards.length&&!plan.abilities?.length)return null;
    else if(SIM.deadline&&Date.now()>SIM.deadline)return partial();
    if(worst===-999)break;
  }
  return worst===null?null:{value:worst,complete:true};
}
async function polScriptChoice(p,options,selection){
  const gear=selection.op.op==='adaptatron',rocket=selection.op.op==='rocketRecover',
    guerrilla=selection.op.op==='guerrilla',discardPlay=selection.op.op==='jawsReplay',nocturne=selection.op.op==='nocturnePlay',
    deathSave=selection.op.op==='deathSave',judgment=selection.op.op==='divineJudgment',revealed=selection.op.op==='revealHandPick',nativePlay=selection.op.op==='spellKillReactionPlay'||nocturne,
    ready=selection.op.op==='readySomething',recovery=selection.op.op==='trashToHand'||rocket||guerrilla,
    followPlay=recovery||discardPlay||nativePlay||deathSave||judgment||revealed||ready,optional=!!selection.op.optional;
  const judgmentHand=judgment&&selection.resume.stage==='hand',judgmentGear=judgment&&selection.resume.stage==='gear',
    judgmentRune=judgment&&selection.resume.stage==='rune';
  const blocked=ready&&everyUnit().some(u=>u.ctrl!==p&&u.loc!=='base'&&unitFx(u).jailerReady);
  const legal=options.filter(o=>(!ready||(!blocked||!['u','g'].includes(o.v.t))&&
    (o.v.t!=='g'||polReadyGearUseful(o.v.g.n)))&&
    (!optional||rocket||guerrilla||!polMfAuroraDeck(p)||!polMfCostBlocked(p,{pips:o.powerCost||[]})));
  const judgmentValue=o=>{
    if(judgmentRune)return polJudgmentValue(p,o.judgmentKeep);
    if(judgmentHand)return polJudgmentValue(p,o.judgmentKeep)+(polCanPlay(p,card(o.n))?10:0);
    if(judgmentGear){
      const x=o.judgmentKeep;
      return polJudgmentValue(p,x)+(x.p===p&&!x.kept&&(!x.g||!x.g.ex)&&G.turn===p&&polReadyGearUseful(x.n)?10:0);
    }
    const u=everyUnit().find(u=>u.uid===o.v),kept=selection.resume.keepU;
    let value=polJudgmentValue(p,{kind:'unit',p:u.ctrl,u,kept:kept.has(u)});
    // Inspect a new legal holder before spending the limited budget on base
    // bodies; actual recycling and the subsequent turn determine its value.
    if(!kept.has(u)&&u.ctrl===p&&u.loc!=='base'&&G.bfs[u.loc].controller===p&&!effKw(u).temporary&&
      ![...kept].some(x=>x.ctrl===p&&x.loc===u.loc&&!effKw(x).temporary))
      value+=BOT_W.control*Math.min(evalTau(p),3)/2+(evalHoldForecast(p).win?15:0);
    return value;
  };
  let ranked=revealed?[...legal].sort((a,b)=>(polMfAuroraDeck(p)?polMfDiscardPriority(p,b.n)-polMfDiscardPriority(p,a.n):0)||
    polKeepCardValue(opp(p),b.n)-polKeepCardValue(opp(p),a.n)):judgment?[...legal].sort((a,b)=>judgmentValue(b)-judgmentValue(a)):ready?[...legal].sort((a,b)=>polReadyOptionValue(p,b)-polReadyOptionValue(p,a)):gear?[...legal].sort((a,b)=>{
    const value=o=>(o.v.pi===p?-1:1)*polKeepCardValue(o.v.pi,o.n);return value(b)-value(a);
  }):recovery?[...legal].sort((a,b)=>(rocket?-1:1)*(polKeepCardValue(p,b.n)-polKeepCardValue(p,a.n))):
    polMfAuroraDeck(p)?[...legal].sort((a,b)=>(card(b.n).m||0)-(card(a.n).m||0)):legal;
  if(judgmentHand)ranked=ranked.filter((o,i,a)=>a.findIndex(x=>x.n===o.n)===i);
  else if(judgment&&!judgmentGear&&!judgmentRune&&!G.showdown&&!selection.remaining?.ordered?.length&&!selection.remaining?.unordered?.length&&!G._pendingTriggers?.length){
    const seen=new Set();
    ranked=ranked.filter(o=>{
      const u=everyUnit().find(u=>u.uid===o.v),fx=unitFx(u);
      if(u.gear?.length||fx.activated?.length||fx.statics?.length||Object.values(fx.triggers||{}).some(ts=>ts.length))return true;
      // Identical ordinary bodies have the same recycling result. Keep the
      // already protected group distinct and avoid retrying each copy.
      const key=JSON.stringify({unit:{...u,uid:undefined},kept:selection.resume.keepU.has(u)});
      if(seen.has(key))return false;seen.add(key);return true;
    });
  }
  const planValue=o=>o.ns.reduce((s,n)=>s+polKeepCardValue(p,n),0);
  if(guerrilla){
    const cards=ranked.filter((o,i,a)=>a.findIndex(x=>x.n===o.n)===i);
    const plans=cards.map(o=>({...o,ns:[o.n]}));
    if(selection.op.remainingPicks!==1)for(let i=0;i<cards.length;i++)for(let j=i;j<cards.length;j++){
      if(i===j&&options.filter(o=>o.n===cards[i].n).length<2)continue;
      plans.push({...cards[i],ns:[cards[i].n,cards[j].n]});
    }
    // Inspect combinations with usable spells/readiness or hostile on-play
    // effects before spending the budget on ordinary exhausted bodies.
    const immediate=o=>o.ns.filter(n=>polCanPlay(p,card(n))&&(card(n).type==='Spell'||
      polReadyDeployment(p,n)||polHasCombatEngineOp(FX[n]?.triggers?.onPlay,false))).length;
    ranked=plans.sort((a,b)=>immediate(b)-immediate(a)||b.ns.length-a.ns.length||planValue(b)-planValue(a));
  }
  const finish=choice=>{
    if(guerrilla&&selection.plan)selection.plan.nextNs=choice?choice.ns.slice(1):[];
    return choice?.v??null;
  };
  const savedUnit=deathSave&&everyUnit().find(u=>u.uid===selection.uid);
  const fleetingSave=deathSave&&savedUnit&&(savedUnit.isToken||unitFx(savedUnit).temporary||effKw(savedUnit).temporary);
  const acceptFallback=deathSave?!fleetingSave&&(!selection.legend||!(selection.pendingDeaths||[...(_dyingBatch||[])]).some(u=>
    u.ctrl===p&&u.buff>0&&!u._dead&&!u.isToken&&!u._highlander&&!unitFx(u).temporary&&!effKw(u).temporary&&
    evalCombatRemovalValue(u)>evalCombatRemovalValue(savedUnit))):
    rocket?ranked.length>0&&(polKeepCardValue(p,ranked[0].n)<polKeepCardValue(p,252)||
    ranked[0].n===6&&!TF().noPlay[p]&&canPay(p,0,['Fury'])):
    !gear||POLICY.confirm(p,'',null,{botChoice:{kind:'gearBuff',unitUid:selection.ctx.unit?.uid}});
  const fallback=acceptFallback?(guerrilla?[...ranked].sort((a,b)=>planValue(b)-planValue(a))[0]:
    judgmentHand?[...ranked].sort((a,b)=>polKeepCardValue(p,b.n)-polKeepCardValue(p,a.n))[0]:
    judgmentGear?[...ranked].sort((a,b)=>polJudgmentValue(p,b.judgmentKeep)-polJudgmentValue(p,a.judgmentKeep))[0]:ranked[0])||null:null;
  if(!ranked.length||NET.online||polScriptChoiceDepth||polPaidChoiceDepth||(SIM.movementDepth||0)>=2)return finish(fallback);
  // Ordered pairs need more work than a single visible play. Keep the caller's
  // deadline and use the existing MF reveal budget for this choice only.
  const planningDeadline=Math.min(SIM.deadline||Infinity,Date.now()+(revealed?1800:700));
  if(Date.now()>planningDeadline)return finish(fallback);
  const pending=selection.remaining,entries=[...(G.showdown?.chain||[]),
    ...[...(pending?.ordered||[]),...(pending?.unordered||[]),...(G._pendingTriggers||[])].map(x=>({p:x.ctx.p,ab:x.t}))];
  const outcomes=polCombatRuneOutcomes(p,entries,planningDeadline,revealed);if(!outcomes)return finish(fallback);
  const P=G.players[p],samples=new Set([...P.deck,...P.trash]).size>1?3:1;
  const turnHorizon=followPlay&&(P.hand.includes(122)||options.some(o=>o.n===122)||nocturne&&selection.seen.includes(122));
  const known=followPlay?[...new Set([...P.hand,...(nocturne?selection.seen:[])])].slice(0,8):[];
  const handPremium=()=>G.players[p].hand.reduce((s,n)=>s+polKeepCardValue(p,n)*0.05,0);
  const heldPremium=()=>handPremium()+(guerrilla?G.bfs.reduce((s,b)=>s+b.hiddenCards.filter(h=>h.by===p)
    .reduce((v,h)=>v+polKeepCardValue(p,h.n)*0.05,0),0):0);
  const initialHandPremium=rocket||guerrilla||judgmentHand?heldPremium():0;
  // The generic state score prices most gear only by printed cost. Keep the
  // existing protection/engine premium when evaluating this sacrifice choice,
  // including gear consumed by a later conquest in the same continuation.
  const gearPremium=()=>G.players[p].gear.reduce((s,g)=>s+
    Math.max(0,polKeepCardValue(p,g.n)-3)*BOT_W.unitBase,0);
  const initialGearPremium=gear||judgmentGear?gearPremium():0;
  const activeCtx=typeof BOT!=='undefined'&&BOT.seat===p?BOT.ctx:null;
  const moves=typeof activeCtx?.movesLeft==='number'?activeCtx.movesLeft:polTier().moves;
  const original=G,had=Object.hasOwn(original,'_botScriptChoice'),previous=original._botScriptChoice,deadline=SIM.deadline;
  original._botScriptChoice=selection;SIM.deadline=planningDeadline;polScriptChoiceDepth++;
  try{
    let best=optional?null:fallback,bestValue=-Infinity,undecided=null;
    for(const choice of optional?[null,...ranked]:ranked){
      if(Date.now()>SIM.deadline)break;
      // Recovery does not play the card for free. Compare retaining it and
      // paying for one known followup, with the same opportunities for each pick.
      const incoming=rocket?252:choice?.n;
      const incomingCards=judgmentHand?[choice.n]:discardPlay||nativePlay||deathSave||judgment||revealed||ready?[]:guerrilla?choice?.ns||[]:[incoming];
      const follows=followPlay?[null,...[...new Set([...incomingCards,...known])]
        .map(n=>({kind:'play',n}))]:[null];
      // These choices need an actual follow-up. Inspect known plays before
      // the unused-body continuation consumes their limited comparison time.
      if(fleetingSave||judgment)follows.push(follows.shift());
      if((discardPlay||nativePlay||deathSave||judgment||ready)&&P.champInZone)follows.push({kind:'champ',n:P.champN});
      // A readied Shrine can draw a new playable card after the known kill.
      // The second play is chosen from that sample's now-visible hand.
      if(ready)follows.unshift(...known.map(n=>({kind:'playThenObserved',n})));
      if(guerrilla){
        if(choice?.ns.length===2){
          follows.unshift({kind:'playPair',ns:choice.ns});
          if(choice.ns[0]!==choice.ns[1])follows.unshift({kind:'playPair',ns:[...choice.ns].reverse()});
        }
        follows.push({kind:'hideRecovered'});
      }
      if(turnHorizon&&!follows.some(a=>a?.n===122))follows.push({kind:'play',n:122});
      const heldBefore=recovery?P.hand.filter(n=>n===incoming).length:0;
      const readyIndex=choice?.v?.t==='g'?P.gear.indexOf(choice.v.g):choice?.v?.t==='r'?P.runes.indexOf(choice.v.r):-1;
      // A forecast of destroying the opposing engine on a later conquest is
      // less secure than removing it during this already-resolving effect.
      const immediateRemoval=revealed?polKeepCardValue(opp(p),choice.n)*0.05:gear&&choice&&choice.v.pi!==p?
        polKeepCardValue(choice.v.pi,choice.n)*0.05:0;
      let total=0,complete=true;
      outcomes:for(const runes of outcomes)for(let sample=0;sample<samples;sample++){
        let sampleBest=-Infinity;
        for(const followup of follows){
          let valid=false,premium=0,ending=null;
          const value=await simTry(p,async()=>{
            polKaisaTurnPublicSample(p,sample);
            G.players[p].runeDeck=[...runes.own.order];G.players[opp(p)].runeDeck=[...runes.other.order];
            _rngState=(Math.floor(polHash('trash-play-sample',G.turnCount,p,sample)*0x7fffffff)|1)>>>0;
            const q=G._botScriptChoice;delete G._botScriptChoice;delete G._botTriggerRemainder;
            if(revealed)G.players[opp(p)].hand=q.revealedHand.slice();
            const option=UI.pickOption;let picked=false,pickCount=0;
            const confirm=UI.confirmP,handPick=UI.pickHandCard,unitPick=UI.pickUnitFrom;
            if(judgmentHand||judgmentGear||judgmentRune)UI.pickOption=(pi,t,opts,...rest)=>{
              if(pi===p&&!picked&&opts.some(o=>o.scriptChoice?.resume.stage===q.resume.stage)){
                picked=true;return opts.find(o=>judgmentHand?o.boardCard.index===choice.boardCard.index:o.v===choice.v)?.v??null;
              }
              return option(pi,t,opts,...rest);
            };else if(judgment)UI.pickUnitFrom=(pi,us,t,opt,x)=>{
              if(pi===p&&!picked&&x?.scriptChoice?.op.op==='divineJudgment'){
                picked=true;return us.find(u=>u.uid===choice.v)||null;
              }
              return unitPick(pi,us,t,opt,x);
            };else if(discardPlay||nativePlay||deathSave){
              UI.confirmP=(pi,t,c,x)=>{
                if(pi===p&&!picked&&x?.botChoice?.op?.op===q.op.op&&x.botChoice.n===q.n&&
                  (!deathSave||x.botChoice.uid===q.uid&&!!x.botChoice.legend===!!q.legend)){picked=true;return choice!==null;}
                return confirm(pi,t,c,x);
              };
            }else if(rocket){
              UI.confirmP=(pi,t,c,x)=>{
                if(pi===p&&!picked&&x?.botChoice?.kind==='rocketRecover'){
                  picked=true;return choice!==null;
                }
                return confirm(pi,t,c,x);
              };
              UI.pickHandCard=(pi,t,x)=>pi===p&&x?.botChoice?.kind==='rocketRecover'?choice?.v??null:handPick(pi,t,x);
            }else if(guerrilla)UI.pickOption=(pi,t,opts,...rest)=>{
              if(pi===p&&opts.some(o=>o.scriptChoice?.op.op===q.op.op)){
                picked=true;const n=choice?.ns[pickCount++];
                return n===undefined?null:opts.find(o=>o.n===n)?.v??null;
              }
              return option(pi,t,opts,...rest);
            };else UI.pickOption=(pi,t,opts,...rest)=>{
              if(pi===p&&!picked&&opts.some(o=>o.scriptChoice?.op.op===q.op.op)){
                picked=true;return choice?opts.find(o=>ready?
                  o.v.t===choice.v.t&&(o.v.t==='u'?o.v.u.uid===choice.v.u.uid:
                    o.v.t==='g'?G.players[p].gear.indexOf(o.v.g)===readyIndex:
                    o.v.t==='r'?G.players[p].runes.indexOf(o.v.r)===readyIndex:true):gear?
                  o.v.pi===choice.v.pi&&o.v.i===choice.v.i:revealed?
                  o.v.i===choice.v.i&&o.n===choice.n:o.n===choice.n)?.v??null:null;
              }
              return option(pi,t,opts,...rest);
            };
            try{
              if(deathSave)await deathSaveChoiceContinue(p,q);
              else if(judgment)await execOps([{...q.op,resume:q.resume}],q.ctx);
              else if(nocturne)await nocturneChoiceContinue(p,q);
              else if(nativePlay)await spellKillReactionPlay(p,q.n);
              else await execOps([q.op],q.ctx);
            }finally{UI.pickOption=option;UI.confirmP=confirm;UI.pickHandCard=handPick;UI.pickUnitFrom=unitPick;}
            if(!picked)return;
            if(revealed&&q.ctx.resolvingSpell?.mySeq!==undefined){
              const s=q.ctx.resolvingSpell;
              await finishSpellEffects(s.owner,s.n,FX[s.n],s.execAs,s.fromHidden,s.mySeq);
            }
            for(const x of q.remaining?.ordered||[]){if(G.winner!==null)break;await fireTriggeredAbility(x.t,x.ctx);}
            if(G.winner===null&&q.remaining?.unordered?.length){
              (G._pendingTriggers||(G._pendingTriggers=[])).push(...q.remaining.unordered);await flushPendingTriggers();
            }
            await cleanup(p);
            if(G.winner===null&&G.showdown?.ending){
              G.showdown.stage='scoring';await resolveShowdown();
            }else if(G.showdown?.resolvingItem){
              const sd=G.showdown;sd.resolvingItem=false;await flushCombatTriggers(sd);sd.passes=0;
              if(sd.chain.length)G.actingPlayer=sd.chain[sd.chain.length-1].p;
            }
            await simSettle(null,POLICY);
            if(G.winner===null&&G.turn===p&&G.phase==='action'&&G.state==='neutral'){
              if(followup){
                if(followup.kind==='hideRecovered'){
                  for(let i=0;i<2;i++){
                    const act=POLICY.hidePlan(p,{tried:new Set(),movesLeft:moves});if(!act)break;
                    if(await POLICY.runAction(p,act)===false)return;await simSettle(null,POLICY);
                  }
                }else for(const step of followup.kind==='playPair'?followup.ns.map(n=>({kind:'play',n})):
                  followup.kind==='playThenObserved'?[{kind:'play',n:followup.n},{kind:'observedPlay'}]:[followup]){
                  if(G.winner!==null)break;
                  const act=step.kind==='observedPlay'?await POLICY.playPlan(p,{tried:new Set(),movesLeft:moves}):polOrderAction(p,step);
                  if(!act){if(step.kind==='observedPlay')continue;return;}
                  if(await POLICY.runAction(p,act)===false)return;await simSettle(null,POLICY);
                }
              }
              const ctx={tried:new Set(),movesLeft:moves};
              const ability=G.winner===null&&(await POLICY.abilityPlan(p,ctx,false)||await POLICY.abilityPlan(p,ctx,true));
              if(ability){await POLICY.runAction(p,ability);await simSettle(null,POLICY);}
              if(G.winner===null&&(moves>0||polMfExtraMove(p))){
                POLICY.turnPlan=null;const mv=await polMfMoveChoice(p,true);
                if(mv){await moveUnits(p,mv.units,mv.dest);await simSettle(null,POLICY);}
              }
            }
            if(revealed&&G.winner===null){
              const known=q.revealedHand.filter((n,i)=>i!==choice.v.i);
              // A publicly recycled card is a known next draw only when it is
              // the sole card in that deck, rather than its unknown top card.
              const O=G.players[opp(p)];if(q.op.action==='recycle'&&O.deck.length===1&&O.deck[0]===choice.n)known.push(choice.n);
              ending=await polRevealedHandOutcome(p,known);
            }else if(turnHorizon&&G.winner===null){ending=await polNextTurnOutcome(p,true);if(!ending)return;}
            polKaisaSpellFinishMaterial();
            premium=gear||judgmentGear?gearPremium()-initialGearPremium:0;
            // A recalled Temporary body left at base cannot provide a Hold:
            // it dies before its owner's next scoring. Price actual use above,
            // rather than rewarding an unused body as lasting material.
            if(deathSave){
              const kept=everyUnit().find(u=>u.uid===selection.uid&&u.ctrl===p);
              if(kept?.loc==='base'&&effKw(kept).temporary)
                premium-=might(kept)*BOT_W.unitBase+kept.buff*BOT_W.buff;
            }
            if(rocket||guerrilla||judgmentHand)premium+=heldPremium()-initialHandPremium;
            else if(recovery&&G.players[p].hand.filter(n=>n===incoming).length>heldBefore)
              premium+=polKeepCardValue(p,incoming)*0.05;
            valid=true;
          },POLICY,!!SIM.lock,false);
          const result=ending?.value??value;
          if(revealed&&ending?.complete===false){
            // An unfinished search is not a proven win. Retain it only as an
            // alternative to choices already proven to allow an opposing win.
            if(valid&&result!==null&&result>-999+1e-7)undecided=choice;
            complete=false;break;
          }
          if(valid&&result!==null)sampleBest=Math.max(sampleBest,result+(Math.abs(result)!==999?premium+immediateRemoval:0));
          if(sampleBest===999)break;
          if(Date.now()>SIM.deadline){complete=false;break;}
        }
        if(!complete||sampleBest===-Infinity){complete=false;break outcomes;}
        total+=sampleBest*runes.weight/samples;
      }
      // An equally good continuation may remove the enemy gear only at the
      // next conquest. Prefer removing it now rather than relying on that move.
      if(complete&&(total>bestValue+1e-7||gear&&choice&&choice.v.pi!==p&&
        Math.abs(total-bestValue)<1e-7&&(!best||best.v.pi===p))){best=choice;bestValue=total;}
      if(complete&&Math.abs(total-999)<1e-7)break;
    }
    return finish(undecided&&Math.abs(bestValue+999)<1e-7?undecided:best);
  }finally{
    if(had)original._botScriptChoice=previous;else delete original._botScriptChoice;
    SIM.deadline=deadline;polScriptChoiceDepth--;
  }
}
async function polAvaHiddenChoice(p,options,payment=null){
  const legal=options.filter(o=>polAvaPlayable(p,o.n,o.hiddenEffectLoc,payment?['Mind']:[]));
  const fallback=[...legal].sort((a,b)=>polKeepCardValue(p,b.n)-polKeepCardValue(p,a.n))[0]||null;
  if(!fallback||!polSmart()||NET.online||polAvaHiddenDepth||(SIM.movementDepth||0)>=2)return fallback;
  const planningDeadline=Math.min(SIM.deadline||Infinity,Date.now()+700);
  if(Date.now()>planningDeadline)return fallback;
  const frame=payment?.frame,entries=[...(frame?[frame.trigger,...frame.after,...frame.others]:[]),...(G.showdown?.chain||[])];
  const outcomes=polCombatRuneOutcomes(p,entries,planningDeadline);if(!outcomes)return fallback;
  const samples=new Set(G.players[p].deck).size>1?3:1;
  const original=G,had=Object.hasOwn(original,'_botAvaChoice'),previous=original._botAvaChoice,deadline=SIM.deadline;
  original._botAvaChoice=payment;SIM.deadline=planningDeadline;polAvaHiddenDepth++;polCombatTriggerDepth++;
  try{
    let best=fallback,bestValue=-Infinity;
    // The optional decision is before payment. Once paid, a legal card must be selected.
    for(const choice of payment?[null,...legal]:legal){
      if(Date.now()>SIM.deadline)break;
      let total=0,complete=true;
      outcomes:for(const result of outcomes)for(let sample=0;sample<samples;sample++){
        let valid=true;
        const value=await simTry(p,async()=>{
          polKaisaTurnPublicSample(p,sample);
          G.players[p].runeDeck=[...result.own.order];G.players[opp(p)].runeDeck=[...result.other.order];
          const ctx=G._botAvaChoice;delete G._botAvaChoice;
          const confirm=UI.confirmP,option=UI.pickOption;
          const sourceUid=payment?ctx.unitUid:choice?.hiddenEffectSourceUid;
          UI.confirmP=(q,t,c,x)=>q===p&&x?.botChoice?.kind==='hiddenPlay'&&x.botChoice.unitUid===sourceUid
            ?!!choice:confirm(q,t,c,x);
          UI.pickOption=(q,t,opts,...rest)=>q===p&&choice&&opts.some(o=>o.hiddenEffectPlay&&o.hiddenEffectSourceUid===sourceUid)
            ?opts.find(o=>o.n===choice.n)?.v??null:option(q,t,opts,...rest);
          const sd=G.showdown;
          if(ctx?.frame&&sd){
            const f=ctx.frame,ordered=[...f.after].reverse();if(choice)ordered.push(f.trigger);
            const waiting=sd.pendingTriggers||[],board=UI.pickBoardOrder,pick=UI.pickOption,rank=o=>ordered.indexOf(o.combatTrigger?.entry);
            UI.pickBoardOrder=(q,t,opts,...rest)=>q===p&&opts.every(o=>rank(o)>=0)
              ?opts.map((o,i)=>({i,r:rank(o)})).sort((a,b)=>a.r-b.r).map(x=>x.i):board(q,t,opts,...rest);
            UI.pickOption=(q,t,opts,...rest)=>q===p&&opts.every(o=>rank(o)>=0)
              ?[...opts].sort((a,b)=>rank(a)-rank(b))[0].v:pick(q,t,opts,...rest);
            sd.finalizingTriggers=false;sd.initialTriggers=f.first===sd.attacker;
            sd.pendingTriggers=[...ordered,...f.others];await flushCombatTriggers(sd);
            sd.pendingTriggers.push(...waiting);await flushCombatTriggers(sd);
          }else if(choice){
            if(payment)payCost(p,0,['Mind']);
            const n=choice.n,c=card(n),loc=choice.hiddenEffectLoc;
            const ok=await playCardFromHand(p,G.players[p].hand.indexOf(n),{byEffect:true,ignoreEnergy:true,ignorePower:true,
              ...(c.type==='Unit'?{playLoc:loc,locByEffect:true}:{})});
            if(ok===false){valid=false;return;}
            await cleanup(p);
          }
          // The current Ava operation has finished in this copy, so the remaining chain may proceed.
          if(sd&&G.showdown===sd){
            sd.resolvingItem=false;await flushCombatTriggers(sd);sd.passes=0;
            if(sd.chain.length)G.actingPlayer=sd.chain[sd.chain.length-1].p;
          }
          await simSettle(null,POLICY);
        },POLICY,!!SIM.lock,false);
        if(!valid||value===null){complete=false;break outcomes;}
        total+=value*result.weight/samples;
      }
      if(complete&&total>bestValue+1e-7){best=choice;bestValue=total;}
      if(complete&&Math.abs(total-999)<1e-7)break;
    }
    return best;
  }finally{
    if(had)original._botAvaChoice=previous;else delete original._botAvaChoice;
    SIM.deadline=deadline;polAvaHiddenDepth--;polCombatTriggerDepth--;
  }
}
async function polCombatTriggerOrder(p,options){
  const fallback=polCombatTriggerFallback(options),context=options[0]?.combatTrigger?.order;
  if(!context||!polSmart()||NET.online||polCombatTriggerDepth||(SIM.movementDepth||0)>=2||
      !G.showdown||G.showdown.ending)return fallback;
  const planningDeadline=Math.min(SIM.deadline||Infinity,Date.now()+1000);
  if(Date.now()>planningDeadline)return fallback;
  const plans=[],seen=new Set(),add=xs=>{const key=xs.join(',');if(!seen.has(key)){seen.add(key);plans.push(xs);}};
  add(fallback);
  if(options.length<=4){
    function permute(prefix,rest){if(!rest.length){add(prefix);return;}for(const i of rest)permute([...prefix,i],rest.filter(j=>j!==i));}
    permute([],fallback);
  }else{
    for(const i of fallback)add([i,...fallback.filter(j=>j!==i)]);
    for(let i=0;i<fallback.length&&plans.length<64;i++)for(let j=i+1;j<fallback.length&&plans.length<64;j++){
      const order=[...fallback];[order[i],order[j]]=[order[j],order[i]];add(order);
    }
  }
  const entries=[...context.prior,...context.items,...context.others,...G.showdown.chain];
  const runeOutcomes=polCombatRuneOutcomes(p,entries,planningDeadline);
  if(!runeOutcomes)return fallback;
  const samples=new Set(G.players[p].deck).size>1?3:1;
  const original=G,had=Object.hasOwn(original,'_botCombatOrder'),previous=original._botCombatOrder,deadline=SIM.deadline;
  original._botCombatOrder=context;SIM.deadline=planningDeadline;polCombatTriggerDepth++;
  try{
    let best=fallback,bestValue=-Infinity;
    for(const order of plans){
      if(Date.now()>SIM.deadline)break;
      let total=0,complete=true;
      outcomes:for(const {own,other,weight} of runeOutcomes)for(let sample=0;sample<samples;sample++){
        const value=await simTry(p,async()=>{
          polKaisaTurnPublicSample(p,sample);G.players[p].runeDeck=[...own.order];G.players[opp(p)].runeDeck=[...other.order];
          const ctx=G._botCombatOrder;delete G._botCombatOrder;
          const ordered=[...ctx.prior,...order.map(i=>ctx.items[i])],sd=G.showdown,waiting=sd.pendingTriggers||[];
          const board=UI.pickBoardOrder,option=UI.pickOption,rank=o=>ordered.indexOf(o.combatTrigger?.entry);
          UI.pickBoardOrder=(q,t,opts,...rest)=>q===p&&opts.every(o=>rank(o)>=0)
            ?opts.map((o,i)=>({i,r:rank(o)})).sort((a,b)=>a.r-b.r).map(x=>x.i):board(q,t,opts,...rest);
          UI.pickOption=(q,t,opts,...rest)=>q===p&&opts.every(o=>rank(o)>=0)
            ?[...opts].sort((a,b)=>rank(a)-rank(b))[0].v:option(q,t,opts,...rest);
          sd.finalizingTriggers=false;sd.initialTriggers=ctx.first===sd.attacker;
          sd.pendingTriggers=[...ordered,...ctx.others];await flushCombatTriggers(sd);
          sd.pendingTriggers.push(...waiting);await flushCombatTriggers(sd);await simSettle(null,POLICY);
        },POLICY,!!SIM.lock,false);
        if(value===null){complete=false;break outcomes;}
        total+=value*weight/samples;
      }
      if(complete&&total>bestValue+1e-7){best=order;bestValue=total;}
      if(complete&&Math.abs(total-999)<1e-7)break;
    }
    return best;
  }finally{
    if(had)original._botCombatOrder=previous;else delete original._botCombatOrder;
    SIM.deadline=deadline;polCombatTriggerDepth--;
  }
}
POLICY.boardOrder=async function(p,title,options){
  const policy=this||POLICY;
  if(policy.option===POLICY.option&&options.length&&options.every(o=>o.combatTrigger))return polCombatTriggerOrder(p,options);
  const remaining=options.map((option,index)=>({option,index})),ordered=[];
  while(remaining.length){
    const pick=await policy.option(p,title,remaining.map((x,i)=>({...x.option,v:i})));
    const at=Number.isInteger(pick)&&remaining[pick]?pick:0;ordered.push(remaining.splice(at,1)[0].index);
  }
  return ordered;
};
POLICY.option = function(p, title, options){
  const kp=POLICY._kaisaSpellTarget;
  if(kp?.n===104 && kp.p===p && kp.tc===G.turnCount && options?.some(o=>o.returnHand)){
    POLICY._kaisaSpellTarget=null;
    if(kp.pending && (G._rwFor!==p||G._returnPending?.pre!==kp.pending.pre||G._returnPending?.n!==kp.pending.n))return null;
    return options.find(o=>o.returnHand?.uid===kp.uid)?.v??null;
  }
  if(!options || !options.length) return null;
  if(polSmart()&&options[0].scriptChoice){
    const selection=options[0].scriptChoice;
    if(selection.op.op==='guerrilla'&&selection.op.remainingPicks===1&&selection.plan?.nextNs){
      const n=selection.plan.nextNs.shift();return n===undefined?null:options.find(o=>o.n===n)?.v??null;
    }
    return polScriptChoice(p,options,selection);
  }
  if(polSmart()&&options.every(o=>o.effectBranch?.ops?.length===1&&
      ['draw','channel'].includes(o.effectBranch.ops[0].op)&&o.effectBranch.ops[0].n===1))
    return polResourceBranchChoice(p,options);
  if(options[0].triggerOrder)return polTriggerOrderChoice(p,options);
  const visible=options.find(o=>o.visibleCardChoice)?.visibleCardChoice;
  if(polSmart()&&visible && !(polMfAuroraDeck(p)&&visible.kind==='hand'))
    return polVisibleCardChoice(p,options,visible);
  if(polSmart()&&options.some(o=>o.partyFavor))return polPartyFavorChoice(p,options);
  if(polSmart()&&!polMfAuroraDeck(p)&&options.every(o=>o.boardCard?.kind==='hand'&&o.boardCard.reveal))
    return [...options].sort((a,b)=>polKeepCardValue(a.boardCard.p,b.n)-polKeepCardValue(a.boardCard.p,a.n))[0].v;
  if(polSmart()&&options[0].extortion)return polExtortionOption(p,options);
  const effectTarget=options.find(o=>o.effectTarget)?.effectTarget;
  if(polSmart() && effectTarget){
    if(effectTarget.op.op==='gunsBlazing'){
      const bp=polMfBulletPlan(p,!!G.showdown);
      if(bp){
        POLICY._mfBulletPlan={p,tc:G.turnCount,sd:G.showdown||null,signature:polMfBulletSignature(p),...bp};
        return options.find(o=>o.v===bp.bfIdx)?.v??options[0].v;
      }
    }else if(['bfDamageEnemies','powerSiphon','pickKillGear','fadingMemory'].includes(effectTarget.op.op))
      return polEffectOptionChoice(p,options,effectTarget);
  }
  // Ready-rune choices are free resource recovery, not strategic modes. The
  // general option ablation must not randomly choose "stop" with tired runes left.
  if(/^준비할 룬 \(/.test(String(title||''))){
    const rune=options.filter(o=>o.v?.r?.ex).sort((a,b)=>polRuneValue(p,b.v.r)-polRuneValue(p,a.v.r))[0];
    if(rune) return rune.v;
  }
  if(String(title)==='재활용할 룬 선택 (강제)'){
    return [...options].sort((a,b)=>{
      const r=G.players[p].runes;
      return (r[a.v].ex?0:10)+polRuneValue(p,r[a.v])-(r[b.v].ex?0:10)-polRuneValue(p,r[b.v]);
    })[0].v;
  }
  if(String(title)==='처치할 아군 유닛/도구 (비용)'){
    const loss=o=>o.v.t==='u'?evalCombatRemovalValue(o.v.u):polKeepCardValue(p,G.players[p].gear[o.v.i].n);
    return [...options].sort((a,b)=>loss(a)-loss(b))[0]?.v??null;
  }
  if(String(title)==='재활용할 카드 선택 (덱 맨 아래로)')
    return [...options].sort((a,b)=>polKeepCardValue(p,a.n)-polKeepCardValue(p,b.n))[0].v;
  if(/^폐기장에서 회수할 \[숨겨짐\] 카드/.test(String(title)))
    return [...options].sort((a,b)=>polKeepCardValue(p,b.n)-polKeepCardValue(p,a.n))[0].v;
  if(options.some(o=>o.deathReplacement)){
    // 무료 강제 대체를 비용이 드는 선택 대체보다 먼저 적용한다.
    return [...options].sort((a,b)=>Number(b.deathReplacement.forced)-Number(a.deathReplacement.forced))[0].v;
  }
  if(String(title)==='카드를 숨길 전장'){
    const eligible=options.filter(o=>{
      const b=G.bfs[o.v];return b&&b.hiddenCards.filter(h=>h.by===p).length<polHideCap(b)&&
        !b.units.some(u=>u.ctrl!==p&&unitFx(u).blockReveal);
    });
    return eligible.sort((a,b)=>G.bfs[b.v].units.filter(u=>u.ctrl===p).reduce((x,u)=>x+might(u),0)
      -G.bfs[a.v].units.filter(u=>u.ctrl===p).reduce((x,u)=>x+might(u),0))[0]?.v??null;
  }
  if(String(title)==='우디르: 하나 선택'){
    const u=everyUnit().find(u=>u.uid===options[0].udyrUid);if(!u)return null;
    const enemy=everyUnit().filter(x=>x.ctrl!==p&&x.loc!=='base');
    const scores={
      dmg:Math.max(0,...enemy.filter(x=>x.dmg+2+effDmgBonus(x,p)>=targetMight(x)).map(evalCombatRemovalValue)),
      stun:Math.max(0,...enemy.filter(x=>!x.stunned).map(x=>might(x)*0.1)),
      ready:u.ex&&!u.stunned&&u.dmg<might(u)-1&&
        !enemy.some(x=>unitFx(x).jailerReady)&& (u.loc==='base'||effKw(u).ganking)?2:0,
      gank:!u.ex&&!u.stunned&&u.loc!=='base'&&G.bfs.some((b,i)=>i!==u.loc&&b.controller!==p&&evalAttackValue(p,i,[u])>BOT_W.moveNeed)?1:0
    };
    return [...options].sort((a,b)=>scores[b.v]-scores[a.v]).find(o=>scores[o.v]>0)?.v??null;
  }
  if(options.some(o=>o.hiddenEffectPlay)){
    return polAvaHiddenChoice(p,options).then(choice=>choice?.v??null);
  }
  if(String(title)==='폐기할 도구')return [...options].sort((a,b)=>{
    const score=o=>(o.v.pi===p?-1:1)*polKeepCardValue(o.v.pi,o.n);
    return score(b)-score(a);
  })[0]?.v??null;
  if(polSmart() && /폐기할 도구 선택/.test(String(title)))
    return [...options].sort((a,b)=>polKeepCardValue(p,a.n)-polKeepCardValue(p,b.n))[0].v;
  if(options.some(o=>o.judgmentKeep))
    return [...options].sort((a,b)=>polJudgmentValue(p,b.judgmentKeep)-polJudgmentValue(p,a.judgmentKeep))[0].v;
  if(String(title)==='준비시킬 대상 (선택)'){
    const blocked=everyUnit().some(u=>u.ctrl!==p&&u.loc!=='base'&&unitFx(u).jailerReady);
    const legal=options.filter(o=>(!blocked||!['u','g'].includes(o.v.t)) &&
      (o.v.t!=='g'||polReadyGearUseful(o.v.g.n)));
    if(!legal.length) return null;
    return polMfReadyOption(p,legal);
  }
  if(options.some(o=>o.resourceOps)) return polResourceFundingChoice(p,options);
  const confirmation=options.find(o=>o.costConfirmation)?.costConfirmation;
  if(confirmation){
    if(!POLICY.confirm(p,confirmation.text,confirmation.preview,confirmation.context)) return null;
    return POLICY.option(p,confirmation.pickTitle,options.map(({costConfirmation,...o})=>o));
  }
  if(options.some(o=>o.placement)) return polPlacementPlan(p,options).then(r=>r.option.v);
  if(options.some(o=>o.teemoFetch)) return polTeemoFetchOption(p,options);
  if(options.some(o=>o.hidePayment)) return (options.find(o=>o.v==='energy')||options[0]).v;
  if(options.every(o=>o.combatTrigger)){
    if(options[0].combatTrigger.order)return polCombatTriggerOrder(p,options).then(order=>options[order[0]].v);
    return options[polCombatTriggerFallback(options)[0]].v;
  }
  // 선후공 선택(주사위 승리): 선공을 고른다
  if(options.some(o=>o.v==='first') && options.some(o=>o.v==='second')){ polSay('option','선공','주사위 승리 — 선공 선택'); return 'first'; }
  if(options.some(o=>o.movement || o.returnHand)) return polMovementOption(p,options);
  const txt = String(title||'');
  if(polMfAuroraDeck(p)){
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
    // 속임수 덱: 엔진 조각을 찾되, 선택지가 전부 유닛이면 오로라가 공짜로 뽑을
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
POLICY.hand = function(p, title, selection){
  const h = G.players[p].hand;
  if(!h.length) return null;
  const rocket=selection?.botChoice;
  if(polSmart()&&rocket?.kind==='rocketRecover'&&Number.isInteger(rocket.discardIndex)&&
      h[rocket.discardIndex]===rocket.discardN)return rocket.discardIndex;
  if(polSmart() && selection?.ops?.some(o=>o.op==='dmgLastDiscardCost')){
    return (async()=>{
    const op=selection.ops.find(o=>o.op==='dmgLastDiscardCost'),raw=selection.ctx?.pre?.get(op);
    const uid=Array.isArray(raw)?raw[0]:raw,u=everyUnit().find(x=>x.uid===uid);
    if(u){
      // The target is fixed before resolution, but the discarded card is not.
      // Spend the cheapest useful damage source when deeper comparison is busy.
      const ranked=h.map((n,i)=>({n,i,lethal:!TF().preventSpellDmg&&dmgPlus(card(n).e||0,u,p)>=targetMight(u)-u.dmg}))
        .sort((a,b)=>Number(b.lethal)-Number(a.lethal)||polKeepCardValue(p,a.n)-polKeepCardValue(p,b.n));
      if(!polSpecialChoiceDepth&&!NET.online&&(SIM.movementDepth||0)<2){
        const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+Math.min(POLICY.budget||400,800));
        polSpecialChoiceDepth++;
        try{
          let best=null;
          for(const a of ranked){
            if(Date.now()>SIM.deadline)break;
            const value=await polSpecialEffectProbe(p,{...selection,op,ops:selection.ops},uid,a.n);
            if(value!==null&&(!best||value>best.value+1e-7))best={a,value};
          }
          return (best?.a||ranked[0]).i;
        }finally{polSpecialChoiceDepth--;SIM.deadline=deadline;}
      }
      return ranked[0].i;
    }
    })().then(i=>i??POLICY.hand(p,title));
  }
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
    if(n===6&&canPay(p,0,['Fury'])&&!TF().noPlay[p])s+=80;
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
function polNeutralReactionMaterial(){
  // The declared effect/combat has already resolved. Preserve its actual
  // survivors and permanent buffs, but do not price unused turn-only defence
  // as lasting material against an attack that has not been declared.
  for(const u of everyUnit()){
    u.dmg=0;
    u.tempM=u.tempM.filter(m=>m.dur!=='turn'&&m.dur!=='combat');
    for(const k of Object.keys(u.grants))if(k!=='temporary')delete u.grants[k];
  }
  TF().buffPlus=[0,0];
}
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
      if(act){
        G._rwFor=p;
        if(await POLICY.runAction(p,act)===false) throw new Error('hidden response became invalid');
      }
      G._rwFor=null;
      await polResolveReturnPending();
      await cleanup(pending.p);
      await simSettle(null,POLICY);
      polNeutralReactionMaterial();
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
  const pendingSpell=options.find(o=>o.pendingSpell)?.pendingSpell;
  const pending=pendingSpell||options.find(o=>o.pendingAbility)?.pendingAbility;
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
  // 격발 능력은 주문이 아니다. 토큰의 일시적 처치는 원본 카드 번호도 없다.
  if(pendingSpell && !G.showdown && !TF().noPlay[p] && polTier().rep>=2){
    const target=card(pendingSpell.n);
    if(target?.type==='Spell' && pendingSpell.p!==p){
      for(const n of G.players[p].hand){
        const c=card(n),fx=FX[n];
        if(c.type!=='Spell' || !fx?.kw?.reaction || !(fx.counter||fx.steal)) continue;
        if(fx.counter?.maxE!==undefined && (target.e||0)>fx.counter.maxE) continue;
        if(fx.counter?.maxPips!==undefined && powerPips(target).length>fx.counter.maxPips) continue;
        const plan=polResourceFundingPlan(p,applyCostMods(p,c,c.e||0),powerPips(c),true);
        if(!plan?.length) continue;
        const option=options.find(o=>o.v?.ab?.key===plan[0].key);
        if(!option) continue;
        polSay('reaction',option.label,'카운터 비용 충당',{counter:n,pending:pendingSpell.n});
        return option.v;
      }
    }
  }
  const returns=options.filter(o=>Number.isInteger(o.v?.hand) && o.card &&
    !(FX[o.card.n]?.counter||FX[o.card.n]?.steal) &&
    (polIsReturnSpell(o.card.n) || pending?.p!==p &&
      (polEngineTrick(o.card.n)||polEnhanceOps((FX[o.card.n]?.playOps||[]).flatMap(g=>g.ops||[])))));
  if(pending && returns.length && !SIM.lock && !NET.online){
    // 응수 창이 닫힌 뒤의 해결·클린업 — G._rwFor(닫힌 상태 표시)를 지워야 샌드박스의 cleanup이 통제 해제·결전 개시를 한다 (190.6 · 341)
    // 대기 주문을 보드와 같은 그래프로 복제해야 도구 등의 객체 참조가 유지된다.
    // 복제 뒤 원본 pending을 넣으면 실제로 남아 있는 대상도 사라진 것으로 판단한다.
    const probe=async act=>{
      const original=G,had=Object.prototype.hasOwnProperty.call(original,'_returnPending');
      const previous=original._returnPending;
      try{original._returnPending=pending;return await simTry(p,async()=>{
        UI.pickReaction=async()=>null;await act();
        await simSettle();
        polNeutralReactionMaterial();
      },POLICY);}
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
        ? '응수 시뮬레이션 실패' : '공개 대기 효과와 응수의 실제 결과 비교',{before,after});
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
const POL_OWN_FORECAST_OPS=new Set(['lookTopPlayUnit','lookTopHand','timelineReset','blindRage','promisingFuture','partyFavor']);
function polOwnForecastSpell(n){
  return card(n).type==='Spell'&&polHasRelocateOp(FX[n]?.playOps,null,POL_OWN_FORECAST_OPS);
}
function polForecastOpponent(p,n,salt){
  const O=G.players[opp(p)];
  if(![25,115,201].includes(n))return;
  const domains=new Set(card(O.legendN).dom||[]);
  const champTag=card(O.legendN).name.split(' - ')[0];
  // A public-domain model, not the opponent's stored deck or deckList. Its
  // samples are possible outcomes, not claims about the hidden deck contents.
  const pool=CARDS.filter(c=>['Unit','Gear','Spell'].includes(c.type)&&
    c.super!=='Token' && (c.super!=='Signature'||c.tags?.includes(champTag)) &&
    (c.dom||[]).every(d=>d==='Colorless'||domains.has(d)) &&
    (typeof isBanned!=='function'||!isBanned(c.n)) && !FX[c.n]?.counter && !FX[c.n]?.steal)
    .map(c=>c.n).sort((a,b)=>a-b);
  if(!pool.length)pool.push(13);
  let seed=(Math.floor(polHash('public-domain-outcome',G.turnCount,salt)*0x7fffffff)|1)>>>0;
  for(let i=pool.length-1;i>0;i--){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const j=seed%(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];
  }
  O.deck=Array.from({length:O.deck.length},(_,i)=>pool[i%pool.length]);
  if(n===201&&!polTier().peek)O.hand=O.hand.map(()=>13);
}
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
const POL_COMBAT_ENGINE_OPS=new Set([
  'damage','damageAll','kill','killAll','eachPlayerKills','stun','stunAll',
  'dealSplit','dmgEqMyMight','dmgLastDiscardCost','bfDamageEnemies','itDealsTo',
  'challenge','fightMutual','gentlemenDuel','facebreaker','guillotine','foxfire',
  'killAllGear','eachKillsGear','pickKillGear','kingsDecree','divineJudgment',
  'powerSiphon','highlanderMark','extortion','gunsBlazing','openPlan',
  'token','vanguardTokens','harrowing','trashToHand','guerrilla','fadingMemory',
]);
function polHasCombatEngineOp(value,specialOnly=false){
  if(!value || typeof value!=='object') return false;
  if(Array.isArray(value)) return value.some(v=>polHasCombatEngineOp(v,specialOnly));
  if(POL_COMBAT_ENGINE_OPS.has(value.op) &&
      (!specialOnly || !['damage','damageAll','kill','killAll'].includes(value.op)) ||
    value.op==='setFlag' && ['dmgKill','preventSpellDmg'].includes(value.flag) ||
    !specialOnly && value.op==='might' && (value.n<0 || value.all || value.spec?.count==='all')) return true;
  return ['ops','elseOps','inner','branches'].some(k=>polHasCombatEngineOp(value[k],specialOnly));
}
function polEngineTrick(n){
  // 피해·처치는 사망 격발까지, 광역 효과는 다른 전장의 병력·통제까지 비교한다.
  // 전체 강화/위력 감소도 대상 수와 적용 직후 치명 판정을 엔진에 맡긴다.
  if(n===268)return false; // Amount and battlefield use the shared paid Bullet Time comparison.
  const ops=(FX[n]?.playOps||[]).flatMap(g=>g.ops||[]);
  // Pure stun already has an exact combat snapshot and its material threshold.
  // Paired stuns and stateful scripts still need the real engine below.
  if(ops.length && ops.every(op=>op.op==='stun'))return false;
  return polIsReturnSpell(n)||n===128||n===203||(n===207&&!NET.online)||polHasCombatEngineOp(FX[n]?.playOps)||polOwnForecastSpell(n);
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
  if(POLICY.ab.ability&&!polPaidChoiceDepth)for(const c of polAbList(p)){
    const cost=c.ab.cost||{};
    if(!(POL_AB_HARDCOST.some(k=>cost[k])||cost.recycleTrash)||!polAbLegal(p,c))continue;
    const act={kind:'ability',src:c.src,ab:c.ab,key:c.key,label:c.name+' '+c.ab.label};
    if(polAbIsResource(c)){
      for(const n of new Set(G.players[p].hand)){
        const fx=FX[n]||{};
        if((fx.kw?.action||fx.kw?.reaction)&&!playRestriction(card(n),p,false))candidates.push({...act,fundCard:n});
      }
    }else candidates.push(act);
  }
  if(!candidates.length) return null;
  const neutralChain=!G.showdown?.hasCombat;
  const deadline=SIM.deadline; SIM.deadline=deadline||Date.now()+1000;
  try{
    const probe=(act,forecastN,sample)=>simTry(p,async()=>{
        if(forecastN!==undefined){G.players[p].deck=polOwnDeckSample(p,sample);polForecastOpponent(p,forecastN,sample);}
        const prior=new Map(everyUnit().map(u=>[u.uid,new Set(u.tempM)]));
        if(act && await POLICY.runAction(p,act)===false) throw new Error('showdown action became invalid');
        if(act?.fundCard){
          const i=G.players[p].hand.indexOf(act.fundCard);
          if(i<0||await playCardFromHand(p,i)===false)throw new Error('funded trick unavailable');
        }
        await simSettle(null,POLICY);
        if(neutralChain){polNeutralReactionMaterial();return;}
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
      let after;
      if(act.n!==undefined&&polOwnForecastSpell(act.n)){
        let gain=0,complete=true;
        for(let s=0;s<3;s++){
          if(Date.now()>SIM.deadline){complete=false;break;}
          const base=await probe(null,act.n,s),result=await probe(act,act.n,s);
          if(base===null||result===null){complete=false;break;}
          gain+=result-base;
        }
        after=complete?before+gain/3:null;
      }else after=await probe(act);
      if(after!==null && after>before+BOT_W.moveNeed && (!best || after>best.value)) best={act,value:after};
    }
    if(best) polSay('showdown',best.act.label||card(best.act.n).ko,'실제 효과 해결로 결전 결과 개선',{delta:best.value-before});
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
  const resource=op=>['draw','channel','channelOrDraw'].includes(op.op)||
    op.op==='ifPaid' && op.ops?.length && op.elseOps?.length &&
      op.ops.every(resource) && op.elseOps.every(resource);
  return ops.length>0 && ops.every(resource);
}
function polConditionalResourceSpell(fx){
  return !!fx&&polNeutralResourceSpell(fx)&&
    (fx.playOps||[]).some(group=>group.ops?.some(op=>op.op==='ifPaid'));
}
function polReadyDeployment(p,n){
  // Kai'Sa already compares acceleration, targets and card order in its full
  // turn planner. Keep that planner's baseline free of a second readiness search.
  if(polKaisaDeck(p)) return false;
  const fx=FX[n]||{};
  if(n===146) return everyUnit().some(u=>u.ctrl===p && u.ex);
  return card(n).type==='Unit' && (fx.entersReady || fx.kw?.accelerate || TF().enterReady[p] ||
    (fx.triggers?.onPlay||[]).some(group=>(group.ops||[]).some(op=>op.op==='ready')));
}
function polReadySetup(p,n){
  if(polKaisaDeck(p) || TF().enterReady[p] || card(n).type!=='Spell') return false;
  const ops=(FX[n]?.playOps||[]).flatMap(g=>g.ops||[]);
  const ready=op=>op.op==='setFlag' && op.flag==='enterReady' && op.val===true;
  return ops.some(ready) && ops.every(op=>ready(op)||op.op==='draw');
}
function polDeploymentEffect(n){
  return n!==undefined&&card(n).type==='Unit'&&(FX[n]?.triggers?.onPlay||[]).some(g=>g.ops?.length);
}
function polRiskyDeployment(n){
  return n!==undefined&&polHasRelocateOp(FX[n]?.triggers?.onPlay,null,new Set(['discard','fightMutual','damageAll']));
}
POLICY.pickPlay = async function(p, blocked){
  const P = G.players[p];
  const budget = readyRunes(p).length - POLICY.reserve(p);
  let cands = [];
  P.hand.forEach((n,i)=>{
    if(blocked && blocked.has('h'+n)) return;
    if(polHard() && n===122) return; // Extra turns require a paid, full-turn comparison.
    const c = card(n);
    if(polAssaultBonus(n)) return; // 공격 결전의 전용 평가까지 보류
    if(!polOffensivePlayable(p,n)) return;
    if(POLICY.ab.canpay ? !polCanPlay(p, c) : polCost(c) > readyRunes(p).length) return;
    const alternate=polAlternativePlayCost(p,c);
    const reserveCost=alternate ? Math.max(0,alternate.energy-P.energy-(c.type==='Spell'?P.energySpell||0:0))
      +Math.max(0,alternate.pips.length-Object.values(P.power).reduce((a,b)=>a+b,0)-(c.type==='Spell'?P.powerSpell||0:0)) : polCost(c);
    if(POLICY.ab.reserve && reserveCost > Math.max(0, budget)) return;  // 상대 턴 응수분은 남긴다
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
    else if(polHard() && (fx.kw.action||fx.kw.reaction||polHasCombatEngineOp(fx.playOps,true)||polOwnForecastSpell(n)) && !polNeutralResourceSpell(fx)) score = -1;
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
  // Keep a proved Aurora/ramp priority, but do not bypass every other special
  // effect in this deck. Candidate costs still obey its response/ramp reserves.
  const coreResource=core&&FX[core.n]&&polNeutralResourceSpell(FX[core.n]);
  const mfPriority=polMfAuroraDeck(p)&&core&&POLICY._playScore>=7000;
  if(mfPriority&&!coreResource) return core;
  const P=G.players[p], seen=new Set(), candidates=[];
  P.hand.forEach((n,idx)=>{
    if(seen.has(n) || ctx.tried?.has('h'+n)) return;
    seen.add(n);
    const readyDeployment=polReadyDeployment(p,n),deploymentEffect=!polKaisaDeck(p)&&polDeploymentEffect(n), fx=FX[n]||{};
    const enhancement=!polKaisaDeck(p) && card(n).type==='Spell' &&
      polEnhanceOps((fx.playOps||[]).flatMap(g=>g.ops||[]));
    const conditionalResource=polConditionalResourceSpell(fx);
    if(!readyDeployment && !deploymentEffect && !enhancement && !conditionalResource && !polOwnForecastSpell(n) && (card(n).type!=='Spell' || !polHasCombatEngineOp(fx.playOps))) return;
    if(core?.kind==='play' && core.n===n && !deploymentEffect) return;
    if(!polCanPlay(p,card(n)) || playRestriction(card(n),p,false) ||
        !polOffensivePlayable(p,n) || polMfNeutralCardBlocked(p,n)) return;
    candidates.push({kind:'play',idx,n,readyDeployment,deploymentEffect});
  });
  if(P.champInZone && core?.kind!=='champ' && !ctx.tried?.has('champ') &&
      (polReadyDeployment(p,P.champN)||!polKaisaDeck(p)&&polDeploymentEffect(P.champN)) && polCanPlay(p,card(P.champN)) && !playRestriction(card(P.champN),p,false) && !polMfNeutralCardBlocked(p,P.champN))
    candidates.push({kind:'champ',n:P.champN,readyDeployment:polReadyDeployment(p,P.champN),deploymentEffect:polDeploymentEffect(P.champN)});
  // Enter-ready setup needs a second, known card. Never justify it using the
  // identity of the card that its draw might reveal.
  const stock=P.hand.reduce((m,n)=>m.set(n,(m.get(n)||0)+1),new Map());
  const units=[...stock.keys()].filter(n=>card(n).type==='Unit' && !ctx.tried?.has('h'+n))
    .map(n=>({kind:'play',n}));
  if(P.champInZone && !ctx.tried?.has('champ')) units.push({kind:'champ',n:P.champN});
  for(const [idx,n] of P.hand.entries()){
    if(P.hand.indexOf(n)!==idx || ctx.tried?.has('h'+n) || !polReadySetup(p,n) ||
        !polCanPlay(p,card(n)) || playRestriction(card(n),p,false) || polMfNeutralCardBlocked(p,n)) continue;
    for(const unit of units) candidates.push({kind:'play',idx,n,readySetupUnit:unit});
  }
  if(!candidates.length&&!coreResource) return core;
  const savedDeadline=SIM.deadline;
  const compareMovementEffects=candidates.some(a=>a.readyDeployment);
  const compareNextTurn=polNextTurnSpecial(p)||[core,...candidates].some(a=>a&&(
    ['onEndTurn','onBeginning','onHold'].some(event=>FX[a.n]?.triggers?.[event]?.length) ||
    polHasRelocateOp(FX[a.n]?.playOps,null,new Set(['fadingMemory']))));
  SIM.deadline=Math.min(savedDeadline||Infinity,Date.now()+Math.min(POLICY.budget||400,1000));
  polNeutralRemovalDepth++;
  try{
    const revealOps=new Set(['revealHandPick']);
    const masksOpponentHand=!polTier().peek&&[core,...candidates].some(a=>a&&
      (polHasRelocateOp(FX[a.n]?.playOps,null,revealOps)||polHasRelocateOp(FX[a.n]?.triggers?.onPlay,null,revealOps)));
    const probe=async (act,followup=act?.readySetupUnit,forecastN,sample)=>{
      let result=null;
      const value=await simTry(p,async()=>{
        const enemies=new Set(everyUnit().filter(u=>u.ctrl!==p).map(u=>u.uid));
        if(masksOpponentHand)G.players[opp(p)].hand=G.players[opp(p)].hand.map(()=>13);
        // Own remaining composition is known; card order is not. Every candidate
        // draws from the same canonical order without touching the real deck.
        if(forecastN===undefined)G.players[p].deck.sort((a,b)=>a-b);
        else {
          G.players[p].deck=polOwnDeckSample(p,sample);
          polForecastOpponent(p,forecastN,sample);
        }
        // Neutral response windows are separate from simSettle: explicitly pass
        // them as well so hidden opposing counters cannot steer this comparison.
        UI.pickReaction=async()=>null;
        POLICY.turnPlan=null;
        if(act && await POLICY.runAction(p,act)===false) return;
        await simSettle(null,POLICY);
        const lostImmediately=G.winner===opp(p);
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
          const move=compareMovementEffects?await polMfMoveChoice(p,true):POLICY.movePlan(p);
          if(!move) break;
          const beforeMove=simHash(G);
          await moveUnits(p,move.units,move.dest);await simSettle(null,POLICY);
          if(simHash(G)===beforeMove) break;
        }
        const surviving=new Set(everyUnit().filter(u=>u.ctrl!==p).map(u=>u.uid));
        const removed=[...enemies].filter(uid=>!surviving.has(uid)).length;
        const ending=compareNextTurn?await polNextTurnOutcome(p,true):null;
        // Damage and this-turn Might that failed to secure removal/control expire;
        // they are not a material advantage to carry into the next turn.
        for(const u of everyUnit()){
          u.tempM=u.tempM.filter(m=>m.dur!=='turn');
          u.dmg=0;
          // A Sprite left unused at base cannot become permanent future
          // material: Temporary kills it before our next Beginning score.
          // A deployed battlefield body can still defend during the other turn.
          if(u.isToken&&u.loc==='base'&&effKw(u).temporary&&
              !unitFx(u).triggers?.onDeath?.length&&
              !everyUnit().some(x=>unitFx(x).triggers?.onUnitDeath?.length))removeUnit(u);
        }
        result={removed,won:G.winner===p,lostImmediately,points:G.players[p].points,holds:evalHolds(p),ending,
          complete:G.winner!==null||!compareNextTurn||!!ending};
      },POLICY,!!SIM.lock,false);
      return value===null || !result?.complete ? null : {...result,value:result.ending?.value??value};
    };
    let baseline=await probe(core);
    if(!baseline) return core;
    // Resource spells can draw after a partial/failed channel. Never sacrifice
    // the game to a mandatory burnout merely because ramp has a high priority.
    if(core&&baseline.lostImmediately){
      const wait=await probe(null);
      if(wait&&!wait.lostImmediately){core=null;baseline=wait;}
    }
    // An optional cost can turn a replacement draw into real card advantage.
    // Compare its actual payment and draw against keeping the card/resources.
    if(core&&polConditionalResourceSpell(FX[core.n])){
      const wait=await probe(null);
      if(wait&&baseline.value<=wait.value+BOT_W.moveNeed){core=null;baseline=wait;}
    }
    if(mfPriority&&core) return core;
    if(core&&polRiskyDeployment(core.n)){
      const wait=await probe(null);
      if(wait&&wait.value>baseline.value+BOT_W.moveNeed){core=null;baseline=wait;}
    }
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
    const forecastCache=new Map();
    const forecast=async act=>{
      const n=act.n;
      let references=forecastCache.get(n);
      if(!references){
        references=[];
        for(let s=0;s<3;s++){
          if(Date.now()>SIM.deadline)return null;
          const before=await probe(core,core?.readySetupUnit,n,s);
          if(!before)return null;references.push(before);
        }
        forecastCache.set(n,references);
      }
      let total=0,last=null;
      for(let s=0;s<3;s++){
        if(Date.now()>SIM.deadline)return null;
        const after=await probe(act,undefined,n,s);
        if(!after)return null;total+=after.value-references[s].value;last=after;
      }
      return {...last,value:baseline.value+total/3};
    };
    for(const act of candidates){
      if(Date.now()>SIM.deadline) break;
      const result=polOwnForecastSpell(act.n)?await forecast(act):await probe(act);
      const reference=act.readySetupUnit?setupBaseline:baseline;
      // Gear loss, buffs, recovery and readiness can improve the real line
      // without killing an enemy unit. The same paid, settled baseline decides.
      if(!result) continue;
      if(!act.readyDeployment && !act.deploymentEffect && !act.readySetupUnit && !result.won && !result.removed &&
          !polHasCombatEngineOp(FX[act.n]?.playOps)&&!polConditionalResourceSpell(FX[act.n])&&!polOwnForecastSpell(act.n))continue;
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
      // Ordinary public hold income happens before the attacker can move.
      // A field scored by holding also counts toward the final-point rule.
      const forecast=evalHoldForecast(o),scoredBf={};
      G.bfs.forEach((bf,bi)=>{if(bf.controller===o&&bf.units.some(u=>u.ctrl===o&&!effKw(u).temporary))scoredBf[bi]=true;});
      G={...G,players:G.players.map((P,q)=>({...P,...(q===o?{scoredBf,points:P.points+forecast.points}:{}),
          base:P.base.filter(u=>q!==o||!effKw(u).temporary).map(polNextTurnUnit)})),
        bfs:G.bfs.map((bf,bi)=>({...bf,scored:{...bf.scored,[o]:!!scoredBf[bi]},
          units:bf.units.filter(u=>u.ctrl!==o||!effKw(u).temporary).map(polNextTurnUnit)}))};
    }
    // Public gankers at other battlefields can attack too. At the next
    // awakening exhausted/stunned units recover; turn-only grants do not.
    const atk=everyUnit().filter(u=>u.ctrl===o&&!u.ex&&!u.stunned&&u.loc!==i
      &&(u.loc==='base'||effKw(u).ganking)).concat(polPeekIncoming(p))
      .sort((a,b)=>might(b)-might(a));
    if(!atk.length) return -Infinity;
    let best=-Infinity; const send=[];
    const groups=atk.map(u=>[u]);
    for(const u of atk){send.push(u);if(send.length>1)groups.push([...send]);}
    for(const group of groups){
      const defenders=nextTurn?(extra||[]).map(polNextTurnUnit):extra;
      const combat=evalCombat(o,i,group,defenders);
      // Preventing an immediate winning conquest outweighs material savings.
      if(combat.winsGame) return 999;
      const v=evalAttackValue(o,i,group,defenders);
      if(v>best) best=v;
    }
    return best;
  }finally{G=original;}
}

// Compare single reinforcements and both small/large prefixes. The strongest
// prefix alone misses a cheap sufficient guard and can break Yi's solo bonus.
function polReinforcementGroups(units){
  const groups=[],seen=new Set();
  const add=us=>{const key=us.map(u=>u.uid).sort((a,b)=>a-b).join(',');
    if(!seen.has(key)){seen.add(key);groups.push(us);}};
  for(const u of units)add([u]);
  for(const order of [[...units].sort((a,b)=>might(a)-might(b)),[...units].sort((a,b)=>might(b)-might(a))])
    for(let n=2;n<=order.length;n++)add(order.slice(0,n));
  return groups;
}

// ══════════ 이동 계획 ══════════
function polMfAttackGroups(units){
  const strong=[...units].sort((a,b)=>might(b)-might(a)), groups=[],seen=new Set();
  const add=us=>{const key=us.map(u=>u.uid).sort((a,b)=>a-b).join(',');if(us.length&&!seen.has(key)){seen.add(key);groups.push(us);}};
  for(let i=1;i<=strong.length;i++)add(strong.slice(0,i));
  for(const u of strong.filter(u=>u.n===162||['onAttack','onAttackOrDefend','onMoveSelf'].some(e=>unitFx(u).triggers?.[e]?.length)||effKw(u).deflect)){
    const rest=strong.filter(x=>x!==u);
    add([u]);add([u,...rest.slice(0,1)]);add([u,...rest.slice(0,2)]);
  }
  add(strong.filter(u=>!effKw(u).tank)); // 방패/탱커는 다음 수비에 남기는 후보
  return groups;
}
function polMfExtraMove(p){
  return polMfAuroraDeck(p)&&everyUnit().some(u=>u.ctrl===p&&!u.ex&&(u.turnMoves||0)>0);
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
async function polMfMoveChoice(p,force=false,movesLeft=1){
  const fallback=POLICY.movePlan(p);
  if(NET.online||!polHard()||SIM.active&&(!force||(SIM.movementDepth||0)>=2)) return fallback;
  const ready=everyUnit().filter(u=>u.ctrl===p&&!u.ex&&(u.loc==='base'||effKw(u).ganking));
  if(!ready.length) return null;
  // An expiring combat advantage must be used now. This is common to all decks,
  // including global reductions: an earlier focus/no-attack plan may be stale.
  const temporaryWindow=ready.some(u=>u._armory||effKw(u).temporary || u.tempM.some(t=>t.dur==='turn'&&t.v>0)) ||
    G.bfs.some(b=>b.units.some(u=>u.ctrl!==p&&u.tempM.some(t=>t.dur==='turn'&&t.v<0)));
  // Public listeners also live on legends, gear, battlefields and in trash.
  // They can make an otherwise simple conquest profitable or immediately lethal.
  const globalMove=hasEventListeners('onMoveToBf',p);
  const moveWindow=globalMove || ready.some(u=>unitFx(u).triggers?.onMoveSelf?.length ||
    u.loc!=='base'&&FX[G.bfs[u.loc].n]?.triggers?.onMoveFromHere?.length);
  const triggerWindow=moveWindow || everyUnit().some(u=>['onAttack','onDefend','onAttackOrDefend','onConquer','onDeath']
    .some(event=>unitFx(u).triggers?.[event]?.length)) ||
    ['onConquerYou','onUnitDeath','onYouKillStunned'].some(event=>hasEventListeners(event,p)||hasEventListeners(event,opp(p))) ||
    G.bfs.some(b=>['onDefendHere','onConquerHere'].some(event=>FX[b.n]?.triggers?.[event]?.length));
  if(!force&&!polMfAuroraDeck(p)&&!temporaryWindow&&!triggerWindow) return fallback;
  const plan=POLICY.turnPlan?.p===p&&POLICY.turnPlan.tc===G.turnCount?POLICY.turnPlan:null;
  // A reinforcement competes with ending the turn under the same public attack.
  // Immediate board value alone can reject the move the gank ability prepared.
  const defendCounterplay=!temporaryWindow&&G.turn===p&&G.phase==='action'&&G.state==='neutral'&&
    G.bfs.some((b,i)=>b.controller===p&&b.units.some(u=>u.ctrl===p)&&
      ready.some(u=>u.loc!==i)&&polThreatAt(p,i)>0.05);
  if(plan?.noAttack&&!temporaryWindow&&!triggerWindow&&!defendCounterplay) return fallback;
  const deadline=SIM.deadline;SIM.deadline=deadline||Date.now()+1200;
  try{
    const probe=async(action,rune)=>{let sacrificesWithoutControl=false,fieldValue=0;
      const value=await simTry(p,async()=>{
      POLICY.turnPlan=null;
      UI.pickReaction=async()=>null;
      if(defendCounterplay)polKaisaTurnPublicSample(p);
      G.players[p].deck.sort((a,b)=>a-b);
      if(rune!==undefined){
        const deck=G.players[p].runeDeck.sort((a,b)=>a-b),i=deck.indexOf(rune);
        if(i>=0)deck.unshift(deck.splice(i,1)[0]);
      }
      if(action){
        const ids=action.units.map(u=>u.uid);
        await moveUnits(p,everyUnit().filter(u=>ids.includes(u.uid)),action.dest);
      }
      await simSettle(null,POLICY);
      if(action&&triggerWindow&&!polMfAuroraDeck(p)&&!temporaryWindow&&
          G.bfs[action.dest].controller===opp(p)&&
          !everyUnit().some(u=>action.units.some(a=>a.uid===u.uid)))sacrificesWithoutControl=true;
      // Compare the whole remaining movement window. A first conquest's draw
      // and garrison premium must not spend the unit that can take another lane.
      // Callers without a recorded allowance retain the one-move horizon.
      if(action)for(let i=1;i<Math.min(movesLeft,polTier().moves||1)&&G.winner===null&&
          G.turn===p&&G.phase==='action'&&G.state==='neutral';i++){
        if(SIM.deadline&&Date.now()>SIM.deadline)throw new SimBudget('deadline');
        const move=POLICY.movePlan(p);if(!move)break;
        const before=simHash(G);
        await moveUnits(p,move.units,move.dest);await simSettle(null,POLICY);
        if(simHash(G)===before)break;
      }
      // Compare surviving material at the same horizon. Leave combat resolution,
      // death triggers, returns, and control changes to the actual engine.
      if(temporaryWindow&&G.winner===null){
        for(const u of everyUnit()) u.tempM=u.tempM.filter(t=>t.dur!=='turn');
        G.tflags.buffPlus=[0,0];
      }
      if(defendCounterplay){
        if(G.winner===null){await endTurn();await simSettle(null,POLICY);}
        if(G.winner===null)await polKaisaTurnOpponentMoves(p);
        fieldValue=polKaisaTurnFieldValue(p);
      }
    },POLICY,!!SIM.lock,false);return value===null?null:{value:value+fieldValue,sacrificesWithoutControl};};
    const estimate=async action=>{
      const deck=G.players[p].runeDeck;
      if(action?.units.some(u=>unitFx(u).triggers?.onAttack?.some(t=>
          t.ops?.some(o=>o.op==='tfGamble')))&&deck.length){
        const counts=new Map();for(const n of deck)counts.set(n,(counts.get(n)||0)+1);
        let value=0,allSacrifices=true;
        for(const [n,count] of [...counts].sort((a,b)=>a[0]-b[0])){
          if(Date.now()>SIM.deadline)return null;
          const result=await probe(action,n);if(!result)return null;
          value+=result.value*count/deck.length;allSacrifices&&=result.sacrificesWithoutControl;
        }
        return allSacrifices?null:value;
      }
      const result=await probe(action);
      return result&&!result.sacrificesWithoutControl?result.value:null;
    };
    const base=await estimate(null);
    if(base===null) return fallback;
    const candidates=[];
    if(fallback)candidates.push(fallback);
    for(let dest=0;dest<G.bfs.length;dest++){
      if(plan?.focusBf!==undefined&&dest!==plan.focusBf&&!temporaryWindow&&!triggerWindow&&!defendCounterplay) continue;
      if(G.bfs[dest].controller===p&&!G.bfs[dest].units.some(u=>u.ctrl!==p)&&!moveWindow&&!defendCounterplay)continue;
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
      const value=await estimate(a);
      if(value!==null&&value>base+BOT_W.moveNeed&&(!best||value>best.value)) best={...a,value};
    }
    return best;
  }finally{SIM.deadline=deadline;}
}
async function polMfCompareExtraAurora(p,ctx,act){
  if(SIM.active||!act||act.n!==160||!polMfAuroraOnline(p))return act;
  if(ctx.movesLeft<=0&&!polMfExtraMove(p)) return act;
  const mv=await polMfMoveChoice(p,false,ctx.movesLeft);if(!mv)return act;
  const ids=mv.units.map(u=>u.uid);
  const play=await simTry(p,()=>POLICY.runAction(p,act),POLICY,false,false);
  const move=await simTry(p,()=>moveUnits(p,everyUnit().filter(u=>ids.includes(u.uid)),mv.dest),POLICY,false,false);
  return move!==null&&(play===null||move>play)?{kind:'move',units:mv.units,dest:mv.dest}:act;
}
POLICY.movePlan = function(p){
  const o = opp(p);
  // Stun removes combat damage, not standard movement or its triggers.
  const baseMovable = G.players[p].base.filter(u=>!u.ex);
  // 덱에 관계없이 전설로 얻거나 원래 가진 [개입]을 이동 후보로 쓴다.
  const gankMovable = everyUnit().filter(u=>u.ctrl===p && u.loc!=='base'
    && !u.ex && effKw(u).ganking);
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
        const reward=evalConquestReward(p,i);
        v += reward.value;                         // 정복 1점 또는 즉시 승리
        v -= send.filter(u=>u.loc==='base').reduce((s,u)=>s+might(u),0) * (BOT_W.unitBase - BOT_W.unitBf);
        v -= polMoveSourceLoss(p,send);
        cands.push({ units:send, dest:i, v, winsGame:reward.winsGame, why:'무혈 점거' });
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
      const sourceThreat=new Map();
      for(const u of legal) if(u.loc!=='base' && G.bfs[u.loc].controller===p && !sourceThreat.has(u.loc))
        sourceThreat.set(u.loc,Math.max(0,polThreatAt(p,u.loc)));
      for(const send of polReinforcementGroups(legal)){
        const t1 = polThreatAt(p, i, send);
        const gain=t0-Math.max(0,t1);
        if(gain>0.05){
          const moving=new Set(send.map(u=>u.uid));
          const after=G.bfs.map((b,bi)=>({...b,units:[
            ...b.units.filter(u=>!moving.has(u.uid)),...(bi===i?send:[])]}));
          // A ganker can leave a second holder behind yet expose that field.
          // Compare its remaining formation too, including regained solo bonuses.
          let sourceRisk=0;
          const original=G;
          try{
            G=evalCombatFormation(o,i,[],send).game;
            for(const from of new Set(send.map(u=>u.loc).filter(loc=>sourceThreat.has(loc)))){
              if(G.bfs[from].units.some(u=>u.ctrl===p))
                sourceRisk+=Math.max(0,polThreatAt(p,from))-sourceThreat.get(from);
            }
          }finally{G=original;}
          cands.push({ units:[...send], dest:i, why:'수비 보강 '+send.length+'기',
            v: (gain-sourceRisk) * 0.6 - polMoveSourceLoss(p,send)
              +evalHoldThreatValue(p,after)-evalHoldThreatValue(p),
            commitment:send.reduce((s,u)=>s+evalCombatRemovalValue(u),0) });
        }
      }
      continue;
    }
    // 부분 출격: 강한 순 프리픽스 집합을 전부 후보로 — 턴 플랜(탐색)이 있으면 그에 따른다
    const plan = (POLICY.turnPlan && POLICY.turnPlan.p===p && POLICY.turnPlan.tc===G.turnCount) ? POLICY.turnPlan : null;
    const mustDefend=evalHoldForecast(o).win;
    const allowAttack=mustDefend || !(plan && (plan.noAttack || plan.focusBf!==undefined && plan.focusBf!==i));
    const send = [];
    for(const u of byStrong){
      send.push(u);
      const combat=evalCombat(p,i,send);
      if(!allowAttack && !combat.winsGame) continue;
      const v = evalAttackValue(p, i, send, undefined, combat) - polMoveSourceLoss(p,send);
      cands.push({ units:[...send], dest:i, v, winsGame:combat.winsGame, why:'공격 '+send.length+'기' });
    }
    for(const u of byStrong.slice(1)){
      const combat=evalCombat(p,i,[u]);
      if(!allowAttack && !combat.winsGame) continue;
      cands.push({units:[u],dest:i,winsGame:combat.winsGame,
        v:evalAttackValue(p,i,[u],undefined,combat)-polMoveSourceLoss(p,[u]),why:'단독 공격'});
    }
    if(allowAttack && polMfAuroraDeck(p)){
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
  cands.sort((a,b)=>Number(!!b.winsGame)-Number(!!a.winsGame) || b.v-a.v
    || (a.commitment||0)-(b.commitment||0) || a.units.length-b.units.length);
  const best = cands[0];
  // The current tactical threshold also applies to a previously chosen focus.
  // Public hold-win prevention is already valued by evalAttackValue itself.
  if(!best.winsGame && best.v <= need) return null;    // 즉시 승리는 일반 이동 기준보다 우선한다
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
const POL_AB_BADOPS   = new Set(['luredHook']);
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
// Keep each source's attempt record. Only a successful, finite-cost activation
// may be selected again, and the engine gates readiness/buffs/resources anew.
// Failed and no-op activations remain blocked for the rest of the turn.
function polAbilityTried(p,c,ctx){
  return !!ctx?.tried?.has('a'+c.key) &&
    !(ctx.abilityRetry?.has(c.key) && polAbLegal(p,c));
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
let polHookDepth=0;
function polOwnDeckSample(p,salt){
  const cards=[...G.players[p].deck].sort((a,b)=>a-b);
  let seed=(Math.floor(polHash('visible-deck',G.turnCount,salt)*0x7fffffff)|1)>>>0;
  for(let i=cards.length-1;i>0;i--){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const j=seed%(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];
  }
  return cards;
}
async function polHookPlan(p,c){
  if(polHookDepth||NET.online||G.state!=='neutral'||!G.players[p].deck.length)return null;
  const victims=everyUnit().filter(u=>u.ctrl===p)
    .sort((a,b)=>evalCombatRemovalValue(a)-evalCombatRemovalValue(b));
  const gi=G.players[p].gear.indexOf(c.src.g);
  if(gi<0||!victims.length)return null;
  const orders=[0,1,2].map(salt=>polOwnDeckSample(p,salt));
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+Math.min(POLICY.budget||800,1200));
  polHookDepth++;
  try{
    const probe=async(uid,deck)=>simTry(p,async()=>{
      G.players[p].deck=[...deck];UI.pickReaction=async()=>null;
      if(uid!==null){
        const pick=UI.pickUnitFrom;
        UI.pickUnitFrom=async(q,units,title,...rest)=>q===p&&title==='처치할 아군 유닛'
          ? units.find(u=>u.uid===uid)||null : pick(q,units,title,...rest);
        await activateAbility(p,{kind:'gear',g:G.players[p].gear[gi]},c.ab);
      }
      await simSettle(null,POLICY);
      if(G.winner===null&&G.turn===p&&G.state==='neutral'&&G.phase==='action'){
        const move=POLICY.movePlan(p);
        if(move){await moveUnits(p,move.units,move.dest);await simSettle(null,POLICY);}
      }
      for(const u of everyUnit()){u.tempM=u.tempM.filter(x=>x.dur!=='turn');u.dmg=0;}
    },POLICY,!!SIM.lock,false);
    const baseline=[];
    for(const order of orders){const value=await probe(null,order);if(value===null)return null;baseline.push(value);}
    let best=null;
    for(const u of victims){
      let total=0,complete=true;
      for(let s=0;s<orders.length;s++){
        if(Date.now()>SIM.deadline){complete=false;break;}
        const value=await probe(u.uid,orders[s]);
        if(value===null){complete=false;break;}
        total+=value-baseline[s];
      }
      if(!complete)break;
      const gain=total/orders.length;
      if(gain>BOT_W.moveNeed&&(!best||gain>best.gain))best={uid:u.uid,gain};
    }
    return best;
  }finally{polHookDepth--;SIM.deadline=deadline;}
}
let polUdyrChoiceDepth=0;
async function polRunUdyr(p,uid,ab,choice){
  const u=everyUnit().find(u=>u.uid===uid&&u.ctrl===p);
  if(!u)return false;
  const option=UI.pickOption,pick=UI.pickUnitFrom;
  let selecting=false;
  try{
    UI.pickOption=(q,title,options,...rest)=>{
      if(q===p&&title==='우디르: 하나 선택'&&options.some(o=>o.udyrUid===uid)){
        selecting=true;return options.some(o=>o.v===choice.mode)?choice.mode:null;
      }
      return option(q,title,options,...rest);
    };
    UI.pickUnitFrom=(q,us,title,...rest)=>{
      if(selecting&&q===p&&['피해 2 대상','기절 대상'].includes(title)){
        selecting=false;return us.find(x=>x.uid===choice.uid)||null;
      }
      return pick(q,us,title,...rest);
    };
    return await activateAbility(p,{kind:'unit',u},ab);
  }finally{UI.pickOption=option;UI.pickUnitFrom=pick;}
}
async function polUdyrPlan(p,c,ctx){
  if(NET.online||polUdyrChoiceDepth||polPaidChoiceDepth||(SIM.movementDepth||0)>=2)return null;
  const uid=c.src.u?.uid,u=everyUnit().find(x=>x.uid===uid&&x.ctrl===p);
  if(!u)return null;
  const used=TF().udyrUsed[uid]||[],choices=[];
  for(const mode of ['ready','gank','dmg','stun']){
    if(used.includes(mode))continue;
    if(mode==='dmg'||mode==='stun'){
      for(const target of unitsBySpec({side:'any',where:'bf',count:1},p))
        if(canPayDeflect(p,target,{energy:0,pips:[]}))choices.push({mode,uid:target.uid});
    }else choices.push({mode});
  }
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+700);
  polUdyrChoiceDepth++;
  try{
    let best=null;
    for(const choice of choices){
      if(Date.now()>SIM.deadline)break;
      const gain=await polPaidActionGain(p,()=>polRunUdyr(p,uid,c.ab,choice),ctx);
      if(gain!==null&&gain>BOT_W.moveNeed&&(!best||gain>best.gain+1e-7))best={...choice,gain};
    }
    return best;
  }finally{polUdyrChoiceDepth--;SIM.deadline=deadline;}
}
async function polRunTrashRecycle(p,gid,ab,picks){
  const g=G.players[p].gear.find(x=>polGearId(x)===gid);
  if(!g||picks.length>4||picks.some((x,i)=>G.players[x.pi]?.trash[x.i]!==x.n||
      picks.slice(0,i).some(y=>x.pi===y.pi&&x.i===y.i)))return false;
  const option=UI.pickOption;let index=0,selecting=true;
  try{
    UI.pickOption=(q,title,options,...rest)=>{
      if(selecting&&q===p&&title.startsWith('재활용할 카드 선택 (남은')){
        const wanted=picks[index++];
        if(!wanted){selecting=false;return 'stop';}
        if(index===4)selecting=false;
        return options.find(o=>o.v?.pi===wanted.pi&&o.v?.i===wanted.i&&o.v?.n===wanted.n)?.v??'stop';
      }
      return option(q,title,options,...rest);
    };
    return await activateAbility(p,{kind:'gear',g},ab);
  }finally{UI.pickOption=option;}
}
async function polTrashRecyclePlan(p,c,ctx){
  if(NET.online||polPaidChoiceDepth||(SIM.movementDepth||0)>=2)return null;
  const gid=polGearId(c.src.g),deadline=SIM.deadline;
  // A recycle event fires once per owner, not once per card. Start with each
  // distinct public card, then add cards only if the complete paid result
  // improves. Equal-valued additions do not justify recycling extra cards.
  const candidates=[];
  for(const pi of [p,opp(p)]){
    const seen=new Set();
    G.players[pi].trash.forEach((n,i)=>{if(!seen.has(n)){seen.add(n);candidates.push({pi,i,n});}});
  }
  // Only known resource spells are continuations. Recycling several cards can
  // cross a draw threshold even when every smaller refill remains fatal.
  const follows=[null,...new Set(G.players[p].hand.filter(n=>!ctx?.tried?.has('h'+n)&&
    polNeutralResourceSpell(FX[n])&&(polHasRelocateOp(FX[n].playOps,null,
      new Set(['draw','drawEach','drawIfHandLE']))||FX[n].playOps.some(group=>group.ops?.some(op=>
        op.op==='channelOrDraw'&&G.players[p].runeDeck.length<op.n)))&&polCanPlay(p,card(n))&&
    !playRestriction(card(n),p,false)))];
  const runeCounts=new Map();for(const n of G.players[p].runeDeck)runeCounts.set(n,(runeCounts.get(n)||0)+1);
  const runeTypes=[...runeCounts].sort((a,b)=>a[0]-b[0]),runeTotal=G.players[p].runeDeck.length;
  const choose=(n,k)=>{let v=1;for(let i=1;i<=k;i++)v=v*(n-i+1)/i;return v;};
  const runeOutcomes=follow=>{
    const ops=follow===null?[]:FX[follow].playOps.flatMap(g=>g.ops||[]);
    const count=Math.min(runeTotal,ops.reduce((sum,o)=>sum+(['channel','channelOrDraw'].includes(o.op)?o.n:0),0));
    const outcomes=[],denominator=choose(runeTotal,count);
    function add(i,left,prefix,suffix,weight){
      if(i===runeTypes.length){if(!left)outcomes.push({order:[...prefix,...suffix],weight:weight/denominator});return;}
      const [n,available]=runeTypes[i];
      for(let take=0;take<=Math.min(left,available);take++)add(i+1,left-take,
        [...prefix,...Array(take).fill(n)],[...suffix,...Array(available-take).fill(n)],weight*choose(available,take));
    }
    add(0,count,[],[],1);return outcomes;
  };
  SIM.deadline=Math.min(deadline||Infinity,Date.now()+700);
  let best=null,baselineGain=0;
  const paidGain=async(run,follow)=>{
    let value=0;
    for(const outcome of runeOutcomes(follow)){
      const gain=await polPaidActionGain(p,run,ctx,{runeOrder:outcome.order});
      if(gain===null)return null;
      value+=gain*outcome.weight;
    }
    return value;
  };
  const playFollow=async n=>{
    if(n===null||G.winner!==null)return true;
    const idx=G.players[p].hand.indexOf(n);
    if(idx<0||G.turn!==p||G.phase!=='action'||G.state!=='neutral'||
        !polCanPlay(p,card(n))||playRestriction(card(n),p,false))return false;
    return playCardFromHand(p,idx);
  };
  const compare=async picks=>{
    if(Date.now()>SIM.deadline)return;
    for(const follow of follows){
      if(Date.now()>SIM.deadline)break;
      let expected=null;
      const rawGain=await paidGain(async()=>{
        if(await polRunTrashRecycle(p,gid,c.ab,picks)===false)return false;
        await simSettle(null,POLICY);expected=polBuffSequenceState(p);
        return playFollow(follow);
      },follow);
      const gain=rawGain===null?null:rawGain-baselineGain;
      if(gain!==null&&gain>BOT_W.moveNeed&&(!best||gain>best.gain+1e-7))best={picks,gain,rawGain,follow,expected};
    }
  };
  try{
    // The skip baseline receives the same known follow-up opportunity. A
    // useful draw that already works must not justify destroying the Forge.
    for(const follow of follows.filter(n=>n!==null)){
      const gain=await paidGain(()=>playFollow(follow),follow);
      if(gain===null)return null;
      baselineGain=Math.max(baselineGain,gain);
    }
    await compare([]);
    if(follows.length>1){
      const mine=G.players[p].trash.map((n,i)=>({pi:p,i,n}))
        .sort((a,b)=>polKeepCardValue(p,b.n)-polKeepCardValue(p,a.n)).slice(0,4);
      for(let size=1;size<=mine.length;size++)await compare(mine.slice(0,size));
    }
    for(const pick of candidates)await compare([pick]);
    while(best&&best.picks.length<4&&Date.now()<=SIM.deadline){
      const previous=best;
      for(const pi of [p,opp(p)]){
        const seen=new Set();
        for(let i=0;i<G.players[pi].trash.length;i++){
          const n=G.players[pi].trash[i];
          if(seen.has(n)||previous.picks.some(x=>x.pi===pi&&x.i===i))continue;
          seen.add(n);await compare([...previous.picks,{pi,i,n}]);
        }
      }
      if(best===previous)break;
    }
    return best;
  }finally{SIM.deadline=deadline;}
}
function polTrashRecycleAction(p,c,choice){
  const act={kind:'ability',src:c.src,ab:c.ab,key:c.key,label:c.name+' '+c.ab.label,recyclePicks:choice.picks};
  if(choice.follow!==null&&choice.follow!==undefined)act.orderSequence={
    steps:[{kind:'play',n:choice.follow}],states:[choice.expected]};
  return act;
}
async function polTrashRecycleBeforePlay(p,ctx,core){
  if(!polSmart()||polPaidChoiceDepth||NET.online||!['play','champ'].includes(core.kind)||
      !G.players[p].hand.some(n=>polNeutralResourceSpell(FX[n]))||
      !G.players[p].gear.some(g=>FX[g.n]?.activated?.some(a=>a.ops?.some(o=>o.op==='pickRecycleTrashes'))))return core;
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+700);
  try{
    for(const c of polAbList(p).filter(c=>c.src.kind==='gear'&&polAbOps(c).includes('pickRecycleTrashes'))){
      if(polAbilityTried(p,c,ctx)||!polAbLegal(p,c))continue;
      const choice=await polTrashRecyclePlan(p,c,ctx);
      if(!choice||choice.follow===null)continue;
      let current=await polPaidActionGain(p,()=>POLICY.runAction(p,core),ctx,true);
      if(current===null)continue;
      const thenDraw=await polPaidActionGain(p,async()=>{
        if(await POLICY.runAction(p,core)===false)return false;
        await simSettle(null,POLICY);
        if(G.winner!==null)return true;
        const n=choice.follow,idx=G.players[p].hand.indexOf(n);
        if(idx<0||!polCanPlay(p,card(n))||playRestriction(card(n),p,false))return false;
        return playCardFromHand(p,idx);
      },ctx,true);
      if(thenDraw!==null)current=Math.max(current,thenDraw);
      if(choice.rawGain>current+BOT_W.moveNeed)return polTrashRecycleAction(p,c,choice);
    }
    return core;
  }finally{SIM.deadline=deadline;}
}
POLICY.abilityPlan = async function(p, ctx, onlyUnits){
  if(!POLICY.ab.ability || polTier().rep < 1) return null;
  for(const c of polAbList(p).sort((a,b)=>Number(polMfBundleTreasure(p,b))-Number(polMfBundleTreasure(p,a)))){
    if((c.src.kind === 'unit') !== !!onlyUnits) continue;
    if(polAbilityTried(p,c,ctx)) continue;
    if(!polAbLegal(p, c)) continue;
    if(polHard() && c.src.kind==='legend' && G.players[p].legendN===POL_MF.legend){
      const target=await polMfGankTarget(p,c,ctx);
      if(!target) continue;
      // The target was already compared through the paid-action engine probe.
      // Carry its UID on the action so another candidate cannot replace it.
      return {kind:'ability',src:c.src,ab:c.ab,key:c.key,label:c.name+' '+c.ab.label,mfGankUid:target.uid};
    }
    // 오로라 설치 뒤 경이의 꾸러미로 무료 소환 유닛이나 오로라 자체를 회수하면
    // 엔진의 누적 이득을 스스로 되돌린다.
    if(polMfAuroraDeck(p) && polMfAuroraOnline(p)
      && c.src.kind==='gear' && c.src.g.n===181 && !polMfBundleTreasure(p,c)) continue;
    const cost = c.ab.cost || {};
    const costPips=[...(cost.pips||[])];
    for(let i=0;i<(cost.power||0);i++) costPips.push('Any');
    if(polMfCostBlocked(p,{energy:cost.energy||0,pips:costPips,channel:polMfTreasure(p,c)?1:0})) continue;
    if(polSmart()&&polAbOps(c).includes('udyr')){
      const choice=await polUdyrPlan(p,c,ctx);
      if(choice)return {kind:'ability',src:c.src,ab:c.ab,key:c.key,label:c.name+' '+c.ab.label,udyrChoice:choice};
      continue;
    }
    if(polSmart()&&c.src.kind==='gear'&&polAbOps(c).includes('pickRecycleTrashes')){
      const choice=await polTrashRecyclePlan(p,c,ctx);
      if(choice)return polTrashRecycleAction(p,c,choice);
      continue;
    }
    if(polAbOps(c).includes('luredHook')){
      const hook=await polHookPlan(p,c);
      if(hook)return {kind:'ability',src:c.src,ab:c.ab,key:c.key,label:c.name+' '+c.ab.label,hookUid:hook.uid};
      continue;
    }
    if(!polAbIsResource(c)||POL_AB_HARDCOST.some(k=>cost[k])||cost.recycleTrash||
        polAbOps(c).includes('killThisGear')&&!polMfTreasure(p,c)){
      if(polPaidChoiceDepth)continue;
      const uid=c.src.u?.uid,gi=c.src.g?G.players[p].gear.indexOf(c.src.g):-1;
      const gain=await polPaidActionGain(p,async()=>{
        const src={kind:c.src.kind};if(uid!==undefined)src.u=everyUnit().find(u=>u.uid===uid);
        if(gi>=0)src.g=G.players[p].gear[gi];
        await activateAbility(p,src,c.ab);
        if(polAbIsResource(c)){
          const blocked=new Set(), special=await polNeutralRemovalChoice(p,{tried:blocked,movesLeft:polTier().moves});
          if(special) await POLICY.runAction(p,special);
          else {const play=await POLICY.pickPlay(p,blocked);if(play>=0)await playCardFromHand(p,play);}
        }
      },ctx);
      // A Recruit can have a small positive net value after energy and legend
      // exhaustion. The attack threshold must not reject useful development.
      const minGain=POL_AB_HARDCOST.some(k=>cost[k])||cost.recycleTrash||
        polAbOps(c).includes('killThisGear')?BOT_W.moveNeed:1e-7;
      if(gain===null||gain<=minGain)continue;
    }
    if(polAbOps(c).some(o => POL_AB_BADOPS.has(o)) && !polMfTreasure(p,c)) continue;
    if(polAbIsResource(c)&&!cost.killFriendlyOrGear)continue;
    if(polAbOps(c).includes('teemoFetch') && !teemoFetchOptions(p).some(o=>o.v.t==='u')) continue;
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
  // 비용: 힘 1 (티모 전설은 에너지 1로 대체, [유격 전투] 중엔 무료)
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
  if(P.hand.includes(POL_MF.bulletTime)){
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

// 위력 강화는 대기 효과를 해결한 뒤에도 같은 결과를 낼 수 있으면 아낀다.
// 감소 하한의 실효 감소분이 고정된 뒤 강화해야 더 높은 위력을 얻을 수 있다.
const polImmediateShowdownAction=POLICY.showdownAction;
POLICY.showdownAction=async function(p){
  const act=await polImmediateShowdownAction.call(this,p);
  if(!act || !G.showdown?.hasCombat || !G.showdown.chain.length || !polSmart() ||
     polEnhanceDepth || NET.online || (SIM.lock && !SIM.settling) ||
     act.kind!=='play') return act;
  const fx=FX[act.n], ops=(fx?.playOps||[]).filter(g=>!g.legion||G.players[p].playedCards>0)
    .flatMap(g=>g.ops||[]);
  // 다른 효과(처치, 이동, 준비 등)가 함께 있는 카드는 원래의 전체 효과 판단을 유지한다.
  if(!ops?.length || !ops.every(o=>o.op==='engarde' || o.op==='might' && o.n>0 && o.dur==='turn' ||
      o.op==='draw') || !polEnhanceOps(ops)) return act;
  const c=card(act.n), plan=await polEnhancePlan(p,{ops,ctx:{p,n:act.n,kind:'spell'},waitForChain:true,
    cost:{energy:applyCostMods(p,c,c.e||0),pips:powerPips(c),spellOK:true}});
  if(plan?.defer){
    polSay('showdown-wait',c.ko,'대기 효과 해결 뒤 강화해도 생존·처치 결과가 같거나 개선됨');
    return null;
  }
  return act;
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
function polNextTurnSpecial(p){
  const next=nextTurnPlayer(p);
  if(G.extraTurns?.length || G._inExtraTurn || !G.players[next].deck.length || hasEventListeners('onEndTurn',p) ||
      hasEventListeners('onBeginning',next) || hasEventListeners('onYouReadyUnit',next) ||
      G.turnCount<2&&G.bfs.some(b=>FX[b.n]?.triggers?.onFirstBeginning?.length)) return true;
  if(everyUnit().some(u=>u.ctrl===next&&effKw(u).temporary&&
      (unitFx(u).triggers?.onDeath?.length || G.players[next].gear.some(g=>FX[g.n]?.zhonya) ||
       hasEventListeners('onUnitDeath',p) || hasEventListeners('onUnitDeath',opp(p))))) return true;
  return G.bfs.some(b=>b.controller===next&&(
    (FX[b.n]?.triggers?.onHoldHere||[]).some(t=>(t.ops||[]).some(op=>op.op!=='scorePoint')) ||
    b.units.some(u=>u.ctrl===next&&(unitFx(u).triggers?.onHold||[])
      .some(t=>(t.ops||[]).some(op=>op.op!=='scorePoint')))));
}
// End and Beginning are engine phases, not just a count of current holders.
// Public responses pass; concealed identities and the actual top-deck order
// cannot promise a rescue. Compare sampled own composition if an End effect
// can use it. Disagreeing samples never promise an immediate winning end.
async function polNextTurnOutcome(p,force=false){
  if(NET.online || G.turn!==p || G.state!=='neutral' || G.phase!=='action' ||
      G.winner!==null || !force&&!polNextTurnSpecial(p) || (SIM.movementDepth||0)>=2) return null;
  const deadline=SIM.deadline;
  SIM.deadline=Math.min(deadline||Infinity,Date.now()+700);
  const samples=hasEventListeners('onEndTurn',p)&&new Set(G.players[p].deck).size>1?3:1;
  const results=[];
  try{
    for(let sample=0;sample<samples;sample++){
      let result=null;
      const value=await simTry(p,async()=>{
        polKaisaTurnPublicSample(p,sample);
        const next=nextTurnPlayer(p),points=G.players[next].points;
        await endTurn();await simSettle(null,POLICY);
        result={won:G.winner===p,lost:G.winner===opp(p),
          points:Math.max(0,G.players[next].points-points),holds:evalHolds(next),turn:G.turn};
      },POLICY,true,false);
      if(value===null||!result)return null;
      results.push({...result,value});
    }
    return {won:results.every(r=>r.won),lost:results.some(r=>r.lost),
      points:Math.max(...results.map(r=>r.points)),holds:Math.max(...results.map(r=>r.holds)),
      turn:results[0].turn,value:results.reduce((s,r)=>s+r.value,0)/results.length};
  }finally{SIM.deadline=deadline;}
}
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
    const next=emergency?await polNextTurnOutcome(p,true):null;
    won=G.winner===p || !!next?.won;
    safe=won || (G.winner===null && (next?!next.lost:!POLICY.race(p).oppLethal));
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
    // A non-ganker may need to return, be readied by a known card, and attack
    // a different field. Only the emergency sequence prices this withdrawal;
    // returning alone must never count as preventing the opponent's hold win.
    const returning=everyUnit().filter(u=>u.ctrl===p&&!u.ex&&u.loc!=='base'&&
      G.bfs[u.loc].n!==BF_STATIC.NO_RETREAT);
    for(const units of polMfAttackGroups(returning))
      add({kind:'move',uids:units.map(u=>u.uid).sort((a,b)=>a-b),dest:'base'});
    for(const u of returning)add({kind:'move',uids:[u.uid],dest:'base'});
    const movable=everyUnit().filter(u=>u.ctrl===p&&!u.ex&&(u.loc==='base'||effKw(u).ganking));
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
    const next=await polNextTurnOutcome(p,true),forecast=evalHoldForecast(opp(p));
    const won=G.winner===p||!!next?.won;
    const safe=won||(G.winner===null&&(next?!next.lost:!forecast.win));
    const actions=G.winner===null&&G.turn===p&&G.state==='neutral'?polEmergencySequenceActions(p,local,remaining):[];
    const key=simHash(G)+':'+local.movesLeft+':'+JSON.stringify([...remaining]);
    // Temporary Might and unconverted damage expire before the next hold.
    for(const u of everyUnit()){u.dmg=0;u.tempM=u.tempM.filter(m=>m.dur!=='turn');}
    result={won,safe,points:next?next.points:forecast.points,actions,key};
    }finally{drawCard=originalDraw;}
  },POLICY,false,false);
  return value===null||!result?null:{...result,value,steps};
}
async function polEmergencySequence(p,ctx){
  if(SIM.active||SIM.lock)return null;
  const ending=await polNextTurnOutcome(p);
  if(ending?!ending.lost:!POLICY.race(p).oppLethal)return null;
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
    // A setup spell can cost material before a later attack converts its effect.
    // Keep the best continuation of each initial card alongside attack lines;
    // otherwise immediate exchanges crowd out Decree -> two attacks entirely.
    const starts=new Set(),cardLines=[],returns=new Set(),returnLines=[];
    for(const line of next){
      const first=line.steps[0];
      if(['play','champ'].includes(first.kind)){
        const key=first.kind+':'+first.n;
        if(starts.has(key)||cardLines.length===4)continue;
        starts.add(key);cardLines.push(line);
        continue;
      }
      const withdrawal=first.kind==='move'&&first.dest==='base';
      const preparation=withdrawal&&line.steps.find(a=>['play','champ'].includes(a.kind)&&polOrderProfile(a.n,a).ready);
      if(!(withdrawal&&(line.steps.length===1||preparation)))continue;
      // Withdrawal temporarily loses our holder before readiness opens the
      // rescue attack. Preserve all four existing direct-card continuations.
      const key=first.uids.join(',')+':'+(preparation?.n||'');
      if(returns.has(key)||returnLines.length===2)continue;
      returns.add(key);returnLines.push(line);
    }
    frontier=[...cardLines,...returnLines,
      ...next.filter(line=>!cardLines.includes(line)&&!returnLines.includes(line))].slice(0,8);
  }
  return best;
}
// 모든 고급 봇의 공개 유지 패배 차단. 미스 포츈의 기존 즉시 승리 탐색도 유지한다.
async function polEmergencyAction(p,ctx){
  if(!polHard()||G.turn!==p||G.state!=='neutral'||SIM.active||NET.online) return null;
  const ending=await polNextTurnOutcome(p);
  if(ending?.won){polSay('survival','턴 종료','공개 종료 및 개시 효과를 해결하면 승리');return {kind:'end'};}
  const danger=ending?ending.lost:POLICY.race(p).oppLethal;
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
      if(!best||rank>best.rank) best={act,rank,won:result.won};
    }
    if(!best&&danger){
      const sequence=await polEmergencySequence(p,ctx);
      if(sequence){
        const first=polEmergencySequenceAction(p,sequence.steps[0]);
        if(first){
          polSay('survival-sequence',first.kind==='move'?'이동 → #'+first.dest:card(first.n).ko,
            '기존 손패와 후속 이동으로 모든 유지 패배 조건 차단',{steps:sequence.steps});
          return {...first,emergency:true,emergencyWin:!!sequence.won,emergencySequence:sequence.steps};
        }
      }
    }
    if(!best) return null;
    const act=best.act;
    polSay('survival',act.label,'즉시 승리 / 다음 유지 패배 차단 우선');
    return {...act,emergencyWin:!!best.won,run:()=>polMfWithEmergency(p,true,act.run)};
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
    if(hasDarius && (ctx.movesLeft||0)>=2)for(const u of everyUnit().filter(u=>u.ctrl===p&&u.n===27&&u.loc!=='base'&&!u.ex)){
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
      // A verified cheaper Legion order must not be discarded by the movement
      // threshold. Both sequences already resolve the same turn in the engine.
      const legionOrder=hasLegion&&plan.steps.some((a,i)=>i>0&&FX[a.n]?.selfCost?.legion);
      if(!r||r.value<=baseline.value+(legionOrder?1e-8:BOT_W.moveNeed))continue;
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

async function polKaisaPreserveWarp(p,ctx,act){
  if(!act||act.kaisaWin||!['play','champ'].includes(act.kind)||
    card(polKaisaTurnCard(act,p))?.type!=='Unit'||!POLICY.race(p).oppLethal||
    !G.players[p].hand.includes(122)||ctx.tried?.has('h122')||!polCanPlay(p,card(122)))return act;
  let keepsWarp=null;
  await simTry(p,async()=>{
    UI.pickReaction=async()=>null;
    if(await POLICY.runAction(p,act)===false)return;
    keepsWarp=G.winner===p||polCanPlay(p,card(122));
  },POLICY,false,false);
  if(keepsWarp!==false)return act;
  const warp={kind:'play',n:122,idx:G.players[p].hand.indexOf(122)};
  const quick=await polKaisaTurnProbe(p,ctx,warp,{quick:true,knownHandOnly:true});
  if(!quick||quick.lost||quick.turn!==p)return act;
  // Try the existing public-board attack first, retaining the extra-turn cost
  // until its real outcome is known. Do not assume a concealed response exists.
  const move=ctx.movesLeft>0?POLICY.movePlan(p):null;
  return move?{kind:'move',units:move.units,dest:move.dest}:{...warp,kaisaSurvival:true};
}
// Compare the same two known permanents in both orders. Legion on-play effects
// must not be lost merely because the Legion body has a higher fixed play score.
async function polLegionOrder(p,ctx,core){
  if(!core || !polHard() || SIM.active || NET.online || G.players[p].playedCards ||
    !['play','champ'].includes(core.kind)) return core;
  const n=core.kind==='champ'?G.players[p].champN:core.n;
  if(!(FX[n]?.triggers?.onPlay||[]).some(t=>t.legion)) return core;
  const mates=[...new Set(G.players[p].hand)].filter(m=>m!==n &&
    ['Unit','Gear'].includes(card(m).type) && !ctx.tried?.has('h'+m) && polCanPlay(p,card(m)));
  if(!mates.length)return core;
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+700);
  try{
    const probe=async steps=>{
      let complete=false;
      const value=await simTry(p,async()=>{
        UI.pickReaction=async()=>null;
        G.players[p].deck.sort((a,b)=>a-b);
        for(const step of steps){
          const a=step.kind==='champ'?step:{...step,idx:G.players[p].hand.indexOf(step.n)};
          if(a.kind==='play'&&a.idx<0 || await POLICY.runAction(p,a)===false)return;
          await simSettle(null,POLICY);
          if(G.winner!==null)return;
        }
        complete=true;
      },POLICY,false,false);
      return complete?value:null;
    };
    let best=null;
    for(const m of mates){
      if(Date.now()>SIM.deadline)break;
      const first={kind:'play',n:m,idx:G.players[p].hand.indexOf(m)};
      const before=await probe([core,first]),after=await probe([first,core]);
      if(before!==null&&after!==null&&after>before+BOT_W.moveNeed&&(!best||after>best.value))
        best={act:first,value:after,gain:after-before};
    }
    if(best){polSay('legion-order',card(best.act.n).ko,'같은 두 카드의 순서를 비교해 군단 격발 보존',{gain:best.gain});return best.act;}
    return core;
  }finally{SIM.deadline=deadline;}
}
// 버프 비용과 뒤의 버프 제공 유닛을 같은 두 카드의 순서로 비교한다.
function polBuffProvider(n){
  return card(n).type==='Unit'&&(FX[n]?.triggers?.onPlay||[]).some(t=>
    t.ops?.some(o=>['buff','buffSelf','buffOthersHere'].includes(o.op)));
}
function polBuffSequenceState(p){
  // 상대의 비공개 카드 내용과 덱 순서는 계획의 근거가 아니다.
  return simHash({...G,
    bfs:G.bfs.map(b=>({...b,hiddenCards:b.hiddenCards.map(h=>h.by===p?h:{...h,n:0})})),
    players:G.players.map((P,q)=>({...P,deck:P.deck.length,runeDeck:P.runeDeck.length,
      ...(q===p?{}:{hand:P.hand.length,deckList:P.deckList?.length||0})}))});
}
function polBuffPayments(p,n){
  const safe=everyUnit().filter(u=>u.ctrl===p&&u.buff>0&&u.dmg<might(u)-1)
    .sort((a,b)=>Number(a.loc!=='base')-Number(b.loc!=='base')||might(a)-might(b));
  const out=[null];
  if(n!==150)return out.concat(safe.map(u=>({p,n,spend:true,uid:u.uid})));
  // 최대 기본 힘 2개와 가속 힘 1개. 현재 카드만의 최소 할인으로 뒤의 힘을 써버리지 않는다.
  for(let count=1;count<=Math.min(3,safe.length);count++){
    function collect(start,ids){
      if(out.length>=24)return;
      if(ids.length===count){
        const picks=ids.map(uid=>({uid,count:1}));
        out.push({p,n,picks,accelerate:false},{p,n,picks,accelerate:true});return;
      }
      for(let i=start;i<safe.length;i++)collect(i+1,[...ids,safe[i].uid]);
    }
    collect(0,[]);
  }
  return out;
}
function polBuffFollowup(p,ctx){
  const follow=POLICY._buffFollowup;POLICY._buffFollowup=null;
  if(follow?.p===p&&follow.tc===G.turnCount&&follow.expected===polBuffSequenceState(p)){
    const a=follow.act,n=a.n;
    if(!ctx.tried?.has(a.kind==='champ'?'champ':'h'+n)&&polCanPlay(p,card(n))&&!playRestriction(card(n),p,false)&&
      (a.kind==='champ'?G.players[p].champInZone:G.players[p].hand.includes(n)))
      return {...a,idx:a.kind==='play'?G.players[p].hand.indexOf(n):undefined,buffSequence:{consumerN:follow.consumerN,payment:follow.payment}};
  }
  return null;
}
let polBuffOrderDepth=0;
async function polBuffOrder(p,ctx,core){
  if(!core||!['play','champ'].includes(core.kind)||!polHard()||SIM.active||NET.online||polBuffOrderDepth)return core;
  const P=G.players[p],consumers=new Set([146,207,150]),n=core.kind==='champ'?P.champN:core.n;
  if(!consumers.has(n)&&!polBuffProvider(n))return core;
  const stock=new Map();for(const m of P.hand)stock.set(m,(stock.get(m)||0)+1);
  const known=[...stock.keys()].filter(m=>!ctx.tried?.has('h'+m)).map(n=>({kind:'play',n}));
  if(P.champInZone&&!ctx.tried?.has('champ'))known.push({kind:'champ',n:P.champN});
  const pairs=[];
  for(const consumer of known.filter(a=>consumers.has(a.n)))for(const provider of known.filter(a=>polBuffProvider(a.n))){
    if(consumer.n!==n&&provider.n!==n)continue;
    pairs.push({consumer,provider});
  }
  if(!pairs.length)return core;
  const savedDeadline=SIM.deadline;SIM.deadline=Math.min(savedDeadline||Infinity,Date.now()+900);polBuffOrderDepth++;
  try{
    const probe=async(steps,consumerN,payment)=>{
      let complete=false,afterFirst=null;
      const value=await simTry(p,async()=>{
        UI.pickReaction=async()=>null;
        const remaining=new Map(stock),response=polKaisaSequenceResponse(p,remaining);
        G.players[p].deck.sort((a,b)=>a-b);
        for(let i=0;i<steps.length;i++){
          const step=steps[i];if(polMfNeutralCardBlocked(p,step.n))return;
          const a=step.kind==='champ'?step:{...step,idx:G.players[p].hand.indexOf(step.n)};
          const old=POLICY._buffPaymentPlan;POLICY._buffPaymentPlan=step.n===consumerN?payment:null;
          let ok;try{ok=await POLICY.runAction(p,a);}finally{POLICY._buffPaymentPlan=old;}
          if(ok===false||a.kind==='play'&&a.idx<0)return;
          if(a.kind==='play')remaining.set(a.n,(remaining.get(a.n)||0)-1);
          await simSettle(p,response);if(G.winner!==null){complete=true;return;}
          if(i===0)afterFirst=polBuffSequenceState(p);
        }
        complete=true;POLICY.turnPlan=null;
        if(ctx.movesLeft>0&&G.turn===p&&G.phase==='action'&&G.state==='neutral'){
          const mv=await polMfMoveChoice(p,true);
          if(mv){await moveUnits(p,mv.units,mv.dest);await simSettle(p,response);}
        }
        for(const u of everyUnit())u.tempM=u.tempM.filter(t=>t.dur!=='turn');
      },POLICY,false,false);
      return complete&&value!==null?{value,afterFirst}:null;
    };
    const base=await probe([core],null,null);if(!base)return core;
    let best=null;
    for(const {consumer,provider} of pairs){
      for(const payment of polBuffPayments(p,consumer.n))for(const steps of [[consumer,provider],[provider,consumer]]){
        if(Date.now()>SIM.deadline)break;
        const result=await probe(steps,consumer.n,payment);
        if(result&&result.value>base.value+BOT_W.moveNeed&&(!best||result.value>best.value+1e-9))
          best={...result,steps,payment,consumerN:consumer.n};
      }
    }
    if(!best)return core;
    const [first,follow]=best.steps;
    polSay('buff-order',card(first.n).ko,'버프 소모와 재부여 순서·두 카드의 실제 비용 비교',{gain:best.value-base.value,follow:follow.n});
    return {...first,idx:first.kind==='play'?P.hand.indexOf(first.n):undefined,
      buffSequence:{consumerN:best.consumerN,payment:best.payment,follow,expected:best.afterFirst}};
  }finally{polBuffOrderDepth--;SIM.deadline=savedDeadline;}
}
// 현재 비용만으로 고르면 설치할 할인·격발 공급원을 뒤로 미룰 수 있다.
// 실제 효과에 연결되는 같은 두 카드를 양쪽 순서로 실행한다. 미공개 뽑기를
// 다음 카드로 약속하지 않으며, 임시 위력은 실제 후속 전투 뒤에만 평가한다.
function polOrderProfile(n,action){
  const c=CARD_BY_N[n]||{},fx=action?.kind==='ability'?{playOps:[{ops:action.ab.ops}]}:FX[n]||{},tr=fx.triggers||{},groups=[...(fx.playOps||[]),...(tr.onPlay||[])];
  const flatten=ops=>(ops||[]).flatMap(o=>[o,...flatten(o.ops),...flatten(o.elseOps),
    ...flatten(o.inner?[o.inner]:[]),...(o.branches||[]).flatMap(b=>flatten(b.ops||b))]);
  const ops=flatten(groups.flatMap(g=>g.ops||[])),has=(...names)=>ops.some(o=>names.includes(o.op));
  return {n,fx,tr,type:action?.kind==='ability'?'Ability':action?.kind==='movePlan'?'Move':c.type,ops,has,
    buff:has('buff','buffSelf','buffOthersHere','buffAndMove','openPlan'),
    buffOthers:has('buff','buffOthersHere','buffAndMove','openPlan'),
    stun:has('stun','facebreaker','stunOrKillIt'),
    ready:has('ready','readySelf','openPlan','wildclawBloom')||n===173,
    damage:has('damage','damageAll','bfDamageEnemies','dmgEqMyMight','dmgLastDiscardCost','extortion','gunsBlazing','challenge','fightMutual','gentlemenDuel','itDealsTo','stormbringer','dragonRage'),
    kill:has('kill','eachPlayerKills','kingsDecree','killAllGear','eachKillsGear','stunOrKillIt')||[208,231].includes(n),
    sacrifice:[208,231,209].includes(n)||!!action?.ab?.cost?.killFriendlyOrGear||has('luredHook'),
    consumesBuff:[146,207,150,153,230].includes(n)||!!action?.ab?.cost?.spendBuff,
    exhausts:!!action?.ab?.cost?.exhaustSelf||fx.addCost?.kind==='exhaustUnit',
    discard:has('discard','timelineReset')||n===2,
    recycle:!!fx.kw?.vision||!!action?.ab?.cost?.recycleTrash||has('lookTopHand','lookTopPlayUnit','promisingFuture','blindRage','divineJudgment'),
    token:has('token','vanguardTokens'),
    draw:has('draw','lookTopHand','drawPerMighty'),
    grow:ops.some(o=>o.op==='might'&&o.n>0)||has('buff','buffSelf','buffOthersHere','mightDouble','mightSetToOther','engarde','powerSiphon','grantKw'),
    shrink:ops.some(o=>o.op==='might'&&o.n<0)||has('powerSiphon'),
    team:has('openPlan')||ops.some(o=>o.op==='might'&&o.all)||has('powerSiphon','mightTwoDistinct'),
    readyAura:fx.statics?.some(s=>s.kind==='enterReadyAura')||ops.some(o=>o.op==='setFlag'&&['enterReady','nextUnitReady'].includes(o.flag)),
    channel:has('channel','channelOrDraw','partyFavor','albus','volibearPlay'),
    relocate:has('moveSpec','moveTwo','swapUnits','buffAndMove','recall','bounce','bounceSpec','wonderBundle'),
    protection:!!fx.zhonya||has('armoryProtect','highlanderMark'),
    resource:has('addEnergy','addPower','addSpellEnergy','addSpellPower'),
    resourceSource:fx.activated?.some(ab=>(ab.ops||[]).some(o=>['addEnergy','addPower','addSpellEnergy','addSpellPower'].includes(o.op))),
    bonus:ops.some(o=>o.op==='setFlag'&&o.flag==='nextSpellBonus'),
    discount:ops.some(o=>o.op==='setFlag'&&o.flag==='nextSpellDisc'),
    legion:!!action?.ab?.legion||!!fx.selfCost?.legion||groups.some(g=>g.legion)};
}
function polOrderDependency(p,a,b){
  const A=polOrderProfile(a.n,a),B=polOrderProfile(b.n,b),P=G.players[p];
  if(a.kind==='movePlan'){
    if(B.ready||B.type==='Gear'&&everyUnit().some(u=>u.ctrl===p&&u.n===91&&!u.ex)||
        B.discard&&everyUnit().some(u=>u.ctrl===p&&u.n===202&&!u.ex)||
        P.playedSeq===1&&everyUnit().some(u=>u.ctrl===p&&u.n===27&&!u.ex))return '공격 후 재준비';
    if(B.buffOthers||B.fx.entersReady==='oppBf'||B.fx.entersReady==='nearWin'||
        B.type==='Spell'&&everyUnit().some(u=>u.ctrl===p&&u.n===84)||
        everyUnit().some(u=>u.ctrl===p&&unitFx(u).triggers?.onConquer)||
        G.bfs.some(b=>[287,292].includes(b.n)))return '이동 후 대상과 보상 활용';
    return null;
  }
  if(b.kind==='movePlan')return A.grow||A.buff||A.stun||A.damage||A.ready||A.channel||A.relocate||A.protection||
    A.fx.statics?.length||A.tr.onAttack||A.tr.onConquer||A.tr.onUnitDeath||A.tr.onYouStun||
    A.has('udyr')||A.exhausts&&everyUnit().some(u=>u.ctrl===p&&u.n===162&&!u.ex)?'효과 후 공격':null;
  if(A.fx.tagDiscount&&(card(b.n).tags||[]).includes(A.fx.tagDiscount.tag))return '종족 할인';
  if(A.discount&&B.type==='Spell')return '다음 주문 할인';
  if(A.fx.spellDiscount&&B.type==='Spell')return '전장 주문 할인';
  if(A.readyAura&&(B.type==='Unit'||B.token))return '준비 등장';
  if(A.fx.statics?.some(s=>s.kind==='kwAura'&&s.kws?.includes('vision'))&&B.type==='Unit')return '통찰 공급';
  if(A.fx.copyAllExhaust&&B.fx.activated?.some(ab=>ab.cost?.exhaustSelf)||
      A.fx.activated?.some(ab=>ab.cost?.exhaustSelf)&&B.fx.copyAllExhaust)return '복사 능력 공급';
  if((A.resource||A.resourceSource)&&['Unit','Spell','Gear'].includes(B.type))return '자원 공급 후 플레이';
  if(A.bonus&&B.damage)return '다음 주문 보너스';
  if(B.legion&&!P.playedCards)return '군단';
  if(A.tr.onYouPlayUnit&&B.type==='Unit'||A.tr.onYouPlayGear&&B.type==='Gear'||
      A.tr.onYouPlaySpell&&B.type==='Spell'||A.tr.onYouPlayCard&&
      (a.n===27&&P.playedSeq<2||a.n===306&&B.type==='Spell'&&(card(b.n).e||0)>=5))return '플레이 격발';
  if(A.tr.onPlayFromHidden&&b.kind==='hidden')return '숨김 공개 격발';
  if(A.tr.onYouBuff&&B.buff||A.tr.onYouReadyUnit&&B.ready||A.tr.onYouStun&&B.stun||A.fx.hookYouStun&&B.stun||
      A.tr.onYouDiscard&&B.discard||A.tr.onYouRecycle&&B.recycle)return '효과 격발';
  if(A.fx.deathknellTwice||A.tr.onUnitDeath||A.tr.onOtherFriendlyDeath||a.n===118){
    if(B.sacrifice)return '사망 보상';
  }
  if(A.type==='Unit'&&B.buffOthers||A.buff&&([147,230,153,150,146,207].includes(b.n)||b.ab?.cost?.spendBuff))return '버프 공급';
  if(A.consumesBuff&&(B.buff||B.recycle&&everyUnit().some(u=>u.ctrl===p&&u.n===235)||
      B.stun&&FX[P.legendN]?.hookYouStun||B.type==='Unit'&&everyUnit().some(u=>u.ctrl===p&&u.n===139)))return '소모 후 버프 복원';
  if(A.exhausts&&B.ready)return '능력 후 재준비';
  if(A.exhausts&&B.buffOthers)return '탈진 후 버프 대상';
  if(A.channel&&b.n===304)return '룬 임계점';
  if(A.type==='Unit'&&B.sacrifice)return '희생 재료 전개';
  if((card(a.n).tags||[]).includes('Poro')&&b.n===61)return '포로 조건';
  if(A.type==='Unit'&&b.n===38)return '위력적 뽑기';
  if(A.stun&&b.n===225)return '기절 후 처치';
  if(a.n===79&&B.stun||a.n===72&&B.kill)return '기절 보상';
  if(A.damage&&b.n===159)return '피해 후 워윅 공격';
  if((A.damage||A.kill)&&B.fx.selfCost?.enemyDied||A.damage&&B.damage&&B.has('ifItDead'))return '처치 할인 및 마지막 피해 보상';
  if(A.fx.spellBonusAll&&B.damage)return '보너스 피해';
  if(A.grow&&(B.fx.selfCost?.highestMight||[69,108,128,149,250,260,308].includes(b.n)||B.has('dmgEqMyMight','itDealsTo')))return '위력 활용';
  if(A.shrink&&[169,256].includes(b.n))return '제거 문턱';
  if([221,254].includes(a.n)&&B.damage)return '처치 표식';
  if(A.type==='Unit'&&B.team||A.token&&B.team)return '전체 강화 대상';
  if([123,318,244].includes(a.n)&&B.type==='Unit'||a.n===22&&B.type==='Gear')return '정리 후 전개';
  if(A.type==='Spell'&&b.n===310||A.sacrifice&&[165,170,196,198,226].includes(b.n))return '사용 후 회수';
  if((A.discard||A.recycle)&&[165,170,196,198,226,310].includes(b.n))return '회수 재료 배분';
  if(A.recycle&&b.n===195||A.discard&&[19,195,109].includes(b.n))return '폐기장 조건';
  if(A.sacrifice&&(B.fx.selfCost?.perTrash||b.n===109))return '사망 후 폐기장 활용';
  if(A.type==='Unit'&&B.type==='Ability'&&b.abilityOf?.n===a.n)return '등장 후 능력';
  if(A.grow&&b.kind==='ability'&&[68,242].includes(b.n))return '위력 후 능력';
  if(A.ready&&b.kind==='ability'&&b.ab?.cost?.exhaustSelf)return '준비 후 능력';
  if(A.ready&&['Spell','Unit','Gear'].includes(B.type)&&polAbList(p).some(c=>polSafeResource(c)&&c.src.u?.ex))return '준비 후 자원 충당';
  if(A.protection&&(B.sacrifice||B.damage))return '위험 행동 전 보호';
  if(A.type==='Ability'&&B.sacrifice&&a.src?.g)return '도구 사용 후 희생';
  if(A.relocate&&(B.damage||B.kill))return '위치 변경 후 제거';
  if(A.has('possess')&&(B.ready||B.buff||B.grow||B.team))return '통제권 획득 후 강화';
  if(A.has('damageAll')&&B.type==='Unit')return '광역 피해 후 전개';
  if(A.fx.onDiscardSelf&&B.discard)return '버림 보상과 전개 비교';
  if(A.type==='Spell'&&B.sacrifice&&everyUnit().some(u=>u.ctrl===p&&u.n===110))return '룬 사용 후 에코 사망';
  if(A.damage&&b.n===209||A.type!=='Ability'&&b.n===201)return '기존 카드 활용 후 교환';
  if(a.kind==='ability'&&A.has('setFlag','buff','might')&&B.damage)return '능력 후 피해';
  if(a.kind==='ability'&&b.kind==='ability'&&a.key===b.key&&a.ab.cost?.recycleTrash)return '연속 재활용 강화';
  if(a.n===193&&B.type==='Unit')return '빈 전장 전개';
  if(A.type==='Spell'&&B.type==='Spell'&&(TF().nextSpellDisc[p]||TF().nextSpellBonus[p]))return '한 번짜리 주문 효과 배정';
  return null;
}
function polOrderTargetUnit(p,target){
  if(!target.unitOf)return everyUnit().find(u=>u.uid===target.uid);
  const ref=target.unitOf;
  return everyUnit().filter(u=>u.ctrl===p&&u.n===ref.n&&!u.isToken&&
    u.uid>=ref.since&&u.playedTurn===G.turnCount).sort((a,b)=>a.uid-b.uid)[ref.index];
}
function polOrderAction(p,a){
  if(a.kind==='runeEnergy'){
    const r=G.players[p].runes[a.idx];
    if(NET.online||!Number.isInteger(a.idx)||G.winner!==null||G.turn!==p||G.actingPlayer!==p||
        G.phase!=='action'||G.state!=='neutral'||!r||r.n!==a.n||r.ex)return null;
    return {...a,runeState:polBuffSequenceState(p)};
  }
  if(a.orderTarget?.units){
    const units=a.orderTarget.units.map(t=>t?polOrderTargetUnit(p,t):null);
    if(a.orderTarget.units.some((t,i)=>t&&!units[i]))return null;
    if(a.orderTarget.sacrificeUid!==undefined&&!everyUnit().some(u=>u.ctrl===p&&u.uid===a.orderTarget.sacrificeUid))return null;
    a={...a,orderTarget:{...a.orderTarget,uids:units.map(u=>u?.uid??null)}};
  }
  if(a.kind==='hidden'){
    const h=polHiddenForAction(p,a);
    return h&&polHiddenPlayable(p,a.bfIdx,h)&&polOffensivePlayable(p,a.n,a.bfIdx,true)?a:null;
  }
  if(a.kind==='play'){
    const idx=G.players[p].hand.indexOf(a.n);
    if(idx<0||!polCanPlay(p,card(a.n))||playRestriction(card(a.n),p,false))return null;
    return {...a,idx};
  }
  if(a.kind==='champ')return G.players[p].champInZone&&G.players[p].champN===a.n&&
    polCanPlay(p,card(a.n))&&!playRestriction(card(a.n),p,false)?a:null;
  if(a.kind==='ability'){
    const list=polAbList(p);let c;
    if(a.copyOf){
      const copy=a.copyOf,origins=copy.kind==='gear'?G.players[p].gear.filter(g=>g.n===copy.n).map(g=>({kind:'gear',g})):
        everyUnit().filter(u=>u.ctrl===p&&u.n===copy.n&&u.uid!==copy.uid).map(u=>({kind:'unit',u}));
      c=list.find(x=>x.src.u?.uid===copy.uid&&x.ab.copied&&origins.some(src=>
        x.key===polAbilitySourceKey(p,x.src)+'#copy:'+polAbilitySourceKey(p,src)+'#'+copy.index));
    }else if(a.abilityOf?.unitOf){
      const source=polOrderTargetUnit(p,{unitOf:a.abilityOf.unitOf});
      if(!source)return null;
      c=list.find(x=>x.src.u?.uid===source.uid&&
        x.key===polAbilitySourceKey(p,{kind:'unit',u:source})+'#'+a.abilityOf.index);
    }else c=a.abilityOf?list.filter(c=>{
      const n=c.src.u?.n??c.src.g?.n??G.players[p].legendN;
      return n===a.abilityOf.n&&c.src.kind===a.abilityOf.kind;
    })[a.abilityOf.index]:list.find(c=>c.key===a.key);
    if(!c||!polAbLegal(p,c))return null;
    const target=a.orderTarget?.unitOf?polOrderTargetUnit(p,a.orderTarget):null;
    if(a.orderTarget?.unitOf&&!target)return null;
    return {...a,src:c.src,ab:c.ab,key:c.key,
      ...(target?{orderTarget:{...a.orderTarget,uid:target.uid}}:{})};
  }
  return a;
}
async function polOrderResolve(p,a,ctx){
  if(a.kind==='movePlan'){
    if(!(ctx.movesLeft>0||polMfExtraMove(p)))return null;
    if(a.orderTarget?.units){
      const resolved=polOrderAction(p,a);if(!resolved)return null;
      const units=resolved.orderTarget.uids.map(uid=>everyUnit().find(u=>u.uid===uid&&u.ctrl===p&&!u.ex&&u.loc==='base'));
      return units.every(Boolean)?{kind:'move',units,dest:a.dest}:null;
    }
    const mv=await polMfMoveChoice(p,true);return mv?{kind:'move',units:mv.units,dest:mv.dest}:null;
  }
  return polOrderAction(p,a);
}
function polOrderKey(a){return a.kind==='champ'?'champ':a.kind==='play'?'h'+a.n:a.kind==='ability'?'a'+a.key:a.kind==='runeEnergy'?'r'+a.key:a.hiddenKey;}
async function polOrderFollowup(p,ctx){
  const plan=POLICY._orderFollowup;POLICY._orderFollowup=null;
  if(plan?.p!==p||plan.tc!==G.turnCount||plan.expected!==polBuffSequenceState(p))return null;
  const step=plan.steps[0];
  const act=await polOrderResolve(p,step,ctx);if(!act)return null;
  if(act.kind==='ability'?polAbilityTried(p,act,ctx):ctx.tried?.has(polOrderKey(step)))return null;
  return {...act,orderSequence:{steps:plan.steps.slice(1),states:plan.states}};
}
let polOrderDepth=0;
function polOrderEntryBuff(n){
  const triggers=FX[n]?.triggers.onPlay,op=triggers?.length===1&&triggers[0].ops?.length===1&&triggers[0].ops[0];
  return op?.op==='buff'&&[1,2].includes(op.count||1)&&op.spec?.side==='friendly'?op:null;
}
function polOrderDeathBuff(n){
  const triggers=FX[n]?.triggers.onUnitDeath,op=triggers?.length===1&&triggers[0].ops?.length===1&&triggers[0].ops[0];
  return op?.op==='buff'&&(op.count||1)===1&&op.spec?.side==='friendly'?op:null;
}
function polOrderSacrifice(n){
  if(FX[n]?.addCost?.kind==='killUnit')return 'cost';
  const groups=FX[n]?.playOps;
  return groups?.length===1&&!groups[0].legion&&groups[0].ops?.length===1&&
    groups[0].ops[0].op==='eachPlayerKills'?'effect':null;
}
async function polOrderChoice(p,ctx,core){
  // An on-play buff's bare winning callback does not carry the chosen
  // targets or paid readiness. Bind those choices before trusting that result.
  if(!polHard()||NET.online||SIM.active||SIM.lock||polOrderDepth||G.turn!==p||G.state!=='neutral'||G.phase!=='action'||
       core?.orderSequence||core?.buffSequence||core?.kaisaSequenceSteps||core?.kaisaTargets||core?.n===122||
       core?.emergencyWin&&!polOrderEntryBuff(core.n)&&!(polOrderSacrifice(core.n)&&
         [...G.players[p].gear.map(g=>g.n),...G.players[p].hand].some(polOrderDeathBuff)))return core;
  if(polMfAuroraDeck(p)&&POLICY._playScore>=7000)return core;
  if(!core||!['play','champ','hidden','move','ability','end'].includes(core.kind))return core;
  const protectedCore=!!(core.emergency||core.run);
  const P=G.players[p],stock=new Map();for(const n of P.hand)stock.set(n,(stock.get(n)||0)+1);
  const cards=[...stock.keys()].filter(n=>!ctx.tried?.has('h'+n)&&n!==122&&!polMfNeutralCardBlocked(p,n))
    .map(n=>({kind:'play',n}));
  if(P.champInZone&&!ctx.tried?.has('champ'))cards.push({kind:'champ',n:P.champN});
  for(let i=0;i<G.bfs.length;i++)for(const h of G.bfs[i].hiddenCards){
    if(h.n!==122&&polHiddenPlayable(p,i,h,ctx))cards.push(polHiddenAction(p,i,h));
  }
  const abilities=polAbList(p).filter(c=>!polAbilityTried(p,c,ctx)&&!polSafeResource(c)&&
    (!polAbOps(c).some(op=>POL_AB_BADOPS.has(op))||polMfTreasure(p,c)))
    .map(c=>({kind:'ability',key:c.key,n:c.src.u?.n??c.src.g?.n??P.legendN,ab:c.ab,src:c.src}));
  const future=[],copies=[];
  for(const a of cards)for(const [index,ab] of (FX[a.n]?.activated||[]).entries()){
    if(!ab.ops?.length||ab.ops.some(op=>POL_AB_BADOPS.has(op.op)))continue;
    const kind=card(a.n).type==='Gear'?'gear':'unit';
    if(abilities.some(x=>x.n===a.n))continue;
    future.push({kind:'ability',n:a.n,ab,abilityOf:{n:a.n,kind,index}});
    const profile=polOrderProfile(a.n,{kind:'ability',ab});
    if(ab.cost?.exhaustSelf&&(profile.readyAura||profile.bonus||profile.damage||profile.buff)){
      for(const h of everyUnit().filter(u=>u.ctrl===p&&unitFx(u).copyAllExhaust))
        copies.push({kind:'ability',n:h.n,ab:{...ab,copied:true},
          key:'future-copy:'+h.uid+':'+kind+':'+a.n+'#'+index,copyOf:{uid:h.uid,n:a.n,kind,index}});
    }
  }
  const targetedDamage=a=>{
    const hit=a.ab?.ops?.length===1&&a.ab.ops[0];
    return !a.ab?.target&&!a.ab?.preTarget&&['damage','dmgEqMyMight'].includes(hit?.op)&&hit.spec?.count===1&&
      ['bf','any'].includes(hit.spec.where)&&!hit.spec.custom&&!hit.spec.battlefield?hit:null;
  };
  const damageAbilities=abilities.filter(targetedDamage);
  const targetedBuff=a=>{
    const op=a.ab?.ops?.length===1&&a.ab.ops[0],cost=a.ab?.cost||{};
    return op?.op==='buff'&&(op.count||1)===1&&op.spec?.side==='friendly'&&
      !a.ab.target&&!a.ab.preTarget&&cost.exhaustSelf&&!cost.power&&!cost.pips?.length&&
      !cost.discard&&!cost.recycleTrash&&!cost.spendBuff&&!cost.killFriendlyOrGear&&!cost.killSelfGear;
  };
  const buffAbilities=abilities.filter(targetedBuff);
  const selfBuffAbilities=abilities.filter(a=>a.src.u?.loc==='base'&&a.ab.cost?.exhaustSelf&&
    a.ab.ops?.length===1&&a.ab.ops[0].op==='buffSelf');
  const selfBuffCards=cards.filter(a=>['play','champ'].includes(a.kind)&&card(a.n).type==='Unit'&&
    FX[a.n]?.activated?.some(ab=>ab.cost?.exhaustSelf&&ab.ops?.length===1&&ab.ops[0].op==='buffSelf'));
  const paidReadyGears=P.gear.filter(g=>!g.ex&&FX[g.n]?.triggers?.onYouBuff?.some(t=>
    t.ops?.some(o=>o.op==='mistfall')));
  const buffCards=cards.filter(a=>['play','champ'].includes(a.kind)&&polOrderEntryBuff(a.n));
  const deathBuffGears=P.gear.filter(g=>polOrderDeathBuff(g.n)),deathBuffCards=cards.filter(a=>
    ['play','champ'].includes(a.kind)&&card(a.n).type==='Gear'&&polOrderDeathBuff(a.n));
  const deathBuffConsumers=cards.filter(a=>['play','champ'].includes(a.kind)&&polOrderSacrifice(a.n));
  if(protectedCore&&!copies.length&&!damageAbilities.length&&!buffAbilities.length&&!selfBuffAbilities.length&&!selfBuffCards.length&&!future.some(targetedBuff)&&!buffCards.length&&
      !(deathBuffConsumers.length&&(deathBuffGears.length||deathBuffCards.length)))return core;
  const move={kind:'movePlan'},actions=[...cards,...abilities];
  if(ctx.movesLeft>0||polMfExtraMove(p))actions.push(move);
  const current=core.kind==='champ'?{...core,n:P.champN}:core.kind==='move'?move:core,pairs=[];
  for(const a of actions)for(const b of actions){
    if(a===b&&a.kind!=='ability')continue;
    if(a.kind==='play'&&b.kind==='play'&&a.n===b.n&&(stock.get(a.n)||0)<2)continue;
    const reason=polOrderDependency(p,a,b);if(reason)pairs.push({a,b,reason});
  }
  const triples=[];
  for(const ab of future)for(const supplier of cards.filter(a=>a.n===ab.n))for(const mate of cards){
    if(mate===supplier||!polOrderDependency(p,ab,mate))continue;
    triples.push({steps:[supplier,ab,mate],other:[mate,supplier,ab],reason:'설치와 능력 및 후속 플레이'});
  }
  // Three actions are useful when the middle action restores a spent buff or
  // readiness, or a second supplier is needed for the same consumer. Restrict
  // these paths to actual dependencies and to copies known before the draw.
  const chainSeen=new Set(),effectPlans=[];
  const addChain=(steps,reason,first=false)=>{
    const [a,b]=steps,c=steps[steps.length-1],counts=new Map();
    for(const x of steps){
      const key=x.kind+':'+(x.key||x.hiddenKey||x.n);counts.set(key,(counts.get(key)||0)+1);
      const repeatSelf=x.kind==='ability'&&x.orderTarget?.paidReady&&x.ab.ops?.length===1&&
        x.ab.ops[0].op==='buffSelf'&&(x.src?.u?unitFx(x.src.u).multiBuff:
          x.abilityOf?.unitOf&&FX[x.abilityOf.n]?.multiBuff);
      const cap=x.kind==='play'?stock.get(x.n)||0:x.kind==='ability'?(repeatSelf?paidReadyGears.length:3):1;
      if(counts.get(key)>cap)return;
    }
    const key=steps.map(x=>x.kind+':'+(x.key||x.hiddenKey||x.n)+
      (x.orderTarget?':target:'+JSON.stringify(x.orderTarget.unitOf||x.orderTarget.units||x.orderTarget.uid):'')+
      (x.orderTarget?.sacrificeUid!==undefined?':sacrifice:'+x.orderTarget.sacrificeUid:'')+
      (x.kind==='movePlan'&&Number.isInteger(x.dest)?':dest:'+x.dest:'')+
      (Object.hasOwn(x,'orderPlayLoc')?':loc:'+x.orderPlayLoc:'')).join('/');
    if(chainSeen.has(key))return;chainSeen.add(key);
    const sameEnds=a.kind===c.kind&&(a.key||a.hiddenKey||a.n)===(c.key||c.hiddenKey||c.n);
    const plan={steps,other:sameEnds&&steps.length===3?[b,a,c]:[...steps].reverse(),reason:reason+' 연쇄'};
    if(first)triples.unshift(plan);else triples.push(plan);
    return plan;
  };
  for(const {a,b,reason} of pairs)for(const c of actions){
    if(!polOrderDependency(p,b,c)||!(polOrderDependency(p,a,c)||b.kind==='ability'||a.kind==='ability'||b.kind==='movePlan'))continue;
    addChain([a,b,c],reason);
  }
  for(const {a,b:c,reason} of pairs)for(const {a:b,b:target} of pairs){
    if(target===c&&a!==b)addChain([a,b,c],reason+' 및 복수 공급');
  }
  // A Legion card, a ready-entry ability, a token ability and a team buff can
  // require four actions. Compare that concrete dependency chain before the
  // shorter alternatives consume the existing turn-order budget.
  for(const {a,b,reason} of pairs){
    if(!['play','champ','hidden'].includes(a.kind)||b.kind!=='ability'||!polOrderProfile(b.n,b).readyAura)continue;
    for(const c of abilities){
      if(!polOrderProfile(c.n,c).token||!polOrderDependency(p,b,c))continue;
      for(const d of cards){
        if(polOrderProfile(d.n,d).team&&polOrderDependency(p,c,d))
          addChain([a,b,c,d],reason+' 및 준비 신병과 전체 강화',true);
      }
    }
  }
  // Already installed ready-entry abilities also need a body between them:
  // two next-unit flags before either play would not prepare both bodies.
  const readyAbilities=abilities.filter(a=>polOrderProfile(a.n,a).readyAura);
  for(const a of readyAbilities)for(const b of readyAbilities){
    if(a.key===b.key)continue;
    for(const first of cards)for(const second of cards){
      if(card(first.n).type==='Unit'&&card(second.n).type==='Unit')
        addChain([a,first,b,second],'별도 준비 능력과 복수 유닛',true);
    }
  }
  // A damage source already in play needs the same target/follow-up comparison
  // as a newly acquired copy. The engine owns legality, Ward and payment.
  const addDamagePlans=(ability,prefix,reason)=>{
    const hit=targetedDamage(ability);if(!hit)return;
    const targets=unitsBySpec(hit.spec,p).filter(u=>u.ctrl!==p);
    targets.sort((a,b)=>targetMight(a)-a.dmg-(targetMight(b)-b.dmg));
    for(const mate of cards){
      if(card(mate.n).type!=='Spell'||!polOrderProfile(mate.n,mate).damage)continue;
      for(const u of targets){
        const targeted={...ability,orderTarget:{index:0,uid:u.uid}};
        const plan=addChain([...prefix,targeted,mate],reason,true);
        if(plan)effectPlans.push(plan);
      }
    }
  };
  for(const ability of damageAbilities)
    addDamagePlans(ability,[],'기존 피해 능력의 대상 및 후속 주문');
  // Separate buffs and paid readiness can prepare an army only when both bodies
  // are deployed where they can join it. Bind the actual plays, not old copies.
  const existing=P.base.filter(u=>u.ctrl===p&&u.ex&&(!u.buff||unitFx(u).multiBuff)).sort((a,b)=>might(b)-might(a))
    .map(u=>({kind:'existing',n:u.n,uid:u.uid}));
  const armyBodies=[...existing,...cards.filter(c=>['play','champ'].includes(c.kind)&&card(c.n).type==='Unit')];
  const bodyMight=c=>c.kind==='existing'?might(P.base.find(u=>u.uid===c.uid)):(card(c.n).m||0);
  armyBodies.sort((a,b)=>bodyMight(b)-bodyMight(a));
  const armyTarget=(c,index)=>c?({index:0,paidReady:true,...(c.kind==='existing'?{uid:c.uid}:
    {unitOf:{n:c.n,since:UID,index}})}):null;
  const armyDeploy=(first,second)=>[first,second].filter(c=>c&&c.kind!=='existing').map(c=>({...c,orderPlayLoc:'base'}));
  const singleBuffAction=(supplier,target)=>supplier.kind==='ability'
    ? {...supplier,orderTarget:target}
    : {...supplier,...(card(supplier.n).type==='Unit'?{orderPlayLoc:'base'}:{}),
        orderTarget:{units:[target],paidReady:true}};
  const buffMarchPlans=[],buffRemovalPlans=[],buffArmyPlans=[];
  const addBuffMarchPlans=(setup,targets)=>{
    // An exhaust ability's source cannot join the march after supplying it.
    const ids=targets.filter(Boolean).map(t=>t.uid),sources=setup.filter(a=>a.kind==='ability'&&a.ab.cost?.exhaustSelf)
      .map(a=>a.src?.u?.uid??a.copyOf?.uid);
    const ready=P.base.filter(u=>u.ctrl===p&&!u.ex&&!ids.includes(u.uid)&&!sources.includes(u.uid));
    const addMarch=(consumer,donor)=>{
      const army=[...targets.filter(Boolean),...ready.filter(u=>u.uid!==donor?.uid).map(u=>({uid:u.uid}))];
      for(let dest=0;dest<G.bfs.length;dest++){
        const move={kind:'movePlan',dest,orderTarget:{units:army}};
        const removal=consumer?{...consumer,orderTarget:{units:[],sacrificeUid:donor.uid}}:null;
        const plan=addChain([...setup,...(removal?[removal]:[]),move],
          '버프와 기존 준비 병력 및 제거 후 합류 공격',true);
        if(plan){(consumer?buffRemovalPlans:buffMarchPlans).push(plan);buffArmyPlans.push(plan);}
        // Removing first can pay energy from the very runes the later readies
        // recycle. Compare this native order too; never assume the donor or
        // either buff source survives the mutual kill.
        if(removal){
          const before=addChain([removal,...setup,move],'제거 후 버프와 유료 준비 및 합류 공격',true);
          if(before){buffRemovalPlans.push(before);buffArmyPlans.push(before);}
        }
      }
    };
    // Test the native march before spending a known mutual kill. Its opposing
    // victim is still chosen by the other player's existing policy.
    addMarch(null,null);
    for(const consumer of deathBuffConsumers.filter(a=>polOrderSacrifice(a.n)==='effect'))
      for(const donor of everyUnit().filter(u=>u.ctrl===p&&!u._dead&&!ids.includes(u.uid))
          .sort((a,b)=>evalCombatRemovalValue(a)-evalCombatRemovalValue(b)))addMarch(consumer,donor);
  };
  const addBuffArmyPlans=(a,b,prefix)=>{
    if(paidReadyGears.length<2||!(ctx.movesLeft>0||polMfExtraMove(p)))return;
    for(const first of armyBodies)for(const second of armyBodies){
      if(first.uid!==undefined&&first.uid===second.uid)continue;
      const targets=[armyTarget(first,0),armyTarget(second,first.kind!=='existing'&&first.n===second.n?1:0)];
      const A=singleBuffAction(a,targets[0]),B=singleBuffAction(b,targets[1]),setup=[...prefix,...armyDeploy(first,second),A,B];
      const plan=addChain(setup,
        '별도 버프와 유료 준비 및 기지 합류 공격',true);
      if(plan)effectPlans.push(plan);
      addBuffMarchPlans(setup,targets);
    }
  };
  for(const a of buffAbilities)for(const b of buffAbilities){
    if(a.key===b.key||a.src.u&&a.src.u===b.src.u||a.src.g&&a.src.g===b.src.g)continue;
    addBuffArmyPlans(a,b,[]);
  }
  const addBuffCardPlan=(supplier,first,second)=>{
    if(first.uid!==undefined&&first.uid===second?.uid)return;
    const targets=[armyTarget(first,0),...((polOrderEntryBuff(supplier.n).count||1)===2?
      [armyTarget(second,first.kind!=='existing'&&first.n===second?.n?1:0)]:[])];
    const setup=[...armyDeploy(first,second),{...supplier,orderPlayLoc:'base',
      orderTarget:{units:targets,paidReady:true}}];
    const plan=addChain(setup,'등장 버프와 유료 준비 및 합류 공격',true);
    if(plan)effectPlans.push(plan);
    addBuffMarchPlans(setup,targets);
  };
  const addSingleBuffAbilityPlans=(ability,prefix)=>{
    if(!paidReadyGears.length||!(ctx.movesLeft>0||polMfExtraMove(p)))return;
    for(const body of armyBodies){
      const target=armyTarget(body,0),setup=[...prefix,...armyDeploy(body,null),singleBuffAction(ability,target)];
      const plan=addChain(setup,'활성화 버프와 유료 준비 및 합류 공격',true);
      if(plan)effectPlans.push(plan);
      addBuffMarchPlans(setup,[target]);
    }
  };
  for(const ability of buffAbilities)addSingleBuffAbilityPlans(ability,[]);
  for(const ability of future.filter(targetedBuff))for(const installation of cards.filter(a=>a.n===ability.n))
    addSingleBuffAbilityPlans(ability,[installation]);
  for(const copy of copies.filter(targetedBuff))for(const installation of cards.filter(a=>a.n===copy.copyOf.n))
    addSingleBuffAbilityPlans(copy,[installation]);
  if(paidReadyGears.length&&(ctx.movesLeft>0||polMfExtraMove(p)))
    for(const supplier of buffCards.filter(a=>(polOrderEntryBuff(a.n).count||1)===2)){
      // An optional second buff should not spend another preparation cost when
      // the strongest known body already wins through the native engine.
      if(armyBodies.length&&polOrderEntryBuff(supplier.n).spec.optional)
        addBuffCardPlan(supplier,armyBodies[0],null);
      if(paidReadyGears.length>=2)for(const first of armyBodies)for(const second of armyBodies)
        addBuffCardPlan(supplier,first,second);
    }
  const singleBuffCards=buffCards.filter(a=>(polOrderEntryBuff(a.n).count||1)===1);
  if(paidReadyGears.length&&(ctx.movesLeft>0||polMfExtraMove(p)))for(const supplier of singleBuffCards){
    for(const body of armyBodies)addBuffCardPlan(supplier,body,null);
    for(const ability of buffAbilities){
      addBuffArmyPlans(supplier,ability,[]);
      addBuffArmyPlans(ability,supplier,[]);
    }
    for(const ability of future.filter(targetedBuff))for(const installation of cards.filter(a=>a.n===ability.n)){
      addBuffArmyPlans(supplier,ability,[installation]);
      addBuffArmyPlans(ability,supplier,[installation]);
    }
    for(const second of singleBuffCards)addBuffArmyPlans(supplier,second,[]);
  }
  // Self buffs exhaust their own recipient, including an inherited ability.
  // Paid readiness must return that same source to the army. Lee Sin can
  // repeat it, while an ordinary copier cannot acquire a second buff.
  if(paidReadyGears.length&&(ctx.movesLeft>0||polMfExtraMove(p)))for(const a of selfBuffAbilities){
    const target={index:0,uid:a.src.u.uid,paidReady:true},A={...a,orderTarget:target};
    addBuffMarchPlans([A],[target]);
    if(paidReadyGears.length<2)continue;
    if(unitFx(a.src.u).multiBuff)for(let count=2;count<=paidReadyGears.length;count++)
      addBuffMarchPlans(Array.from({length:count},()=>A),[target]);
    for(const b of selfBuffAbilities){
      if(a.src.u.uid===b.src.u.uid)continue;
      const second={index:0,uid:b.src.u.uid,paidReady:true},B={...b,orderTarget:second};
      addBuffMarchPlans([A,B],a.src.u.uid===b.src.u.uid?[target]:[target,second]);
    }
    for(const supplier of [...buffAbilities,...singleBuffCards])for(const body of armyBodies){
      const second=armyTarget(body,0),B=singleBuffAction(supplier,second),deploy=armyDeploy(body,null);
      const targets=body.uid===target.uid?[target]:[target,second];
      addBuffMarchPlans([...deploy,A,B],targets);
      addBuffMarchPlans([...deploy,B,A],targets);
    }
  }
  // A known self-buffing unit needs a real ready arrival before its first
  // exhaustion. Bind its new instance, so an older copy of the same card
  // cannot supply the promised activation or receive its paid readiness.
  if(paidReadyGears.length&&(ctx.movesLeft>0||polMfExtraMove(p)))for(const supplier of selfBuffCards){
    const target=armyTarget(supplier,0),unitOf=target.unitOf;
    const readyPrefixes=(TF().enterReady[p]||TF().nextUnitReady[p]||FX[supplier.n]?.entersReady===true||
      collectStatics().some(x=>x.p===p&&x.s.kind==='enterReadyAura'))?[[]]:[];
    for(const a of readyAbilities)readyPrefixes.push([a]);
    for(const a of cards)if(a!==supplier&&['play','champ'].includes(a.kind)&&polOrderProfile(a.n,a).readyAura)
      readyPrefixes.push([a]);
    for(const a of future)if(polOrderProfile(a.n,a).readyAura)
      for(const installation of cards.filter(c=>c.n===a.n))readyPrefixes.push([installation,a]);
    for(const [index,ab] of FX[supplier.n].activated.entries()){
      if(!ab.cost?.exhaustSelf||ab.ops?.length!==1||ab.ops[0].op!=='buffSelf')continue;
      const A={kind:'ability',n:supplier.n,ab,key:'new-self:'+supplier.n+':'+unitOf.since+'#'+index,
        abilityOf:{n:supplier.n,kind:'unit',index,unitOf},orderTarget:target};
      const cap=FX[supplier.n].multiBuff?paidReadyGears.length:1;
      for(const prefix of readyPrefixes)for(let count=1;count<=cap;count++)
        addBuffMarchPlans([...prefix,{...supplier,orderPlayLoc:'base'},...Array.from({length:count},()=>A)],[target]);
    }
  }
  // Keep each preparation's ordinary march ahead of its removal alternatives,
  // then advance to the next preparation. Trying every losing ordinary army
  // first can exhaust the fixed budget before its matching Cull path is seen.
  effectPlans.unshift(...buffArmyPlans);
  // Death buffs require the sacrifice, the recipients and their paid readiness
  // to be evaluated together. Killing the weakest unbuffed token never tests it.
  if(paidReadyGears.length&&(ctx.movesLeft>0||polMfExtraMove(p))&&deathBuffConsumers.length){
    const prefixes=[[],...deathBuffCards.map(a=>[a])];
    const singleDeathPlans=[],nativeDeathPlans=[],preparedDeathPlans=[],multiDeathPlans=[],enemyMight=Math.max(0,...everyUnit().filter(u=>u.ctrl!==p&&u.loc!=='base').map(might));
    for(const a of deathBuffCards)for(const b of deathBuffCards)prefixes.push([a,b]);
    const donors=everyUnit().filter(u=>u.ctrl===p&&!u._dead)
      .sort((a,b)=>Number(b.buff>0)-Number(a.buff>0)||evalCombatRemovalValue(a)-evalCombatRemovalValue(b));
    const donorBuffs=[...singleBuffCards,...buffAbilities];
    for(const prefix of prefixes){
      const sources=[...deathBuffGears.map(g=>g.n),...prefix.map(a=>a.n)];if(!sources.length)continue;
      const addDeathBuffPlan=(consumer,donor,first,second,preparer)=>{
        if(donor.uid===first.uid||donor.uid===second?.uid)return;
        const targets=[armyTarget(first,0)];
        if(sources.length>1)targets.push(second?armyTarget(second,
          first.kind!=='existing'&&first.n===second.n?1:0):targets[0]);
        const step={...consumer,...(card(consumer.n).type==='Unit'?{orderPlayLoc:'base'}:{}),orderTarget:{units:targets,paidReady:true,
          deathSources:[...new Set(sources)],sacrificeUid:donor.uid}};
        // A cheap unbuffed donor can first receive a known buff. It will die
        // as the next action, so preserve paid readiness for the surviving army.
        const setup=preparer?[singleBuffAction(preparer,{index:0,uid:donor.uid,paidReady:true})]:[];
        if(setup.length)setup[0].orderTarget.skipPaidReady=true;
        const plan=addChain([...prefix,...armyDeploy(first,second),...setup,step],
          '희생 사망 버프의 별도 대상과 유료 준비 및 합류 공격',true);
        // Try the army before a lone weak body spends the limited search time
        // losing combat and resolving more death buffs. A strong solo body goes first.
        if(plan)(!second&&bodyMight(first)<enemyMight?singleDeathPlans:preparer?preparedDeathPlans:nativeDeathPlans).push(plan);
      };
      for(const consumer of deathBuffConsumers)for(const donor of donors){
        for(const preparer of donor.buff>0?[null]:donorBuffs){
          for(const body of armyBodies)addDeathBuffPlan(consumer,donor,body,null,preparer);
          if(sources.length>=2&&paidReadyGears.length>=2)for(const first of armyBodies)for(const second of armyBodies){
            if(first.uid!==undefined&&first.uid===second.uid)continue;
            addDeathBuffPlan(consumer,donor,first,second,preparer);
          }
        }
      }
      // A two-target entry buff can prepare the donor and one survivor. Two
      // death buffs then prepare the other survivors, using three paid readies.
      if(sources.length>=2&&paidReadyGears.length>=3)
        for(const preparer of buffCards.filter(a=>(polOrderEntryBuff(a.n).count||1)===2))
          for(const consumer of deathBuffConsumers)for(const donor of donors.filter(u=>!u.buff))
            for(const first of armyBodies)for(const second of armyBodies)for(const third of armyBodies){
              const bodies=[first,second,third],ids=bodies.filter(c=>c.uid!==undefined).map(c=>c.uid);
              if(ids.includes(donor.uid)||new Set(ids).size!==ids.length)continue;
              const copies=new Map(),targets=bodies.map(c=>{
                const index=c.kind==='existing'?0:copies.get(c.n)||0;
                if(c.kind!=='existing')copies.set(c.n,index+1);
                return armyTarget(c,index);
              });
              const setup={...preparer,orderPlayLoc:'base',orderTarget:{
                units:[{uid:donor.uid},targets[0]],paidReady:true,skipPaidReadyIndex:0}};
              const step={...consumer,...(card(consumer.n).type==='Unit'?{orderPlayLoc:'base'}:{}),
                orderTarget:{units:targets.slice(1),paidReady:true,deathSources:[...new Set(sources)],sacrificeUid:donor.uid}};
              const deployments=bodies.filter(c=>c.kind!=='existing').map(c=>({...c,orderPlayLoc:'base'}));
              for(let dest=0;dest<G.bfs.length;dest++){
                const move={kind:'movePlan',dest,orderTarget:{units:targets}};
                const plan=addChain([...prefix,...deployments,setup,step,move],
                  '복수 등장 버프의 희생 대상과 세 병력의 별도 준비 및 합류 공격',true);
                if(plan)multiDeathPlans.push(plan);
              }
            }
    }
    // Try a prepared donor's surviving army before lone on-play recipients
    // spend the search budget on losing combat.
    effectPlans.unshift(...nativeDeathPlans,...preparedDeathPlans,...multiDeathPlans);
    effectPlans.push(...singleDeathPlans);
  }
  // Installing a source gives a current copier a new ability. Spell bonuses
  // can share one consumer; ready-entry flags need separate bodies between them.
  // Native activation owns stacking, Legion, exhaustion and payment.
  const copiedMarchStart=buffMarchPlans.length,copiedRemovalStart=buffRemovalPlans.length;
  for(const copy of copies){
    const ab=future.find(x=>x.n===copy.copyOf.n&&x.abilityOf.kind===copy.copyOf.kind&&x.abilityOf.index===copy.copyOf.index);
    // An exhausted-entry source can still supply a ready copier. Compare its
    // declared damage target with the known follow-up spell, including Ward.
    for(const supplier of cards.filter(x=>x.n===ab.n))
      addDamagePlans(copy,[supplier],'설치와 복사 피해 대상 및 후속 주문');
    if(targetedBuff(ab)&&targetedBuff(copy))for(const supplier of cards.filter(x=>x.n===ab.n))
      addBuffArmyPlans(ab,copy,[supplier]);
    if(polOrderProfile(copy.n,copy).bonus){
      for(const supplier of cards.filter(x=>x.n===ab.n))for(const mate of cards){
        if(polOrderDependency(p,copy,mate)&&polOrderDependency(p,ab,mate)){
          const plan=addChain([supplier,ab,copy,mate],'설치와 복사 능력 및 주문 보너스',true);
          if(plan)effectPlans.push(plan);
        }
      }
    }
    if(!polOrderProfile(copy.n,copy).readyAura)continue;
    for(const supplier of cards.filter(x=>x.n===ab.n))for(const a of cards)for(const b of cards){
      if(card(a.n).type==='Unit'&&card(b.n).type==='Unit'){
        const plan=addChain([supplier,copy,a,ab,b],'설치와 복사 준비 및 복수 유닛',true);
        if(plan)effectPlans.push(plan);
      }
    }
  }
  // A ready Body rune paid as power by Mistfall otherwise loses its energy
  // opportunity. Try native floating before these known sequences, only after
  // their ordinary paths. Native payment decides the required float count.
  effectPlans.push(...buffMarchPlans.slice(copiedMarchStart),...buffRemovalPlans.slice(copiedRemovalStart));
  const bound=plan=>plan.steps.some(a=>a.kind==='movePlan'&&a.orderTarget?.units);
  // Keep the established death sequences first. An implicit move re-search
  // otherwise spends the budget before a two-rune, fully bound path is tried.
  let deathPrefix=0;
  while(effectPlans[deathPrefix]?.steps.some(a=>a.orderTarget?.deathSources))deathPrefix++;
  const early=effectPlans.slice(0,deathPrefix),rest=effectPlans.slice(deathPrefix),marches=rest.filter(bound),fallback=rest.filter(plan=>!bound(plan));
  // Within activated buff marches, test the stronger known army first. A
  // copier's exhaustion can replace a ready attacker with a weak recruit;
  // repeatedly fighting with those smaller armies hides the usable self or
  // installed-copy path. This only ranks probes; the native fight must win.
  const activatedMarch=plan=>plan.steps.some(a=>a.kind==='ability'&&
      ['buff','buffSelf'].includes(a.ab.ops?.[0]?.op))&&
    !plan.steps.some(a=>polOrderEntryBuff(a.n)||a.orderTarget?.deathSources);
  const rankedMarches=marches.filter(activatedMarch).map(plan=>{
    const buffs=plan.steps.filter(a=>a.kind==='ability'&&['buff','buffSelf'].includes(a.ab.ops?.[0]?.op));
    const repeatedSelf=buffs.length>1&&buffs.every(a=>a.ab.ops?.length===1&&
      a.ab.ops[0].op==='buffSelf'&&a.key===buffs[0].key);
    const march=plan.steps.find(a=>a.kind==='movePlan');
    const strength=march.orderTarget.units.reduce((sum,t)=>{
      const u=t.uid!==undefined?everyUnit().find(u=>u.uid===t.uid):null;
      return sum+(u?might(u):card(t.unitOf?.n).m||0);
    },0);
    const defenders=G.bfs[march.dest]?.units.filter(u=>u.ctrl!==p)||[];
    let defending=defenders.reduce((sum,u)=>sum+might(u),0);
    // A known Cull may remove the weakest defender. This is an optimistic
    // ranking only: the normal opponent still chooses, and native combat
    // must confirm the entire sequence before any action is returned.
    if(plan.steps.some(a=>a.n===209)&&defenders.length)
      defending-=Math.min(...defenders.map(u=>might(u)));
    const need=Math.max(1,Math.floor(defending-strength)+1);
    return {plan,strength,
      // Try the cheap single buff first, then the repeated count closest to
      // a sufficient army, leaving time to check native resource savings.
      priority:buffs.length===1?0:repeatedSelf?1+Math.abs(buffs.length-need):buffs.length+1
    };
  }).sort((a,b)=>b.strength-a.strength||a.priority-b.priority);
  let rankedIndex=0;
  for(let i=0;i<marches.length;i++)if(activatedMarch(marches[i]))marches[i]=rankedMarches[rankedIndex++].plan;
  const energyRunes=P.runes.map((r,idx)=>!r.ex&&runeDomain(r.n)==='Body'?
    {kind:'runeEnergy',n:r.n,idx,key:'energy:'+idx}:null).filter(Boolean);
  const normalPlans=[...early,...marches].filter(plan=>bound(plan)&&plan.steps.some(a=>a.orderTarget?.paidReady)),floatPlans=[];
  // Ordinary marches have already been compared without spending runes early.
  // Try the complete removal path before repeating those same losing combats
  // for every float count, which can otherwise consume the decision budget.
  const readyCount=plan=>plan.steps.reduce((n,a)=>n+(a.orderTarget?.paidReady&&!a.orderTarget.skipPaidReady?
    a.orderTarget.units?.filter(Boolean).length||1:0),0);
  normalPlans.sort((a,b)=>Number(b.steps.some(x=>polOrderSacrifice(x.n)==='effect'))-
    Number(a.steps.some(x=>polOrderSacrifice(x.n)==='effect'))||readyCount(b)-readyCount(a));
  for(const plan of normalPlans){
    const energy=plan.steps.reduce((sum,a)=>sum+(a.kind==='ability'?a.ab.cost?.energy||0:
      ['play','champ'].includes(a.kind)?card(a.n).e||0:0),0);
    const other=P.runes.filter(r=>!r.ex&&runeDomain(r.n)!=='Body').length;
    // Printed costs only rank the probes; native payment still decides them.
    const guess=Math.max(1,Math.min(energyRunes.length,energy-P.energy-other));
    const counts=energyRunes.map((_,i)=>i+1).sort((a,b)=>Math.abs(a-guess)-Math.abs(b-guess)||a-b);
    for(const count of counts){
      const floated=addChain([...energyRunes.slice(0,count),...plan.steps],
        '재활용 전 룬 에너지와 '+plan.reason,true);
      if(floated)floatPlans.push(floated);
    }
  }
  effectPlans.splice(0,effectPlans.length,...early,...marches,...floatPlans,...fallback);
  if(!pairs.length&&!triples.length)return core;
  const deadline=SIM.deadline;SIM.deadline=Math.min(deadline||Infinity,Date.now()+1200);polOrderDepth++;
  try{
    const probe=async steps=>{
      let complete=false,states=[],resources=0,won=false,readyTraces=[],triggerTraces=[];
      const value=await simTry(p,async()=>{
        UI.pickReaction=async()=>null;
        const remaining=new Map(stock),response=polKaisaSequenceResponse(p,remaining),other=G.players[opp(p)],moves={...ctx};
        if(polKaisaDeck(p))polKaisaTurnPublicSample(p,0);
        else{
          G.players[p].deck.sort((a,b)=>a-b);G.players[p].runeDeck.sort((a,b)=>a-b);
          other.hand=other.hand.map(()=>134);other.deck=other.deck.map(()=>134);other.runeDeck.sort((a,b)=>a-b);
        }
        for(const step of steps){
          if(step.kind==='play'&&(remaining.get(step.n)||0)<1)return;
          if(step.kind==='end')continue;
          const act=await polOrderResolve(p,step,moves);if(!act)return;
          const trace=[],triggerTrace=[];readyTraces.push(trace);triggerTraces.push(triggerTrace);
          if(act.orderTarget?.paidReady){act.orderReadyProbe=trace;act.orderTriggerProbe=triggerTrace;}
          if(await POLICY.runAction(p,act)===false)return;
          if(act.kind==='move')moves.movesLeft--;
          if(step.kind==='play')remaining.set(step.n,remaining.get(step.n)-1);
          await simSettle(p,response);states.push(polBuffSequenceState(p));
          if(G.winner!==null){complete=true;won=G.winner===p;return;}
        }
        complete=true;POLICY.turnPlan=null;
        // Kai'Sa's core has already compared all remaining attacks, turn end
        // and public counterplay. Use that same horizon before replacing it:
        // one follow-up move can make attacking before Watcher look better
        // while omitting the second conquest enabled by Watcher's debuff.
        if(polKaisaDeck(p)||core?.mfGankUid){
          if(moves.movesLeft>0&&G.turn===p&&G.phase==='action'&&G.state==='neutral')
            await polKaisaTurnMoves(p,Math.min(4,moves.movesLeft));
          if(G.winner===null&&G.turn===p&&G.phase==='action')await endTurn();
          await simSettle(p,response);
          if(G.winner===null)await polKaisaTurnOpponentMoves(p);
        }else if(moves.movesLeft>0&&G.turn===p&&G.phase==='action'&&G.state==='neutral'){
          const mv=await polMfMoveChoice(p,true);
          if(mv){await moveUnits(p,mv.units,mv.dest);await simSettle(p,response);}
        }
        won=G.winner===p;
        if(!polKaisaDeck(p)&&!core?.mfGankUid)for(const u of everyUnit()){u.tempM=u.tempM.filter(t=>t.dur!=='turn');u.dmg=0;}
        // evalResourceValue already prices energy and spell energy. Only the
        // power pools are absent there; do not count unused energy twice.
        const Q=G.players[p];resources=polKaisaDeck(p)?polKaisaTurnFieldValue(p)+polKaisaSequenceRoles(p)+polKaisaSequenceReserve(p):
          core?.mfGankUid?polKaisaTurnFieldValue(p):(Q.powerSpell+Object.values(Q.power).reduce((s,n)=>s+n,0))*BOT_W.rune;
      },POLICY,false,false);
      return complete&&value!==null?{value:value+(won?0:resources),states,won,readyTraces,triggerTraces}:null;
    };
    const withReadiness=(steps,result)=>steps.map((a,i)=>result.readyTraces[i]?.length||result.triggerTraces[i]?.length?
      {...a,orderTarget:{...a.orderTarget,readyTrace:result.readyTraces[i],triggerTrace:result.triggerTraces[i]}}:a);
    let base=null,best=null;const seen=new Set();
    const comparePair=async({a,b,reason})=>{
      const key=[a.kind+':'+(a.key||a.n),b.kind+':'+(b.key||b.n)].sort().join('/');
      if(seen.has(key))return;seen.add(key);
      const forward=await probe([a,b]),reverse=await probe([b,a]);
      for(const [result,other,steps] of [[forward,reverse,[a,b]],[reverse,forward,[b,a]]]){
        if(!result||other&&result.value<=other.value+BOT_W.moveNeed||result.value<=base.value+BOT_W.moveNeed)continue;
        if(!best||result.value>best.value+1e-9)best={...result,steps,reason};
      }
    };
    // Check a known strength supplier before unrelated losing win searches
    // exhaust the deadline and leave a lethal mutual-damage core unchanged.
    const coreSuppliers=protectedCore?[]:pairs.filter(x=>['위력 활용','위치 변경 후 제거'].includes(x.reason)&&
      x.b.kind===current.kind&&x.b.n===current.n).sort((a,b)=>
        Number(polOrderProfile(b.a.n,b.a).has('buffAndMove'))-Number(polOrderProfile(a.a.n,a.a).has('buffAndMove')));
    if(coreSuppliers.length){
      base=await probe(current.kind==='end'?[]:[current]);if(!base)return core;
      for(const pair of coreSuppliers){if(Date.now()>SIM.deadline)break;await comparePair(pair);}
    }
    // Keep a protected survival/run action unless this known effect sequence
    // sequence actually wins. Do not rank speculative exchanges against it.
    for(const {steps} of effectPlans){
      if(Date.now()>SIM.deadline)break;
      let result=await probe(steps);if(!result?.won)continue;
      let chosen=steps,prefix=0;
      const selfCounts=new Map();
      for(const a of steps)if(a.kind==='ability'&&a.orderTarget?.paidReady&&
          a.ab.ops?.length===1&&a.ab.ops[0].op==='buffSelf')
        selfCounts.set(a.key,(selfCounts.get(a.key)||0)+1);
      // Recheck fewer activations on the same native winning path. This avoids
      // spending surplus Mistfalls when the stronger probe needed only two or
      // three buffs, without assuming damage or payment is monotonic.
      for(const [key,total] of selfCounts)for(let count=1;count<total&&Date.now()<=SIM.deadline;count++){
        let used=0;
        const fewer=chosen.filter(a=>!(a.kind==='ability'&&a.key===key)||++used<=count);
        const candidate=await probe(fewer);
        if(candidate?.won){chosen=fewer;result=candidate;break;}
      }
      while(chosen[prefix]?.kind==='runeEnergy')prefix++;
      // Recheck fewer floats on the same action set, rather than trusting the
      // cost estimate or spending an extra rune energy action unnecessarily.
      for(let count=1;count<prefix&&Date.now()<=SIM.deadline;count++){
        const fewer=[...chosen.slice(0,count),...chosen.slice(prefix)],candidate=await probe(fewer);
        if(candidate?.won){chosen=fewer;result=candidate;break;}
      }
      const [first,...rest]=withReadiness(chosen,result),act=await polOrderResolve(p,first,ctx);
      if(act)return {...act,orderSequence:{steps:rest,states:result.states}};
    }
    if(protectedCore)return core;
    if(!base)base=await probe(current.kind==='end'?[]:[current]);if(!base)return core;
    for(const {a,b,reason} of pairs){
      if(Date.now()>SIM.deadline)break;
      await comparePair({a,b,reason});
    }
    for(const {steps,other,reason} of triples){
      if(Date.now()>SIM.deadline)break;
      // Floating is only justified by a fully resolved winning sequence.
      if(steps.some(a=>a.kind==='runeEnergy'))continue;
      const result=await probe(steps),reverse=await probe(other);
      if(!result||reverse&&result.value<=reverse.value+BOT_W.moveNeed||result.value<=base.value+BOT_W.moveNeed)continue;
      let improves=!best||result.value>best.value+1e-9;
      if(!improves&&best.steps.length<steps.length){
        // Compare the same action set: the shorter preferred pair can leave
        // a listener in hand and play it too late on the next decision. Its
        // unused energy/follow-up premium is not the outcome of all 3 cards.
        const rest=steps.slice(),key=x=>x.kind+':'+(x.key||x.hiddenKey||x.n);
        const contained=best.steps.every(x=>{
          const i=rest.findIndex(y=>key(y)===key(x));if(i<0)return false;rest.splice(i,1);return true;
        });
        if(contained){
          const extended=await probe([...best.steps,...rest]);
          improves=!!extended&&result.value>extended.value+BOT_W.moveNeed;
        }
      }
      if(improves)best={...result,steps,reason};
    }
    if(!best)return core;
    const [first,...steps]=withReadiness(best.steps,best);
    const act=await polOrderResolve(p,first,ctx);if(!act)return core;
    polSay('play-order',first.n?card(first.n).ko:'이동',best.reason+'의 실제 순서와 후속 전투 비교',{gain:best.value-base.value});
    return {...act,orderSequence:{steps,states:best.states}};
  }finally{polOrderDepth--;SIM.deadline=deadline;}
}
POLICY.baseNextAction = async function(p, ctx){
  const kaisa=await polKaisaNextAction(p,ctx);
  if(kaisa){
    const a=await polKaisaPreserveWarp(p,ctx,kaisa);
    // 이미 증명한 추가 턴/전투 연속 수는 전용 계획을 유지한다.
    if(a?.n===122||a?.kaisaSequenceSteps||a?.kaisaTargets)return a;
    return polBuffFollowup(p,ctx)||await polBuffOrder(p,ctx,a);
  }
  const warp=await polGenericWarpChoice(p,ctx);
  if(warp)return warp;
  const emergency=await polEmergencyAction(p,ctx);
  if(emergency) return emergency;
  const follow=polBuffFollowup(p,ctx);if(follow)return follow;
  let core=null;
  if(polMfAuroraDeck(p)){
    core=await POLICY.playPlan(p,ctx);
    core=await polMfCompareExtraAurora(p,ctx,core);
    if(core?.kind==='move') return core;
    if(core&&POLICY._playScore>=7000) return core;
    // A verified ganking grant can supply the defender for the next capture.
    // Do not let the ramp comparison take that capture with a lone small unit.
    const prepare=await POLICY.abilityPlan(p,ctx,false);
    if(prepare?.mfGankUid)return prepare;
    const value=await polMfValueBeforeRamp(p,ctx);
    if(value) return value;
  }
  let a = POLICY.hiddenPlan(p, ctx, false);
  if(a) return a;
  a = core || await POLICY.playPlan(p, ctx);
  if(a){
    const recycle=await polTrashRecycleBeforePlay(p,ctx,a);
    if(recycle!==a)return recycle;
    return polBuffOrder(p,ctx,await polLegionOrder(p,ctx,a));
  }
  a = await POLICY.abilityPlan(p, ctx, false);
  if(a) return a;
  if(ctx.movesLeft > 0 || polMfExtraMove(p)){
    const mv = await polMfMoveChoice(p,false,ctx.movesLeft);
    if(mv) return { kind:'move', units:mv.units, dest:mv.dest };
    // A preparation ability may create the move that is unavailable now.
    a = await POLICY.abilityPlan(p,ctx,true);
    if(a)return a;
    // A later spell or ability can open an attack. An unprofitable move now
    // does not spend the remaining move-search allowance.
  }
  a = await POLICY.abilityPlan(p, ctx, true);
  if(a) return a;
  a = POLICY.hidePlan(p, ctx);
  if(a) return a;
  return { kind:'end' };
};
POLICY.nextAction = async function(p,ctx){
  const follow=!SIM.active&&!NET.online?await polOrderFollowup(p,ctx):null;
  if(follow)return follow;
  return polOrderChoice(p,ctx,await POLICY.baseNextAction(p,ctx));
};

// 행동 하나를 실제로 실행한다. 엔진 함수만 부르므로 브라우저·러너 양쪽에서 같다.
function polOrderTriggerChoice(p,target,trace,pick){
  let index=0;
  return async(q,title,options,...rest)=>{
    const ordering=options[0]?.triggerOrder;
    if(q!==p||!ordering)return pick(q,title,options,...rest);
    const state=polBuffSequenceState(p),signature=simHash(ordering.items);
    if(trace){
      // The full sequence already binds these ready targets and payments.
      // Re-searching identical readiness triggers here spends that same budget
      // before the actual three-body sequence can finish its native probe.
      const readies=ordering.items.every(x=>x.ctx.p===p&&x.t.ops?.length===1&&
        x.t.ops[0].op==='mistfall'&&(target.uids||[target.uid]).includes(x.ctx.it?.uid));
      const value=readies?options[0].v:await pick(q,title,options,...rest),selected=options.find(o=>o.v===value);
      if(selected?.triggerOrder)trace.push({state,signature,index:selected.triggerOrder.index});
      return value;
    }
    const expected=target.triggerTrace?.[index++],selected=expected?.state===state&&expected.signature===signature&&
      options.find(o=>o.triggerOrder?.index===expected.index);
    return selected?selected.v:pick(q,title,options,...rest);
  };
}
function polOrderReadyConfirm(p,target,trace,confirm){
  let index=0;
  return async(q,title,card,context)=>{
    const choice=context?.botChoice;
    if(q!==p||choice?.kind!=='paidReady'||!(target.uids||[target.uid]).includes(choice.uid)||choice.inner?.op!=='mistfall')
      return confirm(q,title,card,context);
    if(target.skipPaidReady||target.uids?.[target.skipPaidReadyIndex]===choice.uid)return false;
    const state=polBuffSequenceState(p),expected=target.readyTrace?.[index++];
    if(trace){
      const u=everyUnit().find(u=>u.uid===choice.uid);
      const accept=!!u&&u.ctrl===p&&u.ex&&canPay(p,0,choice.pips||[])&&
        !everyUnit().some(x=>x.ctrl!==p&&x.loc!=='base'&&unitFx(x).jailerReady);
      trace.push({state,accept});return accept;
    }
    return expected?.state===state?expected.accept:confirm(q,title,card,context);
  };
}
POLICY.runAction = async function(p, act){
  if(act.orderSequence){
    const plan=act.orderSequence,ok=await POLICY.runAction(p,{...act,orderSequence:null});
    // The preview records a settled combat. Live movement only opens its
    // showdown here; validate the expected state on the next neutral decision.
    if(ok!==false&&plan.steps.length&&(G.state==='showdown'||plan.states[0]===polBuffSequenceState(p)))
      POLICY._orderFollowup={p,tc:G.turnCount,expected:plan.states[0],steps:plan.steps,states:plan.states.slice(1)};
    return ok;
  }
  if(act.buffSequence){
    const plan=act.buffSequence,n=act.kind==='champ'?G.players[p].champN:act.n,old=POLICY._buffPaymentPlan;
    POLICY._buffPaymentPlan=n===plan.consumerN?plan.payment:null;
    let ok;try{ok=await POLICY.runAction(p,{...act,buffSequence:null});}finally{POLICY._buffPaymentPlan=old;}
    if(ok!==false&&plan.follow&&plan.expected===polBuffSequenceState(p))POLICY._buffFollowup={
      p,tc:G.turnCount,act:plan.follow,consumerN:plan.consumerN,payment:plan.payment,expected:plan.expected};
    return ok;
  }

  if(['play','champ'].includes(act.kind)&&act.orderTarget?.uids){
    const target=act.orderTarget,n=act.n??G.players[p].champN,pick=UI.pickUnitFrom,confirm=UI.confirmP,option=UI.pickOption;let index=0;
    if(target.sacrificeUid!==undefined&&(!polOrderSacrifice(n)||
        !everyUnit().some(u=>u.ctrl===p&&u.uid===target.sacrificeUid)))return false;
    if((polOrderEntryBuff(n)||target.deathSources||target.skipPaidReady||Number.isInteger(target.skipPaidReadyIndex))&&
        target.uids.some(uid=>uid!==null&&!everyUnit().some(u=>u.ctrl===p&&u.uid===uid)))return false;
    try{
      UI.pickUnitFrom=async(q,units,title,optional,selection)=>{
        if(q===p&&target.sacrificeUid!==undefined&&
            (polOrderSacrifice(n)==='cost'&&title==='처치할 아군 유닛 (추가 비용)'||
             polOrderSacrifice(n)==='effect'&&selection?.ctx?.kind==='spell'&&
               selection.ctx.resolvingSpell?.n===n&&selection.op?.op==='eachPlayerKills'))
          return units.find(u=>u.uid===target.sacrificeUid)||null;
        const death=target.deathSources?.includes(selection?.ctx?.n);
        if(q!==p||selection?.ctx?.kind!=='effect'||selection.op?.op!=='buff'||
            (target.deathSources?!death||(selection.op.count||1)!==1:
              selection.ctx.n!==n||(selection.op.count||1)!==target.uids.length)||index>=target.uids.length)
          return pick(q,units,title,optional,selection);
        const uid=target.uids[index++];
        if(uid===null&&optional)return null;
        return units.find(u=>u.uid===uid)||pick(q,units,title,optional,selection);
      };
      UI.confirmP=polOrderReadyConfirm(p,target,act.orderReadyProbe,confirm);
      if(target.paidReady)UI.pickOption=polOrderTriggerChoice(p,target,act.orderTriggerProbe,option);
      return await POLICY.runAction(p,{...act,orderTarget:null});
    }finally{UI.pickUnitFrom=pick;UI.confirmP=confirm;UI.pickOption=option;}
  }

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
    case 'runeEnergy': {
      if(act.runeState!==polBuffSequenceState(p)||!polOrderAction(p,act))return false;
      await runeFloat(p,act.idx,'energy');return true;
    }
    case 'play':    return await playCardFromHand(p, act.idx,
      Object.hasOwn(act,'orderPlayLoc')?{playLoc:act.orderPlayLoc}:{});
    case 'champ':   return await playCardFromHand(p, -1, {champZone:true,
      ...(Object.hasOwn(act,'orderPlayLoc')?{playLoc:act.orderPlayLoc}:{})});
    case 'ability': {
      const src={...act.src};
      if(src.u)src.u=everyUnit().find(u=>u.uid===src.u.uid);
      if(src.g)src.g=G.players[p].gear.find(g=>polGearId(g)===polGearId(src.g));
      if(act.src.u&&!src.u||act.src.g&&!src.g)return false;
      if(act.udyrChoice)return polRunUdyr(p,src.u.uid,act.ab,act.udyrChoice);
      if(act.recyclePicks)return polRunTrashRecycle(p,polGearId(src.g),act.ab,act.recyclePicks);
      if(act.mfGankUid!==undefined){
        if(src.kind!=='legend'||G.players[p].legendN!==POL_MF.legend||
            !everyUnit().some(u=>u.ctrl===p&&u.uid===act.mfGankUid))return false;
        const old=POLICY._mfGankTarget;
        POLICY._mfGankTarget={p,tc:G.turnCount,uid:act.mfGankUid};
        try{return await activateAbility(p,src,act.ab);}
        finally{POLICY._mfGankTarget=old;}
      }
      if(polSmart()&&src.kind==='gear'&&act.ab.ops?.some(op=>op.op==='pickRecycleTrashes')){
        const choice=await polTrashRecyclePlan(p,{src,ab:act.ab},
          typeof BOT!=='undefined'&&BOT.seat===p?BOT.ctx:null);
        return choice?POLICY.runAction(p,polTrashRecycleAction(p,{src,ab:act.ab},choice)):false;
      }
      if(act.hookUid!==undefined){
        if(!everyUnit().some(u=>u.uid===act.hookUid&&u.ctrl===p))return false;
        const pick=UI.pickUnitFrom;
        try{
          UI.pickUnitFrom=async(q,units,title,...rest)=>q===p&&title==='처치할 아군 유닛'
            ? units.find(u=>u.uid===act.hookUid)||null : pick(q,units,title,...rest);
          return await activateAbility(p,src,act.ab);
        }finally{UI.pickUnitFrom=pick;}
      }
      if(act.orderTarget){
        const target=act.orderTarget,op=act.ab.ops?.[target.index];
        if(!['damage','dmgEqMyMight','buff','buffSelf'].includes(op?.op)||!everyUnit().some(u=>u.uid===target.uid))return false;
        if(op.op==='buffSelf'&&(src.u?.uid!==target.uid||src.u.ctrl!==p||
            target.paidReady&&src.u.buff&&!unitFx(src.u).multiBuff))return false;
        if((target.skipPaidReady||op.op==='buff'&&target.paidReady)&&
            !unitsBySpec(op.spec,p).some(u=>u.uid===target.uid&&u.ctrl===p))return false;
        const pick=UI.pickUnitFrom,confirm=UI.confirmP,option=UI.pickOption;let canceled=false;
        try{
          UI.pickUnitFrom=async(q,units,title,optional,selection)=>{
            if(q!==p||selection?.ctx?.kind!=='ability'||selection.op!==op)
              return pick(q,units,title,optional,selection);
            const u=units.find(u=>u.uid===target.uid);if(!u)canceled=true;
            return u||null;
          };
          // Reuse only the native winning path's decisions in the same public
          // state. A response changes that state and returns control to policy.
          if(target.paidReady){
            UI.confirmP=polOrderReadyConfirm(p,target,act.orderReadyProbe,confirm);
            UI.pickOption=polOrderTriggerChoice(p,target,act.orderTriggerProbe,option);
          }
          const result=await activateAbility(p,src,act.ab);
          return canceled?false:result;
        }finally{UI.pickUnitFrom=pick;UI.confirmP=confirm;UI.pickOption=option;}
      }
      return await activateAbility(p,src,act.ab);
    }
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
// ── 판단 단계 무결성 가드 (2026-10-02) ──
// 판단(턴 플랜·다음 행동 고르기)은 샌드박스에서만 엔진을 돌리고 실제 G는 바꾸지 않아야 한다. 그런데 봇전에서
// 봇 턴 시작 직후 사람 유닛이 로그 없이 피해 12를 입고 실제 정리 단계에서 죽은 제보가 있었다(리플레이로 확인, 헤드리스 재현은 안 됨 —
// 리플레이는 '_' 내부 필드가 빠져 있다). 판단 전 실제 G를 지문·사본으로 남기고, 판단 뒤 달라졌으면 사본으로 되돌린다.
// 바뀐 경로는 콘솔에 남겨 다음 제보 때 원인을 바로 짚을 수 있게 한다. 시뮬레이션 안(SIM)과 온라인에서는 쓰지 않는다.
POLICY.guardStats = { checks:0, restored:0 };
function polJson(g){ try{ return JSON.stringify(g,(k,v)=>typeof v==='function'?undefined:(v instanceof Map?[...v]:v instanceof Set?[...v]:v)); }catch(e){ return null; } }
function polDiffPaths(a,b,path='',out=[]){
  if(out.length>=12) return out;
  if(JSON.stringify(a)===JSON.stringify(b)) return out;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'){ out.push(path+': '+JSON.stringify(a)?.slice(0,80)+' → '+JSON.stringify(b)?.slice(0,80)); return out; }
  for(const k of new Set([...Object.keys(a),...Object.keys(b)])) polDiffPaths(a[k],b[k],path+'.'+k,out);
  return out;
}
function polRealGuard(label){
  if(typeof SIM==='undefined' || SIM.active || SIM.lock || (typeof NET!=='undefined' && NET.online) || typeof cloneG!=='function' || !G) return null;
  const json=polJson(G); if(json===null) return null;
  const backup=cloneG(G), uid=(typeof UID!=='undefined'?UID:null), rng=(typeof _rngState!=='undefined'?_rngState:null);
  return {
    // 달라졌으면 되돌리고 true
    check(){
      POLICY.guardStats.checks++;
      const now=polJson(G);
      if(now===json) return false;
      let paths=[]; try{ paths=polDiffPaths(JSON.parse(json),JSON.parse(now)); }catch(e){}
      console.warn('[BOT] '+label+' 판단 중 실제 게임 상태가 바뀌어 되돌립니다', paths);
      G=backup; if(uid!==null) UID=uid; if(rng!==null) _rngState=rng;
      POLICY.guardStats.restored++;
      try{ UI.log('⚠ 봇 판단 중 게임 상태가 잘못 바뀐 것을 감지해 되돌렸습니다 (제보해 주시면 원인 분석에 도움이 됩니다)', 'sys'); UI.render(); }catch(e){}
      return true;
    }
  };
}

POLICY.step = async function(p, ctx, onPlay){
  const guard = polRealGuard('턴 행동');
  // 탐색 티어: 턴 시작에 '턴 플랜'(기본/공격 자제/집중 공격)을 롤아웃으로 비교해 하나 고른다.
  // 예전의 행동 단위 탐색은 롤아웃 미래 평가를 현재 정적 평가와 비교하는 결함(조기 턴 종료 남발)과
  // 평가 노이즈에 묻히는 미시 후보 문제로 두 번 실패했다 — 플랜 단위 비교는 기준선(기본 플랜)도
  // 같은 깊이로 롤아웃하므로 공정하고, 후보 간 평가 차이가 커서 노이즈 위에 선다.
  // Kai'Sa's card/target/movement search owns the decision budget. Do not run
  // another macro search first or suppress the moves it has actually verified.
  if(!polKaisaDeck(p) && polTier().think && POLICY.ab.think && !POLICY.race(p).oppLethal) await polPlanTurn(p, ctx);
  let act = await POLICY.nextAction(p, ctx);
  if(guard && guard.check()) return false;   // 되돌렸다 — 고른 행동은 오염된 상태 기준이므로 버리고 다음 틱에 다시 판단
  if(!act || act.kind === 'end') return true;
  const P = G.players[p];
  const hadHand = P.hand.length, hadChamp = P.champInZone;
  const abilityBefore=act.kind==='ability'?polBuffSequenceState(p):null;
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
  if(act.kind === 'ability'){
    const cost=act.ab?.cost||{},finite=cost.exhaustSelf||cost.spendBuff||cost.recycleTrash||cost.discard||cost.energy||cost.power||cost.pips?.length||cost.killFriendlyOrGear||cost.killSelfGear;
    ctx.tried.add('a'+act.key);
    ctx.abilityRetry ||= new Set();
    if(finite&&ok!==false&&abilityBefore!==polBuffSequenceState(p))ctx.abilityRetry.add(act.key);
    else ctx.abilityRetry.delete(act.key);
  }
  if(act.orderSequence)ctx.plannedTc=-1;
  if(act.kind === 'hidden')  ctx.tried.add(act.hiddenKey || 'v' + act.bfIdx + ':' + act.n);
  return false;
};

// 턴이 바뀌면 재시도 차단·이동 횟수를 초기화한다
POLICY.newCtx = function(){ return { tried:new Set(), abilityRetry:new Set(), movesLeft:0, tc:-1 }; };
POLICY.syncCtx = function(ctx){
  if(ctx.tc === G.turnCount) return ctx;
  ctx.tc = G.turnCount; ctx.tried.clear();ctx.abilityRetry?.clear();
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
    if(polAbilityTried(p,c,ctx)) continue;
    if(!polAbLegal(p, c)) continue;
    if(polMfAuroraDeck(p) && polMfAuroraOnline(p) && c.src.kind==='gear'
      && c.src.g.n===181 && !polMfBundleTreasure(p,c)) continue;
    const cost = c.ab.cost || {};
    const costPips=[...(cost.pips||[])];
    for(let i=0;i<(cost.power||0);i++) costPips.push('Any');
    if(polMfCostBlocked(p,{energy:cost.energy||0,pips:costPips,channel:polMfTreasure(p,c)?1:0})) continue;
    if(polPaidChoiceDepth&&(POL_AB_HARDCOST.some(k=>cost[k])||cost.recycleTrash||polAbOps(c).includes('killThisGear')))continue;
    if(polAbOps(c).some(o => POL_AB_BADOPS.has(o)) && !polMfTreasure(p,c)) continue;
    if(polAbIsResource(c)) continue;
    const uid = c.src.kind === 'unit' ? c.src.u.uid : null;
    const gid = c.src.kind === 'gear' ? polGearId(c.src.g) : null;
    out.push({ kind:'ability', key:c.key, label:c.name + ' ' + c.ab.label,
      run: async()=>{
        let src = { kind:c.src.kind };
        if(uid !== null){ const u = everyUnit().find(x => x.uid === uid); if(!u) return; src.u = u; }
        else if(gid !== null){ const g = G.players[p].gear.find(x => polGearId(x)===gid); if(!g) return; src.g = g; }
        if(polSmart()&&src.kind==='gear'&&polAbOps(c).includes('pickRecycleTrashes')){
          const choice=await polTrashRecyclePlan(p,{...c,src},ctx);
          return choice?POLICY.runAction(p,polTrashRecycleAction(p,{...c,src},choice)):false;
        }
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
    // A stunned target gains no combat Might from Assault, but playing the
    // spell can still ready Darius for a legal bloodless conquest.
    units=units.filter(u=>u.ctrl===p);
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

// Kai'Sa's candidates for acceleration and deployment stay deck-specific.
// Generic Time Warp also uses the engine turn horizon and public deck samples.
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
async function polKaisaPublicMove(p){
  const fallback=POLICY.movePlan(p);
  const ready=everyUnit().filter(u=>u.ctrl===p&&!u.ex&&(u.loc==='base'||effKw(u).ganking));
  // The static combat estimate does not execute on-attack abilities. It must
  // not exclude a visible Leona attack before the real-engine counterplay probe.
  if(!ready.some(u=>unitFx(u).triggers?.onAttack?.length))return fallback;
  const candidates=fallback?[fallback]:[];
  G.bfs.forEach((b,dest)=>{
    if(!b.units.some(u=>u.ctrl!==p))return;
    for(const units of polMfAttackGroups(ready.filter(u=>u.loc!==dest)))
      if(units.some(u=>unitFx(u).triggers?.onAttack?.length))candidates.push({units,dest});
  });
  const baseline=evalState(G,p),seen=new Set();let best=null;
  for(const a of candidates){
    if(SIM.deadline&&Date.now()>SIM.deadline)break;
    const ids=a.units.map(u=>u.uid),key=a.dest+':'+[...ids].sort((a,b)=>a-b).join(',');
    if(seen.has(key))continue;seen.add(key);
    const value=await simTry(p,async()=>{
      UI.pickReaction=async()=>null;
      await moveUnits(p,everyUnit().filter(u=>ids.includes(u.uid)),a.dest);
    },POLICY,!!SIM.lock,false);
    if(value!==null&&value>baseline+BOT_W.moveNeed&&(!best||value>best.value))best={...a,value};
  }
  return best||fallback;
}
async function polKaisaTurnOpponentMoves(p){
  const o=opp(p);
  // Only the publicly visible army can move. No opponent hand cards are played.
  for(let i=0;i<2&&G.winner===null&&G.turn===o&&G.phase==='action'&&G.state==='neutral';i++){
    const move=await polKaisaPublicMove(o);if(!move)break;
    const before=simHash(G);
    await moveUnits(o,move.units,move.dest);await simSettle(p,POLICY);
    if(simHash(G)===before)break;
  }
}
async function polKaisaTurnActions(p,ctx){
  const local={...ctx,tried:new Set(ctx.tried||[]),abilityRetry:new Set(ctx.abilityRetry||[]),tc:G.turnCount};
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
      const u=everyUnit().find(u=>u.uid===act.kaisaReturnAfter&&u.ctrl===p&&!u.ex);
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
    result={value:G.winner!==null||options.generic?raw:raw+polKaisaTurnFieldValue(p)+sequenceBonus,won:G.winner===p,
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
    // First verify the next action window, independently of sampled future
    // draws. A long-horizon timeout must not spend away a proven survival turn.
    let survival=null;
    if(evalHoldForecast(opp(p)).win&&nextTurnPlayer(G.turn)!==p){
      const quick=await polKaisaTurnProbe(p,ctx,act,{quick:true,knownHandOnly:true});
      if(quick&&!quick.lost&&quick.turn===p)survival={...act,kaisaSurvival:true};
    }
    if(evalHoldForecast(p).win&&nextTurnPlayer(G.turn)!==p){
      const quick=await polKaisaTurnProbe(p,ctx,act,{quick:true});
      if(quick?.won){polSay('kaisa-warp','시간 왜곡','추가 턴 유지로 즉시 승리');return {...act,kaisaWin:true};}
    }
    const samples=new Set(P.deck).size>1?2:1;
    const deltas=[];let allWon=true,allSafe=true;
    for(let sample=0;sample<samples;sample++){
      if(Date.now()>SIM.deadline)return survival;
      const base=await polKaisaTurnProbe(p,ctx,null,{sample,extra:true,playOutCurrent:true});
      const future=await polKaisaTurnProbe(p,ctx,act,{sample,extra:true,playOutCurrent:true});
      if(!base||!future)return survival;
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
    return survival;
  }finally{polKaisaTurnDepth--;SIM.deadline=deadline;}
}
// The same engine horizon can evaluate Time Warp outside the Kai'Sa deck.
// Generic card scores cannot price an extra turn or its mandatory draw.
async function polGenericWarpChoice(p,ctx){
  if(!polHard()||polKaisaDeck(p)||NET.online||SIM.active||SIM.lock||polKaisaTurnDepth||
      G.turn!==p||G.phase!=='action'||G.state!=='neutral'||G.winner!==null)return null;
  const P=G.players[p],idx=P.hand.indexOf(122);
  if(idx<0||ctx.tried?.has('h122')||!polCanPlay(p,card(122))||
      playRestriction(card(122),p,false)||!polOffensivePlayable(p,122))return null;
  const deadline=SIM.deadline;
  SIM.deadline=Math.min(deadline||Infinity,Date.now()+Math.min(POLICY.budget||1400,1400));
  polKaisaTurnDepth++;
  try{
    const act={kind:'play',idx,n:122};
    const baseQuick=await polKaisaTurnProbe(p,ctx,null,{quick:true,knownHandOnly:true,generic:true});
    if(!baseQuick||baseQuick.won)return baseQuick?.won?{kind:'end'}:null;
    const nextQuick=await polKaisaTurnProbe(p,ctx,act,{quick:true,knownHandOnly:true,generic:true});
    if(!nextQuick||nextQuick.lost)return null;
    if(nextQuick.won){polSay('extra-turn','시간 왜곡','실제 추가 개시와 유지로 승리');return act;}
    // Buying a real action window is preferable to an otherwise immediate loss.
    // Keep that proof if a longer, sampled continuation exhausts the budget.
    const survival=baseQuick.lost&&nextQuick.turn===p?act:null;
    const samples=new Set(P.deck).size>1?2:1,deltas=[];
    let allWon=true,allSafe=true;
    for(let sample=0;sample<samples;sample++){
      if(Date.now()>SIM.deadline)return survival;
      const base=await polKaisaTurnProbe(p,ctx,null,{sample,extra:true,playOutCurrent:true,generic:true});
      const next=await polKaisaTurnProbe(p,ctx,act,{sample,extra:true,playOutCurrent:true,generic:true});
      if(!base||!next)return survival;
      if(base.won)return null;
      allWon=allWon&&next.won;allSafe=allSafe&&!next.lost;
      deltas.push(next.won?20:next.value-base.value);
    }
    const gain=deltas.reduce((s,n)=>s+n,0)/deltas.length;
    if(allWon||allSafe&&Math.min(...deltas)>BOT_W.moveNeed&&gain>0.55){
      const proof=allWon?await polKaisaTurnProbe(p,ctx,act,{extra:true,playOutCurrent:true,knownHandOnly:true,generic:true}):null;
      polSay('extra-turn','시간 왜곡',proof?.won?'알고 있는 카드와 추가 턴으로 승리':'같은 상대 행동 시작 시점에서 추가 턴 이득 비교',
        {gain,samples,drawDependent:allWon&&!proof?.won});
      return act;
    }
    return survival;
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
    if(canPay(p,e,pips,false)||polResourceFundingPlan(p,e,pips,false)!==null)
      add({...a,kaisaAccel:true,kaisaPlayLoc:'base'});
  }
  if((ctx.movesLeft??3)<=0)return select();
  const ready=everyUnit().filter(u=>u.ctrl===p&&!u.ex);
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
  // A ready arrival with an On Play effect can change this turn's actual
  // attack. Compare it before redundant plain/accelerated body variants use
  // the shared deadline; retain every other candidate and the paid baseline.
  candidates.sort((a,b)=>Number(b.kaisaAccel===true&&polDeploymentEffect(b.n))-
    Number(a.kaisaAccel===true&&polDeploymentEffect(a.n)));
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
