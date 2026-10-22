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

### Web/API standard deployment

Git 更新不等于运行容器更新（`git pull` != deployment）。提交并确认除 `outputs/**` 外工作区无修改后，使用统一入口构建、更新和核对镜像内嵌的 Git SHA：

```bash
./scripts/deploy.sh web    # 仅构建和更新 Web
./scripts/deploy.sh api    # 仅构建和更新 API，不重建 PostgreSQL
./scripts/deploy.sh all    # 先更新 API，再更新 Web
./scripts/deploy.sh check  # 只读核对 Repository HEAD、Web SHA、API SHA
```

部署脚本在 Docker build 时注入当前完整 Git SHA，禁止容器运行时读取 `.git`。`all` 成功的判据是 Repository HEAD、`/build-info.json` 的 Web SHA 与 `/api/v1/health` 的 API SHA 完全一致；任一版本不可读取或不一致时返回非零。页面登录卡片和 Portal 页脚显示短 SHA，完整 SHA 可通过元素 title 查看。

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

## 系统管理员手工重置员工密码

进入「系统管理 → 用户管理」，找到成员，在该行操作菜单选择「重置密码」；也可进入「编辑」后点击底部「重置密码」。核对弹窗中的姓名和账号，再点击「确认重置」。默认密码为 `kn123456`，用户下次登录必须修改密码；角色、权限、部门和启停状态不变。取消不会提交。内置 `admin` 账号不支持重置为员工默认密码。

此操作只对真实系统管理员开放，模块管理员或普通用户不能调用。既有 `POST /api/v1/admin/users/:id/reset-password` 接口支持可选 `expectedVersion`（新页面始终提交），由 Application Service 校验有效管理员和租户、锁定目标用户并在同一事务写入密码及无敏感内容的审计。版本冲突需刷新后重试；提交成功但列表刷新失败时，弹窗只重试刷新，不重复重置。管理员必须已有有效登录，此功能不绕过登录或管理员账号恢复流程。

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

## PMC研发进度 Phase 4

先备份并在隔离库验证 `PmcRdProgress1722920082000`，确认E10源SQL、candidate count和源库sourceSnapshotAt，再应用迁移/构建部署。正式FULL/INCREMENTAL使用内部API或同一Application Command的 `data-operations/e10/run-pmc-rd-progress-sync.cjs` 管理员CLI；生产不调用Python Oracle。用私有捕获事实跑离线逐行Oracle对比，核验最新批次、status/KPI/分页、401权限和两租户RLS。遗留RUNNING由下次持session锁的同步恢复为FAILED；审计缺失、SQL/连接或事务错误均整批失败且水位不变。没有自动定时器，BOM/路线无审计硬删除通过人工FULL校正。详情见 [PMC研发进度运行说明](pmc-rd-progress.md)。

## Knowledge 2.0

保留已执行 `KnowledgeBasePhaseOne1722920084000`，新增 `Knowledge2SpacePageModel1722920085000` 撤销未验收旧模型、建立Space/Page Tree，仅初始化默认tenant稳定HR空间，不初始化业务页面或默认权限组。按标准备份→migrate→deploy all→healthcheck执行，uploads备份必须包含.private目录。新镜像运行Sharp生成PNG检查通过后才能上线。普通用户没有权限时由管理员使用现有表权限管理页授权，禁止用临时JWT或生产密码重置替代验收。详见 [知识库](knowledge-base.md)。

### Knowledge 2.1 文件预览

Knowledge 页面支持在线文章和文件两种内容模式，原件、工作关系、不可变发布关系与派生 PDF 分开保存。文件端点统一为 `/api/v1/knowledge/files/:id/{original,preview,preview-status,retry-preview}`；历史下载/预览携带 `versionId`，工作文件携带 `mode=working`。每次请求包括 Range 都重新校验原有权限，不接受 URL token。原有富文本导入保留其20MB边界；独立文件上传使用磁盘临时文件，`KNOWLEDGE_MAX_FILE_MB` 默认100，上限100，Nginx104MB用于multipart余量。调低时同时检查代理限制。

`document-worker` 是独立非root容器，单并发、1CPU、1536MB、只读根目录、512MB临时目录和禁止外部出站的 internal 网络。PostgreSQL 保留原网络并加入该内部网络，API数据库地址继续为 `postgres:5432`。`scripts/deploy.sh all/api` 创建Worker网络并连接现有PostgreSQL，避免为了新增网络重建数据库容器；脚本等待Worker健康，`scripts/healthcheck.sh` 同时检查Worker。主API不安装LibreOffice。Worker镜像构建阶段使用宿主机网络和运行时继承的HTTPS_PROXY下载签名包；该预定义构建参数不写入运行镜像，运行容器仍只连接internal网络。Worker只接收数据库配置和共享私有存储，不接收JWT、SMTP、ERP等密钥。

任务存放 `knowledge_file_previews`，唯一键为租户/原件ID/SHA256/转换器版本；SKIP LOCKED领取，超时租约恢复最多3次后明确失败。管理员在页面点击“重试转换”重新排队，累计人工重试次数另行保留。转换超时配置 `KNOWLEDGE_CONVERSION_TIMEOUT_SECONDS` 为10–600秒，默认120；健康门限随其调整。Office宏禁止、外部出站禁止、原件哈希校验、转换进程组超时清理。失败不会删除原件或修改已发布版本；Excel预览按打印区域分页，不保证完整工作簿，下载原件读取全部内容。

迁移前运行备份脚本并保留legacy数据库、KDOS数据库和uploads三份SHA256。2.1迁移原样保留文件ID/key/SHA与历史版本关系，不支持丢弃文件知识的down；回退须使用验证过的完整备份并匹配旧版应用。严禁删除数据卷。停止Worker仅影响预览生成；API和已生成预览继续可用，恢复Worker后自动领取持久任务。只清理明确标识的验收页面子树，严禁清理真实业务文件。

专项检查：`pnpm --filter @tracker/api exec jest --runInBand --testPathPatterns='knowledge|local-object-storage'`，`pnpm --filter @tracker/web exec vitest run src/modules/knowledge --maxWorkers=2`，`node scripts/validate-knowledge.mjs`。最后一项仅创建/删除带 `knowledge_test_` 前缀的隔离数据库，验证已填充2.0升级、ACL/RLS和全量migration重放，不写生产知识内容。浏览器账号通过运行时输入；禁用trace、video、截图和storageState，不将凭据写入报告。

### Deploying clean linked source to the existing runtime

When the original checkout has unrelated work, use a clean linked Git worktree. From that source worktree run `KDOS_RUNTIME_ROOT=/absolute/path/to/original/checkout ./scripts/deploy.sh all` (or `check`). The script verifies both directories share the same Git repository, checks the source is clean, and supplies only an ephemeral build-context override. The runtime .env, project identity, PostgreSQL bind mount and private uploads stay at the original checkout. No secrets are copied. Verify the resolved persistent mounts before first use; back up and migrate with the existing runtime environment. The version reported is the clean source commit. Roll back by deploying a retained source commit/image against the same runtime path. Order allocation notification operations are described in `docs/operations/PMC_ORDER_ALLOCATION_NOTIFICATIONS.md`.

## 主计划综合大屏 REV1

页面 `/master-plan-dashboard`；PMC中心 → 大屏报表 → 主计划大屏 → 主计划综合大屏。独立资源 `mps-overview-dashboard`，管理员沿用资源权限页授权；不自动继承月计划权限、不创建默认权限组、无需 migration。标准聚合大屏不使用 TableFilter rows，也不提供打印。

`GET /api/v1/master-plan-system/dashboard`、`/candidates`、`/table`和`/drill`是只读查询，执行自己的tenant/read/字段/data scope；CUSTOM支持divisionId EQ/IN稳定组织UUID，非法混合规则整体拒绝。先生成统一订单/品号/承接事业部业务scope，全部区域/候选/明细/导出共用；无品项计划的订单保留主责事业部。订单数量仍是选中订单的正式整单值，计划数量是选中品号范围，二者不相互冒充。工序需求为月计划总需求，报工累加，允许>100%，状态独立。

默认不限日期，是本页面的业务例外。日期类型ORDER/DELIVERY、周期DAY/MONTH/YEAR/CUSTOM，参数dateValue或dateFrom/dateTo；上海日历，末日包含，SQL上界排除。订单日期统一优先group.order_date，再同单monthly/base/weekly；交付日期按正式latestCustomerDueDate（未完成周计划最早交期→周计划最大交期→月计划存储交期→仅有基础计划交期），无计划交付事实不以customerDueDate/expectedShippingDate冒充。趋势横轴固定上海昨天前7完整production_date。

订单号/品号通过orderNumbers/itemCodes的JSON数组传正式值，多选最多100；候选field只允许divisionId/customerCode/orderNumber/itemCode，绑定顶部其它条件、最多50+hasMore；品号可搜索品名但只提交itemCode。不会读取全量物料选项。大屏30分钟及手工刷新均不触发同步。

`GET /export?tableKey=...`是单表全量服务端xlsx，allowlist：division-summary、plan-readiness、process-execution、risk-exception及现有process-summary；未知400，独立read/export权限，read∩export，字段裁剪与Application审计。英文文件名、中文显示值，禁止UUID/内部ID。风险类型可同时保留延期与生产异常，局部riskType只约束风险表/导出。明细标准服务端分页默认100并安全排序；导出继承条件/排序但忽略当前页。

下钻由`/drill?resourceCode=...`构造服务端可信scope，再调用原Query Service的metadata/list权限/字段/scope逻辑；请求不能传入SQL，也不能用PENDING任务视图绕过scope。Drawer为临时权限检查结果，不提供单独下载；正式Dashboard表格均有独立导出。趋势专用10色按registry.order映射，既有主计划表格配色不变。

升级使用现有备份和 `scripts/deploy.sh all/check`；本功能不调整任何同步flags/cron/n8n/Timer/Dispatcher。回滚部署保留的旧应用镜像/源码，不恢复覆盖业务数据库。指标合同与人工验收见 `outputs/KDOS_MPS_OVERVIEW_DASHBOARD_METRICS.md` 和 `outputs/KDOS_MPS_OVERVIEW_DASHBOARD_ACCEPTANCE.md`。

### REV2 待处理事项

首屏提供9类有可靠定义的待处理KPI及分页Tabs；三个末尾标准报表使用独立请求、分页、排序、搜索/条件与服务端全量导出。新增`/dashboard/gaps?type`、`/dashboard/reports/:reportKey`，继续使用mps-overview-dashboard资源与原read/export/data scope，不给业务表新增权限。3天窗口应生成缺口为BLOCKED，不伪造指标。

回归命令：`pnpm --filter @tracker/api exec jest --runInBand --testPathPatterns=master-plan.dashboard`；数据库TEMP隔离用例加`KDOS_POSTGRES_INTEGRATION=true DATABASE_HOST=127.0.0.1 DATABASE_PORT=<端口>`；Web两份MasterPlanDashboard*.spec.tsx与Chrome e2e/master-plan-dashboard.spec.ts。生产核验仅执行生成的SELECT和EXPLAIN，不调用任何sync或构造生产测试订单/计划/报工。只读快照/备份/部署证据保存于忽略目录data/mps-dashboard-rev2，不提交业务数据或凭据；最终等待人工验收，不自动PASS。

### 在制订单进度Demo

入口 `/master-plan-order-progress`，资源 `mps-order-progress-dashboard`。普通用户通过现有权限组管理显式授权，不能借用综合大屏权限；管理员按平台既有规则可用。本次不运行seed、不更改业务数据/6项flags/调度，不新增migration或索引。首次日期为上海昨天，可切换不限日期；“订单完成率”“入库完成率”“工序生产进度”为不同正式口径。

上线前执行相关测试、真实只读对账与标准备份，提交推送后 `./scripts/deploy.sh all` / `check`，要求Repository/Web/API一致及4容器healthy。真实样本、Excel和EXPLAIN只留私有忽略目录。列宽使用公共localStorage按tenant/user/resource/viewKey隔离。无多周计划真实样本时保留人工验收缺口，不造生产数据；只交付REV3-B，不启动A/C/D。指标与验收见outputs/KDOS_MPS_ORDER_PROGRESS_*。

## 待处理事项大屏 REV3-A

入口 `/master-plan-gaps`，PMC中心 → 大屏报表 → 主计划大屏 → 待处理事项大屏。沿用现有overview授权，无需migration、seed或权限数据变更；不改任何业务数据/6项flags/调度。顶部筛选继承REV2首次及清空不限日期的口径。KPI点击切换9类正式清单；清单按需加载，已访问Tab保留独立分页/搜索/排序，顶部条件变化重置清单。各自导出全部匹配记录，复用原服务端read∩export审计链路。原 `/master-plan-dashboard` 和 `/master-plan-order-progress` 保留。

回归增加 `MasterPlanGaps.spec.tsx`、`master-plan-gaps.spec.ts`、contracts `master-plan-dashboard.spec.ts`；PG现有dashboard-gaps专项同时验证轻量count、overview、detail total一致、CUSTOM/tenant、两页实际结果与9类Excel。发布必须备份、all/check及当前环境健康检查；REV3-A最终状态仅WAITING_MANUAL_ACCEPTANCE，不能自动推进C/D。

## PMC综合驾驶舱 REV3-C

入口 `/master-plan-dashboard`，PMC中心 → 大屏报表 → 主计划大屏 → PMC综合驾驶舱。首页保留紧凑9KPI、订单完成分布、计划数量Bar、事业部数量/比例/风险切换、10工序生产进度/正式状态、四项辅助准备、最近7个完整上海日实际报工、四项风险摘要及事业部汇总；不再挂载9类清单或三张业务明细。折叠10行工序汇总保留原字段/导出。

三张明细保留 `/master-plan-reports`（PMC中心 → 报表 → PMC分析明细报表），独立服务端查询/分页/局部条件/排序/完整Excel。跨屏入口按目标read显示，白名单恢复顶部scope；风险摘要定位正式Gap并明确月计划/基础计划条数。A/B直接进入和重置默认行为不变；B表格相同初始化query不再清空已展开项，实际分页/排序/筛选仍折叠。

只读summary采用同一DashboardService，省略风险明细投影。生产核验需区分合成Chrome、原部署查询对照与独立正式表达式/原始报工SUM；只读验证脚本的复杂表达式探针可在独立事务临时放宽timeout，不改变生产Service的15s保护。私有证据data/pmc-cockpit-rev3c，不提交实际订单/业务行/凭据。相关API/PG、Web、Contracts、三页面Chrome全回归后备份、commit/push、deploy all/check、健康/SHA一致和线上效果核验；无migration/生产权限初始化，A/B PASS，C最终WAITING_MANUAL_ACCEPTANCE，D不启动。

## 财务订单月度发生额发布

迁移101新增finance_e10_order_monthly_movements，月度/大屏/排名/Excel/日报改用该视图；finance_e10_monthly保留内部余额。发布前备份两库/uploads，同一REPEATABLE READ事务逐完整来源键及月份核对现有发生额分量，并与全期间余额对账、核对原始/事件/权限指纹。任何不明差异回滚事务并停止上线；不全量同步、不改历史migration。回退应用保留新只读视图和全部金融历史。调度保持原FIN-003/004入口，规则继续停用等待用户选择收件人。合同及权限/过滤/排序见docs/finance-order-monthly-movements.md。

迁移105加入增量来源存在性暂存和KDOS时间字段。发布后只通过现有`run-finance-daily.sh`每日增量入口执行；不得新增第二个删除扫描任务。增量必须先通过存在性年度计数、UUID唯一性和安全降幅门禁，才允许标记`source_missing`；失败保留原有效状态并在批次中报错。技术删除只改变有效资格和原发生月的当前派生结果，不写入删除当月变更流水。回滚应用时保留105结构、源行和审计，不能恢复旧数据库覆盖发布后的业务写入。
