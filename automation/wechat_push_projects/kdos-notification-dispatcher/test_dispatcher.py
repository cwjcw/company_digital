import importlib.util
import os
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("dispatcher.py")
SPEC = importlib.util.spec_from_file_location("kdos_notification_dispatcher", MODULE_PATH)
dispatcher = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules["kdos_notification_dispatcher"] = dispatcher
SPEC.loader.exec_module(dispatcher)


class FakePusher:
    def __init__(self, response=None):
        self.response = response or {"errcode": 0, "errmsg": "ok", "msgid": "msg-1"}
        self.calls = []

    def send_app_text(self, content, touser):
        self.calls.append((content, touser))
        return self.response


class DispatcherTest(unittest.TestCase):
    def config(self, **kwargs):
        values = {
            "api_base_url": "http://api",
            "token": "secret",
            "tenant_id": "KAINAN",
            "worker_id": "test-worker",
            "allowed_recipient_name": "崔玮杰",
            "allowed_user_id": "",
        }
        values.update(kwargs)
        return dispatcher.DispatcherConfig(**values)

    def notification(self):
        return {
            "notificationId": "notification-1",
            "content": "设备故障提醒",
            "recipients": [
                {"deliveryId": "delivery-cui", "userId": "user-cui", "displayName": "崔玮杰", "wechatUserId": "wx-cui"},
                {"deliveryId": "delivery-other", "userId": "user-other", "displayName": "其他人", "wechatUserId": "wx-other"},
            ],
        }

    def test_actual_test_recipient_reaches_wechat_and_business_recipient_is_not_sent(self):
        calls = []
        pusher = FakePusher()

        def http_post(path, body):
            calls.append((path, body))
            return {"notifications": [self.notification()]} if path.endswith("/claim") else {}

        result = dispatcher.KdosNotificationDispatcher(self.config(), http_post, pusher).run_once()
        self.assertEqual(result, {"claimed": 1, "sent": 1, "failed": 0, "skipped": 1})
        self.assertEqual(pusher.calls, [("设备故障提醒", "wx-cui")])
        self.assertEqual(calls[-1][0], "/internal/notifications/notification-1/failure")
        self.assertEqual(calls[-1][1]["errcode"], "RECIPIENT_TARGET_MISMATCH")

    def test_one_actual_test_message_carries_multiple_business_delivery_ids(self):
        calls = []
        pusher = FakePusher()
        notification = {
            "notificationId": "notification-1",
            "content": "设备故障提醒",
            "recipients": [{
                "deliveryId": "delivery-1",
                "deliveryIds": ["delivery-1", "delivery-2", "delivery-3"],
                "userId": "user-cui",
                "displayName": "崔玮杰",
                "wechatUserId": "wx-cui",
                "testMode": True,
                "resolvedRecipientUserIds": ["zhang", "li", "wang"],
            }],
        }

        def http_post(path, body):
            calls.append((path, body))
            return {"notifications": [notification]} if path.endswith("/claim") else {}

        result = dispatcher.KdosNotificationDispatcher(self.config(), http_post, pusher).run_once()
        self.assertEqual(result, {"claimed": 1, "sent": 1, "failed": 0, "skipped": 0})
        self.assertEqual(len(pusher.calls), 1)
        self.assertEqual(calls[-1][1]["deliveryIds"], ["delivery-1", "delivery-2", "delivery-3"])

    def test_wechat_failure_is_reported_for_retry(self):
        calls = []
        pusher = FakePusher({"errcode": 500, "errmsg": "temporary"})

        def http_post(path, body):
            calls.append((path, body))
            return {"notifications": [self.notification()]} if path.endswith("/claim") else {}

        result = dispatcher.KdosNotificationDispatcher(self.config(), http_post, pusher).run_once()
        self.assertEqual(result["failed"], 1)
        self.assertTrue(any(body.get("errcode") == "WECHAT_SEND_FAILED" for _, body in calls))

    def test_config_requires_token_and_recipient_gate(self):
        with self.assertRaisesRegex(RuntimeError, "TOKEN"):
            dispatcher.DispatcherConfig("http://api", "", "KAINAN", "worker", "崔玮杰", "")
        old = {key: os.environ.get(key) for key in ("KDOS_NOTIFICATION_INTERNAL_TOKEN", "KDOS_DISPATCHER_ALLOWED_RECIPIENT_NAME", "KDOS_DISPATCHER_ALLOWED_USER_ID")}
        try:
            os.environ["KDOS_NOTIFICATION_INTERNAL_TOKEN"] = "secret"
            os.environ.pop("KDOS_DISPATCHER_ALLOWED_RECIPIENT_NAME", None)
            os.environ.pop("KDOS_DISPATCHER_ALLOWED_USER_ID", None)
            with self.assertRaisesRegex(RuntimeError, "单人验证"):
                dispatcher.DispatcherConfig.from_env()
        finally:
            for key, value in old.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
