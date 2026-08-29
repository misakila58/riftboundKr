// ══════════ 리프트바운드 게임 엔진 ══════════
// 1v1 · 승점 8 · 전장 2개 · 효과 자동 처리

let G = null;
let UID = 1;

const VICTORY = 8;

// ---------- 유틸 ----------
// 시드 PRNG (mulberry32) — 온라인 락스텝 결정론을 위해 모든 게임 내 무작위는 rng() 사용
let _rngState = 1;
function seedRng(s){ _rngState = (s>>>0)||1; }
function rng(){
  _rngState = (_rngState + 0x6D2B79F5)|0;
  let t = Math.imul(_rngState ^ (_rngState>>>15), 1|_rngState);
  t = (t + Math.imul(t ^ (t>>>7), 61|t)) ^ t;
  return ((t ^ (t>>>14))>>>0)/4294967296;
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function card(n){ return CARD_BY_N[n]; }
function opp(p){ return 1-p; }
function pname(p){ return G.players[p].name; }

// ---------- 게임 생성 ----------
function newGame(cfg){
  UID = 1;
  seedRng(cfg.seed || (Date.now()&0xffffffff));
  G = {
    players: cfg.players.map((pc,i)=>{
      // 공식 룰: 주 덱 40장에는 선발 챔피언 1장이 포함되며, 시작 시 챔피언 구역으로 이동 → 덱 39장 시작
      const deck=shuffle([...pc.deck]);
      const ci=deck.indexOf(pc.champN);
      if(ci>=0) deck.splice(ci,1);
      return {
      idx:i, name:pc.name, legendN:pc.legendN, legendEx:false,
      champN:pc.champN, champInZone:true,
      deck, hand:[], trash:[], banish:[],
      runeDeck:shuffle([...pc.runes]), runes:[],
      base:[], gear:[],
      points:0, energy:0, energySpell:0, power:{Fury:0,Calm:0,Mind:0,Body:0,Order:0,Chaos:0,Any:0},
      playedCards:0, scoredBf:{}, drewFromEmpty:false,
      };
    }),
    bfs: cfg.bfs.map((n,i)=>({ n, owner:i, controller:null, contestedBy:null, units:[], hiddenCards:[], scored:{} })),
    turn:0, turnCount:0, phase:'setup', state:'neutral',
    showdown:null, winner:null, actingPlayer:0,
  };
  // 전장 상시: 승리 점수 +1
  G.victory = VICTORY + G.bfs.filter(bf=>bf.n===BF_STATIC.VICTORY_PLUS).length;
  // 규칙 처리 모드: manual(수동, 기본) — 카드 효과·전투·득점을 자동 처리하지 않음
  G.manual = (cfg.manual===undefined) ? true : !!cfg.manual;
  // 시작 손패 4장
  G.players.forEach(p=>{ for(let i=0;i<4;i++) drawCard(p.idx, true); });
}

// ---------- 유닛 인기절스 ----------
function makeUnit(n, ctrl, opts={}){
  const c = card(n);
  return {
    uid:UID++, n, ctrl,
    owner: opts.owner!==undefined?opts.owner:ctrl,   // 카드 소유자 (통제권 이동·상대 카드 플레이 시 ctrl과 달라짐)
    loc:opts.loc??('base'), // 'base' | 0 | 1 (전장 인덱스)
    ex:opts.ready?false:true,
    dmg:0, buff:0, tempM:[], grants:{}, stunned:false,
    gear:[], isToken:opts.isToken||false,
    tokenMight:opts.tokenMight, tokenName:opts.tokenName,
    turnPlayed:G.turnCount,
  };
}
function unitCard(u){ return u.isToken ? {n:0,name:u.tokenName,ko:u.tokenName,type:'Unit',m:u.tokenMight,dom:[],tags:[],text:'',tko:'',img:''} : card(u.n); }
function unitName(u){ return u.isToken ? (u.tokenName==='Recruit'?'신병 토큰':u.tokenName+' 토큰') : card(u.n).ko; }
function unitFx(u){ return u.isToken ? {kw:{},triggers:{},activated:[],manual:[]} : (FX[u.n]||{kw:{},triggers:{},activated:[],manual:[]}); }

// ---------- 턴 플래그 (매 턴 초기화) ----------
function freshTF(){ return {
  discarded:[false,false], nextSpellDisc:[0,0], nextSpellBonus:[0,0], nextUnitReady:[false,false],
  noPlay:[false,false], buffPlus:[0,0], preventSpellDmg:false, enterReady:[false,false],
  readyRunesAtEnd:[0,0],
  enemyDied:[false,false], freeHide:[false,false], dmgKill:false, bf292:[false,false],
  udyrUsed:{}, _once:{},
}; }
function TF(){ return (G && (G.tflags || (G.tflags=freshTF()))) || freshTF(); }

// ---------- 상시(정적) 효과 레이어 ----------
// 보드의 유닛/도구/전장이 제공하는 statics를 순회한다.
function collectStatics(){
  const out=[];
  for(const u of everyUnit()){
    const fx=unitFx(u);
    if(fx.statics) for(const s of fx.statics) out.push({s, unit:u, p:u.ctrl});
  }
  for(const pi of [0,1]) for(const g of G.players[pi].gear){
    const gf=FX[g.n];
    if(gf&&gf.statics) for(const s of gf.statics) out.push({s, p:pi, gear:g});
  }
  G.bfs.forEach((bf,i)=>{
    const bfx=FX[bf.n];
    if(bfx&&bfx.statics) for(const s of bfx.statics) out.push({s, p:bf.controller, bfIdx:i});
  });
  for(const pi of [0,1]){                       // 전설의 상시효과 (OGS 스타터 전설 등)
    const lfx=FX[G.players[pi].legendN];
    if(lfx&&lfx.statics) for(const s of lfx.statics) out.push({s, p:pi, legend:true});
  }
  return out;
}
function staticMatch(u, src, f){
  f=f||{};
  if(f.other && src.unit===u) return false;
  if(f.side==='friendly' && u.ctrl!==src.p) return false;
  if(f.side==='enemy' && u.ctrl===src.p) return false;
  if(f.srcAtBf && src.unit && src.unit.loc==='base') return false;
  if(f.where==='here'){
    if(src.unit){ if(src.unit.loc==='base' || u.loc!==src.unit.loc) return false; }
    else if(src.bfIdx!==undefined){ if(u.loc!==src.bfIdx) return false; }
  }
  if(f.buffed && !(u.buff>0)) return false;
  if(f.stunned && !u.stunned) return false;
  return true;
}
function aloneAt(u){
  if(u.loc==='base') return G.players[u.ctrl].base.filter(x=>x.ctrl===u.ctrl).length===1;
  return G.bfs[u.loc].units.filter(x=>x.ctrl===u.ctrl).length===1;
}

// 유효 위력 (전투 상황 반영)
function might(u, combatRole, opts){
  // 기절: 전투 피해 기여만 0 — 처치 기준(forKill)에는 원래 위력을 사용한다 (공식 룰)
  if(u.stunned && combatRole && !(opts && opts.forKill)) return 0;
  const c = unitCard(u);
  // 버프당 +1, 단결된 의지(53) 활성 시 이번 턴 버프당 추가 +1 (지속 효과 — 버프 소모 시 함께 사라짐)
  let m = (u.isToken? u.tokenMight : (c.m||0)) + u.buff*(1+(TF().buffPlus[u.ctrl]||0));
  u.tempM.forEach(t=>{ m += t.v; });
  u.gear.forEach(gn=>{ const gfx=FX[gn]; if(gfx&&gfx.gearMight) m+=gfx.gearMight; });
  const kw = effKw(u);
  if(combatRole==='attacker' && kw.assault) m += kw.assault;
  if(combatRole==='defender' && kw.shield) m += kw.shield;
  // 전장 상시: 이곳 유닛 +1⚔
  if(u.loc!=='base' && G.bfs[u.loc] && G.bfs[u.loc].n===BF_STATIC.MIGHT_PLUS) m += 1;
  let min = 0;
  u.tempM.forEach(t=>{ if(t.min!==undefined) min=Math.max(min,t.min); });
  // 상시 효과 (오라/자기 강화)
  if(!_inStatic){
    _inStatic=true;
    try{
      for(const src of collectStatics()){
        const s=src.s;
        if(s.kind==='mightAura' && staticMatch(u,src,s.filter)){ m+=s.n; if(s.min!==undefined) min=Math.max(min,s.min); }
        else if(s.kind==='selfMight' && src.unit===u) m+=s.fn(u)||0;
        else if(s.kind==='selfMightRole' && src.unit===u) m+=s.fn(u,combatRole)||0;
        else if(s.kind==='auraMightRole' && src.p===u.ctrl) m+=s.fn(u,combatRole)||0;
      }
    } finally { _inStatic=false; }
  }
  return Math.max(m, min);
}
let _inStatic=false;
// 부여 키워드 포함 유효 키워드
function effKw(u){
  const base = {...unitFx(u).kw};
  Object.entries(u.grants).forEach(([k,v])=>{
    if(typeof v==='number' && typeof base[k]==='number') base[k]+=v;
    else base[k]=v;
  });
  // 전장 상시: 이곳 유닛 [개입]
  if(u.loc!=='base' && G.bfs[u.loc] && G.bfs[u.loc].n===BF_STATIC.GANKING) base.ganking=true;
  if(!_inKw){
    _inKw=true;
    try{
      for(const src of collectStatics()){
        const s=src.s;
        if(s.kind==='kwAura' && staticMatch(u,src,s.filter)) s.kws.forEach(k=>{ base[k]=base[k]||true; });
        else if(s.kind==='selfKw' && src.unit===u && (!s.cond||s.cond(u))) s.kws.forEach(k=>{ base[k]=base[k]||true; });
        else if(s.kind==='selfKwFn' && src.unit===u){ const ks=s.fn(u); if(ks) ks.forEach(k=>{ base[k]=base[k]||true; }); }
      }
    } finally { _inKw=false; }
  }
  return base;
}
let _inKw=false;
function isMighty(u){ return might(u)>=5; }

// ---------- 위치 헬퍼 ----------
function unitsAt(bfIdx){ return G.bfs[bfIdx].units; }
function allUnits(p){ // p 소유 모든 보드 유닛
  const r=[...G.players[p].base];
  G.bfs.forEach(bf=>bf.units.forEach(u=>{ if(u.ctrl===p) r.push(u); }));
  return r;
}
function everyUnit(){ return [...G.players[0].base, ...G.players[1].base, ...G.bfs[0].units, ...G.bfs[1].units]; }
function removeUnit(u){
  if(u.loc==='base'){ const b=G.players[u.ctrl].base; const i=b.indexOf(u); if(i>=0)b.splice(i,1); }
  else { const arr=G.bfs[u.loc].units; const i=arr.indexOf(u); if(i>=0)arr.splice(i,1); }
}
// 경합(Contested) 적용자 추적 — 공식 규칙: "그 전장을 통제하지 않는 플레이어의 유닛이
// 이동/존재하게 될 때" 경합이 적용되며, 그 적용자가 결전의 공격자(Focus)가 된다.
// (강제 이동 효과로 '상대 유닛'이 끌려온 경우, 공격자는 시전자가 아니라 그 유닛의 통제자)
function markContested(u, loc){
  if(loc==='base') return;
  const bf=G.bfs[loc]; if(!bf) return;
  if(bf.contestedBy==null && bf.controller!==u.ctrl) bf.contestedBy=u.ctrl;
}
function placeUnit(u, loc){
  u.loc=loc;
  if(loc==='base') G.players[u.ctrl].base.push(u);
  else { G.bfs[loc].units.push(u); markContested(u, loc); }
}

// ---------- 드로우/폐기 ----------
function drawCard(p, silent){
  const P=G.players[p];
  if(P.deck.length===0){ burnOut(p); }
  const n=P.deck.shift();
  if(n!==undefined){ P.hand.push(n); if(!silent) UI.log(`${pname(p)} 카드 1장 드로우`, 'p'+p); }
  checkWin();
}
function burnOut(p){
  const P=G.players[p];
  UI.log(`⚠️ ${pname(p)} 번아웃! 폐기장를 덱으로 되돌리고 상대가 1점을 얻습니다.`, 'sys');
  P.deck = shuffle([...P.trash]); P.trash=[];
  addPoints(opp(p), 1, 'effect');
}
function trashCard(p, n){ G.players[p].trash.push(n); }
async function discardFromHand(p, idx){
  const P=G.players[p];
  const n=P.hand.splice(idx,1)[0];
  if(n===undefined) return;
  P.trash.push(n);
  G._lastDiscard={p,n};
  TF().discarded[p]=true;
  UI.log(`${pname(p)} 「${card(n).ko}」 버림`, 'p'+p);
  const fx=FX[n];
  if(fx && fx.onDiscardSelf) await execOps(fx.onDiscardSelf, {p, kind:'effect'});
  await fireEvent('onYouDiscard', {p, n});
}

// ---------- 득점 ----------
function addPoints(p, n, method, bfIdx){
  const P=G.players[p];
  const V=G.victory;
  if(method==='conquer'||method==='hold'){
    // 최종 점수 제한 (공식 RUP4: 정복에만 적용 — 점거/효과 점수는 무제한)
    // "승리 점수까지 1점 남았거나 그보다 더 근접한" 정복 시도: 이번 턴 모든 전장 득점 시에만 획득, 아니면 대신 1장 뽑기
    if(P.points>=V-1){
      if(method==='hold'){ P.points=Math.min(V,P.points+n); }
      else {
        const scoredAll = G.bfs.every((bf,i)=>P.scoredBf[i]);
        if(scoredAll){ P.points=Math.min(V,P.points+n); }
        else {
          UI.log(`${pname(p)} 최종 점수 조건 미달(이번 턴 모든 전장 미득점) → 대신 카드 1장 뽑기`, 'score');
          drawCard(p);
          return;
        }
      }
    } else P.points = Math.min(V, P.points+n);
  } else {
    P.points = Math.min(V, P.points+n);
  }
  UI.fx.score(p, n);
  UI.log(`🏆 ${pname(p)} ${method==='conquer'?'정복':method==='hold'?'유지':'효과'} 득점! (${P.points}점)`, 'score');
  checkWin();
}
function checkWin(){
  G.players.forEach(P=>{ if(P.points>=G.victory && G.winner===null){ G.winner=P.idx; UI.showVictory(P.idx); } });
}
// 항복 — 남은 쪽이 즉시 승리 (온라인은 액션으로 양측에 동일하게 적용된다)
function surrender(p){
  if(!G || G.winner!==null) return;
  const w=opp(p);
  G.winner=w;
  UI.log(`🏳 ${pname(p)} 항복 — ${pname(w)} 승리!`, 'score');
  UI.render();
  UI.showVictory(w);
}

// ---------- 자원(룬) ----------
function readyRunes(p){ return G.players[p].runes.filter(r=>!r.ex); }
// "룬 최대 N개 준비" — 어떤 룬을 준비할지는 도메인이 달라 선택 가치가 있으므로 직접 고르게 한다.
// optional 이면 중간에 그만둘 수 있다. routedPick 경유라 온라인 락스텝에서도 안전하다.
async function readyRunesPick(p, n, optional){
  let cnt=0;
  for(let i=0;i<n;i++){
    const opts=G.players[p].runes.map((r,idx)=>({r,idx})).filter(x=>x.r.ex);
    if(!opts.length) break;
    if(opts.length===1 && !optional){ opts[0].r.ex=false; cnt++; continue; }
    const choices=opts.map(x=>({v:x, label:`${card(x.r.n).ko} (탈진)`, n:x.r.n}));
    if(optional) choices.push({v:'skip', label:'더 준비하지 않음'});
    const sel=await UI.pickOption(p, `준비할 룬 (${i+1}/${n})`, choices);
    if(sel===null || sel==='skip') break;
    sel.r.ex=false; cnt++;
  }
  return cnt;
}
function channelRunes(p, n, exhausted){
  const P=G.players[p];
  for(let i=0;i<n;i++){
    const rn=P.runeDeck.shift();
    if(rn===undefined) break;
    P.runes.push({n:rn, ex:!!exhausted});
  }
  UI.log(`${pname(p)} 룬 ${n}개 전개${exhausted?' (탈진 상태)':''}`, 'p'+p);
}
function runeDomain(n){ const c=card(n); return c.dom[0]||'Colorless'; }

// 지불 가능성 검사: energy + powerPips(도메인 배열, 'Any' 포함)
// 공식 룰: 룬 하나로 에너지 1(탈진) + 힘 1(재활용)을 모두 낼 수 있다.
// "재활용: 힘 추가" 스킬은 탈진 여부와 무관하므로, 에너지로 탈진시킨 룬을 그대로 재활용해 힘을 지불할 수 있음.
// → 에너지와 힘은 독립 조건: 에너지 ≤ 풀+준비 룬 수, 힘 핍마다 영역 일치 룬(상태 무관) 1개.
function canPay(p, energy, pips){
  const P=G.players[p];
  const poolP = {...P.power};
  const used = new Set();
  // 힘 핍: 풀 → 영역 일치 룬 (준비/탈진 무관, 핍당 서로 다른 룬)
  for(const pip of pips){
    if(pip==='Any'){
      const anyDom = Object.keys(poolP).find(d=>poolP[d]>0);
      if(anyDom){ poolP[anyDom]--; continue; }
      const ri = P.runes.findIndex((r,i)=>!used.has(i));
      if(ri<0) return false;
      used.add(ri);
    } else {
      if(poolP[pip]>0){ poolP[pip]--; continue; }
      if(poolP.Any>0){ poolP.Any--; continue; }
      const ri = P.runes.findIndex((r,i)=>!used.has(i) && runeDomain(r.n)===pip);
      if(ri<0) return false;
      used.add(ri);
    }
  }
  // 에너지: 재활용 예정 룬도 먼저 탈진시켜 에너지를 낼 수 있으므로 준비 룬 전체가 후보
  const ready = P.runes.filter(r=>!r.ex).length;
  // spellOK: 주문 전용 에너지(럭스 314) 포함
  return P.energy + (arguments[3]?(P.energySpell||0):0) + ready >= energy;
}

// 실제 지불 (canPay 선행 가정)
// 순서 중요: ① 에너지(준비 룬 탈진) → ② 힘(탈진 룬 우선 재활용 — 방금 에너지에 쓴 룬 포함)
function payCost(p, energy, pips, silent){
  const P=G.players[p];
  // 힘 핍 중 풀로 못 내서 룬을 재활용해야 하는 영역을 미리 뽑는다.
  const peek={...P.power};
  const runeDoms=[];
  for(const pip of pips){
    if(pip!=='Any' && peek[pip]>0){ peek[pip]--; continue; }
    if(pip==='Any'){ const d=Object.keys(peek).find(d=>peek[d]>0); if(d){ peek[d]--; continue; } }
    else if(peek.Any>0){ peek.Any--; continue; }
    runeDoms.push(pip);
  }
  // ① 에너지: 풀 → 준비 룬 탈진.
  //    이때 곧 힘으로 재활용될 영역의 룬을 먼저 탈진시킨다. 같은 룬이 에너지와 힘을 모두 내주므로
  //    엉뚱한 룬이 탈진된 채 남는 낭비를 막는다. (앞에서부터 무조건 쓰던 동작을 개선)
  let need = energy;
  // 주문 전용 에너지(럭스 314)를 먼저 소진 (좁은 자원 우선) — arguments[4]=spellOK
  if(arguments[4] && need>0 && (P.energySpell||0)>0){ const s=Math.min(P.energySpell,need); P.energySpell-=s; need-=s; }
  const useE = Math.min(P.energy, need); P.energy-=useE; need-=useE;
  if(need>0){
    const ready = P.runes.filter(r=>!r.ex);
    const order = [];
    for(const dom of runeDoms){
      const r = ready.find(r=>!order.includes(r) && (dom==='Any' || runeDomain(r.n)===dom));
      if(r) order.push(r);
    }
    for(const r of ready) if(!order.includes(r)) order.push(r);   // 남는 건 기존 순서대로
    for(const r of order){ if(need<=0) break; r.ex=true; need--; }
  }
  // ② 힘 핍: 풀 → 탈진 룬 재활용(룬 덱 반환) → 준비 룬 재활용
  const recycled=[];
  for(const pip of pips){
    if(pip!=='Any' && P.power[pip]>0){ P.power[pip]--; continue; }
    if(pip==='Any'){
      const d=Object.keys(P.power).find(d=>P.power[d]>0);
      if(d){ P.power[d]--; continue; }
    } else if(P.power.Any>0){ P.power.Any--; continue; }
    // 룬 재활용
    let match = r=> pip==='Any' ? true : runeDomain(r.n)===pip;
    let ri = P.runes.findIndex(r=>r.ex && match(r));
    if(ri<0) ri = P.runes.findIndex(match);
    if(ri>=0){
      const r=P.runes.splice(ri,1)[0];
      P.runeDeck.push(r.n); recycled.push(card(r.n).ko);
    }
  }
  if(!silent && (energy||pips.length))
    UI.log(`${pname(p)} 비용 지불: 에너지 ${energy}${pips.length?' + 힘 '+pips.length:''}${recycled.length?' (룬 재활용: '+recycled.join(', ')+')':''}`, 'p'+p);
}

// ---------- 룬 플로팅 (수동 자원 띄우기, 룰 745 [Add]) ----------
// 준비 룬 탈진 → 에너지 +1 / 룬 재활용(룬 덱 반환) → 그 영역 힘 +1.
// 자동 지불(payCost)과 별개로, 플레이어가 미리 풀에 자원을 올려 둘 수 있게 한다
async function runeFloat(p, idx, mode){
  const P=G.players[p]; const r=P.runes[idx]; if(!r) return;
  if(mode==='energy'){
    if(r.ex){ UI.toast('탈진된 룬입니다','warn'); return; }
    r.ex=true; P.energy+=1;
    UI.log(`${pname(p)} 룬 탈진 → 에너지 +1 (풀)`, 'p'+p);
  } else {
    const dom=runeDomain(r.n)||'Any';
    P.runes.splice(idx,1); P.runeDeck.push(r.n);
    P.power[dom]=(P.power[dom]||0)+1;
    UI.log(`${pname(p)} 룬 재활용 → ${DOMAIN_KO[dom]||dom} 힘 +1 (풀)`, 'p'+p);
  }
  UI.render();
}

// 카드의 힘 핍 목록
function powerPips(c){
  const n = c.p||0;
  if(n<=0) return [];
  const doms = (c.dom&&c.dom.length)?c.dom:['Any'];
  const pips=[];
  for(let i=0;i<n;i++) pips.push(doms[i%doms.length]);
  return pips;
}

// ---------- 멀리건 (공식 룰: 종합 규칙 110-118) ----------
// 턴 순서대로: 손패에서 최대 2장을 따로 빼두고 → 그 수만큼 드로우 → 빼둔 카드를 덱 맨 아래로 재활용.
async function mulliganPhase(){
  // 온라인: 양쪽이 동시에 고른다 (상대가 끝날 때까지 기다리지 않게).
  // 적용은 결과가 도착한 순서와 무관하게 항상 0번 → 1번 순으로 해서 양쪽 상태를 같게 유지한다.
  if(NET.online){
    const picks = await Promise.all([0,1].map(p=>
      G.players[p].hand.length ? UI.pickMulligan(p) : Promise.resolve(null)));
    for(const p of [0,1]) applyMulligan(p, picks[p]);
    UI.render();
    return;
  }
  // 핫시트/봇: 한 화면을 번갈아 쓰므로 순서대로
  for(const p of [0,1]){
    if(!G.players[p].hand.length) continue;
    applyMulligan(p, await UI.pickMulligan(p));
    UI.render();
  }
}
function applyMulligan(p, idxs){
  const P=G.players[p];
  if(!P.hand.length) return;
  if(idxs && idxs.length){
    const back=[];
    [...idxs].slice(0,2).sort((a,b)=>b-a).forEach(i=>{ const n=P.hand.splice(i,1)[0]; if(n!==undefined) back.push(n); });
    for(let i=0;i<back.length;i++) drawCard(p, true);  // 먼저 뽑고
    P.deck.push(...shuffle(back));                     // 빼둔 카드는 무작위 순서로 덱 맨 아래로 (공식: 동시 재활용은 무작위)
    UI.log(`${pname(p)} 멀리건: ${back.length}장 교체 (덱 아래로 재활용)`, 'sys');
  } else {
    UI.log(`${pname(p)} 멀리건 없이 시작`, 'sys');
  }
}

// ---------- 턴 진행 ----------
async function startTurn(){
  const p = G.turn, P = G.players[p];
  G.turnCount++;
  // '이번 턴에 플레이한 카드 수'는 턴이 바뀌면 양쪽 모두 0으로 돌아간다.
  // 예전엔 턴 주인만 초기화해서, 상대 턴(결전 등)에 낸 카드가 내 지난 턴 수치에 이어 세어졌다.
  // → 「다리우스 - 삼두정」의 '한 턴에 두 번째 카드' 조건이나 [군단] 판정이 어긋났다.
  G.players.forEach(pl=>{ pl.playedCards=0; });
  P.scoredBf={};
  G.bfs.forEach(bf=>bf.scored={});
  G.tflags=freshTF();
  everyUnit().forEach(u=>{ u.turnMoves=0; u._armory=false; u._highlander=false; u._guillotine=false; });
  G.phase='awaken'; UI.render();
  UI.log(`━━ ${pname(p)}의 턴 ${Math.ceil(G.turnCount/2)} ━━`, 'sys');

  // A: 각성 — 룬/유닛/도구/전설 모두 준비 (공식: Ready all your Runes, Units, and Gear)
  P.legendEx=false; P.legendUsed=false;
  P.runes.forEach(r=>r.ex=false);
  allUnits(p).forEach(u=>{ u.ex=false; });
  P.gear.forEach(g=>{ g.ex=false; });
  UI.render();

  // B: 개시 단계 — 공식 순서: ① 개시 절차(시작 시 효과: [일시적] 처치·개시 트리거) → ② 득점 절차(유지)
  // 수동 모드에서는 규칙 자동 처리를 하지 않음(득점·트리거·[일시적] 모두 플레이어가 직접 처리)
  G.phase='beginning'; UI.render();
  if(!G.manual){
    // ① 개시 절차 — 개시 단계 시작 시 효과
    for(const u of everyUnit().filter(u=>u.ctrl===p && effKw(u).temporary)){
      UI.log(`[일시적] ${unitName(u)} 처치됨`, 'sys');
      await killUnit(u);
    }
    if(G.turnCount<=2){
      for(let i=0;i<G.bfs.length;i++)
        await fireBfTrigger(i,'onFirstBeginning',{p, bfIdx:i});
    }
    await fireTriggers('onBeginning', {p});
    if(G.winner!==null) return;
    // ② 득점 절차 — 유닛이 주둔해 통제 중인 전장만 유지 득점 (개시 효과로 비었으면 먼저 해제)
    releaseEmptyBattlefields();
    for(let i=0;i<G.bfs.length;i++){
      const bf=G.bfs[i];
      if(bf.controller===p && G.winner===null){
        P.scoredBf[i]=true; bf.scored[p]=true;
        addPoints(p,1,'hold',i);
        // '내가 유지하면'은 그 전장에 주둔한 유닛만 — 전역 브로드캐스트를 쓰면
        // 기지의 아리(66)가 남의 유지 전장마다 득점하는 오류가 난다
        for(const hu of [...bf.units].filter(x=>x.ctrl===p))
          await runTriggerList(unitFx(hu).triggers?.onHold, {p, unit:hu, it:hu, bfIdx:i});
        await fireBfTrigger(i,'onHoldHere',{p,bfIdx:i});
      }
    }
    if(G.winner!==null) return;
  } else if(G.bfs.some(bf=>bf.controller===p)){
    UI.log('※ 수동 모드: 유지 득점·시작 효과는 직접 처리하세요 (유닛 우클릭/점수 버튼)', 'sys');
  }

  // C: 전개
  G.phase='channel'; UI.render();
  const chN = (G.turnCount===2)?3:2;
  channelRunes(p, chN);

  // D: 드로우
  G.phase='draw'; UI.render();
  drawCard(p);

  // 룬 풀 비우기 (공식: 드로우 단계가 끝나면 모든 플레이어의 풀이 비워진다)
  G.players.forEach(pl=>{ pl.energy=0; Object.keys(pl.power).forEach(k=>pl.power[k]=0); });

  G.phase='action'; G.state='neutral';
  G.actingPlayer=p; // 이전 턴 결전 해결 시점의 행동 권한이 남지 않도록 턴 주인으로 초기화
  UI.render();
  UI.prompt(`${pname(p)}의 행동 단계 — 카드 플레이 / 이동 / 능력 발동 / 턴 종료`);
}

async function endTurn(){
  const p=G.turn, P=G.players[p];
  // 턴 종료 트리거 (소나, 눈부신 오로라 등)
  await fireEvent('onEndTurn', {p});
  // 종료 단계: 기절 해제, 지속 효과 만료, 표시 피해 제거, 풀 비우기
  // (공식: 유닛의 표시 피해는 전투 종료 시와 매 턴 종료 시 제거된다)
  everyUnit().forEach(u=>{
    u.stunned=false;
    u.dmg=0;
    u.tempM=u.tempM.filter(t=>t.dur!=='turn');
    // [일시적](temporary)은 '이번 턴' 효과가 아니라 다음 개시 단계 처치까지 남는 표식 — 지우면 안 된다
    Object.keys(u.grants).forEach(k=>{ if(k!=='temporary') delete u.grants[k]; });
  });
  // 타곤의 정상(289): 이 턴 종료 시 룬 준비
  for(const pi of [0,1]){
    const nR=TF().readyRunesAtEnd[pi]||0;
    if(nR){
      const got = await readyRunesPick(pi, nR, true);
      if(got) UI.log(`${pname(pi)} 「타곤의 정상」: 룬 ${got}개 준비`, 'p'+pi);
    }
  }
  P.energy=0; P.energySpell=0; Object.keys(P.power).forEach(k=>P.power[k]=0);
  const O=G.players[opp(p)];
  O.energy=0; O.energySpell=0; Object.keys(O.power).forEach(k=>O.power[k]=0);
  UI.fx.turnEnd(p);
  UI.log(`${pname(p)} 턴 종료`, 'sys');
  // 추가 턴 (시간 왜곡)
  if(G.extraTurnFor===p){ G.extraTurnFor=null; UI.log(`⏳ ${pname(p)} 추가 턴!`, 'score'); }
  else G.turn=opp(p);
  await startTurn();
}

// ---------- 공용 헬퍼: 피해/버프/준비/이동/도구 폐기 ----------
// 피해 적용 (치환·방지·칙령 처리). kind: 'spell'|'ability'|'effect'|'combat'
function dealDamage(u, n, kind){
  if(n<=0) return 0;
  kind=kind||'effect';
  if(unitFx(u).noDmgIfMoved2 && (u.turnMoves||0)>=2){ UI.log(`${unitName(u)} 피해 무시 (이번 턴 2회 이동)`, 'sys'); return 0; }
  if(TF().preventSpellDmg && kind!=='combat'){ UI.log(`피해 방지됨 (효과)`, 'sys'); return 0; }
  if(kind==='spell' && G._casting!==undefined && G._casting!==null) n += TF().nextSpellBonus[G._casting]||0;
  u.dmg+=n;
  UI.fx.unit(u, 'hit', '-'+n);
  if(TF().dmgKill) u._decree=true; // 황제의 칙령
  if(u._guillotine && n>0){ u._guillotine=false; u._decree=true; UI.log(`「녹서스의 단두대」: ${unitName(u)} 처치 표식 발동`, 'combat'); }
  return n;
}
async function buffUnit(u, byP){
  // 공식 룰: 유닛당 버프는 1개까지(705.1) — 단, 카드 텍스트가 예외면 그쪽이 우선
  // (리 신 - 수행자 #78 "나는 버프를 몇 개든 가질 수 있다" → FX.multiBuff)
  if(u.buff>=1 && !unitFx(u).multiBuff){
    UI.log(`${unitName(u)}은(는) 이미 버프가 있어 추가 버프가 놓이지 않음`, 'p'+byP);
    return false;
  }
  u.buff++;
  // 단결된 의지(53)의 '버프당 추가 +1'은 지속 효과라 might() 계산에서 반영한다
  // (여기서 tempM 스냅샷을 찍으면 기존 버프·주문 자신의 버프가 누락된다)
  UI.fx.unit(u, 'buff', '+1⚔');
  UI.log(`${unitName(u)} 버프 (+1⚔)`, 'p'+byP);
  await fireEvent('onYouBuff', {p:byP, it:u});
  return true;
}
async function readyUnit(u, byP){
  // 마법사냥꾼 간수(70): 전장에 있는 동안 주문·능력은 '간수 기준 적' 유닛을 준비시킬 수 없다
  // (byP가 있으면 주문/능력에 의한 준비 — 상대 진영에 간수가 있으면 차단. 기존엔 방향이 반대였다)
  if(byP!==undefined && everyUnit().some(x=>x.ctrl!==u.ctrl && x.loc!=='base' && unitFx(x).jailerReady)){
    UI.log(`「마법사냥꾼 간수」: 준비시킬 수 없습니다`, 'sys'); return;
  }
  if(!u.ex) return;
  u.ex=false;
  UI.fx.unit(u, 'ready');
  UI.log(`${unitName(u)} 준비됨`, 'p'+(byP??u.ctrl));
  if(byP!==undefined && u.ctrl===byP) await fireEvent('onYouReadyUnit', {p:byP, it:u});
}
// 효과에 의한 이동 (스펠/능력) — 이동 트리거 포함
async function effectMove(p, u, dest){
  if(u.loc===dest) return;
  removeUnit(u); placeUnit(u, dest);
  u.turnMoves=(u.turnMoves||0)+1;
  UI.log(`${unitName(u)} 이동됨`, 'p'+p);
  await runTriggerList(unitFx(u).triggers?.onMoveSelf, {p:u.ctrl, unit:u, it:u, bfIdx:(dest!=='base'?dest:null), dest});
  if(dest!=='base') await fireEvent('onMoveToBf', {p:u.ctrl, bfIdx:dest});
}
async function killGear(p, gearIdx){
  const P=G.players[p];
  const g=P.gear[gearIdx]; if(!g) return;
  P.gear.splice(gearIdx,1);
  UI.log(`도구 「${card(g.n).ko}」 폐기됨`, 'p'+p);
  const gf=FX[g.n];
  if(gf&&gf.triggers&&gf.triggers.onGearLeave) for(const t of gf.triggers.onGearLeave) await execOps(t.ops, {p, gear:g});
  trashCard(p, g.n);
  UI.render();
}

// ---------- 카드 플레이 ----------
function playRestriction(c, p, fromHidden){
  // 유닛/도구: 자기 턴 중립 상태에서만 (행동/반응 키워드 예외)
  // fromHidden: 뒷면(숨김) 카드는 뒷면인 동안 [반응]을 얻는다 (공식 739.1)
  //   → 종류와 무관하게 결전·체인 중에도 플레이할 수 있다.
  const fx=FX[c.n]||{kw:{}};
  if(TF().noPlay[p]) return '이번 턴에는 카드를 플레이할 수 없습니다 (효과)';
  if(G.state==='showdown'){
    if(!(fx.kw.action||fx.kw.reaction||fromHidden)) return '결전 중에는 [행동]/[반응] 카드만 플레이할 수 있습니다';
    // 체인 진행 중(Closed 상태)에는 [반응]만 응수 가능 (규칙 338.1.a.2)
    if(G.showdown && G.showdown.chain.length && !(fx.kw.reaction||fromHidden))
      return '체인 진행 중에는 [반응] 카드만 낼 수 있습니다';
    return null;
  }
  // 중립 응수 창: 창이 열린 플레이어는 자기 턴이 아니어도 [반응] 주문을 낼 수 있다 (닫힌 상태 응수 — 규칙 309.2)
  if(G._rwFor===p && ((fx.kw.reaction && c.type==='Spell') || fromHidden)) return null;
  if(G.turn!==p) return '자신의 턴에만 플레이할 수 있습니다';
  if(G.phase!=='action') return '행동 단계에만 플레이할 수 있습니다';
  return null;
}

async function playCardFromHand(p, handIdx, opts={}){
  const P=G.players[p];
  const n = opts.champZone ? P.champN : P.hand[handIdx];
  const c = card(n);
  const fx = FX[n]||{kw:{},triggers:{},activated:[],manual:[],playOps:[]};
  const sdAtStart = G.showdown;   // 이 카드로 결전이 새로 열린 경우와 구분하기 위해 시작 시점을 기억

  const restr = playRestriction(c, p, !!opts.fromHidden);
  if(restr){ UI.toast(restr,'warn'); return false; }

  // ── 수동 모드: 규칙 자동 처리 없이 카드만 배치, 효과는 로그로 안내 ──
  if(G.manual){
    let loc='base';
    if(c.type==='Unit'){
      // 공식 룰: 유닛은 기지 또는 자신이 통제 중인 전장에만 배치할 수 있다.
      // 수동 모드에서는 자동화되지 않은 배치 허용 효과(빈/적 전장 플레이 등)를 직접 처리할 수 있도록
      // 미통제 전장도 '효과 예외'로 남겨 두되, 경고 표기와 로그로 구분한다.
      const locs=[{v:'base',label:'기지'}];
      G.bfs.forEach((bf,i)=>{ if(bf.controller===p) locs.push({v:i,label:`전장: ${card(bf.n).ko}`}); });
      G.bfs.forEach((bf,i)=>{ if(bf.controller!==p) locs.push({v:i,label:`⚠ ${card(bf.n).ko} — 미통제 (배치 허용 효과가 있을 때만)`}); });
      loc = await UI.pickOption(p,'유닛을 배치할 위치 — 기본 규칙: 기지 또는 통제 중인 전장', locs);
      if(loc===null) return false;
      if(loc!=='base' && G.bfs[loc].controller!==p)
        UI.log(`⚠ ${pname(p)} 미통제 전장에 배치 (수동) — 카드 효과가 허용하는 경우인지 확인하세요`, 'sys');
    }
    if(opts.champZone) P.champInZone=false;
    else if(handIdx>=0) P.hand.splice(handIdx,1);
    P.playedCards++;
    UI.log(`${pname(p)} 「${c.ko}」 플레이 (수동)`, 'p'+p);
    if(c.type==='Unit'){ placeUnit(makeUnit(n,p,{loc,ready:false}), loc); }
    else if(c.type==='Gear'){ P.gear.push({n,ex:false,attachedTo:null}); }
    else { trashCard(p,n); } // 주문 등
    const txt=(c.tko||c.text||'').trim();
    if(txt) UI.log(`↳ 효과(직접 처리): ${txt}`, 'sys');
    UI.render();
    if(sdAtStart && G.showdown===sdAtStart) showdownActed(p);   // 수동 모드도 동일 (우선권 유지)
    return true;
  }

  // ── 추가 비용 (선택/강제) ──
  const AC = fx.addCost;
  let addPaid=false, addCount=0, addSel=null;
  if(AC && !opts.fromHidden){
    if(AC.kind==='discard'){
      if(P.hand.length>1 || opts.champZone)
        addPaid = await UI.confirmP(p, `추가 비용: ${AC.label||'카드 1장 버리기'} — 지불할까요?`);
    } else if(AC.kind==='pip'){
      if(canPay(p, 0, [AC.dom]))
        addPaid = await UI.confirmP(p, `추가 비용: ${AC.label||AC.dom+' 힘 1'} — 지불할까요?`);
    } else if(AC.kind==='exhaustUnit'){
      const cands=everyUnit().filter(u=>u.ctrl===p&&!u.ex);
      if(cands.length && await UI.confirmP(p, `추가 비용: ${AC.label||'아군 유닛 탈진'} — 지불할까요?`)){
        addSel=await UI.pickUnitFrom(p,cands,'탈진할 아군 유닛'); addPaid=!!addSel;
      }
    } else if(AC.kind==='spendBuff'){
      const cands=everyUnit().filter(u=>u.ctrl===p&&u.buff>0);
      if(cands.length && await UI.confirmP(p, `추가 비용: ${AC.label||'버프 1개 소모'} — 지불할까요?`)){
        addSel=cands.length===1?cands[0]:await UI.pickUnitFrom(p,cands,'버프를 소모할 유닛'); addPaid=!!addSel;
      }
    } else if(AC.kind==='spendBuffs'){
      const total=everyUnit().filter(u=>u.ctrl===p).reduce((s,u)=>s+u.buff,0);
      if(total>0){ addCount=(await UI.pickNumber(p, AC.label||'소모할 버프 수', 0, total))||0; }
      addPaid=addCount>0;
    } else if(AC.kind==='killUnit'){
      const cands=everyUnit().filter(u=>u.ctrl===p);
      if(!cands.length){ UI.toast('추가 비용(아군 유닛 처치)을 지불할 수 없습니다','warn'); return false; }
      addSel=await UI.pickUnitFrom(p,cands,'처치할 아군 유닛 (추가 비용)');
      if(!addSel) return false;
      addPaid=true;
    } else if(AC.kind==='killUnits'){
      const picks=[];
      while(true){
        const cands=everyUnit().filter(u=>u.ctrl===p&&!picks.includes(u));
        if(!cands.length) break;
        const u=await UI.pickUnitFrom(p,cands,AC.label||'처치할 아군 유닛 (선택)',true);
        if(!u) break; picks.push(u);
      }
      addSel=picks; addCount=picks.length; addPaid=addCount>0;
    }
    if(AC.optional===false && !addPaid) return false;
  }

  // ── 비용 산정 ──
  let energy = c.e||0, pips = powerPips(c);
  if(opts.fromHidden){ energy=0; pips=[]; }
  if(AC && addPaid){
    if(AC.discountE) energy=Math.max(0,energy-AC.discountE);
    if(AC.ignoreCost){ energy=0; pips=[]; }
    if(AC.pipDiscountPer){ for(let i=0;i<addCount && pips.length;i++) pips.pop(); }
    if(AC.kind==='pip') pips=[...pips, AC.dom];
  }
  energy = applyCostMods(p, c, energy);
  let accel = false;
  if(c.type==='Unit' && fx.kw.accelerate && !opts.fromHidden){
    const accPips = [ (c.dom&&c.dom.length===1)?c.dom[0]:'Any' ];
    if(canPay(p, energy+1, [...pips, ...accPips])){
      accel = await UI.confirmP(p, `[가속] 추가 비용(에너지 1+힘 1)을 지불하고 준비 상태로 등장시킬까요?`);
      if(accel){ energy+=1; pips=[...pips,...accPips]; }
    }
  }
  const spellOK = c.type==='Spell';   // 주문 전용 에너지(럭스 314)는 주문에만 쓸 수 있다
  if(!canPay(p, energy, pips, spellOK)){ UI.toast('자원이 부족합니다','warn'); return false; }

  // 위치 선택 (유닛)
  let loc=null;
  if(c.type==='Unit'){
    if(opts.fromHidden) loc=opts.bfIdx;
    else {
      // 마법사냥꾼 간수: 상대는 유닛을 기지에만
      const jailed = everyUnit().some(u=>u.ctrl!==p && u.loc!=='base' && unitFx(u).jailerUnits);
      const locs=[{v:'base',label:'기지'}];
      if(!jailed){
        const openOK = fx.playToOpenBf || everyUnit().some(u=>u.ctrl===p && unitFx(u).openBfAura);
        G.bfs.forEach((bf,i)=>{
          if(bf.controller===p) locs.push({v:i,label:`전장: ${card(bf.n).ko}`});
          else if(openOK && bf.controller===null && !bf.units.length) locs.push({v:i,label:`빈 전장: ${card(bf.n).ko}`});
          else if(fx.playToEnemyBf && (bf.units.some(u=>u.ctrl!==p) || (bf.controller!==null&&bf.controller!==p))) locs.push({v:i,label:`적 전장: ${card(bf.n).ko}`});
        });
      }
      loc = locs.length===1?'base': await UI.pickOption(p,'유닛을 배치할 위치', locs);
      if(loc===null) return false;
    }
  }

  payCost(p, energy, pips, undefined, spellOK);

  // 손패/존에서 제거
  // fromHidden도 여기서 소비한다 — 래퍼가 hand[0]에 임시 삽입해 두므로 건너뛰면
  // 숨김 카드가 전장에 등장하면서 손패에도 복사본이 남는다 (실측으로 확인된 버그).
  if(opts.champZone){ P.champInZone=false; }
  else P.hand.splice(handIdx,1);

  // 추가 비용의 실제 지불 (손패 정리 후)
  if(AC && addPaid){
    if(AC.kind==='discard' && P.hand.length){ const di=await UI.pickHandCard(p,'버릴 카드 (추가 비용)'); if(di!==null) await discardFromHand(p,di); }
    else if(AC.kind==='exhaustUnit' && addSel){ addSel.ex=true; UI.log(`${unitName(addSel)} 탈진 (추가 비용)`, 'p'+p); }
    else if(AC.kind==='spendBuff' && addSel){ addSel.buff=Math.max(0,addSel.buff-1); }
    else if(AC.kind==='spendBuffs'){ let left=addCount;
      for(const u of everyUnit().filter(u=>u.ctrl===p&&u.buff>0)){ const t=Math.min(left,u.buff); u.buff-=t; left-=t; if(!left) break; } }
    else if(AC.kind==='killUnit' && addSel){ await killUnit(addSel); }
    else if(AC.kind==='killUnits' && addSel){ for(const u of addSel) await killUnit(u); }
  }

  const legionOK = P.playedCards>=1;
  P.playedCards++;

  UI.log(`${pname(p)} 「${c.ko}」 플레이`, 'p'+p);

  // 유닛·도구는 응수 창 없이 즉시 해결된다 — 공식 규칙 333.1.c: "자원을 추가하는 능력·유닛·도구는
  // 확정(Finalize) 즉시 해결되며 Execute 단계로 진행하지 않는다" ([반응]으로 응수 불가).
  // 응수 창은 '주문'에만 열린다 (주문 분기의 reactionWindow).

  let placedU=null;
  if(c.type==='Unit'){
    // 준비 상태 등장 여부 (가속/효과/오라)
    let enterReady = accel || TF().enterReady[p];
    if(TF().nextUnitReady[p]){ enterReady=true; TF().nextUnitReady[p]=false; }
    const er=fx.entersReady;
    if(er===true) enterReady=true;
    else if(er==='oppBf' && G.bfs.some(bf=>bf.controller===opp(p))) enterReady=true;
    else if(er==='nearWin' && G.players[opp(p)].points>=G.victory-3) enterReady=true;
    if(collectStatics().some(src=>src.s.kind==='enterReadyAura' && src.p===p)) enterReady=true;

    const u = makeUnit(n, p, {loc, ready:enterReady});
    placedU=u;
    placeUnit(u, loc);
    UI.render();
    // 통찰 (자체 키워드 또는 오라)
    if(fx.kw.vision || effKw(u).vision) await visionCheck(p);
    // 플레이 트리거
    await runTriggerList(fx.triggers.onPlay, {p, unit:u, bfIdx: (loc!=='base'?loc:null), legionOK, paidAdd:addPaid, addCount});
    // 위력적 유닛 훅 (볼리베어)
    if(isMighty(u)) await legendHook(p,'hookMightyPlay',{p, unit:u});
    if(fx.manual.length) UI.manualNotice(c);
  }
  else if(c.type==='Spell'){
    UI.render();
    // ── 결전 중(자동 모드): 즉시 해결하지 않고 체인에 적재 — 공식 규칙 337~340 ──
    if(G.state==='showdown' && G.showdown){
      const sd=G.showdown;
      const item={ kind:(fx.counter||fx.steal)?'counter':'spell', p, n, fx,
        legionOK, addPaid, addCount, bfIdx:opts.bfIdx, steal:!!fx.steal, countered:false };
      if(item.kind==='counter'){
        // 카운터/탈취: 체인 위의 미해결 상대 주문을 대상으로 지정 (플레이 시점 대상 지정 — 규칙 355)
        const targets=sd.chain.filter(x=>x.kind==='spell' && !x.countered && x.p!==p)
          .filter(x=>{ const tc=card(x.n); const lim=fx.counter;
            if(lim && lim.maxE!==undefined && (tc.e||0)>lim.maxE) return false;
            if(lim && lim.maxPips!==undefined && powerPips(tc).length>lim.maxPips) return false;
            return true; });
        if(!targets.length){
          UI.log(`「${c.ko}」 — 대응할 체인 주문이 없어 효과 없이 폐기됩니다`, 'sys');
          trashCard(p, n); UI.render();
          return true;
        }
        item.target = targets.length===1 ? targets[targets.length-1]
          : await UI.pickOption(p, '대응할 주문 선택', targets.map(x=>({v:x, label:card(x.n).ko, n:x.n})));
        if(!item.target) item.target=targets[targets.length-1];
      }
      sd.chain.push(item);
      if(sd.chain.length===1) sd.chainStarter=p;
      UI.fx.chainAdd(c, p, sd.chain.length);
      UI.log(`🔗 ${pname(p)} 「${c.ko}」 체인에 적재 (#${sd.chain.length}) — 양측 패스 시 마지막 것부터 해결`, 'p'+p);
      const evctx={p, n, type:c.type, seq:P.playedCards, unit:null, paidAdd:addPaid};
      await fireEvent('onYouPlayCard', evctx);
      if(G.turn!==p) await fireEvent('onYouPlayOppTurn', evctx);
      if(opts.fromHidden) await fireEvent('onPlayFromHidden', evctx);
      await cleanup(p);
      UI.render();
      showdownActed(p);      // 패스 카운터 리셋 — 우선권은 적재자(p)가 유지 (연속 적재 가능)
      return true;
    }
    // ── 중립 상태: 기존 즉시 해결 + 대응 창 ──
    let execAs=p, countered=false;
    if(!opts.fromHidden && !fx.counter && !fx.steal){
      const cw=await counterWindow(p, c);
      if(cw && cw.countered) countered=true;
      else if(cw && cw.steal!==undefined) execAs=cw.steal;
    }
    if(fx.counter||fx.steal){ UI.log(`「${c.ko}」 — 대응할 상대 주문이 없어 효과 없이 폐기됩니다`, 'sys'); }
    if(!countered) await resolveSpellEffects(p, n, fx, {legionOK, addPaid, addCount, bfIdx:opts.bfIdx, execAs});
    else trashCard(p, n);
  }
  else if(c.type==='Gear'){
    P.gear.push({n, ex:!!fx.entersExhausted, attachedTo:null});
    UI.render();
    if(fx.kw.vision) await visionCheck(p);
    await runTriggerList(fx.triggers.onPlay, {p, legionOK, paidAdd:addPaid});
    if(fx.manual.length) UI.manualNotice(c);
    await fireEvent('onYouPlayGear', {p, n});
  }

  // 공통 플레이 이벤트
  const evctx={p, n, type:c.type, seq:P.playedCards, unit:placedU, paidAdd:addPaid};
  await fireEvent('onYouPlayCard', evctx);
  if(c.type==='Unit') await fireEvent('onYouPlayUnit', evctx);
  if(G.turn!==p) await fireEvent('onYouPlayOppTurn', evctx);
  if(opts.fromHidden) await fireEvent('onPlayFromHidden', evctx);

  await cleanup(p);
  UI.render();
  // 결전 중이던 카드 플레이 — 패스 카운터 리셋, 우선권은 플레이어가 유지.
  // (호출자마다 따로 하면 온라인 에코 경로에서 빠지므로 여기서 일괄 처리)
  if(sdAtStart && G.showdown===sdAtStart) showdownActed(p);
  return true;
}

// ---------- 비용 수정 (상시효과/턴 플래그) ----------
function applyCostMods(p, c, energy){
  let e=energy, minE=0;
  const fx=FX[c.n]||{};
  const sc=fx.selfCost;
  if(sc){
    if(sc.legion!==undefined && G.players[p].playedCards>=1) e-=sc.legion;
    if(sc.perTrash) e-=sc.perTrash*G.players[p].trash.length;
    if(sc.highestMight){ const ms=allUnits(p).map(u=>might(u)); if(ms.length) e-=Math.max(...ms); }
    if(sc.nearWin && G.players[opp(p)].points>=G.victory-sc.nearWin[0]) e-=sc.nearWin[1];
    if(sc.enemyDied && TF().enemyDied[p]) e-=sc.enemyDied;
  }
  if(c.type==='Spell'){
    e-=TF().nextSpellDisc[p]||0;
    for(const u of allUnits(p)){ const f=unitFx(u); if(f.spellDiscount && u.loc!=='base'){ e-=f.spellDiscount; minE=Math.max(minE,1); } }
  }
  if(c.type==='Unit'){
    for(const u of allUnits(p)){ const f=unitFx(u);
      if(f.tagDiscount && (c.tags||[]).includes(f.tagDiscount.tag)){ e-=f.tagDiscount.n; minE=Math.max(minE,f.tagDiscount.min||0); } }
  }
  return Math.max(e, minE, 0);
}

// ---------- 주문 효과 해결 (즉시 해결 경로와 체인 해결 경로가 공유) ----------
async function resolveSpellEffects(p, n, fx, o){
  const c=card(n); const P=G.players[p];
  const execAs=o.execAs??p;
  UI.fx.cast(c, p);
  G._casting=p; G._spellKilled=false; G._banishSpell=false;
  if(fx.playOps.length){
    for(const po of fx.playOps){
      if(po.legion && !o.legionOK){ UI.log(`[군단] 조건 미충족 — 효과 생략`, 'sys'); continue; }
      await execOps(po.ops, {p:execAs, legionOK:o.legionOK, bfIdx:o.bfIdx, kind:'spell', paidAdd:o.addPaid, addCount:o.addCount});
    }
  }
  // 소모형 플래그 해제 (다음 주문 할인/보너스)
  TF().nextSpellDisc[p]=0; TF().nextSpellBonus[p]=0;
  // 주문으로 유닛 처치 시: 폐기장 반응 (불멸의 불사조 등)
  if(G._spellKilled){
    for(const tn of [...new Set(P.trash)]){
      const tfx=FX[tn];
      if(tfx && tfx.fromTrashOnSpellKill && canPay(p, tfx.fromTrashOnSpellKill.energy||0, tfx.fromTrashOnSpellKill.pips||[])){
        const yes=await UI.confirmP(p, `「${card(tn).ko}」을(를) 폐기장에서 플레이할까요? (비용 지불)`);
        if(yes){ payCost(p, tfx.fromTrashOnSpellKill.energy||0, tfx.fromTrashOnSpellKill.pips||[]);
          P.trash.splice(P.trash.indexOf(tn),1);
          const uu=makeUnit(tn,p,{loc:'base'}); placeUnit(uu,'base');
          UI.log(`「${card(tn).ko}」 폐기장에서 플레이!`, 'p'+p); }
      }
    }
  }
  G._casting=null;
  if(fx.manual.length) UI.manualNotice(c);
  await fireEvent('onYouPlaySpell', {p, n});
  if(G._banishSpell){ P.banish.push(n); G._banishSpell=false; UI.log(`「${c.ko}」 추방됨`, 'sys'); }
  else trashCard(p, n);
}

// ---------- 대응 창 (카운터/탈취 주문 — 중립 상태 전용, 결전 중에는 체인이 담당) ----------
// 중립 상태 응수 창 (구 counterWindow 확장) — 공식 규칙 근거:
//  · '주문'을 내면 체인이 생기고 상태가 닫힌다 (333.1.a / Playing Cards 1단계)
//  · 닫힌 상태에서는 [반응] 카드만 낼 수 있다 (309.2)
//  · 단 유닛·도구는 확정 즉시 해결되어 응수 대상이 아니다 (333.1.c) — 주문에만 이 창이 열린다
//  · 카운터/탈취는 '주문'에만 (저항: "Counter a spell") — 기존 제한 유지
//  · 일반 [반응]은 즉시 해결(LIFO — 대기 중인 주문보다 먼저), 그 반응에 대한 재응수 창은
//    playCardFromHand 재귀로 자연히 열린다. 응수할 카드가 없으면 조용히 지나간다(속도 유지).
async function reactionWindow(caster, c){
  if(G.manual) return null;
  const o=opp(caster);
  let result=null;
  for(let guard=0; guard<20; guard++){
    const O=G.players[o];
    const opts=[];
    O.hand.forEach((hn,i)=>{
      const fx=FX[hn]; if(!fx||!fx.kw||!fx.kw.reaction) return;
      const cc=card(hn); if(cc.type!=='Spell') return;
      const cost=cc.e||0, pips=powerPips(cc);
      if(!canPay(o,cost,pips)) return;
      if(fx.counter||fx.steal){
        if(c.type!=='Spell' || result) return;   // 카운터는 대기 중인 주문에만, 이미 무효화됐으면 무의미
        if(fx.counter){
          if(fx.counter.maxE!==undefined && (c.e||0)>fx.counter.maxE) return;
          if(fx.counter.maxPips!==undefined && powerPips(c).length>fx.counter.maxPips) return;
        }
      }
      // card를 실어 보내면 응수 모달에서 마우스 오버로 그 카드의 효과를 볼 수 있다 (ui.js optionCard)
      opts.push({v:i, label:`⚡ ${cc.ko} (비용 ${cost}${pips.length?' + 힘'+pips.length:''})`, isCounter:!!(fx.counter||fx.steal), card:cc});
    });
    if(!opts.length) return result;
    const sel=await UI.pickReaction(o, `${pname(caster)}이(가) 「${c.ko}」 플레이 — [반응]으로 응수할까요?`, opts);
    if(sel===null||sel===undefined) return result;
    const hn=O.hand[sel]; if(hn===undefined) return result;
    const rfx=FX[hn]; const cc=card(hn);
    if(rfx.counter||rfx.steal){
      payCost(o, cc.e||0, powerPips(cc));
      O.hand.splice(sel,1); trashCard(o, hn);
      if(rfx.steal){ UI.log(`⚡「${cc.ko}」: 「${c.ko}」의 통제권 탈취!`, 'p'+o); result={steal:o}; }
      else { UI.log(`⚡「${cc.ko}」: 「${c.ko}」 무효화!`, 'p'+o); result={countered:true}; }
      UI.render();
      continue;                                  // 상대는 이어서 다른 반응도 낼 수 있다
    }
    // 일반 반응: 정식 플레이 경로로 — 먼저 해결되고(LIFO), 그 안에서 caster의 재응수 창이 열린다
    const prevRw=G._rwFor; G._rwFor=o;
    try{ await playCardFromHand(o, sel, {}); }
    finally{ G._rwFor=prevRw; }
    if(G.winner!==null) return result;
  }
  return result;
}
const counterWindow = reactionWindow;   // 구명 호환

// 통찰: 덱 맨 위 확인 → 재활용 여부
async function visionCheck(p){
  const P=G.players[p];
  if(!P.deck.length) return;
  const top=P.deck[0];
  const yes = await UI.confirmP(p, `[통찰] 덱 맨 위: 「${card(top).ko}」 — 덱 맨 아래로 되돌릴까요?`, card(top));
  if(yes){ P.deck.shift(); P.deck.push(top); UI.log(`${pname(p)} [통찰]로 덱 맨 위 카드를 재활용`, 'p'+p); await fireEvent('onYouRecycle',{p}); }
}

// ---------- 숨기기 (숨겨짐) ----------
async function hideCard(p, handIdx){
  const P=G.players[p];
  // 룰 737: 손패 '또는 챔피언 구역'에서 숨길 수 있다 (handIdx==='champ')
  const fromChamp = handIdx==='champ';
  if(fromChamp && !P.champInZone){ UI.toast('챔피언이 챔피언 존에 없습니다','warn'); return; }
  const n=fromChamp ? P.champN : P.hand[handIdx]; const c=card(n);
  const fx=FX[n]||{kw:{}};
  if(!fx.kw.hidden){ UI.toast('[숨겨짐] 카드가 아닙니다','warn'); return; }
  if(G.turn!==p || G.state!=='neutral'){ UI.toast('자신의 턴 중립 상태에서만 숨길 수 있습니다','warn'); return; }
  const cap = bf => bf.n===BF_STATIC.DOUBLE_HIDE?2:1;
  const myBfs = G.bfs.map((bf,i)=>({bf,i})).filter(x=>x.bf.controller===p && x.bf.hiddenCards.length<cap(x.bf));
  if(!myBfs.length){ UI.toast('숨길 수 있는 (통제 중 + 빈 슬롯) 전장이 없습니다','warn'); return; }
  // 비용: 힘 1 (티모 전설: 에너지 1 대체 / 게릴라전: 무료)
  const teemo = FX[P.legendN] && FX[P.legendN].altHideCost;
  let paid=false;
  if(TF().freeHide[p]) paid=true;
  else if(canPay(p,0,['Any'])){ payCost(p,0,['Any']); paid=true; }
  else if(teemo && canPay(p,1,[])){ payCost(p,1,[]); paid=true; }
  if(!paid){ UI.toast('자원이 부족합니다 (힘 1 필요)','warn'); return; }
  const sel = myBfs.length===1? myBfs[0].i : await UI.pickOption(p,'카드를 숨길 전장', myBfs.map(x=>({v:x.i,label:card(x.bf.n).ko})));
  if(sel===null) return;
  if(fromChamp) P.champInZone=false; else P.hand.splice(handIdx,1);
  G.bfs[sel].hiddenCards.push({n, by:p, turn:G.turnCount});
  UI.log(`${pname(p)} ${fromChamp?'챔피언 존의 카드':'카드'}를 전장에 뒷면으로 숨김`, 'p'+p);
  UI.render();
}

async function playHidden(p, bfIdx){
  const bf=G.bfs[bfIdx];
  // 녹서스 파괴공작원: 이곳의 상대 [숨겨짐] 카드는 공개 불가
  if(bf.units.some(u=>u.ctrl!==p && unitFx(u).blockReveal)){
    UI.toast('「녹서스 파괴공작원」: 이곳의 숨긴 카드를 공개할 수 없습니다','warn'); return;
  }
  const mine = bf.hiddenCards.filter(h=>h.by===p);
  if(!mine.length) return;
  const playable = mine.filter(h=>!(h.turn===G.turnCount && G.turn===p));
  if(!playable.length){ UI.toast('숨긴 턴에는 플레이할 수 없습니다','warn'); return; }
  let h = playable[0];
  if(playable.length>1){
    const sel=await UI.pickOption(p,'플레이할 숨김 카드',playable.map(x=>({v:x,label:card(x.n).ko,n:x.n})));
    if(!sel) return;
    h=sel;
  }
  const n=h.n;
  // 안 되는 타이밍이면 공개 전에 거른다 (공개했다가 되돌리면 카드 정보만 새 나간다)
  const restr = playRestriction(card(n), p, true);
  if(restr){ UI.toast(restr,'warn'); return; }
  bf.hiddenCards.splice(bf.hiddenCards.indexOf(h),1);
  // 유닛·주문·도구 모두 정식 플레이 경로를 탄다 — 비용 0(738.1), 유닛은 이 전장에 등장(737.2),
  // 주문 대상도 이 전장 컨텍스트(bfIdx), 결전 중이면 체인에 적재.
  // 예전엔 주문/도구를 여기서 직접 해결해서 결전 중엔 체인을 건너뛰었고,
  // 유닛은 playRestriction에 막혀 결전 중 공개가 아예 불가능했다(739.1 위반).
  UI.log(`${pname(p)} 전장의 숨김 카드를 공개!`, 'p'+p);
  const ok = await playCardFromHand(p, -1, {fromHidden:true, bfIdx, directN:n});
  if(ok===false){ bf.hiddenCards.push(h); UI.render(); }   // 예상 밖 실패 — 다시 숨김
}

// playCardFromHand에서 fromHidden 유닛의 카드 번호 참조 보정
const _origPlay = playCardFromHand;
playCardFromHand = async function(p, handIdx, opts={}){
  if(opts.fromHidden && opts.directN){
    const P=G.players[p];
    P.hand.unshift(opts.directN); // 임시 삽입
    const r = await _origPlay(p, 0, {...opts});
    if(r===false && P.hand[0]===opts.directN) P.hand.shift(); // 실패 시 임시 삽입 회수 (손패로 순간이동 방지)
    return r;
  }
  return _origPlay(p, handIdx, opts);
};

// ---------- 이동 ----------
async function moveUnits(p, units, dest){
  // dest: 'base' | bfIdx
  for(const u of units){
    if(u.ex){ UI.toast('탈진된 유닛은 이동할 수 없습니다','warn'); return false; }
    if(u.loc===dest){ UI.toast('이미 그 위치에 있습니다','warn'); return false; }
    if(u.loc!=='base' && dest!=='base' && !effKw(u).ganking){
      UI.toast(`${unitName(u)}: 전장 간 이동은 [개입]이 필요합니다`,'warn'); return false;
    }
    if(u.loc!=='base' && dest==='base' && G.bfs[u.loc].n===BF_STATIC.NO_RETREAT){
      UI.toast(`「${card(G.bfs[u.loc].n).ko}」: 이곳에서 기지으로 이동할 수 없습니다`,'warn'); return false;
    }
  }
  const origins = units.map(u=>u.loc);
  units.forEach(u=>{
    u.ex=true;
    u.turnMoves=(u.turnMoves||0)+1;
    removeUnit(u); placeUnit(u, dest);
  });
  // 전장 트리거: 이곳에서 이동한 유닛
  for(let i=0;i<units.length;i++){
    if(origins[i]!=='base') await fireBfTrigger(origins[i],'onMoveFromHere',{p, it:units[i], bfIdx:origins[i]});
  }
  const destName = dest==='base'?'기지':`「${card(G.bfs[dest].n).ko}」`;
  UI.log(`${pname(p)} 유닛 ${units.length}개 ${destName}(으)로 이동`, 'p'+p);
  if(G.manual){ UI.render(); return true; } // 수동: 이동 트리거·전투 자동 처리 없음
  // 유닛별 이동 트리거 (떠돌이 상인, 야스오, 군악병 등)
  for(const u of units){
    await runTriggerList(unitFx(u).triggers?.onMoveSelf, {p, unit:u, it:u, bfIdx:(dest!=='base'?dest:null), dest});
  }
  if(dest!=='base') await fireEvent('onMoveToBf', {p, bfIdx:dest});
  // 은밀한 추적자: 같은 위치에서 아군이 이동하면 동행 가능
  for(const o of [...new Set(origins.filter(x=>x!=='base'))]){
    for(const t of [...G.bfs[o].units].filter(x=>x.ctrl===p && unitFx(x).tagAlong && !units.includes(x))){
      const yes=await UI.confirmP(p, `「${unitName(t)}」도 함께 이동할까요?`);
      if(yes){ removeUnit(t); placeUnit(t,dest); t.turnMoves=(t.turnMoves||0)+1; UI.log(`${unitName(t)} 동행 이동`, 'p'+p); }
    }
  }
  // 공격 트리거
  if(dest!=='base'){
    const bf=G.bfs[dest];
    const isAttack = bf.controller!==null && bf.controller!==p || bf.units.some(u=>u.ctrl!==p);
    if(isAttack){
      for(const u of units){
        await runTriggerList(unitFx(u).triggers?.onAttack, {p, unit:u, bfIdx:dest});
        await runTriggerList(unitFx(u).triggers?.onAttackOrDefend, {p, unit:u, bfIdx:dest});
        // 아리 전설 훅 (방어측)
        const defender = bf.controller!==null&&bf.controller!==p ? bf.controller : opp(p);
        await legendHookTarget(defender,'hookEnemyAttackMyBf',{p:defender, it:u, bfIdx:dest});
      }
    }
  }
  await cleanup(p, units[0]?.loc);
  UI.render();
  return true;
}

// 공식 룰: 전장 통제는 유닛 주둔으로 유지된다 — 유닛이 하나도 없으면 무주공산(open)으로 돌아간다.
// (유지 득점은 "유닛이 주둔한" 통제 전장만 해당 — 상호 전멸 시에도 아무도 통제하지 않음)
function releaseEmptyBattlefields(){
  if(G.manual) return;
  G.bfs.forEach((bf,bi)=>{
    // 진행 중인 결전 전장은 결전 종료 처리(resolveShowdown)가 담당 — 중간 클린업이
    // 먼저 통제를 풀고 숨김 카드를 폐기하면 룰(클린업 4단계: 비경합 조건)보다 이르다
    if(G.showdown && G.showdown.bfIdx===bi) return;
    if(bf.controller!==null && bf.units.length===0){
      UI.log(`「${card(bf.n).ko}」 — 유닛이 없어 무주공산이 됩니다 (통제 해제)`, 'sys');
      bf.controller=null;
      // 통제를 잃으면 뒷면(숨김) 카드는 다음 클린업에 제거된다 (공식 106.4.e).
      // 정복으로 뺏길 때(resolveShowdown)만 처리하고 여기가 빠져 있어서,
      // 효과로 전멸당해 무주공산이 된 전장에 숨김 카드가 계속 남아 있었다.
      if(bf.hiddenCards.length){
        bf.hiddenCards.forEach(hc=>{ G.players[hc.by].trash.push(hc.n); });
        UI.log(`숨겨둔 카드 ${bf.hiddenCards.length}장이 폐기되었습니다 (전장 통제 상실)`, 'sys');
        bf.hiddenCards=[];
      }
    }
    if(bf.units.length===0) bf.contestedBy=null;   // 유닛이 모두 떠나면 경합도 해제
  });
}

// ---------- 클린업: 사망 처리 & 경합 확인 ----------
async function cleanup(actor){
  if(G.manual) return; // 수동 모드: 자동 사망·결전·전투 없음 (플레이어가 직접 처리)
  // 치명 피해 사망 (+ 황제의 칙령 표식)
  for(const u of everyUnit()){
    // 전투 결전 중에는 공/방 지정 위력([맹공]·[보호막] 등)을 치명 판정에도 반영 (룰 704/727)
    let m=might(u);
    if(G.showdown && G.showdown.hasCombat && u.loc===G.showdown.bfIdx)
      m=might(u, u.ctrl===G.showdown.attacker?'attacker':'defender', {forKill:true});
    if((u.dmg>0 && u.dmg>=m) || u._decree) await killUnit(u);
  }
  if(G.winner!==null) return;
  // 빈 전장 통제 해제 (결전 중 상호 전멸 등도 이후 클린업에서 처리됨)
  releaseEmptyBattlefields();
  // 경합 확인 (중립 상태에서만 새 결전 개시)
  if(G.state!=='neutral') return;
  for(let i=0;i<G.bfs.length;i++){
    const bf=G.bfs[i];
    const p0=bf.units.filter(u=>u.ctrl===0).length;
    const p1=bf.units.filter(u=>u.ctrl===1).length;
    // 공격자 = 경합을 적용한 유닛의 통제자 (강제 이동으로 상대 유닛이 끌려온 경우 시전자가 아님)
    if(p0&&p1){ await startShowdown(i, bf.contestedBy ?? actor ?? G.turn, true); return; }
    const present = p0?0:(p1?1:null);
    if(present!==null && bf.controller!==present){
      await startShowdown(i, present, false); return;
    }
  }
}

// ---------- 결전 (Showdown) ----------
async function startShowdown(bfIdx, attacker, hasCombat){
  const bf=G.bfs[bfIdx];
  G.state='showdown';
  // chain: 체인(스택) — 결전 중 카드/능력은 즉시 해결되지 않고 여기 쌓인다 (공식 규칙 337~348)
  G.showdown={ bfIdx, attacker, defender:opp(attacker), hasCombat, passes:0, chain:[], chainStarter:null };
  G.actingPlayer=attacker;
  UI.log(`⚔️ 결전 개시! 「${card(bf.n).ko}」 — 공격: ${pname(attacker)}`, 'combat');
  // 전장 트리거: 방어 시 (방어자가 이 전장의 통제자일 때)
  if(bf.controller===opp(attacker))
    await fireBfTrigger(bfIdx,'onDefendHere',{p:opp(attacker), bfIdx});
  // 방어측 유닛 트리거 (티모, 아리 등)
  for(const u of [...bf.units].filter(u=>u.ctrl===opp(attacker))){
    await runTriggerList(unitFx(u).triggers?.onDefend, {p:u.ctrl, unit:u, bfIdx});
    await runTriggerList(unitFx(u).triggers?.onAttackOrDefend, {p:u.ctrl, unit:u, bfIdx});
  }
  // 예지의 가면: 혼자 공격/방어하는 아군 유닛 +1⚔ (이번 턴)
  for(const pi of [attacker, opp(attacker)]){
    const side=bf.units.filter(u=>u.ctrl===pi);
    if(side.length===1 && G.players[pi].gear.some(g=>FX[g.n]&&FX[g.n].gearAloneCombat)){
      side[0].tempM.push({v:1,dur:'turn'});
      UI.log(`「예지의 가면」: ${unitName(side[0])} +1⚔`, 'p'+pi);
    }
  }
  UI.render();
  UI.promptShowdown();
}

// 결전 중 패스 — 공식 체인 절차 (규칙 339~340, 346~348):
//  · 양측 연속 패스 + 체인 있음 → 가장 마지막 항목 '하나' 해결(LIFO), 그 후 우선권 재부여(응수 가능)
//  · 양측 연속 패스 + 체인 없음 → 결전 종료(전투 진행)
async function showdownPass(){
  const sd=G.showdown; if(!sd) return;
  sd.passes++;
  if(sd.passes<2){
    G.actingPlayer=opp(G.actingPlayer);
    UI.render(); UI.promptShowdown();
    return;
  }
  if(sd.chain.length){
    const item=sd.chain.pop();                 // 340.1: 가장 새로운 항목부터 해결
    await resolveChainItem(item);
    if(G.winner!==null || G.showdown!==sd) return;
    sd.passes=0;
    if(sd.chain.length){
      G.actingPlayer=sd.chain[sd.chain.length-1].p;   // 340.4: 남은 최상단 항목의 컨트롤러가 우선권
    } else {
      G.actingPlayer=opp(sd.chainStarter??G.actingPlayer); // 346: 체인이 닫히면 포커스가 상대에게
      sd.chainStarter=null;
    }
    UI.render(); UI.promptShowdown();
    return;
  }
  await resolveShowdown();                     // 348.1: 빈 체인에서 양측 패스 → 전투
}

// 체인 항목 하나 해결
async function resolveChainItem(it){
  if(it.kind==='ability'){
    UI.log(`🔗 해결: 능력 「${it.srcName}」`, 'p'+it.p);
    await execOps(it.ab.ops, {p:it.p, unit:it.unit, gear:it.gear, kind:'ability',
      bfIdx:(it.unit&&it.unit.loc!=='base')?it.unit.loc:null});
    await cleanup(it.p);
    return;
  }
  const c=card(it.n);
  if(it.countered){
    UI.log(`🔗 「${c.ko}」 — 무효화되어 효과 없이 폐기됩니다`, 'sys');
    trashCard(it.p, it.n); UI.render();
    return;
  }
  if(it.kind==='counter'){
    trashCard(it.p, it.n);
    if(it.target && !it.target.countered && !it.target.resolved){
      if(it.steal){ it.target.execAs=it.p; UI.log(`🔗 ⚡「${c.ko}」: 「${card(it.target.n).ko}」 통제권 탈취!`, 'p'+it.p); }
      else { it.target.countered=true; UI.log(`🔗 ⚡「${c.ko}」: 「${card(it.target.n).ko}」 무효화!`, 'p'+it.p); }
    } else UI.log(`🔗 「${c.ko}」 — 대상이 유효하지 않아 효과 없음`, 'sys');
    UI.render();
    return;
  }
  UI.log(`🔗 해결: 「${c.ko}」 (${pname(it.p)})`, 'p'+it.p);
  it.resolved=true;
  await resolveSpellEffects(it.p, it.n, it.fx,
    {legionOK:it.legionOK, addPaid:it.addPaid, addCount:it.addCount, bfIdx:it.bfIdx, execAs:it.execAs??it.p});
  await cleanup(it.p);
}
// 결전 중 행동(체인 적재) 처리 — 공식 규칙: 적재자가 '최신 항목의 컨트롤러'로서 우선권을 유지한다.
// (자기 카드를 연달아 쌓을 수 있고, 우선권은 명시적 패스로만 상대에게 넘어간다 — 규칙 Step 1-2)
// 예전에는 여기서 자동으로 상대에게 넘겼는데, 그러면 상대가 항상 먼저 결정을 강요받아
// 블러핑·카운터 유도 구조가 룰북과 반대가 된다. 패스 카운터만 리셋한다.
function showdownActed(p){
  if(!G.showdown) return;
  G.showdown.passes=0;
  if(p!==undefined) G.actingPlayer=p;
  UI.render(); UI.promptShowdown();
}

async function resolveShowdown(){
  const sd=G.showdown; const bf=G.bfs[sd.bfIdx];
  const atkUnits = ()=>bf.units.filter(u=>u.ctrl===sd.attacker);
  const defUnits = ()=>bf.units.filter(u=>u.ctrl===sd.defender);

  // 무혈 결전(전투 없이 열린 결전) 종료 시 양측 유닛이 남으면: 통제 확립 불가·경합 유지,
  // 새 '전투'가 개시된다 (규칙: Staged Combat — 공식 L1565~1571). 곧바로 피해를 주지 않고
  // 전투 결전을 새로 열어 방어 트리거와 새 응수 라운드를 거치게 한다.
  if(!sd.hasCombat && atkUnits().length && defUnits().length){
    UI.log(`양측 유닛이 남아 전투가 개시됩니다 (경합 유지)`, 'combat');
    G.state='neutral'; G.showdown=null;
    await startShowdown(sd.bfIdx, bf.contestedBy ?? sd.attacker, true);
    return;
  }

  // 전투 피해 단계
  if(atkUnits().length && defUnits().length){
    const atkSum = atkUnits().reduce((s,u)=>s+might(u,'attacker'),0);
    const defSum = defUnits().reduce((s,u)=>s+might(u,'defender'),0);
    UI.log(`전투! 공격 위력 합 ${atkSum} vs 방어 위력 합 ${defSum}`, 'combat');

    // 초과 피해 (트린다미어): 방어측 총 체력 대비 (처치 기준 전투력)
    const defHealth = defUnits().reduce((s,u)=>s+Math.max(0,might(u,'defender',{forKill:true})-u.dmg),0);
    sd.excess = Math.max(0, atkSum - defHealth);

    // 피해 배분 (치명 우선, 탱커 우선)
    const atkAssign = await assignDamage(sd.attacker, atkSum, defUnits(), 'defender');
    const defAssign = await assignDamage(sd.defender, defSum, atkUnits(), 'attacker');

    // 동시 적용
    [...atkAssign, ...defAssign].forEach(([u,d])=>{ dealDamage(u, d, 'combat'); });
    UI.render();
    // 사망 처리
    const dead = bf.units.filter(u=>{
      const role = u.ctrl===sd.attacker?'attacker':'defender';
      return (u.dmg>0 && u.dmg>=might(u,role,{forKill:true})) || u._decree;
    });
    // 솔라리의 상징: 공격측 보유 + 무승부(모두 사망)면 모두 기지 귀환
    if(dead.length===bf.units.length && dead.length>0 && G.players[sd.attacker].gear.some(g=>g.n===227)){
      UI.log(`「솔라리의 상징」: 무승부 — 모든 유닛이 기지으로 귀환합니다`, 'combat');
      [...bf.units].forEach(u=>{ u.dmg=0; u._decree=false; removeUnit(u); placeUnit(u,'base'); });
    } else {
      for(const u of dead) await killUnit(u);
    }
  }

  // 해결 단계: 전투 정리 — 모든 유닛 치유 (공식: 전장 밖 유닛 포함), 방어자 잔존 시 공격자 본진 귀환
  everyUnit().forEach(u=>u.dmg=0);
  if(defUnits().length && atkUnits().length){
    UI.log(`방어 성공 — 공격 유닛은 기지으로 귀환합니다`, 'combat');
    atkUnits().forEach(u=>{ removeUnit(u); placeUnit(u,'base'); });
  }

  // 통제 확립 & 정복
  const remaining = bf.units.length? bf.units[0].ctrl : null;
  const prevController = bf.controller;
  G.state='neutral'; G.showdown=null; G.actingPlayer=G.turn;
  bf.contestedBy=null;   // 결전 종료 — 경합 해제 (통제 확립/재확립 또는 전장 비움)

  // 정복(Conquer) = 통제를 '새로 얻는' 것 (규칙 446.1 "gains Control").
  // 이미 통제 중이던 방어자가 방어에 성공하면 '재확립'이라 정복이 아니다 — 득점 없음.
  // (전투 해결문의 "경합 적용자가 아니어도 된다"는 무주공산 전장을 방어측이 '새로 얻는'
  //  기습 방어(surprise defense) 경우를 가리킨다. 공식 Q&A로 확인: 방어 성공 자체는 무득점.)
  if(remaining!==null && remaining!==prevController){
    bf.controller=remaining;
    bf.hiddenCards = bf.hiddenCards.filter(h=>{
      if(h.by!==remaining){
        UI.log(`숨겨둔 카드가 폐기되었습니다 (전장 상실)`, 'sys');
        G.players[h.by].trash.push(h.n);
        return false;
      }
      return true;
    });
    const P=G.players[remaining];
    if(!bf.scored[remaining]){
      bf.scored[remaining]=true; P.scoredBf[G.bfs.indexOf(bf)]=true;
      addPoints(remaining,1,'conquer');
      // 정복 트리거
      for(const u of bf.units.filter(u=>u.ctrl===remaining)){
        await runTriggerList(unitFx(u).triggers?.onConquer, {p:remaining, unit:u, bfIdx:sd.bfIdx, excess:(remaining===sd.attacker?sd.excess:0)});
      }
      await fireTriggers('onConquerYou', {p:remaining, bfIdx:sd.bfIdx});
      await fireBfTrigger(sd.bfIdx,'onConquerHere',{p:remaining,bfIdx:sd.bfIdx});
      await legendHook(remaining,'hookConquer',{p:remaining});
    } else {
      UI.log(`이번 턴에 이미 득점한 전장 — 추가 득점 없음`, 'sys');
    }
  }
  UI.render();
  UI.prompt(G.turn===G.actingPlayer?`${pname(G.turn)}의 행동 단계`:'');
  await cleanup(G.turn);
}

// 피해 배분: assigner가 targets에 total 피해를 배분 (치명 우선/탱커 우선 자동, 순서는 프롬프트)
async function assignDamage(assigner, total, targets, role){
  const result=[];
  let remain=total;
  let pool=[...targets];
  while(remain>0 && pool.length){
    // 케이틀린: 마지막에만 배분 가능
    const nonLast = pool.filter(u=>!unitFx(u).combatLast);
    const basePool = nonLast.length?nonLast:pool;
    // 탱커 우선
    const tanks = basePool.filter(u=>effKw(u).tank);
    const candidates = tanks.length?tanks:basePool;
    let pick;
    if(candidates.length===1) pick=candidates[0];
    else {
      pick = await UI.pickUnitFrom(assigner, candidates,
        `${pname(assigner)}: 피해를 배분할 유닛 선택 (남은 피해 ${remain})`);
      if(!pick) pick=candidates[0];
    }
    const m = might(pick, role, {forKill:true}); // 기절 유닛도 원래 전투력만큼 치명 배분 필요
    const lethal = Math.max(1,m - pick.dmg);
    const dealt = Math.min(remain, lethal);
    // 치명 우선 규칙: 남은 피해가 치명 미만이고 다른 대상이 없으면 그대로
    result.push([pick, dealt]);
    remain-=dealt;
    pool=pool.filter(u=>u!==pick);
  }
  // 초과 피해는 마지막 유닛에게 (규칙상 남는 유닛 없으면 초과 배분 가능)
  if(remain>0 && result.length){ result[result.length-1][1]+=remain; }
  return result;
}

// ---------- 사망 ----------
async function killUnit(u){
  if(u._dead) return; u._dead=true;
  UI.fx.unit(u, 'die');          // 보드에서 사라지기 전에 위치를 잡아 연출
  const fx=unitFx(u);
  const P=G.players[u.ctrl];
  const wasBuffed=u.buff>0, wasStunned=u.stunned, deathLoc=u.loc;

  // 최후의 전사(OGS 320): 이번 턴 다음 사망 → 탈진 상태로 귀환 (대체, 비용 없음·강제)
  if(u._highlander){
    u._highlander=false;
    u.dmg=0; u.ex=true; u._dead=false; u._decree=false;
    removeUnit(u); placeUnit(u,'base');
    UI.log(`「${unitName(u)}」 사망 대신 탈진 상태로 귀환 (최후의 전사)`, 'p'+u.ctrl);
    UI.render(); return;
  }
  // 무허가 무기고: 사망 대체 (분노 힘 1 지불)
  if(u._armory && canPay(u.ctrl,0,['Fury'])){
    const yes=await UI.confirmP(u.ctrl, `[무허가 무기고] 분노 힘 1을 지불하고 「${unitName(u)}」을(를) 회수할까요?`);
    if(yes){
      payCost(u.ctrl,0,['Fury']); u._armory=false;
      u.dmg=0; u.ex=true; u._dead=false; u._decree=false;
      removeUnit(u); placeUnit(u,'base');
      UI.log(`「${unitName(u)}」 사망 대신 회수됨 (무허가 무기고)`, 'p'+u.ctrl);
      UI.render(); return;
    }
  }
  // 존야의 모래시계: 도구를 대신 폐기하고 회수
  {
    const zi=P.gear.findIndex(g=>FX[g.n]&&FX[g.n].zhonya);
    if(zi>=0){
      const yes=await UI.confirmP(u.ctrl, `[존야의 모래시계] 도구를 대신 폐기하고 「${unitName(u)}」을(를) 회수할까요?`);
      if(yes){
        await killGear(u.ctrl, zi);
        u.dmg=0; u.ex=true; u._dead=false; u._decree=false;
        removeUnit(u); placeUnit(u,'base');
        UI.log(`「${unitName(u)}」 사망 대신 회수됨 (존야)`, 'p'+u.ctrl);
        UI.render(); return;
      }
    }
  }
  // 미스 포츈 전설: 버프 유닛 사망 대체
  if(u.buff>0){
    const lfx=FX[P.legendN];
    if(lfx && lfx.hookBuffedDeathSave && !P.legendEx && canPay(u.ctrl,0,['Any'])){
      const yes = await UI.confirmP(u.ctrl, `[미스 포츈] ✳1 지불+전설 탈진+버프 소모로 「${unitName(u)}」을(를) 회수할까요?`);
      if(yes){
        payCost(u.ctrl,0,['Any']); P.legendEx=true; u.buff=Math.max(0,u.buff-1);
        u.dmg=0; u.ex=true; u._dead=false;
        removeUnit(u); placeUnit(u,'base');
        UI.log(`「${unitName(u)}」 사망 대신 기지으로 회수됨`, 'p'+u.ctrl);
        UI.render(); return;
      }
    }
  }

  removeUnit(u);
  UI.log(`💀 ${unitName(u)} 사망`, 'combat');
  // 도구는 폐기
  u.gear.forEach(gn=>trashCard(u.ctrl,gn));

  if(!u.isToken){
    // 공식 룰: 선발 챔피언도 사망 시 폐기장으로 간다.
    // 챔피언 존 복귀는 일반적 수단으로는 불가 — 특정 효과(예: 신성한 무덤)로만 가능.
    trashCard(u.ctrl, u.n);
  }
  // 턴 플래그: 상대 관점의 '적 유닛 사망'
  TF().enemyDied[opp(u.ctrl)]=true;
  if(G._casting!==undefined && G._casting!==null && u.ctrl!==G._casting) G._spellKilled=true;
  UI.render();
  // 죽음의 종소리 (카서스: 추가 1회)
  const ctxD={p:u.ctrl, unit:u, bfIdx:(deathLoc!=='base'?deathLoc:null), dead:true};
  await runTriggerList(fx.triggers?.onDeath, ctxD);
  if(fx.triggers?.onDeath && allUnits(u.ctrl).some(x=>unitFx(x).deathknellTwice)){
    UI.log(`[카서스] 죽음의 종소리 효과 1회 추가 발동!`, 'p'+u.ctrl);
    await runTriggerList(fx.triggers?.onDeath, ctxD);
  }
  // 전역 사망 이벤트 (메아리의 망령, 선봉대 투구, 빅토르 등)
  await fireEvent('onUnitDeath', {p:u.ctrl, dead:u, buffed:wasBuffed, isToken:u.isToken, tokenName:u.tokenName});
  // 기절 상태로 처치됨 → 처치자 이벤트 (솔라리 성소)
  if(wasStunned){
    const killer = u.ctrl===G.actingPlayer ? opp(u.ctrl) : G.actingPlayer;
    await fireEvent('onYouKillStunned', {p:killer});
  }
}

// ---------- 트리거 실행 ----------
async function runTriggerList(list, ctx){
  if(!list) return;
  for(const t of list){
    if((t.who||'self')!=='self') continue; // 상대 이벤트 리스너는 fireEvent 경유
    if(t.cond && !t.cond(ctx, ctx.unit)) continue;
    // [군단] 판정: 등장(onPlay) 트리거는 "이 카드 이전에 다른 카드를 플레이했는가"(ctx.legionOK)로,
    // 그 외 트리거는 이 턴에 카드를 플레이했는가로 판정한다. (자기 자신 포함 방지)
    const legionOK = (ctx.legionOK!==undefined) ? ctx.legionOK : (G.players[ctx.p].playedCards>=1);
    if(t.legion && !legionOK){
      UI.log(`[군단] 조건 미충족 — 트리거 생략`, 'sys'); continue;
    }
    await execOps(t.ops, ctx);
  }
}
// 보드 전체 이벤트: 양측의 전설/유닛/도구 리스너를 스캔한다.
// t.who: 'self'(기본, 이벤트 주체 본인) | 'opp'(상대의 행동에 반응)
async function fireEvent(ev, ctx){
  if(!G || G.winner!==null) return;
  for(const pi of [0,1]){
    const rel = pi===ctx.p ? 'self' : 'opp';
    const srcs=[];
    const lfx=FX[G.players[pi].legendN];
    if(lfx && lfx.triggers && lfx.triggers[ev]) srcs.push({list:lfx.triggers[ev]});
    for(const u of [...everyUnit()].filter(u=>u.ctrl===pi)){
      const fx=unitFx(u);
      if(fx.triggers && fx.triggers[ev]) srcs.push({list:fx.triggers[ev], unit:u});
    }
    for(const g of [...G.players[pi].gear]){
      const gf=FX[g.n];
      if(gf && gf.triggers && gf.triggers[ev]) srcs.push({list:gf.triggers[ev], gear:g});
    }
    for(const s of srcs){
      for(const t of s.list){
        if((t.who||'self')!==rel) continue;
        if(t.cond && !t.cond(ctx, s.unit||s.gear)) continue;
        if(t.legion && !(G.players[pi].playedCards>=1)) continue;
        if(t.oncePerTurn){
          const k='ev:'+ev+':'+(s.unit?s.unit.uid:(s.gear?'g'+s.gear.n:'l'))+':'+pi;
          if(TF()._once[k]) continue;
          TF()._once[k]=true;
        }
        await execOps(t.ops, {...ctx, p:pi, unit:s.unit||undefined, gear:s.gear||ctx.gear, it:ctx.it, kind:'effect'});
      }
    }
  }
}
// (구 API 호환) ctx.p 본인 소스만 발화
async function fireTriggers(ev, ctx){ await fireEvent(ev, ctx); }
async function fireBfTrigger(bfIdx, ev, ctx){
  const bf=G.bfs[bfIdx];
  const fx=FX[bf.n];
  if(fx && fx.triggers && fx.triggers[ev]) await runTriggerList(fx.triggers[ev], ctx);
  else if(fx && fx.manual && fx.manual.length && (ev==='onConquerHere'||ev==='onHoldHere')){
    // 전장 카드에 수동 효과가 있으면 안내
    UI.manualNotice(card(bf.n));
  }
}
async function legendHook(p, hookName, ctx){
  const lfx=FX[G.players[p].legendN];
  if(!lfx || !lfx[hookName]) return;
  const hook=lfx[hookName];
  if(hook===true) return;
  if(hook.mayExhaustLegend){
    if(G.players[p].legendEx) return;
    const yes=await UI.confirmP(p, `[전설] ${card(G.players[p].legendN).ko}을(를) 탈진하고 효과를 발동할까요?`);
    if(!yes) return;
    G.players[p].legendEx=true;
  }
  await execOps(hook.ops, ctx);
}
async function legendHookTarget(p, hookName, ctx){
  const lfx=FX[G.players[p].legendN];
  if(!lfx || !lfx[hookName]) return;
  await execOps(lfx[hookName].ops, ctx);
}

// ---------- 발동형 능력 ----------
async function activateAbility(p, source, ab){
  // source: {kind:'unit',u} | {kind:'legend'} | {kind:'gear',g}
  const P=G.players[p];
  // 타이밍
  if(G.state==='showdown' && !(ab.reaction||ab.action)){ UI.toast('결전 중에는 [행동]/[반응] 능력만 발동할 수 있습니다','warn'); return; }
  if(G.state==='showdown' && G.showdown && G.showdown.chain.length && !ab.reaction){
    UI.toast('체인 진행 중에는 [반응] 능력만 발동할 수 있습니다','warn'); return; }
  if(G.state==='neutral' && G.turn!==p){ UI.toast('자신의 턴에만 발동할 수 있습니다','warn'); return; }
  if(ab.legion && !(P.playedCards>=1)){ UI.toast('[군단] 조건: 이번 턴에 카드를 플레이해야 합니다','warn'); return; }
  if(ab.onlyAtBf && source.kind==='unit' && source.u.loc==='base'){ UI.toast('전장에 있을 때만 사용할 수 있습니다','warn'); return; }

  const cost=ab.cost||{};
  // 탈진 비용
  if(cost.exhaustSelf){
    if(source.kind==='unit' && source.u.ex){ UI.toast('이미 탈진되었습니다','warn'); return; }
    if(source.kind==='legend' && P.legendEx){ UI.toast('전설이 이미 탈진되었습니다','warn'); return; }
    if(source.kind==='gear' && source.g.ex){ UI.toast('이미 탈진되었습니다','warn'); return; }
  }
  const pips=[...(cost.pips||[])]; for(let i=0;i<(cost.power||0);i++) pips.push('Any');
  if(!canPay(p, cost.energy||0, pips)){ UI.toast('자원이 부족합니다','warn'); return; }
  if(cost.killFriendlyOrGear && !everyUnit().some(u=>u.ctrl===p) && !P.gear.length){ UI.toast('처치할 아군 유닛/도구가 없습니다','warn'); return; }
  if(cost.recycleTrash && P.trash.length<cost.recycleTrash){ UI.toast('폐기장가 부족합니다','warn'); return; }
  if(cost.discard && P.hand.length<cost.discard){ UI.toast('손패가 부족합니다','warn'); return; }

  // 지불
  if(cost.exhaustSelf){
    if(source.kind==='unit') source.u.ex=true;
    else if(source.kind==='legend') P.legendEx=true;
    else if(source.kind==='gear') source.g.ex=true;
  }
  payCost(p, cost.energy||0, pips);
  if(cost.recycleTrash){
    // 재활용할 카드는 플레이어가 지정한다 (바이 36 등 — 무작위였던 것 수정)
    for(let i=0;i<cost.recycleTrash;i++){
      const sel=await UI.pickOption(p,'재활용할 카드 선택 (덱 맨 아래로)',P.trash.map((n,ti)=>({v:ti,label:card(n).ko,n})));
      const ti=(sel==null)?P.trash.length-1:sel;
      P.deck.push(P.trash.splice(ti,1)[0]);
    }
    UI.log(`${pname(p)} 폐기장에서 ${cost.recycleTrash}장 재활용`, 'p'+p);
  }
  if(cost.discard){
    for(let i=0;i<cost.discard;i++){
      const idx = await UI.pickHandCard(p, '버릴 카드를 선택하세요');
      if(idx!==null) await discardFromHand(p,idx);
    }
  }
  if(cost.spendBuff && source.kind==='unit'){
    if(source.u.buff<=0){ UI.toast('버프가 없습니다','warn'); return; }
    source.u.buff--;
  }
  if(cost.killFriendlyOrGear){
    // 아군 유닛 또는 도구 하나 처치 (말자하)
    const opts=[];
    everyUnit().filter(u=>u.ctrl===p).forEach(u=>opts.push({v:{t:'u',u},label:'유닛: '+unitName(u),card:unitCard(u)}));
    P.gear.forEach((g,i)=>opts.push({v:{t:'g',i},label:'도구: '+card(g.n).ko,n:g.n}));
    const sel=await UI.pickOption(p,'처치할 아군 유닛/도구 (비용)',opts);
    if(!sel) return;
    if(sel.t==='u') await killUnit(sel.u); else await killGear(p, sel.i);
  }
  if(cost.killSelfGear && source.kind==='gear'){
    const gi=P.gear.indexOf(source.g);
    if(gi>=0) await killGear(p, gi);
  }

  const srcName = source.kind==='legend'?card(P.legendN).ko : source.kind==='unit'?unitName(source.u) : card(source.g.n).ko;
  // ── 결전 중: 능력도 체인에 적재 (비용은 이미 지불됨 — 규칙 338.1.a.4) ──
  if(G.state==='showdown' && G.showdown){
    const sd=G.showdown;
    // [추가](Add) 자원 능력은 체인에 쌓이지 않고 즉시 해결된다 — 응수 불가, 우선권 유지 (규칙 333.1.c
    // "Abilities that Add resources... resolve immediately when Finalized" + 카드 리마인더 "반응할 수 없다").
    // 자원이 즉시 들어와야 같은 시점에 카드 비용 지불에 쓸 수 있다.
    const RESOURCE_OPS = new Set(['addEnergy','addPower']);
    if(ab.ops.length && ab.ops.every(o=>RESOURCE_OPS.has(o.op))){
      UI.log(`${pname(p)} 「${srcName}」 [추가] 능력 — 즉시 해결 (응수 불가)`, 'p'+p);
      await execOps(ab.ops, {p, unit:source.u, gear:source.g, kind:'ability',
        bfIdx:(source.u&&source.u.loc!=='base')?source.u.loc:null});
      sd.passes=0;                    // 행동했으므로 패스 시퀀스는 끊기지만, 우선권은 그대로 유지
      UI.render(); UI.promptShowdown();
      return;
    }
    sd.chain.push({kind:'ability', p, ab, unit:source.u, gear:source.g, srcName});
    if(sd.chain.length===1) sd.chainStarter=p;
    UI.fx.chainAdd(source.kind==='legend'?card(P.legendN):source.u?unitCard(source.u):card(source.g.n), p, sd.chain.length);
    UI.log(`🔗 ${pname(p)} 능력 「${srcName}」 체인에 적재 (#${sd.chain.length})`, 'p'+p);
    showdownActed(p);                 // 우선권은 적재자가 유지
    UI.render();
    return;
  }
  UI.fx.cast(source.kind==='legend'?card(P.legendN):source.u?unitCard(source.u):card(source.g.n), p, '능력');
  UI.log(`${pname(p)} 「${srcName}」 능력 발동`, 'p'+p);
  await execOps(ab.ops, {p, unit:source.u, gear:source.g, kind:'ability', bfIdx:(source.u&&source.u.loc!=='base')?source.u.loc:null});
  await cleanup(p);
  UI.render();
}

// ---------- 효과 op 실행기 ----------
// 꿈꾸는 나무(292): 주문으로 이곳의 아군 유닛을 턴 첫 선택 시 드로우.
// pickBySpec뿐 아니라 UI.pickUnitFrom을 직접 쓰는 커스텀 주문 op에서도 호출한다
function noteSpellPick(p, u){
  if(_curKind==='spell' && u && u.ctrl===p && u.loc!=='base' && FX[G.bfs[u.loc].n] && FX[G.bfs[u.loc].n].dreamingTree && !TF().bf292[p]){
    TF().bf292[p]=true; drawCard(p);
    UI.log(`「꿈꾸는 나무」: 카드 1장 드로우`, 'p'+p);
  }
}
async function pickBySpec(p, spec, promptText){
  // spec 필터로 대상 후보 구성
  let cands = everyUnit();
  if(spec.side==='friendly') cands=cands.filter(u=>u.ctrl===p);
  if(spec.side==='enemy') cands=cands.filter(u=>u.ctrl!==p);
  if(spec.other && _ctxUnit) cands=cands.filter(u=>u!==_ctxUnit);   // "다른 유닛": 효과 발생원 자신 제외
  if(spec._exclude && spec._exclude.length) cands=cands.filter(u=>!spec._exclude.includes(u)); // 복수 대상: 이미 고른 유닛 제외
  // 'here'는 효과 발생 위치(_ctxBf)가 있으면 그쪽 우선 — 결전 중 다른 전장에서 죽은
  // 유닛의 죽음의 종소리가 결전 전장을 잘못 가리키지 않게 한다
  if(spec.where==='here' && _ctxBf!==null) cands=cands.filter(u=>u.loc===_ctxBf);
  else if(spec.where==='here' && G.showdown) cands=cands.filter(u=>u.loc===G.showdown.bfIdx);
  if(spec.where==='bf') cands=cands.filter(u=>u.loc!=='base');
  if(spec.where==='base') cands=cands.filter(u=>u.loc==='base');
  // 'in combat' = 진행 중인 전투 결전 전장의 유닛만 (전투가 없으면 대상 없음)
  if(spec.where==='combat') cands=cands.filter(u=>G.showdown && u.loc===G.showdown.bfIdx);
  if(spec.mightMax!==undefined) cands=cands.filter(u=>might(u)<=spec.mightMax);
  if(spec.mightMin!==undefined) cands=cands.filter(u=>might(u)>=spec.mightMin);
  if(spec.champion) cands=cands.filter(u=>!u.isToken&&card(u.n).super==='Champion');
  if(spec.buffed) cands=cands.filter(u=>u.buff>0);
  if(spec.exhausted) cands=cands.filter(u=>u.ex);
  if(spec.damaged) cands=cands.filter(u=>u.dmg>0);
  if(spec.stunned) cands=cands.filter(u=>u.stunned);
  if(!cands.length) return spec.count==='all'?[]:null;
  if(spec.count==='all') return cands;
  const u = await UI.pickUnitFrom(p, cands, promptText, spec.optional);
  if(!u) return null;
  noteSpellPick(p, u);
  // 굴절 비용
  if(u.ctrl!==p){
    const defl=effKw(u).deflect;
    if(defl){
      const pips=[]; for(let i=0;i<defl;i++) pips.push('Any');
      if(!canPay(p,0,pips)){ UI.toast(`[굴절 ${defl}] 힘가 부족해 선택할 수 없습니다`,'warn'); return null; }
      const yes=await UI.confirmP(p,`[굴절 ${defl}] 힘 ${defl}를 추가 지불해야 합니다. 지불할까요?`);
      if(!yes) return null;
      payCost(p,0,pips);
    }
  }
  return u;
}

// 전장 상시: 주문/능력 피해 +1
// 효과·주문 피해의 추가 피해. u=피해 대상, srcP=피해를 입히는 쪽(주문/능력의 시전자)
function effDmgBonus(u, srcP){
  let b = (u.loc!=='base' && G.bfs[u.loc] && G.bfs[u.loc].n===BF_STATIC.BONUS_DMG)?1:0;
  // 애니 - 불같은(OGS 301): 내 주문·능력의 각 피해 +1 — 보드에 있는 동안
  if(srcP!==undefined && srcP!==null &&
     everyUnit().some(x=>x.ctrl===srcP && unitFx(x).spellBonusAll)) b+=1;
  return b;
}

let _ctxBf = null;
let _ctxUnit = null;   // 효과 발생원 유닛 — "다른(another)" 대상 제한에서 자기 자신 제외용
let _curKind = 'effect';
async function execOps(ops, ctx){
  if(G.winner!==null) return;
  const p=ctx.p;
  _ctxBf = ctx.bfIdx??null;
  _ctxUnit = ctx.unit??null;
  _curKind = ctx.kind||'effect';
  let it = ctx.it||null;
  for(const op of ops){
    if(G.winner!==null) return;
    switch(op.op){
      case 'draw': for(let i=0;i<op.n;i++) drawCard(p); break;
      case 'drawEach': for(let i=0;i<op.n;i++){ drawCard(0); drawCard(1); } break;
      case 'drawIfHandLE': if(G.players[p].hand.length<=op.limit) for(let i=0;i<op.n;i++) drawCard(p); break;
      case 'damage': {
        const u=await pickBySpec(p, op.spec, `피해 ${op.n}을 줄 대상 선택`);
        if(u){ const d=dealDamage(u, op.n+effDmgBonus(u, p), _curKind); it=u; UI.log(`${unitName(u)}에게 피해 ${d}`, 'combat'); }
        break; }
      case 'damageAll': {
        if(typeof op.spec.count==='number'){
          // "each of up to N units" — N개까지 골라 각각 피해 (optional이면 중도 중단 가능)
          const picked=[];
          for(let i=0;i<op.spec.count;i++){
            const u=await pickBySpec(p,{...op.spec,count:1,_exclude:picked},`피해 ${op.n} 대상 선택 (${i+1}/${op.spec.count})`);
            if(!u) break;
            picked.push(u);
          }
          picked.forEach(u=>{ dealDamage(u, op.n+effDmgBonus(u, p), _curKind); });
          if(picked.length) UI.log(`대상 ${picked.length}개에게 각 피해 ${op.n}`, 'combat');
        } else {
          const us=await pickBySpec(p,{...op.spec,count:'all'});
          us.forEach(u=>{ dealDamage(u, op.n+effDmgBonus(u, p), _curKind); });
          UI.log(`대상 전체(${us.length})에게 피해 ${op.n}`, 'combat');
        }
        break; }
      case 'dealSplit': {
        let remain=op.n;
        while(remain>0){
          const cands=everyUnit().filter(u=>u.ctrl!==p && (op.spec.where!=='here'||u.loc===_ctxBf));
          if(!cands.length) break;
          const u=await UI.pickUnitFrom(p,cands,`분할 피해: 대상 선택 (남은 피해 ${remain})`);
          if(!u) break;
          const amt=await UI.pickNumber(p,`「${unitName(u)}」에게 줄 피해 (1~${remain})`,1,remain);
          dealDamage(u, amt, _curKind); remain-=amt;
          UI.log(`${unitName(u)}에게 피해 ${amt}`, 'combat');
        }
        break; }
      case 'kill': {
        const u=await pickBySpec(p, op.spec, '처치할 유닛 선택');
        if(u){ it=u; await killUnit(u); }
        break; }
      case 'killAll': {
        const us=await pickBySpec(p,{...op.spec,count:'all'});
        for(const u of us) await killUnit(u);
        break; }
      case 'killSelf': if(ctx.unit && !ctx.unit._dead) await killUnit(ctx.unit); break;
      case 'killIt': if(it && !it._dead) await killUnit(it); break;
      case 'eachPlayerKills': {
        for(const pi of [G.turn, opp(G.turn)]){
          const mine=everyUnit().filter(u=>u.ctrl===pi);
          if(!mine.length) continue;
          const u=await UI.pickUnitFrom(pi,mine,`${pname(pi)}: 처치할 자신의 유닛 선택`);
          if(u) await killUnit(u);
        }
        break; }
      case 'buffSelf': if(ctx.unit){ await buffUnit(ctx.unit, p); } break;
      case 'buffIt': if(it){ await buffUnit(it, p); } break;
      case 'buff': {
        if(op.spec && op.spec.count==='all'){
          const us=await pickBySpec(p, op.spec);
          for(const u of us) await buffUnit(u, p);
          break;
        }
        // "유닛 N개를 골라 버프" — 서로 다른 유닛이어야 하므로 이미 고른 대상은 후보에서 제외
        const picked=[];
        for(let i=0;i<(op.count||1);i++){
          const u=await pickBySpec(p, {...op.spec, _exclude:picked}, `버프할 유닛 선택${op.count>1?` (${i+1}/${op.count})`:''}`);
          if(!u) break;                    // '선택 안 함'(최대 N개) 또는 후보 소진
          picked.push(u);
          await buffUnit(u, p); it=u;
        }
        break; }
      case 'might': {
        let targets=[];
        if(op.self && ctx.unit) targets=[ctx.unit];
        else if(op.it && (it||ctx.it)) targets=[it||ctx.it];
        else if(op.all){ targets=await pickBySpec(p,{...op.spec,count:'all'}); }
        else { const u=await pickBySpec(p, op.spec, `위력 ${op.n>0?'+':''}${op.n} 대상 선택`); if(u){targets=[u]; it=u;} }
        targets.forEach(u=>{ u.tempM.push({v:op.n, dur:'turn', min:op.min}); UI.log(`${unitName(u)} 위력 ${op.n>0?'+':''}${op.n} (이번 턴)`, 'p'+p); });
        break; }
      case 'grantKw': {
        let u=null;
        if(op.who==='me') u=ctx.unit;
        else if(op.who==='it') u=it;
        else u=await pickBySpec(p,{type:'unit',side:op.who.includes('friendly')?'friendly':'any',where:'any',count:1},'키워드를 부여할 유닛 선택');
        if(u){
          op.kws.forEach(([kw,v])=>{
            const key=kw.toLowerCase().replace('-','');
            const numeric=(typeof unitFx(u).kw[key]==='number'||['assault','shield','deflect'].includes(key));
            // 수치 키워드는 거듭 부여 시 '합산' (룰 733/735/740 — 덮어쓰기 아님)
            if(numeric) u.grants[key]=(typeof u.grants[key]==='number'?u.grants[key]:0)+v;
            else u.grants[key]=true;
            UI.log(`${unitName(u)}에게 [${KEYWORDS_KO[kw]?.ko||kw}${v>1?' '+v:''}] 부여 (이번 턴)`, 'p'+p);
          });
          it=u;
        }
        break; }
      case 'stun': {
        const u=await pickBySpec(p, {...op.spec, side: op.spec.side==='any'?'enemy':op.spec.side}, '기절할 유닛 선택');
        if(u && !u.stunned){ u.stunned=true; it=u; UI.log(`${unitName(u)} 기절됨 💫`, 'p'+p);
          await legendHook(p,'hookYouStun',{p});
          await fireEvent('onYouStun',{p}); }
        break; }
      case 'stunAll': {
        const us=await pickBySpec(p,{...op.spec,count:'all'});
        let any=false;
        us.forEach(u=>{ if(!u.stunned){u.stunned=true;any=true;} });
        if(any){ await legendHook(p,'hookYouStun',{p}); await fireEvent('onYouStun',{p}); }
        break; }
      case 'channel': channelRunes(p, op.n, op.exhausted); break;
      case 'addEnergy': G.players[p].energy+=op.n; UI.log(`${pname(p)} 에너지 +${op.n}`, 'p'+p); break;
      case 'addPower': G.players[p].power[op.dom]+=op.n; UI.log(`${pname(p)} 힘 +${op.n}`, 'p'+p); break;
      case 'token': {
        let loc='base';
        if(op.where==='here' && _ctxBf!==null) loc=_ctxBf;
        else if(op.where==='at a battlefield'){
          const sel=await UI.pickOption(p,'토큰을 배치할 전장',G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko})).concat([{v:'base',label:'기지'}]));
          if(sel!==null) loc=sel;
        }
        for(let i=0;i<op.count;i++){
          const u=makeUnit(0,p,{loc,isToken:true,tokenMight:op.might,tokenName:op.name,ready:op.ready});
          if(op.temp) u.grants.temporary=true;
          placeUnit(u,loc);
        }
        UI.log(`${pname(p)} ${op.might}⚔ ${op.name==='Recruit'?'신병':op.name} 토큰 ${op.count}개 플레이`, 'p'+p);
        break; }
      case 'recallSelf': if(ctx.unit){ removeUnit(ctx.unit); placeUnit(ctx.unit,'base'); UI.log(`${unitName(ctx.unit)} 기지으로 귀환`, 'p'+p); } break;
      case 'recallIt': if(it){ removeUnit(it); placeUnit(it,'base'); } break;
      case 'recall': {
        const u=await pickBySpec(p, op.spec, '기지으로 되돌릴 유닛 선택');
        if(u){ removeUnit(u); placeUnit(u,'base'); it=u; UI.log(`${unitName(u)} 기지으로 귀환`, 'p'+p); }
        break; }
      case 'recallAll': {
        const us=await pickBySpec(p,{...op.spec,count:'all'});
        us.forEach(u=>{ removeUnit(u); placeUnit(u,'base'); });
        break; }
      case 'moveUnit': {
        const u=await pickBySpec(p, op.spec, '이동시킬 유닛 선택');
        if(u){
          let dest;
          if(op.to==='here') dest=_ctxBf;
          else if(op.to==='its base') dest='base';
          else dest=await UI.pickOption(p,'이동할 전장',G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko})));
          // effectMove 경유 — 이동 횟수(turnMoves)와 이동 트리거(케인·야스오 등)에 반영
          if(dest!==null){ await effectMove(p, u, dest); it=u; }
        }
        break; }
      case 'bounce': {
        let u=null;
        if(op.who==='me') u=ctx.unit; else if(op.who==='it') u=it;
        else u=await pickBySpec(p,{type:'unit',side:op.who.includes('enemy')?'enemy':'any',where:'any',count:1},'손패로 되돌릴 유닛 선택');
        if(u && !u.isToken){
          removeUnit(u); G.players[u.ctrl].hand.push(u.n);
          UI.log(`${unitName(u)} 손패로 돌아감`, 'p'+p);
        } else if(u&&u.isToken){ removeUnit(u); }
        break; }
      case 'readySelf': if(ctx.unit){ await readyUnit(ctx.unit, p); } break;
      case 'readyIt': if(it){ await readyUnit(it, p); } break;
      case 'ready': {
        if(op.spec.count==='all'){
          const us=await pickBySpec(p, op.spec);
          for(const u of us) await readyUnit(u, p);
          break;
        }
        const u=await pickBySpec(p, op.spec, '준비시킬 유닛 선택');
        if(u){ await readyUnit(u, p); it=u; }
        break; }
      case 'readyLegend': G.players[p].legendEx=false; UI.log(`${pname(p)} 전설 준비됨`, 'p'+p); break;
      case 'exhaustSelf': if(ctx.unit) ctx.unit.ex=true; break;
      case 'exhaust': {
        const spec={...op.spec, side:op.spec.side==='any'?'enemy':op.spec.side};
        if(spec.count==='all'){
          const us=await pickBySpec(p,spec);
          us.forEach(u=>{ u.ex=true; });
          if(us.length) UI.log(`유닛 ${us.length}개 탈진됨`, 'p'+p);
          break;
        }
        const u=await pickBySpec(p, spec, '탈진시킬 유닛 선택');
        if(u){ u.ex=true; it=u; UI.log(`${unitName(u)} 탈진됨`, 'p'+p); }
        break; }
      case 'discard': {
        for(let i=0;i<op.n;i++){
          if(!G.players[p].hand.length) break;
          const idx=await UI.pickHandCard(p,'버릴 카드를 선택하세요');
          if(idx!==null) await discardFromHand(p,idx);
        }
        break; }
      case 'discardOpp': {
        const o=opp(p);
        for(let i=0;i<op.n;i++){
          if(!G.players[o].hand.length) break;
          const idx=await UI.pickHandCard(o,'버릴 카드를 선택하세요');
          if(idx!==null) await discardFromHand(o,idx);
        }
        break; }
      case 'scorePoint': addPoints(p,1,'effect'); break;
      case 'heal': if(op.self&&ctx.unit) ctx.unit.dmg=0; else if(it) it.dmg=0; break;
      case 'healUnits': {
        if(op.all) everyUnit().filter(u=>u.ctrl===p).forEach(u=>u.dmg=0);
        else { const u=await pickBySpec(p,{type:'unit',side:'friendly',where:'any',count:1},'치유할 유닛 선택'); if(u)u.dmg=0; }
        break; }
      // ── 전설 전용 특수 op ──
      case 'yasuoMove': {
        const mine=everyUnit().filter(u=>u.ctrl===p);
        const u=await UI.pickUnitFrom(p,mine,'이동시킬 아군 유닛 선택');
        if(u){
          // effectMove 경유 — 이동 횟수·이동 트리거 반영 (야스오 205의 3회 이동 득점 등)
          if(u.loc==='base'){
            const sel=await UI.pickOption(p,'이동할 전장',G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko})));
            if(sel!==null){ await effectMove(p, u, sel); UI.log(`(전설 능력)`, 'p'+p); }
          } else { await effectMove(p, u, 'base'); UI.log(`(전설 능력)`, 'p'+p); }
        }
        break; }
      case 'teemoFetch': {
        const P=G.players[p];
        const opts=[];
        if(P.champInZone && card(P.champN).tags.includes('Teemo')) opts.push({v:'zone',label:'챔피언 존의 '+card(P.champN).ko,n:P.champN});
        everyUnit().filter(u=>u.ctrl===p&&!u.isToken&&card(u.n).tags.includes('Teemo')).forEach(u=>opts.push({v:u,label:unitName(u),card:unitCard(u)}));
        if(!opts.length){ UI.toast('티모 유닛이 없습니다','warn'); break; }
        const sel=await UI.pickOption(p,'손패로 가져올 티모 유닛',opts);
        if(sel==='zone'){ P.champInZone=false; P.hand.push(P.champN); }
        else if(sel){ removeUnit(sel); P.hand.push(sel.n); }
        UI.log(`${pname(p)} 티모 유닛을 손패로 가져옴`, 'p'+p);
        break; }
      // ── 선택/조건부 실행 ──
      case 'optional': {
        const yes=await UI.confirmP(p,'선택 효과를 실행할까요?');
        if(yes) await execOps([op.inner], {...ctx, it});
        break; }
      case 'payThen': {
        if(!canPay(p,op.energy,[])) break;
        const yes=await UI.confirmP(p,`에너지 ${op.energy}를 지불하고 효과를 실행할까요?`);
        if(yes){ payCost(p,op.energy,[]); await execOps([op.inner], {...ctx, it}); }
        break; }
      case 'spendBuffThen': {
        const cands=everyUnit().filter(u=>u.ctrl===p&&u.buff>0);
        if(!cands.length) break;
        const yes=await UI.confirmP(p,'버프를 소모하고 효과를 실행할까요?');
        if(!yes) break;
        const u=cands.length===1?cands[0]:await UI.pickUnitFrom(p,cands,'버프를 소모할 유닛 선택');
        if(u){ u.buff--; await execOps([op.inner], {...ctx, it}); }
        break; }
      case 'chooseOne': {
        const labels=op.branches.map((b,i)=>({v:i,label:`선택지 ${i+1}: ${describeOps(b)}`}));
        const sel=await UI.pickOption(p,'하나를 선택하세요',labels);
        if(sel!==null) await execOps(op.branches[sel], {...ctx, it});
        break; }
      case 'chooseUnit': {
        const u=await pickBySpec(p, op.spec, '유닛 선택');
        if(u) it=u;
        break; }
      // ── 룬/득점 유틸 ──
      case 'readyRunes': {
        const cnt = await readyRunesPick(p, op.n, op.optional);
        if(cnt) UI.log(`${pname(p)} 룬 ${cnt}개 준비됨`, 'p'+p);
        break; }
      case 'recycleRune': {
        const P=G.players[p];
        if(P.runes.length){
          const r=P.runes.pop(); P.runeDeck.push(r.n);
          UI.log(`${pname(p)} 룬 1개 재활용 (강제)`, 'p'+p);
        }
        break; }
      case 'gainPoints': addPoints(p,op.n,'effect'); break;
      case 'champBack': {
        const P=G.players[p];
        if(!P.champInZone && P.trash.includes(P.champN)){
          const yes=await UI.confirmP(p,`폐기장의 챔피언 「${card(P.champN).ko}」을(를) 챔피언 존으로 되돌릴까요?`);
          if(yes){ P.trash.splice(P.trash.indexOf(P.champN),1); P.champInZone=true;
            UI.log(`${pname(p)} 챔피언이 챔피언 존으로 귀환`, 'p'+p); }
        }
        break; }
      case 'conquerEffectsHere': {
        if(_ctxBf!==null){
          for(const u of G.bfs[_ctxBf].units.filter(u=>u.ctrl===p)){
            await runTriggerList(unitFx(u).triggers?.onConquer, {p, unit:u, bfIdx:_ctxBf});
          }
        }
        break; }
      case 'scryTop': {
        // 촛불 밝힌 성소(291): 맨 위 n장을 '동시에' 본 뒤 원하는 만큼 재순환(덱 맨 아래),
        // 남긴 카드는 원하는 순서로 맨 위에 되돌린다 — 한 장씩 보고 중간에 끊는 방식은 원문과 다름
        const P=G.players[p];
        const seen=P.deck.slice(0, op.n);
        if(!seen.length) break;
        P.deck.splice(0, seen.length);
        const names=seen.map(n=>`「${card(n).ko}」`).join(' · ');
        const keep=[]; let rec=false;
        for(const n of seen){
          const yes=await UI.confirmP(p, `덱 위 ${seen.length}장: ${names} — 「${card(n).ko}」를 재순환(덱 맨 아래)할까요?`, card(n));
          if(yes){ P.deck.push(n); rec=true; } else keep.push(n);
        }
        // 남긴 카드가 2장 이상이면 되돌릴 순서를 고른다 (위에 둘 카드부터)
        const order=[];
        while(keep.length>1){
          const sel=await UI.pickOption(p, '덱 맨 위에 둘 카드부터 차례로 선택', keep.map((n,i)=>({v:i, label:card(n).ko, n})));
          const i=(sel==null)?0:sel;
          order.push(keep.splice(i,1)[0]);
        }
        order.push(...keep);
        for(let i=order.length-1;i>=0;i--) P.deck.unshift(order[i]);
        if(rec) await fireEvent('onYouRecycle',{p});
        break; }
      case 'winIf7Here': {
        if(_ctxBf!==null && G.bfs[_ctxBf].units.filter(u=>u.ctrl===p).length>=7){
          G.players[p].points=G.victory; checkWin();
        }
        break; }
      // ── 턴 플래그 설정 ──
      case 'setFlag': {
        const tf=TF();
        const tgt = op.side==='opp' ? opp(p) : p;
        if(op.global) tf[op.flag]=op.val!==undefined?op.val:true;
        else if(op.add!==undefined) tf[op.flag][tgt]=(tf[op.flag][tgt]||0)+op.add;
        else tf[op.flag][tgt]=op.val!==undefined?op.val:true;
        break; }
      case 'extraTurn': G.extraTurnFor=p; UI.log(`⏳ ${pname(p)}: 이 턴이 끝나면 추가 턴!`, 'score'); break;
      case 'banishSelf': G._banishSpell=true; break;
      default: {
        // 카드별 전용 op (cardscripts.js)
        if(typeof EXTRA_OPS!=='undefined' && EXTRA_OPS[op.op]){
          const saveBf=_ctxBf, saveKind=_curKind, saveUnit=_ctxUnit;
          await EXTRA_OPS[op.op](op, {...ctx, it}, {it:()=>it, setIt:(v)=>{it=v;}});
          _ctxBf=saveBf; _curKind=saveKind; _ctxUnit=saveUnit;
        }
        else UI.log(`(자동화 미지원 op: ${op.op})`, 'sys');
      }
    }
    UI.render();
  }
  _ctxBf=null;
}

// op 목록을 한글 요약으로
function describeOps(ops){
  return ops.map(o=>{
    switch(o.op){
      case 'draw': return `카드 ${o.n}장 뽑기`;
      case 'damage': return `피해 ${o.n}`;
      case 'damageAll': return `전체 피해 ${o.n}`;
      case 'kill': return '유닛 처치';
      case 'killAll': return '전체 처치';
      case 'buff': return '버프';
      case 'might': return `위력 ${o.n>0?'+':''}${o.n}`;
      case 'stun': return '기절';
      case 'channel': return `룬 ${o.n}개 전개`;
      case 'token': return `${o.might}⚔ 토큰 ${o.count}개`;
      case 'recall': return '유닛 기지 귀환';
      case 'bounce': return '손패로 되돌림';
      case 'discard': return `${o.n}장 버리기`;
      case 'discardOpp': return `상대 ${o.n}장 버리기`;
      case 'exhaust': return '유닛 탈진';
      case 'ready': return '유닛 준비';
      default: return o.op;
    }
  }).join(' → ');
}

// ---------- 도구 장착 ----------
async function equipGear(p, gearIdx){
  const P=G.players[p];
  const g=P.gear[gearIdx]; if(!g) return;
  const fx=FX[g.n]||{};
  if(fx.equipCost===undefined) return;
  if(!canPay(p,fx.equipCost,[])){ UI.toast('자원이 부족합니다','warn'); return; }
  const mine=everyUnit().filter(u=>u.ctrl===p&&!u.isToken);
  const u=await UI.pickUnitFrom(p,mine,'장착할 유닛 선택',true);
  if(!u) return;
  payCost(p,fx.equipCost,[]);
  u.gear.push(g.n);
  const gi=P.gear.indexOf(g); if(gi>=0)P.gear.splice(gi,1);
  UI.log(`${pname(p)} 「${card(g.n).ko}」를 ${unitName(u)}에 장착`, 'p'+p);
  UI.render();
}

// ---------- 수동 도구 ----------
const ManualTools = {
  damage(u,n){ u.dmg+=n; UI.log(`(수동) ${unitName(u)} 피해 ${n}`, 'sys'); cleanup(G.turn).then(()=>UI.render()); },
  heal(u){ u.dmg=0; UI.render(); },
  buff(u){ if(u.buff<1 || unitFx(u).multiBuff){ u.buff++; UI.log(`(수동) ${unitName(u)} 버프`, 'sys'); } UI.render(); },
  unbuff(u){ u.buff=Math.max(0,u.buff-1); UI.render(); },
  might(u,n){ u.tempM.push({v:n,dur:'turn'}); UI.log(`(수동) ${unitName(u)} 위력 ${n>0?'+':''}${n}`, 'sys'); UI.render(); },
  kill(u){ killUnit(u).then(()=>UI.render()); },
  stun(u){ u.stunned=!u.stunned; UI.render(); },
  toggleEx(u){ u.ex=!u.ex; UI.render(); },
  bounce(u){ if(!u.isToken){ removeUnit(u); G.players[u.ctrl].hand.push(u.n);} else removeUnit(u); UI.log(`(수동) ${unitName(u)} 손패로`, 'sys'); UI.render(); },
  draw(p){ drawCard(p); UI.render(); },
  energy(p,n){ G.players[p].energy+=n; UI.render(); },
  power(p){ G.players[p].power.Any+=1; UI.render(); },
  point(p,n){ G.players[p].points=Math.max(0,Math.min(G.victory,G.players[p].points+n)); checkWin(); UI.render(); },
  channel(p){ channelRunes(p,1); UI.render(); },
  discardIdx(p,idx){ if(G.players[p].hand[idx]!==undefined){ discardFromHand(p,idx); UI.render(); } },
  trashGear(p,gearIdx){ const g=G.players[p].gear[gearIdx]; if(g){ G.players[p].gear.splice(gearIdx,1); trashCard(p,g.n); UI.render(); } },
  legendToggle(p){ G.players[p].legendEx=!G.players[p].legendEx; UI.render(); },
};
