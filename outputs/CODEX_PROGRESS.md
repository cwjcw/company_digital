# Codex 工作进度

## 任务

任务名称：KN-MPS-PROJ-CUSTOMER-GUARD-001：空客户代码投影保护

任务目标：安全阻断空客户代码订单进入月计划和集团主计划，保留可追踪订单分配，生成稳定且可闭环的数据异常；部署后仅在临时恢复库验证，保持 `plan-projections=false`。

当前状态：进行中

最后更新时间：2026-09-20

---

## 当前阶段

当前阶段：部署前备份与提交

当前子任务：代码和回归已通过；准备重新备份、提交并部署 API。

---

## 已完成

- [x] 读取任务要求、项目规则、架构/安全/运行手册、当前进度和完整 `kdos-form-platform` 技能规范。
- [x] 确认开始 HEAD 为 `b9619bf`，工作区 clean；上一任务未开启 `plan-projections`。
- [x] 确认生产真实问题样本为 `2025A027103`（7项）和 `2026A027319`（1项），当前生产同步开关符合保护要求。
- [x] 确认 `exception_type` 为无 CHECK 的 varchar；本任务无需 Migration。
- [x] 在 `projectPlans()` 中将空客户、缺映射、正常映射明确分流：订单分配保留；月计划要求事业部及非空客户；集团主计划要求全部活动明细客户非空且存在 enabled 映射。
- [x] 在 `refreshExceptions()` 中新增 `MISSING_CUSTOMER_CODE`，以订单/品项或集团订单生成稳定非空异常键；空客户不再伪装为缺主责事业部；新增异常纳入 resolve 生命周期。
- [x] 在同步 metrics 中新增 `blocked_by_missing_customer_code`，并使 `blocked_by_missing_customer_mapping` 仅统计客户代码有效但无事业部的分配。
- [x] 扩展主计划投影测试，覆盖 NULL、空字符串、空白、缺映射、正常映射、幂等异常键、客户补齐 resolve 与历史空客户集团计划保护。
- [x] 完成 API/Web 全量测试、typecheck、lint 与 API build。

## 正在进行

- [ ] 重新备份、提交、部署 API，并以生产备份临时库验证真实样本。

## 待完成

- [ ] 补齐 NULL、空字符串、空白、缺映射、正常映射、重复执行、补齐客户代码、历史空客户集团计划的测试。
- [ ] 运行 API/Web 测试、typecheck、lint 与构建。
- [ ] 备份、部署 API，验证健康检查与同步开关。
- [ ] 使用生产备份临时库验证两条真实样本；不执行 LIVE-003-02 正式切换。
- [ ] 提交并推送 GitHub main、Gitee master，确保最终工作区 clean。

---

## 修改文件

- `outputs/CODEX_PROGRESS.md`

---

## 数据库 Migration

- 无：`mps_data_exceptions.exception_type` 为无 CHECK/enum 的 varchar。

---

## 新增或修改测试

- `master-plan.live-projection.spec.ts`：空客户代码投影保护 8 类验收场景与 metrics 契约。

---

## 已运行测试

测试名称：API 主计划投影定向测试

结果：1 套、13 项通过。

测试名称：API 全量测试 / typecheck / lint / build

结果：56 套、457 项通过；typecheck、lint、build 通过。

测试名称：Web 全量测试 / typecheck / lint

结果：22 套、132 项通过；typecheck 通过；lint 无错误（1 条既有 Fast Refresh 警告）。

---

## 当前已知问题

- 无；尚待生产备份临时库验证与部署后健康检查。

---

## 等待用户确认

- 无。

---

## 下一步

1. 执行部署前备份并校验。
2. 提交实现，构建和滚动部署 API，核验 API/Web/Swagger/OpenAPI/PostgreSQL 健康。
3. 在新生产备份恢复的临时库执行两次真实投影，验证样本、异常生命周期和幂等；生产开关保持关闭。

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md、`.agents/skills/kdos-form-platform/SKILL.md` 与本文件。
2. 执行 `git status`、`git diff --stat`。
3. 保留未提交修改，从“下一步”的第一项继续。
4. 禁止开启 `plan-projections`；正式切换必须由重新执行的 `KN-MPS-LIVE-003-02` 决定。
