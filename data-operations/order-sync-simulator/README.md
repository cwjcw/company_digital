# E10 / T+ 订单只读同步模拟器

该程序只读取三个彼此独立的 SQL Server 数据源：E10、T+ 凯南智能和 T+ 科加智能。它没有 PostgreSQL 连接或 API 写入代码，只在本机 `data/order-sync-simulator/` 下保存独立游标和脱敏后的模拟报告。

## 固定安全约束

- 数据查询只允许单条 `SELECT`，代码会拒绝 `INSERT`、`UPDATE`、`DELETE`、`ALTER`、`DROP`、`CREATE`、`MERGE`、`TRUNCATE`、`EXEC` 和 `DBCC`。
- 每个连接显式执行会话级 `READ COMMITTED`，锁等待上限为 5 秒。
- E10 连接从 `/data/automation/code/work/basci/basic_code/.env` 读取；T+ 连接只读取项目现有 `TPLUS_SQL_*`。凭据不会进入报告。
- 三个来源各有一个游标文件；每个来源的五个数据流又各有独立的“修改时间＋主键”游标。
- 每批最多 1,000 行，默认回看 30 分钟并向前重叠 2 分钟。重叠行必须由正式同步以来源复合标识幂等处理。
- 游标和报告都是本地文件，权限为 `0600`，且 `data/` 已被 Git 忽略。

## 数据流映射

| 系统 | 订单主表 | 订单明细表 | 交付计划 | 出库明细 | 库存 |
| --- | --- | --- | --- | --- | --- |
| E10 | `SALES_ORDER_DOC` | `SALES_ORDER_DOC_D` | `SALES_ORDER_DOC_SD` | `SALES_ISSUE_D` | `ITEM_WAREHOUSE` |
| T+ | `SA_SaleOrder` | `SA_SaleOrder_b` | `SA_SaleOrder_b.deliveryDate` | `ST_RDRecord_b` | `ST_NewCurrentStock` |

T+ 的交付计划不是独立物理表。模拟器为它建立独立逻辑流和游标，但 `source_table` 始终如实记录 `SA_SaleOrder_b`。为了识别交期被清空的修改，该逻辑流不能只筛选 `deliveryDate IS NOT NULL`。

## 运行

使用已有 Python 环境：

```bash
automation/customer_import/.venv/bin/python data-operations/order-sync-simulator/simulate.py
```

只测试单个或多个来源：

```bash
automation/customer_import/.venv/bin/python data-operations/order-sync-simulator/simulate.py --source e10
automation/customer_import/.venv/bin/python data-operations/order-sync-simulator/simulate.py --source tplus-kainan --source tplus-kejia
```

程序是一次性任务；正式调度器应每 30 分钟调用一次。确认前不要配置计划中心写入。若只想复查查询而不推进本地模拟游标，可加 `--no-advance-cursors`。

每次运行生成：

- `<批次>.json`：完整摘要和待同步记录；
- `<批次>_records.csv`：仅含来源标识、主键、订单号和修改时间；
- `<批次>_tables.csv`：每张表的游标、数量、耗时、重复和边界风险。

正式同步的每条记录必须携带：`source_system`、`source_database`、`source_table`、`source_id`、`source_order_id`、`source_order_line_id`。计划中心写入不属于本模拟器范围。
