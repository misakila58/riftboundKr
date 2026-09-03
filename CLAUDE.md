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
| engine.js (~1900줄) | 게임 규칙·상태(G). UI 없음. 결전 중 카드/능력은 체인(LIFO)에 적재 — **적재자가 우선권 유지(연속 적재 가능), 패스로만 이전**. 양측 패스 시 하나씩 해결(사이마다 [반응] 응수). [추가] 자원 능력은 체인에 안 쌓이고 즉시 해결. 중립 '주문' 플레이에 reactionWindow(모든 [반응] 응수, 재귀 체인) — **유닛·도구는 즉시 해결·응수 불가(333.1.c)**. **숨김(뒷면) 카드는 뒷면 동안 [반응] 취급(739.1)** — 종류 무관 결전·체인 중에도 playHidden 가능(전부 playCardFromHand fromHidden 경로: 비용 0, 유닛은 그 전장, 주문은 체인 적재), 통제 상실(정복·무주공산 모두) 시 폐기(106.4.e). 경합 적용자는 bf.contestedBy로 추적(공격자 지정). 무혈 결전 후 양측 잔존 → 새 전투 결전. **정복=통제를 새로 얻을 때만(446.1) — 방어 성공(재확립)은 무득점** (공식 Q&A 확인) | newGame, might, TF, collectStatics, dealDamage, fireEvent, reactionWindow(구 counterWindow), showdownPass/resolveChainItem/showdownActed(p), resolveSpellEffects, killUnit, execOps, releaseEmptyBattlefields, markContested |
| ui.js (~850줄) | DOM 렌더·입력. 선택 프롬프트는 routedPick 경유. **손패 공개 규칙은 handFaceUp() 한 곳에만 둔다** — 리플레이 관전=양측 공개 / 온라인=내 것만 / BOT 대전=봇 손패 가림('손패 확인' 토글로 보기 전용 공개) / 로컬 핫시트=양측 공개(그래야 번갈아 조작 가능). 봇 좌석 조작 차단은 canInitiate() | cardMiniEl, unitEl, handFaceUp/botHandHidable, canInitiate, onHandClick, showUnitMenu, executeMove, updateButtons, attachDropZone(드래그이동), attachZoom(확대) |
| main.js (~600줄) | 화면 전환·메뉴·덱편집·로비 | showScreen, buildDeck, openEditor, initLobby, p2p* |
| effects.js (~550줄) | 카드 텍스트 파서 → FX (298장 전부 자동화, manual 0장) | compileCard, parseOp, parseMiscClause(상시효과), TRIGGER_PATTERNS, SCRIPTS, BF_STATIC |
| cardscripts.js (~500줄) | 파서로 안 되는 카드의 개별 스크립트 + 전용 op | SCRIPTS[n] 추가분, EXTRA_OPS (engine execOps default에서 호출) |
| net.js / p2p.js | 서버 릴레이 / WebRTC 직결 (락스텝 동기화). **채팅('t:chat')**: 릴레이는 양쪽 에코(발신자 포함), P2P는 에코 없음(발신자가 로컬 표시) — UI는 ui.js chatShow/NET.onChat, 입력은 #chat-bar(온라인 전용, updateButtons가 표시 제어) | NET 객체, P2P.hostViaCode·joinViaCode(6자리 방 코드), _pack/_unpack(SDP 압축 ~100자, 구버전 코드 호환) |
| signal.js (~230줄) | 6자리 방 코드 시그널링. offer/answer만 잠깐 중계하고 연결되면 닫음 | SIGNAL.open/newCode/normalize, 전송 2종: 공개 MQTT(기본·무설정) / 자체 WS(server/signal-worker) |
| tutorial.js | 튜토리얼 시나리오 | TUT, tutSteps |
| bot.js | BOT 대전(오프라인 전용). 900ms 턴 드라이버 + UI.pick* 래핑. **판단도 진행 순서도 하지 않고 전부 POLICY.step에 위임** | BOT, BOT_LEVELS(5티어), botStep, botShowdown, startBotGame |
| bot-policy.js | 봇의 모든 선택 + **턴 진행 순서까지**(POLICY.step/nextAction/runAction). **DOM 의존 0 → 브라우저와 tools/selfplay.js가 같은 파일을 씀**(사본 금지 — 예전엔 양쪽이 각자 순서를 들고 있어 기능 추가 때마다 어긋났다). POL_TIERS로 난이도별 능력 게이팅, ab 스위치로 기능별 분리 측정 | POLICY, POLICY.step, polTier, polCanPlay, polAbList/polAbLegal, POL_TIERS |
| bot-eval.js | 국면 평가(승점 단위) + 전투 임계 계산. 이동·수비 판단의 공통 잣대. BOT_W에는 평가 가중치와 정책 손잡이(playCost·moveNeed·sdMargin·peek*)가 함께 있고 전부 `--w`로 스윕 가능 | BOT_W, evalState, evalCombat(extraDef), evalAttackValue |
| bot-sim.js | 시뮬레이션 샌드박스 — G 복제 후 엔진을 규칙 신탁으로 사용. 온라인 중 진입 금지·해시 가드. **현재 모든 티어에서 미사용**(아래 '탐색' 항목 참조) | SIM, cloneG, simTry, simBest |
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
- **카드 풀**: OGN(Origins) 298장 + OGS(증명의 전장, Origins: Proving Grounds) 24장 = 322장. OGS는 n=300+수집번호(301~324), 수집은 `tools/fetch-ogs.js`, 번역은 `tools/data/tr_out_ogs.json`. **시그니처 카드**(티버스·최후의 전사 등 4장)는 같은 챔피언의 전설 덱에만 — buildDeck/에디터/selfplay/서버 4곳 모두에서 태그 일치 검사.
- **룰 절충(의도된 단순화 — 룰북 대조 감사 2026-08 완료, 전 카드 원문 대조 전수 감사 2026-08-27 완료·47건 수정)**: ① 격발(트리거) 능력은 체인에 쌓이지 않고 즉시 해결(공식은 Initial Chain·응수 가능, 방어자 트리거 선해결) ② 복수 전장 동시 경합 시 인덱스 순 고정(공식은 턴 플레이어 선택) ③ 결전 체인의 대상 지정은 해결 시점(공식은 플레이 시점) ④ 중립 응수 창의 카운터/탈취 주문은 즉시 확정 — 카운터에 재응수(카운터의 카운터) 불가 ⑤ 중립 닫힌 상태에서 [반응] '활성화 능력' 발동 UI 없음(주문만 응수 가능) ⑥ [탱커]를 부여받은 '마지막 배분' 유닛(케이틀린)은 항상 마지막 배분(공식은 선택 허용). 룰북 원문: `tools/data/rules1.txt` 1107~1610행(상태·우선권·체인·결전), 3290~3490행(전투).
- **BOT 대전의 좌석 경계**: 오프라인은 로컬 핫시트 때문에 좌석을 가리지 않는 것이 기본이라, 봇 대전에서 봇 좌석을 지키는 것은 `botIs(p)` 검사뿐이다 — 손패 렌더(`handFaceUp`), 조작(`canInitiate`), 능력 메뉴(전설·도구·유닛), 전장 클릭(`playHidden`) 네 곳. `BOT.active`가 대전 중에 꺼지면 이 방어가 한꺼번에 풀리므로(봇도 멈춘다) **진행 중인 판에서 `BOT.active=false`를 하지 말 것**. 새 판은 `startBotGame`→`newGame` 래퍼가 알아서 초기화한다.
- 카드 이미지: `node tools/fetch-card-images.js` 가 Riot CDN → `client/web/assets/cards/*.webp`(480w, 약 11MB)로 받고 `web/js/imgmap.js`를 생성. **둘 다 gitignore** — 빌드(predist)가 자동으로 확보하고, 없으면 앱이 CDN에서 직접 불러온다(그래서 없어도 동작함).

## 실행 (참고 — 요청 시에만)

- **봇 검증**: `node tools/selfplay.js -n 600 --baseline` (옛 봇 대비) · `-a expert -b skilled` (티어 대결) · **`--offb k1,k2` (B에서만 그 기능을 끔 = 한계 기여도, 새 기능 검증은 이쪽)** · `--only/--off` (옛 봇 대비 절대 기여도) · `--on k` (기본이 꺼진 기능 재측정) · `--w key=val` (BOT_W 스윕) · `--dbg`/`--diag`. 출력의 `행동_판당`으로 "그 기능이 애초에 발동은 하는가"를 먼저 확인할 것 — 승률이 안 움직일 때 원인이 '효과 없음'인지 '한 번도 안 걸림'인지 구분된다. 동일 정책끼리 붙이면 50.0%가 나와야 정상(편향 점검).
- **봇 실측 기록 (2026-08, 각 1200~3000판)**: 활성화 능력 +3.1%p · 챔피언 우선순위 +4.2%p · 배치 규칙 +1.5%p(유의 아님) · [숨겨짐]·결전 자금조달·최종점수규칙·수비보강 = 중립(발동 빈도 자체가 낮음, 다만 규칙상 옳아 유지) · **reserve −4.1%p, option −1.9%p, 값싼 카드 우선(playCost↑) −8%p → 켜지 말 것**.
- **봇 강화 추가 실험 (2026-08-29)**: ① BOT_W 자동 튜닝(SPSA 20회·총 7,400판, tools/tune-spsa.js) → 검증 1000판 50.4% = 무효과, 기존 수동 가중치가 이미 국소 최적 → 미채택. ② 정밀 결전 판단(sdx: 패스 시 전투 결과를 그대로 계산, 결과를 바꾸는 트릭만 최소 비용으로) → --offb 1500판 49.5% = 중립. 발동 빈도(판당 0.6회)가 낮아 승률에 안 잡히지만 트릭 낭비를 막는 옳은 행동이라 유지. 같이 넣은 evalCombat 교환손익 버그 수정(처치 대상과 손실 합산 불일치)은 순수 버그 픽스. **결론: 휴리스틱 정책은 정체 상태 — 큰 향상은 충실한 시뮬레이터 기반 탐색 재설계(과거 2회 실패) 없이는 어렵다.**
- **탐색 재설계 성공 (2026-08-30, '턴 플랜 탐색')**: 과거 2회 실패(1수 45~50% / 2수 36.7% — 원인: ①롤아웃 미래 평가를 현재 정적 평가와 비교해 조기 턴 종료 남발 ②미시 행동 후보가 평가 노이즈에 묻힘)를 뒤집은 설계 — 턴 시작에 1회, 거시 플랜(기본/공격 자제/전장별 집중 공격 ≤4개)을 '내 턴 전체+상대 턴 전체' 휴리스틱 롤아웃으로 같은 깊이에서 비교(polPlanTurn), 비열람 티어는 상대 손패 결정화. 선택 플랜은 movePlan이 존중({p,tc} 스코프). 1차(후보 4·표본 1·턴당 1회 계획): expert +1.6 · master +4.3 · oracle +1.4%p. **2차 심화(수당 예산 5초, 후보 7=기본/자제/집중3/총공격2, 결정화 3표본 평균 — 표본별 시드 필수(같은 rng면 셔플 동일), 이동 직후 재계획): 각 800판 실측 expert +8.5%p(58.5%) · master +5.6%p(55.6%) · oracle +8.1%p(58.1%) — 합산 +7.4%p**. expert~oracle `think:1` 채택(budget 2000/5000/5000ms), 미러 편향 50.0% 확인. 주의: 대조군도 같은 평가 함수를 공유하므로 이 수치는 하한 — 평가의 공통 맹점은 탐색으로 안 뚫린다. 브라우저 예산 전파는 botSync(bot.js)가 담당.
- 클라 개발 실행: `cd client && npm start` / 웹 확인: `npx http-server client/web -p 8777`
- 서버: `cd server && node server.js`
- 빌드: 클라 `npm run dist`, 서버 `node build-dist.js --exe`
- **패치노트**: `docs/패치노트.txt` — 릴리스마다 갱신해 드라이브에 exe/zip과 함께 업로드. **모바일(APK) 관련 항목은 배포용 패치노트에 쓰지 말고 `docs/패치노트-모바일-보류.txt`에 기록**(사용자가 나중에 추가를 요청하면 그때 합침, 2026-08-27 지시).
- **드라이브 업로드 (사용자가 요청할 때만 — 빌드 루틴에 넣지 말 것)**: portable.exe를 zip으로도 압축해 **exe와 zip 둘 다** `gdrive:리프트바운드/`에 올린다(사용자 요청 2026-08-25, 매번). **서버 zip(riftbound-server-win.zip)은 드라이브에 올리지 말 것** — 자가 서버 구동 유저 없음(사용자 지시 2026-08-31). `Compress-Archive`로 zip 생성 → `rclone copy "client/dist/RiftboundSim-<버전>-portable.exe" "gdrive:리프트바운드/"` + zip 동일. rclone 원격 `gdrive`는 misakila58@gmail.com 계정으로 인증돼 있음(2026-08 설정). rclone이 PATH에 없으면 `C:\Users\SHIFTUP\AppData\Local\Microsoft\WinGet\Packages\Rclone.Rclone_*\rclone-*\rclone.exe` 직접 호출.
- 모바일 APK: `cd mobile && npm i && npm run sync && cd android && gradlew assembleDebug` (JAVA_HOME=포터블 JDK17 `C:/Users/SHIFTUP/android-build/jdk-17.0.20+8`, sdk.dir은 android/local.properties — `C:/Users/SHIFTUP/android-build/sdk`). android/·www/는 생성물(gitignore), 산출물은 `release/`에 복사
- 클라 빌드 시 `predist`(build-prep.js)가 **패치 버전 자동 +1** 하고 `web/js/buildinfo.js`(생성물)에 버전·빌드 일시를 기록 → 첫 화면 우하단에 표시. 빌드 후 package.json/buildinfo.js 변경분도 함께 커밋할 것.
