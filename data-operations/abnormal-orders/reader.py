#!/usr/bin/env python3
"""Read-only independent source adapter; complete bounded read verified by second pass."""
import hashlib,importlib.util,json,os,sys,time
from pathlib import Path
from datetime import date,datetime
from decimal import Decimal
ROOT=Path(__file__).resolve().parents[2]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
E10="""SELECT TOP (%s) CONVERT(varchar(36),d.SALES_ORDER_DOC_D_ID) source_line_id,LTRIM(RTRIM(h.DOC_NO)) order_no,LTRIM(RTRIM(i.ITEM_CODE)) item_code,i.ITEM_NAME item_name,
 d.BUSINESS_QTY required_quantity,CONVERT(varchar(10),h.ORDER_DATE,23) order_date,CONVERT(varchar(10),d.PLAN_DELIVERY_DATE,23) customer_due_date,
 h.ApproveStatus header_approved,d.ApproveStatus line_approved,h.[CLOSE] header_close,
 CASE WHEN EXISTS(SELECT 1 FROM dbo.SALES_ORDER_DOC_SD s WHERE s.SALES_ORDER_DOC_D_ID=d.SALES_ORDER_DOC_D_ID AND s.[CLOSE]='1') THEN 1 ELSE 0 END specified_close
 FROM dbo.SALES_ORDER_DOC h JOIN dbo.SALES_ORDER_DOC_D d ON d.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=d.ITEM_ID
 WHERE h.ORDER_DATE>='20260101' AND d.SALES_ORDER_DOC_D_ID>CONVERT(uniqueidentifier,%s) ORDER BY d.SALES_ORDER_DOC_D_ID"""
TPLUS="""SELECT TOP (%s) CONVERT(varchar(100),d.id) source_line_id,LTRIM(RTRIM(h.code)) order_no,LTRIM(RTRIM(i.code)) item_code,i.name item_name,d.quantity required_quantity,
 CONVERT(varchar(10),h.voucherdate,23) order_date,CAST(NULL AS varchar(10)) customer_due_date,h.voucherState voucher_state,h.isCancel cancelled,CASE WHEN h.auditeddate IS NOT NULL THEN 1 ELSE 0 END audited,CASE WHEN h.CloseDate IS NOT NULL OR NULLIF(LTRIM(RTRIM(h.Closer)),'') IS NOT NULL THEN 1 ELSE 0 END header_stopped,d.IsClose line_stopped,d.IsCCClose commercial_stopped
 FROM dbo.SA_SaleOrder h JOIN dbo.SA_SaleOrder_b d ON d.idSaleOrderDTO=h.id LEFT JOIN dbo.AA_InventoryEntity i ON i.id=d.idinventory
 WHERE h.voucherdate>='20260101' AND d.id>%s ORDER BY d.id"""
DATABASES={'e10-main':'E10_6.0.0.1.NEW.CHS','tplus-kainan':'UFTData741219_000012','tplus-kejia':'UFTData418971_000003'}
def encode(v):
 if isinstance(v,Decimal):return format(v,'f')
 if isinstance(v,(date,datetime)):return v.isoformat()
 if isinstance(v,bytes):return v.decode('gb18030')
 raise TypeError('unsupported_source_type')
def emit(v):print(json.dumps(v,ensure_ascii=False,default=encode,separators=(',',':')),flush=True)
def read(source,stream):
 repo=module('abnormal_e10',ROOT/'data-operations/e10/pmc_rd_progress_reader.py').E10Repository() if source=='e10-main' else module('abnormal_tplus',ROOT/'data-operations/tplus/bom-index-reader.py').load_source(source)
 query=repo._query if source=='e10-main' else repo.query
 try:
  if query('SELECT DB_NAME() db')[0]['db']!=DATABASES[source]:raise ValueError('source_database_mismatch')
  counts=query("SELECT COUNT_BIG(*) total,COUNT(DISTINCT d.SALES_ORDER_DOC_D_ID) original_lines FROM dbo.SALES_ORDER_DOC h JOIN dbo.SALES_ORDER_DOC_D d ON d.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=d.ITEM_ID WHERE h.ORDER_DATE>='20260101'" if source=='e10-main' else "SELECT COUNT_BIG(*) total,COUNT(DISTINCT d.id) original_lines FROM dbo.SA_SaleOrder h JOIN dbo.SA_SaleOrder_b d ON d.idSaleOrderDTO=h.id LEFT JOIN dbo.AA_InventoryEntity i ON i.id=d.idinventory WHERE h.voucherdate>='20260101'")[0]
  if counts['total']!=counts['original_lines']:raise ValueError('join_identity_duplicate')
  last='00000000-0000-0000-0000-000000000000' if source=='e10-main' else 0
  digest=hashlib.sha256();count=0
  while True:
   rows=query(E10 if source=='e10-main' else TPLUS,(1000,last))
   if not rows:break
   # Unambiguous original row identity. No DISTINCT/SUM over joins.
   if len({r['source_line_id'] for r in rows})!=len(rows):raise ValueError('join_identity_duplicate')
   for r in rows:
    digest.update(json.dumps(r,ensure_ascii=False,default=encode,sort_keys=True,separators=(',',':')).encode());digest.update(b'\n')
   count+=len(rows)
   if count>200000:raise ValueError('source_limit')
   if stream:emit({'type':'page','records':rows})
   last=rows[-1]['source_line_id'] if source=='e10-main' else int(rows[-1]['source_line_id'])
  if count!=counts['original_lines']:raise ValueError('source_count_changed')
  return count,digest.hexdigest()
 finally:repo.close()
def main():
 req=json.load(sys.stdin);source=req['source']
 if source not in DATABASES:raise ValueError('source_invalid')
 emit({'type':'begin','source':source,'database':DATABASES[source]})
 first=read(source,True);second=read(source,False)
 if first!=second:raise ValueError('source_changed')
 emit({'type':'end','source':source,'scanned':first[0],'digest':first[1],'verified':True})
if __name__=='__main__':
 try:main()
 except Exception:print('ABNORMAL_ORDER_SOURCE_READ_FAILED',file=sys.stderr);sys.exit(1)
