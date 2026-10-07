"""Read-only E10 probe for PMC research-and-development progress.

The first report model deliberately uses only design BOM and item routing.
E10 does not contain a reliable BOM-component-to-operation relation in the
current production data, so BOM_D.OPERATION_ID and MO_ROUTING_MATERIAL are not
read or evaluated here.

Examples:
    python pmc_rd_progress_probe.py --order-no "2307-260930008"
    python pmc_rd_progress_probe.py --order-no "2307-260930008" --json
    python pmc_rd_progress_probe.py --candidate-summary --json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Sequence
from zoneinfo import ZoneInfo


BASIC_CODE_ROOT = Path(
    os.getenv("RD_BASIC_CODE_ROOT", "/data/automation/code/work/basci/basic_code")
)
ZERO_GUID = "00000000-0000-0000-0000-000000000000"
FORMAL_CANDIDATE_START = datetime(2026, 9, 1)
QUERY_BATCH_SIZE = 500
BUSINESS_TIMEZONE = ZoneInfo("Asia/Shanghai")


class ComponentStatus(str, Enum):
    NOT_APPLICABLE = "NOT_APPLICABLE"
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETE = "COMPLETE"
    ABNORMAL = "ABNORMAL"


class RdStatus(str, Enum):
    NOT_APPLICABLE = "NOT_APPLICABLE"
    NOT_STARTED = "NOT_STARTED"
    DESIGN_IN_PROGRESS = "DESIGN_IN_PROGRESS"
    WAITING_ROUTING = "WAITING_ROUTING"
    ROUTING_IN_PROGRESS = "ROUTING_IN_PROGRESS"
    COMPLETE = "COMPLETE"
    ABNORMAL = "ABNORMAL"


class OrderStatus(str, Enum):
    NOT_APPLICABLE = "NOT_APPLICABLE"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETE = "COMPLETE"
    ABNORMAL = "ABNORMAL"


COMPONENT_STATUS_ZH = {
    ComponentStatus.NOT_APPLICABLE: "不适用",
    ComponentStatus.NOT_STARTED: "未开始",
    ComponentStatus.IN_PROGRESS: "进行中",
    ComponentStatus.COMPLETE: "完成",
    ComponentStatus.ABNORMAL: "异常",
}

RD_STATUS_ZH = {
    RdStatus.NOT_APPLICABLE: "不适用",
    RdStatus.NOT_STARTED: "未开始",
    RdStatus.DESIGN_IN_PROGRESS: "设计 BOM 进行中",
    RdStatus.WAITING_ROUTING: "待工艺",
    RdStatus.ROUTING_IN_PROGRESS: "工艺设计中",
    RdStatus.COMPLETE: "研发完成",
    RdStatus.ABNORMAL: "异常",
}

ORDER_STATUS_ZH = {
    OrderStatus.NOT_APPLICABLE: "不适用",
    OrderStatus.IN_PROGRESS: "进行中",
    OrderStatus.COMPLETE: "完成",
    OrderStatus.ABNORMAL: "异常",
}


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


@dataclass(frozen=True)
class ComponentEvaluation:
    status: ComponentStatus
    reason_code: str
    reason_text: str
    selected_id: str | None = None
    valid_count: int = 0
    source: str | None = None
    debug: tuple[str, ...] = ()


@dataclass(frozen=True)
class ItemRule:
    requires_design: bool
    requires_routing: bool
    item_not_applicable: bool = False
    supported: bool = True
    reason_code: str | None = None
    reason_text: str | None = None


@dataclass(frozen=True)
class FinalEvaluation:
    status: RdStatus
    reason_code: str
    reason_text: str


def normalize_guid(value: Any) -> str | None:
    """Normalize SQL UUID values and the E10 zero GUID sentinel."""
    if value is None:
        return None
    normalized = str(value).strip().lower()
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


def max_datetime(values: Iterable[datetime | None]) -> datetime | None:
    actual = [value for value in values if value is not None]
    return max(actual) if actual else None


def business_now() -> datetime:
    """Return E10's Asia/Shanghai wall-clock time as a naive datetime."""
    return datetime.now(BUSINESS_TIMEZONE).replace(tzinfo=None)


def json_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("gb18030", "replace")
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    return value


def chunks(values: Iterable[str], size: int = QUERY_BATCH_SIZE) -> Iterable[list[str]]:
    unique = list(dict.fromkeys(value for value in values if value))
    for index in range(0, len(unique), size):
        yield unique[index : index + size]


def bom_detail_is_active(detail: BomDetail, as_of: datetime) -> bool:
    if detail.approve_status != "Y" or detail.effective_date is None:
        return False
    if detail.effective_date > as_of:
        return False
    return detail.expiry_date is None or detail.expiry_date >= as_of


def evaluate_design_bom(
    candidates: Sequence[BomCandidate], as_of: datetime
) -> ComponentEvaluation:
    debug: list[str] = []
    active_approved: list[tuple[BomCandidate, list[BomDetail]]] = []
    for candidate in sorted(candidates, key=lambda item: item.bom_id):
        active_details = [
            detail for detail in candidate.details if bom_detail_is_active(detail, as_of)
        ]
        debug.append(
            "BOM "
            f"{candidate.bom_id} / E_CODE={candidate.e_code or '-'} / "
            f"version={candidate.version_times or '-'} / "
            f"approve={candidate.approve_status or '-'} / "
            f"activeApprovedDetails={len(active_details)}"
        )
        if candidate.approve_status == "Y" and active_details:
            active_approved.append((candidate, active_details))

    if not candidates:
        return ComponentEvaluation(
            ComponentStatus.NOT_STARTED,
            "NO_BOM",
            "未建立设计 BOM",
            debug=tuple(debug),
        )
    if len(active_approved) > 1:
        return ComponentEvaluation(
            ComponentStatus.ABNORMAL,
            "MULTIPLE_ACTIVE_BOMS",
            "发现多个同时有效且已审核的 BOM，无法确定当前使用版本",
            debug=tuple(debug),
        )
    if len(active_approved) == 1:
        selected, details = active_approved[0]
        return ComponentEvaluation(
            ComponentStatus.COMPLETE,
            "DESIGN_BOM_COMPLETE",
            "设计 BOM 已审核且存在当前有效明细",
            selected_id=selected.bom_id,
            valid_count=len(details),
            debug=tuple(debug + [f"selected BOM {selected.bom_id}"]),
        )

    approved = [candidate for candidate in candidates if candidate.approve_status == "Y"]
    if not approved:
        selected = candidates[0] if len(candidates) == 1 else None
        return ComponentEvaluation(
            ComponentStatus.IN_PROGRESS,
            "BOM_NOT_APPROVED",
            "存在 BOM，但尚未审核",
            selected_id=selected.bom_id if selected else None,
            debug=tuple(debug),
        )

    selected = approved[0] if len(approved) == 1 else None
    has_approved_detail = any(
        detail.approve_status == "Y"
        for candidate in approved
        for detail in candidate.details
    )
    if has_approved_detail:
        reason_code = "NO_EFFECTIVE_BOM_DETAIL"
        reason_text = "BOM 已审核，但没有当前有效的已审核 BOM 明细"
    else:
        reason_code = "BOM_NO_APPROVED_DETAILS"
        reason_text = "BOM 已审核，但没有已审核 BOM 明细"
    return ComponentEvaluation(
        ComponentStatus.IN_PROGRESS,
        reason_code,
        reason_text,
        selected_id=selected.bom_id if selected else None,
        debug=tuple(debug),
    )


def evaluate_routing_candidate(
    candidate: RoutingCandidate, source: str, debug_prefix: Sequence[str] = ()
) -> ComponentEvaluation:
    approved_details = [
        detail for detail in candidate.details if detail.approve_status == "Y"
    ]
    invalid_details = [
        detail
        for detail in approved_details
        if detail.operation_id is None or not detail.operation_exists
    ]
    debug = list(debug_prefix)
    debug.append(
        "Routing "
        f"{candidate.routing_id} / code={candidate.routing_code or '-'} / "
        f"approve={candidate.approve_status or '-'} / "
        f"approvedOperations={len(approved_details)} / "
        f"invalidOperationRefs={len(invalid_details)}"
    )
    if candidate.approve_status != "Y":
        return ComponentEvaluation(
            ComponentStatus.IN_PROGRESS,
            "ROUTING_NOT_APPROVED",
            "工艺路线尚未审核",
            selected_id=candidate.routing_id,
            source=source,
            debug=tuple(debug),
        )
    if not approved_details:
        return ComponentEvaluation(
            ComponentStatus.IN_PROGRESS,
            "ROUTING_NO_APPROVED_OPERATIONS",
            "工艺路线已审核，但没有已审核工序",
            selected_id=candidate.routing_id,
            source=source,
            debug=tuple(debug),
        )
    if invalid_details:
        return ComponentEvaluation(
            ComponentStatus.IN_PROGRESS,
            "INVALID_OPERATION_REFERENCE",
            "工艺路线包含无法匹配工序主档的已审核工序",
            selected_id=candidate.routing_id,
            valid_count=len(approved_details) - len(invalid_details),
            source=source,
            debug=tuple(debug),
        )
    return ComponentEvaluation(
        ComponentStatus.COMPLETE,
        "ROUTING_COMPLETE",
        "工艺路线已审核且工序引用有效",
        selected_id=candidate.routing_id,
        valid_count=len(approved_details),
        source=source,
        debug=tuple(debug + [f"selected Routing {candidate.routing_id}"]),
    )


def evaluate_routing(
    routing_control: str | None,
    standard_routing_id: str | None,
    candidates: Sequence[RoutingCandidate],
    routes_by_id: dict[str, RoutingCandidate],
) -> ComponentEvaluation:
    control = normalize_text(routing_control)
    if control == "0":
        return ComponentEvaluation(
            ComponentStatus.NOT_APPLICABLE,
            "ROUTING_NOT_APPLICABLE",
            "该品项未启用工艺路线控制",
        )
    if control == "2":
        return ComponentEvaluation(
            ComponentStatus.ABNORMAL,
            "UNSUPPORTED_FEATURE_ROUTING",
            "特征码路线控制当前缺少已验证生产样本",
            debug=("ITEM_ROUTING_CONTROL=2",),
        )
    if control != "1":
        return ComponentEvaluation(
            ComponentStatus.ABNORMAL,
            "UNSUPPORTED_ROUTING_CONTROL",
            f"无法识别工艺路线控制值：{control or '空'}",
        )

    if standard_routing_id:
        debug = [f"STANDARD_ROUTING_ID={standard_routing_id}"]
        candidate = routes_by_id.get(standard_routing_id)
        if candidate is None:
            return ComponentEvaluation(
                ComponentStatus.ABNORMAL,
                "STANDARD_ROUTING_NOT_FOUND",
                "STANDARD_ROUTING_ID 指向的工艺路线不存在",
                source="STANDARD_ROUTING_REFERENCE",
                debug=tuple(debug),
            )
        return evaluate_routing_candidate(
            candidate, "STANDARD_ROUTING_REFERENCE", debug
        )

    debug = [f"applicableRoutingCandidates={len(candidates)}"]
    if not candidates:
        return ComponentEvaluation(
            ComponentStatus.NOT_STARTED,
            "NO_ROUTING",
            "尚未建立有效工艺路线",
            source="ITEM_PLANT_MATCH",
            debug=tuple(debug),
        )
    approved = [candidate for candidate in candidates if candidate.approve_status == "Y"]
    if len(approved) > 1:
        return ComponentEvaluation(
            ComponentStatus.ABNORMAL,
            "MULTIPLE_ACTIVE_ROUTINGS",
            "发现多条已审核工艺路线且没有标准路线引用，无法安全选择",
            source="ITEM_PLANT_MATCH",
            debug=tuple(
                debug
                + [
                    f"approved Routing {item.routing_id} / {item.routing_code or '-'}"
                    for item in approved
                ]
            ),
        )
    if len(approved) == 1:
        return evaluate_routing_candidate(
            approved[0], "ITEM_PLANT_MATCH", debug
        )

    selected = candidates[0] if len(candidates) == 1 else None
    return ComponentEvaluation(
        ComponentStatus.IN_PROGRESS,
        "ROUTING_NOT_APPROVED",
        "存在工艺路线，但尚未审核",
        selected_id=selected.routing_id if selected else None,
        source="ITEM_PLANT_MATCH",
        debug=tuple(debug),
    )


def determine_item_rule(
    item_property: str | None, routing_control: str | None
) -> ItemRule:
    property_code = normalize_text(item_property)
    control = normalize_text(routing_control)
    if property_code == "P" and control == "0":
        return ItemRule(False, False, item_not_applicable=True)
    if property_code == "M" and control in {"1", "2"}:
        return ItemRule(True, True)
    return ItemRule(
        False,
        False,
        supported=False,
        reason_code="UNSUPPORTED_ITEM_RULE_COMBINATION",
        reason_text=(
            "物料属性与工艺路线控制组合尚未经过业务验证："
            f"ITEM_PROPERTY={property_code or '空'}, "
            f"ITEM_ROUTING_CONTROL={control or '空'}"
        ),
    )


def calculate_rd_status(
    rule: ItemRule,
    design: ComponentEvaluation,
    routing: ComponentEvaluation,
) -> FinalEvaluation:
    if rule.item_not_applicable:
        return FinalEvaluation(
            RdStatus.NOT_APPLICABLE,
            "PURCHASE_ITEM_WITHOUT_ROUTING",
            "采购件且未启用工艺路线，研发不适用",
        )
    if not rule.supported:
        return FinalEvaluation(
            RdStatus.ABNORMAL,
            rule.reason_code or "UNSUPPORTED_ITEM_RULE_COMBINATION",
            rule.reason_text or "物料规则组合尚未经过业务验证",
        )
    if design.status == ComponentStatus.ABNORMAL:
        return FinalEvaluation(RdStatus.ABNORMAL, design.reason_code, design.reason_text)
    if routing.status == ComponentStatus.ABNORMAL:
        return FinalEvaluation(RdStatus.ABNORMAL, routing.reason_code, routing.reason_text)
    if design.status == ComponentStatus.NOT_STARTED:
        return FinalEvaluation(RdStatus.NOT_STARTED, design.reason_code, design.reason_text)
    if design.status == ComponentStatus.IN_PROGRESS:
        return FinalEvaluation(
            RdStatus.DESIGN_IN_PROGRESS, design.reason_code, design.reason_text
        )
    if design.status != ComponentStatus.COMPLETE:
        return FinalEvaluation(
            RdStatus.ABNORMAL,
            "UNEXPECTED_DESIGN_STATUS",
            f"无法处理设计 BOM 状态：{design.status.value}",
        )

    if routing.status == ComponentStatus.NOT_STARTED:
        return FinalEvaluation(RdStatus.WAITING_ROUTING, routing.reason_code, routing.reason_text)
    if routing.status == ComponentStatus.IN_PROGRESS:
        return FinalEvaluation(
            RdStatus.ROUTING_IN_PROGRESS, routing.reason_code, routing.reason_text
        )
    if routing.status in {ComponentStatus.COMPLETE, ComponentStatus.NOT_APPLICABLE}:
        return FinalEvaluation(
            RdStatus.COMPLETE,
            "RD_COMPLETE",
            "设计 BOM 和所需工艺路线均已完成",
        )
    return FinalEvaluation(
        RdStatus.ABNORMAL,
        "UNEXPECTED_ROUTING_STATUS",
        f"无法处理工艺路线状态：{routing.status.value}",
    )


def summarize_order(item_results: Sequence[dict[str, Any]]) -> dict[str, Any]:
    counts = Counter(item["rdStatus"] for item in item_results)
    required = [
        item for item in item_results if item["rdStatus"] != RdStatus.NOT_APPLICABLE.value
    ]
    completed = sum(item["rdStatus"] == RdStatus.COMPLETE.value for item in required)
    if item_results and not required:
        order_status = OrderStatus.NOT_APPLICABLE
    elif any(item["rdStatus"] == RdStatus.ABNORMAL.value for item in item_results):
        order_status = OrderStatus.ABNORMAL
    elif required and completed == len(required):
        order_status = OrderStatus.COMPLETE
    else:
        order_status = OrderStatus.IN_PROGRESS
    return {
        "orderStatus": order_status.value,
        "orderStatusLabel": ORDER_STATUS_ZH[order_status],
        "itemCount": len(item_results),
        "requiredItemCount": len(required),
        "completedItemCount": completed,
        "incompleteItemCount": len(required) - completed,
        "notApplicableItemCount": counts[RdStatus.NOT_APPLICABLE.value],
        "abnormalItemCount": counts[RdStatus.ABNORMAL.value],
        "completionRate": (
            f"{completed * 100 / len(required):.2f}%" if required else None
        ),
        "statusCounts": dict(sorted(counts.items())),
    }


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


def component_not_applicable(reason: str) -> ComponentEvaluation:
    return ComponentEvaluation(
        ComponentStatus.NOT_APPLICABLE, "NOT_APPLICABLE", reason
    )


def component_abnormal(code: str, text: str) -> ComponentEvaluation:
    return ComponentEvaluation(ComponentStatus.ABNORMAL, code, text)


def rd_last_modified_at(
    boms: Sequence[BomCandidate], routes: Sequence[RoutingCandidate]
) -> datetime | None:
    timestamps: list[datetime | None] = []
    for bom in boms:
        timestamps.extend((bom.created_at, bom.last_modified_at))
        for detail in bom.details:
            timestamps.extend((detail.created_at, detail.last_modified_at))
    for route in routes:
        timestamps.extend((route.created_at, route.last_modified_at))
        for detail in route.details:
            timestamps.extend((detail.created_at, detail.last_modified_at))
    return max_datetime(timestamps)


def calculate_results(
    order_rows: Sequence[dict[str, Any]],
    plant_rows: Sequence[dict[str, Any]],
    boms: Sequence[BomCandidate],
    routings: Sequence[RoutingCandidate],
    as_of: datetime,
    include_debug: bool = False,
) -> list[dict[str, Any]]:
    plants_by_item: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in plant_rows:
        item_id = normalize_guid(row["item_id"])
        if item_id:
            plants_by_item[item_id].append(row)
    boms_by_item: dict[str, list[BomCandidate]] = defaultdict(list)
    for bom in boms:
        boms_by_item[bom.item_id].append(bom)
    routes_by_item: dict[str, list[RoutingCandidate]] = defaultdict(list)
    routes_by_id = {routing.routing_id: routing for routing in routings}
    for routing in routings:
        routes_by_item[routing.item_id].append(routing)

    results: list[dict[str, Any]] = []
    for row in order_rows:
        item_id = normalize_guid(row["item_id"])
        feature_id = normalize_guid(row["item_feature_id"])
        item_plants = plants_by_item.get(item_id or "", [])
        if row["item_code"] is None:
            design = component_abnormal("MISSING_ITEM", "订单品项引用的 ITEM 不存在")
            routing = component_abnormal("MISSING_ITEM", "订单品项引用的 ITEM 不存在")
            final = FinalEvaluation(RdStatus.ABNORMAL, design.reason_code, design.reason_text)
            plant = None
            scoped_boms: list[BomCandidate] = []
            scoped_routes: list[RoutingCandidate] = []
            rule_debug = ["ITEM master not found"]
        elif not item_plants:
            design = component_abnormal("MISSING_ITEM_PLANT", "未找到品项对应的 ITEM_PLANT")
            routing = component_abnormal("MISSING_ITEM_PLANT", "未找到品项对应的 ITEM_PLANT")
            final = FinalEvaluation(RdStatus.ABNORMAL, design.reason_code, design.reason_text)
            plant = None
            scoped_boms = []
            scoped_routes = []
            rule_debug = ["ITEM_PLANT rows=0"]
        elif len(item_plants) > 1:
            design = component_abnormal(
                "MULTIPLE_ITEM_PLANT_ROWS", "同一品项存在多条 ITEM_PLANT，无法确定适用工厂"
            )
            routing = component_abnormal(
                "MULTIPLE_ITEM_PLANT_ROWS", "同一品项存在多条 ITEM_PLANT，无法确定适用工厂"
            )
            final = FinalEvaluation(RdStatus.ABNORMAL, design.reason_code, design.reason_text)
            plant = None
            scoped_boms = []
            scoped_routes = []
            rule_debug = [f"ITEM_PLANT rows={len(item_plants)}"]
        else:
            plant = item_plants[0]
            plant_id = normalize_guid(plant["owner_org_id"])
            standard_routing_id = normalize_guid(plant["standard_routing_id"])
            scoped_boms = [
                bom
                for bom in boms_by_item.get(item_id or "", [])
                if bom.owner_org_id == plant_id
            ]
            if standard_routing_id:
                scoped_routes = [
                    route
                    for route in [routes_by_id.get(standard_routing_id)]
                    if route is not None
                ]
            else:
                scoped_routes = [
                    route
                    for route in routes_by_item.get(item_id or "", [])
                    if route.owner_org_id == plant_id
                    and route.item_feature_id == feature_id
                ]
            rule = determine_item_rule(
                normalize_text(plant["item_property"]),
                normalize_text(plant["item_routing_control"]),
            )
            rule_debug = [
                f"ITEM_PROPERTY={normalize_text(plant['item_property']) or '-'}",
                f"ITEM_ROUTING_CONTROL={normalize_text(plant['item_routing_control']) or '-'}",
            ]
            if rule.item_not_applicable:
                design = component_not_applicable("采购件不需要设计 BOM")
                routing = component_not_applicable("采购件未启用工艺路线")
            elif not rule.supported:
                design = component_abnormal(
                    rule.reason_code or "UNSUPPORTED_ITEM_RULE_COMBINATION",
                    rule.reason_text or "物料规则组合尚未验证",
                )
                routing = design
            else:
                design = evaluate_design_bom(scoped_boms, as_of)
                routing = evaluate_routing(
                    normalize_text(plant["item_routing_control"]),
                    standard_routing_id,
                    scoped_routes,
                    routes_by_id,
                )
            final = calculate_rd_status(rule, design, routing)

        selected_bom = next(
            (bom for bom in scoped_boms if bom.bom_id == design.selected_id), None
        )
        selected_route = next(
            (route for route in scoped_routes if route.routing_id == routing.selected_id),
            routes_by_id.get(routing.selected_id or ""),
        )
        result: dict[str, Any] = {
            "orderId": normalize_guid(row["order_id"]),
            "orderNo": normalize_text(row["order_no"]),
            "orderLineId": normalize_guid(row["order_line_id"]),
            "lineNumber": row["line_number"],
            "customerId": normalize_guid(row["customer_id"]),
            "customerCode": normalize_text(row["customer_code"]),
            "customer": normalize_text(row["customer_name"]),
            "orderDate": row["order_date"],
            "orderCreatedAt": row["order_created_at"],
            "orderLastModifiedAt": row["order_last_modified_at"],
            "itemId": item_id,
            "itemCode": normalize_text(row["item_code"]),
            "itemName": normalize_text(row["item_name"]),
            "itemSpecification": normalize_text(row["item_specification"]),
            "itemFeatureId": feature_id,
            "quantity": row["quantity"],
            "itemProperty": normalize_text(plant["item_property"]) if plant else None,
            "itemRoutingControl": (
                normalize_text(plant["item_routing_control"]) if plant else None
            ),
            "standardRoutingId": (
                normalize_guid(plant["standard_routing_id"]) if plant else None
            ),
            "designBomStatus": design.status.value,
            "designBomStatusLabel": COMPONENT_STATUS_ZH[design.status],
            "bomId": selected_bom.bom_id if selected_bom else None,
            "bomVersion": selected_bom.version_times if selected_bom else None,
            "bomECode": selected_bom.e_code if selected_bom else None,
            "bomApproveStatus": selected_bom.approve_status if selected_bom else None,
            "validBomDetailCount": design.valid_count,
            "routingStatus": routing.status.value,
            "routingStatusLabel": COMPONENT_STATUS_ZH[routing.status],
            "itemRoutingId": selected_route.routing_id if selected_route else None,
            "routingCode": selected_route.routing_code if selected_route else None,
            "routingApproveStatus": (
                selected_route.approve_status if selected_route else None
            ),
            "validOperationCount": routing.valid_count,
            "routingSource": routing.source,
            "rdStatus": final.status.value,
            "rdStatusLabel": RD_STATUS_ZH[final.status],
            "reasonCode": final.reason_code,
            "reasonText": final.reason_text,
            "rdLastModifiedAt": rd_last_modified_at(scoped_boms, scoped_routes),
        }
        if include_debug:
            result["debug"] = {
                "itemRule": rule_debug,
                "bomCandidates": list(design.debug),
                "routingCandidates": list(routing.debug),
                "decision": (
                    f"Design={design.status.value}, Routing={routing.status.value} "
                    f"-> {final.status.value}"
                ),
            }
        results.append(result)
    return results


def load_and_calculate(
    repository: E10Repository,
    *,
    order_no: str | None,
    candidate_scope: bool,
    as_of: datetime,
    include_debug: bool,
) -> list[dict[str, Any]]:
    order_rows = repository.load_order_lines(order_no, candidate_scope)
    if order_no and not order_rows:
        raise ValueError(f"未找到销售订单：{order_no}")
    item_ids = [
        item_id
        for row in order_rows
        if (item_id := normalize_guid(row["item_id"])) is not None
    ]
    plants = repository.load_item_plants(item_ids)
    standard_ids = [
        routing_id
        for row in plants
        if (routing_id := normalize_guid(row["standard_routing_id"])) is not None
    ]
    boms = repository.load_boms(item_ids)
    routings = repository.load_routings(item_ids, standard_ids)
    return calculate_results(
        order_rows, plants, boms, routings, as_of, include_debug=include_debug
    )


def group_orders(item_results: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in item_results:
        grouped[item["orderId"] or item["orderNo"]].append(item)
    orders: list[dict[str, Any]] = []
    for items in grouped.values():
        first = items[0]
        orders.append(
            {
                "orderId": first["orderId"],
                "orderNo": first["orderNo"],
                "customerId": first["customerId"],
                "customerCode": first["customerCode"],
                "customer": first["customer"],
                "orderDate": first["orderDate"],
                "orderCreatedAt": first["orderCreatedAt"],
                "orderLastModifiedAt": first["orderLastModifiedAt"],
                "items": items,
                "summary": summarize_order(items),
            }
        )
    return sorted(orders, key=lambda order: order["orderNo"] or "")


def candidate_summary(
    item_results: Sequence[dict[str, Any]], sample_per_status: int
) -> dict[str, Any]:
    status_counts = Counter(item["rdStatus"] for item in item_results)
    item_status_counts = {
        status.value: status_counts[status.value] for status in RdStatus
    }
    grouped_items: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in item_results:
        grouped_items[item["orderId"] or item["orderNo"]].append(item)
    order_counter = Counter(
        summarize_order(items)["orderStatus"] for items in grouped_items.values()
    )
    order_status_counts = {
        status.value: order_counter[status.value] for status in OrderStatus
    }
    abnormal_counts = Counter(
        item["reasonCode"]
        for item in item_results
        if item["rdStatus"] == RdStatus.ABNORMAL.value
    )
    order_ids = {item["orderId"] for item in item_results}
    samples: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in item_results:
        bucket = samples[item["rdStatus"]]
        if len(bucket) < sample_per_status:
            bucket.append(
                {
                    "orderNo": item["orderNo"],
                    "lineNumber": item["lineNumber"],
                    "orderLineId": item["orderLineId"],
                    "itemCode": item["itemCode"],
                    "itemProperty": item["itemProperty"],
                    "itemRoutingControl": item["itemRoutingControl"],
                    "rdStatus": item["rdStatus"],
                    "reasonCode": item["reasonCode"],
                    "reasonText": item["reasonText"],
                }
            )
    return {
        "formalCandidateStart": FORMAL_CANDIDATE_START,
        "orderCount": len(order_ids),
        "itemCount": len(item_results),
        "statusCounts": item_status_counts,
        "orderStatusCounts": order_status_counts,
        "abnormalReasonCounts": dict(sorted(abnormal_counts.items())),
        "samplesByStatus": dict(sorted(samples.items())),
    }


def display(value: Any) -> str:
    converted = json_value(value)
    return "-" if converted is None or converted == "" else str(converted)


def print_order_report(orders: Sequence[dict[str, Any]], include_debug: bool) -> None:
    for order in orders:
        print(f"订单：{display(order['orderNo'])}")
        print(
            f"客户：{display(order['customerCode'])} "
            f"{display(order['customer'])}"
        )
        print(
            f"下单日期：{display(order['orderDate'])}  "
            f"创建：{display(order['orderCreatedAt'])}  "
            f"最后修改：{display(order['orderLastModifiedAt'])}"
        )
        print("-" * 100)
        print("行  品号                         设计BOM      工艺路线      研发状态             原因")
        print("-" * 100)
        for item in order["items"]:
            print(
                f"{str(item['lineNumber']):<3} "
                f"{display(item['itemCode']):<28} "
                f"{item['designBomStatusLabel']:<12} "
                f"{item['routingStatusLabel']:<12} "
                f"{item['rdStatusLabel']:<20} "
                f"{item['reasonText']}"
            )
        print("-" * 100)
        summary = order["summary"]
        print(
            "订单研发统计："
            f"品项 {summary['itemCount']}，需要研发 {summary['requiredItemCount']}，"
            f"完成 {summary['completedItemCount']}，未完成 {summary['incompleteItemCount']}，"
            f"不适用 {summary['notApplicableItemCount']}，异常 {summary['abnormalItemCount']}，"
            f"完成率 {display(summary['completionRate'])}，"
            f"订单状态 {summary['orderStatusLabel']}"
        )
        for item in order["items"]:
            print()
            print(f"[订单行 {item['lineNumber']}] {display(item['itemCode'])}")
            detail_fields = (
                ("订单行ID", "orderLineId"),
                ("品名", "itemName"),
                ("规格", "itemSpecification"),
                ("特征码", "itemFeatureId"),
                ("数量", "quantity"),
                ("ITEM_PROPERTY", "itemProperty"),
                ("ITEM_ROUTING_CONTROL", "itemRoutingControl"),
                ("STANDARD_ROUTING_ID", "standardRoutingId"),
                ("设计BOM状态", "designBomStatus"),
                ("BOM_ID", "bomId"),
                ("BOM版本", "bomVersion"),
                ("BOM E_CODE", "bomECode"),
                ("BOM审核状态", "bomApproveStatus"),
                ("有效BOM明细数", "validBomDetailCount"),
                ("工艺路线状态", "routingStatus"),
                ("ITEM_ROUTING_ID", "itemRoutingId"),
                ("ROUTING_CODE", "routingCode"),
                ("工艺路线审核状态", "routingApproveStatus"),
                ("有效工序数", "validOperationCount"),
                ("routingSource", "routingSource"),
                ("最终研发状态", "rdStatus"),
                ("reasonCode", "reasonCode"),
                ("状态原因", "reasonText"),
                ("最后研发更新时间", "rdLastModifiedAt"),
            )
            for label, key in detail_fields:
                print(f"  {label}：{display(item[key])}")
            if include_debug:
                print("  调试路径：")
                for line in item.get("debug", {}).get("itemRule", []):
                    print(f"    - {line}")
                print("    BOM candidates:")
                for line in item.get("debug", {}).get("bomCandidates", []):
                    print(f"      - {line}")
                print("    Routing candidates:")
                for line in item.get("debug", {}).get("routingCandidates", []):
                    print(f"      - {line}")
                print(f"    RD: {item.get('debug', {}).get('decision', '-')}")
        print()


def print_candidate_summary(summary: dict[str, Any]) -> None:
    print(f"正式候选起点：{display(summary['formalCandidateStart'])}")
    print(f"订单数：{summary['orderCount']}")
    print(f"订单品项数：{summary['itemCount']}")
    print("研发状态数量：")
    for status, count in summary["statusCounts"].items():
        print(f"  {status}: {count}")
    print("订单状态数量：")
    for status, count in summary["orderStatusCounts"].items():
        print(f"  {status}: {count}")
    print("异常原因数量：")
    if not summary["abnormalReasonCounts"]:
        print("  无")
    for code, count in summary["abnormalReasonCounts"].items():
        print(f"  {code}: {count}")
    print("真实样本：")
    for status, samples in summary["samplesByStatus"].items():
        print(f"  [{status}]")
        for sample in samples:
            print(
                f"    {sample['orderNo']} / 行{sample['lineNumber']} / "
                f"{sample['itemCode']} / {sample['reasonCode']}"
            )


def parse_as_of(raw: str | None) -> datetime:
    if raw is None:
        return business_now()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("--as-of 必须是 ISO 日期时间，例如 2026-10-06T12:00:00") from error
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(BUSINESS_TIMEZONE).replace(tzinfo=None)
    return parsed


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="E10 PMC研发进度只读验证工具")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--order-no", help="直接验证一个 E10 销售订单号，不受正式日期范围限制")
    scope.add_argument(
        "--candidate-summary",
        action="store_true",
        help="统计 CreateDate/LastModifiedDate 自 2026-09-01 起的正式候选范围",
    )
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    parser.add_argument("--debug", action="store_true", help="输出候选选择和判断路径")
    parser.add_argument("--as-of", help="指定 BOM 有效期判断时点（ISO datetime）")
    parser.add_argument(
        "--sample-per-status",
        type=int,
        default=2,
        help="全量统计时每种状态输出的真实样本数，默认 2",
    )
    args = parser.parse_args(argv)
    if not 1 <= args.sample_per_status <= 20:
        parser.error("--sample-per-status 必须在 1 到 20 之间")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    as_of = parse_as_of(args.as_of)
    with E10Repository() as repository:
        results = load_and_calculate(
            repository,
            order_no=args.order_no,
            candidate_scope=args.candidate_summary,
            as_of=as_of,
            include_debug=args.debug,
        )
    if args.candidate_summary:
        report: dict[str, Any] = {
            "generatedAt": business_now(),
            "asOf": as_of,
            "scope": "FORMAL_CANDIDATE_RANGE",
            "summary": candidate_summary(results, args.sample_per_status),
        }
        if args.json:
            print(json.dumps(json_value(report), ensure_ascii=False, indent=2))
        else:
            print_candidate_summary(report["summary"])
        return 0

    orders = group_orders(results)
    report = {
        "generatedAt": business_now(),
        "asOf": as_of,
        "scope": "ORDER_NO",
        "formalCandidateStart": FORMAL_CANDIDATE_START,
        "orders": orders,
    }
    if args.json:
        print(json.dumps(json_value(report), ensure_ascii=False, indent=2))
    else:
        print_order_report(orders, args.debug)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        raise SystemExit(0) from None
    except Exception as error:  # CLI boundary: keep the actionable reason visible.
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
