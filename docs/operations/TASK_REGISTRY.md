# KDOS 自动化任务台账 / TASK REGISTRY

更新时间：2026-10-14。证据：(1) GitHub `company_digital` 主分支文件盘点；(2) 用户在生产 Ubuntu 主机运行 `bash scripts/audit-schedulers.sh` 的输出，采样时间 `2026-10-13T13:18:08+08:00`，主机时区 `Asia/Shanghai`。**已核实 systemd 列表、部分 cron 数量、Docker 容器运行状态；尚未读取 n8n 内部工作流、完整系统 cron 与业务执行成功日志。** 列表中的 `LAST` 是 Timer 最近触发时间，不等于脚本成功。

## 统一归属

- systemd / Docker：基础设施、守护进程、独立灾备、证书、系统维护。
- n8n：业务定时、跨应用集成、数据同步、计划报表、定时推送。
- KDOS Application / Worker：持久化事件消费、业务事务、outbox、实时/高频处理；当 Worker 尚未实现时保留经验证的现有消费者。
- 一次性任务：只手工调用；禁止仅因有脚本就安装定时器。
- 迁移门禁：必须实测旧/new 的实际状态、验证新运行、受控停用旧调度、补偿/回滚、台账更新。禁止双重自动调度。所有业务日期使用 Asia/Shanghai。

## 仓库侧计数（不是生产启用量）

| 分类 | 数量 | 说明 |
| --- | ---: | --- |
| systemd Timer 模板 | 4 | 财务1、企业微信通讯录1、ERP staging 模板1、ERP projection 模板1 |
| Timer 候选实例 | 8 | 财务1、通讯录1、staging按三来源3、projection按三消费者3；已核实这8个用户级 Timer 均 enabled 并有下次执行时间 |
| 常驻 Dispatcher 的 systemd Service | 1 | 不属于定时任务 |
| systemd Service 文件 | 6 | 财务1、通讯录2、ERP staging/projection 模板2、常驻 Dispatcher1；不是6个实际启用服务 |
| n8n 工作流已登记数 | 14 | `n8n list:workflow` 实际列出14个：**10个已激活、4个未激活**；未标记非KDOS的4个中3个已激活，1个未激活 |
| 当前用户 crontab 条目 | 1 | 审计脚本统计到1条非注释项；命令内容未查看，其他用户及系统 cron 仍需审计 |
| 应用内部 scheduler | 未核实 | 需运行时和代码额外审计 |

**注：仓库共有6个 `.service` 文件**（财务1、通讯录2、ERP staging1、ERP projection1、Dispatcher1）。Template 与启用实例要分开统计。

### 生产调度快照（只读）

| 分类 | 本次实测数量 | 证据 / 限制 |
| --- | ---: | --- |
| 系统级 systemd Timer 列表项 | 22 | `systemctl list-timers --all`；含未安排下一次执行的条目，不等同于22个启用任务 |
| 当前用户 systemd Timer 列表项 | 10 | 其中 KDOS 8 个，另有 firmware notifier 和 launchpadlib cache clean |
| KDOS 用户级 Timer 已启用 | 8 | 每个 `is-enabled=enabled`，且 `list-timers` 显示 NEXT、LAST |
| DWG 索引系统级 Timer | 1 | `dwg-index-update.timer` 已启用，最近一次定时触发 `2026-10-13 00:10:09 CST`；不代表成功 |
| 当前用户 crontab 非注释项 | 1 | 内容未查看；系统及其他用户 cron 未完整核查 |
| n8n Docker 容器 | 1 | `n8n_sqlite` 正在运行；已从 CLI 确认14个工作流中10个 `active=true` |
| KDOS Compose 容器 | 4 | `knplan-web-1`、`knplan-api-1`、`knplan-postgres-1`、`knplan-document-worker-1` 全部显示 healthy |
| 系统级其他任务 | 有 | 包括 `assistant-memory-auto.timer`、certbot、apt、logrotate、sysstat 等；归类系统管理，不擅自迁入 n8n |

**用户业务确认（2026-10-13）**：目前全部现有任务按业务用途判断**不存在需要处理的重复任务**，保留各自调度，不再以“疑似重复”为由要求停用、合并或迁移。技术事实仍需如实记录：n8n 已激活工作流 `cfxCKnLl0YqRZYDj` 每天 01:00 调用 `sync-kejia-orders.sh`（依次执行科加 staging 采集与 `sales-orders-v1` 投影）；用户级 systemd Timer 每30分钟调用 `sync.py run --source tplus-kejia`。两者有共用的采集代码、复用 `/tmp/kdos-erp-order-sync-tplus-kejia.lock` 防并发，但不能因此直接认定业务任务重复或数据重复。此情况作为“已知共享执行入口、用户接受当前分工”登记，后续只有在出现运行异常、业务变更或用户要求时才重新评估。

**重点偏差**：`ERP-004/005/006` 投影 Timer 在生产已启用并于 `2026-10-13 13:05 CST` 触发；此前文档写“默认禁用”，与当前运行状态不一致。按用户决定不调整现有任务。**后续常规盘点**：服务器 `crontab` 的1条任务用途、财务同步 01:00 正式执行、n8n工作流状态；不再以“排查任务重复”为单独推进目标。

## 已识别任务

| 任务 ID | 业务 / 调用入口 | 仓库中发现的触发定义 | 建议唯一归属 | 生产状态 | 后续动作 |
| --- | --- | --- | --- | --- | --- |
| FIN-001 | 财务E10客户同步；`automation/finance_customer_sync/main.py` | `kdos-finance-customer-sync.timer` 每天01:00 | n8n | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 优先迁移；138条初始客户保留；只增不覆盖分类 |
| IAM-001 | 企业微信通讯录；`automation/wecom_sync/main.py sync` | `kdos-wecom-contact-sync.timer` 每天03:00并开机后运行 | n8n | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 先验证备份、停用账号动作和漏跑补偿 |
| ERP-001 | E10 staging，来源`e10-main` | `kdos-erp-order-sync@.timer` 每30分钟 | n8n（后续） | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 核查来源游标、运行时间及重复入口 |
| ERP-002 | T+凯南 staging，来源`tplus-kainan` | 同一 Timer 模板每30分钟 | n8n（后续） | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 独立来源、锁和失败处理 |
| ERP-003 | T+科加 staging，来源`tplus-kejia`；另有`sync-kejia-orders.sh` | systemd 每30分钟；激活的 n8n `cfxCKnLl0YqRZYDj` 每天01:00 调用复合脚本 | **现状保留（用户认定业务任务不重复）** | TWO_TRIGGERS_KNOWN / SYSTEMD_RUN_SUCCESS / N8N_RUN_UNVERIFIED | 技术上共享 staging 采集代码和 flock；n8n 额外执行 `sales-orders-v1` 投影。按用户业务判断不做合并、停用或迁移 |
| ERP-004 | `sales-orders-v1` 投影消费者 | `kdos-erp-projection@.timer` 每30分钟05/35 | 已验证消费者 / 后续 KDOS Worker | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 先确认准入、启用状态和业务验收 |
| ERP-005 | `finished-goods-inbound-v1` 投影消费者 | 同一 Timer 模板 | 已验证消费者 / 后续 KDOS Worker | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 已启用，先查真实运行结果与投影准入 |
| ERP-006 | `finished-goods-outbound-v1` 投影消费者 | 同一 Timer 模板 | 已验证消费者 / 后续 KDOS Worker | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 已启用，先查真实运行结果与投影准入 |
| RD-001 | E10研发物料；`data-operations/rd-sync/sync-rd-items.sh` | 仓库有受控脚本；既有 n8n SSH 方案 | n8n | UNVERIFIED_RUNTIME | 验证工作流 ID/启用及最近成功 |
| EQ-001 | 设备治理日报；`equipment-governance-daily/report.py` | README提供 n8n SSH 命令；无本仓库 Timer | n8n | UNVERIFIED_RUNTIME | 检查是否正式激活、正式发送权限 |
| MSG-001 | 企业微信 Dispatcher；`dispatcher.py` | 常驻 systemd Service，轮询约1秒 | systemd Service | UNVERIFIED_RUNTIME | 保留常驻，不迁 n8n |
| OPS-001 | PostgreSQL 与上传文件备份；`scripts/backup.sh` | 只确认脚本，未发现仓库定时器 | systemd Timer | UNVERIFIED_RUNTIME | 核实生产备份策略、日志与恢复测试 |
| OPS-002 | DWG本地索引 | 本仓库未发现定义；主机存在 `dwg-index-update.timer` | systemd Timer | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 已核实系统级启用，查作业日志及任务归属 |
| SUP-001 | T+供应商导入；`automation/tplus_supplier_import/extract.py` | 脚本存在、仓库未确认周期触发 | n8n（若周期化） | UNVERIFIED_RUNTIME | 不自行激活 |
| MPS-001 | 主计划 E10研发进度；`data-operations/e10/run-pmc-rd-progress-sync.cjs` | 有脚本，未确认调度 | n8n（若周期化） | UNVERIFIED_RUNTIME | 不自行激活 |
| TPLUS-001 | T+销售接单明细；`data-operations/tplus/sync.mjs` | 有脚本，未确认调度 | n8n（若周期化） | UNVERIFIED_RUNTIME | 核查是否与 ERP staging 重叠 |


## n8n 工作流实测清单（2026-10-13，已核实激活状态）

数据来源：用户执行 `docker exec -u node n8n_sqlite n8n list:workflow`。结合 `n8n list:workflow --active=true` 核对实际激活标记；仍不包含节点命令、计划时区或执行结果；“非KDOS”直接沿用用户标注，不自行推断。

| Workflow ID | 名称 | 归属判断 | 待核查 |
| --- | --- | --- | --- |
| `TT8raJ9ndXSOnTwb` | 异常费用_周五_8点 | 用户标注非KDOS | 已激活（CLI确认）；保持隔离，不擅动 |
| `KvAkxw9G7cQB04Ml` | smth_每天_0:01 | 用户标注非KDOS | 未激活（CLI筛选未列出）；保持隔离，不擅动 |
| `G4vti33loChqw1Oy` | 每天凌晨0点1分-续跑smth项目 | 用户标注非KDOS | 未激活（CLI筛选未列出）；保持隔离，不擅动 |
| `dcIZAGhW34czEKtK` | 采购部_每天_8:05 | 用户标注非KDOS | 已激活（CLI确认）；保持隔离，不擅动 |
| `HkvXfT4TRmkfUFoa` | tushare_每天_1:00 | 用户标注非KDOS | 已激活（CLI确认）；保持隔离，不擅动 |
| `60KpNF39jSxZWpOR` | realtimesnap_每天_9:00 | 用户标注非KDOS | 已激活（CLI确认）；保持隔离，不擅动 |
| `1IJnZF1gohWpW0Bo` | 接单入库_每天_8:10 | 待确认KDOS归属 | 已激活（CLI确认）；核实激活状态、入口/目标 |
| `hBJ6rXRYNL30G2cs` | 资金流快照_每天_9:25 | 用户标注非KDOS | 已激活（CLI确认）；保持隔离，不擅动 |
| `xpFmPPrX82dDyESJ` | SalesKpiReport_每天_7:00 | 用户标注非KDOS | 已激活（CLI确认）；保持隔离，不擅动 |
| `IgBzE4MX0OZppDoO` | Database_每天_2点 | 待确认KDOS归属 | 未激活（CLI筛选未列出）；是否备份、覆盖哪些数据库 |
| `JM2rgvwgbY06U86C` | 采购部_每天_16:55 | 用户标注非KDOS | 已激活（CLI确认）；保持隔离，不擅动 |
| `e0dwMjv9OnWmcESk` | 设备管理上线进度 | 用户标注非KDOS | 未激活（CLI筛选未列出）；保持隔离，不擅动 |
| `cfxCKnLl0YqRZYDj` | 同步科加数据_每天_1:00 | KDOS 科加订单同步，已按执行脚本确认 | 已激活；Schedule Trigger 01:00 → SSH `data-operations/order-sync/sync-kejia-orders.sh`；与ERP-003共享同步入口且该脚本额外执行 `sales-orders-v1` 投影 |
| `ZaJp5jyD96075thE` | 同步品项_每天_00:05 | 待确认KDOS归属 | 已激活（CLI确认）；是否关联研发物料；与历史00:10描述不一致 |

**合计**：14个已登记工作流、10个已激活、4个未激活。10个用户标注非KDOS中有7个激活、3个未激活；4个归属待查中有3个激活（接单入库、同步科加、同步品项）、1个未激活（Database）。**后续按需**只读核查3个激活候选的节点调用链路、计划时区与最近执行；用户已确认现有任务按业务用途不存在需要处理的重复，暂不因共用采集代码而推动合并。避免输出 SSH Credential 或 SQL 密钥。


### 科加订单 systemd 最近执行结果（2026-10-13 13:00/13:05 CST）

用户在生产服务器执行 `systemctl --user show ... -p Id -p Result -p ExecMainStatus -p ExecMainExitTimestamp`：

| Service | 退出时间（Asia/Shanghai） | systemd Result | ExecMainStatus | 结论 |
| --- | --- | --- | --- | --- |
| `kdos-erp-order-sync@tplus-kejia.service` | `2026-10-13 13:00:11` | `success` | `0` | 任务进程正常退出，不表示同步记录数已验证 |
| `kdos-erp-projection@sales-orders-v1.service` | `2026-10-13 13:05:00` | `success` | `0` | 任务进程正常退出，不表示投影记录数已验证 |

**待核查**：n8n `cfxCKnLl0YqRZYDj` 在 2026-10-13 01:00 的实际执行状态、SSH 节点输出和本次处理记录数。由于 `sync-kejia-orders.sh` 在锁竞争时输出 `already_running` 并以退出码0结束，n8n 显示“成功”也可能意味着没有实际采集。用户已明确按业务用途认定现有任务不重复，暂不因这项未核验而要求停用、合并任务；也不能据此虚报实际采集记录数。

## 运行时核查要求

主机脚本 `scripts/audit-schedulers.sh` 已在 2026-10-13 13:18 CST 执行（只读），systemd 和当前用户 cron **数量**已采集。下一步：只读审计 n8n 已激活工作流、时区、最近执行及 SSH 目标；在不泄露密钥的前提下确认用户 crontab 的任务类型；查看8个 KDOS Timer 对应 Service 的退出状态与最近成功时间；确认常驻 Dispatcher、备份、内部消费者；逐一登记 `active/enabled/next/last/result`。未核实项继续保留 UNVERIFIED_RUNTIME；在完成实际链路和风险评估前，不停用任何生产调度。

项目规范：`.agents/skills/kdos-task-orchestration/SKILL.md`。


## FIN-002 财务E10销售订单统计（显式手动命令）

- 范围：订单日期自2025-01-01起；`FinanceOrdersApplicationService.refresh` → `integrations/e10/finance-order.reader.ts` → `data-operations/e10/finance_order_reader.py` → Finance Application发布。
- 调度归属：用户在系统导出页手动触发；**无自动周期入口**，未新增Timer/cron/n8n Workflow，原FIN-001及ERP/PMC全部任务保持原状。
- 身份/安全：可信用户关联、财务完整源字段及全部范围的read/update授权；basic_code持有源凭据、READ COMMITTED、E10只读、目标租户RLS。
- 防并发/幂等：同租户唯一RUNNING+advisory lock；账套/源品项UUID唯一键；未变化版本/逐行审计不增长；源分页断点与成功后水位。
- 失败/补偿：批次失败摘要、原发布数据保留；异常日志/断点继续或全量重试；无自动外发通知，页面显式查看失败。服务重启标失败，持久断点保留。
- 回滚：保留财务读模型/审计，回退应用镜像；不删除旧业务数据。
- 验证：2026-10-14，隔离真实PostgreSQL/合成fixture；生产状态以本机验收报告为准，不在公共Git仓库存放真实财务数量/金额或明细。
- 2026-10-14日期口径修订：仅91号派生视图迁移改订单级日期MIN，源品项/金额/数量不变；无需运行采集或增加任何周期入口。
- 2026-10-19指定结束修复：只读Reader新增内部订单头headerCloseCode；94号视图迁移统一排除头码1，原始34列/审核范围保留。2025+历史通过原显式FULL Application Command重新读取，状态变化继续由原增量重读整单；不新增自动入口，不调整FIN-001/ERP/systemd/n8n。当前源码/生产发布状态以本轮进度和受限验收为准。
- 2026-10-19用户澄清：96号视图按头码1整单排除、交货计划码1仅排除关联品项后重新汇总；Reader保留内部hasSpecifiedCloseSchedule。正式手动FULL补齐标志，失败旧页原子拒绝；无新增调度，不读用友T+，原始品项/审核/授权/同步flags保留。
- 仓库调度定义/候选数量未增加。负责人：财务中心/系统维护人员。

## MPS-002 Order allocation change notifications (event driven)

- Entry: MasterPlan Application create/update/batch/import-confirm → transactional `mps.order_allocation.batch_changed` → existing Notification Outbox/API claim → existing MSG-001 user systemd Dispatcher.
- Trigger: committed nonmoney changes only, once per operation batch; no timer, cron, n8n workflow or application scheduler is added. ERP staging/projection and all existing jobs retain their confirmed schedules.
- Rule/configuration: canonical PMC allocation rule, initially disabled; dedicated PMC operations configuration. Switch and message center share the same rule state. No disabled-period backfill. Unit and exact-name salesperson routing is tenant scoped and user-ID deduplicated.
- Identity: authorized actor, frozen allowlisted snapshots, tenant RLS; private per-user XLSX parts. Dispatcher only polls HTTP and calls the shared default-application WeChatPusher. It does not read SQL or resolve business recipients.
- Concurrency/idempotency: outbox lease/SKIP LOCKED, batch dedup, recipient/component attempt index, immutable attachments, latest-component completion and private provider-success receipts. Business transaction rollback emits nothing. A failed file never resubmits orders or resends successful text.
- Failure/compensation: existing delivery logs and administrator retry, backoff for provider failure, explicit routing errors (never SENT), media re-upload from the same saved XLSX. Corrected routing can be reevaluated by an explicit failed-message retry.
- Backup/rollback: existing database and uploads backup; retain configuration/snapshots/delivery evidence, roll back application/Dispatcher release without dropping retained data. No source credentials copied.
- Runtime verification (2026-10-14): standard all/check succeeded; API/Web/document worker and retained PostgreSQL healthy; existing user MSG-001 runs the SHA-named release with the original environment and one-second polling. One explicitly approved employee received provider-accepted text and a real XLSX through separate SENT component logs (errcode 0). User receipt/open confirmation is recorded separately in the local report. Official rule remains disabled; production import awaits the user in the preview page. No new timer/cron/n8n/internal schedule was installed. Existing business-table and old-rule baseline digests remained unchanged.
- Attachment naming revision (2026-10-14): Chinese allocation prefix, frozen Shanghai timestamp and identity label; second worksheet renamed 变更订单. UTF8 download/Dispatcher compatibility only; existing trigger/routing/consumer/schedules retained. Official rule kept disabled for this rollout. No additional scheduler or monitoring task.
- Owner: PMC / system maintenance. Verification: 2026-10-14; isolated PostgreSQL18 real workbook replay, component retry, actual provider file delivery, API/Dispatcher regression and production health. Detailed business counts and provider IDs stay in the private local acceptance report.

## MPS-003 Existing master-plan scheduler (allocation projection suspended)

- `MasterPlanSyncService.runDue` remains the existing NestJS `@Interval(60000)` checker and reconciliation-outbox consumer. Five existing configurations remain enabled at 30 minutes: `erp-orders`, `shipping-to-base`, `base-to-weekly`, `inbound-allocation`, `execution-rollup`.
- Latest explicit user policy (2026-10-14): allocations use manual/Excel commands only, and their downstream `plan-projections` is suspended. Its production configuration was disabled via the versioned/audited API. Allocation/customer-map commands no longer enqueue this job, all scheduled/manual/event/replay run entrypoints return skipped, and retained pending events are excluded from the consumer. No automatic allocation or monthly/group-plan writes occur on these paths.
- The old RUNNING/last-start state (2026-09-29) remains historical evidence; it is not proof of an active query. Neither those history fields nor unrelated ERP/systemd/n8n/cron jobs are reset or migrated.
- New schedule definitions/candidate instances added: zero. Rollback must retain the manual-only allocation and suspended reconciliation policies; reactivation needs a separate user request and implementation review.

- Allocation source policy (2026-10-14): per the explicit user request, `plan-projections` no longer creates or updates `mps_order_allocations` from ERP. Only authorized manual create/update and confirmed Excel imports maintain this table. ERP raw staging and the existing downstream reconciliation entries, schedules and retained historical rows remain in place. Rollback must retain this source restriction.

- Subsequent user instruction (2026-10-14) supersedes the retained downstream behavior above: order-allocation/customer-map commands no longer enqueue `plan-projections`, and its scheduled/manual/event/replay entry returns skipped without plan writes. Existing pending events cannot update plans. Historical allocations/plans are retained; unrelated ERP staging and shipping/execution schedules are unchanged. Do not reenable downstream reconciliation during rollback.

- Append-batch revision: migration 93 adds batch/row lineage, retires the allocation-only legacy quantity field and replaces the monthly allocation business FK with a stable record-ID FK. No new scheduler. Production plan-projections is explicitly disabled via the existing audited configuration API under the user's cancellation request; five other MPS sync configurations retain their enabled states and intervals.

- Mapping repair (2026-10-15): supply-chain/procurement configuration restored through the versioned audited API after read-only diagnosis. Initial seed failures and disabled/invalid mappings are visible; organization choices use existing enabled directory IDs, without creating organizations. No notification trigger, dispatcher, schedule or official-rule state changes; allocation append batches and suspended downstream reconciliation remain in force.

- MPS process-routing v1 (2026-10-23): Existing `runDue`/outbox checker and sync configuration were not rescheduled or duplicated. Read-only runtime check found `erp-orders`, `shipping-to-base`, `base-to-weekly`, `inbound-allocation`, and `execution-rollup` enabled at 30 minutes; `plan-projections` remains disabled at 30 minutes. The host's existing ERP Timer instances and other jobs remain untouched. `base-to-weekly` now snapshots route/cycle settings only when it creates a weekly plan; existing weeks require preview + explicit confirmation and become immutable after the first positive report. Quantity synchronization and execution rollup remain on the existing entrypoints. This delivery adds no scheduler, timer, cron, n8n workflow, or internal interval. Production writes are not used as synthetic acceptance data; deployment evidence and health/build SHA are recorded with this change.
- MPS weekly process refresh (2026-10-23): No scheduler or interval changes. Existing base-to-weekly sync continues to create snapshots for new weeks; existing unstarted weeks can be batch-previewed and batch-confirmed from the selected weekly-plan records, with update/skip counts and main process diffs. Started plans are skipped based on the durable lock/positive-report guard. The same sync now recalculates only due_date from the saved process snapshot when latest review due date changes; a dedicated DB write mode rejects any accompanying structure/cycle/order change, including on locked plans. Process completion rollup remains based on latest planned quantity. No schedule definition or runtime configuration changed.

- 2026-10-15：按用户明确选择，一次性归档清空订单分配当前页面并保留历史计划。Migration94／Application管理员命令；无新增定时器、无通知事件或下游对账。现有调度及正式通知配置保持执行前真实值；08:53:51已有配置操作将正式规则设为ON/version4，本次归档未更改或发消息。生产执行和备份证据见outputs/PMC_ALLOCATION_CLEAR_ACCEPTANCE.md。

## FIN-003 财务订单金额变更台账增量

- 用户授权：2026-10-19，正式开发、历史初始化、持续增量、迁移/备份/部署；明确取消历史完整性核验/评分/页面，不因历史缺失阻止发布。业务口径已确认：接单计算基数＋当月可确定变更，按当前客户事业部分类。
- 当前自动入口（2026-10-21用户要求每日一次）：由FIN-004的n8n `KDOSFinanceMonthlySummaryV1` 每日08:30统一编排 → `run-finance-daily.sh` → 原 `sync-finance-movements.sh INCREMENTAL` → Finance Application Commands。原FIN-003每小时07/37分的已发布版本已取消发布，当前手工草稿/节点保留；不新增Timer/cron或内部调度。历史频率及初始化记录如下保留。
- 代码调度定义/候选增量：新增1个n8n工作流；新增systemd/cron/常驻服务/内部scheduler均0。上线前只读实测：原14个工作流、10个激活、0个正在执行；原8个KDOS用户Timer和1条当前用户cron原样保留。生产激活、执行ID/状态及前后现有工作流摘要见受限本机 `data/finance-movements-release/`，不能仅凭入口脚本宣称任务已运行。
- E10只读，basic_code持有凭据，RMB本币精确Decimal/numeric；先通过未修改的FIN-002命令正常更新当前余额，再原子发布新增台账。只读Reader独立SQL，不改标准SQL、不读T+，原34列/9列/统计大屏及指定结束规则保留。
- 身份：仅现有启用的系统/财务模块管理员，服务端受控CLI查验真实管理员授权；不写死个人账号、不新增/扩大生产授权。表格read/export和CUSTOM范围独立受控，导出read∩export。
- 防并发：主机flock、租户RUNNING唯一约束和advisory lock；源账套/租户/稳定事件键幂等。审核节点一旦入账保留，重复审核必须有独立状态转移证据才再计；日志准备/头子金额不叠加，指定结束并改价只算一笔。
- 增量：成功水位＋2分钟重叠、日志跨月回看；较小变更单保留集重读，捕获源节点更新；未来快照对比只在月份可确定时入账，不补造未提供的历史事件。失败批次不推进水位、不发布部分台账；服务重启/超时标失败，可以安全重跑。
- 2026-10-22来源删除识别：现有每日08:30增量在同一E10只读连接中附带订单品项稳定UUID存在性清单（2025年至今生产实测约1.5秒），按年度独立计数、全局唯一性和安全降幅门禁核验后才更新`source_missing`。整单及单品项物理删除均保留原行、金额、UUID和审计，只从正常系统导出及有效统计排除；连接失败、超时、分页不全或计数不符整批拒绝。已缺失身份会在后续增量中定向重读，源端恢复时复用原KDOS行且不生成虚构金额事件。未新增n8n工作流、Timer、cron或应用内调度。
- 失败告警/补偿：CLI非0退出，n8n重试后显式校验退出码及SUCCESS，失败抛错保留失败执行；Web读取批次显示失败原因，管理员可增量/FULL补跑。无自动外发企业微信或邮件，原消息调度不改。
- 备份/回滚：发布前两库/uploads和n8n一致备份；暂停仅FIN-003新入口并回退应用，保留新表、快照、事件、审计；不删除原数据、不回退指定结束过滤或启用已暂停PMC投影。
- 验证：API、Web、Contracts、只读真实Reader、隔离PostgreSQL、Chrome E2E、权限/租户/Excel、重放/并发/失败补跑；真实财务明细、数量/金额和执行证据仅本机，不提交Git。模块说明：`docs/finance-order-movements.md`。负责人：财务中心/系统维护。

### FIN-003 / FIN-002 2026-10-20业务资格修正

- 入口/周期保持：既有n8n KDOSFinanceMovementsV1每小时07/37分；未新增、停用或迁移任何调度。2026-10-20只读确认该工作流处于active，n8n现有15个工作流中11个active（其余非本任务不调整）；本次代码调度候选增量0，实际新增启用逻辑任务0。
- Reader仅增加订单头单据类型/审核状态事实，仍通过basic_code只读E10；不读取T+、不改原始标准SQL。原34列保留，月度末尾追加备注为10列。
- Migration99仅创建/替换受tenant隔离的派生视图，材料销售单与非Y审核有效金额统一排除；事件/快照/原始品项保留，不补造冲回流水。旧快照缺资格属性不猜测，升级后通过既有FULL入口建立资格观测基线。
- 继续使用原防并发/审计/幂等/失败恢复。部署前两库/uploads及配置备份；只读金额对照、隔离PG、API/Web/Chrome、执行计划、原增量入口验收，真实金额/财务资料仅保留受限本机data目录。


## FIN-004 财务月度数据每日汇总（2026-10-20新增）

- 用户确认：每天08:30（Asia/Shanghai）推送当月订单数、金额及事业部分布；收件人由用户上线后在消息中心选择并启用。
- 当前唯一财务自动入口（2026-10-21）：n8n `KDOSFinanceMonthlySummaryV1`（KDOS 财务每日增量更新及月度汇总），Asia/Shanghai，`30 8 * * *` → 既有SSH凭据 → `run-finance-daily.sh` → FIN-003增量成功 → 原 `push-finance-monthly-summary.sh` → KDOS消息中心/原企业微信Dispatcher。汇总阶段不读取ERP，源更新仍由既有E10适配器完成；其他任务不变。
- 候选增量：n8n工作流1；systemd Timer/cron/常驻服务/应用内定时器均0。上线前实测15个既有工作流、11个active，未发现同职责入口；现有Dispatcher为active。完整脱敏主机盘点及n8n基线保存在受限 `data/finance-monthly-repair-release-20261020/`。
- 运行身份：既有启用系统/财务管理员；tenant固定取运行环境默认租户。读取正式月度视图，精确numeric/Decimal，不输出业务载荷到调度日志。
- 防并发/幂等：flock、租户/业务日事务锁、tenant+规则+上海日期唯一outbox键；停用/无规则不入队，原Dispatcher按接收人幂等投递与失败重试。
- 失败/补偿：SSH最多2次重试、非0及非SUCCESS使n8n执行失败；失败记录与消息中心可查，同日同入口补跑，不伪造跨日历史。初始化为停用规则，用户配置实际对象后启用；本任务不执行真实测试消息。
- 备份/回滚：两库/uploads及n8n一致备份；只停用新增FIN-004并回退应用，保留消息规则/审计/源快照。负责人：财务模块管理员。
- 生产核验（2026-10-20）：新增FIN-004已active，cron `30 8 * * *`、Asia/Shanghai；现16个工作流/12个active，原15个工作流及其11个active配置逐项一致。运行日志确认调度已注册；手工实跑1199 SUCCESS，实际停用规则导致NO_ENABLED_RULE/入队0，未发送消息。尚未观察下一次08:30定时触发，不将手工执行冒称定时已触发。
- 首次实跑1198因新节点认证类型与既有凭据不一致失败，已将新增节点改为password、复用原sshPassword引用，再发布/空闲重启并成功；未改凭据或既有工作流。首次失败记录保留。规则初始化两次created true/false，停用及版本保持。说明见 `docs/finance-monthly-notifications.md`。

### FIN-003 / FIN-004 订单月度发生额整合（2026-10-20）

月度页面、大屏、排名、Excel及FIN-004日报改读finance_e10_order_monthly_movements，按真实来源订单×发生月份聚合FIN-003现有事件；不重复入账，不新增同步/刷新任务。FIN-003和FIN-004原工作流、周期、时区、锁/幂等/告警及收件人设置保持；FIN-004业务规则继续停用等待用户自选接收人。生产迁移与最终验收结果记录在本轮发布报告；仅代码修改阶段不得视为已上线。详见docs/finance-order-monthly-movements.md。

2026-10-21生产验收：前向migration101完成，原品项/事件/授权及既有视图的同事务指纹不变；月度/大屏/排名/Excel/日报均已按发生月验证。现有16个n8n工作流、12active，全部定义摘要与执行前一致，本轮新增候选及自动入口均0。FIN-004于08:30实际定时执行1234 SUCCESS/trigger；规则仍停用，NO_ENABLED_RULE，未新增投递。大屏实测约3.3–3.5秒；真实Chrome月历、变更下钻和Excel下载通过。脱敏结果见outputs/FINANCE_ORDER_MONTHLY_ACCEPTANCE.md，财务证据仅限本机受限目录。

### MSG-001 / FIN-004 2026-10-21 消息规则维护修复

- 仅修复消息中心固定接收人编辑/回显、草稿/启用校验、版本冲突与状态切换保留配置；新增只读接收人校验接口不入队、不发送。
- FIN-004仍由既有n8n上海时间08:30触发，MSG-001仍为现有常驻Dispatcher；自动入口新增0，不修改任何周期或工作流。财务统计口径不变。
- PMC专属规则、接收人/事业部及供应商映射、文本、Excel和发送路径不调整；上线前后以受限本机摘要核对。验收使用隔离合成投递及受控浏览器，不发送真实测试通知；规则最终启停和接收人以用户保存配置为准。


### FIN-003 / FIN-004 2026-10-21 每日一次统一编排（当前生效）

- 授权：用户本轮明确要求每天一次增量及更新、由内置消息中心推送企业微信；取代此前保留每30分钟的安排，仅改变这两个财务工作流。
- 自动入口：原FIN-004 ID保留、改名“KDOS 财务每日增量更新及月度汇总”，每日08:30上海时间；SSH执行`bash /data/automation/code/work/PMC/knweb/data-operations/e10/run-finance-daily.sh`。先INCREMENTAL成功再汇总，失败短路，不发送旧数据；实际送达在更新成功之后。
- FIN-003：在线取消发布原每30分钟active版本，保留用户已编辑的3个手工节点/连接及版本不覆盖；需要时显式手工补跑。n8n未重启，其他运行任务不中断。
- 数量：仓库n8n模板仍1个（修改既有FIN-004定义，新增定义/候选0）；生产16工作流、11active，财务自动入口2→1；其余14个工作流定义/启停/发布版本逐项一致；新增/修改systemd Timer、cron、常驻服务及内部消费者0。
- 身份/锁/幂等：原SSH凭据与授权财务管理员、租户/增量水位/审计保留；新增主机日流程flock，子命令原flock/advisory锁保留；汇总仍按tenant+规则+上海业务日去重。无FULL、无新金额算法。
- 告警/补偿：n8n非0或非SUCCESS明确失败、保留错误执行，KDOS读取批次及消息中心保留失败原因；原SSH传输重试保留。手工重跑同一入口；投递失败仍由消息中心重试，不增加n8n企业微信节点或新通知渠道。
- 接收人：沿用用户已启用规则及保存对象/模板/版本，未修改任何通知规则或PMC配置。验证1240 SUCCESS，通过原SSH实际INCREMENTAL；验证专用`--update-only`不生成通知（入队0），正式发布命令不含该参数。
- 备份/回滚：095740两库/uploads与切换前n8n一致SQLite/两个规则的REST快照；使用各自原发布版本显式回滚，避免新旧入口并存；保留同步和通知审计，不回写覆盖数据库。
- 运行核验：已通过受权限/checksum保护的n8n在线API完成发布/取消发布，未用CLI改库后假称内存已刷新。下一次2026-10-22 08:30；尚未观察未来首次定时触发或宣称企业微信实际送达。负责人：财务管理员/系统维护。说明见docs/finance-monthly-notifications.md。

### FIN-004 / MSG-001 2026-10-21 每日财务Excel附件

- 授权及入口：用户明确要求每天08:30给财务的当月月度数据Excel，名称`YYYY年M月接单统计-生管.xlsx`，例如`2026年10月接单统计-生管.xlsx`。复用FIN-004唯一日流程和MSG-001消费者；n8n命令、08:30上海时间、更新阶段、接收人及金额口径不变。
- 权限与执行：按接收人实时IAM read/export/字段权限及read∩export范围生成固定月份文件，租户隔离、私有下载、权限指纹/SHA校验；text/file:1组件独立幂等重试。复用现有outbox/attachments/logs，无migration；不调整PMC业务。
- 数量及实际状态：新增仓库调度定义/候选0；只读核验生产16个n8n工作流、11active，所有工作流定义/启停/发布版本与本任务开始一致；systemd Timer/cron/常驻/内部调度修改0。本轮按正式发布流程更新原MSG-001消费者及API/Web，未新增消费者；实际版本及验收见附件验收报告。
- 权限门禁已按明确授权处理：原预设组不含export且仅9字段；用户明确授权仅补齐2名接收人。经正式Application API新建独立CUSTOM read/export组、15字段读取、2个USER，原ALL范围保留，无写权限，其他权限组逐项不变且有审计。实时IAM2/2 ready；生产回滚预览每人436行/15字段/金额一致、4个组成领取、0路由错误；回滚后outbox/attachments/log计数不增、未调用真实发送。
- 备份/验证/回滚：本机104210两库/uploads备份；API全套1119通过/33skip、财务附件隔离PG8项、PMC隔离PG20项、Dispatcher10项通过，具体结果见outputs/FINANCE_MONTHLY_ATTACHMENT_ACCEPTANCE.md。上线前更新备份；正式上线后通过回退应用及Dispatcher释放版本回滚，保留附件/投递历史，不恢复数据库覆盖后续业务。

- 本轮生产验收：2/2实际接收人授权有效、回滚预览每份436行/15字段/金额一致，原规则启用/版本8/配置不变，真实Chrome和私有下载保护通过，未真实群发测试。1名账号首次改密屏障保留，未冒称其月度UI已验收；其后端导出及附件权限已验证。正式SHA见outputs/FINANCE_MONTHLY_ATTACHMENT_ACCEPTANCE.md。

## KDOS-MPS-REVIEW-DUE-001 评审交期表第一期（无自动调度）

- 本期只安装空的评审交期当前/历史结构、只读资源及页面、内部领域/Application命令；不读取1139条源Excel、不首次或每日同步、不注册n8n/Timer/cron/应用内调度。
- 仓库新增调度定义/候选0，生产本任务新增自动入口/常驻消费者0。2026-10-21只读盘点现有n8n16工作流/11active，主机审计仅留受限证据；保持既有任务原状。
- 6项mps_sync_configs enabled标志原样保留（5true，plan-projections=false）；不得因建设本表停用现有报工或EVENT execution-rollup。
- 未来同步是第二阶段待用户单独授权的任务，须重新盘点/登记来源、身份、业务键冲突策略、来源批次幂等、防并发、告警/补偿/回滚。本期无可激活的同步入口。
- 结构/权限/测试/正式发布与人工验收状态见outputs/KDOS_MPS_REVIEW_DUE_DATE_SPEC.md及outputs/KDOS_MPS_REVIEW_DUE_DATE_ACCEPTANCE.md；最终仅WAITING_MANUAL_ACCEPTANCE，不能将代码或隔离测试记作已导入/已同步。

## 财务客户手工新增（2026-10-21，FIN-001保持）

- 新增一次性用户Application命令`POST /finance/customer-mappings/manual`，来源MANUAL；不是同步任务，不新增定时/常驻/内部消费者入口。
- FIN-001实测用户Timer enabled/active，01:00 Asia/Shanghai，下次2026-10-22 01:00，最近01:00 service Result=success/exit0；现有代码、账户、源日期窗口、锁、失败处理及调度均保持。
- 原E10 ingest冲突跳过，因此手工客户已存在时不覆盖人工分类、source或version；并发与重放在独立PG验证，不手工触发生产同步。
- 本项仓库新增调度定义/候选0，生产新增或迁移自动入口0；n8n只读盘点16定义/11active，保留原定义/启停/发布版本。其余主机scheduler审计留受限证据，不将模板数冒充新启用任务。
- 验证/迁移/正式版本见outputs/FINANCE_CUSTOMER_MANUAL_ACCEPTANCE.md；回退应用保留MANUAL来源及记录，不恢复旧CHECK丢弃手工客户，不擅自停用FIN-001。
