from __future__ import annotations

from datetime import datetime
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("simulate.py")
SPEC = importlib.util.spec_from_file_location("order_sync_simulator", MODULE_PATH)
assert SPEC and SPEC.loader
simulator = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = simulator
SPEC.loader.exec_module(simulator)


class FakeSession:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def query(self, query, parameters=()):
        self.calls.append((query, parameters))
        return self.rows


class SimulatorTests(unittest.TestCase):
    def test_read_only_guard_rejects_writes_and_batches(self):
        simulator.assert_read_only_query("SELECT 1")
        for query in (
            "UPDATE dbo.t SET x=1",
            "SELECT 1; DELETE FROM dbo.t",
            "CREATE TABLE dbo.t(id int)",
            "EXEC dbo.proc",
        ):
            with self.assertRaises(ValueError, msg=query):
                simulator.assert_read_only_query(query)

    def test_all_stream_queries_are_single_selects_and_limited(self):
        streams = (*simulator._e10_queries(), *simulator._tplus_queries())
        self.assertEqual(10, len(streams))
        for stream in streams:
            query = stream.query.format(limit=1_000).strip()
            simulator.assert_read_only_query(query)
            self.assertIn("TOP (1000)", query)
            self.assertRegex(query, r"updated|LastModifiedDate")
            self.assertIn("ORDER BY", query)

    def test_overlap_and_composite_cursor_advance_from_last_ordered_row(self):
        stream = simulator._tplus_queries()[0]
        rows = [
            {
                "source_system": "T+", "source_database": "db", "source_table": "SA_SaleOrder",
                "source_id": "11", "source_order_id": "11", "source_order_line_id": None,
                "order_number": "SO11", "modified_at": datetime(2026, 8, 31, 10, 1),
            },
            {
                "source_system": "T+", "source_database": "db", "source_table": "SA_SaleOrder",
                "source_id": "12", "source_order_id": "12", "source_order_line_id": None,
                "order_number": "SO12", "modified_at": datetime(2026, 8, 31, 10, 2),
            },
        ]
        session = FakeSession(rows)
        previous = {"modified_at": "2026-08-31T10:00:00.000000", "primary_key": "10", "initialized": True}
        summary, records, next_cursor = simulator.simulate_stream(
            session, stream, previous, 2, 2, datetime(2026, 8, 31, 10, 5)
        )
        self.assertEqual(datetime(2026, 8, 31, 9, 58), session.calls[0][1][0])
        self.assertEqual(int(stream.minimum_primary_key), session.calls[0][1][2])
        self.assertEqual("2026-08-31T10:02:00.000000", next_cursor["modified_at"])
        self.assertEqual("12", next_cursor["primary_key"])
        self.assertFalse(summary["time_boundary_gap_risk"])
        self.assertFalse(summary["duplicate_record_detected"])
        self.assertEqual(2, len(records))

    def test_exhausted_nonempty_batch_advances_to_safe_server_upper_bound(self):
        row = {
            "source_system": "T+", "source_database": "db", "source_table": "SA_SaleOrder",
            "source_id": "11", "source_order_id": "11", "source_order_line_id": None,
            "order_number": "SO11", "modified_at": datetime(2026, 8, 31, 10, 1),
        }
        previous = {"modified_at": "2026-08-31T10:00:00.000000", "primary_key": "10", "initialized": True}
        upper_bound = datetime(2026, 8, 31, 10, 5)
        _, _, next_cursor = simulator.simulate_stream(
            FakeSession([row]), simulator._tplus_queries()[0], previous, 1000, 2, upper_bound
        )
        self.assertEqual("2026-08-31T10:05:00.000000", next_cursor["modified_at"])
        self.assertEqual("-2147483648", next_cursor["primary_key"])

    def test_duplicate_ids_are_reported(self):
        row = {
            "source_system": "T+", "source_database": "db", "source_table": "SA_SaleOrder",
            "source_id": "11", "source_order_id": "11", "source_order_line_id": None,
            "order_number": "SO11", "modified_at": datetime(2026, 8, 31, 10, 1),
        }
        previous = {"modified_at": "2026-08-31T10:00:00.000000", "primary_key": "10", "initialized": True}
        summary, _, _ = simulator.simulate_stream(
            FakeSession([row, dict(row)]), simulator._tplus_queries()[0], previous, 1000, 2,
            datetime(2026, 8, 31, 10, 5)
        )
        self.assertTrue(summary["duplicate_record_detected"])
        self.assertTrue(summary["duplicate_within_batch_detected"])
        self.assertEqual(["11"], summary["duplicate_source_ids"])

    def test_empty_batch_advances_to_safe_server_upper_bound(self):
        previous = {"modified_at": "2026-08-31T10:00:00.000000", "primary_key": "10", "initialized": True}
        upper_bound = datetime(2026, 8, 31, 10, 5)
        _, _, next_cursor = simulator.simulate_stream(
            FakeSession([]), simulator._tplus_queries()[0], previous, 1000, 2, upper_bound
        )
        self.assertEqual("2026-08-31T10:05:00.000000", next_cursor["modified_at"])
        self.assertEqual("-2147483648", next_cursor["primary_key"])

    def test_report_files_contain_only_allowed_record_payload(self):
        report = {
            "run_id": "test-run",
            "sources": [{
                "source_key": "e10", "source_system": "E10", "source_database": "db",
                "configured_database": "db", "tables": [],
                "records": [{"stream": "inventory", **{
                    field: ({"source_system": "E10", "source_database": "db", "source_table": "ITEM_WAREHOUSE",
                             "source_id": "1", "source_order_id": None, "source_order_line_id": None,
                             "order_number": None, "modified_at": "2026-08-31T10:00:00.000000"})[field]
                    for field in simulator.OUTPUT_FIELDS
                }}],
            }],
        }
        with tempfile.TemporaryDirectory() as value:
            paths = simulator.save_reports(report, Path(value))
            loaded = json.loads(Path(paths["json"]).read_text(encoding="utf-8"))
            record = loaded["sources"][0]["records"][0]
            self.assertEqual({"stream", *simulator.OUTPUT_FIELDS}, set(record))
            self.assertTrue(Path(paths["records_csv"]).exists())
            self.assertTrue(Path(paths["tables_csv"]).exists())

    def test_limit_cannot_exceed_1000(self):
        with self.assertRaises(SystemExit):
            simulator.parse_args(["--limit", "1001"])

    def test_e10_configuration_does_not_require_tplus_environment(self):
        with tempfile.TemporaryDirectory() as value, patch.dict(os.environ, {}, clear=True):
            configs = simulator.load_source_configs(Path(value), required_sources=["e10"])
        self.assertEqual(["e10"], list(configs))


if __name__ == "__main__":
    unittest.main()
