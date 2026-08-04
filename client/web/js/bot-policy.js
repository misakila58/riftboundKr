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
        place:1, champ:1, defend:1 },
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
  expert:  { smart:1, move:1, think:0, reserve:0, peek:0, moves:1, rep:1 },
  master:  { smart:1, move:1, think:0, reserve:0, peek:0, moves:3, rep:2 },
  oracle:  { smart:1, move:1, think:0, reserve:0, peek:1, moves:3, rep:2 },
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
  // 버프 소모 개수 — 필요한 만큼만
  if(/버프/.test(txt)){
    const owned = everyUnit().filter(u=>u.ctrl===p).reduce((s,u)=>s+u.buff,0);
    return clamp(Math.min(owned, lo));
  }
  // 피해 분배는 치사량 단위로 (기본은 최대)
  polSay('number', hi, '기본 최대', {txt:txt.slice(0,24)});
  return clamp(hi);
};

// ══════════ 옵션 선택 ══════════
// 무작위였다. 배치 위치가 특히 치명적 — 유닛 1기를 적 전장에 떨구면 즉시 결전으로 죽는다.
POLICY.option = function(p, title, options){
  if(!options || !options.length) return null;
  const txt = String(title||'');
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
    return s;
  };
  let best = 0;
  h.forEach((n,i)=>{ if(score(n) > score(h[best])) best = i; });
  polSay('hand', card(h[best]).ko, '영역 불일치·중복 우선 폐기');
  return best;
};

// ══════════ 응수(반응) ══════════
POLICY.reaction = function(p, title, options){
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
  return null;   // 일반 [반응]은 결전용으로 아낀다
};

// ══════════ 멀리건 ══════════
POLICY.mulligan = function(p){
  const h = G.players[p].hand;
  if(!POLICY.ab.mulligan){ const cost=i=>(card(h[i]).e||0); const idxs=h.map((n,i)=>i);
    const cheap=idxs.filter(i=>cost(i)<=2&&['Unit','Gear'].includes(card(h[i]).type));
    const bw=[...idxs].sort((a,b)=>cost(b)-cost(a));
    return cheap.length?bw.filter(i=>cost(i)>=5).slice(0,2):bw.slice(0,2); }
  if(!polSmart()) return h.map((n,i)=>i).filter(i=>(card(h[i]).e||0)>=5).slice(0,2);
  const myDoms = new Set(G.players[p].runes.map(r=>runeDomain(r.n)));
  const cost = i => (card(h[i]).e||0);
  const offDom = i => { const c=card(h[i]); return c.dom&&c.dom.length&&!c.dom.some(d=>myDoms.has(d)||d==='Colorless'); };
  const idxs = h.map((n,i)=>i);
  // 1턴에 낼 수 있는 저비용 플레이를 확보하고, 영역 불일치·고비용부터 교체
  const cheap = idxs.filter(i=>cost(i)<=2 && ['Unit','Gear'].includes(card(h[i]).type));
  const worst = [...idxs].sort((a,b)=>(offDom(b)?10:0)+cost(b) - ((offDom(a)?10:0)+cost(a)));
  const swap = cheap.length ? worst.filter(i=>offDom(i)||cost(i)>=5).slice(0,2) : worst.slice(0,2);
  polSay('mulligan', swap.length+'장 교체', '영역 불일치·고비용 우선');
  return swap;
};

// ══════════ 전투 피해 배분 순서 ══════════
// assignDamage는 고른 유닛에 정확히 치사량만 준다 → 치사량이 작은 것부터 골라야 처치 수가 최대가 된다.
// (공격 4 vs 방어 [3,2,2]: 최강자부터면 1처치, 치사량 오름차순이면 2처치)
POLICY.assignTarget = function(p, candidates, remain, role){
  if(!candidates.length) return null;
  if(!polSmart()) return candidates[0];
  const lethal = u => Math.max(1, might(u, role) - u.dmg);
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

// ══════════ 플레이할 카드 고르기 ══════════
POLICY.pickPlay = function(p, blocked){
  const P = G.players[p];
  const budget = readyRunes(p).length - POLICY.reserve(p);
  const cands = [];
  P.hand.forEach((n,i)=>{
    if(blocked && blocked.has('h'+n)) return;
    const c = card(n);
    if(POLICY.ab.canpay ? !polCanPlay(p, c) : polCost(c) > readyRunes(p).length) return;
    if(POLICY.ab.reserve && polCost(c) > Math.max(0, budget)) return;  // 상대 턴 응수분은 남긴다
    const fx = FX[n]||{kw:{}};
    let score;
    if(c.type==='Unit') score = 100 + (c.m||0)*2 - polCost(c)*BOT_W.playCost;
    else if(c.type==='Gear') score = 50 - polCost(c);
    else if(polHard() && (fx.kw.action||fx.kw.reaction)) score = -1;   // 결전용으로 아낌
    else score = 30 - polCost(c);
    cands.push({ i, n, score });
  });
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
POLICY.playPlan = function(p, ctx){
  const P = G.players[p];
  const idx = POLICY.pickPlay(p, ctx.tried);
  const handAct = idx >= 0 ? { kind:'play', idx, n:P.hand[idx] } : null;
  const champOk = P.champInZone && !ctx.tried.has('champ') && polCanPlay(p, card(P.champN));
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
  const movable = G.players[p].base.filter(u=>!u.ex && !u.stunned);
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
  const byStrong = [...movable].sort((a,b)=>might(b)-might(a));
  for(let i=0;i<G.bfs.length;i++){
    const bf = G.bfs[i];
    const def = bf.units.filter(u=>u.ctrl===o);
    if(!def.length){
      // 무혈 점거 — 최소 병력만 보낸다 (기지를 비우면 반격에 취약)
      if(bf.controller !== p){
        const send = weakestFirst.slice(0,1);
        let v = BOT_W.control * Math.min(evalTau(p),3)/2;
        if(!bf.scored[p]) v += BOT_W.point;          // 정복 1점
        v -= send.reduce((s,u)=>s+might(u),0) * (BOT_W.unitBase - BOT_W.unitBf);
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
            v: t0 * 0.6 });                           // 막아낸 위협의 60% (상대가 실제로 칠지는 모른다)
          break;
        }
      }
      continue;
    }
    // 부분 출격: 강한 순 프리픽스 집합을 전부 후보로
    const send = [];
    for(const u of byStrong){
      send.push(u);
      const v = evalAttackValue(p, i, [...send]);
      cands.push({ units:[...send], dest:i, v, why:'공격 '+send.length+'기' });
    }
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
  } else if(G.turn !== p || G.phase !== 'action') return false;
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
POLICY.abilityPlan = function(p, ctx, onlyUnits){
  if(!POLICY.ab.ability || polTier().rep < 1) return null;
  for(const c of polAbList(p)){
    if((c.src.kind === 'unit') !== !!onlyUnits) continue;
    if(ctx && ctx.tried.has('a' + c.key)) continue;
    if(!polAbLegal(p, c)) continue;
    const cost = c.ab.cost || {};
    if(POL_AB_HARDCOST.some(k => cost[k])) continue;
    if(polAbOps(c).some(o => POL_AB_BADOPS.has(o))) continue;
    if(polAbIsResource(c)) continue;
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
      const trick = !!(fx.kw.action || fx.kw.reaction);
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

// 결전에서 취할 행동 하나. 손패 트릭 → 자금 조달(자원 능력) → 숨겨둔 트릭 순.
POLICY.showdownAction = function(p){
  const sd = G.showdown;
  if(!sd || !polHard()) return null;
  if(!POLICY.ab.showdown){ if(POLICY._sdSeen === sd) return null; POLICY._sdSeen = sd; }
  const us = unitsAt(sd.bfIdx);
  const role = u => u.ctrl === sd.attacker ? 'attacker' : 'defender';
  const myM = us.filter(u => u.ctrl === p).reduce((s,u) => s + might(u, role(u)), 0);
  const opM = us.filter(u => u.ctrl !== p).reduce((s,u) => s + might(u, role(u)), 0);
  if(opM <= 0 || !us.some(u => u.ctrl === p)) return null;   // 무혈 결전엔 아낀다
  if(myM > opM + BOT_W.sdMargin) return null;                // 크게 이기고 있으면 아낀다
  const P = G.players[p];
  // 이 결전에서 낼 수 있는 트릭인가 (자금 문제는 따로 본다)
  const usable = n => {
    const fx = FX[n] || {kw:{}};
    if(!(fx.kw.action || fx.kw.reaction)) return false;
    if(sd.chain.length && !fx.kw.reaction) return false;     // 체인 진행 중엔 [반응]만
    // 카운터는 체인에 상대 주문이 있을 때만 (없으면 효과 없이 폐기된다)
    if((fx.counter || fx.steal) && !sd.chain.some(it => it.p !== p && it.kind !== 'ability')) return false;
    return true;
  };
  const idx = P.hand.findIndex(n => usable(n) && polCanPlay(p, card(n)));
  if(idx >= 0){
    polSay('showdown', card(P.hand[idx]).ko, '결전 트릭', {myM, opM});
    return { kind:'play', idx, n:P.hand[idx] };
  }
  // ── 자금 조달 ──
  // 인장 7종과 카이사·다리우스 전설은 결전 중 [추가] 자원 능력이다(즉시 해결·우선권 유지).
  // 낼 수 없는 트릭이 손에 있을 때 이걸 켜면 "돈이 모자라 못 쓰던 카드"가 살아난다.
  const want = P.hand.filter(n => usable(n));
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
POLICY.nextAction = function(p, ctx){
  let a = POLICY.hiddenPlan(p, ctx, false);
  if(a) return a;
  a = POLICY.playPlan(p, ctx);
  if(a) return a;
  a = POLICY.abilityPlan(p, ctx, false);
  if(a) return a;
  if(ctx.movesLeft > 0){
    const mv = POLICY.movePlan(p);
    if(mv) return { kind:'move', units:mv.units, dest:mv.dest };
    ctx.movesLeft = 0;
  }
  a = POLICY.abilityPlan(p, ctx, true);
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
  // 탐색 티어는 후보를 실제로 두어 보고 고른다. 실패하면 휴리스틱으로 떨어진다.
  let act = polTier().think ? await POLICY.searchAction(p, ctx) : null;
  if(!act) act = POLICY.nextAction(p, ctx);
  if(!act || act.kind === 'end') return true;
  const P = G.players[p];
  const hadHand = P.hand.length, hadChamp = P.champInZone;
  if(onPlay && (act.kind === 'play' || act.kind === 'hidden')) onPlay(act.n);
  // 탐색이 고른 후보는 자기 run()을 들고 있다 (클론에서 검증된 실행 경로)
  const ok = act.run ? await act.run() : await POLICY.runAction(p, act);
  if(act.kind === 'play'  && ok === false && G.players[p].hand.length === hadHand) ctx.tried.add('h' + act.n);
  if(act.kind === 'champ' && ok === false && hadChamp && G.players[p].champInZone) ctx.tried.add('champ');
  if(act.kind === 'hide'  && G.players[p].hand.length === hadHand) ctx.tried.add('x' + act.n);
  if(act.kind === 'move')    ctx.movesLeft--;
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
    out.push({ kind:'play', n, label:'플레이 '+card(n).ko,
      run: async()=>{ const j = G.players[p].hand.indexOf(n); if(j>=0) await playCardFromHand(p, j); } });
  });
  // 챔피언
  if(P.champInZone && !(blocked && blocked.has('champ')) && polCanPlay(p, card(P.champN))){
    out.push({ kind:'champ', label:'챔피언 '+card(P.champN).ko,
      run: async()=>{ await playCardFromHand(p, -1, {champZone:true}); } });
  }
  // 활성화 능력 — 휴리스틱은 목록 순서대로 첫 번째를 쓴다. 어느 것을 먼저 쓸지는
  //              탐색이 판단할 수 있는 대표적인 선택지다.
  for(const c of polAbList(p)){
    if(blocked && blocked.has('a'+c.key)) continue;
    if(!polAbLegal(p, c)) continue;
    const cost = c.ab.cost || {};
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

// 탐색으로 다음 한 수를 고른다. 반환: 후보 객체 (없으면 null)
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
