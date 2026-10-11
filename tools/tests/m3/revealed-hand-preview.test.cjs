const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {create}=require('./engine-real-helper.cjs');
const root=process.env.BOT_TEST_SOURCE||path.resolve(__dirname,'../../../client/web/js');
const netSource=fs.readFileSync(path.join(root,'net.js'),'utf8');
const uiSource=fs.readFileSync(path.join(root,'ui.js'),'utf8');
const p2pSource=fs.readFileSync(path.join(root,'p2p.js'),'utf8');
const fxSource=fs.readFileSync(path.join(root,'fx.js'),'utf8');
const route=uiSource.slice(uiSource.indexOf('async function routedPick('),uiSource.indexOf('// 유닛 선택 (보드에서 클릭)'));
const handUI=uiSource.slice(uiSource.indexOf('UI.clearRevealedHandPreview=function'),uiSource.indexOf('// 옵션 선택 (인덱스 기반 동기화)'));
const optionUI=uiSource.slice(uiSource.indexOf('UI.pickOption = function('),uiSource.indexOf('// 위치 선택도 기존 옵션 인덱스로 동기화한다.'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Existing real-engine fixture and production routing; only DOM drawing/input is stubbed.
function client(seat,caster,transport){
  const c=create();
  c.run(`(()=>{${netSource}\nglobalThis.liveNet=NET;})();`);
  c.run(`NET.online=true;liveNet.online=true;liveNet.seat=${seat};
    liveNet.lastStart={players:[{id:'P0'},{id:'P1'}]};
    G.players[${1-caster}].hand=[1,9,9,192];
    globalThis.updates=[];globalThis.observed=0;globalThis.closed=0;
    globalThis.flights=[];
    UI.fx={captureOrigin:selector=>({game:G,selector,anchor:()=>({left:10,top:20,width:74,height:104})}),
      moveCard:(p,n,from,to,opts)=>flights.push({p,n,from,to,opts})};
    UI.log=()=>{};UI.render=()=>{};UI.prompt=()=>{};UI.promptForState=()=>{};
    (()=>{
      const NET=liveNet,_pendingRoutedPicks=new Set(),_chainSoundPreparations=new Set();let _turnGlowPick=null;
      const updateTurnGlow=()=>{},updateButtons=()=>{},optionBoardCard=o=>o.boardCard||null;
      ${route}\n${handUI}\n${optionUI}
      UI.mobileHand={
        pickRevealedHand:(p,title,options)=>new Promise(resolve=>{
          globalThis.confirmHand=index=>resolve(options.findIndex(o=>o.boardCard.index===index));
          UI.previewRevealedHandSelection(null);
        }),
        observeRevealedHand:()=>observed++,
        updateRevealedHandPreview:view=>updates.push(view.selected),
        closeRevealedHandPreview:()=>closed++
      };
    })();
    (()=>{const NET=liveNet;${p2pSource}\nglobalThis.liveP2P=P2P;})();
    liveP2P.active=${transport==='p2p'};liveP2P.isHost=${seat===0};
    liveP2P.myName='P${seat}';liveP2P.peerName='P${1-seat}';
  `);
  return c;
}

for(const transport of ['server','p2p'])for(const caster of [0,1])for(const n of [156,192])
test(`hand draft ${n}, caster ${caster}, ${transport}: owner sees positions, one final choice changes the game`,async()=>{
  const clients=[0,1].map(seat=>client(seat,caster,transport)),messages=[];
  const owner=1-caster;
  for(const [seat,c] of clients.entries()){
    c.context.relay=message=>{
      const m=JSON.parse(JSON.stringify({...message,seat,from:'P'+seat}));messages.push(m);
      for(const [target,other] of clients.entries()){
        if(transport==='p2p'&&m.t==='chat'&&target===seat)continue;
        queueMicrotask(()=>other.run(m.t==='chat'
          ? `${transport==='p2p'?'liveP2P._onMsg':'liveNet._selectionPreviewIntercept'}(${JSON.stringify(m)})`
          : `liveNet._resolveChoice(${JSON.stringify(m)})`));
      }
    };
    c.run('liveNet.send=relay;');
  }
  const effects=clients.map(c=>c.run(`execOps([{op:'revealHandPick',filter:'${n===156?'nonunit':'any'}',action:'${n===156?'recycle':'discard'}'}],{p:${caster},n:${n},kind:'spell'})`));
  await tick();
  assert.equal(clients[owner].run('observed'),1);
  const before=clients.map(c=>c.run('JSON.stringify(G)'));
  clients[caster].run('UI.previewRevealedHandSelection(1)');await tick();
  assert.equal(clients[owner].run('UI._revealedHandView.selected'),1);
  clients[caster].run('UI.previewRevealedHandSelection(null)');await tick();
  assert.equal(clients[owner].run('UI._revealedHandView.selected'),null);
  clients[caster].run('UI.previewRevealedHandSelection(2)');await tick();
  assert.equal(clients[owner].run('UI._revealedHandView.selected'),2);
  const count=messages.length;
  clients[owner].run('UI.previewRevealedHandSelection(0)');
  assert.equal(messages.length,count);
  // Sender authentication, stale choice ids, excluded/out-of-range positions and malformed messages.
  clients[owner].run(`
    const packet=(from,id,selected)=>({from,msg:'[revealed-hand-preview]'+JSON.stringify({p:${caster},id,selected})});
    liveNet._handPreviewIntercept(packet('P${owner}',1,0));
    liveNet._handPreviewIntercept(packet('P${caster}',2,0));
    for(const selected of [-1,4,'2',{},${n===156?'0,':''}undefined])liveNet._handPreviewIntercept(packet('P${caster}',1,selected));
    for(const value of ['null','{','"invalid"'])liveNet._handPreviewIntercept({from:'P${caster}',msg:'[revealed-hand-preview]'+value});
    assert.equal(UI._revealedHandView.selected,2);
    for(const flag of ['spectating','reconnecting','catchingUp']){
      liveNet[flag]=true;liveNet._handPreviewIntercept(packet('P${caster}',1,1));
      assert.equal(UI._revealedHandView.selected,2);liveNet[flag]=false;
    }
    UI._revealedHandView.selected=null;
    liveNet.requestHandPreview(${caster},1);
  `);
  await tick();
  assert.equal(clients[owner].run('UI._revealedHandView.selected'),2);
  for(const [i,c] of clients.entries()){
    assert.equal(c.run('JSON.stringify(G)'),before[i]);
    assert.equal(c.run('liveNet.choiceSeq'),1);
    assert.equal(c.run('JSON.stringify(Object.keys(liveNet.pendingChoices))'),'["1"]');
  }
  assert(messages.filter(m=>m.t==='chat').every(m=>!m.msg.includes('"n"')&&!m.msg.includes('"hand"')));
  assert.equal(messages.filter(m=>m.t==='choice').length,0);
  clients[caster].run(`globalThis.selectedOrigin={game:G,selector:'#mobile-hand-recycled .card-mini',anchor:()=>({left:20,top:30,width:84,height:118})};
    UI._revealedHandView.departure={index:2,origin:selectedOrigin};confirmHand(2);`);
  await Promise.all(effects);
  assert.equal(messages.filter(m=>m.t==='choice').length,1);
  assert.equal(clients[0].run('JSON.stringify(G)'),clients[1].run('JSON.stringify(G)'));
  for(const c of clients){
    assert.equal(c.run('G._revealHand'),null);
    assert.equal(c.run('UI._revealedHandView'),null);
    assert.equal(c.run('JSON.stringify(G.players['+owner+'].hand)'),'[1,9,192]');
    assert.equal(c.run('JSON.stringify(Object.keys(liveNet.pendingChoices))'),'[]');
    assert.equal(c.run('liveNet.choiceSeq'),1);
  }
  assert.equal(clients[owner].run('closed'),1);
  for(const c of clients)c.run(`assert.equal(flights.length,1);assert.equal(flights[0].p,${owner});assert.equal(flights[0].n,9);
    assert.equal(flights[0].to,'#${n===156?'deck':'trash'}-${owner}');
    assert.equal(flights[0].opts.handIndex,2);assert(!flights[0].opts.back);`);
  clients[caster].run('assert.equal(flights[0].from,selectedOrigin);');
  clients[owner].run(`assert.equal(flights[0].from.selector,'#hand-${owner} [data-hand-index="2"]');`);
  assert.equal(clients[owner].run(`liveNet._handPreviewIntercept({from:'P${caster}',msg:'[revealed-hand-preview]'+JSON.stringify({p:${caster},id:1,selected:1})})`),true);
});

test('a captured selection origin survives removal while later hand indices still map correctly',()=>{
  const c=create();
  const movement=fxSource.slice(fxSource.indexOf('UI.fx.moveCard = function'),fxSource.indexOf('// 손패 펼침/접힘도 기존 카드 비행을 사용한다.'));
  c.run(`const fxMoveGame=G,fxHandSlots=[[0,1,2],[]],fxMoves=[];
    const fxMotionEnabled=()=>true,document={querySelector:()=>null};
    const staged={game:G,anchor:()=>({left:5,top:6,width:84,height:118})};
    UI.fx={captureOrigin:selector=>({game:G,anchor:()=>selector})};
    ${movement}
    UI.fx.moveCard(0,9,staged,'#deck-0',{handIndex:1});
    assert.equal(fxMoves[0].anchor,staged.anchor);assert.deepEqual(fxHandSlots[0],[0,2]);
    UI.fx.moveCard(0,17,'#hand-0 [data-hand-index="1"]','#trash-0',{handIndex:1});
    assert.equal(fxMoves[1].anchor(),'#hand-0 [data-hand-index="2"]');
    assert.deepEqual(fxHandSlots[0],[0]);
  `);
});

test('cosmetic draft transport failure cannot interrupt the real choice; reset clears an observer',()=>{
  const c=client(0,0,'server');
  c.run(`G._revealHand={p:1,by:0};liveNet.pendingChoices={1:{p:0}};
    UI._revealedHandView={game:G,p:0,owner:1,id:1,indices:[1],selected:null};
    liveNet.send=()=>{throw new Error('channel closed');};
    assert.doesNotThrow(()=>UI.previewRevealedHandSelection(1));
    assert.equal(UI._revealedHandView.selected,1);
    assert.doesNotThrow(()=>liveNet.requestHandPreview(0,1));
    liveNet.resetGameSync(true);
    assert.equal(UI._revealedHandView,null);assert.equal(closed,1);
  `);
});

test('a running card flight keeps its path across ordinary renders and measures once after viewport changes',()=>{
  const c=create();
  const follow=fxSource.slice(fxSource.indexOf('const unfollow=fxFollow(el,()=>{'),fxSource.indexOf('const stop=(arrived=false)=>{'));
  c.run(`(()=>{
    let update,reads=0,rewrites=0,stops=0,fxViewportRevision=1,viewportRevision=1;
    let geometry='[{"transform":"old"}]';
    const game=G,el={},fxMotionEnabled=()=>true,stop=()=>stops++;
    const fxFollow=(el,fn)=>{update=fn;return ()=>{};};
    const frames=()=>{reads++;return [{transform:'new'}];};
    const a={effect:{setKeyframes:()=>rewrites++}};
    ${follow}
    for(let i=0;i<30;i++) update();
    assert.equal(reads,0);assert.equal(rewrites,0);
    fxViewportRevision++;
    for(let i=0;i<30;i++) update();
    assert.equal(reads,1);assert.equal(rewrites,1);assert.equal(stops,0);
    G={};update();assert.equal(stops,1);
  })()`);
});

test('a portrait hand card rotates into an exhausted unit without unequal width and height scaling',()=>{
  const c=create();
  const geometry=fxSource.slice(fxSource.indexOf('const frames=()=>{'),fxSource.indexOf('const initial=frames();'));
  c.run(`(()=>{
    const m={n:1,handDeparture:true,anchor:()=>({left:0,top:0,width:74,height:104})};
    const movingCard=card(m.n);
    const target={getBoundingClientRect:()=>({left:200,top:100,width:104,height:74}),
      offsetWidth:74,offsetHeight:104,closest:()=>null};
    const document={querySelector:()=>target},el={style:{}},stage={style:{}},face={style:{}};
    const handArrival=false,fxRect=r=>r,fxLayer=()=>({clientHeight:720});
    const getComputedStyle=()=>({transform:'rotate90'});
    class DOMMatrix{constructor(){this.a=0;this.b=1;}}
    ${geometry}
    const flight=frames();
    assert.ok(flight[0].transform.endsWith('rotate(-90deg) scale(1)'));
    assert.ok(flight[2].transform.endsWith('rotate(0deg) scale(1)'));
    assert.equal(el.style.width,'104px');assert.equal(el.style.height,'74px');
    assert.ok(flight.every(f=>!f.transform.split('scale(')[1].includes(',')));
  })()`);
});

for(const own of [false,true])for(const preview of [false,true])
test(`token movement uses the shared flight: own ${own}, preview ${preview}`,()=>{
  const c=create();
  const state=fxSource.slice(fxSource.indexOf('function fxStates(){'),fxSource.indexOf('function fxRefreshArrivals(){'));
  c.run(`(()=>{
    const token=makeUnit(0,0,{isToken:true,tokenMight:1,tokenName:'Recruit',ready:true});placeUnit(token,'base');
    let pending=null;const pendingCombatMove=()=>pending;
    const moveDisplayLoc=u=>pending?.uids.has(u.uid)?pending.dest:u.loc;
    const localControlsPlayer=()=>${own},fxMoveGame=G,fxDirectMoves=new Map(),fxCardActions=new Map();
    const fxMotionEnabled=()=>true,fxCardAction=()=>{},fxStateKey=k=>k,fxPulseCard=()=>{};
    let fxCardStates=new Map();const moves=[];
    UI.fx.moveCard=(p,n,from,to,options)=>moves.push({p,n,from,to,options});
    ${state}
    fxCardStates=fxStates();
    ${preview?"pending={dest:0,uids:new Set([token.uid])};":"fxDirectMoves.set(token.uid,0);removeUnit(token);placeUnit(token,0);"}
    UI.fx.beforeRender();assert.equal(moves.length,${own?0:1});
    ${own?'':`assert.equal(moves[0].n,0);assert.equal(moves[0].to,'#board [data-uid="'+token.uid+'"]');assert.equal(moves[0].options.opponentOnly,true);`}
    fxCardStates=fxStates();UI.fx.beforeRender();assert.equal(moves.length,${own?0:1});
    ${preview?`pending=null;UI.fx.beforeRender();assert.equal(moves.length,${own?0:2});`:''}
    fxCardStates=fxStates();removeUnit(token);UI.fx.beforeRender();
    assert.ok(moves.every(m=>!m.to.startsWith('#trash-')));
  })()`);
});

for(const moving of [false,true])for(const own of [false,true])
test(`exhaustion rotation has one owner: moving ${moving}, own ${own}`,()=>{
  const c=create();
  const state=fxSource.slice(fxSource.indexOf('function fxStates(){'),fxSource.indexOf('function fxRefreshArrivals(){'));
  c.run(`(()=>{
    const unit=makeUnit(12,0,{ready:true});placeUnit(unit,'base');
    const pendingCombatMove=()=>null,moveDisplayLoc=u=>u.loc;
    const localControlsPlayer=()=>${own},fxMoveGame=G,fxDirectMoves=new Map(),fxCardActions=new Map();
    const fxMotionEnabled=()=>true,fxStateKey=k=>k,fxPulseCard=()=>{};
    let turns=0,cancelled=0,fxCardStates=new Map();const moves=[];
    const fxCardAction=()=>turns++;
    UI.fx.moveCard=(...args)=>moves.push(args);
    ${state}
    fxCardStates=fxStates();
    const key='unit:'+unit.uid+':turn';
    fxCardActions.set(key,{animations:[{cancel(){cancelled++;}}]});
    ${moving?'removeUnit(unit);placeUnit(unit,0);fxDirectMoves.set(unit.uid,0);':''}
    unit.ex=true;UI.fx.beforeRender();
    assert.equal(moves.length,${moving&&!own?1:0});
    assert.equal(turns,${moving&&!own?0:1});
    assert.equal(cancelled,${moving&&!own?1:0});
    assert.equal(fxCardActions.has(key),${moving&&!own?'false':'true'});
  })()`);
});

test('token flight geometry uses the displayed token without dereferencing card zero',()=>{
  const c=create();
  const geometry=fxSource.slice(fxSource.indexOf('const frames=()=>{'),fxSource.indexOf('const initial=frames();'));
  c.run(`(()=>{
    assert.equal(card(0),undefined);
    const movingCard={n:0,type:'Unit',name:'Recruit',m:1};
    const m={n:0,anchor:()=>({left:0,top:0,width:74,height:104})};
    const target={getBoundingClientRect:()=>({left:200,top:100,width:104,height:74}),
      offsetWidth:74,offsetHeight:104,closest:()=>null};
    const document={querySelector:()=>target},el={style:{}},stage={style:{}},face={style:{}};
    const handArrival=false,fxRect=r=>r,fxLayer=()=>({clientHeight:720});
    const getComputedStyle=()=>({transform:'rotate90'});
    class DOMMatrix{constructor(){this.a=0;this.b=1;}}
    ${geometry}
    assert.equal(frames().length,3);
  })()`);
});

for(const [departure,arrival,rotation] of [[0,90,-90],[90,0,90],[170,-170,-20],[-170,170,20]])
test(`board flight rotates from ${departure} to ${arrival} along the short path`,()=>{
  const c=create();
  const geometry=fxSource.slice(fxSource.indexOf('const frames=()=>{'),fxSource.indexOf('const initial=frames();'));
  c.run(`(()=>{
    const movingCard={n:0,type:'Unit'};
    const m={n:0,angle:${departure},anchor:()=>({left:0,top:0,width:104,height:74})};
    const target={getBoundingClientRect:()=>({left:200,top:100,width:74,height:104}),
      offsetWidth:74,offsetHeight:104,closest:()=>null};
    const document={querySelector:()=>target},el={style:{}},stage={style:{}},face={style:{}};
    const handArrival=false,fxRect=r=>r,fxLayer=()=>({clientHeight:720});
    const getComputedStyle=()=>({transform:'destination'});
    class DOMMatrix{constructor(){this.a=Math.cos(${arrival}*Math.PI/180);this.b=Math.sin(${arrival}*Math.PI/180);}}
    ${geometry}
    const flight=frames();
    const rotation=Number(flight[0].transform.split('rotate(')[1].split('deg)')[0]);
    const midway=Number(flight[1].transform.split('rotate(')[1].split('deg)')[0]);
    assert.ok(Math.abs(rotation-(${rotation}))<.00001);
    assert.ok(Math.abs(midway-(${rotation})*.52)<.00001);
    assert.ok(flight[2].transform.endsWith('rotate(0deg) scale(1)'));
    assert.ok(flight.every(f=>!f.transform.split('scale(')[1].includes(',')));
  })()`);
});

for(const handArrival of [false,true])for(const selected of [false,true])
test(`hand flight lands on settled pose and restores hover: arrival ${handArrival}, selected ${selected}`,()=>{
  const c=create();
  const geometry=fxSource.slice(fxSource.indexOf('const frames=()=>{'),fxSource.indexOf('const initial=frames();'));
  c.run(`(()=>{
    const movingCard={type:'Unit'},m={handLayout:${handArrival?'null':"'hand-0'"},angle:0,
      anchor:()=>({left:0,top:0,width:74,height:104})};
    const finalRect={left:200,top:100,width:90,height:120};
    const target={style:{transition:'transform .1s ease-out'},matches:()=>true,closest:()=>null,
      _card:{n:1},offsetWidth:74,offsetHeight:104,
      getBoundingClientRect(){return this.style.transition==='none'?finalRect:{left:190,top:95,width:80,height:110};}};
    m.n=1;
    const document={querySelector:()=>target},el={style:{}},stage={style:{}},face={style:{}};
    face.classList={toggle(){}};
    const handArrival=${handArrival},fxRect=r=>r,fxLayer=()=>({clientHeight:720});
    const getComputedStyle=()=>({transform:target.style.transition==='none'?'final':'intermediate'});
    class DOMMatrix{constructor(value){const angle=(value==='final'?8:2)*Math.PI/180;
      const scale=${selected?1.08:1};this.a=Math.cos(angle)*scale;this.b=Math.sin(angle)*scale;}}
    ${geometry}
    const flight=frames();
    assert.equal(el.style.width,'90px');assert.equal(el.style.height,'120px');
    assert.ok(Math.abs(Number(flight[0].transform.split('rotate(')[1].split('deg)')[0])+8)<.00001);
    assert.equal(flight[2].transform,'translate(208px,108px) rotate(0deg) scale(1)');
    assert.equal(target.style.transition,'transform .1s ease-out');
    assert.ok(face.style.transform.endsWith('scale('+${selected?1.08:1}+')'));
  })()`);
});

test('departure capture stores the board card angle before replacement and passes it to the flight',()=>{
  const c=create();
  const capture=fxSource.slice(fxSource.indexOf('UI.fx.captureOrigin=function'),fxSource.indexOf('UI.fx.moveCard = function'));
  const movement=fxSource.slice(fxSource.indexOf('UI.fx.moveCard = function'),fxSource.indexOf('// 손패 펼침/접힘도 기존 카드 비행을 사용한다.'));
  c.run(`(()=>{
    const fxMoveGame=G,fxMotionEnabled=()=>true,fxMoves=[],fxHandSlots=[[],[]],fxRuneSlots=[[],[]];
    const source={getBoundingClientRect:()=>({left:0,top:0,width:104,height:74})};
    const document={querySelector:s=>s==='source'?source:null};
    const getComputedStyle=()=>({transform:'departure'});
    class DOMMatrix{constructor(){this.a=0;this.b=1;}}
    const fxAnchor=el=>()=>el.getBoundingClientRect();
    ${capture}
    ${movement}
    const origin=UI.fx.captureOrigin('source');assert.equal(origin.angle,90);
    UI.fx.moveCard(0,0,origin,'destination',{unit:true});
    assert.equal(fxMoves[0].angle,90);assert.equal(fxMoves[0].anchor,origin.anchor);
  })()`);
});

for(const seat of [0,1])for(const actor of [0,1])
test(`play flights are visible only to the other player: seat ${seat}, actor ${actor}`,()=>{
  const c=create();
  const movement=fxSource.slice(fxSource.indexOf('UI.fx.moveCard = function'),fxSource.indexOf('// 손패 펼침/접힘도 기존 카드 비행을 사용한다.'));
  c.run(`(()=>{
    const fxMoveGame=G,fxMotionEnabled=()=>true,fxMoves=[],fxHandSlots=[[],[]],fxRuneSlots=[[],[]];
    const localControlsPlayer=p=>p===${seat},document={querySelector:()=>null};
    const origin={game:G,angle:90,anchor:()=>({left:0,top:0,width:104,height:74})};
    ${movement}
    UI.fx.moveCard(${actor},0,origin,'destination',{unit:true,opponentOnly:true});
    assert.equal(fxMoves.length,${seat===actor?0:1});
    // Personal hand/rune selection layout must still animate on the actor's screen.
    UI.fx.moveCard(${seat},7,origin,'rune-selection',{unit:true,handLayout:'runes-${seat}'});
    assert.equal(fxMoves.length,${seat===actor?1:2});
    assert.equal(fxMoves.at(-1).handLayout,'runes-${seat}');
  })()`);
});
