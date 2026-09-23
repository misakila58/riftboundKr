// ══════════ UI: 렌더링 & 상호작용 ══════════
// bot-sim.js가 예측 중 UI 전체를 조용한 구현으로 갈아 끼웠다가 되돌린다 → const 금지
let UI = {};
// 연출은 fx.js가 채운다. 로드 전이나 로드 실패에도 게임이 멈추지 않도록 빈 구현을 먼저 둔다.
UI.fx = { on:false, unit(){}, cast(){}, chainAdd(){}, turnEnd(){}, turnStart(){}, priority(){}, score(){}, check(){}, setOn(){}, pass(){}, turnEndAccepted(){} };

// 플레이 편의 설정은 이 기기에 저장한다. 게임 상태나 상대 플레이어의 설정에는 포함하지 않는다.
const PLAY_OPTIONS = {
  confirmEndTurn:true,
  confirmResourceAbilities:true,
  spellStage:true,       // 주문 준비 단계: 주문을 중앙에 올려 대상을 고른 뒤 [확인]으로 시전 (끄면 예전처럼 바로 시전)
  turnIntro:true,        // 턴 시작 연출: 띠·소리와 함께 1초 남짓 멈춤 (끄면 바로 진행)
  set(key, enabled){
    this[key]=!!enabled;
    try{ localStorage.setItem('rb_play_'+key, enabled?'on':'off'); }
    catch(e){ UI.toast('설정을 저장하지 못했습니다. 이번 실행에만 적용됩니다.','warn'); }
  },
};
for(const key of ['confirmEndTurn','confirmResourceAbilities','spellStage','turnIntro']){
  try{ PLAY_OPTIONS[key]=localStorage.getItem('rb_play_'+key)!=='off'; }catch(e){}
}

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
// 지금 게임 상태에 맞는 안내 문구로 되돌린다.
// 상대의 선택을 기다리며 띄운 문구가 선택이 끝난 뒤에도 남지 않게 하는 용도다.
UI.promptForState = function(){
  if(typeof G==='undefined' || !G) return;
  const move=pendingCombatMove();
  if(move){
    UI.prompt(move.action ? '이동 적용 중...'
      : `이동 대기: ${move.dest==='base'?'기지':card(G.bfs[move.dest].n).ko}, ${move.uids.size}기. Space로 적용하거나 S로 취소하세요.`);
    return;
  }
  // 승부가 났으면 대기 문구만 지운다 (승리 화면이 그 위를 덮는다)
  if(G.winner!==null){ UI.prompt(''); return; }
  if(G.state==='showdown' && G.showdown){ UI.promptShowdown(); return; }
  if(G._endingTurn){ UI.prompt('종료 단계 — 열린 결전 처리 중'); return; }
  if(G.phase==='action'){
    UI.prompt(`${pname(G.turn)}의 행동 단계 — 카드 플레이 / 이동 / 능력 발동 / 턴 종료`);
    return;
  }
  UI.prompt('');
};
UI.promptShowdown = function(){
  const sd=G.showdown; if(!sd) return;
  UI.updateChainView();
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
  // 결전 상태에서 열린 응수 창(정복 격발·결전 종료 처리 중)에서는 '패스'(턴 종료 자리) 버튼이 응수 패스다 — 숨기면 패스할 길이 없어 갇힌다(제보 2026-09-22)
  document.getElementById('btn-pass').style.display=_reactionPick?'none':'';
  document.getElementById('btn-endturn').style.display=_reactionPick?'':'none';
  updateButtons();   // 안내를 새로 그릴 때마다 패스 버튼의 활성 상태도 지금 상태로 맞춘다 (렌더 예외로 버튼만 낡은 채 남지 않게)
};
// 버튼 상태 감시: 렌더 도중 예외가 나거나 표식이 낡아 버튼만 잠긴 채 남으면 사람이 아무것도 못 한다 —
// 실제 상태와 어긋난 패스/턴 종료 버튼을 주기적으로 되맞춘다 (표시 여부 포함). 상태 계산은 위의 can* 함수가 한다.
setInterval(()=>{
  try{
    if(typeof G==='undefined' || !G || G.winner!==null || replayLock()) return;
    if(document.getElementById('game-screen')?.style.display==='none') return;
    healStaleRoutedPicks();   // 낡은 선택 표식 자가 복구는 여기(타이머)와 클릭 핸들러에서만
    const btnPass=document.getElementById('btn-pass'), btnEnd=document.getElementById('btn-endturn');
    if(!btnPass || !btnEnd) return;
    const inSd=G.state==='showdown' && !!G.showdown;
    const passDisp=(inSd && !_reactionPick)?'':'none';
    const endDisp=(inSd && !_reactionPick && !UI.spellStage)?'none':'';
    const canPass=UI.canShowdownPass(), canEnd=UI.canEndTurn(), reactionPass=canPassReaction();
    const stale=(btnPass.style.display!==passDisp) || (btnEnd.style.display!==endDisp)
      || (btnPass.disabled===canPass) || (!UI.spellStage && btnEnd.disabled===(reactionPass||canEnd));
    if(!stale) return;
    console.warn('button state resynced', {passDisp, endDisp, canPass, canEnd, reactionPass});
    btnPass.style.display=passDisp; btnEnd.style.display=endDisp;
    updateButtons();
  }catch(e){}
}, 800);

// ---------- 체인 보기 (게임 선택/온라인 응답과 독립적인 정보창) ----------
let _chainReturnFocus=null;
function visibleChain(){
  if(!G || G.winner!==null) return [];
  return [...(G.showdown?.chain||[]), ...(G.pendingChain||[])]
    .sort((a,b)=>(a.displayId||0)-(b.displayId||0));
}
function chainIsOpen(){ return document.getElementById('chain-overlay').style.display!=='none'; }
UI.showChain = function(){
  if(!visibleChain().length) return;
  _chainReturnFocus=document.activeElement;
  hideMenu(); UI.hideHover();
  document.getElementById('chain-overlay').style.display='flex';
  document.getElementById('chain-cards').scrollLeft=0;
  document.getElementById('chain-cards').scrollTop=0;
  UI.updateChainView();
  document.getElementById('btn-chain-close').focus();
};
UI.hideChain = function(){
  if(!chainIsOpen()) return;
  document.getElementById('chain-overlay').style.display='none';
  for(const id of ['btn-chain','btn-modal-chain']) document.getElementById(id).setAttribute('aria-expanded','false');
  UI.hideHover();
  if(_chainReturnFocus?.isConnected && _chainReturnFocus.offsetParent!==null) _chainReturnFocus.focus();
  _chainReturnFocus=null;
};
function chainCard(it){
  if(it.kind==='ability'){
    return card(it.n??it.gear?.n)||(it.unit?unitCard(it.unit):nameToCard(it.srcName));
  }
  return card(it.n);
}
function chainPreview(c, p, key, compact=false){
  const el=document.createElement('button');
  el.type='button'; el.className=compact?'chain-target-card':'chain-source-card';
  el.dataset.chainKey=key;
  el.setAttribute('aria-label',`${c.ko} 카드 확대`);
  const src=artImg(c,p);
  if(src){
    const img=document.createElement('img'); img.src=cardImgUrl(src,compact?280:480); img.alt=c.ko;
    el.appendChild(img);
  } else {
    const fallback=document.createElement('span'); fallback.className='chain-card-fallback'; fallback.textContent=c.ko;
    el.appendChild(fallback);
  }
  attachCardHover(el,c);
  el.onclick=()=>{ UI.hideHover(); UI.showZoom(c,p); };
  return el;
}
function chainTargetEl(target, chain, key){
  const row=document.createElement('div'); row.className='chain-target';
  if(target.p===0 || target.p===1) row.classList.add('chain-player-'+target.p);
  let c=card(target.n), status='', labelText=target.label;
  if(target.kind==='unit'){
    const u=everyUnit().find(x=>x.uid===target.uid);
    if(u){
      c=unitCard(u);
      status=`현재: ${pname(u.ctrl)} · ${unitWhere(u)} · 유닛 #${u.uid}`;
    } else status='현재 보드에 없음';
    if(!c && target.tokenMight!==undefined)
      c={n:0,ko:target.name,name:'Token',type:'Unit',super:'Token',m:target.tokenMight,dom:[],tags:[],text:'',tko:'토큰',img:''};
  } else if(target.kind==='trash'){
    if(!G.players[target.p].trash.includes(target.n)) status='현재 폐기장에 없음';
  } else if(target.kind==='chain'){
    const index=target.itemId!==undefined ? chain.findIndex(it=>it.displayId===target.itemId) : target.index;
    const item=chain[index];
    if(index>=0) labelText+=` (체인 #${index+1})`;
    if(!item || item.n!==target.n || item.p!==target.p) status='현재 체인에 없음';
    else if(item.countered) status='무효화된 주문';
  }
  const info=document.createElement('span'); info.className='chain-target-info';
  const label=document.createElement('span'); label.textContent=labelText;
  info.appendChild(label);
  if(status){ const note=document.createElement('small'); note.textContent=status; info.appendChild(note); }
  if(c){
    const preview=chainPreview(c,target.p,key,true); preview.appendChild(info); row.appendChild(preview);
  } else row.appendChild(info);
  return row;
}
function appendChainTargets(parent,targets,chain,keyPrefix,numberLabel){
  targets.forEach((target,j)=>{
    const row=chainTargetEl(target,chain,`${keyPrefix}-${j}`);
    if(targets.length>1){
      const number=document.createElement('div'); number.className='chain-target-number';
      number.textContent=`${numberLabel} ${j+1}`; row.prepend(number);
    }
    parent.appendChild(row);
  });
}
UI.updateChainView = function(){
  const chain=visibleChain();
  const boardView=boardChainView();
  document.getElementById('modal-shell').classList.toggle('has-chain',chain.length>0);
  for(const id of ['btn-chain','btn-modal-chain']){
    const button=document.getElementById(id);
    button.style.display=chain.length?'':'none';
    if(id==='btn-chain'){
      document.getElementById('btn-chain-count').textContent=chain.length;
      button.title=`${boardView && !boardView.hidden?'체인 숨기기':'체인 보기'} (${chain.length})`;
      button.setAttribute('aria-controls',boardView?'reaction-chain':'chain-overlay');
      button.setAttribute('aria-label',button.title);
    } else button.textContent=`🔗 체인 보기 (${chain.length})`;
    button.setAttribute('aria-expanded',String(chain.length>0 && (id==='btn-chain' && boardView ? !boardView.hidden : chainIsOpen())));
  }
  if(!chain.length){ UI.hideChain(); return; }
  if(!chainIsOpen()) return;
  document.getElementById('chain-title').textContent=`현재 체인 · ${chain.length}개`;
  const legend=document.getElementById('chain-legend'); legend.replaceChildren();
  for(let p=0;p<2;p++){
    const label=document.createElement('span'); label.className='chain-owner chain-player-'+p;
    label.textContent=`● ${pname(p)}`; legend.appendChild(label);
  }
  const list=document.getElementById('chain-cards');
  const scrollLeft=list.scrollLeft, scrollTop=list.scrollTop;
  const focusKey=document.activeElement?.dataset.chainKey;
  UI.hideHover(); list.replaceChildren();
  chain.forEach((it,i)=>{
    const entry=document.createElement('li'); entry.className='chain-entry chain-player-'+it.p;
    if(it.countered) entry.classList.add('chain-countered');
    const order=document.createElement('div'); order.className='chain-order'; order.textContent=`#${i+1} 적재`;
    if(i===chain.length-1){
      const next=document.createElement('span'); next.className='chain-next'; next.textContent='먼저 해결'; order.appendChild(next);
    }
    const owner=document.createElement('div'); owner.className='chain-owner'; owner.textContent=`사용: ${pname(it.p)}`;
    const c=chainCard(it);
    const title=document.createElement('h4'); title.textContent=(it.kind==='ability'?'능력 · ':'')+(c?.ko||it.srcName||'카드');
    entry.append(order,owner,title);
    if(c){
      const source=chainPreview(c,it.p,`source-${i}`); source.dataset.targetChainId=it.displayId;
      entry.appendChild(source);
    }
    if(it.kind==='ability' && it.ab?.label){
      const ability=document.createElement('p'); ability.className='chain-ability'; ability.textContent=it.ab.label; entry.appendChild(ability);
    }
    if(it.countered || (it.execAs!==undefined && it.execAs!==it.p)){
      const state=document.createElement('p'); state.className='chain-state';
      state.textContent=it.countered?'무효화됨':`현재 통제: ${pname(it.execAs)}`; entry.appendChild(state);
    }
    const targets=it.displayTargets || (it.target ? [snapshotChainTarget(it.target,chain)] : snapshotCastTargets(it.pre,it.preAb));
    const affected=it.displayAffected||[];
    const heading=document.createElement('div'); heading.className='chain-target-heading'; heading.textContent='지정 대상'; entry.appendChild(heading);
    if(targets.length) appendChainTargets(entry,targets,chain,`target-${i}`,'대상');
    else {
      const empty=document.createElement('p'); empty.className='chain-hint'; empty.textContent='적재 시 지정된 대상 없음'; entry.appendChild(empty);
    }
    if(affected.length){
      const appliedHeading=document.createElement('div'); appliedHeading.className='chain-target-heading chain-affected-heading';
      appliedHeading.textContent='적용 대상'; entry.appendChild(appliedHeading);
      appendChainTargets(entry,affected,chain,`affected-${i}`,'적용');
    }
    list.appendChild(entry);
  });
  if(focusKey){
    const focus=[...list.querySelectorAll('[data-chain-key]')].find(el=>el.dataset.chainKey===focusKey);
    (focus||document.getElementById('btn-chain-close')).focus({preventScroll:true});
  }
  list.scrollLeft=scrollLeft; list.scrollTop=scrollTop;
  UI.renderSelectedTargets?.();
};
// 보기 창에서 Tab/단축키가 뒤의 대상 선택이나 리플레이 조작으로 새지 않게 한다.
document.addEventListener('keydown',e=>{
  if(!chainIsOpen()) return;
  if(document.getElementById('card-zoom')?.style.display==='flex') return;
  e.stopImmediatePropagation();
  if(e.key==='Escape'){ e.preventDefault(); UI.hideChain(); return; }
  if(e.key==='Tab'){
    const buttons=[...document.querySelectorAll('#chain-panel button')];
    const first=buttons[0], last=buttons[buttons.length-1];
    if(e.shiftKey && (document.activeElement===first || !buttons.includes(document.activeElement))){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && (document.activeElement===last || !buttons.includes(document.activeElement))){ e.preventDefault(); first.focus(); }
  }
},true);

// ---------- 선택 프리미티브 (Promise 기반) ----------
// 한 전장 효과의 연속 선택이 끝날 때까지 출처를 유지한다. 게임 상태/선택값에는 포함하지 않는다.
let _battlefieldSource=null;
async function withBattlefieldSource(source,run){
  if(typeof SIM!=='undefined' && SIM.active) return run();
  const previous=_battlefieldSource;
  _battlefieldSource=source;
  try { return await run(); }
  finally { _battlefieldSource=previous; }
};
function appendBattlefieldSource(parent){
  if(!_battlefieldSource) return;
  const c=card(_battlefieldSource.n);
  const timing={onConquerHere:'점령 시',onHoldHere:'유지 시',onConquerEndTurn:'점령 효과 · 턴 종료 시',onFirstBeginning:'첫 개시 단계',
    onMoveFromHere:'이 전장에서 이동 시',onDefendHere:'방어 시'}[_battlefieldSource.event]||'전장 효과';
  const panel=document.createElement('div'); panel.className='battlefield-source';
  const preview=document.createElement('button'); preview.type='button'; preview.className='battlefield-source-card';
  preview.setAttribute('aria-label',c.ko+' 카드 확대');
  const img=document.createElement('img'); img.src=cardImgUrl(c.img,480); img.alt=c.ko;
  preview.appendChild(img); preview.onclick=()=>UI.showZoom(c);
  attachCardHover(preview,c);
  const info=document.createElement('div'); info.className='battlefield-source-info';
  const name=document.createElement('strong'); name.textContent=`「${c.ko}」 · ${timing}`;
  const effect=document.createElement('div'); effect.className='battlefield-source-text';
  effect.innerHTML=renderIcons(esc(c.tko||c.text||''));
  info.append(name,effect);
  // 결전 중인 전장의 효과라면 지금 맞붙은 양측 유닛을 함께 보여 준다 — 「약탈자의 거리」 방어 시 기지로 뺄 유닛을 고를 때
  // 어떤 유닛이 들어왔는지 보이지 않는다는 요청(2026-09-14). 표시 전용 — 선택값·게임 상태에는 관여하지 않는다.
  const sd=G && G.showdown;
  if(sd && G.bfs[sd.bfIdx] && G.bfs[sd.bfIdx].n===_battlefieldSource.n){
    const side=(p,role,icon)=>{
      const us=G.bfs[sd.bfIdx].units.filter(u=>u.ctrl===p);
      if(!us.length) return `${icon} ${esc(pname(p))}: 유닛 없음`;
      // 기절 유닛은 위력이 0이 되는 게 아니라 전투 피해에 기여하지 않을 뿐(룰 4181·4184) — 원래 위력을 보이고 '기절'을 붙인다
      const full=u=>{ try{ return might(u, role, {forKill:true}); }catch(e){ return u.m; } };
      const contrib=u=>{ try{ return might(u, role); }catch(e){ return u.m; } };
      return `${icon} ${esc(pname(p))} ${role==='attacker'?'공격':'방어'} ${us.map(u=>`${esc(unitName(u))}(${full(u)}${u.stunned?'·기절':''})`).join(', ')} · 전투 기여 합계 ${us.reduce((s,u)=>s+contrib(u),0)}`;
    };
    const combat=document.createElement('div'); combat.className='battlefield-source-combat';
    combat.innerHTML=[side(sd.attacker,'attacker','⚔'), side(sd.defender,'defender','🛡')].join('<br>');
    info.appendChild(combat);
  }
  panel.append(preview,info); parent.appendChild(panel);
}
let _resolver = null;
function settle(v){ if(_resolver){ const r=_resolver; _resolver=null; clearPicking(); r(v); } }
function clearPicking(){
  document.querySelectorAll('.targetable').forEach(e=>e.classList.remove('targetable'));
  const pa=document.getElementById('prompt-area');
  pa.innerHTML = G && G.state==='showdown'
    ? `<div class="prompt-title">${esc(pname(G.actingPlayer))}: [행동]/[반응] 사용 또는 패스</div>`
    : (G && G.winner===null ? `<div class="prompt-title">${esc(pname(G.turn))}의 행동 단계</div>` : '');
}


// 공개 정보는 양쪽에서 같은 순서로 보여 주고, 각 좌석의 확인을 모두 받은 뒤 진행한다.
UI.revealAurora = async function(p, revealed, unitIndex){
  if(replayLock()) return;
  const game=G, previousResolver=_resolver, previousPending=UI.unitSelectionPending;
  const lock=()=>{};
  _resolver=lock; UI.unitSelectionPending=true;
  hideMenu(); UI.hideHover();
  const panel=document.createElement('section'); panel.id='aurora-reveal';
  panel.setAttribute('aria-label','눈부신 오로라 공개 카드');
  const title=document.createElement('strong'); title.textContent=pname(p)+'의 눈부신 오로라';
  const note=document.createElement('div'); note.className='aurora-reveal-note';
  note.textContent='메인 덱 위에서부터 유닛이 나올 때까지 공개합니다';
  const list=document.createElement('div'); list.className='aurora-reveal-list';
  const footer=document.createElement('div'); footer.className='aurora-reveal-confirm';
  panel.append(title,note,list,footer);
  const viewer=NET.online?NET.seat:(typeof BOT!=='undefined' && BOT.active?opp(BOT.seat):UI._orient);
  document.getElementById('parea-'+opp(viewer)).appendChild(panel);
  updateButtons();
  let shown=false;
  const buttons=[], localResolvers=[];
  // 두 클라이언트가 애니메이션을 시작하기 전에 동일한 순서로 응답 슬롯을 등록한다.
  const confirmations=[0,1].map(seat=>{
    const button=document.createElement('button'); button.type='button'; button.disabled=true;
    const local=!NET.online || seat===NET.seat;
    const bot=!NET.online && typeof botIs==='function' && botIs(seat);
    button.textContent=pname(seat)+' · '+(local&&!bot?'공개 중':'확인 대기');
    footer.appendChild(button); buttons[seat]={button,local,bot};
    const interactive=()=>new Promise(resolve=>{
      localResolvers[seat]=resolve;
      button.onclick=()=>{
        if(!shown || button.disabled) return;
        button.disabled=true; button.textContent=pname(seat)+' · 확인 전달 중';
        resolve(true);
      };
    });
    const wait=NET.online?NET.choice(seat,interactive,v=>v,v=>v):interactive();
    return wait.then(()=>{
      button.disabled=true; button.classList.add('confirmed');
      button.textContent=pname(seat)+' · 확인 완료';
    });
  });
  try{
    for(let i=0;i<revealed.length;i++){
      const entry=document.createElement('div'); entry.className='aurora-reveal-entry';
      const label=document.createElement('span');
      label.textContent=(i+1)+'. '+(i===unitIndex?'배치할 유닛':'플레이 후 재활용');
      if(i===unitIndex) entry.classList.add('aurora-reveal-unit');
      entry.append(label,cardMiniEl(card(revealed[i]))); list.appendChild(entry);
      list.scrollLeft=list.scrollWidth;
      if(i<revealed.length-1) await new Promise(resolve=>setTimeout(resolve,450));
    }
    shown=true;
    note.textContent=unitIndex>=0
      ? '강조된 유닛을 추방한 뒤 비용 없이 플레이합니다. 두 플레이어가 확인하면 진행합니다.'
      : '유닛이 없습니다. 두 플레이어가 확인하면 공개한 카드를 재활용합니다.';
    for(let seat=0;seat<2;seat++){
      const {button,local,bot}=buttons[seat];
      if(bot) localResolvers[seat](true);
      else if(local){ button.disabled=false; button.textContent=pname(seat)+' · 확인'; }
    }
    UI.prompt('눈부신 오로라: 공개 카드 확인 중');
    await Promise.all(confirmations);
    note.textContent='두 플레이어 모두 확인했습니다';
    await new Promise(resolve=>setTimeout(resolve,450));
  }finally{
    panel.remove();
    if(G===game){
      if(_resolver===lock) _resolver=previousResolver;
      UI.unitSelectionPending=previousPending;
      updateButtons();
    }
  }
};

// ── 온라인 라우팅 래퍼 ──
// 내 좌석이면 인터랙티브, 상대 좌석이면 대기. 결과는 서버 에코로 양측 동시 해결.
let _turnGlowPick=null;
// 진행 중인 라우팅 선택 전부. 온라인 멀리건처럼 두 좌석의 선택이 동시에 시작해 어느 순서로든 끝나므로
// '이전 값 복원' 방식은 낡은 선택을 되살려 isPicking()이 영원히 참이 됐다 → 턴 종료·패스 버튼이 잠김 (제보 2026-09-20).
const _pendingRoutedPicks=new Set();
const _chainSoundPreparations=new Set();
UI.beginChainSoundPreparation=function(p){
  const preparation={game:G,p,targets:[]};
  _chainSoundPreparations.add(preparation);
  UI.playSpellStageSound?.('place');
  return ()=>{ _chainSoundPreparations.delete(preparation); UI.renderSelectedTargets(); };
};
// 선택 중인 대상만 표시한다. 체인에 적재된 displayTargets는 여기서 읽지 않는다.
const _effectTargetSelections=new Set();
UI.beginEffectTargetSelection=function(p){
  const selection={game:G,p,targets:[]};
  _effectTargetSelections.add(selection);
  return ()=>{ _effectTargetSelections.delete(selection); UI.renderSelectedTargets(); };
};
UI.recordEffectTarget=function(p,target){
  // 효과가 다른 주문/능력을 플레이시키는 동안에는 그 준비 단계가 대상을 집계한다.
  if((UI.spellStage?.game===G && UI.spellStage.p===p)
    || [..._chainSoundPreparations].some(x=>x.game===G && x.p===p)) return;
  const selection=[..._effectTargetSelections].reverse().find(x=>x.game===G && x.p===p);
  if(selection && target){ selection.targets.push(target); UI.renderSelectedTargets(); }
};
UI.previewCastTargets=function(p,targets){
  const draft=UI.spellStage;
  const preparation=draft?.game===G && draft.p===p && !draft.committed ? draft
    : [..._chainSoundPreparations].reverse().find(x=>x.game===G && x.p===p);
  if(preparation){ preparation.targets=targets; UI.renderSelectedTargets(); }
};
UI.renderSelectedTargets=function(){
  document.querySelectorAll('.chosen-target').forEach(el=>el.classList.remove('chosen-target'));
  document.querySelectorAll('.chosen-target-count').forEach(el=>el.remove());
  if(!G || G.winner!==null) return;
  const selections=[..._chainSoundPreparations,..._effectTargetSelections];
  const draft=UI.spellStage;
  if(draft && !draft.committed && !draft.cancelRequested && !draft.submitted) selections.push(draft);
  const counts=new Map();
  for(const selection of selections){
    if(selection.game!==G || !localControlsPlayer(selection.p)) continue;
    for(const target of selection.targets||[]){
      const selector=target.kind==='unit'?`#board [data-uid="${target.uid}"]`
        :target.kind==='battlefield'?`#bf-${target.bf}`
        :target.kind==='chain' && target.itemId!==undefined?`[data-target-chain-id="${target.itemId}"]`:null;
      if(!selector) continue;
      for(const el of document.querySelectorAll(selector)) counts.set(el,(counts.get(el)||0)+1);
    }
  }
  for(const [el,count] of counts){
    el.classList.add('chosen-target');
    const badge=document.createElement('span'); badge.className='chosen-target-count';
    badge.textContent=count>1?`대상 ×${count}`:'대상';
    badge.setAttribute('aria-label',`대상으로 ${count}회 선택됨`);
    el.appendChild(badge);
  }
};
async function routedPick(p, interactiveFn, serialize, deserialize){
  const pick={game:G,p,at:Date.now()};
  _pendingRoutedPicks.add(pick);
  _turnGlowPick=pick;
  updateTurnGlow();
  updateButtons();
  try{
    const draft=UI.spellStage;
    if(draft && draft.game===G && draft.p===p && !draft.committed){
      return await UI.routeSpellStagePick(draft,interactiveFn,serialize,deserialize);
    }
    const preparation=[..._chainSoundPreparations].some(x=>x.game===G && x.p===p);
    NET._nextChoiceLabel=UI._choiceLabel||null; UI._choiceLabel=null;   // 상대 화면 "선택 대기 중 — 무엇" 표시용
    const result=!NET.online ? await interactiveFn() : await NET.choice(p, interactiveFn, serialize, deserialize);
    if(preparation && pick.game===G && G.winner===null && result!==null && result!==undefined && localControlsPlayer(p))
      UI.playSpellStageSound?.('target');
    return result;
  } finally {
    _pendingRoutedPicks.delete(pick);
    _turnGlowPick=[..._pendingRoutedPicks].filter(x=>x.game===G).pop()||null;
    updateTurnGlow();
    updateButtons();
  }
}

// 유닛 선택 (보드에서 클릭)
UI.unitSelectionPending=false;
// 보드 선택 잠금은 실제로 이 자리에서 고르는 좌석에만 건다. 온라인에서 상대가 고르는 동안 대기 측까지 잠그면
// 항복·채팅·👁 보드 보기 등 아무것도 누를 수 없다 (routedPick은 상대 좌석이면 NET.choice로 결과만 기다린다).
function lockUnitSelection(p){ UI.unitSelectionPending = !(NET.online && p!==NET.seat); }
UI.pickUnitFrom = async function(p, candidates, promptText, optional){
  UI._choiceLabel=promptText;
  if(!candidates.length) return Promise.resolve(null);
  lockUnitSelection(p);
  try{
    const selected=await routedPick(p,
      ()=>_pickUnitLocal(p,candidates,promptText,optional),
      v=>v?{uid:v.uid}:null,
      d=>d?(candidates.find(u=>u.uid===d.uid)||everyUnit().find(u=>u.uid===d.uid)||null):null);
    if(selected) UI.recordEffectTarget(p,{kind:'unit',uid:selected.uid});
    return selected;
  }finally{
    UI.unitSelectionPending=false; UI.render(); UI.promptForState();
  }
};
function _pickUnitLocal(p, candidates, promptText, optional, otherOptions=[]){
  return new Promise(res=>{
    if(!candidates.length){ res(null); return; }
    _resolver=res;
    hideMenu(); closeModal(); UI.hideZoom(); clearTimeout(_lpTimer);
    _moveArmed=false; _moveSel.clear();
    _pickableUids = new Set(candidates.map(u=>u.uid));
    UI.render();
    const pa=document.getElementById('prompt-area');
    pa.innerHTML=`<div class="prompt-title">👉 ${esc(promptText||'강조된 유닛을 클릭하세요')}</div>`;
    const btns=document.createElement('div'); btns.className='prompt-btns';
    // 유닛과 다른 종류가 함께 후보인 효과도 팝업을 열지 않는다.
    // 별도 카드로 표시되지 않는 장착 도구/숨김 카드 등은 안내 영역에서 고른다.
    otherOptions.forEach(({option,index})=>{
      const button=document.createElement('button'); button.className='board-pick-alternative';
      const c=optionCard(option);
      if(c?.img){ const img=document.createElement('img'); img.src=cardImgUrl(c.img,120); img.alt=''; button.appendChild(img); }
      const label=document.createElement('span'); label.textContent=option.label; button.appendChild(label);
      button.onclick=()=>{ _pickableUids=null; settle({optionIndex:index}); UI.render(); };
      attachCardHover(button,c); btns.appendChild(button);
    });
    if(optional && !otherOptions.some(({option})=>option.v===null)){
      const skip=document.createElement('button'); skip.textContent=typeof optional==='string'?optional:'선택 안 함';
      skip.onclick=()=>{ _pickableUids=null; settle(null); UI.render(); };
      btns.appendChild(skip);
    }
    pa.appendChild(btns);
    // 전장 효과(히라나 수도원 등)의 출처 패널은 버튼 '아래'에 — 위에 두면 좁은 화면에서 [선택 안 함]이 패널에 밀려
    // 화면 밖으로 나가 "전장 카드만 보이고 아무것도 못 하는" 상태가 된다 (제보 2026-09-20)
    appendBattlefieldSource(pa);
    if(window.innerWidth<=820) setTimeout(()=>{ try{ pa.scrollIntoView({block:'start',behavior:'smooth'}); }catch(e){} }, 0);
  });
};
let _pickableUids = null;
UI.isPicking = ()=>!!_resolver || UI.unitSelectionPending || UI.placementPending
  || !!UI.spellStage || !!UI.spellStageSubmitting
  || !!(_turnGlowPick && _turnGlowPick.game===G);
// 지금 이 화면에서 실제로 답을 기다리는 프롬프트가 있는가 (보드 선택·배치·주문 준비·모달)
function liveLocalPrompt(){
  return !!_resolver || UI.unitSelectionPending || UI.placementPending || !!UI.spellStage || !!UI.spellStageSubmitting
    || document.getElementById('modal-overlay')?.style.display!=='none' || !!document.getElementById('placement-overlay');
}
// 온라인에서 게임 선택은 전부 NET.choice 안에서 돈다: 내 좌석의 로컬 프롬프트(_resolver·보드 선택·배치 선택)든 상대 좌석 대기든,
// 살아 있는 동안은 반드시 서버 응답을 기다리는 NET.pendingChoices 항목이 있다(등록이 프롬프트보다 먼저, 삭제는 응답 도착 때).
// 그 항목이 하나도 없는데 선택 표식(_turnGlowPick·_resolver·unitSelectionPending·placementPending)만 남아 있으면 낡은 표식이다 —
// 그대로 두면 isPicking()이 영원히 참이라 패스·턴 종료가 잠기고 손패 클릭은 "진행 중인 선택을 먼저 완료하세요"로 막힌다
// (제보 2026-09-23: 떠돌이 상인 점령 뒤 패스 불가·주문도 안 나감). 지우고 계속 진행한다.
// 봇전·핫시트는 봇의 지연 선택이 표식 없이 진행될 수 있어 손대지 않는다. 모달(항복 확인 등)은 선택 밖에서도 쓰므로 건드리지 않는다.
// 주의: 엔진 흐름 안(updateButtons/can*)에서 부르면 안 된다 — routedPick은 NET.choice 등록 전에 버튼을 갱신하므로 그 순간엔 '대기 없음'으로 보인다
// (1.0.91에서 그렇게 불러 온라인 손패 선택이 전부 손패 메뉴로 새던 회귀). 감시 타이머·클릭 핸들러에서만, 막 시작한 선택은 유예한다.
function healStaleRoutedPicks(){
  if(!NET.online || !G || G.winner!==null) return false;
  if(Object.keys(NET.pendingChoices||{}).length) return false;
  const now=Date.now();
  if([..._pendingRoutedPicks].some(x=>x.game===G && now-(x.at||0)<1500)) return false;   // 등록 직전/직후의 정상 선택
  const glow=!!(_turnGlowPick && _turnGlowPick.game===G);
  const local=!!_resolver || UI.unitSelectionPending || UI.placementPending;
  if(!glow && !local) return false;
  console.warn('stale pick state cleared', {glow, resolver:!!_resolver, unitSel:UI.unitSelectionPending, placement:UI.placementPending,
    reaction:!!_reactionPick, pending:_pendingRoutedPicks.size, state:G.state, acting:G.actingPlayer, seat:NET.seat});
  for(const x of [..._pendingRoutedPicks]) if(x.game===G) _pendingRoutedPicks.delete(x);
  _turnGlowPick=[..._pendingRoutedPicks].filter(x=>x.game===G).pop()||null;
  if(local){
    _resolver=null; _boardCardPick=null; _pickableUids=null; _reactionPick=null;
    UI.unitSelectionPending=false; UI.placementPending=false;
    document.getElementById('placement-overlay')?.remove();
    clearPicking();
    try{ UI.render(); UI.promptForState(); }catch(e){}
  }
  updateTurnGlow();
  return true;
}
// 패스가 막힌 이유(토스트·콘솔용). 막히지 않았으면 null.
UI.passBlockReason = ()=>{
  const sd=G?.showdown;
  if(!G || G.winner!==null) return '게임이 끝났습니다';
  if(G.state!=='showdown' || !sd) return '결전 중이 아닙니다';
  if(sd.resolvingItem) return '체인 항목을 해결하는 중입니다';
  if(sd.finalizingTriggers || sd.pendingTriggers?.length) return '전투 격발을 정리하는 중입니다';
  if(!localControlsPlayer(G.actingPlayer)) return pname(G.actingPlayer)+'의 차례입니다';
  if(UI.spellStage || UI.spellStageSubmitting) return '준비 중인 주문을 먼저 확인하거나 되돌려 주세요';
  if(UI.placementPending) return '배치 위치 선택을 먼저 마쳐 주세요';
  if(_resolver || UI.unitSelectionPending) return '진행 중인 선택을 먼저 완료해 주세요';
  if(NET.online && Object.keys(NET.pendingChoices||{}).length){
    const w=Object.values(NET.pendingChoices)[0]; return (w && w.p!==NET.seat ? pname(w.p)+'의 선택을 기다리는 중입니다' : '선택 응답을 기다리는 중입니다');
  }
  if(_turnGlowPick && _turnGlowPick.game===G) return '선택 처리가 끝나기를 기다리는 중입니다';
  return null;
};
function localControlsPlayer(p){
  if(NET.online) return p===NET.seat;
  return !(typeof botIs==='function' && botIs(p));
}
UI.canEndTurn = ()=>{
  return !!(G && G.winner===null && G.phase==='action' && G.state==='neutral'
    && !G._endingTurn && G.turn===G.actingPlayer && !pendingCombatMove()
    && !UI.isPicking() && localControlsPlayer(G.turn));
};
UI.canShowdownPass = ()=>{
  const sd=G?.showdown;
  return !!(G && G.winner===null && G.state==='showdown' && sd
    && !sd.resolvingItem && !sd.finalizingTriggers && !sd.pendingTriggers?.length
    && !UI.isPicking() && localControlsPlayer(G.actingPlayer));
};
// 선택창을 닫고 보드를 보여 주는 동안 다른 메뉴가 선택 안내를 덮지 않게 한다.
document.addEventListener('click',e=>{
  healStaleRoutedPicks();   // 낡은 선택 표식이 클릭을 삼키지 않게 먼저 지운다 (제보 2026-09-23: 손패 클릭이 먹통)
  if(UI.spellStage && e.target.closest('#spell-stage,#btn-endturn')) return;
  if(!UI.unitSelectionPending || e.target.closest('#prompt-area,#reaction-chain,#aurora-reveal,#card-zoom,#chain-overlay,#ctx-menu,.bf-scroll')) return;
  if(_suppressClick) return; // 롱프레스 정보 보기 뒤에 따라오는 클릭은 아래 전용 리스너가 막는다.
  if(e.target.closest('#btn-chain') || (canPassReaction() && e.target.closest('#btn-endturn'))) return;
  const choice=e.target.closest('[data-board-choice]');
  if(choice && _boardCardPick){
    e.preventDefault(); e.stopImmediatePropagation();
    const i=Number(choice.dataset.boardChoice);
    if(_reactionPick){ showReactionChoiceMenu(i,e); return; }
    _boardCardPick.finish(i); return;
  }
  const unit=e.target.closest('#board [data-uid]');
  if(unit && _pickableUids?.has(Number(unit.dataset.uid))) return;
  e.preventDefault(); e.stopImmediatePropagation();
},true);
document.addEventListener('contextmenu',e=>{
  if(!UI.unitSelectionPending || e.target.closest('#card-zoom,#chain-overlay')) return;
  e.preventDefault(); e.stopImmediatePropagation();
},true);
document.addEventListener('keydown',e=>{
  if(!UI.unitSelectionPending || e.key!=='Escape'
    || document.getElementById('card-zoom')?.style.display==='flex' || chainIsOpen()) return;
  e.preventDefault(); e.stopImmediatePropagation();
},true);

// 기존 옵션 번호와 봇 평가 정보를 그대로 보존하고 사람의 입력만 보드 클릭으로 받는다.
let _boardCardPick=null;
function optionBoardCard(o){
  if(o.boardCard) return o.boardCard;
  if(o.v?.t==='ugear') return {kind:'attached',uid:o.v.uid,index:o.v.gi};
  if(o.movement) return null;
  const u=optionUnit(o);
  return u?{kind:'unit',uid:u.uid}:null;
}
function boardCardElement(t){
  if(!t) return null;
  if(t.kind==='legend') return document.querySelector('#legend-'+t.p+' .card-mini');
  if(t.kind==='unit') return document.querySelector('#board [data-uid="'+t.uid+'"]');
  if(t.kind==='gear') return document.querySelector('#base-'+t.p+' [data-gear-index="'+t.index+'"]:not([data-equipped-uid])');
  if(t.kind==='hand') return document.querySelector('#hand-'+t.p+' [data-hand-index="'+t.index+'"]');
  if(t.kind==='hidden') return document.querySelector('[data-hidden-bf="'+t.bfIdx+'"][data-hidden-index="'+t.index+'"]');
  if(t.kind==='attached') return document.querySelector('[data-equipped-uid="'+t.uid+'"][data-gear-index="'+t.index+'"]');
  return null;
}
function highlightBoardCards(){
  if(!_boardCardPick) return;
  _boardCardPick.targets.forEach((t,i)=>{
    const el=boardCardElement(t); if(!el) return;
    el.classList.add('targetable'); el.dataset.boardChoice=i;
    el.setAttribute('role','button'); el.tabIndex=0;
    el.setAttribute('aria-label',_boardCardPick.options[i].label);
    el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}};
  });
}
function appendSelectableUnit(parent,u){
  parent.appendChild(unitEl(u));
  // 장착 도구도 유닛과 별도의 실제 대상으로 보여 준다. 선택이 끝나면 추가 표시를 없앤다.
  _boardCardPick?.targets.forEach(t=>{
    if(t?.kind!=='attached' || t.uid!==u.uid || u.gear[t.index]===undefined) return;
    const el=cardMiniEl(card(u.gear[t.index]));
    el.dataset.equippedUid=u.uid; el.dataset.gearIndex=t.index;
    el.querySelector('.cm-name').textContent=card(u.gear[t.index]).ko+' (장착: '+unitName(u)+')';
    parent.appendChild(el);
  });
}
function _pickCardOptionLocal(p,title,options,targets,cancel=true){
  return new Promise(res=>{
    hideMenu(); closeModal(); UI.hideZoom(); clearTimeout(_lpTimer);
    _moveArmed=false; _moveSel.clear(); _pickableUids=null;
    const finish=i=>{_boardCardPick=null;settle(i);UI.render();};
    _boardCardPick={options,targets,finish}; _resolver=res;
    UI.render(); UI.prompt(title); appendBattlefieldSource(document.getElementById('prompt-area'));
    if(_reactionPick){ document.getElementById('btn-endturn').style.display=''; document.getElementById('btn-pass').style.display='none'; }
    const btns=document.createElement('div'); btns.className='prompt-btns';
    options.forEach((o,i)=>{
      if(targets[i]) return;
      const b=document.createElement('button'); b.className='board-pick-alternative';
      const c=optionCard(o);
      if(c?.img){const img=document.createElement('img');img.src=cardImgUrl(c.img,120);img.alt='';b.appendChild(img);}
      const label=document.createElement('span');label.textContent=o.label;b.appendChild(label);
      b.onclick=()=>finish(i);attachCardHover(b,c);btns.appendChild(b);
    });
    if(cancel && !options.some(o=>o.v===null)){
      const b=document.createElement('button');b.textContent='취소';b.onclick=()=>finish(null);btns.appendChild(b);
    }
    document.getElementById('prompt-area').appendChild(btns);
  });
}
async function pickCardOption(p,title,options,targets,cancel=true){
  UI._choiceLabel=title;
  lockUnitSelection(p);
  try{
    const idx=await routedPick(p,()=>_pickCardOptionLocal(p,title,options,targets,cancel),v=>v,v=>v);
    return idx===null?null:options[idx].v;
  }finally{
    _boardCardPick=null; UI.unitSelectionPending=false; UI.render(); UI.promptForState();
  }
}
// 같은 시점에 생긴 여러 효과의 해결 순서를 보드 카드에서 한 번에 정한다.
// 선택한 카드를 다시 누르면 해제되며, 숫자는 먼저 해결할 순서다.
UI.pickBoardOrder = async function(p,title,options,targets){
  UI._choiceLabel=title;
  if(options.length<2) return options.map((_,i)=>i);
  UI.unitSelectionPending=!(NET.online && p!==NET.seat);
  try{
    return await routedPick(p,async()=>{
      const selected=[];
      while(true){
        const choices=options.map((o,i)=>({...o,v:i}));
        if(selected.length===options.length) choices.push({v:'done',label:'이 순서로 확정'});
        else choices.push({v:'default',label:selected.length?'나머지는 기본 순서로 진행':'순서 안 고르고 이대로 진행'});   // 순서를 몰라 멈추지 않게 (기본: 목록 순)
        if(selected.length) choices.push({v:'reset',label:'순서 초기화'});
        const choiceTargets=choices.map((_,i)=>i<options.length?targets[i]:null);
        const pending=_pickCardOptionLocal(p,
          `${title} — 강조된 카드를 먼저 해결할 순서대로 누른 뒤 확정하거나, 아래 버튼으로 바로 진행하세요 (${selected.length}/${options.length})`,choices,choiceTargets,false);
        selected.forEach((optionIndex,orderIndex)=>{
          const el=boardCardElement(targets[optionIndex]); if(!el) return;
          el.classList.add('selected');
          const badge=document.createElement('span'); badge.className='board-order-badge'; badge.textContent=orderIndex+1;
          el.appendChild(badge);
          el.setAttribute('aria-label',`${options[optionIndex].label}, ${orderIndex+1}번째 해결, 다시 누르면 해제`);
        });
        const picked=await pending;
        if(picked===null) continue;
        const choice=choices[picked].v;
        if(choice==='done') return selected;
        if(choice==='default') return [...selected, ...options.map((_,i)=>i).filter(i=>!selected.includes(i))];
        if(choice==='reset'){selected.length=0;continue;}
        const at=selected.indexOf(choice);
        if(at>=0) selected.splice(at,1); else selected.push(choice);
      }
    },v=>v,v=>v);
  }finally{_boardCardPick=null;UI.unitSelectionPending=false;UI.render();UI.promptForState();}
};

// 텍스트 안의 「카드명」에 호버 미리보기를 달아 el에 채운다.
// 로그(logEntryEl)와 같은 규칙이지만, 모달 안에서는 사이드 인스펙터가 오버레이에 가려지므로
// 모달 위에 뜨는 미리보기(attachCardHover의 #card-hover)를 쓴다.
// 예: 응수 창 제목 "「수렴 변이」 플레이 — [반응]으로 응수할까요?"의 카드명에 마우스를 올리면 효과가 보인다.
function cardifyInto(el, text){
  String(text).split(/(「[^」]+」)/).forEach(seg=>{
    const m=seg.match(/^「([^」]+)」$/);
    const c=m && nameToCard(m[1]);
    if(c){
      const span=document.createElement('span');
      span.className='log-card';
      span.textContent=seg;
      attachCardHover(span, c);
      el.appendChild(span);
    } else el.appendChild(document.createTextNode(seg));
  });
  return el;
}

// 옵션 선택 (인덱스 기반 동기화)
UI.pickOption = function(p, title, options, boardPick=false){
  UI._choiceLabel=title;
  if(boardPick==='placement') return pickPlacementOption(p,title,options);
  if(boardPick==='movement') return pickPlacementOption(p,title,options,true);
  if(boardPick==='battlefield') return pickPlacementOption(p,title,options,false,'선택');
  const targets=options.map(optionBoardCard), keys=targets.filter(Boolean).map(t=>JSON.stringify(t));
  if(keys.length && new Set(keys).size===keys.length) return pickCardOption(p,title,options,targets,boardPick!=='cardsRequired');
  return routedPick(p,
    async()=>{
      // 설정을 끈 사람만 확인창 대신 기본 선택을 보낸다. 온라인에서도 NET.choice 안에서 처리해야
      // 상대의 설정과 달라도 선택 순번과 결과가 양쪽에서 같고, 봇은 기존 정책을 그대로 사용한다.
      const skip=options.findIndex(o=>o.skipResourcePrompt);
      if(skip>=0 && !PLAY_OPTIONS.confirmResourceAbilities) return skip;
      if(!boardPick) return _pickOptionLocal(p,title,options);
      // 목적지가 고정된 이동은 보드에서 유닛만 선택한다.
      // 기존 옵션 인덱스를 반환해 온라인 동기화와 봇의 이동 평가를 유지한다.
      const candidates=everyUnit().filter(u=>options.some(o=>o.movement?.uid===u.uid));
      if(!candidates.length) return null;
      const unit=await _pickUnitLocal(p,candidates,title,options.some(o=>o.v===null));
      return unit ? options.findIndex(o=>o.movement?.uid===unit.uid) : null;
    },
    v=>v, v=>v
  ).then(idx=>idx===null?null:options[idx].v);
};
// 위치 선택도 기존 옵션 인덱스로 동기화한다. 보드 위 버튼은 표시와 입력만 담당한다.
UI.placementPending=false;
async function pickPlacementOption(p,title,options,movement=false,verb='배치'){
  UI._choiceLabel=title;
  UI.placementPending=true;
  let dispose=()=>{};
  try{
    const idx=await routedPick(p,()=>new Promise(res=>{
      hideMenu(); closeModal(); UI.hideZoom(); clearTimeout(_lpTimer);
      _moveArmed=false; _moveSel.clear();
      UI.render();
      const overlay=document.createElement('div'); overlay.id='placement-overlay';
      overlay.oncontextmenu=e=>e.preventDefault();
      overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');
      overlay.setAttribute('aria-label',title);
      const choices=[];
      let chosen=false;
      const finish=idx=>{
        if(chosen) return;
        chosen=true; overlay.querySelectorAll('button').forEach(b=>b.disabled=true);
        settle(idx);
      };
      _resolver=res;
      const addChoice=(zone,label,caption,select)=>{
        if(!zone) return;
        const button=document.createElement('button'); button.type='button'; button.className='placement-zone';
        button.setAttribute('aria-label',label); button.title=label;
        const text=document.createElement('span'); text.textContent=caption;
        button.appendChild(text); button.onclick=select;
        overlay.appendChild(button); choices.push({zone,button});
      };
      const center=document.createElement('div'); center.className='placement-center';
      const guide=document.createElement('span');
      const cancel=document.createElement('button'); cancel.type='button'; cancel.textContent='취소';
      const optional=!movement || options.some(o=>o.v===null);
      const candidates=movement?everyUnit().filter(u=>options.some(o=>o.movement?.uid===u.uid)):[];
      const back=document.createElement('button'); back.type='button'; back.textContent='유닛 다시 선택';
      cancel.onclick=()=>finish(null); center.append(guide,back);
      if(optional) center.append(cancel);
      overlay.appendChild(center);
      document.body.appendChild(overlay);
      const position=()=>{
        const origin=overlay.getBoundingClientRect();
        const sx=origin.width/overlay.clientWidth, sy=origin.height/overlay.clientHeight;
        for(const {zone,button} of choices){
          const r=zone.getBoundingClientRect();
          Object.assign(button.style,{left:(r.left-origin.left)/sx+'px',top:(r.top-origin.top)/sy+'px',width:r.width/sx+'px',height:r.height/sy+'px'});
        }
        const r=document.getElementById('center-info').getBoundingClientRect();
        center.style.left=(r.left+r.width/2-origin.left)/sx+'px';
        center.style.top=(r.top+r.height/2-origin.top)/sy+'px';
        center.style.width=Math.max(54,r.width/sx-6)+'px';
      };
      const keys=e=>{
        if(isRescueKey(e)) return;                                   // F5·F12·Ctrl+R·Ctrl+Shift+I는 언제나 통과
        if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(optional) finish(null);return;}
        if(e.key==='Tab'){
          e.preventDefault(); e.stopImmediatePropagation();
          const buttons=[...overlay.querySelectorAll('button:not(:disabled)')].filter(b=>b.getClientRects().length);
          if(buttons.length){const i=buttons.indexOf(document.activeElement);buttons[(i+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus({preventScroll:true});}
          return;
        }
        if(!overlay.contains(e.target) || !['Enter',' ','Shift'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();}
      };
      window.addEventListener('keydown',keys,true);
      window.addEventListener('resize',position);
      window.addEventListener('scroll',position,true);
      const observer=new ResizeObserver(position);
      const showStage=unit=>{
        observer.disconnect();
        choices.splice(0).forEach(({button})=>button.remove());
        back.hidden=!movement || !unit || candidates.length<2;
        guide.textContent=!movement?(verb==='배치'?'배치 위치 선택':title):unit?'이동할 위치 선택':'이동할 유닛 선택';
        if(movement && !unit){
          candidates.forEach(u=>addChoice(document.querySelector('#board [data-uid="'+u.uid+'"]'),
            unitLabel(u),'이 유닛 이동',()=>showStage(u)));
        }else{
          options.forEach((o,i)=>{
            if(movement && o.movement?.uid!==unit.uid) return;
            const dest=movement?o.movement.dest:o.v;
            const zone=document.getElementById(dest==='base'?'base-'+(movement?unit.ctrl:p):'bf-'+dest);
            const caption=movement?(o.movement.stay?'이동 없이 대상 선택':'여기로 이동'):(verb==='선택'?'이 전장 선택':o.label.startsWith('⚠')?'효과 허용 시 배치':'여기에 배치');
            addChoice(zone,o.label,caption,()=>finish(i));
          });
        }
        choices.forEach(({zone})=>observer.observe(zone));
        observer.observe(document.getElementById('center-info'));
        UI.prompt(guide.textContent+' — 강조된 곳을 누르세요.'+(optional?' 중앙에서 취소할 수 있습니다.':' 반드시 선택해야 합니다.'));
        position();
        (optional?cancel:choices[0]?.button)?.focus({preventScroll:true});
      };
      back.onclick=()=>showStage(null);
      dispose=()=>{
        observer.disconnect(); window.removeEventListener('keydown',keys,true);
        window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);
        overlay.remove(); if(_resolver===res) _resolver=null;
      };
      showStage(movement && candidates.length===1?candidates[0]:null);
    }),v=>v,v=>v);
    return idx===null ? null : options[idx].v;
  }finally{
    dispose(); UI.placementPending=false; UI.render(); UI.promptForState();
  }
}
// 눈에 잘 띄도록 중앙 모달로 표시한다 (배치 위치 선택 등을 사용자가 놓치지 않게)
function resourceAbilityText(ops){
  return ops.map(op=>{
    if(op.op==='addEnergy') return `⚡ 에너지 +${op.n}`;
    if(op.op==='addSpellEnergy') return `⚡ 주문 전용 에너지 +${op.n}`;
    if(op.op==='addSpellPower') return `✳️ 주문 전용 힘 +${op.n}`;
    return `${DOMAIN_ICON[op.dom]||'✳️'} ${DOMAIN_KO[op.dom]||'아무 영역'} 힘 +${op.n}`;
  }).join('\n');
}
function appendResourcePayment(box,p,payment){
  const c=card(payment.n);
  const panel=document.createElement('div'); panel.className='resource-payment';
  const preview=document.createElement('button'); preview.type='button'; preview.className='resource-payment-card';
  preview.setAttribute('aria-label',c.ko+' 카드 확대');
  const img=document.createElement('img'); img.src=cardImgUrl(artImg(c,p),280); img.alt=c.ko;
  preview.appendChild(img); preview.onclick=()=>UI.showZoom(c); attachCardHover(preview,c);
  const info=document.createElement('div'); info.className='resource-payment-info';
  const name=document.createElement('strong'); name.textContent=c.ko;
  const caption=document.createElement('div'); caption.className='modal-note'; caption.textContent='사용할 카드의 비용';
  const cost=document.createElement('div'); cost.className='resource-payment-cost';
  const badge=(label)=>{const el=document.createElement('span'); el.textContent=label; cost.appendChild(el);};
  badge(`⚡ 에너지 ${payment.energy}`);
  const counts=new Map();
  for(const pip of payment.pips) counts.set(pip,(counts.get(pip)||0)+1);
  for(const [pip,n] of counts){
    const label=pip==='Any' ? '✳️ 아무 영역' : pip.split('|').map(d=>`${DOMAIN_ICON[d]||''} ${DOMAIN_KO[d]||d}`).join(' 또는 ');
    badge(`${label} 힘 ${n}`);
  }
  info.append(caption,name,cost); panel.append(preview,info); box.appendChild(panel);
  const note=document.createElement('p'); note.className='modal-note';
  note.textContent='사용할 자원 카드를 선택하세요. 지금 필요한 자원을 만드는 카드만 표시됩니다.';
  box.appendChild(note);
}
function _pickOptionLocal(p, title, options, cancelLabel){
  if(options[0]?.setupOrder && UI.setupOrderLocal) return UI.setupOrderLocal(p,options);
  return new Promise(res=>{
    const box=document.getElementById('modal-box');
    box.innerHTML='';
    const payment=options.find(o=>o.resourcePayment)?.resourcePayment;
    const optionalTrash=options.some(o=>o.optionalTrash);
    const h=document.createElement('h3');
    cardifyInto(h, payment ? '자원 능력 사용 확인' : `👉 ${p===null?'':pname(p)+': '}${title}`);
    box.appendChild(h);
    appendBattlefieldSource(box);
    const content=document.createElement('div'); content.className=payment?'resource-layout':'option-content';
    const summary=document.createElement('div');
    if(payment){ appendResourcePayment(summary,p,payment); content.appendChild(summary); }
    const actions=document.createElement('div'); actions.className='modal-btns decision-actions';
    const btns=document.createElement('div'); btns.className='modal-btns';
    if(payment) btns.classList.add('resource-options');
    if(options.some(o=>optionCard(o))) btns.classList.add('card-options');
    const units=options.map(optionUnit);
    const unitSides=new Set(units.filter(Boolean).map(u=>u.ctrl));
    const unitOwners=new Set(units.filter(Boolean).map(u=>u.owner??u.ctrl));
    const showOwners=unitSides.size>1 || unitOwners.size>1 || units.some(u=>u && (u.owner??u.ctrl)!==u.ctrl);
    options.forEach((o,i)=>{
      const b=document.createElement('button'); b.className='primary'; b.type='button';
      if((o.v==='first' || o.v==='second') && options.some(x=>x.v==='first') && options.some(x=>x.v==='second'))
        b.dataset.setupOrder=o.v;
      const c=optionCard(o);
      if(c){
        b.classList.add('card-option');
        const art=document.createElement('span'); art.className='option-art';
        if(c.type==='Battlefield') art.classList.add('landscape');
        if(c.img){
          const img=document.createElement('img');
          img.src=cardImgUrl(c.img,280); img.alt=c.ko; img.draggable=false;
          img.onerror=()=>{ art.textContent=c.ko; };
          art.appendChild(img);
        } else art.textContent=c.ko;
        b.appendChild(art);
        const label=document.createElement('span'); label.className='option-label';
        label.textContent=payment && o.resourceOps ? `${c.ko}\n비용: ${o.resourceCost||'없음'}\n결과: ${resourceAbilityText(o.resourceOps)}` : o.label;
        b.appendChild(label);
        b.setAttribute('aria-label',label.textContent);
      } else {
        b.textContent=o.label;
        if(payment) b.classList.add('resource-payment-skip');
      }
      if(showOwners && units[i]){
        const u=units[i];
        const ownerText=unitChoiceOwner(u,p);
        const badge=document.createElement('span');
        badge.className='option-unit-owner '+(u.ctrl===p?'mine':'opponent');
        badge.textContent=ownerText;
        b.prepend(badge);
        b.setAttribute('aria-label',ownerText+' · '+o.label);
      }
      b.onclick=()=>{ closeModal(); res(i); };
      attachCardHover(b, c);
      (payment && !c ? actions : btns).appendChild(b);
    });
    if(!payment){
      const cancel=document.createElement('button'); cancel.textContent=cancelLabel||(options.some(o=>o.optionalTrash)?'사용 안 함':'취소');
      if(!optionalTrash) cancel.style.opacity=.6;
      cancel.onclick=()=>{ closeModal(); res(null); };
      (optionalTrash?actions:btns).appendChild(cancel);
    }
    content.appendChild(btns); box.appendChild(content);
    if(payment||optionalTrash) box.appendChild(actions);
    openModal();
  });
}

// 중립 응수 창 전용 선택 (pickOption과 동일 계약 — 봇이 별도 정책을 적용할 수 있게 이름 분리)
let _reactionPick=null;
let _showdownChainView=null;
function boardChainView(){
  if(!G || G.winner!==null || !G.showdown?.chain.length) _showdownChainView=null;
  if(_reactionPick) return _reactionPick;
  if(!G || G.winner!==null || G.state!=='showdown' || !G.showdown?.chain.length) return null;
  if(_showdownChainView?.showdown!==G.showdown)
    _showdownChainView={showdown:G.showdown,hidden:false};
  _showdownChainView.p=NET.online ? NET.seat
    : (typeof BOT!=='undefined' && BOT.active) ? opp(BOT.seat) : G.actingPlayer;
  return _showdownChainView;
}
function canPassReaction(){
  // 응수 창은 결전 종료 처리 중(정복 격발, G.state는 아직 'showdown')에도 열린다 — 상태로 막으면 패스가 안 돼 갇힌다(제보 2026-09-22: 불굴의 정신)
  return !!(_reactionPick && _boardCardPick && _resolver && G && G.winner===null
    && (!NET.online || _reactionPick.p===NET.seat));
}
function toggleBoardChain(){
  const view=boardChainView();
  if(!view){ if(chainIsOpen()) UI.hideChain(); else UI.showChain(); return; }
  view.hidden=!view.hidden;
  UI.hideHover(); renderReactionChain(); UI.updateChainView();
}

function reactionBoardTarget(p,o){
  if(o.v?.hand!==undefined) return {kind:'hand',p,index:o.v.hand,reveal:true};
  if(o.v?.hidden){
    const {bf,index}=o.v.hidden;
    return G.bfs[bf]?.hiddenCards[index]?.by===p ? {kind:'hidden',bfIdx:bf,index} : null;
  }
  const src=o.v?.ab?.src;
  if(src?.kind==='legend') return {kind:'legend',p};
  if(src?.kind==='unit') return {kind:'unit',uid:src.u.uid};
  if(src?.kind==='gear') return {kind:'gear',p,index:G.players[p].gear.indexOf(src.g)};
  return null;
}
function renderReactionChain(){
  document.getElementById('reaction-chain')?.remove();
  const view=boardChainView();
  if(!view || view.hidden) return;
  const chain=visibleChain();
  const panel=document.createElement('section'); panel.id='reaction-chain';
  panel.setAttribute('aria-label','현재 주문, 지정 대상과 적용 대상');
  const list=document.createElement('div'); list.className='reaction-chain-list';
  // 가장 먼저 해결할 주문을 앞에 두고 나머지는 가로로 넘겨 본다.
  [...chain].reverse().forEach((it,ri)=>{
    const i=chain.length-1-ri, c=chainCard(it);
    const entry=document.createElement('article'); entry.className='reaction-chain-entry chain-player-'+it.p;
    const heading=document.createElement('strong');
    heading.textContent=`${ri===0?'먼저 해결':'대기'} #${i+1}: ${c?.ko||it.srcName||'능력'}${it.countered?' (무효화됨)':''}`;
    const cards=document.createElement('div'); cards.className='reaction-chain-cards';
    if(c){
      const source=chainPreview(c,it.p,`reaction-source-${i}`); source.dataset.targetChainId=it.displayId;
      cards.appendChild(source);
    }
    const arrow=document.createElement('span'); arrow.className='reaction-arrow'; arrow.textContent='→'; cards.appendChild(arrow);
    const targets=it.displayTargets || (it.target ? [snapshotChainTarget(it.target,chain)] : snapshotCastTargets(it.pre,it.preAb));
    const affected=it.displayAffected||[];
    if(targets.length) targets.forEach((t,j)=>cards.appendChild(chainTargetEl(t,chain,`reaction-target-${i}-${j}`)));
    else {
      const note=document.createElement('span'); note.className='chain-hint';
      note.textContent=affected.length?'지정 대상 없음 · 자동 적용':'지정 대상 없음'; cards.appendChild(note);
    }
    if(affected.length){
      const label=document.createElement('span'); label.className='reaction-effect-label'; label.textContent='적용 대상'; cards.appendChild(label);
      affected.forEach((t,j)=>cards.appendChild(chainTargetEl(t,chain,`reaction-affected-${i}-${j}`)));
    }
    entry.append(heading,cards); list.appendChild(entry);
  });
  panel.appendChild(list);
  document.getElementById('parea-'+opp(view.p)).appendChild(panel);
  UI.renderSelectedTargets?.();
}
UI.pickReaction = async function(p, title, options){
  UI._choiceLabel='응수 여부';
  lockUnitSelection(p);
  try{
    const idx=await routedPick(p,()=>{
      _reactionPick={p,hidden:false,passIndex:options.length};
      const targets=options.map(o=>reactionBoardTarget(p,o));
      // 한 카드에 능력이 여러 개면 추가 능력을 이름 붙은 버튼으로 제공한다.
      const seen=new Set();
      targets.forEach((t,i)=>{if(!t)return;const key=JSON.stringify(t);if(seen.has(key))targets[i]=null;else seen.add(key);});
      return _pickCardOptionLocal(p,options.length?'강조된 손패나 필드 카드로 반응하거나 패스하세요':'사용 가능한 반응이 없습니다. 주문과 대상을 확인한 뒤 패스하세요',options,targets,false);
    },v=>v,v=>v);
    return idx===null || idx===options.length ? null : options[idx].v;
  }finally{
    _reactionPick=null; _boardCardPick=null; UI.unitSelectionPending=false;
    UI.render(); UI.promptForState();
  }
};

// 확인 (예/아니오)
UI.confirmP = function(p, text, previewCard, context){
  UI._choiceLabel=text;
  if(context?.boardCard) return confirmBoardCard(p,text,previewCard,context.boardCard);
  return routedPick(p, ()=>_confirmLocal(p,text,previewCard,context), v=>v, v=>v);
};
async function confirmBoardCard(p,text,previewCard,target){
  lockUnitSelection(p);
  try{
    const options=[{v:true,label:text,card:previewCard},{v:false,label:'소모하지 않음'}];
    return await routedPick(p,async()=>{
      const i=await _pickCardOptionLocal(p,text,options,[target,null],false);
      return i===0;
    },v=>v,v=>v);
  }finally{
    _boardCardPick=null;UI.unitSelectionPending=false;UI.render();UI.promptForState();
  }
}
function _confirmLocal(p, text, previewCard, context){
  return new Promise(res=>{
    const box=document.getElementById('modal-box');
    const d=context?.decision;
    box.innerHTML='';
    const heading=document.createElement('h3'); heading.textContent=d?.title||pname(p);
    box.appendChild(heading);
    appendBattlefieldSource(box);
    const content=document.createElement('div'); content.className='decision-content';
    if(previewCard){
      const cards=Array.isArray(previewCard)?previewCard:[previewCard];
      UI.inspect(cards[0]);
      const wrap=document.createElement('div'); wrap.className='decision-source';
      cards.forEach(c=>{
        const preview=document.createElement('button'); preview.type='button';
        preview.className='decision-preview'; preview.setAttribute('aria-label',c.ko+' 카드 확대');
        const img=document.createElement('img'); img.src=cardImgUrl(c.img,280); img.alt=c.ko;
        preview.appendChild(img); preview.onclick=()=>UI.showZoom(c); attachCardHover(preview,c);
        const name=document.createElement('strong'); name.textContent=c.ko;
        wrap.append(preview,name);
      });
      content.appendChild(wrap);
    }
    const body=document.createElement('div'); body.className='decision-details';
    if(d){
      for(const [label,value] of [['비용',d.cost],['결과',d.result],['참고',d.note]]){
        if(!value) continue;
        const row=document.createElement('section'); row.className='decision-row';
        const caption=document.createElement('small'); caption.textContent=label;
        const detail=document.createElement('div'); cardifyInto(detail,value); row.append(caption,detail); body.appendChild(row);
      }
    }else{ body.classList.add('modal-copy'); cardifyInto(body,text); }
    content.appendChild(body); box.appendChild(content);
    const btns=document.createElement('div'); btns.className='modal-btns decision-actions';
    const y=document.createElement('button'); y.className='primary'; y.textContent=d?.accept||'예';
    y.onclick=()=>{ closeModal(); res(true); };
    const n=document.createElement('button'); n.textContent=d?.decline||'아니오';
    n.onclick=()=>{ closeModal(); res(false); };
    btns.append(n,y); box.appendChild(btns); openModal();
  });
}

// 숫자 선택
UI.pickNumber = function(p, text, min, max){
  UI._choiceLabel=text;
  return routedPick(p, ()=>_pickNumberLocal(p,text,min,max), v=>v, v=>v);
};
function _pickNumberLocal(p, text, min, max){
  return new Promise(res=>{
    const box=document.getElementById('modal-box');
    box.innerHTML=`<h3>👉 ${esc(pname(p))}: ${esc(text)}</h3>`;
    appendBattlefieldSource(box);
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
  if(NET.online && NET.spectating) return NET.spectView==='both' || NET.spectView===p;   // 관전자: 고른 쪽만
  if(replayLock()) return true;
  // 효과로 공개된 손패(파괴 공작 등): 공개를 시킨 쪽에게는 상대 손패 전체가 앞면 (선택 후보만이 아니라)
  if(G && G._revealHand && G._revealHand.p===p && (!NET.online || NET.seat===G._revealHand.by)) return true;
  if(NET.online) return p === NET.seat;
  if(botHandHidable(p)) return !!UI.peekBotHand;
  return true;
}

// 숨김 카드는 소유자 화면에만 앞면을 흐리게 보여 준다. 상대에게 만드는 노드에는
// 카드 데이터와 확대 이벤트를 붙이지 않아 우클릭, 길게 누르기, 정보 패널로도 정체가 새지 않는다.
function hiddenCardFaceUp(p){
  if(replayLock()) return true;
  if(NET.online) return p===NET.seat;
  if(typeof BOT!=='undefined' && BOT.active) return p!==BOT.seat;
  return !!G && p===G.actingPlayer;
}
function hiddenCardPlayable(h,bfIdx){
  if(!G || G.winner!==null || !h || h.by!==G.actingPlayer) return false;
  if(G.state==='neutral'){
    if(G.phase!=='action' || G.turn!==h.by) return false;
  }else if(G.state!=='showdown') return false;
  const bf=G.bfs[bfIdx];
  if(!bf || !bf.hiddenCards.includes(h)) return false;
  if(bf.units.some(u=>u.ctrl!==h.by && unitFx(u).blockReveal)) return false;
  if(h.turn===G.turnCount && G.turn===h.by) return false;
  if(playRestriction(card(h.n),h.by,true,bfIdx)) return false;
  return card(h.n).type!=='Unit' || unitPlayLocationOptions(h.by,h.n).some(x=>x.v===bfIdx);
}
function hiddenBattlefieldCardEl(h,bfIdx,hiddenIndex){
  if(!hiddenCardFaceUp(h.by)){
    const back=document.createElement('div');
    back.className='card-mini card-back hidden-card battlefield-hidden-card';
    back.setAttribute('role','img');
    back.setAttribute('aria-label','상대의 숨김 카드');
    back.title='상대의 숨김 카드';
    return back;
  }
  const c=card(h.n);
  const el=cardMiniEl(c,{owner:h.by});
  el.classList.add('battlefield-hidden-card','hidden-card-owned');
  el.dataset.hiddenBf=bfIdx;
  el.dataset.hiddenIndex=hiddenIndex;
  const playable=hiddenCardPlayable(h,bfIdx);
  if(playable) el.classList.add('playable');
  el.setAttribute('aria-label',`${c.ko}, 내가 숨겨 둔 카드. ${playable?'클릭하여 비용 없이 사용. ':''}우클릭하거나 길게 눌러 정보 확인`);
  el.title='내 숨김 카드, 우클릭하거나 길게 눌러 정보 확인';
  el.onclick=e=>{
    if(e.altKey) return;
    e.stopPropagation();
    showHiddenCardMenu(h,bfIdx,hiddenIndex,e);
  };
  return el;
}

// 선택자의 손패에서 직접 선택. 온라인 결과는 기존 손패 인덱스 그대로다.
UI.pickHandCard = function(p, title){
  if(!G.players[p].hand.length) return Promise.resolve(null);
  return pickCardOption(p,title,G.players[p].hand.map((n,i)=>({v:i,label:card(n).ko,n})),
    G.players[p].hand.map((_,i)=>({kind:'hand',p,index:i})),false);
};
UI.pickBuffs = async function(p,title,candidates){
  UI._choiceLabel=title;
  lockUnitSelection(p);
  try{
    return await routedPick(p,async()=>{
      const counts=new Map();
      while(true){
        const available=candidates.filter(u=>(counts.get(u.uid)||0)<u.buff);
        const total=[...counts.values()].reduce((a,b)=>a+b,0);
        const options=available.map(u=>({v:u.uid,label:unitName(u)+' 버프 1개 소모'}));
        options.push({v:'done',label:total?`${total}개 소모 확인`:'소모하지 않음'});
        if(total) options.push({v:'reset',label:'선택 초기화'});
        const pending=_pickCardOptionLocal(p,`${title} — 유닛을 누를 때마다 1개 선택 (${total}개)`,options,
          options.map((o,i)=>i<available.length?{kind:'unit',uid:o.v}:null),false);
        candidates.forEach(u=>{
          const n=counts.get(u.uid)||0;
          const el=boardCardElement({kind:'unit',uid:u.uid});
          if(n && el){el.classList.add('selected');el.querySelector('.cm-buff').textContent=`${u.buff} → ${u.buff-n}`;}
        });
        const idx=await pending, choice=options[idx].v;
        if(choice==='done') return [...counts].map(([uid,count])=>({uid,count}));
        if(choice==='reset') counts.clear();
        else counts.set(choice,(counts.get(choice)||0)+1);
      }
    },v=>v,v=>v);
  }finally{_boardCardPick=null;UI.unitSelectionPending=false;UI.render();UI.promptForState();}
};

function setModalPeeking(peeking){
  const ov=document.getElementById('modal-overlay');
  const box=document.getElementById('modal-box');
  const toggle=document.getElementById('modal-visibility-toggle');
  // 보드 보기는 눈 버튼으로만 빠져나온다 — 버튼이 숨겨져 있으면 들어가는 순간 화면이 잠긴다
  if(peeking && (toggle.hidden || ov.style.display==='none')) peeking=false;
  ov.classList.toggle('modal-peeking',peeking);
  document.body.classList.toggle('modal-peeking',peeking);
  box.inert=peeking;
  if(peeking) box.setAttribute('aria-hidden','true'); else box.removeAttribute('aria-hidden');
  toggle.setAttribute('aria-pressed',String(peeking));
  toggle.title=peeking?'선택창 다시 보기':'선택창 숨기기';
  toggle.setAttribute('aria-label',toggle.title);
  UI.hideHover();
}
function modalPeeking(){
  const ov=document.getElementById('modal-overlay');
  if(!ov.classList.contains('modal-peeking')) return false;
  // 오버레이는 닫혔는데 클래스만 남으면 캡처 리스너가 화면 전체를 영원히 삼킨다 — 여기서 풀어 준다
  if(ov.style.display==='none'){ setModalPeeking(false); return false; }
  return true;
}
// 눈 버튼을 실제로 누를 수 있는가 (숨겨지지 않았고 뷰포트 안에 있다)
function peekToggleReachable(){
  const t=document.getElementById('modal-visibility-toggle');
  if(!t || t.hidden || !t.offsetParent) return false;
  const r=t.getBoundingClientRect();
  return r.width>0 && r.right>0 && r.bottom>0 && r.left<innerWidth && r.top<innerHeight;
}
// 어떤 키가 눌리든 앱을 되살릴 수 있어야 한다 — 새로고침·개발자 도구는 절대 삼키지 않는다
function isRescueKey(e){
  if(e.key==='F5' || e.key==='F12') return true;
  const mod=e.ctrlKey||e.metaKey;
  return mod && (e.key==='r' || e.key==='R' || (e.shiftKey && (e.key==='i' || e.key==='I')));
}
// 투명한 오버레이는 그대로 입력을 차단한다. 뒤의 공개 카드 데이터만 상세보기로 전달한다.
function peekCardAt(x,y){
  return document.elementsFromPoint(x,y).find(el=>el._card && el.closest('#game-screen'))?._card||null;
}
document.addEventListener('click',e=>{
  if(!modalPeeking() || e.target.closest('#modal-visibility-toggle, #btn-modal-chain, #chain-overlay, #card-zoom')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  // 눈 버튼이 화면 밖이거나 숨겨져 있으면 빠져나올 길이 없다 — 어디를 눌러도 선택창을 복원한다
  if(!peekToggleReachable()){ setModalPeeking(false); return; }
  const c=peekCardAt(e.clientX,e.clientY); if(c) UI.showZoom(c);
},true);
document.addEventListener('contextmenu',e=>{
  if(!modalPeeking() || e.target.closest('#btn-modal-chain, #chain-overlay, #card-zoom')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const c=peekCardAt(e.clientX,e.clientY); if(c) UI.showZoom(c);
},true);
document.addEventListener('pointermove',e=>{
  if(!modalPeeking() || e.target.closest('#modal-visibility-toggle, #btn-modal-chain, #chain-overlay, #card-zoom')) return;
  const c=peekCardAt(e.clientX,e.clientY); if(c) UI.inspect(c);
});
document.addEventListener('keydown',e=>{
  if(!modalPeeking() || e.target.closest('#chain-overlay, #card-zoom')) return;
  if(isRescueKey(e)) return;                                   // F5·F12·Ctrl+R·Ctrl+Shift+I는 언제나 통과
  if(e.target.closest('#modal-visibility-toggle, #btn-modal-chain') && ['Enter',' ','Tab'].includes(e.key)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if(e.key==='Escape'){
    // 확대창이 떠 있으면 그것만 닫고, 아니면 보드 보기를 끝내고 선택창을 되돌린다
    const zoom=document.getElementById('card-zoom');
    if(zoom && zoom.style.display==='flex') UI.hideZoom(); else setModalPeeking(false);
    return;
  }
  document.getElementById('modal-visibility-toggle').focus();
},true);
document.addEventListener('focusin',e=>{
  if(modalPeeking() && !e.target.closest('#modal-visibility-toggle, #btn-modal-chain, #chain-overlay, #card-zoom'))
    document.getElementById('modal-visibility-toggle').focus();
});
function openModal(){
  const ov=document.getElementById('modal-overlay');
  setModalPeeking(false);
  const toggle=document.getElementById('modal-visibility-toggle');
  toggle.hidden=!document.getElementById('game-screen').offsetParent;
  toggle.onclick=()=>{ setModalPeeking(!modalPeeking()); toggle.focus(); };
  ov.style.display='flex'; delete ov.dataset.dismiss;   // 기본: 닫기 불가(선택 대기 모달 보호)
  document.getElementById('modal-box').scrollTop=0;
  document.body.classList.add('modal-open');
  hideMenu();                                          // 열려 있던 선택 메뉴가 모달 위에 남지 않게
  UI.updateChainView();
}
function closeModal(){ setModalPeeking(false); UI.hideHover(); document.getElementById('modal-overlay').style.display='none'; document.body.classList.remove('modal-open','mulligan-open'); }
// 정보성 모달(도움말/밴 리스트/대회 덱 등): 모바일 뒤로 가기로 닫아도 안전함을 표시
function markModalDismissable(){ document.getElementById('modal-overlay').dataset.dismiss='1'; }

// 멀리건: 교체할 카드 다중 선택 (게임 시작 시)
UI.pickMulligan = function(p){
  UI._choiceLabel='멀리건';
  return routedPick(p, ()=>_pickMulliganLocal(p), v=>v, v=>v);
};
function _pickMulliganLocal(p){
  return new Promise(res=>{
    const P=G.players[p], box=document.getElementById('modal-box');
    box.innerHTML=`<header class="mulligan-heading"><span class="mulligan-order">${G.turn===p?'선공':'후공'}</span><h3>${esc(pname(p))}의 시작 손패</h3><p>최대 2장 교체</p></header>`;
    const wrap=document.createElement('div'); wrap.className='mulligan-grid';
    const sel=new Set(), cards=[];
    const btns=document.createElement('div');btns.className='modal-btns decision-actions mulligan-actions';
    const count=document.createElement('span'); count.className='mulligan-count';count.setAttribute('aria-live','polite');
    const ok=document.createElement('button'); ok.type='button';ok.className='primary';
    const update=()=>{
      count.textContent=`${sel.size} / 2장 선택`;
      ok.textContent=sel.size?`선택한 ${sel.size}장 교체`:'이대로 시작';
      cards.forEach((el,i)=>{el.classList.toggle('selected',sel.has(i));el.setAttribute('aria-pressed',String(sel.has(i)));});
    };
    P.hand.forEach((n,i)=>{
      const el=cardMiniEl(card(n));el.classList.add('mulligan-card');el.setAttribute('role','button');el.tabIndex=0;
      el.setAttribute('aria-label',card(n).ko+' 교체 선택');
      const badge=document.createElement('span');badge.className='mulligan-selected';badge.textContent='✓ 교체';el.appendChild(badge);
      const toggle=()=>{
        const wasSelected=sel.has(i);
        if(wasSelected) sel.delete(i);
        else if(sel.size<2) sel.add(i);
        else {UI.toast('최대 2장까지 선택할 수 있습니다','warn');return;}
        update();
        if(typeof UI.playMulliganSelectionSound==='function') UI.playMulliganSelectionSound(!wasSelected);
      };
      el.onclick=toggle;el.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();toggle();}};
      // 멀리건에서는 카드 위에 마우스를 올려도 정보 패널을 띄우지 않는다.
      // 우클릭과 길게 누르기 확대는 유지해 필요한 경우에만 상세 정보를 확인한다.
      el._card=card(n); attachZoom(el); cards.push(el);wrap.appendChild(el);
    });
    ok.onclick=()=>{closeModal();res([...sel]);};
    btns.append(count,ok);box.append(wrap,btns);update();
    document.body.classList.add('mulligan-open');
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

// ---------- 대체 일러스트 ----------
// 같은 카드의 다른 그림. 규칙(3장 제한·밴·검증)은 전부 카드 번호 기준이라 여기는 표시용이다.
// owner를 알면 그 사람이 자기 덱에서 고른 그림을, 모르면 미리보기 문맥(덱 편집기)을 따른다.
let ART_PREVIEW = null;              // 덱 편집기에서 편집 중인 덱의 arts
function artIndex(n, owner){
  if(owner!==undefined && owner!==null && typeof G!=='undefined' && G && G.players
     && G.players[owner] && G.players[owner].arts) return G.players[owner].arts[n] | 0;
  return ART_PREVIEW ? (ART_PREVIEW[n] | 0) : 0;
}
// 카드의 표시용 이미지 URL (고른 대체 일러스트가 없으면 기본 그림)
function artImg(c, owner){
  if(!c) return undefined;
  const i = artIndex(c.n, owner);
  return (i > 0 && c.alts && c.alts[i-1]) ? c.alts[i-1] : c.img;
}
// 카드가 고를 수 있는 그림 전부 (0번이 기본)
function artList(c){ return c ? [c.img, ...(c.alts || [])].filter(Boolean) : []; }

// ---------- 카드 미니 요소 ----------
// 카드 배경 이미지 — CSS background-image는 실패해도 아무 신호가 없어, 이미지가 막힌 환경(엣지 추적 방지·광고 차단·CDN 장애)
// 에서는 이름도 없는 빈 상자만 남았다(제보 2026-09-17, 엣지 덱 편집기). URL마다 한 번만 Image로 확인해 실패하면 .noimg를
// 붙여 카드 이름을 크게 보여 준다. 결과는 URL별로 기억하므로 같은 카드가 수백 번 그려져도 요청은 한 번뿐이다.
const _bgImgState=new Map();   // url → 'ok' | 'bad' | 'loading'
function setCardBg(el, url){
  el.style.backgroundImage=`url("${url}")`;
  const st=_bgImgState.get(url);
  if(st==='bad'){ el.classList.add('noimg'); return; }
  if(st!==undefined) return;
  _bgImgState.set(url,'loading');
  const im=new Image();
  im.onload=()=>_bgImgState.set(url,'ok');
  im.onerror=()=>{
    _bgImgState.set(url,'bad');
    const key=`url("${url}")`;
    document.querySelectorAll('.card-mini').forEach(x=>{ if(x.style.backgroundImage===key) x.classList.add('noimg'); });
  };
  im.src=url;
}
function cardMiniEl(c, opts={}){
  const el=document.createElement('div');
  el.className='card-mini';
  const _mi=artImg(c, opts.owner);
  if(_mi) setCardBg(el, cardImgUrl(_mi,280));
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
  if(u.stunned){
    el.classList.add('stunned');
    const stunned=document.createElement('div');
    stunned.className='cm-stunned';
    stunned.textContent='기절';
    stunned.title='기절 상태: 전투 피해 기여는 0이지만 현재 위력은 그대로 표시됩니다.';
    stunned.setAttribute('aria-label', stunned.title);
    el.appendChild(stunned);
  }
  if(_pickableUids && _pickableUids.has(u.uid)) el.classList.add('targetable');
  if(_moveSel.has(u.uid)) el.classList.add('selected');
  if(pendingCombatMove()?.uids.has(u.uid)){
    el.classList.add('move-pending');
    const badge=document.createElement('div'); badge.className='cm-move-pending'; badge.textContent='대기';
    el.appendChild(badge);
  }
  if(u.isToken){
    el.style.background='linear-gradient(135deg,#2a3a2a,#1a2a1a)';
  } else {
    const _ui=artImg(c, u.owner!==undefined?u.owner:u.ctrl);
    if(_ui) setCardBg(el, cardImgUrl(_ui,280));
  }
  const name=document.createElement('div'); name.className='cm-name'; name.textContent=unitName(u);
  el.appendChild(name);
  const m=document.createElement('div');
  const baseM=(u.isToken?u.tokenMight:(c.m||0));
  // 기절은 전투 기여만 0으로 만든다. 카드 위에는 기절 직전과 같은 현재 위력을 표시한다.
  const curM=might(u, combatRoleOf(u), {forKill:true});
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
  const canDrag = canArrangeMove(u.ctrl) && !u.ex && !u.stunned;
  if(canDrag){
    // PC도 게임 안에서 드래그 수명을 관리한다. 브라우저 기본 드래그가 입력을
    // 붙잡거나 보드 재렌더로 dragend 대상이 사라지는 경로를 사용하지 않는다.
    attachMouseMoveDrag(el,u);
    attachTouchDrag(el,
      ()=>G.winner===null && G.state==='neutral' && G.phase==='action' && G.turn===u.ctrl
        && !u.ex && !u.stunned && !_resolver && !_pickableUids
        && !(typeof REPLAY!=='undefined' && REPLAY.viewing)
        && !(typeof botIs==='function' && botIs(u.ctrl)) && (!NET.online || NET.seat===u.ctrl),
      zone=>moveDropAllowed(u,zone),
      zone=>dropMove(u.uid,zone._dropDest));
  }
  return el;
}

// ---------- 드래그 앤 드롭 이동 ----------
let _dragHand=null;
function attachMouseMoveDrag(el,u){
  el.draggable=false;
  el.addEventListener('dragstart',e=>e.preventDefault());
  el.addEventListener('pointerdown',e=>{
    if(e.pointerType!=='mouse' || e.button!==0 || e.altKey || !canArrangeMove(u.ctrl)) return;
    const start={x:e.clientX,y:e.clientY}, rect=el.getBoundingClientRect();
    const events=new AbortController(), opts={capture:true,signal:events.signal};
    let active=false, ghost=null;
    const clear=()=>{
      events.abort(); ghost?.remove();
      el.classList.remove('hand-dragging'); clearDropHints(); clearTimeout(_lpTimer);
    };
    const suppressReleaseClick=()=>{
      const block=event=>{ event.preventDefault(); event.stopImmediatePropagation(); };
      window.addEventListener('click',block,true);
      // pointerup 뒤 같은 입력에서 발생하는 click만 막는다. 다음 클릭은 정상 처리한다.
      setTimeout(()=>window.removeEventListener('click',block,true),0);
    };
    window.addEventListener('pointermove',event=>{
      if(event.pointerId!==e.pointerId) return;
      if(!canArrangeMove(u.ctrl) || !el.isConnected){ clear(); return; }
      if(!active && Math.hypot(event.clientX-start.x,event.clientY-start.y)<6) return;
      event.preventDefault();
      if(!active){
        active=true; clearTimeout(_lpTimer); hideMenu(); UI.hideZoom();
        ghost=el.cloneNode(true); ghost.removeAttribute('data-uid');
        ghost.className='card-mini touch-drag-preview'; ghost.setAttribute('aria-hidden','true');
        ghost.style.width=el.offsetWidth+'px'; ghost.style.height=el.offsetHeight+'px';
        document.body.appendChild(ghost); el.classList.add('hand-dragging');
      }
      const pos=fixedLayoutSpace(event.clientX-(start.x-rect.left),event.clientY-(start.y-rect.top));
      ghost.style.left=pos.x+'px'; ghost.style.top=pos.y+'px';
      clearDropHints();
      const zone=document.elementFromPoint(event.clientX,event.clientY)?.closest('.base-zone,.battlefield');
      if(moveDropAllowed(u,zone)) zone.classList.add('drop-hint');
    },opts);
    window.addEventListener('pointerup',event=>{
      if(event.pointerId!==e.pointerId) return;
      const zone=document.elementFromPoint(event.clientX,event.clientY)?.closest('.base-zone,.battlefield');
      clear();
      if(!active) return;
      event.preventDefault(); suppressReleaseClick();
      if(moveDropAllowed(u,zone)) dropMove(u.uid,zone._dropDest);
    },opts);
    window.addEventListener('pointercancel',clear,opts);
    window.addEventListener('blur',clear,opts);
    window.addEventListener('keydown',event=>{
      if(event.key!=='Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); clear();
      // Escape로 취소한 뒤 마우스를 놓아도 유닛 선택을 토글하지 않는다.
      window.addEventListener('pointerup',suppressReleaseClick,{capture:true,once:true});
    },opts);
  });
}
function canDragHand(p,idx,n,champZone=false){
  return G && G.winner===null && !UI.isPicking() && !pendingCombatMove()
    && (champZone ? G.players[p].champInZone && G.players[p].champN===n : G.players[p].hand[idx]===n)
    && !(typeof REPLAY!=='undefined' && REPLAY.viewing)
    && !(typeof botIs==='function' && botIs(p)) && (!NET.online || NET.seat===p)
    && (G.state!=='showdown' || G.actingPlayer===p) && !playRestriction(card(n),p,false);
}
function handDropAllowed(el,hand){
  if(card(hand.n).type==='Spell') return el?.id==='center-info';
  return el && (el._dropDest!=='base' || el.id==='base-'+hand.p)
    && canPlayCardAt(hand.p,hand.n,el._dropDest);
}
function dropHandCard(hand,el){
  if(!canDragHand(hand.p,hand.idx,hand.n,hand.champZone)) return;
  if(!handDropAllowed(el,hand)){ UI.toast('이 카드는 그 위치에 플레이할 수 없습니다','warn'); return; }
  const opts=card(hand.n).type==='Spell'&&PLAY_OPTIONS.spellStage?{stageSpell:true}:{playLoc:el._dropDest};
  if(hand.champZone) opts.champZone=true;
  NET.dispatch({k:'play',p:hand.p,handIdx:hand.idx,opts},()=>playCardFromHand(hand.p,hand.idx,opts));
}
function attachHandDrag(el,p,idx,n,champZone=false){
  if(!['Unit','Gear','Spell'].includes(card(n).type) || !canDragHand(p,idx,n,champZone)) return;
  const hand={p,idx,n,champZone};
  el.draggable=true;
  el.classList.add('hand-draggable');
  el.ondragstart=e=>{
    if(!canDragHand(p,idx,n,champZone)){ e.preventDefault(); return; }
    clearTimeout(_lpTimer); hideMenu(); _dragHand=hand;
    e.dataTransfer.setData('text/plain','hand:'+idx); e.dataTransfer.effectAllowed='move';
    if(card(n).type==='Spell') document.getElementById('center-info').classList.add('drop-hint');
  };
  el.ondragend=()=>{ _dragHand=null; clearDropHints(); };
  attachTouchDrag(el,()=>canDragHand(p,idx,n,champZone),zone=>handDropAllowed(zone,hand),zone=>dropHandCard(hand,zone));
}

// 보드 이동·손패 플레이 모두 터치 즉시 이동을 추적한다. 멈춰서 꾹 누르면 기존 확대를 사용한다.
function attachTouchDrag(el,canStart,allowed,drop){
  el.classList.add('touch-draggable');
  // 터치에서도 같은 플레이 경로를 사용하며, 짧은 탭과 꾹 누르기 확대는 유지한다.
  let touch=null;
  let ghost=null;
  const clear=()=>{
    touch=null; ghost?.remove(); ghost=null;
    el.classList.remove('hand-dragging'); clearDropHints(); clearTimeout(_lpTimer);
  };
  const finish=e=>{
    if(!touch) return;
    const point=[...e.changedTouches].find(t=>t.identifier===touch.id);
    if(!point) return;
    const active=touch.active;
    const zone=document.elementFromPoint(point.clientX,point.clientY)?.closest('.base-zone,.battlefield,#center-info');
    clear();
    if(active){
      e.preventDefault();
      if(e.type==='touchend' && zone && canStart() && allowed(zone)) drop(zone);
    }
  };
  el.addEventListener('touchstart',e=>{
    if(e.touches.length!==1){ clear(); return; }
    if(!canStart()) return;
    const point=e.touches[0];
    const rect=el.getBoundingClientRect();
    touch={id:point.identifier,x:point.clientX,y:point.clientY,dx:point.clientX-rect.left,dy:point.clientY-rect.top,active:false};
  },{passive:true});
  el.addEventListener('touchmove',e=>{
    if(!touch) return;
    const point=[...e.touches].find(t=>t.identifier===touch.id);
    if(!point || (!touch.active && Math.hypot(point.clientX-touch.x,point.clientY-touch.y)<6)) return;
    if(!canStart() || document.getElementById('card-zoom')?.style.display==='flex'){ clear(); return; }
    touch.active=true; clearTimeout(_lpTimer); hideMenu(); e.preventDefault();
    if(!ghost){
      ghost=el.cloneNode(true); ghost.removeAttribute('data-uid'); ghost.removeAttribute('draggable');
      ghost.className='card-mini touch-drag-preview'; ghost.setAttribute('aria-hidden','true');
      ghost.style.width=el.offsetWidth+'px'; ghost.style.height=el.offsetHeight+'px';
      document.body.appendChild(ghost);
    }
    const pos=fixedLayoutSpace(point.clientX-touch.dx,point.clientY-touch.dy);
    ghost.style.left=pos.x+'px'; ghost.style.top=pos.y+'px';
    el.classList.add('hand-dragging'); clearDropHints();
    const zone=document.elementFromPoint(point.clientX,point.clientY)?.closest('.base-zone,.battlefield,#center-info');
    if(allowed(zone)) zone.classList.add('drop-hint');
  },{passive:false});
  el.addEventListener('touchend',finish,{passive:false});
  el.addEventListener('touchcancel',finish,{passive:false});
}
function clearDropHints(){ document.querySelectorAll('.drop-hint').forEach(e=>e.classList.remove('drop-hint')); }
function attachDropZone(el, dest){
  el._dropDest=dest;
  el.ondragover=(ev)=>{
    if(_dragHand){
      ev.preventDefault();
      const allowed=handDropAllowed(el,_dragHand);
      ev.dataTransfer.dropEffect=allowed?'move':'none'; el.classList.toggle('drop-hint',!!allowed);
    }
  };
  el.ondragleave=()=>el.classList.remove('drop-hint');
  el.ondrop=(ev)=>{
    ev.preventDefault(); el.classList.remove('drop-hint');
    if(_dragHand){ const hand=_dragHand; _dragHand=null; clearDropHints(); dropHandCard(hand,el); return; }
  };
}
function dropMove(uid, dest){
  const u=everyUnit().find(x=>x.uid===uid);
  if(!u) return;
  const p=u.ctrl;
  if(!canArrangeMove(p)){ UI.toast('지금은 이동할 수 없습니다','warn'); return; }
  const pending=pendingCombatMove();
  if(pending){
    if(dest===pending.dest) prepareCombatMove(p,[u],dest);
    else if(pending.uids.has(uid) && dest===u.loc) toggleCombatMover(u);
    else UI.toast('대기 전장에 추가하거나 원래 위치로 빼는 이동만 가능합니다','warn');
    return;
  }
  // 드래그한 유닛이 다중 선택에 포함돼 있으면 선택된 유닛 전부 함께 이동
  let units=[u];
  const confirm=_moveArmed || (_moveSel.size && _moveSel.has(uid));
  if(_moveSel.size && _moveSel.has(uid)){
    units=everyUnit().filter(x=>_moveSel.has(x.uid));
  }
  _moveArmed=false; _moveSel.clear(); updateButtons();
  requestUnitMove(p,units,dest,confirm);
}
function combatRoleOf(u){
  if(!G.showdown || u.loc!==G.showdown.bfIdx) return null;
  return u.ctrl===G.showdown.attacker?'attacker':'defender';
}

// ---------- 인스펙터 ----------
// 카드 상세 HTML (사이드바 인스펙터·덱 편집기 상세 영역 공용)
UI.cardInfoHTML = function(c, owner){
  const kwNote = ((c.text||'').match(/\[([A-Za-z-]+ ?\d*)\]/g)||[])
    .map(k=>k.replace(/[\[\]]/g,'').replace(/ \d+$/,''))
    .filter((v,i,a)=>a.indexOf(v)===i)
    .map(k=>KEYWORDS_KO[k]?`<div style="font-size:11px;color:#9aa4bd">· <b>[${KEYWORDS_KO[k].ko}]</b> ${KEYWORDS_KO[k].desc}</div>`:'')
    .join('');
  return `
    ${artImg(c,owner)?`<img class="${c.type==='Battlefield'?'landscape':''}" src="${cardImgUrl(artImg(c,owner),280)}" alt="">`:''}
    <div class="insp-name">${esc(c.ko)}</div>
    <div class="insp-name-en">${esc(c.name)} · #${c.n}</div>
    ${isBanned(c.n)?`<div class="ban-flag" style="font-size:12px">🚫 밴 카드 (${esc(BANLIST.region)})</div>`:''}
    <div class="insp-type">${esc(typeLine(c))}${c.m!==null&&c.m!==undefined?` · 위력 ${c.m}`:''}${c.e!==null&&c.e!==undefined?` · 비용 ${c.e}${c.p?'+힘'+c.p:''}`:''}</div>
    <div class="insp-text">${renderIcons(esc(c.tko||c.text||'(효과 없음)'))}</div>
    ${kwNote}
    ${c.tags&&c.tags.length?`<div class="insp-tags">태그: ${c.tags.map(esc).join(', ')}</div>`:''}
  `;
};
UI.inspect = function(c, owner){
  document.getElementById('inspector').innerHTML = UI.cardInfoHTML(c, owner);
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
  if(!c || window.matchMedia('(hover: none)').matches) return;
  let el = document.getElementById('card-hover');
  if(!el){ el = document.createElement('div'); el.id = 'card-hover'; document.body.appendChild(el); }
  if(el._for !== c){ el.innerHTML = UI.cardInfoHTML(c); el._for = c; }
  el.style.display = 'block';
  const sp = fixedLayoutSpace(x, y);
  const pos = hoverPlace(sp.x, sp.y, el.offsetWidth || 240, el.offsetHeight || 480,
                         sp.width, sp.height);
  el.style.left = pos.left + 'px';
  el.style.top  = pos.top  + 'px';
};
// 화면 배율(<html>의 CSS zoom)이 걸려 있으면 마우스 좌표(화면 기준)와
// fixed 요소의 left/top(확대 전 레이아웃 기준)이 서로 다른 자를 쓴다.
// 팝업이 커서를 따라오도록 좌표와 뷰포트 크기를 레이아웃 좌표계로 환산한다.
function fixedLayoutSpace(x, y){
  const z = parseFloat(getComputedStyle(document.documentElement).zoom);
  const s = (Number.isFinite(z) && z > 0) ? z : 1;
  return { x: x/s, y: y/s, width: window.innerWidth/s, height: window.innerHeight/s };
}

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
  if(o.v?.hidden){
    const h=G.bfs[o.v.hidden.bf]?.hiddenCards[o.v.hidden.index];
    if(h) return card(h.n);
  }
  if(o.n !== undefined && o.n !== null){ try { return card(o.n) || null; } catch(e){ return null; } }
  return null;
}
// 카드 번호/이름은 같은 유닛끼리 중복된다. 선택지가 가리키는 실제 유닛 UID로 구분한다.
function optionUnit(o){
  const uid=o.movement?.uid ?? o.returnHand?.uid ?? o.v?.u?.uid ?? o.v?.uid;
  if(uid===undefined || typeof G==='undefined' || !G) return null;
  return everyUnit().find(u=>u.uid===uid)||null;
}
function unitChoiceOwner(u,p){
  const side=u.ctrl===p?'내 유닛':'상대 유닛';
  const owner=u.owner??u.ctrl;
  return side+' · '+pname(u.ctrl)+(owner!==u.ctrl?' (원 소유자: '+pname(owner)+')':'');
}

// ---------- 폐기장 목록 ----------
// 폐기 더미를 클릭하면 안에 뭐가 있는지 순서와 함께 보여 준다 (폐기장은 공개 정보).
// 번호 = 버려진 순서 (1이 가장 먼저, 마지막 번호가 가장 최근 = 더미 맨 위).
function showTrashList(p){
  if(!G) return;
  const ov=document.getElementById('modal-overlay');
  if(ov.style.display!=='none') return;          // 선택 대기 모달을 덮어쓰지 않는다
  const arr=G.players[p].trash;
  const box=document.getElementById('modal-box');
  box.innerHTML=`<h3>🗑 ${esc(pname(p))}의 폐기장 — ${arr.length}장</h3>
    <div class="modal-note">
    번호는 버려진 순서입니다 (1 = 가장 먼저, ${arr.length||1} = 가장 최근 · 더미 맨 위)</div>`;
  if(!arr.length){
    box.innerHTML+='<div style="color:#5a6a90;padding:14px 4px">비어 있습니다</div>';
  } else {
    const wrap=document.createElement('div'); wrap.className='modal-cards';
    arr.forEach((n,i)=>{
      const el=cardMiniEl(card(n));
      const b=document.createElement('div'); b.className='cm-order'; b.textContent=i+1;
      el.appendChild(b);
      attachCardHover(el, card(n));              // 모달 안이라 인스펙터 대신 호버 미리보기
      wrap.appendChild(el);
    });
    box.appendChild(wrap);
  }
  const btns=document.createElement('div'); btns.className='modal-btns';
  const close=document.createElement('button'); close.textContent='닫기'; close.onclick=closeModal;
  btns.appendChild(close); box.appendChild(btns);
  openModal(); markModalDismissable();
}
window.addEventListener('DOMContentLoaded', ()=>{
  [0,1].forEach(p=>{
    const el=document.getElementById('trash-'+p);
    if(el){ el.title='클릭: 폐기장 내용 보기'; el.addEventListener('click', ()=>showTrashList(p)); }
  });
  // ── 채팅 (온라인 대전 전용 — 버튼/팝업 표시 여부는 updateButtons가 제어) ──
  const chatBtn=document.getElementById('btn-chat');
  if(chatBtn) chatBtn.addEventListener('click', ()=>{
    const pop=document.getElementById('chat-pop');
    if(pop && pop.style.display!=='none') chatPopClose(); else chatPopOpen();
  });
  const chatX=document.getElementById('chat-pop-close');
  if(chatX) chatX.addEventListener('click', chatPopClose);
  const chat=document.getElementById('chat-input');
  if(chat) chat.addEventListener('keydown', e=>{
    e.stopPropagation();                       // 게임 단축키(Esc 메뉴 등)와 분리
    if(e.key==='Escape'){ chatPopClose(); return; }
    if(e.key!=='Enter') return;
    const text=chat.value.trim();
    if(!text || !NET.online) return;
    chat.value='';
    NET.send({t:'chat', msg:text.slice(0,200)});
    // 서버 릴레이는 발신자에게도 에코가 오지만, P2P는 에코가 없어 직접 표시한다
    if(typeof P2P!=='undefined' && P2P.active) chatShow(P2P.myName||'나', text, true);
  });
});

// ── 채팅 표시 ──
// 수신 경로: 서버 릴레이(net.js 'chat' 에코) / P2P 데이터채널 → NET.onChat
// 무시하기(ESC 메뉴): 수신을 숨기고 입력창도 감춘다 — localStorage로 유지
UI.chatMuted = (localStorage.getItem('rb_chat_mute') === 'on');
UI.setChatMuted = function(v){
  UI.chatMuted = !!v;
  try{ localStorage.setItem('rb_chat_mute', v ? 'on' : 'off'); }catch(e){}
};
// 대화는 로그와 분리된 팝업(#chat-pop)에만 표시. 팝업이 닫혀 있을 때 수신하면
// 내용 없이 레드닷(#chat-dot)만 켠다 — 열면 꺼짐
const CHAT={ msgs:[] };
function chatRender(){
  const box=document.getElementById('chat-pop-msgs'); if(!box) return;
  box.innerHTML='';
  for(const m of CHAT.msgs){
    const d=document.createElement('div'); d.className='chat-msg'+(m.mine?' mine':'');
    const b=document.createElement('b'); b.textContent=m.from+': ';
    d.appendChild(b); d.appendChild(document.createTextNode(m.msg));   // textContent — HTML 삽입 차단
    box.appendChild(d);
  }
  box.scrollTop=box.scrollHeight;
}
function chatPopOpen(){
  const pop=document.getElementById('chat-pop'); if(!pop) return;
  pop.style.display='flex';
  const dot=document.getElementById('chat-dot'); if(dot) dot.style.display='none';
  chatRender();
  const inp=document.getElementById('chat-input'); if(inp) inp.focus();
}
function chatPopClose(){
  const pop=document.getElementById('chat-pop'); if(pop) pop.style.display='none';
}
function chatShow(from, msg, mine){
  CHAT.msgs.push({from, msg, mine});
  if(CHAT.msgs.length>200) CHAT.msgs.shift();
  const pop=document.getElementById('chat-pop');
  if(pop && pop.style.display!=='none') chatRender();
  else if(!mine){ const dot=document.getElementById('chat-dot'); if(dot) dot.style.display=''; }
}
NET.onChat = function(m){
  if(UI.chatMuted) return;                       // 무시하기 — 수신 자체를 버린다
  if(!m || typeof m.msg!=='string' || !m.msg.trim()) return;
  const msg=m.msg.slice(0,200);
  const myNames=[NET.userId, (typeof P2P!=='undefined'&&P2P.active)?P2P.myName:null].filter(Boolean);
  let from=m.from;
  const mine=from!=null && myNames.includes(from);
  if(!from) from=(typeof P2P!=='undefined'&&P2P.active&&P2P.peerName) || '상대';
  chatShow(String(from).slice(0,20), msg, mine);
};

// ---------- 카드 확대 (롱프레스 / Alt+클릭) ----------
UI.showZoom = function(c, owner){
  if(!c) return;
  hideMenu(); // 열려 있던 컨텍스트 메뉴는 닫는다
  let ov = document.getElementById('card-zoom');
  const wasOpen = ov?.style.display === 'flex';
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
  const zoomArt = artImg(c,owner);
  const statBits = [];
  if(c.m!==null && c.m!==undefined) statBits.push(`위력 ${c.m}`);
  if(c.e!==null && c.e!==undefined) statBits.push(`비용 ${c.e}${c.p?'+힘'+c.p:''}`);
  ov.innerHTML = `
    <div class="cz-box" role="dialog" aria-label="카드 상세 설명">
      <div class="cz-toolbar">
        <span>카드 상세 설명</span>
        <button type="button" class="cz-close" aria-label="카드 설명 닫기">닫기 <span aria-hidden="true">×</span></button>
      </div>
      <div class="cz-body">
      ${zoomArt?`<img class="cz-img" src="${cardImgUrl(zoomArt,280)}" alt="${esc(c.ko||c.name||'카드 이미지')}">`:'<div class="cz-noimg">🃏</div>'}
      <div class="cz-info">
        <div class="cz-name">${esc(c.ko||'')}</div>
        <div class="cz-en">${esc(c.name||'')}${c.n?` · #${c.n}`:''}</div>
        ${c.n&&isBanned(c.n)?`<div class="ban-flag" style="font-size:14px;margin-bottom:6px">🚫 밴 카드 (${esc(BANLIST.region)})</div>`:''}
        <div class="cz-type">${esc(typeLine(c))}${statBits.length?' · '+statBits.join(' · '):''}</div>
        <div class="cz-text">${renderIcons(esc(c.tko||c.text||'(효과 없음)'))}</div>
        ${kwNote}
        ${c.tags&&c.tags.length?`<div class="cz-tags">태그: ${c.tags.map(esc).join(', ')}</div>`:''}
        <div id="cz-arts" class="cz-arts"></div>
        <div class="cz-hint">위쪽 닫기 버튼 · 바깥 클릭 · Esc로 닫기</div>
      </div>
      </div>
    </div>`;
  // 기본(작은) 이미지를 즉시 표시하고, 확대본을 정상적으로 받은 경우에만 교체한다.
  const zoomImage = ov.querySelector('.cz-img');
  if(zoomImage && zoomArt){
    const fullUrl = cardImgUrl(zoomArt);
    if(fullUrl!==cardImgUrl(zoomArt,280)){
      const fullImage = new Image();
      fullImage.onload = ()=>{ zoomImage.src=fullUrl; };
      fullImage.src = fullUrl;
    }
  }
  UI.renderZoomArts(c);   // 편집기에서 열었으면 일러스트 선택 버튼이 붙는다
  ov.querySelector('.cz-close').addEventListener('click', UI.hideZoom);
  ov.querySelector('.cz-box').addEventListener('click', e=>e.stopPropagation()); // CSP가 인라인 onclick 차단 → 리스너로 연결
  ov.style.display = 'flex';
  if(!wasOpen) UI.playCardPreviewSound?.('open');
};
// 편집기에서 확대해 보는 동안 이 카드의 일러스트를 바꾼다.
// onPick(인덱스)을 주면 그 카드에 대해 선택 UI가 나타난다.
UI.zoomArtPicker = null;      // { n, get(), set(i) } — 덱 편집기가 채운다
UI.renderZoomArts = function(c){
  const box=document.getElementById('cz-arts');
  if(!box) return;
  const picker=UI.zoomArtPicker;
  const list=artList(c);
  if(!picker || picker.n!==c.n || list.length<2){ box.innerHTML=''; return; }
  const cur=picker.get()|0;
  box.innerHTML='<div class="cz-arts-title">일러스트 선택 ('+list.length+'종)</div>';
  const row=document.createElement('div'); row.className='cz-arts-row';
  list.forEach((url,i)=>{
    const b=document.createElement('button');
    b.className='cz-art'+(i===cur?' on':'');
    b.style.backgroundImage='url("'+cardImgUrl(url,280)+'")';
    b.title=(i===0?'기본 일러스트':'대체 일러스트 '+i);
    b.onclick=()=>{ picker.set(i); UI.showZoom(c); };
    row.appendChild(b);
  });
  box.appendChild(row);
};

UI.hideZoom = function(){
  const ov = document.getElementById('card-zoom');
  if(!ov || ov.style.display !== 'flex') return;
  ov.style.display = 'none';
  UI.playCardPreviewSound?.('close');
};

// 카드 요소에 롱프레스/Alt+클릭 확대를 연결
let _lpTimer = null, _suppressClick = false;
function attachZoom(el){
  el.classList.add('card-zoom-trigger');
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
  el.addEventListener('touchcancel', cancel);
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
  if(_suppressClick){
    _suppressClick=false;
    // 기기에 따라 롱프레스 뒤 click이 생략된다. 다음 닫기 터치까지 막지 않는다.
    if(e.target.closest('#card-zoom .cz-close')) return;
    e.stopImmediatePropagation(); e.preventDefault();
  }
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
  if(typeof REPLAY!=='undefined' && REPLAY.viewing){ REPLAY.close(); return; }   // 리플레이 중 Esc = 리플레이 종료
  const gs=document.getElementById('game-screen');
  if(gs && gs.offsetParent!==null && typeof G!=='undefined' && G && typeof openSystemMenu==='function')
    openSystemMenu();
});

// ---------- 유닛 클릭 ----------
let _moveSel = new Set();
let _moveArmed = false;
// 확인 전에는 보드 표시만 바꾼다. 실제 위치, 탈진, 격발, 온라인 액션과 리플레이는 확정 시 한 번만 처리한다.
let _combatMove = null;
function pendingCombatMove(){
  if(_combatMove && (_combatMove.game!==G || G.winner!==null || replayLock()
    || G.state!=='neutral' || G.phase!=='action' || G.turn!==_combatMove.p)) _combatMove=null;
  return _combatMove;
}
function canArrangeMove(p){
  return G && G.winner===null && G.state==='neutral' && G.phase==='action'
    && !UI.spellStage && !UI.spellStageSubmitting
    && G.turn===p && G.actingPlayer===p && !_resolver && !_pickableUids && !UI.placementPending && !UI.unitSelectionPending && !replayLock()
    && !(typeof botIs==='function' && botIs(p)) && (!NET.online || NET.seat===p)
    && !pendingCombatMove()?.action;
}
function moveProblem(p,u,dest){
  if(u.ctrl!==p) return '상대 유닛';
  if(u.ex) return '탈진';
  if(u.loc===dest) return '이미 그 위치';
  if(dest!=='base' && !G.bfs[dest]) return '잘못된 전장';
  if(u.loc!=='base' && dest!=='base' && !effKw(u).ganking) return '[개입] 없음';
  if(u.loc!=='base' && dest==='base' && G.bfs[u.loc].n===BF_STATIC.NO_RETREAT) return '이 전장에선 후퇴 불가';
  return null;
}
function moveDropAllowed(u,zone){
  if(!u || !zone || !canArrangeMove(u.ctrl) || (zone._dropDest==='base' && zone.id!=='base-'+u.ctrl)) return false;
  const move=pendingCombatMove(), dest=zone._dropDest;
  if(move?.uids.has(u.uid)) return dest===u.loc;
  return (!move || dest===move.dest) && !moveProblem(u.ctrl,u,dest);
}
function moveDisplayLoc(u){
  const move=pendingCombatMove();
  return move?.uids.has(u.uid) ? move.dest : u.loc;
}
function combatMoveWillFight(p,dest){
  if(G.manual || dest==='base') return false;
  const bf=G.bfs[dest];
  return !!bf && (bf.controller!==p || bf.units.some(u=>u.ctrl!==p));
}
function prepareCombatMove(p,units,dest){
  if(!canArrangeMove(p) || !units.length) return;
  const move=pendingCombatMove();
  if(move && move.dest!==dest){ UI.toast('대기 중인 목적지의 이동 유닛만 변경할 수 있습니다','warn'); return; }
  for(const u of units){
    const why=moveProblem(p,u,dest);
    if(why){ UI.toast(`${unitName(u)}: ${why}`,'warn'); return; }
  }
  if(!move) _combatMove={game:G,p,dest,uids:new Set(),action:null};
  const added=units.filter(u=>!_combatMove.uids.has(u.uid));
  units.forEach(u=>_combatMove.uids.add(u.uid));
  if(added.length && combatMoveWillFight(p,dest)) UI.playUnitCombatMovementSound?.('combat',added.length);
  _moveArmed=false; _moveSel.clear(); hideMenu();
  UI.render(); UI.promptForState();
}
function toggleCombatMover(u){
  const move=pendingCombatMove();
  if(!move || !canArrangeMove(u.ctrl)) return;
  if(!move.uids.has(u.uid)){ prepareCombatMove(move.p,[u],move.dest); return; }
  move.uids.delete(u.uid);
  if(combatMoveWillFight(move.p,move.dest)) UI.playUnitCombatMovementSound?.('bench',1);
  if(!move.uids.size) _combatMove=null;
  UI.render(); UI.promptForState();
}
function requestUnitMove(p,units,dest,confirm=false){
  if(!canArrangeMove(p) || !units.length) return;
  if(confirm || pendingCombatMove() || (!G.manual && dest!=='base' && G.bfs[dest]
    && (G.bfs[dest].controller!==p || G.bfs[dest].units.some(u=>u.ctrl!==p)))){
    prepareCombatMove(p,units,dest); return;
  }
  const uids=units.map(u=>u.uid);
  NET.dispatch({k:'move',p,uids,dest}, ()=>moveUnits(p,units,dest).then(()=>UI.render()));
}
function confirmCombatMove(){
  const move=pendingCombatMove();
  if(!move || !canArrangeMove(move.p)) return;
  const units=everyUnit().filter(u=>move.uids.has(u.uid));
  if(units.length!==move.uids.size || units.some(u=>moveProblem(move.p,u,move.dest))){
    _combatMove=null; UI.render(); UI.promptForState();
    UI.toast('이동할 유닛의 상태가 바뀌었습니다. 다시 선택하세요','warn'); return;
  }
  if(combatMoveWillFight(move.p,move.dest)) UI.playAttackTokenConsumeSound?.();
  move.action={k:'move',p:move.p,uids:units.map(u=>u.uid),dest:move.dest};
  UI.render(); UI.promptForState();
  NET.dispatch(move.action, async()=>{
    UI.finishCombatMove();
    await moveUnits(move.p,units,move.dest); UI.render();
  });
}
function cancelCombatMove(){
  const move=pendingCombatMove();
  if(!move || move.action) return false;
  if(move.uids.size && combatMoveWillFight(move.p,move.dest)) UI.playUnitCombatMovementSound?.('bench',move.uids.size);
  _combatMove=null; _moveArmed=false; _moveSel.clear(); hideMenu();
  UI.render(); UI.promptForState();
  return true;
}
UI.finishCombatMove = function(){ _combatMove=null; UI.promptForState(); };
UI.combatMoveBlocks = function(action){
  const move=pendingCombatMove();
  if(!move || action===move.action || ['surrender','rematch','rematchDecline','rematchGo','playmat'].includes(action.k)) return false;
  UI.toast('이동을 적용하거나 S로 취소하세요','warn');
  return true;
};
function onUnitClick(u, e){
  if(replayLock()) return;          // 리플레이 관전 중에는 조작 불가
  if(e.altKey) return;              // Alt+클릭은 카드 확대 전용
  if(pendingCombatMove()){ e.stopPropagation(); toggleCombatMover(u); return; }
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
  if(pendingCombatMove()) return;
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
    const addCopied=(srcFx, srcName, srcCard)=>{
      (srcFx.activated||[]).forEach(ab=>{
        if(!ab.cost || !ab.cost.exhaustSelf) return;
        const key=srcName+':'+ab.label; if(seen.has(key)) return; seen.add(key);
        const item=document.createElement('div'); item.className='ctx-item';
        item.textContent='🔧 '+srcName+': '+ab.label;
        item.classList.add('ctx-card-choice');
        item.prepend(cardMiniEl(srcCard));
        attachCardHover(item,srcCard);
        item.onclick=()=>{ hideMenu();
          NET.dispatch({k:'ability',p:u.ctrl,src:{kind:'unit',uid:u.uid},copy:{srcName,label:ab.label}},
            ()=>activateAbility(u.ctrl,{kind:'unit',u},{...ab, copied:true})); };   // 복사 능력은 원 카드의 위치 제한을 따르지 않는다(#8631)
        menu.appendChild(item);
      });
    };
    const P=G.players[u.ctrl];
    addCopied(FX[P.legendN]||{}, card(P.legendN).ko, card(P.legendN));
    everyUnit().filter(x=>x.ctrl===u.ctrl&&x!==u&&!x.isToken).forEach(x=>addCopied(unitFx(x), unitName(x), unitCard(x)));
    P.gear.forEach(g=>addCopied(FX[g.n]||{}, card(g.n).ko, card(g.n)));
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
// 캡처 단계에서 닫아 카드/보드의 stopPropagation과 관계없이 바깥 터치를 처리한다.
// 메뉴를 여는 click보다 먼저 실행되므로 방금 연 메뉴가 즉시 닫히지 않는다.
document.addEventListener('pointerdown', e=>{
  const menu=document.getElementById('ctx-menu');
  if(menu && menu.style.display==='block' && !menu.contains(e.target)) hideMenu();
}, true);
// 선택 메뉴 표시 — 바깥 터치 · [✖ 닫기] · Esc · 모바일 뒤로 가기로 닫기.
function openMenuAt(menu, e){
  const close=document.createElement('div');
  close.className='ctx-item ctx-close'; close.textContent='✖ 닫기';
  close.onclick=hideMenu;
  menu.appendChild(close);
  menu.style.display='block';
  const x=(e&&e.clientX)||0, y=(e&&e.clientY)||0;
  const sp=fixedLayoutSpace(x, y);
  // 실제 배율을 반영한 공간 안에서 먼저 크기를 제한한 뒤 위치를 계산한다.
  menu.style.maxWidth=Math.min(420,sp.width-12)+'px';
  menu.style.maxHeight=Math.max(40,sp.height-12)+'px';
  menu.style.overflowY='auto';
  menu.style.left='0px'; menu.style.top='0px';
  menu.style.left=Math.max(4, Math.min(sp.x, sp.width-menu.offsetWidth-6))+'px';
  menu.style.top =Math.max(4, Math.min(sp.y, sp.height-menu.offsetHeight-6))+'px';
}

// 체인 반응 카드는 첫 탭으로 바로 쓰지 않는다. 카드 정보 확인과 사용 확정을
// 일반 카드 메뉴와 같은 작은 메뉴에서 나눠 모바일 오입력을 막는다.
function showReactionChoiceMenu(i,e){
  const pick=_boardCardPick, option=pick?.options[i], target=pick?.targets[i];
  if(!pick || !option || !target) return;
  const c=optionCard(option);
  const menu=document.getElementById('ctx-menu');
  menu.innerHTML='';
  const title=document.createElement('div'); title.className='ctx-title';
  title.textContent=c?.ko||option.label; menu.appendChild(title);
  const use=document.createElement('div'); use.className='ctx-item';
  use.textContent=option.label;
  use.onclick=()=>{ hideMenu(); if(_boardCardPick===pick) pick.finish(i); };
  menu.appendChild(use);
  if(c){
    const info=document.createElement('div'); info.className='ctx-item'; info.textContent='🔍 카드 정보 보기';
    info.onclick=()=>{ hideMenu(); UI.showZoom(c); };
    menu.appendChild(info);
  }
  openMenuAt(menu,e);
}

// 전장에 놓인 내 숨김 카드는 손패 카드처럼 작은 메뉴에서 사용을 확정한다.
// 반응 선택 중에는 showReactionChoiceMenu가 먼저 처리하므로 같은 카드를 즉시 발동하지 않는다.
function showHiddenCardMenu(h,bfIdx,hiddenIndex,e){
  if(replayLock() || !hiddenCardFaceUp(h.by)) return;
  const c=card(h.n);
  const menu=document.getElementById('ctx-menu');
  menu.innerHTML='';
  const title=document.createElement('div'); title.className='ctx-title'; title.textContent=c.ko;
  menu.appendChild(title);
  if(hiddenCardPlayable(h,bfIdx)){
    const use=document.createElement('div'); use.className='ctx-item';
    use.textContent='▶ 비용 없이 공개해 사용';
    use.onclick=()=>{
      hideMenu();
      if(!canInitiate(h.by) || !hiddenCardPlayable(h,bfIdx)) return;
      NET.dispatch({k:'playHidden',p:h.by,bfIdx,hiddenIndex},()=>playHidden(h.by,bfIdx,h));
    };
    menu.appendChild(use);
  }
  const info=document.createElement('div'); info.className='ctx-item'; info.textContent='🔍 카드 정보 보기';
  info.onclick=()=>{ hideMenu(); UI.showZoom(c); };
  menu.appendChild(info);
  openMenuAt(menu,e);
}

// ---------- 손패 클릭 ----------
// 온라인: 내 좌석의 행동만 개시 가능
// 이 좌석을 지금 사람이 조작해도 되는가.
// 오프라인은 로컬 핫시트(2인이 번갈아 두기) 때문에 좌석을 가리지 않는다.
// 다만 BOT 대전의 봇 좌석은 예외 — 봇이 스스로 두는 자리를 사람이 대신 조작하면
// 규칙 밖의 수가 되고, 봇의 비공개 정보([숨겨짐] 카드, 비용으로 버리는 손패)까지 드러난다.
function canInitiate(p){
  if(UI.spellStage || UI.spellStageSubmitting){ UI.toast('준비 중인 주문을 확인하거나 손패로 되돌려 주세요','warn'); return false; }
  if(pendingCombatMove()){ UI.toast('교전 이동을 먼저 확인하세요','warn'); return false; }
  if(typeof botIs==='function' && botIs(p)){ UI.toast('봇의 카드는 조작할 수 없습니다','warn'); return false; }
  if(!NET.online) return true;
  if(p!==NET.seat){ UI.toast('상대 카드는 조작할 수 없습니다','warn'); return false; }
  return true;
}

function onHandClick(p, idx, e){
  if(replayLock()) return;
  if(pendingCombatMove()) return;
  if(G.winner!==null) return;
  if(e.altKey) return;              // Alt+클릭은 카드 확대 전용
  if(UI.spellStage || UI.spellStageSubmitting) return;
  e.stopPropagation();              // 메뉴를 연 클릭이 document 닫기 리스너로 버블링되는 것 방지
  healStaleRoutedPicks();           // 낡은 선택 표식이면 지우고 손패를 연다 (제보 2026-09-23: "주문도 안 들어감")
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
    const opts=c.type==='Spell'&&PLAY_OPTIONS.spellStage?{stageSpell:true}:{};
    NET.dispatch({k:'play',p,handIdx:idx,opts},
      ()=>playCardFromHand(p,idx,opts));   // 클릭과 드래그 모두 주문 선택 후 확인/취소
  };
  menu.appendChild(play);
  if(fx.kw.hidden){
    const hide=document.createElement('div'); hide.className='ctx-item';
    hide.textContent=`🕶 숨기기 (${hideCostLabel(p)})`;
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

// 최대 10개까지 묶되, 1/2 겹침으로도 폭을 넘으면 다음 줄로 옮긴다.
function updateRuneOverlap(zone){
  if(!zone.clientWidth) return;
  const style=getComputedStyle(zone);
  const available=zone.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
  const slots=[...zone.querySelectorAll('.rune-slot')];
  const rowCount=Number(style.getPropertyValue('--rune-rows'))||0;
  const groups=[];
  let group=[], halfWidth=0, previousWidth=0;
  for(const slot of slots){
    const width=slot.offsetWidth;
    const nextWidth=group.length ? halfWidth-previousWidth/2+width : width;
    // 위 행의 표시 공간을 먼저 채우고 다음 행으로 넘긴다. 모바일은 두 행을 유지한다.
    if(group.length && (group.length>=10 || nextWidth>available)
        && (!rowCount || groups.length<rowCount-1)){
      groups.push(group); group=[]; halfWidth=0;
    }
    halfWidth=group.length ? halfWidth-previousWidth/2+width : width;
    group.push({slot,width}); previousWidth=width;
  }
  if(group.length) groups.push(group);
  const focused=document.activeElement;
  groups.forEach((items,i)=>{
    let row=zone.children[i];
    if(!row){ row=document.createElement('div'); row.className='rune-row'; zone.appendChild(row); }
    items.forEach(({slot},j)=>{
      if(row.children[j]!==slot) row.insertBefore(slot,row.children[j]||null);
    });
    const normalWidth=items.reduce((total,{width},j)=>total+width*(j===items.length-1?1:2/3),0);
    row.classList.toggle('compact-runes',normalWidth>available);
  });
  while(zone.children.length>groups.length) zone.lastElementChild.remove();
  // 기존 카드 노드를 옮겨 클릭 핸들러와 원래 룬 인덱스를 그대로 유지한다.
  if(focused && zone.contains(focused) && document.activeElement!==focused) focused.focus({preventScroll:true});
}
// 모바일은 회전한 카드의 실제 폭/높이로 줄을 채운다. 중앙 전장 카드만 비워 두고,
// 한 화면에 들어가지 않을 때에만 카드 크기를 줄인 뒤 다음 가로 페이지를 쓴다.
function layoutBattlefieldUnits(lane){
  const row=lane.querySelector('.bf-row');
  const cards=[...row.querySelectorAll('.card-mini')];
  const style=getComputedStyle(row);
  if(style.getPropertyValue('--bf-packed').trim()!=='1'){
    row.style.removeProperty('--bf-packed-height');
    row.style.removeProperty('--bf-content-width');
    cards.forEach(el=>{ el.style.removeProperty('--bf-x'); el.style.removeProperty('--bf-y'); });
    row.querySelectorAll('.bf-page-stop').forEach(el=>el.remove());
    return;
  }
  const width=row.clientWidth, height=row.clientHeight;
  if(!width || !height) return;
  const bounds=row.getBoundingClientRect();
  const header=lane.parentElement.querySelector('.bf-header').getBoundingClientRect();
  const scale=bounds.width/width;
  const reserve={left:(header.left-bounds.left)/scale-2, right:(header.right-bounds.left)/scale+2,
    top:(header.top-bounds.top)/scale-2, bottom:(header.bottom-bounds.top)/scale+2};
  const gap=2, inset=3;
  const pack=size=>{
    const positions=[];
    let x=inset, y=inset, lineHeight=0, page=0;
    for(const el of cards){
      const rotated=el.classList.contains('exhausted');
      const w=size*(rotated?1:74/104), h=size*(rotated?74/104:1);
      let newPage=false;
      for(;;){
        if(y+h>height-inset){
          if(newPage) return {pages:Infinity};
          newPage=true; page++; x=inset; y=inset; lineHeight=0;
        }
        if(y<reserve.bottom && y+h>reserve.top && x<reserve.right && x+w>reserve.left) x=reserve.right;
        if(x+w<=width-inset) break;
        x=inset;
        // 첫 카드가 중앙 예약 영역 옆에 안 들어가면 그 영역 아래에서 시작한다.
        y=lineHeight ? y+lineHeight+gap : Math.max(y+gap,reserve.bottom);
        lineHeight=0;
      }
      positions.push({x:page*width+x+w/2,y:y+h/2});
      x+=w+gap; lineHeight=Math.max(lineHeight,h);
    }
    return {positions,pages:page+1};
  };
  const maximum=Math.min(parseFloat(style.getPropertyValue('--bf-unit-height')),height-2*inset,width-2*inset);
  const minimum=Math.min(32,maximum,Math.max(reserve.top,height-reserve.bottom)-2*inset);
  let size=maximum, layout=pack(size);
  while(layout.pages>1 && size>minimum){ size=Math.max(minimum,size-2); layout=pack(size); }
  row.style.setProperty('--bf-packed-height',size+'px');
  row.style.setProperty('--bf-content-width',layout.pages*width+'px');
  cards.forEach((el,i)=>{
    el.style.setProperty('--bf-x',layout.positions[i].x+'px');
    el.style.setProperty('--bf-y',layout.positions[i].y+'px');
  });
  const stops=[...row.querySelectorAll('.bf-page-stop')];
  for(let i=0;i<layout.pages;i++){
    let stop=stops[i];
    if(!stop){ stop=document.createElement('span'); stop.className='bf-page-stop'; stop.setAttribute('aria-hidden','true'); row.appendChild(stop); }
    stop.style.left=i*width+'px';
  }
  stops.slice(layout.pages).forEach(el=>el.remove());
}
function updateBattlefieldScroll(root=document){
  root.querySelectorAll('.bf-lane').forEach(lane=>{
    const row=lane.querySelector('.bf-row');
    layoutBattlefieldUnits(lane);
    lane.classList.toggle('has-overflow',row.scrollWidth>lane.clientWidth+1);
    lane._syncScroll();
  });
}
window.addEventListener('DOMContentLoaded',()=>{
  const observer=new ResizeObserver(entries=>entries.forEach(entry=>updateRuneOverlap(entry.target)));
  for(const p of [0,1]) observer.observe(document.getElementById('runes-'+p));
  new ResizeObserver(()=>updateBattlefieldScroll()).observe(document.getElementById('battlefields'));

});

// 계속 일렁이는 가장자리 표시. 일반 턴·결전 우선권·효과 선택의 실제 행동 주체를 따른다.
function updateTurnGlow(){
  const el=document.getElementById('turn-glow');
  let side='';
  let host=document.getElementById('game-screen');
  if(G && G.winner===null && UI.fx.on && !(typeof REPLAY!=='undefined' && REPLAY.viewing)){
    const mine=NET.online ? NET.seat : (typeof BOT!=='undefined' && BOT.active) ? 1-BOT.seat : 0;
    const pick=_turnGlowPick?.game===G ? _turnGlowPick.p : null;
    const actor=(pick===0 || pick===1) ? pick : G.state==='showdown' ? G.actingPlayer
      : G.phase==='setup' ? null : G.turn;
    if(actor===0 || actor===1){
      side=actor===mine?'mine':'opponent';
      host=document.getElementById('parea-'+actor);
    }
  }
  // 크기·화면 회전·온라인 좌석 변경은 부모 구역의 배치를 그대로 따라간다.
  if(el.parentElement!==host) host.appendChild(el);
  if(el.dataset.side!==side) el.dataset.side=side;
}
UI.render = function(){
  updateTurnGlow();
  UI.updateChainView();
  if(!G) return;
  const pendingMove=pendingCombatMove();
  const displayUnits=everyUnit();
  orientBoard();
  PLAYMAT.apply();
  // 튜토리얼: 상태가 변할 때마다 진행 체크 (백그라운드 인터벌 스로틀 대비)
  if(typeof TUT!=='undefined' && TUT.active && TUT.tickSoon) TUT.tickSoon();
  // 상단바
  document.getElementById('turn-info').textContent=`${pname(G.turn)}의 턴`;
  const phaseKo={setup:'준비',awaken:'각성',beginning:'시작',channel:'전개',draw:'드로우',action:'행동',ending:'종료'}[G.phase]||G.phase;
  document.getElementById('phase-info').textContent=
    `${phaseKo} 단계` + (pendingMove?' / 교전 이동 대기':G.state==='showdown'?' · ⚔️결전 중':'');
  announcePhase();
  UI.updateScoreInfo();

  // 풀
  const P=G.players[G.actingPlayer];
  const powStr=Object.entries(P.power).filter(([,v])=>v>0).map(([d,v])=>`${DOMAIN_ICON[d]}${v}`).join(' ');
  document.getElementById('pool-display').innerHTML=
    `<b>${esc(pname(G.actingPlayer))}</b> 풀<br>에너지 ${P.energy}${P.energySpell?` (+주문 전용 ${P.energySpell})`:''} ${powStr?'· '+powStr:''}${P.powerSpell?` · 주문 전용 ✳${P.powerSpell}`:''}<br>준비 룬 ${readyRunes(G.actingPlayer).length}/${P.runes.length}`;

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
        if(pendingCombatMove()) return;
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
        // [숨겨짐] 챔피언은 챔피언 존에서도 숨길 수 있다 (룰 737 — 티모 121·197 등)
        if(FX[cc.n] && FX[cc.n].kw.hidden && G.turn===p && G.state==='neutral'){
          const hd=document.createElement('div'); hd.className='ctx-item';
          hd.textContent=`🕶 전장에 숨기기 (${hideCostLabel(p)})`;
          hd.onclick=()=>{ hideMenu(); NET.dispatch({k:'hide',p,handIdx:'champ'}, ()=>hideCard(p,'champ')); };
          menu.appendChild(hd);
        }
        openMenuAt(menu, e);
      };
      attachHandDrag(cel,p,-1,Pl.champN,true);
      cslot.appendChild(cel);
    }
    const ccap=document.createElement('div'); ccap.className='slot-caption'; ccap.textContent='챔피언 존';
    cslot.appendChild(ccap);
    // 룬
    const rz=document.getElementById('runes-'+p);
    rz.innerHTML='';
    let runeRow;
    // 표시 순서만 정렬한다. 전송·엔진에서 쓰는 원래 룬 인덱스는 보존한다.
    Pl.runes.map((r,ri)=>({r,ri})).sort((a,b)=>Number(!!a.r.ex)-Number(!!b.r.ex)).forEach(({r,ri})=>{
      const rc=card(r.n);
      const slot=document.createElement('div');
      slot.className='rune-slot'+(r.ex?' exhausted':'');
      const rel=document.createElement('div');
      rel.className='rune-mini'+(r.ex?' exhausted':'');
      rel.dataset.runeIndex=String(ri);
      rel.setAttribute('role','button'); rel.tabIndex=0;
      rel.setAttribute('aria-label',rc.ko+(r.ex?' (탈진)':' (준비)')+' — 자원 띄우기');
      const dom=runeDomain(r.n);
      // 실제 룬 카드 이미지 + 영역 색 테두리, 작은 화면에서도 알아보게 영역 아이콘 배지를 겹친다
      const _ri=artImg(rc, p);
      if(_ri) rel.style.backgroundImage=`url("${cardImgUrl(_ri,120)}")`;
      rel.style.borderColor=DOMAIN_COLOR[dom]||'#556';
      const badge=document.createElement('span');
      badge.className='rm-dom'; badge.textContent=DOMAIN_ICON[dom]||'◆';
      rel.appendChild(badge);
      rel.title=rc.ko+(r.ex?' (탈진)':'')+' — 클릭: 자원 띄우기';
      rel.onmouseenter=()=>UI.inspect(rc);
      rel._card=rc; attachZoom(rel);           // 꾹 누르기/우클릭/Alt+클릭으로 확대
      // 룬 플로팅(룰 745): 클릭 → 탈진해 에너지 +1 / 재활용해 힘 +1 을 미리 풀에 올린다
      rel.onclick=(e)=>{
        if(replayLock() || G.winner!==null) return;
        if(e.altKey) return;                    // 확대 제스처와 충돌 방지
        if(!canInitiate(p)) return;             // 내 좌석/차례에만
        if(p!==G.actingPlayer) return;
        e.stopPropagation();
        const menu=document.getElementById('ctx-menu');
        menu.innerHTML='';
        if(!r.ex){
          const en=document.createElement('div'); en.className='ctx-item';
          en.textContent='⚡ 탈진: 에너지 +1';
          en.onclick=()=>{ hideMenu(); NET.dispatch({k:'runeFloat',p,idx:ri,mode:'energy'}, ()=>runeFloat(p,ri,'energy')); };
          menu.appendChild(en);
        }
        const pw=document.createElement('div'); pw.className='ctx-item';
        pw.textContent=`✳ 재활용: ${DOMAIN_KO[runeDomain(rc.n)]||''} 힘 +1 (룬 덱으로)`;
        pw.onclick=()=>{ hideMenu(); NET.dispatch({k:'runeFloat',p,idx:ri,mode:'power'}, ()=>runeFloat(p,ri,'power')); };
        menu.appendChild(pw);
        openMenuAt(menu, e);
      };
      rel.onkeydown=e=>{
        if(e.key==='Enter' || e.key===' '){ e.preventDefault(); rel.click(); }
      };
      if(!runeRow || runeRow.children.length===10){
        runeRow=document.createElement('div'); runeRow.className='rune-row'; rz.appendChild(runeRow);
      }
      slot.appendChild(rel); runeRow.appendChild(slot);
    });
    updateRuneOverlap(rz);
    // 더미
    document.querySelector('#deck-'+p+' .pile-count').textContent=Pl.deck.length;
    document.querySelector('#runedeck-'+p+' .pile-count').textContent=Pl.runeDeck.length;
    const trashPile=document.getElementById('trash-'+p);
    trashPile.querySelector('.pile-count').textContent=Pl.trash.length;
    // 폐기장은 들어온 순서대로 저장된다. 남아 있는 마지막 카드를 매 렌더마다 갱신한다.
    const trashTop=Pl.trash.length ? card(Pl.trash[Pl.trash.length-1]) : null;
    const trashImage=trashTop ? artImg(trashTop,p) : null;
    // CSS 변수는 스타일시트 위치에서 URL을 해석하므로 카드 경로를 문서 기준으로 확정한다.
    trashPile.style.setProperty('--pile-image',trashImage ? `url("${new URL(cardImgUrl(trashImage,280),document.baseURI).href}")` : 'none');
    trashPile.classList.toggle('has-card-image',!!trashImage);
    // 기지
    const bz=document.getElementById('base-'+p);
    bz.innerHTML='<div class="zone-label">기지</div>';
    attachDropZone(bz, 'base'); // 드래그 이동: 자기 기지으로 귀환 (moveUnits가 소유자 검증)
    // 클릭 이동: 전장처럼 기지도 이동 목적지로 클릭 가능해야 한다 (드래그가 안 되는 터치 환경 필수)
    bz.onclick=(e)=>{
      if(e.target.closest('.card-mini')) return;
      if(_moveArmed && _moveSel.size) executeMove('base');
    };
    displayUnits.filter(u=>u.ctrl===p && moveDisplayLoc(u)==='base').forEach(u=>appendSelectableUnit(bz,u));
    // 도구 (기지에 표시)
    Pl.gear.forEach((g,i)=>{
      const gel=cardMiniEl(card(g.n));
      gel.dataset.gearIndex=i;
      gel.style.borderColor='#8a7a4a';
      if(g.ex) gel.classList.add('exhausted');
      gel.oncontextmenu=(e)=>{ e.preventDefault(); showGearMenu(p,g,e); };
      gel.onclick=(e)=>showGearMenu(p,g,e);
      bz.appendChild(gel);
    });
    // 손패
    const hz=document.getElementById('hand-'+p);
    hz.innerHTML='';
    // 봇 손패 확인은 손패 칸 안에 둔다. 공개해도 카드는 보기 전용이다.
    if(botHandHidable(p)){
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='peek-btn'+(UI.peekBotHand?' on':'');
      btn.setAttribute('aria-pressed',String(!!UI.peekBotHand));
      btn.textContent=(UI.peekBotHand?'☑':'☐')+' 손패 확인';
      btn.title=UI.peekBotHand
        ? '봇의 손패를 보고 있습니다 (보기 전용) — 다시 누르면 가립니다'
        : '봇의 손패를 확인합니다 (연습용)';
      btn.addEventListener('click', ()=>{ UI.peekBotHand=!UI.peekBotHand; UI.render(); });
      hz.appendChild(btn);
    }
    const faceUp = handFaceUp(p);          // 공개 규칙은 handFaceUp 한 곳에만 있다
    const peeked = faceUp && botHandHidable(p);
    Pl.hand.forEach((n,i)=>{
      if(UI.spellStage?.game===G && UI.spellStage.p===p && UI.spellStage.handIdx===i) return;
      let el;
      const revealed=_boardCardPick?.targets.some(t=>t?.kind==='hand' && t.p===p && t.index===i && t.reveal);
      if(!faceUp && !revealed){ el = document.createElement('div'); el.className='card-mini card-back'; }
      else if(peeked){
        // 들여다본 봇 손패는 보기 전용 — 클릭을 살려 두면 사람이 봇 카드를 대신 내 버릴 수 있다
        // (확대·정보 표시는 cardMiniEl에 그대로 남아 있어 '확인'에는 지장이 없다)
        el = cardMiniEl(card(n)); el.classList.add('peeked');
      }
      else { el = cardMiniEl(card(n)); el.onclick=(e)=>onHandClick(p,i,e); attachHandDrag(el,p,i,n); }
      el.dataset.handIndex=i;
      hz.appendChild(el);
    });
  }

  // 전장
  G.bfs.forEach((bf,i)=>{
    const el=document.getElementById('bf-'+i);
    el.className='battlefield';
    if(bf.controller!==null) el.classList.add('controlled-'+bf.controller);
    if(G.showdown&&G.showdown.bfIdx===i) el.classList.add('contested');
    if(pendingMove?.dest===i) el.classList.add('move-pending');
    const bc=card(bf.n);
    const rowScroll=[0,0];
    el.querySelectorAll('.bf-row').forEach(row=>{ rowScroll[+row.dataset.player]=row.scrollLeft; });
    el.innerHTML='';
    const head=document.createElement('div'); head.className='bf-header';
    if(bc.img){
      const im=document.createElement('img'); im.src=cardImgUrl(bc.img,280);
      im.alt=bc.ko;
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
    const info=document.createElement('div'); info.className='bf-info';
    info.title=bc.ko+' · '+(bf.controller===null?'무주공산':'통제: '+pname(bf.controller));
    info.innerHTML=`<div class="bf-name">${esc(bc.ko)}</div>
      <div class="bf-status">${bf.controller===null?'무주공산':'통제: '+esc(pname(bf.controller))}</div>`;
    head.appendChild(info);
    if(pendingMove?.dest===i){
      const status=document.createElement('div'); status.className='bf-move-pending';
      status.textContent=`교전 이동 대기 ${pendingMove.uids.size}기`;
      status.setAttribute('role','status'); el.appendChild(status);
    }
    if(bf.hiddenCards.length){
      const hidden=document.createElement('span'); hidden.className='bf-hidden-count';
      hidden.textContent='🕶'+bf.hiddenCards.length;
      hidden.title='숨김카드 '+bf.hiddenCards.length+'장';
      head.appendChild(hidden);
    }
    // 보드 방향과 같이 상대는 위, 나는 아래. 빈 진영도 남겨 중앙 카드가 밀리지 않게 한다.
    for(const p of [1-UI._orient,UI._orient]){
      const lane=document.createElement('div'); lane.className='bf-lane';
      const row=document.createElement('div'); row.className='bf-row';
      row.dataset.player=String(p);
      row.setAttribute('role','group'); row.setAttribute('aria-label',pname(p)+'의 전장 카드');
      displayUnits.filter(u=>u.ctrl===p && moveDisplayLoc(u)===i).forEach(u=>appendSelectableUnit(row,u));
      bf.hiddenCards.forEach((h,hiddenIndex)=>{
        if(h.by===p) row.appendChild(hiddenBattlefieldCardEl(h,i,hiddenIndex));
      });
      const arrows=[-1,1].map(dir=>{
        const btn=document.createElement('button'); btn.type='button'; btn.className='bf-scroll';
        btn.textContent=dir<0?'‹':'›';
        btn.setAttribute('aria-label',pname(p)+'의 전장 카드 '+(dir<0?'왼쪽':'오른쪽')+' 보기');
        btn.onclick=e=>{
          e.stopPropagation();
          const packed=getComputedStyle(row).getPropertyValue('--bf-packed').trim()==='1';
          row.scrollBy({left:dir*row.clientWidth*(packed?1:.8)});
        };
        return btn;
      });
      lane._syncScroll=()=>{
        arrows[0].disabled=row.scrollLeft<=1;
        arrows[1].disabled=row.scrollLeft+row.clientWidth>=row.scrollWidth-1;
      };
      row.addEventListener('scroll',lane._syncScroll);
      lane.append(arrows[0],row,arrows[1]);
      el.appendChild(lane);
      if(p!==UI._orient) el.appendChild(head);
    }
    updateBattlefieldScroll(el);
    el.querySelectorAll('.bf-row').forEach(row=>{ row.scrollLeft=rowScroll[+row.dataset.player]; row.parentElement._syncScroll(); });
    attachDropZone(el, i); // 드래그 이동: 이 전장으로
    // 클릭: 이동 목적지. 숨김 카드는 카드 자체를 눌러 선택한다.
    el.onclick=(e)=>{
      if(e.target.closest('.card-mini')) return;
      if(_moveArmed && _moveSel.size){ executeMove(i); return; }
    };
  });

  updateButtons();
  highlightBoardCards();
  renderReactionChain();
  UI.renderSpellStage?.();
  UI.renderSelectedTargets();
  attachDropZone(document.getElementById('center-info'),'spell');
  UI.fx.check();          // 행동 차례가 바뀌었으면 연출
};

// 리플레이 관전 중에는 모든 조작을 잠근다 (상태 변경은 NET.dispatch에서도 한 번 더 차단)
UI.updateScoreInfo=function(){
  if(!G) return;
  const points=p=>UI.displayPoints?UI.displayPoints(p):G.players[p].points;
  document.getElementById('score-info').innerHTML=
    `<span style="color:#9fc8ff">${esc(pname(0))} ${points(0)}점</span> : <span style="color:#ffc89f">${esc(pname(1))} ${points(1)}점</span> (선취 ${G.victory}점)`;
};

function replayLock(){ return (typeof REPLAY!=='undefined' && REPLAY.viewing) || (typeof NET!=='undefined' && NET.online && NET.spectating); }

function updateButtons(){
  document.getElementById('action-buttons').style.display = replayLock() ? 'none' : '';
  // 채팅은 상대가 실제 사람일 때만 (온라인 대전 — 서버 릴레이·P2P 공통)
  const chatOn = NET.online && !(typeof REPLAY!=='undefined' && REPLAY.viewing) && !UI.chatMuted;
  const chatBar=document.getElementById('chat-bar');
  if(chatBar) chatBar.style.display = chatOn ? '' : 'none';
  if(!chatOn) chatPopClose();   // 채팅 불가 상태(오프라인·무시·리플레이)면 팝업도 닫는다
  if(replayLock()) return;
  const btnMove=document.getElementById('btn-move');
  const pending=pendingCombatMove();
  btnMove.className='act-btn'+(pending?' armed combat-confirm':_moveArmed?' armed':'');
  btnMove.textContent=pending ? (pending.action?'이동 적용 중...':`이동 적용 (${pending.uids.size}기)`)
    : _moveArmed?`🚶 이동: 목적지 클릭 (${_moveSel.size}개 선택)`:'🚶 이동';
  btnMove.title=pending ? (pending.action?'이동을 적용하고 있습니다':'Space: 이동 적용, S: 이동 취소')
    : 'S: 이동 활성화/비활성화';
  btnMove.disabled=!canArrangeMove(G.turn);
  const btnEnd=document.getElementById('btn-endturn');
  const reactionPass=canPassReaction();
  const canEndTurn=UI.canEndTurn();
  const draft=UI.spellStage;
  const ownDraft=draft && draft.game===G && localControlsPlayer(draft.p);
  const draftReady=!!(ownDraft && draft.ready && !draft.submitted);
  const endLabel=ownDraft?'확인':reactionPass?'패스':'턴 종료';
  // 장식 SVG를 유지하고 버튼의 텍스트만 바꾼다.
  const labelNode=[...btnEnd.childNodes].find(n=>n.nodeType===Node.TEXT_NODE);
  if(labelNode) labelNode.textContent=endLabel;
  btnEnd.setAttribute('aria-label',endLabel);
  btnEnd.title=(reactionPass?'이 체인에 반응하지 않고 패스합니다':'턴 종료')+((reactionPass||canEndTurn)?' (Space)':'');
  btnEnd.classList.toggle('primary',reactionPass || canEndTurn);
  btnEnd.disabled=!reactionPass && !canEndTurn;
  if(draft){
    btnEnd.style.display='';
    btnEnd.disabled=!draftReady;
    btnEnd.classList.toggle('primary',draftReady);
    btnEnd.title=ownDraft?(draftReady?'선택한 주문을 시전합니다 (Space)':'대상과 추가 비용을 먼저 선택하세요'):'상대가 주문을 준비하고 있습니다';
  }
  const btnPass=document.getElementById('btn-pass');
  const canShowdownPass=UI.canShowdownPass();
  btnPass.classList.toggle('primary',canShowdownPass);
  btnPass.disabled=!canShowdownPass;
  btnPass.title=canShowdownPass?'패스 (Space)':'지금은 패스할 수 없습니다';
  if(_reactionPick){ btnEnd.style.display=''; btnPass.style.display='none'; }   // 결전 중 응수 창: 응수 패스 버튼을 보이게
}

// 게임 단축키는 실제로 실행 가능한 버튼 조건을 그대로 따르고, 길게 누르기와 연타를 막는다.
const GAME_SHORTCUT_INTERVAL=350;
const _gameShortcutAt={Space:-Infinity,KeyS:-Infinity};
function gameShortcutBlocked(e){
  if(e.defaultPrevented) return true;
  if(e.ctrlKey||e.metaKey||e.altKey) return true;
  if(e.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return true;
  const game=document.getElementById('game-screen');
  if(!game || game.offsetParent===null || replayLock()) return true;
  return document.getElementById('modal-overlay')?.style.display!=='none'
    || document.getElementById('card-zoom')?.style.display==='flex'
    || chainIsOpen() || document.getElementById('ctx-menu')?.style.display==='block';
}
function runGameShortcut(e){
  const code=e.code;
  if((code!=='Space'&&code!=='KeyS') || gameShortcutBlocked(e)) return;
  if(e.repeat){ e.preventDefault(); return; }
  const now=performance.now();
  if(now-_gameShortcutAt[code]<GAME_SHORTCUT_INTERVAL){ e.preventDefault(); return; }
  let handled=false;
  if(code==='KeyS'){
    const pending=pendingCombatMove();
    if(pending) handled=cancelCombatMove();
    else if(canArrangeMove(G.turn)){ document.getElementById('btn-move').click(); handled=true; }
  }else{
    if(UI.spellStage){
      const button=document.getElementById('btn-endturn');
      if(!button.disabled) button.click();
      e.preventDefault(); return;
    }
    const pending=pendingCombatMove();
    if(pending && !pending.action && canArrangeMove(pending.p)){ confirmCombatMove(); handled=true; }
    else if(_moveArmed) return;
    else if(canPassReaction()){ document.getElementById('btn-endturn').click(); handled=true; }
    else if(UI.canShowdownPass()){ document.getElementById('btn-pass').click(); handled=true; }
    else if(UI.canEndTurn()){ document.getElementById('btn-endturn').click(); handled=true; }
  }
  if(!handled) return;
  _gameShortcutAt[code]=now;
  e.preventDefault(); e.stopImmediatePropagation();
}
document.addEventListener('keydown',runGameShortcut);

// 이동 실행
async function executeMove(dest){
  hideMenu();
  if(!canArrangeMove(G.actingPlayer)) return;
  let units=everyUnit().filter(u=>_moveSel.has(u.uid));
  const p=G.actingPlayer;
  _moveArmed=false; _moveSel.clear();
  updateButtons();
  // 이동 불가 유닛이 섞여 있으면 전체를 막는 대신, 사유를 알려주고 가능한 유닛만 보낼지 묻는다
  // (예: 탈진된 유닛 + 기지 유닛을 함께 골랐을 때 "동시에 이동이 안 된다"로 보이던 문제)
  if(units.length){
    const bad=[], good=[];
    for(const u of units){
      const why=moveProblem(p,u,dest);
      (why?bad:good).push({u,why});
    }
    if(bad.length){
      const badTxt=bad.map(b=>`${unitName(b.u)}(${b.why})`).join(', ');
      if(!good.length){ UI.toast('이동 불가: '+badTxt,'warn'); UI.render(); return; }
      // 이 확인은 동기화 액션(dispatch) 밖의 순수 로컬 UI 판단이다 — UI.confirmP(routedPick→NET.choice)를 쓰면
      // 온라인에서 내 선택 번호(choiceSeq)만 앞서가 이후 상대 응답이 전부 무시되어 양쪽이 멈춘다 (2026-09-10 제보: 이동 시 멈춤).
      // 상대에게는 결과(이동할 uids)만 액션으로 전달되므로 로컬 확인창으로 충분하다.
      const ok=await _confirmLocal(p, `이동 불가: ${badTxt}\n나머지 ${good.length}기만 이동할까요?`);
      if(!ok){ UI.render(); return; }
      units=good.map(g=>g.u);
    }
  }
  if(units.length){
    requestUnitMove(p,units,dest,true);
  }
  UI.render();
}

// ---------- 전설 메뉴 ----------
function showLegendMenu(p, e){
  if(replayLock()) return;
  if(pendingCombatMove()) return;
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
  if(pendingCombatMove()) return;
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
  updateTurnGlow();
  const box=document.getElementById('modal-box');
  const isBot = typeof BOT!=='undefined' && BOT.active && !NET.online;
  const isTutorial=typeof TUT!=='undefined' && TUT.active;
  // 핫시트와 관전은 특정 사용자의 좌석을 가정하지 않는다.
  const me=replayLock()?null:NET.online?NET.seat:isBot?opp(BOT.seat):isTutorial?0:null;
  const lost=me!==null && me!==p;
  const left=me??p, right=opp(left);
  const title=me===null?'경기 종료':lost?'패배':'승리';
  const message=me===null?`<strong>${esc(pname(p))}</strong> 승리`
    :lost?`<strong>${esc(pname(p))}</strong>에게 패배했습니다.`
    :`<strong>${esc(pname(opp(p)))}</strong>에게 승리했습니다.`;
  box.innerHTML=`<section class="victory-box match-result ${lost?'is-defeat':'is-victory'}" role="dialog" aria-modal="true" aria-labelledby="result-title" aria-describedby="result-message">
    <div class="result-hero">
      <span class="result-kicker">${me===null?'MATCH RESULT':lost?'DEFEAT':'VICTORY'}</span>
      <h2 id="result-title">${title}</h2>
      <p id="result-message">${message}</p>
    </div>
    <div class="result-content">
      <div class="result-scoreboard" aria-label="최종 점수">
        ${[left,right].map(seat=>`<div class="result-player ${seat===p?'is-winner':''}">
          <span class="result-player-label">${me===null?(seat===p?'승리':'패배'):(seat===me?'나':'상대')}</span>
          <span class="result-player-name">${esc(pname(seat))}</span>
          <strong class="result-points">${G.players[seat].points}<small>점</small></strong>
        </div>`).join('<span class="result-vs" aria-hidden="true">:</span>')}
      </div>
      <div class="modal-btns result-actions" id="victory-btns"></div>
    </div>
  </section>`;
  const btns=box.querySelector('#victory-btns');
  const add=(label,fn,primary)=>{ const b=document.createElement('button'); if(primary) b.className='primary';
    b.textContent=label; b.onclick=fn; btns.appendChild(b); };
  if(NET.online && typeof MATCH!=='undefined' && MATCH.active()){
    // Bo3: 게임 결과를 매치에 기록하고, 끝나지 않았으면 다음 게임(사이드보딩 → 전장 선택 → 패자 선후공)으로
    MATCH.recordResult(p);
    const done=MATCH.finished();
    const sb=box.querySelector('.result-scoreboard');
    const line=document.createElement('div'); line.className='match-score-line';
    line.style.cssText='text-align:center;font-size:14px;color:#d8c27a;margin:6px 0 2px';
    line.textContent=done
      ? `🏆 매치 ${MATCH.wins[0]}:${MATCH.wins[1]} — ${pname(MATCH.wins[0]>MATCH.wins[1]?0:1)} 매치 승리 (${MATCH.game}게임)`
      : `Bo3 · ${MATCH.game}게임 종료 · 게임 스코어 ${pname(0)} ${MATCH.wins[0]} : ${MATCH.wins[1]} ${pname(1)}`;
    sb.insertAdjacentElement('afterend', line);
    if(!done){
      if(!NET.spectating) add(`▶ ${MATCH.game+1}게임 준비 (사이드보딩 → 전장 선택)`, ()=>{ closeModal(); MATCH.next(); }, true);
      else add('▶ 다음 게임 대기', ()=>{ closeModal(); UI.prompt('⏳ 플레이어들이 다음 게임을 준비하는 중...'); }, true);
    } else if(!NET.spectating) add('🔄 새 매치 (덱 선택)', ()=>{ closeModal(); RM.openPick(false); }, true);
    add(typeof P2P!=='undefined'&&P2P.active?'🚪 나가기':'🚪 로비로 돌아가기', ()=>{ closeModal(); gameLeave(); });
  } else if(NET.online){
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
  document.getElementById('btn-chain').onclick=toggleBoardChain;
  document.getElementById('btn-modal-chain').onclick=UI.showChain;
  document.getElementById('btn-chain-close').onclick=UI.hideChain;
  document.getElementById('chain-overlay').onclick=e=>{ if(e.target.id==='chain-overlay') UI.hideChain(); };
  document.getElementById('btn-endturn').onclick=()=>{
    if(UI.spellStage){ UI.submitSpellStage?.(); return; }
    if(_reactionPick){
      if(canPassReaction()) _boardCardPick.finish(_reactionPick.passIndex);
      return;
    }
    if(!UI.canEndTurn()) return;
    // 아직 쓸 수 있는 자원이 남아 있으면 한 번 물어본다 (실수로 턴을 넘기는 일이 잦다)
    const P=G.players[G.turn];
    const readyRunes=P.runes.filter(r=>!r.ex).length;
    const pool=(P.energy||0)+(P.energySpell||0)+(P.powerSpell||0)
             + Object.values(P.power||{}).reduce((s,v)=>s+v,0);
    if(PLAY_OPTIONS.confirmEndTurn && (readyRunes||pool)){ confirmEndTurn(readyRunes, pool); return; }
    NET.dispatch({k:'endTurn'}, ()=>endTurn());
  };
  // 로컬 확인창 — 게임 상태를 건드리지 않으므로 온라인 선택 동기화를 타지 않는다
  function confirmEndTurn(readyRunes, pool){
    const box=document.getElementById('modal-box');
    box.innerHTML='<h3>턴을 끝낼까요?</h3>';
    const t=document.createElement('div');
    t.className='modal-copy';
    const lines=[];
    if(readyRunes) lines.push(`· 준비된 룬이 ${readyRunes}개 남아 있습니다 — 이번 턴에는 더 쓸 수 없게 됩니다.`);
    if(pool) lines.push(`· 풀에 남은 에너지·힘 ${pool}은 턴이 끝나면 사라집니다.`);
    t.textContent=lines.join('\n');
    t.style.whiteSpace='pre-line';
    box.appendChild(t);
    const btns=document.createElement('div'); btns.className='modal-btns';
    const y=document.createElement('button'); y.className='primary'; y.textContent='턴 종료';
    y.onclick=()=>{
      if(!UI.canEndTurn()){ closeModal(); UI.render(); return; }
      closeModal(); NET.dispatch({k:'endTurn'}, ()=>endTurn());
    };
    const n=document.createElement('button'); n.textContent='더 플레이하기'; n.onclick=closeModal;
    btns.appendChild(y); btns.appendChild(n); box.appendChild(btns);
    openModal(); markModalDismissable();
  }
  document.getElementById('btn-move').onclick=()=>{
    if(pendingCombatMove()){ confirmCombatMove(); return; }
    if(!canArrangeMove(G.turn)) return;
    if(G.state==='showdown'){ UI.toast('결전 중에는 이동할 수 없습니다','warn'); return; }
    if(G.turn!==G.actingPlayer){ return; }
    if(NET.online && G.turn!==NET.seat){ UI.toast('자신의 턴이 아닙니다','warn'); return; }
    _moveArmed=!_moveArmed;
    if(!_moveArmed) _moveSel.clear();
    else UI.toast('이동할 아군 유닛들을 클릭한 뒤, 목적지(전장/기지)를 클릭하세요');
    UI.render();
  };
  document.getElementById('btn-pass').onclick=()=>{
    if(_reactionPick){ if(canPassReaction()) _boardCardPick.finish(_reactionPick.passIndex); return; }   // 응수 창이 열려 있으면 결전 패스 버튼도 응수 패스
    if(!UI.canShowdownPass()){
      const why=UI.passBlockReason();
      console.warn('pass blocked', why, {state:G?.state, acting:G?.actingPlayer, seat:NET.seat, sd:G?.showdown&&{chain:G.showdown.chain.length,passes:G.showdown.passes,ri:G.showdown.resolvingItem,ft:G.showdown.finalizingTriggers,pt:G.showdown.pendingTriggers?.length}, picking:UI.isPicking(), pending:Object.keys(NET.pendingChoices||{})});
      if(why) UI.toast('지금은 패스할 수 없습니다 — '+why,'warn');
      return;
    }
    NET.dispatch({k:'pass'}, ()=>showdownPass());
  };
  document.getElementById('btn-settings').onclick=openSystemMenu;
  UI.showHelp=()=>{
    const box=document.getElementById('modal-box');
    box.innerHTML=`<h3>도움말</h3>
    <div class="modal-copy help-copy">
    · <b>승리</b>: 8점 선취. 전장 <b>정복</b>(빼앗기) 1점, 유닛을 주둔시켜 자기 개시 단계까지 <b>유지</b> 1점.<br>
    · 전장에 유닛이 하나도 없으면 <b>통제를 잃고 무주공산</b>이 됩니다 — 비워두면 유지 득점도 없습니다.<br>
    · 마지막 1점은 유지로만, 또는 그 턴에 모든 전장을 득점한 경우의 정복으로만 얻습니다.<br>
    · <b>비용</b>: 에너지는 룬 탈진, 힘는 룬 재활용(룬 덱으로 반환)으로 자동 지불됩니다.<br>
    · <b>이동</b>: 유닛을 <b>드래그해서 전장/기지에 놓기</b>, 또는 [이동] 버튼 → 유닛들 클릭 → 목적지 클릭. 이동한 유닛은 탈진됩니다.<br>
    · 여러 유닛을 함께 보내려면 [이동] 버튼으로 유닛들을 선택한 뒤 그중 하나를 드래그하세요.<br>
    <b>이동 적용</b>: 이동 버튼이나 S로 시작한 이동은 목적지를 고른 뒤 대기 상태가 됩니다. Space로 적용하거나 S로 취소할 수 있습니다. 대기 중에는 같은 목적지의 이동 유닛만 변경할 수 있습니다.<br>
    결전 중 낸 카드와 능력은 <b>체인</b>에 쌓이고,
      양측이 모두 패스하면 <b>마지막에 낸 것부터 하나씩</b> 해결됩니다. 각 해결 사이에 [반응]으로 다시 응수할 수 있습니다.
      빈 체인에서 양측이 패스하면 전투가 벌어집니다.<br>
    · <b>전투</b>: 양측 위력 합계만큼 상대 유닛에 피해 배분(치명 우선·[탱커] 우선). 방어측이 살아남으면 공격측은 기지 귀환.<br>
    · <b>손패 카드 클릭</b> → 플레이/숨기기. 손패의 <b>유닛·도구는 드래그</b>하여 배치 가능한 위치에 플레이할 수 있습니다 (도구는 자기 기지). 등장 효과는 배치 후 이어서 처리합니다.<br>
    <b>손패 주문</b>: 클릭 후 플레이하거나 전장 사이로 드래그하면 중앙에서 시전을 준비합니다. 선택을 마치고 <b>[확인]</b>을 눌러야 시전됩니다. 확인 전에는 <b>[손패로 되돌리기]</b> 또는 손패로 드래그하여 취소할 수 있으며, 상대에게는 준비 중인 카드 뒷면이 보입니다.<br>
    · <b>유닛 클릭/우클릭</b> → 능력 발동.<br>
    · <b>카드 플레이·능력 메뉴</b>는 바깥 터치, <b>[✖ 닫기]</b>, <b>Esc</b>로 닫습니다. 효과·대상 선택 창은 창 안의 버튼으로 선택을 완료하세요.<br>
    · <b>카드 확대(효과 크게 보기)</b>: 카드를 <b>우클릭</b>, <b>꾹 누르기</b> 또는 <b>Alt+클릭</b> (닫기: 바깥 클릭/Esc). 유닛은 우클릭이 능력 메뉴라 꾹 누르기/Alt+클릭.<br>
    · 자동화가 안 되는 효과는 ⚙️ 알림이 뜹니다.<br>
    · <b>밴 리스트</b>: 덱 관리/덱 편집 화면의 [🚫 밴 리스트] 버튼에서 확인. 온라인 방·P2P에서 <b>양쪽 모두 '밴 적용'을 선택</b>하면 밴 카드 포함 덱은 사용할 수 없습니다.<br>
    · 기지은 안전지대이며 유닛은 기지↔전장으로 이동합니다. [개입]은 전장 간 이동 가능.<br>
    </div>`;
    const hbtns=document.createElement('div'); hbtns.className='modal-btns';
    const hclose=document.createElement('button'); hclose.className='primary'; hclose.textContent='설정으로 돌아가기';
    hclose.onclick=openSystemMenu;
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
