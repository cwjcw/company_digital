# 主计划业务缺口审计（REV2）

基线：707bc5af0deef523cb3b6c2c79806e017feb774b；2026-10-15。状态：审计与9类实现/自动验证完成，部署门禁核验后等待人工验收；不判PASS。

| 缺口 | 应有数据集合 | 已完成判定 | 未完成判定 | 当前是否已有清单 | 当前页面/资源 | 是否需要新增 |
|---|---|---|---|---|---|---|
| 未进入出货计划 | 当前授权月计划且required_quantity>0（已分配的正式产品需求） | 同tenant shipping.monthly_plan_id=monthly.id至少存在一行 | NOT EXISTS正式monthly_plan_id关联 | 无专用稳定父ID差集 | 月计划/出货计划 | 新增只读分页差集；仅判尚未建立，不判数量覆盖/全部批次排完 |
| 未进入基础计划 | 当前授权出货计划记录；shippingToBase无额外准入条件 | 同tenant base.shipping_plan_id=shipping.id | NOT EXISTS稳定父ID关系 | 无专用差集 | 出货计划/基础计划 | 新增只读分页差集及独立导出 |
| 未进入周计划（已具备条件） | 正式base weeklyPlanState=已具备条件 | 同tenant weekly.base_plan_id=base.id | 复用weeklyPlanState=已具备条件（已含未存在weekly） | 有正式状态筛选 | 基础计划 | 复用正式virtualColumns，新增Dashboard清单视图 |
| 计划待完善 | 正式base weeklyPlanState=待完善 | 已有weekly或满足正式weeklyAdmission定义 | 复用weeklyPlanState、weeklyPlanMissingFields、weeklyPlanGenerationIssue | 有正式状态/缺少项/提示 | 基础计划 | 独立待处理分类及独立计划待完善报表，非生产异常 |
| 未生成3天工单 | BLOCKED：无“进入当前3天窗口”的正式应有集合 | 工单tenant+weekly_plan_id稳定 | 不得将所有无工单weekly当异常 | 可查看既有工单，但不是应生成缺口 | mps-three-day-work-orders | 本轮不展示。weeklyWorkOrderSource取全部授权周计划，日期人工维护，不能制造窗口规则 |
| 未开始报工 | 当前授权正式weekly，planned_quantity>0 | 同tenant/weekly_plan_id的10标准工序实际production_quantity总和>0 | 累计实际报工=0（无记录也为0）；不以状态或准备任务提示推断 | 只有报工明细，缺少按周计划零报工清单 | 周计划/工序报工 | 新增只读周计划粒度清单；创建报工入口不要求3天工单，不引入该条件 |
| 未入库 | 当前授权monthly，required_quantity>0 | cumulative_inbound_quantity>0 | 正式累计入库=0 | 正式月计划有字段，可按字段筛选 | 月计划 | 复用正式事实，新增Dashboard缺口视图 |
| 未完成入库 | 当前授权monthly | pending_quantity=0 | cumulative_inbound_quantity>0 AND pending_quantity>0 | 同上 | 月计划 | 与完全未入库分开，不重算pending公式 |
| 延期未完成 | 当前授权monthly | 正式交付日期未过或pending=0 | pending_quantity>0 AND 正式latestCustomerDueDate<上海今天 | REV1风险表已有 | 月计划/风险明细 | 复用已锁定风险规则，补独立缺口视图 |
| 生产异常 | 当前授权monthly关联的真实人工报工 | 四类人工exception_text均为空 | 正式exceptionSummary非空 | REV1风险表已有 | 技术/主材/外协/工序报工；月计划 | 复用正式异常聚合，绝不混入计划缺失/同步/data_exceptions |

## 稳定身份与证据

- `1722920093000-AllocationAppendBatches`：allocation独立UUID及import_batch_id/source_row_number；monthly.allocation_id为正式来源关系。相同order/item可以多次上传，不能据两字段判定每条allocation的出货排程。
- 初步只查初始schema不足：进一步核查`1722920049000-MasterPlanShippingMonthlyReference`确认shipping.monthly_plan_id→monthly.id的tenant复合外键；Application.create/normalize导入会绑定此正式父ID。因此ExpectedShippingSet取正需求月计划，ActualShippingSet取shipping正式monthly_plan_id，按父UUID求完全未建立的差集。仍不推断每条allocation的数量覆盖或期次排完；不能按order/item代替此关联。
- `MasterPlanSyncService.shippingToBase`：源为mps_shipping_plans全部tenant记录；base.shipping_plan_id正式且唯一。更新冲突业务键含delivery_number，用父UUID判断是否存在，不能只按order/item掩盖不同交期批次。
- `MasterPlanSyncService.baseToWeekly`与`virtualColumns(mps-base-plans)`：共用weeklyAdmissionSql/MissingSql；是否已下达以base_plan_id判定。已具备条件与待完善严格分开。
- `MasterPlanQueryService.weeklyWorkOrderSource`及WorkOrderService：人工“从周计划同步”全量来源；工单生产日期人工维护。未发现当前3天窗口的权威应生成条件，因此BLOCKED。
- `normalizeExecutionInput`：正式工序报工关联weekly_plan_id并校验shouldEnableProcess，不要求3天工单。周计划数量为正且标准工序实际累计0才计未开始报工；不使用状态/占位计划任务代替事实。
- 月计划required/cumulative/pending复用当前存储正式字段（入库分配事实按正式流程维护）；REV2只读，不重算、不启动inbound-allocation/execution-rollup。
- 月计划报表粒度为tenant+monthly.id（当前月计划正式order/item聚合），出货/base/weekly缺口以各自UUID计数并保留deliveryNumber；相同order/item多批次不得折叠。

## 查询/权限/日期约束

复用REV1 Dashboard Scope：每个来源tenant与dashboard read scope先授权；export再交export scope；顶部事业部、客户、订单/品号多选、订单日期/交付日期进入同一个scope。新增shipping来源须纳入同一身份集合，保证尚无base/monthly的出货记录不被遗漏。交付日期沿用REV1优先链，shipping-only身份才回退shipping正式交期，不改expectedShippingDate语义。明细count与行查询来自同一缺口关系。未知/BLOCKED type拒绝；无read不返回任何指标，无export403；无字段权限不泄露候选、计数或局部筛选。

本轮可靠分类9类：未进出货、未进基础、未进周（已具备）、计划待完善、未开始报工、未入库、部分入库未完成、延期未完成、人工生产异常。3天窗口BLOCKED不展示，不生成虚假零数。只新增查询/报表视图，无业务事实表、Migration、历史数据修改或sync flag变更。
