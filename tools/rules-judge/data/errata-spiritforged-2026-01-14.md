# Riftbound 공식 에라타·해설 — Spiritforged FAQ (2026-01-14)

출처: https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-faq/ (Riot Games 공식). 이 문서의 내용은 **룰북(2025-12-01판)과 그 이전 커뮤니티 판정보다 우선**한다. 같은 날 별도 문서 "Riftbound Spiritforged Errata"도 공개됨. 이후 문서: Unleashed Core Rules 패치노트(2026-03-31), Unleashed Errata(2026-04-03), Unleashed FAQ(2026-04-30) — 조항 번호가 바뀌었을 수 있다(RiftJudge가 인용하는 811.x 등).

## Origins 카드에 직접 영향

### 떨어지는 별 (Falling Star #29) · 이케시아 소나기 (Icathian Rain #248) — 반사 격발 취소
게임 디렉터(Dave Guskin): "두 카드를 반사 격발로 바꾼 것은 실수였다. 다른 주문과 똑같이 동작하도록 바꾼다 — **대상을 전부 미리 고르고, 상대는 그 전에 응수하며, 해결 때 각 유닛이 피해를 받는다. 같은 유닛을 여러 번 골라도 되고 다른 유닛을 골라도 된다.**"

개정 텍스트:
- Falling Star: `Deal 3 to a unit. Deal 3 to a unit. (You can choose different units.)`
- Icathian Rain: `Deal 2 to a unit.` ×6 `(You can choose different units.)`

→ 이 에라타 이전 판정(RiftJudge #1159·#3359·#14·#6282 등 "해결 때 격발마다 대상 선택·사이마다 응수")은 더 이상 적용되지 않는다.

### 룰 735.1.c 개정 — [굴절]은 고를 때마다
> "Spells and abilities an opponent controls that choose me cost an amount of Power equal to [Deflect Value] more to play as an additional cost **for each time they choose me**."
→ 한 주문이 같은 유닛을 여러 번 고르면 굴절 비용도 그 횟수만큼.

### 증원 (Reinforce #62) 개정
> "Look at the top 5 cards of your Main Deck. You may banish a unit from among them, then play it, reducing its cost by [5]. Recycle the remaining cards."
→ 덱에서 플레이하는 카드는 먼저 추방한 뒤 플레이(유망한 미래·눈먼 분노와 같은 처리). 플레이 못 하면 추방 상태로 남는다.

### 위력 감소 "최소 1"
- Spiritforged부터 "to a minimum of 1"을 쓰지 않지만 **Origins 카드(혼미 등)는 그대로**(에라타 없음).
- 유닛의 위력은 0 이하가 될 수 있다(예: 삼두정 전쟁 야영지 +1 상태에서 혼미(-1 스냅샷) → 이동하면 0). 0 이하 위력 유닛은 자동으로 죽지 않으며, 피해 1을 받으면 죽는다. 음수 위력은 전투 피해에 0으로 기여하지만 되돌리려면 그만큼 +가 필요하다.

## 규칙 해설 (Origins 플레이에도 적용)
- **전투의 승패**: 전투 피해 후 한쪽만 유닛이 남으면 그쪽이 이김(주문으로 상대를 다 치워도 승리). 양쪽 다 남거나 둘 다 없으면 무승부(양쪽 남으면 공격자 귀환).
- **적대적 인수(Hostile Takeover)·폭풍을 부르는 자 등으로 "상대가 통제하지만 유닛은 없는 전장"에 내 유닛만 있는 경우**: 무혈 결전이 열린다(통제는 결전을 여는 클린업에서 잃는 것으로 본다).
- **[굴절]은 선택 비용이 아니다**: 격발 능력은 고르지 않는 것으로 피할 수 있지만, 고르면 반드시 낸다.
- **토큰의 비용은 0으로 취급**, 토큰도 재활용 대상이 될 수 있다(재활용 후 소멸).
- **Repeat**는 주문의 '지시'를 반복한다; 반복 비용은 인쇄 비용 기준이라 비용 감소가 두 번 적용되지 않는다.

## Spiritforged 카드 에라타 (참고 — Origins 시뮬레이터 풀 밖)
Rek'Sai, Swarm Queen · Void Burrower · Void Rush(추방 후 플레이) · Arise!·Rell, Magnetic("Then do this:" 반사 격발) · Blood Rush("this turn" 추가) · Deathgrip(첫 아군은 비용이 아니라 대상) · Edge of Night · Janna, Savior("up to") · Jax, Unmatched · Kato the Arm("another") · Tianna Crownguard(점수만 막음, 정복·유지 격발은 됨) · Yone, Blademaster(정복 직전 무주공산이면 격발).
