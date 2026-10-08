# PMC 研发进度：Phase 4

研发完成表示“已审核的设计 BOM + 所需工艺路线齐套”。Phase 3 Python probe 是离线回归 Oracle，生产 API 和同步不调用它。此阶段仅提供数据模型、同步和 API，React 页面留到 Phase 5。

## 数据与边界

- `pmc_rd_progress_items`：当前派生快照，UUIDv7 `id`，唯一键 `(tenant_id, source_order_line_id)`。订单号+品号不是业务唯一键，同订单重复品项分别保存。
- `pmc_rd_progress_sync_runs`：独立批次，记录模式、状态、开始/源观察/完成时间、读取/新增/更新/未变/失败/软失效行数、前后水位和错误；每租户最多一个 RUNNING。
- 数量为 `numeric(28,8)`，API 返回十进制字符串。源审计时间为 `timestamp(6)`（上海墙上时间），API 返回六位小数文本；运行/入库时间为 `timestamptz`。水位时间始终是文本，不能经过 JavaScript Date。
- 五个非重复 partial 查询索引覆盖订单、研发状态+日期、品号、事业部+客户和日期。小规模单组件状态筛选暂不另建索引；后续根据查询计划调整。
- 两表启用 RLS。所有查询显式限制 tenant，事务设置 `app.tenant_id`。状态筛选、汇总、订单汇总、详情及平台导出均执行数据范围；字段隐藏同时约束返回和筛选，隐藏状态不输出对应 KPI。
- 事业部复用 `mps_customer_division_mappings` 的启用客户编码→主责事业部映射。无映射保留 NULL；保留 E10 `Owner_Dept`。增量也处理映射更新时间带来的受影响客户。
- 正式候选条件独立固定为 `SALES_ORDER_DOC.CreateDate >= 2026-09-01 OR LastModifiedDate >= 2026-09-01`，不排除关闭或非 Y 订单，保存订单原始 `ApproveStatus` 和 `[CLOSE]`（`orderStatusRaw` / `orderCloseRaw`）。主订单 `2026-09-17` 准入不变。

## 状态与一致性

品项状态：`NOT_APPLICABLE / NOT_STARTED / DESIGN_IN_PROGRESS / WAITING_ROUTING / ROUTING_IN_PROGRESS / COMPLETE / ABNORMAL`。组件状态：`NOT_APPLICABLE / NOT_STARTED / IN_PROGRESS / COMPLETE / ABNORMAL`。

规则集中在 `PmcRdProgressCalculator`，包括 P+0 不适用、M+1 设计及路线、M+2 特征路线异常、未知组合异常、唯一有效 BOM、多路线歧义、标准路线跨品项引用和工序引用有效性。reasonCode 和 reasonText 与 Phase 3 一致，保留 `ITEM_PLANT_MATCH` 原来源代码；不另造枚举。每次从当前事实重新计算，允许状态倒退。

`rdLastModifiedAt` 沿用 Oracle，取适用 BOM/BOM_D/ITEM_ROUTING/ITEM_ROUTING_D 的创建/实际修改时间最大值，绝不使用订单时间代替。无资料为 NULL。

总体/设计完成率排除整体研发不适用；路线完成率还排除 control=0 或路线不适用。异常属于未完成。完成率返回两位小数的百分数文本（例如 `65.99` 表示65.99%，没有 `%` 符号）；分母为0返回 NULL。订单存在异常即 ABNORMAL；全部不适用为 NOT_APPLICABLE；全部适用完成为 COMPLETE；其余 IN_PROGRESS。列表与汇总都针对当前授权及筛选后的匹配品项，不使用90%/95%阈值。

源库未启用事务级 SNAPSHOT，已启用 READ_COMMITTED_SNAPSHOT。`sourceSnapshotAt` 来自 `CAST(SYSDATETIME() AS datetime2(6))`，是本批源观察/增量扫描截止时间；多条源查询不具备时间旅行或整个事务冻结语义。批次 `sourceConsistency=READ_COMMITTED_CAPTURE` 明确该限制。Oracle回归必须对同一份捕获事实运行两个 Calculator，不能比较两次实时查询后声称相同快照。读取期间晚于截止时间的修改会在下一次重叠增量再次覆盖。

## FULL 与 INCREMENTAL

适配器 `pmc_rd_progress_reader.py` 用共享 basic_code 的 `MSSQLDatabase` 配置和只读驱动，仅输出事实，不计算业务状态。事实经 TypeScript 适配器进入 Calculator 和 Application Command。

FULL 批量取候选行、ITEM_PLANT、BOM/明细、Routing/明细/OPERATION。INCREMENTAL 按各源表 `(LastModifiedDate, 稳定UUID)` keyset 读取变化，投影/排序统一 datetime2(6)，最多1000条/页，保留2分钟 overlap。水位为：

```json
{"snapshotAt":"2026-10-07 09:09:36.645056","sources":{"BOM":{"at":"2026-10-07 08:56:03.000011","id":"..."},"ITEM_ROUTING":{"at":"...","id":"..."}}}
```

变化源包括订单头/行、ITEM、ITEM_PLANT、BOM/明细、Routing/明细、OPERATION，另包含客户和原部门名称。先收集受影响 ITEM/订单集合再批量重算；路线变化还反查 `ITEM_PLANT.STANDARD_ROUTING_ID` 的全部消费者。BOM生效/到期边界即使没有修改记录也触发重算。候选行清单每次读取，用于发现订单行消失/离开范围并软失效；FULL还可修复BOM/路线的物理删除。

不带修改审计的 BOM/路线硬删除无法仅凭 LastModifiedDate 可靠检测；应通过人工 FULL 重建校正，当前未增加定时器或历史系统。

所有写入在同一个 PostgreSQL 事务中：每250行 JSON recordset UPSERT、内容 SHA-256 比较、真实变化行的逐行审计、软失效审计、批次成功及水位提交。观察时间/入库时间不参与内容hash，未变行不 UPDATE，版本/updatedAt 不抖动；重新出现的行原ID保留并重新激活。任一失败整体回滚，记录 FAILED，不推进水位。源读取期间持有租户session advisory lock；进程断开自动释放，下一次持锁后将遗留 RUNNING 标为FAILED。

## API

所有路径以下述前缀提供：`/api/v1`。

| 方法/路径 | 行为 |
|---|---|
| GET `/pmc/reports/rd-progress/items` | `{rows,total,page,pageSize}`，默认100，50/100/200/500/1000，上限1000 |
| GET `/pmc/reports/rd-progress/items/:id` | 授权范围内的单条快照；越范围同不存在 |
| GET `/pmc/reports/rd-progress/summary` | 订单/品项数量、适用/不适用/完成/未完成/异常、设计及路线数量/分母/完成率、完整七状态分布 |
| GET `/pmc/reports/rd-progress/orders` | 分页订单汇总、客户、数量、完成率与 `orderRdStatus` |
| GET `/pmc/reports/rd-progress/sync-status` | 最新批次；数据范围受限用户不返回全租户行数 |
| POST `/internal/pmc/rd-progress/sync` | 内部token+tenant，`{"mode":"FULL"}` 或 INCREMENTAL，返回批次计数及水位 |
| GET `/table-exports/pmc-rd-progress` | 平台标准XLSX导出；需要独立export权限，按字段与数据范围裁剪 |

查询参数：`page/pageSize/orderNo/customer/division/itemCode/itemName/rdStatus/designBomStatus/routingStatus/orderStatus/orderClose/orderDateFrom/orderDateTo/onlyIncomplete`，以及统一 `search/filterGroup/sortField/sortOrder`。状态字段接受权威枚举值或中文标签。`orderStatus` 对应未解释的源审核状态原始值，`orderClose` 对应原始CLOSE值。日期筛选两端包含；onlyIncomplete 排除 COMPLETE/NOT_APPLICABLE。字段无查看权限时禁止按它筛选或排序。

资源代码 `pmc-rd-progress`，归属 `planning`，查看权限沿用 `pmc-rd-progress:*:read`，字段为 `pmc-rd-progress:<fieldKey>:read`；系统/PMC模块管理员复用现有授权。没有普通用户触发FULL的路由。内部接口复用 `KDOS_RD_INTERNAL_TOKEN`（兼容现有内部同步凭据），并严格校验 `x-kdos-tenant-id`；不得打印token。

## 验证与运维

```bash
python3 -m unittest discover -s data-operations/e10 -p 'test_pmc_rd_progress*.py'
pnpm --filter @tracker/api test -- pmc-rd-progress
```

37组共用 JSON fixtures 同时由 Python 和 TypeScript 验证。`validate-pmc-rd-progress.cjs` 只允许 `pmc_rd_phase4_test_*` 隔离库，覆盖真实迁移、FULL重放、增量、状态倒退、分块失败回滚、水位、重复品项、软失效/恢复、权限与真实非owner RLS；不能在正式库运行该测试。

正式执行可使用内部API，或 `run-pmc-rd-progress-sync.cjs FULL|INCREMENTAL [private capture directory]` 的管理员CLI。CLI所有写入仍通过同一 Application Command。捕获目录必须在ignored `data/` 下且不可通过Web公开。`pmc_rd_progress_regression.py facts.json typescript.json --output report.json` 只用于离线验收，不在生产API/runtime调用。

迁移和部署前先运行标准备份，验证隔离库迁移/源SQL/候选数/sourceSnapshotAt，然后应用 `1722920082000-PmcRdProgress` 和 `1722920083000-PmcRdProgressOrderCloseRaw`、构建部署API及使用更新Contracts的Web、健康检查和正式FULL/INCREMENTAL。保留原Phase3工具，不运行seed、不删除历史数据库、不改变主订单或rd同步、不发送企业微信。

待确认业务项保持原临时规则：P+1/M+0异常、V为不满足当前已审核条件（不翻译为作废）、关闭订单保留；Phase5再确认页面默认范围。

## Phase 5 正式页面

入口为 PMC中心 → 报表 → 研发进度，URL `/pmc/reports/rd-progress`。资源 `pmc-rd-progress` 的 read 权限同时控制菜单、页面与后端读取。页面展示只读品项进度，不提供同步、编辑或审批入口。

页面复用 Phase 4 的 items/summary/orders：六项 KPI、研发环节完成率、七状态分布、核心筛选、标准高级筛选及服务端分页。订单数、各状态数、完成率、异常原因和订单状态全部来自服务端；KPI/状态按钮只提交筛选条件。分页默认100，选项50/100/200/500/1000。URL恢复核心筛选；清空筛选会一并清除表格搜索/高级筛选。订单 Drawer 按 sourceOrderId 精确查询所有获权订单品项，不继承主表的品项/状态限制，其内嵌分页可查看后续品项。

导出继续使用 `/table-exports/pmc-rd-progress` 与平台 ExcelJS，不新增Excel框架。页面将日期/未完成等核心条件作为context，多选与标准高级/列筛选合并为FilterGroup传入；资源printRows适配器直接调用同一个 QueryService.list，以保证日期、客户、事业部、状态、onlyIncomplete口径一致。导出查询同时满足read范围ANDexport范围、tenant/active条件及字段读权限。客户端page/pageSize不能覆盖标准导出的分批页码；输出所有匹配行。列显示/宽度/冻结继续沿用KdosDataTable个人偏好（localStorage tenant+user+resource+viewKey），导出只发送可见业务列，不发送UI操作或来源UUID。

E10源时间按上海业务墙钟文本显示，不经UTC转换；带时区的同步时间按Asia/Shanghai展示。客户名称缺失回退客户编码，事业部名称缺失显示“未映射”，不展示裸来源UUID。V仍是原始审核值，不翻译为“作废”。空值和Excel格式保持平台标准（空值展示“—”、业务字典中文）。

生产E2E运行时读取外部凭据文件：`PMC_E2E_ENV_FILE=/secure/path/to/file E2E_BASE_URL=http://127.0.0.1:15172 node scripts/test-pmc-rd-progress-e2e.cjs`。文件字段PMC_E2E_USERNAME/PMC_E2E_PASSWORD/PMC_E2E_BASE_URL映射到现有Playwright运行环境，不落地凭据、token、storageState；专项测试关闭trace、截图、视频与页面失败快照，以避免记录登录身份。仅现有账号登录及只读查询/下载，不创建账号或调整权限。

## Phase 5.1 页面筛选

当前研发进度分为默认“图表看板”和“明细报表”；此分栏只用于本页。图表只放汇总、环节指标与状态分布，明细保留标准表格、订单Drawer、品项详情和Excel。共享已应用条件及已访问表格的搜索/高级/列筛选在Tab间保留。

Phase 5.3：图表看板的订单号、品号、品名、客户、事业部复用 `/table-filters/candidates?resource=pmc-rd-progress&field=...&search=...&limit=50&withMeta=1`，200ms搜索防抖、限量远程候选、多选及已选值保留。候选来自当前active研发进度授权数据集，不读取ITEM主数据或浏览器分页。品名按名称DISTINCT，同名品号由同一名称IN匹配全部相关项；option沿用真实值，事业部显示组织路径。

八个业务维度支持多选，远程维度沿用平台单规则最多50个值的限制（UI阻止超选），同维度OR（IN）、跨维度AND。前端URL将所选值保存为JSON数组（兼容旧单值链接）；API多选直接复用现有 `filterGroup` JSON契约，不新增数组query协议/路由。KPI、环节完成率、状态分布、列表和平台Excel共用已应用条件，标准规则与列条件继续AND合并。

明细不渲染顶部常驻筛选卡片、快速搜索或同步状态。现有平台高级筛选Popover承载完整业务条件与其他类型化规则；打开恢复已应用值、编辑仅改变草稿、应用后关闭继续生效，取消不提交。按钮显示“高级筛选(N)”（按有值维度计数，日期一个周期计1项，再加高级规则及列筛选数量）。重置清除业务/高级/列条件并恢复上海昨天。导出与字段显示仍在工具栏；已访问明细的分页、列偏好及筛选在Tab间保持，改变条件返回第一页。

日期沿用orderDate（下单日期）的包含式orderDateFrom/orderDateTo。日/月/年/自定义在前端转换为完整日历区间，API不接收周期模式。首次默认及重置恢复Asia/Shanghai昨天；URL保存period、periodValue（自定义为开始日,结束日）与tab，刷新恢复。兼容既有完整from/to链接。周期模式无全部/空日期，日期转换不经过UTC。标准导出继续使用同一已应用筛选和全量匹配记录。
