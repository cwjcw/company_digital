#!/usr/bin/env python3
"""Paged read-only T+ BOM header reconciliation. No child reads or ERP writes."""
import json
import sys
import os
import socket
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parents[2]
BASIC = Path(os.getenv('RD_BASIC_CODE_ROOT', '/data/automation/code/work/basci/basic_code'))
shared_site = BASIC / '.venv/lib' / f'python{sys.version_info.major}.{sys.version_info.minor}' / 'site-packages'
if shared_site.is_dir(): sys.path.insert(0, str(shared_site))
sys.path.insert(0, str(BASIC))
from sql_server import MSSQLDatabase, load_basic_env
import pytds

class LocalTunnelSocket(socket.socket):
    # Same existing AF_UNIX SQL proxy path as kejia-bom-reader.py; no new tunnel.
    def __init__(self): super().__init__(socket.AF_UNIX, socket.SOCK_STREAM)
    def setsockopt(self, level, optname, value, *args):
        if level == socket.IPPROTO_TCP: return
        return super().setsockopt(level, optname, value, *args)

class Source:
    def __init__(self, connection): self.connection = connection
    def query(self, sql, params=()):
        if not sql.lstrip().upper().startswith('SELECT') or ';' in sql: raise ValueError('readonly')
        cur = self.connection.cursor()
        try:
            cur.execute(sql, tuple(params))
            return [dict(zip([c[0] for c in cur.description], row)) for row in cur.fetchall()]
        finally: cur.close()
    def close(self): self.connection.close()

def load_source(key):
    required = ['TPLUS_SQL_HOST','TPLUS_SQL_USER','TPLUS_SQL_PASSWORD']
    if any(not os.getenv(k) for k in required): load_basic_env(ROOT / '.env')
    if any(not os.getenv(k) for k in required): raise ValueError('missing_source_configuration')
    config = MSSQLDatabase(server=os.getenv('TPLUS_SQL_HOST'),port=os.getenv('TPLUS_SQL_PORT','1433'),
        database=DATABASES[key],user=os.getenv('TPLUS_SQL_USER'),password=os.getenv('TPLUS_SQL_PASSWORD'),env_path='/dev/null',autoconnect=False)
    tunnel = None
    if os.getenv('TPLUS_BOM_SQL_SOCKET'):
        tunnel = LocalTunnelSocket(); tunnel.settimeout(35); tunnel.connect(os.environ['TPLUS_BOM_SQL_SOCKET'])
    try:
        connection = pytds.connect(server=config.server,port=int(config.port),database=config.database,user=config.user,password=config.password,
            sock=tunnel,readonly=True,autocommit=True,timeout=35,login_timeout=35,
            **({'disable_connect_retry': True} if tunnel else {}))
        cur=connection.cursor();cur.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SET LOCK_TIMEOUT 5000; SET NOCOUNT ON');cur.close()
        return Source(connection)
    except Exception:
        if tunnel: tunnel.close()
        raise

DATABASES = {'tplus-kejia': 'UFTData418971_000003', 'tplus-kainan': 'UFTData741219_000012'}
STATS = """SELECT COUNT_BIG(*) total,
 SUM(CASE WHEN b.voucherstate=189 AND b.disabled=0 THEN 1 ELSE 0 END) valid,
 CHECKSUM_AGG(BINARY_CHECKSUM(b.id,b.ts,i.id,i.code)) fingerprint,
 ISNULL(MAX(b.id),0) max_id FROM dbo.AA_BOM b LEFT JOIN dbo.AA_InventoryEntity i ON i.id=b.idinventory"""
PAGE = """SELECT TOP (%s) b.id source_bom_id,b.idinventory item_id,i.code item_code,b.version bom_version,
 b.voucherstate voucher_state,b.disabled,b.isDefaultBom is_default,
 b.createdtime source_created_at,b.updated source_modified_at,b.AuditedTime source_audited_at
 FROM dbo.AA_BOM b LEFT JOIN dbo.AA_InventoryEntity i ON i.id=b.idinventory
 WHERE b.id>%s AND b.id<=%s ORDER BY b.id"""

def emit(value):
    print(json.dumps(value, ensure_ascii=False, default=lambda x: x.isoformat() if isinstance(x, datetime) else str(x)), flush=True)

def run(request):
    source = request['source']
    if source not in DATABASES:
        raise ValueError('source')
    page_size = max(1, min(1000, int(request.get('pageSize', 500))))
    src = load_source(source)
    try:
        if src.query('SELECT DB_NAME() db')[0]['db'] != DATABASES[source]:
            raise ValueError('database')
        before = src.query(STATS)[0]
        if before['total'] > 200000:
            raise ValueError('limit')
        emit({'type': 'begin', 'source': source, 'database': DATABASES[source], 'evidence': before})
        last = 0
        scanned = valid = 0
        while True:
            rows = src.query(PAGE, (page_size, last, before['max_id']))
            if not rows:
                break
            if any(r['disabled'] not in (0, 1) or r['is_default'] not in (0, 1) for r in rows):
                raise ValueError('flags')
            for row in rows:
                row['disabled'] = bool(row['disabled'])
                row['is_default'] = bool(row['is_default'])
                if row['voucher_state'] == 189 and not row['disabled']:
                    valid += 1
            emit({'type': 'page', 'records': rows})
            scanned += len(rows)
            last = rows[-1]['source_bom_id']
        after = src.query(STATS)[0]
        if before != after or scanned != before['total'] or valid != (before['valid'] or 0):
            raise ValueError('source_changed')
        emit({'type': 'end', 'source': source, 'scanned': scanned, 'valid': valid, 'evidence': after})
    finally:
        src.close()

if __name__ == '__main__':
    try:
        run(json.load(sys.stdin))
    except Exception:
        print('TPLUS_BOM_READ_OR_RECONCILIATION_FAILED', file=sys.stderr)
        sys.exit(1)
