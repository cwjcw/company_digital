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

N8N 每日 SSH 同步科加智能订单统一调用 `data-operations/order-sync/sync-kejia-orders.sh`。该入口固定使用科加账套、复用 2026-01-01 初始化/增量游标和只读 SQL 守卫，并在采集成功后排空销售订单正式投影；不得在 N8N Command 中展开数据库密码、API Key 或 SQL。

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
- 登录后所有业务接口同时返回 Nginx `400` 且响应体约 233 字节：检查是否仍在使用旧版包含完整权限矩阵的超大 access token。当前版本只签发包含用户 UUID 的短令牌，并由 `AuthGuard` 每次实时解析权限；Nginx 的 32 KiB 兼容缓冲仅用于让已打开的旧会话完成刷新，不得再次把角色、字段权限或数据范围写回 JWT。

## Password reset mail

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` and `SMTP_PASSWORD` in the ignored server file `.env.smtp`, keep it at mode `600`, and include it only in the API service `env_file` list. After deployment, verify the SMTP TLS login from inside the API container without printing credentials. Never place the password in source, documentation, audit JSON or frontend configuration.

Authenticated password changes require the user to enter a valid recovery email; the latest submitted address is saved for future password-reset applications. Reset requires the exact username/email pair and never changes the saved email. Wrong emails are counted per account, each response reports the remaining attempts, and the reset function is persistently locked on the tenth failure. A successful verification clears the counter. An authenticated password change or an administrator email/password update clears the lock. The server sends an exact eight-character letter-and-digit temporary password to the verified email, revokes existing refresh tokens, and forces a password change after login.

## Equipment ledger initialization

After migration `EquipmentManagement1722920041000`, initialize the retained workbook once through the application service; never copy names directly with SQL. The command is idempotent on tenant + division UUID + equipment code and reads the workbook from stdin so the business file is not copied into the repository or image:

```bash
docker compose exec -T api node dist/modules/equipment/import-equipment.js < "/home/Jerry/下载/设备使用管理表.xlsx"
```

The importer maps workbook “研发” to the stable “研发中心” organization, resolves known legacy department aliases, reads “是否填报”, and resolves responsibility names to stable enabled-user IDs. A row whose “是否填报” value is exactly “不需要” is a valid skipped row: it is neither written nor included in the exception report. Blank source responsibility is imported as unassigned; ambiguous or missing users and invalid rows are reported rather than guessed. The workbook only needs the `设备总台账` sheet. Use `--division <事业部>` to limit a supplier workbook to its owning division and `--error-report <path.xlsx>` to retain a row-level exception report; valid rows continue when other rows fail. Verify totals by division and the rolling-seven-day dashboard after import. Re-running updates changed source fields without duplicating equipment.

新增企业微信推送任务统一放在 `automation/wechat_push_projects/<任务名>/`，每个任务独立保存配置、业务状态文本、测试和运行说明，不得在项目中保存企业微信密钥或通讯录导出。设备治理日报位于 `equipment-governance-daily`；默认命令只生成图片，`--send-test` 仅发送给崔玮杰，正式群发必须同时使用 `--send-production --confirm-production`。在业务方明确每日发送时间前不得安装周期定时器。


## 2026-09-07 订单排期与月度计划交付核验

上线前备份时间标记为 20260907_100016（data/backups 中的 legacy、KDOS、uploads，已生成 SHA256）；两套迁移均无待运行项目。订单排期经 Application Command 清空原有8139条并记录原值审计，线上列表核验为0。9月月度计划 pageSize=0 实际返回4371条，与总数一致。线上验证模板下载、Excel新增、重复确认幂等、前导零保留和错误日期逐行提示；验证数据已移除。浏览器核验保存列显示偏好后错误行号和原因仍可见、错误预览不可确认；最终健康检查通过。

## 2026-09-07 订单排期独立维护与批量删除交付核验

上线前备份时间标记为 20260907_220327，legacy、KDOS 与 uploads 三份备份均已生成并校验 SHA256；TypeORM 与 KDOS SQL 均无待运行迁移。订单排期页面已在表格上方增加“删除所选”操作，后端按租户、删除权限、逐行数据范围和乐观版本校验后在同一事务内删除，并记录逐行审计和批次审计。主计划、业务人员与客户对应表、客户数据导入和周计划四条订单排期同步链路均已移除；线上三个旧同步路由均返回 404，新批量删除路由在未认证时返回 401，前后端与数据库服务健康。

## 2026-09-08 公司管理层读取范围与事业部订单评审交付核验

上线前备份时间标记为 20260908_093505；legacy、KDOS、uploads 的 SHA256 分别为 `7125450d049b874af0f2e9aed96d94b758f124b6e3bf36de68a7e8b7252114bd`、`50ba0967c0e10d695828dfa5f9fded36f07fbf278b5287577363fd37e72c749c`、`b75e2aadfe86923fd5913ea450ced182805a2a0c6539df3ef64d6c5ff5d967d2`。迁移 0014 先在备份恢复的临时库完成结构、回填与投影写入验证，再应用正式库。订单排期新增正常/作废状态；事业部订单评审作为只读事务投影上线，临时库验证新增→修改为作废→删除后保留作废评审记录，来源引用清空且产生3条目标审计。线上健康检查通过，评审接口返回正常状态回填记录。公司管理层所有当前有效成员的销售接单明细均返回8841条；09757 的实时声明为 `rolling-plan` 查看全部，线上响应200且返回8841条。

## 2026-09-08 事业部评审交期确认交付核验

上线前备份时间标记为 20260908_141742；legacy、KDOS、uploads 的 SHA256 分别为 `38e30debc156432ca42fc8155aab2f22132575b30657d6d34abb67940ccf70cc`、`2234a2daf1b7e332c3eb2eb4e1b173450c59615620509a997719d309c2e3c6a3`、`b75e2aadfe86923fd5913ea450ced182805a2a0c6539df3ef64d6c5ff5d967d2`。TypeORM 迁移 `DivisionOrderReviewConfirmationFields1722920045000` 与 KDOS SQL 迁移 `0015_division_order_review_confirmation.sql` 均先在备份恢复的临时库通过，再应用正式库。临时库真实链路验证首次确认新增1条、再次确认命中并更新1条；客户、事业部、品名及额外人工字段保持不变，仅订单需求数量、客户要求交期和评审交期更新为预期值。全量类型检查通过；API 135项、Web 56项测试通过，新增前后端定向测试通过；生产构建、OpenAPI 路由、线上字段读取、未认证401、空批次400及最终健康检查均通过。未使用正式业务记录执行确认。

## 2026-09-08 公司管理层网页登录权限故障修复

现场访问日志显示同一浏览器的 `/auth/me`、参考数据和公司驾驶舱请求均由 Nginx 在进入 API 前返回 `400`/233字节。复算发现08134、09757的旧版登录 JWT 分别达到8312和13220字节；两者直连 API 为200、经过默认请求头限制的网页入口为400。Access JWT 已改为只携带用户 UUID、令牌类型和 `jti`，动态角色、管理员权限、表权限、字段权限与数据范围继续由 `AuthGuard` 每次读取当前数据库解析；Nginx 暂保留32 KiB兼容缓冲，使已经登录的旧令牌可立即访问并在刷新后轮换成短令牌。浏览器内并发401请求共享同一次刷新，避免一个页面重复轮换刷新令牌。前端相关查询键加入用户ID，且驾驶舱和销售接单明细不再静默吞掉读取异常。上线前备份标记为20260908_100153；Chrome线上复验两个账号均显示驾驶舱191单，销售接单明细接口总数8843，页面已渲染数据且无读取错误。数量为验证时实时值。

## 2026-09-10 T+ 供应商清单交付核验

上线前备份标记为 20260910_165357；legacy、KDOS、uploads 的 SHA256 分别为 `a10d89ac18e0d89a27aa7dd42f0bd7dbd161cfcbcfcc8214e8cc52883a899d8d`、`7c98818e889236311c62555a83eef95cacc55a6c87321d7129fcadc1d8563a51`、`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`。TypeORM 迁移 `SupplyChainSuppliers1722920046000` 已应用；T+ 只读提取共876条，Application Command 首次新增876条，再次重放命中幂等且未新增审计。正式库为凯南智能552条（启用549、停用3）、科加智能324条（全部启用），来源主键重复0、空编码/名称0、创建人缺失0；逐行新增审计876条、批次审计1条。线上默认分页返回50/876，停用筛选返回3条，未认证接口返回401，Web产物包含“供应链/供应商清单”，Web、API、Swagger、OpenAPI、PostgreSQL健康检查通过。
