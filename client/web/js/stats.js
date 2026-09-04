// ══════════ 익명 사용 통계 (STATS) ══════════
// 목적: "게임이 얼마나 플레이되는가"와 "어떤 덱 조합이 어떤 덱을 이기는가"를 파악한다.
//
// 설계 원칙 — 애초에 개인정보를 만들지 않는다.
//   · 설치 ID·기기 ID를 만들지도, 보내지도 않는다
//   · 닉네임·덱 이름·계정·채팅은 보내지 않는다
//   · 덱은 '전설 번호 + 선발 챔피언 번호'만 보낸다 (공개 카드 정보 = 아키타입 구분용)
//   · 시각을 보내지 않는다 (서버가 날짜 단위로만 집계)
//   · 서버는 개별 요청을 저장하지 않고 카운터만 올린다
// 즉 전송물은 "봇전 한 판이 끝났고 카이사/다리우스가 애니/고집쟁이에게 이겼다" 수준의 익명 숫자다.
//
// 설정에서 언제든 끌 수 있고(STATS.enabled), 꺼져 있으면 아무것도 보내지 않는다.
// 전송은 실패해도 게임에 영향을 주지 않는다 (fire-and-forget · 응답을 기다리지 않음).
const STATS = {
  // 게임 서버와 같은 출처로 보낸다 (server.js의 /api/stats). 별도 배포·CORS가 필요 없다.
  // 데스크톱 앱(file://)에서는 공식 서버로 보낸다. 비우면 통계 기능 전체가 꺼진다.
  get URL(){
    if(/^https?:$/.test(location.protocol)) return location.origin;
    return (typeof OFFICIAL_SERVER!=='undefined') ? OFFICIAL_SERVER : '';
  },
  KEY_OPTOUT: 'rb_stats_off',
  KEY_DAY: 'rb_stats_day',
};

// 사용자가 껐는지 (기본값: 켜짐)
STATS.enabled = function(){
  if(!STATS.URL) return false;
  try{ return localStorage.getItem(STATS.KEY_OPTOUT) !== '1'; }catch(e){ return false; }
};
STATS.setEnabled = function(on){
  try{ localStorage.setItem(STATS.KEY_OPTOUT, on ? '0' : '1'); }catch(e){}
};

STATS._send = function(payload){
  if(!STATS.enabled()) return;
  try{
    payload.v = (typeof BUILDINFO!=='undefined' && BUILDINFO.version) || 'unknown';
    const body = JSON.stringify(payload);
    // keepalive: 창을 닫는 중에도 마지막 전송이 살아남게 한다
    fetch(STATS.URL.replace(/\/+$/,'') + '/api/stats', {
      method:'POST', headers:{'content-type':'application/json'}, body, keepalive:true,
    }).catch(()=>{});          // 실패는 조용히 무시 — 게임에 영향 없음
  }catch(e){}
};

// 하루 한 번 "오늘 켰다" 신호. 날짜는 이 컴퓨터에만 저장하고 서버로 보내지 않으므로,
// 서버는 개수만 알 뿐 누가 보냈는지 알 수 없다.
STATS.launch = function(){
  if(!STATS.enabled()) return;
  try{
    const d = new Date().toISOString().slice(0,10);
    if(localStorage.getItem(STATS.KEY_DAY) === d) return;
    localStorage.setItem(STATS.KEY_DAY, d);
    STATS._send({ ev:'active_day' });
  }catch(e){}
};

// 온라인·P2P는 양쪽이 같은 판을 보고하면 두 번 세어진다 → 좌석 0(방장)만 보고한다.
STATS._isReporter = function(mode){
  if(mode==='bot' || mode==='hotseat') return true;
  return (typeof NET!=='undefined') && NET.seat === 0;
};

STATS.mode = null;    // 현재 판의 모드 (종료 보고에 쓴다)
STATS._ended = false; // 한 판의 종료를 두 번 보고하지 않도록

STATS.gameStart = function(mode){
  STATS.mode = mode; STATS._ended = false;
  if(!STATS._isReporter(mode)) return;
  STATS._send({ ev:'game_start', mode });
};

// end: 'normal'(득점 승리) · 'surrender'(항복) · 'left'(상대 이탈)
STATS.gameEnd = function(winner, end){
  const mode = STATS.mode;
  if(!mode || STATS._ended) return;
  STATS._ended = true;
  if(!STATS._isReporter(mode)) return;
  if(typeof G==='undefined' || !G || !G.players) return;
  const side = P => ({ legend: P.legendN|0, champ: P.champN|0 });
  STATS._send({
    ev:'game_end', mode, end: end||'normal',
    turns: Math.ceil((G.turnCount||0)/2),
    a: side(G.players[0]), b: side(G.players[1]),
    winner: winner===1 ? 1 : 0,
  });
};
