# 财务月度数据修复与每日汇总

`FinanceE10LiveOrderDuplicates1722920100000` 仅重建 `finance_e10_orders_all` 派生视图。按 tenant/source_database/source_order_id 聚合后，只有 `missing_lines < line_count` 的来源订单组参与同号重复判断。完全来源缺失的历史组继续保留，且仍因来源缺失不能进入月度。两个尚有有效品项的同号来源组仍需复核；其余冲突、序号、审核、材料单、异常及指定结束校验保持。依赖该视图的月度、统计大屏、排名、发生额和Excel采用同一判定，无需重新同步。

消息中心事件为 `finance.monthly.daily_summary`，资源 `finance-e10-monthly`，归属财务中心。系统管理员和财务模块管理员可配置；其他模块管理员不能管理此财务规则。事件和规则的模块显示、模块筛选从正式资源/事件注册表获得。

自2026-10-21起，每天08:30（Asia/Shanghai），n8n `KDOSFinanceMonthlySummaryV1`（KDOS 财务每日增量更新及月度汇总）经已有SSH凭据调用 `data-operations/e10/run-finance-daily.sh`：先调用既有 `sync-finance-movements.sh INCREMENTAL`，确认退出码0且返回SUCCESS，再调用 `push-finance-monthly-summary.sh`，进入 API 的 `FinanceMonthlyNotificationService.dispatch`。更新失败则不生成/推送汇总。08:30是整个流程的启动时间，消息在更新成功后发送，可能晚几秒或几分钟。汇总当月发生来源订单数、接单发生额（本币含税）、事业部订单数和金额（含待分类），并展示汇总时间与最近成功读取时间。读模型与新版15列月度页面相同，均为finance_e10_order_monthly_movements；汇总查询本身不读取ERP，每日编排的增量更新阶段按原FIN-003适配器读取E10。金额使用 PostgreSQL numeric/Decimal；空月份展示0单/0元。模板变量由事件registry提供。

初始化只创建一条停用的“财务月度数据每日汇总”规则，含默认模板、空接收对象，并记录审计。重复初始化保留已有启停状态、模板、接收对象和版本。上线后在“系统管理 → 消息中心”编辑该规则，选择组织、角色或员工、保存，再启用。规则停用时每日任务正常结束但不生成待发送消息。接收对象是管理员明确选择的财务汇总接收范围，不因此授予任何表格读取权限。

仅使用现有企业微信工作通知Dispatcher和默认自建应用；不会自动回退群机器人。消息按tenant+规则+上海业务日去重；主机flock及数据库事务advisory lock防并发，入队和业务查询在同一事务，投递失败继续由原消息中心的重试/日志处理。每天重复触发/手工补跑不会重复入队；08:30以前不提前发送。财务规则可以独立停用。已入队的投递失败使用消息中心重试，不能通过换去重键重发。

工作流模板为 `automation/finance_monthly_summary/workflow.template.json`，只包含非敏感任务定义；导入时选择现有KDOS主机SSH凭据，并让节点认证类型与凭据类型一致；本机沿用sshPassword，模板默认password，不包含密码。模板默认未激活，生产激活状态以台账和实际核验为准。财务只保留这个每日自动工作流；原 `KDOSFinanceMovementsV1` 已取消发布，保留用户编辑的手工节点和原始历史版本，不再每30分钟触发。其他工作流、Timer、cron、Dispatcher不变；新增自动任务定义0。

上线前完成两库/uploads备份、n8n一致性备份、合成PG回归和完整迁移重放，再执行标准迁移/部署/健康检查。初始化命令：`data-operations/e10/push-finance-monthly-summary.sh --initialize`；当日完整补跑：`bash data-operations/e10/run-finance-daily.sh`。仅校验更新而不推送：加 `--update-only`；此模式不生成通知，不修改规则启停/接收人。原独立汇总脚本仍可供维护人员单独补偿，但它不会先更新数据，不作为日常入口。CLI仅输出状态/入队计数，不输出财务内容或凭据。用户选择接收人前只验证停用路径，不能声称真实企业微信已送达。

回滚：只停用新增n8n工作流并回退应用；保留新规则、历史快照和投递审计。视图migration的down仅恢复之前派生规则，不修改真实来源行；恢复旧规则会重新出现已知漏计，需按实际故障决定，不能随应用回滚自动执行。失败补偿为核查n8n失败记录与消息中心、同日手工补跑；跨日不伪造历史汇总。

现有规则配置不自动覆盖，新默认金额标签为“本月接单发生额”；已保存模板如仍写“本币总金额”，管理员启用时可改名，变量orderTotal现表示当月发生额。日常只需一个SSH命令：

```bash
bash /data/automation/code/work/PMC/knweb/data-operations/e10/run-finance-daily.sh
```

主机日流程flock串联两阶段，各子命令仍保留原锁；每日一次是自动触发频率，失败重试和明确的手工补跑不受此限制。重复汇总沿用消息中心当天去重键，不重复生成通知。脚本仅支持INCREMENTAL，不接受FULL；更新失败、无效返回或并发冲突均返回非0，由n8n保留失败执行，财务读取批次也显示失败。维护人员先排查运行记录再补跑；已入队后的投递错误使用消息中心重试。

2026-10-21在线切换通过n8n受权限及checksum保护的REST接口完成，未重启n8n，未中断其他正在运行的任务。受控实跑1240仅运行一次真实增量并跳过通知，规则按用户当时已保存的启用状态及接收人原样保留。下次定时为2026-10-22 08:30上海时间；首次未来自动触发尚待观察，不能将受控执行冒称定时触发或企业微信已送达。

调度回滚：使用n8n历史版本，将FIN-004发布回本次变更前的08:30独立汇总版本，再按原记录发布FIN-003原activeVersionId；必须作为显式回滚操作，防止同时激活每日串联和每30分钟旧入口。不恢复数据库备份覆盖后续数据；保留已成功增量和通知审计。私有备份和版本ID仅保留在本机受限证据目录。

## 每日财务Excel附件（2026-10-21）

用户确认增加的是每天08:30财务通知中的当月月度数据Excel。文件名按报告发生月份生成：`2026年10月接单统计-生管.xlsx`（1月不补零，跨年随报告年份变化），网页下载文件名不变。发布前为文字汇总；本轮在既有文字后增加私有Excel附件。

新日事件增加`financeReportFormat:1`，原租户/规则/业务日去重键不变；没有此标记的旧事件及消息中心通用文字测试继续按原文本处理。事件登记为text_file，但不覆盖已保存规则中的text、接收人、模板、启停或版本。每日调度和金额口径不变，不新增任务或数据库migration。

`FinanceMonthlyFileService`在领取阶段使用正式`finance_e10_order_monthly_movements`与已登记的月度导出源、15个业务字段、字段显示值、金额文本精度及稳定排序。单个REPEATABLE READ事务将当月数据物化为临时表，分页及各接收人文件共用快照；文字汇总使用同事务现有summary计算。接收人由原规则动态解析，逐个使用实时IAM的读取、导出、字段权限和read∩export数据范围；不自动授权，也不借用调度管理员的身份导出。20MB或标准导出行数上限超过时明确失败，不截断。无导出权限的接收人记录FINANCE_MONTHLY_EXPORT_FORBIDDEN，其他有效接收人不受影响。

附件复用notification_attachments，按接收人保存不可变内容、SHA256及权限指纹；text/file:1分别记投递状态。失败只重试未成功组件，原文件不随次日数据变化重新生成，不重新入账。重试不追加新接收人，移除接收人后旧文件不可下载。投递前再次校验当前租户、启用规则、领取worker、当前成员/企微身份、待投递组件、实时权限指纹及文件SHA；权限变化后禁止发送旧附件。权限修复后以下一次正式日报重新生成为准，不能承诺重新构建历史冻结文件。

新受控下载为`GET /internal/notifications/:id/finance-attachments/:attachmentId`，沿用内部token、tenant及worker校验，不提供公开链接。响应使用UTF-8 Content-Disposition及no-store。Dispatcher仅增加上述财务文件名和路径白名单；PMC原路径、映射、文件、文本和发送逻辑保持。上线时需要标准API/Web部署及`scripts/deploy-notification-dispatcher.sh`更新现有常驻消费者，不新装调度器。

权限处理：初次核验发现现有预设“查看全部数据”组不含导出、仅9字段。用户随后明确授权仅为指定2名接收人补齐，因此通过正式权限Application API创建独立CUSTOM组，只授予read/export及15个业务字段读取，保留原ALL数据范围，不含新增/修改/删除等写权限；原共享组及其他权限组不变，写入已有审计。实际2/2接收人已通过实时IAM及受控回滚预览（每人436行、15字段、金额一致）。验证不向真实员工发送测试消息；最后上线版本和Chrome结果以验收报告为准。
