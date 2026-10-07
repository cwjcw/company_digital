# 设备大屏明细与Excel导出验收报告

任务日期：2026-10-07（Asia/Shanghai）
当前状态：已完成，已部署当前运行环境并通过健康检查和真实数据/Excel验收。
最终代码版本：743cad7；未push。

## 1. 修改/新增文件清单

- `apps/api/src/modules/equipment/equipment-export.service.spec.ts`
- `apps/api/src/modules/equipment/equipment-export.service.ts`
- `apps/api/src/modules/equipment/equipment.application.service.ts`
- `apps/api/src/modules/equipment/equipment.controller.ts`
- `apps/api/src/modules/equipment/equipment.query.service.spec.ts`
- `apps/api/src/modules/equipment/equipment.query.service.ts`
- `apps/api/src/modules/equipment/equipment.spec.ts`
- `apps/web/e2e/equipment-dashboard.spec.ts`
- `apps/web/src/modules/equipment/EquipmentPages.spec.tsx`
- `apps/web/src/modules/equipment/EquipmentPages.tsx`
- `data-operations/equipment/validate-dashboard-export.cjs`
- `docs/equipment-dashboard-export.md`
- `packages/contracts/src/equipment-dashboard.ts`
- `packages/contracts/src/index.ts`

另更新唯一进度入口outputs/CODEX_PROGRESS.md并生成本报告，保留上一任务outputs；不提交私有data或凭据。

## 2. 数据库migration

无。复用equipment_assets、equipment_status_reports、equipment_responsibles、users，不改业务表结构或已执行迁移。

## 3. npm依赖

无新增。复用已安装ExcelJS、Ant Design、KdosDataTable、downloadApiFile。

## 4. API列表

新增GET `/api/v1/equipment/dashboard/export/:table`，table为unreported/division_reporting/department_reporting/division_operation/department_operation/utilization_detail。

现有GET `/api/v1/equipment/dashboard`新增unreportedEquipmentRows数组，元素复用equipmentId、divisionName、usageDepartmentName、equipmentCode、equipmentName、responsibleUsers。不另建独立明细筛选API。筛选仍为periodType/period/startDate/endDate/divisionId/departmentId（重复参数多选）。

## 5. 未填报判断

原SQL asset_state.state='未填报'：tenant+数据权限+日期/事业部/使用部门筛选内的active、monitored设备，筛选日期区间最后一天没有active填报记录；运行时间0仍已填报。月/年/自定义范围的未填报仍查看区间末日，不改成“区间内任一天缺失”；时长和稼动率维持现有累计口径。

## 6. 统计与明细一致

从同一SQL语句的monitored/daily_reports/asset_state产生KPI、分组和明细；没有第二套未填报判定。隐藏字段只裁剪字段，不裁剪记录。真实临时表验证10应填/7已填/3未填明细；全填0；事业部/部门筛选一致。

## 7. 六张表导出

在现有EquipmentExportService添加一个dashboardExport方法，六表共用contracts列规格、统一写表、原设备样式和公共下载；查询只调用现有dashboard。

| table | 导出来源 | 英文前缀 |
|---|---|---|
| unreported | unreportedEquipmentRows | equipment_unreported |
| division_reporting | operationsMonitoring.yesterdayDivisionRows | equipment_division_reporting |
| department_reporting | operationsMonitoring.yesterdayDepartmentRows | equipment_department_reporting |
| division_operation | divisionRows | equipment_division_operation |
| department_operation | departmentRows | equipment_department_operation |
| utilization_detail | equipmentRows | equipment_utilization_detail |

中文表头、页面顺序、白名单业务列；数字保持数字，分钟数字显示“分钟”，百分比真实小数+0.0%格式，支持超过100%；编码文本保留前导零；成员为姓名，null/undefined空白。文件名日期直接使用业务区间末日文本，不做UTC转换。Excel工作表名称的斜杠等非法字符转为空格；文件名英文。六按钮位于各表标题右侧，无权限隐藏，空表/查询中/导出中禁用，共享重复点击锁；现有AntApp消息提示成功/失败。

## 8. 全部匹配记录

导出不使用分页LIMIT，page/pageSize不会截断结果。真实PostgreSQL+Excel已验证：传pageSize20，100条稼动率明细导出100条；93条未填报明细导出93条。页面仍使用既有分页/表格交互，新明细复用公共表格分页。

## 9. 权限

现有equipment-dashboard read/export独立校验；SQL执行read与export数据范围交集，导出ALL不能突破查看CUSTOM。字段read权限约束输出列，成功导出记录equipment.dashboard.exported审计（表/行数/日期范围，无完整敏感行）。新增责任人及现有分析计数字段登记在同一权限资源，没有新权限算法。不支持的部门授权配置按现有helper失败关闭，不扩大范围。租户条件及设备责任人关联均带tenant。

## 10. 自动化测试

设备API专项原70项通过，新增审计租户/权限测试包含在最终全量中通过（设备相关合计71项）；最终API全量84 suites/699通过，1 suite/1 test skipped。Web设备专项16通过；Contracts22通过。真PostgreSQL临时表事务验收PASS并rollback，覆盖数量、日期/月末、部门/事业部、零时长、责任人、租户/停用/无需填、权限交集、六表XLSX、100行不受20分页限制。Excel单测验证中文头、列白名单、空值、前导零、真正百分比、数字、字段权限、文件名、空表/未知表拒绝。Web验证六按钮和共用筛选、loading/重复点击、失败提示、无权限隐藏与空表禁用。

Web全量28文件/185项已执行：184通过，唯一失败为未修改的MasterPlanPages.spec.tsx Case3在错误提示后立即检查loading恢复的异步时序波动；该文件独立复核34/34通过（71.40秒），无代码或断言改动。设备16项在完整回归中均通过。保留首轮失败记录，不声称单次全量185全部通过。设备Playwright2项因没有现有EQUIPMENT_E2E_USERNAME/EQUIPMENT_E2E_PASSWORD明确skipped；没有创建测试用户、修改密码或绕过AuthGuard。

## 11. Build

API/Web/Contracts typecheck，API/Web lint，API/Web生产构建通过；Web仅已有Fast Refresh及chunk体积提示。本机Node22低于项目声明24，Docker部署使用Node24。最终API/Web Node24 Docker镜像构建成功。

## 12. 部署与线上核验

最终标准备份20261007_130645已完成并验证pg_restore目录；SHA256：

- `ce43627c06bfd5c378eef200bf0a67a2d333dbda678db0ef7e30183ce9070edb  data/backups/four_department_tracker_20261007_130645.backup`
- `d7fd1135a38af17a0c5451e75682bf58a0ee10091e8b6868bccde17c8b32ee93  data/backups/kdos_20261007_130645.backup`
- `089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533  data/backups/uploads_20261007_130645.tar.gz`

migration:show为82已应用/0待执行，无新增migration，无seed。标准scripts/deploy.sh all成功，Repository/Web/API均743cad7，再次检查CONSISTENT。Web/API/Swagger/OpenAPI/PostgreSQL健康检查通过；新路径已进入线上OpenAPI，匿名实际导出HTTP401。

真实部署后2026-10-06：396应填/179已填/217未填；未填报数组217行、Excel217行。全部原dashboard字段与升级前基线逐字段完全一致，包括运行/计划时长、稼动率、趋势和分组，业务口径未变。

| 表类型 | 文件名 | 实际数据行数 |
|---|---|---:|
| unreported | equipment_unreported_2026-10-06.xlsx | 217 |
| division_reporting | equipment_division_reporting_2026-10-06.xlsx | 5 |
| department_reporting | equipment_department_reporting_2026-10-06.xlsx | 20 |
| division_operation | equipment_division_operation_2026-10-06.xlsx | 5 |
| department_operation | equipment_department_operation_2026-10-06.xlsx | 20 |
| utilization_detail | equipment_utilization_detail_2026-10-06.xlsx | 396 |


传pageSize20仍导出396行；六份文件经ExcelJS重新打开，中文头、列数、业务日期文件名和全部行数均符合预期。验证文件放ignored私有data/equipment-dashboard-validation，不公开到Web、不进入Git。

首次审计复核发现新导出沿用的旧助手未填tenant，已仅修复本次新增recordDashboardExport，显式记录actor.tenantId并增加测试；没有修改旧助手或改写已有审计。最终独立requestId验收产生6条带KAINAN租户的equipment.dashboard.exported审计。

使用已部署的正式Query/Export/Application服务连接真实数据库验收。没有现有E2E登录凭据，两个登录态Playwright用例skipped，普通JWT线上成功GET/下载没有单独运行；对应业务、权限、交互与格式已由自动化及真实服务验收覆盖，未绕过AuthGuard或创建测试账号。

## 13. 人工验收步骤

1. 使用有equipment-dashboard查看及导出权限的账号，进入PMC中心设备管理大屏。
2. 选择2026-10-06或其他已填报日期，核对“未填报”数字与新明细总条数一致；零运行填报设备不应出现在未填明细。
3. 分别切换事业部、部门多选、日期、月/年/自定义区间，重复核对；月/年/自定义未填报取所选区间末日。
4. 在六个表标题右侧依次点击“导出 Excel”，用Excel/WPS打开：中文首行、字段顺序、英文日期文件名、分钟/数量可SUM、百分比可计算、空值为空、无操作/UUID/内部字段。
5. 将明细翻页或调整每页显示，导出行数应始终等于全部筛选匹配记录；396条设备明细不能仅导出当前页。
6. 用仅事业四部授权账号重复筛选/导出，文件只能包含授权事业部；无export权限没有按钮，直接请求API仍应403。
7. 空结果导出按钮禁用；重复点击不触发多次下载；模拟网络失败确认显示错误并恢复按钮。

最终状态：已完成。部署、健康检查、版本一致、旧口径全字段对比、六表真实Excel及带租户审计验收PASS。源码提交f8b7387/743cad7，未push；仅outputs最终记录保留工作区。
