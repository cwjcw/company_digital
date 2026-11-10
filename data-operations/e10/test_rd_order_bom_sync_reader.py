"""Offline tests for E10 BOM CT event classification; no E10 writes or credentials."""
from __future__ import annotations

import contextlib
import io
import json
import unittest

import rd_order_bom_sync_reader as reader


class FakeRepository:
    def __init__(self, changes):
        self.changes = list(changes)
        self.change_reads = 0
        self.queries = []
        self.parameters = []

    def _query(self, sql, params=None):
        self.queries.append(sql)
        self.parameters.append(params)
        if "CHANGE_TRACKING_MIN_VALID_VERSION" in sql:
            return [{"version": 10}]
        if "FROM CHANGETABLE" in sql:
            self.change_reads += 1
            if self.change_reads == 1:
                return self.changes
            return []
        raise AssertionError("unexpected SQL source")


class FakeSnapshotRepository:
    def __init__(self):
        self.version_reads = 0
        self.snapshot_reads = 0
        self.snapshot_cursor = None

    def _query(self, sql, params=None):
        if "CHANGE_TRACKING_CURRENT_VERSION" in sql:
            self.version_reads += 1
            return [{"version": 10 if self.version_reads == 1 else 11}]
        if "CHANGE_TRACKING_MIN_VALID_VERSION" in sql:
            return [{"version": 5}]
        if "FROM CHANGETABLE" in sql:
            return []
        if "FROM dbo.BOM" in sql:
            self.snapshot_reads += 1
            if self.snapshot_reads == 1:
                return [{"source_bom_id": b"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}]
            self.snapshot_cursor = params[1]
            return []
        raise AssertionError("unexpected SQL source")


class ChangeTrackingReaderTests(unittest.TestCase):
    def run_changes(self, changes, from_version=15, target_version=20):
        repo = FakeRepository(changes)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            count = reader.stream_changes(repo, from_version, target_version, 100)
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        return count, events, repo

    def test_stream_includes_approval_revocation_and_physical_delete_events(self):
        rows = [
            {"change_version": 18, "change_operation": "I", "changed_bom_id": b"11111111-1111-4111-8111-111111111111", "source_bom_id": None, "approve_status": "Y"},
            {"change_version": 19, "change_operation": "U", "changed_bom_id": b"22222222-2222-4222-8222-222222222222", "source_bom_id": b"22222222-2222-4222-8222-222222222222", "approve_status": "N"},
            {"change_version": 20, "change_operation": "D", "changed_bom_id": b"33333333-3333-4333-8333-333333333333", "source_bom_id": None, "approve_status": None},
        ]
        count, events, repo = self.run_changes(rows)
        self.assertEqual(count, 3)
        self.assertEqual(events[0]["type"], "changes_begin")
        self.assertEqual([r["operation"] for r in events[1]["records"]], ["UPSERT", "REVOKE", "DELETE"])
        self.assertEqual(events[1]["records"][2]["source_bom_id"], rows[2]["changed_bom_id"].decode())
        self.assertEqual(repo.parameters[2][-1], rows[2]["changed_bom_id"].decode())
        self.assertTrue(all("BOM_D" not in sql for sql in repo.queries))

    def test_full_snapshot_decodes_binary_primary_key_before_next_page(self):
        repo = FakeSnapshotRepository()
        with contextlib.redirect_stdout(io.StringIO()):
            scanned, watermark = reader.stream_snapshot(repo, page_size=1)
        self.assertEqual((scanned, watermark), (1, 11))
        self.assertEqual(repo.snapshot_cursor, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")

    def test_retention_gap_fails_before_emitting_events(self):
        repo = FakeRepository([])
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, "CHANGE_TRACKING_RETENTION_GAP"):
                reader.stream_changes(repo, from_version=9, target_version=20, page_size=100)
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(repo.change_reads, 0)


if __name__ == "__main__":
    unittest.main()
