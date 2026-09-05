#!/usr/bin/env python3
"""设备治理企业微信图片日报。默认仅生成图片，不发送。"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont


PROJECT_DIR = Path(__file__).resolve().parent
REPOSITORY_ROOT = PROJECT_DIR.parents[2]
BASIC_CODE_ROOT = Path("/data/automation/code/work/basci/basic_code")
FONT_REGULAR = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
SHANGHAI = ZoneInfo("Asia/Shanghai")


@dataclass(frozen=True)
class DivisionResult:
    name: str
    total: int
    monitored: int
    responsible: int
    monitoring_text: str
    responsibility_text: str
    training_text: str
    ready: bool


def read_config(path: Path = PROJECT_DIR / "config.json") -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_training_status(path: Path = PROJECT_DIR / "training_status.txt") -> dict[str, tuple[str, str]]:
    result: dict[str, tuple[str, str]] = {}
    for number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) != 3 or not parts[0]:
            raise ValueError(f"培训情况文件第 {number} 行格式错误")
        result[parts[0]] = (parts[1], parts[2] or "待安排")
    return result


def evaluate(summary: dict[str, Any], divisions: list[str], training: dict[str, tuple[str, str]]) -> list[DivisionResult]:
    indexed = {str(row.get("divisionName", "")): row for row in summary.get("rows", [])}
    results: list[DivisionResult] = []
    for name in divisions:
        row = indexed.get(name, {})
        total = int(row.get("totalEquipment", 0) or 0)
        monitored = int(row.get("monitoredEquipment", 0) or 0)
        responsible = int(row.get("responsibleEquipment", 0) or 0)
        monitoring_text = f"需要监测 {monitored} 台" if monitored > 0 else "未提交需要监测的设备"
        responsibility_text = f"已指定责任人 {responsible} 台" if responsible > 0 else "未提交设备管理责任人"
        ready = monitored > 0 and responsible > 0
        date, status = training.get(name, ("", "待安排"))
        training_text = f"{date}  {status}".strip() if ready else "培训条件未满足"
        results.append(DivisionResult(name, total, monitored, responsible, monitoring_text, responsibility_text, training_text, ready))
    return results


def load_live_summary() -> dict[str, Any]:
    command = ["docker", "compose", "exec", "-T", "api", "node", "dist/modules/equipment/print-equipment-governance-summary.js"]
    completed = subprocess.run(command, cwd=REPOSITORY_ROOT, check=True, capture_output=True, text=True, timeout=120)
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("设备治理查询没有返回数据")
    return json.loads(lines[-1])


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, radius: int = 24, outline: str | None = None) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=2 if outline else 1)


def daily_title(title: str, now: datetime) -> str:
    reporting_date = now.astimezone(SHANGHAI) - timedelta(days=1)
    return f"{title}  截至{reporting_date:%Y年%m月%d日}"


def render_report(results: list[DivisionResult], output: Path, title: str, now: datetime | None = None) -> Path:
    now = now or datetime.now(SHANGHAI)
    image = Image.new("RGB", (1440, 1120), "#071426")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1440, 230), fill="#0c2a4a")
    draw.ellipse((1110, -180, 1540, 250), fill="#123e68")
    draw.text((72, 70), daily_title(title, now), font=font(46, True), fill="#f4f8ff")
    ready_count = sum(item.ready for item in results)
    monitored_total = sum(item.monitored for item in results)
    responsible_total = sum(item.responsible for item in results)
    metrics = [("已提交监测设备", f"{monitored_total} 台", "#35d0ba"), ("已指定责任人设备", f"{responsible_total} 台", "#62a8ff"), ("满足培训条件", f"{ready_count} / {len(results)}", "#ffbf69")]
    for index, (label, value, color) in enumerate(metrics):
        x = 72 + index * 438
        rounded(draw, (x, 185, x + 405, 330), "#102640", 22, "#1d446b")
        draw.text((x + 28, 210), label, font=font(23), fill="#a8bed5")
        draw.text((x + 28, 250), value, font=font(38, True), fill=color)
    draw.text((72, 375), "事业部推进明细", font=font(31, True), fill="#f4f8ff")
    headers = [("事业部", 95), ("设备监测清单", 315), ("设备责任人", 680), ("培训进展", 1045)]
    for label, x in headers:
        draw.text((x, 430), label, font=font(22, True), fill="#7fa4c7")
    for index, item in enumerate(results):
        top = 480 + index * 135
        rounded(draw, (72, top, 1368, top + 112), "#0e2139", 18, "#193c60")
        status_color = "#35d0ba" if item.ready else "#ff866f"
        draw.ellipse((94, top + 40, 110, top + 56), fill=status_color)
        draw.text((126, top + 29), item.name, font=font(27, True), fill="#eef6ff")
        draw.text((126, top + 66), f"台账 {item.total} 台", font=font(18), fill="#7898b8")
        draw.text((315, top + 40), item.monitoring_text, font=font(22), fill="#e1ecf7" if item.monitored else "#ff9b86")
        draw.text((680, top + 40), item.responsibility_text, font=font(22), fill="#e1ecf7" if item.responsible else "#ff9b86")
        draw.text((1045, top + 40), item.training_text, font=font(22), fill="#35d0ba" if item.ready else "#ffbf69")
    draw.text((72, 1048), "说明：任一事业部未提交监测设备或未指定设备责任人时，培训条件均视为未满足。", font=font(21), fill="#7f9bb7")
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format="PNG", optimize=True)
    return output


def resolve_user_ids(pusher: Any, names: list[str]) -> list[str]:
    by_name: dict[str, list[str]] = {}
    for contact in pusher.get_contacts(include_detail=True):
        name = str(contact.get("name", "")).strip()
        user_id = str(contact.get("userid", "")).strip()
        if name and user_id:
            by_name.setdefault(name, []).append(user_id)
    missing = [name for name in names if name not in by_name]
    ambiguous = [name for name in names if len(by_name.get(name, [])) > 1]
    if missing or ambiguous:
        details = []
        if missing:
            details.append(f"通讯录未找到：{'、'.join(missing)}")
        if ambiguous:
            details.append(f"通讯录重名：{'、'.join(ambiguous)}")
        raise RuntimeError("；".join(details))
    return [by_name[name][0] for name in names]


def send_image(image_path: Path, recipient_names: list[str], pusher: Any | None = None) -> dict[str, Any]:
    if pusher is None:
        sys.path.insert(0, str(BASIC_CODE_ROOT))
        from wechat import WeChatPusher
        pusher = WeChatPusher()
    user_ids = resolve_user_ids(pusher, recipient_names)
    response = pusher.send_app_image(str(image_path), touser="|".join(user_ids))
    return {"errcode": response.get("errcode"), "errmsg": response.get("errmsg"), "recipientCount": len(recipient_names)}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成设备管理上线进度图片日报；默认不发送")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--send-test", action="store_true", help="仅发送给配置中的测试接收人")
    mode.add_argument("--send-production", action="store_true", help="发送给全部正式接收人")
    parser.add_argument("--confirm-production", action="store_true", help="正式发送的二次确认参数")
    parser.add_argument("--data-json", type=Path, help="使用本地 JSON 数据代替在线查询，仅供测试")
    parser.add_argument("--output", type=Path, default=REPOSITORY_ROOT / "data/wechat-push/equipment-governance-daily/latest.png")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.send_production and not args.confirm_production:
        raise SystemExit("正式发送必须同时提供 --confirm-production")
    config = read_config()
    summary = json.loads(args.data_json.read_text(encoding="utf-8")) if args.data_json else load_live_summary()
    results = evaluate(summary, config["divisions"], read_training_status())
    output = render_report(results, args.output, config["title"])
    result: dict[str, Any] = {"image": str(output), "sent": False}
    if args.send_test:
        result.update(send_image(output, config["test_recipients"])); result["sent"] = True; result["mode"] = "test"
    elif args.send_production:
        result.update(send_image(output, config["production_recipients"])); result["sent"] = True; result["mode"] = "production"
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
