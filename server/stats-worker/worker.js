// ══════════ 리프트바운드 시뮬레이터 — 익명 사용 통계 (Cloudflare Worker) ══════════
// 무엇을 하나: 게임이 몇 판 시작·종료됐는지, 어떤 덱 조합이 몇 승 몇 패인지 '숫자만' 센다.
//
// 무엇을 하지 않나 — 이 서버는 개인을 식별할 수 있는 것을 일절 저장하지 않는다.
//   · IP 주소를 기록하지 않는다 (아래에서 요청 헤더를 아예 읽지 않는다)
//   · 설치 ID·기기 ID·계정·닉네임을 받지 않는다 (받아도 저장할 필드가 없다)
//   · 개별 요청을 저장하지 않는다 — 도착 즉시 카운터에 +1 하고 버린다
//   · 시각은 날짜(YYYY-MM-DD)까지만 남긴다
// 따라서 저장되는 것은 "2026-09-03에 봇전이 12판 시작됐다" 같은 집계 숫자뿐이다.
//
// 배포: 같은 폴더의 README.md 참고.

const MAX_BODY = 2048;
const OK = (obj) => new Response(JSON.stringify(obj), {
  headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
});

// 오늘 날짜 (UTC 기준 YYYY-MM-DD) — 개별 시각은 남기지 않는다
const today = () => new Date().toISOString().slice(0, 10);

// 들어온 값이 우리가 아는 것인지 확인한다. 모르는 값은 통째로 버린다.
const MODES = ['bot', 'hotseat', 'p2p', 'online'];
const ENDS  = ['normal', 'surrender', 'left'];
const okInt = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

export class Stats {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const url = new URL(request.url);

    // ── 집계 조회 (공개) ──
    if (request.method === 'GET') {
      const all = await this.state.storage.list({ prefix: '' });
      const out = {};
      for (const [k, v] of all) out[k] = v;
      return OK(out);
    }

    // ── 이벤트 수신 ──
    if (request.method !== 'POST') return OK({ ok: true });
    let body;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY) return OK({ ok: true });
      body = JSON.parse(text);
    } catch (e) { return OK({ ok: true }); }
    if (!body || typeof body !== 'object') return OK({ ok: true });

    const d = today();
    const ver = typeof body.v === 'string' && /^[0-9.]{1,12}$/.test(body.v) ? body.v : 'unknown';
    const bump = async (key, by) => {
      const cur = (await this.state.storage.get(key)) || 0;
      await this.state.storage.put(key, cur + (by || 1));
    };

    if (body.ev === 'active_day') {
      // "오늘 이 앱을 처음 켰다" 신호. 누가 보냈는지는 알 수 없고, 개수만 센다.
      await bump(`day:${d}:active`);
      await bump(`ver:${ver}:active`);
      return OK({ ok: true });
    }

    if (body.ev === 'game_start') {
      const mode = MODES.includes(body.mode) ? body.mode : 'unknown';
      await bump(`day:${d}:start:${mode}`);
      await bump(`total:start:${mode}`);
      return OK({ ok: true });
    }

    if (body.ev === 'game_end') {
      const mode = MODES.includes(body.mode) ? body.mode : 'unknown';
      const end  = ENDS.includes(body.end) ? body.end : 'normal';
      await bump(`day:${d}:end:${mode}`);
      await bump(`total:end:${mode}:${end}`);
      // 게임 길이: 턴 수 구간별 (평균을 내려면 합계와 판수가 필요하다)
      if (okInt(body.turns, 500)) {
        await bump(`total:turnsum:${mode}`, body.turns);
        await bump(`total:turncnt:${mode}`);
      }
      // 덱 매치업: 전설·챔피언 번호만 (카드 번호는 공개 카드 정보라 개인정보가 아니다)
      const a = body.a, b = body.b;
      if (a && b && okInt(a.legend, 999) && okInt(a.champ, 999) && okInt(b.legend, 999) && okInt(b.champ, 999)
          && (body.winner === 0 || body.winner === 1)) {
        const key = (x) => `${x.legend}-${x.champ}`;
        const A = key(a), B = key(b);
        // 두 덱 조합을 정렬해 한 방향으로만 저장한다 (A대B와 B대A가 갈라지지 않게)
        const [lo, hi] = A <= B ? [A, B] : [B, A];
        const loWon = (A <= B) ? body.winner === 0 : body.winner === 1;
        await bump(`mu:${mode}:${lo}|${hi}:games`);
        if (loWon) await bump(`mu:${mode}:${lo}|${hi}:lowin`);
        await bump(`deck:${mode}:${A}:games`);
        await bump(`deck:${mode}:${B}:games`);
        await bump(`deck:${mode}:${body.winner === 0 ? A : B}:wins`);
      }
      return OK({ ok: true });
    }

    return OK({ ok: true });
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      }});
    }
    const url = new URL(request.url);
    if (url.pathname === '/e' || url.pathname === '/s') {
      // 단일 오브젝트에 모아 센다 (요청량이 적어 분산이 필요 없다)
      const id = env.STATS.idFromName('v1');
      return env.STATS.get(id).fetch(request);
    }
    return new Response('riftbound stats: ok', { status: 200 });
  },
};
