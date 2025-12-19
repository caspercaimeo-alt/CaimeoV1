#!/usr/bin/env bash
# Update Caimeo to the latest commit on origin/main, restart backend/frontend.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_LOG="/tmp/caimeo_uvicorn.log"
FRONTEND_LOG="/tmp/caimeo_frontend.log"

info()  { printf "==> %s\n" "$*"; }
warn()  { printf "WARN: %s\n" "$*" >&2; }

cd "$ROOT"

SSH_CMD="${GIT_SSH_COMMAND:-ssh -i ~/.ssh/id_ed25519_caimeo -o StrictHostKeyChecking=accept-new}"

info "Fetching latest commits..."
GIT_SSH_COMMAND="$SSH_CMD" git fetch

LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse origin/main)

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  info "Already up to date. Restarting services anyway."
else
  info "Updating to origin/main..."
  GIT_SSH_COMMAND="$SSH_CMD" git pull --ff-only
fi

info "Stopping existing backend/frontend if running..."
pkill -f "uvicorn server:app" 2>/dev/null || true
pkill -f "npm --prefix alpaca-ui start" 2>/dev/null || true
pkill -f "react-scripts start" 2>/dev/null || true
sleep 1

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

