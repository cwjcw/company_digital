import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image

from report import PROJECT_DIR, daily_title, evaluate, notification_text, read_config, render_report, resolve_user_ids, send_report


class FakePusher:
    def __init__(self):
        self.sent_to = None
        self.calls = []

    def get_contacts(self, include_detail=True):
        return [{"name": "崔玮杰", "userid": "user-cui"}, {"name": "其他人", "userid": "user-other"}]

    def send_app_image(self, path, touser="@all"):
        self.sent_to = touser
        self.calls.append(("image", path, touser))
        return {"errcode": 0, "errmsg": "ok"}

    def send_app_text(self, text, touser="@all"):
        self.calls.append(("text", text, touser))
        return {"errcode": 0, "errmsg": "ok"}


class FailedImagePusher(FakePusher):
    def send_app_image(self, path, touser="@all"):
        self.calls.append(("image", path, touser))
        return {"errcode": 40001, "errmsg": "图片发送失败"}


class EquipmentGovernanceReportTest(unittest.TestCase):
    def setUp(self):
        self.summary = {"rows": [
            {"divisionName": "事业一部", "totalEquipment": 10, "monitoredEquipment": 0, "responsibleEquipment": 3},
            {"divisionName": "事业二部", "totalEquipment": 20, "monitoredEquipment": 4, "responsibleEquipment": 2}
        ]}
        self.training = {"事业一部": ("2026-09-06", "已培训"), "事业二部": ("2026-09-07", "已完成")}

    def test_business_rules(self):
        rows = evaluate(self.summary, ["事业一部", "事业二部", "事业三部"], self.training)
        self.assertEqual(rows[0].monitoring_text, "未提交需要监测的设备")
        self.assertEqual(rows[0].training_text, "培训条件未满足")
        self.assertEqual(rows[1].monitoring_text, "需要监测 4 台")
        self.assertEqual(rows[1].responsibility_text, "已指定责任人 2 台")
        self.assertEqual(rows[1].training_text, "2026-09-07  已完成")
        self.assertEqual(rows[2].responsibility_text, "未提交设备管理责任人")

    def test_render_and_test_send_only_one_person(self):
        rows = evaluate(self.summary, ["事业一部", "事业二部"], self.training)
        with tempfile.TemporaryDirectory() as folder:
            path = render_report(rows, Path(folder) / "report.png", "测试日报", datetime(2026, 9, 5, 9, 0, tzinfo=ZoneInfo("Asia/Shanghai")))
            with Image.open(path) as image:
                self.assertEqual(image.size, (1440, 1120))
            pusher = FakePusher()
            response = send_report(
                path,
                "设备管理上线进度表 截至2026年09月04日",
                ["崔玮杰"],
                pusher,
                delay_seconds=15,
                sleeper=lambda seconds: pusher.calls.append(("wait", seconds, None)),
            )
            self.assertEqual(response["recipientCount"], 1)
            self.assertEqual(response["textDelaySeconds"], 15)
            self.assertEqual(pusher.sent_to, "user-cui")
            self.assertEqual([call[0] for call in pusher.calls], ["image", "wait", "text"])
            self.assertEqual(pusher.calls[1], ("wait", 15, None))
            self.assertEqual(pusher.calls[2], ("text", "设备管理上线进度表 截至2026年09月04日", "user-cui"))

    def test_does_not_send_text_when_image_fails(self):
        pusher = FailedImagePusher()
        waited = []
        with self.assertRaisesRegex(RuntimeError, "企业微信图片发送失败"):
            send_report(
                Path("report.png"),
                "不应发送的文字",
                ["崔玮杰"],
                pusher,
                delay_seconds=15,
                sleeper=waited.append,
            )
        self.assertEqual([call[0] for call in pusher.calls], ["image"])
        self.assertEqual(waited, [])

    def test_title_contains_the_previous_day_as_reporting_date(self):
        now = datetime(2026, 9, 5, 14, 30, tzinfo=ZoneInfo("Asia/Shanghai"))
        title = daily_title("设备管理上线进度日报", now)
        self.assertEqual(title, "设备管理上线进度日报  截至2026年09月04日")
        self.assertNotIn("14:30", title)

    def test_title_handles_month_and_year_boundaries(self):
        now = datetime(2027, 1, 1, 0, 1, tzinfo=ZoneInfo("Asia/Shanghai"))
        self.assertEqual(daily_title("设备管理上线进度日报", now), "设备管理上线进度日报  截至2026年12月31日")

    def test_notification_text_uses_previous_day(self):
        now = datetime(2026, 9, 5, 14, 30, tzinfo=ZoneInfo("Asia/Shanghai"))
        self.assertEqual(notification_text("设备管理上线进度表", now), "设备管理上线进度表 截至2026年09月04日")

    def test_rejects_missing_contact(self):
        with self.assertRaisesRegex(RuntimeError, "通讯录未找到"):
            resolve_user_ids(FakePusher(), ["不存在的人"])

    def test_recipient_configuration_keeps_test_and_production_separate(self):
        config = read_config(PROJECT_DIR / "config.json")
        self.assertEqual(config["text_delay_seconds"], 15)
        self.assertEqual(config["test_recipients"], ["崔玮杰"])
        self.assertEqual(config["production_recipients"], [
            "刘义响", "朱永远", "周志明", "崔玮杰", "张建中", "蒋青国",
            "徐玉鹏", "高婷武", "廖焕敏", "刘丽秋", "黄开亮"
        ])


if __name__ == "__main__":
    unittest.main()
