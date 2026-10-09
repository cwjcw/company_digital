# PMC RD Progress Phase 5.4 Acceptance

Phase 5.4：FAIL（调查已完成；触发用户停止条件1，等待确认正式来源/稳定关联规则）。

调查日期：2026-10-08，Asia/Shanghai。代码基线HEAD为d210318；该提交为用户已有outputs更新，运行API/Web版本均为77e7a8cf40a60f2b743ae7947fdf11aaeb1018a5。
本轮只有只读调查及输出记录，没有修改产品源码、数据库、Skill、账号、凭据、权限，也没有执行FULL、INCREMENTAL、migration、提交或部署。

## 调查结论（编码前）

- A 当前实际来源：启用客户编码→主责事业部映射，未读取订单品项allocation。
- B 17,609未映射根因：117个研发客户中，只有A027、C235两个客户命中现有映射，其余115个客户没有启用映射；全部17,609条也没有完整订单号+品号匹配的allocation。
- C allocation覆盖：研发17,647条中0条；连完整订单号单独匹配也为0。1684条allocation来自现有T+/历史初始化链路，不包含E10行ID。
- D customer mapping覆盖：3个启用映射，A027命中35条、C235命中3条、C234命中0条。
- E 组合理论覆盖：38/17647=0.2153%；未映射仍17609，理论新增覆盖0条。
- F 多division allocation冲突0组；allocation与客户映射对研发记录同时命中且不同division的记录0条。零冲突不代表匹配成功。443组研发完整订单号+品号重复，涉及1057条行。
- G 订单品项allocation优先、无allocation才客户fallback、否则NULL的业务模型可以作为后续目标，但当前表无法可靠关联E10，不能实施为已验证规则。

## 1. 原事业部匹配逻辑

源码：`apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.application.service.ts`，`PmcRdProgressApplicationService.sync()` 第26、35–37行。FULL和INCREMENTAL共用下述逻辑：

```sql
SELECT map.customer_code AS "customerCode",
       map.primary_division_id AS "divisionId", org.name AS "divisionName"
FROM mps_customer_division_mappings map
LEFT JOIN organization_units org ON org.id=map.primary_division_id
WHERE map.tenant_id=$1 AND map.enabled=true;
```

内存`Map`以customerCode为键，使用研发Calculator返回的`String(row.customerCode ?? '')`查询。命中后写divisionId、divisionName、divisionSource=`CUSTOMER_OWNER`，未命中三者为NULL。没有allocation、Owner_Dept、weekly plan fallback。

E10源`data-operations/e10/pmc_rd_progress_reader.py`，`E10Repository.load_order_lines()` 第156–184行：SALES_ORDER_DOC.CUSTOMER_ID→CUSTOMER.CUSTOMER_BUSINESS_ID→CUSTOMER_CODE；SALES_ORDER_DOC_D.SALES_ORDER_DOC_D_ID保存为source_order_line_id。字段类型和值域没有customer UUID被当作code的证据；当前117个客户code和id均非空。

现有`division_source text`已经存在，未来无需为来源字段新增migration。

## 2. 未映射根因与分类

正式快照：2545个订单、17647个品项，已映射38，未映射17609。

|分类|当前未映射中的数量|
|---|---:|
|A 有完整键allocation且division非空|0|
|B 有完整键allocation但division为空|0|
|C 无allocation但启用客户主责事业部存在|0|
|D 无完整键allocation且无启用客户映射|17609|
|E 同一完整键多allocation不同division|0|
|F 客户ID/code为空导致无法查找|0|
|G 其他|0|

A/B/C/D/F为互斥分类，E作为额外冲突检查、G为剩余项；唯一索引及实际查询均证实E=0。若将“customer匹配失败”泛指code没有映射，则17609条全部符合，属于D的同一批记录，不应重复相加。D只说明当前核查两种来源没有可验证关联，不能断言这些品项在其他系统确实没有承接事业部。

## 3. 正式来源与组织字段角色

用户建议优先级：正式订单品项稳定division_id > 无正式品项分配时的唯一客户主责映射 > NULL。因停止条件1，本轮尚未实现或写入Skill作为已确认生产规则。

organization_units仅由稳定id解析name（及组织父子层级/path），没有决定订单品项归属的业务关系；不得按名称猜ID。它本身没有tenant_id列，保持现有组织模型，不修改边界。

E10 Owner_Dept：源SQL通过ADMIN_UNIT.ADMIN_UNIT_ID关联ADMIN_UNIT_NAME。本轮使用现有共享MSSQLDatabase配置和只读连接核验生产源，候选范围下存在26个组织，18170条订单行，包括营销中心、业务一部/二部/三部各课、物流、生管、采购、外协和IT，不能证明是PMC生产承接事业部。已有映射样本Owner_Dept为营销中心/业务组织，division为事业四部，属于不同组织口径；不采用Owner_Dept作为division。

注意18170是本轮独立实时E10候选读取，17647是当前正式投影快照；二者相差523，未执行正式FULL，也未推断差异的新增/删除组成。

mps_weekly_plans.division_id：`MasterPlanSyncService.baseToWeekly()` 第427–447行从`mps_base_plans.base.division_id`继承，base又从shipping/monthly投影；是下游计划链路。周计划对研发完整订单号+品号命中0，不作为反向覆盖来源。

## 4. mps_order_allocations 实际Schema、匹配与覆盖

实际位置：four_department_tracker.public。主要字段：id、tenant_id、order_number、item_code、customer_code、division_id、updated_at、version、数量/日期等。**不存在source_order_line_id、E10 SALES_ORDER_DOC_D_ID、source_order_id、lineNo/source_key等源行定位字段。**完整字段和索引保存在调查JSON。

唯一键`uq_mps_order_allocation(tenant_id,order_number,item_code)`；租户KAINAN有1684条，1486条事业四部、198条division=NULL。128个完整订单号与研发订单号交集为0。

正式投影代码：`apps/api/src/modules/master-plan-system/master-plan.sync.service.ts`，`projectPlans()` 第280–293行按tenant/order_number/item_code聚合mps_erp_order_lines，division源为启用客户映射；未新增默认事业部。

mps_erp_order_lines来源：T+ / UFTData418971_000003 708条；KDOS_INIT / FOURTH_DIVISION_20260917 1169条。已有source aliases 1148条全部是T+，没有E10关联。

研发重复示例：订单2304-202609080001、品号301040003有11行（13,14,15,16,17,22,23,24,25,26,29）。不能用订单号+品号替代这些E10行ID，也不能未经正式关系证明截掉2301/2303等前缀。

## 5. 客户事业部映射

物理表`public.mps_customer_division_mappings`；匹配键tenant_id+customer_code；来源字段primary_division_id；必须enabled=true。唯一索引`uq_mps_customer_division(tenant_id,customer_code)`。

3条映射均启用且都指向稳定UUID d23442f9-4862-4641-b4a7-c8d470bc56ea（事业四部），其中两客户覆盖38条研发品项。无新增客户映射、无权限或租户修改。

## 6. 修复前后

本轮未修复、未写入，前后正式快照均总17647/已映射38/未映射17609；事业一/二/三部各0，事业四部38。当前数据可验证理论新增覆盖0，改善比例0%。不能报告修复后PASS。

研发状态基线：COMPLETE 11082，NOT_APPLICABLE 835，NOT_STARTED 2998，WAITING_ROUTING 2722，ROUTING_IN_PROGRESS 4，ABNORMAL 6。完整设计/路线/reason组合已保存在JSON。没有更改算法；未FULL，尚无同步前后回归结论。

## 7. 样本追踪与同订单多事业部

|当前|订单号|行|品号|客户|allocation|客户映射/组织名|应保持|
|---|---|---:|---|---|---|---|---|
|已映射|2301-2023A027018|1|MJCOP014125|A027|不存在完整键匹配|事业四部|事业四部（现有客户fallback）|
|已映射|2301-2023A027018|2|MJCOP014175|A027|不存在完整键匹配|事业四部|事业四部（现有客户fallback）|
|已映射|2301-2026C235007|1|99997248-1/1|C235|不存在完整键匹配|事业四部|事业四部（现有客户fallback）|
|未映射|2301-2026A001008|1|A3-1/1|A001|不存在完整键匹配|不存在|NULL，不能猜测|
|未映射|2301-2024A002221|1|WCJ456-1/1|A002|不存在完整键匹配|不存在|NULL，不能猜测|
|未映射|2301-2025A003191|1|WGH242-1/1|A003|不存在完整键匹配|不存在|NULL，不能猜测|
|未映射|2301-2025A003369|1|WEJ283-1/1|A003-YMJ|不存在完整键匹配|不存在|NULL，不能猜测|
|未映射|2301-2026A004018|1|A1380CH-1/1|A004|不存在完整键匹配|不存在|NULL，不能猜测|

完整8条样本的E10订单ID、行ID、customer ID、客户映射ID、稳定division ID、原部门ID/名称均在调查JSON。上述已映射记录依客户fallback，未映射记录在核查来源内缺少可验证关系。

主动查找allocation同订单不同division样本：0个订单；非空allocation全部事业四部。当前研发快照亦仅事业四部/NULL。因此无法提供要求的生产真实跨事业部样本，不创建假样本、不改生产分配来满足测试。

## 8. FULL / INCREMENTAL与本地更新机制

现有INCREMENTAL在Application.sync第26行读取本地客户映射updated_at，使用上一轮E10 snapshotAt转+08:00并重叠2分钟，传customerCodes给reader；reader第463行把这些客户的候选行纳入重算。因此已考虑本地客户映射改变，不必等待E10客户写入。

现有同步未读取allocation、未监测其变化。MPS Application的reconciliation映射将customer-divisions/order-allocations写入plan-projections outbox，后续由既有主计划投影消费；不直接更新研发进度。未来需在正式来源确认后选择现有写后触发或本地reconciliation，保证allocation改动和删除、客户fallback更新且不覆盖更细粒度正式分配。

本轮触发停止条件，没有执行FULL/INCREMENTAL，也没有引入新基础设施。

## 9. 权限和dataScope

未修改权限、租户、RLS、scope、字段可见性或导出实现，未读取E2E凭据。本轮没有实施修复后的事业一/四部scope验收，不能沿用Phase5.3结果声称Phase5.4权限测试通过。

## 10. 页面和Excel

Phase5.3结构保留。当前有效division只有事业四部，其他事业部真实数据和跨事业部样本缺失；本轮未运行Chrome/Excel事业一/四部/未映射新验收，未宣称通过。

## 11. 自动测试

本轮为停止条件下的只读调查，无产品代码变更，未新增或执行产品自动测试；未复制、记录或提交凭据。完成实际PostgreSQL只读schema/覆盖/重复/样本统计，以及E10只读Owner_Dept组织统计，结果保存在调查JSON。

## 12. 构建部署与健康

未build/typecheck/lint、未备份/迁移/部署：没有产品更改，且用户停止条件要求先确认关联规则，不能无意义重建正式服务。

`scripts/healthcheck.sh`通过：Web/API/Swagger/OpenAPI/PostgreSQL健康；API和Web版本77e7a8cf40a60f2b743ae7947fdf11aaeb1018a5；PostgreSQL原127.0.0.1:15433端口及容器保留，未执行任何volume或容器删除操作。

修改/新增文件仅：
- outputs/CODEX_PROGRESS.md
- outputs/PMC_RD_PROGRESS_PHASE5_4_ACCEPTANCE.md
- outputs/PMC_RD_PROGRESS_PHASE5_4_INVESTIGATION.json

数据库migration、npm依赖、新API、产品源码、Skill改动均无。

## 13. 已知限制与恢复条件

触发用户明确规定的“mps_order_allocations无法可靠匹配研发订单行”。需要确认E10订单品项的实际正式承接事业部维护表/页面，或者提供已有E10↔T+稳定订单行关联规则；同时需真实跨事业部订单样本。现有T+初始化映射不能凭前缀/客户名推断扩大到所有E10订单。

确认后从进度文件继续最小resolver与本地变更机制，补测试，备份部署，正式FULL及INCREMENTAL，再完成全部25项验收；本轮调查结果保留，不重复从头分析。
