#!/usr/bin/env bash
#
# Deploy the PDF render service from your local repo to paperclip.
#
# Usage:
#   ./deploy.sh                 # rsync code + restart under pm2
#   INSTALL_DEPS=1 ./deploy.sh  # also run `npm install` on paperclip
#
# Assumes:
#   - you have SSH access to root@paperclip (IP or alias defined in ~/.ssh/config)
#   - paperclip already has Node.js 18+ and pm2 installed
#   - /home/brooke/pdf-render-service/.env exists on paperclip with real values
#
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@64.23.204.220}"
REMOTE_DIR="${REMOTE_DIR:-/home/brooke/pdf-render-service}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[deploy] syncing $here/ -> $REMOTE_HOST:$REMOTE_DIR/"
rsync -az --delete \
  --exclude='.env' \
  --exclude='node_modules/' \
  --exclude='.git/' \
  --exclude='*.log' \
  "$here/" "$REMOTE_HOST:$REMOTE_DIR/"

if [[ "${INSTALL_DEPS:-0}" == "1" ]]; then
  echo "[deploy] installing deps on $REMOTE_HOST"
  ssh "$REMOTE_HOST" "cd $REMOTE_DIR && npm install --omit=dev"
fi

echo "[deploy] restarting pm2 service"
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && (pm2 describe pdf-render-service >/dev/null 2>&1 && pm2 reload ecosystem.config.js || pm2 start ecosystem.config.js) && pm2 save"

echo "[deploy] health check"
ssh "$REMOTE_HOST" "curl -fsS http://127.0.0.1:3001/health || echo 'HEALTH CHECK FAILED'"

echo "[deploy] done"
