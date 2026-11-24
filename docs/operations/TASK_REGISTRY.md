# KDOS 自动化任务台账 / TASK REGISTRY

## 当前有效状态及历史记录边界（2026-11-11主分支整合）

- 本轮仅在`integration/main-production-20261111`整合main与生产源码；不修改任务配置、调度、生产容器或数据库。
- 本轮执行前只读核实Web/API/Document Worker均为`9805baca4ed1053b72e3aef5b8c640cf09e83bbb`；下文44f61d3、ed81e55、28ab0eb等均是对应历史发布时点，不代表本轮当前版本。
- 生产已执行118/119/121/122/1722920122500/123/124/125/126/127；120未执行。123只提供既有结构，三级同步运行模块未上线，本轮不引入或启用。
- 124已解除旧评审申请与计划关联；125/126连续历史必须同时保留；127为BOM索引。六项原主计划同步继续原启用状态和30分钟配置，不因整合变更。
- main的设备日报全零保护、组织字段read和更正幂等修复与生产BOM索引任务记录均保留。BOM工作流“已发布待运行时验收”不能因本轮合并标记为定时验收通过；本轮未启动任务。
- 以下按原业务变更及发布时点保留历史证据；其中“当前/最终/未部署”仅指各历史章节记载当时的状态。最新运行判断优先本节及后续明确日期的核验记录。


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
| ERP-001 | E10 staging，来源`e10-main` | `kdos-erp-order-sync@.timer` 每30分钟 | n8n（后续） | TIMER_LAST_SUCCESS 2026-11-18 10:00 CST | 10:00五条流均完成；保留原调度，失败由运行预警覆盖 |
| ERP-002 | T+凯南 staging，来源`tplus-kainan` | 同一 Timer 模板每30分钟 | n8n（后续） | TIMER_LAST_SUCCESS 2026-11-18 10:00 CST | 10:00五条流均完成；保留原调度，失败由运行预警覆盖 |
| ERP-003 | T+科加 staging，来源`tplus-kejia`；另有`sync-kejia-orders.sh` | systemd 每30分钟；激活的 n8n `cfxCKnLl0YqRZYDj` 每天01:00 调用复合脚本 | **现状保留（用户认定业务任务不重复）** | TWO_TRIGGERS_KNOWN / TIMER_LAST_SUCCESS 2026-11-18 10:08 CST / N8N_LAST_SUCCESS 2026-11-18 01:00 CST | 10:00定时及10:08补偿运行均成功；技术上共享 staging 采集代码和 flock；n8n 额外执行 `sales-orders-v1` 投影。按用户业务判断不做合并、停用或迁移 |
| ERP-004 | `sales-orders-v1` 投影消费者 | `kdos-erp-projection@.timer` 每30分钟05/35 | 已验证消费者 / 后续 KDOS Worker | TIMER_ENABLED / LAST_SUCCESS 2026-11-18 10:05 CST | 10:05投影运行完成；保留原定时任务 |
| ERP-005 | `finished-goods-inbound-v1` 投影消费者 | 同一 Timer 模板 | 已验证消费者 / 后续 KDOS Worker | TIMER_ENABLED / LAST_SUCCESS 2026-11-18 10:08 CST | 10:05定时运行和10:08补偿投影均成功；保留原定时任务 |
| ERP-006 | `finished-goods-outbound-v1` 投影消费者 | 同一 Timer 模板 | 已验证消费者 / 后续 KDOS Worker | TIMER_ENABLED / LAST_SUCCESS 2026-11-18 10:05 CST | 10:05投影运行完成；保留原定时任务 |
| RD-001 | E10研发物料；`data-operations/rd-sync/sync-rd-items.sh` | 仓库有受控脚本；既有 n8n SSH 方案 | n8n | UNVERIFIED_RUNTIME | 验证工作流 ID/启用及最近成功 |
| EQ-001 | 设备运行/填报双日报；`equipment-governance-daily/report.py` | 复用e0dwMjv9OnWmcESk；12:00 Asia/Shanghai；正式名单11人，SSH双确认 | n8n | ACTIVE_VERIFIED（2026-11-04运行加载已核验） | 12:00执行旧版本的原因已查明；无运行任务窗口安全重启后加载个人+群新版，11人不发送预检PASS，下一次11月5日12:00；未提前补发 |
| MSG-001 | 企业微信 Dispatcher；`dispatcher.py` | 常驻 systemd user Service，约1秒轮询；现有 release `d0e7bbf` 支持 WECHAT_WORK 与按 API claim 返回的 WECHAT_GROUP_WEBHOOK 路由 | systemd Service | Dispatcher ACTIVE_VERIFIED（2026-11-04）；EQ-001新版本已加载 | 保留同一常驻服务；“设备管理群”收件人组含四个事业部设备群，`equipment.daily_report` 绑定该组；EQ-001新版保留11人个人发送并在个人成功后另提交幂等群日报。`equipment.status.fault_changed` 支持额外群路由，仍需在消息中心将该事件绑定到设备管理群；无群路由时仍走原个人规则。11月4日22时已在无运行任务窗口重启加载，17个工作流定义/13个激活及全部配置hash不变；日报群提交默认地址修正为现有15172端口。 |
| OPS-001 | PostgreSQL 与上传文件备份；`scripts/backup.sh` | 只确认脚本，未发现仓库定时器 | systemd Timer | UNVERIFIED_RUNTIME | 核实生产备份策略、日志与恢复测试 |
| OPS-002 | DWG本地索引 | 本仓库未发现定义；主机存在 `dwg-index-update.timer` | systemd Timer | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 已核实系统级启用，查作业日志及任务归属 |
| SUP-001 | T+供应商导入；`automation/tplus_supplier_import/extract.py` | 脚本存在、仓库未确认周期触发 | n8n（若周期化） | UNVERIFIED_RUNTIME | 不自行激活 |
| MPS-001 | 主计划 E10研发进度；`data-operations/e10/run-pmc-rd-progress-sync.cjs` | 有脚本，未确认调度 | n8n（若周期化） | UNVERIFIED_RUNTIME | 不自行激活 |
| TPLUS-001 | T+销售接单明细；`data-operations/tplus/sync.mjs` | 有脚本，未确认调度 | n8n（若周期化） | UNVERIFIED_RUNTIME | 核查是否与 ERP staging 重叠 |

### ERP-003 入库来源关联修复（2026-11-15）

- 保留原有科加 T+ staging 和 `finished-goods-inbound-v1` 投影任务、调度入口、游标与增量策略，不新增或停用任务。
- 收货明细的销售订单归属按现有 ERP 关联候选解析：有效销售订单明细、生产工单回指销售订单、源行销售订单代码；只有已解析订单中存在相同库存ID明细时才标记稳定关联。2026-11-18真实schema复核后更正：T+ `ST_RDRecord` 没有 `isCancel` 列；入库报表采用审核状态`189`并保留源数量正负号，仍严格按订单号+品号一致核验，不因品号相同单独归属。
- 当前投影未核验案例为失效销售订单明细ID，但源行有订单号/品号且生产工单可回溯同一订单；报表端按严格业务键核验该事实，不要求人工补填ERP源数据。2026-11-15已部署并通过版本一致性/健康检查；未执行源写入、重放、全量同步或游标变更。历史原始行的作废标记只由下次正常同步更新，不做追溯全量重放。

### ERP增量SQL恢复和失败预警（2026-11-18）

- `incremental_sql()`先前按第一个` WHERE `拆基础SQL；T+入/出库SELECT列内的`EXISTS(SELECT ... WHERE ...)`被误识别为外层WHERE，截掉FROM/JOIN并触发SQL Server ORDER BY子查询错误。现用括号/字符串/标识符感知的顶层WHERE扫描，排序仍按修改时间＋来源主键，保留原分页游标。
- 科加和凯南真实表结构均不含`ST_RDRecord.isCancel`。入库链路保留`voucherState`和原始有符号数量，进度只计已审核状态189；科加实查14条负数量明细、9张单据、净额-13811。
- 2026-11-18 09:30 CST，三源实际Timer运行均COMPLETED、来源状态ACTIVE：E10五条流、T+凯南五条流、T+科加五条流全部成功。科加入库流读取341条。所有现有Timer/n8n调度、锁和入口保持原状。
- n8n只读核验：`cfxCKnLl0YqRZYDj`每日科加同步流程激活，最近一次2026-11-18 01:00 CST成功；`KnKjOrders083026`实际调用订单导出脚本，不是KDOS staging同步。
- 新增逐流异常隔离：失败流留详细错误且整个run必须FAILED，其余独立流继续；失败状态持久化后按run ID幂等进入现有Notification Outbox，通过MSG-001发送个人企业微信。Migration133只增加唯一接收人规则及事件唯一索引，不新增发送器或调度任务。
- 生产部署：本地提交`a2ce3dd`已通过`deploy.sh all/check`和健康检查，API/Web同版本；迁移133已应用。系统用户级主同步unit现配置`OnFailure`异常收尾unit，原三个ERP Timer与三个投影Timer均保持启用及原间隔。
- 10:00三源Timer全成功；科加10:08又完成一次增量补偿，入库投影10:08完成。指定入库145764=81、148106=19，暂存/正式各唯一一条、净额100；科加源ID148310=1也进入暂存与正式表。11/15以来科加源和暂存均368个唯一来源ID，源中无遗漏；暂存多一条源系统当前已不存在的148289（订单2026A027458、品号602000010、数量15、状态181），保留历史暂存且不执行删除，该状态不计入已审核入库进度。
- 失败预警使用标记为ALERT_TEST的真实API失败运行验证：接收人唯一匹配启用的崔玮杰账号且WeCom映射有效，Dispatcher一轮尝试后delivery=`SENT`、响应码0；随后科加增量恢复为ACTIVE。测试失败运行保留为审计记录。API健康、数据库状态、通知规则与来源最终状态已核验。
- 指定订单源ID145764=81、148106=19均已进staging及正式入库表，唯一来源两条、净额100。11月15日起凯南ERP/staging各2996条一致；科加ERP/staging各361条一致，但当前对账发现ERP已不存在的旧未审核staging记录148289（status181、不计有效进度），以及09:30扫描水位后新增ERP记录148310（数量1、审核189，待下一轮读取）。旧记录保留，不直改历史事实；新记录由下一轮正常增量补齐。


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

## MPS-003 Existing master-plan scheduler (confirmed-allocation projection restored)

### Automatic demand consistency extension (Migration129)

- Reuses the existing runDue minute checker, durable Outbox and six original sync configurations; no new n8n workflow, Timer, cron or interval. Host scheduler audit and active n8n workflow metadata were refreshed for this release; unrelated tasks retain their current ownership and schedules.
- Incremental allocation cursor plus a resumable daily sweep each read one bounded page. Per-business-key consumers verify source identity, monthly/base/weekly quantities and whole-order totals before SUCCESS. Provenance-only recovery retains plan IDs, received/reported facts and manual quantity ownership.
- Deterministic business conflicts keep a precise exception and stop automatic retry. Verified compensation preserves old FAILED evidence, links its successful successor, and never rewrites the historical outcome. Private bounded CLI uses the same scanner/consumer.
- Counters/checkpoints, lease/fence, failure diagnostics and rollback: see MPS_AUTOMATIC_DEMAND_CONSISTENCY.md. Implementation does not itself certify a production migration or successful compensation; those require actual runtime verification.
- Runtime verification (2026-11-14): API 484386c deployed through the existing deployment functions, health/SHA verified; only directed Migration129 applied. Existing runDue advances the persisted checkpoint and verifies per-key compensation; Web and unrelated schedulers/services were retained. Controlled stock results and protected production evidence remain private.


### Current source policy — 2026-10-30 user-confirmed revision (PRODUCTION_DEPLOYED; Migration 112 applied 2026-11-02)

- `plan-projections` reads active (`archived_at IS NULL`), confirmed manual/import, **已审核** KDOS allocations. Demand is PostgreSQL numeric SUM(allocated_quantity) per tenant/order/item/division, including repeated physical rows/batches once. Unapproved/revoked/archived rows are excluded. No ERP existence, quantity ceiling, date watermark, original order-line ID, or customer ownership mapping controls plan admission. Enabled receiving organizations and consistent customer/ownership remain validated; conflicts produce stable per-key diagnostics.
- Monthly uniqueness adds division to tenant/order/item (migration112); the current model has no separate persisted month column, and calendar filters retain physical allocation order_date. Existing archived-parent/manual ownership conflicts retain their IDs, data and diagnostics. Only active matching demand and derived progress refresh; no source-absence deletion, historical invalidation or manual-date/attribute overwrite. New unknown customer due dates/review dates/source account/type/amount are NULL; expected shipping dates never substitute for customer due dates.
- Group demand sums eligible allocation items across divisions; order completion retains the average item-completion rule, combining each item's divisions first. Verified inbound facts remain independent of demand. The existing inbound task uses the same active allocation totals and retains historical-only summary repair. Missing/ambiguous incoming facts do not become zero receipts.
- Existing `erp-orders` continues its independent canonical ERP → mps_erp_order_lines collection, source/status/date rules, retained rows and normal writes. Those rules now govern ERP detail collection only. Existing `shipping-to-base` continues monthly → base at its own entrypoint with three-way manual protection/shared delivery-code allocator; legitimate split divisions receive independent batches. No new source columns, scheduler, Timer, cron, n8n workflow or consumer.
- Original 30-minute configurations, manual authorization, runDue and durable reconciliation outbox are reused. Projection uses a repeatable-read transaction, tenant context, advisory/source/plan locks, guarded versions and before/after audits; changed monthly demand enqueues existing shipping-to-base. Unchanged replay produces no plan/audit/outbox churn. Failed transactions roll back and use existing sync logs/exceptions/retry/manual compensation. Obsolete ERP-gate diagnostics resolve without touching business records. Owner: PMC / system maintenance; business timezone Asia/Shanghai.
- Production execution 2026-11-02: the existing `plan-projections` flag was temporarily disabled and restored through the versioned/audited API; it is now enabled at the original 30-minute interval. Migration `MpsAllocationPlanSource1722920112000` was run alone through TypeORM; the four-column monthly unique constraint is active. The scheduled projection completed SUCCESS (414 group plans created; 2,568 monthly plans created and 8 reconciled), then the authorized manual replay completed SUCCESS with zero changes. Existing reconciliation outbox completed `shipping-to-base` (2,568 base plans created and 8 updated) and `base-to-weekly` (SUCCESS, zero new weekly plans). Audit verified those 8 base updates only changed fields still owned by the prior automatic sync baseline plus sync metadata. KAINAN counts after execution: 5,123 monthly, 580 group, 5,238 base, 2,182 weekly; all 2,555 pre-existing monthly IDs remain, including 2,176 linked to archived allocations. The 375 eligible division-three allocation keys now have monthly and base plans; weekly creation remains gated by missing business-required fields. No ERP collection rule, source schedule, or deployment was changed.
- Local acceptance: isolated PostgreSQL18 fresh migrations/populated compatibility/unsafe rollback, demand, scope, idempotency, concurrency, receipt facts, historical/manual/locked/report protection; scoped API/Web and actual local Chrome against isolated services; item-code BOM via existing read-only Kejia adapter. Public procedure and production implementation: [allocation plan source](../mps-allocation-plan-source.md). Real source facts and runtime snapshots stay in ignored test/allocation_plan_source.
- The production rollout is complete. Do not run old three-column `ON CONFLICT` code against the new unique key. Retain all historical plans/audits. After split divisions or NULL amounts exist, schema down rejects data loss; prefer a compatible forward fix, never delete rows to force rollback. No full database backup is added by default for this non-destructive schema change. The preceding 2026-10-30 and older suspension/rollout notes below are historical snapshots and do not describe current production state.

### Authorized one-time ERP history compensation — 2026-10-30

- User explicitly requested ERP items owned by division four and missing its weekly plans be filled into group/monthly/base/weekly plans. Reuse current tenant/customer ownership and stable ERP IDs/versions; retained plans/manual fields/process snapshots/reports stay intact. Source is ERP for this frozen compensation only; ongoing allocation policy and all scheduler flags/intervals remain unchanged.
- Application command/explicit CLI only, no recurring trigger, route, n8n workflow, Timer, cron or extra Nest scheduler. Current admin authentication and DB grant recheck, shared advisory locks, before/after audit and durable idempotency apply. User clarified: closed items do not receive new weekly plans; incomplete items must at least reach division base plans. Missing business values remain incomplete; no fabricated defaults or permanent admission bypass.
- Standalone compatibility migration1722920111500 permits unknown group amount NULL on the retained monthly key. Pending allocation-source migration112 and application deployment remain separate. Archived zero/non-manual FK anchors never contribute effective allocation demand. Base reconciliation uses selected monthly IDs and original manual protection; incoming facts use the existing trusted chain.
- Implementation and runtime results are recorded in [maintenance procedure](ERP_DIVISION_FOUR_HISTORY_BACKFILL.md) and private test/erp_division_four_backfill. Execution status is maintained in outputs/CODEX_PROGRESS.md; code availability is not proof of completed production compensation. Owner: PMC/system maintenance; Asia/Shanghai; no independent automatic retry—the same frozen request can be safely replayed. No default full backup; retained local before-images and additive schema compatibility support forward repair.

### Historical policies (superseded only for downstream plan generation by the restoration above)


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
- 2026-11-02口径修正：日报以发送前一日（Asia/Shanghai）所属月份为报表月份；每月1日发送上月月报，其他日期发送当月累计月报。数据模型仍按月汇总，不是单日明细。
- 2026-11-02人工补发2026-10完整月报：复用已启用FIN-004规则及标准消息中心/Dispatcher，单独幂等键创建outbox `01a199e1-a9c5-7df3-9e0f-b30e32d73e1e`，未改规则、接收人或调度。两名接收人均收到正文及`2026年10月接单统计-生管.xlsx`，所有4条组件投递`SENT`/errcode=0/errmsg=ok；两份附件均包含订单`2307-261026007`。
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

## PMC-BOM-001：事业四部一级BOM工序查询（2026-10-26）

- 归属：PMC订单进度；入口为用户打开「一级BOM工序匹配」的受权API请求，**按需读取，无周期调度**。不新增/改停systemd、cron、n8n或现有ERP投影。
- 代码：`apps/api/src/integrations/tplus/kejia-bom.reader.ts` → `data-operations/tplus/kejia-bom-reader.py`；运行身份沿用API容器node用户与basic_code只读挂载，科加账套 `UFTData418971_000003` SELECT-only。
- 同请求合并；120秒TTL、100键上限、120秒超时；失败503由页面明确显示，用户重试；无外部写入或补偿作业。映射保存经MPS Application Commands，tenant/事业部唯一键、审计及乐观锁，不触发生产工序重投影。
- 验证：真实科加单订单一级读取、Python/服务/页面专项测试、网络隔离PostgreSQL CRUD/Excel/RLS、Chrome合成业务操作；生产部署及效果证据记于`outputs/CODEX_PROGRESS.md`和`test/`。责任归属PMC，后续按需查询状态由请求本身反馈。
- 详细合同：[事业四部一级BOM工序对应](../pmc-bom-process-mapping.md)。

### PMC-BOM-002：容器至既有T+隧道转接
- 必要性实测：宿主机T+端口可达，API容器同一127.0.0.1端口ConnectionRefused；现有`tplus-cloudflared.service`保持active，不修改其loopback监听。
- 归属基础设施，用户级systemd `kdos-tplus-bom-proxy.socket`按需激活同名service，入口`automation/tplus_bom_proxy/install.sh`；非Timer/cron/n8n，无周期。调用系统已有`systemd-socket-proxyd`，仅监听data/tplus-bom-proxy/tplus.sock本地Unix socket，转至host loopback；API只读挂载该目录，不新增TCP监听，不修改防火墙，不读取或保存SQL凭据。
- 运行用户沿用当前部署用户，已有Linger=yes；连接是只读BOM adapter的传输层，业务只读保护仍由adapter执行。Socket由systemd管理并发，无数据写入/重放补偿；service空闲5分钟退出，下一请求重新激活。隧道故障在BOM API以503告知用户，journal记录转接故障，不记录密码。
- 2026-10-26安装前实测现有用户Timer10项、crontab1项，原任务维持；安装后以socket active/enabled及容器真实DB_NAME/一级读取核验。回退stop/disable该socket及service；不操作原cloudflared或ERP同步。目录挂载及BOM socket环境配置随Compose发布；首次安装先于部署。

### PMC-BOM-001 综合生产进度查询补齐（2026-10-26）

- 由既有在制订单看板请求和Excel导出按需计算有效工序快照＋入库的等权综合进度；只读KDOS正式数据，无ERP读取、业务写入或新投影。
- 新增调度定义/候选0，生产新增自动入口/常驻服务0；未调整systemd/cron/n8n及原消费者。查询走原15秒超时和租户只读事务，失败由页面明确报错，用户可重试。
- 无Migration；应用回退即可恢复旧显示，保留原事实和配置。测试及实际版本记录于outputs/CODEX_PROGRESS.md和test/composite-*；权重及缺配置处理见docs/pmc-bom-process-mapping.md。

## LOG-001 营销物流台账（2026-10-28）

- 入口：`/marketing/logistics-ledger`，资源`logistics-ledger`，网页及人工Excel Preview/Confirm。
- 状态：本地62项专项及真实Chrome验收已通过；用户已追加授权生产迁移、部署后推送GitHub。实际发布版本、生产验收及推送结果见outputs/CODEX_PROGRESS.md。
- 持久化：KDOS SQL migration `0019_marketing_logistics.sql`；整柜主表、装柜明细、导入幂等表及RLS安全视图。未读取或迁入真实物流历史数据。
- 业务写入：Application Commands；全文件事务、版本校验、幂等及Audit。费用按整柜去重，订单不分摊。
- 调度：无新增定时、异步同步、systemd、cron、n8n或ERP采集任务；既有运行任务保持原状。
- 恢复入口：`outputs/CODEX_PROGRESS.md`物流台账节；实现合同与本地验证说明：`docs/marketing-logistics.md`。

### MPS-003 existing monthly-plan stock facts (2026-10-28 restoration)

- User authorized continuous Kejia/division-four **existing** monthly-plan stock reconciliation. The retained `inbound-allocation` configuration and its existing 30-minute application scheduler are the only entry; no new timer, n8n workflow or interval. All six configuration enabled flags remain as found; `plan-projections` stays suspended and cannot create/update plans from allocations.
- `master-plan.monthly-inbound.ts` runs in the inbound-allocation transaction before the existing weekly allocation. It scopes by tenant, the existing division-four organization UUID, a unique active Kejia order line/customer, and tenant-owned, stably linked incoming records. Only source status 189 (生效, verified against the real enum) is accepted. Plans with 181 (未审), missing/unknown or unstable source facts retain their previous values and are counted explicitly in `monthly_inbound_source_unverified`, not silently zeroed. Archived allocation parents do not block retained monthly plans' production facts.
- Writes are limited to existing monthly cumulative stock, pending quantity and completion rate, and existing division-four group quantity/progress aggregates. Demand/ownership/dates/manual fields, archived allocations, actual reports and locked process structures remain authoritative. Each changed monthly/group row has a before/after audit and version increment; no-op reruns do not create row changes/audits. An advisory transaction lock, the current scheduler's retry/failure tracking, and transaction rollback protect replay/concurrency.
- No new Migration. Restricted affected-row before-images are retained under ignored `test/monthly_inbound_restore/` for recovery; no extra full-database backup. Rollback: revert the code release, preserve historical audits, and restore only this command's affected derived values through a reviewed command if needed; do not reenable old allocation projection.
- Deployment/runtime evidence: the final deployed commit, manual replay and scheduled-run status, page result and preserved-field evidence are recorded in `outputs/CODEX_PROGRESS.md` and `test/monthly_inbound_restore/acceptance.md`. Code alone is not evidence of restored scheduling.


### MPS-003：月度计划直接生成基础计划（2026-10-29，正式发布）

- 用户已追加授权正式部署及原任务一次必要生产同步验收；发布来源合并a7a63fd与已上线c324f3e，保留两项有效功能。实际发布SHA、Migration、生产指标和Chrome证据以outputs/CODEX_PROGRESS.md与test/monthly_base_production/为准。
- 复用原shipping-to-base配置/同步入口与runDue、durable outbox，任务编码、enabled和30分钟周期不变；上线后显示名称为“月度计划同步基础计划”。唯一生成数据源改为mps_monthly_plans，出货计划不再触发基础创建/覆盖，出货的维护/查询/批次/通知保持独立。
- 源粒度为现有tenant+order_number+item_code唯一月计划，有效组织、非空业务键和正required_quantity；基础planned_quantity取完整required_quantity（不取欠数），客户交期取同名latest_customer_due_date，不把客户交期或preproduction_review_date当作人工latest_review_due_date。
- 原交期编码计数器/锁共用，唯一既有基础复用id/交期编码，旧shipping_plan_id保留且新记录不填该引用；多基础批次或事业部冲突明确记录MONTHLY_BASE_CONFLICT，保留所有原记录、不自动合并/删除。
- 使用既有audit_logs上次自动值做三方对账；首次不能证明自动归属的非空人工值保留。保护人工数量/日期、评审/完工日期、业务字段、周计划身份和报工工序事实。不新增来源类型、标记字段、源表或来源筛选；审计syncValues仅作为内部对账前值，不进入表字段/Contracts/Web。
- 原事务设置tenant context，按租户任务锁和共用交期编码锁串行创建、基础行锁/版本控制、写入与审计/后续base-to-weekly事件同事务；无变化不改版本/审计。失败沿用原日志/异常/任务重试，周期任务作为遗漏补偿；无新调度器或告警渠道。
- Migration111仅允许基础客户交期为空，供待完善记录正常保存，并更新原任务默认显示名；缺真实客户交期仍在统一周计划准入中阻断，不自动编造日期。无历史数据回填、来源字段或新权限。
- 仓库新增调度定义/候选0，生产启停/迁移/频率改动0；本轮不触碰外部n8n/systemd/cron或生产配置。生产现有任务状态沿用之前记录，本地改造不冒充上线审计。
- 原本地验收已通过；本轮实际varchar审计ID关联兼容性修复另在network=none PG18对齐真实结构验证。生产同步、幂等、字段/人工值保护、基础/周/出货页面证据见test/monthly_base_production/；不重复完整测试或增加全库备份。负责人PMC/系统维护。
- 回滚/后续发布：不恢复覆盖数据库。未来上线前应用必要Migration，旧运行版本和出货数据保留；若有空客户交期的待完善基础，禁止直接回退非空约束或部署不含该准入保护的旧周计划生成逻辑，应前向修复或先按真实业务补齐日期。本轮用户已授权原任务正常补齐，不授权擅改冲突基础或人工业务值。

## EQ-001 设备管理双日报（2026-10-30工作区改造，历史阶段）

本段是初次工作区阶段记录；当前生产状态以本节末“正式部署实证”和上表为准。

- 唯一任务/原目录不变：equipment-governance-daily/report.py；目标调度n8n每天12:00 Asia/Shanghai，经原SSH节点执行--send-test，仅崔玮杰。保持正式发送配置关闭；本轮用户明确不提交/推送GitHub、不部署、不修改在线调度。
- 只读数据源：原print-equipment-governance-summary查询CLI复用EquipmentQueryService.dashboard；上海昨日及连续7日、四事业部+研发中心，按稳定组织ID限制范围。单事务只读，无业务SQL副本、无AppModule额外任务、无设备业务写入。
- 顺序：文字→3s→运行图→原始7日已填台次/应填台次精确相等判定→若不等则5s→填报图。延时可配置；100.0%显示值不决定发送。未满足100%和满足100%两分支均测试；默认只生成。
- 防并发/幂等：本地flock及按业务日/模式分步回执；失败非零退出，成功组件重跑不重复，sending未知结果需人工先核对再恢复。无自动新任务/额外重试调度，无凭据副本。上线前须配置既有运维Error Workflow或错误分支（本归档工作流当前未配置），最近成功/耗时和组件结果由n8n执行记录保存；历史补偿须核对日期和回执。
- 2026-10-30只读运行时：发现本任务n8n定义1个（e0dwMjv9OnWmcESk），已归档、未启用，SSH disabled，旧08:00未显式时区且正式参数待替换；实际已启用本任务n8n数量0。仓库新加周期入口0，仓库未发现本任务systemd/cron/常驻/内部消费者定义，这些类别的本任务在线数未单独确认，不能推断为0；未对系统其他任务执行迁移或停启。全系统在线逻辑总数不在本轮范围，不把候选/全局Timer数量当作本任务在线数。
- 责任：设备管理/系统维护；本机验证结果见outputs/CODEX_PROGRESS.md和ignored test/equipment_daily。回滚代码不丢弃发送回执；若后续启用工作流，先停同一触发器、还原旧节点设置或保留禁用，不能恢复正式群发旧命令。操作步骤/手工单人验收和未来正式切换见原项目README。

- EQ-001 2026-10-31追加：正式名单移除高婷武/崔玮杰，测试名单仍崔玮杰、正式开关false；文字逐人加入“您好,{收件人姓名},请收”，逐人发送并分别记回执。用户授权新版单人实发测试，用固定--test-run-id独立批次，保留旧回执且同批次重跑仍幂等；不能用于正式发送，不把它配置进每日自动任务。线上原归档n8n仍未改动。

### EQ-001 正式部署授权（2026-10-31）

- 用户确认新版单人测试并明确“正式部署，并同步GitHub”，取代此前仅工作区/只测/不推送限制。正式9人名单固定，不含高婷武/崔玮杰；测试仍崔玮杰。正式开关true，日程模式改双确认正式参数，默认预览不发送。
- 原工作流ID保留，原SSH Credential引用/owner保留；模板默认inactive，由官方CLI显式发布。12:00上海时区；不新增Timer、cron或第二个n8n设备工作流，不部署无关待发布主计划API/112。
- SSH非零/JSON无效/模式、人数或顺序异常均为失败；同工作流错误分支只给维护人崔玮杰运维告警，再标失败。告警名单独立于9人日报名单；无真实错误注入群发验收。
- 发布前备份单工作流，真实SSH只读production-check验证9人联系人和两图，不提前正式发送。无API Key时用官方import/publish并在无执行任务的安全窗口重启原n8n，核验其他工作流配置/激活集合不变。
- 回滚反向unpublish/恢复原受限导出/受控重启；旧任务保持归档停用，保留成功回执，不删除记录补发。实际发布状态及最近成功/下次计划在本任务末尾补录。

### EQ-001 正式部署实证（2026-10-31）

- 发布代码ad2aabbbe907c27362a6227bec37c0ae1722059a已push github/main，仅10个本任务文件；包含模板但无真实SSH引用/密钥/业务图片。使用原宿主机入口和已构建只读适配，不更新API/Web容器、不执行Migration112。
- 官方CLI对同一工作流import、publish；active=true、isArchived=false、activeVersionId=versionId。确认无运行中任务后短暂重启原n8n，readiness PASS，实际启动日志含Activated workflow设备管理日报。原owner/SSH引用保留。
- 正式12:00 Asia/Shanghai，表达式0 0 12 * * *；下一计划2026-10-31T12:00:00+08:00。每人个性化文字→高清运行图→原始七日台次判定→可选填报图。正式业务接收9人，失败分支只告警维护人崔玮杰。
- 真实SSH预检1337，cli/success，ready=true、sent=false、9人匹配，两图成功；部署不提前发送，首次正式群发待12点自然执行。Python37/API18/build/typecheck/lint/py_compile PASS，主应用原健康检查PASS。
- 本任务n8n定义1/实际启用1，未创建第二份设备工作流；专用宿主机systemd/cron文件及当前用户cron匹配0。全实例active从11→12，仅增加本任务激活；其余15个工作流配置hash逐项一致。
- 受限原导出、预检执行记录、激活日志、只读调度及健康证明在ignored test/equipment_daily/deploy；回滚保留原归档/禁用状态和全部发送回执。n8n执行记录保存最近成功/失败、耗时和结果，错误分支告警可见；网络不确定仍要求人工先核对。

### EQ-001 正式接收人增加（2026-11-02）
- 用户要求将李光明、Linton加入个人正式日报名单，原9人保留；新正式名单11人。测试及失败告警对象仍仅崔玮杰，不发送正式日报进行验收。
- 名单唯一来源为 `automation/wechat_push_projects/equipment-governance-daily/config.json` 的 `production_recipients`；发送时用共享 `WeChatPusher` 按姓名解析企业微信通讯录。n8n工作流Code校验器必须同步由9人更新为11人，避免把正常任务标记失败。
- 验证结果：Python unittest 39/39 PASS；真实`--check-production`返回ready=true、sent=false、recipientCount=11（姓名均唯一匹配），两张图片成功生成。没有真实发送。
- 同一个活动工作流已通过n8n官方CLI更新并发布；Code人数保护从9改为11，原SSH凭据引用、owner、active状态及Asia/Shanghai每日12:00调度保持。n8n重启后healthz=ok，服务ready，启动日志确认EQ-001 activated；16个工作流ID保持，12个active，其余工作流定义未变。
- 发布版本已核实activeVersionId与versionId一致；下一计划为每日12:00（Asia/Shanghai）。测试、联系人预检、工作流回滚快照均存本机受限目录`test/equipment_daily/recipients-20261102`，不提交。
- 当前状态：生产配置、验证和GitHub同步完成；任务提交`41c4cff3b341e94d75beeb3281738ebae88b3f76`已推送`github/main`。未新增调度、不改数据库或设备业务数据，不触发测试/正式日报消息。

### MPS-003：外协周计划转内部生产的首次工艺初始化修复（2026-11-04）

- 保留既有API内runDue/outbox和30分钟配置，不增删迁移任何Timer/cron/n8n任务。生产只读确认6项MPS配置仍enabled；本次只修复共用执行刷新规则。
- 原缺陷：外协创建的周计划没有内部工序，之后改为自制/自制+外协时只更新周计划快照，未首次初始化内部工艺。现修复允许在父行锁下复核无任何任务/报工/工艺锁/初始化或人工空路线确认审计后首次创建任务；复用既有CONFIRM写保护及审计，无Migration。
- 初始工艺可由现有基础到周计划任务、周计划行内更新、单条Application执行刷新触发；同周并发、重复执行不新增重复任务或覆盖既有工艺。初始化计数写入原同步metrics，已有工艺变更继续预览确认，正数量报工锁不清除。
- 正式修复范围和线上执行证据记录于outputs/主计划系统修复进度.md；合成测试仅在专用network=none PostgreSQL18，生产修复经既有Application Command并逐条记录审计，不伪造实际报工。


### EQ-001：2026-11-04中午未进群的实际证据及运行发布收尾

- 今日执行1389：12:00:00—12:02:19（Asia/Shanghai），n8n状态success；实际execution_data的workflowVersionId=06b2f268-bb53-4f8c-938c-d98e0ec9e639，SSH命令未含--submit-notification-event、校验未含groupQueued。11人文字/运行图/填报图均有sent回执，但没有今日equipment.daily_report群事件。
- 已发布版本2c61836a-241f-4d8c-abdd-226a2951978f含群参数及群入队校验；之前其它工作流长运行导致安全重启未完成。旧进程继续使用旧版本，不能把数据库已发布视为运行发布完成。
- 四群路由及机器人均启用、Dispatcher active。实际故障是群事件根本未提交；没有企业微信拒收错误码，不能归因于群Webhook失效。
- 22时确认0运行任务后完成受限SQLite在线备份，重启原n8n_sqlite，设备日报及13个原激活工作流全部激活，17个定义/13个激活和全部配置hash完全一致；ID/owner/SSH引用/12:00上海时间及其它调度保持原样。
- 还发现脚本缺少KDOS_API_BASE_URL时默认80端口：该群接口404，实际15172端口接口可达。默认地址与既有Dispatcher对齐，保留环境变量覆盖；无API/Web改动，无Migration。
- 只读带认证附件探针返回预期409（不存在的投递租约），证明地址/认证链路通过，不生成通知；真实生产只读日报预检ready=true、sent=false、11人并生成两图。Python语法检查及diff检查通过；本轮未要求/未运行自动化测试套件，不借用旧测试结果冒充本轮测试。
- 下一自然计划2026-11-05 12:00上海，届时由新版先发个人、再幂等入队群消息并由现有Dispatcher投递。此次深夜未主动补发，尚无新版自然运行或本次四群送达回执，不虚报送达。
- 备份、配置保护hash及只读探针证据仅在gitignored test/equipment_daily/noon-group-20261104（目录0700/敏感文件0600）；恢复入口outputs/CODEX_PROGRESS.md本次设备日报章节，验收报告outputs/EQUIPMENT_DAILY_LOCAL_ACCEPTANCE.md。


### MPS-003：第一阶段1A同步可靠性（2026-11-05，未部署）

- 仅代码和专用network=none/tmpfs PG18验收，未重建/重启生产API或Worker，未运行生产Migration、任务或历史补偿；n8n/Timer/cron分工全部保持。仓库仍为6个MPS配置任务、1个60秒检查器；生产只读仍6项enabled、30分钟，不把代码完成当生产迁移。
- 原run/processOutbox接入同一Runner（原PostgreSQL三表，无第二队列）；FAILED同键真实重试；version代际、5分钟有界租约、事务行锁及数据库超时；业务和成功日志/Outbox同事务提交，旧Worker迟到不能覆盖。配置、日志、队列跨租户均显式限制。
- 同scope合并但每事件单独日志；最多20事件、逐组临执行领取；禁用/跳过/阻断不写完整SUCCESS；手工非成功409，原UI不会误提示完成。失败/保护冲突沿用mps_data_exceptions与原审计，不新增告警渠道或调度。
- Migration118仅三表期限及日志attempt/scope（5字段/3索引），旧NULL租约RUNNING不自动恢复、旧SUCCESS无验证证明不直接确认；受管超时任务需真实重跑才可成功。前向回退保留证据，未来部署需先退出旧协议消费者，另行授权。
- 本轮只读确认11条历史矛盾和1条旧RUNNING，原件仅ignored受限目录；不得自动改SUCCESS或推断事实未写入。处置建议见联动设计第14节，代码/隔离结果与Git证据见outputs/主计划系统修复进度.md首节。


### MPS-003：第一阶段1B历史事实保护（2026-11-05，未部署）

- 原6项任务、API内60秒runDue/outbox检查和30分钟配置不变，未新增或迁移n8n/systemd/cron调度。仅修改已有执行刷新：不再批量UPDATE实际报工历史上下文/actor/version。
- 新119数据库身份/执行事实守卫仅在network=none/tmpfs PG18合成环境验收；与118及107/108兼容，生产118/119均未执行，生产API仍1c15bfc、Web仍6969382。未执行生产同步、补偿或业务写入。
- 占位不算执行；真实执行并发使用周计划父行fence，工艺持久锁继续107/108；冲突由原1A日志/Outbox保留FAILED原因，不报完整成功。历史详情/累计与当前工艺范围分开，禁止跨事业部关联泄露。
- 本轮只读确认25条非工序制造报工，3条无启用工序且全部重叠；634固定基础ID/关系及当前数量指纹前后不变；11条旧矛盾/1旧RUNNING保留。未来按设计15.6另行授权发布和历史处理，不与旧消费者混跑。
- 实施及定向测试、Git证据以联动设计第15节和outputs/主计划系统修复进度.md首节为准。


### MPS-003：第一阶段1C生命周期（2026-11-05，未部署）

- 不新增或迁移调度，原6项任务、60秒检查器、30分钟配置及n8n/systemd/cron保持。未运行生产同步、补偿或Migration，未部署API/Web。
- Migration120追加三类计划生命周期、索引和事实/执行守卫，118/119/120仅专用network=none PG18验收。默认关闭 `KDOS_MPS_LIFECYCLE_WRITES_ENABLED`；月度/基础计划取消及取消后恢复另有不可绕过的消费者未完备门禁。
- plan-projections/shipping-to-base/base-to-weekly和工单生成遇非ACTIVE整项明确失败（含LEGACY_RETAINED）；同事务租户上下文和行共享锁防预检查竞态，1A保留真实FAILED。execution-rollup继续维护历史派生状态，不新建执行事实。暂停/取消及上游状态由DB与待办查询共同阻断新的普通生产执行。
- 历史迁移为LEGACY_RETAINED会阻断生成任务，**不得直接生产发布或仅打开开关**；须后续审核来源及过渡策略、完成下游消费者/旧Worker退出、备份和另行授权。不得自动批量确认或重放历史事件。
- 生产652/634/3组人工变更、11/1同步异常及25/3历史报工均未修改；受控预览/权限/审计和隔离结果见联动设计第16节及主计划专用进度首节。

### 2026-11-06 主计划集中开发第1轮（仅代码/隔离验收，未部署）

- 保留既有6项主计划同步及30分钟配置、Application/Outbox消费方式；未新增调度入口，未修改n8n/systemd/cron或生产配置。
- 新分配仅在当前事务维护该需求锚点；订单级集团汇总、入库和下游投影仍由原Outbox完成。121存在时生成基础计划关联需求ID，多批次60＋40不覆盖为全需求量；历史NULL不批量回填。
- 生产方案A仅118/119，使用`@tracker/api db:migrate:phase-a`固定名单；120和121分别待独立发布，不得直接执行全pending。无120时生命周期入口隐藏并返回业务错误。
- 120历史过渡及全租户生成阻断仍为既有风险；本轮不启用生命周期写入/级联，不补偿11条历史矛盾事件及1条旧RUNNING。
- 隔离证明及恢复门禁见`MPS_UNIFIED_ID_IMPLEMENTATION_PROGRESS.md`；生产任务启用量沿用既有只读快照，本轮未重盘调度器，不把仓库6项定义数量当作新的生产实测。

### MPS-003：集中开发第2轮数量命令（2026-11-06，未部署）

- 显式分配/部分安全拆合批与业务事务共同写入原`mps_reconciliation_outbox`，sync_key仍为`base-to-weekly`；不创建调度入口、Timer、n8n工作流或第二套任务系统。
- 复用1A租约、防并发、幂等、真实执行状态与重试；Web保存仅显示PENDING，并读取对应事件结果，禁用/失败不能报同步成功。隔离中实际关闭配置使事件非SUCCESS，恢复配置后真实重试成功。
- 生产既有运行分工、任务启用量和30分钟频率保持；本轮没有生产任务执行或配置修改。仓库定义数沿用原6项/1检查器，未重新声称生产调度盘点。
- 证据、边界与回归见`MPS_UNIFIED_ID_IMPLEMENTATION_PROGRESS.md`第2轮；履约归属未确认、LEGACY及120历史过渡不由数量命令绕过。


### MPS-003：集中开发第3轮评审批次应用（2026-11-06，未部署）

- 无新调度入口/Timer/cron/n8n；沿用原API内检查器、1A租约/代际及Outbox。未修改生产任务配置、启用状态或频率，未触发生产同步/旧事件补偿。
- 显式应用只在同事务向既有base-to-weekly事件写basePlanIds范围；定时scope=null保持既有行为，execution-rollup原周/工序范围保留。非空非法范围不回退全租户，所选批次准入不齐返回BLOCKED并按原协议保留FAILED原因。
- B1所选基础及周计划更新，B2基础/周计划/工序整行不变；保存PENDING与真实下游SUCCESS/FAILED区分。122不可变证据关联原Outbox，失败真实重试不重复应用或任务。
- 严格发布名单A118/119、统一ID119→121/122；120仍排除，旧NULL租约RUNNING及历史11矛盾不自动重放。代码/隔离验证及恢复流程见最新 `MPS_UNIFIED_ID_IMPLEMENTATION_PROGRESS.md` 第3轮，不视为生产发布记录。


### MPS-003：第4轮发布前只读复核（2026-11-06，未发布）

- 生产实测单API内MPS消费者、6项配置均enabled=true/30分钟；最近两小时六项均有SUCCESS，1条无可信租约历史RUNNING保留。仓库仍6项配置定义、1个60秒检查器，没有新调度器。
- n8n只读17个工作流定义/13激活，节点未见直接MPS引用；用户级ERP采集3及投影3个Timer均保留启用；不改变既有n8n/systemd/cron分工。主机审计和特权私有cron/外部人工入口的核验限制见发布预检，不虚报已穷尽外部消费者。
- 生产仍Ledger117，118/119/120/121/122未执行；A/U严格迁移在隔离候选镜像验证通过。当前main候选存在财务月份协议回退P1，整体生产NO-GO，未停服务/暂停配置/迁移/部署/触发同步。
- 没有重放11条旧矛盾或1条旧RUNNING；备份、隔离恢复、下一次获批窗口写屏障及两轮自动观察要求见`MPS_UNIFIED_ID_PRODUCTION_RELEASE.md`。

### MPS-003：五表第一阶段最终只读核对（2026-11-06，未发布）

- 21:40实测原6配置全部enabled=true、interval_minutes=30、status=SUCCESS，近两小时六项均有成功、没有新FAILED；单API既有60秒到期检查及Outbox，未新增调度。事件触发与定时共存，不用日志条数推断新增定时器。
- n8n仍17定义/13激活，节点未见直接MPS引用；原ERP三采集/三投影Timer保持。私有cron/外部人工入口核验限制不变；没有停用、合并、迁移任务或修改六项配置。
- 生产仍API2d4b447/Webbf78d4e、Ledger117；旧11状态矛盾/1旧RUNNING保留，Outbox当前PENDING/FAILED为0。本轮只读取，不主动同步、不登录创建会话、不重置日志。
- 本地main已ff-only整合财务兼容候选7cddcd4及文档05049ad，财务P1解除，A118/119与U121/122保持技术GO，120排除；生产执行仍需明确SHA/名单/维护窗口批准。五表历史35条报工缺月度需求单列，不自动修复；真实Chrome/两个完整自动周期尚未执行。详见`MPS_UNIFIED_ID_PRODUCTION_RELEASE.md`第11节。


### MPS-003：正式发布运行过程（2026-11-06～07，中间版本历史快照）

- 用户批准维护后正式API暂停/恢复原6项配置并审计；原enabled全部true、interval=30分钟。保留既有单API60秒检查器和Outbox，无新增n8n/systemd/cron入口，无关ERP三采集/三投影及n8n17定义13启用的既有分工不改变。
- 严格118/119、121/122已执行，120仍缺失；API/Web/worker最终262ef3e，原deploy.sh检查一致。生命周期写入开关不变。二次备份及独立两库恢复通过，业务事实逐行摘要保留。
- 首轮878暴露shipping索引退化和无120多余SHARE锁，正式暂停后前向修复至262；00:13:56再次恢复原6项true/30。自然首轮shipping22.604秒SUCCESS，受管过期租约由1A标FAILED并实际重试；原NULL租约旧RUNNING及11旧矛盾不补偿。plan-projections隔离历史110组保留真实FAILED/BLOCKED，其他4387合法组已检查，不伪报完整成功。
- 六项至少60分钟/两个完整自然周期观察仍在进行，最终时间/状态/失败及验收边界以`MPS_UNIFIED_ID_PRODUCTION_RELEASE.md`第12节为准。本记录不将历史异常等同新生产同步失败，也不以代码测试代替生产周期验收。


#### MPS-003最终44f61d3分时补记（2026-11-07）

- 待报工无120祖先查询P1经最小共享Schema CASE修复，API/Web/worker最终44f61d3；原deploy.sh check一致，120未执行。00:47:27恢复原六项enabled=true/30分钟，60秒检查器不变，无新生产调度。
- 首轮shipping出现一次第二检查器与投影竞争月度行的55P03，原5秒锁等待安全退出、日志FAILED保留；随后正常链23.939秒SUCCESS。不是原历史11/1事件补偿，不伪造无失败或两个30分钟周期。
- 五项任务最终SUCCESS、plan-projections历史110项FAILED/BLOCKED/4387合法项已处理；不存在未恢复新错误或重复计划。最终至少60分钟/两个自然周期仍在观察，版本/周期/恢复/事实核验以发布报告12.9为准。
- 临时手工55秒采样仅只读诊断，非业务调度、无systemd/cron/n8n注册，完成观察后退出；既有n8n17定义13启用及ERP3+3 Timer分工不改变。


#### MPS-003发布验收完成（2026-11-07 08:05，上海）

- 最终API/Web/worker44f61d3，六项enabled=true、interval_minutes=30、原60秒检查器不变。00:47:27～08:05:29自然观察438分钟，base/ERP/rollup/inbound/projection/shipping完成定时轮数15/15/13/15/15/15；五项当前SUCCESS，投影仅历史110组真实FAILED/BLOCKED、4387合法组处理。无新生产调度器，无关ERP/n8n/systemd未变更。
- 一次shipping55P03月度行锁竞争00:48:39失败、00:49:23成功，后续14轮无该错误；旧受管超时此前由1A租约正常失败恢复，原11矛盾/1无可信租约RUNNING仍不动。新25条真实报工Outbox均SUCCESS且对应成功日志，其中1条重试；没有人工状态修正或历史重放。
- 临时69次只读55秒观察已退出，非新业务入口；生产只保留原Application/持久消费者。118/119/121/122已执行、120为0，事实/工艺/634固定ID及人工更正保护通过；历史Excel私有保留。生产验收PASS及完整边界见发布报告12.10。


## 设备日报全零修复与已授权更正补发（2026-11-07）

- 今日原n8n执行1426于12:00～12:01成功，但统计日2026-11-06运行图全零。真实只读复核有564设备/386监控/364已填，计划235140分钟/实际226320分钟、稼动率95.6%；近7天2551/2702台次。原适配器只声明表级read，11月6日新增组织字段过滤后组织选项变空，空IN范围返回全零；不是填报事实丢失。
- 最小修复：日报专用只读actor增加divisionId/departmentId字段read；五单位稳定ID范围保持，无管理员通配或员工权限变更。有设备却无可解析单位时拒绝发全零。构建并原子更新宿主单个查询适配JS，既有Python脚本每次任务读取新模块，不需重启n8n/部署API/Web/执行Migration；原12:00上海调度、11人和四群保持。
- 构建/定向lint/Python AST通过，已更新原有权限断言；本轮未新增/运行测试套件，不引用旧测试次数。生产真实只读两图预览已人工查看，PNG与消息中心附件SHA256一致。
- 用户明确批准补发后，增加固定更正批次zero-fix-20261107；正文标注此前全零作废。原当日运行图及11人回执SHA256不变，更正位于production/corrections/<批次>/，按人/组件防重；群事件使用业务日+correction+批次幂等身份，未删除或重置原回执。
- 19:04更正已实际完成：原11人每人文字/运行图/填报图33组件均sent；四个设备群各3组件共12条SENT、response_code=0，群Outbox SENT/attempts1。近7天未满100%，已补齐原零分母误跳过的填报图。这里只证明企业微信成功响应，不等于人员已读。
- Git代码c2073a4/8f3b8ff已从干净main68713ce独立提交，正常推送github/main；未推送MPS三级候选。根工作区保留原未提交260行及其他文件，日报代码已独立cherry-pick，避免下次构建退回旧适配。
- 无数据库Migration、设备业务数据或权限授权改动；唯一新增业务写入是本次已获批的更正通知事件/投递记录。原API/Web44f61d3保持，Dispatcher active；次日自然12:00使用修复，不改变调度。诊断/备份/两图/回执/投递证据仅ignored test/equipment_daily/zero-20261107，含敏感记录不提交。

### RD-BOM-INDEX-001：研发中心已审核 BOM 主档索引（2026-11-10）

- 唯一调度容器仍为 n8n 工作流 `RdBomMasterIndexDailyV1`：每日 01:00 `Asia/Shanghai` 执行 E10 BOM Change Tracking INCREMENTAL；2026-11-18修复版另在同一工作流每小时 :15 检查最近成功时间，超过36小时预警、48小时严重预警。E10 保持 SELECT-only；无 systemd/cron/应用内任务。仓库定义：`automation/n8n/rd-bom-master-index-daily.json`。
- 生产 API/Web 首轮已运行 `ed81e55216f368491194a157f30e37a2ed3ec493`；Migration 127 已按白名单执行，Migration 120 未执行。生产初次 FULL 成功插入 287,827 条，水位 23,368,782；首轮 API 容器执行 INCREMENTAL 成功，扫描及变更均为0，水位推进到23,368,795。
- 2026-11-18生产复核：最后一次成功 `2026-11-10 15:12:39 CST`，水位23369384；E10 min/current版本23486486/23506473、CT自动清理保留1天，故增量水位已失效。工作流实际在2026-11-13 08:47 CST随运行时初始化激活；11-14至11-18每天01:00实际触发5次，SSH返回码均为1且stderr为 `CHANGE_TRACKING_RETENTION_GAP`，但原工作流没有验证 `code`，所以5次execution都误记为success。当前活跃generation保留287859条，lease与stage已空；PostgreSQL卷可用443GB。FULL现有代码能在新generation分页扫描、补偿期间CT后原子切换，失败保留旧generation。
- 2026-11-18修复版已生产部署：API commit `b52b90da382bdee541d128e9412d9e1c0053531f`，仅更新API，Web/Document Worker未重启；n8n version `3b3c9c29-6f92-4dce-804e-1f97c8b12e06`，保留每日01:00 INCREMENTAL，并在同一工作流每小时:15运行HEALTH。生产FULL run `01400427-31b7-4034-bef5-a848fbf17dbc`成功扫描291,129条并原子切换至generation `4c270604-0434-4efb-bbcd-e88e063c46ff`、水位23506515；旧generation及287,859条保留。随后INCREMENTAL run `7e3e3365-3a1f-4c18-a592-a1b1acf9252e`成功，扫描/变更0，水位稳定。11-18 22:15 CST自然HEALTH调度execution 1566成功，CLI code=0、状态SUCCESS、告警校验通过。11-19 01:00 CST每日自然INCREMENTAL execution 1570成功：SSH code=0、run `a43b894a-fb2f-4600-805d-a0794c64f991`、扫描/变更0、水位推进至23506557，结果校验节点通过；随后HEALTH确认最新成功时间2026-11-19 01:00:03 CST、age 7.5小时、无错误且无需告警。失败通知复用已配置 `erp.sync.failed` 事件；36/48小时预警幂等；没有新增调度器、Migration或E10写入。发布前已备份项目数据库/uploads及n8n SQLite/工作流；验收报告：`outputs/RD_BOM索引RETENTION_GAP故障修复验收_20261118.md`。独立分支已推送GitHub。
- 2026-11-10后续BOM计数热修复：生产确认E10 item UUID为大写、PostgreSQL UUID文本为小写；数据库UUID过滤成功，JavaScript字符串Map却区分大小写，致使已有BOM全显示0。API唯一变更为两侧UUID小写规范化，回归7/7、类型检查和Lint通过；API部署SHA `28ab0eb782adf4d94916a8cbdd83151a56a5e805`，镜像 `sha256:d5c2e9ffa6d59213fb0a9d87c12e3041aede4b135659ae0253ab650a69e0af12`，未执行Migration/全量同步。修复后只读复算2,365个有已审核BOM品号、3,565条分配明细；另有431个分配品号在E10 ITEM无匹配、保持待核实。运行台账状态仍为 `PUBLISHED_PENDING_RUNTIME_RELOAD`，不因API热修复改变。

### MPS 通知：计划同步异常企业微信群与工作日汇总（2026-11-15，待消息中心路由/未启用）

- 复用既有 `MasterPlanSyncService`、`notification_outbox`、`NotificationService`、`kdos-notification-dispatcher.service`；未新增异常扫描器、systemd、cron或业务检测调度。即时事件为 `mps.sync_exception.immediate`，汇总事件为 `mps.sync_exception.daily_summary`。实现覆盖需求一致性、月度/基础冲突、分配投影阻断、同步失败及Outbox达到重试上限；异常版本和Outbox状态版本负责幂等去重。没有可用路由时跳过入队，计划事务仍继续，工作日汇总按发送时实时状态重算，不预置历史异常数量。
- 新增只读汇总/入队API `POST /api/v1/internal/master-plan/notifications/summary`，复用 `KDOS_NOTIFICATION_INTERNAL_TOKEN`及租户/worker header；摘要统计活动总数、当日新增/解决、事业部、重点异常、尚未解决的重试耗尽任务及8条脱敏例子，异常页面链接为生产已验证的 `/master-plan-reports`。
- 新增n8n流程模板 `automation/n8n/kdos-mps-exception-summary.json`，工作日08:35、`Asia/Shanghai`，复用现有“本机SSH”凭据并调用项目脚本。运行态现有19个工作流定义/14个active；新流程已导入但 `active=false`、已unpublish，未重启n8n、未运行/发送。
- 消息中心当前有4个已配置的设备管理群机器人，但没有“主计划同步异常群”机器人，也没有上述两类事件路由。Webhook不写入仓库；用户表示先自行在消息中心创建配置。待群机器人和两条路由正式可用后，才能启用n8n、执行一次性聚合历史汇总并验证真实回执；当前不得标记为已上线。
- 2026-11-15联合版本 `c4feb47ffd0fa8aa3c8b2f6381006b3205914c91` 已正常提交、推送并完成API/Web联合部署；生产 `/api/v1/health`、`/build-info.json` 与仓库 SHA 一致，容器健康。部署前完成 legacy、KDOS 数据库及 uploads 备份并校验 SHA256；未执行Migration、未修改生产计划数据或现有个人/群通知设置。
- 运行时验收仍待管理员在消息中心创建“主计划同步异常群”机器人并启用 `mps.sync_exception.immediate`、`mps.sync_exception.daily_summary` 两条路由。当前复核仍只有4个设备管理机器人、两条路由缺失；n8n流程已导入但保持inactive，未真实发送测试/首次汇总。完成管理员配置后方可验证企业微信成功回执并启用08:35工作日汇总；未完成前不得将MPS群通知标记为上线。

## MSG-ABNORMAL-001 异常责任判定人事务通知（2026-11-18）

- 新业务事件 `workflow.abnormal.judgment_assigned`；归属流程审批 / `abnormal-responsibility-judgments`，负责人沿用流程审批模块管理员。主单和关联子单成功创建/判定人变更时，由 `AbnormalCostApplicationService` 在同一事务调用现有 `NotificationService.enqueueEvent`。
- 唯一消费入口：现有 `kdos-notification-dispatcher.service` → KDOS internal claim/result API → 现有 `WeChatPusher()` 个人工作通知；不新增n8n、Timer、cron、应用scheduler或第二套发送脚本。新增事件1个，新增调度器/周期定义0个；既有Dispatcher 1个实测active/running。
- 运行时盘点：系统Timer列表22项、用户Timer列表10项（列表项不是成功任务数），用户cron 1条；n8n已激活14个工作流。既有 `TT8raJ9ndXSOnTwb` / “异常费用_周五_8点” 实测active=true，Schedule为每周五08:00并经SSH执行Python，保持原状；本次事务判定通知不替换该周报。盘点脱敏证据保留本地 `outputs/KDOS_异常费用_调度只读核查_20261118.txt`。
- `1722920132000-AbnormalCost` 仅为当前租户初始化该事件默认启用的 `ABNORMAL_JUDGE` 动态收件人规则，不更改其他路由/接收人，不导入事故金额或异常业务记录。
- 接收人从同租户真实子单的当前 `judge_user_id` 解析，并核对事件里的指派身份，不能由前端传企业微信收件人。已删除、判定人已变更或已完成的记录不按旧事件发送。个人WeChat UserId来自现有users映射；没有有效身份时outbox=FAILED，日志为ABNORMAL_JUDGE_NOT_DELIVERABLE，可在现有消息中心复核并重试，不冒充发送成功。
- 幂等/防并发：主单命令Idempotency-Key+业务事务；事件dedup_key=`abnormal-judge:<judgmentId>:v<version>`；Dispatcher既有SKIP LOCKED/lease/按recipient的delivery日志防重复与失败退避。外部网络错误沿用现有失败重试；不可达接收人停止自动重试并明确记录，修复身份后由获权管理员重试。进程崩溃沿用现有锁超时恢复。
- 通知链接使用 `PUBLIC_WEB_URL` / `WEB_BASE_URL`，缺省为已验证在线的 `https://knplan.cuixiaoyuan.cn`；目标详情另行校验字段/数据范围。测试仅在隔离PostgreSQL验证claim、收件人和失败恢复，不向真实员工发送合成消息。
- 回退：回退应用镜像并保留全部新增业务/附件/编号/审计数据；必要时在现有消息中心停用**本事件规则**以停止新发送，未经变更批准不修改既有周报/Dispatcher。新增Migration禁止自动删表down。
- 发布门禁与验收状态：实现、隔离数据库claim/失败恢复与真实SPA合成交互已验证；通过备份、Migration 1722920132000、生产部署、健康及版本检查后提供功能。最终生产SHA、备份和Migration结果统一记入本轮 outputs/CODEX_PROGRESS.md 与交付报告；真人发送保持 WAITING_BUSINESS_ACCEPTANCE，不能把claim测试写成企业微信真人已收到。

## RD-002：T+双账套BOM存在性表头对账（2026-11-20新增）

- 任务ID：RD-002；责任：研发中心/平台维护；业务时区Asia/Shanghai。
- 唯一调度定义：`automation/n8n/tplus-bom-reconcile-daily.json`，工作流ID `RdTplusBomReconcileDailyV1`，每日01:20。
- 调用：复用本机SSH→既有API容器→`RD_BOM_INDEX_TENANT_ID=KAINAN node dist/tplus-bom-sync-cli.js RECONCILE`；依次科加、凯南，不并发；源为AA_BOM与AA_InventoryEntity，只读、500头/页；无子件/ERP写入。
- 写入：TplusBomSyncService Application Command，tenant/source独立状态和generation，完整页+源前后指纹/数量一致后切换；首次两个成功且显式ACTIVATE才启用三来源报表。
- 防并发：tenant/source会话advisory锁，进程退出自动释放；失败旧代次不动，可幂等重跑；无永久日期水位漏删除风险。进程中断的RUNNING审计下次同来源接管时置FAILED。
- 失败：CLI非0、n8n后置强校验；原BOM报表显示异常/过期及最后成功日期，本次用户明确不新增业务消息推送，覆盖Skill通用消息告警建议。每天完整轻量头对账可补偿漏跑，手工同一CLI可重试。回滚仅撤新工作流及旧应用，不删镜像或源资料。
- 原E10每日增量及其既有监测保持原样，不执行每日E10 FULL；其他所有n8n/Timer/cron原样。
- 变更前生产盘点：19个n8n工作流，14个激活；新增定义前无T+ BOM索引专用对账入口，未把已有订单同步判作本任务。主机实际Timer/cron/常驻服务摘要保存受控本地`outputs/tplus_bom_unified_release/schedulers-before.txt`。
- 当前阶段：定义与隔离测试已完成，生产启用/最近执行证据待本轮发布后追加，不能将仓库active=true当作已上线。

### RD-002生产执行证明（2026-11-20）

- Migration135已严格应用；首次双来源对账均SUCCESS，独立ERP聚合与生产有效数量一致：科加22083/22095头，凯南3334/3336头。ACTIVATE后报表使用三来源；E10原代次/水位/291736张头保持不变。
- 真实n8n工作流受控重跑execution **1631**（cli），2026-11-20 12:15:29至12:17:01 Asia/Shanghai，status=success；SSH与后置节点均完成，两个来源sourceVerified与活动generation通过检查，第二次对账成功。
- 已发布`RdTplusBomReconcileDailyV1`并在无进行中execution窗口重启原n8n使新计划生效；每天01:20上海时间。临时CLI broker使用5689避免与常驻5679冲突，不改常驻配置、没有新增永久服务。
- 变更前19定义/14激活，变更后20定义/15激活；19个原流程的nodes/connections/settings/active指纹逐个相同，原E10工作流保持激活。仓库本任务新增1个n8n定义，生产对应1个激活逻辑任务；本任务新增systemd Timer、cron、常驻Service、应用内scheduler均0。
- 运行摘要及完整旧/新配置核验留在本地`outputs/tplus_bom_unified_release/n8n-verification.json`，不提交业务数据、凭据或完整执行响应。

## RD-003：A1-PLM项目进度双接口快照（2026-11-20新增）

- 归属研发中心/报表，责任人为研发中心及平台维护；任务ID RD-003，时区Asia/Shanghai。
- 仓库新增1个n8n定义：`automation/n8n/plm-project-progress-half-hourly.json`；ID `RdPlmProjectProgressHalfHourlyV1`，每30分钟00/30分，受控本机SSH→既有API容器`PLM_TENANT_ID=KAINAN node dist/plm-sync-cli.js`。无新增永久服务、cron、systemd Timer或应用循环。
- Ubuntu直接HTTP实测成功，Node原生fetch，不依赖Edge；登录及getProjectDetail/getAllProjectDetail均成功有效后，由PlmSyncService Application事务整体更新租户快照，保留系统总数与明细数原范围。源凭据只在受限服务端.env，不进n8n命令/源码/日志。
- tenant advisory lock防并发；每请求20秒最多3次、命令240秒/工作流300秒；失败非0、固定错误码、n8n校验真实退出码/两接口/SUCCESS/快照UUID/计数。失败旧数据不动，完整下轮可补偿，手工重跑复用同入口。
- 观察/告警：原报表显示最近成功/失败/60分钟过期，n8n失败执行留痕，不新增消息推送；运行审计保留时间/count/error。回滚只停本工作流及旧镜像，不删快照或变更现有任务。
- 变更前实测20个n8n定义/15激活，未发现PLM流程；主机Timer/cron/常驻服务盘点保存在本地`schedulers-before.txt`，现有全部保持。新增仓库定义不是已激活数量；本轮实际导入/执行/激活、旧流程指纹及最终版本以`outputs/plm_dashboard_release/n8n-verification.json`和最终验收报告为准，发布过程需逐项核验后才标PASS。
- 详见`docs/operations/RD_PLM_PROJECT_PROGRESS.md`。本任务原始JSON、运行日志及ZIP.git不提交；用户要求仅本地提交，不push。

## WF-ABNORMAL-001 异常费用三ERP独立订单（2026-11-21新增）

- 权威入口：n8n `AbnormalCostOrdersDailyV1`，每日02:30，Asia/Shanghai。仓库定义 `automation/n8n/abnormal-cost-orders-daily.json`；不新增systemd/cron/常驻循环。原n8n/systemd/cron任务保持。
- 用途：异常费用专属、2026-01-01起有效订单，只供本表单引用；不依赖既有staging/PMC订单，不同步ERP写入。
- 调用：既有本机SSH凭据→现有API容器 `abnormal-order-sync-cli.js` → 只读Python Integration Adapter → Application原子差异发布。身份：受控KAINAN系统命令，凭据仅既有服务器配置。n8n不持有SQL密码或业务写SQL。
- 运行保护：tenant advisory lock、源原始ID/双读摘要核验、完整三来源后单事务发布、稳定业务键、源切换日志、SYSTEM_FIXED行保护。来源独立结果和批次计数；失败保留当前全部快照且非0，原erp.sync.failed规则/Dispatcher报警；超时REPORT_FAILURE补记中断。不在生产注入失败来测试消息。
- 增量判断证据：E10头/ITEM有CT，明细/交货计划无CT；完整删除/修改集合无法由头水位证明，选择有界全读取和差异写入，重复运行幂等。补偿为同一CLI受控重跑。
- 超时：每来源两次180秒，整同步1200秒，n8n1500秒。02:30与现有PLM半小时任务时间相同但数据/锁/调用独立，原任务不迁移；读取成本及实际耗时见证据。
- 回滚：仅停用本任务、前向修复优先，保留表和历史，新旧应用兼容风险见 `docs/operations/ABNORMAL_COST_ORDERS.md`。
- 责任归属：流程审批/异常费用维护者。发布前实际盘点21个n8n定义/16个激活，无本任务；最终激活、执行ID、成功时间及原工作流一致性在 `outputs/abnormal_cost_orders_release/` 最终报告登记。部署前未宣称已启用。

- 2026-11-21运行验收：受控CLI execution `1689` 成功，07:58:57–08:00:37（上海时间）；三来源完整读取及严格结果节点通过。工作流已发布激活，n8n healthz及启动注册日志已核查。盘点从21定义/16激活变为22/17，原21项nodes/connections/settings/active逐一一致。新增仓库定义1、新增启用n8n逻辑任务1；新增systemd Timer/cron/常驻服务/应用调度均0。此执行为手工验收，未冒充自然定时触发；下一周期2026-11-22 02:30。完整证据见受限outputs/abnormal_cost_orders_release/n8n-verification.json。

## 非KDOS：异常费用周报（2026-11-23故障修复）

- 归属：用户标注为非KDOS；本台账记录其运行事实，保持与 `WF-ABNORMAL-001` 每日02:30三ERP订单同步分离。
- 权威调度：生产 n8n workflow `TT8raJ9ndXSOnTwb` / `异常费用_周五_8点`，每周五08:00，Asia/Shanghai；生产核查 active=true。调用既有 SSH 凭据 `本机SSH` → `/data/automation/code/work/MissLiu/unusual_expenses/main.py`，没有新增 Timer、cron 或服务。
- 数据流：登录 OA 导出异常费用 Excel → 更新 `2026年度异常费用统计.xlsx` 趋势工作表及 history 备份 → 使用既有 `WeChatPusher` 发送摘要和附件。密钥仍在原工具包配置中，不进入仓库、命令或日志。
- 故障证据：execution `1618`（2026-11-20 08:00 上海）n8n 外层记为 success，但 SSH 节点返回 `code=1`；Playwright/系统 Chrome 1.59 对 HTTP OA 地址执行内部 HTTPS 升级，随后 `ERR_BLOCKED_BY_CLIENT`，导出、汇总、发送均未开始。最近一次已记录完整成功为 execution `1492`（2026-11-13）。
- 修复：外部脚本 `download_expense_report.py` 默认固定使用 Playwright 自带 Chromium，不再失败后回退到受主机代理/HTTPS 策略影响的系统 Chrome/Edge；浏览器缺失时明确失败并提示安装。SSH 后新增 Code 节点 `校验 Python 退出码`，缺失或非零 `code` 立即抛错，n8n execution 记录为失败，不再误报成功。Playwright Chromium 147 已安装至运行账户缓存；未改 OA、Excel 汇总规则、收件人或发送逻辑。
- 运行身份：SSH 凭据仍为既有 `本机SSH`；原脚本可访问权限为 Jerry 用户的 `.seeyon_auth/browser_profile`（仅其所有者可进入），Playwright 缓存安装到同一运行账户 `/home/Jerry/.cache/ms-playwright`。未读取或输出凭据内容。
- 并发/幂等/补偿：当前脚本未发现显式 `flock` / 任务级互斥或企业微信发送去重键；周报更新可能改写汇总工作簿并发送多个消息/附件。失败后的受控补偿是检查最近一次 n8n 节点结果及工作簿/`history/` 后，经授权手工重跑；不得因 n8n 外层成功标记直接重跑，以免重复发送。任务没有独立自动重试/失败通知配置；n8n execution 和标准输出作为现有故障证据。
- 备份/回滚：生产更新前保存发布版 workflow JSON 和 n8n SQLite 数据库快照至权限受限路径 `/data/work/n8n/backups/abnormal-expense-friday-20261123/`。回滚可由管理员恢复 workflow 快照，或从 DB 快照恢复；改回旧浏览器选择逻辑会恢复原 Chrome 失败风险。脚本代码变更位于外部仓库，`git diff` 可反向补丁。
- 发布验证：2026-11-23 Python 编译通过；隔离临时 Playwright profile 以 Chromium 147 导航 OA 登录入口返回 HTTP 200 并识别登录表单（未登录/下载/发送）。生产 workflow 发布后核对 active=true、周五08:00配置、SSH命令未变、新退出码节点存在；n8n 容器重启后 `/healthz` 成功，运行中 execution 为0。用户授权手动执行前没有触发生产报告发送。
- 用户随后授权 2026-11-23 立即运行一次。n8n CLI `execute` 在启动 execution 前退出，DB 未新增执行；随后按同一 SSH 命令直接运行 `uv run python main.py` 一次，退出码0。OA 登录/下载成功，汇总工作簿保存，微信文本与3个附件发送接口均返回成功。受限日志：`/tmp/abnormal-expense-manual-run-20261123.log`。
- 首次手工运行暴露补跑滞后：原工作簿日期到2026-11-06，脚本仅新增WK46 / 2026-11-13列；日志明确有32条源数据晚于2026-11-13而未写入。首次发送技术上成功但数据不完整；当时未自动二次运行或再发更正，等待用户确认。
- 用户进一步明确要求跑截至11月20日的版本后，使用已导出的 `异常单查询.xlsx` 单独运行 `uv run python update_weekly_trend.py` 一次；退出码0。工作簿新增WK47 / 2026-11-20，独立读取确认 `每周数据趋势!AP1` 日期为2026-11-20；日志仅有1条源数据晚于该截止日，按要求未纳入。更正后的微信文本与3个附件发送接口成功；目标文件及两份history备份已更新。受限日志：`/tmp/abnormal-expense-catchup-20261120.log`。本次补齐完成，今后自然执行继续沿用周五08:00工作流。

## MPS 基础计划自动生成周计划恢复（2026-11-24）

- 权威调度保持现有 `base-to-weekly` 配置和 `MasterPlanSyncService.runDue`（Nest `@Interval(60000)` 检查、配置周期30分钟）及 reconciliation/outbox；不新增 Timer、cron、n8n 或第二个应用调度入口。
- 故障定位：定时、手动与事件入口都进入相同同步器；整租户内合法的已报工/手工数量保护行或缺路线使整体结果返回 `BLOCKED`，导致配置/执行日志误报整轮 `FAILED`，Outbox 事件到达最大重试后停放，自动补偿不再拾取。修复将暂停/取消/来源未知逐行隔离，合法保护和真实路线阻塞记为行级指标/业务阻塞，允许同轮其他有效行继续；真实事务异常仍失败并保留原因重试。事业部默认工序配置变更入既有 outbox 触发同一重试链。
- 读模型“已具备条件”现同时检查基础/月度 ACTIVE、有效月度来源、必填字段和内部生产事业部有效默认路线；显示已生成错误只保留最新失败，成功后清除旧错误。没有有效默认路线时明确阻塞，禁止回退通用工序。
- 生产扫描快照：6185条基础计划无周计划；6169条至少缺一项准入字段；16条字段完整但生命周期为 `LEGACY_RETAINED`；其中14条与ERP入库暂存事实关联而保留，2条通过严格预览。4条现存周计划缺工序任务：2条历史保留，2条活跃无执行事实/路线锁且事业部有有效默认路线，可由原同步器安全初始化。写入使用既有生命周期 Application Service 与 base-to-weekly，不直接插库；执行/最终计数、备份及生产SHA在本任务进度/报告补记。
- 生产outbox历史态扫描：171条旧生命周期失败为10次重试上限、68条因全轮 `BLOCKED` 停放；修复后全租户周期扫描负责重建当前有效状态，历史暂停/取消/来源不明事件仍按业务规则阻塞，不批量激活。
- 新增自动入口/完整生命周期隔离PG18回归；生产部署前记录备份，生产自动/手动/幂等与工序报工查询验收完成后更新本条记录。本任务不改变ERP、BOM、入库或报工事实。
- 发布验收：备份 `four_department_tracker_20261124_091525.backup` SHA256 `86c1aa2639491cef7bf67bda2e4f4a6515db9c18a9a0a6c8fab9529bc2e55d63`，另有KDOS DB及uploads归档；API/Web/Worker部署并健康，部署检查确认API/Web SHA与当时本地main HEAD一致，无Migration。严格生命周期工具预览2条、0阻塞，执行后恢复monthly 2、base 2、weekly批次1；核心订单查询到唯一周计划及10条匹配事业部工序。生产全租户手动同步SUCCESS，12条执行事实保护隔离为指标。报工查询服务对核心周计划返回10条任务。隔离PG18 `runDue` 自动生成链路37/37，定向单测54/54；API/Web类型检查、API lint、构建通过。恢复后缺周计划6183条（6165字段不全、18条历史保留且全部关联入库暂存事实）；没有活动且准入完成的未生成周计划。4条无工序快照均为不应生成内部任务的中心外购/外协业务行。GitHub main仍落后本地9个无关提交，本次未推送以避免夹带。

- 2026-11-24后续历史来源修复沿用同一权威入口：`runDue` 每分钟检查、`base-to-weekly` 原30分钟配置和既有 outbox；不增加调度器。受信系统消费者分页核验订单/品项/事业部/客户、当前有效来源和分配/月份/基础计划数量一致后，只将 `LEGACY_RETAINED` 恢复为 `ACTIVE` 并写审计；暂停/取消、来源/客户冲突、数量差异、已有周计划及生产执行事实仍隔离。真实ERP入库单独保留，不单独阻止首次周计划及工序快照。人工 `KDOS_MPS_LIFECYCLE_WRITES_ENABLED` 不整体开启；系统路径使用代码内受限恢复能力。关联 outbox 对仍被生命周期或缺少默认路线阻塞的记录记录可重试 `BLOCKED`，来源恢复后按正常幂等周计划/工序逻辑核验。详细恢复数量、生产验收和SHA另记于本任务进度/最终报告。
