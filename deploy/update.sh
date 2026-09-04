#!/usr/bin/env bash
# 서버 최신화: 저장소를 다시 받아 번들만 교체한다 (계정·덱 데이터 data/ 는 보존)
# VM에서:  bash <(curl -fsSL https://raw.githubusercontent.com/misakila58/riftboundKr/master/deploy/update.sh)
set -euo pipefail
APP=/opt/riftbound
REPO=https://github.com/misakila58/riftboundKr.git

sudo rm -rf /tmp/rbsrc && git clone --depth 1 "$REPO" /tmp/rbsrc
# esbuild가 서버 의존성(ws)을 번들에 넣으려면 먼저 설치돼 있어야 한다
( cd /tmp/rbsrc/server && npm install --omit=dev --no-audit --no-fund && node build-dist.js )
sudo rsync -a --delete --exclude 'data' --exclude 'access-code.txt' /tmp/rbsrc/server/dist/ "$APP"/
sudo chown -R riftbound:riftbound "$APP"
sudo systemctl restart riftbound
sleep 2
systemctl is-active riftbound && echo "✅ 업데이트 완료 — 웹 접속자는 새로고침만 하면 최신 버전입니다."
