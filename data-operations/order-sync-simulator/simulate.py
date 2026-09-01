#!/usr/bin/env python3
"""Read-only incremental order synchronization simulator for E10 and T+.

The program reads SQL Server only. It never imports a PostgreSQL driver and has
no destination writer. Local cursor and report files are the only writes.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from datetime import datetime, timedelta
import io
import json
import os
from pathlib import Path
import re
import sys
import time
from typing import Any, Iterable, Sequence
import uuid

from basic_code import MSSQLDatabase
from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_ROOT = PROJECT_ROOT / "data" / "order-sync-simulator"
DEFAULT_LIMIT = 1_000
DEFAULT_INTERVAL_MINUTES = 30
DEFAULT_OVERLAP_MINUTES = 2
ISOLATION_LEVEL = "READ COMMITTED"
ZERO_UUID = "00000000-0000-0000-0000-000000000000"

OUTPUT_FIELDS = (
    "source_system",
    "source_database",
    "source_table",
    "source_id",
    "source_order_id",
    "source_order_line_id",
    "order_number",
    "modified_at",
)

FORBIDDEN_SQL = re.compile(
    r"\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|MERGE|TRUNCATE|EXEC|EXECUTE|DBCC)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class SourceConfig:
    key: str
    label: str
    source_system: str
    database: str | None
    settings: dict[str, str]
    streams: tuple["StreamSpec", ...]


@dataclass(frozen=True)
class StreamSpec:
    key: str
    role: str
    source_table: str
    primary_key_kind: str
    query: str
    mapping_note: str | None = None

    @property
    def minimum_primary_key(self) -> str:
        return ZERO_UUID if self.primary_key_kind == "uuid" else "-2147483648"

    def query_primary_key(self, value: str) -> str | int:
        return value if self.primary_key_kind == "uuid" else int(value)

    def primary_key_after(self, left: str, right: str) -> bool:
        if self.primary_key_kind == "integer":
            return int(left) > int(right)
        # SQL Server's uniqueidentifier ordering follows its mixed-endian storage.
        return uuid.UUID(left).bytes_le > uuid.UUID(right).bytes_le


def _e10_queries() -> tuple[StreamSpec, ...]:
    return (
        StreamSpec(
            "order_header",
            "订单主表",
            "SALES_ORDER_DOC",
            "uuid",
            """
SELECT TOP ({limit})
  N'E10' AS source_system, DB_NAME() AS source_database,
  N'SALES_ORDER_DOC' AS source_table,
  CONVERT(nvarchar(36), h.SALES_ORDER_DOC_ID) AS source_id,
  CONVERT(nvarchar(36), h.SALES_ORDER_DOC_ID) AS source_order_id,
  CAST(NULL AS nvarchar(36)) AS source_order_line_id,
  CONVERT(nvarchar(100), h.DOC_NO) AS order_number,
  h.LastModifiedDate AS modified_at
FROM dbo.SALES_ORDER_DOC h
WHERE h.LastModifiedDate IS NOT NULL
  AND (h.LastModifiedDate > %s
       OR (h.LastModifiedDate = %s
           AND h.SALES_ORDER_DOC_ID > CONVERT(uniqueidentifier, %s)))
  AND h.LastModifiedDate <= %s
ORDER BY h.LastModifiedDate, h.SALES_ORDER_DOC_ID
""",
        ),
        StreamSpec(
            "order_detail",
            "订单明细表",
            "SALES_ORDER_DOC_D",
            "uuid",
            """
SELECT TOP ({limit})
  N'E10' AS source_system, DB_NAME() AS source_database,
  N'SALES_ORDER_DOC_D' AS source_table,
  CONVERT(nvarchar(36), d.SALES_ORDER_DOC_D_ID) AS source_id,
  CONVERT(nvarchar(36), d.SALES_ORDER_DOC_ID) AS source_order_id,
  CONVERT(nvarchar(36), d.SALES_ORDER_DOC_D_ID) AS source_order_line_id,
  CONVERT(nvarchar(100), h.DOC_NO) AS order_number,
  d.LastModifiedDate AS modified_at
FROM dbo.SALES_ORDER_DOC_D d
LEFT JOIN dbo.SALES_ORDER_DOC h ON h.SALES_ORDER_DOC_ID=d.SALES_ORDER_DOC_ID
WHERE d.LastModifiedDate IS NOT NULL
  AND (d.LastModifiedDate > %s
       OR (d.LastModifiedDate = %s
           AND d.SALES_ORDER_DOC_D_ID > CONVERT(uniqueidentifier, %s)))
  AND d.LastModifiedDate <= %s
ORDER BY d.LastModifiedDate, d.SALES_ORDER_DOC_D_ID
""",
        ),
        StreamSpec(
            "delivery_plan",
            "交付计划表",
            "SALES_ORDER_DOC_SD",
            "uuid",
            """
SELECT TOP ({limit})
  N'E10' AS source_system, DB_NAME() AS source_database,
  N'SALES_ORDER_DOC_SD' AS source_table,
  CONVERT(nvarchar(36), s.SALES_ORDER_DOC_SD_ID) AS source_id,
  CONVERT(nvarchar(36), d.SALES_ORDER_DOC_ID) AS source_order_id,
  CONVERT(nvarchar(36), d.SALES_ORDER_DOC_D_ID) AS source_order_line_id,
  CONVERT(nvarchar(100), h.DOC_NO) AS order_number,
  s.LastModifiedDate AS modified_at
FROM dbo.SALES_ORDER_DOC_SD s
LEFT JOIN dbo.SALES_ORDER_DOC_D d ON d.SALES_ORDER_DOC_D_ID=s.SALES_ORDER_DOC_D_ID
LEFT JOIN dbo.SALES_ORDER_DOC h ON h.SALES_ORDER_DOC_ID=d.SALES_ORDER_DOC_ID
WHERE s.LastModifiedDate IS NOT NULL
  AND (s.LastModifiedDate > %s
       OR (s.LastModifiedDate = %s
           AND s.SALES_ORDER_DOC_SD_ID > CONVERT(uniqueidentifier, %s)))
  AND s.LastModifiedDate <= %s
ORDER BY s.LastModifiedDate, s.SALES_ORDER_DOC_SD_ID
""",
        ),
        StreamSpec(
            "outbound_detail",
            "出库明细表",
            "SALES_ISSUE_D",
            "uuid",
            """
SELECT TOP ({limit})
  N'E10' AS source_system, DB_NAME() AS source_database,
  N'SALES_ISSUE_D' AS source_table,
  CONVERT(nvarchar(36), i.SALES_ISSUE_D_ID) AS source_id,
  CONVERT(nvarchar(36), COALESCE(delivery.SALES_ORDER_DOC_ID, od.SALES_ORDER_DOC_ID)) AS source_order_id,
  CONVERT(nvarchar(36), od.SALES_ORDER_DOC_D_ID) AS source_order_line_id,
  CONVERT(nvarchar(100), oh.DOC_NO) AS order_number,
  i.LastModifiedDate AS modified_at
FROM dbo.SALES_ISSUE_D i
LEFT JOIN dbo.SALES_DELIVERY_D delivery
  ON delivery.SALES_DELIVERY_D_ID=i.SOURCE_ID_ROid
 AND i.SOURCE_ID_RTK=N'SALES_DELIVERY.SALES_DELIVERY_D'
LEFT JOIN dbo.SALES_ORDER_DOC_SD schedule
  ON schedule.SALES_ORDER_DOC_SD_ID=delivery.SOURCE_ID_ROid
LEFT JOIN dbo.SALES_ORDER_DOC_D od
  ON od.SALES_ORDER_DOC_D_ID=schedule.SALES_ORDER_DOC_D_ID
LEFT JOIN dbo.SALES_ORDER_DOC oh
  ON oh.SALES_ORDER_DOC_ID=COALESCE(delivery.SALES_ORDER_DOC_ID, od.SALES_ORDER_DOC_ID)
WHERE i.LastModifiedDate IS NOT NULL
  AND (i.LastModifiedDate > %s
       OR (i.LastModifiedDate = %s
           AND i.SALES_ISSUE_D_ID > CONVERT(uniqueidentifier, %s)))
  AND i.LastModifiedDate <= %s
ORDER BY i.LastModifiedDate, i.SALES_ISSUE_D_ID
""",
            "出库行经 SALES_DELIVERY_D 回溯销售订单；无法稳定回溯时订单标识为空。",
        ),
        StreamSpec(
            "inventory",
            "库存表",
            "ITEM_WAREHOUSE",
            "uuid",
            """
SELECT TOP ({limit})
  N'E10' AS source_system, DB_NAME() AS source_database,
  N'ITEM_WAREHOUSE' AS source_table,
  CONVERT(nvarchar(36), s.ITEM_WAREHOUSE_ID) AS source_id,
  CAST(NULL AS nvarchar(36)) AS source_order_id,
  CAST(NULL AS nvarchar(36)) AS source_order_line_id,
  CAST(NULL AS nvarchar(100)) AS order_number,
  s.LastModifiedDate AS modified_at
FROM dbo.ITEM_WAREHOUSE s
WHERE s.LastModifiedDate IS NOT NULL
  AND (s.LastModifiedDate > %s
       OR (s.LastModifiedDate = %s
           AND s.ITEM_WAREHOUSE_ID > CONVERT(uniqueidentifier, %s)))
  AND s.LastModifiedDate <= %s
ORDER BY s.LastModifiedDate, s.ITEM_WAREHOUSE_ID
""",
        ),
    )


def _tplus_queries() -> tuple[StreamSpec, ...]:
    return (
        StreamSpec(
            "order_header",
            "订单主表",
            "SA_SaleOrder",
            "integer",
            """
SELECT TOP ({limit})
  N'T+' AS source_system, DB_NAME() AS source_database,
  N'SA_SaleOrder' AS source_table,
  CONVERT(nvarchar(100), h.ID) AS source_id,
  CONVERT(nvarchar(100), h.ID) AS source_order_id,
  CAST(NULL AS nvarchar(100)) AS source_order_line_id,
  CONVERT(nvarchar(100), h.code) AS order_number,
  h.updated AS modified_at
FROM dbo.SA_SaleOrder h
WHERE h.updated IS NOT NULL
  AND (h.updated > %s OR (h.updated = %s AND h.ID > %s))
  AND h.updated <= %s
ORDER BY h.updated, h.ID
""",
        ),
        StreamSpec(
            "order_detail",
            "订单明细表",
            "SA_SaleOrder_b",
            "integer",
            """
SELECT TOP ({limit})
  N'T+' AS source_system, DB_NAME() AS source_database,
  N'SA_SaleOrder_b' AS source_table,
  CONVERT(nvarchar(100), d.id) AS source_id,
  CONVERT(nvarchar(100), d.idSaleOrderDTO) AS source_order_id,
  CONVERT(nvarchar(100), d.id) AS source_order_line_id,
  CONVERT(nvarchar(100), h.code) AS order_number,
  d.updated AS modified_at
FROM dbo.SA_SaleOrder_b d
LEFT JOIN dbo.SA_SaleOrder h ON h.ID=d.idSaleOrderDTO
WHERE d.updated IS NOT NULL
  AND (d.updated > %s OR (d.updated = %s AND d.id > %s))
  AND d.updated <= %s
ORDER BY d.updated, d.id
""",
        ),
        StreamSpec(
            "delivery_plan",
            "交付计划表",
            "SA_SaleOrder_b",
            "integer",
            """
SELECT TOP ({limit})
  N'T+' AS source_system, DB_NAME() AS source_database,
  N'SA_SaleOrder_b' AS source_table,
  CONVERT(nvarchar(100), d.id) AS source_id,
  CONVERT(nvarchar(100), d.idSaleOrderDTO) AS source_order_id,
  CONVERT(nvarchar(100), d.id) AS source_order_line_id,
  CONVERT(nvarchar(100), h.code) AS order_number,
  d.updated AS modified_at
FROM dbo.SA_SaleOrder_b d
LEFT JOIN dbo.SA_SaleOrder h ON h.ID=d.idSaleOrderDTO
WHERE d.updated IS NOT NULL
  AND (d.updated > %s OR (d.updated = %s AND d.id > %s))
  AND d.updated <= %s
ORDER BY d.updated, d.id
""",
            "T+ 的 deliveryDate 位于订单明细表；该逻辑流独立保存游标，但 source_table 如实保留 SA_SaleOrder_b。",
        ),
        StreamSpec(
            "outbound_detail",
            "出库明细表",
            "ST_RDRecord_b",
            "integer",
            """
SELECT TOP ({limit})
  N'T+' AS source_system, DB_NAME() AS source_database,
  N'ST_RDRecord_b' AS source_table,
  CONVERT(nvarchar(100), d.ID) AS source_id,
  CONVERT(nvarchar(100), so.ID) AS source_order_id,
  CONVERT(nvarchar(100), d.saleOrderDetailId) AS source_order_line_id,
  CONVERT(nvarchar(100), COALESCE(so.code, d.saleOrderCode)) AS order_number,
  d.updated AS modified_at
FROM dbo.ST_RDRecord_b d
LEFT JOIN dbo.SA_SaleOrder_b sod ON sod.id=d.saleOrderDetailId
LEFT JOIN dbo.SA_SaleOrder so ON so.ID=sod.idSaleOrderDTO
WHERE d.updated IS NOT NULL
  AND (d.updated > %s OR (d.updated = %s AND d.ID > %s))
  AND d.updated <= %s
ORDER BY d.updated, d.ID
""",
        ),
        StreamSpec(
            "inventory",
            "库存表",
            "ST_NewCurrentStock",
            "integer",
            """
SELECT TOP ({limit})
  N'T+' AS source_system, DB_NAME() AS source_database,
  N'ST_NewCurrentStock' AS source_table,
  CONVERT(nvarchar(100), s.id) AS source_id,
  CAST(NULL AS nvarchar(100)) AS source_order_id,
  CAST(NULL AS nvarchar(100)) AS source_order_line_id,
  CAST(NULL AS nvarchar(100)) AS order_number,
  s.updated AS modified_at
FROM dbo.ST_NewCurrentStock s
WHERE s.updated IS NOT NULL
  AND (s.updated > %s OR (s.updated = %s AND s.id > %s))
  AND s.updated <= %s
ORDER BY s.updated, s.id
""",
        ),
    )


def load_source_configs(
    project_root: Path = PROJECT_ROOT,
    required_sources: Sequence[str] | None = None,
) -> dict[str, SourceConfig]:
    load_dotenv(project_root / ".env", override=False)
    tplus_required = ("TPLUS_SQL_HOST", "TPLUS_SQL_PORT", "TPLUS_SQL_USER", "TPLUS_SQL_PASSWORD")
    missing = [name for name in tplus_required if not os.environ.get(name)]
    needs_tplus = required_sources is None or any(
        source.startswith("tplus-") for source in required_sources
    )
    if missing and needs_tplus:
        raise ValueError(f"缺少 T+ 只读连接配置：{', '.join(missing)}")
    configs = {
        "e10": SourceConfig(
            "e10", "E10", "E10", None, {}, _e10_queries()
        )
    }
    if missing:
        return configs
    tplus_settings = {
        "server": os.environ["TPLUS_SQL_HOST"],
        "port": os.environ["TPLUS_SQL_PORT"],
        "user": os.environ["TPLUS_SQL_USER"],
        "password": os.environ["TPLUS_SQL_PASSWORD"],
    }
    configs.update({
        "tplus-kainan": SourceConfig(
            "tplus-kainan", "T+凯南智能", "T+", "UFTData741219_000012",
            dict(tplus_settings), _tplus_queries()
        ),
        "tplus-kejia": SourceConfig(
            "tplus-kejia", "T+科加智能", "T+", "UFTData418971_000003",
            dict(tplus_settings), _tplus_queries()
        ),
    })
    return configs


def assert_read_only_query(query: str) -> None:
    normalized = query.strip()
    if not normalized.upper().startswith("SELECT"):
        raise ValueError("只读保护拒绝非 SELECT 语句")
    if ";" in normalized:
        raise ValueError("只读保护拒绝多语句批次")
    forbidden = FORBIDDEN_SQL.search(normalized)
    if forbidden:
        raise ValueError(f"只读保护拒绝关键字 {forbidden.group(0).upper()}")


class ReadOnlyMssqlSession:
    """One source-specific session using the mandated MSSQLDatabase wrapper."""

    def __init__(self, source: SourceConfig):
        self.source = source
        self.database = MSSQLDatabase(
            database=source.database,
            autoconnect=False,
            **source.settings,
        )
        with io.StringIO() as hidden, _redirect_stdout(hidden):
            driver = self.database._get_available_driver()
        if driver != "pytds":
            raise RuntimeError("只读模拟器当前要求 basic_code 使用 pytds 驱动")
        self.connection = self.database._connect_pytds()
        self.connection.autocommit = True
        cursor = self.connection.cursor()
        try:
            cursor.execute(
                "SET TRANSACTION ISOLATION LEVEL READ COMMITTED; "
                "SET LOCK_TIMEOUT 5000; SET NOCOUNT ON"
            )
        finally:
            cursor.close()

    def close(self) -> None:
        self.connection.close()

    def __enter__(self) -> "ReadOnlyMssqlSession":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def query(self, query: str, parameters: Sequence[Any] = ()) -> list[dict[str, Any]]:
        assert_read_only_query(query)
        cursor = self.connection.cursor()
        try:
            cursor.execute(query, tuple(parameters))
            columns = [column[0] for column in cursor.description or ()]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            cursor.close()

    def server_now(self) -> datetime:
        rows = self.query("SELECT GETDATE() AS server_now")
        return rows[0]["server_now"]

    def verified_isolation_level(self) -> str:
        rows = self.query(
            "SELECT CASE transaction_isolation_level "
            "WHEN 2 THEN N'READ COMMITTED' ELSE CONVERT(nvarchar(10), transaction_isolation_level) END "
            "AS isolation_level FROM sys.dm_exec_sessions WHERE session_id=@@SPID"
        )
        return str(rows[0]["isolation_level"])


class _redirect_stdout:
    """Tiny local redirect to avoid basic_code driver diagnostics in data output."""

    def __init__(self, target: io.StringIO):
        self.target = target
        self.previous: Any = None

    def __enter__(self) -> None:
        self.previous = sys.stdout
        sys.stdout = self.target

    def __exit__(self, *_: object) -> None:
        sys.stdout = self.previous


def datetime_text(value: datetime | str) -> str:
    if isinstance(value, datetime):
        return value.isoformat(timespec="microseconds")
    return datetime.fromisoformat(str(value)).isoformat(timespec="microseconds")


def parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value)


def atomic_json_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def load_cursor_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schema_version": 1, "streams": {}}
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema_version") != 1 or not isinstance(value.get("streams"), dict):
        raise ValueError(f"游标文件格式无效：{path}")
    return value


def initial_cursor(stream: StreamSpec, server_now: datetime, lookback_minutes: int) -> dict[str, Any]:
    return {
        "modified_at": datetime_text(server_now - timedelta(minutes=lookback_minutes)),
        "primary_key": stream.minimum_primary_key,
        "initialized": False,
    }


def normalize_record(row: dict[str, Any]) -> dict[str, Any]:
    record = {field: row.get(field) for field in OUTPUT_FIELDS}
    record["source_id"] = str(record["source_id"])
    for field in ("source_order_id", "source_order_line_id", "order_number"):
        if record[field] is not None:
            record[field] = str(record[field])
    record["modified_at"] = datetime_text(record["modified_at"])
    return record


def duplicate_source_ids(records: Iterable[dict[str, Any]]) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for record in records:
        value = record["source_id"]
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return sorted(duplicates)


def simulate_stream(
    session: ReadOnlyMssqlSession,
    stream: StreamSpec,
    previous: dict[str, Any],
    limit: int,
    overlap_minutes: int,
    scan_upper_bound: datetime,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    previous_time = parse_datetime(previous["modified_at"])
    query_time = previous_time - timedelta(minutes=overlap_minutes)
    query_primary_key = stream.minimum_primary_key
    query = stream.query.format(limit=limit).strip()
    started = time.perf_counter()
    rows = session.query(query, (
        query_time,
        query_time,
        stream.query_primary_key(query_primary_key),
        scan_upper_bound,
    ))
    elapsed_ms = round((time.perf_counter() - started) * 1_000, 3)
    records = [normalize_record(row) for row in rows]
    duplicates = duplicate_source_ids(records)

    if records:
        final = records[-1]
        final_time = parse_datetime(final["modified_at"])
        final_is_after_previous = (
            final_time > previous_time
            or (
                final_time == previous_time
                and stream.primary_key_after(final["source_id"], previous["primary_key"])
            )
        )
        if len(records) < limit:
            next_cursor = {
                "modified_at": datetime_text(scan_upper_bound),
                "primary_key": stream.minimum_primary_key,
                "initialized": True,
            }
            cursor_advance_reason = "查询未满批，已完整扫描至来源服务器时间上界"
        elif final_is_after_previous or not previous.get("initialized"):
            next_cursor = {
                "modified_at": final["modified_at"],
                "primary_key": final["source_id"],
                "initialized": True,
            }
            cursor_advance_reason = "达到批次上限，保存最后一条记录的修改时间＋主键"
        else:
            next_cursor = {**previous, "initialized": True}
            cursor_advance_reason = "达到批次上限且仅命中重叠记录，游标保持不变"
        max_modified_at = final["modified_at"]
        max_primary_key = final["source_id"]
    else:
        next_cursor = {
            "modified_at": datetime_text(scan_upper_bound),
            "primary_key": stream.minimum_primary_key,
            "initialized": True,
        }
        cursor_advance_reason = "本批无记录，已安全推进至来源服务器时间上界"
        max_modified_at = None
        max_primary_key = None

    replay_count = 0
    if previous.get("initialized"):
        replay_count = sum(
            1 for record in records
            if parse_datetime(record["modified_at"]) <= previous_time
        )

    summary = {
        "stream": stream.key,
        "table_role": stream.role,
        "source_table": stream.source_table,
        "mapping_note": stream.mapping_note,
        "previous_cursor": {
            "modified_at": previous["modified_at"],
            "primary_key": previous["primary_key"],
            "initialized": bool(previous.get("initialized")),
        },
        "query_cursor": {
            "modified_at": datetime_text(query_time),
            "primary_key": query_primary_key,
        },
        "scan_upper_bound": datetime_text(scan_upper_bound),
        "current_max_modified_at": max_modified_at,
        "current_max_primary_key": max_primary_key,
        "changed_record_count": len(records),
        "query_elapsed_ms": elapsed_ms,
        "duplicate_record_detected": bool(duplicates or replay_count),
        "duplicate_within_batch_detected": bool(duplicates),
        "duplicate_source_ids": duplicates,
        "overlap_replay_count": replay_count,
        "time_boundary_gap_risk": False,
        "time_boundary_gap_risk_reason": "2分钟重叠窗口和修改时间＋主键确定性排序已启用",
        "batch_limit_reached": len(records) == limit,
        "backlog_note": "达到批次上限，后续批次将从本次复合游标继续" if len(records) == limit else None,
        "next_cursor": next_cursor,
        "cursor_advance_reason": cursor_advance_reason,
    }
    return summary, records, next_cursor


def _safe_error(error: Exception, secrets: Iterable[str]) -> str:
    value = f"{type(error).__name__}: {error}"
    for secret in secrets:
        if secret:
            value = value.replace(secret, "***")
    return value


def simulate_source(
    source: SourceConfig,
    cursor_path: Path,
    limit: int,
    interval_minutes: int,
    overlap_minutes: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    cursor_document = load_cursor_file(cursor_path)
    new_cursor_document = {
        "schema_version": 1,
        "source_key": source.key,
        "source_system": source.source_system,
        "source_database": source.database,
        "isolation_level": ISOLATION_LEVEL,
        "streams": dict(cursor_document["streams"]),
    }
    result: dict[str, Any] = {
        "source_key": source.key,
        "source_label": source.label,
        "source_system": source.source_system,
        "configured_database": source.database,
        "isolation_level": ISOLATION_LEVEL,
        "connection_mode": "保持现有连接方式",
        "tables": [],
        "records": [],
        "error": None,
    }
    secrets = (source.settings.get("password", ""), source.settings.get("user", ""))
    try:
        with ReadOnlyMssqlSession(source) as session:
            server_now = session.server_now()
            result["source_server_time"] = datetime_text(server_now)
            result["source_database"] = session.database.database
            result["verified_isolation_level"] = session.verified_isolation_level()
            new_cursor_document["source_database"] = session.database.database
            for stream in source.streams:
                previous = cursor_document["streams"].get(stream.key)
                if previous is None:
                    previous = initial_cursor(stream, server_now, interval_minutes)
                try:
                    summary, records, next_cursor = simulate_stream(
                        session, stream, previous, limit, overlap_minutes, server_now
                    )
                    result["tables"].append(summary)
                    for record in records:
                        result["records"].append({"stream": stream.key, **record})
                    new_cursor_document["streams"][stream.key] = next_cursor
                except Exception as error:  # continue testing other physical tables
                    result["tables"].append({
                        "stream": stream.key,
                        "table_role": stream.role,
                        "source_table": stream.source_table,
                        "error": _safe_error(error, secrets),
                        "cursor_advanced": False,
                    })
    except Exception as error:
        result["error"] = _safe_error(error, secrets)
    return result, new_cursor_document


def write_csv(path: Path, fieldnames: Sequence[str], rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def flatten_table_summaries(run_id: str, sources: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for source in sources:
        for table in source["tables"]:
            previous = table.get("previous_cursor") or {}
            rows.append({
                "run_id": run_id,
                "source_key": source["source_key"],
                "source_system": source["source_system"],
                "source_database": source.get("source_database") or source.get("configured_database"),
                "stream": table["stream"],
                "table_role": table["table_role"],
                "source_table": table["source_table"],
                "previous_modified_at": previous.get("modified_at"),
                "previous_primary_key": previous.get("primary_key"),
                "current_max_modified_at": table.get("current_max_modified_at"),
                "current_max_primary_key": table.get("current_max_primary_key"),
                "changed_record_count": table.get("changed_record_count"),
                "query_elapsed_ms": table.get("query_elapsed_ms"),
                "duplicate_record_detected": table.get("duplicate_record_detected"),
                "duplicate_within_batch_detected": table.get("duplicate_within_batch_detected"),
                "overlap_replay_count": table.get("overlap_replay_count"),
                "time_boundary_gap_risk": table.get("time_boundary_gap_risk"),
                "batch_limit_reached": table.get("batch_limit_reached"),
                "error": table.get("error"),
            })
    return rows


def save_reports(report: dict[str, Any], report_dir: Path) -> dict[str, str]:
    run_id = report["run_id"]
    json_path = report_dir / f"{run_id}.json"
    record_path = report_dir / f"{run_id}_records.csv"
    table_path = report_dir / f"{run_id}_tables.csv"
    atomic_json_write(json_path, report)

    record_fields = ("run_id", "stream", *OUTPUT_FIELDS)
    record_rows = [
        {"run_id": run_id, **record}
        for source in report["sources"] for record in source["records"]
    ]
    write_csv(record_path, record_fields, record_rows)
    table_rows = flatten_table_summaries(run_id, report["sources"])
    table_fields = tuple(table_rows[0].keys()) if table_rows else (
        "run_id", "source_key", "source_system", "source_database", "stream"
    )
    write_csv(table_path, table_fields, table_rows)
    return {
        "json": str(json_path),
        "records_csv": str(record_path),
        "tables_csv": str(table_path),
    }


def print_report(report: dict[str, Any], paths: dict[str, str]) -> None:
    print(f"模拟批次：{report['run_id']}（隔离级别：{ISOLATION_LEVEL}）")
    for source in report["sources"]:
        database = source.get("source_database") or source.get("configured_database") or "未知"
        print(f"\n[{source['source_label']}] 来源数据库={database}")
        if source.get("error"):
            print(f"连接/查询失败：{source['error']}")
            continue
        for table in source["tables"]:
            if table.get("error"):
                print(f"- {table['table_role']} ({table['source_table']}): 失败；{table['error']}")
                continue
            previous = table["previous_cursor"]
            print(
                f"- {table['table_role']} ({table['source_table']}): "
                f"上次游标={previous['modified_at']} + {previous['primary_key']}；"
                f"本次最大={table['current_max_modified_at']} + {table['current_max_primary_key']}；"
                f"变化数={table['changed_record_count']}；耗时={table['query_elapsed_ms']}ms；"
                f"重复={table['duplicate_record_detected']}；"
                f"时间边界漏读风险={table['time_boundary_gap_risk']}"
            )
        for record in source["records"]:
            print(
                "  "
                f"source_system={record['source_system']} | "
                f"source_database={record['source_database']} | "
                f"source_table={record['source_table']} | "
                f"source_id={record['source_id']} | "
                f"source_order_id={record['source_order_id']} | "
                f"source_order_line_id={record['source_order_line_id']} | "
                f"order_number={record['order_number']} | "
                f"modified_at={record['modified_at']}"
            )
    print("\n报告文件：")
    for kind, path in paths.items():
        print(f"- {kind}: {path}")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="E10/T+ 只读增量同步模拟器")
    parser.add_argument(
        "--source", action="append",
        choices=("all", "e10", "tplus-kainan", "tplus-kejia"),
        help="可重复指定；默认 all",
    )
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--interval-minutes", type=int, default=DEFAULT_INTERVAL_MINUTES)
    parser.add_argument("--overlap-minutes", type=int, default=DEFAULT_OVERLAP_MINUTES)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument(
        "--no-advance-cursors", action="store_true",
        help="仍生成报告，但不更新本地模拟游标",
    )
    args = parser.parse_args(argv)
    if not 1 <= args.limit <= DEFAULT_LIMIT:
        parser.error(f"--limit 必须在 1 到 {DEFAULT_LIMIT} 之间")
    if args.interval_minutes <= 0:
        parser.error("--interval-minutes 必须为正整数")
    if not 1 <= args.overlap_minutes < args.interval_minutes:
        parser.error("--overlap-minutes 必须大于0且小于同步间隔")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    requested = args.source or ["all"]
    source_keys = (
        ["e10", "tplus-kainan", "tplus-kejia"]
        if "all" in requested else list(dict.fromkeys(requested))
    )
    configs = load_source_configs(required_sources=source_keys)
    run_id = datetime.now().strftime("%Y%m%dT%H%M%S%f")
    report: dict[str, Any] = {
        "schema_version": 1,
        "run_id": run_id,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "mode": "READ_ONLY_SIMULATION",
        "destination": None,
        "postgresql_connected": False,
        "source_write_operations": False,
        "isolation_level": ISOLATION_LEVEL,
        "interval_minutes": args.interval_minutes,
        "overlap_minutes": args.overlap_minutes,
        "batch_limit": args.limit,
        "source_identity_fields": list(OUTPUT_FIELDS[:6]),
        "sources": [],
    }
    pending_cursors: list[tuple[Path, dict[str, Any]]] = []
    for source_key in source_keys:
        source = configs[source_key]
        cursor_path = args.data_root / "cursors" / f"{source.key}.json"
        result, cursor_document = simulate_source(
            source, cursor_path, args.limit, args.interval_minutes, args.overlap_minutes
        )
        report["sources"].append(result)
        pending_cursors.append((cursor_path, cursor_document))

    paths = save_reports(report, args.data_root / "reports")
    if not args.no_advance_cursors:
        for path, cursor_document in pending_cursors:
            atomic_json_write(path, cursor_document)
    print_report(report, paths)
    has_error = any(
        source.get("error")
        or any(table.get("error") for table in source["tables"])
        for source in report["sources"]
    )
    return 1 if has_error else 0


if __name__ == "__main__":
    raise SystemExit(main())
