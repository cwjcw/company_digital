# 财务客户对应表手动新增验收

起始SHA：4bfced6c7ff51b67b30adc539d8c37d3aa4fde46。当前本地实现/测试完成，待生产迁移/部署及Chrome复核；最终版本及GitHub结果在部署补记记录。

页面：`/finance/base-data/customer-mappings`，财务中心→基础数据→客户对应表。

## 行为与权限

新增客户按钮只对本表create授权用户显示，弹窗填写客户编号、部门类别、内外区分。编号必填、去除首尾空格、最长128字符，原字符/后缀/大小写保留；两分类可空，沿用业务一至四部/内外销字典。保存加载/错误提示持续可见；重复409保留草稿并提供“返回列表修改”，不自动覆盖。新增成功刷新服务端列表、客户总数/待分类以及已有财务查询缓存。

独立POST `/api/v1/finance/customer-mappings/manual`，只接收三字段。创建资格为操作权限+字段策略+create数据范围+启用的同租户操作人，不依赖隐藏按钮。沿用平台创建字段策略：可见字段可在新增表单填写；ADD_ONLY仅在NONE填报范围下允许无记录查看的填报。无字段授权拒绝伪造写入；无create范围默认拒绝，OWN/CUSTOM均对拟新增记录校验；无组织事实不猜PMC事业部，含未知CUSTOM条件的备选范围整组拒绝。技术字段/来源由服务端生成；已有客户编号仍不可PATCH改名。

插入使用现有tenant/code唯一键和ON CONFLICT DO NOTHING，冲突明确409 `FINANCE_CUSTOMER_EXISTS`，不返回已有ID/隐藏字段。事务包含UUIDv7/版本1/操作人/创建时间及finance.customer.created审计；审计失败全部回滚。未修改PMC映射或财务订单金额算法/视图。

## 迁移和同步

新增前向`1722920103000-FinanceCustomerManualSource.ts`，只对finance_customer_mappings.source增加MANUAL；先加并验证新CHECK，再移除/替换旧CHECK，保留所有数据和原唯一键/RLS。finance_customer_sync_runs来源仍只接受INITIAL_IMPORT/E10_SYNC，不伪造手工同步批次。旧migration未修改，down拒绝收窄导致MANUAL记录丢失；回退应用保留新约束和数据。

E10客户同步仍使用原ingest来源白名单/日期窗口/锁/幂等及冲突跳过，后续命中手工客户时分类、source和version都不变。01:00 Asia/Shanghai用户Timer enabled/active、最近成功；本任务不改频率/任务/凭据、不补跑生产同步。n8n16定义/11active，新增任务0。

## 测试

- API全量118套通过、4套skip，1153项通过/33skip。
- Web全量59文件、444项通过；契约31项通过。
- API构建/lint、Web typecheck/lint及正式构建通过。保留既有ModulePortal快刷warning和既有大bundle提示，未为本任务修改全局规则。
- 独立PostgreSQL/真实HTTP10组通过，含升级保留已有来源数据、操作人/时间/审计、8并发仅1条/1审计、跨租户同code独立/伪造或停用用户拒绝、create范围/OWN/NONE/CUSTOM、审计失败回滚、E10重放/并发不覆盖、不接受MANUAL ingest、201/400/403/409、列表/总数刷新、210条跨页Excel一致/三业务列/无UUID/source、read∩export/字段裁剪及无导出403。
- 第11组真实Chrome通过：Vite实际页面+隔离Nest HTTP/PG，填写字典、trim编号、新增201、列表与数量即时刷新、刷新后重复409和返回列表修改。所有API流量指向隔离测试服务，没有生产写入。测试数据库完成后自动删除。
- 生产Chrome待部署后核验按钮/字典/必填/重复409、取消保留原分类、实际Excel/无权限403；不伪造生产客户进行演示。

## 保护与部署证据

开发前145417两库/uploads备份成功，格式与SHA校验、文件600；受限证据data/finance-customer-manual-20261021，不提交凭据、备份、数据库、会话或真实财务行。初始正式客户147、同步run10、PMC客户映射3、PMC接收映射5；8份财务视图定义指纹及6flags/n8n定义已保存。发布前取新快照，已有正常业务变动单独归因，不覆盖用户配置。

仅本任务源码/测试/文档提交；6份先前outputs差异保留，主进度仅提交新任务段。正式执行顺序：确认远程无冲突→安全本任务提交→构建迁移镜像→发布前备份→仅新迁移→标准deploy all/check→Chrome/数据指纹→正常push github/main并核实SHA。若出现Git冲突或未解释的迁移/权限风险，停止上线。

最终结果待部署补记，不把本地代码完成表述成已上线。
