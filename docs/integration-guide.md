# KDOS Planning integration guide

All Planning routes use `/api/v1/planning`, bearer JWT/API identity and tenant code `KAINAN` by default. External writers must use an idempotency key and must not access the Planning database.

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

## Events

Connect to Socket.IO namespace `/plans` with the access token and period. Treat events as cache invalidations. Payloads contain IDs/version/change type only; consumers refetch through authorized query routes and process each event idempotently.

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
