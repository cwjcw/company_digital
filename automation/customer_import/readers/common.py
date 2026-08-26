from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from hashlib import sha256
import json
from typing import Any

import pandas as pd


def scalar(value: Any) -> Any:
    if value is None or (not isinstance(value, (list, dict)) and pd.isna(value)):
        return None
    if isinstance(value, pd.Timestamp):
        value = value.to_pydatetime()
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return format(value, "f")
    if hasattr(value, "item"):
        return scalar(value.item())
    return value


def records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    return [{str(key): scalar(value) for key, value in row.items()} for row in frame.to_dict(orient="records")]


def text(value: Any) -> str | None:
    value = scalar(value)
    normalized = str(value or "").strip()
    return normalized or None


def flag(value: Any) -> bool:
    value = scalar(value)
    return str(value or "0").strip().lower() not in {"", "0", "false", "none", "no"}


def snapshot_hash(snapshot: dict[str, Any]) -> str:
    stable = {key: value for key, value in snapshot.items() if key not in {"extractedAt", "idempotencyKey", "replaceDemoData"}}
    payload = json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return sha256(payload).hexdigest()
