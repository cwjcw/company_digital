import sys
import json
import unittest
from decimal import Decimal
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))
import sync

HERE = Path(__file__).parent


class IncrementalCursorTests(unittest.TestCase):
    def test_unclosed_process_run_is_failed_and_alertable(self):
        class FakeApi:
            calls = []
            def call(self, method, path, body=None):
                self.calls.append((method, path, body))
                if method == "GET":
                    return {"id": "run-unclosed", "runType": "INCREMENTAL", "startedAt": "2026-11-18T09:00:00"}
                return {"ok": True}

        api = FakeApi()
        self.assertTrue(sync.report_unclosed_run(api, "tplus-kejia"))
        self.assertEqual(api.calls[0][:2], ("GET", "/data-operations/order-sync/sources/tplus-kejia/running-run"))
        self.assertEqual(api.calls[1][1], "/data-operations/order-sync/runs/run-unclosed/fail")
        self.assertIn("PROCESS_EXIT", api.calls[1][2]["errorMessage"])

    def test_process_failure_does_not_duplicate_alert_when_run_already_closed(self):
        class FakeApi:
            calls = []
            def call(self, method, path, body=None):
                self.calls.append((method, path, body))
                return None

        api = FakeApi()
        self.assertFalse(sync.report_unclosed_run(api, "tplus-kejia"))
        self.assertEqual(len(api.calls), 1)

    def test_tplus_receipt_can_trace_sales_order_through_manufacture_order(self):
        source = SimpleNamespace(adapter="tplus")
        _, _, sql = sync.init_sql(source, "inbound_detail")

        self.assertIn("dbo.MP_ManufactureOrder m ON m.ID=d.ManufactureOrderId", sql)
        self.assertIn("dbo.SA_SaleOrder mo_h ON mo_h.ID=m.saleOrderId", sql)
        self.assertIn("COALESCE(direct_h.ID,mo_h.ID,code_h.ID)", sql)
        self.assertIn("exact_d.idinventory=d.idinventory", sql)
        self.assertNotIn("r.isCancel", sql)
        self.assertIn("CAST(0 AS bit) is_cancelled", sql)
        self.assertIn("TPLUS_MANUFACTURE_ORDER_SALE_ORDER", sql)
        self.assertIn("m.code manufacturing_order_code", sql)

    def test_tplus_receipt_projection_preserves_cancellation_and_signed_quantity(self):
        source = SimpleNamespace(adapter="tplus", system="T+", database="synthetic")
        cancelled = sync.record(source, "inbound_detail", "ST_RDRecord_b", {
            "source_id": 1, "quantity": Decimal("-2.5"), "is_cancelled": 1,
            "status_code": "189", "link_stable": 0, "link_rule": "TPLUS_UNRESOLVED",
        })

        self.assertTrue(cancelled["isCancelled"])
        self.assertEqual(cancelled["quantity"], "-2.5")
        self.assertEqual(cancelled["linkRule"], "TPLUS_UNRESOLVED")

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

    def test_incremental_builder_ignores_nested_where_in_select_expression(self):
        source = SimpleNamespace(adapter="tplus")
        _, _, sql = sync.incremental_sql(source, "inbound_detail")

        self.assertIn("EXISTS(SELECT 1 FROM dbo.SA_SaleOrder_b exact_d WHERE", sql)
        self.assertIn("LEFT JOIN dbo.AA_InventoryEntity i", sql)
        self.assertIn("WHERE d.updated IS NOT NULL AND r.rdDirectionFlag=1", sql)
        self.assertTrue(sql.endswith("ORDER BY d.updated,d.ID"))

    def test_outer_where_parser_respects_quotes_and_parentheses(self):
        sql = "SELECT CASE WHEN EXISTS(SELECT 1 WHERE x=1) THEN N'WHERE' ELSE N'' END x FROM t WHERE y=2"
        self.assertEqual(sync.select_projection_before_outer_where(sql),
                         "SELECT CASE WHEN EXISTS(SELECT 1 WHERE x=1) THEN N'WHERE' ELSE N'' END x FROM t")

    def test_incremental_stream_failure_does_not_skip_independent_streams_or_complete_run(self):
        now = datetime(2026, 11, 18, 9, 0)
        class FakeSource:
            adapter = "tplus"
            key = "tplus-kejia"
            system = "T+"
            database = "synthetic"
            config = {"account_name": "synthetic", "field_mapping": {"businessDate": "d", "modifiedAt": "u", "primaryKey": "id"}}
            calls = []
            def now(self): return now
            def query(self, sql, params=()):
                stream = "inbound_detail" if "r.rdDirectionFlag=1" in sql else next((name for name in ["outbound_detail", "order_header", "order_detail", "inventory"] if sync.incremental_sql(self, name)[2] == sql), "unknown")
                self.calls.append(stream)
                if stream == "inbound_detail": raise RuntimeError("schema failure")
                return []
        class FakeApi:
            last_run = None
            calls = []
            def call(self, method, path, body=None):
                self.calls.append((method, path, body))
                if path.endswith("/sources/tplus-kejia"):
                    return {"source_snapshot_at": "2026-11-18T08:00:00", "cursors": []}
                if path == "/data-operations/order-sync/runs":
                    self.last_run = {"id": "run-1", "scan_upper_bound": now.isoformat()}
                    return {"run": self.last_run, "lastBatchByStream": {}}
                return {"ok": True}
        source=FakeSource();api=FakeApi()
        with self.assertRaisesRegex(RuntimeError, "inbound_detail"):
            sync.incremental(source,api)
        self.assertEqual(set(source.calls), {"order_header", "order_detail", "outbound_detail", "inbound_detail", "inventory"})
        posted=[path for method,path,_ in api.calls if method=="POST"]
        self.assertTrue(any(path.endswith("/runs/run-1/fail") for path in posted))
        self.assertFalse(any(path.endswith("/runs/run-1/complete") for path in posted))

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
        for source in sources:
            if source["adapter"] == "tplus":
                self.assertNotIn("isCancel", source["field_mapping"]["status"])
                self.assertIn("voucherState=189", source["field_mapping"]["status"])

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
