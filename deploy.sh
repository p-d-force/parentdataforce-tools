#!/usr/bin/env bash
# Parent Data Force — Docling Lab deploy script.
# Usage: ./deploy.sh [remote_host]   (default 158.51.125.8)
# Idempotent, non-destructive: only updates the app repo, pdf-lab service,
# nginx vhost configs, and restarts the app services. Never touches user data
# (links.json/users.json), SSH policy, or the firewall.
set -euo pipefail

HOST="${1:-158.51.125.8}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_parentdataforce}"
SSH=(ssh -i "$KEY" -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new root@"$HOST")

echo "==> Docling Lab deploy -> $HOST"

echo "[1/6] push local repo state"
cd "$(dirname "$0")"
if ! git diff --quiet HEAD; then
  echo "    local changes not committed — commit before deploy:"
  git status --short | head -10
  exit 1
fi

echo "[2/6] git pull on remote"
"${SSH[@]}" 'git -C /opt/parentdataforce-tools pull --ff-only origin main 2>&1 | tail -2'

echo "[3/6] sync pdf-lab app"
"${SSH[@]}" 'mkdir -p /opt/pdf-lab && cp /opt/parentdataforce-tools/deploy/pdf-lab/app.py /opt/pdf-lab/app.py && chown -R root:root /opt/pdf-lab'

echo "[4/6] nginx vhosts (dev + tools)"
"${SSH[@]}" 'cp /opt/parentdataforce-tools/deploy/nginx-dev.conf /etc/nginx/sites-enabled/parentdataforce-dev
rm -f /etc/nginx/sites-enabled/parentdataforce-dev.conf
cp /opt/parentdataforce-tools/deploy/nginx-tools.conf /etc/nginx/sites-enabled/parentdataforce-tools
cp /opt/parentdataforce-tools/deploy/docling-rate-limit.conf /etc/nginx/conf.d/docling-rate-limit.conf
nginx -t 2>&1 | tail -1 && systemctl reload nginx && echo NGINX_OK'

echo "[4c/6] live site (parentdataforce.org main site)"
"${SSH[@]}" 'rsync -a --delete /opt/parentdataforce-tools/live-site/ /var/www/parentdataforce/live/ 2>/dev/null || (rm -rf /var/www/parentdataforce/live && cp -r /opt/parentdataforce-tools/live-site /var/www/parentdataforce/live) && chown -R root:root /var/www/parentdataforce/live && ls /var/www/parentdataforce/live | tr "\n" " " && echo LIVE_OK'

echo "[4b/6] docling-serve unit (parallel jobs / caps)"
"${SSH[@]}" 'cp /opt/parentdataforce-tools/deploy/docling-serve.service /etc/systemd/system/docling-serve.service && systemctl daemon-reload && systemctl restart docling-serve && sleep 3 && systemctl is-active docling-serve'

echo "[5/6] restart app services"
"${SSH[@]}" 'systemctl restart pdf-lab parentdataforce-tools && sleep 4 && systemctl is-active pdf-lab parentdataforce-tools'

echo "[6/6] local health checks"
sleep 2
"${SSH[@]}" 'curl -fsS http://127.0.0.1:5100/health && echo && curl -fsS http://127.0.0.1:3101/healthz && echo && curl -s -o /dev/null -w "docling-serve http=%{http_code}\n" http://127.0.0.1:5001/health'

echo "==> Deploy complete. Run ./smoke_test.sh $HOST to verify."
