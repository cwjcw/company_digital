# Codex 工作进度

## 任务

任务名称：KN-MPS-LIVE-003-02：plan-projections 正式上线

任务目标：在保护已上线周计划执行、报工性能与包装规则的前提下，完成生产备份、基线审计、临时恢复库真实 dry-run；仅在全部门禁通过后开启并验证 `plan-projections`。

当前状态：已完成（NO-GO，未上线）

最后更新时间：2026-09-20

---

## 当前阶段

当前阶段：真实 dry-run 发现代码缺陷，已按门禁停止

当前子任务：无；等待另行修复后重新执行上线任务。

---

## 已完成

- [x] 读取任务要求、项目 AGENTS.md、架构、安全、运行手册与集成边界。
- [x] 读取并遵守 `kdos-form-platform` 技能约束。
- [x] 确认开始 HEAD 为 `c17a540`，初始工作区 clean。
- [x] 审查 `projectPlans()` 当前实现及既有投影测试，识别历史未映射月计划为必须实查的硬门禁。
- [x] 完成生产只读基线：六个同步开关符合预期；ERP 最近同步成功；14 张表基线已记录；有效客户 2、已映射 2、未映射 0；当前“空分配事业部但已有月计划”冲突为 0。
- [x] 完成三份备份及归档校验：`four_department_tracker`、`kdos`、uploads 均可读且 SHA256 已核对。
- [x] 将生产备份恢复到独立临时库，并使用生产 API 镜像内当前代码执行真实 `plan-projections` MANUAL dry-run。
- [x] dry-run 失败并完整回滚：客户代码为空的集团计划生成 NULL `exception_key`，违反 `mps_data_exceptions.exception_key` 非空约束。
- [x] 确认触发范围为 2 个活动订单、8 个品项：`2025A027103`（7 项）与 `2026A027319`（1 项）。
- [x] 确认临时库回滚后订单分配、月计划、集团计划逐行差异均为 0；生产核心表、同步日志与开关均未改变。
- [x] 按任务门禁判定 NO-GO；未启用 `plan-projections`，未执行第一次正式同步和第二次幂等同步，未修改业务代码。

## 正在进行

- 无。

## 待完成

- [ ] 另立修复任务处理 NULL 客户代码生成 NULL 异常键的问题，并补充“空客户代码 + 已有月计划/集团计划”的真实投影测试。
- [ ] 修复完成后重新执行 `KN-MPS-LIVE-003-02` 全部门禁、dry-run 与正式上线流程。

---

## 修改文件

- `outputs/CODEX_PROGRESS.md`

---

## 数据库 Migration

- 无。

---

## 新增或修改测试

- 无业务测试代码修改。
- 使用生产备份恢复出的独立临时数据库执行当前正式代码真实 dry-run。

---

## 已运行测试

测试名称：备份归档校验

结果：三份备份均通过 `pg_restore --list` / `tar -tzf` 校验。

测试名称：临时恢复库真实 `plan-projections` dry-run

结果：FAILED / NO-GO。`mps_data_exceptions.exception_key` 非空约束失败，投影事务完整回滚。

测试名称：生产无改动复核

结果：`plan-projections=false`；订单分配 1169、月计划 1169、集团计划 99，版本与更新时间未变；其他开关未变。

---

## 当前已知问题

- 缺陷：`refreshExceptions()` 对 `primary_division_id IS NULL` 的集团计划使用 `'customer:' || customer_code` 生成异常键；当 `customer_code` 为 NULL 时，`exception_key` 也为 NULL，导致整个 `plan-projections` 事务失败。
- 触发条件：活动 ERP 订单客户代码为空，且该订单已有月计划可供集团计划汇总。当前生产命中 2 个订单、8 个品项。
- 风险：若直接开启，正式同步会失败并回滚所有订单分配、月计划、入库和集团计划投影；定时任务还会周期性重试失败。
- 建议修复：为空客户建立稳定、非空且不碰撞的异常业务键，并确保未映射/空客户订单不会继续进入月计划和集团汇总；补充对应集成测试后重新 dry-run。

---

## 等待用户确认

- 无。

---

## 下一步

1. 本任务已按 NO-GO 停止，不在本任务内修改代码。
2. 新任务修复上述缺陷并完成定向测试。
3. 修复部署后，从备份与生产基线开始重新执行上线门禁。

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md 与 `.agents/skills/kdos-form-platform/SKILL.md`。
2. 读取本进度文件。
3. 执行 `git status`、`git diff --stat`。
4. 保留用户修改，从“下一步”的第一项未完成任务继续。
5. 当前为 NO-GO；不得延续本次 dry-run 结果直接开启生产开关，必须先完成独立修复并从头重跑上线门禁。

---

## 备份记录

- 时间：2026-09-20 08:54:10 +08:00
- `data/backups/four_department_tracker_20260920_085410.backup`：313068038 bytes；SHA256 `15f3d97d499ed6444ef03dfb02049376fc55d630821879415044e5cdd92e1f79`
- `data/backups/kdos_20260920_085410.backup`：8155720 bytes；SHA256 `f65dbdefd61025caf2c6d308057837a3425870f01fc48438ba7f69aff720b073`
- `data/backups/uploads_20260920_085410.tar.gz`：38271 bytes；SHA256 `089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`
