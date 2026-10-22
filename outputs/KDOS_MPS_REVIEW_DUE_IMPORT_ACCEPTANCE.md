# KDOS-MPS-REVIEW-DUE-IMPORT-001 本地及隔离验收记录

总体状态：WAITING_MANUAL_ACCEPTANCE。未经用户人工验收不判整体PASS。初始开发阶段仅完成本地与隔离验证；用户于2026-10-22追加“同步github”，授权本次安全提交与正常推送，不包含生产部署。

起始Git HEAD：389557f752a11c7b735d88ab847b3805823058a7（main）。本报告与25个任务文件一同提交；最终完整SHA、远端分支及推送结果见本次交付回复与Git记录。GitHub存在9bb47b5规范提交，普通合并保留；如有冲突即停止，不强推。

## 独立验收项

下列PASS仅表示本地自动/隔离验证，不构成生产上线或人工验收结论。人工验收均待用户确认。

|项目|自动验证|证据与边界|
|---|---|---|
|Skill强制模板下载|PASS|3.1节独立KN-FORM-TEMPLATE-001；Skill Creator quick_validate通过；不改其他模块模板行为|
|手工新增|PASS|保留既有专用命令和Toolbar入口，原新增PG/HTTP/Chrome回归|
|Excel导入：上传及预览|PASS|两个模式显式选择，未确认业务行数不变，冲突/错误无确认token，取消无写入|
|导入模板下载|PASS|真实Chrome下载.xlsx，空表可用，八列/日期/精确文本/说明/隐藏映射及正式Preview兼容|
|确认导入事务|PASS（仅隔离）|混合新增/更新，预览锁、整批事务，审计中途失败完整回滚|
|交期变更次数|PASS（仅隔离）|首次0、日期相同0次、提前/推迟/恢复旧日期各1次、数量/名称不计次|
|历史记录|PASS（仅隔离）|IMPORT、预览UUID批次、真实用户、前后日期/方向/天数，同事务；保留旧UUID及全部历史|
|权限和幂等|PASS（仅隔离）|import/create/字段/范围/租户/有效用户、来源冲突、并发重放及版本409|
|Excel导出|PASS|原十业务字段、服务端范围/精度导出及分页回归保持|

## 实现

- 复用MasterPlanSpreadsheetService的ExcelJS/workbook及mps_import_previews；不建第二套导入存储或解析基础设施。
- 独立下载按钮与新增/导入/导出位于同一KdosDataTable工具栏，下载不依赖数据、编辑模式或已上传文件。
- 模板：mps_review_due_dates_import_template.xlsx；Workbook标题“评审交期表”；主Sheet mps-review-due-dates；填写说明Sheet；八列为记录ID、版本、订单号、批次号、试制计划图号、验货时间名称、入库时间、数量。数量使用文本格式，日期yyyy-mm-dd。没有真实业务数据。
- 标准模式要求八列表头，新增ID/version同时留空；更新原ID/version同时有效。原始SOURCE模式要求六列、使用不可变来源身份匹配，保留人工改后的当前业务键。两模式不根据是否有ID列暗中切换。
- 真实表头与隐藏映射逐项核验；删除技术列或移动/删除字段未同步映射即拒绝，不按旧列号读订单号为ID。
- ReviewDueDateImportApplicationService统一业务验证及IMPORT变更命令，借用现有预览确认事务；保留create:false和通用PATCH/新增/批量/删除限制，通用importUpdates对本资源仍禁止。
- 字段写入、租户、动作数据范围、业务唯一性、实际登录用户、版本与事务行锁复查；更新需import及实际变化字段update，无需另授资源update。模板下载按现有read/create/import与字段授权独立提供，不授写权。
- 无read但获权import用户可得到必要操作/模板元数据；预览不返回已有日期/数量/次数或人工改后业务键，也将受限行的提前/推迟/数量比较汇总隐藏为“—”。受限字段模板仅结构参考，明确不可直接导入。
- 数量始终十进制文本/Decimal/numeric；数值型精度不可靠时拒绝并要求文本。公式只取有效缓存，错误或缺缓存拒绝；统一加密检测提示完全沿用标准文案。
- 首次新增无历史、count0/lastSyncedAt=NULL；同日期不计次；新旧日期不同则当前行、IMPORT事件、计数/前次日期、逐行/批次审计和收据同事务。完全未变化不更新业务行/version。
- 同一预览并发/反复确认只写一次。重复新增文件在预览以唯一键冲突拒绝；SOURCE同内容未变化不计次，后续真实变化按新版本/新批次处理，不能用永久文件摘要吞掉恢复旧日期事件。
- MANUAL及STANDARD新建记录不视为外部来源已核实，SOURCE/未来observe碰到需人工核实；没有开发外部同步接口、身份确认或定时任务。

## 验证结果

- API全量：1184通过，33项既有跳过（121通过suites、4既有跳过）；最终专用命令/领域/权限4 suites、45项再次通过。
- Contracts：32项通过。
- Web全量：63文件、459项通过；最终权限比较裁剪后，导入4项再次全通过。原新增/编辑/导出回归包含其中。
- 隔离PostgreSQL+HTTP+真实Chrome：59组通过；覆盖30项需求及原迁移/来源/RLS/导出/历史约束。
- Chrome在真实下载后的八列模板中填入合成数据，上传预览后取消；六列SOURCE上传预览后取消；最终只在隔离DB确认一次，双击仅1个确认POST，数量精度、count0/历史0及刷新正确。原六字段编辑/新增Chrome同时回归。
- 加密fixture补齐EncryptedPackage标记、并发测试不假设返回顺序、Modal可见断言等待动画；这是测试修正，未弱化业务校验。
- DATE范围使用PG日期文本修正UTC偏移；标准模式要求完整列以防缺可选列被误作清空，模板标题来自Registry。最终递归typecheck、lint、build通过，最终PG/HTTP/Chrome59组通过；lint0错误，仅有既有ModulePortal Fast Refresh一项警告，构建保留既有大包提示。最初regex无效转义lint已修正并全量复核。

## 生产保护和当前版本

- 生产Web/API仍为389557f，本任务没有部署，正式页面不会提前显示新按钮。
- 生产只读采样：主表0、历史0；9项授权/PMC映射、6flags、8财务视图保护摘要已保存，最终只读复核相同；生产两表始终0/0，保护摘要一致。
- 是否实际执行数据导入：生产没有；仅隔离PostgreSQL合成数据导入测试。
- 是否启用调度：没有；没有新增n8n任务、外部API同步或修改6项主计划开关。
- 不导入用户1139条，不修改生产权限组/现有记录/其他主计划业务表。
- 数据库Migration：无需新增。复用已上线103项迁移及既有预览台账、来源三键、UUIDv7、RLS与历史保护，不改历史migration。
- 目标页面URL：http://192.168.1.249:15172/master-plan-system/mps-review-due-dates（当前仍旧功能）。隔离Chrome验收URL：http://127.0.0.1:15379/master-plan-system/mps-review-due-dates；验收请求全部路由到隔离Nest HTTP，验收后Vite及隔离PG容器/匿名卷/临时socket均已清理，因此该临时URL当前不再提供服务。
- 私有证据：data/mps-review-due-import-20261022；空白真实模板同目录，文件名mps_review_due_dates_import_template.xlsx；运行日志不提交。

## 其他表格覆盖缺口

见KDOS_IMPORT_TEMPLATE_COVERAGE_GAPS.md：66注册资源静态盘点；本任务1个新独立入口、其他主计划19个既有通用入口及另外3个专用入口；43个资源未发现对应入口或需先确认实际是否为标准业务表。已有入口不等于满足新规范；依赖import权限、只读参考结构、英文名等仍需专项核验。本轮不改造其他模块。

## 修改文件

- .agents/skills/kdos-form-platform/SKILL.md；contracts review-due-dates.ts及index.ts。
- API：review-due-date-import.application.service.ts、review-due-date-import.spec.ts；既有Spreadsheet/Controller/Module/Query/权限助手及通用导入保护；review-due-date.query.service.ts、application.service.ts、domain/manual权限回归测试。
- Web：ReviewDueDates.tsx、ReviewDueDates.import.tsx、ReviewDueDates.import.spec.tsx。
- 隔离：scripts/test-review-due-dates-postgres.cjs、scripts/review-due-import.postgres-checks.cjs。
- 文档：本报告、设计文档、CODEX_PROGRESS.md、模板覆盖缺口清单及docs/integration-guide.md。共25任务文件；本次仅按用户授权同步代码和报告，不部署。

完整文件清单：

```text
.agents/skills/kdos-form-platform/SKILL.md
apps/api/src/modules/master-plan-system/master-plan-spreadsheet.service.ts
apps/api/src/modules/master-plan-system/master-plan.application.service.ts
apps/api/src/modules/master-plan-system/master-plan.controller.ts
apps/api/src/modules/master-plan-system/master-plan.module.ts
apps/api/src/modules/master-plan-system/master-plan.query.service.ts
apps/api/src/modules/master-plan-system/master-plan.types.ts
apps/api/src/modules/master-plan-system/review-due-date.application.service.ts
apps/api/src/modules/master-plan-system/review-due-date.domain.spec.ts
apps/api/src/modules/master-plan-system/review-due-date.manual.spec.ts
apps/api/src/modules/master-plan-system/review-due-date.query.service.ts
apps/web/src/modules/master-plan-system/ReviewDueDates.tsx
docs/integration-guide.md
outputs/CODEX_PROGRESS.md
outputs/KDOS_MPS_REVIEW_DUE_DATE_SPEC.md
packages/contracts/src/index.ts
packages/contracts/src/review-due-dates.ts
scripts/test-review-due-dates-postgres.cjs
apps/api/src/modules/master-plan-system/review-due-date-import.application.service.ts
apps/api/src/modules/master-plan-system/review-due-date-import.spec.ts
apps/web/src/modules/master-plan-system/ReviewDueDates.import.spec.tsx
apps/web/src/modules/master-plan-system/ReviewDueDates.import.tsx
outputs/KDOS_IMPORT_TEMPLATE_COVERAGE_GAPS.md
outputs/KDOS_MPS_REVIEW_DUE_IMPORT_ACCEPTANCE.md
scripts/review-due-import.postgres-checks.cjs
```

## 获得确认后的发布步骤（本轮不执行）

1. 重新检查HEAD/工作区/远端分支和敏感文件；有冲突停止，不覆盖他人修改。复核本任务差异及最终测试证据。
2. 按scripts/backup.sh备份两库/uploads，校验SHA与可恢复目录/压缩格式；只读记录正式行数及权限/flags保护基线。
3. 无新migration，不执行导入或seed。GitHub同步已由用户单独授权；发布前核对本地与GitHub的版本，不force，不覆盖他人修改。
4. 使用./scripts/deploy.sh all及./scripts/deploy.sh check，确保Repository=Web=API及STATUS=CONSISTENT。
5. 生产Chrome只下载空模板、上传合成文件预览并取消、验证权限拒绝；严禁确认导入。复核业务表、历史表及生产保护项未变化。
6. 发生权限/身份冲突、异常计次、金额/版本差异或发布失败时停止，不触发同步；回滚应用使用已验证前一版本，保留历史和正式业务数据，不删表或恢复覆盖实时数据库。
7. 核验GitHub远端SHA，补记真实发布版本/SHA后继续等待用户人工验收；本任务不自动进入1139条导入或每日同步。
