// ══════════ 봇 시뮬레이션 샌드박스 (SIM) ══════════
// 봇이 후보 수를 "실제로 두어 보고" 결과를 평가할 수 있게 해 준다.
// 규칙을 다시 구현하지 않고 엔진 자체를 신탁으로 쓰는 것이 핵심 — 카드 298장과 자동으로 호환된다.
//
// 안전 원칙 (여기가 깨지면 실제 게임이 오염된다):
//  1) 온라인 대전 중에는 절대 진입하지 않는다 (락스텝 결정론이 한 바이트라도 어긋나면 desync)
//  2) G와 엔진 전역 8개를 저장했다가 반드시 복원한다 (finally)
//  3) UI는 함수를 감싸는 게 아니라 슬롯 자체를 교체한다 — replay.js가 UI.log/render에 래퍼를
//     얹어 두었으므로, 슬롯을 덮어야 시뮬레이션 중 리플레이 프레임이 기록되지 않는다
//  4) 선택 프롬프트 스텁은 반드시 즉시 resolve한다 (미해결 Promise 하나로 엔진이 영구 정지한다)
//  5) 예산(픽 횟수·시간)을 넘으면 그 시뮬레이션만 폐기한다 — 엔진에 롤백이 없으므로 항상 클론을 버린다

const SIM = {
  active: false,
  lock: false,
  picks: 0, maxPicks: 500,
  deadline: 0,
  stats: { runs: 0, aborted: 0, errors: 0 },
};

// FX/CARDS는 불변 참조이므로 복제하지 않고 공유한다 (복제하면 느리고, 함수가 섞이면 깨진다)
let SIM_FXSET = null;
function simFxSet(){
  if(!SIM_FXSET) SIM_FXSET = new Set(Object.values(typeof FX!=='undefined' ? FX : {}));
  return SIM_FXSET;
}

// 아이덴티티 보존 딥클론.
// JSON/structuredClone을 쓰면 안 된다:
//  · replay.js의 rpSerialize는 '_' 로 시작하는 내부 필드(_dead·_decree·_armory)를 버리고,
//    체인 항목이 참조하는 보드 유닛을 중복 제거로 날려 버린다.
//  · structuredClone은 FX에 함수가 하나라도 섞이는 순간 DataCloneError로 죽는다.
function cloneG(g){
  const seen = new Map();
  const fx = simFxSet();
  function cl(v){
    if(v === null || typeof v !== 'object') return v;
    if(typeof v === 'function') return v;
    if(fx.has(v)) return v;                 // 카드 효과 정의는 공유
    if(seen.has(v)) return seen.get(v);     // 같은 객체는 같은 사본으로 (유닛 참조 유지)
    if(Array.isArray(v)){
      const a = []; seen.set(v, a);
      for(const x of v) a.push(cl(x));
      return a;
    }
    const o = {}; seen.set(v, o);
    for(const k of Object.keys(v)) o[k] = cl(v[k]);
    return o;
  }
  return cl(g);
}

// 시뮬레이션 중 엔진이 부르는 UI — 전부 즉시 응답한다.
function simUI(policy){
  const noop = ()=>{};
  return {
    log:noop, render:noop, toast:noop, prompt:noop, promptShowdown:noop,
    manualNotice:noop, showVictory:noop, inspect:noop, inspectUnit:noop,
    hideZoom:noop, showZoom:noop, logEntryEl:()=>null,
    isPicking:()=>false,
    fx:{ unit:noop, cast:noop, chainAdd:noop, score:noop, turnEnd:noop, priority:noop, check:noop, setOn:noop, on:false },
    confirmP:     (p,t,c)     => simAnswer(()=>policy.confirm(p,t,c)),
    pickUnitFrom: (p,c,t,o)   => simAnswer(()=>policy.unit(p,c,t,o)),
    pickOption:   (p,t,o)     => simAnswer(()=>policy.option(p,t,o)),
    pickReaction: (p,t,o)     => simAnswer(()=>policy.reaction(p,t,o)),
    // 무한루프 방지: dealSplit은 0을 받으면 while(remain>0)에서 빠져나오지 못한다
    pickNumber:   (p,t,mn,mx) => simAnswer(()=>{
      const lo=Math.min(mn,mx), hi=Math.max(mn,mx);
      const v = policy.number(p,t,mn,mx);
      return Math.max(lo, Math.min(hi, (typeof v==='number'&&!isNaN(v)) ? v : hi));
    }),
    pickHandCard: (p,t)       => simAnswer(()=>policy.hand(p,t)),
    pickMulligan: (p)         => simAnswer(()=>policy.mulligan(p)),
  };
}
class SimBudget extends Error {}
function simAnswer(fn){
  if(++SIM.picks > SIM.maxPicks) throw new SimBudget('pick budget');
  if(SIM.deadline && Date.now() > SIM.deadline) throw new SimBudget('deadline');
  let v = null;
  try { v = fn(); } catch(e){ v = null; }
  return Promise.resolve(v);
}

// ── 진입/이탈 ──
// 엔진 전역을 통째로 갈아 끼웠다가 되돌린다. 반드시 짝을 맞춰 호출한다(항상 finally).
function simEnter(policy){
  if(NET.online) throw new Error('SIM: 온라인 대전 중에는 시뮬레이션할 수 없습니다');
  if(SIM.lock)   throw new Error('SIM: 재진입 금지');
  SIM.lock = true; SIM.active = true;
  const saved = {
    G, UID: (typeof UID!=='undefined'?UID:1),
    rng: (typeof _rngState!=='undefined'?_rngState:1),
    ctxBf: (typeof _ctxBf!=='undefined'?_ctxBf:null),
    ctxUnit: (typeof _ctxUnit!=='undefined'?_ctxUnit:null),
    curKind: (typeof _curKind!=='undefined'?_curKind:'effect'),
    UI: UI,
    hash: null,
  };
  if(SIM.debug) saved.hash = simHash(G);
  UI = simUI(policy);                       // 슬롯 자체를 교체 (래퍼를 얹지 않는다)
  G = cloneG(saved.G);
  SIM.picks = 0;
  return saved;
}
function simExit(saved){
  UI = saved.UI;
  G = saved.G;
  if(typeof UID!=='undefined') UID = saved.UID;
  if(typeof _rngState!=='undefined') _rngState = saved.rng;
  if(typeof _ctxBf!=='undefined') _ctxBf = saved.ctxBf;
  if(typeof _ctxUnit!=='undefined') _ctxUnit = saved.ctxUnit;
  if(typeof _curKind!=='undefined') _curKind = saved.curKind;
  SIM.lock = false; SIM.active = false;
  if(SIM.debug && saved.hash !== null){
    const now = simHash(G);
    if(now !== saved.hash) throw new Error('SIM: 실제 게임 상태가 오염되었습니다 (해시 불일치)');
  }
}
function simHash(g){
  try {
    let h = 0; const s = JSON.stringify(g, (k,v)=> (typeof v==='function'?undefined:v));
    for(let i=0;i<s.length;i++){ h = (Math.imul(31,h) + s.charCodeAt(i))|0; }
    return h;
  } catch(e){ return 0; }
}

// ── 후보 수를 하나 두어 보고 결과를 평가한다 ──
// act: async () => void  (클론된 G 위에서 실행됨)
// 반환: 평가 점수 (실패·예산초과면 null)
async function simTry(p, act, policy){
  const pol = policy || POLICY;
  let saved;
  try { saved = simEnter(pol); }
  catch(e){ return null; }
  try {
    SIM.stats.runs++;
    await act();
    await simSettle();          // 결전을 끝까지 진행한 뒤 평가 (안 하면 공격이 공짜로 보인다)
    return evalState(G, p);
  } catch(e){
    if(e instanceof SimBudget) SIM.stats.aborted++; else SIM.stats.errors++;
    return null;
  } finally {
    simExit(saved);
  }
}

// 이동으로 결전이 열렸다면 전투까지 실제로 해결시킨다.
// 이걸 하지 않으면 "유닛을 전장에 보냈다"는 상태만 보고 평가하게 되어,
// 전멸당하는 공격도 이득으로 계산된다.
async function simSettle(){
  for(let guard=0; guard<40; guard++){
    if(!G || G.winner!==null) return;
    if(G.state !== 'showdown') return;
    const before = G.showdown;
    await showdownPass();
    if(G.showdown === before && G.state === 'showdown' && G.showdown.passes === 0) return; // 진전 없음
  }
}

// 샌드박스 안에서 한 좌석의 턴을 휴리스틱으로 끝까지 진행한다 (탐색 재귀 방지: think=0 고정)
async function simPlayOutTurn(q){
  const savedThink = POLICY.think;
  POLICY.think = 0;
  try {
    const tried = new Set();
    for(let guard=0; guard<40; guard++){
      if(!G || G.winner!==null) return;
      if(G.state === 'showdown'){ await simSettle(); continue; }
      if(G.turn !== q || G.phase !== 'action') return;
      const idx = POLICY.pickPlay(q, tried);
      if(idx >= 0){
        const P = G.players[q], n = P.hand[idx], before = P.hand.length;
        await playCardFromHand(q, idx);
        if(G.players[q].hand.length === before) tried.add('h'+n);
        continue;
      }
      const mv = POLICY.movePlan(q);
      if(mv){ await moveUnits(q, mv.units, mv.dest); continue; }
      break;
    }
    if(G && G.winner===null && G.turn===q) await endTurn();
  } finally { POLICY.think = savedThink; }
}

// ── 탐색: 후보를 두어 보고 가장 좋은 것을 고른다 ──
// candidates: [{ label, run: async()=>void }]
// plies>=2 이면 내 턴을 마무리하고 상대 턴까지 진행한 뒤 평가한다.
// "이 공격이 다음 턴에 응징당하는가"를 보게 되어 무모한 수가 걸러진다.
async function simBest(p, candidates, budgetMs, plies){
  if(!candidates.length) return null;
  SIM.deadline = budgetMs ? Date.now() + budgetMs : 0;
  const deep = (plies||1) >= 2;
  let best = null;
  for(const c of candidates){
    if(SIM.deadline && Date.now() > SIM.deadline) break;
    const run = deep
      ? async()=>{ await c.run(); await simSettle();
                   if(G.winner===null) await simPlayOutTurn(p);
                   if(G.winner===null && G.turn===opp(p)) await simPlayOutTurn(opp(p)); }
      : c.run;
    const v = await simTry(p, run, POLICY);
    if(v === null) continue;
    if(!best || v > best.v) best = { ...c, v };
  }
  SIM.deadline = 0;
  return best;
}
