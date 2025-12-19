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
UVICORN_BIN="$ROOT/venv/bin/uvicorn"
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Logs
BACKEND_LOG="/tmp/caimeo_uvicorn.log"

# Backend venv (optional)
VENV_DIR="$ROOT/.venv"
UVICORN_BIN="$VENV_DIR/bin/uvicorn"

info(){ echo "==> $*"; }
warn(){ echo "WARN: $*" >&2; }

info "==> Fetching latest commits..."
git -C "$ROOT" fetch --all --prune
git -C "$ROOT" pull --ff-only || true

info "==> Stopping any dev frontend (port 3000) if running..."
pkill -f "react-scripts start" || true
pkill -f "npm --prefix .*alpaca-ui start" || true
pkill -f "node .*react-scripts" || true

info "==> Building frontend (production build)..."
cd "$ROOT/alpaca-ui"
npm install
npm run build
cd "$ROOT"

info "==> Restarting nginx (serves build on :8080)..."
sudo systemctl restart nginx
sudo systemctl is-active --quiet nginx && info "nginx: OK" || warn "nginx not active"

info "==> Restarting cloudflared (tunnel)..."
sudo systemctl restart cloudflared
sudo systemctl is-active --quiet cloudflared && info "cloudflared: OK" || warn "cloudflared not active"

info "==> Restarting backend..."
# If you have a systemd service for the backend, prefer it.
if systemctl list-units --type=service | grep -q "caimeo-backend.service"; then
  sudo systemctl restart caimeo-backend
  info "Backend restarted via systemd (caimeo-backend.service)."
else
  info "No caimeo-backend.service found; restarting uvicorn process directly."

  # Kill anything currently bound to 8000 to avoid duplicates.
  if command -v lsof >/dev/null 2>&1; then
    PID_ON_8000="$(lsof -ti tcp:8000 || true)"
    if [ -n "${PID_ON_8000}" ]; then
      info "Killing process on :8000 (pid(s): ${PID_ON_8000})"
      sudo kill ${PID_ON_8000} || true
      sleep 1
    fi
  else
    pkill -f "uvicorn server:app" || true
  fi

  if [ ! -x "$UVICORN_BIN" ]; then
    warn "venv uvicorn not found; falling back to system uvicorn on PATH."
    UVICORN_BIN="uvicorn"
  fi

  info "Starting backend (uvicorn on :8000)..."
  nohup "$UVICORN_BIN" server:app --host 0.0.0.0 --port 8000 >"$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  info "Backend PID: $BACKEND_PID (log: $BACKEND_LOG)"
fi

sleep 2

info "==> Quick port check (:8080 nginx, :8000 uvicorn; :3000 should be empty)"
sudo ss -ltnp | egrep ':3000|:8080|:8000' || true

info "==> Quick API sanity check (should be JSON/405 for GET /api/auth):"
curl -i https://caspercaimeo.com/api/auth | sed -n '1,15p' || true

info "✅ Update complete."

