// ══════════ 리프트바운드 게임 엔진 ══════════
// 1v1 · 승점 8 · 전장 2개 · 효과 자동 처리

// withBattlefieldSource는 전장 효과 선택 시 출처 패널을 띄우는 UI 함수(ui.js 정의).
// 헤드리스(셀프플레이·테스트·봇 내부 시뮬)에는 ui.js가 없으므로, 표시 없이 실행만 하는
// 폴백을 둔다. 브라우저는 ui.js의 async 함수가 호이스팅으로 이 폴백을 덮어 정상 동작한다.
if(typeof globalThis.withBattlefieldSource === 'undefined') globalThis.withBattlefieldSource = (src, run) => run();

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

// 카드별 전용 op는 pickBySpec을 거치지 않고 UI.pickUnitFrom을 직접 부른다.
// 숨김 제한(룰 737)을 한 곳에서 걸기 위해 감싼다. engine.js가 ui.js보다 먼저 로드되므로
// 게임을 시작할 때(=UI가 준비된 뒤) 한 번만 설치한다.
function installHiddenTargetGuard(){
  if(typeof UI==='undefined' || typeof UI.pickUnitFrom!=='function' || UI.pickUnitFrom._hiddenGuard) return;
  const orig = UI.pickUnitFrom;
  const wrapped = function(p, cands, promptText, optional){
    if(_hiddenBf!==null && Array.isArray(cands)){
      const only = cands.filter(u=>u.loc===_hiddenBf);
      // 제한하면 후보가 하나도 없는 경우는 카드 문구가 그 전장을 배제한 것이므로 룰이 예외로 둔다
      if(only.length) cands = only;
    }
    return orig.call(UI, p, cands, promptText, optional);
  };
  wrapped._hiddenGuard = true;
  UI.pickUnitFrom = wrapped;
}

// ---------- 게임 생성 ----------
function newGame(cfg){
  UID = 1;
  // 선공은 무작위로 정한다 (룰 116 "공정한 무작위 방법"). 넘겨받지 않으면 0번.
  // 온라인은 양쪽이 같은 값을 써야 하므로 호출자가 시드 난수로 뽑아 넘긴다.
  const first = (cfg.first===0 || cfg.first===1) ? cfg.first : 0;
  if(typeof UI!=="undefined" && UI.resetHiddenAsk) UI.resetHiddenAsk();   // 새 판에는 "그만 묻기"도 초기화
  if(typeof UI!=="undefined") UI.turnOrderDecided=null;   // 온라인 상태표시 훅은 판마다 새로 건다 (다음 봇/핫시트 판에 남지 않게)
  installHiddenTargetGuard();
  seedRng(cfg.seed || (Date.now()&0xffffffff));
  G = {
    players: cfg.players.map((pc,i)=>{
      // 공식 룰: 주 덱 40장에는 선발 챔피언 1장이 포함되며, 시작 시 챔피언 구역으로 이동 → 덱 39장 시작
      const deck=shuffle([...pc.deck]);
      let champN=pc.champN;
      let ci=deck.indexOf(champN);
      // 지정된 선발이 덱에 없는데 덱에 챔피언이 있으면 → 덱의 챔피언으로 보정.
      // (편집기에서 덱 밖 챔피언을 선발로 고를 수 있던 구멍 — 그대로 두면 덱 속 챔피언이
      //  일반 카드로 뽑히고, 존에는 덱에 넣지도 않은 카드가 생긴다)
      if(ci<0){
        const inDeck=[...new Set(deck.filter(n=>{ const c=card(n); return c.type==='Unit'&&c.super==='Champion'; }))]
          .sort((a,b)=>((card(a).e||0)-(card(b).e||0)) || (a-b));
        if(inDeck.length){
          champN=inDeck[0];
          ci=deck.indexOf(champN);
          UI.log(`${pc.name}: 선발 챔피언을 덱의 「${card(champN).ko}」(으)로 보정했습니다 (지정 카드가 덱에 없음)`, 'sys');
        }
      }
      if(ci>=0) deck.splice(ci,1);
      return {
      idx:i, name:pc.name, legendN:pc.legendN, legendEx:false,
      arts: pc.arts || null,   // 이 사람이 고른 대체 일러스트 (표시용 · 규칙에 영향 없음)
      champN, champInZone:true,
      deckList:[...pc.deck], deck, hand:[], trash:[], banish:[],
      runeDeck:shuffle([...pc.runes]), runes:[],
      base:[], gear:[],
      points:0, energy:0, energySpell:0, powerSpell:0, power:{Fury:0,Calm:0,Mind:0,Body:0,Order:0,Chaos:0,Any:0},
      playedCards:0, scoredBf:{}, drewFromEmpty:false,
      };
    }),
    bfs: cfg.bfs.map((n,i)=>({ n, owner:i, controller:null, contestedBy:null, units:[], hiddenCards:[], scored:{} })),
    turn:first, turnCount:0, phase:'setup', state:'neutral',
    showdown:null, winner:null, actingPlayer:first,
  };
  // 전장 상시: 승리 점수 +1
  G.victory = VICTORY + G.bfs.filter(bf=>bf.n===BF_STATIC.VICTORY_PLUS).length;
  // 규칙 처리 모드: manual(수동, 기본) — 카드 효과·전투·득점을 자동 처리하지 않음
  G.manual = (cfg.manual===undefined) ? true : !!cfg.manual;
  // 선후공은 decideFirstPlayer(주사위)가 mulliganPhase 앞에서 확정하고 로그를 남긴다
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
// 목록에서 유닛을 고를 때 어디에 있는 유닛인지 함께 보여준다 —
// 같은 이름이 기지와 전장에 하나씩 있으면 이름만으로는 구분할 수 없다.
function unitWhere(u){ return u.loc==='base' ? '기지' : card(G.bfs[u.loc].n).ko; }
function unitLabel(u){ return unitName(u) + ' (' + unitWhere(u) + ')'; }

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
// 수치 키워드([맹공]·[보호막]·[빗나감])는 출처가 여럿이면 값을 '합산'한다 — 룰 Assault/Shield
// "granted ... by an additional source, the Value of all granted keywords is summed" (grantKw와 같은 기준).
// 예전엔 오라가 base[k]||true 로 덮어써 타릭 오라가 [보호막 1] 포로에 +0, 패론 대위 2기가 +1이었다 (RiftJudge #9493·#6494).
const NUM_KW = new Set(['assault','shield','deflect']);
function addKw(base, k, v){
  if(NUM_KW.has(k)) base[k]=(typeof base[k]==='number'?base[k]:(base[k]?1:0))+(typeof v==='number'?v:1);
  else base[k]=base[k]||true;
}
// 부여 키워드 포함 유효 키워드
function effKw(u){
  const base = {...unitFx(u).kw};
  Object.entries(u.grants).forEach(([k,v])=>{
    if(NUM_KW.has(k)) addKw(base,k,v);
    else base[k]=v;
  });
  // 전장 상시: 이곳 유닛 [개입]
  if(u.loc!=='base' && G.bfs[u.loc] && G.bfs[u.loc].n===BF_STATIC.GANKING) base.ganking=true;
  if(!_inKw){
    _inKw=true;
    try{
      for(const src of collectStatics()){
        const s=src.s;
        if(s.kind==='kwAura' && staticMatch(u,src,s.filter)) s.kws.forEach(k=>addKw(base,k,s.val));
        else if(s.kind==='selfKw' && src.unit===u && (!s.cond||s.cond(u))) s.kws.forEach(k=>addKw(base,k));
        else if(s.kind==='selfKwFn' && src.unit===u){ const ks=s.fn(u); if(ks) ks.forEach(k=>addKw(base,k)); }
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
// 유닛이 전장에 '들어가는' 모든 경로가 공유하는 공격/방어 판정.
// 공격·방어 지정은 '전투'가 있어야 생긴다 — 공격자는 경합을 먼저 건 쪽(351.1 · 전투 1단계), [공격 시]/[방어 시]는
// 그 전투에서 지정을 '처음' 받을 때 한 번만 격발한다(378). 빈 전장의 무혈 결전에는 지정이 없고(#4707 · #278),
// 진행 중인 전투에 나중에 들어온 유닛은 자기 통제자 쪽 지정을 받는다(전투 1단계 · 322 3 · #9303 · #9174).
// 예전엔 '적이 있으면 공격'으로 판정해 무혈 결전에 바람 타기로 합류한 방어자의 [공격 시]가 났고, 진짜 공격자의
// [공격 시]는 전투 전환 때 빠졌다. 전투가 없으면 여기서는 아무것도 하지 않는다 — 전투 결전이 열릴 때
// startShowdown이 양측 유닛 전부를 지정한다. 지정을 받는 것은 이동을 일으킨 사람이 아니라 '그 유닛의 통제자'다.
async function fireAttackTriggers(u, dest){
  if(dest==='base' || dest===null || dest===undefined) return;
  const sd=G.showdown;
  if(!sd || !sd.hasCombat || sd.bfIdx!==dest) return;
  await fireDesignationTriggers(sd, designateUnits(sd, [u]));
}
// 전투에서 처음 지정을 받는 유닛을 표시하고 「예지의 가면」(60)을 적용한다. 반환: 새로 지정된 유닛들.
// 가면의 '혼자'는 지정 순간의 스냅샷 — 같은 순간 격발한 「약탈자의 거리」가 먼저 하나를 되돌려도 안 붙는다(#8304).
// 가면은 장착 수만큼 각각 격발한다(#6946). 같은 전투에서 나갔다 다시 들어와도 재격발하지 않는다(378 · #2091).
function designateUnits(sd, units){
  sd.designated = sd.designated || {};
  const fresh = units.filter(u=>u.loc===sd.bfIdx && !sd.designated[u.uid]);
  fresh.forEach(u=>{ sd.designated[u.uid]=true; });
  const alone = fresh.filter(u=>aloneAt(u));   // 격발 전 스냅샷
  for(const u of alone){
    const masks=G.players[u.ctrl].gear.filter(g=>FX[g.n]&&FX[g.n].gearAloneCombat).length;
    if(!masks) continue;
    u.tempM.push({v:masks,dur:'turn'});
    UI.log(`「예지의 가면」: ${unitName(u)} +${masks}⚔`, 'p'+u.ctrl);
  }
  return fresh;
}
// 지정 격발 해결 — 방어측이 먼저(초기 체인은 공격자가 먼저 얹고 LIFO로 방어자 것이 먼저 해결 — 절충 ①, #5266).
async function fireDesignationTriggers(sd, fresh){
  const defender=sd.defender;
  for(const u of fresh.filter(u=>u.ctrl===defender)){
    await runTriggerList(unitFx(u).triggers?.onDefend, {p:u.ctrl, unit:u, bfIdx:sd.bfIdx});
    await runTriggerList(unitFx(u).triggers?.onAttackOrDefend, {p:u.ctrl, unit:u, bfIdx:sd.bfIdx});
  }
  for(const u of fresh.filter(u=>u.ctrl===sd.attacker)){
    await runTriggerList(unitFx(u).triggers?.onAttack, {p:u.ctrl, unit:u, bfIdx:sd.bfIdx});
    await runTriggerList(unitFx(u).triggers?.onAttackOrDefend, {p:u.ctrl, unit:u, bfIdx:sd.bfIdx});
    // 「아리 - 구미호」 등 "적 유닛이 내가 통제하는 전장을 공격할 때" — 공격자 지정이 있을 때만(#8244)
    if(G.bfs[sd.bfIdx].controller===defender)
      await legendHookTarget(defender,'hookEnemyAttackMyBf',{p:defender, it:u, bfIdx:sd.bfIdx});
  }
}

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
async function discardFromHand(p, idx, opts){
  const P=G.players[p];
  const n=P.hand.splice(idx,1)[0];
  if(n===undefined) return;
  P.trash.push(n);
  G._lastDiscard={p,n};
  TF().discarded[p]=true;
  UI.log(`${pname(p)} 「${card(n).ko}」 버림`, 'p'+p);
  const fx=FX[n];
  if(fx && fx.onDiscardSelf) await execOps(fx.onDiscardSelf, {p, kind:'effect'});
  // 여러 장을 한 번에 버릴 때는 호출부가 모아서 1회만 낸다 ("one or more cards" = 사건 1회)
  if(!(opts && opts.batch)) await fireEvent('onYouDiscard', {p, n});
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
  G.players.forEach(P=>{ if(P.points>=G.victory && G.winner===null){
    G.winner=P.idx;
    if(typeof STATS!=='undefined') STATS.gameEnd(P.idx, 'normal');
    UI.showVictory(P.idx);
  } });
}
// 항복 — 남은 쪽이 즉시 승리 (온라인은 액션으로 양측에 동일하게 적용된다)
function surrender(p){
  if(!G || G.winner!==null) return;
  const w=opp(p);
  G.winner=w;
  if(typeof STATS!=='undefined') STATS.gameEnd(w, 'surrender');
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
  // 주문 전용 힘(카이사 전설 247, 무지개) — 주문 지불(spellOK)일 때만 어느 핍이든 충당
  let spellAny = arguments[3] ? (P.powerSpell||0) : 0;
  // 힘 핍: 풀 → 영역 일치 룬 (준비/탈진 무관, 핍당 서로 다른 룬)
  for(const pip of pips){
    if(spellAny>0){ spellAny--; continue; }
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

// 이 지불이 룬을 건드리는가 (재활용하거나 탈진시키는가). payCost와 같은 우선순위로 흉내만 낸다.
// 지불 전에 "룬을 아끼려면 [반응] 자원 능력을 먼저 쓰겠는가"를 물어볼지 판단하는 데 쓴다.
function payUsesRunes(p, energy, pips, spellOK){
  const P=G.players[p];
  let spellAny = spellOK ? (P.powerSpell||0) : 0;
  const pool = {...P.power};
  for(const pip of pips){
    if(spellAny>0){ spellAny--; continue; }
    if(pip==='Any'){ const d=Object.keys(pool).find(d=>pool[d]>0); if(d){ pool[d]--; continue; } }
    else { if(pool[pip]>0){ pool[pip]--; continue; } if(pool.Any>0){ pool.Any--; continue; } }
    return true;                       // 이 핍은 룬을 재활용해야 낸다
  }
  let need = energy;
  if(spellOK) need -= Math.min(P.energySpell||0, need);
  need -= Math.min(P.energy, need);
  return need > 0;                     // 남으면 준비 룬을 탈진시켜야 한다
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
  // ② 힘 핍: 주문 전용 힘(spellOK) → 풀 → 탈진 룬 재활용(룬 덱 반환) → 준비 룬 재활용
  const recycled=[];
  for(const pip of pips){
    if(arguments[4] && (P.powerSpell||0)>0){ P.powerSpell--; continue; }
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
  // 룰 136.3: 속성이 없거나 둘 이상인 카드의 자기 속성 힘 [C]는 [A](아무 속성)로 처리한다.
  // 이중 속성 시그니처(힘 착취 등)는 인쇄 핍도 두 속성 반반 하이브리드 — 둘 중 어느 룬으로도 지불 가능.
  // (예전엔 doms[i%len]로 첫 속성만 배정해, 정신/질서 카드 1핍을 정신 룬으로만 낼 수 있었다)
  const doms = (c.dom&&c.dom.length===1)?c.dom:['Any'];
  const pips=[];
  for(let i=0;i<n;i++) pips.push(doms[0]);
  return pips;
}

// ---------- 선후공 결정 (룰 115.1.b "모든 플레이어가 합의한 공정한 무작위 방법") ----------
// 각자 주사위(1~6)를 굴려 높은 쪽이 선공/후공을 고른다. 동점이면 다시 굴린다.
// 시드 난수(rng)라 온라인 양쪽 결과가 같고, 승자의 선택은 UI.pickOption(routedPick)으로 동기화된다.
async function decideFirstPlayer(){
  let d0, d1, tries=0;
  do{
    d0=1+Math.floor(rng()*6); d1=1+Math.floor(rng()*6); tries++;
    if(d0===d1) UI.log(`🎲 주사위: ${pname(0)} ${d0} vs ${pname(1)} ${d1} — 동점, 다시 굴립니다`, 'sys');
  }while(d0===d1 && tries<50);
  const w = d0>d1 ? 0 : 1;
  UI.log(`🎲 주사위: ${pname(0)} ${d0} vs ${pname(1)} ${d1} → ${pname(w)}이(가) 선후공을 선택합니다`, 'sys');
  UI.render();
  const v = await UI.pickOption(w,
    `🎲 주사위 ${Math.max(d0,d1)} : ${Math.min(d0,d1)} 승리! 선공과 후공 중 선택하세요 (후공은 첫 전개 단계에 룬을 1개 더 전개)`,
    [{label:'⚔️ 선공', v:'first'}, {label:'🛡️ 후공 (첫 전개 룬 +1)', v:'second'}]);
  const first = (v==='second') ? opp(w) : w;
  G.turn=first; G.actingPlayer=first;
  UI.log(`${pname(w)}: ${v==='second'?'후공':'선공'} 선택 → 선공: ${pname(first)} — 후공은 첫 전개 단계에 룬을 1개 더 전개합니다`, 'sys');
  if(typeof UI.turnOrderDecided==='function') UI.turnOrderDecided();
  UI.render();
}

// ---------- 멀리건 (공식 룰: 종합 규칙 110-118) ----------
// 턴 순서대로: 손패에서 최대 2장을 따로 빼두고 → 그 수만큼 드로우 → 빼둔 카드를 덱 맨 아래로 재활용.
async function mulliganPhase(){
  await decideFirstPlayer();
  // 온라인: 양쪽이 동시에 고른다 (상대가 끝날 때까지 기다리지 않게).
  // 적용은 결과가 도착한 순서와 무관하게 항상 0번 → 1번 순으로 해서 양쪽 상태를 같게 유지한다.
  if(NET.online){
    const picks = await Promise.all([0,1].map(p=>
      G.players[p].hand.length ? UI.pickMulligan(p) : Promise.resolve(null)));
    for(const p of [0,1]) applyMulligan(p, picks[p]);
    UI.render();
    return;
  }
  // 핫시트/봇: 한 화면을 번갈아 쓰므로 순서대로 — 룰 118 "턴 순서대로 멀리건"
  for(const p of [G.turn, opp(G.turn)]){
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
  // '이번 턴에 어느 전장을 득점했나'는 최종 점수 판정(룰 452)에 쓰인다. 정복은 상대 턴에도
  // 일어날 수 있으므로(방어에 성공해 통제를 되찾는 경우) 양쪽 기록을 모두 비워야 한다.
  // 턴 주인만 비우면 지난 내 턴의 기록이 남아 "이번 턴 모든 전장 득점"이 잘못 성립했다.
  G.players.forEach(pl=>{ pl.scoredBf={}; });
  G.bfs.forEach(bf=>bf.scored={});
  G.tflags=freshTF();
  everyUnit().forEach(u=>{ u.turnMoves=0; u._armory=false; u._highlander=false; u._guillotine=false; });
  G.phase='awaken'; UI.render();
  UI.log(`━━ ${pname(p)}의 턴 ${Math.ceil(G.turnCount/2)} ━━`, 'sys');

  // A: 각성 — 룬/유닛/도구/전설 모두 준비 (공식: Ready all your Runes, Units, and Gear)
  P.legendEx=false; P.legendUsed=false;
  P.runes.forEach(r=>r.ex=false);
  // 각성의 준비도 규칙상 Ready 액션이므로 '준비 시' 트리거가 돌아야 한다 (룰 315.1.a/402.3.a).
  // 로그가 길어지지 않게 개별 준비 로그는 생략한다.
  for(const u of allUnits(p)) await readyUnit(u, p, {rule:true, quiet:true});
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
  if(UI.askHidden) setTimeout(()=>{ try{ UI.askHidden(); }catch(e){} }, 0);
}

async function endTurn(){
  if(G._endingTurn) return; // 종료 트리거·결전을 처리 중인 동안 중복 종료 방지
  const p=G.turn;
  G.phase='ending';
  G._endingTurn={p};
  UI.render();
  // 턴 종료 트리거 (소나, 눈부신 오로라 등). 종료 격발이 남아 있는 동안은 체인이 있는 닫힌 상태라 결전이 열리지 않는다
  // (룰 342.1.b 결전은 중립 열린 상태에서 · 클린업 9단계) — 오로라 두 장이면 둘 다 해결한 뒤에야 죽음꽃 포식자의 결전이 열린다 (RiftJudge #9290).
  G._holdShowdown=true;
  try{ await fireEvent('onEndTurn', {p}); } finally{ G._holdShowdown=false; }
  if(G.winner!==null){ G._endingTurn=null; return; }
  // 종료 트리거가 양측 유닛을 한 전장에 모았다면 결전이 열린다 (오로라 → 죽음꽃 포식자).
  // 그 전투를 끝내기 전에는 만료 처리도 턴 넘김도 하지 않는다.
  await cleanup(p);
  if(G.state==='showdown'){
    UI.log('종료 단계에 열린 결전을 먼저 해결합니다', 'combat');
    UI.render();
    return;                      // resolveShowdown이 끝나면 finishEndTurn으로 돌아온다
  }
  await finishEndTurn(p);
}

// 종료 단계의 나머지 절차. 종료 트리거가 만든 결전이 있었다면 그 결전이 모두
// 끝난 뒤 resolveShowdown이 이 함수를 불러 같은 종료 단계를 이어서 마친다.
async function finishEndTurn(p){
  if(!G._endingTurn || G._endingTurn.p!==p || G.state==='showdown') return false;
  if(G.winner!==null){ G._endingTurn=null; return true; }
  const P=G.players[p];
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
      const got = await withBattlefieldSource({n:289,event:'onConquerEndTurn'},()=>readyRunesPick(pi,nR,true));
      if(got) UI.log(`${pname(pi)} 「타곤의 정상」: 룬 ${got}개 준비`, 'p'+pi);
    }
  }
  P.energy=0; P.energySpell=0; P.powerSpell=0; Object.keys(P.power).forEach(k=>P.power[k]=0);
  const O=G.players[opp(p)];
  O.energy=0; O.energySpell=0; O.powerSpell=0; Object.keys(O.power).forEach(k=>O.power[k]=0);
  UI.fx.turnEnd(p);
  UI.log(`${pname(p)} 턴 종료`, 'sys');
  G._endingTurn=null;
  // 추가 턴 (시간 왜곡)
  if(G.extraTurns && G.extraTurns.length){ G.turn=G.extraTurns.shift(); UI.log(`⏳ ${pname(G.turn)} 추가 턴!`, 'score'); }
  else G.turn=opp(p);
  await startTurn();
  return true;
}

// ---------- 공용 헬퍼: 피해/버프/준비/이동/도구 폐기 ----------
// 피해 적용 (치환·방지·칙령 처리). kind: 'spell'|'ability'|'effect'|'combat'|'unit'
//  'unit' = 카드가 유닛을 피해 주체로 지정한 경우("They/It/We deal damage" — 도전·최후의 숨결·육식 덩굴·신사의 결투·
//  용의 분노). 룰 405~406: 주문이 유닛을 출처로 지정하면 그 피해는 유닛이 주는 것이지 주문·능력 피해가 아니다
//  (Challenge 예시 "dealt by the chosen units, not by Challenge") → 「불굴의 정신」 방지·「레이븐본 서적」 보너스·
//  「불멸의 불사조」 처치 귀속에서 빠진다 (RiftJudge #8394 · #8166 · #8373). "Deal damage equal to my Might"처럼
//  주어가 없는 능력 피해(야스오·폭풍을 부르는 자)는 그대로 능력/주문 피해다(#1999).
function dealDamage(u, n, kind){
  if(n<=0) return 0;
  kind=kind||'effect';
  if(unitFx(u).noDmgIfMoved2 && (u.turnMoves||0)>=2){ UI.log(`${unitName(u)} 피해 무시 (이번 턴 2회 이동)`, 'sys'); return 0; }
  if(TF().preventSpellDmg && kind!=='combat' && kind!=='unit'){ UI.log(`피해 방지됨 (효과)`, 'sys'); return 0; }
  const casting = (G._casting!==undefined && G._casting!==null) ? G._casting : null;
  if(kind==='spell' && casting!==null) n += TF().nextSpellBonus[casting]||0;
  u.dmg+=n;
  // 처치 귀속(룰 416): 클린업 사망은 "직전에 해결되어 피해를 준 주문"의 처치 — 마지막 피해의 출처(시전자)를 기억한다.
  // 전투·유닛 주체 피해가 마지막이면 어느 주문의 처치도 아니다.
  u._spellDmgBy = (casting!==null && kind!=='combat' && kind!=='unit') ? casting : null;
  UI.fx.unit(u, 'hit', '-'+n);
  if(TF().dmgKill){ u._decree=true; u._decreeBy=TF().dmgKillBy; } // 황제의 칙령 — 처치는 칙령 시전자의 주문 처치(#7364)
  if(u._guillotine && n>0){ u._guillotine=false; u._decree=true; u._decreeBy=u._guillotineBy; UI.log(`「녹서스의 단두대」: ${unitName(u)} 처치 표식 발동`, 'combat'); }
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
async function readyUnit(u, byP, opts){
  // 마법사냥꾼 간수(70): 전장에 있는 동안 주문·능력은 '간수 기준 적' 유닛을 준비시킬 수 없다
  // (byP가 있으면 주문/능력에 의한 준비 — 상대 진영에 간수가 있으면 차단. 기존엔 방향이 반대였다)
  // opts.rule = 규칙에 의한 준비(각성 단계) — 간수는 주문·능력만 막으므로 통과시킨다
  if(byP!==undefined && !(opts&&opts.rule) && everyUnit().some(x=>x.ctrl!==u.ctrl && x.loc!=='base' && unitFx(x).jailerReady)){
    UI.log(`「마법사냥꾼 간수」: 준비시킬 수 없습니다`, 'sys'); return;
  }
  if(!u.ex) return;
  u.ex=false;
  UI.fx.unit(u, 'ready');
  if(!(opts&&opts.quiet)) UI.log(`${unitName(u)} 준비됨`, 'p'+(byP??u.ctrl));
  if(byP!==undefined && u.ctrl===byP) await fireEvent('onYouReadyUnit', {p:byP, it:u});
}
// 효과에 의한 이동 (스펠/능력) — 이동 트리거 포함
// 효과로 옮길 수 있는가. 봇의 후보 생성과 실제 이동이 같은 규칙을 본다.
function canEffectMove(u, dest){
  if(!u || u._dead || u.loc===dest) return false;
  if(dest!=='base' && !(Number.isInteger(dest) && G.bfs[dest])) return false;
  // 「후퇴 없는 전선」: 이곳에서 기지로는 못 나간다
  if(dest==='base' && u.loc!=='base' && G.bfs[u.loc].n===BF_STATIC.NO_RETREAT) return false;
  return true;
}

async function effectMove(p, u, dest){
  if(!canEffectMove(u, dest)) return false;
  const from=u.loc;
  removeUnit(u); placeUnit(u, dest);
  u.turnMoves=(u.turnMoves||0)+1;
  UI.log(`${unitName(u)} 이동됨`, 'p'+p);
  // 출발 전장의 '이곳에서 이동할 때' 트리거 (뒷골목 술집 277 등) — 일반 이동과 동일하게 발동
  if(from!=='base') await fireBfTrigger(from,'onMoveFromHere',{p, it:u, bfIdx:from});
  await runTriggerList(unitFx(u).triggers?.onMoveSelf, {p:u.ctrl, unit:u, it:u, bfIdx:(dest!=='base'?dest:null), dest});
  if(dest!=='base') await fireEvent('onMoveToBf', {p:u.ctrl, bfIdx:dest});
  // 효과로 옮겨진 이동도 이동이다 (룰 427). 「매혹」으로 상대 유닛을 내 전장에 끌어오면
  // 상대가 공격자이고 그 유닛이 공격자 지정을 받는다 (룰 428).
  await fireAttackTriggers(u, dest);
  return true;
}

// ══════════ 효과 이동 / 손패 복귀: 대상과 목적지를 한 번에 ══════════
// 유닛만 먼저 고르면 "어디로 보낼지"를 모른 채 결정하게 되어, 사람은 되돌릴 수 없고
// 봇은 이득 없는 이동을 고른다. 두 축을 한 선택지로 묶어 양쪽이 같은 후보를 본다.
//
// to: 'base' | 'bf' | 'any'(전장+기지) | 'baseLink'(기지↔전장 왕복) | 전장 번호
async function chooseEffectMove(p, spec, to, extra={}, boardPick=false){
  // 플레이 시점에 고른 유닛(352.8.a)이 있으면 그 유닛의 목적지만 고른다(목적지는 절충 ④ — 해결 시점).
  // 부적법해졌으면(사라짐·조건 불충족) 이동도 그에 딸린 피해도 없다(356.3.e). 굴절은 플레이 때 냈다.
  const preU = takePreTarget(p, spec);
  if(preU===null) return null;
  if(preU) extra={...extra, alreadyPicked:true};
  const units = preU ? [preU] : unitsBySpec(spec, p), options=[];
  for(const u of units){
    const dests = to==='base' ? ['base']
      : to==='baseLink' ? (u.loc==='base' ? G.bfs.map((_,i)=>i) : ['base'])
      : to==='any' ? [...G.bfs.map((_,i)=>i), 'base']
      : to==='bf' ? G.bfs.map((_,i)=>i)
      : [to];
    for(const dest of dests){
      if(!canEffectMove(u, dest)) continue;
      if(extra.swapUid){                       // 물결을 바꾸는 자: 서로 자리를 맞바꿀 수 있을 때만
        const me=everyUnit().find(x=>x.uid===extra.swapUid);
        if(!me || dest!==me.loc || !canEffectMove(me, u.loc)) continue;
      }
      options.push({ v:options.length,
        label:`${unitLabel(u)} → ${dest==='base'?'기지':card(G.bfs[dest].n).ko}`,
        card:unitCard(u), movement:{ uid:u.uid, dest, ...extra } });
    }
  }
  if(!options.length) return null;
  if(spec.optional) options.push({ v:null, label:'이동하지 않음', movement:null });
  // 'may'가 없는 이동은 강제다 — 적법한 목적지가 있으면 이동하지 않을 수 없다(룰 100 · 425 Move는 제한 행동, RiftJudge #9277).
  // 취소(null)면 다시 묻고, 그래도 거부하면 첫 후보로 진행한다(락스텝·봇은 항상 유효 응답).
  let choice=null;
  for(let ask=0; ask<3 && !choice; ask++){
    const title = boardPick?'기지로 이동시킬 전장의 유닛을 클릭하세요':'효과 이동: 유닛과 목적지 선택';
    const sel = await UI.pickOption(p, ask?`${title} (이동은 강제 — 취소할 수 없습니다)`:title, options, boardPick);
    choice = (options.find(o=>o.v===sel)||{}).movement;
    if(!choice && (spec.optional || (sel!==null && sel!==undefined))) break;   // '이동하지 않음' 선택 또는 선택형
  }
  if(!choice && !spec.optional) choice=options[0].movement;
  return choice ? await resolveEffectMove(p, choice) : null;
}
async function resolveEffectMove(p, choice){
  const u = everyUnit().find(x=>x.uid===choice.uid);
  if(!canEffectMove(u, choice.dest)) return null;
  if(!choice.alreadyPicked){
    noteSpellPick(p, u);
    if(!(await payDeflect(p, u))) return null;
  }
  if(choice.buff) await buffUnit(u, p);
  // 「폭풍의 돌격」: 도착 전장의 적에게 이동 유닛의 위력만큼 피해
  if(choice.storm) for(const e of G.bfs[choice.dest].units.filter(x=>x.ctrl!==p)) dealDamage(e, might(u), 'spell');
  if(choice.swapUid){
    const me=everyUnit().find(x=>x.uid===choice.swapUid);
    if(!canEffectMove(me, u.loc)) return null;
    await effectMove(p, me, u.loc);
  }
  await effectMove(p, u, choice.dest);
  if(choice.ready) await readyUnit(u, p);
  // 「용의 분노」: 도착지의 다른 적 유닛과 상호 피해
  if(choice.dragon){
    const others=everyUnit().filter(x=>x.ctrl!==p && x!==u && x.loc===choice.dest);
    if(others.length){
      const t=await UI.pickUnitFrom(p, others, '상호 피해를 줄 다른 적 유닛');
      if(t && await payDeflect(p, t)){
        // "They deal damage ... to each other" — 유닛 주체 피해(룰 405~406, #7331), 전투 중이면 지정 보정 포함(#5261)
        const a=targetMight(u), b=targetMight(t);
        dealDamage(t, a, 'unit'); dealDamage(u, b, 'unit');
        UI.log(`${unitName(u)} ⚔ ${unitName(t)} 상호 피해!`, 'combat');
      }
    }
  }
  return u;
}

// 손패 복귀는 이동도 사망도 아니다. 항상 '소유자'의 손으로 돌아간다.
async function chooseReturnToHand(p, spec, extra={}){
  if(extra.energy && !canPay(p, extra.energy, [])) return null;
  // 플레이 시점에 고른 대상(352.8.a)은 다시 고르지 않는다 — 「돌풍」 대상이 응수로 4위력이 되거나
  // 「후퇴」 대상이 먼저 손패로 가면 그 지시(룬 전개 포함)만 불발(356.3.e). 굴절은 플레이 때 냈다.
  const preU = takePreTarget(p, spec);
  if(preU===null) return null;
  if(preU) return await resolveReturnToHand(p, { uid:preU.uid, ...extra, alreadyPicked:true });
  const options = unitsBySpec(spec, p).map((u,i)=>({
    v:i, label:unitLabel(u), card:unitCard(u), returnHand:{ uid:u.uid, ...extra } }));
  if(!options.length) return null;
  if(spec.optional) options.push({ v:null, label:'되돌리지 않음', returnHand:null });
  const sel = await UI.pickOption(p, '소유자의 손패로 되돌릴 대상', options);
  const choice = (options.find(o=>o.v===sel)||{}).returnHand;
  return choice ? await resolveReturnToHand(p, choice) : null;
}
async function resolveReturnToHand(p, choice){
  if(choice.energy){
    if(!canPay(p, choice.energy, [])) return null;
    payCost(p, choice.energy, []);
  }
  const P=G.players[p];
  if(choice.gearIndex!==undefined){                 // 「경이의 꾸러미」: 도구
    const g=P.gear[choice.gearIndex]; if(!g) return null;
    P.gear.splice(choice.gearIndex,1);
    // '떠나는 도구 자신'의 격발만 — 전역 브로드캐스트는 남은 다른 도구를 잘못 격발시킨다
    const gf=FX[g.n];
    if(gf && gf.triggers && gf.triggers.onGearLeave)
      for(const t of gf.triggers.onGearLeave) await execOps(t.ops, {p, gear:g});
    G.players[g.owner!==undefined?g.owner:p].hand.push(g.n);
    UI.log('도구를 손패로 되돌림', 'p'+p);
    return g;
  }
  if(choice.bfIdx!==undefined){                     // 숨김 카드
    const hs=G.bfs[choice.bfIdx].hiddenCards, hc=hs[choice.hiddenIndex];
    if(!hc || hc.by!==p) return null;
    hs.splice(choice.hiddenIndex,1);
    G.players[hc.owner!==undefined?hc.owner:hc.by].hand.push(hc.n);
    UI.log('숨김 카드를 손패로 되돌림', 'p'+p);
    return hc;
  }
  const u=everyUnit().find(x=>x.uid===choice.uid); if(!u) return null;
  if(!choice.alreadyPicked){
    noteSpellPick(p, u);
    if(!(await payDeflect(p, u))) return null;
  }
  const owner = u.owner!==undefined ? u.owner : u.ctrl;   // 통제권을 뺏은 유닛은 원래 주인에게
  removeUnit(u);
  if(!u.isToken){                                   // 토큰은 손패로 가지 않고 사라진다
    // 예측 중에는 '공개적으로 돌아간' 카드만 재사용 가치에 반영한다 (상대의 기존 손패는 평가 안 함)
    if(typeof SIM!=='undefined' && SIM.active)
      (SIM.returned||(SIM.returned=[])).push({ owner, n:u.n,
        before:G.players[owner].hand.filter(n=>n===u.n).length });
    G.players[owner].hand.push(u.n);
  }
  UI.log(`${unitName(u)} 소유자의 손패로 돌아감`, 'p'+p);
  if(choice.channel) channelRunes(owner, choice.channel, true);
  return u;
}
// 기절 (룰 410). 기절을 거는 모든 경로가 이 함수를 거쳐야 전설 훅·트리거가 빠지지 않는다.
// - 이미 기절한 유닛은 다시 기절시키지 않는다 (410.1.a.1) → 트리거도 돌지 않음
// - 레오나(261)·일식의 전령(59)은 "적 유닛을 기절"에만 반응하므로 적 여부를 구분한다
// - "하나 이상 기절"이므로 동시에 여러 기를 기절시켜도 발동은 1회
// 굴절(735): 상대 유닛을 대상으로 고르면 힘을 추가 지불한다. 지불하지 않으면 고를 수 없다.
// 상시 효과가 부여한 굴절은 true(기본 1), 인쇄/추가 부여 수치는 숫자로 들어온다.
function deflectPips(p, u){
  if(!u || u.ctrl===p) return [];
  const defl=Number(effKw(u).deflect)||0;
  const pips=[]; for(let i=0;i<defl;i++) pips.push('Any');
  return pips;
}
// base: 플레이 시점이면 아직 안 낸 주문 본 비용({energy,pips,spellOK}) — 굴절은 '추가 비용'이라 합쳐서 낼 수 있어야 한다(735.3)
function canPayDeflect(p, u, base){
  const pips=deflectPips(p, u);
  if(!pips.length) return true;
  return base ? canPay(p, base.energy||0, [...(base.pips||[]), ...pips], base.spellOK) : canPay(p, 0, pips);
}
async function payDeflect(p, u, base){
  const pips=deflectPips(p, u);
  if(!pips.length) return true;
  const defl=pips.length;
  if(!canPayDeflect(p, u, base)){ UI.toast(`[굴절 ${defl}] 힘이 부족해 선택할 수 없습니다`,'warn'); return false; }
  const yes=await UI.confirmP(p,`[굴절 ${defl}] 힘 ${defl} 추가 지불이 필요합니다. 지불할까요?`, unitCard(u));
  if(!yes) return false;
  payCost(p,0,pips);
  return true;
}

async function stunUnits(byP, units){
  const list = Array.isArray(units) ? units : [units];
  const done = [];
  for(const u of list){
    if(!u || u.stunned) continue;
    u.stunned = true; done.push(u);
    UI.log(`${unitName(u)} 기절됨 💫`, 'p'+byP);
  }
  if(done.length) UI.render();
  if(done.some(u => u.ctrl !== byP)){
    await legendHook(byP, 'hookYouStun', {p:byP});
    await fireEvent('onYouStun', {p:byP});
  }
  return done;
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
function playRestriction(c, p, fromHidden, bfIdx){
  // 유닛/도구: 자기 턴 중립 상태에서만 (행동/반응 키워드 예외)
  // fromHidden: 뒷면(숨김) 카드는 뒷면인 동안 [반응]을 얻는다 (공식 739.1)
  //   → 종류와 무관하게 결전·체인 중에도 플레이할 수 있다. bfIdx는 숨겨 둔 전장(대상 제한 737).
  const fx=FX[c.n]||{kw:{}};
  if(TF().noPlay[p]) return '이번 턴에는 카드를 플레이할 수 없습니다 (효과)';
  // 카운터/탈취("Counter a spell")는 체인 위의 주문을 '대상'으로 한다 — 대상 없이는 체인에 올릴 수 없다
  // (룰 352 Targeting: "valid choices must be made for all targets" · 737 숨김 주문도 동일). 예전엔 비용만 내고
  // 효과 없이 폐기되면서 '주문 플레이' 트리거까지 났다 (RiftJudge #6174). 중립 응수 창은 reactionWindow가 따로 처리.
  if(c.type==='Spell' && (fx.counter||fx.steal) && !counterTargets(p, fx).length) return '대응할 주문이 체인에 없습니다';
  // 유닛을 고르는 주문도 같다 — 적법 대상이 하나도 없으면(굴절을 낼 수 없는 유닛 제외) 체인에 올릴 수 없다(352.8).
  // 「공허의 추적자」를 드로우만 보고 내거나 「혼미」를 빈 보드에 내던 것 (RiftJudge #10726 · #9127).
  if(c.type==='Spell' && !(fx.counter||fx.steal) && !spellHasTargets(c.n, p, fromHidden ? bfIdx : undefined, fromHidden))
    return fromHidden ? '이 전장에 대상이 없어 숨김에서 공개할 수 없습니다 (룰 737)' : '적법한 대상이 없어 플레이할 수 없습니다 (룰 352.8)';
  if(G.state==='showdown'){
    if(!(fx.kw.action||fx.kw.reaction||fromHidden)) return '결전 중에는 [행동]/[반응] 카드만 플레이할 수 있습니다';
    // 체인 진행 중(Closed 상태)에는 [반응]만 응수 가능 (규칙 338.1.a.2)
    if(G.showdown && G.showdown.chain.length && !(fx.kw.reaction||fromHidden))
      return '체인 진행 중에는 [반응] 카드만 낼 수 있습니다';
    return null;
  }
  // 중립 응수 창: 창이 열린 플레이어는 자기 턴이 아니어도 [반응] 카드를 낼 수 있다 (닫힌 상태 응수 — 규칙 309.2)
  // [반응]은 주문뿐 아니라 유닛에도 붙는다 (룰 739.3 "On Units: ... during Closed States on any player's turn").
  // 「쉔 - 킨코우」가 그 유일한 예인데 주문만 허용하고 있어 상대 주문에 맞춰 낼 수가 없었다.
  if(G._rwFor===p && ((fx.kw.reaction && (c.type==='Spell'||c.type==='Unit')) || fromHidden)) return null;
  if(G.turn!==p) return '자신의 턴에만 플레이할 수 있습니다';
  if(G.phase!=='action') return '행동 단계에만 플레이할 수 있습니다';
  return null;
}

// 유닛을 '플레이'하는 모든 경로가 공유하는 합법 배치 위치.
// 손패 외 효과도 비용만 무시할 뿐 플레이 규칙과 카드의 배치 허용 효과는 그대로 적용된다.
function unitPlayLocationOptions(p, n){
  const fx=FX[n]||{kw:{}};
  const jailed=everyUnit().some(u=>u.ctrl!==p && u.loc!=='base' && unitFx(u).jailerUnits);
  const locs=[{v:'base',label:'기지',unitN:n}];
  if(!jailed){
    const openOK=fx.playToOpenBf || everyUnit().some(u=>u.ctrl===p && unitFx(u).openBfAura);
    G.bfs.forEach((bf,i)=>{
      if(bf.controller===p) locs.push({v:i,n:bf.n,label:`전장: ${card(bf.n).ko}`,unitN:n});
      else if(openOK && bf.controller===null && !bf.units.length)
        locs.push({v:i,n:bf.n,label:`빈 전장: ${card(bf.n).ko}`,unitN:n});
      // Deadbloom Predator: occupied enemy battlefield = 상대가 통제하며 유닛이 1기 이상 있는 전장.
      // 통제자만 남고 비어 있거나, 통제되지 않은 채 유닛만 있는 곳은 해당하지 않는다.
      else if(fx.playToEnemyBf && bf.controller!==null && bf.controller!==p && bf.units.length>0)
        locs.push({v:i,n:bf.n,label:`적 전장: ${card(bf.n).ko}`,unitN:n});
    });
  }
  return locs;
}
async function pickUnitPlayLocation(p, n){
  const locs=unitPlayLocationOptions(p,n);
  return locs.length===1 ? 'base' : await UI.pickOption(p,'유닛을 배치할 위치',locs);
}

// 드롭 목적지도 일반 플레이의 배치 규칙으로 확인한다. 도구는 손패에서 기지에만 낸다.
function canPlayCardAt(p, n, loc){
  const c=card(n);
  return c?.type==='Unit' ? unitPlayLocationOptions(p,n).some(x=>x.v===loc)
    : c?.type==='Gear' && loc==='base';
}

async function playCardFromHand(p, handIdx, opts={}){
  const P=G.players[p];
  if(opts.champZone && !P.champInZone){ UI.toast('챔피언이 챔피언 존에 없습니다','warn'); return false; }
  const n = opts.champZone ? P.champN : P.hand[handIdx];
  const c = card(n);
  const fx = FX[n]||{kw:{},triggers:{},activated:[],manual:[],playOps:[]};
  const sdAtStart = G.showdown;   // 이 카드로 결전이 새로 열린 경우와 구분하기 위해 시작 시점을 기억

  // 효과가 "플레이하라"고 시키는 경우(「눈부신 오로라」·폐기장 회수 등)는 그 효과 자체가 허가다.
  // 평소의 타이밍 제한(내 턴·행동 단계)에 걸리면 안 된다 — 종료 단계에 발동하는 오로라가
  // 여기서 막혀 실패했고, 그래서 위치 선택도 없이 기지 폴백으로만 나왔다.
  const byEffect = !!(opts.fromDeck || opts.fromTrash || opts.byEffect);
  // 단 '카드를 플레이할 수 없다'(브린히르 26 noPlay)는 타이밍이 아니라 금지라 효과 플레이에도 걸린다 —
  // 유망한 미래로 추방한 카드는 그대로 추방 상태로 남는다 (RiftJudge #6039 · 룰 100 불가능한 지시는 무시).
  const restr = byEffect ? (TF().noPlay[p] ? '이번 턴에는 카드를 플레이할 수 없습니다 (효과)' : null)
    : playRestriction(c, p, !!opts.fromHidden, opts.bfIdx);
  if(restr){ UI.toast(restr,'warn'); return false; }
  const hasPlayLoc=Object.prototype.hasOwnProperty.call(opts,'playLoc');
  if(hasPlayLoc && !canPlayCardAt(p,n,opts.playLoc)){
    UI.toast('이 카드는 그 위치에 플레이할 수 없습니다','warn'); return false;
  }

  // ── 수동 모드: 규칙 자동 처리 없이 카드만 배치, 효과는 로그로 안내 ──
  if(G.manual){
    let loc='base';
    if(c.type==='Unit'){
      // 공식 룰: 유닛은 기지 또는 자신이 통제 중인 전장에만 배치할 수 있다.
      // 수동 모드에서는 자동화되지 않은 배치 허용 효과(빈/적 전장 플레이 등)를 직접 처리할 수 있도록
      // 미통제 전장도 '효과 예외'로 남겨 두되, 경고 표기와 로그로 구분한다.
      const locs=[{v:'base',label:'기지'}];
      G.bfs.forEach((bf,i)=>{ if(bf.controller===p) locs.push({v:i,n:bf.n,label:`전장: ${card(bf.n).ko}`}); });
      G.bfs.forEach((bf,i)=>{ if(bf.controller!==p) locs.push({v:i,n:bf.n,label:`⚠ ${card(bf.n).ko} — 미통제 (배치 허용 효과가 있을 때만)`}); });
      loc = hasPlayLoc ? opts.playLoc : await UI.pickOption(p,'유닛을 배치할 위치 — 기본 규칙: 기지 또는 통제 중인 전장', locs);
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
  // 숨김 공개도 기본 비용만 0이 될 뿐(738.1) 추가 비용은 그대로 묻는다 — 룰 353 "ignore는 기본 비용만" (RiftJudge #2488)
  if(AC){
    if(AC.kind==='discard'){
      if(P.hand.length>1 || opts.champZone)
        addPaid = await UI.confirmP(p, `추가 비용: ${AC.label||'카드 1장 버리기'} — 지불할까요?`, c);
    } else if(AC.kind==='pip'){
      if(canPay(p, 0, [AC.dom]))
        addPaid = await UI.confirmP(p, `추가 비용: ${AC.label||AC.dom+' 힘 1'} — 지불할까요?`, c);
    } else if(AC.kind==='exhaustUnit'){
      const cands=everyUnit().filter(u=>u.ctrl===p&&!u.ex);
      if(cands.length && await UI.confirmP(p, `추가 비용: ${AC.label||'아군 유닛 탈진'} — 지불할까요?`, c)){
        addSel=await UI.pickUnitFrom(p,cands,'탈진할 아군 유닛'); addPaid=!!addSel;
      }
    } else if(AC.kind==='spendBuff'){
      const cands=everyUnit().filter(u=>u.ctrl===p&&u.buff>0);
      if(cands.length && await UI.confirmP(p, `추가 비용: ${AC.label||'버프 1개 소모'} — 지불할까요?`, c)){
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
  // 효과로 플레이하는 카드(폐기장·덱에서)는 비용만 면제된다. 배치·트리거·플레이 이벤트는 그대로다.
  // 영혼포식자·괴롭히는 밤은 에너지만 면제하고 힘은 내야 하므로 둘을 따로 받는다.
  if(opts.ignoreEnergy) energy=0;
  if(opts.ignorePower) pips=[];
  let accel = false;
  // 숨김에서 공개하면 '기본 비용'만 면제된다 (룰 738.1). [가속] 같은 추가 비용은 그대로 고를 수 있다
  // — 룰북도 "비용을 무시하고 플레이하되 가속 비용은 지불한다"를 예로 든다.
  // 효과의 에너지 할인(증원 62 "reducing its cost by 5")은 [가속] 에너지까지 합한 총액에서 뺀다 (룰 353 추가 비용 → 할인 순, RiftJudge #5164).
  const discE = opts.discountE||0;
  if(c.type==='Unit' && fx.kw.accelerate){
    const accPips = [ (c.dom&&c.dom.length===1)?c.dom[0]:'Any' ];
    if(canPay(p, Math.max(0,energy+1-discE), [...pips, ...accPips])){
      accel = await UI.confirmP(p, `[가속] 추가 비용(에너지 1+힘 1)을 지불하고 준비 상태로 등장시킬까요?`, c);
      if(accel){ energy+=1; pips=[...pips,...accPips]; }
    }
  }
  energy = Math.max(0, energy-discE);
  const spellOK = c.type==='Spell';   // 주문 전용 자원(럭스 314·카이사 전설 247)은 주문에만 쓸 수 있다
  // 룰 357.1.a: 비용 지불 단계에서 [반응] 태그의 자원 추가 능력을 발동해 비용을 충당할 수 있다
  // (카이사·다리우스 전설, 인장 등)
  const fundList=()=>{
    if(!(typeof polAbList==='function' && typeof polAbLegal==='function' && typeof polAbIsResource==='function')) return [];
    try{
      return polAbList(p).filter(cd=>cd.ab && cd.ab.reaction && polAbIsResource(cd) && polAbLegal(p,cd)
        && !(!spellOK && polAbOps(cd).some(o=>/^addSpell/.test(o))));   // 주문 전용 자원은 주문 지불에만
    }catch(e){ return []; }
  };
  // 모자랄 때만 물어보면, 룬을 재활용해 낼 수 있는 한 카이사 전설을 쓸 기회가 영영 없다.
  // 룬 재활용·탈진은 실제로 치르는 비용이므로, 그걸 아낄 수 있는 능력이 있으면 먼저 물어본다.
  for(let guard=0; guard<4 && canPay(p, energy, pips, spellOK) && payUsesRunes(p, energy, pips, spellOK); guard++){
    const funds=fundList();
    if(!funds.length) break;
    const sel=await UI.pickOption(p, `「${c.ko}」 룬을 쓰기 전에 [반응] 자원 능력을 먼저 쓸까요? (룰 357.1.a)`,
      [...funds.map((cd,i)=>({v:i, label:`⚡ ${cd.name} — ${cd.ab.label}`})), {v:'no', label:'그냥 지불 (룬 사용)'}]);
    if(sel===null || sel==='no') break;
    await activateAbility(p, funds[sel].src, funds[sel].ab);
  }
  // 그래도 모자라면 충당할지 묻는다 (여기서 취소하면 플레이 자체가 취소된다)
  for(let guard=0; guard<8 && !canPay(p, energy, pips, spellOK); guard++){
    const funds=fundList();
    if(!funds.length){ UI.toast('자원이 부족합니다','warn'); return false; }
    const sel=await UI.pickOption(p, `「${c.ko}」 자원이 부족합니다 — [반응] 자원 능력으로 충당할까요? (룰 357.1.a)`,
      [...funds.map((cd,i)=>({v:i, label:`⚡ ${cd.name} — ${cd.ab.label}`})), {v:'stop', label:'취소 (플레이 포기)'}]);
    if(sel===null || sel==='stop'){ UI.toast('자원이 부족합니다','warn'); return false; }
    await activateAbility(p, funds[sel].src, funds[sel].ab);
  }
  if(!canPay(p, energy, pips, spellOK)){ UI.toast('자원이 부족합니다','warn'); return false; }

  const legionOK = P.playedCards>=1;
  // ── 주문의 대상 지정: 비용을 내기 전(룰 352 선택 → 353 비용) ──
  // 응수 창·체인 적재보다 앞이라 해결 때 대상이 사라졌으면 그 지시만 불발(356.3.e). 굴절(735)은 여기서 본 비용과
  // 합산해 낼 수 있는 유닛만 고를 수 있고, 거부하면 다른 대상 — 남은 대상이 없으면 플레이 자체가 취소된다(352.8).
  let pre=null;
  if(c.type==='Spell' && !(fx.counter||fx.steal)){
    const hiddenBf=(opts.fromHidden && !fx.hiddenFreeTarget) ? opts.bfIdx : null;
    pre=await preTargetSpell(p, c, fx, {legionOK, bfIdx:opts.bfIdx, hiddenBf, cost:{energy, pips, spellOK}, byEffect});
    if(pre===PRE_CANCEL){ UI.toast('대상을 고르지 않아 플레이를 취소합니다 (룰 352.8 · 굴절 735)','warn'); return false; }
  }

  // 위치 선택 (유닛)
  let loc=null;
  if(c.type==='Unit'){
    if(opts.fromHidden) loc=opts.bfIdx;
    else {
      loc = hasPlayLoc ? opts.playLoc : await pickUnitPlayLocation(p, n);
      if(loc===null) return false;
    }
  }

  payCost(p, energy, pips, undefined, spellOK);
  // '다음 주문 할인'(격노한 화염룡 31)은 비용을 산정·지불하는 순간 소모된다 — 그 주문이 카운터당해도 되살아나지 않는다
  // (RiftJudge #4039 "consumed when you apply it during the process of playing"). 숨김·효과 플레이는 기본 비용이 0이라 적용된 적이 없다.
  if(c.type==='Spell' && !opts.fromHidden && !opts.ignoreEnergy) TF().nextSpellDisc[p]=0;

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

  // 주문은 '해결'돼야 플레이한 것이다 (룰 351.3 "Played when it has finished this process in its entirety" ·
  // 408.2 카운터된 카드는 플레이되지 않음) — 주문의 플레이 수는 fireSpellPlayEvents(해결 시점)에서 센다.
  // 카운터당한 첫 주문이 [군단] 할인·다리우스 '두 번째 카드'를 만족시키던 문제 (RiftJudge #5061).
  if(c.type!=='Spell') P.playedCards++;

  UI.log(`${pname(p)} 「${c.ko}」 ${opts.fromTrash?'폐기장에서 ':''}플레이`, 'p'+p);

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

    const u = makeUnit(n, p, {loc, ready:enterReady, owner:opts.owner});   // owner: 상대 카드를 내가 플레이(눈먼 분노 25)
    placedU=u;
    placeUnit(u, loc);
    UI.render();
    // 위력적 유닛 훅 (볼리베어) — '플레이할 때' 판정은 유닛이 확정·등장한 직후, 등장 격발이 해결되기 전이다
    // (룰 375 Play Effects: 등장 격발은 유닛이 보드에 들어온 '뒤' 체인에 오른다 · 376.2.a 격발 조건은 사건 처리 직후 평가).
    // 자기 버프 등장 효과로 5⚔가 되는 유닛(위험한 2인조·세트)은 격발하지 않고, 상시 +1(전쟁 야영지)은 이미 반영돼 있다
    // — RiftJudge #1160 · #5990.
    if(isMighty(u)) await legendHook(p,'hookMightyPlay',{p, unit:u});
    // 통찰 (자체 키워드 또는 오라)
    if(fx.kw.vision || effKw(u).vision) await visionCheck(p);
    // 플레이 트리거
    await runTriggerList(fx.triggers.onPlay, {p, unit:u, bfIdx: (loc!=='base'?loc:null), legionOK, paidAdd:addPaid, addCount,
      hiddenBf: (opts.fromHidden && !fx.hiddenFreeTarget) ? opts.bfIdx : null});
    // 적 전장에 '플레이해서' 들어가는 것도 공격이다 (룰 184.3.b — 이동하거나 플레이되면 경합).
    // 「죽음꽃 포식자」를 유지된 적 전장에 내면 상대의 「아리 - 구미호」가 반응해야 한다.
    await fireAttackTriggers(u, loc);
    if(fx.manual.length) UI.manualNotice(c);
  }
  else if(c.type==='Spell'){
    UI.render();
    // ── 결전 중(자동 모드): 즉시 해결하지 않고 체인에 적재 — 공식 규칙 337~340 ──
    if(G.state==='showdown' && G.showdown){
      const sd=G.showdown;
      const item={ kind:(fx.counter||fx.steal)?'counter':'spell', p, n, fx,
        legionOK, addPaid, addCount, bfIdx:opts.bfIdx, steal:!!fx.steal, countered:false,
        // 체인은 나중에 해결되므로 '숨김에서 나왔다'는 사실을 항목이 들고 간다 (룰 737 대상 제한 · 해결 시 onPlayFromHidden)
        fromHidden: !!opts.fromHidden,
        hiddenBf: (opts.fromHidden && !fx.hiddenFreeTarget) ? opts.bfIdx : null };
      if(item.kind==='counter'){
        // 카운터/탈취: 체인 위의 미해결 상대 주문을 대상으로 지정 (플레이 시점 대상 지정 — 규칙 355)
        // 카운터도 주문이므로 '카운터의 카운터'가 가능하다 (kind:'counter'도 대상에 포함)
        // 대상이 없으면 playRestriction이 이미 거부했다 (룰 352 Targeting) — 여기서는 비어 있지 않다
        const targets=counterTargets(p, fx);   // 상대 주문이 앞(최신 순) — 봇의 기본 선택·미선택 폴백이 상대 주문을 잡는다
        item.target = targets.length===1 ? targets[0]
          : await UI.pickOption(p, '대응할 주문 선택', targets.map(x=>({v:x, label:`${card(x.n).ko}${x.p===p?' (내 주문)':''}`, n:x.n})));
        if(!item.target) item.target=targets[0];
      }
      // 대상은 비용을 내기 전에 이미 골랐다 (룰 352.8.a) — 해결 때 대상이 사라졌으면 그 지시만 불발 (356.3.e)
      if(item.kind==='spell') item.pre = pre;
      sd.chain.push(item);
      if(sd.chain.length===1) sd.chainStarter=p;
      UI.fx.chainAdd(c, p, sd.chain.length);
      UI.log(`🔗 ${pname(p)} 「${c.ko}」 체인에 적재 (#${sd.chain.length}) — 양측 패스 시 마지막 것부터 해결`, 'p'+p);
      // 적재는 아직 해결이 아니다 — 플레이 이벤트(onPlayFromHidden 포함)는 이 항목이 체인에서 해결될 때 난다
      // (룰 407.3.a · 408.2: 카운터당한 숨김 주문에 「잉걸불 수도승」이 +2를 받으면 안 된다 — RiftJudge #724)
      await cleanup(p);
      UI.render();
      showdownActed(p);      // 패스 카운터 리셋 — 우선권은 적재자(p)가 유지 (연속 적재 가능)
      return true;
    }
    // ── 중립 상태: 기존 즉시 해결 + 대응 창 ──
    let execAs=p, countered=false;
    // 대상은 응수 창이 열리기 전(비용 지불 전)에 골랐다 — 응수로 대상이 사라지면 그 지시만 불발 (356.3.e)
    const hiddenBf=(opts.fromHidden && !fx.hiddenFreeTarget) ? opts.bfIdx : null;
    // 숨김에서 플레이하는 것도 체인을 연다 (룰 737) — 예전에는 중립 상태에서 응수 창을 건너뛰어
    // 숨겨 둔 주문만 카운터가 통하지 않았다. 결전 중에는 원래대로 체인에 적재된다.
    // 효과가 해결 중에 플레이하는 주문(유망한 미래)은 그 해결의 일부라 응수 창이 열리지 않는다
    // (룰 351 1단계 "다른 효과가 해결 중이면 그것을 마저 해결" · RiftJudge #3955).
    if(!fx.counter && !fx.steal && !byEffect){
      const cw=await counterWindow(p, c, {legionOK, addPaid, addCount, bfIdx:opts.bfIdx});
      if(cw && cw.countered) countered=true;
      else if(cw && cw.steal!==undefined) execAs=cw.steal;
    }
    // (카운터/탈취 주문은 중립 상태에선 대상이 될 주문이 없으므로 playRestriction이 거부한다 — 여기 오지 않는다)
    if(!countered) await resolveSpellEffects(p, n, fx, {legionOK, addPaid, addCount, bfIdx:opts.bfIdx, execAs, hiddenBf, pre,
      fromHidden:!!opts.fromHidden});
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
  // 주문은 여기가 아니라 해결될 때 낸다 (룰 356.3.e.11) — 카운터당하면 아예 나지 않는다 (룰 2848).
  // 유닛·도구는 플레이와 동시에 보드에 들어가므로 여기가 곧 해결 시점이다.
  if(c.type!=='Spell'){
    await fireEvent('onYouPlayCard', evctx);
    if(c.type==='Unit') await fireEvent('onYouPlayUnit', evctx);
    if(G.turn!==p) await fireEvent('onYouPlayOppTurn', evctx);
    if(opts.fromHidden) await fireEvent('onPlayFromHidden', evctx);   // 주문은 fireSpellPlayEvents(해결 시점)에서
  }

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

// 결전 중 카운터/탈취 주문이 대상으로 삼을 수 있는 체인 항목 (중립 상태에선 체인이 없으므로 빈 배열).
// playRestriction(플레이 가능 여부)과 체인 적재(대상 선택)가 같은 목록을 본다.
// "Counter a spell"은 진영 제한이 없다 — 자기 주문도 대상이 된다(리포스트 무력화 등, RiftJudge #8450 · #5306). 자기 자신은 불가(352.9).
// 목록은 상대 주문을 먼저(각각 최신 순)·내 주문을 뒤에 둔다 — 단일 후보 자동 선택·봇의 첫 항목 선택이 상대 주문을 잡도록.
function counterTargets(p, fx){
  if(!(G.state==='showdown' && G.showdown)) return [];
  const all=G.showdown.chain.filter(x=>(x.kind==='spell'||x.kind==='counter') && !x.countered && !x.resolved)
    .filter(x=>{ const tc=card(x.n); const lim=fx.counter;
      if(lim && lim.maxE!==undefined && (tc.e||0)>lim.maxE) return false;
      if(lim && lim.maxPips!==undefined && powerPips(tc).length>lim.maxPips) return false;
      return true; }).reverse();
  return [...all.filter(x=>x.p!==p), ...all.filter(x=>x.p===p)];
}

// "카드/주문을 플레이할 때" 트리거는 그 주문이 '완전히 해결된 뒤'에 난다 (룰 407.3.a "the act of playing
// the card has been completed by the resolution of the card" · 356.3.e.11 예시). 플레이 수(playedCards)도 여기서
// 센다 — 카운터당한 주문은 여기까지 오지 않아 플레이한 것으로 치지 않는다 (룰 408.2 · Counter "not considered played").
// p는 해결 시점의 통제자(탈취됐으면 탈취자 — 룰 155.2 "A spell is controlled by the player who played it", RiftJudge #6678).
// fromHidden: 숨김에서 낸 주문의 onPlayFromHidden도 같은 시점에 (RiftJudge #724 · #10883).
async function fireSpellPlayEvents(p, n, fromHidden){
  const P=G.players[p];
  P.playedCards++;
  const evctx={p, n, type:'Spell', seq:P.playedCards, unit:null, paidAdd:false};
  await fireEvent('onYouPlayCard', evctx);
  await fireEvent('onYouPlaySpell', evctx);
  if(G.turn!==p) await fireEvent('onYouPlayOppTurn', evctx);
  if(fromHidden) await fireEvent('onPlayFromHidden', evctx);
}

// ---------- 주문 효과 해결 (즉시 해결 경로와 체인 해결 경로가 공유) ----------
async function resolveSpellEffects(p, n, fx, o){
  const c=card(n); const P=G.players[p];
  const execAs=o.execAs??p;
  UI.fx.cast(c, p);
  // 시전 주체는 해결 시점의 통제자 — 탈취(신비한 반전 80)됐으면 탈취자다(룰 "A spell is controlled by the player who played it" ·
  // RiftJudge #1393): 「갈까마귀 마도서」 추가 피해·주문 처치 귀속 모두 탈취자 기준.
  G._casting=execAs; G._banishSpell=false;
  let pre=o.pre||null;
  // 탈취자는 "새 선택을 할 수 있다"(카드 원문) — 대상 지시를 탈취자 기준(적/아군이 뒤집힘)으로 다시 고른다. 적법 대상이 있으면
  // 골라야 하고(#4630 "cannot choose no target"), 없으면 그 지시만 불발(byEffect). 굴절은 재지불 없음(#3088). 숨김 제한(hiddenBf)은 유지.
  if(execAs!==p && !fx.reflexive && fx.playOps.some(po=>po.ops.some(op=>preTargetSpecs(op).length))){
    const np=await preTargetSpell(execAs, c, fx, {legionOK:o.legionOK, bfIdx:o.bfIdx, hiddenBf:o.hiddenBf??null,
      cost:{energy:0,pips:[],spellOK:true,noDeflect:true}, byEffect:true});
    if(np!==PRE_CANCEL) pre=np;
  }
  if(fx.playOps.length){
    for(const po of fx.playOps){
      if(po.legion && !o.legionOK){ UI.log(`[군단] 조건 미충족 — 효과 생략`, 'sys'); continue; }
      await execOps(po.ops, {p:execAs, legionOK:o.legionOK, bfIdx:o.bfIdx, kind:'spell', paidAdd:o.addPaid, addCount:o.addCount,
        hiddenBf:o.hiddenBf??null, pre});
    }
  }
  // 소모형 플래그 해제 (다음 주문 할인/보너스) — 탈취됐으면 탈취자의 보너스가 쓰였다
  TF().nextSpellDisc[p]=0; TF().nextSpellBonus[p]=0; TF().nextSpellBonus[execAs]=0;
  G._casting=null;
  if(fx.manual.length) UI.manualNotice(c);
  if(G._banishSpell){ P.banish.push(n); G._banishSpell=false; UI.log(`「${c.ko}」 추방됨`, 'sys'); }
  else trashCard(p, n);
  // 주문이 체인을 떠나면 먼저 클린업(치명 피해 사망 — 룰 319.7 · 322 2a)이 일어나고, 그 다음에야
  // '주문을 플레이할 때' 격발이 난다. 예전엔 격발이 효과보다 먼저 나서 「레이븐블룸 학생」이 자기 피해 주문에서
  // +1로 살아남고, 「돌풍」의 위력 3 이하 필터에서 빠졌다 (RiftJudge #4359 · #8306). 「빙의」로 뺏어온 다리우스도
  // 이제 '두 번째 카드'를 본다 (#245). 사망 처리만 하고 결전 개시 등은 호출자의 cleanup에 맡긴다.
  // 「불멸의 불사조」의 '주문으로 처치' 반응(처치 지시·피해 사망 모두)은 cleanupDeaths 끝의 spellKillReactions가 연다.
  await cleanupDeaths();
  await fireSpellPlayEvents(execAs, n, !!o.fromHidden);
}

// 주문으로 유닛을 처치한 뒤의 폐기장 반응 (불멸의 불사조 37 fromTrashOnSpellKill). 귀속은 killUnit이
// G._spellKilledBy[시전자]에 적는다 — 처치 지시, 피해 주문 뒤 클린업 사망(416), 칙령·단두대 표식 처치(#7364) 모두.
// 예전엔 resolveSpellEffects 안에서 G._casting이 살아 있는 동안의 처치만 보아 「마법공학 광선」 같은 피해 주문이
// 한 번도 불사조를 열지 못했고, 자기 유닛(불사조 자신 포함, 376.2.c 예시)을 처치해도 열리지 않았다.
async function spellKillReactions(){
  const by=G._spellKilledBy; if(!by) return;
  G._spellKilledBy=null;
  for(const p of [0,1]){
    if(!by[p]) continue;
    const P=G.players[p];
    for(const tn of [...new Set(P.trash)]){
      const tfx=FX[tn]; if(!tfx || !tfx.fromTrashOnSpellKill) continue;
      const cost=tfx.fromTrashOnSpellKill;
      // 폐기장의 같은 카드는 장마다 따로 격발한다(#6871) — 한 장씩 비용을 내고 플레이
      for(let left=P.trash.filter(x=>x===tn).length; left>0; left--){
        if(!canPay(p, cost.energy||0, cost.pips||[])) break;
        const yes=await UI.confirmP(p, `「${card(tn).ko}」을(를) 폐기장에서 플레이할까요? (비용 지불)`, card(tn));
        if(!yes) break;
        payCost(p, cost.energy||0, cost.pips||[]);
        // 정식 플레이 경로(playFromTrash와 동일): 기지 또는 통제 중인 전장 — 방어 중인 결전 전장 포함, 공격 중인
        // 전장은 통제가 아니라 불가(#10688) — 위치 선택·등장 준비·플레이 격발이 모두 처리된다. 비용은 위에서 냈다.
        const ti=P.trash.indexOf(tn);
        P.trash.splice(ti,1); P.hand.unshift(tn);
        const ok=await playCardFromHand(p,0,{fromTrash:true,ignoreEnergy:true,ignorePower:true});
        if(ok===false){ if(P.hand[0]===tn) P.hand.shift(); P.trash.splice(ti,0,tn); }
        else UI.log(`「${card(tn).ko}」 폐기장에서 플레이!`, 'p'+p);
      }
    }
  }
}

// 덱·보드 밖(추방)에서 효과로 카드를 '플레이'하는 공용 경로 — 손패 맨 앞에 잠시 넣고 정식 플레이(playCardFromHand)로 보낸다.
// 그래야 배치 위치(352.3~5)·[가속]·추가 비용·플레이 이벤트·[통찰]이 손패 플레이와 같다 — "ignoring its cost"는 기본 비용만 0으로
// 만든다(룰 353 3단계, 군단 후위병 예시). 차원문 구출·증원·미끼 바늘·유망한 미래·녹턴이 쓴다(눈부신 오로라는 자체 폴백 유지).
// 플레이하지 못하면(추가 비용 불가·플레이 금지·취소) 카드는 추방 상태로 남는다 (RiftJudge #3955 · #5989 · #6039).
async function playCardByEffect(p, n, opts){
  const P=G.players[p];
  P.hand.unshift(n);
  const ok=await playCardFromHand(p, 0, {byEffect:true, ...(opts||{})});
  if(ok===false){
    if(P.hand[0]===n) P.hand.shift();
    P.banish.push(n);
    UI.log(`「${card(n).ko}」 플레이하지 못해 추방 상태로 남음`, 'sys');
  }
  return ok!==false;
}
// 녹턴(194) "덱 맨 위에서 나를 보거나 공개할 때, 나를 추방할 수 있다. 그렇게 했다면 ✳을 지불하고 나를 플레이할 수 있다" (카드 원문).
// '본다'는 경로(조작된 덱·[통찰]·증원·미끼 바늘·유망한 미래)가 공유한다. seen은 덱에서 이미 뺀 카드 목록 — 플레이한 장은 제거해 돌려준다.
// 플레이한 녹턴은 조작된 덱의 '손패 1장'에 들지 않는다 (RiftJudge #9759 · #6744).
async function nocturneOffer(p, seen){
  for(let i=seen.length-1;i>=0;i--){
    const n=seen[i]; const fx=FX[n];
    if(!fx || !fx.nocturne || !canPay(p, 0, ['Any'])) continue;
    const yes=await UI.confirmP(p, `「${card(n).ko}」: 추방하고 힘 1(✳)을 지불해 플레이할까요?`, card(n));
    if(!yes) continue;
    seen.splice(i,1);
    payCost(p, 0, ['Any']);
    UI.log(`${pname(p)} 「${card(n).ko}」 덱 위에서 추방 → 플레이`, 'p'+p);
    await playCardByEffect(p, n, {ignoreEnergy:true, ignorePower:true});
  }
}

// ---------- 대응 창 (카운터/탈취 주문 — 중립 상태 전용, 결전 중에는 체인이 담당) ----------
// 중립 상태 응수 창 (구 counterWindow 확장) — 공식 규칙 근거:
//  · '주문'을 내면 체인이 생기고 상태가 닫힌다 (333.1.a / Playing Cards 1단계)
//  · 닫힌 상태에서는 [반응] 카드만 낼 수 있다 (309.2)
//  · 단 유닛·도구는 확정 즉시 해결되어 응수 대상이 아니다 (333.1.c) — 주문에만 이 창이 열린다
//  · 카운터/탈취는 '주문'에만 (저항: "Counter a spell") — 기존 제한 유지
//  · 일반 [반응]은 즉시 해결(LIFO — 대기 중인 주문보다 먼저), 그 반응에 대한 재응수 창은
//    playCardFromHand 재귀로 자연히 열린다. 응수할 카드가 없으면 조용히 지나간다(속도 유지).
async function reactionWindow(caster, c, context={}){
  if(G.manual) return null;
  const o=opp(caster);
  let result=null;
  for(let guard=0; guard<20; guard++){
    const O=G.players[o];
    const opts=[];
    O.hand.forEach((hn,i)=>{
      const fx=FX[hn]; if(!fx||!fx.kw||!fx.kw.reaction) return;
      // [반응] 유닛도 닫힌 상태에서 낼 수 있다 (룰 739.3). 유닛은 카운터가 아니므로
      // 아래 카운터 분기는 그대로 지나가고 정식 플레이 경로(배치 위치 선택 포함)를 탄다.
      const cc=card(hn); if(cc.type!=='Spell' && cc.type!=='Unit') return;
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
      // pendingSpell: 아직 해결되지 않은 상대 주문. 봇이 "이걸 맞고 나면 어떻게 되는가"를
      // 재어 볼 때 쓴다. 이미 무효화된 뒤(result)라면 대기 중인 주문이 없다.
      opts.push({v:{hand:i}, label:`⚡ ${cc.ko} (비용 ${cost}${pips.length?' + 힘'+pips.length:''})`,
        isCounter:!!(fx.counter||fx.steal), card:cc,
        pendingSpell: result ? null : {...context, p:caster, n:c.n}});
    });
    // [반응] 활성화 능력도 닫힌 상태 응수로 발동할 수 있다 (규칙 309.2)
    if(typeof polAbList==='function' && typeof polAbLegal==='function'){
      try{
        for(const cand of polAbList(o)){
          if(!cand.ab || !cand.ab.reaction) continue;
          if(!polAbLegal(o, cand)) continue;
          opts.push({v:{ab:cand}, label:`⚡ [능력] ${cand.name} — ${cand.ab.label}`, isCounter:false});
        }
      }catch(e){}
    }
    // 숨김(뒷면) 카드는 뒷면인 동안 [반응]이다(739.1) — 중립 응수 창에서도 숨겨 둔 전장에서 공개해 응수할 수 있다
    // (「물결을 바꾸는 자」로 매혹에 응수 — RiftJudge #10372 · #7111). 숨긴 턴·파괴공작원·타이밍/대상(737)·배치 불가는 제외.
    G.bfs.forEach((bf,bi)=>{
      if(bf.units.some(u=>u.ctrl!==o && unitFx(u).blockReveal)) return;
      bf.hiddenCards.forEach(hc=>{
        if(hc.by!==o || (hc.turn===G.turnCount && G.turn===o)) return;
        const hcard=card(hc.n); if(!hcard) return;
        const prevRw=G._rwFor; G._rwFor=o;
        let bad=null; try{ bad=playRestriction(hcard, o, true, bi); } finally{ G._rwFor=prevRw; }
        if(bad) return;
        if(hcard.type==='Unit' && !unitPlayLocationOptions(o, hc.n).some(x=>x.v===bi)) return;
        opts.push({v:{hidden:{bf:bi, h:hc}}, label:`🂠 숨김 카드 공개: ${hcard.ko} (${card(bf.n).ko})`, isCounter:false});
      });
    });
    if(!opts.length) return result;
    const sel=await UI.pickReaction(o, `${pname(caster)}이(가) 「${c.ko}」 플레이 — [반응]으로 응수할까요?`, opts);
    if(sel===null||sel===undefined) return result;
    // [반응] 능력 발동 (즉시 해결)
    if(typeof sel==='object' && sel.ab){
      await activateAbility(o, sel.ab.src, sel.ab.ab);
      if(G.winner!==null) return result;
      continue;
    }
    // 숨김 카드 공개 — 정식 숨김 플레이 경로(playHidden → playCardFromHand fromHidden), 먼저 해결되고 재응수 창은 그 안에서 열린다
    if(typeof sel==='object' && sel.hidden){
      const prevRw=G._rwFor, prevPending=G._returnPending;
      G._rwFor=o;
      G._returnPending = result ? null : {...context, p:caster, n:c.n};
      try{ await playHidden(o, sel.hidden.bf, sel.hidden.h); }
      finally{ G._rwFor=prevRw; G._returnPending=prevPending; }
      if(G.winner!==null) return result;
      continue;
    }
    const idx = (typeof sel==='object') ? sel.hand : sel;   // 구형 응답(인덱스) 호환
    const hn=O.hand[idx]; if(hn===undefined) return result;
    const rfx=FX[hn]; const cc=card(hn);
    if(rfx.counter||rfx.steal){
      payCost(o, cc.e||0, powerPips(cc));
      O.hand.splice(idx,1);
      // 카운터도 '플레이한 주문'이다. 이 경로는 playCardFromHand를 거치지 않으므로
      // 플레이 이벤트(+플레이 수)도 아래 fireSpellPlayEvents에서 직접 낸다 (「레이븐블룸 학생」 등이 이걸 본다).
      // 카운터도 주문 — 원 시전자가 '카운터의 카운터'로 재응수할 수 있다 (재귀 창)
      const sub=await reactionWindow(o, cc);
      trashCard(o, hn);
      if(sub && (sub.countered || sub.steal!==undefined)){
        UI.log(`⚡「${cc.ko}」 — 무효화되어 효과 없음`, 'sys');
        UI.render();
        continue;                                // 카운터당했으니 플레이 이벤트도 나지 않는다 (룰 2848)
      }
      await fireSpellPlayEvents(o, hn);           // 여기서 실제로 해결된다
      if(rfx.steal){ UI.log(`⚡「${cc.ko}」: 「${c.ko}」의 통제권 탈취!`, 'p'+o); result={steal:o}; }
      else { UI.log(`⚡「${cc.ko}」: 「${c.ko}」 무효화!`, 'p'+o); result={countered:true}; }
      UI.render();
      continue;                                  // 상대는 이어서 다른 반응도 낼 수 있다
    }
    // 일반 반응: 정식 플레이 경로로 — 먼저 해결되고(LIFO), 그 안에서 caster의 재응수 창이 열린다
    const prevRw=G._rwFor, prevPending=G._returnPending;
    G._rwFor=o;
    G._returnPending = result ? null : {...context, p:caster, n:c.n};
    try{ await playCardFromHand(o, idx, {}); }
    finally{ G._rwFor=prevRw; G._returnPending=prevPending; }
    if(G.winner!==null) return result;
  }
  return result;
}
const counterWindow = reactionWindow;   // 구명 호환

// 통찰: 덱 맨 위 확인 → 재활용 여부
// 토큰도 '플레이'된 유닛이다 (룰 351.3 "Tokens are not cards, but can still be Played") — 오라로 얻은 [통찰](743.2.b
// 보드 진입이 격발)과 '유닛을 플레이할 때' 리스너(시트리아 139)가 봐야 한다. 카드가 아니므로 playedCards·onYouPlayCard는 제외.
// 「선봉대 소집」 신병 4기가 「보석세공 예언자」 오라의 [통찰]을 전혀 격발하지 않던 문제 (RiftJudge #5092).
async function tokenPlayed(p, u){
  if(effKw(u).vision) await visionCheck(p);
  await fireEvent('onYouPlayUnit', {p, n:0, type:'Unit', seq:G.players[p].playedCards, unit:u, paidAdd:false});
}
async function visionCheck(p){
  const P=G.players[p];
  if(!P.deck.length) return;
  let top=P.deck[0];
  // [통찰]도 '덱 맨 위를 본다' — 녹턴이면 먼저 추방·플레이를 물어본다 (743.2 · 카드 원문)
  if(FX[top] && FX[top].nocturne){
    const seen=[P.deck.shift()]; await nocturneOffer(p, seen);
    if(!seen.length) return;
    P.deck.unshift(top);
  }
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
  const sel = myBfs.length===1? myBfs[0].i : await UI.pickOption(p,'카드를 숨길 전장', myBfs.map(x=>({v:x.i,label:card(x.bf.n).ko,n:x.bf.n})));
  if(sel===null) return;
  if(fromChamp) P.champInZone=false; else P.hand.splice(handIdx,1);
  G.bfs[sel].hiddenCards.push({n, by:p, turn:G.turnCount});
  UI.log(`${pname(p)} ${fromChamp?'챔피언 존의 카드':'카드'}를 전장에 뒷면으로 숨김`, 'p'+p);
  UI.render();
}

// 대상 주문은 '모든' 대상에 적법한 후보가 있어야 체인에 올릴 수 있다 (룰 352.8 "valid choices must be made for
// all targets") — 플레이 시점에 고르는 지시(preTargetSpecs)마다 후보를 세고, 굴절(735)을 본 비용과 함께 낼 수 없는
// 유닛은 후보에서 뺀다. 숨김 공개는 숨겨 둔 전장 안에서만(737, bfIdx). 「떨어지는 별」처럼 반사 격발이 고르는
// 주문(fx.reflexive)은 플레이 시점 대상이 없다(352.8.b · 383). 수동 모드는 검사하지 않는다.
function spellHasTargets(n, p, bfIdx, fromHidden){
  const fx=FX[n], c=card(n);
  if(G.manual || !fx || fx.reflexive || !fx.playOps || !fx.playOps.length) return true;
  const saved=[_ctxBf,_hiddenBf,_ctxUnit,_curKind];
  _ctxBf=bfIdx??null; _hiddenBf=(bfIdx!==undefined && bfIdx!==null && !fx.hiddenFreeTarget) ? bfIdx : null; _ctxUnit=null; _curKind='spell';
  try{
    const cost = fromHidden ? {energy:0,pips:[],spellOK:true} : {energy:applyCostMods(p, c, c.e||0), pips:powerPips(c), spellOK:true};
    const legionOK=G.players[p].playedCards>=1, prev=[];
    for(const po of fx.playOps){
      if(po.legion && !legionOK) continue;
      for(const op of po.ops) for(const ent of preTargetSpecs(op)){
        const spec = typeof ent==='function' ? ent(p, prev) : ent;
        if(spec.battlefield) continue;                       // 전장 대상(쌍권총 난사)은 항상 있다
        const cands=unitsBySpec(spec, p).filter(u=>canPayDeflect(p, u, cost));
        if(!cands.length && !spec.optional) return false;
        prev.push(cands[0]||null);                          // 뒤 지시의 '다른 유닛' 계산용 (첫 후보로 근사)
      }
    }
  } finally { [_ctxBf,_hiddenBf,_ctxUnit,_curKind]=saved; }
  return true;
}

async function playHidden(p, bfIdx, chosen){   // chosen: 호출자가 이미 고른 숨김 카드 항목 (중립 응수 창)
  const bf=G.bfs[bfIdx];
  // 녹서스 파괴공작원: 이곳의 상대 [숨겨짐] 카드는 공개 불가
  if(bf.units.some(u=>u.ctrl!==p && unitFx(u).blockReveal)){
    UI.toast('「녹서스 파괴공작원」: 이곳의 숨긴 카드를 공개할 수 없습니다','warn'); return;
  }
  const mine = bf.hiddenCards.filter(h=>h.by===p);
  if(!mine.length) return;
  const playable = mine.filter(h=>!(h.turn===G.turnCount && G.turn===p));
  if(!playable.length){ UI.toast('숨긴 턴에는 플레이할 수 없습니다','warn'); return; }
  let h = (chosen && playable.includes(chosen)) ? chosen : playable[0];
  if(!(chosen && playable.includes(chosen)) && playable.length>1){
    const sel=await UI.pickOption(p,'플레이할 숨김 카드',playable.map(x=>({v:x,label:card(x.n).ko,n:x.n})));
    if(!sel) return;
    h=sel;
  }
  const n=h.n;
  // 안 되는 타이밍이면 공개 전에 거른다 (공개했다가 되돌리면 카드 정보만 새 나간다)
  // (룰 737: 그 전장에 합법 대상이 없는 주문은 숨김에서 플레이할 수 없다 — playRestriction이 bfIdx로 함께 본다)
  const restr = playRestriction(card(n), p, true, bfIdx);
  if(restr){ UI.toast(restr,'warn'); return; }
  // 숨김 유닛은 그 전장에 등장하는데(737.2) 「마법사냥꾼 간수」(70)가 전장에 있으면 상대 유닛은 기지에만 낼 수 있어
  // 합법 배치 위치가 없다 → 공개(확정) 불가 (RiftJudge #4573 · #344)
  if(card(n).type==='Unit' && !unitPlayLocationOptions(p, n).some(x=>x.v===bfIdx)){
    UI.toast('이 전장에 유닛을 낼 수 없어 숨김에서 공개할 수 없습니다 (마법사냥꾼 간수 등)','warn'); return; }
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
    if(u.ex){ UI.toast(`${unitName(u)}: 탈진된 유닛은 이동할 수 없습니다`,'warn'); return false; }
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
      const yes=await UI.confirmP(p, `「${unitName(t)}」도 함께 이동할까요?`, unitCard(t));
      if(yes){ removeUnit(t); placeUnit(t,dest); t.turnMoves=(t.turnMoves||0)+1; UI.log(`${unitName(t)} 동행 이동`, 'p'+p); }
    }
  }
  // 공격 트리거 — 이동·플레이가 같은 판정을 쓴다
  for(const u of units) await fireAttackTriggers(u, dest);
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
// 치명 피해 사망 (+ 황제의 칙령 표식) — 클린업의 사망은 한 번의 게임 행동이므로
// 먼저 전부 추려 놓고 한 배치로 처리한다 (룰 322 2a · 376.3.b). cleanup 본체와,
// 주문이 체인을 떠난 직후(플레이 격발 전 — resolveSpellEffects)가 같이 쓴다.
async function cleanupDeaths(){
  if(G.manual) return;
  // 사망으로 보드가 바뀌면(리 신 오라 소실 등) 치명 판정을 다시 한다 — "변화가 없을 때까지 반복"(룰 322 · #6390)
  for(let pass=0; pass<8; pass++){
    const lethal=[];
    for(const u of everyUnit()){
      // 전투 결전 중에는 공/방 지정 위력([맹공]·[보호막] 등)을 치명 판정에도 반영 (룰 704/727)
      let m=might(u);
      if(G.showdown && G.showdown.hasCombat && u.loc===G.showdown.bfIdx)
        m=might(u, u.ctrl===G.showdown.attacker?'attacker':'defender', {forKill:true});
      if((u.dmg>0 && u.dmg>=m) || u._decree) lethal.push(u);
    }
    if(!lethal.length) break;
    await killUnitsTogether(lethal, {byDamage:true});
  }
  await spellKillReactions();
}
async function cleanup(actor){
  if(G.manual) return; // 수동 모드: 자동 사망·결전·전투 없음 (플레이어가 직접 처리)
  await cleanupDeaths();
  if(G.winner!==null) return;
  // 빈 전장 통제 해제 (결전 중 상호 전멸 등도 이후 클린업에서 처리됨)
  releaseEmptyBattlefields();
  // 경합 확인 (중립 상태에서만 새 결전 개시 — 종료 격발 처리 중(_holdShowdown)에는 endTurn이 끝나고 연다)
  if(G.state!=='neutral' || G._holdShowdown) return;
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
  // 공격/방어 지정과 그 격발은 '전투'가 있을 때만 (전투 1단계 — 무혈 결전에는 공격자도 방어자도 없다 #4707).
  // 지정(가면 스냅샷 포함) → 전장 [방어 시] → 방어측 유닛 격발 → 공격측 유닛 격발 순 (fireDesignationTriggers).
  if(hasCombat){
    const fresh = designateUnits(G.showdown, [...bf.units]);
    // 전장 트리거: 방어 시 (방어자가 이 전장의 통제자일 때)
    if(bf.controller===opp(attacker))
      await fireBfTrigger(bfIdx,'onDefendHere',{p:opp(attacker), bfIdx});
    await fireDesignationTriggers(G.showdown, fresh);
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
      bfIdx:(it.unit&&it.unit.loc!=='base')?it.unit.loc:null, pre:it.pre||null});
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
    await fireSpellPlayEvents(it.p, it.n, !!it.fromHidden);   // 카운터 주문도 지금 해결된다
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
    {legionOK:it.legionOK, addPaid:it.addPaid, addCount:it.addCount, bfIdx:it.bfIdx, execAs:it.execAs??it.p,
     hiddenBf:it.hiddenBf??null, pre:it.pre||null, fromHidden:!!it.fromHidden});
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
  let deferred=[];   // 전투 사망의 보류 격발 (종소리 등) — 전투 정리·통제 확립 뒤에 해결

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
    // 전투 사망의 [죽음의 종소리]·사망 이벤트는 보류해 두고 전투 정리(치유·귀환) 뒤에 해결한다 — 정리 중엔 체인 항목이
    // 해결되지 않는다(룰 322). 예전엔 종소리 피해가 바로 다음 줄의 치유에 지워져 아무도 죽이지 못했다(#7226 · #10750).
    _deferDeathFx=[];
    try { await killUnitsTogether(dead, {byDamage:true}); }   // 전투 피해로 함께 죽는다 — 서로의 죽음을 보지 못한다
    finally { deferred=_deferDeathFx; _deferDeathFx=null; }
  }

  // 해결 단계: 전투 정리(Combat Cleanup 2c~2e)는 '전투'가 있었을 때만 — 치유는 턴 종료와 전투 정리에서만 일어나고
  // (룰 142.4) 빈 전장의 무혈 결전은 전투가 아니다(437 · #9878 · #8342). 전투가 열린 뒤 한쪽이 빠져나갔어도 치유(#10674).
  if(sd.hasCombat){
    // 모든 유닛 치유 (공식: 전장 밖 유닛 포함)
    everyUnit().forEach(u=>{ u.dmg=0; u._spellDmgBy=null; });
    // "이번 전투" 한정으로 부여된 키워드([보호막] 등)를 되돌린다
    for(const gr of (G._combatGrants||[])){
      if(gr.numeric){
        const left=(typeof gr.u.grants[gr.key]==='number'?gr.u.grants[gr.key]:0)-gr.v;
        if(left>0) gr.u.grants[gr.key]=left; else delete gr.u.grants[gr.key];
      } else delete gr.u.grants[gr.key];
    }
    G._combatGrants=[];
    // 방어자 잔존 시 공격자 본진 귀환(2d). 양측 잔존 = 무승부 — 공격측이 「솔라리의 상징」(227)을 가졌으면
    // 카드 원문대로 '모든 유닛'을 귀환시켜 결과 없음(통제 변경·득점 없음, #10142). 예전엔 '전원 사망'을 무승부로 잘못 봤다.
    if(defUnits().length && atkUnits().length){
      if(G.players[sd.attacker].gear.some(g=>g.n===227)){
        UI.log(`「솔라리의 상징」: 무승부 — 모든 유닛이 기지으로 귀환합니다`, 'combat');
        [...bf.units].forEach(u=>{ removeUnit(u); placeUnit(u,'base'); });
      } else {
        UI.log(`방어 성공 — 공격 유닛은 기지으로 귀환합니다`, 'combat');
        atkUnits().forEach(u=>{ removeUnit(u); placeUnit(u,'base'); });
      }
    }
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
  UI.prompt(G._endingTurn ? '종료 단계 — 열린 결전 처리 중'
    : (G.turn===G.actingPlayer?`${pname(G.turn)}의 행동 단계`:''));
  // 보류해 둔 전투 사망 격발 — 치유가 끝난 뒤라 종소리 피해는 지워지지 않고, 이어지는 cleanup이 치명 판정을 한다
  for(const f of deferred) await f();
  await cleanup(G.turn);
  // 종료 단계에 열렸던 결전이 모두 끝났다면 보류해 둔 종료 절차를 마저 밟는다
  if(G._endingTurn && G.state==='neutral' && !G.showdown) await finishEndTurn(G._endingTurn.p);
}

// 피해를 받을 수 없는 유닛에게는 어떤 양도 치명 피해가 될 수 없으므로, 배분 강제 대상에서 빠진다
// (룰 443.1.d.9 — 룰북이 「케인 - 해방」을 예로 든다). 남겨 두면 배분을 낭비하게 된다.
function canTakeCombatDamage(u){
  return !(unitFx(u).noDmgIfMoved2 && (u.turnMoves||0)>=2);
}

// 피해 배분: assigner가 targets에 total 피해를 배분 (치명 우선/탱커 우선 자동, 순서는 프롬프트)
async function assignDamage(assigner, total, targets, role){
  const result=[];
  let remain=total;
  let pool=targets.filter(canTakeCombatDamage);
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

// 같은 게임 행동으로 함께 죽는 유닛들. 이 안의 유닛은 서로의 죽음을 볼 수 없다 (룰 376.3.b).
let _dyingBatch = null;
let _dkTwiceBatch = null;   // 배치가 시작될 때의 [죽음의 종소리 2회] 여부 (카서스)
// opts.byDamage: 클린업의 치명 피해 사망(처치 귀속은 마지막 피해를 준 주문 — 룰 416)
async function killUnitsTogether(list, opts){
  let batch = (list||[]).filter(u=>u && !u._dead);
  if(!batch.length) return;
  // 동시 사망에 「존야의 모래시계」가 죽는 아군보다 적으면 어느 죽음을 대체할지 통제자가 고른다 — "the next time"
  // 조건이 동시에 여럿 충족되면 그 능력의 통제자가 하나를 고른다(룰 376.3 '[Nth] time' 원칙 · RiftJudge #10768 · #8618).
  // 고른 유닛을 배치 앞으로 옮기면 killUnit의 강제 대체가 그 유닛부터 걸린다 (예전엔 배치 순서상 첫 유닛이 자동 구원).
  for(const pi of [0,1]){
    const mine=batch.filter(u=>u.ctrl===pi);
    const saves=G.players[pi].gear.filter(g=>FX[g.n]&&FX[g.n].zhonya).length;
    if(saves<1 || mine.length<=saves) continue;
    const first=[];
    for(let k=0;k<saves;k++){
      const u=await UI.pickUnitFrom(pi, mine.filter(x=>!first.includes(x)), '「존야의 모래시계」 사망 방지 — 대신 회수할 유닛 선택');
      if(!u) break;
      first.push(u);
    }
    if(first.length) batch=[...first, ...batch.filter(u=>!first.includes(u))];
  }
  const prev = _dyingBatch, prevDk = _dkTwiceBatch;
  _dyingBatch = new Set(batch);
  // 종소리는 사망 전에 예약된다 (룰 322 2a) — 카서스가 함께 죽어도 그 시점엔 보드에 있다
  _dkTwiceBatch = [0,1].map(pi=>allUnits(pi).some(x=>unitFx(x).deathknellTwice));
  try { for(const u of batch) await killUnit(u, opts); }
  finally { _dyingBatch = prev; _dkTwiceBatch = prevDk; }
}

// ---------- 사망 ----------
// 사망 뒤 격발(종소리·사망 이벤트)을 미루는 큐 — 전투 사망은 전투 정리(치유·귀환) 뒤에 해결한다 (resolveShowdown)
let _deferDeathFx = null;
async function killUnit(u, opts){
  if(u._dead) return; u._dead=true;
  UI.fx.unit(u, 'die');          // 보드에서 사라지기 전에 위치를 잡아 연출
  const fx=unitFx(u);
  const P=G.players[u.ctrl];
  const wasBuffed=u.buff>0, wasStunned=u.stunned, deathLoc=u.loc;
  const wasLethal = u.dmg>0 && u.dmg>=targetMight(u), hadDecree = !!u._decree;

  // ── 사망 대체 효과 (룰 366~368) ──
  // 대체 효과는 상시 능력이라(365.1) 'you may'가 없으면 고를 수 없는 강제 효과다.
  // 여럿이 한 사망에 걸리면 대상의 소유자가 순서를 정한다 (368) — 고정 순서로 돌면 안 된다.
  // 하나가 실제로 사망을 대체하면 그 유닛은 죽지 않으므로 나머지는 조건 자체가 사라진다.
  {
    const recall = (why) => {
      u.dmg=0; u.ex=true; u._dead=false; u._decree=false; u._spellDmgBy=null;
      removeUnit(u); placeUnit(u,'base');
      UI.log(`「${unitName(u)}」 사망 대신 회수됨 (${why})`, 'p'+u.ctrl);
      UI.render();
    };
    const cands = [];
    // 최후의 전사(320): 비용 없음 · 강제
    if(u._highlander) cands.push({ label:'최후의 전사 — 탈진 상태로 귀환', forced:true,
      run: async () => { u._highlander=false; recall('최후의 전사'); return true; } });
    // 존야의 모래시계(77): 비용 없음 · 강제 (도구가 대신 폐기된다)
    const zi = P.gear.findIndex(g=>FX[g.n]&&FX[g.n].zhonya);
    if(zi>=0) cands.push({ label:'존야의 모래시계 — 도구를 대신 폐기', forced:true,
      run: async () => { await killGear(u.ctrl, zi); recall('존야'); return true; } });
    // 무허가 무기고(23): "you may pay 분노" — 선택
    if(u._armory && canPay(u.ctrl,0,['Fury'])) cands.push({ label:'무허가 무기고 — 분노 힘 1 지불', forced:false,
      run: async () => {
        const yes = await UI.confirmP(u.ctrl, `[무허가 무기고] 분노 힘 1을 지불하고 「${unitName(u)}」을(를) 회수할까요?`, unitCard(u));
        if(!yes) return false;
        payCost(u.ctrl,0,['Fury']); u._armory=Math.max(0,(u._armory|0)-1); recall('무허가 무기고'); return true;   // 한 장만 소모(#686)
      } });
    // 세트 - 대장 전설(269): "you may pay ✳ and exhaust me" — 선택 (예전엔 라벨이 '미스 포츈'으로 잘못 적혀 있었다)
    {
      const lfx=FX[P.legendN];
      if(u.buff>0 && lfx && lfx.hookBuffedDeathSave && !P.legendEx && canPay(u.ctrl,0,['Any']))
        cands.push({ label:'세트 - 대장 — ✳1 지불 + 전설 탈진 + 버프 소모', forced:false,
          run: async () => {
            const yes = await UI.confirmP(u.ctrl, `[세트 - 대장] ✳1 지불+전설 탈진+버프 소모로 「${unitName(u)}」을(를) 회수할까요?`, unitCard(u));
            if(!yes) return false;
            payCost(u.ctrl,0,['Any']); P.legendEx=true; u.buff=Math.max(0,u.buff-1);
            recall('세트 - 대장'); return true;
          } });
    }

    if(cands.length){
      let order = cands;
      if(cands.length > 1){
        // 룰 368: 순서는 대상의 소유자가 정한다. 먼저 적용할 것을 고르게 하고 나머지는 뒤로 민다.
        const sel = await UI.pickOption(u.ctrl,
          `「${unitName(u)}」 사망 — 먼저 적용할 대체 효과 (룰 368)`,
          cands.map((c,i)=>({ v:i, label:c.label + (c.forced?'':' (선택)') })));
        const first = (typeof sel === 'number' && cands[sel]) ? sel : 0;
        order = [cands[first], ...cands.filter((_,i)=>i!==first)];
      }
      for(const c of order){
        if(!(await c.run())) continue;   // 하나라도 대체하면 사망하지 않는다 — 나머지 무기고 표식은 남는다(#686)
        // 치명 피해 + 「황제의 칙령」: 클린업 사망(322 2b)과 칙령의 처치 격발은 별개의 사건이라 대체 효과가 앞의 것을
        // 막아도 칙령이 한 번 더 처치한다(#7440). 피해가 치명이 아니면 칙령 처치 하나뿐이라 대체로 살아남는다(#8420).
        if(wasLethal && hadDecree){
          UI.log(`「황제의 칙령」: ${unitName(u)} — 피해를 받았으므로 다시 처치`, 'combat');
          u._decree=true; await killUnit(u);
        }
        return;
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
  // 주문 처치 귀속(룰 416 · 376.2.c): 처치 지시는 시전 중인 주문(자기 유닛·불사조 자신이어도), 클린업의 피해 사망은
  // 직전에 피해를 준 주문(_spellDmgBy — 전투·유닛 주체 피해면 없음), 칙령·단두대 표식은 그 주문의 시전자.
  // 예전엔 '시전자와 다른 통제자의 유닛'만 세어 자기 「숨겨진 칼날」로 불사조를 죽이는 공식 콤보가 막혔다(#9024).
  let killer=null;
  if(opts && opts.byDamage) killer = (u._spellDmgBy!==undefined && u._spellDmgBy!==null) ? u._spellDmgBy : null;
  else if(G._casting!==undefined && G._casting!==null) killer = G._casting;
  if(killer===null && hadDecree && u._decreeBy!==undefined && u._decreeBy!==null) killer = u._decreeBy;
  if(killer!==null) (G._spellKilledBy = G._spellKilledBy||{})[killer]=true;
  UI.render();
  const dkTwice = _dkTwiceBatch ? _dkTwiceBatch[u.ctrl] : allUnits(u.ctrl).some(x=>unitFx(x).deathknellTwice);
  const afterDeath = async () => {
    // 죽음의 종소리 (카서스: 추가 1회)
    const ctxD={p:u.ctrl, unit:u, bfIdx:(deathLoc!=='base'?deathLoc:null), dead:true};
    await runTriggerList(fx.triggers?.onDeath, ctxD);
    if(fx.triggers?.onDeath && dkTwice){
      UI.log(`[카서스] 죽음의 종소리 효과 1회 추가 발동!`, 'p'+u.ctrl);
      await runTriggerList(fx.triggers?.onDeath, ctxD);
    }
    // 전역 사망 이벤트 (메아리의 망령, 선봉대 투구, 빅토르 등)
    await fireEvent('onUnitDeath', {p:u.ctrl, dead:u, buffed:wasBuffed, isToken:u.isToken, tokenName:u.tokenName});
    // 기절 상태로 처치됨 → 처치자 이벤트 (솔라리 성소)
    // 처치자 = 처치 원인의 통제자(주문 처치·칙령·단두대는 그 시전자, 전투·능력은 상대) — 자기 칙령으로 죽은 내 유닛은
    // 상대의 처치가 아니라 「솔라리 성소」("enemy unit")가 발동하지 않는다 (RiftJudge #5587). 예전엔 행동 플레이어로 추정했다.
    if(wasStunned){
      const k = killer!==null ? killer : opp(u.ctrl);
      if(k!==u.ctrl) await fireEvent('onYouKillStunned', {p:k});
    }
  };
  // 전투 사망의 격발은 보류 항목이라 전투 정리가 끝난 뒤에 해결된다 (룰 322 "Legal Items cannot be executed" · #7226)
  if(_deferDeathFx) _deferDeathFx.push(afterDeath); else await afterDeath();
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
    // 같은 행동으로 함께 죽는 중인 유닛은 그 사건을 볼 수 없다 (룰 376.3.b)
    for(const u of [...everyUnit()].filter(u=>u.ctrl===pi && !(_dyingBatch && _dyingBatch.has(u)))){
      const fx=unitFx(u);
      if(fx.triggers && fx.triggers[ev]) srcs.push({list:fx.triggers[ev], unit:u});
    }
    for(const g of [...G.players[pi].gear]){
      const gf=FX[g.n];
      if(gf && gf.triggers && gf.triggers[ev]) srcs.push({list:gf.triggers[ev], gear:g});
    }
    // 폐기장에서 스스로를 회수하는 카드(초강력 초토화 로켓 252 등)는 폐기장에 있을 때도 격발한다.
    // 같은 카드가 여러 장이어도 한 번만 (회수 대상은 한 장이므로).
    for(const tn of new Set(G.players[pi].trash)){
      const tf=FX[tn];
      if(tf && tf.trashTrigger && tf.triggers && tf.triggers[ev]) srcs.push({list:tf.triggers[ev]});
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
  if(fx && fx.triggers && fx.triggers[ev])
    await withBattlefieldSource({n:bf.n,event:ev},()=>runTriggerList(fx.triggers[ev], ctx));
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
    const yes=await UI.confirmP(p, `[전설] ${card(G.players[p].legendN).ko}을(를) 탈진하고 효과를 발동할까요?`, card(G.players[p].legendN));
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
  // [반응] 능력은 중립 닫힌 상태(상대 주문 응수 창)에서도 발동할 수 있다 (룰 309.2)
  if(G.state==='neutral' && G.turn!==p && !ab.reaction){ UI.toast('자신의 턴에만 발동할 수 있습니다','warn'); return; }
  if(ab.legion && !(P.playedCards>=1)){ UI.toast('[군단] 조건: 이번 턴에 카드를 플레이해야 합니다','warn'); return; }
  if(ab.onlyAtBf && source.kind==='unit' && source.u.loc==='base'){ UI.toast('전장에 있을 때만 사용할 수 있습니다','warn'); return; }
  // 대상이 있는 능력(ab.target spec)은 비용을 내기 전에 대상을 고른다(능력 플레이 2단계 선택 → 4단계 지불) — 적법 대상이 없으면
  // 발동 불가(룰 391.3, RiftJudge #3642). 비용 지불 중 등장한 유닛(버린 죠스)은 후보가 아니다(#2485). 고른 대상은 ctx.pre로 op에 전달.
  let pre=null;
  if(ab.target){
    const cands=unitsBySpec(ab.target, p);
    if(!cands.length){ UI.toast('적법한 대상이 없어 발동할 수 없습니다 (룰 391.3)','warn'); return; }
    const tu=await UI.pickUnitFrom(p, cands, ab.target._prompt||'대상 선택'); if(!tu) return;
    pre=new Map([[ab.ops[0], tu.uid]]);
  }

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
    // 동시에 재활용되는 카드는 무작위 순서로 맨 아래에 놓는다 (룰 403.x)
    const recycled=[];
    for(let i=0;i<cost.recycleTrash;i++){
      const sel=await UI.pickOption(p,'재활용할 카드 선택 (덱 맨 아래로)',P.trash.map((n,ti)=>({v:ti,label:card(n).ko,n})));
      const ti=(sel==null)?P.trash.length-1:sel;
      recycled.push(P.trash.splice(ti,1)[0]);
    }
    P.deck.push(...shuffle(recycled));
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
    everyUnit().filter(u=>u.ctrl===p).forEach(u=>opts.push({v:{t:'u',u},label:'유닛: '+unitLabel(u),card:unitCard(u)}));
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
    // 주문 전용 자원(카이사 전설 247·럭스 314)도 [추가] 자원 능력이다. 빠져 있어서 체인에 쌓였고,
    // 체인은 결전이 끝나야 해결되므로 정작 그 시점의 카드 비용에는 쓸 수 없었다.
    const RESOURCE_OPS = new Set(['addEnergy','addPower','addSpellEnergy','addSpellPower']);
    if(ab.ops.length && ab.ops.every(o=>RESOURCE_OPS.has(o.op))){
      UI.log(`${pname(p)} 「${srcName}」 [추가] 능력 — 즉시 해결 (응수 불가)`, 'p'+p);
      await execOps(ab.ops, {p, unit:source.u, gear:source.g, kind:'ability',
        bfIdx:(source.u&&source.u.loc!=='base')?source.u.loc:null});
      sd.passes=0;                    // 행동했으므로 패스 시퀀스는 끊기지만, 우선권은 그대로 유지
      UI.render(); UI.promptShowdown();
      return;
    }
    sd.chain.push({kind:'ability', p, ab, unit:source.u, gear:source.g, srcName, pre});
    if(sd.chain.length===1) sd.chainStarter=p;
    UI.fx.chainAdd(source.kind==='legend'?card(P.legendN):source.u?unitCard(source.u):card(source.g.n), p, sd.chain.length);
    UI.log(`🔗 ${pname(p)} 능력 「${srcName}」 체인에 적재 (#${sd.chain.length})`, 'p'+p);
    showdownActed(p);                 // 우선권은 적재자가 유지
    UI.render();
    return;
  }
  UI.fx.cast(source.kind==='legend'?card(P.legendN):source.u?unitCard(source.u):card(source.g.n), p, '능력');
  UI.log(`${pname(p)} 「${srcName}」 능력 발동`, 'p'+p);
  await execOps(ab.ops, {p, unit:source.u, gear:source.g, kind:'ability', bfIdx:(source.u&&source.u.loc!=='base')?source.u.loc:null, pre});
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
// 대상 조건의 위력 판정. 전투 결전 중에는 공/방 지정 위력을 쓴다
// (돌풍의 "위력 3 이하"가 전투 중 [맹공] 등으로 달라진 위력을 반영하도록).
function targetMight(u){
  const sd=G.showdown;
  const role = (sd && sd.hasCombat && u.loc===sd.bfIdx) ? (u.ctrl===sd.attacker?'attacker':'defender') : undefined;
  return might(u, role, {forKill:true});
}

// spec에 맞는 유닛 목록 (고르기·굴절 지불 없이 후보만)
function unitsBySpec(spec, p){
  let cands = everyUnit();
  if(spec.side==='friendly') cands=cands.filter(u=>u.ctrl===p);
  if(spec.side==='enemy') cands=cands.filter(u=>u.ctrl!==p);
  if(spec.other && _ctxUnit) cands=cands.filter(u=>u!==_ctxUnit);   // "다른 유닛": 효과 발생원 자신 제외
  if(spec._exclude && spec._exclude.length) cands=cands.filter(u=>!spec._exclude.includes(u)); // 복수 대상: 이미 고른 유닛 제외
  // 'here'는 효과 발생 위치(_ctxBf)가 있으면 그쪽 우선 — 결전 중 다른 전장에서 죽은
  // 유닛의 죽음의 종소리가 결전 전장을 잘못 가리키지 않게 한다
  if(spec.where==='here' && _ctxBf!==null) cands=cands.filter(u=>u.loc===_ctxBf);
  else if(spec.where==='here' && G.showdown) cands=cands.filter(u=>u.loc===G.showdown.bfIdx);
  // 숨김에서 나온 플레이의 대상은 숨겨 둔 전장 안에서 고른다 (룰 737)
  if(_hiddenBf!==null) cands=cands.filter(u=>u.loc===_hiddenBf);
  if(spec.where==='bf') cands=cands.filter(u=>u.loc!=='base');
  if(spec.where==='base') cands=cands.filter(u=>u.loc==='base');
  // 'in combat' = 진행 중인 '전투' 결전 전장의 유닛만 — 빈 전장의 무혈 결전은 전투가 아니다(룰 437 · #11269)
  if(spec.where==='combat') cands=cands.filter(u=>G.showdown && G.showdown.hasCombat && u.loc===G.showdown.bfIdx);
  if(spec.mightMax!==undefined) cands=cands.filter(u=>targetMight(u)<=spec.mightMax);
  if(spec.mightMin!==undefined) cands=cands.filter(u=>targetMight(u)>=spec.mightMin);
  if(spec.energyMax!==undefined) cands=cands.filter(u=>(unitCard(u).e||0)<=spec.energyMax);
  if(spec._uids) cands=cands.filter(u=>spec._uids.includes(u.uid));
  if(spec.champion) cands=cands.filter(u=>!u.isToken&&card(u.n).super==='Champion');
  if(spec.buffed) cands=cands.filter(u=>u.buff>0);
  if(spec.exhausted) cands=cands.filter(u=>u.ex);
  if(spec.damaged) cands=cands.filter(u=>u.dmg>0);
  if(spec.stunned) cands=cands.filter(u=>u.stunned);
  return cands;
}

// ---------- 플레이 시점 대상 지정 (룰 352.8.a · 356.3.e) ----------
// 주문의 "유닛 하나를 고르는" 지시는 플레이할 때 대상을 정한다(352.8.a). 고른 대상(uid)은 체인 항목이
// 들고 있다가 해결 때 pickBySpec이 꺼내 쓰는데, 그사이 보드를 떠났거나(존을 바꿔 돌아와도 다른 객체 =
// 다른 uid) 조건을 더 이상 만족하지 않으면 그 지시만 생략되고 나머지는 정상 해결된다(356.3.e —
// 보이드 시커 예시: 대상이 기지로 도망가면 피해는 없지만 드로우는 한다). 기지로 갔다가 돌아온 같은
// 유닛은 다시 적법하다(356.3.e.5). 굴절 비용·「꿈꾸는 나무」 등 '대상으로 고를 때' 효과도 플레이 시점.
const PRE_TARGET_OPS = new Set(['damage','kill','stun','might','recall','ready','chooseUnit','buff','dmgEqMyMight','mightDouble','itDealsTo']);
function preTargetable(op){
  if(!op || !PRE_TARGET_OPS.has(op.op) || !op.spec || typeof op.spec!=='object') return false;
  if(op.spec.count==='all' || (typeof op.spec.count==='number' && op.spec.count>1)) return false;
  if(op.all || op.self || op.it) return false;
  if(op.op==='buff' && (op.count||1)!==1) return false;
  return true;
}
// 「유닛에게 [키워드] 부여」의 대상 spec — 해결(grantKw case)과 플레이 시점 지정이 같은 spec·프롬프트를 써야 한다
function grantKwSpec(op){
  const assault=op.kws.filter(([kw])=>kw==='Assault').reduce((sum,[,v])=>sum+v,0);
  return { type:'unit', side:op.who.includes('friendly')?'friendly':'any', where:'any', count:1,
    _prompt:(assault?`[맹공 ${assault}] `:'')+'키워드를 부여할 유닛 선택' };
}
// op 하나가 플레이 시점에 고르는 대상 spec 목록(순서대로). 항목은 spec이거나 (p, prev)=>spec — prev는 이 주문에서
// 앞서 고른 유닛들(「수렴 변이」의 '다른 아군' 등). 전용 op는 cardscripts의 PRE_TARGET_EXTRA가 같은 순서로 소비한다.
// spec._prompt가 있으면 그 문구로 묻는다(봇이 프롬프트 문구로 판단하므로 해결 시점과 같아야 한다).
function preTargetSpecs(op){
  if(!op) return [];
  if(preTargetable(op)) return [op.spec];
  if(op.op==='grantKw' && op.who!=='me' && op.who!=='it' && op.kws) return [grantKwSpec(op)];
  const ex=(typeof PRE_TARGET_EXTRA!=='undefined') ? PRE_TARGET_EXTRA[op.op] : null;
  return ex ? (typeof ex==='function' ? ex(op) : ex) : [];
}
// 사전 지정 대상. execOps가 op마다 넣는다 — uid(null=플레이 때 '선택 안 함') · 전장 대상 {bf} · 여러 대상이면 배열.
// undefined면 즉석 선택(격발·능력 등 플레이 시점 지정이 없는 경로).
let _preTarget;
const PRE_CANCEL = Symbol('preCancel');   // preTargetSpell: 고를 대상이 없어 플레이 취소
// 사전 지정 대상을 하나 꺼낸다: undefined=사전 지정 없음(즉석 선택) / null=이 지시 불발 / 유닛 / {bf}
function takePreTarget(p, spec){
  if(_preTarget===undefined) return undefined;
  let v;
  if(Array.isArray(_preTarget)){ v=_preTarget.shift(); if(!_preTarget.length) _preTarget=undefined; if(v===undefined) return undefined; }
  else { v=_preTarget; _preTarget=undefined; }
  if(v===null) return null;
  if(typeof v==='object') return v;                     // {bf:i}
  const u=everyUnit().find(x=>x.uid===v);
  if(u && (!spec || unitsBySpec(spec, p).includes(u))) return u;
  UI.log(`대상${u?' 「'+unitName(u)+'」':''}이(가) 더 이상 유효하지 않아 이 지시는 생략됩니다 (룰 356.3.e)`, 'sys');
  return null;
}
// 플레이 시점 대상 하나 고르기. 굴절(735)은 본 비용(o.cost)과 합쳐 낼 수 있는 유닛만 후보 — 지불을 거부하면 그 유닛을
// 빼고 다시 고른다(RiftJudge #6944 "다른 대상을 고르거나 취소"). 후보가 없으면 null(호출자가 취소 여부 판단).
async function pickPreTarget(p, spec, promptText, cost){
  const excl=[];
  while(true){
    const free = !!(cost && cost.noDeflect);   // 탈취한 주문의 재선택: 굴절은 원 시전이 이미 치렀다(RiftJudge #3088)
    const cands=unitsBySpec(excl.length ? {...spec, _exclude:[...(spec._exclude||[]), ...excl]} : spec, p)
      .filter(u=>free || canPayDeflect(p, u, cost));
    if(!cands.length) return null;
    let u;
    if(spec._via==='returnHand'){   // 되돌리기류는 해결 때와 같은 선택지 모양(returnHand)으로 묻는다 — 봇이 그 모양을 평가한다
      const options=cands.map((x,i)=>({ v:i, label:unitLabel(x), card:unitCard(x), returnHand:{ uid:x.uid } }));
      if(spec.optional) options.push({ v:null, label:'되돌리지 않음', returnHand:null });
      const sel=await UI.pickOption(p, promptText, options);
      const ch=(options.find(o=>o.v===sel)||{}).returnHand;
      u = ch ? cands.find(x=>x.uid===ch.uid) : null;
    } else u=await UI.pickUnitFrom(p, cands, promptText, spec.optional);
    if(!u) return null;
    noteSpellPick(p, u);
    if(free || await payDeflect(p, u, cost)) return u;
    excl.push(u);
  }
}
async function preTargetSpell(p, c, fx, o){
  if(G.manual || !fx.playOps.length || fx.reflexive) return null;   // 반사 격발 주문은 격발이 고른다(352.8.b · 383)
  const pre=new Map(), prev=[];
  const saved=[_ctxBf,_hiddenBf,_ctxUnit,_curKind,_preTarget];
  _ctxBf=o.bfIdx??null; _hiddenBf=o.hiddenBf??null; _ctxUnit=null; _curKind='spell'; _preTarget=undefined;
  try{
    for(const po of fx.playOps){
      if(po.legion && !o.legionOK) continue;
      for(const op of po.ops){
        const ents=preTargetSpecs(op);
        if(!ents.length) continue;
        const vals=[];
        for(const ent of ents){
          const spec = typeof ent==='function' ? ent(p, prev) : ent;
          if(spec.battlefield){                              // 전장 대상 (352.10.d "at a battlefield"는 전장을 대상으로)
            const sel=await UI.pickOption(p, spec._prompt||`「${c.ko}」 대상 전장`, G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko})));
            vals.push({bf: sel===null ? 0 : sel}); prev.push(null); continue;
          }
          let what=''; try{ what=describeOps([op]); }catch(e){}
          const u=await pickPreTarget(p, spec, spec._prompt||`「${c.ko}」 대상 선택${what?' — '+what:''}`, o.cost);
          // 손패·숨김에서는 대상 없는 지시가 하나라도 있으면 낼 수 없다(352.8) — 효과로 내는 플레이는 그 지시만 비운다
          if(!u && !spec.optional && !o.byEffect) return PRE_CANCEL;
          vals.push(u?u.uid:null); prev.push(u||null);
        }
        pre.set(op, vals.length===1 ? vals[0] : vals);
      }
    }
  } finally { [_ctxBf,_hiddenBf,_ctxUnit,_curKind,_preTarget]=saved; }
  return pre.size?pre:null;
}

async function pickBySpec(p, spec, promptText){
  const preU=takePreTarget(p, spec);
  if(preU!==undefined) return preU || (spec.count==='all'?[]:null);
  const cands = unitsBySpec(spec, p);
  if(!cands.length) return spec.count==='all'?[]:null;
  if(spec.count==='all') return cands;
  const u = await UI.pickUnitFrom(p, cands, promptText, spec.optional);
  if(!u) return null;
  noteSpellPick(p, u);
  if(!(await payDeflect(p, u))) return null;
  return u;
}

// 분할 피해의 추가 피해는 '나눌 총량'에 한 번만 붙는다 (룰 718.5) — 그래서 고를 수 있는
// 대상 수도 함께 늘어난다. 대상마다 더하면 대상 수만큼 피해가 불어난다.
// 전장 보정은 나눠 줄 위치가 정해져 있을 때만 센다(op.spec.where==='here').
function splitBonus(p, loc){
  const at = (loc!==null && loc!==undefined && loc!=='base' && G.bfs[loc] && G.bfs[loc].n===BF_STATIC.BONUS_DMG) ? 1 : 0;
  const all = everyUnit().some(x=>x.ctrl===p && unitFx(x).spellBonusAll) ? 1 : 0;
  return at + all;
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
// 숨김에서 플레이한 카드가 '플레이하면서' 고르는 대상은 숨겨 둔 전장 안에서만 고른다 (룰 737).
// 나중에 따로 발동하는 트리거·능력(존야의 대체 효과, 티모의 [방어 시] 등)에는 걸리지 않는다.
// 카드 문구 자체가 그 전장에서 고르는 것을 불가능하게 만드는 경우는 룰이 예외로 두므로
// (「물결을 바꾸는 자」 — "다른 위치의 유닛") 그런 카드는 fx.hiddenFreeTarget으로 빼 둔다.
let _hiddenBf = null;
let _ctxUnit = null;   // 효과 발생원 유닛 — "다른(another)" 대상 제한에서 자기 자신 제외용
let _curKind = 'effect';
async function execOps(ops, ctx){
  if(G.winner!==null) return;
  const p=ctx.p;
  _ctxBf = ctx.bfIdx??null;
  _hiddenBf = ctx.hiddenBf??null;
  _ctxUnit = ctx.unit??null;
  _curKind = ctx.kind||'effect';
  let it = ctx.it||null;
  const pre = ctx.pre||null;   // 플레이 시점에 고른 대상 (Map op→uid) — preTargetSpell
  for(const op of ops){
    if(G.winner!==null) return;
    { const v=(pre && pre.has(op)) ? pre.get(op) : undefined; _preTarget = Array.isArray(v) ? [...v] : v; }   // 배열은 소비되므로 복사
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
        // 추가 피해는 여기서 총량에 한 번 붙는다 (룰 718.5) — 대상마다 붙이지 않는다
        let remain=op.n + splitBonus(p, op.spec.where==='here' ? _ctxBf : null);
        const used=[];            // 같은 유닛을 두 번 고를 수 없다 ("여러 유닛에 나눠" = 서로 다른 유닛)
        while(remain>0){
          const cands=everyUnit().filter(u=>u.ctrl!==p && !used.includes(u) && (op.spec.where!=='here'||u.loc===_ctxBf));
          if(!cands.length) break;
          const u=await UI.pickUnitFrom(p,cands,`분할 피해: 대상 선택 (남은 피해 ${remain})`, true);
          if(!u) break;
          if(!(await payDeflect(p, u))){ used.push(u); continue; }   // 굴절 비용 미지불 시 그 유닛은 제외
          used.push(u);
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
        // 각자 고른 뒤 한 배치로 죽는다 — 서로의 죽음을 보지 못하고(376.3.b), 종소리는 턴 플레이어 것이 먼저 적재되어
        // 비턴 플레이어 것부터 해결된다(LIFO — #9900). 예전엔 턴 플레이어 유닛이 먼저 따로 죽었다.
        const picked=[];
        for(const pi of [G.turn, opp(G.turn)]){
          const mine=everyUnit().filter(u=>u.ctrl===pi);
          if(!mine.length) continue;
          const u=await UI.pickUnitFrom(pi,mine,`${pname(pi)}: 처치할 자신의 유닛 선택`);
          if(u) picked.push(u);
        }
        await killUnitsTogether(picked.reverse());
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
        targets.forEach(u=>{
          // 위력 감소에 최소값 제한이 있으면, 룰 454.3.d.2 '스냅샷'대로 적용 시점의 실효 감소분을
          // 계산해 고정한다. (뒤에 +버프가 들어와도 감소분은 그대로 -1로 남아야 함 — 룰 457: 증가 먼저·감소 나중)
          // 예: 2⚔에 -3(min1) → 실효 -1로 고정 → 이후 +2면 2-1+2 = 3 (합산 후 clamp면 1이 되어 틀림)
          if(op.n < 0 && op.min !== undefined){
            // 기준은 '적용 시점의 실제 위력'이다. 전투 중이라면 공격자/방어자 지정 보정
            // ([맹공]·[보호막] 등)이 이미 붙어 있으므로 그 값에서 재야 한다
            // (룰 477.3.d — 증가 먼저, 감소 나중).
            // 기절은 전투 피해 기여만 0으로 만들 뿐 위력 자체를 없애지 않으므로 forKill로 실제 값을 쓴다.
            const sd = G.showdown;
            const role = (sd && sd.hasCombat && u.loc === sd.bfIdx)
              ? (u.ctrl === sd.attacker ? 'attacker' : 'defender') : undefined;
            const cur = might(u, role, {forKill:true});
            const eff = Math.max(op.min, cur + op.n) - cur;   // 최소값 밑으로는 내리지 않는 실효 감소분
            u.tempM.push({ v: eff, dur:'turn', snap:true });
          } else {
            u.tempM.push({ v: op.n, dur:'turn', min: op.min });
          }
          UI.log(`${unitName(u)} 위력 ${op.n>0?'+':''}${op.n} (이번 턴)`, 'p'+p);
        });
        break; }
      case 'grantKw': {
        let u=null;
        if(op.who==='me') u=ctx.unit;
        else if(op.who==='it') u=it;
        else {   // 주문이면 플레이 시점에 고른 대상을 쓴다(352.8.a) — 「가르기」「막기」가 응수 뒤 다른 유닛으로 옮겨 붙지 않게
          const gs=grantKwSpec(op);
          u=await pickBySpec(p, gs, gs._prompt);
        }
        if(u){
          op.kws.forEach(([kw,v])=>{
            const key=kw.toLowerCase().replace('-','');
            const numeric=(typeof unitFx(u).kw[key]==='number'||['assault','shield','deflect'].includes(key));
            // 수치 키워드는 거듭 부여 시 '합산' (룰 733/735/740 — 덮어쓰기 아님)
            if(numeric) u.grants[key]=(typeof u.grants[key]==='number'?u.grants[key]:0)+v;
            else u.grants[key]=true;
            // "this combat" 부여는 전투가 끝나면 사라진다 (턴 끝까지 남으면 안 됨)
            if(op.dur==='combat') (G._combatGrants=G._combatGrants||[]).push({u,key,v,numeric});
            UI.log(`${unitName(u)}에게 [${KEYWORDS_KO[kw]?.ko||kw}${v>1?' '+v:''}] 부여 (${op.dur==='combat'?'이번 전투':'이번 턴'})`, 'p'+p);
          });
          it=u;
        }
        break; }
      case 'stun': {
        const u=await pickBySpec(p, {...op.spec, side: op.spec.side==='any'?'enemy':op.spec.side}, '기절할 유닛 선택');
        if(u){ it=u; await stunUnits(p, u); }
        break; }
      case 'stunAll': {
        const us=await pickBySpec(p,{...op.spec,count:'all'});
        let any=false;
        await stunUnits(p, us);
        break; }
      case 'channel': channelRunes(p, op.n, op.exhausted); break;
      case 'addEnergy': G.players[p].energy+=op.n; UI.log(`${pname(p)} 에너지 +${op.n}`, 'p'+p); break;
      case 'addPower': G.players[p].power[op.dom]+=op.n; UI.log(`${pname(p)} 힘 +${op.n}`, 'p'+p); break;
      case 'token': {
        let loc='base';
        // 숨김에서 나온 플레이가 유닛을 플레이하게 하면 그 전장에 놓는다 (룰 737.3)
        if(_hiddenBf!==null) loc=_hiddenBf;
        else if(op.where==='here' && _ctxBf!==null) loc=_ctxBf;
        else if(op.where==='play'){
          // 토큰도 '플레이'하는 것이므로 기지 또는 통제 중인 전장을 고른다 (룰 406/143)
          const locs=[{v:'base',label:'기지'}];
          G.bfs.forEach((bf,i)=>{ if(bf.controller===p) locs.push({v:i,label:'전장: '+card(bf.n).ko,n:bf.n}); });
          const sel=locs.length===1?'base':await UI.pickOption(p,'토큰을 배치할 위치',locs);   // '배치할 위치' — 봇의 배치 정책이 답한다
          if(sel!==null) loc=sel;
        }
        else if(op.where==='at a battlefield'){
          const sel=await UI.pickOption(p,'토큰을 배치할 전장',G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko,n:bf.n})).concat([{v:'base',label:'기지'}]));
          if(sel!==null) loc=sel;
        }
        const madeTokens=[];
        for(let i=0;i<op.count;i++){
          const u=makeUnit(0,p,{loc,isToken:true,tokenMight:op.might,tokenName:op.name,ready:op.ready});
          if(op.temp) u.grants.temporary=true;
          placeUnit(u,loc);
          madeTokens.push(u);
        }
        for(const u of madeTokens){ await tokenPlayed(p, u); await fireAttackTriggers(u, loc); }   // 토큰도 플레이된 유닛이다
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
        // 목적지까지 한 선택지로 묶는다 — 갈 수 없는 곳은 후보에 아예 나오지 않는다
        const to = op.to==='here' ? _ctxBf : op.to==='its base' ? 'base' : 'bf';
        const u = await chooseEffectMove(p, op.spec, to);
        if(u) it=u;
        break; }
      case 'bounce': {
        // 소유자의 손으로 돌아간다 (통제권을 뺏은 유닛은 원래 주인에게)
        const fixed = op.who==='me' ? ctx.unit : op.who==='it' ? it : null;
        if(op.who==='me' || op.who==='it'){
          if(fixed){
            if(op.optional) await chooseReturnToHand(p,{_uids:[fixed.uid],optional:true},{alreadyPicked:true,energy:op.energy});
            else await resolveReturnToHand(p,{uid:fixed.uid,alreadyPicked:true});
          }
        } else {
          const side = op.who.includes('enemy') ? 'enemy' : op.who.includes('friendly') ? 'friendly' : 'any';
          await chooseReturnToHand(p,{type:'unit',side,where:'any',count:1,optional:!!op.optional});
        }
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
        let any=false;
        for(let i=0;i<op.n;i++){
          if(!G.players[p].hand.length) break;
          const idx=await UI.pickHandCard(p,'버릴 카드를 선택하세요');
          if(idx!==null){ await discardFromHand(p,idx,{batch:true}); any=true; }
        }
        if(any) await fireEvent('onYouDiscard', {p});
        break; }
      case 'discardOpp': {
        const o=opp(p);
        let anyO=false;
        for(let i=0;i<op.n;i++){
          if(!G.players[o].hand.length) break;
          const idx=await UI.pickHandCard(o,'버릴 카드를 선택하세요');
          if(idx!==null){ await discardFromHand(o,idx,{batch:true}); anyO=true; }
        }
        if(anyO) await fireEvent('onYouDiscard', {p:o});
        break; }
      case 'scorePoint': addPoints(p,1,'effect'); break;
      case 'heal': if(op.self&&ctx.unit) ctx.unit.dmg=0; else if(it) it.dmg=0; break;
      case 'healUnits': {
        if(op.all) everyUnit().filter(u=>u.ctrl===p).forEach(u=>u.dmg=0);
        else { const u=await pickBySpec(p,{type:'unit',side:'friendly',where:'any',count:1},'치유할 유닛 선택'); if(u)u.dmg=0; }
        break; }
      // ── 전설 전용 특수 op ──
      case 'yasuoMove': {
        // 기지↔전장 왕복 — 유닛과 목적지를 함께 고른다
        if(await chooseEffectMove(p,{side:'friendly'},'baseLink')) UI.log(`(전설 능력)`, 'p'+p);
        break; }
      case 'teemoFetch': {
        const P=G.players[p];
        const opts=[];
        if(P.champInZone && card(P.champN).tags.includes('Teemo')) opts.push({v:'zone',label:'챔피언 존의 '+card(P.champN).ko,n:P.champN});
        everyUnit().filter(u=>u.ctrl===p&&!u.isToken&&card(u.n).tags.includes('Teemo')).forEach(u=>opts.push({v:u,label:unitLabel(u),card:unitCard(u)}));
        if(!opts.length){ UI.toast('티모 유닛이 없습니다','warn'); break; }
        const sel=await UI.pickOption(p,'손패로 가져올 티모 유닛',opts);
        if(sel==='zone'){ P.champInZone=false; P.hand.push(P.champN); }
        else if(sel){ removeUnit(sel); P.hand.push(sel.n); }
        UI.log(`${pname(p)} 티모 유닛을 손패로 가져옴`, 'p'+p);
        break; }
      // ── 선택/조건부 실행 ──
      case 'optional': {
        // 이동은 "할까요?"를 따로 묻지 않는다 — 목적지 후보에 '이동하지 않음'을 넣어
        // 어디로 갈지 본 다음 결정하게 한다 (봇도 사람도 눈감고 답하지 않게)
        if(op.inner.op==='moveUnit' || op.inner.op==='moveSpec'){
          await execOps([{...op.inner, spec:{...op.inner.spec, optional:true}}], {...ctx, it});
          break;
        }
        const yes=await UI.confirmP(p,'선택 효과를 실행할까요?');
        if(yes) await execOps([op.inner], {...ctx, it});
        break; }
      case 'payThen': {
        if(!canPay(p,op.energy,[])) break;
        // "에너지를 내고 나 자신을 손패로" 류는 지불과 대상을 한 선택지로 묶는다
        if(op.inner.op==='bounce' && op.inner.who==='me'){
          await execOps([{...op.inner, optional:true, energy:op.energy}], {...ctx, it});
          break;
        }
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
          // 어느 룬을 돌릴지는 플레이어 선택 (색이 섞여 있을 때만 물어본다)
          let ri=P.runes.length-1;
          if(new Set(P.runes.map(r=>runeDomain(r.n))).size>1){
            const sel=await UI.pickOption(p,'재활용할 룬 선택 (강제)',
              P.runes.map((r,i)=>({v:i, label:(DOMAIN_KO[runeDomain(r.n)]||runeDomain(r.n)||'룬')+(r.ex?' (탈진)':'')})));
            if(sel!=null) ri=sel;
          }
          const r=P.runes.splice(ri,1)[0]; P.runeDeck.push(r.n);
          UI.log(`${pname(p)} 룬 1개 재활용 (강제)`, 'p'+p);
        }
        break; }
      case 'gainPoints': addPoints(p,op.n,'effect'); break;
      case 'champBack': {
        const P=G.players[p];
        if(!P.champInZone && P.trash.includes(P.champN)){
          const yes=await UI.confirmP(p,`폐기장의 챔피언 「${card(P.champN).ko}」을(를) 챔피언 존으로 되돌릴까요?`, card(P.champN));
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
        if(op.global){ tf[op.flag]=op.val!==undefined?op.val:true; tf[op.flag+'By']=p; }   // 누가 걸었나(칙령 처치 귀속용)
        else if(op.add!==undefined) tf[op.flag][tgt]=(tf[op.flag][tgt]||0)+op.add;
        else tf[op.flag][tgt]=op.val!==undefined?op.val:true;
        break; }
      // "Take a turn after this one" — 해결될 때마다 '이 턴 직후'에 하나씩 끼워 넣는 큐(최근 해결분이 앞). 한 턴에 두 장(또는
      // 유망한 미래로 양측이 한 장씩)이면 둘 다 얻는다 — 단일 플래그 덮어쓰기였다 (RiftJudge #3974 · #2248, 룰 100 카드 원문 그대로).
      case 'extraTurn': (G.extraTurns=G.extraTurns||[]).unshift(p); UI.log(`⏳ ${pname(p)}: 이 턴이 끝나면 추가 턴!`, 'score'); break;
      case 'banishSelf': G._banishSpell=true; break;
      default: {
        // 카드별 전용 op (cardscripts.js)
        if(typeof EXTRA_OPS!=='undefined' && EXTRA_OPS[op.op]){
          const saveBf=_ctxBf, saveKind=_curKind, saveUnit=_ctxUnit, saveHid=_hiddenBf;
          await EXTRA_OPS[op.op](op, {...ctx, it}, {it:()=>it, setIt:(v)=>{it=v;}});
          _ctxBf=saveBf; _curKind=saveKind; _ctxUnit=saveUnit; _hiddenBf=saveHid;
        }
        else UI.log(`(자동화 미지원 op: ${op.op})`, 'sys');
      }
    }
    UI.render();
  }
  _ctxBf=null; _hiddenBf=null; _preTarget=undefined;   // 소비되지 않은 사전 대상이 다음 선택에 새지 않게
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
