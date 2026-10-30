"""Synthetic source facts; no live database and no ERP snapshots."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch,Mock
from io import StringIO
spec=importlib.util.spec_from_file_location('reader',Path(__file__).with_name('kejia-bom-reader.py'))
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)

class ReaderTests(unittest.TestCase):
 def run_reader(self,ambiguous=False,actual=False,item_only=False,duplicate_item=False,default_ambiguity=False):
  calls=[]
  def query(cur,sql,args=()):
   calls.append((sql,args))
   if 'DB_NAME()' in sql:return [{'db':reader.DB}]
   if 'FROM dbo.AA_InventoryEntity WHERE' in sql:return [{'item_id':1,'item_code':'ROOT'}]*(2 if duplicate_item else 1)
   if 'FROM dbo.SA_SaleOrder_b' in sql:return [{'order_number':'SYN','line_id':42,'item_id':1,'order_bom_id':None,'item_code':'ROOT'}]
   if 'FROM dbo.AA_Process WHERE' in sql:return [{'code':'S1','name':'焊接'}]
   if 'FROM dbo.AA_BOM WHERE idinventory' in sql:return [{'id':77,'version':'01','isDefaultBom':1,'disabled':0,'idrouting':None},{'id':78,'version':'02','isDefaultBom':1 if default_ambiguity else 0,'disabled':0,'idrouting':None}]
   if 'FROM dbo.MP_ManufactureOrder_b' in sql:
    if 'IN (' in sql:return [{'id':12,'idinventory':2,'idbom':88,'idrouting':9}]
    return [{'id':11,'idbom':77,'idrouting':None}]+([{'id':13,'idbom':78,'idrouting':None}] if ambiguous else [])
   if 'FROM dbo.AA_BOMChild' in sql:
    self.assertEqual(args,(77,))
    return [{'id':101,'idbom':77,'idchildbom':88,'idinventory':2,'code':'CHILD','name':'子件','idDefaultRouting':9}]
   if 'FROM dbo.AA_BOM WHERE id IN' in sql:return [{'id':88,'idinventory':2,'idrouting':9}]
   if 'FROM dbo.AA_BOMProcess' in sql:return [{'idbom':88,'seq':1,'process_code':'S1','process_name':'焊接'}]
   if 'FROM dbo.MP_ManufactureOrder_Process' in sql:return [{'line_id':12,'seq':1,'process_code':'S2','process_name':'实际工序'}] if actual else []
   if 'FROM dbo.AA_Routing WHERE' in sql:return [{'id':9,'code':'R1','name':'焊接路线'}]
   if 'FROM dbo.AA_Routing_b' in sql:return [{'route_id':9,'seq':1,'process_code':'S1','process_name':'焊接'}]
   raise AssertionError(sql)
  old=reader.select;reader.select=query
  try:return reader.read_facts(None,{'orderNumber':'SYN','itemCode':'ROOT',**({} if item_only else {'orderLineId':'42'})}),calls
  finally:reader.select=old
 def test_exact_line_and_one_level_only(self):
  f,calls=self.run_reader()
  self.assertEqual(f['bomId'],'77');self.assertEqual(f['children'][0]['processes'][0]['code'],'S1')
  self.assertEqual(len([q for q,args in calls if 'AA_BOMChild' in q]),1)
  self.assertEqual(f['children'][0]['source'],'子件BOM工序')
 def test_actual_execution_has_provenance_and_is_not_replaced_by_latest_template(self):
  f,_=self.run_reader(actual=True)
  self.assertEqual(f['children'][0]['source'],'加工单实际工序');self.assertEqual(f['children'][0]['processes'][0]['code'],'S2')
 def test_multiple_executed_bom_versions_do_not_guess(self):
  f,calls=self.run_reader(ambiguous=True)
  self.assertEqual(f['state'],'AMBIGUOUS');self.assertFalse(f['children']);self.assertFalse(any('AA_BOMChild' in q for q,args in calls))
 def test_item_code_without_order_line_reads_default_bom_and_route(self):
  f,calls=self.run_reader(item_only=True)
  self.assertEqual(f['state'],'READY');self.assertEqual(f['bomId'],'77');self.assertIsNone(f['orderLineId'])
  self.assertEqual(f['children'][0]['processes'][0]['code'],'S1')
  self.assertFalse(any('SA_SaleOrder' in sql or 'MP_ManufactureOrder' in sql for sql,args in calls))
 def test_same_code_or_multiple_default_versions_never_select_first(self):
  for options in [{'duplicate_item':True},{'default_ambiguity':True}]:
   f,_=self.run_reader(item_only=True,**options)
   self.assertEqual(f['state'],'AMBIGUOUS');self.assertFalse(f['children'])
 def test_query_guard_rejects_writes(self):
  for sql in ['UPDATE AA_BOM SET disabled=1','SELECT 1; DELETE FROM AA_BOM']:
   with self.assertRaises(ValueError):reader.select(None,sql)
 def test_container_uses_injected_environment_without_reading_secret_file(self):
  env={'TPLUS_SQL_HOST':'127.0.0.1','TPLUS_SQL_PORT':'14330','TPLUS_SQL_USER':'synthetic','TPLUS_SQL_PASSWORD':'synthetic'}
  config=Mock(server='127.0.0.1',port='14330',database=reader.DB,user='synthetic',password='synthetic')
  with patch.dict(reader.os.environ,env,clear=True),patch.object(reader,'load_basic_env') as load,patch.object(reader,'MSSQLDatabase',return_value=config) as make,patch.object(reader.pytds,'connect') as connect,patch.object(reader,'read_facts',return_value={'state':'READY'}),patch.object(reader.sys,'stdin',StringIO('{"orderLineId":"42"}')),patch.object(reader.sys,'stdout',StringIO()):
   reader.main();load.assert_not_called();self.assertEqual(make.call_args.kwargs['env_path'],'/dev/null');self.assertEqual(make.call_args.kwargs['server'],'127.0.0.1');self.assertTrue(connect.call_args.kwargs['readonly'])
if __name__=='__main__':unittest.main()
