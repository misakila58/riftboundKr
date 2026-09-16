#!/usr/bin/env node
// 수집된 리플레이 폴더 분석 — 봇 개선 자료.
//   node tools/replay-analyze.js <폴더|파일...> [--losses N] [--dataset out.jsonl] [--level master]
//   · 봇전 난이도별 전적(사람 승률·평균 턴), 사람 덱별 봇 상대 승률, 승자의 1~2턴 플레이 빈도
//   · --losses N : 봇이 진 판 N개를 골라 사람(승자)의 턴별 행동 요약을 출력 → 정책 수정 후보를 찾는다
//   · --dataset  : 승자의 (상태 특징, 행동) 쌍을 JSONL로 저장 → 모방 학습/평가 보정 실험 재료
// 서버에서 받는 법: scp -r -i ~/.ssh/riftbound root@riftboundsimkr.duckdns.org:/opt/riftbound/data/replays ./tools/data/replays
'use strict';
const fs = require('fs'), path = require('path');
const { rpLoad, rpActions, rpFeatures, cardName, loadCards } = require('./replay-extract.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const inputs = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--losses', '--dataset', '--level'].includes(args[i - 1])));
if (!inputs.length) { console.log('사용법: node tools/replay-analyze.js <폴더|파일...> [--losses N] [--dataset out.jsonl] [--level id]'); process.exit(1); }
const lossN = +opt('--losses', 5), datasetOut = opt('--dataset', null), levelFilter = opt('--level', null);

function* walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const f of fs.readdirSync(p)) yield* walk(path.join(p, f)); }
  else if (p.endsWith('.rbr')) yield p;
}
loadCards();
const games = [];
for (const inp of inputs) for (const f of walk(inp)) {
  try {
    const d = rpLoad(f);
    if (!d.result || d.meta.manual) continue;
    // v1.0.68 이전 파일에는 bot 필드가 없다 — 모드 문구("🤖 BOT 대전 — 😈 초고수 · …")로 대신 알아낸다 (봇은 항상 좌석 1)
    let bot = d.meta.bot || d.header.bot || null;
    if (!bot && /🤖/.test(d.meta.modeText || d.header.mode || '')) {
      const m = /—\s*(\S+\s+\S+?)\s*·/.exec(d.meta.modeText || d.header.mode || '');
      bot = { level: m ? m[1].replace(/^\S+\s/, '') : '?', seat: 1, inferred: true };
    }
    if (levelFilter && (!bot || bot.level !== levelFilter)) continue;
    games.push({ file: f, d, bot, acts: null });
  } catch (e) { console.error('읽기 실패:', f, e.message); }
}
console.log(`리플레이 ${games.length}판 (${inputs.join(', ')})`);
if (!games.length) process.exit(0);

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
const deckKey = P => `${cardName(P.legendN)} / ${cardName(P.champN)}`;

// ── 1. 봇전 난이도별 전적 ──
const byLevel = {};
const botGames = games.filter(g => g.bot);
for (const g of botGames) {
  const lv = g.bot.level || '?'; const r = byLevel[lv] || (byLevel[lv] = { games: 0, humanWin: 0, turns: 0 });
  r.games++; if (g.d.result.winner !== g.bot.seat) r.humanWin++; r.turns += g.d.result.turns || 0;
}
console.log('\n■ 봇전 전적 (사람 기준)');
for (const [lv, r] of Object.entries(byLevel)) console.log(`  ${lv.padEnd(8)} ${r.games}판 · 사람 승률 ${pct(r.humanWin, r.games)} · 평균 ${(r.turns / r.games).toFixed(1)}턴`);
const human = games.filter(g => !g.bot);
if (human.length) console.log(`  (사람 대 사람 ${human.length}판 — 아래 덱 통계·데이터셋에는 포함, 봇 전적에는 제외)`);

// ── 2. 사람 덱별 봇 상대 승률 ──
const byDeck = {};
for (const g of botGames) {
  const P = g.d.meta.players[1 - g.bot.seat]; const k = deckKey(P);
  const r = byDeck[k] || (byDeck[k] = { games: 0, wins: 0 }); r.games++; if (g.d.result.winner !== g.bot.seat) r.wins++;
}
console.log('\n■ 사람 덱별 봇 상대 승률');
for (const [k, r] of Object.entries(byDeck).sort((a, b) => b[1].games - a[1].games).slice(0, 20))
  console.log(`  ${k.padEnd(28)} ${String(r.games).padStart(3)}판 · ${pct(r.wins, r.games)}`);

// ── 3. 승자의 초반(1~2턴) 플레이 빈도 ──
const early = {};
for (const g of games) {
  g.acts = rpActions(g.d);
  const w = g.d.result.winner;
  for (const a of g.acts) if (a.seat === w && a.kind === 'play' && a.turn <= 2) early[a.card] = (early[a.card] || 0) + 1;
}
console.log('\n■ 승자의 1~2턴 플레이 카드 (빈도순)');
for (const [c, n] of Object.entries(early).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(3)}  ${c}`);

// ── 4. 봇이 진 판: 사람의 턴별 행동 요약 ──
const losses = botGames.filter(g => g.d.result.winner !== g.bot.seat).slice(-lossN);
if (losses.length) {
  console.log(`\n■ 봇이 진 판 ${losses.length}개 (최근순) — 사람(승자) 행동 요약`);
  for (const g of losses) {
    const d = g.d, hs = 1 - g.bot.seat, P = d.meta.players;
    console.log(`\n▶ ${path.basename(g.file)} · ${g.bot.level} · 사람 ${deckKey(P[hs])} vs 봇 ${deckKey(P[g.bot.seat])} · ${d.result.points.join(':')} · ${d.result.turns}턴`);
    const byTurn = {};
    for (const a of g.acts) {
      if (a.seat !== hs || !['play', 'ability', 'move', 'hide', 'showdown'].includes(a.kind)) continue;
      const s = a.kind === 'play' ? `「${a.card}」` : a.kind === 'ability' ? `능력「${a.name}」` : a.kind === 'move' ? `이동${a.count}→${a.dest}` : a.kind === 'hide' ? '숨김' : `결전@${a.bf}`;
      (byTurn[a.turn] || (byTurn[a.turn] = [])).push(s + (a.targets ? `(${a.targets.slice(0, 30)})` : ''));
    }
    for (const [t, list] of Object.entries(byTurn)) console.log(`  턴 ${String(t).padStart(2)}: ${list.join(' · ')}`);
  }
}

// ── 5. 학습용 데이터셋: 승자의 (상태 특징, 행동) ──
if (datasetOut) {
  const out = fs.createWriteStream(datasetOut);
  let n = 0;
  for (const g of games) {
    const d = g.d, w = d.result.winner;
    for (const a of g.acts) {
      if (a.seat !== w || !['play', 'ability', 'move', 'end', 'pass', 'hide'].includes(a.kind)) continue;
      const S = d.states[a.stateBefore]; if (!S) continue;
      const row = { game: path.basename(g.file), bot: g.bot ? g.bot.level : null, seat: w, turn: a.turn,
        x: rpFeatures(S, w), y: { kind: a.kind, card: a.card || a.name || null, dest: a.dest || null, count: a.count || null } };
      out.write(JSON.stringify(row) + '\n'); n++;
    }
  }
  out.end();
  console.log(`\n데이터셋 ${n}행 → ${datasetOut}`);
}
