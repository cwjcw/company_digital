# KDOS 项目 AI 技术审查资料

> 生成日期：2026-08-20（Asia/Shanghai）
> 审查基准：当前 Git 工作区/本次第一阶段提交，而不是重构前 `98a9cfb`。
> 审查目标：识别技术栈、模块边界、数据一致性、安全、性能和后续迁移风险，并给出 P0/P1/P2 优先级建议。

## 1. 项目定位与阶段状态

项目已从“凯南计划中心 Web”演进为 **凯南数字化工作台（Kainan Digital OS，KDOS）**。第一阶段采用模块化单体，不引入微服务、Kafka 或 Kubernetes；Planning Center 是首个正式业务模块。

当前处于兼容迁移期：

- 新业务链路使用 `kdos` PostgreSQL 数据库、Drizzle Schema、Planning Application/Domain/Repository/Query 分层。
- 原 `four_department_tracker` 数据库、TypeORM 实体和非 Planning 旧页面暂时保留，便于回滚与渐进迁移。
- 新旧数据库同时存在，但 Planning 新模块不直接写旧表。
- Node.js 24 是正式构建和容器运行目标；开发宿主机当前为 Node.js 22，因此 pnpm 会给出 engine 提示。

## 2. 技术栈

| 层次 | 技术 |
| --- | --- |
| Web | React 19、TypeScript 5.9、Vite 7、React Router 7、TanStack Query 5、Ant Design 5、AG Grid Community 34、Socket.IO Client |
| API | Node.js 24、NestJS 11、Express 5、Swagger、Socket.IO、Decimal.js、ExcelJS、Multer、Sharp |
| 新数据层 | PostgreSQL 18、Drizzle ORM/Schema、原生 `pg` 事务与 Repository 接口 |
| 兼容数据层 | TypeORM 0.3，仅服务尚未迁出的旧模块 |
| 身份权限 | JWT 兼容认证、AuthProvider/Keycloak Provider 边界、RBAC、字段策略、tenant RLS |
| 工程 | pnpm 11 workspace、Docker Compose、Nginx、ESLint、Jest、Vitest、Playwright |

## 3. 代码结构与依赖方向

```text
apps/
  web/src/modules/planning/       Planning 页面、元数据列构建器
  api/src/modules/planning/       Controller、Application、Domain、Query、Repository
  worker/                         异步任务契约骨架
  mcp/                            只读 AI Tool Catalog 骨架
packages/
  contracts/                      Planning API、事件、权限和 102 字段 Registry
  database/                       Drizzle Schema 与连接
  permissions/                    操作与字段权限判断
  auth/                           Local/Keycloak Provider 边界
  canonical-model/                ERP 中立模型
  integration-sdk/                Adapter 与幂等契约
  workflow-sdk/                   WorkflowGateway
  plugin-sdk/                     Module Manifest
  ai-tool-sdk/                    只读 AI Tool Definition
integrations/tplus/               双账套 T+ → Canonical Model Adapter
database/migrations/              新 kdos SQL 迁移
```

核心依赖方向：

```text
Web / Import / T+ / SYSTEM Job / future AI
                    ↓
       Planning Application Service
                    ↓
             Planning Domain
                    ↓
        Planning Repository interface
                    ↓
        Drizzle + PostgreSQL adapter
```

HTTP Controller 只做输入输出适配。业务规则不应进入 Controller、Excel Parser、React 组件或 T+ Reader。

## 4. Planning 业务模型

`PlanPeriod` 对应年月，拥有多个 `PlanVersion`：

- `DRAFT`：可编辑；新增、单元格修改、批量修改、排序、导入和图片操作仅允许此状态。
- `PUBLISHED`：正式只读；发布时创建不可变 JSON Snapshot，并归档上一正式版本。
- `LOCKED`：结账式只读；锁定/解锁必须有权限和原因。
- `ARCHIVED`：历史正式版本，仅查询。

创建新 Draft 可复制上一正式版本的计划行和工序进度。`plan_items.version` 与 `process_progress.version` 用于乐观锁；过期写入返回 HTTP 409。发布、锁定、解锁、批量更新、排序和导入确认均通过 Application Service 和数据库事务。

## 5. 新数据库

Schema 与主要表：

| Schema | 表 |
| --- | --- |
| `core` | `schema_migrations`（含 checksum） |
| `iam` | `tenants`、`organizations`、`departments`、`positions`、`employees`、`users`、`identities`、`roles`、`permissions`、`role_permissions`、`role_bindings`、`field_policies` |
| `planning` | `plan_periods`、`plan_versions`、`sales_orders`、`sales_order_lines`、`plan_items`、`process_definitions`、`process_progress`、`daily_progress`、`plan_snapshots`、`plan_changes` |
| `audit` | `audit_logs` |
| `integration` | `import_jobs` |

关键约束包括：tenant+年月唯一、周期+版本号唯一、版本+订单+品号唯一、计划行+工序唯一、计划行+工序+日期唯一、导入幂等键唯一。数量和金额使用 PostgreSQL `numeric`，领域计算使用 `decimal.js`。协同表带 `tenant_id`，已启用 23 条 tenant RLS Policy；事务内设置 `app.tenant_id`，应用查询仍显式带 tenant 条件。

当前验收数据库统计：2 条迁移、1 个 tenant、15 个 Planning 权限、14 个工序、1 个计划周期、3 个版本、10 个测试计划行、2 个快照、20 条审计、23 条 RLS Policy。测试版本状态为 `v1 ARCHIVED / v2 PUBLISHED / v3 DRAFT`。

## 6. 字段与 AG Grid 迁移

- 原 97 个 Web 业务字段全部保留。
- 新增优先级、计划顺序、责任组织、负责人、计划状态 5 个编排字段，共 102 个 Registry 字段。
- 原 Excel 93 列契约保留；导入支持两层表头以及 CSV。
- 14 个工序全部配置化保留。
- Registry 统一定义标签、分组、顺序、宽度、固定、类型、编辑器、Renderer、可见性、可编辑性、权限和来源。
- 保留多层/折叠表头、固定选择列、横向虚拟滚动、字段显示、快速筛选、状态颜色、单元格编辑、批量更新、持久化排序和图片弹窗。
- 前端元数据权限只负责表现，后端每次写入再次校验字段权限。

## 7. 导入、导出与图片

导入链路是：上传 → 解析 → 标准化 → 校验 → 预览 → 用户确认 → Application Command → 单事务写入。

- `.xlsx` 和 `.csv` 均支持。
- 文件哈希 + 目标版本形成幂等键；重复确认返回既有结果。
- 任一写入失败则整个确认事务回滚。
- 两层工序表头会写入 `planning.process_progress`，不会降级成不可查询 JSON。
- Excel 导出由相同字段 Registry 生成两层表头。
- 图片通过 `ObjectStorage` 抽象；第一阶段实现 LocalObjectStorage，校验 MIME、大小和每行最多两张，并对数据库失败做补偿删除。

## 8. 权限、审计和协同

- 15 个 Planning Action Permission 已建模和 seed。
- Field Policy 支持 `HIDDEN / READONLY / EDITABLE / MASKED`。
- API 从 JWT claims 获取用户、角色和权限，服务端拒绝越权字段写入。
- PostgreSQL RLS 提供 tenant 级第二道隔离。
- 业务写入记录 `audit.audit_logs` 和 `planning.plan_changes`，包含 actor、source、requestId、traceId、before/after 和 reason。
- Socket 事件只包含 tenant、period、version、entity、乐观版本和 change type；客户端收到后失效缓存并按自身权限重取。

## 9. 集成、工作流、插件和 AI

- `canonical-model` 隔离 ERP 专有字段。
- `integration-sdk` 定义 Adapter、幂等键和同步结果。
- `integrations/tplus` 支持双账套映射与去重测试；T+ SQL Reader 仍隔离在 `data-operations/tplus`。
- 月初滚动使用 `SYSTEM` Actor 调用 Planning Query/Application Service，不再直接调用数据库函数。
- `WorkflowGateway` 已定义发布、重大变更、交期变更、解锁和关账边界；第一阶段未部署 Flowable。
- Planning Plugin Manifest 已建立。
- MCP/AI 只读工具定义包括计划搜索、计划详情、订单进度、工序进度和风险汇总；当前只有骨架，不执行任意 SQL。

## 10. 已验证链路

- 建立周期和 Draft、复制新版本。
- 单行与批量修改、排序、负责人/责任组织/优先级修改。
- 过期 `expectedVersion` 返回 HTTP 409。
- CSV 预览、确认、重复确认幂等、工序数据写入。
- Excel 导出成功。
- 图片上传和 Nginx 静态访问成功。
- 发布生成 Snapshot，发布后写入被拒绝。
- 锁定、解锁及原因记录。
- 风险汇总返回交期逾期、未来 7 天到期、工序逾期和未关闭异常。
- Lint、类型检查、单元测试、构建、Playwright 11/11、T+ 测试通过。

## 11. 希望 AI 重点审查的问题

1. 新旧 TypeORM/Drizzle 共存期的事务、连接池和最终退役策略是否清晰。
2. PostgreSQL RLS 是否需要 `FORCE ROW LEVEL SECURITY`、更严格的连接重置与管理员旁路审计。
3. Planning Repository 中原生 SQL 与 Drizzle Schema 的边界是否合适，是否应逐步使用 typed query builder。
4. 版本状态机在并发发布、并发建 Draft、锁定/解锁时是否还需数据库级排他约束。
5. Snapshot JSON 的长期体积、查询和归档策略。
6. 导入任务对超大 Excel 的内存、超时、异步化、病毒扫描和对象存储生命周期设计。
7. 图片是否需要从公开静态路径升级为鉴权下载或签名 URL。
8. Keycloak 生产接入、MFA、账号映射和现有 refresh token 迁移方案。
9. T+ Adapter 从“契约与映射已就绪”到“正式写入 Planning Application Service”的切换设计。
10. Web 主包、共享 legacy UI 与非 Planning 旧页面的下一轮拆分顺序。

## 12. 审查输出格式建议

请按以下格式回答：总体评价；P0/P1/P2 问题表（证据、影响、建议、工作量）；技术栈保留/替换建议；数据一致性/权限/RLS/审计/幂等/并发专项；AG Grid 与元数据专项；下一阶段最多 10 项的实施顺序和验收标准。

相关权威资料：根目录 `ARCHITECTURE.md`、`SECURITY.md`、`AGENTS.md`、`docs/migration/legacy-master-plan-inventory.md`、`docs/runbook.md`、`docs/integration-guide.md`、`docs/workflow/planning-workflows.md`。
