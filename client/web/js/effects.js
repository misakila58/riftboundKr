// ══════════ 효과 자동 처리: 텍스트 컴파일러 + 스크립트 ══════════
// 영문 규칙 텍스트를 파싱해 실행 가능한 op 목록으로 컴파일한다.
// 파싱 불가능한 절은 manual 로 분류되어 수동 처리 안내가 표시된다.

// ---------- 절(clause) 분리 ----------
function splitClauses(text){
  if(!text) return [];
  // 리마인더 괄호 제거 (중첩 없음 가정)
  let t = text.replace(/\((?:[^()]*)\)/g, '').trim();
  // 문장 경계: '.' 뒤 또는 키워드 대괄호 시작 앞
  let parts = [];
  let buf = '';
  for(let i=0;i<t.length;i++){
    const ch = t[i];
    buf += ch;
    if(ch==='.'){
      parts.push(buf.trim()); buf='';
    } else if(ch===']' ){
      // 단독 키워드 뒤 바로 다른 절이 붙는 경우: "[Tank]When you..."
      const rest = t.slice(i+1);
      if(/^\s*(?:\[|[A-Z])/.test(rest) && !/^\s*—/.test(rest) && !/^\s*-–/.test(rest)){
        parts.push(buf.trim()); buf='';
      }
    }
  }
  if(buf.trim()) parts.push(buf.trim());
  return parts.filter(s=>s && s!=='.');
}

// ---------- 대상 명세 파싱 ----------
function parseTargetSpec(s){
  const spec = { type:'unit', side:'any', where:'any', count:1, optional:false };
  if(/friendly|you control|your/.test(s)) spec.side='friendly';
  if(/enemy|an opponent controls/.test(s)) spec.side='enemy';
  if(/\bhere\b/.test(s)) spec.where='here';
  if(/at a battlefield/.test(s)) spec.where='bf';
  if(/in (a|your|its owner'?s?) base/.test(s)) spec.where='base';
  if(/champion/.test(s)) spec.champion=true;
  if(/buffed/.test(s)) spec.buffed=true;
  if(/exhausted/.test(s)) spec.exhausted=true;
  const m = s.match(/with (\d+) or less :rb_might:/); if(m) spec.mightMax=+m[1];
  const m2 = s.match(/with (\d+) or more :rb_might:/); if(m2) spec.mightMin=+m2[1];
  if(/damaged/.test(s)) spec.damaged=true;
  if(/stunned/.test(s)) spec.stunned=true;
  if(/\banother\b/.test(s)) spec.other=true;
  if(/each|all/.test(s)) spec.count='all';
  if(/up to two|up to 2/.test(s)) spec.count=2, spec.optional=true;
  if(/you may/.test(s)) spec.optional=true;
  return spec;
}

const NUMWORD = {a:1,an:1,one:1,two:2,three:3,four:4,five:5};
function numOf(s){ if(!s) return 1; s=s.toLowerCase(); return NUMWORD[s]!==undefined?NUMWORD[s]:(+s||1); }

// ---------- 효과 문장 → op ----------
// 반환: op 객체 또는 null(파싱 실패)
function parseOp(s){
  s = s.trim().replace(/\.$/,'');
  let m;

  // 선택적 비용: "You may pay X to Y" / "you may spend a buff to Y"
  if((m = s.match(/^[Yy]ou may pay :rb_energy_(\d+): to (.+)$/))){
    const inner=parseOp(m[2]);
    return inner?{ op:'payThen', energy:+m[1], inner }:null;
  }
  if((m = s.match(/^[Yy]ou may spend a buff to (.+)$/))){
    const inner=parseOp(m[1]);
    return inner?{ op:'spendBuffThen', inner }:null;
  }
  // "That player channels/gains ..." (전장 first-beginning 트리거)
  if((m = s.match(/^[Tt]hat player channels (\d+) runes?( exhausted)?$/)))
    return { op:'channel', n:+m[1], exhausted:!!m[2] };
  if((m = s.match(/^[Tt]hat player gains (\d+) points?$/)))
    return { op:'gainPoints', n:+m[1] };
  // 룬 준비/재활용
  if((m = s.match(/^[Rr]eady up to (\d+) runes?/)))
    return { op:'readyRunes', n:+m[1] };
  if(/^[Yy]ou must recycle one of your runes$/.test(s))
    return { op:'recycleRune' };

  // 드로우
  if((m = s.match(/^(?:You may )?[Dd]raw (\d+|a card)/)))
    return { op:'draw', n: m[1]==='a card'?1:+m[1], self:true };
  if((m = s.match(/^[Ee]ach player draws (\d+)/)))
    return { op:'drawEach', n:+m[1] };

  // 피해
  if((m = s.match(/^[Dd]eal (\d+)(?: damage)? to (.+)$/))){
    const tgt = m[2];
    if(/split among any number of enemy units/.test(tgt))
      return { op:'dealSplit', n:+m[1], spec:{side:'enemy', where:/here/.test(tgt)?'here':'any'} };
    if(/each|all/.test(tgt))
      return { op:'damageAll', n:+m[1], spec:parseTargetSpec(tgt) };
    return { op:'damage', n:+m[1], spec:parseTargetSpec(tgt) };
  }

  // 처치
  if((m = s.match(/^[Kk]ill (.+)$/))){
    const tgt = m[1];
    if(/^me$/.test(tgt)) return { op:'killSelf' };
    if(/each|all/.test(tgt)) return { op:'killAll', spec:parseTargetSpec(tgt) };
    if(/^it$/.test(tgt)) return { op:'killIt' };
    return { op:'kill', spec:parseTargetSpec(tgt) };
  }
  if(/^[Ee]ach player kills one of their units$/.test(s))
    return { op:'eachPlayerKills' };

  // 버프
  if(/^[Bb]uff me$/.test(s)) return { op:'buffSelf' };
  if(/^[Bb]uff it$/.test(s)) return { op:'buffIt' };
  if((m = s.match(/^[Bb]uff (?:a|one|two|up to two)? ?(.*)$/))){
    const two = /two/.test(s);
    return { op:'buff', count: two?2:1, spec:parseTargetSpec(m[1]||'a friendly unit') };
  }

  // 위력 증감
  if((m = s.match(/^[Gg]ive (me|it|a unit|an enemy unit|a friendly unit|each friendly unit(?: here)?|all friendly units(?: here)?) ([+-]\d+) :rb_might:( this turn)?/))){
    const who = m[1];
    const op = { op:'might', n:+m[2], dur:'turn' };
    if(who==='me') op.self=true;
    else if(who==='it') op.it=true;
    else if(/each|all/.test(who)) { op.all=true; op.spec=parseTargetSpec(who); }
    else op.spec = parseTargetSpec(who);
    const min = s.match(/to a minimum of (\d+)/); if(min) op.min=+min[1];
    return op;
  }

  // 키워드 부여
  if((m = s.match(/^[Gg]ive (me|it|a unit|a friendly unit) \[(\w[\w-]*)( \d+)?\]( and \[(\w+)( \d+)?\])?( this turn)?/))){
    const kws=[[m[2], m[3]?+m[3]:1]];
    if(m[5]) kws.push([m[5], m[6]?+m[6]:1]);
    return { op:'grantKw', who:m[1], kws, dur:'turn' };
  }
  if((m = s.match(/^[Cc]hoose a unit( here)?$/)))
    return { op:'chooseUnit', spec:{type:'unit',side:'any',where:m[1]?'here':'any',count:1} };
  if((m = s.match(/^[Ii]t gains \[(\w[\w-]*)( \d+)?\]( this (turn|combat))?$/)))
    return { op:'grantKw', who:'it', kws:[[m[1], m[2]?+m[2]:1]], dur:'turn' };

  // 기절
  if((m = s.match(/^[Ss]tun (.+)$/))){
    const tgt=m[1];
    if(/each|all/.test(tgt)) return { op:'stunAll', spec:parseTargetSpec(tgt) };
    return { op:'stun', spec:parseTargetSpec(tgt) };
  }

  // 전개
  if((m = s.match(/^[Cc]hannel (\d+|a) runes?( exhausted)?/)))
    return { op:'channel', n:numOf(m[1]), exhausted:!!m[2] };

  // 자원 추가
  if((m = s.match(/^\[?Add\]? :rb_energy_(\d+):/)))
    return { op:'addEnergy', n:+m[1] };
  if(/^\[?Add\]? :rb_rune_rainbow:/.test(s))
    return { op:'addPower', dom:'Any', n:(s.match(/:rb_rune_rainbow:/g)||[]).length };
  if((m = s.match(/^\[?Add\]? :rb_rune_(fury|calm|mind|body|order|chaos):$/i)))
    return { op:'addPower', dom:m[1][0].toUpperCase()+m[1].slice(1).toLowerCase(), n:1 };

  // 분할 피해 ('to' 없는 형태)
  if((m = s.match(/^[Dd]eal (\d+) damage split among any number of enemy units( here)?$/)))
    return { op:'dealSplit', n:+m[1], spec:{side:'enemy', where:m[2]?'here':'any'} };
  // 전장 아군 유닛 → 기지
  if(/^[Mm]ove a friendly unit at a battlefield to its base$/.test(s))
    return { op:'moveSpec', spec:{side:'friendly',where:'bf'}, to:'base' };
  // 추가 턴 / 자기 추방
  if(/^[Tt]ake a turn after this one$/.test(s)) return { op:'extraTurn' };
  if(/^[Bb]anish this$/.test(s)) return { op:'banishSelf' };

  // 토큰 생성
  if((m = s.match(/^(?:You may )?[Pp]lay (a|one|two|three|\d+)? ?(ready )?(\d+) :rb_might: ([\w' ]+?) unit tokens?( with \[Temporary\])?( here| at a battlefield| to your base| in your base| at your base| into your base)?/))){
    let where = m[6]?m[6].trim():'base';
    if(/base/.test(where)) where='base';
    return { op:'token', count:numOf(m[1]), might:+m[3], name:m[4].trim(), where, ready:!!m[2], temp:!!m[5] };
  }
  // 범용 "You may X" (선택 실행)
  if((m = s.match(/^[Yy]ou may (.+)$/))){
    const inner=parseOp(m[1]);
    return inner?{ op:'optional', inner }:null;
  }

  // 소환/이동/복귀
  if((m = s.match(/^[Rr]ecall (.+)$/))){
    const tgt = m[1];
    if(/^me$/.test(tgt)) return { op:'recallSelf' };
    if(/^it$/.test(tgt)) return { op:'recallIt' };
    if(/each|all/.test(tgt)) return { op:'recallAll', spec:parseTargetSpec(tgt) };
    return { op:'recall', spec:parseTargetSpec(tgt) };
  }
  if((m = s.match(/^[Mm]ove (a|an enemy|a friendly) unit to (here|a battlefield|its base)/))){
    return { op:'moveUnit', spec:parseTargetSpec(m[1]+' unit'), to:m[2] };
  }
  if((m = s.match(/^[Rr]eturn (me|it|a unit|an enemy unit) to (?:my|its) owner'?s hand/))){
    return { op:'bounce', who:m[1] };
  }

  // 준비/탈진
  if(/^[Rr]eady me$/.test(s)) return { op:'readySelf' };
  if(/^[Rr]eady it$/.test(s)) return { op:'readyIt' };
  if((m = s.match(/^[Rr]eady (a|an|each)? ?(.+)$/))){
    if(/legend/.test(m[2])) return { op:'readyLegend' };
    return { op:'ready', spec:parseTargetSpec(m[2]) };
  }
  if((m = s.match(/^[Ee]xhaust (.+)$/))){
    if(/^me$/.test(m[1])) return { op:'exhaustSelf' };
    return { op:'exhaust', spec:parseTargetSpec(m[1]) };
  }

  // 손패 버리기
  if((m = s.match(/^[Dd]iscard (\d+)/)))
    return { op:'discard', n:+m[1], self:true };
  if((m = s.match(/^[Ee]ach opponent discards (\d+)/)))
    return { op:'discardOpp', n:+m[1] };

  // 득점
  if(/^[Yy]ou score 1 point$/.test(s)) return { op:'scorePoint' };

  // 치유
  if(/^[Hh]eal (me|it)$/.test(s)) return { op:'heal', self:/me/.test(s) };
  if((m = s.match(/^[Hh]eal (a|each) (friendly )?unit/)))
    return { op:'healUnits', all:/each/.test(s) };

  return null; // 파싱 실패 → 수동
}

// ---------- 트리거 접두 판별 ----------
const TRIGGER_PATTERNS = [
  { re:/^When you play me(?: to a battlefield)?,\s*/i, ev:'onPlay' },
  { re:/^When you play me here,\s*/i, ev:'onPlay' },
  { re:/^When I die,\s*/i, ev:'onDeath' },
  { re:/^When I conquer(?: after an attack)?,\s*/i, ev:'onConquer' },
  { re:/^When you conquer(?: here)?,\s*/i, ev:'onConquerYou' },
  { re:/^When I hold,\s*/i, ev:'onHold' },
  { re:/^When you hold here,\s*/i, ev:'onHoldHere' },
  { re:/^When you defend here,\s*/i, ev:'onDefendHere' },
  { re:/^When a unit moves from here,\s*/i, ev:'onMoveFromHere' },
  { re:/^At the start of each player'?s first Beginning Phase,\s*/i, ev:'onFirstBeginning' },
  { re:/^When I attack,\s*/i, ev:'onAttack' },
  { re:/^When I('m| am) killed,\s*/i, ev:'onDeath' },
  { re:/^At (?:the )?start of your Beginning Phase,\s*/i, ev:'onBeginning' },
  { re:/^When you play a spell,\s*/i, ev:'onYouPlaySpell' },
  { re:/^When you play a gear,\s*/i, ev:'onYouPlayGear' },
  { re:/^When I move to a battlefield,\s*/i, ev:'onMoveSelf' },
  { re:/^When I move,\s*/i, ev:'onMoveSelf' },
  { re:/^When I attack or defend,\s*/i, ev:'onAttackOrDefend' },
  { re:/^When I defend,\s*/i, ev:'onDefend' },
  { re:/^At the end of your turn,\s*/i, ev:'onEndTurn' },
  { re:/^When you discard one or more cards,\s*/i, ev:'onYouDiscard' },
  { re:/^When you ready a friendly unit,\s*/i, ev:'onYouReadyUnit' },
];

// 발동형 능력 비용 파싱: "COST: EFFECT"
function parseActivatedCost(costStr){
  const cost = { energy:0, power:0, pips:[], exhaustSelf:false, recycleTrash:0, discard:0, spendBuff:false, raw:costStr };
  let ok = true;
  costStr.split(',').map(x=>x.trim()).filter(Boolean).forEach(part=>{
    let m;
    if(/^(:rb_[a-z_0-9]+:)+$/.test(part)){
      // 아이콘 토큰 연속 (":rb_energy_1::rb_rune_order:" 등)
      for(const t of part.match(/:rb_[a-z_0-9]+:/g)||[]){
        if((m=t.match(/^:rb_energy_(\d+):$/))) cost.energy+=+m[1];
        else if(t===':rb_exhaust:') cost.exhaustSelf=true;
        else if(t===':rb_rune_rainbow:') cost.pips.push('Any');
        else if((m=t.match(/^:rb_rune_(fury|calm|mind|body|order|chaos):$/))) cost.pips.push(m[1][0].toUpperCase()+m[1].slice(1));
        else ok=false;
      }
    }
    else if((m=part.match(/^Recycle (\d+) from your trash$/i))) cost.recycleTrash=+m[1];
    else if((m=part.match(/^Discard (\d+)$/i))) cost.discard=+m[1];
    else if(/^Spend (a|my) buff$/i.test(part)) cost.spendBuff=true;
    else if(/^Kill a friendly unit or gear$/i.test(part)) cost.killFriendlyOrGear=true;
    else if(/^Kill this$/i.test(part)) cost.killSelfGear=true;
    else ok=false;
  });
  return ok?cost:null;
}

// ---------- 카드 1장 컴파일 ----------
function compileCard(c){
  const fx = { kw:{}, legionKw:false, triggers:{}, activated:[], manual:[], playOps:[] };
  const text = c.text||'';
  if(!text.trim()) return fx;

  // 키워드 플래그 (원문 전체에서)
  let m;
  if(/\[Accelerate\]/.test(text)) fx.kw.accelerate=true;
  if(/\[Action\]/.test(text)) fx.kw.action=true;
  if(/\[Reaction\]/.test(text)) fx.kw.reaction=true;
  if(/\[Ganking\]/.test(text)) fx.kw.ganking=true;
  if(/\[Tank\]/.test(text)) fx.kw.tank=true;
  if(/\[Hidden\]/.test(text)) fx.kw.hidden=true;
  if(/\[Temporary\]/.test(text)) fx.kw.temporary=true;
  if(/\[Vision\]/.test(text)) fx.kw.vision=true;
  if((m=text.match(/\[Assault ?(\d*)\]/))) fx.kw.assault=(m[1]?+m[1]:1);
  if((m=text.match(/\[Shield ?(\d*)\]/))) fx.kw.shield=(m[1]?+m[1]:1);
  if((m=text.match(/\[Deflect ?(\d*)\]/))) fx.kw.deflect=(m[1]?+m[1]:1);

  // 모달 주문: "Choose one — A. [or] B."
  const chooseM = text.replace(/\((?:[^()]*)\)/g,'').match(/^Choose one\s*—\s*(.+)$/s);
  if(chooseM && c.type==='Spell'){
    const branches = chooseM[1].split(/\[or\]/i).map(b=>parseOpsSeq(b.trim()));
    if(branches.every(Boolean)){
      fx.playOps.push({ ops:[{ op:'chooseOne', branches }] });
      return fx;
    }
  }

  const clauses = splitClauses(text);
  for(let cl of clauses){
    // 단독 키워드 절은 이미 처리됨
    if(/^\[(Accelerate|Action|Reaction|Ganking|Tank|Hidden|Temporary|Vision|Assault ?\d*|Shield ?\d*|Deflect ?\d*)\]$/.test(cl.trim())) continue;

    let legion = false;
    let body = cl;
    // [Legion] — X / [Deathknell] — X
    let dm;
    if((dm = body.match(/^\[Legion\]\s*—\s*(.+)$/))){ legion=true; body=dm[1]; }
    if((dm = body.match(/^\[Deathknell\]\s*—\s*(.+)$/))){
      const ops = parseOpsSeq(dm[1]);
      if(ops) pushTrig(fx,'onDeath',{ops,legion});
      else fx.manual.push(cl);
      continue;
    }

    // 트리거 접두
    let matchedTrig = null;
    for(const tp of TRIGGER_PATTERNS){
      const mm = body.match(tp.re);
      if(mm){ matchedTrig = tp.ev; body = body.slice(mm[0].length); break; }
    }

    if(matchedTrig){
      const ops = parseOpsSeq(body);
      if(ops) pushTrig(fx, matchedTrig, {ops, legion});
      else fx.manual.push(cl);
      continue;
    }

    // 발동형 능력 "cost: effect"
    const ci = body.indexOf(':');
    // ':'가 아이콘 토큰 내부가 아닌 실제 구분자인지: 비용 파싱 시도
    if(ci>=0){
      const costCand = findActivatedSplit(body);
      if(costCand){
        let eff=costCand.effect, leg2=legion;
        const reaction=/^\[Reaction\]/.test(eff), action=/^\[Action\]/.test(eff);
        eff=eff.replace(/^\[(Action|Reaction)\]\s*—?\s*/,'');
        const lm=eff.match(/^\[Legion\]\s*—\s*/); if(lm){ leg2=true; eff=eff.slice(lm[0].length); }
        const ops = parseOpsSeq(eff);
        if(ops){
          fx.activated.push({ cost:costCand.cost, ops, legion:leg2, reaction, action, label:eff.slice(0,40) });
          continue;
        }
      }
    }

    // 상시효과·플레이 규칙 등 기타 절
    if(parseMiscClause(body, c, fx, legion)) continue;

    // 주문 본문 등 일반 문장
    if(c.type==='Spell' || c.type==='Gear' || c.type==='Battlefield' || c.type==='Legend'){
      const ops = parseOpsSeq(body);
      if(ops){ fx.playOps.push({ops, legion}); continue; }
    } else {
      // 유닛 상시효과 등 → 자동화 불가 절
    }
    fx.manual.push(cl);
  }
  // 전장 카드: 정복/유지 트리거를 전장 전용 이벤트로 재매핑
  if(c.type==='Battlefield' && fx.triggers.onConquerYou){
    fx.triggers.onConquerHere = fx.triggers.onConquerYou;
    delete fx.triggers.onConquerYou;
  }
  return fx;
}

function pushTrig(fx, ev, t){ (fx.triggers[ev]=fx.triggers[ev]||[]).push(t); }

// ---------- 상시효과·플레이 규칙 절 파싱 ----------
// 반환: true = 처리됨 (manual로 보내지 않음)
function parseMiscClause(s, c, fx, legion){
  s = s.trim().replace(/\.$/,'');
  let m;
  if(legion && (m=s.match(/^I cost :rb_energy_(\d+): less$/))){ fx.selfCost={...(fx.selfCost||{}),legion:+m[1]}; return true; }
  const st = ()=> (fx.statics=fx.statics||[]);
  if(/^You may play me to an open battlefield$/.test(s)){ fx.playToOpenBf=true; return true; }
  if(/^You may play me to an occupied enemy battlefield$/.test(s)){ fx.playToEnemyBf=true; return true; }
  if(/^Friendly units may be played to open battlefields$/.test(s)){ fx.openBfAura=true; return true; }
  if(/^This enters exhausted$/.test(s)){ fx.entersExhausted=true; return true; }
  if(/^I enter ready$/.test(s)){ fx.entersReady=true; return true; }
  if(/^If an opponent controls a battlefield, I enter ready$/.test(s)){ fx.entersReady='oppBf'; return true; }
  if(/^I can have any number of buffs$/.test(s)) return true; // 버프 개수 제한 없음(기본 동작)
  if(/^I must be assigned combat damage last$/.test(s)){ fx.combatLast=true; return true; }
  if(/^Your opponents' \[Hidden\] cards can't be revealed here$/.test(s)){ fx.blockReveal=true; return true; }
  if(/^Your \[Deathknell\] effects trigger an additional time$/.test(s)){ fx.deathknellTwice=true; return true; }
  if(/^Use this ability only while I'm at a battlefield$/.test(s)){
    if(fx.activated.length) fx.activated[fx.activated.length-1].onlyAtBf=true; return true; }
  if(/^Other friendly units enter ready$/.test(s)){ st().push({kind:'enterReadyAura'}); return true; }
  if((m=s.match(/^Other friendly units( here)? have \[(\w[\w-]*)( \d+)?\]$/))){
    st().push({kind:'kwAura',kws:[m[2].toLowerCase().replace('-','')],
      filter:{side:'friendly',other:true,...(m[1]?{where:'here',srcAtBf:true}:{})}}); return true; }
  if((m=s.match(/^Other friendly units have \+(\d+) :rb_might: here$/))){
    st().push({kind:'mightAura',n:+m[1],filter:{side:'friendly',other:true,where:'here',srcAtBf:true}}); return true; }
  if((m=s.match(/^While I'm buffed, I have an additional \+(\d+) :rb_might:$/))){
    st().push({kind:'selfMight',fn:u=>u.buff>0?+m[1]:0}); return true; }
  if((m=s.match(/^While I'm buffed, I have \[(\w+)\]$/))){
    const kw=m[1].toLowerCase().replace('-','');
    st().push({kind:'selfKw',kws:[kw],cond:u=>u.buff>0}); return true; }
  if((m=s.match(/^\[Legion\] — I cost :rb_energy_(\d+): less$/))){ fx.selfCost={...(fx.selfCost||{}),legion:+m[1]}; return true; }
  if((m=s.match(/^I cost :rb_energy_(\d+): less for each card in your trash$/))){ fx.selfCost={...(fx.selfCost||{}),perTrash:+m[1]}; return true; }
  if(/^This spell's Energy cost is reduced by the highest Might among units you control$/.test(s)){
    fx.selfCost={...(fx.selfCost||{}),highestMight:true}; return true; }
  return false;
}

// "cost: effect" 분리 — 아이콘 ':' 와 혼동 방지 위해 후보 위치 전부 시도
function findActivatedSplit(s){
  for(let i=0;i<s.length;i++){
    if(s[i]!==':') continue;
    // 아이콘 토큰 내부(:rb_...:)는 건너뜀
    const pre=s.slice(0,i), post=s.slice(i+1);
    const opens=(pre.match(/:rb_[a-z_0-9]*$/)); if(opens) continue;
    if(/^rb_/.test(post)) continue;
    const cost = parseActivatedCost(pre.trim());
    if(cost && post.trim()) return { cost, effect:post.trim() };
  }
  return null;
}

// 연속 문장 파싱: "A. B. C" → ops 배열 (전부 파싱돼야 성공)
function parseOpsSeq(s){
  s = s.trim();
  if(!s) return null;
  // "You may pay X to Y" → 선택 비용 처리 (단순 케이스만)
  const sentences = s.split(/(?<=\.)\s*|(?<=\.)(?=[A-Z\[])/).map(x=>x.trim()).filter(Boolean);
  const flat = sentences.length?sentences:[s];
  const ops = [];
  for(let sent of flat){
    sent = sent.replace(/\.$/,'').trim();
    if(!sent) continue;
    // "then" 연결 분해
    const subs = sent.split(/,\s*then\s+|\s+then\s+/i);
    for(let sub of subs){
      sub = sub.trim().replace(/^and\s+/,'');
      if(!sub) continue;
      const op = parseOp(sub);
      if(!op) return null;
      ops.push(op);
    }
  }
  return ops.length?ops:null;
}

// ---------- 전체 컴파일 ----------
const FX = {};
function compileAllCards(){
  CARDS.forEach(c=>{ FX[c.n] = compileCard(c); });
  // 수동 스크립트 오버라이드 적용
  Object.entries(SCRIPTS).forEach(([n,scr])=>{
    const fx = FX[n]; if(!fx) return;
    Object.assign(fx, scr(fx)||fx);
  });
}

// ---------- 전설(레전드) 수동 스크립트 ----------
// 각 함수는 컴파일된 fx를 받아 수정/반환한다.
const SCRIPTS = {
  // 카이사 — 공허의 딸: 탈진: 힘(✳) 1 추가(주문 전용 — 단순화: 범용 힘로 처리)
  247: fx=>{ fx.manual=[]; fx.activated=[{cost:{exhaustSelf:true},
        ops:[{op:'addPower',dom:'Any',n:1}], label:'✳ 힘 1 추가 (주문 전용)', reaction:true}]; return fx; },
  // 볼리베어 — 위력적 유닛 플레이 시: 전설 탈진→룬 1 탈진 전개 (선택)
  249: fx=>{ fx.manual=[]; fx.hookMightyPlay = { ops:[{op:'channel',n:1,exhausted:true}], mayExhaustLegend:true }; return fx; },
  // 징크스 — 개시 단계: 손패 1장 이하면 드로우 1
  251: fx=>{ fx.manual=[]; fx.triggers.onBeginning=[{ops:[{op:'drawIfHandLE',limit:1,n:1}]}]; return fx; },
  // 다리우스 — 탈진(군단): 에너지 1 추가
  253: fx=>{ fx.manual=[]; fx.activated=[{cost:{exhaustSelf:true}, legion:true,
        ops:[{op:'addEnergy',n:1}], label:'에너지 1 추가 (군단)', reaction:true}]; return fx; },
  // 아리 — 적 유닛이 내 전장 공격 시 -1 위력 (최소 1)
  255: fx=>{ fx.manual=[]; fx.hookEnemyAttackMyBf = { ops:[{op:'might',n:-1,dur:'turn',min:1,it:true}] }; return fx; },
  // 리 신 — 1+탈진: 아군 유닛 버프
  257: fx=>{ fx.manual=[]; fx.activated=[{cost:{energy:1,exhaustSelf:true},
        ops:[{op:'buff',count:1,spec:{type:'unit',side:'friendly',where:'any'}}], label:'아군 유닛 버프'}]; return fx; },
  // 야스오 — 2+탈진: 아군 유닛을 기지으로/기지에서 이동
  259: fx=>{ fx.manual=[]; fx.activated=[{cost:{energy:2,exhaustSelf:true},
        ops:[{op:'yasuoMove'}], label:'아군 유닛 이동 (기지↔전장)'}]; return fx; },
  // 레오나 — 기절 시 버프
  261: fx=>{ fx.manual=[]; fx.hookYouStun = { ops:[{op:'buff',count:1,spec:{type:'unit',side:'friendly'}}] }; return fx; },
  // 티모 — 1+탈진: 티모 유닛을 손패로 (챔피언 존/보드에서)
  263: fx=>{ fx.manual=[]; fx.activated=[{cost:{energy:1,exhaustSelf:true},
        ops:[{op:'teemoFetch'}], label:'티모 유닛을 손패로'}]; fx.altHideCost=true; return fx; },
  // 빅토르 — 1+탈진: 1⚔ 신병 토큰 플레이
  265: fx=>{ fx.manual=[]; fx.activated=[{cost:{energy:1,exhaustSelf:true},
        ops:[{op:'token',count:1,might:1,name:'Recruit',where:'base'}], label:'신병 토큰 1개 플레이'}]; return fx; },
  // 세트 — 탈진: 유닛에게 이번 턴 [개입] 부여
  267: fx=>{ fx.manual=[]; fx.activated=[{cost:{exhaustSelf:true},
        ops:[{op:'grantKw',who:'a unit',kws:[['Ganking',1]],dur:'turn'}], label:'유닛에게 [개입] 부여'}]; return fx; },
  // 미스 포츈 — 버프된 아군 유닛 사망 시 대체 회수 (프롬프트) / 정복 시 준비
  269: fx=>{ fx.manual=[]; fx.hookBuffedDeathSave = true;
        fx.triggers.onConquerYou=[{ops:[{op:'readyLegend'}]}]; return fx; },

  // ── 전장 특수 카드 ──
  // 신성한 무덤: 유지 시 폐기장의 챔피언을 챔피언 존으로
  281: fx=>{ fx.manual=[]; fx.triggers.onHoldHere=[{ops:[{op:'champBack'}]}]; return fx; },
  // 심판의 투기장: 유지 시 이곳 유닛들의 정복 효과 발동
  286: fx=>{ fx.manual=[]; fx.triggers.onHoldHere=[{ops:[{op:'conquerEffectsHere'}]}]; return fx; },
  // 촛불 성소: 정복 시 덱 위 2장 확인/재활용
  291: fx=>{ fx.manual=[]; fx.triggers.onConquerHere=[{ops:[{op:'scryTop',n:2}]}]; return fx; },
  // 대광장: 유지 시 이곳에 유닛 7개 이상이면 승리
  293: fx=>{ fx.manual=[]; fx.triggers.onHoldHere=[{ops:[{op:'winIf7Here'}]}]; return fx; },
  // 폭풍의 인장: 정복 시 룬 2개까지 준비 (근사: 즉시)
  289: fx=>{ fx.manual=[]; fx.triggers.onConquerHere=[{ops:[{op:'readyRunes',n:2}]}]; return fx; },
  // 상시효과 전장 — 엔진에서 카드 번호로 직접 처리됨 (수동 알림 제거)
  276: fx=>{ fx.manual=[]; return fx; },
  278: fx=>{ fx.manual=[]; return fx; },
  294: fx=>{ fx.manual=[]; return fx; },
  295: fx=>{ fx.manual=[]; return fx; },
  296: fx=>{ fx.manual=[]; return fx; },
  297: fx=>{ fx.manual=[]; return fx; },
};

// 전장 상시 효과 (엔진에서 카드 번호로 직접 참조)
// 276: 승리 점수 +1 · 278: 숨겨짐 슬롯 2개 · 294: 이곳 유닛 +1⚔
// 295: 이곳→기지 이동 불가 · 296: 주문/능력 피해 +1 · 297: 이곳 유닛 [개입]
const BF_STATIC = { VICTORY_PLUS:276, DOUBLE_HIDE:278, MIGHT_PLUS:294, NO_RETREAT:295, BONUS_DMG:296, GANKING:297 };
