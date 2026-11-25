# 订单BOM明细：分配日等待与不可变初始状态（2026-11-25）

本合同替代旧明细展示/等待口径；三ERP匹配、有效条件、审核日期、多来源候选分析及另外两表布局保留。资源仍为rd-order-bom-report，仅read/export/print；无人工新增/编辑/导入/删除，内部追踪/历史为系统技术表，不适用业务删除标准。

## 数据关系与采集

追踪身份为(tenant_id,allocation_id)，复合外键关联mps_order_allocations(tenant_id,id)，不以订单/品号去重。Migration138建立状态、历史、租户采集边界；先锁分配表登记所有既有记录initial_capture_eligible=false，启用前新增仍属历史；ACTIVATE在同样锁下记录启用时间及历史数，此后INSERT才eligible=true。旧单修改/重新审核/改派永不改变资格，历史initial_bom_status永远NULL。

分配事件触发器只持久登记身份/首次分配日和pending，覆盖手工/API/Excel/同步，不计算BOM。新单有事业部时取创建瞬间上海日期；创建无事业部时取首次NULL→事业部实际发生日期，后续改派不改。历史用创建审计after_json.divisionId非空证明created_at，或首次审计NULL→有事业部时间；无可靠证据留空，不用updated_at/imported_at/order_date代替。日期证据保存在allocation_date_basis。

Application Command消费pending：复用MasterPlanSyncService现有60秒检查器（仅消费研发技术事件，不改计划规则或六项配置），现有E10增量/T+串行对账成功也触发处理；不新增调度器/工作流/消息。索引成功提交同事务将追踪标pending；失败保留pending和实际异常/尝试时间，下次重试。T+整批使用租户会话advisory gate，消费者用同key事务try-lock，双源中间不观察；开批先持久标两源RUNNING，进程中断后仍阻止负向确认；单事务一致读取三源active generation与状态，成功新快照后重算。任一SUCCESS且未过36小时来源的有效头即可确认Y；只有全部源SUCCESS且未过36小时、均无有效头才确认N。异常/未初始化/过期/RUNNING且无可靠有效头时保留可靠状态、锁值并登记原因。完整成功快照无头才可Y→N。

## 字段逐项设计（按展示顺序）

全部只读、不脱敏、不允许人工覆盖；隐藏不清空源数据，无条件必填/唯一输入校验/人工默认，无附件/子表/表单联动。每个字段独立read权限；筛选、排序、Excel及打印仍执行当前资源tenant/read∩export及原事业部/本人范围。重复值均允许，NULL与0区分。

|中文/英文key|所属表与关联/更新触发|类型/属性/默认/公式|权限/可见/提示/空值|
|---|---|---|---|
|承接事业部 divisionId|allocation.division_id→organization_units.id/name，实时查询|部门单选，只读，稳定UUID，无默认|read；空显示待匹配，无提示|
|订单号 orderNumber|allocation.order_number，实时|文本无格式，只读，原值|read；无提示|
|品号 itemCode|allocation.item_code→三源原码精确匹配，不trim/改大小写|文本无格式，只读，原值|read；无提示|
|品名 itemName|allocation.item_name，实时，不参与匹配|文本无格式，可空，只读|read；无提示|
|下单日期 orderDate|allocation.order_date，实时|日期YYYY-MM-DD，可空|read；不回推ERP历史|
|分配日期 allocationDate|state.allocation_date，首次实际事业部分配证据|日期YYYY-MM-DD，可空；永不随数量/交期/改派变化|read；缺可靠历史证据留空|
|客户交期 customerDueDate|allocation.expected_shipping_date，实时，保留原合同|日期YYYY-MM-DD，可空|read；不更改分配主表|
|下单时BOM状态 initialBomStatus|state.initial_bom_status，新单首次有效观察写一次|字典Y/N，可空；绿Y红N，历史空白|read；实际是首次分配报表同步观察，不回溯下单日；无编辑|
|BOM状态 bomStatus|state.current_bom_status，成功同步Application观察|字典Y/N，绿Y红N；无法核验保留旧可靠值|read；无其他字典值|
|BOM来源系统 bomSources|三源全部有效头来源集合，查询动态|文本E10/科加智能/凯南智能，注册顺序顿号连接，无有效头空|read；不自动仲裁来源|
|BOM审核日期 bomApprovalDate|唯一有效BOM原ERP审核时间|日期YYYY-MM-DD，多头/不可靠/1900哨兵为空|read；不用于等待计算|
|BOM等待天数 bomWaitingDays|state锁值或上海今日动态|数字0位；N=max(0,上海今日-分配日)，Y=locked_waiting_days；无可靠日/锁值空|read；支持数值筛选排序，0不等于空|

来源候选更新时间sourceModifiedTimes、同步状态sourceSyncStatus、来源说明bomSourceNote、当前等待天数currentWaitingDays从明细列/候选/筛选/排序/导出/打印目录移除；后台计算/源字段/冲突分析不删。两汇总保留sourceSyncStatus列。旧个人DISPLAY/PRINT配置按现行字段裁剪，非法过滤/排序字段返回400，不产生列或白屏。

## 状态机与历史

新单首次有效Y：initial=Y，锁0，记录真实检查完成时间/上海完成日期；首次N：initial=N，等待动态增长。初始采集异常保持空、pending起点与last_attempt/原因，恢复时记录真实检查时间和delay秒，不伪造分配时状态。initial一旦写入数据库守卫禁止覆盖。

N→Y锁上海确认日期-原始分配日，保存first_completed_at/date/days（只填一次）、latest_completed_at/date和locked_waiting_days及证据。持续Y不改任何完成时间/锁值；Y→N仅改当前状态，所有完成历史继续保留，页面用今日-原分配日；再次N→Y新增历史、更新latest/锁值，不覆盖first。历史表以状态version唯一且UUIDv7；全流程tenant事务advisory锁+行锁，重复/并发幂等。历史Y基线可保留旧唯一审核日期算出的可证明旧值并标LEGACY_ORDER_APPROVAL，不设上线日为完成日；无可靠值保留空。历史N以后转Y正常记录但initial永远空。

## 公共表格与统计

复用KdosDataTable、现有高级筛选/候选服务、字段排序/个人列宽/显示/PRINT偏好、服务端全匹配Excel。initial支持Y/N/is_empty；allocationDate日期筛选排序；日期和表头/数据全部居中。明细精确12业务列；保留系统列规范，无新管理页。来源异常保留原机制但无新增消息。

两汇总字段布局不变，去重仍按原订单/品号/事业部。平均仅当前Y且bomWaitingDays非NULL参与，禁止NULL→0，使用同一detail状态/锁值，不重复ERP计数。

## 验收与回滚

L3：隔离PG18覆盖迁移前有数据/NULL事业部/历史日期审计、边界及启用间隙、新单Y0/N→Y锁定/持续Y/Y→N/N→Y保留first、重复并发、多分配身份、租户RLS、故障/过期/批次锁、筛选排序/字段权限/Excel/PRINT目录。生产不造测试订单。仅白名单Migration138，备份后发布API/Web并ACTIVATE，记录边界/历史数、历史initial非空必须0，核验现有n8n；真实Chrome与构建/接口检查分别报告。回滚应用镜像、停本功能采集enabled，保留全部追踪/历史/源代次，down禁止删表；旧订单分配触发器仅技术登记不改主表值。
