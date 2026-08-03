// ══════════ BOT 대전 (연습 상대) ══════════
// 오프라인 전용. 봇이 좌석 1(P2)을 맡아 자동으로 행동한다.
// 선택 프롬프트(UI.pick*)는 봇 좌석일 때 자동 응답으로 가로챈다.
// 보통/어려움 난이도의 휴리스틱은 대회 플레이 가이드 조사 내용 기반:
//  - 멀리건: 1턴 플레이(저비용 유닛) 확보, 최악의 0~2장만 개별 교체 (learnriftbound.gg/learn/beginner/02-mulligan)
//  - 공격: 실효 위력 비교, 대등 교환도 정복 1점 때문에 공격측 이득 (riftboundzone.com battlefields-101)
//  - 두 갈래 압박: 빈 전장 점거 + 본대 공격 분리 (riftbound.zone choosing-battlefields)
//  - 리썰 플랜: 6점부터 더블 점령/홀드 셋업, 상대 리썰 레인지엔 수비·견제 (learnriftbound.gg intermediate/06-lethal-points)
//  - 결전 대응: [행동]/[반응] 트릭은 아껴뒀다가 박빙 결전에서 사용 (riftbound.zone combat-and-showdown)

const BOT = { active:false, seat:1, level:'normal', busy:false, tried:new Set(), lastTC:-1, movesTC:-1, movesLeft:0, sdSeen:null };

const BOT_LEVELS = [
  { id:'easy',   name:'😊 쉬움',   desc:'무작위 위주로 플레이합니다' },
  { id:'normal', name:'🙂 보통',   desc:'유불리를 따져 플레이·이동합니다' },
  { id:'hard',   name:'😈 어려움', desc:'대회 플레이 원칙 적용 — 멀리건·공격 타이밍·결전 트릭·점수 플랜' },
];

function botIs(p){ return BOT.active && !NET.online && p===BOT.seat; }
function botDelay(v, ms){ return new Promise(res=>setTimeout(()=>res(v), ms||400)); }
function botRand(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function botSmart(){ return BOT.level!=='easy'; }
function botHard(){ return BOT.level==='hard'; }

// ── 다른 모드가 시작되면 봇 자동 해제 ──
const _bot_newGame = newGame;
newGame = function(cfg){ BOT.active=false; return _bot_newGame(cfg); };

// ── 선택 프롬프트 자동 응답 ──
const _bot_pickUnit = UI.pickUnitFrom;
UI.pickUnitFrom = function(p, candidates, promptText, optional){
  if(botIs(p)){
    if(!candidates.length) return Promise.resolve(null);
    if(!botSmart()) return botDelay(optional && Math.random()<0.2 ? null : botRand(candidates));
    // 스마트 대상 선택: 제거류 → 가장 강한 적, 희생·비용류 → 가장 약한 아군, 강화류 → 가장 강한 아군
    const txt=String(promptText||'');
    const foes=candidates.filter(u=>u.ctrl!==p);
    const mine=candidates.filter(u=>u.ctrl===p);
    // 엔진 프롬프트 표기: "처치할 아군 유닛 (추가 비용)", "탈진할 아군 유닛" 등
    const isSacrifice=!foes.length && /처치|탈진|희생|제물|파괴|버릴/.test(txt);
    if(isSacrifice && optional) return botDelay(null);  // 선택적 아군 희생 비용은 지불하지 않는다
    let pick;
    if(isSacrifice){
      pick=[...mine].sort((a,b)=>might(a)-might(b))[0];
    } else if(foes.length){
      pick=[...foes].sort((a,b)=>might(b)-might(a))[0];
    } else {
      pick=[...mine].sort((a,b)=>might(b)-might(a))[0];
    }
    return botDelay(pick);
  }
  return _bot_pickUnit.apply(UI, arguments);
};
const _bot_pickOption = UI.pickOption;
UI.pickOption = function(p, title, options){
  if(botIs(p)) return botDelay(options.length ? botRand(options).v : null);
  return _bot_pickOption.apply(UI, arguments);
};
const _bot_confirm = UI.confirmP;
UI.confirmP = function(p, text, previewCard){
  if(botIs(p)) return botDelay(true);
  return _bot_confirm.apply(UI, arguments);
};
const _bot_pickNumber = UI.pickNumber;
UI.pickNumber = function(p, text, min, max){
  if(botIs(p)) return botDelay(max);
  return _bot_pickNumber.apply(UI, arguments);
};
const _bot_mull = UI.pickMulligan;
UI.pickMulligan = function(p){
  if(botIs(p)){
    const h=G.players[p].hand;
    if(!botSmart()){
      // 쉬움: 비용 5 이상 카드를 최대 2장 교체 (기존 동작)
      return botDelay(h.map((n,i)=>i).filter(i=>(card(h[i]).e||0)>=5).slice(0,2));
    }
    // 대회 원칙: 1턴에 낼 수 있는 플레이(저비용 유닛/도구)를 확보하고, 최악의 카드만 개별 교체
    const cost=i=>(card(h[i]).e||0);
    const idxs=h.map((n,i)=>i);
    const cheap=idxs.filter(i=>cost(i)<=2 && ['Unit','Gear'].includes(card(h[i]).type));
    const byWorst=[...idxs].sort((a,b)=>cost(b)-cost(a));
    const swap = cheap.length ? byWorst.filter(i=>cost(i)>=5).slice(0,2) : byWorst.slice(0,2);
    return botDelay(swap);
  }
  return _bot_mull.apply(UI, arguments);
};
const _bot_pickHand = UI.pickHandCard;
UI.pickHandCard = function(p, title){
  if(botIs(p)){
    const h=G.players[p].hand;
    if(!h.length) return botDelay(null);
    if(!botSmart()) return botDelay(Math.floor(Math.random()*h.length));
    // 버리기 등: 가장 비싼(당장 못 내는) 카드 선택
    let best=0; h.forEach((n,i)=>{ if((card(n).e||0)>(card(h[best]).e||0)) best=i; });
    return botDelay(best);
  }
  return _bot_pickHand.apply(UI, arguments);
};

// ── 턴 드라이버 (900ms마다 한 가지 행동) ──
setInterval(()=>{
  if(!BOT.active || !G || G.winner!==null || NET.online || BOT.busy) return;
  if(UI.isPicking && UI.isPicking()) return;                       // 사람이 선택 중
  if(document.getElementById('modal-overlay').style.display!=='none') return;
  if(BOT.lastTC!==G.turnCount){ BOT.lastTC=G.turnCount; BOT.tried.clear(); }

  // 결전: 봇 응답 차례 — 어려움은 박빙일 때 트릭 카드 시도 후 패스
  if(G.state==='showdown'){
    if(G.actingPlayer===BOT.seat){
      BOT.busy=true;
      botShowdown().catch(e=>console.error('[BOT]',e)).finally(()=>{ BOT.busy=false; UI.render(); });
    }
    return;
  }
  if(G.turn!==BOT.seat || G.phase!=='action' || G.state!=='neutral') return;
  BOT.busy=true;
  botStep().catch(e=>console.error('[BOT]',e)).finally(()=>{ BOT.busy=false; UI.render(); });
}, 900);

async function botShowdown(){
  const p=BOT.seat;
  const sd=G.showdown;
  if(botHard() && sd && BOT.sdSeen!==sd){
    BOT.sdSeen=sd;                       // 결전 인스턴스당 1회만 시도
    if(await botCombatTrick(p)) return;  // showdownActed()가 차례를 상대에게 넘겼음
  }
  await showdownPass();
}

// 박빙/열세의 실전투 결전에서 [행동]/[반응] 카드를 시도
async function botCombatTrick(p){
  const sd=G.showdown; if(!sd) return false;
  const us=unitsAt(sd.bfIdx);
  const role=u=>u.ctrl===sd.attacker?'attacker':'defender';
  const myM=us.filter(u=>u.ctrl===p).reduce((s,u)=>s+might(u,role(u)),0);
  const opM=us.filter(u=>u.ctrl!==p).reduce((s,u)=>s+might(u,role(u)),0);
  if(opM<=0 || !us.some(u=>u.ctrl===p)) return false; // 무혈 결전(한쪽 없음)엔 아낀다
  if(myM>opM+2) return false;            // 크게 이기고 있으면 아낀다
  const P=G.players[p], ready=readyRunes(p).length;
  const costOf=c=>(c.e||0)+powerPips(c).length;
  const idx=P.hand.findIndex(n=>{
    const fx=FX[n]||{kw:{}};
    return (fx.kw.action||fx.kw.reaction) && costOf(card(n))<=ready;
  });
  if(idx<0) return false;
  const ok=await playCardFromHand(p, idx);
  if(ok===false) return false;
  showdownActed();                       // 사람 플레이 경로(ui.js)와 동일: 패스 카운터 리셋 + 우선권 전환
  return true;
}

async function botStep(){
  const p=BOT.seat, P=G.players[p];
  const ready=readyRunes(p).length;
  const costOf=c=>(c.e||0)+powerPips(c).length;

  // 1) 손패 플레이 — 재시도 차단 키는 카드 번호('h'+n): 인덱스는 플레이 성공 시 시프트되므로 쓰지 않는다
  let idx=-1;
  if(!botSmart()){
    idx=P.hand.findIndex((n,i)=>{
      if(BOT.tried.has('h'+n)) return false;
      if(Math.random()<0.4) return false;
      return costOf(card(n))<=ready;
    });
  } else {
    // 가치 순 플레이: 유닛(위력·효율) > 도구 > 주문. 어려움은 [행동]/[반응] 트릭을 결전용으로 아껴둔다.
    const cands=[];
    P.hand.forEach((n,i)=>{
      if(BOT.tried.has('h'+n)) return;
      const c=card(n); if(costOf(c)>ready) return;
      const fx=FX[n]||{kw:{}};
      let score;
      if(c.type==='Unit') score=100+(c.m||0)*2-costOf(c);
      else if(c.type==='Gear') score=50-costOf(c);
      else if(botHard()&&(fx.kw.action||fx.kw.reaction)) score=-1; // 아껴둠
      else score=30-costOf(c);
      cands.push({i,score});
    });
    cands.sort((a,b)=>b.score-a.score);
    if(cands.length){
      const top=cands[0];
      // 아껴둔 트릭카드만 남았다면: 손패가 넘칠 때만 소모
      if(top.score>=0 || P.hand.length>4) idx=top.i;
    }
  }
  if(idx>=0){
    const n=P.hand[idx], before=P.hand.length;
    const ok=await playCardFromHand(p, idx);
    // 실패(카드가 손패에 남음)한 카드만 이번 턴 재시도 차단 — 같은 번호의 다른 사본도 같은 이유로 실패한다
    if(ok===false && P.hand.length===before) BOT.tried.add('h'+n);
    return;
  }
  // 2) 챔피언 존 플레이
  if(P.champInZone && !BOT.tried.has('champ') && costOf(card(P.champN))<=ready){
    const ok=await playCardFromHand(p, -1, {champZone:true});
    if(ok===false && P.champInZone) BOT.tried.add('champ');
    return;
  }
  // 3) 이동 (쉬움/보통: 턴당 1회, 어려움: 2회 — 빈 전장 점거 + 본대 공격의 두 갈래 압박)
  if(BOT.movesTC!==G.turnCount){ BOT.movesTC=G.turnCount; BOT.movesLeft=botHard()?2:1; }
  if(BOT.movesLeft>0){
    const mv=botSmart()?botMovePlanSmart(p):botMovePlanEasy(p);
    if(mv){
      BOT.movesLeft--;
      await moveUnits(p, mv.units, mv.dest);
      return;
    }
    BOT.movesLeft=0;
  }
  // 4) 할 게 없으면 턴 종료
  await endTurn();
}

// 쉬움: 기존 랜덤봇 이동
function botMovePlanEasy(p){
  const movable=G.players[p].base.filter(u=>!u.ex && !u.stunned);
  if(!movable.length) return null;
  if(Math.random()<0.4) return null;
  const units=movable.filter(()=>Math.random()<0.6);
  if(!units.length) return null;
  return { units, dest:Math.floor(Math.random()*2) };
}

// 보통/어려움: 실효 위력 비교 기반 이동
function botMovePlanSmart(p){
  const movable=G.players[p].base.filter(u=>!u.ex && !u.stunned);
  if(!movable.length) return null;
  const o=opp(p);
  const atkM=us=>us.reduce((s,u)=>s+might(u,'attacker'),0);
  const info=[0,1].map(i=>{
    const us=unitsAt(i);
    return {
      i,
      mine: us.filter(u=>u.ctrl===p),
      foes: us.filter(u=>u.ctrl!==p),
      foeDef: us.filter(u=>u.ctrl!==p).reduce((s,u)=>s+might(u,'defender'),0),
      ctrl: G.bfs[i].controller,
    };
  });
  // 공격 마진: 대등 교환도 정복 1점 때문에 공격측 이득 → 어려움은 동수부터 공격.
  // 상대가 리썰 레인지(승점-2)면 홀드 득점을 끊어야 하므로 약간 불리해도 견제.
  let margin = botHard()?0:1;
  if(botHard() && G.players[o].points>=G.victory-2) margin=-2;

  // 1) 빈 무주공산 전장 점거 (최소 병력 — 무료 점수 압박)
  const empty=info.filter(b=>b.ctrl===null && !b.foes.length && !b.mine.length);
  if(empty.length){
    const weakestFirst=[...movable].sort((a,b)=>might(a,'attacker')-might(b,'attacker'));
    return { units: weakestFirst.slice(0, botHard()?1:2), dest: empty[0].i };
  }
  // 2) 공격: 이길 수 있는 상대 전장 중 수비가 가장 약한 곳
  const targets=info.filter(b=>b.ctrl===o || b.foes.length);
  let best=null;
  for(const t of targets){
    if(atkM(movable)>=t.foeDef+margin) { if(!best || t.foeDef<best.foeDef) best=t; }
  }
  if(best && atkM(movable)>0) return { units: movable, dest: best.i };
  // 3) 내가 통제 중이지만 비어 있는 전장에 수비 배치 (홀드 득점 유지)
  const holdable=info.filter(b=>b.ctrl===p && !b.mine.length && !b.foes.length);
  if(holdable.length){
    const weakestFirst=[...movable].sort((a,b)=>might(a,'attacker')-might(b,'attacker'));
    return { units: weakestFirst.slice(0,1), dest: holdable[0].i };
  }
  return null;
}

// ── 시작 흐름 ──
function openBotSelect(){
  const box=document.getElementById('modal-box');
  box.innerHTML=`<h3>🤖 BOT 대전</h3>
    <div style="font-size:13px;color:#9aa4bd;margin-bottom:8px">
      실제 대회 우승 덱을 연습 상대로 고를 수 있습니다. (밴 미적용 · 당시 대회 리스트 그대로)</div>
    <div style="margin-bottom:10px">
      <label style="font-size:12px;color:#8fa">내 덱</label><br>
      <select id="bot-deck" style="width:100%;padding:8px;border-radius:6px;border:1px solid #3a4a70;background:#0e1626;color:#e8e6e0;font-size:14px"></select>
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#8fa">상대(봇) 덱</label><br>
      <select id="bot-opp-deck" style="width:100%;padding:8px;border-radius:6px;border:1px solid #3a4a70;background:#0e1626;color:#e8e6e0;font-size:14px"></select>
      <div id="bot-opp-info" style="font-size:11px;color:#5a6a90;margin-top:4px;line-height:1.5"></div>
    </div>`;
  const sel=box.querySelector('#bot-deck');
  const auto=document.createElement('option');
  auto.value='auto'; auto.textContent='🎲 무작위 자동 덱';
  sel.appendChild(auto);
  DeckStore._read().forEach((d,i)=>{
    const o=document.createElement('option');
    o.value=i; o.textContent=`${d.name} (${card(d.legendN).ko})`;
    sel.appendChild(o);
  });
  if(DeckStore._read().length) sel.value='0';
  // 상대 덱: 무작위 + 대회 덱
  const osel=box.querySelector('#bot-opp-deck');
  const oauto=document.createElement('option');
  oauto.value='auto'; oauto.textContent='🎲 무작위 자동 덱';
  osel.appendChild(oauto);
  BOT_DECKS.forEach(td=>{
    const o=document.createElement('option');
    o.value=td.id; o.textContent=`🏆 [${td.place}] ${td.name}${td.tag?` — ${td.tag}`:''}`;
    osel.appendChild(o);
  });
  const info=box.querySelector('#bot-opp-info');
  const updInfo=()=>{
    const td=BOT_DECKS.find(x=>x.id===osel.value);
    info.textContent = td ? `${td.event}` : '전설 무작위 + 자동 구성 덱';
  };
  osel.onchange=updInfo; updInfo();
  const btns=document.createElement('div'); btns.className='modal-btns';
  btns.style.flexDirection='column';
  BOT_LEVELS.forEach(lv=>{
    const b=document.createElement('button'); b.className='primary';
    b.innerHTML=`${lv.name} — <span style="font-weight:normal;font-size:12px">${lv.desc}</span>`;
    b.onclick=()=>{
      const my=botMyDeck();
      const oppDeck=botOppDeck(osel.value);
      closeModal();
      startBotGame(lv, my, oppDeck);
    };
    btns.appendChild(b);
  });
  const cancel=document.createElement('button'); cancel.textContent='취소';
  // 게임 종료 후 진입한 경우: 취소하면 끝난 게임 화면에 갇히지 않게 처음으로
  cancel.onclick=()=>{ if(typeof G!=='undefined' && G && G.winner!==null) location.reload(); else closeModal(); };
  btns.appendChild(cancel);
  box.appendChild(btns);
  openModal();
  // 게임 종료 후 재대결 선택 중에는 뒤로 가기로 닫으면 조작 불가 화면에 갇히므로 제외
  if(!(typeof G!=='undefined' && G && G.winner!==null)) markModalDismissable();
}

// 모달의 선택값 → 내 덱 객체 {legendN, champN, main, runes, bfs}
function botMyDeck(){
  const v=document.getElementById('bot-deck').value;
  if(v==='auto'){
    const l=botRand(legendList());
    const d=buildDeck(l.n);
    return { name:'자동 덱', legendN:l.n, champN:d.champN, main:d.deck.slice(0,40), runes:d.runes, bfs:d.bfs };
  }
  return DeckStore._read()[+v];
}
// 상대(봇) 덱: 무작위 자동 또는 대회 덱
function botOppDeck(v){
  if(v==='auto'){
    const l=botRand(legendList());
    const d=buildDeck(l.n);
    return { name:'무작위 자동 덱', legendN:l.n, champN:d.champN, main:d.deck, runes:d.runes, bfs:d.bfs };
  }
  const td=BOT_DECKS.find(x=>x.id===v);
  return { name:td.name, event:td.event, legendN:td.legendN, champN:td.champN, main:[...td.main], runes:[...td.runes], bfs:[...td.bfs] };
}

function startBotGame(level, myDeck, oppDeck){
  NET.online=false; NET.seat=null;
  newGame({
    manual: false, // BOT 대전은 규칙 자동 처리 필요
    players:[
      { name:'나', legendN:myDeck.legendN, champN:myDeck.champN, deck:myDeck.main, runes:myDeck.runes },
      { name:`봇(${level.name.replace(/^\S+ /,'')})`, legendN:oppDeck.legendN, champN:oppDeck.champN, deck:oppDeck.main, runes:oppDeck.runes },
    ],
    bfs:[ botRand(myDeck.bfs), botRand(oppDeck.bfs) ],
  });
  BOT.active=true; BOT.level=level.id;
  BOT.tried=new Set(); BOT.lastTC=-1; BOT.movesTC=-1; BOT.movesLeft=0; BOT.sdSeen=null; BOT.busy=false;
  showScreen('game-screen');
  document.getElementById('net-info').textContent=`🤖 BOT 대전 — ${level.name} · ${oppDeck.name}`;
  UI.log(`BOT 대전 시작! 내 덱: ${myDeck.name} / 상대: ${oppDeck.name} (${level.name})`, 'sys');
  if(oppDeck.event) UI.log(`🏆 상대 덱은 실제 대회 덱입니다 — ${oppDeck.event}`, 'sys');
  mulliganPhase().then(()=>startTurn());
}

window.addEventListener('DOMContentLoaded', ()=>{
  const btn=document.getElementById('btn-bot');
  if(btn) btn.onclick=openBotSelect;
});
