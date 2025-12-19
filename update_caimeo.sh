#!/usr/bin/env bash
# Production-safe updater for CAIMEO on Raspberry Pi behind Cloudflare Tunnel.
# - Pull latest main
# - Enforce that no React dev server runs (port 3000)
# - Build the React frontend for nginx on :8080
# - Restart nginx, cloudflared, backend, and bot via systemd
# - Verify ports (:8080 nginx, :8000 uvicorn, :3000 absent) and tunnel API health

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

info() { printf "==> %s\n" "$*"; }
warn() { printf "WARN: %s\n" "$*" >&2; }

cd "$ROOT"

SUDO="sudo"
command -v sudo >/dev/null 2>&1 || SUDO=""

SSH_CMD="${GIT_SSH_COMMAND:-ssh -i ~/.ssh/id_ed25519_caimeo -o StrictHostKeyChecking=accept-new}"

info "Fetching latest commits..."
GIT_SSH_COMMAND="$SSH_CMD" git fetch

LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse origin/main)

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  info "Already up to date."
else
  info "Updating to origin/main..."
  GIT_SSH_COMMAND="$SSH_CMD" git pull --ff-only
fi

info "Stopping/disabling/masking caimeo-frontend.service (dev server)..."
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "^caimeo-frontend.service"; then
  $SUDO systemctl stop caimeo-frontend.service || true
  $SUDO systemctl disable caimeo-frontend.service || true
  $SUDO systemctl mask caimeo-frontend.service || true
else
  info "caimeo-frontend.service not present; nothing to mask."
fi

info "Killing any dev frontend processes (react-scripts/npm start/node on :3000)..."
pkill -f "react-scripts start" 2>/dev/null || true
pkill -f "npm start" 2>/dev/null || true
if command -v lsof >/dev/null 2>&1; then
  mapfile -t DEV_PIDS < <(lsof -t -i tcp:3000 2>/dev/null || true)
  if [ "${#DEV_PIDS[@]}" -gt 0 ]; then
    info "Killing processes on :3000 (${DEV_PIDS[*]})"
    kill -9 "${DEV_PIDS[@]}" 2>/dev/null || true
  fi
fi

info "Building frontend (npm --prefix alpaca-ui install && npm --prefix alpaca-ui run build)..."
npm --prefix "$ROOT/alpaca-ui" install
npm --prefix "$ROOT/alpaca-ui" run build

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "^nginx.service"; then
  info "Reloading nginx configuration..."
  $SUDO nginx -t
  $SUDO systemctl restart nginx
else
  warn "nginx systemd service not found; skipping nginx restart."
fi

if command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files | grep -q "^cloudflared-caimeo.service"; then
    info "Restarting cloudflared-caimeo.service..."
    $SUDO systemctl restart cloudflared-caimeo.service
  elif systemctl list-unit-files | grep -q "^cloudflared.service"; then
    info "Restarting cloudflared.service..."
    $SUDO systemctl restart cloudflared.service
  else
    warn "cloudflared systemd service not found; skipping cloudflared restart."
  fi
fi

restart_unit() {
  local unit="$1"
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "^${unit}"; then
    info "Restarting ${unit}..."
    $SUDO systemctl daemon-reload
    $SUDO systemctl restart "${unit}"
  else
    warn "${unit} not found; skipping."
  fi
}

restart_unit "caimeo-backend.service"
restart_unit "caimeo-bot.service"

info "Port listeners (expect :8080 nginx, :8000 uvicorn, no :3000)..."
if command -v ss >/dev/null 2>&1; then
  ss -tulpn 2>/dev/null | grep -E ":8000|:8080|:3000" || true
elif command -v netstat >/dev/null 2>&1; then
  netstat -tulpn 2>/dev/null | grep -E ":8000|:8080|:3000" || true
else
  warn "Neither ss nor netstat available to show listening ports."
fi

info "Quick API sanity check (expect 405 JSON from GET /api/auth)..."
curl -i --max-time 10 https://caspercaimeo.com/api/auth | sed -n '1,15p' || true

info "Update complete."
