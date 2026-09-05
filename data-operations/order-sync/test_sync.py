import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))
import sync


class IncrementalCursorTests(unittest.TestCase):
    def test_e10_uses_microsecond_precision_everywhere(self):
        source = SimpleNamespace(adapter="e10")
        _, _, sql = sync.incremental_sql(source, "outbound_detail")

        expression = "CAST(x.LastModifiedDate AS datetime2(6))"
        self.assertIn(f"{expression} modified_at", sql)
        self.assertIn(f"WHERE {expression} IS NOT NULL", sql)
        self.assertIn(f"{expression}>%s", sql)
        self.assertIn(f"{expression}=%s", sql)
        self.assertIn(f"ORDER BY {expression},x.SALES_ISSUE_D_ID", sql)

    def test_tplus_keeps_native_updated_timestamp(self):
        source = SimpleNamespace(adapter="tplus")
        _, _, sql = sync.incremental_sql(source, "outbound_detail")

        self.assertIn("d.updated modified_at", sql)
        self.assertIn("WHERE d.updated IS NOT NULL", sql)
        self.assertNotIn("datetime2(6)", sql)

    def test_stops_immediately_when_a_nonempty_page_does_not_advance(self):
        cursor = {"modifiedAt": "2026-09-04T15:08:48.833814", "sourcePk": "id-1"}
        with self.assertRaisesRegex(RuntimeError, "分页游标未推进"):
            sync.assert_cursor_progress("outbound_detail", cursor, cursor.copy(), 1000)

    def test_failed_incremental_does_not_restart_full_initialization(self):
        initialized = {"status": "FAILED", "initialization_completed_at": "2026-09-01T00:00:00"}
        never_initialized = {"status": "FAILED", "initialization_completed_at": None}

        self.assertFalse(sync.needs_initialization("run", initialized))
        self.assertTrue(sync.needs_initialization("run", never_initialized))
        self.assertFalse(sync.needs_initialization("incremental", never_initialized))


if __name__ == "__main__":
    unittest.main()
