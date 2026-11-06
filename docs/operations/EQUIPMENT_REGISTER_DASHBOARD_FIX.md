# 设备总台账编辑及集团设备大屏维度修复

日期：2026-11-06，主开发基准392007b。主恢复入口仍为outputs/CODEX_PROGRESS.md末尾本任务章节。本轮允许本地提交及生产发布，明确不push GitHub。

## 1. 根因与Git证据

- 原台账行级`openEdit(row)`入口由e0ea011引入，在本次修改前的main及真实生产Web755f6db中仍存在，**不是某个设备页面commit主动删掉了这段按钮**。`git log -S`与逐行blame核实。
- 直接导致入口不可见的提交为`fbdad10083bc9988780f69dbb5be106b35e7c826`（2026-11-03，feat(tables): persist personal display and print settings）。该次共享表格改造引入availableFieldKeys的正式metadata＋字段read白名单；旧“操作”列不属于正式字段，因而被过滤。其目的为个人字段/打印偏好及字段权限统一，页面遗留的行级按钮因此不可见，并非一次完成的公共编辑模式接入。
- 设备台账没有传editable，默认false；只有Modal维护，没有行内编辑器，所以公共编辑入口也没有补上。原设备台账两项测试仅覆盖服务端筛选入口和开机时长展示，没有“获权进入编辑→单元格PATCH→退出”的断言。原设备Web测试另有6个既有失败，本轮与前轮完整Web基线逐标题对比相同，不能把其视为已通过的发布保护。
- 大屏API实际上返回divisionId/division及departmentId/department。旧列按division、department取展示值，但Registry只有divisionId、departmentId，且“所属事业部/使用部门/车间”与正式label不相同，名称列被同一白名单过滤。生产修复前Chrome确认5条事业部、22条部门记录有数值但缺维度表头。

## 2. 实现

### 设备台账

- 正式启用KdosDataTable公共编辑模式；默认readonly，主题蓝色“编辑”/“退出”保留完整aria-label。新增设备、刷新移入同一公共工具栏，删除仍沿用原独立顶部“停用”，不恢复固定操作列。
- EquipmentRegisterCell根据真实Registry、字段read/update、公共模式及后端canUpdate渲染组织、文本、日期、非负整数分钟、布尔和多成员编辑器。文本/数字失焦或Enter/Tab保存；选择控件正式选定保存；未变不发请求。
- PATCH仅发送变更字段及expectedVersion；同记录提交互斥、失败还原单元格并显示持续错误；只刷新查询缓存，不整页reload。退出不另执行保存。
- API正式Application Command兼容单字段更新：锁定当前租户行，校验read/update、旧/新范围、字段read/update、版本及值类型，合并未修改值，沿用原保存及事务审计。409不覆盖新值，无变化不更新版本/审计。停用设备不能借编辑恢复。
- 设备编号被状态记录、工作簿匹配和历史快照引用，本轮将正式Registry设为只读，后端包括管理员也拒绝更改编号；新增时仍可填写。生产只读检查确认旧equipmentCode更新授权为0，没有改授权组或成员。
- 成员未变时保留原关联ID；更新其它字段不重验/重建未变成员。新选成员必须属于本租户且启用；新审计记录tenant及成员前后快照。不修补历史审计。

### 维度显示与公共映射

- KdosDataTable新增可选公共column.permissionField。保留原column.key/dataIndex作为展示、排序和个人配置键，以显式permissionField查正式metadata和读取权限；未知映射拒绝，不回退到同名可读字段，管理员也不能显示未注册列。分组子列同样生效。
- 设备台账组织别名及同源大屏组织列使用该映射：division/ divisionName→divisionId；dashboard department/usageDepartmentName→departmentId；台账usageDepartmentName→usageDepartmentId。
- 不新增division、department独立身份字段，不改员工布局、宽度或排序键。新增回归验证已保存divisionName列及232px宽度不变且不触发偏好写入。
- API按正式身份字段读取权限裁剪相应名称/ID，不靠前端隐藏授权。原导出definitions的permissionField与页面一致，保留原服务端read∩export范围。
- **没有修改任何设备统计SQL、数量/金额/稼动率公式、筛选、昨天及七天口径。无Migration。**

## 3. 验证

| 检查 | 结果 |
| --- | --- |
| API相关8套 | 98项PASS，含真实隔离PG6项：部分更新/版本/审计、历史状态与成员ID保留、无变化、字段/资源/租户/旧新scope、编号只读、并发 |
| Web共享表格 | 29项PASS（含3项显式映射、旧布局/宽度保留、未知或越权映射拒绝） |
| Web设备新增 | 最终9项PASS：默认只读/编辑退出/公共工具栏/只读用户/字段与行scope/PATCH版本/无变化/409/真实维度展示 |
| Contracts | 27项PASS，含正式只读编号、可编辑字段及导出身份映射检查 |
| 原设备Web16项采样 | 10PASS/6FAIL；6个完整标题与前轮基线相同，未删除用例或放宽断言；未宣称全Web或全仓库PASS |
| 类型、lint、构建 | API/Web/Contracts及独立发布基准检查通过；保留现有ModulePortal热更新warning及Vite大包提示 |
| 真实生产Chrome | 最终结果与证据见下节；使用正式登录会话，非生产假页面 |

隔离PG18容器network=none、tmpfs、无host端口，只用专用Unix socket和合成记录。原件、生产截图及Excel只在ignored、受限目录test/equipment-register-dashboard-fix，不提交业务数据、凭据、备份或数据库。

原6个失败：EquipmentStatusReportPage live permissions / deletes a status row with its optimistic version in the query string；EquipmentRegisterPage server filters / renders planned startup time in hours and minutes；EquipmentDashboardPage date filters / renders total and per-division ECharts dual-line trends with one shared axis；equipment dashboard detail and six exports / shows master-data fields and all six title-level export buttons with a common full-filter URL；同组 / prevents repeat clicks, restores the button, and displays download failures；同组 / exports the same division and department filters as the dashboard request。它们是先前记录的fixture/字段授权/图表预期失败，本轮新增正负权限及生产Chrome验收独立覆盖本次目标。

## 4. 限定发布与恢复

- 发布前实际API为eeaac326、Web为755f6db。主main包含未上线主计划118～122，不能整批部署main。本次从两个真实生产基准分别建立干净linked worktree，只加入设备/公共字段映射的限定改动；设备原文件与main原版本逐字节比较一致后应用补丁。
- API分支fix/equipment-edit-api-20261106：`6d0c81bf4a0863b18eca5ee4abed8a5ab9b525ec`，8个任务文件；没有主计划变更。
- Web分支fix/equipment-edit-web-20261106：初版040a6f8，最终`bf78d4e12c8dc57ceb28e439c476c4fe4e57f512`（补充统一工具栏）；只有设备、公共表格及对应契约/测试改动。
- 正式scripts/backup.sh完成两库和uploads备份、归档目录校验及SHA256，批次20261106_161258。保存在既有data/backups，未提交备份或读取/打印密钥。
- 从干净发布worktree使用KDOS_RUNTIME_ROOT指定原运行目录，依次执行原scripts/deploy.sh api及web，组件一致性均CONSISTENT，未修改部署安全规则、未创建第二个运行实例。
- 没有执行Migration、历史回填、手工主计划同步、设备通知或权限更改。生产只读前后确认118～122执行数0，设备编号旧update授权仍0。
- 两组件SHA不同是基于各自实际生产基准的限定发布；分别核验脚本组件门禁、build-info及API health，不以统一版本号带入未发布主计划。
- 回退时保留数据库及全部实际设备/状态/审计，分别从eeaac326和755f6db干净源码按同一脚本恢复相应组件；不恢复备份覆盖发布后新增业务，不需撤销结构。

## 5. 实际生产验收记录

真实Chrome channel=chrome、正式生产页面和已有授权账号：

- 设备总台账编辑：**PASS**。只读→编辑控件→退出只读；设备编号保持只读。一次合成修改请求在浏览器拦截为409，原值恢复、错误可见，退出没有额外提交；该合成修改未到达生产API。
- 正式生产API兼容：无变化PATCH实际返回200，设备名称及version前后完全相同，没有修改设备事实。
- 事业部名称显示：**PASS**，5条真实事业部记录。
- 部门名称显示：**PASS**，22条真实部门记录，同时显示所属事业部及使用部门/车间。
- 两表所有数值字段的统计指纹发布前后完全一致。没有改统计口径。
- 两个真实Excel按钮下载：**PASS**，分别5行、22行；中文表头、首行业务组织名称与当前API/页面相同，行数与全部匹配分组一致，不导出UUID。
- 页面未捕获JS错误0。截图、JSON、真实下载工作簿仅在受限ignored目录。验收时导出沿用原正式导出审计；未改设备/状态/报工/库存或权限数据。
- API health返回6d0c81b、Web build-info返回bf78d4e；API/Web/PostgreSQL/Document Worker均healthy。API和Web脚本各自版本门禁CONSISTENT。

### 实际遵守的Skill

遵守现有kdos-form-platform的公共只读/编辑模式、短标签主题按钮、选择与编辑分离、顶部停用及历史保留、单一字段Registry、组织稳定ID和字段/数据范围、expectedVersion/409/审计、保存失败明确反馈及服务端导出规范。本轮没有新建或改写Skill，也没有关闭共享字段权限过滤。

### Git与未完成事项

只做本地提交，**未push GitHub**；主源码汇总提交SHA补记于主进度及最终回复。原来未提交的260行进度、财务截图及订单清理记录完整保留，主进度采用定向暂存，只提交本节新增内容。

本轮两个功能的生产验收已完成。既有设备Web6个失败继续如实保留，不宣称全仓库测试通过；没有本轮待处理的生产功能阻塞。


## 修改文件（15项）

- `apps/api/src/modules/equipment/equipment.application.service.ts`
- `apps/api/src/modules/equipment/equipment.query.service.ts`
- `apps/api/src/modules/equipment/equipment.types.ts`
- `apps/api/src/modules/equipment/equipment.query.service.spec.ts`
- `apps/api/src/modules/equipment/equipment-export.service.spec.ts`
- `apps/api/src/modules/equipment/equipment-register-edit.postgres.spec.ts`
- `apps/web/src/modules/equipment/EquipmentPages.tsx`
- `apps/web/src/modules/equipment/EquipmentRegisterCell.tsx`
- `apps/web/src/modules/equipment/EquipmentRegisterDashboard.spec.tsx`
- `apps/web/src/shared/KdosDataTable.tsx`
- `apps/web/src/shared/KdosDataTable.spec.tsx`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/equipment-register.spec.ts`
- `docs/operations/EQUIPMENT_REGISTER_DASHBOARD_FIX.md`
- `outputs/CODEX_PROGRESS.md`
