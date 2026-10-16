// 일반 온라인 방 재접속 시간 제한 없음 (2026-10-16) — 등급전은 유예 그대로. node tools/server-tests/test-rejoin-nolimit-server.js
// 하네스 env: 등급전 유예 3초(RB_REJOIN_GRACE_MS), 양쪽 미접속 방 종료 2.5초(RB_ROOM_ABANDON_MS)
'use strict';
const H = require('./harness')('rejoin-nolimit', 8413, { RB_ROOM_ABANDON_MS: '2500' });
const VER = 'test';
let roomN = 0;
async function casualRoom(A, B) {   // 방 이름을 매번 다르게 — 같은 클라이언트의 inbox에 남은 옛 roomCreated와 구분
  const name = 'c' + (roomN++);
  A.send({ t: 'createRoom', deck: H.DA, name, ver: VER });
  const rc = await A.wait(m => m.t === 'roomCreated' && m.room.name === name, 4000);
  B.send({ t: 'joinRoom', roomId: rc.room.id, deck: H.DB, ver: VER });
  const sa = await A.wait(m => m.t === 'start', 8000), sb = await B.wait(m => m.t === 'start', 8000);
  B.send({ t: 'act', action: { k: 'endTurn', p: sb.yourSeat } }); await H.sleep(150);
  return { sa, sb, roomId: rc.room.id };
}
(async () => {
  await H.startServer();
  // ① 일반 방: A 끊김 → B에 시간 제한 없음 안내, 등급전 유예(3초)가 지난 뒤에도 복귀 가능
  let A = await H.client('tokA'), B = await H.client('tokB');
  const g1 = await casualRoom(A, B);
  A.close();
  const away = await B.wait(m => m.t === 'opponentAway', 3000);
  H.ok('① 상대에게 opponentAway(noLimit, graceMs 0)', away.noLimit === true && away.graceMs === 0, JSON.stringify(away));
  await H.sleep(4200);
  H.ok('① 유예 3초가 지나도 opponentLeft 없음', !B.inbox.some(m => m.t === 'opponentLeft'));
  let A2 = await H.client('tokA'); A2.send({ t: 'rejoin' });
  const st = await A2.wait(m => m.t === 'start', 3000).catch(() => null);
  await A2.wait(m => m.t === 'rejoinDone', 3000).catch(() => null);
  H.ok('① 4초 뒤 복귀 성공(start rejoin, 같은 좌석·시드)', !!st && st.rejoin === true && st.yourSeat === g1.sa.yourSeat && st.seed === g1.sa.seed, JSON.stringify(st && [st.rejoin, st.yourSeat]));
  H.ok('① 상대에게 opponentBack', !!(await B.wait(m => m.t === 'opponentBack', 2000).catch(() => null)));
  // ② 둘 다 끊김 → 2.5초(ROOM_ABANDON_MS) 뒤 방 종료 → 복귀 불가
  A2.close(); B.close(); await H.sleep(3500);
  let A3 = await H.client('tokA'); A3.send({ t: 'rejoin' });
  const none = await A3.wait(m => m.t === 'rejoinNone', 3000).catch(() => null);
  H.ok('② 양쪽 미접속 방은 ROOM_ABANDON_MS 뒤 종료 → rejoinNone', !!none);
  // ③ 둘 다 끊겼다가 한쪽이 제한 시간 안에 돌아오면 방 유지 → 다른 쪽도 나중에 복귀
  let B3 = await H.client('tokB');
  const g3 = await casualRoom(A3, B3);
  A3.close(); B3.close(); await H.sleep(1200);
  let B4 = await H.client('tokB'); B4.send({ t: 'rejoin' });
  const stB = await B4.wait(m => m.t === 'start', 3000).catch(() => null); await B4.wait(m => m.t === 'rejoinDone', 3000).catch(() => null);
  H.ok('③ 한쪽 복귀(방 유지)', !!stB && stB.rejoin === true && stB.seed === g3.sb.seed);
  await H.sleep(3200);   // 방 종료 타이머(2.5초)가 복귀로 취소됐는지
  let A4 = await H.client('tokA'); A4.send({ t: 'rejoin' });
  const stA = await A4.wait(m => m.t === 'start', 3000).catch(() => null); await A4.wait(m => m.t === 'rejoinDone', 3000).catch(() => null);
  H.ok('③ 다른 쪽도 시간 제한 없이 복귀', !!stA && stA.rejoin === true && stA.seed === g3.sa.seed, JSON.stringify(stA && stA.rejoin));
  // ④ A 유예 중에 A가 새 방을 만들면 옛 방은 떠난 것 — 기다리던 B4에 opponentLeft
  A4.close(); await B4.wait(m => m.t === 'opponentAway' && m.noLimit, 3000);
  let A5 = await H.client('tokA'); A5.send({ t: 'createRoom', deck: H.DA, name: 'new', ver: VER });
  const rc5 = await A5.wait(m => m.t === 'roomCreated', 3000).catch(() => null);
  const left = await B4.wait(m => m.t === 'opponentLeft', 3000).catch(() => null);
  H.ok('④ 유예 중 새 방 만들기 → 옛 방 상대에게 opponentLeft, 새 방 생성', !!rc5 && !!left);
  A5.send({ t: 'leaveRoom' }); await H.sleep(100);
  // ⑤ A 유예 중 B가 나가면 A는 복귀 불가(rejoinNone)
  B4.send({ t: 'leaveRoom' }); await H.sleep(100);
  let B5 = await H.client('tokB');
  const g5 = await casualRoom(A5, B5);
  A5.close(); await B5.wait(m => m.t === 'opponentAway', 3000);
  B5.send({ t: 'leaveRoom' }); await H.sleep(200);
  let A6 = await H.client('tokA'); A6.send({ t: 'rejoin' });
  H.ok('⑤ 상대가 나간 방엔 복귀 불가(rejoinNone)', !!(await A6.wait(m => m.t === 'rejoinNone', 3000).catch(() => null)), g5.roomId);
  // ⑥ 등급전은 그대로: 3초 유예 뒤 이탈 → 상대에게 opponentLeft, 복귀 불가
  B5.send({ t: 'leaveRoom' }); A6.close(); B5.close(); await H.sleep(100);
  A6 = await H.client('tokA'); B5 = await H.client('tokB');   // 새 클라이언트(inbox의 옛 start와 구분)
  A6.send({ t: 'rankQueue', format: 'bo1', deck: H.DA, ver: VER }); B5.send({ t: 'rankQueue', format: 'bo1', deck: H.DB, ver: VER });
  const sa6 = await A6.wait(m => m.t === 'start', 8000); const sb6 = await B5.wait(m => m.t === 'start', 8000);
  B5.send({ t: 'act', action: { k: 'endTurn', p: sb6.yourSeat } }); await H.sleep(150);
  A6.close();
  const away6 = await B5.wait(m => m.t === 'opponentAway', 3000);
  H.ok('⑥ 등급전: 유예 3초 안내(noLimit 아님)', !away6.noLimit && away6.graceMs === 3000, JSON.stringify(away6));
  const left6 = await B5.wait(m => m.t === 'opponentLeft', 6000).catch(() => null);
  H.ok('⑥ 등급전: 유예 만료 → opponentLeft', !!left6);
  let A7 = await H.client('tokA'); A7.send({ t: 'rejoin' });
  H.ok('⑥ 등급전: 만료 뒤 복귀 불가(rejoinNone)', !!(await A7.wait(m => m.t === 'rejoinNone', 3000).catch(() => null)), sa6.yourSeat);
  await H.done();
})().catch(H.crash);
