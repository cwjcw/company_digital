# KDOS Planning integration guide

All Planning routes use `/api/v1/planning`, bearer JWT/API identity and tenant code `KAINAN` by default. External writers must use an idempotency key and must not access the Planning database.

## Core routes

| Method and route | Purpose | Permission |
| --- | --- | --- |
| `GET /fields` | metadata registry with field access | `planning.plan.read` |
| `GET /periods/by-month?year=&month=` | period and versions | `planning.plan.read` |
| `POST /periods` | create period | `planning.plan.create` |
| `POST /periods/:id/versions` | create draft | `planning.plan.create` |
| `GET /versions/:id/items` | authorized plan read model | `planning.plan.read` |
| `PATCH /items/:id` | optimistic field update | `planning.plan.update` + field access |
| `POST /versions/:id/items/bulk` | transactional batch update | `planning.plan.update` |
| `POST /versions/:id/reorder` | persist sequence | `planning.plan.move` |
| `POST /periods/:p/versions/:v/publish` | publish and snapshot | `planning.plan.publish` |
| `POST .../:v/lock` / `unlock` | state transition with reason | lock/unlock permission |
| `GET /versions/:id/risks?days=7` | overdue/due-soon/process/exception risks | `planning.plan.read` |

Optimistic update body:

```json
{ "field": "productionQuantity", "value": "25.5000", "expectedVersion": 3 }
```

HTTP 409 means the version is stale or the plan is no longer a draft. Refetch before retrying; never blindly increment the client version.

## Excel import

1. `POST /versions/:versionId/imports/preview` as multipart field `file` (`.xlsx` or `.csv`).
2. Review `jobId`, summary and warnings.
3. `POST /imports/:jobId/confirm`.

The file SHA256 and target version are the idempotency identity. Repeating confirm returns `repeated: true` and does not write twice. Export uses `GET /versions/:versionId/export`.

## T+ and future ERP

Implement `SalesOrderProvider` from `packages/integration-sdk`, map source rows to `packages/canonical-model`, then call a protected application/API ingestion command. `integrations/tplus` demonstrates dual-account mapping and per-read deduplication. Source SQL and connection details stay outside Planning.

Phase-one legacy T+ snapshot route remains `/api/v1/data-operations/tplus/sales-orders/snapshot` for compatibility while its write side is migrated to canonical Planning commands.

## Events

Connect to Socket.IO namespace `/plans` with the access token and period. Treat events as cache invalidations. Payloads contain IDs/version/change type only; consumers refetch through authorized query routes and process each event idempotently.
