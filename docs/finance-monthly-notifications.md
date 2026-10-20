# 财务月度数据修复与每日汇总

`FinanceE10LiveOrderDuplicates1722920100000` 仅重建 `finance_e10_orders_all` 派生视图。按 tenant/source_database/source_order_id 聚合后，只有 `missing_lines < line_count` 的来源订单组参与同号重复判断。完全来源缺失的历史组继续保留，且仍因来源缺失不能进入月度。两个尚有有效品项的同号来源组仍需复核；其余冲突、序号、审核、材料单、异常及指定结束校验保持。依赖该视图的月度、统计大屏、排名、发生额和Excel采用同一判定，无需重新同步。

消息中心事件为 `finance.monthly.daily_summary`，资源 `finance-e10-monthly`，归属财务中心。系统管理员和财务模块管理员可配置；其他模块管理员不能管理此财务规则。事件和规则的模块显示、模块筛选从正式资源/事件注册表获得。

每天08:30（Asia/Shanghai），n8n `KDOSFinanceMonthlySummaryV1` 经已有主机SSH凭据调用 `data-operations/e10/push-finance-monthly-summary.sh`，再运行 API 内的 `FinanceMonthlyNotificationService.dispatch` Application Command。汇总当月有效订单数、本币含税金额、事业部订单数和金额（含待分类），并展示汇总时间与最近成功读取时间。读模型与月度页面相同，不触发ERP读取。金额使用 PostgreSQL numeric/Decimal；空月份展示0单/0元。模板变量由事件registry提供。

初始化只创建一条停用的“财务月度数据每日汇总”规则，含默认模板、空接收对象，并记录审计。重复初始化保留已有启停状态、模板、接收对象和版本。上线后在“系统管理 → 消息中心”编辑该规则，选择组织、角色或员工、保存，再启用。规则停用时每日任务正常结束但不生成待发送消息。接收对象是管理员明确选择的财务汇总接收范围，不因此授予任何表格读取权限。

仅使用现有企业微信工作通知Dispatcher和默认自建应用；不会自动回退群机器人。消息按tenant+规则+上海业务日去重；主机flock及数据库事务advisory lock防并发，入队和业务查询在同一事务，投递失败继续由原消息中心的重试/日志处理。每天重复触发/手工补跑不会重复入队；08:30以前不提前发送。财务规则可以独立停用。已入队的投递失败使用消息中心重试，不能通过换去重键重发。

工作流模板为 `automation/finance_monthly_summary/workflow.template.json`，只包含非敏感任务定义；导入时选择现有KDOS主机SSH凭据。模板默认未激活，生产激活状态以台账和实际核验为准。新自动入口只有这个n8n工作流，不新增Timer、cron或应用定时器，不调整既有任务。

上线前完成两库/uploads备份、n8n一致性备份、合成PG回归和完整迁移重放，再执行标准迁移/部署/健康检查。初始化命令：`data-operations/e10/push-finance-monthly-summary.sh --initialize`；当日补跑：同脚本不传参数。CLI仅输出状态/入队计数，不输出财务内容或凭据。用户选择接收人前只验证停用路径，不能声称真实企业微信已送达。

回滚：只停用新增n8n工作流并回退应用；保留新规则、历史快照和投递审计。视图migration的down仅恢复之前派生规则，不修改真实来源行；恢复旧规则会重新出现已知漏计，需按实际故障决定，不能随应用回滚自动执行。失败补偿为核查n8n失败记录与消息中心、同日手工补跑；跨日不伪造历史汇总。
