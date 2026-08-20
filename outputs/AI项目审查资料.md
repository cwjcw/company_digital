# 凯南计划中心 Web 项目审查资料

> 用途：将本文档连同项目源码交给另一个 AI，请其审查当前技术栈、架构设计、实现方案、数据一致性、安全性、可维护性和后续演进路线，并提出有优先级的改进意见。
>
> 资料生成时间：2026-08-20（Asia/Shanghai）
>
> 重要前提：当前 Git 工作区存在未提交修改。审查应以工作区当前源码为准，并区分“已经实现”“文档声称已验证”和“仍需在当前环境重新验证”的内容。

## 1. 项目定位

项目名称：凯南计划中心 Web 应用（代码包名：`four-department-tracker`）。

项目目标是把原有的 `4部追踪表_web.xlsx` / 四部生产追踪表，转化为一个以 PostgreSQL 为唯一运行时业务数据源的生产主计划和月度计划协同系统。Excel 不再作为在线主数据库，而是用于导入、导出、人工核对和历史数据迁移。

核心业务对象包括：订单、订单品号/月度计划行、14 个生产工序、外协信息、供应商、字典、销售接单、成品入库、日进度、用户/角色/组织范围、审计日志和外部 API Key。

## 2. 当前主要能力

- 月度计划：按年月查看计划，支持约 97 个 Web 字段、双层表头、横向虚拟滚动、筛选、字段显示控制、单元格编辑、批量更新、移动到其他月份、图片上传。
- 滚动主计划和销售接单汇总：按订单聚合品号、数量、入库、欠数、金额和完成率，并提供交期预警及执行概览。
- 工序管理：默认 14 个配置化工序，每个工序可配置所需天数、交期、状态和异常等字段；其中部分里程碑工序使用数量驱动状态。
- 月初滚动：上海时区每月 1 日 01:00 通过数据库函数创建新计划月，把上一有效月份仍有欠数的品号复制到新月份，并将已入库量归零、生产量转为未完成量；设计上支持幂等执行。
- Excel 导入：月度计划和销售接单均支持模板、预览、错误/警告、事务确认和业务键幂等；整份文件通过校验后才允许确认写入。供应商、字典等基础资料也支持 CSV/XLSX 导入。
- Excel 导出：支持月度计划和成品入库等数据导出，月度计划导出保持 Excel 业务字段结构。
- 协同编辑：JWT 鉴权、事业部/组织数据范围、字段级权限、整数版本号乐观锁、HTTP 409 冲突、Socket.IO 广播、请求号和审计记录。
- 账号与集成：用户、角色、权限、组织单位、联系人、API Key、刷新令牌、密码修改/重置；外部系统通过带权限范围和有效期的 API Key 写入。
- T+ 订单同步：独立的 `data-operations/tplus` 模块读取双账套有效销售订单，使用“源数据库 + 订单号”作为幂等业务键，支持 dry-run 和受鉴权 HTTP API 写入销售接单数据。
- 运维：Docker Compose 三容器部署（Nginx、NestJS API、PostgreSQL 18），有启动、停止、升级、迁移、备份、恢复、日志和健康检查脚本。

## 3. 技术栈

### 前端

- React 19、TypeScript 5.9、Vite 7
- React Router 7
- TanStack Query 5：服务端数据获取、缓存和失效
- Ant Design 5：表单、弹窗、表格、布局和管理界面
- AG Grid Community 34：大宽表、虚拟滚动、编辑和筛选
- Socket.IO Client 4：计划变更实时通知
- Vitest、Testing Library、Playwright

### 后端

- Node.js 22、NestJS 11、TypeScript
- Express 5、Helmet、CORS
- TypeORM 0.3、PostgreSQL 18、`pg`
- JWT access token + refresh token，`bcryptjs` 密码哈希
- Socket.IO / Nest WebSocket Gateway
- Swagger / OpenAPI
- ExcelJS、JSZip、Multer、Sharp
- `decimal.js`：数量、金额和完成率计算使用十进制定点逻辑
- Jest、Supertest、ts-jest

### 工程与部署

- pnpm 11 workspace，工作区包含 `apps/web`、`apps/api`、`packages/shared`
- Docker 多阶段构建；生产前端运行在 Nginx，API 和 PostgreSQL 只在 Compose 内部网络可见
- PostgreSQL、上传文件、备份和日志使用宿主机目录持久化
- Cloudflare Tunnel 由宿主机 systemd 管理，不在本项目 Compose 内运行

## 4. 代码结构

```text
.
├── apps/
│   ├── web/                         React/Vite 前端
│   │   └── src/App.tsx              当前主要页面与交互集中在此文件
│   └── api/                         NestJS 后端
│       └── src/
│           ├── controllers.ts       REST 控制器，目前承载大量业务端点
│           ├── entities.ts          TypeORM 实体定义
│           ├── plan.service.ts      计划、订单、单元格和聚合业务逻辑
│           ├── domain.service.ts    数量、金额、里程碑状态等纯领域计算
│           ├── import.service.ts    Excel 读取、校验、预览和确认导入
│           ├── auth.ts              登录、刷新令牌、API Key 鉴权
│           ├── gateway.ts           Socket.IO 计划变更广播
│           ├── modification-audit.ts 自动记录修改操作者和变更上下文
│           ├── monthly-rollover.service.ts 月初滚动
│           ├── storage.service.ts   简图上传存储
│           ├── migrations/          TypeORM 数据库迁移
│           └── data-operations/tplus/ T+ API 同步模块
├── packages/shared/                 前后端共享字段、字典、工序、权限契约
├── data-operations/tplus/            T+ SQL 读取、映射、同步脚本和测试
├── scripts/                          部署、备份、恢复、迁移、健康检查脚本
├── docs/                             架构、进度、Excel 分析、业务说明和模板
└── outputs/                          本次生成的审查交接资料
```

当前实现有明显的“单文件聚合”特征：前端大量页面和组件集中在 `apps/web/src/App.tsx`，后端多数 REST 控制器集中在 `apps/api/src/controllers.ts`。这有利于早期快速交付，但应重点评估后续拆分策略、模块边界和测试可维护性。

## 5. 数据模型概览

主要表/实体如下：

| 领域 | 实体 |
| --- | --- |
| 身份与权限 | `users`、`roles`、`user_roles`、`permissions`、`role_data_scopes`、`role_organization_scopes`、`refresh_tokens`、`api_keys` |
| 组织与通讯录 | `organization_units`、`contacts` |
| 计划 | `plan_periods`、`orders`、`order_items`、`outsourcing_details` |
| 工序 | `process_definitions`、`item_process_progress`、`daily_process_progress` |
| 主数据 | `dictionary_types`、`dictionary_values`、`suppliers` |
| 外部业务数据 | `sales_orders`、`finished_goods_inbound` |
| 可追溯性 | `audit_logs`、`import_jobs`、`import_job_errors`、`idempotency_keys` |

关键约束：

- 计划月 `(year, month)` 唯一。
- 月度品号 `(period_id, order_id, item_number)` 唯一。
- 工序进度 `(order_item_id, process_definition_id)` 唯一。
- 日进度 `(order_item_id, process_definition_id, work_date)` 唯一。
- 销售接单使用 `(order_number, item_number)` 唯一。
- 成品入库使用 `(document_number, inventory_code, relation_info)` 唯一。
- 多数业务实体带创建/修改时间、修改人和 `version`，用于审计或乐观锁。

## 6. 主要业务计算

`DomainService` 负责相对纯粹的业务计算：

- 欠数 = 生产数量 - 历史入库数量 - 当天入库数量。
- 已完成数量 = 总数量 - 欠数合计。
- 完成率 = 已完成数量 / 总数量；总数量为 0 时返回 `null`。
- 入库金额、欠数金额使用 `Decimal`，避免 JavaScript 浮点误差。
- 负欠数不强行截断，保留原始数据并返回数据质量警告。
- 里程碑状态结合数量、完成数量和日期计算，并优先判断逾期状态。

业务上仍有待确认的规则：产前评审交期“当天且未完成”在需求描述中同时出现黄色/红色；当前实现约定为等于今天黄色、早于今天红色、完成率大于等于 100% 绿色。

## 7. 导入与外部同步流程

### 月度计划 Excel

1. 用户在“主计划 → 月度计划”选择年月并上传标准 `.xlsx`。
2. 后端解析工作表、双层表头、日期、数字、字典和工序字段。
3. 创建导入任务并保存错误/警告；预览阶段不写入正式业务数据。
4. 全部硬错误通过后，用户确认，后端在事务中按业务键插入或更新。
5. 同一业务键重复导入时更新现有记录，不增加重复数据。

企业 DRM/透明加密文件可能不是标准 ZIP/XLSX 容器。系统可选地调用本机解密命令或在受信任 Windows Excel 环境转换临时标准文件；不会绕过加密，临时明文应在流程结束后删除。

### T+ 同步

`data-operations/tplus` 从 SQL Server/T+ 数据源读取双账套有效订单，最早日期由 `TPLUS_BEGIN_DATE` 控制。建议先运行：

```bash
pnpm sync:tplus:dry-run
pnpm test:tplus-sync
pnpm sync:tplus
```

真实数据库密码和写入 API Key 只应放在未提交的 `.env`。API Key 需要关联启用用户并具备 `tplus-sales-orders:*:import` 权限。

## 8. 鉴权、权限和协同机制

- 登录返回短期 access token 和 refresh token；支持登出和修改密码。
- JWT claims 包含用户、角色、权限和事业部范围。
- API 请求统一经过鉴权；计划查询、更新和导入还需要资源/动作权限及数据范围检查。
- 外部自动化使用 API Key，可配置作用域、关联用户/角色、有效期和停用/重新生成。
- 计划单元格更新携带 `expectedVersion`；版本不一致返回 409，前端应保留编辑状态并提示冲突。
- 变更成功后通过 WebSocket 广播；当前设计目标是业务记录协同，不是对同一个 XLSX 文件做 OT/CRDT。
- 修改上下文通过 `AsyncLocalStorage` 传递给审计订阅器，记录操作者、请求号和前后值。

审查时需特别确认：所有写入端点（尤其基础资料、管理端点、T+ 端点、批量导入）是否一致执行资源权限、字段权限、数据范围、审计和幂等策略；不能只检查主计划单元格更新路径。

## 9. API 与前端页面边界

API 前缀为 `/api/v1`，Swagger UI 为 `/api/docs`，OpenAPI JSON 为 `/api/openapi.json`。主要控制器边界：

- `auth`：登录、刷新、登出、修改密码。
- `plans`：计划期间、月度计划、日进度、滚动计划、销售汇总、订单、计划行、批量更新、图片和导出。
- `imports`：月度计划导入预览与确认。
- `master-data`：供应商、字典、工序、销售接单、成品入库及其导入导出。
- `audit-logs`：审计检索。
- `api-keys`：API Key 生命周期管理。
- `admin`：用户、角色、组织单位、联系人。
- `data-operations/tplus`：T+ 销售订单快照写入。

前端主要页面/模块：

- 销售接单汇总大屏。
- 销售接单明细。
- 2026 年月度计划页面。
- 日进度页面。
- 基础数据维护。
- 成品入库。
- 审计日志。
- API Key 管理。
- 用户与角色。
- 企业微信通讯录只读目录。

## 10. 部署与运行

生产 Compose 服务：

1. `postgres`：PostgreSQL 18，仅内部网络可访问，数据挂载到 `data/postgres`。
2. `api`：NestJS，内部暴露 15173，上传目录挂载到 `data/uploads`。
3. `web`：Nginx，宿主机入口通常为 15172，负责 SPA、`/api`、`/uploads` 和 `/socket.io` 反向代理。

常用命令：

```bash
./scripts/init-env.sh
./scripts/start.sh
./scripts/healthcheck.sh
./scripts/backup.sh
./scripts/migrate.sh
./scripts/upgrade.sh
./scripts/stop.sh
```

部署脚本强调：`.env` 不入 Git；数据库恢复前检查 SHA256 和空 schema；常规停止/重建不删除宿主机持久化数据；不要使用 `docker compose down -v`。

## 11. 已有测试与验证信息

仓库包含：

- API 单元测试：领域计算、鉴权/API Key、T+ 数据映射。
- API 集成测试：健康检查等系统边界。
- Web 单元测试：共享字段契约、列数、状态计算、筛选和图标。
- Playwright E2E：核心登录、计划查看/编辑、导入和错误处理等流程。
- T+ Node 原生测试：SQL 参数处理和订单映射。
- README 声称 lint、typecheck、unit/API integration、build、Playwright、migration 和 seed 已通过；当前工作树有未提交修改，交给审查 AI 前建议在目标环境重新执行完整命令。

建议验证命令：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:tplus-sync
```

## 12. 已知待确认项与风险线索

以下不是已经确认的缺陷，而是应优先让审查 AI 评估的风险点：

1. **前后端大文件聚合**：`App.tsx` 和 `controllers.ts` 集中了大量页面/端点，长期可能降低模块隔离、测试定位和多人协作效率。
2. **权限一致性**：需要逐个核查所有管理、导入、基础资料和集成写入端点是否没有绕过字段级权限、事业部范围和审计。
3. **导入事务边界**：确认大文件解析、预览任务、确认写入、错误清单、重复导入和并发确认时的状态机是否完整，是否可能重复确认或长事务阻塞。
4. **实时协同范围**：确认 WebSocket 广播不会把其他事业部/组织范围的数据或变更细节泄露给无权用户，并评估断线重连、消息丢失和缓存失效策略。
5. **文件安全**：评估上传文件类型校验、文件名/路径、图片处理、静态资源访问权限、大小限制、临时明文删除和恶意压缩包风险。
6. **计算一致性**：确认欠数、金额、完成率和工序状态在 API 查询、导入、批量修改、日进度、月初滚动和前端展示中只有一个权威规则来源。
7. **数据来源治理**：销售接单既有人工/Excel 入口又有 T+ 快照入口，需要明确来源字段、覆盖策略、删除/停用语义和冲突处理。
8. **数据库迁移与恢复**：评估 PostgreSQL 18 绑定目录、migration 回滚能力、备份可恢复演练、升级期间停机窗口和大表索引策略。
9. **观测性**：目前有请求号、审计和容器日志；可进一步评估结构化日志、指标、慢查询、导入耗时、WebSocket 在线状态和告警。
10. **业务规则未完全固化**：未来计划来源、图片与品号映射、交期颜色规则、外协规则和部分历史 Excel 字段仍需要业务确认。
11. **环境耦合**：T+ SQL 文件路径、局域网 IP、Cloudflare 域名和 Windows 解密能力都通过环境或宿主机约定提供，应评估跨环境部署、凭据轮换和失败降级。
12. **当前版本边界**：工作区包含未提交变更；应先形成可复现提交/版本和数据库迁移基线，再讨论生产发布或大规模重构。

## 13. 请审查 AI 重点回答的问题

请基于源码而不是只基于本文档，按“问题 → 证据 → 影响 → 优先级 → 建议方案 → 实施成本/风险”的格式回答：

1. 当前 React + AG Grid + Ant Design + TanStack Query、NestJS + TypeORM + PostgreSQL 的组合是否适合这个大宽表生产协同场景？哪些技术需要保留、替换或补充？
2. 现有实体关系、唯一键、版本控制、导入任务和月初滚动是否能保证数据一致性、可追溯和幂等？
3. 权限模型（资源动作 + 字段 + 事业部/组织范围 + API Key）是否足够安全且可维护？请找出可能绕过权限的路径。
4. Excel 导入、T+ 同步、人工编辑三类写入如何建立统一的数据来源、优先级、冲突、停用和审计策略？
5. WebSocket 协同设计是否合理？请评估并发编辑、409 冲突、断线重连、消息顺序、权限过滤和前端缓存一致性。
6. 以当前代码组织方式，应该如何拆分前后端模块、领域服务、DTO、校验器、查询层和组件，同时控制重构风险？
7. 哪些 API、数据库查询、导入解析和前端 AG Grid 交互可能在数据量扩大后出现性能瓶颈？请给出容量假设和优化顺序。
8. 请进行安全审查：认证、Token/API Key、密码、CORS、上传、Excel 解密、静态文件、SQL、日志脱敏、备份和生产网络暴露面。
9. 测试覆盖是否能支撑发布？请列出缺少的单元、集成、契约、并发、恢复、权限矩阵和端到端测试。
10. 请给出分阶段技术路线：短期修补（1–2 周）、中期治理（1–2 月）、长期演进（季度级），每项标明收益、依赖和验收标准。

## 14. 审查输出建议格式

请先给出不超过一页的结论，然后按以下章节展开：

- 总体评价与架构适配度
- 必须立即修复的高风险问题
- 技术栈保留/替换/新增建议
- 数据模型与一致性审查
- 权限和安全审查
- 性能与可扩展性审查
- 测试与发布工程审查
- 推荐目标架构（可附目录结构或 Mermaid 图）
- 分阶段实施路线图
- 需要业务方确认的问题
- 最终优先级清单（P0/P1/P2）

请避免泛泛而谈；每个重要结论都应引用具体文件、类、方法、实体、API 或配置作为证据，并说明是否已通过测试验证。
