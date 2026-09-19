// 공개 준비 화면과 결정론적 3D 주사위 연출. 게임 난수는 엔진만 소비한다.
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
  const animation=animateSetupDie(view,p,value,round,startsAt);
  // 양쪽 모두 사라지는 연출을 마쳐야 다음 플레이어의 입력을 받는다.
  if(NET.online) await Promise.all([0,1].map(seat=>setupChoice(seat,()=>animation.then(()=>true))));
  else await animation;
  return {instant:false};
};

// 화면이 XY 바닥이고 Z는 바닥에서 뜬 높이. 연출은 게임 난수를 소비하지 않는다.
function setupDiceRoute(view,p,value,round,startsAt){
  // 양쪽이 공유하는 시작 시각으로 연출만 변화시킨다. 같은 눈도 매번 다르게 던진다.
  let visualSeed=(Math.trunc(startsAt)^Math.imul(round,1013904223)^Math.imul(p+1,1664525))>>>0;
  const random=()=>{
    visualSeed=(visualSeed+0x6D2B79F5)>>>0;
    let n=Math.imul(visualSeed^(visualSeed>>>15),visualSeed|1);
    n^=n+Math.imul(n^(n>>>7),n|61);
    return ((n^(n>>>14))>>>0)/4294967296;
  };
  const width=view.overlay.clientWidth, height=view.overlay.clientHeight, size=68;
  const start={x:width*(.79+random()*.09),y:height*(.79+random()*.09)};
  const end={x:width*(.24+random()*.37),y:height*(.22+random()*.25)};
  const dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);
  const heading=Math.atan2(dy,dx)*180/Math.PI;
  const rollCount=1+Math.floor(random()*2);
  const rollingDistance=size*rollCount, radius=size/2;
  const flightDistance=length-rollingDistance;
  // 중력에 따른 포물선. 충돌할 때마다 반발 속도와 수평 속도가 줄어든다.
  const gravity=2600+random()*600, upward=140+random()*180, initialHeight=260+random()*120;
  const restitution=.34+random()*.16, friction=.53+random()*.20;
  const spin=360*(1+Math.floor(random()*3))+random()*180;
  const tiltAmount=(random()<.5?-1:1)*(24+random()*42), tiltCycles=2+random()*3;
  const rollEnd=2.45+random()*.30, wobble=2+random()*3;
  const first=(upward+Math.sqrt(upward*upward+2*gravity*initialHeight))/gravity;
  const rebound=(gravity*first-upward)*restitution;
  const second=2*rebound/gravity, third=second*restitution;
  const flightTime=first+second+third;
  const flightWeight=first+second*friction+third*friction*friction;
  const mine=NET.online?NET.seat===p:!setupBot(p);
  return {size,sample(t){
    let distance,heightAbove,angle,tilt=0;
    if(t<flightTime){
      let weight;
      if(t<first){heightAbove=initialHeight+upward*t-gravity*t*t/2;weight=t;}
      else if(t<first+second){const s=t-first;heightAbove=rebound*s-gravity*s*s/2;weight=first+s*friction;}
      else {const s=t-first-second;heightAbove=rebound*restitution*s-gravity*s*s/2;weight=first+second*friction+s*friction*friction;}
      const progress=weight/flightWeight;
      distance=flightDistance*progress;
      angle=-rollCount*90-spin*(1-progress);
      tilt=tiltAmount*Math.sin(progress*Math.PI)*Math.sin(progress*Math.PI*tiltCycles);
    }else if(t<rollEnd){
      // 바닥에 닿은 모서리를 축으로 구르며 점차 감속한다.
      const u=(t-flightTime)/(rollEnd-flightTime), turns=rollCount*(1-Math.pow(1-u,2));
      const whole=Math.min(rollCount-1,Math.floor(turns)), a=(turns-whole)*Math.PI/2;
      distance=flightDistance+whole*radius*2+radius*(1-Math.cos(a)+Math.sin(a));
      heightAbove=radius*(Math.cos(a)+Math.sin(a)-1);
      angle=-rollCount*90+turns*90;
    }else{
      const s=t-rollEnd;
      angle=wobble*Math.sin(s*22)*Math.exp(-s*9)*Math.max(0,1-s/.65);
      distance=length+radius*Math.sin(angle*Math.PI/180);
      heightAbove=radius*(Math.abs(Math.sin(angle*Math.PI/180))+Math.cos(angle*Math.PI/180)-1);
    }
    let x=start.x+dx*distance/length,y=start.y+dy*distance/length;
    if(!mine){x=width-x;y=height-y;}
    return {x,y,height:Math.max(0,heightAbove),angle,tilt,heading:heading+(mine?0:180)};
  }};
}

// 화면 비율에 맞춰 보드 위를 가로지르며, 각 화면에서는 자기 진영 기준으로 움직인다.
async function animateSetupDie(view,p,value,round,startsAt){
  const stage=document.createElement('div');stage.className='setup-dice-stage';stage.setAttribute('aria-label',pname(p)+' 주사위');
  stage.innerHTML='<div class="setup-dice-world"><div class="setup-dice-shadow"></div><div class="setup-dice-flight"><div class="setup-dice-camera"><div class="setup-die"></div></div></div></div><output class="setup-dice-number" aria-live="polite"></output>';
  const cube=stage.querySelector('.setup-die');
  const pips={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  for(let face=1;face<=6;face++){
    const el=document.createElement('div');el.className='setup-die-face face-'+face;
    for(let i=0;i<9;i++){const pip=document.createElement('i');if(pips[face].includes(i))pip.className='pip';el.appendChild(pip);}
    cube.appendChild(el);
  }
  view.overlay.appendChild(stage);view.overlay.dataset.stage='rolling';
  const flight=stage.querySelector('.setup-dice-flight'),shadow=stage.querySelector('.setup-dice-shadow');
  const landing={1:[0,0],2:[-90,0],3:[0,-90],4:[0,90],5:[90,0],6:[180,0]}[value];
  const duration=3400, route=setupDiceRoute(view,p,value,round,startsAt);
  const samples=Array.from({length:Math.round(duration*120/1000)+1},(_,i)=>route.sample(i/120));
  const movement=flight.animate(samples.map(s=>({transform:`translate(${s.x-34}px,${s.y-34}px) scale(${1+s.height/650})`})),{duration,fill:'both'});
  const rotation=cube.animate(samples.map(s=>({transform:`rotateZ(${s.heading}deg) rotateY(${s.angle}deg) rotateX(${s.tilt}deg) rotateX(${landing[0]}deg) rotateY(${landing[1]}deg)`})),{duration,fill:'both'});
  const shade=shadow.animate(samples.map(s=>({
    opacity:.32/(1+s.height/70),filter:`blur(${2+s.height/12}px)`,
    transform:`translate(${s.x-34+4}px,${s.y-34+5}px) rotate(${s.heading}deg) scale(${1+s.height/400})`,
  })),{duration,fill:'both'});
  const animations=[movement,rotation,shade];animations.forEach(a=>a.pause());view.animations.push(...animations);
  let frame=0;
  const paint=()=>{
    const elapsed=Math.max(0,setupNow(view)-startsAt);
    animations.forEach(a=>a.currentTime=Math.min(duration,elapsed));
    stage.style.visibility=setupNow(view)<startsAt?'hidden':'visible';
    if(elapsed<duration) frame=requestAnimationFrame(paint);
  };
  paint();await setupDelay(Math.max(0,startsAt+duration-setupNow(view)));cancelAnimationFrame(frame);
  animations.forEach(a=>a.currentTime=duration);stage.style.visibility='visible';
  const number=stage.querySelector('output'), end=samples[samples.length-1];
  number.style.left=end.x+'px'; number.style.top=Math.max(48,end.y-44)+'px';
  number.textContent=value;
  view.overlay.querySelector(`[data-seat="${p}"] .setup-roll-result`).textContent=value;
  view.overlay.dataset.stage='result';stage.dataset.value=value;
  await setupDelay(Math.max(0,startsAt+duration+1000-setupNow(view)));
  view.overlay.dataset.stage='clearing';stage.classList.add('is-clearing');
  await setupDelay(350);stage.remove();animations.forEach(a=>a.cancel());
  view.animations=view.animations.filter(a=>!animations.includes(a));view.overlay.dataset.stage='finished-roll';
}

UI.pickSetupOrder = async function(p,rolls){
  const view=_setupView;
  view.overlay.dataset.stage='order';view.button.hidden=true;
  view.status.textContent=NET.online&&NET.seat!==p?'상대가 선택 중입니다':`${pname(p)} 승리`;
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
