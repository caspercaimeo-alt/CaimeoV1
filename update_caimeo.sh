#!/usr/bin/env bash
# Production-safe updater for CAIMEO on Raspberry Pi.
# - Pulls the latest main branch
# - Builds the React frontend (no dev server)
# - Restarts nginx and cloudflared
# - Prefers systemd for the backend; otherwise starts uvicorn manually
# - Kills any accidental dev servers on :3000

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_LOG="/tmp/caimeo_uvicorn.log"

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

info "Stopping dev servers (react-scripts/npm start/node:3000) if any..."
pkill -f "react-scripts start" 2>/dev/null || true
pkill -f "npm start" 2>/dev/null || true
if command -v lsof >/dev/null 2>&1; then
  mapfile -t DEV_PIDS < <(lsof -t -i :3000 2>/dev/null || true)
  if [ "${#DEV_PIDS[@]}" -gt 0 ]; then
    info "Killing processes on :3000 (${DEV_PIDS[*]})"
    kill -9 "${DEV_PIDS[@]}" 2>/dev/null || true
  fi
fi

info "Building frontend (npm install && npm run build)..."
(
  cd "$ROOT/alpaca-ui"
  npm install
  npm run build
)

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "^nginx.service"; then
  info "Reloading nginx configuration..."
  $SUDO nginx -t
  $SUDO systemctl restart nginx
else
  warn "nginx systemd service not found; skipping nginx restart."
fi

BACKEND_SERVICE_AVAILABLE=false
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "^caimeo-backend.service"; then
  BACKEND_SERVICE_AVAILABLE=true
fi

if [ "$BACKEND_SERVICE_AVAILABLE" = true ]; then
  info "Restarting backend via systemd (caimeo-backend.service)..."
  $SUDO systemctl daemon-reload
  $SUDO systemctl restart caimeo-backend.service
else
  info "Backend systemd service not found; starting uvicorn manually."
  pkill -f "uvicorn server:app" 2>/dev/null || true
  if command -v lsof >/dev/null 2>&1; then
    mapfile -t PORT8000_PIDS < <(lsof -t -i :8000 2>/dev/null || true)
    if [ "${#PORT8000_PIDS[@]}" -gt 0 ]; then
      info "Killing processes on :8000 (${PORT8000_PIDS[*]})"
      kill -9 "${PORT8000_PIDS[@]}" 2>/dev/null || true
    fi
  fi

  UVICORN_BIN="$ROOT/venv/bin/uvicorn"
  if [ ! -x "$UVICORN_BIN" ]; then
    warn "venv uvicorn not found; using system uvicorn."
    UVICORN_BIN="uvicorn"
  fi

  info "Starting uvicorn on 0.0.0.0:8000..."
  nohup "$UVICORN_BIN" server:app --host 0.0.0.0 --port 8000 >"$BACKEND_LOG" 2>&1 &
  info "Backend log: $BACKEND_LOG"
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

info "Port listeners (8000, 8080, 3000):"
if command -v ss >/dev/null 2>&1; then
  ss -tulpn 2>/dev/null | grep -E ":8000|:8080|:3000" || true
elif command -v netstat >/dev/null 2>&1; then
  netstat -tulpn 2>/dev/null | grep -E ":8000|:8080|:3000" || true
else
  warn "Neither ss nor netstat available to show listening ports."
fi

info "Quick API sanity check against Cloudflare tunnel..."
if ! curl -i --max-time 10 https://caspercaimeo.com/api/auth; then
  warn "API check failed; ensure cloudflared/nginx/uvicorn are healthy."
else
  info "API check completed (expected 405 JSON)."
fi

info "Update complete."
