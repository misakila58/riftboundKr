// ══════════ UI: 렌더링 & 상호작용 ══════════
const UI = {};

// ---------- 로그/토스트 ----------
// 「카드명」 → 카드 매핑 (로그 호버 인스펙트용)
let _name2card=null;
function nameToCard(nm){
  if(!_name2card){ _name2card={}; CARDS.forEach(c=>{ if(!_name2card[c.ko]) _name2card[c.ko]=c; }); }
  return _name2card[nm]||null;
}
UI.log = function(msg, cls){
  const el=document.getElementById('log');
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
  el.appendChild(d);
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
  document.getElementById('showdown-banner').style.display='';
  document.getElementById('showdown-banner').innerHTML =
    `⚔️ 결전: ${esc(card(bf.n).ko)}<br>공격 ${esc(pname(sd.attacker))} → 방어 ${esc(pname(sd.defender))}`;
  UI.prompt(`${pname(G.actingPlayer)}: [행동]/[반응] 카드·능력을 사용하거나 패스하세요`);
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
function _pickOptionLocal(p, title, options){
  return new Promise(res=>{
    const box=document.getElementById('modal-box');
    box.innerHTML=`<h3>👉 ${esc(pname(p))}: ${esc(title)}</h3>`;
    const btns=document.createElement('div'); btns.className='modal-btns';
    options.forEach((o,i)=>{
      const b=document.createElement('button'); b.className='primary'; b.textContent=o.label;
      b.onclick=()=>{ closeModal(); res(i); };
      btns.appendChild(b);
    });
    const cancel=document.createElement('button'); cancel.textContent='취소';
    cancel.style.opacity=.6;
    cancel.onclick=()=>{ closeModal(); res(null); };
    btns.appendChild(cancel);
    box.appendChild(btns);
    openModal();
  });
}

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
      wrap.appendChild(el);
    });
    box.appendChild(wrap);
    openModal();
  });
}

function openModal(){ document.getElementById('modal-overlay').style.display='flex'; }
function closeModal(){ document.getElementById('modal-overlay').style.display='none'; }

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

// ---------- 카드 미니 요소 ----------
function cardMiniEl(c, opts={}){
  const el=document.createElement('div');
  el.className='card-mini';
  if(c.img) el.style.backgroundImage=`url("${c.img}")`;
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
  } else if(c.img) el.style.backgroundImage=`url("${c.img}")`;
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
    ${c.img?`<img src="${c.img}" alt="">`:''}
    <div class="insp-name">${esc(c.ko)}</div>
    <div class="insp-name-en">${esc(c.name)} · #${c.n}</div>
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
    <div class="cz-box" onclick="event.stopPropagation()">
      ${c.img?`<img class="cz-img" src="${c.img}" alt="">`:'<div class="cz-noimg">🃏</div>'}
      <div class="cz-info">
        <div class="cz-name">${esc(c.ko||'')}</div>
        <div class="cz-en">${esc(c.name||'')}${c.n?` · #${c.n}`:''}</div>
        <div class="cz-type">${esc(typeLine(c))}${statBits.length?' · '+statBits.join(' · '):''}</div>
        <div class="cz-text">${renderIcons(esc(c.tko||c.text||'(효과 없음)'))}</div>
        ${kwNote}
        ${c.tags&&c.tags.length?`<div class="cz-tags">태그: ${c.tags.map(esc).join(', ')}</div>`:''}
        <div class="cz-hint">아무 곳이나 클릭하거나 Esc로 닫기</div>
      </div>
    </div>`;
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
}

// 롱프레스 직후의 클릭을 한 번 무시 (플레이/선택 오동작 방지)
document.addEventListener('click', (e)=>{
  if(_suppressClick){ _suppressClick=false; e.stopImmediatePropagation(); e.preventDefault(); }
}, true);
// Esc로 확대 닫기
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') UI.hideZoom(); });

// ---------- 유닛 클릭 ----------
let _moveSel = new Set();
let _moveArmed = false;
function onUnitClick(u, e){
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
  if(e && e.stopPropagation) e.stopPropagation(); // 여는 클릭이 닫기 리스너로 버블링 방지
  const menu=document.getElementById('ctx-menu');
  menu.innerHTML='';
  const title=document.createElement('div'); title.className='ctx-title'; title.textContent=unitName(u);
  menu.appendChild(title);
  const fx=unitFx(u);
  // 발동형 능력
  (fx.activated||[]).forEach((ab,abIdx)=>{
    if(u.ctrl!==G.actingPlayer && !(ab.reaction||ab.action)) return;
    if(NET.online && u.ctrl!==NET.seat) return;
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
  menu.style.display='block';
  menu.style.left=Math.min(e.clientX, innerWidth-190)+'px';
  menu.style.top=Math.min(e.clientY, innerHeight-menu.offsetHeight-10)+'px';
}
function hideMenu(){ document.getElementById('ctx-menu').style.display='none'; }
document.addEventListener('click', e=>{
  if(!e.target.closest('#ctx-menu')) hideMenu();
});

// ---------- 손패 클릭 ----------
// 온라인: 내 좌석의 행동만 개시 가능
function canInitiate(p){
  if(!NET.online) return true;
  if(p!==NET.seat){ UI.toast('상대 카드는 조작할 수 없습니다','warn'); return false; }
  return true;
}

function onHandClick(p, idx, e){
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
      ()=>playCardFromHand(p,idx).then(ok=>{ if(ok&&G.state==='showdown') showdownActed(); }));
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
  menu.style.display='block';
  menu.style.left=Math.min(e.clientX, innerWidth-190)+'px';
  menu.style.top=Math.min(e.clientY-10, innerHeight-200)+'px';
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

UI.render = function(){
  if(!G) return;
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
        menu.style.display='block';
        menu.style.left=e.clientX+'px'; menu.style.top=e.clientY+'px';
      };
      cslot.appendChild(cel);
    }
    const ccap=document.createElement('div'); ccap.className='slot-caption'; ccap.textContent='챔피언 존';
    cslot.appendChild(ccap);
    // 룬
    const rz=document.getElementById('runes-'+p);
    rz.innerHTML='';
    Pl.runes.forEach(r=>{
      const rel=document.createElement('div');
      rel.className='rune-mini'+(r.ex?' exhausted':'');
      const dom=runeDomain(r.n);
      rel.textContent=DOMAIN_ICON[dom]||'◆';
      rel.style.borderColor=DOMAIN_COLOR[dom]||'#556';
      rel.title=card(r.n).ko+(r.ex?' (탈진)':'');
      rel.onmouseenter=()=>UI.inspect(card(r.n));
      rz.appendChild(rel);
    });
    // 더미
    document.querySelector('#deck-'+p+' .pile-count').textContent=Pl.deck.length;
    document.querySelector('#runedeck-'+p+' .pile-count').textContent=Pl.runeDeck.length;
    document.querySelector('#trash-'+p+' .pile-count').textContent=Pl.trash.length;
    document.getElementById('counts-'+p).innerHTML=`덱: ${Pl.deck.length}<br>손패: ${Pl.hand.length}`;
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
    Pl.hand.forEach((n,i)=>{
      const showFace = !NET.online || p===NET.seat; // 온라인: 상대 손패 비공개
      let el;
      if(showFace){ el = cardMiniEl(card(n)); el.onclick=(e)=>onHandClick(p,i,e); }
      else { el = document.createElement('div'); el.className='card-mini card-back'; }
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
      const im=document.createElement('img'); im.src=bc.img;
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
        if(NET.online && hp!==NET.seat) return;
        NET.dispatch({k:'playHidden',p:hp,bfIdx:i}, ()=>playHidden(hp,i));
      }
    };
  });

  updateButtons();
};

function updateButtons(){
  const btnMove=document.getElementById('btn-move');
  btnMove.className='act-btn'+(_moveArmed?' armed':'');
  btnMove.textContent=_moveArmed?`🚶 이동: 목적지 클릭 (${_moveSel.size}개 선택)`:'🚶 이동';
  document.getElementById('btn-endturn').disabled = G.state==='showdown' || G.winner!==null;
}

// 이동 실행
async function executeMove(dest){
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
  if(G.winner!==null) return;
  if(e && e.stopPropagation) e.stopPropagation();
  const Pl=G.players[p];
  const fx=FX[Pl.legendN]||{activated:[]};
  const menu=document.getElementById('ctx-menu');
  menu.innerHTML='';
  const title=document.createElement('div'); title.className='ctx-title'; title.textContent=card(Pl.legendN).ko;
  menu.appendChild(title);
  (fx.activated||[]).forEach((ab,abIdx)=>{
    if(NET.online && p!==NET.seat) return;
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
  menu.style.display='block';
  menu.style.left=Math.min(e.clientX,innerWidth-190)+'px';
  menu.style.top=Math.min(e.clientY,innerHeight-180)+'px';
}

// ---------- 도구 메뉴 ----------
function showGearMenu(p, g, e){
  if(e && e.stopPropagation) e.stopPropagation();
  if(NET.online && p!==NET.seat) return;
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
  menu.style.display='block';
  menu.style.left=Math.min(e.clientX,innerWidth-190)+'px';
  menu.style.top=Math.min(e.clientY,innerHeight-180)+'px';
}

// ---------- 승리 ----------
UI.showVictory = function(p){
  const box=document.getElementById('modal-box');
  const isBot = typeof BOT!=='undefined' && BOT.active && !NET.online;
  const btnLabel = NET.online ? '로비로 돌아가기' : (isBot ? '🤖 새 게임 (덱 선택)' : '새 게임');
  box.innerHTML=`<div class="victory-box">
    <h2>🎉 ${esc(pname(p))} 승리!</h2>
    <p>${G.victory}점을 선취했습니다.</p>
    <div class="modal-btns">
      <button class="primary" id="btn-victory-next">${btnLabel}</button>
      ${isBot?'<button id="btn-victory-home">처음 화면으로</button>':''}
    </div>
  </div>`;
  document.getElementById('btn-victory-next').onclick=()=>{
    if(isBot){ BOT.active=false; closeModal(); openBotSelect(); }
    else location.reload();
  };
  const home=document.getElementById('btn-victory-home');
  if(home) home.onclick=()=>location.reload();
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
    · <b>승리</b>: 8점 선취. 전장 <b>정복</b>(빼앗기) 1점, 자기 개시 단계까지 <b>유지</b> 유지 1점.<br>
    · 마지막 1점은 유지로만, 또는 그 턴에 모든 전장을 득점한 경우의 정복으로만 얻습니다.<br>
    · <b>비용</b>: 에너지는 룬 탈진, 힘는 룬 재활용(룬 덱으로 반환)으로 자동 지불됩니다.<br>
    · <b>이동</b>: 유닛을 <b>드래그해서 전장/기지에 놓기</b>, 또는 [이동] 버튼 → 유닛들 클릭 → 목적지 클릭. 이동한 유닛은 탈진됩니다.<br>
    · 여러 유닛을 함께 보내려면 [이동] 버튼으로 유닛들을 선택한 뒤 그중 하나를 드래그하세요.<br>
    · 상대 전장/유닛이 있는 곳으로 이동하면 <b>결전</b>이 열립니다. [행동]/[반응] 카드로 응수한 뒤 패스하면 전투가 벌어집니다.<br>
    · <b>전투</b>: 양측 위력 합계만큼 상대 유닛에 피해 배분(치명 우선·[탱커] 우선). 방어측이 살아남으면 공격측은 기지 귀환.<br>
    · <b>손패 카드 클릭</b> → 플레이/숨기기. <b>유닛 클릭/우클릭</b> → 능력 발동.<br>
    · <b>카드 확대(효과 크게 보기)</b>: 카드를 <b>꾹 누르기</b> 또는 <b>Alt+클릭</b> (닫기: 클릭/Esc).<br>
    · 자동화가 안 되는 효과는 ⚙️ 알림이 뜹니다.<br>
    · 기지은 안전지대이며 유닛은 기지↔전장으로 이동합니다. [개입]은 전장 간 이동 가능.<br>
    </div>
    <div class="modal-btns"><button class="primary" onclick="closeModal()">닫기</button></div>`;
    openModal();
  };
  document.getElementById('modal-overlay').onclick=(e)=>{
    if(e.target.id==='modal-overlay' && !document.querySelector('.victory-box')) {/* 모달 밖 클릭 무시 */}
  };
});
