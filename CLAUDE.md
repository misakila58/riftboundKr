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
| engine.js (~1200줄) | 게임 규칙·상태(G). UI 없음 | newGame, makeUnit, might, drawCard, addPoints, placeUnit, 페이즈/전투 처리 |
| ui.js (~800줄) | DOM 렌더·입력. 선택 프롬프트는 routedPick 경유 | cardMiniEl, unitEl, onHandClick, onUnitClick, showUnitMenu, executeMove, updateButtons, attachDropZone(드래그이동), attachZoom(확대) |
| main.js (~600줄) | 화면 전환·메뉴·덱편집·로비 | showScreen, buildDeck, openEditor, initLobby, p2p* |
| effects.js (~450줄) | 카드 텍스트 파서 → FX. 전설 전용은 SCRIPTS | compileCard, parseOp, TRIGGER_PATTERNS, SCRIPTS, BF_STATIC |
| net.js / p2p.js | 서버 릴레이 / WebRTC 직결 (락스텝 동기화) | NET 객체 |
| tutorial.js | 튜토리얼 시나리오 | TUT, tutSteps |
| loc.js | 한글화 상수·아이콘 | KEYWORDS_KO, DOMAIN_*, renderIcons |
| cards.js | **생성물** (카드 DB, 읽기 금지) | tools/build-cards.js가 생성 |

- 스타일: `client/web/css/style.css` 단일 파일. 테마 색은 상단 `:root` 변수(우드 테이블 테마)만 수정.
- 화면 구조: `client/web/index.html` (connect/login/menu/decks/editor/lobby/p2p/setup/game 스크린).
- 서버: `server/server.js` 단일 파일 (계정 REST + WS 릴레이).
- 카드 데이터 수정: `tools/data/`의 번역본 수정 → `node tools/build-cards.js` (요청 시에만).

## 실행 (참고 — 요청 시에만)

- 클라 개발 실행: `cd client && npm start` / 웹 확인: `npx http-server client/web -p 8777`
- 서버: `cd server && node server.js`
- 빌드: 클라 `npm run dist`, 서버 `node build-dist.js --exe`
