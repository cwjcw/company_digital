# 出货计划非必填字段与 Excel 身份列

出货计划 `itemName`（品项名称）、`orderDate`（下单日期）、`modelAge`（新旧款）均允许空值。网页新增、修改、Excel 预览和确认共用字段元数据与 Application 校验；空字符串由原有规范化逻辑转为 NULL，不填充替代品名。

新增仍要求客户编码、订单编号、品项编码、最迟客户交期、计划数量、承接事业部。计划数量允许零，不允许负数。修改时保留原有必填校验、数据范围、字段权限、开放星期、租户隔离和乐观锁。

Excel 导入约定：

- 保留“记录ID”“版本”两列；新增时两列均留空，更新时均填写真实导出值。
- 仅填一列、无效或不存在的 ID、无效或过期版本均拒绝。删除身份列会明确提示恢复系统导出列，不会猜测为新增。
- 已知字段按实际表头及明确历史别名定位，不使用隐藏 `_字段定义` 中过期的列号覆盖真实表头。
- 仅当完整表的列结构与隐藏定义仍吻合时，兼容旧模板修改显示标题；删列、插列或已知表头移位后禁用位置回退。身份列始终按当前表头定位。
- 删除可选业务列表示未提交该字段；保留列但清空单元格表示清空该字段。更新时未提交字段保留原值。
- 确认仍重新检查权限、业务规则、ID 和版本，整批事务及幂等行为保持不变。订单分配表的独立批次新增逻辑不受影响。

2026-10-20 以 READ ONLY 事务检查生产 `public.mps_shipping_plans`：上述三列均 `is_nullable=YES`，均无默认值；额外 CHECK 仅涉及交期编码、非负计划数量、正整数版本。无需数据库迁移。

验证使用合成工作簿和模拟持久层，调用真实 Application 与 Spreadsheet Service 完成新增、修改、预览及确认；覆盖全部六个其余必填项、删除业务列、身份列删除/移位/旧定义、ID/版本成对校验及真实当前身份要求。Chrome 用完整 API 拦截验证网页，禁止向生产提交测试记录或导入预览。

回归命令：

```bash
pnpm --filter @tracker/api test --runInBand --testPathPatterns='master-plan.(shipping-optional|config|application.service|spreadsheet.service)'
pnpm --filter @tracker/web exec vitest run src/modules/master-plan-system/MasterPlanPages.spec.tsx
E2E_BASE_URL=http://127.0.0.1:15172 pnpm --filter @tracker/web exec playwright test e2e/master-plan-shipping-optional.spec.ts --workers=1
```

部署前通过 API、Web、Contracts、类型检查、lint、构建及备份门禁；不执行任何新增迁移，不导入用户 Excel，不执行生产业务写入验收。部署后检查 Web/API 版本一致和健康；线上实际写入行为由上述合成数据自动化测试覆盖。
