// 주문 준비는 UI 상태다. 실제 손패와 자원은 확인을 받은 뒤 엔진이 변경한다.
const SPELL_STAGE_CANCEL = Symbol('spellStageCancel');
const SPELL_STAGE_CANCEL_WIRE = Object.freeze({spellStageCancel:true});
UI.spellStage=null;
UI.spellStageSubmitting=false;
window.addEventListener('keydown',e=>{
  if(e.key!=='Escape' || !UI.spellStage || !localControlsPlayer(UI.spellStage.p)
    || document.getElementById('card-zoom')?.style.display==='flex' || chainIsOpen()) return;
  e.preventDefault(); e.stopImmediatePropagation(); UI.cancelSpellStage();
},true);

UI.beginSpellStage=function(p,handIdx,n){
  const draft={game:G,p,handIdx,n,ready:false,submitted:false,cancelRequested:false,committed:false};
  UI.spellStage=draft;
  UI.spellStageSubmitting=false;
  hideMenu(); closeModal(); UI.hideZoom();
  _moveArmed=false; _moveSel.clear();
  UI.render();
  UI.playSpellStageSound?.('place');
  return draft;
};

// 취소도 현재 선택의 응답으로 보낸다. 별도 액션 큐에 넣으면 선택 대기 뒤에 갇힌다.
// 카드 번호나 대상 정보를 뒷면 표시용으로 추가 전송하지 않는다.
UI.routeSpellStagePick=async function(draft,interactiveFn,serialize,deserialize){
  const interactive=()=>{
    if(draft.cancelRequested) return Promise.resolve(SPELL_STAGE_CANCEL);
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=value=>{
        if(settled) return;
        settled=true; draft.cancelPick=null; resolve(value);
      };
      draft.cancelPick=()=>finish(SPELL_STAGE_CANCEL);
      Promise.resolve().then(()=>settled?undefined:interactiveFn()).then(finish,error=>{
        if(settled) return;
        settled=true; draft.cancelPick=null; reject(error);
      });
    });
  };
  const encode=v=>v===SPELL_STAGE_CANCEL?SPELL_STAGE_CANCEL_WIRE:serialize(v);
  const decode=v=>v?.spellStageCancel===true?SPELL_STAGE_CANCEL:deserialize(v);
  const result=NET.online?await NET.choice(draft.p,interactive,encode,decode):await interactive();
  if(result===SPELL_STAGE_CANCEL || draft.game!==G) throw SPELL_STAGE_CANCEL;
  if(!draft.confirming && result!==null && result!==undefined && localControlsPlayer(draft.p))
    UI.playSpellStageSound?.('target');
  return result;
};

UI.cancelSpellStage=function(){
  const draft=UI.spellStage;
  if(!draft || draft.submitted || !localControlsPlayer(draft.p)) return;
  draft.cancelRequested=true;
  draft.ready=false;
  draft.cancelPick?.();
  // 남은 로컬 콜백을 실행하지 않는다. 다중 선택 루프가 다시 시작되지 않게 한다.
  _resolver=null; _pickableUids=null; _boardCardPick=null;
  closeModal(); UI.hideZoom(); clearPicking();
  document.getElementById('modal-box').replaceChildren();
  updateButtons(); UI.renderSpellStage();
};

UI.submitSpellStage=function(){
  const draft=UI.spellStage;
  if(!draft?.ready || draft.submitted || !localControlsPlayer(draft.p) || draft.cancelRequested) return;
  draft.submitted=true; draft.ready=false;
  settle(true);
  updateButtons(); UI.renderSpellStage();
};

UI.confirmSpellStage=async function(draft,targets){
  draft.targets=targets;
  draft.confirming=true;
  await routedPick(draft.p,()=>new Promise(resolve=>{
    _resolver=resolve;
    draft.ready=true;
    UI.prompt('대상 선택 완료 — 확인을 눌러 시전하거나 중앙 카드를 손패로 되돌려 취소하세요.');
    if(!targets.length) UI.prompt('확인을 눌러 주문을 시전하거나 중앙 카드를 손패로 되돌려 취소하세요.');
    else {
      const summary=document.createElement('div'); summary.className='spell-stage-targets';
      summary.textContent='선택한 대상: '+targets.map(t=>t.label||t.name).join(', ');
      document.getElementById('prompt-area').appendChild(summary);
    }
    updateButtons(); UI.renderSpellStage();
  }),v=>v,v=>v===true?true:SPELL_STAGE_CANCEL);
  draft.committed=true;
  UI.endSpellStage(draft);
};

UI.endSpellStage=function(draft){
  if(UI.spellStage!==draft) return;
  draft.cancelPick=null;
  draft.dispose?.();
  UI.spellStage=null;
  _resolver=null; _pickableUids=null; _boardCardPick=null;
  UI.unitSelectionPending=false; UI.placementPending=false;
  closeModal(); clearPicking();
  document.getElementById('spell-stage')?.remove();
  document.body.classList.remove('spell-staging');
  UI.renderSelectedTargets?.();
  if(G){ UI.render(); UI.promptForState(); }
};
UI.resetSpellStage=function(){
  UI.spellStageSubmitting=false;
  const draft=UI.spellStage;
  if(draft){ draft.cancelPick?.(); UI.endSpellStage(draft); }
};

UI.renderSpellStage=function(){
  const draft=UI.spellStage;
  if(!draft) return;
  if(draft.game!==G || G.winner!==null){ UI.resetSpellStage(); return; }
  const own=localControlsPlayer(draft.p) && !replayLock();
  UI.renderSelectedTargets?.();
  document.body.classList.add('spell-staging');
  let host=document.getElementById('spell-stage');
  if(!host){
    host=document.createElement('section'); host.id='spell-stage';
    host.setAttribute('aria-label',own?'시전 준비 중인 주문':'상대가 준비 중인 미지의 카드');
    let el;
    if(own){
      el=cardMiniEl(card(draft.n),{owner:draft.p});
      el.classList.add('spell-stage-card');
      el.title='손패로 드래그하여 시전 취소';
      el.onclick=e=>{e.preventDefault();e.stopPropagation();};
      attachSpellReturnDrag(el,draft);
    }else{
      el=document.createElement('div'); el.className='card-mini card-back spell-stage-card';
      el.setAttribute('role','img'); el.setAttribute('aria-label','미지의 카드');
    }
    const note=document.createElement('span'); note.className='spell-stage-note'; note.setAttribute('aria-live','polite');
    host.append(el,note);
    if(own){
      const cancel=document.createElement('button'); cancel.type='button';
      cancel.className='spell-stage-cancel'; cancel.textContent='손패로 되돌리기';
      cancel.onclick=UI.cancelSpellStage; host.appendChild(cancel);
    }
    document.body.appendChild(host);
    const position=()=>{
      const r=document.getElementById('center-info').getBoundingClientRect();
      const a=fixedLayoutSpace(r.left,r.top), b=fixedLayoutSpace(r.right,r.bottom);
      host.style.left=(a.x+b.x)/2+'px'; host.style.top=(a.y+b.y)/2+'px';
      host.style.width=Math.max(48,Math.min(122,b.x-a.x-6))+'px';
      host.style.setProperty('--stage-card-height',Math.max(40,Math.min(142,b.y-a.y-66))+'px');
    };
    const observer=new ResizeObserver(position);
    observer.observe(document.getElementById('center-info'));
    window.addEventListener('resize',position);
    window.addEventListener('scroll',position,true);
    draft.dispose=()=>{
      observer.disconnect(); window.removeEventListener('resize',position);
      window.removeEventListener('scroll',position,true);
    };
    position();
  }
  host.querySelector('.spell-stage-note').textContent=!own?'상대 주문 준비 중'
    :draft.cancelRequested?'취소 중...':draft.submitted?'확인 중...':draft.ready?'시전 준비 완료':'대상 선택 중';
  const cancel=host.querySelector('button');
  if(cancel) cancel.disabled=draft.submitted || draft.cancelRequested;
};

// 포인터 캡처를 써서 선택 오버레이가 떠 있어도 손패로 되돌릴 수 있다.
function attachSpellReturnDrag(el,draft){
  el.draggable=false;
  el.querySelectorAll('img').forEach(img=>img.draggable=false);
  el.addEventListener('dragstart',e=>e.preventDefault());
  let drag=null;
  const clear=()=>{
    drag=null; el.style.transform=''; el.classList.remove('spell-return-dragging');
    document.getElementById('hand-'+draft.p)?.classList.remove('drop-hint');
  };
  el.addEventListener('pointerdown',e=>{
    if(e.button!==0 || draft.submitted || draft.cancelRequested) return;
    clearTimeout(_lpTimer); UI.hideHover(); e.preventDefault(); e.stopPropagation();
    el.classList.add('spell-return-dragging');
    drag={id:e.pointerId,x:e.clientX,y:e.clientY}; el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove',e=>{
    if(!drag || e.pointerId!==drag.id) return;
    clearTimeout(_lpTimer);
    const a=fixedLayoutSpace(drag.x,drag.y), b=fixedLayoutSpace(e.clientX,e.clientY);
    el.style.transform=`translate(${b.x-a.x}px,${b.y-a.y}px)`;
    document.getElementById('hand-'+draft.p)?.classList.add('drop-hint');
  });
  el.addEventListener('pointerup',e=>{
    if(!drag || e.pointerId!==drag.id) return;
    const moved=Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>6;
    const r=document.getElementById('hand-'+draft.p).getBoundingClientRect();
    clear();
    if(moved && e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom) UI.cancelSpellStage();
  });
  el.addEventListener('pointercancel',clear);
  el.addEventListener('lostpointercapture',clear);
}
