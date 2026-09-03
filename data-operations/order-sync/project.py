#!/usr/bin/env python3
"""Drain one PostgreSQL ERP projection consumer through its Application Command API."""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
CONSUMERS = {"sales-orders-v1", "finished-goods-inbound-v1", "finished-goods-outbound-v1"}


def project(consumer: str) -> dict:
    load_dotenv(ROOT / ".env", override=False)
    base = os.getenv("KNPLAN_API_URL", "http://127.0.0.1:15172/api/v1").rstrip("/")
    token = os.getenv("KNPLAN_ORDER_SYNC_API_KEY") or os.getenv("KNPLAN_TPLUS_API_KEY")
    if not token:
        raise RuntimeError("缺少 KNPLAN_ORDER_SYNC_API_KEY（或兼容 KNPLAN_TPLUS_API_KEY）")
    batches = records = retries = 0
    started = time.perf_counter()
    while True:
        request = Request(
            f"{base}/data-operations/order-sync/projection-consumers/{consumer}/project",
            data=b"{}",
            method="POST",
            headers={"X-API-Key": token, "Content-Type": "application/json", "X-Request-ID": f"erp-project-{consumer}-{time.time_ns()}"},
        )
        result = None
        for attempt in range(5):
            try:
                with urlopen(request, timeout=300) as response:
                    result = json.loads(response.read() or b"{}")
                break
            except HTTPError as error:
                detail = error.read().decode(errors="replace")[:2000]
                if error.code < 500 or attempt == 4:
                    raise RuntimeError(f"KDOS API {error.code}: {detail}") from error
            except (URLError, TimeoutError, ConnectionError, OSError) as error:
                if attempt == 4:
                    raise RuntimeError(f"KDOS API 网络请求失败: {error}") from error
            retries += 1
            time.sleep(min(30, 2 ** attempt))
        if result is None:
            raise RuntimeError("KDOS API 未返回投影结果")
        processed = int(result.get("processed", 0))
        if not processed:
            break
        batches += 1
        records += processed
    return {"event": "erp_projection_completed", "consumer": consumer, "batches": batches, "records": records, "retries": retries,
            "durationMs": round((time.perf_counter() - started) * 1000, 3)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--consumer", required=True, choices=sorted(CONSUMERS))
    args = parser.parse_args()
    print(json.dumps(project(args.consumer), ensure_ascii=False))


if __name__ == "__main__":
    main()
