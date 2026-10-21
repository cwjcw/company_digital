# KDOS-MPS-REVIEW-DUE-001 第一期验收记录

状态：**WAITING_MANUAL_ACCEPTANCE**。实现、本地及生产验证版验收已完成；正式Commit版本发布与GitHub同步结果在最终部署补记中记录，不自动判定整体PASS。

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

生产初始两新表不存在。14项旧业务表指纹/6flags保存；开发期间3条真实Web报工新增（3175→3178），原EVENT execution-rollup成功3次并更新对应工序派生内容（19392行未变），均发生于本任务上线前。其余12项旧业务表及6flags不变。不停用正常业务，不宣称全开发时段数据库完全静止。

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
