'use strict';
const test=require('node:test');
const fixture=require('./fixtures/victory-board.json');
const {create}=require('./engine-real-helper.cjs');

function scenario(name,body){
  test(name,{timeout:30000},async()=>{
    const {run}=create();
    await run(`(async()=>{
      G=${JSON.stringify(fixture)};UID=100;seedRng(1);
      const p=1;G.players[p].hand=[9];UI=simUI(POLICY);UI.pickReaction=async()=>null;
      const ctx=POLICY.newCtx();POLICY.syncCtx(ctx);
      ${body}
      assert.equal(polVictoryTarget,null);assert.equal(SIM.active,false);assert.equal(SIM.lock,false);
      assert.equal(SIM.stats.errors,0);
    })()`);
  });
}
scenario('real observed friendly Ray line wins and leaves search state untouched',`
  const hash=simHash(G),uid=UID,rng=_rngState,ui=UI;
  const a=await polVictoryChoice(p,ctx);
  assert(a);assert.equal(a.n,9);assert.equal(a.winTarget.uids[0],23);
  assert.equal(simHash(G),hash);assert.equal(UID,uid);assert.equal(_rngState,rng);assert.equal(UI,ui);
  assert.notEqual(await POLICY.runAction(p,a),false);await simSettle(null,POLICY);
  assert.equal(everyUnit().find(u=>u.uid===23).dmg,3);
  const b=await POLICY.nextAction(p,ctx);assert.equal(b.kind,'move');
  assert.notEqual(await POLICY.runAction(p,b),false);await simSettle(null,POLICY);
  assert.equal(G.winner,p);
`);
for(const [name,change] of [
  ['no winning score',`G.players[p].points=0;`],
  ['no Darius',`G.players[p].base=[];`],
  ['trigger already spent',`G.players[p].playedSeq=2;`],
  ['no movement budget',`ctx.movesLeft=0;`],
  ['no payment',`G.players[p].runes=[];G.players[p].energy=0;G.players[p].power={};G.players[p].legendEx=true;`],
  ['stunned army',`G.players[p].base[0].stunned=true;`]
])scenario('ordinary friendly-fire prohibition survives '+name,`
  ${change}const hash=simHash(G);
  assert.equal(await polVictoryChoice(p,ctx),null);
  assert.equal(simHash(G),hash);assert.equal(polCanPlay(p,card(9)),false);
`);
scenario('changed state invalidates a winning self-harm action before payment',`
  const a=await polVictoryChoice(p,ctx);assert(a);
  G.players[p].playedSeq=2;const hash=simHash(G);
  assert.equal(await POLICY.runAction(p,a),false);assert.equal(simHash(G),hash);
`);
scenario('online play does not start speculative search',`
  NET.online=true;assert.equal(await polVictoryChoice(p,ctx),null);
`);
for(const n of [5,14,24,29,50,85,93,105,133,213,229,252,256,303,312,322])
scenario('generic engine effects, no KaiSa legend dependency: card '+n,`
  G.players[p].legendN=257;G.players[p].hand=[${n}];G.players[p].energy=40;
  for(const d of Object.keys(G.players[p].power))G.players[p].power[d]=40;
  const a=await polVictoryChoice(p,ctx);assert(a,'no winning plan for '+${n});
  assert(a.winTarget);assert.equal(a.n,${n});
  assert.notEqual(await POLICY.runAction(p,a),false);await simSettle(null,POLICY);
  for(let i=0;i<6&&G.winner===null;i++){
    const b=await POLICY.nextAction(p,ctx);assert(b,'missing proved continuation');
    assert.notEqual(await POLICY.runAction(p,b),false);
    if(b.kind==='move')ctx.movesLeft--;await simSettle(null,POLICY);
  }
  assert.equal(G.winner,p);
`);
scenario('no winning alternatives leaves ordinary policy action unchanged',`
  G.players[p].points=0;
  const baseline=await POLICY.baseNextAction(p,ctx);
  const actual=await POLICY.nextAction(p,ctx);
  assert.equal(actual.kind,baseline.kind);assert.equal(actual.n,baseline.n);
`);
scenario('a known preparation card works without Darius or a named legend plan',`
  G.players[p].legendN=257;G.players[p].hand=[9,132];
  G.players[p].base=[];const army=unit(82,p,'base');army.ex=true;
  G.players[p].energy=20;G.players[p].power.Body=10;
  const a=await polVictoryChoice(p,ctx);assert(a);assert.equal(a.n,132);
  assert.notEqual(await POLICY.runAction(p,a),false);await simSettle(null,POLICY);
  const b=await POLICY.nextAction(p,ctx);assert.equal(b.kind,'move');
  assert.notEqual(await POLICY.runAction(p,b),false);await simSettle(null,POLICY);
  assert.equal(G.winner,p);
`);
scenario('opponent concealed hand and unknown deck order do not select the winning line',`
  const a=await polVictoryChoice(p,ctx);assert(a);
  G.players[opp(p)].hand=[122,209,85];G.players[p].deck.reverse();
  const b=await polVictoryChoice(p,ctx);assert(b);
  assert.equal(a.n,b.n);assert.deepEqual(a.winTarget.uids,b.winTarget.uids);
`);
scenario('zero remaining search budget returns to ordinary play and restores the deadline',`
  SIM.deadline=Date.now()-1;const deadline=SIM.deadline,hash=simHash(G);
  assert.equal(await polVictoryChoice(p,ctx),null);assert.equal(SIM.deadline,deadline);
  assert.equal(simHash(G),hash);SIM.deadline=0;
`);
scenario('the same friendly spell win works from the other seat',`
  G.players.reverse();G.players.forEach((P,i)=>P.idx=i);
  for(const u of everyUnit()){u.ctrl=1-u.ctrl;u.owner=1-u.owner;}
  for(const b of G.bfs){b.owner=1-b.owner;if(b.controller!==null)b.controller=1-b.controller;
    if(b.contestedBy!==null)b.contestedBy=1-b.contestedBy;b.scored={};}
  G.turn=G.actingPlayer=0;G.firstPlayer=1-G.firstPlayer;G.tflags=freshTF();
  const local=POLICY.newCtx();POLICY.syncCtx(local);
  const a=await POLICY.nextAction(0,local);assert(a.winTarget);assert.equal(a.n,9);
  assert.notEqual(await POLICY.runAction(0,a),false);await simSettle(null,POLICY);
  const b=await POLICY.nextAction(0,local);assert.equal(b.kind,'move');
  assert.notEqual(await POLICY.runAction(0,b),false);await simSettle(null,POLICY);
  assert.equal(G.winner,0);
`);
