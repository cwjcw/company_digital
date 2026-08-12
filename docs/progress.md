# 实施进度

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 环境与 Excel 分析 | 完成 | Node 22、pnpm 11、PostgreSQL 18 服务；4 Sheet 与 77 列已验证 |
| pnpm workspace 与健康检查 | 完成 | web/api/shared 均可编译 |
| 实体、migration、索引、seed | 完成并已验证 | PostgreSQL 真实执行 migration 和幂等 seed，创建全部表、约束与月初函数 |
| 登录、角色、字段权限、数据范围 | 完成 | JWT、初始角色、API 强制范围检查 |
| 77 列月度计划 | 完成 | 双层表头、虚拟横向滚动、编辑、筛选、自定义 TSV 粘贴 |
| 工序、外协、字典、供应商、滚动汇总 | 完成 | 14 工序配置化，滚动汇总实时计算 |
| 乐观锁、WebSocket、审计 | 完成并已验证 | 真实单元格更新从 v1 到 v2；旧版本更新返回 HTTP 409，审计记录已写入 |
| Excel 导入导出 | 完成并已验证 | 真实导入 2026 年 8 月 2 个品号；预览、警告、事务确认、业务键幂等、双层表头导出 |
| Swagger 与自动化边界 | 部分完成 | Swagger/OpenAPI 已有；API Key 表和幂等表已建，管理端点待扩展 |
| 测试、PowerShell、README | 完成 | lint/typecheck/unit/API integration/build/Playwright 已通过；migration 与 seed 可重复执行 |
