#!/usr/bin/env python3
"""Read-only E10 movement facts, independent from the retained standard SQL/34-column reader."""
import contextlib, io, json, logging, os, re, sys, hashlib
from pathlib import Path
from datetime import datetime, date
from decimal import Decimal
import xml.etree.ElementTree as ET
logging.disable(logging.CRITICAL)
MIN_DATE='2025-01-01'
def normalized(v):
    if isinstance(v,(datetime,date)):return v.isoformat()
    if isinstance(v,Decimal):return str(v)
    return str(v).lower() if v is not None and not isinstance(v,(str,bool,int,float)) else v

def parse_columns(body):
    if not body or not body.strip():return {}
    root=ET.fromstring(body)
    wanted={'AMT_UNINCLUDE_TAX_BC','TAX_BC','CLOSE','CUSTOMER_ID','ORDER_DATE','SALES_ORDER_DOC_ID','SALES_ORDER_DOC_D_ID','APPROVESTATUS','DOC_ID'}
    return {c.findtext('ColumnId').upper():{'old':c.findtext('OriginalValue'),'new':c.findtext('NewValue')} for c in root.findall('./Columns/DataLogColumnInfo') if (c.findtext('ColumnId') or '').upper() in wanted}

def extract(emit,since=None):
    basic=Path(os.environ.get('RD_BASIC_CODE_ROOT','/data/automation/code/work/basci/basic_code'));sys.path.insert(0,str(basic))
    with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
        from sql_server import MSSQLDatabase
        db=MSSQLDatabase(env_path=str(basic/'.env') if os.access(basic/'.env',os.R_OK) else '/dev/null',autoconnect=False);con=db._connect_pytds()
    con.autocommit=True;cur=con.cursor()
    def query(sql,params=()):
        (cur.execute(sql,params) if params else cur.execute(sql));names=[c[0] for c in cur.description];return [{k:normalized(v) for k,v in zip(names,row)} for row in cur.fetchall()]
    def stream(kind,sql,params=(),convert=None):
        (cur.execute(sql,params) if params else cur.execute(sql));names=[c[0] for c in cur.description]
        while True:
            rr=cur.fetchmany(250)
            if not rr:break
            rows=[{k:normalized(v) for k,v in zip(names,row)} for row in rr]
            for r in rows:
                for k in ['sourceKey','orderId','lineId','documentId','eventId','parentId']:
                    if isinstance(r.get(k),str):r[k]=r[k].lower()
            if convert:rows=[convert(r) for r in rows]
            emit({'kind':kind,'rows':rows})
    try:
        cur.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SET LOCK_TIMEOUT 5000; SET NOCOUNT ON')
        now=query('SELECT CONVERT(varchar(27),SYSDATETIME(),126) observedAt')[0]['observedAt']
        currency=query('SELECT DISTINCT c.CURRENCY_CODE code FROM dbo.PARA_COMPANY p JOIN dbo.CURRENCY c ON c.CURRENCY_ID=p.FUNCTION_CURRENCY_ID')
        if len(currency)!=1 or currency[0]['code']!='RMB':raise ValueError('Unsupported local currency')
        emit({'kind':'source','database':db.database,'observedAt':now,'since':since,'localCurrency':'RMB','mode':'INCREMENTAL' if since else 'FULL'})
        scope='';params=[MIN_DATE]
        if since:
            scope=''' AND (h.LastModifiedDate>=DATEADD(minute,-2,CONVERT(datetime2,%s)) OR EXISTS(
            SELECT 1 FROM dbo.SALES_ORDER_DOC_D xd LEFT JOIN dbo.SALES_ORDER_DOC_SD xs ON xs.SALES_ORDER_DOC_D_ID=xd.SALES_ORDER_DOC_D_ID
            WHERE xd.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID AND (xd.LastModifiedDate>=DATEADD(minute,-2,CONVERT(datetime2,%s)) OR xs.LastModifiedDate>=DATEADD(minute,-2,CONVERT(datetime2,%s)))))'''
            params += [since]*3
        stream('state', '''SELECT CONVERT(varchar(36),d.SALES_ORDER_DOC_D_ID) sourceKey,CONVERT(varchar(36),d.SALES_ORDER_DOC_D_ID) lineId,
        CONVERT(varchar(36),h.SALES_ORDER_DOC_ID) orderId,h.DOC_NO orderNo,CONVERT(varchar(27),h.ORDER_DATE,126) orderDate,c.CUSTOMER_CODE customerCode,i.ITEM_CODE itemCode,
        dt.DOC_NAME docType,h.ApproveStatus headerApproved,
        d.AMT_UNINCLUDE_TAX_BC+d.TAX_BC gross,CONVERT(varchar(20),h.[CLOSE]) headerClose,
        CONVERT(bit,coalesce(p.closed,0)) closedSchedule,CONVERT(varchar(27),h.LastModifiedDate,126) headerModified,
        CONVERT(varchar(27),d.LastModifiedDate,126) lineModified,CONVERT(varchar(27),p.modified,126) planModified
        FROM dbo.SALES_ORDER_DOC h JOIN dbo.SALES_ORDER_DOC_D d ON d.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID
        LEFT JOIN dbo.DOC dt ON dt.DOC_ID=h.DOC_ID
        LEFT JOIN dbo.CUSTOMER c ON c.CUSTOMER_BUSINESS_ID=h.CUSTOMER_ID LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=d.ITEM_ID
        OUTER APPLY(SELECT max(CASE WHEN s.[CLOSE]='1' THEN 1 ELSE 0 END) closed,max(s.LastModifiedDate) modified FROM dbo.SALES_ORDER_DOC_SD s WHERE s.SALES_ORDER_DOC_D_ID=d.SALES_ORDER_DOC_D_ID)p
        WHERE h.ORDER_DATE>=%s'''+scope,tuple(params))
        # SO documents are a small retained set; replay their current states every run to catch status/cycle changes.
        stream('change', '''SELECT CONVERT(varchar(36),d.SO_CHANGE_DOC_D_ID) sourceKey,CONVERT(varchar(36),h.SO_CHANGE_DOC_ID) documentId,
        CONVERT(varchar(36),d.SALES_ORDER_DOC_D_ID) lineId,CONVERT(varchar(36),h.SALES_ORDER_DOC_ID) orderId,
        o.DOC_NO orderNo,CONVERT(varchar(27),o.ORDER_DATE,126) orderDate,c.CUSTOMER_CODE customerCode,i.ITEM_CODE itemCode,
        dt.DOC_NAME docType,o.ApproveStatus headerApproved,h.CHANGE_VERSION changeVersion,h.ApproveStatus approvalStatus,CONVERT(varchar(27),h.ApproveDate,126) approvalTime,
        CONVERT(varchar(27),h.LastModifiedDate,126) modifiedTime,h.FULL_CLOSE fullClose,CONVERT(varchar(20),h.ORI_CLOSE) originalHeaderClose,
        CONVERT(varchar(20),d.CHANGE_TYPE) changeType,d.ORI_AMT_UNINCLUDE_TAX_BC+d.ORI_TAX_BC grossBefore,d.AMT_UNINCLUDE_TAX_BC+d.TAX_BC grossAfter,
        p.planCount,p.closed originalClosedSchedule,p.invalid invalidPlans,CASE WHEN p.minType<>d.CHANGE_TYPE OR p.maxType<>d.CHANGE_TYPE THEN 1 ELSE 0 END typeMismatch
        FROM dbo.SO_CHANGE_DOC h JOIN dbo.SO_CHANGE_DOC_D d ON d.SO_CHANGE_DOC_ID=h.SO_CHANGE_DOC_ID
        JOIN dbo.SALES_ORDER_DOC o ON o.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID
        LEFT JOIN dbo.DOC dt ON dt.DOC_ID=o.DOC_ID
        LEFT JOIN dbo.CUSTOMER c ON c.CUSTOMER_BUSINESS_ID=h.CUSTOMER_ID LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=d.ITEM_ID
        OUTER APPLY(SELECT count(*) planCount,max(CASE WHEN s.ORI_CLOSE='1' THEN 1 ELSE 0 END) closed,
        max(CASE WHEN s.ORI_CLOSE IS NULL OR s.ORI_CLOSE NOT IN ('0','1','2') THEN 1 ELSE 0 END) invalid,
        min(s.CHANGE_TYPE) minType,max(s.CHANGE_TYPE) maxType
        FROM dbo.SO_CHANGE_DOC_SD s WHERE s.SO_CHANGE_DOC_D_ID=d.SO_CHANGE_DOC_D_ID)p WHERE o.ORDER_DATE>=%s''',(MIN_DATE,))
        tables=query("SELECT name FROM sys.tables WHERE name LIKE 'DataLog[_]%' ORDER BY name")
        lower=since[:7].replace('-','') if since else '202501'
        # Include preceding month for the two-minute replay window at a month boundary.
        if since:
            yr,mo=map(int,since[:7].split('-'));lower=f'{yr-1 if mo==1 else yr:04}{12 if mo==1 else mo-1:02}'
        def log_record(r):
            body=r.pop('body') or '';r['cols']=parse_columns(body);r['xmlHash']=hashlib.sha256(body.encode()).hexdigest();return r
        for table in tables:
            name=table['name']
            if not re.fullmatch(r'DataLog_\d{6}',name) or name[8:]<lower:continue
            args=[MIN_DATE];condition=''
            if since:condition=' AND EventTime>=DATEADD(minute,-2,CONVERT(datetime2,%s))';args.append(since)
            stream('log', '''SELECT CONVERT(varchar(36),DataLogId) sourceKey,CONVERT(varchar(36),EventId) eventId,TypeKey typeKey,EntityName entity,
            ActionType action,lower(PrimaryValue) primaryValue,CONVERT(varchar(36),DataLogParentId) parentId,
            CONVERT(varchar(27),EventTime,126) eventTime,CONVERT(nvarchar(max),ModiColumnsInfo) body
            FROM dbo.['''+name+'''] WHERE EventTime>=%s'''+condition+''' AND TypeKey IN('SALES_ORDER_DOC','SO_CHANGE_DOC')
            AND EntityName IN('SALES_ORDER_DOC','SALES_ORDER_DOC_D','SALES_ORDER_DOC_SD','SO_CHANGE_DOC','SO_CHANGE_DOC_D','SO_CHANGE_DOC_SD')''',tuple(args),log_record)
        emit({'kind':'complete','observedAt':query('SELECT CONVERT(varchar(27),SYSDATETIME(),126) observedAt')[0]['observedAt']})
    finally:cur.close();con.close()

def main():
    try:
        options=json.loads(sys.stdin.read() or '{}') or {};extract(lambda p:print(json.dumps(p,ensure_ascii=False),flush=True),options.get('since'));return 0
    except Exception as e:
        print(json.dumps({'kind':'failure','errorType':type(e).__name__}),file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
