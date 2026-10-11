const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {create}=require('./engine-real-helper.cjs');
const root=process.env.BOT_TEST_SOURCE||path.resolve(__dirname,'../../../client/web/js');
const stageSource=fs.readFileSync(path.join(root,'spell-stage.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Production stage lifecycle; drawing is stubbed because this is not a browser check.
function client(p,own=true,enabled=true){
  const c=create();
  c.run(`G.players[${p}].hand=[17,9,12];globalThis.flights=[];globalThis.captures=[];
    const window={addEventListener:()=>{}},document={
      body:{classList:{remove:()=>{}}},
      getElementById:id=>id==='spell-stage'?{remove:()=>{}}:id==='modal-box'?{replaceChildren:()=>{}}:{appendChild:()=>{},style:{}}
    };
    (()=>{
      const localControlsPlayer=()=>${own},replayLock=()=>!!globalThis.replaying,chainIsOpen=()=>false;
      const hideMenu=()=>{},closeModal=()=>{},clearPicking=()=>{},updateButtons=()=>{};
      let _moveArmed=false,_resolver=null,_pickableUids=null,_boardCardPick=null;const _moveSel=new Set();
      const settle=value=>_resolver?.(value);
      const routedPick=(p,fn,encode,decode)=>UI.routeSpellStagePick(UI.spellStage,fn,encode,decode);
      ${stageSource}
      UI.renderSpellStage=()=>{};UI.render=()=>{};UI.prompt=()=>{};UI.promptForState=()=>{};UI.hideZoom=()=>{};
      UI.fx={captureOrigin:selector=>{
        captures.push({selector,hand:G.players[${p}].hand.slice()});
        return ${enabled}?{game:G,selector,anchor:()=>selector}:null;
      },moveCard:(p,n,from,to,opts)=>flights.push({p,n,from,to,opts}),renderMoves:()=>{}};
    })();
  `);
  return c;
}

for(const p of [0,1])for(const own of [true,false])
test(`spell draft flies hand to center and cancels back: seat ${p}, own ${own}`,()=>{
  const c=client(p,own);
  c.run(`const draft=UI.beginSpellStage(${p},1,9);
    assert.equal(flights.length,1);assert.equal(flights[0].from.selector,'#hand-${p} [data-hand-index="1"]');
    assert.equal(flights[0].to,'#spell-stage .spell-stage-card');assert.equal(flights[0].opts.back,${!own});
    UI.endSpellStage(draft);
    assert.equal(flights.length,2);assert.equal(flights[1].from.selector,'#spell-stage .spell-stage-card');
    assert.equal(flights[1].to,'#hand-${p} [data-hand-index="1"]');assert.equal(flights[1].opts.back,${!own});
    assert.equal(flights[1].opts.unit,true);assert.deepEqual(G.players[${p}].hand,[17,9,12]);
    UI.endSpellStage(draft);assert.equal(flights.length,2);
  `);
});

test('real confirmation commits the draft without a return flight',async()=>{
  const c=client(0);c.run('globalThis.draft=UI.beginSpellStage(0,1,9);');
  const confirmation=c.run('UI.confirmSpellStage(draft,[])');await tick();
  c.run('UI.submitSpellStage();');await confirmation;
  c.run(`assert.equal(draft.committed,true);assert.equal(UI.spellStage,null);assert.equal(flights.length,1);
    assert.deepEqual(G.players[0].hand,[17,9,12]);`);
});

test('real cancellation settles the pending draft and returns once',async()=>{
  const c=client(0);c.run('globalThis.draft=UI.beginSpellStage(0,1,9);');
  const confirmation=c.run('UI.confirmSpellStage(draft,[])');await tick();
  c.run('UI.cancelSpellStage();');
  await confirmation.then(()=>assert.fail('canceled confirmation'),error=>assert.equal(typeof error,'symbol'));
  c.run('UI.endSpellStage(draft);assert.equal(flights.length,2);assert.equal(UI.spellStage,null);');
});

for(const flag of ['catchingUp','reconnecting','replaying'])
test(`historical/recovery stage ${flag} has no flight`,()=>{
  const c=client(0);
  c.run(`${flag==='replaying'?'globalThis':'NET'}.${flag}=true;
    const draft=UI.beginSpellStage(0,1,9);UI.endSpellStage(draft);
    assert.equal(flights.length,0);assert.equal(captures.length,0);`);
});

test('effects off preserves staging and cancellation without flights',()=>{
  const c=client(0,true,false);
  c.run(`const draft=UI.beginSpellStage(0,1,9);assert.equal(UI.spellStage,draft);
    UI.endSpellStage(draft);assert.equal(UI.spellStage,null);assert.equal(flights.length,0);
    assert.deepEqual(G.players[0].hand,[17,9,12]);`);
});

test('reset and a changed hand slot never masquerade as a player cancellation',()=>{
  const c=client(0);
  c.run(`UI.beginSpellStage(0,1,9);UI.resetSpellStage();assert.equal(flights.length,1);
    const draft=UI.beginSpellStage(0,1,9);G.players[0].hand[1]=17;UI.endSpellStage(draft);
    assert.equal(flights.length,2);assert.equal(UI.spellStage,null);`);
});
