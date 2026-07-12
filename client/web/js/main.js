// ══════════ 화면 흐름: 로그인 → 메뉴 → (덱 관리 | 로비 | 핫시트) → 게임 ══════════

const SCREENS = ['connect-screen','login-screen','menu-screen','decks-screen','editor-screen','lobby-screen','p2p-screen','setup-screen','game-screen'];
function showScreen(id){
  SCREENS.forEach(s=>{ document.getElementById(s).style.display = s===id ? 'flex' : 'none'; });
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

  const bfPool = shuffle(CARDS.filter(c=>c.type==='Battlefield').map(c=>c.n));
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
  document.getElementById('btn-register').onclick=()=>doAuth(NET.register);
  document.getElementById('login-pw').addEventListener('keydown',e=>{ if(e.key==='Enter') doAuth(NET.login); });
  document.getElementById('btn-change-server').onclick=()=>{
    NET.token=null; localStorage.removeItem('rb_token');
    showScreen('connect-screen');
  };
}

async function enterMenu(){
  DeckStore.local=false; DeckStore.returnTo='menu-screen';
  myDecks = await DeckStore.list();
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
  return `전설: ${l.ko}<br>속성: ${l.dom.map(x=>DOMAIN_KO[x]).join('/')} · 챔피언: ${d.champN?card(d.champN).ko:'-'}`;
}
function renderDeckList(){
  const el=document.getElementById('deck-list');
  el.innerHTML='';
  if(!myDecks.length){
    el.innerHTML='<div class="hint" style="padding:30px;text-align:center;width:100%">아직 덱이 없습니다. [＋ 새 덱]으로 만들어보세요!</div>';
  }
  myDecks.forEach((d,i)=>{
    const div=document.createElement('div'); div.className='deck-card';
    div.innerHTML=`<h3>${esc(d.name)}</h3><div class="dk-info">${deckSummary(d)}</div>`;
    const btns=document.createElement('div'); btns.className='dk-btns';
    const be=document.createElement('button'); be.textContent='편집';
    be.onclick=()=>openEditor(i);
    const bd=document.createElement('button'); bd.textContent='삭제';
    bd.onclick=async ()=>{
      if(!confirm(`「${d.name}」 덱을 삭제할까요?`)) return;
      myDecks=await DeckStore.del(i);
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
// 나만의 덱: 챔피언에 맞는 전설 자동 연결 (태그 짝 → 없으면 속성이 가장 겹치는 전설)
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
  if(c.type==='Battlefield'){
    if(ED.bfs.includes(c.n)){ UI.toast('같은 전장은 1개까지입니다','warn'); return false; }
    if(ED.bfs.length>=3){ UI.toast('전장은 3개까지입니다','warn'); return false; }
    ED.bfs.push(c.n); return true;
  }
  const cnt=ED.main.filter(n=>n===c.n).length;
  if(cnt>=3){ UI.toast('같은 카드는 3장까지입니다','warn'); return false; }
  if(ED.main.length>=40){ UI.toast('메인 덱은 40장입니다','warn'); return false; }
  if(c.n===edChampN()){ UI.toast('선택 챔피언은 자동 배정됩니다 (챔피언 존)','warn'); return false; }
  ED.main.push(c.n); return true;
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
  const doms=legend?legend.dom:null;   // 나만의 덱: 속성 제한 없음
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
    if(ED.main.length<before) UI.toast('선택 챔피언과 같은 카드는 메인 덱에서 제외했습니다','warn');
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
      msg.textContent = edIsCustom() ? '나만의 덱은 선택 챔피언을 골라야 합니다' : '이 전설의 챔피언 유닛을 찾을 수 없습니다';
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
    try{
      myDecks=await DeckStore.save(deck, ED.index);
      renderDeckList(); showScreen('decks-screen');
    }catch(e){ msg.textContent=e.message; }
  };
}

// ---------- 로비 ----------
function renderLobbyDeckSelect(){
  const sel=document.getElementById('lobby-deck');
  sel.innerHTML='';
  myDecks.forEach((d,i)=>{
    const o=document.createElement('option');
    o.value=i; o.textContent=`${d.name} (${card(d.legendN).ko})`;
    sel.appendChild(o);
  });
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
    div.innerHTML=`<h3>${esc(r.name)}</h3><div class="dk-info">방장: ${esc(r.host)} · ${r.count}/2</div>`;
    const btns=document.createElement('div'); btns.className='dk-btns';
    const bj=document.createElement('button'); bj.className='join-btn'; bj.textContent='선택한 덱으로 입장';
    bj.onclick=()=>{
      const deckIdx=+document.getElementById('lobby-deck').value;
      NET.send({t:'joinRoom', roomId:r.id, deckIdx});
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
    const deckIdx=+document.getElementById('lobby-deck').value;
    NET.send({t:'createRoom', deckIdx, name:document.getElementById('lobby-room-name').value.trim()});
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

  // 연결 완료 시 상태 표시 (게임 시작은 start 메시지가 처리)
  P2P.onStatus=(s)=>{ if(s==='connected'){ hostStatus('✅ 연결됨! 게임을 시작합니다...'); guestStatus('✅ 연결됨! 게임을 시작합니다...'); } };

  // ── 호스트 ──
  document.getElementById('btn-p2p-host').onclick=async ()=>{
    const deck=p2pGetDeck();
    if(!deck){ UI.toast('덱을 선택하세요','warn'); return; }
    hostStatus('초대 코드 생성 중... (몇 초 걸릴 수 있음)');
    try{
      const code=await P2P.host(p2pNick(), deck);
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
    const code=document.getElementById('p2p-offer-in').value.trim();
    if(!code){ UI.toast('초대 코드를 붙여넣으세요','warn'); return; }
    guestStatus('응답 코드 생성 중... (몇 초 걸릴 수 있음)');
    try{
      const ans=await P2P.join(p2pNick(), deck, code);
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
    players: m.players.map(pl=>({
      name: pl.id, legendN: pl.deck.legendN, champN: pl.deck.champN,
      deck: pl.deck.main, runes: pl.deck.runes,
    })),
    bfs,
  });
  showScreen('game-screen');
  document.getElementById('net-info').textContent=`🌐 온라인 — 나: ${m.players[NET.seat].id} (${NET.seat===0?'선공':'후공'})`;
  UI.log(`온라인 대전 시작! ${m.players[0].id} vs ${m.players[1].id}`, 'sys');
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
  newGame({
    players:[
      { name:document.getElementById('p0-name').value||'플레이어 1', legendN:p0legend, champN:d0.champN, deck:d0.deck, runes:d0.runes },
      { name:document.getElementById('p1-name').value||'플레이어 2', legendN:p1legend, champN:d1.champN, deck:d1.deck, runes:d1.runes },
    ],
    bfs:[bf0,bf1],
  });
  showScreen('game-screen');
  document.getElementById('net-info').textContent='💺 오프라인 핫시트';
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
        `<img src="${l.img}" alt=""><div class="lp-text">${renderIcons(esc(l.tko||l.text))}</div>`;
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
  showScreen('connect-screen');
});
