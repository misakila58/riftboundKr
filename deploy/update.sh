#!/usr/bin/env bash
# 서버 최신화: 저장소를 다시 받아 번들만 교체한다 (계정·덱 데이터 data/ 는 보존)
# VM에서:  bash <(curl -fsSL https://raw.githubusercontent.com/misakila58/riftboundKr/master/deploy/update.sh)
set -euo pipefail
APP=/opt/riftbound
REPO=https://github.com/misakila58/riftboundKr.git

sudo rm -rf /tmp/rbsrc && git clone --depth 1 "$REPO" /tmp/rbsrc
# 카드 이미지는 서버가 직접 제공한다 (CDN 차단·엣지 추적 방지·광고 차단 환경에서 빈 상자로 보이던 문제 — 2026-09-17).
# 이미 받아 둔 파일은 재사용하고 빠진 것만 Riot CDN에서 받는다 (~20MB, 첫 배포에만 1~2분). 실패해도 CDN 폴백으로 동작한다.
if [ -d "$APP/web/assets/cards" ]; then
  mkdir -p /tmp/rbsrc/client/web/assets/cards && cp -r "$APP/web/assets/cards/." /tmp/rbsrc/client/web/assets/cards/
fi
( cd /tmp/rbsrc && node tools/fetch-card-images.js --quiet ) || echo "⚠ 카드 이미지 받기 실패 — CDN 폴백으로 동작합니다"
# esbuild가 서버 의존성(ws)을 번들에 넣으려면 먼저 설치돼 있어야 한다
( cd /tmp/rbsrc/server && npm install --omit=dev --no-audit --no-fund && node build-dist.js )
sudo rsync -a --delete --exclude 'data' --exclude 'access-count.txt' --exclude 'access-code.txt' /tmp/rbsrc/server/dist/ "$APP"/
sudo chown -R riftbound:riftbound "$APP"
# 재시작 직전에 접속자에게 알린다(루프백 전용 엔드포인트, 옛 서버면 무시). 기다리지 않는다 —
# 진행 중인 경기는 방이 파일로 보존되고 클라이언트가 몇 초 안에 자동 재접속해 이어지며(2분 유예), 끝난 뒤 새로고침 안내를 받는다.
# 로비·메뉴의 접속자는 재시작 직후 '새 버전 — 새로고침' 안내를 받는다. 아무도 기다리지 않는다.
curl -fsS -X POST "http://127.0.0.1:8321/api/admin/drain" >/dev/null 2>&1 || true
sleep 1
sudo systemctl restart riftbound
sleep 2
systemctl is-active riftbound && echo "✅ 업데이트 완료 — 웹 접속자는 새로고침만 하면 최신 버전입니다."
