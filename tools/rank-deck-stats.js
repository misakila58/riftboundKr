#!/usr/bin/env node
// 등급전 덱별 승률 통계 — 서버가 확정된 등급전마다 남기는 data/rank-matches.jsonl(양쪽 덱 포함)을 읽는다 (운영자용, 2026-10-02)
//   node tools/rank-deck-stats.js                     서버에서 받아(scp) 바로 분석
//   node tools/rank-deck-stats.js <rank-matches.jsonl> 받아 둔 파일 분석
//   옵션: --format bo1|bo3 · --min N(덱 리스트 최소 판수, 기본 3) · --top N(기본 10) · --since YYYY-MM-DD · --lists(상위 덱의 카드 목록 출력)
// 묶음: ① 전설+선발 챔피언(아키타입) ② 정확히 같은 덱(전설·챔피언·메인·룬·전장 동일) ③ 플레이어별
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const { cardName } = require('./replay-extract.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FLAGS = ['--format', '--min', '--top', '--since'];
let file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && FLAGS.includes(args[i - 1])));
const fmt = opt('--format', null), MIN = +opt('--min', 3), TOP = +opt('--top', 10), since = opt('--since', null), lists = args.includes('--lists');

if (!file) {
  file = path.join(os.tmpdir(), 'rank-matches.jsonl');
  try {
    execFileSync('scp', ['-q', '-i', path.join(os.homedir(), '.ssh', 'riftbound'), 'root@riftboundsimkr.duckdns.org:/opt/riftbound/data/rank-matches.jsonl', file], { stdio: 'inherit' });
  } catch (e) { console.error('서버에서 받지 못했습니다 (아직 기록이 없거나 접속 실패):', e.message); process.exit(1); }
}
const recs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
  .filter(r => r && r.winner && r.loser && (!fmt || r.format === fmt) && (!since || r.at >= since));
if (!recs.length) { console.log('기록이 없습니다' + (fmt ? ` (${fmt})` : '') + (since ? ` (${since} 이후)` : '')); process.exit(0); }

const short = n => cardName(n).split(' - ')[0];
const arch = d => d ? `${short(d.legendN)} / ${cardName(d.champN)}` : '(덱 없음)';
const sig = d => d ? [d.legendN, d.champN, [...(d.main || [])].sort((a, b) => a - b).join('.'), [...(d.runes || [])].sort((a, b) => a - b).join('.'), [...(d.bfs || [])].sort((a, b) => a - b).join('.')].join('|') : 'none';
const pct = (w, g) => g ? (100 * w / g).toFixed(1) + '%' : '-';
function tally(keyOf, extra) {
  const m = new Map();
  for (const r of recs) for (const [side, won] of [[r.winner, 1], [r.loser, 0]]) {
    const k = keyOf(side, r); if (k == null) continue;
    let e = m.get(k); if (!e) { e = { key: k, g: 0, w: 0, players: new Set(), deck: side.deck }; m.set(k, e); }
    e.g++; e.w += won; e.players.add(side.id); if (extra) extra(e, side, r, won);
  }
  return [...m.values()];
}
// 같은 아키타입끼리의 대결은 승률에 반반씩 들어가므로 따로 센다
const mirror = recs.filter(r => arch(r.winner.deck) === arch(r.loser.deck)).length;
const first = recs[0].at.slice(0, 10), last = recs[recs.length - 1].at.slice(0, 10);
console.log(`등급전 ${recs.length}판${fmt ? ' (' + fmt + ')' : ''} · ${first} ~ ${last} · 같은 아키타입 대결 ${mirror}판`);

console.log('\n■ 아키타입(전설 / 선발 챔피언)별 승률');
const A = tally(s => arch(s.deck)).sort((a, b) => b.g - a.g);
for (const e of A) console.log(`  ${e.key.padEnd(30)} ${String(e.g).padStart(4)}판 ${String(e.w).padStart(4)}승  ${pct(e.w, e.g).padStart(6)}  (플레이어 ${e.players.size}명)`);

console.log(`\n■ 승률 높은 덱 리스트 (같은 덱 ${MIN}판 이상, 상위 ${TOP})`);
const D = tally(s => sig(s.deck)).filter(e => e.g >= MIN && e.key !== 'none').sort((a, b) => (b.w / b.g) - (a.w / a.g) || b.g - a.g).slice(0, TOP);
if (!D.length) console.log(`  (${MIN}판 이상 쓰인 같은 덱이 아직 없습니다 — --min을 낮춰 보세요)`);
D.forEach((e, i) => {
  console.log(`  ${i + 1}. ${arch(e.deck)} — ${e.g}판 ${e.w}승 ${pct(e.w, e.g)} · 사용: ${[...e.players].join(', ')}`);
  if (lists) {
    const cnt = {}; for (const n of e.deck.main || []) cnt[n] = (cnt[n] || 0) + 1;
    const rows = Object.entries(cnt).sort((a, b) => b[1] - a[1] || cardName(+a[0]).localeCompare(cardName(+b[0])));
    console.log('     메인: ' + rows.map(([n, c]) => `${cardName(+n)}×${c}`).join(', '));
    const rc = {}; for (const n of e.deck.runes || []) rc[n] = (rc[n] || 0) + 1;
    console.log('     룬: ' + Object.entries(rc).map(([n, c]) => `${cardName(+n)}×${c}`).join(', ') + ' · 전장: ' + (e.deck.bfs || []).map(cardName).join(', '));
    if ((e.deck.side || []).length) console.log('     사이드: ' + e.deck.side.map(cardName).join(', '));
  }
});

console.log(`\n■ 플레이어별 (${MIN}판 이상, 승률순 상위 ${TOP}) — 주로 쓴 아키타입`);
const P = tally(s => s.id, (e, s) => { e.arch = e.arch || {}; const k = arch(s.deck); e.arch[k] = (e.arch[k] || 0) + 1; })
  .filter(e => e.g >= MIN).sort((a, b) => (b.w / b.g) - (a.w / a.g) || b.g - a.g).slice(0, TOP);
for (const e of P) console.log(`  ${e.key.padEnd(14)} ${String(e.g).padStart(3)}판 ${pct(e.w, e.g).padStart(6)} · ${Object.entries(e.arch).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}(${c})`).join(', ')}`);
