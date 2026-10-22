# Excel导入增量规则（KDOS-MPS-REVIEW-DUE-IMPORT-001，2026-10-22）

本节更新此前阶段“不开导入”的限制；开发阶段仅本地实现及隔离验证；用户后续已授权同步GitHub，生产部署仍须另行确认。通用资源create:false及通用新增/PATCH/批量/删除保护继续保留。独立导入通过现有resources/:resource/import-template、import-preview?view=STANDARD|SOURCE、import-confirm进入专用ReviewDueDateImportApplicationService；不调用通用importUpdates绕过历史。

模板文件mps_review_due_dates_import_template.xlsx，名称评审交期表，主Sheet mps-review-due-dates，八列严格为记录ID、版本、订单号、批次号、试制计划图号、验货时间名称、入库时间、数量。Registry生成六业务字段及必填说明，数量列文本格式保精度、日期yyyy-mm-dd、填写说明和校验隐藏映射；没有真实业务记录。标准模式保留八列表头，验货名称允许空值，不能因删掉可选列而隐式清空旧值。受限用户下载的结构参考仅包含获权字段并明确不可直接导入。模板按资源read/create/import与字段授权提供，下载本身不授予写入；不以已有数据或编辑模式为条件。

STANDARD：两个技术值都空才新增；都有有效原ID及正整数版本才更新，单填一个非法；整批可混合，不能按业务键猜测更新。新建需import+create+必要字段填写授权，更新需import及实际修改字段update，不另要求资源update。所有上传字段需字段read或update授权，数据范围为import动作，新增还检查create动作；现有行及修改后候选均验证。无表read的合法导入用户仅获得操作/模板元数据；既有日期、数量、计数及人工改后身份不借预览泄露，受限记录的日期方向/数量比较汇总也隐藏；确认结果及重放按当前授权裁剪。

SOURCE：只接受显式选择的原始六列表格；按tenant+不可变source_order_number/source_batch_number/source_drawing_number匹配，绝不按Excel行号或当前可编辑三键。已有匹配保留当前三业务键，仅观测其他来源字段并记录版本。未知来源只有显式SOURCE且create授权才建立。人工新增或STANDARD新建没有据此完成外部来源核实，SOURCE/未来observe命中这类记录均拒绝并要求人工核实；不合并、不覆盖、不删旧行，也不在本轮提供来源身份确认命令。

Preview只读取业务表并写既有mps_import_previews；保存租户、真实用户、明确模式、文件SHA256、解析行、已解析ID/版本及初始来源身份，30分钟有效。响应有总数、新增/更新、提前/推迟、数量变化、未变化、冲突/错误及逐行前后值（按read权限裁剪）。重复文件业务键/同ID多行、错误与冲突均不发确认token；标准新文件遇已存在业务/来源键要求提供原ID版本或人工核实。加密文件先统一检测并原样提示；公式仅接受有效缓存结果，缺缓存/错误值拒绝；数值数量精度不可靠时要求文本。

Confirm锁定当前用户/租户/资源的预览，复查有效用户、操作/字段/范围/唯一性和版本；同租户导入事务锁及稳定ID排序行锁配合原人工编辑行锁。当前行、IMPORT日期历史、逐行与批次操作审计、幂等收据、preview确认结果同事务。真实日期变化才count+1、记录前次日期/变更时刻/方向天数/操作者/预览UUID批次；首次建立count0无历史，数量/名称变化不计次，完全未变化不更新行/version。DATE按PG日期文本参与范围与审计，避免本地午夜序列化为UTC前一天。

幂等：同一预览反复或并发确认返回同一收据，仅首个事务写入。重复上传相同新增文件会因既有唯一键在预览拒绝，不能新增重复行；SOURCE重传已相同内容为未变化，不增次。不同批次同一天发生真实改期/恢复旧值，应基于新版本再计次，不用永久文件hash去吞掉真实事件。确认重放仍校验权限、用户和当前范围，不泄露旧结果。

不新增数据库migration，复用既有预览台账、UUIDv7、来源触发器、历史不可改删及count一致性/RLS。业务导出保持原十列，不能把业务导出误当八列写入模板；标准更新需由获权系统记录提供原ID/version，本轮不扩展导出身份清单。页面新增/编辑/历史/导出保留；全局仅更新Skill独立KN-FORM-TEMPLATE-001及输出其他资源缺口，不批量改造。

目标页面/master-plan-system/mps-review-due-dates。本轮生产不导入1139条、不确认Excel、不改业务记录/6flags/授权组、不开外部API同步或n8n任务。验收及下一步发布方案见KDOS_MPS_REVIEW_DUE_IMPORT_ACCEPTANCE.md；总体WAITING_MANUAL_ACCEPTANCE。

---

# 手工新增增量规则（KDOS-MPS-REVIEW-DUE-CREATE-001，2026-10-22）

本节更新下文“不开放普通新增”的阶段限制：新增采用专用命令，通用资源配置仍为create:false，通用POST、PATCH、导入、批量修改及删除继续关闭。页面只在原工具栏加入“新增”，空表也可打开。表单复用六字段定义，顺序为订单号、批次号、试制计划图号、验货时间名称、入库时间、数量；验货名称可空，其余必填。数量始终为十进制文本，经Decimal校验后写入numeric。

POST `/api/v1/master-plan-system/review-due-dates/manual-create` 接受六业务字段及技术commandId，不接受version、来源、审计或统计字段。调用者必须有资源create权限、所有必填字段的填写权限和已提交可选字段权限；填写权限沿用平台字段read或update授权，不要求现有记录update权限。create数据范围针对拟新增的真实字段及服务端created_by计算，未授权范围拒绝。metadata单独返回actions.create/createFields；仅新增用户可以取得创建元数据，但不能因此读取列表、历史或导出。生产权限组不自动调整。

事务内校验当前租户有效登录用户，服务器生成UUIDv7及审计；计数0、previousInboundDate/lastChangedAt/lastSyncedAt为空，不写交期历史。现有INSERT触发器保存不可变初始三键，两套租户唯一约束保留；当前业务键或已保留来源身份冲突409，不覆盖、不合并。正式操作审计为review_due_date.manually_created。租户+真实用户+commandId的事务锁/持久收据保障重试幂等，不同内容复用请求标识409；审计或收据失败整笔回滚。

人工新增不等同来源同步：lastSyncedAt保持NULL，创建审计明确MANUAL来源。未来observe若匹配到人工新增记录，必须409进入来源身份人工核实，不得自动覆盖或标记已同步；本轮没有开放身份确认、来源导入或每日同步。初始三键与当前可编辑三键独立，人工编辑后原来源身份仍可追踪。未来来源身份确认须另行设计受控Application Command与审计，不删除创建审计来绕过核实。

本轮复用已上线103号迁移结构，无需新增迁移、不修改历史迁移。生产主表/历史仍保持0/0；所有写入验收仅在隔离PostgreSQL及其HTTP/Chrome连接执行。线上只做真实权限读取、填表取消、筛选及空表导出。验收报告见KDOS_MPS_REVIEW_DUE_CREATE_ACCEPTANCE.md；最终WAITING_MANUAL_ACCEPTANCE，不进入1139条导入或每日同步。

---

# 人工编辑增量规则（KDOS-MPS-REVIEW-DUE-EDIT-001，2026-10-21）

本节为当前规则，替代下文第一期“六字段全部只读/业务键不可改名”的限制；第一期原文作为历史设计保留。当前6业务字段orderNumber、batchNumber、drawingNumber、inspectionTimeName、inboundDate、quantity均可在资源update、字段read/update和read∩update数据范围授权下人工编辑；4统计字段及内部ID/审计仍只读。不开普通新增/删除/导入/批量同步。

人工编辑专用PATCH `/master-plan-system/review-due-dates/:id/manual-edit`，按不可变ID、expectedVersion、事务行锁及commandId幂等定位；组合修改同事务写当前行/日期事件/审计/收据。日期变化写MANUAL事件并加1，日期相同和其他字段不计次。当前业务键仍租户内唯一，冲突409且不合并。前后数据范围均校验，权限403、版本409，网页失败保持原值/明确错误/刷新重试；保存后刷新行与历史，不采纳旧请求覆盖新结果。数量为精确十进制文本/Decimal/numeric。

新增前向迁移1722920104000：source_order_number/source_batch_number/source_drawing_number永久保存初始来源键，由INSERT触发器初始化且不可变，另有tenant+来源三键唯一约束。当前三业务字段可变，ID/历史FK/初始来源不变；旧RLS/历史不可改删/计数一致性守卫保留。该来源身份不进入页面字段、权限字段、筛选或Excel，不虚构division。

未来日常来源观测只按初始来源键找原ID，不以人工改后的当前三键判定旧来源消失，也不自动恢复当前业务键。无法证明的新来源键默认409人工核实；不得自动合并或创建重复记录。内部allowInitialCreate仅供经明确授权的首次建立，未来日常同步不得启用；本轮无导入/同步HTTP、调度或适配器。真正来源键变化须后续另行受控身份映射及审计，不采用猜测匹配。

新迁移不执行破坏身份的down；采用前向修复。当前生产两正式表始终0/0，不导入1139条、不改生产授权组、不动旧业务/6flags/现有调度。完整实现、验证和发布证据见KDOS_MPS_REVIEW_DUE_EDIT_ACCEPTANCE.md，交付状态WAITING_MANUAL_ACCEPTANCE。

---

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
