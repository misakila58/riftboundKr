// 시작 화면 배경 전환과 무입력 시 메뉴 숨김. 게임 난수·플레이매트 설정과는 별도로 관리한다.
(() => {
  const home = document.getElementById('connect-screen');
  const playmat = document.getElementById('home-playmat');
  const base = home.querySelector('.home-background img');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let current = PLAYMAT.names[Math.floor(Math.random() * PLAYMAT.names.length)];
  playmat.src = PLAYMAT.url(current);
  // 첫 화면의 이미지도 이번 순환에서 한 번 보여 준 것으로 센다.
  let remaining = PLAYMAT.names.filter(name => name !== current);
  let changing = false;
  const AUTO_CHANGE_MS = 30_000;
  let autoTimer;
  let autoActive = false;
  const IDLE_HIDE_MS = 20_000;
  const idleElements = [
    ...home.querySelectorAll('.home-header, .home-bottom'),
    document.getElementById('build-tag'), document.getElementById('legal-footer'),
  ];
  let idleTimer;
  let idleActive = false;
  let idleHidden = false;

  function restartAutoTimer(){
    clearTimeout(autoTimer);
    if(autoActive) autoTimer = setTimeout(changeBackground, AUTO_CHANGE_MS);
  }
  function syncAutoTimer(){
    const active = home.style.display !== 'none' && !document.hidden;
    if(active === autoActive) return;
    autoActive = active;
    restartAutoTimer();
  }

  function setIdleHidden(hidden){
    if(hidden === idleHidden) return;
    idleHidden = hidden;
    document.body.classList.toggle('home-idle', hidden);
    idleElements.forEach(element => { element.inert = hidden; });
  }
  function restartIdleTimer(){
    clearTimeout(idleTimer);
    if(idleActive && !idleHidden) idleTimer = setTimeout(() => setIdleHidden(true), IDLE_HIDE_MS);
  }
  function syncHomeTimers(){
    syncAutoTimer();
    // 선택 창이나 설정을 읽는 중에는 메뉴를 숨기지 않는다.
    const active = autoActive && !home.inert && !document.body.classList.contains('modal-open');
    if(active === idleActive) return;
    idleActive = active;
    setIdleHidden(false);
    restartIdleTimer();
  }
  function onActivity(event){
    if(!idleActive) return;
    if(idleHidden){
      // 첫 클릭은 메뉴 복원에만 사용한다. 숨겨진 버튼이나 배경 전환이 함께 실행되지 않게 한다.
      const keyboardWake = event.type === 'keydown' && ['Tab', 'Enter', ' ', 'Escape'].includes(event.key);
      if(event.type !== 'click' && !keyboardWake) return;
      event.preventDefault(); event.stopImmediatePropagation();
      setIdleHidden(false);
      restartAutoTimer();
      if(keyboardWake) home.querySelector('button').focus({preventScroll:true});
    }
    restartIdleTimer();
  }

  async function changeBackground(){
    // 직접 클릭하거나 자동 전환할 때마다 다음 전환까지 30초를 다시 센다.
    restartAutoTimer();
    if(changing) return;
    changing = true;
    if(!remaining.length) remaining = [...PLAYMAT.names];
    // 새 순환의 첫 이미지가 직전 순환의 마지막 이미지와 이어서 중복되지 않게 한다.
    const choices = remaining.filter(name => name !== current);
    const next = choices[Math.floor(Math.random() * choices.length)];
    try {
      const preload = new Image();
      preload.src = PLAYMAT.url(next);
      playmat.classList.add('is-faded');
      // 1초 페이드 아웃 → 기본 배경에서 0.01초 대기. 다음 이미지는 그동안 불러온다.
      await Promise.all([base.decode(), preload.decode(), wait(1010)]);
      playmat.src = preload.src;
      await playmat.decode();
      playmat.classList.remove('is-faded');
      await wait(1000);
      current = next;
      remaining.splice(remaining.indexOf(next), 1);
    } catch(error) {
      playmat.src = PLAYMAT.url(current);
      playmat.classList.remove('is-faded');
      console.warn('시작 화면 배경을 불러오지 못했습니다.', error);
    } finally {
      changing = false;
    }
  }

  home.addEventListener('click', event => {
    if(event.target.closest('button, a, input, select, textarea')) return;
    changeBackground();
  });
  document.addEventListener('click', onActivity, true);
  document.addEventListener('keydown', onActivity, true);
  ['pointermove', 'pointerdown', 'wheel', 'scroll'].forEach(type => {
    document.addEventListener(type, onActivity, {capture:true, passive:true});
  });
  // 메인 배경이 보일 때만 동작하며, 다시 돌아오면 30초부터 시작한다.
  new MutationObserver(syncHomeTimers).observe(home, {attributes:true, attributeFilter:['style', 'inert']});
  new MutationObserver(syncHomeTimers).observe(document.body, {attributes:true, attributeFilter:['class']});
  document.addEventListener('visibilitychange', syncHomeTimers);
  syncHomeTimers();
})();
