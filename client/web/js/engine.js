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
    players: cfg.players.map((pc,i)=>({
      idx:i, name:pc.name, legendN:pc.legendN, legendEx:false,
      champN:pc.champN, champInZone:true,
      deck:shuffle([...pc.deck]), hand:[], trash:[], banish:[],
      runeDeck:shuffle([...pc.runes]), runes:[],
      base:[], gear:[],
      points:0, energy:0, power:{Fury:0,Calm:0,Mind:0,Body:0,Order:0,Chaos:0,Any:0},
      playedCards:0, scoredBf:{}, drewFromEmpty:false,
    })),
    bfs: cfg.bfs.map((n,i)=>({ n, owner:i, controller:null, units:[], hiddenCards:[], scored:{} })),
    turn:0, turnCount:0, phase:'setup', state:'neutral',
    showdown:null, winner:null, actingPlayer:0,
  };
  // 전장 상시: 승리 점수 +1
  G.victory = VICTORY + G.bfs.filter(bf=>bf.n===BF_STATIC.VICTORY_PLUS).length;
  // 시작 손패 4장
  G.players.forEach(p=>{ for(let i=0;i<4;i++) drawCard(p.idx, true); });
}

// ---------- 유닛 인스턴스 ----------
function makeUnit(n, ctrl, opts={}){
  const c = card(n);
  return {
    uid:UID++, n, ctrl,
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
  enemyDied:[false,false], freeHide:[false,false], dmgKill:false, bf292:[false,false],
  udyrUsed:{}, _once:{},
}; }
function TF(){ return (G && (G.tflags || (G.tflags=freshTF()))) || freshTF(); }

// ---------- 상시(정적) 효과 레이어 ----------
// 보드의 유닛/장비/전장이 제공하는 statics를 순회한다.
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

// 유효 전투력 (전투 상황 반영)
function might(u, combatRole){
  if(u.stunned && combatRole) return 0;
  const c = unitCard(u);
  let m = (u.isToken? u.tokenMight : (c.m||0)) + u.buff;
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
  // 전장 상시: 이곳 유닛 [갱킹]
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
function placeUnit(u, loc){
  u.loc=loc;
  if(loc==='base') G.players[u.ctrl].base.push(u);
  else G.bfs[loc].units.push(u);
}

// ---------- 드로우/파기 ----------
function drawCard(p, silent){
  const P=G.players[p];
  if(P.deck.length===0){ burnOut(p); }
  const n=P.deck.shift();
  if(n!==undefined){ P.hand.push(n); if(!silent) UI.log(`${pname(p)} 카드 1장 드로우`, 'p'+p); }
  checkWin();
}
function burnOut(p){
  const P=G.players[p];
  UI.log(`⚠️ ${pname(p)} 번아웃! 파기 더미를 덱으로 되돌리고 상대가 1점을 얻습니다.`, 'sys');
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
    // 최종 득점 제한
    if(P.points===V-1){
      if(method==='hold'){ P.points++; }
      else {
        const scoredAll = G.bfs.every((bf,i)=>P.scoredBf[i]);
        if(scoredAll){ P.points++; }
        else {
          UI.log(`${pname(p)} 최종 득점 조건 미달(모든 전장 미득점) → 대신 카드 1장 드로우`, 'score');
          drawCard(p);
          return;
        }
      }
    } else P.points = Math.min(V, P.points+n);
  } else {
    P.points = Math.min(V, P.points+n);
  }
  UI.log(`🏆 ${pname(p)} ${method==='conquer'?'정복':method==='hold'?'점유':'효과'} 득점! (${P.points}점)`, 'score');
  checkWin();
}
function checkWin(){
  G.players.forEach(P=>{ if(P.points>=G.victory && G.winner===null){ G.winner=P.idx; UI.showVictory(P.idx); } });
}

// ---------- 자원(룬) ----------
function readyRunes(p){ return G.players[p].runes.filter(r=>!r.ex); }
function channelRunes(p, n, exhausted){
  const P=G.players[p];
  for(let i=0;i<n;i++){
    const rn=P.runeDeck.shift();
    if(rn===undefined) break;
    P.runes.push({n:rn, ex:!!exhausted});
  }
  UI.log(`${pname(p)} 룬 ${n}개 충전${exhausted?' (소진 상태)':''}`, 'p'+p);
}
function runeDomain(n){ const c=card(n); return c.dom[0]||'Colorless'; }

// 지불 가능성 검사: energy + powerPips(도메인 배열, 'Any' 포함)
function canPay(p, energy, pips){
  const P=G.players[p];
  let poolE = P.energy;
  const poolP = {...P.power};
  const runes = P.runes.map(r=>({...r}));
  // 파워 핍: 풀 → 소진 룬 재충전 → 준비 룬 재충전 순으로 가상 할당
  for(const pip of pips){
    if(pip==='Any'){
      const anyDom = Object.keys(poolP).find(d=>poolP[d]>0);
      if(anyDom){ poolP[anyDom]--; continue; }
      let ri = runes.findIndex(r=>r.ex && !r.used);
      if(ri<0) ri = runes.findIndex(r=>!r.used);
      if(ri<0) return false;
      runes[ri].used=true;
    } else {
      if(poolP[pip]>0){ poolP[pip]--; continue; }
      if(poolP.Any>0){ poolP.Any--; continue; }
      let ri = runes.findIndex(r=>r.ex && !r.used && runeDomain(r.n)===pip);
      if(ri<0) ri = runes.findIndex(r=>!r.used && runeDomain(r.n)===pip);
      if(ri<0) return false;
      runes[ri].used=true;
    }
  }
  const readyLeft = runes.filter(r=>!r.ex && !r.used).length;
  return poolE + readyLeft >= energy;
}

// 실제 지불 (canPay 선행 가정)
function payCost(p, energy, pips, silent){
  const P=G.players[p];
  const recycled=[];
  for(const pip of pips){
    if(pip!=='Any' && P.power[pip]>0){ P.power[pip]--; continue; }
    if(pip==='Any'){
      const d=Object.keys(P.power).find(d=>P.power[d]>0);
      if(d){ P.power[d]--; continue; }
    } else if(P.power.Any>0){ P.power.Any--; continue; }
    // 룬 재충전
    let match = r=> pip==='Any' ? true : runeDomain(r.n)===pip;
    let ri = P.runes.findIndex(r=>r.ex && match(r));
    if(ri<0) ri = P.runes.findIndex(match);
    if(ri>=0){
      const r=P.runes.splice(ri,1)[0];
      P.runeDeck.push(r.n); recycled.push(card(r.n).ko);
    }
  }
  let need = energy;
  const useE = Math.min(P.energy, need); P.energy-=useE; need-=useE;
  for(const r of P.runes){ if(need<=0) break; if(!r.ex){ r.ex=true; need--; } }
  if(!silent && (energy||pips.length))
    UI.log(`${pname(p)} 비용 지불: 에너지 ${energy}${pips.length?' + 파워 '+pips.length:''}${recycled.length?' (룬 재충전: '+recycled.join(', ')+')':''}`, 'p'+p);
}

// 카드의 파워 핍 목록
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
  for(const p of [0,1]){
    const P=G.players[p];
    if(!P.hand.length) continue;
    const idxs = await UI.pickMulligan(p);
    if(idxs && idxs.length){
      const back=[];
      [...idxs].slice(0,2).sort((a,b)=>b-a).forEach(i=>{ const n=P.hand.splice(i,1)[0]; if(n!==undefined) back.push(n); });
      for(let i=0;i<back.length;i++) drawCard(p, true);  // 먼저 뽑고
      P.deck.push(...back);                              // 빼둔 카드는 덱 맨 아래로 (섞지 않음)
      UI.log(`${pname(p)} 멀리건: ${back.length}장 교체 (덱 아래로 재활용)`, 'sys');
    } else {
      UI.log(`${pname(p)} 멀리건 없이 시작`, 'sys');
    }
    UI.render();
  }
}

// ---------- 턴 진행 ----------
async function startTurn(){
  const p = G.turn, P = G.players[p];
  G.turnCount++;
  P.playedCards=0; P.scoredBf={};
  G.bfs.forEach(bf=>bf.scored={});
  G.tflags=freshTF();
  everyUnit().forEach(u=>{ u.turnMoves=0; u._armory=false; });
  G.phase='awaken'; UI.render();
  UI.log(`━━ ${pname(p)}의 턴 ${Math.ceil(G.turnCount/2)} ━━`, 'sys');

  // A: 각성 — 룬/유닛/장비/전설 모두 준비 (공식: Ready all your Runes, Units, and Gear)
  P.legendEx=false; P.legendUsed=false;
  P.runes.forEach(r=>r.ex=false);
  allUnits(p).forEach(u=>{ u.ex=false; });
  P.gear.forEach(g=>{ g.ex=false; });
  UI.render();

  // B: 시작 단계 — [일시] 처치 (득점 전) → 점유 득점 → 시작 트리거 (공식 순서)
  G.phase='beginning'; UI.render();
  for(const u of everyUnit().filter(u=>u.ctrl===p && effKw(u).temporary)){
    UI.log(`[일시] ${unitName(u)} 처치됨`, 'sys');
    await killUnit(u);
  }
  // 점유(Hold) 득점
  for(let i=0;i<G.bfs.length;i++){
    const bf=G.bfs[i];
    if(bf.controller===p && G.winner===null){
      P.scoredBf[i]=true; bf.scored[p]=true;
      addPoints(p,1,'hold',i);
      await fireTriggers('onHold', {p, bfIdx:i});
      await fireBfTrigger(i,'onHoldHere',{p,bfIdx:i});
    }
  }
  if(G.winner!==null) return;
  // 시작 트리거 (전장 첫 시작 단계 포함)
  if(G.turnCount<=2){
    for(let i=0;i<G.bfs.length;i++)
      await fireBfTrigger(i,'onFirstBeginning',{p, bfIdx:i});
  }
  await fireTriggers('onBeginning', {p});
  if(G.winner!==null) return;

  // C: 충전
  G.phase='channel'; UI.render();
  const chN = (G.turnCount===2)?3:2;
  channelRunes(p, chN);

  // D: 드로우
  G.phase='draw'; UI.render();
  drawCard(p);

  // 룬 풀 비우기
  P.energy=0; Object.keys(P.power).forEach(k=>P.power[k]=0);

  G.phase='action'; G.state='neutral';
  G.actingPlayer=p; // 이전 턴 격돌 해결 시점의 행동 권한이 남지 않도록 턴 주인으로 초기화
  UI.render();
  UI.prompt(`${pname(p)}의 행동 단계 — 카드 플레이 / 이동 / 능력 발동 / 턴 종료`);
}

async function endTurn(){
  const p=G.turn, P=G.players[p];
  // 턴 종료 트리거 (소나, 눈부신 오로라 등)
  await fireEvent('onEndTurn', {p});
  // 종료 단계: 스턴 해제, 지속 효과 만료, 표시 피해 제거, 풀 비우기
  // (공식: 유닛의 표시 피해는 전투 종료 시와 매 턴 종료 시 제거된다)
  everyUnit().forEach(u=>{
    u.stunned=false;
    u.dmg=0;
    u.tempM=u.tempM.filter(t=>t.dur!=='turn');
    Object.keys(u.grants).forEach(k=>{ delete u.grants[k]; });
  });
  P.energy=0; Object.keys(P.power).forEach(k=>P.power[k]=0);
  const O=G.players[opp(p)];
  O.energy=0; Object.keys(O.power).forEach(k=>O.power[k]=0);
  UI.log(`${pname(p)} 턴 종료`, 'sys');
  // 추가 턴 (시간 왜곡)
  if(G.extraTurnFor===p){ G.extraTurnFor=null; UI.log(`⏳ ${pname(p)} 추가 턴!`, 'score'); }
  else G.turn=opp(p);
  await startTurn();
}

// ---------- 공용 헬퍼: 피해/버프/준비/이동/장비 파기 ----------
// 피해 적용 (치환·방지·칙령 처리). kind: 'spell'|'ability'|'effect'|'combat'
function dealDamage(u, n, kind){
  if(n<=0) return 0;
  kind=kind||'effect';
  if(unitFx(u).noDmgIfMoved2 && (u.turnMoves||0)>=2){ UI.log(`${unitName(u)} 피해 무시 (이번 턴 2회 이동)`, 'sys'); return 0; }
  if(TF().preventSpellDmg && kind!=='combat'){ UI.log(`피해 방지됨 (효과)`, 'sys'); return 0; }
  if(kind==='spell' && G._casting!==undefined && G._casting!==null) n += TF().nextSpellBonus[G._casting]||0;
  u.dmg+=n;
  if(TF().dmgKill) u._decree=true; // 황제의 칙령
  return n;
}
async function buffUnit(u, byP){
  u.buff++;
  const extra=TF().buffPlus[byP]||0;
  if(extra) u.tempM.push({v:extra, dur:'turn'});
  UI.log(`${unitName(u)} 버프 (+1⚔${extra?` +${extra} 추가`:''})`, 'p'+byP);
  await fireEvent('onYouBuff', {p:byP, it:u});
}
async function readyUnit(u, byP){
  // 마법사냥꾼 간수: 적 유닛/장비는 준비 불가
  if(byP!==undefined && u.ctrl!==byP && everyUnit().some(x=>x.ctrl===u.ctrl && x.loc!=='base' && unitFx(x).jailerReady)){
    UI.log(`「마법사냥꾼 간수」: 준비시킬 수 없습니다`, 'sys'); return;
  }
  if(!u.ex) return;
  u.ex=false;
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
  UI.log(`장비 「${card(g.n).ko}」 파기됨`, 'p'+p);
  const gf=FX[g.n];
  if(gf&&gf.triggers&&gf.triggers.onGearLeave) for(const t of gf.triggers.onGearLeave) await execOps(t.ops, {p, gear:g});
  trashCard(p, g.n);
  UI.render();
}

// ---------- 카드 플레이 ----------
function playRestriction(c, p){
  // 유닛/장비: 자기 턴 중립 상태에서만 (행동/반응 키워드 예외)
  const fx=FX[c.n]||{kw:{}};
  if(TF().noPlay[p]) return '이번 턴에는 카드를 플레이할 수 없습니다 (효과)';
  if(G.state==='showdown'){
    if(!(fx.kw.action||fx.kw.reaction)) return '격돌 중에는 [행동]/[반응] 카드만 플레이할 수 있습니다';
    return null;
  }
  if(G.turn!==p) return '자신의 턴에만 플레이할 수 있습니다';
  if(G.phase!=='action') return '행동 단계에만 플레이할 수 있습니다';
  return null;
}

async function playCardFromHand(p, handIdx, opts={}){
  const P=G.players[p];
  const n = opts.champZone ? P.champN : P.hand[handIdx];
  const c = card(n);
  const fx = FX[n]||{kw:{},triggers:{},activated:[],manual:[],playOps:[]};

  const restr = playRestriction(c,p);
  if(restr){ UI.toast(restr,'warn'); return false; }

  // ── 추가 비용 (선택/강제) ──
  const AC = fx.addCost;
  let addPaid=false, addCount=0, addSel=null;
  if(AC && !opts.fromHidden){
    if(AC.kind==='discard'){
      if(P.hand.length>1 || opts.champZone)
        addPaid = await UI.confirmP(p, `추가 비용: ${AC.label||'카드 1장 버리기'} — 지불할까요?`);
    } else if(AC.kind==='pip'){
      if(canPay(p, 0, [AC.dom]))
        addPaid = await UI.confirmP(p, `추가 비용: ${AC.label||AC.dom+' 파워 1'} — 지불할까요?`);
    } else if(AC.kind==='exhaustUnit'){
      const cands=everyUnit().filter(u=>u.ctrl===p&&!u.ex);
      if(cands.length && await UI.confirmP(p, `추가 비용: ${AC.label||'아군 유닛 소진'} — 지불할까요?`)){
        addSel=await UI.pickUnitFrom(p,cands,'소진할 아군 유닛'); addPaid=!!addSel;
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
      accel = await UI.confirmP(p, `[가속] 추가 비용(에너지 1+파워 1)을 지불하고 준비 상태로 등장시킬까요?`);
      if(accel){ energy+=1; pips=[...pips,...accPips]; }
    }
  }
  if(!canPay(p, energy, pips)){ UI.toast('자원이 부족합니다','warn'); return false; }

  // 위치 선택 (유닛)
  let loc=null;
  if(c.type==='Unit'){
    if(opts.fromHidden) loc=opts.bfIdx;
    else {
      // 마법사냥꾼 간수: 상대는 유닛을 본진에만
      const jailed = everyUnit().some(u=>u.ctrl!==p && u.loc!=='base' && unitFx(u).jailerUnits);
      const locs=[{v:'base',label:'본진'}];
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

  payCost(p, energy, pips);

  // 손패/존에서 제거
  if(opts.champZone){ P.champInZone=false; }
  else if(opts.fromHidden){ /* 전장의 hidden 슬롯에서 제거됨 */ }
  else P.hand.splice(handIdx,1);

  // 추가 비용의 실제 지불 (손패 정리 후)
  if(AC && addPaid){
    if(AC.kind==='discard' && P.hand.length){ const di=await UI.pickHandCard(p,'버릴 카드 (추가 비용)'); if(di!==null) await discardFromHand(p,di); }
    else if(AC.kind==='exhaustUnit' && addSel){ addSel.ex=true; UI.log(`${unitName(addSel)} 소진 (추가 비용)`, 'p'+p); }
    else if(AC.kind==='spendBuff' && addSel){ addSel.buff=Math.max(0,addSel.buff-1); }
    else if(AC.kind==='spendBuffs'){ let left=addCount;
      for(const u of everyUnit().filter(u=>u.ctrl===p&&u.buff>0)){ const t=Math.min(left,u.buff); u.buff-=t; left-=t; if(!left) break; } }
    else if(AC.kind==='killUnit' && addSel){ await killUnit(addSel); }
    else if(AC.kind==='killUnits' && addSel){ for(const u of addSel) await killUnit(u); }
  }

  const legionOK = P.playedCards>=1;
  P.playedCards++;

  UI.log(`${pname(p)} 「${c.ko}」 플레이`, 'p'+p);

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
    // 시야 (자체 키워드 또는 오라)
    if(fx.kw.vision || effKw(u).vision) await visionCheck(p);
    // 플레이 트리거
    await runTriggerList(fx.triggers.onPlay, {p, unit:u, bfIdx: (loc!=='base'?loc:null), legionOK, paidAdd:addPaid, addCount});
    // 강대 유닛 훅 (볼리베어)
    if(isMighty(u)) await legendHook(p,'hookMightyPlay',{p, unit:u});
    if(fx.manual.length) UI.manualNotice(c);
  }
  else if(c.type==='Spell'){
    UI.render();
    // 대응 창: 상대가 카운터/탈취 주문을 들고 있으면 기회 제공
    let execAs=p, countered=false;
    if(!opts.fromHidden && !fx.counter && !fx.steal){
      const cw=await counterWindow(p, c);
      if(cw && cw.countered) countered=true;
      else if(cw && cw.steal!==undefined) execAs=cw.steal;
    }
    if(fx.counter||fx.steal){ UI.log(`「${c.ko}」 — 대응할 상대 주문이 없어 효과 없이 파기됩니다`, 'sys'); }
    if(!countered){
      G._casting=p; G._spellKilled=false; G._banishSpell=false;
      if(fx.playOps.length){
        for(const po of fx.playOps){
          if(po.legion && !legionOK){ UI.log(`[군단] 조건 미충족 — 효과 생략`, 'sys'); continue; }
          await execOps(po.ops, {p:execAs, legionOK, bfIdx:opts.bfIdx, kind:'spell', paidAdd:addPaid, addCount});
        }
      }
      // 소모형 플래그 해제 (다음 주문 할인/보너스)
      TF().nextSpellDisc[p]=0; TF().nextSpellBonus[p]=0;
      // 주문으로 유닛 처치 시: 파기 더미 반응 (불멸의 불사조 등)
      if(G._spellKilled){
        for(const tn of [...new Set(P.trash)]){
          const tfx=FX[tn];
          if(tfx && tfx.fromTrashOnSpellKill && canPay(p, tfx.fromTrashOnSpellKill.energy||0, tfx.fromTrashOnSpellKill.pips||[])){
            const yes=await UI.confirmP(p, `「${card(tn).ko}」을(를) 파기 더미에서 플레이할까요? (비용 지불)`);
            if(yes){ payCost(p, tfx.fromTrashOnSpellKill.energy||0, tfx.fromTrashOnSpellKill.pips||[]);
              P.trash.splice(P.trash.indexOf(tn),1);
              const uu=makeUnit(tn,p,{loc:'base'}); placeUnit(uu,'base');
              UI.log(`「${card(tn).ko}」 파기 더미에서 플레이!`, 'p'+p); }
          }
        }
      }
      G._casting=null;
      if(fx.manual.length) UI.manualNotice(c);
      await fireEvent('onYouPlaySpell', {p, n});
    }
    if(G._banishSpell){ P.banish.push(n); G._banishSpell=false; UI.log(`「${c.ko}」 추방됨`, 'sys'); }
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

// ---------- 대응 창 (카운터/탈취 주문) ----------
async function counterWindow(caster, c){
  const o=opp(caster);
  const O=G.players[o];
  for(const x of O.hand.map((hn,i)=>({hn,i,fx:FX[hn]})).filter(x=>x.fx&&(x.fx.counter||x.fx.steal))){
    const cc=card(x.hn);
    const cost=cc.e||0, pips=powerPips(cc);
    if(!canPay(o,cost,pips)) continue;
    if(x.fx.counter){
      const lim=x.fx.counter;
      if(lim.maxE!==undefined && (c.e||0)>lim.maxE) continue;
      if(lim.maxPips!==undefined && powerPips(c).length>lim.maxPips) continue;
    }
    const yes=await UI.confirmP(o, `상대가 「${c.ko}」을(를) 플레이합니다. 「${cc.ko}」(으)로 대응할까요?`, cc);
    if(!yes) continue;
    payCost(o, cost, pips);
    O.hand.splice(O.hand.indexOf(x.hn),1); trashCard(o, x.hn);
    if(x.fx.steal){ UI.log(`⚡「${cc.ko}」: 「${c.ko}」의 통제권 탈취!`, 'p'+o); return {steal:o}; }
    UI.log(`⚡「${cc.ko}」: 「${c.ko}」 무효화!`, 'p'+o);
    return {countered:true};
  }
  return null;
}

// 시야: 덱 맨 위 확인 → 재충전 여부
async function visionCheck(p){
  const P=G.players[p];
  if(!P.deck.length) return;
  const top=P.deck[0];
  const yes = await UI.confirmP(p, `[시야] 덱 맨 위: 「${card(top).ko}」 — 덱 맨 아래로 되돌릴까요?`, card(top));
  if(yes){ P.deck.shift(); P.deck.push(top); UI.log(`${pname(p)} [시야]로 덱 맨 위 카드를 재충전`, 'p'+p); await fireEvent('onYouRecycle',{p}); }
}

// ---------- 숨기기 (은신) ----------
async function hideCard(p, handIdx){
  const P=G.players[p];
  const n=P.hand[handIdx]; const c=card(n);
  const fx=FX[n]||{kw:{}};
  if(!fx.kw.hidden){ UI.toast('[은신] 카드가 아닙니다','warn'); return; }
  if(G.turn!==p || G.state!=='neutral'){ UI.toast('자신의 턴 중립 상태에서만 숨길 수 있습니다','warn'); return; }
  const cap = bf => bf.n===BF_STATIC.DOUBLE_HIDE?2:1;
  const myBfs = G.bfs.map((bf,i)=>({bf,i})).filter(x=>x.bf.controller===p && x.bf.hiddenCards.length<cap(x.bf));
  if(!myBfs.length){ UI.toast('숨길 수 있는 (통제 중 + 빈 슬롯) 전장이 없습니다','warn'); return; }
  // 비용: 파워 1 (티모 전설: 에너지 1 대체 / 게릴라전: 무료)
  const teemo = FX[P.legendN] && FX[P.legendN].altHideCost;
  let paid=false;
  if(TF().freeHide[p]) paid=true;
  else if(canPay(p,0,['Any'])){ payCost(p,0,['Any']); paid=true; }
  else if(teemo && canPay(p,1,[])){ payCost(p,1,[]); paid=true; }
  if(!paid){ UI.toast('자원이 부족합니다 (파워 1 필요)','warn'); return; }
  const sel = myBfs.length===1? myBfs[0].i : await UI.pickOption(p,'카드를 숨길 전장', myBfs.map(x=>({v:x.i,label:card(x.bf.n).ko})));
  if(sel===null) return;
  P.hand.splice(handIdx,1);
  G.bfs[sel].hiddenCards.push({n, by:p, turn:G.turnCount});
  UI.log(`${pname(p)} 전장에 카드를 뒷면으로 숨김`, 'p'+p);
  UI.render();
}

async function playHidden(p, bfIdx){
  const bf=G.bfs[bfIdx];
  // 녹서스 파괴공작원: 이곳의 상대 [은신] 카드는 공개 불가
  if(bf.units.some(u=>u.ctrl!==p && unitFx(u).blockReveal)){
    UI.toast('「녹서스 파괴공작원」: 이곳의 숨긴 카드를 공개할 수 없습니다','warn'); return;
  }
  const mine = bf.hiddenCards.filter(h=>h.by===p);
  if(!mine.length) return;
  const playable = mine.filter(h=>!(h.turn===G.turnCount && G.turn===p));
  if(!playable.length){ UI.toast('숨긴 턴에는 플레이할 수 없습니다','warn'); return; }
  let h = playable[0];
  if(playable.length>1){
    const sel=await UI.pickOption(p,'플레이할 숨김 카드',playable.map(x=>({v:x,label:card(x.n).ko})));
    if(!sel) return;
    h=sel;
  }
  const n=h.n; const c=card(n);
  bf.hiddenCards.splice(bf.hiddenCards.indexOf(h),1);
  if(c.type==='Unit'){
    await playCardFromHand(p, -1, {fromHidden:true, bfIdx, directN:n});
  } else {
    // 주문/장비: 기본 비용 무시하고 실행
    UI.log(`${pname(p)} 숨겨둔 「${c.ko}」 플레이 (비용 무시)`, 'p'+p);
    const fx=FX[n]||{playOps:[],manual:[]};
    const P=G.players[p];
    const legionOK=P.playedCards>=1; P.playedCards++;
    if(c.type==='Spell'){
      for(const po of (fx.playOps||[])){
        if(po.legion && !legionOK) continue;
        await execOps(po.ops,{p,legionOK,bfIdx});
      }
      if(fx.manual.length) UI.manualNotice(c);
      trashCard(p,n);
    } else {
      P.gear.push({n,ex:false,attachedTo:null});
      if(fx.manual.length) UI.manualNotice(c);
    }
    await cleanup(p);
    UI.render();
  }
}

// playCardFromHand에서 fromHidden 유닛의 카드 번호 참조 보정
const _origPlay = playCardFromHand;
playCardFromHand = async function(p, handIdx, opts={}){
  if(opts.fromHidden && opts.directN){
    const P=G.players[p];
    P.hand.unshift(opts.directN); // 임시 삽입
    const r = await _origPlay(p, 0, {...opts});
    return r;
  }
  return _origPlay(p, handIdx, opts);
};

// ---------- 이동 ----------
async function moveUnits(p, units, dest){
  // dest: 'base' | bfIdx
  for(const u of units){
    if(u.ex){ UI.toast('소진된 유닛은 이동할 수 없습니다','warn'); return false; }
    if(u.loc===dest){ UI.toast('이미 그 위치에 있습니다','warn'); return false; }
    if(u.loc!=='base' && dest!=='base' && !effKw(u).ganking){
      UI.toast(`${unitName(u)}: 전장 간 이동은 [갱킹]이 필요합니다`,'warn'); return false;
    }
    if(u.loc!=='base' && dest==='base' && G.bfs[u.loc].n===BF_STATIC.NO_RETREAT){
      UI.toast(`「${card(G.bfs[u.loc].n).ko}」: 이곳에서 본진으로 이동할 수 없습니다`,'warn'); return false;
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
  const destName = dest==='base'?'본진':`「${card(G.bfs[dest].n).ko}」`;
  UI.log(`${pname(p)} 유닛 ${units.length}개 ${destName}(으)로 이동`, 'p'+p);
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

// ---------- 클린업: 사망 처리 & 경합 확인 ----------
async function cleanup(actor){
  // 치명 피해 사망 (+ 황제의 칙령 표식)
  for(const u of everyUnit()){
    if((u.dmg>0 && u.dmg>=might(u)) || u._decree) await killUnit(u);
  }
  if(G.winner!==null) return;
  // 경합 확인 (중립 상태에서만 새 격돌 개시)
  if(G.state!=='neutral') return;
  for(let i=0;i<G.bfs.length;i++){
    const bf=G.bfs[i];
    const p0=bf.units.filter(u=>u.ctrl===0).length;
    const p1=bf.units.filter(u=>u.ctrl===1).length;
    if(p0&&p1){ await startShowdown(i, actor??G.turn, true); return; }
    const present = p0?0:(p1?1:null);
    if(present!==null && bf.controller!==present){
      await startShowdown(i, present, false); return;
    }
  }
}

// ---------- 격돌 (Showdown) ----------
async function startShowdown(bfIdx, attacker, hasCombat){
  const bf=G.bfs[bfIdx];
  G.state='showdown';
  G.showdown={ bfIdx, attacker, defender:opp(attacker), hasCombat, passes:0 };
  G.actingPlayer=attacker;
  UI.log(`⚔️ 격돌 개시! 「${card(bf.n).ko}」 — 공격: ${pname(attacker)}`, 'combat');
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

// 격돌 중 패스
async function showdownPass(){
  const sd=G.showdown; if(!sd) return;
  sd.passes++;
  if(sd.passes>=2){ await resolveShowdown(); return; }
  G.actingPlayer=opp(G.actingPlayer);
  UI.render(); UI.promptShowdown();
}
// 격돌 중 행동하면 패스 카운트 리셋
function showdownActed(){ if(G.showdown){ G.showdown.passes=0; G.actingPlayer=opp(G.actingPlayer); UI.render(); UI.promptShowdown(); } }

async function resolveShowdown(){
  const sd=G.showdown; const bf=G.bfs[sd.bfIdx];
  const atkUnits = ()=>bf.units.filter(u=>u.ctrl===sd.attacker);
  const defUnits = ()=>bf.units.filter(u=>u.ctrl===sd.defender);

  // 전투 피해 단계
  if(atkUnits().length && defUnits().length){
    const atkSum = atkUnits().reduce((s,u)=>s+might(u,'attacker'),0);
    const defSum = defUnits().reduce((s,u)=>s+might(u,'defender'),0);
    UI.log(`전투! 공격 전투력 합 ${atkSum} vs 방어 전투력 합 ${defSum}`, 'combat');

    // 초과 피해 (트린다미어): 방어측 총 체력 대비
    const defHealth = defUnits().reduce((s,u)=>s+Math.max(0,might(u,'defender')-u.dmg),0);
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
      return (u.dmg>0 && u.dmg>=might(u,role)) || u._decree;
    });
    // 솔라리의 상징: 공격측 보유 + 무승부(모두 사망)면 모두 본진 귀환
    if(dead.length===bf.units.length && dead.length>0 && G.players[sd.attacker].gear.some(g=>g.n===227)){
      UI.log(`「솔라리의 상징」: 무승부 — 모든 유닛이 본진으로 귀환합니다`, 'combat');
      [...bf.units].forEach(u=>{ u.dmg=0; u._decree=false; removeUnit(u); placeUnit(u,'base'); });
    } else {
      for(const u of dead) await killUnit(u);
    }
  }

  // 해결 단계: 생존자 치유, 방어자 잔존 시 공격자 본진 귀환
  bf.units.forEach(u=>u.dmg=0);
  if(defUnits().length && atkUnits().length){
    UI.log(`방어 성공 — 공격 유닛은 본진으로 귀환합니다`, 'combat');
    atkUnits().forEach(u=>{ removeUnit(u); placeUnit(u,'base'); });
  }

  // 통제 확립 & 정복
  const remaining = bf.units.length? bf.units[0].ctrl : null;
  const prevController = bf.controller;
  G.state='neutral'; G.showdown=null; G.actingPlayer=G.turn;

  if(remaining!==null && remaining!==prevController){
    bf.controller=remaining;
    // 숨김 카드 소유권 상실 처리
    bf.hiddenCards = bf.hiddenCards.filter(h=>{
      if(h.by!==remaining){
        UI.log(`숨겨둔 카드가 파기되었습니다 (전장 상실)`, 'sys');
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
    const m = might(pick, role);
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
  const fx=unitFx(u);
  const P=G.players[u.ctrl];
  const wasBuffed=u.buff>0, wasStunned=u.stunned, deathLoc=u.loc;

  // 무허가 무기고: 사망 대체 (분노 파워 1 지불)
  if(u._armory && canPay(u.ctrl,0,['Fury'])){
    const yes=await UI.confirmP(u.ctrl, `[무허가 무기고] 분노 파워 1을 지불하고 「${unitName(u)}」을(를) 회수할까요?`);
    if(yes){
      payCost(u.ctrl,0,['Fury']); u._armory=false;
      u.dmg=0; u.ex=true; u._dead=false; u._decree=false;
      removeUnit(u); placeUnit(u,'base');
      UI.log(`「${unitName(u)}」 사망 대신 회수됨 (무허가 무기고)`, 'p'+u.ctrl);
      UI.render(); return;
    }
  }
  // 존야의 모래시계: 장비를 대신 파기하고 회수
  {
    const zi=P.gear.findIndex(g=>FX[g.n]&&FX[g.n].zhonya);
    if(zi>=0){
      const yes=await UI.confirmP(u.ctrl, `[존야의 모래시계] 장비를 대신 파기하고 「${unitName(u)}」을(를) 회수할까요?`);
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
      const yes = await UI.confirmP(u.ctrl, `[미스 포츈] ✳1 지불+전설 소진+버프 소모로 「${unitName(u)}」을(를) 회수할까요?`);
      if(yes){
        payCost(u.ctrl,0,['Any']); P.legendEx=true; u.buff=Math.max(0,u.buff-1);
        u.dmg=0; u.ex=true; u._dead=false;
        removeUnit(u); placeUnit(u,'base');
        UI.log(`「${unitName(u)}」 사망 대신 본진으로 회수됨`, 'p'+u.ctrl);
        UI.render(); return;
      }
    }
  }

  removeUnit(u);
  UI.log(`💀 ${unitName(u)} 사망`, 'combat');
  // 장비는 파기
  u.gear.forEach(gn=>trashCard(u.ctrl,gn));

  if(!u.isToken){
    const c=card(u.n);
    if(c.super==='Champion' && P.champN===u.n && !P.champInZone){
      P.champInZone=true; // 챔피언은 챔피언 존으로 (비어있으면)
      UI.log(`챔피언 「${c.ko}」 챔피언 존으로 귀환`, 'p'+u.ctrl);
    } else {
      trashCard(u.ctrl, u.n);
    }
  }
  // 턴 플래그: 상대 관점의 '적 유닛 사망'
  TF().enemyDied[opp(u.ctrl)]=true;
  if(G._casting!==undefined && G._casting!==null && u.ctrl!==G._casting) G._spellKilled=true;
  UI.render();
  // 유언 (카서스: 추가 1회)
  const ctxD={p:u.ctrl, unit:u, bfIdx:(deathLoc!=='base'?deathLoc:null), dead:true};
  await runTriggerList(fx.triggers?.onDeath, ctxD);
  if(fx.triggers?.onDeath && allUnits(u.ctrl).some(x=>unitFx(x).deathknellTwice)){
    UI.log(`[카서스] 유언 효과 1회 추가 발동!`, 'p'+u.ctrl);
    await runTriggerList(fx.triggers?.onDeath, ctxD);
  }
  // 전역 사망 이벤트 (메아리의 망령, 선봉대 투구, 빅토르 등)
  await fireEvent('onUnitDeath', {p:u.ctrl, dead:u, buffed:wasBuffed, isToken:u.isToken, tokenName:u.tokenName});
  // 스턴 상태로 처치됨 → 처치자 이벤트 (솔라리 성소)
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
// 보드 전체 이벤트: 양측의 전설/유닛/장비 리스너를 스캔한다.
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
    const yes=await UI.confirmP(p, `[전설] ${card(G.players[p].legendN).ko}을(를) 소진하고 효과를 발동할까요?`);
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
  if(G.state==='showdown' && !(ab.reaction||ab.action)){ UI.toast('격돌 중에는 [행동]/[반응] 능력만 발동할 수 있습니다','warn'); return; }
  if(G.state==='neutral' && G.turn!==p){ UI.toast('자신의 턴에만 발동할 수 있습니다','warn'); return; }
  if(ab.legion && !(P.playedCards>=1)){ UI.toast('[군단] 조건: 이번 턴에 카드를 플레이해야 합니다','warn'); return; }
  if(ab.onlyAtBf && source.kind==='unit' && source.u.loc==='base'){ UI.toast('전장에 있을 때만 사용할 수 있습니다','warn'); return; }

  const cost=ab.cost||{};
  // 소진 비용
  if(cost.exhaustSelf){
    if(source.kind==='unit' && source.u.ex){ UI.toast('이미 소진되었습니다','warn'); return; }
    if(source.kind==='legend' && P.legendEx){ UI.toast('전설이 이미 소진되었습니다','warn'); return; }
    if(source.kind==='gear' && source.g.ex){ UI.toast('이미 소진되었습니다','warn'); return; }
  }
  const pips=[...(cost.pips||[])]; for(let i=0;i<(cost.power||0);i++) pips.push('Any');
  if(!canPay(p, cost.energy||0, pips)){ UI.toast('자원이 부족합니다','warn'); return; }
  if(cost.killFriendlyOrGear && !everyUnit().some(u=>u.ctrl===p) && !P.gear.length){ UI.toast('처치할 아군 유닛/장비가 없습니다','warn'); return; }
  if(cost.recycleTrash && P.trash.length<cost.recycleTrash){ UI.toast('파기 더미가 부족합니다','warn'); return; }
  if(cost.discard && P.hand.length<cost.discard){ UI.toast('손패가 부족합니다','warn'); return; }

  // 지불
  if(cost.exhaustSelf){
    if(source.kind==='unit') source.u.ex=true;
    else if(source.kind==='legend') P.legendEx=true;
    else if(source.kind==='gear') source.g.ex=true;
  }
  payCost(p, cost.energy||0, pips);
  if(cost.recycleTrash){
    for(let i=0;i<cost.recycleTrash;i++){
      const idx=Math.floor(rng()*P.trash.length);
      P.deck.push(P.trash.splice(idx,1)[0]);
    }
    UI.log(`${pname(p)} 파기 더미에서 ${cost.recycleTrash}장 재충전`, 'p'+p);
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
    // 아군 유닛 또는 장비 하나 처치 (말자하)
    const opts=[];
    everyUnit().filter(u=>u.ctrl===p).forEach(u=>opts.push({v:{t:'u',u},label:'유닛: '+unitName(u)}));
    P.gear.forEach((g,i)=>opts.push({v:{t:'g',i},label:'장비: '+card(g.n).ko}));
    const sel=await UI.pickOption(p,'처치할 아군 유닛/장비 (비용)',opts);
    if(!sel) return;
    if(sel.t==='u') await killUnit(sel.u); else await killGear(p, sel.i);
  }
  if(cost.killSelfGear && source.kind==='gear'){
    const gi=P.gear.indexOf(source.g);
    if(gi>=0) await killGear(p, gi);
  }

  const srcName = source.kind==='legend'?card(P.legendN).ko : source.kind==='unit'?unitName(source.u) : card(source.g.n).ko;
  UI.log(`${pname(p)} 「${srcName}」 능력 발동`, 'p'+p);
  await execOps(ab.ops, {p, unit:source.u, gear:source.g, kind:'ability', bfIdx:(source.u&&source.u.loc!=='base')?source.u.loc:null});
  if(G.state==='showdown') showdownActed();
  await cleanup(p);
  UI.render();
}

// ---------- 효과 op 실행기 ----------
async function pickBySpec(p, spec, promptText){
  // spec 필터로 대상 후보 구성
  let cands = everyUnit();
  if(spec.side==='friendly') cands=cands.filter(u=>u.ctrl===p);
  if(spec.side==='enemy') cands=cands.filter(u=>u.ctrl!==p);
  if(spec.where==='here' && G.showdown) cands=cands.filter(u=>u.loc===G.showdown.bfIdx);
  else if(spec.where==='here' && _ctxBf!==null) cands=cands.filter(u=>u.loc===_ctxBf);
  if(spec.where==='bf') cands=cands.filter(u=>u.loc!=='base');
  if(spec.where==='base') cands=cands.filter(u=>u.loc==='base');
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
  // 꿈꾸는 나무: 주문으로 이곳의 아군 유닛 선택 시 턴당 1회 드로우
  if(_curKind==='spell' && u.ctrl===p && u.loc!=='base' && FX[G.bfs[u.loc].n] && FX[G.bfs[u.loc].n].dreamingTree && !TF().bf292[p]){
    TF().bf292[p]=true; drawCard(p);
    UI.log(`「꿈꾸는 나무」: 카드 1장 드로우`, 'p'+p);
  }
  // 굴절 비용
  if(u.ctrl!==p){
    const defl=effKw(u).deflect;
    if(defl){
      const pips=[]; for(let i=0;i<defl;i++) pips.push('Any');
      if(!canPay(p,0,pips)){ UI.toast(`[굴절 ${defl}] 파워가 부족해 선택할 수 없습니다`,'warn'); return null; }
      const yes=await UI.confirmP(p,`[굴절 ${defl}] 파워 ${defl}를 추가 지불해야 합니다. 지불할까요?`);
      if(!yes) return null;
      payCost(p,0,pips);
    }
  }
  return u;
}

// 전장 상시: 주문/능력 피해 +1
function effDmgBonus(u){
  return (u.loc!=='base' && G.bfs[u.loc] && G.bfs[u.loc].n===BF_STATIC.BONUS_DMG)?1:0;
}

let _ctxBf = null;
let _curKind = 'effect';
async function execOps(ops, ctx){
  if(G.winner!==null) return;
  const p=ctx.p;
  _ctxBf = ctx.bfIdx??null;
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
        if(u){ const d=dealDamage(u, op.n+effDmgBonus(u), _curKind); it=u; UI.log(`${unitName(u)}에게 피해 ${d}`, 'combat'); }
        break; }
      case 'damageAll': {
        const us=await pickBySpec(p,{...op.spec,count:'all'});
        us.forEach(u=>{ dealDamage(u, op.n+effDmgBonus(u), _curKind); });
        UI.log(`대상 전체(${us.length})에게 피해 ${op.n}`, 'combat');
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
        for(let i=0;i<(op.count||1);i++){
          const u=await pickBySpec(p, op.spec, '버프할 유닛 선택');
          if(u){ await buffUnit(u, p); it=u; }
        }
        break; }
      case 'might': {
        let targets=[];
        if(op.self && ctx.unit) targets=[ctx.unit];
        else if(op.it && (it||ctx.it)) targets=[it||ctx.it];
        else if(op.all){ targets=await pickBySpec(p,{...op.spec,count:'all'}); }
        else { const u=await pickBySpec(p, op.spec, `전투력 ${op.n>0?'+':''}${op.n} 대상 선택`); if(u){targets=[u]; it=u;} }
        targets.forEach(u=>{ u.tempM.push({v:op.n, dur:'turn', min:op.min}); UI.log(`${unitName(u)} 전투력 ${op.n>0?'+':''}${op.n} (이번 턴)`, 'p'+p); });
        break; }
      case 'grantKw': {
        let u=null;
        if(op.who==='me') u=ctx.unit;
        else if(op.who==='it') u=it;
        else u=await pickBySpec(p,{type:'unit',side:op.who.includes('friendly')?'friendly':'any',where:'any',count:1},'키워드를 부여할 유닛 선택');
        if(u){
          op.kws.forEach(([kw,v])=>{
            const key=kw.toLowerCase().replace('-','');
            u.grants[key]= (typeof unitFx(u).kw[key]==='number'||['assault','shield','deflect'].includes(key)) ? v : true;
            UI.log(`${unitName(u)}에게 [${KEYWORDS_KO[kw]?.ko||kw}${v>1?' '+v:''}] 부여 (이번 턴)`, 'p'+p);
          });
          it=u;
        }
        break; }
      case 'stun': {
        const u=await pickBySpec(p, {...op.spec, side: op.spec.side==='any'?'enemy':op.spec.side}, '스턴할 유닛 선택');
        if(u && !u.stunned){ u.stunned=true; it=u; UI.log(`${unitName(u)} 스턴됨 💫`, 'p'+p);
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
      case 'addPower': G.players[p].power[op.dom]+=op.n; UI.log(`${pname(p)} 파워 +${op.n}`, 'p'+p); break;
      case 'token': {
        let loc='base';
        if(op.where==='here' && _ctxBf!==null) loc=_ctxBf;
        else if(op.where==='at a battlefield'){
          const sel=await UI.pickOption(p,'토큰을 배치할 전장',G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko})).concat([{v:'base',label:'본진'}]));
          if(sel!==null) loc=sel;
        }
        for(let i=0;i<op.count;i++){
          const u=makeUnit(0,p,{loc,isToken:true,tokenMight:op.might,tokenName:op.name,ready:op.ready});
          if(op.temp) u.grants.temporary=true;
          placeUnit(u,loc);
        }
        UI.log(`${pname(p)} ${op.might}⚔ ${op.name==='Recruit'?'신병':op.name} 토큰 ${op.count}개 플레이`, 'p'+p);
        break; }
      case 'recallSelf': if(ctx.unit){ removeUnit(ctx.unit); placeUnit(ctx.unit,'base'); UI.log(`${unitName(ctx.unit)} 본진으로 귀환`, 'p'+p); } break;
      case 'recallIt': if(it){ removeUnit(it); placeUnit(it,'base'); } break;
      case 'recall': {
        const u=await pickBySpec(p, op.spec, '본진으로 되돌릴 유닛 선택');
        if(u){ removeUnit(u); placeUnit(u,'base'); it=u; UI.log(`${unitName(u)} 본진으로 귀환`, 'p'+p); }
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
          if(dest!==null){ removeUnit(u); placeUnit(u,dest); it=u; UI.log(`${unitName(u)} 이동됨`, 'p'+p); }
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
          if(us.length) UI.log(`유닛 ${us.length}개 소진됨`, 'p'+p);
          break;
        }
        const u=await pickBySpec(p, spec, '소진시킬 유닛 선택');
        if(u){ u.ex=true; it=u; UI.log(`${unitName(u)} 소진됨`, 'p'+p); }
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
          if(u.loc==='base'){
            const sel=await UI.pickOption(p,'이동할 전장',G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko})));
            if(sel!==null){ removeUnit(u); placeUnit(u,sel); }
          } else { removeUnit(u); placeUnit(u,'base'); }
          UI.log(`${unitName(u)} 이동 (전설 능력)`, 'p'+p);
        }
        break; }
      case 'teemoFetch': {
        const P=G.players[p];
        const opts=[];
        if(P.champInZone && card(P.champN).tags.includes('Teemo')) opts.push({v:'zone',label:'챔피언 존의 '+card(P.champN).ko});
        everyUnit().filter(u=>u.ctrl===p&&!u.isToken&&card(u.n).tags.includes('Teemo')).forEach(u=>opts.push({v:u,label:unitName(u)}));
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
        let cnt=0;
        for(const r of G.players[p].runes){ if(r.ex && cnt<op.n){ r.ex=false; cnt++; } }
        if(cnt) UI.log(`${pname(p)} 룬 ${cnt}개 준비됨`, 'p'+p);
        break; }
      case 'recycleRune': {
        const P=G.players[p];
        if(P.runes.length){
          const r=P.runes.pop(); P.runeDeck.push(r.n);
          UI.log(`${pname(p)} 룬 1개 재충전 (강제)`, 'p'+p);
        }
        break; }
      case 'gainPoints': addPoints(p,op.n,'effect'); break;
      case 'champBack': {
        const P=G.players[p];
        if(!P.champInZone && P.trash.includes(P.champN)){
          const yes=await UI.confirmP(p,`파기 더미의 챔피언 「${card(P.champN).ko}」을(를) 챔피언 존으로 되돌릴까요?`);
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
        const P=G.players[p];
        let rec=false;
        for(let i=0;i<op.n;i++){
          if(!P.deck.length) break;
          const top=P.deck[0];
          const yes=await UI.confirmP(p,`덱 맨 위: 「${card(top).ko}」 — 덱 맨 아래로 되돌릴까요?`, card(top));
          if(yes){ P.deck.shift(); P.deck.push(top); rec=true; }
          else break;
        }
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
          const saveBf=_ctxBf, saveKind=_curKind;
          await EXTRA_OPS[op.op](op, {...ctx, it}, {it:()=>it, setIt:(v)=>{it=v;}});
          _ctxBf=saveBf; _curKind=saveKind;
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
      case 'might': return `전투력 ${o.n>0?'+':''}${o.n}`;
      case 'stun': return '스턴';
      case 'channel': return `룬 ${o.n}개 충전`;
      case 'token': return `${o.might}⚔ 토큰 ${o.count}개`;
      case 'recall': return '유닛 본진 귀환';
      case 'bounce': return '손패로 되돌림';
      case 'discard': return `${o.n}장 버리기`;
      case 'discardOpp': return `상대 ${o.n}장 버리기`;
      case 'exhaust': return '유닛 소진';
      case 'ready': return '유닛 준비';
      default: return o.op;
    }
  }).join(' → ');
}

// ---------- 장비 장착 ----------
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
  buff(u){ u.buff++; UI.log(`(수동) ${unitName(u)} 버프`, 'sys'); UI.render(); },
  unbuff(u){ u.buff=Math.max(0,u.buff-1); UI.render(); },
  might(u,n){ u.tempM.push({v:n,dur:'turn'}); UI.log(`(수동) ${unitName(u)} 전투력 ${n>0?'+':''}${n}`, 'sys'); UI.render(); },
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
