// ══════════ BOT 대전 (테스트용) ══════════
// 오프라인 전용. 봇이 좌석 1(P2)을 맡아 자동으로 행동한다.
// 선택 프롬프트(UI.pick*)는 봇 좌석일 때 자동 응답으로 가로챈다.

const BOT = { active:false, seat:1, style:null, busy:false, tried:new Set(), lastTC:-1, movedTC:-1 };

const BOT_PRESETS = [
  { id:'aggro',  name:'🗡️ 돌격봇', desc:'유닛을 내는 족족 전장으로 보내 격돌을 겁니다' },
  { id:'turtle', name:'🛡️ 수비봇', desc:'비어있는 전장만 점유하고 본진에 유닛을 모읍니다' },
  { id:'random', name:'🎲 랜덤봇', desc:'플레이·이동을 무작위로 합니다' },
];

function botIs(p){ return BOT.active && !NET.online && p===BOT.seat; }
function botDelay(v, ms){ return new Promise(res=>setTimeout(()=>res(v), ms||400)); }
function botRand(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

// ── 다른 모드가 시작되면 봇 자동 해제 ──
const _bot_newGame = newGame;
newGame = function(cfg){ BOT.active=false; return _bot_newGame(cfg); };

// ── 선택 프롬프트 자동 응답 ──
const _bot_pickUnit = UI.pickUnitFrom;
UI.pickUnitFrom = function(p, candidates, promptText, optional){
  if(botIs(p)){
    if(!candidates.length) return Promise.resolve(null);
    return botDelay(optional && Math.random()<0.2 ? null : botRand(candidates));
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
const _bot_pickHand = UI.pickHandCard;
UI.pickHandCard = function(p, title){
  if(botIs(p)){
    const h=G.players[p].hand;
    return botDelay(h.length ? Math.floor(Math.random()*h.length) : null);
  }
  return _bot_pickHand.apply(UI, arguments);
};

// ── 턴 드라이버 (900ms마다 한 가지 행동) ──
setInterval(()=>{
  if(!BOT.active || !G || G.winner || NET.online || BOT.busy) return;
  if(UI.isPicking && UI.isPicking()) return;                       // 사람이 선택 중
  if(document.getElementById('modal-overlay').style.display!=='none') return;
  if(BOT.lastTC!==G.turnCount){ BOT.lastTC=G.turnCount; BOT.tried.clear(); }

  // 격돌: 봇 응답 차례면 패스
  if(G.state==='showdown'){
    if(G.actingPlayer===BOT.seat){
      BOT.busy=true;
      Promise.resolve(showdownPass()).finally(()=>{ BOT.busy=false; UI.render(); });
    }
    return;
  }
  if(G.turn!==BOT.seat || G.phase!=='action' || G.state!=='neutral') return;
  BOT.busy=true;
  botStep().catch(e=>console.error('[BOT]',e)).finally(()=>{ BOT.busy=false; UI.render(); });
}, 900);

async function botStep(){
  const p=BOT.seat, P=G.players[p];
  const ready=readyRunes(p).length;
  const costOf=c=>(c.e||0)+powerPips(c).length;

  // 1) 손패 플레이 (지불 가능해 보이는 첫 카드, 랜덤봇은 60%만)
  const idx=P.hand.findIndex((n,i)=>{
    if(BOT.tried.has('h'+i)) return false;
    if(BOT.style==='random' && Math.random()<0.4) return false;
    return costOf(card(n))<=ready;
  });
  if(idx>=0){
    BOT.tried.add('h'+idx);
    await playCardFromHand(p, idx);
    return;
  }
  // 2) 챔피언 존 플레이
  if(P.champInZone && !BOT.tried.has('champ') && costOf(card(P.champN))<=ready){
    BOT.tried.add('champ');
    await playCardFromHand(p, -1, {champZone:true});
    return;
  }
  // 3) 이동 (턴당 1회)
  if(BOT.movedTC!==G.turnCount){
    const mv=botMovePlan(p);
    if(mv){
      BOT.movedTC=G.turnCount;
      await moveUnits(p, mv.units, mv.dest);
      return;
    }
    BOT.movedTC=G.turnCount;
  }
  // 4) 할 게 없으면 턴 종료
  await endTurn();
}

function botMovePlan(p){
  const movable=G.players[p].base.filter(u=>!u.ex && !u.stunned);
  if(!movable.length) return null;
  const hostile=[0,1].filter(i=>G.bfs[i].controller===opp(p) || unitsAt(i).some(u=>u.ctrl!==p));
  const empty=[0,1].filter(i=>G.bfs[i].controller===null && !unitsAt(i).length);
  switch(BOT.style){
    case 'aggro':
      return { units:movable, dest: hostile.length?botRand(hostile) : empty.length?botRand(empty) : Math.floor(Math.random()*2) };
    case 'turtle':
      if(!empty.length) return null;
      return { units:movable.slice(0,2), dest:botRand(empty) };
    case 'random': {
      if(Math.random()<0.4) return null;
      const units=movable.filter(()=>Math.random()<0.6);
      if(!units.length) return null;
      return { units, dest:Math.floor(Math.random()*2) };
    }
  }
  return null;
}

// ── 시작 흐름 ──
function openBotSelect(){
  const box=document.getElementById('modal-box');
  box.innerHTML=`<h3>🤖 BOT 대전 (테스트)</h3>
    <div style="font-size:13px;color:#9aa4bd;margin-bottom:8px">
      내가 만든 덱으로 봇을 상대하며 테스트할 수 있습니다. (봇 덱은 무작위 자동 구성)</div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#8fa">내 덱</label><br>
      <select id="bot-deck" style="width:100%;padding:8px;border-radius:6px;border:1px solid #3a4a70;background:#0e1626;color:#e8e6e0;font-size:14px"></select>
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
  const saved=DeckStore._read();
  if(saved.length) sel.value='0'; // 저장 덱이 있으면 첫 덱을 기본 선택
  const btns=document.createElement('div'); btns.className='modal-btns';
  btns.style.flexDirection='column';
  BOT_PRESETS.forEach(pr=>{
    const b=document.createElement('button'); b.className='primary';
    b.innerHTML=`${pr.name} — <span style="font-weight:normal;font-size:12px">${pr.desc}</span>`;
    b.onclick=()=>{ const my=botMyDeck(); closeModal(); startBotGame(pr, my); };
    btns.appendChild(b);
  });
  const cancel=document.createElement('button'); cancel.textContent='취소';
  cancel.onclick=()=>closeModal();
  btns.appendChild(cancel);
  box.appendChild(btns);
  openModal();
}

// 모달의 선택값 → 덱 객체 {legendN, champN, main, runes, bfs}
function botMyDeck(){
  const v=document.getElementById('bot-deck').value;
  if(v==='auto'){
    const l=botRand(legendList());
    const d=buildDeck(l.n);
    return { name:'자동 덱', legendN:l.n, champN:d.champN, main:d.deck.slice(0,40), runes:d.runes, bfs:d.bfs };
  }
  return DeckStore._read()[+v];
}

function startBotGame(preset, myDeck){
  NET.online=false; NET.seat=null;
  const lb=botRand(legendList()).n;
  const db=buildDeck(lb);
  newGame({
    players:[
      { name:'나', legendN:myDeck.legendN, champN:myDeck.champN, deck:myDeck.main, runes:myDeck.runes },
      { name:preset.name, legendN:lb, champN:db.champN, deck:db.deck, runes:db.runes },
    ],
    bfs:[ botRand(myDeck.bfs), db.bfs[Math.floor(Math.random()*3)] ],
  });
  BOT.active=true; BOT.style=preset.id;
  BOT.tried=new Set(); BOT.lastTC=-1; BOT.movedTC=-1; BOT.busy=false;
  showScreen('game-screen');
  document.getElementById('net-info').textContent='🤖 BOT 대전 — '+preset.name;
  UI.log(`BOT 대전 시작! 내 덱: ${myDeck.name} / 상대: ${preset.name}`, 'sys');
  startTurn();
}

window.addEventListener('DOMContentLoaded', ()=>{
  const btn=document.getElementById('btn-bot');
  if(btn) btn.onclick=openBotSelect;
});
