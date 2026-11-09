"""Bounded read-only E10 lookup for KDOS allocation item codes.

Input is a JSON array of exact ITEM_CODE values. It never queries E10 sales orders
and never scans ITEM/BOM without an allocation-derived code filter.
"""
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


def uuid_text(value: Any) -> str:
    if isinstance(value, (bytes, bytearray)):
        return value.decode("ascii", "strict").strip()
    return str(value).strip()


def main() -> int:
    codes = json.load(sys.stdin)
    if not isinstance(codes, list) or len(codes) > 10000 or any(not isinstance(x, str) or not x.strip() for x in codes):
        raise ValueError("invalid bounded item code list")
    codes = list(dict.fromkeys(x.strip() for x in codes))
    result: dict[str, Any] = {"items": [], "plants": [], "boms": [], "sourceSnapshotAt": datetime.now().isoformat(sep=" ")}
    if not codes:
        json.dump(result, sys.stdout, ensure_ascii=False, default=serialize)
        return 0
    with E10Repository() as repo:
        for batch in chunks(codes):
            marks = ",".join(["%s"] * len(batch))
            result["items"].extend(repo._query(f"""
                SELECT CONVERT(varchar(36), i.ITEM_BUSINESS_ID) item_id,
                       i.ITEM_CODE item_code, i.ITEM_NAME item_name
                FROM dbo.ITEM i WHERE i.ITEM_CODE IN ({marks})
            """, batch))
        item_ids = list(dict.fromkeys(uuid_text(row["item_id"]) for row in result["items"] if row.get("item_id")))
        for batch in chunks(item_ids):
            marks = ",".join(["%s"] * len(batch))
            result["plants"].extend(repo._query(f"""
                SELECT CONVERT(varchar(36), ip.ITEM_ID) item_id,
                       CONVERT(varchar(36), ip.Owner_Org_ROid) owner_org_id,
                       ip.ITEM_PROPERTY item_property,
                       ip.ITEM_ROUTING_CONTROL item_routing_control
                FROM dbo.ITEM_PLANT ip WHERE ip.ITEM_ID IN ({marks})
            """, batch))
            result["boms"].extend(repo._query(f"""
                SELECT CONVERT(varchar(36), b.BOM_ID) bom_id,
                       CONVERT(varchar(36), b.ITEM_ID) item_id,
                       CONVERT(varchar(36), b.Owner_Org_ROid) owner_org_id,
                       b.VERSION_TIMES version_times, b.E_CODE e_code,
                       b.ApproveStatus approve_status, b.CreateDate created_at,
                       b.ApproveDate approved_at, bd.ApproveStatus detail_approve_status,
                       bd.EFFECTIVE_DATE effective_date, bd.EXPRITY_DATE expiry_date
                FROM dbo.BOM b
                LEFT JOIN dbo.BOM_D bd ON bd.BOM_ID=b.BOM_ID
                WHERE b.ITEM_ID IN ({marks})
            """, batch))
    json.dump(result, sys.stdout, ensure_ascii=False, default=serialize)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # no connection/config values are included in error messages
        print(f"E10 BOM read failed: {type(exc).__name__}", file=sys.stderr)
        raise SystemExit(1)
