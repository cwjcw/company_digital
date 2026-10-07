# 设备大屏明细与Excel导出

设备大屏新增未填报设备明细，复用设备台账的所属事业部、使用部门、设备编码、名称和实时责任人关联；不增加数据库字段。

统计、明细、导出共用`EquipmentQueryService.dashboard`。未填报取原`asset_state.state='未填报'`：当前租户及查看范围内的active、monitored设备，按现有日期/事业部/多部门筛选，在所选日期区间最后一天没有active填报记录。运行时长为0仍算已填报。月/年/自定义区间保持原“截至区间最后一天”的填报口径；运行分析时长仍累计整个区间。新数组`unreportedEquipmentRows`与KPI/事业部/部门的未填数量从同一SQL语句产生，因此同一响应内严格一致，没有第二套判断规则。

`GET /api/v1/equipment/dashboard/export/:table`接受同样的`periodType/period/startDate/endDate/divisionId/departmentId`，部门可以重复参数多选。`:table`仅支持：

| table | 对应表 | 文件名前缀 |
|---|---|---|
| unreported | 未填报设备明细 | equipment_unreported |
| division_reporting | 事业部填报与稼动情况 | equipment_division_reporting |
| department_reporting | 部门填报与稼动情况 | equipment_department_reporting |
| division_operation | 事业部设备运行分析 | equipment_division_operation |
| department_operation | 按车间/使用部门设备运行分析 | equipment_department_operation |
| utilization_detail | 设备稼动率明细 | equipment_utilization_detail |

文件名追加所选区间结束日期`_YYYY-MM-DD.xlsx`，直接使用已验证的业务日期文本，不做UTC转换。忽略page/pageSize，导出全部匹配行。空表返回400“当前筛选条件下暂无可导出数据”，未知table返回400。

查看与导出分别校验现有equipment-dashboard read/export权限，SQL同时执行两种数据范围的交集；宽导出授权不能突破窄查看范围。字段由现有read授权裁剪，新增的责任人和已存在分析计数字段登记在现有资源中；未填报明细字段隐藏不改变记录数量。事业部授权继续复用equipmentScopeClause；不支持的部门授权规则仍按原逻辑失败关闭，没有新增或扩大权限算法。成功导出写equipment.dashboard.exported审计，只包含表类型、行数和业务日期范围。

六个标题右侧按钮复用Ant Design Button、公共downloadApiFile和完全相同dashboardQuery参数。无导出权限隐藏；空数据、筛选读取中或导出进行中禁用；共享点击锁避免重复请求；使用现有AntApp消息上下文提示成功/失败。

六张聚合视图扩展已有EquipmentExportService和ExcelJS依赖，共用一套列规格/写表逻辑/原设备工作簿样式。平台记录表导出依赖独立记录source并把数值转为展示字符串，不适合直接承载该大屏多种聚合视图；未重构平台框架或注册六个重复资源。中文表头和字段顺序对应页面；只导出授权业务列。设备编码为文本以保留前导零；数量、时长为数字（时长值为分钟，显示格式为“分钟”）；百分比为真实小数值+0.0%格式，允许超过100%；null/undefined为空。责任人输出姓名，不输出UUID；工作表名中的Excel禁用字符替换为空格，页面标题不变。

测试：API/Web设备专项、完整回归和contracts校验；`data-operations/equipment/validate-dashboard-export.cjs`在单连接临时表事务中运行真实SQL和Excel验证，始终rollback，不写正式业务表。覆盖10/7/3、全填0、事业部/部门筛选、零运行已填报、租户/停用/无需填报、责任人、read/export范围交集以及pageSize20/100行导出。Playwright线上用例位于`apps/web/e2e/equipment-dashboard.spec.ts`，需要现有EQUIPMENT_E2E_USERNAME/EQUIPMENT_E2E_PASSWORD，不创建测试账号或修改生产权限。
