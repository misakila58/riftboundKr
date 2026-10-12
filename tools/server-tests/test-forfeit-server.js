// 등급전 시작 단계 무응답 → 무응답 쪽 패배 (2026-10-12). node tools/server-tests/test-forfeit-server.js
'use strict';
const H = require('./harness')('forfeit', 8411);
(async () => {
  await H.startServer();
  const A = await H.client('tokA'), B = await H.client('tokB');
  A.send({ t: 'rankQueue', format: 'bo1', deck: H.DA, ver: 'test' }); B.send({ t: 'rankQueue', format: 'bo1', deck: H.DB, ver: 'test' });
  const sa = await A.wait(m => m.t === 'start', 8000); await B.wait(m => m.t === 'start', 8000);
  // A만 응답(행동), B는 아무것도 안 함 → 1.5초(테스트 env VOID_IDLE) 뒤 A가 voidMatch
  A.send({ t: 'act', action: { k: 'playmat', p: sa.yourSeat } });   // playmat은 lastAct 갱신에서 제외 — 그래도 B는 무응답
  await H.sleep(1800);
  A.send({ t: 'voidMatch' });
  const va = await A.wait(m => m.t === 'matchVoided', 4000), vb = await B.wait(m => m.t === 'matchVoided', 4000);
  H.ok('① 요청자: 무응답 승리 안내(forfeit·won)', va.forfeit === true && va.won === true && va.byMe === true, JSON.stringify(va));
  H.ok('① 무응답 쪽: 패배 안내', vb.forfeit === true && vb.won === false, JSON.stringify(vb));
  const ra = A.inbox.find(m => m.t === 'rankUpdate'), rb = B.inbox.find(m => m.t === 'rankUpdate');
  H.ok('① 등급 반영: 요청자 승·무응답 패', ra && ra.win === true && rb && rb.win === false && /무응답/.test(ra.how), JSON.stringify([ra && ra.how, rb && rb.win]));
  const M = H.fs.readFileSync(H.path.join(H.DIR, 'data', 'rank-matches.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  H.ok('① 매치 기록: 승자 t1', M.length === 1 && M[0].winner.id === 't1' && /무응답/.test(M[0].how), M[0] && M[0].how);
  // ② 상대가 방금 응답했으면 거부
  const A2 = await H.client('tokA'), B2 = await H.client('tokB');
  A2.send({ t: 'rankQueue', format: 'bo1', deck: H.DA, ver: 'test' }); B2.send({ t: 'rankQueue', format: 'bo1', deck: H.DB, ver: 'test' });
  const s2 = await A2.wait(m => m.t === 'start', 8000); const s2b = await B2.wait(m => m.t === 'start', 8000);
  B2.send({ t: 'act', action: { k: 'endTurn', p: s2b.yourSeat } }); await H.sleep(200);
  A2.send({ t: 'voidMatch' });
  const err = await A2.wait(m => m.t === 'err', 3000).catch(() => null);
  H.ok('② 이미 진행된(턴 종료 있음) 경기는 거부', !!err && /진행/.test(err.msg), JSON.stringify(err));
  await H.done();
})().catch(H.crash);
