# Codex 工作进度

## 当前任务：KDOS-TABLE-COMPACT-STANDARD-001 追加：标准业务表手工调整列宽与分页标准

任务目标：在既有标准业务表 compact 默认能力基础上，由 `KdosDataTable` 公共层统一提供可拖动列宽、个人列宽偏好持久化与字段/页面隔离；同时落实默认每页 100 条、可选 50/100/200/500/1000、后端最大 1000 的统一分页标准。

当前状态：公共实现、Skill/roadmap 同步、定向与全量测试、typecheck、lint、build、备份、正式部署和运行检查完成；等待用户人工验收。

开始 HEAD：`fcc24f960d257863776774d7616f9a7bf6a7ee9d`

最后更新时间：2026-09-29

### 当前阶段

当前阶段：公共列宽调整、个人偏好持久化与分页标准实现

当前子任务：确认所有标准 `KdosDataTable` 继承同一 resize 行为，保留 compact 初始宽度和 default 例外。

### 已完成

- [x] 已读取追加需求、项目 AGENTS、`kdos-form-platform` Skill、当前进度和工作区。
- [x] 已确认现有个人视图偏好使用 Web `localStorage`，已有字段显示、固定列和每页条数保存；没有服务端 personalization 表，故不新增数据库系统。
- [x] 已确认当前分页仍为默认 50、选项 20/50/100/200、部分后端上限 200，需按追加要求统一升级。
- [x] `KdosDataTable` 公共层已增加表头右侧 resize handle；列宽按字段类型提供初始宽度和 `minWidth`，用户宽度优先，拖动过程中不写业务数据，释放鼠标后保存个人偏好。
- [x] 列宽偏好键包含租户、用户、resource、viewKey，值按 fieldKey 保存；刷新、重新挂载、隐藏/显示、查询条件变化后可恢复；保留旧个人视图键的读取兼容。
- [x] 分页统一为默认 100、选项 50/100/200/500/1000、后端最大 1000；API 模块复用 `apps/api/src/common/pagination.ts`。
- [x] 已同步 `.agents/skills/kdos-form-platform/SKILL.md` 与 `docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md`。
- [x] 定向 Web：2 files / 20 tests passed；API 分页：2 tests passed。
- [x] Web 全量：26 files / 162 tests passed；API 全量：73 suites passed、1 skipped，567 tests passed、1 skipped。
- [x] Web/API typecheck、lint、build 通过；lint 仅保留既有 `ModulePortal.tsx` Fast Refresh warning，build 仅保留既有大 chunk warning。
- [x] 实现 commit：`00ce83f`（`feat(KDOS-TABLE-COMPACT-STANDARD-001): add shared column resizing`）。
- [x] 备份：`data/backups/four_department_tracker_20260929_163020.backup`=`d97d0e5a88f8534f073e43e9ac38d483b80cba918f88b505c87d11a1b63f466b`；`data/backups/kdos_20260929_163020.backup`=`61fcbc351c0cc65089df99bb669d56fb7ca66203b1a78004e7c297f76c1da0c3`；`data/backups/uploads_20260929_163020.tar.gz`=`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`。
- [x] 正式 `./scripts/deploy.sh all` 成功；Repository/Web/API=`00ce83f`，`./scripts/deploy.sh check` 为 `STATUS=CONSISTENT`。
- [x] 部署后 API/Web/Postgres healthy，PostgreSQL 容器 ID 前后均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`；migration 数量仍为 76；API 最近 10 分钟无新的 500、23514、constraint、QueryFailedError 或 exception 日志。

### 正在进行

- [x] 在 `KdosDataTable` 公共层实现列宽拖动、minWidth、宽度恢复和跨查询稳定性。
- [x] 更新统一分页常量及后端页大小校验，补充 Skill、roadmap 和回归测试。

### 待完成

- [x] 定向/全量测试、typecheck、lint、build。
- [x] 备份、正式部署、健康检查及运行状态核验。
- [ ] 用户人工验收。

### 数据库 Migration

- 无：本追加需求禁止数据库修改；列宽偏好第一阶段复用浏览器个人偏好。

### 当前已知问题

- 用户人工验收尚未完成；在用户查看前不得判定 PASS。

### 下一步

1. 提交 roadmap 最终部署记录并再次保持部署 SHA 一致。
2. 等待用户按主计划、项目、任务、设备页面执行拖动/刷新/隐藏/筛选/分页/编辑验收。

## 当前任务：KDOS-TABLE-COMPACT-STANDARD-001

任务目标：将已通过人工验收的周计划 compact 表格模式推广为所有标准 `KdosDataTable` 的默认密度，并清理标准业务页面自动显示的用途、数据模型、权限、编辑模式和技术实现说明；保留 default 例外能力，不修改数据库。

当前状态：代码、测试、备份、正式部署和运行检查完成；等待用户线上人工验收。

开始 HEAD：`56507cea8d97427fd47be3f5fc929a4c2e23f2d1`

最后更新时间：2026-09-29

### 当前阶段

当前阶段：平台默认密度与页面说明规范推广

当前子任务：默认 compact、清理标准页 PageHeader subtitle、保留 Dashboard/特殊页面显式 default 例外。

### 已完成

- [x] 已读取任务要求、AGENTS、`kdos-form-platform` Skill、roadmap 和当前工作区；确认上一任务 `KDOS-TABLE-COMPACT-DEMO-001` 已由用户人工验收 PASS。
- [x] `KdosDataTable` 默认 density 从 `default` 改为 `compact`，`density="default"` 与 `density="compact"` 双模式保留。
- [x] 主计划页面移除“新版主计划独立数据模型；默认只读浏览，进入编辑模式后方可维护获权字段”说明；标准业务页同类 PageHeader subtitle 已清理。
- [x] Dashboard/特殊汇总表显式保留 `density="default"`，不把大字号展示页机械压缩。
- [x] `.agents/skills/kdos-form-platform/SKILL.md` 已加入标准业务页面说明文字禁用规则和 compact 强制标准。
- [x] `docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md` 已记录 Demo PASS 和本轮标准化任务状态。
- [x] 定向 Web 回归测试：7 files / 70 tests passed；覆盖 `KdosDataTable`、主计划、工单、辅助分组、督办、设备等。
- [x] Web 全量测试：26 files / 160 tests passed。
- [x] Web typecheck、lint、build 通过；lint 保留既有 `ModulePortal.tsx` Fast Refresh warning，build 保留既有大 chunk warning。
- [x] 已提交实现：`fcc24f960d257863776774d7616f9a7bf6a7ee9d`（`feat(KDOS-TABLE-COMPACT-STANDARD-001): standardize compact business tables`）。
- [x] 部署前备份：`data/backups/four_department_tracker_20260929_160346.backup`=`03c2228a6757a7238c6900f1c3351c7e11885016f36a61dd0de460eaf7750d59`；`data/backups/kdos_20260929_160346.backup`=`85b10be87983ac438e39893497bad6a1577f3d9a6f28765f39889369b5bf4ac2`；`data/backups/uploads_20260929_160346.tar.gz`=`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`，文件均可读。
- [x] 正式 `./scripts/deploy.sh all` 成功；Repository/Web/API 均为 `fcc24f9`，`./scripts/deploy.sh check` 为 `STATUS=CONSISTENT`。
- [x] 部署后 `scripts/healthcheck.sh` 通过；API/Web/Postgres 均 healthy；PostgreSQL 容器 ID 前后均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`。
- [x] 只读数据库核验：migration 数量仍为 76，本任务未执行 migration、未修改业务数据；部署后 API 最近 10 分钟无新的 500、23514、constraint、QueryFailedError 或 exception 日志。

### 正在进行

- [x] 运行定向与 Web 全量测试、typecheck、lint、build。
- [x] 提交本轮源码、Skill、roadmap 和测试，正式部署并做健康检查。

### 待完成

- [ ] 用户人工验收主计划、项目、任务、设备页面的 compact 可读性与完整交互，并确认计划管理说明文字消失。

### 数据库 Migration

- 无：本任务禁止数据库修改、migration、schema 调整和业务数据修改。

### 当前已知问题

- 用户人工验收尚未完成；在用户查看前不得判定 PASS。
- 保留上一轮既有 Node v22 engine、Web Fast Refresh 和大 chunk warnings。

### 下一步

1. 用户人工查看主计划、项目、任务、设备页面的 compact 可读性与完整交互。
2. 确认 1080P 下显示更多行/列、编辑控件不撑高、sticky/单纵向滚动/横向滚动、搜索筛选分页导入导出均无回归。
3. 确认主计划页面不再显示“新版主计划独立数据模型；默认只读浏览，进入编辑模式后方可维护获权字段”。
4. 根据用户验收结果将本任务更新为 PASS 或记录 NO-GO/FAIL；验收前不得自报 PASS。

## 当前任务：KDOS-TABLE-COMPACT-DEMO-001

任务目标：仅将事业部周计划页面作为紧凑表格 Demo，降低表格字体、行高、单元格留白和部分合理列宽；保留默认表格密度，待用户人工验收后再决定是否推广。

当前状态：用户真实人工视觉验收 PASS；任务已收口并作为全平台 compact 标准基线。

开始 HEAD：`c61004ce6d3cd7141dbae21ccd8f5a90e02a2cb7`

结束 HEAD：`56507cea8d97427fd47be3f5fc929a4c2e23f2d1`

实现提交：`56507ce`（`feat(ui): add weekly plan compact table demo`，含表头/数据行稳定高度微调）

最后更新时间：2026-09-29

### 当前阶段

当前阶段：紧凑 Demo 已完成并通过人工验收

当前子任务：确认周计划真实使用 `KdosDataTable`，增加 opt-in `density="compact"`，保持其它页面 `default`。

### 已完成

- [x] 已读取项目 AGENTS、`kdos-form-platform` Skill、实际周计划页面和公共表格实现；确认周计划使用 `KdosDataTable`，不是独立 Ant Table。
- [x] 未修改数据库、未新增 migration、未修改业务数据，也未修改平台 Skill 默认标准。
- [x] `KdosDataTable` 新增可选 `density="default" | "compact"`，默认行为保持不变；周计划显式使用 compact，月计划及其它页面保持 default。
- [x] compact 仅作用于周计划表格：正文/表头 13px、正文 line-height 20px、表头约 34px、紧凑单元格 padding、Input/Select/DatePicker 约 28px；未压缩左侧菜单、顶部导航、KPI、Dashboard、Modal 或系统管理。
- [x] 周计划合理压缩部分横向列宽：订单 132、品项 120/150、日期 112、数字 88、字典 100、布尔 82、生产进度 105；备注保留 180，异常列保留 280；长文本单行 ellipsis 并支持 Tooltip。
- [x] 增加 compact opt-in、周计划启用/月计划保持 default 的回归测试。
- [x] 定向 Web 测试：2 files / 14 tests passed。
- [x] Web 全量测试：26 files / 160 tests passed。
- [x] Web typecheck、lint、build 通过；lint 仅保留既有 `ModulePortal.tsx` Fast Refresh warning，build 仅保留既有大 chunk warning。

### 正在进行

- [x] 提交源码：`56507ce`。
- [x] 正式部署：`./scripts/deploy.sh all` 成功；最终 `./scripts/deploy.sh check` 为 Repository/Web/API=`56507ce`、`STATUS=CONSISTENT`。
- [x] 部署前备份：`data/backups/four_department_tracker_20260929_154201.backup`=`74e5a745a9336f29d52879d8bd3bc4ceeec28cfeb900a4c39424dd343c8bd670`；`kdos_20260929_154201.backup`=`d6d6793d7d5cd30b8510ba554fb0014127d9d96f88c53f79113466727e2ef16d`；`uploads_20260929_154201.tar.gz`=`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`。
- [x] 部署后 API/Web/Postgres 均 healthy，`scripts/healthcheck.sh` 通过；PostgreSQL 容器 ID 未变化，仍为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`。
- [x] 数据库只读核验：migration 仍停留在既有 #76，本任务未新增 migration；主计划行数仍为 shipping/base/weekly=`478/1405/1169`；未主动触发同步；部署后 API 最近 10 分钟无 500/23514/constraint/exception 日志。

### 待完成

- [x] 用户真实人工查看周计划 Demo：字体清晰、行高/留白明显降低、1080P 显示更多行和字段、编辑控件协调、横向滚动、sticky header、长文本 ellipsis/Tooltip、搜索/筛选/分页/导入/导出/编辑均通过。

### 数据库 Migration

- 无：本任务明确禁止数据库修改。

### 当前已知问题

- Demo 已完成用户人工视觉验收 PASS；本轮标准化任务不得擅自改变已验收参数。
- Node 当前为 v22，项目声明目标为 v24；测试命令会显示既有 engine warning。

### 下一步

1. 本轮标准化任务完成测试、部署和人工验收。
2. 若用户验收发现回归，仅在标准密度或说明文字范围内修复。

## 当前任务：KDOS-DELIVERY-CODE-AUTO-001

任务目标：复用主计划现有 UUID 主键，改由服务端为同一租户订单+品项生成并持久化并发安全、删除不复用的交期编码；保持交期日期编辑不改变记录身份，覆盖页面、API、Excel 导入及下游同步。

当前状态：实现、migration、正式部署与运行检查完成；等待线上人工验收。

开始 HEAD：`017521b8f44862d3883cb7b75878e6d49d7806c7`

最后更新时间：2026-09-29

实现提交：`c61004c`（`feat(mps): auto-generate stable delivery codes`）

### 当前阶段

当前阶段：线上人工验收

当前子任务：完成主计划表/主键/字段/约束/关联/导入链路确认，随后新增正式计数器 migration 与应用层统一生成逻辑。

### 已完成

- [x] 已读取项目 AGENTS、`kdos-form-platform` Skill、架构、安全、runbook、进度文件及实际 Roadmap（实际路径：`docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md`）。
- [x] Git/部署预检：当前分支 `main`，HEAD=`017521b`；仅有 `outputs/CODEX_PROGRESS.md` 进度修改；`./scripts/deploy.sh check` 为 Repository/Web/API=`017521b`、`STATUS=CONSISTENT`。
- [x] 已确认主计划真实来源表为 `mps_shipping_plans`；`mps_base_plans` 通过 `shipping_plan_id`、`mps_weekly_plans` 通过 `base_plan_id` 使用内部 UUID 关联；3天工单使用周计划 UUID，不使用交期编码定位。
- [x] 已确认当前各相关表的技术主键均为 `id uuid PRIMARY KEY DEFAULT uuidv7()`；交期日期实际业务字段为 `latest_customer_due_date`，当前可由正式编辑链路修改。
- [x] 已确认真实业务字段：订单=`orderNumber/order_number`，品项=`itemCode/item_code`，交期编码=`deliveryNumber/delivery_number`，交期日期=`latestCustomerDueDate/latest_customer_due_date`。
- [x] 已确认当前源表、基础计划、周计划及报工快照的交期编码仍为 `integer`；源/基础/周计划唯一约束均为同租户订单+品项+交期编码，未发现计数器基础设施。
- [x] 生产只读一致性检查：主计划行数 shipping/base/weekly=`478/1405/1169`；交期编码均非空、非负且现存重复组为 0；shipping→base、base→weekly、各报工快照与周计划关联字段不一致数量均为 0；所有 shipping 均有 base。
- [x] 已确认所有正式新增/导入入口汇聚到 `MasterPlanApplicationService.create/importUpdates`，现有实现仍把交期编码列当作用户必填/可编辑字段；网页模板由同一 metadata 生成。

### 正在进行

- [x] 新增 `mps_delivery_code_counters` 正式 migration，并将相关交期编码列迁移为可容纳 `001…999、1000…` 的字符串；migration 只规范现有数值的显示格式并初始化计数器，不重排业务序号、不修改计划日期或内部 ID。
- [x] 应用层在 shipping/base 创建与新增导入中统一生成编码；加入事务级租户+订单+品项锁、唯一约束保护与删除不复用规则。
- [x] 更新 metadata、查询排序/显示、导入模板、下游数值排序及回归测试。

### 待完成

- [x] 定向测试、API/Web 全量测试、typecheck、lint、build。
- [x] 备份与正式 migration 已完成：`scripts/migrate.sh` 于 2026-09-29 15:27 执行；备份为 `data/backups/four_department_tracker_20260929_152715.backup`、`data/backups/kdos_20260929_152715.backup`、`data/backups/uploads_20260929_152715.tar.gz`，SHA256 已由脚本记录；migration #76 已应用。
- [x] migration 只读验证：7 张相关表的 `delivery_number` 均为 `varchar(32) NOT NULL`，新增正数字符串 CHECK，`mps_delivery_code_counters` 已初始化 1357 行；计划表行数仍为 shipping/base/weekly=`478/1405/1169`。
- [x] 备份文件可读且 SHA256 已复核：`four_department_tracker_20260929_152715.backup`=`ccb3d2e3e2c73acdcd54c72ef0c118cd3b7738e1a8e386c314f344f178bea363`；`kdos_20260929_152715.backup`=`30c9488b449e8f00b0007159ab7a163ba01130d020bed3d5f98027ec44f9372e`；`uploads_20260929_152715.tar.gz`=`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`。
- [x] 正式 `./scripts/deploy.sh all` 成功；最终 `./scripts/deploy.sh check` 为 Repository/Web/API=`c61004c`、`STATUS=CONSISTENT`。
- [x] 部署后 API/Web/Postgres 均 healthy；PostgreSQL 容器 ID 前后均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`；未主动触发主计划同步。
- [x] 部署后 API 最近 10 分钟无新的 500、23514、constraint、QueryFailedError 或 exception 日志。
- [ ] 用户线上人工验收：首条 001、第二条 002、删除后新建 004、日期修改 ID/编码不变、编码不可编辑、Excel 不填编码可新增。

### 数据库 Migration

- [x] 已提交并正式执行 `1722920075000-MasterPlanDeliveryCodeAuto.ts`；`migrations` 中存在 `MasterPlanDeliveryCodeAuto1722920075000`，未重建 PostgreSQL 容器。

### 当前已知问题

- 线上人工验收尚未完成；在用户确认首条/第二条生成、删除不复用、日期编辑保持 ID/编码、编码不可编辑和 Excel 导入后，才能决定最终 PASS。
- 当前工作区已有的 `outputs/CODEX_PROGRESS.md` 修改属于本任务/既有恢复记录；部署前仍须确保除此之外无未提交源码、配置或文档修改。
- migration 后只读复核：shipping/base/weekly 行数仍为 `478/1405/1169`，无非法编码、无租户+订单+品项+编码重复组；编码数值范围分别为 1..2、1..2、1..1。migration 未重排 ID、日期或业务序号。
- 自动化验证：API 全量 72 suites / 565 tests passed、1 suite / 1 test skipped；Web 26 files / 158 tests passed；API/Web typecheck、lint、build passed。保留既有 Node v22 engine、Fast Refresh 与大 chunk warnings。

### 下一步

1. 用户线上验收首条/第二条自动编码、删除不复用、日期修改保持 ID/编码、编码不可编辑及 Excel 不填编码可新增。
2. 根据用户验收结果将本任务更新为 PASS 或记录 NO-GO/FAIL；验收前不得自报 PASS。

---

## 当前任务：KDOS-WEEKLY-PLAN-FIELD-OPTIONS-001

任务目标：扩展周计划产品属性/表面性质合法选项，并将系统所有标准业务表的 `modelAge`（新旧款）字段改为非必填；保持 API、筛选、内联、批量和 Excel 链路一致。

当前状态：等待人工验收（代码、测试、备份、正式部署和运行检查已完成）。

开始 HEAD：`eb2f37b9c3343cd7b25d8cb7168ab28397df3269`

结束 HEAD：`017521b8f44862d3883cb7b75878e6d49d7806c7`

最后更新时间：2026-09-29

### 当前阶段

当前阶段：字段选项与可选语义已部署，等待线上人工验收

当前子任务：等待用户使用正常授权账号验收周计划下拉、空新旧保存/清空及 Excel 导入。

### 已完成

- [x] 已关闭上一任务 `KDOS-UI-PAGE-SCROLL-STANDARD-001`：用户生产人工验收 PASS 已记录；本任务未修改滚动代码。
- [x] 已确认真实 field key：`modelAge`、`productAttribute`、`surfaceNature`；API `fieldsFor()` metadata 是主计划页面、筛选、模板/导入及 Application option 校验的正式来源。
- [x] 已确认 `modelAge` 的标准 metadata 使用点：月计划、出货计划、基础计划、周计划、3天生产工单；数据库相关列均 nullable，未发现必填 DTO/Application 分支。
- [x] 已将共享选项集中到 `@tracker/shared`：产品属性保留原 4 项并新增“其他/五金+亚克力/塑料”；表面性质保留原 2 项并新增“热转印/毛坯/其他”；modelAge 保留“新/旧”。
- [x] 已将周计划 metadata 暴露三字段并设为可编辑、非必填；出货计划/基础计划 `modelAge` 保持可编辑并明确 `required=false`。
- [x] 已更新 API 选项校验、筛选解析、同步复制守卫以及 Excel 模板/导入共用 metadata 链路；非法值仍拒绝。
- [x] 数据库只读检查确认 `model_age`（以及相关产品/表面列）为 nullable；未新增 migration、未修改历史业务数据。
- [x] 共享字典、主计划 metadata/config、integration/填写说明文档已同步新选项与可选语义。
- [x] 定向 API 主计划测试：5 suites / 138 tests passed；shared/contracts 测试及构建通过。
- [x] API 全量：71 suites / 561 tests passed，1 suite skipped；Web 全量：26 files / 158 tests passed。
- [x] API/Web typecheck、lint、全 workspace build 通过；保留 Node v22 engine warning、Web Fast Refresh warning 和既有大 chunk warning。
- [x] 正式提交：`c2e8ac01cd442c605f978defa0439c2f54c9d50a`，消息为 `fix(mps): expand weekly field options and make model age optional`。
- [x] 修正月计划 `modelAge` 可编辑语义并提交：`017521b8f44862d3883cb7b75878e6d49d7806c7`；新增 config 回归断言，3天工单仍为来源只读。
- [x] 生产备份：`data/backups/four_department_tracker_20260929_144911.backup`、`kdos_20260929_144911.backup`、`uploads_20260929_144911.tar.gz`；custom dump/tar 可读并已记录 SHA256。
- [x] 正式 `./scripts/deploy.sh all` 成功；`./scripts/deploy.sh check` 为 Repository/Web/API=`017521b`、`STATUS=CONSISTENT`。
- [x] 部署后 API/Web/Postgres healthy；PostgreSQL container ID 前后均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`。
- [x] 部署后 API 最近 10 分钟无新的 500、23514、constraint、QueryFailedError 或 exception 日志；未执行 migration、未主动触发任何主计划同步。

### 正在进行

- [x] API/Web 全量测试、typecheck、lint、build。
- [x] 生产备份、正式 `./scripts/deploy.sh all`、一致性/健康检查。

### 待完成

- [ ] 等待用户线上人工验收：周计划三个下拉、空新旧新增/编辑/内联/导入及其它新旧表。

### 数据库 Migration

- 无：相关字段已为 nullable，本任务不执行 migration。

### 当前已知问题

- Node 当前为 v22，项目声明目标为 v24；既有测试命令会显示 engine warning。

### 下一步

1. 用户完成线上人工验收后，按结果将本任务更新为 PASS 或记录 NO-GO。
2. 若验收发现问题，仅在本任务字段/选项范围内修复并重新验证。

## 当前任务：KDOS-UI-PAGE-SCROLL-STANDARD-001

任务目标：统一 KDOS 标准业务页面标题/说明与表格滚动规范；标准表默认由页面承担纵向滚动、表格保留横向滚动。

当前状态：已完成（用户生产人工验收 PASS）。

开始 HEAD：`436fdb7354b7ff322ae74951ea8b94e229991e36`

结束 HEAD：`eb2f37b9c3343cd7b25d8cb7168ab28397df3269`

最后更新时间：2026-09-29

### 当前阶段

当前阶段：标准页面与公共表格滚动规范交付

当前子任务：用户已完成生产人工验收，本任务正式关闭；后续不再修改滚动代码。

### 已完成

- [x] 已读取项目规范、架构、安全、运行手册和 `kdos-form-platform` Skill；确认工作区未知源码修改不存在。
- [x] 已删除项目管理大屏、员工待办大屏、责任人任务完成报表主体中的重复标题和用途副标题；保留导航/顶部页面身份。
- [x] 已确认双纵向滚动根因：页面 `.content` 滚动与 `KdosDataTable` 默认 `scroll.y` 同时存在。
- [x] `KdosDataTable` 标准模式默认不再创建内部纵向滚动，仅保留横向 `scroll.x`；新增显式 `internalVerticalScroll` 例外。
- [x] 已移除主计划、设备、数据中心、营销、人力、组织、基础数据、通讯录等标准表的显式 `scroll.y`；用户/角色管理固定嵌入成员表保留显式内部滚动。
- [x] 已调整标准表 shell，避免默认 `height:100% + overflow:hidden` 截断页面内容；内部滚动例外保持固定 viewport。
- [x] 已将页面标题/说明和标准业务表滚动规则写入 `.agents/skills/kdos-form-platform/SKILL.md`。
- [x] 提交：`90d2bc70f1071b37e500a4bf76e915aaaff95b35`，消息为 `fix(KDOS-UI-PAGE-SCROLL-STANDARD-001): unify page content and table scrolling`。
- [x] 定向测试：4 files / 26 tests 通过；Web 全量：26 files / 158 tests 通过；typecheck、lint、build 通过。
- [x] 备份：`data/backups/*_20260928_182704.*`，数据库 dump 文件格式、上传 tar 可读性和 SHA256 已核验。
- [x] 正式 `./scripts/deploy.sh all` 成功；`./scripts/deploy.sh check` 为 Repository/Web/API=`90d2bc7`、`STATUS=CONSISTENT`。
- [x] API/Web/Postgres healthy；PostgreSQL 未重建；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`；部署后 API 日志无相关错误。
- [x] 上一轮曾怀疑全局 `.ant-table-wrapper { overflow: hidden }` 约束 rc-table sticky holder；本轮真实 Chrome 复验确认该因素并非唯一根因，实际阻断来自非滚动 `.content` 的 `overflow:auto` sticky ancestor（详见本轮调查记录）。
- [x] 标准模式改为 `sticky={{ offsetHeader: 0 }}` 并仅对非 `internalVerticalScroll` 的 KDOS 表格解除 wrapper overflow 裁剪；未恢复 `scroll.y`，内部纵向滚动例外保持原行为。
- [x] 已将 sticky 表头、横向同步、fixed columns、编辑/下拉以及 `internalVerticalScroll` 例外规则补入 `kdos-form-platform` Skill。
- [x] 本轮提交：`aa479e23e65bf76d431baf978cc9376148a800a6`，消息为 `fix(ui): keep standard table headers sticky`。
- [x] 本轮定向测试：KdosDataTable 8 tests、KdosDataTable+Supervision 13 tests 通过；Web 全量 26 files / 158 tests 通过；typecheck、lint、build 通过。
- [x] 本轮备份：`data/backups/*_20260928_184734.*`；两个 PostgreSQL custom dump 经容器内 `pg_restore --list` 校验，上传 tar 可读。
- [x] 本轮正式 `./scripts/deploy.sh all` 成功；最终 `./scripts/deploy.sh check` 为 Repository/Web/API=`aa479e2`、`STATUS=CONSISTENT`。
- [x] 本轮部署后 API/Web/Postgres healthy；PostgreSQL 容器 ID 前后均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`；API 最近 10 分钟无 500/23514/constraint/error/exception 匹配项。
- [x] 用户人工验收确认单纵向滚动、横向同步、固定列、搜索、筛选、分页、编辑和弹层均正常，唯一失败为页面下滚后字段表头消失。
- [x] 已重新用真实 Chrome 调查：实际 vertical scroll owner 是 `window/document`；`.content` 的 `overflow:auto` 虽自身不滚动（`scrollHeight === clientHeight`），仍成为 sticky ancestor；`.ant-table-sticky-holder` 滚动前 `top=197`、`window.scrollY=500` 后 `top=-303`。上一轮仅解除 `.ant-table-wrapper` 裁剪并不足以修复。
- [x] 最终修复将 `.content` 改为 `overflow: visible`，使 sticky 绑定到实际的 window 页面滚动；`.ant-table-body` 仍为横向 `overflow-x:auto`、纵向 `overflow-y:hidden`。
- [x] 本轮提交：`eb2f37b9c3343cd7b25d8cb7168ab28397df3269`，消息为 `fix(ui): align table sticky headers with page scroll`；新增真实 Chrome sticky E2E。
- [x] 本轮定向测试：KdosDataTable 8 tests、KdosDataTable+Supervision 13 tests、真实 Chrome E2E 1 test 通过；Web 全量第二次 26 files / 158 tests 通过（首次有既有 AdminWorkspace 时序超时，单独重跑通过）；typecheck、lint、build 通过。
- [x] 本轮备份：`data/backups/*_20260929_141749.*`；两个 PostgreSQL custom dump 经容器内 `pg_restore --list` 校验，上传 tar 可读。
- [x] 本轮正式 `./scripts/deploy.sh all` 成功；最终 `./scripts/deploy.sh check` 为 Repository/Web/API=`eb2f37b`、`STATUS=CONSISTENT`；指向生产 Web 容器的真实 Chrome E2E 1/1 通过。
- [x] 用户生产人工验收 PASS：页面右侧只有一个纵向滚动条，标准表无内部纵向滚动；sticky 表头、横向滚动、搜索、筛选、分页、编辑和弹层均正常。

### 正在进行

- [x] 完成页面规范、公共滚动层、测试、构建、备份和部署。
- [x] 使用授权账号完成线上人工验收，确认真实页面下滚后表头保持可见。

### 待完成

- [ ] 确认三个大屏无重复标题/副标题，页面直接进入筛选、KPI、图表或表格。
- [x] 用户已确认标准表右侧只有页面纵向滚动条，宽表横向滚动、搜索、筛选、分页、编辑和弹层保持正常。
- [x] 用户确认本轮修复后的 sticky 表头。

### 修改文件

- `.agents/skills/kdos-form-platform/SKILL.md`
- `apps/web/src/shared/KdosDataTable.tsx`
- `apps/web/src/shared/KdosDataTable.spec.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/modules/supervision/SupervisionPages.tsx`
- `apps/web/src/modules/supervision/SupervisionPages.spec.tsx`
- 标准表调用方：`App.tsx`、主计划、设备、数据中心、营销、人力、组织、开发请求、管理员页面
- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 无；未修改数据库 schema、业务数据或 inbound-allocation；未主动触发同步。

### 已运行测试

- 定向：KdosDataTable、监督大屏、筛选能力共 4 files / 26 tests passed。
- Web 全量：26 files / 158 tests passed；首次并发运行有 1 个既有 AdminWorkspace 时序超时，单独重跑和第二次全量均通过。
- Web typecheck：PASS。
- Web lint：PASS，保留既有 Fast Refresh warning。
- Web build：PASS，保留既有大 chunk warning。

### 当前已知问题

- 上一项滚动规范任务已由用户生产人工验收确认 PASS；本节不再有该任务遗留阻塞。
- Node 运行环境为 v22，项目目标为 Node 24；测试、类型检查、lint 和 build 均已通过。
- 真实 Chrome 已验证部署 bundle 的 scroll owner、sticky holder 实际位置和横向滚动容器；仍不能替代用户对真实业务账号和实际数据的最终视觉确认。

### 下一步

1. 本任务已完成；后续不再修改滚动代码。

## 当前任务：KDOS-PROJECT-TASK-UX-PERM-001

任务目标：修复项目与任务模块导航、权限、表格编辑、甘特图体验，并补齐标准业务表统一导出；完成后最多恢复一个真实未完成的 Roadmap TASK。

当前状态：等待人工验收（本轮两个线上 UI 失败项已修复、验证并部署；尚未重新人工确认）。

开始 HEAD：`f91470b84ef761295187b72898d990d2cc832200`

结束 HEAD：`436fdb7354b7ff322ae74951ea8b94e229991e36`

最后更新时间：2026-09-28

### 当前阶段

当前阶段：项目/任务 UX 最终线上验收

当前子任务：修复重复大标题与甘特图 ISO 日期显示，完成 Web 回归、备份、正式部署；等待用户再次人工验收。

### 已完成

- [x] 已读取项目规范、`kdos-form-platform` 技能与实际 roadmap；roadmap 已被 Git 跟踪。
- [x] 已移除项目/任务标准页长期解释性副标题，并将“标准页不自动增加说明文字”写入平台技能规则。
- [x] 已基于统一 `TableFilterRegistry`/打印取数框架增加 XLSX 导出；项目 `supervision-projects` 与任务 `supervision-tasks` 共用平台入口。
- [x] 导出后端强制校验 export/read、字段权限、租户、数据范围、搜索、筛选、排序和全部匹配记录；排除操作列并解析成员、部门、字典和日期展示值。
- [x] 业务代码提交：`c5fefa3`；Roadmap/TASK-001 独立提交：`f91470b`。
- [x] TASK-001 已完成：新增 `packages/ui-schema`，提供 Field/Option/Form/Detail/Table/Resource Schema、结构校验辅助函数与督办任务 Schema 测试；未启动 TASK-002。
- [x] API 专项：2 suites / 21 tests；Web 专项：3 files / 24 tests；ui-schema：2 tests，均通过。
- [x] API 全量：71 suites / 560 tests 通过，1 suite / 1 test 既有 skip；Web 全量复跑：26 files / 155 tests 通过。
- [x] API/Web/全 workspace typecheck、lint、build 通过；保留既有 Web Fast Refresh warning 和大 chunk warning。
- [x] 生产备份：`data/backups/*_20260928_112045.*`，pg_restore/tar 可读，SHA256 已核验：主库 `2c91d5...`、KDOS `80c904...`、uploads `089222...`。
- [x] 第三次正式 `./scripts/deploy.sh all` 成功；最终 `./scripts/deploy.sh check` 为 Repository/Web/API=`f91470b`、`STATUS=CONSISTENT`。
- [x] 部署前后 PostgreSQL 容器 ID 均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`，未重建；API/Web/Postgres 均 healthy。
- [x] Dispatcher=`active`；数据库只读确认 `inbound-allocation=true`、状态 `SUCCESS`；未主动触发主计划同步。
- [x] 数据库无本轮 migration；业务数据未修改。目标设备状态记录已存在，且 `KN-020YK005 / 2026-09-26` 的 planned/runtime/fault 均为 `0`，未重复创建或导入。
- [x] 部署后 API 最近 10 分钟日志无 `500`、`23514`、目标 constraint 或 error/exception 匹配项。
- [x] 上次真实线上人工验收已确认：首页角色身份隐藏、导航提升、说明文字移除、项目/任务编辑和导出均通过；仅发现标准页重复大标题与甘特图 ISO 时间戳两项失败。
- [x] 已移除 `SupervisionProjectsPage` 与 `SupervisionTasksPage` 主体中重复的“项目管理/任务管理”大标题；保留左侧导航和仪表盘标题层级。
- [x] 已将甘特图日期范围、风险卡片交付日期、任务交付日期提示及相关日期列统一改用 `formatDateOnly`/`formatDateRange`，避免时区转换和 ISO 时间泄露。
- [x] 已将“左侧导航已明确身份时不重复显示同名主体大标题”写入 `.agents/skills/kdos-form-platform/SKILL.md`。
- [x] 本轮修复提交：`436fdb7354b7ff322ae74951ea8b94e229991e36`。
- [x] 本轮定向测试：2 files / 7 tests 通过；Web 全量：26 files / 156 tests 通过；typecheck、lint、build 通过。
- [x] 本轮备份：`data/backups/*_20260928_155204.*`；数据库 custom dump、上传 tar 均存在且已校验文件格式与 SHA256。
- [x] 本轮正式 `./scripts/deploy.sh all` 成功；最终 `./scripts/deploy.sh check` 为 Repository/Web/API=`436fdb7`、`STATUS=CONSISTENT`。
- [x] 本轮部署后 API/Web/Postgres healthy；PostgreSQL 容器 ID 未变；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`；API 最近 10 分钟无相关错误。

### 正在进行

- [x] 完成实现、提交、备份、部署与自动化验证。
- [ ] 使用授权账号重新完成项目/任务页面人工验收，重点确认主体不再重复显示同名大标题、甘特图显示 `2026-09-21 → 2026-09-30` 且风险显示 `交付 2026-09-30`。

### 待完成

- [x] 当前代码与 Roadmap 交付已完成。
- [ ] 线上人工复验；完成前保持“等待人工验收”，不得提前标记 PASS。

### 修改文件

- `apps/api/src/common/filtering/table-filter.module.ts`
- `apps/api/src/common/filtering/table-filter.registry.ts`
- `apps/api/src/common/printing/table-export.controller.ts`
- `apps/api/src/common/printing/table-print.service.ts`
- `apps/api/src/common/printing/table-print.service.spec.ts`
- `apps/api/src/modules/supervision/supervision.filter-sources.ts`
- `apps/web/src/shared/table-export.ts`
- `apps/web/src/shared/KdosDataTable.tsx`
- `apps/web/src/shared/KdosDataTable.spec.tsx`
- `apps/web/src/modules/supervision/SupervisionPages.tsx`
- `apps/web/src/modules/supervision/SupervisionPages.spec.tsx`
- `.agents/skills/kdos-form-platform/SKILL.md`
- `packages/ui-schema/*`
- `docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md`
- `pnpm-lock.yaml`
- `apps/web/src/shared/date-format.ts`
- `apps/web/src/shared/date-format.spec.ts`
- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 本轮无新 migration、无 schema 变更、无业务数据写入；正式部署使用 `--no-deps`，PostgreSQL 未重建。

### 新增或修改测试

- 标准导出覆盖 export 权限、API 拒绝、搜索/筛选/排序继承、全部匹配记录、字段权限和 XLSX 列输出。
- 项目/任务页覆盖副标题移除、只读、字段权限、自动保存和失败回滚。
- 项目/任务页覆盖标准页同名主体标题不渲染；项目大屏覆盖 ISO 日期范围、风险交付日期格式和 ISO 字符串不泄露。
- `@kdos/ui-schema` 覆盖督办任务主要字段 Schema 与非法结构校验。

### 已运行测试

- `pnpm test`：API 71 suites / 560 tests passed（1 skip）；Web 首次全量有 1 个既有 AdminWorkspace 超时，单独复跑 8/8 通过；随后 Web 全量 26 files / 155 tests passed；其他 workspace 均通过。
- `pnpm typecheck`：PASS；`pnpm lint`：PASS（1 条既有 warning）；`pnpm build`：PASS（既有大 chunk warning）。
- `./scripts/deploy.sh all`：最终 PASS；此前两次仅因 npm registry 网络超时失败，未切换容器。
- 最终 `./scripts/deploy.sh check`：Repository/Web/API=`f91470b`，`STATUS=CONSISTENT`。
- `docker compose ps`：API/Web/Postgres healthy；Dispatcher active；`inbound-allocation=true`。
- API 日志：部署后无新的 500/23514/目标 constraint/error/exception。
- 本轮 `./scripts/deploy.sh all`：PASS；本轮 `./scripts/deploy.sh check`：Repository/Web/API=`436fdb7`，`STATUS=CONSISTENT`。

### 当前已知问题

- 当前仅等待用户重新进行线上人工验收；自动化、备份、正式部署和运行检查均已完成，未代替用户将其判定为 PASS。
- `TASK-002 KdosSchemaForm` 仍为 Roadmap 下一推荐任务。

### 下一步

1. 通过正常 UI 重新验收项目/任务页面，重点确认两个本轮修复项。
2. 将人工复验结果补入本进度文件；在验收完成前不将本任务标记 PASS。

## 当前任务：KN-EQUIP-STATUS-ZERO-RUNTIME-001

任务目标：修复设备状态导入计划运行时间为 0 时预览通过但确认写入被 PostgreSQL 约束拒绝的问题，并让确认失败在导入预览 Modal 内持续可见。

当前状态：migration 与正式部署完成；真实 planned=0 导入验收因缺少用户原始 Excel 未执行，整体仍为 NO-GO。

开始 HEAD：`29453bf3b48d2f1a87f88e660da353c88eb711d6`

最后更新时间：2026-09-28

### 当前阶段

当前阶段：生产验收收尾

当前子任务：等待用户提供原始设备状态 Excel 后完成一次真实 planned=0 导入验收。

### 已完成

- [x] 已读取项目规范、架构/安全文档、运行手册、集成说明和 KDOS 表单技能规范。
- [x] 已完成 Git 预检：分支 `main`；HEAD=`29453bf3b48d2f1a87f88e660da353c88eb711d6`。
- [x] 已确认工作区既有修改只有 `outputs/CODEX_PROGRESS.md`，另有未跟踪的任务范围外文档 `docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md`，未覆盖、未删除、未提交。
- [x] 已确认 API/Web/PostgreSQL 当前容器健康；PostgreSQL 容器 ID=`ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`。
- [x] 已只读确认生产约束为 `planned_runtime_minutes IS NULL OR planned_runtime_minutes > 0`。
- [x] 已只读确认设备状态数据分布：NULL 1741、正数 908、零 0、负数 0；未执行任何业务数据写入。
- [x] 已确认旧 migration `EquipmentStatusPlannedRuntimeMinutes1722920066000` 已执行，当前最大 migration 编号为 `1722920073000`。
- [x] 已确认应用层 `requiredMinutes`、导入 duration、`saveStatus` 已允许 0；稼动率对计划时间 0 的既有语义为 NULL，不在本任务修改。
- [x] 继续执行预检：当前 HEAD=`c3844e6f2db16130e191db858bb8d51c9c55632c`，`bae69b1` ancestry 成功，roadmap 已由 `c3844e6` 跟踪，只有 outputs 记录未提交。
- [x] `deploy.sh check` 显示生产基线仍为 `29453bf`，待本次部署更新；无未知工作区文件。
- [x] 迁移前只读核验：旧约束、migration 未执行、数据分布 NULL=1741/0=0/>0=908/<0=0；目标设备日期记录不存在。
- [x] 备份 `20260928_090229` 三份文件存在、可读、SHA256 与原记录一致，PostgreSQL dump 可由 `pg_restore --list` 读取。
- [x] 正式 TypeORM migration 执行成功，migration 记录为 id=75；约束已变为 `NULL OR >= 0`。
- [x] `./scripts/deploy.sh all` 成功；随后 `./scripts/deploy.sh check` 判定 Repository/Web/API 均为 `c3844e6`、`STATUS=CONSISTENT`。
- [x] 部署后 API/Web/PostgreSQL healthy；PostgreSQL 容器 ID 前后均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`，未重建。
- [x] 部署后 Dispatcher=`active`、`inbound-allocation=true`；API 重启后的日志无新的 constraint/500/23514 错误。
- [x] 部署后只读数据复核仍为 NULL=1741/0=0/>0=908/<0=0，目标记录仍不存在。

### 正在进行

- [x] 新增 allow-zero migration，并补充应用/导入/迁移测试。
- [x] 在设备状态导入预览 Modal 增加确认失败持久 Alert 和清理时机。

### 待完成

- [x] 运行设备专项、API/Web 全量测试、typecheck、lint、build。
- [x] 生产备份；迁移前只读校验约束与数据未变化。
- [x] 提交修复；roadmap 已由用户提交，未绕过保护机制。
- [ ] 使用用户原始 Excel 完成目标记录的真实 planned=0 导入验收。

### 修改文件

- `outputs/CODEX_PROGRESS.md`
- `apps/api/src/migrations/1722920074000-EquipmentStatusPlannedRuntimeAllowZero.ts`
- `apps/api/src/modules/equipment/equipment-status-runtime.migration.spec.ts`
- `apps/api/src/modules/equipment/equipment.spec.ts`
- `apps/web/src/modules/equipment/EquipmentPages.tsx`
- `apps/web/src/modules/equipment/EquipmentPages.spec.tsx`

### 数据库 Migration

- 新增：`1722920074000-EquipmentStatusPlannedRuntimeAllowZero.ts`；UP 保留约束名并改为 `NULL OR >= 0`，不回填、不修改现有数据。
- 尚未执行生产 migration；当前生产约束仍为 `NULL OR > 0`。

### 新增或修改测试

- 已补充：计划运行时间 0 的应用/预览/确认路径、迁移约束语义、确认失败 Alert 及重试/换文件清理。

### 已运行测试

- API 专项：设备测试与迁移测试共 2 suites / 21 tests 通过。
- Web 设备专项：确认失败持久 Alert、失败后重试、换文件清理及既有预览错误共 11 tests 通过（Node 22 环境，pnpm 提示项目目标 Node 24）。
- API 全量：71 suites / 557 tests 通过，1 suite/1 test 既有 skip。
- Web 全量：25 files / 148 tests 通过。
- API/Web typecheck：通过；API/Web lint：0 error，Web 保留 1 条既有 Fast Refresh warning。
- Monorepo build：15 个工作区构建通过；Web 仅有既有大 chunk warning。
- `git diff --check`：通过。
- 生产备份：`data/backups/*_20260928_090229.*`，三份均成功并生成 SHA256。
- 迁移前只读复核：约束为 `NULL OR > 0`；数据 NULL=1741、0=0、正数=908、负数=0。
- 迁移后只读复核：约束为 `NULL OR >= 0`；migration id=75；数据计数未变化。
- 正式部署与复核：Repository/Web/API=`c3844e6`，`STATUS=CONSISTENT`。
- 真实 planned=0 导入：未执行；当前未找到用户原始设备状态 Excel，未生成或伪造业务文件。

### 当前已知问题

- 真实 planned=0 导入验收仍待用户提供原始 Excel；不能用其他出货 Excel 或人工生成文件替代。

### 等待用户确认

- 需要提供或配置一个可安全使用的授权账号，以完成线上 UI 实际操作验收；不需要提供密码给进度文件或最终报告。

### 下一步

1. 用户提供本次实际失败的设备状态 Excel。
2. 通过正常 UI 完成一次上传→预览→确认导入，并核验目标记录 planned/runtime/fault 均为 0。
3. 保留当前已完成的 migration、部署和日志核验结果，最终将本任务标记 PASS。

### 本阶段最终报告

- 结果：NO-GO（migration、部署和运行环境核验完成，真实 planned=0 导入验收缺少原始 Excel）。
- 开始 HEAD：`29453bf3b48d2f1a87f88e660da353c88eb711d6`。
- 结束 HEAD：`bae69b1fc323e9caeee106f109abd2d9092e2219`。
- Commit：`bae69b1 fix(KN-EQUIP-STATUS-ZERO-RUNTIME-001): allow zero planned runtime`。
- 生产 PostgreSQL 容器：`ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`，健康且未重建；Dispatcher=`active`。
- 新 migration：已执行并记录 id=75；旧 migration 未修改；业务数据未修改。
- 备份：`20260928_090229`，legacy/KDOS/uploads 均已成功备份并校验。
- Web/API SHA：均为 `c3844e6`，deploy check=`CONSISTENT`。
- 当前运行基线：API/Web/PostgreSQL 均 healthy，本任务已上线。
- 只读安全复核：`inbound-allocation`=`true`；Dispatcher=`active`；API 重启后的日志无新的 constraint/500/23514 错误。
- planned=0 实际验收：未执行，目标记录不存在且未提供原始 Excel。

---

## 当前任务：SUPERVISION-FORM-USABILITY-002

任务目标：为督办项目/任务表单显示必填红色星号，移除项目与任务的“紧急”优先级，并将任务管理页的权限管理入口收敛为一个。

当前状态：已完成；最终修正、完整回归、备份、migration、部署与线上核验均已完成。

最后更新时间：2026-09-27

### 当前阶段

当前阶段：交付完成

当前子任务：无。

### 已完成

- [x] 已阅读当前适用的项目规范、KDOS 表单与权限规范和已有进度记录。
- [x] 已确认创建项目、创建任务及任务操作表单通过 `requiredMark={false}` 主动隐藏了必填标识。
- [x] 已确认“紧急”来自共享督办优先级字典，但服务端另有一份允许值集合，需要同步收紧。
- [x] 已确认 `KdosDataTable` 已自动提供当前任务表的权限管理入口，任务工具栏又额外提供了任务进展权限入口，造成两个同名按钮。
- [x] 已只读核对当前线上数据：督办项目/任务不存在 `URGENT` 存量记录，无需迁移业务数据。
- [x] 已恢复督办创建/编辑和任务操作表单的默认必填红色星号。
- [x] 已从共享督办优先级字典移除“紧急”，服务端校验直接派生该共享字典并拒绝 `URGENT`。
- [x] 已移除任务管理工具栏中额外的任务进展权限入口，仅保留 `KdosDataTable` 自带的任务权限入口。
- [x] 已补充共享字典契约测试和项目/任务拒绝 `URGENT` 的服务端测试。
- [x] 最终复核确认项目“督办人”不在用户指定的必填清单内，但旧实现仍要求必填；已纳入本次修正。
- [x] 已确认 Web Dockerfile 在依赖安装前注入 Git SHA，导致每次提交都让依赖层缓存失效；外部镜像源连续超时后部署无法完成但未切换线上容器。
- [x] 已将 SHA 注入移动到 Web 编译阶段，并为 pnpm store 增加 BuildKit 缓存，避免后续提交重复下载全部依赖。

### 正在进行

- 无。

### 待完成

- [x] 运行专项测试、lint、typecheck、全量测试和构建。
- [x] 备份、提交、部署当前运行环境并执行健康检查和线上效果核验。
- [x] 执行 `SupervisionFormUsability1722920073000` 并核验数据库列与约束。
- [x] 修复 Web 镜像依赖缓存，完成最终 Web/API 切换与三方 SHA 一致性检查。

### 修改文件

- `apps/api/src/modules/supervision/supervision.application.service.spec.ts`
- `apps/api/src/modules/supervision/supervision.application.service.ts`
- `apps/api/src/modules/supervision/supervision.migration.spec.ts`
- `apps/api/src/migrations/1722920073000-SupervisionFormUsability.ts`
- `apps/api/src/entities.ts`
- `apps/api/src/modules/supervision/supervision.types.ts`
- `apps/web/src/modules/supervision/SupervisionPages.tsx`
- `apps/web/Dockerfile`
- `packages/contracts/src/index.test.ts`
- `packages/contracts/src/index.ts`
- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 新增 `1722920073000-SupervisionFormUsability`：项目督办人改为可空；项目/任务数据库优先级约束移除 `URGENT`。当前线上不存在 `URGENT` 存量记录。

### 新增或修改测试

- 督办共享优先级字典固定为高/中/低。
- 督办项目与任务 Application Service 均拒绝已移除的 `URGENT`。
- 项目督办人可以留空。
- 表单易用性 migration 将督办人改为可空，并从数据库约束移除 `URGENT`。

### 已运行测试

- Contracts：1 file / 21 tests 通过。
- 督办 Application Service 专项：1 suite / 11 tests 通过。
- 最终专项：Application Service + migration 共 2 suites / 15 tests 通过。
- Contracts、API、Web typecheck：通过。
- Contracts、API、Web lint：通过；Web 仅有 1 条既有 Fast Refresh warning。
- API 最终全量：70 suites / 554 tests 通过，1 项既有 skip。
- Web 全量：25 files / 146 tests 通过。
- `pnpm build`：15 个工作区构建通过；Web 仅有既有大 chunk 提示。
- `git diff --check`：通过。
- 上线前备份：`data/backups/*_20260927_154945.*`，三份备份均已生成 SHA256。
- 最终生产部署：Repository / Web / API 均为 `29453bf`，部署脚本判定 `CONSISTENT`。
- 线上健康检查：API、Web、PostgreSQL 容器均为 healthy，`/api/v1/health` 返回 `status=ok`。
- 线上资源核验：加载的 `index-WbeUmHSv.js` 包含督办项目/任务页面、高/中/低优先级字典及可清空的非必填督办人字段。
- 最终修正首次部署构建：API 新镜像成功；Web 依赖下载至 1078/1081 后因外部 registry timeout 失败，未执行 migration 或切换，线上 `18b0329` 保持健康。
- 最终数据库核验：`supervision_projects.supervisor_id` 为 nullable；项目/任务 priority CHECK 均只包含 `HIGH/MEDIUM/LOW`；migration 记录存在。
- 最终健康检查：API、Web、PostgreSQL 容器均为 healthy，API health 返回 `status=ok`。
- 最终上线前备份：`data/backups/*_20260927_161326.*`，三份备份均已生成 SHA256。

### 当前已知问题

- 无。

### 等待用户确认

- 无。

### 下一步

1. 无。

### 最终报告

- 功能提交：`18b0329 fix(supervision): clarify required fields and priorities`
- 必填清单修正：`45a602d fix(supervision): align supervisor requirement`
- 部署缓存修正：`29453bf build(web): preserve dependency cache across versions`
- 备份：`data/backups/*_20260927_161326.*`
- Migration：`SupervisionFormUsability1722920073000` 已执行。
- 线上版本：Repository / Web / API 均为 `29453bf`。

---

## 当前任务：SUPERVISION-CREATION-FIELDS-001

任务目标：调整创建督办项目/任务的字段、必填规则、字段名称及交付/进度记录，并完成当前运行环境部署核验。

当前状态：已完成；已迁移并部署至当前运行环境，健康检查和线上资源核验通过。

最后更新时间：2026-09-27

### 当前阶段

当前阶段：交付完成

当前子任务：无

### 已完成

- [x] 已阅读项目规范、架构/安全边界、运行手册、集成说明及 KDOS 表单规范。
- [x] 已确认项目“当前进度”原本就是由非中止子任务进度平均值实时派生。
- [x] 已增加项目描述、实际交付日期的实体/字段契约与筛选投影。
- [x] 已将主责部门、参与人、预计交付日期和当前进度名称同步到创建表单及主要列表。
- [x] 已将项目描述、来源类型、主责部门、参与人、任务说明、计划开始日期及创建任务当前进度纳入服务端必填校验。
- [x] 已禁止直接写入项目当前进度；项目进度继续由未中止子任务的当前进度平均值派生。
- [x] 已为已有权限组回填项目描述、项目/任务实际交付日期字段权限。
- [x] 已通过备份、TypeORM migration、API/Web 重建、版本一致性及线上静态资源字段核验完成上线。

### 正在进行

- 无。

### 待完成

- 无。

### 修改文件

- `apps/api/src/entities.ts`
- `apps/api/src/migrations/1722920072000-SupervisionRequiredCreationFields.ts`
- `apps/api/src/modules/supervision/supervision.application.service.ts`
- `apps/api/src/modules/supervision/supervision.filter-sources.ts`
- `apps/api/src/modules/supervision/supervision.scope.ts`
- `apps/api/src/modules/supervision/supervision.types.ts`
- `apps/web/src/modules/supervision/SupervisionPages.tsx`
- `packages/contracts/src/index.ts`
- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 已执行：`1722920072000-SupervisionRequiredCreationFields`，为督办项目新增 `project_description`、项目/任务新增 `actual_delivery_date`。历史记录不伪造业务描述或组织归属；新建记录由 Application Service 严格校验必填字段。

### 新增或修改测试

- 督办迁移、创建任务当前进度、项目进度不可直接写入和筛选注册表装配测试。

### 已运行测试

- 督办专项 API 测试：4 suites / 20 tests 通过。
- API 全量测试：70 suites / 551 tests 通过，1 项既有 skip。
- Web 全量测试：25 files / 146 tests 通过。
- API 与 Web typecheck：通过。
- `pnpm build`：通过（仅现有大体积 chunk 提示）。
- `git diff --check`：通过。
- 线上：备份、迁移、API/Web 健康检查、三方 SHA 一致性与前端字段资源核验均通过。

### 当前已知问题

- 存量记录可能没有新启用的必填字段，已按历史兼容原则保留为空；后续新建/修改必须由服务端补齐。

### 等待用户确认

- 无。

### 下一步

1. 后续如需编辑历史督办记录，补齐其新必填字段。

### 最终报告

- 提交：`f648804 feat(supervision): complete project and task creation fields`
- 备份：`data/backups/*_20260927_122723.*`
- 线上版本：Repository / Web / API 均为 `f648804`。

---

## 当前任务：KDOS-DEPLOY-VERSION-GUARD-001

任务目标：让 Web/API 在构建时内嵌完整与短 Git SHA，Web 页面和机器可读端点可查看版本，并用统一部署脚本保证 Repository HEAD、Web SHA、API SHA 一致。

当前状态：待部署；代码、文档、专项/全量测试和生产构建完成，提交前审查通过。

最后更新时间：2026-09-24

### 当前阶段

当前阶段：全量验证、提交与生产部署

当前子任务：提交代码，记录生产基线并备份，再使用新脚本部署。

### 已完成

- [x] 预检 HEAD=`ce1ed0adca0593c69ccd0263ccb12c8e399c205f`；三个历史基线均为祖先；工作区仅已有 `outputs/CODEX_PROGRESS.md` 记录修改。
- [x] 确认 API health 路径为 `/api/v1/health`，当前返回 `status` 与 `timestamp`。
- [x] 确认 Web 使用 Vite 构建，已有时间戳 `buildId`、`version.json` 与前台自动刷新机制。
- [x] 确认 API/Web Docker build context 均为项目根目录，当前镜像未内嵌 Git SHA。
- [x] 确认现有部署公共入口为 `scripts/deploy-common.sh`，尚无 Web/API SHA 一致性检查脚本。
- [x] API health 保留 `status`、`timestamp` 并增加 `{ version: { commit, shortCommit } }`，无合法构建变量时安全回退 `unknown`。
- [x] Web 构建复用既有 `version.json/buildId`，增加内嵌 SHA、`/build-info.json`、登录卡片及 Portal 页脚短 SHA 展示。
- [x] API/Web Dockerfile 与 Compose 支持 `KDOS_BUILD_SHA` build arg，不复制 `.git`，不在运行时调用 git。
- [x] 新增 `scripts/deploy.sh`，支持 `web/api/all/check`、服务健康等待、三方版本比较和源码/配置脏工作区阻断。
- [x] 更新 `docs/runbook.md`，明确标准部署入口及“Git 更新 != 运行容器更新”。

### 正在进行

- [ ] 最终 diff 审查、提交、备份和生产部署。

### 待完成

- [x] 增加 API/Web 测试并运行专项测试、typecheck、shell syntax 与脏工作区负向检查。
- [x] 运行 lint、全量 test 和 build。
- [ ] 更新 runbook，提交代码，记录 PostgreSQL 容器 ID并备份。
- [ ] 使用新脚本执行 `deploy all`，验证三方 SHA 一致、容器健康、PostgreSQL 未重建、Dispatcher 仍 active。

### 修改文件

- `apps/api/Dockerfile`
- `apps/api/src/build-version.ts`
- `apps/api/src/build-version.spec.ts`
- `apps/api/src/controllers.ts`
- `apps/api/src/system.e2e.spec.ts`
- `apps/web/Dockerfile`
- `apps/web/nginx.conf`
- `apps/web/src/App.tsx`
- `apps/web/src/main.tsx`
- `apps/web/src/modules/portal/ModulePortal.tsx`
- `apps/web/src/shared/BuildVersion.tsx`
- `apps/web/src/shared/BuildVersion.spec.tsx`
- `apps/web/src/shared/build-version.ts`
- `apps/web/src/styles.css`
- `apps/web/vite.config.ts`
- `compose.yaml`
- `docs/runbook.md`
- `scripts/deploy.sh`
- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 无。

### 新增或修改测试

- API build version 规范化和 `unknown` 回退单元测试。
- API health 有 SHA/无 SHA 集成测试。
- Web build version helper、短 SHA/title 展示和 `unknown` 回退组件测试。

### 已运行测试

- `bash -n scripts/deploy.sh`：通过；当前源码未提交时 `./scripts/deploy.sh check` 被脏工作区保护正确拒绝并返回非 0。
- shellcheck：环境未安装，未执行。
- API 定向测试：2 suites / 7 tests 通过。
- Web 新增版本测试：3 tests 通过（所在 Web 测试运行中也已通过）。
- API typecheck：通过。
- Web typecheck：通过。
- API lint：通过，0 error / 0 warning。
- Web lint：通过，0 error；仅保留 `ModulePortal.tsx` 的 1 条既有 Fast Refresh warning，本任务新增 warning 已清零。
- API 全量测试：65 suites / 526 tests 通过，1 项既有测试 skip。
- Web 全量测试：25 files / 146 tests 通过。
- Monorepo `pnpm build`：15 个 workspace 项目构建通过；Web 仅有既有大 chunk 提示。
- Web 注入构建检查：以合法完整 SHA 构建后，`dist/build-info.json` 的 `commit` 和 `shortCommit` 均符合预期。
- Compose 配置解析和 `git diff --check`：通过。

### 当前已知问题

- 现有线上 Web/API 镜像未嵌入 Git SHA，当前只能以新机制部署后建立可信一致性基线。

### 等待用户确认

- 无。

### 下一步

1. 提交并确认工作区 clean。
2. 记录 PostgreSQL 容器 ID并执行升级备份。
3. 用新脚本 `deploy all` 正式部署并验收。

---

## 当前任务：KDOS-DISPATCHER-SERVICE-VERIFY-001

任务目标：核查通知 Dispatcher 的常驻启动机制，确认单实例、开机自启、异常自动恢复和日志可查；完成 inbound-allocation PASS 收口，不修改通知业务逻辑或数据库业务数据。

当前状态：PASS；现有 user-systemd 正式服务已完成单实例、开机自启、自动恢复和日志核验。

最后更新时间：2026-09-24

### 当前阶段

当前阶段：正式服务只读核查与受控恢复验收

当前子任务：完成最终报告并保留服务运行。

### 已完成

- [x] HEAD=`ce1ed0adca0593c69ccd0263ccb12c8e399c205f`；三个必要历史基线均为祖先；工作区仅有允许识别的 `outputs/CODEX_PROGRESS.md` 修改。
- [x] inbound-allocation 只读收口：`enabled=true`、`interval_minutes=30`；03:00 `SCHEDULED SUCCESS` 448 条，03:30 `SCHEDULED SUCCESS` 0 条。
- [x] inbound-allocation 全量对账：1169 条周计划，`mismatch_count=0`、`current_data_anomaly_count=0`、`allocated_difference_total=0`、`pending_difference_total=0`。
- [x] 重点订单：2026A027330 / GFY167SG-1/1 为 planned=200、inbound=200、allocated=200、pending=0；GFY371SG-1/1 为 planned=50、inbound=48、allocated=48、pending=2。
- [x] Dispatcher 当前唯一 PID=2071，PPID=1792，运行用户 Jerry；进程 cgroup 明确属于 user-systemd 的 `kdos-notification-dispatcher.service`。
- [x] user-systemd unit 已启用且 active；`Restart=always`、`RestartSec=5s`；EnvironmentFile 仅记录为项目 `.env` 路径，未输出内容。
- [x] 最近 journald 持续 `claimed=0,sent=0,failed=0,skipped=0`，精确错误扫描未发现 401/403、traceback 或异常。
- [x] 受控 TERM 验证：旧 PID 2071 优雅退出，5 秒后自动恢复为 PID 160248；恢复期间无第二实例，`NRestarts=1`。
- [x] `Linger=yes`、`systemctl --user is-enabled=enabled`、`is-active=active`；user-systemd unit 语法校验通过。
- [x] `/data/automation/code/work/basci/basic_code/.env` 权限收紧为 600；未读取、输出或修改凭据内容。

### 正在进行

- [x] 受控 TERM 后确认 PID 变化、服务自动恢复 active 且仍只有一个 Dispatcher。

### 待完成

- [x] 完成受控自动恢复验证并记录最终状态。
- [x] 更新本任务最终 PASS 结论。

### 修改文件

- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 无。

### 新增或修改测试

- 无；本任务仅核查既有 Dispatcher 和服务配置。

### 已运行测试

- 生产只读配置、同步日志、全量对账和重点订单核验通过。
- Dispatcher 进程、cgroup、user-systemd 状态、unit 配置和 journald 只读核验通过。

### 当前已知问题

- 系统级 `systemctl` 查不到同名 service；正式服务是当前用户的 `systemd --user` unit，且已确认 `Linger=yes`，因此具备用户级开机持久性。

### 等待用户确认

- 无。

### 下一步

1. 通过 `systemctl --user kill --signal=TERM` 做一次受控恢复测试。
2. 检查服务状态、PID/cgroup、单实例和 journald。
3. 写入最终 PASS/NO-GO 报告。

### 最终报告

KDOS-DISPATCHER-SERVICE-VERIFY-001：PASS

1. 当前 HEAD：`ce1ed0adca0593c69ccd0263ccb12c8e399c205f`
2. 工作区状态：仅 `outputs/CODEX_PROGRESS.md` 有任务记录修改；未修改源码。另将外部适配器 `.env` 权限从 644 收紧为 600，未改内容。
3. inbound-allocation：PASS。`enabled=true`、间隔 30 分钟；03:00 SCHEDULED SUCCESS=448，03:30 SCHEDULED SUCCESS=0；1169 条全量对账 mismatch/anomaly/allocated difference/pending difference 均为 0。重点订单为 GFY167 `200/200/200/0`，GFY371 `50/48/48/2`。
4. Dispatcher 原启动方式：`user-systemd`，不是 shell/nohup；PID 2071 的 cgroup 已明确归属该 unit。
5. 原 PID / PPID：`2071 / 1792`。
6. 正式守护机制：已存在，未创建第二套服务。
7. 是否创建 systemd service：否；复用现有 user-systemd unit。
8. unit 名称：`kdos-notification-dispatcher.service`。
9. 运行用户：Jerry。
10. Python interpreter：`/data/automation/code/work/basci/basic_code/.venv/bin/python`。
11. dispatcher.py：`automation/wechat_push_projects/kdos-notification-dispatcher/dispatcher.py`。
12. WorkingDirectory：`/data/automation/code/work/PMC/knweb`。
13. EnvironmentFile：`/data/automation/code/work/PMC/knweb/.env`；未显示内容。企业微信适配器仍由 basic_code 自己加载其 `.env`。
14. is-enabled：`enabled`。
15. is-active：`active`。
16. 当前 PID：`160248`。
17. Dispatcher 实例数量：1。
18. 自动重启：受控 TERM 后 PID `2071→160248`，约 5 秒自动恢复 active，`NRestarts=1`。
19. journald：持续轮询，当前 `claimed=0,sent=0,failed=0,skipped=0`；无高频重启。
20. 401/403/traceback：最近日志精确扫描无匹配；API health、Compose API/Web/Postgres 均 healthy。
21. 是否修改源码：否；仅更新进度记录。
22. 是否修改数据库：否；未修改 notification outbox/delivery 状态。
23. 是否发送测试企业微信消息：否；未制造通知，当前无待发送事件。
24. 下一步建议：保持现有 user-systemd 服务运行；后续如需系统级 unit，应另行评估，不得与当前 unit 并行。

---

## 当前任务：KN-MPS-INBOUND-ALLOCATION-VERIFY-001

任务目标：在不修改源码、入库事实或自动同步开关的前提下，核对正式 inbound-allocation 实现，完成执行前只读影响评估与备份，并通过正式手工入口验证 2026A027330 / GFY167SG-1/1 的周计划欠数回写。

当前状态：PASS；后续生产只读核验确认正式自动同步和全量对账完成。

最后更新时间：2026-09-24

### 当前阶段

当前阶段：生产结果收口

当前子任务：记录已完成的正式 SCHEDULED 同步结果，不重复执行同步。

### 已完成

- [x] 读取任务说明、项目 AGENTS.md、ARCHITECTURE.md、SECURITY.md、docs/runbook.md 和 docs/integration-guide.md。
- [x] 确认工作区 clean，当前 HEAD 为 `ba597a3` 的后继。
- [x] 确认正式手工入口为 `POST /api/v1/master-plan-system/sync/:syncKey`，服务层 `manual()` 对 `enabled=false` 允许 MANUAL 执行。
- [x] 初步确认 inbound-allocation 使用 `UFTData418971_000003`，按订单号+品号汇总后按交期/交货号/ID 顺序分摊，并写入同步日志。
- [x] 生产配置确认：`KAINAN/inbound-allocation` 为 `enabled=true`、`status=SUCCESS`、`interval_minutes=30`，最近成功时间 `2026-09-24 03:30:34.820377+00`。
- [x] 已出现连续 SCHEDULED SUCCESS：03:00 同步 448 条，03:30 下一轮同步 0 条。
- [x] 全量正式算法对账：1169 条周计划，`mismatch_count=0`、`current_data_anomaly_count=0`、`allocated_difference_total=0`、`pending_difference_total=0`。
- [x] 重点订单：GFY167SG-1/1 入库 `200`，planned `200`，allocated `200`，pending `0`；GFY371SG-1/1 入库 `48`，planned `50`，allocated `48`，pending `2`。
- [x] 目标包装报工只读确认：GFY167SG-1/1 为 31，GFY371SG-1/1 为 48。

### 正在进行

- [x] 验证生产配置、目标订单基线、全部周计划影响模拟和报工事实。
- [x] 未重新执行同步；仅核验正式自动同步日志和全量对账结果。

### 待完成

- [x] 正式 SCHEDULED 同步已由现有自动机制完成；本任务不重复执行。
- [x] 执行后日志、目标周计划、全量对账、入库和开关状态已核验。

### 修改文件

- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 无。

### 新增或修改测试

- 无；本任务是生产数据同步验证，不修改代码。

### 已运行测试

- 尚未运行代码测试；已完成 Git 预检和正式实现静态核对。
- 只读生产查询：配置、目标入库/周计划、全量正式算法模拟、异常检查、包装报工，均已完成。

### 当前已知问题

- 工作区与源码未修改；本次仅更新进度记录并做只读核验。

### 等待用户确认

- 无。

### 下一步

1. 无；该任务已 PASS，后续不重复执行同步。

### 最终报告

KN-MPS-INBOUND-ALLOCATION-VERIFY-001：PASS

开始HEAD=`6444eea`；结束HEAD=`ce1ed0a`；工作区：仅 `outputs/CODEX_PROGRESS.md` 有任务记录修改，源码未修改。

正式实现确认：入口 `POST /api/v1/master-plan-system/sync/inbound-allocation`；`enabled=false` 时 MANUAL 允许执行；范围为当前 tenant 全部周计划；账套 `UFTData418971_000003`；公式为按 `order_number + item_code` 汇总入库、按交期/交货号/ID FIFO 分摊。

执行后配置：`inbound-allocation=true`，`interval_minutes=30`，`status=SUCCESS`；03:00 SCHEDULED 成功 448 条，03:30 SCHEDULED 成功 0 条。

目标执行后：GFY167SG-1/1 入库 `200`（169+31），planned `200`，allocated `200`，pending `0`；GFY371SG-1/1 入库 `48`，planned `50`，allocated `48`，pending `2`。

全量执行后对账：1169 条周计划 `mismatch_count=0`、`current_data_anomaly_count=0`、`allocated_difference_total=0`、`pending_difference_total=0`。

备份：沿用本任务执行前已有生产备份记录；本次未修改业务数据。

手工同步：未重复执行；生产自动同步日志为 SCHEDULED SUCCESS。

执行后验证：不适用。报工事实执行前为 GFY167SG-1/1 包装 `31`、GFY371SG-1/1 包装 `48`；本次未写入，未被修改。

源码是否修改：否。Migration：无。最终结论：PASS。

---

# Codex 工作进度

## 当前任务：KDOS-NOTIFICATION-RECIPIENT-TARGETS-005

任务目标：通知规则接收对象复用现有组织架构、角色、员工授权选择机制，支持多选混合和组织范围动态解析；不保存名称作为业务键。

当前状态：代码、全量质量门禁、API/Web 部署和线上只读核验已完成。

最后更新时间：2026-09-23

### 当前阶段

当前阶段：接收对象模型、动态解析与 UI 实现

当前子任务：完成全量测试、构建、部署和数据库运行链路核验。

### 已完成

- [x] `FIXED_USERS` 兼容保留，但配置统一规范化为 `recipientTargets`。
- [x] 支持 `ORGANIZATION / ROLE / USER` 三类稳定 ID，可多选、混合选择。
- [x] 组织对象支持 `includeDescendants=false/true`，即仅当前组织/包含下级组织。
- [x] 发送时按当前组织、角色成员和员工关系动态解析，最终按 `users.id` 去重；禁用员工仍保留跳过日志，不成为有效投递对象。
- [x] 消息中心复用现有组织树、角色分组、员工复选选择模式和对应数据源；名称仅展示。

### 正在进行

- [x] 全量 API/Web 测试、lint、typecheck、build。
- [x] API/Web 部署和健康检查。
- [x] 检查线上既有 `FIXED_USERS` 配置读取兼容及新规则保存路径。

### 修改文件

- `apps/api/src/modules/notifications/notification.types.ts`
- `apps/api/src/modules/notifications/notification-admin.service.ts`
- `apps/api/src/modules/notifications/notification.admin.controller.ts`
- `apps/api/src/modules/notifications/notification.service.ts`
- `apps/api/src/modules/notifications/notification-admin.service.spec.ts`
- `apps/api/src/modules/notifications/notification.service.spec.ts`
- `apps/web/src/modules/notifications/NotificationCenterPage.tsx`

### 数据库 Migration

- 无新增 migration；继续使用 `notification_rules.config` jsonb 保存稳定 ID 配置。

### 新增或修改测试

- 混合组织/角色/员工稳定 ID 校验。
- 组织范围、角色组织授权和员工去重的动态解析测试。
- 消息中心组织/角色/员工选择器保持现有专项测试覆盖。

### 已运行测试

- API 全量：64 suites / 520 tests 通过，1 个环境标记测试跳过。
- Web 全量：24 files / 143 tests 通过；通知 API 专项 21 tests 通过；Dispatcher Python：6 tests 通过。
- API/Web lint、typecheck、build 通过；Web 仅既有 Fast Refresh 与 bundle 体积 warning。
- 备份：`data/backups/*_20260923_173410.*`；部署后健康检查通过；无待执行 migration。

### 当前已知问题

- 线上既有规则仍使用兼容格式 `recipientUserIds`，读取和发送兼容；新保存路径写入 `recipientTargets`。

### 下一步

1. 若要立即验证新配置，请在消息中心按组织架构、角色、员工混合选择并保存一条规则。
2. 触发新设备事件后核对动态解析出的 users.id 去重结果和投递日志。

## 当前任务：KDOS-DISPATCHER-AND-TABLE-DEFAULTS-004

任务目标：完成 Dispatcher 常驻自动发送、计划运行时间新建默认为 0、事业部周计划生产进度 Excel 数值格式统一、标准表格默认每页 100 条；不扩展通知渠道或业务入口。

当前状态：代码、质量门禁、API/Web 部署和用户级 Dispatcher 服务已完成；真实新业务事件待用户手工触发。

最后更新时间：2026-09-23

### 当前阶段

当前阶段：实现与验证

当前子任务：完成 Dispatcher 常驻循环/systemd 配置、Excel 数值单元格测试、分页和计划时间测试后再处理线上旧消息。

### 已完成

- [x] Dispatcher 增加默认常驻轮询、`--once` 调试模式、API/单条通知异常隔离、SIGTERM/SIGINT 优雅退出。
- [x] 计划运行时间新建表单显示 `0小时0分钟`，后端允许必填值 0，历史数据不改。
- [x] 生产进度 formatter 下沉到 `@tracker/shared`，周计划 Excel 导出写入 numeric ratio 和 `0.#%` 格式。
- [x] KdosDataTable 与标准分页 API 默认值统一为 100，显式 pageSize 保持优先。

### 正在进行

- [x] 运行 API/Web/Shared/Python 测试、lint、typecheck、build。
- [x] 安装并启动 `kdos-notification-dispatcher.service`（当前用户 linger scope）。
- [x] 仅抑制明确的 `01-01-0004` 历史 PENDING 测试事件，并收敛本次上线验证中已实际发送但 API 回执未落库的 5 条旧记录。

### 待完成

- [x] service active/running、常驻多轮日志和 `--once` 单轮验证。
- [ ] 使用现有测试设备产生一条新的正式事件并完成企业微信真实收信验收。

### 修改文件

- `automation/wechat_push_projects/kdos-notification-dispatcher/dispatcher.py`、`test_dispatcher.py`
- `apps/api/src/modules/equipment/equipment.application.service.ts`、`equipment-export.service.ts`、相关测试
- `packages/shared/src/index.ts`、`index.test.ts`
- `apps/api/src/modules/master-plan-system/master-plan-spreadsheet.service.ts`、相关测试
- `apps/web/src/shared/KdosDataTable.tsx`、`platform-table.ts`、标准业务页面及相关测试
- `apps/api/src/modules/notifications/notification.service.ts`、`notification.service.spec.ts`
- `automation/wechat_push_projects/kdos-notification-dispatcher/README.md`
- `automation/wechat_push_projects/kdos-notification-dispatcher/kdos-notification-dispatcher.service`

### 数据库 Migration

- 无新增 migration；仅对一条明确的 `01-01-0004` 历史 PENDING 测试事件做终态抑制。

### 新增或修改测试

- Dispatcher 常驻/API 故障/坏消息继续轮询；计划时间 0；生产进度真实 xlsx numeric/numFmt；默认 100 和显式 50 优先。

### 已运行测试

- API 全量：64 suites / 517 tests 通过，1 个环境标记测试跳过。
- Web 全量：24 files / 143 tests 通过；Shared：6 tests 通过；Dispatcher Python：6 tests 通过。
- API/Web/Shared lint、typecheck、build 通过；Web 仅既有 Fast Refresh 与 bundle 体积 warning。
- 备份：`data/backups/*_20260923_170147.*`；部署后健康检查通过；无待执行 migration。
- Dispatcher 用户服务：enabled/active，Python 使用 basic_code `.venv`，连续 1 秒轮询；`--once` 返回 claimed=0。

### 当前已知问题

- 无 root sudo 权限，无法安装 `/etc/systemd/system` 的系统级 unit；已安装同名用户级 linger unit，`systemctl --user` enabled/active，`journalctl --user -u` 正常。
- 本次上线验证中 5 条旧消息已成功调用企业微信但回执因 API 参数 bug 未落库，修复后通过内部 success API 收敛为 SENT；这些记录 provider_message_id 仍为空。

### 下一步

1. 用户现在可以将 `01-01-0004` 的故障时长从 10 改成 20，生成一条新的正式测试事件。
2. 核对新事件的业务责任人解析、实际崔玮杰接收、provider msgid 和 delivery 状态。

---

## 当前任务：KDOS-NOTIFICATION-ONLINE-FIX-003

任务目标：修复 `shipping_edit_weekday` 多值 jsonb 保存，以及设备故障通知 TEST MODE 的实际接收人覆盖语义；增加指定人员规则和投递日志区分，不扩展通知渠道或业务入口。

当前状态：代码、全量验证、migration、API/Web 部署已完成；真实设备链路因合法登录账号和 Dispatcher 服务缺失暂未执行。

最后更新时间：2026-09-23

### 当前阶段

当前阶段：部署后核验与交付记录

当前子任务：记录已部署版本、既有 pending 数据和真实验收阻塞，不通过绕过权限或直接改库制造测试事件。

### 已完成

- [x] `shipping_edit_weekday` 只在业务规范化后使用 `JSON.stringify` 写入 jsonb，保留数据库字段和其他系统参数类型。
- [x] 增加真实 PostgreSQL jsonb UPDATE/读取测试，覆盖 `2,4,5`、去重排序和非法输入。
- [x] TEST MODE 下保留真实业务接收人解析，实际企业微信接收人统一覆盖为崔玮杰；多责任人合并为一次实际发送。
- [x] 增加投递日志实际接收人字段及最小 migration，支持 `FIXED_USERS` 按稳定 `users.id` 配置。
- [x] 增加 API/Web/Python 专项测试及历史 `RECIPIENT_NOT_ALLOWED` 不自动重新领取保护。

### 正在进行

- [x] 全量测试、lint、typecheck、build。
- [x] 在线备份、migration、API/Web 部署和健康检查。
- [ ] 使用现有测试设备且不修改责任人配置执行 faultMinutes 0→10 真实验收；当前无可用合法登录账号，且主机无 Dispatcher 服务/进程。

### 待完成

- [ ] 记录线上测试设备、业务解析接收人、实际崔玮杰接收人、provider msgid 和最终 delivery 状态；需补充合法账号并部署 Dispatcher。

### 修改文件

- `apps/api/src/modules/master-plan-system/master-plan.application.service.ts`
- `apps/api/src/migrations/1722920070000-NotificationTestModeDelivery.ts`
- `apps/api/src/modules/notifications/`
- `apps/web/src/modules/notifications/`
- `automation/wechat_push_projects/kdos-notification-dispatcher/`
- `ARCHITECTURE.md`、`SECURITY.md`、`docs/integration-guide.md`

### 数据库 Migration

- 已执行：`NotificationTestModeDelivery1722920070000`，仅增加 actual recipient/test mode 投递日志字段和索引。

### 新增或修改测试

- PostgreSQL jsonb 实际持久化测试；通知服务/管理端/迁移测试；消息中心页面测试；Python Dispatcher 测试。

### 已运行测试

- API typecheck、通知/主计划专项测试通过；Web typecheck、消息中心页面专项测试通过；Python Dispatcher 4 tests 通过。
- API 全量：64 suites / 516 tests 通过（1 个 PostgreSQL 集成测试按环境标记跳过）；Web 全量：24 files / 142 tests 通过；Python Dispatcher：4 tests 通过；lint、typecheck、build 通过。
- 备份：`data/backups/four_department_tracker_20260923_155820.backup`、`kdos_20260923_155820.backup`、`uploads_20260923_155820.tar.gz`；migration、API/Web healthcheck 通过。

### 当前已知问题

- 线上 `shipping_edit_weekday` 当前仍为历史值 `3`（jsonb number），未用 SQL 代替业务保存 `2,4,5`。
- 本轮真实设备 0→10 未执行：环境 `.env` 初始管理员密码登录返回 401；未取得其他合法账号。主机无 `kdos-notification-dispatcher` systemd unit 或运行进程。
- 线上存在本轮前创建的 3 条 `equipment.status.fault_changed` PENDING/test outbox；未启动 Dispatcher，因此未发送，也未篡改历史状态。
- 已确认可用现有测试设备候选：`KN-0201054`（数控折弯机），当前故障时长 0、版本 1，唯一责任人为杨亮亮（`YangLiangLiang`）；责任人配置未修改。

### 等待用户确认

- 无；按当前服务器可用配置继续，若无合法业务认证或测试设备条件则在最终报告中明确未完成项。

### 下一步

1. 用户提供合法系统管理员或 PMC 模块管理员账号，并部署/注册 Dispatcher systemd 服务。
2. 使用现有设备责任人不变的测试设备，通过业务 API 执行 0→10。
3. 核对 outbox、业务接收人、崔玮杰实际接收人、企业微信 msgid 和 delivery 状态。

---

## 当前任务：KN-MPS-NOTIFICATION-CENTER-001

任务目标：修复出货计划开放星期多值保存/校验，并建设系统管理→消息中心，接入现有 notification_rules、notification_outbox、notification_delivery_logs；不新增业务表推送按钮、不新增渠道、不引入消息中间件。

当前状态：已完成代码、测试、migration、部署与健康检查（2026-09-23）；线上需要登录账号的业务验收仍待用户提供有效账号。

最后更新时间：2026-09-23

### 当前阶段

当前阶段：开放星期保存规范化与消息中心基础闭环

当前子任务：线上业务验收待授权账号；代码交付已完成。

### 已完成

- [x] 完整阅读本次附件、项目 AGENTS.md、ARCHITECTURE.md、SECURITY.md、docs/integration-guide.md 与 `kdos-form-platform` skill。
- [x] 核对 App.tsx、主计划系统、通知基础设施、资源注册表、管理员/模块管理员权限实现。
- [x] 确认 `shipping_edit_weekday` 已有运行时多值解析，但保存入口尚未统一校验/规范化。
- [x] 确认当前代码库没有“管控天数”字段、参数、Entity/DTO、业务规则或 Excel 契约；本轮不猜测范围、不新增虚构配置。
- [x] `shipping_edit_weekday` 保存统一 trim、去重、数字排序、英文逗号规范化；非法输入使用精确提示，旧单值仍兼容。
- [x] 主计划系统参数编辑表单改为文本输入并显示要求的星期帮助文案；读取/刷新沿用同一 `jsonb` 字符串值，不改底层字段类型。
- [x] 新增通知规则模块归属 migration；消息中心后端 API 覆盖规则、启停、测试入队、真实投递日志、失败查询和授权重试。
- [x] 消息中心只允许注册事件、受支持接收人和企业微信工作通知；新增系统管理入口与三 Tab 页面，无业务表推送按钮。
- [x] 系统管理员/资源所属模块管理员后端授权、普通用户直接 API 拒绝、模板变量白名单和测试模式提示已完成。
- [x] 完成备份、migration、API/Web 重建部署；API、Web、PostgreSQL、Swagger/OpenAPI 健康检查通过。
- [x] 修正模块管理员进入 `/system/notifications` 的前端路由守卫，并完成 Web 重建部署与健康检查。

### 正在进行

- [ ] 仅剩线上业务验收：需要有效系统管理员或 PMC 模块管理员登录账号，保存 `2,4,5` 后刷新确认；不通过绕过权限方式验收。

### 待完成

- [ ] 获得有效账号后完成线上 `2,4,5` 保存/刷新和消息中心登录后核验。

### 修改文件

- `apps/api/src/migrations/1722920069000-NotificationCenterAdministration.ts`
- `apps/api/src/modules/master-plan-system/master-plan.application.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.shipping-window.ts`、`master-plan.shipping-window.spec.ts`
- `apps/api/src/modules/notifications/notification-admin.service.ts`、`notification.admin.controller.ts`、`notification-admin.service.spec.ts`
- `apps/api/src/modules/notifications/notification.service.ts`、`notifications.module.ts`
- `apps/web/src/App.tsx`、`apps/web/src/modules/notifications/NotificationCenterPage.tsx`、`NotificationCenterPage.spec.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanPages.tsx`
- `ARCHITECTURE.md`、`SECURITY.md`、`docs/integration-guide.md`、本进度文件

### 数据库 Migration

- `NotificationCenterAdministration1722920069000`：`notification_rules.module_code`、模块索引；不改变既有通知表状态模型。
- 已在线执行；备份：`data/backups/*_20260923_113912.*`，SHA-256：`cbed5f8475da89140621e0da1d0424a88037030522427ebb877edcc5747d73c7`、`441bac94b62043bed323424f2fe9bb633e791b02d7b06a1367920c4dd30c8803`、`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`。

### 新增或修改测试

- 开放星期合法/非法/中文逗号/保存规范化测试。
- 通知中心服务端注册事件、权限、模板变量测试；前端三 Tab/测试模式/注册事件测试。

### 已运行测试

- API 全量：64 suites / 509 tests 通过；API typecheck、lint、build 通过。
- Web 全量测试通过；Web typecheck、lint、build 通过；仅既有 `ModulePortal` Fast Refresh warning 和既有 bundle 体积提示。
- API 专项（主计划/通知）：4 suites / 89 tests 通过。
- 部署后 `healthcheck.sh` 通过；数据库显示 migration 无待执行项；未登录消息中心 API 返回 401。

### 当前已知问题

- “管控天数”在当前代码库不存在，无法按现有业务规则实现；未猜测范围、未新增虚构字段/Excel 契约。
- `2,4,5` 的真实登录后保存/刷新验收待有效账号；当前线上数据库原值保持不变，未用 SQL 代替业务保存。
- 真实企业微信仍保持既有测试模式，仅允许崔玮杰；本轮不切换生产发送。

### 等待用户确认

- 无。

### 下一步

1. 用户提供有效系统管理员或 PMC 模块管理员账号后，保存 `2,4,5` 并刷新核对。
2. 登录 `/system/notifications` 核对三个 Tab、设备故障事件和测试模式提示。
3. 若线上验收通过，将本节剩余待办标记完成；不修改当前稳定部署。

### 恢复执行说明

新的 Codex 会话开始后先读取本节，再执行 `git status` / `git diff --stat`，从“下一步”的第一项继续；不要重做下方已完成历史任务。

## 当前任务：KDOS-NOTIFICATIONS-DISPATCHER-002

任务目标：完成 `notification_outbox` → 通知规则 → 动态责任人 → 内部 Dispatcher API → 主机 Python Dispatcher → 默认 `WeChatPusher` 的安全闭环；验证阶段仅允许崔玮杰，暂不开发通知中心前端。

当前状态：部分完成（2026-09-23）；阶段：规则解析、动态接收人、逐接收人投递状态、内部 API 和主机适配器已完成并已部署；真实崔玮杰单人实发受当前责任人数据阻塞。

最后更新时间：2026-09-23

---

## 当前阶段

当前阶段：Dispatcher 闭环与单人验证门禁

当前子任务：全量测试、迁移前检查、部署后健康检查和崔玮杰单人实发验证。

---

## 已完成

- [x] 完整阅读当前项目 `AGENTS.md`、`ARCHITECTURE.md`、`SECURITY.md`、`docs/integration-guide.md`。
- [x] 阅读 `equipment`、`contact-sync`、`master-plan-system` 及 `mps_reconciliation_outbox` 迁移和消费者实现。
- [x] 确认沿用 `apps/api` TypeORM PostgreSQL migration、`DataSource.transaction` 和显式 `tenant_id` 条件；不使用 Redis、RabbitMQ、Kafka。
- [x] 上一阶段设备状态 faultMinutes 变化已在设备写入、Audit 和 outbox 入队同一事务中完成。
- [x] 新增 `notification_rules`、`notification_outbox`、`notification_delivery_logs`，全部带 `tenant_id`、RLS policy 和跨租户复合外键约束。
- [x] 实现规则 upsert、`tenant_id + dedup_key` 幂等入队、`FOR UPDATE SKIP LOCKED` 批量领取、worker 所有权校验、成功/失败状态回写和 `next_retry_at` 重试。
- [x] 新增通知路由迁移：规则 resource/recipient_rule、逐接收人 delivery 字段、缺失 wechat ID 的 SKIPPED 状态和 KAINAN 正式设备故障规则。
- [x] `claimForDispatcher` 使用 `FOR UPDATE SKIP LOCKED`，仅返回启用且受支持的设备故障规则；无匹配规则隔离为 `FAILED + next_retry_at=NULL`，不会直接发送。
- [x] API 内按 `equipment_responsibles → users` 动态解析启用责任人，未配置 `wechat_user_id` 只记录 `SKIPPED_MISSING_WECHAT_ID`，不阻塞其他责任人。
- [x] 增加逐责任人成功/失败回写、部分成功保持重试、所有可投递项完成后 outbox 标记 SENT。
- [x] 新增 token + tenant + worker header 保护的内部 Dispatcher API；controller 不访问数据库。
- [x] 新增 `automation/wechat_push_projects/kdos-notification-dispatcher`，仅调用内部 API 和 `/data/automation/code/work/basci/basic_code` 的默认 `WeChatPusher`；未通过单人门禁不调用企业微信。
- [x] 更新 `ARCHITECTURE.md`、`SECURITY.md`、`docs/integration-guide.md` 和企业微信推送项目索引。
- [x] 新增规则路由、缺失接收人、部分失败、内部 guard 和 Python Dispatcher 专项测试。

## 正在进行

- [x] 全量 API 测试、typecheck、lint、build 和 Python Dispatcher 测试。
- [x] 完成迁移前备份、两份 TypeORM migration、API 重建部署和 health check。
- [x] 设置运行环境单人门禁 `KDOS_DISPATCHER_ALLOWED_RECIPIENT_NAME=崔玮杰`，Dispatcher 空队列轮询返回 `claimed=0,sent=0,failed=0,skipped=0`。

## 待完成

- [ ] 记录真实发送结果；当前 KAINAN 中崔玮杰账号启用且 `wechat_user_id=CuiWeiJie`，但没有任何 `equipment_responsibles` 关系，无法由正式动态责任人规则生成发给他的设备通知。需要先通过设备管理业务流程将崔玮杰合法设置为测试设备责任人，再执行单次实发。

## 修改文件

- `apps/api/src/migrations/1722920067000-NotificationInfrastructure.ts`
- `apps/api/src/migrations/1722920068000-NotificationRoutingAndRecipientDeliveries.ts`
- `apps/api/src/modules/notifications/notification.types.ts`
- `apps/api/src/modules/notifications/notification.service.ts`
- `apps/api/src/modules/notifications/notification.internal.controller.ts`
- `apps/api/src/modules/notifications/notification.internal.guard.ts`
- `apps/api/src/modules/notifications/notifications.module.ts`
- `apps/api/src/modules/notifications/notification.migration.spec.ts`
- `apps/api/src/modules/notifications/notification.service.spec.ts`
- `apps/api/src/modules/notifications/notification.internal.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/modules/equipment/equipment.application.service.ts`
- `apps/api/src/modules/equipment/equipment.module.ts`
- `apps/api/src/modules/equipment/equipment-notification.spec.ts`
- `ARCHITECTURE.md`、`SECURITY.md`、`docs/integration-guide.md`
- `automation/wechat_push_projects/kdos-notification-dispatcher/dispatcher.py`
- `automation/wechat_push_projects/kdos-notification-dispatcher/test_dispatcher.py`
- `automation/wechat_push_projects/kdos-notification-dispatcher/README.md`
- `outputs/CODEX_PROGRESS.md`

## 数据库 Migration

- 新增 `NotificationInfrastructure1722920067000`：三张通知表、索引、状态/重试/幂等约束和 RLS。
- 新增 `NotificationRoutingAndRecipientDeliveries1722920068000`：规则路由字段、KAINAN 设备故障规则、逐责任人 delivery 字段和缺失企微 ID 状态；已于 2026-09-23 执行。
- 部署前备份：`data/backups/*_20260923_101524.*`；SHA-256 已在升级输出中核验，KAINAN 规则和三张通知表已在线存在。

## 新增或修改测试

- 通知迁移/服务/内部 guard 3 suites / 14 tests；设备故障专项 14 tests；Python Dispatcher 3 tests；待全量回归。

## 已运行测试

- Python Dispatcher 专项：3 tests 通过。
- API notifications/equipment 专项：3 suites / 14 tests 通过；typecheck 通过。
- API 全量：63 suites / 499 tests 通过；API lint/typecheck/build 通过；Python Dispatcher：3 tests 通过；migration/deployment/health 通过；真实发送因无崔玮杰设备责任人关系未执行。

## 当前已知问题

- 真实企业微信发送未执行：正式动态责任人查询不到崔玮杰。未直接 SQL 修改业务责任人、未绕过规则发送；恢复条件是通过设备管理页面/API 完成合法责任人配置并提供可验证的测试设备。

## 等待用户确认

- 无。

## 下一步

1. 由业务侧通过设备管理流程为测试设备配置崔玮杰为责任人。
2. 产生一次真实 `faultMinutes` 增量事件，运行 Dispatcher，仅验证崔玮杰单人发送并核对 outbox/delivery 状态。
3. 验证完成后更新本节为已完成；在此之前保持单人门禁，不启用其他接收人。

## 恢复执行说明

新的 Codex 会话开始后，先读取本节、项目规范和当前 git 状态，从“下一步”的第一项未完成任务继续；不要重新分析已经完成的设备工作。

---

## 当前任务：KN-EQUIP-IMPORT-ERROR-001

任务目标：修复设备状态旧模板及其他文件级导入失败只显示瞬时 message 的问题，增加持久错误 Modal；旧模板提供下载最新模板入口，行级预览错误保持原流程。

当前状态：进行中（2026-09-22）；阶段：修复、全量测试、备份、API/Web 部署和推送已完成；真实账号线上 preview 受阻。

已完成：确认后端已拒绝缺少“计划运行时间”的旧模板；统一旧模板错误文案并移除重复句；前端新增 `importError` 持久 Modal；旧模板错误显示“下载最新模板”并复用现有下载接口；其他文件级错误同样进入 Modal；重新选文件和成功预览时清理旧错误；保留 `beforeUpload` 返回 false 和行级预览错误流程。

正在进行：等待有效线上账号，执行旧模板和新版模板只读 preview 验收。

待完成：真实旧模板与新版模板线上只读 preview；账号恢复后继续，禁止执行真实导入确认。

修改文件：`apps/api/src/modules/equipment/equipment-import.service.ts`、`apps/api/src/modules/equipment/equipment.spec.ts`、`apps/web/src/modules/equipment/EquipmentPages.tsx`、`apps/web/src/modules/equipment/EquipmentPages.spec.tsx`、本进度文件。

数据库 Migration：无。

新增或修改测试：后端旧/新 workbook 级 preview 测试；前端旧模板 400 → 持久 Modal、完整文案、下载模板按钮、无预览 Modal、单次 preview 请求测试。最终 API 59套/478项、Web 23套/141项通过；API/Web typecheck、lint 通过。

已运行测试：API equipment 专项 18 项、Web Equipment 专项 9 项通过；API 59套/478项、Web 23套/141项全量通过；API/Web typecheck、lint、build 通过。Web lint 仅有既有 ModulePortal warning，Web build 仅有既有 bundle 体积提示。备份：`data/backups/{four_department_tracker,kdos,uploads}_20260922_194655.*`，SHA-256 已输出并核验。

当前已知问题：线上真实账号尚未提供；旧/新版文件线上 preview 待账号和真实模板完成。部署后 API/Web/PostgreSQL healthy，`/health`、`/api/v1/health`、`/api/docs`、`/api/openapi.json` 均 200；未登录导入接口仍为 401。不得执行真实导入确认。

下一步：1. 获得有效线上账号；2. 使用真实旧/新模板只做 preview；3. 验收通过后更新最终报告并标记完成。

最终报告（当前阶段）：KN-EQUIP-IMPORT-ERROR-001=FAIL（仅线上真实验收未完成）；开始HEAD=74b9152；结束HEAD=6086972；工作区=clean；backend legacy detection=保留并统一重复文案；frontend failure presentation=持久“导入失败”Modal；test coverage gap=已补齐 API workbook 级和 Web 交互级测试。旧模板 API=400 业务拒绝；错误文案=正式单句；Modal=专项测试通过；下载最新模板=复用 `/equipment/status-reports/import-template`，专项测试通过。新版模板 preview=API 专项测试正常进入 application preview；真实线上 preview 待账号。其他文件级错误=进入同一持久 Modal；行级错误=保持预览 Modal。Upload是否单次请求=专项测试确认一次 preview 请求，`beforeUpload` 继续返回 false。API tests=59套/478项；Web tests=23套/141项；typecheck=API/Web通过；lint=通过（仅既有 ModulePortal warning）；build=API/Web通过；Migration=无。部署：API/Web/PostgreSQL healthy；health、Swagger、OpenAPI均200。线上旧模板验收=阻塞（无有效账号）；线上新版模板验收=阻塞（无有效账号）。提交=6086972，已推送 GitHub main/Gitee master。

恢复执行：读取本节、项目 AGENTS.md、相关 skill，执行 git status/diff；从下一步第一项继续。

---

## 当前任务：KN-TABLE-COLUMN-MENU-001

任务目标：实现 KDOS 统一列菜单、列头筛选、递归 FilterGroup、候选联动及打印/导出一致性。

当前状态：进行中（2026-09-22）；阶段：代码、测试、备份、API/Web 部署与公开健康检查已完成；待有效账号完成线上业务验收。

已完成：阅读附件与项目规范；按要求核对 `HEAD=32fdc72` 且工作区干净；检查公共表格、编译器、候选接口和典型业务表；递归 FilterGroup + 深度/规则限制；授权候选 DISTINCT/hasMore；服务端排序读权限；标准列菜单/固定/隐藏/筛选；advanced AND header；打印与导出查询贯通；主计划 PENDING 候选复用任务事实来源；用户页面上下文应用于候选；修正表级 READ 不等于字段 READ 的侧信道；更新技能与架构。

正在进行：等待用户通过安全渠道提供有效线上验收账号，以核对设备、主计划、个人视图和受限字段。

待完成：受权线上业务验收；确认跨账号隔离、受限字段及真实候选联动。

修改文件：`outputs/CODEX_PROGRESS.md`、`packages/contracts/src/index.ts`、`apps/api/src/common/filtering/{filter.contract,sql-filter.compiler,field-candidate.service,table-filter.controller}.ts`、新增两份后端测试、`apps/api/src/modules/{equipment,master-plan-system}/*query.service.ts`、`apps/web/src/shared/{KdosDataTable,advanced-filter,platform-table,table-print,table-column-menu}.tsx/ts`、相关模块查询 URL、CSS/测试、`ARCHITECTURE.md`、技能文件。

数据库 Migration：无；如果确需变更，按附件要求停止。

新增或修改测试：递归筛选、候选/快速搜索权限、列菜单/打印、出库导出排序与模块管理员授权及旧 E2E 断言调整。最终 API 59套/477项、Web 23套/140项全量通过，Web 列菜单专项13项通过；API/Web typecheck、lint、build 通过；更新的 Playwright 两套/9个用例已完成收集，因缺有效账号未执行。Web lint 仅有 ModulePortal 既有 warning，Vite 大包提示。备份：`data/backups/{four_department_tracker,kdos,uploads}_20260922_185027.*`，SHA-256 已核验。

当前已知问题：最终 API/Web 部署后容器均 healthy，`/health`、`/api/v1/health`、`/api/docs`、`/api/openapi.json` 均 200，未登录 rows/candidates 返回 401；仍无法用真实账号核对设备/主计划筛选及跨账号个人视图。服务器管理员初始密码已失效，已请求用户通过安全渠道提供测试账号；不重置密码或绕过登录。候选高基数下的成员/部门标签采取保守策略（无正式标签时不展示、提示继续搜索）。

下一步：1. 获得测试账号后运行设备/主计划/权限账号线上验收；2. 如发现问题修复、复测和重部署；3. 验收通过后将状态改为已完成并记录最终报告。

恢复执行：先读 AGENTS.md、技能、本节，再运行 `git status` / `git diff --stat`，继续下一步；下方为已完成的前一设备任务历史记录。

---

## 任务

任务名称：KDOS 设备大屏集团与事业部七日趋势分层

任务目标：在保留已上线设备大屏、Apache ECharts、昨日两张表、Excel、数据库字段和统计口径的前提下，增加集团总览与各可见事业部独立七日趋势图；统一日期、Y 轴、权限与顶部筛选范围。

当前状态：已完成

最后更新时间：2026-09-22

---

## 当前阶段

当前阶段：集团与事业部七日趋势、测试、部署与线上核验已完成

当前子任务：无。

---

## 已完成

- [x] 读取本轮需求、项目规范、`kdos-form-platform` 技能、当前 Dashboard SQL、Equipment 页面、shared charts 与专项测试；保留既有昨日两表、Excel、数据库字段、权限和多租户边界。
- [x] 在同一 Dashboard 查询内新增 `operations_divisions`、`operations_division_daily`、`operations_division_trends`，按日期×当前可见事业部补齐七日序列。
- [x] `sevenDayTrend` 改为 `{ total, divisions }`；总览和每个事业部均返回 7 个相同日期，空填报日保留，百分比 NULL 语义保留。
- [x] 抽取前端 `EquipmentTrendChart`，总览使用 330px、事业部使用 250px，两条线和 Tooltip 语义统一，复用 `KdosChart`，未新增图表库或第二套 ECharts 初始化。
- [x] 实现全可见图统一 Y 轴：`max(100, ceil(maxRate / 20) * 20)`；105/110 均统一为 120，Y 轴从 0 开始并显示百分号，X 轴 7 天全部显示。
- [x] 页面改为 1 个总览大图 + 权限范围内事业部双列小图，事业部按一至四部业务顺序、其他事业部稳定置后；顶部事业部/部门筛选继续作用于所有趋势。
- [x] API 11 项、Web Equipment 8 项、KdosChart 2 项及 API/Web typecheck 已通过。
- [x] 新增上海时区日期滚动测试：2026-09-22 返回 09-15～09-21，日期前移后按连续 7 个完整自然日滚动。
- [x] 完成 Node 24 production build、部署前三份备份、API/Web 容器重建和健康检查；本轮无数据库 Migration。
- [x] 线上受权 Dashboard 核验通过：总览和全部可见事业部均为 7 行，日期轴完全一致；2026-09-21 总览实际运行 103557 分钟，事业部合计 103557 分钟，计划为空时稼动率保持 NULL。
- [x] 线上筛选核验通过：选择事业一部后仅返回事业一部总览和事业部趋势；当前用户可见四个标准事业部及研发中心，按业务顺序返回。
- [x] 读取本轮拆表需求、当前设备大屏实现、既有进度和 `kdos-form-platform` 规范；保留既有 ECharts、趋势、Excel、权限与多租户逻辑。
- [x] 将 `operationsMonitoring` 从混合 `yesterdayRows` 调整为 `yesterdayDivisionRows` 与 `yesterdayDepartmentRows`；两者复用同一个 `monitored` / `operations_reports` CTE 范围。
- [x] 部门聚合以事业部稳定 ID + 部门稳定 ID（NULL 时沿用“未指定部门”）分组，事业部聚合再以稳定事业部 ID 汇总；同名部门不会跨事业部合并。
- [x] 保持实际运行时长为未过滤的 `SUM(runtime_minutes)`，仅稼动率分子使用有效正计划记录；事业部、部门、KPI 和趋势的昨天日期继续由服务端上海时区固定计算。
- [x] 将页面改为“昨日事业部填报与稼动情况”在前、“昨日部门填报与稼动情况”在后；两张表均保持紧凑字段宽度和现有填报率/时长/空值展示。
- [x] 增加事业部 100/90/10/90.0%、部门同名跨事业部、420+480=900、计划为空仍显示实际 480 且稼动率 `—` 的 API/Web 回归断言。
- [x] 已通过 API query service 11 项、Web equipment 页面 8 项、API/Web typecheck、API lint、Web lint（仅既有 ModulePortal warning）。
- [x] 已完成部署前 legacy/KDOS/uploads 三份备份及 SHA-256 校验；本轮无数据库 Migration。
- [x] 已以 Node 24 重建 API/Web production images，重建并上线容器；API、Web、PostgreSQL 均 healthy。
- [x] 已通过 `/health`、`/api/v1/health`、Swagger、OpenAPI 和受权线上 Dashboard API 核验；线上 Web bundle 已包含两张新表标题。
- [x] 线上 2026-09-21 核验：集团为应填 409、已填 172、填报率 42.1%、实际运行 103557 分钟、计划 0、稼动率空；事业部表与部门表实际运行时长汇总均为 103557 分钟。
- [x] 线上筛选核验：选择事业一部后两表均只保留事业一部；选择下料中心后事业部表和部门表均重算为应填 48、实际 34800 分钟。
- [x] 读取本轮完整需求、项目 AGENTS.md、`kdos-form-platform` 技能及既有设备管理代码、迁移和测试。
- [x] 确认当前基线 HEAD 为 `84d6aa5`，开始时工作区干净；未回退或覆盖既有设备改动。
- [x] 确认现有台账 `equipment_assets.planned_startup_minutes` 保留，状态表当前没有每日计划字段。
- [x] 确认现有权限范围统一由 `equipmentScope` / `equipmentCreateScope` 派生，后续改造沿用该边界。
- [x] 完成 `planned_runtime_minutes` 实体字段、兼容 migration、正数校验和状态审计；历史 NULL 不被伪造填充。
- [x] 完成状态列表、导入预览/确认、导出/模板、筛选字段和旧模板升级提示。
- [x] 完成集团/事业部/使用部门加权稼动率与设备级 `equipmentRows`，均沿用现有日期、事业部、部门和权限 SQL 边界。
- [x] 完成状态填报前端默认值、必填编辑器、列表字段和驾驶舱展示。
- [x] 验证：API/Web typecheck、后端设备测试 5 套件/45 项、前端设备页面 7 项通过。
- [x] API/Web lint 通过；Web 仅保留既有 `ModulePortal.tsx` Fast Refresh warning。
- [x] API/Web production build 通过；Node 22 相对项目声明 Node >=24 的 warning 仍存在。
- [x] 已完成生产数据库、KDOS 数据库和上传目录备份，并记录 SHA-256 校验值。
- [x] 已执行并核验 `EquipmentStatusPlannedRuntimeMinutes1722920066000` migration。
- [x] 已重建并部署 API/Web，容器健康检查通过；线上设备状态列表与驾驶舱查询成功返回新字段。
- [x] 已完成本轮代码定位，确认数据库字段和 API 底层字段保持不变。
- [x] 已将设备状态表单、列表、导出、模板、填写说明、导入错误提示和驾驶舱相关名称统一为“实际运行时长”语义。
- [x] Excel 模板列顺序固定为：事业部、使用部门、设备编号、设备名称、填报日期、计划运行时间、实际运行时长、故障时长、故障原因。
- [x] 导入同时兼容“实际运行时长”和旧“运行时长”表头；没有“计划运行时间”仍返回模板升级提示。
- [x] 已加入稼动率业务描述：实际运行时长 ÷ 计划运行时间 × 100%。
- [x] 已确认底层 `runtimeMinutes`、`runtime_minutes` 和数据库结构未修改。
- [x] 新增大屏“设备运行与填报监控”区域：昨日填报率、昨日稼动率、层级填报明细和计划/实际时长。
- [x] 后端在同一个 dashboard API 响应中增加 `operationsMonitoring`，复用 `scoped_assets → eligible → monitored` 及现有权限/组织筛选。
- [x] 昨日固定使用上海时区前一天；趋势固定为最近 7 个完整自然日，不受当前大屏期间选择器影响且不包含今天。
- [x] 填报率使用去重有效填报设备数/监控应填设备数；稼动率使用有效正计划记录的 SUM(实际)/SUM(计划)，允许超过 100%，无有效计划时返回空值。
- [x] 使用无新增依赖的响应式 SVG 双折线图，悬浮提示展示原始填报、计划和实际时长数据。
- [x] 新增后端固定业务日期测试和前端昨日 KPI、层级表格、单图双线及超过 100% 稼动率测试。
- [x] 已完成真实 PostgreSQL 查询核验、部署前备份、API/Web 重建部署、健康检查和线上 dashboard 查询核验。
- [x] 通过 pnpm 正式安装 `echarts`，新增 KDOS `shared/charts` 公共图表层；图表初始化、option 更新、resize、卸载 dispose、loading、empty 和 Ant Design token 基础主题统一封装。
- [x] 更新 `ARCHITECTURE.md`：Apache ECharts 定义为 KDOS 标准业务图表底层，业务模块只能通过 shared charts 使用。
- [x] 设备最近 7 天趋势改为 `KdosChart` 单图双线，tooltip 展示日期、填报率、已填/应填设备、稼动率、实际/计划运行时长；Y 轴可超过 100%，NULL 保持空值。
- [x] 昨日表格改为紧凑的“所属事业部 + 使用部门/车间”明细，去除层级/集团/事业部汇总行；大屏专用 formatter 将明确映射的“凯南事业一至四部”显示为“事业一至四部”。
- [x] 根因定位：数据库和状态查询均正确保留 `runtime_minutes` / `runtimeMinutes`；dashboard 的 `operations_daily` 与 `operations_yesterday_org` 错将实际时长纳入 `planned_runtime_minutes>0` 过滤。已分离实际运行总时长与稼动率有效计划分子。
- [x] 真实数据核验：2026-09-21 数据库实际运行时长合计 103557 分钟，修复后 dashboard API 同为 103557 分钟；172 条已填/409 台应填，填报率 42.1%；计划时长均为 NULL，故稼动率正确为 `—`。
- [x] 已重新构建并部署 Node 24 API/Web 镜像，线上 API/Web health 通过，真实线上 status/dashboard 查询通过。

---

## 正在进行

- 无。

---

## 待完成

- [x] 前端状态表单、列表和驾驶舱展示文本。
- [x] Excel 模板/导出/填写说明/导入错误提示与测试断言。
- [x] 运行测试、构建，备份并部署到当前运行环境，完成线上核验。
- [x] 设备大屏昨日监控与近 7 日趋势实现、测试、备份、部署和线上核验。
- [x] 昨日事业部/部门拆表、测试、备份、部署和线上核验（前一阶段）。
- [x] 集团与事业部七日趋势、备份、部署和线上核验。

---

## 修改文件

- 本轮修改：`apps/api/src/modules/equipment/equipment-import.service.ts`
- 本轮修改：`apps/api/src/modules/equipment/equipment.application.service.ts`
- 本轮修改：`apps/api/src/modules/equipment/equipment-export.service.ts`
- 本轮修改：`apps/api/src/modules/equipment/equipment-export.service.spec.ts`
- 本轮修改：`apps/api/src/modules/equipment/equipment.spec.ts`
- 本轮修改：`apps/web/src/modules/equipment/EquipmentPages.tsx`
- 本轮修改：`packages/contracts/src/index.ts`
- 本轮大屏增强：`apps/api/src/modules/equipment/equipment.query.service.ts`
- 本轮大屏增强测试：`apps/api/src/modules/equipment/equipment.query.service.spec.ts`
- 本轮大屏增强前端：`apps/web/src/modules/equipment/EquipmentPages.tsx`
- 本轮大屏增强样式/测试：`apps/web/src/styles.css`、`apps/web/src/modules/equipment/EquipmentPages.spec.tsx`
- 本轮公共图表层：`apps/web/src/shared/charts/KdosChart.tsx`、`chart-theme.ts`、`chart-utils.ts`、`index.ts`
- 本轮公共图表测试：`apps/web/src/shared/charts/KdosChart.spec.tsx`
- 本轮依赖/架构：`apps/web/package.json`、`pnpm-lock.yaml`、`ARCHITECTURE.md`
- 本次拆表：`apps/api/src/modules/equipment/equipment.query.service.ts`、`apps/api/src/modules/equipment/equipment.query.service.spec.ts`、`apps/web/src/modules/equipment/EquipmentPages.tsx`、`apps/web/src/modules/equipment/EquipmentPages.spec.tsx`
- 前一阶段设备改造文件和 migration 保持不变。

---

## 数据库 Migration

- `1722920066000-EquipmentStatusPlannedRuntimeMinutes.ts`：增加可空 `planned_runtime_minutes integer`，非 NULL 时 CHECK `> 0`。

---

## 新增或修改测试

- 本轮新增/调整：后端断言明确的事业部/部门响应数组、稳定 ID 聚合及实际运行时长过滤边界；前端断言两张表的列边界、事业部显示转换、同名部门归属、NULL 稼动率和两种时长展示。
- 已增加/修改：模板精确列顺序、实际运行时长展示、旧/新表头兼容、稼动率公式说明和相关中文断言。
- 已增加/修改：昨日业务时区边界、监控范围 SQL、去重填报率、正计划 SUM 稼动率、7 日趋势和大屏交互展示断言。
- 已增加/修改：实际运行时长不受空计划过滤、420/480=87.5%、900/1080=83.3% 的展示回归、NULL 趋势值、稼动率超 100% 轴范围及 tooltip；KdosChart 生命周期、resize 和空态测试。

---

## 已运行测试

测试名称：设备专项测试、类型检查、lint、构建、线上核验

结果：API query service 12 项、Web equipment page 8 项、shared KdosChart 2 项、API/Web typecheck 通过；API lint 通过，Web lint 无 error，仅既有 `ModulePortal.tsx` Fast Refresh warning；Node 24 Docker production build 通过（仅既有主 bundle 体积提示）；备份、部署、健康检查、线上结构、日期轴、权限筛选和 103557 分钟汇总核验均通过。

---

## 当前已知问题

- Node 22 本地运行环境低于项目声明的 Node >=24，仅产生 warning；Docker 部署使用 Node 24 镜像。
- Web lint 的既有 `ModulePortal.tsx` Fast Refresh warning 和 Web build 的既有大包 warning 未影响交付。
- ECharts 引入后 Web 主 bundle 仍触发既有大包提示（约 3.58 MB 未压缩 / 1.12 MB gzip）；本轮未额外引入第二套图表依赖。
- 当前模型没有历史“监控生效日期”字段；本轮按需求复用当前 active/monitored 范围计算历史窗口，没有虚构历史范围。

---

## 等待用户确认

- 无。

---

## 下一步

1. 后续如继续设备模块，先读取本进度文件、项目规范和当前工作区，再从新需求开始。

本次趋势备份：

- `data/backups/four_department_tracker_20260922_140411.backup`
  SHA-256：`d5d67e4bbb698a10215c2a68e565659399cbf118cc5ff7c5dec11910ba86b011`
- `data/backups/kdos_20260922_140411.backup`
  SHA-256：`27a9f26512dca34f0990758f951ce4b91ca407e7abfc242f832a4b57a8eca421`
- `data/backups/uploads_20260922_140411.tar.gz`
  SHA-256：`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`

本次趋势部署镜像：

- API：`sha256:1099c704e4165e549500ced9a343a1fcb8e0a1286bbfc027ffcd8e3b0d0ffe17`
- Web：`sha256:cce9ccffe11257ec504095fa1245a86a6e33ff5d5461d94a9e9e10df759433de`

本次拆表备份：

- `data/backups/four_department_tracker_20260922_134925.backup`
  SHA-256：`43fe119746077b3db002470abb0b7b3f7d63b86eca8815637097c1664103eaa3`
- `data/backups/kdos_20260922_134925.backup`
  SHA-256：`ff4905487d18d01e7a40d13916e4dbbb1f5d2316568a92eb1668a5adfd03058a`
- `data/backups/uploads_20260922_134925.tar.gz`
  SHA-256：`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`

本次拆表部署镜像：

- API：`sha256:a01f52d93f7a934a5c722b10ac4db00dd1343514d5847ebe826cc5552f51bc26`
- Web：`sha256:4acffd4f436ba3b218a86cb909b84ccd283e4fd508c6abfd7573391542841823`

本轮 ECharts/大屏修复备份：

- `data/backups/four_department_tracker_20260922_125724.backup`
  SHA-256：`88106f8a9f100e021a9694644b7263cdc29890c92a0e3e6209e05f125f74f523`
- `data/backups/kdos_20260922_125724.backup`
  SHA-256：`736239be0f4ad8962f479f7913207cc86c9508141dd12c5fd01a2456a164a117`
- `data/backups/uploads_20260922_125724.tar.gz`
  SHA-256：`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`

本轮 ECharts/大屏修复部署镜像：

- API：`sha256:d58cdf7aea1147768d59580104193e6708a96e2ac7c240f69e21af33c957c812`
- Web：`sha256:25ca152e2abdf9daee7ca665936095197856e69fc16aa7e2092a61f1025cc5bc`

本轮新增备份：

- `data/backups/four_department_tracker_20260922_113850.backup`
  SHA-256：`41e478093568b637b168a01290b296395b81bb497b1e238ffdb06b9c2cdaaa64`
- `data/backups/kdos_20260922_113850.backup`
  SHA-256：`a3298dde1e5f18c4f3372b1cd2a48ea98fa612f7e9d993fe45b623237e237b13`
- `data/backups/uploads_20260922_113850.tar.gz`
  SHA-256：`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`

本轮部署镜像：

- API：`sha256:378b1c829cfb4a8a414433b210af3332c0d64c1bca908d34a1de37cf4bb8f7c1`
- Web：`sha256:b802f53e32df0d411d1e863364db6cf60904a07236c5d82b4a5215f540d2d3dc`

本轮大屏增强备份：

- `data/backups/four_department_tracker_20260922_120207.backup`
  SHA-256：`46fb99c0dfd7515dfefd83fec7ba2671ec993d1caf699a656277d6b60c7a8dde`
- `data/backups/kdos_20260922_120207.backup`
  SHA-256：`51aa5745a9427cb59279647590d013274fdfbd4c3e48e133ae812a8c87c6ba59`
- `data/backups/uploads_20260922_120207.tar.gz`
  SHA-256：`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`

本轮大屏增强部署镜像：

- API：`sha256:35aa7b5e6bee34869b3898b7d496774b593a36e6229808aa2a94bc0f91132b65`
- Web：`sha256:4fb6386edb0a7d8dfcb47fa6f31344a15e2ad7749099f2aa5b69c7642bc82c68`

本次备份：

- `data/backups/four_department_tracker_20260922_091118.backup`
  SHA-256：`9ebb21a3becd28d1cd0a53f8988adafd44d6b9bc991941806e1d91577988fe2c`
- `data/backups/kdos_20260922_091118.backup`
  SHA-256：`8f7e633e8893b74390fd0b2f16bcbcd2422966065b4db8789b854b12f2ccd334`
- `data/backups/uploads_20260922_091118.tar.gz`
  SHA-256：`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`

部署镜像：

- API：`sha256:3ea41b0bf8dc7ae203b985306c85e2ebe9f06c5b5ea9043c76479ca95f309b3b`
- Web：`sha256:b7b94e9485308a981588c6cf0f3616f87f9cc01385ce16af1f3290adcbbf144d`

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md、`.agents/skills/kdos-form-platform/SKILL.md` 和本进度文件。
2. 执行 `git status`、`git diff --stat`，保留用户修改。
3. 从“下一步”的第一项未完成任务继续，不重复已完成工作。
