# KDOS architecture

KDOS is a modular monolith for Kainan operations. Phase one makes Planning Center the first formal business module while the old TypeORM system remains available during migration.

## Runtime

- `apps/web`: React 19, Vite, TanStack Query, Ant Design, AG Grid Community.
- `apps/api`: NestJS modular-monolith API, local JWT compatibility auth, Socket.IO.
- `apps/worker`: asynchronous job contract; phase one uses no broker.
- `apps/mcp`: read-only AI tool catalog skeleton; no database execution.
- PostgreSQL 18: legacy `four_department_tracker` plus the new `kdos` database in the same retained server.
- Nginx: sole HTTP entry point for SPA, `/api`, `/uploads`, and Socket.IO.

Node.js 24 is the build/runtime target. pnpm 11 manages all workspaces.

## Dependency direction

```text
Web / Import / Integration / System job / future AI
                        |
                        v
             Planning Application Service
                        |
                        v
                 Planning Domain
                        |
                        v
             Planning Repository interface
                        |
                        v
          Drizzle schema + PostgreSQL adapter
```

Controllers only translate HTTP input/output. Query services provide stable read models for AG Grid, BI and future AI. Business rules do not live in controllers, Excel parsers, adapters or React components.

External systems follow this direction:

```text
T+ / future E10 / WMS / MES
              |
              v
      Integration Adapter
              |
              v
       Canonical Model
              |
              v
   Planning Application Commands
```

## Workspace map

- `packages/contracts`: permissions, events, API contracts and 102-field Planning Registry (97 preserved + 5 orchestration fields).
- `packages/database`: Drizzle schema and PostgreSQL client.
- `packages/permissions`: action and field-access engine.
- `packages/auth`: `AuthProvider`, local-development and Keycloak provider boundaries.
- `packages/canonical-model`: ERP-neutral customers, suppliers, items and sales orders.
- `packages/integration-sdk`: provider and idempotent integration contracts.
- `packages/workflow-sdk`: approval gateway and phase-one no-op implementation.
- `packages/plugin-sdk`: module manifest contracts.
- `packages/ai-tool-sdk`: five read-only Planning tool definitions.
- `integrations/tplus`: dual-account T+ to Canonical Sales Order adapter.
- `apps/api/src/modules/planning`: Planning controller, commands, domain, repository, query, import/export/image services and manifest.
- `apps/web/src/modules/planning`: metadata-driven grid, monthly plan, sales summary/details and daily-progress pages.

## Planning state model

`PlanPeriod` owns numbered `PlanVersion` records.

- `DRAFT`: editable; one draft per period.
- `PUBLISHED`: immutable default version for consumers; publish creates an immutable JSON snapshot and audit/event records.
- `LOCKED`: immutable operational close; unlock requires permission and a reason and returns the version to `PUBLISHED`.
- `ARCHIVED`: prior published version retained when a newer draft is published.

Creating a new version copies plan items and process progress within the same period. Historical versions are never overwritten. Each plan item and process progress record has an optimistic integer `version`; stale writes return HTTP 409.

## Data model

Schemas and principal tables:

- `iam`: `tenants`, `organizations`, `departments`, `positions`, `employees`, `users`, `identities`, `roles`, `permissions`, `role_permissions`, `role_bindings`, `field_policies`.
- `planning`: `plan_periods`, `plan_versions`, `sales_orders`, `sales_order_lines`, `plan_items`, `process_definitions`, `process_progress`, `daily_progress`, `plan_snapshots`, `plan_changes`.
- `audit`: `audit_logs`.
- `integration`: `import_jobs`.
- `core`: migration ledger.

All collaborative Planning and IAM tables carry `tenant_id`. PostgreSQL RLS checks `app.tenant_id`; application queries still filter tenant explicitly. IDs default to PostgreSQL 18 `uuidv7()`.

Important uniqueness rules include tenant/year/month, period/version number, version/order/item, item/process, item/process/day and tenant/import-idempotency key. Quantity and money columns use `numeric`; `decimal.js` is the calculation authority in the domain layer.

## Metadata-driven Planning grid

The registry is the source for label, group, order, width, pinning, type, editor, renderer, visibility, editability, permission and process source. The API adds field access (`HIDDEN`, `READONLY`, `EDITABLE`, `MASKED`); the web column builder converts metadata into AG Grid definitions. The backend repeats field authorization before any write.

The preserved UI includes grouped headers, 14 configurable processes, horizontal virtualization, pinned identification columns, sorting, quick filtering, field visibility, cell editing, image upload, batch update and persisted sequence.

## Integration and jobs

Excel follows upload → parse → normalize → validate → preview → confirm → application command → transaction. File hash plus version forms the import idempotency key; repeated confirmation returns the prior result.

T+ source SQL remains isolated in `data-operations/tplus`; the reusable adapter in `integrations/tplus` maps both accounts to the canonical model. Planning never imports a T+ SQL reader.

Monthly rollover runs with a `SYSTEM` actor and calls Planning query/application services. It creates a period and draft idempotently and carries previous outstanding items through normal commands.

## Events, workflow and AI

Socket.IO receives minimal events such as tenant, period, version, entity id, optimistic version and change type; clients invalidate queries and refetch authorized data.

Planning exposes a `WorkflowGateway` boundary for publish, major changes, delivery-date changes, unlock and period close. Phase one records the contract but does not deploy Flowable.

The MCP skeleton exposes five read-only tool contracts: plan search/get, order progress, process progress and risk summary. Tool execution must call Query/Application services, never SQL.
