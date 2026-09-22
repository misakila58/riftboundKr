#!/usr/bin/env node
// 사람(승자)의 실제 수와 봇 정책의 선택을 같은 상태에서 비교한다 — "봇이 사람처럼 두는가"를 재는 일치율.
//   node tools/replay-agreement.js <폴더> [--level master] [--max 300] [--seed 1]
// 리플레이 스냅샷(G 전체)을 엔진에 그대로 올리고, 사람이 행동한 직전 상태에서 POLICY.nextAction(사람 좌석)을 묻는다.
// 비교 대상: 사람 턴의 중립 상태에서 한 play / move / end 결정. 봇 정책은 카드 플레이·이동·턴 종료를 같은 종류로 낸다.
// 함께 잰다: 턴 종료 시 남긴 에너지·준비 룬(자원 낭비), 손패 수 — 사람 vs 봇.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { rpLoad, rpActions, cardName, loadCards } = require('./replay-extract.js');
const JS = path.join(__dirname, '..', 'client', 'web', 'js');
const r = f => fs.readFileSync(path.join(JS, f), 'utf8');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = args.find(a => !a.startsWith('--') && !['--level', '--max', '--seed'].includes(args[args.indexOf(a) - 1]));
const levelFilter = opt('--level', null), MAX = +opt('--max', 300);
loadCards();

// 엔진 + 봇 정책을 헤드리스로 올린다 (tools/selfplay.js와 같은 파일). UI는 즉답 스텁.
const BOOT = `
var UI = { log(){}, render(){}, toast(){}, prompt(){}, promptShowdown(){}, manualNotice(){}, showVictory(){}, inspect(){}, inspectUnit(){}, hideZoom(){}, showZoom(){},
  fx:{ unit(){}, cast(){}, chainAdd(){}, score(){}, turnEnd(){}, priority(){}, check(){}, setOn(){}, on:false },
  confirmP:()=>Promise.resolve(false), pickUnitFrom:(p,c)=>Promise.resolve(c[0]), pickOption:(p,t,o)=>Promise.resolve(o[0].v),
  pickReaction:()=>Promise.resolve(null), pickNumber:(p,t,mn,mx)=>Promise.resolve(mx), pickHandCard:()=>Promise.resolve(0), pickMulligan:()=>Promise.resolve([]),
  isPicking(){return false;}, logEntryEl(){return null;}, revealAurora:()=>Promise.resolve(), pickBoardOrder:(p,t,o)=>Promise.resolve(o.map((_,i)=>i)) };
var NET = { online:false, seat:null, dispatch(a,fn){ if(fn) fn(); } };
var REPLAY = { viewing:false, recording:false, capture(){}, _onNewGame(){}, _onVictory(){} };
var BUILDINFO = { version:'test', built:'' }; var BOT = { active:false, seat:1, level:'skilled' };
`;
const ctx = vm.createContext({ console, setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Date, isNaN, parseInt, parseFloat, structuredClone, process, performance });
vm.runInContext([BOOT, r('cards.js'), r('loc.js'), r('effects.js'), r('cardscripts.js'), r('engine.js'), r('bot-eval.js'), r('bot-sim.js'), r('bot-policy.js'),
  'compileAllCards(); this.__ = { setG(s){ G = s; }, getG(){ return G; }, POLICY, seedRng, card };'].join('\n;\n'), ctx);
const E = ctx.__;

function* walk(p) { const st = fs.statSync(p); if (st.isDirectory()) { for (const f of fs.readdirSync(p).sort()) yield* walk(path.join(p, f)); } else if (p.endsWith('.rbr')) yield p; }
const describe = a => a.kind === 'play' ? `play:${a.card}` : a.kind === 'move' ? `move→${a.dest}` : a.kind;
const botDescribe = act => !act ? 'null' : act.kind === 'play' ? `play:${cardName(act.n)}` : act.kind === 'move' ? `move→${act.dest === 'base' ? '기지' : '전장' + act.dest}` : act.kind === 'end' ? 'end' : act.kind;

(async () => {
  const stat = { n: 0, kindMatch: 0, exactMatch: 0, byKind: {}, confusion: {} };
  const waste = { human: { n: 0, energy: 0, runes: 0, hand: 0 }, bot: { n: 0, energy: 0, runes: 0, hand: 0 } };
  let games = 0;
  for (const f of walk(dir)) {
    if (stat.n >= MAX) break;
    let d; try { d = rpLoad(f); } catch (e) { continue; }
    if (!d.result || d.meta.manual) continue;
    const bot = d.meta.bot || d.header.bot; if (!bot) continue;
    if (levelFilter && bot.level !== levelFilter) continue;
    const hs = 1 - bot.seat; if (d.result.winner !== hs) continue;    // 사람이 이긴 판만 — 배울 대상
    games++;
    const acts = rpActions(d);
    E.POLICY.level = bot.level === 'novice' ? 'skilled' : bot.level;   // 초보 티어는 무작위라 비교 의미 없음
    E.POLICY.budget = 0; E.POLICY.peek = false;                        // 탐색 없이 휴리스틱만 (빠르고 결정적)
    for (const a of acts) {
      // 턴 종료 시 자원 낭비 (양쪽 모두)
      if (a.kind === 'end' && a.turnOwner === a.seat) {
        const S = d.states[a.stateBefore]; if (!S) continue;
        const P = S.players[a.seat]; const who = a.seat === hs ? waste.human : waste.bot;
        who.n++; who.energy += P.energy || 0; who.runes += P.runes.filter(x => !x.ex).length; who.hand += P.hand.length;
      }
      if (a.seat !== hs || a.turnOwner !== hs || !['play', 'move', 'end'].includes(a.kind)) continue;
      const S = d.states[a.stateBefore]; if (!S || S.state !== 'neutral' || S.phase !== 'action' || S.turn !== hs) continue;
      let act = null;
      try {
        E.setG(structuredClone(S)); E.seedRng(1);
        const c = E.POLICY.newCtx ? E.POLICY.newCtx() : {};
        act = await Promise.race([E.POLICY.nextAction(hs, c), new Promise(res => setTimeout(() => res(null), 3000))]);
      } catch (e) { act = null; }
      stat.n++;
      const hk = a.kind, bk = act ? act.kind : 'null';
      stat.byKind[hk] = stat.byKind[hk] || { n: 0, match: 0 }; stat.byKind[hk].n++;
      const key = `${hk}→${bk}`; stat.confusion[key] = (stat.confusion[key] || 0) + 1;
      if (hk === bk) { stat.kindMatch++; stat.byKind[hk].match++; if (describe(a) === botDescribe(act) || (hk === 'end')) stat.exactMatch++; }
      if (stat.n >= MAX) break;
    }
  }
  const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
  console.log(`사람이 이긴 봇전 ${games}판 · 비교한 결정 ${stat.n}개${levelFilter ? ' · 난이도 ' + levelFilter : ''}`);
  console.log(`행동 종류 일치 ${pct(stat.kindMatch, stat.n)} · 카드/목적지까지 일치 ${pct(stat.exactMatch, stat.n)}`);
  for (const [k, v] of Object.entries(stat.byKind)) console.log(`  사람이 ${k.padEnd(5)}한 ${String(v.n).padStart(4)}번 중 봇도 ${k}: ${pct(v.match, v.n)}`);
  console.log('  혼동표(사람→봇):', Object.entries(stat.confusion).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
  const w = waste; const line = (t, o) => `${t}: 턴 종료 시 에너지 ${(o.energy / o.n).toFixed(2)} · 준비 룬 ${(o.runes / o.n).toFixed(2)} · 손패 ${(o.hand / o.n).toFixed(2)} (턴 ${o.n})`;
  console.log('\n■ 자원 낭비 (턴 종료 시 남긴 것)'); console.log('  ' + line('사람(승자)', w.human)); console.log('  ' + line('봇(패자)  ', w.bot));
})();
