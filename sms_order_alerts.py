"""SMS alert helpers for order submissions and status changes.

This module centralizes deduplication, persistence, and toggle checks so both
server endpoints and the trading loop can emit SMS notifications without
changing payloads or UI behavior.
"""

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple

import email_notifier

BASE_DIR = Path(__file__).resolve().parent
STATE_PATH = BASE_DIR / "sms_order_alert_state.json"
SMS_CONFIG_PATH = BASE_DIR / "sms_config.json"

STATE_LOCK = threading.Lock()
STATE_TEMPLATE = {
    "last_order_status": {},
    "sent_submit_ids": [],
    "sent_transitions": [],
    "cooldowns": {},
}
SUBMIT_CACHE_MAX = 300
TRANSITION_CACHE_MAX = 500
COOLDOWN_SECONDS = 20


def _atomic_write_json(path: Path, data: Dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def _load_state() -> Dict[str, Any]:
    if STATE_PATH.exists():
        try:
            with STATE_PATH.open("r") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    for key, default in STATE_TEMPLATE.items():
                        data.setdefault(key, default.copy())
                    return data
        except Exception:
            pass
    return STATE_TEMPLATE.copy()


STATE = _load_state()


def _save_state() -> None:
    try:
        _atomic_write_json(STATE_PATH, STATE)
    except Exception:
        pass


def sms_enabled() -> bool:
    """Return True when a SMS email is configured."""
    try:
        cfg = {}
        if SMS_CONFIG_PATH.exists():
            with SMS_CONFIG_PATH.open("r") as f:
                cfg = json.load(f) or {}
        sms_email = cfg.get("sms_email")
        if sms_email:
            return True
        return bool(email_notifier._load_sms_email())
    except Exception:
        return False


def _format_price(order: Any) -> str:
    limit_price = getattr(order, "limit_price", None) if hasattr(order, "limit_price") else None
    stop_price = getattr(order, "stop_price", None) if hasattr(order, "stop_price") else None
    if isinstance(order, dict):
        limit_price = order.get("limit_price", limit_price)
        stop_price = order.get("stop_price", stop_price)
    if limit_price:
        return f"@ {limit_price}"
    if stop_price:
        return f"stop {stop_price}"
    return "market"


def _extract(order: Any) -> Tuple[Optional[str], str, str, str, str, str, str]:
    if order is None:
        return None, "", "", "", "", "", ""
    if isinstance(order, dict):
        oid = order.get("id") or order.get("order_id")
        sym = order.get("symbol", "")
        side = str(order.get("side", "")).upper()
        qty = str(order.get("qty", ""))
        otype = str(order.get("type", ""))
        status = str(order.get("status", ""))
    else:
        oid = getattr(order, "id", None) or getattr(order, "order_id", None)
        sym = getattr(order, "symbol", "")
        side = str(getattr(order, "side", "")).upper()
        qty = str(getattr(order, "qty", ""))
        otype = str(getattr(order, "type", ""))
        status = str(getattr(order, "status", ""))
    price_desc = _format_price(order)
    return oid, sym, side, qty, otype, status, price_desc


def _prune_caches() -> None:
    if len(STATE["sent_submit_ids"]) > SUBMIT_CACHE_MAX:
        STATE["sent_submit_ids"] = STATE["sent_submit_ids"][-SUBMIT_CACHE_MAX:]
    if len(STATE["sent_transitions"]) > TRANSITION_CACHE_MAX:
        STATE["sent_transitions"] = STATE["sent_transitions"][-TRANSITION_CACHE_MAX:]
    # trim stale cooldowns
    cutoff = time.time() - (COOLDOWN_SECONDS * 5)
    STATE["cooldowns"] = {k: v for k, v in STATE.get("cooldowns", {}).items() if v >= cutoff}


def _log_failure(log_fn, error: str) -> None:
    try:
        log_fn(f"❌ SMS failed: {error}")
    except Exception:
        pass


def _send(line: str, log_fn) -> bool:
    try:
        sent = email_notifier.send_sms_line(line)
        if not sent:
            _log_failure(log_fn, "send_sms_line returned False")
        return sent
    except Exception as e:
        _log_failure(log_fn, str(e))
        return False


def handle_order_submit(order: Any, log_fn, alerts_enabled: Optional[bool] = None) -> None:
    """Send a one-time SMS/log when a new order is submitted."""
    oid, sym, side, qty, otype, status, price_desc = _extract(order)
    if not oid:
        return
    with STATE_LOCK:
        if oid in STATE.get("sent_submit_ids", []):
            return
        STATE["sent_submit_ids"].append(oid)
        _prune_caches()
        enabled = sms_enabled() if alerts_enabled is None else alerts_enabled
        line = (
            f"📲 SMS: Order submitted {side} {qty} {sym} {otype} {price_desc} "
            f"| status={status} | id={oid}"
        )
        if enabled:
            if _send(line, log_fn):
                try:
                    log_fn(line)
                except Exception:
                    pass
        _save_state()


def handle_status_changes(orders: Iterable[Any], log_fn, alerts_enabled: Optional[bool] = None) -> None:
    now = time.time()
    enabled = sms_enabled() if alerts_enabled is None else alerts_enabled
    with STATE_LOCK:
        for order in orders:
            oid, sym, side, qty, otype, status, price_desc = _extract(order)
            if not oid or not status:
                continue
            prev_status = STATE["last_order_status"].get(oid)
            STATE["last_order_status"][oid] = status
            if prev_status is None or prev_status == status:
                continue
            transition_key = (oid, prev_status, status)
            if transition_key in STATE.get("sent_transitions", []):
                continue
            last_ts = STATE.get("cooldowns", {}).get(oid, 0)
            if now - last_ts < COOLDOWN_SECONDS:
                continue
            STATE["cooldowns"][oid] = now
            STATE["sent_transitions"].append(transition_key)
            _prune_caches()
            line = (
                f"📲 SMS: Order update {sym} {side} {qty} {otype} {price_desc} "
                f"| {prev_status} → {status} (id={oid})"
            )
            if enabled:
                if _send(line, log_fn):
                    try:
                        log_fn(line)
                    except Exception:
                        pass
        _save_state()
