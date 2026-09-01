#!/usr/bin/env python3
"""Production ERP -> KDOS staging synchronizer.

SQL Server is read-only. Target writes only use the protected KDOS Application
Command API. Initialization and incremental cursors are intentionally separate.
"""
from __future__ import annotations

import argparse, csv, hashlib, io, json, os, sys, time
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Sequence
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from basic_code import MSSQLDatabase
from dotenv import load_dotenv

ROOT=Path(__file__).resolve().parents[2]; CONFIG=Path(__file__).with_name("sources.json")
START=datetime(2026,1,1); MIN_BUSINESS_DATE=datetime(1900,1,1); LIMIT=1000; OVERLAP=timedelta(minutes=2); ZERO_UUID="00000000-0000-0000-0000-000000000000"; MIN_INT=-2147483648

def iso(v:Any)->str|None:
    if v is None:return None
    if isinstance(v,datetime):return v.isoformat(timespec="microseconds")
    return datetime.fromisoformat(str(v)).isoformat(timespec="microseconds")
def source_time(v:Any)->datetime:
    parsed=v if isinstance(v,datetime) else datetime.fromisoformat(str(v))
    return parsed.replace(tzinfo=None)
def date(v:Any)->str|None:return None if v is None else str(v)[:10]
def text(v:Any)->str|None:
    s=str(v).strip() if v is not None else "";return s or None
def dec(v:Any)->str|None:return None if v is None else str(v)
def digest(payload:dict)->str:return hashlib.sha256(json.dumps(payload,ensure_ascii=False,sort_keys=True,default=str).encode()).hexdigest()

class Api:
    def __init__(self):
        load_dotenv(ROOT/".env",override=False)
        self.base=os.getenv("KNPLAN_API_URL","http://127.0.0.1:15172/api/v1").rstrip("/")
        self.token=os.getenv("KNPLAN_ORDER_SYNC_API_KEY") or os.getenv("KNPLAN_TPLUS_API_KEY")
        self.last_run:dict|None=None
        if not self.token:raise RuntimeError("缺少 KNPLAN_ORDER_SYNC_API_KEY（或兼容 KNPLAN_TPLUS_API_KEY）")
    def call(self,method:str,path:str,body:Any=None):
        raw=None if body is None else json.dumps(body,ensure_ascii=False,default=str).encode()
        req=Request(self.base+path,data=raw,method=method,headers={"X-API-Key":self.token,"Content-Type":"application/json","X-Request-ID":f"erp-sync-{time.time_ns()}"})
        for attempt in range(1,4):
            try:
                with urlopen(req,timeout=180) as response:
                    result=json.loads(response.read() or b"null")
                    if method=="POST" and path=="/data-operations/order-sync/runs" and isinstance(result,dict):self.last_run=result.get("run")
                    return result
            except HTTPError as error:
                message=f"KDOS API {error.code}: {error.read().decode(errors='replace')[:1000]}"
                if error.code<500 or attempt==3:raise RuntimeError(message) from error
            except Exception:
                if attempt==3:raise
            time.sleep(2**(attempt-1))

@dataclass
class Source:
    config:dict; db:MSSQLDatabase; connection:Any
    @property
    def key(self):return self.config["key"]
    @property
    def system(self):return self.config["source_system"]
    @property
    def database(self):return self.db.database
    @property
    def adapter(self):return self.config["adapter"]
    def query(self,sql:str,params:Sequence[Any]=()):
        upper=sql.strip().upper()
        if not upper.startswith("SELECT") or ";" in sql or any(f" {word} " in f" {upper} " for word in ["INSERT","UPDATE","DELETE","ALTER","DROP","CREATE","MERGE","TRUNCATE","EXEC","DBCC","NOLOCK"]):raise RuntimeError("只读保护拒绝SQL")
        for attempt in range(1,4):
            cur=self.connection.cursor()
            try:
                cur.execute(sql,tuple(params)); cols=[c[0] for c in cur.description or []];return [dict(zip(cols,row)) for row in cur.fetchall()]
            except Exception:
                if attempt==3:raise
                time.sleep(2**(attempt-1))
            finally:cur.close()
    def now(self):return self.query("SELECT GETDATE() source_now")[0]["source_now"]
    def close(self):self.connection.close()

def load_source(key:str)->Source:
    load_dotenv(ROOT/".env",override=False); cfg=next(x for x in json.loads(CONFIG.read_text())["sources"] if x["key"]==key)
    if cfg["adapter"]=="e10":
        load_dotenv(cfg["credential_store"],override=False); names=cfg["credential_env"]
        values={k:os.environ[n] for k,n in names.items()}; db=MSSQLDatabase(autoconnect=False,**values)
    else:
        db=MSSQLDatabase(autoconnect=False,database=cfg["source_database"],server=os.environ["TPLUS_SQL_HOST"],port=os.environ["TPLUS_SQL_PORT"],user=os.environ["TPLUS_SQL_USER"],password=os.environ["TPLUS_SQL_PASSWORD"])
    con=db._connect_pytds();con.autocommit=True;cur=con.cursor();cur.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SET LOCK_TIMEOUT 5000; SET NOCOUNT ON");cur.close()
    return Source(cfg,db,con)

E10_SCOPE="""((h.ORDER_DATE>=%s AND h.ORDER_DATE<=%s) OR (h.ORDER_DATE<%s AND (ISNULL(h.[CLOSE],N'0')=N'0' OR EXISTS(SELECT 1 FROM dbo.SALES_ORDER_DOC_D ld JOIN dbo.SALES_ORDER_DOC_SD ls ON ls.SALES_ORDER_DOC_D_ID=ld.SALES_ORDER_DOC_D_ID WHERE ld.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID AND (ISNULL(ls.[CLOSE],N'0')=N'0' OR ISNULL(ls.BUSINESS_QTY,0)>ISNULL(ls.DELIVERED_BUSINESS_QTY,0))))))"""
T_SCOPE="""((h.voucherdate>=%s AND h.voucherdate<=%s) OR (h.voucherdate<%s AND ((ISNULL(h.isCancel,0)=0 AND h.CloseDate IS NULL AND NULLIF(LTRIM(RTRIM(h.Closer)),N'') IS NULL) OR EXISTS(SELECT 1 FROM dbo.SA_SaleOrder_b ld WHERE ld.idSaleOrderDTO=h.ID AND ((ISNULL(ld.IsClose,0)=0 AND ISNULL(ld.IsCCClose,0)=0) OR ISNULL(ld.quantity,0)>ISNULL(ld.executedQuantity,0))))))"""

def init_sql(source:Source,stream:str)->tuple[str,str,str]:
    scope=E10_SCOPE if source.adapter=="e10" else T_SCOPE; pk0=ZERO_UUID if source.adapter=="e10" else MIN_INT
    if source.adapter=="e10":
        joins="LEFT JOIN dbo.CUSTOMER c ON c.CUSTOMER_BUSINESS_ID=h.CUSTOMER_ID"
        selections={
          "order_header":("SALES_ORDER_DOC","h.ORDER_DATE","h.SALES_ORDER_DOC_ID",f"SELECT TOP ({LIMIT}) h.SALES_ORDER_DOC_ID source_id,h.SALES_ORDER_DOC_ID source_order_id,CAST(NULL AS uniqueidentifier) source_order_line_id,h.DOC_NO order_number,h.ORDER_DATE business_date,h.LastModifiedDate modified_at,c.CUSTOMER_CODE customer_code,c.CUSTOMER_NAME customer_name,CAST(NULL AS nvarchar(100)) item_code,CAST(NULL AS nvarchar(200)) item_name,CAST(NULL AS decimal(28,6)) quantity,CAST(NULL AS decimal(28,6)) delivered_quantity,CAST(NULL AS datetime2) delivery_date,h.ApproveStatus status_code,h.[CLOSE] close_code FROM dbo.SALES_ORDER_DOC h {joins}"),
          "order_detail":("SALES_ORDER_DOC_D","h.ORDER_DATE","d.SALES_ORDER_DOC_D_ID",f"SELECT TOP ({LIMIT}) d.SALES_ORDER_DOC_D_ID source_id,h.SALES_ORDER_DOC_ID source_order_id,d.SALES_ORDER_DOC_D_ID source_order_line_id,h.DOC_NO order_number,h.ORDER_DATE business_date,d.LastModifiedDate modified_at,c.CUSTOMER_CODE customer_code,c.CUSTOMER_NAME customer_name,i.ITEM_CODE item_code,i.ITEM_NAME item_name,d.BUSINESS_QTY quantity,CAST(NULL AS decimal(28,6)) delivered_quantity,d.PLAN_DELIVERY_DATE delivery_date,d.ApproveStatus status_code,h.[CLOSE] close_code FROM dbo.SALES_ORDER_DOC h JOIN dbo.SALES_ORDER_DOC_D d ON d.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID {joins} LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=d.ITEM_ID"),
          "delivery_plan":("SALES_ORDER_DOC_SD","h.ORDER_DATE","s.SALES_ORDER_DOC_SD_ID",f"SELECT TOP ({LIMIT}) s.SALES_ORDER_DOC_SD_ID source_id,h.SALES_ORDER_DOC_ID source_order_id,d.SALES_ORDER_DOC_D_ID source_order_line_id,h.DOC_NO order_number,h.ORDER_DATE business_date,s.LastModifiedDate modified_at,c.CUSTOMER_CODE customer_code,c.CUSTOMER_NAME customer_name,i.ITEM_CODE item_code,i.ITEM_NAME item_name,s.BUSINESS_QTY quantity,s.DELIVERED_BUSINESS_QTY delivered_quantity,s.PLAN_DELIVERY_DATE delivery_date,s.PLAN_STATUS status_code,s.[CLOSE] close_code FROM dbo.SALES_ORDER_DOC h JOIN dbo.SALES_ORDER_DOC_D d ON d.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID JOIN dbo.SALES_ORDER_DOC_SD s ON s.SALES_ORDER_DOC_D_ID=d.SALES_ORDER_DOC_D_ID {joins} LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=d.ITEM_ID"),
        }
        if stream in selections:
            table,bd,pk,base=selections[stream]; return table,pk0,base+f" WHERE {scope} AND ({bd}>%s OR ({bd}=%s AND {pk}>CONVERT(uniqueidentifier,%s))) ORDER BY {bd},{pk}"
        if stream in ("outbound_detail","outbound_initial"):
            base=f"""SELECT TOP ({LIMIT}) x.SALES_ISSUE_D_ID source_id,h.SALES_ORDER_DOC_ID source_order_id,d.SALES_ORDER_DOC_D_ID source_order_line_id,h.DOC_NO order_number,COALESCE(h.ORDER_DATE,ih.TRANSACTION_DATE) business_date,x.LastModifiedDate modified_at,c.CUSTOMER_CODE customer_code,c.CUSTOMER_NAME customer_name,i.ITEM_CODE item_code,i.ITEM_NAME item_name,x.BUSINESS_QTY quantity,CAST(NULL AS decimal(28,6)) delivered_quantity,CAST(NULL AS datetime2) delivery_date,x.ApproveStatus status_code,CAST(NULL AS nvarchar(10)) close_code,CASE WHEN d.SALES_ORDER_DOC_D_ID IS NOT NULL AND h.SALES_ORDER_DOC_ID IS NOT NULL THEN 1 ELSE 0 END link_stable
              FROM dbo.SALES_ISSUE_D x JOIN dbo.SALES_ISSUE ih ON ih.SALES_ISSUE_ID=x.SALES_ISSUE_ID LEFT JOIN dbo.SALES_DELIVERY_D dv ON dv.SALES_DELIVERY_D_ID=x.SOURCE_ID_ROid AND x.SOURCE_ID_RTK=N'SALES_DELIVERY.SALES_DELIVERY_D' LEFT JOIN dbo.SALES_ORDER_DOC_SD ds ON ds.SALES_ORDER_DOC_SD_ID=x.ORDER_SOURCE_ID_ROid AND x.ORDER_SOURCE_ID_RTK=N'SALES_ORDER_DOC.SALES_ORDER_DOC_D.SALES_ORDER_DOC_SD' LEFT JOIN dbo.SALES_ORDER_DOC_SD vs ON vs.SALES_ORDER_DOC_SD_ID=dv.SOURCE_ID_ROid LEFT JOIN dbo.SALES_ORDER_DOC_D d ON d.SALES_ORDER_DOC_D_ID=COALESCE(ds.SALES_ORDER_DOC_D_ID,vs.SALES_ORDER_DOC_D_ID) LEFT JOIN dbo.SALES_ORDER_DOC h ON h.SALES_ORDER_DOC_ID=COALESCE(d.SALES_ORDER_DOC_ID,dv.SALES_ORDER_DOC_ID) LEFT JOIN dbo.CUSTOMER c ON c.CUSTOMER_BUSINESS_ID=h.CUSTOMER_ID LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=x.ITEM_ID
              WHERE ((h.SALES_ORDER_DOC_ID IS NOT NULL AND {scope}) OR (h.SALES_ORDER_DOC_ID IS NULL AND ih.TRANSACTION_DATE>=%s AND ih.TRANSACTION_DATE<=%s))"""
            if stream=="outbound_initial":return "SALES_ISSUE_D",pk0,base+" AND x.SALES_ISSUE_D_ID>CONVERT(uniqueidentifier,%s) ORDER BY x.SALES_ISSUE_D_ID"
            return "SALES_ISSUE_D",pk0,base+" AND (COALESCE(h.ORDER_DATE,ih.TRANSACTION_DATE)>%s OR (COALESCE(h.ORDER_DATE,ih.TRANSACTION_DATE)=%s AND x.SALES_ISSUE_D_ID>CONVERT(uniqueidentifier,%s))) ORDER BY COALESCE(h.ORDER_DATE,ih.TRANSACTION_DATE),x.SALES_ISSUE_D_ID"
        return "ITEM_WAREHOUSE",pk0,f"SELECT TOP ({LIMIT}) s.ITEM_WAREHOUSE_ID source_id,CAST(NULL AS uniqueidentifier) source_order_id,CAST(NULL AS uniqueidentifier) source_order_line_id,CAST(NULL AS nvarchar(100)) order_number,CAST('19000101' AS datetime2) business_date,s.LastModifiedDate modified_at,CAST(NULL AS nvarchar(100)) customer_code,CAST(NULL AS nvarchar(200)) customer_name,i.ITEM_CODE item_code,i.ITEM_NAME item_name,s.INVENTORY_QTY quantity,CAST(NULL AS decimal(28,6)) delivered_quantity,CAST(NULL AS datetime2) delivery_date,s.ApproveStatus status_code,CAST(NULL AS nvarchar(10)) close_code FROM dbo.ITEM_WAREHOUSE s LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=s.ITEM_ID WHERE s.ITEM_WAREHOUSE_ID>CONVERT(uniqueidentifier,%s) ORDER BY s.ITEM_WAREHOUSE_ID"
    selections={
      "order_header":("SA_SaleOrder","h.voucherdate","h.ID",f"SELECT TOP ({LIMIT}) h.ID source_id,h.ID source_order_id,CAST(NULL AS int) source_order_line_id,h.code order_number,h.voucherdate business_date,h.updated modified_at,c.code customer_code,c.name customer_name,CAST(NULL AS nvarchar(100)) item_code,CAST(NULL AS nvarchar(200)) item_name,CAST(NULL AS decimal(28,6)) quantity,CAST(NULL AS decimal(28,6)) delivered_quantity,h.deliveryDate delivery_date,CONVERT(nvarchar(30),h.voucherState) status_code,CASE WHEN h.CloseDate IS NOT NULL OR NULLIF(LTRIM(RTRIM(h.Closer)),N'') IS NOT NULL THEN 1 ELSE 0 END close_code FROM dbo.SA_SaleOrder h LEFT JOIN dbo.AA_PartnerEntity c ON c.id=h.idcustomer"),
      "order_detail":("SA_SaleOrder_b","h.voucherdate","d.id",f"SELECT TOP ({LIMIT}) d.id source_id,h.ID source_order_id,d.id source_order_line_id,h.code order_number,h.voucherdate business_date,d.updated modified_at,c.code customer_code,c.name customer_name,i.code item_code,i.name item_name,d.quantity quantity,d.saleOutQuantity delivered_quantity,d.deliveryDate delivery_date,CONVERT(nvarchar(30),h.voucherState) status_code,CASE WHEN ISNULL(d.IsClose,0)<>0 OR ISNULL(d.IsCCClose,0)<>0 THEN 1 ELSE 0 END close_code FROM dbo.SA_SaleOrder h JOIN dbo.SA_SaleOrder_b d ON d.idSaleOrderDTO=h.ID LEFT JOIN dbo.AA_PartnerEntity c ON c.id=h.idcustomer LEFT JOIN dbo.AA_InventoryEntity i ON i.id=d.idinventory")}
    if stream in selections:
        table,bd,pk,base=selections[stream];return table,pk0,base+f" WHERE {scope} AND ({bd}>%s OR ({bd}=%s AND {pk}>%s)) ORDER BY {bd},{pk}"
    if stream in ("outbound_detail","inbound_detail"):
        direction=0 if stream=="outbound_detail" else 1
        return "ST_RDRecord_b",pk0,f"SELECT TOP ({LIMIT}) d.ID source_id,h.ID source_order_id,d.saleOrderDetailId source_order_line_id,COALESCE(h.code,d.saleOrderCode) order_number,COALESCE(h.voucherdate,r.voucherdate) business_date,d.updated modified_at,c.code customer_code,c.name customer_name,i.code item_code,i.name item_name,d.quantity quantity,CAST(NULL AS decimal(28,6)) delivered_quantity,CAST(NULL AS datetime) delivery_date,CONVERT(nvarchar(30),r.voucherState) status_code,CAST(NULL AS int) close_code,CASE WHEN h.ID IS NOT NULL AND od.id IS NOT NULL THEN 1 ELSE 0 END link_stable FROM dbo.ST_RDRecord_b d JOIN dbo.ST_RDRecord r ON r.id=d.idRDRecordDTO LEFT JOIN dbo.SA_SaleOrder_b od ON od.id=d.saleOrderDetailId LEFT JOIN dbo.SA_SaleOrder h ON h.ID=od.idSaleOrderDTO LEFT JOIN dbo.AA_PartnerEntity c ON c.id=h.idcustomer LEFT JOIN dbo.AA_InventoryEntity i ON i.id=d.idinventory WHERE r.rdDirectionFlag={direction} AND ((h.ID IS NOT NULL AND {scope}) OR (h.ID IS NULL AND r.voucherdate>=%s AND r.voucherdate<=%s)) AND (COALESCE(h.voucherdate,r.voucherdate)>%s OR (COALESCE(h.voucherdate,r.voucherdate)=%s AND d.ID>%s)) ORDER BY COALESCE(h.voucherdate,r.voucherdate),d.ID"
    return "ST_NewCurrentStock",pk0,f"SELECT TOP ({LIMIT}) s.id source_id,CAST(NULL AS int) source_order_id,CAST(NULL AS int) source_order_line_id,CAST(NULL AS nvarchar(100)) order_number,CAST('19000101' AS datetime) business_date,s.updated modified_at,CAST(NULL AS nvarchar(100)) customer_code,CAST(NULL AS nvarchar(200)) customer_name,i.code item_code,i.name item_name,s.baseQuantity quantity,CAST(NULL AS decimal(28,6)) delivered_quantity,CAST(NULL AS datetime) delivery_date,CAST(NULL AS nvarchar(30)) status_code,CAST(NULL AS int) close_code FROM dbo.ST_NewCurrentStock s LEFT JOIN dbo.AA_InventoryEntity i ON i.id=s.idinventory WHERE s.id>%s ORDER BY s.id"

def params_for_init(source:Source,stream:str,snapshot:datetime,cursor_date:datetime,cursor_pk:Any)->tuple:
    if stream=="inventory":return (cursor_pk,)
    base=(START,snapshot,START)
    if stream=="outbound_initial":return base+(START,snapshot,cursor_pk)
    if stream in ("outbound_detail","inbound_detail"):return base+(START,snapshot,cursor_date,cursor_date,cursor_pk)
    return base+(cursor_date,cursor_date,cursor_pk)

def record(source:Source,stream:str,table:str,row:dict,overlap=False)->dict:
    sid=str(row["source_id"]);qty=dec(row.get("quantity"));delivered=dec(row.get("delivered_quantity"));out=None
    if qty is not None and delivered is not None:out=str(max(Decimal(qty)-Decimal(delivered),Decimal(0)))
    closed=str(row.get("close_code") or "0") not in ("0","None","")
    payload={k:(iso(v) if isinstance(v,datetime) else str(v) if type(v).__name__=="Decimal" else v) for k,v in row.items()}
    return {"sourceSystem":source.system,"sourceDatabase":source.database,"sourceTable":table,"sourceId":sid,
      "recordType":{"order_header":"ORDER_HEADER","order_detail":"ORDER_LINE","delivery_plan":"DELIVERY_PLAN","outbound_detail":"OUTBOUND_LINE","outbound_initial":"OUTBOUND_LINE","inbound_detail":"INBOUND_LINE","inventory":"INVENTORY"}[stream],
      "sourceOrderId":text(row.get("source_order_id")),"sourceOrderLineId":text(row.get("source_order_line_id")),"orderNumber":text(row.get("order_number")),
      "businessDate":date(row.get("business_date")),"modifiedAt":iso(row.get("modified_at")),"customerCode":text(row.get("customer_code")),"customerName":text(row.get("customer_name")),
      "itemCode":text(row.get("item_code")),"itemName":text(row.get("item_name")),"quantity":qty,"deliveredQuantity":delivered,"outstandingQuantity":out,"deliveryDate":date(row.get("delivery_date")),
      "statusCode":text(row.get("status_code")),"statusLabel":None,"isCancelled":False,"isClosed":closed,"isCompleted":closed or (out is not None and Decimal(out)==0),
      "orderLinkStable":bool(row.get("link_stable")) if stream in ("outbound_detail","outbound_initial","inbound_detail") else None,"linkRule":"E10_ORDER_SOURCE_SCHEDULE_OR_DELIVERY" if source.adapter=="e10" and stream in ("outbound_detail","outbound_initial") else "TPLUS_SALE_ORDER_DETAIL_ID" if stream in ("outbound_detail","inbound_detail") else None,
      "rawPayload":payload,"contentHash":digest(payload),"overlapReplay":overlap}

def initialize(source:Source,api:Api):
    snapshot=source.now(); start=api.call("POST","/data-operations/order-sync/runs",{"sourceKey":source.key,"sourceSystem":source.system,"sourceDatabase":source.database,"sourceAccountName":source.config["account_name"],"fieldMapping":source.config["field_mapping"],"runType":"INITIALIZATION","sourceSnapshotAt":iso(snapshot)})
    run=start["run"]; snapshot=source_time(run.get("source_snapshot_at") or snapshot); state=api.call("GET",f"/data-operations/order-sync/sources/{source.key}"); cursors={(x["phase"],x["stream"]):x for x in state.get("cursors",[])}; metrics={"streams":{}}
    streams=["order_header","order_detail"]+(["delivery_plan"] if source.adapter=="e10" else [])+(["outbound_initial"] if source.adapter=="e10" else ["outbound_detail","inbound_detail"])+["inventory"]
    for stream in streams:
        table,minimum,sql=init_sql(source,stream); cur=cursors.get(("INITIALIZATION",stream),{}); cdate=source_time(cur.get("initialization_business_date") or MIN_BUSINESS_DATE); cpk=cur.get("initialization_source_pk") or minimum; cpk=int(cpk) if source.adapter=="tplus" else cpk; batch=int(start.get("lastBatchByStream",{}).get(stream,0)); total=0
        while True:
            before={"businessDate":iso(cdate),"sourcePk":str(cpk)}
            began=time.perf_counter();rows=source.query(sql,params_for_init(source,stream,snapshot,cdate,cpk));batch+=1
            records=[record(source,stream,table,x) for x in rows]
            if rows:
                cdate=rows[-1]["business_date"] if stream not in ("inventory","outbound_initial") else cdate;cpk=str(rows[-1]["source_id"])
            after={"businessDate":iso(cdate),"sourcePk":str(cpk)}
            api.call("POST","/data-operations/order-sync/batches",{"sourceKey":source.key,"runId":run["id"],"phase":"INITIALIZATION","stream":stream,"sourceTable":table,"batchNumber":batch,"idempotencyKey":f"{source.key}:init:{stream}:{after['businessDate']}:{after['sourcePk']}","cursorBefore":before,"cursorAfter":after,"batchFull":len(rows)==LIMIT,"durationMs":round((time.perf_counter()-began)*1000,3),"records":records})
            total+=len(rows)
            if len(rows)<LIMIT:break
        metrics["streams"][stream]={"records":total,"batches":batch}
    api.call("POST",f"/data-operations/order-sync/runs/{run['id']}/complete",{"sourceKey":source.key,"metrics":metrics});incremental(source,api,"COMPENSATION",snapshot)

def incremental(source:Source,api:Api,run_type="INCREMENTAL",snapshot:datetime|None=None):
    proposed_upper=source.now()
    start=api.call("POST","/data-operations/order-sync/runs",{"sourceKey":source.key,"sourceSystem":source.system,"sourceDatabase":source.database,"sourceAccountName":source.config["account_name"],"fieldMapping":source.config["field_mapping"],"runType":run_type,"sourceSnapshotAt":iso(snapshot) if snapshot else None,"scanUpperBound":iso(proposed_upper)});run=start["run"]
    upper=source_time(run.get("scan_upper_bound") or proposed_upper); state=api.call("GET",f"/data-operations/order-sync/sources/{source.key}"); cursors={(x["phase"],x["stream"]):x for x in (state or {}).get("cursors",[])}
    metrics={"streams":{}};streams=["order_header","order_detail"]+(["delivery_plan"] if source.adapter=="e10" else [])+["outbound_detail"]+(["inbound_detail"] if source.adapter=="tplus" else [])+["inventory"]
    for stream in streams:
        table,minimum,base=init_sql(source,stream); cur=cursors.get(("INCREMENTAL",stream),{}); overlap_boundary=source_time(cur.get("last_successful_scan_upper_bound") or snapshot or state.get("source_snapshot_at") or upper); anchor=overlap_boundary-OVERLAP
        resumed=bool(cur.get("active_run_id") and str(cur.get("active_run_id"))==str(run["id"]))
        page_time=source_time(cur.get("active_page_modified_at")) if resumed and cur.get("active_page_modified_at") else anchor
        page_pk=cur.get("active_page_source_pk") if resumed and cur.get("active_page_source_pk") is not None else minimum
        last_actual_time=source_time(cur.get("last_processed_modified_at")) if cur.get("last_processed_modified_at") else None
        last_actual_pk=cur.get("last_processed_source_pk")
        page_pk=int(page_pk) if source.adapter=="tplus" else page_pk;batch=int(start.get("lastBatchByStream",{}).get(stream,0));total=0
        # Reuse the canonical initialization projection, replacing its WHERE with a table-specific incremental query is deliberate and tested below.
        marker=" WHERE "; projection=base.split(marker,1)[0]; alias={"order_header":"h","order_detail":"d","delivery_plan":"s","outbound_detail":"x" if source.adapter=="e10" else "d","inbound_detail":"d","inventory":"s"}[stream]; modified="LastModifiedDate" if source.adapter=="e10" else "updated"; pk_expr={"order_header":"h.SALES_ORDER_DOC_ID" if source.adapter=="e10" else "h.ID","order_detail":"d.SALES_ORDER_DOC_D_ID" if source.adapter=="e10" else "d.id","delivery_plan":"s.SALES_ORDER_DOC_SD_ID","outbound_detail":"x.SALES_ISSUE_D_ID" if source.adapter=="e10" else "d.ID","inbound_detail":"d.ID","inventory":"s.ITEM_WAREHOUSE_ID" if source.adapter=="e10" else "s.id"}[stream]
        direction_filter=" AND r.rdDirectionFlag=0" if source.adapter=="tplus" and stream=="outbound_detail" else " AND r.rdDirectionFlag=1" if stream=="inbound_detail" else ""
        sql=projection+f" WHERE {alias}.{modified} IS NOT NULL{direction_filter} AND ({alias}.{modified}>%s OR ({alias}.{modified}=%s AND {pk_expr}>{'CONVERT(uniqueidentifier,%s)' if source.adapter=='e10' else '%s'})) AND {alias}.{modified}<=%s"+f" ORDER BY {alias}.{modified},{pk_expr}"
        while True:
            before={"modifiedAt":iso(page_time),"sourcePk":str(page_pk)}
            began=time.perf_counter();rows=source.query(sql,(page_time,page_time,page_pk,upper));batch+=1;records=[record(source,stream,table,x, bool(x.get("modified_at") and x["modified_at"]<=overlap_boundary)) for x in rows]
            if rows:
                page_time=rows[-1]["modified_at"];page_pk=str(rows[-1]["source_id"]);last_actual_time=page_time;last_actual_pk=page_pk
            after={"modifiedAt":iso(last_actual_time),"sourcePk":str(last_actual_pk)} if last_actual_time is not None and last_actual_pk is not None else None
            api.call("POST","/data-operations/order-sync/batches",{"sourceKey":source.key,"runId":run["id"],"phase":"INCREMENTAL","stream":stream,"sourceTable":table,"batchNumber":batch,"idempotencyKey":f"{source.key}:{run_type}:{stream}:{iso(upper)}:{batch}","cursorBefore":before,"cursorAfter":after,"scanUpperBound":iso(upper),"batchFull":len(rows)==LIMIT,"durationMs":round((time.perf_counter()-began)*1000,3),"records":records});total+=len(rows)
            if len(rows)<LIMIT:break
        metrics["streams"][stream]={"records":total,"batches":batch}
    api.call("POST",f"/data-operations/order-sync/runs/{run['id']}/complete",{"sourceKey":source.key,"metrics":metrics})

def save_reports(api:Api,source:Source):
    out=ROOT/"outputs"/"erp-order-sync";out.mkdir(parents=True,exist_ok=True);stamp=datetime.now().strftime("%Y%m%d_%H%M%S")
    report=api.call("GET","/data-operations/order-sync/report");quality=api.call("GET","/data-operations/order-sync/quality-report")
    selected={"generatedAt":iso(datetime.now()),"sourceKey":source.key,"sync":report,"quality":quality}
    (out/f"{source.key}_{stamp}.json").write_text(json.dumps(selected,ensure_ascii=False,indent=2,default=str),encoding="utf-8")
    rows=[row for row in report.get("batches",[]) if row.get("sourceKey")==source.key]
    with (out/f"{source.key}_{stamp}.csv").open("w",newline="",encoding="utf-8-sig") as handle:
        fields=["sourceKey","runType","stream","sourceTable","batchCount","recordCount","insertedCount","updatedCount","overlapReplayCount","trueDuplicateCount","averageDurationMs","maxDurationMs","retryCount"]
        writer=csv.DictWriter(handle,fieldnames=fields,extrasaction="ignore");writer.writeheader();writer.writerows(rows)

def main():
    p=argparse.ArgumentParser();p.add_argument("command",choices=["initialize","incremental","run"]);p.add_argument("--source",required=True,choices=[x["key"] for x in json.loads(CONFIG.read_text())["sources"]]);a=p.parse_args();source=load_source(a.source);api=Api()
    try:
        state=api.call("GET",f"/data-operations/order-sync/sources/{source.key}")
        if a.command=="initialize" or (a.command=="run" and not state):initialize(source,api)
        elif a.command=="run" and state.get("status")!="ACTIVE":initialize(source,api)
        else:incremental(source,api)
        save_reports(api,source)
    except Exception as error:
        if api.last_run and api.last_run.get("status")=="RUNNING":
            try:api.call("POST",f"/data-operations/order-sync/runs/{api.last_run['id']}/fail",{"sourceKey":source.key,"errorMessage":str(error),"retryCount":3})
            except Exception:pass
        raise
    finally:source.close()
if __name__=="__main__":main()
