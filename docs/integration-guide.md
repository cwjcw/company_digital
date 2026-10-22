# KDOS Planning integration guide

All Planning routes use `/api/v1/planning`, bearer JWT/API identity and tenant code `KAINAN` by default. External writers must use an idempotency key and must not access the Planning database.

## 督办任务创建的所属项目范围

`GET /api/v1/supervision/options` 的 `projects` 专用于创建任务：调用者须有 `supervision-tasks:*:create`，只返回 `id / projectCode / projectName / lifecycleStatus`。普通用户仅能选择当前租户内未 `COMPLETED`、未 `ABORTED`，且本人为负责人、督办人或参与人的项目。系统管理员、`project-task` 模块管理员（含既有通配权限管理员）可选择当前租户全部未结束项目。项目列表、明细、附件的 read 权限和数据范围不因此扩大。

`POST /api/v1/supervision/tasks` 在事务中使用同一个 `taskCreationProjectScopeClause` 规则筛选并 `FOR UPDATE` 锁定项目，再校验任务自身创建数据范围、保存和审计。即使手工提交项目 ID，或候选加载后项目已结束/移除了本人关联，也不能绕过授权。该规则不依赖 `supervision-projects` 的 read 权限或 Data Scope 配置；平台 `OWN` 仍为 `created_by`。无任务创建权限返回 403；跨租户、无关联或已结束项目统一返回 404，避免泄露项目存在性。

关系/状态/租户/管理员的回归覆盖 API unit、Web 参与人下拉场景和 PostgreSQL + HTTP 集成测试。运行后者：`KDOS_POSTGRES_INTEGRATION=true DATABASE_HOST=127.0.0.1 DATABASE_PORT=<本机PostgreSQL端口> pnpm --filter @tracker/api exec jest --runInBand --testPathPatterns=supervision.task-creation.postgres`。该测试仅使用当前连接的临时表，并在结束后回滚，不修改正式业务行或账号权限；本次无需数据库结构 migration。

## 企业微信组织架构

- 企业微信通讯录导出是组织架构、成员归属和部门负责人的权威来源；同步任务使用 `basic_code.export_contacts`，不得在本项目复制企业微信凭据。
- 导出中的 `department_id` 映射到稳定外部部门 ID；`is_leader_in_dept` 必须按同一行的成员—部门关系解析，不能误用 `direct_leader` 替代部门负责人。
- 一次全量同步同时更新部门拓扑、成员状态和负责人集合。部门负责人权限按最新关系实时计算，并自动覆盖其负责部门的完整子树。
- 组织名称和路径只用于显示。同步、业务部门字段和权限计算均使用稳定 ID，以兼容父子部门同名及不同分支重名。
- 企业微信根部门“厦门凯南展示制品有限公司”或“凯南展示制品有限公司”进入 KDOS 时统一显示为“凯南”；该规则同时应用于部门拓扑、通讯录成员路径和系统用户路径，不改变企业微信部门 ID。
- 营销中心两张表的“课室”是普通业务文本，不属于企业微信组织架构，不参与部门负责人或子部门权限计算；“部门”仍使用稳定组织 ID。

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
| `GET /on-hand-summary?year=2026&month=9` | 指定月计划的在手数量、事业部、客户、状态、工序风险与交期预警聚合；当前页面固定读取 2026 年 9 月 | `on-hand-summary-dashboard:*:read`，并应用该报表的数据与字段权限 |
| `GET /organization-options` | 月计划事业部部门字段可选的企业微信组织节点（稳定 UUID + 完整路径） | `monthly-plan:*:read` |

月计划“事业部”字段位于“序号”后，字段键为 `responsibleOrgId`，数据库保存 `organization_units.id`。直接导入 `事业一部.xlsx` 至 `事业四部.xlsx` 时以文件名确定整份文件归属；四份异构源表经 `sync-september-division-plans.cjs` 标准化合并时，每行继续携带其原始文件名对应的事业部名称，再由预览服务唯一解析为稳定 UUID。文件名与行内事业部冲突、组织重名或无法匹配时拒绝导入，不作猜测。

月计划表格只显示事业部末级名称，编辑器仍显示完整组织路径以避免同名部门误选；客户列固定在订单号之前。单价、订单入库金额和订单欠数金额保留在导入导出及历史兼容契约中，但不在月计划网页表格、字段显示或批量修改中出现。

月计划不提供手工上移、下移、置顶或置底操作。筛选区复用 KDOS 标准表格的“搜索当前表格 + 按字段筛选”控件；关键词与字段条件均在当前权限范围内的数据上生效，条件变化后分页回到第一页。

主计划系统各资源的受控 Excel 导入统一使用 `GET /api/v1/master-plan-system/resources/:resource/export` 导出当前查询范围，再通过 `POST .../:resource/import-preview` 和 `POST .../:resource/import-confirm` 两阶段导入；`GET .../:resource/import-template` 用于下载新增模板和填写说明。记录ID是系统生成的稳定唯一标识，版本是防止多人覆盖的乐观锁整数：记录ID和版本同时留空表示新增，系统自动生成二者；二者同时填写表示更新，必须原样保留导出值；只填写其中一个时拒绝导入。新增行同时要求表级 import 与 create 权限，更新行要求 import 权限并重新校验字段权限、数据范围和乐观版本。确认令牌绑定用户、租户、资源、文件内容并有有效期，新增和更新可在同一文件中混合，整批在一个事务中提交并记录逐行及批次审计。出货计划和基础计划的交期编码不出现在新增可填写字段中，也不允许更新或由 Excel 覆盖；服务端按同一租户+订单编号+品项编码在事务锁内递增生成 `001`、`002`……，删除后不复用，超过 `999` 自然使用 `1000`。已有记录的 UUID、交期编码及日期不因导入或普通日期修改重建。所有入口只接受 xlsx，解析前调用统一加密容器检测，检测到加密文件时原样返回“该文件被加密,请解密后再导入.”。

出货计划手工新增要求品项名称和承接事业部必填；新旧款为可选字段。事业部基础计划要求最迟评审交期、产品属性、表面性质和生产方式必填，新旧款为可选字段；产品属性固定为五金、木作、亚克力、五金+木作、其他、五金+亚克力、塑料，表面性质固定为烤漆、电镀、热转印、毛坯、其他。网页、Excel 导入和直接 API 写入均由后端执行相同的必填和选项校验。手工新增或编辑弹窗的确认操作会显示加载状态；客户端校验或服务端拒绝时，弹窗内持续显示具体原因并保留草稿，不再静默无响应。

出货计划、事业部基础计划、事业部周计划、周计划工序明细、客户事业部映射、订单分配和工序周期均允许具备资源 `create` 权限的用户网页手工新增；无该权限时前端不显示新增按钮，后端也拒绝直接调用。基础计划和周计划的上游来源引用允许为空，以区分手工记录；后续命中同一“订单编号 + 品项编码 + 交期编码”时可由投影同步安全关联上游。主计划字段统一使用“品项编码、品项名称、交期编码”；其中交期编码是系统只读的记录序号，不是交期日期编码。主计划现有 `id uuid` 是全生命周期固定的技术主键，交期日期修改只更新日期，不重建计划记录。旧字段 `model_age` 的业务含义是“新旧款”（新/旧），不是模具年龄；基础计划不再包含准入状态和准入说明，事业部周计划不再包含计划页数。

周计划工序明细的“所属事业部周计划”用于关联具体的事业部周计划记录，网页按“订单编号 / 品项编码 / 品项名称 / 交期编码”选择和显示，不要求用户识别 UUID。工序顺序是内部排程数据，不再作为业务字段展示。报工日期使用 `YYYY-MM-DD`，手工新增时默认 Asia/Shanghai 当天；当日报工按该日期汇总工序报工表数据，工序状态仍按累计报工与计划数量计算，避免把单日数量误当累计完成量。

主计划业务写入与重投影使用事务型 `mps_reconciliation_outbox`：业务行和待处理任务在同一数据库事务内提交，提交后立即尝试消费，失败由定时消费者重试。接口不会因提交后的投影失败而把已成功的业务写入报告成失败。任务记录保存稳定用户 UUID；系统定时任务使用禁用登录的 `__kdos_system__` 主体（`0199e000-0000-7000-8000-000000000001`），不得使用用户名、临时字符串或空值冒充审计身份。

## Administrator and permission-management routes

Administrator grants are not roles or table permission groups. `GET /api/v1/admin/administrators` is available read-only to system and module administrators and returns server-derived management capabilities. `PUT /api/v1/admin/administrators/:userId` accepts `systemAdmin`, stable `moduleCodes`, `expectedVersion`, and an optional `targetUserId` for an audited account replacement. Only `admin` may change system administrators; any system administrator may change module administrators; module administrators cannot write. `GET /api/v1/admin/table-permission-context?resource=...` and all table-permission-group writes validate that the caller is a system administrator or the administrator of the registry module owning that exact resource. Clients must not infer authority from Chinese labels or ordinary role names.

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

E10、T+凯南和T+科加分别使用独立只读连接、任务、游标、日志和失败重试；SQL Server 查询固定为 READ COMMITTED，禁止 NOLOCK 和任何源端写入/DDL。日常增量使用修改时间加源主键、2分钟重叠窗口、每批1000条，并只在目标 PostgreSQL 当前批次幂等提交后推进实际处理游标。

面向多个目标表的扩展使用事务型变更事件与独立投影消费者。消费者必须先在目标资源内幂等写入并提交，再确认事件批次；目标幂等键保持 `source_system + source_database + source_table + source_id`。新增目标表只新增消费者和明确的 Canonical Model 映射，不增加 SQL Server 读取任务，不按订单号自动归并，也不复制现有业务表。

Implement `SalesOrderProvider` from `packages/integration-sdk`, map source rows to `packages/canonical-model`, then call a protected application/API ingestion command. `integrations/tplus` demonstrates dual-account mapping and per-read deduplication. Source SQL and connection details stay outside Planning.

Phase-one legacy T+ snapshot route remains `/api/v1/data-operations/tplus/sales-orders/snapshot` for compatibility while its write side is migrated to canonical Planning commands.

### T+ 供应商清单

“数据中心 → 供应链 → 供应商清单”使用独立资源码 `supplier-list`，页面和 `GET /api/v1/supply-chain/suppliers` 默认只读。查询端按租户、表操作权限、字段可见权限和数据范围执行服务端搜索、筛选、排序与分页；默认50条，可选20/50/100/200条。

源适配器 `automation/tplus_supplier_import/extract.py` 使用统一 `basic_code.MSSQLDatabase` 读取凯南智能、科加智能两个 T+ 账套的 `dbo.AA_PartnerEntity`，仅选择 `partnerType IN (226, 228)`，以 `AA_PartnerClass` 补充分类。读取固定为 `READ COMMITTED`，不修改源库，不导出银行账号或税号。规范模型通过受保护的 `POST /api/v1/supply-chain/suppliers/import` 或同一 Application Command 导入；目标唯一键为 `tenant_id + source_system + source_database + source_id`，相同有效载荷可安全重放，新增、变化行和批次结果均记录审计。

## Audit actor identities in standard tables

`createdBy` and `updatedBy` declare `format: "auditActor"` in the shared field metadata. Their underlying member/text types and stored values remain unchanged. Candidate APIs return the original actor in `value` and its readable name in `label`; clients must submit `value` in FilterGroup equality/set rules. The public candidate service first selects actor values from authorized records, then resolves names in batches, including disabled historical users. Name searches scan authorized values in bounded keyset batches; ordinary business-member selectors retain their enabled-only providers.

`AuditActorIdentityResolver` and the shared contracts formatter also handle `system`, existing textual actors and unknown UUIDs. Standard print/export still omit audit fields by default; an explicitly printable audit column uses the same resolver. This change adds no route, migration or historical actor backfill.

## Events

Connect to Socket.IO namespace `/plans` with the access token and period. Treat events as cache invalidations. Payloads contain IDs/version/change type only; consumers refetch through authorized query routes and process each event idempotently.

## KDOS notifications

Application commands use `NotificationService` to write `notification_outbox` in the same PostgreSQL transaction as the business change when an `EntityManager` is available. Each row is tenant-scoped and idempotent by `tenant_id + dedup_key`; the internal Dispatcher API claims due or stale rows with `FOR UPDATE SKIP LOCKED`, matches an enabled rule, resolves dynamic recipients and creates one delivery attempt per recipient before returning a text message. The outbox transitions `PENDING`/due `FAILED` to `PROCESSING` and then to `SENT` or retryable `FAILED`; delivery logs retain per-recipient `SENT`, `RETRY_PENDING` and `SKIPPED` outcomes.

Equipment status writes emit `equipment.status.fault_changed` only when `faultMinutes` changes and the new value is greater than zero. The equipment row, its audit record and the outbox event share the status-write transaction. The event payload carries equipment/division snapshots, old/new fault minutes, fault reason, actor identity and occurrence time; no recipient or Enterprise WeChat identity is resolved at this boundary.

`POST /api/v1/internal/notifications/claim` and the per-delivery success/failure callbacks are host-only endpoints protected by `KDOS_NOTIFICATION_INTERNAL_TOKEN`, `X-KDOS-Tenant-Id` and `X-KDOS-Worker-Id`; they do not use browser authentication or expose a notification center. The host project `automation/wechat_push_projects/kdos-notification-dispatcher` only calls this API and the default `WeChatPusher` from `/data/automation/code/work/basci/basic_code`; it never connects to PostgreSQL or resolves recipients. The API claim response is authoritative: each returned recipient contains one `deliveryId`, one stable KDOS user ID and that user's Enterprise WeChat UserId. The Dispatcher sends each item separately and its callback updates only that delivery ID. It does not merge recipients, substitute identities or apply a recipient environment gate.

The authenticated message-center API is under `/api/v1/notifications` and is used by `/system/notifications`. It provides registered events/template variables, tenant-scoped rule CRUD, real delivery logs/failures, authorized retry, and a test enqueue endpoint. The test endpoint creates a real delivery to the rule's currently resolved recipients, so the Web confirmation must say so explicitly. It does not expose internal claim/success/failure APIs, arbitrary event types, arbitrary recipient parsing, or new delivery channels. `apps/api/src/modules/notifications/notification-event.registry.ts` is the single event-definition source used by both administration APIs and Dispatcher claim processing; unregistered events, resource mismatches and recipient rules outside an event's allowlist are quarantined before delivery. The current registered event is `equipment.status.fault_changed` for `equipment-status-report`; supported recipient rules are `EQUIPMENT_RESPONSIBLE` and `FIXED_USERS`, with fixed rules resolving current organization, role and user relationships by stable IDs at dispatch time and retaining legacy `recipientUserIds` read compatibility. The event triggers only when fault duration changes and the new value is greater than zero.

The finance daily summary (`finance.monthly.daily_summary`) keeps its existing 08:30 Asia/Shanghai daily orchestration and tenant/rule/day deduplication key. New daily events carry `financeReportFormat:1` and prepare a monthly XLSX through the canonical monthly export source with each recipient’s live read/export, field permissions and read∩export scope. The filename is `YYYY年M月接单统计-生管.xlsx`. A repeatable-read snapshot freezes the files and summary; text/file components retry independently. Existing saved text configurations and unmarked legacy events remain compatible. Finance-only attachment downloads use `GET /api/v1/internal/notifications/:id/finance-attachments/:attachmentId`, with the same internal guard plus current rule, recipient, WeChat identity, worker lease, permission fingerprint and SHA checks. No public file URL or new scheduler is introduced. The existing PMC attachment route, routing and workbooks are unchanged. Deployment/verification status is recorded in `outputs/FINANCE_MONTHLY_ATTACHMENT_ACCEPTANCE.md`.

## Equipment management routes

Equipment management is a native PMC function, not an ERP projection. `GET/POST/PATCH/DELETE /api/v1/equipment/assets` uses resource `equipment-register`; `GET/POST/PATCH/DELETE /api/v1/equipment/status-reports` uses `equipment-status-report`; and `GET /api/v1/equipment/dashboard` uses `equipment-dashboard`. All three apply independent permission-group scopes using the stable `divisionId` department field. Status durations are integer minutes on the wire and render as `X小时X分钟`; status dates must fall between the current Asia/Shanghai date and six days earlier. The target tables are tenant-scoped, optimistic-versioned, audited, and never accept browser-supplied system audit fields.

设备总台账的 `plannedStartupMinutes` 表示“设备计划开机时间”，接口和数据库使用非负整数分钟，网页统一显示为 `X小时X分钟`。系统管理员身份在设备读取和写入时由后端显式识别为最高权限，不依赖浏览器缓存的普通表权限声明；设备状态删除仍执行租户校验、乐观锁、软删除和审计。

设备总台账的新建设备和工作簿导入设备均默认“无需填报”。存量批量重置只能由系统身份调用 `EquipmentApplicationService.resetAllMonitoring`，每台发生变化的设备均递增乐观版本并记录变更前后审计。设备治理企业微信日报通过 `EquipmentQueryService.governanceSummary` 读取事业部、监测数量和责任人设备数量，不直接访问数据库，也不复制企业微信密钥。

设备状态列表通过状态行的稳定 `equipmentId` 实时关联设备总台账的 `equipment_responsibles`，响应中的 `responsibleUserIds` 和 `responsibleUsers` 始终反映总台账当前责任人，不在状态记录中复制快照。该字段已注册为只读成员字段，网页默认隐藏，用户可通过“字段显示”主动开启；搜索和字段筛选可按责任人姓名命中。

`GET /api/v1/equipment/status-options` 专用于状态新增/编辑表单。只有拥有状态表 `create` 或 `update` 操作权限的用户可以调用；新增候选只包含设备总台账中启用且标记为“需要填报”的设备。`ADD_MANAGE_OWN` 的 `OWN` 范围约束状态记录的创建人，不得错误套用到尚未创建的设备候选；该组可新增状态，但读取、修改、删除和导出仍只能作用于本人创建的数据。前端操作按钮以 `/auth/me` 的实时权限为准，不得使用旧的本地会话权限打开弹窗。

设备状态表的 Excel/CSV 导入采用预览确认流程：`POST /api/v1/equipment/status-reports/import-preview` 只解析、匹配和校验文件，`POST /api/v1/equipment/status-reports/import-confirm` 验证服务端签名后以“事业部稳定组织 + 设备编号 + 填报日期”幂等新增或更新。`GET /api/v1/equipment/status-reports/import-template` 下载模板，`GET /api/v1/equipment/status-reports/export` 按当前用户的数据权限、搜索和字段筛选范围导出 Excel。导入和导出分别要求该表的 `import`、`export` 权限并记录审计；五种系统预置权限仍不授予导入能力。

## 月度计划全部显示与订单排期 Excel

月度计划列表 `pageSize=0` 表示“显示所有”，只返回选定版本、搜索和筛选条件下有权查看的记录。默认仍为50条，其他选项为20/100/200。月度计划业务唯一键为同一租户和计划版本中的“订单号 + 品号”；订单排期为同一租户中的“订单编号 + 品项编码”，均保留 UUID 技术主键。

订单排期新增 `GET /api/v1/marketing/order-schedules/import-template`、`POST /api/v1/marketing/order-schedules/import-preview`（multipart `file`，仅xlsx，最多20MB/50000行）、`POST /api/v1/marketing/order-schedules/import-confirm`（预览返回的 `token`）。三个入口要求订单排期 import 权限；字段和数据范围在预览与确认时重新验证。模板包含9个可填写业务字段及填写说明，不含系统字段；新增“状态”单选字段只接受正常/作废，旧模板不含该列时按正常处理。预览返回行号和失败原因，错误未修复不可确认；确认使用30分钟有效的用户/租户绑定签名，按组合键新增或更新，已有记录进行版本检查，整批事务提交并逐行审计。同一文件哈希重复确认不会重复写入。空白客户交期和生产单位会清空已有值，完成比例留空为0。

订单排期是独立维护的数据表，只接受界面编辑、Excel 导入、已授权的删除操作，以及用户显式选择记录后执行的“同步到滚动计划表”；不再从月度计划、业务人员与客户对应表或外部客户数据导入链路读取数据，也不再向原有周计划分周表写入数据。`POST /api/v1/marketing/order-schedules/sync-to-rolling-plan` 同时校验订单排期读取权限和滚动计划表导入权限，以订单号+品号匹配，仅映射客户代码→客户、订单编号→订单号、品项编码→品号、客户交期→客户要求交期、生产单位→事业部、订单总数量→订单需求数量；生产单位必须唯一解析为稳定组织 UUID。命令逐行返回新增、更新、未变化、保留和异常明细，且以客户端请求 UUID 幂等。经明确授权的一次性清空使用 Application Command：`docker compose exec -T api node dist/modules/marketing/clear-order-schedules.js --confirm-clear-order-schedules`。运行前必须完成备份；命令仅清空当前租户订单排期，记录原值审计，现有周计划记录保留（来源引用按外键规则置空）。

事业部订单评审位于“PMC中心 → 生产主计划 → 订单评审”，资源码为 `division-order-review`，读取和导出接口分别为 `GET /api/v1/marketing/division-order-reviews` 与 `/export`。订单排期的新增、修改、状态切换、批量交期修改和 Excel 导入均在源写事务内同步该投影；源字段不可在评审表修改，“事业部评审交期”可由具备表更新和该字段编辑权限的用户通过 `PATCH /api/v1/marketing/division-order-reviews/:id/review-due-date` 维护。修改源记录或评审交期都会清除旧确认状态；删除订单排期不会抹除评审历史，而是清除来源引用并将评审状态置为作废。

单条与批量“交期确认”统一调用 `POST /api/v1/marketing/division-order-reviews/confirm`，请求包含1至1000个 `{id, expectedVersion}` 和客户端 UUID `idempotencyKey`。后端同时校验事业部订单评审更新权限、源数据范围，以及滚动计划表导入或更新权限和目标数据范围。匹配键固定为订单编号+品项编码：目标不存在时写入客户、事业部、订单号、品号、品名、订单需求数量、客户要求交期和评审交期；目标存在时只修改订单需求数量、客户要求交期、评审交期三个业务字段。作废、未填写评审交期、版本冲突或新增时生产单位不能唯一匹配组织的记录进入异常明细，不阻断其余记录；事务记录逐行源/目标审计和批次审计，响应返回新增、更新、未变化、已确认与异常数量。

销售接单明细读取必须使用 `rolling-plan` 自身的数据权限。该资源具有可读的 `ALL` 数据范围时，即使成员没有旧版 `divisions` 声明，也必须返回全部授权数据；公司驾驶舱的 `sales-summary-dashboard` 范围不能串授给销售接单明细，反之亦然。

设备状态填报“导出模板”下载空白xlsx（含填写说明、文本格式设备编号）。模板接口允许当前用户具备该表 create、import 或 export 任一权限；不包含现有业务记录。正式导入仍单独要求 import 权限，数据导出仍要求 export 权限。

## PMC研发进度 E10同步

新增 `/api/v1/internal/pmc/rd-progress/sync`，沿用 `x-kdos-internal-token`（KDOS_RD_INTERNAL_TOKEN）与 `x-kdos-tenant-id`，请求必须显式指定FULL/INCREMENTAL。SQL Server adapter只读并复用basic_code凭据，Python仅作为驱动，业务状态由TypeScript Calculator计算。包括BOM/路线及标准路线引用者的影响集合，订单候选日期独立自2026-09-01，水位保持微秒文本与源UUID。整批成功后才提交水位，源删除保留软失效快照，不重写现有主订单/rd业务。详见 [研发进度模型、API与验证](pmc-rd-progress.md)。

## Knowledge Base

知识库 API/状态/ACL/私有附件与发布版本契约见 [Knowledge 2.0](knowledge-base.md)。所有写入调用 Application Commands；普通浏览读取发布快照，平台发布表、候选值与标准导出复用统一Space/祖先授权和发布搜索投影。未来AI引用稳定pageId + publishedVersionId + contentHash，本轮不新增RAG接口。

## 主计划综合大屏 REV2 缺口与独立报表

`GET /api/v1/master-plan-system/dashboard/gaps?type=...` 返回同一Dashboard Scope下的分页缺口；`/reports/:reportKey` 固定允许 `plan-readiness`、`process-execution`、`risk-exception`，原`/table`保持兼容。9个gap type与对应导出tableKey由`@kdos/contracts/mpsDashboardGaps`统一定义；不接收任意表名/SQL key。指标、清单、导出共用同一缺口关系，全部只读、tenant隔离，export为read∩export，并执行字段权限及依赖检查。局部参数search、processCode、onlyIncomplete、onlyOverdue、riskType仅作用于相应报表及本表全量导出；各表page/pageSize/sort独立，默认100。

出货缺口以正需求月计划为应有集合，通过shipping.monthly_plan_id正式tenant复合FK求尚未建立差集，不用order/item近似匹配，不宣称已排完全部数量/交期批次；base与weekly分别按shipping_plan_id/base_plan_id定位。已具备条件未进周与待完善分开；人工报工异常与准备/同步提示分开。三天工单的“当前窗口应生成”无权威定义，本轮不展示该缺口。详细集合、稳定键、计数和日期/组织Scope见`outputs/KDOS_MPS_GAP_AUDIT.md`及`outputs/KDOS_MPS_OVERVIEW_DASHBOARD_METRICS.md`。Dashboard不启动同步、不修改任何sync flag，无新业务表或migration。

### PMC在制订单进度（REV3-B）

`mps-order-progress-dashboard` 是独立planning资源，不继承overview的read/export或字段授权。编译期registry由现有正式权限组管理识别，不需要初始化生产权限。`GET /master-plan-system/order-progress/meta|orders|items|candidates` 使用租户和本资源scope；items按稳定orderId按需分页。`/detail/:resourceCode` 固定允许周计划/四类报工/工序任务，必须提供orderId/itemId，并交原资源read、字段、scope；不提供写入或同步能力。

`GET .../export/orders|items` 为两类全量XLSX，继承顶部精确多选/日期/未完成条件及read∩export/字段；忽略分页和展开定位ID，单订单品号导出应通过正式orderNumbers精确收窄。数量/状态/人工异常表达式与正式计划共用；报工先weekly/process聚合，按正式父链及事业部归属月计划，保留独立未关联来源行。图纸完成日期无正式字段，不使用更新时间代替。原overview契约不变。

## 待处理事项大屏 REV3-A

`/master-plan-gaps` 复用 `mps-overview-dashboard` 的 read/export、字段依赖和数据范围，不引入新权限资源或生产授权迁移。`GET /api/v1/master-plan-system/dashboard/gap-counts` 只返回 `{gaps, visibleFields, generatedAt}`；接收原顶部事业部/客户/订单/品号/日期条件，忽略清单的局部搜索、排序和分页。数量直接SELECT原querySql的同一gap_rows，清单及Excel仍使用原gaps/export接口；未授权指标省略，有权限但无行返回0。所有查询均tenant隔离、只读事务和参数化；原综合大屏及在制订单Demo接口行为保持兼容。

## PMC综合驾驶舱 REV3-C

原页面 `/master-plan-dashboard` 改名“PMC综合驾驶舱”，资源仍为mps-overview-dashboard，原Scope/字段/导出语义不变。新增 `GET /api/v1/master-plan-system/dashboard/summary`：同一querySql聚合，响应为MpsDashboardSummary、不含risks；跳过不用的风险明细行投影，原GET dashboard/gap-counts/gaps/reports/table/export保留兼容。不新增统计公式或业务写入。

`/master-plan-reports` 是原计划待完善/工序执行/风险与异常三表的独立入口，同一resource、同一组件/API及各自分页/搜索/排序/导出；正式源表下钻仍需原表权限。事业部汇总及原10行工序汇总的独立Excel继续可用。

跨屏固定目的地为gaps/order-progress/reports；`from=pmc-cockpit`和原顶部filters白名单显式携带scope，gap只允许原9类。contracts的readMpsDashboardNavigation校验数组、长度、UUID、日期类型/周期和原日期范围；非法携带条件阻止目标数据请求。身份/权限/任意SQL/returnTo均忽略，目标后端权限独立校验。没有来源标记的直接打开仍使用A/B原默认值；B从不限日期驾驶舱进入时显式NONE，不改变其直接打开或重置的上海昨天默认。

## 财务月度发生额下钻

月度、大屏、排名、日报现共享finance_e10_order_monthly_movements；旧finance_e10_monthly仅为内部余额。表格平台buildContext支持第三个可信actor参数，列表、候选、打印与Excel均传入。finance-e10-changes允许monthlyRecordId上下文，在后端以月度read/订单号字段/数据范围解析精确来源订单键，再取变更自身授权范围；不接受浏览器传入tenant或SQL。月度列表/导出使用monthFrom/monthTo日历上下文，校验年月格式与年月字段权限；大屏dateFrom/dateTo兼容旧链接但比较发生月，quality为null，异常日志独立授权。详见finance-order-monthly-movements.md。

### 评审交期表专用人工创建

`mps-review-due-dates` 保持通用create:false；网页通过metadata的actions.create及createFields使用专用 `POST /api/v1/master-plan-system/review-due-dates/manual-create`。只接受六业务字段与commandId，资源create、字段填写授权、租户有效用户及拟新增记录的create数据范围均在Application Command检查。只新增用户可读取创建元数据，不获得列表、历史或导出权限。UUIDv7、租户、来源初始键、计数及审计由服务端维护；首次新增不写交期变更历史，lastSyncedAt为空。持久幂等收据与审计同事务；业务键/来源身份重复409，不覆盖。

手工新增记录通过正式MANUAL创建审计与来源同步区分；未来observe命中这类记录时拒绝自动同步并要求来源身份人工核实。CREATE-001阶段未实现身份确认、Excel导入、同步适配器或调度，未改生产权限组。现有专用ID人工编辑、expectedVersion、日期历史及通用写入口保护继续有效。

### 评审交期表Excel导入（IMPORT-001，本地完成、待确认发布）

复用resources/mps-review-due-dates的import-template、import-preview?view=STANDARD|SOURCE及import-confirm接口；Spreadsheet适配器进入专用ReviewDueDateImportApplicationService和既有mps_import_previews事务，不开放通用create/PATCH/批量/删除。空白模板由Registry生成8列及说明；独立模板读取授权不等于写入，受限字段仅生成结构参考。实际表头与隐藏映射必须一致。STANDARD按原ID+version，SOURCE必须明确选择并按不可变初始三键匹配；MANUAL或STANDARD创建的来源未核实记录遇SOURCE/observe需人工核实。

预览不修改业务表；确认复查租户有效用户、import、新增create、字段/动作范围、唯一性与版本，同事务更新主表、IMPORT日期历史、逐行/批次审计及幂等收据。无read或不在read范围的既有值、日期方向/数量比较不经预览泄露。完全未变化不更新业务行；重复确认不重复计次。原十列业务导出保留，标准更新身份需由获权系统记录提供。详情见outputs/KDOS_MPS_REVIEW_DUE_IMPORT_ACCEPTANCE.md；用户后续已授权同步GitHub；本次不生产导入、部署或启用任何调度。
