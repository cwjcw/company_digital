# KDOS-MPS-REVIEW-DUE-001 评审交期表第一期

任务边界：结构、只读页面、查询/权限/导出、内部变更命令及隔离测试。本期不导入用户1139条Excel、不首次/每日同步、不创建n8n、不修改ERP/原业务或6项同步flags。正式主表与历史表均保持0条。交付状态为WAITING_MANUAL_ACCEPTANCE，由用户人工验收，不能以自动测试替代。

## 字段和身份

页面/master-plan-system/mps-review-due-dates；PMC中心→主计划系统→计划管理→评审交期表。

|顺序|字段|业务显示|类型|
|---|---|---|---|
|1|orderNumber|订单号|text|
|2|batchNumber|批次号|text|
|3|drawingNumber|试制计划图号|text|
|4|inspectionTimeName|验货时间名称|text|
|5|inboundDate|入库时间|date|
|6|quantity|数量|numeric|
|7|changeCount|交期变更次数|integer|
|8|previousInboundDate|上次入库时间|date nullable|
|9|lastChangedAt|最近变更时间|timestamptz nullable|
|10|lastSyncedAt|最近同步时间|timestamptz nullable|

入库时间是评审计划日期，与实际WMS/成品入库事实无关联写入。内部id/tenantId/version及created/updated审计字段不作为用户主表列或Excel列。日期以YYYY-MM-DD业务日读出，时间显示Asia/Shanghai。数量为不限scale的精确numeric，内部命令接收有限十进制文本，使用Decimal规范化，列表/Excel保持文本精度，不使用Number计算数量；不凭空设定正数限制。正式输入必须含有效日期和数量，缺失值拒绝，不自动补0/日期；第二阶段接入时再核验源空值策略。

唯一业务键为tenant_id+order_number+batch_number+drawing_number；文本原样保存（包括-1/2、-2/2、-1/3等后缀），不按订单号合并，不转换业务键为数字。改键是新身份，不自动迁移旧历史。未来来源适配器必须先调用全源重复业务键校验，重复即拒绝，不能合并数量/覆盖日期。

## 新增数据库迁移

1722920102000-MpsReviewDueDates.ts，仅新增mps_review_due_dates、mps_review_due_date_changes及其约束/索引/函数/触发器。无seed、旧表ALTER、数据库实例或任务注册。

主表UUID默认uuidv7()，tenant非空，复合业务唯一键及(tenant,id)唯一约束，version>0，change_count>=0，quantity排除NaN/Infinity。默认排序索引tenant/inbound_date/order_number/batch_number/drawing_number/id，另有tenant/drawing_number索引。

历史表：id UUIDv7、tenant_id、review_due_date_id、old_inbound_date、new_inbound_date、change_days、change_direction(EARLIER/LATER)、changed_at、changed_by、source_kind(SYNC/IMPORT/MANUAL)、source_batch_id。tenant+parent复合外键杜绝跨租户引用；来源批次在同记录/来源类型下唯一；旧新日期必须不同，change_days等于新日期减旧日期，方向与符号一致。tenant/parent/changed_at DESC/id DESC索引支持历史读取。UPDATE/DELETE触发器拒绝改删历史；主表更新守卫禁止业务键改名、无历史统计的直接改期和无改期的统计篡改；延迟约束在提交时验证次数等于历史数、当前/上次日期等于最新历史。

两表ENABLE+FORCE RLS，USING和WITH CHECK均使用app.tenant_id。Application/Query事务设置租户并显式加tenant条件。down拒绝删除业务历史，应用回退保留新表/事件，不恢复整库覆盖后续业务。

## 内部领域与事务命令

ReviewDueDateApplicationService.observe仅为未来受控适配器复用，未提供任何HTTP写入/导入/同步入口。仅受控主计划/系统管理员Actor及同租户操作人可调用。普通和管理员通用新增/修改/删除/导入/批量修改均拒绝此资源；本期只读。

同业务键事务advisory lock+SELECT FOR UPDATE；可选expectedVersion冲突409。首次建立changeCount=0、无历史；同日期不增加次数。日期不同，先写历史，再在同一事务更新日期、次数+1、上次日期和最近变更时间；恢复历史日期仍是新事件。数量和验货名称变化只更新当前值与审计，不计交期事件。SYNC观察更新最近同步时间，其他来源不伪装同步时间。

复用已有idempotency_keys，不新建第三套收据表。服务端key由资源/租户/业务键SHA/来源类型/批次组成，规范化载荷SHA防止同批次不同值。相同批次重放返回原结果且不修改较新当前值，初次、同日期、数量/名称变化均写收据，避免以后重复补跑产生倒退。锁定后取clock_timestamp实际观察时间，避免先启动后等待的旧事务把最近变更时间倒退。主表、历史、收据及审计同事务；审计失败也全部回滚。审计source按既有system→api转换，不引入新枚举。

## 查询/权限/Excel

独立资源mps-review-due-dates已登记contracts、masterPlanResourceDefinitions及统一筛选源；归属planning。沿用当前租户系统/模块管理员权限，不创建默认员工授权。无表read为403，无export为403；无数据scope默认拒绝。未验证组织归属不伪造division_id：CUSTOM含未知字段或组织规则时整组备选范围拒绝，不能删除未知条件后按剩余条件放行。有效CUSTOM仅使用已注册字段；数量条件按numeric比较。history同时检查表read、交期/变更字段读取、父记录tenant和read范围，猜测外租户ID不暴露事件。

复用SqlFilterCompiler、KdosDataTable、TablePrintService。搜索只用4个业务文本字段，且限可读字段；高级筛选/日期范围/数值条件统一参数化。默认入库时间升序，附订单/批次/图号/id稳定排序；请求排序也保留稳定键。数量字段显式exactNumeric metadata，单值及区间筛选均使用stringMode，防止浏览器先转浮点再提交；不改变其他字段的既有输入行为。服务端分页和候选范围均使用同一资源授权。历史Drawer最新在前，无历史显示“暂无变更记录”，0次数显示0，操作人显示名称而非内部UUID。

Excel仅10个业务/统计字段，完整匹配结果分200行取数。专用资源/export在单个repeatable-read事务保持全部分页快照一致；统一/table-exports入口按相同权限/字段/稳定键分批读取，每批只读事务。作用域read∩export、字段read、相同筛选/排序/tenant。超过统一导出安全上限会报错，不静默截断。文件名mps_review_due_dates_YYYYMMDD.xlsx，上海业务日期；前后端共享命名函数。通用导出仅增加可选文件名hook，其余表保留原名。

正式读取路由复用/master-plan-system/resources/mps-review-due-dates[/meta|/export]及/table-filters/rows、/table-exports/mps-review-due-dates；历史GET /master-plan-system/review-due-dates/:id/history。所有控制器只调用Query/Application，不访问数据库。历史需要交期/变更统计相关字段可读。历史入口不开放写入。

## 测试与发布

领域/契约/页面单元、真实隔离PostgreSQL约束及19组事务/精度/并发/权限/导出验收、现有主计划及全套回归。非空示例和18至27项业务测试仅在带路径保护的/tmp/kdos-review-due-pg-*隔离数据库执行；生产绝不插入示例，即使回滚测试也不插入新表记录。

开发前已备份两库/uploads。发布前再备份、确认只有本迁移pending、前向迁移、标准deploy all/check及健康检查；Repository/Web/API一致，GitHub安全同步。生产Chrome验证空表/导航/字段/筛选/下载，无权限API403；两表COUNT(*)=0。保留既有业务使用和任务运行，不停用或修改6flags。

开发期间生产有真实员工新增报工及原EVENT execution-rollup运行，旧报工/工序表发生正常外部变化，须在验收报告如实列出，不能把全开发时段当成业务静止快照。发布短窗口另存前后指纹，区分本任务DDL与既有业务运行。

## 第二阶段待办（本期禁止执行）

另行核实真实源位置/工作表/空值策略，源业务键冲突预检，来源批次与操作身份、增量/全量及缺失语义、数据质量和补偿策略，经用户授权后才做1139条首次导入或每日同步。未来调度必须另走任务治理盘点及注册；本期不留任何已启用调度入口。
