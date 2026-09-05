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

ERP订单 staging 同步由三个 user systemd timer 每30分钟独立运行。检查 `systemctl --user list-timers 'kdos-erp-order-sync@*'`、`loginctl show-user "$USER" -p Linger` 和对应 journal；日常运行不生成 CSV/JSON，人工验收时才使用 `sync.py run --source <key> --save-report`。投影消费者默认禁用，只有正式业务表字段映射、旧关系迁移和幂等验证通过后才可启用。

若 E10 批次持续满 1000 条且 `cursor_before = cursor_after`，必须立即停止 E10 timer/service；这表示 `datetime2(7)` 与 Python 微秒游标未统一或其他分页键失效。修复后先用真实源库连续验证至少两页游标推进，再将旧运行通过 fail Application Command 结束，手工执行一次增量恢复；确认所有流 `stalled_pages = 0` 且运行完成后才重新启用 timer。不得删除失败运行和批次审计记录。

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
- 表格重复进入仍长时间加载：先确认查询键包含页码和筛选条件、全局五分钟缓存未被页面覆盖，再检查是否有写入或 WebSocket 正常触发失效。普通页面往返应直接读取缓存；强制刷新、缓存到期、权限变化和数据写入后重新查询属于正常行为。
- administrator access missing after upgrade: verify migration `AdministratorGrants1722920035000` backfilled the enabled users linked to the legacy `系统管理员` role, then confirm `administrator_grants.tenant_id` matches `KDOS_DEFAULT_TENANT_CODE`. Do not restore access by adding an ordinary role or table permission group.

## Password reset mail

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` and `SMTP_PASSWORD` in the ignored server file `.env.smtp`, keep it at mode `600`, and include it only in the API service `env_file` list. After deployment, verify the SMTP TLS login from inside the API container without printing credentials. Never place the password in source, documentation, audit JSON or frontend configuration.

Authenticated password changes require the user to enter a valid recovery email; the latest submitted address is saved for future password-reset applications. Reset requires the exact username/email pair and never changes the saved email. Wrong emails are counted per account, each response reports the remaining attempts, and the reset function is persistently locked on the tenth failure. A successful verification clears the counter. An authenticated password change or an administrator email/password update clears the lock. The server sends an exact eight-character letter-and-digit temporary password to the verified email, revokes existing refresh tokens, and forces a password change after login.

## Equipment ledger initialization

After migration `EquipmentManagement1722920041000`, initialize the retained workbook once through the application service; never copy names directly with SQL. The command is idempotent on tenant + division UUID + equipment code and reads the workbook from stdin so the business file is not copied into the repository or image:

```bash
docker compose exec -T api node dist/modules/equipment/import-equipment.js < "/home/Jerry/下载/设备使用管理表.xlsx"
```

The importer maps workbook “研发” to the stable “研发中心” organization, resolves known legacy department aliases, defaults every imported device to “无需填报”, and intentionally leaves blank source responsibility unassigned. The workbook only needs the `设备总台账` sheet; legacy `设备监控` selections are no longer imported. Verify totals by division and the rolling-seven-day dashboard after import. Re-running updates changed source fields without duplicating equipment or clearing responsibility maintained in KDOS.

新增企业微信推送任务统一放在 `automation/wechat_push_projects/<任务名>/`，每个任务独立保存配置、业务状态文本、测试和运行说明，不得在项目中保存企业微信密钥或通讯录导出。设备治理日报位于 `equipment-governance-daily`；默认命令只生成图片，`--send-test` 仅发送给崔玮杰，正式群发必须同时使用 `--send-production --confirm-production`。在业务方明确每日发送时间前不得安装周期定时器。
