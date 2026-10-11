const test=require('node:test');
const {create}=require('./engine-real-helper.cjs');
for(const ex of [false,true])for(const choice of [null,0])for(const count of [1,2])
test(`hide rune cost: ${count} rune(s), exhausted=${ex}, choice=${choice}`,async()=>{
 const c=create();
 c.run(`G.bfs[0].controller=0;G.players[0].hand=[97];G.players[0].runes=Array.from({length:${count}},()=>({n:89,ex:${ex}}));
  globalThis.before=JSON.stringify(G);UI.pickOption=async(p,title,options)=>{
   if(options[0]?.hidePayment) return null;
   assert(options.every(o=>o.hideRuneCost));assert.equal(options.length,${count});return ${choice};
  };`);
 await c.run('hideCard(0,0,0)');
 c.run(choice===null?`assert.equal(JSON.stringify(G),before);`:`
  assert.equal(G.players[0].hand.length,0);assert.equal(G.bfs[0].hiddenCards[0].n,97);
  assert.equal(G.players[0].runes.length,${count-1});assert.equal(G.players[0].runeDeck.length,1);
  assert.equal(G.players[0].energy,${ex?0:1});assert.equal(Object.values(G.players[0].power).reduce((a,b)=>a+b,0),0);`);
});
test('hide rune cost revalidates destination after selection',async()=>{
 const c=create();c.run(`G.bfs[0].controller=0;G.players[0].hand=[97];G.players[0].runes=[{n:89,ex:false}];
 UI.pickOption=async()=>{G.bfs[0].controller=1;return 0;};`);
 await c.run('hideCard(0,0,0)');c.run(`assert.equal(G.players[0].runes.length,1);assert.equal(G.players[0].runes[0].ex,false);assert.equal(G.players[0].hand[0],97);assert.equal(G.bfs[0].hiddenCards.length,0);`);
});
test('floating power and free hide do not request recycled runes',async()=>{
 for(const free of [false,true]){
  const c=create();c.run(`G.bfs[0].controller=0;G.players[0].hand=[97];G.players[0].power.Any=1;TF().freeHide[0]=${free};
  UI.pickOption=async()=>{throw new Error('unexpected rune selection');};`);
  await c.run('hideCard(0,0,0)');c.run(`assert.equal(G.bfs[0].hiddenCards[0].n,97);assert.equal(G.players[0].power.Any,${free?1:0});`);
 }
});

test('cancel ordinary rune selection returns to the staged spell, then retry pays only once',async()=>{
 const c=create();c.run(`G.bfs[0].controller=0;G.players[0].hand=[213];G.players[0].runes=[{n:89,ex:false}];
 globalThis.runePicks=0;globalThis.costPicks=0;globalThis.before=JSON.stringify(G);
 globalThis.confirms=0;globalThis.resumes=0;
 UI.beginSpellStage=(p,handIdx,n)=>UI.spellStage={game:G,p,handIdx,n,committed:false};
 UI.confirmSpellStage=async draft=>{confirms++;draft.committed=true;UI.spellStage=null;};
 UI.resumeSpellStage=draft=>{resumes++;draft.committed=false;UI.spellStage=draft;return true;};
 UI.endSpellStage=()=>{UI.spellStage=null;};
 UI.pickOption=async(p,title,options)=>{
  assert.equal(JSON.stringify(G),before);
  if(options[0].hidePayment){costPicks++;return 'power';}
  return ++runePicks===1?null:0;
 };`);
 await c.run('hideCard(0,0,0,{stageHide:true})');c.run(`assert.equal(runePicks,2);assert.equal(costPicks,0);
 assert.equal(confirms,2);assert.equal(resumes,1);
 assert.equal(G.bfs[0].hiddenCards.length,1);assert.equal(G.players[0].runeDeck.length,1);assert.equal(G.players[0].energy,1);`);
});

test('ordinary hide without a staged spell cancels without a redundant power-cost window',async()=>{
 const c=create();c.run(`G.bfs[0].controller=0;G.players[0].hand=[97];G.players[0].runes=[{n:89,ex:false}];
 globalThis.before=JSON.stringify(G);UI.pickOption=async(p,title,options)=>{
  assert(options.every(o=>o.hideRuneCost));return null;
 };`);
 await c.run('hideCard(0,0,0)');c.run('assert.equal(JSON.stringify(G),before);');
});
test('cancel rune selection can switch to the alternate energy cost',async()=>{
 const c=create();c.run(`G.bfs[0].controller=0;G.players[0].legendN=Object.keys(FX).map(Number).find(n=>FX[n].altHideCost);
 G.players[0].hand=[97];G.players[0].runes=[{n:89,ex:false}];
 globalThis.costPicks=0;UI.pickOption=async(p,title,options)=>options[0].hidePayment?(++costPicks===1?'power':'energy'):null;`);
 await c.run('hideCard(0,0,0)');c.run(`assert.equal(costPicks,2);assert.equal(G.bfs[0].hiddenCards.length,1);
 assert.equal(G.players[0].runes.length,1);assert.equal(G.players[0].runes[0].ex,true);assert.equal(G.players[0].runeDeck.length,0);`);
});
