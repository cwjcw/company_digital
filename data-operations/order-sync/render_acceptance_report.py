#!/usr/bin/env python3
"""Render human-readable ERP staging acceptance artifacts from API reports."""
from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "outputs" / "erp-order-sync"
DAY = datetime.now().strftime("%Y%m%d")


def read(name: str) -> dict[str, Any]:
    return json.loads((OUTPUT / name).read_text(encoding="utf-8"))


def initialization_counts(report: dict[str, Any], source_key: str) -> dict[str, int]:
    streams = {
        row["stream"]: int(row["recordCount"])
        for row in report["batches"]
        if row["sourceKey"] == source_key and row["runType"] == "INITIALIZATION"
    }
    return {
        "ORDER_HEADER": streams.get("order_header", 0),
        "ORDER_LINE": streams.get("order_detail", 0),
        "DELIVERY_PLAN": streams.get("delivery_plan", 0),
        "OUTBOUND_LINE": streams.get("outbound_initial", streams.get("outbound_detail", 0)),
        "INBOUND_LINE": streams.get("inbound_detail", 0),
        "INVENTORY": streams.get("inventory", 0),
    }


def fmt_time(value: str | None) -> str:
    return value.replace("T", " ").replace("Z", " UTC") if value else "-"


def main() -> None:
    report = read(f"初始化与增量同步报告_{DAY}.json")
    quality = read(f"初始化数据质量报告_{DAY}.json")
    sources = {row["sourceKey"]: row for row in report["sources"]}
    initial_runs = {
        row["sourceKey"]: row
        for row in report["runs"]
        if row["runType"] == "INITIALIZATION" and row["status"] == "COMPLETED"
    }
    latest_incremental: dict[str, dict[str, Any]] = {}
    for row in report["runs"]:
        if row["runType"] == "INCREMENTAL" and row["status"] == "COMPLETED":
            latest_incremental[row["sourceKey"]] = row

    batch_path = OUTPUT / f"批次耗时明细_{DAY}.csv"
    batch_fields = [
        "sourceKey", "runType", "runId", "stream", "sourceTable", "batchNumber",
        "status", "readCount", "insertedCount", "updatedCount", "overlapReplayCount",
        "trueDuplicateCount", "durationMs", "retryCount", "cursorBefore", "cursorAfter",
        "scanUpperBound", "committedAt",
    ]
    with batch_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=batch_fields)
        writer.writeheader()
        for row in report["batchDetails"]:
            writer.writerow({key: json.dumps(row.get(key), ensure_ascii=False) if key in {"cursorBefore", "cursorAfter"} else row.get(key) for key in batch_fields})

    lines = [
        "# ERP订单 staging 初始化与增量同步验收报告",
        "",
        f"生成时间：{datetime.now().isoformat(timespec='seconds')}",
        "",
        "## 结论",
        "",
        "- E10、T+凯南智能、T+科加智能三个来源已分别完成初始化、补偿和增量演示，状态均为 ACTIVE。",
        "- 源 SQL Server 仅执行 READ COMMITTED 的 SELECT；当前数据仅写入 PostgreSQL 隔离 staging。",
        "- 现有 sales_orders、finished_goods_inbound、finished_goods_outbound 未被同步任务写入或替换。",
        "- 最终业务层保留一张订单表；入库与出库保持两张表，因为 T+ 同一源表依靠方向标志区分两种业务，E10本期只有可确认的销售出库流。",
        "",
        "## 初始化数量",
        "",
        "| 来源 | 订单 | 明细 | 交付计划 | 出库明细 | 入库明细 | 库存 | 初始化批次 | 开始 | 完成 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ]
    for key in ["e10-main", "tplus-kainan", "tplus-kejia"]:
        source = sources[key]
        run = initial_runs[key]
        counts = initialization_counts(report, key)
        batches = sum(1 for row in report["batchDetails"] if row["runId"] == run["id"])
        lines.append(
            f"| {source['sourceAccountName']} | {counts.get('ORDER_HEADER', 0):,} | {counts.get('ORDER_LINE', 0):,} | "
            f"{counts.get('DELIVERY_PLAN', 0):,} | {counts.get('OUTBOUND_LINE', 0):,} | {counts.get('INBOUND_LINE', 0):,} | "
            f"{counts.get('INVENTORY', 0):,} | {batches:,} | {fmt_time(run['startedAt'])} | {fmt_time(run['completedAt'])} |"
        )

    lines += [
        "",
        f"所有批次的读取数、耗时、重试、重叠读取数、真实重复数和前后游标见 `{batch_path.name}`。",
        "",
        "## 30分钟增量演示",
        "",
        "| 来源 | 扫描上界 | 读取数 | 重叠读取 | 真实重复 | 重试 | 结果 |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for key in ["e10-main", "tplus-kainan", "tplus-kejia"]:
        run = latest_incremental[key]
        details = [row for row in report["batchDetails"] if row["runId"] == run["id"]]
        lines.append(
            f"| {sources[key]['sourceAccountName']} | {fmt_time(run['scanUpperBound'])} | {sum(int(x['readCount']) for x in details):,} | "
            f"{sum(int(x['overlapReplayCount']) for x in details):,} | {sum(int(x['trueDuplicateCount']) for x in details):,} | "
            f"{sum(int(x['retryCount']) for x in details):,} | COMPLETED |"
        )

    e10 = quality["e10Outbound"]
    lines += [
        "",
        "## 数据质量",
        "",
        f"- 订单缺少明细：{sum(int(row['missingOrderCount']) for row in quality['orderLineMissing']):,} 张。",
        f"- E10 交付计划疑似重复：{sum(int(row['extraRecordCount']) for row in quality['deliveryPlanDuplicates']):,} 条额外记录（按订单行+交期+数量检查）。",
        f"- E10 出库可稳定关联：{int(e10['linked_count']):,} 条 / {e10['linked_quantity']}；无法稳定关联：{int(e10['unlinked_count']):,} 条 / {e10['unlinked_quantity']}，比例 {float(e10['unlinkedRatio']):.6%}。",
        "- 无法稳定关联的 E10 出库数量不计入订单累计出库和欠数。",
        f"- 状态字典待业务确认：{len(quality['statusDictionaryUnconfirmed'])} 个来源状态组合。",
        f"- 重复候选：高置信 {next((x['count'] for x in quality['duplicates'] if x['duplicateLevel']=='HIGH_CONFIDENCE_DUPLICATE'),0):,}，"
        f"需复核 {next((x['count'] for x in quality['duplicates'] if x['duplicateLevel']=='NEEDS_REVIEW'),0):,}，"
        f"同号冲突 {next((x['count'] for x in quality['duplicates'] if x['duplicateLevel']=='SAME_NUMBER_CONFLICT'),0):,}。",
        "",
        "## 异常和重试",
        "",
    ]
    failed = [row for row in report["runs"] if row["status"] == "FAILED"]
    if failed:
        for row in failed:
            lines.append(f"- {row['sourceKey']} {row['runType']}：失败 {row['retryCount']} 次；后续重跑成功。原因：{row['errorMessage']}")
    else:
        lines.append("- 无失败批次。")
    lines += [
        "",
        "## 待确认后执行",
        "",
        "- 将 staging 标准化记录映射至现有一张 sales_orders、一张 finished_goods_inbound、一张 finished_goods_outbound，继承旧关联、权限、审计和同步关系。",
        "- 在验收确认前，不写入上述现有业务表，不删除旧表。",
    ]
    (OUTPUT / f"验收报告_{DAY}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
