// 선택은 기기에 저장하고 온라인에서는 고정 목록의 인덱스만 교환한다. 게임 상태에는 넣지 않는다.
const PLAYMAT = {
  key: 'rb_my_playmat',
  botKey: 'rb_bot_playmat',
  names: ['르블랑','마이','미포','바이징크스','볼베','뽀삐','아리','아리2','이렐','징크스','케일몰가','티모'],
  selected: '',
  botSelected: '',
  // 네트워크 인덱스 계약: 기존 names의 순서는 유지하고 새 이미지는 끝에 추가한다. -1은 기본 배경.
  onlineIndices: [-1,-1],
  onlineSeed: null,
  index(){ return this.names.indexOf(this.selected); },
  startOnline(seed){
    this.onlineSeed=seed;
    this.onlineIndices=[-1,-1];
    this.onlineIndices[NET.seat]=this.index();
    this.apply();
    this.send(true);
  },
  send(request=false){
    NET.sendAction({k:'playmat',p:NET.seat,index:this.onlineIndices[NET.seat],seed:this.onlineSeed,request});
  },
  receive(a,seat){
    if(!NET.online || (seat!==0 && seat!==1) || a.p!==seat || a.seed!==this.onlineSeed) return;
    if(!Number.isInteger(a.index) || a.index < -1 || a.index>=this.names.length) return;
    this.onlineIndices[seat]=a.index;
    this.apply();
    // 상대가 먼저 시작해 보낸 값이 내 초기화 전에 도착해도, 나중 요청에 대한 응답으로 서로 채운다.
    if(seat!==NET.seat && a.request===true) this.send();
  },
  available(){
    return !NET.online && !(typeof REPLAY!=='undefined' && REPLAY.viewing);
  },
  botAvailable(){
    return this.available() && typeof BOT!=='undefined' && BOT.active;
  },
  // CSS 변수의 상대 URL은 style.css 위치에서 해석되므로 문서 기준 절대 URL을 사용한다.
  url(name){ return new URL('assets/playmat/'+encodeURIComponent(name)+'.png', document.baseURI).href; },
  apply(){
    const seat = (typeof BOT!=='undefined' && BOT.active) ? 1-BOT.seat : 0;
    const replay=typeof REPLAY!=='undefined' && REPLAY.viewing;
    for(let p=0;p<2;p++){
      const index=replay ? -1 : NET.online ? this.onlineIndices[p] : p===seat ? this.index()
        : this.botAvailable() && p===BOT.seat ? this.names.indexOf(this.botSelected) : -1;
      const area=document.getElementById('parea-'+p);
      area.classList.toggle('has-playmat', index>=0 && index<this.names.length);
      area.dataset.playmatIndex=String(index);
    }
    this.layout();
  },
  layout(){
    const board=document.getElementById('board');
    const fields=document.getElementById('battlefields');
    const middle=fields.offsetTop+fields.offsetHeight/2;
    for(let p=0;p<2;p++){
      const area=document.getElementById('parea-'+p);
      const side=area.classList.contains('top')?'upper':'lower';
      const active=area.classList.contains('has-playmat');
      board.classList.toggle('playmat-'+side,active);
      board.style.setProperty('--playmat-'+side+'-shade',active?'rgba(18,26,44,.35)':'rgba(22,32,58,.85)');
      if(!active){ board.style.removeProperty('--playmat-'+side+'-image'); continue; }
      const start=side==='upper'?area.offsetTop:middle;
      const end=side==='upper'?middle:area.offsetTop+area.offsetHeight;
      board.style.setProperty('--playmat-'+side+'-image', 'url("'+this.url(this.names[+area.dataset.playmatIndex])+'")');
      board.style.setProperty('--playmat-'+side+'-top',start+'px');
      board.style.setProperty('--playmat-'+side+'-height',Math.max(0,end-start)+'px');
    }
    board.classList.toggle('has-playmat',board.classList.contains('playmat-upper')||board.classList.contains('playmat-lower'));
    board.style.setProperty('--playmat-left',fields.offsetLeft+'px');
    board.style.setProperty('--playmat-width',fields.offsetWidth+'px');
  },
  open(forBot=false){
    if(!this.available() || (forBot && !this.botAvailable())) return;
    const field=forBot?'botSelected':'selected';
    const key=forBot?this.botKey:this.key;
    const box=document.getElementById('modal-box');
    box.innerHTML='<h3>'+(forBot?'봇 플레이매트':'내 플레이매트')+'</h3><p class="playmat-hint">전장 너비에 맞춰 이미지 비율을 유지해 표시합니다. 선택은 이 기기에 저장됩니다.</p>';
    const grid=document.createElement('div'); grid.className='playmat-grid';
    const status=document.createElement('p'); status.className='playmat-hint';
    status.setAttribute('role','status');
    const buttons=[];
    for(const name of ['', ...this.names]){
      const button=document.createElement('button');
      button.type='button'; button.className='playmat-option';
      button.setAttribute('aria-pressed', String(name===this[field]));
      if(name){
        const img=document.createElement('img'); img.src=this.url(name); img.alt='';
        img.loading='lazy'; img.decoding='async'; button.appendChild(img);
      }else{
        const preview=document.createElement('span'); preview.className='playmat-default';
        button.appendChild(preview);
      }
      const label=document.createElement('span'); label.textContent=name || '기본 배경';
      button.appendChild(label);
      button.onclick=()=>{
        this[field]=name; this.apply();
        buttons.forEach(([b,n])=>b.setAttribute('aria-pressed', String(n===name)));
        status.textContent=(name || '기본 배경')+' 적용됨';
        try{ localStorage.setItem(key, name); }
        catch(e){ status.textContent+=' · 설정을 저장하지 못했습니다. 이번 실행에만 적용됩니다.'; }
      };
      buttons.push([button,name]); grid.appendChild(button);
    }
    box.appendChild(grid); box.appendChild(status);
    const actions=document.createElement('div'); actions.className='modal-btns';
    const done=document.createElement('button'); done.className='primary';
    done.textContent='완료'; done.onclick=closeModal;
    actions.appendChild(done); box.appendChild(actions);
    openModal(); markModalDismissable();
  },
};
try{
  const saved=localStorage.getItem(PLAYMAT.key);
  if(PLAYMAT.names.includes(saved)) PLAYMAT.selected=saved;
  const botSaved=localStorage.getItem(PLAYMAT.botKey);
  if(PLAYMAT.names.includes(botSaved)) PLAYMAT.botSelected=botSaved;
}catch(e){}
// 창 크기·화면 배율·게임 화면 표시가 바뀌어도 전장 중앙선에 맞춘다.
window.addEventListener('DOMContentLoaded', ()=>{
  const observer=new ResizeObserver(()=>PLAYMAT.layout());
  for(const id of ['board','battlefields','parea-0','parea-1']) observer.observe(document.getElementById(id));
});
