# Codex 工作进度

## 任务

任务名称：KDOS 财务统计大屏与月度数据性能、筛选调整。
任务目标：以生产证据定位两个页面慢的原因；默认查询本月并复用可靠缓存；新增实际订单日期筛选；调整既有客户接单发生额排名为固定TOP20；保持金额口径、权限和自动任务不变；完成验证、Git同步、生产部署和Chrome验收。
当前状态：进行中。
最后更新时间：2026-11-05（Asia/Shanghai）。

---

## 当前阶段

当前阶段：代码及隔离验收完成，进入安全提交、推送、发布和真实生产Chrome验收。
当前子任务：安全提交本任务文件；以生产Web基准`6969382`创建干净临时worktree，只放入本次财务变更部署，避免发布未部署的主计划1A/1B。

## 已完成

- [x] 读取本任务附件、项目AGENTS.md及财务、表格验证、任务调度规范。
- [x] 检查Git状态：HEAD=`1ac01ec41a09a1a8523552bedafb589ca3ca0eaec`（以git实际输出为准）；`github/main`一致。
- [x] 识别并保护其他任务遗留未提交修改：仅`outputs/CODEX_PROGRESS.md`，不纳入本任务。
- [x] 代码初查发现大屏当前默认整年、每15秒轮询revision；月度页无明确月份时按全部月份查询；排名组件当前默认前10且仍接受前10/20/全部；dashboard上下文尚无真实订单日期范围。

## 正在进行

- [x] Web/API健康：Web `6969382`、API `1c15bfc`；API健康。当前HEAD `1ac01ec`，GitHub main一致。
- [x] 生产API只读测量：revision两次37.9/36.4ms；大屏2026全年4147.8ms、本月4016.3ms；TOP20排名3760.6ms；月度全部期间8238.9ms/16085条，本月7743.3ms/103条。测量请求串行、未写业务数据。
- [x] PostgreSQL `EXPLAIN ANALYZE`在READ ONLY事务及15秒statement_timeout下复核：月度COUNT全期3867ms/本月3679ms，分页全期3971ms/本月3877ms；每条约107万shared hits、0 shared reads、0 temp writes。月度读请求将两条视图扫描分别用于COUNT和分页；月份过滤无法避免复杂基础聚合。
- [x] 试验只读`bases AS NOT MATERIALIZED`的11月查询6.23秒，慢于当前3.72秒；不采用该视图改写。
- [x] 调度实况：n8n `KDOSFinanceMonthlySummaryV1` enabled、`30 8 * * *`上海时区，2026-11-05及前11天触发均SUCCESS；财务客户分类另有用户级systemd Timer每日01:00并成功。没有改调度。
- [x] 真实生产Chrome基线：Dashboard首入revision约73ms、dashboard约4.0–4.2秒、ranking约3.8–4.1秒；月度页面默认context为空且重复发出2个相同语义的rows请求（各约8.3–8.5秒）；退出再进入只重取revision约60–75ms，金额数据由React Query缓存复用。生产实际Web版本`6969382`。
- [x] 定位并消除月度列表双请求源：页面初始TableQuery未带空FilterGroup，共享表格挂载后补入空组，造成语义相同但查询键不同；初始化时固定相同空FilterGroup。
- [x] 真实只读PostgreSQL SQL验收用隔离PostgreSQL 18、合成数据运行51场景通过。验收期间发现月度自定义列表投影漏`id`，已补回并通过场景；隔离容器已停止并临时销毁，没有访问生产数据库。
- [x] Web真实Chrome合成API E2E：finance-orders-ui 7/7通过，包括首次本月、TOP20、控件精简、下钻、权限和移动布局。
- [x] API定向测试28/28、Web定向测试21/21；API/Web typecheck、API lint、Web lint和API/Web production build通过（宿主Node22与仓库要求Node>=24不一致，Web生产bundle输出仅有既有大bundle警告）。
- [x] Web/API 定向组件和服务测试；现有两个 Web 财务测试文件 21/21、API 两个套件 26/26 通过。
- [x] 已实现本月默认、上海时区、独立实际订单日期筛选及下钻传递；月度列表使用一次 PostgreSQL 查询和同一 MVCC 快照返回总数与当前页。
- [x] 月度数据使用独立资源权限 revision，不再依赖大屏权限；仅有月度权限用户仍可读。
- [x] 停止大屏 15 秒轮询、移除刷新和说明文案，缩小排名为不可更改的服务端 TOP20，金额降序及客户编码稳定次序。

## 待完成

- [x] 完成组件、API、SQL权限、筛选、缓存失效、金额口径、类型/lint/build验证。
- [x] 隔离PostgreSQL综合验收51场景；生产只读基线及真实Chrome冷首入/热回访请求量已记录。
- [ ] GitHub安全提交推送。
- [ ] 依部署门禁发布并做健康检查、生产Chrome验收。
- [x] 更新现有财务性能文档，记录新行为和只读基线。

## 修改文件

- `apps/api/src/modules/finance/finance-orders.controller.ts`
- `apps/api/src/modules/finance/finance-orders.performance.spec.ts`
- `apps/api/src/modules/finance/finance-orders.query.service.ts`
- `apps/api/src/modules/finance/finance-orders.spec.ts`
- `apps/api/src/modules/finance/finance-orders.types.ts`
- `apps/web/src/modules/finance/FinanceOrders.spec.tsx`
- `apps/web/src/modules/finance/FinanceOrders.tsx`
- `apps/web/e2e/finance-orders-ui.spec.ts`
- `docs/finance-dashboard-performance.md`
- `apps/web/src/modules/finance/finance-monthly.period.ts` 与 `.spec.ts`
- 本进度文件。

## 数据库 Migration

- 无；只复用现有表、视图与revision。

## 新增或修改测试

- 无。

## 已运行测试

测试名称：API finance orders unit/performance；Web finance Vitest；`scripts/test-finance-orders-postgres.cjs`隔离PostgreSQL；`finance-orders-ui.spec.ts` Chrome E2E；API/Web typecheck、lint、build。
结果：API 28/28；Web 21/21；隔离PostgreSQL 51场景；Playwright Chrome E2E 7/7；typecheck/build通过。Web lint 0 errors、1条既有 ModulePortal Fast Refresh warning；API lint无警告。宿主Node22低于仓库声明Node24。

## 当前已知问题

- 主机Node为22，仓库声明Node >=24，pnpm提示版本不匹配；本机API/Web build通过，发布Docker build仍会以项目镜像Node版本再验。
- 上一任务留下的`outputs/CODEX_PROGRESS.md`包含其他未提交任务差异，必须完整保留且不得混入本任务提交。
- 当前HEAD包含此前明确未生产部署的主计划API/Migration 118/119；API部署须按发布规范确认不会顺带上线这些未授权MPS改动。

## 等待用户确认

- 无。

## 下一步

1. 检查最终diff/敏感文件并仅提交本任务文件，安全推送GitHub。
2. 建立基于生产SHA的临时worktree，应用本任务提交差异后按deploy.sh正常部署并健康核验。
3. 用真实Chrome重新测冷入、重复进入、筛选条件和月度列表；记下线上版本与新耗时。

## 恢复执行说明

先读本任务附件及适用Skill，再看本进度、git status/diff；不要重做已完成检查。保护`outputs/CODEX_PROGRESS.md`差异。不得在生产改写财务数据、调整调度或发送消息。部署时不得夹带此前未授权上线的MPS Migration/API代码。
