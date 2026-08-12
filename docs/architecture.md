# 技术架构

系统采用 pnpm workspace：

- `apps/web`：React、Vite、TypeScript、React Router、TanStack Query、Ant Design、AG Grid Community。
- `apps/api`：NestJS、TypeORM、PostgreSQL、JWT、Swagger、Socket.IO、ExcelJS。
- `packages/shared`：77 列字段契约、14 个工序定义、字典初始值和权限键。

PostgreSQL 是唯一运行时业务数据源。Excel 仅作为预览导入、导出和人工核对格式。

对于文件系统/DRM 加密导致的非标准 XLSX 容器，导入服务会在本机通过 Windows Excel COM 生成临时标准 XLSX，再交给 ExcelJS 读取。临时明文只存在系统临时目录，并在导入预览结束后删除；用户提供的文档密码仅传入当前解密进程，不写入数据库、审计日志或导入任务。

## 数据模型

`plan_periods(year, month)` 表达每个月份；`orders` 保存订单级字段；`order_items` 通过 `period_id` 保存某品号在某月的计划快照。销售接单汇总读取订单及其活动品号，并按订单计算执行数量与完成比例。

月度品号业务键为 `(period_id, order_id, item_number)`。同一订单/品号可在不同月份出现，不覆盖历史月份。

14 个工序通过 `process_definitions` 配置，进度值存入 `item_process_progress`，避免为每个工序复制硬编码表。外协使用一对一 `outsourcing_details`。

## 计算

所有数量与金额由 `DomainService` 使用 Decimal 精确计算：

- 欠数 = 生产数量 - 历史入库数量 - 当天入库数量。
- 已完成 = 总数量 - 欠数合计。
- 完成比例 = 已完成 / 总数量；总数为 0 时为 `null`。
- 入库金额和欠数金额使用十进制定点运算。

欠数为负时保留真实值并返回数据质量警告。

## 权限与协同

JWT 中包含角色、字段权限和事业部范围。API 在查询与修改时强制检查范围；单元格更新需要 `expectedVersion`，冲突返回 409。提交成功后写入审计日志并可通过计划 WebSocket 命名空间广播。

## 月初滚动

上海时区每月 1 日 01:00 调用数据库函数 `create_monthly_plan(year, month)`。函数创建新期间，并将上一有效期间仍欠数的品号复制为新月份计划；已入库数归零，生产数量转为未完成数量。函数通过业务唯一键可重复执行。
