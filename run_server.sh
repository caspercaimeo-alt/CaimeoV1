#!/bin/zsh
# =====================================================
# run_server.sh — One-command launcher for Alpaca Bot
# =====================================================
export UNIVERSE_LIMIT=10000

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "🧹 Checking for existing Uvicorn processes..."
if pgrep -f "uvicorn server:app" >/dev/null 2>&1; then
  echo "⚠️  Found existing Uvicorn process — stopping it..."
  pkill -f "uvicorn server:app"
  sleep 2
fi

echo "🚀 Starting FastAPI server (port 8000)..."
uvicorn server:app --reload --port 8000 &
SERVER_PID=$!

# Give server time to boot
sleep 5

# Open FastAPI docs automatically (Mac = 'open')
if command -v open >/dev/null 2>&1; then
  open "http://127.0.0.1:8000/docs"
  echo "✅ FastAPI docs opened in browser."
else
  echo "Please open http://127.0.0.1:8000/docs manually."
fi

# -----------------------------------------------------
# Optional: Launch front-end (React or HTML)
# -----------------------------------------------------
if [ -d "alpaca-ui" ]; then
  echo "🎨 Launching front-end (alpaca-ui)..."
  cd alpaca-ui

  if [ -f "package.json" ]; then
    npm start &
    FRONTEND_PID=$!
  elif [ -f "index.html" ]; then
    open index.html
  fi

  cd "$PROJECT_DIR"
fi

# -----------------------------------------------------
# Auto-start trading bot via API
# -----------------------------------------------------
echo "🤖 Starting trading bot automatically..."
sleep 3
if command -v curl >/dev/null 2>&1; then
  curl -s -X POST "http://127.0.0.1:8000/start" >/dev/null
  echo "⌛ Verifying trading bot startup..."
  
  # Wait up to 15 seconds for a "started" log entry
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

  # 🩵 FIX: Verify unified discovery file structure before success confirmation
  if [ "$success" = true ]; then
    if [ -f "discovered_symbols.json" ]; then
      if grep -q '"symbols"' discovered_symbols.json && grep -q '"RECOVERY"' discovered_symbols.json && grep -q '"MOMENTUM"' discovered_symbols.json; then
        echo "✅ Trading bot and unified discovery confirmed running!"
      else
        echo "⚠️  Bot running, but discovery JSON not yet unified format — please check later."
      fi
    else
      echo "⚠️  Bot started, but discovery output not yet generated."
    fi
  else
    echo "⚠️  Could not confirm bot start (check bot_output.log)"
  fi
else
  echo "⚠️  curl not found — please start bot manually from the web UI."
fi

echo ""
echo "✅ Everything is up and running!"
echo "   FastAPI server PID: $SERVER_PID"
if [ -n "$FRONTEND_PID" ]; then
  echo "   Frontend PID: $FRONTEND_PID"
fi
echo "------------------------------------------------------"
echo "💡 Press Ctrl+C to stop everything (server + bot + frontend)"
echo "------------------------------------------------------"

# Graceful shutdown
trap "echo '\n🛑 Stopping services...'; kill $SERVER_PID $FRONTEND_PID 2>/dev/null; curl -s -X POST http://127.0.0.1:8000/stop >/dev/null; echo '✅ All services stopped cleanly.'" INT
wait $SERVER_PID
