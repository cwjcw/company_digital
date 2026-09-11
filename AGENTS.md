# KDOS engineering rules

- Controllers cannot access databases; they call Application or Query Services.
- Domain code cannot depend on NestJS controllers.
- Business modules cannot depend directly on Drizzle or external ERP clients.
- Planning cannot read T+ SQL; external systems use Integration Adapters and Canonical Models.
- Web, Excel, T+, system jobs and future AI writes all use Application Commands.
- 当需求的完整实现确实需要 API 调整时，可以直接新增、修改或删除路由、请求/响应契约及对外行为，无需另行征得用户授权；仍须控制在需求范围内，说明影响，更新调用方、文档和测试，并完成权限、安全、审计与部署验证。不得为与需求无关的改动随意调整 API。
- 对会影响运行效果的代码、前端、API、数据库结构或配置改动，本地完成不等于交付完成：相关验证通过后必须备份、迁移并部署到当前运行环境，再执行健康检查和面向用户的线上效果核验，让用户可以直接看到结果。除非用户明确要求暂不部署，或外部依赖/权限阻塞；发生阻塞时必须说明未上线范围、原因和恢复条件，不得把“代码已完成”表述为“已交付”。
- AI tools cannot access SQL/Drizzle and phase-one AI tools are read-only.
- Every Planning core table has `tenant_id`; repository transactions set tenant context for RLS.
- Frontend button/column hiding is not authorization; backend permissions and field access are mandatory.
- Every critical write records Audit; collaborative entities use optimistic `version`.
- `PUBLISHED` and `LOCKED` transitions must pass the Planning state machine.
- Quantity and money calculations use exact decimal arithmetic and PostgreSQL `numeric`.
- External writes and event consumers must be idempotent.
- 所有表格文件导入必须在解析内容前调用统一的加密文件检测；检测到加密容器时停止导入并原样提示“该文件被加密,请解密后再导入.”，不得将其混同为文件损坏、模板错误或服务端异常。
- WebSocket events contain only invalidation metadata, never complete sensitive rows.
- Use UUIDv7 business IDs; identity-provider subjects belong in `iam.identities`.
- Keep `four_department_tracker` read-only/retained until the user authorizes retirement.
- Never commit `.env`, credentials, tokens, T+ snapshots, database files, or uploaded business images.
- SQL Server、企业微信和通讯录导出统一使用 `/data/automation/code/work/basci/basic_code` 的 `MSSQLDatabase`、`WeChatPusher` 和 `export_contacts`；密钥只保存在该工具包自己的 `.env`，不得复制到本项目。
- `WeChatPusher()` 使用计划中心默认自建应用；指定业务应用时使用 `WeChatPusher(app="...")`。群机器人只能显式调用 `send_robot_*()`，不得作为自建应用消息的自动回退。
- Do not introduce Kafka, Kubernetes, microservices, extra databases, or infrastructure without a proven requirement.
- Preserve AG Grid Community, the 97 legacy Planning fields, 14 process definitions, and migration tests.

See `ARCHITECTURE.md`, `SECURITY.md`, `docs/runbook.md`, and `docs/integration-guide.md` before changing a boundary.
