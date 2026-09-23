# KDOS architecture

KDOS is a modular monolith for Kainan operations. Phase one makes Planning Center the first formal business module while the old TypeORM system remains available during migration.

## Runtime

- `apps/web`: React 19, Vite, TanStack Query, Ant Design, AG Grid Community, Apache ECharts.
- `apps/api`: NestJS modular-monolith API, local JWT compatibility auth, Socket.IO.
- `apps/worker`: asynchronous job contract; phase one uses no broker.
- `apps/mcp`: read-only AI tool catalog skeleton; no database execution.
- PostgreSQL 18: legacy `four_department_tracker` plus the new `kdos` database in the same retained server.
- Nginx: sole HTTP entry point for SPA, `/api`, `/uploads`, and Socket.IO.

Node.js 24 is the build/runtime target. pnpm 11 manages all workspaces.

Apache ECharts is the KDOS standard business-chart foundation. Business modules use it only through the shared `apps/web/src/shared/charts` public components and do not maintain independent chart initialization implementations.

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

- `packages/contracts`: permissions, events and API contracts. The active monthly-plan import/export registry contains 85 business fields plus four audit fields; the web table presents 82 business fields by omitting the three monetary fields, displays the department-backed `responsibleOrgId` after sequence, and moves customer before order number. The historical 97-field registry and five orchestration fields remain separately preserved for compatibility.
- `packages/database`: Drizzle schema and PostgreSQL client.
- `packages/permissions`: action and field-access engine.
- `packages/auth`: `AuthProvider`, local-development and Keycloak provider boundaries.
- `packages/canonical-model`: ERP-neutral customers, suppliers, items and sales orders.
- 高频 ERP 采集先进入唯一的 `erp_staging_raw_records` 原始层；真实内容变化与 `erp_change_events` 在同一事务提交。订单、入库、出库及未来投影通过 `erp_projection_consumers` 使用独立游标、租约和重试消费，不直接耦合 SQL Server，也不重复创建同义业务表。
- `packages/integration-sdk`: provider and idempotent integration contracts.
- `packages/workflow-sdk`: approval gateway and phase-one no-op implementation.
- `packages/plugin-sdk`: module manifest contracts.
- `packages/ai-tool-sdk`: five read-only Planning tool definitions.
- `integrations/tplus`: dual-account T+ to Canonical Sales Order adapter.
- `apps/api/src/modules/planning`: Planning controller, commands, domain, repository, query, import/export/image services and manifest.
- `apps/api/src/modules/master-plan-system`: metadata-driven主计划查询与命令、受控 Excel 更新和事务型重投影 outbox。业务写入与 `mps_reconciliation_outbox` 同事务提交；消费者独立重试，不把提交后的投影失败伪装成业务写入失败。
- `apps/api/src/modules/notifications`: KDOS 通知后端基础设施。通知规则、`notification_outbox` 与逐接收人 `notification_delivery_logs` 使用 PostgreSQL 事务、租户 RLS 和幂等 dedup key；Dispatcher 领取前在 API 内完成规则匹配和动态责任人解析，领取使用 `FOR UPDATE SKIP LOCKED`，不包含通知中心前端。
- `apps/web/src/modules/planning`: metadata-driven grid, monthly/weekly plan, sales summary/details, September on-hand summary dashboard and work-report pages.
- `apps/api/src/modules/equipment` and `apps/web/src/modules/equipment`: tenant-scoped equipment ledger, many-to-many system-member responsibility, rolling-seven-day status reporting and company cockpit read models. Status pages resolve responsibility live through `equipment_responsibles` by stable equipment ID, so ledger changes appear without copying stale responsibility into status rows; the status-table responsibility field is available but hidden in the default personal view. The controller calls separate application/query services; organization UUIDs are authoritative and workbook names are retained only as snapshots.
- `apps/api/src/modules/supply-chain` and `apps/web/src/modules/data-center`: the independently governed, read-only `supplier-list` resource. T+ extraction is isolated in `automation/tplus_supplier_import`; its canonical rows enter the tenant-scoped `supply_chain_suppliers` table only through `SupplyChainApplicationService`, with source-account keys, idempotency and audit.

## Administrator authority

Administrator authority is deliberately separate from ordinary roles and per-table permission groups. Tenant-scoped `administrator_grants` records define either a system administrator or one or more stable module codes. The built-in `admin` account is the default immutable system administrator and is the only account allowed to maintain the system-administrator list. Other system administrators may maintain module administrators; module administrators have read-only access to the two administrator lists. System administrators receive the explicit highest-level claim and exclusively operate the rest of System Management. Module administrators receive every supported action and full data scope only for resources registered to their module; they can manage those tables' permission groups through resource-scoped query and application services. Administrator changes are transactional, versioned and audited, and the runtime refreshes live claims on every protected request.

## Planning state model

`PlanPeriod` owns numbered `PlanVersion` records.

- `DRAFT`: editable; one draft per period.
- `PUBLISHED`: immutable default version for consumers; publish creates an immutable JSON snapshot and audit/event records.
- `LOCKED`: immutable operational close; unlock requires permission and a reason and returns the version to `PUBLISHED`.
- `ARCHIVED`: prior published version retained when a newer draft is published.

Creating a new version copies plan items and process progress within the same period. Historical versions are never overwritten. Each plan item and process progress record has an optimistic integer `version`; stale writes return HTTP 409.

## Data model

Schemas and principal tables:

- `iam`: `tenants`, `organizations`, `departments`, `positions`, `employees`, `users`, `identities`, `roles`, `permissions`, `role_permissions`, `role_bindings`, `field_policies`. The compatibility IAM also stores per-table permission groups on technical roles and keeps their dynamic `USER` / `ORGANIZATION` / `ROLE` grants in `permission_group_subjects`; technical roles are hidden from ordinary role management.
- The compatibility `organization_units` directory is the current canonical bridge to WeCom: external department identity, topology and live leader user IDs are synchronized together. Business department fields store its stable UUID and retain names only as display snapshots; leader-based data scopes expand the live organization subtree per request.
- Monthly-plan “事业部” uses `responsible_org_id` and resolves to the stable `organization_units.id`. September source adapters derive the display name from each original division workbook filename, and import resolution rejects missing or ambiguous organization matches rather than storing the name as identity.
- `planning`: `plan_periods`, `plan_versions`, `sales_orders`, `sales_order_lines`, `plan_items`, `rolling_plan_items`, `division_order_reviews`, `process_definitions`, `process_progress`, `plan_snapshots`, `plan_changes`, `weekly_plan_periods`, `weekly_plan_items`, `work_reports`; compatibility equipment tables are `equipment_assets`, `equipment_responsibles`, and `equipment_status_reports`. `rolling_plan_items`复用月度计划的85字段展示契约，以订单号+品号为稳定业务键。`division_order_reviews` 是订单排期的事务投影：源字段随订单排期在同一事务中更新，事业部评审交期由获权用户维护；确认命令按订单号+品号写入滚动计划。首次写入映射客户、事业部、订单/品项、品名、需求数量、客户交期和评审交期，已有目标只更新需求数量、客户交期和评审交期，其他人工字段保留。源记录变更会清除旧确认状态，源记录硬删除时评审记录保留并转为作废。
- `audit`: `audit_logs`.
- `integration`: `import_jobs`.
- Data Center supply-chain projection: `supply_chain_suppliers`, uniquely keyed by tenant, source system, source database and source ID. It intentionally excludes supplier bank accounts and tax-registration fields.
- `core`: migration ledger.

All collaborative Planning and IAM tables carry `tenant_id`. PostgreSQL RLS checks `app.tenant_id`; application queries still filter tenant explicitly. IDs default to PostgreSQL 18 `uuidv7()`.

Important uniqueness rules include tenant/year/month, period/version number, version/order/item, item/process, work-report tenant/date/source-plan-item and tenant/import-idempotency key. Quantity and money columns use `numeric`; `decimal.js` is the calculation authority in the domain layer.

主计划月计划与订单分配以租户、订单号、品号建立复合引用；出货计划通过可空 `monthly_plan_id` 建立租户内稳定 UUID 引用。无法自动匹配的历史测试数据保留为空引用并单独登记，不以猜测或删除方式修复。主计划业务表审计操作者使用 `users.id` UUID；系统任务使用禁用登录的固定系统用户。

## Metadata-driven Planning grid

The registry is the source for label, group, order, width, pinning, type, editor, renderer, visibility, editability, permission and process source. The API adds field access (`HIDDEN`, `READONLY`, `EDITABLE`, `MASKED`); the web column builder converts metadata into AG Grid definitions. The backend repeats field authorization before any write.

The preserved UI includes grouped headers, 14 configurable processes, horizontal virtualization, pinned identification columns, sorting, quick filtering, field visibility, cell editing, image upload, batch update and persisted sequence.

All business-table queries use a shared five-minute in-memory freshness window and are cleared on logout. Growing record tables return `{ rows, total, page, pageSize }` after authorized server-side search/filter/paging; ordinary page re-entry uses the cached result until it expires or a write/realtime invalidation occurs. Ant Design and AG Grid share Chinese pagination and menu text.

`KdosDataTable` standard record tables use one common column menu on real leaf fields (sort, pin left, hide, filter); `simple` tables and technical/action/group columns do not. Quick search, advanced filter and header filters share the registered `TableFilterRegistry` source and the single `SqlFilterCompiler`. The backward-compatible recursive `FilterGroup` is `ROOT AND (advanced) AND (headers)`; different header fields are AND, same-field choices and `is_empty` are OR. The API validates nesting, rule count, field metadata and field-read permission. Candidate values come from the complete tenant/data-scope-authorized server result with quick search and other active conditions; the current field's own header condition is excluded, and high-cardinality results are capped with explicit `hasMore`. List, count, export and print receive the same effective group; changing sort/filter returns to page one. Personal hidden/pinned/page-size preferences are scoped by user, resource and view key; header conditions are not persisted.

## Integration and jobs

Excel follows upload → parse → normalize → validate → preview → confirm → application command → transaction. File hash plus version forms the import idempotency key; repeated confirmation returns the prior result.

T+ source SQL remains isolated in integration adapters; sales-order reads stay in `data-operations/tplus` / `integrations/tplus`, while supplier-master reads stay in `automation/tplus_supplier_import`. Both map external rows to canonical models before invoking application commands. Planning and supply-chain business modules never import a T+ SQL reader.

Monthly rollover runs with a `SYSTEM` actor and calls Planning query/application services. It creates a period and draft idempotently and carries previous outstanding items through normal commands.

KDOS notifications use the same transactional-outbox boundary: an application command may enqueue a tenant-scoped notification through `NotificationService` in its current transaction. The outbox supports `PENDING`, `PROCESSING`, `SENT` and `FAILED`, records `next_retry_at`, and writes recipient-level delivery attempts. The internal Dispatcher API performs rule resolution and equipment-responsible lookup before returning text to the host adapter; the host adapter only calls the default `basic_code` `WeChatPusher`, with an environment-controlled single-recipient validation gate. There is no broker, Redis, RabbitMQ, Kafka or notification-center frontend.

## Events, workflow and AI

Socket.IO receives minimal events such as tenant, period, version, entity id, optimistic version and change type; clients invalidate queries and refetch authorized data.

Planning exposes a `WorkflowGateway` boundary for publish, major changes, delivery-date changes, unlock and period close. Phase one records the contract but does not deploy Flowable.

The MCP skeleton exposes five read-only tool contracts: plan search/get, order progress, process progress and risk summary. Tool execution must call Query/Application services, never SQL.
