# 消息中心规则编辑与启停

适用页面：消息中心 → 消息规则（`/system/notifications`）。系统管理员及资源所属模块管理员可以管理；普通用户及其他模块管理员由服务端拒绝。

财务规则 `finance.monthly.daily_summary` 初始停用、接收对象为空。先点“编辑”，选择组织架构、角色或员工，可多选及混选，保存后再启用。停用草稿允许尚未选择接收人。列表显示当前对象名称；重新打开时读取最新详情，不保留上次取消的表单内容。

启用时按正式固定接收人解析器检查当前成员，至少一名本租户、已启用且有企业微信 UserId 的员工才允许启用。个别员工缺少映射不影响编辑或其他有效员工；投递时继续逐人校验和记录跳过原因。兼容目录组织/角色为共享对象，候选员工、配置员工ID及最终固定接收人员均按租户限定。动态PMC接收人走原专属解析路径。

只提交 `enabled` 和 `expectedVersion` 的 PATCH 仅更新状态、审计信息和版本，原配置JSON、接收人、模板均保留；停用不要求历史接收人仍然有效。保存成功先应用返回的新版本，再刷新列表。409提示“刷新后重试”，编辑中刷新会重新读取最新配置，需重新确认修改。

## 企业微信群机器人路由与收件人组

群机器人管理、通知收件人组、消息路由各有独立资源权限。收件人组按当前租户保存组名、可选组织/业务分类、用途、说明及群机器人成员；成员只引用已登记的机器人ID，管理日志记录成员标识，不记录Webhook密文。启用组至少包含一个机器人，引用中的群机器人可独立停用；停用组或机器人不会收到消息。

群路由可选择一个或多个收件人组，也可继续选择单个群机器人。派发时按当前路由和组成员实时展开，过滤停用对象，并按Webhook目标ID去重；因此同一机器人同时直接选中和经一个或多个组命中时，每个消息组件只向该机器人创建一条投递。所有配置服务端按租户校验并写入审计，版本冲突要求刷新；仍复用现有 `WECHAT_GROUP_WEBHOOK` Dispatcher，不改变 `WECHAT_WORK`。

设备故障变化保留既有企业微信工作通知规则，并允许额外配置一个独立群路由。管理员将 `设备故障变化` 事件关联到设备管理收件人组后，同一个 outbox 事件会为原个人规则和群路由分别创建投递记录；没有群路由时维持个人消息行为。群消息使用该规则当前渲染的内容。

`GET /api/v1/notifications/recipient-groups`、`POST /api/v1/notifications/recipient-groups`、`PATCH /api/v1/notifications/recipient-groups/:id` 和 `POST /api/v1/notifications/recipient-groups/:id/delete` 维护收件人组。组成员不能删除仍被组引用的机器人；消息路由引用中的组不能删除。需要移除时，先更新路由或组成员关系。

## 只读接收人校验

`GET /api/v1/notifications/rules/:id/recipient-preview` 适用于 `FIXED_USERS`，返回去重后的 `total / deliverable / disabled / missingWechatId`。它复用正式成员解析，不入队、不创建投递记录，也不向企业微信发送；同规则详情一样校验租户和模块管理员权限。它不返回员工身份明细。

启用无有效成员返回400及 `code=NOTIFICATION_RECIPIENTS_REQUIRED`，前端提供“编辑接收人”入口；不存在/跨租户规则404；无管理权限403；版本冲突409。原真实测试发送接口语义不变，不应在例行验收中调用。

## 回归及发布

- API单元：notification-admin / notification.service / notification-event.registry / notification.migration，以及原PMC通知/分配相关测试。
- Web单元：NotificationGroupRouting、NotificationCenterPage；Chrome合成：`pnpm --filter @tracker/web exec playwright test notification-rules.spec.ts --workers=1`。
- PostgreSQL合成：构建API后，以隔离socket `/tmp/kdos-notification-pg-*` 设置 `NOTIFICATION_TEST_POSTGRES_HOST`，执行 `node scripts/test-notification-rules-postgres.cjs`。脚本拒绝其他连接目标，使用临时数据库并自动清理，不调用投递provider。
- 收件人组变更附加migration；应用回滚不删除组、路由及投递历史。不会因本功能修改设备日报生成流程或n8n调度。
