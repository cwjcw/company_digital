# KDOS engineering rules

- Controllers cannot access databases; they call Application or Query Services.
- Domain code cannot depend on NestJS controllers.
- Business modules cannot depend directly on Drizzle or external ERP clients.
- Planning cannot read T+ SQL; external systems use Integration Adapters and Canonical Models.
- Web, Excel, T+, system jobs and future AI writes all use Application Commands.
- 当需求的完整实现确实需要 API 调整时，可以直接新增、修改或删除路由、请求/响应契约及对外行为，无需另行征得用户授权；仍须控制在需求范围内，说明影响，更新调用方、文档和测试，并完成权限、安全、审计与部署验证。不得为与需求无关的改动随意调整 API。
- 对会影响运行效果的代码、前端、API、数据库结构或配置改动，本地完成不等于交付完成：相关验证通过后必须备份、迁移并部署到当前运行环境，再执行健康检查和面向用户的线上效果核验，让用户可以直接看到结果。除非用户明确要求暂不部署，或外部依赖/权限阻塞；发生阻塞时必须说明未上线范围、原因和恢复条件，不得把“代码已完成”表述为“已交付”。
- AI tools cannot access SQL/Drizzle and phase-one AI tools are read-only.
- Every Planning core table has `tenant_id`; repository transactions set tenant context for RLS.
- Frontend button/column hiding is not authorization; backend permissions and field access are mandatory.
- Every critical write records Audit; collaborative entities use optimistic `version`.
- `PUBLISHED` and `LOCKED` transitions must pass the Planning state machine.
- Quantity and money calculations use exact decimal arithmetic and PostgreSQL `numeric`.
- External writes and event consumers must be idempotent.
- 所有表格文件导入必须在解析内容前调用统一的加密文件检测；检测到加密容器时停止导入并原样提示“该文件被加密,请解密后再导入.”，不得将其混同为文件损坏、模板错误或服务端异常。
- WebSocket events contain only invalidation metadata, never complete sensitive rows.
- Use UUIDv7 business IDs; identity-provider subjects belong in `iam.identities`.
- Keep `four_department_tracker` read-only/retained until the user authorizes retirement.
- Never commit `.env`, credentials, tokens, T+ snapshots, database files, or uploaded business images.
- 完成用户已授权的开发任务后，Codex 必须自行完成安全的 GitHub 同步闭环：检查工作区改动与敏感文件、运行相关验证、仅提交本任务文件、执行 git commit 与 git push 到项目已配置且允许的 GitHub 分支，记录 commit SHA/远程分支与推送结果；无需用户手动同步。禁止强制推送、绕过分支保护、覆盖他人修改或提交真实ERP/财务数据。若远程推送受权限或网络限制，准确说明未同步，不能将本地 commit 等同于已推送。
- SQL Server、企业微信和通讯录导出统一使用 `/data/automation/code/work/basci/basic_code` 的 `MSSQLDatabase`、`WeChatPusher` 和 `export_contacts`；密钥只保存在该工具包自己的 `.env`，不得复制到本项目。
- `WeChatPusher()` 使用计划中心默认自建应用；指定业务应用时使用 `WeChatPusher(app="...")`。群机器人只能显式调用 `send_robot_*()`，不得作为自建应用消息的自动回退。
- Do not introduce Kafka, Kubernetes, microservices, extra databases, or infrastructure without a proven requirement.
- Preserve AG Grid Community, the migration tests, and exactly one canonical set of 10 standard processes (cutting 下料, machining 机加, bending 折弯, spotWelding 点焊, welding 焊接, woodworking 木作, grinding 研磨, blank 毛坯, surfaceTreatment 表面处理, packaging 包装; 毛坯 sits between 研磨 and 表面处理). The registry lives in `@tracker/shared`; every dropdown, cycle field, reverse schedule, report and master-plan display derives from it.
- The retired legacy Planning module (97-field / 93-field monthly-plan columns, 14 legacy process definitions such as drawingBom, metalMain, woodMain, frontParts, woodwork, painting, acrylic, bakingPlating, rearPackingParts, assemblyPacking) must not be reintroduced as a formal business contract. Keep only historical migrations and retained read-only data.

See `ARCHITECTURE.md`, `SECURITY.md`, `docs/runbook.md`, and `docs/integration-guide.md` before changing a boundary.

## KDOS 页面导航设计

- 一个业务对象只提供一套主要导航；同一分类或目录不得同时在左侧树与右侧浏览区重复展示。
- 优先使用清晰的面包屑、单一主内容区和必要操作栏；不重复放置同一能力的按钮、菜单或筛选器。操作表单中的位置选择器可以保留。
- 页面居中、宽度受控、适当留白；普通员工界面简洁，管理操作按已有权限显示。
- 删除冗余 UI 必须保留实际业务能力、历史数据和原有链接，不改变授权边界。未来新增模块及页面改造均遵守这些原则。

## KDOS Dashboard 单表导出

- 所有正式 Dashboard 明细/汇总表（包括KdosDataTable）默认提供本表独立的服务端Excel导出；按钮位于该表Card/Toolbar，仅导出该表全部匹配记录，继承顶部及表内条件，禁止用前端当前dataSource/当前页生成文件。
- 同一Dashboard统一使用自己的read/export资源和字段权限，范围必须为read∩export并保持tenant隔离。无export权限隐藏按钮且后端403；tableKey采用后端白名单；英文xlsx文件名，输出业务显示值，禁止UUID和内部技术字段。
- KPI、Chart、环图和趋势图不提供Excel按钮。确因安全、敏感或临时查询结果需要豁免的表必须在对应合同/文档说明，不应等待用户逐表追加导出要求。

## KDOS 自动化任务调度治理（强制）

- 当需求涉及定时任务、E10/T+同步、n8n、systemd Timer/Service、cron、业务异步、通知、备份、脚本运行或运行时排障时，必须先阅读 `.agents/skills/kdos-task-orchestration/SKILL.md` 和 `docs/operations/TASK_REGISTRY.md`。
- 基础设施/灾备/常驻服务使用 systemd 或 Docker；业务定时及跨系统编排默认由 n8n 统一调度；事务性/高频事件消费由已有 KDOS Application/Worker/持久消费者承担。例外必须明确登记原因。
- 新建任务默认一个权威的自动调度入口；新建或确有必要迁移前检查生产 systemd（含 user）、cron、n8n 及应用内调度。**用户已确认现有任务不按业务重复任务处理，现有运行任务均维持原状，不强制迁移、不擅自停用或合并；即使不同调度器共享代码，也应在台账客观记录但不得自动整改。**不得仅凭仓库存在 unit 或脚本推断它已启用。
- 增改停任务时同步更新任务台账；仅有代码或 README 更改不等于生产迁移。必须提供执行证明、幂等/防并发、失败告警、补偿和回滚，并保护凭据及既有数据。
