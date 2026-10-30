#!/usr/bin/env python3
"""设备双日报。默认只生成；数据只经现有 EquipmentQueryService.dashboard。"""
from __future__ import annotations

import argparse
import fcntl
import json
import math
import re
import subprocess
import sys
import time
from collections.abc import Callable
from datetime import date, datetime, timedelta
from fractions import Fraction
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont

PROJECT_DIR = Path(__file__).resolve().parent
REPOSITORY_ROOT = PROJECT_DIR.parents[2]
BASIC_CODE_ROOT = Path('/data/automation/code/work/basci/basic_code')
SHANGHAI = ZoneInfo('Asia/Shanghai')
DIVISIONS = ('事业一部', '事业二部', '事业三部', '事业四部', '研发中心')
FONT_REGULAR = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
FONT_BOLD = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
OUTPUT_DIR = REPOSITORY_ROOT / 'data/wechat-push/equipment-governance-daily'
WIDTH, HEIGHT = 1440, 1520  # Logical layout; draw directly at twice this resolution.
RENDER_SCALE = 2
MAX_IMAGE_BYTES = 2 * 1024 * 1024
DATA_SOURCE_FOOTER = '数据口径：KDOS设备管理大屏'
INK, MUTED = '#f4f8ff', '#a8bed5'
COLORS = ('#62a8ff', '#35d0ba', '#ff866f', '#ffbf69')


def reporting_window(now: datetime | None = None) -> tuple[date, date]:
    now = now or datetime.now(SHANGHAI)
    if now.tzinfo is None:
        raise ValueError('必须提供带时区的时间')
    yesterday = now.astimezone(SHANGHAI).date() - timedelta(days=1)
    return yesterday - timedelta(days=6), yesterday


def notification_text(report_date: date) -> str:
    return (f'【设备管理日报表】{report_date:%Y年%m月%d日}\n\n'
            '日报1：设备运行日报。\n\n'
            '日报2：设备填报情况。过去7天集团填报率为100%时，不发送设备填报报表；未达到100%时，发送设备填报报表。')


def read_config(path: Path = PROJECT_DIR / 'config.json') -> dict[str, Any]:
    config = json.loads(path.read_text(encoding='utf-8'))
    if config['divisions'] != list(DIVISIONS):
        raise ValueError('统计范围必须是四个事业部及研发中心，按配置顺序同级展示')
    if config['test_recipients'] != ['崔玮杰']:
        raise ValueError('测试模式只能发送给崔玮杰')
    for key in ('text_delay_seconds', 'reporting_image_delay_seconds'):
        value = float(config[key])
        if not math.isfinite(value) or not 0 <= value <= 60:
            raise ValueError(f'{key}必须在0至60秒之间')
    return config


def load_live_summary(report_date: date) -> dict[str, Any]:
    # Send only the locally built adapter to the existing API Node runtime. This
    # also works before deployment; no container files, Nest app or jobs started.
    source = REPOSITORY_ROOT / 'apps/api/src/modules/equipment/print-equipment-governance-summary.ts'
    compiled = REPOSITORY_ROOT / 'apps/api/dist/modules/equipment/print-equipment-governance-summary.js'
    if not compiled.exists() or compiled.stat().st_mtime < source.stat().st_mtime:
        raise RuntimeError('请先在项目根目录执行 pnpm --filter @tracker/api build')
    worker = """
const path=require('path'),Module=require('module');let code='';
process.stdin.setEncoding('utf8');process.stdin.on('data',x=>code+=x);
process.stdin.on('end',async()=>{try{
 const filename=require.resolve('./dist/modules/equipment/print-equipment-governance-summary');
 const m=new Module(filename,module);m.filename=filename;m.path=path.dirname(filename);
 m.paths=Module._nodeModulePaths(m.path);m._compile(code,filename);
 await m.exports.run(process.argv[1]);
}catch(e){console.error(e.message);process.exitCode=1}});
"""
    completed = subprocess.run(
        ['docker', 'compose', 'exec', '-T', 'api', 'node', '-e', worker, report_date.isoformat()],
        input=compiled.read_text(encoding='utf-8'), cwd=REPOSITORY_ROOT,
        check=True, capture_output=True, text=True, timeout=240,
    )
    return json.loads(completed.stdout)


def count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError('填报台次必须是非负原始整数，不能使用百分比或估计值')
    return value


def seven_day_counts(summary: dict[str, Any]) -> tuple[int, int]:
    rows = summary['reporting']['sevenDayTrend']['total']
    expected = sum(count(row['expectedEquipmentCount']) for row in rows)
    filled = sum(count(row['filledEquipmentCount']) for row in rows)
    if any(count(row['filledEquipmentCount']) > count(row['expectedEquipmentCount']) for row in rows):
        raise ValueError('已填台次不能大于应填台次')
    return filled, expected


def seven_day_complete(summary: dict[str, Any]) -> bool:
    filled, expected = seven_day_counts(summary)
    return filled == expected


def canonical_name(name: str) -> str:
    return name[2:] if name.startswith('凯南事业') and name[2:] in DIVISIONS else name


def index_rows(rows: list[dict[str, Any]], key: str = 'division') -> dict[str, dict[str, Any]]:
    indexed = {}
    for row in rows:
        name = canonical_name(row[key])
        if name not in DIVISIONS or name in indexed:
            raise ValueError(f'单位超出范围或归属不明确：{name}')
        indexed[name] = row
    return indexed


def validate_summary(summary: dict[str, Any], start: date, end: date) -> None:
    dates = [(start + timedelta(days=i)).isoformat() for i in range(7)]
    if (summary.get('schemaVersion') != 1 or summary.get('reportDate') != end.isoformat()
            or summary.get('startDate') != dates[0] or summary.get('endDate') != dates[-1]
            or summary.get('divisions') != list(DIVISIONS)):
        raise ValueError('日报数据版本、日期或五单位范围不匹配')
    trend = summary['reporting']['sevenDayTrend']['total']
    if [row['date'] for row in summary['days']] != dates or [row['date'] for row in trend] != dates:
        raise ValueError('日报必须含昨日在内连续7天，不能静默缺失日期')
    if summary['reporting']['yesterday']['date'] != end.isoformat():
        raise ValueError('昨日填报日期不匹配')
    for day in summary['days']:
        metrics = day['metrics']
        for field in ('firstBatchMonitoringEquipment', 'dailyRecordedEquipment', 'normalEquipment', 'faultEquipment', 'idleEquipment'):
            count(metrics[field])
        for field in ('plannedRuntimeMinutes', 'runtimeMinutes', 'faultMinutes'):
            if not isinstance(metrics[field], (int, float)) or not math.isfinite(metrics[field]) or metrics[field] < 0:
                raise ValueError('运行时长必须是非负数')
        index_rows(day['divisionRows'])
    index_rows(summary['reporting']['yesterdayDivisionRows'])
    indexed = index_rows(summary['reporting']['sevenDayTrend']['divisions'], 'divisionName')
    for item in indexed.values():
        if [row['date'] for row in item['rows']] != dates:
            raise ValueError('单位填报趋势缺失日期')
    seven_day_counts(summary)


def percentage(filled: int, expected: int) -> str:
    return f'{filled / expected * 100:.1f}%' if expected else '—'


def rate(value: Any) -> str:
    return '—' if value is None else f'{value:.1f}%'


def hours(value: int | float) -> str:
    return f'{value / 60:,.1f}'


def unit_rows(summary: dict[str, Any]) -> list[dict[str, Any]]:
    operations = index_rows(summary['days'][-1]['divisionRows'])
    reporting = index_rows(summary['reporting']['yesterdayDivisionRows'])
    trends = index_rows(summary['reporting']['sevenDayTrend']['divisions'], 'divisionName')
    rows = []
    for name in DIVISIONS:
        trend = trends.get(name, {}).get('rows', [])
        rows.append({'name': name, 'operation': operations.get(name, {}), 'reporting': reporting.get(name, {}),
                     'weekExpected': sum(count(x['expectedEquipmentCount']) for x in trend),
                     'weekFilled': sum(count(x['filledEquipmentCount']) for x in trend)})
    return rows


def reporting_rankings(summary: dict[str, Any]) -> tuple[str, str]:
    rows = [row for row in unit_rows(summary) if row['reporting'].get('expectedEquipmentCount', 0) > 0]
    if not rows:
        return '无应填设备，暂无排名', '无应填设备，暂无排名'
    score = lambda row: Fraction(row['reporting']['filledEquipmentCount'], row['reporting']['expectedEquipmentCount'])
    def label(value: Fraction) -> str:
        names = '、'.join(row['name'] for row in rows if score(row) == value)
        return f'{names}  {float(value) * 100:.1f}%'
    return label(max(map(score, rows))), label(min(map(score, rows)))


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size * RENDER_SCALE)


class ReportDraw:
    """Map logical coordinates to native pixels; glyphs use full-size fonts.

    This draws onto the large canvas directly instead of enlarging an already
    rasterized image. Shapes, strokes and multiline spacing scale together.
    """
    def __init__(self, image: Image.Image):
        self._draw = ImageDraw.Draw(image)

    @staticmethod
    def _coordinates(values):
        return tuple(ReportDraw._coordinates(v) if isinstance(v, (tuple, list)) else round(v * RENDER_SCALE) for v in values)

    def _paint(self, method, xy, *args, **kwargs):
        for key in ('radius', 'width', 'spacing', 'stroke_width'):
            if key in kwargs:
                kwargs[key] *= RENDER_SCALE
        return getattr(self._draw, method)(self._coordinates(xy), *args, **kwargs)

    def text(self, xy, text, **kwargs):
        return self._paint('text', xy, text, **kwargs)

    def multiline_text(self, xy, text, **kwargs):
        return self._paint('multiline_text', xy, text, **kwargs)

    def rectangle(self, xy, **kwargs):
        return self._paint('rectangle', xy, **kwargs)

    def rounded_rectangle(self, xy, **kwargs):
        return self._paint('rounded_rectangle', xy, **kwargs)

    def ellipse(self, xy, **kwargs):
        return self._paint('ellipse', xy, **kwargs)

    def line(self, xy, **kwargs):
        kwargs.setdefault('width', 1)
        return self._paint('line', xy, **kwargs)


def rounded(draw: ReportDraw, box: tuple[int, int, int, int], fill: str = '#102640') -> None:
    draw.rounded_rectangle(box, radius=18, fill=fill, outline='#1d446b', width=1)


def canvas(title: str, summary: dict[str, Any]) -> tuple[Image.Image, ReportDraw]:
    image = Image.new('RGB', (WIDTH * RENDER_SCALE, HEIGHT * RENDER_SCALE), '#071426')
    draw = ReportDraw(image)
    draw.rectangle((0, 0, WIDTH, 225), fill='#0c2a4a')
    draw.ellipse((1110, -180, 1540, 250), fill='#123e68')
    draw.text((72, 48), title, font=font(46, True), fill=INK)
    draw.text((72, 112), f"统计日 {summary['reportDate']}    近7天 {summary['startDate']} ~ {summary['endDate']}", font=font(23), fill=MUTED)
    return image, draw


def cards(draw: ReportDraw, items: list[tuple[str, str]], y: int, height: int = 132) -> None:
    step = 1296 / len(items)
    for i, (label, value) in enumerate(items):
        x = int(72 + step * i)
        rounded(draw, (x, y, int(x + step - 16), y + height))
        draw.text((x + 18, y + 19), label, font=font(22), fill=MUTED)
        draw.text((x + 18, y + 63), value, font=font(31, True), fill=COLORS[i % 4])


def trend_chart(draw: ReportDraw, points: list[dict[str, Any]], reporting: bool) -> None:
    rounded(draw, (72, 550, 1368, 870))
    series = [('应填台次', 'expectedEquipmentCount'), ('已填台次', 'filledEquipmentCount')] if reporting else [('计划时长', 'plannedRuntimeMinutes'), ('实际时长', 'runtimeMinutes'), ('故障时长', 'faultMinutes')]
    rate_key = 'reportingRate' if reporting else 'utilizationRate'
    for i, (label, _) in enumerate(series):
        draw.rectangle((100 + i * 190, 570, 117 + i * 190, 586), fill=COLORS[i])
        draw.text((126 + i * 190, 563), label, font=font(21), fill=MUTED)
    draw.text((850, 563), '折线：填报率' if reporting else '折线：稼动率', font=font(21), fill=COLORS[3])
    draw.text((100, 605), '台次' if reporting else '小时', font=font(17), fill=MUTED)
    top, bottom, left, right = 640, 817, 140, 1250
    divisor = 1 if reporting else 60
    maximum = max([float(p.get(key) or 0) / divisor for p in points for _, key in series] + [1])
    rate_max = max([float(p.get(rate_key) or 0) for p in points] + [100])
    for i in range(4):
        y = int(bottom - (bottom - top) * i / 3)
        draw.line((left, y, right, y), fill='#224262')
        draw.text((88, y - 10), f'{maximum * i / 3:.0f}', font=font(18), fill=MUTED)
        draw.text((1262, y - 10), f'{rate_max * i / 3:.0f}%', font=font(18), fill=MUTED)
    previous = None
    for i, point in enumerate(points):
        center = int(left + (right - left) * (i + .5) / 7)
        for j, (_, key) in enumerate(series):
            x = center - len(series) * 13 + j * 26
            y = int(bottom - float(point.get(key) or 0) / divisor / maximum * (bottom - top))
            draw.rectangle((x, y, x + 20, bottom), fill=COLORS[j])
        value = point.get(rate_key)
        if value is not None:
            xy = (center, int(bottom - float(value) / rate_max * (bottom - top)))
            if previous is not None:
                draw.line((previous, xy), fill=COLORS[3], width=3)
            draw.ellipse((xy[0]-4, xy[1]-4, xy[0]+4, xy[1]+4), fill=COLORS[3])
            previous = xy
        else:
            previous = None
        draw.text((center - 29, 835), point['date'][5:], font=font(19), fill=MUTED)


def table(draw: ReportDraw, headers: list[str], rows: list[list[str]], widths: list[int], top: int, row_height: int) -> None:
    x = 72
    for header, width in zip(headers, widths):
        draw.multiline_text((x + width / 2, top + 30), header, font=font(22, True), fill=MUTED, anchor='mm', align='center', spacing=5)
        x += width
    for index, row in enumerate(rows):
        y = top + 75 + index * row_height
        rounded(draw, (72, y, 1368, y + row_height - 10), '#0e2139')
        x = 72
        for text, width in zip(row, widths):
            draw.text((x + width / 2, y + (row_height - 10) / 2), text, font=font(22), fill=INK, anchor='mm')
            x += width


def save_image(image: Image.Image, output: Path) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format='PNG', optimize=True)
    if output.stat().st_size > MAX_IMAGE_BYTES:
        raise ValueError('日报图片超过企业微信2MB限制，请检查内容；不能静默缩图降低清晰度')
    return output


def render_operation_report(summary: dict[str, Any], output: Path) -> Path:
    image, draw = canvas('设备运行日报', summary)
    m = summary['days'][-1]['metrics']
    cards(draw, [('监控设备数', str(m['firstBatchMonitoringEquipment'])), ('计划运行（小时）', hours(m['plannedRuntimeMinutes'])), ('实际运行（小时）', hours(m['runtimeMinutes'])), ('整体稼动率', rate(m['utilizationRate'])), ('故障时长（小时）', hours(m['faultMinutes']))], 175)
    draw.text((72, 335), '昨日设备运行状态', font=font(28, True), fill=INK)
    cards(draw, [('正常运行设备', str(m['normalEquipment'])), ('存在故障设备', str(m['faultEquipment'])), ('未运行设备', str(m['idleEquipment'])), ('未填报设备', str(m['firstBatchMonitoringEquipment']-m['dailyRecordedEquipment']))], 383, 110)
    draw.text((72, 508), '近7天运行趋势', font=font(28, True), fill=INK)
    trend_chart(draw, [{'date': p['date'], **p['metrics']} for p in summary['days']], False)
    draw.text((72, 903), '五个单位运行情况（时长单位：小时）', font=font(28, True), fill=INK)
    rows = []
    for item in unit_rows(summary):
        op = item['operation']
        rows.append([item['name'], str(op.get('equipmentCount', 0)), str(op.get('equipmentCount', 0)-op.get('unreportedCount', 0)), hours(op.get('plannedRuntimeMinutes', 0)), hours(op.get('runtimeMinutes', 0)), rate(op.get('utilizationRate')), hours(op.get('faultMinutes', 0)), str(op.get('normalCount', 0)), str(op.get('faultCount', 0)), str(op.get('idleCount', 0)), str(op.get('unreportedCount', 0))])
    table(draw, ['单位', '监控\n设备', '已填报\n设备', '计划\n时长', '实际\n时长', '稼动率', '故障\n时长', '正常\n运行', '存在\n故障', '未运行', '未填报'], rows, [140, 100, 100, 140, 140, 120, 120, 109, 109, 109, 109], 955, 82)
    draw.text((72, 1478), DATA_SOURCE_FOOTER, font=font(21), fill=MUTED)
    return save_image(image, output)


def render_reporting_report(summary: dict[str, Any], output: Path) -> Path:
    image, draw = canvas('设备填报日报', summary)
    yesterday = summary['reporting']['yesterday']
    cards(draw, [('应填设备', str(yesterday['expectedEquipmentCount'])), ('已填设备', str(yesterday['filledEquipmentCount'])), ('未填设备', str(yesterday['unfilledEquipmentCount'])), ('昨日填报率', rate(yesterday['reportingRate']))], 175)
    filled, expected = seven_day_counts(summary)
    cards(draw, [('近7天集团填报率', percentage(filled, expected)), ('近7天已填 / 应填（台次）', f'{filled} / {expected}')], 365, 125)
    draw.text((72, 508), '近7天每日填报趋势', font=font(28, True), fill=INK)
    trend_chart(draw, summary['reporting']['sevenDayTrend']['total'], True)
    draw.text((72, 903), '五个单位填报情况', font=font(28, True), fill=INK)
    rows = []
    for item in unit_rows(summary):
        r = item['reporting']
        rows.append([item['name'], f"{r.get('filledEquipmentCount', 0)} / {r.get('expectedEquipmentCount', 0)}", rate(r.get('reportingRate')), percentage(item['weekFilled'], item['weekExpected'])])
    table(draw, ['单位', '昨日已填 / 应填', '昨日填报率', '近7天填报率'], rows, [270, 370, 328, 328], 950, 60)
    best, worst = reporting_rankings(summary)
    # Ties retain all units. Two lines fit all five names without tiny text.
    for label, text, y in [('昨日填报最好', best, 1340), ('昨日填报最差', worst, 1410)]:
        rounded(draw, (72, y, 1368, y + 60))
        draw.text((95, y + 17), label, font=font(22, True), fill=COLORS[0])
        draw.text((320, y + 17), text, font=font(22), fill=INK)
    return save_image(image, output)


def resolve_user_ids(pusher: Any, names: list[str]) -> list[str]:
    if not names or len(set(names)) != len(names) or '@all' in names:
        raise ValueError('必须提供不重复的实名接收人，禁止@all')
    by_name: dict[str, set[str]] = {}
    for contact in pusher.get_contacts(include_detail=True):
        name, user_id = str(contact.get('name', '')).strip(), str(contact.get('userid', '')).strip()
        if name and user_id:
            by_name.setdefault(name, set()).add(user_id)
    for name in names:
        if not by_name.get(name):
            raise RuntimeError(f'通讯录未找到：{name}')
        if len(by_name[name]) != 1:
            raise RuntimeError(f'通讯录重名：{name}')
    return [next(iter(by_name[name])) for name in names]



def create_pusher() -> Any:
    sys.path.insert(0, str(BASIC_CODE_ROOT))
    from wechat import WeChatPusher
    return WeChatPusher()


def send_failure_alert(names: list[str], pusher: Any | None = None) -> dict[str, Any]:
    """Operational alert only, separate from the nine report recipients."""
    pusher = pusher if pusher is not None else create_pusher()
    users = resolve_user_ids(pusher, names)
    response = pusher.send_app_text('【设备管理日报发送失败】\n请检查n8n设备管理日报的本次执行记录。已成功组件不重发；发送结果未知的组件请先人工核对。', touser='|'.join(users))
    if response.get('errcode') != 0:
        raise RuntimeError('设备日报失败告警发送失败')
    return {'alertSent': True, 'recipientCount': len(users)}


def send_report(operation_image: Path, reporting_image: Callable[[], Path], text: str,
                should_send_reporting: Callable[[], bool], recipient_names: list[str],
                pusher: Any | None = None, *, text_delay_seconds: float = 3,
                image_delay_seconds: float = 5, sleeper: Callable[[float], None] = time.sleep,
                receipt: dict[str, Any] | None = None, persist: Callable[[], None] = lambda: None) -> dict[str, Any]:
    if any(not math.isfinite(x) or not 0 <= x <= 60 for x in (text_delay_seconds, image_delay_seconds)):
        raise ValueError('发送间隔必须在0至60秒之间')
    if pusher is None:
        pusher = create_pusher()
    user_ids = resolve_user_ids(pusher, recipient_names)
    recipients = '|'.join(user_ids)
    receipt = receipt if receipt is not None else {}
    if receipt.get('recipients') not in (None, recipients):
        raise RuntimeError('同日接收人发生变化，拒绝重用发送回执')
    receipt['recipients'] = recipients
    if len(user_ids) > 1 and any(k in receipt for k in ('text', 'operation_image', 'reporting_image')):
        raise RuntimeError('旧批量回执缺少逐人结果，请先人工核对，禁止自动重发')
    reporting_path = None
    reporting_requested = False
    for name, user_id in zip(recipient_names, user_ids):
        # Preserve legacy single-recipient receipts. Multiple recipients require
        # separate progress, because personalized text cannot use a group touser.
        state = receipt if len(user_ids) == 1 else receipt.setdefault('deliveries', {}).setdefault(user_id, {})
        def send(component: str, action: Callable[[], dict[str, Any]]) -> None:
            if state.get(component) == 'sent':
                return
            if state.get(component) == 'sending':
                raise RuntimeError(f'{component}上次发送结果未确认，请人工核对后恢复，禁止自动重发')
            state[component] = 'sending'; persist()
            response = action()
            if response.get('errcode') != 0:
                state[component] = 'failed'; persist()
                raise RuntimeError(f'企业微信{component}发送失败：{response.get("errmsg", "未知错误")}')
            state[component] = 'sent'; persist()
        send('text', lambda: pusher.send_app_text(f'您好,{name},请收\n\n{text}', touser=user_id))
        if state.get('operation_image') != 'sent':
            sleeper(text_delay_seconds)
        send('operation_image', lambda: pusher.send_app_image(str(operation_image), touser=user_id))
        # Evaluate only after this person's operation-image success, using counts.
        if 'send_reporting' not in state:
            state['send_reporting'] = should_send_reporting(); persist()
        reporting_requested = reporting_requested or bool(state['send_reporting'])
        if state['send_reporting'] and state.get('reporting_image') != 'sent':
            sleeper(image_delay_seconds)
            if reporting_path is None:
                reporting_path = reporting_image()
            send('reporting_image', lambda: pusher.send_app_image(str(reporting_path), touser=user_id))
    return {'sent': True, 'recipientCount': len(recipient_names), 'reportingImageSent': reporting_requested,
            'sequence': ['text', 'operation_image'] + (['reporting_image'] if reporting_requested else [])}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='设备运行/填报双日报，默认只生成图片不发送')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--send-test', action='store_true', help='只发送给崔玮杰')
    mode.add_argument('--send-production', action='store_true', help='正式发送，另需配置开启及二次确认')
    mode.add_argument('--check-production', action='store_true', help='正式发布预检：只读取数/检查联系人/生成图片，不发送')
    mode.add_argument('--notify-failure', action='store_true', help='n8n失败分支通知维护人，不发送业务日报')
    parser.add_argument('--confirm-production', action='store_true')
    parser.add_argument('--test-run-id', help='经授权的新一轮单人测试标识，同标识重跑仍幂等，仅限--send-test')
    parser.add_argument('--data-json', type=Path, help='合成/本地数据，仅限不发送的预览模式')
    parser.add_argument('--output-dir', type=Path, default=OUTPUT_DIR)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    config = read_config()
    if args.test_run_id and (not args.send_test or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', args.test_run_id)):
        raise ValueError('--test-run-id仅限--send-test，标识只允许字母数字、下划线和短横线，最长64位')
    if args.send_production and (not args.confirm_production or config.get('allow_production_send') is not True):
        raise ValueError('当前禁止正式发送；未来需显式开启allow_production_send并提供--confirm-production')
    if (args.check_production or args.notify_failure) and config.get('allow_production_send') is not True:
        raise ValueError('正式发布尚未开启，不能执行正式预检或告警')
    if args.data_json and (args.send_test or args.send_production or args.check_production or args.notify_failure):
        raise ValueError('本地调试数据不能用于真实发送')
    if args.notify_failure:
        print(json.dumps(send_failure_alert(config['failure_recipients']), ensure_ascii=False))
        return 0
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with (args.output_dir / '.report.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('设备日报正在运行，拒绝并发执行') from error
        start, end = reporting_window()
        summary = json.loads(args.data_json.read_text(encoding='utf-8')) if args.data_json else load_live_summary(end)
        validate_summary(summary, start, end)
        folder = args.output_dir / end.isoformat()
        if args.send_production or args.check_production:
            folder = folder / 'production'
        elif args.test_run_id:
            folder = folder / 'tests' / args.test_run_id
        operation = render_operation_report(summary, folder / 'operation.png')
        reporting = lambda: render_reporting_report(summary, folder / 'reporting.png')
        result: dict[str, Any] = {'sent': False, 'reportDate': end.isoformat(), 'operationImage': str(operation)}
        if args.send_test or args.send_production:
            mode = 'test' if args.send_test else 'production'
            receipt_path = folder / f'{mode}-receipt.json'
            receipt = json.loads(receipt_path.read_text(encoding='utf-8')) if receipt_path.exists() else {}
            def persist() -> None:
                temporary = receipt_path.with_suffix('.tmp')
                temporary.touch(mode=0o600, exist_ok=True)
                temporary.write_text(json.dumps(receipt, ensure_ascii=False), encoding='utf-8')
                temporary.replace(receipt_path)
            result.update(send_report(operation, reporting, notification_text(end), lambda: not seven_day_complete(summary),
                                      config['test_recipients' if args.send_test else 'production_recipients'],
                                      text_delay_seconds=config['text_delay_seconds'], image_delay_seconds=config['reporting_image_delay_seconds'],
                                      receipt=receipt, persist=persist))
            result['mode'] = mode
            if args.test_run_id:
                result['testRunId'] = args.test_run_id
        else:
            if args.check_production:
                users = resolve_user_ids(create_pusher(), config['production_recipients'])
                result.update({'ready': True, 'mode': 'production-check', 'recipientCount': len(users)})
            result['reportingImage'] = str(reporting())
            result['wouldSendReportingImage'] = not seven_day_complete(summary)
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'sent': False, 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
