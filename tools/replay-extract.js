#!/usr/bin/env node
// 리플레이(.rbr) → 행동 목록. 스냅샷 방식 리플레이에는 "누가 무엇을 했나"가 없으므로 로그 줄에서 복원한다.
//   node tools/replay-extract.js <file.rbr> [--json out.json] [--quiet]
// 다른 도구(replay-analyze.js)는 require('./replay-extract.js')로 rpLoad/rpActions를 가져다 쓴다.
//
// 행동 종류: play(카드 플레이/체인 적재) · ability(능력 발동/적재) · move(유닛 이동) · hide(숨김) · reveal(숨김 공개)
//            · pass(결전 패스) · end(턴 종료) · mulligan · targets(직전 행동의 대상, 별도 행동 아님)
// 각 행동에는 그 직전 스냅샷 인덱스(stateBefore)가 붙는다 → 학습용 (상태, 행동) 쌍의 재료.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), vm = require('vm');

const JS = path.join(__dirname, '..', 'client', 'web', 'js');
let CARDS = null, CARD_BY_N = null;
function loadCards() {
  if (CARDS) return;
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'cards.js'), 'utf8') + ';this.C=CARDS;', ctx);
  CARDS = ctx.C; CARD_BY_N = {}; for (const c of CARDS) CARD_BY_N[c.n] = c;
}
function cardName(n) { loadCards(); const c = CARD_BY_N[n]; return c ? c.ko : `#${n}`; }

// .rbr 읽기 → { header, meta, result, frames, states(파싱된 객체 배열) }
function rpLoad(file) {
  const u = fs.readFileSync(file);
  if (u.toString('latin1', 0, 4) !== 'RBRP') throw new Error('리플레이 파일이 아닙니다: ' + file);
  const gz = u[5] === 1, hl = u.readUInt32LE(6);
  const header = JSON.parse(u.toString('utf8', 10, 10 + hl));
  let body = u.subarray(10 + hl);
  if (gz) body = zlib.gunzipSync(body);
  const d = JSON.parse(body.toString('utf8'));
  d.header = header;
  return d;
}

// 로그 줄 → 행동. 이름은 meta.players의 name과 대조한다 (봇전에서 사람은 '나' 또는 '플레이어 1').
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function rpActions(d) {
  const names = d.meta.players.map(p => p.name);
  const who = s => { const i = names.indexOf(s); return i >= 0 ? i : (names.findIndex(n => s.startsWith(n)) ); };
  const NM = '(' + names.map(esc).sort((a, b) => b.length - a.length).join('|') + ')';
  const R = {
    turn:    new RegExp('^━━ ' + NM + '의 턴 (\\d+) ━━'),
    play:    new RegExp('^' + NM + ' 「(.+?)」 플레이'),
    chain:   new RegExp('^🔗 ' + NM + ' 「(.+?)」 체인에 적재'),
    chainAb: new RegExp('^🔗 ' + NM + ' 능력 「(.+?)」 체인에 적재'),
    ability: new RegExp('^' + NM + ' 「(.+?)」 능력 발동'),
    move:    new RegExp('^' + NM + ' 유닛 (\\d+)개 (.+?)\\(으\\)로 이동'),
    hide:    new RegExp('^' + NM + ' (?:챔피언 존의 카드|카드)를 전장에 뒷면으로 숨김'),
    reveal:  new RegExp('^' + NM + ' 전장의 숨김 카드를 공개'),
    end:     new RegExp('^' + NM + ' 턴 종료'),
    pass:    new RegExp('^' + NM + ' 패스'),
    mull:    new RegExp('^' + NM + ' 멀리건: (\\d+)장'),
    targets: new RegExp('^🎯 ' + NM + ' 「(.+?)」 (?:대상 선택|대상 다시 선택): (.+)$'),
    showdown:/^⚔️ 결전 개시! 「(.+?)」 — 공격: (.+)$/,
  };
  const acts = [];
  let turn = 0, turnOwner = null, lastState = 0;
  const frames = d.frames;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const before = lastState;              // 이 로그가 찍히기 직전까지의 마지막 상태
    if (f.l === undefined) { lastState = f.s; continue; }
    const l = f.l; let m;
    const push = (kind, seat, extra) => acts.push({ i, t: f.t, turn, turnOwner, seat, kind, log: l, stateBefore: before, ...extra });
    if ((m = R.turn.exec(l))) { turn = +m[2]; turnOwner = who(m[1]); }
    else if ((m = R.chainAb.exec(l))) push('ability', who(m[1]), { name: m[2], chained: true });
    else if ((m = R.chain.exec(l))) push('play', who(m[1]), { card: m[2], chained: true });
    else if ((m = R.play.exec(l))) push('play', who(m[1]), { card: m[2] });
    else if ((m = R.ability.exec(l))) push('ability', who(m[1]), { name: m[2] });
    else if ((m = R.move.exec(l))) push('move', who(m[1]), { count: +m[2], dest: m[3] });
    else if ((m = R.hide.exec(l))) push('hide', who(m[1]), {});
    else if ((m = R.reveal.exec(l))) push('reveal', who(m[1]), {});
    else if ((m = R.pass.exec(l))) push('pass', who(m[1]), {});
    else if ((m = R.end.exec(l))) push('end', who(m[1]), {});
    else if ((m = R.mull.exec(l))) push('mulligan', who(m[1]), { count: +m[2] });
    else if ((m = R.targets.exec(l))) { const last = acts[acts.length - 1]; if (last && last.seat === who(m[1])) last.targets = m[3]; }
    else if ((m = R.showdown.exec(l))) acts.push({ i, t: f.t, turn, turnOwner, seat: who(m[2]), kind: 'showdown', bf: m[1], log: l, stateBefore: before });
    lastState = f.s;
  }
  return acts;
}

// 학습용 상태 요약 — 전체 G 대신 봇 평가와 비슷한 축약 특징 (숫자만). 스냅샷 객체를 받는다.
function rpFeatures(S, seat) {
  const me = S.players[seat], op = S.players[1 - seat];
  const units = (arr, p) => arr.filter(u => u.ctrl === p);
  const might = arr => arr.reduce((s, u) => s + (u.m || 0), 0);
  const bf = S.bfs.map(b => ({
    ctrl: b.controller, mine: units(b.units, seat).length, theirs: units(b.units, 1 - seat).length,
    myMight: might(units(b.units, seat)), theirMight: might(units(b.units, 1 - seat)), hidden: (b.hiddenCards || []).length,
  }));
  return {
    turn: Math.ceil((S.turnCount || 0) / 2), myTurn: S.turn === seat, state: S.state, phase: S.phase,
    pts: [me.points, op.points], hand: [me.hand.length, op.hand.length], deck: [me.deck.length, op.deck.length],
    runes: [me.runes.length, op.runes.length], ready: [me.runes.filter(r => !r.ex).length, op.runes.filter(r => !r.ex).length],
    energy: me.energy || 0, base: [me.base.length, op.base.length], baseMight: [might(me.base), might(op.base)],
    bf,
  };
}

module.exports = { rpLoad, rpActions, rpFeatures, cardName, loadCards };

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.log('사용법: node tools/replay-extract.js <file.rbr> [--json out.json] [--quiet]'); process.exit(1); }
  const d = rpLoad(file);
  const acts = rpActions(d);
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ header: d.header, meta: d.meta, result: d.result, actions: acts }, null, 1));
  if (!args.includes('--quiet')) {
    const h = d.header;
    console.log(`${path.basename(file)} · ${h.mode || ''} · ${d.meta.players.map(p => p.name + '(' + cardName(p.legendN) + ')').join(' vs ')}`);
    console.log(`결과: ${d.result ? `승자 ${d.meta.players[d.result.winner].name} · ${d.result.points.join(':')} · ${d.result.turns}턴` : '미완'} · 프레임 ${d.frames.length} · 행동 ${acts.length}`);
    let t = -1;
    for (const a of acts) {
      if (a.turn !== t) { t = a.turn; console.log(`── 턴 ${t} (${a.turnOwner == null ? '?' : d.meta.players[a.turnOwner].name})`); }
      const who = a.seat == null ? '?' : d.meta.players[a.seat].name;
      const what = a.kind === 'play' ? `플레이 「${a.card}」${a.chained ? ' (체인)' : ''}` : a.kind === 'ability' ? `능력 「${a.name}」` :
        a.kind === 'move' ? `이동 ${a.count}기 → ${a.dest}` : a.kind === 'showdown' ? `결전 개시 @${a.bf}` : a.kind;
      console.log(`  [${String(a.stateBefore).padStart(4)}] ${who}: ${what}${a.targets ? ' → ' + a.targets : ''}`);
    }
  }
}
