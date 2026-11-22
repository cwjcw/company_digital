# 异常费用独立订单与分类运行说明

2026-11-21。业务契约见 `docskill/流程审批/异常费用/订单表.md`、`基础资料/异常费用分类.md` 及主单文档本轮补充。

- 入口：流程审批→异常费用→订单表 `/workflow/abnormal-cost/orders`；基础资料→异常费用分类 `/workflow/abnormal-cost/expense-categories`。原责任归口异常类别不变。
- Migration137：独立订单、来源行、同步运行、来源切换日志、费用分类五表，tenant RLS；主单新增品号数组、整数异常数量、费用大类、二级数组和内部校验版本；历史明细附件允许NULL，保留旧引用。无破坏性down。
- 既有预置主单权限组的四个新增必填字段继承原订单字段的read/update，保留成员/部门/角色/动作/范围，新增字段逐项审计。自定义组不扩权，管理员在原权限管理配置新字段；新独立表/分类表不自动授予成员。
- 三ERP仅通过只读适配器和既有basic_code.MSSQLDatabase读取。E10凭据在工具包，T+沿用现有受限服务端配置。容器使用既有只读工具包挂载、原Python/pytds和现有T+socket；无新服务、端口或数据库。Docker显式复制新reader目录，不复制outputs/业务证据。
- E10订单/明细审核Y，0/2未结束/正常结束保留，指定结束1（头/明细计划）排除；T+要求auditeddate有值、189审核且isCancel=NULL/0，无头CloseDate/Closer及行IsClose/IsCCClose中止；实查231均为中止，排除。完整交付而未中止的189保留，不按欠数过滤。数量E10明细BUSINESS_QTY/T+明细quantity，日期E10 ORDER_DATE/明细PLAN_DELIVERY_DATE、T+voucherdate/客户交期NULL。不取制造计划完成日期。
- 三来源自2026-01-01按原始行ID分页，两次完整读取SHA256一致才接受；对不完整CT/删除增量采取有界完整读取＋差异发布。原始行ID去除JOIN重复；真实多明细精确加总，同源最早有效交期并保留冲突，跨源整行E10>凯南>科加。三来源都成功才能单事务发布，不修改其它订单模块。来源切换保留日志，失效采用软标记，固定虚拟行独立保护。
- 分类仅在Migration137幂等初始化；日常ERP同步不重新创建管理员已删除/改名的分类，也不覆盖启停状态。
- 新任务 `AbnormalCostOrdersDailyV1` 每日02:30 Asia/Shanghai；手工重放仍走同一SSH→CLI→Application Command。n8n定义默认inactive，完成受控执行后才发布激活。原工作流均保留。主进程advisory lock防并发，发布与表单验证共享/独占事务锁；每来源最多两次、每次180秒，整命令1200秒，工作流1500秒。
- 正常执行：`docker exec knplan-api-1 sh -lc 'cd /app/apps/api && env ABNORMAL_ORDER_TENANT_ID=KAINAN node dist/abnormal-order-sync-cli.js'`。只返回运行ID/来源结果/计数，不输出业务行或凭据。失败非0，旧快照保留，记录各来源和整体失败，经现有 `erp.sync.failed` 规则与通知Dispatcher报警。n8n包装在异常退出后调用 `REPORT_FAILURE`，仅在取得同一锁后补记未完成运行及幂等告警，不篡改仍在运行的任务。
- 异常责任待判定通知：新增主单时按每条关联待判定记录通知当前判定人；主单字段或待判定配置字段实际改变时，同事务向所有当前仍为PENDING的关联判定人重新写入待判定outbox。责任判定记录直接编辑后，如任一字段实际变化且仍为PENDING，也向当前判定人推送。判定人调整后只通知新判定人；完成/删除记录不通知；无实际变化的重复保存不重推。业务修改与通知同事务提交/回滚，使用主单/判定记录新版本区分每次编辑的去重键。
- 补偿：受控手工重跑完整对账，不依赖不可靠修改水位；重试不改变未变化记录的版本/业务更新时间。n8n重启不会自动补偿历史窗口，应检查最近成功时间再手动重跑。页面只读取快照/状态，不能触发ERP抓取。
- 回退：停用本轮新n8n工作流，再恢复发布前API/Web镜像；保留新增表、历史附件、已同步订单和分类。已创建无明细附件的新单使旧应用不再兼容新增操作，优先前向修复；不得重新恢复detail_attachment NOT NULL或覆盖生产库。备份以异常费用表、权限/审计和迁移账本、n8n定义/数据库及旧镜像为范围，不做无关全量备份。

生产证据保存在受限且Git忽略的 `outputs/abnormal_cost_orders_release/`。实际运行版本、执行ID、数量及验收结果以最终报告为准；未进行人工生产写入测试，不把隔离测试说成真实业务提交。

字段核查补充：服务器既有 `/data/automation/code/sql/TplusSQL/50_双账套有效订单统一报表.sql` 明确把明细deliveryDate作为产前评审交期，客户要求交期返回NULL；真实eap_DTOProperty显示CloseDate为“中止时间”，现有10/40订单SQL标注IsClose为行中止。当前客户交期为空是已知源映射缺口，不能用评审交期或生产日期补造。E10沿用标准销售订单明细的预交日期。需业务确认真正的T+客户交期字段后再补只读映射，无需改主单结构。
