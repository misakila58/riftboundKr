// ══════════ 리플레이 맹점 캐기 (headless) ══════════
// 사람이 둔 판을 봇에게 다시 물어보고, "사람은 했는데 봇은 생각조차 못 한 수"를 찾는다.
//
//   node tools/replay-mine.js <파일.rbr | 폴더> [옵션]
//     --level master     봇 난이도 (novice/skilled/expert/master/oracle · 기본 master)
//     --top 20           보여줄 이견 개수 (기본 20)
//     --min-delta 0.30   이 값보다 평가 차이가 큰 이견만 (기본 0.30)
//     --all              진 쪽의 수도 본다 (기본은 이긴 쪽만 — 이긴 사람의 수가 참고할 값어치가 크다)
//     --json <파일>      결과를 JSON으로 저장
//
// 왜 이게 자가대전보다 나은가:
//   자가대전은 무한정 돌릴 수 있지만 '봇이 아는 수' 안에서만 논다.
//   사람 리플레이는 봇의 후보 목록에 아예 없던 수를 보여준다 — 그게 맹점이다.
//
// 한계(정직하게):
//   · 리플레이에는 '행동'이 아니라 '상태와 로그'만 남는다. 사람의 수는 로그 문구로 읽는다.
//   · 평가 차이는 봇 자신의 잣대다. 봇이 크게 손해라고 본 수를 사람이 두고 이겼다면
//     봇의 평가가 틀렸을 가능성이 크다 — 그 지점을 사람이 직접 보라고 뽑아 주는 도구다.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const JS = path.join(__dirname, '..', 'client', 'web', 'js');
const read = f => fs.readFileSync(path.join(JS, f), 'utf8');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes(k);
const TARGET = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--level'
  && argv[argv.indexOf(a) - 1] !== '--top' && argv[argv.indexOf(a) - 1] !== '--min-delta'
  && argv[argv.indexOf(a) - 1] !== '--json');
const LEVEL = arg('--level', 'master');
const TOP = +arg('--top', 20);
const MIN_DELTA = +arg('--min-delta', 0.30);
const WINNER_ONLY = !has('--all');
const JSON_OUT = arg('--json', null);

if (!TARGET) {
  console.error('사용법: node tools/replay-mine.js <파일.rbr | 폴더> [--level master] [--top 20] [--min-delta 0.3] [--all]');
  process.exit(1);
}

// ---------- .rbr 읽기 ----------
// 형식: "RBRP" + 버전(1B) + gz플래그(1B) + 헤더길이(4B LE) + 헤더JSON + 본문
function readReplay(file) {
  const buf = fs.readFileSync(file);
  if (buf.slice(0, 4).toString() !== 'RBRP') throw new Error('RBRP 파일이 아닙니다');
  const gz = buf[5];
  const hlen = buf.readUInt32LE(6);
  const header = JSON.parse(buf.slice(10, 10 + hlen).toString('utf8'));
  let body = buf.slice(10 + hlen);
  if (gz) body = zlib.gunzipSync(body);
  const data = JSON.parse(body.toString('utf8'));
  return { file, header, data };
}

function collectFiles(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return [target];
  return fs.readdirSync(target).filter(f => f.toLowerCase().endsWith('.rbr'))
    .map(f => path.join(target, f)).sort();
}

// ---------- 엔진·정책만 띄우는 최소 환경 ----------
// selfplay.js와 같은 방식: 실제 client/web/js 파일을 그대로 읽는다 (사본 금지).
const BOOT = `
var UI = {
  log(){}, render(){}, toast(){}, prompt(){}, promptShowdown(){}, manualNotice(){},
  showVictory(){}, inspect(){}, inspectUnit(){}, hideZoom(){}, showZoom(){},
  isPicking(){ return false; }, logEntryEl(){ return null; },
  fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  // 맹점 캐기는 '무엇을 고를까'만 묻는다. 선택 프롬프트가 열리면 무난한 기본값으로 답해
  // 시뮬레이션이 멈추지 않게 한다 (여기서의 답은 후보 평가에만 쓰인다).
  confirmP:     ()        => Promise.resolve(true),
  pickUnitFrom: (p,c)     => Promise.resolve(c && c[0]),
  pickOption:   (p,t,o)   => Promise.resolve(o && o.length ? o[0].v : null),
  pickReaction: ()        => Promise.resolve(null),
  pickNumber:   (p,t,mn,mx)=> Promise.resolve(mx),
  pickHandCard: ()        => Promise.resolve(0),
  pickMulligan: ()        => Promise.resolve([]),
};
var NET = { online:false, seat:null, dispatch(a,fn){ if(fn) fn(); } };
var REPLAY = { viewing:false, recording:false, capture(){}, _onNewGame(){}, _onVictory(){} };
var BUILDINFO = { version:'replay-mine', built:'' };
`;

const HARNESS = `
compileAllCards();

// 리플레이 상태를 그대로 G에 얹는다 (replay.js의 seek과 같은 방식)
function loadState(s){ G = JSON.parse(JSON.stringify(s)); }

// 봇이 이 자리에서 무엇을 두려 했는지
async function botWouldDo(p, level){
  POLICY.level = level;
  const tier = { novice:{think:0,budget:0,peek:false}, skilled:{think:0,budget:0,peek:false},
                 expert:{think:1,budget:1500,peek:false}, master:{think:2,budget:2500,peek:false},
                 oracle:{think:2,budget:2500,peek:true} }[level] || {think:0,budget:0,peek:false};
  POLICY.think = tier.think; POLICY.budget = tier.budget; POLICY.peek = tier.peek;
  const ctx = POLICY.newCtx();
  POLICY.syncCtx(ctx);
  try { return await POLICY.nextAction(p, ctx); }
  catch(e){ return null; }
}

// 액션을 사람이 읽을 수 있는 한 줄로
function actLabel(a){
  if(!a) return '(둘 수 없음 · 턴 종료)';
  switch(a.kind){
    case 'play':    return '플레이: ' + (card(a.n) ? card(a.n).ko : ('#'+a.n));
    case 'champ':   return '선발 챔피언 플레이';
    case 'hidden':  return '숨긴 카드 사용: ' + (card(a.n) ? card(a.n).ko : ('#'+a.n));
    case 'hide':    return '카드 숨기기';
    case 'ability': return '능력: ' + (a.label || '');
    case 'move':    return '이동' + (a.why ? ' (' + a.why + ')' : '');
    case 'end':     return '턴 종료 (더 둘 것이 없다고 판단)';
    default:        return a.kind || '?';
  }
}

// 이 상태에서 봇이 보는 점수 (자기 잣대)
function scoreFor(p){ try { return evalState(G, p); } catch(e){ return null; } }
`;

const src = [BOOT, read('cards.js'), read('loc.js'), read('effects.js'), read('cardscripts.js'),
             read('engine.js'), read('bot-eval.js'), read('bot-sim.js'), read('bot-policy.js'), HARNESS].join('\n;\n');

const ctx = vm.createContext({
  console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map,
  String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process,
});
try { vm.runInContext(src, ctx, { filename: 'replay-mine-bundle.js' }); }
catch (e) { console.error('엔진 로드 실패:', e.message); process.exit(1); }

// ---------- 사람의 수 읽기 ----------
// 리플레이에는 행동이 구조로 남지 않는다 → 로그 문구로 읽는다.
// '무엇을 했는가'(플레이/이동/능력/숨기기)와 '그래서 무슨 일이 났는가'(버프·기절·사망)를
// 구분해야 한다. 앞의 것만 행동으로 인정하고, 뒤의 것은 참고용 결과로 따로 모은다.
const ACTION_RE = /(「[^」]+」\s*플레이|플레이!|이동|능력 발동|숨기기|숨겨 둠|선발 챔피언|결전 개시)/;
const NOISE_RE  = /비용 지불|드로우|룬 .*전개|의 턴|시작!|승리 조건|멀리건|체인에 적재|무효화되어|무주공산/;
function splitLogs(frames, from, to) {
  const acts = [], effects = [];
  for (let i = from; i < to; i++) {
    const l = frames[i].l;
    if (!l || NOISE_RE.test(l)) continue;
    (ACTION_RE.test(l) ? acts : effects).push(l.trim());
  }
  return { acts, effects };
}

// 사람이 한 수가 끝나고 '다음 판단 지점'이 되는 프레임을 찾는다.
// 봇의 수는 완결된 행동 하나이므로, 사람 쪽도 같은 단위로 잘라야 점수를 비교할 수 있다.
function nextDecisionFrame(data, i, p) {
  for (let j = i + 1; j < data.frames.length; j++) {
    const s = data.states[data.frames[j].s];
    if (!s) continue;
    if (s.winner !== null) return j;                       // 판이 끝났다
    if (s.turn !== p) return j;                            // 턴이 넘어갔다
    if (s.phase === 'action' && s.state === 'neutral' && s.turn === s.actingPlayer) {
      if (data.frames[j].s !== data.frames[i].s) return j; // 같은 사람의 다음 판단 지점
    }
  }
  return data.frames.length - 1;
}

// ---------- 한 판 분석 ----------
function analyze(rep) {
  const { header, data } = rep;
  const winner = header.result && typeof header.result.winner === 'number' ? header.result.winner : null;
  const names = (header.players || []).map(p => p.name);
  const out = { file: path.basename(rep.file), names, winner, points: [], agree: 0, total: 0 };

  for (let i = 0; i < data.frames.length - 1; i++) {
    const f = data.frames[i], g = data.frames[i + 1];
    if (f.s === g.s) continue;                       // 상태가 안 바뀐 프레임(로그만)은 건너뛴다
    const s = data.states[f.s];
    // 사람이 '행동 단계에서 자기 차례에' 둔 수만 본다 (자동 처리 구간은 제외)
    if (!s || s.winner !== null || s.phase !== 'action' || s.state !== 'neutral') continue;
    if (s.turn !== s.actingPlayer) continue;
    const p = s.turn;
    if (WINNER_ONLY && winner !== null && p !== winner) continue;

    const end = nextDecisionFrame(data, i, p);
    const { acts, effects } = splitLogs(data.frames, i, end);
    if (!acts.length) continue;                      // 행동으로 읽히는 줄이 없으면 건너뛴다

    let before = null;
    try { ctx.loadState(s); before = ctx.scoreFor(p); }
    catch (e) { continue; }
    out.points.push({
      frame: i, stateIdx: f.s, endStateIdx: data.frames[end].s,
      turn: s.turnCount, p, before,
      human: acts.join(' → '),
      effects: effects.slice(0, 3).join(' · '),
    });
    out.total++;
  }
  return out;
}

// 봇 질의는 비동기라 따로 돈다
async function askBot(rep, out) {
  const { data } = rep;
  for (const pt of out.points) {
    const s = data.states[pt.stateIdx];
    ctx.loadState(s);
    const a = await ctx.botWouldDo(pt.p, LEVEL);
    pt.bot = ctx.actLabel(a);
    pt.botKind = a && a.kind;
    // 봇이 자기 수를 얼마나 더 좋게 보는가 = 이견의 세기
    // (봇의 수를 둬 본 뒤 점수 − 사람이 실제로 간 다음 상태의 점수)
    let botScore = null;
    try {
      if (a) botScore = await ctx.simScore(pt.p, a);
    } catch (e) { botScore = null; }
    // 사람의 수도 '한 행동이 끝난 뒤' 상태로 재야 봇의 수와 단위가 맞는다
    let humanScore = null;
    try { ctx.loadState(data.states[pt.endStateIdx]); humanScore = ctx.scoreFor(pt.p); } catch (e) {}
    pt.botScore = botScore; pt.humanScore = humanScore;
    pt.delta = (botScore !== null && humanScore !== null) ? botScore - humanScore : null;
    // 봇이 고른 카드 이름이 사람의 행동 줄에 들어 있으면 같은 수로 본다
    const botCard = (pt.bot || '').replace(/^[^:]+:\s*/, '').trim();
    if (botCard && pt.human && pt.human.includes(botCard)) { pt.same = true; out.agree++; }
  }
}

(async () => {
  const files = collectFiles(TARGET);
  if (!files.length) { console.error('리플레이 파일(.rbr)을 찾지 못했습니다: ' + TARGET); process.exit(1); }

  // 봇의 수를 실제로 둬 보고 점수를 재는 도우미 (SIM 사용)
  vm.runInContext(`
    async function simScore(p, act){
      const v = await simTry(p, () => POLICY.runAction(p, act), POLICY);
      return v;
    }
  `, ctx);

  console.log('════════════════════════════════════════');
  console.log(' 리플레이 맹점 캐기 — 봇 난이도: ' + LEVEL);
  console.log(' 대상 ' + files.length + '개 · ' + (WINNER_ONLY ? '이긴 쪽의 수만' : '양쪽 모두'));
  console.log('════════════════════════════════════════\n');

  const all = [];
  let games = 0, decisions = 0;
  for (const f of files) {
    let rep;
    try { rep = readReplay(f); }
    catch (e) { console.error('  건너뜀 ' + path.basename(f) + ' — ' + e.message); continue; }
    const out = analyze(rep);
    await askBot(rep, out);
    games++; decisions += out.total;
    const nm = out.names.join(' vs ');
    console.log(`  ${path.basename(f)}  (${nm}) — 판단 지점 ${out.total}개`);
    out.points.forEach(pt => all.push({ ...pt, file: out.file, names: out.names, winner: out.winner }));
  }

  const dis = all.filter(pt => pt.delta !== null && pt.delta >= MIN_DELTA)
                 .sort((a, b) => b.delta - a.delta);

  const agreed = all.filter(pt => pt.same).length;
  console.log(`\n■ 요약`);
  console.log(`  리플레이 ${games}판 · 사람의 판단 지점 ${decisions}개`);
  console.log(`  봇도 같은 수를 골랐다: ${agreed}개` + (decisions ? ` (${(agreed / decisions * 100).toFixed(0)}%)` : ''));
  console.log(`  봇이 크게 다르게 본 지점: ${dis.length}개 (평가 차이 ${MIN_DELTA} 이상)`);
  if (games < 10) {
    console.log(`\n  ⚠ 리플레이가 ${games}판뿐입니다. 한두 판으로 정책을 고치면 그 판에만 맞는 봇이 됩니다.`);
    console.log('     최소 10판, 되도록 30판 이상 모은 뒤 반복해서 나오는 이견부터 보세요.');
  }

  if (!dis.length) {
    console.log('\n  큰 이견이 없습니다. --min-delta 를 낮추거나 --all 로 다시 보세요.');
  } else {
    console.log(`\n■ 이견이 큰 순서 (상위 ${Math.min(TOP, dis.length)}개)`);
    console.log('  봇이 자기 수를 훨씬 좋게 봤는데 사람은 다르게 뒀고, 그 사람이 이긴 판이라면');
    console.log('  봇의 판단이 틀렸을 가능성이 큽니다 — 그 지점을 직접 보세요.\n');
    dis.slice(0, TOP).forEach((pt, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. [차이 ${pt.delta.toFixed(2)}] ${pt.file} · 턴 ${pt.turn} · ${pt.names[pt.p]}`
        + (pt.winner === pt.p ? ' (이 판을 이김)' : ''));
      console.log(`      사람: ${pt.human}`);
      console.log(`      봇  : ${pt.bot}`);
    });
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ level: LEVEL, games, decisions, points: all }, null, 1));
    console.log(`\n  JSON 저장: ${JSON_OUT}`);
  }
})().catch(e => { console.error('오류:', e.stack || e.message); process.exit(1); });
