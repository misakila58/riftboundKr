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
  // 룬 준비/재충전
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

  // 전투력 증감
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

  // 스턴
  if((m = s.match(/^[Ss]tun (.+)$/))){
    const tgt=m[1];
    if(/each|all/.test(tgt)) return { op:'stunAll', spec:parseTargetSpec(tgt) };
    return { op:'stun', spec:parseTargetSpec(tgt) };
  }

  // 충전
  if((m = s.match(/^[Cc]hannel (\d+|a) runes?( exhausted)?/)))
    return { op:'channel', n:numOf(m[1]), exhausted:!!m[2] };

  // 자원 추가
  if((m = s.match(/^\[?Add\]? :rb_energy_(\d+):/)))
    return { op:'addEnergy', n:+m[1] };
  if(/^\[?Add\]? :rb_rune_rainbow:/.test(s))
    return { op:'addPower', dom:'Any', n:(s.match(/:rb_rune_rainbow:/g)||[]).length };

  // 토큰 생성
  if((m = s.match(/^(?:You may )?[Pp]lay (a|one|two|three|\d+)? ?(\d+) :rb_might: ([\w' ]+?) unit tokens?( here| at a battlefield| to your base| in your base)?/))){
    let where = m[4]?m[4].trim():'base';
    if(where==='to your base'||where==='in your base') where='base';
    return { op:'token', count:numOf(m[1]), might:+m[2], name:m[3].trim(), where };
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

  // 준비/소진
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
];

// 발동형 능력 비용 파싱: "COST: EFFECT"
function parseActivatedCost(costStr){
  const cost = { energy:0, power:0, exhaustSelf:false, recycleTrash:0, discard:0, spendBuff:false, raw:costStr };
  let ok = true;
  costStr.split(',').map(x=>x.trim()).forEach(part=>{
    let m;
    if((m=part.match(/^:rb_energy_(\d+):$/))) cost.energy+=+m[1];
    else if(part===':rb_exhaust:') cost.exhaustSelf=true;
    else if(part===':rb_rune_rainbow:') cost.power+=1;
    else if((m=part.match(/^Recycle (\d+) from your trash$/i))) cost.recycleTrash=+m[1];
    else if((m=part.match(/^Discard (\d+)$/i))) cost.discard=+m[1];
    else if(/^Spend a buff$/i.test(part)) cost.spendBuff=true;
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
    if(ci>0){
      const costCand = findActivatedSplit(body);
      if(costCand){
        const ops = parseOpsSeq(costCand.effect.replace(/^\[(Action|Reaction)\]\s*—?\s*/,''));
        if(ops){
          fx.activated.push({ cost:costCand.cost, ops, legion, label:costCand.effect.slice(0,40) });
          continue;
        }
      }
    }

    // 주문 본문 등 일반 문장
    if(c.type==='Spell' || c.type==='Gear' || c.type==='Battlefield' || c.type==='Legend'){
      const ops = parseOpsSeq(body);
      if(ops){ fx.playOps.push({ops, legion}); continue; }
    } else {
      // 유닛 상시효과 등 → 자동화 불가 절
    }
    fx.manual.push(cl);
  }
  // 전장 카드: 정복/점유 트리거를 전장 전용 이벤트로 재매핑
  if(c.type==='Battlefield' && fx.triggers.onConquerYou){
    fx.triggers.onConquerHere = fx.triggers.onConquerYou;
    delete fx.triggers.onConquerYou;
  }
  return fx;
}

function pushTrig(fx, ev, t){ (fx.triggers[ev]=fx.triggers[ev]||[]).push(t); }

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
  // 카이사 — 공허의 딸: 소진: 파워(✳) 1 추가(주문 전용 — 단순화: 범용 파워로 처리)
  247: fx=>{ fx.manual=[]; fx.activated=[{cost:{exhaustSelf:true},
        ops:[{op:'addPower',dom:'Any',n:1}], label:'✳ 파워 1 추가 (주문 전용)', reaction:true}]; return fx; },
  // 볼리베어 — 강대 유닛 플레이 시: 전설 소진→룬 1 소진 충전 (선택)
  249: fx=>{ fx.manual=[]; fx.hookMightyPlay = { ops:[{op:'channel',n:1,exhausted:true}], mayExhaustLegend:true }; return fx; },
  // 징크스 — 시작 단계: 손패 1장 이하면 드로우 1
  251: fx=>{ fx.manual=[]; fx.triggers.onBeginning=[{ops:[{op:'drawIfHandLE',limit:1,n:1}]}]; return fx; },
  // 다리우스 — 소진(군단): 에너지 1 추가
  253: fx=>{ fx.manual=[]; fx.activated=[{cost:{exhaustSelf:true}, legion:true,
        ops:[{op:'addEnergy',n:1}], label:'에너지 1 추가 (군단)', reaction:true}]; return fx; },
  // 아리 — 적 유닛이 내 전장 공격 시 -1 전투력 (최소 1)
  255: fx=>{ fx.manual=[]; fx.hookEnemyAttackMyBf = { ops:[{op:'might',n:-1,dur:'turn',min:1,it:true}] }; return fx; },
  // 리 신 — 1+소진: 아군 유닛 버프
  257: fx=>{ fx.manual=[]; fx.activated=[{cost:{energy:1,exhaustSelf:true},
        ops:[{op:'buff',count:1,spec:{type:'unit',side:'friendly',where:'any'}}], label:'아군 유닛 버프'}]; return fx; },
  // 야스오 — 2+소진: 아군 유닛을 본진으로/본진에서 이동
  259: fx=>{ fx.manual=[]; fx.activated=[{cost:{energy:2,exhaustSelf:true},
        ops:[{op:'yasuoMove'}], label:'아군 유닛 이동 (본진↔전장)'}]; return fx; },
  // 레오나 — 스턴 시 버프
  261: fx=>{ fx.manual=[]; fx.hookYouStun = { ops:[{op:'buff',count:1,spec:{type:'unit',side:'friendly'}}] }; return fx; },
  // 티모 — 1+소진: 티모 유닛을 손패로 (챔피언 존/보드에서)
  263: fx=>{ fx.manual=[]; fx.activated=[{cost:{energy:1,exhaustSelf:true},
        ops:[{op:'teemoFetch'}], label:'티모 유닛을 손패로'}]; fx.altHideCost=true; return fx; },
  // 빅토르 — 1+소진: 1⚔ 신병 토큰 플레이
  265: fx=>{ fx.manual=[]; fx.activated=[{cost:{energy:1,exhaustSelf:true},
        ops:[{op:'token',count:1,might:1,name:'Recruit',where:'base'}], label:'신병 토큰 1개 플레이'}]; return fx; },
  // 세트 — 소진: 유닛에게 이번 턴 [갱킹] 부여
  267: fx=>{ fx.manual=[]; fx.activated=[{cost:{exhaustSelf:true},
        ops:[{op:'grantKw',who:'a unit',kws:[['Ganking',1]],dur:'turn'}], label:'유닛에게 [갱킹] 부여'}]; return fx; },
  // 미스 포츈 — 버프된 아군 유닛 사망 시 대체 회수 (프롬프트) / 정복 시 준비
  269: fx=>{ fx.manual=[]; fx.hookBuffedDeathSave = true;
        fx.triggers.onConquerYou=[{ops:[{op:'readyLegend'}]}]; return fx; },

  // ── 전장 특수 카드 ──
  // 신성한 무덤: 점유 시 파기 더미의 챔피언을 챔피언 존으로
  281: fx=>{ fx.manual=[]; fx.triggers.onHoldHere=[{ops:[{op:'champBack'}]}]; return fx; },
  // 심판의 투기장: 점유 시 이곳 유닛들의 정복 효과 발동
  286: fx=>{ fx.manual=[]; fx.triggers.onHoldHere=[{ops:[{op:'conquerEffectsHere'}]}]; return fx; },
  // 촛불 성소: 정복 시 덱 위 2장 확인/재충전
  291: fx=>{ fx.manual=[]; fx.triggers.onConquerHere=[{ops:[{op:'scryTop',n:2}]}]; return fx; },
  // 대광장: 점유 시 이곳에 유닛 7개 이상이면 승리
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
// 276: 승리 점수 +1 · 278: 은신 슬롯 2개 · 294: 이곳 유닛 +1⚔
// 295: 이곳→본진 이동 불가 · 296: 주문/능력 피해 +1 · 297: 이곳 유닛 [갱킹]
const BF_STATIC = { VICTORY_PLUS:276, DOUBLE_HIDE:278, MIGHT_PLUS:294, NO_RETREAT:295, BONUS_DMG:296, GANKING:297 };
