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
