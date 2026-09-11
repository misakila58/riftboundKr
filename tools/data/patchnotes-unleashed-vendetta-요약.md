# Unleashed(2026-03-31)·Vendetta(2026-07-16) 룰 패치 — Origins 플레이에 영향 주는 변경

> 출처: playriftbound.com 공식 패치노트 2편(Unleashed 2026-03-31, Vendetta 2026-07-17 게시·2026-07-24 발효).
> 기준: 시뮬레이터가 따르는 2025-12-01판(Spiritforged) 종합 규칙 → 이 두 패치 이후.
> 주의: 패치노트 본문에는 **종합 규칙 조항 번호가 전혀 표기되어 있지 않음**. 아래 항목의 조항 번호는 모두 미상이며, 정확한 위치는 Core Rules Document 원문 대조가 필요함.
> "영향" 란의 카드 이름은 패치노트가 직접 언급한 카드만 적었고, 세트 소속(OGN/OGS)이 확실하지 않은 카드는 '불확실'로 표시함.

## Unleashed

### 승리 조건·득점
- [최종 득점/승리] 클린업 승리 조건 통일: 종전 "클린업 시 승점 ≥ 승리 점수"와 "즉시 승리" 두 규칙이 충돌 → 이제 **클린업 시점에 (승점 ≥ 승리 점수) AND (모든 상대보다 많음) 둘 다 만족해야 승리**. 원문: "A player will win the game if, during a cleanup, they have accrued points greater than or equal to the Victory Score and greater than any opponent. Both must be true." 영향: 동점 도달 시 무승부 처리, 클린업 승리 판정 로직 전체.
- [최종 득점/승리] 번아웃 즉시 승리 신설: 연속 처리된 번아웃으로 2점 이상 얻어 위 조건을 만족하면 **클린업을 기다리지 않고 즉시 승리**. 원문: "If a player gains two or more points as result of burn outs processed in sequence and fulfills the above conditions, they win the game immediately without needing to wait for a cleanup." 영향: 상대 덱이 연속으로 여러 번 번아웃되는 상황(드로우 강제 효과 등)의 승리 타이밍.

### 턴 구조·페이즈 명칭
- [턴 구조] 액션 페이즈 → **메인 페이즈**로 개명(기능 변화 없음). 원문: "The action phase has been renamed the main phase." 영향: UI/로그 용어.
- [턴 구조] 턴 종료 페이즈 → **엔딩 페이즈(Ending Phase)**로 개명, 턴 종료 클린업이 만료 단계(Expiration Step)에 흡수됨. 원문: "The End of Turn Cleanup has been folded into the Expiration Step." 영향: 턴 종료 처리 순서.
- [턴 구조/만료 단계] **만료 단계 루프** 신설: 만료 단계 중 체인 아이템이 FEPR을 거쳤다면 만료 단계 처음으로 되돌아감(이전: 1회만 처리 → "이번 턴" 효과·피해가 다음 턴까지 남는 문제). 원문: "If any items underwent the FEPR process during the Expiration Step, return to the start of the Expiration Step." 영향: 만료 단계에서 격발하는 능력에 반응해 낸 "이번 턴" 효과·피해가 같은 턴에 정리됨. Origins 카드 중 만료 단계 격발 카드가 있는지는 불확실(패치노트는 Spiritforged 카드가 최초라고 함).
- [추가 턴] Time Warp 등 추가 턴 규정 신설: 추가 턴은 지시받은 플레이어가 소유하며 **현재 턴 바로 뒤에 삽입**, 턴 순서 자체는 불변, 끝나면 큐에서 제거. 원문: "When an additional turn is created, it is owned by the player instructed to take it and inserted directly after the current turn into the repeating queue of turns generated at the start of the game." 영향: Time Warp(Origins).

### 우선권·체인·FEPR·클린업
- [체인/FEPR] **HOT FEPR** 도입(Handle Outstanding Tasks → Finalize·Execute·Pass·Resolve): 클린업·턴 시작·전투 절차·턴 종료 같은 "태스크"가 미처리 상태면 FEPR을 일시 중지하고, 태스크를 모두 처리한 뒤 대기 중 체인 아이템에 FEPR 진행. 원문: "when tasks are outstanding, pause the FEPR process until those outstanding tasks have been handled, and then perform the FEPR process on any pending chain items." 영향: 체인 처리기와 턴 절차 처리기의 우선순위 구조 전반.
- [클린업] **파이널라이즈가 클린업에서 제거**되어 HOT FEPR 소관으로 이동(이전: 클린업 단계에서 대기 아이템 파이널라이즈). 원문: "Finalization is no longer managed by the cleanup and instead happens after any outstanding tasks occur if there are pending items on the chain." 영향: 클린업 루틴에서 finalize 호출 삭제.
- [클린업/전투] 클린업 내 순서 변경: **전투 지정(공격자/방어자)의 부여·제거가 표시 피해로 유닛이 죽기 전에** 처리됨. 원문: "Combat designations are removed or added before units die to marked damage in a normal cleanup." 영향: 죽는 유닛의 "전투 중" 여부를 참조하는 효과.
- [전투 정의] "전투 중(in combat)" 정의 명문화: 전투가 진행 중인 전장에 있고 적절한 전투 지정을 가진 유닛. 원문: "A unit is 'in combat' if it occupies a battlefield where combat is ongoing and if it has an appropriate combat designation." 영향: 전투 중 유닛만 대상/조건으로 삼는 Origins 카드.

### 결전(Showdown)·전투 개시
- [결전/전투] 결전 → 전투 전환 허용(이전: 결전이 끝나야 전투 시작 가능): 전장이 contested이고 전장 통제자가 아닌 플레이어의 유닛이 있으면 결전 개시; 서로 다른 플레이어의 유닛이 있으면 **전투 결전(combat showdown)**으로 개시. 원문: "Combats are staged at battlefields that are contested and have units controlled by different players occupying them" 영향: 결전 중 유닛이 이동해 들어오는 모든 상황(Hostile Takeover, Stormbringer 언급; 세트 소속 불확실).
- [결전/전투] 턴 플레이어가 전투가 준비된(staged) 전장에서 결전을 열면 전투 결전으로 개시. 원문: "If the turn player would initiate a showdown at a battlefield where a combat is staged, it opens as a combat showdown."
- [결전/전투] 비전투 결전 진행 중 같은 전장에 전투가 준비되면, **다음 클린업에서 결전이 전투 결전으로 바뀌고** 전투 개시 절차 시작. 원문: "If the turn is in a showdown open state and combat is staged at a battlefield with an ongoing showdown, a cleanup will cause the showdown to become a combat showdown." 영향: 결전 상태 머신에 "전투로 승격" 전이 추가.

### 전투 해결 단계
- [전투/승패] 해결 단계(Resolution Step) 재편: ① 전투 클린업(유닛 치유, 공격 유닛 귀환) → ② 승자/패자 결정(서로 다른 플레이어의 유닛이 남거나, 유닛이 하나도 없으면 "결과 없음"; 아니면 유닛이 남은 쪽 승리) → ③ 해당 시 정복 → ④ 공격자/방어자 지정 해제 및 "이번 전투" 효과 만료. 원문: "If there are still units remaining controlled by different players, or if there are no units at the battlefield, then the combat will have 'no result'. Otherwise, the player who has units remaining at the battlefield wins." 영향: 전투 승리/패배 격발, 정복 판정, "이번 전투" 지속효과 종료 시점.
- [전투/피해 배분] **Backline 키워드** 신설: 같은 통제자의 Backline 없는 유닛에 먼저 피해를 배분한 뒤 Backline 유닛에 배분. 다중 Backline 처리 명확화. 원문: "Units with Backline must be assigned damage during the Combat Damage Step after any other unit with the same controller that doesn't have Backline." 영향: Caitlyn, Patrolling / Soraka, Wanderer(패치노트가 같은 능력을 가진 카드로 명시; Origins 소속으로 추정되나 불확실) — 능력 텍스트를 키워드로 대체 처리 가능.
- [피해 방지] **Prevent(방지) 액션** 신설: 방지는 게임 액션이자 지연 대체 효과로, 방지된 피해 풀(pool)이 유닛의 실드처럼 작동. 원문: "Prevent is a game action and also a delayed replacement effect—it creates a pool of prevented damage that acts as a shield on the affected units." 영향: "prevent" 텍스트를 가진 Origins/Spiritforged 카드(패치노트가 Origins에 존재한다고 명시; 구체 카드명 미기재).

### 격발 능력
- [격발] "you may" 격발 능력은 **체인에 올릴지 자체를 선택**(이전: 반드시 체인에 올리고 해결 시 선택). 원문: "If a triggered ability says 'you may' as the first part of its effect, the controller of its source will choose whether or not to place the triggered ability on the chain when its trigger condition is fulfilled." ※ Vendetta에서 선택 시점이 '격발 시' → '파이널라이즈 시'로 재조정됨(아래 참조). 영향: "When ..., you may ..." 형식 Origins 격발 능력 전부; "once each turn" 처리.
- [격발/비용] "[X]해서 [Y]한다(do X to do Y)" 형식의 격발 능력은 X를 **격발 능력의 기본 비용**으로 취급, 체인에 파이널라이즈할 때 지불(이전: 해결 시 지불). 원문: "If a triggered ability contains a cost within instructions, that cost is treated as the base cost of the triggered ability. The cost must be paid in order to finalize the ability to the chain." 영향: 해당 형식의 Origins 격발 능력(비용 지불 시점이 해결 전으로 당겨져 반응 창이 달라짐).
- [참조어] Referents 규정: 스펠·격발·활성화 능력의 "here", "my", "its" 등 참조어는 **해결 시** 확인. 단, 격발 조건을 참조하는 텍스트는 격발되어 체인에 올라갈 때 확인. 원문: "if a spell, triggered ability, or activated ability says 'here', 'my', 'its', or similar referential word, that information is checked when the spell or ability resolves." 영향: 유닛이 이동/사망한 뒤 해결되는 "here" 참조 효과.

### 대체 효과
- [대체 효과] 동시 다중 이벤트에 대체 효과를 적용할 때 **대체 효과 통제자가 적용 순서를 결정**. 원문: "If multiple simultaneous events are able to be replaced by a replacement effect, the controller of the replacement effect decides the order in which it is applied to those events." 영향: Zhonya's Hourglass(패치노트 언급; 세트 불확실)로 동시 사망 유닛 중 하나 구하기.
- [대체 효과] 각 대체 효과는 한 번의 **연속된 적용 시퀀스**로만 적용. 원문: "each replacement effect can only be applied in one sequence—one uninterrupted series of applications."
- [대체 효과] 통제자 정의: 대체 효과의 통제자 = 그 출처의 통제자. 원문: "The controller of a replacement effect is the player who controls the source of the replacement effect."
- [대체 효과] 대체된 이벤트에 게임 효과/액션의 수정이 걸려 있으면 대체 효과가 그 수정을 **상속**. 원문: "If an event replaced by a replacement effect would be modified by a game effect or a game action, the replacement effect inherits those modifications." 영향: Soraka + Guardian Angel 상호작용(패치노트 언급; 세트 불확실).

### 전장 통제·정복
- [전장 통제] 통제 잠금 기준 변경: contested 상태가 아니라 **전투/결전 진행 여부**로 통제 잠금. 유닛이 없는 전장은 턴이 open 상태일 때 다음 클린업에서 통제 상실 — 단 전투/결전 진행 중이면 유지. 원문: "If a player has no units at a battlefield and the turn is in an open state, they lose control of that battlefield in the following cleanup, unless there is a combat or showdown ongoing there." 영향: Hostile Takeover, Stormbringer(언급; 세트 불확실) 및 유닛이 전장을 비우는 모든 상황.
- [전장 통제] **체인에 아이템이 있는 동안에는 전장 통제를 잃지 않음**(신규, 기능 변경). 원문: "control of a battlefield cannot be lost while there is an item on the chain." 영향: 클린업 통제 상실 판정에 "체인 비어 있음" 조건 추가.

### 비용·할인
- [비용/할인] 비용의 특정 구성요소(에너지/파워 등)에만 걸리는 할인은 **그 구성요소가 총비용에 더해질 때 즉시 적용**, 다른 할인보다 먼저. 원문: "Discounts that only affect a specific component of a cost will apply as soon as that component is added to the total cost when finalizing a card or ability." 영향: Vex, Ezreal(패치노트 언급, Origins로 추정되나 불확실) 등 다중 할인 중첩 계산.

### 책임·연결
- [책임(Responsibility)] 게임 액션 "책임" 개념 신설: 액션을 수행한 플레이어(또는 킬로 귀속된 deal 액션의 책임자)가 책임자. "스펠로 유닛을 죽였을 때"는 킬 액션 책임 + 그 스펠 통제 + 스펠에 킬 귀속 세 조건 필요. 원문: "In order to fulfill a condition that reads 'when you kill a unit with a spell', a player must be responsible for the kill action, control the spell that instructed it, and the spell itself must have attribution for the kill action." 영향: Immortal Phoenix(패치노트 명시).
- [연결 지시(Linked Instructions)] 앞 지시가 다룬 오브젝트/액션을 참조하는 뒤 지시는 앞 지시가 실행돼야 실행됨; 앞 지시가 무시되면 뒤도 무시; 앞 지시의 액션이 대체되어도 뒤 지시는 영향 없음. 원문: "If the earlier linked instruction was ignored for any reason, the later linked instruction will also be ignored." 영향: Repeat가 부여된 Hidden Blade(패치노트 명시) 등 다단계 지시 스펠.
- [연결 능력(Linked Abilities)] 다른 능력을 참조하는 능력의 작동·영향 범위 규정 신설(세부 내용 패치노트 미기재 → 불확실).

### 키워드(Origins 관련)
- [군단(Legion)] Legion을 **종속 키워드(dependent keyword)**로 재정의: 조건 미충족 시 종속 능력은 비활성(효과 미적용, 격발·활성화 불가). 패치노트 스스로 "이미 그렇게 작동하던 것"이라 하므로 기능 변화 없음. 원문: "Legion is being updated using the new dependent keyword rules." 영향: Legion 활성화 능력의 조건 판정 로직 정리.
- [템플릿] [>] 기호 도입: Reaction/Action/Deathknell/Level/Legion 등 허용·종속 키워드가 줄 맨 앞에 오고 화살표로 연관 능력을 가리킴. 원문: "The arrowed backer indicates the ability that these keywords are associated with." 영향: 규칙 기능 변화 없음. Origins 카드 텍스트 재인쇄 시 파싱 대비.
- [조건부 허용 능력] 체인 위에서만 충족될 수 있는 조건부 Reaction/Action: 조건을 충족할 수 있다면 플레이 가능하며, "5단계 적법성 확인"까지 미충족이면 취소하고 원래 영역으로 되돌림. 원문: "If the chain item does not fulfill the conditions by the time 'step 5: check legality' has been reached, the actions taken while playing or activating the chain item are undone and it is returned to the zone it was played from if it is a card." 영향: Origins에 조건부 Reaction 카드가 있는지 불확실(Ambush 지원용).
- [장비/부착] 이미 부착된 유닛에 다시 부착하면 아무 일도 없음(신규). 원문: "Attaching a card to its current Top-Most Card will not have any effect." 영향: Origins 장비 부착 지시 효과의 중복 실행.

### 토큰·게임 액션
- [토큰] Create 액션 신설: 토큰을 체인 없이 즉시 해당 영역에 생성. 원문: "When a token is created, it is immediately generated in the appropriate zone without using the chain." 영향: Replace 지원용. 기존 Origins 토큰 생성 방식 변경 여부는 언급 없음(불확실).
- [Replace 액션] 오브젝트를 토큰으로 대체; 대체된 오브젝트는 추방 카드가 가는 영역으로, 대체 토큰은 원본의 효과·상태 상속; 되돌리기(swap back) 정의. 원문: "Whatever token replaces that object will inherit all effects and statuses that that object had." 영향: Origins 카드 해당 없음(Unleashed 카드용)으로 추정.
- [Predict 액션] "덱 맨 위 카드를 보고 재활용할 수 있다" 텍스트를 Predict로 표준화: N장을 보고 원하는 만큼 재활용, 나머지는 원하는 순서로 되돌림. 원문: "Predicting is the act of looking at some number of cards from the top of your main deck and choosing to recycle any number of them and placing the remaining ones back in any order" 영향: 해당 텍스트를 가진 Origins 카드(패치노트가 Origins부터 존재한다고 명시) — 1장일 때 기능 동일.

## Vendetta

### 격발 능력·"플레이" 정의
- [격발] 격발 능력을 두 부분으로 분리: (1) 격발 조건 + 추가 조건문 + "you may" + 지시 내 비용은 **체인에 올라가는 실제 능력이 아니라** 파이널라이즈 전/중에 결정되는 조건·선택·비용; (2) 그 뒤가 실제 효과. 원문: "they are not part of the actual triggered ability that goes on the chain. Instead they represent conditions, choices, and costs that are made before or as the chain item becomes a finalized item." 영향: 격발 능력 파서·체인 아이템 구조.
- [격발] "you may / they may" 선택 시점을 **격발 시 → 파이널라이즈 시**로 변경(Unleashed 규칙 수정). "once each turn"은 "파이널라이즈된 체인 아이템으로 올린 횟수"로 해석. 원문: "Timing for 'you may' or 'they may' when it appears as the first part of the effect of a triggered ability has been changed to finalization." 영향: Origins의 모든 "you may" 격발 능력 및 "once each turn" 카운트.
- [플레이 정의] "play" 3분류 명문화: ① 지시로서의 play = 체인에 올려 파이널라이즈 대기; ② **격발 조건의 "when you play" = 카드의 해결 시 격발**; ③ 그 외 "played this turn" 체크 = 파이널라이즈 여부. 원문: "Any triggered abilities that trigger when cards are played trigger when the act of playing the card has been completed by the resolution of the card." / "Non-triggered abilities that check cards being played do so by means of referencing whether said cards have been Finalized." 영향: Lecturing Yordle, Battering Ram, Here to Help(패치노트 예시; Origins로 추정되나 불확실), "When you play me" 전체, Legion 조건("played a card this turn")은 파이널라이즈 기준.
- [활성화 능력 용어] 카드 텍스트에서 활성화 능력을 "use" 대신 "play"로 표기하기 시작; 규칙은 둘 다 지원. 원문: "'Use' and 'play' supported for activated ability card text." 영향: 기능 변화 없음(한글 텍스트 번역 시 참고).
- [격발/"activate"] 이름이 지정된 격발 능력을 "activate"하라는 지시: 조건의 지정된 부분이 충족된 것처럼 나머지 조건을 확인. 원문: "that player checks the condition of all of the specified effects, as if they had fulfilled the named part of the condition" 영향: Origins에 해당 텍스트가 있는지 불확실.
- [전장 능력 통제] 전장 능력이 특정 플레이어의 선택을 지시하면 **그 플레이어가 능력의 통제자**(전장 통제자와 무관), 체인에 올리는 책임과 모든 선택 담당. 원문: "They and only they control the ability, regardless of who controls the Battlefield." 영향: 선택을 요구하는 Origins 전장 카드.

### 죽음 격발·지연 능력
- [Deathknell/"When I die"] 모든 "When I die" 격발 능력이 Deathknell과 동일하게 **죽기 직전 보드 정보(마지막 상태) 사용** 가능. 원문: "any 'When I die' triggered ability will be able to use information from before its source died." 영향: Origins의 "When I die" 유닛(Deathknell 미표기 카드 포함).
- [지연 능력] 생성되기 전에 지속 기간이 이미 끝난 지연 능력은 생성되지 않고 관련 지시 무시. 원문: "If a Delayed Ability's duration has ended before it was generated, the Delayed Ability is not generated and any instructions related to it are ignored." 영향: "이번 전투 끝에…" 등이 전투 종료 후 해결되는 경우.

### 대상 지정
- [대상] 대상 비해당 조건 추가: 다른 선택의 대상 제한이나 게임 액션의 제한/허용으로만 등장하는 플레이어·영역·오브젝트는 **대상이 아님**. 원문: "A player, zone, or game object isn't a target if it is included only as part of a targeting restriction for another choice or only as a restriction or permission for a game action." 영향: Thrill of the Hunt, Here to Help(패치노트 명시) 등 "to a battlefield" 지시 — 전장을 대상으로 잡지 않음.
- [숨김(Hidden) 대상] 숨김 스펠/플레이 효과의 대상 제한은 **각 대상별로 개별 적용**(집합 전체가 아님). 원문: "The restriction on targets chosen by hidden spell and play effects is applied to each target separately and individually." 영향: 다중 대상 Hidden 카드(Origins).
- [대상 수 계산] 대상 수를 참조하는 효과는 미스타겟된 선택은 포함, 비보드 영역으로 이동한 대상은 제외. 원문: "it will include any mistargeted choices, but not any targets that have changed to a non-board zone." 영향: Repulse(패치노트 명시; 세트 불확실).
- [부적법 대상/Untargetable] 대상 지정 후 untargetable이 되면 해결 시 미스타겟 → 관련 지시 무시(Void Seeker + 기지 귀환과 같은 원리). 원문: "If a unit becomes untargetable after a spell or ability has already targeted that unit, the spell or ability will mistarget on resolution" 영향: Untargetable 자체는 신규 세트 효과이나, 미스타겟 처리 원리 확인용(Void Seeker 언급).
- [분할 피해] 해결 시 피해량이 대상 수보다 적으면 **효과 통제자가** 어떤 대상을 제외할지 결정; 피해량보다 적은 수의 대상을 남길 수는 없음. 원문: "That player cannot choose to have fewer Targets than they have damage to split when choosing which Targets cease being Targets." 영향: 피해 분할 Origins 스펠(피해 감소와 결합 시).
- [새 선택] 체인 위 스펠의 선택을 다시 하는 규칙(타이밍·적법성·범위) 신설. 원문: "we've added rules for making new choices that will clarify the timing, legality, and nature of the choices allowed to be remade." 영향: Mystic Reversal(패치노트 명시; 세트 불확실).

### 전투 피해·대체 효과
- [전투 피해 배분] 전투 피해 단계에서 **피해에 적용될 대체 효과(방지·증폭 등)는 피해 배분 시점에 적용된 것으로 간주**(이전: 방지만 배분에 영향, 그 외 대체 효과는 피해 처리 시 적용). 원문: "When assigning damage during the combat damage step, replacement effects that would apply to the resulting damage are considered to apply to the assignment instead." 영향: Lotus Trap(패치노트 명시; 세트 불확실) 등 피해 증가/감소 대체 효과가 있는 유닛의 치명 피해 배분 계산.
- [이벤트 정의] 이벤트 = 게임 액션 수행 또는 오브젝트 상태 변화로 생기는 단일 순간. 원문: "An event is the singular moment that results from a Game Action being performed or from a Game Object changing state."
- [대체 효과 분류] 세 종류 텍스트를 대체 효과로 규정: ① "유닛이 ~한 상태로 등장/등장하면서 ~한다" → 정상 등장을 대체; ② "~할 때(as) ~한다" → 이벤트 + 게임 액션으로 대체; ③ "then banish it / then recycle it" → 파이널라이즈된 체인 아이템이 자기 실행 외 이유로 체인을 떠날 때 지정 액션으로 대체. 원문: "Abilities that describe how a unit enters, or an action to be performed as a unit enters, are replacement effects." 영향: 등장 시 상태 지정 Origins 유닛, "then banish/recycle" 스펠(Origins 카드 유무 불확실).
- [치명 피해] Lethal Damage 정의를 문서 전체에서 단일 개념으로 통일(한 곳 수정이 전부에 적용). 원문: "Lethal damage has been unified across the document" 영향: 치명 피해 정의를 바꾸는 효과(Elder Dragon 언급; 세트 불확실).
- ["your damage"] 플레이어의 피해 = 그 플레이어가 표시한 피해. 원문: "Game Effects may refer to a player's Damage. This means the Damage marked by that player." 영향: "your damage" 참조 Origins 카드 유무 불확실.

### 비용
- [비용/자원 지불] 지시에 의한 에너지·파워 지불은 **항상 선택 사항**(풀에 있어도 안 낼 수 있음; 안 내면 지시 무시). 다른 종류의 비용은 여전히 강제. 원문: "When a player is instructed to Pay a resource, that player may remove that resource from their Rune Pool if it exists there. If they choose not to, the instruction is ignored." 영향: Promising Future, Cursed Sarcophagus(패치노트 명시; 세트 불확실) 등 "pay [E]" 지시 및 비용을 무시하지 않고 카드를 플레이시키는 효과.
- [비용/파워 도메인] 다중 도메인 카드(시그니처 카드)의 [C] 파워 비용은 **그 카드의 도메인 파워로만** 지불(이전: 아무 도메인 파워). 텍스트 내 [A]는 여전히 아무 파워. 원문: "A [C] shorthand on a card with multiple Domains is processed as any power of that card's Domains." 영향: Origins 시그니처 카드 전부 — 파워 지불 적법성 검사 변경.
- [적용 비용(Applied Costs)] 카드 플레이 외 액션에 비용을 붙이는 능력 정의·타이밍 규정. 원문: "The costs applied by these abilities are applied costs." 영향: Mageseeker Investigator(패치노트 명시; 세트 불확실).

### 전장 상태·정복
- [Contested 해제] 클린업에서 contested를 적용한 플레이어의 유닛이 없고 결전/전투가 없으면 contested 제거(이전: 규정 부재로 영구 contested). 원문: "In a cleanup, remove Contested status from each Battlefield without Units controlled by the player who applied Contested to that Battlefield and without a Showdown or Combat ongoing there." 영향: 이동 격발로 전장에 간 유닛을 Flash(Origins)로 기지 귀환시키는 경우.
- [Contested 재적용] 위 해제 결과, 통제하지 않는 비-contested 전장에 유닛이 있으면 그 통제자가 contested 재적용. 원문: "If as a result of the removal of Contested status there are Units located at an uncontested Battlefield that their controller does not control, their controller applies Contested status to that Battlefield."
- [2v2] 팀 승점 공유; 득점 단계에 전장 통제 확인, 팀원이 통제 중인 전장은 그 턴 득점 불가·최종 득점 규칙에 산입. 원문: "Points are shared by a team in the 2v2 game mode." 영향: 2v2 모드 구현 시에만.
- [전장 재사용] Bo5 4·5게임 및 무승부 후 게임에서 제거된 전장 재제시 허용. 원문: "If no player won a game, the battlefields presented for that game may be reused in a subsequent game." 영향: 매치 단위 기능 구현 시에만.

### 키워드·토큰
- [가속(Accelerate)] 가속 = 선택적 추가 비용 + 비용 지불 시 생성되는 지연 대체 효과. 파이널라이즈 중 키워드를 잃어도 비용을 냈으면 준비 상태로 등장. 원문: "Even if the unit loses the accelerate keyword during the finalization process, as long as the cost was paid, that unit will still enter ready." 영향: Origins 가속 유닛 + 키워드 제거 효과.
- [토큰] Token은 더 이상 상위 유형(supertype)이 아니라 카드처럼 **본질적 범주**; 토큰은 어떤 수단으로도 토큰성을 잃지 않고 카드는 토큰이 될 수 없음. 원문: "Token Game Objects cannot lose their token nature by any means." 영향: Origins 토큰의 데이터 모델(supertype 필드 → 별도 플래그); 복사 효과가 없는 Origins에서는 기능 변화 미미.
- [카드 이름 지정] 카드/유형/태그 이름 지정 절차 신설. 원문: "Naming cards, types, and tags added." 영향: Origins에 이름 지정 카드가 있는지 불확실.
- [무시 효과] 특정 능력/효과를 "무시"하는 효과 클래스 신설(비활성 텍스트 기반). 영향: Origins 카드 해당 없음으로 추정(불확실).
- [다중 유형 카드] 카드 유형 2개 이상인 카드 규정 신설. 영향: Origins 해당 없음.

## Origins 시뮬레이터에 영향 없음(참고)
- Unleashed 신규 키워드·시스템: XP(자원), Hunt, Level, Ambush, Unique(Spiritforged 카드용 키워드 규정), Copy 효과(복사 가능 특성·복사의 복사), Replace/Swap back(Unleashed 카드용), 액션 워드 백커(Stun/Buff/Predict 표기), List(태그 이름 지정; Vendetta 노트에서 언급).
- Vendetta 신규 키워드·시스템: Empower / Empowered / Disempower(액션·상태), Flow, Burn(액션), Skip(액션), Untargetable(효과 클래스 자체), Ignoring effects, 다중 유형 카드, Naming cards/types/tags.
- 패치노트가 언급한 신규 세트 카드: Diana, Lunari(Unleashed), Svellsongur(Spiritforged, 복사 관련 언급), Elder Dragon(치명 피해 정의; 세트 불확실).
- 토너먼트/매치 규칙: Bo5 전장 재사용, 2v2 클린업(시뮬레이터가 1v1 단일 게임만 다루면 무관).
