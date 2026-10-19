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

- 2026-10-15：按用户明确选择，一次性归档清空订单分配当前页面并保留历史计划。Migration94／Application管理员命令；无新增定时器、无通知事件或下游对账。现有调度及正式通知配置保持执行前真实值；08:53:51已有配置操作将正式规则设为ON/version4，本次归档未更改或发消息。生产执行和备份证据见outputs/PMC_ALLOCATION_CLEAR_ACCEPTANCE.md。
