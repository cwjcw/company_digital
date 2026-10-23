# KDOS 评审交期表 V2 生产上线预检

检查时间：2026-10-23（Asia/Shanghai）  
状态：**READINESS_WITH_RELEASE_BLOCKERS**。本报告只读；未执行备份、Migration、部署、数据库写入、同步、commit 或 push。

## 预检结论

V2 的本地自动化、隔离 PostgreSQL 和隔离 Chrome 验收证据见 `outputs/KDOS_MPS_REVIEW_DUE_V2_FIX_ACCEPTANCE.md`，本轮未重跑这些测试。当前生产 Repository/Web/API 仍为 `6c19507225f692c8e80a2f4d7e7a7f0c6cfc27be`；评审交期主表及历史表只读计数均为 0，数据库最新已执行 Migration 是 FinanceE10 Migration 105（TypeORM ledger ordinal id=104）。V2 Migration 106 尚未执行。

**V2 当前不具备立即执行生产发布的条件**：工作区有多项未提交源代码改动，`deploy.sh` 会拒绝部署；改动还需要按 V2 白名单与其他任务产物分离并形成正常 GitHub 提交。除此之外，Node 宿主为 22.23.1，而仓库要求 Node >=24；正式 Dockerfile 和当前生产 API 是 Node 24，可将构建和迁移命令限定在 Node 24 容器中，因此无需改动系统 Node，但禁止用宿主 Node 22 执行 pnpm 构建/迁移。

Migration 106 是明确的前向、不可安全降级迁移：`down()` 会主动失败。发布必须把“应用回滚”和“数据库回滚”分开；上线后不运行 migration:revert，不用旧数据库备份覆盖上线后的新业务数据。现有数据为 0 使其归属检查当前满足条件，但执行前仍须重新检查，以防预检后有新记录。

## Git 工作区及 V2 文件范围

- 分支：`main`；HEAD：`6c19507225f692c8e80a2f4d7e7a7f0c6cfc27be`。工作区有未提交和未跟踪文件。
- V2 相关源代码改动：
  - API：`apps/api/src/common/filtering/table-filter-registry.spec.ts`；`apps/api/src/modules/master-plan-system/master-plan-spreadsheet.service.ts`、`master-plan.application.service.ts`、`master-plan.config.ts`、`master-plan.query.service.ts`；`review-due-date-import.application.service.ts`、`review-due-date-import.spec.ts`、`review-due-date.application.service.ts`、`review-due-date.create.spec.ts`、`review-due-date.domain.spec.ts`、`review-due-date.domain.ts`、`review-due-date.manual.spec.ts`、`review-due-date.query.service.ts`；新增 `apps/api/src/migrations/1722920106000-MpsReviewDueDateFieldsV2.ts` 和 `review-due-date-v2.migration.spec.ts`。
  - Web：`apps/web/src/modules/master-plan-system/ReviewDueDates.tsx`、`ReviewDueDates.import.tsx`、`ReviewDueDates.spec.tsx`、`ReviewDueDates.create.spec.tsx`、`ReviewDueDates.edit.spec.tsx`、`apps/web/src/modules/permissions/ReviewDueDatePermissions.spec.tsx`。
  - Contracts：`packages/contracts/src/index.ts`、`review-due-dates.ts`、`review-due-dates.spec.ts`。
  - 验收脚本：`scripts/test-review-due-dates-postgres.cjs`、新增 `scripts/test-review-due-fields-v2-postgres.cjs`、新增 `scripts/review-due-fields-v2.browser-checks.cjs`；`scripts/review-due-import.postgres-checks.cjs` 被删除。删除/入口改造属于 V2 测试基座变更，提交前应按 V2 验收报告再核对其替代关系。
  - 文档：`outputs/KDOS_MPS_REVIEW_DUE_DATE_SPEC.md`、`outputs/KDOS_MPS_REVIEW_DUE_FIELDS_V2_ACCEPTANCE.md`、`outputs/KDOS_MPS_REVIEW_DUE_V2_FIX_ACCEPTANCE.md`。
- 必须排除的其他任务产物：未跟踪的 `outputs/KDOS_MPS_REVIEW_DUE_IMPORT_DEPLOY_ACCEPTANCE.md` 属于旧导入部署任务，不属于 V2。`outputs/CODEX_PROGRESS.md` 同时记录多项任务，不能不审核就整体纳入 V2 提交。忽略目录中的隔离截图、合成 Excel 和数据库证据不应提交。
- 当前 `deploy.sh` 的 `assert_deployable_worktree` 仅容忍 `outputs/**` 改动；上述源码改动会导致部署立即拒绝。不得通过放宽此门禁或清理工作区绕过；发布准备阶段应使用只含已审核 V2 commit 的干净工作树，并保留现有其它任务产物。

## Migration、生产结构与执行顺序

生产 `four_department_tracker` 的 TypeORM migration ledger 最近记录：

|Migration|生产状态|内容/依赖|
|---|---|---|
|105：`1722920105000-FinanceE10SourcePresenceAndTimestamps`（ledger `id=104`）|已执行|财务 E10 来源缺失/时间戳及相关财务视图调整；与评审交期 V2 无业务依赖。`down()` 拒绝回退以保留财务来源证据。不得重跑或回退。|
|106：`1722920106000-MpsReviewDueDateFieldsV2`（新 Migration）|未执行|只改评审交期表：事业部和初始来源事业部、唯一约束、更新人 UUID 外键、可空手工字段、移除旧自动计次触发器/函数并重建来源/更新保护、增加索引和字段注释。依赖 Migration 101 创建的评审交期表、Migration 104 的人工编辑字段/来源键/触发器，以及已有的 `users`、`organization_units` 表。按 TypeORM 时间戳排序，105 先于 106；生产当前已满足该顺序。|

生产只读结构检查确认：主表仍有旧唯一约束及来源唯一约束、`trg_mps_review_due_count` 计数触发器、RLS 和 FORCE RLS；`change_count` 仍 NOT NULL/默认 0，`inspection_time_name` NOT NULL，`updated_by` 是 varchar 且默认 `system`；`division_id`、`source_division_id` 尚不存在。Migration 106 的目标表、约束与旧触发器名称和生产结构相符。Migration 106 先检查旧行事业部与创建/更新人可追溯性；新增事业部为空时会显式拒绝而不猜测归属。当前 0 行因此通过此项前置条件。其 `down()` 抛出“不可安全降级”错误，符合本次保留历史/身份语义的设计。

## 生产数据只读基线

查询在 `knplan-api-1` 中使用当前生产连接配置，事务为 `BEGIN READ ONLY`，查询后 `ROLLBACK`，未向输出打印凭据。

|检查项|结果|
|---|---:|
|`mps_review_due_dates`|0 行|
|`mps_review_due_date_changes`|0 行|
|最新 TypeORM migration|ledger id 104 / timestamp 1722920105000 / Finance Migration 105|
|V2 `division_id` / `source_division_id`|均不存在|

以上是检查时快照，不代表未来迁移时仍为空。正式 Migration 前要立即重查主表、历史表、导入预览/收据及关键约束；若主表已有行，Migration 106 会因无法可靠回填事业部而拒绝，必须暂停并人工核实，不能清空或恢复旧备份。

## 备份、部署及 Node 风险

`scripts/backup.sh` 会备份 legacy `DATABASE_NAME` 和 `KDOS_DATABASE_NAME` 两个数据库为 PostgreSQL custom format，分别用 `pg_restore --list` 检查归档目录；同时备份 `data/uploads`（若存在还含通知送达回执），设置目录 0700、文件 0600 并输出三份 SHA-256。此机制可生成并初步验证可读取的备份归档，但本轮没有执行备份，也没有隔离恢复演练，故不能声称已存在本次发布的有效备份或完整恢复已验证。获准发布后须实际运行脚本，检查三文件、权限、SHA 和 `pg_restore --list`；需要把“可恢复”作为硬门禁时，应在隔离数据库做一次实际恢复验证，绝不能覆盖生产。

`scripts/upgrade.sh` 的顺序是备份→构建→停止 Web/API→TypeORM `migration:run`→启动 Compose 服务→healthcheck；它不会自动做 Repository/Web/API SHA 一致性断言。`scripts/migrate.sh` 会确认 PostgreSQL、备份、显示待迁移项后执行 migration，但不构建镜像。`./scripts/deploy.sh all` 会用完整 Repository HEAD 构建 API/Web/Document Worker、更新服务并等待 API/Web 健康；它**不会**执行数据库 Migration。`./scripts/deploy.sh check` 比较 Repository HEAD、Web build-info 和 API health 的 SHA，需三者一致才返回 `STATUS=CONSISTENT`。

宿主 `node --version` 为 `v22.23.1`，与 `package.json` `node >=24` 不符；生产 API 与 API/Web Dockerfile 构建镜像均为 Node 24（生产 API `v24.19.0`）。因此发布构建和 TypeORM CLI 必须在项目 Node 24 Docker 环境执行。不要在宿主 Node 22 上运行 pnpm build/db:migrate；它会触发引擎警告且不是仓库支持的环境。

## 回滚能力和边界

- Migration 106 没有安全的 `down()`，不得 `migration:revert`，不得手工 DROP 新字段/约束/函数，也不应以全库旧备份回滚线上数据。
- Migration 失败时应依靠 TypeORM 单迁移事务回滚该次结构事务（当前配置未覆盖默认事务行为）；仍须检查 migration ledger、目标表列和约束，确认无半完成结构后才重试。不要把失败后状态当作自动安全。
- Migration 成功、应用启动失败：保留数据库结构，停止重复尝试写入口；优先修复/重建同一 V2 应用或部署经过 106 结构兼容验证的应用版本。旧 API 只有在针对 V2 schema 的兼容测试通过后才可回滚；否则暂停评审交期写入口并做前向修复。旧 Web/API 镜像可用于应用层回退评估，但不能据此认定数据库可降级。
- 数据库备份用于灾难恢复到隔离目标或经明确数据协调的恢复流程，不得覆盖迁移后新增业务数据。Migration 前当前两张表为 0 行降低了初始数据风险，但不能替代回退方案。

## 影响范围

Migration 106 只触及评审交期表、其计数/身份触发器和函数、评审交期索引/注释，并引用现有组织与用户表；不修改其他 PMC 业务表、财务表、权限组或同步 flags。源码改动跨共享 Contracts 和主计划 API/Web 镜像，发布会短时更新共享 API/Web 进程；标准 `upgrade.sh` 会停止 Web/API 并 `compose up -d`，可能造成短时页面/API不可用。Docker build 也包含 Document Worker 镜像和启动检查，预期无业务规则变更，但属于部署流程触达的运行组件。没有代码证据表明此次引入其他模块业务逻辑变更。

## 推荐上线顺序

1. 用户审核本预检后，另行批准正式上线。先保护当前工作区；在临时/链接工作树中筛选 V2 白名单，核实共享 PostgreSQL 测试脚本删除/替代关系，排除导入部署报告、其它未提交内容、隔离证据和凭据。运行 Node 24 下 Contracts/API/Web、migration/隔离 PostgreSQL、typecheck/lint/build 及 Chrome 验收；检查 GitHub main 无未合并变化后正常提交/push，不 force。
2. 发布前记录 Repository/Web/API SHA、API/Web/PostgreSQL健康、migration ledger、主表/历史/预览台账数量、权限摘要及六项同步开关；只读重查所有表仍符合 Migration 门禁。若主表非空或任一环境/版本/工作区检查异常，停止。
3. 用标准 `scripts/backup.sh` 备份两库和附件，验证归档列表、文件权限、SHA；按恢复要求在隔离目标演练恢复。未通过则停止。
4. 由已审核的干净 V2 源码/提交执行项目升级流程：Node 24 Docker build；在停止 Web/API 的维护窗口应用 TypeORM Migration 106（105 已存在，不应再次执行）；启动新 API/Web 并通过健康检查。标准 `upgrade.sh` 已内置备份/构建/停机/migration/启动，但执行时须显式给 `KDOS_BUILD_SHA=<完整提交SHA>`，并在结束执行 `./scripts/deploy.sh check`。
5. 验证 Migration ledger 新增且只新增 106；目标表 RLS/FORCE RLS、约束、触发器及列符合预期；表仍为0行（本阶段不导入数据）；Repository=Web=API，`STATUS=CONSISTENT`，服务健康，权限和六项同步 flags 无变化。
6. Chrome 使用正式有权限账号验收 V2 页面：事业部、品项编码/名称、手工次数/上次入库时间及四个审计字段；检查新增/编辑权限、组织字典、Excel模板/导出、筛选及历史展示。无权限账号确认受限。只读或隔离验收，不新增演示记录、不导入真实数据；完成后等待人工验收。
7. 失败时先留存健康/日志/ledger/结构证据，不恢复旧数据库。优先保持 Migration 106，修复或前向部署兼容应用；若需恢复旧应用，先确认针对 V2 schema 的兼容性并暂停不兼容写入口。

## 对检查问题的回答

1. **V2 是否具备生产上线条件？** 功能验收证据具备；生产发布前置条件尚未全部满足，当前不得立即上线。
2. **阻塞问题？** 有：V2 源码仍未提交且工作区混合其他未提交/独立任务产物，部署门禁会拒绝；须先按白名单形成独立干净发布源。发布操作本身还必须取得用户明确批准并完成实际备份/恢复验证。Node 22 是环境风险，使用 Node 24 Docker 路径可规避。不可逆 Migration 是已知约束，不能数据库降级。
3. **上线涉及哪些文件和 Migration？** V2 清单见“Git 工作区及 V2 文件范围”；唯一新增生产 Migration 是 106 `1722920106000-MpsReviewDueDateFieldsV2`。Migration 105 已执行，是财务 Migration，与 V2 无依赖，不重跑。
4. **是否会影响其他模块？** 数据结构与业务规则只涉及评审交期；共享 API/Web 服务会部署并有维护窗口，部署脚本也触达 Document Worker 构建/健康检查。没有数据库层其他模块业务变更。
5. **推荐部署、验证及回滚？** 按“推荐上线顺序”执行。上线前双库及附件备份、SHA与隔离恢复；先在停 API/Web窗口运行唯一待迁移 106，再启动应用并 `deploy.sh check`；真实 Chrome验收不写业务数据。失败不回退数据库，使用经验证兼容 V2 schema 的应用版本或前向修复。

最终结论：**等待用户明确批准生产操作**。本轮没有修改生产环境，未执行备份、Migration、部署、真实浏览器生产验收、commit 或 push。
