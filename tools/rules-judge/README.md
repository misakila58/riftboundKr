# riftbound-rules-judge — 리프트바운드 룰 판정 자료 묶음

Claude Code(또는 파일을 읽을 수 있는 다른 AI 코딩 도구)에 넣어 두면, 리프트바운드 규칙 질문에 **룰북 원문과 커뮤니티 판정(RiftJudge)을 찾아 근거를 대며** 답하게 하는 패키지입니다. 게임 시뮬레이터가 아니라 자료+검색 스크립트+지침만 들어 있습니다.

## 설치 (2분)

1. 이 폴더(`riftbound-rules-judge/`)를 프로젝트 안 아무 데나 둡니다. 예: `docs/riftbound-rules-judge/`
2. Node.js가 있어야 합니다 (`node -v`로 확인, 18 이상 권장).
3. 프로젝트의 `CLAUDE.md`(없으면 새로 만들기)에 아래 한 단락을 추가합니다. 경로는 실제 위치로 바꾸세요.

```
## 리프트바운드 룰 질문
리프트바운드(Riftbound TCG) 규칙·카드 효과·판정 질문을 받으면 먼저 `docs/riftbound-rules-judge/RIFTBOUND_JUDGE.md`를 읽고,
그 지침대로 `node docs/riftbound-rules-judge/search.js`로 룰북·RiftJudge 판정·카드 원문을 확인한 뒤 근거(조항 번호·판정 번호)를 붙여 한국어로 답한다. 추측으로 답하지 않는다.
```

4. 이제 "천 개 꼬리의 감시자로 -3 받은 유닛에 +2 버프를 주면 몇이 돼?" 같은 질문을 하면 됩니다.

CLAUDE.md를 쓰지 않는 도구라면, 질문할 때 "RIFTBOUND_JUDGE.md 지침대로 답해줘"라고 붙여도 됩니다.

## 직접 검색하기 (사람도 쓸 수 있음)

```
node search.js "cull the weak"          # 카드·판정·룰북 통합
node search.js --card 약자               # 카드 (한글/영문/번호)
node search.js --qa "zhonya simultaneous" --n 15
node search.js --id 10900                # 판정 전문
node search.js --rule 356.3.e            # 룰 조항
```

## 들어 있는 것

| 파일 | 내용 | 출처 |
|---|---|---|
| `RIFTBOUND_JUDGE.md` | AI용 답변 지침 (절차·형식·자주 틀리는 포인트) | — |
| `search.js` | 통합 검색 스크립트 (의존성 없음) | — |
| `data/rules.txt` | Riftbound Core Rules 영문 원문 (Last Updated **2026-07-16**, Vendetta판 — 최신) | Riot Games 공식 종합 규칙 (Rules Hub PDF) |
| `data/rules-2025-12-01.txt` | 이전 판(Spiritforged) — 옛 번호 대조용 | 〃 |
| `data/errata-spiritforged-2026-01-14.md` | 공식 에라타·해설 요약 (룰북·판정보다 우선) | playriftbound.com Spiritforged FAQ |
| `data/riftjudge.jsonl` | 커뮤니티 판정 Q&A 11,237건 (verified 10,203 · deprecated 1,034), 2026-09-09 수집 | https://app.riftjudge.com (공개 API) |
| `data/cards.json` | OGN 298장 + OGS 24장 카드 데이터·영문 원문 | Riftcodex API |
| `data/keywords.json` | 키워드 한↔영 대응표 | 리프트바운드 시뮬레이터(한글판) |

## 유의

- 룰북·카드 텍스트는 Riot Games, Inc.의 저작물이며 이 묶음은 비영리 팬 자료입니다. Riot Games가 보증하지 않습니다. 재배포 시 이 고지를 유지해 주세요.
- RiftJudge 판정은 커뮤니티 검증본이지 Riot 공식 판정이 아닙니다. 지침은 룰북을 우선하도록 되어 있습니다.
- 룰북은 2026-07-16판(최신), 에라타 2026-01-14, 판정은 2026-09-09 수집분입니다. 갱신 방법은 `RIFTBOUND_JUDGE.md` 마지막 항목 참고.
- 만든 곳: 리프트바운드 시뮬레이터(한글판) 프로젝트 — 문의 misakila58@gmail.com
