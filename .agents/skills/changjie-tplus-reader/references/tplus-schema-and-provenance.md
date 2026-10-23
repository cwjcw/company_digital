# 科加 T+19.0 工艺查询：证据与口径

## 来源证据等级

| 项目 | 内容 | 证据等级 |
|---|---|---|
| 科加数据库 | `UFTData418971_000003` | 已从当前仓库配置和 reader 源码核实；尚未连接真实数据库 |
| 凯南智能数据库 | `UFTData741219_000012` | 已从仓库配置核实 |
| `tplus-kejia` 读取方式 | `data-operations/order-sync/sync.py` 的 `load_source` 和只读 `Source.query` | 已从源码核实 |
| `AA_ProductProcess` | 产品工序/工序档案 | T+ 数据字典网页确认的候选，科加库存在性待检 |
| `AA_Routing`、`AA_Routing_b` | 标准工艺路线表头和明细 | T+ 数据字典网页确认的候选，字段/关联待检 |
| `AA_BOM`、`AA_BOMChild` | BOM 表头和子件 | T+ 数据字典网页确认的候选；不意味着工序必定存于 BOMChild |
| `AA_Inventory` | 存货档案，可能连接品号 | 字典候选；关联键待检 |
| 生产加工单工序、工序报工 | T+ 在业务层面支持，相关实际表名待查 | 待核验 |

公开候选字典：
- https://www.laoliang.net/cwrj/youyou/20435.html
- https://www.ahyonyou.com/news/609.html
产品行为：
- https://t.static.chanjet.com/notice/md/main/nineteen/04_scgl.html （T+19 工序来源于 BOM 或工艺路线时记录来源行 ID）
- https://www.hachliy.com/new/710.html （T+19 BOM 批量同步工艺路线时可能重取工序明细）
- https://t.static.chanjet.com/notice/tplushelp/guid/wlqd.html （BOM 父件+版本口径）

**请勿**把这些网页的描述写成上传 CHM 中已提取、已核验的字段；上传的 CHM 目前只完成了目录解析，没有解压 HTML 正文。

## “读取科加工艺”应回答的三个问题

1. **标准工艺**：科加有哪些工序和工艺路线？每条路线含哪些工序、顺序和启停状态？
2. **品号工艺**：品号、BOM 版本与标准路线/实际 BOM 工序如何关联？有没有多个版本、默认 BOM、已经停用的路线？
3. **执行工艺**：生产加工单使用的实际工序是否从 BOM/路线复制并发生调整？不要把执行历史直接用作当前标准工艺。

## 字段关联的验证要求

- 先用 SQL Server 元数据查询证实表、列、外键；T+ 部分关联可能无数据库外键，需进一步读取极少量实例并对照 T+ 前台。
- 确认物料 ID、品号、工艺路线 ID、明细父键、顺序字段、状态及版本字段，**不预设** `ID`、`idRouting`、`sequence`、`ProcessCode` 等名称真实存在。
- 同一工序可重复出现在一条路线中；联接不得仅凭工序编码去重；保留行级 ID、源行 ID 和序号。
- 如果最终用于 KDOS 主计划，输出必须标明：来源账套/数据库、品号、BOM 版本、工艺路线版本、工序顺序、工序名称、是否适用、来源更新时间、同步时间，且区分自制/外协/外购。
- 任务止于只读查询时不创建新的定时器、迁移或业务表。同步需求另起经确认的任务。

## 现有代码位置

- `data-operations/order-sync/sources.json`
- `data-operations/order-sync/sync.py`
- `data-operations/order-sync/sync-kejia-orders.sh`
- `data-operations/tplus/tplus-reader.mjs`
- `integrations/tplus/src/index.ts`

由于同一项目的代码可能更新，任务开始时应重新核查路径和当前内容。
