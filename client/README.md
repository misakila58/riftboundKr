# 클라이언트 (데스크톱 앱)

플레이어가 내려받아 실행하는 Electron 데스크톱 앱입니다. 게임 UI와 모든 게임 로직은
`web/`(렌더러)에서 동작하며, 접속할 서버 주소는 앱 실행 후 입력합니다.

## 개발 실행
```bash
npm install
npm start        # electron .
```

## 배포 파일 만들기
```bash
npm run dist            # 설치형(nsis) + 무설치(portable) → dist/
npm run dist:portable   # 무설치 exe만
```
산출물 예: `dist/RiftboundSim-1.0.0-x64.exe`(설치형), `dist/RiftboundSim-1.0.0-portable.exe`.

## 보안 관련
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — 렌더러에서 Node API 차단.
- `web/index.html`의 CSP: 스크립트는 로컬(`'self'`)만 실행, 이미지는 Riot CDN(https), 접속은 사용자가 지정한 서버(`connect-src *`).
- 외부 링크는 기본 브라우저로 엽니다.

## 참고
- 아이콘을 넣으려면 `build/icon.png`(및 `.ico`)를 추가하세요. 없어도 빌드는 됩니다.
- `web/` 하위 파일만 화면/로직을 담당하므로, 브라우저에서 `web/index.html`을 정적 서빙해 디버깅할 수도 있습니다.
