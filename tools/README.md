# tools — 데이터 파이프라인

카드 DB(`client/web/js/cards.js`, `server/cards.json`)를 재생성하는 스크립트입니다.

```bash
node tools/fetch-ogn.js     # Riftcodex API → tools/data/ogn_*.json (원본, .gitignore)
node tools/build-cards.js   # ogn_base.json + tr_out_batch*.json → cards.js / cards.json
```

## data/ 폴더
- `glossary.md` — 한글화 용어집 (LoL 공식 명칭·키워드 통일 규칙)
- `tr_out_batch*.json` — 카드별 한글 번역 산출물 (커밋됨, 번역 원본)
- `ogn_*.json` — API 원본 덤프 (재수집 가능하므로 .gitignore)
- Riot 규칙 PDF/텍스트는 저작권상 저장소에 포함하지 않습니다 (.gitignore).

> 카드 텍스트·이미지의 저작권은 Riot Games에 있습니다. 번역은 팬 번역입니다.
