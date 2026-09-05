# KDOS Planning integration guide

All Planning routes use `/api/v1/planning`, bearer JWT/API identity and tenant code `KAINAN` by default. External writers must use an idempotency key and must not access the Planning database.

## 企业微信组织架构

- 企业微信通讯录导出是组织架构、成员归属和部门负责人的权威来源；同步任务使用 `basic_code.export_contacts`，不得在本项目复制企业微信凭据。
- 导出中的 `department_id` 映射到稳定外部部门 ID；`is_leader_in_dept` 必须按同一行的成员—部门关系解析，不能误用 `direct_leader` 替代部门负责人。
- 一次全量同步同时更新部门拓扑、成员状态和负责人集合。部门负责人权限按最新关系实时计算，并自动覆盖其负责部门的完整子树。
- 组织名称和路径只用于显示。同步、业务部门字段和权限计算均使用稳定 ID，以兼容父子部门同名及不同分支重名。
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

## Events

Connect to Socket.IO namespace `/plans` with the access token and period. Treat events as cache invalidations. Payloads contain IDs/version/change type only; consumers refetch through authorized query routes and process each event idempotently.

## Equipment management routes

Equipment management is a native PMC function, not an ERP projection. `GET/POST/PATCH/DELETE /api/v1/equipment/assets` uses resource `equipment-register`; `GET/POST/PATCH/DELETE /api/v1/equipment/status-reports` uses `equipment-status-report`; and `GET /api/v1/equipment/dashboard` uses `equipment-dashboard`. All three apply independent permission-group scopes using the stable `divisionId` department field. Status durations are integer minutes on the wire and render as `X小时X分钟`; status dates must fall between the current Asia/Shanghai date and six days earlier. The target tables are tenant-scoped, optimistic-versioned, audited, and never accept browser-supplied system audit fields.

设备总台账的新建设备和工作簿导入设备均默认“无需填报”。存量批量重置只能由系统身份调用 `EquipmentApplicationService.resetAllMonitoring`，每台发生变化的设备均递增乐观版本并记录变更前后审计。设备治理企业微信日报通过 `EquipmentQueryService.governanceSummary` 读取事业部、监测数量和责任人设备数量，不直接访问数据库，也不复制企业微信密钥。

设备状态列表通过状态行的稳定 `equipmentId` 实时关联设备总台账的 `equipment_responsibles`，响应中的 `responsibleUserIds` 和 `responsibleUsers` 始终反映总台账当前责任人，不在状态记录中复制快照。该字段已注册为只读成员字段，网页默认隐藏，用户可通过“字段显示”主动开启；搜索和字段筛选可按责任人姓名命中。

设备状态表的 Excel/CSV 导入采用预览确认流程：`POST /api/v1/equipment/status-reports/import-preview` 只解析、匹配和校验文件，`POST /api/v1/equipment/status-reports/import-confirm` 验证服务端签名后以“事业部稳定组织 + 设备编号 + 填报日期”幂等新增或更新。`GET /api/v1/equipment/status-reports/import-template` 下载模板，`GET /api/v1/equipment/status-reports/export` 按当前用户的数据权限、搜索和字段筛选范围导出 Excel。导入和导出分别要求该表的 `import`、`export` 权限并记录审计；五种系统预置权限仍不授予导入能力。
