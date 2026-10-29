# 建议追加到项目根目录 AGENTS.md

## KDOS 业务表格删除标准

- 新增、修改或补齐**业务可维护表格**的删除入口、接口、权限或批量删除时，先阅读 `.agents/skills/table-delete-standard/SKILL.md` 并执行其检查清单。
- 适用业务可维护表；不适用于 ERP/E10/T+ 源系统只读表、审计日志、系统内部技术表和纯统计报表；业务状态禁止删除的记录遵循原有状态机和撤销/冲销逻辑。
- 删除操作使用已有 `delete` 表动作权限，无有效权限的用户**不可见**删除按钮，后端仍必须重新校验并返回 `403`；保持租户/数据范围/审计约束。
- 复用 `KdosDataTable.deleteAction`、既有权限体系及 Application Service，避免重复实现；如新增资源，先登记 `tableResourceRegistry`。
