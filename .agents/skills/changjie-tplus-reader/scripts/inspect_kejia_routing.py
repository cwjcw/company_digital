#!/usr/bin/env python3
"""KDOS 现有 tplus-kejia 数据源的只读元数据探查；不写源/目标数据库。"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

EXPECTED_SOURCE = "tplus-kejia"
EXPECTED_DATABASE = "UFTData418971_000003"
CANDIDATES = ("AA_ProductProcess", "AA_Routing", "AA_Routing_b", "AA_BOM", "AA_BOMChild", "AA_Inventory")


def project_root() -> Path:
    # 源码文件在 <PROJECT>/.agents/skills/changjie-tplus-reader/scripts/ 本地安装
    return Path(__file__).resolve().parents[4]


def quote_ident(s: str) -> str:
    return '[' + s.replace(']', ']]') + ']'


def display(title: str, rows: list[dict], limit: int = 1000):
    print(f"\n### {title}: {len(rows)} 条")
    for row in rows[:limit]:
        print(json.dumps(row, ensure_ascii=False, default=str))
    if len(rows) > limit:
        print(f"...省略 {len(rows)-limit} 条")


def run(args):
    root = project_root()
    sync_dir = root / 'data-operations' / 'order-sync'
    if not (sync_dir / 'sync.py').exists():
        raise RuntimeError(f'找不到项目已有的采集器: {sync_dir / "sync.py"}。请把 Skill 安装在项目 .agents/skills 下')
    sys.path.insert(0, str(sync_dir))
    from sync import load_source
    src = load_source(EXPECTED_SOURCE)
    try:
        actual = src.query('SELECT DB_NAME() AS source_database')[0]['source_database']
        if actual.casefold() != EXPECTED_DATABASE.casefold():
            raise RuntimeError(f'拒绝读取：当前数据库 {actual!r} 不是科加账套 {EXPECTED_DATABASE}')
        print(f'已确认科加账套：{actual}（仅查询，不同步，不更改源库）')

        tables = src.query('''SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE' AND
(TABLE_NAME LIKE '%Routing%' OR TABLE_NAME LIKE '%Process%' OR TABLE_NAME LIKE '%BOM%' OR TABLE_NAME LIKE '%Inventory%' OR TABLE_NAME LIKE '%Manufactur%')
ORDER BY TABLE_SCHEMA, TABLE_NAME''')
        display('候选表', tables)
        chosen = [x for x in tables if x['TABLE_NAME'].casefold() in {v.casefold() for v in CANDIDATES}]
        print('\n字典推荐的候选表是否存在：')
        for name in CANDIDATES:
            matches = [x for x in chosen if x['TABLE_NAME'].casefold() == name.casefold()]
            print(f'  {name}: {", ".join(x["TABLE_SCHEMA"] + "." + x["TABLE_NAME"] for x in matches) if matches else "未找到（检查版本/权限）"}')
        cols = src.query('''SELECT TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('AA_ProductProcess','AA_Routing','AA_Routing_b','AA_BOM','AA_BOMChild','AA_Inventory')
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION''')
        display('候选表字段', cols)

        fks = src.query('''SELECT fk.name AS fk_name, sp.name AS parent_schema, tp.name AS parent_table,
cp.name AS parent_column, sr.name AS ref_schema, tr.name AS ref_table, cr.name AS ref_column
FROM sys.foreign_keys AS fk
JOIN sys.foreign_key_columns AS fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.tables AS tp ON tp.object_id = fk.parent_object_id
JOIN sys.schemas AS sp ON sp.schema_id = tp.schema_id
JOIN sys.columns AS cp ON cp.object_id = tp.object_id AND cp.column_id = fkc.parent_column_id
JOIN sys.tables AS tr ON tr.object_id = fk.referenced_object_id
JOIN sys.schemas AS sr ON sr.schema_id = tr.schema_id
JOIN sys.columns AS cr ON cr.object_id = tr.object_id AND cr.column_id = fkc.referenced_column_id
WHERE tp.name LIKE '%Routing%' OR tr.name LIKE '%Routing%'
OR tp.name LIKE '%BOM%' OR tr.name LIKE '%BOM%'
OR tp.name LIKE '%Process%' OR tr.name LIKE '%Process%'
ORDER BY parent_table, ref_table, fk.name''')
        display('可能相关的物理外键', fks)
        if args.sample:
            matches = [x for x in chosen if x['TABLE_NAME'].casefold() == args.sample.casefold()]
            if len(matches) != 1:
                raise RuntimeError(f'样例表 {args.sample} 不存在或同名歧义，不读取数据')
            t = matches[0]
            q = f'SELECT TOP (5) * FROM {quote_ident(t["TABLE_SCHEMA"])}.{quote_ident(t["TABLE_NAME"])}'
            display(f'最多 5 行的样例 {t["TABLE_SCHEMA"]}.{t["TABLE_NAME"]}（请勿公开敏感值）', src.query(q), limit=5)
        print('\n只读探查结束。字段 JOIN 与业务口径应由科加库实际字段和 T+ 前台核验后再确定。')
    finally:
        src.close()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='复用 KDOS tplus-kejia SQL Server 连接，检查工艺表的元数据')
    p.add_argument('--sample', choices=CANDIDATES, help='额外读取指定候选表 TOP (5) 样例，默认不读取业务记录')
    args = p.parse_args()
    try:
        run(args)
    except Exception as exc:
        print(f'探查失败: {exc}', file=sys.stderr)
        raise SystemExit(1)
