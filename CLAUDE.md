# 리프트바운드 시뮬레이터 (Riftbound KR)

TCG 리프트바운드 한글판 대전 시뮬레이터. Electron 클라이언트 + Node 서버. 상세 설명은 README.md (요청 시에만 읽기).

## 작업 규칙 (중요 — 사용량 절약)

- **빌드 금지**: `npm run dist`, `build-dist.js` 등 빌드는 사용자가 명시적으로 요청할 때만 실행.
- **git 커밋/푸시 금지**: 사용자가 "커밋해줘"/"올려줘"라고 명시할 때만. 작업 후에는 변경 파일 목록만 알려주기.
- **브라우저 검증 금지**: 미리보기/스크린샷 검증은 요청 시에만. 기본은 코드 수정까지만 하고 확인 방법을 한 줄로 안내.
- **읽기 최소화**:
  - `client/web/js/cards.js`(171KB)와 `server/cards.json`, `package-lock.json`, `tools/data/`는 **절대 통째로 읽지 말 것**. 필요하면 Grep으로 해당 카드만 검색.
  - 큰 파일(engine.js, ui.js)은 아래 코드 지도로 함수명을 찾고 → Grep으로 위치 확인 → Read offset/limit로 그 부분만 읽기.
  - 탐색 에이전트(Explore 등) 대신 아래 지도를 먼저 활용.
- **답변 간결하게**: 요약은 3~5줄이면 충분.

## 코드 지도 (client/web/js/)

| 파일 | 역할 | 핵심 함수/상수 |
|---|---|---|
| engine.js (~1900줄) | 게임 규칙·상태(G). UI 없음. 결전 중 카드/능력은 체인(LIFO)에 적재 — **적재자가 우선권 유지(연속 적재 가능), 패스로만 이전**. 양측 패스 시 하나씩 해결(사이마다 [반응] 응수). [추가] 자원 능력은 체인에 안 쌓이고 즉시 해결. 중립 '주문' 플레이에 reactionWindow(모든 [반응] 응수, 재귀 체인) — **유닛·도구는 즉시 해결·응수 불가(333.1.c)**. 경합 적용자는 bf.contestedBy로 추적(공격자 지정). 무혈 결전 후 양측 잔존 → 새 전투 결전. **정복=통제를 새로 얻을 때만(446.1) — 방어 성공(재확립)은 무득점** (공식 Q&A 확인) | newGame, might, TF, collectStatics, dealDamage, fireEvent, reactionWindow(구 counterWindow), showdownPass/resolveChainItem/showdownActed(p), resolveSpellEffects, killUnit, execOps, releaseEmptyBattlefields, markContested |
| ui.js (~800줄) | DOM 렌더·입력. 선택 프롬프트는 routedPick 경유 | cardMiniEl, unitEl, onHandClick, onUnitClick, showUnitMenu, executeMove, updateButtons, attachDropZone(드래그이동), attachZoom(확대) |
| main.js (~600줄) | 화면 전환·메뉴·덱편집·로비 | showScreen, buildDeck, openEditor, initLobby, p2p* |
| effects.js (~550줄) | 카드 텍스트 파서 → FX (298장 전부 자동화, manual 0장) | compileCard, parseOp, parseMiscClause(상시효과), TRIGGER_PATTERNS, SCRIPTS, BF_STATIC |
| cardscripts.js (~500줄) | 파서로 안 되는 카드의 개별 스크립트 + 전용 op | SCRIPTS[n] 추가분, EXTRA_OPS (engine execOps default에서 호출) |
| net.js / p2p.js | 서버 릴레이 / WebRTC 직결 (락스텝 동기화) | NET 객체 |
| tutorial.js | 튜토리얼 시나리오 | TUT, tutSteps |
| bot.js | BOT 대전(오프라인 전용). 900ms 턴 드라이버 + UI.pick* 래핑. **판단은 하지 않고 전부 POLICY에 위임** | BOT, BOT_LEVELS(5티어), botStep, botShowdown, startBotGame |
| bot-policy.js | 봇의 모든 선택(대상·확인·수치·옵션·손패·응수·멀리건·플레이·이동·결전). **DOM 의존 0 → 브라우저와 tools/selfplay.js가 같은 파일을 씀**(사본 금지). POL_TIERS로 난이도별 능력 게이팅, ab 스위치로 기능별 분리 측정 | POLICY, polTier, polCanPlay, POL_TIERS |
| bot-eval.js | 국면 평가(승점 단위) + 전투 임계 계산. 탐색·이동 판단의 공통 잣대 | BOT_W, evalState, evalCombat, evalAttackValue |
| bot-sim.js | 시뮬레이션 샌드박스 — G 복제 후 엔진을 규칙 신탁으로 사용. 온라인 중 진입 금지·해시 가드. **현재 기본 티어에서는 미사용**(1수 탐색이 휴리스틱을 못 넘어 think=0) | SIM, cloneG, simTry, simBest |
| botdecks.js | 실제 대회 덱 데이터 — 메타(부스터팩)별 구조, 원본 검증. 덱 브라우저(showTourneyDecks, main.js)와 봇 상대 덱 공용 | TOURNAMENT_METAS, BOT_DECKS(파생) |
| loc.js | 한글화 상수·아이콘 | KEYWORDS_KO, DOMAIN_*, renderIcons |
| banlist.js | KR 밴 리스트 데이터 (글로벌 공통). **server.js의 BANNED와 함께 갱신** | BANLIST, isBanned, deckBannedCards |
| fx.js | 연출(이펙트). **표시 전용 — G를 건드리지 않고 await도 하지 않는다**(락스텝·봇 속도 영향 방지). 유닛 연출은 재렌더에도 살아남게 #fx-layer에 별도로 띄움 | UI.fx.unit/cast/turnEnd/priority/score/check |
| imgmap.js | 로컬 카드 이미지 목록 (**생성물·gitignore**). 없으면 CDN 폴백 | IMG_LOCAL |
| replay.js | 리플레이 기록·저장·재생. **index.html 맨 마지막에 로드**(newGame/UI.log/UI.render/UI.showVictory를 감쌈). 재시뮬레이션이 아니라 상태 스냅샷 방식 | REPLAY, RPStore, rpSerialize, rpBuildFile/rpParseFile |
| cards.js | **생성물** (카드 DB, 읽기 금지) | tools/build-cards.js가 생성 |

- 스타일: `client/web/css/style.css` 단일 파일. 테마 색은 상단 `:root` 변수(우드 테이블 테마)만 수정.
- 화면 구조: `client/web/index.html` (connect/login/menu/decks/editor/lobby/p2p/setup/game 스크린).
- 서버: `server/server.js` 단일 파일 (계정 REST + WS 릴레이).
- 리플레이: 데스크톱은 `client/replay-store.js`(메인 프로세스 fs) + `preload.js`의 `desktop.replay.*` IPC로 `문서\RiftboundSim\Replays\*.rbr`에 저장, 웹/APK는 IndexedDB(`rb_replays`). **client 루트에 파일을 추가하면 package.json의 `build.files`에도 넣을 것** (안 넣으면 패키징에서 빠져 앱이 시작조차 못 함).
- 카드 데이터 수정: `tools/data/`의 번역본 수정 → `node tools/build-cards.js` (요청 시에만).
- **룰 절충(의도된 단순화 — 룰북 대조 감사 2026-08 완료)**: ① 격발(트리거) 능력은 체인에 쌓이지 않고 즉시 해결(공식은 Initial Chain·응수 가능, 방어자 트리거 선해결) ② 복수 전장 동시 경합 시 인덱스 순 고정(공식은 턴 플레이어 선택) ③ 결전 체인의 대상 지정은 해결 시점(공식은 플레이 시점). 룰북 원문: `tools/data/rules1.txt` 1107~1610행(상태·우선권·체인·결전), 3290~3490행(전투).
- 카드 이미지: `node tools/fetch-card-images.js` 가 Riot CDN → `client/web/assets/cards/*.webp`(480w, 약 11MB)로 받고 `web/js/imgmap.js`를 생성. **둘 다 gitignore** — 빌드(predist)가 자동으로 확보하고, 없으면 앱이 CDN에서 직접 불러온다(그래서 없어도 동작함).

## 실행 (참고 — 요청 시에만)

- **봇 검증**: `node tools/selfplay.js -n 600 --baseline` (옛 봇 대비 개선폭) · `-a expert -b skilled` (티어 대결) · `--only/--off` (기능별 분리 측정) · `--diag` (후보 평가값). 동일 정책끼리 붙이면 50.0%가 나와야 정상(편향 점검).
- 클라 개발 실행: `cd client && npm start` / 웹 확인: `npx http-server client/web -p 8777`
- 서버: `cd server && node server.js`
- 빌드: 클라 `npm run dist`, 서버 `node build-dist.js --exe`
- 모바일 APK: `cd mobile && npm i && npm run sync && cd android && gradlew assembleDebug` (JAVA_HOME=포터블 JDK17 `C:/Users/SHIFTUP/android-build/jdk-17.0.20+8`, sdk.dir은 android/local.properties — `C:/Users/SHIFTUP/android-build/sdk`). android/·www/는 생성물(gitignore), 산출물은 `release/`에 복사
- 클라 빌드 시 `predist`(build-prep.js)가 **패치 버전 자동 +1** 하고 `web/js/buildinfo.js`(생성물)에 버전·빌드 일시를 기록 → 첫 화면 우하단에 표시. 빌드 후 package.json/buildinfo.js 변경분도 함께 커밋할 것.
