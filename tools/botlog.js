// 봇전 전체 로그 기록기 — 룰북 대조 검토용 (2026-09-22). selfplay.js의 하네스(BOOT/HARNESS/ADAPTER)를 그대로 잘라 쓴다(사본 어긋남 방지).
// 사용: node tools/botlog.js [-n 6] [-a expert] [-b expert] [--seed 4242]  → tools/data/botlog/game-N.txt
//   각 파일: 덱·결과 헤더 + 턴 시작마다 상태 스냅샷(점수·손패·룬·전장 통제·유닛) + UI.log 전체(봇 내부 시뮬레이션 제외)
const fs=require('fs'), path=require('path'), vm=require('vm');
const R=path.join(__dirname,'..')+'/'; const JS=R+'client/web/js/'; const OUT=R+'tools/data/botlog';
const read=f=>fs.readFileSync(JS+f,'utf8');
const argv=process.argv.slice(2); const arg=(k,d)=>{const i=argv.indexOf(k); return i>=0?argv[i+1]:d;};
const N=+arg('-n',6), LA=arg('-a','expert'), LB=arg('-b','expert'), SEED0=+arg('--seed',4242);
fs.mkdirSync(OUT,{recursive:true});
const sp=fs.readFileSync(R+'tools/selfplay.js','utf8');
const cut=(a,b)=>{ const i=sp.indexOf(a), j=sp.indexOf(b,i); if(i<0||j<0) throw new Error('selfplay 절단 실패: '+a); return sp.slice(i,j); };
const D='$'+'{';   // selfplay.js 안의 템플릿 자리표시자를 값으로 치환
const BOOT=cut('var UI = {', '// 러너 전용 난수');
const HARNESS=cut('compileAllCards();', '// ---------- 정책 어댑터').split(D+'MAX_TURNS}').join('160').replace(/`;\s*$/,'');
const ADAPTER=cut('const BOT_W_BASE', '// ── 기준선(동결)').split(D+'JSON.stringify(WOVER)}').join('{}');
const RUN=`
var RS=1; function rrand(){ RS=(RS*1103515245+12345)&0x7fffffff; return RS/0x7fffffff; }
var SEAT=[null,null]; function SEATP(p){ const s=SEAT[p]; s.setLevel(); return s; }
var LOGS=[];
UI.log=function(msg,cls){ LOGS.push('['+(G?('T'+G.turnCount+' '+(G.turn===0?'A':'B')+'턴 '+G.state+(G.showdown?'(결전@'+G.showdown.bfIdx+' 체인'+G.showdown.chain.length+')':'')):'-')+'] '+(cls||'')+' | '+String(msg).replace(/\\s+/g,' ')); };
function snap(){
  if(typeof SIM!=='undefined' && (SIM.lock||SIM.active)) return;   // 봇 내부 시뮬레이션은 기록하지 않는다
  const P=G.players; const runes=p=>P[p].runes.filter(r=>!r.ex).length+'/'+P[p].runes.length;
  const units=p=>['base',0,1].map(l=>{ const us=(l==='base'?P[p].base:G.bfs[l].units.filter(u=>u.ctrl===p)); return (l==='base'?'기지':'전장'+l)+':'+us.map(u=>unitName(u)+(u.ex?'(탈진)':'')+(u.dmg?'(-'+u.dmg+')':'')+(u.buff?'(+'+u.buff+')':'')).join(','); }).join(' ');
  const bf=G.bfs.map((b,i)=>'전장'+i+'='+card(b.n).ko+'[통제:'+(b.controller==null?'-':(b.controller===0?'A':'B'))+' 숨김'+b.hiddenCards.length+']').join(' ');
  LOGS.push('  ▷ 상태: 점수 A'+P[0].points+' B'+P[1].points+' | 손패 A'+P[0].hand.length+' B'+P[1].hand.length+' | 준비룬 A'+runes(0)+' B'+runes(1)+' | 에너지 A'+P[0].energy+' B'+P[1].energy+' | '+bf);
  LOGS.push('  ▷ A: '+units(0)); LOGS.push('  ▷ B: '+units(1));
}
const _startTurn=startTurn; startTurn=async function(){ const r=await _startTurn.apply(this,arguments); snap(); return r; };
(async()=>{
  const legends=legendList(); const deckPool=[];
  for(let i=0;i<legends.length;i++){ RS=1000+i; deckPool.push(mkDeck(legends[i].n)); }
  for(let g=0; g<${N}; g++){
    LOGS=[];
    SEAT[0]=mkPolicy(${JSON.stringify(LA)},null,null); SEAT[1]=mkPolicy(${JSON.stringify(LB)},null,null);
    RS=${SEED0}+g*7919;
    const dA=deckPool[(g*3)%deckPool.length], dB=deckPool[(g*5+1)%deckPool.length];
    const stats={turns:0,draws:0,plays:{}};
    let err=null;
    try{ await playGame(${SEED0}+g, dA, dB, stats); }catch(e){ err=e; }
    const head=['# 봇전 '+(g+1)+' — A '+card(dA.legendN).ko+'('+card(dA.champN).ko+') vs B '+card(dB.legendN).ko+'('+card(dB.champN).ko+') · 시드 '+(${SEED0}+g)+' · 전장 '+G.bfs.map(b=>card(b.n).ko).join('/'),
      '# A 덱: '+dA.deck.map(n=>card(n).ko).join(', '), '# B 덱: '+dB.deck.map(n=>card(n).ko).join(', '),
      '# 결과: '+(G.winner===null?'미결':(G.winner===0?'A 승':'B 승'))+' 턴 '+stats.turns+(err?' · 오류: '+err.stack:''), ''];
    fs.writeFileSync(${JSON.stringify(OUT)}+'/game-'+(g+1)+'.txt', head.concat(LOGS).join('\\n'));
    console.log('game',g+1, head[0].slice(2,80), '→', head[3], 'lines', LOGS.length);
  }
})().catch(e=>{ console.log('CRASH',e.stack); process.exit(1); });
`;
const src=[BOOT, read('cards.js'), read('loc.js'), read('effects.js'), read('cardscripts.js'), read('engine.js'), read('bot-eval.js'), read('bot-sim.js'), read('bot-policy.js'), HARNESS, ADAPTER, RUN].join('\n;\n');
const ctx=vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, performance, fs });
vm.runInContext(src, ctx, { filename:'botlog-bundle.js' });
