"""Read-only BOM-head snapshot and Change Tracking stream for the KDOS indexer.

Protocol is newline-delimited JSON. No BOM_D queries or source writes are used.
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pmc_rd_progress_reader import E10Repository


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, default=serialize) + "\n")
    sys.stdout.flush()


def serialize(value: Any):
    if isinstance(value, (bytes, bytearray)):
        return value.decode("gb18030", "replace")
    if isinstance(value, (datetime, date)):
        return value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(type(value).__name__)


def version(repo: E10Repository) -> int:
    rows = repo._query("SELECT CHANGE_TRACKING_CURRENT_VERSION() AS version")
    value = rows[0].get("version") if rows else None
    if value is None:
        raise RuntimeError("CHANGE_TRACKING_UNAVAILABLE")
    return int(value)


def min_valid_version(repo: E10Repository) -> int:
    rows = repo._query("SELECT CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID('dbo.BOM')) AS version")
    value = rows[0].get("version") if rows else None
    if value is None:
        raise RuntimeError("CHANGE_TRACKING_UNAVAILABLE")
    return int(value)


def source_fields(alias: str = "b") -> str:
    return f"""CONVERT(varchar(36),{alias}.BOM_ID) source_bom_id,
      CONVERT(varchar(36),{alias}.ITEM_ID) item_id, i.ITEM_CODE item_code,
      CONVERT(varchar(36),{alias}.Owner_Org_ROid) owner_org_id,
      CONVERT(varchar(100),{alias}.VERSION_TIMES) version_times,
      {alias}.ApproveStatus approve_status, {alias}.ApproveDate approve_date,
      {alias}.CreateDate create_date, {alias}.ModifiedDate modified_date,
      {alias}.LastModifiedDate last_modified_date"""


def stream_snapshot(repo: E10Repository, page_size: int) -> tuple[int, int]:
    start_version = version(repo)
    emit({"type": "begin", "mode": "FULL", "fromVersion": start_version})
    cursor: str | None = None
    scanned = 0
    while True:
        if cursor is None:
            rows = repo._query(f"""SELECT TOP (%s) {source_fields()}
              FROM dbo.BOM b LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=b.ITEM_ID
              WHERE b.ApproveStatus='Y' ORDER BY b.BOM_ID""", [page_size])
        else:
            rows = repo._query(f"""SELECT TOP (%s) {source_fields()}
              FROM dbo.BOM b LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=b.ITEM_ID
              WHERE b.ApproveStatus='Y' AND b.BOM_ID>CONVERT(uniqueidentifier,%s)
              ORDER BY b.BOM_ID""", [page_size, cursor])
        if not rows:
            break
        cursor = str(rows[-1]["source_bom_id"])
        scanned += len(rows)
        emit({"type": "snapshot", "records": rows})
    target_version = version(repo)
    stream_changes(repo, start_version, target_version, page_size)
    emit({"type": "end", "mode": "FULL", "toVersion": target_version, "scanned": scanned})
    return scanned, target_version


def stream_changes(repo: E10Repository, from_version: int, target_version: int, page_size: int) -> int:
    minimum = min_valid_version(repo)
    if from_version < minimum:
        raise RuntimeError("CHANGE_TRACKING_RETENTION_GAP")
    emit({"type": "changes_begin", "fromVersion": from_version, "toVersion": target_version})
    cursor_version = from_version
    cursor_bom_id: str | None = None
    scanned = 0
    while True:
        cursor_clause = "" if cursor_bom_id is None else "AND (ct.SYS_CHANGE_VERSION>%s OR (ct.SYS_CHANGE_VERSION=%s AND ct.BOM_ID>CONVERT(uniqueidentifier,%s)))"
        params: list[Any] = [page_size, from_version, target_version]
        if cursor_bom_id is not None:
            params.extend([cursor_version, cursor_version, cursor_bom_id])
        rows = repo._query(f"""SELECT TOP (%s) ct.SYS_CHANGE_VERSION change_version,
              ct.SYS_CHANGE_OPERATION change_operation,
              CONVERT(varchar(36),ct.BOM_ID) changed_bom_id,
              {source_fields()}
            FROM CHANGETABLE(CHANGES dbo.BOM,%s) AS ct
            LEFT JOIN dbo.BOM b ON b.BOM_ID=ct.BOM_ID
            LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=b.ITEM_ID
            WHERE ct.SYS_CHANGE_VERSION<=%s {cursor_clause}
            ORDER BY ct.SYS_CHANGE_VERSION,ct.BOM_ID""", params)
        if not rows:
            break
        changes = []
        for row in rows:
            operation = "DELETE" if row["change_operation"] == "D" else "UPSERT" if row.get("approve_status") == "Y" else "REVOKE"
            changes.append({"operation": operation, **row, "source_bom_id": row["changed_bom_id"]})
        cursor_version = int(rows[-1]["change_version"])
        cursor_bom_id = str(rows[-1]["changed_bom_id"])
        scanned += len(rows)
        emit({"type": "changes", "records": changes})
    return scanned


def main() -> int:
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or request.get("mode") not in ("FULL", "INCREMENTAL"):
        raise ValueError("invalid sync request")
    page_size = int(request.get("pageSize", 500))
    if not 1 <= page_size <= 1000:
        raise ValueError("invalid page size")
    with E10Repository() as repo:
        if request["mode"] == "FULL":
            stream_snapshot(repo, page_size)
        else:
            from_version = int(request["fromVersion"])
            target_version = version(repo)
            emit({"type": "begin", "mode": "INCREMENTAL", "fromVersion": from_version})
            scanned = stream_changes(repo, from_version, target_version, page_size)
            emit({"type": "end", "mode": "INCREMENTAL", "toVersion": target_version, "scanned": scanned})
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        code = str(exc)
        safe_code = code if code in {"CHANGE_TRACKING_UNAVAILABLE", "CHANGE_TRACKING_RETENTION_GAP"} else type(exc).__name__
        print(f"E10 BOM sync read failed: {safe_code}", file=sys.stderr)
        raise SystemExit(1)
