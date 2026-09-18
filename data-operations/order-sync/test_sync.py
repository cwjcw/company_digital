import sys
import json
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))
import sync

HERE = Path(__file__).parent


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


class KejiaOnlyEntrypointTests(unittest.TestCase):
    """KN-MPS-LIVE-002：N8N 入口只能启动科加账套，其他账套必须 fail closed。"""

    def test_sources_declare_the_kejia_account_exactly_once(self):
        sources = json.loads((HERE / "sources.json").read_text(encoding="utf-8"))["sources"]
        kejia = [source for source in sources if source["key"] == "tplus-kejia"]
        self.assertEqual(len(kejia), 1)
        self.assertEqual(kejia[0]["source_database"], "UFTData418971_000003")
        self.assertEqual(kejia[0]["adapter"], "tplus")

    def test_entrypoint_script_only_starts_the_kejia_source(self):
        script = (HERE / "sync-kejia-orders.sh").read_text(encoding="utf-8")

        self.assertIn('ALLOWED_SOURCE="tplus-kejia"', script)
        self.assertIn('SOURCE_KEY="${KNPLAN_ALLOWED_SOURCE:-$ALLOWED_SOURCE}"', script)
        self.assertIn("exit 1", script)
        self.assertIn('run --source "$SOURCE_KEY"', script)
        # 入口脚本绝不能出现其他账套来源，避免默认参数或配置遍历误启动。
        self.assertNotIn("e10-main", script)
        self.assertNotIn("tplus-kainan", script)
        self.assertNotIn("UFTData741219_000012", script)
        self.assertNotIn("--source e10", script)
        self.assertNotIn("--source tplus-kainan", script)

    def test_project_script_only_drains_the_sales_order_projection(self):
        script = (HERE / "project.py").read_text(encoding="utf-8")

        self.assertIn('CONSUMERS = {"sales-orders-v1", "finished-goods-inbound-v1", "finished-goods-outbound-v1"}', script)
        self.assertIn("--consumer", script)


if __name__ == "__main__":
    unittest.main()
