# 서버 (자체 호스팅 백엔드)

계정/덱 저장(REST)과 로비·게임 릴레이(WebSocket)만 담당하는 Node 서버입니다.
정적 파일(게임 UI)은 서빙하지 않습니다 — UI는 별도의 데스크톱 클라이언트가 가집니다.

## 실행
```bash
npm install       # ws
node server.js    # 0.0.0.0:8321  (포트 변경: node server.js 9000)
```
계정/덱은 `data/db.json`에 저장됩니다. 비밀번호는 salt+scrypt 해시로만 저장됩니다.

## 배포 패키지 만들기
```bash
node build-dist.js         # dist/ 에 번들+스크립트 (기존 exe 재사용)
node build-dist.js --exe   # 독립 실행 exe까지 재빌드 (pkg 필요, 자동 설치)
```
`dist/` 를 서버용 컴퓨터에 복사하면 Node 없이 `start-server.bat` 으로 실행됩니다.
인터넷 공개·고정 주소(ngrok/DuckDNS/Cloudflare) 방법은 `dist-assets/서버_실행_가이드.md` 참고.

## 데이터/보안 메모
- `data/` (특히 `db.json`)는 비밀번호 해시를 포함하므로 **절대 커밋하지 마세요** (.gitignore 처리됨).
- `cards.json` 은 덱 검증용 카드 목록으로 `tools/build-cards.js` 가 생성합니다.
- 주요 보안: rate limit, 비동기 scrypt, 계정 열거 방지, CORS, 입력 검증, 릴레이 좌석 검증, 각종 상한.

## API 요약
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 서버 확인 (클라이언트 주소 검증용) |
| POST | `/api/register` | 회원가입 `{id, pw}` → `{token, id}` |
| POST | `/api/login` | 로그인 `{id, pw}` → `{token, id}` |
| GET | `/api/decks` | 내 덱 목록 (Bearer 토큰) |
| POST | `/api/decks` | 덱 저장/수정 `{deck, index?}` |
| DELETE | `/api/decks/:idx` | 덱 삭제 |

WebSocket: `auth` → `createRoom`/`joinRoom`/`listRoom` → 게임 중 `act`/`choice` 릴레이.
