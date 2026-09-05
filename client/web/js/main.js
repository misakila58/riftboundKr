// ══════════ 화면 흐름: 로그인 → 메뉴 → (덱 관리 | 로비 | 핫시트) → 게임 ══════════

const SCREENS = ['connect-screen','login-screen','menu-screen','decks-screen','editor-screen','lobby-screen','p2p-screen','replay-screen','patch-screen','record-screen','setup-screen','game-screen'];
// 지금 보이는 화면 (패치 노트처럼 '왔던 곳으로' 돌아가야 하는 화면에 쓴다)
function currentScreen(){
  return SCREENS.find(id=>{ const e=document.getElementById(id); return e && e.style.display!=='none'; }) || 'connect-screen';
}
function showScreen(id){
  SCREENS.forEach(s=>{ document.getElementById(s).style.display = s===id ? 'flex' : 'none'; });
  // 법적 고지 푸터: 게임 화면에서는 보드를 가리지 않게 숨김, 그 외 입장 화면에서는 상시 노출
  const lf=document.getElementById('legal-footer');
  if(lf) lf.style.display = (id==='game-screen') ? 'none' : 'block';
  updateLegalPad();
}
// 고정 푸터의 실제 높이를 CSS 변수(--legal-h)로 알려, 각 화면이 그만큼 하단 여백을 확보한다
// (여백 없이는 낮은 해상도에서 스크롤 끝까지 내려도 마지막 내용이 푸터에 깔려 안 보인다)
function updateLegalPad(){
  const lf=document.getElementById('legal-footer');
  const h=(lf && lf.style.display!=='none') ? lf.offsetHeight : 0;
  document.documentElement.style.setProperty('--legal-h', h+'px');
}
window.addEventListener('resize', updateLegalPad);
// 초기 로드 직후엔 폰트·줄바꿈이 확정되기 전이라 푸터 높이가 실제보다 작게 재어진다
// → 푸터의 렌더 크기 변화를 직접 감시해 그때마다 다시 잰다
window.addEventListener('DOMContentLoaded', ()=>{
  const lf=document.getElementById('legal-footer');
  if(lf && window.ResizeObserver) new ResizeObserver(updateLegalPad).observe(lf);
});

// ---------- 화면 배율 ----------
// 폰마다 체감 크기가 달라, 기기 해상도 자동 감지 대신 사용자가 눈으로 보고 배율을 고른다.
// zoom은 vh/고정 요소 포함 전체 UI에 적용되고 localStorage로 유지된다.
const UISCALE_KEY='rb_ui_scale';
function uiScale(){ const v=parseFloat(localStorage.getItem(UISCALE_KEY)); return (v>=0.6&&v<=1.6)?v:1; }
function applyUiScale(v){ document.documentElement.style.zoom=v; updateLegalPad(); }
function showScalePicker(firstRun){
  const box=document.getElementById('modal-box');
  box.innerHTML='<h3>🔍 화면 배율</h3><div style="font-size:13px;color:#9aa4bd;margin-bottom:10px">'+
    (firstRun ? '화면이 잘리거나 글자가 너무 작으면 배율을 조절하세요.<br>누르는 즉시 적용됩니다 — 나중에 첫 화면·ESC 메뉴에서 언제든 변경 가능'
              : '누르는 즉시 적용됩니다')+'</div>';
  const btns=document.createElement('div'); btns.className='modal-btns';
  [0.7,0.8,0.9,1,1.1,1.25,1.4].forEach(v=>{
    const b=document.createElement('button');
    b.textContent=Math.round(v*100)+'%';
    if(Math.abs(uiScale()-v)<0.01) b.className='primary';
    b.onclick=()=>{ applyUiScale(v); try{localStorage.setItem(UISCALE_KEY,String(v));}catch(e){} showScalePicker(firstRun); };
    btns.appendChild(b);
  });
  box.appendChild(btns);
  const done=document.createElement('div'); done.className='modal-btns';
  const ok=document.createElement('button'); ok.className='primary'; ok.textContent='완료'; ok.onclick=closeModal;
  done.appendChild(ok); box.appendChild(done);
  openModal(); markModalDismissable();
}

let myDecks = [];

// ---------- 덱 저장소 추상화: 서버(계정) 또는 로컬(이 컴퓨터) ----------
// P2P/서버리스 모드에서는 덱이 localStorage에만 저장된다.
const DeckStore = {
  local:false,
  returnTo:'menu-screen',   // 덱 관리 화면에서 돌아갈 곳
  _read(){ try{ return JSON.parse(localStorage.getItem('rb_local_decks')||'[]'); }catch(e){ return []; } },
  _write(a){ localStorage.setItem('rb_local_decks', JSON.stringify(a)); },
  async list(){ return this.local ? this._read() : NET.getDecks(); },
  async save(deck,index){
    if(!this.local){
      try{ return await NET.saveDeck(deck,index); }
      catch(e){
        // 서버에 못 넣었다고 편집 내용을 버리지 않는다 — 이 기기에 넣어 두고
        // 다시 로그인해 메뉴로 들어올 때 자동으로 올린다.
        pendingDeckAdd(deck, index);
        const why = /로그인/.test(e.message) ? '로그인이 풀렸습니다' : e.message;
        throw new Error(why + ' — 덱은 이 기기에 임시 보관했습니다. 다시 로그인하면 자동으로 올라갑니다.');
      }
    }
    const a=this._read();
    if(index!==undefined&&index!==null){ if(!a[index]) throw new Error('덱이 없습니다'); a[index]=deck; }
    else { if(a.length>=20) throw new Error('덱은 최대 20개까지 저장할 수 있습니다'); a.push(deck); }
    this._write(a); return a;
  },
  async del(idx){
    if(!this.local) return NET.delDeck(idx);
    const a=this._read(); a.splice(idx,1); this._write(a); return a;
  },
};

// ---------- 서버에 못 올린 덱 임시 보관 ----------
// 서버 저장이 실패하는 가장 흔한 이유는 서버 재시작으로 로그인 세션이 끊긴 경우다.
// 그때 편집 내용을 버리면 40장을 다시 짜야 하므로, 이 기기에 담아 두었다가 나중에 올린다.
function pendingKey(){ return 'rb_pending_decks_'+(NET.base||'local'); }
function pendingDeckList(){
  try{ return JSON.parse(localStorage.getItem(pendingKey())||'[]'); }catch(e){ return []; }
}
function pendingDeckWrite(a){
  try{ localStorage.setItem(pendingKey(), JSON.stringify(a)); }catch(e){}
}
function pendingDeckAdd(deck, index){
  const a=pendingDeckList();
  // 같은 덱을 여러 번 시도해도 하나만 남게 한다 (이름 + 덮어쓸 위치 기준)
  const i=a.findIndex(x=>x.deck.name===deck.name && x.index===(index??null));
  const item={ deck, index: index??null, at: Date.now() };
  if(i>=0) a[i]=item; else a.push(item);
  pendingDeckWrite(a.slice(-20));
}
// 로그인 후 메뉴로 들어올 때 밀린 덱을 올린다. 실패하면 그대로 남겨 둔다.
async function pendingDeckFlush(){
  const a=pendingDeckList();
  if(!a.length || DeckStore.local) return;
  const left=[]; let ok=0;
  for(const item of a){
    try{ myDecks = await NET.saveDeck(item.deck, item.index===null?undefined:item.index); ok++; }
    catch(e){ left.push(item); }
  }
  pendingDeckWrite(left);
  if(ok) UI.toast(`임시 보관해 둔 덱 ${ok}개를 서버에 저장했습니다`);
  if(left.length) UI.toast(`덱 ${left.length}개는 아직 올리지 못했습니다 — 이 기기에 남아 있습니다`,'warn');
}

// ---------- 전설 목록/덱 자동 구성 (핫시트·자동완성 공용) ----------
function legendList(){ return CARDS.filter(c=>c.type==='Legend'); }

function buildDeck(legendN){
  const legend = card(legendN);
  const doms = legend.dom;
  const champTag = legend.name.split(' - ')[0];

  const champUnits = CARDS.filter(c=>c.type==='Unit'&&c.super==='Champion'&&c.tags.includes(champTag));
  champUnits.sort((a,b)=>(a.e||0)-(b.e||0));
  const champN = champUnits.length?champUnits[0].n:null;

  const pool = CARDS.filter(c=>
    ['Unit','Spell','Gear'].includes(c.type) &&
    c.super!=='Token' &&
    // 시그니처 카드는 같은 챔피언의 전설 덱에만 (OGS 티버스·최후의 전사 등)
    (c.super!=='Signature' || c.tags.includes(champTag)) &&
    c.n!==champN &&
    !isBanned(c.n) &&
    (c.dom.length===0 || c.dom.every(d=>doms.includes(d)||d==='Colorless'))
  );
  const preferred = pool.filter(c=>c.tags.includes(champTag));
  const rest = shuffle([...pool.filter(c=>!c.tags.includes(champTag))]);

  const deck=[]; const counts={};
  function add(c, max){
    counts[c.n]=counts[c.n]||0;
    if(counts[c.n]>=max) return false;
    counts[c.n]++; deck.push(c.n); return true;
  }
  // 공식 룰: 주 덱 40장에 선발 챔피언 1장 포함 (게임 시작 시 챔피언 구역으로 이동)
  if(champN) add(card(champN),1);
  preferred.forEach(c=>{ for(let i=0;i<3&&deck.length<12;i++) add(c,3); });
  for(const c of rest){
    if(deck.length>=40) break;
    add(c,2); if(deck.length<40) add(c,2);
  }
  let gi=0;
  while(deck.length<40 && gi<rest.length){ add(rest[gi],3); gi++; }
  deck.length=40;

  const runeCards = CARDS.filter(c=>c.type==='Rune');
  const runes=[];
  const domRunes = doms.map(d=>runeCards.find(r=>r.dom.includes(d))).filter(Boolean);
  for(let i=0;i<12;i++) runes.push(domRunes[i%domRunes.length].n);

  const bfPool = shuffle(CARDS.filter(c=>c.type==='Battlefield' && !isBanned(c.n)).map(c=>c.n));
  const bfs = bfPool.slice(0,3);

  return { deck, runes, bfs, champN };
}

// ---------- 서버 연결 화면 ----------
// 공식 서버 (주소가 바뀌면 여기만 고치면 된다)
const OFFICIAL_SERVER = 'https://riftboundsimkr.duckdns.org';
// 서버가 직접 서빙한 웹앱이면 자기 자신이 곧 서버다. 데스크톱(file://)이면 공식 서버.
function defaultServerUrl(){
  return /^https?:$/.test(location.protocol) ? location.origin : OFFICIAL_SERVER;
}

function initConnect(){
  const input=document.getElementById('server-url');
  const msg=document.getElementById('connect-msg');
  input.value = localStorage.getItem('rb_server') || defaultServerUrl();
  document.getElementById('btn-offline').onclick=()=>showScreen('setup-screen');
  document.getElementById('btn-tutorial').onclick=()=>TUT.start();
  document.getElementById('btn-local-decks').onclick=()=>{
    DeckStore.local=true; DeckStore.returnTo='connect-screen';
    DeckStore.list().then(d=>{ myDecks=d; renderDeckList(); showScreen('decks-screen'); });
  };

  const connect=async ()=>{
    msg.textContent='';
    let url=input.value.trim();
    if(!/^https?:\/\//i.test(url)) url='http://'+url; // 프로토콜 생략 시 http 보완
    NET.setBase(url);
    msg.style.color='#8fa'; msg.textContent='서버에 연결 중...';
    try{
      await NET.health();
      localStorage.setItem('rb_server', NET.base);
      msg.textContent='';
      enterLogin();
    }catch(e){
      msg.style.color='#ff9b9b';
      msg.textContent='서버에 연결할 수 없습니다. 주소를 확인하세요. ('+e.message+')';
    }
  };
  document.getElementById('btn-connect').onclick=connect;
  input.addEventListener('keydown',e=>{ if(e.key==='Enter') connect(); });

  // 이전에 접속한 서버 + 저장된 토큰이 있으면 자동 로그인 시도
  const savedServer=localStorage.getItem('rb_server');
  const t=localStorage.getItem('rb_token'), id=localStorage.getItem('rb_id');
  if(savedServer && t && id){
    NET.setBase(savedServer); NET.token=t; NET.userId=id;
    NET.getDecks().then(async d=>{ myDecks=d; await enterMenu(); })
      .catch(()=>{ NET.token=null; }); // 실패 시 연결 화면 유지
  }
}

// ---------- 패치 노트 ----------
// 본문은 js/patchnotes.js에 문자열로 들어있다 (docs/패치노트.txt에서 생성).
// file:// 로 여는 데스크톱 앱에서도 fetch 없이 읽히도록 스크립트로 넣었다.
let PATCH_BACK = 'connect-screen';
function showPatchNotes(){
  PATCH_BACK = currentScreen();
  const el = document.getElementById('patch-body');
  const txt = (typeof PATCHNOTES === 'string') ? PATCHNOTES : '';
  if(!txt) el.textContent = '패치 노트를 불러오지 못했습니다.';
  else el.innerHTML = esc(txt).split('\n')
    .map(l => /^\s*■/.test(l) ? '<b>'+l+'</b>' : l).join('\n');
  showScreen('patch-screen');
  el.scrollTop = 0;
}
function initPatchNotes(){
  document.getElementById('btn-patchnotes').onclick = showPatchNotes;
  document.getElementById('btn-patch-back').onclick = ()=>showScreen(PATCH_BACK);
}

function enterLogin(){
  const secure = /^https:/i.test(NET.base) || /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(NET.base);
  document.getElementById('login-server-label').textContent =
    '서버: '+NET.base + (secure?' 🔒':' ⚠️ 암호화 안 됨');
  showScreen('login-screen');
  // 아이디가 이미 채워져 있으면 비밀번호부터 입력하게 한다
  const idEl=document.getElementById('login-id');
  (idEl.value ? document.getElementById('login-pw') : idEl).focus();
}

// ---------- 로그인 ----------
function initLogin(){
  const msg=document.getElementById('login-msg');
  const doAuth=async (fn)=>{
    msg.textContent='';
    const id=document.getElementById('login-id').value.trim();
    const pw=document.getElementById('login-pw').value;
    if(id.length<2){ msg.textContent='아이디는 2자 이상이어야 합니다'; return; }
    if(pw.length<8){ msg.textContent='비밀번호는 8자 이상이어야 합니다'; return; }
    // 평문 HTTP 서버에 처음 로그인/가입 시 경고
    const insecure = /^http:\/\//i.test(NET.base) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(NET.base);
    if(insecure && !doAuth._warned){
      doAuth._warned=true;
      if(!confirm('⚠️ 이 서버는 암호화되지 않은(HTTP) 연결입니다.\n비밀번호가 노출될 수 있으니 다른 곳과 다른 비밀번호를 사용하세요.\n계속할까요?')) { doAuth._warned=false; return; }
    }
    try{ await fn(id,pw); rememberId(id); await enterMenu(); }
    catch(e){ msg.textContent=e.message; }
  };
  // 아이디 저장 — 비밀번호는 저장하지 않는다 (아이디만 채워두고 커서를 비밀번호로 옮긴다).
  // rb_saved_id: 없음=아직 정한 적 없음(기본 켜짐) · ''=저장 안 함 · 그 외=저장된 아이디
  const idEl=document.getElementById('login-id'), saveEl=document.getElementById('login-save-id');
  let savedId=null;
  try{ savedId=localStorage.getItem('rb_saved_id'); }catch(e){}
  saveEl.checked = savedId !== '';
  if(savedId) idEl.value=savedId;
  saveEl.onchange=()=>{ if(!saveEl.checked) try{ localStorage.setItem('rb_saved_id',''); }catch(e){} };
  function rememberId(id){
    try{ localStorage.setItem('rb_saved_id', saveEl.checked ? id : ''); }catch(e){}
  }

  document.getElementById('btn-login').onclick=()=>doAuth(NET.login);
  idEl.addEventListener('keydown',e=>{ if(e.key==='Enter') document.getElementById('login-pw').focus(); });
  document.getElementById('btn-register').onclick=()=>{
    // 서버가 접근 코드를 요구하면 회원가입 시 코드 입력받아 전달
    if(NET.requiresAccess){
      const code=(prompt('이 서버는 접근 코드가 필요합니다.\n방장에게 받은 접근 코드를 입력하세요.')||'').trim();
      if(!code){ document.getElementById('login-msg').textContent='접근 코드가 필요합니다.'; return; }
      doAuth((id,pw)=>NET.register(id,pw,code));
    } else doAuth(NET.register);
  };
  document.getElementById('login-pw').addEventListener('keydown',e=>{ if(e.key==='Enter') doAuth(NET.login); });
  document.getElementById('btn-change-server').onclick=()=>{
    NET.token=null; localStorage.removeItem('rb_token');
    showScreen('connect-screen');
  };
}

// ---------- 내 전적 (상대 덱별 승률) ----------
// 서버가 계정에 '상대 전설-챔피언'별 승패를 세어 둔 것을 그대로 보여준다.
async function renderRecord(){
  const sum=document.getElementById('record-sum'), list=document.getElementById('record-list');
  sum.textContent='불러오는 중...'; list.innerHTML='';
  let d;
  try{ d=await NET.getRecord(); }
  catch(e){ sum.textContent='전적을 불러오지 못했습니다 — '+e.message; return; }

  const tot=d.total||{win:0,lose:0}, win=tot.win|0, lose=tot.lose|0, all=win+lose;
  sum.innerHTML = all
    ? `전체 <b>${all}전 ${win}승 ${lose}패</b> · 승률 <b>${Math.round(win*100/all)}%</b>`
    : '아직 기록된 대전이 없습니다. 온라인 대전을 한 판 해보세요!';

  const name=n=>{ const c=card(n); return c ? c.ko : '?'; };
  const rows=Object.entries(d.record||{}).map(([k,v])=>{
    const [lg,ch]=k.split('-');
    const w=v.win|0, l=v.lose|0, g=w+l;
    return { label:`${name(+lg)} · ${+ch ? name(+ch) : '챔피언 없음'}`, w, l, g, rate: g?w*100/g:0 };
  }).sort((a,b)=>b.g-a.g || b.rate-a.rate);

  if(!rows.length){ list.innerHTML='<div class="record-empty">상대한 덱이 아직 없습니다.</div>'; return; }
  list.innerHTML = rows.map(r=>`<div class="record-row">
    <span class="rr-name">${esc(r.label)}</span>
    <span class="rr-wl">${r.w}승 ${r.l}패</span>
    <span class="rr-rate">${Math.round(r.rate)}%</span>
    <div class="rr-bar"><i style="width:${Math.round(r.rate)}%"></i></div>
  </div>`).join('');
}
function initRecord(){
  document.getElementById('btn-goto-record').onclick=()=>{ showScreen('record-screen'); renderRecord(); };
  document.getElementById('btn-record-back').onclick=()=>showScreen('menu-screen');
  document.getElementById('btn-record-reset').onclick=async ()=>{
    if(!confirm('이 계정의 전적 기록을 모두 지울까요? 되돌릴 수 없습니다.')) return;
    try{ await NET.clearRecord(); UI.toast('전적을 지웠습니다'); renderRecord(); }
    catch(e){ alert('지우지 못했습니다 — '+e.message); }
  };
}

// 서버 덱을 이 기기에 자동 백업 (무료 호스팅의 서버 초기화 대비)
function srvBackupKey(){ return 'rb_srv_backup_'+(NET.base||'local'); }
function syncSrvBackup(list){
  try{ if(list && list.length) localStorage.setItem(srvBackupKey(), JSON.stringify(list)); }catch(e){}
}

async function enterMenu(){
  DeckStore.local=false; DeckStore.returnTo='menu-screen';
  myDecks = await DeckStore.list();
  // 서버가 초기화되어 덱이 비었으면, 이 기기에 백업해 둔 덱 복원 제안
  if(!myDecks.length){
    let bak=[]; try{ bak=JSON.parse(localStorage.getItem(srvBackupKey())||'[]'); }catch(e){}
    if(bak.length && confirm(`서버에 저장된 덱이 없습니다.\n이 기기에 백업된 덱 ${bak.length}개를 서버 계정으로 복원할까요?`)){
      for(const d of bak){ try{ myDecks=await NET.saveDeck(d); }catch(e){ break; } }
      UI.toast(`덱 ${myDecks.length}개 복원됨`);
    }
  }
  // 지난번에 서버에 못 올린 덱이 있으면 먼저 올린다
  await pendingDeckFlush();
  syncSrvBackup(myDecks);
  document.getElementById('menu-welcome').textContent=`${NET.userId}님, 환영합니다!`;
  document.getElementById('deck-count').textContent=myDecks.length;
  showScreen('menu-screen');
}

// ---------- 메뉴 ----------
function initMenu(){
  document.getElementById('btn-goto-decks').onclick=()=>{ DeckStore.local=false; DeckStore.returnTo='menu-screen'; renderDeckList(); showScreen('decks-screen'); };
  document.getElementById('btn-goto-lobby').onclick=async ()=>{
    if(!myDecks.length){ alert('먼저 덱을 만들어주세요! (내 덱 관리)'); return; }
    try{
      if(!NET.ws || NET.ws.readyState!==1) await NET.connect();
      renderLobbyDeckSelect();
      NET.send({t:'listRooms'});
      showScreen('lobby-screen');
    }catch(e){ alert(e.message); }
  };
  document.getElementById('btn-goto-hotseat').onclick=()=>showScreen('setup-screen');
  document.getElementById('btn-logout').onclick=()=>{
    localStorage.removeItem('rb_token'); localStorage.removeItem('rb_id');
    location.reload();
  };
}

// ---------- 덱 목록 ----------
function deckSummary(d){
  const l=card(d.legendN);
  return `전설: ${l.ko}<br>영역: ${l.dom.map(x=>DOMAIN_KO[x]).join('/')} · 챔피언: ${d.champN?card(d.champN).ko:'-'}`;
}
// ---------- 밴 리스트 ----------
function showBanlist(){
  const box=document.getElementById('modal-box');
  box.innerHTML=`<h3>🚫 밴 리스트 — ${esc(BANLIST.region)}</h3>`;
  const info=document.createElement('div');
  info.style.cssText='font-size:13px;color:#9aa4bd;margin-bottom:10px;line-height:1.7';
  info.textContent = BANLIST.cards.length
    ? `대전에서 양쪽 모두 '🚫 밴 적용'을 선택하면 아래 카드가 포함된 덱은 사용할 수 없습니다. (기준일: ${BANLIST.updated||'-'} · 글로벌 공통 밴리스트, 한국 공식 적용)`
    : `현재 밴 카드가 없습니다. (기준일: ${BANLIST.updated||'-'})`;
  box.appendChild(info);
  if(BANLIST.cards.length){
    const wrap=document.createElement('div'); wrap.className='modal-cards';
    BANLIST.cards.forEach(n=>{
      const el=cardMiniEl(card(n));
      const bb=document.createElement('div'); bb.className='cm-ban'; bb.textContent='🚫';
      el.appendChild(bb);
      wrap.appendChild(el);
    });
    box.appendChild(wrap);
    const names=document.createElement('div');
    names.style.cssText='font-size:12px;color:#8a94b0;margin-top:8px;text-align:center';
    names.textContent='카드 우클릭/꾹 누르기로 자세히 볼 수 있습니다 — '
      +BANLIST.cards.map(n=>card(n).ko).join(' · ');
    box.appendChild(names);
  }
  if(BANLIST.source){
    const src=document.createElement('div');
    src.style.cssText='font-size:11px;color:#5a6a90;margin-top:8px;word-break:break-all';
    src.textContent='출처: '+BANLIST.source;
    box.appendChild(src);
  }
  const btns=document.createElement('div'); btns.className='modal-btns';
  const close=document.createElement('button'); close.className='primary'; close.textContent='닫기';
  close.onclick=closeModal;
  btns.appendChild(close); box.appendChild(btns);
  openModal(); markModalDismissable();
}

// ---------- 대회 우승 덱 브라우저 (메타별 → 대회별 → 순위) ----------
function tdPlaceRank(place){
  if(place==='우승'||place==='1위') return 1;
  if(/^top\s*4/i.test(place)) return 4;   // 3·4위 미구분 공동 준결승 탈락
  const m=String(place).match(/^(\d+)/);
  return m?+m[1]:99;
}
function showTourneyDecks(){
  const box=document.getElementById('modal-box');
  box.innerHTML=`<h3>🏆 대회 우승 덱</h3>
    <div style="font-size:13px;color:#9aa4bd;margin-bottom:10px;line-height:1.6">
    메타(부스터팩) → 대회(참가 인원 순) → 순위로 정렬되어 있습니다. 덱을 클릭하면 전체 리스트를 확인하고 내 덱으로 복사할 수 있습니다.<br>
    <small>이 시뮬레이터는 Origins 카드풀만 지원하므로 이후 메타(Spiritforged~)의 덱은 아직 수록할 수 없습니다.
    전적(승-패-무)은 공개 확인된 대회만 표기됩니다.</small></div>`;
  TOURNAMENT_METAS.forEach(meta=>{
    const head=document.createElement('div'); head.className='td-meta-head';
    head.innerHTML=`📦 ${esc(meta.name)} <span class="td-period">${esc(meta.period)}</span>`;
    box.appendChild(head);
    // 대회별 그룹 (참가 인원 내림차순), 그룹 안에서 순위 오름차순
    const byEvent=new Map();
    meta.decks.forEach(td=>{ if(!byEvent.has(td.event)) byEvent.set(td.event,[]); byEvent.get(td.event).push(td); });
    [...byEvent.entries()].sort((a,b)=>(b[1][0].players||0)-(a[1][0].players||0)).forEach(([ev,decks])=>{
      const eh=document.createElement('div'); eh.className='td-event-head';
      eh.textContent=`${ev} · 참가 ${decks[0].players?decks[0].players.toLocaleString()+'명':'?'}`;
      box.appendChild(eh);
      decks.sort((a,b)=>tdPlaceRank(a.place)-tdPlaceRank(b.place)).forEach(td=>{
        const row=document.createElement('div'); row.className='td-row'+(td.unavailable?' unavail':'');
        row.innerHTML=`<span class="td-place${tdPlaceRank(td.place)===1?' win':''}">${esc(td.place)}</span>
          <span class="td-name">${esc(td.name)}</span>
          <span class="td-info">${td.player?esc(td.player):''}${td.record?' · 전적 '+esc(td.record):''}${td.unavailable?' · 미수록(스타터 OGS 카드 포함 — 시뮬레이터 카드풀 밖)':''}</span>`;
        if(td.unavailable) row.onclick=()=>UI.toast('이 덱은 Origins 부스터 외 카드(Proving Grounds 스타터)를 포함해 시뮬레이터에서 재현할 수 없습니다','warn');
        else row.onclick=()=>showTourneyDeckDetail(td);
        box.appendChild(row);
      });
    });
  });
  const btns=document.createElement('div'); btns.className='modal-btns';
  const close=document.createElement('button'); close.className='primary'; close.textContent='닫기';
  close.onclick=closeModal;
  btns.appendChild(close); box.appendChild(btns);
  openModal(); markModalDismissable();
}

function showTourneyDeckDetail(td){
  const box=document.getElementById('modal-box');
  box.innerHTML=`<h3>🏆 ${esc(td.name)}</h3>
    <div style="font-size:13px;color:#9aa4bd;margin-bottom:8px;line-height:1.6">
      ${esc(td.event)} — <b class="td-place win">${esc(td.place)}</b>${td.player?' · '+esc(td.player):''}
      · 참가 ${td.players?td.players.toLocaleString()+'명':'?'}${td.record?' · 전적 <b>'+esc(td.record)+'</b>':''}<br>
      <small>카드는 우클릭 또는 꾹 누르기로 확대해 볼 수 있습니다 · 아래 순서: 전설 → 선발 챔피언 → 전장 3</small></div>`;
  // 전설/챔피언/전장 미니 카드
  const wrap=document.createElement('div'); wrap.className='modal-cards';
  [td.legendN, td.champN, ...td.bfs].forEach(n=>wrap.appendChild(cardMiniEl(card(n))));
  box.appendChild(wrap);
  // 메인 40장 (비용순, 수량 묶음)
  const grouped={};
  td.main.forEach(n=>grouped[n]=(grouped[n]||0)+1);
  const list=document.createElement('div'); list.className='td-cardlist';
  Object.entries(grouped).sort((a,b)=>(card(+a[0]).e||0)-(card(+b[0]).e||0)).forEach(([n,cnt])=>{
    const c=card(+n);
    const row=document.createElement('div'); row.className='ed-row';
    row.innerHTML=`<span class="cnt">×${cnt}</span> [${c.e??0}] ${esc(c.ko)}${isBanned(c.n)?' 🚫':''}`;
    row.onmouseenter=()=>UI.inspect(c);
    row._card=c; attachZoom(row);
    list.appendChild(row);
  });
  box.appendChild(list);
  // 룬 구성
  const rc={}; td.runes.forEach(n=>rc[n]=(rc[n]||0)+1);
  const runes=document.createElement('div');
  runes.style.cssText='font-size:12px;color:#9aa4bd;margin-top:8px';
  runes.textContent='룬: '+Object.entries(rc).map(([n,cnt])=>`${DOMAIN_KO[card(+n).dom[0]]||card(+n).ko} ×${cnt}`).join(' · ');
  box.appendChild(runes);
  // 밴 카드 안내
  const bannedIn=[...new Set([td.legendN,td.champN,...td.main,...td.bfs])].filter(isBanned);
  if(bannedIn.length){
    const bn=document.createElement('div'); bn.className='ban-flag';
    bn.style.cssText='font-size:12px;margin-top:6px';
    bn.textContent='🚫 당시 대회 리스트 그대로라 현행 밴 카드 포함: '+bannedIn.map(n=>card(n).ko).join(', ')+' — 밴 적용 대전에서는 사용할 수 없습니다';
    box.appendChild(bn);
  }
  const src=document.createElement('div');
  src.style.cssText='font-size:11px;color:#5a6a90;margin-top:6px;word-break:break-all';
  src.textContent='출처: '+td.source;
  box.appendChild(src);
  const btns=document.createElement('div'); btns.className='modal-btns';
  const copy=document.createElement('button'); copy.className='primary'; copy.textContent='📋 내 덱으로 복사';
  copy.onclick=async ()=>{
    const label=`🏆 ${td.name}${td.tag?` (${td.tag}${td.place!=='우승'?' '+td.place:''})`:''}`;
    const deck={ name:[...label].slice(0,30).join(''), legendN:td.legendN, champN:td.champN,
      main:[...td.main], runes:[...td.runes], bfs:[...td.bfs] };
    try{
      myDecks=await DeckStore.save(deck, null);
      if(!DeckStore.local) syncSrvBackup(myDecks);
      renderDeckList();
      UI.toast(`「${deck.name}」 — 내 덱 목록에 복사되었습니다`);
      closeModal();
    }catch(e){ UI.toast(e.message,'warn'); }
  };
  const back=document.createElement('button'); back.textContent='← 목록';
  back.onclick=showTourneyDecks;
  const close=document.createElement('button'); close.textContent='닫기';
  close.onclick=closeModal;
  btns.appendChild(copy); btns.appendChild(back); btns.appendChild(close);
  box.appendChild(btns);
  openModal(); markModalDismissable();
}

function renderDeckList(){
  const el=document.getElementById('deck-list');
  el.innerHTML='';
  if(!myDecks.length){
    el.innerHTML='<div class="hint" style="padding:30px;text-align:center;width:100%">아직 덱이 없습니다. [＋ 새 덱]으로 만들어보세요!</div>';
  }
  myDecks.forEach((d,i)=>{
    const div=document.createElement('div'); div.className='deck-card';
    const banned=deckBannedCards(d);
    div.innerHTML=`<h3>${esc(d.name)}</h3><div class="dk-info">${deckSummary(d)}</div>`
      +(banned.length?`<div class="ban-flag" style="font-size:12px">🚫 밴 카드 ${banned.length}종 포함 — ${esc(banned.map(n=>card(n).ko).join(', '))}</div>`:'');
    const btns=document.createElement('div'); btns.className='dk-btns';
    const be=document.createElement('button'); be.textContent='편집';
    be.onclick=()=>openEditor(i);
    const bd=document.createElement('button'); bd.textContent='삭제';
    bd.onclick=async ()=>{
      if(!confirm(`「${d.name}」 덱을 삭제할까요?`)) return;
      myDecks=await DeckStore.del(i);
      if(!DeckStore.local) syncSrvBackup(myDecks);
      document.getElementById('deck-count').textContent=myDecks.length;
      renderDeckList();
    };
    btns.appendChild(be); btns.appendChild(bd);
    div.appendChild(btns);
    el.appendChild(div);
  });
  document.getElementById('deck-count').textContent=myDecks.length;
}
function initDecks(){
  document.getElementById('btn-decks-back').onclick=()=>showScreen(DeckStore.returnTo);
  document.getElementById('btn-new-deck').onclick=()=>{
    if(myDecks.length>=20){ alert('덱은 최대 20개까지 저장할 수 있습니다'); return; }
    openEditor(null);
  };
}

// ---------- 덱 편집기 ----------
// champOverride: 유저가 직접 고른 챔피언 (null이면 전설 기준 자동 = 견본덱 방식)
const ED = { index:null, main:[], side:[], runes:{}, bfs:[], legendN:null, champOverride:null, selN:null,
             arts:{} };   // 카드번호 → 일러스트 인덱스 (0/없음 = 기본 그림)
// 카드를 고를 때 사이드덱으로 보낼지 (체크박스 또는 Shift+클릭)
function edToSide(e){
  if(e && e.shiftKey) return true;
  const el=document.getElementById('ed-to-side');
  return !!(el && el.checked);
}

function openEditor(index){
  ED.index=index;
  if(index!==null){
    const d=myDecks[index];
    ED.legendN=d.legendN;
    ED.main=[...d.main];
    ED.side=[...(d.side||[])];
    ED.bfs=[...d.bfs];
    ED.runes={};
    d.runes.forEach(n=>{ ED.runes[n]=(ED.runes[n]||0)+1; });
    ED.arts={...(d.arts||{})};
    document.getElementById('ed-name').value=d.name;
  } else {
    ED.legendN=legendList()[0].n;
    ED.main=[]; ED.side=[]; ED.bfs=[]; ED.runes={}; ED.arts={};
    document.getElementById('ed-name').value='새 덱 '+(myDecks.length+1);
  }
  // 편집 중에는 이 덱에서 고른 일러스트로 보여준다 (ui.js의 artImg가 참조)
  ART_PREVIEW = ED.arts;
  document.getElementById('ed-legend').value=ED.legendN;
  // 저장된 챔피언이 자동 배정과 다르면 "나만의 덱" (직접 선택)으로 간주
  ED.champOverride = (index!==null && myDecks[index].champN && myDecks[index].champN!==edAutoChampN())
    ? myDecks[index].champN : null;
  document.getElementById('ed-champ-select').value = ED.champOverride ? String(ED.champOverride) : '';
  document.getElementById('ed-msg').textContent='';
  // 기존 덱에 밴 카드가 있으면 편집 진입 시 바로 알림
  if(index!==null){
    const banned=deckBannedCards(myDecks[index]);
    if(banned.length)
      document.getElementById('ed-msg').textContent =
        '🚫 밴 카드 포함: '+banned.map(n=>card(n).ko).join(', ')+' — 밴 적용 대전에서는 사용할 수 없습니다';
  }
  ED.selN=null;
  renderEditor();
  showScreen('editor-screen');
}

// ---------- 덱 편집기 정렬 ----------
// 고른 기준은 localStorage에 남긴다 — 덱을 여러 개 만들 때 매번 다시 고르게 하면 성가시다.
// 덱 편집기에서 확대해 볼 때 일러스트를 고를 수 있게 연결한다
function edArtPicker(c){
  UI.zoomArtPicker = (c && c.alts && c.alts.length) ? {
    n: c.n,
    get: ()=> ED.arts[c.n]|0,
    set: i=>{ if(i>0) ED.arts[c.n]=i; else delete ED.arts[c.n]; ART_PREVIEW=ED.arts; renderEditor(); },
  } : null;
}

const ED_SORT_KEY='rb_ed_sort';
function edSortMode(){
  const el=document.getElementById('ed-sort');
  return (el && el.value) || localStorage.getItem(ED_SORT_KEY) || 'cost';
}
// 배열을 제자리 정렬하고 그대로 돌려준다 (카드 풀과 덱 목록이 같은 함수를 쓴다).
// 어떤 기준이든 마지막에는 '가나다 → 세트 번호'로 동점을 깨서 렌더 순서가 흔들리지 않게 한다.
function edSortCards(list){
  const mode=edSortMode();
  const ko=(a,b)=>a.ko.localeCompare(b.ko,'ko');
  const tie=(a,b)=>ko(a,b) || (a.n-b.n);
  const cost=c=>{
    // 전장은 비용이 없다(e=null). 비용순에서 뒤로 몰아 유닛·주문·도구와 섞이지 않게 한다.
    if(c.type==='Battlefield') return 99;
    return (c.e??0) + (c.p||0)*0.1;   // 같은 에너지면 힘 핍이 많은 쪽이 뒤로
  };
  const cmp={
    'cost':      (a,b)=>cost(a)-cost(b) || tie(a,b),
    'cost-desc': (a,b)=>cost(b)-cost(a) || tie(a,b),
    'name':      (a,b)=>tie(a,b),
    'name-desc': (a,b)=>ko(b,a) || (a.n-b.n),
    'set':       (a,b)=>a.n-b.n,
  }[mode] || ((a,b)=>cost(a)-cost(b) || tie(a,b));
  return list.sort(cmp);
}

function edIsCustom(){ return document.getElementById('ed-legend').value==='custom'; }
function edLegend(){ return edIsCustom() ? null : card(+document.getElementById('ed-legend').value); }
// 자동 챔피언: '덱에 든 챔피언' 중 최저 비용 우선 — 선발은 메인 40장 중 하나여야 한다.
// 덱에 챔피언이 없을 때만 전설 기준(견본덱 방식)으로 넘어간다
function edAutoChampN(){
  const inDeck=[...new Set(ED.main.filter(n=>{ const c=card(n); return c.type==='Unit'&&c.super==='Champion'; }))]
    .sort((a,b)=>((card(a).e||0)-(card(b).e||0)) || (a-b));
  if(inDeck.length) return inDeck[0];
  const legend=edLegend();
  if(!legend) return null;
  const tag=legend.name.split(' - ')[0];
  const cu=CARDS.filter(c=>c.type==='Unit'&&c.super==='Champion'&&c.tags.includes(tag))
    .sort((a,b)=>(a.e||0)-(b.e||0));
  return cu.length?cu[0].n:null;
}
function edChampN(){ return ED.champOverride ?? edAutoChampN(); }
// 나만의 덱: 챔피언에 맞는 전설 자동 연결 (태그 짝 → 없으면 영역이 가장 겹치는 전설)
function edLegendForChamp(champN){
  if(champN==null) return null;
  const c=card(champN);
  const L=legendList();
  const tagMatch=L.find(l=>c.tags.includes(l.name.split(' - ')[0]));
  if(tagMatch) return tagMatch.n;
  let best=L[0], bestScore=-1;
  L.forEach(l=>{
    const s=c.dom.filter(d=>l.dom.includes(d)).length;
    if(s>bestScore){ bestScore=s; best=l; }
  });
  return best.n;
}

// 카드 1장 추가/제거 (성공 시 true) — 풀 클릭 확대 팝업의 ＋/− 버튼에서 사용
// 같은 카드는 메인·사이드를 합쳐 3장까지 (공식 규칙)
function edCopies(n){ return ED.main.filter(x=>x===n).length + ED.side.filter(x=>x===n).length; }

function edAddCard(c, toSide){
  // 밴 카드는 넣을 수는 있지만 (밴 미적용 대전용), 실제로 추가됐을 때만 경고를 띄운다
  const warnBan=()=>{ if(isBanned(c.n)) UI.toast(`🚫 「${c.ko}」는 밴 카드입니다 — 밴 적용 대전에서는 이 덱을 쓸 수 없습니다`,'warn'); };
  if(c.type==='Battlefield'){
    if(ED.bfs.includes(c.n)){ UI.toast('같은 전장은 1개까지입니다','warn'); return false; }
    if(ED.bfs.length>=3){ UI.toast('전장은 3개까지입니다','warn'); return false; }
    ED.bfs.push(c.n); warnBan(); return true;
  }
  // 시그니처 카드: 같은 챔피언의 전설이 선택된 덱에만 (예: 티버스 → 애니 전설)
  if(c.super==='Signature'){
    const legend=edLegend();
    const tag=legend ? legend.name.split(' - ')[0] : null;
    if(!tag || !c.tags.includes(tag)){
      // 태그는 영문이므로 해당 챔피언 전설의 한글 이름으로 안내
      const owner=legendList().find(l=>c.tags.includes(l.name.split(' - ')[0]));
      const who=owner ? owner.ko.split(' - ')[0] : (c.tags[0]||'');
      UI.toast(`「${c.ko}」는 시그니처 카드입니다 — ${who} 전설 덱에만 넣을 수 있습니다`,'warn');
      return false;
    }
  }
  if(edCopies(c.n)>=3){ UI.toast('같은 카드는 메인·사이드를 합쳐 3장까지입니다','warn'); return false; }
  if(toSide){
    if(ED.side.length>=8){ UI.toast('사이드덱은 8장까지입니다','warn'); return false; }
    ED.side.push(c.n); warnBan(); return true;
  }
  if(ED.main.length>=40){ UI.toast('메인 덱은 40장입니다','warn'); return false; }
  // 선발 챔피언도 메인 40장에 넣을 수 있다(같은 카드 3장 제한만 적용, 룰 103) —
  // 게임 시작 시 메인에서 1장을 챔피언 존으로 분리하는 건 newGame이 처리한다
  ED.main.push(c.n); warnBan(); return true;
}
function edRemoveCard(c){
  if(c.type==='Battlefield'){
    const i=ED.bfs.indexOf(c.n);
    if(i<0) return false;
    ED.bfs.splice(i,1); return true;
  }
  const i=ED.main.indexOf(c.n);
  if(i>=0){ ED.main.splice(i,1); return true; }
  // 메인에 없으면 사이드에서 뺀다 (풀의 − 버튼이 둘 다 다룬다)
  const j=ED.side.indexOf(c.n);
  if(j>=0){ ED.side.splice(j,1); return true; }
  return false;
}
function edCardCount(c){
  return c.type==='Battlefield' ? (ED.bfs.includes(c.n)?1:0) : edCopies(c.n);
}

function renderEditor(){
  const legend=edLegend();
  const doms=legend?legend.dom:null;   // 나만의 덱: 영역 제한 없음
  const typeF=document.getElementById('ed-type-filter').value;
  const search=document.getElementById('ed-search').value.trim().toLowerCase();
  const domOnly=document.getElementById('ed-dom-only').checked;
  const champN=edChampN();

  // 카드 풀
  const pool=CARDS.filter(c=>{
    if(!['Unit','Spell','Gear','Battlefield'].includes(c.type)) return false;
    if(c.super==='Token') return false;
    if(typeF && c.type!==typeF) return false;
    if(domOnly && doms && c.type!=='Battlefield' && !(c.dom.length===0||c.dom.every(d=>doms.includes(d)||d==='Colorless'))) return false;
    if(search && !(c.ko.toLowerCase().includes(search)||c.name.toLowerCase().includes(search))) return false;
    return true;
  });
  edSortCards(pool);
  const poolEl=document.getElementById('ed-pool');
  poolEl.innerHTML='';
  const counts={}; ED.main.forEach(n=>counts[n]=(counts[n]||0)+1);
  pool.forEach(c=>{
    const el=cardMiniEl(c);
    const inCnt = c.type==='Battlefield' ? (ED.bfs.includes(c.n)?1:0) : (counts[c.n]||0);
    if(inCnt){ const b=document.createElement('div'); b.className='cm-inpool'; b.textContent=inCnt; el.appendChild(b); }
    if(isBanned(c.n)){
      el.classList.add('banned');
      const bb=document.createElement('div'); bb.className='cm-ban'; bb.textContent='🚫';
      el.appendChild(bb);
    }
    // 선택된 카드: 카드 위에 ＋/− 버튼 표시 → 바로 추가/제거
    if(ED.selN===c.n){
      el.classList.add('ed-selected');
      const ctl=document.createElement('div'); ctl.className='cm-ctl';
      const minus=document.createElement('button'); minus.className='cm-minus'; minus.textContent='−';
      minus.onclick=(e)=>{ e.stopPropagation(); if(edRemoveCard(c)) renderEditor(); };
      const plus=document.createElement('button'); plus.className='cm-plus'; plus.textContent='＋';
      plus.onclick=(e)=>{ e.stopPropagation(); if(edAddCard(c, edToSide(e))) renderEditor(); };
      ctl.appendChild(minus); ctl.appendChild(plus);
      el.appendChild(ctl);
    }
    el.onclick=()=>{ ED.selN = c.n; renderEditor(); };
    poolEl.appendChild(el);
  });

  // 선택 카드 상세 (우측 패널)
  document.getElementById('ed-inspector').innerHTML =
    ED.selN!=null ? UI.cardInfoHTML(card(ED.selN))
                  : '<div class="insp-placeholder">카드를 클릭하면 여기에 자세한 내용이 표시됩니다</div>';

  // 메인 덱 목록
  const mainEl=document.getElementById('ed-main');
  mainEl.innerHTML='';
  const grouped={};
  ED.main.forEach(n=>grouped[n]=(grouped[n]||0)+1);
  // 덱 목록도 카드 풀과 같은 기준으로 정렬한다 (둘이 다른 순서면 찾기가 더 어렵다)
  edSortCards(Object.keys(grouped).map(n=>card(+n))).map(c=>[String(c.n), grouped[c.n]]).forEach(([n,cnt])=>{
    const c=card(+n);
    const row=document.createElement('div'); row.className='ed-row';
    row.innerHTML=`<span class="cnt">×${cnt}</span> [${c.e??0}] ${esc(c.ko)}`;
    row.title='클릭: 1장 제거 · 우클릭/Alt+클릭: 카드 상세';
    row.onmouseenter=()=>UI.inspect(c);
    // Alt+클릭·우클릭: 제거하지 않고 카드 상세(확대)만 보여준다
    const openArt=()=>{ edArtPicker(c); UI.showZoom(c); };
    row.onclick=e=>{ if(e.altKey){ openArt(); return; } ED.main.splice(ED.main.indexOf(+n),1); renderEditor(); };
    row.oncontextmenu=e=>{ e.preventDefault(); openArt(); };
    mainEl.appendChild(row);
  });
  document.getElementById('ed-main-count').textContent=ED.main.length;

  // 사이드덱 목록 (메인과 같은 모양 · 클릭하면 1장 제거)
  const sideEl=document.getElementById('ed-side');
  sideEl.innerHTML='';
  const sideGrouped={};
  ED.side.forEach(n=>sideGrouped[n]=(sideGrouped[n]||0)+1);
  edSortCards(Object.keys(sideGrouped).map(n=>card(+n))).map(c=>[String(c.n), sideGrouped[c.n]]).forEach(([n,cnt])=>{
    const c=card(+n);
    const row=document.createElement('div'); row.className='ed-row';
    row.innerHTML=`<span class="cnt">×${cnt}</span> [${c.e??0}] ${esc(c.ko)}`;
    row.title='클릭: 1장 제거 · 우클릭/Alt+클릭: 카드 상세';
    row.onmouseenter=()=>UI.inspect(c);
    const openArt=()=>{ edArtPicker(c); UI.showZoom(c); };
    row.onclick=e=>{ if(e.altKey){ openArt(); return; } ED.side.splice(ED.side.indexOf(+n),1); renderEditor(); };
    row.oncontextmenu=e=>{ e.preventDefault(); openArt(); };
    sideEl.appendChild(row);
  });
  const sc=document.getElementById('ed-side-count');
  sc.textContent=ED.side.length;
  // 0장도 8장도 아니면 저장할 수 없으므로 눈에 띄게 표시한다
  sc.style.color = (ED.side.length===0 || ED.side.length===8) ? '' : '#ff9c6e';

  // 룬
  const runesEl=document.getElementById('ed-runes');
  runesEl.innerHTML='';
  const runeCards=CARDS.filter(c=>c.type==='Rune');
  let runeTotal=0; Object.values(ED.runes).forEach(v=>runeTotal+=v);
  runeCards.forEach(rc=>{
    const ctl=document.createElement('div'); ctl.className='ed-rune-ctl';
    const cnt=ED.runes[rc.n]||0;
    ctl.innerHTML=`${DOMAIN_ICON[rc.dom[0]]||'◆'} ${esc(DOMAIN_KO[rc.dom[0]]||rc.ko)} `;
    const minus=document.createElement('button'); minus.textContent='−';
    minus.onclick=()=>{ if(cnt>0){ED.runes[rc.n]=cnt-1; renderEditor();} };
    const num=document.createElement('b'); num.textContent=cnt;
    const plus=document.createElement('button'); plus.textContent='＋';
    plus.onclick=()=>{ if(runeTotal<12){ED.runes[rc.n]=cnt+1; renderEditor();} };
    ctl.appendChild(minus); ctl.appendChild(num); ctl.appendChild(plus);
    runesEl.appendChild(ctl);
  });
  document.getElementById('ed-rune-count').textContent=runeTotal;

  // 전장
  const bfEl=document.getElementById('ed-bfs');
  bfEl.innerHTML='';
  ED.bfs.forEach(n=>{
    const c=card(n);
    const row=document.createElement('div'); row.className='ed-row';
    row.textContent=c.ko;
    row.title='클릭: 제거 · 우클릭/Alt+클릭: 카드 상세';
    row.onmouseenter=()=>UI.inspect(c);
    row.onclick=e=>{ if(e.altKey){ UI.showZoom(c); return; } ED.bfs.splice(ED.bfs.indexOf(n),1); renderEditor(); };
    row.oncontextmenu=e=>{ e.preventDefault(); UI.showZoom(c); };
    bfEl.appendChild(row);
  });
  document.getElementById('ed-bf-count').textContent=ED.bfs.length;

  // 챔피언
  document.getElementById('ed-champ').textContent =
    edIsCustom()
      ? (champN ? `→ ${card(champN).ko} · 전설 자동 연결: ${card(edLegendForChamp(champN)).ko}` : '⚠ 챔피언을 선택하세요')
      : (champN ? (ED.champOverride ? `→ ${card(champN).ko} (직접 선택)` : `→ ${card(champN).ko} (전설 기준 자동)`)
                : '(해당 챔피언 유닛 없음)');
}

function initEditor(){
  const sel=document.getElementById('ed-legend');
  // 최상단: 아무것도 지정되지 않은 나만의 덱 (전체 카드 풀, 챔피언 직접 선택)
  const customOpt=document.createElement('option');
  customOpt.value='custom'; customOpt.textContent='🛠 나만의 덱 — 자유 구성 (챔피언부터 직접 선택)';
  sel.appendChild(customOpt);
  legendList().forEach(l=>{
    const o=document.createElement('option');
    o.value=l.n; o.textContent=`${l.ko} (${l.dom.map(d=>DOMAIN_KO[d]).join('/')})`;
    sel.appendChild(o);
  });
  sel.onchange=()=>renderEditor();
  // 챔피언 직접 선택 (나만의 덱): "자동" = 전설 기준 견본 방식
  const champSel=document.getElementById('ed-champ-select');
  const autoOpt=document.createElement('option');
  autoOpt.value=''; autoOpt.textContent='🎯 자동 (전설 기준)';
  champSel.appendChild(autoOpt);
  CARDS.filter(c=>c.type==='Unit'&&c.super==='Champion')
    .sort((a,b)=>a.ko.localeCompare(b.ko,'ko'))
    .forEach(c=>{
      const o=document.createElement('option');
      o.value=c.n;
      o.textContent=`${c.ko} [${c.e??0}] (${c.dom.map(d=>DOMAIN_KO[d]||d).join('/')})`;
      champSel.appendChild(o);
    });
  champSel.onchange=()=>{
    ED.champOverride=champSel.value?+champSel.value:null;
    // 새 챔피언과 같은 카드가 메인 덱에 있으면 제거 (챔피언 존에 자동 배정되므로)
    const n=edChampN();
    const before=ED.main.length;
    ED.main=ED.main.filter(x=>x!==n);
    if(ED.main.length<before) UI.toast('선발 챔피언과 같은 카드는 메인 덱에서 제외했습니다','warn');
    renderEditor();
  };
  ['ed-type-filter','ed-search','ed-dom-only','ed-sort'].forEach(id=>{
    document.getElementById(id).addEventListener('input',()=>renderEditor());
  });
  // 정렬 기준은 기억해 둔다 (덱을 여러 개 만들 때 매번 다시 고르지 않게)
  const sortSel=document.getElementById('ed-sort');
  sortSel.value = localStorage.getItem(ED_SORT_KEY) || 'cost';
  sortSel.addEventListener('change', ()=>{ try{ localStorage.setItem(ED_SORT_KEY, sortSel.value); }catch(e){} });
  document.getElementById('btn-ed-auto').onclick=()=>{
    const legendN = edIsCustom() ? edLegendForChamp(edChampN()) : +sel.value;
    if(legendN==null){ UI.toast('나만의 덱: 챔피언을 먼저 선택하면 자동 완성할 수 있습니다','warn'); return; }
    const d=buildDeck(legendN);
    ED.main=[...d.deck]; ED.bfs=[...d.bfs];
    ED.runes={}; d.runes.forEach(n=>ED.runes[n]=(ED.runes[n]||0)+1);
    renderEditor();
  };
  document.getElementById('btn-ed-cancel').onclick=()=>{ renderDeckList(); showScreen('decks-screen'); };
  document.getElementById('btn-ed-save').onclick=async ()=>{
    const msg=document.getElementById('ed-msg');
    msg.textContent='';
    const runes=[];
    Object.entries(ED.runes).forEach(([n,cnt])=>{ for(let i=0;i<cnt;i++) runes.push(+n); });
    const champN=edChampN();
    if(!champN){
      msg.textContent = edIsCustom() ? '나만의 덱은 선발 챔피언을 골라야 합니다' : '이 전설의 챔피언 유닛을 찾을 수 없습니다';
      return;
    }
    const deck={
      name:document.getElementById('ed-name').value.trim()||'이름없는 덱',
      legendN: edIsCustom() ? edLegendForChamp(champN) : +sel.value,
      champN,
      main:[...ED.main], runes, bfs:[...ED.bfs],
      ...(ED.side.length ? { side:[...ED.side] } : {}),
    };
    // 일러스트 선택 — 덱에 실제로 든 카드 중 기본이 아닌 것만 담는다
    {
      const inDeck=new Set([...deck.main, ...ED.side, ...runes, ...deck.bfs, deck.legendN, deck.champN]);
      const a={};
      for(const k of Object.keys(ED.arts)){
        const v=ED.arts[k]|0;
        if(v>0 && inDeck.has(+k)) a[k]=v;
      }
      if(Object.keys(a).length) deck.arts=a;
    }
    if(deck.main.length!==40){ msg.textContent='메인 덱은 정확히 40장이어야 합니다'; return; }
    // 공식 규칙: 사이드덱은 0장 또는 정확히 8장 (중간값 없음)
    if(ED.side.length!==0 && ED.side.length!==8){
      msg.textContent=`사이드덱은 0장이거나 정확히 8장이어야 합니다 (지금 ${ED.side.length}장)`; return;
    }
    if(runes.length!==12){ msg.textContent='룬은 정확히 12개여야 합니다'; return; }
    if(deck.bfs.length!==3){ msg.textContent='전장은 정확히 3개여야 합니다'; return; }
    // 선발 챔피언 정합: 덱에 챔피언이 있으면 선발도 그중 하나여야 한다 (덱 밖 챔피언을
    // 선발로 지정하면 게임에서 덱 속 챔피언이 일반 카드처럼 뽑힌다)
    {
      const deckChamps=[...new Set(deck.main.filter(n=>{ const c=card(n); return c.type==='Unit'&&c.super==='Champion'; }))];
      if(deckChamps.length && deck.champN && !deckChamps.includes(deck.champN)){
        msg.textContent=`선발 챔피언(${card(deck.champN).ko})이 메인 덱에 없습니다 — 덱의 챔피언(${deckChamps.map(n=>card(n).ko).join(', ')}) 중에서 선택하거나 해당 카드를 덱에 넣어 주세요`;
        return;
      }
    }
    const bannedIn=deckBannedCards(deck);
    if(bannedIn.length) UI.toast('🚫 밴 카드 포함 덱입니다 — 밴 적용 대전에서는 사용할 수 없습니다: '+bannedIn.map(n=>card(n).ko).join(', '),'warn');
    try{
      myDecks=await DeckStore.save(deck, ED.index);
      if(!DeckStore.local) syncSrvBackup(myDecks);
      renderDeckList(); showScreen('decks-screen');
    }catch(e){
      msg.textContent=e.message;
      // 로그인이 풀린 경우: 덱은 이 기기에 이미 보관됐으므로 편집기를 떠나도 안전하다
      if(/로그인/.test(e.message)){
        if(confirm(e.message+'\n\n지금 다시 로그인할까요? (덱은 그대로 보관됩니다)')){
          NET.token=null;
          try{ localStorage.removeItem('rb_token'); }catch(_){}
          enterLogin();
        }
      }
    }
  };
}

// ---------- 로비 ----------
function renderLobbyDeckSelect(){
  const sel=document.getElementById('lobby-deck');
  sel.innerHTML='';
  // 계정(서버) 덱 + 이 기기(로컬) 덱 — 로컬 덱은 서버 초기화와 무관하게 유지됨
  myDecks.forEach((d,i)=>{
    const o=document.createElement('option');
    o.value='s'+i; o.textContent=`${d.name} (${card(d.legendN).ko})`;
    sel.appendChild(o);
  });
  DeckStore._read().forEach((d,i)=>{
    const o=document.createElement('option');
    o.value='l'+i; o.textContent=`📱 ${d.name} (${card(d.legendN).ko}) — 이 기기`;
    sel.appendChild(o);
  });
}
// 로비 덱 선택값 → 서버로 보낼 페이로드 ({deckIdx} 또는 {deck: 로컬 덱 원본})
// 대전에 실어 보낼 덱 — 사이드덱은 본인만 쓰는 비공개 정보라 빼고 보낸다
function deckForMatch(d){
  if(!d || d.side===undefined) return d;
  const out={...d}; delete out.side; return out;
}
function lobbyDeckPayload(){
  const v=document.getElementById('lobby-deck').value;
  if(v && v[0]==='l'){
    const d=DeckStore._read()[+v.slice(1)];
    return d ? {deck:deckForMatch(d)} : null;
  }
  return {deckIdx:+String(v).replace(/^s/,'')};
}
// 현재 선택된 로비 덱 객체 (밴 검사용)
function lobbySelectedDeck(){
  const v=document.getElementById('lobby-deck').value;
  if(v && v[0]==='l') return DeckStore._read()[+v.slice(1)]||null;
  return myDecks[+String(v).replace(/^s/,'')]||null;
}
// 밴 적용을 선택했다면 자기 덱부터 검사 (통과 시 true)
// banOn: 이 대전에 밴 규칙이 적용되는가 (방을 만들 때는 내 선택, 입장할 때는 방장의 선택)
function banSelfCheck(banOn, deck){
  if(!banOn || !deck) return true;
  const b=deckBannedCards(deck);
  if(!b.length) return true;
  UI.toast('🚫 밴 적용 대전입니다 — 이 덱에는 밴 카드가 있습니다: '+b.map(n=>card(n).ko).join(', '),'warn');
  return false;
}
function renderRooms(roomsArr){
  const el=document.getElementById('room-list');
  el.innerHTML='';
  if(!roomsArr.length){
    el.innerHTML='<div class="hint" style="padding:30px;text-align:center;width:100%">열린 방이 없습니다. 방을 만들어보세요!</div>';
    return;
  }
  roomsArr.forEach(r=>{
    const div=document.createElement('div'); div.className='deck-card room-card';
    div.innerHTML=`<h3>${esc(r.name)}${r.banRule?' <span class="ban-flag" style="font-size:12px">🚫 밴 적용</span>':''}</h3><div class="dk-info">방장: ${esc(r.host)} · ${r.count}/2${r.banRule?' · 🚫 밴 적용 방 — 밴 카드가 없는 덱으로만 입장할 수 있습니다':''}</div>`;
    const btns=document.createElement('div'); btns.className='dk-btns';
    const bj=document.createElement('button'); bj.className='join-btn'; bj.textContent='선택한 덱으로 입장';
    bj.onclick=()=>{
      const pay=lobbyDeckPayload();
      if(!pay){ UI.toast('덱을 선택하세요','warn'); return; }
      // 밴 적용 여부는 방장이 정한다 — 밴 방이면 내 덱에 밴 카드가 없어야 입장할 수 있다
      if(!banSelfCheck(r.banRule, lobbySelectedDeck())) return;
      NET.send({t:'joinRoom', roomId:r.id, ...pay, banRule:document.getElementById('lobby-ban').checked, ver:(typeof BUILDINFO!=='undefined'?BUILDINFO.version:'?')});
    };
    btns.appendChild(bj);
    div.appendChild(btns);
    el.appendChild(div);
  });
}
function initLobby(){
  document.getElementById('btn-lobby-back').onclick=()=>{
    NET.send({t:'leaveRoom'});
    document.getElementById('lobby-status').textContent='';
    showScreen('menu-screen');
  };
  document.getElementById('btn-create-room').onclick=()=>{
    const pay=lobbyDeckPayload();
    if(!pay){ UI.toast('덱을 선택하세요','warn'); return; }
    const manual = !document.getElementById('lobby-auto').checked;
    const ban=document.getElementById('lobby-ban').checked;
    if(!banSelfCheck(ban, lobbySelectedDeck())) return;
    NET.send({t:'createRoom', ...pay, manual, banRule:ban, name:document.getElementById('lobby-room-name').value.trim(), ver:(typeof BUILDINFO!=='undefined'?BUILDINFO.version:'?')});
  };
  NET.onRooms=renderRooms;
  NET.onRoomCreated=(room)=>{
    document.getElementById('lobby-status').textContent=`⏳ 「${room.name}」 — 상대를 기다리는 중... (다른 플레이어가 입장하면 자동 시작)`;
    document.getElementById('room-list').innerHTML='';
  };
  NET.onErr=(msg)=>UI.toast(msg,'warn');
  NET.onOppLeft=()=>{
    if(typeof STATS!=='undefined' && typeof NET!=='undefined') STATS.gameEnd(NET.seat, 'left');
    alert('상대가 나갔습니다. 로비로 돌아갑니다.');
    location.reload();
  };
  NET.onStart=(m)=>startOnlineGame(m);
}

// ---------- P2P 직접 대전 (서버 없이) ----------
function p2pRefreshDecks(){
  const sel=document.getElementById('p2p-deck');
  sel.innerHTML='';
  const auto=document.createElement('option');
  auto.value='auto'; auto.textContent='🎲 무작위 자동 덱 (바로 시작)';
  sel.appendChild(auto);
  DeckStore._read().forEach((d,i)=>{
    const o=document.createElement('option');
    o.value=i; o.textContent=`${d.name} (${card(d.legendN).ko})`;
    sel.appendChild(o);
  });
}
function p2pGetDeck(){
  const v=document.getElementById('p2p-deck').value;
  if(v==='auto'){
    const l=legendList()[Math.floor(Math.random()*legendList().length)];
    const d=buildDeck(l.n);
    return { name:'자동 덱', legendN:l.n, champN:d.champN, main:d.deck.slice(0,40), runes:d.runes, bfs:d.bfs };
  }
  return DeckStore._read()[+v];
}
function p2pNick(){
  const n=document.getElementById('p2p-nick').value.trim()||'플레이어';
  localStorage.setItem('rb_nick', n);
  return n.slice(0,16);
}
async function copyText(ta){
  ta.select();
  try{ await navigator.clipboard.writeText(ta.value); UI.toast('복사되었습니다!'); }
  catch(e){ document.execCommand('copy'); UI.toast('복사되었습니다!'); }
}
async function copyStr(text){
  try{ await navigator.clipboard.writeText(text); UI.toast('복사되었습니다!'); }
  catch(e){ UI.toast('복사하지 못했습니다. 직접 선택해 복사해 주세요.','warn'); }
}
// 시그널링 설정: 비워 두면 공개 브로커, 채우면 직접 띄운 서버 (양쪽이 같아야 함)
function p2pSignalOpts(){
  return { signalUrl: (localStorage.getItem('rb_signal_url')||'').trim() };
}
function initP2P(){
  const $ = id => document.getElementById(id);
  let role = null;   // 'host' | 'guest' — 연결 전 단계의 안내를 어느 쪽에 띄울지

  $('btn-goto-p2p').onclick=()=>{
    $('p2p-nick').value=localStorage.getItem('rb_nick')||'';
    $('p2p-signal-url').value=localStorage.getItem('rb_signal_url')||'';
    p2pRefreshDecks();
    showScreen('p2p-screen');
  };
  $('btn-p2p-back').onclick=()=>{ P2P.reset(); showScreen('connect-screen'); };
  $('btn-p2p-decks').onclick=()=>{
    DeckStore.local=true; DeckStore.returnTo='p2p-screen';
    DeckStore.list().then(d=>{ myDecks=d; renderDeckList(); showScreen('decks-screen'); });
  };
  $('p2p-signal-url').onchange=(e)=>localStorage.setItem('rb_signal_url', e.target.value.trim());

  const hostStatus=t=>$('p2p-host-status').textContent=t;
  const guestStatus=t=>$('p2p-guest-status').textContent=t;

  // 연결 상태 표시 (게임 시작은 start 메시지가 처리)
  P2P.onStatus=(s, msg)=>{
    // 연결 전에는 P2P.isHost가 아직 안 정해진 구간이 있어 role을 함께 본다
    const set=(t)=>{ ((role ? role==='host' : P2P.isHost) ? hostStatus : guestStatus)(t); };
    if(s==='connected'){ hostStatus('✅ 연결됨! 게임을 시작합니다...'); guestStatus('✅ 연결됨! 게임을 시작합니다...'); }
    else if(s==='answered'){ set('상대를 찾았습니다. 연결하는 중...'); }
    else if(s==='sigerror'){ set('오류: '+msg); }
    else if(s==='failed'){
      set('❌ P2P 연결 실패 — 네트워크가 WebRTC 직결을 차단하는 것 같습니다 (사내망·방화벽·일부 공유기). '
        +'① Windows 방화벽에서 이 앱 허용 확인 ② 휴대폰 핫스팟으로 재시도 ③ 같은 네트워크라면 서버 모드(방법 B)가 확실합니다.');
      UI.toast('P2P 연결 실패 — 네트워크가 직결을 차단하는 것 같습니다','warn');
    }
    else if(s==='stalled'){
      set((role ? role==='host' : P2P.isHost)
        ? '⏳ 20초째 연결 중 — 계속 안 되면 사내망/방화벽의 P2P 차단일 가능성이 큽니다. 휴대폰 핫스팟으로 시험해 보거나 서버 모드(방법 B)를 사용하세요.'
        : '⏳ 아직 연결 대기 중 — 네트워크가 P2P를 차단 중일 수 있습니다. 1분 넘게 지속되면 서버 모드(방법 B)를 사용하세요.');
    }
  };

  // ══ 기본: 6자리 방 코드 ══
  $('btn-p2p-host').onclick=async ()=>{
    const deck=p2pGetDeck();
    if(!deck){ UI.toast('덱을 선택하세요','warn'); return; }
    const ban=$('p2p-ban').checked;
    if(!banSelfCheck(ban, deck)) return;
    role='host';
    $('p2p-code-box').style.display='none';
    hostStatus('방을 만드는 중... (몇 초 걸릴 수 있음)');
    try{
      const manual = !$('p2p-auto').checked;
      const code=await P2P.hostViaCode(p2pNick(), deckForMatch(deck), manual, ban, p2pSignalOpts());
      $('p2p-code').textContent=SIGNAL.pretty(code);
      $('p2p-code-box').style.display='';
      hostStatus('친구가 코드를 입력하기를 기다리는 중...');
    }catch(e){
      hostStatus('오류: '+e.message+' — [고급]에서 코드를 직접 교환해 보세요.');
    }
  };
  $('btn-copy-code').onclick=()=>copyStr(SIGNAL.pretty(P2P.roomCode||''));

  // 입력 편의: 대문자 + 3글자 뒤 하이픈 자동
  $('p2p-code-in').oninput=(e)=>{
    const raw=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,SIGNAL.CODE_LEN);
    e.target.value = raw.length>3 ? raw.slice(0,3)+'-'+raw.slice(3) : raw;
  };
  $('p2p-code-in').onkeydown=(e)=>{ if(e.key==='Enter') $('btn-p2p-join').click(); };

  $('btn-p2p-join').onclick=async ()=>{
    const deck=p2pGetDeck();
    if(!deck){ UI.toast('덱을 선택하세요','warn'); return; }
    const ban=$('p2p-ban').checked;
    if(!banSelfCheck(ban, deck)) return;
    const raw=$('p2p-code-in').value.trim();
    if(!raw){ UI.toast('방 코드를 입력하세요','warn'); return; }
    role='guest';
    guestStatus('방을 찾는 중...');
    try{ await P2P.joinViaCode(p2pNick(), deckForMatch(deck), raw, ban, p2pSignalOpts()); }
    catch(e){ guestStatus('오류: '+e.message); }
  };

  // ══ 고급(폴백): 초대/응답 코드 직접 교환 ══
  $('btn-p2p-host-manual').onclick=async ()=>{
    const deck=p2pGetDeck();
    if(!deck){ UI.toast('덱을 선택하세요','warn'); return; }
    const ban=$('p2p-ban').checked;
    if(!banSelfCheck(ban, deck)) return;
    role='host';
    hostStatus('초대 코드 생성 중... (몇 초 걸릴 수 있음)');
    try{
      const manual = !$('p2p-auto').checked;
      const code=await P2P.host(p2pNick(), deckForMatch(deck), manual, ban);
      $('p2p-offer-out').value=code;
      hostStatus('① 초대 코드를 친구에게 보내고, ② 응답 코드를 기다리세요.');
    }catch(e){ hostStatus('오류: '+e.message); }
  };
  $('btn-copy-offer').onclick=()=>copyText($('p2p-offer-out'));
  $('btn-p2p-connect').onclick=async ()=>{
    const code=$('p2p-answer-in').value.trim();
    if(!code){ UI.toast('응답 코드를 붙여넣으세요','warn'); return; }
    role='host';
    hostStatus('연결 중...');
    try{ await P2P.acceptAnswer(code); }
    catch(e){ hostStatus('오류: '+e.message); }
  };
  $('btn-p2p-join-manual').onclick=async ()=>{
    const deck=p2pGetDeck();
    if(!deck){ UI.toast('덱을 선택하세요','warn'); return; }
    const ban=$('p2p-ban').checked;
    if(!banSelfCheck(ban, deck)) return;
    const code=$('p2p-offer-in').value.trim();
    if(!code){ UI.toast('초대 코드를 붙여넣으세요','warn'); return; }
    role='guest';
    guestStatus('응답 코드 생성 중... (몇 초 걸릴 수 있음)');
    try{
      const ans=await P2P.join(p2pNick(), deckForMatch(deck), code, ban);
      $('p2p-answer-out').value=ans;
      guestStatus('응답 코드를 방장에게 보내세요. 방장이 [연결하기]를 누르면 자동 시작!');
    }catch(e){ guestStatus('오류: '+e.message); }
  };
  $('btn-copy-answer').onclick=()=>copyText($('p2p-answer-out'));
}

// ---------- 재대결 (온라인 로비/P2P 공용 — 액션 릴레이에 핸드셰이크를 태운다) ----------
// 흐름: 한쪽이 덱 선택 → {k:'rematch', deck} 송신(양측 에코) → 상대도 덱 선택 →
//       양쪽 덱이 모이면 좌석 0(호스트 권한)이 {k:'rematchGo', seed} → 양측이 동일하게 새 게임 시작.
const RM = {
  decks: [null, null],
  reset(){ RM.decks=[null,null]; },
  // 덱 선택 모달 (fromRequest: 상대의 요청을 받고 여는 경우)
  // ── 사이드덱 교체 (게임 사이에만) ──
  // 공식 규칙: 1장 넣으면 1장 빼서 메인은 항상 40장, 사이드는 8장.
  // 선발 챔피언도 이때 바꿀 수 있다 (전설 태그가 맞고 메인에 들어 있어야 한다).
  openSideboard(deck, ban, onDone){
    const main=[...deck.main], side=[...(deck.side||[])];
    let champN=deck.champN;
    const legend=card(deck.legendN);
    const legendTags=(legend&&legend.tags)||[];
    // 상대 전설·선발 챔피언은 공개 정보다 (룰 352.10.a.1) — 무엇을 상대했는지 보고 고르라고 띄워 준다
    let oppInfo='';
    try{
      const o=(typeof G!=='undefined'&&G&&G.players)?G.players[opp(NET.seat)]:null;
      if(o) oppInfo=`상대: ${card(o.legendN).ko} · 선발 ${o.champN?card(o.champN).ko:'-'}`;
    }catch(e){}

    const box=document.getElementById('modal-box');
    const render=()=>{
      const okNow = main.length===40 && side.length===8;
      const group=arr=>{ const g={}; arr.forEach(n=>g[n]=(g[n]||0)+1); return g; };
      const listHTML=(arr,cls)=>{
        const g=group(arr);
        const rows=Object.keys(g).map(n=>card(+n)).sort((a,b)=>(a.e??0)-(b.e??0)||a.ko.localeCompare(b.ko))
          .map(c=>`<div class="sb-row ${cls}" data-n="${c.n}"><span class="cnt">×${g[c.n]}</span> [${c.e??0}] ${esc(c.ko)}</div>`);
        return rows.join('') || '<div class="sb-empty">비어 있음</div>';
      };
      // 선발 후보: 메인에 들어 있고 전설 태그가 맞는 챔피언
      const champCands=[...new Set(main.filter(n=>{ const c=card(n);
        return c.type==='Unit' && c.super==='Champion' && (c.tags||[]).some(t=>legendTags.includes(t)); }))];
      if(champCands.length && !champCands.includes(champN)) champN=champCands[0];

      box.innerHTML=`<h3>🔁 사이드덱 교체</h3>
        <div class="sb-note">${esc(oppInfo)}${oppInfo?' · ':''}같은 수만큼 주고받아 메인 40장을 맞추세요${ban?' · 🚫 밴 적용 대전':''}</div>
        <div class="sb-cols">
          <div class="sb-col">
            <div class="sb-head">메인 덱 <b class="${main.length===40?'':'bad'}">${main.length}</b>/40 <small>클릭 → 사이드로</small></div>
            <div class="sb-list" id="sb-main">${listHTML(main,'to-side')}</div>
          </div>
          <div class="sb-col">
            <div class="sb-head">사이드덱 <b class="${side.length===8?'':'bad'}">${side.length}</b>/8 <small>클릭 → 메인으로</small></div>
            <div class="sb-list" id="sb-side">${listHTML(side,'to-main')}</div>
          </div>
        </div>
        <div class="sb-champ">선발 챔피언 <select id="sb-champ">${
          champCands.map(n=>`<option value="${n}"${n===champN?' selected':''}>${esc(card(n).ko)}</option>`).join('')
          || '<option value="">(메인에 챔피언이 없습니다)</option>'}</select></div>
        <div class="modal-btns">
          <button class="primary" id="sb-ok"${okNow?'':' disabled'}>이 구성으로 시작</button>
          <button id="sb-reset">처음 구성으로</button>
          <button id="sb-cancel">취소</button>
        </div>`;

      box.querySelectorAll('.sb-row').forEach(row=>{
        const n=+row.dataset.n;
        row.onmouseenter=()=>UI.inspect(card(n));
        row.oncontextmenu=e=>{ e.preventDefault(); UI.showZoom(card(n)); };
        row.onclick=()=>{
          if(row.classList.contains('to-side')){ main.splice(main.indexOf(n),1); side.push(n); }
          else { side.splice(side.indexOf(n),1); main.push(n); }
          render();
        };
      });
      const cs=box.querySelector('#sb-champ');
      if(cs) cs.onchange=()=>{ champN=+cs.value; };
      box.querySelector('#sb-reset').onclick=()=>{
        main.length=0; main.push(...deck.main);
        side.length=0; side.push(...(deck.side||[]));
        champN=deck.champN; render();
      };
      box.querySelector('#sb-cancel').onclick=()=>{ closeModal(); UI.prompt(''); };
      const okBtn=box.querySelector('#sb-ok');
      okBtn.onclick=()=>{
        if(main.length!==40 || side.length!==8){ UI.toast('메인 40장 · 사이드 8장을 맞춰주세요','warn'); return; }
        const out={...deck, main:[...main], side:[...side], champN};
        if(ban && !banSelfCheck(true, out)) return;
        closeModal();
        onDone(out);
      };
    };
    render();
    openModal();
  },

  openPick(fromRequest){
    if(!NET.online || !NET.lastStart){ UI.toast('온라인 대전 중에만 사용할 수 있습니다','warn'); return; }
    const ban=!!NET.lastStart.banRule;
    const box=document.getElementById('modal-box');
    box.innerHTML=`<h3>🔄 ${fromRequest?'상대가 재대결을 요청했습니다':'상대와 다시 하기'}</h3>
      <div style="font-size:13px;color:#9aa4bd;margin-bottom:8px">사용할 덱을 선택하세요${ban?' · 🚫 밴 적용 대전':''} — 같은 상대와 바로 새 게임을 시작합니다</div>`;
    const sel=document.createElement('select');
    sel.style.cssText='width:100%;padding:8px;border-radius:6px;border:1px solid #3a4a70;background:#0e1626;color:#e8e6e0;font-size:14px;margin-bottom:10px';
    const auto=document.createElement('option'); auto.value='auto'; auto.textContent='🎲 무작위 자동 덱'; sel.appendChild(auto);
    (myDecks||[]).forEach((d,i)=>{ const o=document.createElement('option'); o.value='s'+i; o.textContent=`${d.name} (${card(d.legendN).ko})`; sel.appendChild(o); });
    DeckStore._read().forEach((d,i)=>{ const o=document.createElement('option'); o.value='l'+i; o.textContent=`📱 ${d.name} (${card(d.legendN).ko}) — 이 기기`; sel.appendChild(o); });
    box.appendChild(sel);
    const btns=document.createElement('div'); btns.className='modal-btns';
    const ok=document.createElement('button'); ok.className='primary'; ok.textContent=fromRequest?'수락 (이 덱으로)':'재대결 요청';
    ok.onclick=()=>{
      const deck=RM._resolveDeck(sel.value);
      if(!deck){ UI.toast('덱을 선택하세요','warn'); return; }
      if(ban && !banSelfCheck(true, deck)) return;
      const send=d=>{
        NET.sendAction({k:'rematch', p:NET.seat, deck:deckForMatch(d)});
        UI.prompt('🔄 재대결 준비 완료 — 상대의 덱 선택을 기다리는 중...');
      };
      // 사이드덱이 있는 덱이면 교체 화면을 한 번 거친다 (게임 사이에만 가능한 절차)
      if(deck.side && deck.side.length===8){ closeModal(); RM.openSideboard(deck, ban, send); return; }
      closeModal();
      send(deck);
    };
    btns.appendChild(ok);
    const no=document.createElement('button'); no.textContent=fromRequest?'거절':'취소';
    no.onclick=()=>{ closeModal(); if(fromRequest) NET.sendAction({k:'rematchDecline', p:NET.seat}); };
    btns.appendChild(no);
    box.appendChild(btns);
    openModal(); markModalDismissable();
  },
  _resolveDeck(v){
    if(v==='auto'){ const l=legendList()[Math.floor(Math.random()*legendList().length)]; const d=buildDeck(l.n);
      return {name:'자동 덱', legendN:l.n, champN:d.champN, main:d.deck.slice(0,40), runes:d.runes, bfs:d.bfs}; }
    if(v[0]==='l') return DeckStore._read()[+v.slice(1)]||null;
    return (myDecks||[])[+v.slice(1)]||null;
  },
  onRequest(a){
    RM.decks[a.p]=a.deck;
    if(a.p!==NET.seat && !RM.decks[NET.seat]){
      const ov=document.getElementById('modal-overlay');
      const blocking = ov.style.display!=='none' && !ov.dataset.dismiss
                       && !document.querySelector('.victory-box');   // 승리 창은 덮어도 안전(경기 종료)
      // 한 명씩 고르는 흐름: 요청을 받으면 내 덱 선택 창을 바로 띄운다.
      // 정말로 진행 중인 선택이 있을 때만 미루고 안내한다.
      if(blocking) UI.toast('상대가 재대결을 요청했습니다 — ESC 메뉴에서 수락할 수 있습니다','warn');
      else RM.openPick(true);
    }
    RM._tryStart();
  },
  onDecline(a){
    if(a.p!==NET.seat){
      RM.reset();
      const ov=document.getElementById('modal-overlay');
      if(ov.style.display!=='none' && ov.dataset.dismiss) closeModal();
      UI.toast('상대가 재대결을 거절했습니다','warn'); UI.prompt('');
    } else RM.reset();
  },
  _tryStart(){
    if(RM.decks[0] && RM.decks[1] && NET.seat===0){
      const seed=crypto.getRandomValues(new Uint32Array(1))[0];
      // 덱을 시작 신호에 같이 실어 보낸다 — 양쪽이 각자 기억한 덱이 아니라 이 값을 쓰므로
      // 한쪽 덱만 예전 것으로 시작되는 어긋남이 생기지 않는다.
      NET.sendAction({k:'rematchGo', p:0, seed, decks:[RM.decks[0], RM.decks[1]]});
    }
  },
  onGo(a){
    const ls=NET.lastStart; if(!ls) return;
    const decks = (a.decks && a.decks[0] && a.decks[1]) ? a.decks : RM.decks;  // 신호에 실린 덱이 우선
    if(!decks[0] || !decks[1]) return;
    const m={ t:'start', seed:a.seed, yourSeat:NET.seat, manual:ls.manual, banRule:ls.banRule,
      players:[ {id:ls.players[0].id, deck:decks[0]}, {id:ls.players[1].id, deck:decks[1]} ] };
    RM.reset();
    const ov=document.getElementById('modal-overlay'); if(ov.style.display!=='none') closeModal();
    UI.log('🔄 재대결 시작!', 'sys');
    setTimeout(()=>startOnlineGame(m), 0);   // 액션 펌프 밖에서 새 게임 시작 (큐 리셋과 충돌 방지)
  },
};

// ---------- ESC 시스템 메뉴 & 게임 나가기 ----------
function gameLeave(){
  if(NET.online){
    if(typeof P2P!=='undefined' && P2P.active){
      P2P.reset(); NET.online=false; NET.resetGameSync();
      p2pRefreshDecks(); showScreen('p2p-screen');
      UI.toast('P2P 연결을 종료했습니다');
    } else {
      NET.send({t:'leaveRoom'});
      NET.online=false; NET.resetGameSync();
      document.getElementById('lobby-status').textContent='';
      showScreen('lobby-screen');
      NET.send({t:'listRooms'});
    }
  } else {
    location.reload();
  }
}
// 항복 — 온라인은 내 좌석, 봇전은 사람 좌석, 핫시트는 현재 턴 플레이어가 항복한다
function confirmSurrender(){
  if(!G || G.winner!==null){ UI.toast('이미 끝난 경기입니다','warn'); return; }
  const me = NET.online ? NET.seat
           : (typeof BOT!=='undefined' && BOT.active) ? opp(BOT.seat ?? 1)
           : G.turn;
  const box=document.getElementById('modal-box');
  box.innerHTML='<h3>🏳 항복</h3>';
  const t=document.createElement('div');
  t.style.cssText='font-size:14px;line-height:1.7;margin-bottom:6px';
  t.textContent=`${pname(me)}이(가) 항복하고 ${pname(opp(me))}의 승리로 경기를 끝냅니다. 계속할까요?`;
  box.appendChild(t);
  const btns=document.createElement('div'); btns.className='modal-btns';
  const y=document.createElement('button'); y.className='primary'; y.textContent='항복하기';
  y.onclick=()=>{ closeModal(); NET.dispatch({k:'surrender', p:me}, ()=>surrender(me)); };
  const n=document.createElement('button'); n.textContent='취소'; n.onclick=closeModal;
  btns.appendChild(y); btns.appendChild(n); box.appendChild(btns);
  openModal(); markModalDismissable();
}
function openSystemMenu(){
  const box=document.getElementById('modal-box');
  const isBot=(typeof BOT!=='undefined' && BOT.active && !NET.online);
  box.innerHTML=`<h3>⚙️ 메뉴</h3>`;
  const btns=document.createElement('div'); btns.className='modal-btns'; btns.style.flexDirection='column';
  const add=(label,fn,primary)=>{ const b=document.createElement('button'); if(primary) b.className='primary';
    b.textContent=label; b.onclick=fn; btns.appendChild(b); return b; };
  if(NET.online){
    const reqPending = RM.decks[1-NET.seat] && !RM.decks[NET.seat];
    add(reqPending?'🔄 상대의 재대결 요청 수락 (덱 선택)':'🔄 상대와 다시 하기 (덱 선택)', ()=>{ closeModal(); RM.openPick(!!reqPending); }, true);
    add(P2P.active?'🚪 나가기 (연결 종료)':'🚪 로비로 가기', ()=>{ closeModal(); gameLeave(); });
  } else if(isBot){
    // BOT.active를 여기서 끄면 안 된다 — 봇 선택 모달에서 '취소'하면 그대로 진행 중인 판으로
    // 돌아오는데, 그때 봇이 멈추고(드라이버가 BOT.active를 본다) 봇 손패 가림막·프롬프트
    // 가로채기까지 함께 풀린다. 새 판을 시작하면 startBotGame → newGame 래퍼가 알아서 끈다.
    // (모달이 열려 있는 동안 봇이 움직이는 문제는 드라이버의 modal-overlay 검사가 이미 막는다)
    add('🔄 다시 하기 (봇/덱 선택)', ()=>{ closeModal(); openBotSelect(); }, true);
    add('🚪 처음 화면으로', ()=>location.reload());
  } else if(typeof TUT!=='undefined' && TUT.active){
    // 튜토리얼 중 '핫시트 새 게임'을 권하면 수업 한가운데서 다른 모드로 끌려간다
    add('🔄 튜토리얼 다시 시작', ()=>{ closeModal(); TUT.start(); }, true);
    add('🚪 처음 화면으로', ()=>location.reload());
  } else {
    add('🔄 다시 하기 (핫시트 새 게임)', ()=>{ closeModal(); startHotseat(); }, true);
    add('🚪 처음 화면으로', ()=>location.reload());
  }
  // 현재 행동 넘기기(패스) — 결전 중 내 응답 차례일 때 (사이드바 패스 버튼과 동일 동작)
  if(G && G.winner===null && G.state==='showdown'
     && !(NET.online && G.actingPlayer!==NET.seat) && canInitiate(G.actingPlayer)){
    add('⏭ 현재 행동 넘기기 (패스)', ()=>{ closeModal();
      NET.dispatch({k:'pass'}, ()=>showdownPass()); });
  }
  if(G && G.winner===null) add('🏳 항복하기 (서렌)', ()=>{ closeModal(); confirmSurrender(); });
  // 채팅 무시 — 온라인 대전에서만 의미가 있다. 켜면 수신 숨김 + 입력창 숨김 (localStorage로 유지)
  if(NET.online) add(UI.chatMuted ? '🔊 채팅 무시 해제' : '🔇 채팅 무시하기', ()=>{
    UI.setChatMuted(!UI.chatMuted); closeModal(); UI.render();
    UI.toast(UI.chatMuted ? '채팅을 무시합니다 — 상대 메시지가 표시되지 않습니다' : '채팅 무시를 해제했습니다');
  });
  add('🎬 리플레이 저장 (지금까지)', ()=>{ closeModal(); REPLAY.saveNow(); });
  add(UI.fx.on?'✨ 이펙트 끄기':'✨ 이펙트 켜기', ()=>{ UI.fx.setOn(!UI.fx.on); closeModal();
    UI.toast(UI.fx.on?'이펙트를 켰습니다':'이펙트를 껐습니다'); });
  add(`🔍 화면 배율 (${Math.round(uiScale()*100)}%)`, ()=>{ closeModal(); showScalePicker(false); });
  add('계속하기', closeModal);
  box.appendChild(btns);
  openModal(); markModalDismissable();
}

// ---------- 게임 시작 ----------
function startOnlineGame(m){
  if(typeof STATS!=='undefined') STATS.gameStart((typeof P2P!=='undefined' && P2P.active) ? 'p2p' : 'online');
  NET.online=true;
  NET.seat=m.yourSeat;
  NET.lastStart=m;    // 재대결용: 모드/밴/플레이어 이름 보존
  RM.reset();
  NET.resetGameSync();
  // 결정론: 시드 → 전장 선택(각자 3개 중 1개 무작위)도 rng 사용
  seedRng(m.seed);
  const bfs = m.players.map(pl=>pl.deck.bfs[Math.floor(rng()*pl.deck.bfs.length)]);
  newGame({
    seed: m.seed,
    manual: m.manual,
    players: m.players.map(pl=>({
      name: pl.id, legendN: pl.deck.legendN, champN: pl.deck.champN,
      deck: pl.deck.main, runes: pl.deck.runes, arts: pl.deck.arts,
    })),
    bfs,
  });
  showScreen('game-screen');
  const modeLabel = G.manual ? '수동' : '자동';
  document.getElementById('net-info').textContent=`🌐 온라인(${modeLabel}${m.banRule?' · 🚫밴':''}) — 나: ${m.players[NET.seat].id} (${NET.seat===0?'선공':'후공'})`;
  UI.log(`온라인 대전 시작! ${m.players[0].id} vs ${m.players[1].id} · 규칙 처리: ${modeLabel} 모드`, 'sys');
  if(m.banRule) UI.log(`🚫 밴 리스트 적용 대전입니다 (${BANLIST.region}, 기준일 ${BANLIST.updated})`, 'sys');
  UI.log('승리 조건: '+G.victory+'점 선취!', 'sys');
  mulliganPhase().then(()=>startTurn());
}

function startHotseat(){
  if(typeof STATS!=='undefined') STATS.gameStart('hotseat');
  NET.online=false; NET.seat=null;
  const p0legend=+document.getElementById('p0-legend').value;
  const p1legend=+document.getElementById('p1-legend').value;
  const d0=buildDeck(p0legend), d1=buildDeck(p1legend);
  const bf0=d0.bfs[Math.floor(Math.random()*3)];
  const bf1=d1.bfs[Math.floor(Math.random()*3)];
  const autoHs=document.getElementById('hs-auto')?.checked;
  newGame({
    manual: !autoHs,
    players:[
      { name:document.getElementById('p0-name').value||'플레이어 1', legendN:p0legend, champN:d0.champN, deck:d0.deck, runes:d0.runes, arts:d0.arts },
      { name:document.getElementById('p1-name').value||'플레이어 2', legendN:p1legend, champN:d1.champN, deck:d1.deck, runes:d1.runes, arts:d1.arts },
    ],
    bfs:[bf0,bf1],
  });
  showScreen('game-screen');
  document.getElementById('net-info').textContent='💺 오프라인 핫시트 ('+(G.manual?'수동':'자동')+')';
  UI.log('게임 시작! 각자 4장으로 시작합니다.', 'sys');
  mulliganPhase().then(()=>startTurn());
}

function initHotseat(){
  const legends=legendList();
  ['p0','p1'].forEach((pid,pi)=>{
    const sel=document.getElementById(pid+'-legend');
    legends.forEach(l=>{
      const o=document.createElement('option');
      o.value=l.n; o.textContent=`${l.ko} (${l.dom.map(d=>DOMAIN_KO[d]).join('/')})`;
      sel.appendChild(o);
    });
    sel.value = legends[pi===0?1:5].n;
    const preview=()=>{
      const l=card(+sel.value);
      document.getElementById(pid+'-legend-preview').innerHTML=
        `<img src="${cardImgUrl(l.img,480)}" alt=""><div class="lp-text">${renderIcons(esc(l.tko||l.text))}</div>`;
    };
    sel.onchange=preview; preview();
  });
  document.getElementById('btn-start').onclick=startHotseat;
  document.getElementById('btn-setup-back').onclick=()=>{
    showScreen(NET.token?'menu-screen':'connect-screen');
  };
}

// ---------- 초기화 ----------
window.addEventListener('DOMContentLoaded', ()=>{
  compileAllCards();
  initConnect();
  initLogin();
  initMenu();
  initPatchNotes();
  initRecord();
  initDecks();
  initEditor();
  initLobby();
  initP2P();
  initHotseat();
  document.getElementById('btn-replays').onclick=()=>REPLAY.openLibrary('connect-screen');
  // 오픈톡방 — 누르면 카카오톡 앱이 바로 뜨며 참여(딥링크, open.kakao.com PC 참여 버튼과 같은 형식).
  // 카톡 미설치 등에 대비해 링크도 함께 복사해 둔다 (clipboard API 실패 시 textarea 폴백)
  document.getElementById('btn-openchat').onclick=async()=>{
    const url='https://open.kakao.com/o/gFmCtkKi';
    const deep='kakaoopen://join?l=gFmCtkKi&r=EW';
    if(window.desktop) window.open(deep);            // Electron: setWindowOpenHandler → shell.openExternal
    else location.href=deep;                         // 브라우저: 프로토콜 열기 확인창 (페이지 이탈 없음)
    let ok=false;
    try{ await navigator.clipboard.writeText(url); ok=true; }
    catch(e){
      try{
        const ta=document.createElement('textarea'); ta.value=url;
        ta.style.cssText='position:fixed;opacity:0'; document.body.appendChild(ta);
        ta.select(); ok=document.execCommand('copy'); ta.remove();
      }catch(e2){}
    }
    if(ok){ UI.toast('💬 카카오톡으로 오픈톡방을 엽니다 — 안 열리면 복사된 링크를 브라우저에 붙여넣으세요'); return; }
    // 클립보드가 막힌 환경(권한 거부 등): 직접 복사할 수 있게 선택된 입력창을 띄운다
    const box=document.getElementById('modal-box');
    box.innerHTML='<h3>💬 시뮬레이터 오픈톡방</h3><div style="font-size:13px;color:#9aa4bd;margin-bottom:8px">자동 복사가 막혀 있습니다 — 아래 링크를 직접 복사하세요 (Ctrl+C)</div>';
    const inp=document.createElement('input');
    inp.type='text'; inp.readOnly=true; inp.value=url;
    inp.style.cssText='width:100%;padding:9px 10px;border-radius:6px;border:1px solid #3a4a70;background:#0e1626;color:#ffe990;font-size:14px';
    inp.onclick=()=>inp.select();
    box.appendChild(inp);
    const btns=document.createElement('div'); btns.className='modal-btns';
    const close=document.createElement('button'); close.textContent='닫기'; close.onclick=closeModal;
    btns.appendChild(close); box.appendChild(btns);
    openModal(); markModalDismissable();
    inp.select();
  };
  document.getElementById('btn-goto-replays').onclick=()=>REPLAY.openLibrary('menu-screen');
  document.getElementById('btn-banlist-decks').onclick=showBanlist;
  document.getElementById('btn-banlist-editor').onclick=showBanlist;
  document.getElementById('btn-tourney-decks').onclick=showTourneyDecks;
  document.getElementById('btn-tourney-editor').onclick=showTourneyDecks;
  if(typeof BUILDINFO!=='undefined')
    document.getElementById('build-tag').textContent=`v${BUILDINFO.version} · ${BUILDINFO.built}`;
  // 화면 배율: 저장값 적용 + 첫 화면 버튼. 모바일 첫 실행이면 선택 안내를 한 번 띄운다
  applyUiScale(uiScale());
  document.getElementById('btn-uiscale').onclick=()=>showScalePicker(false);
  // 익명 통계 — 기본 켜짐, 언제든 끌 수 있다. 버튼 자체가 수집 사실을 알리는 역할도 한다.
  {
    const btn=document.getElementById('btn-stats-optout');
    const paint=()=>{ btn.textContent='📊 익명 통계: '+(STATS.enabled()?'켜짐':'꺼짐'); };
    if(!STATS.URL){ btn.style.display='none'; }
    else {
      paint();
      btn.onclick=()=>{ STATS.setEnabled(!STATS.enabled()); paint();
        UI.toast(STATS.enabled()?'익명 통계를 보냅니다 (판수·덱 조합 승률만)':'익명 통계를 보내지 않습니다'); };
      STATS.launch();
    }
  }
  const isMobileUA=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if(isMobileUA && !localStorage.getItem(UISCALE_KEY) && !localStorage.getItem('rb_ui_scale_seen')){
    try{ localStorage.setItem('rb_ui_scale_seen','1'); }catch(e){}
    setTimeout(()=>showScalePicker(true), 400);
  }
  showScreen('connect-screen');
});
