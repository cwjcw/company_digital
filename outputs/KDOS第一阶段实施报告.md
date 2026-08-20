# KDOS 第一阶段实施报告

> 实施日期：2026-08-20（Asia/Shanghai）
> 基线提交：`98a9cfb1b134360aa9e95ff36121a5eeb295ed5b`
> 目标：完成 KDOS Foundation 与 Planning Center 第一阶段主计划编排，并保留可回退的旧系统资产。

## 1. 原项目发现

- 原系统是 React/NestJS/PostgreSQL 计划协同应用，已有可工作的 97 列月度计划、14 工序、Excel、权限、审计、乐观锁、Socket、T+ 同步和运维脚本。
- `apps/web/src/App.tsx` 原为 1448 行，承载多个业务页面；`apps/api/src/controllers.ts` 为 963 行，承载大量旧 REST 端点。
- 原业务数据库为 `four_department_tracker`，TypeORM migration 管理，PostgreSQL 18。
- 重构前工作区已有未提交功能修改；本次先完整备份并在其上继续，没有覆盖用户修改。
- `docs/开发/` 中总任务书有 3216 行；`工作台.md` 为空。

## 2. 备份结果

| 资产 | 位置 | SHA256 |
| --- | --- | --- |
| 重构前源码归档 | `/data/automation/code/work/PMC/knweb-pre-kdos-backup-20260820/knweb-source-pre-kdos.tar.gz` | `28fa34fa671a130acae4deae6a40214939b266ae17456603e8cf6c2a9a1972fa` |
| 重构前 tracked 补丁 | `/data/automation/code/work/PMC/knweb-pre-kdos-backup-20260820/pre-kdos-worktree.patch` | `458ab7c62203ba679a94cd8799803b21f6d22aa9bf489a4a8d13fe5d218c3111` |
| 旧数据库逻辑备份 | `data/backups/four_department_tracker_20260820_183141.backup` | `8ea9182f00d61e1ce148db6b261c83db4cdc58725668f274221ebe09681f7ba3` |
| 上传目录归档 | `data/backups/uploads_20260820_183141.tar.gz` | `b8231687f222a2d8dfd9b9a749a024d6b0054bd68a186f278d18c9def00a6c42` |

旧 `four_department_tracker` 数据库和上传目录均未删除。新 `kdos` 数据库独立建立。

## 3. 实际架构变更

- 根项目正式更名为 `kainan-digital-os`，Node.js 运行目标升级为 24，pnpm workspace 扩展到 apps/packages/integrations。
- 建立 contracts、database、permissions、auth、canonical-model、integration-sdk、workflow-sdk、plugin-sdk、ai-tool-sdk。
- 建立 `apps/api/src/modules/planning`，实现 Controller → Application → Domain/Query → Repository → PostgreSQL 的依赖方向。
- Planning HTTP Controller 仅保留适配逻辑；旧 Controller 继续服务未迁出的兼容模块，不再承载新 Planning 业务。
- Web 月度计划、销售汇总、销售明细、日进度均移至 `modules/planning/pages`；`App.tsx` 从 1448 行降至约 675 行，主要保留登录、布局、路由及未迁出的管理页。
- 建立 Worker Job 契约和 MCP 只读工具目录骨架；不引入消息队列和微服务。
- 建立 LocalObjectStorage，实现未来切换 S3/MinIO 的接口边界。

## 4. 数据库结构、约束、索引和 RLS

新增 6 个 Schema：`core`、`iam`、`planning`、`audit`、`integration`、`workflow`。

核心表：IAM 的 tenant/组织/部门/岗位/员工/用户/身份/角色/权限/角色授权/角色绑定/字段策略；Planning 的周期/版本/销售订单与行/计划行/工序定义与进度/日进度/快照/变更；以及审计日志、导入任务和 migration ledger。

核心约束：

- tenant+年月唯一；周期+版本号唯一。
- 版本+订单号+品号唯一；计划行+工序唯一；计划行+工序+工作日唯一。
- tenant+工序代码唯一；tenant+导入幂等键唯一。
- 月份范围、版本状态、字段访问级别均有 CHECK。
- 数量/金额使用 `numeric`；主键使用 PostgreSQL 18 `uuidv7()`。

索引覆盖周期状态、计划顺序、交期、来源键、品号、工序日期、审计时间/资源和 IAM 组织查询。23 张 tenant 表已启用 RLS；Policy 根据事务内 `app.tenant_id` 执行 `USING` 和 `WITH CHECK`。

实际验收数据：迁移 2、tenant 1、权限 15、工序 14、周期 1、版本 3、计划行 10、快照 2、审计 20、RLS Policy 23。

## 5. Planning V1 完成矩阵

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| PlanPeriod / PlanVersion | DONE | 建周期、建 Draft、基于正式版复制、版本号递增 |
| DRAFT/PUBLISHED/LOCKED/ARCHIVED | DONE | 状态机、只读保护、锁定/解锁原因 |
| Snapshot / Change / Audit | DONE | 发布快照、变更与审计记录 |
| 单行修改与乐观锁 | DONE | `expectedVersion`，过期写入 HTTP 409 |
| 批量修改与排序 | DONE | 单事务、优先级/顺序/责任组织/负责人 |
| 风险汇总 | DONE | 交期逾期、即将到期、工序逾期、异常 |
| 97 字段与 14 工序 | DONE | 元数据 Registry 与关系型工序进度 |
| AG Grid 交互 | DONE | 固定列、分组/折叠、虚拟滚动、筛选、字段显示、编辑、批量、排序 |
| Excel/CSV 导入 | DONE | 预览、确认、幂等、事务、两层工序表头 |
| Excel 导出 | DONE | Registry 驱动两层表头 |
| 图片 | DONE | ObjectStorage 抽象、本地实现、限制与补偿删除 |
| Action/Field 权限 | DONE | UI access + 服务端二次校验 |
| tenant RLS | DONE | 23 条 Policy，事务设置 tenant |
| Socket 变更事件 | DONE | 最小事件载荷，前端失效后重取 |
| 月初滚动 | DONE | SYSTEM Actor，通过 Query/Application，幂等建周期/版本 |
| Integration/Canonical/T+ | PARTIAL | 接口、Canonical Model、双账套映射与去重已完成；生产 T+ 到新 Planning 的正式切流待下一阶段 |
| Keycloak | PARTIAL | Provider 与 Identity 边界已建立；未部署 Realm/MFA/账号迁移 |
| Workflow | PARTIAL | Gateway 与流程契约已完成；按任务范围未部署 Flowable |
| MCP/AI | PARTIAL | 5 个只读 Tool Definition 与 app 骨架完成；按任务范围未实现 AI Chat/执行器 |
| Plugin | DONE | Planning Manifest 与 SDK 合同已建立 |

## 6. 迁移说明

- 97 个旧 Web 字段全部迁移，无删除；另加 5 个编排字段，总计 102。
- 93 个 Excel 字段顺序和双层表头语义保留。
- 14 个工序全部迁移为 `process_definitions` + `process_progress`，工序导入不再只留在 JSON。
- 保留多层表头、阶段折叠、选择列固定、关键列固定、横向虚拟滚动、字段显示、筛选、编辑、状态颜色、图片、批量和排序。
- 差异：新月度计划使用版本化 API 与新 `kdos` 数据库；正式/锁定版本不可直接修改，调整必须创建新 Draft。新增优先级、计划顺序、责任组织、负责人、计划状态。
- 兼容：销售汇总、日进度和基础资料等旧 API 暂留 TypeORM；后续按模块逐步切换，避免大爆炸迁移。

## 7. 测试与验收

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm lint` | PASS | 全 workspace 无 error |
| `pnpm typecheck` | PASS | 全 workspace 通过 |
| `pnpm test` | PASS | API、Web 与各 contracts/sdk 包通过 |
| `pnpm build` | PASS | Node 24 容器构建通过；宿主机 Node 22 仅有 engine 提示 |
| `pnpm test:tplus-sync` | PASS | T+ 源同步测试 2/2 |
| `pnpm test:e2e` | PASS | Playwright 11/11；mock 模式的 Socket proxy 告警不影响断言 |
| 新数据库迁移 | PASS | 2 条带 checksum 迁移重复执行安全 |
| 真实 API/DB 验收 | PASS | 导入/幂等/工序/409/图片/导出/发布/快照/锁定/解锁/新 Draft/风险汇总 |
| 真实 T+ 服务连接 | SKIPPED | 外部服务不是本阶段可用依赖；Adapter、映射与本地源测试已覆盖 |
| Keycloak/Flowable | SKIPPED | 按第一阶段任务书只要求边界和骨架 |

重构前和重构后截图位于 `docs/migration/screenshots/`。重构后月度计划截图已确认显示版本工具栏、编排字段、风险标签和新元数据网格。

## 8. Git Diff 摘要

最终 staged diff 为 141 个文件、9522 行新增、1680 行删除，包含 KDOS workspace/文档、2 条新数据库迁移、9 个基础 packages、T+ integration、Worker/MCP 骨架、Planning API 模块、Web Planning 模块、测试和交付报告。

重构前用户工作区修改已先归档并纳入本次演进；实际 `.env`、数据库、上传、备份、`node_modules`、`dist`、测试临时结果未提交。

## 9. 风险分级

### P0

无已知 P0 阻断项。

### P1

1. 新旧 TypeORM/Drizzle 与双数据库仍处于兼容期，需要完成数据迁移、用户验收、只读归档和退役计划。
2. Keycloak 尚未生产接入；现有 JWT 只适合作为兼容认证，需确认 Realm、MFA、账号映射和 token 切换。
3. T+ 新 Adapter 尚未正式切入 Planning Application Service，生产启用前需要真实双账套联调和失败重放。
4. LocalObjectStorage 通过静态路径提供图片；若内容敏感，需要鉴权下载或签名 URL。
5. 并发创建 Draft/发布主要由事务和服务规则保护，建议补数据库级“每周期最多一个 Draft/Published”部分唯一索引或锁策略。

### P2

1. Web 仍有兼容管理页和共享 legacy UI，可继续路由级拆分和 chunk 优化。
2. Snapshot JSON 长期增长需制定保留、压缩和归档策略。
3. 大 Excel 当前同步解析，后续应接入 Worker、对象存储、进度、超时和病毒扫描。
4. RLS 可评估 `FORCE ROW LEVEL SECURITY`、连接池 tenant 清理和专用 migration role。
5. 需要增加可观测性：指标、结构化日志、trace、导入耗时和慢查询告警。

## 10. 下一阶段建议（最多 10 项）

1. 完成旧数据到 `kdos` 的可重复迁移脚本、校验报表和业务签字。
2. 增加版本并发的部分唯一索引/显式锁，并补并发集成测试。
3. 将 T+ Adapter 正式接入 Planning Application Service，完成双账套真实联调与重放。
4. 部署 Keycloak，完成 MFA、Identity 映射、账号迁移和回滚演练。
5. 将图片切换到 MinIO/S3 或鉴权下载，补病毒扫描和生命周期策略。
6. 把大文件导入迁移到 Worker，提供任务状态、失败明细和取消/重试。
7. 逐模块迁移销售汇总、日进度、基础资料，最终退役旧 TypeORM 数据层。
8. 接入真实 Workflow Gateway 实现发布、重大变更、解锁和关账审批。
9. 完成 MCP 只读执行器与服务账号审计，禁止任意 SQL。
10. 增加生产级指标、trace、容量测试、备份恢复演练和灾难恢复 Runbook。
