# KDOS-MPS-REVIEW-DUE-FIELDS-V2-001 验收报告

状态：**WAITING_MANUAL_ACCEPTANCE**。

本轮完成本地开发与隔离 PostgreSQL/HTTP/Chrome 验收，等待用户人工审核。未提交或推送 GitHub，未部署生产，未执行生产 Migration，未导入真实 Excel，未启动任何同步。自动测试通过不表示人工验收完成。

起始及当前 Git HEAD：`6c19507225f692c8e80a2f4d7e7a7f0c6cfc27be`。已有 `outputs/CODEX_PROGRESS.md` 修改及另一任务的未跟踪报告完整保留，未覆盖、暂存或混入提交。本任务代码保留在当前 Ubuntu 工作区，没有新 Commit SHA。

## 1. 最终字段及兼容性

|顺序|稳定字段键|业务显示|必填|人工写入|
|---|---|---|---|---|
|1|divisionId|事业部|是|是，组织UUID|
|2|orderNumber|订单号|是|是|
|3|batchNumber|批次号|是|是|
|4|drawingNumber|品项编码|是|是|
|5|inspectionTimeName|品项名称|否|是，可NULL|
|6|inboundDate|入库时间|是|是|
|7|quantity|数量|是|是，精确十进制文本|
|8|changeCount|交期变更次数|否|是，NULL或非负integer|
|9|previousInboundDate|上次入库时间|否|是，可NULL|
|10|createdBy|创建人|系统|否|
|11|createdAt|创建时间|系统|否|
|12|updatedBy|更新人|系统|否|
|13|updatedAt|更新时间|系统|否|

`drawingNumber/drawing_number` 和 `inspectionTimeName/inspection_time_name` 保持原有稳定 API/物理字段键，只改显示名称、Excel 表头与字段语义，没有清空或重新初始化业务数据。新版 API 必须提供事业部；旧客户端缺少事业部的新建请求会明确拒绝。ID、version 及原专用路由保持不变。

最近同步时间和最近变更时间不再进入业务字段 Registry、权限编辑器、页面、筛选、模板或导出。旧 `last_synced_at/last_changed_at` 物理列保留，不做破坏性删除。历史 Drawer 改称“历史交期记录”，明确旧事件条数与手工变更次数无关。

## 2. 事业部组织关联及权限

复用 `OrganizationDirectoryService` 和现有企业微信组织目录，不新增独立字典。依据启用节点的实际父子路径，限定“凯南”直属的事业一部、事业二部、事业三部和事业四部；UUID 持久化，页面/Excel显示正式名称或完整路径。

服务端接受正式 UUID、精确中文名称或完整组织路径，名称重名必须给完整路径；无效、停用、车间、下级部门及错误路径拒绝。组织选择器只提供四个正式事业部。高级筛选候选使用现有平台 FieldCandidateService、SqlFilterCompiler 和当前授权记录的 DISTINCT 值；本资源通过 candidateVariant 避免把分页业务行错误返回成候选数组，没有修改共享控制器或其他资源规则。

当前唯一键为 `tenant_id + division_id + order_number + batch_number + drawing_number`。初始来源键独立增加不可变 `source_division_id`，与初始三键一起租户内唯一；不同事业部的相同三键可以共存。人工修改当前事业部或业务键后，UUID、初始来源事业部/三键和历史关联仍保持不变，来源身份继续可追踪和保留。未来来源键本身变化仍须人工核实，不自动合并或把手工新增记录当成来源已确认。

资源动作、字段授权、租户和动作数据范围由后端校验；编辑与导入均检查原记录和拟修改记录范围。create-only 用户可以取得创建元数据但不能读取列表；导入新增仍须 import + create，更新校验实际修改字段的 update。未修改任何生产权限组，也不自动为旧角色增加事业部或手工字段授权。管理员上线后须通过现有权限管理配置新字段可见/可编辑权限。

## 3. 前向 Migration 与历史保护

新增 `apps/api/src/migrations/1722920106000-MpsReviewDueDateFieldsV2.ts`，类名 `MpsReviewDueDateFieldsV21722920106000`。

- 新增事业部及初始来源事业部 UUID、组织外键、两套事业部唯一约束和查询索引。
- change_count 取消 NOT NULL 与默认0，保留非负整数 CHECK；previous_inbound_date 可空、手工维护；品项名称可空。
- created_by 要求稳定用户UUID；updated_by 从 varchar 转为用户UUID并增加 RESTRICT 外键，取消 system 文本默认值；创建及更新用户校验当前租户。
- 移除 `trg_mps_review_due_count`、`trg_mps_review_due_history_count` 与旧计数/日期一致性函数；更新守卫只保护内部身份、来源身份和创建审计，不再强制计次或填写上次日期。
- 保留两表 FORCE RLS、tenant+ID 历史外键、UUIDv7、版本约束及历史事件不可改删触发器。
- 不更新/清空已有计数、日期、UUID、业务内容或历史；不删除历史 Migration。

迁移对非空旧表采取保守门禁：当前旧结构没有可靠事业部，不能凭订单/客户推断；如执行时出现旧记录，整次 Migration 原子拒绝并要求人工归属确认。无法安全解析的审计用户也拒绝，不伪造管理员或丢弃旧值。隔离 PostgreSQL 已验证拒绝时原记录及旧结构完整保留。

生产上轮及本轮结束只读检查均为主表0、历史0、相关审计0、导入预览0；2026-10-23 最终只读确认仍无 division_id/source_division_id，updated_by 仍为 varchar，change_count 仍 NOT NULL，Migration ledger 最新仍是104。本轮未执行生产结构或数据变更。

## 4. 手工字段、专用命令和审计

manual-create/manual-edit 沿用原路由、UUIDv7、expectedVersion、事务行锁、commandId 幂等和真实认证操作人。专用写入共用租户事务锁，防止当前键与保留来源键的并发交叉冲突。通用 create:false、新增、PATCH、批量修改、删除和通用导入继续阻断，不能绕过专用业务校验。

changeCount 只接受 NULL、0及非负整数；拒绝负数、小数、布尔值、非数字及超出 PostgreSQL integer 范围值。previousInboundDate 可设置、修改或以 null 清空。日期或数量变化不会改变这两个手工字段。人工编辑、Excel Confirm 和 observe 均不再创建新的自动交期事件；旧历史继续只读保留。

新增时后台设置相同真实用户UUID和相同创建/更新时间；修改只更新更新人/更新时间，创建审计和不可变来源不变。完全未变化不虚增 version/updated_at。标准 audit_logs 保存真实用户、前后值、改动字段及命令/导入批次，审计失败时业务行、收据和预览确认结果一起回滚。

页面复用平台审计列与姓名目录，包括停用用户；改名后仍以稳定UUID关联，操作审计保留当时姓名。Excel用统一审计姓名解析器；网页和Excel时间均按Asia/Shanghai。四字段在权限配置中不可编辑，也不能通过请求体、Excel、通用接口或伪造version写入。

## 5. Excel 模板、导入和导出

保留单一“导入Excel”入口，不恢复双模式。新版空模板11列为：记录ID、版本、事业部、订单号、批次号、品项编码、品项名称、入库时间、数量、交期变更次数、上次入库时间；有正式组织下拉、字段定义和说明，不含真实业务数据及审计列。

|输入|正式语义|
|---|---|
|ID及版本都空|新增，须import+create及必要字段权限|
|ID及版本都有效|按租户+稳定UUID更新，检查版本|
|只填其中之一|拒绝，无确认token|
|新增可选值空白|NULL，不默认计数0|
|更新可选值空白/未提供|保留已有值|
|可选值明确填写 `[清空]`|清空对应值为NULL|
|旧六列缺少事业部|明确要求补齐事业部，不猜归属|
|旧SOURCE待确认预览|要求用新版模板重新预览，不猜新身份|
|审计/未知表头|拒绝，不允许导入审计字段|

可选列可省略；带隐藏字段映射的系统模板仍严格检查映射一致性，修改模板结构需保持正式映射正确，异常明确拒绝，不隐式清空。新上传仍采用STANDARD的ID/version语义；旧预览、回执和业务历史不做数据库清理。实际生产预览/回执基线为0。

Preview 不写业务表，仅写既有预览台账；Confirm 复查授权、有效组织、前后数据范围、唯一性和版本，再同事务写业务、逐行/批次审计、收据和确认结果。重复确认只返回原回执；重复新增文件不覆盖已有键。ExcelJS的统一加密检测、ZIP/XML/CRC及命名空间兼容修复保留。

业务导出为13列（含四个只读审计字段），服务端完整匹配筛选/排序，范围为read∩export并按字段读取授权裁剪。审计字段仅在本资源显式允许导出，不改变其他表或开启本表打印。实际跨200行分页导出、精确数量文本、事业部名称和操作人姓名均通过。

## 6. 验证结果

- Contracts：5组33项通过。
- API相关回归：41组511项通过，覆盖本资源、主计划、Spreadsheet、统一加密检查、审计导出及筛选登记；仓库既有3组20项环境型测试按原条件跳过。本任务实际写入另由下述隔离测试覆盖。
- Web：本资源/权限5组21项最终整组通过，既有主计划页面36项通过，合计57项均有通过证据。编辑用例已修正为等待metadata/初始分页回调完成后取得当前输入，防止断言已卸载DOM；业务断言和权限检查保留。
- PostgreSQL18 +真实HTTP +Chrome153：32场景通过，使用无网络临时容器、tmpfs数据库、独立Unix socket；所有业务写入仅为合成记录，测试结束清理临时数据库。
- 全项目typecheck、lint、build通过；仅既有ModulePortal FastRefresh、React/AntD兼容提示及Web大包提示。
- `git diff --check`通过，Git无未合并条目。

隔离验收覆盖四事业部/中文名/重名/无效组织；跨事业部共存与同事业部冲突；NULL/0/正整数与非法数值；手工前次日期清空；日期/数量修改不自动维护；四审计字段与真实不同操作人；原UUID/来源键不变；旧历史不可改删；资源/字段/数据范围/跨租户拒绝；409、并发幂等、审计失败回滚；11列模板、稀疏更新/显式清空、预览不写、重复确认、200行分页导出、read∩export、组织和姓名输出。

真实Chrome仅连接本地Vite和隔离Nest服务，所有API写入转发到隔离数据库，未使用生产账号；阻断WebSocket及其他API路径。实际验证13列顺序、四事业部下拉、新增、修改日期、清空手工次数/上次日期、历史提示、事业部高级筛选、模板下载、筛选Excel导出、单一导入预览/取消及一次合成文件确认。生产请求0，不上传或确认真实用户文件。

证据目录（Git忽略且不提交）：`data/review-due-fields-v2-20261023/`。包含 `postgres-v2-result.json`、`chrome-v2-result.json`、`chrome-v2.png`、生产只读结构结果及测试日志。目录700，最终文件收紧为600。

## 7. 修改文件

- Contracts：`review-due-dates.ts/.spec.ts`、`index.ts`。
- API：新Migration106及专项测试，review-due-date领域/Application/Import/Query与测试；master-plan资源配置、组织选项、Spreadsheet及通用拒绝提示；筛选登记测试的构造参数。
- Web：ReviewDueDates页面/导入弹窗及新增、编辑、页面测试；复用既有组织选择和审计组件，不改共享表格业务逻辑。
- 隔离脚本：新增V2 PostgreSQL/HTTP/Chrome脚本，原 `test-review-due-dates-postgres.cjs` 保留为正式入口转到V2；旧自动计次导入断言由新的手工语义测试替代，过时辅助文件移除。
- 文档：本报告、`KDOS_MPS_REVIEW_DUE_DATE_SPEC.md`、`CODEX_PROGRESS.md`。

其他PMC模块、财务金额/通知、ERP集成、生产权限组、6项同步flags、n8n/systemd/cron均无业务改造或生产写入。

## 8. 人工审核后的上线与回退方案（本轮未执行）

1. 用户明确批准后重新检查工作区、HEAD/远端差异与真实生产记录/历史/预览。只提交本任务白名单，排除既有未跟踪任务报告、真实数据、备份、日志和凭据；正常push，冲突即停止。
2. 执行项目标准两库/附件备份并校验格式、权限、SHA与恢复方式；记录旧Web/API镜像及完整版本、权限组/六flags摘要。
3. 若旧表出现业务记录，因事业部不能自动判断而暂停Migration，输出UUID及需人工确认归属清单，不猜测、不清表、不恢复旧库覆盖业务；若仍为0，核对仅本任务Migration待执行后按正式TypeORM事务前向迁移。
4. 发布经审核的Web/API，再执行deploy all/check及健康、权限、真实Chrome只读/取消预览验收。保持Repository=Web=API一致，不把本地源码误当已上线版本。
5. 本次变更涉及字段必填和手工语义，旧应用代码不能直接在V2结构上恢复旧自动计次写入。回退应先暂停本资源写入口，再部署经过V2结构兼容验证的应用版本或做前向修复；不盲目运行down、不删除新字段/历史、不以恢复旧数据库覆盖上线期间的新业务数据。
6. 不开启每日同步，不执行真实首次导入，不擅自授予员工新权限；这些均需另行授权。

生产当前Web/API仍为 `6c19507225f692c8e80a2f4d7e7a7f0c6cfc27be` 且健康。`deploy.sh check`在本地有未提交源码时按既有门禁拒绝，本轮未绕过。没有新的生产版本、Commit SHA或部署结果。

本轮临时Vite服务及无网络/tmpfs PostgreSQL容器已清理，合成测试数据库随临时环境删除；证据仅保留本机Git忽略目录。最终源码全项目检查和diff检查通过，没有暂存、commit或push。

最终状态：**WAITING_MANUAL_ACCEPTANCE**。完成本地工作后停止，等待人工审核。
