import importlib.util
import sys
import threading
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
        }
        values.update(kwargs)
        return dispatcher.DispatcherConfig(**values)

    def notification(self):
        return {
            "notificationId": "notification-1",
            "content": "设备故障提醒",
            "recipients": [
                {"deliveryId": "delivery-zhang", "userId": "user-zhang", "displayName": "张三", "wechatUserId": "wx-zhang"},
                {"deliveryId": "delivery-other", "userId": "user-other", "displayName": "其他人", "wechatUserId": "wx-other"},
            ],
        }

    def test_every_claimed_recipient_is_sent_separately(self):
        calls = []
        pusher = FakePusher()

        def http_post(path, body):
            calls.append((path, body))
            return {"notifications": [self.notification()]} if path.endswith("/claim") else {}

        result = dispatcher.KdosNotificationDispatcher(self.config(), http_post, pusher).run_once()
        self.assertEqual(result, {"claimed": 1, "sent": 2, "failed": 0})
        self.assertEqual(pusher.calls, [("设备故障提醒", "wx-zhang"), ("设备故障提醒", "wx-other")])
        callbacks = [(path, body) for path, body in calls if path.endswith("/success")]
        self.assertEqual([body["deliveryId"] for _, body in callbacks], ["delivery-zhang", "delivery-other"])
        self.assertTrue(all(set(body) == {"deliveryId", "providerMessageId", "errcode", "errmsg"} for _, body in callbacks))

    def test_one_recipient_failure_does_not_prevent_other_recipient_send(self):
        calls = []
        class OneFailurePusher(FakePusher):
            def send_app_text(self, content, touser):
                self.calls.append((content, touser))
                if touser == "wx-zhang":
                    return {"errcode": 500, "errmsg": "temporary"}
                return {"errcode": 0, "errmsg": "ok", "msgid": "msg-other"}
        pusher = OneFailurePusher()

        def http_post(path, body):
            calls.append((path, body))
            return {"notifications": [self.notification()]} if path.endswith("/claim") else {}

        result = dispatcher.KdosNotificationDispatcher(self.config(), http_post, pusher).run_once()
        self.assertEqual(result, {"claimed": 1, "sent": 1, "failed": 1})
        failure = next(body for path, body in calls if path.endswith("/failure"))
        success = next(body for path, body in calls if path.endswith("/success"))
        self.assertEqual(failure["deliveryId"], "delivery-zhang")
        self.assertEqual(success["deliveryId"], "delivery-other")

    def test_wechat_failure_is_reported_for_retry(self):
        calls = []
        pusher = FakePusher({"errcode": 500, "errmsg": "temporary"})

        def http_post(path, body):
            calls.append((path, body))
            return {"notifications": [self.notification()]} if path.endswith("/claim") else {}

        result = dispatcher.KdosNotificationDispatcher(self.config(), http_post, pusher).run_once()
        self.assertEqual(result["failed"], 2)
        self.assertEqual([body["deliveryId"] for path, body in calls if path.endswith("/failure")], ["delivery-zhang", "delivery-other"])
        self.assertTrue(all(body.get("errcode") == "WECHAT_SEND_FAILED" for path, body in calls if path.endswith("/failure")))

    def test_resident_mode_survives_one_api_failure_and_keeps_polling(self):
        calls = []
        stop_event = threading.Event()

        def http_post(path, body):
            calls.append(path)
            if len(calls) == 1:
                raise RuntimeError("temporary API outage")
            stop_event.set()
            return {"notifications": []}

        dispatcher.KdosNotificationDispatcher(self.config(), http_post, FakePusher()).run_forever(
            poll_interval=0.001, stop_event=stop_event
        )
        self.assertGreaterEqual(len(calls), 2)

    def test_resident_mode_survives_one_malformed_notification(self):
        calls = []
        stop_event = threading.Event()

        def http_post(path, body):
            calls.append(path)
            if len(calls) == 1:
                return {"notifications": [{"notificationId": "broken", "recipients": [{}]}]}
            stop_event.set()
            return {"notifications": []}

        runner = dispatcher.KdosNotificationDispatcher(self.config(), http_post, FakePusher())
        runner.run_forever(poll_interval=0.001, stop_event=stop_event)
        self.assertGreaterEqual(len(calls), 2)

    def test_config_requires_token_but_has_no_recipient_gate(self):
        with self.assertRaisesRegex(RuntimeError, "TOKEN"):
            dispatcher.DispatcherConfig("http://api", "", "KAINAN", "worker")
        self.assertEqual(self.config().worker_id, "test-worker")


if __name__ == "__main__":
    unittest.main()

class FileDeliveryTest(unittest.TestCase):
    def test_file_uses_private_temp_and_explicit_single_recipient(self):
        received=[]
        self_test=self
        for filename in ["PMC_Test.xlsx", "订单分配_261014164230_事业一部.xlsx", "订单分配_261014164230_张法才_P2.xlsx"]:
            with self.subTest(filename=filename):
                class Pusher:
                    def send_app_file(self,path,touser):
                        target=Path(path)
                        self_test.assertEqual(target.name,filename)
                        self_test.assertEqual(target.stat().st_mode & 0o777,0o600)
                        self_test.assertEqual(target.read_bytes(),b"PK-test")
                        received.append(touser)
                        return {"errcode":0,"msgid":"file-1"}
                notification={"notificationId":"0199f000-0000-7000-8000-000000000001","messageType":"file","content":"test", "attachment":{"filename":filename,"downloadPath":"/internal/notifications/0199f000-0000-7000-8000-000000000001/attachments/0199f000-0000-7000-8000-000000000002"},"recipients":[{"deliveryId":"file-fixture","wechatUserId":"single-test"}]}
                post=lambda path,body:{"notifications":[notification]} if path.endswith("claim") else {}
                service=dispatcher.KdosNotificationDispatcher(DispatcherTest().config(),post,Pusher())
                service._get_attachment=lambda path:b"PK-test"
                self.assertEqual(service.run_once()["sent"],1)
        self.assertEqual(received,["single-test"]*3)

    def test_chinese_name_exception_is_scoped_and_rejects_unsafe_paths(self):
        from unittest.mock import Mock
        names=["其他模块中文.xlsx", "../订单分配_261014164230_张三.xlsx", "订单分配_261014164230_../张三.xlsx", "订单分配_261014164230_张三\\name.xlsx", "订单分配_261014164230_张三\n.xlsx", "订单分配_261014164230_"+"名"*100+".xlsx", "订单分配_错误时间_张三.xlsx"]
        for filename in names:
            with self.subTest(filename=filename):
                notification={"notificationId":"0199f000-0000-7000-8000-000000000001","messageType":"file","content":"test", "attachment":{"filename":filename,"downloadPath":"/internal/notifications/0199f000-0000-7000-8000-000000000001/attachments/0199f000-0000-7000-8000-000000000002"},"recipients":[{"deliveryId":"unsafe-fixture","wechatUserId":"single-test"}]}
                post=lambda path,body:{"notifications":[notification]} if path.endswith("claim") else {}
                pusher=Mock()
                service=dispatcher.KdosNotificationDispatcher(DispatcherTest().config(),post,pusher)
                service._get_attachment=Mock()
                self.assertEqual(service.run_once()["failed"],1)
                service._get_attachment.assert_not_called()
                pusher.send_app_file.assert_not_called()

    def test_success_receipt_prevents_resend_after_callback_failure(self):
        import tempfile
        notification=DispatcherTest().notification()
        notification["recipients"]=notification["recipients"][:1]
        notification["recipients"][0]["deliveryId"]="0199f000-0000-7000-8000-000000000005"
        ack_fails=[True]
        callbacks=[]
        def post(path,body):
            if path.endswith("claim"):return {"notifications":[notification]}
            callbacks.append(path)
            if ack_fails[0]:raise RuntimeError("callback unavailable")
            return {}
        with tempfile.TemporaryDirectory() as receipts:
            pusher=FakePusher()
            service=dispatcher.KdosNotificationDispatcher(DispatcherTest().config(),post,pusher,Path(receipts))
            self.assertEqual(service.run_once()["failed"],1)
            ack_fails[0]=False
            self.assertEqual(service.run_once()["sent"],1)
            self.assertEqual(len(pusher.calls),1)
            self.assertTrue(all(path.endswith("success") for path in callbacks))
