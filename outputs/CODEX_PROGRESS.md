# Codex 工作进度

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
