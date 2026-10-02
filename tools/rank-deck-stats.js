#!/usr/bin/env node
// 등급전 덱별·매치업별 통계 (운영자용, 2026-10-02) — 서버 기록 두 가지를 읽는다
//   data/rank-matches.jsonl : 확정된 매치마다 1줄 (승자·패자 + 매칭 때 등록한 덱)
//   data/rank-games.jsonl   : 게임마다 1줄 (양쪽이 실제로 쓴 덱 = 사이드보딩 반영, 등록 덱 대비 교체 in/out, 선발·전장·선후공)
//
//   node tools/rank-deck-stats.js                         서버에서 두 파일을 받아(scp) 분석
//   node tools/rank-deck-stats.js --matches a.jsonl --games b.jsonl   받아 둔 파일 분석
//   옵션: --format bo1|bo3 · --min N(덱·플레이어 최소 판수, 기본 3) · --top N(기본 10) · --since YYYY-MM-DD
//         --lists(상위 덱 카드 목록) · --matchup "카이사"(이 이름이 들어간 아키타입의 매치업만)
//         --casual(일반 온라인 방 게임만) · --all(등급전+일반) — 기본은 등급전 게임만
// 게임 기록에는 낸 카드·멀리건·최종 점수·게임 시간·시간 초과, 매치 기록에는 MMR 전후·대기 시간·매치 시간·재접속 횟수도 있다.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const { cardName } = require('./replay-extract.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const fmt = opt('--format', null), MIN = +opt('--min', 3), TOP = +opt('--top', 10), since = opt('--since', null);
const lists = args.includes('--lists'), only = opt('--matchup', null);
const KEY = path.join(os.homedir(), '.ssh', 'riftbound'), HOST = 'root@riftboundsimkr.duckdns.org';

function load(file, remote) {
  if (!file) {
    file = path.join(os.tmpdir(), remote);
    try { execFileSync('scp', ['-q', '-i', KEY, `${HOST}:/opt/riftbound/data/${remote}`, file], { stdio: 'ignore' }); }
    catch (e) { return []; }   // 아직 기록 없음
  }
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(r => r && (!fmt || r.format === fmt) && (!since || r.at >= since));
}
const matches = load(opt('--matches', null), 'rank-matches.jsonl').filter(r => r.winner && r.loser);
const casualOnly = args.includes('--casual'), allGames = args.includes('--all');
const games = load(opt('--games', null), 'rank-games.jsonl').filter(r => r.players && r.players.length === 2)
  .filter(r => allGames ? true : casualOnly ? r.ranked === false : r.ranked !== false);

const short = n => cardName(n).split(' - ')[0];
const archOf = (legendN, champN) => legendN ? `${short(legendN)} / ${cardName(champN)}` : '(알 수 없음)';
const arch = d => d ? archOf(d.legendN, d.champN) : '(덱 없음)';
const sig = d => d ? [d.legendN, d.champN, [...(d.main || [])].sort((a, b) => a - b).join('.'), [...(d.runes || [])].sort((a, b) => a - b).join('.'), [...(d.bfs || [])].sort((a, b) => a - b).join('.')].join('|') : 'none';
const pct = (w, g) => g ? (100 * w / g).toFixed(1) + '%' : '-';
const cardsTxt = ns => { const c = {}; for (const n of ns) c[n] = (c[n] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1] || cardName(+a[0]).localeCompare(cardName(+b[0]))).map(([n, k]) => cardName(+n) + (k > 1 ? '×' + k : '')).join(', '); };
const span = rs => rs.length ? `${rs[0].at.slice(0, 10)} ~ ${rs[rs.length - 1].at.slice(0, 10)}` : '';

// ══ 1. 매치 단위 (등록 덱) ══
console.log(`■ 매치 ${matches.length}개${fmt ? ' (' + fmt + ')' : ''} ${span(matches)} · 게임 ${games.length}개${casualOnly ? '(일반 방)' : allGames ? '(등급전+일반)' : '(등급전)'} ${span(games)}`);
{ const mm = matches.filter(r => r.mmr && r.mmr.winner && r.mmr.loser);
  if (mm.length) {
    const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0;
    const upset = mm.filter(r => r.mmr.winner[0] < r.mmr.loser[0]).length;
    const waits = matches.flatMap(r => r.waitSec ? [r.waitSec.winner, r.waitSec.loser] : []).filter(Number.isFinite);
    const durs = matches.map(r => r.durationSec).filter(Number.isFinite);
    console.log(`  MMR 차이 평균 ${avg(mm.map(r => Math.abs(r.mmr.winner[0] - r.mmr.loser[0]))).toFixed(0)} · 낮은 MMR 쪽 승리 ${pct(upset, mm.length)} · 매칭 대기 평균 ${avg(waits).toFixed(0)}초 · 매치 시간 평균 ${(avg(durs) / 60).toFixed(1)}분 · 재접속 있었던 매치 ${matches.filter(r => r.rejoins > 0).length}개`);
  } }
if (matches.length) {
  const tally = keyOf => { const m = new Map(); for (const r of matches) for (const [s, won] of [[r.winner, 1], [r.loser, 0]]) { const k = keyOf(s); if (k == null) continue; let e = m.get(k); if (!e) m.set(k, e = { key: k, g: 0, w: 0, players: new Set(), deck: s.deck, arch: {} }); e.g++; e.w += won; e.players.add(s.id); const a = arch(s.deck); e.arch[a] = (e.arch[a] || 0) + 1; } return [...m.values()]; };
  console.log('\n■ 아키타입(전설 / 선발 챔피언)별 매치 승률 — 등록 덱 기준');
  for (const e of tally(s => arch(s.deck)).sort((a, b) => b.g - a.g)) console.log(`  ${e.key.padEnd(30)} ${String(e.g).padStart(4)}매치 ${pct(e.w, e.g).padStart(6)}  (플레이어 ${e.players.size}명)`);
  console.log(`\n■ 승률 높은 덱 리스트 — 같은 등록 덱 ${MIN}매치 이상, 상위 ${TOP}`);
  const D = tally(s => sig(s.deck)).filter(e => e.g >= MIN && e.key !== 'none').sort((a, b) => (b.w / b.g) - (a.w / a.g) || b.g - a.g).slice(0, TOP);
  if (!D.length) console.log(`  (아직 ${MIN}매치 이상 쓰인 같은 덱이 없습니다 — --min을 낮춰 보세요)`);
  D.forEach((e, i) => {
    console.log(`  ${i + 1}. ${arch(e.deck)} — ${e.g}매치 ${e.w}승 ${pct(e.w, e.g)} · 사용: ${[...e.players].join(', ')}`);
    if (lists) { console.log('     메인: ' + cardsTxt(e.deck.main || [])); console.log('     룬: ' + cardsTxt(e.deck.runes || []) + ' · 전장: ' + (e.deck.bfs || []).map(cardName).join(', ')); if ((e.deck.side || []).length) console.log('     사이드: ' + cardsTxt(e.deck.side)); }
  });
  console.log(`\n■ 플레이어별 (${MIN}매치 이상, 승률순 상위 ${TOP})`);
  for (const e of tally(s => s.id).filter(e => e.g >= MIN).sort((a, b) => (b.w / b.g) - (a.w / a.g) || b.g - a.g).slice(0, TOP))
    console.log(`  ${e.key.padEnd(14)} ${String(e.g).padStart(3)}매치 ${pct(e.w, e.g).padStart(6)} · ${Object.entries(e.arch).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}(${c})`).join(', ')}`);
}

// ══ 2. 게임 단위 (실제 덱 · 사이드보딩) ══
if (games.length) {
  // 게임마다 좌석 둘을 각각 '내 덱 vs 상대 덱' 한 건으로 펼친다
  const rows = [];
  for (const g of games) for (const s of [0, 1]) {
    const me = g.players[s], op = g.players[1 - s];
    rows.push({ g, me, op, my: archOf(me.legendN, me.champN), vs: archOf(op.legendN, op.champN), won: g.winner === null ? null : (g.winner === s ? 1 : 0),
      first: g.first === null ? null : g.first === s, swap: (me.sbIn || []).length > 0 });
  }
  const use = rows.filter(x => x.won !== null && (!only || x.my.includes(only) || x.vs.includes(only)));
  console.log(`\n■ 매치업별 게임 승률 — 실제 덱 기준 (행 = 내 덱, 같은 덱 미러 포함)${only ? ' · 필터: ' + only : ''}`);
  const mu = new Map();
  for (const x of use) { const k = x.my + '  vs  ' + x.vs; let e = mu.get(k); if (!e) mu.set(k, e = { k, g: 0, w: 0, firstG: 0, firstW: 0 }); e.g++; e.w += x.won; if (x.first) { e.firstG++; e.firstW += x.won; } }
  for (const e of [...mu.values()].sort((a, b) => b.g - a.g).slice(0, 40)) console.log(`  ${e.k.padEnd(62)} ${String(e.g).padStart(3)}게임 ${pct(e.w, e.g).padStart(6)}  (선공 ${e.firstG}게임 ${pct(e.firstW, e.firstG)})`);

  console.log('\n■ 사이드보딩 — 매치업별 교체 (등록 메인 대비 넣은 카드 ↔ 뺀 카드)');
  const sb = new Map();
  for (const x of use.filter(x => x.swap)) {
    const k = x.my + '  vs  ' + x.vs; let e = sb.get(k); if (!e) sb.set(k, e = { k, g: 0, w: 0, plans: new Map() });
    e.g++; e.w += x.won;
    const plan = `+[${cardsTxt(x.me.sbIn)}] −[${cardsTxt(x.me.sbOut)}]`;
    const p = e.plans.get(plan) || { g: 0, w: 0, who: new Set() }; p.g++; p.w += x.won; p.who.add(x.me.id); e.plans.set(plan, p);
  }
  if (!sb.size) console.log('  (아직 사이드보딩한 게임이 없습니다)');
  for (const e of [...sb.values()].sort((a, b) => b.g - a.g).slice(0, 30)) {
    const base = mu.get(e.k);
    console.log(`  ${e.k} — 교체한 게임 ${e.g}개 승률 ${pct(e.w, e.g)} (이 매치업 전체 ${base ? pct(base.w, base.g) : '-'})`);
    for (const [plan, p] of [...e.plans.entries()].sort((a, b) => b[1].g - a[1].g).slice(0, 5)) console.log(`     ${p.g}게임 ${pct(p.w, p.g).padStart(6)} · ${plan} · ${[...p.who].join(', ')}`);
  }
  // 선후공 · 멀리건 · 게임 길이 · 시간 초과
  const known = rows.filter(x => x.won !== null);
  const fr = known.filter(x => x.first === true), mul = {};
  for (const x of known) { const k = x.me.mulligan; if (k === null || k === undefined) continue; (mul[k] = mul[k] || { g: 0, w: 0 }); mul[k].g++; mul[k].w += x.won; }
  const secs = games.map(g => g.secs).filter(Number.isFinite), turns = games.map(g => g.turns).filter(Number.isFinite);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const tos = rows.filter(x => (x.me.timeouts || 0) > 0);
  console.log(`
■ 게임 일반: 선공 승률 ${pct(fr.reduce((s, x) => s + x.won, 0), fr.length)} (${fr.length}게임) · 평균 ${(avg(secs) / 60).toFixed(1)}분 · ${avg(turns).toFixed(1)}턴 · 시간 초과 나온 좌석 ${tos.length}건(그 좌석 승률 ${pct(tos.reduce((s, x) => s + (x.won || 0), 0), tos.length)})`);
  console.log('  멀리건 장수별 승률: ' + Object.entries(mul).sort().map(([k, e]) => `${k}장 ${e.g}게임 ${pct(e.w, e.g)}`).join(' · '));

  // 카드별: 낸 게임 수(플레이율)와 낸 게임의 승률 — 그 카드를 넣은 덱 기준
  const cs = new Map();
  for (const x of known) {
    const inDeck = new Set(x.me.main || []), playedSet = new Set(x.me.played || []);
    for (const n of inDeck) { let e = cs.get(n); if (!e) cs.set(n, e = { n, deck: 0, deckW: 0, played: 0, playedW: 0 }); e.deck++; e.deckW += x.won; if (playedSet.has(n)) { e.played++; e.playedW += x.won; } }
  }
  const cards = [...cs.values()].filter(e => e.played >= MIN);
  if (cards.length) {
    console.log(`
■ 카드별 (낸 게임 ${MIN}회 이상) — 덱에 넣은 게임 · 실제로 낸 비율 · 낸 게임 승률 / 안 낸 게임 승률`);
    const line = e => `  ${cardName(e.n).padEnd(16)} 덱 ${String(e.deck).padStart(3)}게임 · 냄 ${pct(e.played, e.deck).padStart(6)} · 낸 게임 ${pct(e.playedW, e.played).padStart(6)} / 안 낸 게임 ${pct(e.deckW - e.playedW, e.deck - e.played).padStart(6)}`;
    console.log('  ▲ 낸 게임 승률 상위'); for (const e of [...cards].sort((a, b) => b.playedW / b.played - a.playedW / a.played || b.played - a.played).slice(0, TOP)) console.log(line(e));
    console.log('  ▼ 낸 게임 승률 하위'); for (const e of [...cards].sort((a, b) => a.playedW / a.played - b.playedW / b.played || b.played - a.played).slice(0, TOP)) console.log(line(e));
  }
  const bad = games.filter(g => g.players.some(p => p.reported && !p.valid)).length, partial = games.filter(g => g.players.some(p => !p.reported)).length;
  if (bad || partial) console.log(`\n  (참고: 보고한 덱이 등록 덱(메인+사이드)과 맞지 않아 등록 덱으로 대신한 게임 ${bad}개 · 한쪽만 보고한 게임 ${partial}개)`);
}
if (!matches.length && !games.length) console.log('기록이 없습니다' + (fmt ? ` (${fmt})` : '') + (since ? ` (${since} 이후)` : ''));
