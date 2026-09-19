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
    // 1) 카드 확대가 열려 있으면 닫기
    const zoom=document.getElementById('card-zoom');
    if(zoom && zoom.style.display && zoom.style.display!=='none'){ UI.hideZoom(); return; }
    if(chainIsOpen()){ UI.hideChain(); return; }
    // 2) 컨텍스트 메뉴(능력/플레이 메뉴)가 열려 있으면 닫기
    const menu=document.getElementById('ctx-menu');
    if(menu && menu.style.display==='block'){ hideMenu(); return; }
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

// 가로 양방향을 허용한다. primary로 고정하면 반대쪽으로 들었을 때 뒤집히지 않는다.
(function(){
  const touch=matchMedia('(pointer: coarse)');
  const portrait=matchMedia('(orientation: portrait)');
  const guide=document.createElement('dialog');
  guide.id='landscape-guide';
  guide.setAttribute('aria-labelledby','landscape-guide-title');
  guide.innerHTML=`<div class="landscape-guide-content">
    <div class="landscape-guide-icon" aria-hidden="true">↔</div>
    <h2 id="landscape-guide-title">기기를 가로로 돌려 주세요</h2>
    <p>왼쪽과 오른쪽 어느 방향으로 들어도 플레이할 수 있습니다.</p>
    <button type="button">가로 전체 화면으로 시작</button>
    <p class="landscape-guide-note">자동으로 회전하지 않으면 기기의 화면 회전 잠금을 해제해 주세요.</p>
  </div>`;
  document.body.appendChild(guide);
  const button=guide.querySelector('button');
  button.hidden=!document.documentElement.requestFullscreen;
  let locking=false;
  async function lockLandscape(){
    if(!touch.matches || !screen.orientation?.lock || locking) return;
    locking=true;
    try { await screen.orientation.lock('landscape'); }
    catch(e) { /* 미지원 또는 전체 화면이 아닌 브라우저에서는 회전 안내를 사용한다. */ }
    finally { locking=false; }
  }
  function updateGuide(){
    const needed=touch.matches && portrait.matches;
    if(needed && !guide.open) guide.showModal();
    else if(!needed && guide.open) guide.close();
  }
  guide.addEventListener('cancel',e=>e.preventDefault());
  button.addEventListener('click',async()=>{
    try {
      if(!document.fullscreenElement) await document.documentElement.requestFullscreen();
      await lockLandscape();
    } catch(e) { /* 전체 화면 거절 시에도 수동 회전으로 계속할 수 있다. */ }
    updateGuide();
  });
  touch.addEventListener('change',updateGuide);
  portrait.addEventListener('change',updateGuide);
  document.addEventListener('fullscreenchange',()=>{ lockLandscape(); updateGuide(); });
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden){ lockLandscape(); updateGuide(); } });
  lockLandscape();
  updateGuide();
})();
