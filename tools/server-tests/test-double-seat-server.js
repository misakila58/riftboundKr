// 진행 중 등급전이 있는 계정의 새 접속이 등급전 참가·방 만들기·입장을 시도하면 새 매칭 대신 그 경기로 복귀 (2026-10-13). node tools/server-tests/test-double-seat-server.js
'use strict';
const H = require('./harness')('double-seat', 8412);
(async () => {
  await H.startServer();
  const A = await H.client('tokA'), B = await H.client('tokB');
  A.send({ t: 'rankQueue', format: 'bo1', deck: H.DA, ver: 'test' }); B.send({ t: 'rankQueue', format: 'bo1', deck: H.DB, ver: 'test' });
  const sa = await A.wait(m => m.t === 'start', 8000); await B.wait(m => m.t === 'start', 8000);
  B.send({ t: 'act', action: { k: 'endTurn', p: 1 - sa.yourSeat } }); await H.sleep(100);
  // ① 같은 계정의 새 접속 — 옛 좌석은 유예로 비고, 인증 직후 복귀 힌트
  const A2 = await H.client('tokA');
  const hint = await A2.wait(m => m.t === 'rejoinPending', 2000).catch(() => null);
  H.ok('① 인증 직후 rejoinPending 힌트', !!hint && hint.ranked === true, JSON.stringify(hint));
  // ② 새 접속이 등급전 참가 → 새 매칭 대신 복귀(start rejoin, 같은 좌석)
  A2.send({ t: 'rankQueue', format: 'bo1', deck: H.DA, ver: 'test' });
  const err = await A2.wait(m => m.t === 'err', 2000).catch(() => null);
  const st = await A2.wait(m => m.t === 'start', 2000).catch(() => null);
  await A2.wait(m => m.t === 'rejoinDone', 2000).catch(() => null);
  H.ok('② 참가 거부 안내', !!err && /복귀/.test(err.msg), JSON.stringify(err));
  H.ok('② 같은 경기로 복귀(start rejoin, 같은 좌석·시드)', !!st && st.rejoin === true && st.yourSeat === sa.yourSeat && st.seed === sa.seed, JSON.stringify(st && [st.rejoin, st.yourSeat, sa.yourSeat]));
  H.ok('② 대기열에 들어가지 않음', !A2.inbox.some(m => m.t === 'rankQueued'));
  H.ok('② 상대에게 opponentBack', !!(await B.wait(m => m.t === 'opponentBack', 2000).catch(() => null)));
  // ③ 또 다른 새 접속이 방 만들기 → 복귀
  const A3 = await H.client('tokA'); await H.sleep(100);
  A3.send({ t: 'createRoom', deck: H.DA, name: 'x' });
  const st3 = await A3.wait(m => m.t === 'start', 2000).catch(() => null);
  H.ok('③ 방 만들기 대신 복귀', !!st3 && st3.rejoin === true && st3.yourSeat === sa.yourSeat, JSON.stringify(st3 && st3.yourSeat));
  // ④ 또 다른 새 접속이 입장 → 복귀
  const A4 = await H.client('tokA'); await H.sleep(100);
  A4.send({ t: 'joinRoom', roomId: 'r0', deck: H.DA });
  const st4 = await A4.wait(m => m.t === 'start', 2000).catch(() => null);
  H.ok('④ 입장 대신 복귀', !!st4 && st4.rejoin === true, JSON.stringify(st4 && st4.yourSeat));
  // ⑤ 복귀한 접속은 경기를 이어서 둘 수 있고(행동이 상대에게 전달), 옛 접속(A3)의 행동은 무시
  A4.send({ t: 'act', action: { k: 'playmat', p: sa.yourSeat } });
  const relayed = await B.wait(m => m.t === 'act' && m.from === 't1' && m.action && m.action.k === 'playmat', 2000).catch(() => null);
  H.ok('⑤ 복귀 접속의 행동이 상대에게 전달', !!relayed);
  await H.done();
})().catch(H.crash);
