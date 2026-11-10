"""Bounded exact ITEM lookup for KDOS allocation item codes; E10 is read-only."""
from __future__ import annotations

import json
import sys
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pmc_rd_progress_reader import E10Repository


def chunks(values: list[str], size: int = 300):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def serialize(value: Any):
    if isinstance(value, (bytes, bytearray)):
        return value.decode("gb18030", "replace")
    if isinstance(value, (datetime, date)):
        return value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(type(value).__name__)


def main() -> int:
    codes = json.load(sys.stdin)
    if not isinstance(codes, list) or len(codes) > 10000 or any(not isinstance(x, str) or not x.strip() for x in codes):
        raise ValueError("invalid bounded item code list")
    codes = list(dict.fromkeys(x.strip() for x in codes))
    result: dict[str, Any] = {"items": [], "sourceSnapshotAt": datetime.now().isoformat(sep=" ")}
    if codes:
        with E10Repository() as repo:
            for batch in chunks(codes):
                marks = ",".join(["%s"] * len(batch))
                result["items"].extend(repo._query(f"""
                    SELECT CONVERT(varchar(36), i.ITEM_BUSINESS_ID) item_id,
                           i.ITEM_CODE item_code, i.ITEM_NAME item_name
                    FROM dbo.ITEM i WHERE i.ITEM_CODE IN ({marks})
                """, batch))
    json.dump(result, sys.stdout, ensure_ascii=False, default=serialize)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # connection/config values are never included in output
        print(f"E10 item lookup failed: {type(exc).__name__}", file=sys.stderr)
        raise SystemExit(1)
