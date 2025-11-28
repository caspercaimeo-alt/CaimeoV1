"""
Auto-trading loop for CAIMEO.
Reads discovered symbols, sizes trades by fixed % risk, and places Alpaca bracket orders.
Controlled by the server start/stop (threading.Event) rather than env flags.
"""

import json
import math
import os
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

try:
    from alpaca_trade_api.rest import REST, APIError
except Exception:  # alpaca may be missing in some envs
    REST = None  # type: ignore
    APIError = Exception  # type: ignore

import trade_logger


LOG_FILE = os.getenv("LOG_FILE", "bot_output.log")
DISCOVERED_FILE = os.getenv("DISCOVERED_FILE", "discovered_full.json")
BASE_URL = os.getenv("APCA_API_BASE_URL", "https://paper-api.alpaca.markets")
TRADE_POLL_SEC = int(os.getenv("TRADE_POLL_SEC", "60"))
MAX_POSITIONS = int(os.getenv("MAX_POSITIONS", "3"))
MIN_TRADE_CONFIDENCE = os.getenv("MIN_TRADE_CONFIDENCE", "B").upper()
RISK_PER_TRADE_PCT = float(os.getenv("RISK_PER_TRADE_PCT", "1.0"))  # % of equity
STOP_LOSS_PCT = float(os.getenv("STOP_LOSS_PCT", "3.0"))
TRAIL_STOP_PCT = float(os.getenv("TRAIL_STOP_PCT", "6.0"))  # trailing exit for attached stops
MAX_DAY_TRADES_PER_WEEK = int(os.getenv("MAX_DAY_TRADES_PER_WEEK", "10"))
ENTRY_SLIPPAGE_PCT = float(os.getenv("ENTRY_SLIPPAGE_PCT", "0.3"))  # % above last price for limit
MINUTES_AFTER_OPEN = int(os.getenv("MINUTES_AFTER_OPEN", "15"))  # wait N minutes after market open
STOP_EXIT_MODE = os.getenv("STOP_EXIT_MODE", "trailing").lower()  # trailing | stop_limit
STOP_LIMIT_PCT = float(os.getenv("STOP_LIMIT_PCT", str(STOP_LOSS_PCT)))
STOP_LIMIT_SLIPPAGE_PCT = float(os.getenv("STOP_LIMIT_SLIPPAGE_PCT", "0.5"))  # extra % below stop for limit
HOLIDAY_GUARD_ENABLED = os.getenv("HOLIDAY_GUARD_ENABLED", "true").lower() == "true"
HOLIDAY_SKIP_ENTRY_MINUTES = int(os.getenv("HOLIDAY_SKIP_ENTRY_MINUTES", "90"))
HOLIDAY_TIGHTEN_MINUTES = int(os.getenv("HOLIDAY_TIGHTEN_MINUTES", "120"))
HOLIDAY_TIGHTEN_TRAIL_PCT = float(os.getenv("HOLIDAY_TIGHTEN_TRAIL_PCT", "2.5"))
HOLIDAY_LONG_CLOSE_HOURS = float(os.getenv("HOLIDAY_LONG_CLOSE_HOURS", "20"))

# Symbols that already have protective exits attached in this session
ATTACHED_EXITS = set()
# Track order status changes to log fills/cancels
ORDER_STATUS_CACHE: Dict[str, str] = {}


def _log(msg: str) -> None:
    """Append a log line to bot_output.log and stdout."""
    ts = time.strftime("[%Y-%m-%d %H:%M:%S]")
    line = f"{ts} {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a", buffering=1) as f:
            f.write(line + "\n")
    except Exception:
        pass


def _confidence_ok(value) -> bool:
    """Return True if confidence meets the configured minimum."""
    if value is None:
        return False
    if isinstance(value, str):
        letter = value.strip().upper()
    elif isinstance(value, (int, float)):
        if value >= 0.75:
            letter = "A"
        elif value >= 0.55:
            letter = "B"
        elif value >= 0.35:
            letter = "C"
        else:
            letter = "F"
    else:
        return False

    order = ["A", "B", "C", "D", "F"]
    try:
        return order.index(letter) <= order.index(MIN_TRADE_CONFIDENCE)
    except ValueError:
        return False


def _load_discovered(path: str) -> List[Dict]:
    """Load discovered symbols from JSON file; supports dict or list payloads."""
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r") as f:
            data = json.load(f)
    except Exception as e:
        _log(f"⚠️ Failed to read discovered file {path}: {e}")
        return []

    if isinstance(data, dict):
        symbols = data.get("symbols", [])
    elif isinstance(data, list):
        symbols = data
    else:
        symbols = []

    cleaned = []
    for row in symbols:
        if not isinstance(row, dict):
            continue
        sym = row.get("symbol")
        price = row.get("last_price") or row.get("last")
        conf = row.get("confidence")
        if not sym or price is None:
            continue
        if not _confidence_ok(conf):
            continue
        cleaned.append(
            {
                "symbol": sym,
                "price": float(price),
                "confidence": conf,
                "score": row.get("score", 0),
                "strategy": row.get("strategy"),
            }
        )

    cleaned.sort(key=lambda x: x.get("score", 0), reverse=True)
    return cleaned


def _init_api(key: str, secret: str, base_url: str) -> Optional[REST]:
    if REST is None:
        _log("⚠️ alpaca-trade-api not installed; auto-trading disabled.")
        return None
    try:
        api = REST(key, secret, base_url, api_version="v2")
        _ = api.get_account()
        _log("✅ Alpaca trading client initialized.")
        return api
    except Exception as e:
        _log(f"❌ Failed to authenticate Alpaca API: {e}")
        return None


def _current_state(api: REST) -> Tuple[float, List[str], List[str], List]:
    """Return (equity, open_position_symbols, open_order_symbols, position_objects)."""
    acct = api.get_account()
    equity = float(getattr(acct, "equity", 0))
    position_objs = api.list_positions() if hasattr(api, "list_positions") else []
    positions = [p.symbol for p in position_objs]
    orders = [o.symbol for o in api.list_orders(status="open")] if hasattr(api, "list_orders") else []
    return equity, positions, orders, position_objs


def _calc_qty(last_price: float, equity: float) -> int:
    """Position size using fixed risk per trade and stop distance."""
    if last_price <= 0 or equity <= 0:
        return 0
    per_share_risk = last_price * (STOP_LOSS_PCT / 100)
    allowed_risk = equity * (RISK_PER_TRADE_PCT / 100)
    if per_share_risk <= 0:
        return 0
    qty = math.floor(allowed_risk / per_share_risk)
    return max(qty, 1) if qty > 0 else 0


def _submit_exit_order(
    api: REST,
    symbol: str,
    side: str,
    qty: int,
    ref_price: Optional[float],
    trail_override: Optional[float] = None,
) -> bool:
    """Submit an exit order using configured mode (trailing or stop-limit)."""
    try:
        if STOP_EXIT_MODE == "stop_limit":
            if ref_price is None or ref_price <= 0:
                _log(f"⚠️ Cannot place stop-limit for {symbol}: missing ref price.")
                return False
            stop_price = round(ref_price * (1 - STOP_LIMIT_PCT / 100), 2)
            limit_price = round(stop_price * (1 - STOP_LIMIT_SLIPPAGE_PCT / 100), 2)
            api.submit_order(
                symbol=symbol,
                side=side,
                type="stop_limit",
                qty=qty,
                stop_price=stop_price,
                limit_price=limit_price,
                time_in_force="gtc",
            )
            _log(
                f"🛑 Stop-limit exit placed for {symbol} qty={qty} stop={stop_price} "
                f"limit={limit_price} (ref={ref_price})"
            )
            return True

        # Default trailing stop behavior
        trail_pct = trail_override if trail_override is not None else TRAIL_STOP_PCT
        api.submit_order(
            symbol=symbol,
            side=side,
            type="trailing_stop",
            qty=qty,
            trail_percent=trail_pct,
            time_in_force="gtc",
        )
        _log(f"🛡️ Trailing stop exit placed for {symbol} qty={qty} trail={trail_pct}%")
        return True
    except APIError as e:
        _log(f"⚠️ Alpaca API error placing exit for {symbol}: {e}")
    except Exception as e:
        _log(f"⚠️ Unexpected error placing exit for {symbol}: {e}")
    return False


def _submit_bracket(
    api: REST,
    symbol: str,
    last_price: float,
    qty: int,
    strategy: Optional[str],
    trail_override: Optional[float] = None,
) -> bool:
    """
    Place a market buy, then a separate trailing-stop sell to let spikes run.
    Using two orders avoids Alpaca OTO validation on missing stop_price.
    """
    trail_pct = trail_override if trail_override is not None else TRAIL_STOP_PCT
    try:
        limit_price = round(last_price * (1 + ENTRY_SLIPPAGE_PCT / 100), 2)
        api.submit_order(
            symbol=symbol,
            side="buy",
            type="limit",
            qty=qty,
            limit_price=limit_price,
            time_in_force="day",
        )
        _log(
            f"🟢 Limit buy {symbol} qty={qty} @<= {limit_price} (last={last_price}) "
            f"with exit mode={STOP_EXIT_MODE}"
        )

        # Submit a separate exit order so profits can run.
        if not _submit_exit_order(api, symbol, "sell", qty, last_price, trail_override=trail_pct):
            return False
        trade_logger.append_event(
            {
                "event": "entry_submitted",
                "symbol": symbol,
                "strategy": strategy,
                "price": last_price,
                "qty": qty,
                "take_profit": None,
                "stop_loss": None,
                "trail_percent": trail_pct,
            }
        )
        return True
    except APIError as e:
        _log(f"⚠️ Alpaca API error placing {symbol}: {e}")
    except Exception as e:
        _log(f"⚠️ Unexpected error placing {symbol}: {e}")
    return False


def _attach_exit_orders(
    api: REST,
    positions: List,
    open_order_symbols: List[str],
    trail_override: Optional[float] = None,
) -> None:
    """
    For any existing position lacking an open order, attach a trailing-stop exit
    so legacy holdings get protection even if the bot did not open them.
    """
    global ATTACHED_EXITS
    for pos in positions:
        sym = getattr(pos, "symbol", None)
        if not sym:
            continue
        if sym in open_order_symbols or sym in ATTACHED_EXITS:
            continue

        try:
            qty_raw = getattr(pos, "qty", None)
            qty = abs(int(float(qty_raw))) if qty_raw is not None else 0
        except Exception:
            qty = 0
        if qty <= 0:
            continue

        side = "sell" if float(getattr(pos, "qty", 0)) >= 0 else "buy"
        ref_price = None
        try:
            ref_price = float(getattr(pos, "current_price", getattr(pos, "current_price", 0)))
        except Exception:
            ref_price = None

        try:
            if _submit_exit_order(api, sym, side, qty, ref_price, trail_override=trail_override):
                ATTACHED_EXITS.add(sym)
                trade_logger.append_event(
                    {
                        "event": "exit_attached",
                        "symbol": sym,
                        "qty": qty,
                        "trail_percent": TRAIL_STOP_PCT if STOP_EXIT_MODE == "trailing" else None,
                        "stop_limit_pct": STOP_LIMIT_PCT if STOP_EXIT_MODE == "stop_limit" else None,
                    }
                )
        except APIError as e:
            _log(f"⚠️ Alpaca API error attaching exit for {sym}: {e}")
        except Exception as e:
            _log(f"⚠️ Unexpected error attaching exit for {sym}: {e}")


def _count_entries_this_week(path: str) -> int:
    """Count trade entries in the current ISO week from trade_events.jsonl."""
    if not os.path.exists(path):
        return 0
    try:
        now = datetime.now(timezone.utc)
        iso_year, iso_week, _ = now.isocalendar()
        count = 0
        with open(path, "r") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                    ts = rec.get("ts")
                    if not ts:
                        continue
                    dt = datetime.fromisoformat(ts).astimezone(timezone.utc)
                    y, w, _ = dt.isocalendar()
                    if y == iso_year and w == iso_week and rec.get("event") == "entry_submitted":
                        count += 1
                except Exception:
                    continue
        return count
    except Exception:
        return 0


def _market_ready(api: REST) -> bool:
    """Return True if market is open and past the post-open delay."""
    try:
        clock = api.get_clock()
        if not getattr(clock, "is_open", False):
            return False
        now = datetime.now(timezone.utc)
        open_time_str = getattr(clock, "last_open", None) or getattr(clock, "next_open", None)
        if open_time_str:
            open_time = datetime.fromisoformat(str(open_time_str)).astimezone(timezone.utc)
            if (now - open_time).total_seconds() < MINUTES_AFTER_OPEN * 60:
                return False
        return True
    except Exception:
        return True


def _log_order_updates(api: REST) -> None:
    """Detect order status transitions and write them to the log/event file."""
    global ORDER_STATUS_CACHE
    try:
        orders = api.list_orders(status="all", limit=100)
    except Exception as e:
        _log(f"⚠️ Could not list orders for status logging: {e}")
        return

    for o in orders:
        oid = getattr(o, "id", None) or getattr(o, "order_id", None)
        status = getattr(o, "status", None)
        if not oid or not status:
            continue

        prev = ORDER_STATUS_CACHE.get(oid)
        if prev == status:
            continue
        ORDER_STATUS_CACHE[oid] = status

        if status.lower() in {"filled", "canceled", "rejected", "expired", "stopped"}:
            payload = {
                "event": "order_update",
                "order_id": oid,
                "symbol": getattr(o, "symbol", None),
                "side": getattr(o, "side", None),
                "status": status,
                "type": getattr(o, "type", None),
                "qty": getattr(o, "qty", None) or getattr(o, "filled_qty", None),
                "filled_avg_price": getattr(o, "filled_avg_price", None),
                "stop_price": getattr(o, "stop_price", None),
                "limit_price": getattr(o, "limit_price", None),
                "trail_percent": getattr(o, "trail_percent", None),
            }
            trade_logger.append_event(payload)
            _log(f"ℹ️ Exit update: {payload}")


def _holiday_guard_state(api: REST) -> Tuple[bool, bool]:
    """
    Return (skip_new_entries, tighten_exits) based on time to close/next open.
    - skip_new_entries: pause new buys near close or during long closures.
    - tighten_exits: request tighter exits pre-close/holiday.
    """
    if not HOLIDAY_GUARD_ENABLED:
        return False, False

    try:
        clock = api.get_clock()
        now = datetime.now(timezone.utc)
        next_open = getattr(clock, "next_open", None)
        next_close = getattr(clock, "next_close", None)

        minutes_to_close = None
        if getattr(clock, "is_open", False) and next_close:
            close_dt = datetime.fromisoformat(str(next_close)).astimezone(timezone.utc)
            minutes_to_close = max(0, (close_dt - now).total_seconds() / 60)

        long_gap = False
        if next_open:
            open_dt = datetime.fromisoformat(str(next_open)).astimezone(timezone.utc)
            hours_to_open = (open_dt - now).total_seconds() / 3600
            long_gap = hours_to_open >= HOLIDAY_LONG_CLOSE_HOURS

        skip_entries = False
        tighten_exits = False

        if minutes_to_close is not None and minutes_to_close <= HOLIDAY_SKIP_ENTRY_MINUTES:
            skip_entries = True
        if minutes_to_close is not None and minutes_to_close <= HOLIDAY_TIGHTEN_MINUTES:
            tighten_exits = True

        if long_gap:
            skip_entries = True
            tighten_exits = True

        if skip_entries or tighten_exits:
            _log(
                f"🎌 Holiday/close guard active | skip_entries={skip_entries} "
                f"tighten_exits={tighten_exits} "
                f"minutes_to_close={minutes_to_close} long_gap={long_gap}"
            )
        return skip_entries, tighten_exits
    except Exception as e:
        _log(f"⚠️ Holiday guard check failed: {e}")
        return False, False


def run(stop_event, api_key: str, api_secret: str, base_url: str = BASE_URL) -> None:
    """Blocking trading loop; meant to run inside a daemon thread."""
    api = _init_api(api_key, api_secret, base_url)
    if api is None:
        return

    _log(
        f"🤖 Auto-trader running | poll={TRADE_POLL_SEC}s | min_conf={MIN_TRADE_CONFIDENCE} | "
        f"max_pos={MAX_POSITIONS} | risk={RISK_PER_TRADE_PCT}% | "
        f"size_sl={STOP_LOSS_PCT}% trail_stop={TRAIL_STOP_PCT}%"
    )

    while not stop_event.is_set():
        try:
            symbols = _load_discovered(DISCOVERED_FILE)
            if not symbols:
                _log("⏸ No trade candidates (empty discovery list).")
                time.sleep(TRADE_POLL_SEC)
                continue

            # Day-trade cap guardrail (per calendar ISO week)
            week_entries = _count_entries_this_week(trade_logger.TRADE_EVENTS_LOG)
            if week_entries >= MAX_DAY_TRADES_PER_WEEK:
                _log(f"⏸ Day-trade cap reached ({week_entries}/{MAX_DAY_TRADES_PER_WEEK} this week).")
                time.sleep(TRADE_POLL_SEC)
                continue

            equity, positions, open_orders, position_objs = _current_state(api)
            _log_order_updates(api)
            skip_entries, tighten_exits = _holiday_guard_state(api)
            trail_guard = HOLIDAY_TIGHTEN_TRAIL_PCT if tighten_exits and STOP_EXIT_MODE == "trailing" else None

            # Always try to attach exits even if we're waiting for market open.
            try:
                to_remove = set(ATTACHED_EXITS) - set(positions)
                for sym in to_remove:
                    ATTACHED_EXITS.discard(sym)
                _attach_exit_orders(api, position_objs, open_orders, trail_override=trail_guard)
            except Exception as e:
                _log(f"⚠️ Exit attachment step failed: {e}")

            if not _market_ready(api):
                _log(f"⏸ Waiting for market + {MINUTES_AFTER_OPEN}m post-open window before entries.")
                time.sleep(TRADE_POLL_SEC)
                continue

            if skip_entries:
                _log("⏸ Holiday/close guard: skipping new entries this cycle.")
                time.sleep(TRADE_POLL_SEC)
                continue

            active_count = len(positions) + len(open_orders)
            slots = max(0, MAX_POSITIONS - active_count)
            if slots <= 0:
                _log("⏸ Position cap reached; waiting for slots to free up.")
                time.sleep(TRADE_POLL_SEC)
                continue

            placed = 0
            for row in symbols:
                if stop_event.is_set() or placed >= slots:
                    break
                sym = row["symbol"]
                price = row["price"]

                if sym in positions or sym in open_orders:
                    continue

                qty = _calc_qty(price, equity)
                if qty <= 0:
                    _log(f"⚠️ Skipping {sym}: could not size position (price={price}, equity={equity}).")
                    continue

                if _submit_bracket(api, sym, price, qty, row.get("strategy"), trail_override=trail_guard):
                    placed += 1

            if placed == 0:
                _log("⏸ No trade action this cycle.")

        except Exception as e:
            _log(f"❌ Trading loop error: {e}")

        time.sleep(TRADE_POLL_SEC)

    _log("🟥 Auto-trader stopped.")
