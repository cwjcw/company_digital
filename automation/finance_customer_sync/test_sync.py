import contextlib
import io
import json
import os
import types
import pandas as pd
import unittest
from unittest.mock import patch, Mock
import main

class FinanceSyncTest(unittest.TestCase):
    def test_seed_statistics(self):
        rows=main.seed_rows()
        self.assertEqual(len(rows),138)
        self.assertEqual(len({r['customerCode'] for r in rows}),138)
        self.assertEqual(next(r for r in rows if r['customerCode']=='A140')['salesChannel'],'内销')

    def test_source_query_uses_verified_audit_dates_and_shared_cutoff(self):
        cutoff=main.minimum_source_date()
        frame=pd.DataFrame([{'customer_code':' 001-A ', 'created_at_source':cutoff+'T00:00:00', 'modified_at_source':None}])
        database=Mock();database.get_from_query.return_value=frame
        module=types.SimpleNamespace(MSSQLDatabase=Mock(return_value=database))
        with patch.dict('sys.modules',{'basic_code':module}):
            rows=main.source_rows()
        query=database.get_from_query.call_args.args[0]
        self.assertIn('FROM dbo.CUSTOMER',query)
        self.assertIn('WHERE CreateDate >=',query)
        self.assertIn('OR LastModifiedDate >=',query)
        self.assertIn(cutoff+'T00:00:00',query)
        self.assertNotIn('SALES_ORDER',query)
        self.assertEqual(rows,[{'customerCode':'001-A','createdAtSource':cutoff+'T00:00:00','modifiedAtSource':None}])

    def test_network_response_loss_retries_identical_payload(self):
        response=Mock(ok=True)
        response.json.return_value={'read':1,'created':1,'skipped':0,'repeated':True}
        captured=[]
        def post(*args,**kwargs):
            captured.append(kwargs['json'])
            if len(captured)==1:
                raise main.requests.Timeout('simulated-response-loss')
            return response
        with patch.dict(os.environ,{'KDOS_FINANCE_API_KEY':'isolated-fixture'}),patch.object(main,'source_rows',return_value=[{'customerCode':'TEST-NEW-CUSTOMER'}]),patch.object(main.requests,'post',side_effect=post),patch('sys.argv',['main.py']),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main.main(),0)
        self.assertEqual(captured[0],captured[1])
        self.assertEqual(captured[0]['rows'],[{'customerCode':'TEST-NEW-CUSTOMER'}])
        self.assertNotIn('tenantId',captured[0])

    def test_source_failure_is_sanitized_and_logged_when_api_available(self):
        output=io.StringIO()
        with patch.dict(os.environ,{'KDOS_FINANCE_API_KEY':'isolated-fixture'}),patch.object(main,'source_rows',side_effect=RuntimeError('sensitive-driver-message')),patch.object(main.requests,'post',return_value=Mock()) as post,patch('sys.argv',['main.py']),contextlib.redirect_stdout(output):
            self.assertEqual(main.main(),1)
            self.assertIn('sync-failure',post.call_args.args[0])
        self.assertNotIn('sensitive-driver-message',output.getvalue())
        self.assertNotIn('isolated-fixture',output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['status'],'FAILED')

    def test_empty_source_submission_never_requests_deletion(self):
        response=Mock(ok=True);response.json.return_value={'created':0,'read':0,'skipped':0}
        with patch.dict(os.environ,{'KDOS_FINANCE_API_KEY':'isolated-fixture'}),patch.object(main,'source_rows',return_value=[]),patch.object(main.requests,'post',return_value=response) as post,patch('sys.argv',['main.py']),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main.main(),0)
            self.assertEqual(post.call_args.kwargs['json']['rows'],[])

if __name__=='__main__':
    unittest.main()
