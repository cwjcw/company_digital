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

## Delivery completion

会影响运行效果的代码、前端、API、数据库结构或配置改动，只有完成以下闭环才算交付：相关测试与生产构建通过；升级前备份；执行 TypeORM 与 KDOS SQL 待运行迁移；重建并启动 Compose 服务；通过健康检查；最后从线上入口核对本次页面、字段或接口效果。不得仅以本地代码、单元测试或镜像构建完成作为交付完成。

除非用户明确要求暂不部署，否则完成改动后默认直接上线。若企业微信、ERP、凭据、网络或权限等外部条件阻止完整上线，必须保留已完成部分的准确状态，并明确报告阻塞项、影响范围和恢复条件。

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

## Password reset mail

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` and `SMTP_PASSWORD` in the ignored server file `.env.smtp`, keep it at mode `600`, and include it only in the API service `env_file` list. After deployment, verify the SMTP TLS login from inside the API container without printing credentials. Never place the password in source, documentation, audit JSON or frontend configuration.
