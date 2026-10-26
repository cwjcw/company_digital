"""Scoped, read-only Kejia T+ adapter. Reads one order line and one BOM level.

Credentials stay in the existing environment/shared MSSQLDatabase utility.
No scheduling, writes, manufacturing classification, process mapping or quantity math.
"""
from __future__ import annotations
import json,os,sys,socket
from pathlib import Path
from datetime import datetime,timezone

DB='UFTData418971_000003'
BASIC=Path(os.getenv('RD_BASIC_CODE_ROOT','/data/automation/code/work/basci/basic_code'))
# Reuse the shared toolkit's tested pure-Python TDS client when its Python minor
# matches this runtime; the distribution's older TDS client remains the fallback.
shared_site=BASIC/'.venv/lib'/f'python{sys.version_info.major}.{sys.version_info.minor}'/'site-packages'
if shared_site.is_dir():sys.path.insert(0,str(shared_site))
sys.path.insert(0,str(BASIC))
from sql_server import MSSQLDatabase,load_basic_env
import pytds

class LocalTunnelSocket(socket.socket):
    """SQL-authenticated local stream; TCP tuning is inapplicable to AF_UNIX."""
    def __init__(self):super().__init__(socket.AF_UNIX,socket.SOCK_STREAM)
    def setsockopt(self,level,optname,value,*args):
        if level==socket.IPPROTO_TCP:return
        return super().setsockopt(level,optname,value,*args)

def select(cur,sql,args=()):
    if not sql.lstrip().upper().startswith('SELECT') or ';' in sql:raise ValueError('READ_ONLY_QUERY_REQUIRED')
    cur.execute(sql,tuple(args));keys=[c[0] for c in cur.description]
    return [dict(zip(keys,r)) for r in cur.fetchall()]

def unique(values):return sorted({v for v in values if v is not None})
def placeholders(ids):return ','.join(['%s']*len(ids))
def fact_process(row,source):
    return {'code':row['process_code'],'name':row['process_name'],'sequence':int(row['seq'] or 0),'source':source}

def read_facts(cur,request):
    line=int(request['orderLineId'])
    if line<=0 or len(str(request['orderNumber']))>200 or len(str(request['itemCode']))>128:raise ValueError('INVALID_SCOPE')
    if select(cur,'SELECT DB_NAME() db')[0]['db']!=DB:raise ValueError('WRONG_SOURCE_DATABASE')
    rows=select(cur,'''SELECT h.code order_number,d.id line_id,d.idinventory item_id,d.idbom order_bom_id,i.code item_code
 FROM dbo.SA_SaleOrder_b d JOIN dbo.SA_SaleOrder h ON h.ID=d.idSaleOrderDTO
 JOIN dbo.AA_InventoryEntity i ON i.id=d.idinventory WHERE d.id=%s AND h.code=%s AND i.code=%s''',(line,request['orderNumber'],request['itemCode']))
    if len(rows)!=1:raise ValueError('ORDER_LINE_NOT_FOUND')
    root=rows[0]
    result={'sourceKey':'tplus-kejia','sourceDatabase':DB,'observedAt':datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'orderNumber':root['order_number'],'itemCode':root['item_code'],'orderLineId':str(line),
        'state':'NO_BOM','message':'未找到唯一适用主BOM','bomId':None,'bomVersion':None,'children':[],
        'catalog':select(cur,'SELECT code,name FROM dbo.AA_Process WHERE ISNULL(disabled,0)=0 ORDER BY code')}
    headers=select(cur,'''SELECT id,version,isDefaultBom,disabled,idrouting FROM dbo.AA_BOM WHERE idinventory=%s''',(root['item_id'],))
    production=select(cur,'''SELECT d.id,d.idbom,d.idrouting FROM dbo.MP_ManufactureOrder_b d
 JOIN dbo.MP_ManufactureOrder h ON h.ID=d.idManufactureOrderDTO
 WHERE d.saleOrderDetailId=%s AND d.idinventory=%s''',(line,root['item_id']))
    ids=unique(r['idbom'] for r in production)
    if not ids and root['order_bom_id'] is not None:ids=[root['order_bom_id']]
    if not ids:ids=[r['id'] for r in headers if not r['disabled'] and r['isDefaultBom']]
    if len(ids)>1:result.update(state='AMBIGUOUS',message='本订单品项存在多个BOM来源，不能自动确定一级工艺');return result
    header=next((h for h in headers if ids and h['id']==ids[0]),None)
    if not header:return result
    result.update(state='READY',message='',bomId=str(header['id']),bomVersion=str(header['version'] or ''))
    children=select(cur,'''SELECT c.id,c.idbom,c.idchildbom,c.idinventory,i.code,i.name,i.idDefaultRouting
 FROM dbo.AA_BOMChild c LEFT JOIN dbo.AA_InventoryEntity i ON i.id=c.idinventory
 WHERE c.idbom=%s ORDER BY c.id''',(header['id'],))
    if len(children)>2000:raise ValueError('BOM_TOO_LARGE')
    item_ids=unique(c['idinventory'] for c in children)
    if not item_ids:return result
    manufactured=select(cur,f'''SELECT d.id,d.idinventory,d.idbom,d.idrouting FROM dbo.MP_ManufactureOrder_b d
 JOIN dbo.MP_ManufactureOrder h ON h.ID=d.idManufactureOrderDTO
 WHERE d.saleOrderDetailId=%s AND d.idinventory IN ({placeholders(item_ids)})''',(line,*item_ids))
    child_bom_ids=unique([c['idchildbom'] for c in children]+[m['idbom'] for m in manufactured])
    child_headers=select(cur,f'SELECT id,idinventory,idrouting FROM dbo.AA_BOM WHERE id IN ({placeholders(child_bom_ids)})',child_bom_ids) if child_bom_ids else []
    bom_steps=select(cur,f'''SELECT b.idbom,b.sequenceNumber seq,p.code process_code,p.name process_name
 FROM dbo.AA_BOMProcess b LEFT JOIN dbo.AA_Process p ON p.id=b.idProcess WHERE b.idbom IN ({placeholders(child_bom_ids)}) ORDER BY b.idbom,b.sequenceNumber,b.id''',child_bom_ids) if child_bom_ids else []
    manufacture_ids=unique(m['id'] for m in manufactured)
    actual=select(cur,f'''SELECT x.idManufactureOrderDetailDTO line_id,x.sequencenumber seq,p.code process_code,p.name process_name
 FROM dbo.MP_ManufactureOrder_Process x LEFT JOIN dbo.AA_Process p ON p.id=x.idProcess
 WHERE x.idManufactureOrderDetailDTO IN ({placeholders(manufacture_ids)}) ORDER BY x.idManufactureOrderDetailDTO,x.sequencenumber,x.id''',manufacture_ids) if manufacture_ids else []
    route_ids=unique([c['idDefaultRouting'] for c in children]+[m['idrouting'] for m in manufactured]+[b['idrouting'] for b in child_headers])
    routes=select(cur,f'SELECT id,code,name FROM dbo.AA_Routing WHERE id IN ({placeholders(route_ids)})',route_ids) if route_ids else []
    route_steps=select(cur,f'''SELECT b.idRoutingDTO route_id,b.jobsequence seq,p.code process_code,p.name process_name
 FROM dbo.AA_Routing_b b LEFT JOIN dbo.AA_Process p ON p.id=b.idProcess WHERE b.idRoutingDTO IN ({placeholders(route_ids)}) ORDER BY b.idRoutingDTO,b.jobsequence,b.id''',route_ids) if route_ids else []
    for c in children:
        child={'id':str(c['id']),'bomId':str(header['id']),'bomVersion':str(header['version'] or ''),
            'itemCode':c['code'] or '', 'itemName':c['name'] or '', 'routeCode':None,'routeName':None,
            'source':'未取到工艺配置','state':'NO_ROUTE','processes':[]}
        ms=[m for m in manufactured if m['idinventory']==c['idinventory']]
        # Multiple distinct executed process structures are ambiguous; never merge versions silently.
        structures={tuple((r['seq'],r['process_code']) for r in actual if r['line_id']==m['id']) for m in ms}
        structures.discard(())
        mids={m['id'] for m in ms}
        selected=[];source='';route=None
        if len(structures)>1:child.update(state='AMBIGUOUS',source='加工单实际工序存在多个结构')
        elif structures:
            m=next(m for m in ms if any(a['line_id']==m['id'] for a in actual))
            selected=[a for a in actual if a['line_id']==m['id']];source='加工单实际工序';route=m['idrouting']
        else:
            bids=unique(m['idbom'] for m in ms) or ([c['idchildbom']] if c['idchildbom'] else [])
            valid=[b for b in child_headers if b['id'] in bids and b['idinventory']==c['idinventory']]
            rids=unique(m['idrouting'] for m in ms) or unique(b['idrouting'] for b in valid)
            if len(bids)>1 or len(rids)>1:child.update(state='AMBIGUOUS',source='子件BOM或路线来源存在歧义')
            else:
                selected=[b for b in bom_steps if valid and b['idbom']==valid[0]['id']]
                if selected:source='子件BOM工序'
                route=rids[0] if rids else c['idDefaultRouting']
                if not selected:
                    selected=[b for b in route_steps if b['route_id']==route]
                    source='加工单/子件BOM关联路线' if rids else '子件默认路线'
        if selected and any(not r['process_code'] or not r['process_name'] for r in selected):
            child.update(state='AMBIGUOUS',source='来源工序引用缺失');selected=[]
        if child['state']!='AMBIGUOUS' and selected:
            child.update(state='READY',source=source,processes=[fact_process(r,source) for r in selected])
        rh=next((r for r in routes if r['id']==route),None)
        if rh:child.update(routeCode=rh['code'],routeName=rh['name'])
        result['children'].append(child)
    return result

def main():
    request=json.load(sys.stdin)
    # Reuse existing environment and shared utility; never copy credential files.
    required=['TPLUS_SQL_HOST','TPLUS_SQL_USER','TPLUS_SQL_PASSWORD']
    if any(not os.environ.get(k) for k in required):
        for candidate in [Path(__file__).resolve().parents[2]/'.env',BASIC/'.env']:
            if candidate.is_file() and os.access(candidate,os.R_OK):load_basic_env(candidate)
    if any(not os.environ.get(k) for k in ['TPLUS_SQL_HOST','TPLUS_SQL_USER','TPLUS_SQL_PASSWORD']):raise ValueError('MISSING_TPLUS_SOURCE_CONFIGURATION')
    config=MSSQLDatabase(server=os.environ.get('TPLUS_SQL_HOST'),port=os.environ.get('TPLUS_SQL_PORT'),
        database=DB,user=os.environ.get('TPLUS_SQL_USER'),password=os.environ.get('TPLUS_SQL_PASSWORD'),env_path='/dev/null',autoconnect=False)
    tunnel=None
    if os.environ.get('TPLUS_BOM_SQL_SOCKET'):
        tunnel=LocalTunnelSocket();tunnel.settimeout(15)
        tunnel.connect(os.environ['TPLUS_BOM_SQL_SOCKET'])
    try:
        connection=pytds.connect(server=config.server,port=int(config.port),database=DB,user=config.user,password=config.password,
            sock=tunnel,readonly=True,autocommit=True,timeout=35,login_timeout=35)
    except Exception:
        if tunnel:tunnel.close()
        raise
    try:
        cur=connection.cursor();cur.execute('SET LOCK_TIMEOUT 5000')
        print(json.dumps(read_facts(cur,request),ensure_ascii=False,default=str))
    finally:connection.close()
if __name__=='__main__':
    try:main()
    except Exception:
        # SQL/driver errors may contain credentials or SQL parameters; do not print them.
        print('科加一级BOM读取失败：请检查来源连接及订单明细关联',file=sys.stderr)
        sys.exit(1)
