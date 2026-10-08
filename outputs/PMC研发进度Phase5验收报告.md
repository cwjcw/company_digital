# PMC研发进度 Phase 5 验收报告

**Phase 5：PASS。已开发、验证并正式部署。**
验收日期：2026-10-07，Asia/Shanghai。
源码提交：`ce0d659f07e7dc6d25429484aa13e93823cda401`（产品提交f8d0b0e，E2E验收补强ce0d659）。

## 1. 修改文件

16个源码/测试/文档文件：

- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.filter-sources.spec.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.filter-sources.ts`
- `apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.query.service.ts`
- `apps/web/e2e/pmc-rd-progress.real.spec.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/modules/pmc-rd-progress/PmcRdProgressPage.spec.tsx`
- `apps/web/src/modules/pmc-rd-progress/PmcRdProgressPage.tsx`
- `apps/web/src/modules/pmc-rd-progress/ProgressDetails.tsx`
- `apps/web/src/modules/pmc-rd-progress/progress-columns.tsx`
- `apps/web/src/modules/pmc-rd-progress/rd-progress.constants.ts`
- `apps/web/src/modules/pmc-rd-progress/rd-progress.css`
- `apps/web/src/modules/pmc-rd-progress/rd-progress.model.ts`
- `apps/web/src/modules/pmc-rd-progress/status-ui.tsx`
- `apps/web/src/shared/KdosDataTable.tsx`
- `docs/pmc-rd-progress.md`
- `scripts/test-pmc-rd-progress-e2e.cjs`

本任务记录文件：`outputs/CODEX_PROGRESS.md`、本报告，以及5份不含身份/凭据的JSON：`pmc-phase5-production.json`、`pmc-phase5-browser-summary.json`、`pmc-phase5-scope-validation.json`、`pmc-phase5-division-ui.json`、`pmc-phase5-export.json`。

数据库migration：无；新增npm依赖：无；Compose/.env：无改动；Calculator、E10 Reader、同步ApplicationService、tenant机制与既有账号权限：无改动。

## 2. 页面入口

PMC中心 → 报表 → 研发进度。正式LAN地址：`http://192.168.1.249:15172/pmc/reports/rd-progress`。
菜单为可折叠报表树，页面身份复用系统顶栏。无read权限隐藏菜单并阻止直接访问；API继续使用AuthGuard。

## 3. 当前页面结构

- 六KPI：订单数、订单品项数、已完成、未完成、异常、总体研发完成率。完成/未完成/异常可点击筛选并回第一页。
- 三项环节指标：设计BOM完成率、路线完成率、不适用品项数；总体完成率进度条只呈现API值。
- KdosChart横向七状态图；采用主题颜色，快捷状态按钮提交后端筛选。
- 核心筛选：订单、客户名称、事业部、品号/品名、研发/设计BOM/路线状态、下单日期、仅未完成；URL恢复和清空；另复用标准搜索、高级/列头筛选及排序。
- 主明细每行一个订单品项；默认100，选项50/100/200/500/1000。KdosDataTable标准列显示、拖动宽度、冻结、导出。主表只页面纵向滚动，表格横向滚动和sticky表头。
- 订单Drawer按稳定sourceOrderId精准查询整个授权订单，不继承主表的品号/状态限制；订单汇总与可分页品项同时展示。Drawer内嵌固定高度滚动是明确例外。
- 品项Modal展示物料属性、工艺控制、BOM版本/E_CODE/原始审核、工序数、路线来源、研发原因和源时间。隐藏字段不进入显示/tooltip。
- 同步状态只读展示最新轮次状态和源观察时间，Tooltip显示方式/完成时间；无同步按钮。
- 汇总、明细、同步、详情分别加载与报错；空状态可清空筛选。

所有研发/组件/订单状态、完成率与未完成原因直接来自Phase4 API，不在前端推导BOM/路线规则或用完成率阈值判断。仅未完成条件由原QueryService执行 `rd_status NOT IN (COMPLETE, NOT_APPLICABLE)`。

## 4. 当前生产数据

- 订单：2,545；品项：17,647。
- 已完成：11,082；未完成：5,730；不适用：835；适用分母：16,812。
- 总体完成率：65.92%；设计BOM：82.13%；工艺路线：66.32%。

| 状态 | 数量 |
|---|---:|
| 不适用（NOT_APPLICABLE） | 835 |
| 未开始（NOT_STARTED） | 2,998 |
| 设计 BOM 进行中（DESIGN_IN_PROGRESS） | 0 |
| 待工艺（WAITING_ROUTING） | 2,722 |
| 工艺设计中（ROUTING_IN_PROGRESS） | 4 |
| 研发完成（COMPLETE） | 11,082 |
| 异常（ABNORMAL） | 6 |

状态数总和 17,647，等于items.total及summary.itemCount；数据为当前同步快照的动态结果，不硬编码断言固定生产总数。

## 5. 筛选与导出

新增API：无。复用：

- GET `/api/v1/pmc/reports/rd-progress/items`、`summary`、`orders`、`sync-status`。
- GET `/api/v1/table-filters/candidates`（事业部与标准候选）；已有平台筛选/排序协议。
- GET `/api/v1/table-exports/pmc-rd-progress`（标准XLSX）。

补齐Phase4导出未应用context的缺口：资源printRows直接调用同一个QueryService.list；核心条件与search/FilterGroup/sort同时应用，拒绝隐藏字段筛选，服务端批次参数覆盖客户端分页值。导出同时满足read范围ANDexport范围，不复制第二套业务SQL/Excel框架。

实际Chrome点击标准导出后读取下载文件并由现有ExcelJS重新打开：
- onlyIncomplete=true：页面pageSize=100、total=5,730，Excel实际5,730条，含中文表头，文件名 `pmc-rd-progress.xlsx`。
- 事业四部：页面38条，实际Excel 38条；所有返回行的事业部一致。
- 字段仅可见业务列，无来源UUID、tenantId、id/version或操作按钮。日期仍按上海业务时区；E10墙钟先标注+08:00交给标准格式化器，跨日回归通过。
- 继续沿用平台字段顺序/单元格展示格式：空值“—”、数值展示文本、字典中文；未在本阶段改公共Excel格式。

## 6. 四个关键样本页面结果

| 订单 | 品项 | API/页面状态 | 原因 |
|---|---|---|---|
| 2304-202610060005 | 601000110 | 不适用 / NOT_APPLICABLE | 采购件且未启用工艺路线，研发不适用 |
| 2301-2026C1101-B061 | ABL370CC0C375-1/1 | 未开始 / NOT_STARTED | 未建立设计 BOM |
| 2307-260930008 | RXA500J-V5-1/1 | 待工艺 / WAITING_ROUTING | 尚未建立有效工艺路线 |
| 2307-260930008 | RXA505F-HLLV5-1/1 | 研发完成 / COMPLETE | 设计 BOM 和所需工艺路线均已完成 |

四个样本均通过真实账号登录页面筛选，验证对应行状态、订单Drawer与完整订单品项总数，关闭Drawer保留主表筛选。

## 7. 异常页面验证

异常KPI和筛选显示6条；原因直接显示API业务提示：P+1 / M+0“物料属性与工艺路线控制组合尚未经过业务验证”，未称为系统错误，不改状态。

ABNORMAL为主题error Tag与异常KPI颜色；原因单行省略+Tooltip，原始V仅作为原始审核值展示，未映射为“作废”。

## 8. 权限验证

E2E登录/权限验证通过。仅运行时读取用户指定外部凭据；未复制/打印/记录真实用户名、密码、token，未提交凭据，未修改密码或权限。专项E2E关闭trace/视频/截图/失败页面快照，不保存storageState。

- 实际认证API与页面获取当前账号被授权字段，summary总数与items.total一致。
- items/summary/orders/sync-status/标准导出五个匿名请求均401。
- 单元测试：无read无菜单/不请求，隐藏字段/筛选/tooltip/排序拒绝，无export拒绝。
- 真实数据库服务层只读受限actor验证（不伪造生产HTTP JWT、不创建账号）：
  - read限定订单共147，summary 147，允许export ALL后实际导出仍为147；证明export不能扩大read范围。
  - read/export不相交为0；跨tenant为0；隐藏字段JSON及状态汇总裁剪；隐藏筛选和无export均403。
- 数据范围沿用Phase4 progressScope/buildDataScopeClause，tenant/active条件和RLS上下文不变。

## 9. 测试结果

- API全量：87 suites，738通过，1既有跳过（88 suites中1 skipped）。
- PMC专项：5 suites / 73通过，包含context、全部401行跨3批、字段权限、read/export交集、tenant、选中打印和源时间跨日真实workbook校验。
- Web全量：31文件 / 221通过；最终专项15项通过。
- 非Web其它workspace测试全部通过。
- Chrome预验收8项通过；最终正式生产整组9/9通过（1.1分钟，无fixture拦截、无跳过）。
- 真实下载专项：5730行及异常/URL恢复通过；事业部Chrome筛选/导出38行通过。
- lint、typecheck、全workspace build通过；git diff --check通过。

早期E2E适配问题已修正：公共按钮图标会进入accessible name、中文按钮会插空格，且Chrome attachment的网络response.body可能为空；验收读取实际下载文件。没有为测试修改产品权限或业务算法。

## 10. 构建与部署

目标最终SHA：`ce0d659f07e7dc6d25429484aa13e93823cda401`，API/Web以Node24 Docker镜像构建。
已执行 `./scripts/deploy.sh all`（必要API导出适配与Web页面），仅重建api/web，不重建postgres；Repository、Web、API均ce0d659，`scripts/deploy.sh check`返回CONSISTENT；`scripts/healthcheck.sh`通过，PostgreSQL/API/Web全部healthy。
无migration，无seed，无数据库结构/历史业务记录修改。

部署前标准备份（pg_restore --list验证与SHA256复核通过）：

| 文件 | SHA256 |
|---|---|
| data/backups/four_department_tracker_20261007_182625.backup | 3faf2422a615cb04479d30ae3199c21b7f2de572b75b11157b03bca6f06bc328 |
| data/backups/kdos_20261007_182625.backup | 1388c0e479b3d5bdb72e8e5ae3152ef3fa168399b47f15d417c4943d931053d0 |
| data/backups/uploads_20261007_182625.tar.gz | b02ccb3b322c497e6181ca830fd8670171eaa2e6619699c0182a25984da50310 |

PostgreSQL继续postgres:18、原volume及localhost15433映射；API仍使用postgres:5432。没有down -v、删除volume、prune或变更其它服务。

## 11. 已知限制

- 现有Phase4数据仅38条映射到事业四部，17,609条未映射；按要求明确显示“未映射”，本阶段不补猜、不改映射算法。
- 用户凭据指定的外部HTTPS地址在本机代理链路TLS失败，直连也超时。本次实际生产验收用同一系统的127.0.0.1:15172，LAN地址可访问；外部TLS/入口修复不在本任务范围。
- 同步状态API仅返回最新轮次，本页不额外补查历史成功轮次，不提供同步触发。
- KdosChart现有容器不暴露点击事件，使用状态快捷按钮完成相同筛选，不扩展图表基础层。
- 标准Excel格式未变更（空值“—”、展示文本数值）；个人偏好在localStorage按tenant+user+resource+viewKey保存，无新数据库表。
- 既有Portal Fast Refresh warning、宿主Node22 engine warning及Vite大bundle warning仍在；0 lint error，正式镜像使用Node24。

## 12. 是否建议正式交付与人工复核步骤

建议正式交付使用。27项Phase5完成条件全部通过；事业部缺失映射和外部HTTPS入口限制已单独标明，继续使用既有Phase4业务口径，不把数据质量问题伪装成已补全。

1. 登录现有获权账号，从PMC中心展开“报表”，进入“研发进度”。
2. 默认不勾选仅未完成，对照6KPI、3环节指标、7状态分布和明细total。
3. 查询表中四个样本，确认状态/业务原因；点击订单号，查看订单汇总、翻页品项并关闭，主表条件不变。
4. 选择事业四部、客户/品号/品名、BOM/路线状态和日期，点查询；刷新后条件恢复。
5. 点击未完成KPI，确认page回1；导出Excel，用Excel/WPS打开，核对全部5730行（以实时当前total为准），不是100行。
6. 点击异常KPI，核对6条业务异常及原因Tooltip；打开品项详情确认原始审批V没有“作废”翻译。
7. 拖动列宽、隐藏/冻结列、翻页，刷新确认个人视图保持；横向滚动和向下滚动检查sticky字段表头。
8. 用现有无read/无export或受限字段/数据范围账号复核菜单、直接URL、导出按钮与API拒绝行为；不得为了验收修改生产权限。
9. 若需再次自动验收，外部安全凭据仅通过运行时环境传入：`PMC_E2E_ENV_FILE=<安全文件路径> E2E_BASE_URL=http://127.0.0.1:15172 node scripts/test-pmc-rd-progress-e2e.cjs`。

本次所有验收记录不含真实登录身份、密码或token。仅outputs记录文件未提交；源码与测试已提交并部署，无push。
