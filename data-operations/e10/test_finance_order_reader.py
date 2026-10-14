import importlib.util,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('finance_reader',Path(__file__).with_name('finance_order_reader.py'));reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
class Cursor:
 def __init__(self):self.calls=[];self.description=[];self.rows=[];self.page=0
 def execute(self,sql,params=()):
  self.calls.append((sql,params));value=[]
  if 'GETDATE()' in sql:value=[{'observedAt':'2026-10-14T09:00:00'}]
  elif 'PARA_COMPANY' in sql:value=[{'CURRENCY_CODE':'RMB'}]
  elif 'COUNT_BIG(DISTINCT' in sql:value=[{'year':2025,'orders':1,'lines':1,'localGross':'0.30'}]
  elif 'TOP (500)' in sql:
   if self.page==0:value=[{'orderDate':'2025-01-01','sourceLineId':'0199e000-0000-7000-8000-000000000011'}]
   self.page+=1
  self.description=[(k,) for k in value[0]] if value else [];self.rows=[tuple(v.values()) for v in value]
 def fetchall(self):return self.rows
 def close(self):pass
class Connection:
 def __init__(self):self.cur=Cursor();self.closed=False
 def cursor(self):return self.cur
 def close(self):self.closed=True
class ReaderTests(unittest.TestCase):
 def run_extract(self,**kwargs):
  con=Connection();module=types.ModuleType('basic_code');module.MSSQLDatabase=lambda **options:types.SimpleNamespace(database='SYNTHETIC-E10',_connect_pytds=lambda:con);pages=[]
  with patch.dict(sys.modules,{'basic_code':module}):reader.extract(pages.append,**kwargs)
  return con,pages
 def test_full_uses_2025_order_date_and_stable_uuid_pagination(self):
  con,pages=self.run_extract();queries=[q for q in con.cur.calls if 'TOP (500)' in q[0]]
  self.assertEqual(queries[0][1][0],'2025-01-01');self.assertIn('h.ORDER_DATE',queries[0][0]);self.assertIn('ORDER BY h.ORDER_DATE,d.SALES_ORDER_DOC_D_ID',queries[0][0]);self.assertEqual(queries[1][1][-1],'0199e000-0000-7000-8000-000000000011');self.assertEqual([p['kind'] for p in pages],['source','page','complete']);self.assertTrue(con.closed)
 def test_incremental_reloads_all_lines_of_changed_header_or_line_or_schedule(self):
  con,pages=self.run_extract(since='2026-10-14T08:00:00.1234567');sql,params=next(q for q in con.cur.calls if 'TOP (500)' in q[0]);self.assertIn('xd.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID',sql);self.assertIn('xs.LastModifiedDate',sql);self.assertIn('DATEADD(minute,-2',sql);self.assertEqual(params[1:4],tuple(['2026-10-14T08:00:00.1234567']*3));self.assertEqual(pages[0]['mode'],'INCREMENTAL')
 def test_resume_uses_persisted_source_cursor_and_never_executes_writes(self):
  con,_=self.run_extract(checkpoint={'date':'2025-07-01','lineId':'0199e000-0000-7000-8000-000000000010'});sql,params=next(q for q in con.cur.calls if 'TOP (500)' in q[0]);self.assertEqual(params[-3:],('2025-07-01','2025-07-01','0199e000-0000-7000-8000-000000000010'))
  for sql,_ in con.cur.calls:
   self.assertFalse(any(word in sql.upper() for word in ['INSERT ','UPDATE ','DELETE ','MERGE ','NOLOCK']))
if __name__=='__main__':unittest.main()
