# KDOS 财务订单缺失、ERP 删除同步及系统时间验收报告

## 状态

- 任务状态：`PASS`
- 调查基线：2026-10-22，Asia/Shanghai
- 起始版本：`b05df9153671ef9aab2a4e71760035ed270278d4`
- 功能发布 Commit：`4ee9a798eb81444b1648a6aaf749b4108775fd52`
- 生产变更：已备份、执行前向 Migration，并通过原有财务日流程的 `--update-only` 模式完成一次受控增量；未发送企业微信消息、未执行 FULL、未修改 E10。

## 指定订单只读调查

### 2301-2026A003326

- 租户/账套/真实来源订单 ID：`KAINAN / E10_6.0.0.1.NEW.CHS / 7115b327-eabd-443d-b48d-1e0d786034aa`。
- 订单日期：2026-10-21。
- E10 当前有 2 个品项，含税本币金额 `2718.60`；两个品项序号分别为 1、2。
- 订单头 `headerCloseCode=0`；两个品项 `closeCode=0`、`hasSpecifiedCloseSchedule=false`、`source_issue=false`。
- `conflict=false`、`duplicate_sequence=false`、`missing_lines=0`、`issue_lines=0`、`line_count=2`、`order_total=2718.60`。
- `material=false`、`approved=true`、`eligible=true`。
- 唯一命中的排除标志为 `duplicate_order_no=true`，因此 `finance_e10_movement_source` 和 `finance_e10_order_monthly_movements` 均无记录。
- 具体排除条件：`NOT o.duplicate_order_no`。同单号旧来源 ID `fae8b350-b1d4-4ea2-3148-1e0c97bb0458` 已于 E10 物理删除，但 KDOS 仍为 `source_missing=false`，使窗口表达式 `count(*) OVER (PARTITION BY tenant_id,source_database,order_no)>1` 误判重复单号。
- 这是程序误判。它与 `2301-2026A5001026` 的共同根因均为：物理删除的旧来源身份未在增量同步中失效。后者此前经 FULL 标记缺失后已经恢复正常；本次修复让日常增量也能识别。
- 修复后已在 `2026-10` 以“新增”计入 `2718.60`；系统导出显示当前 2 个品项，月度数据显示 1 行。

### S-2610020

- 租户/账套/来源订单 ID：`KAINAN / E10_6.0.0.1.NEW.CHS / b860654a-5134-4ecd-684c-1e04baa3f351`。
- 订单日期：2026-10-10。
- KDOS 保存 2 个品项，金额 `18442.79 + 20647.73 = 39090.52`；修复前两行均为 `source_missing=false`，系统导出、有效订单和 2026-10 月度发生额均仍显示 `39090.52`。
- E10 当前订单头 0 行、品项 0 行；DataLog 在 2026-10-21 11:19:39 记录订单头及两个品项 `ActionType=1`，能够证明物理删除。
- 修复后正常系统导出、有效订单、月度数据、统计大屏、客户排名和接单发生额均已排除；`finance_e10_lines` 的 2 个原始品项、原金额、版本和审计日志继续保留，且均为 `source_missing=true`。
- 删除是技术来源失效，不生成 2026-10 的虚构负金额变更事件。

## 同类影响范围

- 只读全源身份清单：E10 2025 年以来 `19115` 张订单、`108090` 个品项，实测读取 `1.457s`。
- 待标记来源缺失：11 个品项；待恢复：0 个。
- 整单来源已删除：3 个来源订单；部分品项删除：2 张订单。
- 修复前仍错误计入正常月度统计：1 张，即 `S-2610020`，金额 `39090.52`。其他整单删除来源已因既有业务规则排除，额外正常统计影响为 0 张、`0.00`。
- 重复单号误判：1 张，即 `2301-2026A003326`，金额 `2718.60`；同根因的其他误排订单为 0 张、`0.00`。
- 两张部分删除订单缺失的 6 个品项金额均为 `0.00`，保留其仍存在品项，不整单排除。
- 两张指定订单对正常发生额的净修正：`2718.60 - 39090.52 = -36371.92`。受控日增量同时读取到 E10 当日其他真实业务变化，因此该数值只表示本问题的定向修正，不冒充整次日增量的总变化。

## 实现

- 新增前向 Migration `1722920105000-FinanceE10SourcePresenceAndTimestamps`，不修改历史 migration。
- 增量 Reader 每次额外读取轻量来源身份清单，分页暂存并按年度数量、订单数、全局唯一性及最大降幅门禁独立对账；连接失败、超时、清单不完整或异常大幅下降时整次发布失败，不修改已发布状态。
- 增量发布将 E10 已不存在的品项标记为 `source_missing=true`；来源重新出现时复用原 UUID 并写恢复审计。整单和单品项删除均按真实来源身份处理。
- 系统导出默认隐藏 `source_missing` 行；管理追溯仍可从原表、同步批次和审计日志取得历史证据。
- 派生视图仅使用当前来源品项计算资格、重复单号和有效金额。删除品项关联的历史变更事件继续保留，但正常统计不再计入；来源恢复后原事件重新按同一身份生效，不复制事件。
- 系统导出的创建/更新时间直接来自 `finance_e10_lines.created_at/updated_at`。内容无变化的重读只更新观察批次，不更新 `updated_at`。
- 月度行创建时间取构成该“订单×发生月份”的持久来源行/变更事件最早创建时间；更新时间取来源行、变更事件和当前客户分类映射的最后持久更新时间。视图不使用查询时钟，也不虚构历史时间。
- 现有 n8n 每日 08:30 财务流程继续调用原 `run-finance-daily.sh`；不新增 Timer、cron 或第二条工作流。来源存在性扫描随每日增量执行一次。

## 本地与隔离验收

- API 聚焦测试：55 项通过。
- Web 财务测试：13 项通过。
- Contracts：33 项通过。
- Python E10 Reader：5 项通过。
- 隔离 PostgreSQL：核心 50 场景、变更台账 12 场景通过。
- 覆盖：整单/单品项删除、不完整清单原子拒绝、来源恢复、重复单号修复、历史事件保留且不重复、时间字段、Excel、RLS、字段权限、数据范围和金额勾稽。
- 全项目 `typecheck`、`lint`、`build` 通过；lint 只有既有 Fast Refresh 警告，Web build 只有既有大包提示。

## 发布保护

- 生产发布前版本：Repository/Web/API 均为 `b05df9153671ef9aab2a4e71760035ed270278d4`；四个 Compose 服务健康。
- 生产备份：`four_department_tracker_20261022_195052.backup`、`kdos_20261022_195052.backup`、`uploads_20261022_195052.tar.gz`；均为 600 权限，数据库归档通过 `pg_restore --list`，附件归档可读，SHA-256 已保存在私有验收证据中。
- 生产数据库发布前无阻塞会话；最近订单余额及变更台账批次均为 `SUCCESS`。

## 生产迁移与受控数据修复

- GitHub `github/main` 已正常 push 功能 Commit `4ee9a798eb81444b1648a6aaf749b4108775fd52`，未 force push。
- `./scripts/deploy.sh all` 成功；随后按项目 TypeORM 正式命令事务执行 Migration `FinanceE10SourcePresenceAndTimestamps1722920105000`，ledger ID 为 104。Presence 暂存表启用并强制 RLS。
- Migration 完成后 Repository、Web、API 均为 `4ee9a79`，`./scripts/deploy.sh check` 返回 `STATUS=CONSISTENT`，Web/API/PostgreSQL/Document Worker 均健康。
- 受控执行 `run-finance-daily.sh --update-only` 成功，订单余额批次 `01a1637c-8f08-7b7c-97ff-2fdf2ac6d6a5`；Presence 清单仍为 2025 年 60332 行、2026 年 47758 行，合计 108090 行。
- 本次对账标记 11 个已不存在的 E10 品项，审计为 `finance.e10.source.missing` 11 条；恢复 0 条。通知结果为 `enqueued=0`、`UPDATE_ONLY_NO_NOTIFICATION`。
- `2301-2026A003326` 旧来源的 1 个零金额品项已失效，当前来源 2 个品项的 `created_at/updated_at` 仍为 2026-10-22 08:30:05，证明无业务变化重读没有刷新更新时间。
- `S-2610020` 的 2 个历史品项仅更新来源缺失状态和审计，原记录、原金额与 UUID 未删除；未生成该订单的虚构金额变更事件。
- 同一次正常日增量还形成 79 个真实 E10 金额事件；它们来自其他订单的真实源端变化，与删除识别区分记录，未归因给两张指定订单。

## 金额、业务规则与性能验收

- 逐 `tenant_id/source_database/source_order_id` 对账：所有月份发生额之和与有效订单金额差异为 0，绝对差异为 `0.00`。
- 2026-10 月度数据、统计大屏事业部、内外销及客户维度均为 514 张、`39115212.02`，四个口径完全一致。
- 统计大屏 API 实测约 3379ms；客户排名约 3492ms；月度指定订单真实执行计划约 4661ms，整月汇总约 3252ms，未恢复此前约 30 秒的慢查询。
- 材料销售单 3651 张、未审核订单 132 张仍被排除；指定结束、重复金额事件和多品项订单规则的隔离 PostgreSQL 回归均通过。
- 6 项主计划同步开关、管理员授权、用户角色、角色和客户映射保持不变。Migration 只按既有角色复制新增时间字段的读取权限，共增加 4 条预期字段权限记录。
- 生产实际 `pg_get_viewdef` 已逐一读取 `finance_e10_raw`、`orders_all`、`order_eligibility`、`monthly`、`movement_source`、`order_monthly_movements` 和 `changes`；全部使用来源缺失状态，月度派生视图没有使用 `now()`、`clock_timestamp()` 或 `statement_timestamp()` 伪造时间。

## 网页与 Excel 验收

- 使用 Chrome 153 真实登录生产页面，并在浏览器侧拦截所有非 GET 请求，验收期间没有业务写入。
- 系统导出：创建时间、更新时间各显示一次；搜索 `S-2610020` 为 0 行；搜索 `2301-2026A003326` 为 2 行。
- 系统导出 Excel `finance-e10-lines.xlsx`：36 列、2 条数据；两个时间均为 `2026-10-22 08:30:05`。
- 月度数据：创建时间、更新时间各显示一次；`S-2610020` 为 0 行；`2301-2026A003326` 为 1 行，发生年月 `2026-10`、业务类型“新增”、本月发生额 `2718.60`。
- 月度 Excel `finance-e10-monthly.xlsx`：17 列、1 条数据，本月发生额 `2718.60`，创建/更新时间均为 `2026-10-22 08:30:05`。
- 页面和 Excel 使用 Asia/Shanghai；KdosDataTable 对同名系统时间列完成去重，没有重复列。浏览器记录中服务端错误 0、被拦截写请求 0。

## 调度与通知

- n8n 当前运行态已只读核验：`KDOSFinanceMonthlySummaryV1` 已启用，名称为“KDOS 财务每日增量更新及月度汇总”，Cron 为 `30 8 * * *`，调用 `bash .../run-finance-daily.sh`。
- `KDOSFinanceMovementsV1` 已停用，只保留“手工补跑”节点，不构成第二个自动调度入口。
- 系统和用户 systemd Timer 中没有财务订单余额自动任务；本次未新增、停用或改频任何调度，企业微信仍由系统消息中心在每日流程完成后投递。

## 最终结论

- `2301-2026A003326`：程序误判已修复，月度发生额 `2718.60` 已真实显示。
- `S-2610020`：E10 物理删除证据充分，KDOS 正常业务数据已排除，历史数据和审计完整保留。
- 同类影响：重复单号误排 1 张/`2718.60`；正常统计误含已删除订单 1 张/`39090.52`；其他同根因正常金额影响为 0。
- ERP 删除识别频率：每天一次，随 n8n 08:30 的原有增量和月度汇总运行；连接或完整性校验失败时拒绝发布，不误标删除。
- 系统导出时间来源：`finance_e10_lines.created_at/updated_at`。月度时间来源：持久化来源品项、金额事件和客户分类映射的最早创建/最后更新时间。
- 代码、Migration、真实数据修复、网页、Excel、统计大屏、权限和调度验收均通过。
