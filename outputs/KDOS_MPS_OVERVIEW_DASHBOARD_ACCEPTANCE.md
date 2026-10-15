# KDOS-MPS-OVERVIEW-DASHBOARD-001 主计划综合大屏 V1

当前状态：最终修正版验证与部署中；业务结论保留等待人工验收。最终必须等待用户人工验收。
日期：2026-10-15（Asia/Shanghai）。

## 基线与资源

- 开始HEAD：`1bb0e58342aea0a317271f2d9656c15418280a20`，main；工作区初始干净。
- 基线运行Web/API=`870be11`，与HEAD仅上一任务两份outputs文档差异，没有回退。
- KDOS-AUDIT-ACTOR-IDENTITY-001源码已完成/部署，无未提交源码；保留其等待人工验收状态。
- 新资源：`mps-overview-dashboard`，独立planning Dashboard，未加入masterPlanResourceDefinitions。
- Web：`/master-plan-dashboard`。导航：PMC中心 → 大屏报表 → 主计划大屏 → 主计划综合大屏；原设备管理大屏不变。
- API：`GET /api/v1/master-plan-system/dashboard`、`/dashboard/candidates`、`/dashboard/export`。
- TableFilter/打印均NOT_APPLICABLE且登记真实中文原因；标准下钻继续调用原业务表metadata/list API。
- 首次功能提交：fd616168cfe10430981dd967fefa0d0fb1580a48，已推送并部署；分页/真实报工范围修正版将在最终发布中替换。

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

真实生产只读查询约828ms；EXPLAIN ANALYZE约752.606ms，planning17.168ms；事业部/客户筛选分别52/43ms（私有执行计划data/mps-dashboard/explain.json）。未新增索引/业务表/数据库实例或migration。首轮逐行派生方案触发15s保护后已替换并验证；未用索引掩盖查询结构问题。

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

首轮Web默认5s并发运行出现超时及环境拆卸后的React异常；新增测试两处有重复ARIA名称的选择器已修正为role。完整断言在双worker/15s上限下全部通过，没有跳过失败。分页复核后再次全量出现一条React环境卸载异常，已显式销毁AntD静态消息根、取消并清空测试QueryClient，以act完成卸载；随后49文件379项且0未处理错误通过。Chrome清空测试已按查询缓存语义验证UI重置与随后强制刷新无旧条件，不强求缓存有效时重复请求。

既有告警类别：Portal Fast Refresh、Vite大chunk、ts-jest JS transform（新增contracts JS文件也受同一配置告警）、AntD/React19及迁移时pg并发query弃用提示；未改变工具链。

## 备份、部署与Git交付

最终部署前备份：`20261015_135905`，双库custom dump与uploads（含.private及现有通知回执）；pg_restore目录、私有目录归档和三个SHA256复核成功。保存在data/backups，mode600；不入Git。

GitHub：仅本任务文件提交与push github/main，不强推。正式部署使用 `./scripts/deploy.sh all`，随后check/health及线上Chrome/HTTP核验。此节将在实际部署后记录功能提交与执行结果；最终Repository/Web/API必须统一，不能以本地代码完成代替交付。

## 等待人工验收

生产真实管理员/普通成员登录态业务核验未由自动化冒充：Chrome自动化使用合成响应，不持有或伪造生产凭据；生产数据库只读执行真实同源SQL。用户须在现有账号按以下重点验收后才可判最终PASS：

1. 订单及数量阶段可信；准备状态/辅助延期正确。
2. 标准工序完整有序，月/周事实一致，>100%真实，已完成与进度独立。
3. 上海7天趋势、事业部切换全部区域一致。
4. 已延期与人工生产异常正确、计划提示不混入。
5. KPI/图表/风险下钻、原表权限、Excel范围与字段正确。
6. 无权限账号不能访问；1366/1440/1920清晰、无重复说明或双纵滚动。

本任务状态只能为“等待人工验收”，不得自动判PASS。
