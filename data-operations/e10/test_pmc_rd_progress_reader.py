import copy
import json
import unittest
from datetime import datetime
from pathlib import Path
from pmc_rd_progress_reader import normalize_guid, affected_facts, source_changes, advance_cursor
from pmc_rd_progress_regression import oracle

class SharedFixtureTests(unittest.TestCase):
    def test_phase3_shared_fixtures(self):
        for case in json.loads((Path(__file__).parent/'fixtures/pmc-rd-progress.json').read_text()):
            with self.subTest(case=case['name']):self.assertEqual(oracle(case['facts'])[0],case['expected'])
    def test_overlap_cannot_regress_cursor(self):
        class Repository:
            def _query(self,*args):return [{"advances":0}]
        before={"at":"2026-10-07 12:00:00.000978","id":"old"}
        self.assertEqual(advance_cursor(Repository(),before,{"at":datetime(2026,10,7,11,59),"id":"new"}),before)
        self.assertEqual(advance_cursor(Repository(),before,{"at":datetime(2026,10,7,12,0,0,978),"id":"lower-guid"}),before)
        self.assertEqual(advance_cursor(Repository(),before,None),before)
        newer={"at":datetime(2026,10,7,12,0,0,979),"id":"new"}
        self.assertEqual(advance_cursor(Repository(),before,newer),newer)
    def test_driver_byte_guid(self):
        self.assertEqual(normalize_guid(b'6FEE95FC-CD25-46A3-AC94-1BE37EFEB273'),'6fee95fc-cd25-46a3-ac94-1be37efeb273')
        self.assertIsNone(normalize_guid(b'00000000-0000-0000-0000-000000000000'))
    def test_routing_changes_include_standard_route_consumers(self):
        class Repository:
            def __init__(self):self.sql=[]
            def _query(self,sql,params):
                self.sql.append(sql)
                if 'STANDARD_ROUTING_ID IN' in sql:return [{'item_id':'standard-consumer'}]
                if 'FROM dbo.ITEM_ROUTING WHERE' in sql:return [{'item_id':'route-owner'}]
                return []
        repository=Repository();items,_=affected_facts(repository,{'ITEM_ROUTING':['changed-route']})
        self.assertEqual(items,{'route-owner','standard-consumer'})
    def test_operation_and_route_detail_reverse_lookup(self):
        for table in ('ITEM_ROUTING_D','OPERATION'):
            class Repository:
                def _query(self,sql,params):
                    if 'SELECT DISTINCT' in sql or 'SELECT CONVERT(varchar(36),ITEM_ROUTING_ID) id' in sql:return [{'id':'changed-route'}]
                    if 'STANDARD_ROUTING_ID IN' in sql:return [{'item_id':'consumer'}]
                    return []
            items,_=affected_facts(Repository(),{table:['changed-detail']})
            self.assertIn('consumer',items)
    def test_each_change_source_reaches_order_or_item(self):
        cases={'SALES_ORDER_DOC':'order','SALES_ORDER_DOC_D':'order','ITEM':'item','ITEM_PLANT':'item','BOM':'item','BOM_D':'item','CUSTOMER':'order','ADMIN_UNIT':'order'}
        for table,target in cases.items():
            class Repository:
                def _query(self,sql,params):return [{'order_id':'changed'}] if 'order_id FROM' in sql else [{'item_id':'changed'}]
            items,orders=affected_facts(Repository(),{table:['changed']})
            self.assertIn('changed',items if target=='item' else orders)
    def test_composite_keyset_precision_overlap_and_cutoff(self):
        class Repository:
            def __init__(self):self.calls=[]
            def _query(self,sql,params):
                self.calls.append((sql,params))
                if len(self.calls)==1:return [{'at':datetime(2026,10,6,12,0,0,978),'id':'guid'}]*1000
                return []
        r=Repository();list(source_changes(r,'ITEM','ITEM_BUSINESS_ID',{'at':'2026-10-06 12:00:00.000978','id':'guid'},datetime(2026,10,6,12,1)))
        self.assertEqual(r.calls[0][1][0],datetime(2026,10,6,11,58,0,978))
        self.assertIn('ITEM_BUSINESS_ID>CONVERT(uniqueidentifier,%s)',r.calls[1][0])
        self.assertEqual(r.calls[1][1][2].microsecond,978)

if __name__=='__main__':unittest.main()
