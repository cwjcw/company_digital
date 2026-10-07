"""E10 read-only integration adapter. Emits facts only; no progress business rules.

Shared MSSQLDatabase provides credentials. RCSI statement reads are captured once;
sourceSnapshotAt is an observation/cursor cutoff, not a historical database snapshot.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Sequence

BASIC_CODE_ROOT = Path(os.getenv("RD_BASIC_CODE_ROOT", "/data/automation/code/work/basci/basic_code"))
ZERO_GUID = "00000000-0000-0000-0000-000000000000"
FORMAL_CANDIDATE_START = datetime(2026,9,1)
QUERY_BATCH_SIZE = 500
@dataclass(frozen=True)
class BomDetail:
    bom_detail_id: str
    approve_status: str | None
    effective_date: datetime | None
    expiry_date: datetime | None
    created_at: datetime | None = None
    last_modified_at: datetime | None = None


@dataclass
class BomCandidate:
    bom_id: str
    item_id: str
    owner_org_id: str | None
    version_times: str | None
    e_code: str | None
    approve_status: str | None
    created_at: datetime | None = None
    last_modified_at: datetime | None = None
    details: list[BomDetail] = field(default_factory=list)


@dataclass(frozen=True)
class RoutingDetail:
    routing_detail_id: str
    approve_status: str | None
    operation_id: str | None
    operation_exists: bool
    operation_seq: str | None = None
    created_at: datetime | None = None
    last_modified_at: datetime | None = None


@dataclass
class RoutingCandidate:
    routing_id: str
    item_id: str
    owner_org_id: str | None
    item_feature_id: str | None
    routing_code: str | None
    approve_status: str | None
    created_at: datetime | None = None
    last_modified_at: datetime | None = None
    details: list[RoutingDetail] = field(default_factory=list)


def normalize_guid(value: Any) -> str | None:
    """Normalize SQL UUID values and the E10 zero GUID sentinel."""
    if value is None:
        return None
    normalized = (value.decode("gb18030","replace") if isinstance(value,(bytes,bytearray)) else str(value)).strip().lower()
    if not normalized or normalized == ZERO_GUID:
        return None
    return normalized


def normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        return value.decode("gb18030", "replace")
    text = str(value).strip()
    return text or None


def chunks(values: Iterable[str], size: int = QUERY_BATCH_SIZE) -> Iterable[list[str]]:
    unique = list(dict.fromkeys(value for value in values if value))
    for index in range(0, len(unique), size):
        yield unique[index : index + size]


class E10Repository:
    """Small read-only repository; business decisions stay outside SQL."""

    def __init__(self) -> None:
        sys.path.insert(0, str(BASIC_CODE_ROOT))
        from sql_server import MSSQLDatabase  # pylint: disable=import-outside-toplevel
        import pytds  # pylint: disable=import-outside-toplevel

        env_file = BASIC_CODE_ROOT / ".env"
        config = MSSQLDatabase(
            env_path=str(env_file) if os.access(env_file, os.R_OK) else "/dev/null",
            autoconnect=False,
        )
        self.connection = pytds.connect(
            server=config.server,
            port=int(config.port),
            database=config.database,
            user=config.user,
            password=config.password,
            timeout=120,
            login_timeout=30,
            readonly=True,
            bytes_to_unicode=False,
        )
        cursor = self.connection.cursor()
        cursor.execute(
            "SET TRANSACTION ISOLATION LEVEL READ COMMITTED; "
            "SET LOCK_TIMEOUT 10000; SET NOCOUNT ON"
        )
        cursor.close()

    def close(self) -> None:
        self.connection.close()

    def __enter__(self) -> E10Repository:
        return self

    def __exit__(self, *_args: Any) -> None:
        self.close()

    def _query(self, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
        cursor = self.connection.cursor()
        try:
            cursor.execute(sql, tuple(params))
            columns = [column[0] for column in cursor.description or []]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            cursor.close()

    def load_order_lines(
        self, order_no: str | None = None, candidate_scope: bool = False
    ) -> list[dict[str, Any]]:
        if bool(order_no) == bool(candidate_scope):
            raise ValueError("必须且只能指定订单号或正式候选范围")
        if order_no:
            where = "so.DOC_NO = %s"
            params: list[Any] = [order_no]
        else:
            where = "(so.CreateDate >= %s OR so.LastModifiedDate >= %s)"
            params = [FORMAL_CANDIDATE_START, FORMAL_CANDIDATE_START]
        return self._query(
            f"""
            SELECT
              CONVERT(varchar(36), so.SALES_ORDER_DOC_ID) AS order_id,
              so.DOC_NO AS order_no,
              so.ORDER_DATE AS order_date,
              so.CreateDate AS order_created_at,
              so.LastModifiedDate AS order_last_modified_at,
              CONVERT(varchar(36),so.Owner_Dept) AS owner_dept_id,
              dept.ADMIN_UNIT_NAME AS owner_dept_name,
              so.ApproveStatus AS order_status_raw,
              CONVERT(varchar(36), so.CUSTOMER_ID) AS customer_id,
              c.CUSTOMER_CODE AS customer_code,
              c.CUSTOMER_NAME AS customer_name,
              sod.SequenceNumber AS line_number,
              CONVERT(varchar(36), sod.SALES_ORDER_DOC_D_ID) AS order_line_id,
              CONVERT(varchar(36), sod.ITEM_ID) AS item_id,
              CONVERT(varchar(36), sod.ITEM_FEATURE_ID) AS item_feature_id,
              sod.BUSINESS_QTY AS quantity,
              i.ITEM_CODE AS item_code,
              i.ITEM_NAME AS item_name,
              i.ITEM_SPECIFICATION AS item_specification
            FROM dbo.SALES_ORDER_DOC so
            JOIN dbo.SALES_ORDER_DOC_D sod
              ON sod.SALES_ORDER_DOC_ID = so.SALES_ORDER_DOC_ID
            LEFT JOIN dbo.ADMIN_UNIT dept ON dept.ADMIN_UNIT_ID=so.Owner_Dept
            LEFT JOIN dbo.CUSTOMER c
              ON c.CUSTOMER_BUSINESS_ID = so.CUSTOMER_ID
            LEFT JOIN dbo.ITEM i
              ON i.ITEM_BUSINESS_ID = sod.ITEM_ID
            WHERE {where}
            ORDER BY so.DOC_NO, sod.SequenceNumber, sod.SALES_ORDER_DOC_D_ID
            """,
            params,
        )

    def load_item_plants(self, item_ids: Iterable[str]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for batch in chunks(item_ids):
            placeholders = ",".join(["%s"] * len(batch))
            rows.extend(
                self._query(
                    f"""
                    SELECT
                      CONVERT(varchar(36), ip.ITEM_BUSINESS_ID) AS item_plant_id,
                      CONVERT(varchar(36), ip.ITEM_ID) AS item_id,
                      CONVERT(varchar(36), ip.Owner_Org_ROid) AS owner_org_id,
                      ip.ITEM_PROPERTY AS item_property,
                      ip.ITEM_ROUTING_CONTROL AS item_routing_control,
                      CONVERT(varchar(36), ip.STANDARD_ROUTING_ID) AS standard_routing_id
                    FROM dbo.ITEM_PLANT ip
                    WHERE ip.ITEM_ID IN ({placeholders})
                    """,
                    batch,
                )
            )
        return rows

    def load_boms(self, item_ids: Iterable[str]) -> list[BomCandidate]:
        head_rows: list[dict[str, Any]] = []
        for batch in chunks(item_ids):
            placeholders = ",".join(["%s"] * len(batch))
            head_rows.extend(
                self._query(
                    f"""
                    SELECT
                      CONVERT(varchar(36), b.BOM_ID) AS bom_id,
                      CONVERT(varchar(36), b.ITEM_ID) AS item_id,
                      CONVERT(varchar(36), b.Owner_Org_ROid) AS owner_org_id,
                      b.VERSION_TIMES AS version_times,
                      b.E_CODE AS e_code,
                      b.ApproveStatus AS approve_status,
                      b.CreateDate AS created_at,
                      b.LastModifiedDate AS last_modified_at
                    FROM dbo.BOM b
                    WHERE b.ITEM_ID IN ({placeholders})
                    """,
                    batch,
                )
            )
        candidates: dict[str, BomCandidate] = {}
        for row in head_rows:
            bom_id = normalize_guid(row["bom_id"])
            item_id = normalize_guid(row["item_id"])
            if bom_id is None or item_id is None:
                continue
            candidates[bom_id] = BomCandidate(
                bom_id=bom_id,
                item_id=item_id,
                owner_org_id=normalize_guid(row["owner_org_id"]),
                version_times=normalize_text(row["version_times"]),
                e_code=normalize_text(row["e_code"]),
                approve_status=normalize_text(row["approve_status"]),
                created_at=row["created_at"],
                last_modified_at=row["last_modified_at"],
            )
        for batch in chunks(candidates):
            placeholders = ",".join(["%s"] * len(batch))
            for row in self._query(
                f"""
                SELECT
                  CONVERT(varchar(36), bd.BOM_D_ID) AS bom_detail_id,
                  CONVERT(varchar(36), bd.BOM_ID) AS bom_id,
                  bd.ApproveStatus AS approve_status,
                  bd.EFFECTIVE_DATE AS effective_date,
                  bd.EXPRITY_DATE AS expiry_date,
                  bd.CreateDate AS created_at,
                  bd.LastModifiedDate AS last_modified_at
                FROM dbo.BOM_D bd
                WHERE bd.BOM_ID IN ({placeholders})
                """,
                batch,
            ):
                bom_id = normalize_guid(row["bom_id"])
                detail_id = normalize_guid(row["bom_detail_id"])
                if bom_id in candidates and detail_id:
                    candidates[bom_id].details.append(
                        BomDetail(
                            bom_detail_id=detail_id,
                            approve_status=normalize_text(row["approve_status"]),
                            effective_date=row["effective_date"],
                            expiry_date=row["expiry_date"],
                            created_at=row["created_at"],
                            last_modified_at=row["last_modified_at"],
                        )
                    )
        return list(candidates.values())

    def load_routings(
        self, item_ids: Iterable[str], standard_routing_ids: Iterable[str]
    ) -> list[RoutingCandidate]:
        head_rows: list[dict[str, Any]] = []
        head_sql = """
            SELECT
              CONVERT(varchar(36), ir.ITEM_ROUTING_ID) AS routing_id,
              CONVERT(varchar(36), ir.ITEM_ID) AS item_id,
              CONVERT(varchar(36), ir.Owner_Org_ROid) AS owner_org_id,
              CONVERT(varchar(36), ir.ITEM_FEATURE_ID) AS item_feature_id,
              ir.ROUTING_CODE AS routing_code,
              ir.ApproveStatus AS approve_status,
              ir.CreateDate AS created_at,
              ir.LastModifiedDate AS last_modified_at
            FROM dbo.ITEM_ROUTING ir
            WHERE {condition}
        """
        for batch in chunks(item_ids):
            placeholders = ",".join(["%s"] * len(batch))
            head_rows.extend(
                self._query(
                    head_sql.format(condition=f"ir.ITEM_ID IN ({placeholders})"), batch
                )
            )
        for batch in chunks(standard_routing_ids):
            placeholders = ",".join(["%s"] * len(batch))
            head_rows.extend(
                self._query(
                    head_sql.format(
                        condition=f"ir.ITEM_ROUTING_ID IN ({placeholders})"
                    ),
                    batch,
                )
            )
        candidates: dict[str, RoutingCandidate] = {}
        for row in head_rows:
            routing_id = normalize_guid(row["routing_id"])
            item_id = normalize_guid(row["item_id"])
            if routing_id is None or item_id is None or routing_id in candidates:
                continue
            candidates[routing_id] = RoutingCandidate(
                routing_id=routing_id,
                item_id=item_id,
                owner_org_id=normalize_guid(row["owner_org_id"]),
                item_feature_id=normalize_guid(row["item_feature_id"]),
                routing_code=normalize_text(row["routing_code"]),
                approve_status=normalize_text(row["approve_status"]),
                created_at=row["created_at"],
                last_modified_at=row["last_modified_at"],
            )
        for batch in chunks(candidates):
            placeholders = ",".join(["%s"] * len(batch))
            for row in self._query(
                f"""
                SELECT
                  CONVERT(varchar(36), ird.ITEM_ROUTING_D_ID) AS routing_detail_id,
                  CONVERT(varchar(36), ird.ITEM_ROUTING_ID) AS routing_id,
                  ird.OPERATION_SEQ AS operation_seq,
                  ird.ApproveStatus AS approve_status,
                  CONVERT(varchar(36), ird.OPERATION_ID) AS operation_id,
                  CASE WHEN op.OPERATION_ID IS NULL THEN 0 ELSE 1 END AS operation_exists,
                  ird.CreateDate AS created_at,
                  ird.LastModifiedDate AS last_modified_at
                FROM dbo.ITEM_ROUTING_D ird
                LEFT JOIN dbo.OPERATION op ON op.OPERATION_ID = ird.OPERATION_ID
                WHERE ird.ITEM_ROUTING_ID IN ({placeholders})
                """,
                batch,
            ):
                routing_id = normalize_guid(row["routing_id"])
                detail_id = normalize_guid(row["routing_detail_id"])
                if routing_id in candidates and detail_id:
                    candidates[routing_id].details.append(
                        RoutingDetail(
                            routing_detail_id=detail_id,
                            approve_status=normalize_text(row["approve_status"]),
                            operation_id=normalize_guid(row["operation_id"]),
                            operation_exists=bool(row["operation_exists"]),
                            operation_seq=normalize_text(row["operation_seq"]),
                            created_at=row["created_at"],
                            last_modified_at=row["last_modified_at"],
                        )
                    )
        return list(candidates.values())


# Fixed source schema verified in Phase 3/4. Input never controls table/column SQL.
SOURCES = {
    "SALES_ORDER_DOC": ("SALES_ORDER_DOC_ID", "order"),
    "SALES_ORDER_DOC_D": ("SALES_ORDER_DOC_D_ID", "order_line"),
    "ITEM": ("ITEM_BUSINESS_ID", "item"),
    "ITEM_PLANT": ("ITEM_BUSINESS_ID", "plant"),
    "BOM": ("BOM_ID", "bom"),
    "BOM_D": ("BOM_D_ID", "bom_detail"),
    "ITEM_ROUTING": ("ITEM_ROUTING_ID", "route"),
    "ITEM_ROUTING_D": ("ITEM_ROUTING_D_ID", "route_detail"),
    "OPERATION": ("OPERATION_ID", "operation"),
    "CUSTOMER": ("CUSTOMER_BUSINESS_ID", "customer"),
    "ADMIN_UNIT": ("ADMIN_UNIT_ID", "department"),
}

def source_changes(repository, table, identity, cursor, cutoff):
    since = datetime.fromisoformat(cursor["at"]) - timedelta(minutes=2) if cursor else FORMAL_CANDIDATE_START
    last = None
    while True:
        params = [since, cutoff]
        extra = ""
        if last:
            extra = f" AND (CAST(LastModifiedDate AS datetime2(6))>%s OR (CAST(LastModifiedDate AS datetime2(6))=%s AND {identity}>CONVERT(uniqueidentifier,%s)))"
            params.extend([last["at"],last["at"],last["id"]])
        rows = repository._query(f"SELECT TOP 1000 CONVERT(varchar(36),{identity}) id,CAST(LastModifiedDate AS datetime2(6)) at FROM dbo.{table} WHERE LastModifiedDate>=%s AND LastModifiedDate<=%s {extra} ORDER BY CAST(LastModifiedDate AS datetime2(6)),{identity}",params)
        if not rows:
            break
        yield from rows
        last=rows[-1]
        if len(rows)<1000:
            break

def affected_facts(repository, changes):
    item_ids=set(); order_ids=set()
    def query_batches(ids,sql):
        for batch in chunks(ids):
            for row in repository._query(sql.format(ids=",".join(["%s"]*len(batch))),batch):
                item_ids.add(normalize_guid(row["item_id"])) if "item_id" in row else order_ids.add(normalize_guid(row["order_id"]))
    item_ids.update(changes.get("ITEM",[]))
    order_ids.update(changes.get("SALES_ORDER_DOC",[]))
    query_batches(changes.get("SALES_ORDER_DOC_D",[]),"SELECT CONVERT(varchar(36),SALES_ORDER_DOC_ID) order_id FROM dbo.SALES_ORDER_DOC_D WHERE SALES_ORDER_DOC_D_ID IN ({ids})")
    query_batches(changes.get("ITEM_PLANT",[]),"SELECT CONVERT(varchar(36),ITEM_ID) item_id FROM dbo.ITEM_PLANT WHERE ITEM_BUSINESS_ID IN ({ids})")
    query_batches(changes.get("BOM",[]),"SELECT CONVERT(varchar(36),ITEM_ID) item_id FROM dbo.BOM WHERE BOM_ID IN ({ids})")
    query_batches(changes.get("BOM_D",[]),"SELECT CONVERT(varchar(36),b.ITEM_ID) item_id FROM dbo.BOM_D d JOIN dbo.BOM b ON b.BOM_ID=d.BOM_ID WHERE d.BOM_D_ID IN ({ids})")
    route_ids=set(changes.get("ITEM_ROUTING",[]))
    for batch in chunks(changes.get("ITEM_ROUTING_D",[])):
        route_ids.update(normalize_guid(r["id"]) for r in repository._query("SELECT CONVERT(varchar(36),ITEM_ROUTING_ID) id FROM dbo.ITEM_ROUTING_D WHERE ITEM_ROUTING_D_ID IN ("+",".join(["%s"]*len(batch))+")",batch))
    for batch in chunks(changes.get("OPERATION",[])):
        route_ids.update(normalize_guid(r["id"]) for r in repository._query("SELECT DISTINCT CONVERT(varchar(36),ITEM_ROUTING_ID) id FROM dbo.ITEM_ROUTING_D WHERE OPERATION_ID IN ("+",".join(["%s"]*len(batch))+")",batch))
    query_batches(route_ids,"SELECT CONVERT(varchar(36),ITEM_ID) item_id FROM dbo.ITEM_ROUTING WHERE ITEM_ROUTING_ID IN ({ids})")
    query_batches(route_ids,"SELECT CONVERT(varchar(36),ITEM_ID) item_id FROM dbo.ITEM_PLANT WHERE STANDARD_ROUTING_ID IN ({ids})")
    query_batches(changes.get("CUSTOMER",[]),"SELECT CONVERT(varchar(36),SALES_ORDER_DOC_ID) order_id FROM dbo.SALES_ORDER_DOC WHERE CUSTOMER_ID IN ({ids})")
    query_batches(changes.get("ADMIN_UNIT",[]),"SELECT CONVERT(varchar(36),SALES_ORDER_DOC_ID) order_id FROM dbo.SALES_ORDER_DOC WHERE Owner_Dept IN ({ids})")
    return item_ids-{None},order_ids-{None}

def serialize(value):
    if isinstance(value,datetime): return value.isoformat(sep=" ",timespec="microseconds")
    if isinstance(value,Decimal): return str(value)
    if isinstance(value,(bytes,bytearray)): return value.decode("gb18030","replace")
    raise TypeError(type(value).__name__)

def advance_cursor(repository, before, candidate):
    if not candidate: return before
    if not before: return candidate
    old_at=datetime.fromisoformat(str(before["at"]))
    new_at=candidate["at"] if isinstance(candidate["at"],datetime) else datetime.fromisoformat(str(candidate["at"]))
    if new_at>old_at: return candidate
    if new_at<old_at: return before
    old_id=normalize_guid(before["id"]);new_id=normalize_guid(candidate["id"])
    if old_id==new_id: return before
    advances=repository._query("SELECT CASE WHEN CONVERT(uniqueidentifier,%s)>CONVERT(uniqueidentifier,%s) THEN 1 ELSE 0 END advances",[new_id,old_id])[0]["advances"]
    return candidate if advances else before


def read_bundle(mode, previous=None):
    with E10Repository() as repository:
        cutoff=repository._query("SELECT CAST(SYSDATETIME() AS datetime2(6)) source_time")[0]["source_time"]
        source_cursors={}; changed={}
        for table,(identity,_) in SOURCES.items():
            before=(previous or {}).get("sources",{}).get(table)
            if mode=="FULL" or not previous:
                rows=repository._query(f"SELECT TOP 1 CONVERT(varchar(36),{identity}) id,CAST(LastModifiedDate AS datetime2(6)) at FROM dbo.{table} WHERE LastModifiedDate<=%s ORDER BY CAST(LastModifiedDate AS datetime2(6)) DESC,{identity} DESC",[cutoff])
            else:
                rows=list(source_changes(repository,table,identity,before,cutoff))
                changed[table]=[normalize_guid(r["id"]) for r in rows]
            source_cursors[table]=advance_cursor(repository,before,rows[-1] if rows else None)
        # Candidate inventory also detects physical source line deletion or leaving scope.
        orders=repository.load_order_lines(candidate_scope=True)
        inventory=[normalize_guid(r["order_line_id"]) for r in orders]
        affected_items,affected_orders=affected_facts(repository,changed) if mode=="INCREMENTAL" and previous else (set(),set())
        if mode=="INCREMENTAL" and previous:
            # BOM validity can change without a source write. Collect scheduled boundaries.
            before=datetime.fromisoformat(previous["snapshotAt"])-timedelta(minutes=2)
            timed=repository._query("SELECT DISTINCT CONVERT(varchar(36),b.ITEM_ID) item_id FROM dbo.BOM_D d JOIN dbo.BOM b ON b.BOM_ID=d.BOM_ID WHERE (d.EFFECTIVE_DATE BETWEEN %s AND %s) OR (d.EXPRITY_DATE BETWEEN %s AND %s)",[before,cutoff,before,cutoff])
            affected_items.update(normalize_guid(r["item_id"]) for r in timed)
            orders=[r for r in orders if normalize_guid(r["order_id"]) in affected_orders or normalize_guid(r["item_id"]) in affected_items or normalize_text(r["customer_code"]) in previous.get("customerCodes",[])]
        item_ids=[normalize_guid(r["item_id"]) for r in orders]
        plants=repository.load_item_plants(item_ids)
        boms=repository.load_boms(item_ids)
        routes=repository.load_routings(item_ids,[normalize_guid(p["standard_routing_id"]) for p in plants])
        return {"sourceSnapshotAt":cutoff,"consistency":"READ_COMMITTED_CAPTURE","watermark":{"snapshotAt":cutoff,"sources":source_cursors},"candidateLineIds":inventory,"affectedItemIds":sorted(i for i in affected_items if i),"affectedOrderIds":sorted(affected_orders),"orders":orders,"plants":plants,"boms":[asdict(b) for b in boms],"routings":[asdict(r) for r in routes]}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--mode",choices=["FULL","INCREMENTAL"],required=True)
    args=parser.parse_args()
    previous=json.load(sys.stdin) if args.mode=="INCREMENTAL" else None
    print(json.dumps(read_bundle(args.mode,previous),ensure_ascii=False,default=serialize))

if __name__=="__main__":
    main()
