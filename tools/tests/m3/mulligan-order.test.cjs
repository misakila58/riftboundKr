'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('./engine-real-helper.cjs');
const fs=require('node:fs');
const path=require('node:path');

for(const online of [false,true])for(const first of [0,1])
test(`mulligan: ${online?'online':'offline'}, seat ${first} finishes before second chooses`,async()=>{
  const c=create();
  await c.run(`(async()=>{
    reset();NET.online=${online};G.orderChooser=${first};
    G.players.forEach(P=>{P.hand=[9,10,11,12];P.deck=[20,21,22,23];});
    const events=[];
    UI.pickMulligan=async p=>{
      events.push('pick'+p);
      if(p!==${first}){
        assert.equal(G.players[${first}].mulliganCount,2);
        assert.deepEqual(Array.from(G.players[${first}].hand),[10,12,20,21]);
        assert.ok(events.includes('animated'+${first}));
      }
      return [0,2];
    };
    UI.presentMulliganReplacement=async(p,before,selected)=>{
      assert.deepEqual(Array.from(before),[9,10,11,12]);
      assert.deepEqual(Array.from(selected),[0,2]);
      await Promise.resolve();events.push('animated'+p);
    };
    UI.finishMulligan=()=>events.push('finish');
    await mulliganPhase();
    assert.deepEqual(events,['pick'+${first},'animated'+${first},'pick'+${1-first},'animated'+${1-first},'finish']);
    for(const P of G.players){assert.equal(P.hand.length,4);assert.deepEqual(Array.from(P.deck.slice(0,2)),[22,23]);assert.deepEqual(Array.from(P.deck.slice(2)).sort((a,b)=>a-b),[9,11]);}
  })()`);
});

test('mulligan preview transmits positions only and rejects invalid sender, phase and positions',()=>{
  const c=create();
  const source=fs.readFileSync(path.resolve(__dirname,'../../../client/web/js/net.js'),'utf8');
  const preview=source.slice(source.indexOf('const MULLIGAN_PREVIEW_PREFIX='),source.indexOf('NET._peerVer = null;'));
  c.run(`reset();NET.online=true;NET.lastStart={players:[{id:'P0'},{id:'P1'}]};NET.pendingChoices={7:{p:1}};
    const highlights=[false,false,false,false];let sent=null;
    let dealCancelled=0;
    UI._mulliganView={remote:true,game:G,p:1,choiceId:7,cards:highlights.map((_,i)=>({getAnimations:()=>[{cancel:()=>dealCancelled++}],classList:{toggle:(cls,on)=>highlights[i]=on}}))};
    NET.send=m=>sent=m;
    ${preview}
    NET.sendMulliganPreview(1,7,[0,2]);
    assert.deepEqual(JSON.parse(sent.msg.slice(MULLIGAN_PREVIEW_PREFIX.length)),{p:1,id:7,selected:[0,2]});
    const before=JSON.stringify(G);
    assert.equal(NET._mulliganPreviewIntercept({...sent,from:'P1'}),true);
    assert.deepEqual(highlights,[true,false,true,false]);
    NET._mulliganPreviewIntercept({from:'P0',msg:MULLIGAN_PREVIEW_PREFIX+JSON.stringify({p:1,id:7,selected:[1]})});
    for(const selected of [[4],[-1],[0,0],[0,1,2],['0']]) NET._mulliganPreviewIntercept({from:'P1',msg:MULLIGAN_PREVIEW_PREFIX+JSON.stringify({p:1,id:7,selected})});
    for(const value of ['null','"invalid"','{']) assert.doesNotThrow(()=>NET._mulliganPreviewIntercept({from:'P1',msg:MULLIGAN_PREVIEW_PREFIX+value}));
    NET._mulliganPreviewIntercept({from:'P1',msg:MULLIGAN_PREVIEW_PREFIX+JSON.stringify({p:1,id:8,selected:[1]})});
    assert.deepEqual(highlights,[true,false,true,false]);
    NET.sendMulliganPreview(1,7,[]);NET._mulliganPreviewIntercept({...sent,from:'P1'});
    assert.deepEqual(highlights,[false,false,false,false]);
    delete NET.pendingChoices[7];NET.sendMulliganPreview(1,7,[1]);NET._mulliganPreviewIntercept({...sent,from:'P1'});
    assert.deepEqual(highlights,[false,false,false,false]);assert.equal(JSON.stringify(G),before);
    assert.equal(dealCancelled,0,'initial state and selection changes must preserve the back-card deal');
  `);
});

test('rejoining mulligan opens the opponent observer only at the unanswered live choice',()=>{
  const c=create();
  const net=fs.readFileSync(path.resolve(__dirname,'../../../client/web/js/net.js'),'utf8');
  const ui=fs.readFileSync(path.resolve(__dirname,'../../../client/web/js/ui.js'),'utf8');
  const choice=net.slice(net.indexOf('NET.choice = function('),net.indexOf('NET._resolveChoice = function('));
  const pick=ui.slice(ui.indexOf('UI.pickMulligan = function('),ui.indexOf('UI.observeMulligan=function('));
  c.run(`reset();NET.online=true;NET.seat=0;NET.catchingUp=true;NET.choiceSeq=6;NET.syncGen=1;NET.pendingChoices={};NET.earlyChoices={};
    const observed=[];UI.prompt=()=>{};
    NET.finishCatchUp=()=>{NET.catchingUp=false;};
    function routedPick(p,fn,s,d){return NET.choice(p,fn,s,d);}
    function _pickMulliganLocal(){throw new Error('opponent choice must not open own cards');}
    ${choice}
    ${pick}
    UI.observeMulligan=p=>observed.push({p,id:NET.choiceSeq});
    UI.pickMulligan(1);
    assert.equal(NET.catchingUp,false);assert.deepEqual(observed,[{p:1,id:7}]);assert.equal(NET.pendingChoices[7].p,1);
    NET.catchingUp=true;NET.earlyChoices[8]=[{id:8,data:[0]}];
    const queueMicrotask=()=>{};
    UI.pickMulligan(1);
    assert.equal(NET.catchingUp,true);assert.equal(observed.length,1);
  `);
});

test('mulligan observer can recover existing positions without changing choices or exposing card data',()=>{
  const c=create();
  const source=fs.readFileSync(path.resolve(__dirname,'../../../client/web/js/net.js'),'utf8');
  const preview=source.slice(source.indexOf('const MULLIGAN_PREVIEW_PREFIX='),source.indexOf('NET._peerVer = null;'));
  c.run(`reset();NET.online=true;NET.seat=1;NET.lastStart={players:[{id:'P0'},{id:'P1'}]};NET.pendingChoices={7:{p:1}};NET.choiceSeq=7;
    const owner={game:G,p:1,choiceId:7,locked:false,selected:new Set([1,3])};UI._mulliganView=owner;
    const sent=[];NET.send=m=>sent.push(m);
    ${preview}
    const before=JSON.stringify(G);
    NET.requestMulliganPreview(1,7);const request=sent.pop();
    NET._mulliganPreviewIntercept({...request,from:'P1'});assert.equal(sent.length,0);
    NET._mulliganPreviewIntercept({...request,from:'P0'});assert.equal(sent.length,1);
    const response=sent.pop();assert.deepEqual(JSON.parse(response.msg.slice(MULLIGAN_PREVIEW_PREFIX.length)),{p:1,id:7,selected:[1,3]});
    const highlights=[false,false,false,false];NET.seat=0;
    UI._mulliganView={remote:true,game:G,p:1,choiceId:7,cards:highlights.map((_,i)=>({getAnimations:()=>[],classList:{toggle:(cls,on)=>highlights[i]=on}}))};
    NET._mulliganPreviewIntercept({...response,from:'P1'});assert.deepEqual(highlights,[false,true,false,true]);
    UI._mulliganView=owner;NET.seat=1;owner.locked=true;
    NET._mulliganPreviewIntercept({...request,from:'P0'});assert.equal(sent.length,0);
    owner.locked=false;NET.catchingUp=true;
    NET._mulliganPreviewIntercept({...request,from:'P0'});assert.equal(sent.length,0);
    NET.catchingUp=false;delete NET.pendingChoices[7];
    NET._mulliganPreviewIntercept({...request,from:'P0'});assert.equal(sent.length,0);
    assert.equal(JSON.stringify(G),before);assert.equal(NET.choiceSeq,7);
  `);
});
