# Kainan Digital OS (KDOS)

凯南数字化工作台是一个 PostgreSQL 驱动的生产协同模块化单体。第一阶段将原四部追踪表升级为正式的 Planning Center：保留 97 个历史业务字段和 14 个工序，并加入计划周期、版本、发布、锁定、快照、审计、多租户、字段权限和集成边界。

## 技术栈

- Node.js 24、pnpm 11、TypeScript 5.9
- React 19、Vite、TanStack Query、Ant Design、AG Grid Community
- NestJS 11、Socket.IO、ExcelJS、Sharp、decimal.js
- PostgreSQL 18、Drizzle（KDOS 新模型）、TypeORM（迁移期旧模块）
- Vitest、Jest、Playwright

架构与安全边界见 [ARCHITECTURE.md](ARCHITECTURE.md)、[SECURITY.md](SECURITY.md) 和 [AGENTS.md](AGENTS.md)。

## 仓库结构

```text
apps/web                 React 前端
apps/api                 NestJS API
apps/worker              异步任务边界
apps/mcp                 只读 AI Tool/MCP 骨架
packages/contracts       Planning Metadata Registry 与契约
packages/database        Drizzle Schema 和数据库客户端
packages/permissions     权限与字段访问引擎
packages/auth            Local/Keycloak AuthProvider 边界
packages/canonical-model ERP 中立模型
packages/*-sdk           Integration/Workflow/Plugin/AI SDK
integrations/tplus       双账套 T+ Canonical Adapter
database/migrations      KDOS SQL migrations
docs                     运行、集成、迁移和业务文档
```

## 数据库迁移策略

当前 PostgreSQL 服务保留两个数据库：

- `four_department_tracker`：旧系统数据库，验收前保留，不删除、不覆盖。
- `kdos`：第一阶段新数据库，包含 `iam`、`planning`、`audit`、`integration`、`core` schema。

KDOS 表使用 UUIDv7、`tenant_id`、PostgreSQL RLS、明确唯一约束和 `numeric`。迁移由 `core.schema_migrations` 记录并校验文件 SHA256。

## 配置

复制 `.env.example` 为 `.env`，填写数据库密码和两个不同的 JWT 密钥。真实凭据、API Key、T+ 快照和业务上传文件不得提交。

关键变量：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_*` | 迁移期旧数据库连接 |
| `KDOS_DATABASE_*` | 新 `kdos` 数据库连接 |
| `KDOS_DEFAULT_TENANT_CODE` | 默认租户，当前为 `KAINAN` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | 本地兼容鉴权密钥 |
| `UPLOAD_DIR` / `MAX_IMAGE_BYTES` | LocalObjectStorage 目录和图片上限 |
| `TPLUS_*` | T+ 只读源连接 |

完整说明见 [docs/runbook.md](docs/runbook.md)。

## 安装、迁移和启动

```bash
pnpm install
./scripts/init-kdos-db.sh
pnpm db:kdos:migrate
docker compose build
docker compose up -d
docker compose ps
```

生产入口默认为 `http://127.0.0.1:15172`；局域网绑定由 `.env` 的 `WEB_LAN_ADDRESS` 控制。Nginx 代理 `/api`、`/uploads`、`/socket.io` 和 SPA 路由。API 与 PostgreSQL 不发布到宿主机。

现有部署脚本仍可用于备份、恢复、日志和健康检查：

```bash
./scripts/start.sh
./scripts/stop.sh
./scripts/logs.sh
./scripts/healthcheck.sh
./scripts/backup.sh
./scripts/upgrade.sh
```

不要使用 `docker compose down -v`。

## Planning Center

月计划页面按 Metadata Registry 构建 102 个字段（97 个原字段 + 优先级、计划顺序、责任组织、负责人、计划状态）。支持：

- AG Grid 双层/折叠表头、固定列、排序、筛选、横向虚拟滚动和字段显示；
- Draft 单元格编辑、图片、批量修改和计划顺序保存；
- Published 只读、Locked 只读、基于正式版本创建新 Draft；
- 发布快照、锁定/解锁原因、审计和最小化 Socket.IO 事件；
- 交期逾期、未来 N 天到期、工序逾期和未关闭异常查询；
- Excel/CSV 解析、预览、确认、幂等写入和元数据导出。

接口见 [docs/integration-guide.md](docs/integration-guide.md)，操作说明见 [docs/月度计划填写说明.md](docs/月度计划填写说明.md)。

## T+ 集成

`integrations/tplus` 实现 `SalesOrderProvider` 的 Canonical Mapping 与单次读取去重。现有源读取脚本继续放在 `data-operations/tplus`，先做只读检查：

```bash
pnpm test:tplus-sync
pnpm sync:tplus:dry-run
```

确认数据和 API Key 权限后才运行 `pnpm sync:tplus`。Planning 模块不得导入 T+ SQL 或 SQL Server 客户端。

## 测试

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:tplus-sync
```

重构前基线、字段清单和截图位于 [docs/migration](docs/migration)；第一阶段结果见 [outputs/KDOS第一阶段实施报告.md](outputs/KDOS第一阶段实施报告.md)，AI 审查交接资料见 [outputs/AI项目审查资料.md](outputs/AI项目审查资料.md)。
