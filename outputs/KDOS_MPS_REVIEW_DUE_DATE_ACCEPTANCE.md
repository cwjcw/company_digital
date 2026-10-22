# KDOS-MPS-REVIEW-DUE-001 第一期验收记录

状态：**WAITING_MANUAL_ACCEPTANCE**。实现、本地及正式生产验收已完成；版本和GitHub结果见部署记录，不自动判定整体PASS。

起始SHA：d80a768677c05b2e3b671362461c0718dbdaad74。

页面：`/master-plan-system/mps-review-due-dates`。导航：PMC中心→主计划系统→计划管理→评审交期表。字段、结构、接口和第二阶段边界见 [设计说明](KDOS_MPS_REVIEW_DUE_DATE_SPEC.md)。

## 实现范围

新增10字段只读表格、Drawer历史、服务端分页/搜索/统一高级筛选/稳定排序/完整Excel导出及独立read/export资源。字段顺序：订单号、批次号、试制计划图号、验货时间名称、入库时间、数量、交期变更次数、上次入库时间、最近变更时间、最近同步时间。入库时间为评审计划日期，不写入WMS事实。

唯一键：tenant+订单+批次+图号，原文本及后缀保留，不合并。数量为精确numeric/Decimal文本。首次0；每次真实日期变化+1，恢复旧日期亦+1；数量/验货名称变化不计次。当前记录、历史、审计与幂等收据同事务，锁及版本防并发；历史不可普通修改/删除，数据库延迟约束核对次数及最新日期。

迁移：`1722920102000-MpsReviewDueDates.ts`，仅新建`mps_review_due_dates`、`mps_review_due_date_changes`及自身约束、索引、函数、触发器和FORCE RLS。历史包含旧新日期、正负天数/方向、操作人、来源类型/批次，tenant+parent复合外键。无seed/旧表ALTER，无历史migration修改。

权限：默认不授予员工；沿用系统/主计划管理员机制，只开放read/export，管理员通用写入亦拒绝。history检查父记录租户、范围与字段权限；无法核验组织归属的CUSTOM整组拒绝，不虚构division。导出read∩export，字段及租户隔离。

## 本地验证

- API全量117套通过、4套跳过；1135项通过、33项跳过。
- Web全量59文件、439项通过；contracts31项通过；领域14项、主计划/页面聚焦42项及精确筛选聚焦17项通过。
- 独立PostgreSQL19组通过；API构建/lint、Web typecheck/lint通过，保留原ModulePortal快刷warning。
- 旧测试修复仅限HR显式teardown及监督页等待异步回显，未改其生产业务代码，未降低断言。最终全套无未处理异常。

|要求|验证方式与结果|
|---|---|
|1 页面可访问|页面单元及生产Chrome HTTP200通过|
|2 导航|正式注册、路由及Chrome导航通过|
|3 六字段完整|契约及页面测试通过|
|4 字段顺序|十列契约/页面/隔离Excel通过|
|5 初始为空|隔离迁移通过；生产主表/历史COUNT均0|
|6 搜索|页面请求及隔离SQL通过|
|7 分页|隔离SQL页码/稳定键通过|
|8 排序|页面请求、隔离SQL默认及请求排序通过|
|9 高级筛选|统一编译器、页面请求及隔离SQL通过|
|10 日期范围|隔离查询及Chrome实际日期范围筛选通过|
|11 数量精度|超大/多位小数领域、浏览器输入、SQL、Excel通过|
|12 完整Excel|隔离215行跨200行批次、十列、相同过滤范围/排序通过；生产Chrome下载空Excel十列/0业务行通过|
|13 无read 403|隔离及生产普通账号403通过|
|14 无export 403|隔离独立权限403通过；生产无授权导出403通过|
|15 tenant|隔离跨租户父ID/FK/显式tenant/非owner FORCE RLS通过|
|16 无组织CUSTOM|未知组织条件与有效条件混合仍整组拒绝，通过|
|17 唯一键|同tenant三文本键唯一，后缀/不同批次/图号不合并，通过|
|18 首次0|仅隔离数据库通过|
|19 同日期不计|仅隔离数据库通过|
|20 推迟+1|仅隔离数据库通过|
|21 提前+1|仅隔离数据库通过|
|22 恢复旧日期+1|仅隔离数据库通过|
|23 数量不计|仅隔离数据库通过|
|24 验货名称不计|仅隔离数据库通过|
|25 失败回滚|仅隔离数据库，含审计失败，当前/历史/收据全部回滚通过|
|26 并发不重复|仅隔离数据库，同批次并发幂等、旧version拒绝、等待锁时间正确，通过|
|27 历史完整|仅隔离数据库，计数/旧新链/最新排序/不可改删通过；Drawer空文案单元通过|
|28 原主计划回归|相关单元/全套及生产原集团计划页面通过|

第18至27项从未在生产执行；生产不插入演示记录，回滚测试亦不插入。

## 生产保护与发布

134630开发前两库/uploads备份完成并校验。发布前标准migrate.sh完成143301两库/uploads备份及格式/SHA校验，文件权限600；仅1条pending迁移MpsReviewDueDates1722920102000已成功前向执行。clean验证SHA c998c27f2282ab48f3bb2414cfed21eeed36b961，源码与本地30个实现/测试文件逐字节一致。

生产初始两新表不存在。14项旧业务表指纹/6flags保存；开发期间3条真实Web报工新增（3175→3178），原EVENT execution-rollup成功3次并更新对应工序派生内容（19392行未变），均发生于本任务上线前。完整开发时段的其他变化见下表；6flags不变。不停用正常业务，不宣称全开发时段数据库完全静止。

6flags：base-to-weekly=true、erp-orders=true、execution-rollup=true、inbound-allocation=true、plan-projections=false、shipping-to-base=true。无新任务、无同步入口、无Excel导入。n8n16定义/11active前后逐字段相同，包含nodes/connections/settings/versionId/activeVersionId。

迁移后的information_schema/pg_constraint/pg_indexes/pg_policies/pg_trigger已核验：当前17内部/业务列、历史11列，quantity无限精度numeric、UUIDv7默认、唯一/FK/方向/计数约束、自身索引/触发器及两表FORCE RLS齐全。正式记录数0、历史记录数0。生产不曾插入本任务演示/隔离测试数据。

发布备份窗口，成品入库90392→90405；13条新增均为T+来源、14:35:00，既有`kdos-erp-projection@finished-goods-inbound-v1.service`同刻journal记录完成1批/13条/0重试，与数据库一致。其余13项旧业务表短窗口指纹不变，6flags不变。本任务DDL/应用不写旧业务数据；不把这些正常外部运行冒称完全无变化。

标准验证版deploy all/check完成，Repository=Web=API=c998c27f2282ab48f3bb2414cfed21eeed36b961，STATUS=CONSISTENT。真实Chrome（实际Chrome channel）完成导航、十列/空状态/无写按钮、搜索/排序、日期范围筛选、服务端空Excel下载、原集团主计划页面；普通未授权用户meta/list/export/history均403。精确数量条件生产只读API200，非空精度/跨页/权限样本仅隔离PG执行。下载名`mps_review_due_dates_20261021.xlsx`，仅十列表头，无UUID或业务行。浏览器拦截所有非GET请求，业务写入0。未在空生产表伪造行来点击历史，Drawer交互/空文案由页面测试、历史查询由隔离PG验证。

内部证据保存在受限data/mps-review-due-20261021，不提交数据库、备份、真实业务行、凭据或浏览器会话。

## 文件清单

新增：

- packages/contracts/src/review-due-dates.ts、review-due-dates.spec.ts。
- apps/api/src/migrations/1722920102000-MpsReviewDueDates.ts。
- apps/api/src/modules/master-plan-system/review-due-date.domain.ts、domain.spec.ts、application.service.ts、query.service.ts、controller.ts（均以review-due-date为前缀）。
- apps/web/src/modules/master-plan-system/ReviewDueDates.tsx、ReviewDueDates.spec.tsx；shared/advanced-filter-exact.spec.tsx。
- scripts/test-review-due-dates-postgres.cjs。
- outputs/KDOS_MPS_REVIEW_DUE_DATE_SPEC.md、本验收记录。

修改：contracts/index；MPS config/module/query/filter-sources/types/spreadsheet/controller；表格registry/print/export文件名可选hook；App路由、KdosDataTable、table-export及exactNumeric输入；registry测试装配、HR/监督两处测试稳定性；TASK_REGISTRY、共享CODEX_PROGRESS。共34个本任务文件。其余4份前任务报告改动完整保留，不纳入本提交；共享进度只提交新任务段，不提交旧任务未提交补记。

后续每日同步、1139条导入、首次同步均未执行、未注册。第一期完成后停止，等待人工验收。正式SHA及远程结果见部署补记。

## 最终保护基线与部署记录

功能提交：`76acf4c635c91a14872f06614f0fe43d08f949bd`，34个任务文件。该版本标准all/check、真实Chrome全流程及生产结构/零记录复核均完成；源码/测试与clean验证版一致。局域网入口：http://192.168.1.249:15172/master-plan-system/mps-review-due-dates 。

整个开发到14:47最终快照期间，14项保护表中10项内容指纹完全相同，以下4项为已核实的既有业务运行，不能报告为“全部无变化”：

|表|开发前|最终快照|差异证据|
|---|---:|---:|---|
|mps_process_reports|3175|3178|14:01员工Web新增3条；审计来源Web|
|mps_weekly_process_plans|19392|19392|对应3次既有EVENT execution-rollup派生更新，非本任务写入|
|finished_goods_inbound|90373|90405|既有投影服务14:05处理19条、14:35处理13条，T+来源/时间/日志吻合|
|mps_erp_order_lines|2212|2212|14:44:01原erp-orders SCHEDULED SUCCESS，sync_count=72，表72条更新时间吻合|

其中迁移备份短窗口只包含入库13条变化，其余13表/6flags不变。ERP后续72条更新是既有定时功能保持运行，不是本任务手工触发/新同步。本任务没有调用同步命令，没有旧业务INSERT/UPDATE/DELETE或修改任何flags；迁移只新建两空表。新主表0、历史0，部署后仍为0。

6flags前后完全相同；n8n16条定义、11active及已发布版本完全相同。未重启/修改n8n，未新增/停用/迁移任务或Dispatcher，未执行1139条导入或第二阶段。保留受限证据/备份，临时测试环境在交付后清理。

GitHub同步采用github/main正常fast-forward push，不force；最终发布SHA以本报告末尾部署补记和实际deploy.sh check为准。报告的后续实际运行补记留在本机outputs，不将其混入其他任务文件。

## 最终部署补记（2026-10-21 14:52，Asia/Shanghai）

最终GitHub Commit SHA：`4bfced6c7ff51b67b30adc539d8c37d3aa4fde46`。功能提交76acf4c，后续4bfced6只补充本任务进度/验收证据。已正常push github/main，远程ls-remote确认一致。Repository=Web=API=该SHA，标准deploy all/check成功，STATUS=CONSISTENT；健康检查和实际Chrome最终全流程复验完成。Chrome验证下载mps_review_due_dates_20261021.xlsx（0业务行/10列），meta/list/export/history普通未授权403，原集团主计划可访问。

正式主表COUNT=0、历史COUNT=0，6flags最终复核完全不变；n8n16定义/11active及发布版本最终复核不变。本任务clean验证worktree及隔离PostgreSQL容器/socket已安全清理，备份及受限证据保留。其他4份前任务报告与旧进度未提交补记保留；本报告本机最终运行/SHA补记不改变已发布源码。

最终交付：**WAITING_MANUAL_ACCEPTANCE**。第一期开发、测试、备份、迁移、部署及GitHub同步已完成；未自动判整体PASS。第二阶段导入/首次同步/每日同步均未执行，停止于本阶段。

## 重复附件恢复复核（2026-10-21 19:08，Asia/Shanghai）

新附件097fa08f与原bf4d8c95附件SHA256均为8bf79e83bd5e30f5e3bbf72fc0f2a9eb83f1e008fb3aac529cc7aa7ef3a9ebbd，属于同一任务，无新增范围。继续既有实现，不重复开发、迁移或部署。

当前整体发布已包含后续财务客户功能，Repository=Web=API=GitHub main=`a86b321e7df27cb78f5a14b6c74e37ec3402c4cf`；标准deploy.sh check为CONSISTENT，远程ls-remote一致。PMC第一期功能提交仍为76acf4c，原发布记录4bfced6保留。

只读事务复核：正式主表0条、历史0条，PMC迁移已存在，两表FORCE RLS有效，6flags与第一期最终基线一致。实际Chrome复验页面200、导航/十列/空状态、搜索/排序、日期范围及精确数量API筛选、十列空Excel下载、原集团主计划页面；普通未授权用户meta/list/export/history全部403。浏览器禁止所有非GET业务请求，本次生产业务写入0。受限证据为data/mps-review-due-20261021/chrome-a86b321.json及readonly-recheck-20261021.json。

未执行1139条导入、首次/每日同步，未创建或修改任务、同步开关。本次只复验相关生产行为，不重复运行已完成的全套或隔离数据库测试。状态继续为**WAITING_MANUAL_ACCEPTANCE**，不进入第二阶段。
