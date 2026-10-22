# 财务每日增量及消息中心汇总编排验收

状态：已完成，生产调度/受控更新/正式部署/健康检查/GitHub同步通过。

按用户本轮授权，每天08:30（Asia/Shanghai）启动一次：INCREMENTAL更新 → 成功校验 → KDOS消息中心生成当月汇总 → 原企业微信Dispatcher投递。08:30是流程启动时间，实际消息在更新成功之后发送。无新增n8n企业微信发送节点、无新金额算法、无FULL。

生产保留 `KDOSFinanceMonthlySummaryV1`，改名“KDOS 财务每日增量更新及月度汇总”；其已发布版本和当前版本一致，唯一cron为 `30 8 * * *`，正式SSH命令为：

```bash
bash /data/automation/code/work/PMC/knweb/data-operations/e10/run-finance-daily.sh
```

旧 `KDOSFinanceMovementsV1` 原每30分钟发布版本已在线取消发布，active=false/activeVersionId=null；用户原3个手工节点、连接和版本未覆盖。10:07旧触发窗口后确认没有再自动执行。手工补跑仍可显式执行，不计入每日自动触发次数。

新主机串联锁与原子命令各自锁并存；失败/无效返回/并发返回非0，禁止进入汇总。汇总沿用当日业务去重键，投递错误使用消息中心原重试。仅验证更新使用 `--update-only`，正式工作流不含此参数。

9项合成测试及shell语法检查通过，覆盖先更新后汇总、更新/汇总失败、无效返回、防并发、固定增量、无通知验证、唯一08:30入口及n8n结果校验器。真实n8n受控执行1240 SUCCESS，实际Application INCREMENTAL成功；验证时明确UPDATE_ONLY_NO_NOTIFICATION、入队0。用户已启用的财务规则（版本7，1个接收对象）及全部通知规则逐项原样保留；未发送测试消息。

通过受权限/checksum保护的在线API切换，不重启n8n。原无关长任务1236仍在运行；其他14个工作流定义、启停及发布版本逐项相同。总数仍16，active由12变为11，财务自动入口由2变为1。仓库既有工作流模板修改1，新增调度定义/候选0；systemd/cron/常驻服务/应用内部调度新增或修改0。

备份：095740两库自定义格式及uploads归档、n8n一致SQLite及两个工作流当前/发布版本快照，均仅存本机受限data路径。回滚按台账恢复原发布版本，避免新旧同时自动运行，不覆盖业务数据库。

下次自动触发：2026-10-22 08:30上海时间。尚未观察未来首次定时触发，不将受控执行冒称已定时推送或企业微信已送达。财务/PMC应用行为未改；Web/API/Repository/GitHub main一致：eb4fb76b76f2551858da4d09818eb28bdac81f4b。正式健康检查通过，生产SSH入口内容与Git提交一致。
