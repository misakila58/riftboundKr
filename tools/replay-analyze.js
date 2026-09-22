#!/usr/bin/env node
// 수집된 리플레이 폴더 분석 — 봇 개선 자료. 파일을 하나씩 읽고 요약만 남긴다(수천 판도 메모리 문제 없이).
//   node tools/replay-analyze.js <폴더|파일...> [--losses N] [--dataset out.jsonl] [--level id] [--since YYYY-MM-DD]
//   · 봇전 난이도별 전적(사람 승률·평균 턴·선후공별), 사람 덱별 봇 상대 승률
//   · 템포 비교: 턴당 플레이/이동/결전 개시/능력 — 사람(승자)과 봇을 난이도별로 나란히
//   · --losses N : 봇이 진 판 N개(최근순)의 사람(승자) 턴별 행동 요약 → 정책 수정 후보
//   · --dataset  : 승자의 (상태 특징, 행동) 쌍을 JSONL로 저장 → 모방 학습/평가 보정 실험 재료
// 서버에서 받는 법: scp -r -i ~/.ssh/riftbound root@riftboundsimkr.duckdns.org:/opt/riftbound/data/replays/* tools/data/replays/
'use strict';
const fs = require('fs'), path = require('path');
const { rpLoad, rpActions, rpFeatures, cardName, loadCards } = require('./replay-extract.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FLAGS = ['--losses', '--dataset', '--level', '--since'];
const inputs = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && FLAGS.includes(args[i - 1])));
if (!inputs.length) { console.log('사용법: node tools/replay-analyze.js <폴더|파일...> [--losses N] [--dataset out.jsonl] [--level id] [--since YYYY-MM-DD]'); process.exit(1); }
const lossN = +opt('--losses', 5), datasetOut = opt('--dataset', null), levelFilter = opt('--level', null), since = opt('--since', null);

function* walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const f of fs.readdirSync(p).sort()) yield* walk(path.join(p, f)); }
  else if (p.endsWith('.rbr')) yield p;
}
loadCards();
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
const deckKey = P => `${cardName(P.legendN)} / ${cardName(P.champN)}`;
const ACTS = ['play', 'ability', 'move', 'showdown', 'hide', 'pass'];

// ── 누적기 ──
let total = 0, humanGames = 0, failed = 0;
const byLevel = {};      // level → {games, humanWin, turns, humanFirst, humanFirstWin, tempo:{human:{turns,play,..}, bot:{...}}}
const byDeck = {};       // 사람 덱 → {games, wins}
const early = {};        // 승자의 1~2턴 플레이 카드
const humanTempo = { turns: 0 }, botTempo = { turns: 0 };   // 사람전(사람 대 사람) 승자 vs 봇전 봇 — 참고용 전역
const losses = [];       // 봇이 진 판 요약 (최근 lossN개 유지)
const ds = datasetOut ? fs.createWriteStream(datasetOut) : null; let dsRows = 0;

function tempoOf(acts, seat) {
  const t = { turns: 0 }; for (const k of ACTS) t[k] = 0;
  const turns = new Set();
  for (const a of acts) { if (a.seat !== seat) continue; if (a.turnOwner === seat) turns.add(a.turn); if (t[a.kind] !== undefined) t[a.kind]++; }
  t.turns = Math.max(1, turns.size); return t;
}
function addTempo(dst, t) { dst.turns += t.turns; for (const k of ACTS) dst[k] = (dst[k] || 0) + t[k]; }
function tempoLine(t) { return ACTS.map(k => `${k} ${(t[k] / t.turns).toFixed(2)}`).join(' · ') + `  (턴 ${t.turns})`; }

for (const inp of inputs) for (const f of walk(inp)) {
  let d;
  try { d = rpLoad(f); } catch (e) { failed++; continue; }
  try {
    if (!d.result || d.meta.manual) continue;
    if (since && String(d.created || '').slice(0, 10) < since) continue;
    let bot = d.meta.bot || d.header.bot || null;
    if (!bot && /🤖/.test(d.meta.modeText || d.header.mode || '')) {
      const m = /—\s*(\S+\s+\S+?)\s*·/.exec(d.meta.modeText || d.header.mode || '');
      bot = { level: m ? m[1].replace(/^\S+\s/, '') : '?', seat: 1, inferred: true };
    }
    if (levelFilter && (!bot || bot.level !== levelFilter)) continue;
    total++;
    const acts = rpActions(d);
    const w = d.result.winner, P = d.meta.players;
    // 첫 턴 주인 = 선공
    const firstTurn = acts.find(a => a.turn === 1 && a.turnOwner != null);
    const firstSeat = firstTurn ? firstTurn.turnOwner : null;

    for (const a of acts) if (a.seat === w && a.kind === 'play' && a.turn <= 2) early[a.card] = (early[a.card] || 0) + 1;

    if (bot) {
      const hs = 1 - bot.seat, lv = bot.level || '?';
      const r = byLevel[lv] || (byLevel[lv] = { games: 0, humanWin: 0, turns: 0, humanFirst: 0, humanFirstWin: 0, humanSecondWin: 0,
        botPtsWhenLose: 0, humanPtsWhenLose: 0, tempoH: { turns: 0 }, tempoB: { turns: 0 } });
      r.games++; const hw = w === hs; if (hw) r.humanWin++; r.turns += d.result.turns || 0;
      if (firstSeat === hs) { r.humanFirst++; if (hw) r.humanFirstWin++; } else if (firstSeat != null && hw) r.humanSecondWin++;
      if (hw) r.botPtsWhenLose += d.result.points[bot.seat]; else r.humanPtsWhenLose += d.result.points[hs];
      addTempo(r.tempoH, tempoOf(acts, hs)); addTempo(r.tempoB, tempoOf(acts, bot.seat));
      const k = deckKey(P[hs]); const dr = byDeck[k] || (byDeck[k] = { games: 0, wins: 0 }); dr.games++; if (hw) dr.wins++;
      if (hw) {
        const byTurn = {};
        for (const a of acts) {
          if (a.seat !== hs || !['play', 'ability', 'move', 'hide', 'showdown'].includes(a.kind)) continue;
          const s = a.kind === 'play' ? `「${a.card}」` : a.kind === 'ability' ? `능력「${a.name}」` : a.kind === 'move' ? `이동${a.count}→${a.dest}` : a.kind === 'hide' ? '숨김' : `결전@${a.bf}`;
          (byTurn[a.turn] || (byTurn[a.turn] = [])).push(s);
        }
        losses.push({ file: path.basename(f), lv, human: deckKey(P[hs]), bot: deckKey(P[bot.seat]), pts: d.result.points.join(':'), turns: d.result.turns, byTurn, humanFirst: firstSeat === hs });
        if (losses.length > lossN) losses.shift();
      }
    } else {
      humanGames++;
      addTempo(humanTempo, tempoOf(acts, w));
    }
    if (ds) {
      for (const a of acts) {
        if (a.seat !== w || !['play', 'ability', 'move', 'end', 'pass', 'hide'].includes(a.kind)) continue;
        const S = d.states[a.stateBefore]; if (!S) continue;
        ds.write(JSON.stringify({ game: path.basename(f), bot: bot ? bot.level : null, seat: w, turn: a.turn,
          x: rpFeatures(S, w), y: { kind: a.kind, card: a.card || a.name || null, dest: a.dest || null, count: a.count || null } }) + '\n');
        dsRows++;
      }
    }
  } catch (e) { failed++; console.error('분석 실패:', path.basename(f), e.message); }
}

console.log(`리플레이 ${total}판 분석 (사람 대 사람 ${humanGames}판 · 읽기 실패 ${failed})`);
console.log('\n■ 봇전 전적 (사람 기준) — 판수 · 사람 승률 · 평균 턴 · 사람 선공 비율 · 선공일 때/후공일 때 승률 · 봇 패배 시 봇 평균 점수');
for (const [lv, r] of Object.entries(byLevel).sort((a, b) => b[1].games - a[1].games)) {
  const hf = r.humanFirst, hsn = r.games - hf;
  console.log(`  ${lv.padEnd(8)} ${String(r.games).padStart(4)}판 · ${pct(r.humanWin, r.games)} · ${(r.turns / r.games).toFixed(1)}턴 · 선공 ${pct(hf, r.games)} · 선공승 ${pct(r.humanFirstWin, hf)} / 후공승 ${pct(r.humanSecondWin, hsn)} · 봇 패배시 ${(r.botPtsWhenLose / Math.max(1, r.humanWin)).toFixed(1)}점`);
}
console.log('\n■ 템포 비교 (턴당 횟수) — 위: 사람 / 아래: 봇');
for (const [lv, r] of Object.entries(byLevel).sort((a, b) => b[1].games - a[1].games)) {
  console.log(`  ${lv}`); console.log(`    사람 ${tempoLine(r.tempoH)}`); console.log(`    봇   ${tempoLine(r.tempoB)}`);
}
if (humanTempo.turns) console.log(`  (사람 대 사람 승자) ${tempoLine(humanTempo)}`);
console.log('\n■ 사람 덱별 봇 상대 승률 (판수순 상위 15)');
for (const [k, r] of Object.entries(byDeck).sort((a, b) => b[1].games - a[1].games).slice(0, 15))
  console.log(`  ${k.padEnd(34)} ${String(r.games).padStart(4)}판 · ${pct(r.wins, r.games)}`);
console.log('\n■ 승자의 1~2턴 플레이 카드 (빈도순 상위 15)');
for (const [c, n] of Object.entries(early).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${c}`);
if (losses.length) {
  console.log(`\n■ 봇이 진 판 ${losses.length}개 (최근순) — 사람(승자) 행동 요약`);
  for (const g of losses) {
    console.log(`\n▶ ${g.file} · ${g.lv} · 사람 ${g.human}${g.humanFirst ? '(선공)' : '(후공)'} vs 봇 ${g.bot} · ${g.pts} · ${g.turns}턴`);
    for (const [t, list] of Object.entries(g.byTurn)) console.log(`  턴 ${String(t).padStart(2)}: ${list.join(' · ')}`);
  }
}
if (ds) { ds.end(); console.log(`\n데이터셋 ${dsRows}행 → ${datasetOut}`); }
