---
name: kdos-task-orchestration
description: KDOS/凯南数字化项目的自动化任务与调度治理。涉及定时任务、systemd Service/Timer、cron、n8n、SSH 脚本、E10/T+ 同步、企业微信通知、备份、ERP 投影、知识库 Worker、排程迁移、运行监控、任务台账和故障恢复时必须使用本 Skill。先盘点再变更；禁止未经验证双重调度。
---

# KDOS 自动化任务与调度治理（强制规范）

## 0. 适用范围与唯一台账

- 本规范适用于整个 `company_digital / KDOS` 项目，不局限于财务中心。
- 任何新增、修改、迁移、停用、删除、临时补跑定时任务的工作，先阅读本 Skill、`AGENTS.md` 和 `docs/operations/TASK_REGISTRY.md`。
- `docs/operations/TASK_REGISTRY.md` 是“已知任务身份与调度归属”的唯一登记簿；模块 README 只保留自身操作说明，不能另立互相冲突的调度权威。
- 服务器上实际启用状态须由运行时审计确认。仓库中的 `.timer`、README、n8n 工作流示例、脚本存在，不等于任务正在运行；禁止把候选模板数量写成在线任务数量。
- 每次相关任务发生变化，必须同一工作项更新台账（任务 ID、归属、唯一调度器、工作流/服务名、周期、时区、代码入口、数据源、运行身份、锁/幂等、重试/补偿、告警、最近验证日期/证据、状态、责任人）。

## 1. 调度器选择（优先级规则）

先判断**执行本质**，不是只看“它能否被定时启动”：

1. **服务器基础设施 / 持续性守护进程**：systemd Service 或 Docker Compose restart（例如 Docker/SSH/ZeroTier、n8n 本身、PostgreSQL/API/Web、企业微信 notification Dispatcher、宿主机基础设施监控）。不得为了统一入口把常驻服务变成 n8n 的循环触发任务。
2. **独立于 n8n 的灾难恢复与底座保养**：systemd Timer 或成熟系统原生调度（数据库备份及离机复制、备份校验、证书续期、存储/日志维护、n8n 自身存活监控、主机本地索引）；即使 n8n 故障仍应运行。敏感任务优先最小权限、固定审计日志、保留与恢复演练。
3. **业务定时、ERP/E10/T+ 数据采集、跨应用编排、报表与定时消息**：默认唯一调度器为 n8n（Schedule Trigger、Webhook 或业务事件）；调度统一可视化。n8n 通过已维护的 SSH/HTTP 受控入口触发原脚本或 API，脚本与 KDOS Application Command 负责业务校验和数据写入。不得让 n8n 直接修改业务表、复制 SQL Server/企业微信密码或实现第二套业务规则。
4. **事务性业务异步、事件驱动高频消费、outbox、投影及文档转换**：优先由已有 KDOS API/Worker/持久消费者或独立常驻服务执行；n8n 最多负责低频启动/监督。当前 `apps/worker` 仍是初期接口边界，不得假定通用队列/事件消费者已经上线；保留已验证的现有执行方式，按专项方案渐进迁移。
5. **手工调试/一次性迁移**：不自动安排周期任务；需要时按变更单人工执行。不要为一次性命令新增 Timer。

例外：高频（分钟级）、严苛时延、强事务依赖、故障时必须脱离 n8n 的任务可以保留 systemd / 服务内部消费者，但必须在台账写明原因、唯一负责人和替代监控。不要机械地把所有任务移入 n8n。

## 2. 唯一调度源与安全边界

- 同一逻辑任务只允许**一个生效的自动触发源**；systemd Timer、用户 Timer、crontab、容器 cron、n8n、应用内 scheduler 均算触发源。允许 n8n 调用 systemd 管理的常驻服务或受控 oneshot，但不得有两个互不协调的定时入口。
- 禁止只删除 README 就认为停用了 Timer；禁止只创建 n8n 工作流就宣布迁移完成。
- 独立数据源或租户可有多实例，但每个实例必须独立任务 ID、来源、锁、幂等/游标和告警，不能误认为重复任务。
- 数据写入只经 KDOS 正式 Application Commands / 受控 API；ERP 读取用已验证的只读适配器；保留原始时间口径、增量游标、重叠窗口、审计、租户隔离。
- 每个业务任务必须有非并发保护（`flock` / DB advisory lock / lease）、幂等键、明确超时和可判定成功/失败的退出码或结构化返回；n8n 收到失败不得走成功分支。
- 凭据只存在受限 `.env` / Credential / Secret Store；SSH 账号和 API Key 均为最小权限。不得把账号密码、Token、完整数据行写入 n8n 命令或日志。
- 业务时间统一 `Asia/Shanghai`，n8n Workflow 和 Schedule Trigger 都核查时区；不得拿 UTC、浏览器时间、主机本地时区默认为业务日。
- 所有周期业务任务必须有失败报警、最近成功时间、执行次数/耗时与处理计数；对于错过窗口有补偿机制（持久增量游标、幂等重放、受控手动补跑），不能假设 n8n 重启会自动补跑。

## 3. 必须执行的盘点步骤

先采集真实生产证据（只读），覆盖：
- systemd 系统级和 `--user` 的 list-timers/list-unit-files、启用/active 状态、下一次执行、服务日志、用户 linger；
- 当前用户 crontab、系统 crontab、`/etc/cron.*`，及 Docker/进程内定时器的入口；
- n8n 已激活与禁用工作流：ID、名称、Schedule、时区、最后一次执行、节点调用目标；不得从仓库 README 推断实际启用；
- Docker/Compose 服务状态、持续运行的 Dispatcher/Worker，区分常驻与周期任务；
- 任务目标命令、账套/租户、锁文件和数据投影链路，识别不同调度器调用同一脚本的重叠。
可先运行 `scripts/audit-schedulers.sh` 收集**脱敏的主机摘要**；n8n 仍须在 UI/API 额外核查。没有服务器/ n8n 实时访问时，台账标注 `UNVERIFIED_RUNTIME`，不得虚报“已关闭、已运行、共 N 个在线任务”。

## 4. 定时任务上线 / 迁移门禁

1. 记录现状：代码入口、完整调度链路、运行用户、实测状态、最近成功执行、业务依赖、备份和风险。
2. 选择目标调度器并在台账登记目标、依据与优先级；仅将调度层迁移，复用现有脚本/API/数据库事务，禁止无关重构。
3. 在不修改真实数据规则的前提下完成只读测试、单次受控执行、错误分支、重复/并发/断网/补偿测试；校验日志无密钥。
4. 切换时采用**一个权威入口**：在可控窗口停用旧自动触发、启用新工作流；安排必要的业务窗口保护，避免同时运行和遗漏。对已启用的生产调度器操作前，必须有影响评估、回滚方案、用户批准或既有变更授权。
5. 验收要检查 n8n 激活状态、旧 Timer/cron 真实 `disabled/inactive`、下一次触发时间、一次真实成功执行、业务数据前后差异、跨账套隔离、最近成功记录、告警及回滚路径。
6. 如果外部依赖不通、生产环境不可读、调度器无法切换，则停止在安全状态；只报告已修改的代码和仍未完成的运行时步骤，不能写“上线 PASS”。
7. 修改模块 README、`docs/operations/TASK_REGISTRY.md`，必要时更新运维 Runbook；向用户交付实际任务清单、变更依据、检查命令、测试结果和未确认项。

## 5. 当前已知边界与优先核查对象（非在线状态断言）

- 财务客户同步：`automation/finance_customer_sync/main.py`；仓库中存在每日 01:00 Timer，目标迁入 n8n；保留 E10 2026-10-13 起创建/修改筛选、138 条初始客户和人工分类不覆盖规则。
- ERP 三账套 staging：`data-operations/order-sync` 存在 30 分钟 `kdos-erp-order-sync@.timer`；科加单入口也在 README 中声明用于 n8n。迁移前务必逐实例排查是否重复调度。
- ERP 投影：存在 `kdos-erp-projection@.timer`，文档注明默认禁用；不得擅自启动或移动未验收消费者。
- 企业微信通讯录：`automation/wecom_sync` 存在 03:00 Timer；实际启用情况以服务器为准，因同步含停用账号动作，迁移必须验证差异和补偿。
- 研发物料：`data-operations/rd-sync/sync-rd-items.sh` 为 n8n SSH 可用的受控同步入口。
- 企业微信通知 Dispatcher：`automation/wechat_push_projects/kdos-notification-dispatcher` 是约 1 秒轮询的常驻 systemd Service，继续保留。
- 设备日报：`automation/wechat_push_projects/equipment-governance-daily` 提供 n8n SSH 指南，不能据此推断调度已经激活。
- 主机外部的 DWG 索引 Timer、数据库备份 Timer 和其它未入库作业都必须纳入生产审计，不能从 GitHub 单独盘全。

## 6. 验收输出格式

必须输出两类数量：**仓库已发现的调度定义/候选任务数**及**服务器确实已启用的逻辑任务数**，逐类统计 n8n / systemd Timer / cron / 常驻服务 / 内部消费者；无法核实的标为待核实，不可合并为“已运行总数”。
