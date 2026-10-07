// ══════════ 연출(이펙트) ══════════
// 전부 표시 전용 — 게임 상태(G)를 건드리지 않고, 아무것도 await 하지 않는다.
// (온라인 락스텝 결정론과 봇 진행 속도에 영향이 없어야 하므로 모두 비동기 fire-and-forget)
// 유닛 연출은 보드가 매 렌더마다 다시 그려져도 살아남도록, 유닛 위치에 별도 레이어를 띄운다.

UI.fx = {
  on: (localStorage.getItem('rb_fx') !== 'off'),
  setOn(v){ UI.fx.on = !!v; localStorage.setItem('rb_fx', v ? 'on' : 'off'); document.body.classList.toggle('fx-disabled', !UI.fx.on); updateTurnGlow(); },
  pass(){},
  turnEndAccepted(){},
};
document.body.classList.toggle('fx-disabled', !UI.fx.on);

// Capture departures before render replaces cards; resolve arrivals after layout.
// These records belong to the displayed game only (never bot simulation state).
let fxMoveGame = null, fxMoves = [], fxPileCounts = null;
let fxHandSlots = [[],[]], fxRuneSlots = [[],[]];
const fxFlights = new Set();
const fxArrivals = new Set();
const fxDirectMoves = new Map();
UI.fx.directMove=function(u,dest){ if(G===fxMoveGame && fxMotionEnabled() && localControlsPlayer(u.ctrl)) fxDirectMoves.set(u.uid,dest); };
const fxPileArrivals = new Set();
UI.fx.pileArrival = function(p,zone){
  if(G===fxMoveGame && fxMotionEnabled()) fxPileArrivals.add(`#${zone}-${p}`);
};
function fxMotionEnabled(){
  return UI.fx.on && !matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function fxStopFlights(){
  for(const stop of [...fxFlights]) stop();
  fxArrivals.clear(); fxRefreshArrivals();
}
const fxSetOn = UI.fx.setOn;
UI.fx.setOn = function(v){ fxSetOn(v); if(!v){ fxMoves=[]; fxDirectMoves.clear(); fxStopFlights(); fxClearCardActions(); } };

// Presentation records survive UI.render replacing the board DOM. Neither
// arrival visibility nor rotation/pulses delay or mutate the rules state.
let fxCardStates=new Map(), fxCardActions=new Map(), fxActionFrame=0;
let fxSelected=new Map(), fxChainSeen=new Set();
const fxObjectKeys=new WeakMap(); let fxObjectSequence=0;
function fxStateKey(key){
  if(typeof key!=='object') return key;
  if(!fxObjectKeys.has(key)) fxObjectKeys.set(key,'card:'+ ++fxObjectSequence);
  return fxObjectKeys.get(key);
}
function fxClearCardActions(){
  cancelAnimationFrame(fxActionFrame); fxActionFrame=0;
  for(const action of fxCardActions.values()) action.animations?.forEach(a=>a.cancel());
  fxCardActions.clear();
}
function fxCardAction(key,resolve,kind,fromEx,toEx){
  if(!fxMotionEnabled()) return;
  const id=key+':'+kind, previous=fxCardActions.get(id);
  previous?.animations?.forEach(a=>a.cancel());
  fxCardActions.set(id,{resolve,kind,fromEx,toEx,start:performance.now(),duration:kind==='turn'?420:360,animations:[]});
  if(!fxActionFrame) fxActionFrame=fxFrame(fxTickCardActions);
}
function fxTickCardActions(){
  fxActionFrame=0;
  if(!fxMotionEnabled()){ fxClearCardActions(); return; }
  for(const [key,action] of fxCardActions){
    const time=performance.now()-action.start;
    if(time>=action.duration){ action.animations.forEach(a=>a.cancel()); fxCardActions.delete(key); continue; }
    const elements=action.resolve();
    const layout=elements.map(el=>`${el.offsetWidth}:${el.offsetHeight}:${el.closest('.bf-row')?1:0}`).join('|');
    if(action.layout===layout && action.elements?.every((el,i)=>el===elements[i]) && action.elements.length===elements.length) continue;
    action.animations.forEach(a=>a.cancel()); action.animations=[];
    action.elements=elements; action.layout=layout;
    for(const el of elements){
      let frames;
      if(action.kind==='turn'){
        const exhausted=el.classList.contains('exhausted');
        const transition=el.style.transition;
        el.style.transition='none';
        el.classList.toggle('exhausted',action.fromEx);
        const from=getComputedStyle(el).transform;
        el.classList.toggle('exhausted',action.toEx);
        const to=getComputedStyle(el).transform;
        el.classList.toggle('exhausted',exhausted);
        el.style.transition=transition;
        frames=[{transform:from},{transform:to}];
      }else frames=[{scale:'1'},{scale:'1.14',offset:.4},{scale:'1'}];
      const a=el.animate(frames,{duration:action.duration,easing:action.kind==='turn'?'cubic-bezier(.42,0,.18,1)':'ease-out'});
      a.id='fx-card-'+action.kind; a.currentTime=time; action.animations.push(a);
    }
  }
  if(fxCardActions.size) fxActionFrame=fxFrame(fxTickCardActions);
}
function fxPulseCard(selector){
  fxCardAction(selector,()=>[...document.querySelectorAll(selector)],'pulse');
}
function fxTargetSelector(target){
  if(target.kind==='unit') return `#board [data-uid="${target.uid}"]`;
  if(target.kind==='chain' && target.itemId!==undefined) return `[data-target-chain-id="${target.itemId}"]`;
  if(target.kind==='battlefield') return `#bf-${target.bf} .bf-header img`;
  if(target.kind==='trash') return `#trash-${target.p}`;
  return null;
}
UI.fx.selectedTargets=function(counts){
  const next=new Map();
  for(const [el,count] of counts){
    const selector=el.dataset.uid?`#board [data-uid="${el.dataset.uid}"]`
      :el.dataset.targetChainId?`[data-target-chain-id="${el.dataset.targetChainId}"]`
      :el.classList.contains('battlefield')?`#${el.id} .bf-header img`:el.id?`#${el.id}`:null;
    if(!selector) continue;
    next.set(selector,count);
    if(fxSelected.get(selector)!==count) fxPulseCard(selector);
  }
  fxSelected=next;
};
function fxStates(){
  const states=new Map();
  for(const u of everyUnit()) states.set('unit:'+u.uid,{ex:!!u.ex,loc:moveDisplayLoc(u),ctrl:u.ctrl,preview:!!pendingCombatMove()?.uids.has(u.uid),u,
    signature:JSON.stringify([u.dmg,u.buff,u.stunned,targetMight(u),u.grants]),
    selector:`#board [data-uid="${u.uid}"]`});
  G.players.forEach((P,p)=>{
    states.set('legend:'+p,{ex:!!P.legendEx,selector:`#legend-${p} .card-mini`});
    P.runes.forEach((r,i)=>states.set(r,{ex:!!r.ex,selector:`#runes-${p} [data-rune-index="${i}"]`}));
    P.gear.forEach((g,i)=>states.set(g,{ex:!!g.ex,selector:`#base-${p} [data-gear-index="${i}"]`}));
  });
  return states;
}
UI.fx.beforeRender=function(){
  if(!G || G!==fxMoveGame || !fxMotionEnabled()){ fxDirectMoves.clear(); return; }
  for(const [key,next] of fxStates()){
    const previous=fxCardStates.get(key); if(!previous) continue;
    const resolve=()=>{ const state=fxCardStates.get(key); return state?[...document.querySelectorAll(state.selector)]:[]; };
    if(next.ex!==previous.ex) fxCardAction(fxStateKey(key),resolve,'turn',previous.ex,next.ex);
    if(next.signature!==previous.signature) fxPulseCard(next.selector);
    const direct=next.u && localControlsPlayer(next.ctrl)
      && (next.preview || previous.preview || fxDirectMoves.get(next.u.uid)===next.loc);
    if(next.u && (next.loc!==previous.loc || next.ctrl!==previous.ctrl) && !direct){
      UI.fx.moveCard(next.u.ctrl,next.u.n,previous.selector,next.selector,{unit:true});
    }
  }
  fxDirectMoves.clear();
};

function fxRefreshArrivals(){
  document.querySelectorAll('[data-fx-arrival]').forEach(el=>el.removeAttribute('data-fx-arrival'));
  document.querySelectorAll('[data-fx-hand-arrival]').forEach(el=>el.removeAttribute('data-fx-hand-arrival'));
  document.querySelectorAll('[data-fx-trash]').forEach(el=>{
    el.removeAttribute('data-fx-trash');
    const p=Number(el.id.split('-')[1]), top=G?.players[p]?.trash.at(-1);
    const img=top===undefined?null:artImg(card(top),p);
    el.style.setProperty('--pile-image',img?`url("${new URL(cardImgUrl(img,280),document.baseURI).href}")`:'none');
    el.classList.toggle('has-card-image',!!img);
  });
  const held=new Set();
  for(const m of fxArrivals){
    const el=document.querySelector(m.to); if(!el) continue;
    if(m.trash && !held.has(m.to)){
      el.dataset.fxTrash=''; el.style.setProperty('--pile-image',m.trash.image);
      el.classList.toggle('has-card-image',m.trash.hasImage); held.add(m.to);
    }else if(m.handLayout) el.dataset.fxHandArrival='';
    else if(!el.classList.contains('pile')) el.dataset.fxArrival='';
  }
}

UI.fx.captureOrigin=function(selector){
  if(G!==fxMoveGame || !fxMotionEnabled()) return null;
  const source=document.querySelector(selector), rect=source?.getBoundingClientRect();
  return rect?.width && rect.height ? {game:G,anchor:fxAnchor(source)} : null;
};
UI.fx.moveCard = function(p, n, from, to, options={}){
  if(!fxMotionEnabled() || G!==fxMoveGame || G.phase==='setup') return;
  // Several removals can occur before the next render: engine indices have
  // shifted, but the departing DOM cards still have their previous indices.
  if(options.handIndex!==undefined){
    const slot=fxHandSlots[p].splice(options.handIndex,1)[0];
    if(slot===undefined) return;
    from=`#hand-${p} [data-hand-index="${slot}"]`;
  }
  if(options.rune){
    const slot=fxRuneSlots[p].indexOf(options.rune);
    if(slot<0) return;
    from=`#runes-${p} [data-rune-index="${slot}"]`;
  }
  const origin=typeof from==='string'?UI.fx.captureOrigin(from):from;
  if(!origin || origin.game!==G) return;
  const pile=document.querySelector(to);
  fxMoves.push({p,n,anchor:origin.anchor,to,back:!!options.back,unit:options.unit,handLayout:options.handLayout,
    trash:pile?.classList.contains('trash')?{image:pile.style.getPropertyValue('--pile-image'),hasImage:pile.classList.contains('has-card-image')}:null});
};

// 손패 펼침/접힘도 기존 카드 비행을 사용한다. 조작이나 재렌더링은 기다리지 않는다.
UI.fx.stopHandLayout=function(){
  fxMoves=fxMoves.filter(m=>!m.handLayout);
  for(const stop of [...fxFlights]) if(stop.handLayout) stop();
  for(const m of fxArrivals) if(m.handLayout) fxArrivals.delete(m);
  fxRefreshArrivals();
};
UI.fx.captureHandLayout=function(hz){
  UI.fx.stopHandLayout();
  if(!fxMotionEnabled() || G!==fxMoveGame) return [];
  const runes=hz.classList.contains('runes-zone');
  return [...hz.querySelectorAll(runes?'[data-rune-index]':'[data-hand-index]')].map(el=>({index:+(runes?el.dataset.runeIndex:el.dataset.handIndex),rect:el.getBoundingClientRect()}));
};
UI.fx.handLayout=function(hz,origins){
  if(!fxMotionEnabled() || !origins?.length) return;
  const p=+hz.id.slice(-1);
  const runes=hz.classList.contains('runes-zone');
  for(const {index,rect} of origins){
    const n=runes?G.players[p].runes[index]?.n:G.players[p].hand[index];
    if(n===undefined) continue;
    UI.fx.moveCard(p,n,{game:G,anchor:()=>rect},`#${hz.id} [data-${runes?'rune':'hand'}-index="${index}"]`,{unit:true,handLayout:hz.id});
  }
  UI.fx.renderMoves();
};

function fxPulsePile(selector){
  if(!fxMotionEnabled()) return;
  const el=document.querySelector(selector);
  if(!el) return;
  // Cancel the previous pulse so repeated arrivals do not accumulate transforms.
  el.getAnimations().filter(a=>a.id==='fx-pile-arrival').forEach(a=>a.cancel());
  const a=el.animate([
    {transform:'scale(1)'}, {transform:'scale(1.16)',offset:.4}, {transform:'scale(1)'}
  ],{duration:330,easing:'ease-out'});
  a.id='fx-pile-arrival';
}

UI.fx.renderMoves = function(){
  const counts=G.players.map(P=>({deck:P.deck.length,trash:P.trash.length,runedeck:P.runeDeck.length}));
  if(fxMoveGame!==G){ fxStopFlights(); fxClearCardActions(); fxMoves=[]; fxPileCounts=null; fxPileArrivals.clear(); fxDirectMoves.clear(); fxMoveGame=G; fxSelected.clear(); fxChainSeen.clear(); }
  const moves=fxMoves; fxMoves=[];
  if(fxPileCounts && fxMotionEnabled() && G.phase!=='setup'){
    counts.forEach((p,i)=>Object.keys(p).forEach(zone=>{
      const selector=`#${zone}-${i}`;
      if((p[zone]>fxPileCounts[i][zone] || fxPileArrivals.has(selector)) && !moves.some(m=>m.to===selector)) fxPulsePile(selector);
    }));
  }
  fxPileCounts=counts;
  fxPileArrivals.clear();
  fxHandSlots=G.players.map(P=>P.hand.map((_,i)=>i));
  fxRuneSlots=G.players.map(P=>P.runes.slice());
  fxCardStates=fxStates();
  for(const item of visibleChain()){
    if(fxChainSeen.has(item.displayId)) continue;
    fxChainSeen.add(item.displayId);
    fxPulseCard(`[data-target-chain-id="${item.displayId}"]`);
    if(item.unit) fxPulseCard(`#board [data-uid="${item.unit.uid}"]`);
    if(item.n===G.players[item.p]?.legendN) fxPulseCard(`#legend-${item.p} .card-mini`);
    if(item.gear){ const i=G.players[item.p].gear.indexOf(item.gear); if(i>=0) fxPulseCard(`#base-${item.p} [data-gear-index="${i}"]`); }
    for(const target of item.displayTargets||[]){ const selector=fxTargetSelector(target); if(selector) fxPulseCard(selector); }
  }
  if(fxMotionEnabled()) moves.forEach(m=>{
    fxArrivals.add(m);
    // 도착 카드는 비행 연출이 끝날 때까지만 숨긴다 — 연출이 어떤 이유로든(탭 숨김·애니메이션 중단) 끝나지 않아도 1.2초 뒤엔 반드시 보인다
    setTimeout(()=>{ if(fxArrivals.delete(m)) fxRefreshArrivals(); }, 1200);
  });
  fxRefreshArrivals();
  if(fxCardActions.size){ cancelAnimationFrame(fxActionFrame); fxTickCardActions(); }
  if(!moves.length) return;
  const game=G;
  fxFrame(()=>{
    if(G!==game || !fxMotionEnabled()){ moves.forEach(m=>fxArrivals.delete(m)); fxRefreshArrivals(); return; }
    moves.forEach((m,i)=>{
      if(m.handLayout && !fxArrivals.has(m)) return;
      const target=document.querySelector(m.to);
      const handArrival=!m.handLayout && target?.matches('[data-hand-index]') &&
        target.closest('.mobile-hand, .mobile-opp-hand');
      // Another action can shift hand indices before the presentation frame.
      // Never animate a different card that has since occupied this slot.
      if(handArrival && !m.back && target._card?.n!==m.n){ fxArrivals.delete(m); fxRefreshArrivals(); return; }
      const end=target?.getBoundingClientRect();
      if(!end?.width || !end.height){ fxArrivals.delete(m); fxRefreshArrivals(); return; }
      const start=fxRect(m.anchor());
      const el=document.createElement('div');
      el.className='fx-card-flight'+(m.back?' card-back':'');
      el.setAttribute('aria-hidden','true');
      el.style.cssText=`left:${start.left}px;top:${start.top}px;width:${start.width}px;height:${start.height}px`;
      if(!m.back){
        const img=artImg(card(m.n),m.p);
        if(img) el.style.backgroundImage=`url("${cardImgUrl(img,280)}")`;
      }
      fxLayer().appendChild(el);
      let stage, face;
      if(m.unit || handArrival){
        el.classList.remove('card-back');
        el.classList.add('fx-unit-flight'); el.style.backgroundImage='none';
        stage=document.createElement('div'); stage.className='fx-flight-stage';
        // Concealed arrivals must never clone a face-up target, even when the
        // recipient can inspect it after arrival (e.g. returning a hidden card).
        face=m.back?document.createElement('div'):target.cloneNode(true);
        if(m.back) face.className='card-mini card-back';
        face.removeAttribute('data-uid'); face.removeAttribute('data-fx-arrival');
        face.removeAttribute('data-fx-hand-arrival');
        face.removeAttribute('data-board-choice');
        face.classList.remove('chosen-target','targetable','selected');
        // The flight lives outside the hand zone; retain the expanded card's
        // frame and badges there as well as on the eventual destination.
        if((m.handLayout || handArrival) && target.closest('.mobile-hand-open')) face.classList.add('mobile-hand-face');
        if(m.handLayout && target.closest('.mobile-runes-open')) face.classList.add('mobile-rune-face');
        Object.assign(face.style,{position:'absolute',left:'50%',top:'50%',margin:'0',visibility:'visible',transformOrigin:'center'});
        if(m.handLayout || handArrival) face.style.transition='none'; // 비행 좌표에 별도의 호버 전환이 섞이지 않게 한다.
        stage.appendChild(face); el.appendChild(stage);
      }
      const frames=()=>{
        const source=fxRect(m.anchor());
        if(!source.width || !source.height) return null;
        const target=document.querySelector(m.to);
        if(handArrival && !m.back && target?._card?.n!==m.n) return null;
        const destination=target?.getBoundingClientRect();
        if(!destination?.width || !destination.height) return null;
        const end=fxRect(destination);
        // 펼치는 손패는 최종 크기로 그린 뒤 축소에서 1배까지 이동한다.
        // 작은 비행 레이어와 내부 카드의 반대 방향 확대를 겹치지 않는다.
        const finalSize=handArrival || m.handLayout && target.closest('.mobile-hand-open, .mobile-runes-open');
        const size=finalSize?end:source;
        el.style.left=source.left+'px'; el.style.top=source.top+'px';
        el.style.width=size.width+'px'; el.style.height=size.height+'px';
        if(stage){
          if(handArrival) face.classList.toggle('mobile-hand-face',!!target.closest('.mobile-hand-open'));
          const matrix=new DOMMatrix(getComputedStyle(target).transform);
          const angle=Math.atan2(matrix.b,matrix.a)*180/Math.PI, scale=Math.hypot(matrix.a,matrix.b);
          stage.style.cssText=`position:absolute;left:0;top:0;width:${end.width}px;height:${end.height}px;transform-origin:top left;transform:scale(${size.width/end.width},${size.height/end.height})`;
          face.style.width=target.offsetWidth+'px'; face.style.height=target.offsetHeight+'px';
          face.style.transform=`translate(-50%,-50%) rotate(${angle}deg) scale(${scale})`;
          if(handArrival){
            // Mobile piles are horizontal. Fly a complete card at a uniform
            // scale, rotating it upright, instead of cropping art to the pile.
            const fromAngle=source.width>source.height?90:0;
            const width=(fromAngle?target.offsetHeight:target.offsetWidth)*scale;
            const height=(fromAngle?target.offsetWidth:target.offsetHeight)*scale;
            const fromScale=Math.min(source.width/width,source.height/height);
            const dx=end.left+end.width/2-source.left-source.width/2;
            const dy=end.top+end.height/2-source.top-source.height/2;
            const arc=Math.min(35,fxLayer().clientHeight*.045);
            el.style.left=(source.left+(source.width-end.width)/2)+'px';
            el.style.top=(source.top+(source.height-end.height)/2)+'px';
            el.style.transformOrigin='center';
            return [
              {transform:`translate(0,0) rotate(${fromAngle-angle}deg) scale(${fromScale})`,opacity:1},
              {transform:`translate(${dx*.48}px,${dy*.48-arc}px) rotate(${(fromAngle-angle)*.52}deg) scale(${fromScale+(1-fromScale)*.48})`,opacity:1,offset:.48},
              {transform:`translate(${dx}px,${dy}px) rotate(0deg) scale(1)`,opacity:1}
            ];
          }
        }
        const dx=end.left-source.left, dy=end.top-source.top;
        const fromX=source.width/size.width, fromY=source.height/size.height;
        const sx=end.width/size.width, sy=end.height/size.height;
        const arc=Math.min(35,fxLayer().clientHeight*.045);
        return [
          {transform:`translate(0,0) scale(${fromX},${fromY})`,opacity:1},
          {transform:`translate(${dx*.48}px,${dy*.48-arc}px) scale(${(fromX+sx)/2},${(fromY+sy)/2})`,opacity:1,offset:.48},
          {transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`,opacity:1}
        ];
      };
      const initial=frames();
      let geometry=JSON.stringify(initial);
      const speed=m.handLayout?2.25:1;
      const a=el.animate(initial,{duration:460/speed,delay:Math.min(i,6)*(m.handLayout?20:65)/speed,fill:'both',easing:'cubic-bezier(.22,.65,.3,1)'});
      // Keep the timeline, but recompute geometry as cards reflow, scroll or zoom.
      const unfollow=fxFollow(el,()=>{
        if(G!==game || !fxMotionEnabled()){ stop(); return; }
        const next=frames();
        if(!next){ stop(); return; }
        const key=JSON.stringify(next);
        if(key!==geometry){ geometry=key; a.effect.setKeyframes(next); }
      });
      const stop=(arrived=false)=>{
        unfollow(); a.cancel(); el.remove(); fxFlights.delete(stop); fxArrivals.delete(m);
        if(arrived && m.trash){
          const img=artImg(card(m.n),m.p);
          for(const pending of fxArrivals) if(pending.to===m.to) pending.trash={image:img?`url("${new URL(cardImgUrl(img,280),document.baseURI).href}")`:'none',hasImage:!!img};
        }
        fxRefreshArrivals();
      };
      stop.handLayout=m.handLayout;
      fxFlights.add(stop);
      a.onfinish=fxGuard(()=>{ stop(true); if(G===game && /^#(deck|trash|runedeck)-/.test(m.to)) fxPulsePile(m.to); });
    });
  });
};

function fxLayer(){
  let l = document.getElementById('fx-layer');
  if(!l){ l = document.createElement('div'); l.id = 'fx-layer'; document.body.appendChild(l); fxSyncViewport(); }
  return l;
}

// Shared coordinate contract for every board-anchored effect. DOMRects are in
// viewport pixels; overlay CSS lengths are before the root CSS zoom. Never mix
// them, and never multiply by devicePixelRatio or visualViewport.scale again.
function fxRect(rect){
  const origin=fxLayer().getBoundingClientRect();
  const pos=fixedLayoutSpace(rect.left-origin.left,rect.top-origin.top);
  const size=fixedLayoutSpace(rect.width,rect.height);
  return {left:pos.x,top:pos.y,width:size.x,height:size.y};
}

function fxSyncViewport(){
  const layer=document.getElementById('fx-layer');
  if(!layer) return;
  const view=window.visualViewport;
  const pos=fixedLayoutSpace(view?.offsetLeft||0,view?.offsetTop||0);
  const size=fixedLayoutSpace(view?.width||innerWidth,view?.height||innerHeight);
  layer.style.cssText=`left:${pos.x}px;top:${pos.y}px;width:${size.x}px;height:${size.y}px;right:auto;bottom:auto`;
}
window.addEventListener('resize',fxSyncViewport);
window.visualViewport?.addEventListener('resize',fxSyncViewport);
window.visualViewport?.addEventListener('scroll',fxSyncViewport);
new MutationObserver(fxSyncViewport).observe(document.documentElement,{attributes:true,attributeFilter:['style']});

// A removed card cannot be measured again. Preserve its position relative to
// its zone so even a departing card follows rotation/reflow after removal.
function fxAnchor(source, selector){
  const rect=source.getBoundingClientRect();
  const zone=source.parentElement.closest('[id]');
  const bounds=zone?.getBoundingClientRect();
  const viewport={width:innerWidth,height:innerHeight,unit:fixedLayoutSpace(1,1).x};
  const relative=bounds?.width && bounds.height ? {
    x:(rect.left-bounds.left)/bounds.width, y:(rect.top-bounds.top)/bounds.height
  } : null;
  return ()=>{
    const live=selector ? document.querySelector(selector) : source.isConnected ? source : null;
    if(live) return live.getBoundingClientRect();
    const current=zone?.isConnected ? zone.getBoundingClientRect() : null;
    if(relative && current?.width && current.height){
      const scale=viewport.unit/fixedLayoutSpace(1,1).x;
      const reflow=scale!==1 || viewport.width!==innerWidth || viewport.height!==innerHeight;
      // A normal discard can shrink the hand zone. That must not shrink or
      // move the departure itself; only viewport changes remap the old slot.
      return {
        left:current.left+(reflow ? relative.x*current.width : rect.left-bounds.left),
        top:current.top+(reflow ? relative.y*current.height : rect.top-bounds.top),
        width:rect.width*scale, height:rect.height*scale
      };
    }
    return rect;
  };
}

function fxFollow(el, update){
  let frame;
  const tick=()=>{ if(!el.isConnected) return; update(); if(el.isConnected) frame=fxFrame(tick); };
  frame=fxFrame(tick);
  return ()=>cancelAnimationFrame(frame);
}

function fxAdd(el, ms, update){
  fxLayer().appendChild(el);
  if(update) update();
  const unfollow=update ? fxFollow(el,update) : ()=>{};
  setTimeout(()=>{ unfollow(); el.remove(); }, ms);
  return el;
}
function fxUnitEl(u){
  return u ? document.querySelector(`#board [data-uid="${u.uid}"]`) : null;
}

// ── 유닛 반응: 피해 / 버프 / 준비 / 처치 ──
// kind: 'hit' | 'buff' | 'ready' | 'die' | 'stun'
UI.fx.unit = function(u, kind, text){
  if(!UI.fx.on) return;
  if(kind==='ready') return; // Rotation is driven by the rendered ex-state change.
  if(kind!=='die') fxPulseCard(`#board [data-uid="${u.uid}"]`);
  const el = fxUnitEl(u); if(!el) return;
  const r = fxRect(el.getBoundingClientRect());
  if(!r.width) return;
  const box = document.createElement('div');
  box.className = 'fx-unit fx-' + kind;
  box.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  if(text){
    const t = document.createElement('span');
    t.className = 'fx-num'; t.textContent = text;
    box.appendChild(t);
  }
  const anchor=fxAnchor(el,`#board [data-uid="${u.uid}"]`);
  fxAdd(box, kind === 'die' ? 700 : 900,()=>{
    const r=fxRect(anchor());
    box.style.left=r.left+'px'; box.style.top=r.top+'px';
    box.style.width=r.width+'px'; box.style.height=r.height+'px';
  });
};

// ── 카드/능력 발동 연출: 화면 가운데에 잠깐 크게 ──
UI.fx.cast = function(c, p, label){
  if(!UI.fx.on || !c) return;
  const box = document.createElement('div');
  box.className = 'fx-cast fx-cast-p' + (p === 1 ? 1 : 0);
  if(c.img){
    const im = document.createElement('img');
    im.src = cardImgUrl(c.img, 280);
    box.appendChild(im);
  }
  const cap = document.createElement('div');
  cap.className = 'fx-cast-cap';
  cap.textContent = (label ? label + ' · ' : '') + (c.ko || c.name || '');
  box.appendChild(cap);
  fxAdd(box, 1100);
};

// ── 체인 적재: 누구의 카드/능력이 쌓였는지 2초간 표시 ──
UI.fx.chainAdd = function(c, p, num){
  if(!UI.fx.on || !c) return;
  const box = document.createElement('div');
  box.className = 'fx-cast fx-chain fx-cast-p' + (p === 1 ? 1 : 0);
  if(c.img){
    const im = document.createElement('img');
    im.src = cardImgUrl(c.img, 280);
    box.appendChild(im);
  }
  const cap = document.createElement('div');
  cap.className = 'fx-cast-cap';
  cap.textContent = `🔗 체인 #${num} — ${pname(p)}: ${c.ko || c.name || ''}`;
  box.appendChild(cap);
  fxAdd(box, 2000);
};

// 해당 진영 테두리 펄스 (진영 색으로) — 배지·띠와 함께 써서 '어느 쪽'인지 몸으로 알게 한다
function fxAreaPulse(p, ms){
  const area = document.getElementById('parea-' + p);
  if(!area) return;
  area.classList.remove('fx-pulse', 'fx-pulse-p0', 'fx-pulse-p1');
  void area.offsetWidth;                // 애니메이션 재시작
  area.classList.add('fx-pulse', 'fx-pulse-p' + (p === 1 ? 1 : 0));
  setTimeout(()=>area.classList.remove('fx-pulse', 'fx-pulse-p0', 'fx-pulse-p1'), ms);
}

// ── 턴 종료: 화면을 가로지르는 띠 (곧바로 턴 시작 대형 띠가 이어진다) ──
UI.fx.turnEnd = function(p){
  if(!UI.fx.on) return;
  const box = document.createElement('div');
  box.className = 'fx-band fx-band-p' + (p === 1 ? 1 : 0);
  const t = document.createElement('span');
  t.textContent = `${pname(p)} · 턴 종료`;
  box.appendChild(t);
  fxAdd(box, 1600);
};

// ── 턴 시작: 대형 띠 — 누구의 턴이 시작됐는지가 게임에서 가장 중요한 신호다 ──
// (예전엔 '턴 종료' 띠 1초가 전부라 턴이 넘어간 걸 놓치기 쉬웠다)
UI.fx.turnStart = function(p, duration=2400){
  if(!UI.fx.on) return;
  const box = document.createElement('div');
  box.className = 'fx-band fx-turnstart fx-band-p' + (p === 1 ? 1 : 0);
  box.style.animationDuration=duration+'ms';
  const t = document.createElement('span');
  t.textContent = `▶ ${Math.ceil(G.turnCount/2)}번째 턴 — ${pname(p)}`;
  box.appendChild(t);
  fxAdd(box, duration);
  fxAreaPulse(p, duration);
};

// ── 행동 차례 전환(패스/우선권 이동): 배지 + 해당 진영 테두리 펄스 ──
UI.fx.priority = function(p){
  if(!UI.fx.on) return;
  const box = document.createElement('div');
  box.className = 'fx-turnbadge fx-turnbadge-p' + (p === 1 ? 1 : 0);
  box.textContent = `▶ ${pname(p)}의 차례`;
  fxAdd(box, 1800);
  fxAreaPulse(p, 1800);
};

// ── 득점 ──
// A short, display-only celebration above the result dialog. Canvas keeps the
// particle count independent of board DOM and never intercepts result buttons.
let fxVictoryGame=null, fxVictoryStop=null;
UI.fx.victory=function(){
  if(!G || fxVictoryGame===G || !fxMotionEnabled()) return;
  fxVictoryStop?.(); fxVictoryGame=G;
  const game=G, canvas=document.createElement('canvas');
  canvas.className='fx-victory-confetti'; canvas.setAttribute('aria-hidden','true');
  canvas.style.cssText='position:fixed;pointer-events:none;z-index:110;';
  document.body.appendChild(canvas);
  const ctx=canvas.getContext('2d');
  if(!ctx){ canvas.remove(); return; }
  const colors=['#ffe29a','#e8b64c','#fff4d1','#67dce0','#a293f5','#ff8e9b'];
  const particles=Array.from({length:innerWidth<600?100:160},(_,i)=>({
    side:i%2, delay:Math.random()*.16, vx:.25+Math.random()*.65,
    vy:1.65+Math.random()*.8, size:5+Math.random()*6,
    spin:(Math.random()-.5)*13, phase:Math.random()*Math.PI*2,
    ribbon:i%5===0, color:colors[i%colors.length]
  }));
  const start=performance.now(); let frame=0;
  const stop=()=>{ cancelAnimationFrame(frame); canvas.remove(); if(fxVictoryStop===stop) fxVictoryStop=null; };
  fxVictoryStop=stop;
  const draw=now=>{
    const elapsed=(now-start)/1000;
    if(elapsed>2.7 || G!==game || !fxMotionEnabled() || !document.querySelector('.match-result.is-victory')?.getClientRects().length){ stop(); return; }
    const view=window.visualViewport, w=view?.width||innerWidth, h=view?.height||innerHeight;
    const pos=fixedLayoutSpace(view?.offsetLeft||0,view?.offsetTop||0), size=fixedLayoutSpace(w,h);
    Object.assign(canvas.style,{left:pos.x+'px',top:pos.y+'px',width:size.x+'px',height:size.y+'px'});
    const dpr=Math.min(devicePixelRatio||1,2), cw=Math.round(w*dpr), ch=Math.round(h*dpr);
    if(canvas.width!==cw || canvas.height!==ch){ canvas.width=cw; canvas.height=ch; }
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    for(const p of particles){
      const t=elapsed-p.delay; if(t<0) continue;
      const travel=(1-Math.exp(-2*t))/2;
      const x=((p.side ? .94 : .06)+(p.side ? -1 : 1)*p.vx*travel)*w+Math.sin(t*5+p.phase)*t*10;
      const y=(.86-p.vy*travel+.29*t*t)*h;
      ctx.save(); ctx.translate(x,y); ctx.rotate(p.phase+t*p.spin);
      ctx.scale(1,Math.cos(p.phase+t*9)*.85);
      ctx.globalAlpha=Math.min(1,t*18)*Math.max(0,Math.min(1,(2.7-elapsed)/.65));
      const pw=p.size, ph=p.ribbon?p.size*2.8:p.size*.7;
      ctx.fillStyle=p.color; ctx.fillRect(-pw/2,-ph/2,pw,ph);
      ctx.fillStyle='rgba(255,255,255,.4)'; ctx.fillRect(-pw/2,-ph/2,pw*.3,ph);
      ctx.restore();
    }
    frame=fxFrame(draw);
  };
  frame=fxFrame(draw);
};

UI.fx.score = function(p, n){
  if(!UI.fx.on || !(n > 0)) return;
  const box = document.createElement('div');
  box.className = 'fx-score fx-score-p' + (p === 1 ? 1 : 0);
  box.textContent = `+${n}점`;
  fxAdd(box, 1200);
};

// 행동 차례가 바뀌었는지 UI.render에서 확인 (모든 경로를 한 곳에서 잡는다)
let _fxActing = null, _fxTurn = null;
UI.fx.check = function(){
  if(!G || G.winner !== null){ _fxActing = null; _fxTurn = null; return; }
  const key = G.turnCount + ':' + G.actingPlayer;
  if(G.phase==='turn-intro'){ _fxActing=key; _fxTurn=G.turnCount; return; }
  if(_fxActing === null){ _fxActing = key; _fxTurn = G.turnCount; return; }   // 첫 렌더는 조용히
  if(key === _fxActing) return;
  const sameTurn = (G.turnCount === _fxTurn);
  _fxActing = key; _fxTurn = G.turnCount;
  if(sameTurn) UI.fx.priority(G.actingPlayer);   // 같은 턴 안에서 차례만 이동 (패스/우선권)
  else UI.fx.turnStart(G.turn);                  // 턴이 넘어감 — 대형 띠 (추가 턴 포함 모든 경로)
};

// Rendering is a client-local side effect. It must never abort a lockstep
// action after the engine has already removed a card or paid a cost.
function fxFail(error){
  UI.fx.on=false;
  fxMoves=[]; fxDirectMoves.clear();
  for(const cleanup of [fxStopFlights,fxClearCardActions,()=>fxVictoryStop?.()]){
    try{ cleanup(); }catch(_){}
  }
  fxArrivals.clear();
  document.querySelectorAll('[data-fx-arrival]').forEach(el=>el.removeAttribute('data-fx-arrival'));
  document.querySelectorAll('[data-fx-hand-arrival]').forEach(el=>el.removeAttribute('data-fx-hand-arrival'));
  document.getElementById('fx-layer')?.replaceChildren();
  console.warn('Visual effects disabled for this session; game processing continues.',error);
}
function fxGuard(fn){
  return function(...args){
    try{ return fn.apply(this,args); }catch(error){ fxFail(error); }
  };
}
function fxFrame(fn){ return requestAnimationFrame(fxGuard(fn)); }
for(const name of ['moveCard','captureOrigin','directMove','pileArrival','beforeRender','stopHandLayout','captureHandLayout','handLayout',
  'renderMoves','selectedTargets','unit','victory']) UI.fx[name]=fxGuard(UI.fx[name]);
