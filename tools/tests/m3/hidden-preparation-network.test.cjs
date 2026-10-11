'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {create}=require('./engine-real-helper.cjs');
const root=process.env.BOT_TEST_SOURCE||path.resolve(__dirname,'../../../client/web/js');
const netSource=fs.readFileSync(path.join(root,'net.js'),'utf8');
const uiSource=fs.readFileSync(path.join(root,'ui.js'),'utf8');
const section=(start,end)=>uiSource.slice(uiSource.indexOf(start),uiSource.indexOf(end,uiSource.indexOf(start)));
const picks=[section('async function routedPick(', '// 유닛 선택 (보드에서 클릭)'),
  section('UI.pickUnitFrom = async function(', 'function _pickUnitLocal('),
  section('UI.confirmP = function(', 'async function confirmBoardCard('),
  section('UI.pickNumber = function', 'function _pickNumberLocal(')].join('\n');

// Reuse the real-engine helper and production choice routing. Rendering and
// local mouse input are suppressed; serialized echoes go to both seats/viewer.
function client(seat,caster,mode,n=213,hideCost=false,boardTargets=false){
  const c=create();c.context.queueMicrotask=queueMicrotask;
  c.run(`(()=>{${netSource}\nglobalThis.liveNet=NET;})();`);
  c.run(`
    NET.online=true;liveNet.online=true;liveNet.seat=${seat};
    G.turn=G.actingPlayer=${caster};G.bfs[0].controller=${caster};
    G.players[${caster}].power.Any=1;G.players[${caster}].hand=[9,213];
    unit(1,${caster},0);const target=unit(155,${1-caster},0);
    G.bfs[0].hiddenCards=[{n:77,by:${caster},turn:1},{n:${n},by:${caster},turn:1},{n:77,by:${caster},turn:2}];
    globalThis.events=[];globalThis.localTitles=[];
    UI.log=(text)=>events.push({kind:'log',text,private:!!UI.hiddenPlayPreparation&&!UI.hiddenPlayPreparation.committed});
    UI.prompt=(text)=>events.push({kind:'prompt',text,private:!!UI.hiddenPlayPreparation&&!UI.hiddenPlayPreparation.committed});
    UI.promptForState=()=>{};UI.recordEffectTarget=()=>{};
    (()=>{
      const NET=liveNet,_pendingRoutedPicks=new Set(),_chainSoundPreparations=new Set();let _turnGlowPick=null;
      const updateTurnGlow=()=>{},updateButtons=()=>{},lockUnitSelection=()=>{};
      const localControlsPlayer=p=>p===NET.seat;
      const _pickUnitLocal=async(p,units,title)=>{
        localTitles.push(title);
        if('${mode}'==='throw')throw new Error('input failed');
        return '${mode}'==='cancel'?null:units.find(u=>u.uid===target.uid)||null;
      };
      const _pickNumberLocal=async()=>0;
      const _confirmLocal=async(p,title)=>{localTitles.push(title);return '${mode}'==='accept';};
      ${picks}
      UI.pickOption=async(p,title,options)=>{
        UI._choiceLabel=title;
        const i=await routedPick(p,async()=>{localTitles.push(title);return 0;},v=>v,v=>v);
        return options[i]?.v??null;
      };
      ${hideCost ? `
      const optionBoardCard=o=>${boardTargets?'o.boardCard||null':'null'},PLAY_OPTIONS={confirmResourceAbilities:true};
      let runeChoices=0;
      const _pickOptionLocal=async(p,title,options)=>{localTitles.push(title);return '${mode}'==='cancel'?null:0;};
      UI.mobileHand={pickRuneCost:async(p,title,options)=>{localTitles.push(title);return '${mode}'==='cancel'||('${mode}'==='retry'&&runeChoices++===0)?null:0;}};
      UI.mobileHand.observeRevealedHand=()=>{};UI.mobileHand.closeRevealedHandPreview=()=>{};
      UI.mobileHand.pickRuneOption=async(p,title,options)=>{localTitles.push('rune:'+title);return '${mode}'==='cancel'?options.findIndex(o=>o.v==='skip'):0;};
      ${section('UI.clearRevealedHandPreview=function', '// 옵션 선택 (인덱스 기반 동기화)')}
      ${section('UI.pickOption = function(', '// 위치 선택도 기존 옵션 인덱스로 동기화한다.')}
      ` : ''}
      UI.pickReaction=async(p,title)=>{
        UI._choiceLabel=title;return routedPick(p,async()=>null,v=>v,v=>v);
      };
    })();
  `);
  return c;
}

for(const caster of [0,1])for(const mode of ['cancel','decline','accept'])for(const showdown of [false,true])
test(`hidden preparation ${mode}, showdown ${showdown}: seat ${caster}, opponent and spectator stay synchronized`,async()=>{
  const clients=[0,1,-1].map(seat=>client(seat,caster,mode)),messages=[];
  if(showdown)await Promise.all(clients.map(c=>c.run(`startShowdown(0,${caster},false)`)));
  for(const [index,c] of clients.entries()){
    c.context.relay=message=>{
      const m=JSON.parse(JSON.stringify({...message,seat:index}));messages.push(m);
      for(const other of clients)queueMicrotask(()=>other.run(`liveNet._resolveChoice(${JSON.stringify(m)})`));
    };
    c.run('liveNet.send=relay;');
  }
  await Promise.all(clients.map(c=>c.run(`playHidden(${caster},0,G.bfs[0].hiddenCards[1])`)));
  const snapshots=clients.map(c=>JSON.parse(c.run(`JSON.stringify({G,UID,rng:_rngState,seq:liveNet.choiceSeq,
    pending:Object.keys(liveNet.pendingChoices),early:Object.keys(liveNet.earlyChoices)})`)));
  assert.deepEqual(snapshots[0],snapshots[1]);assert.deepEqual(snapshots[0],snapshots[2]);
  assert.deepEqual(snapshots[0].pending,[]);assert.deepEqual(snapshots[0].early,[]);
  assert.equal(snapshots[0].seq,messages.length);
  for(const index of [1-caster,2]){
    const events=JSON.parse(clients[index].run('JSON.stringify(events)'));
    const privatePrompts=events.filter(e=>e.kind==='prompt'&&e.private);
    assert(privatePrompts.length>0);
    assert(privatePrompts.every(e=>e.text.endsWith('숨김 카드 사용 준비')));
    if(mode!=='accept'){
      assert(events.every(e=>!e.text.includes('숨겨진 칼날')));
      assert(events.every(e=>!e.text.includes('숨김 카드를 공개')));
    }else{
      assert(events.some(e=>e.kind==='log'&&e.text.includes('숨겨진 칼날')&&!e.private));
      assert.equal(events.filter(e=>e.text.includes('숨김 카드를 공개')).length,1);
      if(!showdown)assert(events.some(e=>e.kind==='prompt'&&!e.private&&e.text.includes('숨겨진 칼날')));
    }
  }
  assert(JSON.parse(clients[caster].run('JSON.stringify(localTitles)')).some(t=>t.includes('숨겨진 칼날')));
  for(const c of clients)c.run(`
    assert.equal(UI.hiddenPlayPreparation,undefined);
    assert.deepEqual(Array.from(G.players[${caster}].hand),[9,213]);
    assert.deepEqual(G.bfs[0].hiddenCards.map(h=>h.n),${mode==='accept'?'[77,77]':'[77,77,213]'});
    assert.equal(G.players[${caster}].playedCards,${mode==='accept'?1:0});
  `);
  assert.equal(messages.length,mode==='cancel'?1:mode==='decline'?7:showdown?2:4);
  if(showdown)clients[0].run(`
    assert.equal(G.showdown.chain.length,${mode==='accept'?1:0});
    assert.equal(G.actingPlayer,${caster});assert.equal(G.showdown.passes,0);
    ${mode==='accept'?`assert.equal(G.showdown.chain[0].fromHidden,true);
      assert.equal(G.showdown.chain[0].hiddenBf,0);assert(G.showdown.chain[0].displayTargets.length);`:''}
  `);
  const replay=client(-1,caster,mode);
  if(showdown)await replay.run(`startShowdown(0,${caster},false)`);
  replay.run(`liveNet.catchingUp=true;${messages.map(m=>`liveNet._resolveChoice(${JSON.stringify(m)});`).join('')}`);
  await replay.run(`playHidden(${caster},0,G.bfs[0].hiddenCards[1])`);
  assert.deepEqual(JSON.parse(replay.run(`JSON.stringify({G,UID,rng:_rngState,seq:liveNet.choiceSeq,
    pending:Object.keys(liveNet.pendingChoices),early:Object.keys(liveNet.earlyChoices)})`)),snapshots[0]);
});

for(const caster of [0,1])for(const mode of ['cancel','accept'])
test(`ready rune picker ${mode}: seat ${caster} uses the shared UI and synchronizes spectator`,async()=>{
  const clients=[0,1,-1].map(seat=>client(seat,caster,mode,213,true)),messages=[];
  for(const [index,c] of clients.entries()){
    c.run(`G.players[${caster}].runes=[{n:89,ex:true},{n:89,ex:true}];G.actingPlayer=${1-caster};`);
    c.context.relay=message=>{
      const m=JSON.parse(JSON.stringify({...message,seat:index})); messages.push(m);
      for(const other of clients) queueMicrotask(()=>other.run(`liveNet._resolveChoice(${JSON.stringify(m)})`));
    };
    c.run('liveNet.send=relay;');
  }
  await Promise.all(clients.map(c=>c.run(`readyRunesPick(${caster},2,true)`)));
  const states=clients.map(c=>JSON.parse(c.run('JSON.stringify({G,seq:liveNet.choiceSeq})')));
  assert.deepEqual(states[0],states[1]);assert.deepEqual(states[0],states[2]);
  assert.equal(messages.length,mode==='accept'?2:1);
  assert.equal(states[0].G.players[caster].runes.filter(r=>!r.ex).length,mode==='accept'?2:0);
  for(const [index,c] of clients.entries()){
    const titles=JSON.parse(c.run('JSON.stringify(localTitles)'));
    assert.equal(titles.length,index===caster?messages.length:0);
    assert(titles.every(t=>t.startsWith('rune:')));
  }
});

for(const caster of [0,1])
test(`mixed ready choice: seat ${caster} routes gear and rune alternatives through shared picker`,async()=>{
  const clients=[0,1,-1].map(seat=>client(seat,caster,'accept',213,true,true)),messages=[];
  for(const [index,c] of clients.entries()){
    c.run(`G.players[${caster}].runes=[{n:89,ex:true}];
      G.players[${caster}].gear=[{n:17,ex:true,attachedTo:null}];
      UI.mobileHand.pickRuneOption=async(p,title,options)=>{
        localTitles.push('rune:'+title);
        assert(options.some(o=>o.boardCard?.kind==='gear'));
        return options.findIndex(o=>o.runePick);
      };`);
    c.context.relay=message=>{
      const m=JSON.parse(JSON.stringify({...message,seat:index}));messages.push(m);
      for(const other of clients)queueMicrotask(()=>other.run(`liveNet._resolveChoice(${JSON.stringify(m)})`));
    };
    c.run('liveNet.send=relay;');
  }
  await Promise.all(clients.map(c=>c.run(`execOps([{op:'readySomething'}],{p:${caster}})`)));
  const states=clients.map(c=>JSON.parse(c.run('JSON.stringify({G,seq:liveNet.choiceSeq})')));
  assert.deepEqual(states[0],states[1]);assert.deepEqual(states[0],states[2]);
  assert.equal(messages.length,1);
  assert.equal(states[0].G.players[caster].runes[0].ex,false);
  assert.equal(states[0].G.players[caster].gear[0].ex,true);
});

test('an exception before commit restores hidden card, temporary hand and private scope',async()=>{
  const c=client(0,0,'throw');
  c.run('NET.online=false;liveNet.online=false;');
  await assert.rejects(c.run('playHidden(0,0,G.bfs[0].hiddenCards[1])'),/input failed/);
  c.run(`assert.equal(UI.hiddenPlayPreparation,undefined);
    assert.deepEqual(Array.from(G.players[0].hand),[9,213]);
    assert.deepEqual(G.bfs[0].hiddenCards.map(h=>h.n),[77,77,213]);
    assert(!events.some(e=>e.text.includes('숨김 카드를 공개')));`);
});

test('game setup and stale preparation do not mask unrelated public choices',async()=>{
  const c=client(0,0,'accept');
  await c.run(`(async()=>{
    UI.hiddenPlayPreparation={game:G,p:1,committed:false};G=null;
    liveNet._nextChoiceLabel='전장 선택';
    const result=liveNet.choice(1,async()=>true,v=>v,v=>v);
    liveNet._resolveChoice({id:1,seat:1,data:true});assert.equal(await result,true);
    assert(events.some(e=>e.text.includes('전장 선택')));
    assert(!events.some(e=>e.text.includes('숨김 카드 사용 준비')));
  })()`);
});

test('manual hidden gear commits once and releases private presentation',async()=>{
  const c=client(0,0,'accept',77);
  c.run('NET.online=false;liveNet.online=false;G.manual=true;');
  assert.equal(await c.run('playHidden(0,0,G.bfs[0].hiddenCards[1])'),true);
  c.run(`assert.equal(UI.hiddenPlayPreparation,undefined);
    assert.deepEqual(Array.from(G.players[0].hand),[9,213]);
    assert.equal(G.players[0].gear.filter(g=>g.n===77).length,1);
    assert.equal(events.filter(e=>e.text.includes('숨김 카드를 공개')).length,1);
    assert(events.some(e=>e.text.includes(card(77).ko)&&!e.private));`);
});

test('privacy fix preserves the existing browser build version',()=>{
  const c=client(0,0,'accept');c.run(fs.readFileSync(path.join(root,'buildinfo.js'),'utf8'));
  c.run(`assert.equal(liveNet.clientVersion(),BUILDINFO.version);
    assert(liveNet.clientVersion().length<=20);
    liveNet._verIntercept({from:'peer',msg:'[버전 확인] v'+BUILDINFO.version+' — browser client'});
    assert(!events.some(e=>e.text.includes('앱 버전이 다릅니다')));`);
});

test('rejoin flags retain same-version recovery and discard incompatible choice logs',()=>{
  const c=client(0,0,'accept');
  c.run(fs.readFileSync(path.join(root,'buildinfo.js'),'utf8'));
  c.run(`const saved=new Map();const localStorage={
    setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k)||null,removeItem:k=>saved.delete(k)};
    liveNet.base='http://local-test';liveNet.setRejoinFlag();
    assert.equal(liveNet.readRejoinFlag().version,BUILDINFO.version);
    assert.equal(liveNet.readRejoinFlag().server,liveNet.base);
    for(const flag of [{server:liveNet.base},{server:liveNet.base,version:'1.0.123-m2'}]){
      localStorage.setItem('rb_rejoin',JSON.stringify(flag));
      assert.equal(liveNet.readRejoinFlag(),null);assert.equal(localStorage.getItem('rb_rejoin'),null);
    }`);
});

const publicReveal=section('UI.revealDeckCards = async function(', '// ── 온라인 라우팅 래퍼');
test('public reveal catch-up and replay skip presentation without a timer or choice',async()=>{
  const c=create();c.context.setTimeout=()=>assert.fail('historical reveal must not wait');
  c.run(`(()=>{${publicReveal}})();NET.online=true;
    NET.choice=()=>assert.fail('public reveal must not request an acknowledgment');`);
  for(const kind of ['aurora','teemo'])for(const seat of [0,1,-1]){
    c.run(`NET.seat=${seat};NET.spectating=${seat===-1};NET.catchingUp=true;`);
    await c.run(`UI.revealDeckCards(0,[9,12],{kind:'${kind}',unitIndex:1})`);
  }
  c.run('NET.catchingUp=false;const REPLAY={viewing:true};');
  await c.run('UI.revealAurora(0,[9,12],1)');
});

for(const caster of [0,1])test(`Aurora placement and next choice align across both seats and spectator: caster ${caster}`,async()=>{
  const clients=[0,1,-1].map(seat=>client(seat,caster,'accept')),messages=[];
  for(const [index,c] of clients.entries()){
    c.context.relay=message=>{
      const m=JSON.parse(JSON.stringify({...message,seat:index}));messages.push(m);
      for(const other of clients)queueMicrotask(()=>other.run(`liveNet._resolveChoice(${JSON.stringify(m)})`));
    };
    c.run(`liveNet.send=relay;seedRng(123);G.players[${caster}].deck=[9,12,17];`);
  }
  const effect=`execOps([{op:'dawnAurora'}],{p:${caster},n:160,kind:'effect'})`;
  await Promise.all(clients.map(c=>c.run(effect)));
  assert.equal(messages.length,1); // Actual placement, no public-reveal responses.
  await Promise.all(clients.map(c=>c.run(`UI.confirmP(${1-caster},'next choice')`)));
  assert.equal(messages.length,2);
  const snapshot=c=>JSON.parse(c.run(`JSON.stringify({G,seq:liveNet.choiceSeq,
    pending:Object.keys(liveNet.pendingChoices),early:Object.keys(liveNet.earlyChoices)})`));
  assert.deepEqual(snapshot(clients[0]),snapshot(clients[1]));
  assert.deepEqual(snapshot(clients[0]),snapshot(clients[2]));
  const recovery=client(-1,caster,'accept');
  recovery.run(`seedRng(123);G.players[${caster}].deck=[9,12,17];
    (()=>{const NET=liveNet;${publicReveal}})();
    liveNet.catchingUp=true;${messages.map(m=>`liveNet._resolveChoice(${JSON.stringify(m)});`).join('')}`);
  await recovery.run(effect);
  await recovery.run(`UI.confirmP(${1-caster},'next choice')`);
  assert.deepEqual(snapshot(recovery),snapshot(clients[0]));
  clients[0].run(`assert.equal(G.players[${caster}].base.at(-1).n,12);
    assert.deepEqual(G.players[${caster}].banish,[]);`);
});

for(const caster of [0,1])for(const mode of ['cancel','accept'])
test(`hide rune cost ${mode}: seat ${caster}, opponent and spectator share one choice echo`,async()=>{
  const clients=[0,1,-1].map(seat=>client(seat,caster,mode,213,true)),messages=[];
  for(const [index,c] of clients.entries()){
    c.run(`G.players[${caster}].power.Any=0;G.players[${caster}].hand=[97];
      G.players[${caster}].runes=[{n:89,ex:false},{n:89,ex:true}];G.bfs[0].hiddenCards=[];`);
    c.context.relay=message=>{
      const m=JSON.parse(JSON.stringify({...message,seat:index}));messages.push(m);
      for(const other of clients)queueMicrotask(()=>other.run(`liveNet._resolveChoice(${JSON.stringify(m)})`));
    };
    c.run('liveNet.send=relay;');
  }
  await Promise.all(clients.map(c=>c.run(`hideCard(${caster},0,0)`)));
  const states=clients.map(c=>JSON.parse(c.run('JSON.stringify({G,seq:liveNet.choiceSeq})')));
  assert.deepEqual(states[0],states[1]);assert.deepEqual(states[0],states[2]);
  assert.equal(messages.length,1);
  assert.equal(states[0].G.players[caster].runes.length,mode==='cancel'?2:1);
  assert.equal(states[0].G.bfs[0].hiddenCards.length,mode==='cancel'?0:1);
  assert.equal(states[0].G.players[caster].energy,0); // exhausted candidate is first in the wire options
  for(const [index,c] of clients.entries()){
    const titles=JSON.parse(c.run('JSON.stringify(localTitles)'));
    assert.equal(titles.length,index===caster?messages.length:0);
    assert(titles.every(t=>['숨김 비용(힘 1)으로 재활용할 룬 선택','숨김 비용 선택'].includes(t)));
  }
});

for(const caster of [0,1])
test(`recycle two runes: seat ${caster}, opponent and spectator retain two existing choice echoes`,async()=>{
  const clients=[0,1,-1].map(seat=>client(seat,caster,'accept',213,true)),messages=[];
  for(const [index,c] of clients.entries()){
    c.run(`G.players[${caster}].runes=[{n:7,ex:false},{n:214,ex:true},{n:7,ex:true}];`);
    c.context.relay=message=>{
      const m=JSON.parse(JSON.stringify({...message,seat:index}));messages.push(m);
      for(const other of clients)queueMicrotask(()=>other.run(`liveNet._resolveChoice(${JSON.stringify(m)})`));
    };
    c.run('liveNet.send=relay;');
  }
  await Promise.all(clients.map(c=>c.run(`execOps([{op:'recycleRune',n:2}],{p:${caster}})`)));
  const states=clients.map(c=>JSON.parse(c.run('JSON.stringify({G,seq:liveNet.choiceSeq})')));
  assert.deepEqual(states[0],states[1]);assert.deepEqual(states[0],states[2]);
  assert.equal(messages.length,2);
  assert.equal(states[0].G.players[caster].runes.length,1);
  assert.equal(states[0].G.players[caster].runes[0].ex,false);
});

for(const caster of [0,1])for(const action of ['recycle','discard'])
test(`revealed opponent hand ${action}: seat ${caster}, opponent and spectator share one choice`,async()=>{
  const clients=[0,1,-1].map(seat=>client(seat,caster,'accept',213,true)),messages=[];
  for(const [index,c] of clients.entries()){
    c.run(`G.players[${1-caster}].hand=[210,9,17,12];
      UI.mobileHand.pickRevealedHand=async(p,title,options)=>{
        localTitles.push(title);assert.equal(p,${caster});
        assert.equal(G._revealHand.p,${1-caster});
        assert(options.every(o=>o.boardCard.reveal && o.boardCard.p===${1-caster}));
        assert.equal(options.length,${action==='recycle'?2:4});
        return options.findIndex(o=>o.n===9);
      };`);
    c.context.relay=message=>{
      const m=JSON.parse(JSON.stringify({...message,seat:index}));messages.push(m);
      for(const other of clients)queueMicrotask(()=>other.run(`${m.t==='chat'?'liveNet._selectionPreviewIntercept':'liveNet._resolveChoice'}(${JSON.stringify(m)})`));
    };
    c.run('liveNet.send=relay;');
  }
  await Promise.all(clients.map(c=>c.run(`execOps([{op:'revealHandPick',filter:'${action==='recycle'?'nonunit':'any'}',action:'${action}'}],{p:${caster}})`)));
  const states=clients.map(c=>JSON.parse(c.run('JSON.stringify({G,seq:liveNet.choiceSeq})')));
  assert.deepEqual(states[0],states[1]);assert.deepEqual(states[0],states[2]);
  assert.equal(messages.filter(m=>m.t==='choice').length,1);assert.equal(states[0].G._revealHand,null);
  const opponent=states[0].G.players[1-caster];
  assert.deepEqual(opponent.hand,[210,17,12]);
  assert((action==='recycle'?opponent.deck:opponent.trash).includes(9));
});

for(const caster of [0,1])for(const mode of ['cancel','retry'])
test(`ordinary staged hide ${mode}: rune cancel returns to spell confirmation on both seats and viewer`,async()=>{
  const clients=[0,1,-1].map(seat=>client(seat,caster,mode,213,true)),messages=[];
  for(const [index,c] of clients.entries()){
    c.run(`G.players[${caster}].power.Any=0;G.players[${caster}].hand=[213];
      G.players[${caster}].runes=[{n:89,ex:true}];G.bfs[0].hiddenCards=[];
      let confirms=0;globalThis.resumes=0;
      UI.beginSpellStage=(p,handIdx,n)=>UI.spellStage={game:G,p,handIdx,n,committed:false};
      UI.routeSpellStagePick=(draft,fn,encode,decode)=>liveNet.choice(draft.p,fn,encode,decode);
      UI.confirmSpellStage=async draft=>{
        const ok=await liveNet.choice(draft.p,async()=>++confirms===1||'${mode}'==='retry',v=>v,v=>v);
        if(!ok) throw SPELL_STAGE_CANCEL;
        draft.committed=true;UI.spellStage=null;
      };
      UI.resumeSpellStage=draft=>{resumes++;draft.committed=false;UI.spellStage=draft;return true;};
      UI.endSpellStage=()=>{UI.spellStage=null;};`);
    c.context.relay=message=>{
      const m=JSON.parse(JSON.stringify({...message,seat:index}));messages.push(m);
      for(const other of clients)queueMicrotask(()=>other.run(`liveNet._resolveChoice(${JSON.stringify(m)})`));
    };
    c.run('liveNet.send=relay;');
  }
  await Promise.all(clients.map(c=>c.run(`hideCard(${caster},0,0,{stageHide:true})`)));
  const states=clients.map(c=>JSON.parse(c.run('JSON.stringify({G,seq:liveNet.choiceSeq,resumes})')));
  assert.deepEqual(states[0],states[1]);assert.deepEqual(states[0],states[2]);
  assert.equal(states[0].resumes,1);assert.equal(messages.length,mode==='retry'?4:3);
  assert.equal(states[0].G.bfs[0].hiddenCards.length,mode==='retry'?1:0);
  assert.equal(states[0].G.players[caster].runes.length,mode==='retry'?0:1);
  for(const c of clients) assert(!JSON.parse(c.run('JSON.stringify(localTitles)')).includes('숨김 비용 선택'));
});

for(const caster of [0,1]) test(`Guns Blazing selected runes synchronize both seats and spectator: caster ${caster}`,async()=>{
  const clients=[0,1,-1].map(seat=>client(seat,caster,'accept')),messages=[];
  for(const [index,c] of clients.entries()){
    c.context.relay=message=>{
      const m=JSON.parse(JSON.stringify({...message,seat:index}));messages.push(m);
      for(const other of clients)queueMicrotask(()=>other.run(`liveNet._resolveChoice(${JSON.stringify(m)})`));
    };
    c.run(`liveNet.send=relay;
      const P=G.players[${caster}];P.runes=[false,true,true,false].map((ex,i)=>({n:89,ex,original:i}));P.power.Fury=2;
      UI.mobileHand={pickRuneNumber:async()=>({amount:3,runes:[3,0],pool:{Fury:1}})};`);
  }
  await Promise.all(clients.map(c=>c.run(`(()=>{const op={op:'gunsBlazing'};
    return execOps([op],{p:${caster},n:268,kind:'spell',pre:new Map([[op,{bf:0}]])});})()`)));
  const snapshots=clients.map(c=>JSON.parse(c.run('JSON.stringify(G)')));
  assert.deepEqual(snapshots[0],snapshots[1]);assert.deepEqual(snapshots[0],snapshots[2]);
  assert.equal(messages.length,1);
  for(const c of clients)c.run(`assert.deepEqual(G.players[${caster}].runes.map(r=>r.original),[1,2]);
    assert.equal(G.players[${caster}].energy,2);
    assert.equal(G.players[${caster}].power.Fury,1);assert.equal(G.players[${caster}].power.Any,1);`);
});
