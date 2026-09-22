#!/usr/bin/env node
// 봇전 리플레이에서 난이도별 '실수 신호'를 잰다 — 왜 상위 티어가 사람에게 더 지는지 가설을 좁히는 도구.
//   node tools/replay-tiers.js tools/data/replays [--deck 전설번호]  (--deck: 봇 덱 전설 번호로 좁힘)
// 잰 것(봇 기준, 판당): 잃은 유닛/잡은 유닛, 봇이 연 결전에서의 순손실, 턴별 점수 흐름(누가 먼저 앞서나),
//   턴 종료 시 손패·준비 룬, 플레이한 카드 종류 분포(덱 카드 중 한 번도 안 낸 카드 — --deck 지정 시)
'use strict';
const fs = require('fs'), path = require('path');
const { rpLoad, rpActions, cardName, loadCards } = require('./replay-extract.js');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--deck'].includes(args[i - 1])));
const deckLegend = opt('--deck', null) ? +opt('--deck') : null;
loadCards();
function* walk(p) { const st = fs.statSync(p); if (st.isDirectory()) { for (const f of fs.readdirSync(p).sort()) yield* walk(path.join(p, f)); } else if (p.endsWith('.rbr')) yield p; }
const unitsOf = (S, seat) => { const out = []; for (const u of S.players[seat].base) out.push(u.uid); for (const b of S.bfs) for (const u of b.units) if (u.ctrl === seat) out.push(u.uid); return out; };

const T = {};   // level → 누적
const tier = lv => T[lv] || (T[lv] = { games: 0, humanWin: 0, botLost: 0, botKilled: 0, humanLost: 0, humanKilled: 0,
  botSd: 0, botSdNet: 0, humanSd: 0, humanSdNet: 0, leadFirst: { bot: 0, human: 0, none: 0 }, ptsByTurn: {}, botHandEnd: 0, botHandN: 0, humanHandEnd: 0, humanHandN: 0,
  botPlays: {}, botCardsSeen: {}, humanPlays: 0, botPlaysN: 0, turnsB: 0, turnsH: 0 });
let n = 0;
for (const f of walk(dir)) {
  let d; try { d = rpLoad(f); } catch (e) { continue; }
  if (!d.result || d.meta.manual) continue;
  const bot = d.meta.bot || d.header.bot; if (!bot) continue;
  const bs = bot.seat, hs = 1 - bs;
  if (deckLegend !== null && d.meta.players[bs].legendN !== deckLegend) continue;
  n++;
  const r = tier(bot.level || '?'); r.games++; if (d.result.winner === hs) r.humanWin++;
  const acts = rpActions(d);
  // 유닛 손익: 연속 상태 비교 (죽음 로그 대신 uid 집합 변화 — 회수·이동은 uid 유지)
  const S = d.states;
  let prevB = null, prevH = null;
  const frames = d.frames;
  // 결전 구간: '결전 개시' 로그의 상태 → 다음 '결전 종료|정복|전투 결과' 상태까지 유닛 변화
  let sdOpen = null;
  for (let i = 0; i < frames.length; i++) {
    const s = S[frames[i].s]; if (!s) continue;
    const B = new Set(unitsOf(s, bs)), H = new Set(unitsOf(s, hs));
    if (prevB) { for (const u of prevB) if (!B.has(u)) { r.botLost++; if (sdOpen) sdOpen.botLost++; } for (const u of prevH) if (!H.has(u)) { r.humanLost++; if (sdOpen) sdOpen.humanLost++; } }
    prevB = B; prevH = H;
    const l = frames[i].l || '';
    if (l.startsWith('⚔️ 결전 개시')) { const opener = acts.find(a => a.i === i); sdOpen = { by: opener ? opener.seat : null, botLost: 0, humanLost: 0 }; }
    if (sdOpen && (s.state === 'neutral' && !s.showdown)) {
      if (sdOpen.by === bs) { r.botSd++; r.botSdNet += sdOpen.humanLost - sdOpen.botLost; }
      else if (sdOpen.by === hs) { r.humanSd++; r.humanSdNet += sdOpen.botLost - sdOpen.humanLost; }
      sdOpen = null;
    }
    // 턴별 점수 흐름: 각 턴 첫 프레임의 점수
  }
  r.botKilled = r.humanLost; r.humanKilled = r.botLost;
  // 누가 먼저 앞섰나
  let lead = 'none';
  for (const fr of frames) { const s = S[fr.s]; if (!s) continue; const pb = s.players[bs].points, ph = s.players[hs].points; if (pb !== ph) { lead = pb > ph ? 'bot' : 'human'; break; } }
  r.leadFirst[lead]++;
  // 턴 종료 시 손패 & 플레이 분포
  for (const a of acts) {
    if (a.kind === 'end' && a.turnOwner === a.seat) { const s = S[a.stateBefore]; if (!s) continue;
      if (a.seat === bs) { r.botHandEnd += s.players[bs].hand.length; r.botHandN++; } else { r.humanHandEnd += s.players[hs].hand.length; r.humanHandN++; } }
    if (a.kind === 'play' && a.seat === bs) { r.botPlays[a.card] = (r.botPlays[a.card] || 0) + 1; r.botPlaysN++; }
    if (a.kind === 'play' && a.seat === hs) r.humanPlays++;
  }
  for (const c of new Set(d.meta.players[bs].deckList || d.states[0].players[bs].deckList || [])) r.botCardsSeen[cardName(c)] = (r.botCardsSeen[cardName(c)] || 0) + 1;
  const turnsOwned = seat => new Set(acts.filter(a => a.turnOwner === seat).map(a => a.turn)).size;
  r.turnsB += turnsOwned(bs); r.turnsH += turnsOwned(hs);
}
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
console.log(`봇전 ${n}판${deckLegend !== null ? ' · 봇 덱 전설 #' + deckLegend + ' ' + cardName(deckLegend) : ''}`);
for (const [lv, r] of Object.entries(T).sort((a, b) => b[1].games - a[1].games)) {
  console.log(`\n■ ${lv} — ${r.games}판 · 사람 승률 ${pct(r.humanWin, r.games)}`);
  console.log(`  유닛 손익(판당): 봇 잃음 ${(r.botLost / r.games).toFixed(2)} / 사람 잃음 ${(r.humanLost / r.games).toFixed(2)}  → 교환비 봇 ${(r.humanLost / Math.max(1, r.botLost)).toFixed(2)}`);
  console.log(`  결전: 봇이 연 결전 ${(r.botSd / r.games).toFixed(2)}회/판 · 순손익 ${(r.botSdNet / Math.max(1, r.botSd)).toFixed(2)}기/회 | 사람이 연 결전 ${(r.humanSd / r.games).toFixed(2)}회/판 · 순손익 ${(r.humanSdNet / Math.max(1, r.humanSd)).toFixed(2)}기/회`);
  console.log(`  먼저 앞선 쪽: 봇 ${pct(r.leadFirst.bot, r.games)} · 사람 ${pct(r.leadFirst.human, r.games)}`);
  console.log(`  턴 종료 손패: 봇 ${(r.botHandEnd / Math.max(1, r.botHandN)).toFixed(2)} · 사람 ${(r.humanHandEnd / Math.max(1, r.humanHandN)).toFixed(2)} | 턴당 플레이: 봇 ${(r.botPlaysN / Math.max(1, r.turnsB)).toFixed(2)} · 사람 ${(r.humanPlays / Math.max(1, r.turnsH)).toFixed(2)}`);
  if (deckLegend !== null) {
    const never = Object.keys(r.botCardsSeen).filter(c => !r.botPlays[c]).sort();
    const top = Object.entries(r.botPlays).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c, k]) => `${c} ${k}`).join(' · ');
    console.log(`  봇이 낸 카드 상위: ${top}`);
    console.log(`  덱에 있는데 한 번도 안 낸 카드(${never.length}): ${never.join(', ')}`);
  }
}
