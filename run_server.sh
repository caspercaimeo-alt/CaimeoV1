#!/bin/zsh
# =====================================================
# run_server.sh — One-command launcher for Alpaca Bot
# =====================================================

export UNIVERSE_LIMIT=10000

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Load environment variables (including ENABLE_AUTO_TRADING) if .env is present
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
  echo "✅ Loaded environment from .env"
else
  echo "⚠️ .env not found — using existing environment only."
fi

echo "🧹 Checking for existing Uvicorn processes..."
if pgrep -f "uvicorn server:app" >/dev/null 2>&1; then
  echo "⚠️  Found existing Uvicorn process — stopping it..."
  pkill -f "uvicorn server:app"
  sleep 2
fi

echo "🚀 Starting FastAPI server (port 8000)..."
# If something is already bound to 8000, stop it
existing8000=$(lsof -t -i :8000 2>/dev/null)
if [ -n "$existing8000" ]; then
  echo "⚠️  Port 8000 in use by PID(s): $existing8000 — killing..."
  echo "$existing8000" | xargs kill -9 2>/dev/null
  sleep 1
fi
uvicorn server:app --reload --port 8000 &
SERVER_PID=$!

sleep 5

# -----------------------------------------------------
# Start FRONTEND (React)
# -----------------------------------------------------
echo "🚀 Starting frontend (React UI on port 3000)..."
cd alpaca-ui
npm start &
FRONTEND_PID=$!
cd "$PROJECT_DIR"

sleep 5

# -----------------------------------------------------
# Auto-open browser tabs
# -----------------------------------------------------
if command -v open >/dev/null 2>&1; then
  open "http://localhost:3000"
  open "http://127.0.0.1:8000/docs"
  echo "✅ Browser windows opened."
else
  echo "➡ Please open http://localhost:3000 manually."
  echo "➡ And FastAPI docs at: http://127.0.0.1:8000/docs"
fi

# -----------------------------------------------------
# Auto-start trading bot
# -----------------------------------------------------
echo ""
echo "🤖 Starting trading bot automatically..."
sleep 3

if command -v curl >/dev/null 2>&1; then
  curl -s -X POST "http://127.0.0.1:8000/start" >/dev/null
  echo "⌛ Verifying trading bot startup..."

  MAX_WAIT=15
  waited=0
  success=false

  while [ $waited -lt $MAX_WAIT ]; do
    if grep -q "🚀 Trading bot started" bot_output.log 2>/dev/null; then
      success=true
      break
    fi
    sleep 1
    ((waited++))
  done

  if [ "$success" = true ]; then
    echo "✅ Trading bot confirmed running!"
  else
    echo "⚠️  Bot started, but discovery output not yet generated."
  fi

else
  echo "⚠️  curl not found — please start bot manually from the web UI."
fi

# -----------------------------------------------------
# Final Status
# -----------------------------------------------------
echo ""
echo "🟢 Everything is up and running!"
echo "   FastAPI server PID: $SERVER_PID"
echo "   Frontend PID: $FRONTEND_PID"
echo "------------------------------------------------------"
echo "💡 Press Ctrl+C to stop everything (server + bot + frontend)"
echo "------------------------------------------------------"

cleanup() {
  echo "\n🛑 Stopping services..."
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" 2>/dev/null
  fi
  if kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" 2>/dev/null
  fi
}

trap cleanup INT TERM
wait
