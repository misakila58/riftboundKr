// ══════════ 튜토리얼 모드 ══════════
// 고정 덱 + 스크립트 봇을 상대로 게임 흐름 전체(턴 구조·자원·이동·격돌·전투·득점·키워드)를
// 단계별로 가르친다. 튜토리얼 버튼으로 시작하며, 오프라인(봇전)으로만 동작한다.

const TUT = {
  active:false, step:0, flags:{}, botTurn:0, botRunning:false,
  timer:null, baseline:{},
};

// ---------- 교육용 카드 (다리우스: 분노/질서) ----------
// 210 대담한 포로(2, 2⚔, 강습)  216 비상하는 정찰병(2, 1⚔, 유언)
// 217 삼두정 영광 추구자(2, 2⚔, 군단-버프)  9 마법공학 광선(1+파워1, 피해3)
// 218 선봉대 대장(3+파워1, 군단-신병토큰2)  4 가르기(1, 강습3 부여)  240 세트-우두머리(4+파워1, 탱커)
const TUT_P0 = {
  legendN:253, champN:27,                       // 다리우스 전설 / 다리우스-삼두정
  hand:[210,216,217,9],
  deckTop:[218,4,240,12,10,3,16,219],           // 매 턴 뽑는 순서
  runeTop:[7,214,7,214,7,214,7,214,7,214,7,214],// 분노/질서 교차 (파워 지불 교육용)
};
const TUT_P1 = {
  legendN:265, champN:112,                      // 빅토르 (봇)
  hand:[211,219,210,219],                       // 211(2⚔, 강습 없음)로 공격 → 상호 전멸 수업
  deckTop:[219,210,211,219,210],
  runeTop:[214,214,214,214,214,214,214,214,214,214,214,214],
};
const TUT_BFS = [280, 297];                     // 신버들 숲(점유:드로우) / 바람쓸린 언덕(갱킹)

function tutFill(list, want){ // deckTop 뒤를 채워 40장 구성
  const out=[...list];
  const filler=[210,219,12,10,16,3,217,216];
  let i=0; while(out.length<want){ out.push(filler[i%filler.length]); i++; }
  return out;
}

// ---------- 단계 정의 ----------
// kind: 'info'(다음 버튼) | 'task'(조건 충족 시 자동 진행)
function tutSteps(){
  const P0=()=>G.players[0], P1=()=>G.players[1];
  const myUnits=()=>everyUnit().filter(u=>u.ctrl===0);
  return [
  { kind:'info', title:'🎓 튜토리얼에 오신 것을 환영합니다!',
    text:`리프트바운드는 <b>전장(戰場)을 차지해 점수를 얻는</b> 게임입니다.<br>
    승리 조건: <b>8점 선취</b>. 점수는 전장을 <b>정복</b>하거나(빼앗기), 자기 턴 시작까지 <b>점유</b>(지키기)하면 얻습니다.<br><br>
    화면을 둘러보세요 — 아래쪽이 당신, 위쪽이 봇(연습 상대)입니다.` },
  { kind:'info', title:'📋 화면 구역 안내',
    text:`· <b>전설</b>(좌측 금테 카드): 당신의 리더. 고유 능력을 가지며 게임 내내 유지됩니다.<br>
    · <b>챔피언 존</b>: 선택 챔피언이 대기하는 곳 — 손패처럼 여기서 바로 플레이할 수 있습니다.<br>
    · <b>덱 / 룬 덱 / 파기</b>: 뽑을 카드 / 자원(룬) / 버려진 카드 더미.<br>
    · <b>본진</b>: 유닛이 소환되는 안전지대. 여기 있는 유닛은 공격받지 않습니다.<br>
    · 중앙의 <b>전장 2곳</b>: 점수의 원천! 유닛을 보내 차지해야 합니다.<br><br>
    💡 <b>카드를 꾹 누르거나 Alt+클릭</b>하면 확대되어 효과를 자세히 볼 수 있습니다.` },
  { kind:'info', title:'🔄 턴 구조 (A-B-C-D)',
    text:`매 턴 시작에 4단계가 자동 진행됩니다 (로그 확인!):<br>
    <b>A 각성</b> — 소진된 카드(옆으로 눕은)를 모두 준비 상태로.<br>
    <b>B 시작</b> — 시작 효과 발동 + <b>점유 득점</b>: 통제 중인 전장마다 1점!<br>
    <b>C 충전</b> — 룬 덱에서 룬 2개를 가져옵니다 (후공은 첫 턴만 3개).<br>
    <b>D 드로우</b> — 카드 1장을 뽑습니다.<br><br>
    지금 당신의 첫 턴 — 룬 2개가 충전되고 1장을 뽑아 손패가 5장입니다.` },
  { kind:'info', title:'💎 자원: 에너지와 파워',
    text:`카드 비용은 <b>에너지</b>(좌상단 숫자)와 <b>파워</b>(색 구슬)로 지불합니다.<br>
    · <b>에너지</b>: 룬 1개를 <b>소진</b>(눕히기)할 때마다 1씩. 다음 턴에 다시 일어납니다.<br>
    · <b>파워</b>: 룬 1개를 <b>재충전</b>(룬 덱 맨 아래로 반환)해서 그 룬의 색 파워 1을 얻습니다.<br>
    비용은 플레이할 때 <b>자동으로 지불</b>되니 외울 필요는 없습니다.<br>
    현재 룬 2개 = 에너지 2까지 사용 가능.` },
  { kind:'task', title:'▶ 유닛을 플레이해보세요!',
    text:`손패의 <b>「대담한 포로」</b>(비용 2)를 클릭하고 <b>[▶ 플레이]</b>를 선택하세요.<br>
    <b>[강습]</b> 키워드: 공격할 때 전투력 +1이 되는 유닛입니다.`,
    hint:'손패(아래줄)의 대담한 포로 → 클릭 → ▶ 플레이',
    done:()=>everyUnit().some(u=>u.ctrl===0&&u.n===210) },
  { kind:'info', title:'😴 유닛은 소진 상태로 등장합니다',
    text:`방금 소환된 유닛이 <b>옆으로 누워(소진)</b> 있죠? 소환 직후에는 행동할 수 없고,<br>
    다음 턴 <b>각성 단계</b>에 일어나야 이동/공격이 가능합니다.<br>
    (예외: <b>[가속]</b> 키워드는 추가 비용을 내면 준비 상태로 등장!)<br>
    룬 2개가 소진되어 에너지를 지불한 것도 확인해보세요.` },
  { kind:'task', title:'⏭ 턴을 종료하세요',
    text:`이번 턴에 할 일은 끝났습니다. 우측의 <b>[턴 종료]</b> 버튼을 누르세요.`,
    hint:'사이드바의 [턴 종료] 버튼',
    done:()=>G.turn===1||TUT.flags.botT1done },
  { kind:'info', title:'🤖 봇의 턴',
    text:`봇이 자기 턴을 진행했습니다 (로그 확인) — 룬을 충전하고 유닛을 소환했죠.<br>
    이제 당신의 2번째 턴: <b>각성</b>으로 유닛과 룬이 모두 준비되고, 룬 2개가 추가 충전되어
    <b>총 4개</b>(에너지 4)가 되었습니다.`,
    ready:()=>G.turn===0&&G.phase==='action' },
  { kind:'task', title:'🚶 전장으로 이동 → 정복!',
    text:`이제 전장을 차지합시다!<br>
    ① 우측 <b>[🚶 이동]</b> 버튼 클릭 → ② 본진의 <b>대담한 포로</b> 클릭(초록 테두리) →
    ③ 왼쪽 전장 <b>「신버들 숲」</b>의 빈 공간 클릭.<br><br>
    상대 유닛이 없어도 전장에 들어가면 <b>격돌</b>이 열립니다 — 상대에게 대응 기회를 주는 것이죠.`,
    hint:'[이동] → 유닛 클릭 → 전장 클릭',
    done:()=>G.state==='showdown'||G.bfs.some(bf=>bf.controller===0) },
  { kind:'task', title:'⚔️ 격돌: 패스하면 진행됩니다',
    text:`<b>격돌</b>은 양측이 <b>[행동]/[반응]</b> 카드로 응수할 수 있는 창입니다.<br>
    양쪽 다 패스하면 격돌이 해결됩니다. 봇은 자동으로 패스하니,
    당신도 <b>[패스]</b>를 눌러보세요.<br><br>
    빈 전장이므로 전투 없이 <b>통제권 획득 → 정복 1점!</b>`,
    hint:'[패스] 버튼',
    done:()=>G.state==='neutral'&&G.players[0].points>=1 },
  { kind:'info', title:'🏆 정복 득점!',
    text:`1점 획득! 전장 테두리가 파란색(당신 통제)으로 바뀌었습니다.<br>
    · <b>정복</b>: 통제권을 새로 얻으면 1점 (전장당 <b>턴에 1번만</b>).<br>
    · <b>점유</b>: 다음 <b>내 턴 시작까지</b> 지키면 또 1점!<br>
    즉 전장 하나를 계속 지키면 매 턴 1점씩 들어옵니다. 상대는 그걸 뺏으러 오겠죠.` },
  { kind:'task', title:'⏭ 턴 종료 → 봇이 공격해옵니다',
    text:`남은 에너지로 더 플레이해도 되지만, 지금은 <b>[턴 종료]</b>를 눌러 봇의 반격을 봅시다.`,
    hint:'[턴 종료] 버튼',
    done:()=>TUT.flags.botAttacked||G.turn===1 },
  { kind:'task', title:'🛡 방어 격돌! 패스하면 전투가 벌어집니다',
    text:`봇이 유닛을 당신의 전장에 보냈습니다 — 이번엔 <b>전투가 있는 격돌</b>입니다.<br>
    지금 [행동] 주문으로 요격할 수도 있지만, 일단 <b>[패스]</b>해서 전투를 구경해봅시다.<br><br>
    <b>전투 규칙</b>: 양측 유닛의 <b>전투력(⚔) 합계</b>만큼 서로에게 피해를 배분합니다.
    (한 유닛을 처치할 만큼 몰아서 배분해야 하는 <b>치명 우선</b> 규칙, [탱커]가 있으면 먼저!)`,
    hint:'[패스] 버튼 — 봇의 응수 차례면 잠시 기다리세요',
    ready:()=>TUT.flags.botAttacked||(G.state==='showdown'&&G.showdown&&G.showdown.attacker===1),
    done:()=>TUT.flags.combatResolved },
  { kind:'info', title:'💥 전투 결과',
    text:`양쪽 유닛이 전투력 2 vs 2로 <b>동시에</b> 피해를 주고받아 함께 쓰러졌습니다.<br>
    중요한 점 — 공격측이 전멸했으므로 <b>전장 통제권은 그대로 당신</b>에게 남습니다!<br>
    (방어측이 살아남으면 공격 유닛들은 본진으로 후퇴합니다)<br><br>
    봇이 턴을 마치면, 당신 턴 시작에 <b>점유 득점</b>이 들어오는 걸 확인하세요.` },
  { kind:'info', title:'🏆 점유(Hold) 득점!',
    text:`당신 턴 시작(B단계)에 전장을 지켜낸 보상으로 <b>+1점</b>! (현재 ${'${'}G.players[0].points}점)<br>
    게다가 「신버들 숲」의 전장 효과로 <b>카드 1장</b>도 뽑았습니다 — 전장마다 고유 효과가 있으니
    전장 카드도 확대해서 읽어보세요.<br><br>
    이번 턴은 룬 6개 = 에너지 6. 이제 <b>키워드</b>를 배워봅시다.`,
    ready:()=>G.turn===0&&G.phase==='action'&&G.players[0].points>=2 },
  { kind:'task', title:'▶ 「비상하는 정찰병」 플레이 — [유언]',
    text:`손패의 <b>「비상하는 정찰병」</b>(비용 2)을 플레이하세요.<br>
    이제 전장을 통제 중이므로 <b>배치 위치 선택 창</b>이 뜹니다 — 유닛은 <b>본진 또는
    통제 중인 전장</b> 어디든 소환할 수 있습니다. 이번엔 <b>본진</b>을 고르세요.<br>
    <b>[유언]</b>: 이 유닛이 <b>죽을 때</b> 효과가 발동합니다 (이 카드는 룬 1개 충전).`,
    hint:'손패의 비상하는 정찰병 → ▶ 플레이 → 선택 창에서 [본진]',
    done:()=>everyUnit().some(u=>u.ctrl===0&&u.n===216) },
  { kind:'task', title:'⭐ 전설 능력 사용 — [군단]',
    text:`이번 턴에 카드를 1장 플레이했으므로 <b>[군단]</b> 조건이 충족됐습니다!<br>
    [군단] = "이 턴에 다른 카드를 플레이했다면" 발동하는 조건부 효과입니다.<br><br>
    좌측 하단의 <b>전설(다리우스)</b>을 클릭 → <b>⚡ 에너지 1 추가 (군단)</b>을 발동하세요.
    전설 능력은 보통 <b>턴에 한 번</b>(소진)입니다.`,
    hint:'전설 카드 클릭 → ⚡ 능력 선택',
    done:()=>G.players[0].legendEx===true },
  { kind:'task', title:'▶ 「삼두정 영광 추구자」 — [군단] + 버프',
    text:`이어서 <b>「삼두정 영광 추구자」</b>를 플레이하세요.<br>
    [군단]이 충족된 상태라 등장하며 <b>버프</b>(+1⚔ 영구 강화)를 받습니다.<br>
    버프는 유닛 우측 상단의 <b>+1</b> 표시로 확인할 수 있고, 일부 효과의 비용으로 소모되기도 합니다.`,
    hint:'손패의 삼두정 영광 추구자 → ▶ 플레이',
    done:()=>everyUnit().some(u=>u.ctrl===0&&u.n===217&&u.buff>=1) },
  { kind:'task', title:'⏭ 턴 종료',
    text:`좋습니다! 소환한 유닛들은 다음 턴부터 움직일 수 있습니다. <b>[턴 종료]</b>를 누르세요.`,
    hint:'[턴 종료] 버튼',
    done:()=>TUT.flags.botT3done||G.turn===1 },
  { kind:'task', title:'✨ 주문과 파워 비용 — 「선봉대 대장」',
    text:`당신 턴입니다 (점유 +1점!). 이번엔 <b>파워 비용</b>이 있는 카드를 써봅시다.<br>
    <b>「선봉대 대장」</b>(비용 3 + <b>질서 파워 1</b>)을 플레이하세요.
    파워는 <b>질서 룬 1개가 룬 덱으로 재충전</b>되며 자동 지불됩니다 (룬 개수가 줄어드는 것 확인!).<br>
    [군단] 충족 시 <b>신병 토큰 2개</b>도 따라옵니다 — 첫 카드라 이번엔 토큰 없이 등장하지만,
    나중에 순서를 바꿔 시험해보세요.`,
    hint:'손패의 선봉대 대장 → ▶ 플레이 (배치는 본진 추천)',
    ready:()=>G.turn===0&&G.phase==='action'&&G.players[0].points>=3,
    done:()=>everyUnit().some(u=>u.ctrl===0&&u.n===218)||G.players[0].trash.includes(218) },
  { kind:'task', title:'⏭ 턴 종료 — 자원을 아껴둡시다',
    text:`잘했습니다! 다음 턴에는 룬이 더 많아져 <b>고비용 챔피언</b>을 낼 수 있습니다.<br>
    <b>[턴 종료]</b>를 누르세요. (남은 룬의 에너지는 턴이 끝나면 사라집니다 — 이월되지 않아요!)`,
    hint:'[턴 종료] 버튼',
    done:()=>G.turnCount>(TUT.baseline.tc||0) },
  { kind:'task', title:'👑 챔피언 플레이!',
    text:`당신 턴입니다 (점유 +1점!). 이제 <b>챔피언 존</b>의 <b>「다리우스 - 삼두정」</b>
    (비용 5 + 분노 파워 1)을 클릭해 플레이하세요.<br>
    챔피언은 강력한 전투력(5⚔)의 에이스입니다. 죽으면 파기되지 않고
    <b>챔피언 존으로 돌아와</b> 다시 플레이할 수 있습니다.`,
    hint:'좌측 챔피언 존의 다리우스 클릭 → ▶ 챔피언 플레이',
    ready:()=>G.turn===0&&G.phase==='action'&&G.players[0].points>=4,
    done:()=>G.players[0].champInZone===false },
  { kind:'info', title:'🗡 마무리 수업: 공격 준비',
    text:`다음 턴, 준비된 유닛들을 <b>오른쪽 전장(바람쓸린 언덕)</b>까지 보내 두 번째 전장도 정복해보세요.<br>
    · <b>「가르기」</b>(비용 1): 유닛에게 [강습 3]을 부여하는 <b>[행동]</b> 주문 — <b>격돌 중에도</b> 쓸 수 있어
      전투력 계산을 뒤집는 필살기입니다.<br>
    · <b>「마법공학 광선」</b>: 전장의 유닛에게 피해 3 — 성가신 방어 유닛 제거용.<br>
    · 「바람쓸린 언덕」의 유닛은 <b>[갱킹]</b>(전장→전장 이동)을 얻습니다.` },
  { kind:'info', title:'🎯 승리 조건 정리',
    text:`· <b>8점 선취 승리</b> — 정복(+1) / 점유(+1, 자기 턴 시작) 반복.<br>
    · 단, <b>마지막 1점</b>은 <b>점유</b>로만, 또는 그 턴에 <b>모든 전장을 득점한 정복</b>으로만 얻습니다
      (조건 미달 정복은 대신 카드 1장을 뽑습니다).<br>
    · 덱이 다 떨어지면 <b>번아웃</b>: 파기 더미를 덱으로 되돌리고 <b>상대에게 1점</b>.<br><br>
    ⚙️ 자동화가 안 되는 카드 효과는 안내가 뜹니다.` },
  { kind:'end', title:'🎉 튜토리얼 완료!',
    text:`핵심 규칙을 모두 배웠습니다:<br>
    턴 구조(ABCD) · 에너지/파워 · 유닛 소환/이동 · 격돌과 전투 · 정복/점유 득점 ·
    키워드([강습][유언][군단][탱커][갱킹]...) · 전설/챔피언 · 승리 조건.<br><br>
    이대로 <b>계속 연습</b>해도 좋습니다 (봇은 이후 턴만 넘기는 허수아비가 됩니다 — 8점을 채워보세요!).
    실전은 메인 화면의 <b>온라인 대전</b>에서!` },
  ];
}

// ---------- 시작 ----------
TUT.start = function(){
  NET.online=false; NET.seat=null;
  TUT.active=true; TUT.step=0; TUT.flags={}; TUT.botTurn=0; TUT.botRunning=false;

  newGame({
    seed: 12345,
    players:[
      { name:'수련생(나)', legendN:TUT_P0.legendN, champN:TUT_P0.champN, deck:tutFill(TUT_P0.deckTop,40), runes:TUT_P0.runeTop },
      { name:'연습 봇', legendN:TUT_P1.legendN, champN:TUT_P1.champN, deck:tutFill(TUT_P1.deckTop,40), runes:TUT_P1.runeTop },
    ],
    bfs: TUT_BFS,
  });
  // 손패/덱/룬을 교육용 고정 순서로 재구성 (셔플 무시)
  const P0=G.players[0], P1=G.players[1];
  P0.hand=[...TUT_P0.hand]; P0.deck=tutFill(TUT_P0.deckTop,36);
  P1.hand=[...TUT_P1.hand]; P1.deck=tutFill(TUT_P1.deckTop,36);
  P0.runeDeck=[...TUT_P0.runeTop]; P1.runeDeck=[...TUT_P1.runeTop];

  showScreen('game-screen');
  document.getElementById('net-info').textContent='🎓 튜토리얼';
  UI.log('🎓 튜토리얼 시작! 좌측 상단 안내 패널을 따라오세요.', 'sys');
  startTurn().then(()=>{ TUT.render(); });

  clearInterval(TUT.timer);
  TUT.timer=setInterval(TUT.tick, 400);
};

// ---------- 진행 엔진 ----------
TUT.steps=null;
TUT.cur=function(){ if(!TUT.steps) TUT.steps=tutSteps(); return TUT.steps[TUT.step]; };

TUT.tick=function(){
  if(!TUT.active||!G||TUT._inTick) return;
  TUT._inTick=true;
  try{
    TUT.observe();
    TUT.botAuto();
    const s=TUT.cur();
    if(s){
      if(s.kind==='task' && s.done && TUT._readyOk(s)){
        try{ if(s.done()){ TUT.next(); } }catch(e){}
      }
      TUT.renderWait();
    }
  } finally { TUT._inTick=false; }
};
// 렌더(상태 변경) 직후 tick을 큐잉 — 백그라운드 탭에서 setInterval이 스로틀되어도
// 게임이 움직이는 한 튜토리얼이 반드시 반응하도록 보장한다.
TUT.tickSoon=function(){
  if(TUT._queued) return;
  TUT._queued=true;
  setTimeout(()=>{ TUT._queued=false; try{ TUT.tick(); }catch(e){} }, 30);
};
TUT._readyOk=function(s){ try{ return !s.ready || s.ready(); }catch(e){ return false; } };

TUT.next=function(){
  TUT.step++;
  TUT.baseline={ tc: G?G.turnCount:0 };  // 단계 진입 시점의 턴 카운트 기록 (턴 종료 감지용)
  const s=TUT.cur();
  if(!s){ TUT.finish(); return; }
  TUT.render();
  TUT.tickSoon(); // 다음 과제가 이미 충족돼 있으면 연쇄 진행
};

// 상태 관찰 → 플래그 기록 (전투 해결 감지 등)
TUT.observe=function(){
  if(G.turn===1 && G.turnCount>=2) TUT.flags['botTurnSeen'+G.turnCount]=true;
  if(G.state==='showdown' && G.showdown && G.showdown.attacker===1){ TUT.flags.botAttacked=true; TUT.flags.inBotShowdown=true; }
  if(TUT.flags.inBotShowdown && G.state==='neutral'){ TUT.flags.inBotShowdown=false; TUT.flags.combatResolved=true; }
};

// ---------- 봇 자동화 ----------
TUT.botAuto=function(){
  if(!G||G.winner!==null) return;
  // 격돌 중 봇의 응답 차례면 자동 패스
  if(G.state==='showdown' && G.actingPlayer===1 && !TUT._passing){
    TUT._passing=true;
    setTimeout(async()=>{ try{ if(G.state==='showdown'&&G.actingPlayer===1) await showdownPass(); }catch(e){} TUT._passing=false; }, 900);
    return;
  }
  // 봇 턴 스크립트
  if(G.turn===1 && G.phase==='action' && G.state==='neutral' && !TUT.botRunning){
    TUT.botRunning=true;
    TUT.runBotTurn().finally(()=>{ TUT.botRunning=false; });
  }
};

TUT.runBotTurn=async function(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const P1=G.players[1];
  TUT.botTurn++;
  await sleep(1100);
  try{
    if(TUT.botTurn===1){
      // 유닛 1개 소환 (211: 2⚔, 강습 없음 — 다음 턴 상호 전멸 수업용)
      const i=P1.hand.indexOf(211);
      if(i>=0) await playCardFromHand(1,i);
      TUT.flags.botT1done=true;
    } else if(TUT.botTurn===2){
      // 211(2⚔)만 골라 플레이어 전장 공격 → 2vs2 상호 전멸
      const atk=G.players[1].base.find(u=>!u.ex && u.n===211) || G.players[1].base.find(u=>!u.ex && !u.isToken);
      if(atk && G.bfs[0].controller===0){
        await moveUnits(1,[atk],0);
        // 격돌은 tick의 자동 패스 + 플레이어 패스로 해결됨 — 해결까지 대기
        let guard=0;
        while(G.state==='showdown' && guard<200){ await sleep(300); guard++; }
      }
      await sleep(500);
      const j=P1.hand.indexOf(219);
      if(j>=0) await playCardFromHand(1,j);
    } else if(TUT.botTurn===3){
      const k=P1.hand.indexOf(210);
      if(k>=0) await playCardFromHand(1,k);
      TUT.flags.botT3done=true;
    }
    // 이후 턴: 아무것도 안 함 (허수아비)
  }catch(e){ console.warn('bot error',e); }
  await sleep(900);
  try{ if(G.turn===1 && G.winner===null) await endTurn(); }catch(e){}
};

// ---------- 패널 렌더링 ----------
TUT.render=function(){
  let p=document.getElementById('tut-panel');
  if(!p){
    p=document.createElement('div'); p.id='tut-panel';
    document.getElementById('game-screen').appendChild(p);
  }
  const s=TUT.cur();
  if(!s){ p.style.display='none'; return; }
  const total=TUT.steps.length;
  const isInfo=s.kind==='info'||s.kind==='end';
  // 본문 내 ${...} 치환 (점수 등 동적 값)
  let text=s.text.replace(/\$\{G\.players\[0\]\.points\}/g, G?G.players[0].points:'');
  p.style.display='block';
  p.innerHTML=`
    <div class="tut-head"><span class="tut-step">${TUT.step+1}/${total}</span> ${s.title}</div>
    <div class="tut-body">${text}</div>
    ${s.hint?`<div class="tut-hint">👉 ${s.hint}</div>`:''}
    <div class="tut-btns">
      ${isInfo?`<button id="tut-next" class="tut-btn primary">${s.kind==='end'?'계속 연습하기':'다음 →'}</button>`:`<span class="tut-wait" id="tut-waitmsg">과제를 수행하면 자동으로 넘어갑니다...</span>`}
      <button id="tut-quit" class="tut-btn">튜토리얼 종료</button>
    </div>`;
  const nx=document.getElementById('tut-next');
  if(nx) nx.onclick=()=>{ if(s.kind==='end'){ TUT.finish(); } else TUT.next(); };
  document.getElementById('tut-quit').onclick=()=>{ if(confirm('튜토리얼을 종료할까요?')) location.reload(); };
};
// task 단계에서 ready 미충족 시 대기 문구 갱신
TUT.renderWait=function(){
  const s=TUT.cur(); if(!s||s.kind!=='task') return;
  const el=document.getElementById('tut-waitmsg'); if(!el) return;
  el.textContent = TUT._readyOk(s) ? '과제를 수행하면 자동으로 넘어갑니다...' : '⏳ 진행을 기다리는 중... (봇 턴/자동 단계)';
};

TUT.finish=function(){
  TUT.active=false; // 봇 자동화(패스/턴넘김)는 유지
  TUT.active=true; TUT.step=TUT.steps.length; // 패널만 닫고 봇 자동화 유지
  const p=document.getElementById('tut-panel'); if(p) p.style.display='none';
  UI.toast('🎓 튜토리얼 완료! 자유롭게 연습하세요 (봇은 턴만 넘깁니다)');
  UI.log('🎓 튜토리얼 완료 — 자유 연습 모드', 'sys');
};
