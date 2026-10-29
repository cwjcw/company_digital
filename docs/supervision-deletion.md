# 项目与任务：受控删除

资源：`supervision-projects`、`supervision-tasks`。使用原表动作 `delete`、数据范围、管理员授权与 `KdosDataTable.deleteAction`，不新建权限体系、不自动授权、不新增数据库字段或 Migration。

## API 与事务

- `DELETE /api/v1/supervision/projects/:id?expectedVersion=<当前版本>`
- `DELETE /api/v1/supervision/tasks/:id?expectedVersion=<当前版本>`

Controller 验证 UUID，委托 Application Service。服务端分别检查 `supervision-projects:*:delete` 或 `supervision-tasks:*:delete`；仅系统管理员、`project-task` 模块管理员和该表有效授权可执行。其他模块管理员不能绕过本模块数据范围。

每次命令设置租户事务上下文，显式 tenant 条件，检查 delete 对应数据范围，锁定当前行后再次核对范围及版本。无权限 403；记录不存在、其他租户或范围外统一 404；无效版本 400；过期版本及业务关联冲突 409。

## 删除语义与保留

采用**受限物理删除**，仅删除无下列约束的独立业务记录：

- 项目存在任一下属任务或进展记录：拒绝；包括已中止任务。
- 任务存在任一进展历史：拒绝；包含进展、风险、交期变更、完成说明。
- 项目或任务存在附件：拒绝；不清理或移动对象存储文件。如需处理附件，继续使用原有有权限的编辑功能。
- 已完成或已中止的项目/任务：保留业务留痕，拒绝删除。

项目→任务、任务→进展、项目→进展继续使用已有 RESTRICT 外键。不会关闭约束或级联清理，不将完成、中止、撤销冒充删除。删除与 `supervision.project.deleted` / `supervision.task.deleted` 的前值审计同事务提交；审计失败时整笔删除回滚。审计保留，afterJson 为 null；重复请求不生成第二笔删除审计。

项目进度、任务统计与责任人报表原本实时聚合，不新增计数器或重写剩余任务。删除后自然按照剩余有效任务计算。

## 页面与反馈

项目/任务管理均通过行勾选＋顶部“删除”操作，可在浏览模式操作，无对应 delete 权限不渲染按钮。未选择时禁用。二次确认显示条数和业务编号（超过5条时显示前5个并注明“等”），说明关联限制；行内菜单保留原编辑、完成、中止、查看进展等操作，不增加删除。

多选复用 `deleteTableRowsSequentially` 逐条调用正式单条API，各条事务独立。准确返回成功/失败数，失败原因使用项目/任务编号展示；成功记录取消选择，失败记录保留选择。同步 ref 防重复提交。成功后失效本模块项目、任务、进展、项目选项、项目大屏、员工大屏、责任人报表及下钻缓存；刷新失败单独提示，不将已成功删除改报为写入失败。

## 验证与运行状态

定向覆盖独立权限、管理员/其他模块管理员、租户、OWN/CUSTOM及动作范围、版本/不存在、关联/附件/结束状态、审计回滚、并发删除一次、派生进度/统计、单多选确认/取消/部分失败/缓存刷新。持久化与HTTP测试使用专用network=none PostgreSQL18及合成身份，禁止在生产尝试删除真实项目或任务。

本轮本地实现及验收已通过；用户已追加授权隔离发布分支仅本次本地 commit、不 push，按既有 `scripts/deploy.sh` 发布。发布来源以原生产版本607eaec为基线，仅带本轮supervision变更；不含此前未授权上线的主计划改造或Migration111。证据与最终状态见 `outputs/CODEX_PROGRESS.md` 当前任务节和 `test/supervision_delete/acceptance.md`。
