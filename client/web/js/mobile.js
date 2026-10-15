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
    if(UI.mobileHand?.dismiss()) return;
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
  let opened=null, placeholder=null, layer=null, game=null, runeDraft=null, runeChoices=null, handChoice=null, handObserver=null;
  const picker=()=>runeDraft||handChoice||handObserver;
  const validHandObserver=()=>handObserver && handObserver===UI._revealedHandView && handObserver.game===G
    && NET.online && !NET.spectating && NET.seat===handObserver.owner
    && G._revealHand?.p===handObserver.owner && G._revealHand.by===handObserver.p
    && NET.pendingChoices[handObserver.id]?.p===handObserver.p;
  const validHandChoice=()=>handChoice && handChoice.game===G && G._revealHand?.p===handChoice.owner
    && G._revealHand.by===handChoice.p && localControlsPlayer(handChoice.p);
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
      // Keep the visible board order (ready runes first), while retaining
      // original rune indices for payment and online choices.
      const order=runeDraft.order;
      cards.sort((a,b)=>order.indexOf(+a.dataset.runeIndex)-order.indexOf(+b.dataset.runeIndex));
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
    const hz=opened, cost=runeDraft?.cost, cancelCost=cost?.resolve, cancelHand=handChoice?.resolve;
    handChoice?.dragCancels.forEach(cancel=>cancel());
    handChoice?.previewDragCancel?.();
    handChoice=null;
    handObserver=null;
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
    hz.inert=false; hz.removeAttribute('aria-hidden');
    cardsIn(hz).forEach(el=>{
      el.classList.remove('mobile-hand-selected','rune-energy-preview','rune-power-preview');
      el.classList.remove('revealed-hand-staged');
      el.classList.remove('rune-ready-preview','rune-keep-preview','rune-count-hidden');
      el.querySelector('.rune-payment-count')?.remove();
      delete el.dataset.runeGroup; el.style.removeProperty('order'); el.style.removeProperty('--rune-turn');
      el.removeAttribute('aria-pressed');
      el.style.removeProperty('--fan-x'); el.style.removeProperty('--fan-y');
      el.style.removeProperty('--fan-angle'); el.style.removeProperty('--fan-order');
    });
    placeholder.replaceWith(hz); placeholder=null;
    layer.remove(); layer=null; game=null;
    hz.setAttribute('aria-expanded','false');
    UI.hideHover();
    render(); // 작은 손패 칸의 겹침 간격을 먼저 계산한 뒤 도착 위치를 읽는다.
    if(cost?.temporary){
      hz.remove();
      if(animate) for(const p of [0,1]){
        const back=(origins||[]).filter(x=>cost.entries[x.index]?.p===p)
          .map(x=>({index:cost.entries[x.index].index,rect:x.rect}));
        UI.fx.handLayout?.(document.getElementById('runes-'+p),back);
      }
    }
    else if(animate) UI.fx.handLayout?.(hz,origins);
    cancelCost?.(cost?.choice ? cost.skip : null);
    cancelHand?.(null);
    return true;
  }
  function layout(){
    const runes=runeView(), cards=cardsIn(opened).filter(el=>!runes || !runeDraft.picks.get(+el.dataset.runeIndex)?.power);
    if(!cards.length && !runes){ close(); return; }
    const space=fixedLayoutSpace(0,0), board=document.getElementById('board').getBoundingClientRect();
    const peek=document.getElementById('mobile-rune-peek-hand');
    if(peek){
      peek.style.left=fixedLayoutSpace(board.left,0).x+'px';
      peek.style.width=(fixedLayoutSpace(board.right,0).x-fixedLayoutSpace(board.left,0).x)+'px';
    }
    let left=Math.max(0,fixedLayoutSpace(board.left,0).x);
    let right=Math.min(space.width,fixedLayoutSpace(board.right,0).x);
    const top=Math.max(0,fixedLayoutSpace(0,board.top).y);
    let bottom=Math.min(space.height,fixedLayoutSpace(0,board.bottom).y);
    if(handChoice||runes){
      const controls=document.getElementById(handChoice?'mobile-revealed-hand-controls':'mobile-rune-controls');
      const actions=document.getElementById('action-buttons').getBoundingClientRect();
      const sidebar=document.getElementById('sidebar').getBoundingClientRect();
      const start=fixedLayoutSpace(actions.left,0).x, end=fixedLayoutSpace(actions.right,0).x;
      controls.style.left=start+'px';
      controls.style.width=(end-start)+'px';
      const edge=fixedLayoutSpace(8,0).x;
      controls.style.maxHeight=Math.max(0,space.height-2*edge)+'px';
      if(runes){
        const recycled=document.getElementById('mobile-rune-recycled');
        // Keep a readable on-screen size even when the board zoom is reduced.
        // Extra cards wrap and scroll instead of hiding beneath one another.
        const targetWidth=runeDraft.cost?72:48;
        const runeWidth=Math.max(1,Math.min(fixedLayoutSpace(targetWidth,0).x-fixedLayoutSpace(0,0).x,recycled.clientWidth-8));
        recycled.style.setProperty('--recycled-width',runeWidth+'px');
        recycled.style.maxHeight=Math.min(space.height*.3,fixedLayoutSpace(0,240).y)+'px';
      }
      controls.style.top=Math.max(edge,Math.min(space.height,fixedLayoutSpace(0,sidebar.bottom).y)-controls.offsetHeight-edge)+'px';
    }
    if(runes){
      const controls=document.getElementById('mobile-rune-controls');
      const rect=controls.getBoundingClientRect();
      if(space.height>space.width) bottom=Math.min(bottom,fixedLayoutSpace(0,rect.top).y-16);
      else if(rect.left+rect.width/2<(board.left+board.right)/2) left=Math.max(left,fixedLayoutSpace(rect.right,0).x+16);
      else right=Math.min(right,fixedLayoutSpace(rect.left,0).x-16);
    }
    const owners=runes && runeDraft.cost?.choice
      ?[...new Set(runeDraft.cost.entries.filter(Boolean).map(entry=>entry.p))]:[];
    const mobileRuneWidth=window.innerWidth<=1100?fixedLayoutSpace(56,0).x-fixedLayoutSpace(0,0).x:null;
    if(owners.length>1){
      // 실제 보드의 위/아래 진영을 따라 배치한다. 온라인 좌석과 화면 반전에도 같다.
      owners.sort((a,b)=>document.getElementById('parea-'+a).getBoundingClientRect().top-document.getElementById('parea-'+b).getBoundingClientRect().top);
      const available=right-left;
      const width=Math.max(1,Math.min(mobileRuneWidth??128,space.height*.25,(available-32)/(104/74),
        (bottom-top-56)/2*74/104/1.18));
      opened.style.setProperty('--fan-width',width+'px');
      owners.forEach((owner,row)=>{
        const group=cards.filter(el=>runeDraft.cost.entries[+el.dataset.runeIndex]?.p===owner);
        const span=width*104/74, step=group.length>1?Math.max(0,Math.min(width*.65,(available-span-32)/(group.length-1))):0;
        const total=span+step*Math.max(0,group.length-1);
        const y=row===0?space.height-top-28-span:space.height-bottom+12;
        group.forEach((el,i)=>{
          el.style.setProperty('--fan-x',(left+(available-total)/2+(span-width)/2+step*i)+'px');
          el.style.setProperty('--fan-y',y+'px');
          el.style.setProperty('--fan-angle','0deg'); el.style.setProperty('--fan-order',i+1);
        });
        const label=opened.querySelector(`[data-rune-owner-label="${owner}"]`);
        if(label){label.style.left=(left+8)+'px';label.style.bottom=(y+span+4)+'px';}
      });
      return;
    }
    // 전장 아래쪽 안에 펼쳐 안내/행동 버튼 영역을 가리지 않는다. 화면 배율도 반영한다.
    // 선택 시 확대와 회전까지 포함해 큰 배율의 세로 화면에서도 위쪽이 잘리지 않게 한다.
    const available=right-left, width=Math.max(1,Math.min(runes?(mobileRuneWidth??(runeDraft.cost?128:84)):108,space.height*.32,runes?(available-32)/(104/74+(runeDraft.cost?0:(cards.length-1)*.5)):available-72,(bottom-top-48)*74/104/1.18));
    const handOwner=handChoice?.owner??handObserver?.owner;
    const upperHand=handOwner!==undefined && document.getElementById('parea-'+handOwner).getBoundingClientRect().top
      <document.getElementById('parea-'+(1-handOwner)).getBoundingClientRect().top;
    opened.style.setProperty('--fan-width',width+'px');
    cards.forEach((el,i)=>{
      const count=cards.length, span=runes?width*104/74:width;
      const step=count>1?Math.max(0,Math.min(runes?width*.65:width+6,(available-span-(runes?32:64))/(count-1))):0;
      const total=span+step*(count-1), t=count>1?i/(count-1)*2-1:0;
      el.style.setProperty('--fan-x',(left+(available-total)/2+(span-width)/2+step*i)+'px');
      el.style.setProperty('--fan-y',(upperHand?space.height-top-28-width*104/74-(1-t*t)*18:space.height-bottom+12+(runes?0:(1-t*t)*18))+'px');
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
  function stageHandChoice(index,origin=null){
    if(!validHandChoice() || !handChoice.options.some(o=>o.boardCard.index===index)) return;
    if(handChoice.selected===index){returnHandChoice();return;}
    origin=origin||opened.querySelector(`[data-hand-index="${index}"]`)?.getBoundingClientRect();
    handChoice.selected=index;
    UI.previewRevealedHandSelection?.(index);
    paintHandChoice();layout();
    if(origin){
      UI.fx.moveCard?.(handChoice.owner,G.players[handChoice.owner].hand[index],{game:G,anchor:()=>origin},'#mobile-hand-recycled .card-mini',{unit:true,handLayout:opened.id});
      UI.fx.renderMoves?.();
    }
  }
  function returnHandChoice(origin=null){
    if(!validHandChoice() || handChoice.selected===null) return;
    const index=handChoice.selected;
    origin=origin||document.querySelector('#mobile-hand-recycled .card-mini')?.getBoundingClientRect();
    handChoice.selected=null;UI.previewRevealedHandSelection?.(null);paintHandChoice();layout();
    if(origin){
      UI.fx.moveCard?.(handChoice.owner,G.players[handChoice.owner].hand[index],{game:G,anchor:()=>origin},`#${opened.id} [data-hand-index="${index}"]`,{unit:true,handLayout:opened.id});
      UI.fx.renderMoves?.();
    }
  }
  function paintHandChoice(){
    const selected=handChoice.selected;
    const target=document.getElementById('mobile-hand-recycled');
    handChoice.previewDragCancel?.();handChoice.previewDragCancel=null;
    target.replaceChildren();
    for(const el of cardsIn(opened)){
      const staged=+el.dataset.handIndex===selected;
      el.classList.toggle('revealed-hand-staged',staged);
      if(staged){
        const preview=el.cloneNode(true);
        preview.removeAttribute('data-hand-index');preview.removeAttribute('draggable');
        preview.className='card-mini mobile-hand-face';preview.removeAttribute('style');preview.style.backgroundImage=el.style.backgroundImage;
        preview.setAttribute('aria-label',el._card.ko+' — 선택 취소');preview.setAttribute('aria-disabled','false');
        preview.dataset.stagedHandIndex=String(selected);preview._card=el._card;attachZoom(preview);
        preview.onclick=()=>returnHandChoice();
        preview.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();preview.click();}};
        target.appendChild(preview);
        handChoice.previewDragCancel=attachTouchDrag(preview,
          ()=>validHandChoice() && !handChoice.peeking && handChoice.selected===selected,
          zone=>zone===opened,(_zone,_uids,origin)=>returnHandChoice(origin),null,`#${opened.id}`,()=>!!handChoice);
      }
    }
    document.getElementById('mobile-hand-confirm').disabled=selected===null;
  }
  function handChoiceControls(){
    const controls=document.createElement('div');controls.id='mobile-revealed-hand-controls';
    const action=handChoice.options[0].scriptChoice?.op.action==='discard'?'버리기':'재활용';
    const summary=document.createElement('div');summary.className='mobile-hand-choice-summary';summary.title=handChoice.title;
    const heading=document.createElement('strong');heading.textContent=handChoice.title.replace(/^상대 손패 공개\s*—\s*/,'').replace('재활용시킬','재활용할');
    const hint=document.createElement('span');hint.textContent='누르거나 드래그해 선택. 다시 누르면 취소.';
    summary.append(heading,hint);
    const zone=document.createElement('div');zone.id='mobile-hand-recycle';
    const label=document.createElement('span');label.textContent=action==='버리기'?'버릴 카드':'재활용할 카드';
    const selected=document.createElement('div');selected.id='mobile-hand-recycled';
    zone.append(label,selected);
    const confirm=document.createElement('button');confirm.id='mobile-hand-confirm';confirm.type='button';confirm.textContent='확인';confirm.title='선택한 카드 확인 (Space)';confirm.disabled=true;
    confirm.onclick=()=>{
      if(!validHandChoice() || handChoice.selected===null) return;
      const index=handChoice.options.findIndex(o=>o.boardCard.index===handChoice.selected);
      if(index<0) return;
      const view=UI._revealedHandView;
      if(view?.game===G && view.p===handChoice.p)
        view.departure={index:handChoice.selected,origin:UI.fx.captureOrigin?.('#mobile-hand-recycled .card-mini')};
      const resolve=handChoice.resolve;handChoice.resolve=null;close(true);resolve(index);
    };
    controls.append(summary,zone,confirm);return controls;
  }
  function validRuneDraft(){
    if(!runeDraft || runeDraft.game!==G) return false;
    if(runeDraft.cost){
      // 해결 중 지불(쌍권총 난사 등)은 우선권이 상대에게 있을 때도 열린다 — 연 시점의 우선권이 바뀔 때만 닫는다
      if(G.winner!==null || (!runeDraft.cost.choice && G.actingPlayer!==runeDraft.actor) || !localControlsPlayer(runeDraft.p)
        || NET.reconnecting || NET.catchingUp || replayLock()) return false;
    }else if(!eligibleRunes(runeDraft.p)) return false;
    if(runeDraft.cost?.choice) return runeDraft.cost.entries.every((entry,i)=>!entry ||
      G.players[entry.p].runes[entry.index]===entry.r && !!entry.r.ex===runeDraft.ex[i]);
    if(runeDraft.cost?.number && Object.entries(runeDraft.cost.poolAvailable).some(([dom,n])=>G.players[runeDraft.p].power[dom]!==n)) return false;
    const runes=G.players[runeDraft.p].runes;
    return runes.length===runeDraft.runes.length && runes.every((r,i)=>r===runeDraft.runes[i] && !!r.ex===runeDraft.ex[i]);
  }
  function pickPoolToken(dom,selected){
    if(!validRuneDraft() || !runeDraft.cost?.number) return;
    const cost=runeDraft.cost,count=cost.poolPicks.get(dom)||0;
    if(selected && (count>=cost.poolAvailable[dom] || cost.poolAmount+runeDraft.picks.size>=cost.max)) return;
    if(!selected && !count) return;
    const next=count+(selected?1:-1);
    if(next) cost.poolPicks.set(dom,next);else cost.poolPicks.delete(dom);
    cost.poolAmount=[...cost.poolPicks.values()].reduce((a,b)=>a+b,0);
    paintRuneDraft();layout();
    const token=cost.tokens.find(t=>t.dom===dom);
    if(UI.fx.on && !matchMedia('(prefers-reduced-motion:reduce)').matches)
      for(const el of [token.el,token.paidEl]) if(!el.hidden)
        el.animate([{transform:'scale(.88)'},{transform:'none'}],{duration:180,easing:'ease-out'});
  }
  function paintPoolTokens(){
    const cost=runeDraft.cost;
    for(const token of cost.tokens||[]){
      const selected=cost.poolPicks.get(token.dom)||0,remaining=cost.poolAvailable[token.dom]-selected;
      const name=DOMAIN_KO[token.dom]||'무색',icon=DOMAIN_ICON[token.dom]||'✳';
      token.el.textContent=icon+' '+remaining;token.el.disabled=!remaining;
      token.el.setAttribute('aria-label',`${name} 힘 ${remaining} — 1 지불 선택`);
      token.paidEl.textContent=icon+' '+selected;token.paidEl.hidden=!selected;
      token.paidEl.setAttribute('aria-label',`${name} 힘 ${selected} — 1 선택 취소`);
    }
  }
  const runeGroupKey=index=>`${runeDraft.cost?.entries?.[index]?.p??runeDraft.p}:${runeDraft.runes[index].n}`;
  function pickRune(index,kind,dragOrigin=null){
    if(!validRuneDraft()) return;
    if(runeDraft.cost?.action==='남기기'){
      if(!runeDraft.cost.entries[index]) return;
      if(runeDraft.picks.has(index)) runeDraft.picks.delete(index);
      else if(runeDraft.picks.size<runeDraft.cost.limit) runeDraft.picks.set(index,{keep:true});
      UI.hideHover(); paintRuneDraft(); return;
    }
    if(runeDraft.cost?.action==='준비'){
      if(!runeDraft.cost.entries[index]) return;
      runeDraft.cost.alternative=null;
      if(runeDraft.picks.has(index)) runeDraft.picks.delete(index);
      else if(runeDraft.picks.size<runeDraft.cost.limit) runeDraft.picks.set(index,{ready:true});
      UI.hideHover(); paintRuneDraft(); layout(); return;
    }
    const origins=(kind==='power'||runeDraft.cost?UI.fx.captureHandLayout?.(opened):null)||[];
    // A replacement also animates the previously selected rune back to the fan.
    if(runeDraft.cost) document.querySelectorAll('#mobile-rune-recycled [data-rune-index]').forEach(el=>{
      if(+el.dataset.runeIndex!==index && !el.classList.contains('rune-count-hidden')) origins.push({index:+el.dataset.runeIndex,rect:el.getBoundingClientRect()});
    });
    const origin=dragOrigin || origins?.find(x=>x.index===index)?.rect;
    if(runeDraft.cost){
      if(!runeDraft.cost.options.some(o=>o.v===index)) return;
      kind='power';
      if(runeDraft.cost.number){
        if(runeDraft.picks.has(index) || runeDraft.picks.size+runeDraft.cost.poolAmount>=runeDraft.cost.max) return;
      }else if(!runeDraft.cost.batch || runeDraft.cost.limit===1) runeDraft.picks.clear();
      else if(runeDraft.picks.size>=runeDraft.cost.limit) return;
    }
    if(kind==='energy' && runeDraft.ex[index]) return;
    const pick=runeDraft.picks.get(index)||{energy:false,power:false};
    if(kind==='power'){
      pick.power=true;
      pick.energy=!runeDraft.ex[index];
    }else pick.energy=!pick.energy;
    if(pick.energy||pick.power) runeDraft.picks.set(index,pick); else runeDraft.picks.delete(index);
    UI.hideHover(); paintRuneDraft(); layout();
    UI.fx.handLayout?.(opened,origins?.filter(x=>!runeDraft.picks.get(x.index)?.power));
    if(origin && kind==='power'){
      UI.fx.moveCard?.(runeDraft.p,runeDraft.runes[index].n,{game:G,anchor:()=>origin},`#mobile-rune-recycled [data-rune-group="${runeGroupKey(index)}"]`,{unit:true,handLayout:opened.id,keepTargetVisible:true});
      UI.fx.renderMoves?.();
    }
  }
  function returnRune(index,origin=null){
    if(!validRuneDraft() || !runeDraft.picks.get(index)?.power) return;
    const el=document.querySelector(`#mobile-rune-recycled [data-rune-index="${index}"]`);
    const groupFace=document.querySelector(`#mobile-rune-recycled [data-rune-group="${runeGroupKey(index)}"]`);
    const rect=origin || groupFace?.getBoundingClientRect() || el?.getBoundingClientRect();
    const origins=UI.fx.captureHandLayout?.(opened)||[];
    if(rect) origins.push({index,rect});
    UI.hideHover();
    runeDraft.picks.delete(index); paintRuneDraft(); layout();
    UI.fx.handLayout?.(opened,origins);
  }
  function paintRuneDraft(){
    let energy=0,power=0;
    const picked=document.getElementById('mobile-rune-recycled'), cards=cardsIn(opened);
    const previousFaces=new Map([...picked.querySelectorAll("[data-rune-group]")].map(el=>[el.dataset.runeGroup,el]));
    const groups=new Map();
    cards.forEach(el=>{
      const index=+el.dataset.runeIndex, pick=runeDraft.picks.get(index);
      if(opened.contains(el)) el._runeHome=el.parentElement;
      el.classList.toggle('rune-energy-preview',!!pick?.energy);
      el.classList.toggle('rune-power-preview',!!pick?.power);
      el.classList.toggle('rune-ready-preview',!!pick?.ready);
      el.classList.toggle('rune-keep-preview',!!pick?.keep);
      if(pick?.ready) el.style.setProperty('--rune-turn','0deg'); else el.style.removeProperty('--rune-turn');
      el.setAttribute('aria-pressed',String(!!pick));
      if(pick?.energy) energy++;
      if(pick?.power){
        power++;
        el.setAttribute('aria-label',(runeDraft.cost?.choice?runeDraft.cost.options[index].label:card(runeDraft.runes[index].n).ko)+` — 선택 취소`);
        if(el.parentElement!==picked) picked.appendChild(el);
        {
          const key=runeGroupKey(index);
          if(!groups.has(key)) groups.set(key,[]);
          groups.get(key).push(el);
        }
      }else{
        el.classList.remove('rune-count-hidden');el.querySelector('.rune-payment-count')?.remove();
        delete el.dataset.runeGroup;el.style.removeProperty('order');
        el.setAttribute('aria-label',runeDraft.cost?.choice ? runeDraft.cost.options[index].label : `${card(runeDraft.runes[index].n).ko}${runeDraft.ex[index]?' (탈진)':' (준비)'} — ${runeDraft.cost?.number?'재활용할 룬 선택':runeDraft.cost?'숨김 비용으로 재활용 선택':'자원 띄우기'}`);
        if(pick?.ready) el.setAttribute('aria-label',el.getAttribute('aria-label')+' — 준비 선택됨');
        if(pick?.keep) el.setAttribute('aria-label',el.getAttribute('aria-label')+' — 남기기 선택됨');
        if(!opened.contains(el) && opened.contains(el._runeHome)) el._runeHome.appendChild(el);
      }
    });
    const groupOrder=groups.size?[...new Set(runeDraft.order.filter(i=>runeDraft.runes[i]).map(runeGroupKey))]:[];
    for(const key of groupOrder){
      const group=groups.get(key);
      if(!group) continue;
      const previous=previousFaces.get(key);
      const face=group.includes(previous)?previous:group[0];
      face.dataset.runeGroup=key;
      face.style.order=groupOrder.indexOf(key);
      for(const el of group){
        el.classList.toggle('rune-count-hidden',el!==face);
        if(el!==face){delete el.dataset.runeGroup;el.querySelector('.rune-payment-count')?.remove();}
      }
      let badge=face.querySelector('.rune-payment-count');
      if(!badge){badge=document.createElement('span');badge.className='rune-payment-count';face.appendChild(badge);}
      const countText=group.length+'장';
      if(badge.textContent!==countText) badge.textContent=countText;
      face.setAttribute('aria-label',`${face.querySelector('.rune-choice-owner')?.textContent||''} ${card(runeDraft.runes[+face.dataset.runeIndex].n).ko} ${group.length}장 — 1장 선택 취소`.trim());
    }
    const ready=runeDraft.cost?.action==='준비';
    const alternative=ready && Number.isInteger(runeDraft.cost.alternative)?runeDraft.cost.alternative:null;
    document.querySelectorAll('#mobile-rune-alternatives [data-ready-choice]').forEach(el=>{
      el.setAttribute('aria-pressed',String(+el.dataset.readyChoice===alternative));
    });
    document.getElementById('mobile-rune-summary').textContent=ready
      ?alternative!==null?`${runeDraft.cost.options[alternative].label} — 확인을 눌러 준비합니다. 다시 누르면 선택이 취소됩니다.`
        :`준비할 룬 ${runeDraft.picks.size} / ${runeDraft.cost.limit} — 룬을 누르면 세로로 준비됩니다. 다시 누르면 선택이 취소됩니다.`
      :runeDraft.cost?.choice
      ?`${runeDraft.cost.title} — ${runeDraft.picks.size} / ${runeDraft.cost.limit} 선택. ${runeDraft.cost.action==='남기기'?'룬을 눌러 남깁니다. 다시 누르면 선택이 취소됩니다.':'룬을 누르거나 선택 영역으로 드래그하세요.'}`
      :runeDraft.cost?`숨김 비용: 힘 ${power} / 1 — 룬을 누르거나 재활용 영역으로 드래그하세요. 바깥을 누르면 취소됩니다.`:`에너지 +${energy} / 힘 +${power}`;
    if(runeDraft.cost?.number) paintPoolTokens();
    if(runeDraft.cost?.number) document.getElementById('mobile-rune-summary').textContent=
      `기존 힘 ${runeDraft.cost.poolAmount} + 룬 ${power} = 총 힘 ${power+runeDraft.cost.poolAmount} 지불. 기존 힘은 누를 때마다 1씩 이동합니다. 지불 영역의 힘이나 룬 묶음을 누르면 하나씩 돌려줍니다.`;
    document.getElementById('mobile-rune-confirm').disabled=runeDraft.cost?.number ? false : ready || runeDraft.cost?.choice && runeDraft.cost.batch
      ?runeDraft.cost.required && alternative===null && runeDraft.picks.size!==runeDraft.cost.limit
      :!energy&&!power;
  }
  function confirmRunes(){
    if(!validRuneDraft()) return;
    if(runeDraft.cost?.action==='준비' && Number.isInteger(runeDraft.cost.alternative)){
      const cost=runeDraft.cost, index=cost.alternative, resolve=cost.resolve;
      cost.resolve=null; close(true); resolve(index); return;
    }
    if(runeDraft.cost?.number){
      const cost=runeDraft.cost, amount=cost.poolAmount+runeDraft.picks.size, resolve=cost.resolve;
      if(amount<cost.min || amount>cost.max) return;
      const runes=[...runeDraft.picks.keys()];
      const pool=Object.fromEntries(cost.poolPicks);
      cost.resolve=null; close(true); resolve({amount,runes,pool}); return;
    }
    if(runeDraft.cost?.action==='준비' || runeDraft.cost?.choice && runeDraft.cost.batch){
      const cost=runeDraft.cost, selected=[...runeDraft.picks.keys()];
      if(cost.required && selected.length!==cost.limit) return;
      if(cost.batch) runeChoices={batch:cost.batch,game:G,entries:selected.map(i=>cost.entries[i])};
      const first=selected.shift(), resolve=cost.resolve; cost.resolve=null;
      if(cost.batch && runeChoices.entries.length) runeChoices.entries.shift();
      close(true); resolve(first===undefined?cost.skip:first); return;
    }
    if(!runeDraft.picks.size) return;
    if(runeDraft.cost){
      const cost=runeDraft.cost, index=[...runeDraft.picks.keys()][0];
      const choice=cost.options.findIndex(o=>o.v===index);
      const resolve=cost.resolve; cost.resolve=null; close(true); resolve(choice); return;
    }
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
    controls.innerHTML='<div id="mobile-rune-body"><div id="mobile-rune-summary"></div><div id="mobile-rune-recycle"><span>룬 덱으로 재활용</span><div id="mobile-rune-recycled"></div></div></div><button id="mobile-rune-confirm" type="button" disabled>확인</button>';
    controls.querySelector('#mobile-rune-confirm').onclick=confirmRunes;
    controls.querySelector('#mobile-rune-confirm').title='Space: 확인';
    if(runeDraft.cost?.number){
      controls.querySelector('#mobile-rune-recycle > span').textContent='힘 지불';
      const cost=runeDraft.cost;
      const pool=document.createElement('div');pool.id='mobile-rune-pool';
      const label=document.createElement('span');label.textContent='이미 있는 힘';
      const source=document.createElement('div');source.id='mobile-rune-pool-tokens';
      const paid=document.createElement('div');paid.id='mobile-rune-paid-power';
      controls.querySelector('#mobile-rune-recycle').appendChild(paid);
      pool.append(label,source);controls.querySelector('#mobile-rune-body').insertBefore(pool,controls.querySelector('#mobile-rune-recycle'));
      cost.tokens=[];
      for(const [dom,count] of Object.entries(cost.poolAvailable)) if(count>0){
        const el=document.createElement('button'),paidEl=document.createElement('button');
        for(const [button,selected] of [[el,false],[paidEl,true]]){
          button.type='button';button.className='rune-power-token';button.dataset.poolId=dom;
          button.dataset.poolSelected=String(selected);
          button.style.setProperty('--power-color',DOMAIN_COLOR[dom]||'#8ca0bc');
          button.setAttribute('aria-pressed',String(selected));
          button.onclick=()=>pickPoolToken(dom,!selected);
        }
        source.appendChild(el);paid.appendChild(paidEl);
        const attach=(button,selected)=>attachTouchDrag(button,
          ()=>validRuneDraft() && !cost.peeking && (selected?(cost.poolPicks.get(dom)||0)>0:(cost.poolPicks.get(dom)||0)<count),
          zone=>zone?.id===(selected?'mobile-rune-pool':'mobile-rune-recycle'),
          ()=>pickPoolToken(dom,!selected),null,'#mobile-rune-recycle,#mobile-rune-pool',()=>true);
        const cancel=attach(el,false),cancelPaid=attach(paidEl,true);
        cost.tokens.push({dom,el,paidEl,cancel,cancelPaid});runeDraft.dragCancels.push(cancel,cancelPaid);
      }
      if(!cost.pool) label.textContent='이미 있는 힘 없음';

    }
    if(['준비','남기기'].includes(runeDraft.cost?.action)) controls.querySelector('#mobile-rune-recycle').hidden=true;
    if(runeDraft.cost?.choice){
      controls.querySelector('#mobile-rune-recycle > span').textContent=runeDraft.cost.action==='남기기'?'남길 룬':runeDraft.cost.action+'할 룬';
      const alternatives=document.createElement('div');alternatives.id='mobile-rune-alternatives';
      runeDraft.cost.options.forEach((option,i)=>{
        if(option.runePick) return;
        // Zero selected runes already means skipping an optional ready effect.
        if(runeDraft.cost.action==='준비' && (option.v===null || option.v==='skip')) return;
        const button=document.createElement('button'); button.type='button'; button.textContent=option.label;
        if(runeDraft.cost.action==='준비'){
          const c=optionCard(option);
          button.className='mobile-ready-choice';button.dataset.readyChoice=String(i);
          button.setAttribute('aria-label',option.label);button.setAttribute('aria-pressed','false');
          if(c){
            const img=document.createElement('img');img.src=cardImgUrl(artImg(c,runeDraft.p)||c.img,160);img.alt='';
            button.prepend(img);button._card=c;attachZoom(button);
            button.onmouseenter=()=>UI.inspect(c);
          }
          button.onclick=()=>{
            if(!validRuneDraft()) return;
            const cost=runeDraft.cost;
            cost.alternative=cost.alternative===i?null:i;runeDraft.picks.clear();
            UI.hideHover();paintRuneDraft();layout();
          };
        }else button.onclick=()=>{const cost=runeDraft.cost,resolve=cost.resolve;cost.resolve=null;close(true);resolve(i);};
        alternatives.appendChild(button);
      });
      if(alternatives.childElementCount) controls.querySelector('#mobile-rune-body').appendChild(alternatives);
      if(!runeDraft.cost.required){
        if(runeDraft.cost.skip===null && runeDraft.cost.action!=='준비'){
          const skip=document.createElement('button'); skip.type='button';
          skip.textContent='선택 안 함'; skip.onclick=()=>close(true); controls.querySelector('#mobile-rune-body').appendChild(skip);
        }
      }
    }
    const cancelRecycled=e=>{
      const el=e.target.closest('[data-rune-index]');
      if(!el || !validRuneDraft() || (e.type==='keydown' && e.key!=='Enter' && e.key!==' ')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const index=+el.dataset.runeIndex;
      const selected=[...runeDraft.picks.keys()].reverse().find(i=>runeDraft.picks.get(i).power && runeGroupKey(i)===runeGroupKey(index));
      returnRune(selected);
    };
    controls.querySelector('#mobile-rune-recycled').addEventListener('click',cancelRecycled,true);
    controls.querySelector('#mobile-rune-recycled').addEventListener('keydown',cancelRecycled,true);
    return controls;
  }
  function setRunePeeking(peeking){
    const draft=picker();
    if(!draft || !layer) return;
    UI.fx.stopHandLayout?.();
    draft.peeking=peeking;
    layer.classList.toggle('rune-peeking',peeking);
    opened.inert=peeking;
    if(peeking) opened.setAttribute('aria-hidden','true'); else opened.removeAttribute('aria-hidden');
    document.getElementById('mobile-rune-peek-hand')?.remove();
    const toggle=document.getElementById('rune-visibility-toggle');
    toggle.setAttribute('aria-pressed',String(peeking));
    toggle.title=peeking?(handObserver?'내 손패 선택 보기로 돌아가기':handChoice?'상대 손패 선택으로 돌아가기':'룬 선택으로 돌아가기'):'손패와 기지 보기';
    toggle.setAttribute('aria-label',toggle.title);
    if(peeking && media.matches) showRunePeekHand(NET.online?NET.seat:UI._orient);
    UI.hideHover();
  }
  function showRunePeekHand(p){
    if(!handFaceUp(p)) return;
    const hand=document.getElementById('hand-'+p);
    const preview=document.createElement('div');preview.id='mobile-rune-peek-hand';
    preview.setAttribute('role','group');preview.setAttribute('aria-label','내 손패 확인');
    for(const source of hand.querySelectorAll('[data-hand-index]')){
      const c=card(G.players[p].hand[+source.dataset.handIndex]),el=source.cloneNode(true);
      el.removeAttribute('data-hand-index');el.classList.add('rune-peek-card');el._card=c;
      el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-label',c.ko+' 상세 보기');
      el.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();UI.showZoom(c);}};
      preview.appendChild(el);
    }
    const rect=document.getElementById('board').getBoundingClientRect();
    preview.style.left=fixedLayoutSpace(rect.left,0).x+'px';
    preview.style.width=(fixedLayoutSpace(rect.right,0).x-fixedLayoutSpace(rect.left,0).x)+'px';
    layer.appendChild(preview);
  }
  function peekRuneBoard(e){
    const panel=document.getElementById('mobile-rune-peek-hand');
    const cardEl=e.target.closest('.rune-peek-card');
    if(cardEl){ UI.showZoom(cardEl._card); return; }
    const p=NET.online?NET.seat:UI._orient;
    const hand=document.getElementById('hand-'+p);
    const hits=document.elementsFromPoint(e.clientX,e.clientY);
    if(handFaceUp(p) && hits.some(el=>el===hand || hand.contains(el))){
      if(panel){panel.remove();return;}
      showRunePeekHand(p);
      return;
    }
    panel?.remove();
    const c=peekCardAt(e.clientX,e.clientY);if(c) UI.showZoom(c);
  }
  function open(hz,returnOrigin=null,cost=null,choice=null,observer=null){
    close(); hideMenu(); UI.hideHover();
    handChoice=choice;
    handObserver=observer;
    const origins=cost?.origins||UI.fx.captureHandLayout?.(hz);
    if(returnOrigin && origins){
      const origin=origins.find(x=>x.index===returnOrigin.index);
      if(origin) origin.rect=returnOrigin.rect;
    }
    placeholder=document.createElement('div');
    const runes=hz.classList.contains('runes-zone');
    placeholder.className=runes?'runes-zone mobile-runes-placeholder':'hand-zone mobile-hand-placeholder';
    if(!runes){placeholder.style.flexBasis=hz.offsetWidth+'px';placeholder.style.height=hz.offsetHeight+'px';}
    if(runes) placeholder.style.height=hz.offsetHeight+'px';
    hz.replaceWith(placeholder);
    layer=document.createElement('div'); layer.id='mobile-hand-layer';
    const backdrop=document.createElement('div'); backdrop.className='mobile-hand-backdrop';
    if(cost||choice){layer.setAttribute('role','dialog');layer.setAttribute('aria-modal','true');layer.setAttribute('aria-label',(cost||choice).title);}
    layer.append(backdrop,hz); document.body.appendChild(layer);
    opened=hz; game=G;
    hz.classList.add(runes?'mobile-runes-open':'mobile-hand-open'); hz.setAttribute('aria-expanded','true');
    if(runes){
      const runes=cost?.choice?cost.entries.map(entry=>entry?.r||{ex:false}):G.players[+hz.id.slice(-1)].runes;
      runeDraft={game:G,p:+hz.id.slice(-1),actor:G.actingPlayer,order:[...hz.querySelectorAll('[data-rune-index]')].map(el=>+el.dataset.runeIndex),runes:[...runes],ex:runes.map(r=>!!r.ex),picks:new Map(),dragCancels:[],cost};
      layer.appendChild(runeControls()); paintRuneDraft();
    }
    if(choice){
      layer.appendChild(handChoiceControls());
    }
    if(runes||choice||observer){
      const toggle=document.getElementById('modal-visibility-toggle').cloneNode(true);
      toggle.id='rune-visibility-toggle';toggle.hidden=false;
      toggle.setAttribute('aria-pressed','false');toggle.setAttribute('aria-label','손패와 기지 보기');
      toggle.title='손패와 기지 보기';toggle.onclick=()=>setRunePeeking(!picker().peeking);
      layer.appendChild(toggle);
      render();
    }
    layout();
    UI.fx.handLayout?.(hz,origins);
  }
  function render(){
    if(opened && (game!==G || !(runeView()?validRuneDraft():handChoice?validHandChoice():handObserver?validHandObserver():eligible(+opened.id.slice(-1))) || G.winner!==null
      || (UI.spellStage && !runeDraft?.cost && !handChoice) || document.getElementById('game-screen').style.display==='none')) close();
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
      const compact=eligible(p);
      const opponent=hz.classList.contains('opp') && !compact;
      hz.classList.toggle('mobile-hand',!!compact);
      hz.classList.toggle('mobile-opp-hand',!!opponent && media.matches);
      const packed=opponent || compact && hz!==opened;
      hz.classList.toggle('opponent-hand-layout',!!packed);
      // 모바일 양쪽 손패는 같은 제한 영역에서 5칸을 확보하고 6장부터 두 줄로 배치한다.
      const twoRows=packed && cards.length>=6;
      hz.classList.toggle('opponent-two-rows',!!twoRows);
      const columns=Math.max(5,Math.ceil(cards.length/2));
      const peek=hz.querySelector('.peek-btn');
      if(peek && !media.matches){ peek.style.removeProperty('top'); peek.style.removeProperty('right'); }
      hz.style.removeProperty('flex-basis'); hz.style.removeProperty('max-width');
      hz.style.removeProperty('--hand-overlap');
      if(packed){
        const rows=twoRows?2:1;
        const normalHeight=parseFloat(getComputedStyle(hz).getPropertyValue('--opponent-card-height'))||104;
        const availableHeight=hz.parentElement.clientHeight || normalHeight*rows+14;
        const peekSpace=!media.matches && peek?26:0;
        // 모바일은 실제 손패 줄 수와 관계없이 두 줄이 들어가는 카드 크기를 유지한다.
        const handWidth=hz.parentElement.clientWidth*.32;
        const height=media.matches
          ?Math.max(1,Math.min((availableHeight-14)/2,(handWidth-8)*104/74))
          :Math.max(1,Math.min(normalHeight,(availableHeight-18-peekSpace)/2));
        if(media.matches){
          const base=hz.parentElement.querySelector('.base-zone');
          if(base) base.style.setProperty('--mobile-base-card-height',height+'px');
        }
        hz.style.setProperty('--opponent-row-height',height+'px');
        hz.style.setProperty('--opponent-hand-card-width',height*74/104+'px');
        hz.style.setProperty('--opponent-hand-rows',rows);
        hz.style.setProperty('--opponent-peek-space',peekSpace+'px');
        cards.forEach((el,i)=>{el.style.gridColumn=i%columns+1;el.style.gridRow=Math.floor(i/columns)+1;});
        const w=height*74/104;
        const normalStep=media.matches?w*2/3:w+3;
        const baseline=w+normalStep*4+8;
        const baseWidth=media.matches?Math.min(baseline,hz.parentElement.clientWidth*.32):baseline;
        const needed=media.matches?baseWidth:baseWidth+Math.max(0,cards.length-10)*normalStep/2;
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
      }else{ hz.removeAttribute('aria-label'); hz.removeAttribute('aria-expanded'); }
    }
    if(runeView()){
      runeDraft.dragCancels.forEach(cancel=>cancel()); runeDraft.dragCancels=[];
      cardsIn(opened).forEach(el=>{
        const index=+el.dataset.runeIndex;
        if(runeDraft.cost?.action==='준비'){
          el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();pickRune(index,'ready');}};
          return;
        }
        if(!el.classList.contains('touch-draggable')){
          const cancel=attachTouchDrag(el,()=>validRuneDraft() && (opened.contains(el) || !!el.closest('#mobile-rune-recycled')),zone=>zone?.id==='mobile-rune-recycle',(zone,uids,origin)=>pickRune(index,'power',origin),null,'#mobile-rune-recycle',()=>!!runeDraft?.cost);
          el._runeDragCancel=cancel;
          el.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();pickRune(index,'energy');} };
        }
        runeDraft.dragCancels.push(el._runeDragCancel);
      });
      for(const token of runeDraft.cost?.tokens||[]) runeDraft.dragCancels.push(token.cancel,token.cancelPaid);
      paintRuneDraft();
    }
    if(handChoice) for(const el of opened.querySelectorAll('[data-hand-index]')){
      const allowed=handChoice.options.some(o=>o.boardCard.index===+el.dataset.handIndex);
      el.classList.toggle('revealed-hand-unavailable',!allowed);
      el.setAttribute('aria-disabled',String(!allowed));el.setAttribute('role','button');el.tabIndex=0;
      el.setAttribute('aria-label',el._card.ko+(allowed?' — 선택':' — 선택 불가'));
      el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(allowed) stageHandChoice(+el.dataset.handIndex);else UI.showZoom(el._card);}};
      if(allowed && !el._revealedHandDragCancel){
        el._revealedHandDragCancel=attachTouchDrag(el,()=>validHandChoice() && !handChoice.peeking && opened.contains(el),
          zone=>zone?.id==='mobile-hand-recycle',(_zone,_uids,origin)=>stageHandChoice(+el.dataset.handIndex,origin),null,'#mobile-hand-recycle',()=>!!handChoice);
      }
      if(el._revealedHandDragCancel && !handChoice.dragCancels.includes(el._revealedHandDragCancel)) handChoice.dragCancels.push(el._revealedHandDragCancel);
    }
    if(handChoice) paintHandChoice();
    if(handObserver){
      selectCard(opened.querySelector(`[data-hand-index="${handObserver.selected}"]`));
      for(const el of cardsIn(opened)){
        el.draggable=false;el.setAttribute('role','button');el.tabIndex=0;
        el.setAttribute('aria-pressed',String(+el.dataset.handIndex===handObserver.selected));
        el.setAttribute('aria-label',el._card.ko+(+el.dataset.handIndex===handObserver.selected?' — 상대가 선택한 카드':' — 상대 선택 대기'));
        el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();UI.showZoom(el._card);}};
      }
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
    if(el && !runeView() && !handObserver) selectCard(el);
  },{capture:true,passive:true});
  function handleClick(e){
    if(picker() && e.target.closest('#rune-visibility-toggle')) return false;
    if(picker()?.peeking){
      if(e.target.closest('#card-zoom')) return false;
      e.preventDefault();e.stopImmediatePropagation();peekRuneBoard(e);return true;
    }
    if(handObserver){
      if(e.target.closest('#card-zoom')) return false;
      e.preventDefault();e.stopImmediatePropagation();
      const el=e.target.closest('[data-hand-index]');
      if(el && opened.contains(el) && e.altKey) UI.showZoom(el._card);
      return true;
    }
    if(handChoice){
      if(e.target.closest('#card-zoom')) return false;
      if(_suppressClick){_suppressClick=false;e.preventDefault();e.stopImmediatePropagation();return true;}
      if(UI.mobileHand.suppressDragClick){UI.mobileHand.suppressDragClick=false;e.preventDefault();e.stopImmediatePropagation();return true;}
      if(e.target.closest('#mobile-revealed-hand-controls')) return false;
      e.preventDefault();e.stopImmediatePropagation();
      if(!validHandChoice()) return true;
      const el=e.target.closest('[data-hand-index]');
      if(el && opened.contains(el)){
        const index=handChoice.options.findIndex(o=>o.boardCard.index===+el.dataset.handIndex);
        if(e.altKey) UI.showZoom(el._card);
        else if(index>=0) stageHandChoice(+el.dataset.handIndex);
        else UI.showZoom(el._card);
      }
      return true;
    }
    // Pointer capture can send the release click to the rune after it moves
    // into the recycle area. Consume it before the area's undo handler.
    if(UI.mobileHand.suppressDragClick){
      UI.mobileHand.suppressDragClick=false;
      e.preventDefault(); e.stopImmediatePropagation(); return true;
    }
    if(runeDraft?.cost){
      if(e.target.closest('#card-zoom')) return false;
      if(_suppressClick){_suppressClick=false;e.preventDefault();e.stopImmediatePropagation();return true;}
      if(e.target.closest('#mobile-rune-controls')) return false;
      e.preventDefault(); e.stopImmediatePropagation();
      if(!opened.contains(e.target)){
        if(!runeDraft.cost.required) close(true);
      }else{
        const el=e.target.closest('[data-rune-index]');
        if(el){if(e.altKey) UI.showZoom(el._card);else pickRune(+el.dataset.runeIndex,'power');}
      }
      return true;
    }
    if(document.body.classList.contains('modal-open')) return false;
    if(opened && !runeView() && e.target.closest('#ctx-menu .ctx-close')) return false;
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
  // 선택창의 [선택창 숨기기](눈 버튼)로 보드를 볼 때: 겹쳐 둔 손패는 탭해도 펼쳐지지 않으므로(모달 중 터치 차단) 내 손패를 펼쳐 보여 주고,
  // 선택창을 다시 보이면 접는다 (제보 2026-10-07: 촛불 성소 선택창에서 보드를 봐도 손패가 안 펼쳐져 뭐가 있는지 볼 수 없음)
  // 오버레이를 유지한 채 확인 동작만 전달한다. 실제 클릭/드래그는 손패에 보내지 않는다.
  function peekAt(x,y){
    if(!modalPeeking() || !media.matches) return false;
    const hits=document.elementsFromPoint(x,y);
    if(opened){
      if(runeView()) return false;
      const el=hits.find(el=>el.matches('[data-hand-index]') && opened.contains(el));
      if(el){
        selectCard(el);
        UI.showZoom(card(G.players[+opened.id.slice(-1)].hand[+el.dataset.handIndex]));
      }else close(true);
      return true;
    }
    const hz=hits.map(el=>el.closest('.hand-zone.mobile-hand')).find(hz=>hz && eligible(+hz.id.slice(-1)));
    if(!hz) return false;
    open(hz);
    return true;
  }
  document.addEventListener('keydown',e=>{
    if(handObserver && (e.key==='Escape'||e.code==='Space') && !e.target.closest('input,textarea,select,[contenteditable="true"]')
      && document.getElementById('card-zoom')?.style.display!=='flex' && !chainIsOpen()){
      e.preventDefault();e.stopImmediatePropagation();
      if(handObserver.peeking && e.key==='Escape') setRunePeeking(false);
      return;
    }
    if(picker()?.peeking && !isRescueKey(e) && document.getElementById('card-zoom')?.style.display!=='flex'){
      e.stopImmediatePropagation();
      if(e.key==='Escape'){e.preventDefault();setRunePeeking(false);return;}
      const cardEl=e.target.closest('.rune-peek-card');
      if(cardEl && (e.key==='Enter'||e.key===' ')){e.preventDefault();UI.showZoom(cardEl._card);}
      else if(!['Tab','Enter',' '].includes(e.key)) e.preventDefault();
      return;
    }
    if((handChoice || runeView()) && e.code==='Space' && !e.ctrlKey && !e.metaKey && !e.altKey
      && !e.target.closest('input,textarea,select,[contenteditable="true"]')
      && !e.target.closest('[data-ready-choice]')
      && document.getElementById('card-zoom')?.style.display!=='flex' && !chainIsOpen()){
      e.preventDefault();e.stopImmediatePropagation();
      const confirm=document.getElementById(handChoice?'mobile-hand-confirm':'mobile-rune-confirm');
      if(!e.repeat && (handChoice?validHandChoice():validRuneDraft()) && confirm && !confirm.disabled) confirm.click();
      return;
    }
    if(handChoice && e.key==='Escape' && document.getElementById('card-zoom')?.style.display!=='flex'){
      e.preventDefault();e.stopImmediatePropagation();return;
    }
    if(runeDraft?.cost && e.key==='Escape'){
      e.preventDefault();e.stopImmediatePropagation();
      if(!runeDraft.cost.required){ UI.hideZoom(); close(true); }
    }
  },true);
  UI.mobileHand={pickRevealedHand(p,title,options){
    return new Promise(resolve=>{
      closeModal();UI.hideZoom();
      const owner=options[0].boardCard.p;
      open(document.getElementById('hand-'+owner),null,null,{game:G,p,owner,title,options,resolve,selected:null,dragCancels:[]});
      UI.previewRevealedHandSelection?.(null);
    });
  },observeRevealedHand(view){
    closeModal();UI.hideZoom();
    open(document.getElementById('hand-'+view.owner),null,null,null,view);
  },updateRevealedHandPreview(view){
    if(handObserver===view && validHandObserver()) render();
  },closeRevealedHandPreview(view){
    if(handObserver===view) close(true);
  },pickRuneNumber(p,title,min,max){
    return new Promise(resolve=>{
      closeModal(); UI.hideZoom();
      const P=G.players[p], pool=Object.values(P.power).reduce((a,b)=>a+b,0);
      open(document.getElementById('runes-'+p),null,{resolve,title,number:true,min,max,pool,poolAmount:0,poolAvailable:{...P.power},poolPicks:new Map(),required:true,
        options:P.runes.map((r,i)=>({v:i}))});
    });
  },pickRuneCost(p,title,options){
    return new Promise(resolve=>{
      closeModal(); UI.hideZoom();
      open(document.getElementById('runes-'+p),null,{resolve,title,options});
    });
  },pickRuneOption(p,title,options){
    return new Promise(resolve=>{
      const spec=options.find(o=>o.runePick)?.runePick;
      if(spec?.batch && runeChoices?.batch===spec.batch && runeChoices.game===G){
        const entry=runeChoices.entries.shift();
        resolve(entry===undefined?options.findIndex(o=>o.v==='skip'):options.findIndex(o=>o.runePick?.p===entry.p && G.players[entry.p].runes[o.runePick.index]===entry.r)); return;
      }
      runeChoices=null;
      close(); closeModal(); UI.hideZoom();
      const entries=options.map(o=>o.runePick?{...o.runePick,r:G.players[o.runePick.p].runes[o.runePick.index]}:null);
      const zone=document.createElement('div'); zone.id='rune-choice-'+p; zone.className='runes-zone';
      const ordered=entries.map((entry,i)=>({entry,i})).filter(x=>x.entry)
        .sort((a,b)=>a.entry.p-b.entry.p || Number(!!a.entry.r.ex)-Number(!!b.entry.r.ex) || a.entry.index-b.entry.index);
      const origins=[], multipleOwners=new Set(ordered.map(x=>x.entry.p)).size>1;
      if(multipleOwners) for(const owner of new Set(ordered.map(x=>x.entry.p))){
        const label=document.createElement('div'); label.className='rune-choice-group-label';
        label.dataset.runeOwnerLabel=String(owner); label.textContent=pname(owner)+'의 룬';
        zone.appendChild(label);
      }
      for(const {entry,i} of ordered){
        const source=document.querySelector(`#runes-${entry.p} [data-rune-index="${entry.index}"]`);
        if(source) origins.push({index:i,rect:source.getBoundingClientRect()});
        const el=source?source.cloneNode(true):document.createElement('div');
        const rc=card(entry.r.n), image=artImg(rc,entry.p);
        el.classList.add('rune-mini'); el.classList.toggle('exhausted',!!entry.r.ex);
        if(image) el.style.backgroundImage=`url("${cardImgUrl(image,120)}")`;
        el.style.borderColor=DOMAIN_COLOR[runeDomain(entry.r.n)]||'#556';
        el.dataset.runeIndex=String(i); el.setAttribute('role','button'); el.tabIndex=0; el._card=rc;
        el.classList.remove('touch-draggable'); el.title=options[i].label;
        el.onmouseenter=()=>UI.inspect(card(entry.r.n)); attachZoom(el);
        if(multipleOwners){
          const owner=document.createElement('span'); owner.className='rune-choice-owner'; owner.textContent=pname(entry.p);
          el.appendChild(owner);
        }
        const slot=document.createElement('div'); slot.className='rune-slot'+(entry.r.ex?' exhausted':'');
        slot.appendChild(el); zone.appendChild(slot);
      }
      document.body.appendChild(zone);
      const skip=options.findIndex(o=>!o.runePick && (o.v==='skip'||o.v===null)), first=ordered[0].entry;
      open(zone,null,{resolve,title,choice:true,temporary:true,entries,origins,action:first.action,required:first.required,
        batch:first.batch,limit:Math.min(first.count||1,ordered.length),
        skip:skip<0?null:skip,options:options.map((o,i)=>({...o,v:i}))});
    });
  },render,close,dismiss(){return handChoice||handObserver||runeDraft?.cost?.required?true:close(true);},peekAt,handleClick,clearSelection(){
    if(opened && !runeView() && !handObserver) selectCard(null);
  },cancelRuneDraft(){return runeView()?close(true):false;},beginDrag(el,ghost,point){
    if(el.dataset.poolId && runeDraft?.cost?.number){
      ghost.className='rune-power-token touch-drag-preview';ghost.style.transform='none';
      ghost.style.width=el.offsetWidth+'px';ghost.style.height=el.offsetHeight+'px';
      ghost.textContent=(DOMAIN_ICON[el.dataset.poolId]||'✳')+' 1';
      return {game:G,poolId:el.dataset.poolId,pool:true};
    }
    if(handChoice){
      const index=+(el.dataset.handIndex??el.dataset.stagedHandIndex);
      const width=parseFloat(opened.style.getPropertyValue('--fan-width'))||108;
      ghost.classList.add('mobile-hand-face');ghost.style.width=width+'px';ghost.style.height=width*104/74+'px';
      ghost.style.transform='none';
      return {game:G,p:handChoice.owner,index,n:G.players[handChoice.owner].hand[index],revealedHand:true,stagedHand:el.dataset.stagedHandIndex!==undefined};
    }
    if(runeView()){
      if(!validRuneDraft()) return null;
      const index=+el.dataset.runeIndex, rect=el.getBoundingClientRect();
      const width=parseFloat(opened.style.getPropertyValue('--fan-width'))||84;
      ghost.classList.add('rune-mini','mobile-rune-face');
      ghost.style.position='fixed';
      ghost.style.opacity=el.classList.contains('exhausted')?'.55':'.95';
      ghost.style.width=width+'px'; ghost.style.height=width*104/74+'px';
      const matrix=new DOMMatrix(getComputedStyle(el).transform);
      const angle=Math.atan2(matrix.b,matrix.a)*180/Math.PI;
      ghost.style.transformOrigin='50% 50%'; ghost.style.transform=`rotate(${angle}deg)`;
      const center=fixedLayoutSpace(rect.left+rect.width/2,rect.top+rect.height/2);
      const finger=fixedLayoutSpace(point.clientX,point.clientY), scale=el.offsetWidth/width;
      if(UI.fx.on && !matchMedia('(prefers-reduced-motion:reduce)').matches){
        const frames=Array.from({length:21},(_,i)=>{
          const t=i/20, progress=Math.log1p(9*t)/Math.log(10);
          return {offset:t,transform:`translate(${(center.x-finger.x)*(1-progress)}px,${(center.y-finger.y)*(1-progress)}px) rotate(${angle}deg) scale(${scale+(1-scale)*progress})`};
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
    if(drag?.pool){
      return;
    }
    if(drag?.revealedHand){
      if(drag.game===G && validHandChoice()){
        const rect=ghost.getBoundingClientRect();
        if(drag.stagedHand){
          UI.fx.moveCard?.(drag.p,drag.n,{game:G,anchor:()=>rect},'#mobile-hand-recycled .card-mini',{unit:true,handLayout:opened.id});
          UI.fx.renderMoves?.();
        }else UI.fx.handLayout?.(opened,[{index:drag.index,rect}]);
      }
      return;
    }
    if(drag?.rune){
      if(drag.game===G && validRuneDraft()){
        const rect=ghost.getBoundingClientRect();
        if(runeDraft.picks.get(drag.index)?.power) returnRune(drag.index,rect);
        else UI.fx.handLayout?.(opened,[{index:drag.index,rect}]);
      }
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

// ══════════ 모바일: 카드 정보 칸 접기/펼치기 ══════════
// 작은 화면에서 카드 정보 칸이 보드를 밀어내 상대 기지 유닛이 가려지거나 누르기 어렵다는 제보(2026-10-13).
// 버튼(#insp-min)으로 한 줄(카드 이름만)로 접고, 상태는 기기에 저장한다(rb_insp_min). 데스크톱은 CSS가 버튼을 숨긴다.
(function(){
  const KEY='rb_insp_min';
  function init(){
    const btn=document.getElementById('insp-min'); if(!btn) return;
    const apply=on=>{ document.body.classList.toggle('insp-min',on); btn.textContent=on?'▸':'▾'; btn.title=on?'카드 정보 펼치기':'카드 정보 접기'; btn.setAttribute('aria-label',btn.title); btn.setAttribute('aria-expanded',on?'false':'true'); };
    let on=false; try{ on=localStorage.getItem(KEY)==='on'; }catch(e){}
    apply(on);
    btn.addEventListener('click',e=>{ e.stopPropagation(); on=!on; apply(on); try{ localStorage.setItem(KEY,on?'on':'off'); }catch(e){} });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
