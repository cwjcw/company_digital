# KDOS-MPS-OVERVIEW-DASHBOARD-001-REV1 指标与筛选合同

本节覆盖下方V1中无全局日期、模糊搜索、30候选和整屏Excel规则；保留V1数量/进度/状态/异常正式定义。

- 默认不限日期，是本大屏明确业务例外，不修改全局规范。日期类型为不限/订单日期/交付日期；按日、月、年、自定义。上海日历，SQL date区间统一[start,endExclusive)，自定义输入末日包含。
- 所有源事实先按tenant、dashboard read scope（导出再交export scope）授权；再建立tenant+order_number+item_code+承接division_id稳定身份。无计划的订单保留主责事业部的整单身份。顶部业务条件只在这一统一scope上解释，各区域、候选、明细和Excel由该scope派生；报工仍需自身授权且以weekly_plan_id关联，不能用旧快照名称扩大范围。
- 订单日期统一到订单身份：优先授权集团订单order_date；缺失时依序取授权monthly/base/weekly中同单最早非空order_date。此值只生成一次；不在不同卡片各自按快照筛选。
- 交付日期唯一口径为正式latestCustomerDueDate：同tenant/order/item中未完成周计划最早latest_customer_due_date，否则周计划最大交期，否则月计划存储交期；仅有基础计划时取该品号基础交期最早值。集团customer_due_date是客户约定日期，不等同计划交付；无任何计划交付事实的整单在交付筛选时不匹配。不使用expectedShippingDate。
- 事业部选择承接业务身份；整单无品项事实时使用主责事业部。每张事实自己的授权组织映射仍保留（group.primary_division_id，其余division_id），关联不绕过权限。
- 订单KPI只取统一scope中实际存在的DISTINCT订单（精确tenant/order/item关联）。订单数量字段保持mps_group_plans整单正式值，选中某品号/交付日期是选择包含该品号的订单；不按比例拆分整单完成量。计划/执行/风险则取scope内品号与事实，明确不同业务粒度。
- orderNumbers/itemCodes为正式值多选，精确IN；候选支持订单号、品号/品名搜索，统一scope内去重，最多50+hasMore；当前目标自身选择不限制该目标候选，其余条件全部继承。已选label在前端保存，候选不得来自当前页。
- 最近7天横轴仍为上海昨天往前7完整日production_date；顶部日期限定业务身份，不能替换报工横轴。所有授权工序来自standardProcesses.order，趋势专用高区分色板按order映射，不改主计划表格色板；tooltip按registry顺序显示日期、总量和非零工序。
- 四张明细/汇总为division-summary、plan-readiness、process-execution、risk-exception。工序明细按月计划订单+品号+工序纵向一行，月计划required_quantity分母及正式状态独立；准备明细仅weeklyPlanState=待完善，问题标注计划准备问题。现有工序汇总表另有process-summary单表导出；正式下钻沿用原资源导出权限/接口。未知tableKey=400。
- 每张表独立服务端xlsx，只导所选表全部匹配行，继承顶部/自身局部条件及服务端安全排序，read∩export、字段裁剪、正式Application审计；无export权限隐藏按钮且API403。英文文件名mps_<table_key>_<上海日期>.xlsx，中文事业部/工序/状态、ISO日期、百分比单元格，永不回退导出组织UUID或技术ID。
- 性能核验：生产聚合799ms，EXPLAIN738.693ms/planning25.855ms，事业部/客户120/115ms。初轮新scope估算导致JIT编译12.36s，改为稳定JSON复合键并只在该只读事务jit=off；不改全局参数。
- 不新增业务migration/索引；无业务记录/状态/同步flags写入。生产只读EXPLAIN和最终测试结果在验收报告更新。

---

以下为V1历史指标定义；与本节冲突处以REV1为准。

# KDOS-MPS-OVERVIEW-DASHBOARD-001 指标合同

2026-10-15；依据实际 migration47、MasterPlan config/virtualColumns、sync/Application、共享standardProcesses与平台权限服务确认后锁定，先于实现。

统一权限：独立资源 mps-overview-dashboard，planning；read、字段读权限和该资源自己的data scope。所有表显式tenant且事务设置租户上下文；CUSTOM divisionId按稳定organization UUID，group映射primary_division_id，其余映射division_id，OWN按created_by。订单为主责事业部，计划/执行为承接事业部，两者业务含义不同。子事实同时受自己与父周计划范围约束，不能因关联读取越界。筛选/候选同范围，客户限量远程搜索。大屏授权不授予正式业务表，下钻需对应资源权限及该资源自己的scope；采用正式Query API Drawer，不绕过权限。

所有当前数量不做全局历史日期筛选；Asia/Shanghai业务日。数量SQL numeric精确聚合，比例为总量相除，不平均行百分比，分母0/NULL返回null；不截断超过100%的真实值。金额不查询。

| KPI/领域 | 业务定义/聚合 | 来源表与字段 | 粒度/时间 | 下钻 |
|---|---|---|---|---|
| 订单数 | count(*)，uq_mps_group_plan(tenant_id,order_number)保证一行一订单 | mps_group_plans.order_number | 当前订单，主责事业部 | 订单表 |
| 未完成订单数 | pending_quantity>0的订单数；正式sync以max(required-completed,0)表达未完成，避免新增“开工”语义，命名未完成 | 同表.pending_quantity | 当前订单 | 订单表未完成视图 |
| 需求/完成/待完成 | 各字段SUM | 同表.required_quantity/completed_quantity/pending_quantity | 当前订单 | 订单表 |
| 整体完成率 | SUM(completed_quantity)/SUM(required_quantity) | 同上 | 当前订单 | 订单表 |
| 月计划需求/入库/欠数 | SUM各正式字段 | mps_monthly_plans.required_quantity/cumulative_inbound_quantity/pending_quantity | 当前订单+品号，承接事业部 | 月计划 |
| 已下达周计划/下达率 | 关联weekly.planned_quantity总和 / SUM(monthly.required_quantity)，复用dispatchedWeeklyQuantity语义 | mps_weekly_plans，按tenant/order/item关联 | 当前月计划 | 月/周计划 |
| 入库完成率 | SUM(cumulative_inbound_quantity)/SUM(required_quantity) | mps_monthly_plans | 当前月计划 | 月计划 |
| 周计划准备 | count及总数占比；已进入周计划/已具备条件/待完善 | mps_base_plans，复用virtualColumns weeklyPlanState/weeklyPlanMissingFields/weeklyPlanGenerationIssue | 每基础计划；当前 | 基础计划；缺少项/生成提示只属计划提示 |
| 辅助计划状态 | 复用auxiliaryPlanGroups；按正式月计划technicalStatus/hardwareStatus/woodStatus/outsourcingStatus分布；保留原状态文字 | 技术/材料/外协reports与weekly，复用monthly virtualColumns | 每月计划；当前 | 月计划 |
| 工序需求/实际/进度 | 每标准工序分母SUM(scoped monthly.required_quantity)；报工先按tenant/weekly/process SUM(production_quantity)，再归属monthly累加；除以月计划总需求 | mps_process_reports→mps_weekly_plans→mps_monthly_plans | 每工序，当前月计划整体进度，包含尚未下达的需求 | 工序报工正式API |
| 工序状态 | 正式monthly状态规则（延期优先、全部完成、进行中、否则未开始），独立于实际进度；按月计划状态分布 | mps_weekly_process_plans.status，经monthly virtualColumns | 每工序/月计划 | 月/周计划 |
| 最近7天趋势 | 按production_date每日SUM(production_quantity)，动态标准工序series | mps_process_reports.production_date/production_quantity | 上海昨天向前7个完整自然日，不含今天 | 实际工序报工 |
| 事业部对比 | 需求、下达、下达率、入库、入库率、欠数、延期月计划条数、异常月计划条数 | scoped monthly及关联正式执行事实 | 承接事业部UUID，当前；延期/异常为订单+品号条数，并非去重订单数 | 对应月计划 |
| 已延期 | pending_quantity>0且正式latestCustomerDueDate<上海今天；交期复用monthly虚拟字段（优先未完成周计划最早客户交期，否则最新/存储值） | mps_monthly_plans，关联weekly.latest_customer_due_date | 月计划条数；当前 | 月计划 |
| 生产异常 | exceptionSummary非空；仅四类人工报工exception_text，来源+文本去重，技术→五金→木作→外协→标准工序顺序 | mps_technical_reports/mps_material_reports/mps_outsourcing_reports/mps_process_reports | 月计划条数；当前 | 月计划/报工 |
| 计划待完善 | weeklyPlanState=待完善，显示weeklyPlanMissingFields和weeklyPlanGenerationIssue | mps_base_plans及正式派生表达式 | 基础计划条数；当前 | 基础计划 |

不展示：临期（无正式阈值）、历史快照、订单金额、从3天工单日期推断完成。所有系统配置/同步错误/data_exceptions均不计生产异常。状态与进度互不改变；525/500=105%，255/500=51%，300/500=60%。

辅助计划当前真实状态：技术已完成/未完成/延期；五金和木作未开始/延期/已完成；外协未开始/进行中/延期/已完成（月计划将已入库聚合为已完成）。无数据按正式派生逻辑，不创造新枚举。标准工序唯一来源@tracker/shared，按order排序。

字段权限：仅注册实际返回/筛选指标；派生比例需指标及分子/分母可读，状态摘要/风险文本独立裁剪。筛选字段不可读则拒绝对应筛选，不泄漏候选。无独立记录表，TableFilter NOT_APPLICABLE真实中文登记，不伪造表。

导出：复用既有ExcelJS/正式Dashboard同源查询模式，事业部汇总及全部筛选风险明细，read∩export范围、字段裁剪并审计；不复制新的通用Excel框架。刷新保守30分钟＋手工刷新，不触发同步。性能以实际EXPLAIN结果记录，不预增索引；如必须索引/权限migration则STOP并报告。

实现核验：正式状态/交期/exceptionSummary逻辑以等价集合预聚合执行，避免逐月反复相关子查询；基础计划仍复用正式派生SQL。scope helper复用buildDataScopeClause，CUSTOM仅支持divisionId EQ/IN合法UUID，遇到其他或混合非法规则整体拒绝，防止静默丢弃条件扩大范围。报工客户条件由授权父周计划继承（报工表本身没有customer_code），报工自己的divisionId/OWN范围同时保留。

性能（当前真实生产只读）：聚合请求828ms；EXPLAIN ANALYZE 752.606ms，planning17.468ms；未新增索引/迁移，保留15s超时保护。一次聚合SELECT（同一只读REPEATABLE READ事务内另有只读声明与tenant/timezone/timeout设置）；候选每次一条限量SELECT＋事务设置，无按行往返查询。刷新30分钟＋手工。

全局事业部筛选分别AND到各事实自己的组织UUID，不能仅凭父计划事业部放行不同事业部报工。周计划业务搜索匹配自身当前字段，或匹配授权月计划/基础计划的稳定关联身份，避免旧快照名称漏计；报工继承授权周计划业务筛选，并始终保留自己的tenant/data scope/事业部条件。scoped CTE仅选必要列，不读取订单金额或图片。

月计划工序/辅助/交期/异常汇总只关联当前scoped月计划的周计划（monthly_weekly），工序分子只取monthly_reports；最近7天趋势直接汇总全scoped实际报工，不以月计划是否存在为前提。基础计划“已进入周计划”按授权周计划真实关联判定，不要求先有月计划。真实生产同一REPEATABLE READ快照下，趋势已逐日/逐工序与原始报工SUM对账，准备分布已与正式weeklyPlanState表达式对账一致。

风险明细与正式下钻统一接入KdosDataTable serverData，页大小复用平台白名单，默认100，服务端分页/排序；翻页保留同身份上页数据，避免组件卸载将页码重置为1。风险排序字段白名单与字段读权限同检，Excel继承风险排序。工序表禁用排序以保持registry.order。
