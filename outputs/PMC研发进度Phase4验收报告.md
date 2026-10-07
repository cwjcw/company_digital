# PMC研发进度 Phase 4 验收报告

验收日期：2026-10-07（Asia/Shanghai）
当前状态：已完成，Phase 4 PASS；已备份、迁移并部署到当前运行环境。
代码版本：`5d2faa1`（未push）。Phase 4 不包含React页面。

## 1. 修改/新增文件

以下包括保留并提交的Phase 3前置工具；未重新实现Phase 1—3。

- `ARCHITECTURE.md`
- `SECURITY.md`
- `apps/api/src/app.module.ts`
- `apps/api/src/common/filtering/table-filter-registry.spec.ts`
- `apps/api/src/integrations/e10/pmc-rd-progress.reader.spec.ts`
- `apps/api/src/integrations/e10/pmc-rd-progress.reader.ts`
- `apps/api/src/migrations/1722920082000-PmcRdProgress.ts`
- `apps/api/src/migrations/1722920083000-PmcRdProgressOrderCloseRaw.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.application.service.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.application.spec.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.calculator.spec.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.calculator.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.columns.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.controller.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.filter-sources.spec.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.filter-sources.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.module.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.query.service.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.query.spec.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.scope.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.types.ts`
- `data-operations/e10/fixtures/pmc-rd-progress.json`
- `data-operations/e10/pmc_rd_progress_probe.py`
- `data-operations/e10/pmc_rd_progress_reader.py`
- `data-operations/e10/pmc_rd_progress_regression.py`
- `data-operations/e10/run-pmc-rd-progress-sync.cjs`
- `data-operations/e10/test_pmc_rd_progress_probe.py`
- `data-operations/e10/test_pmc_rd_progress_reader.py`
- `data-operations/e10/validate-pmc-rd-progress.cjs`
- `docs/integration-guide.md`
- `docs/pmc-rd-progress.md`
- `docs/runbook.md`
- `outputs/CODEX_PROGRESS.md`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/pmc-rd-progress.ts`

本报告是新增加的交付记录；私有事实、数据库备份和测试运行日志均在ignored `data/` 下，没有进入Git。

## 2. PostgreSQL正式表结构

- `pmc_rd_progress_items`：一行对应tenant + E10销售订单行；主键UUIDv7，业务唯一键`(tenant_id, source_order_line_id)`，允许同订单重复ITEM。
- `pmc_rd_progress_sync_runs`：UUIDv7批次主键，保存模式、RUNNING/SUCCESS/FAILED、源时间、所有计数、水位、错误、源一致性标记；每租户最多一个RUNNING。
- 查询索引：有效行上的tenant+order_no/source_order_id/line_number、tenant+rd_status/order_date、tenant+item_code、tenant+division_id/customer_code、tenant+order_date；批次tenant+started_at DESC；RUNNING部分唯一索引。
- 两表均有tenant_id和RLS，所有读写显式tenant条件并在事务设置租户上下文。数量numeric(28,8)，源时间timestamp(6)，运行时间timestamptz；内容hash、version、审计、软失效。
- 保存订单原始ApproveStatus与CLOSE，不解释为关闭/作废规则，不默认过滤。
- migration：`1722920082000-PmcRdProgress`新建两表；`1722920083000-PmcRdProgressOrderCloseRaw`只给新快照表加CLOSE原始值列。没有修改已有业务表。

## 3. 正式状态Calculator

`PmcRdProgressCalculator`集中计算全部七种状态和Phase 3原reasonCode/reasonText，保持P+0、M+1、标准路线引用、BOM/路线唯一有效性和工序引用规则；未知组合、M+2等按Oracle异常处理。每次以当前事实重算，允许设计和路线完成状态倒退。

与Phase 3业务判断没有差异；新增的只是源订单信息、事业部映射、同步持久化、权限和查询。没有工艺BOM字段。rdLastModifiedAt使用Oracle定义的研发资料时间最大值，不取订单时间。

完成率使用精确Decimal；总体/设计分母排除研发不适用，路线分母另排除路线不适用/control=0；ABNORMAL未完成；分母0返回NULL。订单状态不采用百分比阈值。

## 4. FULL同步

正式Application Command执行成功：

| 指标 | 结果 |
|---|---:|
| sourceSnapshotAt（E10时间） | `2026-10-07 09:37:32.281503` |
| 源一致性标记 | `READ_COMMITTED_CAPTURE` |
| 订单 | 2544 |
| rowsRead | 17644 |
| rowsCreated | 17644 |
| rowsUpdated | 0 |
| rowsUnchanged | 0 |
| rowsFailed / rowsDeactivated | 0 / 0 |
| abnormal | 6 |

捕获目录为私有`data/pmc-rd-validation/production-full/`。源时间来自SQL Server，不使用应用服务器时间；状态和数据写入完全由正式TypeScript Calculator/Application Command执行。

标准migrate完成两份迁移，正式库迁移80→82；API/Web部署和再次检查均为`5d2faa1`，STATUS=CONSISTENT。Web/API/Swagger/OpenAPI/PostgreSQL健康检查通过。正式备份在`data/backups/*_20261007_093425.*`，pg_restore目录验证通过；三个SHA256记录于`data/pmc-rd-validation/migration-final.log`。没有修改E10，没有运行seed，没有发企业微信。

## 5. INCREMENTAL同步

水位：`{snapshotAt, sources: {表名: {at: 六位微秒时间文本, id: 稳定UUID}}}`，以源SQL Server时间为截止，保留2分钟重叠，各表keyset批量扫描。整批成功才推进水位，250行一块UPSERT，hash相同不UPDATE；事务和审计整体回滚。

变更源：SALES_ORDER_DOC、SALES_ORDER_DOC_D、ITEM、ITEM_PLANT、BOM、BOM_D、ITEM_ROUTING、ITEM_ROUTING_D、OPERATION，及CUSTOMER、ADMIN_UNIT；额外处理现有客户主责事业部映射更新时间和BOM有效期边界。

先汇总affected ITEM/order/line，再一次性读事实和集中重算。任何路线变化反查所有`ITEM_PLANT.STANDARD_ROUTING_ID`消费者，不能只重算路线所属ITEM。候选行清单用于软失效，重新出现沿用原ID恢复。

真实执行结果：

| 调用 | sourceSnapshotAt | 读取 | 新增 | 更新 | 未变 | 失败 | 端到端秒 |
|---|---|---:|---:|---:|---:|---:|---:|
| CLI增量1 | 2026-10-07 09:38:26.942080 | 31 | 0 | 0 | 31 | 0 | 18.059 |
| CLI增量2 | 2026-10-07 09:38:58.619573 | 31 | 0 | 0 | 31 | 0 | 12.936 |
| 运行API增量 / HTTP 201 | 2026-10-07 09:39:21.889206 | 41 | 3 | 18 | 20 | 0 | 25.659 |

前两轮各自捕获事实/TS的逐行Oracle差异均0；同窗重算未产生重复或无效UPDATE。受影响集合第一/二轮为18201个源ITEM/5个直接受影响订单，实际候选重算31行（涉及13订单）；受影响集合包含全E10反向引用，不等于候选范围品项数。内部HTTP轮实际候选重算41行，直接影响8订单，捕获到自然生产新增和修改，没有人为修改E10测试数据。

后续在线查询：2545订单/17647行，状态变为NOT_STARTED=2998，其余状态数量与FULL相同。相较FULL多1订单/3行，属于源库自然新增；全量Oracle基准仍使用FULL时相同捕获事实。

逐行审计累积新增17647、更新18，成功批次4。当前事业部映射38行、无映射17609行；后者保留NULL与E10原部门，未强行猜映射。

## 6. API

前缀`/api/v1`，具体契约见`docs/pmc-rd-progress.md`。

| 方法/路径 | 返回/用途 |
|---|---|
| GET `/pmc/reports/rd-progress/items` | `{rows,total,page,pageSize}` |
| GET `/pmc/reports/rd-progress/items/:id` | 授权范围内单行 |
| GET `/pmc/reports/rd-progress/summary` | KPI、完成率、七状态数量 |
| GET `/pmc/reports/rd-progress/orders` | 分页订单级计数、完成率、orderRdStatus |
| GET `/pmc/reports/rd-progress/sync-status` | 最新批次，受限范围不返回全租户计数 |
| POST `/internal/pmc/rd-progress/sync` | token+tenant；FULL/INCREMENTAL，返回批次计数/水位 |
| GET `/table-exports/pmc-rd-progress` | 平台标准XLSX导出 |

权限遵循资源`pmc-rd-progress:*:read`与字段read，资源归属planning；导出需要独立export。普通用户没有同步入口，内部token和tenant严格校验。

参数：page/pageSize/orderNo/customer/division/itemCode/itemName/rdStatus/designBomStatus/routingStatus/orderStatus/orderClose/orderDateFrom/orderDateTo/onlyIncomplete，兼容标准search/filterGroup/sort。默认100，支持50/100/200/500/1000，上限1000。字段隐藏同时禁止相应筛选/排序/派生KPI，数据库层强制数据范围。


线上HTTP核验：匿名items/summary/orders均401；内部错误token及错误tenant均401；合法凭据缺mode为400；真实INCREMENTAL为201/SUCCESS。线上OpenAPI包含6条新路由。明细、详情、分页、未完成筛选、summary、orders、sync-status使用已部署QueryService在真实数据库核验成功。未取得普通用户登录会话，未单独执行携带普通用户JWT的成功GET；授权行为由单测和真实数据库权限/RLS集成覆盖，未绕过AuthGuard或伪造JWT。

## 7. 四个指定样本结果

| 订单 | 品号 | 正式PostgreSQL状态 | reasonCode |
|---|---|---|---|
| 2304-202610060005 | 601000110 | NOT_APPLICABLE | PURCHASE_ITEM_WITHOUT_ROUTING |
| 2301-2026C1101-B061 | ABL370CC0C375-1/1 | NOT_STARTED | NO_BOM |
| 2307-260930008 | RXA500J-V5-1/1 | WAITING_ROUTING | NO_ROUTING |
| 2307-260930008 | RXA505F-HLLV5-1/1 | COMPLETE | RD_COMPLETE |

四项均符合Phase 3；真实增量后再次查询仍一致。额外12个Phase 3真实品项也全部一致：

| 订单 | 品号 | 状态 | reasonCode |
|---|---|---|---|
| 2301-2025A012020 | 401031194 | NOT_APPLICABLE | PURCHASE_ITEM_WITHOUT_ROUTING |
| 2301-2025A012020 | 401040193 | NOT_APPLICABLE | PURCHASE_ITEM_WITHOUT_ROUTING |
| 2301-2021C001064 | VMA327G(9049ZA504888A00)-1/1 | NOT_STARTED | NO_BOM |
| 2301-2023A027018 | MJCOP014125 | NOT_STARTED | NO_BOM |
| 2301-2025A012008-7 | UMPI385-01-516F-1/1 | WAITING_ROUTING | NO_ROUTING |
| 2301-2025A012008-7 | UMPI385-01-524F-1/1 | WAITING_ROUTING | NO_ROUTING |
| 2301-2026A009022 | ROSS122-1/1 | ROUTING_IN_PROGRESS | ROUTING_NOT_APPROVED |
| 2301-2026A071017 | A23-1/1 | ROUTING_IN_PROGRESS | ROUTING_NOT_APPROVED |
| 2301-2021C001064 | C00138B-1/1 | COMPLETE | RD_COMPLETE |
| 2301-2021C001064 | VMA084A-1/1 | COMPLETE | RD_COMPLETE |
| 2304-202607090004 | 304010515 | ABNORMAL | UNSUPPORTED_ITEM_RULE_COMBINATION |
| 2304-202609010012 | 301010304 | ABNORMAL | UNSUPPORTED_ITEM_RULE_COMBINATION |

当前真实数据没有DESIGN_IN_PROGRESS；未伪造生产数据，BOM未审核/无有效明细等逻辑由共享fixtures和状态倒退集成验证。

## 8. Python probe与正式实现全量对比

相同捕获事实：sourceSnapshotAt=`2026-10-07 09:37:32.281503`，订单2544，品项17644。两份对照报告均为differenceCount=0；逐行比较20个关键业务字段（组件/最终状态、reason、BOM/路线选择、有效数、研发更新时间等），不是只对比百分比。

| 状态 | Python Oracle | TypeScript | PostgreSQL |
|---|---:|---:|---:|
| NOT_APPLICABLE | 835 | 835 | 835 |
| NOT_STARTED | 2995 | 2995 | 2995 |
| DESIGN_IN_PROGRESS | 0 | 0 | 0 |
| WAITING_ROUTING | 2722 | 2722 | 2722 |
| ROUTING_IN_PROGRESS | 4 | 4 | 4 |
| COMPLETE | 11082 | 11082 | 11082 |
| ABNORMAL | 6 | 6 | 6 |

| 合计 | 17644 | 17644 | 17644 |

完整证据：私有`production-full/oracle-typescript.json`、`production-full/oracle-postgresql.json`及捕获事实/实际查询文件。原Phase 3时点2511订单/17462行与本轮不同，源库正常变化；不混合两时点统计。

本轮FULL KPI：适用16809、不适用835、完成11082、未完成5727、异常6；总体65.93%，设计BOM82.15%（13808/16809），路线66.33%（11149/16808）。

## 9. 测试结果

- 最终API全量：686 passed，1 skipped；84 suites通过，1 suite skipped。
- PMC专项：5 suites / 68 tests通过。
- Python：34项通过，含Phase 3原27项、共享37组fixtures。
- Contracts：22项通过。
- Web：28 files / 181 tests全通过（单worker，运行时15秒超时；未改业务断言）。
- API/Contracts/Web typecheck、lint、build通过；Node24生产镜像构建成功。Web既有Fast Refresh/chunk提示保留。
- 真PostgreSQL隔离集成PASS：migration、17625行FULL重放、源行唯一性/重复ITEM、增量、BOM/路线倒退、第二分块失败事务回滚/水位不推进、软失效/恢复、分页/过滤/明细/汇总/订单、字段/表权限、CUSTOM/OWN范围、A/B租户和真实非owner RLS。
- 首轮API/Web既有5秒测试超时已在单进程/单worker15秒设置下完整复核通过；没有修改无关业务代码或断言。

## 10. 性能

| 场景 | 环境 | E10读取秒 | 端到端秒 | 写入 |
|---|---|---:|---:|---|
| FULL | 正式CLI | 15.775 | 25.876 | 新增17644 |
| 无内容变化INCREMENTAL 1 | 正式CLI | 17.857 | 18.059 | 31行全未变，0 UPDATE |
| 无内容变化INCREMENTAL 2 | 正式CLI | 12.745 | 12.936 | 31行全未变，0 UPDATE |
| 少量变化INCREMENTAL | 运行API HTTP | 未单独计时 | 25.659 | 新增3/更新18/未变20 |
| 无变化/3行变化写入 | 隔离PostgreSQL、捕获事实 | 不含E10 | 0.136 / 0.181 | 0 / 3 UPDATE |

增量主要耗时在源库读取与反向引用，不在逐行写入；所有源资料按批量读取，UPSERT每250行，不执行每行多条SQL。生产EXPLAIN使用订单、状态、品号三个索引，分别0.132/0.163/0.300ms（当前1.76万行数据，不能外推为任意规模）。隔离完整集成12.184秒，包含多个同步和安全场景，不能视为生产FULL耗时。

## 11. 当前仍存在的业务待确认项

1. 事业部：已复用PMC客户主责事业部映射，无映射NULL并保留Owner_Dept；Phase 5确认默认展示。
2. 关闭/作废订单：保留全部候选，保存ApproveStatus/CLOSE原始值；Phase 5决定默认过滤。
3. P+1/M+0：继续ABNORMAL/UNSUPPORTED_ITEM_RULE_COMBINATION，不能猜规则。
4. ApproveStatus=V：只表示不满足当前已审核/有效条件，未翻译为作废。

源库未启用事务SNAPSHOT，RCSI只保证单语句读取一致性；sourceSnapshotAt是源观察/水位截止时间，sourceConsistency=READ_COMMITTED_CAPTURE。回归严格使用同一捕获事实，不能声称多查询具备历史冻结语义。未变行保留上次内容观察/入库时间；最新观察由同步批次表示。无修改审计的BOM/路线物理删除需人工FULL校正，尚未新增调度或历史表。

## 12. Phase 4 PASS / FAIL

**PASS。** 完成用户规定的22项验收门槛：两表和迁移、TS规则迁移、FULL/INCREMENTAL、BOM/路线/标准路线复用重算、状态倒退和幂等、查询/KPI/订单API、权限/tenant、单元及真数据库集成、四指定及额外样本、同事实全量Oracle0差异、git diff --check、进度更新。

当前运行环境已部署，不是仅本地代码完成；备份、健康检查和版本一致检查已通过。仅保留报告/进度的outputs修改，源码全部提交；未push。隔离库`pmc_rd_phase4_test_20261007`已删除，仅清除本任务自己的临时测试库；没有删除业务数据库或旧业务数据。

新增源读取器通过共享MSSQLDatabase/Python只读驱动传输原始事实；生产API/同步不调用Python probe/Oracle，状态判断与写入在TypeScript服务。没有新增React页面、调度基础设施或工艺BOM模型。

## 13. 是否建议进入Phase 5

建议进入“PMC → 报表 → 研发进度”正式页面。页面采用既有PMC树形菜单、标准只读表格、平台筛选/导出；先确认上述业务默认展示，再开发页面，不重做数据模型和Calculator。
