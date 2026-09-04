#!/usr/bin/env bash
# ══════════ 리프트바운드 서버 — Oracle Cloud(Ubuntu) 원클릭 설치 ══════════
# 새 VM에서:  bash <(curl -fsSL https://raw.githubusercontent.com/misakila58/riftboundKr/master/deploy/setup-vm.sh) <도메인> [접속코드]
# 예:        bash <(curl -fsSL https://raw.githubusercontent.com/misakila58/riftboundKr/master/deploy/setup-vm.sh) riftbound-sim.duckdns.org 우리방암호
set -euo pipefail

DOMAIN="${1:?사용법: setup-vm.sh <도메인> [접속코드]}"
ACCESS="${2:-}"
APP=/opt/riftbound
REPO=https://github.com/misakila58/riftboundKr.git

echo "══ [1/6] 패키지 설치 (Node 20 + Caddy + git) ══"
sudo apt-get update -y
sudo apt-get install -y git curl debian-keyring debian-archive-keyring apt-transport-https
if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update -y && sudo apt-get install -y caddy
fi

echo "══ [2/6] 방화벽 열기 (Oracle Ubuntu는 로컬 iptables가 기본 차단) ══"
sudo iptables -C INPUT -p tcp --dport 80  -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport 80  -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent >/dev/null 2>&1 || true
sudo netfilter-persistent save 2>/dev/null || true

echo "══ [3/6] 소스 받기 + 서버 번들 빌드 ══"
sudo rm -rf /tmp/rbsrc && git clone --depth 1 "$REPO" /tmp/rbsrc
# esbuild가 서버 의존성(ws)을 번들에 넣으려면 먼저 설치돼 있어야 한다
( cd /tmp/rbsrc/server && npm install --omit=dev --no-audit --no-fund && node build-dist.js )
sudo mkdir -p "$APP"
# data/(계정·덱 DB)는 보존하고 나머지만 교체
sudo rsync -a --delete --exclude 'data' --exclude 'access-code.txt' /tmp/rbsrc/server/dist/ "$APP"/ 2>/dev/null \
  || { sudo apt-get install -y rsync; sudo rsync -a --delete --exclude 'data' --exclude 'access-code.txt' /tmp/rbsrc/server/dist/ "$APP"/; }
[ -n "$ACCESS" ] && echo "$ACCESS" | sudo tee "$APP/access-code.txt" >/dev/null
sudo useradd -r -s /usr/sbin/nologin riftbound 2>/dev/null || true
sudo chown -R riftbound:riftbound "$APP"

echo "══ [4/6] systemd 등록 (부팅 자동 시작 + 죽으면 재시작) ══"
sudo tee /etc/systemd/system/riftbound.service >/dev/null <<EOF
[Unit]
Description=Riftbound Simulator Server
After=network.target
[Service]
User=riftbound
WorkingDirectory=$APP
ExecStart=/usr/bin/node $APP/riftbound-server.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now riftbound

echo "══ [5/6] Caddy — $DOMAIN 자동 HTTPS ══"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
    encode gzip
    reverse_proxy localhost:8321
}
EOF
sudo systemctl reload caddy || sudo systemctl restart caddy

echo "══ [6/6] 확인 ══"
sleep 2
systemctl is-active riftbound && systemctl is-active caddy
echo ""
echo "✅ 완료! 브라우저에서 https://$DOMAIN 을 열어 보세요."
echo "   (DuckDNS의 IP가 이 VM 공인 IP로 설정돼 있어야 하고, Oracle 콘솔 Security List에 80/443 인그레스가 열려 있어야 합니다)"
echo "   접속 코드: ${ACCESS:-'(없음 — 공개 서버)'}"
