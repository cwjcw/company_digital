# KDOS PMC 评审交期表 V2 整改与真实验收复核

状态：**LOCAL_VERIFIED_WAITING_MANUAL_ACCEPTANCE**。本地 V2 字段与 Excel 验收通过。生产用户看到旧字段的根因是生产仍运行未包含 V2 的版本；本任务禁止生产 Migration 和部署，因此线上问题本轮未改变。

## 1. 结论与版本

|检查项|结果|
|---|---|
|本地源码|V2 合同和页面代码在未提交工作树中；HEAD `6c19507225f692c8e80a2f4d7e7a7f0c6cfc27be`|
|本地实际页面|本机 Vite `127.0.0.1:15182`，Chrome 153.0.8010.52 实际加载本地 V2 源码|
|生产 Web/API|健康，均为 `6c19507225f692c8e80a2f4d7e7a7f0c6cfc27be`|
|生产 Migration|`migrations.id=104`，`FinanceE10SourcePresenceAndTimestamps1722920105000`；V2 Migration 106 未执行|
|生产主表|`mps_review_due_dates` 为 0 行；无 `division_id`、`source_division_id`；`change_count` 仍 NOT NULL，`updated_by` 仍 varchar|
|生产变更|未执行 Migration、业务写入、真实 Excel 上传、部署、重启、commit 或 push|

本地 V2 代码尚未提交，故源码工作树包含 V2，而 Git HEAD 和生产版本相同。这能解释为何在本地浏览器看到新字段、生产仍显示旧字段。生产 Web bundle 的评审交期字段对象仍将 `drawingNumber` 定义为“试制计划图号”，将 `inspectionTimeName` 定义为“验货时间名称”；生产表结构没有事业部列。生产 build-info 和 API 健康版本一致，排除了只重启了其中一个服务的情况。

## 2. 三项问题根因

**A．“试制计划图号”未改名：生产静态包仍包含旧版字段合同。** 当前本地 Contracts 将 `drawingNumber` 显示为“品项编码”；API 键和数据库列继续使用 `drawing_number`，这是为兼容现有记录而保留的内部字段，不代表页面仍使用旧语义。生产包中可定位到旧字段定义，说明用户看到的旧名来自尚未发布的旧版本。

**B．“验货时间名称”未改名：同一版本原因。** 本地合同将稳定键 `inspectionTimeName` 显示为“品项名称”，物理列仍为 `inspection_time_name`。表格列、新增/编辑表单、权限字段名称、模板及导出均从这个合同生成；本地关键调用链没有旧中文标签残留。生产包仍包含旧标签定义。

**C．事业部缺列：生产尚未具备 V2 数据结构和应用元数据。** V2 需要使用现有企业微信组织目录中的事业部 UUID，并通过 Migration 106 增加 `division_id`、稳定来源 `source_division_id`。生产只读查询确认两列都不存在，生产字段元数据自然不会提供 `divisionId`。这不是单纯浏览器缓存，也不是通过强制显示前端列即可修复的问题。生产旧版本的前端和 API 均未升级。

本地调用链为：`packages/contracts/src/review-due-dates.ts` 定义业务/审计字段及标签 → `ReviewDueDates.tsx` 按服务端字段权限生成表格/表单 → `ReviewDueDateQueryService` 按租户、字段授权和数据范围返回 `divisionId`/`divisionName` → `master-plan-spreadsheet.service.ts` 与查询导出共用字段合同生成模板/导出。目标路由为 `/master-plan-system/mps-review-due-dates`，属于 PMC 主计划系统。

## 3. 字段映射核对

|顺序|显示名称|Contract/API键|数据库列|导入模板|导出|权限|
|---:|---|---|---|---:|---:|---|
|1|事业部|`divisionId`|`division_id` UUID|3|1|可编辑|
|2|订单号|`orderNumber`|`order_number`|4|2|可编辑|
|3|批次号|`batchNumber`|`batch_number`|5|3|可编辑|
|4|品项编码|`drawingNumber`|`drawing_number`|6|4|可编辑|
|5|品项名称|`inspectionTimeName`|`inspection_time_name`|7|5|可编辑，可空|
|6|入库时间|`inboundDate`|`inbound_date`|8|6|可编辑|
|7|数量|`quantity`|`quantity` numeric|9|7|可编辑，精确十进制|
|8|交期变更次数|`changeCount`|`change_count`|10|8|可编辑，可空非负整数|
|9|上次入库时间|`previousInboundDate`|`previous_inbound_date`|11|9|可编辑，可空|
|10|创建人|`createdBy`|`created_by` UUID|—|10|只读|
|11|创建时间|`createdAt`|`created_at`|—|11|只读|
|12|更新人|`updatedBy`|`updated_by` UUID|—|12|只读|
|13|更新时间|`updatedAt`|`updated_at`|—|13|只读|

模板前两列是辅助身份字段“记录ID、版本”，加九个业务字段共 11 列。导出包含九个业务字段和四个只读审计字段，共 13 列。模板和导出真实文件的表头、顺序均已解析核对。旧的 `lastChangedAt`、`lastSyncedAt` 仍是历史物理字段，但不进入 V2 的页面合同、字段权限或 Excel。

## 4. 实际 Chrome 与 Excel 证据

真实 Chrome 153 通过本地 Vite 访问 V2 页面，API 仅路由到临时 Nest 测试服务和无网络 PostgreSQL 18；浏览器脚本统计 `productionRequests=0`。截图与从页面按钮真实下载的合成 Excel 文件保存在：

`data/review-due-v2-fix-20261023/`

截图：

- `01-table-left.png`：表格左侧，含事业部、订单/批次及“品项编码、品项名称”。
- `02-table-right.png`：表格右侧，含数量、手工次数、上次入库时间及四个审计列。
- `03-create-form.png`：九个业务字段的新建表单。
- `04-division-options.png`：企业微信组织目录的四个事业部选项。
- `05-edit-mode.png`：同一表格中的人工编辑字段及审计列。
- `06-filtered-fields-before-export.png`：按事业部筛选后的页面字段。
- `07-import-preview-cancel-confirm.png`：单一 Excel 导入流程；确认操作仅针对隔离数据库中的合成文件。

真实下载文件：

- `template-11-columns.xlsx`：11 列空模板，含“事业部、品项编码、品项名称”，没有真实业务记录。
- `export-13-columns.xlsx`：13 列筛选导出，只有 1 条隔离测试合成记录。

浏览器和文件断言通过：表格字段顺序为 9 个业务字段+4 个审计字段；事业部选择器提供四个有效节点；新增和编辑字段名称正确；修改日期不自动更改手工次数/上次日期；实际模板为 11 列，导出为 13 列且精确数量与审计姓名正确。截图、Excel 及 `postgres-v2-result.json` 均为本地隔离测试证据，不是生产页面截图或生产数据。

## 5. 测试结果

|验证|结果|
|---|---|
|Contracts|5 个文件、33 项通过|
|API 专项|41 个测试套件、511 项通过；3 个环境型套件、20 项跳过|
|Web/权限|5 个文件、21 项通过；首轮默认 5 秒时限有 2 项超时，延长单测等待窗口后全数通过|
|隔离 PostgreSQL + HTTP + Chrome|32 项通过，包含 V2 migration fail-safe、租户/RLS、权限、唯一性、导入幂等/回滚及浏览器工作流|
|`pnpm typecheck`|通过|
|`pnpm lint`|通过，0 errors；存在既有 ModulePortal Fast Refresh warning|
|`pnpm build`|通过；存在既有大 bundle warning|
|`git diff --check`|通过|

测试环境当前 Node 为 22.23.1，仓库声明 Node `>=24`，pnpm 因引擎不符发出警告。尝试在 Node 24 容器内直接运行 pnpm 时，pnpm 因工作区依赖目录元数据不一致要求重装，并在无 TTY 保护下自动中止；没有清理或替换 `node_modules`。类型检查、lint、build 和测试均在现有依赖目录完成并通过。API/Jest 有既有 ts-jest `.js` 编译警告；Chrome/PG 日志有既有 TypeORM query 并行弃用警告。

本轮还修正了 Web 测试中仍称“六个旧字段/统计字段”的过期测试描述，并增加事业部选择控件和手工次数控件可见断言；没有发现需要修改 V2 页面或业务字段映射的本地功能缺陷。

## 6. 未执行事项、风险和后续方案

生产用户仍会看到旧名称且看不到事业部，直到 V2 应用与 Migration 经过审核发布。此任务明确禁止提交、推送、生产迁移和部署，因此未尝试改变生产。Migration 106 对非空旧表没有自动推断事业部的逻辑：未来执行前必须重新只读检查表数据；若有记录且无可靠归属，Migration 会原子拒绝，需人工确认归属。

后续上线方案仅供审核：先备份并验证备份；复核当前 Web/API、Migration、表记录数和授权；若旧表非空，先完成人工归属映射；然后提交/发布匹配的 V2 Web/API，执行前向 Migration 106，部署后检查服务版本及字段元数据，并用有权账号做只读 Chrome 验收。按本任务授权，本次不执行这些操作。V2 代码尚在工作树，没有新 Commit SHA。

当前本地结论为 **LOCAL_VERIFIED_WAITING_MANUAL_ACCEPTANCE**；生产上线状态为**未部署**。
