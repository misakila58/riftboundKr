// ══════════ 등급전 (랭크) — 클라이언트 ══════════
// 서버(server.js 등급전 모듈)와 짝: MMR(Elo, 시작 1200)·티어 구간·시즌 칭호는 서버가 계산하고, 여기서는 화면만 그린다.
//  · 메뉴 [🏆 등급전] → 덱·형식(Bo1/Bo3) 선택 → 매칭 큐 → 서버가 짝지어 방을 만들어 start
//  · 게임(매치)이 끝나면 양쪽 클라이언트가 승자를 보고 → 서버가 일치할 때만 MMR 반영 → rankUpdate 수신
//  · 아이디 옆 등급 표시(뱃지)는 리그 오브 레전드식 티어 이름·디비전을 쓰되 그림은 자체 SVG (공식 이미지는 쓰지 않는다)
//  · 시즌이 끝나면 최종 등급이 칭호로 남고, 프로필 관리에서 장착한 칭호는 상대에게도 보인다
const RANK = {
  me: null,          // /api/rank 요약
  queued: null,      // {format, since} 매칭 대기 중
  TIERS: {
    unranked:   { ko:'배치 중',     c1:'#6b7280', c2:'#374151' },
    iron:       { ko:'아이언',      c1:'#8a8a8a', c2:'#4a4a4a' },
    bronze:     { ko:'브론즈',      c1:'#c47a3a', c2:'#6b3f1d' },
    silver:     { ko:'실버',        c1:'#c9d1d9', c2:'#6e7a86' },
    gold:       { ko:'골드',        c1:'#f1c40f', c2:'#9a6c00' },
    platinum:   { ko:'플래티넘',    c1:'#5fd6c4', c2:'#1f7a6d' },
    emerald:    { ko:'에메랄드',    c1:'#3ddc84', c2:'#137a45' },
    diamond:    { ko:'다이아몬드',  c1:'#7fd0ff', c2:'#2f5fb3' },
    master:     { ko:'마스터',      c1:'#c77dff', c2:'#5a1a9a' },
    grandmaster:{ ko:'그랜드마스터', c1:'#ff5c5c', c2:'#8a0f0f' },
    challenger: { ko:'챌린저',      c1:'#ffe27a', c2:'#2bb3d9' },
  },
  ROMAN: { 1:'I', 2:'II', 3:'III', 4:'IV' },
  // 뱃지 SVG (작은 방패 문장 + 디비전). rank: {tier, div, label} — null이면 빈 문자열
  badgeHTML(rank, opts={}){
    if(!rank || !rank.tier) return '';
    const t=RANK.TIERS[rank.tier]||RANK.TIERS.unranked;
    const size=opts.size||18, id='rg'+rank.tier;
    const div=rank.div?RANK.ROMAN[rank.div]:'';
    const title=esc(rank.label||t.ko)+(rank.mmr!=null&&opts.mmr?` · MMR ${rank.mmr}`:'');
    return `<span class="rank-badge rank-${esc(rank.tier)}" title="${title}" style="--rb:${size}px">`+
      `<svg viewBox="0 0 24 26" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.c1}"/><stop offset="1" stop-color="${t.c2}"/></linearGradient></defs>`+
      `<path d="M12 1 L22 5 V13 C22 19 17 23 12 25 C7 23 2 19 2 13 V5 Z" fill="url(#${id})" stroke="#0e1420" stroke-width="1.2"/>`+
      `<path d="M12 5 L18 7.5 V13 C18 16.6 15 19.6 12 21 C9 19.6 6 16.6 6 13 V7.5 Z" fill="none" stroke="#ffffff66" stroke-width="1"/></svg>`+
      (div?`<b>${div}</b>`:'')+`</span>`;
  },
  // 이름 + 뱃지 + (장착 칭호) 한 줄 HTML
  nameHTML(name, rank){
    let s=esc(name||'');
    if(rank){ s+=' '+RANK.badgeHTML(rank,{mmr:true}); if(rank.title) s+=` <span class="rank-title" title="지난 시즌 칭호">${esc(rank.title.season)} ${rank.title.format.toUpperCase()} ${esc(rank.title.label)}</span>`; }
    return s;
  },
  rankOfSeat(seat){
    const ls=NET.lastStart; const pl=ls&&ls.players&&ls.players[seat];
    return pl&&pl.rank?pl.rank:null;
  },
  isRankedGame(){ return !!(NET.online && NET.lastStart && NET.lastStart.ranked); },

  // ── 등급전 화면 ──
  async open(){
    if(!NET.token){ UI.toast('등급전은 서버 계정으로 로그인해야 합니다','warn'); return; }
    if(!myDecks.length && !DeckStore._read().length){ alert('먼저 덱을 만들어주세요! (내 덱 관리)'); return; }
    try{ if(!NET.ws || NET.ws.readyState!==1) await NET.connect(); }catch(e){ alert(e.message); return; }
    RANK.fillDeckSelect();
    showScreen('ranked-screen');
    await RANK.refresh();
  },
  fillDeckSelect(){
    const sel=document.getElementById('ranked-deck'); sel.innerHTML='';
    myDecks.forEach((d,i)=>{ const o=document.createElement('option'); o.value='s'+i; o.textContent=`${d.name} (${card(d.legendN).ko})`; if(deckBannedCards(d).length) o.textContent+=' 🚫'; sel.appendChild(o); });
    DeckStore._read().forEach((d,i)=>{ const o=document.createElement('option'); o.value='l'+i; o.textContent=`📱 ${d.name} (${card(d.legendN).ko}) — 이 기기`; if(deckBannedCards(d).length) o.textContent+=' 🚫'; sel.appendChild(o); });
  },
  selectedDeck(){
    const v=document.getElementById('ranked-deck').value;
    if(v && v[0]==='l') return DeckStore._read()[+v.slice(1)]||null;
    return myDecks[+String(v).replace(/^s/,'')]||null;
  },
  async refresh(){
    try{ RANK.me=await NET.api('/api/rank'); }catch(e){ UI.toast('등급 정보를 불러오지 못했습니다 — '+e.message,'warn'); return; }
    RANK.renderSummary();
  },
  fmtRank(s){ return RANK.badgeHTML({tier:s.tier,div:s.div,label:s.label},{size:26})+` <b>${esc(s.label)}</b> <span class="rank-mmr">MMR ${s.mmr}</span> · ${s.win}승 ${s.lose}패${s.streak>=2?` · ${s.streak}연승`:''}`; },   // 배치 중이면 label 자체가 '배치 n/5'
  renderSummary(){
    const me=RANK.me; if(!me) return;
    const el=document.getElementById('ranked-summary');
    el.innerHTML=`<div class="rank-row"><span class="rank-fmt">단판 Bo1</span>${RANK.fmtRank(me.bo1)}</div>
      <div class="rank-row"><span class="rank-fmt">2선승 Bo3</span>${RANK.fmtRank(me.bo3)}</div>
      <div class="hint" style="font-size:12px">시즌 ${esc(me.season)} · 배치 ${me.placement}판 뒤 등급이 표시됩니다 · 등급전은 밴 리스트가 항상 적용됩니다 · 이탈·미복귀는 패배 처리</div>`;
    document.getElementById('menu-rank-line').innerHTML = `Bo1 ${RANK.badgeHTML({tier:me.bo1.tier,div:me.bo1.div,label:me.bo1.label})} ${esc(me.bo1.label)} · Bo3 ${RANK.badgeHTML({tier:me.bo3.tier,div:me.bo3.div,label:me.bo3.label})} ${esc(me.bo3.label)}`;
  },
  queue(){
    const deck=RANK.selectedDeck();
    if(!deck){ UI.toast('덱을 선택하세요','warn'); return; }
    if(deckBannedCards(deck).length){ UI.toast('🚫 등급전은 밴 카드가 든 덱으로 참가할 수 없습니다: '+deckBannedCards(deck).map(n=>card(n).ko).join(', '),'warn'); return; }
    const format=document.querySelector('input[name="ranked-format"]:checked')?.value==='bo3'?'bo3':'bo1';
    MATCH.myDeck=deck;
    const v=document.getElementById('ranked-deck').value;
    const pay = v[0]==='l' ? {deck:deckForMatch(deck)} : {deckIdx:+String(v).replace(/^s/,'')};
    NET.send({t:'rankQueue', format, ...pay, ver:NET.clientVersion()});
  },
  cancel(){ NET.send({t:'rankCancel'}); },
  onQueued(m){
    RANK.queued={format:m.format, since:Date.now()};
    document.getElementById('btn-ranked-queue').hidden=true; document.getElementById('btn-ranked-cancel').hidden=false;
    RANK._tick();
    clearInterval(RANK._timer); RANK._timer=setInterval(RANK._tick, 1000);
  },
  _tick(){
    const q=RANK.queued; if(!q) return;
    const s=Math.floor((Date.now()-q.since)/1000);
    document.getElementById('ranked-status').textContent=`⏳ ${q.format.toUpperCase()} 매칭 중… ${s}초 (MMR이 비슷한 상대부터, 기다릴수록 범위가 넓어집니다)`;
  },
  onCancelled(){
    RANK.queued=null; clearInterval(RANK._timer);
    document.getElementById('btn-ranked-queue').hidden=false; document.getElementById('btn-ranked-cancel').hidden=true;
    document.getElementById('ranked-status').textContent='매칭을 취소했습니다.';
  },
  onStart(){ RANK.queued=null; clearInterval(RANK._timer); const b=document.getElementById('btn-ranked-queue'); if(b){ b.hidden=false; document.getElementById('btn-ranked-cancel').hidden=true; document.getElementById('ranked-status').textContent=''; } },

  // ── 결과 보고 (승리 창에서) ──
  // 단판: 게임 승자. Bo3: 매치가 끝났을 때(2승) 매치 승자. 양쪽 클라이언트가 같은 값을 보내야 서버가 반영한다.
  onGameEnd(winner){
    if(!RANK.isRankedGame() || NET.spectating) return;
    const bo3 = typeof MATCH!=='undefined' && MATCH.active();
    if(bo3 && !MATCH.finished()) return;
    const w = bo3 ? (MATCH.wins[0]>MATCH.wins[1]?0:1) : winner;
    NET.send({t:'rankResult', winner:w});
    RANK._pendingLine=true;
  },
  // 승리 창 꾸미기: 재대결 버튼 제거, 등급 변화 자리 마련
  decorateVictory(box){
    if(!RANK.isRankedGame()) return;
    box.querySelectorAll('#victory-btns button').forEach(b=>{ if(/다시 하기|새 매치/.test(b.textContent)) b.remove(); });
    const bo3 = typeof MATCH!=='undefined' && MATCH.active();
    if(bo3 && !MATCH.finished()) return;
    const line=document.createElement('div'); line.id='rank-result-line'; line.className='rank-result-line';
    line.textContent='🏆 등급 반영 중… (양쪽 결과 확인)';
    const sb=box.querySelector('.match-score-line')||box.querySelector('.result-scoreboard');
    if(sb) sb.insertAdjacentElement('afterend', line);
  },
  onUpdate(m){
    let text;
    if(m.void){ text='⚠ 양쪽 결과 보고가 달라 등급에 반영하지 않았습니다.'; }
    else {
      const d=m.after-m.before, sign=d>=0?'+':'';
      const tierMsg = m.tierBefore && m.tier && m.tierBefore.label!==m.tier.label ? ` · ${m.tierBefore.label} → <b>${esc(m.tier.label)}</b>` : ` · ${esc(m.tier.label)}`;
      text=`🏆 ${m.format.toUpperCase()} 등급전 ${m.win?'승리':'패배'}: MMR ${m.before} → <b>${m.after}</b> (${sign}${d})${tierMsg}${m.how?` <small>(${esc(m.how)})</small>`:''}`;
    }
    const line=document.getElementById('rank-result-line');
    if(line) line.innerHTML=text; else UI.toast(text.replace(/<[^>]+>/g,''), m.void?'warn':undefined);
    UI.log(text.replace(/<[^>]+>/g,''),'sys');
    RANK.refresh().catch(()=>{});
  },

  // ── 프로필 관리 ──
  async openProfile(){
    if(!NET.token){ UI.toast('프로필은 서버 계정으로 로그인해야 관리할 수 있습니다','warn'); return; }
    try{ RANK.me=await NET.api('/api/rank'); }catch(e){ UI.toast('불러오지 못했습니다 — '+e.message,'warn'); return; }
    const me=RANK.me, box=document.getElementById('modal-box');
    const titleKey=t=>t.season+'|'+t.format;
    const cur=me.title?titleKey(me.title):'';
    box.innerHTML=`<h3>👤 프로필 관리 — ${esc(NET.userId)}</h3>
      <div class="modal-copy" style="font-size:13px">
        <div class="rank-row"><span class="rank-fmt">Bo1</span>${RANK.fmtRank(me.bo1)}</div>
        <div class="rank-row"><span class="rank-fmt">Bo3</span>${RANK.fmtRank(me.bo3)}</div>
        <div class="hint" style="font-size:12px;margin-top:4px">현재 시즌 ${esc(me.season)}. 시즌이 끝나면 최종 등급이 칭호로 남습니다.</div>
      </div>
      <h4 style="margin:10px 0 4px">🎖 시즌 칭호 (장착하면 상대에게 아이디 옆에 보입니다)</h4>
      <div id="profile-titles"></div>`;
    const list=box.querySelector('#profile-titles');
    const opt=(key,label,html)=>{ const l=document.createElement('label'); l.className='profile-title-opt'; l.innerHTML=`<input type="radio" name="profile-title" value="${esc(key)}"${key===cur?' checked':''}> ${html}`; list.appendChild(l); };
    opt('', '없음', '<span>칭호 없음</span>');
    if(!me.titles.length) list.insertAdjacentHTML('beforeend','<div class="hint" style="font-size:12px">아직 받은 칭호가 없습니다 — 시즌이 끝날 때 그 시즌의 최종 등급이 칭호로 지급됩니다.</div>');
    me.titles.forEach(t=>opt(titleKey(t), t.label, `${RANK.badgeHTML({tier:t.tier,div:t.div,label:t.label})} <b>${esc(t.season)} ${t.format.toUpperCase()} ${esc(t.label)}</b> <small>MMR ${t.mmr}</small>`));
    const btns=document.createElement('div'); btns.className='modal-btns';
    const ok=document.createElement('button'); ok.className='primary'; ok.textContent='저장';
    ok.onclick=async ()=>{
      const v=box.querySelector('input[name="profile-title"]:checked')?.value||'';
      const [season,format]=v.split('|');
      try{ await NET.api('/api/profile','POST',{title: v?{season,format}:null}); UI.toast(v?'칭호를 장착했습니다':'칭호를 해제했습니다'); closeModal(); }
      catch(e){ UI.toast('저장 실패 — '+e.message,'warn'); }
    };
    const lb=document.createElement('button'); lb.textContent='🏅 리더보드'; lb.onclick=()=>RANK.openLeaderboard();
    const cl=document.createElement('button'); cl.textContent='닫기'; cl.onclick=closeModal;
    btns.append(ok,lb,cl); box.appendChild(btns);
    openModal(); markModalDismissable();
  },
  async openLeaderboard(format){
    format=format||'bo1';
    let d; try{ d=await NET.api('/api/rank/leaderboard?format='+format); }catch(e){ UI.toast('불러오지 못했습니다 — '+e.message,'warn'); return; }
    const box=document.getElementById('modal-box');
    box.innerHTML=`<h3>🏅 리더보드 — ${format.toUpperCase()} · 시즌 ${esc(d.season)}</h3>
      <div style="margin-bottom:6px"><button class="mid-btn${format==='bo1'?' primary-btn':''}" id="lb-bo1">Bo1</button> <button class="mid-btn${format==='bo3'?' primary-btn':''}" id="lb-bo3">Bo3</button></div>
      <div class="rank-lb">${d.rows.length?d.rows.map((r,i)=>`<div class="rank-row"><span class="rank-pos">${i+1}</span>${RANK.badgeHTML({tier:r.tier,label:r.label})} <b>${esc(r.id)}</b> <span>${esc(r.label)}</span> <span class="rank-mmr">MMR ${r.mmr}</span> <small>${r.win}승/${r.games}판</small></div>`).join(''):'<div class="hint">배치를 마친 플레이어가 아직 없습니다.</div>'}</div>`;
    box.querySelector('#lb-bo1').onclick=()=>RANK.openLeaderboard('bo1'); box.querySelector('#lb-bo3').onclick=()=>RANK.openLeaderboard('bo3');
    const btns=document.createElement('div'); btns.className='modal-btns';
    const cl=document.createElement('button'); cl.textContent='닫기'; cl.onclick=closeModal; btns.appendChild(cl); box.appendChild(btns);
    openModal(); markModalDismissable();
  },
  init(){
    document.getElementById('btn-goto-ranked').onclick=()=>RANK.open();
    document.getElementById('btn-ranked-back').onclick=()=>{ if(RANK.queued) RANK.cancel(); showScreen('menu-screen'); };
    document.getElementById('btn-ranked-queue').onclick=()=>RANK.queue();
    document.getElementById('btn-ranked-cancel').onclick=()=>RANK.cancel();
    document.getElementById('btn-ranked-profile').onclick=()=>RANK.openProfile();
    document.getElementById('btn-ranked-leaderboard').onclick=()=>RANK.openLeaderboard();
    document.getElementById('btn-deck-profile').onclick=()=>RANK.openProfile();
    NET.onRankQueued=m=>RANK.onQueued(m);
    NET.onRankCancelled=()=>RANK.onCancelled();
    NET.onRankUpdate=m=>RANK.onUpdate(m);
  },
};
