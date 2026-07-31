// ══════════ 화면 흐름: 로그인 → 메뉴 → (덱 관리 | 로비 | 핫시트) → 게임 ══════════

const SCREENS = ['connect-screen','login-screen','menu-screen','decks-screen','editor-screen','lobby-screen','p2p-screen','setup-screen','game-screen'];
function showScreen(id){
  SCREENS.forEach(s=>{ document.getElementById(s).style.display = s===id ? 'flex' : 'none'; });
  // 법적 고지 푸터: 게임 화면에서는 보드를 가리지 않게 숨김, 그 외 입장 화면에서는 상시 노출
  const lf=document.getElementById('legal-footer');
  if(lf) lf.style.display = (id==='game-screen') ? 'none' : 'block';
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
    if(!this.local) return NET.saveDeck(deck,index);
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
function initConnect(){
  const input=document.getElementById('server-url');
  const msg=document.getElementById('connect-msg');
  input.value = localStorage.getItem('rb_server') || 'http://localhost:8321';
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

function enterLogin(){
  const secure = /^https:/i.test(NET.base) || /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(NET.base);
  document.getElementById('login-server-label').textContent =
    '서버: '+NET.base + (secure?' 🔒':' ⚠️ 암호화 안 됨');
  showScreen('login-screen');
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
    try{ await fn(id,pw); await enterMenu(); }
    catch(e){ msg.textContent=e.message; }
  };
  document.getElementById('btn-login').onclick=()=>doAuth(NET.login);
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
  openModal();
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
  openModal();
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
  openModal();
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
const ED = { index:null, main:[], runes:{}, bfs:[], legendN:null, champOverride:null, selN:null };

function openEditor(index){
  ED.index=index;
  if(index!==null){
    const d=myDecks[index];
    ED.legendN=d.legendN;
    ED.main=[...d.main];
    ED.bfs=[...d.bfs];
    ED.runes={};
    d.runes.forEach(n=>{ ED.runes[n]=(ED.runes[n]||0)+1; });
    document.getElementById('ed-name').value=d.name;
  } else {
    ED.legendN=legendList()[0].n;
    ED.main=[]; ED.bfs=[]; ED.runes={};
    document.getElementById('ed-name').value='새 덱 '+(myDecks.length+1);
  }
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

function edIsCustom(){ return document.getElementById('ed-legend').value==='custom'; }
function edLegend(){ return edIsCustom() ? null : card(+document.getElementById('ed-legend').value); }
// 전설 기준 자동 챔피언 (견본덱 방식) — 나만의 덱에서는 자동 배정 없음
function edAutoChampN(){
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
function edAddCard(c){
  // 밴 카드는 넣을 수는 있지만 (밴 미적용 대전용), 실제로 추가됐을 때만 경고를 띄운다
  const warnBan=()=>{ if(isBanned(c.n)) UI.toast(`🚫 「${c.ko}」는 밴 카드입니다 — 밴 적용 대전에서는 이 덱을 쓸 수 없습니다`,'warn'); };
  if(c.type==='Battlefield'){
    if(ED.bfs.includes(c.n)){ UI.toast('같은 전장은 1개까지입니다','warn'); return false; }
    if(ED.bfs.length>=3){ UI.toast('전장은 3개까지입니다','warn'); return false; }
    ED.bfs.push(c.n); warnBan(); return true;
  }
  const cnt=ED.main.filter(n=>n===c.n).length;
  if(cnt>=3){ UI.toast('같은 카드는 3장까지입니다','warn'); return false; }
  if(ED.main.length>=40){ UI.toast('메인 덱은 40장입니다','warn'); return false; }
  if(c.n===edChampN()){ UI.toast('선발 챔피언은 자동 배정됩니다 (챔피언 존)','warn'); return false; }
  ED.main.push(c.n); warnBan(); return true;
}
function edRemoveCard(c){
  if(c.type==='Battlefield'){
    const i=ED.bfs.indexOf(c.n);
    if(i<0) return false;
    ED.bfs.splice(i,1); return true;
  }
  const i=ED.main.indexOf(c.n);
  if(i<0) return false;
  ED.main.splice(i,1); return true;
}
function edCardCount(c){
  return c.type==='Battlefield' ? (ED.bfs.includes(c.n)?1:0) : ED.main.filter(n=>n===c.n).length;
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
      plus.onclick=(e)=>{ e.stopPropagation(); if(edAddCard(c)) renderEditor(); };
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
  Object.entries(grouped).sort((a,b)=>(card(+a[0]).e||0)-(card(+b[0]).e||0)).forEach(([n,cnt])=>{
    const c=card(+n);
    const row=document.createElement('div'); row.className='ed-row';
    row.innerHTML=`<span class="cnt">×${cnt}</span> [${c.e??0}] ${esc(c.ko)}`;
    row.onmouseenter=()=>UI.inspect(c);
    row.onclick=()=>{ ED.main.splice(ED.main.indexOf(+n),1); renderEditor(); };
    mainEl.appendChild(row);
  });
  document.getElementById('ed-main-count').textContent=ED.main.length;

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
    row.onmouseenter=()=>UI.inspect(c);
    row.onclick=()=>{ ED.bfs.splice(ED.bfs.indexOf(n),1); renderEditor(); };
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
  ['ed-type-filter','ed-search','ed-dom-only'].forEach(id=>{
    document.getElementById(id).addEventListener('input',()=>renderEditor());
  });
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
    };
    if(deck.main.length!==40){ msg.textContent='메인 덱은 정확히 40장이어야 합니다'; return; }
    if(runes.length!==12){ msg.textContent='룬은 정확히 12개여야 합니다'; return; }
    if(deck.bfs.length!==3){ msg.textContent='전장은 정확히 3개여야 합니다'; return; }
    const bannedIn=deckBannedCards(deck);
    if(bannedIn.length) UI.toast('🚫 밴 카드 포함 덱입니다 — 밴 적용 대전에서는 사용할 수 없습니다: '+bannedIn.map(n=>card(n).ko).join(', '),'warn');
    try{
      myDecks=await DeckStore.save(deck, ED.index);
      if(!DeckStore.local) syncSrvBackup(myDecks);
      renderDeckList(); showScreen('decks-screen');
    }catch(e){ msg.textContent=e.message; }
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
function lobbyDeckPayload(){
  const v=document.getElementById('lobby-deck').value;
  if(v && v[0]==='l'){
    const d=DeckStore._read()[+v.slice(1)];
    return d ? {deck:d} : null;
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
function banSelfCheck(banChecked, deck){
  if(!banChecked || !deck) return true;
  const b=deckBannedCards(deck);
  if(!b.length) return true;
  UI.toast('🚫 밴 적용을 선택했지만 덱에 밴 카드가 있습니다: '+b.map(n=>card(n).ko).join(', '),'warn');
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
    div.innerHTML=`<h3>${esc(r.name)}${r.banRule?' <span class="ban-flag" style="font-size:12px">🚫 밴 적용</span>':''}</h3><div class="dk-info">방장: ${esc(r.host)} · ${r.count}/2${r.banRule?' · 방장이 밴 적용을 선택한 방입니다 (나도 선택하면 밴 규칙 적용)':''}</div>`;
    const btns=document.createElement('div'); btns.className='dk-btns';
    const bj=document.createElement('button'); bj.className='join-btn'; bj.textContent='선택한 덱으로 입장';
    bj.onclick=()=>{
      const pay=lobbyDeckPayload();
      if(!pay){ UI.toast('덱을 선택하세요','warn'); return; }
      const ban=document.getElementById('lobby-ban').checked;
      if(!banSelfCheck(ban, lobbySelectedDeck())) return;
      NET.send({t:'joinRoom', roomId:r.id, ...pay, banRule:ban});
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
    NET.send({t:'createRoom', ...pay, manual, banRule:ban, name:document.getElementById('lobby-room-name').value.trim()});
  };
  NET.onRooms=renderRooms;
  NET.onRoomCreated=(room)=>{
    document.getElementById('lobby-status').textContent=`⏳ 「${room.name}」 — 상대를 기다리는 중... (다른 플레이어가 입장하면 자동 시작)`;
    document.getElementById('room-list').innerHTML='';
  };
  NET.onErr=(msg)=>UI.toast(msg,'warn');
  NET.onOppLeft=()=>{
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
function initP2P(){
  document.getElementById('btn-goto-p2p').onclick=()=>{
    document.getElementById('p2p-nick').value=localStorage.getItem('rb_nick')||'';
    p2pRefreshDecks();
    showScreen('p2p-screen');
  };
  document.getElementById('btn-p2p-back').onclick=()=>{ P2P.reset(); showScreen('connect-screen'); };
  document.getElementById('btn-p2p-decks').onclick=()=>{
    DeckStore.local=true; DeckStore.returnTo='p2p-screen';
    DeckStore.list().then(d=>{ myDecks=d; renderDeckList(); showScreen('decks-screen'); });
  };
  const hostStatus=t=>document.getElementById('p2p-host-status').textContent=t;
  const guestStatus=t=>document.getElementById('p2p-guest-status').textContent=t;

  // 연결 상태 표시 (게임 시작은 start 메시지가 처리)
  P2P.onStatus=(s)=>{
    const set=(t)=>{ (P2P.isHost?hostStatus:guestStatus)(t); };
    if(s==='connected'){ hostStatus('✅ 연결됨! 게임을 시작합니다...'); guestStatus('✅ 연결됨! 게임을 시작합니다...'); }
    else if(s==='failed'){
      set('❌ P2P 연결 실패 — 네트워크가 WebRTC 직결을 차단하는 것 같습니다 (사내망·방화벽·일부 공유기). '
        +'① Windows 방화벽에서 이 앱 허용 확인 ② 휴대폰 핫스팟으로 재시도 ③ 같은 네트워크라면 서버 모드(방법 B)가 확실합니다.');
      UI.toast('P2P 연결 실패 — 네트워크가 직결을 차단하는 것 같습니다','warn');
    }
    else if(s==='stalled'){
      set(P2P.isHost
        ? '⏳ 20초째 연결 중 — 계속 안 되면 사내망/방화벽의 P2P 차단일 가능성이 큽니다. 휴대폰 핫스팟으로 시험해 보거나 서버 모드(방법 B)를 사용하세요.'
        : '⏳ 아직 연결 대기 중 — 방장이 [연결하기]를 아직 안 눌렀거나, 네트워크가 P2P를 차단 중일 수 있습니다. 1분 넘게 지속되면 서버 모드(방법 B)를 사용하세요.');
    }
  };

  // ── 호스트 ──
  document.getElementById('btn-p2p-host').onclick=async ()=>{
    const deck=p2pGetDeck();
    if(!deck){ UI.toast('덱을 선택하세요','warn'); return; }
    const ban=document.getElementById('p2p-ban').checked;
    if(!banSelfCheck(ban, deck)) return;
    hostStatus('초대 코드 생성 중... (몇 초 걸릴 수 있음)');
    try{
      const manual = !document.getElementById('p2p-auto').checked;
      const code=await P2P.host(p2pNick(), deck, manual, ban);
      document.getElementById('p2p-offer-out').value=code;
      hostStatus('① 초대 코드를 친구에게 보내고, ② 응답 코드를 기다리세요.');
    }catch(e){ hostStatus('오류: '+e.message); }
  };
  document.getElementById('btn-copy-offer').onclick=()=>copyText(document.getElementById('p2p-offer-out'));
  document.getElementById('btn-p2p-connect').onclick=async ()=>{
    const code=document.getElementById('p2p-answer-in').value.trim();
    if(!code){ UI.toast('응답 코드를 붙여넣으세요','warn'); return; }
    hostStatus('연결 중...');
    try{ await P2P.acceptAnswer(code); }
    catch(e){ hostStatus('오류: '+e.message); }
  };

  // ── 게스트 ──
  document.getElementById('btn-p2p-join').onclick=async ()=>{
    const deck=p2pGetDeck();
    if(!deck){ UI.toast('덱을 선택하세요','warn'); return; }
    const ban=document.getElementById('p2p-ban').checked;
    if(!banSelfCheck(ban, deck)) return;
    const code=document.getElementById('p2p-offer-in').value.trim();
    if(!code){ UI.toast('초대 코드를 붙여넣으세요','warn'); return; }
    guestStatus('응답 코드 생성 중... (몇 초 걸릴 수 있음)');
    try{
      const ans=await P2P.join(p2pNick(), deck, code, ban);
      document.getElementById('p2p-answer-out').value=ans;
      guestStatus('응답 코드를 방장에게 보내세요. 방장이 [연결하기]를 누르면 자동 시작!');
    }catch(e){ guestStatus('오류: '+e.message); }
  };
  document.getElementById('btn-copy-answer').onclick=()=>copyText(document.getElementById('p2p-answer-out'));
}

// ---------- 게임 시작 ----------
function startOnlineGame(m){
  NET.online=true;
  NET.seat=m.yourSeat;
  NET.resetGameSync();
  // 결정론: 시드 → 전장 선택(각자 3개 중 1개 무작위)도 rng 사용
  seedRng(m.seed);
  const bfs = m.players.map(pl=>pl.deck.bfs[Math.floor(rng()*pl.deck.bfs.length)]);
  newGame({
    seed: m.seed,
    manual: m.manual,
    players: m.players.map(pl=>({
      name: pl.id, legendN: pl.deck.legendN, champN: pl.deck.champN,
      deck: pl.deck.main, runes: pl.deck.runes,
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
      { name:document.getElementById('p0-name').value||'플레이어 1', legendN:p0legend, champN:d0.champN, deck:d0.deck, runes:d0.runes },
      { name:document.getElementById('p1-name').value||'플레이어 2', legendN:p1legend, champN:d1.champN, deck:d1.deck, runes:d1.runes },
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
  initDecks();
  initEditor();
  initLobby();
  initP2P();
  initHotseat();
  document.getElementById('btn-banlist-decks').onclick=showBanlist;
  document.getElementById('btn-banlist-editor').onclick=showBanlist;
  document.getElementById('btn-tourney-decks').onclick=showTourneyDecks;
  document.getElementById('btn-tourney-editor').onclick=showTourneyDecks;
  if(typeof BUILDINFO!=='undefined')
    document.getElementById('build-tag').textContent=`v${BUILDINFO.version} · ${BUILDINFO.built}`;
  showScreen('connect-screen');
});
