# 消息中心规则编辑与启停

适用页面：消息中心 → 消息规则（`/system/notifications`）。系统管理员及资源所属模块管理员可以管理；普通用户及其他模块管理员由服务端拒绝。

财务规则 `finance.monthly.daily_summary` 初始停用、接收对象为空。先点“编辑”，选择组织架构、角色或员工，可多选及混选，保存后再启用。停用草稿允许尚未选择接收人。列表显示当前对象名称；重新打开时读取最新详情，不保留上次取消的表单内容。

启用时按正式固定接收人解析器检查当前成员，至少一名本租户、已启用且有企业微信 UserId 的员工才允许启用。个别员工缺少映射不影响编辑或其他有效员工；投递时继续逐人校验和记录跳过原因。兼容目录组织/角色为共享对象，候选员工、配置员工ID及最终固定接收人员均按租户限定。动态PMC接收人走原专属解析路径。

只提交 `enabled` 和 `expectedVersion` 的 PATCH 仅更新状态、审计信息和版本，原配置JSON、接收人、模板均保留；停用不要求历史接收人仍然有效。保存成功先应用返回的新版本，再刷新列表。409提示“刷新后重试”，编辑中刷新会重新读取最新配置，需重新确认修改。

## 只读接收人校验

`GET /api/v1/notifications/rules/:id/recipient-preview` 适用于 `FIXED_USERS`，返回去重后的 `total / deliverable / disabled / missingWechatId`。它复用正式成员解析，不入队、不创建投递记录，也不向企业微信发送；同规则详情一样校验租户和模块管理员权限。它不返回员工身份明细。

启用无有效成员返回400及 `code=NOTIFICATION_RECIPIENTS_REQUIRED`，前端提供“编辑接收人”入口；不存在/跨租户规则404；无管理权限403；版本冲突409。原真实测试发送接口语义不变，不应在例行验收中调用。

## 回归及发布

- API单元：notification-admin / notification.service / notification-event.registry，以及原PMC通知/分配相关测试。
- Web单元：NotificationCenterPage；Chrome合成：`pnpm --filter @tracker/web exec playwright test notification-rules.spec.ts --workers=1`。
- PostgreSQL合成：构建API后，以隔离socket `/tmp/kdos-notification-pg-*` 设置 `NOTIFICATION_TEST_POSTGRES_HOST`，执行 `node scripts/test-notification-rules-postgres.cjs`。脚本拒绝其他连接目标，使用临时数据库并自动清理，不调用投递provider。
- 无数据库结构变更、无新消息模块、无财务金额或08:30调度调整。回滚应用镜像即可；保留配置、审计、既有通知记录。
