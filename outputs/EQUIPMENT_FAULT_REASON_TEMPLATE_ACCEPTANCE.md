# 设备状态模板故障原因下拉验收

当前状态：已完成 / PASS，已备份、部署并通过管理员真实浏览器模板下载及最终 XLSX 检查。

## 修改范围与数据来源

- `apps/api/src/modules/equipment/equipment-export.service.ts`：模板读取现有 Query 的实时字典选项，写入隐藏辅助表和 Excel 列表校验；无硬编码故障原因。
- `apps/api/src/modules/equipment/equipment.query.service.ts`：将原有页面选项 SQL 抽取为 `faultReasonOptions()`，页面和模板共用；SQL 条件仍为 `dictionary_types.code = equipmentFaultReason`、`dictionary_values.enabled = true`，按 sort_order/value 排序，不缓存。
- `apps/api/src/modules/equipment/equipment-export.service.spec.ts`、`equipment.query.service.spec.ts`：增加专项回归测试。
- `outputs/CODEX_PROGRESS.md`：持续进度记录；本报告及 BACKUP/LIVE 验收证据。

页面、导入 preview、saveStatus 均使用同一系统字典类型及启用值。未修改导入/保存业务校验：故障时长 > 0 时必须有有效原因；故障时长 = 0 时允许留空，填写原因仍需有效。

无数据库 migration、无新依赖、无新增/变更 API 契约，无 Web 修改、无业务数据或生产字典修改。模板的原有下载权限（create/import/export 任一）保持不变。

## Excel 格式

- 主表：设备状态填报，九列表头顺序保持不变：事业部、使用部门、设备编号、设备名称、填报日期、计划运行时间、实际运行时长、故障时长、故障原因。
- 辅助表：数据字典，状态 veryHidden；保留填写说明表。
- 故障原因位置：I 列；使用 ExcelJS 范围校验 API 直接写入一个 I2:I2000 区域，共 1999 个数据行，允许空白；避免其逐单元格合并算法生成重叠范围，不写入空白数据行。
- 命名区域：EquipmentFaultReasons，引用数据字典 A2 至最后一个有效值，避免 Excel 列表校验直接跨表引用；空字典时引用空白 A2，不生成假选项。
- 格式保持 xlsx，设备编号文本格式/前导零、填写说明和现有导入流程保留。
- 生产只读查询当前有效值：机械故障、电气故障、辅助系统故障、工装刀具故障、物料工艺故障。
- 修改字典后需要重新下载模板，新模板实时读取最新启用值；已经下载的文件为下载时的字典快照。

## 自动化验证

新增 6 项测试：单个 XLSX 校验范围无重叠、全范围下拉及空值、当前字典/停用排除/新增后刷新/页面一致、空字典、带隐藏表和校验空行的模板填报再导入、Query 启用过滤及实时查询。原有下载权限、九列表头、填写说明及导入回归保留。

最终 API 全量：101 套通过，870 项通过，1 项既有跳过。API typecheck、lint、build 全部通过。测试开发首轮有两项中文 sheet 引用引号断言错误，已修正，最终全量通过。无 Web 源码变化，未重复运行 Web 全量。

日志：EQUIPMENT_FAULT_REASON_API_ALL.log、EQUIPMENT_FAULT_REASON_TYPECHECK.log、EQUIPMENT_FAULT_REASON_LINT.log、EQUIPMENT_FAULT_REASON_BUILD.log。

## 备份与部署

备份时间：20261012_130731；通过项目 backup.sh 备份 four_department_tracker、kdos 和 uploads（含.private）。两份 pg_restore 目录校验、三份 SHA256 复核及备份权限600全部通过。证据：EQUIPMENT_FAULT_REASON_BACKUP.json。

源码初次提交：74203e8；最终单范围修正提交：b1b844704c6553ae5ea328724eb019a85e6ee708。两次提交共四个相关源码/测试文件，未 push。原 API/Worker 镜像已标记保留，用于回滚。执行项目标准 `./scripts/deploy.sh api`，仅更新 API 及配套 document-worker，Web/数据库不重建。

最终部署：`./scripts/deploy.sh api` 返回0；HEAD/API/Worker均为 b1b844704c6553ae5ea328724eb019a85e6ee708。Web保留ca0d7d7，已确认Web/shared源码不变，没有为了版本号而重建Web。

`healthcheck.sh`通过；Web/API/Worker/PostgreSQL均healthy，通知Dispatcher active。PostgreSQL容器ID及原bind mount不变，API仍通过 postgres:5432连接；未登录模板请求返回401。

管理员真实Chrome验收3组通过：登录/权限、页面“导出模板”及HTTP200/xlsx下载、模板字典与页面选项完全一致及1999个单元格/命名区域/空白/原表头检查。实际下载文件：`outputs/equipment_status_template_2026-10-12.xlsx`。最终Live证据记录同一部署SHA。

额外ZIP/OpenXML检查通过：CRC及全部XML可解析，单个list规则、sqref=I2:I2000、allowBlank=1、formula1=EquipmentFaultReasons，命名区域引用 `'数据字典'!$A$2:$A$6`，数据字典veryHidden。主表仅有表头实际数据行，无空白数据记录。

验收过程中脚本最初精确按钮名称未包含Ant图标无障碍名称，改用文字匹配后真实点击通过。逐单元格序列化产生两个重叠范围的问题已通过范围API修复并补测试，最终文件只有一个范围。

证据：EQUIPMENT_FAULT_REASON_TEMPLATE_LIVE.json、EQUIPMENT_FAULT_REASON_TEMPLATE_XML.json、EQUIPMENT_FAULT_REASON_DEPLOYMENT.json；最终日志：EQUIPMENT_FAULT_REASON_DEPLOY_FINAL.log、EQUIPMENT_FAULT_REASON_HEALTH_FINAL.log。登录凭据只在运行时输入；没有截图、录像、存储状态或凭据报告，验收后已退出登录。未提交生产业务数据、修改字典或账号权限。

## 人工复验

1. 打开设备状态填报，点击“导出模板”，用 Excel/WPS 打开下载的 xlsx。
2. 检查故障原因列第2行、第2000行都有下拉，选项为当前启用的字典值。
3. 故障时长为0时留空故障原因；有故障时选择原因，填好事业部/设备编号/日期及计划时间，执行导入预览。
4. 字典维护者通过现有系统修改/停用选项后重新下载，检查新模板选项同步更新；正式导入仍以服务端最新有效字典为准。

未测试：桌面 Excel/WPS 人工点击，以及生产实际新增/停用字典、正式导入提交。动态新增/停用及原模板导入由自动化覆盖，生产验收不会为测试修改字典或业务资料。
