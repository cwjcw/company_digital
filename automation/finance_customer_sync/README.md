# Finance customer master synchronization

财务中心 → 基础数据 → 客户对应表。独立 `finance_customer_mappings`；不修改 PMC 客户事业部映射。

E10 source verified from `automation/customer_import/readers/e10.py` and live read-only metadata:
`E10_6.0.0.1.NEW.CHS.dbo.CUSTOMER`, field `CUSTOMER_CODE`. The existing order JOIN is **not** reused.
`basic_code.MSSQLDatabase` owns the connection and secrets. The verified source dates are `CreateDate` and `LastModifiedDate` (datetime2), not SETUP_DATE. `packages/contracts/src/finance-sync-policy.json` is the single cutoff source for extraction and backend validation. Current interpretation of “2026-10-12以后”: minimumSourceDate=2026-10-13 (strictly after Oct 12). Initial 138 seed customers are always retained even when their dates are older; the other historical master customers are not backfilled. Future newly qualifying codes have both classifications NULL, including older customers modified after the cutoff. Canonical E10 rows include business-local ISO `createdAtSource` / `modifiedAtSource`; backend rejects older, missing or UTC-reinterpreted dates. No schema changes are needed for this policy. READ COMMITTED; no source writes, filters by orders or disabled-customer deletions. Only customers whose CreateDate OR LastModifiedDate is on/after the controlled minimum business date are read daily; there is no mirror delay; rows preserve exact codes after trimming edges.

Use existing customer_import Python environment; no new Python or npm dependencies.
Runtime-only `data/finance-customer-sync.env` (0600, ignored) supplies `KDOS_FINANCE_API_KEY`, optionally `KDOS_FINANCE_API_URL` (defaults to loopback API). Use a dedicated, user-linked API key with `finance-customer-mappings:*:import`, `finance-customer-mappings:*:create` and classification update fields for the initial seed. It does not grant account/module administrator privileges. Server derives tenant from this deployment; source is the existing KAINAN E10 account, not a caller-controlled tenant.

```bash
automation/customer_import/.venv/bin/python automation/finance_customer_sync/main.py --seed --dry-run
automation/customer_import/.venv/bin/python automation/finance_customer_sync/main.py --seed
automation/customer_import/.venv/bin/python automation/finance_customer_sync/main.py --dry-run
automation/customer_import/.venv/bin/python automation/finance_customer_sync/main.py
```

Seed CSV is UTF-8 BOM, 138 unique rows. It is the explicitly supplied business seed, not credentials or an ERP snapshot. Seed reruns skip existing rows, including null classifications; they never overwrite human edits.

Install the checked-in user systemd unit/timer into `~/.config/systemd/user/`; run daemon-reload and enable --now the timer. Schedule: 01:00 Asia/Shanghai, persistent catch-up after downtime; `flock` prevents overlapping host runs. Do not also schedule n8n/cron. One host unit targets only the configured deployment/tenant. A different tenant needs a separately verified ERP source/deployment; never fan out this E10 account to arbitrary tenants.

Database transaction advisory lock + `(tenant_id,customer_code)` unique key + insert-on-conflict guarantee safe simultaneous imports and retries. Automatic API imports use the existing disabled KDOS system actor for business audit, without changing its login state; seed imports keep the authenticated operator. Successful runs persist counts and audit; failures emit sanitized JSON and a failure run when API is reachable. If API is down, systemd retains the FAILED invocation; next daily run still executes. Daily repeat hash returns original run counts with `repeated=true`; fresh invocation next day records zero additions when unchanged. Source duplicate rows are counted as skipped. Empty source is successful with zero inserts/deletes; invalid codes or conflicting seed classifications fail before write.

Rollback: stop/disable only this timer, deploy retained pre-change API/Web/Worker images; retain finance tables/data. Migration down refuses data loss. Full backup is required before applying migration. Never revert/drop PMC mappings.

## Manual finance customers

The customer-mapping toolbar exposes “新增客户” only with this resource's `create` permission. `POST /api/v1/finance/customer-mappings/manual` accepts only `customerCode`, `departmentCategory`, and `salesChannel`; code is required, edge-trimmed, and at most128 characters, while the two classifications may be blank and reuse the current finance dictionaries. Customer code stays immutable on the existing PATCH route. Creation checks field policy and the proposed row's create scope, validates the enabled operator in the deployment tenant, stores `MANUAL` plus operator/time/version, and writes a transactional audit. A duplicate tenant/code returns409 with `FINANCE_CUSTOMER_EXISTS`; no existing record is overwritten or returned.

Migration1722920103000 only broadens the mapping source CHECK to `INITIAL_IMPORT / E10_SYNC / MANUAL`; `finance_customer_sync_runs` retains its two-source constraint. Manual creation is not an import/sync batch. Existing E10 ingestion still uses `ON CONFLICT(tenant_id,customer_code) DO NOTHING`, preserving every human classification, source and version even when the code later arrives from E10. The01:00 Timer, source cutoff, locks, run hashes and failure handling are unchanged. No new scheduler, E10 read, notification or PMC mapping is introduced.

Create-form fields follow the existing platform policy: visible input fields can be filled when creating; hidden fields cannot be submitted. Capture-only `ADD_ONLY` users may fill the form under their `NONE` capture scope without querying customer rows/counts. Existing records still require update plus field-update permission. Unknown or unverifiable CUSTOM rules invalidate the whole alternative instead of being dropped. Excel continues to use the canonical server export, read∩export scope and visible business fields.

Synthetic PostgreSQL/HTTP/Chrome regression: `FINANCE_MANUAL_TEST_POSTGRES_HOST=/tmp/kdos-finance-customer-pg-<task> node scripts/test-finance-customer-manual-postgres.cjs`. It requires a disposable PostgreSQL18 Unix socket and drops only its own generated test database. Optionally set `FINANCE_MANUAL_BROWSER_BASE` to a loopback Vite/release UI for actual Chrome; all API traffic is routed to that isolated HTTP server. Never point the test database at production or create synthetic production customers. Production acceptance uses rejected/duplicate submissions and real exports only. Rollback the application if needed, retaining all manual rows and the expanded source constraint; do not narrow the constraint or stop normal customer synchronization for this UI change.
