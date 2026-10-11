'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');

function create(){
  const root=process.env.BOT_TEST_SOURCE || process.env.RIFTBOUND_ENGINE_TEST_ROOT || path.resolve(__dirname,'../../../client/web/js');
  const context=vm.createContext({console,assert,setTimeout,clearTimeout});
  const run=code=>vm.runInContext(code,context,{timeout:15000});
  run(`const NET={online:false},DOMAIN_KO={},KEYWORDS_KO={};
    const SPELL_STAGE_CANCEL=Symbol('spell-stage-cancel');let UI={};`);
  for(const name of ['cards.js','effects.js','cardscripts.js','engine.js','bot-eval.js','bot-sim.js','bot-policy.js']){
    const file=name==='engine.js' && process.env.RIFTBOUND_BASELINE_ENGINE
      ? process.env.RIFTBOUND_BASELINE_ENGINE : path.join(root,name);
    vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:name});
  }
  run(`
    compileAllCards();
    function reset(){
      const player=i=>({idx:i,name:'P'+i,legendN:247,legendEx:true,champN:39,champInZone:false,
        base:[],gear:[],runes:[],runeDeck:[],energy:0,energySpell:0,powerSpell:0,power:{Fury:0,Calm:0,Mind:0,Body:0,Order:0,Chaos:0,Any:0},
        deck:[1,1,1,1],deckList:[],hand:[],trash:[],banish:[],points:0,playedCards:0,playedSeq:0,scoredBf:{}});
      G={players:[player(0),player(1)],bfs:[
        {n:280,owner:0,controller:null,contestedBy:null,units:[],hiddenCards:[],scored:{}},
        {n:282,owner:1,controller:null,contestedBy:null,units:[],hiddenCards:[],scored:{}}],
        turn:0,turnCount:4,phase:'action',state:'neutral',showdown:null,winner:null,actingPlayer:0,manual:false,victory:8,chainSequence:0};
      G.tflags=freshTF();UID=1;
      _sourceGone=false;_ctxBf=null;_hiddenBf=null;_ctxUnit=null;_curKind='effect';_preTarget=undefined;_execDepth=0;
      SIM.active=false;SIM.lock=false;SIM.settling=false;SIM.deadline=0;SIM.picks=0;SIM.maxPicks=4000;
      POLICY.level='master';POLICY.peek=false;POLICY._sdKey=null;POLICY._sdSeen=null;POLICY._sdTried=new Set();
      UI=simUI(POLICY);
      UI.pickReaction=async()=>null;UI.pickOption=async(p,t,opts)=>opts[0]?.v;
      UI.pickUnitFrom=async(p,units)=>units[0]||null;UI.confirmP=async()=>true;
      return G;
    }
    function unit(n,p,loc=0){const u=makeUnit(n,p,{loc,ready:true});
      if(loc==='base')G.players[p].base.push(u);else G.bfs[loc].units.push(u);return u;}
    function chooseCustom(target){UI.pickOption=async(p,t,opts)=>{
      const choice=opts.find(o=>o.v?.uid===target.uid || o.v?.g===target);
      return choice?.v ?? opts[0]?.v;
    };}
    function stagedUI(confirm){
      UI.beginSpellStage=(p,idx,n)=>(UI.spellStage={p,idx,n});
      UI.confirmSpellStage=confirm;UI.endSpellStage=()=>{UI.spellStage=null;};
    }
    reset();
  `);
  return {context,run};
}
module.exports={create};
