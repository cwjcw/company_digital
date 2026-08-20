# KDOS runbook

## Prerequisites and startup

Use Node.js 24, pnpm 11, Docker Engine and Compose. Copy `.env.example` to `.env`, generate independent JWT secrets and database password, then keep the file mode restricted.

```bash
pnpm install
./scripts/init-kdos-db.sh
pnpm db:kdos:migrate
docker compose build
docker compose up -d
docker compose ps
```

When migrations run from a host whose `.env` uses `DATABASE_HOST=postgres`, run the migration script in the Compose network or set `KDOS_DATABASE_HOST` to a reachable host. The migration ledger rejects changed checksums.

## Databases

- `four_department_tracker`: retained legacy TypeORM database; back up and do not delete.
- `kdos`: Drizzle-modeled IAM, Planning, Audit and Integration schemas.

Both currently share the PostgreSQL service and credentials unless overridden with `KDOS_DATABASE_*` variables. `KDOS_DEFAULT_TENANT_CODE` defaults to `KAINAN`.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:tplus-sync
docker compose ps
curl -fsS http://127.0.0.1:15172/api/v1/health
```

Check applied migrations and RLS with a privileged maintenance connection:

```sql
select * from core.schema_migrations order by applied_at;
select schemaname, tablename, policyname from pg_policies
where schemaname in ('iam','planning','audit','integration');
```

## Backup and recovery

Run `./scripts/backup.sh` before upgrades and preserve SHA256 output. Back up the legacy and `kdos` databases plus `data/uploads`. Restore into an empty, validated target; never use broad destructive cleanup or `docker compose down -v`.

## Common failures

- `409 Conflict`: stale item version or immutable Published/Locked version; refetch and create a draft if needed.
- no Planning fields: verify JWT contains `planning.plan.read` (legacy aliases are transitional).
- migration connection failure: check `KDOS_DATABASE_HOST`, Compose network and `kdos` database existence.
- image upload failure: verify MIME/size, upload volume permissions and `MAX_IMAGE_BYTES`.
- WebSocket updates absent: verify `/socket.io` upgrade proxy, token and period subscription; REST refetch remains authoritative.
