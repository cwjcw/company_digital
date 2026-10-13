# KDOS 自动化任务台账 / TASK REGISTRY

更新时间：2026-10-13。证据：(1) GitHub `company_digital` 主分支文件盘点；(2) 用户在生产 Ubuntu 主机运行 `bash scripts/audit-schedulers.sh` 的输出，采样时间 `2026-10-13T13:18:08+08:00`，主机时区 `Asia/Shanghai`。**已核实 systemd 列表、部分 cron 数量、Docker 容器运行状态；尚未读取 n8n 内部工作流、完整系统 cron 与业务执行成功日志。** 列表中的 `LAST` 是 Timer 最近触发时间，不等于脚本成功。

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
| n8n 工作流已登记数 | 14 | `n8n list:workflow` 实际列出14个；10个用户标记非KDOS，4个未标记；是否启用尚未核实 |
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
| n8n Docker 容器 | 1 | `n8n_sqlite` 正在运行；14个工作流已列出，启用数仍未知 |
| KDOS Compose 容器 | 4 | `knplan-web-1`、`knplan-api-1`、`knplan-postgres-1`、`knplan-document-worker-1` 全部显示 healthy |
| 系统级其他任务 | 有 | 包括 `assistant-memory-auto.timer`、certbot、apt、logrotate、sysstat 等；归类系统管理，不擅自迁入 n8n |

**重点偏差**：`ERP-004/005/006` 投影 Timer 在生产已启用并于 `2026-10-13 13:05 CST` 触发；此前文档写“默认禁用”，该描述与当前生产状态不一致，迁移之前必须依据当前运行状态做评估。**优先检查**：`ERP-003` 科加订单是否同时由 n8n 每日工作流和每30分钟 systemd Timer 调度；服务器 `crontab` 的1条任务内容；财务同步 01:00 的首次正式执行情况。

## 已识别任务

| 任务 ID | 业务 / 调用入口 | 仓库中发现的触发定义 | 建议唯一归属 | 生产状态 | 后续动作 |
| --- | --- | --- | --- | --- | --- |
| FIN-001 | 财务E10客户同步；`automation/finance_customer_sync/main.py` | `kdos-finance-customer-sync.timer` 每天01:00 | n8n | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 优先迁移；138条初始客户保留；只增不覆盖分类 |
| IAM-001 | 企业微信通讯录；`automation/wecom_sync/main.py sync` | `kdos-wecom-contact-sync.timer` 每天03:00并开机后运行 | n8n | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 先验证备份、停用账号动作和漏跑补偿 |
| ERP-001 | E10 staging，来源`e10-main` | `kdos-erp-order-sync@.timer` 每30分钟 | n8n（后续） | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 核查来源游标、运行时间及重复入口 |
| ERP-002 | T+凯南 staging，来源`tplus-kainan` | 同一 Timer 模板每30分钟 | n8n（后续） | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | 独立来源、锁和失败处理 |
| ERP-003 | T+科加 staging，来源`tplus-kejia`；另有`sync-kejia-orders.sh` | systemd 模板每30分钟 + README 记载 n8n 每日入口 | n8n（后续） | TIMER_ENABLED / RUN_SUCCESS_UNVERIFIED | **重点排查双调度，禁止直接停任何入口** |
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


## n8n 工作流实测清单（2026-10-13，尚未核实激活状态）

数据来源：用户执行 `docker exec -u node n8n_sqlite n8n list:workflow`。此命令输出 ID/名称，不包含是否激活、节点命令或执行结果；“非KDOS”直接沿用用户标注，不自行推断。

| Workflow ID | 名称 | 归属判断 | 待核查 |
| --- | --- | --- | --- |
| `TT8raJ9ndXSOnTwb` | 异常费用_周五_8点 | 用户标注非KDOS | 保持隔离，不擅动 |
| `KvAkxw9G7cQB04Ml` | smth_每天_0:01 | 用户标注非KDOS | 保持隔离，不擅动 |
| `G4vti33loChqw1Oy` | 每天凌晨0点1分-续跑smth项目 | 用户标注非KDOS | 保持隔离，不擅动 |
| `dcIZAGhW34czEKtK` | 采购部_每天_8:05 | 用户标注非KDOS | 保持隔离，不擅动 |
| `HkvXfT4TRmkfUFoa` | tushare_每天_1:00 | 用户标注非KDOS | 保持隔离，不擅动 |
| `60KpNF39jSxZWpOR` | realtimesnap_每天_9:00 | 用户标注非KDOS | 保持隔离，不擅动 |
| `1IJnZF1gohWpW0Bo` | 接单入库_每天_8:10 | 待确认KDOS归属 | 核实激活状态、入口/目标 |
| `hBJ6rXRYNL30G2cs` | 资金流快照_每天_9:25 | 用户标注非KDOS | 保持隔离，不擅动 |
| `xpFmPPrX82dDyESJ` | SalesKpiReport_每天_7:00 | 用户标注非KDOS | 保持隔离，不擅动 |
| `IgBzE4MX0OZppDoO` | Database_每天_2点 | 待确认KDOS归属 | 是否备份、覆盖哪些数据库 |
| `JM2rgvwgbY06U86C` | 采购部_每天_16:55 | 用户标注非KDOS | 保持隔离，不擅动 |
| `e0dwMjv9OnWmcESk` | 设备管理上线进度 | 用户标注非KDOS | 保持隔离，不擅动 |
| `cfxCKnLl0YqRZYDj` | 同步科加数据_每天_1:00 | 待确认KDOS归属 | **对照ERP-003 systemd来源/脚本防双调度** |
| `ZaJp5jyD96075thE` | 同步品项_每天_00:05 | 待确认KDOS归属 | 是否关联研发物料；与历史00:10描述不一致 |

**合计**：14个已登记工作流，10个用户标注非KDOS，4个归属待查；**激活/发布数量未知**，不能称为14个在线调度。下一步使用只读 `n8n list:workflow --active=true`（先核查CLI支持情况）确认激活清单，再核对4个候选的调用链路，不公开完整凭据与工作流节点表达式。

## 运行时核查要求

主机脚本 `scripts/audit-schedulers.sh` 已在 2026-10-13 13:18 CST 执行（只读），systemd 和当前用户 cron **数量**已采集。下一步：只读审计 n8n 已激活工作流、时区、最近执行及 SSH 目标；在不泄露密钥的前提下确认用户 crontab 的任务类型；查看8个 KDOS Timer 对应 Service 的退出状态与最近成功时间；确认常驻 Dispatcher、备份、内部消费者；逐一登记 `active/enabled/next/last/result`。未核实项继续保留 UNVERIFIED_RUNTIME；在完成实际链路和风险评估前，不停用任何生产调度。

项目规范：`.agents/skills/kdos-task-orchestration/SKILL.md`。
