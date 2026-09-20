# Codex 工作进度

## 任务

任务名称：KN-MPS-PROJ-INBOUND-GUARD-001：入库重算合法投影边界修复

任务目标：使 `plan-projections` 的月计划入库重算只维护当前合法的 allocation + enabled customer-division mapping 投影；保留历史阻断数据但停止自动维护。

当前状态：已完成

最后更新时间：2026-09-20 10:05 +08:00

---

## 当前阶段

当前阶段：已部署并完成生产备份临时库验证

当前子任务：无。

---

## 已完成

- [x] 从 clean HEAD `42920dd` 开始；未 reset，未恢复旧备份、未删除任何合法 projection 数据。
- [x] 在 `projectPlans()` 中增加唯一 `eligibleMonthlyProjectionScopeCte()`：当前 allocation 必须有非空 customer code、非空 division，且存在 customer code 与 division 都匹配的 enabled mapping。
- [x] 有入库的累计/欠数/完成率重算与无入库清零都复用同一 `eligible_allocations` CTE；入库来源仍严格是科加 `UFTData418971_000003`。
- [x] 补充 `master-plan.live-projection.spec.ts` SQL 语义回归：两段 SQL 使用相同 eligibility，空客户/无映射/失效 mapping 均被排除，恢复 mapping 后依据当前 mapping 自动重新准入。
- [x] API 定向回归 2 suites / 36 tests、API 全量 56 suites / 460 tests、API typecheck/lint、Web test/typecheck/lint 均通过（Web lint 仅 1 条既有 Fast Refresh warning）。
- [x] 构建 API 镜像 `sha256:791183c1607399bebec9e174a01b88754b796500868a9f97bccbf3f93d891e6f`。
- [x] 新生产备份并校验：`data/backups/four_department_tracker_20260920_095956.backup`（313467645 bytes，SHA256 `2c79b37e3e92f5f505a3721985c00d1be8ea8fa22d1dabcd6848c54f7e69ebdd`）、`kdos_20260920_095956.backup`（8155720 bytes，SHA256 `bfb14683005a608a7f68888416e6a98ddcae18e413099f5f45d01e0bc67cf91e`）与 `uploads_20260920_095956.tar.gz`（38271 bytes，SHA256 `089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`）。
- [x] 在临时恢复库 `kn_mps_proj_inbound_guard_001_20260920_095956` 运行新镜像真实 `plan-projections`：
  - 空客户 `2026A027319/GFB433KB-1/1` 入库 10→11：monthly version、updated_at、累计入库、欠数、完成率均不变，`inbound_recalculated=0`。
  - 删除该临时入库：上述历史 monthly 仍完全不变，`inbound_recalculated=0`。
  - 合法 `2026A027178/GFY155SG-1/1` 入库 1→11：monthly version 1→2、累计 11、欠数 19、完成率 0.3667、`inbound_recalculated=1`。
  - 临时禁用 A027 mapping 并把入库 11→12：既有 monthly 保留且不更新，allocation division 变 NULL，`MISSING_ALLOCATION_DIVISION` active，`inbound_recalculated=0`。
  - 恢复 mapping：自动重新准入，monthly version 2→3、累计 12、欠数 18、完成率 0.4000、`inbound_recalculated=1`。
  - 紧邻下一次同步：allocation/monthly/group/inbound 全为 0。
- [x] 部署 API，API/Web/PostgreSQL healthy；`/api/v1/health`、`/api/docs`、`/api/openapi.json` 均为 200。
- [x] 生产同步开关保持：erp-orders=true、plan-projections=false、inbound-allocation=false、shipping-to-base=false、base-to-weekly=false、execution-rollup=true。

---

## 正在进行

- [ ] 无。

---

## 待完成

- [ ] 无；下一步是否重新执行 `KN-MPS-LIVE-003-02` 由独立完整门禁决定。

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

- `master-plan.live-projection.spec.ts`：KN-MPS-PROJ-INBOUND-GUARD-001 两段入库 SQL 的唯一合法范围、防漂移和 metrics 计数语义。

---

## 已运行测试

测试名称：API 全量测试 / typecheck / lint

结果：56 suites / 460 tests 通过；typecheck、lint 通过。

测试名称：Web 全量测试 / typecheck / lint

结果：通过；typecheck 通过；lint 无错误（1 条既有 Fast Refresh warning）。

测试名称：生产备份临时库真实投影

结果：空客户、有/无入库、无映射、mapping disabled/restored、正常合法数据与幂等均符合本任务规则。

测试名称：部署健康检查

结果：API、Web、PostgreSQL healthy；Health、Swagger、OpenAPI 均返回 200。

---

## 当前已知问题

- 无。本任务不打开 `plan-projections`；正式开启仍需重新执行完整 LIVE-003-02 门禁。

---

## 等待用户确认

- 无。

---

## 下一步

1. 本任务已完成。
2. 若需要正式启用计划投影，按新的生产备份重新执行 `KN-MPS-LIVE-003-02`，不得跳过门禁。

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md、`.agents/skills/kdos-form-platform/SKILL.md` 与本文件。
2. 执行 `git status`、`git diff --stat`。
3. 确认生产 `plan-projections=false`；不得仅因本修复已部署而直接开启。
4. 如启动 LIVE-003-02，使用届时最新生产备份与当前 API 镜像重做全部正式门禁。
