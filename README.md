# 리프트바운드 시뮬레이터 (Riftbound Simulator) — Origins 한글판

라이엇 게임즈의 TCG **리프트바운드(Riftbound)** 부스터 1탄 *Origins(OGN)* 298장을
한글화하여 온라인으로 대전하는 **데스크톱 프로그램**입니다. (비공식 팬 프로젝트)

- **플레이어**는 데스크톱 클라이언트(Windows 앱)를 내려받아 실행하고, 방장의 서버 주소를 입력해 접속합니다.
- **방장(호스트)**은 자신의 PC에서 서버 프로그램을 실행합니다. 계정(아이디/비밀번호)과 덱은 방장 PC에만 저장됩니다.
- 오프라인 **핫시트(한 화면 2인)** 모드도 지원하여 서버 없이도 플레이할 수 있습니다.

> ⚠️ Riftbound와 모든 카드 자산의 저작권은 Riot Games에 있습니다. 본 프로젝트는 Riot의
> 팬 콘텐츠 정책에 따른 비공식·비영리 프로젝트이며 Riot Games가 보증하지 않습니다.
> 카드 데이터/이미지는 실행 시 [Riftcodex API](https://riftcodex.com)와 Riot CDN에서 가져옵니다.

## 저장소 구조

```
riftbound-sim/
├─ client/                  데스크톱 클라이언트 (Electron)
│  ├─ main.js               Electron 메인 프로세스
│  ├─ preload.js
│  ├─ package.json          빌드 설정 (electron-builder)
│  └─ web/                  게임 UI (렌더러)
│     ├─ index.html
│     ├─ css/style.css
│     └─ js/                cards, loc, effects, engine, net, ui, main
├─ server/                  자체 호스팅 백엔드 (Node, API + WebSocket)
│  ├─ server.js             계정/덱 REST + 로비/게임 릴레이
│  ├─ cards.json            덱 검증용 카드 목록 (생성물)
│  ├─ build-dist.js         서버 배포 패키지 빌더
│  └─ dist-assets/          실행/터널 .bat + 서버_실행_가이드.md
├─ tools/                   데이터 파이프라인 (재현용)
│  ├─ fetch-ogn.js          Riftcodex에서 카드 데이터 수집
│  ├─ build-cards.js        번역 병합 → cards.js / cards.json 생성
│  └─ data/                 용어집·번역 산출물 (원본 덤프/PDF는 .gitignore)
├─ .github/workflows/       릴리스 자동 빌드 (선택)
├─ LICENSE                  MIT (코드) + Riot 저작권 고지
└─ .gitignore
```

## 빠른 시작 (미리 빌드된 프로그램 사용)

1. GitHub **Releases**에서 두 가지를 받습니다.
   - **서버**: `riftbound-server-win.zip` → 방장이 압축 해제 후 `start-server.bat` 실행
   - **클라이언트**: `RiftboundSim-Setup.exe`(설치형) 또는 `RiftboundSim-portable.exe`(무설치) → 플레이어가 실행
2. 방장은 서버 창에 표시된 접속 주소(또는 터널 주소)를 플레이어에게 공유합니다.
3. 플레이어는 클라이언트를 실행 → **서버 주소 입력** → 회원가입/로그인 → 덱 만들기 → 로비에서 대전.

인터넷(다른 네트워크) 공개 및 **고정 주소** 설정 방법은 서버 패키지 안의
`서버_실행_가이드.md`를 참고하세요 (ngrok 고정 HTTPS 도메인 권장).

## 소스에서 직접 실행/빌드

### 사전 준비
- Node.js 18+ 설치

### 서버 실행 (호스트)
```bash
cd server
npm install          # ws
node server.js       # http://localhost:8321  (포트 변경: node server.js 9000)
```

### 클라이언트 실행 (개발)
```bash
cd client
npm install          # electron, electron-builder
npm start            # Electron 창 실행
```

### 배포 파일 만들기
```bash
# 클라이언트 (설치형+무설치 exe → client/dist)
cd client && npm run dist

# 서버 (단일 exe + 실행 스크립트 → server/dist)
cd server && node build-dist.js --exe
```

### 카드 데이터 재생성 (선택)
```bash
node tools/fetch-ogn.js     # Riftcodex API에서 최신 카드 수집
node tools/build-cards.js   # 번역 병합 → client/web/js/cards.js, server/cards.json
```

## 게임/기능 요약

- Origins 298장 한글화(카드명·효과), 효과 자동 처리(파서 + 전설 스크립트), 자동화 불가 효과는 우클릭 수동 도구.
- 1v1 온라인 대전(락스텝 결정론 동기화, 상대 손패 비공개), 계정당 덱 20개 저장, 입장 시 덱 선택.
- 규칙: 승점 8, 전장 정복/점유 득점, 격돌·전투 피해 배분([탱커] 우선), 룬/에너지/파워 비용 자동 지불 등.

## 보안 (자체 호스팅 · 공개 서버 대응)

- 비밀번호는 salt+scrypt 해시로만 저장, 서버는 API+WS만 제공(정적 파일 서빙 없음).
- 로그인/가입 rate limit, 비동기 해싱, 계정 열거 방지, 요청/WS 크기·속도 제한, 토큰 만료, 계정·방 상한.
- 덱은 실제 카드 ID로 서버 검증, 릴레이는 발신 좌석을 확정해 위장/턴 가로채기 차단.
- 전송 암호화는 HTTPS 터널(ngrok/Cloudflare) 사용을 권장. 평문 HTTP 접속 시 클라이언트가 경고합니다.
- **한계**: 게임 로직이 각 클라이언트에서 돌아가는 캐주얼 구조라 개조 클라이언트의 in-game 치팅은
  완전히 막지 못합니다(서로 아는 사람끼리의 대전 권장). 자세한 내용은 `server/dist-assets/서버_실행_가이드.md`.

## 크레딧

- 카드 데이터/이미지: [Riftcodex API](https://riftcodex.com), Riot Games CDN
- Riftbound / League of Legends © Riot Games, Inc. — 비공식 팬 프로젝트
- 한글 번역: 팬 번역 (LoL 공식 한국어 명칭 준수, `tools/data/glossary.md` 참고)
