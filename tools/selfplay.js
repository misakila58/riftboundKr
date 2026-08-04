// ══════════ 봇 셀프플레이 러너 (헤드리스) ══════════
// 브라우저·DOM 없이 게임 엔진만 로드해 봇끼리 N판 두게 하고 승률을 낸다.
// 봇을 고칠 때마다 "정말 강해졌는가"를 숫자로 확인하는 것이 목적 — 감으로 튜닝하지 않기 위해.
//
//   node tools/selfplay.js -n 600                  현재 정책끼리 (편향 점검용, 50%가 나와야 정상)
//   node tools/selfplay.js -n 600 --baseline       현재 정책 vs 동결된 옛 봇  ← 개선폭 측정
//   node tools/selfplay.js -n 600 -a hard -b easy  난이도 대결
//   node tools/selfplay.js --seed 1234             시드 고정
//
// 판정은 좌석 편향을 없애기 위해 매 판 선공을 번갈아 준다.
// 주의: client/web/js의 실제 엔진·정책 파일을 그대로 읽는다 — 사본을 만들지 않는다.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'client', 'web', 'js');
const read = f => fs.readFileSync(path.join(JS, f), 'utf8');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes(k);
const N = +arg('-n', arg('--games', 200));
const LEVEL_A = arg('-a', 'hard');
const LEVEL_B = arg('-b', 'hard');
const BASELINE_B = has('--baseline');
const SEED0 = +arg('--seed', 20260804);
const MAX_TURNS = +arg('--max-turns', 160);
const DIAG = has('--diag');
// --w key=val,key=val : A쪽 평가 가중치 덮어쓰기 (튜닝 스윕용)
const WRAW = arg('--w', null);
const WOVER = {};
if(WRAW) WRAW.split(',').forEach(kv=>{ const [k,v]=kv.split('='); if(k) WOVER[k]=+v; });
const KEYS = ['unit','option','confirm','number','hand','reaction','mulligan','reserve','canpay','move','showdown',
              'ability','hide','sdfund','place','champ','defend'];
// --only a,b : A는 그 기능만 켜고 나머지는 옛 동작 / --off a,b : A에서 그 기능만 끔
//   (둘 다 B는 '정책층 이전' 상태 — 옛 봇 대비 절대 기여도를 본다)
// --offb a,b : A는 현재 봇 그대로, B에서만 그 기능을 끈다
//   (지금 봇에서 그 기능을 빼면 얼마나 약해지는가 = 한계 기여도. 새 기능 검증은 이쪽을 쓴다)
// --on a,b   : A에서만 그 기능을 켠다 (기본이 꺼져 있는 기능의 재측정용)
const ONLY = arg('--only', null);
const OFF  = arg('--off', null);
const OFFB = arg('--offb', null);
const ON   = arg('--on', null);
let AB_A = null, AB_B_EXPLICIT = null;
if(ONLY){ AB_A = {}; KEYS.forEach(k=>AB_A[k]=0); ONLY.split(',').forEach(k=>{ if(KEYS.includes(k)) AB_A[k]=1; }); }
else if(OFF){ AB_A = {}; KEYS.forEach(k=>AB_A[k]=1); OFF.split(',').forEach(k=>{ if(KEYS.includes(k)) AB_A[k]=0; }); }
else if(ON){ AB_A = {}; ON.split(',').forEach(k=>{ if(KEYS.includes(k)) AB_A[k]=1; }); }
if(OFFB){ AB_B_EXPLICIT = {}; OFFB.split(',').forEach(k=>{ if(KEYS.includes(k)) AB_B_EXPLICIT[k]=0; }); }
const AB_B_OFF = {}; KEYS.forEach(k=>AB_B_OFF[k]=0);

// ---------- 엔진 구동 최소 환경 ----------
const BOOT = `
var UI = {
  log(){}, render(){}, toast(){}, prompt(){}, promptShowdown(){}, manualNotice(){},
  showVictory(){}, inspect(){}, inspectUnit(){}, hideZoom(){}, showZoom(){},
  isPicking(){ return false; }, logEntryEl(){ return null; },
  fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:     (p,t,c)    => Promise.resolve(SEATP(p).confirm(p,t,c)),
  pickUnitFrom: (p,c,t,o)  => Promise.resolve(SEATP(p).unit(p,c,t,o)),
  pickOption:   (p,t,o)    => Promise.resolve(SEATP(p).option(p,t,o)),
  pickReaction: (p,t,o)    => Promise.resolve(SEATP(p).reaction(p,t,o)),
  pickNumber:   (p,t,mn,mx)=> Promise.resolve(SEATP(p).number(p,t,mn,mx)),
  pickHandCard: (p,t)      => Promise.resolve(SEATP(p).hand(p,t)),
  pickMulligan: (p)        => Promise.resolve(SEATP(p).mulligan(p)),
};
var NET = { online:false, seat:null, dispatch(a,fn){ if(fn) fn(); } };
var REPLAY = { viewing:false, recording:false, capture(){}, _onNewGame(){}, _onVictory(){} };
var BUILDINFO = { version:'selfplay', built:'' };
// 러너 전용 난수 — 엔진의 시드 rng와 분리해 엔진 결정론을 건드리지 않는다
var RS = 1;
function rrand(){ RS = (RS * 1103515245 + 12345) & 0x7fffffff; return RS / 0x7fffffff; }
var SEAT = [null, null];
function SEATP(p){ const s = SEAT[p]; s.setLevel(); return s; }
`;

// ---------- 덱·대국 진행 ----------
const HARNESS = `
compileAllCards();

function legendList(){ return CARDS.filter(c=>c.type==='Legend'); }
function shuffleR(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(rrand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

// main.js의 buildDeck과 동등 (그쪽은 DOM 화면 흐름과 같은 파일에 있어 여기서 재현)
function mkDeck(legendN){
  const legend=card(legendN), doms=legend.dom;
  const champTag=legend.name.split(' - ')[0];
  const champUnits=CARDS.filter(c=>c.type==='Unit'&&c.super==='Champion'&&c.tags.includes(champTag))
    .sort((a,b)=>(a.e||0)-(b.e||0));
  const champN=champUnits.length?champUnits[0].n:null;
  const pool=CARDS.filter(c=>['Unit','Spell','Gear'].includes(c.type)&&c.super!=='Token'&&c.n!==champN
    &&(c.dom.length===0||c.dom.every(d=>doms.includes(d)||d==='Colorless')));
  const preferred=pool.filter(c=>c.tags.includes(champTag));
  const rest=shuffleR([...pool.filter(c=>!c.tags.includes(champTag))]);
  const deck=[], counts={};
  const add=(c,max)=>{ counts[c.n]=counts[c.n]||0; if(counts[c.n]>=max) return false; counts[c.n]++; deck.push(c.n); return true; };
  if(champN) add(card(champN),1);
  preferred.forEach(c=>{ for(let i=0;i<3&&deck.length<12;i++) add(c,3); });
  for(const c of rest){ if(deck.length>=40) break; add(c,2); if(deck.length<40) add(c,2); }
  let gi=0; while(deck.length<40&&gi<rest.length){ add(rest[gi],3); gi++; }
  deck.length=40;
  const runeCards=CARDS.filter(c=>c.type==='Rune');
  const runes=[]; const domRunes=doms.map(d=>runeCards.find(r=>r.dom.includes(d))).filter(Boolean);
  for(let i=0;i<12;i++) runes.push(domRunes[i%domRunes.length].n);
  const bfs=shuffleR(CARDS.filter(c=>c.type==='Battlefield').map(c=>c.n)).slice(0,3);
  return { legendN, champN, deck, runes, bfs };
}

function bootGame(seed, dA, dB){
  seedRng(seed);
  const bfs=[ dA.bfs[Math.floor(rrand()*dA.bfs.length)], dB.bfs[Math.floor(rrand()*dB.bfs.length)] ];
  newGame({ seed, manual:false, bfs,
    players:[ {name:'A', legendN:dA.legendN, champN:dA.champN, deck:[...dA.deck], runes:[...dA.runes]},
              {name:'B', legendN:dB.legendN, champN:dB.champN, deck:[...dB.deck], runes:[...dB.runes]} ] });
}

async function driveTurn(stats){
  const p=G.turn;
  for(let guard=0; guard<200; guard++){
    if(G.winner!==null) return;
    if(G.state==='showdown'){
      const ap=G.actingPlayer;
      const acted = await SEATP(ap).showdown(ap);
      if(!acted) await showdownPass();
      continue;
    }
    if(G.turn!==p || G.phase!=='action') return;
    if(await SEATP(p).turnAction(p, stats)) break;
  }
  if(G.winner===null && G.turn===p) await endTurn();
}

async function playGame(seed, dA, dB, stats){
  bootGame(seed, dA, dB);
  await mulliganPhase();
  await startTurn();
  let t=0;
  while(G.winner===null && t<${MAX_TURNS}){ await driveTurn(stats); t++; }
  stats.turns += t;
  if(G.winner===null) stats.draws++;
  return G.winner;
}
`;

// ---------- 정책 어댑터 ----------
// 신 정책은 실제 bot-policy.js를 그대로 쓴다. 기준선은 '정책층 이전 bot.js 판단'을 동결한 사본이다.
const ADAPTER = `
const BOT_W_BASE = Object.assign({}, BOT_W);
// POLICY.ab는 전역 하나뿐이라 좌석마다 매번 통째로 다시 심어야 한다.
// (한쪽만 덮어쓰면 다음 좌석이 그 값을 물려받아 대조군이 오염된다 — 조용히 틀리는 종류의 버그)
const AB_BASE = Object.assign({}, POLICY.ab);
const _wo = ${JSON.stringify(WOVER)};
const WOVER_A = Object.keys(_wo).length ? _wo : null;
const LEVELS = {
  novice:{think:0,budget:0,peek:false}, skilled:{think:0,budget:0,peek:false},
  expert:{think:0,budget:0,peek:false}, master:{think:1,budget:0,peek:false},
  oracle:{think:1,budget:0,peek:true},
  easy:{think:0,budget:0,peek:false}, normal:{think:0,budget:0,peek:false}, hard:{think:0,budget:0,peek:false},
};
function mkPolicy(level, ab, wover){
  return {
    setLevel(){ POLICY.level = level;
      const d = LEVELS[level] || {think:0,budget:0,peek:false};
      POLICY.think = d.think; POLICY.budget = d.budget; POLICY.peek = d.peek;
      Object.assign(POLICY.ab, AB_BASE, ab || {});
      if(wover) Object.assign(BOT_W, wover); else Object.assign(BOT_W, BOT_W_BASE); },
    unit:(p,c,t,o)=>POLICY.unit(p,c,t,o),
    option:(p,t,o)=>POLICY.option(p,t,o),
    confirm:(p,t,c)=>POLICY.confirm(p,t,c),
    number:(p,t,mn,mx)=>POLICY.number(p,t,mn,mx),
    hand:(p,t)=>POLICY.hand(p,t),
    reaction:(p,t,o)=>POLICY.reaction(p,t,o),
    mulligan:(p)=>POLICY.mulligan(p),
    // 진행 순서·실행은 POLICY.step 하나로 통일한다 — 여기에 사본을 두면 브라우저 봇과 어긋난다
    _ctx: POLICY.newCtx(),
    async showdown(p){
      const act = POLICY.showdownAction(p);
      if(!act) return false;
      return (await POLICY.runAction(p, act)) !== false;
    },
    async turnAction(p, stats){
      POLICY.syncCtx(this._ctx);
      return await POLICY.step(p, this._ctx, n => { if(stats) stats.plays[n]=(stats.plays[n]||0)+1; });
    },
  };
}

// ── 기준선(동결): 정책층 도입 이전의 bot.js 판단 ──
function mkBaseline(level){
  const smart = level!=='easy', hard = level==='hard';
  const costOf = c => (c.e||0) + powerPips(c).length;
  const str = a => [...a].sort((x,y)=>might(y)-might(x))[0];
  const wk  = a => [...a].sort((x,y)=>might(x)-might(y))[0];
  return {
    setLevel(){},
    unit(p,c,t,optional){
      if(!c.length) return null;
      if(!smart) return (optional && rrand()<0.2) ? null : c[Math.floor(rrand()*c.length)];
      const txt=String(t||'');
      const foes=c.filter(u=>u.ctrl!==p), mine=c.filter(u=>u.ctrl===p);
      const sac=!foes.length && /처치|탈진|희생|제물|파괴|버릴/.test(txt);
      if(sac && optional) return null;
      if(sac) return wk(mine);
      if(foes.length) return str(foes);
      return str(mine);
    },
    option:(p,t,o)=>o.length?o[Math.floor(rrand()*o.length)].v:null,
    confirm:()=>true,
    number:(p,t,mn,mx)=>mx,
    hand(p){ const h=G.players[p].hand; if(!h.length) return null;
      if(!smart) return Math.floor(rrand()*h.length);
      let b=0; h.forEach((n,i)=>{ if((card(n).e||0)>(card(h[b]).e||0)) b=i; }); return b; },
    reaction(p,t,o){ const cn=smart&&o.find(x=>x.isCounter); return cn?cn.v:null; },
    mulligan(p){ const h=G.players[p].hand;
      if(!smart) return h.map((n,i)=>i).filter(i=>(card(h[i]).e||0)>=5).slice(0,2);
      const cost=i=>(card(h[i]).e||0); const idxs=h.map((n,i)=>i);
      const cheap=idxs.filter(i=>cost(i)<=2&&['Unit','Gear'].includes(card(h[i]).type));
      const bw=[...idxs].sort((a,b)=>cost(b)-cost(a));
      return cheap.length?bw.filter(i=>cost(i)>=5).slice(0,2):bw.slice(0,2); },
    _tried:new Set(), _lastTC:-1, _movesTC:-1, _movesLeft:0, _sdSeen:null,
    async showdown(p){
      const sd=G.showdown; if(!sd||!hard) return false;
      if(this._sdSeen===sd) return false;
      this._sdSeen=sd;
      const us=unitsAt(sd.bfIdx);
      const role=u=>u.ctrl===sd.attacker?'attacker':'defender';
      const myM=us.filter(u=>u.ctrl===p).reduce((s,u)=>s+might(u,role(u)),0);
      const opM=us.filter(u=>u.ctrl!==p).reduce((s,u)=>s+might(u,role(u)),0);
      if(opM<=0||!us.some(u=>u.ctrl===p)) return false;
      if(myM>opM+2) return false;
      const P=G.players[p], ready=readyRunes(p).length;
      const i=P.hand.findIndex(n=>{const fx=FX[n]||{kw:{}};
        return (fx.kw.action||fx.kw.reaction)&&costOf(card(n))<=ready;});
      if(i<0) return false;
      return (await playCardFromHand(p,i))!==false;
    },
    async turnAction(p, stats){
      const P=G.players[p], ready=readyRunes(p).length;
      if(this._lastTC!==G.turnCount){ this._lastTC=G.turnCount; this._tried.clear(); }
      let idx=-1;
      if(!smart){
        idx=P.hand.findIndex(n=>{ if(this._tried.has('h'+n)) return false;
          if(rrand()<0.4) return false; return costOf(card(n))<=ready; });
      } else {
        const cs=[];
        P.hand.forEach((n,i)=>{ if(this._tried.has('h'+n)) return;
          const c=card(n); if(costOf(c)>ready) return;
          const fx=FX[n]||{kw:{}}; let s;
          if(c.type==='Unit') s=100+(c.m||0)*2-costOf(c);
          else if(c.type==='Gear') s=50-costOf(c);
          else if(hard&&(fx.kw.action||fx.kw.reaction)) s=-1;
          else s=30-costOf(c);
          cs.push({i,s}); });
        cs.sort((a,b)=>b.s-a.s);
        if(cs.length){ const t=cs[0]; if(t.s>=0||P.hand.length>4) idx=t.i; }
      }
      if(idx>=0){ const n=P.hand[idx], before=P.hand.length;
        if(stats) stats.plays[n]=(stats.plays[n]||0)+1;
        const ok=await playCardFromHand(p,idx);
        if(ok===false&&P.hand.length===before) this._tried.add('h'+n);
        return false; }
      if(P.champInZone&&!this._tried.has('champ')&&costOf(card(P.champN))<=ready){
        const ok=await playCardFromHand(p,-1,{champZone:true});
        if(ok===false&&P.champInZone) this._tried.add('champ');
        return false; }
      if(this._movesTC!==G.turnCount){ this._movesTC=G.turnCount; this._movesLeft=hard?2:1; }
      if(this._movesLeft>0){ const mv=this.movePlan(p);
        if(mv){ this._movesLeft--; await moveUnits(p,mv.units,mv.dest); return false; }
        this._movesLeft=0; }
      return true;
    },
    movePlan(p){
      const o=opp(p);
      const movable=G.players[p].base.filter(u=>!u.ex&&!u.stunned);
      if(!movable.length) return null;
      if(!smart){ if(rrand()<0.4) return null;
        const us=movable.filter(()=>rrand()<0.6); if(!us.length) return null;
        return {units:us,dest:Math.floor(rrand()*2)}; }
      const empty=G.bfs.map((bf,i)=>({bf,i})).filter(x=>x.bf.units.length===0&&x.bf.controller!==p);
      const wf=[...movable].sort((a,b)=>might(a)-might(b));
      let margin=hard?0:1;
      if(hard&&G.players[o].points>=G.victory-2) margin=-2;
      if(empty.length) return {units:wf.slice(0,hard?1:2),dest:empty[0].i};
      for(let i=0;i<G.bfs.length;i++){
        const bf=G.bfs[i]; const def=bf.units.filter(u=>u.ctrl===o);
        if(!def.length) continue;
        const dm=def.reduce((s,u)=>s+might(u,'defender'),0);
        const atk=[...movable].sort((a,b)=>might(b)-might(a));
        let sum=0; const send=[];
        for(const u of atk){ send.push(u); sum+=might(u,'attacker'); if(sum>dm+margin) break; }
        if(sum>dm+margin) return {units:send,dest:i};
      }
      return null;
    },
  };
}
`;

const RUN = `
const AB_A = ${JSON.stringify(AB_A)};
const AB_B = ${BASELINE_B ? 'null' : JSON.stringify(AB_B_EXPLICIT || ((AB_A && !ON) ? AB_B_OFF : null))};
// 행동 종류별 발생 횟수 — "그 기능이 애초에 발동은 하는가"를 먼저 확인하기 위한 계수기.
// 승률이 안 움직일 때 원인이 '효과 없음'인지 '한 번도 안 걸림'인지 구분해 준다.
const TALLY = {};
const _runAct = POLICY.runAction;
POLICY.runAction = function(p, act){
  const k = act.kind + (G.state==='showdown' ? '(결전)' : '');
  TALLY[k] = (TALLY[k]||0)+1;
  return _runAct.call(POLICY, p, act);
};
// 왜 그 후보가 안 나왔는가를 보려면 '고른 것'이 아니라 '만들어진 것'을 세야 한다
if(${has('--dbg')}){
  const _thr = polThreatAt;
  polThreatAt = function(p,i,extra){
    const v = _thr(p,i,extra);
    if(!extra){ TALLY['위협측정']=(TALLY['위협측정']||0)+1;
      if(v>0.05) TALLY['위협>0.05']=(TALLY['위협>0.05']||0)+1;
      if(v===-Infinity) TALLY['위협=상대병력없음']=(TALLY['위협=상대병력없음']||0)+1; }
    return v;
  };
}
// 이동은 종류별로 따로 센다 — '공격'과 '수비 보강'은 전혀 다른 판단이다
const _movePlan = POLICY.movePlan;
POLICY.movePlan = function(p){
  const mv = _movePlan.call(POLICY, p);
  if(mv && mv.why){ const k='move:'+String(mv.why).replace(/\\d+/g,'N'); TALLY[k]=(TALLY[k]||0)+1; }
  return mv;
};
(async()=>{
  const legends=legendList();
  const deckPool=[];
  for(let i=0;i<legends.length;i++){ RS=1000+i; deckPool.push(mkDeck(legends[i].n)); }
  const stats={ turns:0, draws:0, plays:{} };
  let winA=0, winB=0, crashes=0;
  const errs=new Map();
  const t0=Date.now();

  for(let g=0; g<${N}; g++){
    // 미러 매치: 같은 덱 짝을 두 번 두되 두 번째는 좌우를 바꾼다.
    // (덱과 선공 이점을 양쪽이 똑같이 나눠 갖게 해야 봇 실력만 남는다)
    const pair = Math.floor(g/2);
    const swap = (g % 2) === 1;
    const pa = mkPolicy(${JSON.stringify(LEVEL_A)}, AB_A, WOVER_A);
    const pb = ${BASELINE_B} ? mkBaseline(${JSON.stringify(LEVEL_B)}) : mkPolicy(${JSON.stringify(LEVEL_B)}, AB_B);
    SEAT[0] = swap ? pb : pa;
    SEAT[1] = swap ? pa : pb;
    RS = ${SEED0} + pair*7919;
    const dA = deckPool[(pair*3) % deckPool.length];
    const dB = deckPool[(pair*5+1) % deckPool.length];
    try{
      const w = await playGame(${SEED0}+pair, dA, dB, stats);
      if(w!==null){ const aSeat = swap?1:0; if(w===aSeat) winA++; else winB++; }
    }catch(e){
      crashes++;
      const k=(e&&e.message||String(e)).slice(0,120);
      errs.set(k,(errs.get(k)||0)+1);
    }
  }
  const dt=Date.now()-t0, played=winA+winB;
  const rate = played? winA/played : 0;
  const z = played? (winA - played/2) / Math.sqrt(played*0.25) : 0;
  const pval = played? 2*(1-normCdf(Math.abs(z))) : 1;
  console.log(JSON.stringify({
    A:${JSON.stringify(LEVEL_A)}+(AB_A?' ['+Object.keys(AB_A).filter(k=>AB_A[k]).join(',')+']':''),
    B:${JSON.stringify(LEVEL_B)}+(${BASELINE_B}?' (baseline)':(${JSON.stringify(!!OFFB)}?' [-'+${JSON.stringify(OFFB||'')}+']':(AB_B?' [none]':''))),
    games:${N}, played, draws:stats.draws, crashes,
    winA, winB, 'A승률%':+(rate*100).toFixed(1), z:+z.toFixed(2), p:+pval.toFixed(5),
    평균턴:+(stats.turns/Math.max(1,${N})).toFixed(1),
    ms:dt, 판_초:+(${N}/(dt/1000)).toFixed(0),
    한번도_안낸카드: CARDS.filter(c=>['Unit','Spell','Gear'].includes(c.type)&&!stats.plays[c.n]).length,
    행동_판당: Object.fromEntries(Object.entries(TALLY).map(([k,v])=>[k, +(v/${N}).toFixed(2)])),
  },null,1));
  for(const [k,v] of errs) console.log('  ERR x'+v+': '+k);
})().catch(e=>{ console.error('HARNESS FAIL', e); process.exit(1); });

function normCdf(x){
  const t=1/(1+0.2316419*x), d=0.3989423*Math.exp(-x*x/2);
  return 1-d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
}
`;


const DIAGRUN = `
(async()=>{
  const legends=legendList(); const pool=[];
  for(let i=0;i<legends.length;i++){ RS=1000+i; pool.push(mkDeck(legends[i].n)); }
  SEAT[0]=mkPolicy('expert'); SEAT[1]=mkPolicy('skilled');
  for(const turnNo of [1,3,5]){
    RS=777; bootGame(777, pool[0], pool[1]);
    await mulliganPhase(); await startTurn();
    for(let k=0;k<turnNo-1;k++){ await driveTurn({turns:0,draws:0,plays:{}}); }
    if(G.turn!==0 || G.winner!==null) continue;
    SEATP(0);
    const cands = polActionCandidates(0, new Set());
    const rows=[];
    for(const c of cands){ const v = await simTry(0, c.run, POLICY); rows.push({l:c.label, v}); }
    rows.sort((a,b)=>(b.v===null?-99:b.v)-(a.v===null?-99:a.v));
    console.log('--- 턴 '+turnNo+' 후보 평가 (준비룬 '+readyRunes(0).length+', 손패 '+G.players[0].hand.length+') ---');
    rows.slice(0,8).forEach(r=>console.log('   '+(r.v===null?'null':r.v.toFixed(3)).padStart(8)+'  '+r.l));
  }
  console.log('SIM', JSON.stringify(SIM.stats));
})().catch(e=>console.error('DIAG', e));
`;

const src = [BOOT, read('cards.js'), read('loc.js'), read('effects.js'), read('cardscripts.js'),
             read('engine.js'), read('bot-eval.js'), read('bot-sim.js'), read('bot-policy.js'), HARNESS, ADAPTER, (DIAG?DIAGRUN:RUN)].join('\n;\n');

const ctx = vm.createContext({
  console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map,
  String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process,
});
try { vm.runInContext(src, ctx, { filename: 'selfplay-bundle.js' }); }
catch (e) { console.error('번들 실행 실패:', e.message); process.exit(1); }
