import importlib.util
import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bom_index_reader', Path(__file__).with_name('bom-index-reader.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)

class FakeSource:
    def __init__(self, changed=False): self.page=0; self.stats=0; self.changed=changed; self.closed=False
    def query(self, sql, params=()):
        assert sql.lstrip().upper().startswith('SELECT')
        if 'DB_NAME' in sql: return [{'db': reader.DATABASES['tplus-kejia']}]
        if 'COUNT_BIG' in sql:
            self.stats+=1
            return [{'total':2,'valid':1,'fingerprint':2 if self.changed and self.stats==2 else 1,'max_id':2}]
        self.page+=1
        if self.page>2: return []
        return [{'source_bom_id':self.page,'item_id':self.page,'item_code':'CODE','bom_version':'A','voucher_state':189 if self.page==1 else 181,'disabled':0,'is_default':0,'source_created_at':None,'source_modified_at':None,'source_audited_at':None}]
    def close(self): self.closed=True

class ReaderTest(unittest.TestCase):
    def test_paged_headers_include_unapproved_and_nondefault_and_verify_before_end(self):
        src=FakeSource(); out=io.StringIO()
        with patch.object(reader,'load_source',return_value=src),redirect_stdout(out): reader.run({'source':'tplus-kejia','pageSize':1})
        events=[json.loads(l) for l in out.getvalue().splitlines()]
        self.assertEqual([e['type'] for e in events],['begin','page','page','end'])
        self.assertEqual(events[-1]['valid'],1); self.assertTrue(src.closed)
        self.assertFalse(events[1]['records'][0]['is_default'])
    def test_source_change_refuses_completion(self):
        src=FakeSource(True); out=io.StringIO()
        with patch.object(reader,'load_source',return_value=src),redirect_stdout(out),self.assertRaises(ValueError): reader.run({'source':'tplus-kejia'})
        self.assertNotIn('"type": "end"',out.getvalue());self.assertTrue(src.closed)

if __name__=='__main__': unittest.main()
