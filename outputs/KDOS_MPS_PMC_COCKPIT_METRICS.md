# PMC综合驾驶舱 REV3-C 指标合同

2026-10-16；任务KDOS-MPS-DASHBOARD-REV3C-001，起点50a518741dd77f9c476a5a1aa4e1f93af2babbc9。本轮重组已有指标，不更改正式事实、历史完成率、9类差集或权限语义。A/B已由用户人工验收PASS。

## 指标、粒度及目标

| KPI/模块 | 正式来源与汇总 | 粒度/业务日期 | 下钻/联动 |
|---|---|---|---|
| 订单数 | scoped_group正式集团订单count DISTINCT order_number，tenant/order唯一 | 订单数，主责事业部授权 | 原集团计划Query Drawer |
| 未完成订单数 | 同一集合pending_quantity>0的订单数 | 订单数 | 原集团计划INCOMPLETE视图 |
| 订单整体完成率 | 保留原Dashboard正式SUM(group.completed_quantity)/NULLIF(SUM(group.required_quantity),0) | 订单整体量比；不是逐单已存完成率的平均 | 集团计划Drawer；B逐单原存储completion_rate不改变 |
| 订单完成分布 | 同一已授权订单总数与未完成订单数；已完成=总数-未完成 | 订单数，二类互斥；不加入月计划延期条数 | 集团计划COMPLETE/INCOMPLETE |
| 月计划需求/累计入库/欠数 | scoped_monthly对应required_quantity/cumulative_inbound_quantity/pending_quantity各SUM正式存储值 | 月计划品项/承接事业部；当前数量 | 原月计划Drawer |
| 已下达周计划/下达率 | 原dispatchedWeeklyQuantity聚合；SUM已下达weekly.planned_quantity / SUM月计划required_quantity | 原tenant/order/item正式关联与scope不变 | 原月计划Drawer；称下达率，不称生产完成率 |
| 入库完成率 | SUM正式累计入库 / SUM正式月计划需求 | 月计划 | 事业部比例图与汇总表 |
| 延期月计划条数 | pending_quantity>0且正式latestCustomerDueDate<上海今天 | 月计划条数，不是订单数或延期欠数数量 | 仅对应gap可读时跳转overdue；其它情况纯指标 |
| 事业部数量/比例/风险 | 原division_rows、原planSummary；需求/下达/入库/欠数、下达率/入库率、延期/人工异常月计划条数 | 承接division_id，不把集团主责整单数量合并求和 | 图表/事业部名称切统一顶部scope；division-summary独立Excel |
| 10工序需求/实际/生产进度 | 原月计划SUM required；报工先按tenant/weekly/process SUM生产数量，再原monthly_weekly归属汇总；实际SUM/月计划需求SUM | standardProcesses.order唯一顺序；分母0→null/—；允许105%，不平均行百分比 | 原工序报工Drawer；保留10行折叠汇总及process-summary导出 |
| 10工序状态分布 | 原正式月计划工序状态（延期优先/全部完成/进行中/否则未开始）按工序计数 | **月计划条数**，不冒称真实工序任务数、负荷/设备瓶颈 | 仅正式状态，不由进度反推 |
| 计划准备 | 原base weeklyPlanState分布 | 基础计划条数；准备提示不等于生产异常 | 原基础计划Drawer |
| 图纸/五金/木作/外协 | auxiliaryPlanGroups唯一四类；原正式monthly状态分布 | 月计划条数，保留原中文状态，无资料不造不适用/齐套率 | 月计划对应状态Drawer |
| 最近7天报工 | scoped_process_reports.production_date按日/标准工序SUM(production_quantity) | Asia/Shanghai昨天往前7完整自然日，不含今天；顶部订单/交付日期仅限定业务scope | 按生产日期下钻正式报工；原高区分色板/完整中文Legend/日期+总量+工序Tooltip |
| 交付风险摘要 | 原gaps.overdue/production-exception/plan-not-ready/no-inbound | 前两者及未入库=月计划条数；待完善=基础计划条数，明确单位 | 白名单URL定位对应待处理Tab，继承全部顶部条件 |

数量对比为不同业务口径的当前量，采用横向Bar；不包装为单向转化漏斗、真实产能、等价工作负荷。事业部比例与数量/风险通过切换独立图表，比例轴明确百分比；不同计量单位的正式数量SUM沿原合同，仅用于当前计划量对照。

## Scope、权限、关联与导出

完整继承REV1/REV2的同一facts/dashboard_scope及derived SQL：每源先tenant、mps-overview-dashboard read、字段依赖和数据范围；group主责primary_division_id，其余真实承接division_id。订单日期优先正式集团日期，否则原计划回退；交付日期保持原未完成weekly最早→weekly最大→monthly→base/shipping回退。源报工与父周计划各自授权；筛选参数化，非法CUSTOM整体拒绝，OWN仍created_by。金额及内部标识不新增。

新`GET /dashboard/summary`执行同一querySql聚合，省略首页不用的风险行投影，返回MpsDashboardSummary（不含risks）。原summary兼容路由、gaps、gap-counts、reports、table、export保持不变。没有第二套差集或统计SQL，不按行往返。

所有指标/图表逐字段裁剪；未授权的工序报工不以0推断，未授权异常不显示计数。无overview read→页面拒绝/API403；无export→按钮隐藏且API403。CUSTOM继续仅事业部UUID EQ/IN；新报表入口同资源，不初始化生产授权。

事业部汇总、计划待完善、工序执行、风险与异常及原工序10行汇总均复用MasterPlanDashboardExportService及Application审计：read∩export/tenant/字段/顶部和本表局部条件/排序，全部匹配记录，英文xlsx、中文业务值、无UUID。KPI/Chart不增加导出按钮。

## 跨屏及明细保留

原URL/master-plan-dashboard改名PMC综合驾驶舱；三张明细移到/master-plan-reports（PMC中心→报表→PMC分析明细报表），各用原MpsDashboardDetailTable与API，独立服务端分页/搜索/排序/局部条件/导出。首页不再请求这些清单及9类完整Tabs。

跨屏只接受from=pmc-cockpit标记及原filters白名单：事业部/客户/订单数组/品号数组/日期类型与周期和原子日期；类型、长度、数组上限、日期使用现有contract校验，gap仅9类白名单。未知身份/权限/SQL/重定向参数不进入filter，非法已声明条件显示错误并停止请求。目标再次校验自己的read/fields/scope；不从来源授权。显式NONE区分携带不限日期与直接打开B默认上海昨天；A/B直接打开及重置行为保持原样，不重构平台路由。

## 验证边界

自动合成Chrome与真实生产READ ONLY对账分别报告。真实核验当前全局/事业部/订单/交付日期四组耗时及核心数量、比例、工序实际和状态、7日趋势；四事业部在获权scope内展示，不为无权限或无事实事业部伪造0。无migration、业务/历史/报工/入库/6flags或生产权限写入；C最终WAITING_MANUAL_ACCEPTANCE，D不启动。
