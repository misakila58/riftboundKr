// ══════════ 스크립트 로드 확인 ══════════
// 모바일(카카오톡 인앱 브라우저·삼성 인터넷 등)에서 네트워크가 흔들리면 스크립트 파일 하나가 중간에 끊겨 실행되지 않을 때가 있다.
// 그러면 SFX·UI.reviewSetup 같은 전역이 비어 게임 시작(주사위·멀리건)에서 '… is not defined / is not a function'으로 멈춘다
// (제보 2026-09-30: dice-audio.js SFX is not defined · engine.js UI.reviewSetup is not a function).
// 모든 스크립트 중 가장 먼저 로드되어, 실패한 스크립트를 기록하고 페이지 로드가 끝나면 필수 기능이 다 있는지 확인한다.
// 빠진 게 있으면 한 번만 자동 새로고침하고, 그래도 빠지면 새로고침 안내를 띄운다.
(function(){
  var failed = [];
  window.addEventListener('error', function(e){
    var t = e && e.target;
    if(t && t.tagName === 'SCRIPT' && t.src) failed.push(t.src.replace(/^.*\/js\//, 'js/'));
  }, true);
  function missing(){
    var out = [];
    try{
      if(typeof SFX === 'undefined') out.push('sfx');
      if(typeof UI === 'undefined') { out.push('ui'); return out; }
      if(typeof UI.reviewSetup !== 'function') out.push('setup-preview');
      if(typeof UI.prepareDiceAudio !== 'function') out.push('dice-audio');
      if(typeof NET === 'undefined') out.push('net');
      if(typeof G === 'undefined' && typeof newGame !== 'function') out.push('engine');
      if(typeof MATCH === 'undefined') out.push('main');
    }catch(e){ out.push('?'); }
    return out;
  }
  window.addEventListener('load', function(){
    var miss = missing();
    if(!miss.length && !failed.length){ try{ sessionStorage.removeItem('rb_boot_retry'); }catch(e){} return; }
    var tried = false;
    try{ tried = sessionStorage.getItem('rb_boot_retry') === '1'; }catch(e){}
    console.warn('[boot] 스크립트 로드 실패', failed, '빠진 기능', miss);
    if(!tried){
      try{ sessionStorage.setItem('rb_boot_retry', '1'); }catch(e){}
      location.reload();
      return;
    }
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;padding:10px 14px;background:#6b2a1a;color:#fff;font-size:14px;text-align:center';
    bar.textContent = '⚠ 일부 파일을 불러오지 못했습니다 (네트워크가 불안정합니다). ';
    var b = document.createElement('button');
    b.textContent = '새로고침';
    b.style.cssText = 'margin-left:8px;padding:4px 12px';
    b.onclick = function(){ try{ sessionStorage.removeItem('rb_boot_retry'); }catch(e){} location.reload(); };
    bar.appendChild(b);
    document.body.appendChild(bar);
  });
})();
