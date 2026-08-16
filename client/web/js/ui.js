// ══════════ UI: 렌더링 & 상호작용 ══════════
const UI = {};
// 연출은 fx.js가 채운다. 로드 전이나 로드 실패에도 게임이 멈추지 않도록 빈 구현을 먼저 둔다.
UI.fx = { on:false, unit(){}, cast(){}, chainAdd(){}, turnEnd(){}, priority(){}, score(){}, check(){}, setOn(){} };

// ---------- 로그/토스트 ----------
// 「카드명」 → 카드 매핑 (로그 호버 인스펙트용)
let _name2card=null;
function nameToCard(nm){
  if(!_name2card){ _name2card={}; CARDS.forEach(c=>{ if(!_name2card[c.ko]) _name2card[c.ko]=c; }); }
  return _name2card[nm]||null;
}
// 로그 한 줄을 요소로 만든다 (리플레이 재생 시 여러 줄을 한 번에 재구성하는 데도 사용)
UI.logEntryEl = function(msg, cls){
  const d=document.createElement('div');
  d.className='log-entry log-'+(cls||'sys');
  // 「카드명」 부분은 마우스를 올리면 사이드바 인스펙터에 효과 표시 (textContent로 안전하게 구성)
  String(msg).split(/(「[^」]+」)/).forEach(seg=>{
    const m=seg.match(/^「([^」]+)」$/);
    const c = m && nameToCard(m[1]);
    if(c){
      const span=document.createElement('span');
      span.className='log-card'; span.textContent=seg;
      span.onmouseenter=()=>UI.inspect(c);
      span.onclick=()=>UI.showZoom(c);
      d.appendChild(span);
    } else d.appendChild(document.createTextNode(seg));
  });
  return d;
};
UI.log = function(msg, cls){
  const el=document.getElementById('log');
  el.appendChild(UI.logEntryEl(msg, cls));
  el.scrollTop=el.scrollHeight;
};
UI.toast = function(msg, cls){
  const area=document.getElementById('toast-area');
  const d=document.createElement('div');
  d.className='toast '+(cls||'');
  d.textContent=msg;
  area.appendChild(d);
  setTimeout(()=>d.remove(), 2600);
};
UI.manualNotice = function(c){
  UI.toast(`⚙️ 「${c.ko}」 효과 일부는 자동 처리되지 않습니다`, 'warn');
  UI.log(`⚙️ 자동 처리 안 됨: ${c.ko} — ${c.tko||c.text}`, 'sys');
};

// ---------- 프롬프트 ----------
UI.prompt = function(text){
  document.getElementById('prompt-area').innerHTML =
    text?`<div class="prompt-title">${esc(text)}</div>`:'';
};
UI.promptShowdown = function(){
  const sd=G.showdown; if(!sd) return;
  const bf=G.bfs[sd.bfIdx];
  // 체인 표시: 왼쪽이 먼저 쌓인 것, 오른쪽(마지막)이 먼저 해결됨
  const chainHtml = (sd.chain&&sd.chain.length)
    ? `<br>🔗 체인: ${sd.chain.map(it=>{
        const nm = it.kind==='ability' ? '능력:'+it.srcName : card(it.n).ko;
        return `<span style="color:${it.p===0?'#9fc8ff':'#ffc89f'}">${esc(nm)}${it.countered?'(무효)':''}</span>`;
      }).join(' ← ')} <small>(마지막 것부터 해결)</small>`
    : '';
  document.getElementById('showdown-banner').style.display='';
  document.getElementById('showdown-banner').innerHTML =
    `⚔️ 결전: ${esc(card(bf.n).ko)}<br>공격 ${esc(pname(sd.attacker))} → 방어 ${esc(pname(sd.defender))}${chainHtml}`;
  UI.prompt(sd.chain&&sd.chain.length
    ? `${pname(G.actingPlayer)}: [반응]으로 응수하거나 패스 (양측 패스 시 체인 해결)`
    : `${pname(G.actingPlayer)}: [행동]/[반응] 카드·능력을 사용하거나 패스하세요`);
  document.getElementById('btn-pass').style.display='';
  document.getElementById('btn-endturn').style.display='none';
};

// ---------- 선택 프리미티브 (Promise 기반) ----------
let _resolver = null;
function settle(v){ if(_resolver){ const r=_resolver; _resolver=null; clearPicking(); r(v); } }
function clearPicking(){
  document.querySelectorAll('.targetable').forEach(e=>e.classList.remove('targetable'));
  const pa=document.getElementById('prompt-area');
  pa.innerHTML = G && G.state==='showdown'
    ? `<div class="prompt-title">${esc(pname(G.actingPlayer))}: [행동]/[반응] 사용 또는 패스</div>`
    : (G && G.winner===null ? `<div class="prompt-title">${esc(pname(G.turn))}의 행동 단계</div>` : '');
}

// ── 온라인 라우팅 래퍼 ──
// 내 좌석이면 인터랙티브, 상대 좌석이면 대기. 결과는 서버 에코로 양측 동시 해결.
function routedPick(p, interactiveFn, serialize, deserialize){
  if(!NET.online) return interactiveFn();
  return NET.choice(p, interactiveFn, serialize, deserialize);
}

// 유닛 선택 (보드에서 클릭)
UI.pickUnitFrom = function(p, candidates, promptText, optional){
  if(!candidates.length) return Promise.resolve(null);
  return routedPick(p,
    ()=>_pickUnitLocal(p,candidates,promptText,optional),
    v=>v?{uid:v.uid}:null,
    d=>d?(candidates.find(u=>u.uid===d.uid)||everyUnit().find(u=>u.uid===d.uid)||null):null);
};
function _pickUnitLocal(p, candidates, promptText, optional){
  return new Promise(res=>{
    if(!candidates.length){ res(null); return; }
    _resolver=res;
    hideMenu();                                        // 대상 선택 중에는 선택 메뉴가 보드를 가리지 않게
    _pickableUids = new Set(candidates.map(u=>u.uid));
    UI.render();
    const pa=document.getElementById('prompt-area');
    pa.innerHTML=`<div class="prompt-title">👉 ${esc(promptText||'대상 선택')}</div>`;
    const btns=document.createElement('div'); btns.className='prompt-btns';
    if(optional){
      const skip=document.createElement('button'); skip.textContent='선택 안 함';
      skip.onclick=()=>{ _pickableUids=null; settle(null); UI.render(); };
      btns.appendChild(skip);
    }
    pa.appendChild(btns);
  });
};
let _pickableUids = null;
UI.isPicking = ()=>!!_resolver; // 봇 등 외부에서 선택 대기 여부 확인용

// 옵션 선택 (인덱스 기반 동기화)
UI.pickOption = function(p, title, options){
  return routedPick(p,
    ()=>_pickOptionLocal(p,title,options),
    v=>v, v=>v
  ).then(idx=>idx===null?null:options[idx].v);
};
// 눈에 잘 띄도록 중앙 모달로 표시한다 (배치 위치 선택 등을 사용자가 놓치지 않게)
function _pickOptionLocal(p, title, options, cancelLabel){
  return new Promise(res=>{
    const box=document.getElementById('modal-box');
    box.innerHTML=`<h3>👉 ${esc(pname(p))}: ${esc(title)}</h3>`;
    const btns=document.createElement('div'); btns.className='modal-btns';
    options.forEach((o,i)=>{
      const b=document.createElement('button'); b.className='primary'; b.textContent=o.label;
      b.onclick=()=>{ closeModal(); res(i); };
      attachCardHover(b, optionCard(o));   // 카드가 걸린 선택지는 올려 보면 효과가 뜬다
      btns.appendChild(b);
    });
    const cancel=document.createElement('button'); cancel.textContent=cancelLabel||'취소';
    cancel.style.opacity=.6;
    cancel.onclick=()=>{ closeModal(); res(null); };
    btns.appendChild(cancel);
    box.appendChild(btns);
    openModal();
  });
}

// 중립 응수 창 전용 선택 (pickOption과 동일 계약 — 봇이 별도 정책을 적용할 수 있게 이름 분리)
UI.pickReaction = function(p, title, options){
  return routedPick(p,
    ()=>_pickOptionLocal(p,title,options,'응수 안 함'),
    v=>v, v=>v
  ).then(idx=>idx===null?null:options[idx].v);
};

// 확인 (예/아니오)
UI.confirmP = function(p, text, previewCard){
  return routedPick(p, ()=>_confirmLocal(p,text,previewCard), v=>v, v=>v);
};
function _confirmLocal(p, text, previewCard){
  return new Promise(res=>{
    const box=document.getElementById('modal-box');
    box.innerHTML=`<h3>👉 ${esc(pname(p))}</h3>
      <div style="font-size:15px;line-height:1.65;max-width:420px;margin-bottom:8px">${esc(text)}</div>`;
    if(previewCard){
      UI.inspect(previewCard);
      const wrap=document.createElement('div'); wrap.className='modal-cards';
      wrap.appendChild(cardMiniEl(previewCard));
      box.appendChild(wrap);
    }
    const btns=document.createElement('div'); btns.className='modal-btns';
    const y=document.createElement('button'); y.className='primary'; y.textContent='예';
    y.onclick=()=>{ closeModal(); res(true); };
    const n=document.createElement('button'); n.textContent='아니오';
    n.onclick=()=>{ closeModal(); res(false); };
    btns.appendChild(y); btns.appendChild(n);
    box.appendChild(btns);
    openModal();
  });
}

// 숫자 선택
UI.pickNumber = function(p, text, min, max){
  return routedPick(p, ()=>_pickNumberLocal(p,text,min,max), v=>v, v=>v);
};
function _pickNumberLocal(p, text, min, max){
  return new Promise(res=>{
    const box=document.getElementById('modal-box');
    box.innerHTML=`<h3>👉 ${esc(pname(p))}: ${esc(text)}</h3>`;
    const btns=document.createElement('div'); btns.className='modal-btns';
    for(let i=min;i<=max;i++){
      const b=document.createElement('button'); b.className='primary'; b.textContent=i;
      b.onclick=()=>{ closeModal(); res(i); };
      btns.appendChild(b);
    }
    box.appendChild(btns);
    openModal();
  });
}

// ══════════ 손패 공개 규칙 ══════════
// 예전엔 "오프라인이면 전부 앞면"이었다. 로컬 핫시트(한 화면에서 두 사람이 번갈아 두기)를
// 염두에 둔 규칙인데, BOT 대전에도 그대로 걸려서 봇의 손패가 사람에게 다 보였다.
//  · 리플레이 관전 : 두 선수 손패 모두 공개 (기록을 되짚어 보는 용도)
//  · 온라인        : 내 손패만
//  · BOT 대전      : 봇 손패는 가림. '손패 확인' 토글을 켤 때만 공개(보기 전용)
//  · 로컬 핫시트·수동: 둘 다 공개 (그래야 두 사람이 번갈아 조작할 수 있다)
UI.peekBotHand = false;
function botHandHidable(p){
  return typeof BOT !== 'undefined' && BOT.active && !NET.online && !replayLock() && p === BOT.seat;
}
function handFaceUp(p){
  if(replayLock()) return true;
  if(NET.online) return p === NET.seat;
  if(botHandHidable(p)) return !!UI.peekBotHand;
  return true;
}

// 손패 카드 선택 (모달 — 선택자 화면에만 표시)
UI.pickHandCard = function(p, title){
  if(!G.players[p].hand.length) return Promise.resolve(null);
  return routedPick(p, ()=>_pickHandLocal(p,title), v=>v, v=>v);
};
function _pickHandLocal(p, title){
  return new Promise(res=>{
    const P=G.players[p];
    if(!P.hand.length){ res(null); return; }
    const box=document.getElementById('modal-box');
    box.innerHTML=`<h3>${esc(pname(p))}: ${esc(title)}</h3>`;
    const wrap=document.createElement('div'); wrap.className='modal-cards';
    P.hand.forEach((n,i)=>{
      const el=cardMiniEl(card(n));
      el.onclick=()=>{ closeModal(); res(i); };
      attachCardHover(el, card(n));   // 모달 안에서는 인스펙터가 오버레이에 가려 안 보인다
      wrap.appendChild(el);
    });
    box.appendChild(wrap);
    openModal();
  });
}

function openModal(){
  const ov=document.getElementById('modal-overlay');
  ov.style.display='flex'; delete ov.dataset.dismiss;   // 기본: 닫기 불가(선택 대기 모달 보호)
  document.body.classList.add('modal-open');
  hideMenu();                                          // 열려 있던 선택 메뉴가 모달 위에 남지 않게
}
function closeModal(){ UI.hideHover(); document.getElementById('modal-overlay').style.display='none'; document.body.classList.remove('modal-open'); }
// 정보성 모달(도움말/밴 리스트/대회 덱 등): 모바일 뒤로 가기로 닫아도 안전함을 표시
function markModalDismissable(){ document.getElementById('modal-overlay').dataset.dismiss='1'; }

// 멀리건: 교체할 카드 다중 선택 (게임 시작 시)
UI.pickMulligan = function(p){
  return routedPick(p, ()=>_pickMulliganLocal(p), v=>v, v=>v);
};
function _pickMulliganLocal(p){
  return new Promise(res=>{
    const P=G.players[p];
    const box=document.getElementById('modal-box');
    box.innerHTML=`<h3>🔄 ${esc(pname(p))}: 멀리건</h3>
      <div style="font-size:13px;color:#9aa4bd;margin-bottom:10px">
      교체할 카드를 <b>최대 2장</b> 선택하세요. 그 수만큼 새로 뽑은 뒤, 선택한 카드는 덱 맨 아래로 갑니다. (1회)</div>`;
    const wrap=document.createElement('div'); wrap.className='modal-cards';
    const sel=new Set();
    P.hand.forEach((n,i)=>{
      const el=cardMiniEl(card(n));
      el.onclick=()=>{
        if(sel.has(i)){ sel.delete(i); el.classList.remove('selected'); }
        else if(sel.size<2){ sel.add(i); el.classList.add('selected'); }
        else UI.toast('최대 2장까지 선택할 수 있습니다','warn');
      };
      attachCardHover(el, card(n));   // 멀리건도 모달 — 무엇을 바꿀지 보고 정할 수 있어야 한다
      wrap.appendChild(el);
    });
    box.appendChild(wrap);
    const btns=document.createElement('div'); btns.className='modal-btns';
    const ok=document.createElement('button'); ok.className='primary'; ok.textContent='선택한 카드 교체';
    ok.onclick=()=>{ closeModal(); res([...sel]); };
    const keep=document.createElement('button'); keep.textContent='그대로 시작';
    keep.onclick=()=>{ closeModal(); res([]); };
    btns.appendChild(ok); btns.appendChild(keep);
    box.appendChild(btns);
    openModal();
  });
}

// ---------- 카드 이미지 URL ----------
// Riot CDN(Sanity 이미지 파이프라인)은 쿼리 파라미터로 webp 변환·리사이즈를 지원한다.
// 원본 PNG(~780KB)를 표시 크기에 맞는 webp(~20KB)로 받아 로딩 속도와 축소 화질을 개선.
// 앱에 함께 배포된 로컬 이미지가 있으면 그것을 쓰고(오프라인·즉시 로딩), 없으면 CDN에서 받는다.
// 로컬 파일은 tools/fetch-card-images.js 가 받아 web/js/imgmap.js에 목록을 남긴다.
function imgKey(url){
  const m = String(url).match(/\/([0-9a-f]{20,}-\d+x\d+)\.(?:png|jpe?g|webp)/i);
  return m ? m[1] : null;
}
// w를 생략하거나 480 이상이면 확대용(원본 해상도) 파일을, 그 외에는 보드용 작은 파일을 쓴다.
function cardImgUrl(url, w){
  if(!url) return url;
  if(typeof IMG_LOCAL!=='undefined'){
    const k = imgKey(url);
    if(k){
      const wantFull = (w===undefined || w===null || w>=480);
      if(wantFull && IMG_LOCAL.full && IMG_LOCAL.full[k]) return IMG_LOCAL.dir + k + '.full.webp';
      if(IMG_LOCAL.files && IMG_LOCAL.files[k]) return IMG_LOCAL.dir + k + '.webp';
      if(IMG_LOCAL.full && IMG_LOCAL.full[k]) return IMG_LOCAL.dir + k + '.full.webp';
    }
  }
  // 로컬에 없을 때만 CDN (정상 배포본에서는 여기까지 오지 않는다)
  if(!/rgpub\.io\/sanity\/images\//.test(url)) return url;
  return url + (url.includes('?')?'&':'?') + 'fm=webp&q=80' + (w?'&w='+w:'');
}

// ---------- 카드 미니 요소 ----------
function cardMiniEl(c, opts={}){
  const el=document.createElement('div');
  el.className='card-mini';
  if(c.img) el.style.backgroundImage=`url("${cardImgUrl(c.img,280)}")`;
  const name=document.createElement('div'); name.className='cm-name'; name.textContent=c.ko;
  el.appendChild(name);
  if(c.e!==null && c.e!==undefined && c.type!=='Rune' && c.type!=='Battlefield'){
    const cost=document.createElement('div'); cost.className='cm-cost'; cost.textContent=c.e;
    el.appendChild(cost);
  }
  el.onmouseenter=()=>UI.inspect(c);
  el._card = c;               // 확대(줌)용 카드 데이터
  attachZoom(el);
  return el;
}

// 유닛 요소
function unitEl(u){
  const c=unitCard(u);
  const el=document.createElement('div');
  el.className='card-mini';
  el.dataset.uid=u.uid;
  if(u.ex) el.classList.add('exhausted');
  if(u.stunned) el.classList.add('stunned');
  if(_pickableUids && _pickableUids.has(u.uid)) el.classList.add('targetable');
  if(_moveSel.has(u.uid)) el.classList.add('selected');
  if(u.isToken){
    el.style.background='linear-gradient(135deg,#2a3a2a,#1a2a1a)';
  } else if(c.img) el.style.backgroundImage=`url("${cardImgUrl(c.img,280)}")`;
  const name=document.createElement('div'); name.className='cm-name'; name.textContent=unitName(u);
  el.appendChild(name);
  const m=document.createElement('div');
  const baseM=(u.isToken?u.tokenMight:(c.m||0));
  const curM=might(u, combatRoleOf(u));
  m.className='cm-might'+(curM>baseM?' buffed':curM<baseM?' weakened':'');
  m.textContent=curM+'⚔';
  el.appendChild(m);
  if(u.dmg>0){ const d=document.createElement('div'); d.className='cm-dmg'; d.textContent='-'+u.dmg; el.appendChild(d); }
  if(u.buff>0){ const b=document.createElement('div'); b.className='cm-buff'; b.textContent='+'+u.buff; el.appendChild(b); }
  el.onmouseenter=()=>UI.inspectUnit(u);
  el.onclick=(e)=>onUnitClick(u,e);
  el.oncontextmenu=(e)=>{ e.preventDefault(); showUnitMenu(u,e); };
  el._card = u.isToken
    ? { n:0, ko:unitName(u), name:'Token', type:'Unit', super:'Token', dom:[], tags:[], text:'', tko:'토큰은 죽으면 소멸합니다.', m:might(u), e:null, p:null, img:null }
    : card(u.n);
  attachZoom(el);
  // 드래그 앤 드롭 이동 (준비된 아군 유닛, 내 턴 중립 상태에서만)
  const canDrag = G.winner===null && G.state==='neutral' && G.phase==='action' && !u.ex && !u.stunned
    && u.ctrl===G.turn && !_pickableUids && (!NET.online || NET.seat===G.turn);
  if(canDrag){
    el.draggable=true;
    el.ondragstart=(ev)=>{
      clearTimeout(_lpTimer);            // 롱프레스 확대와 충돌 방지
      hideMenu();
      _dragUid=u.uid;
      try{ ev.dataTransfer.setData('text/plain', String(u.uid)); ev.dataTransfer.effectAllowed='move'; }catch(e){}
    };
    el.ondragend=()=>{ _dragUid=null; clearDropHints(); };
  }
  return el;
}

// ---------- 드래그 앤 드롭 이동 ----------
let _dragUid=null;
function clearDropHints(){ document.querySelectorAll('.drop-hint').forEach(e=>e.classList.remove('drop-hint')); }
function attachDropZone(el, dest){
  el.ondragover=(ev)=>{ if(_dragUid!=null){ ev.preventDefault(); ev.dataTransfer.dropEffect='move'; el.classList.add('drop-hint'); } };
  el.ondragleave=()=>el.classList.remove('drop-hint');
  el.ondrop=(ev)=>{
    ev.preventDefault(); el.classList.remove('drop-hint');
    const uid=_dragUid ?? Number(ev.dataTransfer.getData('text/plain'));
    _dragUid=null; clearDropHints();
    if(uid==null||isNaN(uid)) return;
    dropMove(uid, dest);
  };
}
function dropMove(uid, dest){
  const u=everyUnit().find(x=>x.uid===uid);
  if(!u) return;
  const p=u.ctrl;
  if(NET.online && p!==NET.seat) return;
  if(G.state!=='neutral' || G.turn!==p){ UI.toast('지금은 이동할 수 없습니다','warn'); return; }
  // 드래그한 유닛이 다중 선택에 포함돼 있으면 선택된 유닛 전부 함께 이동
  let units=[u];
  if(_moveSel.size && _moveSel.has(uid)){
    units=everyUnit().filter(x=>_moveSel.has(x.uid));
  }
  const uids=units.map(x=>x.uid);
  _moveArmed=false; _moveSel.clear(); updateButtons();
  NET.dispatch({k:'move',p,uids,dest}, ()=>moveUnits(p,units,dest).then(()=>UI.render()));
}
function combatRoleOf(u){
  if(!G.showdown || u.loc!==G.showdown.bfIdx) return null;
  return u.ctrl===G.showdown.attacker?'attacker':'defender';
}

// ---------- 인스펙터 ----------
// 카드 상세 HTML (사이드바 인스펙터·덱 편집기 상세 영역 공용)
UI.cardInfoHTML = function(c){
  const kwNote = ((c.text||'').match(/\[([A-Za-z-]+ ?\d*)\]/g)||[])
    .map(k=>k.replace(/[\[\]]/g,'').replace(/ \d+$/,''))
    .filter((v,i,a)=>a.indexOf(v)===i)
    .map(k=>KEYWORDS_KO[k]?`<div style="font-size:11px;color:#9aa4bd">· <b>[${KEYWORDS_KO[k].ko}]</b> ${KEYWORDS_KO[k].desc}</div>`:'')
    .join('');
  return `
    ${c.img?`<img src="${cardImgUrl(c.img,280)}" alt="">`:''}
    <div class="insp-name">${esc(c.ko)}</div>
    <div class="insp-name-en">${esc(c.name)} · #${c.n}</div>
    ${isBanned(c.n)?`<div class="ban-flag" style="font-size:12px">🚫 밴 카드 (${esc(BANLIST.region)})</div>`:''}
    <div class="insp-type">${esc(typeLine(c))}${c.m!==null&&c.m!==undefined?` · 위력 ${c.m}`:''}${c.e!==null&&c.e!==undefined?` · 비용 ${c.e}${c.p?'+힘'+c.p:''}`:''}</div>
    <div class="insp-text">${renderIcons(esc(c.tko||c.text||'(효과 없음)'))}</div>
    ${kwNote}
    ${c.tags&&c.tags.length?`<div class="insp-tags">태그: ${c.tags.map(esc).join(', ')}</div>`:''}
  `;
};
UI.inspect = function(c){
  document.getElementById('inspector').innerHTML = UI.cardInfoHTML(c);
};
UI.inspectUnit = function(u){
  if(u.isToken){
    document.getElementById('inspector').innerHTML=`
      <div class="insp-name">${esc(unitName(u))}</div>
      <div class="insp-type">토큰 유닛 · 위력 ${might(u)}</div>
      <div class="insp-text">토큰은 죽으면 소멸합니다.</div>`;
    return;
  }
  UI.inspect(card(u.n));
};

// ---------- 선택지 카드 미리보기 (마우스 오버) ----------
// 선택 모달은 오버레이(z-index 100) 위에 뜨는데, 사이드 인스펙터는 그 아래에 깔린다.
// 그래서 [반응] 응수나 「정신을 가르는 자」처럼 카드를 고르는 순간에는 정작 그 카드가
// 무슨 효과인지 볼 수가 없었다 — 모달 위에 뜨는 별도 패널을 쓴다.
// (터치 기기는 hover가 없으므로 attachZoom의 롱프레스가 같은 역할을 한다)
UI.showHover = function(c, x, y){
  if(!c) return;
  let el = document.getElementById('card-hover');
  if(!el){ el = document.createElement('div'); el.id = 'card-hover'; document.body.appendChild(el); }
  if(el._for !== c){ el.innerHTML = UI.cardInfoHTML(c); el._for = c; }
  el.style.display = 'block';
  const pos = hoverPlace(x, y, el.offsetWidth || 240, el.offsetHeight || 480,
                         window.innerWidth, window.innerHeight);
  el.style.left = pos.left + 'px';
  el.style.top  = pos.top  + 'px';
};
// 커서 옆에 띄우되 화면 밖으로 나가면 접는다. 순수 함수로 빼 둔 이유는
// 브라우저 창 크기를 실제로 못 재는 환경에서도 이 규칙만 따로 검증할 수 있게 하기 위해서다.
function hoverPlace(x, y, w, h, vw, vh){
  const pad = 16, m = 6;
  let left = x + pad, top = y + pad;
  if(!vw || !vh) return { left, top };          // 창 크기를 모르면 그냥 커서 옆
  if(left + w > vw - m) left = x - pad - w;     // 오른쪽이 좁으면 커서 왼쪽으로
  if(left < m) left = Math.max(m, vw - w - m);  // 왼쪽도 좁으면 화면 안쪽으로 밀어 넣는다
  if(top + h > vh - m) top = vh - h - m;
  if(top < m) top = m;
  return { left, top };
}
UI.hideHover = function(){
  const el = document.getElementById('card-hover');
  if(el){ el.style.display = 'none'; el._for = null; }
};
// 텍스트 버튼·카드 미니 등 어떤 요소에든 '이 선택지는 이 카드다'를 붙인다.
// 인스펙터도 함께 갱신해 두면 모달을 닫은 뒤에도 마지막으로 본 카드가 남아 있다.
function attachCardHover(el, c){
  if(!el || !c) return el;
  el._card = c;                     // attachZoom이 이 필드를 본다
  el.classList.add('has-card');
  el.addEventListener('mouseenter', e=>{ UI.inspect(c); UI.showHover(c, e.clientX, e.clientY); });
  el.addEventListener('mousemove',  e=>UI.showHover(c, e.clientX, e.clientY));
  el.addEventListener('mouseleave', UI.hideHover);
  attachZoom(el);                   // 롱프레스·Alt+클릭·우클릭 → 전체 확대 (터치 대응)
  return el;
}
// 선택지 객체에서 카드 꺼내기 — 만드는 쪽은 card(카드객체) 또는 n(카드번호) 중 편한 걸 실으면 된다
function optionCard(o){
  if(!o) return null;
  if(o.card) return o.card;
  if(o.n !== undefined && o.n !== null){ try { return card(o.n) || null; } catch(e){ return null; } }
  return null;
}

// ---------- 카드 확대 (롱프레스 / Alt+클릭) ----------
UI.showZoom = function(c){
  if(!c) return;
  hideMenu(); // 열려 있던 컨텍스트 메뉴는 닫는다
  let ov = document.getElementById('card-zoom');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'card-zoom';
    ov.onclick = UI.hideZoom;
    document.body.appendChild(ov);
  }
  const kwNote = ((c.text||'').match(/\[([A-Za-z-]+ ?\d*)\]/g)||[])
    .map(k=>k.replace(/[\[\]]/g,'').replace(/ \d+$/,''))
    .filter((v,i,a)=>a.indexOf(v)===i)
    .map(k=>KEYWORDS_KO[k]?`<div class="cz-kw">· <b>[${KEYWORDS_KO[k].ko}]</b> ${KEYWORDS_KO[k].desc}</div>`:'')
    .join('');
  const statBits = [];
  if(c.m!==null && c.m!==undefined) statBits.push(`위력 ${c.m}`);
  if(c.e!==null && c.e!==undefined) statBits.push(`비용 ${c.e}${c.p?'+힘'+c.p:''}`);
  ov.innerHTML = `
    <div class="cz-box">
      ${c.img?`<img class="cz-img" src="${cardImgUrl(c.img)}" alt="">`:'<div class="cz-noimg">🃏</div>'}
      <div class="cz-info">
        <div class="cz-name">${esc(c.ko||'')}</div>
        <div class="cz-en">${esc(c.name||'')}${c.n?` · #${c.n}`:''}</div>
        ${c.n&&isBanned(c.n)?`<div class="ban-flag" style="font-size:14px;margin-bottom:6px">🚫 밴 카드 (${esc(BANLIST.region)})</div>`:''}
        <div class="cz-type">${esc(typeLine(c))}${statBits.length?' · '+statBits.join(' · '):''}</div>
        <div class="cz-text">${renderIcons(esc(c.tko||c.text||'(효과 없음)'))}</div>
        ${kwNote}
        ${c.tags&&c.tags.length?`<div class="cz-tags">태그: ${c.tags.map(esc).join(', ')}</div>`:''}
        <div class="cz-hint">바깥을 클릭하거나 Esc로 닫기</div>
      </div>
    </div>`;
  ov.querySelector('.cz-box').addEventListener('click', e=>e.stopPropagation()); // CSP가 인라인 onclick 차단 → 리스너로 연결
  ov.style.display = 'flex';
};
UI.hideZoom = function(){
  const ov = document.getElementById('card-zoom');
  if(ov) ov.style.display = 'none';
};

// 카드 요소에 롱프레스/Alt+클릭 확대를 연결
let _lpTimer = null, _suppressClick = false;
function attachZoom(el){
  const start = (e)=>{
    // Alt+클릭(또는 우클릭 아님) 즉시 확대는 아래 click 핸들러에서 처리. 여기선 롱프레스만.
    if(e.button!==undefined && e.button!==0) return; // 좌클릭/터치만
    clearTimeout(_lpTimer);
    _lpTimer = setTimeout(()=>{
      _suppressClick = true;         // 롱프레스로 확대되면 뒤따르는 클릭(플레이 등) 무시
      UI.showZoom(el._card);
    }, 450);
  };
  const cancel = ()=>{ clearTimeout(_lpTimer); };
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mouseleave', cancel);
  el.addEventListener('mousemove', cancel);
  // 터치 롱프레스
  el.addEventListener('touchstart', start, {passive:true});
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchmove', cancel);
  // Alt+클릭 즉시 확대
  el.addEventListener('click', (e)=>{
    if(e.altKey){ e.preventDefault(); e.stopImmediatePropagation(); UI.showZoom(el._card); }
  }, true);
  // 우클릭 즉시 확대 (유닛처럼 자체 우클릭 메뉴가 있는 요소는 그쪽 우선)
  el.addEventListener('contextmenu', (e)=>{
    if(el.oncontextmenu) return;
    e.preventDefault(); e.stopPropagation();
    clearTimeout(_lpTimer);
    UI.showZoom(el._card);
  });
}

// 롱프레스 직후의 클릭을 한 번 무시 (플레이/선택 오동작 방지)
document.addEventListener('click', (e)=>{
  if(_suppressClick){ _suppressClick=false; e.stopImmediatePropagation(); e.preventDefault(); }
}, true);
// Esc: 확대/메뉴/정보 팝업 닫기 → 아무것도 없으면 게임 화면에서 시스템 메뉴(재대결·나가기)
document.addEventListener('keydown', (e)=>{
  if(e.key!=='Escape') return;
  const zoom=document.getElementById('card-zoom');
  if(zoom && zoom.style.display==='flex'){ UI.hideZoom(); return; }
  const menu=document.getElementById('ctx-menu');
  if(menu && menu.style.display==='block'){ hideMenu(); return; }
  const ov=document.getElementById('modal-overlay');
  if(ov.style.display!=='none'){
    if(ov.dataset.dismiss) closeModal();   // 선택 대기 모달은 보호 (버튼으로만 완료)
    return;
  }
  if(replayLock()){ REPLAY.close(); return; }   // 관전 중 Esc = 관전 종료
  const gs=document.getElementById('game-screen');
  if(gs && gs.offsetParent!==null && typeof G!=='undefined' && G && typeof openSystemMenu==='function')
    openSystemMenu();
});

// ---------- 유닛 클릭 ----------
let _moveSel = new Set();
let _moveArmed = false;
function onUnitClick(u, e){
  if(replayLock()) return;          // 리플레이 관전 중에는 조작 불가
  if(e.altKey) return;              // Alt+클릭은 카드 확대 전용
  // 대상 선택 모드
  if(_pickableUids){
    if(_pickableUids.has(u.uid)){
      const unit=u;
      _pickableUids=null;
      settle(unit);
      UI.render();
    }
    return;
  }
  // 이동 모드: 아군 준비 유닛 다중 선택
  if(_moveArmed && u.ctrl===G.actingPlayer && !u.ex){
    if(_moveSel.has(u.uid)) _moveSel.delete(u.uid);
    else _moveSel.add(u.uid);
    UI.render();
    return;
  }
  // 기본: 능력 발동 메뉴
  showUnitMenu(u, e);
}

// ---------- 컨텍스트 메뉴 ----------
function showUnitMenu(u, e){
  if(replayLock()) return;
  if(e && e.stopPropagation) e.stopPropagation(); // 여는 클릭이 닫기 리스너로 버블링 방지
  const menu=document.getElementById('ctx-menu');
  menu.innerHTML='';
  const title=document.createElement('div'); title.className='ctx-title'; title.textContent=unitName(u);
  menu.appendChild(title);
  const fx=unitFx(u);
  // 발동형 능력
  const botUnit = typeof botIs==='function' && botIs(u.ctrl);
  (fx.activated||[]).forEach((ab,abIdx)=>{
    if(u.ctrl!==G.actingPlayer && !(ab.reaction||ab.action)) return;
    if(NET.online && u.ctrl!==NET.seat) return;
    if(botUnit) return;      // 유닛 자체는 공개 정보라 정보는 보여 주고, 발동만 막는다
    const item=document.createElement('div'); item.className='ctx-item';
    item.textContent='⚡ '+ab.label;
    item.onclick=()=>{ hideMenu();
      NET.dispatch({k:'ability',p:u.ctrl,src:{kind:'unit',uid:u.uid},abIdx},
        ()=>activateAbility(u.ctrl,{kind:'unit',u},ab)); };
    menu.appendChild(item);
  });
  // 하이머딩거: 모든 아군 전설/유닛/도구의 탈진 능력 사용 가능
  if(fx.copyAllExhaust && (!NET.online || u.ctrl===NET.seat)){
    const seen=new Set();
    const addCopied=(srcFx, srcName)=>{
      (srcFx.activated||[]).forEach(ab=>{
        if(!ab.cost || !ab.cost.exhaustSelf) return;
        const key=srcName+':'+ab.label; if(seen.has(key)) return; seen.add(key);
        const item=document.createElement('div'); item.className='ctx-item';
        item.textContent='🔧 '+srcName+': '+ab.label;
        item.onclick=()=>{ hideMenu();
          NET.dispatch({k:'ability',p:u.ctrl,src:{kind:'unit',uid:u.uid},copy:{srcName,label:ab.label}},
            ()=>activateAbility(u.ctrl,{kind:'unit',u},ab)); };
        menu.appendChild(item);
      });
    };
    const P=G.players[u.ctrl];
    addCopied(FX[P.legendN]||{}, card(P.legendN).ko);
    everyUnit().filter(x=>x.ctrl===u.ctrl&&x!==u&&!x.isToken).forEach(x=>addCopied(unitFx(x), unitName(x)));
    P.gear.forEach(g=>addCopied(FX[g.n]||{}, card(g.n).ko));
  }
  if(fx.manual&&fx.manual.length){
    const mi=document.createElement('div'); mi.className='ctx-item'; mi.textContent='📖 효과 텍스트 보기';
    mi.onclick=()=>{ hideMenu(); UI.inspectUnit(u); };
    menu.appendChild(mi);
  }
  if(!menu.querySelector('.ctx-item')){
    const none=document.createElement('div'); none.className='ctx-title'; none.textContent='(사용할 수 있는 능력 없음)';
    menu.appendChild(none);
  }
  openMenuAt(menu, e);
}
function hideMenu(){ document.getElementById('ctx-menu').style.display='none'; }
// 선택 메뉴 표시 — 모달과 같은 정책: 바깥을 클릭해도 닫히지 않는다(선택을 잃지 않게).
// 닫는 방법은 [✖ 닫기] · Esc · 모바일 뒤로 가기, 또는 다른 카드를 눌러 메뉴를 바꾸는 것.
function openMenuAt(menu, e){
  const close=document.createElement('div');
  close.className='ctx-item ctx-close'; close.textContent='✖ 닫기';
  close.onclick=hideMenu;
  menu.appendChild(close);
  menu.style.display='block';
  const x=(e&&e.clientX)||0, y=(e&&e.clientY)||0;
  menu.style.left=Math.max(4, Math.min(x, innerWidth-menu.offsetWidth-6))+'px';
  menu.style.top =Math.max(4, Math.min(y, innerHeight-menu.offsetHeight-6))+'px';
}

// ---------- 손패 클릭 ----------
// 온라인: 내 좌석의 행동만 개시 가능
// 이 좌석을 지금 사람이 조작해도 되는가.
// 오프라인은 로컬 핫시트(2인이 번갈아 두기) 때문에 좌석을 가리지 않는다.
// 다만 BOT 대전의 봇 좌석은 예외 — 봇이 스스로 두는 자리를 사람이 대신 조작하면
// 규칙 밖의 수가 되고, 봇의 비공개 정보([숨겨짐] 카드, 비용으로 버리는 손패)까지 드러난다.
function canInitiate(p){
  if(typeof botIs==='function' && botIs(p)){ UI.toast('봇의 카드는 조작할 수 없습니다','warn'); return false; }
  if(!NET.online) return true;
  if(p!==NET.seat){ UI.toast('상대 카드는 조작할 수 없습니다','warn'); return false; }
  return true;
}

function onHandClick(p, idx, e){
  if(replayLock()) return;
  if(G.winner!==null) return;
  if(e.altKey) return;              // Alt+클릭은 카드 확대 전용
  e.stopPropagation();              // 메뉴를 연 클릭이 document 닫기 리스너로 버블링되는 것 방지
  if(_resolver){ UI.toast('진행 중인 선택을 먼저 완료하세요','warn'); return; }
  if(NET.online && p!==NET.seat) return; // 상대 손패는 비공개
  const n=G.players[p].hand[idx];
  const c=card(n);
  const fx=FX[n]||{kw:{}};
  const menu=document.getElementById('ctx-menu');
  menu.innerHTML='';
  const title=document.createElement('div'); title.className='ctx-title'; title.textContent=c.ko;
  menu.appendChild(title);
  const play=document.createElement('div'); play.className='ctx-item';
  play.textContent=`▶ 플레이 (비용 ${c.e??0}${c.p?'+힘'+c.p:''})`;
  play.onclick=()=>{
    hideMenu();
    NET.dispatch({k:'play',p,handIdx:idx,opts:{}},
      ()=>playCardFromHand(p,idx));   // 결전 중 우선권 전환은 playCardFromHand 안에서 처리
  };
  menu.appendChild(play);
  if(fx.kw.hidden){
    const hide=document.createElement('div'); hide.className='ctx-item';
    hide.textContent='🕶 숨기기 (힘 1)';
    hide.onclick=()=>{ hideMenu(); NET.dispatch({k:'hide',p,handIdx:idx}, ()=>hideCard(p,idx)); };
    menu.appendChild(hide);
  }
  const sep=document.createElement('div'); sep.className='ctx-sep'; menu.appendChild(sep);
  const disc=document.createElement('div'); disc.className='ctx-item'; disc.textContent='🗑 버리기(수동)';
  disc.onclick=()=>{ hideMenu(); NET.dispatch({k:'manual',tool:'discardIdx',args:[p,idx]}, ()=>{ discardFromHand(p,idx); UI.render(); }); };
  menu.appendChild(disc);
  openMenuAt(menu, e);
}

// ---------- 렌더링 ----------
// 페이즈 시작 배너 (표시 전용 — 게임 상태에 영향 없음)
let _phaseKey=null;
const PHASE_FX={
  awaken:   ['🌅','각성 단계'],
  beginning:['☀️','개시 단계'],
  channel:  ['🔋','전개 단계'],
  draw:     ['🃏','드로우 단계'],
  action:   ['⚔️','행동 단계'],
};
function announcePhase(){
  const key=G.turn+'-'+G.phase;
  if(key===_phaseKey) return;
  _phaseKey=key;
  const fx=PHASE_FX[G.phase];
  if(!fx || G.winner!==null) return;
  const b=document.getElementById('phase-banner');
  b.innerHTML=`<div class="pb-inner" data-phase="${G.phase}">
    <span class="pb-icon">${fx[0]}</span>
    <span class="pb-text">${fx[1]}</span>
    <span class="pb-sub">${esc(pname(G.turn))}의 턴</span>
  </div>`;
  b.classList.remove('show'); void b.offsetWidth; // 애니메이션 재시작
  b.classList.add('show');
}

// ══════════ 보드 방향 — 내 진영은 항상 아래(6시) ══════════
// HTML은 좌석 0=아래, 좌석 1=위로 고정이라 온라인 게스트(좌석 1)는 자기 진영이 12시에 보였다.
// 렌더 코드는 전부 id(hand-p, base-p...) 기준이므로, 두 player-area '컨테이너'의 위치만 바꾸면
// 게임 로직·동기화는 전혀 건드리지 않고 화면만 뒤집힌다.
// 내부 요소 순서(위: 사이드→기지→손패 / 아래: 손패→기지→사이드)는 HTML에 고정돼 있어서,
// 자리만 바꾸면 좌우가 뒤집힌 배치가 된다 → row-reverse로 원래 모양을 유지한다.
UI._orient = 0;
function orientBoard(){
  const bottom = (NET.online && NET.seat===1) ? 1 : 0;   // 리플레이·오프라인은 기본(0=아래)
  if(UI._orient === bottom) return;
  const board=document.getElementById('board');
  const bfs=document.getElementById('battlefields');
  const pTop=document.getElementById('parea-'+(1-bottom));
  const pBot=document.getElementById('parea-'+bottom);
  if(!board||!bfs||!pTop||!pBot) return;
  board.insertBefore(pTop, bfs);
  bfs.after(pBot);
  const flipped = bottom===1;
  pTop.classList.toggle('flipped', flipped);
  pBot.classList.toggle('flipped', flipped);
  pTop.classList.add('top');    pTop.classList.remove('bottom');
  pBot.classList.add('bottom'); pBot.classList.remove('top');
  // 상대 손패 표시(회색조)도 '위에 있는 쪽'을 따라간다
  document.getElementById('hand-'+(1-bottom)).classList.add('opp');
  document.getElementById('hand-'+bottom).classList.remove('opp');
  UI._orient = bottom;
}

UI.render = function(){
  if(!G) return;
  orientBoard();
  // 튜토리얼: 상태가 변할 때마다 진행 체크 (백그라운드 인터벌 스로틀 대비)
  if(typeof TUT!=='undefined' && TUT.active && TUT.tickSoon) TUT.tickSoon();
  // 상단바
  document.getElementById('turn-info').textContent=`${pname(G.turn)}의 턴`;
  const phaseKo={setup:'준비',awaken:'각성',beginning:'시작',channel:'전개',draw:'드로우',action:'행동'}[G.phase]||G.phase;
  document.getElementById('phase-info').textContent=
    `${phaseKo} 단계` + (G.state==='showdown'?' · ⚔️결전 중':'');
  announcePhase();
  document.getElementById('score-info').innerHTML=
    `<span style="color:#9fc8ff">${esc(pname(0))} ${G.players[0].points}점</span> : <span style="color:#ffc89f">${esc(pname(1))} ${G.players[1].points}점</span> (선취 ${G.victory}점)`;

  // 풀
  const P=G.players[G.actingPlayer];
  const powStr=Object.entries(P.power).filter(([,v])=>v>0).map(([d,v])=>`${DOMAIN_ICON[d]}${v}`).join(' ');
  document.getElementById('pool-display').innerHTML=
    `<b>${esc(pname(G.actingPlayer))}</b> 풀<br>에너지 ${P.energy} ${powStr?'· '+powStr:''}<br>준비 룬 ${readyRunes(G.actingPlayer).length}/${P.runes.length}`;

  if(G.state!=='showdown'){
    document.getElementById('showdown-banner').style.display='none';
    document.getElementById('btn-pass').style.display='none';
    document.getElementById('btn-endturn').style.display='';
  }

  // 플레이어 영역
  for(let p=0;p<2;p++){
    const Pl=G.players[p];
    // 전설
    const lc=card(Pl.legendN);
    const lslot=document.getElementById('legend-'+p);
    lslot.innerHTML='';
    const lel=cardMiniEl(lc);
    if(Pl.legendEx) lel.classList.add('exhausted');
    lel.onclick=(e)=>showLegendMenu(p,e);
    lslot.appendChild(lel);
    const lcap=document.createElement('div'); lcap.className='slot-caption'; lcap.textContent='전설';
    lslot.appendChild(lcap);
    // 챔피언 존
    const cslot=document.getElementById('champzone-'+p);
    cslot.innerHTML='';
    if(Pl.champInZone){
      const cc=card(Pl.champN);
      const cel=cardMiniEl(cc);
      cel.onclick=(e)=>{
        if(replayLock()) return;
        if(G.winner!==null) return;
        if(e.altKey) return;
        e.stopPropagation();
        if(NET.online && p!==NET.seat) return;
        const menu=document.getElementById('ctx-menu');
        menu.innerHTML='';
        const play=document.createElement('div'); play.className='ctx-item';
        play.textContent=`▶ 챔피언 플레이 (비용 ${cc.e??0}${cc.p?'+힘'+cc.p:''})`;
        play.onclick=()=>{ hideMenu();
          NET.dispatch({k:'play',p,handIdx:-1,opts:{champZone:true}},
            ()=>playCardFromHand(p,-1,{champZone:true})); };
        menu.appendChild(play);
        openMenuAt(menu, e);
      };
      cslot.appendChild(cel);
    }
    const ccap=document.createElement('div'); ccap.className='slot-caption'; ccap.textContent='챔피언 존';
    cslot.appendChild(ccap);
    // 룬
    const rz=document.getElementById('runes-'+p);
    rz.innerHTML='';
    Pl.runes.forEach(r=>{
      const rc=card(r.n);
      const rel=document.createElement('div');
      rel.className='rune-mini'+(r.ex?' exhausted':'');
      const dom=runeDomain(r.n);
      // 실제 룬 카드 이미지 + 영역 색 테두리, 작은 화면에서도 알아보게 영역 아이콘 배지를 겹친다
      if(rc.img) rel.style.backgroundImage=`url("${cardImgUrl(rc.img,120)}")`;
      rel.style.borderColor=DOMAIN_COLOR[dom]||'#556';
      const badge=document.createElement('span');
      badge.className='rm-dom'; badge.textContent=DOMAIN_ICON[dom]||'◆';
      rel.appendChild(badge);
      rel.title=rc.ko+(r.ex?' (탈진)':'');
      rel.onmouseenter=()=>UI.inspect(rc);
      rel._card=rc; attachZoom(rel);           // 꾹 누르기/우클릭/Alt+클릭으로 확대
      rz.appendChild(rel);
    });
    // 더미
    document.querySelector('#deck-'+p+' .pile-count').textContent=Pl.deck.length;
    document.querySelector('#runedeck-'+p+' .pile-count').textContent=Pl.runeDeck.length;
    document.querySelector('#trash-'+p+' .pile-count').textContent=Pl.trash.length;
    const cd=document.getElementById('counts-'+p);
    cd.innerHTML=`덱: ${Pl.deck.length}<br>손패: ${Pl.hand.length}`;
    // BOT 대전에서만 봇 손패 옆에 '손패 확인' 토글을 붙인다.
    // counts는 매 렌더마다 innerHTML로 다시 그려지므로 버튼도 여기서 다시 만든다.
    // (CSP가 script-src 'self'라 인라인 onclick은 막히므로 addEventListener로 붙인다)
    if(botHandHidable(p)){
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='peek-btn'+(UI.peekBotHand?' on':'');
      btn.textContent=(UI.peekBotHand?'☑':'☐')+' 손패 확인';
      btn.title=UI.peekBotHand
        ? '봇의 손패를 보고 있습니다 (보기 전용) — 다시 누르면 가립니다'
        : '봇의 손패를 확인합니다 (연습용)';
      btn.addEventListener('click', ()=>{ UI.peekBotHand=!UI.peekBotHand; UI.render(); });
      cd.appendChild(btn);
    }
    // 기지
    const bz=document.getElementById('base-'+p);
    bz.innerHTML='<div class="zone-label">기지</div>';
    attachDropZone(bz, 'base'); // 드래그 이동: 자기 기지으로 귀환 (moveUnits가 소유자 검증)
    Pl.base.forEach(u=>bz.appendChild(unitEl(u)));
    // 도구 (기지에 표시)
    Pl.gear.forEach(g=>{
      const gel=cardMiniEl(card(g.n));
      gel.style.borderColor='#8a7a4a';
      if(g.ex) gel.classList.add('exhausted');
      gel.oncontextmenu=(e)=>{ e.preventDefault(); showGearMenu(p,g,e); };
      gel.onclick=(e)=>showGearMenu(p,g,e);
      bz.appendChild(gel);
    });
    // 손패
    const hz=document.getElementById('hand-'+p);
    hz.innerHTML='';
    const faceUp = handFaceUp(p);          // 공개 규칙은 handFaceUp 한 곳에만 있다
    const peeked = faceUp && botHandHidable(p);
    Pl.hand.forEach((n,i)=>{
      let el;
      if(!faceUp){ el = document.createElement('div'); el.className='card-mini card-back'; }
      else if(peeked){
        // 들여다본 봇 손패는 보기 전용 — 클릭을 살려 두면 사람이 봇 카드를 대신 내 버릴 수 있다
        // (확대·정보 표시는 cardMiniEl에 그대로 남아 있어 '확인'에는 지장이 없다)
        el = cardMiniEl(card(n)); el.classList.add('peeked');
      }
      else { el = cardMiniEl(card(n)); el.onclick=(e)=>onHandClick(p,i,e); }
      hz.appendChild(el);
    });
  }

  // 전장
  G.bfs.forEach((bf,i)=>{
    const el=document.getElementById('bf-'+i);
    el.className='battlefield';
    if(bf.controller!==null) el.classList.add('controlled-'+bf.controller);
    if(G.showdown&&G.showdown.bfIdx===i) el.classList.add('contested');
    const bc=card(bf.n);
    el.innerHTML='';
    const head=document.createElement('div'); head.className='bf-header';
    if(bc.img){
      const im=document.createElement('img'); im.src=cardImgUrl(bc.img,280);
      im.onmouseenter=()=>UI.inspect(bc);
      // 전장 카드 클릭 → 확대 (단, 이동 목적지 선택 중에는 이동 우선)
      im.onclick=(e)=>{
        if(_moveArmed && _moveSel.size) return;   // 버블링되어 이동 처리로 진행
        e.stopPropagation();
        UI.showZoom(bc);
      };
      im._card=bc; attachZoom(im);                 // 꾹 누르기/Alt+클릭 확대
      head.appendChild(im);
    }
    const info=document.createElement('div');
    info.innerHTML=`<div class="bf-name">${esc(bc.ko)}</div>
      <div class="bf-status">${bf.controller===null?'무주공산':'통제: '+esc(pname(bf.controller))}${bf.hiddenCards.length?' · 🕶숨김카드×'+bf.hiddenCards.length:''}</div>`;
    head.appendChild(info);
    el.appendChild(head);
    const uwrap=document.createElement('div'); uwrap.className='bf-units';
    for(let p=0;p<2;p++){
      const us=bf.units.filter(u=>u.ctrl===p);
      if(!us.length) continue;
      const row=document.createElement('div'); row.className='bf-row';
      const lbl=document.createElement('div'); lbl.className='bf-row-label'; lbl.textContent=pname(p);
      row.appendChild(lbl);
      us.forEach(u=>row.appendChild(unitEl(u)));
      uwrap.appendChild(row);
    }
    el.appendChild(uwrap);
    attachDropZone(el, i); // 드래그 이동: 이 전장으로
    // 클릭: 이동 목적지 / 숨김 카드 플레이
    el.onclick=(e)=>{
      if(e.target.closest('.card-mini')) return;
      if(_moveArmed && _moveSel.size){ executeMove(i); return; }
      const hp=G.actingPlayer;
      if(bf.hiddenCards.some(h=>h.by===hp)){
        // 봇 차례에 사람이 전장을 누르면 봇이 숨겨둔 카드가 강제로 공개·플레이됐다
        if(!canInitiate(hp)) return;
        NET.dispatch({k:'playHidden',p:hp,bfIdx:i}, ()=>playHidden(hp,i));
      }
    };
  });

  updateButtons();
  UI.fx.check();          // 행동 차례가 바뀌었으면 연출
};

// 리플레이 관전 중에는 모든 조작을 잠근다 (상태 변경은 NET.dispatch에서도 한 번 더 차단)
function replayLock(){ return typeof REPLAY!=='undefined' && REPLAY.viewing; }

function updateButtons(){
  document.getElementById('action-buttons').style.display = replayLock() ? 'none' : '';
  if(replayLock()) return;
  const btnMove=document.getElementById('btn-move');
  btnMove.className='act-btn'+(_moveArmed?' armed':'');
  btnMove.textContent=_moveArmed?`🚶 이동: 목적지 클릭 (${_moveSel.size}개 선택)`:'🚶 이동';
  document.getElementById('btn-endturn').disabled = G.state==='showdown' || G.winner!==null;
}

// 이동 실행
async function executeMove(dest){
  hideMenu();
  const units=everyUnit().filter(u=>_moveSel.has(u.uid));
  const uids=units.map(u=>u.uid);
  const p=G.actingPlayer;
  _moveArmed=false; _moveSel.clear();
  updateButtons();
  if(units.length){
    NET.dispatch({k:'move',p,uids,dest}, ()=>moveUnits(p,units,dest).then(()=>UI.render()));
  }
  UI.render();
}

// ---------- 전설 메뉴 ----------
function showLegendMenu(p, e){
  if(replayLock()) return;
  if(G.winner!==null) return;
  if(e && e.stopPropagation) e.stopPropagation();
  const Pl=G.players[p];
  const fx=FX[Pl.legendN]||{activated:[]};
  const menu=document.getElementById('ctx-menu');
  menu.innerHTML='';
  const title=document.createElement('div'); title.className='ctx-title'; title.textContent=card(Pl.legendN).ko;
  menu.appendChild(title);
  const mine = !(NET.online && p!==NET.seat) && !(typeof botIs==='function' && botIs(p));
  (fx.activated||[]).forEach((ab,abIdx)=>{
    if(!mine) return;        // 전설 카드 자체는 공개 정보라 이름은 보여 주고, 발동만 막는다
    const item=document.createElement('div'); item.className='ctx-item';
    item.textContent='⚡ '+ab.label + (Pl.legendEx&&ab.cost&&ab.cost.exhaustSelf?' (탈진됨)':'');
    item.onclick=()=>{ hideMenu();
      NET.dispatch({k:'ability',p,src:{kind:'legend'},abIdx},
        ()=>activateAbility(p,{kind:'legend'},ab)); };
    menu.appendChild(item);
  });
  if(!(fx.activated||[]).length){
    const none=document.createElement('div'); none.className='ctx-title'; none.textContent='(상시/트리거 효과 — 자동 처리)';
    menu.appendChild(none);
  }
  openMenuAt(menu, e);
}

// ---------- 도구 메뉴 ----------
function showGearMenu(p, g, e){
  if(replayLock()) return;
  if(e && e.stopPropagation) e.stopPropagation();
  if(NET.online && p!==NET.seat) return;
  if(typeof botIs==='function' && botIs(p)) return;   // 봇 도구는 봇이 쓴다 (확대·정보는 카드 자체로 가능)
  const menu=document.getElementById('ctx-menu');
  const c=card(g.n);
  const fx=FX[g.n]||{activated:[]};
  const gearIdx=G.players[p].gear.indexOf(g);
  menu.innerHTML='';
  const title=document.createElement('div'); title.className='ctx-title'; title.textContent=c.ko;
  menu.appendChild(title);
  (fx.activated||[]).forEach((ab,abIdx)=>{
    const item=document.createElement('div'); item.className='ctx-item';
    item.textContent='⚡ '+ab.label;
    item.onclick=()=>{ hideMenu();
      NET.dispatch({k:'ability',p,src:{kind:'gear',gearIdx},abIdx},
        ()=>activateAbility(p,{kind:'gear',g},ab)); };
    menu.appendChild(item);
  });
  if(fx.equipCost!==undefined){
    const item=document.createElement('div'); item.className='ctx-item';
    item.textContent=`🛡 장착 (에너지 ${fx.equipCost})`;
    item.onclick=()=>{ hideMenu();
      NET.dispatch({k:'equip',p,gearIdx}, ()=>equipGear(p,gearIdx)); };
    menu.appendChild(item);
  }
  openMenuAt(menu, e);
}

// ---------- 승리 ----------
UI.showVictory = function(p){
  const box=document.getElementById('modal-box');
  const isBot = typeof BOT!=='undefined' && BOT.active && !NET.online;
  box.innerHTML=`<div class="victory-box">
    <h2>🎉 ${esc(pname(p))} 승리!</h2>
    <p>${G.victory}점을 선취했습니다.</p>
    <div class="modal-btns" id="victory-btns"></div>
  </div>`;
  const btns=box.querySelector('#victory-btns');
  const add=(label,fn,primary)=>{ const b=document.createElement('button'); if(primary) b.className='primary';
    b.textContent=label; b.onclick=fn; btns.appendChild(b); };
  if(NET.online){
    // 같은 상대와 즉시 재대결 (덱 다시 선택) — 연결은 유지 중
    add('🔄 상대와 다시 하기 (덱 선택)', ()=>{ closeModal(); RM.openPick(false); }, true);
    add(typeof P2P!=='undefined'&&P2P.active?'🚪 나가기':'🚪 로비로 돌아가기', ()=>{ closeModal(); gameLeave(); });
  } else if(isBot){
    add('🤖 새 게임 (덱 선택)', ()=>{ BOT.active=false; closeModal(); openBotSelect(); }, true);
    add('처음 화면으로', ()=>location.reload());
  } else if(typeof TUT!=='undefined' && TUT.active){
    // 튜토리얼(자유 연습 포함) 승리 화면 — 핫시트 새 게임이 아니라 튜토리얼 문맥으로
    add('🔄 튜토리얼 다시 시작', ()=>{ closeModal(); TUT.start(); }, true);
    add('처음 화면으로', ()=>location.reload());
  } else {
    add('🔄 새 게임', ()=>{ closeModal(); startHotseat(); }, true);
    add('처음 화면으로', ()=>location.reload());
  }
  // 경기 종료 시 리플레이는 자동 저장됨 (튜토리얼 제외) — 바로 보러 갈 수 있게 안내
  const wasP2P = typeof P2P!=='undefined' && P2P.active;
  add(REPLAY.willSave ? '🎬 리플레이 보관함 (이 경기 저장됨)' : '🎬 리플레이 보관함', ()=>{
    closeModal();
    if(NET.online){ gameLeave(); REPLAY.openLibrary(wasP2P?'p2p-screen':'lobby-screen'); }
    else REPLAY.openLibrary();
  });
  openModal();
};

// ---------- 버튼 바인딩 ----------
window.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('btn-endturn').onclick=()=>{
    if(G.state==='showdown'||G.winner!==null) return;
    if(_resolver){ UI.toast('진행 중인 선택을 먼저 완료하세요','warn'); return; }
    if(NET.online && G.turn!==NET.seat){ UI.toast('자신의 턴이 아닙니다','warn'); return; }
    NET.dispatch({k:'endTurn'}, ()=>endTurn());
  };
  document.getElementById('btn-move').onclick=()=>{
    if(G.state==='showdown'){ UI.toast('결전 중에는 이동할 수 없습니다','warn'); return; }
    if(G.turn!==G.actingPlayer){ return; }
    if(NET.online && G.turn!==NET.seat){ UI.toast('자신의 턴이 아닙니다','warn'); return; }
    _moveArmed=!_moveArmed;
    if(!_moveArmed) _moveSel.clear();
    else UI.toast('이동할 아군 유닛들을 클릭한 뒤, 목적지(전장/기지)를 클릭하세요');
    UI.render();
  };
  document.getElementById('btn-pass').onclick=()=>{
    if(G.state!=='showdown') return;
    if(_resolver){ UI.toast('진행 중인 선택을 먼저 완료하세요','warn'); return; }
    if(NET.online && G.actingPlayer!==NET.seat){ UI.toast('상대의 응답 차례입니다','warn'); return; }
    NET.dispatch({k:'pass'}, ()=>showdownPass());
  };
  document.getElementById('btn-help').onclick=()=>{
    const box=document.getElementById('modal-box');
    box.innerHTML=`<h3>도움말</h3>
    <div style="font-size:13px;line-height:1.9">
    · <b>승리</b>: 8점 선취. 전장 <b>정복</b>(빼앗기) 1점, 유닛을 주둔시켜 자기 개시 단계까지 <b>유지</b> 1점.<br>
    · 전장에 유닛이 하나도 없으면 <b>통제를 잃고 무주공산</b>이 됩니다 — 비워두면 유지 득점도 없습니다.<br>
    · 마지막 1점은 유지로만, 또는 그 턴에 모든 전장을 득점한 경우의 정복으로만 얻습니다.<br>
    · <b>비용</b>: 에너지는 룬 탈진, 힘는 룬 재활용(룬 덱으로 반환)으로 자동 지불됩니다.<br>
    · <b>이동</b>: 유닛을 <b>드래그해서 전장/기지에 놓기</b>, 또는 [이동] 버튼 → 유닛들 클릭 → 목적지 클릭. 이동한 유닛은 탈진됩니다.<br>
    · 여러 유닛을 함께 보내려면 [이동] 버튼으로 유닛들을 선택한 뒤 그중 하나를 드래그하세요.<br>
    · 상대 전장/유닛이 있는 곳으로 이동하면 <b>결전</b>이 열립니다. 결전 중 낸 카드·능력은 <b>체인</b>에 쌓이고,
      양측이 모두 패스하면 <b>마지막에 낸 것부터 하나씩</b> 해결됩니다. 각 해결 사이에 [반응]으로 다시 응수할 수 있습니다.
      빈 체인에서 양측이 패스하면 전투가 벌어집니다.<br>
    · <b>전투</b>: 양측 위력 합계만큼 상대 유닛에 피해 배분(치명 우선·[탱커] 우선). 방어측이 살아남으면 공격측은 기지 귀환.<br>
    · <b>손패 카드 클릭</b> → 플레이/숨기기. <b>유닛 클릭/우클릭</b> → 능력 발동.<br>
    · <b>선택 창·선택 메뉴는 바깥을 클릭해도 닫히지 않습니다</b> (실수로 선택을 잃지 않도록). 닫으려면 메뉴의 <b>[✖ 닫기]</b>나 <b>Esc</b>를 쓰세요.<br>
    · <b>카드 확대(효과 크게 보기)</b>: 카드를 <b>우클릭</b>, <b>꾹 누르기</b> 또는 <b>Alt+클릭</b> (닫기: 바깥 클릭/Esc). 유닛은 우클릭이 능력 메뉴라 꾹 누르기/Alt+클릭.<br>
    · 자동화가 안 되는 효과는 ⚙️ 알림이 뜹니다.<br>
    · <b>밴 리스트</b>: 덱 관리/덱 편집 화면의 [🚫 밴 리스트] 버튼에서 확인. 온라인 방·P2P에서 <b>양쪽 모두 '밴 적용'을 선택</b>하면 밴 카드 포함 덱은 사용할 수 없습니다.<br>
    · 기지은 안전지대이며 유닛은 기지↔전장으로 이동합니다. [개입]은 전장 간 이동 가능.<br>
    </div>`;
    const hbtns=document.createElement('div'); hbtns.className='modal-btns';
    const hclose=document.createElement('button'); hclose.className='primary'; hclose.textContent='닫기';
    hclose.onclick=closeModal;                    // CSP(script-src 'self')가 인라인 onclick을 차단하므로 프로퍼티로 연결
    hbtns.appendChild(hclose); box.appendChild(hbtns);
    openModal(); markModalDismissable();
  };
  // 모달 밖 클릭 정책: 선택(비정보성) 창은 절대 닫히지 않고 안내만 표시 — 닫히면 선택 진행 불가(교착)
  //                  정보성 창(도움말/밴 리스트/대회 덱 등, dismiss 표시)만 바깥 클릭으로 닫힘
  document.getElementById('modal-overlay').onclick=(e)=>{
    if(e.target.id!=='modal-overlay') return;                 // 모달 내부 클릭
    const ov=e.currentTarget;
    if(document.querySelector('.victory-box')) return;        // 승리 창은 버튼으로만
    if(ov.dataset.dismiss){ closeModal(); return; }
    UI.toast('선택을 진행해 주세요 — 이 창은 화면의 버튼으로만 닫힙니다','warn');
  };
});
