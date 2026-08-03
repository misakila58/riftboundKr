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
      <div style="font-size:14px;line-height:1.7;margin-bottom:6px">정말 종료하시겠습니까?</div>`;
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
