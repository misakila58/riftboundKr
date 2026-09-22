// ══════════ BOT 대전 (연습 상대) ══════════
// 오프라인 전용. 봇이 좌석 1(P2)을 맡아 자동으로 행동한다.
// 선택 프롬프트(UI.pick*)는 봇 좌석일 때 자동 응답으로 가로챈다.
// 보통/어려움 난이도의 휴리스틱은 대회 플레이 가이드 조사 내용 기반:
//  - 멀리건: 1턴 플레이(저비용 유닛) 확보, 최악의 0~2장만 개별 교체 (learnriftbound.gg/learn/beginner/02-mulligan)
//  - 공격: 실효 위력 비교, 대등 교환도 정복 1점 때문에 공격측 이득 (riftboundzone.com battlefields-101)
//  - 두 갈래 압박: 빈 전장 점거 + 본대 공격 분리 (riftbound.zone choosing-battlefields)
//  - 리썰 플랜: 6점부터 더블 점령/홀드 셋업, 상대 리썰 레인지엔 수비·견제 (learnriftbound.gg intermediate/06-lethal-points)
//  - 결전 대응: [행동]/[반응] 트릭은 아껴뒀다가 박빙 결전에서 사용 (riftbound.zone combat-and-showdown)

const BOT = { active:false, seat:1, level:'skilled', busy:false, ctx:{ tried:new Set(), movesLeft:0, tc:-1 } };
const BOT_ACTION_REVIEW_MS = 650;

// 난이도 5단계 — 판단의 '깊이'와 '정보'로 구분한다.
//   think : 0 = 즉흥(휴리스틱만) · 1 = 턴 플랜 탐색(폴리시 polPlanTurn) · 2 = 구식 깊은 탐색(simBest 2수) — 셀프플레이 60판 50:50으로 이득 없음(2026-09-22), 미사용
//   peek  : 상대 손패·덱을 실제로 열람하는가 (마지막 티어만 — 이름에 명시해 투명하게)
//   budget: 한 수를 고르는 데 쓰는 시간 상한(ms)
const BOT_LEVELS = [
  { id:'novice',  name:'😊 초보',   think:0, peek:false, budget:0,
    desc:'무작위 위주로 둡니다. 규칙을 익히는 용도' },
  { id:'skilled', name:'🙂 중수',   think:0, peek:false, budget:0,
    desc:'대상·비용·손패를 따져 둡니다. 큰 실수는 하지 않습니다' },
  { id:'expert',  name:'😎 고수',   think:1, peek:false, budget:2000,
    desc:'턴 전략을 두어 보고 비교합니다. 전투 계산과 승점 레이스를 읽습니다' },
  { id:'master',  name:'😈 초고수', think:1, peek:false, budget:5000,
    desc:'턴 전체와 내 결전 주문을 검토합니다. 상대 비공개 응수는 예측하지 않습니다 (수당 최대 5초)' },
  { id:'oracle',  name:'👹 초고수 (내 패를 고려함)', think:1, peek:true, budget:5000,
    desc:'초고수와 같되 당신의 손패와 덱을 봅니다 — 가장 강하지만 공정하지 않습니다' },
];
function botLevelDef(){ return BOT_LEVELS.find(l=>l.id===BOT.level) || BOT_LEVELS[1]; }

function botIs(p){ return BOT.active && !NET.online && p===BOT.seat; }
function botDelay(v, ms){ return new Promise(res=>setTimeout(()=>res(v), ms||400)); }
function botRand(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function botSmart(){ return BOT.level!=='novice' && BOT.level!=='easy'; }
function botHard(){ const d=botLevelDef(); return d.think>=1; }
// 봇 좌석의 판단을 시작하기 전에 정책층에 현재 난이도를 심는다
function botSync(){ if(typeof POLICY!=='undefined'){ POLICY.level = BOT.level;
  const d=botLevelDef(); POLICY.budget=d.budget||0; POLICY.peek=!!d.peek; } }

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
botWrap('pickUnitFrom', (p,c,t,o,x)=>POLICY.unit(p,c,t,o,x));
botWrap('pickOption',   (p,t,o)=>POLICY.option(p,t,o));
botWrap('confirmP',     (p,t,c,x)=>POLICY.confirm(p,t,c,x));
botWrap('pickNumber',   (p,t,mn,mx,x)=>POLICY.number(p,t,mn,mx,x));
botWrap('pickHandCard', (p,t)=>POLICY.hand(p,t));
botWrap('pickBuffs',    (p,t,c)=>POLICY.buffs(p,t,c));
botWrap('pickBoardOrder',(p,t,options)=>{
  const remaining=options.map((option,index)=>({option,index})), ordered=[];
  while(remaining.length){
    const pick=POLICY.option(p,t,remaining.map((x,i)=>({...x.option,v:i})));
    const at=Number.isInteger(pick)&&remaining[pick]?pick:0;
    ordered.push(remaining.splice(at,1)[0].index);
  }
  return ordered;
});
botWrap('pickReaction', (p,t,o)=>POLICY.reaction(p,t,o));
botWrap('pickMulligan', (p)=>POLICY.mulligan(p));

// 행동 결과를 먼저 보여 준 뒤 다음 판단까지 최소 관찰 시간을 보장한다.
async function botRunPaced(action){
  BOT.busy=true;
  try{ await action(); }
  catch(e){ console.error('[BOT]',e); }
  finally{
    UI.render();
    await new Promise(resolve=>setTimeout(resolve, BOT_ACTION_REVIEW_MS));
    BOT.busy=false;
  }
}

// ── 턴 드라이버 (한 번에 한 가지 행동) ──
setInterval(()=>{
  if(!BOT.active || !G || G.winner!==null || NET.online || BOT.busy) return;
  if(UI.isPicking && UI.isPicking()) return;                       // 사람이 선택 중
  if(document.getElementById('modal-overlay').style.display!=='none' || chainIsOpen()) return;

  // 결전: 봇 응답 차례 — 어려움은 박빙일 때 트릭 카드 시도 후 패스
  if(G.state==='showdown'){
    if(G.actingPlayer===BOT.seat){
      botRunPaced(botShowdown);
    }
    return;
  }
  if(G.turn!==BOT.seat || G.phase!=='action' || G.state!=='neutral') return;
  botRunPaced(botStep);
}, 900);

// 결전·턴 진행의 '무엇을 할까'는 전부 POLICY에 있다 (tools/selfplay.js와 같은 코드를 쓰기 위해서).
// 여기 남은 것은 봇 좌석 판별과 화면 갱신뿐이다.
async function botShowdown(){
  const p=BOT.seat;
  botSync();
  const act = await POLICY.showdownAction(p);
  if(act){
    const ok = await POLICY.runAction(p, act);
    if(ok !== false) return;      // 우선권 전환은 엔진(playCardFromHand/activateAbility)이 처리
  }
  await showdownPass();
}

async function botStep(){
  const p=BOT.seat;
  botSync();
  POLICY.syncCtx(BOT.ctx);
  if(await POLICY.step(p, BOT.ctx)) await endTurn();
}

const BOT_SETUP_KEY='rb_bot_setup';
let botSelectEvents;
function openBotSelect(){
  const box=document.getElementById('modal-box');
  const overlay=document.getElementById('modal-overlay');
  botSelectEvents?.abort();
  botSelectEvents=new AbortController();
  const returnFocus=document.activeElement;
  let saved;
  try{ saved=JSON.parse(localStorage.getItem(BOT_SETUP_KEY)); }catch(e){}
  const automatic={key:'auto', name:'무작위 자동 덱', detail:'레전드 무작위 · 자동 구성', deck:null};
  const mine=[automatic, ...DeckStore._read().map(d=>({key:deckToCode(d), name:d.name, detail:card(d.legendN).ko, deck:d}))];
  // 봇이 내 저장 덱으로 플레이할 수도 있다 (요청 2026-09-22) — 키는 덱 내용(deckToCode)이라 목록 순서가 바뀌어도 복원된다
  const opponents=[automatic,
    ...DeckStore._read().map(d=>({key:'mine:'+deckToCode(d), name:d.name, detail:`내 덱 · ${card(d.legendN).ko}`, deck:d, mine:true})),
    ...BOT_DECKS.map(d=>({key:d.id, name:d.name, detail:`${d.place} · ${d.tag || d.event}`, deck:d}))];
  // 목록 순번 대신 덱 내용으로 복원한다. 덱을 수정했다면 이름·레전드가 같은 덱이 하나일 때만 이어 쓴다.
  const sameName=mine.filter(c=>c.deck && c.name===saved?.myDeck?.name && c.deck.legendN===saved?.myDeck?.legendN);
  let my=mine.find(c=>c.key===saved?.myDeck?.key) || (sameName.length===1?sameName[0]:null) || (saved?automatic:(mine[1] || automatic));
  let opponent=opponents.find(c=>c.key===saved?.opponent) || automatic;
  let levelIndex=BOT_LEVELS.findIndex(l=>l.id===saved?.level);
  if(levelIndex<0) levelIndex=1;
  let notice=saved?.myDeck?.key && saved.myDeck.key!=='auto' && my===automatic
    ? '이전에 고른 내 덱이 없어 무작위 덱으로 바뀌었습니다.' : '';
  let goBack;
  const save=()=>{
    try{
      localStorage.setItem(BOT_SETUP_KEY, JSON.stringify({
        myDeck:{key:my.key, name:my.name, legendN:my.deck?.legendN}, opponent:opponent.key, level:BOT_LEVELS[levelIndex].id,
      }));
    }catch(e){
      notice='이 기기에 설정을 저장하지 못했습니다. 다음 실행 때 다시 선택해 주세요.';
      const note=box.querySelector('#bot-save-note');
      if(note) note.textContent=notice;
    }
  };
  // 게임 종료 후 진입한 경우: 취소하면 끝난 게임 화면에 갇히지 않게 처음으로
  const cancel=()=>{
    if(typeof G!=='undefined' && G && G.winner!==null){ location.reload(); return; }
    closeModal();
    if(returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  };
  const thumb=choice=>{
    const legend=choice.deck && card(choice.deck.legendN);
    return legend
      ? `<img class="bot-legend-thumb" src="${esc(cardImgUrl(legend.img,160))}" alt="${esc(legend.ko)}" loading="lazy" draggable="false">`
      : '<span class="bot-legend-thumb bot-random-thumb" aria-hidden="true">🎲</span>';
  };
  const deckButton=(choice,id,label)=>`<button type="button" id="${id}" class="bot-deck-button" aria-haspopup="dialog">
    ${thumb(choice)}<span class="bot-deck-copy"><small>${label}</small><strong>${esc(choice.name)}</strong><span>${esc(choice.detail)}</span></span>
    <span class="bot-deck-change" aria-hidden="true">변경 ›</span></button>`;
  const header=(title,kicker,description)=>`<header class="bot-dialog-header">
    <div><p class="start-panel-kicker">${kicker}</p><h3 id="bot-dialog-title">${title}</h3><p class="bot-dialog-description">${description}</p></div>
    <button type="button" class="bot-dialog-close" aria-label="${title} 닫기">×</button></header>`;
  function renderSetup(focusId='bot-deck'){
    goBack=cancel;
    box.innerHTML=`<section class="bot-dialog bot-setup-panel" role="dialog" aria-modal="true" aria-labelledby="bot-dialog-title">
      ${header('BOT 대전','PRACTICE','덱과 난이도를 고르고, 나만의 속도로 연습하세요.')}
      <div class="bot-setup-content">
        <div class="bot-deck-selections">${deckButton(my,'bot-deck','내 덱')}${deckButton(opponent,'bot-opp-deck','상대 덱')}</div>
        <section class="bot-difficulty" aria-labelledby="bot-difficulty-title">
          <h4 id="bot-difficulty-title">난이도</h4>
          <div class="bot-difficulty-controls">
            <button type="button" id="bot-level-down" aria-label="난이도 낮추기">‹</button>
            <div class="bot-level-summary" aria-live="polite"><strong id="bot-level-name"></strong><span id="bot-level-step"></span></div>
            <button type="button" id="bot-level-up" aria-label="난이도 높이기">›</button>
          </div>
          <p id="bot-level-description"></p>
        </section>
      </div>
      <p class="bot-tournament-note">대회 덱은 당시 목록 그대로 사용합니다. · 밴 미적용</p>
      <footer class="bot-dialog-footer"><p id="bot-save-note" role="status">${esc(notice || '마지막으로 고른 설정은 이 기기에 자동 저장됩니다.')}</p>
        <button type="button" id="bot-start" class="bot-start-button">대전 시작 <span aria-hidden="true">→</span></button></footer>
    </section>`;
    box.querySelector('.bot-dialog-close').onclick=cancel;
    box.querySelector('#bot-deck').onclick=()=>renderDeckPicker('mine');
    box.querySelector('#bot-opp-deck').onclick=()=>renderDeckPicker('opponent');
    const updateLevel=()=>{
      const level=BOT_LEVELS[levelIndex];
      box.querySelector('#bot-level-name').textContent=level.name;
      box.querySelector('#bot-level-step').textContent=`${levelIndex+1} / ${BOT_LEVELS.length}`;
      box.querySelector('#bot-level-description').textContent=level.desc;
      box.querySelector('#bot-level-down').disabled=levelIndex===0;
      box.querySelector('#bot-level-up').disabled=levelIndex===BOT_LEVELS.length-1;
    };
    [-1,1].forEach(delta=>{
      box.querySelector(delta<0?'#bot-level-down':'#bot-level-up').onclick=()=>{
        levelIndex=Math.max(0,Math.min(BOT_LEVELS.length-1,levelIndex+delta)); updateLevel(); save();
      };
    });
    updateLevel();
    box.querySelector('#bot-start').onclick=()=>{
      const myDeck=botMyDeck(my.deck), oppDeck=botOppDeck(opponent.key, opponent.deck);
      save(); closeModal(); startBotGame(BOT_LEVELS[levelIndex],myDeck,oppDeck);
    };
    box.scrollTop=0;
    box.querySelector('#'+focusId).focus({preventScroll:true});
  }
  function renderDeckPicker(side){
    const isMine=side==='mine', choices=isMine?mine:opponents, selected=isMine?my:opponent;
    const back=()=>renderSetup(isMine?'bot-deck':'bot-opp-deck');
    goBack=back;
    box.innerHTML=`<section class="bot-dialog bot-deck-picker" role="dialog" aria-modal="true" aria-labelledby="bot-dialog-title">
      ${header(isMine?'내 덱 선택':'상대 덱 선택','CHOOSE YOUR DECK',isMine?'이 기기에 저장된 덱에서 골라 주세요.':'내 저장 덱을 봇에게 쥐여 주거나, 대회 덱을 연습 상대로 골라 주세요.')}
      <div class="bot-deck-list" aria-label="${isMine?'내':'상대'} 덱 목록"></div>
      <footer class="bot-dialog-footer"><p>${isMine && mine.length===1?'저장된 덱이 없습니다. 시작 화면의 ‘내 덱’에서 만들어 주세요.':'덱을 누르면 선택하고 설정으로 돌아갑니다.'}</p>
        <button type="button" class="bot-back-button">설정으로 돌아가기</button></footer>
    </section>`;
    const list=box.querySelector('.bot-deck-list');
    choices.forEach(choice=>{
      const button=document.createElement('button'); button.type='button'; button.className='bot-deck-option';
      button.setAttribute('aria-pressed',String(choice===selected));
      button.innerHTML=`${thumb(choice)}<span class="bot-deck-copy"><strong>${esc(choice.name)}</strong><span>${esc(choice.detail)}</span>${!isMine && choice.deck?.event?`<small>${esc(choice.deck.event)}</small>`:''}</span><span class="bot-deck-check" aria-hidden="true">${choice===selected?'✓':'›'}</span>`;
      button.onclick=()=>{ if(isMine) my=choice; else opponent=choice; notice=''; save(); back(); };
      list.appendChild(button);
    });
    box.querySelector('.bot-dialog-close').onclick=back;
    box.querySelector('.bot-back-button').onclick=back;
    const active=list.querySelector('[aria-pressed="true"]');
    active.focus({preventScroll:true}); active.scrollIntoView({block:'nearest'});
  }
  // 팝업 안에서 키보드 초점을 유지하고, 덱 선택 중 Esc는 설정창으로 한 단계만 돌아간다.
  overlay.addEventListener('keydown',event=>{
    if(!box.querySelector('.bot-dialog')) return;
    if(event.key==='Escape'){ event.preventDefault(); event.stopPropagation(); goBack(); }
    if(event.key==='Tab'){
      const controls=[...box.querySelectorAll('button:not(:disabled)')], first=controls[0], last=controls[controls.length-1];
      if(event.shiftKey && document.activeElement===first){ event.preventDefault(); last.focus(); }
      else if(!event.shiftKey && document.activeElement===last){ event.preventDefault(); first.focus(); }
    }
  },{signal:botSelectEvents.signal});
  // 공통 모달의 바깥 클릭 정책을 덮어쓰지 않고 BOT 창에서만 한 단계 뒤로 간다.
  overlay.addEventListener('click',event=>{
    if(event.target===overlay && box.querySelector('.bot-dialog')){ event.stopImmediatePropagation(); goBack(); }
  },{capture:true,signal:botSelectEvents.signal});
  renderSetup();
  openModal();
  box.querySelector('#bot-deck').focus({preventScroll:true});
  // 게임 종료 후 재대결 선택 중에는 뒤로 가기로 닫으면 조작 불가 화면에 갇히므로 제외
  if(!(typeof G!=='undefined' && G && G.winner!==null)) markModalDismissable();
}

// 선택한 저장 덱 또는 무작위 자동 덱 → {legendN, champN, main, runes, bfs}
function botMyDeck(selected){
  if(!selected){
    const l=botRand(legendList());
    const d=buildDeck(l.n);
    return { name:'자동 덱', legendN:l.n, champN:d.champN, main:d.deck.slice(0,40), runes:d.runes, bfs:d.bfs };
  }
  return selected;
}
// 상대(봇) 덱: 무작위 자동 또는 대회 덱
function botOppDeck(v, saved){
  if(typeof v==='string' && v.startsWith('mine:') && saved)   // 내 저장 덱을 봇이 든다
    return { name:`내 덱 「${saved.name}」`, legendN:saved.legendN, champN:saved.champN, main:[...saved.main], runes:[...saved.runes], bfs:[...saved.bfs], arts:saved.arts||null };
  if(v==='auto'){
    const l=botRand(legendList());
    const d=buildDeck(l.n);
    return { name:'무작위 자동 덱', legendN:l.n, champN:d.champN, main:d.deck, runes:d.runes, bfs:d.bfs };
  }
  const td=BOT_DECKS.find(x=>x.id===v);
  return { name:td.name, event:td.event, legendN:td.legendN, champN:td.champN, main:[...td.main], runes:[...td.runes], bfs:[...td.bfs] };
}

function startBotGame(level, myDeck, oppDeck){
  if(typeof STATS!=='undefined') STATS.gameStart('bot');
  NET.online=false; NET.seat=null;
  newGame({
    manual: false, // BOT 대전은 규칙 자동 처리 필요 (선후공은 주사위 — decideFirstPlayer)
    reviewSetup: true,
    players:[
      { name:'나', legendN:myDeck.legendN, champN:myDeck.champN, deck:myDeck.main, runes:myDeck.runes },
      { name:`봇(${level.name.replace(/^\S+ /,'')})`, legendN:oppDeck.legendN, champN:oppDeck.champN, deck:oppDeck.main, runes:oppDeck.runes },
    ],
    bfs:[ botRand(myDeck.bfs), botRand(oppDeck.bfs) ],
  });
  BOT.active=true; BOT.level=level.id;
  BOT.ctx=POLICY.newCtx(); BOT.busy=false;
  UI.peekBotHand=false;        // 새 판은 항상 가린 상태로 시작한다
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
