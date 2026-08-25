# KDOS engineering rules

- Controllers cannot access databases; they call Application or Query Services.
- Domain code cannot depend on NestJS controllers.
- Business modules cannot depend directly on Drizzle or external ERP clients.
- Planning cannot read T+ SQL; external systems use Integration Adapters and Canonical Models.
- Web, Excel, T+, system jobs and future AI writes all use Application Commands.
- AI tools cannot access SQL/Drizzle and phase-one AI tools are read-only.
- Every Planning core table has `tenant_id`; repository transactions set tenant context for RLS.
- Frontend button/column hiding is not authorization; backend permissions and field access are mandatory.
- Every critical write records Audit; collaborative entities use optimistic `version`.
- `PUBLISHED` and `LOCKED` transitions must pass the Planning state machine.
- Quantity and money calculations use exact decimal arithmetic and PostgreSQL `numeric`.
- External writes and event consumers must be idempotent.
- WebSocket events contain only invalidation metadata, never complete sensitive rows.
- Use UUIDv7 business IDs; identity-provider subjects belong in `iam.identities`.
- Keep `four_department_tracker` read-only/retained until the user authorizes retirement.
- Never commit `.env`, credentials, tokens, T+ snapshots, database files, or uploaded business images.
- SQL Server、企业微信和通讯录导出统一使用 `/data/automation/code/work/basci/basic_code` 的 `MSSQLDatabase`、`WeChatPusher` 和 `export_contacts`；密钥只保存在该工具包自己的 `.env`，不得复制到本项目。
- `WeChatPusher()` 使用计划中心默认自建应用；指定业务应用时使用 `WeChatPusher(app="...")`。群机器人只能显式调用 `send_robot_*()`，不得作为自建应用消息的自动回退。
- Do not introduce Kafka, Kubernetes, microservices, extra databases, or infrastructure without a proven requirement.
- Preserve AG Grid Community, the 97 legacy Planning fields, 14 process definitions, and migration tests.

See `ARCHITECTURE.md`, `SECURITY.md`, `docs/runbook.md`, and `docs/integration-guide.md` before changing a boundary.
