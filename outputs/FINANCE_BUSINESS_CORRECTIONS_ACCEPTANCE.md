# 财务销售订单四项修正验收记录

状态：已完成。最后更新时间：2026-10-20 14:55（Asia/Shanghai）。

最终源码：`d8456fbcdb4a3290200b5795cf02f3e917ab57ee`，业务修正提交：`f337ef65a65dd0088b43162c2443b7bcaf415b69`。本报告为可提交的脱敏技术验收版；完整金额及原始数量报告受限保留于`data/document-sync-originals-20261020-170747/FINANCE_BUSINESS_CORRECTIONS_ACCEPTANCE.md`，不提交真实财务数据到GitHub。

## 业务规则和修改

只读读取鼎捷E10，原始SQL与E10数据库未修改；KDOS原始品项保留。统一资格视图按tenant_id、source_database、source_order_id关联，材料销售单排除，仅订单头approved=Y纳入，N/V/空/NULL排除。指定结束仍为头CLOSE=1排除整单、交货计划CLOSE=1排除对应稳定品项，CLOSE0/2保持。月度、大屏、客户排名、发生额和台账有效投影共用资格，无前端分页后过滤。

Migration99只更新派生视图及新增共享资格视图；同一REPEATABLE READ事务对照旧96视图公式、预期资格过滤与新结果。原始行、源事件数量和内容指纹未改。既有原始订单/品项保留，既有历史事件原文、原始差额保留；不合资格订单的有效金额投影为空且不入账，不伪造冲回事件。审核/类型变化按新读取状态更新资格，未知旧快照不假定有效或无效。

原34列businessRemark本来已由h.REMARK1读取、API与Excel返回，位置16；没有重复创建。已有用户保存的非空列配置缺少此字段时，仅一次追加，保持其他列偏好，之后用户手动隐藏仍生效。该机制不扩大后端字段权限。未逐一读取每位用户本机Chrome偏好；真实Chrome使用现有管理员授权的短期维护会话，验证旧偏好恢复，不冒称密码登录。

月度末列追加备注成为10列，原9列名称顺序不变，取同一订单头一致备注，不能把多个品项备注拼接；有冲突时返回空。原始/月度默认订单日期ASC，账套/订单ID/品项ID/记录ID稳定次级排序，显式用户排序尊重；列表/打印/Excel共用注册排序，变更流水时间排序保持。

## 同快照金额对账（脱敏）

在同一生产快照中，分别核实材料销售单、非审核通过及两者重叠条件；按订单稳定键去重，排除金额与独立预期精确一致。逐年度、客户、事业部、内外销分组逐项对平；月度、大屏、完整客户排名及全期间接单发生额勾稽通过。正常已审核CLOSE=0/2订单继续参与统计，材料相关日志没有已入账有效金额，过滤未生成虚假冲回事件。

本Git版本省略真实订单数量、客户数量、余额、排除金额及实际订单编号，完整同快照金额表保存在上述本机原件。按变更生效月迁移发生额，单月/单年度不必等于原订单月份余额，但全期间总额勾稽一致。生产持续正常同步，工作开始、发布和最终快照间的源数据变化未被冒称代码差异。

## 台账与增量

发布后FULL读取成功，changedCount=0，没有升级造账。首次正常增量仅更新既有事件的元数据，未新增事件或改变金额；后续13:07、13:37、14:07、14:37原定增量持续成功，真实源变更继续入账。未变更任务调度、6个同步flags、授权、角色、客户分类配置。最终读取的变更单事实均有新资格字段；少量留存旧状态事实不含资格字段，仍保留为未知，不推测、不补造，当前有效统计按原始订单头实值判定。按用户要求未做历史完整性审计。

## 网页、Excel、排序及权限

真实Chrome对原始/月度页面验证备注可见、旧列偏好补充且不丢其他列；实际Excel原34列/备注16位，月度10列/备注10位，值与订单头一致。各验证2页50行共100行，记录ID顺序逐一与数据库排序一致、无重复；显式日期降序正常。Excel与列表使用同一筛选和默认排序。

权限回归覆盖匿名/无read/无export拒绝、CUSTOM范围、字段权限及租户隔离；只读运行时授权/角色/成员/客户分类指纹未变。普通用户场景用自动化与隔离PostgreSQL验证，真实生产Chrome使用现有管理员维护会话，未伪称普通员工账号实登。

## 测试

- API全量1090通过、33个原有条件跳过；最终月度补修相关3组31通过（含新增1项）。
- Web全量421通过；Contracts29通过；Python Reader8通过。
- 隔离PostgreSQL订单32、变更台账12场景通过；月度补修后订单32再次通过。
- 全工作区typecheck、lint、build通过；最终API补修typecheck/lint/build再通过。
- Chrome预验9项通过；真实生产Chrome、API、Excel和100行跨页核验通过。
- 保留既有Portal FastRefresh及Vite大包提示，无新增错误。

## 性能

同一现有管理员、同年度、相近数据规模（生产继续增量）真实Chrome，页面全部图表和排名显示完成耗时如下。每个非缓存场景Dashboard和Ranking各请求一次，无重复聚合请求。

| 场景 | 业务修正前（秒） | 最终版本（秒） |
|---|---:|---:|
| 首开2026 | 2.519 | 3.257 |
| 再次进入2026 | 0.726 | 0.714 |
| 刷新2026 | 2.623 | 3.580 |
| 年度切换2025 | 2.184 | 2.206 |
| 事业部筛选2025 | 3.387 | 2.184 |
| 客户筛选2025 | 2.080 | 2.094 |
| 手工刷新当前筛选 | 2.120 | 2.088 |

首开与全页刷新仍高于3秒目标；相对于业务修正前分别增加约0.74秒和0.96秒，未声称本轮全部达标。新资格聚合增加读取开销；原十几秒错误关联未恢复。最终首开Dashboard API1.929秒、Ranking1.493秒，刷新分别1.822/2.059秒，末次API后渲染0.228/0.535秒。再次进入无金额请求。年度月度API完整count+50行请求从47.904秒降至3.227秒。

新资格引入后发现年度月度默认排序的错误关联计划，线上只读API47.904秒；补修将月度注册执行器限定为租户事务内SET LOCAL禁用merge/nested loop，覆盖列表、候选、打印和Excel，不影响其他资源/连接池全局设置。只读限时EXPLAIN ANALYZE补修计划1.591秒。大屏原Hash策略保持，MATERIALIZED只取6个金额维度，排名仍单次聚合。原始宽聚合仍有部分临时排序，不宣称已完全消除。

## 备份、部署与同步

两库及uploads备份20261020_121019成功、SHA256及pg_restore归档清单验证通过；相关配置和发布前代码另存受限归档。Migration99已正式执行，无ERP结构变更。E10标准SQL最终SHA256校验一致。最终正式执行scripts/deploy.sh all/check，Repository=Web=API=d8456fbcdb4a3290200b5795cf02f3e917ab57ee，STATUS=CONSISTENT；Web/API/Swagger/OpenAPI/Document Worker/PostgreSQL健康全部通过。最终Chrome/实际Excel/跨页100行复验再次通过；实际API确认各年度月度、大屏和完整客户排名金额一致，真实金额及客户数量仅留受限本机原件。

最终fetch确认本地ahead2/behind0，无分叉。仅22个本任务源码/测试/文档文件的两次提交安全push至github/main成功，远端refs/heads/main经ls-remote验证等于d8456fbcdb4a3290200b5795cf02f3e917ab57ee。未强推、未上传财务证据/备份/凭据。用户随后要求提交四份outputs记录，本报告及新增进度已脱敏，合成验证结果和出货技术验收一并同步；本次仅文档提交，运行版本仍为上述d8456fb。

## 修改文件

- `apps/api/src/common/filtering/table-filter.controller.ts`
- `apps/api/src/common/filtering/table-filter.registry.ts`
- `apps/api/src/common/printing/table-print.service.ts`
- `apps/api/src/migrations/1722920099000-FinanceE10BusinessEligibility.ts`
- `apps/api/src/modules/finance/finance-business-corrections.spec.ts`
- `apps/api/src/modules/finance/finance-movements.application.service.ts`
- `apps/api/src/modules/finance/finance-movements.calculator.ts`
- `apps/api/src/modules/finance/finance-movements.spec.ts`
- `apps/api/src/modules/finance/finance-order-eligibility.ts`
- `apps/api/src/modules/finance/finance-orders.query.service.ts`
- `apps/api/src/modules/finance/finance-orders.spec.ts`
- `apps/web/src/modules/finance/FinanceOrders.spec.tsx`
- `apps/web/src/modules/finance/FinanceOrders.tsx`
- `apps/web/src/modules/finance/finance-view-upgrade.spec.ts`
- `apps/web/src/shared/KdosDataTable.tsx`
- `data-operations/e10/finance_movement_reader.py`
- `docs/finance-dashboard-performance.md`
- `docs/finance-order-movements.md`
- `docs/operations/TASK_REGISTRY.md`
- `packages/contracts/src/finance-orders.ts`
- `scripts/test-finance-movements-postgres.cjs`
- `scripts/test-finance-orders-postgres.cjs`
