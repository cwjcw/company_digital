from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
import requests


class KdosImportClient:
    def __init__(self, project_root: Path):
        load_dotenv(project_root / ".env", override=False)
        self.base_url = os.getenv("KNPLAN_API_BASE_URL", "http://127.0.0.1:15172/api/v1").rstrip("/")
        self.api_key = os.getenv("KNPLAN_CUSTOMER_IMPORT_API_KEY") or os.getenv("KNPLAN_TPLUS_API_KEY")
        if not self.api_key:
            raise RuntimeError("缺少 KNPLAN_CUSTOMER_IMPORT_API_KEY 或 KNPLAN_TPLUS_API_KEY")

    def import_snapshot(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        response = requests.post(
            f"{self.base_url}/data-operations/customer-imports/snapshot",
            headers={"X-API-Key": self.api_key, "X-Request-Id": snapshot["idempotencyKey"]},
            json=snapshot, timeout=(30, 1800),
        )
        try:
            payload = response.json()
        except ValueError:
            payload = {"message": response.text[:1000]}
        if not response.ok:
            message = payload.get("message") if isinstance(payload, dict) else payload
            detail = payload.get("detail") if isinstance(payload, dict) else None
            suffix = f"；详情：{detail}" if detail else ""
            raise RuntimeError(f"KDOS 导入失败（HTTP {response.status_code}）：{message}{suffix}")
        return payload
