# 消息规则修复验收

状态：已完成，正式部署/Chrome验收/GitHub同步均通过。基线API/Web/GitHub：7c3176b61c36486c51a6723895b10b2b92674a9a。

根因：员工候选SQL遗漏enabled，前端将全部员工过滤；弹窗外持有Form实例，initialValues跨关闭/重开保留；固定接收人校验没有区分停用草稿与启用，且启用只反馈toast；原状态更新复用完整规则重写路径、前端只异步失效缓存且无409恢复操作。

修复：补候选enabled及员工租户约束；每次编辑读取新详情并重新挂载表单；保存更新缓存并等待刷新；状态PATCH只写enabled/审计/版本；停用草稿可编辑，启用至少有一名当前租户启用且配置企业微信ID的成员；添加只读接收人统计预览，不入队/不发送。固定接收人解析增加最终员工租户条件，动态PMC路径不变。接收人列表显示当前名称，403/409及候选失败可见并可恢复。

范围：无需数据库结构迁移；notification-event.registry.ts财务事件定义已正确，无需修改。PMC规则/接收人/供应商与事业部映射、文本、附件、发送专属代码，财务金额/08:30及所有调度保持不变。

备份：20261021_092513两库自定义格式及uploads/通知回执归档，格式/权限/SHA校验通过，真实文件仅本机受限data目录。

已通过：API全量1107（33既有skip）；最终消息/PMC/财务汇总相关130；隔离PG消息规则13；既有PMC完整PG20；新增Web消息规则6。Web全量431（57文件）、最终消息6；Chrome2完整场景；typecheck/lint/build通过。生产版本和配置核验结果发布后补记。

生产受控验收不调用真实测试发送或重试接口；规则最终恢复用户原配置/停用状态，保留测试操作版本和审计。真实目录和配置证据仅存data/notification-rules-repair-20261021，不提交Git。

实际生产Chrome8项通过：空接收人拒绝启用并进入编辑；三类真实目录对象保存；页面刷新/重开勾选回显；只读有效性预览；启用后停用且config完全保留；三类逐项取消并恢复原配置；旧版本409；财务队列始终0。受控期间持有财务汇总当日/次日锁，浏览器阻断非指定规则写操作，不调用发送/重试。财务规则最终停用/空接收人、原模板完整保留，版本1→5，仅审计与版本正常增长。

PMC专属规则、接收人和供应商映射、财务视图定义、n8n16工作流/12active全部定义摘要核对不变。正式Web/API/Repository/GitHub main一致：ccfc5fb5533cdb6b276e1befea862e26d899734c。正式健康检查与只读Chrome三类目录候选验证通过，原config/停用状态保留。临时PG/socket/worktree已清理。

修改文件（本次安全提交13个）：

- `apps/api/src/modules/notifications/notification-admin.service.spec.ts`
- `apps/api/src/modules/notifications/notification-admin.service.ts`
- `apps/api/src/modules/notifications/notification.admin.controller.ts`
- `apps/api/src/modules/notifications/notification.service.spec.ts`
- `apps/api/src/modules/notifications/notification.service.ts`
- `apps/web/e2e/notification-rules.spec.ts`
- `apps/web/src/modules/notifications/NotificationCenterPage.spec.tsx`
- `apps/web/src/modules/notifications/NotificationCenterPage.tsx`
- `docs/message-center-rules.md`
- `docs/operations/TASK_REGISTRY.md`
- `outputs/CODEX_PROGRESS.md`
- `outputs/NOTIFICATION_RULES_REPAIR_ACCEPTANCE.md`
- `scripts/test-notification-rules-postgres.cjs`
