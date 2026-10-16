# 在制订单进度 Demo 指标合同（REV3-B）

任务 KDOS-MPS-ORDER-PROGRESS-REV3B-001；2026-10-16；状态：PASS（用户于2026-10-16确认人工验收）；指标锁定、实现、自动核验与功能部署完成。所有查询只读，上海自然日。本指标合同仅定义REV3-B；其它阶段状态以REV3总控为准。

| 指标 | 来源字段与公式 | 粒度/关联 | 空值与权限依赖 |
|---|---|---|---|
| 订单需求/完成/待完成/完成率 | group.required_quantity/completed_quantity/pending_quantity/completion_rate 原值 | tenant + group.id；正式 UNIQUE(tenant,order_number) | 不由10工序、入库或可见子行重新计算；分别独立字段权限，完成率另依赖需求和完成字段 |
| 未完成订单 | group.pending_quantity>0；正式来源未覆盖月计划也保留待核实，不能视为完成 | 同上 | 默认开启；筛选依赖 orderPendingQuantity 与 coverageStatus 权限，不以缺月计划=0推断完成 |
| 品项需求/累计入库/欠数/入库完成率 | monthly.required_quantity/cumulative_inbound_quantity/pending_quantity/completion_rate 原值 | tenant + monthly.id；当前schema仍 UNIQUE(tenant,order,item)，同时保留division | 已下达和入库是不同事实；无月计划全部为null，不造需求或完成率；完成率依赖需求/累计入库字段 |
| 已下达周计划数量 | 正式 dispatchedWeeklyQuantitySql | 多条weekly先归属唯一monthly，再SUM(planned_quantity) | 无周计划为0；依赖 dispatchedWeeklyQuantity |
| 缺月计划来源行 | 活跃allocation按id/allocation_id反连接；无allocation/monthly品号的活跃ERP源行按id保留 | allocation独立UUID及批次/行身份；ERP独立source UUID | 仅显示真实来源行数量（allocation.allocated_quantity / ERP.order_quantity），不能当月计划需求；缺月计划的独立追加行不因同order/item而消失 |
| 未完成品项数/默认品项范围 | monthly.pending_quantity>0 或独立缺月计划来源行 | 当前授权/顶部筛选范围内的品项行，未建月计划行是待核实品项 | 明确称品项数，重复品号不同来源不去重；依赖 pendingQuantity、planStatus与unfinishedItemCount |
| 图纸 | virtualColumns(月计划/周计划).technicalStatus | weekly_plan_id → 技术报工；月计划复用正式状态优先级 | 没有任何关联技术记录时显示无记录，包裹存在性检查，不能用正式聚合ELSE误称未开始；无图纸百分比 |
| 五金/木作主材 | virtualColumns.hardwareStatus / woodStatus，received或actual_inbound_date为正式到位事实，正式due_date判延期 | tenant + weekly_plan_id + material_name | 无记录显示无记录；有占位记录按正式未开始；不推断材料齐套率/不适用 |
| 外协 | virtualColumns.outsourcingStatus，人工状态来源 | tenant + weekly_plan_id | 仅计划/日期不足以证明外协需求；无记录显示无记录，不推断未开始/不适用；保留真实外协记录正式状态 |
| 工序状态 | virtualColumns(月计划).<code>Status 原规则 | 正式weekly_process_plans，tenant+weekly_plan_id+process_code | 没有工序任务显示无工序任务，不推断不适用；状态与实际数量/进度互相独立 |
| 工序累计实际报工 | 正式 monthlyReportedSum，先按weekly_plan_id/process_code SUM，多个weekly再SUM | weekly → process_reports稳定UUID；同一工序多次报工必须SUM | 无实际报工记录=0（实际累计事实），不以计划量、MAX或最近一条代替；按工序独立字段权限 |
| 工序生产进度 | virtualColumns(月计划).<code>ProductionProgress：累计实际/月计划required_quantity | 每monthly/标准工序 | 需求<=0/null为null；255/500=51%，525/500=105%，不封顶；依赖该工序需求与累计实际字段 |
| 最近报工日期 | MAX(process_reports.production_date) | 每monthly/标准工序；保留Drawer内weekly批次 | 无记录null；不是状态或报工数量来源；独立字段权限 |
| 人工异常 | 正式月/周计划exceptionSummary，仅技术/五金/木作/外协/10工序人工exception_text | 正式报工关联聚合 | 不含任务提示、同步失败或数据质量提示；独立字段权限 |

## 正式口径与身份边界

集团completion_rate当前投影实现为月计划单品入库比率的平均值，completed_quantity为受需求上限约束的数量之和；两者不能擅自改成数量加权值。看板直接显示集团存储字段，品号层明确显示“入库完成率”，工序显示“生产进度”。不改变这些既有公式或投影。

月计划唯一键尚未随allocation追加批次一起改为多条：不能把多条allocation都JOIN给monthly。月计划行按monthly.id一次展示；其它未关联allocation按其UUID保留“尚未建立月计划”，不分摊既有入库或报工。报工先归属weekly UUID；weekly经base.shipping_plan_id→shipping.monthly_plan_id绑定月计划，同时必须tenant/事业部匹配。没有正式父链时仅使用当前数据库证明唯一的tenant/order/item关联，并仍匹配事业部；不将其它事业部周计划累计到本行。每个weekly最多归属一个monthly。

订单层始终来自正式集团订单；没有集团订单不凭allocation伪造订单完成率。已有集团订单即使缺月计划仍可保留。子行来源按身份保留，无可靠来源时显示空态/覆盖待核实，不认定已完成。

## 查询、筛选与权限

新资源mps-order-progress-dashboard经现有编译期registry注册，无数据库初始化。系统/PMC模块管理员按既有机制可用；普通用户需要新资源显式read/字段/数据范围授权，原overview权限不串授。授权仍通过平台正式权限组管理，本任务不写权限数据。

每来源先tenant+新Dashboard数据范围；订单按主责事业部，品项/周计划/报工按各自承接事业部。独立read；export额外交export数据范围。CUSTOM仅接受稳定divisionId EQ/IN，OWN仍为created_by。字段依赖同时约束筛选、计数、百分比、候选和导出。Drawer再交原业务表read/字段/数据范围和本看板字段范围，不能凭伪造itemId/orderId越权。

顶部事业部/客户/订单和品号多选/日期条件贯穿订单、展开品项、Drawer及两类全量导出；不受展开状态或当前页限制。订单条件筛选影响订单集合但不重算正式整单值。首次/重置日期遵守平台“订单日期 + 按日 + 上海昨天”，可手工切换不限日期以查看全部在制订单。

10工序唯一来源@tracker/shared standardProcesses按order排序；服务端分页默认100，可选50/100/200/500/1000。展开按订单身份按需查询，子层独立分页。原始报工只在原资源权限受控的分页详情读取，不将所有事实发往浏览器计算。

图纸完成日期边界：当前正式技术报工schema无独立图纸完成日期字段；Demo显示正式状态和图纸交期，不使用updated_at冒充完成日期。Drawer为临时受权限交集约束的原表查看结果，沿用原Dashboard详情豁免，不新增独立导出；本页正式订单/品号矩阵均提供服务端导出。

ERP重复源行边界：同tenant/order/item存在多条活跃ERP源行且无逐行到monthly的稳定来源引用时，各源UUID均保留。已有月计划时标“来源行与月计划关联待核实”，不重复分配其需求、入库、报工或进度；未完成品项数包含这类待核实来源行，不能当作去重后的物料种数。

订单层异常列为“存在人工报工异常”的提示，仅检测同范围关联周计划的四类人工exception_text是否非空；完整来源标签/去重文本在品号层继续使用正式exceptionSummary，不在订单总表重复构造所有品号的长文本。

性能实现：现有config抽取生产进度、定性状态、材料到位、正式交付日及人工异常来源/标签共享SQL表达式，月周计划生成式保持原语义。新查询按weekly/process汇总，再按monthly聚合并一次性JSON透视后关联，避免对每列逐行扫描。原表达式与提取后表达式在真实月/周计划各100条、66/60个字段比对均零差异。

导出范围：顶部订单汇总与品项明细为全部顶部匹配范围，展开状态无关；子表本订单导出仅追加该订单精确过滤。未完成品项数包括独立来源/待核实行，不等于去重物料种数。
