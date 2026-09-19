# Codex 工作进度

## 任务

任务名称：KN-MPS-PROC-PACKAGING-001

任务目标：所有有效周计划均有已启用的包装工序；仅自制、自制+外协启用其余内部工序，并同步报工准入与历史数据。

当前状态：已完成

最后更新时间：2026-09-19

---

## 当前阶段

当前阶段：已部署并完成生产数据核验

当前子任务：无

---

## 已完成

- [x] 确认开始 HEAD 为 `2594893`，工作区 clean；此前性能优化与出货表记录已单独提交。
- [x] 在领域层新增唯一权威 `shouldEnableProcess`：包装始终启用，其余内部工序仅自制、自制+外协启用；同步和报工准入共同复用。
- [x] 改造 `ensureExecutionRows()`：无评审交期或工序周期时仍以空周期/交期创建包装任务；外协、中心外购仅关闭非包装内部工序；外协任务规则未改动。
- [x] 增加默认 dry-run 的 `repair-packaging-execution` 维护命令：只选择包装缺失/禁用的有效周计划，逐条调用正式 `MasterPlanApplicationService.refreshWeeklyExecution()`，带审计并校验实际报工事实不变。
- [x] 修正系统调用审计来源与生产枚举的兼容：应用层 `system` 统一持久化为审计允许的 `api`。
- [x] 部署前只读扫描：自制 496、自制+外协 551、外协 49、中心外购 30、NULL 43 条周计划；包装缺失均为 0，包装禁用为外协 49、中心外购 30。
- [x] 完成两次可校验备份；最终使用正式刷新命令修复外协 49、中心外购 30，共 79 条；候选剩余 0。
- [x] 实际工序报工保护：修复目标内记录数、数量合计、生产日期非空数均为 6 / 270.0000 / 6，修复前后完全一致。
- [x] 线上复核：五类生产方式包装缺失、禁用均为 0；`2026A027336 / TGH002HT-1/1`（自制）十道工序均启用；`2026A027323 / GKR585KB-1/1`（中心外购）仅包装启用且满足待报工条件；79 条刷新均留有审计。

## 正在进行

- 无

## 待完成

- 无

---

## 修改文件

- apps/api/src/modules/master-plan-system/master-plan.domain.ts
- apps/api/src/modules/master-plan-system/master-plan.sync.service.ts
- apps/api/src/modules/master-plan-system/master-plan.application.service.ts
- apps/api/src/modules/master-plan-system/repair-packaging-execution.ts
- 对应 API 单元测试
- outputs/CODEX_PROGRESS.md

## 数据库 Migration

- 无。

## 新增或修改测试

- 四种生产方式包装启用矩阵；外协/中心外购非包装工序拒绝。
- 无评审交期、无工序周期时包装任务存在且启用。
- 生产方式切换时包装始终启用、其余内部工序切换。
- 系统刷新审计来源规范化。

## 已运行测试

测试名称：API 定向测试

结果：3 套、87 项通过。

测试名称：API 全量测试

结果：56 套、449 项通过。

测试名称：API typecheck / lint

结果：通过。

测试名称：Web 全量测试 / typecheck / lint

结果：22 套、132 项通过；typecheck 通过；lint 无错误（1 条既有 Fast Refresh 警告）。

测试名称：项目全量 `pnpm test` / `pnpm build`

结果：通过（运行时宿主 Node 22 有项目声明 Node 24 的引擎警告；Docker 生产构建使用 Node 24 并通过）。

测试名称：线上健康、历史回补与数据复核

结果：API、Web、Postgres 均 healthy；包装规则、待报工条件、审计和实际报工保护均通过。

## 当前已知问题

- 无。

## 等待用户确认

- 无。

## 下一步

1. 任务已完成；保留本记录用于后续追溯。

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md、SKILL.md 和本进度文件。
2. 执行 `git status` 和 `git diff --stat`。
3. 本任务无需继续；后续变更仍须复用 `shouldEnableProcess` 和正式 execution refresh。
