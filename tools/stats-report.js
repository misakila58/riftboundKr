// ══════════ 익명 통계 주간 리포트 ══════════
// 배포한 stats-worker의 집계를 읽어 사람이 볼 수 있게 정리한다.
//
//   node tools/stats-report.js https://riftbound-stats.<계정>.workers.dev
//   node tools/stats-report.js <주소> --days 7        최근 7일만
//   node tools/stats-report.js <주소> --mode p2p      특정 모드만
//   node tools/stats-report.js <주소> --min 5         매치업 최소 표본 수 (기본 3)
//
// 서버에는 집계 숫자만 있으므로 개인을 특정할 수 있는 정보는 나오지 않는다.
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const base = argv.find(a => /^https?:\/\//.test(a));
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if (!base) {
  console.error('사용법: node tools/stats-report.js <Worker 주소> [--days 7] [--mode p2p] [--min 3]');
  process.exit(1);
}
const DAYS = +arg('--days', 0);
const ONLY = arg('--mode', null);
const MIN  = +arg('--min', 3);

// 카드 이름 (전설/챔피언 번호 → 한글명)
let CARD = {};
try {
  const src = fs.readFileSync(path.join(__dirname, '..', 'client', 'web', 'js', 'cards.js'), 'utf8');
  for (const c of new Function(src + '; return CARDS;')()) CARD[c.n] = c.ko || c.name;
} catch (e) { /* 이름 없이 번호로 표시 */ }
const deckName = key => {
  const [l, c] = key.split('-').map(Number);
  return `${CARD[l] || ('전설' + l)} / ${CARD[c] || ('챔프' + c)}`;
};

const pct = (w, n) => n ? (w / n * 100).toFixed(1) + '%' : '–';
const bar = (v, max, w) => '█'.repeat(Math.max(0, Math.round(v / (max || 1) * w)));

(async () => {
  const res = await fetch(base.replace(/\/+$/, '') + '/s');
  if (!res.ok) { console.error('조회 실패:', res.status); process.exit(1); }
  const d = await res.json();

  // 최근 N일 필터용 날짜 목록
  const recent = new Set();
  if (DAYS > 0) {
    const t = Date.now();
    for (let i = 0; i < DAYS; i++) recent.add(new Date(t - i * 86400000).toISOString().slice(0, 10));
  }
  const dayOK = key => { const m = key.match(/^day:(\d{4}-\d{2}-\d{2}):/); return !DAYS || (m && recent.has(m[1])); };

  console.log('════════════════════════════════════════');
  console.log(' 리프트바운드 시뮬레이터 — 사용 통계');
  console.log(' ' + new Date().toISOString().slice(0, 10) + (DAYS ? `  (최근 ${DAYS}일)` : '  (전체 누적)'));
  console.log('════════════════════════════════════════\n');

  // ── 총 게임 수 ──
  const modes = ['bot', 'hotseat', 'p2p', 'online'];
  console.log('■ 게임 수');
  let grand = 0;
  for (const m of modes) {
    if (ONLY && m !== ONLY) continue;
    const start = DAYS
      ? Object.entries(d).filter(([k]) => dayOK(k) && k.endsWith(':start:' + m)).reduce((s, [, v]) => s + v, 0)
      : (d[`total:start:${m}`] || 0);
    const ends = Object.entries(d).filter(([k]) => k.startsWith(`total:end:${m}:`));
    const done = ends.reduce((s, [, v]) => s + v, 0);
    const sur  = (d[`total:end:${m}:surrender`] || 0) + (d[`total:end:${m}:left`] || 0);
    const cnt  = d[`total:turncnt:${m}`] || 0, sum = d[`total:turnsum:${m}`] || 0;
    grand += start;
    const label = { bot:'봇전', hotseat:'핫시트', p2p:'친구 대전', online:'서버 대전' }[m];
    console.log(`  ${label.padEnd(6)} 시작 ${String(start).padStart(5)}판 · 종료 ${String(done).padStart(5)}판`
      + ` · 중도이탈 ${pct(sur, done).padStart(6)} · 평균 ${cnt ? (sum / cnt).toFixed(1) : '–'}턴`);
  }
  console.log(`  ${'합계'.padEnd(6)} ${grand}판\n`);

  // ── 일별 접속자 ──
  const days = Object.entries(d).filter(([k]) => /^day:\d{4}-\d{2}-\d{2}:active$/.test(k))
    .map(([k, v]) => [k.slice(4, 14), v]).sort();
  if (days.length) {
    const show = DAYS ? days.filter(([dd]) => recent.has(dd)) : days.slice(-14);
    const max = Math.max(...show.map(x => x[1]));
    console.log('■ 앱을 켠 사람 (하루 1회 · 익명 집계)');
    for (const [dd, v] of show) console.log(`  ${dd}  ${String(v).padStart(4)}  ${bar(v, max, 28)}`);
    console.log();
  }

  // ── 덱별 승률 ──
  const deck = {};
  for (const [k, v] of Object.entries(d)) {
    const m = k.match(/^deck:([a-z0-9]+):([\d-]+):(games|wins)$/);
    if (!m) continue;
    if (ONLY && m[1] !== ONLY) continue;
    (deck[m[2]] = deck[m[2]] || { games: 0, wins: 0 })[m[3]] += v;
  }
  const decks = Object.entries(deck).filter(([, s]) => s.games >= MIN).sort((a, b) => b[1].games - a[1].games);
  if (decks.length) {
    console.log(`■ 덱별 승률 (${MIN}판 이상)`);
    for (const [key, s] of decks)
      console.log(`  ${pct(s.wins, s.games).padStart(6)}  ${String(s.games).padStart(4)}판   ${deckName(key)}`);
    console.log();
  }

  // ── 매치업 승률 ──
  const mu = {};
  for (const [k, v] of Object.entries(d)) {
    const m = k.match(/^mu:([a-z0-9]+):([\d-]+)\|([\d-]+):(games|lowin)$/);
    if (!m) continue;
    if (ONLY && m[1] !== ONLY) continue;
    const id = m[2] + '|' + m[3];
    (mu[id] = mu[id] || { games: 0, lowin: 0, lo: m[2], hi: m[3] })[m[4]] += v;
  }
  const rows = Object.values(mu).filter(x => x.games >= MIN).sort((a, b) => b.games - a.games);
  if (rows.length) {
    console.log(`■ 매치업 승률 (${MIN}판 이상 · 앞쪽 덱 기준)`);
    for (const r of rows)
      console.log(`  ${pct(r.lowin, r.games).padStart(6)}  ${String(r.games).padStart(4)}판   ${deckName(r.lo)}  vs  ${deckName(r.hi)}`);
    console.log();
  } else {
    console.log(`■ 매치업 승률 — 표본 ${MIN}판 이상인 조합이 아직 없습니다.\n`);
  }

  // ── 버전 분포 ──
  const vers = Object.entries(d).filter(([k]) => /^ver:.+:active$/.test(k))
    .map(([k, v]) => [k.slice(4, -7), v]).sort((a, b) => b[1] - a[1]);
  if (vers.length) {
    console.log('■ 버전 분포 (앱을 켠 횟수 기준)');
    for (const [v, n] of vers) console.log(`  ${v.padEnd(8)} ${n}`);
  }
})().catch(e => { console.error('오류:', e.message); process.exit(1); });
