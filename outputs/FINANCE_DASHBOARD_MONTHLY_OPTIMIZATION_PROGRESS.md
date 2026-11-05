# Codex 工作进度

## 任务

任务名称：KDOS 财务统计大屏与月度数据性能、筛选调整。
任务目标：以生产证据定位两个页面慢的原因；默认查询本月并复用可靠缓存；新增实际订单日期筛选；调整既有客户接单发生额排名为固定TOP20；保持金额口径、权限和自动任务不变；完成验证、Git同步、生产部署和Chrome验收。
当前状态：已完成。
最后更新时间：2026-11-05（Asia/Shanghai）。

---

## 当前阶段

当前阶段：完成。
当前子任务：代码、隔离测试、生产部署、健康检查、真实Chrome验收及GitHub同步均完成。

## 已完成

- [x] 读取本任务附件、项目AGENTS.md及财务、表格验证、任务调度规范。
- [x] 检查Git状态：开始时HEAD=`1ac01ec41a09a1a8523552bedafb589ca3ca0eaec`；本任务代码已提交`196fb8092036f52c81ebd6b79c069a4740ed3ab8`并推送`github/main`；安全生产发布分支为`finance-safe-release-20261105`，HEAD=`00ebe1612c77d57661dcc45432667c841441d182`。
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
- [x] Docker Node24 发布构建通过；`scripts/deploy.sh all`从基于生产`6969382`的干净worktree发布，仅包含本任务改动，生产SHA一致为`00ebe1612c77d57661dcc45432667c841441d182`；`scripts/healthcheck.sh`检查Web、API、PostgreSQL、Swagger、OpenAPI及document-worker均通过。
- [x] 真实生产Chrome二次验收：页面首次Dashboard加载revision约77ms、dashboard约4.0s、TOP20约3.7s；订单日期范围同步进入dashboard和ranking，下钻保留日期且月度FilterGroup含orderDate；月度首开revision约79ms、单次rows约4.44s，默认上下文为2026-11；两页面离开后重进只请求轻量revision（约0.09s），未重跑rows/dashboard/ranking。
- [x] 部署后生产只读API串行复测：2026全年Dashboard 4.13s、当月3.90s、TOP20 3.75s、月度全部月份4.58s/16085行、月度当月4.33s/103行。
- [x] 已实现本月默认、上海时区、独立实际订单日期筛选及下钻传递；月度列表使用一次 PostgreSQL 查询和同一 MVCC 快照返回总数与当前页。
- [x] 月度数据使用独立资源权限 revision，不再依赖大屏权限；仅有月度权限用户仍可读。
- [x] 停止大屏 15 秒轮询、移除刷新和说明文案，缩小排名为不可更改的服务端 TOP20，金额降序及客户编码稳定次序。

## 待完成

- [x] 完成组件、API、SQL权限、筛选、缓存失效、金额口径、类型/lint/build验证。
- [x] 隔离PostgreSQL综合验收51场景；生产只读基线及真实Chrome冷首入/热回访请求量已记录。
- [x] GitHub安全提交推送：`196fb80`至`github/main`；安全发布基准`00ebe16`分支也已推送以保留部署源码。
- [x] 依部署门禁发布并做健康检查、生产Chrome验收。
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

- `apps/api/src/modules/finance/finance-orders.performance.spec.ts`：月度单SQL、record ID、numeric排序、订单日期过滤、权限、固定TOP20。
- `apps/api/src/modules/finance/finance-orders.spec.ts`：订单日期/发生月份独立及字段权限。
- `apps/web/src/modules/finance/FinanceOrders.spec.tsx`、`finance-monthly.period.spec.ts`：默认月、全部月份、下钻日期、TOP20和缓存。
- `apps/web/e2e/finance-orders-ui.spec.ts`：真实Chrome（合成API）7项。

## 已运行测试

测试名称：API finance orders unit/performance；Web finance Vitest；`scripts/test-finance-orders-postgres.cjs`隔离PostgreSQL；`finance-orders-ui.spec.ts` Chrome E2E；API/Web typecheck、lint、build。
结果：API 28/28；Web 21/21；隔离PostgreSQL 51场景；Playwright Chrome E2E 7/7；typecheck/build通过。Web lint 0 errors、1条既有 ModulePortal Fast Refresh warning；API lint无警告。宿主Node22低于仓库声明Node24。

## 当前已知问题

- 主机Node为22，仓库声明Node >=24，pnpm提示版本不匹配；生产Docker Node24构建通过。
- 上一任务留下的`outputs/CODEX_PROGRESS.md`包含其他未提交任务差异，必须完整保留且不得混入本任务提交。
- 无未完成工作。发布worktree仅从生产SHA `6969382`开始并应用本任务差异，未包含主计划第一阶段1A/1B代码或Migration。

## 等待用户确认

- 无。

## 下一步

1. 任务完成；最终报告记录于本进度文件与`docs/finance-dashboard-performance.md`。

## 恢复执行说明

先读本任务附件及适用Skill，再看本进度、git status/diff；不要重做已完成检查。保护`outputs/CODEX_PROGRESS.md`差异。不得在生产改写财务数据、调整调度或发送消息。部署时不得夹带此前未授权上线的MPS Migration/API代码。
