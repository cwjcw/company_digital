# KDOS-MPS-OVERVIEW-DASHBOARD-001 REV2 自动验证与人工验收清单

业务规则/实现和自动验证已完成；本轮上线门禁仍以标准all部署及Repository/Web/API一致、服务健康证据为准。最终必须为WAITING_MANUAL_ACCEPTANCE，不自动PASS。以下为REV2验收口径，REV1历史保留在下方。

- 真实起始基线707bc5a（保留其督办创建权限修复）；未回退6bff61e，未覆盖既有未提交进度。
- 9类待处理事项：未进入出货、未进入基础、已具备条件未进入周、计划待完善、未开始报工、未入库、未完成入库、延期未完成、生产异常。每个KPI点击切换对应server-side分页Tabs，可单独导出全匹配清单。3天工单当前窗口规则不足，标BLOCKED且不展示。
- 出货差集用monthly.id→shipping.monthly_plan_id（tenant复合FK），基础差集用shipping.id→base.shipping_plan_id，周计划用base.id→weekly.base_plan_id及正式weeklyPlanState。不得用order/item两字段替代父ID，不能把已建立某批次解释为覆盖全部数量。
- 所有数量/进度/状态/人工异常继续复用正式事实及shared标准10工序；计划提示不计入生产异常；已具备条件与待完善严格分开。月计划入库与欠数不在Dashboard重算。
- 计划待完善、工序执行、风险与异常是3张独立标准KdosDataTable、3个report request及query key、独立page/pageSize/sort/local filters/export/loading/error/empty state。默认100，页大小遵守平台白名单；风险行可同时含延期与人工异常。原正式风险下钻保留。
- 顶部事业部、客户、订单/品号多选、订单/交付日期统一Dashboard Scope，适用于summary/gaps/reports/candidates/export；每事实显式tenant及同一Dashboard data scope。导出read∩export、字段与依赖校验、英文独立xlsx，不导当前页，不输出UUID。
- API全量107套/1002项通过（默认19项外部集成跳过，本任务5组PostgreSQL用例另行启用并通过）；Dashboard/Gaps最后13项通过；Contracts22项通过；Web全量50套386项通过，独立报表与缺口点击有新增回归。
- Chrome桌面1366/1440/1920、真实图表resize、单纵向滚动、无重复标题、筛选联动、独立risk分页/下钻、单表下载、缺口切换/下载、无read/export权限，共12项通过。浏览器响应为明确合成fixture并拦截所有API，不冒充生产登录、不创建业务假数据。
- 全仓typecheck、lint、build通过；保留既有ModulePortal fast-refresh warning及Vite chunk提示，均无错误。
- 生产只读三组日期Scope下9个KPI与清单total逐项一致（27次比较）；10张业务表记录数/version哈希、6个sync flags及migration台账与基线一致。首次EXPLAIN execution约1257ms，分页明细146–1204ms，无N+1、无新索引。
- 双库及附件标准备份20261015_232206，pg_restore目录与SHA256验证通过；本轮无业务migration、事实表、业务数据/报工/入库修改、同步开关或调度调整。

## 上线证据与待人工验收

最终运行SHA以本任务交付回复、build-info及health为准；标准部署/check、部署后Chrome与只读核验的执行证据写入私有data/mps-dashboard-rev2。新指标有独立字段权限，普通用户不得因原月计划权限而自动获得Dashboard或其它业务表读取权；真实账号和真实业务含义仍需用户按GAP_AUDIT/Gap Metrics复核。

人工重点：月计划正需求是否是期望的出货管理集合（本轮只判断尚未建立，不判断排完全部数量）；相同订单/品号多批次清单是否清楚；已具备条件/待完善分开；未报工与入库两类缺口可信；9类KPI、顶部Scope、局部条件和14类单表导出范围一致。未经用户确认，不判最终PASS。

---

# KDOS-MPS-OVERVIEW-DASHBOARD-001-REV1

当前状态：**等待人工验收**。REV1开发、自动验证与功能部署已完成；未经用户真实账号验收不判最终PASS。
日期：2026-10-15（Asia/Shanghai）。REV1覆盖下方V1历史中的无日期、模糊输入、整屏导出约定；其它业务公式保持。

## 本轮变更与范围

- 起始HEAD：`c1357f7e82daefac38a2fdeb26d3b0c833a946dd`，main，干净；运行Repository/Web/API相同且CONSISTENT。沿用已上线V1，不回退或重做。
- 资源/路由/导航不变：mps-overview-dashboard；`/master-plan-dashboard`；PMC中心→大屏报表→主计划大屏→主计划综合大屏。
- 订单号/品号改为可搜索远程多选，正式orderNumbers/itemCodes精确IN。品号候选显示品号·品名，标签保留；客户/事业部/订单/品号候选均同一scope，远程50项+hasMore，不从当前页生成字典。
- 默认不限日期，日期类型ORDER/DELIVERY，DAY/MONTH/YEAR/CUSTOM；上海日历，区间首末日包含，SQL[start,endExclusive)。这是本大屏例外，不修改其它Dashboard规范。
- 统一授权事实和tenant/order/item/division身份先形成dashboard_scope，再派生全部KPI、准备/辅助/工序、7天趋势、事业部、风险、候选及导出。关联用无碰撞JSON复合身份键，不靠模糊字符串拼接。
- 订单日期统一优先授权group.order_date，缺失时按monthly/base/weekly同单最早非空值，旧快照不各自筛选。交付日期唯一按正式latestCustomerDueDate：未完成周计划最早→周计划最大→月计划存储→仅有基础交期；无计划交付事实的整单不冒用customer_due_date或expected_shipping_date。
- 订单数按scope真正关联的DISTINCT订单。订单需求/完成/欠数仍使用选中订单的group正式整单值；月计划/执行按所选品号。不同业务粒度明确，不能用计划拆分值冒充订单字段。
- 工序与月计划255/500=51%、300/500=60%、525/500=105%，状态与数量进度独立；来源仍只有真实process_reports SUM。不改主计划表格配色、业务状态、人工报工和同步flags。
- 7天始终是上海昨天向前7完整production_date；顶部日期只限制业务scope。趋势专用10色色板按standardProcesses.order映射，完整中文scroll legend，tooltip按registry顺序显示日期/总量/非零工序，无花哨动画。
- 三张服务端分页明细（准备、纵向工序、风险）及事业部汇总按最终布局展示。风险同时保留“已延期、生产异常”，局部riskType只附加到风险表/其导出，不改变顶部scope。准备问题标明“计划准备问题”。
- 四个必须独立导出表：division-summary、plan-readiness、process-execution、risk-exception；保留的10工序汇总另有process-summary。每个表自己的导出按钮，仅该表全量匹配行，非当前页。未知tableKey=400。KPI/Chart不增加导出。
- 导出read∩export、tenant和字段裁剪不变，无export时所有按钮隐藏且API403；英文mps_<table_key>_<上海日期>.xlsx，中文事业部/工序/状态、ISO日期/百分比，无UUID/tenant/内部ID/hash，不用前端dataSource造Excel。
- 下钻改为Dashboard受控/drill接口附加同一服务端scope，再调用原Query Service权限/字段/范围逻辑；/meta仍为原资源。不能借PENDING任务视图绕过scope。Drawer为临时权限检查结果，独立下载仍由正式页面提供；Dashboard正式表均有独立导出。

## 验证、性能和发布门禁

- Dashboard API专项7；API全量107套993通过、1既有skip；Web专项10、全量49文件382通过且无未处理异常；Contracts22。
- 隔离真PG18全部既有迁移及19组业务检查：保留V1全部指标锁定，追加统一scope、关联候选、CUSTOM/租户、8日期组合/首末包含/跨月跨年、四表完整导出/审计/字段/中文无ID，以及正式下钻授权交集。
- Chrome11项：1366/1440/1920真实图表/resize/唯一纵滚动；原筛选/分页/正式下钻/空错loading无权；新增多选/日期候选联动、固定7天轴、四类独立英文下载保留全部顶部条件、无export隐藏。使用合成API响应，不冒充生产真实账号。
- API/Web类型、lint和monorepo build通过。仅既有Portal Fast Refresh、Vite大chunk、ts-jest JS transform、AntD React19、迁移pg并发query弃用提示。
- 测试修正记录：AntD两字按钮自动字距导致定位失败，明确aria-label；非搜索Select/多选标签遮挡输入，Chrome用控件焦点与ArrowDown打开，保留所有断言；测试ByRoleOptions误用exact已修正并重新通过类型/build。没有跳过失败用例。
- 真实生产只读聚合799ms、EXPLAIN738.693ms/planning25.855ms；事业部/客户120/115ms。同快照原始报工趋势与正式基础准备表达式对账一致。新scope初轮10~14s，EXPLAIN证明JIT编译12.36s；稳定复合键和仅该只读事务jit=off后恢复性能。不改全局数据库参数、不新增索引。
- 查询为集合聚合，无逐行数据库往返。主页面聚合1次SELECT，准备与工序明细各1次SELECT，候选按需各1次有界SELECT；事务设置单独计，不是N+1。原下钻list计数/分页各1次。
- 无业务migration/新索引，不改同步任务或flags，不写生产业务记录；Excel只通过Application写审计，本次生产不执行导出。
- 发布前备份20261015_145321：双库custom dump及含private的附件，pg_restore目录、三个SHA256、归档和mode600核验通过，保留data/backups，不入Git。
- 功能提交：`fcd5771de53a1a9349f1af3cbb15060854888ffa`，已push github/main并标准all部署；Repository/Web/API均为该完整SHA，STATUS=CONSISTENT。四容器healthy、原生产PG容器连续保留、Dispatcher active/running；Swagger/OpenAPI/pg_isready正常。
- 已部署静态资源Chrome完整11项通过（52.2s），包含10工序非零堆叠配色、多选日期联动及四类独立英文下载。页面HTTP200；匿名聚合/候选/明细/下钻/导出均401。入口：http://192.168.1.249:15172/master-plan-dashboard 。
- 真实生产只读明细耗时：准备269ms、工序1089ms、风险453ms；订单/品号候选95/91ms；订单日期/交付日期按月136/186ms。测试未持有或伪造生产真实账号。
- 生产核验：6项同步enabled/interval配置与开始基线完全相同，93条migration记录/最新时间不变，无迁移或业务写入。隔离测试容器按任务label核验后清理；业务备份保留。
- 已将正式Dashboard表格默认独立服务端导出、统一read/export权限及无技术ID规则写入项目AGENTS.md，未修改全局日期默认规范。临时安全下钻Drawer豁免已明确说明。
- 结束HEAD/最终发布提交为包含本报告最终补记的提交，使用 `git log -1 --format=%H -- outputs/KDOS_MPS_OVERVIEW_DASHBOARD_ACCEPTANCE.md` 定位；完整40位SHA记录在最终交付回复和私有data/mps-dashboard/rev1-final-state.json。最终记录提交仍标准all发布，Repository=Web=API须与该提交一致；证明为data/mps-dashboard/{deploy,check,health}-rev1-final.log。只提交本任务代码/测试/规则/文档，不提交真实业务数据或凭据，不强推。
- 回滚只标准部署保留的原应用代码/镜像，不恢复覆盖业务数据库、不修改flags。

## 人工验收

沿用V1重点，再验证订单/品号多选与已选标签、联动候选、两种日期四类周期、统一变化、固定7天时间轴、趋势十色、四张单表导出、完整筛选继承、无技术ID及英文文件名。真实账号数据/权限仍由用户验收，未获用户确认不判PASS。

指标合同：[KDOS_MPS_OVERVIEW_DASHBOARD_METRICS.md](KDOS_MPS_OVERVIEW_DASHBOARD_METRICS.md)。

---

以下为V1历史验收记录；与本轮冲突部分以REV1为准。

# KDOS-MPS-OVERVIEW-DASHBOARD-001 主计划综合大屏 V1

当前状态：**等待人工验收**。开发、自动验证与功能部署已完成；用户真实人工验收前不判最终PASS。
日期：2026-10-15（Asia/Shanghai）。

## 基线与资源

- 开始HEAD：`1bb0e58342aea0a317271f2d9656c15418280a20`，main；工作区初始干净。
- 基线运行Web/API=`870be11`，与HEAD仅上一任务两份outputs文档差异，没有回退。
- KDOS-AUDIT-ACTOR-IDENTITY-001源码已完成/部署，无未提交源码；保留其等待人工验收状态。
- 新资源：`mps-overview-dashboard`，独立planning Dashboard，未加入masterPlanResourceDefinitions。
- Web：`/master-plan-dashboard`。导航：PMC中心 → 大屏报表 → 主计划大屏 → 主计划综合大屏；原设备管理大屏不变。
- API：`GET /api/v1/master-plan-system/dashboard`、`/dashboard/candidates`、`/dashboard/export`。
- TableFilter/打印均NOT_APPLICABLE且登记真实中文原因；标准下钻继续调用原业务表metadata/list API。
- 首次功能提交：`fd616168cfe10430981dd967fefa0d0fb1580a48`；最终业务源码提交：`b34b12a31616a3b0bad6660674a9728640ac1e72`，两者均已安全推送github/main。最终验收记录提交仅补充测试定位器和报告，不改变运行行为。

## 指标与事实

详细合同：[KDOS_MPS_OVERVIEW_DASHBOARD_METRICS.md](KDOS_MPS_OVERVIEW_DASHBOARD_METRICS.md)。

| 项目 | 已锁定口径 |
|---|---|
| 订单数 | mps_group_plans按tenant+order_number唯一，一行一个订单，count(*) |
| 未完成订单数 | pending_quantity>0；未擅自引入开工语义，标签使用“未完成订单数” |
| 订单需求/完成/待完成 | SUM(required_quantity/completed_quantity/pending_quantity) |
| 订单完成率 | SUM(completed_quantity)/SUM(required_quantity)，不是AVG行百分比 |
| 月计划需求/入库/欠数 | scoped mps_monthly_plans正式数量字段SUM |
| 已下达周计划/下达率 | SUM关联weekly.planned_quantity)/SUM(monthly.required_quantity) |
| 入库完成率 | SUM(cumulative_inbound_quantity)/SUM(required_quantity) |
| 准备情况 | 基础计划正式派生weeklyPlanState：已进入周计划/已具备条件/待完善；条数与占比 |
| 辅助计划 | 原auxiliaryPlanGroups移至contracts共用，保持原四类标题/顺序及原状态；月计划状态等价集合聚合，无第二套业务定义 |
| 工序registry | 唯一@tracker/shared.standardProcesses，按order；名称/数量/顺序动态生成 |
| 工序需求 | 当前授权月计划SUM(required_quantity)，包括尚未下达部分 |
| 实际报工 | 仅mps_process_reports，先按tenant+weekly_plan_id+process_code SUM(production_quantity) |
| 生产进度 | SUM关联实际报工)/SUM月计划总需求；255/500=51%，300/500=60%，525/500=105%，不截断 |
| 状态独立 | 状态仅正式任务/报工定性规则，已完成仍可60%，不从数量反推或修改状态 |
| 最近7天 | 上海昨天向前7个完整自然日，不含今天；按production_date SUM实际报工；动态工序堆叠柱图 |
| 延期 | 正式latestCustomerDueDate早于上海今天且pending_quantity>0；复用未完成周计划优先交期表达式 |
| 临期 | 尚无正式阈值，本版未展示 |
| 生产异常 | 仅技术/材料/外协/工序四类人工报工exception_text；来源+文本去重、正式稳定顺序，等价exceptionSummary |
| 计划待完善 | 基础计划weeklyPlanState及weeklyPlanMissingFields/weeklyPlanGenerationIssue，不计生产异常 |
| 事业部比较 | 月计划需求/下达/下达率/入库/入库率/欠数/延期条数/异常条数；延期/异常单位明确为月计划条数 |
| 零分母/超额 | 比例null显示—；保留真实超额值；无NaN/Infinity |

订单按主责primaryDivisionId；计划/执行按承接divisionId。当前事实，无全局历史快照日期，不展示金额，不推断3天工单完成。

## 权限和交互

- 大屏自己的read/export/字段权限/data scope；月计划read不授予大屏，大屏read也不授予月计划接口。
- ALL只在当前tenant生效；CUSTOM仅divisionId EQ/IN稳定UUID，非法/混合不支持规则整体403；OWN用created_by。统一复用buildDataScopeClause。
- 周计划的客户/品项搜索匹配其自身字段或授权月计划/基础计划稳定关联；报工继承业务筛选，同时自己的scope和事业部始终AND。月计划进度仅取关联事实，趋势保留没有对应月计划的实际报工，准备状态也不以月计划存在为前提。
- 风险/正式Drawer复用平台serverData与标准页大小（默认100），同身份翻页保留上页数据；风险服务端排序有白名单/字段授权并传入Excel。工序表保持registry顺序。
- 所有KPI、图表、趋势、事业部、风险、候选使用同一scoped事实；客户远程搜索限30项并返回hasMore，不加载全量客户。
- 字段权限裁剪JSON/候选/图表/风险/Excel；派生比例还需分子分母可读，不查金额或图片。
- 下钻Drawer调用原资源metadata/list，重新执行原资源权限、字段和scope；无原表权限提示，不绕过授权。KPI、准备图、工序图、趋势及风险均有正式下钻/联动。
- Excel两工作表：事业部汇总、全部筛选风险；read∩export，完整风险不受当前分页限制，继承筛选/字段并经Application写导出审计。数量超过Excel15位精度时保留精确文本。
- 30分钟自动刷新＋手工刷新；查询按用户/权限/筛选缓存60秒，清空可以复用仍新鲜的原查询缓存，刷新强制读取。均不触发任何同步。
- KdosChart统一主题/loading/empty/resize/点击；KdosDataTable default密度及横向滚动，页面唯一纵向滚动。无重复标题/用途说明，无大屏打印/PDF/截图导出产品功能。

## 性能与数据边界

最终聚合一条SELECT；同一只读REPEATABLE READ事务另有只读声明及tenant/timezone/15s timeout设置（3次显式SQL，另BEGIN/COMMIT和隔离级别设置）。候选同样一条有界SELECT。无逐行数据库往返/N+1；按周计划、工序、辅助和异常来源集合预聚合，多处复用CTE。

真实生产只读查询约828ms；EXPLAIN ANALYZE约752.606ms，planning17.168ms；事业部/客户筛选分别52/43ms（私有执行计划data/mps-dashboard/explain.json）。同一只读REPEATABLE READ快照已与原始production_date汇总和基础计划正式weeklyPlanState表达式对账一致，包含没有对应月计划的真实周计划报工。未新增索引/业务表/数据库实例或migration。首轮逐行派生方案触发15s保护后已替换并验证；未用索引掩盖查询结构问题。

不修改业务表、报工、完成率、状态、异常、ERP、同步流程或任何同步enabled flags。下载只额外记录正式导出审计；无新增调度任务。

## 自动验证

| 门禁 | 结果 |
|---|---|
| Dashboard API专项 | 6项通过：HTTP403、独立授权、隐藏筛选、UUID、登记、scope拒绝非法规则 |
| 主计划API定向 | 398通过、1既有skip |
| API完整 | 107套通过，992项通过，1既有skip |
| Dashboard Web专项 | 7项通过 |
| Web完整 | 49文件379通过；maxWorkers=2/testTimeout=15000，无未处理错误 |
| Contracts | 22通过 |
| 真PostgreSQL18 | 14组通过；全部既有迁移在隔离库运行；51/60/105、状态独立、多次报工、父名称筛选、正式表达式一致、范围/租户/字段、全量导出/审计、分页、30候选上限 |
| Chrome | 9项通过；1366/1440/1920、实际canvas/resize/单纵滚动、筛选/清空/刷新、图表/风险正式下钻、空/错/loading、无权限、风险及正式Drawer跨页 |
| API/Web typecheck | 通过 |
| API/Web lint | 通过；仅原Portal Fast Refresh warning，无新增lint warning |
| monorepo build | 通过 |

首轮Web默认5s并发运行出现超时及环境拆卸后的React异常；新增测试两处有重复ARIA名称的选择器已修正为role。完整断言在双worker/15s上限下全部通过，没有跳过失败。分页复核后再次全量出现一条React环境卸载异常，已显式销毁AntD静态消息根、取消并清空测试QueryClient，以act完成卸载；随后49文件379项且0未处理错误通过。Chrome清空测试已按查询缓存语义验证UI重置与随后强制刷新无旧条件，不强求缓存有效时重复请求。部署页面复测另发现AntD加载图标使按钮可访问名称暂含loading，精确名称定位超时；已按刷新文本定位，保留全部刷新请求与下钻断言，针对项和完整9项重新验证。

既有告警类别：Portal Fast Refresh、Vite大chunk、ts-jest JS transform（新增contracts JS文件也受同一配置告警）、AntD/React19及迁移时pg并发query弃用提示；未改变工具链。

## 备份、部署与Git交付

最终部署前备份：`20261015_135905`，双库custom dump与uploads（含.private及现有通知回执）；pg_restore目录、私有目录归档和三个SHA256复核成功。保存在data/backups，mode600；不入Git。

GitHub：仅本任务文件提交与push github/main，不强推。功能发布执行 `./scripts/deploy.sh all`，随后check显示Repository/Web/API完整SHA均为 `b34b12a31616a3b0bad6660674a9728640ac1e72`，STATUS=CONSISTENT。Web/API/PostgreSQL/document-worker四容器healthy，Swagger/OpenAPI/pg_isready正常；独立企业微信Dispatcher保持active/running，未更改任何调度。生产PostgreSQL保持原容器、持续7天运行，没有重建。

线上HTTP：`/master-plan-dashboard`返回200；匿名聚合、候选、Excel三个API均401。已部署静态资源的Chrome完整9项复测使用合成API响应；真实生产SQL只读对账另行验证，不把合成响应视为真实登录账号验收。入口：http://192.168.1.249:15172/master-plan-dashboard 。

数据核验：迁移数量/最新时间与任务开始基线一致，全部同步enabled与interval_minutes完全一致；没有执行生产导出审计或业务写操作。双库及附件恢复材料留在data/backups；本任务不运行migration、不新增索引、不恢复或覆盖业务数据库。回滚只回到已备份的原代码/镜像并标准部署，不回滚业务数据。

结束HEAD/最终发布：包含本报告及测试定位器修正的最终提交，可用 `git log -1 --format=%H -- outputs/KDOS_MPS_OVERVIEW_DASHBOARD_ACCEPTANCE.md` 精确定位。完整40位SHA在本次最终交付回复及私有 `data/mps-dashboard/final-state.json` 记录；最终Repository/Web/API必须与该提交一致。功能已在上述b34b12a核验，最终记录提交仍标准all部署并执行check/health；部署证据为私有 `data/mps-dashboard/deploy-final.log`、`check-final.log`、`health-final.log`，不提交业务数据或凭据。

## 等待人工验收

生产真实管理员/普通成员登录态业务核验未由自动化冒充：Chrome自动化使用合成响应，不持有或伪造生产凭据；生产数据库只读执行真实同源SQL。用户须在现有账号按以下重点验收后才可判最终PASS：

1. 订单及数量阶段可信；准备状态/辅助延期正确。
2. 标准工序完整有序，月/周事实一致，>100%真实，已完成与进度独立。
3. 上海7天趋势、事业部切换全部区域一致。
4. 已延期与人工生产异常正确、计划提示不混入。
5. KPI/图表/风险下钻、原表权限、Excel范围与字段正确。
6. 无权限账号不能访问；1366/1440/1920清晰、无重复说明或双纵滚动。

本任务状态只能为“等待人工验收”，不得自动判PASS。
