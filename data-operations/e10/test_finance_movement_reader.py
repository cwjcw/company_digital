import unittest
from finance_movement_reader import parse_columns,normalized
from decimal import Decimal
class ReaderContract(unittest.TestCase):
    def test_only_typed_finance_fields_retained(self):
        body='<Root><Columns><DataLogColumnInfo><ColumnId>AMT_UNINCLUDE_TAX_BC</ColumnId><OriginalValue>0.10</OriginalValue><NewValue>0.30</NewValue></DataLogColumnInfo><DataLogColumnInfo><ColumnId>PRIVATE_NOTE</ColumnId><NewValue>hidden</NewValue></DataLogColumnInfo></Columns></Root>'
        self.assertEqual(parse_columns(body),{'AMT_UNINCLUDE_TAX_BC':{'old':'0.10','new':'0.30'}})
    def test_empty_deletion_does_not_invent_old_money(self):self.assertEqual(parse_columns(''),{})
    def test_exact_decimal(self):self.assertEqual(normalized(Decimal('999999999999.0100001')),'999999999999.0100001')
    def test_malformed_xml_fails_instead_of_silent_dropped_finance_event(self):
        with self.assertRaises(Exception):parse_columns('<Root>')
if __name__=='__main__':unittest.main()
