// 숨김 정보 2단계 — 실제 서버(WebSocket 중계 + 서버 오라클)로 한 판을 끝까지 둔다 (2026-10-15). node tools/server-tests/test-oracle-server.js
// 두뇌(모든 것을 아는 봇 엔진)가 기록한 행동·선택을 두 화면 엔진(비공개 시드 없음)이 서버를 통해 주고받고, 공개는 서버 오라클이 보낸다.
// 확인: ① start에 시드 없음·상대 메인 가림 ② 설정 단계(주사위·사이드덱·멀리건) 통과 ③ 매 행동 뒤 두 화면 공개 상태 같음·자기 손패 HID 없음·상대 손패/자기 덱 HID
//       ④ 재접속 로그에 주인 전용 공개가 좌석별로 가려져 있음 ⑤ 서버 기록(rooms.json)에 오라클 공개가 남음
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const H = require('./harness')('oracle', 8413);
const OL = require('../tests/oracle-lockstep.js');
const VER = '1.0.129';
const sleep = H.sleep;
(async () => {
  await H.startServer();
  const [dA, dB] = OL.mkDecks(5).map((d, i) => ({ name: 'T' + i, ...d }));   // 서버 덱 검증은 이름이 필요하다
  const A = await H.client('tokA'), B = await H.client('tokB');
  A.send({ t: 'createRoom', deck: dA, name: 'oracle', manual: false, banRule: false, turnTimer: false, undo: false, format: 'bo3', ver: VER });   // Bo3: 전장 선택·2게임 재대결까지
  const rc = await A.wait(m => m.t === 'roomCreated', 4000);
  B.send({ t: 'joinRoom', roomId: rc.room.id, deck: dB, ver: VER });
  const sa = await A.wait(m => m.t === 'start', 8000), sb = await B.wait(m => m.t === 'start', 8000);
  H.ok('① start: oracle 플래그·비공개 시드 없음', sa.oracle === true && JSON.stringify(sa.priv) === '[null,null]' && sb.oracle === true && JSON.stringify(sb.priv) === '[null,null]', JSON.stringify([sa.oracle, sa.priv, sb.priv]));
  H.ok('① start: 상대 메인 40장 가림, 내 메인은 그대로', sa.players[1].deck.main.every(n => n === -1) && sa.players[0].deck.main.length === 40 && !sa.players[0].deck.main.includes(-1)
    && sb.players[0].deck.main.every(n => n === -1) && !sb.players[1].deck.main.includes(-1), JSON.stringify([sa.players[1].deck.main.slice(0, 3), sb.players[0].deck.main.slice(0, 3)]));
  // 서버만 아는 비공개 시드(rooms.json) → 두뇌가 같은 셔플로 기록을 만든다
  await sleep(900);
  const saved = JSON.parse(H.fs.readFileSync(H.path.join(H.DIR, 'data', 'rooms.json'), 'utf8'));
  const room = saved.find(r => r.id === rc.room.id);
  H.ok('⑤ rooms.json: 오라클 모드·시드 저장', room && room.oracleMode === true && Array.isArray(room.priv) && room.priv.every(x => x > 0), JSON.stringify(room && [room.oracleMode, room.priv]));
  const cfg = { seed: sa.seed, priv: room.priv, format: 'bo3', manual: false, banRule: false, undo: false, match: null,
    players: [{ id: sa.players[0].id, deck: dA }, { id: sa.players[1].id, deck: dB }] };
  const Bn = OL.makeCtx('brain'); Bn.__cfg = cfg;
  await vm.runInContext('__drive(__cfg, 30)', Bn);
  const REC = Bn.REC;
  const acts = REC.map((r, i) => [r, i]).filter(([r]) => r.t === 'act');
  // 화면 둘 — 서버 소켓으로 잇는다
  const V = [OL.makeCtx('view'), OL.makeCtx('view')], socks = [A, B], chain = [Promise.resolve(), Promise.resolve()], errs = [];
  const starts = [sa, sb];
  const attach = (s, sock, catching) => {   // 화면 s를 소켓에 잇는다. catching: rejoinDone이 올 때까지 로그 재생 메시지를 무시(화면은 이미 그 상태)
    socks[s] = sock;
    V[s].__send = m => socks[s].send({ t: 'choice', id: m.id, data: m.data });
    let skip = !!catching;
    sock.ws.on('message', d => {
      const m = JSON.parse(d);
      if (m.t === 'rejoinDone') { skip = false; return; }
      if (skip) return;
      if (m.t === 'choice') { V[s].__m = m; vm.runInContext('__recv(__m)', V[s]); }
      else if (m.t === 'act' && m.action && m.action.k !== 'playmat') { chain[s] = chain[s].then(() => { V[s].__a = m.action; return vm.runInContext('execAct(__a)', V[s]); }).catch(e => errs.push(`view${s}: ` + (e && e.stack || e))); }
    });
  };
  for (const s of [0, 1]) {
    V[s].REC = REC; V[s].PTR = 0; vm.runInContext(`NET.seat=${s}; SEAT=${s};`, V[s]);
    attach(s, socks[s], false);
    V[s].__cfg = { seed: starts[s].seed, priv: [null, null], format: 'bo3', match: null, players: starts[s].players.map(pl => ({ id: pl.id, deck: pl.deck })) };
  }
  const settled = async (ms = 8000) => {   // 두 화면이 선택 대기 없이 멈추고 행동 체인이 끝날 때까지
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await Promise.race([Promise.all(chain), sleep(60)]);
      await sleep(40);
      const pend = V.map(c => +vm.runInContext('Object.keys(pending).length', c));
      if (pend.every(n => n === 0) && !errs.length) { await sleep(60); const again = V.map(c => +vm.runInContext('Object.keys(pending).length', c)); if (again.every(n => n === 0)) return true; }
      if (errs.length) return false;
    }
    return false;
  };
  const timeout = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error('시간 초과: ' + what); })]);
  try { await timeout(Promise.all(V.map(c => vm.runInContext('__start(__cfg)', c))), 15000, '시작 단계'); }
  catch (e) { H.ok('② 시작 단계(주사위·사이드덱·멀리건·첫 턴) 완료', false, String(e && e.stack || e).slice(0, 400)); await H.done(); return; }
  const dg0 = V.map(c => vm.runInContext('digest()', c));
  H.ok('② 시작 단계 완료 · 두 화면 공개 상태 같음', dg0[0] === dg0[1] && /"phase":"action"/.test(dg0[0]), dg0[0].slice(0, 200) + ' / ' + dg0[1].slice(0, 200));
  H.ok('② 자기 손패는 모두 알고(HID 없음), 상대 손패·상대 덱 목록은 HID', [0, 1].every(s => +vm.runInContext(`G.players[${s}].hand.filter(n=>n===HID).length`, V[s]) === 0
    && +vm.runInContext(`G.players[${1 - s}].hand.filter(n=>n!==HID).length`, V[s]) === 0 && vm.runInContext(`G.players[${1 - s}].deckList.every(n=>n===HID)`, V[s]) === true
    && vm.runInContext(`G.players[${s}].deck.every(n=>n===HID)`, V[s]) === true),
    V.map((c, s) => vm.runInContext(`JSON.stringify({my:G.players[${s}].hand, opp:G.players[${1 - s}].hand, deckKnown:G.players[${s}].deck.filter(n=>n!==HID).length})`, c)).join(' | '));
  // ③ 행동 재생: 행동 좌석의 소켓으로 보내고 두 화면이 에코를 실행한다
  let bad = null, played = 0;
  const replay = async (acts, REC, limit) => { bad = null; played = 0; for (let k = 0; k < acts.length && !bad; k++) {
    const [rec, idx] = acts[k];
    for (const s of [0, 1]) { if (V[s].PTR !== idx) { bad = `view${s} act#${k} 시작 기록 위치 ${V[s].PTR} ≠ ${idx} ${JSON.stringify(REC[V[s].PTR]).slice(0, 160)}`; break; } V[s].PTR = idx + 1; }
    if (bad) break;
    socks[rec.a.p ?? 0].send({ t: 'act', action: rec.a });
    const ok = await settled();
    if (!ok) { bad = `act#${k} ${JSON.stringify(rec.a).slice(0, 120)}: ${errs.length ? errs[0].slice(0, 300) : '대기 시간 초과 — 선택 응답 없음 (화면 pending ' + V.map(c => vm.runInContext('JSON.stringify(Object.keys(pending))', c)).join('/') + ')'}`; break; }
    const next = k + 1 < acts.length ? acts[k + 1][1] : REC.length;
    for (const s of [0, 1]) if (V[s].PTR !== next) { bad = `view${s} act#${k} 끝 기록 위치 ${V[s].PTR} ≠ ${next} — 다음 ${JSON.stringify(REC[V[s].PTR]).slice(0, 160)}`; }
    if (bad) break;
    const dg = V.map(c => vm.runInContext('digest()', c));
    if (dg[0] !== dg[1]) { bad = `act#${k} 뒤 두 화면 공개 상태 다름\n  v0 ${dg[0].slice(0, 400)}\n  v1 ${dg[1].slice(0, 400)}`; break; }
    for (const s of [0, 1]) {
      const hid = +vm.runInContext(`G.players[${s}].hand.filter(n=>n===HID).length`, V[s]);
      const oppKnown = +vm.runInContext(`G.players[${1 - s}].hand.filter(n=>n!==HID).length`, V[s]);
      const deckKnown = +vm.runInContext(`G.players[${s}].deck.filter(n=>n!==HID).length`, V[s]);
      if (hid) { bad = `act#${k} 좌석${s} 자기 손패에 HID ${hid}장`; break; }
      if (oppKnown) {   // 상대 손패 중 아는 카드는 오라클이 그 좌석에 공개한 것(손패 공개 효과 등)뿐이어야 한다
        const revealed = new Set(); socks[s].inbox.forEach(m => { if (m.t === 'choice' && m.from === 'oracle' && m.seat === 1 - s && Array.isArray(m.data)) m.data.forEach(n => revealed.add(n)); });
        const known = JSON.parse(vm.runInContext(`JSON.stringify(G.players[${1 - s}].hand.filter(n=>n!==HID))`, V[s]));
        if (!known.every(n => revealed.has(n))) { bad = `act#${k} 좌석${s} 상대 손패를 공개 없이 앎 (누설): ${JSON.stringify(known)} / 공개된 것 ${JSON.stringify([...revealed])}`; break; }
      }
      if (deckKnown > 5) { bad = `act#${k} 좌석${s} 자기 덱을 ${deckKnown}장 앎 (순서 누설)`; break; }
    }
    played++;
    if (played >= limit && vm.runInContext('G.winner', V[0]) === null) break;
  } };
  await replay(acts, REC, 25);
  H.ok(`③ 1게임 행동 ${played}개를 서버 중계·오라클 공개로 재생 — 두 화면 일치·누설 없음`, !bad, bad || '');
  // ⑥ Bo3 2게임: 사이드보딩 덱을 rematch로 보내고(상대에겐 가려짐) 방장이 rematchGo — 서버가 각자 보낸 덱·새 시드·새 비공개 시드를 싣는다
  const used = [[+vm.runInContext('G.bfs[0].n', V[0])], [+vm.runInContext('G.bfs[1].n', V[0])]];
  A.send({ t: 'act', action: { k: 'rematch', p: 0, deck: dA } });
  B.send({ t: 'act', action: { k: 'rematch', p: 1, deck: dB } });
  const rmB = await A.wait(m => m.t === 'act' && m.action.k === 'rematch' && m.seat === 1, 4000).catch(() => null);
  const rmA = await B.wait(m => m.t === 'act' && m.action.k === 'rematch' && m.seat === 0, 4000).catch(() => null);
  H.ok('⑥ rematch 에코: 상대가 보낸 덱의 메인은 가려지고 내 것은 그대로', !!rmB && rmB.action.deck.main.every(n => n === -1) && !!rmA && rmA.action.deck.main.every(n => n === -1)
    && A.inbox.some(m => m.t === 'act' && m.action.k === 'rematch' && m.seat === 0 && !m.action.deck.main.includes(-1)), JSON.stringify([rmB && rmB.action.deck.main.slice(0, 3), rmA && rmA.action.deck.main.slice(0, 3)]));
  const match2 = { format: 'bo3', wins: [1, 0], game: 2, used, chooser: 1 };
  A.send({ t: 'act', action: { k: 'rematchGo', p: 0, seed: 7, decks: [dA, rmB.action.deck], pregame: false, match: match2 } });
  const goA = await A.wait(m => m.t === 'act' && m.action.k === 'rematchGo', 4000), goB = await B.wait(m => m.t === 'act' && m.action.k === 'rematchGo', 4000);
  H.ok('⑥ rematchGo 에코: 서버 시드·시드 없음·각자 자기 덱만 공개(방장이 보낸 가려진 상대 덱 대신 서버 보관 덱)', goA.action.seed !== 7 && JSON.stringify(goA.action.priv) === '[null,null]'
    && !goA.action.decks[0].main.includes(-1) && goA.action.decks[1].main.every(n => n === -1) && !goB.action.decks[1].main.includes(-1) && goB.action.decks[0].main.every(n => n === -1),
    JSON.stringify([goA.action.seed, goA.action.priv, goA.action.decks.map(d => d.main.slice(0, 2)), goB.action.decks.map(d => d.main.slice(0, 2))]));
  await sleep(900);
  const saved3 = JSON.parse(H.fs.readFileSync(H.path.join(H.DIR, 'data', 'rooms.json'), 'utf8'));
  const go = saved3.find(r => r.id === rc.room.id).log.find(o => o.t === 'act' && o.action.k === 'rematchGo');
  const cfg2 = { seed: goA.action.seed, priv: go.privAll, format: 'bo3', manual: false, banRule: false, undo: false, match: match2, players: [{ id: sa.players[0].id, deck: dA }, { id: sa.players[1].id, deck: dB }] };
  const Bn2 = OL.makeCtx('brain'); Bn2.__cfg = cfg2;
  await vm.runInContext('__drive(__cfg, 6)', Bn2);
  const REC2 = Bn2.REC, acts2 = REC2.map((r, i) => [r, i]).filter(([r]) => r.t === 'act');
  for (const s of [0, 1]) { V[s].REC = REC2; V[s].PTR = 0; V[s].__cfg = { seed: goA.action.seed, priv: [null, null], format: 'bo3', match: match2, players: [goA, goB][s].action.decks.map((d, i) => ({ id: sa.players[i].id, deck: d })) }; }
  try { await timeout(Promise.all(V.map(c => vm.runInContext('__start(__cfg)', c))), 15000, '2게임 시작 단계'); }
  catch (e) { H.ok('⑥ 2게임 시작(남은 전장 선택·이전 패자 선후공 선택·멀리건)', false, String(e && e.stack || e).slice(0, 400)); await H.done(); return; }
  const dg2 = V.map(c => vm.runInContext('digest()', c));
  H.ok('⑥ 2게임 시작 완료 · 두 화면 같음 · 이긴 게임 전장 제외', dg2[0] === dg2[1] && +vm.runInContext('G.bfs[0].n', V[0]) !== used[0][0] && vm.runInContext('G.firstPlayer', V[0]) !== null, dg2[0].slice(0, 160));
  await replay(acts2, REC2, 12);
  H.ok(`⑥ 2게임 행동 ${played}개 재생 — 두 화면 일치·누설 없음`, !bad, bad || '');
  // ⑦ 서버 재시작: rooms.json에서 방을 복원하고 오라클을 로그 재생으로 되살린 뒤, 양쪽이 재접속해 남은 행동을 이어 간다
  const doneActs = acts2.findIndex(([r, i]) => i >= V[0].PTR);   // 아직 안 한 행동부터
  await H.sleep(700);
  await H.stopServer();
  await H.startServer();
  const A3 = await H.client('tokA'), B3 = await H.client('tokB');
  attach(0, A3, true); attach(1, B3, true);
  A3.send({ t: 'rejoin' }); B3.send({ t: 'rejoin' });
  const ra = await A3.wait(m => m.t === 'rejoinDone', 8000).catch(() => null), rb = await B3.wait(m => m.t === 'rejoinDone', 8000).catch(() => null);
  H.ok('⑦ 재시작 뒤 양쪽 재접속(로그 재생 완료)', !!ra && !!rb, JSON.stringify([!!ra, !!rb, A3.inbox.map(m => m.t).slice(0, 6)]));
  const rest = acts2.slice(doneActs >= 0 ? doneActs : acts2.length);
  if (rest.length) {
    const before = played;
    await replay(rest, REC2, 8);
    H.ok(`⑦ 재시작 뒤 행동 ${played}개 이어서 재생 — 복원된 오라클이 공개를 보내고 두 화면 일치`, !bad && played > 0, bad || ('played ' + played));
  } else H.ok('⑦ 재시작 뒤 이어서 둘 행동이 남아 있음', false, '2게임 기록이 짧음');
  // ④ 재접속: B를 끊고 같은 계정으로 다시 붙어 로그를 받는다 — 주인 전용 공개가 좌석별로 가려져 있어야 한다
  const B2 = socks[1];   // 재시작 뒤 재접속한 소켓 — 로그 전체를 다시 받았다
  const st2 = B2.inbox.find(m => m.t === 'start' && m.rejoin);
  const oc = B2.inbox.filter(m => m.t === 'choice' && m.from === 'oracle');
  const mine = oc.filter(m => m.why === 'hand-sync' && m.seat === 1), theirs = oc.filter(m => m.why === 'hand-sync' && m.seat === 0);
  H.ok('④ 재접속 start: 시드 없음·상대 메인 가림', !!st2 && JSON.stringify(st2.priv) === '[null,null]' && st2.players[0].deck.main.every(n => n === -1), JSON.stringify(st2 && [st2.priv, st2.players[0].deck.main.slice(0, 2)]));
  H.ok('④ 재접속 로그: 내 손패 공개는 데이터가 있고 상대 손패 공개는 null', mine.length > 0 && mine.every(m => Array.isArray(m.data)) && theirs.length > 0 && theirs.every(m => m.data === null), JSON.stringify([mine.length, theirs.length, mine[0] && mine[0].data, theirs[0] && theirs[0].data]));
  const pub = oc.filter(m => m.why === 'play' || m.why === 'discard');
  H.ok('④ 공개(낸 카드)는 양쪽에 정체가 간다', pub.length === 0 || pub.every(m => Array.isArray(m.data) && m.data.every(n => n > 0)), JSON.stringify(pub.slice(0, 2)));
  await sleep(700);
  const saved2 = JSON.parse(H.fs.readFileSync(H.path.join(H.DIR, 'data', 'rooms.json'), 'utf8'));
  const room2 = saved2.find(r => r.id === rc.room.id);
  H.ok('⑤ rooms.json 로그에 오라클 공개(dataFor)가 남는다', !!room2 && room2.log.some(o => o.from === 'oracle' && Array.isArray(o.dataFor)), room2 && String(room2.log.length));
  await H.done();
})().catch(H.crash);
