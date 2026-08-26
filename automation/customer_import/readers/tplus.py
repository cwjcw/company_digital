from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
from typing import Any

from basic_code import MSSQLDatabase
from dotenv import load_dotenv

from .common import flag, records, snapshot_hash, text


TPLUS_ACCOUNTS = {
    "UFTData741219_000012": {"name": "凯南智能", "division": "事业三部"},
    "UFTData418971_000003": {"name": "科加智能", "division": "事业四部"},
}


class TplusReader:
    source = "tplus"

    def __init__(self, project_root: Path, database: str | None = None):
        load_dotenv(project_root / ".env", override=False)
        self.settings = {
            "server": os.environ["TPLUS_SQL_HOST"], "port": os.environ["TPLUS_SQL_PORT"],
            "user": os.environ["TPLUS_SQL_USER"], "password": os.environ["TPLUS_SQL_PASSWORD"],
        }
        if database and database != "all":
            if database not in TPLUS_ACCOUNTS:
                raise ValueError(f"不支持的 T+ 账套：{database}")
            self.databases = [database]
        else:
            self.databases = list(TPLUS_ACCOUNTS)

    def _database(self, name: str) -> MSSQLDatabase:
        return MSSQLDatabase(database=name, **self.settings)

    @staticmethod
    def _customer_filter(customer_code: str | None, alias: str = "customer") -> str:
        if not customer_code:
            return ""
        safe = customer_code.replace("'", "''")
        return f" AND {alias}.code=N'{safe}'"

    def customers(self) -> list[str]:
        found: set[str] = set()
        for database in self.databases:
            query = """SELECT DISTINCT customer.code customer_code
              FROM dbo.SA_SaleOrder h JOIN dbo.AA_PartnerEntity customer ON customer.id=h.idcustomer
              WHERE NULLIF(LTRIM(RTRIM(customer.code)),N'') IS NOT NULL ORDER BY customer.code"""
            frame = self._database(database).get_from_query(query)
            found.update(str(value).strip() for value in frame["customer_code"].dropna() if str(value).strip())
        return sorted(found)

    def _orders(self, database: str, customer_code: str | None):
        query = f"""
SELECT CONVERT(nvarchar(100),h.ID) sourceOrderId,CONVERT(nvarchar(100),d.id) sourceDetailId,
 h.code orderNumber,CONVERT(date,h.voucherdate) orderDate,h.voucherState,
 CASE WHEN ISNULL(h.isCancel,0)<>0 THEN 1 ELSE 0 END isCancelled,
 CASE WHEN h.CloseDate IS NOT NULL OR NULLIF(LTRIM(RTRIM(h.Closer)),N'') IS NOT NULL THEN 1 ELSE 0 END headerClosed,
 CASE WHEN ISNULL(d.IsClose,0)<>0 OR ISNULL(d.IsCCClose,0)<>0 THEN 1 ELSE 0 END lineClosed,
 d.detailVoucherState,CONVERT(nvarchar(30),h.auditeddate,126) auditedAt,
 customer.code customerCode,customer.name customerName,clerk.name salesperson,
 inv.code itemNumber,inv.name itemName,inv.specification,d.quantity,d.baseQuantity,unit1.name unit,
 d.taxPrice,d.taxAmount,h.taxAmount headerTaxAmount,CONVERT(date,d.deliveryDate) deliveryDate,wh.code warehouseCode,
 d.deliveryQuantity deliveredQuantity,d.saleOutQuantity,d.executedQuantity,d.manufactureQuantity,h.maker,h.auditor,h.memo
FROM dbo.SA_SaleOrder h
JOIN dbo.SA_SaleOrder_b d ON d.idSaleOrderDTO=h.ID
LEFT JOIN dbo.AA_PartnerEntity customer ON customer.id=h.idcustomer
LEFT JOIN dbo.AA_Person clerk ON clerk.id=h.idclerk
LEFT JOIN dbo.AA_InventoryEntity inv ON inv.id=d.idinventory
LEFT JOIN dbo.AA_Unit unit1 ON unit1.id=d.idunit
LEFT JOIN dbo.AA_Warehouse wh ON wh.id=COALESCE(d.idwarehouse,h.idwarehouse)
WHERE 1=1 {self._customer_filter(customer_code)}
ORDER BY h.voucherdate,h.code,d.id
"""
        return records(self._database(database).get_from_query(query))

    def _movements(self, database: str, customer_code: str | None):
        query = f"""
SELECT CONVERT(nvarchar(100),h.id) sourceDocumentId,CONVERT(nvarchar(100),d.ID) sourceDetailId,
 h.code documentNumber,CONVERT(date,h.voucherdate) documentDate,h.voucherState,
 CASE WHEN h.rdDirectionFlag=1 THEN N'INBOUND' ELSE N'OUTBOUND' END direction,
 CONVERT(int,h.rdDirectionFlag) directionValue,CONVERT(nvarchar(100),h.idvouchertype) voucherType,
 CONVERT(nvarchar(100),h.idbusitype) businessType,partner.code partnerCode,partner.name partnerName,
 inv.code itemNumber,inv.name itemName,inv.specification,d.quantity,d.baseQuantity,unit1.name unit,d.price unitPrice,d.amount,
 wh.code warehouseCode,wh.name warehouseName,d.batch,d.saleOrderCode salesOrderNumber,
 CONVERT(nvarchar(100),d.saleOrderDetailId) salesOrderDetailId,d.sourceVoucherCode sourceDocumentNumber,
 CONVERT(nvarchar(100),d.sourceVoucherId) sourceDocumentIdRef,CONVERT(nvarchar(100),d.sourceVoucherDetailId) sourceDetailIdRef,
 h.maker,h.auditor,h.memo
FROM dbo.SA_SaleOrder so
JOIN dbo.AA_PartnerEntity customer ON customer.id=so.idcustomer
JOIN dbo.SA_SaleOrder_b sod ON sod.idSaleOrderDTO=so.ID
JOIN dbo.ST_RDRecord_b d ON d.saleOrderDetailId=sod.id
JOIN dbo.ST_RDRecord h ON h.id=d.idRDRecordDTO
LEFT JOIN dbo.AA_PartnerEntity partner ON partner.id=h.idpartner
LEFT JOIN dbo.AA_InventoryEntity inv ON inv.id=d.idinventory
LEFT JOIN dbo.AA_Unit unit1 ON unit1.id=d.idunit
LEFT JOIN dbo.AA_Warehouse wh ON wh.id=COALESCE(d.idwarehouse,h.idwarehouse)
WHERE h.rdDirectionFlag IN (0,1) {self._customer_filter(customer_code)}
ORDER BY h.voucherdate,h.code,d.ID
"""
        return records(self._database(database).get_from_query(query))

    def snapshots(self, customer_code: str | None, replace_demo_data: bool = False) -> list[dict[str, Any]]:
        snapshots: list[dict[str, Any]] = []
        for database in self.databases:
            orders = self._orders(database, customer_code)
            if not orders:
                continue
            for row in orders:
                row["isCancelled"] = flag(row.get("isCancelled")); row["headerClosed"] = flag(row.get("headerClosed")); row["lineClosed"] = flag(row.get("lineClosed"))
            movements = self._movements(database, customer_code)
            account = TPLUS_ACCOUNTS[database]
            snapshot: dict[str, Any] = {
                "schemaVersion": 1, "source": self.source, "sourceDatabase": database,
                "sourceAccountName": account["name"], "division": account["division"],
                "scope": {"mode": "customer", "customerCode": customer_code} if customer_code else {"mode": "all"},
                "extractedAt": datetime.now(timezone.utc).isoformat(), "replaceDemoData": replace_demo_data,
                "orders": orders, "movements": movements,
            }
            snapshot["idempotencyKey"] = f"CUSTOMER:{self.source.upper()}:{database}:{customer_code or 'ALL'}:{snapshot_hash(snapshot)[:48]}"
            snapshots.append(snapshot)
            replace_demo_data = False
        return snapshots
