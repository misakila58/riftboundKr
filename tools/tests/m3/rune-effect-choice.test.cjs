const test=require('node:test');
const {create}=require('./engine-real-helper.cjs');
const fs=require('node:fs');
const path=require('node:path');

test('rune number picker returns the selected rune indices and leaves other number dialogs intact',async()=>{
  const c=create(),source=fs.readFileSync(path.join(__dirname,'../../../client/web/js/ui.js'),'utf8');
  c.run(`let localCalls=0,runeCalls=0,wire=[];
    async function routedPick(p,local,encode,decode){const value=encode(await local());wire.push(value);return decode(value);}
    const _pickNumberLocal=async()=>{localCalls++;return 2;};
    UI.mobileHand={pickRuneNumber:async()=>{runeCalls++;return {amount:3,runes:[0]};}};
    G.players[0].runes=[{n:89,ex:true}];`);
  c.run(source.slice(source.indexOf('UI.pickNumber = function'),source.indexOf('function _pickNumberLocal(')));
  await c.run(`(async()=>{
    assert.deepEqual(await UI.pickNumber(0,'힘',0,4,{runeCount:true}),{amount:3,runes:[0]});
    assert.equal(await UI.pickNumber(0,'일반 숫자',0,4),2);
    G.players[0].runes=[];
    assert.deepEqual(await UI.pickNumber(0,'힘',0,4,{runeCount:true}),{amount:3,runes:[0]});
    assert.equal(runeCalls,2);assert.equal(localCalls,1);assert.deepEqual(wire,[{amount:3,runes:[0]},2,{amount:3,runes:[0]}]);
  })()`);
});

for(const amount of [0,1,2,4,5]) test(`Guns Blazing preserves numeric payment and rune order for power ${amount}`,async()=>{
  const c=create();
  c.run(`
    const P=G.players[0];P.power.Any=1;
    P.runes=[false,true,true,false].map((ex,i)=>({n:89,ex,original:i}));
    const enemy=unit(12,1),friend=unit(12,0);
    let choices=0;
    UI.pickNumber=async(p,title,min,max,context)=>{
      choices++;assert.equal(p,0);assert.equal(min,0);assert.equal(max,5);
      assert.equal(context.bfIdx,0);assert.equal(context.runeCount,true);
      assert.equal(P.runes.length,4);assert.equal(P.energy,0);assert.equal(P.power.Any,1);
      return ${amount};
    };
  `);
  await c.run(`execOps([{op:'gunsBlazing'}],{p:0,n:268,kind:'spell'})`);
  c.run(`
    assert.equal(choices,1);assert.equal(friend.dmg,0);
    assert.equal(enemy.dmg,${amount});
    assert.equal(P.runes.length,4-Math.max(0,${amount}-1));
    assert.equal(P.power.Any,${amount}===0?1:0);
    assert.equal(P.energy,Math.max(0,${amount}-3));
    const remaining=${amount}<=1?[0,1,2,3]:${amount}===2?[0,2,3]:${amount}===4?[3]:[];
    assert.deepEqual(P.runes.map(r=>r.original),remaining);
  `);
});

test('Divine Judgment keeps distinct hand copies marked during each players second choice',async()=>{
  const c=create();
  c.run(`
    G.players[0].hand=[1,1,9];G.players[1].hand=[1,1,9];
    let handChoices=0;
    UI.pickOption=async(p,title,options)=>{
      if(title.includes('손패에서 남길 카드')){
        const kept=options[0].judgmentKeep.keptTargets;
        if(title.includes('(1/2)')) assert.equal(kept.length,0);
        else{
          assert.deepEqual(kept,[{kind:'hand',p,index:0}]);
          assert(options.every(o=>o.boardCard.index!==0));
          assert.equal(options[0].boardCard.index,1);
        }
        handChoices++;
      }
      return options[0].v;
    };
  `);
  await c.run(`execOps([{op:'divineJudgment'}],{p:0,n:244,kind:'spell'})`);
  c.run(`assert.equal(handChoices,4);
    for(const p of G.players)assert.deepEqual(p.hand,[1,1]);`);
});

test('preparing the next hand choice keeps the expanded hand; exiting modal board view closes it',()=>{
  const c=create(),source=fs.readFileSync(path.join(__dirname,'../../../client/web/js/ui.js'),'utf8');
  c.run(`
    const classes=()=>{const set=new Set();return {contains:x=>set.has(x),
      toggle:(x,on)=>on?set.add(x):set.delete(x),remove:(...xs)=>xs.forEach(x=>set.delete(x))};};
    const overlay={style:{display:'none'},classList:classes()};
    const box={setAttribute(){},removeAttribute(){}};
    const toggle={hidden:false,setAttribute(){}};
    const document={body:{classList:classes()},getElementById:id=>
      id==='modal-overlay'?overlay:id==='modal-box'?box:toggle};
    let expanded=true;UI.mobileHand={close(){expanded=false;}};UI.hideHover=()=>{};
  `);
  c.run(source.slice(source.indexOf('function setModalPeeking('),source.indexOf('function modalPeeking(')));
  c.run(source.slice(source.indexOf('function closeModal(){'),source.indexOf('// 정보성 모달',source.indexOf('function closeModal(){'))));
  c.run(`closeModal();assert.equal(expanded,true);
    closeModal();assert.equal(expanded,true);
    overlay.style.display='flex';setModalPeeking(true);closeModal();assert.equal(expanded,false);`);
});

for(const optional of [true,false]) test(`ready rune choices retain real indices, optional=${optional}`,async()=>{
  const c=create();
  c.run(`G.players[1].runes=[{n:89,ex:false},{n:89,ex:true},{n:89,ex:true}];
    UI.pickOption=async(p,title,options)=>{
      assert.equal(p,1);assert.equal(options[0].runePick.index,1);
      assert.equal(options[1].runePick.index,2);
      assert.equal(options[1].runePick.required,${!optional});
      return options[1].v;
    };`);
  await c.run(`readyRunesPick(1,1,${optional})`);
  c.run(`assert.equal(G.players[1].runes[1].ex,true);assert.equal(G.players[1].runes[2].ex,false);`);
});

test('forced recycle choice preserves exhausted-rune preference and original index',async()=>{
  const c=create();
  c.run(`G.players[0].runes=[{n:89,ex:false},{n:89,ex:true}];
    UI.pickOption=async(p,title,options)=>{
      assert.equal(options[0].runePick.index,1);assert.equal(options[0].runePick.required,true);
      return options[0].v;
    };`);
  await c.run(`execOps([{op:'recycleRune'}],{p:0})`);
  c.run(`assert.equal(G.players[0].runes.length,1);assert.equal(G.players[0].runes[0].ex,false);
    assert.equal(G.players[0].energy,0);assert.equal(G.players[0].runeDeck.length,1);`);
});

for(const ops of [[{op:'recycleRune',n:2}],[{op:'recycleRune'},{op:'recycleRune'}]])
test(`multiple recycled runes share a batch while indices shift: ${JSON.stringify(ops)}`,async()=>{
  const c=create();
  c.run(`G.players[0].runes=[{n:7,ex:false},{n:214,ex:true},{n:7,ex:true}];
    const selected=[G.players[0].runes[0],G.players[0].runes[2]];let calls=0,batch;
    UI.pickOption=async(p,title,options)=>{
      const spec=options[0].runePick;
      if(calls===0) batch=spec.batch; else assert.equal(spec.batch,batch);
      assert.equal(spec.count,2-calls);
      const target=selected[calls++];
      const option=options.find(o=>G.players[p].runes[o.runePick.index]===target);
      return option.v;
    };`);
  await c.run(`execOps(${JSON.stringify(ops)},{p:0})`);
  c.run(`assert.equal(calls,2);assert.equal(G.players[0].runes.length,1);
    assert.equal(G.players[0].runes[0].n,214);assert.equal(G.players[0].energy,1);
    assert.equal(G.players[0].runeDeck.length,2);`);
});

test('Divine Judgment groups two kept runes per chooser and distinguishes rune owners',async()=>{
  const c=create();
  c.run(`G.players.forEach(P=>P.runes=Array.from({length:3},()=>({n:89,ex:true})));
    const kept=[G.players[0].runes[1],G.players[1].runes[1]];let calls=0,previousBatch;
    UI.pickOption=async(p,title,options)=>{
      assert(title.includes('남길 룬'));
      const spec=options[0].runePick;
      assert.equal(spec.count,2-calls%2);
      if(calls%2) assert.equal(spec.batch,previousBatch);
      else {assert.notEqual(spec.batch,previousBatch);previousBatch=spec.batch;}
      const target=kept[calls++%2];
      return options.find(o=>G.players[o.runePick.p].runes[o.runePick.index]===target).v;
    };`);
  await c.run(`execOps([{op:'divineJudgment'}],{p:0,n:244})`);
  c.run(`assert.equal(calls,4);assert.equal(G.players[0].runes.length,1);
    assert.equal(G.players[1].runes.length,1);assert.equal(G.players[0].runes[0],kept[0]);
    assert.equal(G.players[1].runes[0],kept[1]);`);
});

test('mixed ready effect retains unit and rune alternatives',async()=>{
  const c=create();
  c.run(`const friend=unit(213,0,'base');friend.ex=true;
    G.players[0].runes=[{n:89,ex:true}];
    UI.pickOption=async(p,title,options)=>{
      assert(options.some(o=>o.v.t==='u'));
      const rune=options.find(o=>o.runePick);assert.equal(rune.runePick.action,'준비');
      return rune.v;
    };`);
  await c.run(`execOps([{op:'readySomething'}],{p:0})`);
  c.run(`assert.equal(G.players[0].runes[0].ex,false);assert.equal(G.players[0].base[0].ex,true);`);
});

test('one ready effect retains its batch and real indices across multiple wire choices',async()=>{
  const c=create();
  c.run(`G.players[0].runes=Array.from({length:3},()=>({n:89,ex:true}));
    let batch, calls=0;
    UI.pickOption=async(p,title,options)=>{
      const rune=options.find(o=>o.runePick.index===(calls===0?2:0));
      if(calls===0) batch=rune.runePick.batch; else assert.equal(rune.runePick.batch,batch);
      assert.equal(rune.runePick.count,2-calls);calls++;
      return rune.v;
    };`);
  await c.run('readyRunesPick(0,2,true)');
  c.run(`assert.equal(calls,2);assert.equal(G.players[0].runes[0].ex,false);
    assert.equal(G.players[0].runes[1].ex,true);assert.equal(G.players[0].runes[2].ex,false);`);
});

test('a separate ready effect starts a new selection batch',async()=>{
  const c=create();
  c.run(`G.players[0].runes=[{n:89,ex:true}];let previous;
    UI.pickOption=async(p,title,options)=>{
      const batch=options[0].runePick.batch;
      assert.notEqual(batch,previous);previous=batch;return 'skip';
    };`);
  await c.run('readyRunesPick(0,2,true)');
  await c.run('readyRunesPick(0,2,true)');
  c.run('assert.equal(G.players[0].runes[0].ex,true);');
});

for(const payment of [{amount:2,runes:[3,1]},{amount:0,runes:[]},
  {amount:2,runes:[1,1]},{amount:1,runes:[5]},{amount:2,runes:[1]}])
test(`Guns Blazing applies actual selected runes or rejects invalid input: ${JSON.stringify(payment)}`,async()=>{
  const c=create(),valid=JSON.stringify(payment)==='{"amount":2,"runes":[3,1]}'||payment.amount===0;
  c.run(`const P=G.players[0];P.runes=[false,true,true,false].map((ex,i)=>({n:89,ex,original:i}));
    const enemy=unit(12,1);const before=JSON.stringify(P);
    UI.pickNumber=async()=>(${JSON.stringify(payment)});`);
  await c.run(`execOps([{op:'gunsBlazing'}],{p:0,n:268,kind:'spell'})`);
  if(valid&&payment.amount)c.run(`assert.deepEqual(P.runes.map(r=>r.original),[0,2]);
    assert.equal(P.energy,1);assert.equal(enemy.dmg,2);assert.equal(P.runeDeck.length,2);`);
  else c.run(`assert.equal(JSON.stringify(P),before);assert.equal(enemy.dmg,0);`);
});

for(const payment of [{amount:2,runes:[3],pool:{Order:1}},
  {amount:1,runes:[],pool:{Order:1}},{amount:1,runes:[3],pool:{}},
  {amount:0,runes:[],pool:{}},{amount:2,runes:[3],pool:{Order:2}},
  {amount:2,runes:[3],pool:{Fury:-1}},{amount:2,runes:[3],pool:{Unknown:1}},
  {amount:2,runes:[3],pool:{}},{amount:2,runes:[3],pool:{Fury:0.5}}])
test(`Guns Blazing spends only selected colored power and runes: ${JSON.stringify(payment)}`,async()=>{
  const c=create(),valid=[0,1,2,3].includes([
    '{"amount":2,"runes":[3],"pool":{"Order":1}}',
    '{"amount":1,"runes":[],"pool":{"Order":1}}',
    '{"amount":1,"runes":[3],"pool":{}}',
    '{"amount":0,"runes":[],"pool":{}}'
  ].indexOf(JSON.stringify(payment)));
  c.run(`const P=G.players[0];P.power.Fury=2;P.power.Order=1;
    P.runes=[false,true,true,false].map((ex,i)=>({n:89,ex,original:i}));
    const enemy=unit(12,1);const before=JSON.stringify(P);
    UI.pickNumber=async()=>(${JSON.stringify(payment)});`);
  await c.run(`execOps([{op:'gunsBlazing'}],{p:0,n:268,kind:'spell'})`);
  if(valid)c.run(`assert.equal(P.power.Fury,2);assert.equal(P.power.Order,1-${payment.pool.Order||0});
    assert.deepEqual(P.runes.map(r=>r.original),${payment.runes.length?'[0,1,2]':'[0,1,2,3]'});
    assert.equal(P.energy,${payment.runes.length});assert.equal(enemy.dmg,${payment.amount});`);
  else c.run(`assert.equal(JSON.stringify(P),before);assert.equal(enemy.dmg,0);`);
});
