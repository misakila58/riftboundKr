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
  const wrapped = function(p, cands, promptText, optional, selection){
    if(_hiddenBf!==null && Array.isArray(cands)){
      const only = cands.filter(u=>u.loc===_hiddenBf);
      // 제한하면 후보가 하나도 없는 경우는 카드 문구가 그 전장을 배제한 것이므로 룰이 예외로 둔다
      if(only.length) cands = only;
    }
    return orig.call(UI, p, cands, promptText, optional, selection);
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
      playedCards:0, playedSeq:0, scoredBf:{}, drewFromEmpty:false,
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
  G.reviewSetup=!!cfg.reviewSetup;
  // Bo3 2·3게임: 주사위 대신 이전 게임의 패자가 선후공을 고른다 (대회 규정 · RiftJudge #1836 #2691)
  G.orderChooser=(cfg.orderChooser===0||cfg.orderChooser===1)?cfg.orderChooser:null;
  if(!G.reviewSetup) G.players.forEach(p=>{ for(let i=0;i<4;i++) drawCard(p.idx, true); });
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
  enemyDied:[false,false], freeHide:[false,false], dmgKill:false, bf292:[{},{}],   // bf292[p][bfIdx] — 전장별 '이번 턴 첫 선택'
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
  if(f.where==='here'){   // '이곳'은 발생원의 현재 위치 — 기지도 위치다(198.1 · RiftJudge #4514: 다리우스 243 기지 오라)
    if(src.unit){ if(u.loc!==src.unit.loc) return false; if(u.loc==='base' && u.ctrl!==src.unit.ctrl) return false; }
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
        // ifNotHas: "…have [X] if they didn't already"(정령의 안식처 63) — 이미 그 키워드가 있으면 부여하지 않는다(카드 원문이 810.1.c.3 합산의 예외)
        if(s.kind==='kwAura' && staticMatch(u,src,s.filter)) s.kws.forEach(k=>{ if(s.ifNotHas && base[k]) return; addKw(base,k,s.val); });
        else if(s.kind==='selfKw' && src.unit===u && (!s.cond||s.cond(u))) s.kws.forEach(k=>addKw(base,k));
        else if(s.kind==='selfKwFn' && src.unit===u){ const ks=s.fn(u); if(ks) ks.forEach(k=>addKw(base,k)); }
      }
    } finally { _inKw=false; }
  }
  return base;
}
let _inKw=false;
// [통찰] 인스턴스 수 — 인쇄 1 + 오라 출처마다 1 (817.2 "Multiple instances of Vision trigger separately": 보석세공 예언자 2기 + 인쇄 [통찰] = 3회)
function visionCount(u){
  let n = unitFx(u).kw.vision ? 1 : 0;
  if(u.grants && u.grants.vision) n++;
  for(const src of collectStatics()){ const s=src.s; if(s.kind==='kwAura' && s.kws.includes('vision') && staticMatch(u,src,s.filter)) n++; }
  return n;
}
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
  // 출처가 떠난 뒤 해결되는 능력은 보드에 마지막으로 있었을 때의 위력을 참조한다.
  u.lastKnownMight=targetMight(u);
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
// [공격 시]는 전투 전환 때 빠졌다. 전투가 없으면 여기서는 아무것도 하지 않는다 — 전투가 열릴 때(startShowdown, 또는
// 무혈 결전이 클린업에서 승격될 때 — 318 10a) openCombat이 양측 유닛 전부를 지정한다. 지정을 받는 것은 이동을 일으킨 사람이
// 아니라 '그 유닛의 통제자'다.
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
    for(let i=0;i<masks;i++) queueCombatTrigger(sd, {p:u.ctrl,n:60,unit:u,bfIdx:sd.bfIdx,
      ab:{ops:[{op:'might',n:1,dur:'turn',self:true}]}});
  }
  return fresh;
}
// 지정 순간에는 예약만 한다. 대상 선택과 체인 적재는 진행 중인 행동 및 정리가 끝난 뒤 한다.
async function fireDesignationTriggers(sd, fresh){
  for(const u of fresh){
    const fx=unitFx(u), ctx={p:u.ctrl,unit:u,bfIdx:sd.bfIdx};
    for(const event of [u.ctrl===sd.attacker?'onAttack':'onDefend','onAttackOrDefend']){
      for(const ab of fx.triggers?.[event]||[]){
        if(ab.cond && !ab.cond(ctx,u)) continue;
        if(ab.legion && G.players[u.ctrl].playedCards<1) continue;
        queueCombatTrigger(sd,{...ctx,n:u.n,ab});
      }
    }
    if(u.ctrl===sd.attacker && G.bfs[sd.bfIdx].controller===sd.defender){
      const n=G.players[sd.defender].legendN, hook=FX[n]?.hookEnemyAttackMyBf;
      if(hook) queueCombatTrigger(sd,{p:sd.defender,n,it:u,bfIdx:sd.bfIdx,ab:hook});
    }
  }
}

function queueCombatTrigger(sd, entry){
  entry.srcName=card(entry.n)?.ko || unitName(entry.unit);
  entry.sourceMight=entry.unit ? targetMight(entry.unit) : undefined;
  (sd.pendingTriggers||(sd.pendingTriggers=[])).push(entry);
}

async function flushCombatTriggers(sd){
  if(!sd || sd!==G.showdown || sd.resolvingItem || sd.finalizingTriggers) return;
  if(!sd.pendingTriggers?.length){sd.initialTriggers=false;return;}
  sd.finalizingTriggers=true;
  const focus=G.actingPlayer;
  try{
    while(sd.pendingTriggers.length){
      const batch=sd.pendingTriggers.splice(0);
      // 초기 체인은 공격자부터, 이후 동시 격발은 턴 플레이어부터 적재한다.
      const first=sd.initialTriggers?sd.attacker:G.turn;
      sd.initialTriggers=false;
      for(const p of [first,opp(first)]){
        const remaining=batch.filter(t=>t.p===p), ordered=[];
        const orderOptions=remaining.map((t,i)=>({
          v:i,n:t.n,
          label:t.it ? `${t.srcName} → ${unitName(t.it)}` : t.srcName,
          combatTrigger:{n:t.n,ops:t.ab.ops}
        }));
        const orderTargets=remaining.map(t=>{
          const u=(t.it && everyUnit().includes(t.it)) ? t.it
            : (t.unit && everyUnit().includes(t.unit)) ? t.unit : null;
          return u?{kind:'unit',uid:u.uid}:null;
        });
        const orderKeys=orderTargets.map(t=>t&&`${t.kind}:${t.uid}`);
        if(remaining.length>1 && orderTargets.every(Boolean) && new Set(orderKeys).size===orderKeys.length && UI.pickBoardOrder){
          const indexes=await UI.pickBoardOrder(p,'전투 격발 순서 — 먼저 해결할 카드부터 선택',orderOptions,orderTargets);
          const valid=Array.isArray(indexes) && indexes.length===remaining.length
            && new Set(indexes).size===remaining.length
            && indexes.every(i=>Number.isInteger(i)&&i>=0&&i<remaining.length);
          (valid?indexes:remaining.map((_,i)=>i)).forEach(i=>ordered.push(remaining[i]));
          remaining.length=0;
        }
        while(remaining.length){
          let index=0;
          if(remaining.length>1){
            const sel=await UI.pickOption(p,'전투 격발 순서 — 먼저 해결할 효과',remaining.map((t,i)=>({
              v:i,n:t.n,label:t.srcName,combatTrigger:{n:t.n,ops:t.ab.ops}})));
            if(Number.isInteger(sel) && remaining[sel]) index=sel;
          }
          ordered.push(remaining.splice(index,1)[0]);
        }
        for(const t of ordered.reverse()){
          const ab=t.ab, cost=ab.cost||{};
          if(ab.optional && !(await UI.confirmP(p,`「${t.srcName}」 공격/방어 효과를 사용할까요?`,card(t.n)))) continue;
          if(!canPay(p,cost.energy||0,cost.pips||[])) continue;
          const source={kind:t.unit?'unit':'trigger',u:t.unit,n:t.n,bfIdx:t.bfIdx};
          const pick=()=>preTargetAbility(p,source,ab,cost);
          const pre=card(t.n)?.type==='Battlefield'
            ? await withBattlefieldSource({n:t.n,event:'onDefendHere'},pick) : await pick();
          if(pre===PRE_CANCEL) continue;
          payCost(p,cost.energy||0,cost.pips||[]);
          if(!sd.chain.length && sd.chainStarter==null && sd.triggerFocus==null) sd.triggerFocus=focus;
          const displayAffected=snapshotEffectApplications(ab.ops,{p,unit:t.unit,it:t.it,bfIdx:t.bfIdx});
          const item=stampChainItem({...t,kind:'ability',triggered:true,pre,
            displayTargets:snapshotCastTargets(pre),displayAffected});
          sd.chain.push(item);
          UI.log(`🔗 ${pname(p)} 격발 「${t.srcName}」 체인에 적재 (#${sd.chain.length})`,'p'+p);
          logCastTargets(p,t.srcName,describeCastTargets(pre));
          UI.fx.chainAdd(card(t.n),p,sd.chain.length);
        }
      }
    }
    if(sd.chain.length){sd.passes=0;G.actingPlayer=sd.chain[sd.chain.length-1].p;}
  }finally{sd.finalizingTriggers=false;}
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
  ensureDeck(p);
  const n=P.deck.shift();
  if(n!==undefined){ P.hand.push(n); if(!silent) UI.log(`${pname(p)} 카드 1장 드로우`, 'p'+p); }
  checkWin();
}
// 덱 맨 위 카드를 다른 존으로 옮기는 지시(드로우·추방 등) 앞에 부른다 — 덱이 비면 번아웃(431.1).
// 431.3.c / 431.4: 폐기장까지 비어 덱이 여전히 비면 같은 지시를 다시 시도할 때마다 번아웃이 반복되어
// 상대가 승리 점수에 닿을 때까지 매번 1점씩 준다 (예전엔 1회만 번아웃하고 드로우를 미완으로 남겼다).
function ensureDeck(p){
  const P=G.players[p];
  for(let guard=0; P.deck.length===0 && G.winner===null && guard<64; guard++) burnOut(p);
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
  if(fx && fx.onDiscardSelf){ if(G.manual) await execOps(fx.onDiscardSelf, {p, kind:'effect'}); else queueTrigger({ops:fx.onDiscardSelf}, {p, kind:'effect', n}); }   // '버려질 때' 격발은 진행 중인 행동이 끝난 뒤 체인에(383 · 죠스 6 · 고철 더미 182)
  // 여러 장을 한 번에 버릴 때는 호출부가 모아서 1회만 낸다 ("one or more cards" = 사건 1회)
  if(!(opts && opts.batch)) await fireEvent('onYouDiscard', {p, n});
  // 효과·클린업 밖에서 직접 버린 경우(테스트·개별 호출) 버림 격발을 지금 체인에 — 추가 비용·능력 비용의 버림(defer)은 그 행동이 끝난 뒤 cleanup/execOps가 비운다
  if(_execDepth===0 && !(opts && (opts.batch||opts.defer)) && !G.manual && G._pendingTriggers && G._pendingTriggers.length) await flushPendingTriggers();
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
// 힘 핍 표기: 'Any'(아무 속성) | 'Mind'(그 속성) | 'Mind|Order'(여러 속성 카드의 [C] — 그 카드 속성들 중 하나.
// 룰 136.3 2026-07-16판 "processed as any power of that card's Domains", 예시 Defiant Dance [1][C]는 [G] 또는 [P]로)
function pipDoms(pip){ return pip==='Any' ? null : String(pip).split('|'); }
function pipAllowsDom(pip, dom){ const ds=pipDoms(pip); return !ds || ds.includes(dom); }
// 풀(속성별 힘 수)에서 핍 하나를 차감한다. 허용 속성 풀 → 만능(Any) 풀 순. 성공하면 true.
function takeFromPool(pool, pip){
  const ds=pipDoms(pip);
  if(!ds){ const d=Object.keys(pool).find(d=>pool[d]>0); if(d){ pool[d]--; return true; } return false; }
  for(const d of ds) if(pool[d]>0){ pool[d]--; return true; }
  if(pool.Any>0){ pool.Any--; return true; }
  return false;
}
function canPay(p, energy, pips){
  const P=G.players[p];
  const poolP = {...P.power};
  const used = new Set();
  // 주문 전용 힘(카이사 전설 247, 무지개) — 주문 지불(spellOK)일 때만 어느 핍이든 충당
  let spellAny = arguments[3] ? (P.powerSpell||0) : 0;
  // 힘 핍: 풀 → 영역 일치 룬 (준비/탈진 무관, 핍당 서로 다른 룬)
  for(const pip of pips){
    if(spellAny>0){ spellAny--; continue; }
    if(takeFromPool(poolP, pip)) continue;
    const ri = P.runes.findIndex((r,i)=>!used.has(i) && pipAllowsDom(pip, runeDomain(r.n)));
    if(ri<0) return false;
    used.add(ri);
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
    if(takeFromPool(pool, pip)) continue;
    return true;                       // 이 핍은 룬을 재활용해야 낸다
  }
  let need = energy;
  if(spellOK) need -= Math.min(P.energySpell||0, need);
  need -= Math.min(P.energy, need);
  return need > 0;                     // 남으면 준비 룬을 탈진시켜야 한다
}

// 룰 357.1.a: 비용을 내기 전에 [반응] 태그 자원 능력(인장·카이사/다리우스 전설)으로 먼저 충당할지 묻는다.
// 카드 플레이·활성화 능력(미끼 바늘 등)·숨김 비용이 공용으로 쓴다 — 예전엔 카드 플레이에만 있어서, 미끼 바늘의 힘 1을
// 인장을 꺾어 낼 수 있는데도 룬이 재활용됐다 (제보 2026-09-22). 반환: true=지불 가능, false=취소(자원 부족 포함).
//   · 룬을 건드려야 하는 지불이고 아낄 수 있는 능력이 있으면 "먼저 쓸까요?"를 묻고(거절 가능),
//   · 그래도 모자라면 "충당할까요?"를 묻는다(여기서 취소하면 행동 자체가 취소).
// 지금 이 비용에 보탤 수 있는 [반응] 자원 능력 목록 (인장·전설). 없으면 빈 배열.
function listResourceFunding(p, energy, pips, spellOK){
  if(!(typeof polAbList==='function' && typeof polAbLegal==='function' && typeof polAbIsResource==='function')) return [];
  try{
    return polAbList(p).filter(cd=>cd.ab && cd.ab.reaction && polAbIsResource(cd) && polAbLegal(p,cd)
      && resourceAbilityHelpsPay(p,cd.ab,energy,pips,spellOK));
  }catch(e){ return []; }
}
// 지금 쓸 수 있는 [반응] 자원 능력을 전부 쓴다고 가정하면 이 비용을 낼 수 있는가 — "도움이 된다"가 아니라 "낼 수 있다"를 본다.
// ([가속] 제안처럼, 결국 못 낼 비용을 물어봤다가 되돌리는 일이 없게)
function canPayWithFunding(p, energy, pips, spellOK){
  if(canPay(p, energy, pips, spellOK)) return true;
  const P=G.players[p];
  const funds=listResourceFunding(p, energy, pips, spellOK);
  if(!funds.length) return false;
  const saved={ energy:P.energy, energySpell:P.energySpell, powerSpell:P.powerSpell, power:{...P.power} };
  try{
    for(const cd of funds) for(const op of (cd.ab.ops||[])){
      if(!(op.n>0)) continue;
      if(op.op==='addEnergy') P.energy+=op.n;
      else if(op.op==='addSpellEnergy') P.energySpell=(P.energySpell||0)+op.n;
      else if(op.op==='addSpellPower') P.powerSpell=(P.powerSpell||0)+op.n;
      else if(op.op==='addPower') P.power[op.dom||'Any']=(P.power[op.dom||'Any']||0)+op.n;
    }
    return canPay(p, energy, pips, spellOK);
  } finally { P.energy=saved.energy; P.energySpell=saved.energySpell; P.powerSpell=saved.powerSpell; P.power=saved.power; }
}
async function askResourceFunding(p, label, energy, pips, spellOK, n, stopLabel){
  const P=G.players[p];
  const fundList=()=>listResourceFunding(p, energy, pips, spellOK);
  const fundOptions=(funds,stop)=>[
    ...funds.map((cd,i)=>({v:i, label:`⚡ ${cd.name} — ${cd.ab.label}`, resourceOps:cd.ab.ops, resourceCost:[cd.ab.cost?.exhaustSelf?'이 카드 탈진':'',cd.ab.cost?.killFriendlyOrGear?'아군 유닛 또는 도구 1개 처치':''].filter(Boolean).join(', '),
      card:cd.src.kind==='legend' ? card(P.legendN) : cd.src.kind==='unit' ? unitCard(cd.src.u) : card(cd.src.g.n)})),
    {v:stop?'stop':'no', label:stop?(stopLabel||'취소'):'인장/능력 없이 지불', skipResourcePrompt:true,
      resourcePayment:{n, energy, pips}}
  ];
  // 모자랄 때만 물어보면, 룬을 재활용해 낼 수 있는 한 카이사 전설을 쓸 기회가 영영 없다.
  // 룬 재활용·탈진은 실제로 치르는 비용이므로, 그걸 아낄 수 있는 능력이 있으면 먼저 물어본다.
  for(let guard=0; guard<4 && canPay(p, energy, pips, spellOK) && payUsesRunes(p, energy, pips, spellOK); guard++){
    const funds=fundList();
    if(!funds.length) break;
    const sel=await UI.pickOption(p, `「${label}」 룬을 쓰기 전에 [반응] 자원 능력을 먼저 쓸까요? (룰 357.1.a)`,
      fundOptions(funds,false));
    if(sel===null || sel==='no') break;
    await activateAbility(p, funds[sel].src, funds[sel].ab);
  }
  // 그래도 모자라면 충당할지 묻는다 (여기서 취소하면 행동 자체가 취소된다)
  for(let guard=0; guard<8 && !canPay(p, energy, pips, spellOK); guard++){
    const funds=fundList();
    if(!funds.length){ UI.toast('자원이 부족합니다','warn'); return false; }
    const sel=await UI.pickOption(p, `「${label}」 자원이 부족합니다 — [반응] 자원 능력으로 충당할까요? (룰 357.1.a)`,
      fundOptions(funds,true));
    if(sel===null || sel==='stop'){ UI.toast('자원이 부족합니다','warn'); return false; }
    await activateAbility(p, funds[sel].src, funds[sel].ab);
  }
  if(!canPay(p, energy, pips, spellOK)){ UI.toast('자원이 부족합니다','warn'); return false; }
  return true;
}

// 이미 풀로 충당되는 비용을 제외하고, 이 능력이 남은 비용에 쓸 자원을 만드는지 확인한다.
// 카드의 인쇄 영역이 아니라 할인/추가 비용까지 반영한 핍을 검사한다.
function resourceAbilityHelpsPay(p, ab, energy, pips, spellOK){
  const P=G.players[p], pool={...P.power}, remaining=[];
  let spellAny=spellOK ? (P.powerSpell||0) : 0;
  for(const pip of pips){
    if(spellAny>0){ spellAny--; continue; }
    if(!takeFromPool(pool,pip)) remaining.push(pip);
  }
  const needEnergy=Math.max(0,energy-P.energy-(spellOK ? (P.energySpell||0) : 0));
  return (ab.ops||[]).some(op=>{
    if(!(op.n>0)) return false;
    if(op.op==='addEnergy') return needEnergy>0;
    if(op.op==='addSpellEnergy') return spellOK && needEnergy>0;
    if(op.op==='addSpellPower') return spellOK && remaining.length>0;
    if(op.op==='addPower') return remaining.some(pip=>op.dom==='Any' || pipAllowsDom(pip,op.dom));
    return false;
  });
}

// 실제 지불 (canPay 선행 가정)
// 순서 중요: ① 에너지(준비 룬 탈진) → ② 힘(탈진 룬 우선 재활용 — 방금 에너지에 쓴 룬 포함)
function payCost(p, energy, pips, silent){
  const P=G.players[p];
  // 힘 핍 중 풀로 못 내서 룬을 재활용해야 하는 영역을 미리 뽑는다.
  const peek={...P.power};
  const runeDoms=[];
  for(const pip of pips){
    if(takeFromPool(peek, pip)) continue;
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
      const r = ready.find(r=>!order.includes(r) && pipAllowsDom(dom, runeDomain(r.n)));
      if(r) order.push(r);
    }
    for(const r of ready) if(!order.includes(r)) order.push(r);   // 남는 건 기존 순서대로
    for(const r of order){ if(need<=0) break; r.ex=true; need--; }
  }
  // ② 힘 핍: 주문 전용 힘(spellOK) → 풀 → 탈진 룬 재활용(룬 덱 반환) → 준비 룬 재활용
  const recycled=[];
  for(const pip of pips){
    if(arguments[4] && (P.powerSpell||0)>0){ P.powerSpell--; continue; }
    if(takeFromPool(P.power, pip)) continue;
    // 룬 재활용 — 핍이 허용하는 속성의 룬
    let match = r=> pipAllowsDom(pip, runeDomain(r.n));
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
  // 룰 136.3(2026-07-16판): 속성이 없는 카드의 [C]는 [A](아무 속성), 여러 속성 카드의 [C]는 '그 카드 속성들 중 하나'.
  // 이중 속성 시그니처(힘 착취 등)는 인쇄 핍도 두 속성 반반 하이브리드 — 두 속성 중 어느 룬으로도 지불(다른 속성은 불가).
  // (예전엔 doms[i%len]로 첫 속성만 배정해 정신/질서 카드 1핍을 정신 룬으로만 낼 수 있었고, 그 뒤 잠시 [A]로 두었다)
  const pip = !(c.dom&&c.dom.length) ? 'Any' : (c.dom.length===1 ? c.dom[0] : c.dom.join('|'));
  const pips=[];
  for(let i=0;i<n;i++) pips.push(pip);
  return pips;
}

// ---------- 선후공 결정 (룰 115.1.b "모든 플레이어가 합의한 공정한 무작위 방법") ----------
// 각자 주사위(1~6)를 굴려 높은 쪽이 선공/후공을 고른다. 동점이면 다시 굴린다.
// 시드 난수(rng)라 온라인 양쪽 결과가 같고, 승자의 선택은 UI.pickOption(routedPick)으로 동기화된다.
async function decideFirstPlayer(){
  let d0, d1, tries=0, instant=false;
  const animated=G.reviewSetup && typeof UI.rollSetupDice==='function';
  if(G.orderChooser===0||G.orderChooser===1){
    const w=G.orderChooser;
    UI.log(`이전 게임의 패자 ${pname(w)}이(가) 선후공을 선택합니다 (대회 규정 — 전장 공개 뒤, 드로우 전)`, 'sys');
    UI.render();
    const v = (animated && typeof UI.pickSetupOrder==='function') ? await UI.pickSetupOrder(w,null) : await UI.pickOption(w,
      '이전 게임 패자 — 선공과 후공 중 선택하세요 (후공은 첫 전개 단계에 룬을 1개 더 전개)',
      [{label:'⚔️ 선공', v:'first'}, {label:'🛡️ 후공 (첫 전개 룬 +1)', v:'second'}]);
    const first = (v==='second') ? opp(w) : w;
    G.turn=first; G.actingPlayer=first;
    UI.log(`${pname(w)}: ${v==='second'?'후공':'선공'} 선택 → 선공: ${pname(first)} — 후공은 첫 전개 단계에 룬을 1개 더 전개합니다`, 'sys');
    if(typeof UI.turnOrderDecided==='function') UI.turnOrderDecided();
    UI.render();
    return;
  }
  do{
    d0=1+Math.floor(rng()*6); d1=1+Math.floor(rng()*6); tries++;
    if(animated && typeof UI.rollSetupDiceBoth==='function'){
      await UI.rollSetupDiceBoth(d0,d1,tries);          // 두 주사위 동시·자동 (입력 없음)
    } else if(animated){
      const roll0=await UI.rollSetupDice(0,d0,tries); instant=instant||!!roll0?.instant;
      const roll1=await UI.rollSetupDice(1,d1,tries); instant=instant||!!roll1?.instant;
    }
    if(d0===d1) UI.log(`🎲 주사위: ${pname(0)} ${d0} vs ${pname(1)} ${d1} — 동점, 다시 굴립니다`, 'sys');
  }while(d0===d1 && (animated || tries<50));
  const w = d0>d1 ? 0 : 1;
  UI.log(`🎲 주사위: ${pname(0)} ${d0} vs ${pname(1)} ${d1} → ${pname(w)}이(가) ${instant?'선공입니다':'선후공을 선택합니다'}`, 'sys');
  UI.render();
  const v = instant ? 'first' : animated ? await UI.pickSetupOrder(w,[d0,d1]) : await UI.pickOption(w,
    `🎲 주사위 ${Math.max(d0,d1)} : ${Math.min(d0,d1)} 승리! 선공과 후공 중 선택하세요 (후공은 첫 전개 단계에 룬을 1개 더 전개)`,
    [{label:'⚔️ 선공', v:'first'}, {label:'🛡️ 후공 (첫 전개 룬 +1)', v:'second'}]);
  const first = (v==='second') ? opp(w) : w;
  G.turn=first; G.actingPlayer=first;
  UI.log(`${instant?'즉시 무작위 결정':pname(w)+': '+(v==='second'?'후공':'선공')+' 선택'} → 선공: ${pname(first)} — 후공은 첫 전개 단계에 룬을 1개 더 전개합니다`, 'sys');
  if(instant) UI.toast(`즉시 결정 — 선공: ${pname(first)}, 후공: ${pname(opp(first))}`);
  if(typeof UI.turnOrderDecided==='function') UI.turnOrderDecided();
  UI.render();
}

// ---------- 멀리건 (공식 룰: 종합 규칙 110-118) ----------
// 턴 순서대로: 손패에서 최대 2장을 따로 빼두고 → 그 수만큼 드로우 → 빼둔 카드를 덱 맨 아래로 재활용.
async function mulliganPhase(){
  const setupStage=!!G.reviewSetup;
  if(setupStage && UI.setSetupStage) UI.setSetupStage(true);
  try{
  if(G.reviewSetup && !await UI.reviewSetup()) return;
  await decideFirstPlayer();
  if(UI.finishSetup) UI.finishSetup();
  if(setupStage && UI.setSetupStage) UI.setSetupStage(false);
  if(G.reviewSetup){
    G.players.forEach(p=>{ for(let i=0;i<4;i++) drawCard(p.idx,true); });
    G.reviewSetup=false;
    UI.render();
  }
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
  }finally{
    if(setupStage && UI.finishSetup) UI.finishSetup();
    if(setupStage && UI.setSetupStage) UI.setSetupStage(false);
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
  G.players.forEach(pl=>{ pl.playedCards=0; pl.playedSeq=0; });
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
    { // 같은 개시 단계의 [일시적] 처치는 동시 사망(808.1.d.2) — 카서스 236 '종소리 추가 1회'·존야 선택이 배치 경로를 탄다(RiftJudge #11510)
      const temps=everyUnit().filter(u=>u.ctrl===p && effKw(u).temporary);
      // [일시적] 처치는 개시 단계 시작 시의 격발(816.1.b) — 체인에 올라 그 창에서 숨긴 존야(77)를 공개해 둘 수 있다(RiftJudge #10806 · #2)
      if(temps.length) queueTrigger({ops:[{op:'killTemporaryBatch'}]}, {p, units:temps, n:unitCard(temps[0]).n, kind:'effect'});
    }
    // [일시적]은 도구(영구물)에도 붙는다 — 「희미해지는 기억」(180)이 준 도구는 통제자의 개시 단계에 처치 (룰 742.1 · #6709)
    for(const g of [...P.gear].filter(g=>g.temporary)){
      const gi=P.gear.indexOf(g); if(gi<0) continue;
      UI.log(`[일시적] 도구 「${card(g.n).ko}」 처치됨`, 'sys');
      await killGear(p, gi);
    }
    if(G.turnCount<=2){
      for(let i=0;i<G.bfs.length;i++)
        await fireBfTrigger(i,'onFirstBeginning',{p, bfIdx:i});
    }
    await fireTriggers('onBeginning', {p});
    await flushPendingTriggers();   // 개시 격발(징크스 전설 251 등)은 체인에 — 상대 응수 가능(#2606)
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
    await flushPendingTriggers();   // 유지 격발도 체인에 — 상대 응수 가능(383.4.a.3)
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
  if(G._endingTurn) return; // 종료 트리거·결전을 처리 중인 동안 중복 종료 방지
  const p=G.turn;
  G.phase='ending';
  G._endingTurn={p};
  UI.render();
  // 턴 종료 트리거 (소나, 눈부신 오로라 등). 종료 격발이 남아 있는 동안은 체인이 있는 닫힌 상태라 결전이 열리지 않는다
  // (룰 342.1.b 결전은 중립 열린 상태에서 · 클린업 9단계) — 오로라 두 장이면 둘 다 해결한 뒤에야 죽음꽃 포식자의 결전이 열린다 (RiftJudge #9290).
  G._holdShowdown=true;
  try{ await fireEvent('onEndTurn', {p}); await flushPendingTriggers(); } finally{ G._holdShowdown=false; }   // 종료 격발도 체인(응수 가능) — 결전은 다 끝난 뒤(342.1.b)
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
  kind=kind||'effect';
  const casting = (G._casting!==undefined && G._casting!==null) ? G._casting : null;
  // 717.3 "If no damage was Dealt, then Bonus Damage will not apply" — 피해 0인 인스턴스(힘 0을 낸 「쌍권총 난사」, 숨김 0장의 티모)에는
  // 「레이븐본 서적」의 +1도 붙지 않는다 (구판 RiftJudge #5791과 반대 — 2026-07-16판 717.3이 우선)
  if(n<=0) return 0;
  if(kind==='spell' && casting!==null) n += TF().nextSpellBonus[casting]||0;
  if(unitFx(u).noDmgIfMoved2 && (u.turnMoves||0)>=2){ UI.log(`${unitName(u)} 피해 무시 (이번 턴 2회 이동)`, 'sys'); return 0; }
  if(TF().preventSpellDmg && kind!=='combat' && kind!=='unit'){ UI.log(`피해 방지됨 (효과)`, 'sys'); return 0; }
  u.dmg+=n;
  // 처치 귀속(룰 416): 클린업 사망은 "직전에 해결되어 피해를 준 주문"의 처치 — 마지막 피해의 출처(시전자)를 기억한다.
  // 전투·유닛 주체 피해가 마지막이면 어느 주문의 처치도 아니다.
  u._spellDmgBy = (casting!==null && kind!=='combat' && kind!=='unit') ? casting : null;
  UI.fx.unit(u, 'hit', '-'+n);
  if(TF().dmgKill){ u._decree=true; u._decreeBy=TF().dmgKillBy; } // 황제의 칙령 — 처치는 칙령 시전자의 주문 처치(#7364)
  if(u._guillotine && n>0){ u._guillotine=false; u._decree=true; u._decreeBy=u._guillotineBy; UI.log(`「녹서스의 단두대」: ${unitName(u)} 처치 표식 발동`, 'combat'); }
  return n;
}
function canReceiveBuff(u){
  return !!u && (u.buff<1 || !!unitFx(u).multiBuff);
}
async function confirmBuffTarget(p, u){
  if(canReceiveBuff(u)) return true;
  return UI.confirmP(p, `「${unitName(u)}」은(는) 이미 버프가 있어 추가 버프가 놓이지 않습니다. 그래도 이 유닛을 선택할까요?`, unitCard(u), {
    boardCard:{kind:'unit',uid:u.uid},
    decision:{title:'이미 버프된 유닛',cost:'추가 버프 없음',result:'이 유닛을 대상으로 선택',accept:'그래도 선택',decline:'다른 유닛 선택'}
  });
}
async function buffUnit(u, byP){
  // 공식 룰: 유닛당 버프는 1개까지(702.3) — 단, 카드 텍스트가 예외면 그쪽이 우선
  // (리 신 - 수행자 #78 "나는 버프를 몇 개든 가질 수 있다" → FX.multiBuff)
  if(!canReceiveBuff(u)){
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
  await runTriggerList(unitFx(u).triggers?.onMoveSelf, {p:u.ctrl, unit:u, it:u, bfIdx:(dest!=='base'?dest:null), dest, deferChain:true});   // 효과 이동(바람 타기 등)의 이동 격발은 그 효과가 끝난 뒤 체인에(359.3.d)
  if(dest!=='base') await fireEvent('onMoveToBf', {p:u.ctrl, bfIdx:dest, mover:p});   // 기준은 '이동하는 유닛의 진영'(볼리베어 158 — RiftJudge #8279가 #2499보다 최신·구체적: 매혹으로 적 유닛을 옮기면 격발)
  // 효과로 옮겨진 이동도 이동이다 (룰 427). 「매혹」으로 상대 유닛을 내 전장에 끌어오면
  // 상대가 공격자이고 그 유닛이 공격자 지정을 받는다 (룰 428).
  await fireAttackTriggers(u, dest);
  // 효과 이동에도 「은밀한 추적자」가 따라갈 수 있다 (#6119 "It can move with Ride the Wind on a friendly unit")
  await tagAlongFollow([u], [from], dest);
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
    // 목적지가 정해진 주문(「점멸」 → 기지)은 이미 그곳에 있는 유닛도 대상으로 고를 수 있다 — 이동만 생략 (RiftJudge #10257)
    if(extra.stayOK && to==='base' && u.loc==='base'){
      options.push({ v:options.length, label:`${unitLabel(u)} — 이동 없음 (대상 지정만)`, card:unitCard(u), movement:{ uid:u.uid, dest:'base', stay:true } });
      continue;
    }
    const dests = to==='base' ? ['base']
      : to==='baseLink' ? (u.loc==='base' ? G.bfs.map((_,i)=>i) : ['base'])
      : to==='any' ? [...G.bfs.map((_,i)=>i), 'base']
      : to==='bf' ? G.bfs.map((_,i)=>i)
      : [to];
    for(const dest of dests){
      if(extra.swapUid){                       // 물결을 바꾸는 자: 교환은 두 이동의 묶음 — 한쪽만 가능해도 그쪽은 옮긴다
        // ("가능한 만큼만 실행" 356.3.e · RiftJudge #7241: 둥지의 유닛은 기지로 못 가지만 물결을 바꾸는 자는 둥지로 간다)
        const me=everyUnit().find(x=>x.uid===extra.swapUid);
        if(!me || dest!==me.loc || !(canEffectMove(me, u.loc) || canEffectMove(u, dest))) continue;
      }
      else if(!canEffectMove(u, dest)){
        // 「바일마우의 둥지」(NO_RETREAT)의 유닛을 '기지로' 고르는 것 자체는 적법 — 이동 지시만 부정되고 연결 지시(준비 등)는 실행(356.3.e · RiftJudge #11771 · #5189)
        if(dest==='base' && u.loc!=='base' && G.bfs[u.loc] && G.bfs[u.loc].n===BF_STATIC.NO_RETREAT)
          options.push({ v:options.length, label:`${unitLabel(u)} → 기지 (둥지: 이동 불가 — 대상 지정·연결 지시만)`, card:unitCard(u), movement:{ uid:u.uid, dest:'base', negated:true, ...extra } });
        continue;
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
    const sel = await UI.pickOption(p, ask?`${title} (이동은 강제 — 취소할 수 없습니다)`:title, options, 'movement');
    choice = (options.find(o=>o.v===sel)||{}).movement;
    if(!choice && (spec.optional || (sel!==null && sel!==undefined))) break;   // '이동하지 않음' 선택 또는 선택형
  }
  if(!choice && !spec.optional) choice=options[0].movement;
  return choice ? await resolveEffectMove(p, choice) : null;
}
async function resolveEffectMove(p, choice){
  const u = everyUnit().find(x=>x.uid===choice.uid);
  if(!u || u._dead) return null;
  if(choice.stay){                                   // 대상 지정만, 이동 없음 (점멸이 기지 유닛을 고른 경우 — #10257)
    if(!u) return null;
    if(!choice.alreadyPicked){ noteSpellPick(p, u); if(!(await payDeflect(p, u))) return null; }
    UI.log(`${unitName(u)} — 이미 기지에 있어 이동 없음 (대상 지정만)`, 'sys');
    return u;
  }
  if(choice.negated){   // 둥지의 유닛을 기지로: 대상 지정·굴절은 그대로, 이동만 생략하고 연결 지시는 실행
    if(!choice.alreadyPicked){ noteSpellPick(p, u); if(!(await payDeflect(p, u))) return null; }
    UI.log(`${unitName(u)} — 「바일마우의 둥지」에서 기지로 이동할 수 없어 이동만 생략 (연결 지시는 실행 · #11771)`, 'sys');
    if(choice.buff) await buffUnit(u, p);
    if(choice.ready) await readyUnit(u, p);
    return u;
  }
  const swapMe = choice.swapUid ? everyUnit().find(x=>x.uid===choice.swapUid) : null;
  const uCan = canEffectMove(u, choice.dest);
  // 교환은 두 이동 각각을 따로 판정 — 한쪽이 막혀도(바일마우의 둥지) 다른 쪽은 옮긴다(356.3.e · #7241)
  if(!uCan && !(swapMe && canEffectMove(swapMe, u.loc))) return null;
  if(!choice.alreadyPicked){
    noteSpellPick(p, u);
    if(!(await payDeflect(p, u))) return null;
  }
  if(choice.buff) await buffUnit(u, p);
  // 「폭풍의 돌격」: 도착 전장의 적에게 이동 유닛의 위력만큼 피해
  if(choice.storm) for(const e of G.bfs[choice.dest].units.filter(x=>x.ctrl!==p)) dealDamage(e, dmgPlus(might(u), e, p), 'spell');   // 관문 296·애니 301 추가 피해(713)
  if(swapMe){
    if(canEffectMove(swapMe, u.loc)) await effectMove(p, swapMe, u.loc);
    else UI.log(`${unitName(swapMe)}은(는) 그곳으로 이동할 수 없어 제자리 (교환 일부만 실행)`, 'sys');
    if(!uCan){ UI.log(`${unitName(u)}은(는) 이동할 수 없어 제자리 (교환 일부만 실행)`, 'sys'); return u; }
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
      for(const t of gf.triggers.onGearLeave){ const lctx={p, gear:g, n:g.n, reason:'kill'}; if(t.cond && !t.cond(lctx)) continue; if(G.manual) await execOps(t.ops, lctx); else queueTrigger(t, lctx); }
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
  detachGear(u);                                    // 장착 도구는 손패로 따라가지 않고 기지로 회수 (룰 425 · #9348)
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
  const yes=await UI.confirmP(p,`[굴절 ${defl}] 힘 ${defl} 추가 지불이 필요합니다. 지불할까요?`, unitCard(u),{decision:{title:'굴절 비용',cost:`아무 영역 힘 ${defl}`,result:`「${unitName(u)}」을(를) 대상으로 선택`,accept:'지불하고 선택',decline:'지불 안 함'}});
  if(!yes) return false;
  // 플레이 시점(base 있음)의 굴절은 주문 자체의 추가 비용(353.2.b.1)이라 주문 전용 힘(카이사 전설 247)으로 낼 수 있다.
  // 해결 시점 선택(반사 격발·능력)의 굴절은 주문 비용이 아니라 전용 힘을 못 쓴다 (RiftJudge #4616 · #7545).
  payCost(p,0,pips,undefined, !!(base && base.spellOK));
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
  if(gf&&gf.triggers&&gf.triggers.onGearLeave) for(const t of gf.triggers.onGearLeave){ const lctx={p, gear:g, n:g.n, reason:'hand'}; if(t.cond && !t.cond(lctx)) continue; if(G.manual) await execOps(t.ops, lctx); else queueTrigger(t, lctx); }   // 손패 복귀(경이의 꾸러미 181)는 처치가 아니다 — 고철 더미 182는 cond로 제외
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
  if(c.type==='Spell' && (fx.playOps||[]).some(g=>(g.ops||[]).some(op=>op.op==='lookTopHand')) && G.players[p].deck.length===0)
    return '덱이 비어 있어 플레이할 수 없습니다 (RiftJudge #11597)';   // 조작된 덱 183
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
async function pickUnitPlayLocation(p, n, play){
  const locs=unitPlayLocationOptions(p,n).map(o=>({...o,placement:{n,...play}}));
  return await UI.pickOption(p,'유닛을 배치할 위치',locs,'placement');
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
  // locByEffect: 효과가 위치를 지정한 플레이("play ... here" — 성취자 아바 107)는 통제 여부 검사를 거치지 않는다
  if(hasPlayLoc && !opts.locByEffect && !canPlayCardAt(p,n,opts.playLoc)){
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
      loc = hasPlayLoc ? opts.playLoc : await UI.pickOption(p,'유닛을 배치할 위치 — 기본 규칙: 기지 또는 통제 중인 전장', locs,'placement');
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
  const addDecision=AC?{title:'추가 비용',cost:AC.kind==='discard'?'카드 1장 버리기':AC.kind==='pip'?`${DOMAIN_KO[AC.dom]||AC.dom} 힘 1`:AC.kind==='exhaustUnit'?'아군 유닛 1기 탈진':AC.label,result:AC.discountE?`에너지 비용 ${AC.discountE} 감소`:c.n===44?'카드 1장 뽑기':c.n===48?'카드 2장 뽑기 (미지불 시 1장)':AC.ignoreCost?'카드 비용 면제':AC.label,accept:'추가 비용 지불',decline:'추가 비용 없이 진행'}:null;
  let addPaid=false, addCount=0, addSel=null;
  // 숨김 공개도 기본 비용만 0이 될 뿐(738.1) 추가 비용은 그대로 묻는다 — 룰 353 "ignore는 기본 비용만" (RiftJudge #2488)
  if(AC){
    if(AC.kind==='discard'){
      if(P.hand.length>1 || opts.champZone)
        addPaid = await UI.confirmP(p, `추가 비용: ${AC.label||'카드 1장 버리기'} — 지불할까요?`, c,{decision:addDecision});
    } else if(AC.kind==='pip'){
      if(canPay(p, 0, [AC.dom]))
        addPaid = await UI.confirmP(p, `추가 비용: ${AC.label||AC.dom+' 힘 1'} — 지불할까요?`, c,
          {decision:addDecision,cost:{energy:opts.ignoreEnergy?0:Math.max(0,applyCostMods(p,c,opts.fromHidden?0:(c.e||0))-(opts.discountE||0)),
            pips:opts.ignorePower?[]:[...(opts.fromHidden?[]:powerPips(c)),AC.dom],spellOK:c.type==='Spell'}});
    } else if(AC.kind==='exhaustUnit'){
      const cands=everyUnit().filter(u=>u.ctrl===p&&!u.ex);
      if(cands.length && await UI.confirmP(p, `추가 비용: ${AC.label||'아군 유닛 탈진'} — 지불할까요?`, c,{decision:addDecision})){
        addSel=await UI.pickUnitFrom(p,cands,'탈진할 아군 유닛'); addPaid=!!addSel;
      }
    } else if(AC.kind==='spendBuff'){
      const cands=everyUnit().filter(u=>u.ctrl===p&&u.buff>0);
      if(cands.length){
        addSel=await UI.pickUnitFrom(p,cands,`추가 비용: ${AC.label||'버프 1개 소모'} — 유닛 선택`,true,
          {costConfirmation:{text:`추가 비용: ${AC.label||'버프 1개 소모'} — 지불할까요?`,pickTitle:'버프를 소모할 유닛',preview:c}}); addPaid=!!addSel;
      }
    } else if(AC.kind==='spendBuffs'){
      const buffed=everyUnit().filter(u=>u.ctrl===p&&u.buff>0);
      addSel=buffed.length?await UI.pickBuffs(p,AC.label||'소모할 버프 수',buffed):[];
      addCount=addSel.reduce((s,x)=>s+x.count,0);
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
  const killDiscPips=[];   // 처치 수만큼 깎은 힘 핍 — 실제로 죽지 않은 만큼 되갚는다 (레드로스 231)
  if(opts.fromHidden){ energy=0; pips=[]; }
  // 힘 할인(크라켄 사냥꾼 150 '버프당 힘 -1')은 [가속] 추가 비용까지 합한 '총비용'에서 뺀다 (룰 353 3단계
  // "additional costs ... then reductions" · RiftJudge #4836 · #7976 — 4E 3P가 되어 버프 3개면 힘 0) → 가속 결정 뒤에 적용
  const pipDisc = (AC && addPaid && AC.pipDiscountPer) ? addCount : 0;
  // record=true인 호출(실제 비용 확정)만 깎은 핍을 기록한다 — 가속 가능 여부 검사 호출은 기록하지 않는다
  const discPips = (arr, record) => { const a=[...arr]; for(let i=0;i<pipDisc && a.length;i++){ const x=a.pop(); if(record) killDiscPips.push(x); } return a; };
  if(AC && addPaid){
    if(AC.discountE) energy=Math.max(0,energy-AC.discountE);
    if(AC.ignoreCost){ energy=0; pips=[]; }
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
    const accE=Math.max(0,energy+1-discE), accP=discPips([...pips, ...accPips]);
    // 풀·룬으로는 모자라도 인장·전설의 [반응] 자원 능력으로 낼 수 있으면 [가속]을 제안한다 (요청 2026-09-22 — 예전엔 룬만 보고 제안을 생략)
    // 인장을 다 써도 못 내는 비용(예: 에너지는 되지만 힘 룬이 없음)이면 제안하지 않는다
    const accCanPay=canPay(p, accE, accP), accCanFund=!accCanPay && canPayWithFunding(p, accE, accP, false);
    if(accCanPay || accCanFund){
      accel = await UI.confirmP(p, `[가속] 추가 비용(에너지 1+힘 1)을 지불하고 준비 상태로 등장시킬까요?`, c,
        {decision:{title:'가속',cost:`에너지 1, ${DOMAIN_KO[accPips[0]]||'아무 영역'} 힘 1 추가`,result:'준비 상태로 등장',accept:'가속하여 등장',decline:'가속 없이 등장'},cost:{energy:Math.max(0,energy+1-discE),pips:discPips([...pips,...accPips]),spellOK:false}});
      if(accel){
        energy+=1; pips=[...pips,...accPips];
        // 인장 등을 써야만 가속 비용이 나오는 경우: 여기서 먼저 묻는다. 거절·취소하면 카드는 그대로 내되 가속만 포기한다.
        if(accCanFund && !(await askResourceFunding(p, `${c.ko} [가속]`, Math.max(0,energy-discE), discPips(pips,false), false, c.n, '가속 없이 플레이'))){
          accel=false; energy-=1; pips=pips.slice(0, pips.length-accPips.length);
          UI.log(`「${c.ko}」 [가속] 비용을 내지 않아 가속 없이 등장합니다`, 'sys');
        }
      }
    }
  }
  pips = discPips(pips, true);
  energy = Math.max(0, energy-discE);
  const spellOK = c.type==='Spell';   // 주문 전용 자원(럭스 314·카이사 전설 247)은 주문에만 쓸 수 있다
  // 룰 357.1.a: 비용 지불 단계에서 [반응] 자원 능력(인장·카이사/다리우스 전설)으로 먼저 충당할지 묻는다 — 활성화 능력·숨김과 공용
  if(!(await askResourceFunding(p, c.ko, energy, pips, spellOK, c.n, '카드 사용 취소'))) return false;

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
  // 추가 비용으로 유닛이 보드를 떠나도 선택 당시 이름·위치를 기록할 수 있게 미리 문구를 만든다.
  const chosenTargets=describeCastTargets(pre);
  const displayTargets=snapshotCastTargets(pre);
  const displayAffected=c.type==='Spell'
    ? snapshotEffectApplications(fx.playOps.filter(po=>!po.legion||legionOK).flatMap(po=>po.ops),
      {p,bfIdx:opts.bfIdx,hiddenBf:(opts.fromHidden && !fx.hiddenFreeTarget)?opts.bfIdx:null})
    : [];

  // 위치 선택 (유닛)
  let loc=null;
  if(c.type==='Unit'){
    if(opts.fromHidden) loc=opts.bfIdx;
    else {
      loc = hasPlayLoc ? opts.playLoc : await pickUnitPlayLocation(p, n, {handIdx,opts});
      if(loc===null) return false;
    }
  }

  if(AC?.kind==='spendBuffs' && addSel.some(x=>{
    const u=everyUnit().find(u=>u.uid===x.uid);
    return !u || u.ctrl!==p || !Number.isInteger(x.count) || x.count<1 || u.buff<x.count;
  })){
    UI.toast('선택한 버프 상태가 바뀌었습니다. 다시 선택하세요','warn'); return false;
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
    if(AC.kind==='discard' && P.hand.length){ const di=await UI.pickHandCard(p,'버릴 카드 (추가 비용)'); if(di!==null) await discardFromHand(p,di,{defer:true}); }   // 죠스(6)는 이 카드가 등장한 뒤 체인에(383)
    else if(AC.kind==='exhaustUnit' && addSel){ addSel.ex=true; UI.log(`${unitName(addSel)} 탈진 (추가 비용)`, 'p'+p); }
    else if(AC.kind==='spendBuff' && addSel){ addSel.buff=Math.max(0,addSel.buff-1); }
    else if(AC.kind==='spendBuffs'){
      for(const x of addSel){ const u=everyUnit().find(u=>u.uid===x.uid); u.buff-=x.count; } }
    else if(AC.kind==='killUnit' && addSel){ await killUnit(addSel); }
    else if(AC.kind==='killUnits' && addSel){
      // "이렇게 처치된 만큼" 할인 — 존야·무기고 등 대체 효과로 살아난 유닛은 처치가 아니다(415.5.c · RiftJudge #377).
      // 비용은 이미 지불했으므로(355: 대체된 비용도 지불로 본다) 살아난 수만큼의 힘 핍을 추가로 낸다.
      let died=0; for(const u of addSel){ if(await killUnit(u)) died++; }
      const owe=killDiscPips.slice(0, Math.max(0, addCount-died));
      if(owe.length){
        if(canPay(p,0,owe)){ payCost(p,0,owe); UI.log(`${pname(p)} 처치되지 않은 유닛 ${owe.length}기만큼 힘 ${owe.length} 추가 지불 (할인 취소)`, 'p'+p); }
        else UI.log(`⚠ 처치되지 않은 유닛 ${owe.length}기만큼의 힘을 낼 수 없어 할인이 유지됨`, 'sys');
      }
    }
    // 추가 비용을 낸 직후의 클린업(319.6 — 대기 항목이 체인의 적법 항목이 될 때): 버프를 소모해 치명 피해가 된
    // 유닛은 주문이 해결되기 전에 죽는다 (「영광의 부름」 207 — RiftJudge #10458 · #4473). 결전 중 적재 경로는 아래 cleanup(p)이 맡는다.
    if(c.type==='Spell' && !(G.state==='showdown' && G.showdown)) await cleanupDeaths();
  }

  // 비격발 '플레이했는가' 판정([군단] 812.2/813.1 · 군단 할인 · 'played a card this turn')은 파이널라이즈 기준이다
  // (420.3.b "Non-triggered abilities that check cards being played do so by means of referencing whether said cards have been
  // Finalized" — 예시: 「저항」에 카운터당한 주문 뒤에도 군단 활성). 비용을 다 냈고 손패를 떠난 지금이 파이널라이즈 —
  // 주문도 체인 적재·카운터 여부와 무관하게 여기서 센다. 격발형 "When you play"(playedSeq·onYouPlayCard)는 해결 시점(420.3.a)에
  // 그대로 두어 카운터당한 주문은 격발하지 않는다(fireSpellPlayEvents). (구판 RiftJudge #5061 판정은 신판에서 분리됨)
  P.playedCards++;
  // 「꿈꾸는 나무」(292) '주문으로 이곳의 아군 유닛을 고를 때'는 대상 지정 격발(383.4.c) — 주문이 파이널라이즈된 뒤 격발한다.
  // 굴절 거부·대상 없음으로 플레이가 취소되면 격발하지 않는다(예전엔 클릭 직후 드로우해 취소돼도 드로우·턴 플래그가 소모됐다).
  if(pre && pre._units) pre._units.forEach(u=>noteSpellPick(p, u, 'spell'));

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
    placedU=u; u.playedTurn=G.turnCount;
    placeUnit(u, loc);
    UI.render();
    // 위력적 유닛 훅 (볼리베어) — '플레이할 때' 판정은 유닛이 확정·등장한 직후, 등장 격발이 해결되기 전이다
    // (룰 375 Play Effects: 등장 격발은 유닛이 보드에 들어온 '뒤' 체인에 오른다 · 376.2.a 격발 조건은 사건 처리 직후 평가).
    // 자기 버프 등장 효과로 5⚔가 되는 유닛(위험한 2인조·세트)은 격발하지 않고, 상시 +1(전쟁 야영지)은 이미 반영돼 있다
    // — RiftJudge #1160 · #5990.
    if(isMighty(u)) await legendHook(p,'hookMightyPlay',{p, unit:u});
    // 통찰 — 인쇄 [통찰]과 오라 [통찰]은 인스턴스마다 따로 격발한다 (817.2 · 817.2.a: 각각 재활용 여부를 고른다)
    for(let vi=visionCount(u); vi>0; vi--){ if(G.manual) await visionCheck(p); else queueTrigger({ops:[{op:'visionCheck'}]}, {p, unit:u, n, kind:'effect'}); }   // [통찰]은 격발 능력(817.1) — 체인/응수 창
    // 플레이 트리거
    await runTriggerList(fx.triggers.onPlay, {p, unit:u, bfIdx: (loc!=='base'?loc:null), legionOK, paidAdd:addPaid, addCount, viaChain:!byEffect, deferChain:byEffect,
      hiddenBf: (opts.fromHidden && !fx.hiddenFreeTarget) ? opts.bfIdx : null});
    // 적 전장에 '플레이해서' 들어가는 것도 공격이다 (룰 184.3.b — 이동하거나 플레이되면 경합).
    // 「죽음꽃 포식자」를 유지된 적 전장에 내면 상대의 「아리 - 구미호」가 반응해야 한다.
    await fireAttackTriggers(u, loc);
    if(fx.manual.length) UI.manualNotice(c);
  }
  else if(c.type==='Spell'){
    UI.render();
    // ── 결전 중(자동 모드): 즉시 해결하지 않고 체인에 적재 — 공식 규칙 337~340 (결전 종료 처리 중 sd.ending이면 체인은 끝났으므로 즉시 해결) ──
    if(G.state==='showdown' && G.showdown && !G.showdown.ending){
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
      item.displayTargets=item.kind==='counter' ? [snapshotChainTarget(item.target, sd.chain)] : displayTargets;
      item.displayAffected=item.kind==='spell' ? displayAffected : [];
      sd.chain.push(stampChainItem(item));
      if(sd.chain.length===1) sd.chainStarter=p;
      UI.fx.chainAdd(c, p, sd.chain.length);
      UI.log(`🔗 ${pname(p)} 「${c.ko}」 체인에 적재 (#${sd.chain.length}) — 양측 패스 시 마지막 것부터 해결`, 'p'+p);
      logCastTargets(p, c.ko, item.kind==='counter'
        ? `${pname(item.target.execAs??item.target.p)}의 「${card(item.target.n).ko}」 (체인 #${sd.chain.indexOf(item.target)+1})`
        : chosenTargets);
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
    logCastTargets(p, c.ko, chosenTargets);
    // 숨김에서 플레이하는 것도 체인을 연다 (룰 737) — 예전에는 중립 상태에서 응수 창을 건너뛰어
    // 숨겨 둔 주문만 카운터가 통하지 않았다. 결전 중에는 원래대로 체인에 적재된다.
    // 효과가 해결 중에 플레이하는 주문(유망한 미래)은 그 해결의 일부라 응수 창이 열리지 않는다
    // (룰 351 1단계 "다른 효과가 해결 중이면 그것을 마저 해결" · RiftJudge #3955).
    if(!fx.counter && !fx.steal && !byEffect){
      const cw=await counterWindow(p, c, {legionOK, addPaid, addCount, bfIdx:opts.bfIdx, displayTargets,displayAffected});
      if(cw && cw.countered) countered=true;
      else if(cw && cw.steal!==undefined) execAs=cw.steal;
    }
    // (카운터/탈취 주문은 중립 상태에선 대상이 될 주문이 없으므로 playRestriction이 거부한다 — 여기 오지 않는다)
    if(!countered){
      const ro={legionOK, addPaid, addCount, bfIdx:opts.bfIdx, execAs, hiddenBf, pre, fromHidden:!!opts.fromHidden};
      // 유망한 미래(115): 효과로 플레이된 주문은 대기 항목으로 남았다가 양측 플레이가 끝난 뒤 역순(LIFO)으로 해결 — 유닛·도구는 즉시 등장
      // (RiftJudge #11941 · #12068 · #11793). 호출부(promisingFuture)가 G._deferredSpells를 비운다.
      if(opts.deferResolve){ (G._deferredSpells||(G._deferredSpells=[])).push({p, n, fx, o:ro}); UI.log(`「${c.ko}」 — 체인 대기 (효과가 끝난 뒤 역순 해결)`, 'sys'); }
      else await resolveSpellEffects(p, n, fx, ro);
    }
    else { trashCard(p, n); TF().nextSpellBonus[p]=0; }   // 카운터당해도 파이널라이즈된 '다음 주문'이라 마도서(32) 보너스는 소모(420.3.b)
  }
  else if(c.type==='Gear'){
    P.gear.push({n, ex:!!fx.entersExhausted, attachedTo:null, playedTurn:G.turnCount});
    UI.render();
    if(fx.kw.vision){ if(G.manual) await visionCheck(p); else queueTrigger({ops:[{op:'visionCheck'}]}, {p, n, kind:'effect'}); }
    await runTriggerList(fx.triggers.onPlay, {p, n, gear:P.gear[P.gear.length-1], legionOK, paidAdd:addPaid, viaChain:!byEffect, deferChain:byEffect});   // 도구 등장 격발도 유닛처럼 체인/응수 창(정령의 안식처 63)
    if(fx.manual.length) UI.manualNotice(c);
    await fireEvent('onYouPlayGear', {p, n});
  }

  // 공통 플레이 이벤트 — seq는 격발용(해결된 카드 수, 420.3.a): 다리우스 '두 번째 카드'는 카운터당한 주문을 세지 않는다
  if(c.type!=='Spell') P.playedSeq++;
  const evctx={p, n, type:c.type, seq:P.playedSeq, unit:placedU, paidAdd:addPaid};
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
  if(sdAtStart && G.showdown===sdAtStart)
    showdownActed(G.showdown.chain.at(-1)?.triggered ? G.showdown.chain.at(-1).p : p);
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
    if(sc.highestMight){ const ms=allUnits(p).map(u=>targetMight(u)); if(ms.length) e-=Math.max(...ms); }   // [맹공]·[보호막] 등 전투 지정 반영(477)
    if(sc.nearWin && G.players[opp(p)].points>=G.victory-sc.nearWin[0]) e-=sc.nearWin[1];
    if(sc.enemyDied && TF().enemyDied[p]) e-=sc.enemyDied;
  }
  // 356.4.c.1 / 356.4.d "If a discount applies a minimum cost, that minimum applies only to that discount" — 순서는 플레이어가 고르므로
  // 최소값 있는 할인(견습생 84 '최소 1'·비늘의 전령 140)을 먼저 그 최소값까지만 깎고, 최소값 없는 할인(자기 할인·'다음 주문 -5')은
  // 그 뒤 0까지 이어 깎는다 — 룰북 예시: 견습생 + 「하늘 가르기」(8, 최고 위력 7) → 7 → 0. (예전엔 합산 뒤 최종값에 최소 1을 걸었다)
  const minDisc=(d, min)=>{ e=Math.max(e-d, Math.min(e, min)); };
  if(c.type==='Spell'){
    for(const u of allUnits(p)){ const f=unitFx(u); if(f.spellDiscount && u.loc!=='base') minDisc(f.spellDiscount, 1); }
    e-=TF().nextSpellDisc[p]||0;
  }
  if(c.type==='Unit'){
    for(const u of allUnits(p)){ const f=unitFx(u);
      if(f.tagDiscount && (c.tags||[]).includes(f.tagDiscount.tag)) minDisc(f.tagDiscount.n, f.tagDiscount.min||0); }
  }
  return Math.max(e, 0);
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

// "카드/주문을 플레이할 때" 트리거는 그 주문이 '완전히 해결된 뒤'에 난다 (룰 420.3.a "the act of playing
// the card has been completed by the resolution of the card"). 격발용 순번(playedSeq)도 여기서 센다 — 카운터당한 주문은
// 여기까지 오지 않아 격발하지 않는다 (420.3.b). 비격발 판정용 플레이 수(playedCards)는 파이널라이즈 시점(playCardFromHand)에 센다.
// p는 해결 시점의 통제자(탈취됐으면 탈취자 — 룰 155.2 "A spell is controlled by the player who played it", RiftJudge #6678).
// fromHidden: 숨김에서 낸 주문의 onPlayFromHidden도 같은 시점에 (RiftJudge #724 · #10883).
async function fireSpellPlayEvents(p, n, fromHidden, seq){
  const P=G.players[p];
  if(seq===undefined){ P.playedSeq++; seq=P.playedSeq; }   // resolveSpellEffects는 해결 시작 시 순번을 예약해 넘긴다
  const evctx={p, n, type:'Spell', seq, unit:null, paidAdd:false};
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
  G._lastDiscard=null;   // 신난다!(8) '그 카드'는 이 해결에서 버린 카드뿐 — 손패 0장이면 피해 없음
  const mySeq=++G.players[execAs].playedSeq;   // 해결 중 효과로 플레이되는 카드(괴롭히는 밤 198·미끼 바늘)는 이 주문 다음 순번(419.4.a · RiftJudge #12518)
  let pre=o.pre||null;
  // 탈취자는 "새 선택을 할 수 있다"(카드 원문) — 대상 지시를 탈취자 기준(적/아군이 뒤집힘)으로 다시 고른다. 적법 대상이 있으면
  // 골라야 하고(#4630 "cannot choose no target"), 없으면 그 지시만 불발(byEffect). 굴절은 재지불 없음(#3088). 숨김 제한(hiddenBf)은 유지.
  if(execAs!==p && !fx.reflexive && fx.playOps.some(po=>po.ops.some(op=>preTargetSpecs(op).length))){
    const np=await preTargetSpell(execAs, c, fx, {legionOK:o.legionOK, bfIdx:o.bfIdx, hiddenBf:o.hiddenBf??null,
      cost:{energy:0,pips:[],spellOK:true,noDeflect:true}, byEffect:true});
    if(np!==PRE_CANCEL){
      pre=np;
      logCastTargets(execAs, c.ko, describeCastTargets(pre), '대상 다시 선택');
    }
  }
  // 반사 격발 주문(떨어지는 별 29·이케시아 소나기 248): 'Deal 2' 하나하나가 별개의 체인 항목이라(383) 항목이 체인을
  // 떠날 때마다 클린업이 돈다(319.7) — 4위력 유닛에 2개를 몰면 그 자리에서 죽고, 존야가 살려도 남은 격발로 다시
  // 죽일 수 있다(RiftJudge #6282). 격발이 고르는 대상은 '주문이 고른' 것이 아니라 「꿈꾸는 나무」를 격발하지 않는다(#386).
  G._reflexiveCast = !!fx.reflexive;
  // 반사 격발(383): 주문이 해결되면 격발 N개가 한꺼번에 체인에 오르고, 대상은 그때 격발마다 하나씩 '전부 먼저' 고른다
  // (같은 유닛을 여러 번 골라도 되고, 굴절은 고를 때 낸다 — RiftJudge #1159 · #3359). 그 다음 하나씩 해결되며 사이마다
  // 클린업(319.7)이 돌아, 앞선 격발로 이미 죽은 유닛을 고른 남은 격발은 불발된다(356.3.e — 존야로 살아나면 다시 맞는다 #6282).
  // 예전엔 격발마다 그때그때 골라, 한 유닛에 몰아 주는 선택 자체가 막혀 있었다.
  let reflexPicks=null;
  if(fx.reflexive && !G.manual){
    reflexPicks=[]; const N=fx.playOps.length;
    const saved=[_ctxBf,_hiddenBf,_ctxUnit,_curKind];
    _ctxBf=o.bfIdx??null; _hiddenBf=o.hiddenBf??null; _ctxUnit=null; _curKind='spell';
    try{
      for(let i=0;i<N;i++){
        const op=fx.playOps[i].ops.find(x=>preTargetable(x));
        if(!op){ reflexPicks.push(null); continue; }
        const u = unitsBySpec(op.spec, execAs).length
          ? (op.op==='buff'
            ? await pickBuffTarget(execAs, op.spec, `「${c.ko}」 격발 ${i+1}/${N} 대상 (같은 유닛 반복 가능)`)
            : await pickBySpec(execAs, op.spec, `「${c.ko}」 격발 ${i+1}/${N} 대상 (같은 유닛 반복 가능)`)) : null;
        reflexPicks.push({op, uid:u?u.uid:null});
      }
    } finally { [_ctxBf,_hiddenBf,_ctxUnit,_curKind]=saved; }
  }
  if(fx.playOps.length){
    for(let i=0;i<fx.playOps.length;i++){
      const po=fx.playOps[i];
      if(po.legion && !o.legionOK){ UI.log(`[군단] 조건 미충족 — 효과 생략`, 'sys'); continue; }
      const preMap = reflexPicks ? (reflexPicks[i] ? new Map([[reflexPicks[i].op, reflexPicks[i].uid]]) : null) : pre;
      await execOps(po.ops, {p:execAs, legionOK:o.legionOK, bfIdx:o.bfIdx, kind:'spell', paidAdd:o.addPaid, addCount:o.addCount,
        resolvingSpell:{n,owner:p},
        hiddenBf:o.hiddenBf??null, pre:preMap});
      // 반사 격발 주문("Do this N번" — 이케시아 소나기·떨어지는 별)은 격발 하나가 해결될 때마다 클린업이 끼어들어
      // 그때 죽은 유닛의 [죽음의 종소리]가 남은 격발보다 먼저 해결된다 (룰 322·383 · RiftJudge #272 · #6282)
      if(fx.reflexive) await cleanupDeaths();
    }
  }
  G._reflexiveCast=false;
  // 소모형 플래그 해제 (다음 주문 할인/보너스) — 탈취됐으면 탈취자의 보너스가 쓰였다
  TF().nextSpellDisc[p]=0; TF().nextSpellBonus[p]=0; TF().nextSpellBonus[execAs]=0;
  G._casting=null;
  if(fx.manual.length) UI.manualNotice(c);
  if(G._banishSpell){ P.banish.push(n); G._banishSpell=false; UI.log(`「${c.ko}」 추방됨`, 'sys'); }
  else if(G._spellPreTrashed===n){ G._spellPreTrashed=null; }   // 효과 중에 미리 폐기장에 둔 주문(「괴롭히는 밤」 198 — #6899)
  else trashCard(p, n);
  // 주문이 체인을 떠나면 먼저 클린업(치명 피해 사망 — 룰 319.7 · 322 2a)이 일어나고, 그 다음에야
  // '주문을 플레이할 때' 격발이 난다. 예전엔 격발이 효과보다 먼저 나서 「레이븐블룸 학생」이 자기 피해 주문에서
  // +1로 살아남고, 「돌풍」의 위력 3 이하 필터에서 빠졌다 (RiftJudge #4359 · #8306). 「빙의」로 뺏어온 다리우스도
  // 이제 '두 번째 카드'를 본다 (#245). 사망 처리만 하고 결전 개시 등은 호출자의 cleanup에 맡긴다.
  // 「불멸의 불사조」의 '주문으로 처치' 반응(처치 지시·피해 사망 모두)은 cleanupDeaths 끝의 spellKillReactions가 연다.
  await cleanupDeaths();
  await fireSpellPlayEvents(execAs, n, !!o.fromHidden, mySeq);
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
  // 중립 상태의 재귀 응수도 보기 창에 적재 순서대로 노출한다. 해결 절차에는 사용하지 않는 표시용 목록이다.
  const chain=G.pendingChain||(G.pendingChain=[]);
  const pending={kind:context.ability?'ability':(FX[c.n]?.counter||FX[c.n]?.steal)?'counter':'spell',
    p:caster, n:c.n, srcName:c.ko, displayTargets:context.displayTargets||[],
    displayAffected:context.displayAffected||[]};
  chain.push(stampChainItem(pending));
  UI.render();
  try { return await reactionWindowChoices(caster, c, context, pending); }
  finally {
    chain.splice(chain.indexOf(pending),1);
    UI.render();
  }
}
async function reactionWindowChoices(caster, c, context, pending){
  const o=opp(caster);
  let result=null;
  for(let guard=0; guard<20; guard++){
    const O=G.players[o];
    const opts=[];
    // '카드를 플레이할 수 없다'(브린히르 26 noPlay)는 응수 창에도 걸린다 — 손패 [반응]·카운터 모두 카드 플레이다.
    // 예전엔 손패 목록을 playRestriction 없이 만들어 카운터/탈취가 그대로 통했다(제보 2026-09-14). 숨김 카드는 아래에서
    // playRestriction이 따로 본다. [반응] 활성화 능력은 카드 플레이가 아니라 허용.
    const noPlay=!!TF().noPlay[o];
    O.hand.forEach((hn,i)=>{
      if(noPlay) return;
      const fx=FX[hn]; if(!fx||!fx.kw||!fx.kw.reaction) return;
      // [반응] 유닛도 닫힌 상태에서 낼 수 있다 (룰 739.3). 유닛은 카운터가 아니므로
      // 아래 카운터 분기는 그대로 지나가고 정식 플레이 경로(배치 위치 선택 포함)를 탄다.
      const cc=card(hn); if(cc.type!=='Spell' && cc.type!=='Unit') return;
      const cost=applyCostMods(o, cc, cc.e||0), pips=powerPips(cc);   // 견습생(84) 등 할인 반영 — 실제 지불 비용으로 응수 가능 여부를 본다
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
        pendingSpell: (result || context.ability) ? null : {...context, p:caster, n:c.n}});   // 능력 응수 창엔 대기 주문이 없다
    });
    // [반응] 활성화 능력도 닫힌 상태 응수로 발동할 수 있다 (규칙 309.2)
    if(typeof polAbList==='function' && typeof polAbLegal==='function'){
      try{
        for(const cand of polAbList(o)){
          if(!cand.ab || !cand.ab.reaction) continue;
          if(!polAbLegal(o, cand)) continue;
          opts.push({v:{ab:cand}, label:`⚡ [능력] ${cand.name} — ${cand.ab.label}`, isCounter:false,
            card:cand.src.kind==='legend' ? card(O.legendN)
              : cand.src.kind==='unit' ? unitCard(cand.src.u) : card(cand.src.g.n)});
        }
      }catch(e){}
    }
    // 숨김(뒷면) 카드는 뒷면인 동안 [반응]이다(739.1) — 중립 응수 창에서도 숨겨 둔 전장에서 공개해 응수할 수 있다
    // (「물결을 바꾸는 자」로 매혹에 응수 — RiftJudge #10372 · #7111). 숨긴 턴·파괴공작원·타이밍/대상(737)·배치 불가는 제외.
    G.bfs.forEach((bf,bi)=>{
      if(bf.units.some(u=>u.ctrl!==o && unitFx(u).blockReveal)) return;
      bf.hiddenCards.forEach((hc,hiddenIndex)=>{
        if(hc.by!==o || (hc.turn===G.turnCount && G.turn===o)) return;
        const hcard=card(hc.n); if(!hcard) return;
        const prevRw=G._rwFor; G._rwFor=o;
        let bad=null; try{ bad=playRestriction(hcard, o, true, bi); } finally{ G._rwFor=prevRw; }
        if(bad) return;
        if(hcard.type==='Unit' && !unitPlayLocationOptions(o, hc.n).some(x=>x.v===bi)) return;
        opts.push({v:{hidden:{bf:bi,index:hiddenIndex}}, label:`🂠 숨김 카드 공개: ${hcard.ko} (${card(bf.n).ko})`,
          isCounter:false, card:hcard});
      });
    });
    if(!opts.length && context.ability) return result;   // 격발·능력 창에 낼 것이 없으면 자동 패스(유지·통찰 등 프롬프트 폭주 방지) — 주문 창은 정보 노출용으로 유지
    const sel=await UI.pickReaction(o, `${pname(caster)}이(가) 「${c.ko}」 ${context.ability?'발동':'플레이'} — [반응]으로 응수할까요?`, opts);
    if(sel===null||sel===undefined) return result;
    // [반응] 능력 발동 (즉시 해결)
    if(typeof sel==='object' && sel.ab){
      // 원 주문이 아직 체인에 있는 닫힌 상태 — 능력 해결 뒤의 클린업이 통제를 풀거나 결전을 열지 않도록 표시 (190.6 · 341)
      const prevRw=G._rwFor; G._rwFor=o;
      try{ await activateAbility(o, sel.ab.src, sel.ab.ab); }
      finally{ G._rwFor=prevRw; }
      if(G.winner!==null) return result;
      continue;
    }
    // 숨김 카드 공개 — 정식 숨김 플레이 경로(playHidden → playCardFromHand fromHidden), 먼저 해결되고 재응수 창은 그 안에서 열린다
    if(typeof sel==='object' && sel.hidden){
      const prevRw=G._rwFor, prevPending=G._returnPending;
      G._rwFor=o;
      G._returnPending = (result || context.ability) ? null : {...context, p:caster, n:c.n};   // 능력·격발 창엔 대기 주문이 없다
      const hidden=G.bfs[sel.hidden.bf]?.hiddenCards[sel.hidden.index];
      try{ await playHidden(o, sel.hidden.bf, hidden); }
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
      O.playedCards++;                            // 파이널라이즈 — 비격발 '플레이' 판정용 플레이 수 (420.3.b · 813.1)
      logCastTargets(o, cc.ko, `${pname(caster)}의 「${c.ko}」 (대기 중인 주문)`);
      // 카운터도 '플레이한 주문'이다. 이 경로는 playCardFromHand를 거치지 않으므로
      // 플레이 이벤트(+플레이 수)도 아래 fireSpellPlayEvents에서 직접 낸다 (「레이븐블룸 학생」 등이 이걸 본다).
      // 카운터도 주문 — 원 시전자가 '카운터의 카운터'로 재응수할 수 있다 (재귀 창)
      const sub=await reactionWindow(o, cc, {displayTargets:[snapshotChainTarget(pending, G.pendingChain)]});
      trashCard(o, hn);
      if(sub && (sub.countered || sub.steal!==undefined)){
        UI.log(`⚡「${cc.ko}」 — 무효화되어 효과 없음`, 'sys');
        UI.render();
        continue;                                // 카운터당했으니 플레이 이벤트도 나지 않는다 (룰 2848)
      }
      await fireSpellPlayEvents(o, hn);           // 여기서 실제로 해결된다
      if(rfx.steal){ UI.log(`⚡「${cc.ko}」: 「${c.ko}」의 통제권 탈취!`, 'p'+o); result={steal:o}; }
      else { UI.log(`⚡「${cc.ko}」: 「${c.ko}」 무효화!`, 'p'+o); result={countered:true}; }
      pending.countered=!!result.countered;
      if(result.steal!==undefined) pending.execAs=result.steal;
      UI.render();
      continue;                                  // 상대는 이어서 다른 반응도 낼 수 있다
    }
    // 일반 반응: 정식 플레이 경로로 — 먼저 해결되고(LIFO), 그 안에서 caster의 재응수 창이 열린다
    const prevRw=G._rwFor, prevPending=G._returnPending;
    G._rwFor=o;
    G._returnPending = (result || context.ability) ? null : {...context, p:caster, n:c.n};
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
  for(let vi=visionCount(u); vi>0; vi--) await visionCheck(p);   // 817.2 인스턴스마다 격발 (예언자 2기면 2회)
  await fireEvent('onYouPlayUnit', {p, n:0, type:'Unit', seq:G.players[p].playedSeq, unit:u, paidAdd:false});
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
  const yes = await UI.confirmP(p, `[통찰] 덱 맨 위: 「${card(top).ko}」 — 덱 맨 아래로 되돌릴까요?`, card(top),{decision:{title:'통찰',result:'확인한 카드를 덱 위에 유지하거나 맨 아래로 보냅니다.',accept:'덱 아래로 보내기',decline:'덱 위에 유지'}});
  if(yes){ P.deck.shift(); P.deck.push(top); UI.log(`${pname(p)} [통찰]로 덱 맨 위 카드를 재활용`, 'p'+p); await fireEvent('onYouRecycle',{p}); }
}

// ---------- 숨기기 (숨겨짐) ----------
function hideCosts(p){
  if(TF().freeHide[p]) return [{v:'free',label:'무료',energy:0,pips:[]}];
  const costs=[];
  if(FX[G.players[p].legendN]?.altHideCost) costs.push({v:'energy',label:'에너지 1 (룬 유지)',energy:1,pips:[]});
  costs.push({v:'power',label:'힘 1',energy:0,pips:['Any']});
  return costs.filter(c=>canPay(p,c.energy,c.pips));
}
function hideCostLabel(p){
  return TF().freeHide[p]?'무료':FX[G.players[p].legendN]?.altHideCost?'에너지 1 또는 힘 1':'힘 1';
}
async function hideCard(p, handIdx){
  const P=G.players[p];
  // 룰 737: 손패 '또는 챔피언 구역'에서 숨길 수 있다 (handIdx==='champ')
  const fromChamp = handIdx==='champ';
  if(fromChamp && !P.champInZone){ UI.toast('챔피언이 챔피언 존에 없습니다','warn'); return; }
  const n=fromChamp ? P.champN : P.hand[handIdx]; const c=card(n);
  if(!c) return false;
  const fx=FX[n]||{kw:{}};
  if(!fx.kw.hidden){ UI.toast('[숨겨짐] 카드가 아닙니다','warn'); return; }
  if(G.turn!==p || G.state!=='neutral'){ UI.toast('자신의 턴 중립 상태에서만 숨길 수 있습니다','warn'); return; }
  const cap = bf => bf.n===BF_STATIC.DOUBLE_HIDE?2:1;
  const myBfs = G.bfs.map((bf,i)=>({bf,i})).filter(x=>x.bf.controller===p && x.bf.hiddenCards.length<cap(x.bf));
  if(!myBfs.length){ UI.toast('숨길 수 있는 (통제 중 + 빈 슬롯) 전장이 없습니다','warn'); return; }
  const costs=hideCosts(p);
  if(!costs.length){ UI.toast(`자원이 부족합니다 (${hideCostLabel(p)} 필요)`,'warn'); return false; }
  const sel = await UI.pickOption(p,'카드를 숨길 전장', myBfs.map(x=>({v:x.i,label:card(x.bf.n).ko,n:x.bf.n})),'battlefield');
  if(sel===null) return false;
  const choice=costs.length===1?costs[0].v:await UI.pickOption(p,'숨김 비용 선택',costs.map(c=>({...c,hidePayment:true})));
  const payment=costs.find(c=>c.v===choice);
  if(!payment) return false;
  // 목적지와 지불 방식을 모두 고른 뒤 한 번만 소비한다. 취소는 카드와 자원을 보존한다.
  if(!myBfs.some(x=>x.i===sel) || !canPay(p,payment.energy,payment.pips)) return false;
  // 룬을 건드리는 지불이면 인장 등 [반응] 자원 능력을 먼저 쓸지 묻는다 (357.1.a) — 취소하면 숨기지 않는다
  if(!(await askResourceFunding(p, `${c.ko} 숨김`, payment.energy, payment.pips, false, n, '숨김 취소'))) return false;
  payCost(p,payment.energy,payment.pips);
  if(fromChamp) P.champInZone=false; else P.hand.splice(handIdx,1);
  G.bfs[sel].hiddenCards.push({n, by:p, turn:G.turnCount});
  UI.log(`${pname(p)} ${fromChamp?'챔피언 존의 카드':'카드'}를 전장에 뒷면으로 숨김`, 'p'+p);
  UI.render();
  return true;
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
        if(spec.custom){ if(typeof preTargetCustomOptions==='function' && !preTargetCustomOptions(p, spec).length && !spec.optional) return false; continue; }
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

// 「은밀한 추적자」(177) "When a friendly unit moves from my location, I may be moved with it" — 표준 이동·효과 이동(바람 타기·
// 매혹·아지르) 모두, 출발지가 기지여도, 추적자가 탈진 상태여도(비용 없는 능력 이동) 동행할 수 있다 (RiftJudge #6119 · #2230 · #1531).
// 예전엔 표준 이동에서만, 전장 출발일 때만 물었다. 동행 여부는 추적자의 통제자가 정한다.
async function tagAlongFollow(units, origins, dest){
  if(G.manual) return;
  for(let i=0;i<units.length;i++){
    const mover=units[i], o=origins[i];
    if(o===dest) continue;
    const here = o==='base' ? G.players[mover.ctrl].base : G.bfs[o].units;
    for(const t of [...here].filter(x=>x.ctrl===mover.ctrl && unitFx(x).tagAlong && !units.includes(x) && x.loc===o)){
      const yes=await UI.confirmP(t.ctrl, `「${unitName(t)}」도 함께 이동할까요?`, unitCard(t));
      if(yes){ removeUnit(t); placeUnit(t,dest); t.turnMoves=(t.turnMoves||0)+1; UI.log(`${unitName(t)} 동행 이동`, 'p'+t.ctrl);
        if(o!=='base') await fireBfTrigger(o,'onMoveFromHere',{p:t.ctrl, it:t, bfIdx:o});   // 동행도 이동(427) — 출발지·도착지 이벤트
        if(dest!=='base') await fireEvent('onMoveToBf',{p:t.ctrl, bfIdx:dest});
        await fireAttackTriggers(t, dest); }
    }
  }
}

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
      UI.toast(`「${card(G.bfs[u.loc].n).ko}」: 이곳에서 기지로 이동할 수 없습니다`,'warn'); return false;
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
    await runTriggerList(unitFx(u).triggers?.onMoveSelf, {p, unit:u, it:u, bfIdx:(dest!=='base'?dest:null), dest, viaChain:true});   // 이동 격발도 체인에 — 상대가 응수 가능(녹서스 군악병 222 · RiftJudge #4820 · #1685)
  }
  if(dest!=='base') await fireEvent('onMoveToBf', {p, bfIdx:dest});
  // 은밀한 추적자: 같은 위치에서 아군이 이동하면 동행 가능
  await tagAlongFollow(units, origins, dest);
  // 공격 트리거 — 이동·플레이가 같은 판정을 쓴다
  for(const u of units) await fireAttackTriggers(u, dest);
  await cleanup(p, units[0]?.loc);
  UI.render();
  return true;
}

// 공식 룰: 전장 통제는 유닛 주둔으로 유지된다 — 유닛이 하나도 없으면 무주공산(open)으로 돌아간다.
// (유지 득점은 "유닛이 주둔한" 통제 전장만 해당 — 상호 전멸 시에도 아무도 통제하지 않음)
// 체인에 항목이 남아 있는 '닫힌 상태'의 클린업은 통제를 풀지 않는다 — 열린 상태의 클린업에서만 잃는다
// (2026-07-16판 190.6 · 318 4단계 "if the turn is in an Open State"). 결전 체인이 비었을 때(resolveChainItem의 마지막 항목 뒤)와
// 중립 응수 창 밖(playCardFromHand의 마지막 cleanup)에서 같은 함수가 다시 돌아 그때 해제한다.
function chainClosed(){
  return !!((G.showdown && G.showdown.chain.length) || G._rwFor!=null);
}
function releaseEmptyBattlefields(){
  if(G.manual) return;
  if(chainClosed()) return;
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
  if(_execDepth===0 && G._pendingTriggers && G._pendingTriggers.length) await flushPendingTriggers();   // 행동이 끝난 시점의 대기 격발(등장·이동·이벤트 리스너 등) → 체인/응수 창
  await cleanupDeaths();
  if(G.winner!==null) return;
  // 사망 격발(종소리·사망 이벤트)이 대기열에 올랐으면 통제 해제 전에 체인에(190.6 닫힌 상태에선 통제 유지) — 그 해결로 또 죽으면 반복(320.1)
  for(let i=0;i<8 && _execDepth===0 && G._pendingTriggers && G._pendingTriggers.length;i++){ await flushPendingTriggers(); if(G.winner!==null) return; await cleanupDeaths(); if(G.winner!==null) return; }
  // 빈 전장 통제 해제 (결전 중 상호 전멸 등도 이후 클린업에서 처리됨)
  releaseEmptyBattlefields();
  // 무혈 결전 중 상대 유닛이 들어와 전투가 준비되면(양측 유닛 존재) 열린 상태의 이 클린업에서 진행 중인 결전이 그대로
  // 전투 결전이 된다 — 새 결전을 열지 않고 지정·전장 [방어 시]·지정 격발만 지금 일어나며 포커스·체인은 이어진다
  // (2026-07-16판 316.9.b.1 · 318 10a단계 · 460.1 · 464 1단계 "the player who has Focus maintains their Focus").
  // 구판 349.1(결전이 끝난 뒤 새 전투)을 따르던 resolveShowdown의 재개 경로는 폴백으로만 남는다.
  if(G.showdown && !G.showdown.hasCombat && !G.showdown.chain.length && G.state==='showdown'){
    const sd=G.showdown, bf=G.bfs[sd.bfIdx];
    if(bf.units.some(u=>u.ctrl===0) && bf.units.some(u=>u.ctrl===1)){
      await openCombat(sd, bf.contestedBy ?? sd.attacker);
      if(G.winner!==null) return;
      await cleanupDeaths();   // 지정 격발의 피해는 곧바로 다음 클린업이 치명 판정한다 (320.1 "repeating until no new change")
      if(G.winner!==null) return;
    }
  }
  await flushCombatTriggers(G.showdown);
  // 경합 확인 (중립 '열린' 상태에서만 새 결전 개시 — 341. 종료 격발 처리 중(_holdShowdown)에는 endTurn이 끝나고 열고,
  // 중립 응수 창 안(체인에 원 주문이 남은 닫힌 상태 — G._rwFor)에서는 그 주문이 해결된 뒤의 클린업이 연다)
  if(G.state!=='neutral' || G._holdShowdown || G._rwFor!=null) return;
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
  if(hasCombat) await openCombat(G.showdown, attacker);
  await cleanupDeaths();
  await flushCombatTriggers(G.showdown);
  UI.render();
  UI.promptShowdown();
}
// 전투 개시(전투 1단계): 결전 sd가 전투 결전이 된다 — 새로 열리는 결전과, 진행 중인 무혈 결전이 클린업에서 승격되는 경우
// (318 10a · 460.1) 둘 다 여기로. 공격자는 경합 적용자(464 2단계), 포커스·체인·패스 카운터는 건드리지 않는다.
// 지정 시 격발을 예약한 뒤, 정리가 끝나면 초기 체인에 적재한다.
async function openCombat(sd, attacker){
  const bf=G.bfs[sd.bfIdx];
  if(!sd.hasCombat) UI.log(`⚔️ 전투 개시 — 진행 중인 결전이 전투 결전이 됩니다 (공격: ${pname(attacker)})`, 'combat');
  sd.attacker=attacker; sd.defender=opp(attacker); sd.hasCombat=true; sd.initialTriggers=true;
  const fresh = designateUnits(sd, [...bf.units]);
  // 전장 트리거: 방어 시 — 방어자는 '경합을 먼저 걸지 않은 쪽'이지 통제자가 아니다(전투 1단계 "The Defender is the player
  // who did not apply the Contested status"). 무주공산 전장에 먼저 들어간 쪽이 공격자, 뒤에 합류한 쪽이 방어자로
  // 「약탈자의 거리」를 쓴다 (RiftJudge #4985). 예전엔 통제자일 때만 격발했다.
  for(const ab of FX[bf.n]?.triggers?.onDefendHere||[])
    queueCombatTrigger(sd,{p:sd.defender,n:bf.n,bfIdx:sd.bfIdx,ab});
  await fireDesignationTriggers(sd, fresh);
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
    sd.resolvingItem=true;
    try{ await resolveChainItem(item); }
    finally{ sd.resolvingItem=false; }
    if(G.winner!==null || G.showdown!==sd) return;
    await flushCombatTriggers(sd);
    sd.passes=0;
    if(sd.chain.length){
      G.actingPlayer=sd.chain[sd.chain.length-1].p;   // 340.4: 남은 최상단 항목의 컨트롤러가 우선권
    } else {
      G.actingPlayer=sd.triggerFocus??opp(sd.chainStarter??G.actingPlayer);
      sd.triggerFocus=null; // 초기/자동 격발 체인은 그전 포커스를 유지한다.
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
    // 격발원 유닛이 응수로 보드를 떠났거나 다른 위치로 옮겨졌으면 '이곳(here)'·'내 위력' 같은 참조는 해결 시점에 사라진다
    // (신판 359.3.f.2 야스오+투쟁 혹은 도피 예시 · RiftJudge #7155 · #2989 · #4164 · #6014) — 그 지시만 불발, 나머지는 실행
    const onBoard = !!(it.unit && everyUnit().includes(it.unit));
    const gone = !!(it.triggered && it.unit && !onBoard && !it.deathTrigger);   // 종소리는 죽은 자리가 '이곳'
    const moved = !!(it.triggered && it.unit && onBoard && !it.deathTrigger && it.bfIdx!=null && it.unit.loc!==it.bfIdx);   // 점멸 등으로 옮겨짐 — '이곳'은 현재 위치(RiftJudge #2410)
    if(gone) UI.log(`「${it.srcName}」 격발원이 자리를 떠나 '이곳'·'내 위력' 참조가 사라짐 — 해당 지시 불발 (359.3.f)`, 'sys');
    else if(moved) UI.log(`「${it.srcName}」 격발원이 ${it.unit.loc==='base'?'기지':'「'+card(G.bfs[it.unit.loc].n).ko+'」'}(으)로 옮겨져 '이곳'은 현재 위치 (#2410)`, 'sys');
    const resolve=()=>execOps(it.ab.ops, {p:it.p, unit:it.unit, gear:it.gear, it:it.it, kind:'ability', preAb:it.preAb,
      triggered:it.triggered,sourceMight:gone?0:it.sourceMight, sourceGone:gone,
      bfIdx:gone?null:moved?(it.unit.loc==='base'?null:it.unit.loc):(it.triggered?it.bfIdx:(it.unit&&it.unit.loc!=='base')?it.unit.loc:null), pre:it.pre||null, hiddenBf:it.hiddenBf??null, ...(it.trigCtx||{})});
    if(it.bfSrc) await withBattlefieldSource(it.bfSrc, resolve);
    else if(it.triggered && card(it.n)?.type==='Battlefield') await withBattlefieldSource({n:it.n,event:'onDefendHere'},resolve);
    else await resolve();
    await cleanup(it.p);
    return;
  }
  const c=card(it.n);
  if(it.countered){
    UI.log(`🔗 「${c.ko}」 — 무효화되어 효과 없이 폐기됩니다`, 'sys');
    trashCard(it.p, it.n); TF().nextSpellBonus[it.p]=0; UI.render();   // 마도서(32) 보너스 소모
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
  // [군단]은 종속 능력 — 조건("같은 턴에 다른 카드가 파이널라이즈됐는가", 813.1)이 참인 동안 활성이므로 해결 시점에 다시 본다:
  // 적재 뒤 그 위에 다른 카드를 올렸으면(자기 자신도 이미 셌으므로 2장 이상) 이제 충족 (812.2 · 420.3.b)
  await resolveSpellEffects(it.p, it.n, it.fx,
    {legionOK: it.legionOK || G.players[it.p].playedCards>=2, addPaid:it.addPaid, addCount:it.addCount, bfIdx:it.bfIdx, execAs:it.execAs??it.p,
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
  await cleanupDeaths();
  await flushCombatTriggers(sd);
  if(G.winner!==null || G.showdown!==sd) return;
  // 정리 중 지정된 유닛의 격발이 체인에 올라갔으면 전투로 가지 않고 응수 창을 다시 연다 (465 4단계 — 체인이 생기면 닫힘)
  if(sd.chain.length){ sd.passes=0; UI.render(); UI.promptShowdown(); return; }
  const atkUnits = ()=>bf.units.filter(u=>u.ctrl===sd.attacker);
  const defUnits = ()=>bf.units.filter(u=>u.ctrl===sd.defender);
  let deferred=[];   // 전투 사망의 보류 격발 (종소리 등) — 전투 정리(치유·귀환) 뒤, 승패 판정 전에 해결

  if(sd.stage!=='scoring'){   // 전투 사망 격발 체인을 해결하고 돌아온 재진입이면 전투 단계는 건너뛴다
  // 폴백: 무혈 결전에 양측 유닛이 남은 채 빈 체인에서 양측이 패스했다면 여기서 전투 결전으로 승격해 결전을 잇는다.
  // 정상 경로는 상대 유닛이 들어온 뒤의 클린업(cleanup → openCombat — 318 10a · 460.1)이라 보통 여기 오지 않는다
  // (클린업 없이 유닛이 들어온 경우만). 구판 349.1처럼 결전을 닫고 새로 열지 않는다.
  if(!sd.hasCombat && atkUnits().length && defUnits().length){
    UI.log(`양측 유닛이 남아 전투가 개시됩니다 (경합 유지)`, 'combat');
    await openCombat(sd, bf.contestedBy ?? sd.attacker);
    if(G.winner!==null || G.showdown!==sd) return;
    await cleanupDeaths();
    await flushCombatTriggers(sd);
    sd.passes=0;
    UI.render(); UI.promptShowdown();
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
    // 방어자 잔존 시 공격자 본진 귀환(2d). 양측 잔존 = 무승부 — 공격측이 「솔라리의 상징」(227)을 가졌으면
    // 카드 원문대로 '모든 유닛'을 귀환시켜 결과 없음(통제 변경·득점 없음, #10142). 예전엔 '전원 사망'을 무승부로 잘못 봤다.
    if(defUnits().length && atkUnits().length){
      if(G.players[sd.attacker].gear.some(g=>g.n===227)){
        UI.log(`「솔라리의 상징」: 무승부 — 모든 유닛이 기지로 귀환합니다`, 'combat');
        [...bf.units].forEach(u=>{ removeUnit(u); placeUnit(u,'base'); });
      } else {
        UI.log(`방어 성공 — 공격 유닛은 기지로 귀환합니다`, 'combat');
        atkUnits().forEach(u=>{ removeUnit(u); placeUnit(u,'base'); });
      }
    }
  }

  // 전투 정리에서 생긴 체인 항목(전투 사망의 [죽음의 종소리]·사망 이벤트)은 승패 판정 '전'에 해결한다 — 466.3 Reminder
  // "Resolve any items on the chain from dealing combat damage and the Combat Cleanup ... before performing this step".
  // 치유 뒤라 종소리 피해는 지워지지 않고, 그 피해의 치명 판정(클린업 3단계)까지 마친 뒤 잔존 유닛을 센다 — 공격자가 전멸한 뒤
  // 종소리가 마지막 방어자를 죽이면 '유닛 없음'이라 통제 확립도 정복도 없다. 예전엔 정복 득점 뒤에 종소리를 해결했다.
  for(const f of deferred) await f();
  deferred=[];
  } else { sd.stage=null; }
  // 전투 사망 격발(종소리·사망 이벤트)이 대기열에 올랐으면 체인에 적재하고 응수 창으로 돌아간다 — 해결 뒤 빈 체인에서 양측이 패스하면
  // 'scoring' 단계로 재진입해 통제 확립·정복으로 이어진다(466.3 Reminder "resolve any items on the chain ... before performing this step")
  await cleanupDeaths();
  if(G.winner!==null || G.showdown!==sd) return;
  if(G._pendingTriggers && G._pendingTriggers.length) await flushPendingTriggers();
  if(G.winner!==null || G.showdown!==sd) return;
  if(sd.chain.length){ sd.stage='scoring'; sd.passes=0; G.actingPlayer=sd.chain[sd.chain.length-1].p; UI.render(); UI.promptShowdown(); return; }

  // 통제 확립 & 정복 (466.3 결과 판정 → 466.7 통제 확립). 지정과 '이번 전투' 효과는 정복 격발이 끝난 뒤 '전투 종료'(467)에
  // 함께 사라지므로 G.showdown은 그때까지 둔다 — 정복 격발 중에도 [맹공]·'전투 중' 조건이 살아 있다.
  const sides = new Set(bf.units.map(u=>u.ctrl));
  const remaining = sides.size===1 ? bf.units[0].ctrl : null;
  const prevController = bf.controller;
  // 양측이 남았으면(종소리 격발이 유닛을 옮겨 온 경우) '결과 없음' — 경합을 유지해 마지막 cleanup이 새 결전·전투를 연다 (466.5.d)
  if(sides.size<2) bf.contestedBy=null;   // 결전 종료 — 경합 해제 (통제 확립/재확립 또는 전장 비움)

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
      // 정복 트리거 — 여러 출처(정복한 유닛·전장·전설/도구/폐기장)가 동시에 격발하면 통제자가 해결 순서를 고른다
      // (376.4.b.2.c · RiftJudge #8242 · #10196: 수도원의 버프 소모를 먼저 해결하고 세트/워모그로 새 버프). 비용이 있는
      // 격발(수도원의 버프 소모)은 체인에 올릴 때 내는 것이라 정복 '시점'에 버프가 있어야 한다(#8738 · '4. Pay Costs') → buffAtTrigger.
      // 결전 종료 처리 중(정복 격발 해결) — 지정·결전은 살아 있지만(467 전투 종료가 마지막) 체인은 더 이상 해결되지 않으므로, 이 사이에
      // 효과가 플레이하는 주문(카이사 112의 폐기장 주문)·격발은 체인에 적재하지 않고 즉시 해결한다. 예전엔 곧 사라질 체인에 올라가
      // 해결되지 못한 채 카드가 증발했다(봇전 로그 2026-09-22: 「유망한 미래」 체인 #1 적재 후 소실).
      sd.ending=true;
      const buffAtTrigger = allUnits(remaining).some(u=>u.buff>0);
      const jobs=[];   // 기본 순서(선택이 없을 때)는 종전대로 유닛 → 전설/도구/폐기장 → 전장 → 전설 훅
      for(const u of bf.units.filter(u=>u.ctrl===remaining)){
        const tl=unitFx(u).triggers?.onConquer; if(!tl || !tl.length) continue;
        jobs.push({label:`유닛 「${unitName(u)}」`, run:()=>runTriggerList(tl, {p:remaining, unit:u, bfIdx:sd.bfIdx, excess:(remaining===sd.attacker?sd.excess:0)})});
      }
      jobs.push({label:'전설·도구·폐기장의 [정복 시]', run:()=>fireTriggers('onConquerYou', {p:remaining, bfIdx:sd.bfIdx}), silent:!hasEventListeners('onConquerYou', remaining)});
      const bfx=FX[bf.n], bfJob = (bfx && ((bfx.triggers && bfx.triggers.onConquerHere) || (bfx.manual && bfx.manual.length)))
        ? {label:`전장 「${card(bf.n).ko}」`, run:()=>fireBfTrigger(sd.bfIdx,'onConquerHere',{p:remaining,bfIdx:sd.bfIdx,buffAtTrigger})} : null;
      if(bfJob) jobs.push(bfJob);
      { const lfx=FX[G.players[remaining].legendN]; if(lfx && lfx.hookConquer) jobs.push({label:`전설 「${card(G.players[remaining].legendN).ko}」`, run:()=>legendHook(remaining,'hookConquer',{p:remaining})}); }
      // 정복 격발은 대기열에 모였다가 flushPendingTriggers에서 통제자가 순서를 고른다(376.4.b.2.c) — 전장 격발을 앞에 두어 봇 기본 선택이
      // 수도원의 버프 소모를 먼저 해결하는 유리한 순서가 된다. 격발은 결전 종료 처리(sd.ending) 중 해결되어 지정이 살아 있다(467).
      for(const j of [...jobs].sort((a,b)=>(a===bfJob?0:1)-(b===bfJob?0:1))){ await j.run(); if(G.winner!==null) break; }
      if(G.winner===null) await flushPendingTriggers();
    } else {
      UI.log(`이번 턴에 이미 득점한 전장 — 추가 득점 없음`, 'sys');
    }
  }
  // 전투 종료(467): 공격/방어 지정을 거두고 "이번 전투" 효과([보호막] 부여 등)가 동시에 만료된다 — 정복 격발 뒤 마지막 단계
  for(const gr of (G._combatGrants||[])){
    if(gr.numeric){
      const left=(typeof gr.u.grants[gr.key]==='number'?gr.u.grants[gr.key]:0)-gr.v;
      if(left>0) gr.u.grants[gr.key]=left; else delete gr.u.grants[gr.key];
    } else delete gr.u.grants[gr.key];
  }
  G._combatGrants=[];
  G.state='neutral'; G.showdown=null; G.actingPlayer=G.turn;
  UI.render();
  UI.prompt(G._endingTurn ? '종료 단계 — 열린 결전 처리 중'
    : (G.turn===G.actingPlayer?`${pname(G.turn)}의 행동 단계`:''));
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
  if(_execDepth===0 && !_deferDeathFx && !_dyingBatch && !G.manual && G._pendingTriggers && G._pendingTriggers.length) await flushPendingTriggers();   // 동시 사망의 격발을 지금 체인에
}

// ---------- 사망 ----------
// 사망 뒤 격발(종소리·사망 이벤트)을 미루는 큐 — 전투 사망은 전투 정리(치유·귀환) 뒤에 해결한다 (resolveShowdown)
let _deferDeathFx = null;
// 반환: 실제로 죽었으면 true, 대체 효과로 살아났거나 이미 죽어 있으면 false — "처치된 유닛"을 참조하는 효과
// (미끼 바늘 242 '처치된 유닛의 위력'·레드로스 231 '이렇게 처치된 만큼')는 실제 사망만 센다 (415.5.c · RiftJudge #8203 · #377).
async function killUnit(u, opts){
  if(u._dead) return false; u._dead=true;
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
        const yes = await UI.confirmP(u.ctrl, `[무허가 무기고] 분노 힘 1을 지불하고 「${unitName(u)}」을(를) 회수할까요?`, unitCard(u),{decision:{title:'무허가 무기고: 사망 시 회수',cost:'분노 힘 1',result:`「${unitName(u)}」을(를) 치유하고 탈진 상태로 기지에 회수`,accept:'지불하고 회수',decline:'회수 안 함'}});
        if(!yes) return false;
        payCost(u.ctrl,0,['Fury']); u._armory=Math.max(0,(u._armory|0)-1); recall('무허가 무기고'); return true;   // 한 장만 소모(#686)
      } });
    // 세트 - 대장 전설(269): "you may pay ✳ and exhaust me" — 선택 (예전엔 라벨이 '미스 포츈'으로 잘못 적혀 있었다)
    {
      const lfx=FX[P.legendN];
      if(u.buff>0 && lfx && lfx.hookBuffedDeathSave){
        if(P.legendEx)
          // 전설 탈진이 비용이라 한 턴에 한 번뿐이다. 아무 말 없이 그냥 죽으면 버그로 보인다.
          UI.log(`「세트 - 대장」: 전설이 이미 탈진되어 「${unitName(u)}」에는 쓸 수 없습니다`, 'sys');
        else if(!canPay(u.ctrl,0,['Any']))
          UI.log(`「세트 - 대장」: 힘(✳)이 부족해 「${unitName(u)}」에는 쓸 수 없습니다`, 'sys');
        else
          cands.push({ label:'세트 - 대장 — ✳1 지불 + 전설 탈진 + 버프 소모', forced:false,
            run: async () => {
              // 한 번뿐인 비용이므로, 지금 함께 죽는 다른 후보를 알려 주고 고르게 한다.
              // (여기서 거절하면 다음 유닛에게 물어본다)
              const others = _dyingBatch
                ? [..._dyingBatch].filter(x => x!==u && !x._dead && x.ctrl===u.ctrl && x.buff>0)   // 아직 처리 안 된 것들
                : [];
              const alsoDying = others.length
                ? `\n(지금 함께 죽는 버프 유닛: ${others.map(x=>unitName(x)).join(', ')} — 전설 탈진은 한 번뿐입니다)`
                : '';
              // 예/아니오가 나란히 보이는 모달로 묻는다. 보드의 유닛을 눌러 확정하는 방식(boardCard)은 '아니오' 버튼이
              // 사이드바 안내 칸에만 작게 놓여 "무조건 회수해야 넘어간다"로 보였다 (제보 2026-09-17, v1.0.69).
              const yes = await UI.confirmP(u.ctrl, `[세트 - 대장] ✳1 지불+전설 탈진+버프 소모로 「${unitName(u)}」을(를) 회수할까요? (아니오를 누르면 그대로 죽습니다)${alsoDying}`, [card(P.legendN),unitCard(u)],{decision:{title:'세트: 사망 시 회수',cost:'아무 영역 힘 1, 전설 탈진, 이 유닛의 버프 1개 소모',result:`「${unitName(u)}」을(를) 치유하고 탈진 상태로 기지에 회수`,note:'회수하지 않으면 사망 처리를 계속합니다.'+alsoDying,accept:'지불하고 회수',decline:'회수 안 함'}});
              if(!yes) return false;
              payCost(u.ctrl,0,['Any']); P.legendEx=true; u.buff=Math.max(0,u.buff-1);
              recall('세트 - 대장'); return true;
            } });
      }
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
          u._decree=true; return await killUnit(u);
        }
        return false;
      }
    }
  }
  removeUnit(u);
  UI.log(`💀 ${unitName(u)} 사망`, 'combat');
  // 장착 도구는 폐기되지 않고 분리되어 기지로 회수된다 (룰 424.3·425 · 148 — RiftJudge #1391 · #677)
  detachGear(u);

  if(!u.isToken){
    // 공식 룰: 선발 챔피언도 사망 시 폐기장으로 간다.
    // 챔피언 존 복귀는 일반적 수단으로는 불가 — 특정 효과(예: 신성한 무덤)로만 가능.
    // 카드는 언제나 '소유자'의 폐기장으로 — 「빙의」로 뺏은 유닛도 원 소유자 폐기장 (룰 107 "owner's trash instead" · #2250 · #4896)
    trashCard(u.owner!==undefined ? u.owner : u.ctrl, u.n);
  }
  // 턴 플래그: 상대 관점의 '적 유닛 사망'
  TF().enemyDied[opp(u.ctrl)]=true;
  // 주문 처치 귀속(룰 416 · 376.2.c): 처치 지시는 시전 중인 주문(자기 유닛·불사조 자신이어도), 클린업의 피해 사망은
  // 직전에 피해를 준 주문(_spellDmgBy — 전투·유닛 주체 피해면 없음), 칙령·단두대 표식은 그 주문의 시전자.
  // 예전엔 '시전자와 다른 통제자의 유닛'만 세어 자기 「숨겨진 칼날」로 불사조를 죽이는 공식 콤보가 막혔다(#9024).
  let killer=null;
  if(opts && opts.byDamage) killer = (hadDecree && !wasLethal && u._decreeBy!==undefined && u._decreeBy!==null) ? u._decreeBy : ((u._spellDmgBy!==undefined && u._spellDmgBy!==null) ? u._spellDmgBy : null);   // 비치명 피해+칙령이면 칙령 통제자의 처치(#11770)
  else if(G._casting!==undefined && G._casting!==null) killer = G._casting;
  if(killer===null && hadDecree && u._decreeBy!==undefined && u._decreeBy!==null) killer = u._decreeBy;
  if(killer!==null) (G._spellKilledBy = G._spellKilledBy||{})[killer]=true;
  UI.render();
  const dkTwice = _dkTwiceBatch ? _dkTwiceBatch[u.ctrl] : allUnits(u.ctrl).some(x=>unitFx(x).deathknellTwice);
  const afterDeath = async () => {
    // 죽음의 종소리 (카서스: 추가 1회)
    const ctxD={p:u.ctrl, unit:u, bfIdx:(deathLoc!=='base'?deathLoc:null), dead:true, deathTrigger:true};
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
  // 효과·클린업 밖에서 직접 처치된 경우(테스트·개별 호출) 사망 격발을 지금 체인에 — 배치 처치는 killUnitsTogether가, 전투는 결전 정리가 맡는다
  if(_execDepth===0 && !_deferDeathFx && !_dyingBatch && !G.manual && G._pendingTriggers && G._pendingTriggers.length) await flushPendingTriggers();
  return true;
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
    // 유닛의 '내가 플레이될 때' 격발은 체인에 오른다(383.4.a.3) — 상대가 [반응]·숨김 카드로 응수할 수 있다. 자원 [추가] 격발은 즉시(333.1.c).
    if(!G.manual && !ctx.immediate && !isResourceAbility(t)){ queueTrigger(t, ctx); continue; }   // 모든 격발은 대기열 → flushPendingTriggers가 체인/응수 창(383.4); 자원 [추가] 격발만 즉시(333.1.c)
    await execOps(t.ops, ctx);
  }
}
// 격발 능력을 공식 규칙처럼 처리한다: 대상을 격발 시점에 고르고(383.4.a.1 · 대상 없는 지시는 불발), 결전 중이면 체인에 적재(전투 격발과
// 같은 kind:'ability'·triggered 항목), 중립이면 응수 창(reactionWindow)을 연 뒤 해결한다 — 상대가 그 사이 대상을 치우면 그 지시만
// 불발(359.3.e). 예전엔 체인 없이 즉시 해결해 「격랑의 렉스」의 피해 6에 「숨겨진 칼날」로 응수할 수 없었다(제보 2026-09-22).
// 유닛 자체는 즉시 해결이므로(333.1.c) 응수 시점엔 이미 보드에 있다 — 응수로 격발원이 죽어도 격발은 해결된다(자기 대상 지시만 무의미).
async function fireTriggeredAbility(t, ctx){
  const p=ctx.p, u=ctx.unit||null;
  const srcName = u ? unitName(u) : (card(ctx.n)?.ko || '격발');
  const srcC = u ? unitCard(u) : card(ctx.n);
  const wrap = ctx.bfSrc ? (fn)=>withBattlefieldSource(ctx.bfSrc, fn) : (fn)=>fn();   // 전장 카드 격발은 출처 패널을 띄운다
  const saved=[_ctxBf,_hiddenBf,_ctxUnit,_curKind,_preTarget];
  _ctxBf=ctx.bfIdx??null; _hiddenBf=ctx.hiddenBf??null; _ctxUnit=u; _curKind=ctx.kind||'effect'; _preTarget=undefined;
  let pre=null;
  try{ pre=await wrap(()=>preTargetOps(p, t.ops, {label:srcName, n:srcC?.n, cost:{energy:0,pips:[]}, byEffect:true, pre:new Map(), prev:[]})); }
  finally{ [_ctxBf,_hiddenBf,_ctxUnit,_curKind,_preTarget]=saved; }
  // 모든 지시가 대상 지시인데 고를 대상이 하나도 없으면 격발은 아무것도 하지 않는다 — 응수 창을 열 이유가 없다
  const specOps=t.ops.filter(op=>op.op==='dealSplit' || preTargetSpecs(op).length);
  const empty=v=>v==null || (Array.isArray(v) && v.every(x=>x==null)) || (v && v.split && !v.split.length);
  if(specOps.length===t.ops.length && specOps.every(op=>empty(pre && pre.get(op)))){
    UI.log(`「${srcName}」 격발 — 적법한 대상이 없어 효과 없음`, 'sys'); return;
  }
  const chosen=describeCastTargets(pre), displayTargets=snapshotCastTargets(pre);
  const displayAffected=snapshotEffectApplications(t.ops, {p, unit:u, bfIdx:ctx.bfIdx??null, hiddenBf:ctx.hiddenBf??null});
  const trigCtx={legionOK:ctx.legionOK, paidAdd:ctx.paidAdd, addCount:ctx.addCount, dead:ctx.dead, buffed:ctx.buffed, isToken:ctx.isToken, tokenName:ctx.tokenName, excess:ctx.excess, buffAtTrigger:ctx.buffAtTrigger, dest:ctx.dest, reason:ctx.reason, count:ctx.count, ev:ctx.ev};
  if(G.state==='showdown' && G.showdown && !G.showdown.ending){
    const sd=G.showdown;
    const item=stampChainItem({kind:'ability', triggered:true, p, n:srcC?.n, ab:{ops:t.ops}, unit:u, gear:ctx.gear, it:ctx.it, srcName, pre,
      bfIdx:ctx.bfIdx??null, hiddenBf:ctx.hiddenBf??null, bfSrc:ctx.bfSrc||null, deathTrigger:!!ctx.deathTrigger, trigCtx, displayTargets, displayAffected});
    sd.chain.push(item);
    if(sd.chain.length===1) sd.chainStarter=p;
    sd.passes=0;
    UI.fx.chainAdd(srcC, p, sd.chain.length);
    UI.log(`🔗 ${pname(p)} 격발 「${srcName}」 체인에 적재 (#${sd.chain.length})`, 'p'+p);
    logCastTargets(p, srcName, chosen);
    UI.render();
    return;
  }
  logCastTargets(p, srcName, chosen);
  await reactionWindow(p, {...srcC, ko:`${srcName} 격발`}, {ability:true, displayTargets, displayAffected});
  if(G.winner!==null) return;
  // 격발원 유닛이 응수로 보드를 떠났으면 '이곳' 참조 소멸(359.3.f), 옮겨졌으면 '이곳'은 현재 위치(#2410). 사망 격발(종소리)은 죽은 자리가 '이곳'.
  const onBoard = !!(u && everyUnit().includes(u));
  const gone = !!(u && !onBoard && !ctx.deathTrigger);
  const moved = !!(u && onBoard && !ctx.deathTrigger && ctx.bfIdx!=null && u.loc!==ctx.bfIdx);
  if(gone) UI.log(`「${srcName}」 격발원이 자리를 떠나 '이곳' 참조가 사라짐 — 해당 지시 불발 (359.3.f)`, 'sys');
  else if(moved) UI.log(`「${srcName}」 격발원이 ${u.loc==='base'?'기지':'「'+card(G.bfs[u.loc].n).ko+'」'}(으)로 옮겨져 '이곳'은 현재 위치 (#2410)`, 'sys');
  const ectx = gone ? {...ctx, pre, bfIdx:null, sourceGone:true} : moved ? {...ctx, pre, bfIdx:(u.loc==='base'?null:u.loc)} : {...ctx, pre};
  await wrap(()=>execOps(t.ops, ectx));
}
// ── 격발 대기열 ──
// 모든 격발 능력(등장·이동·사망·정복·유지·개시·종료·이벤트 리스너·[통찰]·버림)은 격발 시점에 여기 쌓이고, 진행 중인 행동/효과가 끝난
// 시점(최상위 execOps 종료·클린업·개시/종료 단계·결전 정리)에 flushPendingTriggers가 체인에 올린다(383.4.a.3). 같은 플레이어의
// 동시 격발은 통제자가 순서를 고르고(383.4.a.4), 턴 플레이어 것부터 적재되어 마지막 것부터 해결된다(LIFO).
function queueTrigger(t, ctx){ if(!G) return; (G._pendingTriggers||(G._pendingTriggers=[])).push({t, ctx}); }
function trigLabel(x){
  const src = x.ctx.unit ? unitName(x.ctx.unit) : (x.ctx.n!=null && card(x.ctx.n) ? card(x.ctx.n).ko : '격발');
  let d=''; try{ d=describeOps(x.t.ops); }catch(e){}
  return d ? `${src} — ${d}` : src;
}
async function flushPendingTriggers(){
  for(let guard=0; guard<32 && G && G._pendingTriggers && G._pendingTriggers.length && G.winner===null; guard++){
    const list=G._pendingTriggers; G._pendingTriggers=[];
    const inSd = G.state==='showdown' && !!G.showdown && !G.showdown.ending;
    // 결전 체인에 적재할 때는 턴 플레이어 것부터(아래), 중립에서 곧바로 해결할 때는 그 역순(비턴 플레이어 것부터) — 결과는 같은 LIFO
    const order = inSd ? [G.turn, opp(G.turn)] : [opp(G.turn), G.turn];
    for(const p of order){
      let mine=list.filter(x=>x.ctx.p===p); if(!mine.length) continue;
      if(mine.length>1 && !G.manual){
        const ordered=[];
        while(mine.length>1){
          const sel=await UI.pickOption(p,'동시 격발 순서 — 먼저 해결할 것 (383.4.a.4)', mine.map((x,i)=>({v:i,label:trigLabel(x),n:x.ctx.unit?unitCard(x.ctx.unit).n:x.ctx.n})));
          const idx=(Number.isInteger(sel) && mine[sel]) ? sel : 0;
          ordered.push(mine.splice(idx,1)[0]);
        }
        ordered.push(mine[0]); mine=ordered;
      }
      const seq = inSd ? [...mine].reverse() : mine;   // 체인 적재는 '먼저 해결할 것'이 맨 위가 되도록 역순으로 밀어 넣는다
      for(const x of seq){ if(G.winner!==null) return; await fireTriggeredAbility(x.t, x.ctx); }
    }
  }
}
const flushPendingUnitTriggers = flushPendingTriggers;   // (구 이름 호환)
// 보드 전체 이벤트: 양측의 전설/유닛/도구 리스너를 스캔한다.
// t.who: 'self'(기본, 이벤트 주체 본인) | 'opp'(상대의 행동에 반응)
async function fireEvent(ev, ctx){
  if(!G || G.winner!==null) return;
  for(const pi of [0,1]){
    const rel = pi===ctx.p ? 'self' : 'opp';
    if(ctx._onlyRel && rel!==ctx._onlyRel) continue;   // 동시 격발 순서 선택으로 절반만 먼저/나중에 낼 때
    const srcs=[];
    const lfx=FX[G.players[pi].legendN];
    if(lfx && lfx.triggers && lfx.triggers[ev]) srcs.push({list:lfx.triggers[ev], n:G.players[pi].legendN});
    // 같은 행동으로 함께 죽는 중인 유닛은 그 사건을 볼 수 없다 (룰 376.3.b)
    for(const u of [...everyUnit()].filter(u=>u.ctrl===pi && !(_dyingBatch && _dyingBatch.has(u)))){
      const fx=unitFx(u);
      if(fx.triggers && fx.triggers[ev]) srcs.push({list:fx.triggers[ev], unit:u, n:unitCard(u).n});
    }
    for(const g of [...G.players[pi].gear]){
      const gf=FX[g.n];
      if(gf && gf.triggers && gf.triggers[ev]) srcs.push({list:gf.triggers[ev], gear:g, n:g.n});
    }
    // 폐기장에서 스스로를 회수하는 카드(초강력 초토화 로켓 252 등)는 폐기장에 있을 때도 격발한다.
    // 같은 카드가 여러 장이면 장마다 따로 격발한다(376.3 — 각 카드가 자기 능력을 가진다 · RiftJudge #6974: 로켓 3장이면
    // 3회, 회수한 로켓을 다음 격발의 버림 비용으로 쓸 수 있다). 격발 목록은 실행 전 스냅샷(폐기장은 실행 중 바뀐다).
    for(const tn of [...G.players[pi].trash]){
      const tf=FX[tn];
      if(tf && tf.trashTrigger && tf.triggers && tf.triggers[ev]) srcs.push({list:tf.triggers[ev], n:tn});
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
        const ectx={...ctx, p:pi, unit:s.unit||undefined, gear:s.gear||ctx.gear, it:ctx.it, kind:'effect', n:s.n, ev};
        if(G.manual || ctx.immediate || isResourceAbility(t)) await execOps(t.ops, ectx); else queueTrigger(t, ectx);   // 리스너 격발도 대기열 → 체인/응수 창 (격발 시점에 조건·리스너 집합 확정 — 로켓 252 #6120)
      }
    }
  }
}
// 이 이벤트에 반응할 리스너(전설·유닛·도구·폐기장 격발)가 보드에 있는가 — 정복 격발 순서 선택지에서 빈 항목을 숨기는 용도
// 내(p) 전설·유닛·도구·폐기장의 자기 이벤트 리스너가 있는가 (상대 리스너 제외)
function hasSelfListeners(ev, p){
  const P=G.players[p], lists=[];
  const lfx=FX[P.legendN]; if(lfx && lfx.triggers && lfx.triggers[ev]) lists.push(lfx.triggers[ev]);
  for(const u of everyUnit().filter(u=>u.ctrl===p)){ const f=unitFx(u); if(f.triggers && f.triggers[ev]) lists.push(f.triggers[ev]); }
  for(const g of P.gear){ const gf=FX[g.n]; if(gf && gf.triggers && gf.triggers[ev]) lists.push(gf.triggers[ev]); }
  for(const tn of new Set(P.trash)){ const tf=FX[tn]; if(tf && tf.trashTrigger && tf.triggers && tf.triggers[ev]) lists.push(tf.triggers[ev]); }
  return lists.some(l=>l.some(t=>(t.who||'self')==='self'));
}
function hasEventListeners(ev, p){
  for(const pi of [0,1]){
    const rel = pi===p ? 'self' : 'opp', P=G.players[pi], lists=[];
    const lfx=FX[P.legendN]; if(lfx && lfx.triggers && lfx.triggers[ev]) lists.push(lfx.triggers[ev]);
    for(const u of everyUnit().filter(u=>u.ctrl===pi)){ const f=unitFx(u); if(f.triggers && f.triggers[ev]) lists.push(f.triggers[ev]); }
    for(const g of P.gear){ const gf=FX[g.n]; if(gf && gf.triggers && gf.triggers[ev]) lists.push(gf.triggers[ev]); }
    for(const tn of new Set(P.trash)){ const tf=FX[tn]; if(tf && tf.trashTrigger && tf.triggers && tf.triggers[ev]) lists.push(tf.triggers[ev]); }
    if(lists.some(l=>l.some(t=>(t.who||'self')===rel))) return true;
  }
  return false;
}
// (구 API 호환) ctx.p 본인 소스만 발화
async function fireTriggers(ev, ctx){ await fireEvent(ev, ctx); }
async function fireBfTrigger(bfIdx, ev, ctx){
  const bf=G.bfs[bfIdx];
  const fx=FX[bf.n];
  if(fx && fx.triggers && fx.triggers[ev])
    await runTriggerList(fx.triggers[ev], {...ctx, n:bf.n, bfSrc:{n:bf.n,event:ev}});   // 출처 패널은 해결 시점(fireTriggeredAbility/resolveChainItem)에
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
    const yes=await UI.confirmP(p, `[전설] ${card(G.players[p].legendN).ko}을(를) 탈진하고 효과를 발동할까요?`, card(G.players[p].legendN),{decision:{title:'전설 효과',cost:'이 전설 탈진',result:hook.ops.map(op=>op.op==='channel'?`룬 ${op.n}개 ${op.exhausted?'탈진 상태로 ':''}활성화`:card(G.players[p].legendN).tko).join('\n'),accept:'탈진하고 발동',decline:'사용 안 함'}});
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
// [추가](Add) 자원 능력 — 체인에 쌓이지 않고 즉시 해결, 응수 불가 (333.1.c)
const RESOURCE_OPS = new Set(['addEnergy','addPower','addSpellEnergy','addSpellPower']);
// [군단]은 '다른 카드'(812.1.c · 813.1 "a card different than the one with the Legion ability") — 이 턴에 플레이된 발동원 자신은 세지 않는다
// (태양 원반 21을 첫 카드로 내고 바로 탈진해도 [군단] 불성립). 등장 격발은 ctx.legionOK(자기 제외)로 이미 처리.
function legionOKFor(p, source){
  const P=G.players[p];
  const self = source && ((source.kind==='unit' && source.u && source.u.playedTurn===G.turnCount) || (source.kind==='gear' && source.g && source.g.playedTurn===G.turnCount)) ? 1 : 0;
  return (P.playedCards - self) >= 1;
}
function isResourceAbility(ab){ return !!(ab && ab.ops && ab.ops.length && ab.ops.every(o=>RESOURCE_OPS.has(o.op))); }
// 능력 ops의 대상 spec을 발동 시점에 고른다 (403.1.b → 지불 · 404 적법 대상 없으면 발동 불가). preTargetSpell과 같은 규약:
// Map op→uid(배열), 대상 없는 필수 지시가 있으면 PRE_CANCEL, 고를 것이 없으면 null. 굴절(810)은 능력 비용(cost)과 합산해 판단.
async function preTargetAbility(p, source, ab, cost){
  if(G.manual || !ab.ops || !ab.ops.length) return null;
  const saved=[_ctxBf,_hiddenBf,_ctxUnit,_curKind,_preTarget];
  _ctxBf=source.bfIdx??((source.u&&source.u.loc!=='base')?source.u.loc:null); _hiddenBf=null; _ctxUnit=source.u||null; _curKind='ability'; _preTarget=undefined;
  const label = source.kind==='legend' ? card(G.players[p].legendN).ko : source.kind==='unit' ? unitName(source.u) : card(source.n??source.g.n).ko;
  try{ return await preTargetOps(p, ab.ops, {label:`${label} 능력`, cost, byEffect:false, pre:new Map(), prev:[]}); }
  finally{ [_ctxBf,_hiddenBf,_ctxUnit,_curKind,_preTarget]=saved; }
}
// 발동 가능 여부(대상 존재)만 미리 본다 — 봇(polAbLegal)·UI가 activateAbility의 게이트와 같은 판단을 하도록
function abilityHasTargets(p, source, ab){
  if(G.manual || !ab || !ab.ops || !ab.ops.length) return true;
  if(ab.target) return unitsBySpec(ab.target, p).length>0;
  if(typeof ab.preTarget==='function') return true;   // 카드 스크립트가 직접 판단
  const cost=ab.cost||{}; const pips=[...(cost.pips||[])]; for(let i=0;i<(cost.power||0);i++) pips.push('Any');
  const base={energy:cost.energy||0, pips};
  const saved=[_ctxBf,_hiddenBf,_ctxUnit,_curKind];
  _ctxBf=(source.u&&source.u.loc!=='base')?source.u.loc:null; _hiddenBf=null; _ctxUnit=source.u||null; _curKind='ability';
  try{
    const prev=[];
    for(const op of ab.ops) for(const ent of preTargetSpecs(op)){
      const spec = typeof ent==='function' ? ent(p, prev) : ent;
      if(spec.battlefield) continue;
      const cands=unitsBySpec(spec, p).filter(u=>canPayDeflect(p, u, base));
      if(!cands.length && !spec.optional) return false;
      prev.push(cands[0]||null);
    }
  } finally { [_ctxBf,_hiddenBf,_ctxUnit,_curKind]=saved; }
  return true;
}
async function activateAbility(p, source, ab){
  // source: {kind:'unit',u} | {kind:'legend'} | {kind:'gear',g}
  const P=G.players[p];
  // 타이밍
  if(G.state==='showdown' && !(ab.reaction||ab.action)){ UI.toast('결전 중에는 [행동]/[반응] 능력만 발동할 수 있습니다','warn'); return; }
  if(G.state==='showdown' && G.showdown && G.showdown.chain.length && !ab.reaction){
    UI.toast('체인 진행 중에는 [반응] 능력만 발동할 수 있습니다','warn'); return; }
  // [반응] 능력은 중립 닫힌 상태(상대 주문 응수 창)에서도 발동할 수 있다 (룰 309.2)
  if(G.state==='neutral' && G.turn!==p && !ab.reaction){ UI.toast('자신의 턴에만 발동할 수 있습니다','warn'); return; }
  if(ab.legion && !legionOKFor(p, source)){ UI.toast('[군단] 조건: 이번 턴에 다른 카드를 플레이해야 합니다','warn'); return; }
  if(ab.onlyAtBf && !ab.copied && source.kind==='unit' && source.u.loc==='base'){ UI.toast('전장에 있을 때만 사용할 수 있습니다','warn'); return; }   // 하이머딩거 복사(copied)는 원 카드의 위치 제한을 복사하지 않는다(#8631)

  const cost=ab.cost||{};
  const pips=[...(cost.pips||[])]; for(let i=0;i<(cost.power||0);i++) pips.push('Any');
  // 비용을 낼 수 있는지 먼저 전부 확인한다 (359.2.d 적법성 검사 실패 시 되돌림 — 일부만 내고 취소되는 일이 없게)
  if(cost.exhaustSelf){
    if(source.kind==='unit' && source.u.ex){ UI.toast('이미 탈진되었습니다','warn'); return; }
    if(source.kind==='legend' && P.legendEx){ UI.toast('전설이 이미 탈진되었습니다','warn'); return; }
    if(source.kind==='gear' && source.g.ex){ UI.toast('이미 탈진되었습니다','warn'); return; }
  }
  if(!canPay(p, cost.energy||0, pips)){ UI.toast('자원이 부족합니다','warn'); return; }
  if(cost.killFriendlyOrGear && !everyUnit().some(u=>u.ctrl===p) && !P.gear.length){ UI.toast('처치할 아군 유닛/도구가 없습니다','warn'); return; }
  if(cost.recycleTrash && P.trash.length<cost.recycleTrash){ UI.toast('폐기장가 부족합니다','warn'); return; }
  if(cost.discard && P.hand.length<cost.discard){ UI.toast('손패가 부족합니다','warn'); return; }
  if(cost.spendBuff && source.kind==='unit' && source.u.buff<=0){ UI.toast('버프가 없습니다','warn'); return; }   // 358/359.2.d: 지불 전에 검사
  // 대상 지정은 비용 지불 전(403.1.b "Make all choices required for this ability, such as targets" → 지불) — 적법 대상이 없으면
  // 발동 자체가 불가(404 "If legal options are not available for an Activated Ability, it is not legal to activate it", RiftJudge #3642).
  // 비용 지불 중 등장한 유닛(버린 죠스)은 후보가 아니다(#2485). 고른 대상은 ctx.pre(Map op→uid)로 op에 전달되어 해결 때
  // 그 대상이 사라졌으면 그 지시만 불발(356.3.e). ab.target(무허가 무기고 23)은 spec 하나, 그 외 능력은 주문처럼 ops의
  // 대상 spec(preTargetSpecs)을 순서대로 — 강철 발리스타 17·케이틀린 68·후회의 보주 90·투기장 주점 124·리 신 257·미스 포츈 267.
  let pre=null;
  if(ab.target){
    const cands=unitsBySpec(ab.target, p);
    if(!cands.length){ UI.toast('적법한 대상이 없어 발동할 수 없습니다 (룰 404)','warn'); return; }
    const tu=await UI.pickUnitFrom(p, cands, ab.target._prompt||'대상 선택'); if(!tu) return;
    pre=new Map([[ab.ops[0], tu.uid]]);
  } else if(typeof ab.preTarget!=='function'){
    pre=await preTargetAbility(p, source, ab, {energy:cost.energy||0, pips});
    if(pre===PRE_CANCEL){ UI.toast('적법한 대상이 없어 발동할 수 없습니다 (룰 404)','warn'); return; }
  }
  // 「미래의 용광로」는 아직 보드에 있어 자기 자신을 재활용 대상으로 고를 수 없고(RiftJudge #11013), 「미끼 바늘」은 처치할 유닛을
  // 발동 시점에 고정한다(#11249). ab.preTarget(p, source)는 cardscripts가 정의하며 null을 돌려주면 발동 취소(아직 낸 비용 없음).
  // 결과는 ctx.preAb로 해결 시점에 전달된다.
  let preAb;
  if(typeof ab.preTarget==='function'){
    preAb=await ab.preTarget(p, source);
    if(preAb===null){ UI.toast('대상이 없어 발동할 수 없습니다 (룰 404)','warn'); return; }
  }
  // 비표준 비용의 선택(처치할 아군 유닛/도구 — 말자하 113)도 지불 전에 받는다 — 취소하면 아무 비용도 내지 않은 상태로 끝난다 (359.2.d)
  let killSel=null;
  if(cost.killFriendlyOrGear){
    const kopts=[];
    everyUnit().filter(u=>u.ctrl===p).forEach(u=>kopts.push({v:{t:'u',u},label:'유닛: '+unitLabel(u),card:unitCard(u)}));
    P.gear.forEach((g,i)=>kopts.push({v:{t:'g',i},label:'도구: '+card(g.n).ko,n:g.n,boardCard:{kind:'gear',p,index:i}}));
    killSel=await UI.pickOption(p,'처치할 아군 유닛/도구 (비용)',kopts);
    if(!killSel) return;
  }
  const chosenTargets=describeCastTargets(pre, preAb);
  const displayTargets=snapshotCastTargets(pre, preAb);
  const abilityContext={p,unit:source.u,gear:source.g,
    bfIdx:(source.u&&source.u.loc!=='base')?source.u.loc:null};
  const displayAffected=snapshotEffectApplications(ab.ops,abilityContext);

  // 지불 — 자원 능력 자체(인장 등, 에너지·힘 비용 없음)는 룬을 안 건드려 묻지 않으므로 재귀하지 않는다
  if(((cost.energy||0) || pips.length) && !(await askResourceFunding(p, (source.kind==='legend'?card(P.legendN).ko : source.kind==='unit'?unitName(source.u) : card(source.g.n).ko), cost.energy||0, pips, false,
      source.kind==='legend'?P.legendN:source.kind==='unit'?source.u.n:source.g.n, '능력 사용 취소'))) return;
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
      if(idx!==null) await discardFromHand(p,idx,{defer:true});
    }
  }
  if(cost.spendBuff && source.kind==='unit') source.u.buff--;
  if(killSel){
    // 아군 유닛 또는 도구 하나 처치 (말자하) — 선택은 위에서 이미 받았다
    if(killSel.t==='u') await killUnit(killSel.u); else await killGear(p, killSel.i);
  }
  if(cost.killSelfGear && source.kind==='gear'){
    const gi=P.gear.indexOf(source.g);
    if(gi>=0) await killGear(p, gi);
  }

  const srcName = source.kind==='legend'?card(P.legendN).ko : source.kind==='unit'?unitName(source.u) : card(source.g.n).ko;
  // ── 결전 중: 능력도 체인에 적재 (비용은 이미 지불됨 — 규칙 338.1.a.4; 결전 종료 처리 중 sd.ending이면 즉시 해결) ──
  if(G.state==='showdown' && G.showdown && !G.showdown.ending){
    const sd=G.showdown;
    // [추가](Add) 자원 능력은 체인에 쌓이지 않고 즉시 해결된다 — 응수 불가, 우선권 유지 (규칙 333.1.c
    // "Abilities that Add resources... resolve immediately when Finalized" + 카드 리마인더 "반응할 수 없다").
    // 자원이 즉시 들어와야 같은 시점에 카드 비용 지불에 쓸 수 있다.
    // 주문 전용 자원(카이사 전설 247·럭스 314)도 [추가] 자원 능력이다. 빠져 있어서 체인에 쌓였고,
    // 체인은 결전이 끝나야 해결되므로 정작 그 시점의 카드 비용에는 쓸 수 없었다.
    if(isResourceAbility(ab)){
      UI.log(`${pname(p)} 「${srcName}」 [추가] 능력 — 즉시 해결 (응수 불가)`, 'p'+p);
      await execOps(ab.ops, {p, unit:source.u, gear:source.g, kind:'ability',
        bfIdx:(source.u&&source.u.loc!=='base')?source.u.loc:null});
      sd.passes=0;                    // 행동했으므로 패스 시퀀스는 끊기지만, 우선권은 그대로 유지
      UI.render(); UI.promptShowdown();
      return;
    }
    const sourceN=source.kind==='legend'?P.legendN:source.kind==='unit'?source.u.n:source.g.n;
    sd.chain.push(stampChainItem({kind:'ability', p, n:sourceN, ab, unit:source.u, gear:source.g, srcName, pre, preAb,
      displayTargets,displayAffected}));
    if(sd.chain.length===1) sd.chainStarter=p;
    UI.fx.chainAdd(source.kind==='legend'?card(P.legendN):source.u?unitCard(source.u):card(source.g.n), p, sd.chain.length);
    UI.log(`🔗 ${pname(p)} 능력 「${srcName}」 체인에 적재 (#${sd.chain.length})`, 'p'+p);
    logCastTargets(p, srcName, chosenTargets);
    showdownActed(p);                 // 우선권은 적재자가 유지
    UI.render();
    return;
  }
  UI.fx.cast(source.kind==='legend'?card(P.legendN):source.u?unitCard(source.u):card(source.g.n), p, '능력');
  UI.log(`${pname(p)} 「${srcName}」 능력 발동`, 'p'+p);
  logCastTargets(p, srcName, chosenTargets);
  // 활성화 능력은 체인을 쓴다(377.3.b.2) — 중립 상태에서도 주문처럼 상대가 [반응]으로 응수할 수 있다(377.3.b.2 "Opponents have an
  // opportunity to respond, as appropriate, as if a card was played onto the chain" · RiftJudge #5445 · #11232). 응수로 대상이
  // 사라지면 그 지시만 불발(356.3.e). [추가] 자원 능력만 즉시 해결·응수 불가(333.1.c). 예전엔 preTarget이 있는 비전설 능력에만 열렸다.
  if(!G.manual && !isResourceAbility(ab)){
    const srcC = source.kind==='legend' ? card(P.legendN) : source.kind==='unit' ? unitCard(source.u) : card(source.g.n);
    await reactionWindow(p, {...srcC, ko:`${srcC.ko} 능력`}, {ability:true, displayTargets,displayAffected});
    if(G.winner!==null) return;
  }
  await execOps(ab.ops, {p, unit:source.u, gear:source.g, kind:'ability', preAb, pre, bfIdx:(source.u&&source.u.loc!=='base')?source.u.loc:null});
  await cleanup(p);
  UI.render();
}

// ---------- 효과 op 실행기 ----------
// 꿈꾸는 나무(292): 주문으로 이곳의 아군 유닛을 턴 첫 선택 시 드로우.
// pickBySpec뿐 아니라 UI.pickUnitFrom을 직접 쓰는 커스텀 주문 op에서도 호출한다
// '턴마다 처음'은 플레이어별·전장별 — 두 전장이 모두 꿈꾸는 나무면 각 전장에서 1장씩(RiftJudge #9241 "Per Location").
// 반사 격발(떨어지는 별·이케시아 소나기)이 고르는 대상은 주문이 고른 것이 아니라 격발하지 않는다(#386 · #7545).
function noteSpellPick(p, u, kind){
  if((kind||_curKind)==='spell' && !G._reflexiveCast && u && u.ctrl===p && u.loc!=='base' && FX[G.bfs[u.loc].n] && FX[G.bfs[u.loc].n].dreamingTree){
    const seen = TF().bf292[p] = (TF().bf292[p] && typeof TF().bf292[p]==='object') ? TF().bf292[p] : {};
    if(seen[u.loc]) return;
    seen[u.loc]=true; drawCard(p);
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
  // 발생 위치가 없으면(기지에서 죽은 코그모 190의 종소리, 격발원이 떠난 격발) '이곳'은 존재하지 않는다 — 결전 전장·전체로 폴백하지 않는다
  // (RiftJudge #7905 · 359.3.f). 예전엔 결전 중이면 결전 전장, 아니면 전체 유닛으로 번졌다.
  // 발생 위치가 없더라도 격발원 유닛이 아직 전장에 있으면 그 위치가 '이곳'이다(직접 호출 경로). 격발원이 떠났거나(_sourceGone) 기지·사망이면 없음.
  if(spec.where==='here') cands = _ctxBf!==null ? cands.filter(u=>u.loc===_ctxBf)
    : (!_sourceGone && _ctxUnit && _ctxUnit.loc!=='base' && everyUnit().includes(_ctxUnit)) ? cands.filter(u=>u.loc===_ctxUnit.loc) : [];
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
  // "each of up to N units"(특이점 105 등): N개까지의 대상도 플레이 시점에 고른다(352.8.a) — 서로 다른 유닛, 0개도 적법(355.13 · #9363).
  // 예전엔 해결 때 골라 상대가 대상을 모른 채 응수해야 했다.
  if(op.op==='damageAll' && op.spec && typeof op.spec.count==='number'){
    const n=op.spec.count;
    return Array.from({length:n},(_,i)=>(p,prev)=>({...op.spec, count:1, optional:true,
      _exclude:[...(op.spec._exclude||[]), ...(i ? prev.slice(prev.length-i) : []).filter(Boolean)],
      _prompt:`피해 ${op.n} 대상 선택 (${i+1}/${n}, 최대 ${n}기 · 선택 안 함 가능)`}));
  }
  const ex=(typeof PRE_TARGET_EXTRA!=='undefined') ? PRE_TARGET_EXTRA[op.op] : null;
  return ex ? (typeof ex==='function' ? ex(op) : ex) : [];
}
// 사전 지정 대상. execOps가 op마다 넣는다 — uid(null=플레이 때 '선택 안 함') · 전장 대상 {bf} · 여러 대상이면 배열.
// undefined면 즉석 선택(격발·능력 등 플레이 시점 지정이 없는 경로).
let _preTarget;
const PRE_CANCEL = Symbol('preCancel');   // preTargetSpell: 고를 대상이 없어 플레이 취소
// 공개된 시전 대상만 표시한다. 손패·비용 선택을 다루는 UI.pick* 전체에는 로그를 달지 않는다.
// pre: Map(op → uid / {bf} / 배열), preAb: uid 또는 폐기장 카드 {pi,i,n} 배열.
function describeCastTargets(pre, preAb){
  const picks=pre ? [...pre.values()].flatMap(v=>v?.split?v.split.map(x=>x.uid):v).flat() : [];
  if(preAb!==undefined) picks.push(...(Array.isArray(preAb) ? (preAb.length?preAb:[null]) : [preAb]));
  return picks.map(v=>{
    if(v===null) return '선택 안 함';
    if(typeof v==='number'){
      const u=everyUnit().find(x=>x.uid===v);
      if(!u) return `유닛 #${v} (이미 보드에서 이탈)`;
      const area=u.loc==='base' ? G.players[u.ctrl].base : G.bfs[u.loc].units;
      const copies=area.filter(x=>x.ctrl===u.ctrl && unitName(x)===unitName(u));
      const order=copies.length>1 ? ` · 같은 이름 중 ${copies.indexOf(u)+1}번째` : '';
      return `${pname(u.ctrl)}의 「${unitName(u)}」 (${unitWhere(u)}${order})`;
    }
    if(v.bf!==undefined) return `전장 ${v.bf+1} 「${card(G.bfs[v.bf].n).ko}」`;
    if(v.t==='u') return describeCastTargets(new Map([[null,v.uid]]));   // 혼합 대상(희미해지는 기억 180)의 유닛
    if(v.t==='g') return `${pname(v.pi)}의 도구 「${card(v.g.n).ko}」${G.players[v.pi].gear.includes(v.g)?'':' (이미 보드에서 이탈)'}`;
    if(v.t==='unit' && v.u) return describeCastTargets(new Map([[null,v.u.uid]]));   // 발동 시점 선택(preAb)의 여러 모양
    if(v.t==='gear' && v.g) return `도구 「${card(v.g.n).ko}」`;
    if(v.uid!==undefined) return (v.mode?`[${v.mode}] `:'')+describeCastTargets(new Map([[null,v.uid]]));
    if(v.pi===undefined || v.n===undefined) return v.label || v.mode || '선택';
    return `${pname(v.pi)} 폐기장의 「${card(v.n).ko}」`;
  }).map((text,i)=>picks.length>1 ? `${i+1}. ${text}` : text).join(' / ');
}
// 공개된 대상의 카드/위치를 보관한다. UID만 남기면 대상 이탈 후에는 카드 그림을 복원할 수 없다.
// 보드 객체나 Map을 참조하지 않는 값으로 저장해 리플레이에도 같은 대상 정보가 남는다.
function snapshotCastTargets(pre, preAb){
  const picks=pre && typeof pre.values==='function' ? [...pre.values()].flatMap(v=>v?.split?v.split.map(x=>x.uid):v).flat() : [];
  if(preAb!==undefined) picks.push(...(Array.isArray(preAb) ? (preAb.length?preAb:[null]) : [preAb]));
  return picks.map(v=>{
    if(v===null) return {kind:'none', label:'선택 안 함'};
    const label=describeCastTargets(new Map([[null,v]]));
    if(typeof v==='number'){
      const u=everyUnit().find(x=>x.uid===v);
      return {kind:'unit', uid:v, n:u?.n, p:u?.ctrl, name:u?unitName(u):`유닛 #${v}`,
        tokenMight:u?.isToken?u.tokenMight:undefined, label};
    }
    if(v.bf!==undefined) return {kind:'battlefield', bf:v.bf, n:G.bfs[v.bf].n, label};
    if(v.t==='u'){ const u=everyUnit().find(x=>x.uid===v.uid); return {kind:'unit', uid:v.uid, n:u?.n, p:u?.ctrl, name:u?unitName(u):`유닛 #${v.uid}`, tokenMight:u?.isToken?u.tokenMight:undefined, label}; }
    if(v.t==='g') return {kind:'gear', n:v.g.n, p:v.pi, index:G.players[v.pi].gear.indexOf(v.g), label};
    if(v.t==='unit' && v.u) return {kind:'unit', uid:v.u.uid, n:v.u.n, p:v.u.ctrl, name:unitName(v.u), label};
    if(v.uid!==undefined){ const u=everyUnit().find(x=>x.uid===v.uid); return {kind:'unit', uid:v.uid, n:u?.n, p:u?.ctrl, name:u?unitName(u):`유닛 #${v.uid}`, label}; }
    if(v.pi===undefined || v.n===undefined) return {kind:'other', label};
    return {kind:'trash', n:v.n, p:v.pi, index:v.i, label};
  });
}
function snapshotUnitTarget(u){
  if(!u) return null;
  const label=describeCastTargets(new Map([[null,u.uid]]));
  return {kind:'unit',uid:u.uid,n:u.n,p:u.ctrl,name:unitName(u),
    tokenMight:u.isToken?u.tokenMight:undefined,label};
}
// 직접 고르지 않아도 효과가 자동으로 적용되는 유닛을 대상과 별도로 보여 준다.
// 'it'은 아리처럼 사건을 일으킨 유닛, 'self'는 발생원, all 계열은 현재 적용 범위다.
function snapshotEffectApplications(ops,ctx){
  const found=[], seen=new Set();
  const add=u=>{ if(u && !seen.has(u.uid)){seen.add(u.uid);found.push(u);} };
  const saved=[_ctxBf,_hiddenBf,_ctxUnit];
  _ctxBf=ctx.bfIdx??null; _hiddenBf=ctx.hiddenBf??null; _ctxUnit=ctx.unit??null;
  try{
    for(const op of ops||[]){
      if(op.self) add(ctx.unit);
      if(op.it) add(ctx.it);
      const all=op.all || (op.spec?.count==='all')
        || (['damageAll','killAll','stunAll','recallAll'].includes(op.op) && typeof op.spec?.count!=='number');
      if(all && op.spec) unitsBySpec({...op.spec,count:'all'},ctx.p).forEach(add);
    }
  } finally { [_ctxBf,_hiddenBf,_ctxUnit]=saved; }
  return found.map(snapshotUnitTarget).filter(Boolean);
}
function snapshotChainTarget(target, chain){
  return {kind:'chain', itemId:target.displayId, index:chain.indexOf(target), n:target.n, p:target.p,
    label:`${pname(target.p)}의 「${card(target.n).ko}」`};
}
function stampChainItem(item){
  item.displayId=G.chainSequence=(G.chainSequence||0)+1;
  return item;
}
function logCastTargets(p, sourceName, targets, action='대상 선택'){
  if(targets) UI.log(`🎯 ${pname(p)} 「${sourceName}」 ${action}: ${targets}`, 'p'+p);
}
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
async function pickPreTarget(p, spec, promptText, cost, selection){
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
    } else u=await UI.pickUnitFrom(p, cands, promptText, spec.optional, selection);
    if(!u) return null;
    if(selection?.op?.op==='buff' && !(await confirmBuffTarget(p,u))){ excl.push(u); continue; }
    // 「꿈꾸는 나무」 격발(noteSpellPick)은 여기서 하지 않는다 — 굴절 지불·파이널라이즈 뒤(383.4.c), playCardFromHand가 pre._units로 낸다
    if(free || await payDeflect(p, u, cost)) return u;
    excl.push(u);
  }
}
// ops 목록의 대상 spec을 순서대로 고른다 (주문·활성화 능력 공용). o: {label, cost, byEffect, pre, prev}
async function preTargetOps(p, ops, o){
  const pre=o.pre, prev=o.prev;
  for(const op of ops){
    if(op.op==='dealSplit'){
      const split=[], used=[];
      let remain=op.n+splitBonus(p,op.spec.where==='here'?_ctxBf:null);
      while(remain>0){
        const u=await pickPreTarget(p,{...op.spec,optional:true,_exclude:used},`분할 피해: 대상 선택 (남은 피해 ${remain})`,o.cost);
        if(!u) break;
        const n=await UI.pickNumber(p,`「${unitName(u)}」에게 줄 피해 (1~${remain})`,1,remain);
        split.push({uid:u.uid,n});used.push(u);remain-=n;
      }
      pre.set(op,{split});
      continue;
    }
    const ents=preTargetSpecs(op);
    if(!ents.length) continue;
    const vals=[];
    for(const ent of ents){
      const spec = typeof ent==='function' ? ent(p, prev) : ent;
      if(spec.custom && typeof preTargetCustomOptions==='function'){   // 도구·혼합 대상(희미해지는 기억 180 · 인양 224): 플레이 시점에 고른다(355.10)
        const copts=preTargetCustomOptions(p, spec);
        if(!copts.length){ if(spec.optional || o.byEffect){ vals.push(null); prev.push(null); continue; } return PRE_CANCEL; }
        const csel=await UI.pickOption(p, spec._prompt||`「${o.label}」 대상 선택`, spec.optional ? [{v:null,label:'선택 안 함'}, ...copts] : copts);
        if(csel===null || csel===undefined){ if(spec.optional || o.byEffect){ vals.push(null); prev.push(null); continue; } return PRE_CANCEL; }
        if(csel.t==='u'){ const cu=everyUnit().find(x=>x.uid===csel.uid); if(cu){ noteSpellPick(p, cu); if(!(await payDeflect(p, cu))){ if(spec.optional||o.byEffect){ vals.push(null); prev.push(null); continue; } return PRE_CANCEL; } } }
        vals.push(csel); prev.push(null); continue;
      }
      if(spec.battlefield){                              // 전장 대상 (352.10.d "at a battlefield"는 전장을 대상으로)
        const sel=await UI.pickOption(p, spec._prompt||`「${o.label}」 대상 전장`, G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko})),'battlefield');
        if(sel===null && !o.byEffect) return PRE_CANCEL;
        vals.push({bf: sel===null ? 0 : sel}); prev.push(null); continue;
      }
      let what=''; try{ what=describeOps([op]); }catch(e){}
      const u=await pickPreTarget(p, spec, spec._prompt||`「${o.label}」 대상 선택${what?' — '+what:''}`, o.cost,
        {ops:o.effectOps||ops, op, prev:prev.map(u=>u?.uid??null), cost:o.cost, ctx:{p,n:o.n,kind:'spell',bfIdx:_ctxBf,hiddenBf:_hiddenBf}});
      // 손패·숨김에서는 대상 없는 지시가 하나라도 있으면 낼 수 없다(352.8) — 효과로 내는 플레이는 그 지시만 비운다
      if(!u && !spec.optional && !o.byEffect) return PRE_CANCEL;
      vals.push(u?u.uid:null); prev.push(u||null);
    }
    pre.set(op, vals.length===1 ? vals[0] : vals);
  }
  return pre.size?pre:null;
}
async function preTargetSpell(p, c, fx, o){
  if(G.manual || !fx.playOps.length || fx.reflexive) return null;   // 반사 격발 주문은 격발이 고른다(352.8.b · 383)
  const pre=new Map(), prev=[];
  const saved=[_ctxBf,_hiddenBf,_ctxUnit,_curKind,_preTarget];
  _ctxBf=o.bfIdx??null; _hiddenBf=o.hiddenBf??null; _ctxUnit=null; _curKind='spell'; _preTarget=undefined;
  try{
    for(const po of fx.playOps){
      if(po.legion && !o.legionOK) continue;
      const r=await preTargetOps(p, po.ops, {label:c.ko, n:c.n, cost:o.cost, byEffect:o.byEffect, pre, prev, effectOps:fx.playOps.filter(g=>!g.legion||o.legionOK).flatMap(g=>g.ops)});
      if(r===PRE_CANCEL) return PRE_CANCEL;
    }
  } finally { [_ctxBf,_hiddenBf,_ctxUnit,_curKind,_preTarget]=saved; }
  if(!pre.size) return null;
  pre._units=prev.filter(Boolean);   // 고른 유닛들 — 파이널라이즈 뒤 「꿈꾸는 나무」 격발용(383.4.c)
  return pre;
}

async function pickBySpec(p, spec, promptText, selection){
  const preU=takePreTarget(p, spec);
  if(preU!==undefined) return preU || (spec.count==='all'?[]:null);
  const cands = unitsBySpec(spec, p);
  if(!cands.length) return spec.count==='all'?[]:null;
  if(spec.count==='all') return cands;
  const u = await UI.pickUnitFrom(p, cands, promptText, spec.optional, selection);
  if(!u) return null;
  noteSpellPick(p, u);
  if(!(await payDeflect(p, u))) return null;
  return u;
}
async function pickBuffTarget(p, spec, promptText, selection){
  const fixedTarget=_preTarget!==undefined;
  const declined=[];
  while(true){
    const current=declined.length ? {...spec,_exclude:[...(spec._exclude||[]),...declined]} : spec;
    const u=await pickBySpec(p,current,promptText,selection);
    if(!u || fixedTarget || await confirmBuffTarget(p,u)) return u;
    declined.push(u);
  }
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
// 717.3 'If no damage was Dealt, then Bonus Damage will not apply' — 기본 피해가 0인 인스턴스(힘 0의 「쌍권총 난사」·숨김 0장의 티모)에는
// 관문·애니의 추가 피해를 붙이지 않는다. 피해를 주는 모든 호출부가 이 헬퍼로 합산한다.
function dmgPlus(n, u, srcP){ return n>0 ? n+effDmgBonus(u, srcP) : 0; }
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
let _sourceGone = false;   // 격발원이 해결 전에 자리를 떠났음(359.3.f) — 'here' 참조 없음
let _curKind = 'effect';
let _execDepth=0;
// 최상위 execOps가 끝나면(효과 해결 완료) 대기 격발을 체인에 올린다
async function execOps(ops, ctx){
  _execDepth++;
  try{ return await execOpsInner(ops, ctx); }
  finally{ _execDepth--; if(_execDepth===0 && G && !G.manual && G._pendingTriggers && G._pendingTriggers.length) await flushPendingTriggers(); }
}
async function execOpsInner(ops, ctx){
  if(G.winner!==null) return;
  const p=ctx.p;
  _ctxBf = ctx.bfIdx??null;
  _hiddenBf = ctx.hiddenBf??null;
  _ctxUnit = ctx.unit??null;
  _sourceGone = !!ctx.sourceGone;
  _curKind = ctx.kind||'effect';
  let it = ctx.it||null;
  const pre = ctx.pre||null;   // 플레이 시점에 고른 대상 (Map op→uid) — preTargetSpell
  for(const op of ops){
    if(G.winner!==null) return;
    { const v=(pre && pre.has(op)) ? pre.get(op) : undefined; _preTarget = Array.isArray(v) ? [...v] : v; }   // 배열은 소비되므로 복사
    const selection={ops:ops.slice(ops.indexOf(op)),op,prev:[],ctx:{...ctx,it}};
    switch(op.op){
      case 'visionCheck': await visionCheck(p); break;   // [통찰] 격발(대기열 경유)
      case 'killTemporaryBatch': {
        const us=(ctx.units||[]).filter(u=>everyUnit().includes(u) && effKw(u).temporary);
        if(!us.length) break;
        // 처치 전에 통제자가 숨긴 카드를 공개할 기회 — 존야의 모래시계(77)가 앞면이어야 사망을 대체한다(#10806)
        for(let guard=0; guard<4; guard++){
          const hopts=[]; G.bfs.forEach((bf,bi)=>bf.hiddenCards.forEach((hc,hi)=>{ if(hc.by===p && !(hc.turn===G.turnCount && G.turn===p)) hopts.push({v:{bi,hi},label:`숨김 카드 공개: ${card(hc.n).ko} (${card(bf.n).ko})`,n:hc.n}); }));
          if(!hopts.length) break;
          const hsel=await UI.pickOption(p,'[일시적] 처치 전에 숨긴 카드를 공개할까요? (선택)',[{v:null,label:'공개 안 함'}, ...hopts]);
          if(!hsel) break;
          const hc=G.bfs[hsel.bi].hiddenCards[hsel.hi]; if(!hc) break;
          const before=G.bfs[hsel.bi].hiddenCards.length, prevRw=G._rwFor; G._rwFor=p;   // 닫힌 상태의 숨김 공개와 같은 타이밍 허용(개시 단계)
          try{ await playHidden(p, hsel.bi, hc); } finally{ G._rwFor=prevRw; }
          if(G.bfs[hsel.bi].hiddenCards.length===before) break;   // 공개되지 않았으면(제한) 반복하지 않는다
        }
        const still=us.filter(u=>everyUnit().includes(u));
        still.forEach(u=>UI.log(`[일시적] ${unitName(u)} 처치됨`, 'sys'));
        if(still.length) await killUnitsTogether(still);
        break; }
      case 'draw': for(let i=0;i<op.n;i++) drawCard(p); break;
      case 'drawEach': for(let i=0;i<op.n;i++){ drawCard(0); drawCard(1); } break;
      case 'drawIfHandLE': if(G.players[p].hand.length<=op.limit) for(let i=0;i<op.n;i++) drawCard(p); break;
      case 'damage': {
        const u=await pickBySpec(p, op.spec, `피해 ${op.n}을 줄 대상 선택`,selection);
        if(u){ const d=dealDamage(u, dmgPlus(op.n,u,p), _curKind); it=u; UI.log(`${unitName(u)}에게 피해 ${d}`, 'combat'); }
        break; }
      case 'damageAll': {
        if(typeof op.spec.count==='number'){
          // "each of up to N units" — N개까지 골라 각각 피해 (optional이면 중도 중단 가능)
          const picked=[];
          const hadPre = _preTarget!==undefined;   // 플레이 시점에 고른 대상 배열이 있으면 그것만 쓴다 (해결 때 추가 선택 없음)
          for(let i=0;i<op.spec.count;i++){
            if(hadPre && _preTarget===undefined) break;
            const u=await pickBySpec(p,{...op.spec,count:1,_exclude:picked},`피해 ${op.n} 대상 선택 (${i+1}/${op.spec.count})`,selection);
            if(!u){ if(hadPre) continue; break; }   // 사전 지정 대상이 '선택 안 함'이거나 불발이면 다음 것으로
            picked.push(u);
          }
          picked.forEach(u=>{ dealDamage(u, dmgPlus(op.n,u,p), _curKind); });
          if(picked.length) UI.log(`대상 ${picked.length}개에게 각 피해 ${op.n}`, 'combat');
        } else {
          const us=await pickBySpec(p,{...op.spec,count:'all'});
          us.forEach(u=>{ dealDamage(u, dmgPlus(op.n,u,p), _curKind); });
          UI.log(`대상 전체(${us.length})에게 피해 ${op.n}`, 'combat');
        }
        break; }
      case 'dealSplit': {
        if(_preTarget?.split){
          const split=_preTarget.split;_preTarget=undefined;
          const cands=unitsBySpec(op.spec,p);
          for(const part of split){
            const u=cands.find(x=>x.uid===part.uid);
            if(u){dealDamage(u,part.n,_curKind);UI.log(`${unitName(u)}에게 피해 ${part.n}`, 'combat');}
          }
          break;
        }
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
        const u=await pickBySpec(p, op.spec, '처치할 유닛 선택',selection);
        if(u){ it=u; await killUnit(u); }
        break; }
      case 'killAll': {
        // 428.6 'Kill all …'은 한 번의 처치 액션 — 동시에 죽는다(종소리는 모두 죽은 뒤 한꺼번에·존야 대체는 통제자 선택), eachPlayerKills·cleanupDeaths와 같은 배치 경로
        const us=await pickBySpec(p,{...op.spec,count:'all'});
        await killUnitsTogether(us);
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
      case 'buffSelf': if(ctx.unit && everyUnit().includes(ctx.unit)){ await buffUnit(ctx.unit, p); } break;   // 응수로 죽은 격발원(산봉우리 수호자 223)은 버프 없음
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
          const spec={...op.spec, _exclude:picked};
          const u=await pickBuffTarget(p, spec, `버프할 유닛 선택${op.count>1?` (${i+1}/${op.count})`:''}`,
            {...selection,ops:[{...op,count:1,spec}]});
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
        else { const u=await pickBySpec(p, op.spec, `위력 ${op.n>0?'+':''}${op.n} 대상 선택`, selection); if(u){targets=[u]; it=u;} }
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
          u=await pickBySpec(p, gs, gs._prompt, selection);
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
        // 423.1 'Stun a unit'은 진영 제한이 없다 — 아군도 고를 수 있다(봇은 프롬프트 '기절'로 적을 고른다). 예전엔 any를 enemy로 강제해
        // 플레이 시점(any)에 고른 아군이 해결 때 '부적법'으로 불발되기도 했다.
        const u=await pickBySpec(p, op.spec, '기절할 유닛 선택');
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
        if(op.where==='here' && ctx.sourceGone){ UI.log(`격발원이 떠나 '이곳'이 없어 토큰을 놓지 않음 (RiftJudge #2410 · #6592)`, 'sys'); break; }
        let loc='base';
        // 숨김에서 나온 플레이가 유닛을 플레이하게 하면 그 전장에 놓는다 (룰 737.3)
        if(_hiddenBf!==null) loc=_hiddenBf;
        else if(op.where==='here' && _ctxBf!==null) loc=_ctxBf;
        // 「마법사냥꾼 간수」(70) "opponents can only play units to their base" — 토큰 플레이도 유닛 플레이라 전장엔 못 낸다
        const jailed=everyUnit().some(u=>u.ctrl!==p && u.loc!=='base' && unitFx(u).jailerUnits);
        if(op.where==='play' && _hiddenBf===null){
          // 토큰도 '플레이'하는 것이므로 기지 또는 통제 중인 전장을 고른다 (룰 406/143)
          const locs=[{v:'base',label:'기지'}];
          if(!jailed) G.bfs.forEach((bf,i)=>{ if(bf.controller===p) locs.push({v:i,label:'전장: '+card(bf.n).ko,n:bf.n}); });
          const sel=await UI.pickOption(p,'토큰을 배치할 위치',
            locs.map(o=>({...o,placement:{token:op,ctx}})),'placement');
          if(sel!==null) loc=sel;
        }
        else if(op.where==='at a battlefield' && _hiddenBf===null){
          const sel=await UI.pickOption(p,'토큰을 배치할 전장',G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko,n:bf.n})).concat([{v:'base',label:'기지'}])
            .map(o=>({...o,placement:{token:op,ctx}})),'placement');
          if(sel!==null) loc=sel;
        }
        // 숨김에서 낸 「스프라이트 부름」·'이곳' 토큰은 그 전장에만 낼 수 있고 기지로 돌릴 수 없다 — 간수가 있으면
        // 주문은 해결되되 토큰만 불발 (룰 100 불가능한 지시 무시 · RiftJudge #3977)
        if(loc!=='base' && jailed){ UI.log(`「마법사냥꾼 간수」: 전장에 유닛을 플레이할 수 없어 토큰이 나오지 않음`, 'sys'); break; }
        // 토큰도 플레이된 유닛(351.3)이라 「맞대결」(129) '이번 턴 플레이하는 유닛은 준비 등장'·등장 준비 오라를 그대로 받는다 (#8620)
        let tokReady = !!op.ready || !!TF().enterReady[p]
          || collectStatics().some(src=>src.s.kind==='enterReadyAura' && src.p===p);
        if(TF().nextUnitReady[p]){ tokReady=true; TF().nextUnitReady[p]=false; }
        const madeTokens=[];
        for(let i=0;i<op.count;i++){
          const u=makeUnit(0,p,{loc,isToken:true,tokenMight:op.might,tokenName:op.name,ready:tokReady});
          if(op.temp) u.grants.temporary=true;
          placeUnit(u,loc);
          madeTokens.push(u);
        }
        for(const u of madeTokens){ await tokenPlayed(p, u); await fireAttackTriggers(u, loc); }   // 토큰도 플레이된 유닛이다
        UI.log(`${pname(p)} ${op.might}⚔ ${op.name==='Recruit'?'신병':op.name} 토큰 ${op.count}개 플레이`, 'p'+p);
        break; }
      case 'recallSelf': if(ctx.unit && everyUnit().includes(ctx.unit)){ removeUnit(ctx.unit); placeUnit(ctx.unit,'base'); UI.log(`${unitName(ctx.unit)} 기지로 귀환`, 'p'+p); } break;   // 격발원이 이미 떠났으면(응수로 처치) 무의미
      case 'recallIt': if(it){ removeUnit(it); placeUnit(it,'base'); } break;
      case 'recall': {
        const u=await pickBySpec(p, op.spec, '기지로 되돌릴 유닛 선택');
        if(u){ removeUnit(u); placeUnit(u,'base'); it=u; UI.log(`${unitName(u)} 기지로 귀환`, 'p'+p); }
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
        const spec={...op.spec};   // 414.1 'Exhaust a unit'도 진영 제한 없음(봇은 프롬프트 '탈진시킬'로 적을 고른다)
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
          await discardFromHand(p, idx!==null ? idx : 0, {batch:true}); any=true;   // 'may' 없는 버림은 강제(424.1 잠입 요원 예시) — 취소하면 첫 장
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
        everyUnit().filter(u=>(u.owner??u.ctrl)===p&&!u.isToken&&card(u.n).tags.includes('Teemo')).forEach(u=>opts.push({v:u,label:unitLabel(u),card:unitCard(u)}));   // 'you own' — 소유자 기준
        if(!opts.length){ UI.toast('티모 유닛이 없습니다','warn'); break; }
        const sel=await UI.pickOption(p,'손패로 가져올 티모 유닛',opts);
        if(sel==='zone'){ P.champInZone=false; P.hand.push(P.champN); }
        else if(sel){ detachGear(sel); removeUnit(sel); P.hand.push(sel.n); }   // 보드를 떠나면 장착 도구는 분리(454)
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
        // 격발 능력의 비용은 체인에 올릴 때 낸다('4. Pay Costs') — 정복 시점에 버프가 없었으면 같은 정복으로 얻은 버프
        // (세트 - 격투가 164)로는 낼 수 없다 (히라나 수도원 282 · RiftJudge #8738)
        if(ctx.buffAtTrigger===false){ UI.log(`격발 시점에 버프가 없어 비용을 낼 수 없음 — 효과 없음`, 'sys'); break; }
        const cands=everyUnit().filter(u=>u.ctrl===p&&u.buff>0);
        if(!cands.length) break;
        const u=await UI.pickUnitFrom(p,cands,'버프를 소모해 효과를 실행할 유닛',true,
          {costConfirmation:{text:'버프를 소모하고 효과를 실행할까요?',pickTitle:'버프를 소모할 유닛 선택'}});
        if(u){ u.buff--; await execOps([op.inner], {...ctx, it}); }
        break; }
      case 'chooseOne': {
        const labels=op.branches.map((b,i)=>({v:i,label:`선택지 ${i+1}: ${describeOps(b)}`}));
        const sel=await UI.pickOption(p,'하나를 선택하세요',labels);
        if(sel!==null) await execOps(op.branches[sel], {...ctx, it});
        break; }
      case 'chooseUnit': {
        const u=await pickBySpec(p, op.spec, op.spec._prompt||'유닛 선택', selection);   // 문구는 봇 판단 근거(이로운 효과면 아군)
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
          // 어느 룬을 돌릴지는 항상 플레이어 선택(준비/탈진 표시) — 예전엔 색이 같으면 마지막 룬을 자동으로 돌려
          // 탈진 룬을 두고 준비 룬이 사라졌다. 탈진 룬을 앞에 두어 기본 선택(봇)은 탈진 룬부터.
          const ordered=P.runes.map((r,i)=>({r,i})).sort((a,b)=>(a.r.ex?0:1)-(b.r.ex?0:1) || a.i-b.i);
          let ri=ordered[0].i;
          if(P.runes.length>1){
            const sel=await UI.pickOption(p,'재활용할 룬 선택 (강제)',
              ordered.map(x=>({v:x.i, label:(DOMAIN_KO[runeDomain(x.r.n)]||runeDomain(x.r.n)||'룬')+(x.r.ex?' (탈진)':' (준비)')})));
            if(sel!=null) ri=sel;
          }
          // 준비 룬을 돌리기 전에 룬을 탈진해(응수 불가 [추가] 능력) 에너지를 풀에 띄워 둘 수 있다 — 손해가 없는
          // 선택이라 자동으로 띄운다. 풀의 에너지는 턴 종료까지 남는다 (RiftJudge #2810 · #5048).
          const r0=P.runes[ri];
          if(!r0.ex){ r0.ex=true; P.energy++; UI.log(`${pname(p)} 준비 룬을 먼저 탈진 → 에너지 1 풀에 유지 (재활용 전)`, 'p'+p); }
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
        const keep=[], recList=[]; let rec=false;
        for(const n of seen){
          const yes=await UI.confirmP(p, `덱 위 ${seen.length}장: ${names} — 「${card(n).ko}」를 재순환(덱 맨 아래)할까요?`, card(n));
          if(yes){ recList.push(n); rec=true; } else keep.push(n);
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
        P.deck.push(...shuffle(recList));   // 417.1 동시에 재활용된 카드는 무작위 순서로 덱 밑에
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
          await EXTRA_OPS[op.op](op, {...ctx, it}, {it:()=>it, setIt:(v)=>{it=v;}, selection});
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
// 유닛이 보드를 떠날 때(사망·손패·추방) 장착 도구는 분리되어 '도구 통제자'의 기지로 준비 상태로 회수된다
// (룰 424.3·425 분리 위치 → 148 전장의 도구는 다음 클린업에 회수 · RiftJudge #1391 · #677 · #43). 예전엔 사망 시 폐기, 손패 복귀 시 소실.
function detachGear(u){
  if(!u || !u.gear || !u.gear.length) return;
  u.gear.forEach((gn,i)=>{
    const gp=(u.gearCtrl && u.gearCtrl[i]!==undefined) ? u.gearCtrl[i] : u.ctrl;
    G.players[gp].gear.push({n:gn, ex:false, attachedTo:null});
    UI.log(`도구 「${card(gn).ko}」 분리 → ${pname(gp)} 기지로 회수`, 'sys');
  });
  u.gear=[]; u.gearCtrl=[];
}
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
  (u.gearCtrl=u.gearCtrl||[]).push(p);   // 도구 통제자 — 분리 시 이 플레이어의 기지로 (뺏은 유닛에 내 도구를 달아도 내 것)
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
