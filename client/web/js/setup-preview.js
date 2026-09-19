// Public setup review. Online confirmations use the existing seat-checked choice channel.
UI.reviewSetup = async function(){
  // 관전자는 좌석이 없다 — 두 플레이어의 확인만 기다리며 버튼은 누를 수 없다
  const game=G, online=NET.online, spect=online && NET.spectating, me=spect?0:(online?NET.seat:0);
  const overlay=document.createElement('div');
  overlay.className='setup-review';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-labelledby','setup-review-title');
  overlay.innerHTML='<section class="setup-review-box"><h2 id="setup-review-title">단판 게임 준비</h2><p>전설과 선발 챔피언, 무작위로 선택된 전장을 확인하세요.</p><div class="setup-review-players"></div><div class="setup-review-status" aria-live="polite"></div><button class="setup-review-confirm" type="button"><svg viewBox="0 0 104 104" aria-hidden="true"><circle cx="52" cy="52" r="48" pathLength="1"/></svg><span></span></button><p class="setup-review-hint"></p></section>';
  const players=overlay.querySelector('.setup-review-players');
  for(const p of [opp(me),me]){
    const section=document.createElement('section');
    section.className='setup-review-player';
    const heading=document.createElement('h3');
    heading.textContent=spect?pname(p):(p===me?'나':'상대')+' — '+pname(p);
    section.appendChild(heading);
    const cards=document.createElement('div'); cards.className='setup-review-cards';
    for(const [label,n] of [['전설',G.players[p].legendN],['선발 챔피언',G.players[p].champN],['무작위 전장',G.bfs[p].n]]){
      const c=card(n), figure=document.createElement('figure');
      const title=document.createElement('div'); title.textContent=label;
      const img=document.createElement('img'); img.src=cardImgUrl(artImg(c,p),480); img.alt=c.ko; img.draggable=false;
      const caption=document.createElement('figcaption'); caption.textContent=c.ko;
      figure.append(title,img,caption); cards.appendChild(figure);
    }
    section.appendChild(cards); players.appendChild(section);
  }
  const button=overlay.querySelector('button'), label=button.querySelector('span');
  const status=overlay.querySelector('.setup-review-status'), hint=overlay.querySelector('.setup-review-hint');
  label.textContent=spect?'관전 — 확인 대기':online?'꾹 눌러 확인':'시작';
  hint.textContent=spect?'두 플레이어가 확인하면 진행합니다.':online?'1.5초 동안 누르세요. 두 사람 모두 확인하면 진행합니다.':'시작을 누르면 선후공을 결정합니다.';
  if(spect) button.disabled=true;
  const previousFocus=document.activeElement, screen=document.getElementById('game-screen');
  const wasInert=screen.inert; screen.inert=true;
  document.body.appendChild(overlay);
  button.focus({preventScroll:true});
  const events=new AbortController(), opts={signal:events.signal};
  let frame=0, started=null, source=null, submitted=false, accept;
  const local=new Promise(resolve=>{accept=resolve;});
  const cancel=()=>{
    cancelAnimationFrame(frame); started=null; source=null;
    if(!submitted) button.style.setProperty('--progress','0');
  };
  const submit=()=>{
    if(submitted) return;
    submitted=true; cancel(); button.disabled=true;
    button.style.setProperty('--progress','1');
    label.textContent=online?'확인 전송 중':'시작'; accept(true);
  };
  const tick=now=>{
    if(started===null) return;
    const progress=Math.min(1,(now-started)/1500);
    button.style.setProperty('--progress',String(progress));
    if(progress>=1) submit(); else frame=requestAnimationFrame(tick);
  };
  const begin=kind=>{
    if(submitted || started!==null) return;
    source=kind; started=performance.now(); frame=requestAnimationFrame(tick);
  };
  if(spect){ /* 관전자는 입력 없음 */ }
  else if(online){
    button.addEventListener('pointerdown',e=>{
      if(e.button!==0) return;
      e.preventDefault(); button.focus({preventScroll:true}); button.setPointerCapture(e.pointerId); begin(e.pointerId);
    },opts);
    button.addEventListener('pointermove',e=>{
      if(source!==e.pointerId) return;
      const r=button.getBoundingClientRect();
      if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) cancel();
    },opts);
    for(const name of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(name,e=>{if(source===e.pointerId) cancel();},opts);
    button.addEventListener('keydown',e=>{
      if(e.key===' ' || e.key==='Enter'){e.preventDefault(); if(!e.repeat) begin('key');}
    },opts);
    button.addEventListener('keyup',e=>{if(e.key===' ' || e.key==='Enter'){e.preventDefault(); if(source==='key') cancel();}},opts);
    button.addEventListener('blur',cancel,opts);
    window.addEventListener('blur',cancel,opts);
    document.addEventListener('visibilitychange',()=>{if(document.hidden) cancel();},opts);
    button.addEventListener('contextmenu',e=>e.preventDefault(),opts);
  } else button.addEventListener('click',submit,opts);
  // Keep keyboard shortcuts and focus on the review while it blocks setup.
  overlay.addEventListener('keydown',e=>{
    if(e.key==='Tab'){e.preventDefault(); button.focus();}
    e.stopPropagation();
  },opts);
  try{
    if(online){
      const ready=[false,false];
      const update=()=>{
        status.textContent=spect?`${pname(0)}: ${ready[0]?'확인 완료':'확인 대기'} / ${pname(1)}: ${ready[1]?'확인 완료':'확인 대기'}`
          :`나: ${ready[me]?'확인 완료':'확인 대기'} / 상대: ${ready[opp(me)]?'확인 완료':'확인 대기'}`;
        if(!spect && ready[me]) label.textContent='확인 완료';
      };
      update();
      await Promise.all([0,1].map(p=>NET.choice(p,()=>local,v=>v,v=>v).then(()=>{ready[p]=true;update();})));
    } else await local;
  } finally {
    cancel(); events.abort(); overlay.remove(); screen.inert=wasInert;
    if(previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
  }
  return G===game;
};
