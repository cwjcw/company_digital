#!/usr/bin/env python3
"""Read the verified E10 customer master; all KDOS writes use Application Commands."""
from __future__ import annotations
import argparse
import contextlib
import csv
import hashlib
import io
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
SOURCE_TABLE = "dbo.CUSTOMER"
SEED = Path(__file__).parent / "seeds/finance_customer_mapping_seed.csv"


def seed_rows():
    with SEED.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != ["客户编号", "部门类别", "内外区分"]:
            raise ValueError("Invalid seed headers")
        rows = [{"customerCode": r["客户编号"], "departmentCategory": r["部门类别"], "salesChannel": r["内外区分"]} for r in reader]
    if len(rows) != 138 or len({r["customerCode"] for r in rows}) != 138:
        raise ValueError("Expected 138 distinct seed customers")
    return rows


def minimum_source_date():
    policy = json.loads((ROOT / "packages/contracts/src/finance-sync-policy.json").read_text())
    value = policy["minimumSourceDate"]
    if datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d") != value:
        raise ValueError("Invalid source date policy")
    return value


def source_rows():
    # basic_code owns E10 secrets. Suppress connection diagnostics (they may include credentials).
    logging.disable(logging.CRITICAL)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        from basic_code import MSSQLDatabase
        db = MSSQLDatabase()
        cutoff = minimum_source_date()
        frame = db.get_from_query(f"""SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
            SELECT CUSTOMER_CODE customer_code,
              CONVERT(varchar(33),CreateDate,126) created_at_source,
              CONVERT(varchar(33),LastModifiedDate,126) modified_at_source
            FROM dbo.CUSTOMER
            WHERE CreateDate >= CONVERT(datetime2,'{cutoff}T00:00:00',126)
               OR LastModifiedDate >= CONVERT(datetime2,'{cutoff}T00:00:00',126)
            ORDER BY CUSTOMER_CODE""")
    values = frame["customer_code"].tolist()
    if any(not isinstance(v, str) or not v.strip() for v in values):
        raise ValueError("E10 master contains an invalid customer code")
    return [{"customerCode": row["customer_code"].strip(),
             "createdAtSource": row["created_at_source"] if isinstance(row["created_at_source"], str) else None,
             "modifiedAtSource": row["modified_at_source"] if isinstance(row["modified_at_source"], str) else None}
            for row in frame.to_dict("records")]


def main():
    args = argparse.ArgumentParser(description="Finance customer seed / daily E10 master synchronization")
    args.add_argument("--seed", action="store_true")
    args.add_argument("--dry-run", action="store_true")
    opts = args.parse_args()
    load_dotenv(ROOT / "data/finance-customer-sync.env", override=False)
    url = os.getenv("KDOS_FINANCE_API_URL", "http://127.0.0.1:15172/api/v1").rstrip("/")
    # One installation / tenant. The API resolves tenant from authenticated deployment, never payload.
    key = os.getenv("KDOS_FINANCE_API_KEY")
    headers = {"X-API-Key": key or ""}
    start = datetime.now(timezone.utc).isoformat()
    http_status = None
    try:
        rows = seed_rows() if opts.seed else source_rows()
        kind = "INITIAL_IMPORT" if opts.seed else "E10_SYNC"
        if opts.dry_run:
            print(json.dumps({"status": "DRY_RUN", "source": kind, "table": SOURCE_TABLE if not opts.seed else None, "read": len(rows), "distinct": len({r["customerCode"] for r in rows}), "minimumSourceDate": None if opts.seed else minimum_source_date()}))
            return 0
        if not key:
            raise ValueError("Finance runtime API key is not configured")
        # A replay of this invocation is insert-only. Retries keep exactly the same JSON.
        digest = hashlib.sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]
        run_key = f"seed:{digest}" if opts.seed else f"e10:{start[:10]}:{digest}"
        payload = {"source": kind, "rows": rows, "runKey": run_key, "startedAt": start}
        last_response = None
        for _ in range(3):
            try:
                last_response = requests.post(f"{url}/finance/customer-mappings/ingest", headers=headers, json=payload, timeout=(10, 120))
                http_status = last_response.status_code
                if last_response.ok:
                    result = last_response.json()
                    print(json.dumps({"status": "SUCCESS", "source": kind, **result}))
                    return 0
                if last_response.status_code < 500:
                    break
            except requests.RequestException:
                continue
        raise RuntimeError("Finance ingestion failed")
    except Exception as error:
        # Never print exception text: upstream driver/API diagnostics may expose secrets or rows.
        if key and not opts.dry_run and not opts.seed:
            try:
                requests.post(f"{url}/finance/customer-mappings/sync-failure", headers=headers, timeout=(10, 30))
            except requests.RequestException:
                pass
        print(json.dumps({"status": "FAILED", "errorType": type(error).__name__, "httpStatus": http_status, "stage": "INITIAL_IMPORT" if opts.seed else "E10_SYNC"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
