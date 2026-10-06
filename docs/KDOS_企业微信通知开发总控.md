# KDOS 企业微信通知开发总控

## 安全与架构基线

- 企业微信统一通过 `/data/automation/code/work/basci/basic_code` 的 `WeChatPusher` 发送；密钥只保存在该工具包自己的 `.env`。
- KDOS 业务写入只负责在同一 PostgreSQL 事务中写入通知 outbox；API 在 Dispatcher claim 阶段完成事件注册校验、规则匹配和接收人动态解析。
- Python Dispatcher 只理解 `notificationId`、`content`、`recipients` 以及投递回调，不理解设备、出货、订单或计划业务。
- 已启用正式接收人直发：API 按规则动态解析当前用户，每个启用且配置企业微信 UserId 的用户拥有独立 delivery，Dispatcher 逐人发送并逐条回写。
- 通知规则、outbox 和 delivery log 均保持租户隔离、幂等、审计和失败重试语义。

## 阶段总览

### 阶段 1：通知内核通用化

状态：✅ 完成（任务 `KDOS-NOTIFICATION-EVENT-REGISTRY-006`）

目标：建立唯一 Notification Event Registry，将现有 `equipment.status.fault_changed` 迁入注册中心，移除 claim 主流程中的设备资源硬编码，并保持当时的设备通知、动态接收人、消息格式与验证期安全行为零回归。

设计结果：

- Registry：`apps/api/src/modules/notifications/notification-event.registry.ts`
- 正式事件：仅 `equipment.status.fault_changed`
- 正式渠道：仅 `WECHAT_WORK`
- 正式接收规则：`EQUIPMENT_RESPONSIBLE`、`FIXED_USERS`
- `FIXED_USERS` 继续支持 `ORGANIZATION`、`ROLE`、`USER` 混合选择、组织子树和 `users.id` 去重，并兼容旧 `recipientUserIds` 读取。
- 未注册事件、事件资源不匹配、事件不允许的接收规则均在 API 内安全隔离，不交给 Dispatcher。

修改文件：

- `apps/api/src/modules/notifications/notification-event.registry.ts`
- `apps/api/src/modules/notifications/notification-event.registry.spec.ts`
- `apps/api/src/modules/notifications/notification.types.ts`
- `apps/api/src/modules/notifications/notification-admin.service.ts`
- `apps/api/src/modules/notifications/notification-admin.service.spec.ts`
- `apps/api/src/modules/notifications/notification.service.ts`
- `apps/api/src/modules/notifications/notification.service.spec.ts`
- `docs/integration-guide.md`
- `docs/KDOS_企业微信通知开发总控.md`
- `outputs/CODEX_PROGRESS.md`

测试：通知专项 5 suites / 35 tests；API 全量 79 suites / 607 tests 通过（另有 1 suite / 1 test 按既有规则跳过）；Web 全量 27 files / 167 tests；Dispatcher Python 6 tests；全仓 lint、typecheck、build 全部通过。

部署：无数据库结构变化、无 migration；实施提交 `83a9fe1` 已推送 `github/main`，`./scripts/deploy.sh api` 成功，API Build 与实施提交一致。Web 无代码修改，按任务约束未做无意义重建；因此全量 SHA check 会保留旧 Web Build，但 Web、API、PostgreSQL 三个服务均为 healthy。

验证：Web、API health、OpenAPI、Swagger 均返回 HTTP 200；部署容器内 Registry 只包含 `equipment.status.fault_changed` 及 11 个正式模板变量；Dispatcher user-systemd 为 `active/running`、`NRestarts=0` 并持续空队列轮询。当时生产数据只读核验了验证期单人安全投递；本任务未制造新业务数据，也未重复发送企业微信。

Git SHA：核心实现提交 `83a9fe1`（`refactor(notifications): add event registry`）；总控与部署结果补录使用后续文档提交，详见 Git 历史。

已知问题：本机 Node.js v22.23.1 低于项目目标 Node.js 24，pnpm 有 engine warning，但全部本地门禁实际通过；正式 API 容器已使用 Node.js 24 构建。无本任务新增运行问题。

### 阶段 2：生产正式接收人切换

状态：✅ 完成（任务 `KDOS-NOTIFICATION-PRODUCTION-CUTOVER-007`）

设计与实施结果：

- 删除 API 中的替代接收人、多 delivery 合并回写和模式分支；一个可发送用户对应一个 delivery ID 和一个企业微信 UserId。
- 禁用用户和缺少企业微信 UserId 的用户分别记录 `SKIPPED_DISABLED` 和 `SKIPPED_MISSING_WECHAT_ID`，不阻断其他接收人。
- Dispatcher 只信任 API claim 的正式接收人列表，不再使用单人名称/用户门禁，逐人调用 `send_app_text`。
- Web 删除验证期顶部提示和双层接收人列；“测试发送”明确告知将真实发给规则当前接收人。
- 新 migration `NotificationProductionCutover1722920081000` 删除已退役的替代接收人字段和索引；历史 migration 保留以维持不可变的迁移链。
- 生产已严格按“停 Dispatcher → 检查旧队列 → 备份 → migration → API → Web → 实际 user-systemd → 启动与健康检查”完成切换。切换前 `PENDING` / `PROCESSING` / 可重试 `FAILED` 均为 0，因此隔离处理为 0 条，历史终态记录未改动。
- 备份已于 2026-10-04 20:55 +0800 生成并通过 `pg_restore --list` 校验：`four_department_tracker_20261004_205409.backup`、`kdos_20261004_205409.backup`、`uploads_20261004_205409.tar.gz`，均位于 `data/backups/`。
- 生产 migration 已执行，全部 80 个 migration 均为已应用；退役的 3 个字段和 1 个索引已确认不存在。
- 正式实发已验证：单人 outbox `01a10700-171c-7d01-93d4-fa79fc28f5c4` 产生 1 条独立 SENT delivery；双人 outbox `01a10700-dbb4-7d43-bcaf-6b7545bb15d8` 产生 2 条独立 SENT delivery，对应 2 个不同 provider message ID，均返回 `errcode=0` / `errmsg=ok`。验证规则已恢复为原单人配置。
- 质量门：API 79/79 suites、610/610 可执行测试；Web 28/28 files、180/180；Shared 7/7；Dispatcher 6/6；全仓 lint、typecheck、build 通过。
- 部署后 Web、API、Swagger、OpenAPI、PostgreSQL 均健康；Dispatcher user-systemd 为 `active/running`、`NRestarts=0`，实际单元已无单人门禁环境变量。

已知问题：本机 Node.js v22.23.1 低于项目声明的 Node.js 24，但本轮门禁均通过，生产容器使用 Node.js 24。无本任务新增运行问题。

### 阶段 3：出货计划变化

状态：🟡 单条人工修改已实现，生产规则与真实企业微信实发待完成（`KDOS-NOTIFICATION-SHIPPING-PLAN-008`）

已实现范围：

- Event Registry：`shipping_plan.key_fields_changed`
- resource：`mps-shipping-plans`
- 仅覆盖 `PATCH /master-plan-system/resources/mps-shipping-plans/:id`。
- 关键字段：`orderNumber`、`itemCode`、`latestCustomerDueDate`、`plannedQuantity`、`divisionId`。
- 业务 UPDATE、审计、`notification_outbox` 使用同一 `EntityManager` 事务；一次保存多个关键字段只入队一个事件。
- 接收规则仅允许 `FIXED_USERS`，复用组织/角色/员工解析与去重。
- 事件 payload 包含 `recordId`、订单/品项/客户/事业部信息、`changeSummary`、修改人和时间。

明确未覆盖：新建、删除、批量修改、Excel 导入、`shipping-to-base`、`base-to-weekly`、ERP 同步，以及动态销售/生管接收人。

待完成：在生产消息中心创建仅含崔玮杰的正式 `FIXED_USERS` 规则，选择安全出货计划单条修改一项关键字段，核验 outbox、recipient、delivery、provider message ID 和企业微信实收；完成后补录实际验证与最终 SHA。

## 后续事件接入规则

1. 先在 Notification Event Registry 登记事件元数据、资源、渠道、接收规则、模板与变量。
2. 业务 Application Command 在正式事务中调用 `NotificationService.enqueueEvent()`，不得由控制器或 Dispatcher 拼装业务查询。
3. 新接收规则只在 API recipient resolver 层实现；claim 主流程和 Python Dispatcher 不增加业务分支。
4. 管理端事件列表和模板变量只读取服务端 Registry，前端不得维护第二份事件定义。
5. 每个阶段完成后更新本文件的状态、修改文件、测试、部署、验证、提交 SHA 与已知问题。
