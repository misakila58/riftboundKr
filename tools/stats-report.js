// ══════════ 익명 통계 주간 리포트 ══════════
// 게임 서버(/api/stats)의 집계를 읽어 사람이 볼 수 있게 정리한다.
//
//   node tools/stats-report.js https://riftboundsimkr.duckdns.org
//   node tools/stats-report.js <주소> --days 7        최근 7일만
//   node tools/stats-report.js <주소> --mode p2p      특정 모드만
//   node tools/stats-report.js <주소> --min 5         매치업 최소 표본 수 (기본 3)
//   node tools/stats-report.js <주소> --out <폴더>    리포트·원본·CSV를 파일로 저장
//
// 서버에는 집계 숫자만 있으므로 개인을 특정할 수 있는 정보는 나오지 않는다.
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const base = argv.find(a => /^https?:\/\//.test(a));
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if (!base) {
  console.error('사용법: node tools/stats-report.js <서버 주소> [--days 7] [--mode p2p] [--min 3]');
  process.exit(1);
}
const OUT  = arg('--out', null);
// --out이면 화면에 찍는 내용을 그대로 파일에도 남긴다
const REPORT = [];
if (OUT) { const _log = console.log; console.log = (...a) => { REPORT.push(a.join(' ')); _log(...a); }; }
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
  const res = await fetch(base.replace(/\/+$/, '') + '/api/stats');
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

  // ── 파일로 내보내기 ──
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const modeKo = { bot:'봇전', hotseat:'핫시트', p2p:'친구 대전', online:'서버 대전' };
    // 엑셀이 한글을 깨뜨리지 않도록 BOM을 붙인다
    const csv = rows => '\uFEFF' + rows.map(r => r.map(c => {
      const v = String(c ?? '');
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(',')).join('\r\n') + '\r\n';
    const made = [];
    const write = (name, body) => {
      const f = path.join(OUT, name);
      fs.writeFileSync(f, body);
      made.push(`  ${name}  (${(fs.statSync(f).size / 1024).toFixed(1)}KB)`);
    };

    write(`통계-리포트-${stamp}.txt`, '\uFEFF' + REPORT.join('\r\n') + '\r\n');
    write(`통계-원본-${stamp}.json`, JSON.stringify(d, null, 1));

    // 게임 수 (모드별 누적)
    write(`통계-게임수-${stamp}.csv`, csv([
      ['모드', '시작', '종료', '항복', '상대이탈', '평균턴'],
      ...modes.map(m => {
        const done = Object.entries(d).filter(([k]) => k.startsWith(`total:end:${m}:`)).reduce((s2, [, v]) => s2 + v, 0);
        const cnt = d[`total:turncnt:${m}`] || 0, sum = d[`total:turnsum:${m}`] || 0;
        return [modeKo[m] || m, d[`total:start:${m}`] || 0, done,
          d[`total:end:${m}:surrender`] || 0, d[`total:end:${m}:left`] || 0,
          cnt ? (sum / cnt).toFixed(1) : ''];
      }),
    ]));

    // 덱별 승률 (표본 수 제한 없이 전부)
    write(`통계-덱별-${stamp}.csv`, csv([
      ['전설', '선발챔피언', '판수', '승', '승률%'],
      ...Object.entries(deck).sort((a, b) => b[1].games - a[1].games).map(([key, st]) => {
        const [l, c] = key.split('-').map(Number);
        return [CARD[l] || l, CARD[c] || c, st.games, st.wins,
          st.games ? (st.wins / st.games * 100).toFixed(1) : ''];
      }),
    ]));

    // 매치업 승률 (앞쪽 덱 기준)
    write(`통계-매치업-${stamp}.csv`, csv([
      ['덱A', '덱B', '판수', 'A승', 'A승률%'],
      ...Object.values(mu).sort((a, b) => b.games - a.games).map(r => [
        deckName(r.lo), deckName(r.hi), r.games, r.lowin,
        r.games ? (r.lowin / r.games * 100).toFixed(1) : '',
      ]),
    ]));

    // 일별 (접속 수 + 모드별 시작 판수)
    const allDays = [...new Set(Object.keys(d).map(k => (k.match(/^day:(\d{4}-\d{2}-\d{2}):/) || [])[1]).filter(Boolean))].sort();
    write(`통계-일별-${stamp}.csv`, csv([
      ['날짜', '앱실행', ...modes.map(m => (modeKo[m] || m) + ' 시작')],
      ...allDays.map(dd => [dd, d[`day:${dd}:active`] || 0, ...modes.map(m => d[`day:${dd}:start:${m}`] || 0)]),
    ]));

    console.log('\n■ 저장됨 → ' + OUT);
    made.forEach(l => process.stdout.write(l + '\n'));
  }
})().catch(e => { console.error('오류:', e.message); process.exit(1); });
