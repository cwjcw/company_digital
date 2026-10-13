# KDOS 自动化任务台账 / TASK REGISTRY

更新时间：2026-10-13。数据来源：GitHub `company_digital` 主分支仓库文件盘点；**未连接生产 Ubuntu 或 n8n 运行时**。本表中的“已找到”不代表正在运行。

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
| Timer 候选实例 | 8 | 财务1、通讯录1、staging按三来源3、projection按三消费者3；生产实际实例数量未知 |
| 常驻 Dispatcher 的 systemd Service | 1 | 不属于定时任务 |
| systemd Service 文件 | 6 | 财务1、通讯录2、ERP staging/projection 模板2、常驻 Dispatcher1；不是6个实际启用服务 |
| n8n 工作流运行数 | 未知 | 不能仅从仓库 SSH 示例得出，需连 n8n 查看 |
| cron 任务数 | 未知 | 需读取服务器当前用户及系统 cron |
| 应用内部 scheduler | 未核实 | 需运行时和代码额外审计 |

**注：仓库共有6个 `.service` 文件**（财务1、通讯录2、ERP staging1、ERP projection1、Dispatcher1）。Template 与启用实例要分开统计。

## 已识别任务

| 任务 ID | 业务 / 调用入口 | 仓库中发现的触发定义 | 建议唯一归属 | 生产状态 | 后续动作 |
| --- | --- | --- | --- | --- | --- |
| FIN-001 | 财务E10客户同步；`automation/finance_customer_sync/main.py` | `kdos-finance-customer-sync.timer` 每天01:00 | n8n | UNVERIFIED_RUNTIME | 优先迁移；138条初始客户保留；只增不覆盖分类 |
| IAM-001 | 企业微信通讯录；`automation/wecom_sync/main.py sync` | `kdos-wecom-contact-sync.timer` 每天03:00并开机后运行 | n8n | UNVERIFIED_RUNTIME | 先验证备份、停用账号动作和漏跑补偿 |
| ERP-001 | E10 staging，来源`e10-main` | `kdos-erp-order-sync@.timer` 每30分钟 | n8n（后续） | UNVERIFIED_RUNTIME | 核查来源游标、运行时间及重复入口 |
| ERP-002 | T+凯南 staging，来源`tplus-kainan` | 同一 Timer 模板每30分钟 | n8n（后续） | UNVERIFIED_RUNTIME | 独立来源、锁和失败处理 |
| ERP-003 | T+科加 staging，来源`tplus-kejia`；另有`sync-kejia-orders.sh` | systemd 模板每30分钟 + README 记载 n8n 每日入口 | n8n（后续） | UNVERIFIED_RUNTIME | **重点排查双调度，禁止直接停任何入口** |
| ERP-004 | `sales-orders-v1` 投影消费者 | `kdos-erp-projection@.timer` 每30分钟05/35 | 已验证消费者 / 后续 KDOS Worker | UNVERIFIED_RUNTIME（文档说默认禁用） | 先确认准入、启用状态和业务验收 |
| ERP-005 | `finished-goods-inbound-v1` 投影消费者 | 同一 Timer 模板 | 已验证消费者 / 后续 KDOS Worker | UNVERIFIED_RUNTIME | 不擅自开启 |
| ERP-006 | `finished-goods-outbound-v1` 投影消费者 | 同一 Timer 模板 | 已验证消费者 / 后续 KDOS Worker | UNVERIFIED_RUNTIME | 不擅自开启 |
| RD-001 | E10研发物料；`data-operations/rd-sync/sync-rd-items.sh` | 仓库有受控脚本；既有 n8n SSH 方案 | n8n | UNVERIFIED_RUNTIME | 验证工作流 ID/启用及最近成功 |
| EQ-001 | 设备治理日报；`equipment-governance-daily/report.py` | README提供 n8n SSH 命令；无本仓库 Timer | n8n | UNVERIFIED_RUNTIME | 检查是否正式激活、正式发送权限 |
| MSG-001 | 企业微信 Dispatcher；`dispatcher.py` | 常驻 systemd Service，轮询约1秒 | systemd Service | UNVERIFIED_RUNTIME | 保留常驻，不迁 n8n |
| OPS-001 | PostgreSQL 与上传文件备份；`scripts/backup.sh` | 只确认脚本，未发现仓库定时器 | systemd Timer | UNVERIFIED_RUNTIME | 核实生产备份策略、日志与恢复测试 |
| OPS-002 | DWG本地索引 | 本仓库未发现定义；历史服务器命令显示 `dwg-index-update.timer` | systemd Timer（初步） | UNVERIFIED_RUNTIME | 到生产机核实、登记入口 |
| SUP-001 | T+供应商导入；`automation/tplus_supplier_import/extract.py` | 脚本存在、仓库未确认周期触发 | n8n（若周期化） | UNVERIFIED_RUNTIME | 不自行激活 |
| MPS-001 | 主计划 E10研发进度；`data-operations/e10/run-pmc-rd-progress-sync.cjs` | 有脚本，未确认调度 | n8n（若周期化） | UNVERIFIED_RUNTIME | 不自行激活 |
| TPLUS-001 | T+销售接单明细；`data-operations/tplus/sync.mjs` | 有脚本，未确认调度 | n8n（若周期化） | UNVERIFIED_RUNTIME | 核查是否与 ERP staging 重叠 |

## 运行时核查要求

须执行仓库脚本 `scripts/audit-schedulers.sh`（只读），补充 n8n 管理端已激活工作流、时区、最近执行、对应 SSH 命令；逐一记录 `active/enabled/next/last`。只读脚本不宣称涵盖 n8n，也不执行、启停、修改任何定时任务。完成后纠正本台账中所有 UNVERIFIED_RUNTIME，再对具体迁移方案做风险评估。

项目规范：`.agents/skills/kdos-task-orchestration/SKILL.md`。
