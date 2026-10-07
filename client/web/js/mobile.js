// ══════════ 모바일(APK) 전용: 안드로이드 뒤로 가기 처리 ══════════
// Capacitor 네이티브 환경에서만 동작 (웹/데스크톱에는 영향 없음).
// 우선순위: 카드 확대 닫기 → 컨텍스트 메뉴 닫기 → 정보성 팝업 닫기
//          → 효과 선택 대기 중이면 안내 → 아무것도 없으면 종료 확인 팝업.

(function(){
  const isNative = window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform();

  // 지금 무엇을 처리 중인지 사용자에게 알려줄 이름 (모달 제목 → 프롬프트 제목 순)
  function currentTaskName(){
    const ov=document.getElementById('modal-overlay');
    if(ov && ov.style.display!=='none'){
      const h=document.querySelector('#modal-box h3');
      if(h) return h.textContent.replace(/^[^가-힣A-Za-z0-9]+/,'').trim();
    }
    const pt=document.querySelector('#prompt-area .prompt-title');
    if(pt) return pt.textContent.trim();
    return '';
  }

  // 종료 확인 팝업 (뒤로 가기로 다시 누르면 닫힘 = dismissable)
  function askExit(){
    const box=document.getElementById('modal-box');
    box.innerHTML=`<h3>앱 종료</h3>
      <div class="modal-copy">정말 종료하시겠습니까?</div>`;
    const btns=document.createElement('div'); btns.className='modal-btns';
    const yes=document.createElement('button'); yes.className='primary'; yes.textContent='예, 종료';
    yes.onclick=()=>{
      try{ Capacitor.Plugins.App.exitApp(); }catch(e){ closeModal(); }
    };
    const no=document.createElement('button'); no.textContent='취소';
    no.onclick=closeModal;
    btns.appendChild(yes); btns.appendChild(no);
    box.appendChild(btns);
    openModal(); markModalDismissable();
  }

  function handleBack(){
    if(UI.mobileLog?.close()) return;
    // 1) 카드 확대가 열려 있으면 닫기
    const zoom=document.getElementById('card-zoom');
    if(zoom && zoom.style.display && zoom.style.display!=='none'){ UI.hideZoom(); return; }
    if(chainIsOpen()){ UI.hideChain(); return; }
    // 2) 컨텍스트 메뉴(능력/플레이 메뉴)가 열려 있으면 닫기
    const menu=document.getElementById('ctx-menu');
    if(menu && menu.style.display==='block'){ hideMenu(); return; }
    if(UI.mobileHand?.close(true)) return;
    // 3) 모달이 열려 있으면: 정보성 팝업은 닫고, 선택 대기 모달은 보호
    const ov=document.getElementById('modal-overlay');
    if(ov && ov.style.display!=='none'){
      if(ov.dataset.dismiss){ closeModal(); return; }
      const nm=currentTaskName();
      UI.toast(nm?`「${nm}」 처리 진행 중입니다 — 화면의 버튼으로 선택을 완료해 주세요`:'선택 진행 중입니다 — 화면의 버튼으로 완료해 주세요','warn');
      return;
    }
    // 3-1) 리플레이 관전 중이면 관전 종료 → 보관함으로
    if(typeof REPLAY!=='undefined' && REPLAY.viewing){ REPLAY.close(); return; }
    // 3-2) 리플레이 보관함 화면이면 이전 화면으로
    const rs=document.getElementById('replay-screen');
    if(rs && rs.style.display!=='none'){ showScreen(REPLAY._returnScreen); return; }
    // 4) 효과/선택 처리 대기 중(프롬프트 등)이면 안내
    if(typeof UI!=='undefined' && UI.isPicking && UI.isPicking()){
      const nm=currentTaskName();
      // 고를 유닛이 화면 밖에 있으면(좁은 화면에서 상대 기지 등) 강조된 첫 후보를 보이게 스크롤한다 (제보 2026-09-27: 일등항해사 대상 선택에서 진행 불가)
      try{ document.querySelector('#board .targetable')?.scrollIntoView({block:'center',behavior:'smooth'}); }catch(e){}
      UI.toast(nm?`「${nm}」 효과 처리 진행 중입니다 — 선택을 먼저 완료해 주세요`:'효과 처리 진행 중입니다 — 선택을 먼저 완료해 주세요','warn');
      return;
    }
    // 5) 아무것도 없으면 종료 확인
    askExit();
  }

  if(isNative && Capacitor.Plugins && Capacitor.Plugins.App){
    Capacitor.Plugins.App.addListener('backButton', handleBack);
  }
  window._mobileBack = handleBack;   // 시뮬레이션/디버깅용
})();

// 로그 노드는 그대로 사용해 기록, 카드 정보, 리플레이와 연결을 유지한다.
(function(){
  const media=matchMedia('(pointer:coarse) and (max-width:1100px)');
  const button=document.getElementById('btn-mobile-log'), log=document.getElementById('log');
  const tools=document.getElementById('mobile-log-tools');
  const toolsHost=tools.parentElement;
  let overlay=null, placeholder=null;
  let floating=null, drag=null, suppressClick=false;
  let userPositioned=false;
  function placeButton(x,y){
    const space=fixedLayoutSpace(0,0);
    const maxX=Math.max(8,space.width-(tools.offsetWidth||44)-8);
    const maxY=Math.max(8,space.height-(tools.offsetHeight||44)-8);
    x=Math.max(8,Math.min(maxX,x)); y=Math.max(8,Math.min(maxY,y));
    tools.style.left=x+'px'; tools.style.top=y+'px'; tools.style.right='auto';
    floating={x:(x-8)/(maxX-8||1),y:(y-8)/(maxY-8||1)};
  }
  function position(){
    const space=fixedLayoutSpace(0,0);
    const maxX=Math.max(8,space.width-(tools.offsetWidth||44)-8);
    const maxY=Math.max(8,space.height-(tools.offsetHeight||44)-8);
    if(userPositioned && floating) placeButton(8+floating.x*(maxX-8),8+floating.y*(maxY-8));
    else placeButton(document.documentElement.classList.contains('sidebar-left')?60:space.width-104,8);
    if(!overlay) return;
    overlay.style.width=space.width+'px'; overlay.style.height=space.height+'px';
    const fraction=space.width>space.height ? .48 : .88;
    overlay.firstElementChild.style.width=Math.min(360,space.width*fraction)+'px';
  }
  function close(){
    if(!overlay) return false;
    placeholder.replaceWith(log); placeholder=null;
    toolsHost.appendChild(tools);
    overlay.remove(); overlay=null;
    button.setAttribute('aria-expanded','false');
    button.setAttribute('aria-label','플레이 로그');
    UI.hideHover();
    if(media.matches && document.getElementById('game-screen').style.display!=='none') button.focus({preventScroll:true});
    return true;
  }
  function toggle(){
    if(close() || !media.matches) return;
    UI.mobileHand?.close(true); hideMenu(); UI.hideHover();
    placeholder=document.createComment('mobile log'); log.replaceWith(placeholder);
    overlay=document.createElement('div'); overlay.id='mobile-log-overlay';
    overlay.innerHTML='<section id="mobile-log-panel" role="dialog" aria-modal="true" aria-labelledby="mobile-log-title"><header><strong id="mobile-log-title">플레이 로그</strong></header></section>';
    overlay.firstElementChild.appendChild(log); document.body.appendChild(overlay);
    // 같은 버튼을 오버레이 위로 옮겨 창이 열려도 다시 누르거나 드래그할 수 있게 한다.
    overlay.appendChild(tools);
    overlay.addEventListener('click',e=>{ e.stopPropagation(); if(e.target===overlay) close(); });
    overlay.addEventListener('keydown',e=>{
      e.stopPropagation();
      if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
      if(e.key==='Tab'){ e.preventDefault(); button.focus(); }
    });
    button.setAttribute('aria-expanded','true'); button.setAttribute('aria-label','플레이 로그 닫기'); position();
    log.scrollTop=log.scrollHeight; button.focus({preventScroll:true});
  }
  button.addEventListener('click',e=>{
    if(suppressClick && e.detail>0){ suppressClick=false; return; }
    toggle();
  });
  button.addEventListener('keydown',e=>{
    if(e.key!=='Enter' && e.key!==' ') return;
    e.preventDefault(); e.stopPropagation();
    if(!e.repeat) toggle();
  });
  button.addEventListener('pointerdown',e=>{
    if(!media.matches || !e.isPrimary || e.button!==0) return;
    suppressClick=false;
    const point=fixedLayoutSpace(e.clientX,e.clientY);
    drag={id:e.pointerId,x:point.x,y:point.y,left:parseFloat(tools.style.left),top:parseFloat(tools.style.top),moved:false};
    button.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });
  button.addEventListener('pointermove',e=>{
    if(!drag || e.pointerId!==drag.id) return;
    const point=fixedLayoutSpace(e.clientX,e.clientY), dx=point.x-drag.x, dy=point.y-drag.y;
    if(!drag.moved && Math.hypot(dx,dy)<6) return;
    drag.moved=true; userPositioned=true; e.preventDefault();
    placeButton(drag.left+dx,drag.top+dy);
  });
  button.addEventListener('pointerup',e=>{
    if(!drag || e.pointerId!==drag.id) return;
    const tapped=!drag.moved;
    suppressClick=true; drag=null;
    if(tapped) toggle();
  });
  button.addEventListener('pointercancel',()=>{ drag=null; suppressClick=false; });
  media.addEventListener('change',()=>{ if(!media.matches) close(); else position(); });
  window.addEventListener('resize',position);
  position();
  UI.mobileLog={close,isOpen:()=>!!overlay,layout:position};
})();

// 모바일 웹/APK 손패와 룬: 실제 카드 노드를 펼쳐 기존 조작 경로를 유지한다.
(function(){
  const media=matchMedia('(pointer:coarse) and (max-width:1100px)');
  let opened=null, placeholder=null, layer=null, game=null, runeDraft=null;
  function eligible(p){
    return media.matches && G && handFaceUp(p) && !botHandHidable(p)
      && (!NET.online || (!NET.spectating && NET.seat===p))
      && (NET.online || p===(BOT.active?1-BOT.seat:G.actingPlayer));
  }
  const runeView=()=>!!opened?.classList.contains('runes-zone');
  const cardsIn=zone=>{
    const runes=zone.classList.contains('runes-zone');
    const cards=[...zone.querySelectorAll(runes?'[data-rune-index]':'[data-hand-index]')];
    if(runes && zone===opened){
      const recycled=document.querySelectorAll('#mobile-rune-recycled [data-rune-index]');
      for(const el of recycled) if(!cards.some(c=>c.dataset.runeIndex===el.dataset.runeIndex)) cards.push(el);
      cards.sort((a,b)=>a.dataset.runeIndex-b.dataset.runeIndex);
    }
    return cards;
  };
  function eligibleRunes(p){
    return media.matches && G && G.winner===null && G.actingPlayer===p && localControlsPlayer(p)
      && (!NET.online || !NET.spectating)
      && !NET.reconnecting && !NET.catchingUp && !NET.turnActionPending?.()
      && !replayLock() && !UI.isPicking() && !UI.spellStage && !UI.spellStageSubmitting && !pendingCombatMove();
  }
  function close(animate=false,dragIndex=null){
    if(!opened) return false;
    const hz=opened;
    const origins=UI.fx.captureHandLayout?.(hz)?.filter(x=>x.index!==dragIndex);
    if(runeView()) cardsIn(hz).forEach(el=>{
      if(!hz.contains(el) && hz.contains(el._runeHome)){
        origins?.push({index:+el.dataset.runeIndex,rect:el.getBoundingClientRect()});
        el._runeHome.appendChild(el);
      }
    });
    runeDraft?.dragCancels.forEach(cancel=>cancel());
    runeDraft=null;
    opened=null;
    hz.classList.remove('mobile-hand-open','mobile-runes-open');
    cardsIn(hz).forEach(el=>{
      el.classList.remove('mobile-hand-selected','rune-energy-preview','rune-power-preview');
      el.removeAttribute('aria-pressed');
      el.style.removeProperty('--fan-x'); el.style.removeProperty('--fan-y');
      el.style.removeProperty('--fan-angle'); el.style.removeProperty('--fan-order');
    });
    placeholder.replaceWith(hz); placeholder=null;
    layer.remove(); layer=null; game=null;
    hz.setAttribute('aria-expanded','false');
    UI.hideHover();
    render(); // 작은 손패 칸의 겹침 간격을 먼저 계산한 뒤 도착 위치를 읽는다.
    if(animate) UI.fx.handLayout?.(hz,origins);
    return true;
  }
  function layout(){
    const runes=runeView(), cards=cardsIn(opened).filter(el=>!runes || !runeDraft.picks.get(+el.dataset.runeIndex)?.power);
    if(!cards.length && !runes){ close(); return; }
    const space=fixedLayoutSpace(0,0), board=document.getElementById('board').getBoundingClientRect();
    let left=Math.max(0,fixedLayoutSpace(board.left,0).x);
    let right=Math.min(space.width,fixedLayoutSpace(board.right,0).x);
    const top=Math.max(0,fixedLayoutSpace(0,board.top).y);
    let bottom=Math.min(space.height,fixedLayoutSpace(0,board.bottom).y);
    if(runes){
      const controls=document.getElementById('mobile-rune-controls');
      const sidebar=document.getElementById('sidebar').getBoundingClientRect();
      controls.style.width=Math.min(210,Math.max(100,fixedLayoutSpace(sidebar.right,0).x-fixedLayoutSpace(sidebar.left,0).x-16))+'px';
      const recycled=document.getElementById('mobile-rune-recycled'), count=recycled.children.length;
      const runeWidth=Math.min(34,Math.max(1,recycled.clientWidth));
      const step=count>1?Math.max(0,Math.min(runeWidth*2/3,(recycled.clientWidth-runeWidth)/(count-1))):0;
      recycled.style.setProperty('--recycled-width',runeWidth+'px');
      recycled.style.setProperty('--recycled-overlap',(step-runeWidth)+'px');
      controls.style.left=Math.max(4,fixedLayoutSpace(sidebar.left,0).x+8)+'px';
      controls.style.top=Math.max(8,Math.min(space.height,fixedLayoutSpace(0,sidebar.bottom).y)-controls.offsetHeight-8)+'px';
      const rect=controls.getBoundingClientRect();
      if(space.height>space.width) bottom=Math.min(bottom,fixedLayoutSpace(0,rect.top).y-16);
      else if(rect.left+rect.width/2<(board.left+board.right)/2) left=Math.max(left,fixedLayoutSpace(rect.right,0).x+16);
      else right=Math.min(right,fixedLayoutSpace(rect.left,0).x-16);
    }
    // 전장 아래쪽 안에 펼쳐 안내/행동 버튼 영역을 가리지 않는다. 화면 배율도 반영한다.
    // 선택 시 확대와 회전까지 포함해 큰 배율의 세로 화면에서도 위쪽이 잘리지 않게 한다.
    const available=right-left, width=Math.max(1,Math.min(runes?84:108,space.height*.32,runes?(available-32)/(104/74+(cards.length-1)*.5):available-72,(bottom-top-48)*74/104/1.18));
    opened.style.setProperty('--fan-width',width+'px');
    cards.forEach((el,i)=>{
      const count=cards.length, span=runes?width*104/74:width;
      const step=count>1?Math.max(0,Math.min(runes?width*.65:width+6,(available-span-(runes?32:64))/(count-1))):0;
      const total=span+step*(count-1), t=count>1?i/(count-1)*2-1:0;
      el.style.setProperty('--fan-x',(left+(available-total)/2+(span-width)/2+step*i)+'px');
      el.style.setProperty('--fan-y',(space.height-bottom+12+(runes?0:(1-t*t)*18))+'px');
      el.style.setProperty('--fan-angle',(runes?0:t*8)+'deg');
      el.style.setProperty('--fan-order',i+1);
    });
  }
  function selectCard(el){
    const cards=cardsIn(opened);
    cards.forEach((c,i)=>{
      c.classList.toggle('mobile-hand-selected',c===el);
      c.style.setProperty('--fan-order',c===el?cards.length+1:i+1);
    });
  }
  function validRuneDraft(){
    if(!runeDraft || runeDraft.game!==G || !eligibleRunes(runeDraft.p)) return false;
    const runes=G.players[runeDraft.p].runes;
    return runes.length===runeDraft.runes.length && runes.every((r,i)=>r===runeDraft.runes[i] && !!r.ex===runeDraft.ex[i]);
  }
  function pickRune(index,kind){
    if(!validRuneDraft()) return;
    if(kind==='energy' && runeDraft.ex[index]) return;
    const pick=runeDraft.picks.get(index)||{energy:false,power:false};
    if(kind==='power'){
      pick.power=true;
      pick.energy=!runeDraft.ex[index];
    }else pick.energy=!pick.energy;
    if(pick.energy||pick.power) runeDraft.picks.set(index,pick); else runeDraft.picks.delete(index);
    UI.hideHover(); paintRuneDraft(); layout();
  }
  function returnRune(index,origin=null){
    if(!validRuneDraft() || !runeDraft.picks.get(index)?.power) return;
    const el=document.querySelector(`#mobile-rune-recycled [data-rune-index="${index}"]`);
    const rect=origin || el?.getBoundingClientRect();
    UI.fx.stopHandLayout?.(); UI.hideHover();
    runeDraft.picks.delete(index); paintRuneDraft(); layout();
    if(rect) UI.fx.handLayout?.(opened,[{index,rect}]);
  }
  function paintRuneDraft(){
    let energy=0,power=0;
    const picked=document.getElementById('mobile-rune-recycled'), cards=cardsIn(opened);
    picked.replaceChildren();
    cards.forEach(el=>{
      const index=+el.dataset.runeIndex, pick=runeDraft.picks.get(index);
      if(opened.contains(el)) el._runeHome=el.parentElement;
      el.classList.toggle('rune-energy-preview',!!pick?.energy);
      el.classList.toggle('rune-power-preview',!!pick?.power);
      el.setAttribute('aria-pressed',String(!!pick));
      if(pick?.energy) energy++;
      if(pick?.power){
        power++;
        el.setAttribute('aria-label',`${card(runeDraft.runes[index].n).ko} 룬 ${index+1} 재활용 선택 취소`);
        picked.appendChild(el);
      }else{
        el.setAttribute('aria-label',`${card(runeDraft.runes[index].n).ko}${runeDraft.ex[index]?' (탈진)':' (준비)'} — 자원 띄우기`);
        if(!opened.contains(el) && opened.contains(el._runeHome)) el._runeHome.appendChild(el);
      }
    });
    document.getElementById('mobile-rune-summary').textContent=`에너지 +${energy} / 힘 +${power}`;
    document.getElementById('mobile-rune-confirm').disabled=!energy&&!power;
  }
  function confirmRunes(){
    if(!validRuneDraft() || !runeDraft.picks.size) return;
    const p=runeDraft.p, picks=[...runeDraft.picks].sort((a,b)=>b[0]-a[0]);
    close(); hideMenu();
    // 기존 온라인 액션을 그대로 사용한다. 큰 인덱스부터 재활용해 나머지 룬의 인덱스를 보존한다.
    for(const [idx,pick] of picks){
      if(pick.energy) NET.dispatch({k:'runeFloat',p,idx,mode:'energy'},()=>runeFloat(p,idx,'energy'));
      if(pick.power) NET.dispatch({k:'runeFloat',p,idx,mode:'power'},()=>runeFloat(p,idx,'power'));
    }
  }
  function runeControls(){
    const controls=document.createElement('div'); controls.id='mobile-rune-controls';
    controls.innerHTML='<div id="mobile-rune-summary"></div><div id="mobile-rune-recycle"><span>룬 덱으로 재활용</span><div id="mobile-rune-recycled"></div></div><button id="mobile-rune-confirm" type="button" disabled>확인</button>';
    controls.querySelector('#mobile-rune-confirm').onclick=confirmRunes;
    const cancelRecycled=e=>{
      const el=e.target.closest('[data-rune-index]');
      if(!el || !validRuneDraft() || (e.type==='keydown' && e.key!=='Enter' && e.key!==' ')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      returnRune(+el.dataset.runeIndex);
    };
    controls.querySelector('#mobile-rune-recycled').addEventListener('click',cancelRecycled,true);
    controls.querySelector('#mobile-rune-recycled').addEventListener('keydown',cancelRecycled,true);
    return controls;
  }
  function open(hz,returnOrigin=null){
    close(); hideMenu(); UI.hideHover();
    const origins=UI.fx.captureHandLayout?.(hz);
    if(returnOrigin && origins){
      const origin=origins.find(x=>x.index===returnOrigin.index);
      if(origin) origin.rect=returnOrigin.rect;
    }
    placeholder=document.createElement('div');
    const runes=hz.classList.contains('runes-zone');
    placeholder.className=runes?'runes-zone mobile-runes-placeholder':'hand-zone mobile-hand-placeholder';
    if(runes) placeholder.style.height=hz.offsetHeight+'px';
    hz.replaceWith(placeholder);
    layer=document.createElement('div'); layer.id='mobile-hand-layer';
    const backdrop=document.createElement('div'); backdrop.className='mobile-hand-backdrop';
    layer.append(backdrop,hz); document.body.appendChild(layer);
    opened=hz; game=G;
    hz.classList.add(runes?'mobile-runes-open':'mobile-hand-open'); hz.setAttribute('aria-expanded','true');
    if(runes){
      runeDraft={game:G,p:+hz.id.slice(-1),runes:[...G.players[+hz.id.slice(-1)].runes],ex:G.players[+hz.id.slice(-1)].runes.map(r=>!!r.ex),picks:new Map(),dragCancels:[]};
      layer.appendChild(runeControls()); paintRuneDraft();
      render();
    }
    layout();
    UI.fx.handLayout?.(hz,origins);
  }
  function render(){
    if(opened && (game!==G || !(runeView()?validRuneDraft():eligible(+opened.id.slice(-1))) || G.winner!==null
      || UI.spellStage || document.getElementById('game-screen').style.display==='none')) close();
    if(!G) return; // 접속 직후와 첫 화면의 크기 변경에는 아직 게임 데이터가 없다.
    for(let p=0;p<2;p++){
      const rz=document.getElementById('runes-'+p), canExpand=eligibleRunes(p)&&G.players[p].runes.length>0;
      const stacked=eligible(p)&&G.players[p].runes.length>0;
      rz.classList.toggle('mobile-rune-stack',!!stacked);
      rz.classList.toggle('mobile-runes',!!canExpand);
      const ready=G.players[p].runes.filter(r=>!r.ex).length;
      if(stacked) rz.dataset.runeSummary=`준비 ${ready} / ${G.players[p].runes.length}`;
      else delete rz.dataset.runeSummary;
      if(rz!==opened) updateRuneOverlap(rz);
      if(canExpand){
        rz.setAttribute('role','button'); rz.tabIndex=0;
        rz.setAttribute('aria-label',`전개된 룬 ${G.players[p].runes.length}개, 준비 ${ready}개 펼치기`);
        rz.setAttribute('aria-expanded',String(rz===opened));
        rz.onkeydown=e=>{ if(rz!==opened && (e.key==='Enter'||e.key===' ')){e.preventDefault();open(rz);} };
      }else{
        rz.removeAttribute('role'); rz.removeAttribute('tabindex'); rz.removeAttribute('aria-label'); rz.removeAttribute('aria-expanded'); rz.onkeydown=null;
      }
      const hz=document.getElementById('hand-'+p);
      const cards=[...hz.querySelectorAll('[data-hand-index]')];
      const compact=eligible(p) && cards.length;
      const opponent=hz.classList.contains('opp') && !compact;
      hz.classList.toggle('mobile-hand',!!compact);
      hz.classList.toggle('mobile-opp-hand',!!opponent && media.matches);
      hz.classList.toggle('opponent-hand-layout',!!opponent);
      // 5칸을 항상 확보하고 6장부터 둘째 줄을 쓴다. 11장부터 한 장마다 폭을 조금씩 늘린다.
      const twoRows=opponent && cards.length>=6;
      hz.classList.toggle('opponent-two-rows',!!twoRows);
      const columns=Math.max(5,Math.ceil(cards.length/2));
      const peek=hz.querySelector('.peek-btn');
      if(peek && !media.matches){ peek.style.removeProperty('top'); peek.style.removeProperty('right'); }
      if(opponent){
        const rows=twoRows?2:1;
        const normalHeight=parseFloat(getComputedStyle(hz).getPropertyValue('--opponent-card-height'))||104;
        const availableHeight=hz.parentElement.clientHeight || normalHeight*rows+14;
        const peekSpace=!media.matches && peek?26:0;
        // 줄 수가 바뀌어도 카드 크기와 기본 폭은 바뀌지 않도록 두 줄의 높이를 기준으로 한다.
        const height=Math.max(1,Math.min(normalHeight,(availableHeight-18-peekSpace)/2));
        hz.style.setProperty('--opponent-row-height',height+'px');
        hz.style.setProperty('--opponent-hand-card-width',height*74/104+'px');
        hz.style.setProperty('--opponent-hand-rows',rows);
        hz.style.setProperty('--opponent-peek-space',peekSpace+'px');
        cards.forEach((el,i)=>{el.style.gridColumn=i%columns+1;el.style.gridRow=Math.floor(i/columns)+1;});
        const w=height*74/104;
        const normalStep=media.matches?w*2/3:w+3;
        const baseline=w+normalStep*4+8;
        const baseWidth=media.matches?Math.min(baseline,hz.parentElement.clientWidth*.32):baseline;
        const needed=baseWidth+Math.max(0,cards.length-10)*normalStep/2;
        hz.style.setProperty('--opponent-hand-width',needed+'px');
        const available=hz.clientWidth-8;
        const step=Math.max(0,Math.min(normalStep,(available-w)/(columns-1)));
        hz.style.setProperty('--opponent-hand-tracks',(columns>1?`repeat(${columns-1},${step}px) `:'')+w+'px');
        if(peek && cards.length && media.matches){
          peek.style.top=Math.max(media.matches?12:4,cards[0].offsetTop+4)+'px';
          peek.style.right=Math.max(4,hz.clientWidth-cards[0].offsetLeft-(columns-1)*step-w)+'px';
        }
      }else cards.forEach(el=>{el.style.removeProperty('grid-column');el.style.removeProperty('grid-row');});
      if(compact){
        hz.setAttribute('aria-label','손패 펼치기');
        hz.setAttribute('aria-expanded',String(hz===opened));
        // 룬처럼 겹치되 마지막 카드까지 손패 칸 안에서 터치할 수 있게 한다.
        if(hz!==opened){
          const w=cards[0].offsetWidth, available=hz.clientWidth-12;
          const step=cards.length>1?Math.max(0,Math.min(w/2,(available-w)/(cards.length-1))):0;
          hz.style.setProperty('--hand-overlap',(step-w)+'px');
        }
      }else{ hz.removeAttribute('aria-label'); hz.removeAttribute('aria-expanded'); }
    }
    if(runeView()){
      runeDraft.dragCancels.forEach(cancel=>cancel()); runeDraft.dragCancels=[];
      cardsIn(opened).forEach(el=>{
        const index=+el.dataset.runeIndex;
        if(!el.classList.contains('touch-draggable')){
          const cancel=attachTouchDrag(el,()=>validRuneDraft() && (opened.contains(el) || !!el.closest('#mobile-rune-recycled')),zone=>zone?.id==='mobile-rune-recycle',()=>pickRune(index,'power'),null,'#mobile-rune-recycle');
          el._runeDragCancel=cancel;
          el.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();pickRune(index,'energy');} };
        }
        runeDraft.dragCancels.push(el._runeDragCancel);
      });
      paintRuneDraft();
    }
    if(opened) layout();
  }
  // 접힌 손패/룬의 첫 터치에서는 카드 조작이나 길게 누르기를 시작하지 않는다.
  document.addEventListener('touchstart',e=>{
    if(runeView() && e.target.closest('#mobile-rune-recycled')) UI.fx.stopHandLayout?.();
    const hz=e.target.closest('.hand-zone.mobile-hand, .runes-zone.mobile-runes');
    if(!hz) return;
    if(hz!==opened){ e.stopImmediatePropagation(); return; }
    UI.fx.stopHandLayout?.(); // 이동 중 누르더라도 선택/드래그는 즉시 시작한다.
    const el=e.target.closest('[data-hand-index], [data-rune-index]');
    if(el && !runeView()) selectCard(el);
  },{capture:true,passive:true});
  function handleClick(e){
    if(document.body.classList.contains('modal-open')) return false;
    if(runeView() && e.target.closest('#mobile-rune-controls')) return false;
    const hz=e.target.closest('.hand-zone.mobile-hand, .runes-zone.mobile-runes');
    if(hz && hz!==opened && e.isTrusted){
      e.preventDefault(); e.stopImmediatePropagation(); open(hz); return true;
    }
    if(opened && hz===opened && e.isTrusted){
      const el=e.target.closest('[data-hand-index], [data-rune-index]');
      if(runeView()){
        e.preventDefault(); e.stopImmediatePropagation();
        if(el) pickRune(+el.dataset.runeIndex,'energy');
        return true;
      }
      if(el) selectCard(el);
    }
    if(opened && !hz && !e.target.closest('#card-zoom')){
      const outside=e.target.closest('#mobile-hand-layer');
      close(true);
      if(outside){ e.preventDefault(); e.stopImmediatePropagation(); hideMenu(); return true; }
    }
    return false;
  }
  const reflow=()=>{ UI.fx.stopHandLayout?.(); render(); };
  window.addEventListener('resize',reflow);
  media.addEventListener('change',reflow);
  UI.mobileHand={render,close,handleClick,cancelRuneDraft(){return runeView()?close(true):false;},beginDrag(el,ghost,point){
    if(runeView()){
      if(!el.closest('#mobile-rune-recycled') || !validRuneDraft()) return null;
      const index=+el.dataset.runeIndex, rect=el.getBoundingClientRect();
      const width=parseFloat(opened.style.getPropertyValue('--fan-width'))||84;
      ghost.classList.add('rune-mini','mobile-rune-face');
      ghost.style.position='fixed';
      ghost.style.opacity=el.classList.contains('exhausted')?'.55':'.95';
      ghost.style.width=width+'px'; ghost.style.height=width*104/74+'px';
      ghost.style.transformOrigin='50% 50%'; ghost.style.transform='none';
      const center=fixedLayoutSpace(rect.left+rect.width/2,rect.top+rect.height/2);
      const finger=fixedLayoutSpace(point.clientX,point.clientY), scale=el.offsetWidth/width;
      if(UI.fx.on && !matchMedia('(prefers-reduced-motion:reduce)').matches){
        const frames=Array.from({length:21},(_,i)=>{
          const t=i/20, progress=Math.log1p(9*t)/Math.log(10);
          return {offset:t,transform:`translate(${(center.x-finger.x)*(1-progress)}px,${(center.y-finger.y)*(1-progress)}px) scale(${scale+(1-scale)*progress})`};
        });
        ghost.animate(frames,{duration:110,easing:'linear'});
      }
      return {game:G,p:runeDraft.p,index,n:runeDraft.runes[index].n,rune:true};
    }
    if(!opened?.contains(el)) return null;
    const p=+opened.id.slice(-1), index=+el.dataset.handIndex;
    const drag={game:G,p,index,n:G.players[p].hand[index]};
    const matrix=new DOMMatrix(getComputedStyle(el).transform);
    const scale=Math.hypot(matrix.a,matrix.b);
    const rect=el.getBoundingClientRect();
    const center=fixedLayoutSpace(rect.left+rect.width/2,rect.top+rect.height/2);
    const finger=fixedLayoutSpace(point.clientX,point.clientY);
    const dx=center.x-finger.x, dy=center.y-finger.y;
    const dragScale=.78*.7; // 기존 드래그 카드보다 가로와 세로를 30% 더 줄인다.
    ghost.style.transition='none';
    ghost.style.transformOrigin='50% 50%';
    ghost.style.transform=`scale(${dragScale})`;
    if(UI.fx.on && !matchMedia('(prefers-reduced-motion:reduce)').matches){
      const frames=Array.from({length:21},(_,i)=>{
        const t=i/20, progress=Math.log1p(9*t)/Math.log(10);
        return {offset:t,transform:`translate(${dx*(1-progress)}px,${dy*(1-progress)}px) scale(${scale+(dragScale-scale)*progress})`};
      });
      ghost.animate(frames,{duration:110,easing:'linear'});
    }
    close(true,index);
    return drag;
  },returnForDrag(drag,ghost,cancelled=false){
    if(drag?.rune){
      if(!cancelled && drag.game===G && validRuneDraft()) returnRune(drag.index,ghost.getBoundingClientRect());
      return;
    }
    if(!drag || drag.game!==G || G.winner!==null || !eligible(drag.p)
      || G.players[drag.p].hand[drag.index]!==drag.n || UI.isPicking()
      || document.body.classList.contains('modal-open') || document.getElementById('game-screen').style.display==='none') return;
    // 취소한 카드는 작은 드래그 미리보기에서 펼친 손패 크기로 돌아온다. 게임 진행은 기다리지 않는다.
    open(document.getElementById('hand-'+drag.p),{index:drag.index,rect:ghost.getBoundingClientRect()});
  },closeForDrag(el){
    // 나머지 손패는 이동 연출로 접고, 드래그하는 카드는 미리보기만 따라간다.
    if(opened?.contains(el)) close(true,+el.dataset.handIndex);
  }};
})();
