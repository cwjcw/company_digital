# Codex 工作进度

## 任务

任务名称：KN-MPS-PROJ-CUSTOMER-GUARD-001：空客户代码投影保护

任务目标：安全阻断空客户代码订单进入月计划和集团主计划，保留可追踪订单分配，生成稳定且可闭环的数据异常；部署后仅在临时恢复库验证，保持 `plan-projections=false`。

当前状态：已完成

最后更新时间：2026-09-20

---

## 当前阶段

当前阶段：已部署并完成临时恢复库真实验证

当前子任务：无。

---

## 已完成

- [x] 确认开始 HEAD `b9619bf`、工作区 clean，生产同步开关符合保护要求。
- [x] 确认 `mps_data_exceptions.exception_type` 是无 CHECK/enum 的 varchar；无需 Migration。
- [x] 月计划投影增加“事业部非空且客户代码按 `NULLIF(BTRIM(...),'')` 非空”的显式防线。
- [x] 集团主计划投影增加“订单全部活动明细客户代码非空且存在 enabled 映射”的显式防线；不删除历史 group/monthly。
- [x] 新增 `MISSING_CUSTOMER_CODE`，使用 `allocation:<order>:<item>:missing-customer-code` 和 `group:<order>:missing-customer-code` 稳定非空键；空客户与缺映射异常分离。
- [x] 将 `MISSING_CUSTOMER_CODE` 纳入异常 resolve 生命周期，并将 metrics 拆分为缺客户代码、缺映射和默认事业部三类。
- [x] 扩展投影测试，覆盖 NULL、空字符串、空白、缺映射、正常映射、幂等、客户补齐 resolve、历史空客户 group。
- [x] 完成 API/Web 全量测试、typecheck、lint、API Node 24 生产镜像构建。
- [x] 完成部署前双库/uploads 备份及可恢复性校验，滚动部署 API；API、Web、PostgreSQL healthy，Swagger/OpenAPI 200。
- [x] 在生产备份恢复的临时库执行真实投影：首次成功、第二次全部核心 metrics 为 0；两个生产样本共 8 个空客户品项均产生 allocation 异常且无 NULL exception_key。
- [x] 临时库模拟补齐 `2025A027103` 客户代码后，7 个 allocation 恢复正常投影，旧 `MISSING_CUSTOMER_CODE` 均 resolve；另验证 NULL、空字符串、空白及无映射代码四种隔离输入。
- [x] 生产 `plan-projections` 始终保持 false，未执行 LIVE-003-02 正式切换。

## 正在进行

- 无。

## 待完成

- 无；后续正式切换须重新执行 `KN-MPS-LIVE-003-02` 全部门禁。

---

## 修改文件

- `apps/api/src/modules/master-plan-system/master-plan.sync.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.live-projection.spec.ts`
- `outputs/CODEX_PROGRESS.md`

---

## 数据库 Migration

- 无。

---

## 新增或修改测试

- `master-plan.live-projection.spec.ts`：空客户代码保护 8 类验收场景及 metrics 契约。

---

## 已运行测试

测试名称：API 定向投影测试

结果：1 套、13 项通过。

测试名称：API 全量测试 / typecheck / lint / build

结果：56 套、457 项通过；typecheck、lint、build 通过。

测试名称：Web 全量测试 / typecheck / lint

结果：22 套、132 项通过；typecheck 通过；lint 无错误（1 条既有 Fast Refresh 警告）。

测试名称：生产备份临时库真实投影

结果：首次 `SUCCESS`，空客户阻断 8、缺映射 0、默认事业部 0；第二次核心 metrics 全为 0；补齐客户代码后的异常 resolve 通过；NULL/空字符串/空白/无映射四种隔离输入通过。

---

## 当前已知问题

- 两条生产样本已有初始化历史月计划/集团计划；本任务按要求不删除且不改写其人工字段。空客户首次投影对这些历史行的月计划/集团投影字段更新数为 0；后续 LIVE-003-02 仍须以其正式门禁审计历史数据。

---

## 等待用户确认

- 无。

---

## 下一步

1. 本任务已完成。
2. 需要正式开启计划投影时，从 `KN-MPS-LIVE-003-02` 的全量 GO/NO-GO 流程重新开始。

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md、`.agents/skills/kdos-form-platform/SKILL.md` 与本文件。
2. 执行 `git status`、`git diff --stat`。
3. 不得直接开启 `plan-projections`；正式切换只能由重新执行的 `KN-MPS-LIVE-003-02` 决定。

---

## 备份与部署记录

- 备份时间：2026-09-20 09:08:22 +08:00。
- `data/backups/four_department_tracker_20260920_090822.backup`：313386278 bytes；SHA256 `d775430c7eb870b2d06eac4ae8a34b7fe5714705ffc395772fa736111d92c4db`。
- `data/backups/kdos_20260920_090822.backup`：8155720 bytes；SHA256 `bc03dc3520a831cc6639f4275c1217ca0e56784565373b6350db0fec85c21ada`。
- `data/backups/uploads_20260920_090822.tar.gz`：38271 bytes；SHA256 `089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`。
- 已部署 API commit：`30d8fa7`；生产 API、Web、PostgreSQL healthy，`/api/docs` 与 `/api/openapi.json` 返回 200。
