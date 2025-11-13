# ============================================================
#  server.py — FastAPI backend for CAIMEO UI
#  ✅ Dynamic Alpaca authentication
#  ✅ Background discovery loop (thread-safe)
#  ✅ Start/Stop responsive
#  ✅ /progress shows live status
#  ✅ /discovered filters A/B/C only (supports list/dict JSON)
#  ✅ Uses real progress from stock_discovery.PROGRESS
#  ✅ Fixed CORS for all localhost variants
#  ✅ Safe discovered file handling
# ============================================================

import os
import json
import time
import threading
import requests
from datetime import datetime
from typing import Dict, Any, List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

import stock_discovery  # our discovery engine

# ------------------------------------------------------------
# Globals
# ------------------------------------------------------------
DISCOVERY_FILE = os.getenv("DISCOVERY_OUTPUT", "discovered_full.json")
active_keys: Dict[str, str] = {}
bot_running = False
auto_discovery_thread = None

# shared progress state
discovery_progress = {
    "current": 0,
    "total": 0,
    "percent": 0.0,
    "eta": "N/A",
    "status": "Idle",
}

# ------------------------------------------------------------
# Utilities
# ------------------------------------------------------------
def _log(msg: str):
    print(msg)
    with open("bot_output.log", "a") as f:
        f.write(f"[{datetime.now()}] {msg}\n")


def _read_logs() -> List[str]:
    path = "bot_output.log"
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r") as f:
            return f.read().splitlines()[-500:]
    except Exception:
        return []

# ------------------------------------------------------------
# FastAPI setup
# ------------------------------------------------------------
app = FastAPI(title="CAIMEO Server")

# ✅ Fully permissive CORS (handles localhost, IP, 127.0.0.1)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://localhost(:\d+)?|http://127\.0\.0\.1(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------
# Models
# ------------------------------------------------------------
class AuthBody(BaseModel):
    apiKey: str
    apiSecret: str

# ------------------------------------------------------------
# API Routes
# ------------------------------------------------------------
@app.post("/auth")
async def auth_creds(payload: dict):
    """Validate Alpaca API credentials dynamically."""
    key = payload.get("apiKey")
    secret = payload.get("apiSecret")
    base = os.getenv("APCA_API_BASE_URL", "https://paper-api.alpaca.markets")

    if not key or not secret:
        return {"valid": False, "error": "Missing credentials"}

    try:
        r = requests.get(
            f"{base}/v2/account",
            headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret},
            timeout=10,
        )
        if r.status_code == 200:
            account = r.json()
            active_keys["apiKey"] = key
            active_keys["apiSecret"] = secret
            _log("✅ Alpaca authentication successful.")
            return {"valid": True, "account": account}
        else:
            _log(f"❌ Alpaca auth failed: {r.status_code} {r.text}")
            return {"valid": False, "error": r.text}
    except Exception as e:
        _log(f"❌ Auth exception: {e}")
        return {"valid": False, "error": str(e)}

@app.post("/start")
async def start():
    """Start bot + discovery loop."""
    global bot_running, auto_discovery_thread, discovery_progress

    if bot_running:
        return {"status": "already running"}

    if not active_keys:
        return {"status": "error", "message": "No valid Alpaca credentials yet."}

    bot_running = True
    _log("🚀 Trading bot started (LIVE_MODE=False)")

    key = active_keys.get("apiKey")
    secret = active_keys.get("apiSecret")

    def discovery_loop():
        global discovery_progress, bot_running
        while bot_running:
            try:
                discovery_progress = {
                    "current": 0,
                    "total": 0,
                    "percent": 0.0,
                    "eta": "Calculating...",
                    "status": "Running",
                }

                start_time = time.time()
                symbols = stock_discovery.list_tradable_symbols_via_alpaca(
                    key, secret, stock_discovery.UNIVERSE_LIMIT
                )
                cleaned = stock_discovery.clean_symbols(symbols)
                total = len(cleaned)
                discovery_progress["total"] = total

                def run_discovery():
                    try:
                        stock_discovery.discover_symbols(key, secret)
                        elapsed = time.time() - start_time
                        discovery_progress.update({
                            "current": total,
                            "percent": 100.0,
                            "eta": f"{int(elapsed/60)}m {int(elapsed%60)}s",
                            "status": "Complete",
                        })
                        _log("🏁 Discovery complete.")
                    except Exception as e:
                        discovery_progress["status"] = f"Error: {e}"
                        _log(f"⚠️ Discovery crash: {e}")

                t = threading.Thread(target=run_discovery, daemon=True)
                t.start()

                while bot_running and t.is_alive():
                    total_symbols = stock_discovery.PROGRESS.get("total", 0)
                    current_symbols = stock_discovery.PROGRESS.get("current", 0)

                    if total_symbols > 0:
                        pct = round((current_symbols / total_symbols) * 100, 2)
                        discovery_progress["current"] = current_symbols
                        discovery_progress["percent"] = pct
                        remaining = max(0, total_symbols - current_symbols)
                        discovery_progress["eta"] = f"~{remaining} left"
                    else:
                        discovery_progress["eta"] = "Calculating..."
                    time.sleep(1)

                t.join(timeout=3)
                if not bot_running:
                    discovery_progress["status"] = "Stopped"
                    _log("🟥 Discovery interrupted by user.")
                    break

                _log("🗓️ Next discovery in 5 min.")
                for _ in range(300):
                    if not bot_running:
                        discovery_progress["status"] = "Stopped"
                        _log("🟥 Bot stopped mid-wait.")
                        break
                    time.sleep(1)

            except Exception as e:
                discovery_progress["status"] = f"Error: {e}"
                _log(f"⚠️ Discovery loop exception: {e}")
                time.sleep(60)

    auto_discovery_thread = threading.Thread(target=discovery_loop, daemon=True)
    auto_discovery_thread.start()
    return {"status": "started"}

@app.post("/stop")
async def stop():
    global bot_running, discovery_progress
    if not bot_running:
        return {"status": "stopped"}
    bot_running = False
    discovery_progress["status"] = "Stopped"
    _log("🟥 Bot stopped.")
    return {"status": "stopped"}

@app.get("/status")
async def status():
    return {"status": "Running" if bot_running else "Stopped"}

@app.get("/progress")
async def progress():
    total = stock_discovery.PROGRESS.get("total", 0)
    current = stock_discovery.PROGRESS.get("current", 0)
    pct = round((current / total) * 100, 2) if total > 0 else 0.0
    discovery_progress.update({
        "current": current,
        "total": total,
        "percent": pct,
        "eta": f"~{max(0, total - current)} left" if total > 0 else "Calculating...",
    })
    return discovery_progress

@app.get("/positions")
async def positions():
    """Stub portfolio endpoint for frontend compatibility."""
    return {"positions": []}

@app.get("/account")
async def account():
    return {"cash": 12500.42, "invested": 8700.33}

from fastapi.encoders import jsonable_encoder
import math

@app.get("/discovered")
async def discovered():
    """Return discovery dataset + meta info with safe fallback."""
    try:
        # ✅ Prefer filtered file first, fallback to full
        for file in ["discovered_symbols.json", "discovered_full.json"]:
            if os.path.exists(file) and os.path.getsize(file) > 5:
                with open(file, "r") as f:
                    try:
                        data = json.load(f)
                        break
                    except json.JSONDecodeError:
                        _log(f"⚠️ Skipping invalid JSON file: {file}")
                        continue
        else:
            _log("⚠️ No discovery data found or valid JSON.")
            return {"symbols": [], "total_scanned": 0, "after_filters": 0, "displayed": 0}

        # ✅ Handle both dict and list JSON types
        if isinstance(data, list):
            symbols_data = data
        elif isinstance(data, dict):
            symbols_data = data.get("symbols", [])
        else:
            symbols_data = []

        valid = []
        for s in symbols_data:
            if not isinstance(s, dict):
                continue
            sym = s.get("symbol")
            price = s.get("last_price")
            conf = s.get("confidence")
            if not sym or price is None:
                continue

            # Normalize confidence
            if conf is None:
                continue
            if isinstance(conf, (int, float)):
                if conf >= 0.75:
                    conf = "A"
                elif conf >= 0.55:
                    conf = "B"
                elif conf >= 0.35:
                    conf = "C"
                else:
                    conf = "F"
            if isinstance(conf, str):
                conf = conf.upper().strip()

            s["confidence"] = conf
            if conf in ["A", "B", "C"]:
                valid.append(s)

        # ✅ Replace NaN, inf, -inf → None
        for v in valid:
            for k, val in v.items():
                if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
                    v[k] = None

        top16 = sorted(valid, key=lambda x: (x.get("score") or 0), reverse=True)[:16]
        _log(f"✅ Returning {len(top16)} symbols to UI")

        payload = {
            "total_scanned": len(symbols_data),
            "after_filters": len(valid),
            "displayed": len(top16),
            "symbols": top16,
        }

        return jsonable_encoder(payload)

    except Exception as e:
        _log(f"🚨 /discovered crashed: {e}")
        return {"symbols": [], "error": str(e), "total_scanned": 0, "after_filters": 0, "displayed": 0}

@app.get("/logs")
async def logs():
    return {"logs": _read_logs()}

# ------------------------------------------------------------
# Launch
# ------------------------------------------------------------
if __name__ == "__main__":
    _log("🟢 CAIMEO server starting up...")
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
