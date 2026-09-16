// ══════════ 덱 이미지 내보내기 ══════════
// 덱 관리의 [🖼 이미지 저장] — 덱 전체를 PNG 한 장으로 그린다.
// 위 줄: 전설 · 선발 챔피언 · 전장 3 · 룬(종류별 장수). 아래: 메인 덱을 비용순으로 늘어놓고 카드마다 ×장수.
// 사이드덱이 있으면 그 아래 한 구역 더. 카드 그림은 게임이 쓰는 로컬 webp(assets/cards)를 그대로 쓴다.
// 미리보기 창에서 [💾 PNG 저장](파일)·[📋 이미지 복사](클립보드) 중 고른다.

const DECK_IMG = {
  W: 1600, PAD: 44, GAP: 14,
  TOP_W: 200,            // 전설·챔피언·전장·룬 (위 줄) 카드 너비
  MAIN_COLS: 8,          // 메인·사이드 카드 열 수
  RATIO: 1039 / 744,     // 카드 원본 비율 (세로/가로)
  FONT: "'Segoe UI','Malgun Gothic','Apple SD Gothic Neo',sans-serif",
};

// 그림 하나를 불러온다. 실패해도 예외를 던지지 않고 null (자리에 이름만 쓴다).
function deckImgLoad(url){
  return new Promise(res=>{
    if(!url) return res(null);
    const im=new Image();
    // 다른 출처(CDN)에서 올 때만 CORS 요청 — 그래야 캔버스가 오염되지 않는다. 로컬(assets/)은 그대로.
    if(/^https?:/i.test(url) && !url.startsWith(location.origin)) im.crossOrigin='anonymous';
    im.onload=()=>res(im); im.onerror=()=>res(null);
    im.src=url;
  });
}

// 둥근 사각형 경로
function deckImgRR(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

// 카드 한 장: 그림(없으면 이름 상자) + 오른쪽 아래 ×장수 + 밴이면 왼쪽 위 🚫
function deckImgCard(ctx, im, c, x, y, w, h, cnt, label){
  ctx.save();
  deckImgRR(ctx,x,y,w,h,Math.round(w*0.045)); ctx.clip();
  if(im){ ctx.drawImage(im,x,y,w,h); }
  else {
    ctx.fillStyle='#22335a'; ctx.fillRect(x,y,w,h);
    ctx.fillStyle='#e8e6e0'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font=`bold ${Math.round(w*0.09)}px ${DECK_IMG.FONT}`;
    const words=String(c.ko||'').split(' '); let line='', ly=y+h/2-(words.length>1?w*0.06:0);
    for(const wd of words){
      const t=line?line+' '+wd:wd;
      if(ctx.measureText(t).width>w-16 && line){ ctx.fillText(line,x+w/2,ly); line=wd; ly+=w*0.12; } else line=t;
    }
    ctx.fillText(line,x+w/2,ly);
  }
  ctx.restore();
  ctx.lineWidth=2; ctx.strokeStyle='rgba(255,255,255,0.18)';
  deckImgRR(ctx,x+1,y+1,w-2,h-2,Math.round(w*0.045)); ctx.stroke();
  // 위 줄 소제목 (전설·챔피언·전장·룬)
  if(label){
    ctx.font=`bold ${Math.round(w*0.085)}px ${DECK_IMG.FONT}`;
    const tw=ctx.measureText(label).width+18, th=Math.round(w*0.13);
    ctx.fillStyle='rgba(8,12,22,0.82)';
    deckImgRR(ctx,x+8,y+8,tw,th,6); ctx.fill();
    ctx.fillStyle='#d8c27a'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(label,x+17,y+8+th/2+1);
  }
  // ×장수 배지
  if(cnt){
    const r=Math.round(w*0.16), bx=x+w-r-6, by=y+h-r-6;
    ctx.beginPath(); ctx.arc(bx,by,r,0,Math.PI*2);
    ctx.fillStyle='rgba(8,12,22,0.9)'; ctx.fill();
    ctx.lineWidth=3; ctx.strokeStyle=cnt>=3?'#d8c27a':'#8fa3d0'; ctx.stroke();
    ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font=`bold ${Math.round(r*1.05)}px ${DECK_IMG.FONT}`;
    ctx.fillText('×'+cnt,bx,by+1);
  }
  if(typeof isBanned==='function' && isBanned(c.n)){
    ctx.font=`${Math.round(w*0.14)}px ${DECK_IMG.FONT}`; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText('🚫',x+6,y+(label?Math.round(w*0.15):0)+6);
  }
}

// 덱 하나를 캔버스에 그려 돌려준다
async function renderDeckImage(d){
  const K=DECK_IMG, W=K.W, PAD=K.PAD, GAP=K.GAP;
  const legend=card(d.legendN), champ=d.champN?card(d.champN):null;
  const group=arr=>{ const m=new Map(); for(const n of (arr||[])) m.set(n,(m.get(n)||0)+1);
    return [...m.entries()].map(([n,cnt])=>({c:card(n),cnt}))
      .sort((a,b)=>((a.c.e??0)-(b.c.e??0)) || (a.c.n-b.c.n)); };
  const main=group(d.main), side=group(d.side), runes=group(d.runes);
  const bfs=(d.bfs||[]).map(n=>({c:card(n),cnt:0}));
  const mainCnt=(d.main||[]).length, sideCnt=(d.side||[]).length;

  // 이 덱에서 고른 대체 일러스트가 있으면 그 그림으로
  const prevArt=(typeof ART_PREVIEW!=='undefined')?ART_PREVIEW:null;
  if(typeof ART_PREVIEW!=='undefined') ART_PREVIEW=d.arts||null;
  const url=(c,w)=>{ const u=artImg(c); return u?cardImgUrl(u,w):null; };
  const top=[{c:legend,label:'전설'}, ...(champ?[{c:champ,label:'챔피언'}]:[]), ...bfs.map(b=>({c:b.c,label:'전장'})), ...runes.map(r=>({c:r.c,cnt:r.cnt,label:'룬'}))];
  const all=[...top.map(t=>({...t,w:480})), ...main.map(m=>({...m,w:280})), ...side.map(m=>({...m,w:280}))];
  const imgs=await Promise.all(all.map(a=>deckImgLoad(url(a.c,a.w))));
  if(typeof ART_PREVIEW!=='undefined') ART_PREVIEW=prevArt;

  // 치수 계산
  const topH=Math.round(K.TOP_W*K.RATIO);
  const colW=Math.floor((W-PAD*2-GAP*(K.MAIN_COLS-1))/K.MAIN_COLS), colH=Math.round(colW*K.RATIO);
  const rowsOf=n=>Math.ceil(n/K.MAIN_COLS);
  const HEAD=132, SEC=44;
  const mainBlock=SEC+rowsOf(main.length)*(colH+GAP);
  const sideBlock=side.length?SEC+rowsOf(side.length)*(colH+GAP)+10:0;
  const H=PAD+HEAD+topH+GAP*2+mainBlock+sideBlock+40;

  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');
  const bg=ctx.createLinearGradient(0,0,0,H); bg.addColorStop(0,'#0e1420'); bg.addColorStop(1,'#182238');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // 머리: 덱 이름 · 요약
  let y=PAD;
  ctx.fillStyle='#f0e6c0'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.font=`bold 46px ${K.FONT}`;
  let name=d.name||'덱';
  while(ctx.measureText(name).width>W-PAD*2-260 && name.length>1) name=name.slice(0,-1);
  if(name!==(d.name||'덱')) name+='…';
  ctx.fillText(name,PAD,y);
  const doms=(legend.dom||[]).map(x=>DOMAIN_KO[x]||x).join('/');
  ctx.fillStyle='#9aa4bd'; ctx.font=`22px ${K.FONT}`;
  const runeTxt=runes.map(r=>`${DOMAIN_KO[(r.c.dom||[])[0]]||r.c.ko} ×${r.cnt}`).join(' · ');
  ctx.fillText(`전설 ${legend.ko}${champ?` · 챔피언 ${champ.ko}`:''} · 영역 ${doms}`,PAD,y+62);
  ctx.fillText(`메인 ${mainCnt}장 · 룬 ${(d.runes||[]).length}개 (${runeTxt}) · 전장 ${bfs.length}${sideCnt?` · 사이드 ${sideCnt}장`:''}`,PAD,y+94);
  // 오른쪽 위: 출처
  ctx.textAlign='right'; ctx.fillStyle='#5f6d92'; ctx.font=`20px ${K.FONT}`;
  ctx.fillText('리프트바운드 시뮬레이터',W-PAD,y+4);
  const now=new Date(), pad2=v=>String(v).padStart(2,'0');
  ctx.fillText(`${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`,W-PAD,y+32);
  ctx.textAlign='left';
  y+=HEAD;

  // 위 줄
  let x=PAD, ii=0;
  for(const t of top){
    deckImgCard(ctx,imgs[ii++],t.c,x,y,K.TOP_W,topH,t.cnt,t.label);
    x+=K.TOP_W+GAP;
  }
  y+=topH+GAP*2;

  const section=(title,list)=>{
    ctx.fillStyle='#d8c27a'; ctx.font=`bold 26px ${K.FONT}`; ctx.textBaseline='top'; ctx.textAlign='left';
    ctx.fillText(title,PAD,y);
    ctx.strokeStyle='rgba(216,194,122,0.35)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(PAD+ctx.measureText(title).width+14,y+17); ctx.lineTo(W-PAD,y+17); ctx.stroke();
    y+=SEC;
    list.forEach((m,i)=>{
      const cx=PAD+(i%K.MAIN_COLS)*(colW+GAP), cy=y+Math.floor(i/K.MAIN_COLS)*(colH+GAP);
      deckImgCard(ctx,imgs[ii++],m.c,cx,cy,colW,colH,m.cnt,null);
    });
    y+=rowsOf(list.length)*(colH+GAP);
  };
  section(`메인 덱 ${mainCnt}장 (${main.length}종)`,main);
  if(side.length){ y+=10; section(`사이드덱 ${sideCnt}장`,side); }

  // 밴 카드 안내 (있을 때만)
  const banned=(typeof deckBannedCards==='function')?deckBannedCards(d):[];
  if(banned.length){
    ctx.fillStyle='#ff9c9c'; ctx.font=`20px ${K.FONT}`; ctx.textBaseline='top'; ctx.textAlign='left';
    ctx.fillText('🚫 밴 카드 포함: '+banned.map(n=>card(n).ko).join(', '),PAD,y+4);
  }
  return cv;
}

// 파일 이름에 못 쓰는 글자를 뺀다
function deckImgFileName(d){
  const n=String(d.name||'덱').replace(/[\\/:*?"<>|]+/g,' ').trim().slice(0,40)||'덱';
  return `${n}.png`;
}

// 덱 관리 → [🖼 이미지 저장]: 그려서 미리보기 창에 띄우고 저장/복사를 고르게 한다
async function exportDeckImage(d){
  UI.toast('덱 이미지를 그리는 중…');
  let cv, blob;
  try{
    cv=await renderDeckImage(d);
    blob=await new Promise((res,rej)=>cv.toBlob(b=>b?res(b):rej(new Error('PNG 변환 실패')),'image/png'));
  }catch(e){
    // 캔버스 오염(다른 출처 그림) 등 — 어떤 환경에서 막혔는지 알 수 있게 메시지를 그대로 보여준다
    UI.toast('이미지를 만들지 못했습니다 — '+(e && e.message || e),'warn'); return;
  }
  const objUrl=URL.createObjectURL(blob);
  const box=document.getElementById('modal-box');
  box.innerHTML=`<h3>🖼 「${esc(d.name)}」 덱 이미지</h3>
    <div style="font-size:12px;color:#8f9bb3;margin-bottom:6px">PNG ${cv.width}×${cv.height} · ${(blob.size/1024).toFixed(0)}KB — 저장하거나 클립보드로 복사해 카톡·게시판에 붙여넣으세요.</div>
    <div style="max-height:min(60vh,620px);overflow:auto;border:1px solid #3a4a70;border-radius:8px;background:#0e1626">
      <img src="${objUrl}" alt="" style="display:block;width:100%;max-width:900px"></div>`;
  const btns=document.createElement('div'); btns.className='modal-btns';
  const save=document.createElement('button'); save.className='primary'; save.textContent='💾 PNG 저장';
  save.onclick=()=>{
    const a=document.createElement('a'); a.href=objUrl; a.download=deckImgFileName(d);
    document.body.appendChild(a); a.click(); a.remove();
    UI.toast(`「${deckImgFileName(d)}」 저장`);
  };
  const cp=document.createElement('button'); cp.textContent='📋 이미지 복사';
  cp.onclick=async ()=>{
    try{
      if(!navigator.clipboard || !window.ClipboardItem) throw new Error('이 환경은 이미지 클립보드를 지원하지 않습니다');
      await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
      UI.toast('이미지를 클립보드에 복사했습니다 — 붙여넣기(Ctrl+V)로 쓰세요');
    }catch(e){ UI.toast('복사하지 못했습니다 — '+(e && e.message || e)+'. [PNG 저장]을 이용하세요','warn'); }
  };
  const cl=document.createElement('button'); cl.textContent='닫기';
  cl.onclick=()=>{ closeModal(); setTimeout(()=>URL.revokeObjectURL(objUrl), 60000); };
  btns.appendChild(save); btns.appendChild(cp); btns.appendChild(cl); box.appendChild(btns);
  openModal(); markModalDismissable();
}
