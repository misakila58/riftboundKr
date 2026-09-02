// BOT_W 자동 튜닝 (SPSA) — 평가 가중치를 셀프플레이 승률로 최적화한다.
// 사용: node tools/tune-spsa.js [--iters 24] [--games 200] [--out tools/data/spsa-log.json]
// 목적 함수 f(W) = A(W) 대 B(기본 가중치) 승률. SPSA는 반복마다 W±cΔ 두 번만 평가해
// 전 파라미터의 기울기를 추정한다 (노이즈에 강해 셀프플레이 튜닝의 표준 기법).
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const ITERS = +arg('--iters', 24);
const GAMES = +arg('--games', 200);
const OUT = arg('--out', path.join(__dirname, 'data', 'spsa-log.json'));

// 튜닝 대상 (point=1.0은 스케일 앵커로 고정, finalRule은 불리언이라 제외)
const W0 = {
  control: 0.85, bfMargin: 0.35, card: 0.22, cardGlut: 0.10, rune: 0.04, runeDeck: 0.05,
  unitBase: 0.20, unitBf: 0.30, buff: 0.20, hidden: 0.30, champReady: 0.25, legendReady: 0.15,
  nearWinBonus: 0.60, playCost: 1.00, moveNeed: 0.02, sdMargin: 2, peekTrick: 0.25, peekBold: -0.12,
};
const KEYS = Object.keys(W0);

function wStr(W) { return KEYS.map(k => `${k}=${+W[k].toFixed(4)}`).join(','); }

function evalW(W, games, seed) {
  const out = execFileSync('node', [path.join(__dirname, 'selfplay.js'),
    '--games', String(games), '--mirror', '--seed', String(seed), '--w', wStr(W)],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const j = JSON.parse(out.slice(out.indexOf('{')));
  return j['A승률%'];
}

(function main() {
  let W = { ...W0 };
  const log = { started: new Date().toISOString(), iters: [] };
  console.log(`SPSA 시작 — ${ITERS}회 반복, 평가당 ${GAMES}판×2`);

  let rngState = 987654321;
  const rnd = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };

  for (let k = 1; k <= ITERS; k++) {
    const a = 0.20 / Math.pow(k, 0.35);     // 스텝 (상대 비율)
    const c = 0.15 / Math.pow(k, 0.12);     // 섭동 (상대 비율)
    const delta = {}; KEYS.forEach(key => delta[key] = rnd() < 0.5 ? -1 : 1);
    const scale = key => Math.max(Math.abs(W[key]), 0.02);   // 0 근처 파라미터도 움직이게
    const Wp = {}, Wm = {};
    KEYS.forEach(key => {
      Wp[key] = W[key] + c * scale(key) * delta[key];
      Wm[key] = W[key] - c * scale(key) * delta[key];
    });
    const seed = 20260828 + k * 7919;
    const fp = evalW(Wp, GAMES, seed);
    const fm = evalW(Wm, GAMES, seed);      // 같은 시드 = 공통 난수로 분산 감소
    const g = (fp - fm) / 100;              // 승률 차 (비율)
    KEYS.forEach(key => { W[key] += a * scale(key) * g * delta[key] / (2 * c); });
    // 부호 보존형 클램프 (평가가 뒤집히는 발산 방지)
    KEYS.forEach(key => {
      const lo = W0[key] >= 0 ? 0 : W0[key] * 4;
      const hi = W0[key] >= 0 ? Math.max(W0[key] * 4, 0.2) : 0;
      W[key] = Math.min(hi, Math.max(lo, W[key]));
    });
    log.iters.push({ k, fp, fm, W: { ...W } });
    fs.writeFileSync(OUT, JSON.stringify(log, null, 1));
    console.log(`[${k}/${ITERS}] f(W+)=${fp}% f(W-)=${fm}% | ${KEYS.slice(0, 6).map(x => x + '=' + W[x].toFixed(3)).join(' ')}`);
  }

  // 최종 검증: 튜닝 가중치 vs 기본 (큰 판수)
  console.log('검증 대국 (1000판)…');
  const final = evalW(W, 1000, 20260901);
  log.final = { W, winrate: final };
  fs.writeFileSync(OUT, JSON.stringify(log, null, 1));
  console.log('튜닝 가중치 승률(대 기본):', final + '%');
  console.log('W_tuned =', JSON.stringify(W, null, 1));
})();
