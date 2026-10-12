# KDOS-AUDIT-ACTOR-IDENTITY-001 — Implementation acceptance

当前状态：**KDOS-AUDIT-ACTOR-IDENTITY-001：等待人工验收**。开发、质量门禁、备份、第二次部署和线上管理员验证完成；不自行判最终PASS。
日期：2026-10-12，Asia/Shanghai。

## 版本与实施范围

1. 开始 HEAD：`4ef33128116fe5e523e09b71b4555d42849f82a5`。用户根因基线为 `d51d6820d9ee9578da3111af4f18988f5c33b4e7`，两者仅 outputs 报告差异、源码一致。
2. 结束 HEAD：`e498473a1930b7683262982577225d0f8d451bdc`。
3. Commit：`fix(audit): unify actor identity labels across table filters`；初次14文件；后续 `e498473 fix(audit): reuse shared candidate provider in master plan module` 增加真实Nest模块测试并移除主计划重复注册，合计16个源码/测试/公共契约/说明文件，均未 push。
4. Metadata：createdBy 和 updatedBy 均显式声明 `format: auditActor`；底层 member/text 类型保留真实存储含义，操作符编译及历史值不改。业务 UI 两者统一为身份等于/不等于/集合/空值选择，普通文本仍保持包含搜索。
5. Resolver：`apps/api/src/common/audit/audit-actor-identity.resolver.ts`；共享格式规则在 `packages/contracts/src/audit-actor.ts`，Web audit-fields直接复用。
6. Candidate：先在已有资源授权、字段权限、tenant/data scope/搜索/筛选/上下文范围内 DISTINCT actor，再批量解析。无搜索读 limit+1；姓名搜索按最多200个业务值/批进行 C collation keyset扫描，在匹配结果达到limit+1时返回hasMore，否则继续到实际全集结束。输出value始终原actor，label是展示名称，SQL由既有SqlFilterCompiler参数化比较原列。
7. 201上限：审计字段不再先取全局前201人，完全绕过普通member provider；原候选响应上限200和hasMore仍保留，不是“取消响应分页”。Resolver每批最多500个真实值，去重且无逐行N+1。
8. 创建人历史停用身份：按真实值查询users，不加enabled限制，包括正式「KDOS系统任务」；没有把它启用，也没有创建生产假用户。
9. 更新人：UUID解析为displayName.trim()，为空则username；历史username解析也保持既有Web行为。
10. system：显示「系统」，内部value保留system。既有系统主体UUID显示其真实目录名「KDOS系统任务」。不存在官方翻译的migration/integration/worker文字不擅自改名。
11. unknown UUID：显示「未知用户」，候选保留原UUID，不丢失或输出裸UUID；由隔离SQL、API与Web测试验证，不向生产业务表插入未知主体。
12. 普通member：enabled-only provider和原筛选行为未修改。负责人/参与人/业务员不因审计修复混入停用用户。
13. 五个UUID预期展示：王家威、吴建修、丁才春、李虹、何辉（完整UUID/username对照见ROOT CAUSE报告）。真实线上验证了五个姓名候选和按原UUID命中205/176/219/441/294条报工；真实浏览器高级及列头显示姓名、表格一致。
14. 范围：54个契约资源中50个声明审计字段；公共KdosDataTable、平台及MasterPlanQueryService候选同享实现，实际可用性仍依各表列绑定与权限。测试抽查工序报工、事业部周计划、设备状态、督办任务、users。标准打印/Excel仍默认排除审计列，仅未来明确printable=true的审计列消费相同resolver，不强加输出列。

## 质量门禁

15. Tests：API最终全量101套/864通过，1个既有PostgreSQL shipping integration测试skip；新增API21项（resolver9/candidate8/print-export3/Nest装配1）；Web全量43文件/327通过（新增8项）；隔离PostgreSQL7组真实SQL验证通过，一次性fixture数据库已删除。没有生产未知actor/system假数据写入。
16. Typecheck：根pnpm typecheck，包括API/Web与所有workspace，通过。
17. Lint：根pnpm lint，通过；Web原ModulePortal Fast Refresh warning保持，0 errors。
18. Build：根pnpm build，通过；使用Node24.19；Web原chunk-size提示保持。相关API/Web定向测试、API typecheck/lint和Web typecheck/lint亦通过。
19. Deploy check：第二次 `./scripts/deploy.sh all` 和 `./scripts/deploy.sh check` 返回0，HEAD/Web/API= e498473，STATUS=CONSISTENT；Worker SHA相同。healthcheck含Web/API/PostgreSQL/Worker/Swagger/OpenAPI通过，Dispatcher active；真实Chrome管理员18组核验完成（无录屏/trace/storage-state/凭据落盘）；见AUDIT_ACTOR_IDENTITY_LIVE.json。
20. 数据库：无migration、DDL、历史created_by/updated_by UPDATE、业务写入、权限/同步flags变更，无新npm依赖，无新API路由。隔离验证仅创建一次性fixture库（含测试users/actor_rows），未连接生产库写数据；必要真实登录会沿用现有认证会话/登录审计，不能表述为整个数据库绝无认证记录变化。

首轮Web高并发运行出现9个失败（主要5秒超时，另含1断言及环境提前结束异常），仅修正新增列头测试的图标按钮名称定位；没有修改无关业务代码或跳过失败用例。最后全量用 `--maxWorkers=2 --testTimeout=15000` 完整重跑，327项全部通过。

## 修改文件（16）

- packages/contracts/src/index.ts
- packages/contracts/src/audit-actor.ts
- apps/api/src/common/audit/audit-actor-identity.resolver.ts
- apps/api/src/common/audit/audit-actor-identity.resolver.spec.ts
- apps/api/src/common/filtering/field-candidate.service.ts
- apps/api/src/common/filtering/audit-actor-candidate.spec.ts
- apps/api/src/common/filtering/table-filter.module.ts
- apps/api/src/common/printing/table-print.service.ts
- apps/api/src/common/printing/audit-actor-print.spec.ts
- apps/web/src/shared/audit-fields.tsx
- apps/web/src/shared/advanced-filter.tsx
- apps/web/src/shared/audit-actor.spec.tsx
- scripts/test-audit-actor-postgres.cjs
- docs/integration-guide.md
- apps/api/src/modules/master-plan-system/master-plan.module.ts
- apps/api/src/common/filtering/audit-actor-module.spec.ts

报告与进度为outputs追加记录，不包含凭据、token或业务文件。

## 人工验收步骤

1. 刷新线上KDOS，以获权账号进入「主计划系统 → 生产执行 → 工序报工 → 实际报工」。
2. 打开「高级筛选」，添加「更新人」，默认等于；展开候选，应看到王家威、吴建修、丁才春、李虹、何辉，不显示相应UUID。
3. 搜索姓名选择一人、点击筛选，检查行的更新人姓名与候选一致；清空后恢复全集。
4. 从「更新人列菜单 → 筛选」检查同一组姓名，选中后记录范围正确。
5. 「创建人」候选应包括有历史记录的「KDOS系统任务」；该账号保持停用状态。
6. 抽查周计划、设备状态、项目/任务和系统管理标准表的创建人/更新人显示及筛选。
7. 当前标准Excel/打印仍不增加审计列。普通成员维护仍只允许启用成员。
8. 未知UUID/system/大量目录后的姓名搜索由自动化覆盖，不在生产插入测试资料来制造这些状态。

## 证据文件

ROOT CAUSE：AUDIT_ACTOR_IDENTITY_ROOT_CAUSE.md。
测试：AUDIT_ACTOR_API_TEST_FINAL.log、AUDIT_ACTOR_WEB_TEST_FINAL.log、AUDIT_ACTOR_POSTGRES.json。
质量：AUDIT_ACTOR_TYPECHECK.log、AUDIT_ACTOR_LINT.log、AUDIT_ACTOR_BUILD.log。
备份：AUDIT_ACTOR_BACKUP_VERIFIED.json（20261012_092945双库和uploads，含.private，三个SHA256复核通过）。
上线：AUDIT_ACTOR_DEPLOY_FINAL.log、AUDIT_ACTOR_DEPLOY_CHECK.log、AUDIT_ACTOR_HEALTH.log。
真实界面：AUDIT_ACTOR_IDENTITY_LIVE.json。
数据：AUDIT_ACTOR_DATA_BEFORE/AFTER.json、AUDIT_ACTOR_DATA_INTEGRITY.json、AUDIT_ACTOR_EQUIPMENT_HISTORY_CHECK.json、AUDIT_ACTOR_ACTIVITY_CONFIRMED.json。

## 部署异常与恢复（已处理）

首次deploy all在API切换时失败：MasterPlanSystemModule原来额外注册FieldCandidateService，新的resolver在该模块不可见，导致API短暂无法启动。普通直接构造服务的单元测试未覆盖Nest注入边界，这是本次漏检。

停止首次部署后，旧Worker image恢复尝试因原image已不可用未成功；临时override误建的空knplan_default network已删除，未修改项目Compose或原网络。随后把同源编译的DI修正模块复制到API可写层并重启，恢复healthy。新增真实MasterPlanSystemModule compile测试（不mock候选/resolver）后，API全量/类型/lint/build重新通过，提交e498473并第二次完整部署。正式容器已重建，临时补丁不再依赖；保留无运行时凭据的同源恢复镜像。没有删除/恢复数据卷、数据库或业务数据。

## 数据完整性与同期生产活动

部署前后工序报工（2509）、出货计划（1233）、Knowledge页面（5）的记录数和原created_by/updated_by指纹一致。原有6258条设备状态的记录数和actor指纹亦一致。

整个设备状态表的总数/指纹发生变化，因为01:33与01:45 UTC（上海09:33与09:45）两次正常既有用户导入新增106条；audit_logs的source=import、equipment.status.created=106、equipment.status.imported=2可对应。周计划总数2049未变，14条updated_by由既有KDOS系统任务更新，mps_sync_logs的SCHEDULED inbound-allocation在上海09:43:31成功、sync_count=14与变化吻合。本任务没有修改这些既有作业/导入逻辑或flags，未将并发变化回填还原，也不声称所有生产表整段时间完全静止。首次总指纹对比因此报差异，已通过上述只读审计核实原因。

## 实际线上验证与未测试范围

18组验证：真实管理员登录/权限1组；五模块的createdBy/updatedBy候选10组；五名用户的姓名搜索与原UUID实际SQL命中5组；工序报工Chrome高级筛选1组、列头1组。实际选择王家威后发送UUID，不发送姓名查询原列，表格显示王家威；两种候选均没有显示五个UUID。

五模块表格展示由新增Web回归覆盖，线上候选由真实授权API覆盖；本轮真实浏览器重点为工序报工，没有宣称其它四模块逐页人工验收、50资源逐页浏览、普通员工生产验收或未知UUID生产样例已执行。未知/disabled/system/大量目录后搜索有自动化与隔离真实SQL覆盖，生产既有停用系统主体实际返回KDOS系统任务。原shipping PostgreSQL integration会写生产设置，本轮未启用，保留1个既有skip。

浏览器脚本最初点击Select占位文字导致超时，后改为实际选择控件和字段搜索；列头通过重新加载清除本次筛选后完成。没有为验收修改业务资料、账号或权限，按原logout结束；无凭据/密码/token写入脚本、报告、Git或浏览器录制。

最终用户按上方步骤确认工序报工更新人高级筛选中的五个人名后，再记录用户最终验收结论。
