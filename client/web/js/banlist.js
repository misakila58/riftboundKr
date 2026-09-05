// ══════════ 카드 밴 리스트 (한국 KR 기준) ══════════
// 라이엇 공식 밴리스트는 전 지역(한국 포함) 공인 대회에 동일 적용되는 단일 글로벌 목록이며,
// 공식 한국어 규칙 허브에 같은 목록이 게시되어 있다 (한국 전용 별도 밴 제도는 없음 — 2026-07-29 확인).
// 아래는 그중 이 시뮬레이터 카드풀(Origins/OGN 298장)에 존재하는 8종.
//   · 168 Fight or Flight(투쟁 혹은 도피)      — 2026-03-31 시행
//   · 182 Scrapheap(고철 더미)                — 2026-03-31 시행
//   · 177 Stealthy Pursuer(은밀한 추적자)      — 2026-07-24 시행
//   · 292 The Dreaming Tree(꿈꾸는 나무)       — 2026-03-31 시행 (전장)
//   · 284 Obelisk of Power(힘의 오벨리스크)    — 2026-03-31 시행 (전장)
//   · 285 Reaver's Row(약탈자의 거리)          — 2026-03-31 시행 (전장)
//   · 290 The Arena's Greatest(투기장 최고의 강자) — 2026-07-24 시행 (전장)
//   · 276 Aspirant's Climb(지망자의 등반)      — 2026-07-24 시행 (전장)
// OGN 외 밴 카드(이 시뮬레이터에 없음): Called Shot, Draven Vanquisher(Spiritforged),
// Master Yi, Wuju Bladesman(Proving Grounds, 2v2 전용 밴).
// ⚠ 서버(server/server.js)의 BANNED 상수와 반드시 함께 갱신할 것.
const BANLIST = {
  region: '한국(KR) 공식',
  updated: '2026-07-29',
  source: 'https://playriftbound.com/ko-kr/rules-hub/',
  cards: [168, 177, 182, 276, 284, 285, 290, 292],
};
function isBanned(n){ return BANLIST.cards.includes(n); }
// 덱에 포함된 밴 카드 번호들 (중복 제거)
function deckBannedCards(d){
  // 사이드덱 카드도 경기 중 메인으로 들어올 수 있으므로 함께 본다
  const all = [d.legendN, d.champN, ...(d.main||[]), ...(d.side||[]), ...(d.bfs||[])];
  return [...new Set(all)].filter(n => n != null && isBanned(n));
}
