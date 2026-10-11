const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('./engine-real-helper.cjs');

test('Aurora requires placement and canceled legacy input still plays to base',async()=>{
  const c=create();
  c.run(`G.players[0].deck=[9,12,17];let picks=0;
    UI.pickOption=async(p,title,options)=>{picks++;assert(options.every(o=>o.requiredPlacement));return null;};`);
  await c.run(`execOps([{op:'dawnAurora'}],{p:0,n:160,kind:'effect'})`);
  c.run(`assert.equal(picks,1);assert.equal(G.players[0].base[0].n,12);
    assert.deepEqual(G.players[0].banish,[]);assert.deepEqual(G.players[0].hand,[]);
    assert.deepEqual(G.players[0].deck,[17,9]);`);
});

test('Aurora honors a card play prohibition without asking for placement',async()=>{
  const c=create();
  c.run(`G.players[0].deck=[9,12,17];TF().noPlay[0]=true;
    UI.pickOption=async()=>{assert.fail('prohibited play must not ask for placement');};`);
  await c.run(`execOps([{op:'dawnAurora'}],{p:0,n:160,kind:'effect'})`);
  c.run(`assert.deepEqual(G.players[0].base,[]);assert.deepEqual(G.players[0].banish,[12]);assert.deepEqual(G.players[0].deck,[17,9]);`);
});

test('ordinary optional effect plays retain placement cancellation',async()=>{
  const c=create();
  c.run(`UI.pickOption=async(p,title,options)=>{assert(options.every(o=>!o.requiredPlacement));return null;};`);
  await c.run(`playCardByEffect(0,12,{ignoreEnergy:true,ignorePower:true})`);
  c.run(`assert.deepEqual(G.players[0].base,[]);assert.deepEqual(G.players[0].banish,[12]);`);
});

for(const p of [0,1])for(const manual of [false,true])for(const loc of ['base',0])
test(`hand unit captures its original card and flies once to its actual placement: seat ${p}, manual ${manual}, loc ${loc}`,async()=>{
  const c=create();
  c.run(`G.turn=G.actingPlayer=${p};G.manual=${manual};G.bfs[0].controller=${p};
    G.players[${p}].hand=[9,12,17];G.players[${p}].energy=20;
    for(const dom in G.players[${p}].power)G.players[${p}].power[dom]=10;
    let captures=0,moves=[];
    const origin={game:G,anchor:()=>({left:30,top:60,width:74,height:104})};
    UI.fx={captureOrigin:selector=>{
      assert.equal(selector,'#hand-${p} [data-hand-index="1"]');
      assert.equal(G.players[${p}].hand[1],12);captures++;return origin;
    },moveCard:(player,n,from,to,opts)=>moves.push({player,n,from,to,opts})};
    UI.pickOption=async()=>${JSON.stringify(loc)};
  `);
  assert.equal(await c.run(`playCardFromHand(${p},1,{})`),true);
  c.run(`const played=${loc==='base'?`G.players[${p}].base[0]`:'G.bfs[0].units[0]'};
    assert.equal(played.loc,${JSON.stringify(loc)});assert.equal(played.n,12);
    assert.deepEqual(G.players[${p}].hand,[9,17]);
    assert.equal(captures,1);assert.equal(moves.length,1);
    assert.equal(moves[0].player,${p});assert.equal(moves[0].n,12);
    assert.equal(moves[0].from,origin);assert.equal(moves[0].to,'#board [data-uid="'+played.uid+'"]');
    assert.deepEqual(moves[0].opts,{unit:true,opponentOnly:true});
  `);
});

test('canceled placement queues no movement and leaves the hand/cost intact',async()=>{
  const c=create();
  c.run(`G.players[0].hand=[12];G.players[0].energy=20;
    for(const dom in G.players[0].power)G.players[0].power[dom]=10;
    UI.pickOption=async()=>null;
    UI.fx={captureOrigin:()=>assert.fail('canceled departure'),moveCard:()=>assert.fail('canceled flight')};`);
  assert.equal(await c.run('playCardFromHand(0,0)'),false);
  c.run(`assert.deepEqual(G.players[0].hand,[12]);assert.equal(G.players[0].energy,20);assert.equal(G.players[0].base.length,0);`);
});

test('effect units retain their explicit source without animating a temporary hand',async()=>{
  const c=create();
  c.run(`let moves=[];
    UI.fx={captureOrigin:()=>assert.fail('effect hand is temporary'),moveCard:(p,n,from,to,opts)=>moves.push({from,to})};`);
  await c.run(`playCardByEffect(0,12,{ignoreEnergy:true,ignorePower:true,playLoc:'base',fxSource:'#deck-0'})`);
  c.run(`assert.equal(moves.length,1);assert.equal(moves[0].from,'#deck-0');
    assert.equal(moves[0].to,'#board [data-uid="'+G.players[0].base[0].uid+'"]');`);
});

test('missing or disabled visual origin does not stop a unit from being played',async()=>{
  const c=create();
  c.run(`G.players[0].hand=[12];G.players[0].energy=20;
    for(const dom in G.players[0].power)G.players[0].power[dom]=10;
    UI.fx={captureOrigin:()=>null,moveCard:()=>assert.fail('no visual origin')};`);
  assert.equal(await c.run(`playCardFromHand(0,0,{playLoc:'base'})`),true);
  c.run(`assert.deepEqual(G.players[0].hand,[]);assert.equal(G.players[0].base[0].n,12);`);
});

for(const p of [0,1])for(const manual of [false,true])
test(`hand gear flies once to its new base slot: seat ${p}, manual ${manual}`,async()=>{
  const c=create();
  c.run(`G.turn=G.actingPlayer=${p};G.manual=${manual};
    G.players[${p}].hand=[9,17,12];G.players[${p}].energy=20;
    G.players[${p}].gear=[{n:32,ex:false,attachedTo:null}];
    let captures=0,moves=[];
    const origin={game:G,handDeparture:true,anchor:()=>({left:30,top:60,width:74,height:104})};
    UI.fx={captureOrigin:selector=>{
      assert.equal(selector,'#hand-${p} [data-hand-index="1"]');
      assert.equal(G.players[${p}].hand[1],17);captures++;return origin;
    },moveCard:(player,n,from,to,opts)=>moves.push({player,n,from,to,opts})};`);
  assert.equal(await c.run(`playCardFromHand(${p},1,{})`),true);
  c.run(`assert.deepEqual(G.players[${p}].hand,[9,12]);
    assert.equal(G.players[${p}].gear[1].n,17);
    assert.equal(captures,1);assert.equal(moves.length,1);
    assert.equal(moves[0].player,${p});assert.equal(moves[0].n,17);
    assert.equal(moves[0].from,origin);assert.equal(moves[0].to,'#base-${p} [data-gear-index="1"]');
    assert.deepEqual(moves[0].opts,{unit:true,opponentOnly:true});`);
});

test('effect gear keeps its explicit source and never captures a temporary hand',async()=>{
  const c=create();
  c.run(`let moves=[];UI.fx={captureOrigin:()=>assert.fail('temporary hand'),
    moveCard:(p,n,from,to,opts)=>moves.push({from,to})};`);
  await c.run(`playCardByEffect(0,17,{ignoreEnergy:true,ignorePower:true,fxSource:'#deck-0'})`);
  c.run(`assert.equal(moves.length,1);assert.equal(moves[0].from,'#deck-0');
    assert.equal(moves[0].to,'#base-0 [data-gear-index="0"]');assert.equal(G.players[0].gear[0].n,17);`);
});

test('disabled gear animation does not prevent playing from hand',async()=>{
  const c=create();
  c.run(`G.players[0].hand=[17];G.players[0].energy=20;
    UI.fx={captureOrigin:()=>null,moveCard:()=>assert.fail('disabled flight')};`);
  assert.equal(await c.run(`playCardFromHand(0,0,{})`),true);
  c.run(`assert.deepEqual(G.players[0].hand,[]);assert.equal(G.players[0].gear[0].n,17);`);
});

for(const p of [0,1])for(const manual of [false,true])for(const loc of ['base',0])
test(`chosen champion flies from its zone once: seat ${p}, manual ${manual}, loc ${loc}`,async()=>{
  const c=create();
  c.run(`G.turn=G.actingPlayer=${p};G.manual=${manual};G.bfs[0].controller=${p};
    G.players[${p}].champInZone=true;G.players[${p}].champN=39;
    G.players[${p}].hand=[9,17];G.players[${p}].energy=20;
    for(const dom in G.players[${p}].power)G.players[${p}].power[dom]=10;
    let captures=0,moves=[];
    const origin={game:G,handDeparture:true,anchor:()=>({left:30,top:60,width:74,height:104})};
    UI.fx={captureOrigin:selector=>{
      assert.equal(selector,'#champzone-${p} .card-mini');
      assert.equal(G.players[${p}].champInZone,true);captures++;return origin;
    },moveCard:(player,n,from,to,opts)=>moves.push({player,n,from,to,opts})};
    UI.pickOption=async()=>${JSON.stringify(loc)};`);
  assert.equal(await c.run(`playCardFromHand(${p},-1,{champZone:true,playLoc:${JSON.stringify(loc)}})`),true);
  c.run(`const played=${loc==='base'?`G.players[${p}].base[0]`:'G.bfs[0].units[0]'};
    assert.equal(played.n,39);assert.equal(played.loc,${JSON.stringify(loc)});
    assert.equal(G.players[${p}].champInZone,false);assert.deepEqual(G.players[${p}].hand,[9,17]);
    assert.equal(captures,1);assert.equal(moves.length,1);
    assert.equal(moves[0].from,origin);assert.equal(moves[0].to,'#board [data-uid="'+played.uid+'"]');`);
});

test('canceling champion placement leaves the champion zone intact without a flight',async()=>{
  const c=create();
  c.run(`G.players[0].champInZone=true;G.players[0].energy=20;
    UI.pickOption=async()=>null;
    UI.fx={captureOrigin:()=>assert.fail('canceled champion departure'),moveCard:()=>assert.fail('canceled flight')};`);
  assert.equal(await c.run(`playCardFromHand(0,-1,{champZone:true})`),false);
  c.run(`assert.equal(G.players[0].champInZone,true);assert.equal(G.players[0].energy,20);assert.equal(G.players[0].base.length,0);`);
});
