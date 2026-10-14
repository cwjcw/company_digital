#!/usr/bin/env python3
"""KDOS notification outbox adapter.

This process owns only HTTP polling and the final WeCom call. It deliberately
does not connect to PostgreSQL, resolve business recipients, or contain a
recipient list. The API claim response is the authoritative delivery list.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import signal
import sys
import threading
import tempfile
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASIC_CODE_ROOT = Path("/data/automation/code/work/basci/basic_code")
LOGGER = logging.getLogger("kdos-notification-dispatcher")


@dataclass(frozen=True)
class DispatcherConfig:
    api_base_url: str
    token: str
    tenant_id: str
    worker_id: str

    def __post_init__(self) -> None:
        if not self.token:
            raise RuntimeError("缺少 KDOS_NOTIFICATION_INTERNAL_TOKEN，拒绝运行")
        if not self.tenant_id or not self.worker_id:
            raise RuntimeError("租户或 worker 配置无效")

    @classmethod
    def from_env(cls) -> "DispatcherConfig":
        config = cls(
            api_base_url=os.getenv("KDOS_API_BASE_URL", "http://127.0.0.1/api/v1").rstrip("/"),
            token=os.getenv("KDOS_NOTIFICATION_INTERNAL_TOKEN", "").strip(),
            tenant_id=os.getenv("KDOS_DEFAULT_TENANT_CODE", "KAINAN").strip(),
            worker_id=os.getenv("KDOS_NOTIFICATION_WORKER_ID", socket.gethostname()).strip(),
        )
        return config


class KdosNotificationDispatcher:
    def __init__(
        self,
        config: DispatcherConfig,
        http_post: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
        pusher: Any | None = None,
        receipt_dir: Path | None = None,
    ):
        self.config = config
        self.http_post = http_post or self._post_json
        self.pusher = pusher
        self.receipt_dir = receipt_dir or Path(os.getenv("KDOS_NOTIFICATION_RECEIPT_DIR", str(Path(__file__).resolve().parents[3] / "data" / "notification-delivery-receipts")))

    def run_once(self, limit: int = 10) -> dict[str, int]:
        claim = self.http_post("/internal/notifications/claim", {"limit": max(1, min(int(limit), 20))})
        notifications = claim.get("notifications", claim if isinstance(claim, list) else [])
        sent = 0
        failed = 0
        for notification in notifications:
            try:
                notification_id = str(notification.get("notificationId", ""))
                content = str(notification.get("content", ""))
                if not notification_id or not content:
                    continue
                for recipient in notification.get("recipients", []):
                    delivery_id = str(recipient.get("deliveryId", ""))
                    if not delivery_id:
                        continue
                    delivered = False
                    try:
                        receipt = self._read_receipt(delivery_id)
                        message_type = notification.get("messageType", "text")
                        if receipt is not None:
                            response = receipt
                        elif message_type == "file":
                            attachment = notification.get("attachment", {})
                            download_path = str(attachment.get("downloadPath", ""))
                            filename = str(attachment.get("filename", ""))
                            if not re.fullmatch(r"/internal/notifications/[a-f0-9-]+/attachments/[a-f0-9-]+", download_path) or not re.fullmatch(r"[A-Za-z0-9_.-]+\.xlsx", filename):
                                raise RuntimeError("通知附件标识无效")
                            data = self._get_attachment(download_path)
                            with tempfile.TemporaryDirectory(prefix="kdos-notification-") as temp_dir:
                                target = Path(temp_dir) / filename
                                target.write_bytes(data)
                                target.chmod(0o600)
                                response = self._get_pusher().send_app_file(str(target), touser=str(recipient["wechatUserId"]))
                        elif message_type == "text":
                            response = self._get_pusher().send_app_text(content, touser=str(recipient["wechatUserId"]))
                        else:
                            raise RuntimeError("通知消息格式不支持")
                        if int(response.get("errcode", 0)) != 0:
                            raise RuntimeError(str(response.get("errmsg", "企业微信返回失败")))
                        self._write_receipt(delivery_id, response)
                        delivered = True
                        self.http_post(f"/internal/notifications/{notification_id}/success", {
                            "deliveryId": delivery_id,
                            "providerMessageId": response.get("msgid"),
                            "errcode": str(response.get("errcode", 0)),
                            "errmsg": response.get("errmsg"),
                        })
                        sent += 1
                    except Exception as exc:  # noqa: BLE001 - the delivery must be reported for retry
                        if delivered:
                            # Provider success must survive an unavailable API callback.
                            # Reclaimed PENDING attempts reuse this delivery ID and receipt.
                            LOGGER.error("成功投递回执暂未确认 notification=%s delivery=%s", notification_id, delivery_id)
                        else:
                            self._report_failure(notification_id, delivery_id, "WECHAT_SEND_FAILED", re.sub(r"(access_token|token|secret|password)=[^\s&]+", r"\1=[redacted]", str(exc)))
                        failed += 1
            except Exception:  # noqa: BLE001 - one malformed notification must not stop the batch
                LOGGER.exception("处理通知 %s 失败，继续处理下一条", notification.get("notificationId"))
                failed += 1
        return {"claimed": len(notifications), "sent": sent, "failed": failed}

    def run_forever(self, limit: int = 10, poll_interval: float = 1.0, stop_event: threading.Event | None = None) -> None:
        """常驻轮询；单次 API/消息异常只记录并等待下一轮，不退出进程。"""
        event = stop_event or threading.Event()
        while not event.is_set():
            try:
                result = self.run_once(limit)
                LOGGER.info("通知轮询完成：%s", result)
            except Exception:  # noqa: BLE001 - transient API/network failures are expected
                LOGGER.exception("通知轮询失败，%ss 后继续", poll_interval)
            event.wait(max(0.1, poll_interval))

    def _receipt_path(self, delivery_id: str) -> Path | None:
        if not re.fullmatch(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}", delivery_id):
            return None
        self.receipt_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        return self.receipt_dir / f"{delivery_id}.json"

    def _read_receipt(self, delivery_id: str) -> dict[str, Any] | None:
        path = self._receipt_path(delivery_id)
        if path is None or not path.exists():
            return None
        return json.loads(path.read_text())

    def _write_receipt(self, delivery_id: str, response: dict[str, Any]) -> None:
        path = self._receipt_path(delivery_id)
        if path is None:
            return
        # Receipt stores only provider status/ID, never text or business rows.
        safe = {key: response.get(key) for key in ("errcode", "errmsg", "msgid")}
        with tempfile.NamedTemporaryFile(dir=self.receipt_dir, delete=False, mode="w") as tmp:
            json.dump(safe, tmp)
            tmp.flush()
            os.fsync(tmp.fileno())
            temp_path = Path(tmp.name)
        temp_path.chmod(0o600)
        temp_path.replace(path)

    def _get_attachment(self, path: str) -> bytes:
        request = Request(self.config.api_base_url + path, headers={
            "x-kdos-internal-token": self.config.token,
            "x-kdos-tenant-id": self.config.tenant_id,
            "x-kdos-worker-id": self.config.worker_id,
        })
        with urlopen(request, timeout=30) as response:
            data = response.read(20 * 1024 * 1024 + 1)
            if len(data) > 20 * 1024 * 1024 or not data.startswith(b"PK"):
                raise RuntimeError("通知附件无效或超出20MB")
            return data

    def _get_pusher(self) -> Any:
        if self.pusher is None:
            sys.path.insert(0, str(BASIC_CODE_ROOT))
            from wechat import WeChatPusher

            self.pusher = WeChatPusher()
        return self.pusher

    def _report_failure(self, notification_id: str, delivery_id: str, code: str, message: str) -> None:
        self.http_post(f"/internal/notifications/{notification_id}/failure", {
            "deliveryId": delivery_id,
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
    logging.basicConfig(level=os.getenv("KDOS_DISPATCHER_LOG_LEVEL", "INFO").upper(), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="领取 KDOS 通知并通过企业微信发送")
    parser.add_argument("--once", action="store_true", help="只执行一次轮询后退出；默认进入常驻模式")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--interval", type=float, default=float(os.getenv("KDOS_DISPATCHER_POLL_INTERVAL", "1")))
    args = parser.parse_args()
    dispatcher = KdosNotificationDispatcher(DispatcherConfig.from_env())
    if args.once:
        print(json.dumps(dispatcher.run_once(args.limit), ensure_ascii=False))
        return 0
    stop_event = threading.Event()
    def stop(_signum: int, _frame: Any) -> None:
        LOGGER.info("收到停止信号，等待当前轮询结束")
        stop_event.set()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    dispatcher.run_forever(args.limit, args.interval, stop_event)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
