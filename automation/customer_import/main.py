#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import sys
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from api_client import KdosImportClient
from readers import E10Reader, TplusReader
from report import create_report


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="按客户从 T+/E10 抽取订单和出入库数据，并通过 KDOS 应用命令导入。")
    value.add_argument("--source", choices=["tplus", "e10"], required=True, help="来源数据库")
    scope = value.add_mutually_exclusive_group(required=True)
    scope.add_argument("--customer", help="指定客户代码，例如 A027")
    scope.add_argument("--all", action="store_true", help="逐客户导入来源库中的全部客户")
    value.add_argument("--database", default="all", help="指定来源账套；T+ 默认查询两个账套")
    value.add_argument("--clear-demo-data", action="store_true", help="首个快照写入前清理现有 DEMO/测试业务数据")
    value.add_argument("--dry-run", action="store_true", help="仅抽取、统计并生成清单，不写入 KDOS")
    value.add_argument("--output-dir", type=Path, default=PROJECT_ROOT / "outputs", help="Excel 清单输出目录")
    return value


def main() -> int:
    args = parser().parse_args()
    reader = TplusReader(PROJECT_ROOT, args.database) if args.source == "tplus" else E10Reader(PROJECT_ROOT, args.database)
    customers = reader.customers() if args.all else [args.customer]
    all_snapshots: list[dict[str, Any]] = []; results: list[dict[str, Any]] = []
    clear_demo = args.clear_demo_data
    client = None if args.dry_run else KdosImportClient(PROJECT_ROOT)
    for index, customer in enumerate(customers, start=1):
        print(f"[{index}/{len(customers)}] 抽取 {args.source.upper()} 客户 {customer} …", flush=True)
        snapshots = reader.snapshots(customer, replace_demo_data=clear_demo)
        if not snapshots:
            print(f"  未找到客户 {customer} 的订单，跳过。", flush=True)
            continue
        clear_demo = False
        for snapshot in snapshots:
            inbound = sum(1 for row in snapshot["movements"] if row["direction"] == "INBOUND")
            outbound = sum(1 for row in snapshot["movements"] if row["direction"] == "OUTBOUND")
            print(f"  {snapshot['sourceDatabase']}：订单明细 {len(snapshot['orders'])}，入库 {inbound}，出库 {outbound}", flush=True)
            all_snapshots.append(snapshot)
            if client:
                results.append(client.import_snapshot(snapshot)); print("  KDOS 写入完成。", flush=True)
    if not all_snapshots:
        raise RuntimeError("没有抽取到可导入的客户数据")
    label = args.customer if args.customer else f"{args.source.upper()}_全部客户"
    report = create_report(args.output_dir, label, all_snapshots, results, args.dry_run)
    print(f"导入清单：{report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
