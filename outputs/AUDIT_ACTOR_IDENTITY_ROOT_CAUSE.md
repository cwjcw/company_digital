# KDOS-AUDIT-ACTOR-IDENTITY-001：ROOT CAUSE CONFIRMED

第一阶段只读根因报告。调查日期：2026-10-12，Asia/Shanghai。

本阶段没有修改源码、数据库、审计历史、业务记录、同步标志或权限，没有实施 migration、测试构建或部署。依用户需求第十三节，正式修改需等待用户确认本报告。前轮 Knowledge 文件夹交付保持原状。

## 1. 当前服务器 HEAD 与部署版本

实际工作目录：`/data/automation/code/work/PMC/knweb`。

Repository HEAD：`d51d6820d9ee9578da3111af4f18988f5c33b4e7`。

`/build-info.json` 的 Web commit、`/api/v1/health` 的 API commit 和 Worker 的 `KDOS_BUILD_SHA` 均为同一完整 SHA。API 返回 `status=ok`，Web/API/Worker/PostgreSQL 容器均 healthy。没有基于 GitHub main 假定服务器实现，也未拉取或覆盖代码。

`git status --short` 显示源码无未提交变动，仅此前 outputs 进度与验收资料。本阶段新增此报告、更新唯一主要进度 `outputs/CODEX_PROGRESS.md`，保留原资料。

## 2. updatedBy metadata 的真实类型

`packages/contracts/src/index.ts:221` 的公共 `auditPermissionFields`：

| 字段 | metadata type | 写入属性 |
| --- | --- | --- |
| createdBy | member | editable=false |
| updatedBy | text | editable=false |

代码保留明确注释：多个正式表的 updated_by 可以存 system/migration/同步任务标识，不能强制按普通成员解析。实际工序报工 `public.mps_process_reports.updated_by` 与 `created_by` 均为 PostgreSQL **uuid**；其他表（如 users.updated_by）为 varchar。数据库列类型与显示语义是不同层次，不能通过统一改列类型或改历史值来修复。

## 3. 表格姓名解析链路

`KdosDataTable.tsx:383` → `useAuditColumns()` → `useAuditIdentityDirectory()` → 受 AuthGuard 保护的 `GET /directory/users` → `AdminQueryService.listDirectoryUsers()`。

`apps/web/src/shared/audit-fields.tsx:18` 用完整目录建立 id/username → `displayName.trim() || username` 映射；没有按 enabled 过滤。

`formatAuditUser()` 当前规则：可解析用户显示姓名；`system` 显示「系统」；无法解析的 UUID 显示「未知用户」；其他文字 actor 保留原值。该 Web 逻辑已能显示停用用户，不应重新在工序报工里写专用 mapping。当前空值也显示「系统」，属于既有行为，本轮不要无关改变。

`apps/api/src/modules/admin/admin-query.service.ts:70` 查询不带 enabled 条件，只返回 id、username、displayName、enabled；因此 `/directory/users` **包括停用用户**。

## 4. 高级筛选和列头候选解析链路

高级筛选 `apps/web/src/shared/advanced-filter.tsx:53` 的 CandidateSelect 请求 `GET /table-filters/candidates`，直接使用响应中的 `{value,label}`；in/not_in 使用候选，updatedBy=text 的 eq/contains 当前使用文本输入。

列头筛选 `apps/web/src/shared/table-column-menu.tsx` 同样请求该候选接口（withMeta=1），并传当前搜索、其他高级/列头筛选、视图上下文。复选框直接显示 `item.label`，提交 `item.value`，没有调用 `formatAuditUser()`。

后端 `TableFilterController.candidates()` 先检查资源/字段权限，组合租户、数据范围、上下文、搜索和其他筛选，再调用公共 `FieldCandidateService.resolveWithMeta()`。

`apps/api/src/common/filtering/field-candidate.service.ts:52` 按 metadata type 选择 label provider：member 才调用 memberCandidates；**text 不调用用户解析器**。updatedBy 因为是 text，最终执行授权范围内 `SELECT DISTINCT updated_by::text`，返回 `value=原值，label=原值`。按姓名搜索也只会搜索数据库原值，无法找到 UUID 对应的人名。

`MasterPlanQueryService.fieldCandidates()` 的模块候选接口也调用同一服务，并有自己的 enabled-only member provider，因此只改公共 controller 仍不够。

## 5. 姓名与 UUID 混合的原因与证据边界

同一个原始 UUID，列表通过完整目录显示姓名，更新人筛选按 text DISTINCT 显示 UUID，两个输出面使用了不同的语义。

其他历史表如果同时存储用户名、系统文字 actor 和 UUID，text 候选会直接混合输出这些原始文字与 UUID；这不是应当重写的历史数据。

本轮未收到可查看的截图文件，也未登录浏览器复现截图。本次只读数据库快照确认：当前 KAINAN 工序报工有 **2,509 条，12 种 updated_by，全部为 UUID，全部能关联 users**。所以可确认“列表姓名与筛选 UUID 不一致”，不能声称已经证实该截图同一个候选弹层中的姓名原值来源。不存在“这 5 个 UUID 的用户已删除”的情况。

## 6–8. 五个 UUID、用户名、启用状态及 users 存在性

在生产实际数据库 `four_department_tracker` 中，以显式 READ ONLY 事务查询，业务记录限定 tenant_id=KAINAN。仅读取身份必要字段，没有读取密码、token 或口令 hash。

| UUID | display_name | username | 存在于 users | enabled | 工序报工 updated_by 条数 | 工序报工 created_by 条数 |
| --- | --- | --- | --- | --- | --- | --- |
| 04ada40c-21aa-496b-941c-8c4c969c477b | 王家威 | 08977 | 是 | true | 205 | 205 |
| 106dc309-f471-4959-a46b-5454089dcedd | 吴建修 | 05989 | 是 | true | 176 | 176 |
| 9a846d7c-1605-4358-b4e4-617ef8f31dc9 | 丁才春 | 06359 | 是 | true | 219 | 219 |
| b615038b-ba11-45ee-9175-d30bb599b77a | 李虹 | 06148 | 是 | true | 441 | 441 |
| c5d79e01-ef7e-4296-a874-0036bffa577d | 何辉 | 09417 | 是 | true | 294 | 294 |

条数属于调查时的生产快照，后续正常业务写入可以改变条数。

## 9. createdBy 确实受影响，还存在候选目录截断问题

公共 controller 和 MasterPlanQueryService 的 memberCandidates 都执行 `WHERE enabled=true ... ORDER BY label LIMIT 201`（FieldCandidateService 的 maxCandidates=200，provider 请求额外一条）。服务再把没有 label 的 DISTINCT 结果过滤掉。

因此：

1. 历史停用用户不进入 provider，创建人候选直接遗漏。
2. 当前用户目录 **852 人，启用 755 人，停用 97 人**。即使启用用户，也可能在目录排序前 201 人以外，导致无搜索候选遗漏；hasMore 提示不会自动补齐这些身份。

当前工序报工 created_by 共有 11 个身份。按照现有无搜索目录 SQL 只读核对：

| 状态 | 报工中的创建人身份数 | 涉及记录 | 被当前目录 provider 排除身份数 | 涉及遗漏记录 |
| --- | --- | --- | --- | --- |
| enabled=true | 10 | 2,153 | 5 | 1,169 |
| enabled=false | 1 | 356 | 1 | 356 |

停用身份是既有正式系统主体 `0199e000-0000-7000-8000-000000000001`，显示名「KDOS系统任务」，username=`__kdos_system__`。该主体由既有迁移创建，`MasterPlanSyncService.MASTER_PLAN_SYSTEM_USER_ID` 正式使用，禁用登录是设计要求，不能为筛选将其启用。其当前 updated_by 对应 355 条报工、created_by 对应 356 条。

上述数量证明公共修复需要同时覆盖审计创建人，并对可见记录中的真实 actor 做解析，不能只去掉 enabled=true 或增大目录上限。

## 10. 其他标准表及打印、导出的影响

对实际 API 容器加载的当前契约进行只读枚举：54 个正式资源中 **50 个含 createdBy/updatedBy**，均使用 member/text 公共组合。其余 4 个是 rd-material-duplicates、supervision-project-dashboard、supervision-employee-dashboard、supervision-owner-report，没有这对审计字段，不能声称 54 个都有问题。

含审计字段资源涉及 Knowledge、主计划/PMC/设备、研发、督办、数据中心、营销、人力、流程和系统资源；实际可用筛选还取决于该资源是否登记了对应列及读权限，不是所有聚合资源都有实际审计列。共性缺陷存在于公共 FieldCandidateService，而非工序报工页面。

只读生产样本进一步证明不是单表问题：

| 表 | 当前 KAINAN 记录数 | updated_by 是 UUID 的记录 | system 文字记录 | 停用创建人记录 |
| --- | --- | --- | --- | --- |
| mps_shipping_plans | 1,233 | 1,233 | 0 | 533 |
| mps_weekly_plans | 2,049 | 2,049 | 0 | 1,169 |
| equipment_status_reports | 6,258 | 6,257 | 1 | 0 |
| knowledge_pages | 5 | 5 | 0 | 0 |

注意研发 rd-items 的公共审计列映射到已有 `created_by_name` / `modified_by_name`，需要保留已有文字姓名；不能把所有 createdBy 都强制 cast UUID。营销业务表使用独立 KDOS 库的查询执行器，但当前 MarketingDirectoryQueryService 实际使用兼容 User repository；修复应继续正确分离业务查询执行器和身份目录，不跨库拼接错误的 users 表。

标准打印与 Excel 共用 `TablePrintService`。当前 `isTablePrintFieldPrintable()` **默认排除审计列**，所有正式契约中没有 createdBy/updatedBy 的 printable=true 项，因此这两个标准输出目前不包含审计 actor，未发现这条链路的实际 UUID 泄露。不要为本轮修复擅自增加导出/打印列。

但打印的 resolver 当前只识别 dictionary/member/department/reference，若以后合法显式包含审计字段，updatedBy=text 会绕过解析。公共设计应使这种显式包含的场景也消费统一审计 resolver；createdBy 当前批量查询 users 没有 enabled 限制，但缺失 UUID 会输出空值，且非 UUID 文字可能触发 uuid[] 转换错误，与 Web 的未知用户/正式文字 actor 语义不同。

仓库标准输出及现有专项 equipment/knowledge/export 路径已做字段扫描，未发现专项输出直接使用 createdBy/updatedBy；本阶段没有生成真实 Excel、执行打印或逐页浏览验收，正式修复阶段再补回归。

## 11. 建议的公共修复设计（待确认，尚未实施）

1. **显式审计身份语义**：在公共字段 metadata 增加一个轻量语义标记或等价的共享判定，专门用于 createdBy/updatedBy；不把 updatedBy 简单改为普通 member。保持真实列和历史值不变，区分普通业务成员选择与审计身份解析。
2. **共享纯格式规则与后端 AuditIdentityResolver**：复用已有目录，批量按请求范围中出现的稳定 id/历史 username 查询，包含停用用户。Web、candidate、合法包含审计列的 print/export 使用同一格式规则：displayName.trim() → username；system → 系统；正式系统主体 → KDOS系统任务；其他正式文字 actor 保留既有可读定义；不存在的 UUID → 未知用户。不要发明新的 migration/sync 翻译或假用户。
3. **候选只来自已授权记录**：保留资源/字段权限、tenant/data scope、上下文、搜索和其他筛选。对授权范围中的真实 DISTINCT actor 值批量解析，避免先取全目录前201人造成遗漏；目录本身不能成为候选列表或泄露无关人员。搜索匹配解析后的 label（兼容原稳定值搜索），在完整匹配范围上应用 limit/hasMore，不能先截断一页再按姓名过滤。采用有界批次或合适查询策略，不以无限加载全部目录作为修复。
4. **两个入口统一**：通用 TableFilterController 与 MasterPlanQueryService 的候选路径共同调用公共 resolver；原普通 memberCandidates 的 enabled-only 规则保持不变。
5. **前端与真实筛选一致**：高级筛选及列头呈现 label、提交原始 actor value。审计 eq/in 使用身份候选；保留既有筛选契约及必要操作符，不把姓名当 UUID 写入 FilterGroup。SqlFilterCompiler 当前稳定值比较支持 column::text + 参数化 text[]，应复用，不在工序报工另写 SQL。
6. **打印/导出不另建一套规则**：仍沿用原列授权和默认审计列排除规则；如果正式 metadata 合法允许包含审计列，公共批量 resolver 必须与 Web/candidate 保持一致。
7. **部署范围**：目前没有证据需要 migration、历史数据回填、权限修改、同步配置或 flags 修改。预计只涉及公共契约、API 身份/候选服务、Web 审计与筛选、对应专项测试；确认后再以实际 diff 确定最终文件清单。

确认后验证计划：启用/停用用户、system、正式系统主体、文字 actor、未知 UUID、空姓名 fallback、超过201目录；高级/列头姓名搜索和原值提交；真实授权 SQL 命中、权限/租户隔离；工序报工与其他标准表回归；审计列默认不输出及显式输出规则。再运行相关 API/Web、Web 全量、相关 API 回归、typecheck/lint/build，按项目流程备份、部署、核对版本及真实界面。

## 当前交付与未执行项目

- 已完成：服务器/部署 SHA 核验；代码链路调查；READ ONLY 数据库身份、统计、候选目录范围核对；公共设计与报告。
- 尚未执行：正式源码修复、自动化测试、构建、备份部署、浏览器验收。原因：用户明确要求先确认根因报告，不能提前跨阶段。
- 文档改动：本报告和 `outputs/CODEX_PROGRESS.md`。没有源码、配置、业务数据、数据库结构或 Git 提交变动。
- 无运行异常。确认当前可修复的两个根因：**审计显示与候选 metadata 语义不一致；创建人复用启用且截断的普通成员目录。**
