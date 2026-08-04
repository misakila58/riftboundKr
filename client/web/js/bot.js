// ══════════ BOT 대전 (연습 상대) ══════════
// 오프라인 전용. 봇이 좌석 1(P2)을 맡아 자동으로 행동한다.
// 선택 프롬프트(UI.pick*)는 봇 좌석일 때 자동 응답으로 가로챈다.
// 보통/어려움 난이도의 휴리스틱은 대회 플레이 가이드 조사 내용 기반:
//  - 멀리건: 1턴 플레이(저비용 유닛) 확보, 최악의 0~2장만 개별 교체 (learnriftbound.gg/learn/beginner/02-mulligan)
//  - 공격: 실효 위력 비교, 대등 교환도 정복 1점 때문에 공격측 이득 (riftboundzone.com battlefields-101)
//  - 두 갈래 압박: 빈 전장 점거 + 본대 공격 분리 (riftbound.zone choosing-battlefields)
//  - 리썰 플랜: 6점부터 더블 점령/홀드 셋업, 상대 리썰 레인지엔 수비·견제 (learnriftbound.gg intermediate/06-lethal-points)
//  - 결전 대응: [행동]/[반응] 트릭은 아껴뒀다가 박빙 결전에서 사용 (riftbound.zone combat-and-showdown)

const BOT = { active:false, seat:1, level:'skilled', busy:false, tried:new Set(), lastTC:-1, movesTC:-1, movesLeft:0 };

// 난이도 5단계 — 판단의 '깊이'와 '정보'로 구분한다.
//   think : 0 = 즉흥(휴리스틱만) · 1 = 한 수 앞을 실제로 두어 보고 고름 · 2 = 턴 전체를 계획(빔 서치)
//   peek  : 상대 손패·덱을 실제로 열람하는가 (마지막 티어만 — 이름에 명시해 투명하게)
//   budget: 한 수를 고르는 데 쓰는 시간 상한(ms)
const BOT_LEVELS = [
  { id:'novice',  name:'😊 초보',   think:0, peek:false, budget:0,
    desc:'무작위 위주로 둡니다. 규칙을 익히는 용도' },
  { id:'skilled', name:'🙂 중수',   think:0, peek:false, budget:0,
    desc:'대상·비용·손패를 따져 둡니다. 큰 실수는 하지 않습니다' },
  { id:'expert',  name:'😎 고수',   think:1, peek:false, budget:400,
    desc:'수를 두어 보고 결과를 비교합니다. 전투 계산과 승점 레이스를 읽습니다' },
  { id:'master',  name:'😈 초고수', think:2, peek:false, budget:900,
    desc:'턴 전체를 계획하고 상대 손패를 추정합니다' },
  { id:'oracle',  name:'👹 초고수 (내 패를 고려함)', think:2, peek:true, budget:900,
    desc:'초고수와 같되 당신의 손패와 덱을 봅니다 — 가장 강하지만 공정하지 않습니다' },
];
function botLevelDef(){ return BOT_LEVELS.find(l=>l.id===BOT.level) || BOT_LEVELS[1]; }

function botIs(p){ return BOT.active && !NET.online && p===BOT.seat; }
function botDelay(v, ms){ return new Promise(res=>setTimeout(()=>res(v), ms||400)); }
function botRand(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function botSmart(){ return BOT.level!=='novice' && BOT.level!=='easy'; }
function botHard(){ const d=botLevelDef(); return d.think>=1; }
// 봇 좌석의 판단을 시작하기 전에 정책층에 현재 난이도를 심는다
function botSync(){ if(typeof POLICY!=='undefined') POLICY.level = BOT.level; }

// ── 다른 모드가 시작되면 봇 자동 해제 ──
const _bot_newGame = newGame;
newGame = function(cfg){ BOT.active=false; return _bot_newGame(cfg); };

// ── 선택 프롬프트 자동 응답 ──
// 판단은 전부 bot-policy.js(POLICY)에 있다. 여기서는 "봇 좌석인가"만 가리고 위임한다.
// (사본을 두면 셀프플레이 러너와 반드시 어긋나므로 판단 로직을 여기에 두지 않는다)
function botWrap(name, fn){
  const orig = UI[name];
  UI[name] = function(p){
    if(botIs(p)){ botSync(); return botDelay(fn.apply(null, arguments)); }
    return orig.apply(UI, arguments);
  };
}
botWrap('pickUnitFrom', (p,c,t,o)=>POLICY.unit(p,c,t,o));
botWrap('pickOption',   (p,t,o)=>POLICY.option(p,t,o));
botWrap('confirmP',     (p,t,c)=>POLICY.confirm(p,t,c));
botWrap('pickNumber',   (p,t,mn,mx)=>POLICY.number(p,t,mn,mx));
botWrap('pickHandCard', (p,t)=>POLICY.hand(p,t));
botWrap('pickReaction', (p,t,o)=>POLICY.reaction(p,t,o));
botWrap('pickMulligan', (p)=>POLICY.mulligan(p));

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
  botSync();
  const idx = POLICY.showdownPlay(p);
  if(idx >= 0){
    const ok = await playCardFromHand(p, idx);
    if(ok !== false) return;      // 우선권 전환은 playCardFromHand 안에서 처리
  }
  await showdownPass();
}

async function botStep(){
  const p=BOT.seat, P=G.players[p];
  botSync();

  // 1) 손패 플레이 — 재시도 차단 키는 카드 번호('h'+n): 인덱스는 플레이 성공 시 시프트되므로 쓰지 않는다
  const idx = POLICY.pickPlay(p, BOT.tried);
  if(idx>=0){
    const n=P.hand[idx], before=P.hand.length;
    const ok=await playCardFromHand(p, idx);
    if(ok===false && P.hand.length===before) BOT.tried.add('h'+n);
    return;
  }
  // 2) 챔피언 존 플레이
  if(P.champInZone && !BOT.tried.has('champ') && polCanPlay(p, card(P.champN))){
    const ok=await playCardFromHand(p, -1, {champZone:true});
    if(ok===false && P.champInZone) BOT.tried.add('champ');
    return;
  }
  // 3) 이동 (빈 전장 점거 + 본대 공격의 두 갈래 압박)
  if(BOT.movesTC!==G.turnCount){ BOT.movesTC=G.turnCount; BOT.movesLeft=(typeof polTier==='function'?(polTier().moves||1):1); }
  if(BOT.movesLeft>0){
    const mv=POLICY.movePlan(p);
    if(mv){ BOT.movesLeft--; await moveUnits(p, mv.units, mv.dest); return; }
    BOT.movesLeft=0;
  }
  // 4) 할 게 없으면 턴 종료
  await endTurn();
}

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
