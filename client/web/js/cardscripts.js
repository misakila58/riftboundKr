// ══════════ 카드별 스크립트 + 전용 op 구현 ══════════
// effects.js의 파서가 처리하지 못하는 카드를 개별 정의한다.
// SCRIPTS[n] = fx=>fx (compileAllCards가 적용) / EXTRA_OPS[op] = 실행기 (engine execOps의 default에서 호출)

const OPX=(op,extra)=>({op,...(extra||{})});
const D1=OPX('draw',{n:1}), D2=OPX('draw',{n:2});
const CH1X=OPX('channel',{n:1,exhausted:true});

Object.assign(SCRIPTS, {
  // ── 분노(Fury) ──
  2: fx=>{ fx.manual=[]; fx.addCost={kind:'discard',optional:true,discountE:2,label:'카드 1장 버리기 (비용 -2)'}; return fx; },
  5: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('damage',{n:3,spec:{side:'any',where:'bf',count:1}}),OPX('ifItDead',{ops:[D1]})]}]; return fx; },
  6: fx=>{ fx.manual=[]; fx.onDiscardSelf=[OPX('jawsReplay')]; return fx; },
  8: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('discard',{n:1,self:true}),OPX('dmgLastDiscardCost')]}]; return fx; },
  11: fx=>{ fx.manual=[]; fx.statics=[{kind:'enterReadyAura'}]; return fx; },
  17: fx=>{ fx.manual=[]; fx.entersExhausted=true;
      fx.activated=[{cost:{exhaustSelf:true},label:'피해 2 (전장 유닛)',ops:[OPX('damage',{n:2,spec:{side:'any',where:'bf',count:1}})]}]; return fx; },
  19: fx=>{ fx.manual=[]; fx.statics=[{kind:'selfKw',kws:['assault','ganking'],cond:u=>TF().discarded[u.ctrl]}]; return fx; },
  21: fx=>{ fx.manual=[]; fx.activated=[{cost:{exhaustSelf:true},legion:true,label:'다음 유닛 준비 등장 (군단)',
      ops:[OPX('setFlag',{flag:'nextUnitReady',val:true})]}]; return fx; },
  23: fx=>{ fx.manual=[]; fx.activated=[{cost:{exhaustSelf:true,discard:1},label:'아군 유닛에 사망 방지 부여',ops:[OPX('armoryProtect')]}]; return fx; },
  25: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('blindRage')]}]; return fx; },
  26: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('setFlag',{flag:'noPlay',side:'opp',val:true})]}]; return fx; },
  27: fx=>{ fx.manual=[]; fx.triggers.onYouPlayCard=[{cond:ctx=>ctx.seq===2,ops:[OPX('might',{n:2,self:true,dur:'turn'}),OPX('readySelf')]}]; return fx; },
  28: fx=>{ fx.manual=[]; (fx.statics=fx.statics||[]).push({kind:'selfMight',fn:u=>G.players[u.ctrl].points}); return fx; },
  31: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('setFlag',{flag:'nextSpellDisc',add:5})]}]; return fx; },
  32: fx=>{ fx.manual=[]; fx.activated=[{cost:{exhaustSelf:true},label:'다음 주문 추가 피해 1',ops:[OPX('setFlag',{flag:'nextSpellBonus',add:1})]}]; return fx; },
  33: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('extortion')]}]; return fx; },
  34: fx=>{ fx.manual=[]; fx.triggers.onConquer=[{cond:ctx=>(ctx.excess||0)>=5,ops:[OPX('scorePoint')]}]; return fx; },
  35: fx=>{ fx.manual=[]; fx.entersReady='oppBf';
      fx.triggers.onConquer=[{ops:[OPX('payThen',{energy:1,inner:OPX('bounce',{who:'me'})})]}]; return fx; },
  37: fx=>{ fx.manual=[]; fx.fromTrashOnSpellKill={energy:1,pips:['Fury']}; return fx; },
  41: fx=>{ fx.manual=[]; fx.triggers.onAttack=[{ops:[OPX('dealSplit',{n:5,spec:{side:'enemy',where:'here'}})]}]; return fx; },

  // ── 평정(Calm) ──
  43: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('moveSpec',{spec:{side:'enemy'},to:'chooseAny'})]}]; return fx; },
  44: fx=>{ fx.manual=[]; fx.addCost={kind:'pip',dom:'Calm',optional:true,label:'평정 힘 1 추가 지불'};
      fx.triggers.onPlay=[{cond:ctx=>ctx.paidAdd,ops:[D1]}]; return fx; },
  45: fx=>{ fx.manual=[]; fx.counter={maxE:4,maxPips:1}; fx.playOps=[]; return fx; },
  46: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('engarde')]}]; return fx; },
  47: fx=>{ fx.manual=[]; fx.selfCost={nearWin:[3,2]}; fx.playOps=[{ops:[D1,CH1X]}]; return fx; },
  48: fx=>{ fx.manual=[]; fx.addCost={kind:'exhaustUnit',optional:true,label:'아군 유닛 탈진 (추가 비용)'};
      fx.playOps=[{ops:[OPX('ifPaid',{ops:[D2],elseOps:[D1]})]}]; return fx; },
  53: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('buff',{count:1,spec:{side:'friendly'}}),OPX('setFlag',{flag:'buffPlus',add:1})]}]; return fx; },
  55: fx=>{ fx.manual=[]; fx.statics=[{kind:'selfMightRole',fn:(u,role)=>role&&aloneAt(u)?2:0}]; return fx; },
  56: fx=>{ fx.manual=[]; fx.triggers.onConquer=[{ops:[OPX('adaptatron')]}]; return fx; },
  59: fx=>{ fx.manual=[]; fx.triggers.onYouStun=[{ops:[OPX('readySelf'),OPX('might',{n:1,self:true,dur:'turn'})]}]; return fx; },
  60: fx=>{ fx.manual=[]; fx.gearAloneCombat=1; return fx; },
  61: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{cond:ctx=>allUnits(ctx.p).some(u=>u!==ctx.unit&&!u.isToken&&(card(u.n).tags||[]).includes('Poro')),
      ops:[OPX('buffSelf'),D1]}]; return fx; },
  62: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('lookTopPlayUnit',{n:5,discE:5})]}]; return fx; },
  63: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('buff',{count:1,spec:{side:'friendly'}})]}];
      fx.statics=[{kind:'kwAura',kws:['deflect'],filter:{side:'friendly',buffed:true}}]; return fx; },
  64: fx=>{ fx.manual=[]; fx.counter={}; fx.playOps=[]; return fx; },
  65: fx=>{ fx.manual=[]; fx.statics=[{kind:'selfMight',fn:u=>u.buff>0?1:0}]; return fx; },
  68: fx=>{ fx.manual=[]; fx.combatLast=true;
      fx.activated=[{cost:{exhaustSelf:true},onlyAtBf:true,label:'내 위력만큼 피해 (전장 유닛)',
      ops:[OPX('dmgEqMyMight',{spec:{side:'any',where:'bf',count:1}})]}]; return fx; },
  69: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('mightDouble',{spec:{side:'friendly'}}),OPX('grantKw',{who:'it',kws:[['Temporary',1]],dur:'turn'})]}]; return fx; },
  70: fx=>{ fx.manual=[]; fx.jailerUnits=true; fx.jailerReady=true; return fx; },
  71: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('partyFavor')]}]; return fx; },
  72: fx=>{ fx.manual=[]; fx.triggers.onYouKillStunned=[{ops:[OPX('exhThisDraw',{n:1})]}]; return fx; },
  73: fx=>{ fx.manual=[]; fx.triggers.onEndTurn=[{cond:(ctx,src)=>src&&src.loc!=='base',ops:[OPX('readyRunes',{n:4})]}]; return fx; },
  76: fx=>{ fx.manual=[]; fx.triggers.onAttack=[{ops:[OPX('dmgEqMyMight',{spec:{side:'enemy',where:'here',count:1}})]}]; return fx; },
  77: fx=>{ fx.manual=[]; fx.zhonya=true; return fx; },
  78: fx=>{ fx.manual=[]; fx.activated=[{cost:{exhaustSelf:true},label:'나를 버프',ops:[OPX('buffSelf')]}]; return fx; },
  79: fx=>{ fx.manual=[]; fx.entersReady='nearWin';
      fx.statics=[{kind:'mightAura',n:-8,min:1,filter:{side:'enemy',where:'here',stunned:true}}]; return fx; },
  80: fx=>{ fx.manual=[]; fx.steal=true; fx.playOps=[]; return fx; },
  84: fx=>{ fx.manual=[]; fx.spellDiscount=1; return fx; },

  // ── 정신(Mind) ──
  101: fx=>{ fx.manual=[]; fx.triggers.onBeginning=[{cond:ctx=>G.bfs.some(bf=>bf.hiddenCards.some(h=>h.by===ctx.p)),ops:[D1]}]; return fx; },
  102: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('portalRescue')]}]; return fx; },
  104: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('retreatOp')]}]; return fx; },
  107: fx=>{ fx.manual=[]; fx.triggers.onAttack=[{ops:[OPX('avaHidden')]}]; return fx; },
  108: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('chooseUnit',{spec:{side:'friendly',count:1}}),OPX('mightSetToOther')]}]; return fx; },
  109: fx=>{ fx.manual=[]; (fx.statics=fx.statics||[]).push({kind:'selfMight',fn:u=>G.players[u.ctrl].trash.length});
      fx.triggers.onBeginning=[{ops:[OPX('recycleFromTrash',{n:3})]}]; return fx; },
  110: fx=>{ fx.manual=[]; fx.triggers.onDeath=[{ops:[OPX('echoDK')]}]; return fx; },
  111: fx=>{ fx.manual=[]; fx.copyAllExhaust=true; return fx; },
  112: fx=>{ fx.manual=[]; fx.triggers.onConquer=[{ops:[OPX('kaisaTrashSpell')]}]; return fx; },
  113: fx=>{ fx.manual=[]; fx.activated=[{cost:{exhaustSelf:true,killFriendlyOrGear:true},action:true,label:'✳✳ 힘 추가',
      ops:[OPX('addPower',{dom:'Any',n:2})]}]; return fx; },
  115: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('promisingFuture')]}]; return fx; },
  116: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('might',{n:-3,all:true,min:1,spec:{side:'enemy'},dur:'turn'})]}]; return fx; },
  117: fx=>{ fx.manual=[]; fx.triggers.onYouPlayOppTurn=[{ops:[OPX('token',{count:1,might:1,name:'Recruit',where:'base'})]}]; return fx; },
  118: fx=>{ fx.manual=[]; fx.triggers.onUnitDeath=[{oncePerTurn:true,ops:[D1]}]; return fx; },
  119: fx=>{ fx.manual=[]; fx.triggers.onAttackOrDefend=[{ops:[OPX('might',{n:-2,min:1,spec:{side:'enemy',where:'here'},dur:'turn'})]}]; return fx; },
  121: fx=>{ fx.manual=[]; fx.triggers.onDefend=[{ops:[OPX('teemoDefend')]}]; return fx; },
  122: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('extraTurn'),OPX('banishSelf')]}]; return fx; },

  // ── 신체(Body) ──
  125: fx=>{ fx.manual=[]; fx.statics=[{kind:'selfKw',kws:['ganking'],cond:u=>u.buff>0}]; return fx; },
  128: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('challenge')]}]; return fx; },
  129: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('setFlag',{flag:'enterReady',val:true}),D1]}]; return fx; },
  134: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('channelOrDraw',{n:1})]}]; return fx; },
  138: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('channelOrDraw',{n:2})]}]; return fx; },
  139: fx=>{ fx.manual=[]; fx.triggers.onYouPlayUnit=[{cond:(ctx,src)=>ctx.unit!==src,ops:[OPX('buffSelf')]}]; return fx; },
  140: fx=>{ fx.manual=[]; fx.tagDiscount={tag:'Dragon',n:2,min:1}; return fx; },
  143: fx=>{ fx.manual=[]; fx.triggers.onYouReadyUnit=[{ops:[OPX('might',{n:1,it:true,dur:'turn'})]}]; return fx; },
  144: fx=>{ fx.manual=[]; fx.selfCost={enemyDied:2}; fx.playOps=[{ops:[D2]}]; return fx; },
  145: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('setFlag',{flag:'preventSpellDmg',val:true,global:true})]}]; return fx; },
  146: fx=>{ fx.manual=[]; fx.addCost={kind:'spendBuff',optional:true,ignoreCost:true,label:'버프 소모 (비용 무시)'};
      fx.playOps=[{ops:[OPX('ready',{spec:{side:'any'}})]}]; return fx; },
  149: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('chooseUnit',{spec:{side:'enemy',where:'bf',count:1}}),OPX('fightMutual')]}]; return fx; },
  150: fx=>{ fx.manual=[]; fx.addCost={kind:'spendBuffs',optional:true,pipDiscountPer:true,label:'버프 소모 (개당 힘 비용 -1)'}; return fx; },
  151: fx=>{ fx.manual=[]; fx.statics=[{kind:'mightAura',n:2,filter:{side:'friendly',where:'here',other:true,buffed:true,srcAtBf:true}}]; return fx; },
  152: fx=>{ fx.manual=[]; fx.triggers.onYouBuff=[{ops:[OPX('mistfall')]}]; return fx; },
  153: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('openPlan')]}]; return fx; },
  156: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('revealHandPick',{filter:'nonunit',action:'recycle'})]}]; return fx; },
  157: fx=>{ fx.manual=[]; fx.activated=[{cost:{spendBuff:true},label:'우디르: 하나 선택',ops:[OPX('udyr')]}]; return fx; },
  158: fx=>{ fx.manual=[]; fx.triggers.onMoveToBf=[{who:'opp',cond:(ctx,src)=>src.loc==='base'||ctx.bfIdx!==src.loc,ops:[D1]}]; return fx; },
  159: fx=>{ fx.manual=[]; fx.entersReady=true;
      fx.triggers.onAttack=[{ops:[OPX('killAll',{spec:{side:'enemy',where:'here',damaged:true}})]}]; return fx; },
  160: fx=>{ fx.manual=[]; fx.triggers.onEndTurn=[{ops:[OPX('dawnAurora')]}]; return fx; },
  161: fx=>{ fx.manual=[]; fx.playToEnemyBf=true; return fx; },
  162: fx=>{ fx.manual=[]; fx.triggers.onMoveSelf=[{cond:(ctx,src)=>src.turnMoves===1,ops:[OPX('readySomething')]}]; return fx; },
  164: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('buffSelf')]}]; fx.triggers.onConquer=[{ops:[OPX('buffSelf')]}];
      fx.activated=[{cost:{spendBuff:true},label:'+4 위력 (이번 턴)',ops:[OPX('might',{n:4,self:true,dur:'turn'})]}]; return fx; },
  165: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('trashToHand',{type:'Unit'})]}]; return fx; },
  167: fx=>{ fx.manual=[]; fx.triggers.onPlayFromHidden=[{ops:[OPX('might',{n:2,self:true,dur:'turn'})]}]; return fx; },
  168: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('moveSpec',{spec:{side:'any',where:'bf'},to:'base'})]}]; return fx; },
  169: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('bounceSpec',{spec:{side:'any',where:'bf'},maxM:3})]}]; return fx; },
  170: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('trashToHand',{type:'Unit'})]}]; return fx; },
  172: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('bounceSpec',{spec:{side:'any',where:'bf'}})]}]; return fx; },
  173: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('moveSpec',{spec:{side:'friendly'},to:'chooseAny',ready:true})]}]; return fx; },
  177: fx=>{ fx.manual=[]; fx.tagAlong=true; return fx; },

  // ── 혼돈(Chaos) ──
  179: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('eachKillsGear')]}]; return fx; },
  180: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('fadingMemory')]}]; return fx; },
  181: fx=>{ fx.manual=[]; fx.activated=[{cost:{exhaustSelf:true},label:'아군 유닛/도구/숨김 카드 회수',ops:[OPX('wonderBundle')]}]; return fx; },
  182: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[D1]}]; fx.triggers.onGearLeave=[{ops:[D1]}]; fx.onDiscardSelf=[D1]; return fx; },
  183: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('lookTopHand',{n:3})]}]; return fx; },
  185: fx=>{ fx.manual=[]; fx.triggers.onMoveSelf=[{ops:[OPX('discard',{n:1,self:true}),D1]}]; return fx; },
  186: fx=>{ fx.manual=[]; fx.triggers.onGearLeave=[{ops:[D1,CH1X]}];
      fx.activated=[{cost:{exhaustSelf:true,pips:['Chaos']},label:'이 도구 폐기',ops:[OPX('killThisGear')]}]; return fx; },
  187: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('whirlwind')]}]; return fx; },
  188: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('bounceSpec',{spec:{side:'any',where:'bf'},notSelf:true})]}]; return fx; },
  189: fx=>{ fx.manual=[]; fx.noDmgIfMoved2=true; return fx; },
  191: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('moveSpec',{spec:{side:'any',where:'bf'},to:'base'})]}]; return fx; },
  192: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('revealHandPick',{filter:'any',action:'discard'})]}]; return fx; },
  193: fx=>{ fx.manual=[]; fx.playToOpenBf=true; fx.openBfAura=true; return fx; },
  194: fx=>{ fx.manual=[]; fx.nocturne=true; return fx; },
  196: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('playFromTrash',{type:'Unit',optional:true})]}]; return fx; },
  198: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('playFromTrash',{type:'Unit'})]}]; return fx; },
  199: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('tideTurner')]}]; return fx; },
  200: fx=>{ fx.manual=[]; fx.triggers.onAttack=[{ops:[OPX('tfGamble')]}]; return fx; },
  201: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('timelineReset')]}]; return fx; },
  202: fx=>{ fx.manual=[]; fx.triggers.onYouDiscard=[{ops:[OPX('readySelf'),OPX('might',{n:1,self:true,dur:'turn'})]}]; return fx; },
  203: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('possess')]}]; return fx; },
  205: fx=>{ fx.manual=[]; fx.triggers.onMoveSelf=[{cond:(ctx,src)=>src.turnMoves===3,ops:[OPX('scorePoint')]}]; return fx; },

  // ── 질서(Order) ──
  206: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('might',{n:2,spec:{side:'friendly'},dur:'turn'}),OPX('might',{n:2,spec:{side:'friendly'},dur:'turn'})]}]; return fx; },
  207: fx=>{ fx.manual=[]; fx.addCost={kind:'spendBuff',optional:true,ignoreCost:true,label:'버프 소모 (비용 무시)'};
      fx.playOps=[{ops:[OPX('might',{n:3,spec:{side:'any'},dur:'turn'})]}]; return fx; },
  208: fx=>{ fx.manual=[]; fx.addCost={kind:'killUnit',optional:false,label:'아군 유닛 처치 (추가 비용)'}; return fx; },
  212: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('token',{count:1,might:1,name:'Recruit',where:'base'})]}];
      fx.activated=[{cost:{killSelfGear:true},label:'폐기: 폐기장 4장 재활용',ops:[OPX('recycleFromTrash',{n:4})]}]; return fx; },
  213: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('kill',{spec:{side:'any',where:'bf',count:1}}),OPX('itCtrlDraw',{n:2})]}]; return fx; },
  221: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('setFlag',{flag:'dmgKill',val:true,global:true})]}]; return fx; },
  222: fx=>{ fx.manual=[]; fx.triggers.onMoveSelf=[{cond:ctx=>ctx.dest!=='base',ops:[OPX('token',{count:1,might:1,name:'Recruit',where:'here'})]}]; return fx; },
  223: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('buffSelf'),OPX('buffOthersHere')]}]; return fx; },
  225: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('chooseUnit',{spec:{side:'enemy',count:1}}),OPX('stunOrKillIt')]}]; return fx; },
  226: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('playFromTrash',{type:'Unit',maxE:3,maxPips:1,optional:true})]}]; return fx; },
  227: fx=>{ fx.manual=[]; fx.tieRecall=true; return fx; },
  228: fx=>{ fx.manual=[]; fx.triggers.onUnitDeath=[{cond:ctx=>ctx.buffed,ops:[OPX('buff',{count:1,spec:{side:'friendly'}})]}]; return fx; },
  230: fx=>{ fx.manual=[]; fx.triggers.onPlay=[{ops:[OPX('albus')]}]; return fx; },
  231: fx=>{ fx.manual=[]; fx.addCost={kind:'killUnits',optional:true,pipDiscountPer:true,label:'아군 유닛 처치 (개당 힘 비용 -1)'}; return fx; },
  232: fx=>{ fx.manual=[]; fx.statics=[{kind:'selfKwFn',fn:u=>might(u)>=5?['deflect','ganking','shield']:null}]; return fx; },
  233: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('might',{n:5,all:true,spec:{side:'friendly'},dur:'turn'})]}]; return fx; },
  235: fx=>{ fx.manual=[]; fx.triggers.onYouRecycle=[{ops:[OPX('buff',{count:1,spec:{side:'friendly'}})]}]; return fx; },
  236: fx=>{ fx.manual=[]; fx.deathknellTwice=true; return fx; },
  237: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('kingsDecree')]}]; return fx; },
  240: fx=>{ fx.manual=[]; fx.statics=[{kind:'selfMight',fn:u=>u.loc==='base'?0:G.bfs[u.loc].units.filter(x=>x.ctrl===u.ctrl&&x.buff>0).length}]; return fx; },
  242: fx=>{ fx.manual=[]; fx.activated=[{cost:{energy:1,pips:['Order'],exhaustSelf:true},label:'미끼 바늘: 아군 처치 후 소환',ops:[OPX('luredHook')]}]; return fx; },
  243: fx=>{ if(!fx.triggers.onPlay) fx.triggers.onPlay=[{legion:true,ops:[OPX('readySelf')]}];
      fx.statics=[{kind:'mightAura',n:1,filter:{side:'friendly',where:'here',other:true,srcAtBf:true}}]; fx.manual=[]; return fx; },
  244: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('divineJudgment')]}]; return fx; },
  246: fx=>{ fx.manual=[]; fx.triggers.onUnitDeath=[{cond:(ctx,src)=>ctx.dead!==src&&ctx.tokenName!=='Recruit',
      ops:[OPX('token',{count:1,might:1,name:'Recruit',where:'base'})]}]; return fx; },

  // ── 다색/기타 주문 ──
  250: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('stormbringer')]}]; return fx; },
  258: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('dragonRage')]}]; return fx; },
  260: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('ready',{spec:{side:'friendly'}}),OPX('itDealsTo',{spec:{side:'enemy',where:'bf',count:1}})]}]; return fx; },
  262: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('stun',{spec:{side:'enemy',where:'bf',count:1}}),OPX('moveFriendlyToItsBf')]}]; return fx; },
  264: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('guerrilla')]}]; return fx; },
  266: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('powerSiphon')]}]; return fx; },
  268: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('gunsBlazing')]}]; return fx; },
  270: fx=>{ fx.manual=[]; fx.playOps=[{ops:[OPX('buff',{count:1,spec:{side:'friendly',where:'base'}}),OPX('moveItToBf')]}]; return fx; },

  // ── 전장 ──
  285: fx=>{ fx.manual=[]; fx.triggers.onDefendHere=[{ops:[OPX('moveSpec',{spec:{side:'friendly',where:'here',optional:true},to:'base'})]}]; return fx; },
  292: fx=>{ fx.manual=[]; fx.dreamingTree=true; return fx; },
});

// ══════════ 전용 op 실행기 (engine execOps의 default에서 호출) ══════════
// 시그니처: async (op, ctx, h) — h.it()/h.setIt(u)로 직전 대상 공유
const EXTRA_OPS = {
  // ── 조건부 ──
  async ifItDead(op, ctx, h){ const it=h.it(); if(it && (it._dead || (it.dmg>0 && it.dmg>=might(it)))) await execOps(op.ops, {...ctx, it}); },
  async ifPaid(op, ctx, h){ await execOps(ctx.paidAdd ? op.ops : (op.elseOps||[]), ctx); },

  // ── 피해/전투 ──
  async dmgEqMyMight(op, ctx, h){ const u=await pickBySpec(ctx.p, op.spec, '피해를 줄 대상 선택'); if(u&&ctx.unit){ dealDamage(u, might(ctx.unit), ctx.kind||'ability'); h.setIt(u); UI.log(`${unitName(u)}에게 피해 ${might(ctx.unit)}`,'combat'); } },
  async itDealsTo(op, ctx, h){ const it=h.it(); if(!it) return; const u=await pickBySpec(ctx.p, op.spec, '피해를 줄 적 유닛 선택'); if(u){ dealDamage(u, might(it), ctx.kind||'spell'); UI.log(`${unitName(it)} → ${unitName(u)}에게 위력만큼 피해`,'combat'); } },
  async fightMutual(op, ctx, h){ const it=h.it(), me=ctx.unit; if(!it||!me) return;
    dealDamage(it, might(me), 'effect'); dealDamage(me, might(it), 'effect');
    UI.log(`${unitName(me)} ⚔ ${unitName(it)} 상호 피해!`,'combat'); },
  async challenge(op, ctx, h){ const a=await pickBySpec(ctx.p,{side:'friendly',count:1},'아군 유닛 선택'); if(!a) return;
    const b=await pickBySpec(ctx.p,{side:'enemy',count:1},'적 유닛 선택'); if(!b) return;
    dealDamage(b, might(a), 'spell'); dealDamage(a, might(b), 'spell');
    UI.log(`${unitName(a)} ⚔ ${unitName(b)} 상호 피해!`,'combat'); },
  async dmgLastDiscardCost(op, ctx, h){ const d=G._lastDiscard; if(!d||d.p!==ctx.p) return;
    const cost=card(d.n).e||0; if(cost<=0) return;
    const u=await pickBySpec(ctx.p,{side:'any',where:'bf',count:1},`피해 ${cost}을 줄 대상`); if(u){ dealDamage(u,cost,'spell'); h.setIt(u); } },
  async extortion(op, ctx, h){ const u=await pickBySpec(ctx.p,{side:'enemy',count:1},'대상 적 유닛 선택'); if(!u) return;
    const o=u.ctrl;
    const sel=await UI.pickOption(o,`「갈취」: 선택하세요`,[{v:'dmg',label:`${unitName(u)}이(가) 피해 6을 받는다`},{v:'draw',label:`상대가 카드 2장을 뽑는다`}]);
    if(sel==='draw'){ drawCard(ctx.p); drawCard(ctx.p); } else dealDamage(u,6,'spell'); },
  async stunOrKillIt(op, ctx, h){ const it=h.it(); if(!it) return;
    if(it.stunned){ await killUnit(it); } else { it.stunned=true; UI.log(`${unitName(it)} 기절됨 💫`,'p'+ctx.p); await fireEvent('onYouStun',{p:ctx.p}); } },

  // ── 위력 조작 ──
  async mightDouble(op, ctx, h){ const u=await pickBySpec(ctx.p, op.spec, '위력을 2배로 할 유닛'); if(u){ u.tempM.push({v:might(u),dur:'turn'}); h.setIt(u); UI.log(`${unitName(u)} 위력 2배!`,'p'+ctx.p); } },
  async mightSetToOther(op, ctx, h){ const it=h.it(); if(!it) return;
    const others=everyUnit().filter(u=>u.ctrl===ctx.p&&u!==it);
    if(!others.length) return;
    const t=await UI.pickUnitFrom(ctx.p, others, '위력을 복사할 다른 아군 유닛'); if(!t) return;
    it.tempM.push({v:might(t)-might(it),dur:'turn'}); UI.log(`${unitName(it)} 위력 → ${might(t)}`,'p'+ctx.p); },
  async engarde(op, ctx, h){ const u=await pickBySpec(ctx.p,{side:'friendly',count:1},'위력을 올릴 아군 유닛'); if(!u) return;
    const alone = u.loc!=='base' && G.bfs[u.loc].units.filter(x=>x.ctrl===ctx.p).length===1;
    u.tempM.push({v:alone?2:1,dur:'turn'}); UI.log(`${unitName(u)} +${alone?2:1}⚔ (이번 턴)`,'p'+ctx.p); },
  async buffOthersHere(op, ctx, h){ const me=ctx.unit; if(!me||me.loc==='base') return;
    for(const u of G.bfs[me.loc].units.filter(x=>x.ctrl===ctx.p&&x!==me)) await buffUnit(u, ctx.p); },
  async powerSiphon(op, ctx, h){
    const sel=await UI.pickOption(ctx.p,'전장 선택',G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko}))); if(sel===null) return;
    G.bfs[sel].units.forEach(u=>{ u.tempM.push(u.ctrl===ctx.p?{v:1,dur:'turn'}:{v:-1,dur:'turn',min:1}); });
    UI.log(`「힘 착취」: 전장의 아군 +1 / 적 -1`,'p'+ctx.p); },

  // ── 이동/복귀 ──
  async moveSpec(op, ctx, h){ const u=await pickBySpec(ctx.p, op.spec, '이동시킬 유닛 선택'); if(!u) return;
    let dest;
    if(op.to==='base') dest='base';
    else { const opts=G.bfs.map((bf,i)=>({v:i,label:'전장: '+card(bf.n).ko})); if(op.to==='chooseAny') opts.push({v:'base',label:'기지'});
      dest=await UI.pickOption(ctx.p,'목적지 선택',opts); if(dest===null) return; }
    if(u.loc===dest) return;
    await effectMove(ctx.p, u, dest);
    if(op.ready) await readyUnit(u, ctx.p);
    h.setIt(u); },
  async moveItToBf(op, ctx, h){ const it=h.it(); if(!it) return;
    const sel=await UI.pickOption(ctx.p,'이동할 전장',G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko}))); if(sel===null) return;
    await effectMove(ctx.p, it, sel); },
  async moveFriendlyToItsBf(op, ctx, h){ const it=h.it(); if(!it||it.loc==='base') return;
    const yes=await UI.confirmP(ctx.p,'아군 유닛을 그 전장으로 이동할까요?'); if(!yes) return;
    const u=await pickBySpec(ctx.p,{side:'friendly',count:1},'이동할 아군 유닛'); if(u&&u.loc!==it.loc) await effectMove(ctx.p,u,it.loc); },
  async bounceSpec(op, ctx, h){
    let cands=everyUnit();
    if(op.spec.side==='friendly') cands=cands.filter(u=>u.ctrl===ctx.p);
    if(op.spec.side==='enemy') cands=cands.filter(u=>u.ctrl!==ctx.p);
    if(op.spec.where==='bf') cands=cands.filter(u=>u.loc!=='base');
    if(op.maxM!==undefined) cands=cands.filter(u=>might(u)<=op.maxM);
    if(op.notSelf&&ctx.unit) cands=cands.filter(u=>u!==ctx.unit);
    if(!cands.length) return;
    const u=await UI.pickUnitFrom(ctx.p, cands, '손패로 되돌릴 유닛 선택', op.spec.optional); if(!u) return;
    removeUnit(u); if(!u.isToken) G.players[u.ctrl].hand.push(u.n);
    UI.log(`${unitName(u)} 손패로 돌아감`,'p'+ctx.p); h.setIt(u); },
  async retreatOp(op, ctx, h){
    const cands=everyUnit().filter(u=>u.ctrl===ctx.p); if(!cands.length) return;
    const u=await UI.pickUnitFrom(ctx.p,cands,'손패로 되돌릴 아군 유닛'); if(!u) return;
    const owner=u.ctrl; removeUnit(u); if(!u.isToken) G.players[owner].hand.push(u.n);
    channelRunes(owner,1,true); },
  async tideTurner(op, ctx, h){ const me=ctx.unit; if(!me) return;
    const others=everyUnit().filter(u=>u.ctrl===ctx.p&&u.loc!==me.loc);
    if(!others.length) return;
    const t=await UI.pickUnitFrom(ctx.p, others, '위치를 교환할 아군 유닛 선택', true); if(!t) return;
    const a=me.loc, b=t.loc;
    removeUnit(me); removeUnit(t); placeUnit(me,b); placeUnit(t,a);
    UI.log(`「물결을 바꾸는 자」 위치 교환!`,'p'+ctx.p); },
  async possess(op, ctx, h){ const u=await pickBySpec(ctx.p,{side:'enemy',where:'bf',count:1},'통제권을 뺏을 적 유닛'); if(!u) return;
    removeUnit(u); u.ctrl=ctx.p; placeUnit(u,'base');
    UI.log(`「빙의」: ${unitName(u)}의 통제권 획득!`,'p'+ctx.p); h.setIt(u); },
  async stormbringer(op, ctx, h){
    const u=await pickBySpec(ctx.p,{side:'friendly',where:'base',count:1},'기지의 아군 유닛 선택'); if(!u) return;
    const sel=await UI.pickOption(ctx.p,'전장 선택',G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko}))); if(sel===null) return;
    for(const e of G.bfs[sel].units.filter(x=>x.ctrl!==ctx.p)) dealDamage(e, might(u), 'spell');
    await effectMove(ctx.p, u, sel); },
  async dragonRage(op, ctx, h){
    const u=await pickBySpec(ctx.p,{side:'enemy',count:1},'이동시킬 적 유닛'); if(!u) return;
    const opts=G.bfs.map((bf,i)=>({v:i,label:'전장: '+card(bf.n).ko})).concat([{v:'base',label:'기지'}]);
    const dest=await UI.pickOption(ctx.p,'목적지',opts); if(dest===null) return;
    await effectMove(ctx.p, u, dest);
    if(dest!=='base'){
      const others=G.bfs[dest].units.filter(x=>x.ctrl!==ctx.p&&x!==u);
      if(others.length){ const t=await UI.pickUnitFrom(ctx.p, others, '상호 피해를 줄 다른 적 유닛');
        if(t){ dealDamage(t, might(u), 'spell'); dealDamage(u, might(t), 'spell'); UI.log(`${unitName(u)} ⚔ ${unitName(t)} 상호 피해!`,'combat'); } }
    } },
  async whirlwind(op, ctx, h){
    for(const pi of [opp(ctx.p), ctx.p]){
      const cands=everyUnit().filter(u=>u.ctrl===pi); if(!cands.length) continue;
      const u=await UI.pickUnitFrom(pi, cands, `${pname(pi)}: 손패로 되돌릴 유닛 (선택)`, true);
      if(u){ removeUnit(u); if(!u.isToken) G.players[pi].hand.push(u.n); UI.log(`${unitName(u)} 손패로`,'p'+pi); }
    } },

  // ── 폐기장/덱 상호작용 ──
  async trashToHand(op, ctx, h){ const P=G.players[ctx.p];
    const cands=[...new Set(P.trash.filter(n=>card(n).type===(op.type||'Unit')))];
    if(!cands.length){ UI.toast('폐기장에 대상이 없습니다','warn'); return; }
    const sel=await UI.pickOption(ctx.p,'손패로 가져올 카드',cands.map(n=>({v:n,label:card(n).ko}))); if(sel===null) return;
    P.trash.splice(P.trash.indexOf(sel),1); P.hand.push(sel);
    UI.log(`${pname(ctx.p)} 「${card(sel).ko}」 폐기장에서 회수`,'p'+ctx.p); },
  async playFromTrash(op, ctx, h){ const P=G.players[ctx.p];
    let cands=[...new Set(P.trash.filter(n=>card(n).type===(op.type||'Unit')))];
    if(op.maxE!==undefined) cands=cands.filter(n=>(card(n).e||0)<=op.maxE);
    if(op.maxPips!==undefined) cands=cands.filter(n=>powerPips(card(n)).length<=op.maxPips);
    if(op.ltPoints) cands=cands.filter(n=>(card(n).e||0)<G.players[ctx.p].points);
    if(!cands.length){ if(!op.optional) UI.toast('폐기장에 대상이 없습니다','warn'); return; }
    if(op.optional){ const yes=await UI.confirmP(ctx.p,'폐기장에서 카드를 플레이할까요?'); if(!yes) return; }
    const sel=await UI.pickOption(ctx.p,'폐기장에서 플레이할 카드',cands.map(n=>({v:n,label:card(n).ko}))); if(sel===null) return;
    P.trash.splice(P.trash.indexOf(sel),1);
    const c=card(sel);
    if(c.type==='Unit'){ const u=makeUnit(sel,ctx.p,{loc:'base'}); placeUnit(u,'base'); UI.log(`${pname(ctx.p)} 「${c.ko}」 폐기장에서 플레이`,'p'+ctx.p);
      await runTriggerList((FX[sel]||{}).triggers?.onPlay, {p:ctx.p, unit:u, legionOK:true}); }
    else if(c.type==='Spell'){ UI.log(`${pname(ctx.p)} 「${c.ko}」 폐기장에서 플레이`,'p'+ctx.p);
      for(const po of ((FX[sel]||{}).playOps||[])) await execOps(po.ops,{p:ctx.p,kind:'spell'});
      if(op.thenRecycle){ G.players[ctx.p].deck.push(sel); await fireEvent('onYouRecycle',{p:ctx.p}); } else P.trash.push(sel); }
    },
  async kaisaTrashSpell(op, ctx, h){ await EXTRA_OPS.playFromTrash({type:'Spell',ltPoints:true,optional:true,thenRecycle:true}, ctx, h); },
  async recycleFromTrash(op, ctx, h){ const P=G.players[ctx.p]; let cnt=0;
    for(let i=0;i<op.n && P.trash.length;i++){ P.deck.push(P.trash.splice(Math.floor(rng()*P.trash.length),1)[0]); cnt++; }
    if(cnt){ UI.log(`${pname(ctx.p)} 폐기장 ${cnt}장 재활용`,'p'+ctx.p); await fireEvent('onYouRecycle',{p:ctx.p}); } },
  async lookTopHand(op, ctx, h){ const P=G.players[ctx.p];
    const top=P.deck.splice(0, op.n); if(!top.length) return;
    const sel=await UI.pickOption(ctx.p,'손패에 넣을 카드 1장',top.map(n=>({v:n,label:card(n).ko})));
    const take = sel!==null?sel:top[0];
    P.hand.push(take);
    top.splice(top.indexOf(take),1); P.deck.push(...top);
    if(top.length) await fireEvent('onYouRecycle',{p:ctx.p});
    UI.log(`${pname(ctx.p)} 덱 위 ${op.n}장 확인 → 1장 손패`,'p'+ctx.p); },
  async lookTopPlayUnit(op, ctx, h){ const P=G.players[ctx.p];
    const top=P.deck.splice(0, op.n); if(!top.length) return;
    const units=top.filter(n=>card(n).type==='Unit');
    let played=null;
    if(units.length){
      const sel=await UI.pickOption(ctx.p,'플레이할 유닛 (선택)',units.map(n=>({v:n,label:card(n).ko})).concat([{v:'skip',label:'플레이 안 함'}]));
      if(sel!=='skip'&&sel!==null){
        played=sel; top.splice(top.indexOf(sel),1);
        let e=Math.max(0,(card(sel).e||0)-(op.discE||0));
        if(op.maxM!==undefined && (card(sel).m||0)>op.maxM){ played=null; top.push(sel); }
        else if(played!==null){
          if(canPay(ctx.p, e, op.freePips?[]:powerPips(card(sel)))){ payCost(ctx.p, e, op.freePips?[]:powerPips(card(sel)));
            const u=makeUnit(sel,ctx.p,{loc:'base'}); placeUnit(u,'base');
            UI.log(`${pname(ctx.p)} 「${card(sel).ko}」 소환 (덱에서)`,'p'+ctx.p);
            await runTriggerList((FX[sel]||{}).triggers?.onPlay, {p:ctx.p, unit:u, legionOK:true});
          } else { UI.toast('자원이 부족해 플레이하지 못했습니다','warn'); top.push(sel); played=null; }
        }
      }
    }
    P.deck.push(...top);
    if(top.length) await fireEvent('onYouRecycle',{p:ctx.p}); },
  async luredHook(op, ctx, h){
    const mine=everyUnit().filter(u=>u.ctrl===ctx.p); if(!mine.length) return;
    const victim=await UI.pickUnitFrom(ctx.p, mine, '처치할 아군 유닛'); if(!victim) return;
    const maxM=might(victim)+1;
    await killUnit(victim);
    await EXTRA_OPS.lookTopPlayUnit({n:5, discE:999, maxM, freePips:true}, ctx, h); },
  async echoDK(op, ctx, h){ const P=G.players[ctx.p];
    const idx=P.trash.lastIndexOf(ctx.unit?ctx.unit.n:110);
    const yes=await UI.confirmP(ctx.p,'[죽음의 종소리] 에코를 덱으로 되돌리고 룬을 모두 준비할까요?'); if(!yes) return;
    if(idx>=0){ P.deck.push(P.trash.splice(idx,1)[0]); await fireEvent('onYouRecycle',{p:ctx.p}); }
    P.runes.forEach(r=>r.ex=false); UI.log(`${pname(ctx.p)} 룬 모두 준비됨 (에코)`,'p'+ctx.p); },
  async channelOrDraw(op, ctx, h){ const P=G.players[ctx.p];
    const avail=Math.min(op.n, P.runeDeck.length);
    if(avail>0) channelRunes(ctx.p, avail, true);
    if(avail<op.n) drawCard(ctx.p); },
  async timelineReset(op, ctx, h){
    for(const pi of [0,1]){ const P=G.players[pi];
      while(P.hand.length) P.trash.push(P.hand.pop());
      for(let i=0;i<4;i++) drawCard(pi);
    }
    UI.log('「시간선 역전」: 모두 손패를 버리고 4장 드로우','sys'); },
  async blindRage(op, ctx, h){ const o=opp(ctx.p); const O=G.players[o];
    if(!O.deck.length) return;
    const top=O.deck.shift(); const c=card(top);
    UI.log(`상대 덱 맨 위 공개: 「${c.ko}」`,'sys');
    const yes=await UI.confirmP(ctx.p,`「${c.ko}」을(를) 비용 무시하고 플레이할까요?`, c);
    if(yes){
      if(c.type==='Unit'){ const u=makeUnit(top,ctx.p,{loc:'base'}); placeUnit(u,'base');
        await runTriggerList((FX[top]||{}).triggers?.onPlay,{p:ctx.p,unit:u,legionOK:true}); }
      else if(c.type==='Spell'){ for(const po of ((FX[top]||{}).playOps||[])) await execOps(po.ops,{p:ctx.p,kind:'spell'}); G.players[ctx.p].trash.push(top); }
      else { G.players[ctx.p].gear.push({n:top,ex:false,attachedTo:null}); }
    } else { O.deck.push(top); await fireEvent('onYouRecycle',{p:o}); }
    },
  async promisingFuture(op, ctx, h){
    const picks={};
    for(const pi of [ctx.p, opp(ctx.p)]){ const P=G.players[pi];
      const top=P.deck.splice(0,5); if(!top.length) continue;
      const sel=await UI.pickOption(pi,`${pname(pi)}: 추방(플레이 예약)할 카드 1장`,top.map(n=>({v:n,label:card(n).ko})));
      const pick=sel!==null?sel:top[0];
      top.splice(top.indexOf(pick),1); P.deck.push(...top); picks[pi]=pick;
      if(top.length) await fireEvent('onYouRecycle',{p:pi});
    }
    for(const pi of [opp(ctx.p), ctx.p]){
      const n=picks[pi]; if(n===undefined) continue;
      const c=card(n);
      if(c.type==='Unit'){ const u=makeUnit(n,pi,{loc:'base'}); placeUnit(u,'base');
        UI.log(`${pname(pi)} 「${c.ko}」 플레이 (에너지 무시)`,'p'+pi);
        await runTriggerList((FX[n]||{}).triggers?.onPlay,{p:pi,unit:u,legionOK:true}); }
      else if(c.type==='Spell'){ for(const po of ((FX[n]||{}).playOps||[])) await execOps(po.ops,{p:pi,kind:'spell'}); G.players[pi].trash.push(n); }
      else G.players[pi].gear.push({n,ex:false,attachedTo:null});
    } },
  async dawnAurora(op, ctx, h){ const P=G.players[ctx.p];
    const revealed=[];
    let unitN=null;
    while(P.deck.length){ const n=P.deck.shift();
      if(card(n).type==='Unit'){ unitN=n; break; } revealed.push(n); }
    P.deck.push(...revealed);
    if(revealed.length) await fireEvent('onYouRecycle',{p:ctx.p});
    if(unitN!==null){ const u=makeUnit(unitN,ctx.p,{loc:'base'}); placeUnit(u,'base');
      UI.log(`「눈부신 오로라」: 「${card(unitN).ko}」 무료 소환!`,'p'+ctx.p);
      await runTriggerList((FX[unitN]||{}).triggers?.onPlay,{p:ctx.p,unit:u,legionOK:true}); } },
  async teemoDefend(op, ctx, h){ const me=ctx.unit; if(!me||me.loc==='base') return;
    const enemies=G.bfs[me.loc].units.filter(u=>u.ctrl!==ctx.p); if(!enemies.length) return;
    const t=await UI.pickUnitFrom(ctx.p, enemies, '대상 적 유닛 선택'); if(!t) return;
    const P=G.players[ctx.p];
    const top=P.deck.splice(0,5);
    const hiddenCnt=top.filter(n=>FX[n]&&FX[n].kw&&FX[n].kw.hidden).length;
    UI.log(`덱 위 5장 공개 — [숨겨짐] ${hiddenCnt}장`,'sys');
    if(hiddenCnt>0) dealDamage(t, hiddenCnt, 'effect');
    P.deck.push(...top);
    if(top.length) await fireEvent('onYouRecycle',{p:ctx.p}); },
  async tfGamble(op, ctx, h){ const P=G.players[ctx.p];
    if(!P.runeDeck.length) return;
    const rn=P.runeDeck.shift(); P.runeDeck.push(rn);
    const dom=runeDomain(rn);
    UI.log(`룬 공개: ${DOMAIN_KO[dom]||dom}`,'sys');
    if(dom==='Fury'){ const here=ctx.unit&&ctx.unit.loc!=='base'?ctx.unit.loc:null;
      const enemies=everyUnit().filter(u=>u.ctrl!==ctx.p&&(here===null||u.loc===here));
      if(enemies.length){ const t=await UI.pickUnitFrom(ctx.p,enemies,'피해 2를 줄 적 유닛');
        if(t){ dealDamage(t,2,'effect'); enemies.filter(u=>u!==t).forEach(u=>dealDamage(u,1,'effect')); } } }
    else if(dom==='Mind'){ drawCard(ctx.p); }
    else if(dom==='Order'){ const enemies=everyUnit().filter(u=>u.ctrl!==ctx.p);
      if(enemies.length){ const t=await UI.pickUnitFrom(ctx.p,enemies,'기절할 적 유닛'); if(t&&!t.stunned){ t.stunned=true; await fireEvent('onYouStun',{p:ctx.p}); } } } },
  async avaHidden(op, ctx, h){ const P=G.players[ctx.p];
    const cands=P.hand.map((n,i)=>({n,i})).filter(x=>FX[x.n]&&FX[x.n].kw&&FX[x.n].kw.hidden);
    if(!cands.length) return;
    if(!canPay(ctx.p,0,['Mind'])) return;
    const yes=await UI.confirmP(ctx.p,'정신 힘 1을 지불하고 [숨겨짐] 카드를 무료로 플레이할까요?'); if(!yes) return;
    payCost(ctx.p,0,['Mind']);
    const sel=await UI.pickOption(ctx.p,'플레이할 [숨겨짐] 카드',cands.map(x=>({v:x,label:card(x.n).ko}))); if(!sel) return;
    P.hand.splice(sel.i,1);
    const c=card(sel.n);
    if(c.type==='Unit'){ const loc=ctx.unit&&ctx.unit.loc!=='base'?ctx.unit.loc:'base';
      const u=makeUnit(sel.n,ctx.p,{loc}); placeUnit(u,loc);
      await runTriggerList((FX[sel.n]||{}).triggers?.onPlay,{p:ctx.p,unit:u,legionOK:true}); }
    else if(c.type==='Spell'){ for(const po of ((FX[sel.n]||{}).playOps||[])) await execOps(po.ops,{p:ctx.p,kind:'spell'}); P.trash.push(sel.n); }
    else P.gear.push({n:sel.n,ex:false,attachedTo:null});
    await fireEvent('onPlayFromHidden',{p:ctx.p}); },
  async guerrilla(op, ctx, h){ const P=G.players[ctx.p];
    const hiddens=[...new Set(P.trash.filter(n=>FX[n]&&FX[n].kw&&FX[n].kw.hidden))];
    for(let i=0;i<2 && hiddens.length;i++){
      const sel=await UI.pickOption(ctx.p,`폐기장에서 회수할 [숨겨짐] 카드 (${i+1}/2, 선택)`,hiddens.map(n=>({v:n,label:card(n).ko})));
      if(sel===null) break;
      P.trash.splice(P.trash.indexOf(sel),1); P.hand.push(sel); hiddens.splice(hiddens.indexOf(sel),1);
    }
    TF().freeHide[ctx.p]=true; UI.log('이번 턴 무료로 카드를 숨길 수 있습니다','p'+ctx.p); },

  // ── 자원/기타 ──
  async albus(op, ctx, h){
    const buffed=everyUnit().filter(u=>u.ctrl===ctx.p&&u.buff>0);
    const total=buffed.reduce((s,u)=>s+u.buff,0);
    if(!total) return;
    const n=await UI.pickNumber(ctx.p,'소모할 버프 개수',0,total); if(!n) return;
    let left=n;
    for(const u of buffed){ const take=Math.min(left,u.buff); u.buff-=take; left-=take; if(!left) break; }
    channelRunes(ctx.p, n, true); },
  async gunsBlazing(op, ctx, h){
    let maxP=Object.values(G.players[ctx.p].power).reduce((a,b)=>a+b,0)+G.players[ctx.p].runes.filter(r=>!r.ex).length;
    if(maxP<=0) return;
    const n=await UI.pickNumber(ctx.p,'지불할 힘(✳) 수',0,Math.min(maxP,10)); if(!n) return;
    const pips=[]; for(let i=0;i<n;i++) pips.push('Any');
    if(!canPay(ctx.p,0,pips)) return;
    payCost(ctx.p,0,pips);
    const sel=await UI.pickOption(ctx.p,'피해를 줄 전장',G.bfs.map((bf,i)=>({v:i,label:card(bf.n).ko}))); if(sel===null) return;
    G.bfs[sel].units.filter(u=>u.ctrl!==ctx.p).forEach(u=>dealDamage(u,n,'spell')); },
  async partyFavor(op, ctx, h){ const o=opp(ctx.p);
    const sel=await UI.pickOption(o,'「파티 선물」: 선택하세요',[{v:'card',label:'카드 (둘 다 1장 드로우)'},{v:'rune',label:'룬 (둘 다 룬 1개 탈진 전개)'}]);
    if(sel==='rune'){ channelRunes(ctx.p,1,true); channelRunes(o,1,true); }
    else { drawCard(ctx.p); drawCard(o); } },
  async revealHandPick(op, ctx, h){ const o=opp(ctx.p); const O=G.players[o];
    if(!O.hand.length){ UI.toast('상대 손패가 없습니다','warn'); return; }
    let cands=O.hand.map((n,i)=>({n,i}));
    if(op.filter==='nonunit') cands=cands.filter(x=>card(x.n).type!=='Unit');
    UI.log(`상대 손패 공개: ${O.hand.map(n=>card(n).ko).join(', ')}`,'sys');
    if(!cands.length) return;
    const sel=await UI.pickOption(ctx.p, op.action==='discard'?'버리게 할 카드':'재활용시킬 카드', cands.map(x=>({v:x,label:card(x.n).ko})));
    if(!sel) return;
    if(op.action==='discard'){ await discardFromHand(o, O.hand.indexOf(sel.n)); }
    else { O.hand.splice(O.hand.indexOf(sel.n),1); O.deck.push(sel.n); UI.log(`「${card(sel.n).ko}」 재활용됨`,'sys'); await fireEvent('onYouRecycle',{p:o}); } },
  async kingsDecree(op, ctx, h){ const o=opp(ctx.p);
    const cands=everyUnit().filter(u=>u.ctrl!==ctx.p);
    if(!cands.length) return;
    const u=await UI.pickUnitFrom(o, cands, `${pname(o)}: 처치될 유닛 선택`);
    if(u) await killUnit(u); },
  async eachKillsGear(op, ctx, h){
    for(const pi of [G.turn, opp(G.turn)]){ const P=G.players[pi];
      if(!P.gear.length) continue;
      const sel=await UI.pickOption(pi,`${pname(pi)}: 폐기할 도구 선택`,P.gear.map((g,i)=>({v:i,label:card(g.n).ko})));
      if(sel!==null) await killGear(pi, sel);
    } },
  async fadingMemory(op, ctx, h){
    const u=await pickBySpec(ctx.p,{side:'any',where:'bf',count:1},'[일시적]를 부여할 유닛 (전장)');
    if(u){ u.grants.temporary=true; UI.log(`${unitName(u)}에게 [일시적] 부여`,'p'+ctx.p); } },
  async wonderBundle(op, ctx, h){ const P=G.players[ctx.p];
    const opts=[];
    everyUnit().filter(u=>u.ctrl===ctx.p&&!u.isToken).forEach(u=>opts.push({v:{t:'unit',u},label:'유닛: '+unitName(u)}));
    P.gear.forEach((g,i)=>{ if(card(g.n).n!==181) opts.push({v:{t:'gear',i},label:'도구: '+card(g.n).ko}); });
    G.bfs.forEach((bf,bi)=>bf.hiddenCards.forEach((hc,hi)=>{ if(hc.by===ctx.p) opts.push({v:{t:'hidden',bi,hi},label:'숨김 카드'}); }));
    if(!opts.length) return;
    const sel=await UI.pickOption(ctx.p,'손패로 되돌릴 대상',opts); if(!sel) return;
    if(sel.t==='unit'){ removeUnit(sel.u); P.hand.push(sel.u.n); }
    else if(sel.t==='gear'){ const g=P.gear.splice(sel.i,1)[0]; P.hand.push(g.n); await fireEvent('onGearLeave',{p:ctx.p}); }
    else { const hc=G.bfs[sel.bi].hiddenCards.splice(sel.hi,1)[0]; P.hand.push(hc.n); }
    UI.log('손패로 되돌림','p'+ctx.p); },
  async exhThisDraw(op, ctx, h){ if(!ctx.gear||ctx.gear.ex) return;
    const yes=await UI.confirmP(ctx.p,'도구를 탈진하고 카드를 뽑을까요?'); if(!yes) return;
    ctx.gear.ex=true; for(let i=0;i<(op.n||1);i++) drawCard(ctx.p); },
  async mistfall(op, ctx, h){ const it=h.it(); if(!it||!ctx.gear||ctx.gear.ex) return;
    if(!canPay(ctx.p,0,['Body'])) return;
    const yes=await UI.confirmP(ctx.p,'신체 힘 1 + 도구 탈진으로 버프된 유닛을 준비시킬까요?'); if(!yes) return;
    payCost(ctx.p,0,['Body']); ctx.gear.ex=true; await readyUnit(it, ctx.p); },
  async killThisGear(op, ctx, h){ if(!ctx.gear) return;
    const P=G.players[ctx.p]; const i=P.gear.indexOf(ctx.gear);
    if(i>=0) await killGear(ctx.p, i); },
  async armoryProtect(op, ctx, h){
    const mine=everyUnit().filter(u=>u.ctrl===ctx.p); if(!mine.length) return;
    const u=await UI.pickUnitFrom(ctx.p, mine, '사망 방지를 부여할 아군 유닛'); if(!u) return;
    u._armory=true; UI.log(`${unitName(u)}: 이번 턴 사망 시 룬 지불로 회수 가능`,'p'+ctx.p); },
  async portalRescue(op, ctx, h){
    const mine=everyUnit().filter(u=>u.ctrl===ctx.p&&!u.isToken); if(!mine.length) return;
    const u=await UI.pickUnitFrom(ctx.p, mine, '차원문으로 재소환할 아군 유닛'); if(!u) return;
    removeUnit(u);
    const nu=makeUnit(u.n, u.ctrl, {loc:'base'}); placeUnit(nu,'base');
    UI.log(`「차원문 구출」: ${unitName(nu)} 재소환`,'p'+ctx.p);
    await runTriggerList(unitFx(nu).triggers?.onPlay, {p:u.ctrl, unit:nu, legionOK:true}); },
  async adaptatron(op, ctx, h){
    const gears=[]; [0,1].forEach(pi=>G.players[pi].gear.forEach((g,i)=>gears.push({pi,i,label:pname(pi)+': '+card(g.n).ko})));
    if(!gears.length) return;
    const yes=await UI.confirmP(ctx.p,'도구 하나를 폐기하고 버프를 받을까요?'); if(!yes) return;
    const sel=await UI.pickOption(ctx.p,'폐기할 도구',gears.map(g=>({v:g,label:g.label}))); if(!sel) return;
    await killGear(sel.pi, sel.i);
    if(ctx.unit) await buffUnit(ctx.unit, ctx.p); },
  async readySomething(op, ctx, h){
    const opts=[];
    everyUnit().filter(u=>u.ctrl===ctx.p&&u.ex&&u!==ctx.unit).forEach(u=>opts.push({v:{t:'u',u},label:'유닛: '+unitName(u)}));
    G.players[ctx.p].gear.forEach((g,i)=>{ if(g.ex) opts.push({v:{t:'g',g},label:'도구: '+card(g.n).ko}); });
    if(G.players[ctx.p].legendEx) opts.push({v:{t:'l'},label:'전설'});
    if(!opts.length) return;
    const sel=await UI.pickOption(ctx.p,'준비시킬 대상 (선택)',opts); if(!sel) return;
    if(sel.t==='u') await readyUnit(sel.u, ctx.p);
    else if(sel.t==='g') sel.g.ex=false;
    else G.players[ctx.p].legendEx=false;
    UI.log('준비됨','p'+ctx.p); },
  async openPlan(op, ctx, h){
    for(const u of everyUnit().filter(u=>u.ctrl===ctx.p&&u.buff>0&&u.ex)){
      const yes=await UI.confirmP(ctx.p,`「${unitName(u)}」의 버프를 소모해 준비시킬까요?`);
      if(yes){ u.buff--; await readyUnit(u, ctx.p); }
    }
    for(const u of everyUnit().filter(u=>u.ctrl===ctx.p)) await buffUnit(u, ctx.p); },
  async udyr(op, ctx, h){ const me=ctx.unit; if(!me) return;
    const used=(TF().udyrUsed[me.uid]=TF().udyrUsed[me.uid]||[]);
    const all=[
      {v:'dmg',label:'전장 유닛에게 피해 2'},
      {v:'stun',label:'전장 유닛 기절'},
      {v:'ready',label:'나를 준비'},
      {v:'gank',label:'[개입] 부여 (이번 턴)'},
    ].filter(o=>!used.includes(o.v));
    if(!all.length){ UI.toast('이번 턴에 모두 사용했습니다','warn'); return; }
    const sel=await UI.pickOption(ctx.p,'우디르: 하나 선택',all); if(sel===null) return;
    used.push(sel);
    if(sel==='dmg'){ const u=await pickBySpec(ctx.p,{side:'any',where:'bf',count:1},'피해 2 대상'); if(u) dealDamage(u,2,'ability'); }
    else if(sel==='stun'){ const u=await pickBySpec(ctx.p,{side:'enemy',where:'bf',count:1},'기절 대상'); if(u&&!u.stunned){ u.stunned=true; await fireEvent('onYouStun',{p:ctx.p}); } }
    else if(sel==='ready'){ await readyUnit(me, ctx.p); }
    else { me.grants.ganking=true; UI.log(`${unitName(me)} [개입] (이번 턴)`,'p'+ctx.p); } },
  async divineJudgment(op, ctx, h){
    for(const pi of [0,1]){ const P=G.players[pi];
      // 유닛 2개 초과분 재활용
      let units=everyUnit().filter(u=>u.ctrl===pi&&!u.isToken);
      while(units.length>2){
        const u=await UI.pickUnitFrom(pi, units, `${pname(pi)}: 재활용(제거)할 유닛 선택`);
        const vict=u||units[0];
        removeUnit(vict); P.deck.push(vict.n);
        units=everyUnit().filter(x=>x.ctrl===pi&&!x.isToken);
      }
      while(P.gear.length>2){ const g=P.gear.pop(); P.deck.push(g.n); }
      while(P.runes.length>2){ const r=P.runes.pop(); P.runeDeck.push(r.n); }
      while(P.hand.length>2){ const idx=await UI.pickHandCard(pi,'재활용할 카드 선택');
        if(idx===null){ P.deck.push(P.hand.pop()); } else P.deck.push(P.hand.splice(idx,1)[0]); }
      await fireEvent('onYouRecycle',{p:pi});
    }
    UI.log('「신성한 심판」: 각자 유닛/도구/룬/손패 2개만 남김','sys'); },
  async jawsReplay(op, ctx, h){
    if(!canPay(ctx.p,0,['Fury'])) return;
    const yes=await UI.confirmP(ctx.p,'분노 힘 1을 지불하고 「와작와작 죠스」를 플레이할까요?'); if(!yes) return;
    payCost(ctx.p,0,['Fury']);
    const P=G.players[ctx.p]; const idx=P.trash.lastIndexOf(6);
    if(idx>=0) P.trash.splice(idx,1);
    const u=makeUnit(6,ctx.p,{loc:'base'}); placeUnit(u,'base');
    UI.log(`${pname(ctx.p)} 「와작와작 죠스」 버림에서 플레이!`,'p'+ctx.p); },
  async itCtrlDraw(op, ctx, h){ const it=h.it(); if(!it) return;
    for(let i=0;i<(op.n||1);i++) drawCard(it.ctrl); },
};
