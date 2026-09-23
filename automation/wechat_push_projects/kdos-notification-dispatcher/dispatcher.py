#!/usr/bin/env python3
"""KDOS notification outbox adapter.

This process owns only HTTP polling and the final WeCom call. It deliberately
does not connect to PostgreSQL, resolve business recipients, or contain a
recipient list. A deployment must set the single-recipient validation gate
before ``--once`` can send anything.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASIC_CODE_ROOT = Path("/data/automation/code/work/basci/basic_code")


@dataclass(frozen=True)
class DispatcherConfig:
    api_base_url: str
    token: str
    tenant_id: str
    worker_id: str
    allowed_recipient_name: str
    allowed_user_id: str

    def __post_init__(self) -> None:
        if not self.token:
            raise RuntimeError("缺少 KDOS_NOTIFICATION_INTERNAL_TOKEN，拒绝运行")
        if not self.allowed_recipient_name and not self.allowed_user_id:
            raise RuntimeError("缺少单人验证接收人门禁，拒绝发送")
        if not self.tenant_id or not self.worker_id:
            raise RuntimeError("租户或 worker 配置无效")

    @classmethod
    def from_env(cls) -> "DispatcherConfig":
        config = cls(
            api_base_url=os.getenv("KDOS_API_BASE_URL", "http://127.0.0.1/api/v1").rstrip("/"),
            token=os.getenv("KDOS_NOTIFICATION_INTERNAL_TOKEN", "").strip(),
            tenant_id=os.getenv("KDOS_DEFAULT_TENANT_CODE", "KAINAN").strip(),
            worker_id=os.getenv("KDOS_NOTIFICATION_WORKER_ID", socket.gethostname()).strip(),
            allowed_recipient_name=os.getenv("KDOS_DISPATCHER_ALLOWED_RECIPIENT_NAME", "").strip(),
            allowed_user_id=os.getenv("KDOS_DISPATCHER_ALLOWED_USER_ID", "").strip(),
        )
        return config


class KdosNotificationDispatcher:
    def __init__(
        self,
        config: DispatcherConfig,
        http_post: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
        pusher: Any | None = None,
    ):
        self.config = config
        self.http_post = http_post or self._post_json
        self.pusher = pusher

    def run_once(self, limit: int = 10) -> dict[str, int]:
        claim = self.http_post("/internal/notifications/claim", {"limit": max(1, min(int(limit), 20))})
        notifications = claim.get("notifications", claim if isinstance(claim, list) else [])
        sent = 0
        failed = 0
        skipped = 0
        for notification in notifications:
            notification_id = str(notification.get("notificationId", ""))
            content = str(notification.get("content", ""))
            if not notification_id or not content:
                continue
            for recipient in notification.get("recipients", []):
                delivery_id = str(recipient.get("deliveryId", ""))
                if not delivery_id:
                    continue
                if not self._allowed(recipient):
                    self._report_failure(notification_id, delivery_id, recipient.get("deliveryIds", []), "RECIPIENT_TARGET_MISMATCH", "Dispatcher 实际接收人未通过 TEST MODE 单人门禁")
                    skipped += 1
                    continue
                try:
                    response = self._get_pusher().send_app_text(content, touser=str(recipient["wechatUserId"]))
                    if int(response.get("errcode", 0)) != 0:
                        raise RuntimeError(str(response.get("errmsg", "企业微信返回失败")))
                    self.http_post(f"/internal/notifications/{notification_id}/success", {
                        "deliveryId": delivery_id,
                        "deliveryIds": recipient.get("deliveryIds", []),
                        "providerMessageId": response.get("msgid"),
                        "errcode": str(response.get("errcode", 0)),
                        "errmsg": response.get("errmsg"),
                    })
                    sent += 1
                except Exception as exc:  # noqa: BLE001 - the delivery must be reported for retry
                    self._report_failure(notification_id, delivery_id, recipient.get("deliveryIds", []), "WECHAT_SEND_FAILED", str(exc))
                    failed += 1
        return {"claimed": len(notifications), "sent": sent, "failed": failed, "skipped": skipped}

    def _allowed(self, recipient: dict[str, Any]) -> bool:
        return (
            bool(self.config.allowed_recipient_name and recipient.get("displayName") == self.config.allowed_recipient_name)
            or bool(self.config.allowed_user_id and recipient.get("userId") == self.config.allowed_user_id)
        )

    def _get_pusher(self) -> Any:
        if self.pusher is None:
            sys.path.insert(0, str(BASIC_CODE_ROOT))
            from wechat import WeChatPusher

            self.pusher = WeChatPusher()
        return self.pusher

    def _report_failure(self, notification_id: str, delivery_id: str, delivery_ids: list[Any], code: str, message: str) -> None:
        self.http_post(f"/internal/notifications/{notification_id}/failure", {
            "deliveryId": delivery_id,
            "deliveryIds": delivery_ids,
            "errcode": code,
            "errmsg": message[:4000],
        })

    def _post_json(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        request = Request(
            f"{self.config.api_base_url}{path}",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-KDOS-Internal-Token": self.config.token,
                "X-KDOS-Tenant-Id": self.config.tenant_id,
                "X-KDOS-Worker-Id": self.config.worker_id,
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=30) as response:  # noqa: S310 - URL is deployment configuration
                payload = json.loads(response.read().decode("utf-8"))
                return payload if isinstance(payload, dict) else {"notifications": payload}
        except (HTTPError, URLError) as exc:
            raise RuntimeError(f"KDOS 内部通知 API 调用失败：{exc}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="领取 KDOS 通知并通过企业微信发送")
    parser.add_argument("--once", action="store_true", help="执行一次轮询；未指定时也只执行一次")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()
    result = KdosNotificationDispatcher(DispatcherConfig.from_env()).run_once(args.limit)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
