# Equipment Status Import Error Acceptance

状态：已完成 / PASS，API正式部署及生产只读预览通过。
日期：2026-10-08（Asia/Shanghai）。

## 问题与修改

用户文件17行事业部填写“研发”，真实设备台账与组织名称均为“研发中心”。旧预览对事业部拼写和设备查找失败使用同一句“未找到当前权限范围内匹配的监控设备”，不能定位错误字段。

现在在设备匹配前检查事业部名称，未知名称返回：
“找不到事业部名称‘研发’，请按当前导入权限范围内的设备总台账填写”（实际输出使用中文双引号）。

名称有效但设备不匹配返回明确的事业部、设备编号及启用/监控检查提示；空名称提示“事业部名称不能为空”。不增加名称别名或自动猜测。不改变事业部+设备编号匹配键、监控状态、日期和运行时长口径。前端现有逐行错误组件直接显示后端message，不需要改前端。

组织查询对受限账号按同一个import division scope限制；无授权division不查全量组织，名称集合只使用获权组织及获权可填报设备已有快照。保留设备快照名称，避免组织改名破坏既有正确导入。

## 修改与验证

- apps/api/src/modules/equipment/equipment.application.service.ts：名称预检、区分设备错误。
- apps/api/src/modules/equipment/equipment.spec.ts：新增10项回归及两处既有mock适配。
- outputs/CODEX_PROGRESS.md与本报告：进度和验收记录。

无migration、npm依赖、新API、业务数据修正或权限修改。保留Phase5.4未提交调查输出，没有纳入本次源码提交。

设备专项2 suites/45项通过；API全量87 suites/754项通过，另1既有skip。API lint/typecheck/build和git diff --check通过。现有Node22引擎提示、ts-jest allowJs警告保留，不属于本次改动。

源码提交：fe004db5b15a8482ee6bd00724168bba09597fb9（仅2个本轮源码/测试文件，未push）。

## 部署与线上验证

标准`scripts/backup.sh`完成，pg_restore --list及SHA256校验通过：
- four_department_tracker_20261008_110130.backup：abd7c2889f3a4d2aa5bcd844f04bd739364fc09db6a531199025156a39b01462
- kdos_20261008_110130.backup：1130d7f1502425a6b512c03df7293f101ed9918b08fa6b504af4efe04514c13b
- uploads_20261008_110130.tar.gz：b02ccb3b322c497e6181ca830fd8670171eaa2e6619699c0182a25984da50310

`scripts/deploy.sh api`成功，API Build与HEAD同为fe004db5b15a8482ee6bd00724168bba09597fb9，脚本API范围STATUS=CONSISTENT。没有前端改动，Web保持77e7a8c，未重建Web；PostgreSQL容器b679ba44dd7507ac797759ed41acdc77f1757f5fcf9bec2f0918565352583c44及原bind volume和127.0.0.1:15433保持不变。

`scripts/healthcheck.sh`通过，Web/API/Swagger/OpenAPI/PostgreSQL正常。

部署容器内实际EquipmentImportService/EquipmentApplicationService与真实TypeORM数据库只读连接完成预览（default_transaction_read_only=on，REPEATABLE READ事务，最终回滚）：
- 用户原Excel：总17行、有效0行、错误17行；全部明确提示“找不到事业部名称‘研发’，请按当前导入权限范围内的设备总台账填写”（输出中文双引号）。
- 修正副本：总17行、有效17行、错误0行。
- 未调用confirm，设备状态总记录数前后均5141；没有生产写入。
- 结果：outputs/EQUIPMENT_STATUS_IMPORT_ERROR_LIVE.json。

线上验证是工程只读Service预览，非用户账号登录/Chrome操作；本轮没有读取PMC E2E凭据或改变账号。权限范围分支由新增自动测试验证，前端沿用现有逐行message展示。

## 人工验收

1. 刷新设备状态填报页面，上传原“设备状态填报导入模板1008.xlsx”。
2. 第2至18行应提示找不到事业部名称“研发”。
3. 上传equipment_status_import_2026-10-08_fixed.xlsx，具有研发中心导入权限时17行应通过设备/事业部匹配。
4. 将副本中的一个设备编号改为不存在的编号，事业部保留研发中心，该行应提示设备编号及可填报状态问题。
5. 本轮没有替用户确认导入，实际保存仍通过正常预览/确认流程。
