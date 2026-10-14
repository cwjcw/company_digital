#!/usr/bin/env python3
"""Verified E10 read-only adapter. NDJSON pages; never writes to SQL Server."""
import contextlib, io, json, logging, os, sys
from datetime import datetime, date
from decimal import Decimal
from pathlib import Path
logging.disable(logging.CRITICAL)
ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT/'packages/contracts/src/finance-order-fields.json').read_text())
JOINS = '''FROM dbo.SALES_ORDER_DOC h JOIN dbo.SALES_ORDER_DOC_D d ON d.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID
LEFT JOIN dbo.DOC dt ON dt.DOC_ID=h.DOC_ID
LEFT JOIN dbo.CUSTOMER c ON c.CUSTOMER_BUSINESS_ID=h.CUSTOMER_ID
LEFT JOIN dbo.EMPLOYEE e ON e.EMPLOYEE_ID=h.Owner_Emp
LEFT JOIN dbo.ADMIN_UNIT a ON a.ADMIN_UNIT_ID=h.Owner_Dept
LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=d.ITEM_ID
LEFT JOIN dbo.CURRENCY cu ON cu.CURRENCY_ID=h.CURRENCY_ID
LEFT JOIN dbo.UNIT u ON u.UNIT_ID=d.PRICE_UNIT_ID
LEFT JOIN dbo.TAX t ON t.TAX_ID=d.TAX_ID
OUTER APPLY (SELECT SUM(s.DELIVERED_BUSINESS_QTY) DELIVERED_BUSINESS_QTY,
 SUM(s.DELIVERED_PRICE_QTY) DELIVERED_PRICE_QTY,
 CASE WHEN MIN(s.[CLOSE])=MAX(s.[CLOSE]) THEN MIN(s.[CLOSE]) ELSE N'冲突' END [CLOSE],
 COUNT_BIG(*) scheduleCount, MAX(s.LastModifiedDate) modifiedAt
 FROM dbo.SALES_ORDER_DOC_SD s WHERE s.SALES_ORDER_DOC_D_ID=d.SALES_ORDER_DOC_D_ID) sd'''
def normalize(v):
    if isinstance(v, Decimal):return str(v)
    if isinstance(v,(datetime,date)):return v.isoformat()
    return str(v) if v is not None and not isinstance(v,(str,int,float,bool)) else v

def extract(emit, checkpoint=None, since=None):
    basic_root=Path(os.getenv('RD_BASIC_CODE_ROOT','/data/automation/code/work/basci/basic_code'))
    sys.path.insert(0,str(basic_root))
    with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
        # Match the existing rd_reader: importing the toolkit package also loads WeChat-only dependencies.
        from sql_server import MSSQLDatabase
        env_file=basic_root/'.env'
        db=MSSQLDatabase(env_path=str(env_file) if os.access(env_file,os.R_OK) else '/dev/null',autoconnect=False); con=db._connect_pytds()
    con.autocommit=True
    cur=con.cursor();cur.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SET LOCK_TIMEOUT 5000; SET NOCOUNT ON')
    def query(sql,params=()):
        cur.execute(sql,params);return [dict(zip([c[0] for c in cur.description],row)) for row in cur.fetchall()]
    try:
        now=query('SELECT CONVERT(varchar(33),GETDATE(),126) observedAt')[0]['observedAt']
        currency=query('SELECT DISTINCT c.CURRENCY_CODE FROM dbo.PARA_COMPANY p JOIN dbo.CURRENCY c ON c.CURRENCY_ID=p.FUNCTION_CURRENCY_ID')
        if len(currency)!=1 or currency[0]['CURRENCY_CODE']!='RMB':raise ValueError('Unsupported local currency')
        scope=""
        scope_params=[]
        if since:
            # Any header/line/schedule change re-reads all lines of the affected order.
            # A two-minute overlap makes equality/clock and same-timestamp changes replay safe.
            scope=""" AND (h.LastModifiedDate>=DATEADD(minute,-2,CONVERT(datetime2,%s)) OR EXISTS(
              SELECT 1 FROM dbo.SALES_ORDER_DOC_D xd LEFT JOIN dbo.SALES_ORDER_DOC_SD xs ON xs.SALES_ORDER_DOC_D_ID=xd.SALES_ORDER_DOC_D_ID
              WHERE xd.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID AND (xd.LastModifiedDate>=DATEADD(minute,-2,CONVERT(datetime2,%s))
               OR xs.LastModifiedDate>=DATEADD(minute,-2,CONVERT(datetime2,%s)))))"""
            scope_params=[since]*3
        # Capture independent source aggregates (no dimension joins and no approval exclusion).
        coverage=query('''SELECT YEAR(h.ORDER_DATE) year,COUNT_BIG(DISTINCT h.SALES_ORDER_DOC_ID) orders,
 COUNT_BIG(d.SALES_ORDER_DOC_D_ID) lines,SUM(d.AMT_UNINCLUDE_TAX_BC+d.TAX_BC) localGross,
 MIN(h.ORDER_DATE) firstDate,MAX(h.ORDER_DATE) lastDate
 FROM dbo.SALES_ORDER_DOC h LEFT JOIN dbo.SALES_ORDER_DOC_D d ON d.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID
 WHERE h.ORDER_DATE >= %s '''+scope+' GROUP BY YEAR(h.ORDER_DATE)',tuple([SCHEMA['minimumOrderDate']]+scope_params))
        emit({'kind':'source','observedAt':now,'database':db.database,'localCurrency':'RMB','mode':'INCREMENTAL' if since else 'FULL','since':since,'coverage':[{k:normalize(v) for k,v in row.items()} for row in coverage]})
        last=checkpoint or {'date':SCHEMA['minimumOrderDate'],'lineId':'00000000-0000-0000-0000-000000000000'}
        selections=','.join(f"{f['source']} [{f['key']}]" for f in SCHEMA['fields'])
        while True:
            rows=query(f'''SELECT TOP (500) {selections},
 CONVERT(varchar(36),h.SALES_ORDER_DOC_ID) sourceOrderId,CONVERT(varchar(36),d.SALES_ORDER_DOC_D_ID) sourceLineId,
 CONVERT(varchar(33),h.LastModifiedDate,126) headerModifiedAt,
 CONVERT(varchar(33),d.LastModifiedDate,126) lineModifiedAt,
 CONVERT(varchar(33),sd.modifiedAt,126) scheduleModifiedAt,sd.scheduleCount
 {JOINS} WHERE h.ORDER_DATE>=%s {scope} AND (h.ORDER_DATE>%s OR (h.ORDER_DATE=%s AND d.SALES_ORDER_DOC_D_ID>CONVERT(uniqueidentifier,%s)))
 ORDER BY h.ORDER_DATE,d.SALES_ORDER_DOC_D_ID''',tuple([SCHEMA['minimumOrderDate']]+scope_params+[last['date'],last['date'],last['lineId']]))
            if not rows:break
            rows=[{k:normalize(v) for k,v in row.items()} for row in rows]
            nxt={'date':rows[-1]['orderDate'],'lineId':rows[-1]['sourceLineId']}
            if nxt==last:raise ValueError('Cursor did not advance')
            emit({'kind':'page','rows':rows,'cursor':nxt});last=nxt
        emit({'kind':'complete','cursor':last})
    finally:cur.close();con.close()
def main():
    try:
        options=json.loads(sys.stdin.read() or '{}') or {}
        extract(lambda page:print(json.dumps(page,ensure_ascii=False),flush=True),options.get('cursor'),options.get('since'));return 0
    except Exception as error:
        # No upstream exception text: drivers can include credentials or source rows.
        print(json.dumps({'kind':'failure','errorType':type(error).__name__}),file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
