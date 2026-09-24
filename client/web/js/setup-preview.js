// 공개 준비 화면과 로컬 물리 주사위 연출. 게임 난수는 엔진만 소비한다.
let _setupView=null;
UI.setSetupStage = active=>document.body.classList.toggle('setup-in-progress',active);
UI.finishSetup = function(){
  if(!_setupView) return;
  const view=_setupView; _setupView=null;
  view.events.abort(); view.animations.forEach(a=>a.cancel());
  UI.hideHover(); UI.hideZoom(); view.overlay.remove();
  document.getElementById('game-screen').inert=view.wasInert;
};
const SETUP_DICE_PROTOCOL='setup-dice-1';
// 주사위 연출 재생 배속 — 물리 계산은 그대로 두고 프레임을 이 배수로 빨리 넘긴다(결과 표시·정리 대기도 같이 짧아진다). 1.0.93부터 2배(요청 2026-09-24: 느리다)
const SETUP_DICE_SPEED=2;
function setupChoice(p,local){ return NET.online?NET.choice(p,local,v=>v,v=>v):local(); }
function setupBot(p){ return typeof botIs==='function' && botIs(p); }
function setupDelay(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }
UI.reviewSetup = async function(){
  UI.finishSetup();
  // 관전자는 좌석이 없다(-1) — 위쪽 0번·아래쪽 1번으로 두고 입력 없이 두 플레이어의 진행만 지켜본다
  const spect=NET.online && NET.spectating;
  const game=G, online=NET.online, me=(online&&!spect)?NET.seat:0;
  const overlay=document.createElement('div');
  overlay.className='setup-review';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-labelledby','setup-review-title');
  overlay.innerHTML=`<section class="setup-review-box">
    <header class="setup-review-header"><span class="setup-review-eyebrow">RIFTBOUND / MATCH PREVIEW</span>
      <h2 id="setup-review-title">전투를 준비하세요</h2><p>양측의 전설, 선발 챔피언과 전장을 확인하세요.</p></header>
    <div class="setup-review-players"></div>
    <footer class="setup-review-footer"><div class="setup-review-guidance">
      <div class="setup-review-status" aria-live="polite"></div><p class="setup-review-hint"></p>
      <small>카드를 클릭하거나 우클릭, 길게 눌러 자세히 볼 수 있습니다.</small></div>
      <div class="setup-review-actions"><button class="setup-review-instant" type="button" title="주사위 애니메이션 없이 선후공을 무작위로 결정합니다" hidden>즉시 무작위 결정</button>
      <button class="setup-review-confirm" type="button"><svg viewBox="0 0 104 104" aria-hidden="true"><circle cx="52" cy="52" r="48" pathLength="1"/></svg><span></span></button></div>
    </footer></section>`;
  const players=overlay.querySelector('.setup-review-players');
  for(const p of [opp(me),me]){
    const section=document.createElement('section');
    section.className='setup-review-player '+(p===me?'is-self':'is-opponent'); section.dataset.seat=p;
    const heading=document.createElement('h3');
    const side=document.createElement('small'); side.textContent=spect?(p===0?'A':'B'):p===me?'나':'상대';
    const name=document.createElement('span'); name.textContent=pname(p);
    const result=document.createElement('output'); result.className='setup-roll-result'; result.setAttribute('aria-label',pname(p)+' 주사위 결과');
    heading.append(side,name,result);
    section.appendChild(heading);
    const cards=document.createElement('div'); cards.className='setup-review-cards';
    for(const [label,n] of [['전설',G.players[p].legendN],['선발 챔피언',G.players[p].champN],['무작위 전장',G.bfs[p].n]]){
      const c=card(n), figure=document.createElement('figure');
      const title=document.createElement('div'); title.textContent=label;
      const preview=document.createElement('button'); preview.type='button'; preview.className='setup-card-preview';
      preview.setAttribute('aria-label',c.ko+' 카드 정보'); preview.onclick=()=>UI.showZoom(c,p);
      attachCardHover(preview,c);
      const img=document.createElement('img'); img.src=cardImgUrl(artImg(c,p),480); img.alt=c.ko; img.draggable=false;
      const caption=document.createElement('figcaption'); caption.textContent=c.ko;
      preview.appendChild(img); figure.append(title,preview,caption); cards.appendChild(figure);
    }
    section.appendChild(cards); players.appendChild(section);
  }
  const button=overlay.querySelector('.setup-review-confirm');
  const screen=document.getElementById('game-screen'), wasInert=screen.inert;
  screen.inert=true; document.body.appendChild(overlay);
  const events=new AbortController();
  _setupView={game,overlay,button,instantButton:overlay.querySelector('.setup-review-instant'),events,wasInert,animations:[],clockOffset:0,clockReady:false,instant:false,
    status:overlay.querySelector('.setup-review-status'),hint:overlay.querySelector('.setup-review-hint')};
  button.disabled=true; _setupView.instantButton.disabled=true; button.querySelector('span').textContent='준비 중';
  overlay.addEventListener('keydown',e=>{
    if(e.key==='Tab'){
      const buttons=[...overlay.querySelectorAll('button:not(:disabled)')];
      if(buttons.length){ e.preventDefault(); const i=buttons.indexOf(document.activeElement); buttons[(i+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus(); }
    }
    e.stopPropagation();
  },{signal:events.signal});
  return G===game;
};

// 버튼을 놓거나 화면 밖으로 이동하면 원형 진행률을 초기화한다.
function setupHold(view,ms){
  const button=view.button, label=button.querySelector('span');
  button.disabled=false; button.style.setProperty('--progress','0');
  label.textContent=view.overlay.dataset.round==='1'&&view.overlay.dataset.roller==='0'?'시작':'주사위 굴리기';
  button.focus({preventScroll:true});
  return new Promise(resolve=>{
    const events=new AbortController(), opts={signal:events.signal};
    let frame=0, since=null, source=null, done=false;
    const cancel=()=>{ cancelAnimationFrame(frame); since=null; source=null; if(!done) button.style.setProperty('--progress','0'); };
    const finish=()=>{
      if(done) return; done=true; cancel(); events.abort(); button.disabled=true;
      button.style.setProperty('--progress','1'); label.textContent='굴리는 중';
      resolve({protocol:SETUP_DICE_PROTOCOL});
    };
    const tick=now=>{
      if(since===null) return;
      const progress=Math.min(1,(now-since)/ms); button.style.setProperty('--progress',progress);
      if(progress>=1) finish(); else frame=requestAnimationFrame(tick);
    };
    const begin=key=>{if(done||since!==null)return;source=key;since=performance.now();frame=requestAnimationFrame(tick);};
    button.addEventListener('pointerdown',e=>{
      if(e.button!==0) return; e.preventDefault(); button.focus({preventScroll:true});
      button.setPointerCapture(e.pointerId); begin(e.pointerId);
    },opts);
    button.addEventListener('pointermove',e=>{
      if(source!==e.pointerId)return;const r=button.getBoundingClientRect();
      if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) cancel();
    },opts);
    for(const name of ['pointerup','pointercancel','lostpointercapture'])
      button.addEventListener(name,e=>{if(source===e.pointerId) cancel();},opts);
    button.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!e.repeat)begin('key');}},opts);
    button.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(source==='key')cancel();}},opts);
    button.addEventListener('blur',cancel,opts);window.addEventListener('blur',cancel,opts);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();},opts);
    button.addEventListener('contextmenu',e=>e.preventDefault(),opts);
    view.events.signal.addEventListener('abort',()=>{cancel();events.abort();},{once:true});
  });
}

// 봇전에서는 한 번의 클릭으로 굴린다. 온라인과 같은 화면 대전은 길게 누르기 방식을 유지한다.
function setupClick(view){
  const button=view.button, instant=view.instantButton, label=button.querySelector('span');
  button.disabled=false; button.style.setProperty('--progress','0');
  instant.hidden=false; instant.disabled=false; instant.textContent='즉시 무작위 결정';
  label.textContent=view.overlay.dataset.round==='1'&&view.overlay.dataset.roller==='0'?'시작':'주사위 굴리기';
  button.focus({preventScroll:true});
  return new Promise(resolve=>{
    const events=new AbortController(), opts={signal:events.signal};
    let done=false;
    const finish=skip=>{
      if(done) return; done=true;
      events.abort(); button.disabled=true; instant.disabled=true;
      if(skip){
        view.instant=true; button.hidden=true; instant.textContent='결정 중';
        resolve({protocol:SETUP_DICE_PROTOCOL,instant:true}); return;
      }
      instant.hidden=true;
      button.style.setProperty('--progress','1'); label.textContent='굴리는 중';
      resolve({protocol:SETUP_DICE_PROTOCOL});
    };
    button.addEventListener('click',()=>finish(false),opts);
    instant.addEventListener('click',()=>finish(true),opts);
    button.addEventListener('contextmenu',e=>e.preventDefault(),opts);
    view.events.signal.addEventListener('abort',()=>events.abort(),{once:true});
  });
}

// 방장 시계에 맞춘 공통 시작 시각. 왕복 시간을 사용해 기기 시계 차이를 보정한다.
async function setupSyncClock(view){
  if(!NET.online || view.clockReady) return;
  const sent=await setupChoice(0,async()=>Date.now());
  const received=Date.now();
  const peer=await setupChoice(1,async()=>({received,sent:Date.now()}));
  const returned=Date.now();
  if(!Number.isFinite(sent)||!Number.isFinite(peer?.received)||!Number.isFinite(peer?.sent)) throw new Error('Invalid setup clock');
  const offset=await setupChoice(0,async()=>((peer.received-sent)+(peer.sent-returned))/2);
  if(!Number.isFinite(offset)) throw new Error('Invalid setup clock offset');
  view.clockOffset=NET.seat===1?offset:0;view.clockReady=true;
}
function setupNow(view){ return Date.now()-view.clockOffset; }

// 무작위 순서로 0.6초 간격을 두고 자동으로 굴린다. 첫 결과를 기다리지 않고 다음 주사위가 이어 나온다.
// 온라인은 공통 시작 시각으로 순서를 맞춘다. 물리 궤적은 각 기기가 계산하고 결과 값만 엔진 시드에서 받는다.
UI.rollSetupDiceBoth = async function(d0,d1,round){
  const view=_setupView; if(!view || view.game!==G) return;
  view.overlay.dataset.stage='hold'; view.overlay.dataset.round=round; delete view.overlay.dataset.roller;
  view.overlay.querySelectorAll('.setup-roll-result').forEach(el=>el.textContent='');
  view.overlay.querySelectorAll('.setup-review-player').forEach(el=>el.classList.remove('is-rolling-player'));
  view.button.hidden=true; view.instantButton.hidden=true;
  view.status.textContent=round>1?'무승부 — 다시 굴립니다':'선후공을 정하는 주사위를 굴립니다';
  view.hint.textContent='';
  // 무승부 재굴림(round>1)은 물리 연출을 생략하고 결과만 보여 준다 (요청 2026-09-24). 눈은 이미 시드에서 정해져 있고
  // 온라인 양쪽이 같은 round를 보므로 시작 시각 동기화 선택을 건너뛰어도 선택 순번은 어긋나지 않는다 — 완료 확인(finishSetupDice)은 그대로 둔다.
  if(round>1){   // 무승부 재굴림: 연출 없이 결과만 (재접속 따라잡기는 아래 — 선택 순번을 원래 판과 맞춰야 한다)
    UI.hideHover(); UI.hideZoom();
    await finishSetupDice(view,(async()=>{
      await setupDelay(NET.catchingUp?0:500);
      if(view.events.signal.aborted) return false;
      for(const [p,v] of [[0,d0],[1,d1]]){ const el=view.overlay.querySelector(`[data-seat="${p}"] .setup-roll-result`); if(el) el.textContent=v; }
      view.overlay.dataset.stage='result';
      await setupDelay(NET.catchingUp?0:900);
      view.overlay.dataset.stage='finished-roll';
      return !view.events.signal.aborted;
    })());
    return;
  }
  let startsAt;
  if(NET.online){
    await setupSyncClock(view);
    startsAt=await setupChoice(0,async()=>Date.now()+400);   // 시작 전 여유(왕복 보정 뒤 양쪽 동시 시작)
    if(!Number.isFinite(startsAt)) throw new Error('Invalid dice start time');
  } else startsAt=Date.now()+(round>1?300:450);
  // 재접속 따라잡기: 시계 동기화·시작 시각 선택은 원래 판과 똑같이 거쳐(로그의 선택 번호가 그 순서로 온다) 연출만 생략한다
  if(NET.catchingUp){
    UI.hideHover(); UI.hideZoom();
    await finishSetupDice(view,(async()=>{
      for(const [p,v] of [[0,d0],[1,d1]]){ const el=view.overlay.querySelector(`[data-seat="${p}"] .setup-roll-result`); if(el) el.textContent=v; }
      view.overlay.dataset.stage='finished-roll';
      return !view.events.signal.aborted;
    })());
    return;
  }
  UI.hideHover(); UI.hideZoom();
  // 공통 시작 시각을 섞어 순서를 정한다. 게임 난수와 온라인 선택 순서는 그대로 유지한다.
  let orderSeed=(Math.trunc(startsAt)^Math.imul(round,1013904223))>>>0;
  orderSeed=Math.imul(orderSeed^(orderSeed>>>16),0x45d9f3b);
  orderSeed=Math.imul(orderSeed^(orderSeed>>>16),0x45d9f3b);
  const first=(orderSeed^(orderSeed>>>16))&1, values=[d0,d1];
  await finishSetupDice(view,animateSetupDice(view,[
    {p:first,value:values[first],delay:0},
    {p:opp(first),value:values[opp(first)],delay:600},
  ],startsAt));
};
UI.rollSetupDice = async function(p,value,round){
  const view=_setupView; if(!view || view.game!==G) return;
  const local=!NET.online||NET.seat===p;
  const botMatch=!NET.online&&(setupBot(0)||setupBot(1));
  view.overlay.dataset.stage='hold';view.overlay.dataset.roller=p;view.overlay.dataset.round=round;
  if(p===0) view.overlay.querySelectorAll('.setup-roll-result').forEach(el=>el.textContent='');
  view.overlay.querySelectorAll('.setup-review-player').forEach(el=>el.classList.toggle('is-rolling-player',+el.dataset.seat===p));
  view.status.textContent=round>1?'무승부 — 다시 굴립니다':p===0?(NET.online?'방장부터 주사위를 굴립니다':pname(p)+'부터 주사위를 굴립니다'):'다음 플레이어의 차례';
  view.hint.textContent=local&&!setupBot(p)?(botMatch?'버튼을 눌러 시작하세요':''):`${pname(p)}의 주사위를 기다리는 중`;
  view.button.hidden=false;view.button.disabled=true;view.button.style.setProperty('--progress','0');
  view.button.querySelector('span').textContent='상대 차례';
  if(view.instant){
    view.button.hidden=true; view.instantButton.hidden=false; view.instantButton.disabled=true; view.instantButton.textContent='결정 중';
    view.overlay.querySelector(`[data-seat="${p}"] .setup-roll-result`).textContent=value;
    view.status.textContent='선후공을 무작위로 결정하는 중'; view.hint.textContent='';
    return {instant:true};
  }
  const held=await setupChoice(p,()=>setupBot(p)?setupDelay(600).then(()=>({protocol:SETUP_DICE_PROTOCOL})):botMatch?setupClick(view):setupHold(view,round>1?1000:1500));
  if(held?.protocol!==SETUP_DICE_PROTOCOL){
    view.status.textContent='앱 버전이 다릅니다. 두 사람 모두 최신 버전으로 다시 시작해 주세요.';
    UI.toast(view.status.textContent,'warn');
    throw new Error('Incompatible setup dice protocol');
  }
  if(held.instant){
    view.instant=true;
    view.overlay.querySelector(`[data-seat="${p}"] .setup-roll-result`).textContent=value;
    view.status.textContent='선후공을 무작위로 결정하는 중'; view.hint.textContent='';
    return {instant:true};
  }
  await setupSyncClock(view);
  // host=seat 0; result는 엔진의 공통 시드에서 이미 동일하게 결정되어 있다.
  const startsAt=await setupChoice(0,async()=>Date.now()+700);
  if(!Number.isFinite(startsAt)) throw new Error('Invalid dice start time');
  UI.hideHover(); UI.hideZoom();
  view.button.disabled=true;view.button.querySelector('span').textContent='굴리는 중';
  view.hint.textContent='';view.status.textContent=`${pname(p)}의 주사위`;
  await finishSetupDice(view,animateSetupDice(view,[{p,value,delay:0}],startsAt));
  return {instant:false};
};

// Physics is calculated locally before any frames are shown. Only final game values are shared.
async function animateSetupDice(view,dice,startsAt){
  UI.prepareDiceAudio?.();
  let simulation=null;
  try{
    if(typeof SetupDicePhysics==='undefined' || typeof CANNON==='undefined') throw new Error('physics library missing');
    simulation=await SetupDicePhysics.simulate(view.overlay.clientWidth,view.overlay.clientHeight,
      dice.map(d=>({...d,mine:view.overlay.querySelector(`[data-seat="${d.p}"]`).classList.contains('is-self')})));
  }catch(e){
    // 라이브러리가 없거나 시뮬레이션이 정착하지 못하면 연출 없이 결과만 보여 주고 넘어간다 — 게임 시작이 막히면 안 된다
    console.warn('setup dice physics fallback:', e && e.message);
    if(view.events.signal.aborted) return false;
    await new Promise(r=>setTimeout(r, Math.max(0, startsAt-setupNow(view))+400));
    for(const d of dice){ const el=view.overlay.querySelector(`[data-seat="${d.p}"] .setup-roll-result`); if(el) el.textContent=d.value; }
    view.overlay.dataset.stage='result';
    await new Promise(r=>setTimeout(r,900));
    view.overlay.dataset.stage='finished-roll';
    return !view.events.signal.aborted;
  }
  if(view.events.signal.aborted) return false;
  const pips={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  const stages=simulation.tracks.map(track=>{
    const stage=document.createElement('div');
    stage.className='setup-dice-stage '+(track.mine?'is-self':'is-opponent');
    stage.setAttribute('aria-label',pname(track.p)+' 주사위');
    stage.style.setProperty('--die-size',simulation.size+'px');
    stage.style.setProperty('--die-half',simulation.size/2+'px');
    stage.style.visibility='hidden';
    stage.innerHTML='<div class="setup-dice-world"><div class="setup-dice-shadow"></div><div class="setup-dice-flight"><div class="setup-dice-camera"><div class="setup-die"></div></div></div></div><output class="setup-dice-number" aria-live="polite"></output>';
    const cube=stage.querySelector('.setup-die');
    for(let face=1;face<=6;face++){
      const el=document.createElement('div');el.className='setup-die-face face-'+face;
      el.dataset.value=track.labels[face];
      for(let i=0;i<9;i++){
        const pip=document.createElement('i');if(pips[track.labels[face]].includes(i)) pip.className='pip';
        el.appendChild(pip);
      }
      cube.appendChild(el);
    }
    view.overlay.appendChild(stage);
    return {track,stage,cube,flight:stage.querySelector('.setup-dice-flight'),
      shadow:stage.querySelector('.setup-dice-shadow'),number:stage.querySelector('output')};
  });
  const duration=Math.max(...simulation.tracks.map(t=>t.delay+(t.frames.length-1)*simulation.step));
  view.overlay.dataset.stage='rolling';
  // Frame-based completion: a hidden/stalled tab cannot acknowledge an unseen animation via a timer.
  return new Promise(resolve=>{
    let frame=0,previous=null,elapsed=0,resultShown=false,clearing=false,impactIndex=0;
    const finish=completed=>{
      if(finished) return; finished=true; clearTimeout(hard);
      cancelAnimationFrame(frame);
      UI.stopDiceAudio?.();
      view.events.signal.removeEventListener('abort',abort);
      stages.forEach(({stage})=>stage.remove());
      if(completed) view.overlay.dataset.stage='finished-roll';
      resolve(completed);
    };
    const abort=()=>finish(false);
    view.events.signal.addEventListener('abort',abort,{once:true});
    const paint=now=>{
      if(document.hidden || setupNow(view)<startsAt){UI.stopDiceAudio?.();previous=null;frame=requestAnimationFrame(paint);return;}
      if(previous!==null) elapsed+=Math.min(100,now-previous)*SETUP_DICE_SPEED;   // 배속 재생 (충돌음·둘째 주사위 지연·결과 대기 모두 sim 시간 기준이라 함께 빨라진다)
      previous=now;
      while(impactIndex<simulation.impacts.length && simulation.impacts[impactIndex].time<=elapsed){
        UI.playDiceImpact?.(simulation.impacts[impactIndex++]);
      }
      for(const {track,stage,cube,flight,shadow,number} of stages){
        if(elapsed<track.delay) continue;
        stage.style.visibility='visible';
        const index=Math.min(track.frames.length-1,Math.floor((elapsed-track.delay)/simulation.step));
        const sample=track.frames[index],half=simulation.size/2;
        flight.style.transform=`translate(${sample.x-half}px,${sample.y-half}px) scale(${1+sample.height/650})`;
        cube.style.transform=sample.rotation;
        shadow.style.opacity=.32/(1+sample.height/70);
        shadow.style.filter=`blur(${2+sample.height/12}px)`;
        shadow.style.transform=`translate(${sample.x-half+4}px,${sample.y-half+5}px) scale(${1+sample.height/400})`;
        if(elapsed>=duration&&!resultShown){
          number.style.left=sample.x+'px';number.style.top=Math.max(48,sample.y-44)+'px';
          number.textContent=track.value;stage.dataset.value=track.value;
          view.overlay.querySelector(`[data-seat="${track.p}"] .setup-roll-result`).textContent=track.value;
        }
      }
      if(elapsed>=duration&&!resultShown){resultShown=true;view.overlay.dataset.stage='result';}
      if(elapsed>=duration+1000&&!clearing){
        clearing=true;view.overlay.dataset.stage='clearing';stages.forEach(({stage})=>stage.classList.add('is-clearing'));
      }
      if(elapsed>=duration+1350) finish(true);
      else frame=requestAnimationFrame(paint);
    };
    frame=requestAnimationFrame(paint);
    // 탭이 숨겨지면 requestAnimationFrame이 멈춰 완료 신호가 안 나가고 온라인 상대가 무한 대기한다 —
    // 연출 길이 + 여유가 지나면 그림과 무관하게 결과를 적고 완료 처리한다
    var finished=false;
    var hard=setTimeout(()=>{
      for(const {track} of stages){ const el=view.overlay.querySelector(`[data-seat="${track.p}"] .setup-roll-result`); if(el) el.textContent=track.value; }
      finish(true);
    }, Math.max(0, startsAt-setupNow(view))+(duration+1350)/SETUP_DICE_SPEED+2500);
  });
}

async function finishSetupDice(view,animation){
  const completed=await animation;
  if(!completed || view.events.signal.aborted || view.game!==G) throw new Error('Setup dice cancelled');
  if(NET.online){
    view.status.textContent='상대의 주사위 연출이 끝나기를 기다리는 중';
    // Register in seat order, and acknowledge only AFTER both local dice have finished.
    const ready=await Promise.all([0,1].map(seat=>setupChoice(seat,async()=>true)));
    if(view.events.signal.aborted || view.game!==G) throw new Error('Setup dice cancelled');
    if(ready.some(value=>value!==true)) throw new Error('Invalid setup dice completion');
  }
}

UI.pickSetupOrder = async function(p,rolls){
  const view=_setupView;
  view.overlay.dataset.stage='order';view.button.hidden=true;
  view.status.textContent=NET.online&&NET.seat!==p?(rolls?'상대가 선택 중입니다':`이전 게임 패자 ${pname(p)}이(가) 선후공을 고르는 중`):rolls?`${pname(p)} 승리`:'이전 게임 패자 — 선후공을 선택하세요';
  view.hint.textContent=NET.online&&NET.seat!==p?'':'선공과 후공 중 선택하세요';
  view.overlay.querySelectorAll('.setup-review-player').forEach(el=>el.classList.toggle('is-rolling-player',+el.dataset.seat===p));
  return UI.pickOption(p,'주사위 승리 — 선공과 후공 선택',[
    {v:'first',label:'선공',setupOrder:true},{v:'second',label:'후공',setupOrder:true}
  ]);
};
UI.setupOrderLocal = function(p,options){
  const view=_setupView;
  return new Promise(resolve=>{
    const panel=document.createElement('div');panel.className='setup-order-options';
    options.forEach((o,i)=>{
      const b=document.createElement('button');b.type='button';b.className='setup-order-option';
      const name=document.createElement('strong');name.textContent=o.label;
      const note=document.createElement('small');note.textContent=i===0?'먼저 행동합니다':'첫 전개에 룬 +1';
      b.append(name,note);b.onclick=()=>{panel.remove();resolve(i);};panel.appendChild(b);
    });
    view.overlay.querySelector('.setup-review-footer').appendChild(panel);
    panel.querySelector('button').focus({preventScroll:true});
  });
};
