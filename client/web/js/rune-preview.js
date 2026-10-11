// 명시적으로 확인용 주소를 연 경우에만 실제 전장 효과를 재현한다.
(() => {
  const mode=new URLSearchParams(location.search).get('preview');
  if(!['forced-rune-recycle','divine-judgment','sabotage','mindsplitter','vision','vision-play','deck-look'].includes(mode)) return;
  const choice=['vision','vision-play'].includes(mode)?mode:mode==='forced-rune-recycle'?new URLSearchParams(location.search).get('choice'):null;
  const judgment=mode==='divine-judgment'||choice==='keep';
  const enemyPick=mode==='sabotage'?156:mode==='mindsplitter'?192:null;
  const deckLookCard=mode==='deck-look'?({support:62,deceit:183,future:115,hook:242,candle:291,aurora:160,teemo:121}[new URLSearchParams(location.search).get('card')]||183):null;
  const onlinePreview=[121,160].includes(deckLookCard)&&new URLSearchParams(location.search).get('online')==='1';
  const tenAuroraSpells=deckLookCard===160&&new URLSearchParams(location.search).get('spells')==='10';
  async function start(onlineStart){
    if(onlinePreview&&!onlineStart){
      UI.onlineRevealPreviewDeck={name:card(deckLookCard).ko+' 온라인 확인',legendN:TUT_P0.legendN,champN:TUT_P0.champN,
        main:tutDeck(TUT_P0),runes:TUT_P0.runeTop.slice(),bfs:[287,297,280]};
      // Normal P2P version checking rejects different preview scenarios.
      const version=NET.clientVersion();NET.clientVersion=()=>version+'-r'+deckLookCard+(tenAuroraSpells?'-10':'');
      UI.startOnlineRevealPreview=m=>start(m).catch(showError);
      showScreen('p2p-screen');
      document.getElementById('p2p-nick').value=card(deckLookCard).ko+' 확인';
      const decks=document.getElementById('p2p-deck');decks.innerHTML='';
      const option=document.createElement('option');option.textContent=UI.onlineRevealPreviewDeck.name;decks.appendChild(option);decks.disabled=true;
      document.getElementById('p2p-auto').checked=true;document.getElementById('p2p-auto').disabled=true;
      document.getElementById('p2p-ban').checked=false;
      document.getElementById('btn-p2p-back').onclick=()=>location.assign(location.pathname);
      document.getElementById('p2p-host-status').textContent='양쪽에서 같은 확인용 주소를 여세요. 방장: 방 코드 만들기 / 상대: 코드 입력 후 참여하기.';
      return;
    }
    if(onlineStart){
      NET.online=true;NET.seat=onlineStart.yourSeat;NET.spectating=false;
      NET.resetGameSync();NET.startPending=false;NET.leaving=false;
    }
    newGame({seed:287,first:0,manual:false,bfs:[287,297],
      players:[TUT_P0,TUT_P1].map((deck,p)=>({
        name:onlineStart?onlineStart.players[p].id:p?'확인용 상대':'확인용 플레이어',legendN:deck.legendN,champN:deck.champN,
        deck:tutDeck(deck),runes:deck.runeTop,
      }))});
    // 확인용 게임은 기록하거나 제출하지 않는다. 튜토리얼/봇/턴 진행도 시작하지 않는다.
    REPLAY.recording=false; REPLAY.rec=null;
    G.phase='action'; G.turnCount=1;
    const P=G.players[0];
    P.runeDeck=[...TUT_P0.runeTop];
    P.runes=[false,true,true,false].map(ex=>({n:P.runeDeck.shift(),ex}));
    G.bfs[0].controller=0;
    G.bfs[0].units.push(makeUnit(210,0,{loc:0,ready:true}));
    if(choice==='guns-blazing'){
      G.bfs[0].units.push(makeUnit(12,1,{loc:0,ready:true}));
      const pool=new URLSearchParams(location.search).get('pool');
      if(pool==='mixed'){P.power.Fury=2;P.power.Order=1;}
      else P.power.Any=Number(pool==='1');
      if(new URLSearchParams(location.search).get('runes')==='0') P.runes=[];
    }
    if(!judgment && new URLSearchParams(location.search).get('runes')==='many'){
      while(P.runeDeck.length) P.runes.push({n:P.runeDeck.shift(),ex:true});
    }
    if(judgment){
      for(const [p,deck] of [TUT_P0,TUT_P1].entries()){
        const player=G.players[p];
        player.runeDeck=[...deck.runeTop];
        player.runes=[false,true,true,false].map(ex=>({n:player.runeDeck.shift(),ex}));
        player.base=[makeUnit(210,p,{loc:'base',ready:true}),makeUnit(12,p,{loc:'base',ready:true})];
        player.gear=[17,32].map(n=>({n,ex:false,attachedTo:null}));
        if(choice==='keep'){player.base=[];player.gear=[];player.hand=[];}
      }
      G.bfs[0].units=[]; G.bfs[0].controller=null;
    }
    if(new URLSearchParams(location.search).get('units')==='many'){
      for(const p of [0,1]) for(let i=0;i<8;i++) G.bfs[0].units.push(makeUnit(i%2?12:210,p,{loc:0,ready:i%3!==0}));
    }
    if(choice==='mixed'){
      G.bfs[0].units[0].ex=true;
      P.gear=[{n:17,ex:true,attachedTo:null}];P.legendEx=true;
    }
    if(choice==='reaction'){
      P.hand=[46,45,9];P.energy=10;P.power.Calm=3;
      G.players[1].hand=[];G.turn=G.actingPlayer=1;
      G.bfs[0].units[0].ex=true;
    }
    if(choice==='hide') P.hand=[213];
    if(choice==='vision') P.deck[0]=9;
    if(choice==='vision-play'){
      P.hand=[235,9,210,12];P.deck[0]=9;P.energy=10;P.power.Order=3;
      G.players[1].hand=[];
    }
    if(deckLookCard){
      G.players.forEach(player=>{player.deck.splice(0,5,210,9,17,235,12);player.energy=20;player.power.Order=3;player.power.Fury=3;});
      G.players[1].hand=[];
    }
    if([121,160].includes(deckLookCard)) P.deck.splice(0,5,9,17,213,12,210);
    if(tenAuroraSpells) P.deck.splice(0,11,4,5,8,9,14,22,24,25,29,33,12);
    if(deckLookCard===121){
      G.bfs[0].units.push(makeUnit(121,0,{loc:0,ready:true}),makeUnit(12,1,{loc:0,ready:true}));
    }
    if(enemyPick) G.players[1].hand=new URLSearchParams(location.search).get('hand')==='many'
      ?[210,9,17,12,32,156,244,213,9,17,210,12]:[210,9,17,12];
    showScreen('game-screen');
    document.getElementById('net-info').textContent=enemyPick?'확인용 — '+card(enemyPick).ko:judgment?'확인용 — 신성한 심판':choice==='guns-blazing'?'확인용 — 쌍권총 난사':choice==='ready'?'확인용 — 룬 두 개 준비':choice==='mixed'?'확인용 — 유닛·도구·전설·룬 준비 선택':choice==='recycle-two'?'확인용 — 룬 두 개 재활용':'확인용 — 폭풍의 인장 강제 룬 재활용';
    if(choice==='reaction') document.getElementById('net-info').textContent='확인용 — 상대 주문에 드래그로 반응';
    if(choice==='hide') document.getElementById('net-info').textContent='확인용 — 숨김 비용 룬 선택';
    if(choice==='vision') document.getElementById('net-info').textContent='확인용 — 통찰로 덱 맨 위 카드 확인';
    if(choice==='vision-play') document.getElementById('net-info').textContent='확인용 — 카르마를 내서 통찰 사용';
    if(deckLookCard) document.getElementById('net-info').textContent='확인용 — '+card(deckLookCard).ko;
    UI.render();
    UI.prompt(enemyPick?'공개된 상대 손패에서 강조된 카드 한 장을 선택하세요.':judgment?'신성한 심판 해결: 양쪽 플레이어의 남길 유닛, 도구, 룬, 손패를 차례로 선택하세요.':'룬을 고른 뒤 확인하세요. 확인 전에는 룬과 자원이 바뀌지 않습니다.');
    if(choice==='vision') UI.prompt('덱 맨 위 카드 한 장을 확인하고 유지하거나 덱 아래로 보내세요.');
    if(deckLookCard) UI.prompt('확인한 카드 중 사용할 카드 한 장을 고르세요.');
    if(deckLookCard===291) UI.prompt('덱 아래로 보낼 카드를 원하는 만큼 고른 뒤 확인하세요. 선택하지 않은 카드는 덱 위에 남습니다.');
    if(deckLookCard===121) UI.prompt('피해를 줄 적 유닛을 고르면 공개 후 자동으로 효과를 처리합니다.');
    if(deckLookCard===160) UI.prompt('덱 위 카드를 차례로 공개한 뒤 자동으로 유닛 플레이를 진행합니다.');
    if(onlineStart){
      G.turnOrderDone=true;
      if(deckLookCard===160){
        P.gear.push({n:160,ex:false,attachedTo:null});
      }else{
        G.turn=G.actingPlayer=1;
        const attacker=G.bfs[0].units.find(u=>u.ctrl===1);
        G.bfs[0].units.splice(G.bfs[0].units.indexOf(attacker),1);
        attacker.loc='base';G.players[1].base.push(attacker);
      }
      UI.render();
      document.getElementById('net-info').textContent='P2P 온라인 확인 — '+card(deckLookCard).ko+' · 좌석 '+NET.seat;
      UI.prompt(deckLookCard===160?'방장(좌석 0)이 턴 종료를 누르면 오로라를 함께 공개합니다. 필요하면 양쪽에서 패스하세요.':'상대(좌석 1)의 기지 유닛을 티모 전장으로 이동하고 이동 적용을 누르세요. 방장이 적 유닛을 선택하면 5장을 공개합니다.');
      return;
    }
    if(choice==='vision-play'){
      UI.prompt('손패의 카르마 - 정신 집중을 기지에 플레이하세요. 통찰로 덱 맨 위의 마법공학 광선을 확인할 수 있습니다.');
      return;
    }
    const before={runes:P.runes.length,deck:P.runeDeck.length,energy:P.energy,ready:readyRunes(0).length};
    // 정복 효과의 해결 직전부터 시작해 응수/턴 진행 없이 선택창을 바로 보여 준다.
    if(deckLookCard===121){
      await execOps(FX[121].triggers.onDefend[0].ops,{p:0,bfIdx:0,n:121,unit:G.bfs[0].units.find(u=>u.n===121),kind:'effect'});
    }
    else if(deckLookCard===160){
      await execOps(FX[160].triggers.onEndTurn[0].ops,{p:0,n:160,kind:'effect'});
    }
    else if(deckLookCard===291){
      G.bfs[0].n=291;UI.render();
      await execOps(FX[291].triggers.onConquerHere[0].ops,{p:0,bfIdx:0,n:291,kind:'effect'});
    }
    else if(deckLookCard===242){
      const victim=makeUnit(12,0,{loc:'base',ready:true});P.base.push(victim);UI.render();
      await execOps(FX[242].activated[0].ops,{p:0,n:242,preAb:victim.uid,kind:'ability'});
    }
    else if(deckLookCard) await resolveSpellEffects(0,deckLookCard,FX[deckLookCard],{});
    else if(choice==='vision') await visionCheck(0);
    else if(choice==='hide') await hideCard(0,0,0);
    else if(choice==='reaction') await reactionWindow(1,card(9));
    else if(choice==='ready') await readyRunesPick(0,2,true);
    else if(choice==='guns-blazing'){
      const op={op:'gunsBlazing'};
      await execOps([op],{p:0,n:268,kind:'spell',pre:new Map([[op,{bf:0}]])});
    }
    else if(choice==='mixed') await execOps([{op:'readySomething'}],{p:0});
    else if(choice==='recycle-two') await execOps([{op:'recycleRune',n:2}],{p:0});
    else if(enemyPick===156) await resolveSpellEffects(0,156,FX[156],{});
    else if(enemyPick===192){
      const unit=makeUnit(192,0,{loc:'base',ready:false});P.base.push(unit);UI.render();
      await execOps(FX[192].triggers.onPlay[0].ops,{p:0,n:192,unit,kind:'ability'});
    }
    else if(judgment) await resolveSpellEffects(0,244,FX[244],{});
    else{
      const trigger=FX[287].triggers.onConquerHere[0];
      await withBattlefieldSource({n:287,event:'onConquerHere'},()=>
        execOps(trigger.ops,{p:0,bfIdx:0,n:287,kind:'ability'}));
    }
    UI.render();
    const result=`전개 룬 ${before.runes} → ${P.runes.length}, 룬 덱 ${before.deck} → ${P.runeDeck.length}, 에너지 ${before.energy} → ${P.energy}`;
    UI.prompt(enemyPick?card(enemyPick).ko+' 해결 완료 — 상대 손패 '+G.players[1].hand.length+'장':judgment?'신성한 심판 해결 완료: '+G.players.map(player=>`${player.name}: 유닛 ${everyUnit().filter(u=>u.ctrl===player.idx).length}, 도구 ${player.gear.length}, 룬 ${player.runes.length}, 손패 ${player.hand.length}`).join(' / '):['ready','mixed'].includes(choice)?`준비 완료: 준비된 룬 ${before.ready} → ${readyRunes(0).length}`:'재활용 완료: '+result);
    if(choice==='reaction') UI.prompt('반응 처리 완료 — 에너지 '+P.energy+', 손패 '+P.hand.length+'장');
    if(choice==='hide') UI.prompt('숨김 처리 종료 — 숨김 카드 '+G.bfs[0].hiddenCards.length+'장, 전개 룬 '+P.runes.length+'장');
    if(choice==='vision') UI.prompt('통찰 처리 완료');
    if(deckLookCard) UI.prompt(card(deckLookCard).ko+' 처리 완료');
    const buttons=document.createElement('div'); buttons.className='prompt-btns';
    const again=document.createElement('button'); again.type='button'; again.textContent='다시 열기';
    again.onclick=()=>{again.disabled=true;start().catch(showError);};
    const exit=document.createElement('button'); exit.type='button'; exit.textContent='시작 화면';
    exit.onclick=()=>location.assign(location.pathname);
    buttons.append(again,exit); document.getElementById('prompt-area').appendChild(buttons);
  }
  function showError(error){console.error(error);UI.prompt('확인용 화면을 열지 못했습니다: '+error.message);}
  window.addEventListener('DOMContentLoaded',()=>{start().catch(showError);},{once:true});
})();
