---
name: changjie-tplus-reader
description: 只读检查凯南数字化 KDOS 项目中用友畅捷通 T+19.0 的双账套 SQL Server 数据，包括科加智能工艺路线、工序、BOM、物料及其与主计划的映射。遇到 T+ 表结构、账套、工艺读取、同步源排障或数据字典问题时使用。
---

# KDOS / 畅捷通 T+19.0 账套只读技能

## 何时使用

用户要求读取/核验凯南或科加的 T+ 账套、定位工艺路线/工序/BOM/制造数据、解释 T+19.0 数据字典，或者设计后续 KDOS 接入时。

## 已证实的项目事实（来自 GitHub 代码，而非数据库实测）

- GitHub：`cwjcw/company_digital`；本地常用工作区：`/data/automation/code/work/PMC/knweb`。
- 科加智能 / 事业四部：源键 `tplus-kejia`，SQL Server 账套数据库 `UFTData418971_000003`。
- 凯南智能 / 事业三部：源键 `tplus-kainan`，数据库 `UFTData741219_000012`。
- 账套列表：`data-operations/order-sync/sources.json`。
- 现有代码：`data-operations/order-sync/sync.py`，其 `load_source("tplus-kejia")` 从项目根目录 `.env` 读取 `TPLUS_SQL_HOST/PORT/USER/PASSWORD` 并指定科加数据库；`Source.query()` 执行单条 SELECT，只读保护并使用 READ COMMITTED。
- 另一条订单查询链：`data-operations/tplus/tplus-reader.mjs`，目前用于订单而非工艺。
- **事实边界**：源代码有连接实现不等于当前线上连接健康；未取得科加实际工艺表结构和关系的运行结果前，不能称为已核验。

## 标准工作流程

1. 先读 `AGENTS.md`、此技能和 `references/tplus-schema-and-provenance.md`；根据用户本次任务判断范围，检查 Git 工作区及现有同步入口。不得将“查看工艺”直接扩大成同步、部署或更改主计划。
2. 优先使用已有的 `tplus-kejia` 数据源和凭据。验证 `DB_NAME()` 精确为 `UFTData418971_000003`；否则报告来源不匹配并停止该次读取。不要混用 `tplus-kainan` 或 E10。
3. 如需理解官方字典，请使用 `assets/Tplus19.0DataDic.chm`。若已有 7z 或 extract_chmLib，运行 `python scripts/chm_index.py --extract`；没有工具时使用 `--metadata` 查看内部条目清单，并向用户说明尚无法解析正文，不能把搜索结果猜成文件原文。
4. 在 `data-operations/order-sync/sync.py` 所用的同一 Python/环境下，执行 `scripts/inspect_kejia_routing.py` 的元数据模式：先核实表存在，再读字段类型、键和表间关系。默认不采集业务记录。
5. 经用户确有需要读取实际数据时，可指定 `--sample AA_Routing` 等，只取 TOP (5) 示例行；如涉及客户、人员、单价、敏感信息，则隐藏值，只记录必要字段。工序顺序、BOM 版本、启停状态、来源行 ID 必须以实际字段为准。
6. **只有**在本账套确认字段和关联键后，才能写出 JOIN SQL；联接不得靠名称相似猜测。应分别核实“工艺路线模板”、“BOM 的工序版本”和“加工单的执行工序”；这些不一定一致。
7. 如果用户要求与 KDOS 主计划对接，先提出只读数据模型和差异清单。应遵守当前项目“自制才生成工序；外协/外购不生成工序任务”的业务规则，复用现有 Integration Adapter/Canonical Model，避免让 Planning 直连 T+。
8. 结束时说明：确认的账套、数据库实测是否成功、存在的表/列、证实的关系、示例条数、缺少的证据及建议下一步。不得把“代码通过检查”“真实库查询通过”“正式同步上线”混为一谈。

## SQL/安全边界

- 读取任务使用 `SELECT`/元数据查询，复用现有只读连接；不为读取工艺申请管理权限，也不修改源 ERP 数据。
- 不在对话、日志或生成文件中打印 `.env`、密码、API Key、连接串中的密钥。
- 不在查明原因之前执行大表全量导出、跨账套写入、结构迁移或定时任务变更；如确实需要新的写入/部署权限，先明确影响范围并征求用户确认。
- 不自动备份数据库；按照实际操作风险评估，不将备份虚构为脚本门禁。
- 不自动执行 Git commit/push，也不部署；向用户说明操作后再执行。读取仓库和本地生成文件与推送是不同操作。
- 不因“必须/禁止/全部/任何”等绝对词而自行扩大旧规则范围；涉及实质执行边界争议时先向用户确认。

## 参考资料与脚本

- [科加工艺候选表、证据等级、验证步骤](references/tplus-schema-and-provenance.md)
- [T+19 CHM 上传文件检查记录](references/chm-status.md)
- [SQL Server 只读探查 SQL](references/inspect-kejia.sql)
- `scripts/inspect_kejia_routing.py`：复用 KDOS `sync.py` 读取指定源的元数据与少量样例。
- `scripts/chm_index.py`：解析 CHM 目录；支持本机 7z/extract_chmLib 解压正文并生成关键词索引。
