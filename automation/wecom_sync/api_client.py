import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ContactSyncApi:
    def __init__(self, base_url: str, credential_file: Path):
        self.base_url = base_url.rstrip("/")
        if not credential_file.exists():
            raise RuntimeError(f"同步 API Key 不存在，请先执行 main.py provision：{credential_file}")
        self.api_key = credential_file.read_text(encoding="utf-8").strip()
        if not self.api_key:
            raise RuntimeError("同步 API Key 文件为空")

    def _request(self, path: str, method: str = "GET", body: dict | None = None) -> dict:
        payload = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=payload,
            method=method,
            headers={"X-API-Key": self.api_key, "Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=180) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"KDOS API 返回 {error.code}：{detail}") from error
        except URLError as error:
            raise RuntimeError(f"无法连接 KDOS API：{error.reason}") from error

    def backup_snapshot(self) -> dict:
        return self._request("/integrations/wecom/contacts/snapshot")

    def sync(self, payload: dict, dry_run: bool = False) -> dict:
        suffix = "?dryRun=true" if dry_run else ""
        return self._request(f"/integrations/wecom/contacts/sync{suffix}", method="POST", body=payload)
