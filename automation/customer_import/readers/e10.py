from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from basic_code import MSSQLDatabase

from .common import records, snapshot_hash, text


class E10Reader:
    source = "e10"

    def __init__(self, project_root: Path, database: str | None = None):
        self.project_root = project_root
        self.database = MSSQLDatabase(database=database if database and database != "all" else None)
        self.sql_path = Path("/data/automation/code/sql/E10/sales_order.sql")

    def customers(self) -> list[str]:
        frame = self.database.get_from_query("""SELECT DISTINCT customer.CUSTOMER_CODE customer_code
          FROM dbo.SALES_ORDER_DOC orders JOIN dbo.CUSTOMER customer ON customer.CUSTOMER_BUSINESS_ID=orders.CUSTOMER_ID
          WHERE orders.ApproveStatus='Y' AND NULLIF(LTRIM(RTRIM(customer.CUSTOMER_CODE)),'') IS NOT NULL
          ORDER BY customer.CUSTOMER_CODE""")
        return sorted(str(value).strip() for value in frame["customer_code"].dropna() if str(value).strip())

    def _query(self, customer_code: str | None):
        query = self.sql_path.read_text(encoding="utf-8").replace("{{start_date}}", "").replace("{{end_date}}", "")
        if customer_code:
            safe = customer_code.replace("'", "''")
            marker = "AND (D.CUSTOMER_CODE IS NULL OR D.CUSTOMER_CODE NOT LIKE 'G%')"
            query = query.replace(marker, f"{marker}\n  AND D.CUSTOMER_CODE=N'{safe}'")
        return records(self.database.get_from_query(query))

    def snapshots(self, customer_code: str | None, replace_demo_data: bool = False) -> list[dict[str, Any]]:
        source = self._query(customer_code)
        orders: list[dict[str, Any]] = []
        for row in source:
            order_number = text(row.get("DOC_NO")) or ""
            item_number = text(row.get("ITEM_CODE")) or ""
            sequence = text(row.get("SequenceNumber")) or "1"
            orders.append({
                "sourceOrderId": order_number, "sourceDetailId": f"{order_number}|{item_number}|{sequence}",
                "orderNumber": order_number, "orderDate": row.get("ORDER_DATE") or row.get("DOC_DATE"), "voucherState": "APPROVED",
                "isCancelled": False, "headerClosed": text(row.get("CLOSE")) not in {None, "未结束", "0"}, "lineClosed": False,
                "detailVoucherState": None, "auditedAt": row.get("ORDER_DATE") or row.get("DOC_DATE"),
                "customerCode": row.get("CUSTOMER_CODE"), "customerName": row.get("CUSTOMER_CODE"), "salesperson": row.get("EMPLOYEE_NAME"),
                "itemNumber": item_number, "itemName": row.get("ITEM_DESCRIPTION"), "specification": row.get("ITEM_SPECIFICATION"),
                "quantity": row.get("BUSINESS_QTY") or 0, "baseQuantity": row.get("BUSINESS_QTY"), "unit": row.get("UNIT_NAME"),
                "taxPrice": row.get("PRICE"), "taxAmount": row.get("人民币含税价"), "headerTaxAmount": None,
                "deliveryDate": row.get("PLAN_DELIVERY_DATE"), "warehouseCode": None,
                "deliveredQuantity": row.get("DELIVER_BUSINESS_QTY"), "saleOutQuantity": row.get("DELIVER_BUSINESS_QTY"),
                "executedQuantity": row.get("DELIVER_BUSINESS_QTY"), "manufactureQuantity": None,
                "maker": row.get("USER_NAME"), "auditor": None, "memo": None,
            })
        if not orders:
            return []
        database = str(self.database.database)
        snapshot: dict[str, Any] = {
            "schemaVersion": 1, "source": self.source, "sourceDatabase": database, "sourceAccountName": "E10", "division": None,
            "scope": {"mode": "customer", "customerCode": customer_code} if customer_code else {"mode": "all"},
            "extractedAt": datetime.now(timezone.utc).isoformat(), "replaceDemoData": replace_demo_data,
            "orders": orders, "movements": [],
        }
        snapshot["idempotencyKey"] = f"CUSTOMER:E10:{database}:{customer_code or 'ALL'}:{snapshot_hash(snapshot)[:48]}"
        return [snapshot]
