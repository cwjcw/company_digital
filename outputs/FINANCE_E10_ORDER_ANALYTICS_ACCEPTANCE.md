# 财务中心 E10 销售订单统计线上验收

状态：已完成 / 已备份部署 / 真实E10验收PASS / GitHub已推送。
验收日期：2026-10-14（Asia/Shanghai）。
完整commit及部署版本：`e35d453154482fbd62863db346f776a425582d2b`。
GitHub：[e35d453](https://github.com/cwjcw/company_digital/commit/e35d453154482fbd62863db346f776a425582d2b)；分支 `github/main`，远端完整SHA与本地一致，无强推。
最终Repository/API/Web/Document Worker版本一致；Postgres/API/Web/Worker四服务healthy，标准健康检查PASS；原PG18卷、内部postgres:5432、主机127.0.0.1:15433保留。

## 使用入口

财务中心 → 销售订单统计 → 系统导出 / 月度数据 / 统计大屏。

- [系统导出](http://192.168.1.249:15172/finance/orders/system-export)：34个原中文字段、统一筛选分页/下载、手动全量/增量/断点、批次和异常日志，无Excel上传。
- [月度数据](http://192.168.1.249:15172/finance/orders/monthly)：9个原中文字段，按来源订单键汇总；分类精确关联现有财务客户对应表。
- [统计大屏](http://192.168.1.249:15172/finance/orders/dashboard)：内外销、四事业部、客户前10/20/全部、12月趋势、累计额/订单数/平均额/待分类、分类交叉矩阵、筛选和下钻。

## 实际数据与金额

来自真实E10只读查询，`ORDER_DATE >= 2025-01-01`，无审核/结束码预筛除，不使用Excel初始化。实际2025首单日期2025-01-02，2026首单2026-01-01；源最大日期2026-10-14。来源账套E10_6.0.0.1.NEW.CHS，本位币RMB。
最后成功源观察时间：`2026-10-14T09:58:51.740`（E10数据库本地时间）；读取方式READ COMMITTED，非ERP历史一致性快照。

| 年度 | 源品项 | 有品项订单 | 源本币含税额/元 | 有效统计订单 | 统计本币总金额/元 | 暂缓订单/金额元 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2025 | 60,332 | 10,142 | 592,274,631.13 | 10,140 | 592,244,440.13 | 2 / 30,191.00 |
| 2026 | 46,316 | 8,668 | 507,757,600.79 | 8,664 | 507,697,093.29 | 4 / 60,507.50 |

全年渠道、事业部、客户全部排名、12个月、交叉矩阵和累计总额逐项精确勾稽；源总额=有效统计总额+显式暂缓金额。前10/20与全部排名前缀一致，客户筛选金额等于对应年度排名，1月筛选等于年度月度表1月金额。最终明细106,648，有效统计18,804单，来源键无重复，成功发布临时页0。

用户确认的交期规则已执行：612单交期冲突整单金额保留，订单日期字段不变，预交货日NULL；月度页面、异常日志及大屏明确标冲突，9列Excel交期为空单元格。初始只读探针611单，真实初始化时新增源记录使数量为612；规则一致应用。
现有财务客户映射与报表分类差异0；未匹配或空分类保留待分类并纳入总额。原138条客户映射未覆盖或补入其它历史客户。全年分年待分类指标见 `FINANCE_ORDER_REAL_ACCEPTANCE.json`。

## 数据质量与边界

- 6张订单实际缺交货计划，90,698.50元暂缓月度统计；34列明细仍完整保留，已交数量/结束码保持NULL，无伪造0。异常日志可复核。不能把源总额与有效统计差额隐藏。
- 10个负金额源品项保留并标异常；零金额订单保留。
- 24张没有品项的订单头仅记录在来源批次覆盖摘要，未虚构品项或整单金额。
- E10主档更名但订单修改日期未更新、源删除记录须手动全量复核；源消失只标缺失并保留历史，不自动当作取消。新周期刷新未获本轮要求，故只支持显式手动刷新，未增改任何现有调度。
- 在线使用现有管理员及非财务用户的短期维护JWT，经真实AuthGuard重新解析既有权限；未修改密码、角色或授权，不宣称密码登录或独立财务编辑账号的生产正向验收。财务只读/字段受限/跨租户正向与拒绝场景由真实隔离PG及Chrome合成角色测试覆盖。

## 幂等、恢复、安全

首轮成功全量：214页/106,648行/变化106,648。第二轮真实全量：214页/106,648行/变化0；源金额、行数、业务版本合计和品项审计数完全一致。增量初测SUCCESS/0行0变化；最终增量SUCCESS/28行/变化28。没有修改E10，未写测试订单。
首次容器探针失败在0页0行，未发布数据：工具包顶层入口附带WeChat依赖，按既有rd_reader使用同工具包sql_server.MSSQLDatabase直接入口修复，未新增依赖或复制凭据。失败批次保留；后续实际初始化/全量/增量成功。
租户RLS/FORCE、security_invoker、字段读权限、类型化金额数据范围、刷新全部更新范围、分页/候选/导出授权统一；实际非财务用户5个列表/导出/大屏/刷新端点403，匿名401。敏感源页/异常未输出到公开仓库；后台失败不暴露凭据/源整行。
原财务客户/PMC/Knowledge的15张保护表逐行完整哈希与数量完全一致。原ERP staging/正式订单/PMC/主计划和定时任务源码没有改动。

## 验证

- API：104套911项通过，1个既有skip；Web：47文件364项通过。
- 隔离PostgreSQL18：新统计19场景、原客户表20场景，fresh至90号迁移和完整Nest启动通过；无生产测试fixture。
- Python只读适配器3项；真实Chrome合成角色9项通过。线上真实Chrome：3页、34/9原表头、成功批次、3图表/12个月、冲突提示、客户年度下钻、真实饼图点击、1440/390布局、无API500通过。生产屏幕无录屏、trace或截图。
- API/Web/契约质量检查和构建通过；保留原Web Fast Refresh及大包提示，没有新增错误。财务模板数值导出验证8位小数及超安全整数范围金额不丢位，NULL为空格。
- 完整真实xlsx经实际平台导出、ZIP校验、XML逐行解析、中文表头/全部行数/精确金额和交期空单元格检查，结果如下。真实文件保存在受限本机 `data/finance-order-acceptance/`，不提交GitHub。

| 下载文件 | 中文列数 | 数据行 | 金额/元 | 结果 |
| --- | ---: | ---: | ---: | --- |
| finance-e10-lines.xlsx | 34 | 106,648 | 1,100,032,231.92 | PASS |
| finance-e10-ranking-2026.xlsx | 2 | 193 | 507,697,093.29 | PASS |
| finance-e10-monthly.xlsx | 9 | 18,804 | 1,099,941,533.42 | PASS |
| finance-e10-ranking-2025.xlsx | 2 | 184 | 592,244,440.13 | PASS |

## 备份、迁移和调度

先后20261014_090409、092814、093848均执行双库/上传备份及校验；最后095205包含初始化后的真实财务模型与审计，custom dump可读，全部0600，SHA如下：

```
数据库备份：/data/automation/code/work/PMC/knweb/data/backups/four_department_tracker_20261014_095205.backup
KDOS 数据库备份：/data/automation/code/work/PMC/knweb/data/backups/kdos_20261014_095205.backup
上传目录备份：/data/automation/code/work/PMC/knweb/data/backups/uploads_20261014_095205.tar.gz
e72f955df0927c97760a865d36c79d93ca1a56c925ffd3c3a6893afb357d05ea  data/backups/four_department_tracker_20261014_095205.backup
57048be2c536ea3583d37ab9d31c701a5a6871f87699f441cb56b5d826eff023  data/backups/kdos_20261014_095205.backup
bab1e77e9a88ff0a20960cc64d45f71a249554acf1de0e61d20ed48b15559c10  data/backups/uploads_20261014_095205.tar.gz
```

生产仅应用FinanceE10Analytics1722920089000和FinanceE10DeliveryDateConflicts1722920090000；不改已应用旧迁移。既有KDOS18个SQL迁移均SKIP/校验通过。回滚镜像保留 `finance-before-20261014` 与 `finance-initialized-20261014` 标签；回滚应用时保留财务数据/审计，down拒绝删历史。
仓库候选定义仍4个timer/6个service，本轮新增0；服务器KDOS用户timer8个保持enabled/active，n8n激活10个ID集合未变，cron任务数量未变；常驻Dispatcher保留。主机其它基础设施timer与逻辑任务数分开，未把候选数量冒称在线数量。新FIN-002为显式手工命令，不是周期任务；台账只登记入口、锁、幂等、失败与恢复。

## 交付文件和证据

35个本任务源码/测试/文档路径（相对c54b4dc），源映射见 `docs/finance/ERP_ORDER_ANALYTICS_IMPLEMENTATION.md`。源码提交ce891b6、1478962、5e8a8f8、e0059d0、e35d453已自动推送github/main；无真实财务数据、Excel、DB、备份或凭据进入Git提交。
主要证据：FINANCE_ORDER_REAL_ACCEPTANCE.json、REAL_EXPORTS.json、REAL_BROWSER.json、REAL_PERMISSION_DENIAL.json、INTEGRITY_RESULT.json、API_REGRESSION_EXACT_FINAL.txt、WEB_REGRESSION_DELIVERY_FINAL.txt、POSTGRES_VALIDATION.json、CHROME_FINAL.txt、DEPLOY_EXACT_FINAL.txt、HEALTH_FINAL.txt、GITHUB_PUSH.txt。
进度恢复入口：`outputs/CODEX_PROGRESS.md`；该报告及真实财务验收证据只留本机，不公开推送。
