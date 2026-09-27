#!/usr/bin/env bash
# 서버 최신화: 저장소를 다시 받아 번들만 교체한다 (계정·덱 데이터 data/ 는 보존)
# VM에서:  bash <(curl -fsSL https://raw.githubusercontent.com/misakila58/riftboundKr/master/deploy/update.sh)
set -euo pipefail
APP=/opt/riftbound
REPO=https://github.com/misakila58/riftboundKr.git

# ── 배포 예약(드레인): 진행 중인 경기를 끊지 않는다 ──
# 서버에 드레인을 걸면 새 방·입장·관전·등급전 매칭이 막히고 접속자에게 '업데이트 예정' 안내가 간다.
# 진행 중인 경기(PLAYING)가 0이 될 때까지 기다린 뒤 재시작한다 (최대 40분, NOW=1 이면 기다리지 않음).
# 재시작 뒤 접속자는 버전이 달라진 것을 보고 '새로고침' 안내를 받는다. 드레인 엔드포인트가 없는 옛 서버면 그냥 진행한다.
PORT=8321
if [ "${NOW:-0}" != "1" ] && curl -fsS -X POST "http://127.0.0.1:$PORT/api/admin/drain" >/dev/null 2>&1; then
  echo "배포 예약: 진행 중인 경기가 끝나기를 기다립니다 (새 경기 시작은 막힘)"
  for i in $(seq 1 240); do
    playing=$(curl -fsS "http://127.0.0.1:$PORT/api/status" 2>/dev/null | grep '^PLAYING|' | cut -d'|' -f2)
    if [ "${playing:-0}" = "0" ]; then echo "진행 중인 경기 없음 — 배포를 진행합니다"; break; fi
    [ $((i % 6)) -eq 1 ] && echo "  진행 중 ${playing}판… ($((i*10))초 경과, 최대 40분)"
    sleep 10
  done
fi
sudo rm -rf /tmp/rbsrc && git clone --depth 1 "$REPO" /tmp/rbsrc
# 카드 이미지는 서버가 직접 제공한다 (CDN 차단·엣지 추적 방지·광고 차단 환경에서 빈 상자로 보이던 문제 — 2026-09-17).
# 이미 받아 둔 파일은 재사용하고 빠진 것만 Riot CDN에서 받는다 (~20MB, 첫 배포에만 1~2분). 실패해도 CDN 폴백으로 동작한다.
if [ -d "$APP/web/assets/cards" ]; then
  mkdir -p /tmp/rbsrc/client/web/assets/cards && cp -r "$APP/web/assets/cards/." /tmp/rbsrc/client/web/assets/cards/
fi
( cd /tmp/rbsrc && node tools/fetch-card-images.js --quiet ) || echo "⚠ 카드 이미지 받기 실패 — CDN 폴백으로 동작합니다"
# esbuild가 서버 의존성(ws)을 번들에 넣으려면 먼저 설치돼 있어야 한다
( cd /tmp/rbsrc/server && npm install --omit=dev --no-audit --no-fund && node build-dist.js )
sudo rsync -a --delete --exclude 'data' --exclude 'access-code.txt' /tmp/rbsrc/server/dist/ "$APP"/
sudo chown -R riftbound:riftbound "$APP"
sudo systemctl restart riftbound
sleep 2
systemctl is-active riftbound && echo "✅ 업데이트 완료 — 웹 접속자는 새로고침만 하면 최신 버전입니다."
