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
- Do not introduce Kafka, Kubernetes, microservices, extra databases, or infrastructure without a proven requirement.
- Preserve AG Grid Community, the 97 legacy Planning fields, 14 process definitions, and migration tests.

See `ARCHITECTURE.md`, `SECURITY.md`, `docs/runbook.md`, and `docs/integration-guide.md` before changing a boundary.
