# KDOS-MPS-REVIEW-DUE-EDIT-001 人工编辑验收

状态：**WAITING_MANUAL_ACCEPTANCE**。开发、测试、备份、前向迁移、部署、线上Chrome及GitHub同步已完成；等待用户人工验收，不自动判整体PASS。

起始SHA：`a86b321e7df27cb78f5a14b6c74e37ec3402c4cf`。
最终GitHub Commit SHA：`1b728c452e157e7048ef9c134bd3e6cf6fafe5b7`，github/main正常fast-forward推送，远程ls-remote确认一致。

## 本次范围

页面：`/master-plan-system/mps-review-due-dates`，导航仍为PMC中心→主计划系统→计划管理→评审交期表。复用KdosDataTable的进入/退出编辑模式；精确数量使用十进制文本，不经过JS Number。没有新增、删除、导入、批量编辑或同步入口。

|可编辑业务字段|中文|
|---|---|
|orderNumber|订单号|
|batchNumber|批次号|
|drawingNumber|试制计划图号|
|inspectionTimeName|验货时间名称|
|inboundDate|入库时间|
|quantity|数量|

changeCount、previousInboundDate、lastChangedAt、lastSyncedAt及内部ID/审计字段只读。权限管理沿用正式字段注册，对前6项可单独勾选可见/可编辑，后4项编辑框禁用；不修改生产权限组或授权成员。

## API与事务

专用`PATCH /api/v1/master-plan-system/review-due-dates/:id/manual-edit`，只接受六业务字段的非空子集、整数expectedVersion和UUID commandId。内部record ID定位，要求实时认证主体、有效租户成员、资源read/update、提交字段read/update以及修改前后read∩update范围。系统管理员/模块管理员沿用已有最高权限机制；不冒用管理员，不相信body身份。未知CUSTOM组织规则整组拒绝。

事务锁记录后校验版本；当前行、MANUAL交期事件、操作审计和请求收据同事务。日期改变才写1条事件并累加1次；恢复旧日期仍是一次。日期不变、修改其他5字段均不计次。真实操作人进入历史和审计。lastSyncedAt不因人工编辑变化。组合提交业务键、数量、日期时原子执行；冲突409，权限403，字段/身份输入400。唯一冲突拒绝，不合并记录。

commandId绑定租户、真实用户、record ID和请求内容；重复请求返回收据，不重复事件；不同内容重用同一ID或旧expectedVersion返回409。网页同步锁同一行、取消旧查询并在保存后使行与历史查询失效；不乐观覆盖当前值。失败显示后端原因、恢复原值，提供刷新后重试。

通用`resources/:resource/:id` PATCH显式拒绝此资源。普通新增、删除、copy、batch_update和import通过正式权限能力限制；HTTP测试覆盖通用PATCH/批量/POST/DELETE/import-preview/import-confirm。没有通用日期更新绕过专用历史命令。

## 前向Migration及来源身份

新增`1722920104000-MpsReviewDueDateManualEdit.ts`，不改旧migration。仅当前表增加source_order_number/source_batch_number/source_drawing_number三个内部text来源字段、租户内来源唯一约束和INSERT初始化触发器；原当前业务键唯一约束保留。

来源三字段保存首次来源文本，包括后缀；初始回填仅当前新表，生产0行。业务键修改不改变record ID、来源键、created身份或历史FK。更新触发器禁止改变稳定身份/来源键，保留原日期统计守卫；原历史不可改删、计数/最新日期一致性触发器、FK、索引和FORCE RLS均保留。迁移不提供破坏来源身份的down；故障采用前向修复。补充旧结构非空升级测试发现回填产生延迟触发器事件，现已在后续ALTER前单独完成当前表计数约束检查，DDL后恢复DEFERRED；非空升级原ID/数值/审计/版本无变化且保护有效，已隔离验证。

未来受控observe按不可变来源三字段定位，维护已有ID的日期/数量/验货名，不恢复人工修改的当前三业务键。默认遇到未匹配来源返回409要求人工核实，不自动合并或创建。allowInitialCreate仅为内部明确初建的显式能力，本轮无HTTP入口、适配器或定时调用；未来日常同步不得设置该选项。真正来源键变化需可靠来源证明和后续单独受控映射命令，不能靠当前键或相似文字自动认定。未启动每日同步。

## 测试

- API全套119套1165项通过/33skip；Web聚焦12项、contracts31项通过。
- 隔离PostgreSQL+HTTP+实际Chrome共32组通过：三键/稳定ID/来源保留/唯一冲突、精确Decimal、改期四种状态、组合提交、版本并发、重复请求、审计失败回滚、租户/字段/数据范围、旧历史保护/RLS及完整十列Excel跨页导出。
- 真实HTTP专用200/400/403/409和通用写入拒绝已通过；真实Chrome隔离六字段编辑、精确数量、改期历史、409冲突及刷新重试已通过。
- Web全量61文件覆盖450项；限并发全量447通过/3项5秒超时，三文件单进程复验48通过/仅既有连续六次导出用例超时。对该单项使用CLI `--testTimeout=15000`，完整六次导出断言通过（7.76秒），其余15项在该命令跳过且早已在全量/复验通过。因此450项均已有通过证据；没有修改任何全局超时配置、相关业务代码或降低断言。首次并发API也出现一项资源超时，单独全量复验1165全部通过。
- API/Web构建、Web typecheck、API/Web lint通过；仅既有ModulePortal快刷warning。
- 所有写入测试只在受保护/tmp/kdos-review-due-pg-* socket连接的临时数据库执行，结束删除临时库；不在生产做可回滚写入测试。

## 生产保护与发布

开发前标准backup.sh已完成两库/uploads备份、恢复目录/归档格式及SHA256检查，权限600。受限日志data/mps-review-due-edit-20261021/backup-before.log，不提交备份/密钥/真实数据。

生产只读基线：主表0、历史0；6flags、9项权限/授权/PMC映射表内容摘要、8财务视图定义摘要已保存。旧业务仍正常运行；本任务不暂停既有调度，也不把自然业务变化冒称本任务写入。

本地测试与构建通过；发布前保护基线再次验证0/0、9项保护表/6flags/8视图相同。发布前备份、唯一新增迁移、标准deploy all/check、Chrome空表/编辑按钮/权限字段/Excel/403、生产0/0及保护基线对比和正常GitHub main push均已完成。未导入1139条、无演示数据、未触发ERP或Excel同步、未改6flags/生产权限组/财务公式/PMC通知。

## 修改文件

- contracts/review-due-dates.ts、review-due-dates.spec.ts、index.ts。
- API新迁移、review-due-date.application/controller/query、master-plan.types/application/query、domain.spec、新manual.spec。
- Web ReviewDueDates.tsx、新编辑测试及权限页字段测试；不修改共享表格实现或生产权限页面业务逻辑。
- scripts/test-review-due-dates-postgres.cjs扩展隔离事务、HTTP/Chrome测试。
- 本报告、原设计文档、CODEX_PROGRESS新任务段。原7份outputs差异完整保留，不混入本提交。

## 正式迁移记录

本任务提交`1b728c452e157e7048ef9c134bd3e6cf6fafe5b7`，仅19文件。222458发布前两库/uploads备份完成并校验；API镜像构建完成。migration:show核实102已执行且仅本任务1条待执行；使用lock_timeout=5s、statement_timeout=30s运行同一TypeORM正式迁移，103成功COMMIT。

迁移后只读核验：主表0/历史0，3来源text字段NOT NULL、来源/当前双唯一、两表FORCE RLS及5项保护触发器有效；9项授权/PMC映射表、6flags、8财务视图摘要完全不变。标准deploy all/check已完成，STATUS=CONSISTENT。本任务没有在生产执行任何人工业务编辑或写入测试。

## 最终上线、Chrome与GitHub记录

Repository=Web=API=GitHub main=`1b728c452e157e7048ef9c134bd3e6cf6fafe5b7`；标准`./scripts/deploy.sh all`与`./scripts/deploy.sh check`成功，STATUS=CONSISTENT，运行服务健康。正式入口：http://192.168.1.249:15172/master-plan-system/mps-review-due-dates 。

实际Chrome（Chrome channel）线上验收：页面200、十列及空状态、导航、搜索、稳定排序、日期范围/精确数值筛选、服务端Excel下载、进入/退出编辑模式、原集团主计划页面通过。Excel为mps_review_due_dates_20261021.xlsx，0业务行/10列。未授权普通账号meta/list/export/history均403；专用编辑403/409及各字段实际保存只在隔离HTTP/Chrome测试验证，不在生产空表造记录。

权限页使用真实已授权管理员的受控会话，打开成员选择和自定义权限草稿，通过键盘选择权限类型，逐项核验六个业务字段可见/可编辑复选框、勾选编辑自动勾选可见、四个统计字段编辑框禁用；取消弹窗，未提交任何授权。浏览器阻止所有非GET业务请求，记录productionWrites=0。初期自动化按钮/下拉定位曾超时，修正测试定位与交互后全流程完成；生产页面源码没有因此额外改动。

最终只读基线：当前表0/历史0、3来源NOT NULL、双唯一、两表FORCE RLS和5保护触发器有效；9项权限/授权/PMC映射表内容摘要、6同步flags、8财务视图定义摘要与开发前一致。未导入1139条，未新增演示数据，未调用ERP/每日Excel同步，未改生产授权组/财务公式/PMC通知。正常旧任务继续运行，不声称所有旧业务表在整个发布时段自然静止。

仅19个本任务文件进入commit；没有提交前任务7份outputs差异、凭据、备份、数据库或实际业务数据。push前再次核实远程仍为起始a86b321、源码与已验收提交一致；正常push github/main成功，无force，无Git冲突。最终SHA和线上运行补记保留在本机outputs，未混入其他任务。隔离PG临时库已删除，专用容器/匿名卷/socket和Vite已清理，备份及受限证据data/mps-review-due-edit-20261021保留。

最终交付：**WAITING_MANUAL_ACCEPTANCE**。本轮停止，不执行首次数据导入或每日同步。
