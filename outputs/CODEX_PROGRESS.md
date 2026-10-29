# Codex 工作进度

## 任务
任务名称：KDOS 生产报工提交无响应排查与局部修复。
任务目标：只读核查指定订单/品项的生产任务及报工事实，修复报工提交无响应并按授权提交、推送、发布 Web 和真实浏览器验收；不写生产业务数据。
当前状态：已完成（Web/API 已发布至 a63fcc2；前端交互与后端报工字段回归通过；未写生产业务数据）。
最后更新时间：2026-10-23（Asia/Shanghai）。

## 当前阶段
当前阶段：前端交互发布及后续 API 字段映射缺陷修复发布完成。
当前子任务：无。

## 已完成
- [x] 阅读 AGENTS.md、kdos-form-validation Skill 及其 L2 验证规则；检查既有工作区，保护先前调查报告、进度文件和未跟踪 Skill 压缩包。
- [x] 核实生产 Web/API 健康，运行版本 `5b1eaaf`；当前本地 HEAD `f80d6fa`，报工页面相关代码与生产版本一致。
- [x] 生产 PostgreSQL 只读事务确认订单 `2026A027377` + 品项 `TGH704BD1-1/1` 存在一个周计划，计划数量 2，自制+外协，10 道工序可报工。
- [x] 已有两条报工：点焊 2、毛坯 2，均达到计划数量；其余 8 道工序暂无报工并处于待报工，未发现该 8 道工序有重复记录。
- [x] 定位前端按钮：待报工数量为空/非正数时 `disabled`，点击不会触发事件或 HTTP 请求，且无解释性提示；服务端/API错误路径已有明确 toast。
- [x] 首次线上浏览器实测发现静态 AntD message 在页面未呈现；改用项目 `App.useApp().message` 上下文反馈，保证提示可见。
- [x] 仅提交报工页面及定向组件测试两文件；最终 commit `647c914362fe9d96774b9b8b292f54afab5f6308` 已推送 `github/main`。
- [x] 使用干净 linked worktree 执行 Web-only 部署；生产 Web SHA 与 commit 一致为 `647c914`，API 保持 `5b1eaaf`；Web、API、PostgreSQL、Document Worker 健康。
- [x] 使用生产 Web 页面及真实 Chrome 验收，拦截报工 API 并返回合成响应：空值、0 值均可见提示且不发 POST；有效数量成功提示；快速连点仅发一个合成 POST；API 400 错误明确显示；没有未捕获 JS 错误或生产写入。
- [x] 后续排查 `order_number` 必填失败：`create()` 在 `fillReportSource()` 从周计划补齐业务字段之前创建 INSERT 字段和值列表，导致请求中的已关联周计划数据没有进入 INSERT。
- [x] 生产只读复核订单 `2026A027377` / 品项 `TGH704BD1-1/1` / `packaging` 仍启用、计划数量 2、报工记录 0；失败请求未留下报工或重复记录。
- [x] 修复为在来源字段补齐和权限/业务校验后创建 INSERT 列表；强化 `packaging` 回归断言验证订单、品项、交期和标准工序名称都落入 INSERT。
- [x] 报工 API 定向测试 13/13、API typecheck、build、`git diff --check` 通过；commit `a63fcc2c6581dc546dc0e6c6ff0e78c6ebfd3ccb` 已推送 `github/main`。
- [x] 使用干净 linked worktree 执行 `deploy.sh api` 与 `deploy.sh all`；最终 Repository/Web/API SHA 均为 `a63fcc2`，`deploy.sh check` 一致；API、Web、PostgreSQL、Document Worker 健康。

## 正在进行
- [x] 修改报工按钮零输入时的反馈，并加同步锁防止快速重复点击。
- [x] 运行报工页面目标组件测试及 Web 类型检查。

## 待完成
- [x] 复核 diff、提交推送、部署、健康检查和线上交互验收。

## 修改文件
- apps/web/src/modules/master-plan-system/MasterPlanPages.tsx
- apps/web/src/modules/master-plan-system/MasterPlanPages.spec.tsx
- outputs/CODEX_PROGRESS.md（保留既有报告与历史进度）

## 数据库 Migration
- 无；Web-only 部署，无 Migration、数据库备份或业务数据写入。

## 新增或修改测试
- 报工页面组件测试：空数量提示、快速重复点击只发出一次请求；更新成功后提交按钮状态断言。
- 生产 Chrome 浏览器交互：报告 POST 完全由浏览器路由返回合成响应，生产业务数据零写入。

## 已运行测试
测试名称：`pnpm --filter @tracker/web exec vitest run src/modules/master-plan-system/MasterPlanPages.spec.tsx --maxWorkers=2`
结果：38/38 通过。

测试名称：`pnpm --filter @tracker/web typecheck`
结果：最终代码通过（退出码 0；宿主环境提示 Node v22.23.1，项目包声明要求 >=24；生产镜像 Node 24 Web 构建通过）。

测试名称：`git diff --check`。
结果：通过。

测试名称：生产订单/品项及周计划、工序任务、实际报工只读查询；生产健康与版本核验。
结果：只读核验完成；未执行任何生产写入。

测试名称：生产 Web build info、`/health`、API `/api/v1/health`、容器健康。
结果：Web `647c914`；API `5b1eaaf`；四个服务均 healthy。

## 当前已知问题
- 订单指定的真实生产数据未用于写入验收；有效报工通过生产 Web 页面向合成 API 验证，避免修改订单/工序/历史报工。实际数据持久化仍由既有 API 实现负责。

## 等待用户确认
- 无。

## 下一步
1. 无；如之后需核实生产新报工记录，按正常授权业务流程由用户提交。

## 恢复执行说明
本轮已完成：最终 commit `647c914362fe9d96774b9b8b292f54afab5f6308` 已推送并发布至 Web；浏览器验收使用合成 API，未写生产业务数据。原工作区未提交的 T+ 调查进度、报告和 zip 文件均保留且未夹带进发布。

---

# Codex 工作进度

## 任务
任务名称：科加智能 T+19 工艺数据只读调查。
任务目标：复用 tplus-kejia 连接核实目标账套、工序/路线/BOM/存货/加工单实际工序结构与关联，解析 CHM 并生成中文报告。
当前状态：已完成（只读调查及报告）。
最后更新时间：2026-10-23（Asia/Shanghai）。

---

## 当前阶段
当前阶段：真实库关系核验及报告完成。
当前子任务：无。

## 已完成
- [x] 阅读项目 AGENTS.md；目标 Skill 路径缺失，从现有未跟踪压缩包中临时解压读取，未改动项目 Skill。
- [x] 使用项目同步器的 tplus-kejia 数据源与既有 Python 环境连接，DB_NAME() 确认为 UFTData418971_000003；未输出密钥。
- [x] 使用随 Skill 附带的 inspect_kejia_routing.py 核实候选表及字段；仅在 /tmp 副本对 LIKE 通配符做 pytds 转义后运行。
- [x] 用现有 7z 解压 CHM 并提取关键词索引；未安装软件。
- [x] 核实标准路线、BOM 版本/BOM工序、加工单实际工序及报工关联；最多读取每次 TOP 5 的样例，另以聚合统计验证连接匹配。
- [x] 生成 outputs/科加工艺数据只读调查报告.md。

## 正在进行
- [x] 无。

## 待完成
- [x] 无；报告列明未确认项。

## 修改文件
- outputs/科加工艺数据只读调查报告.md
- outputs/CODEX_PROGRESS.md（新增本任务恢复入口，保留既有内容）
- 无业务代码修改；压缩包 kdos-tplus-readonly-skill.zip 为任务前已有未跟踪文件，未修改。

## 数据库 Migration
- 无。

## 新增或修改测试
- 无；本任务为只读调查。

## 已运行测试
测试名称：SQL Server 只读元数据、行数概况、ID 关联聚合及每表最多 5 行样例；CHM 解压和索引。
结果：DB_NAME 正确；实际逻辑关系及数量见调查报告；未写入数据库。

## 当前已知问题
- 13,946 条 BOM 子件未能连接到现存 BOM 表头；原因未知。
- 8 条加工单路线来源工序的实际顺序与来源路线顺序不同；业务原因未知。
- idDefaultRouting 的 CHM 文字释义与实际 ID 关联用途存在语义歧义。
- 原始 Skill 文件只存在于未跟踪 zip，项目预期目录不存在；脚本原样运行会触发 pytds LIKE 百分号格式错误，已在 /tmp 脚本副本转义后完成。

## 等待用户确认
- 无。

## 下一步
1. 查阅 outputs/科加工艺数据只读调查报告.md。
2. 若后续要设计同步映射，先处理报告列出的未确认业务差异，不在本次调查范围内直接实现。

## 恢复执行说明
本任务已完成且止于只读调查与报告；没有同步、结构变更、部署或 Git 提交。

---

# Codex 工作进度

## 任务
任务名称：KDOS 评审交期表 V2 生产上线预检。
任务目标：只读检查Git工作区、生产Migration/数据基线、备份与发布/回退流程、Node版本风险，并产出上线就绪报告；不修改生产。
当前状态：DEPLOYED_WAITING_MANUAL_ACCEPTANCE；V2已隔离提交、推送GitHub main并部署；生产数据保持空表。
最后更新时间：2026-10-23（Asia/Shanghai）。

---

## 当前阶段
当前阶段：V2生产部署完成，等待人工验收。
当前子任务：无；生产Chrome已完成字段、模板、导出及取消式预览核验。

## 已完成
- [x] 阅读项目规范、kdos-form-platform Skill、现有V2验收/设计文档及当前Git进度；保护所有既有未提交变更。
- [x] 检查分支 `main`、HEAD `6c19507225f692c8e80a2f4d7e7a7f0c6cfc27be`、工作区改动，并区分V2文件、独立导入部署报告和多任务混合进度文件。
- [x] 只读检查Migration 105/106内容、前置表结构、顺序、生产ledger及Migration 106非可逆边界。
- [x] 生产数据库只读事务核对评审交期主表0行、历史表0行、V2组织列尚不存在、现存唯一约束/RLS/触发器。
- [x] 检查备份、升级、迁移、部署脚本，核实Node22宿主/Node24 Docker构建及生产API运行版本。
- [x] 生成 `outputs/KDOS_MPS_REVIEW_DUE_V2_RELEASE_READINESS.md`；未运行备份、Migration、部署、数据写入、commit或push。
- [x] 本轮按用户授权重新只读核对生产：主表0行、历史表0行、migration105已执行、106未执行；migration106只涉及评审交期表结构及其自身触发器/约束。
- [x] 运行 `./scripts/deploy.sh check`，正式门禁因未提交 API/Web/Contracts 等改动拒绝执行；未绕过，不运行备份/Migration/部署，也未commit/push。
- [x] 只读GET生产`build-info.json`和API health，Web/API仍是`6c19507225f692c8e80a2f4d7e7a7f0c6cfc27be`且健康。
- [x] 建立独立 worktree/发布分支，仅提交29个V2 Web/API/Contracts/Migration/测试及规格文件；提交`beb7267f19609b5b774a6d8c221449d80b9794c3`，普通push到发布分支及GitHub main；原始混合工作区未被覆盖。
- [x] `scripts/upgrade.sh`完成双库/附件备份、Node24 Docker build、停止Web/API、仅执行待运行Migration106及恢复服务；备份文件mode600，pg_restore --list通过。
- [x] `scripts/deploy.sh check`两次结果`Repository=Web=API=beb7267`、`STATUS=CONSISTENT`；API/Web/PostgreSQL/Document Worker健康。
- [x] Chrome153生产浏览器确认“事业部/品项编码/品项名称”、四个事业部选项；实际下载11列导入模板、13列导出；合成单行Excel返回201预览、新增1/错误0，取消且未调用import-confirm。
- [x] 部署后只读确认Migration106已登记，主表0行、历史表0行，RLS/FORCE RLS保留。

## 正在进行
- [x] 汇总生产上线条件、当前阻塞项及安全的上线/回退步骤。

## 待完成
- [ ] 等待用户人工验收。由于生产主表和历史表均为空，未执行新增/编辑的生产持久化写入；避免在无删除权限的正式业务表留下虚构测试数据。V2新增/编辑保存语义由既有隔离PostgreSQL/Chrome测试覆盖。

## 修改文件
- `outputs/KDOS_MPS_REVIEW_DUE_V2_RELEASE_READINESS.md`：只读预检报告。
- `outputs/CODEX_PROGRESS.md`：新增本任务恢复入口；保留既有多任务记录。

## 数据库 Migration
- 未新增或执行Migration。检查Migration 105已在生产执行（ledger id104）；Migration 106 V2未执行且`down()`拒绝安全降级。

## 新增或修改测试
- 无；本任务是生产上线只读预检。

## 已运行测试
测试名称：无。
结果：未运行测试；复用V2既有验收报告。生产查询只在`BEGIN READ ONLY`事务中执行后`ROLLBACK`。

## 当前已知问题
- V2源码仍在未提交工作区，`deploy.sh`部署门禁将拒绝；包含需排除的其它任务报告及混合历史的进度文件。
- 生产Chrome未执行新增/编辑持久化；待有真实业务记录或可安全清理的正式测试数据策略后补充验证。
- 宿主Node 22低于仓库Node >=24要求；正式Docker/API使用Node 24，发布构建/迁移应限定Docker Node24。
- Migration 106为前向不可逆迁移；目前两张业务表均为0行，但执行时必须重查。
- 本轮未执行真实备份或隔离恢复演练，不能声称已生成/验证发布备份。

## 等待用户确认
- 等待审核`outputs/KDOS_MPS_REVIEW_DUE_V2_RELEASE_READINESS.md`及后续是否开展生产发布。

## 下一步
1. 等待人工验收。
2. 不导入真实业务数据，不开启Excel自动同步；其余工作区的未提交功能继续保留在原位置，没有进入V2提交。

## 恢复执行说明
只读预检已完成。后续会话先读本段、项目Skill、`git status`与`git diff --stat`；不要覆盖或清理此前任何V2或其它任务未提交改动。未经明确批准不得运行备份、Migration或部署。

---

# Codex 工作进度

## 任务
任务名称：KDOS PMC 主计划系统评审交期表 V2 整改与真实验收复核。
任务目标：核实“试制计划图号/验货时间名称/事业部”线上显示问题根因，验证本地 V2 真实页面与 Excel，必要时仅修复本地缺陷并留存截图/文件证据。
当前状态：LOCAL_VERIFIED_WAITING_MANUAL_ACCEPTANCE；本地 V2 字段、Chrome与Excel验收通过；生产版本未部署，线上仍是旧版。
最后更新时间：2026-10-23（Asia/Shanghai）。

## 当前阶段
当前阶段：本地验收完成，等待人工验收。
当前子任务：已生成专属报告及隔离证据；停止，不进入生产发布。

## 已完成
- [x] 阅读用户任务、项目AGENTS、kdos-form-platform Skill、V2验收报告、设计文档及本进度；恢复检查HEAD=6c19507225f692c8e80a2f4d7e7a7f0c6cfc27be，保护既有工作区改动及另一任务报告。
- [x] 调用链事实核查：Contracts定义标签；ReviewDueDates.tsx从字段合同生成表格/表单；API query按资源/字段权限返回divisionId；Spreadsheet模板及导出从同一字段合同生成。
- [x] 本地合同为“事业部/品项编码/品项名称”，V2新增Migration106存在；生产Web/API健康版本仍为6c19507，生产ledger仍104且无V2事业部列，根因是V2没有提交/部署，生产旧页面自然显示旧名称且缺事业部。
- [x] 将本地Chrome验收脚本扩展为多张页面状态截图，并保存真实浏览器下载的Excel模板/导出文件；仅指向隔离API/数据库。
- [x] 生产只读核验：Web/API=`6c19507225f692c8e80a2f4d7e7a7f0c6cfc27be`且健康；数据库最新migration id104 FinanceE10SourcePresenceAndTimestamps1722920105000，V2两事业部列不存在，主表0行，change_count仍NOT NULL、updated_by仍varchar；生产静态包目标字段合同仍是旧中文名。
- [x] Contracts33、API511通过（既有3套件20项跳过）、Web21通过、隔离PostgreSQL/HTTP/Chrome32通过；全项目typecheck/lint/build通过，lint仅既有warning，build仅既有大包warning，Node22因仓库要求>=24有引擎提示。
- [x] 本地真实Chrome 153页面截图7张，实际下载11列空模板和13列导出并逐列核对；所有写入只到无网络隔离PostgreSQL，productionRequests=0。
- [x] 修正Web测试里过期的“六个旧字段”描述，并补充事业部选择控件/手工次数控件编辑态可见断言；未发现需要改动V2业务实现的本地功能缺陷。
- [x] 生成`outputs/KDOS_MPS_REVIEW_DUE_V2_FIX_ACCEPTANCE.md`，分别说明本地通过与生产未部署，保留本任务截图和合成Excel证据。

## 正在进行
- [x] 本地相关API、Contracts、Web、类型检查/lint/build及隔离PostgreSQL/真实Chrome复核。
- [x] 生成验收报告及截图/Excel证据索引，更新本进度。

## 待完成
- [x] 完成本地实际V2浏览器及Excel复核并检查每张截图。
- [x] 输出版本差异、三项根因及尚未部署范围。
- [ ] 等待用户人工验收；生产V2上线需另行解除本任务明确的“不提交、不迁移、不部署”限制。

## 修改文件
- `scripts/review-due-fields-v2.browser-checks.cjs`：新增多状态截图、实际下载模板/导出文件留证和精确表头断言。
- `apps/web/src/modules/master-plan-system/ReviewDueDates.spec.tsx`、`ReviewDueDates.create.spec.tsx`、`ReviewDueDates.edit.spec.tsx`、`apps/web/src/modules/permissions/ReviewDueDatePermissions.spec.tsx`：更新V2测试描述并核验组织/计数控件。
- `outputs/KDOS_MPS_REVIEW_DUE_V2_FIX_ACCEPTANCE.md`：新增本任务验收报告；忽略目录`data/review-due-v2-fix-20261023/`存放本地合成证据。
- `outputs/CODEX_PROGRESS.md`：更新本任务状态，保留后续所有历史任务记录。

## 数据库 Migration
- 复核既有`1722920106000-MpsReviewDueDateFieldsV2.ts`；本任务未新增Migration、未执行生产Migration。

## 新增或修改测试
- 扩展既有V2隔离PostgreSQL/Chrome验收脚本截图与实际下载文件归档；更新4个过期Web测试描述并补控件断言。

## 已运行测试
- Contracts：33项通过。
- API相关：511项通过，3个既有环境型套件20项跳过。
- Web资源/权限：21项通过；首次默认5秒时限有2项超时，使用15秒测试等待窗口后全部通过，断言保留。
- 隔离PostgreSQL/HTTP/Chrome：32项通过，Chrome153真实页面、7张截图、模板11列/导出13列。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check`通过；lint保留1项既有warning，build保留大包warning。宿主Node22与仓库>=24引擎要求不符，命令发warning；Node24容器尝试触发依赖目录重装时被pnpm的无TTY保护中止，未清理或替换依赖。

## 当前已知问题
- 生产旧版本差异已证实；本任务明确禁止部署，因此不能在本轮让生产页面即时显示V2。

## 等待用户确认
- 本地验收完成后等待人工确认；本任务禁止Git commit/push、生产Migration和部署。

## 下一步
1. 交付`outputs/KDOS_MPS_REVIEW_DUE_V2_FIX_ACCEPTANCE.md`并等待用户人工验收。
2. 不commit/push，不执行生产Migration或部署；只有用户另行授权上线阶段后再按备份和非空数据门禁实施。
3. 保持生产旧版本现状，本轮到此停止。

## 恢复执行说明
本地验收完成。保持当前V2源码、其他任务未提交内容和独立报告；不暂存/提交/推送，不调用生产写入或部署；浏览器HARNESS仅访问本地隔离Nest和/tmp PostgreSQL。报告说明生产当前仍旧版，且该发布被本任务明确禁止。

---

## 任务
任务名称：KDOS-MPS-REVIEW-DUE-FIELDS-V2-001 评审交期表字段结构调整及标准审计字段改造。
任务目标：在不写生产业务数据、不提交、不部署的前提下，完成事业部组织字段、手工变更次数/上次入库时间、四个标准审计字段及统一 Excel/API/页面合同的本地实现与隔离验收。
当前状态：WAITING_MANUAL_ACCEPTANCE（本地开发、隔离验收及环境清理已完成；未提交、未部署、未执行生产Migration，等待人工审核）。
最后更新时间：2026-10-23（Asia/Shanghai）。

## 当前阶段
当前阶段：本地工作已完成，停止等待人工验收。
当前子任务：无；不进入GitHub、生产部署或真实数据导入。

## 已完成
- [x] 读取用户完整任务、项目 AGENTS、kdos-form-platform Skill、现有进度、Git 状态和评审交期核心文件清单。
- [x] 确认起始 HEAD `6c19507225f692c8e80a2f4d7e7a7f0c6cfc27be`；工作区只有既有进度文件修改和另一任务未跟踪验收报告，无源码遗留修改。
- [x] 确认本轮禁止 Git commit/push、生产部署、真实 Excel 导入及生产写入；生产数据库只读。
- [x] 上轮生产只读确认：主表0、历史0、相关审计0、导入预览0；四事业部均为企业微信目录中启用的凯南直属二级节点。updated_by为varchar且无历史值。
- [x] 保留drawingNumber/inspectionTimeName稳定键，业务显示改为品项编码/品项名称；9个业务字段与4个只读审计字段合同完成。
- [x] 前向Migration106草稿完成：事业部/初始来源事业部、双唯一、UUID更新人、可空手工字段；移除自动计次数量/日期一致性约束，保留历史不可修改及RLS。非空旧表不能推断归属时原子拒绝。
- [x] 人工编辑、Excel Confirm及observe不再自动计次或创建交期事件；Excel可选空白更新保留、[清空]显式清空，保留正式审计/事务/幂等。
- [x] API聚焦86项、Web/权限21项通过；Web typecheck通过。隔离PG V2脚本已建立，未连接生产执行任何写入。
- [x] V2隔离PostgreSQL/HTTP/Chrome153共32场景最终全部通过；跨200行导出、read∩export、真实组织候选/筛选、手工清空、审计失败回滚、租户/RLS、原身份和旧历史保护通过。
- [x] API相关41组511项通过（既有3组20项环境型跳过）；Contracts33项通过；本资源Web/权限21项最终整组通过，既有主计划页面36项通过。
- [x] Chrome真实下载11列空模板及13列筛选Excel；单一导入取消/合成确认一次，仅隔离数据库写入。业务数值和姓名/上海时间正确，未请求生产写入。
- [x] 完成时生产只读仍主表0/历史0/审计0/预览0、ledger104、未出现V2新字段，Web/API仍6c19507；本地源码未提交时deploy check按既有门禁拒绝，未绕过。
- [x] 本地设计文档和`outputs/KDOS_MPS_REVIEW_DUE_FIELDS_V2_ACCEPTANCE.md`已生成，明确WAITING_MANUAL_ACCEPTANCE、兼容边界和未来上线/回退方案。
- [x] 最新源码全项目typecheck/lint/build通过，git diff --check通过；临时Vite及无网络tmpfs PostgreSQL容器已清理，证据目录700/文件600。未stage/commit/push，HEAD保持6c19507。

## 正在进行
- [x] 读取现有 Migration、Application/Import/Query、Web、Excel、组织目录和测试，形成兼容实现方案。
- [x] 只读核验生产主表/历史表数量、真实约束、审计历史值及四事业部组织 UUID。

## 待完成
- [x] 增加前向 Migration，调整事业部/唯一约束/手工字段/旧自动计次约束并保护历史。
- [x] 统一 Contracts、领域校验、专用人工命令、Excel Preview/Confirm、查询/导出及权限边界。
- [x] 调整网页字段顺序、组织选择器、新增/编辑/筛选/模板和历史说明。
- [x] 完成 API/Web/Contracts、隔离 PostgreSQL、本地 Chrome及最终typecheck/lint/build验收。
- [x] 生成 `outputs/KDOS_MPS_REVIEW_DUE_FIELDS_V2_ACCEPTANCE.md`，状态 WAITING_MANUAL_ACCEPTANCE。

## 修改文件
- Contracts评审交期/Registry；Migration106及测试；专用Application/Import/Query、组织选项、资源配置、Spreadsheet及通用拒绝提示；评审交期Web/导入及测试；V2隔离/Chrome脚本；设计/验收报告及本进度。完整范围见验收报告。

## 数据库 Migration
- 新增1722920106000-MpsReviewDueDateFieldsV2.ts；只在隔离PostgreSQL执行，生产未执行，不修改历史Migration。

## 新增或修改测试
- 9业务/4审计字段合同、专用写入权限/字段/域校验、V2迁移、Web/权限编辑器、组织候选/筛选及32项隔离PostgreSQL/HTTP/Chrome。旧自动计次断言由V2手工语义取代。

## 已运行测试
测试名称：API/Contracts/Web/隔离PostgreSQL及Chrome。
结果：API511、Contracts33、Web21+既有主计划36、隔离PG/HTTP/Chrome32项通过。最新全项目typecheck/lint/build通过；既有FastRefresh/大包提示保留。API原有3组20项环境型跳过，本任务写入已由隔离32项覆盖。

## 当前已知问题
- 无未解释业务或迁移异常。旧表若在未来上线前出现记录，Migration会拒绝，不会猜事业部；上线前必须再次只读检查。
- V2是手工维护语义；旧应用不能直接恢复旧自动计次写入。回退需先暂停本资源写入口并部署经验证的V2兼容版本/前向修复，不恢复旧库覆盖业务。

## 等待用户确认
- 无；本轮已明确授权本地开发和隔离测试，完成后等待人工验收。

## 下一步
1. 已完成本地工作并停止，等待用户人工审核；正式报告`outputs/KDOS_MPS_REVIEW_DUE_FIELDS_V2_ACCEPTANCE.md`。
2. 未获后续明确授权前，不提交/push、不迁移/部署生产、不导入真实文件、不启动同步。
3. 用户授权上线后按报告门禁重新只读检查生产；若旧表非空，先完成人工事业部归属核实，不猜测或清表。

## 恢复执行说明
新会话按项目规范→kdos-form-platform Skill→本文件首段→git status/diff继续。保留 `outputs/KDOS_MPS_REVIEW_DUE_IMPORT_DEPLOY_ACCEPTANCE.md` 和既有进度修改；不得提交、部署或向生产评审交期表写入。

---

# Codex 工作进度

## 任务
任务名称：KDOS 财务中心订单缺失、ERP删除同步及系统审计时间修复。
任务目标：只读取证两张指定订单，修复可确认的月度误排除与ERP删除识别，并在系统导出/月度数据透出真实KDOS创建和更新时间，完成测试、备份、迁移、部署、Chrome验收及GitHub同步。
当前状态：已完成（根因调查、实现、回归、备份、迁移、生产数据修复、Chrome/Excel验收及GitHub同步完成）。
最后更新时间：2026-10-22（Asia/Shanghai）。

## 当前阶段
当前阶段：生产发布与验收完成。
当前子任务：验收报告及最终版本一致性收尾。

## 已完成
- [x] 读取项目AGENTS、kdos-form-platform、kdos-task-orchestration及现有任务台账；确认FIN-003/FIN-004当前由n8n每日08:30统一编排，现有调度不得擅自停用或新增独立Timer。
- [x] 恢复检查：起始HEAD、github/main和生产版本均为b05df9153671ef9aab2a4e71760035ed270278d4；工作区仅上一任务本地验收报告及本进度文件，无源码遗留修改。
- [x] 生产实际视图及七表只读复演：2301-2026A003326对应两个来源ID；当前有效2718.60元来源通过审核/非材料/非指定结束/无序号或品项异常，唯一命中条件为`NOT o.duplicate_order_no`。
- [x] E10当前仅保留2718.60元来源；旧0元来源已于2026-10-20物理删除且DataLog ActionType=1。此前2301-2026A5001026为同型，旧来源已被FULL标记缺失，现行重复判断不再误伤。
- [x] S-2610020在E10订单头/品项均0行，2026-10-21 11:19:39有稳定订单ID及两个品项ID的ActionType=1删除证据；KDOS仍保留source_missing=false并计入39090.52元。
- [x] 全源只读身份快照实测19115单/108090行，1.457秒；与KDOS比较发现11个待失效品项、3张整单删除、2张部分品项删除、0条需恢复。正常统计仍误含1张/39090.52元；重复单号误排仅1张/2718.60元。
- [x] Reader/Application已实现增量Presence分页、年度/全局唯一/降幅门禁、缺失及恢复审计；失败对账不写入，恢复复用原UUID且不生成金额事件。
- [x] Migration105已在隔离PostgreSQL真实执行：系统导出隐藏历史缺失行，订单/资格/余额/月度发生额按当前品项重算，部分删除不整单误排；原始行和变更事件保留。
- [x] 系统导出与月度合同、网页和Excel已增加KDOS创建/更新时间；系统源时间来自持久行，月度时间来自来源行、变更事件和客户分类持久时间，不使用视图当前时钟。
- [x] 隔离PostgreSQL 50场景通过，覆盖不完整清单原子拒绝、整单/品项删除、重复身份修复、恢复、无事件伪造、无变化时间不更新、真实变化/分类变更更新时间、Excel时间列及RLS/权限回归。
- [x] 变更台账隔离PostgreSQL 12场景通过；删除品项关联的历史变更仍保留在台账，但动态统计停止计入，恢复同一来源身份后安全恢复且不复制事件。
- [x] 聚焦API 55项、Web 13项、Contracts 33项及Python Reader 5项通过；表格公共审计列会去重同名时间字段。
- [x] 全项目typecheck/lint/build通过；生产双库和附件备份已完成并验证格式、权限和SHA，发布前四服务健康且Web/API版本一致。
- [x] 功能Commit `4ee9a798eb81444b1648a6aaf749b4108775fd52` 已正常push github/main；部署及Migration105成功，生产ledger ID 104。
- [x] 受控`run-finance-daily.sh --update-only`成功，108090个E10来源身份完整，11个缺失品项被审计失效，企业微信通知0条；未执行FULL。
- [x] A003326已显示2个系统导出品项和1条2026-10月度发生额2718.60；S-2610020正常系统导出/月度均已排除，历史2行及39090.52原金额保留。
- [x] 2026-10月度/大屏/事业部/内外销/客户排名均勾稽为514单、39115212.02；精确来源订单跨月差异0.00。
- [x] Chrome153及Excel真实验收通过：系统导出36列/2行，月度17列/1行，两个KDOS时间均正确按Asia/Shanghai显示且无重复列。
- [x] n8n运行态核验：唯一自动入口`KDOSFinanceMonthlySummaryV1`启用，每天08:30；旧台账工作流停用，仅保留人工补跑。本次未修改调度。

## 正在进行
- [x] 最终验收报告和版本一致性闭环。

## 待完成
- [x] 确定两张订单根因、同类影响订单数量和金额及最小修复边界。
- [x] 设计并实现低成本、可恢复、失败不误删的ERP来源存在性校验，复用现有n8n日流程且不新增调度器。
- [x] 为系统导出和月度数据增加真实KDOS创建/更新时间，含字段权限、网页、Excel与Asia/Shanghai显示。
- [x] 完成前向Migration、API/Web/Contracts/隔离PostgreSQL、金额对账、性能及Chrome验证。
- [x] 修改生产前备份，安全部署、健康检查、生产定向校验、Git提交和正常push；未发生冲突或金额归属不明。

## 修改文件
- Contracts财务字段；Finance Order Application/Query、Migration105及测试；财务Web页面/测试；E10 Reader/测试；两个隔离PG脚本；财务实现文档、runbook、任务台账及本进度。

## 数据库 Migration
- 1722920105000-FinanceE10SourcePresenceAndTimestamps.ts；仅前向增加Presence暂存、重建派生视图并回填时间字段读取权限，不修改历史migration或物理删除财务数据。

## 新增或修改测试
- Reader存在性/恢复参数；合同与UI列；Migration SQL；隔离PostgreSQL删除、恢复、误判、时间、Excel及原子失败场景。

## 已运行测试
测试名称：核心专项及隔离PostgreSQL。
结果：Python Reader 5项、API聚焦55项、Web财务13项、Contracts 33项、隔离PostgreSQL 50+12场景通过；全项目typecheck/lint/build通过。生产视图定义、金额勾稽、性能、Chrome及Excel验收通过。

## 当前已知问题
- 无阻塞问题。生产实测指定订单约4.66秒、整月汇总约3.25秒；未恢复此前约30秒慢查询。
- 月度派生时间已严格来自持久化的finance_e10_lines、finance_e10_change_events和finance_customer_mappings时间，不使用视图计算时钟。

## 等待用户确认
- 无；用户已授权在证据充分后实施修复、备份、部署、commit及push。

## 下一步
1. 提交最终验收报告并正常push GitHub main，排除上一任务未提交报告及本进度文件。
2. 部署最终文档Commit并确认Repository=Web=API一致。
3. 停止，不重复运行同步或修改生产数据。

## 恢复执行说明
任务已完成。保留上一任务未提交的outputs/KDOS_MPS_REVIEW_DUE_IMPORT_DEPLOY_ACCEPTANCE.md及本进度文件当前工作区修改，不得混入本任务最终报告提交。E10始终只读，未运行FULL、未直接修改E10、未新增Timer。

---

# Codex 工作进度

## 任务
任务名称：KDOS-MPS-REVIEW-DUE-IMPORT-DEPLOY-001 评审交期Excel导入修复正式上线。
任务目标：安全提交及推送已验收修复，备份、正式部署与版本一致性检查，真实Excel仅生产预览并取消，验证业务数据及授权/同步配置不变。
当前状态：WAITING_MANUAL_ACCEPTANCE；正式发布和受控Chrome验收完成，用户人工验收待完成；无生产确认导入。
最后更新时间：2026-10-22（Asia/Shanghai）。

## 当前阶段
当前阶段：发布及验收收尾完成，停止。
当前子任务：无；等待用户人工验收，不进入真实数据确认或每日同步。

## 已完成
- [x] 规范、表单/任务Skill、台账、既有修复验收/设计及部署备份/回退流程阅读。
- [x] 起始HEAD及github/main、远端GitHub main均18357f6bb3a3384b902eec3c76315b73a893edd8；工作区仅本任务修复，无他人混杂改动。
- [x] 项目remote为github，无origin，实际git fetch github完成，无远端超前/冲突；此前93 API/20 Web/33 Contracts/64隔离PG+Chrome证据存在。

## 正在进行
- [x] 正式账号Chrome登录及metadata200，create/update/import/export/template齐全；不保存明文凭据到文件。
- [x] 生产当前Web/API=6aedfdc220ae071ea3a05bf88875811bbac532be；4服务健康，103 Migration无pending。主表0/历史0/数量0/改期次数0，完整业务指纹/7权限表/6flags已记录。
- [x] 152012两库及附件备份，SHA-256、PGDMP/pg_restore目录及tar全部可读，600权限；不执行生产恢复。
- [x] 实文件SHA=e65a4abb13e22d4b9a1603e5e324431919040ede1c43df610eeeb628860614f1，43966字节；本轮新跑API93/Web20全部通过。

## 待完成
- [x] 17任务文件白名单提交并push github/main，远端完整SHA=b05df9153671ef9aab2a4e71760035ed270278d4，无force、无其他任务/真实数据/凭据。
- [x] deploy all/check成功，Repository=Web=API=b05df9153671ef9aab2a4e71760035ed270278d4，STATUS=CONSISTENT，四服务健康，103 Migration无pending。
- [x] 部署后保护门禁发现role_organization_scopes 6→7后立即停止；只读审计定位15:30:19系统管理员网页更新采购角色，组织1→2。用户明确确认其并行授权调整并要求保留、继续；原始基线保留，只有该已确认例外允许，当前7条作为恢复后的基线。其他6权限表/评审权限/业务指纹/flags/ledger均不变。
- [x] 正式Chrome153：真实1114行/1009696完整预览、逐行匹配、全部新增且无错误冲突，取消，确认请求0；八列识别、八列模板真实下载、新增取消/编辑模式/10列空表导出、加密/损坏提示及401通过。
- [x] 最终主表0/历史0/数量0/改期次数0，完整业务指纹/103 Migration/六flags/评审权限明细与原始基线一致。其余6权限表不变，采购角色并行变更经用户明确确认；恢复后的7条组织范围指纹保持不变。
- [x] outputs/KDOS_MPS_REVIEW_DUE_IMPORT_DEPLOY_ACCEPTANCE.md正式报告完成；代码提交/GitHub/部署/预览/模板/业务不变六项PASS，最终仅WAITING_MANUAL_ACCEPTANCE。

## 修改文件
- 上轮修复及必要测试/验收文档；本轮新增部署验收报告、更新设计当前规则及本进度。

## 数据库 Migration
- 无新增Migration；上线前检查数据库ledger与仓库对应，无待运行结构变更才部署。

## 新增或修改测试
- 不重复开发；复核现有测试证据，生产只做受控预览和读取，不执行确认写入。

## 已运行测试
- Git远端main、正式Repository/Web/API完整SHA全部b05df9153671ef9aab2a4e71760035ed270278d4，STATUS=CONSISTENT；四服务健康。
- 本轮API93/Web20通过，既有Contracts33/PG+Chrome64/typecheck/lint/build证据复核通过。
- 正式Chrome预览/模板/错误/取消及前后只读不变性检查通过，详见正式报告和忽略目录证据。

## 当前已知问题
- 无未解决异常；采购角色并行授权已按用户确认保留。生产空表不实际保存新增/编辑，写入回归来自隔离测试；不冒用其他员工做生产403测试。

## 等待用户确认
- 最终用户人工验收；本轮已授权发布，不再等待重复许可。

## 下一步
1. 已停止，等待用户人工验收。
2. 不确认导入、不开发或启用同步、不处理其他PMC任务。

## 恢复执行说明
项目规范→Skill→本文件→git status/diff→继续。用户已解除上轮不提交/不部署限制，但绝对禁止import-confirm、真实业务新增/编辑及同步。证据仅忽略目录data/mps-review-due-import-deploy-20261022/；不写入凭据到跟踪文件。异常按用户要求停止，不擅自回填、清表或恢复生产数据库。

---

# Codex 工作进度

## 任务
任务名称：KDOS-MPS-REVIEW-DUE-IMPORT-FIX-003 统一导入方式及Excel解析修复。
任务目标：复用现有Preview/Confirm命令，统一六列新增与八列ID/版本更新，精确区分Excel错误并完成本地隔离验证。
当前状态：WAITING_MANUAL_ACCEPTANCE（本地修复及隔离测试已完成，待用户人工验收；未上线、未提交GitHub、未写生产业务数据）。
最后更新时间：2026-10-22（Asia/Shanghai）。

## 当前阶段
当前阶段：本地开发、真实原件解析和全部隔离回归完成，验收报告已生成。
当前子任务：无；停止，等待用户人工验收及另行授权上线。

## 已完成
- [x] 附件完整要求、项目AGENTS、表单Skill、既有导入实现与相关安全规范核对。
- [x] 起始HEAD=18357f6bb3a3384b902eec3c76315b73a893edd8，工作区干净；不改用户既有提交。
- [x] 本机/home/Jerry及项目data搜索本次原文件未找到，已请求准确路径；不以模拟文件替代真实故障复现。

## 正在进行
- [x] 统一上传表头识别及前端流程，保留历史预览兼容；无view要求，历史SOURCE只用于旧账本。
- [x] 加密/ZIP结构/ExcelJS兼容/表头/逐行错误分类及真实类型、堆栈帧、requestId脱敏诊断。

## 待完成
- 用户人工验收及另行授权GitHub同步/部署；本轮按要求停止。
- [x] API93项、Contracts33项及隔离PG/HTTP/真实Chrome64场景通过。
- [x] Web完整20项全部通过；修正测试旧DOM引用和AntD动画等待，保留全部断言。
- [x] 最新源码递归typecheck/lint/build通过；保留既有FastRefresh及大包提示。
- [x] outputs/KDOS_MPS_REVIEW_DUE_IMPORT_FIX_ACCEPTANCE.md及最终状态记录完成；临时PG容器/Vite已清理。

## 修改文件
- 专属review-due-date-workbook.ts及测试；既有Spreadsheet评审交期分支、Import Application错误文案。
- ReviewDueDates.tsx / import.tsx及import/edit测试；Contracts字段模板说明及测试。
- apps/api/package.json / pnpm-lock.yaml直接依赖saxes6；两个既有隔离PG/Chrome脚本。
- 本进度及outputs/KDOS_MPS_REVIEW_DUE_IMPORT_FIX_ACCEPTANCE.md；完整路径见报告。

## 数据库 Migration
- 无；既有结构、RLS、来源键及历史约束均保持。

## 新增或修改测试
- 既有导入、手工创建/编辑、权限及隔离数据库用例将复用扩展。

## 已运行测试
- 最终API93项、Web20项、Contracts全量33项通过；递归typecheck/lint/build及最终Web typecheck/lint通过。
- PostgreSQL18 + HTTP +真实Chrome 64场景通过，临时容器network=none/tmpfs/独立Unix socket，不接生产卷；覆盖人工编辑/创建/导出、六八列、历史SOURCE、日期/Decimal、权限/RLS、乐观锁及整批回滚。
- 真文件直接ExcelJS错误及堆栈证据位于忽略目录data/mps-review-due-import-fix-20261022/real-exceljs-original.json（600）。

## 当前已知问题
- 用户已在同一路径更新为未加密文件；43966字节，SHA256=e65a4abb13e22d4b9a1603e5e324431919040ede1c43df610eeeb628860614f1。
- 真实ExcelJS4.4.0异常为TypeError读取sheets：合法x:命名空间标签未被识别；仅改命名空间后还有TypeError读取table.name：ExcelJS不能处理绝对内部table Target。已用SAX按URI/精确位置进行内存等价适配，不改原文件或任何业务文字/属性值，不删除工作表/表格。
- 独立XML读取全部1114行与兼容ExcelJS六列逐项一致，数量1009696、重复键0、公式0；批次含斜线237行、图号含斜线28行全部保留，日期与Decimal全部一致。所有XML语义和内部table目标等价核对通过；真实文件Chrome只预览后取消，无正式业务写入。

## 等待用户确认
- 本地验收完成后等待用户人工验收及单独授权GitHub同步/上线；本任务明确不自动部署。

## 下一步
1. 等待用户人工验收；本轮停止，不上线、不提交、不确认导入。
2. 仅在用户另行授权后，按验收报告部署前检查继续；不重新实现已通过的导入能力。

## 恢复执行说明
规范→Skill→本文件→git status/diff→继续未完成项。当前用户明确禁止部署、GitHub提交及生产导入，优先于此前全局发布要求。旧任务记录以下保留，仅为历史；不得继续旧SOURCE首次导入要求。

---

# Codex 工作进度

## 任务
任务名称：系统管理员手工重置用户密码入口完善。
任务目标：在现有用户管理列表/编辑窗口提供清晰的重置入口、确认/加载/失败与刷新反馈，沿用默认密码和强制改密规则；修复相关权限/租户/审计边界。
当前状态：开发与发布已完成；生产管理员登录后的人工验收待确认。
最后更新时间：2026-10-22（Asia/Shanghai）。

## 当前阶段
当前阶段：8文件功能已正常推送并部署，生产三方一致；报告已完成。
当前子任务：无。Repository=Web=API=GitHub main=6aedfdc220ae071ea3a05bf88875811bbac532be；STATUS=CONSISTENT。生产登录后实际重置仍待管理员验收。

## 已完成
- [x] AGENTS、表单/任务Skill、现有用户管理与重置接口、测试/权限/审计结构阅读。
- [x] 起始HEAD5477b370；上一轮导入功能部署已完成，生产三方一致；仅本地outputs进度改动，保留其他任务记录。
- [x] 既有重置藏于编辑抽屉“更多”，无确认/防重/错误反馈；后端重置写入在Controller且未按租户锁定目标。

## 正在进行
- [x] 列表操作菜单及编辑窗口共用确认弹窗；加载锁、错误保留、刷新失败只重试刷新；系统管理员可见，admin受保护。
- [x] 既有接口委托Application，真实启用管理员与grant/租户校验、目标行锁/可选expectedVersion/非敏感UUIDv7审计及原子事务。

## 待完成
- [x] API/Web权限、确认/取消、失败、并发/事务审计测试及相关typecheck/lint/build。
- [x] 141154两库/附件新备份SHA、600权限、pg_restore目录及tar验证通过；Chrome实际写入仅隔离账号。
- [x] 8文件功能提交6aedfdc220ae071ea3a05bf88875811bbac532be；正常push和正式deploy all已启动。
- [x] 正式all/check及远端核验一致、四服务健康、生产Chrome页面200/新UI产物/无登录401；9保护表/6flags/8视图一致，评审交期0/0。
- [x] outputs/KDOS_ADMIN_PASSWORD_RESET_ACCEPTANCE.md；补齐上一任务未完成状态报告outputs/KDOS_MPS_REVIEW_DUE_FIRST_IMPORT_ACCEPTANCE.md。
- [ ] 生产已登录管理员自行核对并确认真实成员密码重置；无有效登录凭据，不伪造身份，不声称00117已重置。

## 修改文件
- API controllers.ts、admin-application.service.ts、admin-password-reset.spec.ts；Web AdminWorkspace.tsx/原测试、ResetPasswordModal.tsx/测试；本进度及本轮验收报告。

## 数据库 Migration
- 无；沿用users、administrator_grants与audit_logs。

## 新增或修改测试
- 新增API9项、Web弹窗4项及主页面入口/权限2项；隔离PG/HTTP10组和真实Chrome交互验收。

## 已运行测试
- API9项及admin/auth回归56项通过；隔离PG/HTTP10组通过，真实Chrome（仅隔离写入）列表/抽屉、取消不写入、双击单POST、默认密码/强制改密、状态保留及admin禁止通过。
- 递归typecheck/lint/build通过；lint0错误/1既有FastRefresh警告，构建保留既有大包提示。Web14项全部通过；测试修正等待AntD动画及处理测试环境重复aria标签，不弱化真实Chrome验证。

## 当前已知问题
- 当前没有有效管理员交互登录凭据；不绕过登录或伪造管理员身份，生产重置及登录后Chrome验收依赖正式管理员登录。

## 等待用户确认
- 后续真实用户密码重置由管理员使用新增入口操作；不因此改账号权限或启停状态。

## 下一步
1. 管理员在系统管理→用户管理→成员操作→重置密码中人工验收；本轮停止，不擅自重置真实账号。
2. 评审交期首次导入仍待准确原文件和正式登录；SOURCE预览后必须由用户本人确认。

## 恢复执行说明
规范→相关Skill→本文件→git status/diff；本轮证据data/admin-password-reset-20261022。评审交期原文件仍缺，首次真实导入必须用户网页确认；品项更正仍仅调查。上一轮不重复commit/push的限制针对已有代码部署，本轮新增密码重置功能按项目Git安全规则单独提交，不提交未授权旧任务报告或真实ERP数据。

---

# Codex 工作进度

## 任务
任务名称：KDOS-MPS-REVIEW-DUE-GOLIVE-001 评审交期导入正式上线与首次导入。
任务目标：发布现有导入/模板功能，核验指定原始六列Excel并生产SOURCE预览，用户亲自在网页确认后核验首次导入。
当前状态：进行中；用户已授权备份和部署，但要求用户本人点击确认导入；本任务不commit/push。
最后更新时间：2026-10-22（Asia/Shanghai）。

## 当前阶段
当前阶段：备份与测试通过，执行正式deploy all；原文件路径及可用管理员登录待用户提供。
当前子任务：部署已有代码并核对三方版本，保持零记录；无法凭失效管理员初始密码做真实登录，不伪造管理员身份。

## 已完成
- [x] AGENTS、表单/任务Skill、任务台账及既有导入验收和实现核对，不重新开发。
- [x] HEAD及GitHub main=5477b3702306a7917bc91caa5b48c9aee917f4f9，起始工作区干净；生产Web/API=389557f，deploy.sh check真实MISMATCH，按钮缺失原因是未部署现有功能。
- [x] 指定文件在/home/Jerry和/data/automation按准确文件名未找到；已向用户请求服务器准确路径，不用旧版替代。

## 正在进行
- [x] 生产只读主表0/历史0，6flags与9权限/映射表、8财务视图保护基线；ledger103；admin现有系统管理员，无需扩大权限组。
- [x] 现有API聚焦45项、Web导入/新增/编辑14项通过；业务代码无需修改。
- [x] 发布前135150两库及附件备份完成；三份SHA-256、600权限、pg_restore目录及tar列表通过；恢复方式记录，未向生产做恢复演练。
- [x] 正式deploy all/check完成，Repository=Web=API=5477b3702306a7917bc91caa5b48c9aee917f4f9，STATUS=CONSISTENT；四服务healthy。

## 待完成
- [ ] 正式deploy all/check、生产Chrome新增/导入/模板及筛选/导出/历史与403验收。
- [ ] SHA-256/工作表/1139条/无业务键重复/数量1025842核验；SOURCE模式正式页面预览。
- [ ] 展示真实预览并等待用户在网页亲自确认；不得由Codex代点。
- [ ] 用户确认后，只读核验行数/数量/计数0/历史0/审计/重复SOURCE预览未变化及6flags/版本，生成指定报告。

## 修改文件
- outputs/CODEX_PROGRESS.md；待生成outputs/KDOS_MPS_REVIEW_DUE_FIRST_IMPORT_ACCEPTANCE.md。无源码改动。

## 数据库 Migration
- 现有导入实现无需新Migration；部署前确认已应用ledger，禁止附带真实数据seed。

## 新增或修改测试
- 不重复实现；复核已有测试证据，运行必要聚焦回归和生产只读/浏览器验收。

## 已运行测试
- 起始工作区/远端核验；deploy.sh check=MISMATCH（Repository新、Web/API旧），是本次应修复的发布差异。

## 插入任务
- 用户另行要求重置账号00117密码；使用现有管理员重置接口和正式审计，保留权限/启停状态。生产备份已完成，但正式管理员初始密码登录401，尚未重置；已请求用户提供可用管理员登录方式，不直接改密码库、不将明文密码写入进度。

## 当前已知问题
- 指定Excel在已查服务器位置未找到；用户准确路径待回复，不使用替代文件。
- 管理员初始密码已失效，正式登录401；当前缺少可用管理员登录，阻止正式Chrome功能验收、生产SOURCE预览和00117密码重置。功能发布可独立完成。

## 等待用户确认
- 提供指定原文件准确服务器路径及可用管理员登录方式；真实预览正确后，用户须亲自在网页点击确认导入。

## 下一步
1. 保护基线和备份验证、聚焦测试/权限确认。
2. 发布既有代码，生产Chrome验收。
3. 原文件核验与SOURCE预览；等待用户网页确认后完成验后核对。

## 恢复执行说明
规范→Skill→本进度→git status/diff；本任务证据data/mps-review-due-golive-20261022。保留本地PMC编码调查报告，不处理该修复。不改其他业务、6flags、权限组或调度；不commit/push。导入确认动作仅用户执行。

---

# Codex 工作进度

## 任务
任务名称：KDOS PMC 品项编码更正影响范围调查。
任务目标：只读核验目标订单品项的稳定来源身份、记录链、约束/同步/事实风险和专用更正方案；真实订单与明细保留在本机受限报告。
当前状态：已完成（只读调查）；修复未执行，等待用户审核。用户后续授权“同步gihtub”，本次仅同步脱敏文档，不部署、不运行同步、不修改生产数据。
最后更新时间：2026-10-22（Asia/Shanghai）。

## 当前阶段
当前阶段：只读调查及脱敏文档GitHub同步均已完成；停止，等待用户审核修复方案。
当前子任务：无。脱敏文档已正常push github/main并核验SHA=9c5846c391759febf17548fd73221fcf5a4a8282；本同步补记另行文档提交，最终SHA见交付回复与Git记录。

## 已完成
- [x] 读取项目AGENTS、表单/任务Skill、任务台账、架构、安全、运行及集成文档；起始HEAD94591e90f0190a2b018d6588f46a8f264e13c616。
- [x] PostgreSQL只读事务、源系统SELECT、实际表/约束/索引/RLS/UUID引用及同步逻辑核验。
- [x] 完整影响报告、稳定UUID事务/审计/幂等方案、冲突/重算/入库匹配/归档冻结风险与回退方案。

## 正在进行
- [x] 仅脱敏报告和本进度已安全提交并正常推送；远端SHA已核验，完整ERP报告保持本地且哈希未变。

## 待完成
- 用户审核完整报告和归档历史计划的汇总处理边界；未经另行授权不实施修复。

## 修改文件
- 本次Git同步仅outputs/CODEX_PROGRESS.md、outputs/KDOS_PMC_ITEM_CODE_CORRECTION_AUDIT_PUBLIC.md。
- 完整报告outputs/KDOS_PMC_ITEM_CODE_CORRECTION_AUDIT.md仍在本机；含真实ERP数据，按AGENTS不入库，使用本地Git exclude防止误提交。

## 数据库 Migration
- 本轮无Migration；最小后续方案复用来源别名、审计和幂等结构，无需结构Migration。

## 新增或修改测试
- 无业务代码修改或写入测试；仅只读查询、文档及敏感内容核验。

## 已运行测试
- 生产只读来源/唯一冲突/归档资格/入库分摊模拟及报告UUID、计数和Markdown表格交叉核验完成。
- 业务源码保持原样；本次仅文档，无需重跑应用测试、构建或部署。提交前检查diff、敏感数据、文件白名单及完整版文件哈希。

## 当前已知问题
- 既有来源身份须保留，必要绑定须经审核；归档冻结不能擅自解除，已暂停投影不能为改品号重启。
- 入库日期存在独立适配口径问题，详见本机完整报告，不在本次编码调查中附带修复。

## 等待用户确认
- 等待完整报告与修复方案审核；Git同步授权不包含生产修复授权。

## 下一步
1. 同步补记正常提交推送，最终远端核验结果见本次交付回复；真实业务报告留在本机。
2. 已停止，等待用户审核，不实施生产写入、同步或部署。

## 恢复执行说明
项目规范→相关Skill→本文件→git status/diff。完整报告位于outputs/KDOS_PMC_ITEM_CODE_CORRECTION_AUDIT.md，本机受限证据位于data/pmc-item-code-correction-20261022；不得将两者真实数据提交Git。后续会话应读取本地完整报告继续，不重新调查已确认事实。

---

# Codex 工作进度

## 任务
任务名称：KDOS-MPS-REVIEW-DUE-IMPORT-001 评审交期表Excel导入及标准导入模板。
任务目标：Skill独立KN-FORM-TEMPLATE-001、标准8列模板与显式原始6列来源模式、预览/整批确认/IMPORT历史/权限/幂等、缺口清单及隔离验收。
当前状态：WAITING_MANUAL_ACCEPTANCE（本地实现及隔离/Chrome验收完成；本地与隔离验收已完成；用户2026-10-22授权同步GitHub，生产部署仍待确认）。
最后更新时间：2026-10-22（Asia/Shanghai）。

## 当前阶段
当前阶段：GitHub同步已完成；整体仍等待人工验收及生产部署授权。
当前子任务：无。25任务文件功能提交ab58d26，普通无冲突合并保留9bb47b5；github/main已核验为ba1e7f4a219479adde9fc1d1ce4bc105e5442743。本次不部署，生产版本仍389557f。

## 已完成
- [x] GitHub同步子任务已完成：仅25任务文件、安全检查、普通无冲突合并、正常push及ls-remote核验；无force、无生产部署或数据写入。
- [x] 读取附件完整要求、AGENTS/架构/安全/表单Skill第10节及Skill Creator；实际HEAD389557f752a11c7b735d88ab847b3805823058a7，main且工作区clean。
- [x] 明确用户新授权：允许本地实现/隔离写入测试；禁止生产导入、调度、权限组/flags变动及直接部署；后续用户“同步github”仅授权代码提交与正常推送。

## 正在进行
- [x] Skill独立KN-FORM-TEMPLATE-001、Registry八列/说明/英文文件名；66注册资源静态覆盖缺口盘点（不改其他模块）。
- [x] 专用导入Application Command、复用workbook及mps_import_previews；显式STANDARD/SOURCE、六字段/身份映射/预览分类/IMPORT历史/整批审计收据及Toolbar模态流程。
- [x] API全量1184/既有跳过33、Web全量459、contracts32、最终PG/HTTP/Chrome59组；最终专用API45/Web导入4再次通过。

## 待完成
- [x] API/Web/contracts/隔离PostgreSQL+真实Chrome、精度/权限/映射/幂等/回滚/原新增编辑导出及最终递归typecheck/lint/build；lint0错误、1既有警告。
- [x] 文档、缺口清单、发布步骤及WAITING_MANUAL_ACCEPTANCE报告；生产只读0/0、9保护表/6flags/8视图一致，临时Vite/PG/卷/socket清理。本次仅同步GitHub，不部署。

## 修改文件
- 25任务文件：Skill；contracts两文件；API专用导入服务/测试、既有模板/Controller/Module/元数据/权限/通用导入保护及来源守卫/测试；Web页面与导入组件/测试；隔离主脚本及导入检查；设计/进度/验收/缺口报告和integration-guide。详见验收报告与git status/diff。

## 数据库Migration
- 无需新增；复用现有103项迁移的预览台账、来源身份/历史约束、RLS，不改历史migration或生产结构。

## 新增或修改测试
- API导入边界5项、Web导入4项、原权限回归及PG/HTTP/Chrome扩展至59组。所有业务写入仅隔离PostgreSQL，生产只读。

## 已运行测试
- API全量1184通过/33既有跳过、contracts32、Web全量459，最终专用API45/Web导入4再次通过、最终隔离PG/HTTP/Chrome59组、递归typecheck/lint/build通过。Skill quick_validate及git diff --check通过。已修正并发测试顺序假设、DATE时区断言、加密fixture、构造器fixture、Modal动画定位及regex lint。
- 真实业务修正：DATE按PG文本参与范围/审计，避免UTC序列化误判；来源模式对人工/标准模板创建记录要求来源身份核实。

## 当前已知问题
- 无；原始来源匹配模式明确选择，保留人工改后业务键，不按Excel行号匹配。

## 等待用户确认
- GitHub同步已获明确授权；仍等待用户人工验收和生产发布确认，禁止自动上线。

## 下一步
1. GitHub同步已完成，远端SHA验证一致；本同步补记随文档提交正常推送，最终SHA见交付回复和Git记录。
2. 等待用户人工验收与部署授权；如获确认按验收报告发布步骤执行。
3. 不得确认生产导入、启动调度或导入1139条；仍为WAITING_MANUAL_ACCEPTANCE。

## 恢复执行说明
规范→Skill→本文件→git status/diff继续，不重写前期新增/编辑。证据data/mps-review-due-import-20261022。本轮不导入1139条、不开同步、不改6flags/生产权限/旧业务记录，不部署；仅在已获授权范围内同步GitHub，有Git冲突立即停止。

---

# Codex 工作进度

## 任务
任务名称：KDOS-MPS-REVIEW-DUE-CREATE-001 评审交期表专用手工新增。
任务目标：同一标准工具栏新增及六字段表单、专用manualCreate与POST、字段/租户/创建范围/幂等/审计、隔离测试及生产零记录部署。
当前状态：WAITING_MANUAL_ACCEPTANCE（功能、测试和生产Chrome完成，等待用户人工验收；不自动判PASS）。
最后更新时间：2026-10-22（Asia/Shanghai）。

## 当前阶段
当前阶段：功能提交4036ff046093b271827a8cf103a1bed94176dc92已上线且Chrome/保护核验通过，收尾文档与最终发布闭环。
当前子任务：仅补齐本报告及验收记录，按标准脚本保持最终Repository=Web=API=GitHub main；最终完整SHA见交付回复。

## 已完成
- [x] 读取AGENTS、最新表单Skill、任务调度Skill/台账、原进度及现有代码测试；实际起始HEAD d6d736988f0c7eeb7334bc221b8a0fb5f06b645b，工作区clean。
- [x] UUIDv7/初始来源键/计数0/历史保护已由现有结构支持，预计无需迁移；生产权限组不改。

## 正在进行
- [x] 开发前084434两库/uploads备份、SHA/格式检查完成；生产0/0、9项权限/PMC映射、6flags、8视图保护基线保存。
- [x] 专用manualCreate/POST、元数据独立创建能力（create:false保留）、六字段Modal、同步ref防重与失败重试收据、初始来源键及MANUAL审计/NULL同步时间实现。
- [x] API聚焦40项、Web创建5项及原编辑/页面11项通过；隔离PG/HTTP41组通过，含权限/范围/租户/Decimal/回滚/幂等/历史/Excel及来源人工确认。

## 待完成
- [x] API/Web/contracts/隔离PG+HTTP+真实Chrome、原编辑/历史/Excel回归及递归lint/typecheck/build通过；既有lint警告1/错误0。
- [x] 发布前090128两库/uploads备份，SHA/恢复目录/压缩格式/600权限通过；隔离测试容器、数据库及临时socket清理。
- [x] 21任务文件功能提交4036ff0，标准deploy all/check一致；线上Chrome创建草稿取消、权限操作及六字段/四字段、筛选/导出/编辑模式/旧页面通过；生产0写入、主表/历史0/0及9权限映射/6flags/8视图保护一致。
- [x] 收尾仅提交报告，正常push github/main并复核最终版本；最终证据data/mps-review-due-create-20261022，完整SHA见交付回复。
- [x] 报告outputs/KDOS_MPS_REVIEW_DUE_CREATE_ACCEPTANCE.md；最终WAITING_MANUAL_ACCEPTANCE。

## 修改文件
- 21任务文件：contracts定义/导出/测试；API专用manualCreate/Controller/创建能力/权限/校验及测试；Web Modal/Toolbar及新增/编辑测试；隔离PG+HTTP+Chrome脚本；integration-guide、设计文档、本进度及验收报告。详细列表见验收报告和git show --stat 4036ff0。

## 数据库 Migration
- 无需新增；生产103号ledger/来源触发器/两表FORCE RLS/5保护触发器核对，不修改历史migration。

## 新增或修改测试
- API create14项及原权限回归、contracts32项、Web创建5项与原编辑竞态定位、隔离PG/HTTP/Chrome扩展至43组；所有实际写入测试仅隔离PostgreSQL。

## 已运行测试
- API全量1179通过/33跳过；contracts32通过；Web新增5通过，原编辑5/页面6通过；隔离PG+HTTP+Chrome43组通过；Web全量454通过、1项旧编辑DOM竞态已修正测试并重跑该组5项全通过，全部455项完成验证。API构建/Web typecheck通过。
- 测试定位修正：AntD中文按钮空格、必填标记、旧编辑测试异步DOM被刷新替换（waitFor内重新查询）；停用用户fixture补齐display_name。均不通过改业务代码规避问题。

## 当前已知问题
- 无。参考HEAD 3c46692后仅文档同步d6d7369，当前代码基线与生产功能1b728c4一致。

## 等待用户确认
- 用户人工验收；本轮不导入1139条、不启动每日同步、不改6flags/生产授权组。

## 下一步
1. 等待用户人工验收。
2. 完成后停止，不自行进入Excel导入、来源身份确认或每日同步。

## 恢复执行说明
规范→Skill→本文件→git status/diff，继续现有实现，不重做前两期。禁止生产演示/回滚写入、导入1139条、ERP/每日同步、改6flags/生产授权/旧业务表。证据data/mps-review-due-create-20261022，最终状态WAITING_MANUAL_ACCEPTANCE。

---

# Codex 工作进度

## GitHub 文档同步（2026-10-22，Asia/Shanghai）

- 状态：已完成同步内容审核；本次提交汇总此前8份进度/验收报告的上线、测试及GitHub结果补记。
- 远端新增Skill提交3c46692已正常fast-forward拉取，无冲突；未覆盖本地报告。
- 本次为文档同步，不修改业务源码、数据库、授权组或调度；生产功能发布版本仍为1b728c452e157e7048ef9c134bd3e6cf6fafe5b7。
- 下文各任务的四方版本一致性及“本机补记未提交”为各次发布时点记录；此前保留的补记由本次文档提交统一入库。最新Git提交以git log -1及GitHub main为准，文档提交不表示重新发布应用。
- 文档验证：逐份diff核对、git diff --check及敏感内容检查；没有新增源码变动，无需重跑应用测试或部署。仅同步文档，不代表PMC任务已经人工验收。

## 任务
任务名称：KDOS-MPS-REVIEW-DUE-EDIT-001 评审交期表开放6个业务字段人工编辑。
任务目标：专用ID定位人工编辑、字段/资源/范围权限、版本/锁/幂等/审计、原始来源身份保留、新前向迁移、隔离测试及正式空表上线。
当前状态：WAITING_MANUAL_ACCEPTANCE（开发、测试、备份、迁移、部署、真实Chrome与GitHub同步已完成；等待人工验收，不自动判PASS）。
最后更新时间：2026-10-21（Asia/Shanghai），发布与GitHub同步完成。

## 当前阶段
当前阶段：交付完成，等待用户人工验收。
当前子任务：无。Repository=Web=API=GitHub main=1b728c452e157e7048ef9c134bd3e6cf6fafe5b7；STATUS=CONSISTENT，生产0/0。

## 已完成
- [x] 用户新规则、项目规范、表单/任务Skill、原进度及Git状态核对；起始SHA a86b321e7df27cb78f5a14b6c74e37ec3402c4cf。
- [x] 原7份outputs未提交运行补记保留；仅提交本任务文件/新进度段。
- [x] 方案：初始来源三字段独立不可变，当前业务键允许专用人工命令修改；未来observe按来源键找原ID，未知来源需人工核实，不自动创建。

## 正在进行
- [x] 开发前两库/uploads备份、SHA/格式验证完成；生产0/0、6flags、9项权限/PMC映射表及8财务视图只读基线已保存。
- [x] 新迁移/稳定来源三字段、专用ID人工命令、字段及范围/锁/版本/幂等/审计、Kdos编辑模式与精确文本单元格已实现。
- [x] API聚焦26、Web聚焦12、contracts31、隔离PG29组通过。真实HTTP拒绝通用写入路径通过；Chrome六字段/精度/改期/历史/409刷新重试已通过（PG+HTTP+Chrome及非空旧结构升级共32组）。

## 待完成
- [x] API/Web/contracts/隔离PostgreSQL/Chrome、lint/typecheck/build通过。
- [x] 发布前222458两库/uploads备份、唯一前向迁移103、标准all/check、生产Chrome/0行/保护复核通过。
- [x] 仅19任务文件安全commit、正常push github/main并ls-remote核实；最终WAITING_MANUAL_ACCEPTANCE，不导入/同步。

## 修改文件
- contracts注册/测试、API前向迁移及专用人工命令/读模型/权限/通用PATCH封闭及测试、Web编辑及权限测试、隔离PG+HTTP+Chrome脚本和3份文档；共19文件。

## 数据库 Migration
- 已执行1722920104000-MpsReviewDueDateManualEdit.ts，累计103；只增加3来源字段/唯一/初始化触发器及替换本表更新守卫，5保护触发器/2表FORCE RLS/0行验证通过；不改旧migration。

## 新增或修改测试
- 新API manual.spec、原domain权限回归、contracts六字段/四字段注册、Web编辑5项/权限页1项、PG脚本扩展非空旧结构升级/事务/权限/幂等/HTTP/真实Chrome；所有实际写入测试仅隔离PG。

## 已运行测试
- API全套1165通过/33skip（119套）；Web聚焦12通过，contracts31通过，隔离PG+HTTP+Chrome及非空升级32组通过；API/Web构建、API/Web typecheck、API/Web lint通过（仅原ModulePortal快刷warning）。
- Web全量450项均已有通过证据：447直接通过，3个超时用例分批复验；其中连续6次导出单项CLI 15秒预算7.76秒通过（不改全局配置/断言），详见验收报告。

## 当前已知问题
- 非空旧结构升级的延迟触发器/ALTER顺序问题已修复，隔离升级通过；生产迁移及结构复核已成功，仍0/0。
- 既有六次导出测试需较长单项执行预算，已用CLI 15秒复验通过；未修改测试文件/全局配置。

## 等待用户确认
- 等待用户人工验收；本轮实现/发布工作已完成。

## 下一步
1. 无未完成开发/部署事项；用户人工验收，不进入首次导入或每日同步。
2. 最终报告outputs/KDOS_MPS_REVIEW_DUE_EDIT_ACCEPTANCE.md；起始a86b321，最终1b728c452e157e7048ef9c134bd3e6cf6fafe5b7，GitHub main正常推送且四方一致。
3. 仅本机outputs最终运行补记与原7份报告差异保留，源码clean/无staged；隔离PG容器/卷/socket及Vite已清理，受限证据与备份保留。

## 恢复执行说明
本任务已交付WAITING_MANUAL_ACCEPTANCE。按规范→Skill→本进度→git status/diff恢复；不重复开发/迁移/部署。禁止重新实现既有第一期。仅本任务必要结构DDL；不插生产演示/回滚测试数据、不导入1139条、不触发ERP/Excel/新任务、不改6flags或生产授权组。证据data/mps-review-due-edit-20261021。

---

# Codex 工作进度

## 任务
任务名称：财务客户对应表手动新增。
任务目标：顶部新增按钮/三字段弹窗、独立手工创建API/权限/范围/唯一键/审计、前向MANUAL来源迁移、同步分类保护、API/Web/隔离PG/Excel/Chrome/正式部署和安全GitHub同步。
当前状态：已完成。Repository/Web/API/GitHub main=a86b321e7df27cb78f5a14b6c74e37ec3402c4cf，生产Chrome、健康/一致性、迁移及安全推送通过。
最后更新时间：2026-10-21 19:03（Asia/Shanghai）。

## 当前阶段
当前阶段：已完成，保留最终运行记录。
当前子任务：无。客户手动新增已上线；生产147客户/0演示新增，PMC/8视图/6flags/同步Timer/n8n不变。

## 已完成
- [x] 规范、架构、安全、两项Skill、任务台账及现有财务代码/权限/同步检查。
- [x] 起始HEAD 4bfced6c7ff51b67b30adc539d8c37d3aa4fde46；六份前任务outputs改动完整保留，后续只提交本任务及新进度段。
- [x] 实测财务客户同步Timer enabled/active，每日01:00 Asia/Shanghai，最近01:00成功；不改调度。

## 正在进行
- [x] 145417开发前两库/uploads备份/格式/SHA/600完成，正式客户147/run10/PMC映射3及接收5、8视图/6flags基线完成。

## 待完成
- [x] 新前向migration只扩展finance_customer_mappings.source CHECK为INITIAL_IMPORT/E10_SYNC/MANUAL；不改sync_runs来源或旧migration。
- [x] 独立POST /finance/customer-mappings/manual，trim/字典/服务端身份/租户/创建字段与范围/唯一键和事务审计。
- [x] 新增弹窗、持久错误/重复返回列表、成功刷新表格/总数；沿用字典与原分类修改。
- [x] API/Web/隔离PG及Excel回归；生产Chrome无持久测试客户，新增成功路径在隔离环境验证。
- [x] 183232发布前备份、唯一新迁移、标准all/check/最终Chrome及安全commit/push完成；无额外验证worktree，隔离运行环境已清理。

## 修改文件
- finance应用/权限/controller、FinanceCustomerMappings及测试、共享finance契约、App/Portal仅填报入口及测试、新migration、隔离PG/HTTP/Chrome测试、客户同步README/任务台账/验收报告。

## 数据库 Migration
- 已执行1722920103000-FinanceCustomerManualSource.ts；只映射表source CHECK扩展MANUAL并验证，102迁移已应用；不改历史migration或旧记录。

## 新增或修改测试
- API finance-manual.spec、Web创建/错误/权限/刷新/Portal填报回归；scripts/test-finance-customer-manual-postgres.cjs含受保护隔离数据库及真实Chrome。

## 已运行测试
- API118套/1153项通过/33skip；Web59文件/444项、contracts31；PG/HTTP10组+真实Chrome第11组通过；构建/lint/typecheck通过。

## 当前已知问题
- 183232发布备份成功；首次DDL被5条旧财务SELECT阻塞4小时以上，已取消自身迁移并验证回滚；核实只读后仅取消这5条旧查询，再用PGOPTIONS lock_timeout=5s/statement_timeout=30s重试唯一迁移成功，不终止写事务、不改金额SQL。原发生额慢查询性能需单独处理。
- 客户导出原范围缺交集已修复，OUTSIDE-READ反例旧7行/修复6行（含表头）；空填纠错提交已修复并在最终生产Chrome验证。
- 客户编号是只读身份字段，仅新增时填写；沿用平台创建字段策略（可见字段可填写、无查看的ADD_ONLY仅允许NONE填报范围）。字段隐藏不允许伪造写入。
- 财务无组织事实，不猜PMC/事业部ID；未知CUSTOM条件整组拒绝。

## 等待用户确认
- 无；本任务已交付。

## 下一步
1. 无未完成开发或部署。最终报告outputs/FINANCE_CUSTOMER_MANUAL_ACCEPTANCE.md。
2. 正式SHA a86b321e7df27cb78f5a14b6c74e37ec3402c4cf，GitHub main/Repository/Web/API一致，STATUS=CONSISTENT。
3. 不重复迁移或同步补跑；仅旧发生额慢查询性能如需另行处理，应开独立需求，不改本次已验收金额口径。

## 恢复执行说明
本任务已完成。规范→Skill→本文件→git status/diff；只保留本机outputs最终补记及前任务差异，源码clean，无staged；不重做新增/迁移/部署；受限证据data/finance-customer-manual-20261021。不要重做此前PMC评审或财务附件任务，不覆盖其outputs改动，不改PMC/金额/调度，不向真实接收人发测试消息。

---

# Codex 工作进度

## 任务
任务名称：KDOS-MPS-REVIEW-DUE-001 PMC评审交期表第一期建设。
任务目标：新建空白正式表/历史、只读页面/独立权限/筛选/稳定排序/完整导出、未来变更领域及Application隔离测试；正式部署后WAITING_MANUAL_ACCEPTANCE。
当前状态：WAITING_MANUAL_ACCEPTANCE（第一期开发、测试、备份、前向迁移、正式部署/Chrome及GitHub同步已完成，等待人工验收，不自动判PASS）。
最后更新时间：2026-10-21 19:08（Asia/Shanghai）；重复附件恢复检查完成。

## 当前阶段
当前阶段：第一期交付完成，等待人工验收。
当前子任务：无。原第一期发布4bfced6；19:08复核当前Repository=Web=API=GitHub main=a86b321e7df27cb78f5a14b6c74e37ec3402c4cf（包含后续财务客户功能），STATUS=CONSISTENT；两正式表0/0，6flags不变。本次只读复核，不改调度。

## 已完成
- [x] 附件需求/工程规范/架构/安全/两项Skill/任务台账已阅读；起始HEAD d80a768677c05b2e3b671362461c0718dbdaad74。
- [x] 现有5份outputs改动保留（含前任务进度/报告补记），禁止覆盖或提交其他任务记录。
- [x] 已向用户说明实施文件边界及新增前向migration方案，无需再次确认已授权开发部署。

## 正在进行
- [x] 134630开发前两库/uploads备份及SHA/格式校验完成，data/mps-review-due-20261021/backup.log。
- [x] 生产两新表不存在；14项业务表指纹与6项flags已保存。flags实际5启用/1停用（plan-projections=false），本任务保持，不新增任何调度。

## 待完成
- [x] contracts资源10字段/只读操作、两表migration/唯一FK/索引/RLS/不可变历史和计数一致性。
- [x] 领域+事务Application内部命令/来源批次幂等、纯重复业务键校验（无同步入口）。
- [x] 查询/历史Drawer/导航/服务端导出同scope与过滤排序，未知组织CUSTOM拒绝。
- [x] 领域/事务/权限/精度/并发/回滚隔离PG19组通过，含旧事务等待时间戳、数据库不可改名/无历史改期守卫、历史不可改删/计数与日期一致性；18至27从未在生产执行。
- [x] Web最终59文件439项通过，无未处理异常；未改全局测试配置或降低断言。
- [x] clean生产真实Chrome空表/10列/导航/搜索排序/日期范围/空Excel及普通账号4接口403，原集团主计划页面通过，写入0。
- [x] 143301发布前备份/唯一前向迁移、最终标准all/check/健康/Chrome、保护基线和安全commit/push完成。
- [x] 设计/验收报告完成，最终WAITING_MANUAL_ACCEPTANCE，不自动PASS；临时验证worktree/隔离PG已清理，证据/备份保留。
- [x] 19:08新附件SHA256与原任务附件一致；复用既有实现，只读核验迁移存在、两表FORCE RLS/0行/6flags，当前a86b321实际Chrome十列/导航/搜索排序/日期筛选/十列空Excel/普通账号四接口403/原集团计划页面通过。未重新迁移、导入或触发同步；仍WAITING_MANUAL_ACCEPTANCE。

## 修改文件
- 已实现contracts/index.ts+独立review-due-date契约，MPS config/types/module/query/filter-source/spreadsheet/controller最小适配、独立domain/application/query及页面、通用导出可选filename、App入口、前向1722920102000迁移和测试/文档。

## 数据库 Migration
- 已执行1722920102000-MpsReviewDueDates.ts，仅两新表及自身约束/索引/RLS/触发器；结构/类型/唯一键/FK/默认/两表FORCE RLS正式核验通过。
- 不改历史migration，不创建数据库，不写任何既有业务表或sync flags。生产新表/历史必须0。

## 新增或修改测试
- review-due-date.domain.spec.ts（14项）、contracts/review-due-dates.spec.ts（2项通过）、scripts/test-review-due-dates-postgres.cjs（19组通过）。
- 页面6项、精确筛选2项及原页面回归完成；HR teardown和监督异步断言仅修复测试稳定性，不改其业务代码。

## 已运行测试
- API全量1135通过/33skip；Web全量439通过；contracts31通过；PG19组通过；API构建/lint、Web typecheck/lint通过（保留既有ModulePortal快刷warning）。证据data/mps-review-due-20261021。

## 当前已知问题
- 无业务阻塞；主表无组织事实，不猜division；已整组拒绝无法验证CUSTOM。开发期间3条真实Web报工及3次EVENT execution-rollup（3175→3178、工序19392行派生变化）；发布备份窗口14:35既有finished-goods-inbound-v1服务完成13条T+入库投影（90392→90405），journal精确匹配records13，其他13表短窗口不变。全开发时段另有14:05入库19条、14:44既有erp-orders SCHEDULED成功72条T+更新，4项表内容变化/10项完全不变。6flags不变。全部为既有正常运行，本任务无旧业务写入。
- 日期不能为空的正式记录使用ISO业务日期，变更天数按日历日差；数量任意精确numeric/Decimal，不引入浮点或自动合并。

## 等待用户确认
- 等待用户人工验收第一期；不开展第二阶段。

## 下一步
1. 无未完成开发/部署事项。用户人工验收页面；不自行导入1139条或启动同步。
2. 最终报告：outputs/KDOS_MPS_REVIEW_DUE_DATE_ACCEPTANCE.md；设计：outputs/KDOS_MPS_REVIEW_DUE_DATE_SPEC.md。
3. 最终SHA 4bfced6c7ff51b67b30adc539d8c37d3aa4fde46，正常push github/main已核实。仅本机outputs运行补记及前任务差异保留，源码clean，无staged内容。

## 恢复执行说明
任务已交付WAITING_MANUAL_ACCEPTANCE。规范→Skill→本任务进度→git status/diff；不重复开发/迁移/部署，不进入第二阶段；附件位于/home/Jerry/.codex/attachments/bf4d8c95-060e-4aa4-b7d5-577c5f21c11c/已粘贴的文本.txt。勿恢复或重做上一财务附件任务，保留原outputs差异。禁止导入1139条、首次/每日同步、n8n、新业务数据演示或旧业务写入。

---

# Codex 工作进度

## 任务
任务名称：财务每日08:30推送当月Excel附件及指定文件名。
任务目标：原财务文字日报附加当月月度数据Excel，命名YYYY年M月接单统计-生管.xlsx；复用金额/导出/消息投递，保留PMC和原调度。
当前状态：已完成。正式API/Web/Dispatcher=GitHub main=d80a768677c05b2e3b671362461c0718dbdaad74，部署/健康/真实Chrome复验/推送均通过；无真实测试发送。
最后更新时间：2026-10-21 13:42:58（Asia/Shanghai）。

## 当前阶段
当前阶段：已完成，保留最终记录。
当前子任务：无。正式服务与HEAD/remote SHA一致，规则启用/版本8/config不变，IAM 2/2 ready，PMC/财务视图/outbox/n8n基线不变。

## 已完成
- [x] 规范/两项Skill/原进度/git恢复；保留前3份outputs差异，未覆盖用户配置。
- [x] 104210开发前备份、132547发布前两库/uploads备份及格式/SHA/权限校验；PMC/财务视图/outbox/n8n基线保存。
- [x] 财务独立附件服务，正式发生额视图+15字段统一导出，repeatable-read临时快照、接收人read∩export范围/字段权限、精确金额/稳定排序；无migration/第二套金额算法。
- [x] 冻结文件/SHA/实时权限指纹、租约私有下载、text/file:1独立重试、旧text配置兼容；Dispatcher仅追加财务中文名/路径，PMC专属代码不改。
- [x] API全套1119通过/33skip；最终聚焦144通过（11套），最终build/lint通过；财务隔离PG8、PMC隔离PG20、Python10通过。
- [x] 用户明确授权仅补齐涂思梦、陈小云权限；正式Application API独立CUSTOM组，仅2USER/read/export/15字段/原ALL范围，无写操作；原共享及其他组不变、审计验证，IAM2/2 ready。
- [x] 实际2人生产回滚预览，各436行15字段/金额一致、4个组成领取/0路由错误；回滚后outbox/attachments/log计数不增，不调用真实provider。
- [x] clean验证快照a59e06b7bbb48ad1adbaa9b48a457e5e0827632b已部署API/Web/既有Dispatcher，版本一致/服务健康。
- [x] 真实Chrome通过：涂思梦月度UI/网页导出；陈小云首次改密屏障保留，未改密码或绕过，后端导出/附件权限436行15字段金额一致。消息中心3类编辑页可打开，取消后启用/版本8/接收人/模板不变，内部无凭据401/无效租约403。
- [x] 16个n8n定义/启停/发布版本不变，11active；PMC/非财务规则/财务视图/outbox基线不变，新增任务/内部消费者/Timer/cron均0。
- [x] 安全commit仅19个任务文件，源码/测试14个逐字节与已验收发布相同，私有证据/备份/原3份outputs差异未提交。

## 正在进行
- [x] 正式deploy all及Dispatcher更新、标准health/check和最终Chrome通过。

## 待完成
- [x] GitHub main安全push成功，remote=Web=API=Dispatcher=HEAD=d80a768677c05b2e3b671362461c0718dbdaad74。
- [x] 最终规则/权限/PMC/n8n基线复核及最终报告完成；只清理本任务干净验证worktree，保留源/证据/备份/原3份outputs差异。

## 修改文件
- FinanceMonthlyFileService及.spec.ts、FinanceMonthlyNotificationService及.spec.ts、finance.module.ts。
- notification.service/types/internal.controller及新.spec/event.registry及.spec。
- Dispatcher.py/test_dispatcher.py、scripts/test-finance-monthly-file-postgres.cjs。
- docs/finance-monthly-notifications.md、integration-guide.md、operations/TASK_REGISTRY.md。
- outputs/CODEX_PROGRESS.md、FINANCE_MONTHLY_ATTACHMENT_ACCEPTANCE.md。

## 数据库 Migration
- 无；生产仅用户明确授权的2人权限通过正式API保存并有审计。所有通知预览写入回滚，不改源/金额/规则/同步水位。

## 新增或修改测试
- 文件月份/安全命名/权限指纹/旧text配置、内部UTF8下载/worker校验、日事件格式、Dispatcher中文名及隔离PG。

## 已运行测试
- API full1119 passed/33skip；focused144 passed；build/lint passed；PG8/PMC PG20/Python10 passed。
- 验证版和正式版health/check/Chrome passed，最终服务SHA及GitHub远程SHA一致。受限证据data/finance-monthly-attachment-20261021，禁止提交真实数据/凭据。

## 当前已知问题
- 陈小云账号仍需本人首次登录改密；不影响已验证的消息附件权限，不修改或跳过账号安全流程，不宣称其月度UI已通过。
- 08:30为流程启动，更新成功后发送；本次未真实发送测试，未来正式触发/企微实际送达待记录，不冒称已收到。
- 冻结旧附件在权限指纹变化后停止投递；权限修复以下一次正式日报重新生成为准，不重新构建历史冻结报表。

## 等待用户确认
- 无；用户已授权仅补齐2人的月度导出/15字段，且要求继续完成上线。

## 下一步
- 无未完成开发或上线事项。下一次正式自动执行2026-10-22 08:30（上海时间），先增量成功再按已有规则推送；未来实际送达待运行记录，不冒称已实发。
- 完整本机报告：outputs/FINANCE_MONTHLY_ATTACHMENT_ACCEPTANCE.md。若用户反馈首次送达问题，先查既有n8n/消息中心日志，不重复FULL或自动补发到真实员工。

## 恢复执行说明
任务已完成。HEAD/GitHub main/正式Web/API/Dispatcher均为d80a768677c05b2e3b671362461c0718dbdaad74。仅outputs最终运行/SHA补记及原3份outputs差异保留，源码clean，无staged内容。勿重新实现/再次授权/全量同步/真实测试投递。若未来另有需求从新任务开始，不覆盖本次记录。

---

# Codex 工作进度

## 任务
任务名称：财务每日一次增量更新与KDOS消息中心汇总推送编排。
任务目标：每天一次自动INCREMENTAL更新，成功后由内置消息中心按已配置对象推送当月汇总，不改金额算法或其他任务。
当前状态：已完成。
最后更新时间：2026-10-21 10:14:37（Asia/Shanghai）。

## 当前阶段
当前阶段：实际在线切换、受控执行、标准部署/健康及GitHub同步完成。
当前子任务：无；下一次正式定时为2026-10-22 08:30上海时间。

## 已完成
- [x] 规范/调度Skill、原进度、git状态恢复；保留前两个任务的outputs最终记录。
- [x] 095740两库/uploads格式/权限/SHA备份及n8n一致SQLite，原当前/已发布版本完整保留。
- [x] 新主机run-finance-daily.sh固定INCREMENTAL，日流程锁+子命令原锁，退出码/JSON SUCCESS双校验；更新失败不进入汇总。
- [x] 合成9项及shell语法通过，含错误短路、无效结果、防并发、update-only、固定增量、唯一08:30入口及n8n校验器。
- [x] 查实旧工作流草稿已删定时节点但已发布版本仍30分钟；通过官方在线API取消发布，旧3个手工节点/连接及版本完全保留。
- [x] FIN-004保持ID并改名“KDOS 财务每日增量更新及月度汇总”，已发布版本=当前版本，30 8 * * *、Asia/Shanghai，SSH执行新日流程；正式命令不含--update-only。
- [x] n8n1240实际受控执行SUCCESS/INCREMENTAL，验证模式UPDATE_ONLY_NO_NOTIFICATION、入队0；数据库成功批次已查证；不运行FULL、不发送测试消息。
- [x] 用户已启用的财务规则版本7/1个接收对象及全部通知规则字节语义相同；不改PMC、金额、接收人、模板或权限。
- [x] 16工作流/11active、财务自动2→1；其他14个工作流定义/启停/发布版本逐项不变；新增调度定义/候选0，systemd/cron/常驻/应用调度修改0。
- [x] 在线切换不重启n8n；无关运行任务1236保持运行，10:07旧窗口及之后未再触发旧增量。
- [x] 仅8个任务文件安全commit/push；标准部署、healthcheck、版本一致；Web=API=HEAD=GitHub main=eb4fb76b76f2551858da4d09818eb28bdac81f4b。

## 正在进行
- 无。

## 待完成
- 无开发事项。未来首次自动执行尚未到时，不冒称已观察定时触发或企业微信送达。

## 修改文件
- data-operations/e10/run-finance-daily.sh
- automation/finance_monthly_summary/workflow.template.json
- scripts/test-finance-daily.py
- docs/finance-monthly-notifications.md
- docs/finance-order-movements.md
- docs/operations/TASK_REGISTRY.md
- outputs/CODEX_PROGRESS.md
- outputs/FINANCE_DAILY_ORCHESTRATION_ACCEPTANCE.md
- 本机outputs最终结果补记；原两份前任务验收记录修改保留，未归入本次提交。

## 数据库 Migration
- 无。只经原Application Commands做一次真实INCREMENTAL验证；源/金额算法和审计保留。

## 新增或修改测试
- Python合成shell/工作流9项，包含无外发验证；实际n8n/批次/已发布版本/其他工作流和规则核对。

## 已运行测试
测试名称：合成9项、bash -n、n8n1240、当前/发布版本/其他14个工作流、全部通知规则、10:07旧入口未触发、healthcheck及版本。
结果：全部通过。应用源码未修改，标准API/Web构建通过；未重复无关完整套件。

## 当前已知问题
- 无阻塞、金额/权限/调度或Git冲突。当天此前已运行的旧增量历史保留；“每日一次”是切换后的自动频率，失败重试/明确手工补跑是例外。
- 日流程08:30启动，企业微信消息在更新成功后生成，可能稍晚于08:30；未来送达由消息中心日志核对。

## 等待用户确认
- 无；沿用用户已经保存并启用的接收人。

## 下一步
1. 已完成，无需新建工作流或重复更新/测试投递。
2. 如需显式补跑，SSH调用bash /data/automation/code/work/PMC/knweb/data-operations/e10/run-finance-daily.sh；仅验证更新才加--update-only。
3. 未来运行或回滚先读任务台账，保持一个财务自动入口；不把已有成功数据回滚覆盖。

## 恢复执行说明
规范/调度Skill→本节→git status/diff；本任务已发布并push github/main eb4fb76b76f2551858da4d09818eb28bdac81f4b。最终报告outputs/FINANCE_DAILY_ORCHESTRATION_ACCEPTANCE.md；私有备份/证据data/finance-daily-orchestration-20261021。勿恢复旧每30分钟入口，勿重复执行真实测试推送。

---

# Codex 工作进度

## 任务
任务名称：消息中心财务规则启停与接收人编辑修复。
任务目标：修复finance.monthly.daily_summary编辑、回显、启停、配置保留、版本冲突和有效成员校验；保留PMC通知、财务口径及08:30调度。
当前状态：已完成。
最后更新时间：2026-10-21 09:47:32（Asia/Shanghai）。

## 当前阶段
当前阶段：正式部署、Chrome验收、安全commit/push和GitHub远程核对完成。
当前子任务：无。财务规则由用户自行选择接收人后启用。

## 已完成
- [x] 最新生产7c3176b基线与只读根因核对；092513两库/uploads备份、格式/600权限/SHA校验。
- [x] 修正员工候选enabled遗漏及员工租户约束；固定接收人解析限定租户，不修改PMC动态路径。
- [x] 编辑读取最新详情并重新挂载Form，混选/取消/回显、名单名称、保存缓存/版本刷新、403/409及重试入口。
- [x] 停用草稿可空接收人；启用至少有当前租户启用且有企业微信ID的成员；缺ID对象可编辑/保存并逐人跳过；只读预览不入队/不发送。
- [x] 单独状态PATCH只写enabled、审计与版本，不重写任何config/模板；无效历史对象不阻止停用。
- [x] API全量1107/33既有skip，最终相关130；Web全量57文件431及最终消息6；PG消息13/PMC20；Chrome合成2；typecheck/lint/build通过。
- [x] 干净验证快照46eefb7与正式源码一致；生产Chrome8项真实目录对象/保存/页面刷新回显/取消/启停/配置保留/409通过。
- [x] 真实测试持有财务汇总当日/次日advisory锁，仅指定规则PATCH；财务通知队列始终0，未调用发送/重试。
- [x] 原财务规则恢复停用/空接收人/完整原config及模板，保留审计/版本1→5；PMC规则/接收人/供应商映射、财务视图、n8n16工作流12active定义摘要不变。
- [x] 正式healthcheck/deploy check与只读Chrome三类候选通过，Web=API=HEAD=GitHub main=ccfc5fb5533cdb6b276e1befea862e26d899734c。
- [x] 仅13个任务文件安全commit/push；未提交真实目录、财务数据、凭据或备份。临时PG/空socket/别名及验证worktree已清理。

## 正在进行
- 无。

## 待完成
- 无。

## 修改文件
- 正式提交13个文件：ccfc5fb5533cdb6b276e1befea862e26d899734c；完整文件清单见outputs/NOTIFICATION_RULES_REPAIR_ACCEPTANCE.md或git show --stat。
- 最终进度/验收版本信息在本机outputs补记；原FINANCE_ORDER_MONTHLY_ACCEPTANCE.md既有两行修改保留，未归入此次提交。

## 数据库 Migration
- 无；不修改结构、历史migration或财务原始数据。

## 新增或修改测试
- 状态专用更新、JSON配置保留、草稿/有效性、三类目标持久化与取消、缺微信ID、并发版本、系统/模块权限及跨租户。
- 实际隔离PG模拟claim独立skip，不调用provider；原PMC20项完整回归保留。

## 已运行测试
测试名称：API1107/相关130、Web431/最终6、PG13+20、Chrome合成2/生产8/正式只读三类候选、typecheck/lint/build、healthcheck/版本。
结果：通过；保留原Portal fast-refresh及bundle告警。首次最终只读Chrome稳定性等待超时，复核已确认真实编辑弹窗及全部目录候选正常，未新增业务写入；完整生产主流程8项使用正常点击通过。

## 当前已知问题
- 无未解决的业务故障、权限/安全/真实投递风险或Git冲突。
- 财务规则最终仍停用、无接收人；这是保留用户原配置，已验证配置有效对象后能启用，未擅自选择正式接收人或发送通知。

## 等待用户确认
- 无开发阻塞。用户在消息中心配置正式接收人后自行启用。

## 下一步
1. 本任务已完成，不重复实现、部署或触发真实测试发送。
2. 最终脱敏报告：outputs/NOTIFICATION_RULES_REPAIR_ACCEPTANCE.md；受限证据data/notification-rules-repair-20261021/。

## 恢复执行说明
规范/Skill→本节→git status/diff；源码已发布并push github/main ccfc5fb5533cdb6b276e1befea862e26d899734c。后续仅按新需求维护；不得改PMC接收人/映射/文本/Excel/发送路径、财务口径或08:30时间。

---

# Codex 工作进度

## 任务
任务名称：财务月度数据统一订单发生额明细与大屏口径升级。
任务目标：复用既有发生额，按完整来源订单×发生月份聚合；月度15列、月份日历、完整变更下钻、大屏/排名/Excel/日报一致，备份/迁移/上线/GitHub同步。
当前状态：已完成。
最后更新时间：2026-10-21 08:41:17（Asia/Shanghai）。

## 当前阶段
当前阶段：生产正式版本、真实Chrome/Excel验收及GitHub同步完成。
当前子任务：无。用户按既定选择在消息中心自行选择接收人并启用规则。

## 已完成
- [x] 复用finance_e10_movement_source，新增安全调用者视图finance_e10_order_monthly_movements；旧finance_e10_monthly保留内部有效余额，不重复累计/入账。
- [x] 开发前20261020_182800、发布前20261021_081548两库/uploads备份及格式/SHA校验完成。
- [x] 生产前向migration101，同一REPEATABLE READ事务逐完整来源订单/月五金额分量与既有流水一致，逐单全期间余额差异0；原始/事件/授权指纹和既有视图定义不变。
- [x] 月度15列、稳定日期升序、发生月份日历、精确来源键下钻、当前分类、Excel和大屏/排名/日报统一；材料/审核/冲突/重复/缺失/异常/指定结束规则保持，不手工触发同步。
- [x] 实际Chrome发现月历文本范围操作符不适用，已用monthFrom/monthTo可信上下文修正，后端月份/字段权限校验并在PG和Chrome回归。
- [x] API全量1101/最终相关174；Web全量427及最终相关22；Contracts29；隔离PG47/20/12；Chrome合成7通过；typecheck/lint/build通过。
- [x] 真实2025/2026全年度/月度/事业部/内外销/矩阵和全部客户排名金额一致；真实跨月订单/零变更月/正负变更展示、来源键下钻及15列实际Excel下载验证通过。
- [x] 指定订单按真实有效来源进入正确发生月份，无已确认变更；历史同号缺失/未审核来源继续排除，未绕过校验；明细仅受限本机报告。
- [x] 大屏实测约3.3–3.5秒；月度通用分页约6.1–6.6秒，沿用租户局部Hash并关闭本查询JIT，不修改全局DB设置或新增金额缓存。
- [x] n8n16工作流/12active所有定义摘要不变，本轮新增候选和自动入口0；FIN-004于2026-10-21 08:30实际定时1234 SUCCESS/trigger，因停用规则NO_ENABLED_RULE，未发送测试消息。
- [x] 用户接收人/模板/启停/版本未自动覆盖；日报只读预览与月度同快照金额和订单数一致。
- [x] 先干净隔离源码快照部署/浏览器验收，再正式安全commit，仅38个任务源码/测试/文档/脱敏记录；未提交真实财务数据、备份、凭据或业务图片。
- [x] 正式部署/healthcheck/deploy check及最终Chrome/月历/Excel通过；Repository=GitHub main=API=Web=7c3176b61c36486c51a6723895b10b2b92674a9a，CONSISTENT。
- [x] 两个临时验收源码worktree及隔离PG/空socket已清理；既有生产服务、增量任务和备份/受限证据保留。

## 正在进行
- 无。

## 待完成
- 无。

## 修改文件
- 本任务38个文件已commit/push github/main：7c3176b61c36486c51a6723895b10b2b92674a9a；完整清单可git show --stat查看。
- 最终进度/验收版本信息在outputs记录本地补记；源码及配置没有未提交修改。

## 数据库 Migration
- 已生产执行FinanceE10OrderMonthlyMovements1722920101000，只新增只读视图；不修改历史migration或源数据；回退应用保留该视图和财务历史。

## 新增或修改测试
- 完整来源订单×月份、同月新增及变更/净额零、跨月/年正负变化/指定结束、保留有效交期、稳定排序、当前分类、月历上下文、真实来源下钻、字段/数据/read∩export/强制RLS和Excel。

## 已运行测试
测试名称：API1101（另33跳过为既有测试）；Web427；Contracts29；PG47/20/12；Chrome合成7与真实业务7项、正式版Chrome/实际Excel；typecheck/lint/build/healthcheck/versions。
结果：通过。保留原知识库fast-refresh及bundle体积告警，无本轮新增lint错误；Web全量后月历修正另复验22个相关用例及Chrome7/API全量1101。

## 当前已知问题
- 无未解释的重复计额、金额差异、迁移风险或Git冲突。月度分页是实时派生聚合，实测耗时已记录，不承诺即时响应。
- 原有停用消息规则保留其旧自定义/默认存储模板；新默认模板/变量标签为本月接单发生额，用户配置收件人时可自行调整已有模板。未更改其版本/启停，也未声称实际企业微信已送达。

## 等待用户确认
- 无开发阻塞。收件人按用户既定安排自行选择并启用。

## 下一步
1. 本任务已完成；后续仅按用户新需求维护，勿重复迁移、全量同步或重入账。
2. 排障先读当前规范、本进度与受限最终报告；保持原业务校验、来源键和调度分工。
3. 最终报告：data/finance-order-monthly-20261020/ROOT_CAUSE_AND_ACCEPTANCE.md；脱敏测试报告：outputs/FINANCE_ORDER_MONTHLY_ACCEPTANCE.md。

## 恢复执行说明
本任务已完成。规范/Skill→本节→git status/diff；代码提交7c3176b61c36486c51a6723895b10b2b92674a9a与线上一致。真实财务数据/备份仅data受限路径，不上传Git；若新发生无法解释的计额/迁移或Git冲突，停止上线并报告。

---

# Codex 工作进度

## 任务
任务名称：财务月度真实数据误排除修复与消息中心每日汇总上线。
任务目标：修正完全来源缺失历史订单参与重复号判断的问题，保留源快照/其余校验；注册并部署每天08:30上海当月企业微信汇总，由用户自选收件人并启用。
当前状态：已完成。
最后更新时间：2026-10-20 18:23:56（Asia/Shanghai）。

## 当前阶段
当前阶段：正式生产迁移、部署、运行验收与GitHub同步全部完成。
当前子任务：无；收件人按用户要求在消息中心自行选择并启用。

## 已完成
- [x] 恢复只读调查证据并保护原进度；用户本轮授权实施，未重跑FULL或读取E10/T+。
- [x] migration100仅修正公共派生重复号计数；源品项/历史事件/客户映射/授权指纹不变，其余视图定义不变。
- [x] 生产REPEATABLE READ事务逐行结果与原数据加严格反事实恢复集完全一致，新增范围精确符合调查预期；真实数据仅受限本机留存。
- [x] API相关146、最终全量1100；隔离PG订单39、完整迁移/客户20、发生额12；Contracts29通过，typecheck/lint/build通过。
- [x] Web全量422：420首轮通过，两个既有多交互用例超过默认5秒；所在22项按15秒预算复验全部通过，未修改无关产品或测试。
- [x] 两库/uploads备份180156、归档和SHA校验完成；n8n一致备份完整性ok。
- [x] 财务事件registry、正确模块展示/筛选/管理隔离、默认模板及停用规则上线；初始化两次不覆盖已有配置。
- [x] 新FIN-004为唯一新增自动入口：n8n KDOSFinanceMonthlySummaryV1，30 8 * * *，Asia/Shanghai；新候选/启用均1，新增Timer/cron/常驻服务/应用定时器均0。
- [x] 原15工作流及11active配置逐项不变；现16工作流/12active；原Dispatcher保持运行。首次1198认证类型失败已修正，仅新节点复用原sshPassword，1199实跑成功且因停用规则入队0。
- [x] 真实只读汇总预览与同快照月度数量/金额一致；最终生产API/服务端Excel/Chrome月度搜索及消息中心配置4项PASS，无真实通知发送。
- [x] bd1b15a和2ae82d8两个任务提交安全push github/main；未提交真实财务资料、凭据、数据库或业务图片。
- [x] 最终deploy all/check、healthcheck通过；Repository=Web=API=2ae82d829ff24ab41b04349a15a71cce58c8f084，CONSISTENT；API/Web/Worker/PostgreSQL healthy。
- [x] 任务创建的隔离PG容器/空socket目录及临时n8n导入文件已清理；受限证据与恢复入口保留。

## 正在进行
- 无。

## 待完成
- 无。

## 修改文件
- apps/api/src/migrations/1722920100000-FinanceE10LiveOrderDuplicates.ts
- apps/api/src/modules/finance/finance-monthly-notification.service.spec.ts
- apps/api/src/modules/finance/finance-monthly-notification.service.ts
- apps/api/src/modules/finance/finance.module.ts
- apps/api/src/modules/notifications/notification-admin.service.spec.ts
- apps/api/src/modules/notifications/notification-admin.service.ts
- apps/api/src/modules/notifications/notification-event.registry.spec.ts
- apps/api/src/modules/notifications/notification-event.registry.ts
- apps/web/src/modules/notifications/NotificationCenterPage.spec.tsx
- apps/web/src/modules/notifications/NotificationCenterPage.tsx
- automation/finance_monthly_summary/workflow.template.json
- data-operations/e10/push-finance-monthly-summary.sh
- data-operations/e10/run-finance-monthly-summary.cjs
- docs/finance-monthly-notifications.md
- docs/operations/TASK_REGISTRY.md
- outputs/CODEX_PROGRESS.md
- outputs/FINANCE_ORDER_POSTGRES_VALIDATION.json
- outputs/FINANCE_POSTGRES_VALIDATION.json
- scripts/test-finance-orders-postgres.cjs
- scripts/test-finance-postgres.cjs

## 数据库 Migration
- FinanceE10LiveOrderDuplicates1722920100000已正式执行，TypeORM无pending；不改历史migration、不改源行、不补跑全量。

## 新增或修改测试
- 实际PG验证历史缺失同号、两个有效同号、部分缺失、跨租户/账套、原资格/指定结束、迁移幂等/回滚和下游金额/Excel一致。
- 汇总时区边界、精确金额、停用无入队、初始化不覆盖、同日并发/重放幂等、失败回滚、模块权限和前端财务筛选。

## 已运行测试
测试名称：API1100/33既有skip、PG39+20+12、Contracts29、Web422（420首轮+2超时复验）、typecheck/lint/build、实际生产4项、n8n1199、healthcheck和版本一致。
结果：通过；两个既有Web多交互用例复验使用15秒预算。真实发送未执行，符合用户选择。

## 当前已知问题
- 用户未选择收件人，规则按其要求保持停用/空对象/版本1；不将注册或停用路径验证冒称企业微信已送达。
- 尚未观察未来首次08:30定时触发；已证明active调度注册及手工执行成功。原Portal/Vite提示保留。

## 等待用户确认
- 无开发阻塞；用户下一步在消息中心编辑“财务月度数据每日汇总”、选择组织/角色/员工，保存并启用。

## 下一步
1. 本任务已完成，无自动后续开发或真实测试消息。
2. 最终报告：data/finance-monthly-repair-release-20261020/ACCEPTANCE.md（本机受限、Git忽略）。
3. 本地最终进度记录保留为outputs修改；产品/配置/台账已push github/main，远程SHA已核对为2ae82d829ff24ab41b04349a15a71cce58c8f084。

## 恢复执行说明
先项目规范/Skill→本节→git status/diff→受限验收；本任务已完成，不恢复旧只读阶段或重复迁移/初始化/同步。最终本机记录不含真实财务证据；收件人由用户自行配置，不自动启用或发送。

---

# Codex 工作进度

## 任务
任务名称：财务中心订单在系统导出存在、月度缺失的只读根因调查。
任务目标：真实订单复合键关联五个关系、生产视图过滤复现和同因影响统计；仅调查。
当前状态：已完成（只读调查完成，修复未实施）。
最后更新时间：2026-10-20 17:50:11（Asia/Shanghai）。

## 当前阶段
当前阶段：生产只读证据、逐条件模拟和同因影响统计完成。
当前子任务：无；等待用户确认后方可实施修复。

## 已完成
- [x] 既有任务均保留，不恢复旧开发；初始git工作区干净。
- [x] 明确禁止同步、代码/数据库变更、部署及commit/push。
- [x] 五关系按真实复合键查证；生产实际视图与三指定migration核对。
- [x] 发现完全缺失历史来源污染重复号判定；正常来源其余条件均通过。
- [x] 全量规则模拟与生产月度条数/金额一致、复合键双向差集0；同因影响严格反事实完成。
- [x] 最终报告与真实证据仅存受限Git忽略目录，不提交真实财务数据。

## 正在进行
- 无。

## 待完成
- 无；只读报告已完成。

## 修改文件
- outputs/CODEX_PROGRESS.md（仅本地调查记录）。

## 数据库 Migration
- 无。

## 新增或修改测试
- 无。

## 已运行测试
测试名称：生产READ ONLY/REPEATABLE READ证据查询、过滤模拟与反事实。
结果：通过；具体数据仅留受限报告。未运行修改型测试。

## 当前已知问题
- 已定位重复号判断误排除；本阶段按用户要求不修复。

## 等待用户确认
- 调查结束后等待修复方案确认，不自动实施。

## 下一步
1. 最终报告：data/finance-monthly-missing-20261020/ROOT_CAUSE_REPORT.md。
2. 证据：同目录evidence.json、history-evidence.json和queries.sql（本机受限、Git忽略）。
3. 等待用户确认最小修复，不自动进入开发/数据库变更/同步/部署/commit/push。

## 恢复执行说明
先项目规范与适用Skill→本节→git status/diff→受限只读证据；不重做已完成任务，不同步/修改生产、不commit/push。

---

# Codex 工作进度

## 任务
任务名称：财务销售订单统计四项业务修正。
任务目标：材料销售单/非Y审核排除；月度备注第10列；原始/月度日期稳定升序；统一有效金额和变更台账并保留性能。
当前状态：已完成。
最后更新时间：2026-10-20 14:55（Asia/Shanghai）。

## 当前阶段
当前阶段：正式部署、线上验收、健康检查及GitHub推送完成。
当前子任务：无。文档同步：四份记录已核对，财务新增记录脱敏、完整原件受限备份；仅文档/合成验证结果提交，不重新部署运行服务。

## 已完成
- [x] 基线HEAD/Web/API=6c9b227，保护所有既有outputs修改；阅读项目规则/两技能/任务台账。
- [x] 共享订单资格/迁移99/台账资格状态采集和投影；原始数据保留，不造冲回。
- [x] 原34列备注复用；月度末列增加为10列，保存列偏好一次补充且保持字段权限。
- [x] 原始/月度默认日期ASC+稳定唯一键；Excel同规则，显式排序保持，流水时间排序不变。
- [x] 全量API1090/Web421/Contracts29/Python8，隔离PG32+12、Chrome9、typecheck/lint/build通过。
- [x] 两库/uploads备份20261020_121019及归档/SHA验证，原代码/配置受限备份，标准SQL最终校验一致。
- [x] Migration99仅派生视图，发布同事务逐维度对账精确一致，原始/事件指纹不变。
- [x] FULL成功changedCount0；首次原定增量仅更新元数据、金额无变/新增0；后续半小时增量持续SUCCESS。
- [x] 同快照材料单、非Y审核及重叠条件去重后差额与预期精确一致；月度/排名/发生额一致。真实数量和金额仅留受限本机原件。
- [x] 原授权/角色/客户分类/6flags不变；原raw/orders_all/ranking视图定义保持。
- [x] Chrome发现年筛选月度计划47.904s，补修注册读取局部Hash，API31/PG32/typecheck/build/lint再通过，最终API3.227s。
- [x] 真实Chrome+实际Excel原34/备注16、月度10/备注10、100行稳定跨页与显式降序最终复验通过。
- [x] 同账号大屏首开3.257s/刷新3.580s/重入0.714s，年度/事业部/客户2.1–2.2s，每项各一次Dashboard/Ranking请求。
- [x] 最终实际API逐年度月度/大屏/完整排名金额与数据库一致，实际金额不入Git。
- [x] 正式deploy all/check/health全部通过，Repository=Web=API=d8456fbcdb4a3290200b5795cf02f3e917ab57ee，CONSISTENT。
- [x] 两次本任务提交f337ef6/d8456fb安全推送github/main成功，ls-remote验证最终SHA相同，无强推/分叉，无真实数据提交。

## 正在进行
- 无。

## 待完成
- 无。

## 修改文件
- `apps/api/src/common/filtering/table-filter.controller.ts`
- `apps/api/src/common/filtering/table-filter.registry.ts`
- `apps/api/src/common/printing/table-print.service.ts`
- `apps/api/src/migrations/1722920099000-FinanceE10BusinessEligibility.ts`
- `apps/api/src/modules/finance/finance-business-corrections.spec.ts`
- `apps/api/src/modules/finance/finance-movements.application.service.ts`
- `apps/api/src/modules/finance/finance-movements.calculator.ts`
- `apps/api/src/modules/finance/finance-movements.spec.ts`
- `apps/api/src/modules/finance/finance-order-eligibility.ts`
- `apps/api/src/modules/finance/finance-orders.query.service.ts`
- `apps/api/src/modules/finance/finance-orders.spec.ts`
- `apps/web/src/modules/finance/FinanceOrders.spec.tsx`
- `apps/web/src/modules/finance/FinanceOrders.tsx`
- `apps/web/src/modules/finance/finance-view-upgrade.spec.ts`
- `apps/web/src/shared/KdosDataTable.tsx`
- `data-operations/e10/finance_movement_reader.py`
- `docs/finance-dashboard-performance.md`
- `docs/finance-order-movements.md`
- `docs/operations/TASK_REGISTRY.md`
- `packages/contracts/src/finance-orders.ts`
- `scripts/test-finance-movements-postgres.cjs`
- `scripts/test-finance-orders-postgres.cjs`
- 本次将进度与验收文档脱敏后提交，合成验证结果与出货验收一并提交；完整本机原件已受限备份，旧已提交历史逐字保留。

## 数据库 Migration
- 1722920099000-FinanceE10BusinessEligibility，正式执行完成；仅KDOS派生视图，不修改E10源/标准SQL/历史事件数据。

## 新增或修改测试
- 有效订单资格/关闭状态/重叠排除/台账状态变化/租户和CUSTOM权限/字段可见性/原34月度10列/稳定排序分页/Excel/局部Hash执行器，均通过。

## 已运行测试
- API全量1090通过（33原有条件跳过）、最终相关31通过；Web421，Contracts29，Python8。
- 隔离PG订单32及台账12；Chrome9和真实生产读验；typecheck/lint/build与最终Docker构建均通过。

## 当前已知问题
- 大屏新资格聚合增加开销：首开2.519→3.257s、刷新2.623→3.580s，超过3秒目标，未虚报全部达标；保持原性能修复，月度慢查询47.904→3.227s。
- 原宽聚合仍有部分临时排序，未宣称全部消除；原Portal FastRefresh/Vite大包提示保留。
- 生产持续正常同步，不将不同时间快照差异冒称算法差异。少量留存旧状态无新资格字段仍按未知保留，不推测，当前统计用原始头字段；不做用户已取消的历史完整性审计。
- 无阻塞；保护所有其他未提交outputs，不自动改其他任务。

## 等待用户确认
- 无。

## 下一步
1. 本任务已完成，无后续自动开发。
2. 最终报告：outputs/FINANCE_BUSINESS_CORRECTIONS_ACCEPTANCE.md。
3. 受限证据：data/finance-business-corrections-20261020；本次四文件完整原件：data/document-sync-originals-20261020-170747（Git忽略，不上传财务数据）。

## 恢复执行说明
读取项目规范/适用SKILL/本文件，再git status/diff。当前任务已完成；如有新任务保护现有outputs，不重做已完成工作。

---

# Codex 工作进度

## 任务
任务名称：出货计划非必填字段与Excel记录身份解析修复。
任务目标：品项名称、下单日期、新旧款允许留空；Excel按真实列识别新增/更新，保留其他校验与权限。
当前状态：已完成。
最后更新时间：2026-10-20 11:01:44（Asia/Shanghai）。

## 当前阶段
正式部署、只读运行时核验、健康检查及GitHub推送完成。

## 已完成
- [x] 三字段统一可空、Excel实际表头定位及旧显示标题兼容修复，身份成对/缺列/无效版本校验保持。
- [x] 检查HEAD a979d3b及工作区，仅两份既有outputs修改，均保护。
- [x] 只读核实生产mps_shipping_plans：item_name/order_date/model_age均is_nullable=YES，无需migration。
- [x] 定位itemName必填配置及Excel隐藏字段定义旧列号导致错读的风险。

## 正在进行
- 无。

## 待完成
- [x] API1071、Web419、Contracts29、Chrome1通过；typecheck/lint/build通过。
- [x] 20261020_105241备份两库/uploads，校验归档及SHA256，私有保存。
- [x] 门禁与正式部署完成，全程未导入用户Excel、未写生产业务数据。
- [x] 仅本任务9文件提交6c9b2276e582b24e15107d4cc482703aedbf4662并推送github/main成功。
- [x] Repository=Web=API=6c9b227，CONSISTENT；healthcheck全通过，运行中三个字段required=false。

## 修改文件
- API config、共享spreadsheet parser及相关测试；新增shipping-optional.spec.ts；Contracts index.ts；Web页面测试与Chrome测试；docs/mps-shipping-optional-fields.md。
- outputs原有历史与财务验证JSON保持，不提交其他任务记录。

## 数据库 Migration
- 无需。三字段生产均允许NULL；本任务禁止生产业务数据写入。

## 新增或修改测试
- 已覆盖三字段空值、新增/修改/预览/确认、其他必填拒绝、删列/重排列/身份成对校验。

## 已运行测试
- 生产schema只读查询：三字段nullable=YES、默认值NULL，CHECK无额外必填约束。
- API全量1071通过/33原有跳过；相关4组119通过；Contracts29通过；typecheck/lint/build通过。
- Chrome（生产静态页+所有API拦截）1通过，不发送生产写请求；Web全量419通过。

## 当前已知问题
- 已修复隐藏定义错位；初次回归发现旧标题兼容需保留，已修复并119项通过。
- 原有Portal lint FastRefresh警告及Vite大包提示仍在，无新增代码错误。

## 等待用户确认
- 无。

## 下一步
1. 本任务完成，无后续自动开发。
2. 最终报告：outputs/MPS_SHIPPING_OPTIONAL_ACCEPTANCE.md。
3. 原有outputs未提交改动保留，不纳入本任务源码提交。

## 恢复执行说明
读取AGENTS/适用SKILL、本文件，检查git status/diff后继续未完成项。不得导入用户Excel或改生产业务数据。

---

# Codex 工作进度

## 任务
任务名称：KDOS财务中心销售订单统计大屏性能优化。
任务目标：保留最新订单金额变更功能/全部原口径/34列/9列/导出，实测优化查询/重复请求并测试、备份、部署和安全GitHub同步。
当前状态：已完成。
最后更新时间：2026-10-20 10:36:56（Asia/Shanghai）。

## 当前阶段
当前阶段：最终a979d3b生产验收、健康、版本一致和GitHub推送完成。
当前子任务：无。

## 已完成
- [x] 保护初始仅旧进度的修改；基线Repository/Web/API均dbe1f25。
- [x] 同账号真实Chrome基线首开18.92s、刷新18.32s、年度切换20.22s；原计划1.67亿无效配对，锁/池非主瓶颈、无临时磁盘排序。
- [x] 本Dashboard租户事务局部关闭Merge/Nested Loop，完整订单键Hash；所有视图/物理结构/索引/源SQL保持，无migration。
- [x] 排名count/rows共用一次聚合与同快照；公共表格首次实际偏好只请求一次；read/export范围交集，不复制公共表格实现。
- [x] 60s身份/授权/源版本缓存、15s轻量新鲜度、同账号授权变化清除旧范围占位、同步/分类后失效、显示刷新不触发ERP同步。
- [x] 最终Chrome：首开2.91s、刷新2.67s、重入0.70s，年度2.28s、事业部2.49s、客户2.08s。
- [x] 同一REPEATABLE READ快照旧SQL14.985s→新1.630s，全部原始大屏聚合和完整排名逐项一致，生产规模明细仅留受限本机证据。
- [x] 10:07原定n8n1180成功；受控同入口增量0变化实跑，页面自动发现新revision并更新，金额匹配原视图。
- [x] 原授权/客户映射/6flags/视图指纹保持；正常源采集新增单独审计对平，不冒称实时生产全期间值冻结；已入账台账事件无变动，未入账LOG源证据由原定增量更新。
- [x] 备份20261020_095923两库/uploads及SHA；部署all/check/health通过，Repository=Web=API=a979d3b26cef014b196695a485360045cbf86bdb，CONSISTENT。
- [x] 仅本任务10文件的3提交已安全push github/main，无强推或远程分叉。

## 正在进行
- 无。

## 待完成
- 无。

## 修改文件
- API Query/Controller/性能测试；Web FinanceOrders/客户分类/变更页的缓存失效及相关测试/E2E；隔离财务PG脚本；docs/finance-dashboard-performance.md，共10文件。
- outputs/CODEX_PROGRESS.md为主恢复入口，提交脱敏技术进度；完整原件与真实业务资料留受限本机备份。
- outputs/FINANCE_ORDER_POSTGRES_VALIDATION.json由隔离合成测试更新，随本次文档提交同步。
- data/finance-dashboard-performance-20261020/受限证据与验收报告，Git忽略。

## 数据库 Migration
- 无。无新表/索引/物化视图，不改E10标准SQL，原始业务与原派生视图定义保持。

## 新增或修改测试
- 单次排名/分页/排序/搜索/导出交集、局部参数、revision租户/授权与变更、缓存重入/身份/授权变更/刷新、Chrome只一请求。
- 真实增量及普通CUSTOM/跨租户/字段/导出、原关闭状态与最新变更台账回归。

## 已运行测试
- 最终API全套1048通过/33既有skip；Web全套417通过，最终相关11项再验；Contracts29。
- 原财务PG25、变更PG12，Chrome正式产物9、真实Chrome7性能/交互全部通过。
- typecheck/lint/build及最终Docker构建通过；Portal既有warning保留，0error。
- 年度/事业部/内外销/月份/待分类/矩阵/排名金额、同快照新旧原SQL、原34/9列和排名Excel、权限403/匿名401、变更统计勾稽、部署check/健康均通过。

## 当前已知问题
- 无未解决阻塞。本轮最终常用测量低于3s；中间版/并发负载见过3.2–3.5s，未承诺所有环境永久3s内。重入额外新鲜度检查有少量开销。
- 生产E10继续更新；正常新增金额与性能算法差异已分开，不将新采集数据说成优化修改历史金额。

## 等待用户确认
- 无。用户授权范围内全部完成。

## 下一步
1. 无开发遗留。正常运行保持现有FIN-003等任务，用户可按正式页面使用。
2. 完整报告：data/finance-dashboard-performance-20261020/ACCEPTANCE.md。

## 恢复执行说明
规范→本节→git status/diff→受限验收。当前任务已完成，不重做此前已完成的变更台账或取消的历史完整性调查；不提交真实财务证据/备份/凭据；技术进度于2026-10-20脱敏后同步。

---

# Codex 工作进度

## 任务
任务名称：KDOS财务订单金额跨月变更统计正式开发与上线。
任务目标：使用E10可确定历史事件建立幂等台账、月度/事业部/客户发生额及Excel，保留原34/9列和大屏及254指定结束规则，并持续增量。
当前状态：已完成。
最后更新时间：2026-10-19 18:02:55（Asia/Shanghai）。

## 当前阶段
当前阶段：正式部署、初始化、线上验收、GitHub同步完成。
当前子任务：无。用户取消历史完整性核验及展示；按确认的接单基数＋生效月变更、当前客户事业部分类口径执行。

## 已完成
- [x] 规范/Skills/进度/Git恢复；未覆盖旧修改或重做历史审计。
- [x] 台账/事实/不可变快照/运行水位/审计及四资源，统一分页筛选导出和后端权限/RLS。
- [x] 两次双库/uploads备份171705/175406与n8n一致备份，97/98迁移执行，旧财务视图/授权/客户映射/6flags指纹不变。
- [x] FULL初始化完成；可确定事件入账，全期间及逐单金额对平，正常结束订单保留；其余证据不猜测入账，真实条数和金额留受限原件。
- [x] 真实增量复读事件与版本不变，n8n实跑成功，每小时07/37已启用；原工作流配置保持，新任务仅一个自动入口。
- [x] 线上API四表、Excel四类金额/条数及401/403、Chrome12项和原34/9列/大屏验证通过。
- [x] 新view稳定关联键优化，实际查询约40s→2.7s，金额不变。
- [x] 最终dbe1f254f524990ef6287e53e4f3760447ce30cb，Repository=Web=API/CONSISTENT，健康检查通过；3个任务提交已安全push github/main。

## 正在进行
- 无。

## 待完成
- 无。

## 修改文件
- 本次27个源码/契约/测试/运行脚本/迁移/业务与调度文档，详见git diff 254ef45..dbe1f254f524990ef6287e53e4f3760447ce30cb --stat。
- outputs/CODEX_PROGRESS.md本次提交脱敏技术恢复记录，完整原件保留本机，真实业务资料不提交。
- data/finance-movements-release/：受限本机证据/验收，Git忽略。

## 数据库 Migration
- FinanceE10Movements1722920097000：新增台账/事实/快照/批次/视图及RLS。
- FinanceE10MovementJoin1722920098000：仅优化新视图稳定订单键关联。
- 均已执行，无pending，不替换旧统计视图、不修改ERP标准SQL。

## 新增或修改测试
- API金额/关闭/改价/去重/重审/捕获窗口、Web页面及Chrome E2E、隔离PG12（api来源审计/全部导出/权限/幂等）和原PG23、Python reader。

## 已运行测试
- API全套1040通过/33既有skip，最终专项29通过；Web413、Contracts29、Chrome E2E8、Python8、新PG12、旧PG23通过。
- workspace typecheck/lint/build通过，最终API build/lint/新PG重验通过；保留Portal既有warning，0error。
- 真实线上Chrome12、API四表与三汇总勾稽、四Excel全匹配金额/行数、旧大屏/排名年度金额、401/403、增量幂等、旧视图/授权/6flags、sourceSQL散列、部署check/健康通过。

## 当前已知问题
- 无未解决阻塞。不能确认的历史金额不猜测，未宣称完整历史；用户取消完整性调查。
- 全量日志证据保留，明确有效状态不足者不计入发生额；接单基数不是历史原始金额。

## 等待用户确认
- 无。业务口径、开发、备份、迁移、部署和安全GitHub同步均已授权且完成。

## 下一步
1. 无开发遗留；日常增量由FIN-003运行，需要补偿时用受控脚本或Web管理员同步入口。
2. 最终报告：data/finance-movements-release/ACCEPTANCE.md；两个正式页面/金额证据/备份/发布及Git记录均在报告中。

## 恢复执行说明
规范→本节→git status/diff→报告。当前任务已完成，不恢复旧只读阶段的历史完整性工作，不提交真实财务证据/备份/凭据；技术进度于2026-10-20脱敏后同步。

---

# Codex 工作进度

## 任务
任务名称：KDOS财务订单金额跨月变更统计第二阶段：历史事件验证与金额勾稽。
任务目标：以254ef45为不变基线，只读关联SO_CHANGE/DataLog、核实语义和去重、量化2025以来可归属/存在缺口/无法还原金额，提交事件/快照/月发生额设计与测试方案。
当前状态：已完成（本阶段只读调查与设计，等待业务口径审阅）。
最后更新时间：2026-10-19 14:22（Asia/Shanghai）。

## 当前阶段
当前阶段：证据分级/逐月金额勾稽、正式设计和只读保护验证完成。
当前子任务：无。未实施事件账本，不自动进入开发/部署/Git同步。

## 已完成
- [x] 读取项目规范、适用Skills、任务台账、上一阶段报告与三份SQL；保护既有本机进度历史。
- [x] HEAD254ef45/标准SQL保持；当前财务范围不追加Y/G筛选，头1整单/计划1对应稳定品项排除，保持原复核规则和全部原始品项。
- [x] 只读取得日志、EventId、变更单及原始订单/品项/计划证据；源抽取散列保留本机，无T+读取/ERP写入/消息。
- [x] 已关联准备日志不单独累计，未关联准备日志隔离；CHANGE_TYPE 1修订/2增行/3指定结束证实，4仅旧恢复效果样本，未冒称完整审核/撤销过程。
- [x] 当前订单群、明确状态节点和跨月品项已核验；真实净额、绝对差及节点条数仅留受限原件。只按现存最后ApproveDate节点口径，不能称完整实际生效历史账。
- [x] 尚缺历史关闭资格的跨月事件、期末差额及链内恢复缺口单列、不直接相加。全历史未知金额NULL，不伪造0或覆盖率；真实数量和金额仅留受限原件。
- [x] 历史调查阶段逐月完整性JSON/CSV输出，每月无法还原金额NULL/UNKNOWN；当时未确认完整月份。期前订单后续节点另列，不扩大现有财务范围；后续用户已取消此类完整性工作。
- [x] 关闭同时改价节点按正确净额处理，避免重复冲减；实际跨月样本已逐项核对，真实订单编号、版本、品项数量及金额仅留受限原件。
- [x] 全节点月份/事件客户/当前财务事业部守恒；样本当前E10头/品项和KDOS有效总额对平。历史事业部未证实，不以当前分类冒充历史。
- [x] 事件表/历史快照/月发生额视图正式字段、键、UNKNOWN闸门、tenant/account/RLS、审计、维度转移、精度/源时间、兼容性与正式测试方案完成；仅文档，不执行DDL。
- [x] 调查范围内逐月订单数/金额离线精确重现；前后原始行指纹、客户分类/审计、视图定义、6flags一致。真实业务数量仅留本机，HEAD和原SQL SHA未变。

## 正在进行
- 无。

## 待完成
- 无本阶段实施事项；等待业务审阅后另行开发，不自行实施草案。

## 修改文件
- outputs/CODEX_PROGRESS.md：本机主恢复入口，保留所有历史；本阶段不提交。
- data/e10-sales-order-time-audit-20261019/phase2-history-events/：受限本机证据、报告、设计、逐月CSV、分析/验证脚本（Git忽略，目录700/文件600）。
- 无运行源码、原标准SQL、迁移或调度配置修改。

## 数据库 Migration
- 无；未执行DDL、业务数据、授权、配置或调度写入。

## 新增或修改测试
- 本机validate-analysis.py：50项精确金额/证据守恒、去重、结束/恢复/改价、UNKNOWN、月末/精度规则验证。
- sample-current-controls.py：两单当前源头/品项与KDOS有效总额勾稽。
- final-protection.py：18项基线/源码/SQL/证据文件保护验证。
- 正式应用API/Web/权限/租户/迁移/Chrome E2E仅提出下一阶段方案，未冒称执行。

## 已运行测试
- validation-results.json：50/50 PASS；deep-reconciliation-summary.json：节点与维度守恒PASS（真实条数仅留受限原件）。
- baseline-parity.json：22月当前254规则精确重现PASS。
- sample-current-reconciliation.json：两单原始及有效金额控制PASS。
- final-protection.json：18/18 PASS，30份源抽取散列未变。
- 无应用改动，不重复跑全仓API/Web/build；没有部署、commit、push或暂存。

## 当前已知问题
- 无CLOSE/审核状态字段日志；2025-01/02没有普通订单日志，3月17日才开始；空删除缺原值、未关联日志、反审核/重审/撤销未留完整过程。
- 已知期末/链内差不是全历史未知总额；原始日志差额不能直接当有效发生额。每个月完整性均不足，不能认证完整历史实际生效月账。
- 事业部只按当前财务映射重列，历史归属需补证；ERP Owner_Dept不能替代。

## 等待用户确认
- 月份按实际订单生效还是变更单审核；是否接受带缺口标识的最后审核节点历史。
- 当前分类重列/历史原属、反审核/V撤销/恢复/整单结束实际影响、同月区间推断是否可入账、2025前订单的期初存量处理。
- 未确认前，不开发、不迁移、不修改标准SQL或统计、不部署、不Git同步。

## 下一步
1. 审阅主报告：data/e10-sales-order-time-audit-20261019/phase2-history-events/KDOS_PHASE2_HISTORY_RECONCILIATION_REVIEW.md。
2. 审阅正式设计：同目录KDOS_ORDER_CHANGE_EVENT_DESIGN.md及monthly-completeness.csv。
3. 用户确认业务口径后，才启动正式开发、隔离验证、批准后的部署及安全GitHub同步；本阶段到此停止。

## 恢复执行说明
规范→本节→git status/diff→phase2主报告/final-protection.json。复用已落盘30份源证据及分析，不重新从头抽取，不重复已完成指定结束修复。线上基线254ef45，原标准SQL SHA cc4d7b22198846cdae160460108c69277b98ee7822d8c62a6bb327a5e3089ec9。真实财务证据仅本机data，禁止提交Git。只有业务确认和新实施指令后才进入后续开发。

---

# Codex 工作进度

## 任务
任务名称：E10标准销售订单SQL时间字段与跨月金额历史可还原性只读调查。
任务目标：核实真实创建/修改时间、稳定ID、日期精度、一对多金额风险和历史记录；交付独立SQL草案及报告供审阅。
当前状态：已完成（本阶段只读调查）；等待用户审阅后决定后续实施。
最后更新时间：2026-10-19（Asia/Shanghai）。

## 当前阶段
当前阶段：调查报告和独立SQL草案已完成验证，等待审阅。
当前子任务：无。本阶段不修改生产SQL/ERP/KDOS数据，不部署、不commit或push。

## 已完成
- [x] 已读当前AGENTS、适用表单/调度Skill、FIN-002台账和既有进度；保留原CODEX_PROGRESS本机修改及历史。
- [x] 在任何调查前备份原SQL至data/e10-sales-order-time-audit-20261019/sales_order.original.20261019_123958.sql；原/备份SHA一致，最终原文件未变。
- [x] sys.columns/主键核实三表CreateDate、LastModifiedDate均datetime2(7)非空；另有ModifiedDate；Version为rowversion不是时钟。
- [x] 订单/预交日期也为datetime2(7)；源当前业务日期为零时分秒，但创建/修改有真实时间；不伪造非零时刻。
- [x] 标准2025+范围没有多计划重复，全库发现真实两计划品项；独立品项v2 OUTER APPLY聚合和计划明细分开，保留原审核/客户/日期WHERE。
- [x] 真实只读执行原标准与品项/计划草案，行数/金额一致、唯一ID不重复，时间返回原生datetime，ISO文本保留精度；变更单草案亦执行通过。
- [x] 逐月核查202501到202610共22个DataLog表，解析金额OriginalValue/NewValue/EventTime；普通订单日志最早2025-03-17，前期存在缺口/空载荷，不能保证完整历史。
- [x] SO_CHANGE_DOC/_D包含原新金额与来源ID；验证变更明细和当前品项/订单关联，找到真实跨月样本。CHANGE_DATE、CreateDate、ApproveDate和EventTime不同，不能误用当前LastModifiedDate还原每次金额发生时间。
- [x] SQL2014/compat100/CS排序、CDC未启用、头Change Tracking仅1天、无目标触发器、msdb可见备份及20251013单点复制表边界已核查；不改任何配置。
- [x] 前端/Excel YYYY-MM-DD HH:mm:ss、时间精度/时区、Reader/契约/date视图兼容、增量水位与事件账本建议及审核范围差异已写报告。

## 正在进行
- 无。

## 待完成
- 无本阶段实施事项；生产修改/迁移/部署均不执行。

## 修改文件
- outputs/CODEX_PROGRESS.md（延续本机未提交修改，保留历史）。
- data/e10-sales-order-time-audit-20261019下受限本机报告、备份、三个独立SQL草案、sys.columns核查SQL及只读证据；Git忽略，不上传。

## 数据库 Migration
- 无；无数据库写入，无应用代码或生产SQL修改。

## 新增或修改测试
- 无应用测试。仅只读SQL真实执行、同筛选金额/行数/唯一ID/时间类型和源码SHA比较。

## 已运行测试
- proposal-validation.json PASS；history-proposal-validation.json PASS；原文件/备份SHA及三草案原WHERE原文一致；Git HEAD未变。
- 本阶段没有应用改动，不重复全仓测试/构建，不部署。

## 当前已知问题
- 仅当前创建/最后修改时间不能还原每次旧金额。2025年1—2月无普通订单日志，部分日志缺载荷；其他归档/事务日志链未证实，不能保证完整历史。
- 标准SQL Y/G%过滤与当前财务Reader范围不同；只读草案保持标准筛选，不未经审阅替换现有Reader改变数据范围。

## 等待用户确认
- 用户审阅报告及独立SQL草案后，决定后续字段接入、历史事件账本与跨月差额的业务生效时间规则。本阶段到此停止。

## 下一步
1. 审阅报告：data/e10-sales-order-time-audit-20261019/E10_SALES_ORDER_TIME_AUDIT_REVIEW.md。
2. SQL草案：sales_order_finance_time_v2.proposal.sql、sales_order_schedule_time.proposal.sql、sales_order_change_document.proposal.sql（同目录）。
3. 未有新的实施指令前，不修改原标准SQL、不部署、不commit/push。

## 恢复执行说明
规范→本节→git status/diff→本轮final-state.json/审阅报告。本阶段已完成，严格遵守当前只读调查范围；原SQL保持SHA cc4d7b22198846cdae160460108c69277b98ee7822d8c62a6bb327a5e3089ec9。不要重复先前已完成过滤修复或擅自实施草案。

---

# Codex 工作进度

## 任务
任务名称：KDOS财务E10销售订单统计指定结束过滤修复（最终品项级规则）。
任务目标：订单头指定结束整单不计；交货计划指定结束仅对应source_line_id品项不计，其他品项继续统计；原始品项全部保留，只读鼎捷E10。
当前状态：已完成。
最后更新时间：2026-10-19（Asia/Shanghai）。

## 当前阶段
当前阶段：已部署、完整刷新并逐订单验收。
当前子任务：无；不重复全仓测试/原始全量Excel，不自动进入其他任务。

## 已完成
- [x] 起始任务HEAD 9b867d3，头规则3875095已部署；用户质疑0单结论后重新核查，最终明确品项和整单分别过滤。旧0单结论已撤回，不作为最终业务验收。
- [x] 通过已配置的E10只读连接核验；源连接地址、账套和登录身份仅留受限本机原件。未登录E10客户端，没有读取用友T+，不写ERP；凭据仍由基础工具包管理。
- [x] 直接执行sales_order.sql、销售订单手工查看.sql、销售出货标准SQL；源文件SHA未变。头、交货计划、出库字段不同；自行取得真实样本，无需用户提供密码或单据。
- [x] Reader内部headerCloseCode/hasSpecifiedCloseSchedule，原始34列不变；新页和全部暂存页强校验，缺标志断点旧页原子拒绝。
- [x] 新96迁移仅替换monthly：头1整单排除、交货计划1仅关联品项排除后重算金额/日期/行数；保持稳定订单id、原诊断/原始视图及原复核约束，所有分析/导出共用。
- [x] 用户已授权仅本任务commit/push/部署；13文件254ef45b48a66bb7ff744b1f13bc30e118cf2c5f已push github/main，无分叉/强推/覆盖其他修改。
- [x] 备份20261019_122443（本地两份PostgreSQL库、uploads）及3项SHA通过；96迁移应用，共95记录，迁移前后原始行数/版本指纹一致。
- [x] ./scripts/deploy.sh all/check：Repository=Web=API=254ef45，STATUS=CONSISTENT；四服务健康、Swagger/OpenAPI可用。
- [x] 正式Finance FULL运行成功，内部批次标识和源规模仅留受限原件；当前来源品项内部标志完整，保留来源缺失历史追溯记录。
- [x] 全部生产订单逐个核算剩余品项合计、应入集合、稳定id；2025/2026月度、大屏各维度、客户排名金额一致。真实受影响订单原始/月度及客户年度排名Excel已解析核对。
- [x] 线上2025/2026大屏/排名API总额一致、三页面200、匿名401、无read403；使用现有身份短时维护JWT，不改权限，不宣称密码登录。
- [x] 客户分类、角色/权限/授权、6个同步flags与本轮基线一致；隔离测试PG容器与volume已清理，生产保留。

## 正在进行
- 无。

## 待完成
- 无。

## 修改文件
- 本轮13文件：96迁移、Finance Application及API/迁移测试、E10 Reader/Python测试、两套PG验证脚本与合成结果、implementation/任务台账/公开实现记录。完整清单见git show 254ef45及受限ITEM_ACCEPTANCE.md。
- 本主进度公开新增记录已脱敏，完整含金额原件留受限本机备份；不提交真实ERP/财务数据、xlsx、NDJSON、备份或凭据。

## 数据库 Migration
- 1722920096000-FinanceE10SpecifiedItems，只替换派生monthly视图；down恢复95仅头过滤，不删原始数据。不修改源SQL/ERP/业务历史记录或同步调度。

## 新增或修改测试
- 部分/全部品项指定结束、订单头指定结束、头2下部分关闭、NULL/零/负金额、同品号不同ID、混合交货状态、保留异常、稳定id/源行保留、租户/账套、幂等/恢复/旧页拒绝、月度大屏排名三类Excel金额。

## 已运行测试
- 本轮API17、Python4、Web财务6、真实PG订单23+客户/fresh20（95迁移）全部通过；API typecheck/lint/build通过，标准all完成Web/API/worker构建。
- 前阶段全仓API1016、Web407、Contracts29、Chrome本地/线上各5已通过；本轮无Web/契约源码变更，按相关范围回归，未重复耗时全量Excel。

## 当前已知问题
- 无阻塞。审核Y/N/V与标准SQL只取Y的差异已先报告并按用户要求保留，不引入G%客户筛选。
- 先前仅头规则验收已撤回并由本次品项级实际数据验收取代。真实排除品项/订单/金额与年度报表总额见受限报告，不入Git。

## 等待用户确认
- 无。用户已确认最终分层规则并授权本任务提交/推送/部署。

## 下一步
1. 无剩余工程步骤；最终报告：data/finance-header-close-20261019/ITEM_ACCEPTANCE.md。
2. 精确结果：item-production-validation.json、item-api-production.json、item-refresh-result.json、final-state.json。所有真实财务资料仅受限本机保留。

## 恢复执行说明
规范→本节→git status/diff；任务已完成。当前线上/源码254ef45一致，主进度新增记录已按2026-10-20文档同步要求脱敏，完整原件留本机。不要再使用已撤回的旧0单验收，不重复分析/测试/导出或自动进入PMC后续阶段。

---

# Codex 工作进度

## 任务
任务名称：KDOS-MPS-DASHBOARD-REV3C-001：PMC综合驾驶舱改造。
任务目标：原URL改造为管理汇总驾驶舱；A/B保持PASS，三张明细报表独立入口、跨屏筛选联动和既有权限/导出保留。
当前状态：已完成（工程交付）；REV3-C = WAITING_MANUAL_ACCEPTANCE。
最后更新时间：2026-10-16。

## 当前阶段
当前阶段：功能部署与验证已完成。当前子任务：最终记录发布及版本健康smoke；恢复先看私有final-state.json与实时check，已一致则无需重跑。

## 已完成
- [x] 起始HEAD/线上Web/API均50a518741dd77f9c476a5a1aa4e1f93af2babbc9，工作区干净；已读本轮指令、AGENTS、适用Skill、总控/指标/验收及源码。
- [x] A人工验收2026-10-16 PASS（用户确认真实人工验收）；A/B PASS、C IN_PROGRESS、D NOT_STARTED，独立文档提交1b4d9a4已push github/main。
- [x] 实现决定：原/master-plan-dashboard改名，不增第二套驾驶舱；同一summary聚合与scope；仅省略首页不用的风险明细投影，不重写差集/事实公式。
- [x] 明细保留/master-plan-reports同资源入口；跨屏只加可选初始参数，白名单/日期contract校验，直接打开A/B默认行为不变。

## 正在进行
- [x] 驾驶舱9KPI/7图表/4风险摘要/事业部表与折叠10工序汇总；独立三表原组件/API；安全跨屏白名单与A/B可选初始条件。
- [x] Web专项33、Contracts29、启用Dashboard+OrderProgress PG及HTTP专项31通过；typecheck/lint/build通过，只有既有Portal/Vite提示。
- [x] API full108套1012通过（33默认skip）；新三页面Chrome29项全部通过，13项驾驶舱/报表、A7、B9；Vite源码误计请求已精准修正为API路径。
- [x] Web full发现B展开竞态：250ms初始相同query回调会无条件折叠。已最小修复为仅实际页码/页大小/排序变化时折叠，保留原筛选折叠；原B8项复测通过，新定向回归及最终Web full54套407项均通过。
- [x] Chrome最终29/typecheck/lint/build复测通过；标准双库/uploads备份20261016_141858及3项SHA256通过，migration93/93。
- [x] 真实全范围逐行虚拟表达式探针15s/60s超时；已完成一次授权原始事实独立核算+canonical固定样本，完整summary与起始Service逐字段一致；线上15s保护不变。

## 待完成
- [x] API108套1012、Web54套407、Contracts29、启用PG/HTTP31、typecheck/lint/build、Chrome29通过。
- [x] 真实四scope与起始Service逐字段一致；4事业部、56状态分布/120工序数值/280趋势点、40canonical样本、5种完整Excel、CUSTOM/tenant/field/read403/export403通过。
- [x] 备份20261016_141858、SHA256、93/93迁移/无新增；授权/6flags/结构一致；业务并发变化按审计单列（Web100导入/3报工、1任务/4ERP行更新），本任务只读。
- [x] 功能7b85aaf（28文件）push github/main，标准all/check，Repository/Web/API一致；4服务healthy、PG原容器保留、Dispatcher active、4页面200/匿名API401；线上Chrome29/29、容器真实四scope及9gap total/noRead403验证通过。
- [x] 部署后12业务表count/version、授权、6flags、结构/约束/migration与部署前一致；起始期间正常并发业务差异已按审计单列，不覆盖。
- [x] 验收outputs/KDOS_MPS_PMC_COCKPIT_ACCEPTANCE.md、指标outputs/KDOS_MPS_PMC_COCKPIT_METRICS.md；A/B PASS、C WAITING_MANUAL_ACCEPTANCE、D NOT_STARTED。最终记录提交亦必须标准all/check，结束SHA/健康smoke以私有final-state.json及交付回复为准。

## 修改文件
- API summary/Controller/HTTP/PG；Web驾驶舱/toolbar/原Drawer抽取/三报表/跨屏/A-B可选条件与B同query修复/样式/App/Web与Chrome测试；Contracts类型/导航测试；integration-guide/runbook、总控/本进度/C指标/验收、B已确认PASS头部。

## 数据库 Migration
- 无；93/93已应用，无结构/生产授权初始化，NO-GO未触发。

## 新增或修改测试
- 按本轮28项要求补齐：KPI/10工序/辅助计划/7日趋势/权限/跨屏/三报表/导出/三尺寸及A/B。

## 已运行测试
- API1012、Web407、Contracts29、HTTP/PG31、Chrome29、typecheck/lint/build全部通过；详见C验收报告。首次Web3项B竞态失败已正式修复并全量闭环，保留失败日志。

## 当前已知问题
- 无阻塞。图表状态粒度是月计划品项，不标为工序任务数量/产能瓶颈；数量不冒充等价产能。

## 等待用户确认
- 无实施授权等待；C最终等待真实人工验收，不自动PASS。

## 下一步
1. 恢复先运行deploy.sh check并读data/pmc-cockpit-rev3c/final-state.json；若当前HEAD已一致、最终3smoke/健康/基线核验记录齐全，则任务工程交付已结束，不重复构建/测试。
2. 仅当最终记录版本尚未发布时，push github/main并标准all/check、健康、三页面Chrome smoke/HTTP与最终只读快照确认，写final-state.json。
3. 等待用户真实人工验收C；A/B PASS，C WAITING_MANUAL_ACCEPTANCE，D NOT_STARTED；不自动进入D。

## 恢复执行说明
规范→本节→总控/指标→git status/diff→第一项未完成。保留下方历史；不重做A/B或业务导入。

---

# Codex 工作进度

## 任务
任务名称：KDOS-MPS-DASHBOARD-REV3A-001：待处理事项独立大屏。
任务目标：独立路由复用9类正式差集、远程筛选、服务端分页/排序/搜索/导出及既有权限；保持旧页与REV3-B兼容。
当前状态：已完成 / PASS。用户确认真实人工验收通过，人工验收日期：2026-10-16。
最后更新时间：2026-10-16。

## 当前阶段
当前阶段：功能部署与线上核验已完成。当前子任务：无代码遗留；最终记录版本按all/check发布，恢复时以实时check与私有final-state.json确认本记录版本是否已完成发布。

## 已完成
- [x] 起始HEAD/生产Web/API均d6e6e8a，工作区干净；规范、Skill、审计/指标及当前源码已核对。
- [x] REV3-B人工验收2026-10-16 PASS，真实多周样本后续补充不改变PASS；3份记录独立提交e806509并push github/main。
- [x] 权限审计：独立视图仍为同一9类overview事实，安全复用mps-overview-dashboard的read/export/字段/CUSTOM scope；不新增资源、不改授权。
- [x] 实现决定：从现有querySql/gap_rows选择轻量数量结果，清单/导出沿原链路；原综合页不改业务结构。

## 正在进行
- [x] 轻量数量接口、新路由/导航/页面、按需保留独立Tab分页/搜索/排序；旧页沿原组件默认行为。
- [x] API全量108套1011通过（32默认skip）；新旧PG专项18通过（含新增55条TEMP数据两页验证/rollback）；Web新页6通过，旧页专项21通过；Contracts25通过。
- [x] typecheck/lint/build通过，只有既有Portal FastRefresh和Vite chunk警告。
- [x] Chrome三个页面28项通过；真实生产三组顶部Scope×9类count/summary/detail一致，9类全量Excel行数一致、无UUID；CUSTOM9类、空tenant9类、read/export拒绝均通过。
- [x] 12业务表、6flags、授权/角色/管理员哈希、schema/约束/migrations与起始一致；migration:show93/93；标准双库/uploads备份20261016_104224及3项SHA256通过。
- [x] Web最终单worker全量52套400项全部通过；首轮399/400既有研发页时序偶发失败，原测试隔离27/27及最终全量均通过，未修改该测试。

## 待完成
- [x] 用户已于2026-10-16确认REV3-A真实人工验收PASS。
- [x] API/Web/Contracts/PG/Chrome/typecheck/lint/build。
- [x] 真实9类count/detail/export只读核验、数据/权限/6flags基线对比、migration check。
- [x] 标准备份、功能提交13c2a1e（16文件）push github/main、all/check部署、线上健康与部署后三页Chrome28/28通过。Repository/Web/API一致；4容器healthy、原PG容器保留、Dispatcher active，三页面200，受保护API匿名401。
- [x] 运行API容器实际只读Service9类count/detail一致；count969ms，数量与验收报告一致。
- [x] 部署后角色哈希差异追查：10:53:45订单分配权限组web保存，早于本任务功能提交及部署；备份逐列比较仅updated_at/version2→3，其余角色业务授权字段、权限项一致；外部现状保留，本任务无授权写入。
- 最终记录版本也按标准all/check发布；最终SHA/发布与健康结果定位data/mps-gaps-rev3a/final-state.json和交付回复，不在本文件写自引用SHA。
- [x] 验收报告outputs/KDOS_MPS_GAPS_REV3A_ACCEPTANCE.md；A/B PASS；C按新任务启动，D NOT_STARTED。

## 修改文件
- 16任务文件：Contracts类型/测试；API Service/Controller/HTTP及PG测试；Web App/共享GapList/新页面及Web/Chrome测试；integration-guide/runbook；REV3总控/本进度/新验收记录。功能13c2a1e。
- B验收文档3文件独立e806509。凭据、业务行、备份、私有验证脚本/日志不入Git。

## 数据库 Migration
- 无新增；93/93已应用，schema/约束未变。无生产权限变更；STOP/NO-GO条件未触发。

## 新增或修改测试
- 计划覆盖9类count/detail/导出、统一顶部Scope、独立分页/搜索/排序、tenant/CUSTOM/read403/export403/英文文件名、新旧页面回归。

## 已运行测试
- API108套1011通过（默认32skip，相关PG18另启用全部通过）；Web52套400通过；Contracts25；typecheck/lint/build通过。Chrome本地28/28、部署后28/28。初轮Web研发页偶发及Chrome定位问题已按原断言复测闭环，失败证据保留。
- 生产27次KPI/summary/detail对账、9类完整Excel/CUSTOM/tenant/read/export拒绝、备份SHA256、93/93迁移与健康/版本均通过。

## 当前已知问题
- 无阻塞。3天工单窗口仍无正式规则，继续不展示。

## 等待用户确认
- 无。REV3-A用户已确认PASS。

## 下一步
1. 恢复先读取私有final-state.json并运行deploy.sh check；记录版本若已一致/健康，则本阶段无需重复执行开发或部署。
2. 仅当记录版本未发布时完成标准all/check与健康/Chrome smoke。
3. REV3-A已确认PASS；先独立提交人工验收记录，再实施用户授权的REV3-C，D不启动。

## 恢复执行说明
规范→本节→git status/diff→总控/验收记录→下一步首个未完成项。保留下方历史；不重做B、导入或督办UAT。

---

# Codex 工作进度

## 任务
任务名称：KDOS-MPS-ORDER-PROGRESS-REV3B-001：在制订单进度看板 Demo。
任务目标：独立真实数据订单/品号矩阵、按需分页展开、正式权限交集详情、两类服务端全量导出。
当前状态：已完成 / PASS。人工验收日期：2026-10-16；用户明确确认。
最后更新时间：2026-10-16（人工验收记录）。

## 当前阶段
当前阶段：开发、自动验证、真实数据只读对账、备份、功能提交推送和功能部署核验已完成。
当前子任务：无开发遗留；最终记录发布版本以Repository/Web/API一致为准，不启动其它REV3阶段。

## 已完成
- [x] 真实起始HEAD4ece1df、线上08f9195，差异仅outputs；未reset/覆盖他人源码。
- [x] 仅REV3-B；原综合大屏与9类待处理未拆分，A/C/D仍NOT_STARTED。
- [x] 新resource mps-order-progress-dashboard；路径/master-plan-order-progress，现有registry及正式授权机制，无生产权限初始化。
- [x] 正式集团完成率、月计划入库完成率与工序进度独立；多次报工SUM，255/500=51%、525/500=105%；多批次稳定父链和事业部隔离，独立来源行保留待核实。
- [x] 订单/子品项分页及排序独立、按需展开，原表权限交集Drawer；公共compact/列宽/sticky/单纵向滚动。
- [x] 两类完整Excel，主导出不受展开影响；子表本订单导出精确收窄。read∩export、tenant和字段裁剪，英文文件名，无UUID。
- [x] API全量108套1008项通过；新旧PG及HTTP21项启用通过；Web全量51套393通过，后追加导出范围专项最终8项通过；Contracts24。
- [x] 新Chrome9项通过；功能部署后的新旧Chrome21项全部通过。合成UI证据与真实数据对账明确分开。
- [x] 最后全仓typecheck/lint/build通过，仅既有Portal FastRefresh/Vite chunk警告；migration:show 93/93，无新增。
- [x] 真实数据101月计划/1010工序数量及进度核验；月计划100条×66表达式、周计划100条×60表达式对照提取前SQL零差异。
- [x] 真实订单约240ms、单订单品项27–73ms；运行容器直接读取266ms/54ms。全量品项聚合约2s，实际完整xlsx生成/读取/行数及无UUID检查通过。
- [x] 12业务表记录数/version哈希、6项flags、权限/角色/管理员授权哈希及migration台账与基线一致，未触发任何手工同步。
- [x] 备份20261016_092646双库与附件完成，pg_restore目录和3项SHA256通过。
- [x] 功能提交bbefc6de739cb8140aa98c8eed63344df54cf953（25文件）已push github/main并标准all部署；功能版check CONSISTENT，4容器healthy，原PG容器保留，Dispatcher active，新旧页面200、新API匿名401。
- [x] 最终记录提交亦需推送并标准发布到同一版本；具体最终SHA以git HEAD、deploy.sh check和私有final-state.json/最终交付回复为准，不在文档中制造自引用SHA。

## 正在进行
- 无开发事项；恢复时核对最终记录版本，check一致则无需重复部署。

## 待完成
- [x] 用户已明确人工验收PASS（2026-10-16）。真实多周计划场景已通过隔离PostgreSQL测试；取得真实样本后的业务复核仅为补充验证，不改变PASS。

## 修改文件
- 功能25文件已推送：新Contracts/字段资源；OrderProgress Service/Controller/Export/API及PG测试；config共享SQL表达式；Application导出审计；Module；App/兼容RemoteSelect/新页面CSS及utils/Web/Chrome；总控/指标/验收/进度、接口/runbook/Roadmap。
- 最终outputs及Roadmap记录随记录提交同步；真实订单号、业务样本、Excel/EXPLAIN/日志仅data/order-progress-rev3b，不入Git。

## 数据库 Migration
- 无新增，无索引/事实表/业务数据/权限数据/flags更改。导出验证使用明确审计stub，不产生生产假审计；正式用户下载按Application审计。

## 新增或修改测试
- 覆盖未完成/缺月计划、多品项/重复独立来源/多交期/多周计划、真实报工SUM/51%和105%、准备状态/无记录/无任务、分页/筛选/导出、原表权限/字段/tenant/CUSTOM/read∩export。
- 默认29个外部集成用例跳过；本轮相关新旧PG已单独启用通过，不将默认skip计为通过。

## 已运行测试
- 以上API/Web/Contracts/typecheck/lint/build/Chrome/迁移检查/备份校验/功能部署check均通过。
- 私有证据data/order-progress-rev3b；容器真实读取与独立原始SQL对账均READ ONLY。界面默认日期为上海昨天，可切不限日期查看全部在制订单。

## 当前已知问题
- 真实B类样本缺口，详见验收报告；图纸无独立完成日期字段；ERP多来源无法逐行归属时保留待核实，不复制月计划进度。

## 等待用户确认
- 无。用户已确认PASS；REV3-A按新指令独立实施，C/D不启动。

## 下一步
1. 恢复时先deploy.sh check；最终记录SHA若未上线则完成标准all部署/健康验证，避免已完成版本重复发布。
2. 本阶段已完成。真实B类样本复核作为补充事项，不阻塞已确认PASS。
3. REV3-A按用户新任务实施，验收记录与代码分开提交；不自动进入C/D。

## 恢复执行说明
规范→本节→git status/diff→REV3总控/指标/验收。功能源码已推送且线上可用。最终发布SHA在data/order-progress-rev3b/final-state.json；最终报告outputs/KDOS_MPS_ORDER_PROGRESS_DEMO_ACCEPTANCE.md。保留全部历史，不覆盖下方任务。

---

# Codex 工作进度

## 任务
任务名称：KDOS-MPS-OVERVIEW-DASHBOARD-001 REV2。
任务目标：业务缺口审计、待处理KPI/分页清单/单表导出、三张独立报表；继承同一Dashboard Scope，保持只读与同步flags。
当前状态：WAITING_MANUAL_ACCEPTANCE（等待人工验收，不判PASS）。
最后更新时间：2026-10-15T23:49:48+08:00。

## 当前阶段
当前阶段：开发、自动验证、备份、GitHub同步、标准all部署及部署后核验完成。
当前子任务：无开发/部署遗留；等待用户人工验收业务口径与真实权限数据。

## 已完成
- [x] 基于真实最新707bc5a继续，保留督办任务修复；未回退6bff61e，既有导入/UAT进度保留在下方。
- [x] GAP_AUDIT及Gap Metrics锁定9类可靠缺口；3天工单窗口无正式应有集合，BLOCKED且不展示。
- [x] 同一gap_rows派生count/list/export；shipping/monthly、base/shipping、weekly/base使用正式父ID；无第二套业务事实。
- [x] KPI点击对应分页Tabs；三张独立KdosDataTable拥有独立请求/分页/排序/局部筛选/导出/加载错误空状态；原风险下钻保留。
- [x] 顶部Scope统一；tenant、Dashboard read、字段依赖、read∩export及英文无UUID导出由后端保证。
- [x] API全量107套1002通过；Dashboard最后13项含启用真实PG的5组场景和14类导出通过；Contracts22通过。
- [x] Web全量50套386通过；最后Dashboard11与独立报表2项复核通过；本地Chrome12及已部署Chrome12通过。
- [x] 全仓typecheck/lint/build通过；仅既有ModulePortal fast-refresh与Vite chunk警告。
- [x] 双库及附件备份20261015_232206完成，pg_restore目录及SHA256通过。
- [x] 仅本任务18个代码/测试/合同/文档文件提交并推送github/main：08f91951dcfa062133d61969c371a8964facb8df；既有无关进度未混入提交。
- [x] 标准deploy.sh all成功；check为CONSISTENT，Repository=Web=API=08f91951dcfa062133d61969c371a8964facb8df；4容器healthy，原生产PG容器保留，Dispatcher active。
- [x] 部署后生产只读33个聚合/分页查询完成，三组顶部条件下9类count=detail.total共27次对比通过；10业务表记录数/version哈希与基线一致。
- [x] 6项sync enabled/interval及migration台账与基线一致；页面200，新旧受保护Dashboard接口匿名401。

## 正在进行
- 无开发或部署执行中事项。

## 待完成
- [ ] 用户人工验收9类缺口业务含义、多批次清单、真实账号权限及三张独立报表交互；未经确认不判PASS。

## 修改文件
- 18个已推送任务文件：Contracts Dashboard/字段注册；Dashboard Service/Controller/Export/API与PG测试；Web Dashboard/Table及3份unit/Chrome e2e；GAP_AUDIT/METRICS/ACCEPTANCE、runbook/integration-guide及进度首节。
- 部署后最终运营记录更新仅位于outputs及忽略的data/mps-dashboard-rev2；不为记录变化重复发布应用。此前导入/UAT未提交进度仍保留。

## 数据库 Migration
- 无新增；migration:show 93/93已应用，台账不变。未修改业务数据、报工、入库、权限配置或同步flags，未触发同步。

## 新增或修改测试
- 稳定父ID差集、重复业务显示字段/不同父ID、多交期批次、跨tenant目标与来源、ready/not ready、0/部分/完成入库、0报工、人工异常与多风险、27组count/list一致、14类导出、权限/字段/Scope、独立3表状态及缺口点击。
- PG测试仅连接本地TEMP影子表并回滚；Chrome明确拦截合成API响应，不冒充真实用户业务验收、不创建生产假记录。

## 已运行测试
- 上述API/Web/Contracts/Chrome/typecheck/lint/build/migration/check均通过。
- 部署后EXPLAIN execution 1252ms/planning10ms；分页明细145–1207ms。私有证据：data/mps-dashboard-rev2。

## 当前已知问题
- 3天工单窗口缺少正式“当前3天应生成”的准入规则，BLOCKED；不把全部未生成工单的weekly当异常。
- 未进出货只表示正需求monthly尚无正式父ID关联shipping，不表示数量/全部批次已排完；需用户人工确认管理口径。

## 等待用户确认
- 用户人工验收；无权限/发布批准等待。

## 下一步
1. 用户按GAP_AUDIT/Gap Metrics和验收清单核验线上页面。
2. 收到具体反馈继续本任务；未经确认保持WAITING_MANUAL_ACCEPTANCE。
3. 无需重导Excel、重做督办账号UAT、重跑同步或重复创建业务数据。

## 恢复执行说明
项目规范→本节→git status/diff→最终验收报告。源码与GitHub/线上已一致，outputs本地运营记录及历史进度保留；不得覆盖。最终报告：outputs/KDOS_MPS_OVERVIEW_DASHBOARD_ACCEPTANCE.md；私有运行证据data/mps-dashboard-rev2。

---

# Codex 工作进度

## 任务
任务名称：创建任务所属督办项目候选/后端授权范围修复。
任务目标：同租户未结束项目按负责人/督办人/参与人关系授权，管理员放行；独立于项目read scope；任务create权限保留。
当前状态：已完成。
最后更新时间：2026-10-15T19:40:38+08:00。

## 当前阶段
当前阶段：开发/回归/备份/GitHub同步/部署/健康验证及真实普通账号验收均完成。
当前子任务：无。最终报告data/supervision-task-scope/result.md（私有）；运行与远程源码版本仍为707bc5a。

## 已完成
- [x] 已读AGENTS、表单/任务治理Skill、边界文档及任务台账；工作区仅既有进度未提交，HEAD 6bff61e。
- [x] 核实两个入口同一根因；普通项目列表/详情read及OWN语义不改。

## 正在进行
- [x] 参数化taskCreationProjectScopeClause供options/createTask共用；tenant/未结束/关系三项固定规则；提交FOR UPDATE锁定后保存与审计。
- [x] PostgreSQL+HTTP13个场景通过（真实Application、Query和审计，临时表回滚）；Web参与人选择回归6测试通过。
- [x] 已核实实际用户为普通启用账户，有task create、无project read，稳定ID属于指定项目participant_ids；项目当前租户且NOT_STARTED。

## 待完成
- [x] API全量107套/1001测试通过；数据库集成13通过；typecheck全仓和build通过；lint无错误；migration93/93已应用，无新增。
- [x] Web全量49套383测试通过（maxWorkers=2、testTimeout=15000）；参与人真实选择场景在默认5000ms下单独通过。
- [x] 生产备份182937双库/附件完成，SHA256全部通过。
- [x] 707bc5af0deef523cb3b6c2c79806e017feb774b已提交并推送github/main；deploy.sh all成功，Web/API版本一致，4容器健康，PostgreSQL原容器保留，Dispatcher active。
- [x] 部署容器内实时普通用户claims：候选可见、Application创建及本人审计成功、事务回滚清理、项目哈希不变；未登录HTTP401，健康200。
- [x] 实际账号实时AuthService有效权限下Query候选可见，Application创建及审计通过，事务回滚清理，项目全字段不变（私有actual-actor-verification.json）；此验证非真实浏览器登录。
- [x] 已连接用户真实Chrome登录：auth/me200，普通崔玮杰、有任务create无项目read；实际下拉找到并点击选择目标项目。
- [x] 同一真实Chrome会话正式POST创建测试任务201，created_by为该用户；精确UAT清理Application命令删除，创建/清理审计保留，独立回读旧任务/项目/管理员授权不变。
- [x] 刷新页面仍仅原1条任务；版本707bc5a一致、健康检查通过。截图/会话摘要/POST回执/清理证据均仅保存忽略目录，无Token输出或复制。

## 修改文件
- API：supervision.scope.ts / query.service.ts / application.service.ts及对应3个spec、新增task-creation.postgres.spec.ts。
- Web：SupervisionPages.spec.tsx；文档：docs/integration-guide.md；本进度。
- 既有数据导入进度保留在下方，不随本任务提交；私有数据/凭据/证据均不入Git。

## 数据库 Migration
- 无新增；API迁移93/93应用；core18/18校验和一致，未修改结构。

## 新增或修改测试
- 已补全owner/supervisor/participant/无关系/已结束/跨租户/管理员候选及POST后端回归、Web参与人场景。

## 已运行测试
- API unit37通过（首次新增集成测试fixture缺level已修复）；PostgreSQL+HTTP13通过；Web supervision6通过。
- API/Web lint通过（Web原有ModulePortal warning1）；API/Web typecheck通过。
- 首次参数转发/高并发超时已解决；全量API1001、Web383及启用数据库集成13全部通过。
- 真实Chrome用户会话：候选200、页面实际选取、生产POST201、测试任务删除并独立回读无残留。

## 当前已知问题
- 无未完成项；首次清理审计source=system不受现有约束支持，事务已回滚；改用现有api来源后清理与审计通过，无结构/权限变更。

## 等待用户确认
- 无。用户提供真实Chrome登录会话后，剩余实际验收已完成。

## 下一步
1. 已完成，无需再次创建测试任务或重导旧Excel。
2. 追溯优先读取data/supervision-task-scope/result.md、uat-verified.json和真实创建/清理审计；不输出或复制会话Token。
3. 本轮仅补实际UAT与本地私有证据/进度，无源码配置变化；运行与GitHub已同步707bc5a，不重复部署。

## 恢复执行说明
先读项目规范/Skill→本节→git status/diff，继续现有修改；不要重新执行下方已完成Excel导入。认证验证使用真实会话，不给账号提权。

---

# Codex 工作进度

## 任务
任务名称：10.14.3.xlsx整批静默导入。
任务目标：按用户明确要求不查重、不去重，完整追加下载目录10.14.3.xlsx，禁止本次微信提醒。
当前状态：已完成。
最后更新时间：2026-10-15T18:21:03+08:00。

## 当前阶段
当前阶段：正式导入及独立回读验证完成，当前203行，本次通知事件0。
当前子任务：无。最终报告：data/pmc-allocation-10143/result.md（私有，不入Git）。

## 已完成
- [x] 正式加密检测/解析通过：87有效源行、2订单、0错误，原文件不改。
- [x] 导入前备份181758双库及附件完成，pg_restore目录/SHA256校验通过。
- [x] 正式Spreadsheet预览→Application确认整批追加87行，更新0；全部源行保留，不查重、不去重。
- [x] 同次确认幂等及正式审计通过；新批次01a13f13-b8c5-7317-b69d-b655aceebf36。
- [x] 独立连接按原行号及ALLOCATION_FIELDS回读一致；原116行及归档2338行全部哈希不变；当前203行。
- [x] 本次独立命令不注入通知服务：通知outbox无新增，本次事件0，推送配置/接收配置/同步flags不变。
- [x] Runtime Repository/Web/API均6bff61e，Dispatcher仍active；无代码/配置变更，不重部署。

## 正在进行
- 无。

## 待完成
- 无。

## 修改文件
- 仅本进度；私有操作证据data/pmc-allocation-10143，不入Git；无源码/配置变更。

## 数据库 Migration
- 无。

## 新增或修改测试
- 无；本次为数据操作，执行正式解析/预览、同次确认幂等及写后回读。

## 已运行测试
- 正式链路87/0、源行完整保留、全字段回读、旧数据不变、通知/flags不变全部通过。
- 备份验证通过；deploy.sh check版本一致；Dispatcher active。

## 当前已知问题
- 无；本次操作已完成，勿再次追加此87行。上一批29行记录继续保留下方。

## 等待用户确认
- 无，用户已明确授权直接整批静默导入。

## 下一步
1. 已完成，刷新订单分配表可查看203行。
2. 追溯时读取私有result.md、verified.json和正式批次；禁止重复导入本批。
3. 无开发变更，不提交私有业务数据、不重部署。

## 恢复执行说明
AGENTS/两项Skill→本节→Git状态→data/pmc-allocation-10143的result/verified/receipt。操作已完成，勿重复导入本批或上一批29行；不修改全局推送开关、Dispatcher或同步flags。

---

# Codex 工作进度

## 任务
任务名称：三份10.14订单分配文件核对与静默补传。
任务目标：检查下载目录10.14.2.xlsx、10.14+.xlsx、10.14++.xlsx，只补缺少记录，绝不触发企业微信推送。
当前状态：已完成。
最后更新时间：2026-10-15（Asia/Shanghai）。

## 当前阶段
当前阶段：29行已正式补传并回读核验，当前116行；本次无通知。
当前子任务：无。最终报告：data/pmc-allocation-missing/result.md（私有，不入Git）。

## 已完成
- [x] 三文件已找到；起始工作区干净，HEAD 6bff61e。
- [x] 阅读表单/任务治理Skill及台账；普通Application导入可入通知outbox，不能直接用普通HTTP确认。
- [x] 核实Application notifications为可选注入；本次专用实例不注入通知服务，保留其它校验/审计/幂等/来源；不修改正式通知规则或Dispatcher。
- [x] allocation不产生下游对账任务，保持现有同步flags。

## 正在进行
- [x] 用户明确不去重；现有87行不得再导。两份87行文件业务内容逐行相同且均完整对应现有87行，因此整份跳过，原87行不动。
- [x] 10.14+.xlsx29行已归档，用户明确授权重新追加当前表；全部29行保留，不做任何行去重。

## 待完成
- [x] 备份180929双库/附件完成且SHA256、pg_restore目录有效。
- [x] 实际正式Spreadsheet预览→Application确认→重复确认已于单一事务验证并回滚，29/0，原87不变；通知outbox/规则/接收配置/flags均不变，SQL写入白名单阻止通知及其它业务表写入。
- [x] 正式Spreadsheet预览/确认追加完整29行，修改0，同批幂等与审计保留。
- [x] 按原行号/全部非金额业务值回读一致；原87与归档2338（合2425条）全字段哈希不变，当前116。通知outbox无新增/本次事件0；规则、映射、接收配置、flags及migration基线不变。

## 修改文件
- 仅outputs/CODEX_PROGRESS.md进度；业务证据保存在忽略目录data/pmc-allocation-missing，原文件不修改。

## 数据库 Migration
- 无。

## 新增或修改测试
- 无代码更改；按原有正式解析/预览/校验/导入命令进行操作验证。

## 已运行测试
- 已完成正式链路的事务回滚验证、同批幂等验证及正式29行全字段回读；87→116，通知事件0。

## 当前已知问题
- 无未完成项；以后不要重复确认这批29行，也不要按早先已纠正的203行计划操作。

## 等待用户确认
- 无；用户已授权补传且明确禁止推送。

## 下一步
1. 已完成，用户刷新订单分配表即可查看116行。
2. 如需追溯先读私有verified/receipt结果和正式批次，禁止再次追加该29行。
3. 无代码/配置修改，不重部署；业务文件与私有证据不入Git。

## 恢复执行说明
AGENTS/两项Skill→本节→git状态/diff→data/pmc-allocation-missing。操作已完成；先读verified/receipt和正式批次，禁止重复导入。绝不修改全局推送开关、Dispatcher或同步flags。

---

# Codex 工作进度

## 任务
任务名称：KDOS-MPS-OVERVIEW-DASHBOARD-001-REV1。
任务目标：沿用已上线V1，统一订单/品号/日期业务scope、联动远程多选、高区分度趋势色板与独立服务端Excel。
当前状态：等待人工验收（REV1开发、验证与功能部署已完成）。
最后更新时间：2026-10-15（Asia/Shanghai）。

## 当前阶段
当前阶段：REV1已上线，最终验收记录及项目规则同步，等待真实账号人工验收。
当前子任务：用户真实账号人工验收；最终发布SHA及检查见data/mps-dashboard/rev1-final-state.json。

## 已完成
- [x] V1最终c1357f7e82daefac38a2fdeb26d3b0c833a946dd已上线并push github/main，起始工作区干净，三SHA CONSISTENT；不重做V1。
- [x] REV1覆盖原无日期/搜索框/整屏导出规则；51/60/105%、状态独立/人工异常/权限保持。
- [x] 检查真实schema：group/monthly/base/weekly均有order_date；monthly正式latestCustomerDueDate优先未完成weekly最早交期。expectedShippingDate不作为交付日期。
- [x] 确定统一scope和日期边界，记录指标合同；仍不需要migration/索引或调度变更。

## 正在进行
- [x] 合同/API统一scope/50候选/三种分页明细及五种独立导出（含保留工序汇总）；正式下钻增加服务端scope约束，仍经原Query Service权限。
- [x] 页面多选日期控件、趋势色板/tooltip、四张明细与导出、安全下钻。

## 待完成
- [x] PG18 19组、Web专项10/全量49文件382、API初轮完整993/1既有skip通过；最终性能修正后API全量993/1 skip、类型/lint/build、Contracts22和Chrome11均通过；双库/附件备份145321已核验。
- [x] 生产只读性能/基线、备份145321、功能fcd5771已commit/push github/main，标准all/check/health；已部署Chrome11通过，三SHA CONSISTENT，原PG保留、四容器healthy及Dispatcher active。
- [x] 验收报告已补记真实部署结果，状态保持等待人工验收；项目AGENTS记录后续Dashboard独立单表导出规则。

## 修改文件
- contracts/{index,master-plan-dashboard}.ts；API dashboard service/controller/export/spec及Application仅导出审计summary；Query Service仅内部可信scope/只读事务包装。
- Web Dashboard/Filters/Table/utils/css/spec与Chrome；PG脚本；AGENTS、runbook及同一进度/指标/验收报告。

## 数据库 Migration
- 无；无新增索引。6项同步配置及93条migration基线不变；生产无业务写入。

## 新增或修改测试
- 将覆盖8种日期组合及边界、统一scope、联动候选50上限、独立完整Excel与字段/权限隔离。

## 已运行测试
- 起始deploy check三SHA CONSISTENT。隔离PG18 19组通过（含全部V1回归、统一scope/候选/8日期模式/跨年/Excel/正式下钻），API初轮6通过；Web专项9通过/1导出按钮自动中文字距定位失败，已补明确aria-label后复验。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。
- 订单事实粒度为整单，品号/交付日期选中订单后订单数量保留该订单正式整单值；计划/执行仍按所选品号范围，不把月计划数量冒充订单字段。

## 等待用户确认
- 无实施等待；最后须真实账号人工验收。

## 下一步
1. 用户真实账号按REV1验收报告检查多选联动、两类日期、工序色板及独立导出；没有明确人工确认前保持等待人工验收。
2. 如会话中断，先看rev1-final-state.json及最终deploy/check日志，最终记录提交已CONSISTENT时不重复部署/测试。
3. 后续按真实反馈修正，不修改业务状态/flags，不推进TASK-002。

## 恢复执行说明
项目AGENTS/两项KDOS Skill → 本节 → git status/diff → 指标合同REV1。REV1已实现并部署fcd5771，最终记录提交如已CONSISTENT只等待人工验收；不重做功能。已部署Chrome为合成API响应，真实账号验收不可冒充；禁止业务写入/flags变化。

---

# Codex 工作进度

## 任务
任务名称：订单分配Excel公式缓存兼容。
任务目标：允许导入业务字段number/text/date统一读取缓存，不执行公式；真实10.14.xlsx解析／预览验收，不修改生产订单。
当前状态：已完成。
最终报告：outputs/PMC_ALLOCATION_FORMULA_CACHE_ACCEPTANCE.md。
最后更新时间：2026-10-15（Asia/Shanghai）。

## 当前阶段
当前阶段：870be11已标准部署、真实预览／浏览器及生产记录不变验收通过。
当前子任务：无业务待办；验收文档随本次提交自动安全推送GitHub。

## 已完成
- [x] 工作区初始干净；部署3ba8f01，GitHub交付b7f6914。
- [x] 根因代码确认：公式仅允许number；date及text后续又直接读取原cell，必须统一使用缓存有效值。

## 正在进行
- [x] 真实87行／2单，435公式原XML均有缓存；旧版本87条S列错误已复现。
- [x] 统一cell.result缓存读取（防止cell.value丢失0/false），text/date/number按原类型归一化；缺失／错误坐标清晰；非业务／禁止金额列不读取。
- [x] 64项解析覆盖纳入完整API106套986项PASS／1既有skip；类型、lint、构建PASS。
- [x] 真PG18共22检查PASS：旧163／33追加回归＋真实10.14的87行缓存落库、同批重试0、另批87全追加及其他历史／通知／归档不变。
- [x] 092518双库及附件备份完成，pg_restore目录／SHA256验证。

## 待完成
- [x] 完整相关回归、必要备份及真实87行解析通过；源码870be11已提交。
- [x] all/check标准部署API/Web870be11，四容器健康；HTTP及Chrome原文件87／2、新增87／修改0／错误0，确认可用后取消。
- [x] 2425条分配全字段及20相关表哈希不变、原文件SHA未变；仅周计划由既有09:30:18入库定时正常更新3条，日志已核实。
- [x] 验收报告／进度完成，源码与交付文档自动安全同步GitHub main。

## 修改文件
- order-allocation.domain.ts、order-allocation.spec.ts、scripts/test-order-allocation-postgres.cjs、运维文档、进度及验收报告。

## 数据库 Migration
- 无；本次只调整解析，不改数据库结构或业务记录。

## 新增或修改测试
- 计划覆盖文本／日期／数字公式缓存、共享公式、缺失／错误坐标、精度非负和忽略非业务公式。

## 已运行测试
- API106套986项／1既有skip、真实PG22检查、API类型／构建／lint PASS；真实文件87／2解析0错、435／435缓存、87已审核、O来源正确。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。
- 无交付阻塞。生产当前87／归档2338未改变；周计划原定时更新3条已记录，不能虚报21表全部不变。

## 等待用户确认
- 无；生产只预览、不确认导入，不修改原文件。

## 下一步
1. 本任务已交付；用户可在原页面上传原文件查看预览后自行确认。
2. 保持既有追加、映射、归档和通知规则；后续新问题按新需求处理。

## 恢复执行说明
项目AGENTS／两项Skill → 本进度 → Git状态／diff；私有证据data/pmc-formula-cache不入Git。原文件/home/Jerry/下载/10.14.xlsx未修改，本次未执行生产import-confirm。运行870be11；当前87／历史归档2338保留，临时令牌及隔离测试容器已清理。

---

# Codex 工作进度

## 任务
任务名称：清空当前订单分配表。
任务目标：按用户要求清除现有分配内容；不擅自删除关联历史计划，保留备份与审计。
当前状态：已完成。
最终报告：outputs/PMC_ALLOCATION_CLEAR_ACCEPTANCE.md。
最后更新时间：2026-10-15（Asia/Shanghai）。

## 当前阶段
当前阶段：3ba8f01标准部署及Migration94生产完成，已归档2338条，数据完整性验证通过。
当前子任务：无业务待办；交付文档随本次提交自动安全推送GitHub。

## 已完成
- [x] 核实当前租户KAINAN、记录总数与月计划稳定ID外键；现有订单分配资源remove=false，无现成清空命令。
- [x] 已说明真实关联影响并询问保留计划归档清空、或先列出物理删除关联范围；未经选择不扩大删除范围。

## 正在进行
- [x] 090620双库及附件备份验证完成；2338分配／2106月计划，另548出货记录关联月计划，所有历史关联保留。
- [x] 上一任务c53d95c供应链映射报告完成并纳入本次GitHub交付。

## 待完成
- [x] 按用户选择完成归档代码、Migration94及21项真PG／945项API验证。
- [x] 3ba8f01标准all/check及94生产迁移成功；真实管理员归档2338条、当前0、过期预览2、审计2338＋1；21表及原业务／金额不变，历史月计划2106／坏FK0。
- [x] 真Chrome当前页“暂无数据”，HTTP列表／Excel导出／字段候选均0；新增／导入保留，供应链→采购部启用，正式规则仍原ON/v4，无5xx。
- [x] 091712双库及附件后备份完成并校验；完整验收报告完成，源码3ba8f01与交付文档自动安全推送GitHub main。

## 修改文件
- Migration94、MasterPlanApplication／Query／FilterSource／Sync只读归档排除、PG集成脚本、运维文档／台账及进度／验收报告。

## 数据库 Migration
- 1722920094000-AllocationArchive.ts：仅新增archived_at及当前记录索引；保留历史ID／FK，已有归档时拒绝down。生产已执行。

## 新增或修改测试
- 真PG归档专项：管理员／租户／快照版本／事务回滚／并发重试、历史／金额／配置／事件不变、列表／导出／两种候选排除、旧预览过期及后续手工／新批追加、禁止不安全迁移回滚。

## 已运行测试
- API完整106套945项通过／1既有skip；最新同步专项2套41项、真PG18共21检查（含真实163／33追加与归档）PASS；API构建／lint／类型PASS。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。
- 已按用户选择归档解决外键依赖；历史计划保留。正式规则在08:53:51已有配置操作设为ON/v4，清空前后未变，归档未产生通知；不得误报当前OFF。

## 等待用户确认
- 无；用户已明确选择保留历史计划、归档并清空当前分配页面。

## 下一步
1. 本任务已交付；当前分配页0条，允许后续手工新增／确认新批次导入。
2. 历史归档保留，后续恢复须按批次审阅，不得全库覆盖后来业务。

## 恢复执行说明
AGENTS／两项KDOS Skill → 本进度 → Git状态／diff。生产已部署3ba8f01并执行94；2338已归档、当前0，历史月计划2106不变。私有证据data/pmc-allocation-clear；临时访问令牌及自建隔离测试容器已清理。不得擅自级联删除历史计划或恢复自动导入／对账，通知规则保持执行前真实ON/v4。

---

# Codex 工作进度

## 任务
任务名称：订单分配供应链映射采购部修复。
任务目标：受控恢复正确采购部映射，初始化异常可见、错误分类准确、组织选项不限五单位；不改变追加导入／通知机制。
当前状态：已完成；已部署验收，GitHub随归档交付同步。
最后更新时间：2026-10-15（Asia/Shanghai）。

## 当前阶段
当前阶段：标准all/check部署及真实预览／浏览器验收通过。
当前子任务：无开发待办；c53d95c已部署，报告outputs/PMC_SUPPLY_CHAIN_MAPPING_ACCEPTANCE.md，随最新任务安全推送。

## 已完成
- [x] 项目规范、两项KDOS Skill、台账、旧进度与Git状态已核实；工作区初始干净，运行38c3c7d／Git文档6867dab。
- [x] KAINAN采购部唯一、启用、名称无差异；组织ID eeca1ae4-15c7-4c26-96d4-bebbc23377b8（计划中心下，企业微信部门6）。organization_units为现有共享组织表，无tenant_id列；业务映射按租户隔离。
- [x] 供应链映射正确指向该组织但enabled=false、version2；审计证明2026-10-15 08:31:19配置操作由true改false，组织ID未变。其他四映射启用；采购接收配置启用；正式通知OFF version3。

## 正在进行
- [x] 083722双库及附件备份完成；原API expectedVersion2仅启用供应链，version3并记录审计，订单／计划／财务／规则哈希一致。
- [x] 初始化返回诊断并启动告警、必要映射缺失／禁用／组织问题分类；动态全组织ID＋完整路径，合法自定义映射不覆盖；保存版本／权限／审计保留。

## 待完成
- [x] API完整106套945项／1既有skip；真PG20检查含新增采购诊断／修复落库／路由、同批幂等与自定义组织；Web完整48文件371项＋最新配置专项7项，类型／构建／lint通过。
- [x] 真实Excel163／33及私有2—5行采购4条预览均0错；真Chrome配置诊断通过，无正式确认／发送；双库及附件后备份085225完成。
- [x] GitHub随当前归档交付自动安全推送；当前部署3ba8f01包含c53d95c修复。

## 修改文件
- c53d95c九文件（配置／领域／预览／Web及测试／文档）；详见验收报告。

## 数据库 Migration
- 暂无需结构迁移，复用现有UUID组织FK、配置版本及审计写入。

## 新增或修改测试
- 计划配置诊断、默认初始化保护、任意合法组织映射、导入错误分类与采购落库／路由、真实Excel预览。

## 已运行测试
- 生产只读组织／映射／配置审计核实PASS；开发验证待运行。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。
- 原seed匹配不唯一时continue无提示，已有禁用映射不覆盖但也不提示；预览WHERE enabled丢失禁用原因；保存与UI组织选项错误限定五单位。

## 等待用户确认
- 无；用户已明确要求供应链必须映射采购部。本次不代用户确认生产导入，不发送真实通知。

## 下一步
1. 备份并用原API version2受控启用供应链正确映射；保留其他映射与组织数据。
2. 实施最小配置诊断／动态组织／预览分类修复，完成相关回归。
3. 标准部署、线上真实预览及只读哈希验收，更新报告并自动安全推送。

## 恢复执行说明
AGENTS／两项Skill → 本进度 → Git状态／diff；私有原始证据data/pmc-supply-chain-mapping（不提交）。上一轮追加批次、仅手工来源和停用下游对账保持。新任务不重构，不重启任何调度策略。

---

# Codex 工作进度

## 任务
任务名称：PMC订单分配数量统一、按批次追加导入及仅手工来源／取消下游对账。
任务目标：O列直接映射allocatedQuantity，删除独立旧量，跨批全新增／同批幂等，保留历史；最新用户要求ERP不写分配、分配后不对账。
当前状态：已完成。
最后更新时间：2026-10-14T22:45:13.526787+08:00。
最终报告：outputs/PMC_ALLOCATION_APPEND_BATCH_ACCEPTANCE.md。

## 当前阶段
当前阶段：已部署并实际验收，源码GitHub已推送。
当前子任务：无；源码和验收文档自动同步，无需用户手动同步。

## 已完成
- [x] 按真实数据库及旧审计核实依赖与来源，210候选修正预览，无人工／未知来源覆盖。
- [x] 来源限制5bf5865、取消对账e8c021a先独立上线；新数据只经获权手工／Excel；配置审计停用、所有对账入口skip、pending不消费。
- [x] 单一数量／缓存公式／23非金额业务字段，模板无覆盖身份及正确列校验、导出批次／姓名／上海时间，通知和权限同口径。
- [x] UUIDv7批次／源行元数据、跨批全追加、同批并发幂等、旧ID版本提示忽略；手动按ID版本编辑。
- [x] 93迁移／退役归档／证据修正／稳定月计划FK、条件回滚；历史全部身份及计划数据保留。
- [x] 940API、368Web、22Contracts、18PG＋历史迁移专项，实际163／33两批326，构建／类型／lint通过。
- [x] 222211／223437／223843三组双库与附件备份，93生产成功，标准all/check、四容器健康、原Dispatcher版本38c3c7d active。
- [x] 生产2301 ID不变：修正210、其余2091原值不变；业务／金额／计划／财务哈希一致、坏FK0。
- [x] 真实Chrome页面／原文件预览163新增、33单、0错误，只预览取消；生产批次0；正式通知仍OFF version3。
- [x] 源码38c3c7dfcf2ea0500e84070ae2c40f6206c8a234安全推送GitHub main，无强推或真实源／密钥入Git。

## 正在进行
- 无。

## 待完成
- 无业务待办。

## 修改文件
- apps/api/src/migrations/1722920093000-AllocationAppendBatches.ts
- apps/api/src/modules/master-plan-system/master-plan-spreadsheet.service.ts
- apps/api/src/modules/master-plan-system/master-plan.application.service.ts
- apps/api/src/modules/master-plan-system/master-plan.config.ts
- apps/api/src/modules/master-plan-system/master-plan.live-projection.spec.ts
- apps/api/src/modules/master-plan-system/master-plan.query.service.ts
- apps/api/src/modules/master-plan-system/master-plan.sync.service.spec.ts
- apps/api/src/modules/master-plan-system/master-plan.sync.service.ts
- apps/api/src/modules/master-plan-system/order-allocation.domain.ts
- apps/api/src/modules/master-plan-system/order-allocation.spec.ts
- apps/web/src/modules/finance/FinanceOrders.spec.tsx
- apps/web/src/modules/master-plan-system/MasterPlanPages.spec.tsx
- apps/web/src/modules/master-plan-system/MasterPlanPages.tsx
- docs/operations/PMC_ORDER_ALLOCATION_NOTIFICATIONS.md
- docs/operations/TASK_REGISTRY.md
- packages/contracts/src/index.ts
- scripts/test-allocation-append-migration.cjs
- scripts/test-order-allocation-postgres.cjs
- outputs/CODEX_PROGRESS.md
- outputs/PMC_ALLOCATION_APPEND_BATCH_ACCEPTANCE.md

## 数据库 Migration
- 1722920093000-AllocationAppendBatches.ts；生产已COMMIT，来源证据／旧值归档、210修正、批次＋行唯一、旧列及旧唯一删除、稳定月计划外键、条件回滚。

## 新增或修改测试
- O列映射／单量模板／公式缓存坐标／重复源行／旧身份忽略，跨批追加／同批并发幂等／手动ID编辑／只读来源／权限租户、模板导出及通知／回滚；历史93 migration脚本；前端批次提示；既有财务重复月份查询修复。

## 已运行测试
- 完整API105套940 PASS／1既有skip，Web48文件368 PASS，Contracts22 PASS。
- 真PG18业务18检查＋历史迁移／条件down-up／追加后拒绝回滚 PASS；163／33源两批326、同批新增0。
- API／Web构建与类型、lint PASS（既有warning）；标准部署check、Chrome及真实数据哈希／FK PASS。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。
- 无本次交付阻塞。老plan-projections的RUNNING／2026-09-29历史字段未重写；配置已停用且全部入口跳过，不代表仍在执行。
- 旧版本未确认预览需重新上传；不同文件／新预览按最新规则追加，正式确认由用户执行。
- 其他原有调度及通知权限维持；未新增任务／监控，未调整员工权限。

## 等待用户确认
- 无交付等待。生产原文件正式导入按用户之前选择，由用户在页面查看预览后确认；本次没有代执行。

## 下一步
1. 本任务已交付；用户在订单分配页面按需手工新增或预览确认导入。
2. 下游对账按最新要求保持取消，重新启用需要新的明确需求。

## 恢复执行说明
项目AGENTS／两项KDOS Skill → 本进度／验收报告 → Git status/diff → 按新需求维护。运行代码38c3c7d，GitHub main含源码及验收文档；私有证据data/pmc-batch-import不提交。原始ERP文件/home/Jerry/下载/10.13.xlsx。不要重做已通过的实现／迁移，不删除历史记录，不回退旧自动导入／对账入口。

---

# Codex 工作进度

## 任务
任务名称：订单分配附件中文文件名与Sheet名称小范围调整。
任务目标：北京时间YYMMDDHHMMSS＋实际身份名称，冲突/分片标识，重试复用原文件；固定新增订单/变更订单/字段变更明细；测试备份标准部署安全推送。
当前状态：已完成（523cf91已部署及安全推送，中文文件实际收件/三工作表打开已确认）。
最后更新时间：2026-10-14T17:09:04.704243+08:00。

## 当前阶段
当前阶段：已交付。
当前子任务：无；下一任务为用户新附件的数量统一与按批次追加导入。

## 已完成
- [x] 读取AGENTS、两项KDOS Skill、调度台账及已有交付进度；根main干净且与GitHub一致，运行基线235cd16。
- [x] 已核实三个必要修改点：附件生成、HTTP下载头、Dispatcher现有英文文件名校验；分类和事务触发机制沿用。

## 正在进行
- [x] 最小源码及中文HTTP/Dispatcher兼容已实现；五套53项API专项、Python9项、构建/类型/lint通过。
- [x] PG18 fresh92迁移＋15业务场景共16检查PASS，含同秒/同名碰撞、混合新增/变更分类、字段差异、重试原名、四触发入口与原权限/RLS。
- [x] 完整API105套931通过/1既有skip；所有专项、PG、Python及构建/类型/lint通过。
- [x] 标准all/check部署、原Dispatcher更新、四容器健康、线上唯一员工中文附件投递及用户实际确认。
- [x] 170904/172744双库/私有附件备份，正式规则审计停用version3，原timer/cron/n8n不变，源码GitHub已推送。

## 待完成
- 无本次命名任务待办；报告outputs/PMC_ALLOCATION_ATTACHMENT_NAMING_ACCEPTANCE.md。

## 修改文件
- OrderAllocationDelivery、内部附件Controller、Dispatcher（三个生产文件）。
- API订单分配/内部HTTP测试、PG集成脚本、Dispatcher测试（四个验证文件）。
- 订单分配运维文档、TASK_REGISTRY、outputs/CODEX_PROGRESS.md。

## 数据库 Migration
- 无；本次不改数据库结构。

## 新增或修改测试
- 文件名/身份/北京时间/冲突/分片；混合新增变更三Sheet；HTTP中文响应头与Dispatcher中文文件/路径安全；PG重试原文件名和既有触发机制。

## 已运行测试
- API五套53项通过、Python9项通过，API依赖构建/类型与lint通过；PG共16检查通过；正式规则已审计恢复停用version3；升级前双库/私有附件备份170904验证完成。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。
- 本次验收窗口出现独立生产导入和既有ERP对账，分配表全局哈希发生变化；财务/客户/旧规则哈希相同，来源证据留私有目录。
- 原中文响应头/英文正则兼容已修复。
- 线上正式规则核实为已启用version2，按用户本次要求经既有审计管理接口恢复停用version3；没有修改通知触发或ERP调度。

## 等待用户确认
- 无；用户确认中文文件名正确，三个工作表可打开；正式规则停用。

## 下一步
1. 本次命名调整已完成，按最新数量字段/追加批次任务继续。
2. 最新业务结构审计须重新核实，不能沿用上轮唯一键/数量映射。

## 恢复执行说明
项目AGENTS/Skill → 本进度 → git status/diff → 下一步；根main已安全同步，历史记录保留，不重复实现。

---

# Codex 工作进度

## 任务
任务名称：PMC订单分配ERP原始Excel导入与企业微信文本/文件通知。
任务目标：原始文件预览确认、五单位映射/接收配置、事务批次与精确路由、文本/私有Excel独立失败重试、测试备份部署真实验收并自动推送。
当前状态：已完成（已部署、实际收件验收通过、GitHub main已自动推送）。
最后更新时间：2026-10-14T16:34:09+08:00。
最终报告：outputs/PMC_ORDER_ALLOCATION_ACCEPTANCE.md。

## 当前阶段
当前阶段：已交付。
当前子任务：无；生产正式导入按用户明确选择由用户在页面确认。

## 已完成
- [x] 两项KDOS Skill、项目边界规范和调度台账；原文件真实结构163条/33单、空白量与金额字段核实。
- [x] 原始Excel24非金额字段导入/预览/双业务键/并发/空值与人工维护保护；四入口事务事件、无变化不发。
- [x] 专用配置页面、五精确映射和五接收单位、唯一默认停用规则、同名业务员精确全接收及用户/行去重。
- [x] 三工作表私有Excel、分片、文本与文件独立日志/重试、共享WeChatPusher文件接口与持久成功回执。
- [x] migration92生产成功；升级前与实际投递后的双库/私有上传/成功回执备份，权限/目录/SHA核验。
- [x] 完整及专项回归、真PG权限与回滚、原文件隔离导入重放、最终生产预览、真实Chrome桌面验收。
- [x] 仅崔玮杰08134真实测试一条文本与一个Excel；接口成功，用户确认收到且三个工作表可打开。
- [x] 最终1684分配键/金额、106648财务品项、140财务客户对应、3PMC对应和1旧消息规则基线哈希相同。
- [x] 源码/部署/GitHub main：235cd16907be7d5f5cee5efb11dce94b9dbc91dc；四容器healthy，Dispatcher active；原任务调度状态/cron未改。
- [x] 根目录用户未提交FinanceOrders.spec与真实财务outputs保留；使用安全worktree提交推送，业务附件/密钥未入Git。
- [x] 隔离测试容器已移除，临时维护token文件已清理，最终线上health与远端SHA复核PASS。

## 正在进行
- 无。

## 待完成
- 无开发或交付待办。

## 修改文件
- 根目录outputs/CODEX_PROGRESS.md及outputs/PMC_ORDER_ALLOCATION_ACCEPTANCE.md（本地恢复/验收记录）。
- 安全源码worktree共38文件，完整清单见最终报告；领域/解析/配置/迁移/Application事务/投影保护/通知/Dispatcher/配置UI/消息中心/Contracts/测试/部署备份脚本/运维文档。

## 数据库 Migration
- 92：1722920092000-OrderAllocationImportNotifications.ts；非金额订单字段、序号约束、人工维护、users tenant、映射/接收配置、组件/私有附件与RLS。生产已应用。

## 新增或修改测试
- API解析与事务/通知注册、ConfigPage/PMC/消息中心、真实PostgreSQL18集成脚本、Python组件与回执；财务异步等待测试单独提交。

## 已运行测试
- API105套924通过/1既有skip，最终专项6套74；Contracts22；Python8。
- Web47文件361通过＋财务文件隔离6通过=48文件367项覆盖，最终专项3文件38通过；API/Web构建、类型与lint通过，既有warning保留。
- PG全92fresh迁移＋14业务场景=15检查通过：真实163/33导入重放、四入口、事务回滚、RLS、范围权限、保留人工量/金额、组件失败独立重试。
- 最终线上版本235cd16：真实预览新增163/33、0错误/冲突；桌面Chrome、普通用户403/匿名401、实际唯一员工收件与打开三工作表PASS。
- 备份150723及162945、pg_restore目录/SHA/0600/私有上传和成功回执PASS；最终生产基线不变、GitHub远端SHA匹配。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。
- 既有plan-projections自2026-09-29残留RUNNING；未改其状态/周期，需独立运维处理。
- 原PMC外壳min-width1180px；桌面PASS，390px移动视口不宣称自适应PASS。
- 五单位接收配置初始为空、正式规则停用，使用前由管理员配置；实际预览有3个配置提醒。

## 等待用户确认
- 无交付验收等待；实际企业微信收件及三Sheet已用户确认。
- 正式163条生产导入由用户在页面查看预览后确认（用户明确选择），本轮未代执行。

## 下一步
1. 用户在订单分配页面预览并确认正式导入；需要正式通知时先配置接收人/启用规则。
2. 后续新任务按最终报告和当前源码继续，无需手工GitHub同步。

## 恢复执行说明
AGENTS/Skill → 本根进度文件 → 两处git status/diff → 最终报告；不重复实现。
安全源码目录：/data/automation/code/work/PMC/knweb/data/worktrees/pmc-order-allocation；分支codex/pmc-order-allocation-notify-20261014。
根本地main包含真实财务outputs历史，不直接push；根用户未提交财务测试保留。
.env留原运行根目录；业务原Excel/私有截图/验收data不得提交。

---

# Codex 工作进度

## 任务
任务名称：财务订单级预交货日改为最早有效日期。
任务目标：MIN非空有效品项日期；保留全部品项原始日期，金额/订单数/大屏金额不变；测试备份部署实际核验并自动推送GitHub。
当前状态：MIN代码已部署c15f017；612日期修正及不变性验收通过；用户重整历史后以安全源码commit 671ff4caa475df61d0d8004f54cd87103ea1fcd5推送github/main；报告待补齐。
最后更新时间：2026-10-14（Asia/Shanghai）。

## 当前阶段
当前阶段：核对线上基线及最小视图迁移。
当前子任务：记录254张2026订单及全部历史的日期/金额不变基线。

## 已完成
- [x] 读取项目AGENTS、现有主进度、财务规格与两项Skill/调度台账；git fetch确认github/main=e35d453，无未提交源码，旧outputs原样保留。

## 正在进行
- [x] 线上基线：2026待修254，2025待修358，总612；106648源品项，所有订单非日期字段/原始整行/品项审计哈希及两年大屏/全部排名已保存私有data。
- [x] 91视图仅MIN日期，旧90不改；不刷新E10/不改品项；DATE字符串避免UTC跨日；UI显示最早日期/多交期说明，9中文列保留。
- [x] PG20统计场景含90→91既有数据修正、原行与全部财务维度不变、down/up/重跑、NULL混合/全NULL/重复/反序/筛选/Excel/租户权限；原财务PG20/fresh91全迁移/Nest启动通过。
- [x] Web47文件364通过，专项6，API/Web构建和lint通过（原Web warning）；最终API修正后再回归中。
- [x] 102344双库/上传备份及SHA/custom目录/0600确认；原调度盘点完成，无改动。

## 待完成
- [x] API104套911通过/1既有skip，Web47文件364通过；PG20+20/fresh91全迁移+Nest/Chrome9/构建/lint通过（既有warning）。
- [x] 仅91生产迁移，standard deploy all/check及health PASS，Repo/API/Web/Worker=c15f017，4服务healthy。
- [x] 全18810订单日期逐一核对MIN正确；2026修254、2025修358，原106648品项整行/订单非日期字段/品项审计hash全部一致；月度18804订单/1099941533.42元不变。
- [x] 2025/2026所有大屏JSON维度、KPI、占比和全部排名规范化逐项完全相同；真实API612日期YYYY-MM-DD/筛选/9列Excel/真实Chrome1440与390 PASS。
- [x] 原8用户timer启用状态/cron数量/10n8n激活ID集合未变；隔离测试容器已移除。
- [ ] GitHub推送及报告。

## 修改文件
- outputs/CODEX_PROGRESS.md。

## 数据库 Migration
- 拟新增FinanceE10EarliestDeliveryDate1722920091000，不改已应用89/90。

## 新增或修改测试
- 拟覆盖多日期MIN、NULL混合、全部NULL、原始日期/金额/数量/大屏不变。

## 已运行测试
- 尚无本轮测试。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。
- 254是当前2026年度数；全历史规则也须一致，实际数量先核查。

## 等待用户确认
- 无。

## 下一步
1. 核对GitHub远端SHA=c15f017038cc2905fbf61acd7bf6485653aa05ec。
2. 完成outputs/FINANCE_ORDER_EARLIEST_DELIVERY_ACCEPTANCE.md及本进度已完成状态，移除临时维护token。

## 恢复执行说明
AGENTS/Skill→本段→git status/diff→继续下一步；不重新初始化、不触发ERP刷新、不改调度、不提交真实数据。

---

# Codex 工作进度

## 任务
任务名称：财务中心 E10 销售订单统计（2025年至今）。
任务目标：核实真实E10字段与历史，直连初始化，交付系统导出/月度数据/统计大屏，测试备份部署验收并自动推送GitHub。
当前状态：**已完成 / 已部署 / 真实验收PASS / GitHub已推送**。
最后更新时间：2026-10-14 10:10:59（Asia/Shanghai）。
源码/部署/远端完整版本：e35d453154482fbd62863db346f776a425582d2b；github/main，本轮5个commit均已推送，无强推。

## 当前阶段
当前阶段：已交付。
当前子任务：无。

## 已完成
- [x] 根AGENTS、架构/安全/runbook/integration、表单和调度Skill/台账、最新财务规格已读取；先快进GitHub最新需求c54b4dc，再真实只读核实E10字段/视图/历史及ERP已有部分历史不足。
- [x] 实际34字段/税含义/本位币/Join/UUID稳定键已核实并形成统一映射；既有basic_code.MSSQLDatabase只读直连，不复制凭据、不修改E10或原ERP任务，无Excel导入。
- [x] 原34列系统导出、9列月度数据、完整统计大屏/客户10-20-全部排名/12个月/金额占比/KPI/交叉矩阵/待分类/筛选与下钻完成；完整客户编号+租户精确JOIN现有财务对应表，分类差异0，原138条保持。
- [x] Application显式全量/增量/断点、独立源年度COUNT/SUM、事务发布/变化前后审计、UUIDv7/FORCE RLS/权限/类型化金额数据范围/锁/失败保护完成；保留已有架构及公共表格/图表。
- [x] 最新用户确认交期冲突整单金额保留、日期NULL并标冲突已实施；新增90迁移，不修改已应用89。
- [x] 真实全量214页106648品项初始化成功；源2025：60332行/10142有品项单/592274631.13元，2026：46316行/8668有品项单/507757600.79元，最大订单日2026-10-14；查询含2025-01-01，实际2025首单01-02。
- [x] 所有维度/完整客户排名/筛选年度月度精确勾稽；有效统计18804单1099941533.42元；612交期冲突金额157947349.71保留、非NULL冲突日期0；6交货计划缺失单90698.50暂缓并明确报告；10负金额保留异常，24无品项头仅来源覆盖摘要。
- [x] 真实全量重读106648行/变化0，总额/版本/品项审计未变；增量初测0行，最终增量28行28变化成功；独立最后源SQL再次核对全品项/单数/金额一致；重复源键0、成功临时页0。
- [x] 实际4个xlsx导出、ZIP/XML逐行校验PASS：34列106648行1100032231.92元；9列18804行1099941533.42元、612交期空格；2025排名184行592244440.13元；2026排名193行507697093.29元。保留精确十进制字符串，非公共4位小数截断。
- [x] API104套911通过/1原skip，Web47文件364通过；新PG19/原PG20/fresh90迁移+Nest，Python3、Chrome合成角色9通过；TypeScript/lint/build通过，原警告保留。
- [x] 最终真实Chrome三页34/9表头、批次、3图表/12月、冲突提示、客户与饼图真实点击下钻、1440/390布局/无API500通过。实际非财务用户5端点403、匿名401，未改密码/账号权限；短期维护JWT不冒称密码登录。
- [x] 备份090409/092814/093848及最终真实初始化后095205双库/上传，custom dump目录/SHA/0600通过；回滚before和initialized镜像保留。
- [x] 生产89+90 TypeORM迁移成功，既有18个KDOS SQL迁移SKIP/校验一致；standard deploy all及check、健康通过，Repository/API/Web/Worker版本一致，四服务healthy、Dispatcher保留、PG18原卷与15433保留。
- [x] 原15张财务客户/PMC/Knowledge完整行哈希及数量一致；原8个KDOS用户timer启用/active状态、cron数量、10个n8n激活ID集合保持；仓库timer4/service6定义未增加。FIN-002仅手动入口，台账更新；临时PG测试容器已移除。
- [x] 35源码/测试/文档安全提交ce891b6、1478962、5e8a8f8、e0059d0、e35d453，已push github main且远端完整SHA相同。真实财务数据/Excel/备份/凭据/本轮outputs不提交。

## 正在进行
- 无。

## 待完成
- 无本轮开发或部署遗留。

## 修改文件
- apps/api/src/common/filtering/data-scope.ts
- apps/api/src/common/filtering/table-filter-registry.spec.ts
- apps/api/src/common/filtering/table-filter.controller.ts
- apps/api/src/common/filtering/table-filter.registry.ts
- apps/api/src/common/printing/streaming-workbook.ts
- apps/api/src/common/printing/table-print.service.spec.ts
- apps/api/src/common/printing/table-print.service.ts
- apps/api/src/integrations/e10/finance-order.reader.ts
- apps/api/src/migrations/1722920089000-FinanceE10Analytics.ts
- apps/api/src/migrations/1722920090000-FinanceE10DeliveryDateConflicts.ts
- apps/api/src/modules/finance/finance-orders.application.service.ts
- apps/api/src/modules/finance/finance-orders.controller.ts
- apps/api/src/modules/finance/finance-orders.query.service.ts
- apps/api/src/modules/finance/finance-orders.spec.ts
- apps/api/src/modules/finance/finance-orders.types.ts
- apps/api/src/modules/finance/finance.module.ts
- apps/web/e2e/finance-orders-ui.spec.ts
- apps/web/src/App.tsx
- apps/web/src/modules/finance/FinanceCustomerMappings.tsx
- apps/web/src/modules/finance/FinanceOrders.spec.tsx
- apps/web/src/modules/finance/FinanceOrders.tsx
- apps/web/src/modules/finance/finance-orders.css
- apps/web/src/modules/portal/ModulePortal.tsx
- apps/web/src/shared/charts/KdosChart.spec.tsx
- apps/web/src/shared/charts/KdosChart.tsx
- data-operations/e10/finance_order_reader.py
- data-operations/e10/test_finance_order_reader.py
- docs/finance/ERP_ORDER_ANALYTICS_IMPLEMENTATION.md
- docs/finance/ERP_ORDER_ANALYTICS_SPEC.md
- docs/operations/TASK_REGISTRY.md
- packages/contracts/src/finance-order-fields.json
- packages/contracts/src/finance-orders.ts
- packages/contracts/src/index.ts
- scripts/test-finance-orders-postgres.cjs
- scripts/test-finance-postgres.cjs

- outputs/CODEX_PROGRESS.md、outputs/FINANCE_E10_ORDER_ANALYTICS_ACCEPTANCE.md及本机验收日志/JSON（未推送；金融数据留本机）。

## 数据库 Migration
- FinanceE10Analytics1722920089000：新增财务源读模型/批次/暂存页及RLS视图，已生产应用。
- FinanceE10DeliveryDateConflicts1722920090000：按用户确认保留多交期订单金额，日期NULL和冲突标记，已生产应用。
- 不变更旧ERP/PMC/客户映射结构及源E10；down拒绝删除财务历史。

## 新增或修改测试
- 34/9中文契约、边界、金额与分类、权限/跨租户/类型化数据范围、幂等/失败/断点/变化审计、并发、聚合/排名、流式导出空格/8位小数/超安全整数精度、Web/公共图表/Chrome/真实隔离PG/Python。

## 已运行测试
结果：全部本轮必需验证通过，API1个既有skip；完整证据和实际数据表见最终报告。首次生产导入0页0行失败已修复工具包顶层额外依赖入口，无数据发布/凭据复制/新增依赖；后续实际各批次成功。早期测试不正确--过滤造成非预期广测及超时，已停止本轮进程，用正确exec及限并发完整复验，不改断言。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。
- 真实E106单缺交货计划90698.50暂缓统计并列异常，原始值NULL，不隐瞒差额；612交期冲突按用户确认金额保留。
- 真实财务编辑/只读独立账号密码登录未执行；维护会话、实际权限拒绝、隔离PG及合成角色覆盖明确记录，不声称该生产登录验收。
- 本轮无未解决代码/部署故障；后续ERP主档更名不更新订单修改日期或源删除须手动全量复核。

## 等待用户确认
- 无。

## 下一步
- 无必需执行遗留；如新增反馈，读取本进度和报告后处理，不重做已验收实现。

## 恢复执行说明
读取适用AGENTS/Skill→本进度→git status/diff→新反馈；保留历史业务/任务及源数据，不提交本机金融明细/Excel/凭据；不会自动新增周期任务。

最终报告：outputs/FINANCE_E10_ORDER_ANALYTICS_ACCEPTANCE.md。
实际xlsx：data/finance-order-acceptance/（目录0700、文件0600，ignored）。

---

# Codex 工作进度

## 当前任务：财务中心 Phase 1 客户对应表

任务名称：独立财务客户分类及日期受限E10增量新增。
任务目标：财务中心→基础数据→客户对应表；保留本次上传138条，未来仅CreateDate或LastModifiedDate严格晚于2026-10-12的客户新增；不改PMC映射。
当前状态：**已完成 / 已部署 / PASS**。
最后更新时间：2026-10-13 10:14（Asia/Shanghai）。

当前阶段：最终交付；当前子任务：无。
已完成：完整读取MD和两份种子、规范/技能/前轮进度/Git恢复审查；实际验证E10_6.0.0.1.NEW.CHS.dbo.CUSTOMER.CUSTOMER_CODE及CreateDate/LastModifiedDate，未用订单集合或SETUP_DATE。
已完成实现：独立finance客户及同步日志、租户RLS/FORCE/显式tenant、UUIDv7和用户外键、版本409/审计、分类字段白名单；公共表格/FilterGroup/导出/权限管理；Finance Portal排序契约及无权入口隐藏；单user systemd timer。
已完成用户追加范围：原609全主档补齐方案取消，另外471条从未提交（早期审计错误导致整事务回滚）。当前实际仅138初始客户/138唯一/待分类0；83/7/48、内49外89、A140业务一部内销均核验。未来合格新编号两分类NULL，不覆盖/删除既有记录。
截止日说明：可选边界问题无答复，已告知按严格晚于12日的2026-10-13零点实现；唯一finance-sync-policy.json被Python源SQL和后端验证共用，拒绝过早/缺失/非法/UTC转换源日期。当前实际合格源0。若用户要求含12日，再按新指令改策略、验证部署，未将该解释伪称为用户回答。
已完成测试：最终API103suite/900通过/1既有skip；专项46；Web46文件357/专项7；Contracts22；Python5；财务Chrome4角色、KnowledgeChrome17/1原凭据门控skip；独立Postgres18真实20检查及87完整fresh迁移/full Nest，含旧审计CHECK同步成功/失败；typecheck/lint/build通过，仅既有警告。
已完成备份：20261013_093503双库custom及uploads含.private，pg_restore目录/SHA256/0600复核通过。既有KDOS18 SQL迁移均SKIP。
已完成迁移：FinanceCustomerMappings1722920088000仅新建finance_customer_mappings/finance_customer_sync_runs，不改旧表。
已完成部署：./scripts/deploy.sh all及check；HEAD/Web/API/Worker **c69e5199cbc6c8a955d301b3ba72175354b3e008** 一致；四服务healthy、Dispatcher active；原PG18、mount、postgres:5432内部连接与127.0.0.1:15433保留。
已完成实际日任务：10:00:49 SUCCESS read0/create0/skip0；10:02:07重跑SUCCESS/repeated，ExecMainStatus0；timer active，下一次2026-10-14 01:00 CST，Linger=yes；尚未经过下一日自动触发。专用有限scope key仅ignored data/finance-customer-sync.env 0600，不改账号权限。初始种子实际138新建；重跑幂等实际0新增，原逻辑批次返回created138/repeated=true，未误算新建。
已完成真实浏览器：管理员6组PASS（入口/只读编号/A140同值保存/待分类0/服务端筛选/实际138全量xlsx/原权限入口）；普通员工2组PASS登录及现有无权状态，入口隐藏、页面拒绝、list/export/patch403。未给员工授权；生产财务只读/编辑专用账号正向未测，隔离及模拟真实Chrome角色覆盖。
已完成完整性：原PMC3映射及14张Knowledge表逐行完整哈希/数量完全一致，系统actor仍disabled。生产无测试客户/未写E10；A140仅保存原值，版本/审计按设计保留。隔离临时库0残留，专用测试容器已停并移除。
正在进行：无。
待完成：无本轮实现/部署遗留；日期可选澄清不是已确认答案，人工财务账号验收列明边界。
修改文件：28个相关源码/测试/配置/种子文件，完整清单见报告；outputs进度/报告/安全JSON、日志及实际xlsx。不提交runtime secret。
数据库 Migration：1个新增TypeORM migration，无旧结构变更、无E10变更。
新增npm/Python依赖：无。
新增或修改测试：财务/API日期与字段/权限/种子、Python重试/源SQL、跨模块注册/Auth排序、财务Web/Chrome、独立真实PG和fresh全schema。
已运行测试：上述全部通过，最终结果以报告和安全证据为准。
当前已知问题：无未解决功能或运行异常。早期system审计来源23514已改为合法api+原禁用系统UUID，原CHECK保留、真实完整schema及服务重跑证明；pending合并、Portal allowlist和测试执行器路径/语言/图标/空列表/自建Vite并发定位均已解决。
等待用户确认：无必需审批；“含12日”可选解释未答，明确采用严格13日起。
下一步：无执行遗留；按FINANCE_CUSTOMER_MAPPING_ACCEPTANCE.md人工步骤使用财务中心；未来数据修改按新指令处理。
恢复执行说明：规范→技能→本段→git status/diff→新增反馈，不重做旧Knowledge任务、不向138表补入历史全主档、不删除财务/PMC数据。
最终报告：outputs/FINANCE_CUSTOMER_MAPPING_ACCEPTANCE.md。
实际Excel：outputs/finance_customer_mappings_2026-10-13.xlsx（138行，英文下载名）。
源码提交：9542808、57f47f0、c69e519，未push；outputs证据留工作区。

---

## 当前任务：Knowledge统一知识目录

任务名称：Knowledge门户与管理统一列表/面包屑，消除重复目录导航。
任务目标：移除门户左树与管理双树；保留文件夹层级、历史parentId访问、位置选择器、权限及受控布局。
当前状态：已完成 / 已上线管理员验收通过。开始HEAD：bc3725f；最终HEAD/Web：468af4dd88f0a7b1723d2a0202ee06932b2040ed。
最后更新时间：2026-10-12 20:43（Asia/Shanghai）。
当前阶段：最终交付完成；当前子任务：无。
已完成：规范/技能/进度/Git与实现审查；共享FolderContents增加获权parentId分支/子页/阅读/面包屑，Portal删除左双树及重复根查询，管理转顶部操作，AGENTS记录未来一对象一导航原则；位置选择器不移除。
已完成验证：Web45文件350项、Chrome17项通过/1既有凭据门控skip，包含三角色/105条/1920至320px/历史/Autosave发布/V1V2/表单位置树；typecheck/lint/build通过，仅原告警。新增11项专项，定向59通过。
已完成备份：20261012_200439双库custom dumps及uploads含.private，pg_restore目录、三个SHA256/600权限复核通过，原Web镜像保留。
源码提交：468af4d（9个相关源码/测试/用户规范文件，未push）；outputs记录留工作区。
已完成部署：./scripts/deploy.sh web返回0；HEAD/Web=468af4d，API/Worker=7456a4c（源不变/未重建）。四服务healthy、Dispatcher active，无数据库或运行配置改动。
已完成管理员真实Chrome：8组+1严格PDF绘制专项通过；三级目录、私有PDF画布/原件SHA、文件/历史parentId读取与返回、管理员单目录顶栏、1920/1440/390实际布局。共4个自建页面/3文件夹按ID和前缀及创建人保护清理；墓碑/幂等/审计保留，不改已有ACL或账号。
已完成员工真实验证：登录/权限验证通过，空间API200但页面403，前端拒绝/管理入口隐藏通过；该账号生产正向读取NOT_TESTED，不修改授权。独立生产编辑账号未登录，角色自动化覆盖。
已完成完整性：14张Knowledge表每条原有记录完整行MD5均保留；原页面5/版本3/文件4/预览3等不变，新增3目录墓碑及2上传幂等和审计为设计保留，cleanupPending=0。
正在进行：无。
待完成：无本轮开发/部署遗留。
修改文件：AGENTS、KnowledgePortal/Pages/Folders及样式、Portal/Pages测试、新Navigation测试、knowledge-ui E2E；完整清单见报告。
数据库 Migration：无；API/权限模型/草稿/发布/历史/存储/依赖：无改动。
新增或修改测试：11项导航专项、三角色Chrome用例、分页/六宽度/位置表单及发布真实状态回归。
已运行测试：Web350/Chrome17通过（1门控skip），Web质量/构建通过；真实管理员8+1、员工登录/权限拒绝、完整性/备份/部署/最终健康通过。
当前已知问题：无未解决实现或运行故障；生产员工现有页面读权限不足及独立编辑真实登录未执行，不声称正向通过。初次员工检查只判断空间200导致等待失败，按实际页面403完善验收分支后通过；未改产品授权。开发期测试标签定位/旧左树断言/TS问题均纠正。
等待用户确认：无；本轮不修改员工权限。
下一步：无执行遗留；按报告人工复验主列表/面包屑/历史子页及表单位置选择器。
恢复执行说明：规范→本段→Git/diff→新的反馈，保留前轮SQL/模板/权限成果及历史资料。
最终报告：outputs/KNOWLEDGE_NAVIGATION_SIMPLIFICATION_ACCEPTANCE.md。

---

## 当前任务：Knowledge历史目录SQL别名修复

任务名称：Knowledge管理页面legacyOnly Internal server error最小修复。
任务目标：完整标识符别名替换，不改ACL/租户/发布/历史模型；真实隔离PostgreSQL、生产管理员人力资源→考勤制度验收。
当前状态：已完成 / 已部署验收通过。开始HEAD：b1b8447；最终HEAD/API/Worker：7456a4c1eedfdc8abee928b56481006f25630b14。
最后更新时间：2026-10-12 13:50（Asia/Shanghai）。
当前阶段：最终交付完成；当前子任务：无。
已完成审查：规范/技能/进度/Git、Query/ACL/历史/既有验证器；legacyOnly全局published替换误写ancestor_published引用，JOIN仍原别名；同文件historic替换同步加边界，搜索词转义非别名不改。
已完成实现：生产代码仅list record/published及historic published三个正则增加\b；不调整SQL条件/ACL/租户/发布/模型/API/UI。
已完成真实SQL：独立PostgreSQL18 network none/tmpfs/无端口及生产卷，123组真实场景、86既有fresh migrations通过；新增5组含双模式/有无历史子页/草稿隔离/ACL/字段范围/租户。标准runner删除两个带前缀临时库，残留0；测试容器已停止移除。
已完成备份：20261012_133754双库custom dumps及uploads含.private，pg_restore目录、三个SHA256、600权限复核通过；原API/Worker b1b8447镜像标记保留。
源码提交：7456a4c（3个相关源码/测试文件，未push）；outputs记录保持工作区。
已完成部署：./scripts/deploy.sh api返回0；HEAD/API/Worker一致7456a4c；Web仍ca0d7d7（源不变/未重建），四服务healthy，Dispatcher active，原PG/mount/端口保留，无生产migration。
已完成真实管理员Chrome：6组通过，实际选择人力资源→考勤制度，published/working切换及根目录/文件夹四种legacyOnly请求200，无Internal server error及业务500。凭据仅运行时无输出/录制，已logout；无生产业务或权限写入。
已完成完整性：只读14表记录数及完整行MD5指纹部署前后一致，HR页面/文件夹元数据一致；新容器日志受影响别名错误0。
正在进行：无。
待完成：无本轮开发、测试或上线遗留。
修改文件：knowledge.query.service.ts、knowledge.legacy-tree.spec.ts、knowledge.folders.database-validation.ts；进度/验收报告/安全JSON证据。
数据库 Migration：无；新依赖/API/权限模型：无变更。
新增或修改测试：5项完整SQL单元（布尔/字符串legacyOnly、双模式、管理员/受限成员、子分支/普通列表、working权限）及5组真实PG场景；既有全部Knowledge数据库回归保留。
已运行测试：API102套875项通过/1既有skip；API typecheck/lint/build通过；独立PG123场景/86既有迁移、Docker构建/部署/healthcheck、Chrome6组、14表完整性通过。
当前已知问题：无未解决异常。初次测试类型数组未as const及原搜索natural GIN计划断言已解决：仅临时隔离运行器在EXPLAIN前正常清理新GIN pending list，最终自然planner选GIN；不修改生产配置/查询/优化器或测试断言。普通员工生产登录未执行，权限受限/RLS真实隔离覆盖，不声称员工生产通过。
等待用户确认：无。
下一步：无执行遗留；按报告人工复验“人力资源→考勤制度”。
恢复执行说明：规范→本段→Git/diff→新的反馈；保持前轮Equipment/Knowledge/审计成果，不重做或删除历史资料。
最终报告：outputs/KNOWLEDGE_LEGACY_TREE_FIX.md。

---

## 当前任务：设备状态模板故障原因下拉

任务名称：设备状态填报 Excel 模板故障原因字典下拉。
任务目标：模板与页面/导入/保存共用启用的 equipmentFaultReason 字典；保留表头、业务校验和权限。
当前状态：已完成 / 已上线验收通过。开始HEAD：7c3e088；最终HEAD/API/Worker：b1b844704c6553ae5ea328724eb019a85e6ee708。
最后更新时间：2026-10-12 13:22（Asia/Shanghai）。
当前阶段：最终交付完成；当前子任务：无。
已完成：规范/技能/进度/Git及现有模板/页面/preview/saveStatus/导入检查；原SQL抽取faultReasonOptions()供页面/模板共用；veryHidden数据字典、EquipmentFaultReasons命名区域、单个I2:I2000列表校验、允许留空。
已完成修正：实际XML发现ExcelJS逐单元格序列化重叠范围，改用其范围API并补XML单范围测试；最终文件检查无重叠、无空白数据行。
已完成备份：20261012_130731双库custom dumps+uploads（含.private），pg_restore目录、三个SHA256复核/600权限通过；原API与Worker镜像已保留回滚。
源码提交：74203e8、b1b8447，共4个相关源码/测试文件，未push；outputs记录留工作区。
已完成部署：标准./scripts/deploy.sh api返回0；HEAD/API/Worker一致b1b8447，Web保留ca0d7d7（源码不变/未重建）。四服务healthy，Dispatcher active，原PG容器/mount/内部postgres:5432连接不变。
已完成真实验收：管理员Chrome3组通过：登录/权限、页面导出模板HTTP200、页面与模板当前5字典一致及I2:I2000全部单元格；最终ZIP/XML仅1个校验范围、veryHidden及A2:A6命名引用正确；无凭据记录、按logout结束、无业务/字典/账号权限修改。
正在进行：无。
待完成：无本轮开发/部署/验收遗留。
修改文件：equipment-export.service.ts/spec.ts、equipment.query.service.ts/spec.ts；本进度/验收报告/安全JSON证据及实际xlsx模板。
数据库 Migration：无；API契约/后端业务校验/新增依赖：无。
新增或修改测试：6项专项；全范围校验/单范围XML、实时启用/停用/新增字典与页面一致、空字典、含辅助表和空行的模板填报导入、Query过滤/排序/无缓存；原下载权限/表头测试保留。
已运行测试：最终API101套870项通过/1既有skip；API typecheck/lint/build均通过；最终Docker构建/标准部署、healthcheck、真实Chrome3组、OpenXML及未登录401通过。首轮中文引用引号断言/脚本精确图标名称定位已修正，不是未解决问题。
当前已知问题：无未解决运行异常。桌面Excel/WPS人工点击未执行；生产未为验收新增/停用字典或提交导入，动态字典和导入由自动化覆盖。
等待用户确认：无。
下一步：无执行遗留；用户可按报告人工复验下载的模板及故障原因下拉。
恢复执行说明：规范→本段→Git/diff→新的反馈；保持本轮/前轮记录，不重做Knowledge/审计。
最终报告：outputs/EQUIPMENT_FAULT_REASON_TEMPLATE_ACCEPTANCE.md。
实际模板：outputs/equipment_status_template_2026-10-12.xlsx。

---

## 当前任务：Knowledge权限入口优化

任务名称：Knowledge管理工作台权限入口名称与布局。
任务目标：空间操作权限、页面与文件操作权限分开；成员与权限复用KnowledgeAccess；不改权限模型/API/数据库。
当前状态：已完成 / 已上线验证通过。开始HEAD：e498473a1930b7683262982577225d0f8d451bdc；结束/部署Web HEAD：ca0d7d7d9ab99aaf0eadf076aed443525826c482。
最后更新时间：2026-10-12 13:00（Asia/Shanghai）。
当前阶段：最终交付完成；当前子任务：无。
已完成：AGENTS、技能权限规则、既有进度、Git、Settings/Management/Access/公共按钮和测试检查；工作区仅前轮outputs修改，保持原样。
实际发现：Settings显式两个权限按钮，KdosDataTable还自动增加一个；应移除手动重复按钮，给表格自动权限按钮传入名称。
已完成实现：可选label/default权限管理及自动表格caption，Settings单一空间按钮，页面与文件顶部独立按钮，成员与权限原KnowledgeAccess。
已完成备份：20261012_125217双库custom dumps和uploads含.private，三个SHA256复核通过；提交ca0d7d7d9ab99aaf0eadf076aed443525826c482，4源码/测试文件，未push。
已完成部署：deploy.sh web返回0，HEAD/Web=ca0d7d7；API/Worker保持e498473（未改/未重建），不声称全栈同新SHA；四服务healthy、Dispatcher active。
已完成真实Chrome：管理员6组、员工2组，共8组通过；实际人力资源成员与权限四对象三级、两个平台路由及返回、其他模块默认文案、员工无入口及API403。未保存授权/业务资料，按logout结束，凭据无输出或落盘。
正在进行：无。
待完成：无本轮开发或交付遗留。
修改文件：KnowledgeSettings.tsx、KnowledgePages.tsx、shared/KdosDataTable.tsx、KnowledgePermissionUi.spec.tsx；仅入口布局/名称/两个可选caption参数。
数据库 Migration：无；API/授权规则：不变；依赖：无。
新增或修改测试：12项入口及角色/ACL回归，含管理员/模块管理员/FULL_ACCESS负责人/普通员工/其他模块管理员与四对象三级控件；共享label默认回归。
已运行测试：新增12项通过；原Knowledge Settings/Pages共36项首轮通过，新专项最初Ant Select同名标签定位失败已修正；API权限组/Knowledge controller/scope4套29项通过；Web typecheck/lint通过（仅原Portal warning）。最终Web全量44文件339项通过，Web build通过；仅原Portal/chunk/PDF Node warning。
当前已知问题：无未解决异常。负责人/HR总监真实账号及真实模块管理员没有凭据，未声称生产登录通过；对应可见性自动化覆盖。未修改权限模型/API/数据库/账号，未在生产保存权限。
等待用户确认：无；已授权部署，账号权限不可修改。
下一步：无执行遗留；用户可按验收报告查看两个独立入口及人力资源成员与权限。
恢复执行说明：规范→本段→Git状态/diff→第一项未完成；保留前轮outputs与审计修复，不重写Knowledge权限模型。
最终报告：outputs/KNOWLEDGE_PERMISSION_UI_ACCEPTANCE.md。

---

## 当前任务：KDOS-AUDIT-ACTOR-IDENTITY-001

任务名称：统一创建人/更新人审计身份显示与筛选语义。
任务目标：公共Audit Actor metadata/resolver、可见值优先的候选、Web/合法输出一致；不改历史或普通成员规则。
当前状态：等待人工验收。开发、验证、备份及正式部署已完成；按用户要求不自行判最终PASS。
最后更新时间：2026-10-12 09:58（Asia/Shanghai）。
当前阶段：上线交付及报告已完成；当前子任务：用户人工验收。
开始HEAD：4ef33128116fe5e523e09b71b4555d42849f82a5；与根因基线d51d682相比仅13个outputs文件提交，无源码差异；工作区干净。
已完成：规范/技能/根因报告恢复、确认新版附件和Git差异；此前根因只读证据保留于AUDIT_ACTOR_IDENTITY_ROOT_CAUSE.md。
已完成实现：共享format=auditActor与格式函数、API批量AuditActorIdentityResolver、授权DISTINCT候选+有界keyset姓名搜索、Web表格/eq候选统一、合法审计print/export共用解析且默认不输出。
已完成备份：scripts/backup.sh双库custom dumps及uploads（含.private），目录可读性和三个SHA256复核通过，见AUDIT_ACTOR_BACKUP_VERIFIED.json。
源码提交：3f8f573efb0b5b7c17a3a42a858b6a553d549a5c，14文件，未push；只outputs未提交。
部署异常：首次deploy all中API因MasterPlanSystemModule重复注册FieldCandidateService、resolver不可见而启动失败，停止该轮部署。原镜像不可用，旧Worker image恢复尝试未生效；随后复制仅修正DI的本地编译master-plan.module.js到API可写层并restart，恢复健康。临时override没有改项目compose，误建的空knplan_default network已删除；无卷/数据/密码/权限变化。该临时运行补丁将由正式二次deploy all替换。
已完成DI修正：主计划复用TableFilterModule导出的FieldCandidateService；新增真实Nest模块compile测试，不mock候选/resolver，验证模块边界可解析。API全量最终101套864通过/1原skip、API lint/typecheck/build通过；Web源未再改，之前327全量通过仍有效。保留安全的同源API恢复镜像（仅编译模块、无运行时凭据）。
第二次正式部署：e498473a1930b7683262982577225d0f8d451bdc，HEAD/Web/API/Worker一致、deploy all/check/healthcheck返回0，四容器healthy，Dispatcher active；临时API运行补丁已被正式镜像替换。
已完成线上只读验证：真实管理员登录及5模块10审计候选、5个姓名搜索+原UUID实际SQL、真实高级筛选选择5名/提交原UUID/表格名称一致通过；真实列头脚本定位修正后继续。
数据核验：工序2509/出货1233/知识5及原设备6258的actor指纹一致；同期2次既有设备导入新增106条，SCHEDULED inbound-allocation sync_count14更新14周计划，均已只读审计确认，未回填还原。
已完成真实Chrome验证：18组（管理员登录/权限、五模块10候选、五姓名搜索/原UUID命中、高级及列头）；无凭据/录制，按原logout结束。
正在进行：无自动执行中的开发，等待用户人工验收。
待完成：用户按报告重点确认工序报工更新人五个人名；无本轮开发/测试/部署遗留。
修改文件：16个公共契约/API/Web/resolver/模块注入/测试/SQL脚本/说明；两提交3f8f573、e498473，未push；完整清单见报告。
数据库 Migration：不需要；禁止历史回填、业务写入及权限/flags修改。
新增或修改测试：Resolver9、candidate8、print/export3、Nest模块1（API新增21）；Web新增8；一次性测试库7组真实SQL，已删除测试库。
已运行测试：定向API6套32项、API全量100套863项通过/1既有skip；隔离PostgreSQL7组真实SQL通过并删除临时库；新增Web8项通过（首轮图标按钮名称定位失败已修正）；API/Web typecheck与lint通过，Web仅原Portal Fast Refresh warning。使用生产Node24.19二进制运行。
当前已知问题：无未解决运行异常。首轮Web并行超时及首次部署DI异常已修复/验证，细节见报告；最终API101套864通过/1原skip、Web43文件327通过、隔离SQL7组、root质量及修正后API质量通过。原Portal/chunk/ts-jest警告保持。普通员工生产场景/50资源逐页浏览未执行，未声称通过。
等待用户确认：最终人工验收，无需重复授权实施/部署。
下一步：1. 用户按报告确认高级/列头五姓名与表格一致。2. 有反馈时从实际HEAD e498473继续，不重做根因/旧Knowledge。
恢复执行说明：规范→本段→Git状态/diff→第一项未完成，继续已有实现；前轮Knowledge已完成，不重做；凭据仅运行时，不输出或落入报告。
根因报告：[AUDIT_ACTOR_IDENTITY_ROOT_CAUSE.md](AUDIT_ACTOR_IDENTITY_ROOT_CAUSE.md)。
最终报告：[AUDIT_ACTOR_IDENTITY_ACCEPTANCE.md](AUDIT_ACTOR_IDENTITY_ACCEPTANCE.md)。
状态证据：AUDIT_ACTOR_FINAL_STATE.json；真实界面：AUDIT_ACTOR_IDENTITY_LIVE.json；备份：AUDIT_ACTOR_BACKUP_VERIFIED.json。

---

## 当前任务：Knowledge独立文件夹目录

当前状态：已完成 / 独立文件夹主流程PASS。最终部署d51d682（HEAD/Web/API/Worker一致、healthy），新增迁移已备份执行；843 API /319 Web /118 DB /14 Chrome及新版真实管理员13项PASS，测试资料清理与原13表/4文件/3预览完整性PASS。真实员工正向阅读NOT_TESTED（缺Knowledge读权限），实际登录/API403/管理入口拒绝PASS，未改权限。唯一恢复入口仍为[KNOWLEDGE_2_2_PROGRESS.md](KNOWLEDGE_2_2_PROGRESS.md)阶段八；完整报告[KNOWLEDGE_FOLDER_ACCEPTANCE.md](KNOWLEDGE_FOLDER_ACCEPTANCE.md)。

## 当前任务：Knowledge 2.2 UI Refresh 居中布局

当前状态：已完成 / PASS，已备份、部署eeca5fb；HEAD/Web/API/Worker一致且healthy。Web311项、Chrome13项（1凭据门控skip）、真实管理员12项及清理PASS。唯一恢复入口仍为[KNOWLEDGE_2_2_PROGRESS.md](KNOWLEDGE_2_2_PROGRESS.md)，最终报告[KNOWLEDGE_2_2_UI_REFRESH_ACCEPTANCE.md](KNOWLEDGE_2_2_UI_REFRESH_ACCEPTANCE.md)。无API、Migration或新增依赖，仅Knowledge布局变动。

## 前轮任务：Knowledge 2.2 员工知识门户与管理界面分离

当前状态：已完成 / PASS，已部署3e5fea0b2a31a378fc65bc22b2c27ed7963ce606；Web/API/Worker一致，管理员真实验收与清理通过，员工正向验收因现有读权限不足为NOT_TESTED。最终报告为[KNOWLEDGE_2_2_ACCEPTANCE.md](KNOWLEDGE_2_2_ACCEPTANCE.md)。用户本轮指定唯一主要恢复入口为 [KNOWLEDGE_2_2_PROGRESS.md](KNOWLEDGE_2_2_PROGRESS.md)，请按该文件继续；本文件仅保留此前任务及恢复指针，避免两套进度。

---

## 当前任务：Knowledge 发布操作体验优化

任务名称：Knowledge 2.1.2 发布操作体验；目标：阅读页直接发布、编辑页固定栏、真实变更判断，保持权限/Autosave/expectedVersion/409/历史。
当前状态：已完成 / PASS，已部署。最后更新时间：2026-10-09T23:56:26+08:00。
当前阶段：最终交付完成；当前子任务：无。
已完成：项目/架构/安全/部署规范与技能、旧验收/进度检查；Git干净，最新GitHub/本地HEAD=283b39d7255583039d41401ca69b2bec1e039161，与运行e16c2f7仅报告差异；审查query/publish/Autosave/FILE关联/现有测试。
实际缺陷：阅读页发布入口缺失；编辑操作在底部；编辑页无条件显示存在工作草稿；没有可靠草稿与发布快照比较。
已完成实施：同租户授权详情SELECT计算hasUnpublishedChanges；阅读页最新草稿GET后发布；编辑页sticky操作栏、串行保存发布与并发复核；服务端publish命令保持原样。
备份：20261009_234851双库+uploads，pg_restore目录、上传归档含.private及三个SHA256复核PASS。
部署：./scripts/deploy.sh all PASS，HEAD/Web/API=4e5583474421fd215438d0577cfe9140d85711b5，Pg容器/挂载/端口一致、API仍postgres:5432。
正在进行：无。
管理员验收：11项PASS（顶部直接发布、sticky长文、最新GET锁、标题/主文件/附件、历史预览/原件、无改动、真实409、具体失败），自建树/版本/文件清理且cleanupPending=0，审计保留。
健康：四服务healthy，最终healthcheck/deploy check PASS，HEAD/Web/API一致，原PG保留。
待完成：无本轮遗留。
修改文件：14个Knowledge源码/测试/契约/文档，清单见验收报告；源码提交4e55834（未push）。
数据库 Migration：无；生产TypeORM85已应用/0待运行；依赖：无；API：现有详情响应增加权限受控的可选hasUnpublishedChanges，发布路由/业务command不变。
新增或修改测试：16项前端发布专项、7项后端字段/ACL/历史授权、真实DB富文本/FILE/附件快照状态、Chrome长文sticky与阅读页最新版本发布。
已运行测试：Knowledge API104/Web81 PASS；API全量96套833PASS/1原有skip；Web最终全量38文件293PASS；Chrome4PASS/1凭据门控skip；根lint/typecheck/build及最终Web build PASS；真实隔离DB94场景/85 fresh migrations PASS（临时库自动清理）。测试开发期mock/中文定位/TS选项及DB清理锁/同步异常wrapper已纠正；无关Excel首轮5s超时，15s全量重跑通过，未改其他模块。
当前已知问题：无上线故障；旧员工缺knowledge-pages读取权限未改，本轮不声称生产员工发布权限验收通过。网络中断用自动化验证，真实并发409已生产验证。
等待用户确认：无。凭据仅运行时使用，不落盘/日志，不改密码/权限。
下一步：无开发遗留；用户可按验收报告人工步骤查看线上效果。
恢复执行说明：项目规范→本段→git status/diff→用户新需求；本轮已完成，仅outputs记录未提交，不删除记录、不重做旧2.1.2、不开发2.2。
最终报告：outputs/KNOWLEDGE_PUBLISH_UX_ACCEPTANCE.md；配套ADMIN_ACCEPTANCE/DATABASE_VALIDATION/LIVE.json。源码14文件已提交（未push），报告保留工作区以维持HEAD/Web/API完全一致。

---

## 当前任务：Knowledge 2.1.2 最终交互审查与修复

任务名称：Knowledge 2.1.2；任务目标：标题、批量状态、不可变重试、位置说明、导入图片占位与权限入口，保持已有业务与发布模型。
当前状态：已完成 / 已部署；员工正向阅读验收存在权限限制（详见报告）。最后更新时间：2026-10-09 22:57（Asia/Shanghai）。
当前阶段：最终交付完成，已记录员工权限验收边界。
已完成：GitHub main=本地HEAD=201956554bac8834ce397dbab79bbc7569a70ee4，服务器Web/API=88f48cb（2019565仅报告变动）；项目/架构/安全/部署规范、现有验收报告与前后端代码审查。
实际缺陷：上传无逐文件标题/移除；失败复用键但未固定位置；完成无残留提醒且只跳首个页面；共享位置说明仅适合上传；DOCX预览静默删除图片；侧栏空间设置/归档无权限隐藏。
无需重复修改：后端title默认/300字符校验、事务级租户+操作者幂等/内容哈希校验、编辑改名、原件及历史不可变、Autosave/409、位置分页/懒加载/路径/服务端授权与循环防护。
正在进行：无。
待完成：无开发遗留；生产员工获权发布/历史阅读及具体私密ACL隔离，待用户补齐既有knowledge-pages查看权限后可补验，未修改账号权限。
备份：20261009_224154 legacy/KDOS/uploads，pg_restore --list、上传归档可读性/.private包含及3个SHA256复核PASS。
源码/部署SHA：e16c2f74de1013fdedcec8f69d8b2863ef0d4551，14个源码/测试文件，未push；./scripts/deploy.sh all PASS，HEAD/Web/API一致；4个服务healthy，原PG容器/挂载/15433端口一致。
修改文件：KnowledgeFileUpload/transport、KnowledgePages、KnowledgeLocationPicker、KnowledgeImport/Content及专项测试；FilesService生产逻辑无需修改，新增API测试与隔离数据库回归。
数据库 Migration：无；新增npm依赖/API：无。
新增或修改测试：8项API标题/幂等/权限、7项新增批量交互、1项全部结果、4种位置说明、导入图片占位/低层title及无结果响应、普通员工入口、4组隔离DB回归。
已运行测试：API95套826 PASS/1原有skip；Web38文件277 PASS（Knowledge65 PASS）；根typecheck/lint/build PASS；隔离DB85场景/85 fresh migrations PASS；Chrome fixture3 PASS/1运行时凭据门控skip（生产凭据由独立无录制运行时脚本验收）；早期mock类型/Modal定位/误传参数均已纠正，最终全量PASS。
当前已知问题：产品缺陷已修复且上线；普通员工实际登录成功但knowledge-pages读取403（空间200），无法宣称获权发布阅读验收通过；未修改其账号权限。管理员完整验收PASS；员工登录与未授权拒绝实测PASS，正向阅读/具体私密ACL生产验收未测试，原因如前。
等待用户确认：无；两个账号运行时使用，不落盘/记录，不修改密码或权限。
下一步：代码及上线验收已交付；用户若补齐员工现有页面查看权限，再从真实员工正向阅读验收继续，不重复实现。
恢复执行说明：项目规范→本段进度→git status/diff→继续第一项未完成工作；旧UX已PASS，勿重做；不开发2.2。
最终报告：outputs/KNOWLEDGE_2_1_2_ACCEPTANCE.md；配套BROWSER_ACCEPTANCE/DATABASE_VALIDATION/LIVE.json；管理员9组、员工3组（登录/入口拒绝/未授权API拒绝）、清理1组共13 PASS。自建验收子树/历史/附件永久清理、审计保留，无新Space。

---

## 当前任务：Knowledge 2.1 用户体验完善

任务名称：Knowledge 2.1 用户体验完善。
任务目标：统一保存位置与新建知识，Space后端自动编码和可视图标；保留Page Tree/ACL、两个文件业务服务、Tags、Autosave、历史及409；不开发2.2门户。
当前状态：已完成 / PASS。
最后更新时间：2026-10-09 21:40（Asia/Shanghai）。
当前阶段：已交付；当前子任务：无。
已完成：本地21b9017干净基线/规范审查；创建目标分页与祖先权限查询；通用位置Picker与树/路径/搜索；统一新建知识菜单；Space自动UUID代码/冲突重试/顺序/可視图标；前后端测试/构建、三份备份、deploy all、真实管理员14项验收与清理、最终健康/SHA复核。
正在进行：无。
待完成：无本輪开发遗留。
修改文件：24源码/测试/文档文件，清单见最终报告；提交88f48cb，未push；本进度及UX_ACCEPTANCE/ADMIN_ACCEPTANCE/DATABASE_VALIDATION/LIVE报告。
数据库Migration：无，沿用现有unique/UUIDv7与Page Tree模型。新增依赖：无。
API：新GET spaces/:id/locations；POST spaces改为名称/说明/图标/可选顺序，code由后端生成。类型及调用方同步。
新增或修改测试：后端6项UX+1HTTP、前端10项Picker/空间/导入/菜单、隔离DB5组真实并发/105节点/同名路径/循环/权限、原Chrome创建流程更新。
已运行测试：API94套818 PASS/1原有skip，Knowledge89 PASS；Web38文件263 PASS，Knowledge51 PASS；DB81场景/85 fresh迁移PASS，临时库/角色清理；Chrome3 PASS/1凭据门控skip；真实生产管理员14 PASS；API/Web lint/typecheck、根build/最终Web build/Node24部署构建及diff PASS。原Portal/chunk/宿主Node22/ts-jest提示保留。
当前已知问题：无上线故障。测试页面/版本/文件已永久清理；测试空间按现有API归档，因无永久删除Space API保留1条已归档元数据，创建/归档审计保留，报告明确说明。普通员工生产账号与生产100+节点/Markdown-HTML在线重跑未做，自动化对应覆盖及理由见报告。
等待用户确认：无。管理员运行时凭据无记录；未改账号密码/权限，未读PMC凭据。
备份：20261009_212104 legacy/KDOS/uploads可读性、.private及最终SHA256复核PASS，详见LIVE/验收报告。
部署：./scripts/deploy.sh all/check PASS；HEAD/Web/API=88f48cbdc7536b76686c9342a5a3abde3fe72eba；Web/API/Worker/Pg healthy，原PG容器/挂载/15433端口及APIpostgres:5432保留。
管理员验收：新建Space无code/默认图标与顺序、保存回显；统一3菜单；空Space/根/公司制度上传与DOCX/PPT/PDF实际画布/原件；多层同名路径变更；子页面/DOCX正文导入；移动、Autosave/历史V1-V2/Tags搜索/真实409；已有Space码/图标不变；14项PASS。
下一步：无；用户进入线上知识库按报告人工验收。
最终报告：outputs/KNOWLEDGE_2_1_UX_ACCEPTANCE.md；配套ADMIN_ACCEPTANCE.json、DATABASE_VALIDATION.json、LIVE.json。
恢复执行说明：项目规范→本进度最新任务→git status/diff→用户新需求；此任务已交付，不重做旧2.1、不开发2.2、不清理非验收数据。

---

## 当前任务：Knowledge 2.1 编辑页面精简

任务名称：Knowledge 2.1 编辑页面精简。
任务目标：删除标签输入，保留Tags数据/API/搜索/发布快照；标题上方显示Space > 父页面，主文件预览/富文本优先；验证保存、409、发布和上传，备份部署并实际验收。
当前状态：已完成 / PASS。
最后更新时间：2026-10-09 20:44（Asia/Shanghai）。
当前阶段：已交付；当前子任务：无。
已完成：GitHub main/HEAD与本地基线3ee7190一致；精简UI；5项新增前端回归及Chrome断言；专项/全量前端测试与lint/typecheck/build；三份升级备份；仅Web部署；真实管理员9项验收及自建数据清理；最终健康检查。
正在进行：无。
待完成：无本轮遗留。
修改文件：KnowledgeEditor.tsx、knowledge.css、KnowledgePages.spec.tsx、e2e/knowledge-ui.spec.ts（源码提交c8e38aa，未push）；本进度、KNOWLEDGE_EDITOR_ACCEPTANCE.md、ADMIN_ACCEPTANCE.json、ADMIN_FIRST_ATTEMPT.json、LIVE.json。
数据库 Migration：无。新增依赖/API：无。
新增或修改测试：5项编辑器回归，Chrome fixture增加无标签/路径位置/已有标签及版本保留断言；临时运行时生产管理员脚本不持久化凭据或浏览器录制。
已运行测试：Knowledge 6文件/41 PASS；Web全量35文件/253 PASS；Chrome fixture 3 PASS/1凭据门控skip；生产管理员9 PASS；Web lint/typecheck/build、Node24部署构建、diff检查PASS；原Portal/chunk/宿主Node22提示保留。
当前已知问题：无遗留。首轮验收脚本误判私有图片选择器为位置控件，修正检查范围后9项全通过，首轮自建树也已清理，无产品兼容代码。
等待用户确认：无。仅管理员验收，未改账号密码/权限，凭据只运行时消费。
备份：20261009_203617 legacy/KDOS/uploads可读取性、私有目录及最终SHA256复核PASS，详见报告。
部署：./scripts/deploy.sh web成功，HEAD/Web=c8e38aa10ed84cc0283c7a2e8fe2458633128ba0；API/Worker保持2c68cc5；四服务healthy；原PostgreSQL容器/挂载/15433端口及APIpostgres:5432保留；两次healthcheck PASS。
线上验收：富文本与FILE新布局、真实Autosave、文件上传/替换、发布V1/V2、历史正文/文件/Tags、标签搜索及实际409均PASS，自建树已通过正式API永久清理。
下一步：无；用户可进入线上知识库按报告步骤验收。
最终报告：outputs/KNOWLEDGE_EDITOR_ACCEPTANCE.md；部署/备份证据KNOWLEDGE_EDITOR_LIVE.json；真实管理员证据KNOWLEDGE_EDITOR_ADMIN_ACCEPTANCE.json。
恢复执行说明：项目规范→本进度最新任务→Git status/diff→用户新的需求；本任务已完成，不重做已有Knowledge2.1、不迁移数据库、不修改其他模块。

---

## 当前任务：Knowledge 2.1 文件型知识与在线预览

当前状态：已完成 / PASS（代码、测试、migration、部署、管理员验收）。
最后更新时间：2026-10-09 18:34（Asia/Shanghai）。
任务目标：文件Page、统一资产/角色和不可变版本、流式/Range、PostgreSQL任务与隔离LibreOffice Worker、PDF.js、批量上传及编辑优化。
主要恢复入口：outputs/KNOWLEDGE_2_1_PROGRESS.md；最终报告：outputs/KNOWLEDGE_2_1_ACCEPTANCE.md。
测试：API811PASS/1原有skip，Web248PASS，其他workspace43PASS，Knowledge后端90/前端36专项PASS，DB76场景/85fresh migration PASS，实际六种Office转换PASS，Chrome fixture3PASS/1环境门控skip，真实管理员18PASS；类型/lint/build PASS（原Portal/chunk警告保留）。
部署：HEAD/API/Web/Worker=2c68cc51e5e2890823a16a8cc30d79ea497d9a5a；migration1722920086000成功；三份备份及SHA通过；四服务healthy；原PostgreSQL容器/挂载/127.0.0.1:15433和APIpostgres:5432保留；Worker无外网/无端口。
验收：Word/PDF/PPT/Excel/图片、28MB PDF、批量部分成功、V1/V2历史、私有Range/匿名401、autosave、标签/搜索/路径、失败重试/Worker停机隔离；自建测试数据已永久清理。
限制：员工线上未获授权，未改账号或权限，自动化ACL/RLS通过；不包含文件文本提取/OCR/RAG，Excel打印区域/PPT动画等限制见报告。
下一步：无授权范围内遗留；用户可直接进入知识库验收。不要重新迁移或重建数据，Git报告未push，保留下面先前任务记录。

---

## 当前任务：10092补入出货计划并合并10091新增明细

任务目标：按订单号＋品号核对10092全量周计划/出货计划，补缺项，交期使用订单交期；与10091实际新增222条合并xlsx保存下载目录。
当前状态：已完成 / PASS。
最后更新时间：2026-10-09 16:41:15（Asia/Shanghai）。
当前阶段：已完成；当前子任务：无。
已完成：统一加密检测/只读解析；全量生产API匹配和终态回读；确认10092缺少周计划的665源行对应664条出货计划均已存在且日期相符；保留10091全部222条创建ID；合并xlsx222条/17331数量；重开Excel校验；双库/uploads备份；健康检查。
正在进行：无。
待完成：无。
修改文件：本进度、outputs/SHIPPING_PLAN_10092_MERGED_RESULT.md、忽略目录data/operations/shipping-import-10092/*、/home/Jerry/下载/出货计划新增明细_10091_10092合并_222条.xlsx。产品源码无修改；未commit/push。
数据库Migration：无。新增依赖/API：无。
新增或修改测试：无源码修改；实际API全量只读验证与Excel重开验证。
已运行测试：10092有效956、周计划已有291、未在周计划665（664唯一记录）、新增0/日期更新0；两次shipping1233/weekly1169全量完全一致；10091实际新增222在10092全部存在并与上一批API业务字段一致；合并Excel222行/17331数量/日期/空值/中文表头/交期编码PASS，原文件hash不变；healthcheck PASS。
当前已知问题：无阻塞；原有数量差异保留，9+5已有14不重复新增。
等待用户确认：无。凭据仅运行时使用，未输出或持久化，未修改账号/密码/权限。
部署/数据操作：现有生产API只读核对，无缺项无需导入预览/确认、build或重部署。backup20261009_163752已完成。
追加核查：2026A027407出货计划1条，GKW126KB-1/1数量16、日期2026-10-08，与10092一致，周计划0条。
下一步：无；用户打开合并Excel或按订单筛选生产出货计划验收。
最终报告：outputs/SHIPPING_PLAN_10092_MERGED_RESULT.md；私有verification.json记录noBusinessWrites=true与合并222个ID。
恢复执行说明：项目规范→本进度→Git状态→10092 verification/当前API；任务已完成，禁止盲目新增；保留10091及其他模块历史。

---

## 当前任务：10091在手未完成订单补入出货计划

任务目标：按订单号＋品号核对全部现有事业部周计划，只将未体现明细通过正式API补入出货计划，交期统一源“订单交期”。
当前状态：已完成 / PASS，生产API已确认并逐行回读。
最后更新时间：2026-10-09 16:21:05（Asia/Shanghai）。
当前阶段：已完成；当前子任务：无。
已完成：原Excel统一加密检测/只读解析/原文件保留；全量API匹配；标准新增及仅交期更新文件；两份预览零错误；备份；正式API确认；逐行与幂等重放核验；健康检查与人工结果xlsx。
正在进行：无。
待完成：无本轮遗留。
修改文件：本进度、outputs/SHIPPING_PLAN_10091_IMPORT_RESULT.md、忽略目录data/operations/shipping-import-10091/*、/home/Jerry/下载/shipping_plan_import_10091_result.xlsx。产品源码未修改；本人未执行commit/push，工作期间另有仅outputs的外部提交ba91c5d，保留。
数据库Migration：无。新增npm依赖/API：无。
新增或修改测试：无源码修改；执行现有统一检测及正式API预览/确认/全量回读/幂等核验。
已运行测试：838有效明细/179周计划已有/659未体现；其中222新增、69日期校准、368源明细对应367已有项保留；两个说明行和21分组行跳过，重复9+5已有14不新增。预览69/222零错误；确认69更新+222新增；新数量17331；目标659源明细交期全部一致；原942未选已有项业务字段/version不变；69更新其他字段保留；两次相同预览重放repeated=true无重复写入。
当前已知问题：无阻塞；源人员名不作事业部，新增使用现有A027→事业四部映射；已有两项数量及18品名与原表不同，保留已有业务字段，不属于本次日期校准范围。
等待用户确认：无。管理员凭据仅运行时使用，未改账号密码、权限或系统开放时间。
部署/生产：无产品版本改动无需build/redeploy；实际生产API写入，出货计划1011→1233，周计划1169不变；healthcheck PASS，导入后初次deploy check PASS；运行Web/API为5e89cd7。收尾时HEAD出现仅outputs提交ba91c5d，产品源码无差异，不为记录提交重建服务。backup20261009_161425双库/uploads可读取性及SHA复核通过，详见报告。
下一步：无；用户可通过“出货计划表”或核验xlsx查看新增/日期校准结果。
最终报告：outputs/SHIPPING_PLAN_10091_IMPORT_RESULT.md；私有恢复证据为data/operations/shipping-import-10091/confirmed.json、verification.json、prepared.json、backup-verified.json。再次执行先读这些确认结果及当前API，严禁重新盲目新增222条。
恢复执行说明：项目规范→本进度→Git状态→私有已确认结果→当前生产API；任务已完成，保留其他Knowledge/设备/Phase5.4记录。
---

## 当前任务：KDOS Knowledge 2.0 — Space + Page Tree

任务名称：KDOS Knowledge 2.0正式基线。
任务目标：替换未验收Phase1，交付Space/Page树、工作草稿/自动保存、不可变发布、继承ACL、私有文件、标签搜索、导入导出及生产验收。
当前状态：已完成 / PASS（用户明确仅验收管理员）。
最后更新时间：2026-10-09 12:58:32（Asia/Shanghai）。
当前阶段：正式部署及管理员真实生产验收完成；当前子任务：无。
已完成：51源码文件的Knowledge2.0实现、既有迁移保留、新迁移、权限与私有文件、导入/导出/搜索、备份/测试/部署；本轮真实管理员登录发现并修复工作副本缓存初始化及TipTap可编辑切换虚假PATCH的版本冲突；23项实际Chrome验收全部通过。
正在进行：无。
待完成：无本轮遗留；员工11/13及另一已认证员工有效ACL场景按用户范围不执行，未冒充实际生产PASS。
修改文件：初始51文件清单详见最终报告；本轮仅KnowledgePages.tsx/spec.tsx、KnowledgeContent.tsx/spec.tsx四个源码/回归文件；outputs进度、最终报告、管理员JSON、LIVE、backup manifest更新。提交9885859/2abf76c/8ee5c4f/5e89cd7均未push。
数据库Migration：原1722920084000未改；新Knowledge2SpacePageModel1722920085000已于初始交付上线；本轮补修无新migration、新依赖或API改动。
新增或修改测试：缓存版本进入编辑的等待/新expectedVersion；真实TipTap busy/editable切换不触发正文onChange；专用录制关闭的生产管理员Chrome运行时runner不含凭据值，仅放/tmp。
已运行测试：初始API89 suites777PASS/1既有skip、其他workspace43PASS、隔离DB61场景91审计/84迁移PASS；最终Web32文件235PASS，Knowledge专项23PASS，Chrome fixture3PASS/1环境门控skip，另专用真实管理员Chrome23PASS。初次默认多worker11个既有5秒超时，最终2workers/15秒完整回归全部通过，无其他模块改动。根build及最终Webtypecheck/lint/build、Node24部署构建、diff检查PASS。
当前已知问题：无管理员范围遗留；员工线上隔离未执行（用户范围）；既有引擎/AntD/Portal/Vite warnings保留，未影响测试和构建。未保存正文在浏览器终止后不恢复，见报告限制。
等待用户确认：无。未改账号密码或授权；实际值仅运行时消费，无trace/video/screenshot/storageState。
部署：初始backup20261008_184441及本轮20261009_124217/124902双库/uploads均校验；最后./scripts/deploy.sh all、healthcheck、deploy check PASS，HEAD/API/Web=5e89cd7c853611202ba865b20ba4aa0ece4823d6。原Postgres b679ba44、volume、127.0.0.1:15433及API内部postgres:5432不变。
线上验证：23项管理员真实API/UI全部PASS（V1→草稿编辑→V2→V1历史附件、三层树、ACL配置/匿名401、中文搜索、三种导入、归档/回收站恢复）；仅自建测试树通过API永久清理，最终Pages0/versions0/files0/cleanup0/privateObjects0，元数据审计保留。原钢价截至2026-09-30的1078/1078/13/98及起止日一致；当前全表另含2026-10-08的11条，总1089/99天，本任务未写intelligence。
下一步：无管理员验收范围任务；用户后续若需要可使用已有员工账号补实际隔离验收，不修改账号授权。
最终报告：outputs/KNOWLEDGE_2_ACCEPTANCE.md（15项/25表格，23PASS、2员工项明确未执行）；outputs/KNOWLEDGE_2_ADMIN_ACCEPTANCE.json；DB/LIVE/backup manifest同目录。
恢复执行说明：项目规范→本进度→Git status/diff→用户的新任务；不重做已完成Knowledge2.0。保留之前设备/Phase5.4输出，后者仍待正式来源澄清。
---

## 当前任务：设备状态导入错误提示区分事业部与编号

任务目标：事业部名称匹配失败时明确提示事业部问题，名称有效但设备匹配失败时提示设备编号/填报资格；不扩大数据权限或改变导入计算。
当前状态：已完成 / PASS，API已正式上线。
最后更新时间：2026-10-08（Asia/Shanghai）。
当前阶段：已完成；当前子任务：无。
已完成：名称预检与设备错误分开；组织名称查询受导入division scope约束，继续保留设备快照有效名称；不改变设备匹配键及监控资格。新增10项回归、设备专项45项及API全量754项通过。
正在进行：无。
待完成：无开发遗留；用户可刷新后重新上传。
修改文件：equipment.application.service.ts、equipment.spec.ts、本进度、outputs/EQUIPMENT_STATUS_IMPORT_ERROR_ACCEPTANCE.md、outputs/EQUIPMENT_STATUS_IMPORT_ERROR_LIVE.json。源码仅2文件提交fe004db5b15a8482ee6bd00724168bba09597fb9，未push。
数据库Migration：无。新增npm依赖：无。
新增或修改测试：10项名称/编号/监控/停用/空事业部/空设备/部分预览/权限/快照兼容回归；两处现有manager mock适配。
已运行测试：设备专项2 suites/45项；API全量87 suites/754项通过，另1既有skip；API typecheck/lint/build及git diff --check通过。
当前已知问题：无新失败；保留既有Node22引擎提示和ts-jest allowJs警告。
等待用户确认：无。
部署：backup20261008_110130双库/uploads校验通过；scripts/deploy.sh api成功，API/HEAD=fe004db，Web保持既有77e7a8c（没有前端改动）；healthcheck全部通过，PostgreSQL未重建，原volume和15433端口保留。
线上验证：实际部署Service+真实DB只读预览原文件17行全部提示找不到事业部名称“研发”；修正版17行全部有效，无错误；未confirm，状态记录数前后均5141。未使用用户凭据或执行账号Chrome验收，权限分支单测通过。
最终报告：outputs/EQUIPMENT_STATUS_IMPORT_ERROR_ACCEPTANCE.md。
下一步：无；人工按报告上传原文件/修正版核对提示。
恢复执行说明：保留Phase5.4及文件核查记录；仅继续本轮未完成步骤。

---

## 当前任务：设备状态导入文件1008失败核查

任务名称：设备状态Excel设备编号匹配失败检查。
任务目标：核对用户文件、真实设备台账与导入匹配规则，提供可重新预览的修正副本。
当前状态：已完成（文件核查与修正副本），未代用户确认导入。
最后更新时间：2026-10-08（Asia/Shanghai）。
当前阶段：完成；当前子任务：无。
已完成：读取适用规范和Skill；先调用统一加密检测，再使用项目ExcelJS/实际EquipmentImportService解析；逐一比对生产台账；全部17个编号存在且启用/监控，但Excel事业部“研发”与台账“研发中心”不一致；另存只改17个事业部单元格的副本，并重新解析和逐单元格对比。
正在进行：无。
待完成：无开发遗留，用户可上传修正副本预览；本人账号权限未实际登录验证。
修改文件：本进度；新副本/home/Jerry/下载/equipment_status_import_2026-10-08_fixed.xlsx；用户原文件保留，产品代码无修改。
数据库Migration：无。npm依赖/新API/生产数据写入/部署：无。
新增或修改测试：无测试源码变更。
已运行测试：实际解析17行、17台唯一匹配且active/monitored均true；修正后17行事业部统一研发中心，其他所有单元格值与工作表结构不变；填报日期2026-10-06。没有产品更改，不运行build或重部署。
当前已知问题：无未解决文件内容问题；未验证用户当前账号导入权限。
等待用户确认：无。
下一步：用户上传修正副本查看预览，再按正常流程确认导入。
最终报告：本记录及最终回复；修正副本如上。
恢复执行说明：此文件核查已完成；Phase5.4仍保持下方的停止条件状态，不因本次设备核查自动继续或重做。

---

## 当前阶段入口：Phase 5.4 - 研发进度事业部归属核查与修正

任务名称：PMC研发进度Phase 5.4。
任务目标：核实订单品项正式事业部分配、客户fallback，再最小修复并完成部署验收。
当前状态：调查完成，触发用户停止条件1；等待正式来源/稳定关联规则确认，未完成开发 / FAIL。
最后更新时间：2026-10-08（Asia/Shanghai）。
当前阶段：只读调查已完成；当前子任务：等待来源澄清。
已完成：源码/真实Schema/索引、覆盖与冲突、8条业务样本、重复品号、跨事业部样本查找、实时E10 Owner_Dept核查、现有增量与MPS投影流程；现有生产健康检查通过。
正在进行：无业务修改；用户问题已提出。
待完成：确认正式E10订单行关联来源；resolver/本地变更刷新；必要测试/Skill；备份部署/FULL/INCREMENTAL/Chrome/Excel完整验收。
修改文件：本进度、outputs/PMC_RD_PROGRESS_PHASE5_4_ACCEPTANCE.md、outputs/PMC_RD_PROGRESS_PHASE5_4_INVESTIGATION.json。
数据库Migration：无。新增npm依赖：无。产品代码/Skill/权限/账号/数据改动：无。
新增或修改测试：无；停止条件触发后未实施测试代码。
已运行测试：只读PostgreSQL来源统计和E10组织查询；scripts/healthcheck.sh全部通过。产品自动测试/build/typecheck/lint未运行，本轮没有产品更改。
当前已知问题：研发17647条仅38映射；allocation完整订单号+品号及单订单号均0命中、没有E10行ID；443组重复键涉及1057行；没有真实跨事业部allocation样本。客户映射仅3条，A027命中35、C235命中3、C234命中0，其余115客户17609条均无可验证来源。组合理论覆盖仍0.2153%。
等待用户确认：E10订单品项的正式承接事业部实际维护表/页面，或已有E10↔T+稳定订单行关联规则；不允许猜前缀强行匹配。
下一步：1.获取用户确认的正式来源/稳定关联规则；2.复用调查JSON核验键和真实跨事业部样本；3.安全最小修复与完整交付。
部署状态：未部署新版本，运行API/Web均77e7a8cf40a60f2b743ae7947fdf11aaeb1018a5，服务健康；未执行FULL/INCREMENTAL或生产写入。
最终报告：outputs/PMC_RD_PROGRESS_PHASE5_4_ACCEPTANCE.md（调查报告，尚非开发PASS）。
恢复执行说明：项目规范→本进度→Git status/diff→从用户来源确认继续；不要重复调查或重做Phase5.3；3份输出为本轮未提交记录，保留。

---

## 当前阶段入口：Phase 5.3 - 图表筛选补充与明细筛选精简

任务名称：PMC研发进度Phase 5.3。
任务目标：三项远程多选、明细仅高级筛选、共享全量导出与Skill标准。
当前状态：已完成 / Phase 5.3 PASS。
最后更新时间：2026-10-08 09:11:13（Asia/Shanghai）。
当前阶段：已完成；当前子任务：无。
已完成：三项远程多选及其他维度多选、明细移除常驻Card与快速搜索、现有高级面板完整条件/草稿/重置/计数、两Tab共享、OR/AND、完整平台导出、Skill/文档、全部验证、备份正式部署及生产18项/健康。
正在进行：无。
待完成：无。
修改文件：12个源码/测试/Skill/文档文件及outputs进度、报告和4个验收JSON；详见最终报告18文件清单。
数据库Migration：无。新增npm依赖：无。新增API：无；复用现有候选/FilterGroup/导出契约。
新增或修改测试：页面27、API专项79；远程候选限量/权限、多值OR/AND、高级面板/Tab/导出与既有真实账号E2E扩展。
已运行测试：Web全量31文件/233项、API全量87 suites/744项（1既有skip）、其他workspace、typecheck/lint/build、Skill validator及diff检查通过；Chrome预验收18/18、清空专项重复8/8、最终生产18/18（1.9分钟）通过。
部署：标准backup20261008_085215双库/uploads已校验；deploy all最终77e7a8cf40a60f2b743ae7947fdf11aaeb1018a5，API/Web/HEAD一致；healthcheck/check全部通过，Postgres未重建、原volume和内部postgres:5432保留。
当前已知问题：无未解决异常；候选/单维最多50、同名品名按名称聚合、历史未映射事业部保留、外部HTTPS本机受限而以生产LAN验收，见报告。
等待用户确认：无。
下一步：无开发遗留；可按报告人工步骤验收生产页面。
最终报告：outputs/PMC研发进度Phase5.3验收报告.md。
恢复执行说明：项目规范→本进度→git status/diff；本阶段已完成，保留全部历史，不重做或覆盖已有输出。

---

## 当前任务：KN-EQUIP-IMPORT-DATE-WINDOW-010

任务名称：设备状态管理导入日期限制由7天调整为10天

任务目标：保持上海自然日、上下界包含和未来日期拒绝语义不变，仅把设备状态填报/Excel 导入可选窗口从“当天+前6天”调整为“当天+前9天”，同步前端日期控件、后端最终校验、模板说明和测试；不修改设备大屏近7天统计。

当前状态：实现、验证、提交和正式部署均已完成；等待人工使用8/9/10天及超界数据验收，当前结论为“等待人工验收 / NO-GO”。

最后更新时间：2026-10-06

### 已确认

- [x] 开始 HEAD：`42f863b65c517349ac4c4b0c4d0ff589d9abdb4d`，工作区起始干净。
- [x] 后端限制位于 `EquipmentApplicationService.reportDate()`，判断字段为 `reportDate` / 填报日期。
- [x] 原口径为上海当天至前6天，两个边界均允许，未来日期拒绝；预览与确认写入均复用该校验。
- [x] 前端人工填报 DatePicker 重复相同日期窗口；Excel 内容由后端预览校验。
- [x] 导入模板说明写明“今天及之前6天（北京时间）”。
- [x] 已识别设备大屏“最近7天”趋势，明确不修改。

### 已完成

- [x] 在 `@kdos/contracts` 提取 `EQUIPMENT_STATUS_REPORT_DATE_WINDOW_DAYS = 10`，后端、前端和模板说明复用同一业务常量。
- [x] 后端最终校验改为上海当天至前9天（共10个自然日、两端包含），未来日期仍拒绝。
- [x] 前端人工填报 DatePicker 同步为相同边界；Excel 导入继续由后端 preview/confirm 两阶段最终校验。
- [x] 模板说明更新为“近10天（含今天，即今天及之前9天，北京时间）”。
- [x] 补齐当天、第8/9/10个日历日、超界1日、未来日期和多行部分错误策略测试。
- [x] 定向测试：API 2 suites / 24 tests、Web 12 tests、Contracts 22 tests，全部通过。
- [x] 全量测试：API 79 suites / 618 tests 通过（另 1 suite / 1 test skipped）；Web 28 files / 181 tests 全部通过。
- [x] API、Web、Contracts typecheck 通过；API lint 通过；Web lint 0 errors，仅保留无关既有 `ModulePortal.tsx` Fast Refresh warning。
- [x] API、Web、Contracts build 通过；Web 仅有既有 chunk-size warning。
- [x] 已复查设备大屏“最近7天”趋势和督办“7天内需交付”，均与本任务无关且未修改。

### 正在进行

- [ ] 无；等待人工验收。

### 待完成

- [ ] 输出“等待人工验收 / NO-GO”报告，等待人工以8/9/10天边界及超界数据验收。

### 修改文件

- `packages/contracts/src/index.ts`
- `apps/api/src/modules/equipment/equipment.application.service.ts`
- `apps/api/src/modules/equipment/equipment-export.service.ts`
- `apps/api/src/modules/equipment/equipment.spec.ts`
- `apps/api/src/modules/equipment/equipment-export.service.spec.ts`
- `apps/web/src/modules/equipment/equipment-status-date-window.ts`
- `apps/web/src/modules/equipment/EquipmentPages.tsx`
- `apps/web/src/modules/equipment/EquipmentPages.spec.tsx`
- `outputs/CODEX_PROGRESS.md`

### 已运行测试

- API 定向：2 suites / 24 tests passed。
- Web 设备页定向：12 tests passed。
- Contracts：22 tests passed。
- API 全量：79 suites / 618 tests passed，1 suite / 1 test skipped。
- Web 全量：28 files / 181 tests passed。
- API、Web、Contracts typecheck、lint、build：通过；仅有既有非阻断 warning。

### 部署验证

- [x] `./scripts/deploy.sh all` 成功，Web/API 容器已更新。
- [x] `./scripts/healthcheck.sh`：Web、API、Swagger、OpenAPI、PostgreSQL 全部健康。
- [x] Notification Dispatcher：`active / running`。
- [x] `./scripts/deploy.sh check`：Repository SHA = Web SHA = API SHA，`STATUS=CONSISTENT`（进度记录回填后将 amend 并以最终 SHA 再部署核对）。

### 等待用户确认

- 人工验证8天前、9天前、10日窗口边界（今天-9天）应允许；超出窗口1天（今天-10天）应拒绝。部署后不自行判 PASS。

### 数据库 Migration

- 无。

---

## 当前任务：研发中心 / 一物多码检测查询体验改造

任务名称：RD duplicate query UX overhaul

任务目标：在不修改查重算法、同步流程、查询权限和公共表格组件的前提下，为已保存的一物多码结果增加“全部”分类、物料库命中数、分类聚合计数、同一物料组合筛选及分层空状态，并完成测试、构建与部署核验。

当前状态：已完成实现、测试、构建、部署和“展示架”真实查询核对。

最后更新时间：2026-10-06

### 已完成

- [x] 后端 `GET /rd/material-duplicates/scans/:id` 增加 `materialMatchCount`、`groupCounts`。
- [x] code/name/spec 改为同一 `rd_items` 成员行的组合 `EXISTS`，保留租户隔离。
- [x] 前端默认分类改为“全部”，增加统计标签、分类计数和三类空状态文案。
- [x] 增加 API scan 查询聚合/组合筛选测试，更新 RD E2E mock 与统计断言。
- [x] API RD 定向测试通过（6 tests），Web typecheck 通过。
- [x] API 全量测试通过（79 suites / 617 tests，1 skipped）。
- [x] Web/API build、部署、healthcheck 和版本一致性通过（commit `c1fbea7`）。
- [x] “展示架”直接 SQL 核对：物料 881 条；候选组 all=184、similar=0、exact=0、missing=184、code=0。

### 待完成

- [x] Web 单元测试执行；RD E2E 6 项通过（全量 E2E 另有 1 个历史 `knm-audit` 登录环境失败）。
- [x] 部署 Web/API，执行健康检查与版本一致性核对。
- [x] 对真实“展示架”查询执行 SQL 对照，确认 184 = 0 + 0 + 184 + 0。
- [x] 输出最终 13 项核对报告；未修改算法、同步、水位线、FULL、Top5/Top10。

### 修改文件

- `apps/api/src/modules/rd/rd.query.service.ts`
- `apps/api/src/modules/rd/rd.query.service.spec.ts`
- `apps/web/src/modules/rd/RdPages.tsx`
- `apps/web/src/modules/rd/rd-display.ts`
- `apps/web/src/styles.css`
- `apps/web/e2e/rd-ui.spec.ts`

---

## 当前任务：KDOS-NOTIFICATION-SHIPPING-PLAN-008

任务名称：出货计划关键字段变化企业微信通知

任务目标：仅为 `mps_shipping_plans` / `mps-shipping-plans` 的既有 Web/API 单条 PATCH 接入 `shipping_plan.key_fields_changed`；关键字段为 `orderNumber`、`itemCode`、`latestCustomerDueDate`、`plannedQuantity`、`divisionId`。本阶段不接入新建、删除、批量、Excel、shipping-to-base、base-to-weekly 或 ERP 同步。

当前状态：单条 PATCH 代码、Registry、测试和部署已完成；生产 FIXED_USERS 规则与真实企业微信实发仍待完成。

最后更新时间：2026-10-06

---

## 当前阶段
Knowledge2.1：源码b09c051；API811/Web247/专项90/DB76与85migration/六种Office转换通过，三份备份SHA验证通过，正式镜像构建和统一部署中。

当前阶段：API 事件注册、事务 enqueue、测试与验证

当前子任务：先完成 Registry 与 Application Service 单条 PATCH 接入，再执行 API/Web/Shared/Dispatcher 回归、构建、部署和生产实发验证。

## 已完成

- [x] 已读取用户确认的 008 任务边界：只处理 `mps_shipping_plans` 单条 PATCH。
- [x] 已确认基线 HEAD 为 `542892b4f2e175610f68010f273cd2bdd8d0d6fa`；实现已合并至当前部署提交。
- [x] 已重新读取 `kdos-form-platform` 技能并确认必须复用现有事务、审计、字段权限、乐观锁和 NotificationService。

## 正在进行

- [ ] 生产创建仅含崔玮杰的 `FIXED_USERS` 规则并进行一次安全实发核验。

## 待完成

- [x] API/Web/Shared/Dispatcher 测试、lint、typecheck、build 已执行；历史 Web marketing 测试超时已单独记录。
- [x] 已部署当前运行环境并通过健康检查。
- [ ] 创建正式 FIXED_USERS 规则并进行单条安全记录真实企业微信验证。
- [x] 已更新企业微信通知总控文件和进度文件。

## 修改文件

- `apps/api/src/modules/notifications/notification-event.registry.ts` 及测试。
- `apps/api/src/modules/master-plan-system/master-plan.application.service.ts`、`master-plan.module.ts` 及测试。
- `docs/KDOS_企业微信通知开发总控.md`、本进度文件。

## 数据库 Migration

- 无。本任务复用现有 `notification_outbox`，不新增 migration。

## 新增或修改测试

- Registry 事件/模板变量/资源/接收规则。
- 单条 PATCH 关键字段变化、不变值、非关键字段、多字段合并为一个 outbox、dedupKey、同一 manager。
- 既有 Notification/固定接收对象/Dispatcher 回归。

## 已运行测试

- API 全量 79 suites / 617 tests 通过（1 skipped）；Shared 7 tests 通过；Dispatcher 6 tests 通过；API/Web build、typecheck、lint 通过；RD 任务期间 Web 全量有 2 个既有 marketing 超时。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 生产尚未创建 `shipping_plan.key_fields_changed` 规则，也未执行真实企业微信发送；当前环境缺少可安全使用的管理员登录凭据，不能绕过正式 API 直接写规则或业务数据。

## 等待用户确认

- 无；008 任务边界已由用户明确确认。

## 下一步

1. 在消息中心正式创建仅包含崔玮杰的 FIXED_USERS 规则。
2. 选择安全出货计划执行一次单条关键字段修改并核验真实 delivery/SENT/provider_message_id。
3. 补录总控文档、进度文件和最终提交 SHA；不要扩大到批量/Excel/同步入口。

---

## 当前任务：KDOS-NOTIFICATION-SHIPPING-PLAN-008A

任务名称：出货 / 备货计划企业微信通知——实施前只读业务核对

任务目标：基于当前生产基线 `542892b4f2e175610f68010f273cd2bdd8d0d6fa`，只读核对出货计划与事业部基础计划的真实表、字段、写入口、权限、同步关系、事务和通知接入点；不修改通知底座、业务源码、数据库或生产数据。

当前状态：已完成只读分析；未修改源码、数据库、生产数据、通知 Registry、Dispatcher 或通知规则。

最后更新时间：2026-10-06

---

## 当前阶段

当前阶段：实施前业务核对完成，等待业务确认

当前子任务：整理并交付 008A 分析；企业微信通知总控文件阶段状态未修改。

## 已完成

- [x] 已阅读项目规范、架构、安全、集成指南、企业微信通知总控和既有进度。
- [x] 已确认 Git 工作区起始干净，HEAD 为 `542892b4f2e175610f68010f273cd2bdd8d0d6fa`。
- [x] 已核对 `mps_shipping_plans`、`mps_base_plans`、`mps_weekly_plans` 迁移、资源配置、Contracts 字段、Query/Application/Sync/Spreadsheet/Controller/Web 页面与测试。
- [x] 已确认没有 TypeORM Entity 类；主计划资源通过 `MasterPlanResource` + raw SQL/EntityManager 操作。
- [x] 已确认 `mps-base-plans` 是代码中的正式名称“事业部基础计划表”，代码中没有名为“备货计划”的独立 resource/table；该术语需业务确认。
- [x] 已确认 Web 单条、批量、Excel 导入确认、删除、计划同步、定时同步等真实写入口及权限/数据范围/乐观锁/审计行为。
- [x] 已确认 Web/Application 写事务目前只写业务表、审计和 `mps_reconciliation_outbox`；当前没有 shipping 事件入队。`shippingToBase` 使用 `dataSource.query`，未与通知 outbox 形成同一事务。
- [x] 已形成通知触发矩阵、关键字段建议、自动同步通知结论、建议事件和 payload；尚未新增 Registry 事件。

## 正在进行

- [ ] 无源码实施；等待用户确认角色字段归属、自动同步通知意图及批量事件粒度。

## 待完成

- [ ] 用户确认“备货计划”是否就是 `mps-base-plans`。
- [ ] 用户确认销售/生管角色与字段所有权。
- [ ] 用户确认自动 `shipping-to-base` 是否通知及接收范围。
- [ ] 用户确认多记录批量/导入应采用逐记录事件还是聚合事件。
- [ ] 用户确认后，另行启动事件 Registry/规则/业务接入实施任务；本阶段不实施。

## 修改文件

- `outputs/CODEX_PROGRESS.md`（仅追加本 008A 只读分析记录）

## 数据库 Migration

- 无。

## 新增或修改测试

- 无（本阶段只读分析）。

## 已运行测试

测试名称：代码/迁移/服务/页面静态核对、Git 状态检查。

结果：完成；未执行会修改状态的测试、迁移、部署或通知发送。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 代码没有销售与生管的显式字段归属模型，不能仅凭代码给出权威角色结论。
- “备货计划”不是现有 resource 名称；只能确认其可能对应 `mps-base-plans`，需用户确认。
- 自动 `shipping-to-base` 当前没有标准 `audit_logs` 业务行审计，也没有通知 outbox；只有同步日志/计数，且其 upsert 不在显式事务中。
- `shipping_plan.key_fields_changed` 当前在 Registry 中不存在，现有测试明确期望其未注册；本阶段未修改。

## 等待用户确认

- “备货计划”是否正式指 `mps-base-plans`（事业部基础计划表）。
- 销售与生管的角色/权限组，以及各字段的正式填写人和接收人。
- 自动同步改变关键字段时是否通知销售、生管，是否只在实际值变化时通知。
- 批量修改/Excel 整批中多记录事件的粒度。
- 删除、同步覆盖和派生字段是否需要单独事件类型。

## 下一步

1. 用户确认上述业务问题。
2. 依据确认结果另建实施任务，设计 Registry、规则、payload 和事务接入。
3. 实施任务中保持“一次业务保存 → 一个事件 → 一条消息”，并补齐自动同步事务边界和审计要求。

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取项目 AGENTS.md、`kdos-form-platform/SKILL.md` 和本节。
2. 执行 `git status`、`git diff --stat`，确认只有进度记录变更。
3. 先取得用户对“备货计划”、角色字段归属、自动同步通知和批量粒度的确认，再开始实施；不要重新分析已完成的 008A 核对。

---

## 当前任务：KDOS-NOTIFICATION-PRODUCTION-CUTOVER-007

任务名称：彻底移除企业微信 TEST MODE，切换为正式接收人直接发送

任务目标：删除 API、Web、Dispatcher、systemd 和数据库运行模型中的验证期机制，使通知规则解析出的有效业务接收人直接成为企业微信接收人。

当前状态：已完成。代码、数据库 migration、严格顺序部署、实际 user-systemd 更新、单人/双人真实实发、规则恢复和生产健康核验均已完成。

最后更新时间：2026-10-04

---

## 当前阶段

当前阶段：已完成

当前子任务：无。下一任务仅登记为 `KDOS-NOTIFICATION-SHIPPING-PLAN-008`，本任务未开发出货计划通知。

---

## 已完成

- [x] API 删除替代接收人常量/解析/分支、模式契约、多 delivery ID 聚合和历史特殊领取过滤；每个有效用户只对应一条 delivery。
- [x] 禁用用户和缺失企微 ID 用户分别记录 `SKIPPED_DISABLED` / `SKIPPED_MISSING_WECHAT_ID`，不影响其他接收人。
- [x] Dispatcher 删除单人环境门禁、不匹配失败码和多 delivery 回调，逐个发送 API claim 返回的正式接收人。
- [x] Web 删除验证期顶部警告、模式列和替代接收人列；人工测试发送明确提示会真实发给当前规则接收人。
- [x] 新增并在生产执行 `NotificationProductionCutover1722920081000`；退役字段/索引已不存在，80 个 migration 全部已应用。
- [x] 保留已执行的历史 `NotificationTestModeDelivery1722920070000`，仅作为不可变 migration history，不代表保留运行功能。
- [x] 切换前非终态队列为 `PENDING=0`、`PROCESSING=0`、可重试 `FAILED=0`；隔离数为 0，1 条旧终态 FAILED 和 7 条历史 SENT 未改动。
- [x] 备份已完成且通过 `pg_restore --list` 校验：`data/backups/four_department_tracker_20261004_205409.backup` (600492479 bytes，2026-10-04 20:55:27 +0800，SHA-256 `3248b2e1e5c8644cd3c3dd78530c70dd44a64c2e5e557a34714e7d2415ec853c`)；`data/backups/kdos_20261004_205409.backup` (8155720 bytes，20:55:29 +0800，SHA-256 `d2d70aabb94f68ee6d987c359804070bd13e0bc3ec03c1ba66a0bea99d375a8d`)；`data/backups/uploads_20261004_205409.tar.gz` (38271 bytes，20:55:30 +0800，SHA-256 `089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`)。
- [x] 严格按停 Dispatcher、队列检查、备份、migration、API、Web、实际 user-systemd、启动与健康检查的顺序上线。
- [x] 实际 user-systemd 删除两个单人门禁变量并 daemon-reload；Dispatcher 为 `active/running`、`NRestarts=0`。
- [x] 单人正式实发：outbox `01a10700-171c-7d01-93d4-fa79fc28f5c4`，1 条独立 SENT delivery，1 个 provider message ID，`errcode=0`、`errmsg=ok`。
- [x] 双人正式实发：outbox `01a10700-dbb4-7d43-bcaf-6b7545bb15d8`，2 条独立 SENT delivery，2 个不同接收人与 provider message ID，均为 `errcode=0`、`errmsg=ok`。
- [x] 测试规则已恢复为原单人配置（version 4）；实发后无非终态 outbox。
- [x] API 79/79 suites、610/610 可执行测试；Web 28/28 files、180/180；Shared 7/7；Dispatcher 6/6；lint、typecheck、build 全部通过。
- [x] Web、API、Swagger、OpenAPI、PostgreSQL 健康；线上 bundle 无旧顶部警告，包含“确认真实发送”提示。
- [x] 架构、安全、集成、Dispatcher README 和企业微信通知总控已更新。

---

## 正在进行

- 无。

---

## 待完成

- 无。

---

## 修改文件

- `apps/api/src/migrations/1722920081000-NotificationProductionCutover.ts`
- `apps/api/src/modules/notifications/*`
- `apps/web/src/modules/notifications/NotificationCenterPage.tsx` 及测试
- `automation/wechat_push_projects/kdos-notification-dispatcher/*`
- `ARCHITECTURE.md`、`SECURITY.md`、`docs/integration-guide.md`
- `docs/KDOS_企业微信通知开发总控.md`
- `outputs/CODEX_PROGRESS.md`
- 实际 user-systemd 单元：`/home/Jerry/.config/systemd/user/kdos-notification-dispatcher.service`

---

## 数据库 Migration

- 已执行 `NotificationProductionCutover1722920081000`，删除 `idx_notification_delivery_actual_recipient`、`actual_recipient_user_id`、`actual_wechat_user_id`、`test_mode`。
- 历史 `NotificationTestModeDelivery1722920070000` 保留不改，以保证新库、旧库升级和 migration history 可重复。

---

## 新增或修改测试

- 覆盖 USER、ROLE 多人、ORGANIZATION 多人、ORGANIZATION + ROLE + USER 去重、禁用/缺企微 ID、多用户独立 delivery、单 delivery 成功/失败隔离、Dispatcher 逐人发送和 internal API 权限/租户/worker 回归。

---

## 已运行测试

测试名称：通知 API 专项 / API 全量 / Web 全量 / Dispatcher Python / Shared / lint / typecheck / build

结果：通知 API 5 suites 38/38；API 79/79 suites、610/610 可执行测试（1 skipped）；Web 28/28 files、180/180；Shared 7/7；Dispatcher 6/6。全仓 lint、typecheck、build 通过；lint 仅 1 个既有 Fast Refresh warning，build 仅既有大 chunk 提示。本机 Node v22.23.1 低于项目声明 Node >=24，生产 Docker 使用 Node 24。

---

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 无本任务新增运行问题。

---

## 等待用户确认

- 无。

---

## 下一步

1. 本任务结束。
2. 后续另行启动 `KDOS-NOTIFICATION-SHIPPING-PLAN-008`；本任务不开始其开发。

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前项目 AGENTS.md、kdos-form-platform Skill 和本节。
2. 执行 `git status`、`git diff --stat`。
3. 本任务已完成，不重复实发；若用户启动下一任务，从 `KDOS-NOTIFICATION-SHIPPING-PLAN-008` 的新需求开始。

---

## 当前任务（最终交互标准，覆盖下方旧版“右固定操作列”验收口径）

任务名称：KDOS-SHIPPING-ORDER-DATE-ACTION-001 标准业务表顶部删除统一化

任务目标：将所有支持删除的 KDOS 标准业务表统一为“勾选记录 → 顶部删除 → 二次确认 → 正式后端删除”，移除出货计划及其它标准表的行内删除，并把规则写入平台技能。

当前状态：公共能力、页面迁移、全量验证、提交和正式部署均已完成；等待用户真实线上人工验收，验收前保持 NO-GO。

最后更新时间：2026-10-04

---

## 当前阶段

当前阶段：已部署，等待人工验收

当前子任务：请用户在线验证出货计划及其它标准业务表的勾选、顶部删除、权限、`canDelete` 和二次确认行为。

---

## 已完成

- [x] 读取用户最终交互要求、项目 AGENTS.md、完整 kdos-form-platform 技能、现有进度和 Git 状态。
- [x] 确认开始 HEAD 为 `2be04d3`；工作区仅有上次任务留下的 `outputs/CODEX_PROGRESS.md` 进度修改，无未知源码修改。
- [x] 审计 KdosDataTable：已有默认 checkbox、稳定 ID、跨页选择和选择状态，但没有统一顶部删除 capability。
- [x] 审计现有删除页面：主计划资源使用 `__rowActions → 删除`；设备总台账/设备状态和业务人员对应表使用行内删除；订单排期已有页面私有顶部批量删除。
- [x] 确认主计划与设备当前仅有正式单条 DELETE Application Service/API，订单排期已有正式 batch-delete；本任务不需要数据库 Migration。
- [x] `KdosDataTable` 新增公共 `deleteAction`：权限控制、自动 checkbox、稳定多选、全部 `canDelete` 校验、数量确认、loading、成功移除选择及部分失败保留选择。
- [x] 新增逐条正式 DELETE 兼容助手；没有批量命令的资源仍逐条经过原 Application Service/API，并明确汇总部分失败，不绕过后端权限、数据范围、版本和审计。
- [x] 出货/主计划资源移除 `⋯ → 删除`，改接顶部删除；其余合法行级动作保留，3 天生产工单仍无操作列。
- [x] 设备总台账、设备状态填报、业务人员与客户对应关系移除行内删除；设备停用保留准确业务文案，但复用同一顶部危险操作标准。
- [x] 订单排期删除从页面私有选择/顶栏实现迁移到公共能力，继续复用正式 batch-delete API。
- [x] 平台技能新增“标准业务表删除交互（强制）”及最低验收项，明确标准表不得使用行内删除。
- [x] 最终静态审计确认剩余行级删除仅位于角色/角色组、系统/模块管理员、权限组和筛选规则等非标准业务表或局部配置例外。
- [x] 定向测试覆盖公共表格、主计划、设备和营销迁移页；Web 全量测试 28 文件、180/180 通过。
- [x] Web typecheck 通过；lint 通过（0 error，1 个既有 Fast Refresh warning）；生产 build 通过。
- [x] 提交 `b0e5439 feat(web): standardize top-level table deletion`。
- [x] 执行 `./scripts/deploy.sh all`；Repository/Web/API 均为 `b0e5439`，状态 `CONSISTENT`。
- [x] `scripts/healthcheck.sh` 通过；Web、API、Swagger、OpenAPI、PostgreSQL 均健康，PostgreSQL 容器未重建。
- [x] Dispatcher 正式 user-systemd 单元 `kdos-notification-dispatcher.service` 为 enabled、active/running、`NRestarts=0`。
- [x] 线上入口引用 `assets/index-7AB5NqVY.js`，生产 bundle 已包含顶部删除确认、未选择禁用和 `canDelete` 阻止文案。

---

## 正在进行

- [ ] 等待用户真实线上人工验收。

---

## 待完成

- [x] 更新 `.agents/skills/kdos-form-platform/SKILL.md` 强制规则与最低验收项。
- [x] 增加公共组件和各迁移页面回归测试。
- [x] 运行定向测试、Web 全量测试、typecheck、lint、build。
- [x] 检查 diff、API/权限/审计边界与数据库无变更。
- [x] 提交、部署当前运行环境并完成健康检查和线上产物核验。
- [ ] 等待用户人工验收；验收前保持“等待人工验收 / NO-GO”。

---

## 修改文件

- `.agents/skills/kdos-form-platform/SKILL.md`
- `apps/web/src/shared/KdosDataTable.tsx`
- `apps/web/src/shared/KdosDataTable.spec.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanPages.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanPages.spec.tsx`
- `apps/web/src/modules/equipment/EquipmentPages.tsx`
- `apps/web/src/modules/equipment/EquipmentPages.spec.tsx`
- `apps/web/src/modules/marketing/MarketingPages.tsx`
- `apps/web/src/modules/marketing/MarketingPages.spec.tsx`
- `outputs/CODEX_PROGRESS.md`

---

## 数据库 Migration

- 无；预计复用现有删除 API/Application Service，不修改数据库结构。

---

## 新增或修改测试

- 公共顶部删除：无权限隐藏、有权限无选择禁用、浏览模式可用、混入 `canDelete=false` 时整体禁用、确认显示数量、调用正式回调并清除成功选择。
- 出货计划专项：`orderDate` 不承载删除、行级菜单无删除、顶部删除权限/选择/`canDelete`、编辑模式日期控件不回归。
- 设备状态：勾选后从顶部确认删除，并携带 optimistic `expectedVersion` 调用正式 API。
- 营销：业务人员与客户对应关系从顶部逐条调用带版本的正式 DELETE；订单排期从顶部复用正式 batch-delete API，均无行内删除列。

---

## 已运行测试

测试名称：Web 定向测试

结果：公共表格、主计划、设备定向 3 文件 63/63 通过；营销迁移页补充 2/2 通过。

测试名称：Web 全量测试

结果：28 文件、180/180 通过。

测试名称：Web typecheck / lint / build

结果：全部通过；lint 0 error，保留 1 个既有 Fast Refresh warning；build 仅有既有大 chunk 提示。本机 Node v22.23.1 低于项目声明的 Node >=24，但未影响本轮验证结果。

---

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 主计划和设备仍没有统一批量删除 API；当前公共兼容路径逐条调用正式 DELETE，部分失败会明确显示成功/失败数量与原因，并只保留失败选择。
- 用户尚未完成真实线上交互验收，因此即使部署和健康检查通过，最终结论仍必须为“等待人工验收 / NO-GO”。

---

## 等待用户确认

- 请按最终人工验收清单验证：出货计划无行内删除；顶部删除与筛选同区；未选禁用；单选/多选可用；无权限隐藏；存在 `canDelete=false` 时整体阻止；确认后才调用删除；其它已迁移标准表行为一致。
- 当前任务结论：`等待人工验收 / NO-GO`，不得在用户验收前判 PASS。

---

## 下一步

1. 用户执行真实线上人工验收。
2. 若发现交互偏差，按本节测试和验收清单继续修复并重新部署。
3. 用户明确验收通过后，才将任务改判 PASS。

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md 与 `.agents/skills/kdos-form-platform/SKILL.md`
2. 读取本进度文件顶部“当前任务”
3. 执行 `git status` 与 `git diff --stat`
4. 从顶部“下一步”的第一项未完成任务继续

---

## 任务

任务名称：KDOS-SHIPPING-ORDER-DATE-ACTION-001 出货计划右固定操作列错位修复

任务目标：在公共 KdosDataTable 层保证 fixed left / 普通列 / fixed right 的最终稳定顺序，修复特殊操作列显式 52px 宽度被业务字段默认 96px minWidth 放大的问题，并完成出货计划及受影响标准表回归、部署和线上健康核验。

当前状态：代码修复、验证、提交和正式部署均已完成；等待用户线上人工验收，验收前不判 PASS。

最后更新时间：2026-10-04

---

## 当前阶段

当前阶段：已部署，等待人工验收

当前子任务：请用户在线验证出货计划普通/编辑模式、无/有删除权限及横向滚动后的固定列位置。

---

## 已完成

- [x] 读取当前任务、项目 AGENTS.md 与完整 kdos-form-platform 技能规范。
- [x] 重新确认基线：HEAD `fec4cf23d4bd86f0a72dd1e9a57873751ebf5357`，无未知源码修改。
- [x] 确认生产基线仍为 Web `4349f0b` / API `fec4cf2` / Repository `fec4cf2`，状态 MISMATCH。
- [x] 第一阶段确认：`orderDate` 单元格与 `__rowActions` 是不同 DOM 单元格；错误来自 right-fixed 列位于审计列之前及特殊列宽被放大。
- [x] 公共 `KdosDataTable` 在审计列、个人视图、冻结等 augmentation 完成后稳定分组为 left-fixed → normal → right-fixed，各组保持原相对顺序。
- [x] 平台技术列按“显式 minWidth → 显式 width → 平台默认”计算最小宽度，`__rowActions` 恢复为 52px。
- [x] 出货计划操作列增加稳定 `kdos-row-actions-column` 语义 class，未改变删除权限或显示语义。
- [x] 增加公共列模型、审计列顺序、多右固定列、左固定列、隐藏审计列、特殊/业务列宽、出货计划 DOM/权限/日期编辑回归。
- [x] 审计所有公共表格 right-fixed 使用点；各页面操作内容和权限语义保持不变。
- [x] Web 全量测试 27/27 文件、174/174 测试通过；typecheck、lint、build 通过。
- [x] 提交 `2be04d3 fix(web): stabilize fixed action columns`。
- [x] 执行 `./scripts/deploy.sh all`，Repository/Web/API 均为 `2be04d3`，状态 CONSISTENT。
- [x] Web、API、PostgreSQL 均 healthy；Dispatcher active/running、NRestarts=0。
- [x] 线上 build-info 为完整提交 `2be04d3a97ac4174eea35a862736184e4478e4bf`，生产 bundle 已包含 `kdos-row-actions-column`。

---

## 正在进行

- [ ] 等待用户线上人工验收。

---

## 待完成

- [x] 运行公共组件、主计划及其它受影响表格定向测试。
- [x] 运行 Web full tests、typecheck、lint、build。
- [x] 检查 diff、安全边界和无数据库变更。
- [x] 提交并执行正式 `./scripts/deploy.sh all`。
- [x] 确认 Repository/Web/API SHA 一致及 Web/API/PostgreSQL/Dispatcher 健康。
- [ ] 等待用户线上人工验收；未验收前不得判 PASS。

---

## 修改文件

- `apps/web/src/shared/KdosDataTable.tsx`
- `apps/web/src/shared/KdosDataTable.spec.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanPages.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanPages.spec.tsx`
- `outputs/CODEX_PROGRESS.md`

---

## 数据库 Migration

- 无；本任务未修改数据库结构或业务数据。

---

## 新增或修改测试

- 公共最终列稳定分组：left + normal + right、多个 right 相对顺序。
- 审计列追加后操作列仍在最右，隐藏审计列后同样成立。
- `__rowActions width=52` 不再被 96px 默认 minWidth 放大，普通业务字段继续应用类型化 minWidth。
- 出货计划 `orderDate` 与操作列 DOM 分离、有/无删除权限、日期编辑器不回归。

---

## 已运行测试

测试名称：基线检查；KdosDataTable 定向；MasterPlanPages 定向；项目/任务、设备、消息规则、成员管理回归

结果：公共组件 15/15、主计划 33/33、其它受影响页面 25/25、Web 全量 27 文件 174/174 全部通过；typecheck 通过；lint 0 error（1 条既有 Fast Refresh warning）；build 通过（仅既有 chunk size warning）。正式部署后 Repository/Web/API 均为 `2be04d3` 且 CONSISTENT，全部相关服务健康。

---

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 本机测试使用 Node.js 22 并出现项目要求 Node.js 24 的 engine warning；正式部署镜像使用 Node.js 24 且构建通过。
- lint 保留 1 条既有 `ModulePortal.tsx` Fast Refresh warning；build 保留既有大 chunk warning，均非本任务引入且没有 error。

---

## 等待用户确认

- 等待用户线上人工验收；验收前状态保持“等待人工验收”，不得标记 PASS。

---

## 下一步

1. 用户在线验证出货计划普通模式、编辑模式、有/无 delete permission、横向滚动与窗口变化。
2. 人工确认下单日期旁不再出现 `⋯`，独立最右操作列保持正常后，再将任务判为 PASS。

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md 与 `.agents/skills/kdos-form-platform/SKILL.md`
2. 读取本进度文件顶部本任务
3. 执行 `git status` 与 `git diff --stat`
4. 从“下一步”的第一项未完成任务继续

---

# Codex 工作进度

## 任务

任务名称：主计划 Excel 与现有周计划差集导入出货计划表

任务目标：读取 `/home/Jerry/下载/主计划.xlsx`，按“订单号 + 品号”与当前运行环境的事业部周计划比较，只将周计划中不存在且满足正式字段校验的记录通过应用导入链路写入出货计划表。

当前状态：已完成；533 条差集记录已通过正式预览/确认链路导入当前运行环境，并完成逐键逐字段、审计、幂等和健康核验。

最后更新时间：2026-09-30

---

## 当前阶段

当前阶段：交付完成

当前子任务：无。

---

## 已完成

- [x] 读取当前适用的 AGENTS.md 与 KDOS 表单/导入技能。
- [x] 检查 Git 状态与现有进度文件；开始时工作区无源码或配置修改。
- [x] 确认出货计划正式新增必填字段与统一 Excel 预览/确认入口。
- [x] 使用平台统一检测器检查源文件，结果为未加密，文件大小 313473 字节。
- [x] 只读确认源工作簿为“主计划”，1183 行；业务表头位于第 1/2 行。
- [x] 通过 MasterPlanQueryService 只读确认当前事业部周计划共 1169 条。
- [x] 标准化源表：1181 个非空行中，1107 条满足订单号、品号、品名、数量、客户编码和交期等业务字段要求；74 行为分组标题、备注或不完整行，不作为业务数据。
- [x] 按订单号 + 品号比较：538 个源行不在周计划；其中 2 行已经存在于出货计划表，按防重原则跳过。
- [x] 净新增为 536 个源行、533 个唯一业务键；3 个重复键分别为 `2026A027409 + TGH640KB-1/1`（7+4）、`2026A027409 + TGH642KB-1/1`（10+4）、`2026A027409 + TGJ535BD1-1/1`（9+5）。
- [x] 只读确认出货计划当前 478 条；已存在并跳过的 2 条为 `2026A027399 + GKP391KB-1/1`、`2026A027399 + GFE753KB-1/1`。
- [x] 确认当前出货计划导入窗口开放，应用未返回 blockedReason。
- [x] 用户确认 533 个业务键全部属于“凯南 / 事业四部”，3 个重复键合并累加，`/` 新旧款留空。
- [x] 重新读取当前组织目录并唯一解析“凯南 / 事业四部”为稳定 ID `d23442f9-4862-4641-b4a7-c8d470bc56ea`。
- [x] 导入前完成正式备份并校验 SHA256：`four_department_tracker_20260930_170942.backup`、`kdos_20260930_170942.backup`、`uploads_20260930_170942.tar.gz`。
- [x] 按当前系统模板生成 533 条差集记录；源文件 SHA256 为 `34fe06afc1acaabe0c4eaeecabb4d4cf288455fe095139e4cda7c2ca3b1b0c17`，导入文件 SHA256 为 `891122ebbcae9348385e0514705146753406e4e868b6b2a7d27bbe362fb8b13e`。
- [x] 服务端导入预览 `01a0f198-8221-7e55-a244-aae97992d889`：533 行、0 错误、无 blockedReason。
- [x] 事务确认结果：`total=533 / created=533 / updated=0 / repeated=false`。
- [x] 导入后逐键逐字段核验 533/533 通过；客户编码、订单编号、品项编码、品项名称、日期、数量、事业部、新旧款、交期编码与周计划状态均无差异。
- [x] 出货计划从 478 条增至 1011 条（+533）；事业部周计划保持 1169 条不变。
- [x] 审计核验：533 条 `mps-shipping-plans.import_created` + 1 条 `mps-shipping-plans.import_confirmed`。
- [x] 重复确认返回 `repeated=true`，出货计划总数不变，幂等保护有效。
- [x] Web、API、PostgreSQL 均 healthy，API 与 Web 健康接口正常。

---

## 正在进行

- 无。

---

## 待完成

- 无。

---

## 修改文件

- `outputs/CODEX_PROGRESS.md`

---

## 数据库 Migration

- 无；本次是受控业务数据导入，没有结构变化。

生产数据：`mps_shipping_plans` 478 → 1011（新增 533）；`mps_weekly_plans` 保持 1169。

---

## 新增或修改测试

- 无代码改动；本任务使用导入预览、差集核对和导入后线上读回验证。

---

## 已运行测试

测试名称：统一 Excel 加密检测；差集与防重；系统预览/确认；逐键逐字段读回；审计；幂等；运行健康

结果：全部通过。导入预览 533/533、0 错误；确认新增 533；读回 533/533 无差异；审计 534 条；重复确认未二次写入；所有服务健康。

---

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 无未解决问题。
- 源表 74 行分组标题、备注或不完整行未作为业务数据；2 条已存在出货计划的记录按防重原则跳过。
- 源表 `新旧款=/` 已按用户确认规范为空值，没有编造“旧”。

---

## 等待用户确认

- 无。

---

## 下一步

1. 用户可直接在“计划管理 → 出货计划表”查看新增记录。
2. 后续重复处理同一源文件时必须继续按周计划与出货计划双重防重，不得再次新增这 533 条。

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md
2. 读取 `.agents/skills/kdos-form-platform/SKILL.md`
3. 读取本进度文件顶部本任务
4. 执行 `git status` 与 `git diff --stat`
5. 检查源文件仍为 `/home/Jerry/下载/主计划.xlsx`
6. 从“下一步”的第一项未完成任务继续

---

# Codex 工作进度

## 任务

任务名称：KDOS-NOTIFICATION-EVENT-REGISTRY-006 通知事件注册中心与通知内核通用化

任务目标：建立唯一 Notification Event Registry，将现有设备故障事件迁入注册中心，移除通知 claim 主流程的设备资源硬编码，并保持接收人动态解析、TEST MODE、Dispatcher 契约和消息格式兼容。

当前状态：已完成

最后更新时间：2026-09-30

---

## 当前阶段

当前阶段：交付完成

当前子任务：阶段 1 已收口；阶段 2 出货 / 备货计划变化为下一任务，本次未开始。

---

## 已完成

- [x] 阅读任务说明、项目架构、安全与集成边界、KDOS 专项技能和现有进度。
- [x] 检查 Git：开始时工作区干净，HEAD 为 `44f8ced`。
- [x] 定位设备专用硬编码和现有接收人、TEST MODE、Dispatcher 边界。
- [x] 确认无数据库结构变化，不创建 migration。
- [x] 新增唯一 Notification Event Registry，并仅注册 `equipment.status.fault_changed`。
- [x] 管理端事件列表、模板变量、规则校验、测试发送统一读取 Registry。
- [x] claim 流程按 Registry 先隔离未注册事件，再校验规则资源和允许的接收规则。
- [x] 接收人解析拆分为统一 dispatcher、设备责任人 resolver 和配置对象 resolver。
- [x] 保持 FIXED_USERS 的 USER / ORGANIZATION / ROLE、混合选择、动态关系、去重和旧 `recipientUserIds` 读取兼容。
- [x] 保持设备触发条件、消息格式、强制 TEST MODE 和 Python Dispatcher 业务无感。
- [x] 建立并维护 `docs/KDOS_企业微信通知开发总控.md`，阶段 2 仅标记为下一步。
- [x] 完成通知专项及全量质量门禁。
- [x] 核心实现提交 `83a9fe1` 已推送 `github/main`。
- [x] API-only 部署成功；API Build 与实施提交一致，正式容器使用 Node.js 24。
- [x] Web/API/OpenAPI/Swagger HTTP 200，API/Web/PostgreSQL healthy。
- [x] Dispatcher user-systemd `active/running`、`NRestarts=0`，持续正常空队列轮询。
- [x] 部署容器 Registry 只包含设备故障正式事件和 11 个模板变量。
- [x] 生产数据只读确认最近正式链路为 `equipment.status.fault_changed / SENT / TEST MODE / CuiWeiJie`；本轮未制造新业务数据或重复实发。

---

## 正在进行

- 无。

---

## 待完成

- 无；阶段 2 属于下一独立任务。

---

## 修改文件

- `apps/api/src/modules/notifications/notification-event.registry.ts`
- `apps/api/src/modules/notifications/notification-event.registry.spec.ts`
- `apps/api/src/modules/notifications/notification.types.ts`
- `apps/api/src/modules/notifications/notification-admin.service.ts`
- `apps/api/src/modules/notifications/notification-admin.service.spec.ts`
- `apps/api/src/modules/notifications/notification.service.ts`
- `apps/api/src/modules/notifications/notification.service.spec.ts`
- `docs/integration-guide.md`
- `docs/KDOS_企业微信通知开发总控.md`
- `outputs/CODEX_PROGRESS.md`

---

## 数据库 Migration

- 无；本任务只调整应用层注册与路由。

---

## 新增或修改测试

- Registry 唯一事件、正式元数据和变量标签。
- availableEvents / templateVariables 的 Registry 来源。
- 已注册事件正常 claim；未注册事件明确隔离。
- 规则资源不匹配和接收规则不允许时拒绝发送。
- EQUIPMENT_RESPONSIBLE 与 FIXED_USERS 的 USER / ORGANIZATION / ROLE / 混合去重。
- 原设备消息格式与 TEST MODE 多业务接收人单次实际投递。

---

## 已运行测试

测试名称：通知专项、API 全量、Web 全量、Dispatcher Python、全仓 lint/typecheck/build

结果：

- 通知专项：5 suites / 35 tests 通过。
- API 全量：79 suites 通过，1 suite 按既有规则跳过；607 tests 通过，1 test 跳过。
- Web 全量：27 files / 167 tests 通过；第一次并行负载下 1 个无关管理页用例超时，单测复跑与无并行负载全量复跑均通过。
- Dispatcher Python：6 tests 通过。
- 全仓 lint：通过（保留既有 `ModulePortal.tsx` fast-refresh warning，无 error）。
- 全仓 typecheck：通过。
- 全仓 build：通过（保留既有 Web chunk-size warning）。
- `git diff --check`：通过。

---

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 本机 Node.js 为 v22.23.1，低于项目目标 Node.js 24，pnpm 输出 engine warning；全部门禁实际通过，正式 API 镜像使用 Node.js 24 构建。
- Web 无代码修改，按任务要求未重建，因此 `deploy.sh check` 显示 Web Build 仍为 `4349f0b`；这不影响本次 API-only 交付，Web 服务健康。

---

## 等待用户确认

- 无。

---

## 下一步

1. 下一独立任务为阶段 2：出货 / 备货计划变化。
2. 开始阶段 2 前先读取 `docs/KDOS_企业微信通知开发总控.md` 和本进度顶部记录。
3. 不在本任务继续扩展其他事件或渠道。

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md
2. 读取 `.agents/skills/kdos-form-platform/SKILL.md`
3. 读取本进度文件顶部本任务
4. 执行 `git status` 与 `git diff --stat`
5. 检查未完成修改
6. 从“下一步”的第一项未完成任务继续

---

# Codex 工作进度

## 当前任务：KDOS-RD-INCREMENTAL-WATERMARK-MICROSECOND-003

任务目标：修复 E10 INCREMENTAL 复合 watermark 在时间格式不一致时不推进的问题，保留微秒精度、稳定复合游标语义，验证 E10 reader，并完成部署后的两次真实 INCREMENTAL 核验。

当前状态：已完成代码修复、测试、API-only 部署、健康检查及真实 INCREMENTAL 核验；未手工修改数据库 watermark。

最后更新时间：2026-09-30

### 已完成

- [x] 定位根因：源时间 `YYYY-MM-DD HH:mm:ss.ffffff` 与 JS ISO 时间字符串直接比较，导致字典序错误；TypeORM `Date` 还会丢失微秒。
- [x] 增加固定六位微秒的 watermark 规范化与复合 cursor 比较，保留 `(LastModifiedDate, ITEM_BUSINESS_ID)` 语义及 SQL Server GUID 排序。
- [x] 使用 PostgreSQL `to_char(...US)` 读取水位，写入时显式 UTC，API 返回保留六位微秒。
- [x] E10 reader 保留 2 分钟 overlap、`TOP 1000` 分批循环和 keyset 续读；时间条件、投影、排序统一到 `datetime2(6)`。
- [x] 增加源时间推进、微秒比较、同时间 GUID、overlap 重读、成功最大 cursor、失败不推进测试。
- [x] API 全量测试：78 suites 通过，1 suite 按项目规则跳过；599 tests 通过，1 test 按项目规则跳过。
- [x] API typecheck、lint、build、reader `py_compile`、同步脚本 `bash -n` 通过。

### 已完成

- [x] API-only 部署至 `5df12ba`，API Build 与仓库 HEAD 一致；健康检查通过。
- [x] 第一次真实 INCREMENTAL：run `01a0f120-26d2-70c3-aa0a-d03c771c2f2e`，185/16/81/88，watermark 从 `2026-09-30 13:47:09.000000` 推进到 `2026-09-30 15:01:11.000863`，增量查重 COMPLETE。
- [x] 后续真实 INCREMENTAL：run `01a0f121-d856-7054-8305-fa2c457133d6` 读取 overlap 并发现 25 个变化，查重 COMPLETE；再次验证 run `01a0f122-6891-7bbb-95f4-cab2dca4fd63` 为 25/0/0/25、无查重任务，脚本退出码 0，水位保持不回退。
- [x] 当前数据库有效水位为 `2026-09-30 15:04:49.000992` + `a9a61eeb-eeea-4fdc-c761-1dfd01e4921a`，rd_items 共 574,951 条，正好对应当前最大源 cursor。

### 修改文件

- `apps/api/src/modules/rd/rd-watermark.ts`
- `apps/api/src/modules/rd/rd-watermark.spec.ts`
- `apps/api/src/modules/rd/rd.application.service.ts`
- `apps/api/src/modules/rd/rd.application.service.spec.ts`
- `apps/api/src/modules/rd/rd-history-scan.service.ts`
- `data-operations/e10/rd_reader.py`
- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration / 生产数据

- 无 migration。
- 未手工修改 watermark；未触发 FULL；未修改 E10 只读规则、rd_items 业务字段、查重算法或 n8n 调用方式。

### 下一步

1. 保留本节作为 watermark 修复和生产核验记录。

---

# Codex 工作进度

## 当前任务：KDOS-RD-INCREMENTAL-CHANGED-ID-AND-WAIT-002

任务目标：修复 E10 增量同步中 updated 物料 ID 未完整传入一物多码维护的问题，并让生产 shell 脚本等待增量查重真正完成后再返回退出码。

当前状态：已完成代码修复、内部状态轮询接口、定向/全量 API 验证、脚本 mock 验证和 API-only 部署。

最后更新时间：2026-09-30

### 已完成

- [x] 修复 TypeORM `UPDATE ... RETURNING` 的 `[rows, affectedCount]` 返回形状，确保 updated item ID 不再变成 `undefined`。
- [x] 增加 214 created + 13 updated = 227 changed IDs 回归测试。
- [x] 增加 token 保护的内部扫描状态查询，供 SSH 脚本轮询现有扫描状态数据。
- [x] 脚本等待 `RUNNING` 扫描，`COMPLETE` 返回 0，`FAILED`/超时返回非 0；不触发 FULL。

### 修改文件

- `apps/api/src/modules/rd/rd.application.service.ts`
- `apps/api/src/modules/rd/rd.application.service.spec.ts`
- `apps/api/src/modules/rd/rd.controller.ts`
- `apps/api/src/modules/rd/rd.query.service.ts`
- `apps/api/src/modules/rd/rd.query.service.spec.ts`
- `data-operations/rd-sync/sync-rd-items.sh`
- `outputs/CODEX_PROGRESS.md`

### 部署与真实核验

- API-only deploy：成功；无 migration。
- 健康检查：Web、API、Swagger、OpenAPI、PostgreSQL 通过。
- 第一次查重：scan `01a0f120-2af7-75a6-95cd-2899bbb6242d`，COMPLETE，574,926 条物料。
- 后续查重：scan `01a0f121-db14-7588-80a5-c26c9d0537cd`，COMPLETE，574,951 条物料。
- 未触发 FULL；n8n 调用路径保持不变。

### 测试

- 定向 API：3 suites，12 tests 通过。
- API 全量：77 suites 通过，1 suite 按项目既有规则跳过；593 tests 通过，1 test 按项目既有规则跳过。
- API typecheck/lint/build：通过。
- shell syntax：通过。
- mock 脚本 RUNNING→COMPLETE：退出码 0。
- mock 脚本 RUNNING→FAILED：退出码非 0。
- 未执行真实 E10 同步或 FULL 查重。

### 下一步

1. 保留本节，后续真实 E10 增量执行后复核 214+13=227 的生产结果。

### 部署记录

- 提交：b552ce4 fix(rd): preserve updated items and wait for scan
- API-only deploy：成功；API Build 与仓库 HEAD 均为 b552ce4。
- 健康检查：Web、API、Swagger、OpenAPI、PostgreSQL 通过。
- 部署后只读状态接口验证：已存在的 INCREMENTAL 扫描返回 COMPLETE。
- 未执行真实 E10 同步、FULL 查重或 migration。

---

## 当前任务：KDOS-RD-DAILY-INCREMENTAL-SYNC-SCRIPT-001

任务目标：新增生产用 `data-operations/rd-sync/sync-rd-items.sh`，调用研发中心 E10 INCREMENTAL 内部同步接口，复用生产 token/租户配置，并以可靠退出码供 n8n SSH Command 调用。

当前状态：已完成脚本、语法检查、成功/失败路径验证，待提交。

最后更新时间：2026-09-30

### 已完成

- [x] 从当前运行环境或项目根目录 `.env` 读取 `KDOS_RD_INTERNAL_TOKEN`。
- [x] 从 `KDOS_DEFAULT_TENANT_CODE` 读取租户；未配置时沿用 API 默认租户 `KAINAN`。
- [x] 固定调用 `POST /api/v1/internal/rd/items/sync` 和 `{"mode":"INCREMENTAL"}`。
- [x] HTTP、JSON 同步状态和重复维护失败均返回非 0；成功返回 0。
- [x] 增加并发锁，避免 n8n 重复触发 E10 增量同步。
- [x] 未执行真实 E10 同步；使用 mock API 验证成功路径，使用不可用 API 验证失败路径。

### 修改文件

- `data-operations/rd-sync/sync-rd-items.sh`
- `outputs/CODEX_PROGRESS.md`

### 测试

- `bash -n data-operations/rd-sync/sync-rd-items.sh`：通过。
- mock API：请求头、路径、请求体正确，退出码 0。
- 不可用 API：退出码非 0。
- `git diff --check`：通过。

### 部署说明

- 无 API/Web/数据库变更，不需要重启服务或运行 migration。
- 脚本位于生产共享路径，提交后 n8n 可直接通过绝对路径执行。

---

## 当前任务：KDOS-RD-INCREMENTAL-DUPLICATE-MAINTENANCE-001

任务目标：核对并完善 E10 INCREMENTAL 成功后的研发中心一物多码增量维护闭环；只让本批新增/修改物料进入增量计算，比较当前租户全库，维护 rd_item_features 与历史重复关系，保留 E10 watermark 语义，不自动触发 FULL。

当前状态：已完成源码核对、失败隔离、自动重试补齐、API-only 部署和部署后核验。

最后更新时间：2026-09-30

### 当前阶段

当前阶段：E10 增量同步与历史查重维护链路核对

当前子任务：验证自动触发、全库比较、特征维护、旧关系替换、失败重试和 watermark 边界。

### 已完成

- [x] 确认 E10 RdApplicationService.sync() 收集 upsertItems() 返回的 changedItemIds。
- [x] 确认已有同步成功后的自动调用：historyScan.start(actor, "INCREMENTAL", changedItemIds)。
- [x] 确认历史扫描读取租户全量 rd_items，scanChangedPreparedRows 只重算变化相关关系。
- [x] 确认 rd_item_features 按 item version/hash 更新，增量持久化保留未受影响组、重建受影响组。
- [x] 读取当前 PostgreSQL 运行状态：rd_items 特征覆盖 574,544/574,544；最近成功 E10 INCREMENTAL 为 18 行、16 新增；最近已完成扫描记录包含 INCREMENTAL。
- [x] 发现当前代码在后台查重失败后缺少下一次无变更同步的自动重试，且 INCREMENTAL 无历史基线会回退 FULL。
- [x] 增加 watermark 成功更新命中校验，未命中时不标记同步成功。

### 正在进行

- [x] 让 INCREMENTAL 无基线记录失败而不自动 FULL。
- [x] 让查重维护失败不影响 E10 已提交数据，并在 rd_duplicate_scans 记录失败。
- [x] 让下一次 E10 INCREMENTAL 在无新变更时自动重试最近失败维护；重试按历史基线时间找回之前失败批次。
- [x] 完成 API 全量回归、构建、部署前检查。
- [x] 完成 API-only 部署和部署后运行核验。

### 修改文件

- apps/api/src/modules/rd/rd.application.service.ts
- apps/api/src/modules/rd/rd.application.service.spec.ts
- apps/api/src/modules/rd/rd-history-scan.service.ts
- apps/api/src/common/filtering/table-filter-registry.spec.ts
- outputs/CODEX_PROGRESS.md

### 数据库 Migration / E10

- 无 migration。
- 未执行 E10 FULL/INCREMENTAL，不修改 SQL Server、rd_items、watermark 或历史结果。

### 测试

- 定向 API：3 suites，20 tests 通过。
- API 全量：77 suites 通过，1 suite 按项目既有规则跳过；591 tests 通过，1 test 按项目既有规则跳过。
- API typecheck：通过。
- API lint：通过。
- API build：通过。
- `git diff --check`：通过。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 本轮未运行 E10 同步和 FULL 查重，因此未做真实同步触发压力/耗时测试。
- 线上真实 E10 INCREMENTAL 最近一次仍为 18 行、16 新增，发生在本轮部署前；下一次真实增量同步才会执行本轮增强后的闭环。

### 下一步

1. 保留本节作为后续真实 E10 INCREMENTAL 运行后的复核入口。

### 部署记录

- 提交：6511fee fix(rd): maintain duplicate results after incremental sync
- API-only deploy：成功；API Build 与仓库 HEAD 均为 6511fee。
- 健康检查：Web、API、Swagger、OpenAPI、PostgreSQL 通过。
- 部署后只读核验：rd_items=574,544；rd_item_features=574,544，覆盖 574,544 个物料；部署前后最新同步/扫描记录未变化。
- 未执行 E10 INCREMENTAL/FULL，不触发新增业务扫描，不运行 migration。

---

## 当前任务：KDOS-RD-MATERIAL-DUPLICATES-PERMISSIONS-001

任务目标：在现有 KDOS resource/action 权限体系中补齐研发中心“一物多码查询”独立 read 权限的注册展示，并确保菜单、路由、查询 API 与全量计算 API 按 `rd-material-duplicates:read/update` 一致拦截；不修改查重算法、同步、数据库结果或 RLS。

当前状态：已完成权限注册展示、前端入口拦截、API/Web 测试、类型检查、lint、构建、Web-only 部署和部署后浏览器验收。

最后更新时间：2026-09-30

### 当前阶段

当前阶段：权限注册与前后端权限边界核对

当前子任务：增加资源级动作显示名，接入研发中心一物多码菜单/路由 read 校验，并补充三类权限用户测试。

### 已完成

- [x] 确认 `rd-material-duplicates` 已在统一 `tableResourceRegistry` 注册，`moduleCode=rd`。
- [x] 确认后端查询相关接口已经使用 `rd-material-duplicates:read`，FULL 扫描已经额外使用 `rd-material-duplicates:update`。
- [x] 确认前端目前仅用 update 控制“全量计算”，但研发中心一物多码菜单和路由尚未使用 read 控制。

### 正在进行

- [x] 补齐资源动作中文名称并接入现有权限配置页。
- [x] 补齐前端菜单、路由和权限管理入口的现有体系复用。
- [x] 增加 API/Web/权限 UI 测试并完成部署前验收。

### 待完成

- [x] Web tests、API tests、typecheck、lint、build。
- [x] Web-only 部署与健康检查。
- [x] 三类权限用户浏览器验收并形成最终报告。

### 修改文件

- packages/contracts/src/index.ts
- packages/contracts/src/index.test.ts
- apps/web/src/App.tsx
- apps/web/src/modules/portal/ModulePortal.tsx
- apps/web/src/modules/permissions/TablePermissionsPage.tsx
- apps/web/src/modules/rd/RdPages.tsx
- apps/web/e2e/rd-ui.spec.ts
- apps/api/src/modules/rd/rd.query.service.spec.ts
- apps/api/src/modules/rd/rd-history-scan.service.spec.ts
- outputs/CODEX_PROGRESS.md

### 数据库 Migration

- Contracts：22/22 通过。
- API 研发中心权限定向测试：2 suites、6 tests 通过。
- Web 单元测试：27 files、167 tests 通过。
- Web E2E rd-ui.spec.ts：6/6 通过（管理员计算、read-only 查询、无 read 拦截、权限管理展示及既有 UI）。
- Web/API/contracts typecheck：通过。
- Web/API lint：通过；保留项目既有 ModulePortal.tsx Fast Refresh warning。
- workspace build：通过；保留既有 Web 大 chunk warning。
- git diff --check：通过。

### API / 算法 / 同步

- 无计划修改。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 首次错误传入 E2E grep 参数导致启动全量 E2E，已中止；其中其他模块登录测试失败与本任务无关，之后直接运行 rd-ui.spec.ts 6/6 通过。

### 下一步

1. 保留部署记录，后续若继续研发中心权限工作从本节恢复。

### 最终部署记录

- 提交：4349f0b fix(rd): register duplicate query permissions
- Web-only deploy：成功；Web Build 与仓库 HEAD 均为 4349f0b。
- API：未修改生产源码、未重启，继续运行原版本。
- 健康检查：Web、API、Swagger、OpenAPI、PostgreSQL 通过。
- 部署后浏览器：E2E_BASE_URL 指向 127.0.0.1:15172，rd-ui.spec.ts 6/6 通过。
- 数据库、E10 同步、watermark、历史扫描结果：未修改。

### 恢复执行说明

继续本任务时，先检查本节、`git status` 与 `git diff --stat`；沿用现有权限注册和后端校验，不重做已完成的查重、扫描或同步实现。

---

# 当前任务：KDOS-RD-FRONTEND-COPY-002

任务目标：仅调整研发中心前端用户可见文案，明确快速检索的真实排序依据，移除研发中心英文模块标题和开发过程描述；不修改 API、算法、业务逻辑、路由、moduleCode、数据库或同步。

当前状态：已完成前端文案调整、验证及 Web-only 部署。

最后更新时间：2026-09-29

## 文案对照

| 位置 | 原文 | 新文案 |
| --- | --- | --- |
| 快速检索说明 | 输入品名、规格后自动检索近期物料；结果直接显示在输入区下方。 | 输入品名、规格后，系统自动按最后修改时间倒序，在当前物料库最近 5,000 条物料中检索相似候选；点击“查找最近 2 万条”可将检索范围扩大至最近 20,000 条物料。 |
| 历史检测说明 | 结果按旧 Demo 的候选对照结构展示，默认聚焦高相似候选。 | 用于对历史物料进行相似性检测，帮助识别可能存在的一物多码、名称规格一致、同名规格缺失及同品号多记录等情况。默认展示高相似候选，供人工核对。 |
| 历史检测标题 | 历史物料全库检测 | 历史物料检测 |
| 研发中心门户卡片/侧栏 | R&D CENTER / 研发中心 | 研发中心 |

## 后端排序核对

- 快速检索 API 使用 `last_modified_at_source DESC NULLS LAST, id DESC`。
- `last_modified_at_source` 来源于 E10 `LastModifiedDate`，不是 `ModifiedDate`。
- `limit` 非 10 时读取最近 5,000 条；`limit=10` 读取最近 20,000 条。
- 以上仅用于确定展示文案，本轮未修改后端。

## 当前阶段

当前阶段：前端展示文案适配

当前子任务：更新研发中心说明、标题及浏览器文案回归断言。

## 已完成

- [x] 核对后端最近 5,000/20,000 条真实排序与字段映射。
- [x] 修改研发中心用户可见说明和历史检测标题。
- [x] 隐藏研发中心门户卡片和侧栏英文标题，保留内部 `englishTitle` 字段不变。

## 正在进行

- [x] Web-only deploy、健康检查和浏览器核验。

## 待完成

- [x] 部署后浏览器核验并记录结果。

## 修改文件

- `apps/web/src/modules/rd/RdPages.tsx`
- `apps/web/src/modules/portal/ModulePortal.tsx`
- `apps/web/src/App.tsx`
- `apps/web/e2e/rd-ui.spec.ts`
- `outputs/CODEX_PROGRESS.md`

## 数据库 Migration

- 无。

## API / 算法

- 无修改。

## 已运行测试

- Web 全量：27 个测试文件、164 个测试通过。
- Web typecheck：通过。
- Web lint：通过，保留项目原有 `ModulePortal.tsx` Fast Refresh warning。
- Web build：通过，保留项目原有大 chunk warning。
- `git diff --check`：通过。
- Web-only deploy：成功，Web Build 与仓库 HEAD 一致。
- 健康检查：Web、API、Swagger、OpenAPI、PostgreSQL 通过。
- 部署后浏览器：R&D UI 2 个场景通过。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 无。本轮 API 仍保持线上版本 `7dff48f`，未重启 API。

## 下一步

1. 后续如继续研发中心前端工作，先读取本进度文件和当前 Git 状态。

# 当前任务：KDOS-RD-FRONTEND-UI-001

任务目标：在不修改 E10 同步、PostgreSQL 表结构、查重/score/history scan 算法、API 业务逻辑、权限、RLS、n8n 或 migration 的前提下，将旧 Demo 的一物多码检测交互与物料数据页信息结构迁移到 KDOS 前端。

当前状态：前端适配、定向测试、Web typecheck、lint、build、Web-only 部署和部署后浏览器验收已完成。

最后更新时间：2026-09-29

## 旧界面 vs 当前 KDOS 对照清单

| 旧界面功能 | 旧文件 | 当前 KDOS 实现 | 是否一致 | 本轮处理 |
| --- | --- | --- | --- | --- |
| 快速查重布局 | `preview/duplicates.html` | 独立 Card，手动点击“开始检测” | 否 | 品名/规格置顶，结果紧邻输入区 |
| debounce | `preview/duplicates.html`，350ms | 无，只有手动请求 | 否 | 恢复 350ms 自动检索 |
| 近期 5000 | `preview/duplicates.html`，输入时 `window=5000` | 未显式区分窗口 | 否 | 保留自动预览并显示检索范围 |
| 最近 20000 | `preview/duplicates.html`，按钮/Enter `window=20000` | 未显式区分窗口 | 否 | 按当前 API 的 `limit=10` 等价调用 |
| Top N | `preview/duplicates.html`，Top 5 | 只有 InputNumber，默认 5 | 部分一致 | 增加 Top 5/Top 10 选择并保持 API limit |
| 开始扫描 | `preview/duplicates.html` | 有开始扫描 | 基本一致 | 保留并补齐扫描区结构 |
| 重新扫描 | `preview/duplicates.html`，完成后改名 | 始终显示“开始扫描” | 否 | 完成后显示“重新扫描” |
| 扫描状态 | `preview/duplicates.html`，idle/running/complete/failed | 仅有部分状态文字 | 否 | 明确显示四态与运行中反馈 |
| 扫描统计 | `preview/duplicates.html`，summary/coverage | 仅物料、比较、跳过的简略文字 | 否 | 统计条展示物料、时间、四类数量、pairs、skips |
| exact/similar/missing/code | `preview/duplicates.html`，默认 similar，其他在说明/统计 | 只渲染当前 groups，无分类切换 | 否 | Segmented 分类切换，默认 similar |
| 筛选 | `preview/duplicates.html`，品号/品名/规格/最低分/重置 | 无历史筛选控件 | 否 | 恢复紧凑筛选并接当前扫描查询参数 |
| 分页 | `preview/duplicates.html`，20/50/100 | 历史结果固定 pageSize=50，无分页 UI | 否 | 恢复 20/50/100 与翻页状态 |
| A/B 对比 | `preview/duplicates.html`，候选组上下两行 | 扁平 `rd-ab-row`，多记录索引比较 | 否 | 候选组卡片内固定 A vs B 双栏 |
| 字符差异 | `preview/duplicates.html` + `test_diff_highlight.cjs`，LCS | 仅共同前缀后的字符全标红 | 否 | 前端复刻 LCS diffParts；不改算法/API |
| 空值标识 | `preview/duplicates.html`，差异时红色“（空）” | 仅空左侧有简单标记 | 否 | 两侧空值明确显示“（空）”并标记差异 |
| reason | `preview/duplicates.html` | 只在 live 小字中拼接，历史弱化 | 否 | A/B 候选卡片显式展示判断依据 |
| warnings | `preview/duplicates.html` | 历史未独立展示 | 否 | 候选卡片显式展示 warnings |
| 说明文案 | `preview/duplicates.html` | 只有简短 Alert | 部分一致 | 补充“分数非概率、不自动删除/合并、需人工确认” |
| 物料总数/当前筛选数 | `preview/index.html` | 仅 PageHeader 标签显示有效物料数 | 否 | 增加紧凑数据条，保留 KDOS 外层 |
| 搜索字段选择 | `preview/index.html` | KdosDataTable 自带通用搜索，未提供选择器 | 否 | 增加品号/品名/规格/全部选择；不改变现有 API |
| 品号/品名/规格及原始字段 | `preview/index.html` | 已有 KDOS 表格列，字段更完整 | 基本一致 | 保持 KdosDataTable，优化密度与空值显示 |
| 25/50/100 分页 | `preview/index.html` | 继承 KDOS 统一分页能力 | 有意不同 | 保留 KDOS 统一 50/100/200/500/1000 选项，避免修改公共表格标准 |

## 当前阶段

当前阶段：前端页面适配

当前子任务：实现快速检索 debounce、扫描统计/筛选/分类、A/B LCS 对比和物料页紧凑搜索条。

## 已完成

- [x] 完整阅读旧 `duplicates.html`、`index.html`、`import.html`、候选组测试和差异高亮测试。
- [x] 完成旧界面与当前 KDOS 页面逐项对照并记录上表。

## 正在进行

- [x] 仅修改 Web 前端展示与交互；未修改 `apps/api/**`、数据库、migration、n8n 或 E10 链路。
- [x] 快速检索恢复 350ms debounce、近期 5000/最近 20000、Top 5/Top 10、reason 和 warnings。
- [x] 历史扫描恢复 idle/running/complete/failed、统计条、四类 Segmented、筛选、分页和 A/B 候选卡片。
- [x] 前端 LCS 字符差异、空值“（空）”标识已迁移，未改变后端 score 或查重算法。
- [x] 物料页保留 `KdosDataTable`，增加总数/筛选数和搜索字段入口。

## 待完成

- [x] 添加前端 LCS 展示工具测试和 R&D 浏览器验收场景。
- [x] `./scripts/deploy.sh web` 成功，最终 Web build 与仓库 HEAD 一致；API 未重启，未运行 FULL 同步、migration 或数据库写入。
- [x] 部署后浏览器验收 2/2 通过，Web/API/PostgreSQL 健康检查通过。

## 修改文件

- `apps/web/src/modules/rd/RdPages.tsx`
- `apps/web/src/modules/rd/rd-display.ts`
- `apps/web/src/modules/rd/rd-display.spec.ts`
- `apps/web/src/styles.css`
- `apps/web/e2e/rd-ui.spec.ts`
- `outputs/CODEX_PROGRESS.md`

## 数据库 Migration

- 无；本轮禁止修改。

## 新增或修改测试

- `apps/web/src/modules/rd/rd-display.spec.ts`：旧 diff 高亮用例、Unicode、空值、长文本。
- `apps/web/e2e/rd-ui.spec.ts`：快速检索、历史 A/B、统计和物料页入口浏览器验收。

## 已运行测试

- Web 全量：27 个测试文件、164 个测试通过。
- 浏览器：R&D UI 2 个场景通过。
- Web typecheck：通过。
- Web lint：通过，保留项目原有 `ModulePortal.tsx` Fast Refresh warning。
- Web build：通过，保留项目原有大 chunk warning。
- `git diff --check`：通过。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 当前 `rd-items` API 的 `search` 是统一搜索参数，旧 Demo 的 field-specific 查询不能通过新增后端参数实现；前端保留字段选择入口并明确当前接口行为，不修改 API 业务逻辑。

## 等待用户确认

- 无。

## 下一步

1. 只提交 `apps/web/**` 与本进度文件。
2. 执行 `./scripts/deploy.sh web`，不重启 API，不运行 FULL 同步。
3. 部署后执行 health/version check 与浏览器页面核验，确认 Git diff 未触及后端。

## 最终部署记录

- Web：最终 Web-only 部署完成，版本检查通过。
- API：保持既有线上版本 `7dff48f`，本轮未重启、未修改；因此全量 `deploy.sh check` 的 API/Repository SHA 不一致是本轮禁止 API 变更的预期结果。
- 数据库/E10：未执行 migration、同步或写入；既有扫描结果未重建。

## 恢复执行说明

新的 Codex 会话开始后先读取本任务段、执行 `git status` 与 `git diff --stat`，从“下一步”的第一项未完成工作继续；不重新运行 FULL 同步，不重复历史扫描。

# Codex 工作进度

## 当前任务：KDOS-RD-MATERIAL-DUPLICATE-001

任务目标：在现有 KDOS 中新增“研发中心（R&D CENTER，moduleCode=rd）”，接入 E10 只读物料同步、物料浏览、一物多码实时检测与持久化历史扫描；忠实迁移旧 Python Demo 实际已有的规则、分类、候选桶、批量测试语义和 A/B 差异展示，并完成测试、构建、部署与运行核验。

当前状态：已完成；代码、migration、E10 FULL/INCREMENTAL、历史扫描、备份、API/Web 部署和线上健康核验均通过。

开始 HEAD：`891d56f`

最终 HEAD：`0a033bf`

最后更新时间：2026-09-29

### 当前阶段

当前阶段：已完成（PHASE 5 生产迁移与运行核验）

当前子任务：保留最终运行记录、备份路径、测试结果和 n8n 调用说明，供后续维护恢复。

### 已完成

- [x] 已读取用户需求、项目 AGENTS、`kdos-form-platform` Skill、`ARCHITECTURE.md`、`SECURITY.md`、`README.md`、`docs/runbook.md`、`docs/integration-guide.md` 和现有工作区状态。
- [x] 已确认 `.codex-reference/**` 为只读；未修改旧项目或 E10 字典。
- [x] 已读取旧项目 `DEVELOPMENT_ARCHITECTURE.md`、`README.md`、历史扫描/导入文档、`preview/import_testing.py`、`preview/history_scan.py`、旧测试和脚本；源码确认旧项目未实现规则后台、AI、Embedding、向量检索、ERP 写入、正式持久化历史结果，本次不新增这些功能。
- [x] 旧 Python 测试基线：`test_history_scan.py` 及可运行的规则测试共 7 项通过；2 项 XLSX 测试因执行环境缺少 `openpyxl` 失败；Node 候选组测试因旧 `duplicates.html` 函数提取脚本在当前源码布局下未解析到 `groupCandidates`，未判定为迁移实现失败，需在 TypeScript 中建立等价测试。
- [x] 已通过正确的统一工具 `/data/automation/code/work/basci/basic_code` 的 `MSSQLDatabase` 读取 E10 配置；默认 `pytds` 的中文大字段路径存在编码异常，已确认工具包支持的 `pymssql/pyodbc` 在当前服务器不可用，后续只读抽样使用同一 `MSSQLDatabase` 配置和其已支持的 `pytds` 只读连接参数 `bytes_to_unicode=False`，未使用项目自建 SQL Server 连接或执行写操作。
- [x] E10 数据库真实连接：`E10_6.0.0.1.NEW.CHS`；SQL Server 实例名 `WIN-NGTCT9QIOMF`。
- [x] E10 字典真实解析：逻辑聚合实体 `GROUP_ITEM` 含 Complex `GI`；`GI` 主键/业务字段为 `ITEM_BUSINESS_ID`、`ITEM_CODE`、`ITEM_NAME`、`ITEM_SPECIFICATION`、`REMARK`，状态字段含 `STATUS`/`ApproveStatus`；聚合审计字段为 `CreateDate`、`LastModifiedDate`、`ModifiedDate` 和 `CreateBy`/`LastModifiedBy`/`ModifiedBy` Reference `USER`。
- [x] E10 物理元数据：`dbo.ITEM` 是 GI 品号数据表（574,494 行），`dbo.ITEM_GROUP` 是独立的 Item Group 表（3 行），数据库中不存在名为 `GROUP_ITEM` 或 `GI` 的物理表；`ITEM_GROUP_BUSINESS_ID` 与 `ITEM_BUSINESS_ID` 的真实抽样 JOIN 为 0 行，因此不能把 `ITEM_GROUP` 错当成物料主表。当前同步物料字段以 `dbo.ITEM` 为准，并保留逻辑 `GROUP_ITEM → GI` 映射说明。
- [x] E10 人员真实映射：`dbo.[USER].USER_ID → USER_NAME`；用户还关联 `EMPLOYEE_ID → dbo.EMPLOYEE.EMPLOYEE_ID → EMPLOYEE_NAME/EMPLOYEE_CODE`。真实抽样已确认普通用户能通过 Employee 取得姓名；系统集成账户可能无 Employee，必须回退 E10 `USER_NAME`，绝不向前端显示 Guid/人员代码。
- [x] E10 日期水位候选已确认 `dbo.ITEM.LastModifiedDate` 具备最新变化时间；同秒增量必须使用 `(LastModifiedDate, ITEM_BUSINESS_ID)` 复合游标并保留重叠窗口，FULL/INCREMENTAL 设计不得只用单一时间戳。
- [x] E10 只读抽样：`dbo.ITEM` 总量 574,494；抽样已返回真实品号、品名、规格、备注、状态、审核状态、创建/最后修改/修改日期及人员 Guid；未执行任何 INSERT/UPDATE/DELETE/MERGE/DDL/存储过程写操作。
- [x] 新增 `RdMaterialDuplicateDetection1722920076000` migration 草案：租户隔离的 `rd_items`、`rd_sync_runs`、`rd_duplicate_scans`、`rd_duplicate_groups`、`rd_duplicate_members`，均启用 RLS；尚未运行。
- [x] 新增 E10 只读适配器 `data-operations/e10/rd_reader.py`：通过共享 `MSSQLDatabase` 读取配置，使用其已支持的 pytds 只读连接参数处理中文，按 `LastModifiedDate + ITEM_BUSINESS_ID` 键集分页输出 NDJSON；已用 2026-09-29 17:49 水位抽样验证姓名、物料字段和增量结果。
- [x] 旧算法已迁移至 `apps/api/src/modules/rd/rd-duplicate-algorithm.ts`：NFKC/符号标准化、规格 token/数字、类别/材质/扳拧/头型/表面处理/语言属性、冲突、score/reason/warnings、实时 Top N、exact/similar/missing/code、120 大桶保护、A/B 差异 LCS。
- [x] 已新增 TypeScript Golden Tests：9 项通过，覆盖旧标签案例、规格/属性冲突、exact/missing/code、大桶跳过、差异字符/空值/Unicode。
- [x] 已新增研发中心 API 初版、资源注册、模块管理员代码 `rd`、Portal 模块/侧栏和两个 Web 页面；API typecheck 与 Web typecheck 已通过。
- [x] 已补齐 `rd-items` 与 `rd-material-duplicates` 的筛选能力登记；Web 全量回归 26 个测试文件、162 个测试通过。
- [x] API 全量回归 74 个测试套件通过、576 个测试通过（1 套件/1 测试按项目既有规则跳过）；API/Web build、API lint、Web lint、`git diff --check` 通过，Web 仅保留既有 Fast Refresh 警告。
- [x] API 镜像已验证可构建 Python 3 + `python3-tds`，只读挂载共享 `basic_code`；E10 读取器支持容器路径环境变量，未复制共享工具包密钥进仓库。
- [x] 已修复 E10 `uniqueidentifier` 游标比较、Node 子进程 close 竞态、PostgreSQL Date→ISO 水位序列化；FULL 成功 `rows_read=575044`、`created=41`、`updated=2`、`unchanged=575001`，随后 INCREMENTAL 成功读取 18 条（新增 16、未变化 2）。
- [x] 已执行备份：`data/backups/four_department_tracker_20260929_181943.backup`、`kdos_20260929_181943.backup`、`uploads_20260929_181943.tar.gz`；修复约束后第二次备份为 `*_20260929_183635.*`。
- [x] 已正式执行 migrations `1722920076000` 与 `1722920077000`；最终 `rd_items=574544`，`source_id` 无重复、空品号为 0，E10 人员姓名正常落库，RLS 五表策略存在。
- [x] 历史扫描已完成并提交：574544 行、588583 比较对、跳过 56 个大桶/18158444 对、98,926 个分组；exact=21210、similar=31682、missing=46025、code=9，成员持久化 284021 行。
- [x] API/Web 已部署并一致为 `0a033bf`；`/health`、`/api/v1/health`、部署版本检查全部通过；内部 token 未提交到 Git。

### 正在进行

- [x] 完成当前 KDOS Portal、App 路由、资源注册、权限模块管理员校验、数据库 schema/迁移和 Integration Adapter 入口盘点。
- [x] 将旧 Python `normalize/features/compare/rank_recent/scan_rows/get_result` 与 `diffParts` 的真实行为转成 TypeScript 纯函数和 Golden Tests；旧源码实际没有可解析的 `groupCandidates`，未凭测试脚本臆造该功能。
- [x] 完成 API 查询/同步/历史扫描代码审计：历史成员按 `rd_items.id` 回写，内部同步使用固定系统审计用户。
- [x] 完成生产数据库迁移实测和部署后 API/页面核验。

### 待完成

- [x] PostgreSQL 物料、同步运行、历史扫描运行/结果/成员持久化表及 migration 草案。
- [x] E10 FULL/INCREMENTAL 读取适配器、hash、水位、失败不推进、幂等和内部同步 API 初版。
- [x] 研发中心 API、Web Portal/导航、物料页、实时检测、历史扫描、A/B 差异初版。
- [x] 批量检测范围按需求收敛为文本粘贴/实时检测；未把 XLSX/CSV 导入做成正式生产接口。
- [x] n8n 内部 token 调用验证、生产 FULL/INCREMENTAL 同步和历史扫描实测。
- [x] 备份、migration、部署、health check、FULL/INCREMENTAL、历史扫描实测完成。

### 数据库 Migration

- [x] `1722920076000-RdMaterialDuplicateDetection.ts` 与 `1722920077000-RdMaterialAllowDuplicateCodes.ts` 已正式执行；E10 全程只读。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 旧项目 XLSX 测试依赖缺失，旧 Node 测试脚本与当前 HTML 函数布局不兼容；迁移测试必须在 KDOS TypeScript 中独立建立，不修改只读参考项目。
- `MSSQLDatabase.get_from_query()` 默认 pytds 中文数据路径存在编码异常；实现阶段必须复用统一工具配置/只读连接边界并集中处理 `bytes_to_unicode=False`，避免在业务模块直接依赖 SQL Server 客户端。
- E10 字典的逻辑 `GROUP_ITEM` 不是同名物理表；当前真实物料主表已确认是 `dbo.ITEM`，`dbo.ITEM_GROUP` 不与现存物料行建立有效 ID JOIN，必须在字段映射和最终报告中明确这一事实。
- Web 仍沿用平台全量回归，未新增研发中心专属组件测试；线上页面已随 `0a033bf` 部署，后续可补充更细粒度 UI 测试。
- `KDOS_RD_INTERNAL_TOKEN` 已在本机未跟踪 `.env` 配置为独立 token；n8n 必须使用同一部署环境 token，不能复用通知 token。

### 下一步

1. 后续 n8n 按 `docs/开发/研发中心物料同步与查重.md` 调用 INCREMENTAL；仅在受控初始化/重建时调用 FULL。
2. 关注 `rd_sync_runs`、`rd_duplicate_scans` 和备份目录，失败运行不推进水位。
3. 若需改动字段映射，先重新核对 E10 MHT 与真实 `dbo.ITEM` 元数据，再更新 migration/文档/测试。

---

# Codex 工作进度

## 当前任务：KDOS-TABLE-COMPACT-STANDARD-001 追加：标准业务表手工调整列宽与分页标准

任务目标：在既有标准业务表 compact 默认能力基础上，由 `KdosDataTable` 公共层统一提供可拖动列宽、个人列宽偏好持久化与字段/页面隔离；同时落实默认每页 100 条、可选 50/100/200/500/1000、后端最大 1000 的统一分页标准。

当前状态：公共实现、Skill/roadmap 同步、定向与全量测试、typecheck、lint、build、备份、正式部署和运行检查完成；等待用户人工验收。

开始 HEAD：`fcc24f960d257863776774d7616f9a7bf6a7ee9d`

最后更新时间：2026-09-29

### 当前阶段

当前阶段：公共列宽调整、个人偏好持久化与分页标准实现

当前子任务：确认所有标准 `KdosDataTable` 继承同一 resize 行为，保留 compact 初始宽度和 default 例外。

### 已完成

- [x] 已读取追加需求、项目 AGENTS、`kdos-form-platform` Skill、当前进度和工作区。
- [x] 已确认现有个人视图偏好使用 Web `localStorage`，已有字段显示、固定列和每页条数保存；没有服务端 personalization 表，故不新增数据库系统。
- [x] 已确认当前分页仍为默认 50、选项 20/50/100/200、部分后端上限 200，需按追加要求统一升级。
- [x] `KdosDataTable` 公共层已增加表头右侧 resize handle；列宽按字段类型提供初始宽度和 `minWidth`，用户宽度优先，拖动过程中不写业务数据，释放鼠标后保存个人偏好。
- [x] 列宽偏好键包含租户、用户、resource、viewKey，值按 fieldKey 保存；刷新、重新挂载、隐藏/显示、查询条件变化后可恢复；保留旧个人视图键的读取兼容。
- [x] 分页统一为默认 100、选项 50/100/200/500/1000、后端最大 1000；API 模块复用 `apps/api/src/common/pagination.ts`。
- [x] 已同步 `.agents/skills/kdos-form-platform/SKILL.md` 与 `docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md`。
- [x] 定向 Web：2 files / 20 tests passed；API 分页：2 tests passed。
- [x] Web 全量：26 files / 162 tests passed；API 全量：73 suites passed、1 skipped，567 tests passed、1 skipped。
- [x] Web/API typecheck、lint、build 通过；lint 仅保留既有 `ModulePortal.tsx` Fast Refresh warning，build 仅保留既有大 chunk warning。
- [x] 实现 commit：`00ce83f`（`feat(KDOS-TABLE-COMPACT-STANDARD-001): add shared column resizing`）。
- [x] 备份：`data/backups/four_department_tracker_20260929_163020.backup`=`d97d0e5a88f8534f073e43e9ac38d483b80cba918f88b505c87d11a1b63f466b`；`data/backups/kdos_20260929_163020.backup`=`61fcbc351c0cc65089df99bb669d56fb7ca66203b1a78004e7c297f76c1da0c3`；`data/backups/uploads_20260929_163020.tar.gz`=`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`。
- [x] 正式 `./scripts/deploy.sh all` 成功；实现提交 `00ce83f`，最终部署记录提交 `891d56f`，Repository/Web/API=`891d56f`，`./scripts/deploy.sh check` 为 `STATUS=CONSISTENT`。
- [x] 部署后 API/Web/Postgres healthy，PostgreSQL 容器 ID 前后均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`；migration 数量仍为 76；API 最近 10 分钟无新的 500、23514、constraint、QueryFailedError 或 exception 日志。

### 正在进行

- [x] 在 `KdosDataTable` 公共层实现列宽拖动、minWidth、宽度恢复和跨查询稳定性。
- [x] 更新统一分页常量及后端页大小校验，补充 Skill、roadmap 和回归测试。

### 待完成

- [x] 定向/全量测试、typecheck、lint、build。
- [x] 备份、正式部署、健康检查及运行状态核验。
- [ ] 用户人工验收。

### 数据库 Migration

- 无：本追加需求禁止数据库修改；列宽偏好第一阶段复用浏览器个人偏好。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 用户人工验收尚未完成；在用户查看前不得判定 PASS。

### 下一步

1. 等待用户按主计划、项目、任务、设备页面执行拖动/刷新/隐藏/筛选/分页/编辑验收。
2. 根据用户真实验收结果将本任务更新为 PASS 或记录 NO-GO/FAIL；验收前不得自报 PASS。

## 当前任务：KDOS-TABLE-COMPACT-STANDARD-001

任务目标：将已通过人工验收的周计划 compact 表格模式推广为所有标准 `KdosDataTable` 的默认密度，并清理标准业务页面自动显示的用途、数据模型、权限、编辑模式和技术实现说明；保留 default 例外能力，不修改数据库。

当前状态：代码、测试、备份、正式部署和运行检查完成；等待用户线上人工验收。

开始 HEAD：`56507cea8d97427fd47be3f5fc929a4c2e23f2d1`

最后更新时间：2026-09-29

### 当前阶段

当前阶段：平台默认密度与页面说明规范推广

当前子任务：默认 compact、清理标准页 PageHeader subtitle、保留 Dashboard/特殊页面显式 default 例外。

### 已完成

- [x] 已读取任务要求、AGENTS、`kdos-form-platform` Skill、roadmap 和当前工作区；确认上一任务 `KDOS-TABLE-COMPACT-DEMO-001` 已由用户人工验收 PASS。
- [x] `KdosDataTable` 默认 density 从 `default` 改为 `compact`，`density="default"` 与 `density="compact"` 双模式保留。
- [x] 主计划页面移除“新版主计划独立数据模型；默认只读浏览，进入编辑模式后方可维护获权字段”说明；标准业务页同类 PageHeader subtitle 已清理。
- [x] Dashboard/特殊汇总表显式保留 `density="default"`，不把大字号展示页机械压缩。
- [x] `.agents/skills/kdos-form-platform/SKILL.md` 已加入标准业务页面说明文字禁用规则和 compact 强制标准。
- [x] `docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md` 已记录 Demo PASS 和本轮标准化任务状态。
- [x] 定向 Web 回归测试：7 files / 70 tests passed；覆盖 `KdosDataTable`、主计划、工单、辅助分组、督办、设备等。
- [x] Web 全量测试：26 files / 160 tests passed。
- [x] Web typecheck、lint、build 通过；lint 保留既有 `ModulePortal.tsx` Fast Refresh warning，build 保留既有大 chunk warning。
- [x] 已提交实现：`fcc24f960d257863776774d7616f9a7bf6a7ee9d`（`feat(KDOS-TABLE-COMPACT-STANDARD-001): standardize compact business tables`）。
- [x] 部署前备份：`data/backups/four_department_tracker_20260929_160346.backup`=`03c2228a6757a7238c6900f1c3351c7e11885016f36a61dd0de460eaf7750d59`；`data/backups/kdos_20260929_160346.backup`=`85b10be87983ac438e39893497bad6a1577f3d9a6f28765f39889369b5bf4ac2`；`data/backups/uploads_20260929_160346.tar.gz`=`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`，文件均可读。
- [x] 正式 `./scripts/deploy.sh all` 成功；Repository/Web/API 均为 `fcc24f9`，`./scripts/deploy.sh check` 为 `STATUS=CONSISTENT`。
- [x] 部署后 `scripts/healthcheck.sh` 通过；API/Web/Postgres 均 healthy；PostgreSQL 容器 ID 前后均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`。
- [x] 只读数据库核验：migration 数量仍为 76，本任务未执行 migration、未修改业务数据；部署后 API 最近 10 分钟无新的 500、23514、constraint、QueryFailedError 或 exception 日志。

### 正在进行

- [x] 运行定向与 Web 全量测试、typecheck、lint、build。
- [x] 提交本轮源码、Skill、roadmap 和测试，正式部署并做健康检查。

### 待完成

- [ ] 用户人工验收主计划、项目、任务、设备页面的 compact 可读性与完整交互，并确认计划管理说明文字消失。

### 数据库 Migration

- 无：本任务禁止数据库修改、migration、schema 调整和业务数据修改。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 用户人工验收尚未完成；在用户查看前不得判定 PASS。
- 保留上一轮既有 Node v22 engine、Web Fast Refresh 和大 chunk warnings。

### 下一步

1. 用户人工查看主计划、项目、任务、设备页面的 compact 可读性与完整交互。
2. 确认 1080P 下显示更多行/列、编辑控件不撑高、sticky/单纵向滚动/横向滚动、搜索筛选分页导入导出均无回归。
3. 确认主计划页面不再显示“新版主计划独立数据模型；默认只读浏览，进入编辑模式后方可维护获权字段”。
4. 根据用户验收结果将本任务更新为 PASS 或记录 NO-GO/FAIL；验收前不得自报 PASS。

## 当前任务：KDOS-TABLE-COMPACT-DEMO-001

任务目标：仅将事业部周计划页面作为紧凑表格 Demo，降低表格字体、行高、单元格留白和部分合理列宽；保留默认表格密度，待用户人工验收后再决定是否推广。

当前状态：用户真实人工视觉验收 PASS；任务已收口并作为全平台 compact 标准基线。

开始 HEAD：`c61004ce6d3cd7141dbae21ccd8f5a90e02a2cb7`

结束 HEAD：`56507cea8d97427fd47be3f5fc929a4c2e23f2d1`

实现提交：`56507ce`（`feat(ui): add weekly plan compact table demo`，含表头/数据行稳定高度微调）

最后更新时间：2026-09-29

### 当前阶段

当前阶段：紧凑 Demo 已完成并通过人工验收

当前子任务：确认周计划真实使用 `KdosDataTable`，增加 opt-in `density="compact"`，保持其它页面 `default`。

### 已完成

- [x] 已读取项目 AGENTS、`kdos-form-platform` Skill、实际周计划页面和公共表格实现；确认周计划使用 `KdosDataTable`，不是独立 Ant Table。
- [x] 未修改数据库、未新增 migration、未修改业务数据，也未修改平台 Skill 默认标准。
- [x] `KdosDataTable` 新增可选 `density="default" | "compact"`，默认行为保持不变；周计划显式使用 compact，月计划及其它页面保持 default。
- [x] compact 仅作用于周计划表格：正文/表头 13px、正文 line-height 20px、表头约 34px、紧凑单元格 padding、Input/Select/DatePicker 约 28px；未压缩左侧菜单、顶部导航、KPI、Dashboard、Modal 或系统管理。
- [x] 周计划合理压缩部分横向列宽：订单 132、品项 120/150、日期 112、数字 88、字典 100、布尔 82、生产进度 105；备注保留 180，异常列保留 280；长文本单行 ellipsis 并支持 Tooltip。
- [x] 增加 compact opt-in、周计划启用/月计划保持 default 的回归测试。
- [x] 定向 Web 测试：2 files / 14 tests passed。
- [x] Web 全量测试：26 files / 160 tests passed。
- [x] Web typecheck、lint、build 通过；lint 仅保留既有 `ModulePortal.tsx` Fast Refresh warning，build 仅保留既有大 chunk warning。

### 正在进行

- [x] 提交源码：`56507ce`。
- [x] 正式部署：`./scripts/deploy.sh all` 成功；最终 `./scripts/deploy.sh check` 为 Repository/Web/API=`56507ce`、`STATUS=CONSISTENT`。
- [x] 部署前备份：`data/backups/four_department_tracker_20260929_154201.backup`=`74e5a745a9336f29d52879d8bd3bc4ceeec28cfeb900a4c39424dd343c8bd670`；`kdos_20260929_154201.backup`=`d6d6793d7d5cd30b8510ba554fb0014127d9d96f88c53f79113466727e2ef16d`；`uploads_20260929_154201.tar.gz`=`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`。
- [x] 部署后 API/Web/Postgres 均 healthy，`scripts/healthcheck.sh` 通过；PostgreSQL 容器 ID 未变化，仍为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`。
- [x] 数据库只读核验：migration 仍停留在既有 #76，本任务未新增 migration；主计划行数仍为 shipping/base/weekly=`478/1405/1169`；未主动触发同步；部署后 API 最近 10 分钟无 500/23514/constraint/exception 日志。

### 待完成

- [x] 用户真实人工查看周计划 Demo：字体清晰、行高/留白明显降低、1080P 显示更多行和字段、编辑控件协调、横向滚动、sticky header、长文本 ellipsis/Tooltip、搜索/筛选/分页/导入/导出/编辑均通过。

### 数据库 Migration

- 无：本任务明确禁止数据库修改。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- Demo 已完成用户人工视觉验收 PASS；本轮标准化任务不得擅自改变已验收参数。
- Node 当前为 v22，项目声明目标为 v24；测试命令会显示既有 engine warning。

### 下一步

1. 本轮标准化任务完成测试、部署和人工验收。
2. 若用户验收发现回归，仅在标准密度或说明文字范围内修复。

## 当前任务：KDOS-DELIVERY-CODE-AUTO-001

任务目标：复用主计划现有 UUID 主键，改由服务端为同一租户订单+品项生成并持久化并发安全、删除不复用的交期编码；保持交期日期编辑不改变记录身份，覆盖页面、API、Excel 导入及下游同步。

当前状态：实现、migration、正式部署与运行检查完成；等待线上人工验收。

开始 HEAD：`017521b8f44862d3883cb7b75878e6d49d7806c7`

最后更新时间：2026-09-29

实现提交：`c61004c`（`feat(mps): auto-generate stable delivery codes`）

### 当前阶段

当前阶段：线上人工验收

当前子任务：完成主计划表/主键/字段/约束/关联/导入链路确认，随后新增正式计数器 migration 与应用层统一生成逻辑。

### 已完成

- [x] 已读取项目 AGENTS、`kdos-form-platform` Skill、架构、安全、runbook、进度文件及实际 Roadmap（实际路径：`docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md`）。
- [x] Git/部署预检：当前分支 `main`，HEAD=`017521b`；仅有 `outputs/CODEX_PROGRESS.md` 进度修改；`./scripts/deploy.sh check` 为 Repository/Web/API=`017521b`、`STATUS=CONSISTENT`。
- [x] 已确认主计划真实来源表为 `mps_shipping_plans`；`mps_base_plans` 通过 `shipping_plan_id`、`mps_weekly_plans` 通过 `base_plan_id` 使用内部 UUID 关联；3天工单使用周计划 UUID，不使用交期编码定位。
- [x] 已确认当前各相关表的技术主键均为 `id uuid PRIMARY KEY DEFAULT uuidv7()`；交期日期实际业务字段为 `latest_customer_due_date`，当前可由正式编辑链路修改。
- [x] 已确认真实业务字段：订单=`orderNumber/order_number`，品项=`itemCode/item_code`，交期编码=`deliveryNumber/delivery_number`，交期日期=`latestCustomerDueDate/latest_customer_due_date`。
- [x] 已确认当前源表、基础计划、周计划及报工快照的交期编码仍为 `integer`；源/基础/周计划唯一约束均为同租户订单+品项+交期编码，未发现计数器基础设施。
- [x] 生产只读一致性检查：主计划行数 shipping/base/weekly=`478/1405/1169`；交期编码均非空、非负且现存重复组为 0；shipping→base、base→weekly、各报工快照与周计划关联字段不一致数量均为 0；所有 shipping 均有 base。
- [x] 已确认所有正式新增/导入入口汇聚到 `MasterPlanApplicationService.create/importUpdates`，现有实现仍把交期编码列当作用户必填/可编辑字段；网页模板由同一 metadata 生成。

### 正在进行

- [x] 新增 `mps_delivery_code_counters` 正式 migration，并将相关交期编码列迁移为可容纳 `001…999、1000…` 的字符串；migration 只规范现有数值的显示格式并初始化计数器，不重排业务序号、不修改计划日期或内部 ID。
- [x] 应用层在 shipping/base 创建与新增导入中统一生成编码；加入事务级租户+订单+品项锁、唯一约束保护与删除不复用规则。
- [x] 更新 metadata、查询排序/显示、导入模板、下游数值排序及回归测试。

### 待完成

- [x] 定向测试、API/Web 全量测试、typecheck、lint、build。
- [x] 备份与正式 migration 已完成：`scripts/migrate.sh` 于 2026-09-29 15:27 执行；备份为 `data/backups/four_department_tracker_20260929_152715.backup`、`data/backups/kdos_20260929_152715.backup`、`data/backups/uploads_20260929_152715.tar.gz`，SHA256 已由脚本记录；migration #76 已应用。
- [x] migration 只读验证：7 张相关表的 `delivery_number` 均为 `varchar(32) NOT NULL`，新增正数字符串 CHECK，`mps_delivery_code_counters` 已初始化 1357 行；计划表行数仍为 shipping/base/weekly=`478/1405/1169`。
- [x] 备份文件可读且 SHA256 已复核：`four_department_tracker_20260929_152715.backup`=`ccb3d2e3e2c73acdcd54c72ef0c118cd3b7738e1a8e386c314f344f178bea363`；`kdos_20260929_152715.backup`=`30c9488b449e8f00b0007159ab7a163ba01130d020bed3d5f98027ec44f9372e`；`uploads_20260929_152715.tar.gz`=`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`。
- [x] 正式 `./scripts/deploy.sh all` 成功；最终 `./scripts/deploy.sh check` 为 Repository/Web/API=`c61004c`、`STATUS=CONSISTENT`。
- [x] 部署后 API/Web/Postgres 均 healthy；PostgreSQL 容器 ID 前后均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`；未主动触发主计划同步。
- [x] 部署后 API 最近 10 分钟无新的 500、23514、constraint、QueryFailedError 或 exception 日志。
- [ ] 用户线上人工验收：首条 001、第二条 002、删除后新建 004、日期修改 ID/编码不变、编码不可编辑、Excel 不填编码可新增。

### 数据库 Migration

- [x] 已提交并正式执行 `1722920075000-MasterPlanDeliveryCodeAuto.ts`；`migrations` 中存在 `MasterPlanDeliveryCodeAuto1722920075000`，未重建 PostgreSQL 容器。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 线上人工验收尚未完成；在用户确认首条/第二条生成、删除不复用、日期编辑保持 ID/编码、编码不可编辑和 Excel 导入后，才能决定最终 PASS。
- 当前工作区已有的 `outputs/CODEX_PROGRESS.md` 修改属于本任务/既有恢复记录；部署前仍须确保除此之外无未提交源码、配置或文档修改。
- migration 后只读复核：shipping/base/weekly 行数仍为 `478/1405/1169`，无非法编码、无租户+订单+品项+编码重复组；编码数值范围分别为 1..2、1..2、1..1。migration 未重排 ID、日期或业务序号。
- 自动化验证：API 全量 72 suites / 565 tests passed、1 suite / 1 test skipped；Web 26 files / 158 tests passed；API/Web typecheck、lint、build passed。保留既有 Node v22 engine、Fast Refresh 与大 chunk warnings。

### 下一步

1. 用户线上验收首条/第二条自动编码、删除不复用、日期修改保持 ID/编码、编码不可编辑及 Excel 不填编码可新增。
2. 根据用户验收结果将本任务更新为 PASS 或记录 NO-GO/FAIL；验收前不得自报 PASS。

---

## 当前任务：KDOS-WEEKLY-PLAN-FIELD-OPTIONS-001

任务目标：扩展周计划产品属性/表面性质合法选项，并将系统所有标准业务表的 `modelAge`（新旧款）字段改为非必填；保持 API、筛选、内联、批量和 Excel 链路一致。

当前状态：等待人工验收（代码、测试、备份、正式部署和运行检查已完成）。

开始 HEAD：`eb2f37b9c3343cd7b25d8cb7168ab28397df3269`

结束 HEAD：`017521b8f44862d3883cb7b75878e6d49d7806c7`

最后更新时间：2026-09-29

### 当前阶段

当前阶段：字段选项与可选语义已部署，等待线上人工验收

当前子任务：等待用户使用正常授权账号验收周计划下拉、空新旧保存/清空及 Excel 导入。

### 已完成

- [x] 已关闭上一任务 `KDOS-UI-PAGE-SCROLL-STANDARD-001`：用户生产人工验收 PASS 已记录；本任务未修改滚动代码。
- [x] 已确认真实 field key：`modelAge`、`productAttribute`、`surfaceNature`；API `fieldsFor()` metadata 是主计划页面、筛选、模板/导入及 Application option 校验的正式来源。
- [x] 已确认 `modelAge` 的标准 metadata 使用点：月计划、出货计划、基础计划、周计划、3天生产工单；数据库相关列均 nullable，未发现必填 DTO/Application 分支。
- [x] 已将共享选项集中到 `@tracker/shared`：产品属性保留原 4 项并新增“其他/五金+亚克力/塑料”；表面性质保留原 2 项并新增“热转印/毛坯/其他”；modelAge 保留“新/旧”。
- [x] 已将周计划 metadata 暴露三字段并设为可编辑、非必填；出货计划/基础计划 `modelAge` 保持可编辑并明确 `required=false`。
- [x] 已更新 API 选项校验、筛选解析、同步复制守卫以及 Excel 模板/导入共用 metadata 链路；非法值仍拒绝。
- [x] 数据库只读检查确认 `model_age`（以及相关产品/表面列）为 nullable；未新增 migration、未修改历史业务数据。
- [x] 共享字典、主计划 metadata/config、integration/填写说明文档已同步新选项与可选语义。
- [x] 定向 API 主计划测试：5 suites / 138 tests passed；shared/contracts 测试及构建通过。
- [x] API 全量：71 suites / 561 tests passed，1 suite skipped；Web 全量：26 files / 158 tests passed。
- [x] API/Web typecheck、lint、全 workspace build 通过；保留 Node v22 engine warning、Web Fast Refresh warning 和既有大 chunk warning。
- [x] 正式提交：`c2e8ac01cd442c605f978defa0439c2f54c9d50a`，消息为 `fix(mps): expand weekly field options and make model age optional`。
- [x] 修正月计划 `modelAge` 可编辑语义并提交：`017521b8f44862d3883cb7b75878e6d49d7806c7`；新增 config 回归断言，3天工单仍为来源只读。
- [x] 生产备份：`data/backups/four_department_tracker_20260929_144911.backup`、`kdos_20260929_144911.backup`、`uploads_20260929_144911.tar.gz`；custom dump/tar 可读并已记录 SHA256。
- [x] 正式 `./scripts/deploy.sh all` 成功；`./scripts/deploy.sh check` 为 Repository/Web/API=`017521b`、`STATUS=CONSISTENT`。
- [x] 部署后 API/Web/Postgres healthy；PostgreSQL container ID 前后均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`。
- [x] 部署后 API 最近 10 分钟无新的 500、23514、constraint、QueryFailedError 或 exception 日志；未执行 migration、未主动触发任何主计划同步。

### 正在进行

- [x] API/Web 全量测试、typecheck、lint、build。
- [x] 生产备份、正式 `./scripts/deploy.sh all`、一致性/健康检查。

### 待完成

- [ ] 等待用户线上人工验收：周计划三个下拉、空新旧新增/编辑/内联/导入及其它新旧表。

### 数据库 Migration

- 无：相关字段已为 nullable，本任务不执行 migration。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- Node 当前为 v22，项目声明目标为 v24；既有测试命令会显示 engine warning。

### 下一步

1. 用户完成线上人工验收后，按结果将本任务更新为 PASS 或记录 NO-GO。
2. 若验收发现问题，仅在本任务字段/选项范围内修复并重新验证。

## 当前任务：KDOS-UI-PAGE-SCROLL-STANDARD-001

任务目标：统一 KDOS 标准业务页面标题/说明与表格滚动规范；标准表默认由页面承担纵向滚动、表格保留横向滚动。

当前状态：已完成（用户生产人工验收 PASS）。

开始 HEAD：`436fdb7354b7ff322ae74951ea8b94e229991e36`

结束 HEAD：`eb2f37b9c3343cd7b25d8cb7168ab28397df3269`

最后更新时间：2026-09-29

### 当前阶段

当前阶段：标准页面与公共表格滚动规范交付

当前子任务：用户已完成生产人工验收，本任务正式关闭；后续不再修改滚动代码。

### 已完成

- [x] 已读取项目规范、架构、安全、运行手册和 `kdos-form-platform` Skill；确认工作区未知源码修改不存在。
- [x] 已删除项目管理大屏、员工待办大屏、责任人任务完成报表主体中的重复标题和用途副标题；保留导航/顶部页面身份。
- [x] 已确认双纵向滚动根因：页面 `.content` 滚动与 `KdosDataTable` 默认 `scroll.y` 同时存在。
- [x] `KdosDataTable` 标准模式默认不再创建内部纵向滚动，仅保留横向 `scroll.x`；新增显式 `internalVerticalScroll` 例外。
- [x] 已移除主计划、设备、数据中心、营销、人力、组织、基础数据、通讯录等标准表的显式 `scroll.y`；用户/角色管理固定嵌入成员表保留显式内部滚动。
- [x] 已调整标准表 shell，避免默认 `height:100% + overflow:hidden` 截断页面内容；内部滚动例外保持固定 viewport。
- [x] 已将页面标题/说明和标准业务表滚动规则写入 `.agents/skills/kdos-form-platform/SKILL.md`。
- [x] 提交：`90d2bc70f1071b37e500a4bf76e915aaaff95b35`，消息为 `fix(KDOS-UI-PAGE-SCROLL-STANDARD-001): unify page content and table scrolling`。
- [x] 定向测试：4 files / 26 tests 通过；Web 全量：26 files / 158 tests 通过；typecheck、lint、build 通过。
- [x] 备份：`data/backups/*_20260928_182704.*`，数据库 dump 文件格式、上传 tar 可读性和 SHA256 已核验。
- [x] 正式 `./scripts/deploy.sh all` 成功；`./scripts/deploy.sh check` 为 Repository/Web/API=`90d2bc7`、`STATUS=CONSISTENT`。
- [x] API/Web/Postgres healthy；PostgreSQL 未重建；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`；部署后 API 日志无相关错误。
- [x] 上一轮曾怀疑全局 `.ant-table-wrapper { overflow: hidden }` 约束 rc-table sticky holder；本轮真实 Chrome 复验确认该因素并非唯一根因，实际阻断来自非滚动 `.content` 的 `overflow:auto` sticky ancestor（详见本轮调查记录）。
- [x] 标准模式改为 `sticky={{ offsetHeader: 0 }}` 并仅对非 `internalVerticalScroll` 的 KDOS 表格解除 wrapper overflow 裁剪；未恢复 `scroll.y`，内部纵向滚动例外保持原行为。
- [x] 已将 sticky 表头、横向同步、fixed columns、编辑/下拉以及 `internalVerticalScroll` 例外规则补入 `kdos-form-platform` Skill。
- [x] 本轮提交：`aa479e23e65bf76d431baf978cc9376148a800a6`，消息为 `fix(ui): keep standard table headers sticky`。
- [x] 本轮定向测试：KdosDataTable 8 tests、KdosDataTable+Supervision 13 tests 通过；Web 全量 26 files / 158 tests 通过；typecheck、lint、build 通过。
- [x] 本轮备份：`data/backups/*_20260928_184734.*`；两个 PostgreSQL custom dump 经容器内 `pg_restore --list` 校验，上传 tar 可读。
- [x] 本轮正式 `./scripts/deploy.sh all` 成功；最终 `./scripts/deploy.sh check` 为 Repository/Web/API=`aa479e2`、`STATUS=CONSISTENT`。
- [x] 本轮部署后 API/Web/Postgres healthy；PostgreSQL 容器 ID 前后均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`；API 最近 10 分钟无 500/23514/constraint/error/exception 匹配项。
- [x] 用户人工验收确认单纵向滚动、横向同步、固定列、搜索、筛选、分页、编辑和弹层均正常，唯一失败为页面下滚后字段表头消失。
- [x] 已重新用真实 Chrome 调查：实际 vertical scroll owner 是 `window/document`；`.content` 的 `overflow:auto` 虽自身不滚动（`scrollHeight === clientHeight`），仍成为 sticky ancestor；`.ant-table-sticky-holder` 滚动前 `top=197`、`window.scrollY=500` 后 `top=-303`。上一轮仅解除 `.ant-table-wrapper` 裁剪并不足以修复。
- [x] 最终修复将 `.content` 改为 `overflow: visible`，使 sticky 绑定到实际的 window 页面滚动；`.ant-table-body` 仍为横向 `overflow-x:auto`、纵向 `overflow-y:hidden`。
- [x] 本轮提交：`eb2f37b9c3343cd7b25d8cb7168ab28397df3269`，消息为 `fix(ui): align table sticky headers with page scroll`；新增真实 Chrome sticky E2E。
- [x] 本轮定向测试：KdosDataTable 8 tests、KdosDataTable+Supervision 13 tests、真实 Chrome E2E 1 test 通过；Web 全量第二次 26 files / 158 tests 通过（首次有既有 AdminWorkspace 时序超时，单独重跑通过）；typecheck、lint、build 通过。
- [x] 本轮备份：`data/backups/*_20260929_141749.*`；两个 PostgreSQL custom dump 经容器内 `pg_restore --list` 校验，上传 tar 可读。
- [x] 本轮正式 `./scripts/deploy.sh all` 成功；最终 `./scripts/deploy.sh check` 为 Repository/Web/API=`eb2f37b`、`STATUS=CONSISTENT`；指向生产 Web 容器的真实 Chrome E2E 1/1 通过。
- [x] 用户生产人工验收 PASS：页面右侧只有一个纵向滚动条，标准表无内部纵向滚动；sticky 表头、横向滚动、搜索、筛选、分页、编辑和弹层均正常。

### 正在进行

- [x] 完成页面规范、公共滚动层、测试、构建、备份和部署。
- [x] 使用授权账号完成线上人工验收，确认真实页面下滚后表头保持可见。

### 待完成

- [ ] 确认三个大屏无重复标题/副标题，页面直接进入筛选、KPI、图表或表格。
- [x] 用户已确认标准表右侧只有页面纵向滚动条，宽表横向滚动、搜索、筛选、分页、编辑和弹层保持正常。
- [x] 用户确认本轮修复后的 sticky 表头。

### 修改文件

- `.agents/skills/kdos-form-platform/SKILL.md`
- `apps/web/src/shared/KdosDataTable.tsx`
- `apps/web/src/shared/KdosDataTable.spec.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/modules/supervision/SupervisionPages.tsx`
- `apps/web/src/modules/supervision/SupervisionPages.spec.tsx`
- 标准表调用方：`App.tsx`、主计划、设备、数据中心、营销、人力、组织、开发请求、管理员页面
- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 无；未修改数据库 schema、业务数据或 inbound-allocation；未主动触发同步。

### 已运行测试

- 定向：KdosDataTable、监督大屏、筛选能力共 4 files / 26 tests passed。
- Web 全量：26 files / 158 tests passed；首次并发运行有 1 个既有 AdminWorkspace 时序超时，单独重跑和第二次全量均通过。
- Web typecheck：PASS。
- Web lint：PASS，保留既有 Fast Refresh warning。
- Web build：PASS，保留既有大 chunk warning。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 上一项滚动规范任务已由用户生产人工验收确认 PASS；本节不再有该任务遗留阻塞。
- Node 运行环境为 v22，项目目标为 Node 24；测试、类型检查、lint 和 build 均已通过。
- 真实 Chrome 已验证部署 bundle 的 scroll owner、sticky holder 实际位置和横向滚动容器；仍不能替代用户对真实业务账号和实际数据的最终视觉确认。

### 下一步

1. 本任务已完成；后续不再修改滚动代码。

## 当前任务：KDOS-PROJECT-TASK-UX-PERM-001

任务目标：修复项目与任务模块导航、权限、表格编辑、甘特图体验，并补齐标准业务表统一导出；完成后最多恢复一个真实未完成的 Roadmap TASK。

当前状态：等待人工验收（本轮两个线上 UI 失败项已修复、验证并部署；尚未重新人工确认）。

开始 HEAD：`f91470b84ef761295187b72898d990d2cc832200`

结束 HEAD：`436fdb7354b7ff322ae74951ea8b94e229991e36`

最后更新时间：2026-09-28

### 当前阶段

当前阶段：项目/任务 UX 最终线上验收

当前子任务：修复重复大标题与甘特图 ISO 日期显示，完成 Web 回归、备份、正式部署；等待用户再次人工验收。

### 已完成

- [x] 已读取项目规范、`kdos-form-platform` 技能与实际 roadmap；roadmap 已被 Git 跟踪。
- [x] 已移除项目/任务标准页长期解释性副标题，并将“标准页不自动增加说明文字”写入平台技能规则。
- [x] 已基于统一 `TableFilterRegistry`/打印取数框架增加 XLSX 导出；项目 `supervision-projects` 与任务 `supervision-tasks` 共用平台入口。
- [x] 导出后端强制校验 export/read、字段权限、租户、数据范围、搜索、筛选、排序和全部匹配记录；排除操作列并解析成员、部门、字典和日期展示值。
- [x] 业务代码提交：`c5fefa3`；Roadmap/TASK-001 独立提交：`f91470b`。
- [x] TASK-001 已完成：新增 `packages/ui-schema`，提供 Field/Option/Form/Detail/Table/Resource Schema、结构校验辅助函数与督办任务 Schema 测试；未启动 TASK-002。
- [x] API 专项：2 suites / 21 tests；Web 专项：3 files / 24 tests；ui-schema：2 tests，均通过。
- [x] API 全量：71 suites / 560 tests 通过，1 suite / 1 test 既有 skip；Web 全量复跑：26 files / 155 tests 通过。
- [x] API/Web/全 workspace typecheck、lint、build 通过；保留既有 Web Fast Refresh warning 和大 chunk warning。
- [x] 生产备份：`data/backups/*_20260928_112045.*`，pg_restore/tar 可读，SHA256 已核验：主库 `2c91d5...`、KDOS `80c904...`、uploads `089222...`。
- [x] 第三次正式 `./scripts/deploy.sh all` 成功；最终 `./scripts/deploy.sh check` 为 Repository/Web/API=`f91470b`、`STATUS=CONSISTENT`。
- [x] 部署前后 PostgreSQL 容器 ID 均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`，未重建；API/Web/Postgres 均 healthy。
- [x] Dispatcher=`active`；数据库只读确认 `inbound-allocation=true`、状态 `SUCCESS`；未主动触发主计划同步。
- [x] 数据库无本轮 migration；业务数据未修改。目标设备状态记录已存在，且 `KN-020YK005 / 2026-09-26` 的 planned/runtime/fault 均为 `0`，未重复创建或导入。
- [x] 部署后 API 最近 10 分钟日志无 `500`、`23514`、目标 constraint 或 error/exception 匹配项。
- [x] 上次真实线上人工验收已确认：首页角色身份隐藏、导航提升、说明文字移除、项目/任务编辑和导出均通过；仅发现标准页重复大标题与甘特图 ISO 时间戳两项失败。
- [x] 已移除 `SupervisionProjectsPage` 与 `SupervisionTasksPage` 主体中重复的“项目管理/任务管理”大标题；保留左侧导航和仪表盘标题层级。
- [x] 已将甘特图日期范围、风险卡片交付日期、任务交付日期提示及相关日期列统一改用 `formatDateOnly`/`formatDateRange`，避免时区转换和 ISO 时间泄露。
- [x] 已将“左侧导航已明确身份时不重复显示同名主体大标题”写入 `.agents/skills/kdos-form-platform/SKILL.md`。
- [x] 本轮修复提交：`436fdb7354b7ff322ae74951ea8b94e229991e36`。
- [x] 本轮定向测试：2 files / 7 tests 通过；Web 全量：26 files / 156 tests 通过；typecheck、lint、build 通过。
- [x] 本轮备份：`data/backups/*_20260928_155204.*`；数据库 custom dump、上传 tar 均存在且已校验文件格式与 SHA256。
- [x] 本轮正式 `./scripts/deploy.sh all` 成功；最终 `./scripts/deploy.sh check` 为 Repository/Web/API=`436fdb7`、`STATUS=CONSISTENT`。
- [x] 本轮部署后 API/Web/Postgres healthy；PostgreSQL 容器 ID 未变；Dispatcher=`active`；`inbound-allocation=true`、状态 `SUCCESS`；API 最近 10 分钟无相关错误。

### 正在进行

- [x] 完成实现、提交、备份、部署与自动化验证。
- [ ] 使用授权账号重新完成项目/任务页面人工验收，重点确认主体不再重复显示同名大标题、甘特图显示 `2026-09-21 → 2026-09-30` 且风险显示 `交付 2026-09-30`。

### 待完成

- [x] 当前代码与 Roadmap 交付已完成。
- [ ] 线上人工复验；完成前保持“等待人工验收”，不得提前标记 PASS。

### 修改文件

- `apps/api/src/common/filtering/table-filter.module.ts`
- `apps/api/src/common/filtering/table-filter.registry.ts`
- `apps/api/src/common/printing/table-export.controller.ts`
- `apps/api/src/common/printing/table-print.service.ts`
- `apps/api/src/common/printing/table-print.service.spec.ts`
- `apps/api/src/modules/supervision/supervision.filter-sources.ts`
- `apps/web/src/shared/table-export.ts`
- `apps/web/src/shared/KdosDataTable.tsx`
- `apps/web/src/shared/KdosDataTable.spec.tsx`
- `apps/web/src/modules/supervision/SupervisionPages.tsx`
- `apps/web/src/modules/supervision/SupervisionPages.spec.tsx`
- `.agents/skills/kdos-form-platform/SKILL.md`
- `packages/ui-schema/*`
- `docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md`
- `pnpm-lock.yaml`
- `apps/web/src/shared/date-format.ts`
- `apps/web/src/shared/date-format.spec.ts`
- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 本轮无新 migration、无 schema 变更、无业务数据写入；正式部署使用 `--no-deps`，PostgreSQL 未重建。

### 新增或修改测试

- 标准导出覆盖 export 权限、API 拒绝、搜索/筛选/排序继承、全部匹配记录、字段权限和 XLSX 列输出。
- 项目/任务页覆盖副标题移除、只读、字段权限、自动保存和失败回滚。
- 项目/任务页覆盖标准页同名主体标题不渲染；项目大屏覆盖 ISO 日期范围、风险交付日期格式和 ISO 字符串不泄露。
- `@kdos/ui-schema` 覆盖督办任务主要字段 Schema 与非法结构校验。

### 已运行测试

- `pnpm test`：API 71 suites / 560 tests passed（1 skip）；Web 首次全量有 1 个既有 AdminWorkspace 超时，单独复跑 8/8 通过；随后 Web 全量 26 files / 155 tests passed；其他 workspace 均通过。
- `pnpm typecheck`：PASS；`pnpm lint`：PASS（1 条既有 warning）；`pnpm build`：PASS（既有大 chunk warning）。
- `./scripts/deploy.sh all`：最终 PASS；此前两次仅因 npm registry 网络超时失败，未切换容器。
- 最终 `./scripts/deploy.sh check`：Repository/Web/API=`f91470b`，`STATUS=CONSISTENT`。
- `docker compose ps`：API/Web/Postgres healthy；Dispatcher active；`inbound-allocation=true`。
- API 日志：部署后无新的 500/23514/目标 constraint/error/exception。
- 本轮 `./scripts/deploy.sh all`：PASS；本轮 `./scripts/deploy.sh check`：Repository/Web/API=`436fdb7`，`STATUS=CONSISTENT`。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 当前仅等待用户重新进行线上人工验收；自动化、备份、正式部署和运行检查均已完成，未代替用户将其判定为 PASS。
- `TASK-002 KdosSchemaForm` 仍为 Roadmap 下一推荐任务。

### 下一步

1. 通过正常 UI 重新验收项目/任务页面，重点确认两个本轮修复项。
2. 将人工复验结果补入本进度文件；在验收完成前不将本任务标记 PASS。

## 当前任务：KN-EQUIP-STATUS-ZERO-RUNTIME-001

任务目标：修复设备状态导入计划运行时间为 0 时预览通过但确认写入被 PostgreSQL 约束拒绝的问题，并让确认失败在导入预览 Modal 内持续可见。

当前状态：migration 与正式部署完成；真实 planned=0 导入验收因缺少用户原始 Excel 未执行，整体仍为 NO-GO。

开始 HEAD：`29453bf3b48d2f1a87f88e660da353c88eb711d6`

最后更新时间：2026-09-28

### 当前阶段

当前阶段：生产验收收尾

当前子任务：等待用户提供原始设备状态 Excel 后完成一次真实 planned=0 导入验收。

### 已完成

- [x] 已读取项目规范、架构/安全文档、运行手册、集成说明和 KDOS 表单技能规范。
- [x] 已完成 Git 预检：分支 `main`；HEAD=`29453bf3b48d2f1a87f88e660da353c88eb711d6`。
- [x] 已确认工作区既有修改只有 `outputs/CODEX_PROGRESS.md`，另有未跟踪的任务范围外文档 `docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md`，未覆盖、未删除、未提交。
- [x] 已确认 API/Web/PostgreSQL 当前容器健康；PostgreSQL 容器 ID=`ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`；Dispatcher=`active`。
- [x] 已只读确认生产约束为 `planned_runtime_minutes IS NULL OR planned_runtime_minutes > 0`。
- [x] 已只读确认设备状态数据分布：NULL 1741、正数 908、零 0、负数 0；未执行任何业务数据写入。
- [x] 已确认旧 migration `EquipmentStatusPlannedRuntimeMinutes1722920066000` 已执行，当前最大 migration 编号为 `1722920073000`。
- [x] 已确认应用层 `requiredMinutes`、导入 duration、`saveStatus` 已允许 0；稼动率对计划时间 0 的既有语义为 NULL，不在本任务修改。
- [x] 继续执行预检：当前 HEAD=`c3844e6f2db16130e191db858bb8d51c9c55632c`，`bae69b1` ancestry 成功，roadmap 已由 `c3844e6` 跟踪，只有 outputs 记录未提交。
- [x] `deploy.sh check` 显示生产基线仍为 `29453bf`，待本次部署更新；无未知工作区文件。
- [x] 迁移前只读核验：旧约束、migration 未执行、数据分布 NULL=1741/0=0/>0=908/<0=0；目标设备日期记录不存在。
- [x] 备份 `20260928_090229` 三份文件存在、可读、SHA256 与原记录一致，PostgreSQL dump 可由 `pg_restore --list` 读取。
- [x] 正式 TypeORM migration 执行成功，migration 记录为 id=75；约束已变为 `NULL OR >= 0`。
- [x] `./scripts/deploy.sh all` 成功；随后 `./scripts/deploy.sh check` 判定 Repository/Web/API 均为 `c3844e6`、`STATUS=CONSISTENT`。
- [x] 部署后 API/Web/PostgreSQL healthy；PostgreSQL 容器 ID 前后均为 `ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`，未重建。
- [x] 部署后 Dispatcher=`active`、`inbound-allocation=true`；API 重启后的日志无新的 constraint/500/23514 错误。
- [x] 部署后只读数据复核仍为 NULL=1741/0=0/>0=908/<0=0，目标记录仍不存在。

### 正在进行

- [x] 新增 allow-zero migration，并补充应用/导入/迁移测试。
- [x] 在设备状态导入预览 Modal 增加确认失败持久 Alert 和清理时机。

### 待完成

- [x] 运行设备专项、API/Web 全量测试、typecheck、lint、build。
- [x] 生产备份；迁移前只读校验约束与数据未变化。
- [x] 提交修复；roadmap 已由用户提交，未绕过保护机制。
- [ ] 使用用户原始 Excel 完成目标记录的真实 planned=0 导入验收。

### 修改文件

- `outputs/CODEX_PROGRESS.md`
- `apps/api/src/migrations/1722920074000-EquipmentStatusPlannedRuntimeAllowZero.ts`
- `apps/api/src/modules/equipment/equipment-status-runtime.migration.spec.ts`
- `apps/api/src/modules/equipment/equipment.spec.ts`
- `apps/web/src/modules/equipment/EquipmentPages.tsx`
- `apps/web/src/modules/equipment/EquipmentPages.spec.tsx`

### 数据库 Migration

- 新增：`1722920074000-EquipmentStatusPlannedRuntimeAllowZero.ts`；UP 保留约束名并改为 `NULL OR >= 0`，不回填、不修改现有数据。
- 尚未执行生产 migration；当前生产约束仍为 `NULL OR > 0`。

### 新增或修改测试

- 已补充：计划运行时间 0 的应用/预览/确认路径、迁移约束语义、确认失败 Alert 及重试/换文件清理。

### 已运行测试

- API 专项：设备测试与迁移测试共 2 suites / 21 tests 通过。
- Web 设备专项：确认失败持久 Alert、失败后重试、换文件清理及既有预览错误共 11 tests 通过（Node 22 环境，pnpm 提示项目目标 Node 24）。
- API 全量：71 suites / 557 tests 通过，1 suite/1 test 既有 skip。
- Web 全量：25 files / 148 tests 通过。
- API/Web typecheck：通过；API/Web lint：0 error，Web 保留 1 条既有 Fast Refresh warning。
- Monorepo build：15 个工作区构建通过；Web 仅有既有大 chunk warning。
- `git diff --check`：通过。
- 生产备份：`data/backups/*_20260928_090229.*`，三份均成功并生成 SHA256。
- 迁移前只读复核：约束为 `NULL OR > 0`；数据 NULL=1741、0=0、正数=908、负数=0。
- 迁移后只读复核：约束为 `NULL OR >= 0`；migration id=75；数据计数未变化。
- 正式部署与复核：Repository/Web/API=`c3844e6`，`STATUS=CONSISTENT`。
- 真实 planned=0 导入：未执行；当前未找到用户原始设备状态 Excel，未生成或伪造业务文件。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 真实 planned=0 导入验收仍待用户提供原始 Excel；不能用其他出货 Excel 或人工生成文件替代。

### 等待用户确认

- 需要提供或配置一个可安全使用的授权账号，以完成线上 UI 实际操作验收；不需要提供密码给进度文件或最终报告。

### 下一步

1. 用户提供本次实际失败的设备状态 Excel。
2. 通过正常 UI 完成一次上传→预览→确认导入，并核验目标记录 planned/runtime/fault 均为 0。
3. 保留当前已完成的 migration、部署和日志核验结果，最终将本任务标记 PASS。

### 本阶段最终报告

- 结果：NO-GO（migration、部署和运行环境核验完成，真实 planned=0 导入验收缺少原始 Excel）。
- 开始 HEAD：`29453bf3b48d2f1a87f88e660da353c88eb711d6`。
- 结束 HEAD：`bae69b1fc323e9caeee106f109abd2d9092e2219`。
- Commit：`bae69b1 fix(KN-EQUIP-STATUS-ZERO-RUNTIME-001): allow zero planned runtime`。
- 生产 PostgreSQL 容器：`ce46d464a78a01dde5c31cb3e39ce4b33c67b055876599429c2185a3274ec04e`，健康且未重建；Dispatcher=`active`。
- 新 migration：已执行并记录 id=75；旧 migration 未修改；业务数据未修改。
- 备份：`20260928_090229`，legacy/KDOS/uploads 均已成功备份并校验。
- Web/API SHA：均为 `c3844e6`，deploy check=`CONSISTENT`。
- 当前运行基线：API/Web/PostgreSQL 均 healthy，本任务已上线。
- 只读安全复核：`inbound-allocation`=`true`；Dispatcher=`active`；API 重启后的日志无新的 constraint/500/23514 错误。
- planned=0 实际验收：未执行，目标记录不存在且未提供原始 Excel。

---

## 当前任务：SUPERVISION-FORM-USABILITY-002

任务目标：为督办项目/任务表单显示必填红色星号，移除项目与任务的“紧急”优先级，并将任务管理页的权限管理入口收敛为一个。

当前状态：已完成；最终修正、完整回归、备份、migration、部署与线上核验均已完成。

最后更新时间：2026-09-27

### 当前阶段

当前阶段：交付完成

当前子任务：无。

### 已完成

- [x] 已阅读当前适用的项目规范、KDOS 表单与权限规范和已有进度记录。
- [x] 已确认创建项目、创建任务及任务操作表单通过 `requiredMark={false}` 主动隐藏了必填标识。
- [x] 已确认“紧急”来自共享督办优先级字典，但服务端另有一份允许值集合，需要同步收紧。
- [x] 已确认 `KdosDataTable` 已自动提供当前任务表的权限管理入口，任务工具栏又额外提供了任务进展权限入口，造成两个同名按钮。
- [x] 已只读核对当前线上数据：督办项目/任务不存在 `URGENT` 存量记录，无需迁移业务数据。
- [x] 已恢复督办创建/编辑和任务操作表单的默认必填红色星号。
- [x] 已从共享督办优先级字典移除“紧急”，服务端校验直接派生该共享字典并拒绝 `URGENT`。
- [x] 已移除任务管理工具栏中额外的任务进展权限入口，仅保留 `KdosDataTable` 自带的任务权限入口。
- [x] 已补充共享字典契约测试和项目/任务拒绝 `URGENT` 的服务端测试。
- [x] 最终复核确认项目“督办人”不在用户指定的必填清单内，但旧实现仍要求必填；已纳入本次修正。
- [x] 已确认 Web Dockerfile 在依赖安装前注入 Git SHA，导致每次提交都让依赖层缓存失效；外部镜像源连续超时后部署无法完成但未切换线上容器。
- [x] 已将 SHA 注入移动到 Web 编译阶段，并为 pnpm store 增加 BuildKit 缓存，避免后续提交重复下载全部依赖。

### 正在进行

- 无。

### 待完成

- [x] 运行专项测试、lint、typecheck、全量测试和构建。
- [x] 备份、提交、部署当前运行环境并执行健康检查和线上效果核验。
- [x] 执行 `SupervisionFormUsability1722920073000` 并核验数据库列与约束。
- [x] 修复 Web 镜像依赖缓存，完成最终 Web/API 切换与三方 SHA 一致性检查。

### 修改文件

- `apps/api/src/modules/supervision/supervision.application.service.spec.ts`
- `apps/api/src/modules/supervision/supervision.application.service.ts`
- `apps/api/src/modules/supervision/supervision.migration.spec.ts`
- `apps/api/src/migrations/1722920073000-SupervisionFormUsability.ts`
- `apps/api/src/entities.ts`
- `apps/api/src/modules/supervision/supervision.types.ts`
- `apps/web/src/modules/supervision/SupervisionPages.tsx`
- `apps/web/Dockerfile`
- `packages/contracts/src/index.test.ts`
- `packages/contracts/src/index.ts`
- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 新增 `1722920073000-SupervisionFormUsability`：项目督办人改为可空；项目/任务数据库优先级约束移除 `URGENT`。当前线上不存在 `URGENT` 存量记录。

### 新增或修改测试

- 督办共享优先级字典固定为高/中/低。
- 督办项目与任务 Application Service 均拒绝已移除的 `URGENT`。
- 项目督办人可以留空。
- 表单易用性 migration 将督办人改为可空，并从数据库约束移除 `URGENT`。

### 已运行测试

- Contracts：1 file / 21 tests 通过。
- 督办 Application Service 专项：1 suite / 11 tests 通过。
- 最终专项：Application Service + migration 共 2 suites / 15 tests 通过。
- Contracts、API、Web typecheck：通过。
- Contracts、API、Web lint：通过；Web 仅有 1 条既有 Fast Refresh warning。
- API 最终全量：70 suites / 554 tests 通过，1 项既有 skip。
- Web 全量：25 files / 146 tests 通过。
- `pnpm build`：15 个工作区构建通过；Web 仅有既有大 chunk 提示。
- `git diff --check`：通过。
- 上线前备份：`data/backups/*_20260927_154945.*`，三份备份均已生成 SHA256。
- 最终生产部署：Repository / Web / API 均为 `29453bf`，部署脚本判定 `CONSISTENT`。
- 线上健康检查：API、Web、PostgreSQL 容器均为 healthy，`/api/v1/health` 返回 `status=ok`。
- 线上资源核验：加载的 `index-WbeUmHSv.js` 包含督办项目/任务页面、高/中/低优先级字典及可清空的非必填督办人字段。
- 最终修正首次部署构建：API 新镜像成功；Web 依赖下载至 1078/1081 后因外部 registry timeout 失败，未执行 migration 或切换，线上 `18b0329` 保持健康。
- 最终数据库核验：`supervision_projects.supervisor_id` 为 nullable；项目/任务 priority CHECK 均只包含 `HIGH/MEDIUM/LOW`；migration 记录存在。
- 最终健康检查：API、Web、PostgreSQL 容器均为 healthy，API health 返回 `status=ok`。
- 最终上线前备份：`data/backups/*_20260927_161326.*`，三份备份均已生成 SHA256。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 无。

### 等待用户确认

- 无。

### 下一步

1. 无。

### 最终报告

- 功能提交：`18b0329 fix(supervision): clarify required fields and priorities`
- 必填清单修正：`45a602d fix(supervision): align supervisor requirement`
- 部署缓存修正：`29453bf build(web): preserve dependency cache across versions`
- 备份：`data/backups/*_20260927_161326.*`
- Migration：`SupervisionFormUsability1722920073000` 已执行。
- 线上版本：Repository / Web / API 均为 `29453bf`。

---

## 当前任务：SUPERVISION-CREATION-FIELDS-001

任务目标：调整创建督办项目/任务的字段、必填规则、字段名称及交付/进度记录，并完成当前运行环境部署核验。

当前状态：已完成；已迁移并部署至当前运行环境，健康检查和线上资源核验通过。

最后更新时间：2026-09-27

### 当前阶段

当前阶段：交付完成

当前子任务：无

### 已完成

- [x] 已阅读项目规范、架构/安全边界、运行手册、集成说明及 KDOS 表单规范。
- [x] 已确认项目“当前进度”原本就是由非中止子任务进度平均值实时派生。
- [x] 已增加项目描述、实际交付日期的实体/字段契约与筛选投影。
- [x] 已将主责部门、参与人、预计交付日期和当前进度名称同步到创建表单及主要列表。
- [x] 已将项目描述、来源类型、主责部门、参与人、任务说明、计划开始日期及创建任务当前进度纳入服务端必填校验。
- [x] 已禁止直接写入项目当前进度；项目进度继续由未中止子任务的当前进度平均值派生。
- [x] 已为已有权限组回填项目描述、项目/任务实际交付日期字段权限。
- [x] 已通过备份、TypeORM migration、API/Web 重建、版本一致性及线上静态资源字段核验完成上线。

### 正在进行

- 无。

### 待完成

- 无。

### 修改文件

- `apps/api/src/entities.ts`
- `apps/api/src/migrations/1722920072000-SupervisionRequiredCreationFields.ts`
- `apps/api/src/modules/supervision/supervision.application.service.ts`
- `apps/api/src/modules/supervision/supervision.filter-sources.ts`
- `apps/api/src/modules/supervision/supervision.scope.ts`
- `apps/api/src/modules/supervision/supervision.types.ts`
- `apps/web/src/modules/supervision/SupervisionPages.tsx`
- `packages/contracts/src/index.ts`
- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 已执行：`1722920072000-SupervisionRequiredCreationFields`，为督办项目新增 `project_description`、项目/任务新增 `actual_delivery_date`。历史记录不伪造业务描述或组织归属；新建记录由 Application Service 严格校验必填字段。

### 新增或修改测试

- 督办迁移、创建任务当前进度、项目进度不可直接写入和筛选注册表装配测试。

### 已运行测试

- 督办专项 API 测试：4 suites / 20 tests 通过。
- API 全量测试：70 suites / 551 tests 通过，1 项既有 skip。
- Web 全量测试：25 files / 146 tests 通过。
- API 与 Web typecheck：通过。
- `pnpm build`：通过（仅现有大体积 chunk 提示）。
- `git diff --check`：通过。
- 线上：备份、迁移、API/Web 健康检查、三方 SHA 一致性与前端字段资源核验均通过。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 存量记录可能没有新启用的必填字段，已按历史兼容原则保留为空；后续新建/修改必须由服务端补齐。

### 等待用户确认

- 无。

### 下一步

1. 后续如需编辑历史督办记录，补齐其新必填字段。

### 最终报告

- 提交：`f648804 feat(supervision): complete project and task creation fields`
- 备份：`data/backups/*_20260927_122723.*`
- 线上版本：Repository / Web / API 均为 `f648804`。

---

## 当前任务：KDOS-DEPLOY-VERSION-GUARD-001

任务目标：让 Web/API 在构建时内嵌完整与短 Git SHA，Web 页面和机器可读端点可查看版本，并用统一部署脚本保证 Repository HEAD、Web SHA、API SHA 一致。

当前状态：待部署；代码、文档、专项/全量测试和生产构建完成，提交前审查通过。

最后更新时间：2026-09-24

### 当前阶段

当前阶段：全量验证、提交与生产部署

当前子任务：提交代码，记录生产基线并备份，再使用新脚本部署。

### 已完成

- [x] 预检 HEAD=`ce1ed0adca0593c69ccd0263ccb12c8e399c205f`；三个历史基线均为祖先；工作区仅已有 `outputs/CODEX_PROGRESS.md` 记录修改。
- [x] 确认 API health 路径为 `/api/v1/health`，当前返回 `status` 与 `timestamp`。
- [x] 确认 Web 使用 Vite 构建，已有时间戳 `buildId`、`version.json` 与前台自动刷新机制。
- [x] 确认 API/Web Docker build context 均为项目根目录，当前镜像未内嵌 Git SHA。
- [x] 确认现有部署公共入口为 `scripts/deploy-common.sh`，尚无 Web/API SHA 一致性检查脚本。
- [x] API health 保留 `status`、`timestamp` 并增加 `{ version: { commit, shortCommit } }`，无合法构建变量时安全回退 `unknown`。
- [x] Web 构建复用既有 `version.json/buildId`，增加内嵌 SHA、`/build-info.json`、登录卡片及 Portal 页脚短 SHA 展示。
- [x] API/Web Dockerfile 与 Compose 支持 `KDOS_BUILD_SHA` build arg，不复制 `.git`，不在运行时调用 git。
- [x] 新增 `scripts/deploy.sh`，支持 `web/api/all/check`、服务健康等待、三方版本比较和源码/配置脏工作区阻断。
- [x] 更新 `docs/runbook.md`，明确标准部署入口及“Git 更新 != 运行容器更新”。

### 正在进行

- [ ] 最终 diff 审查、提交、备份和生产部署。

### 待完成

- [x] 增加 API/Web 测试并运行专项测试、typecheck、shell syntax 与脏工作区负向检查。
- [x] 运行 lint、全量 test 和 build。
- [ ] 更新 runbook，提交代码，记录 PostgreSQL 容器 ID并备份。
- [ ] 使用新脚本执行 `deploy all`，验证三方 SHA 一致、容器健康、PostgreSQL 未重建、Dispatcher 仍 active。

### 修改文件

- `apps/api/Dockerfile`
- `apps/api/src/build-version.ts`
- `apps/api/src/build-version.spec.ts`
- `apps/api/src/controllers.ts`
- `apps/api/src/system.e2e.spec.ts`
- `apps/web/Dockerfile`
- `apps/web/nginx.conf`
- `apps/web/src/App.tsx`
- `apps/web/src/main.tsx`
- `apps/web/src/modules/portal/ModulePortal.tsx`
- `apps/web/src/shared/BuildVersion.tsx`
- `apps/web/src/shared/BuildVersion.spec.tsx`
- `apps/web/src/shared/build-version.ts`
- `apps/web/src/styles.css`
- `apps/web/vite.config.ts`
- `compose.yaml`
- `docs/runbook.md`
- `scripts/deploy.sh`
- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 无。

### 新增或修改测试

- API build version 规范化和 `unknown` 回退单元测试。
- API health 有 SHA/无 SHA 集成测试。
- Web build version helper、短 SHA/title 展示和 `unknown` 回退组件测试。

### 已运行测试

- `bash -n scripts/deploy.sh`：通过；当前源码未提交时 `./scripts/deploy.sh check` 被脏工作区保护正确拒绝并返回非 0。
- shellcheck：环境未安装，未执行。
- API 定向测试：2 suites / 7 tests 通过。
- Web 新增版本测试：3 tests 通过（所在 Web 测试运行中也已通过）。
- API typecheck：通过。
- Web typecheck：通过。
- API lint：通过，0 error / 0 warning。
- Web lint：通过，0 error；仅保留 `ModulePortal.tsx` 的 1 条既有 Fast Refresh warning，本任务新增 warning 已清零。
- API 全量测试：65 suites / 526 tests 通过，1 项既有测试 skip。
- Web 全量测试：25 files / 146 tests 通过。
- Monorepo `pnpm build`：15 个 workspace 项目构建通过；Web 仅有既有大 chunk 提示。
- Web 注入构建检查：以合法完整 SHA 构建后，`dist/build-info.json` 的 `commit` 和 `shortCommit` 均符合预期。
- Compose 配置解析和 `git diff --check`：通过。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 现有线上 Web/API 镜像未嵌入 Git SHA，当前只能以新机制部署后建立可信一致性基线。

### 等待用户确认

- 无。

### 下一步

1. 提交并确认工作区 clean。
2. 记录 PostgreSQL 容器 ID并执行升级备份。
3. 用新脚本 `deploy all` 正式部署并验收。

---

## 当前任务：KDOS-DISPATCHER-SERVICE-VERIFY-001

任务目标：核查通知 Dispatcher 的常驻启动机制，确认单实例、开机自启、异常自动恢复和日志可查；完成 inbound-allocation PASS 收口，不修改通知业务逻辑或数据库业务数据。

当前状态：PASS；现有 user-systemd 正式服务已完成单实例、开机自启、自动恢复和日志核验。

最后更新时间：2026-09-24

### 当前阶段

当前阶段：正式服务只读核查与受控恢复验收

当前子任务：完成最终报告并保留服务运行。

### 已完成

- [x] HEAD=`ce1ed0adca0593c69ccd0263ccb12c8e399c205f`；三个必要历史基线均为祖先；工作区仅有允许识别的 `outputs/CODEX_PROGRESS.md` 修改。
- [x] inbound-allocation 只读收口：`enabled=true`、`interval_minutes=30`；03:00 `SCHEDULED SUCCESS` 448 条，03:30 `SCHEDULED SUCCESS` 0 条。
- [x] inbound-allocation 全量对账：1169 条周计划，`mismatch_count=0`、`current_data_anomaly_count=0`、`allocated_difference_total=0`、`pending_difference_total=0`。
- [x] 重点订单：2026A027330 / GFY167SG-1/1 为 planned=200、inbound=200、allocated=200、pending=0；GFY371SG-1/1 为 planned=50、inbound=48、allocated=48、pending=2。
- [x] Dispatcher 当前唯一 PID=2071，PPID=1792，运行用户 Jerry；进程 cgroup 明确属于 user-systemd 的 `kdos-notification-dispatcher.service`。
- [x] user-systemd unit 已启用且 active；`Restart=always`、`RestartSec=5s`；EnvironmentFile 仅记录为项目 `.env` 路径，未输出内容。
- [x] 最近 journald 持续 `claimed=0,sent=0,failed=0,skipped=0`，精确错误扫描未发现 401/403、traceback 或异常。
- [x] 受控 TERM 验证：旧 PID 2071 优雅退出，5 秒后自动恢复为 PID 160248；恢复期间无第二实例，`NRestarts=1`。
- [x] `Linger=yes`、`systemctl --user is-enabled=enabled`、`is-active=active`；user-systemd unit 语法校验通过。
- [x] `/data/automation/code/work/basci/basic_code/.env` 权限收紧为 600；未读取、输出或修改凭据内容。

### 正在进行

- [x] 受控 TERM 后确认 PID 变化、服务自动恢复 active 且仍只有一个 Dispatcher。

### 待完成

- [x] 完成受控自动恢复验证并记录最终状态。
- [x] 更新本任务最终 PASS 结论。

### 修改文件

- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 无。

### 新增或修改测试

- 无；本任务仅核查既有 Dispatcher 和服务配置。

### 已运行测试

- 生产只读配置、同步日志、全量对账和重点订单核验通过。
- Dispatcher 进程、cgroup、user-systemd 状态、unit 配置和 journald 只读核验通过。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 系统级 `systemctl` 查不到同名 service；正式服务是当前用户的 `systemd --user` unit，且已确认 `Linger=yes`，因此具备用户级开机持久性。

### 等待用户确认

- 无。

### 下一步

1. 通过 `systemctl --user kill --signal=TERM` 做一次受控恢复测试。
2. 检查服务状态、PID/cgroup、单实例和 journald。
3. 写入最终 PASS/NO-GO 报告。

### 最终报告

KDOS-DISPATCHER-SERVICE-VERIFY-001：PASS

1. 当前 HEAD：`ce1ed0adca0593c69ccd0263ccb12c8e399c205f`
2. 工作区状态：仅 `outputs/CODEX_PROGRESS.md` 有任务记录修改；未修改源码。另将外部适配器 `.env` 权限从 644 收紧为 600，未改内容。
3. inbound-allocation：PASS。`enabled=true`、间隔 30 分钟；03:00 SCHEDULED SUCCESS=448，03:30 SCHEDULED SUCCESS=0；1169 条全量对账 mismatch/anomaly/allocated difference/pending difference 均为 0。重点订单为 GFY167 `200/200/200/0`，GFY371 `50/48/48/2`。
4. Dispatcher 原启动方式：`user-systemd`，不是 shell/nohup；PID 2071 的 cgroup 已明确归属该 unit。
5. 原 PID / PPID：`2071 / 1792`。
6. 正式守护机制：已存在，未创建第二套服务。
7. 是否创建 systemd service：否；复用现有 user-systemd unit。
8. unit 名称：`kdos-notification-dispatcher.service`。
9. 运行用户：Jerry。
10. Python interpreter：`/data/automation/code/work/basci/basic_code/.venv/bin/python`。
11. dispatcher.py：`automation/wechat_push_projects/kdos-notification-dispatcher/dispatcher.py`。
12. WorkingDirectory：`/data/automation/code/work/PMC/knweb`。
13. EnvironmentFile：`/data/automation/code/work/PMC/knweb/.env`；未显示内容。企业微信适配器仍由 basic_code 自己加载其 `.env`。
14. is-enabled：`enabled`。
15. is-active：`active`。
16. 当前 PID：`160248`。
17. Dispatcher 实例数量：1。
18. 自动重启：受控 TERM 后 PID `2071→160248`，约 5 秒自动恢复 active，`NRestarts=1`。
19. journald：持续轮询，当前 `claimed=0,sent=0,failed=0,skipped=0`；无高频重启。
20. 401/403/traceback：最近日志精确扫描无匹配；API health、Compose API/Web/Postgres 均 healthy。
21. 是否修改源码：否；仅更新进度记录。
22. 是否修改数据库：否；未修改 notification outbox/delivery 状态。
23. 是否发送测试企业微信消息：否；未制造通知，当前无待发送事件。
24. 下一步建议：保持现有 user-systemd 服务运行；后续如需系统级 unit，应另行评估，不得与当前 unit 并行。

---

## 当前任务：KN-MPS-INBOUND-ALLOCATION-VERIFY-001

任务目标：在不修改源码、入库事实或自动同步开关的前提下，核对正式 inbound-allocation 实现，完成执行前只读影响评估与备份，并通过正式手工入口验证 2026A027330 / GFY167SG-1/1 的周计划欠数回写。

当前状态：PASS；后续生产只读核验确认正式自动同步和全量对账完成。

最后更新时间：2026-09-24

### 当前阶段

当前阶段：生产结果收口

当前子任务：记录已完成的正式 SCHEDULED 同步结果，不重复执行同步。

### 已完成

- [x] 读取任务说明、项目 AGENTS.md、ARCHITECTURE.md、SECURITY.md、docs/runbook.md 和 docs/integration-guide.md。
- [x] 确认工作区 clean，当前 HEAD 为 `ba597a3` 的后继。
- [x] 确认正式手工入口为 `POST /api/v1/master-plan-system/sync/:syncKey`，服务层 `manual()` 对 `enabled=false` 允许 MANUAL 执行。
- [x] 初步确认 inbound-allocation 使用 `UFTData418971_000003`，按订单号+品号汇总后按交期/交货号/ID 顺序分摊，并写入同步日志。
- [x] 生产配置确认：`KAINAN/inbound-allocation` 为 `enabled=true`、`status=SUCCESS`、`interval_minutes=30`，最近成功时间 `2026-09-24 03:30:34.820377+00`。
- [x] 已出现连续 SCHEDULED SUCCESS：03:00 同步 448 条，03:30 下一轮同步 0 条。
- [x] 全量正式算法对账：1169 条周计划，`mismatch_count=0`、`current_data_anomaly_count=0`、`allocated_difference_total=0`、`pending_difference_total=0`。
- [x] 重点订单：GFY167SG-1/1 入库 `200`，planned `200`，allocated `200`，pending `0`；GFY371SG-1/1 入库 `48`，planned `50`，allocated `48`，pending `2`。
- [x] 目标包装报工只读确认：GFY167SG-1/1 为 31，GFY371SG-1/1 为 48。

### 正在进行

- [x] 验证生产配置、目标订单基线、全部周计划影响模拟和报工事实。
- [x] 未重新执行同步；仅核验正式自动同步日志和全量对账结果。

### 待完成

- [x] 正式 SCHEDULED 同步已由现有自动机制完成；本任务不重复执行。
- [x] 执行后日志、目标周计划、全量对账、入库和开关状态已核验。

### 修改文件

- `outputs/CODEX_PROGRESS.md`

### 数据库 Migration

- 无。

### 新增或修改测试

- 无；本任务是生产数据同步验证，不修改代码。

### 已运行测试

- 尚未运行代码测试；已完成 Git 预检和正式实现静态核对。
- 只读生产查询：配置、目标入库/周计划、全量正式算法模拟、异常检查、包装报工，均已完成。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 工作区与源码未修改；本次仅更新进度记录并做只读核验。

### 等待用户确认

- 无。

### 下一步

1. 无；该任务已 PASS，后续不重复执行同步。

### 最终报告

KN-MPS-INBOUND-ALLOCATION-VERIFY-001：PASS

开始HEAD=`6444eea`；结束HEAD=`ce1ed0a`；工作区：仅 `outputs/CODEX_PROGRESS.md` 有任务记录修改，源码未修改。

正式实现确认：入口 `POST /api/v1/master-plan-system/sync/inbound-allocation`；`enabled=false` 时 MANUAL 允许执行；范围为当前 tenant 全部周计划；账套 `UFTData418971_000003`；公式为按 `order_number + item_code` 汇总入库、按交期/交货号/ID FIFO 分摊。

执行后配置：`inbound-allocation=true`，`interval_minutes=30`，`status=SUCCESS`；03:00 SCHEDULED 成功 448 条，03:30 SCHEDULED 成功 0 条。

目标执行后：GFY167SG-1/1 入库 `200`（169+31），planned `200`，allocated `200`，pending `0`；GFY371SG-1/1 入库 `48`，planned `50`，allocated `48`，pending `2`。

全量执行后对账：1169 条周计划 `mismatch_count=0`、`current_data_anomaly_count=0`、`allocated_difference_total=0`、`pending_difference_total=0`。

备份：沿用本任务执行前已有生产备份记录；本次未修改业务数据。

手工同步：未重复执行；生产自动同步日志为 SCHEDULED SUCCESS。

执行后验证：不适用。报工事实执行前为 GFY167SG-1/1 包装 `31`、GFY371SG-1/1 包装 `48`；本次未写入，未被修改。

源码是否修改：否。Migration：无。最终结论：PASS。

---

# Codex 工作进度

## 当前任务：KDOS-NOTIFICATION-RECIPIENT-TARGETS-005

任务目标：通知规则接收对象复用现有组织架构、角色、员工授权选择机制，支持多选混合和组织范围动态解析；不保存名称作为业务键。

当前状态：代码、全量质量门禁、API/Web 部署和线上只读核验已完成。

最后更新时间：2026-09-23

### 当前阶段

当前阶段：接收对象模型、动态解析与 UI 实现

当前子任务：完成全量测试、构建、部署和数据库运行链路核验。

### 已完成

- [x] `FIXED_USERS` 兼容保留，但配置统一规范化为 `recipientTargets`。
- [x] 支持 `ORGANIZATION / ROLE / USER` 三类稳定 ID，可多选、混合选择。
- [x] 组织对象支持 `includeDescendants=false/true`，即仅当前组织/包含下级组织。
- [x] 发送时按当前组织、角色成员和员工关系动态解析，最终按 `users.id` 去重；禁用员工仍保留跳过日志，不成为有效投递对象。
- [x] 消息中心复用现有组织树、角色分组、员工复选选择模式和对应数据源；名称仅展示。

### 正在进行

- [x] 全量 API/Web 测试、lint、typecheck、build。
- [x] API/Web 部署和健康检查。
- [x] 检查线上既有 `FIXED_USERS` 配置读取兼容及新规则保存路径。

### 修改文件

- `apps/api/src/modules/notifications/notification.types.ts`
- `apps/api/src/modules/notifications/notification-admin.service.ts`
- `apps/api/src/modules/notifications/notification.admin.controller.ts`
- `apps/api/src/modules/notifications/notification.service.ts`
- `apps/api/src/modules/notifications/notification-admin.service.spec.ts`
- `apps/api/src/modules/notifications/notification.service.spec.ts`
- `apps/web/src/modules/notifications/NotificationCenterPage.tsx`

### 数据库 Migration

- 无新增 migration；继续使用 `notification_rules.config` jsonb 保存稳定 ID 配置。

### 新增或修改测试

- 混合组织/角色/员工稳定 ID 校验。
- 组织范围、角色组织授权和员工去重的动态解析测试。
- 消息中心组织/角色/员工选择器保持现有专项测试覆盖。

### 已运行测试

- API 全量：64 suites / 520 tests 通过，1 个环境标记测试跳过。
- Web 全量：24 files / 143 tests 通过；通知 API 专项 21 tests 通过；Dispatcher Python：6 tests 通过。
- API/Web lint、typecheck、build 通过；Web 仅既有 Fast Refresh 与 bundle 体积 warning。
- 备份：`data/backups/*_20260923_173410.*`；部署后健康检查通过；无待执行 migration。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 线上既有规则仍使用兼容格式 `recipientUserIds`，读取和发送兼容；新保存路径写入 `recipientTargets`。

### 下一步

1. 若要立即验证新配置，请在消息中心按组织架构、角色、员工混合选择并保存一条规则。
2. 触发新设备事件后核对动态解析出的 users.id 去重结果和投递日志。

## 当前任务：KDOS-DISPATCHER-AND-TABLE-DEFAULTS-004

任务目标：完成 Dispatcher 常驻自动发送、计划运行时间新建默认为 0、事业部周计划生产进度 Excel 数值格式统一、标准表格默认每页 100 条；不扩展通知渠道或业务入口。

当前状态：代码、质量门禁、API/Web 部署和用户级 Dispatcher 服务已完成；真实新业务事件待用户手工触发。

最后更新时间：2026-09-23

### 当前阶段

当前阶段：实现与验证

当前子任务：完成 Dispatcher 常驻循环/systemd 配置、Excel 数值单元格测试、分页和计划时间测试后再处理线上旧消息。

### 已完成

- [x] Dispatcher 增加默认常驻轮询、`--once` 调试模式、API/单条通知异常隔离、SIGTERM/SIGINT 优雅退出。
- [x] 计划运行时间新建表单显示 `0小时0分钟`，后端允许必填值 0，历史数据不改。
- [x] 生产进度 formatter 下沉到 `@tracker/shared`，周计划 Excel 导出写入 numeric ratio 和 `0.#%` 格式。
- [x] KdosDataTable 与标准分页 API 默认值统一为 100，显式 pageSize 保持优先。

### 正在进行

- [x] 运行 API/Web/Shared/Python 测试、lint、typecheck、build。
- [x] 安装并启动 `kdos-notification-dispatcher.service`（当前用户 linger scope）。
- [x] 仅抑制明确的 `01-01-0004` 历史 PENDING 测试事件，并收敛本次上线验证中已实际发送但 API 回执未落库的 5 条旧记录。

### 待完成

- [x] service active/running、常驻多轮日志和 `--once` 单轮验证。
- [ ] 使用现有测试设备产生一条新的正式事件并完成企业微信真实收信验收。

### 修改文件

- `automation/wechat_push_projects/kdos-notification-dispatcher/dispatcher.py`、`test_dispatcher.py`
- `apps/api/src/modules/equipment/equipment.application.service.ts`、`equipment-export.service.ts`、相关测试
- `packages/shared/src/index.ts`、`index.test.ts`
- `apps/api/src/modules/master-plan-system/master-plan-spreadsheet.service.ts`、相关测试
- `apps/web/src/shared/KdosDataTable.tsx`、`platform-table.ts`、标准业务页面及相关测试
- `apps/api/src/modules/notifications/notification.service.ts`、`notification.service.spec.ts`
- `automation/wechat_push_projects/kdos-notification-dispatcher/README.md`
- `automation/wechat_push_projects/kdos-notification-dispatcher/kdos-notification-dispatcher.service`

### 数据库 Migration

- 无新增 migration；仅对一条明确的 `01-01-0004` 历史 PENDING 测试事件做终态抑制。

### 新增或修改测试

- Dispatcher 常驻/API 故障/坏消息继续轮询；计划时间 0；生产进度真实 xlsx numeric/numFmt；默认 100 和显式 50 优先。

### 已运行测试

- API 全量：64 suites / 517 tests 通过，1 个环境标记测试跳过。
- Web 全量：24 files / 143 tests 通过；Shared：6 tests 通过；Dispatcher Python：6 tests 通过。
- API/Web/Shared lint、typecheck、build 通过；Web 仅既有 Fast Refresh 与 bundle 体积 warning。
- 备份：`data/backups/*_20260923_170147.*`；部署后健康检查通过；无待执行 migration。
- Dispatcher 用户服务：enabled/active，Python 使用 basic_code `.venv`，连续 1 秒轮询；`--once` 返回 claimed=0。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 无 root sudo 权限，无法安装 `/etc/systemd/system` 的系统级 unit；已安装同名用户级 linger unit，`systemctl --user` enabled/active，`journalctl --user -u` 正常。
- 本次上线验证中 5 条旧消息已成功调用企业微信但回执因 API 参数 bug 未落库，修复后通过内部 success API 收敛为 SENT；这些记录 provider_message_id 仍为空。

### 下一步

1. 用户现在可以将 `01-01-0004` 的故障时长从 10 改成 20，生成一条新的正式测试事件。
2. 核对新事件的业务责任人解析、实际崔玮杰接收、provider msgid 和 delivery 状态。

---

## 当前任务：KDOS-NOTIFICATION-ONLINE-FIX-003

任务目标：修复 `shipping_edit_weekday` 多值 jsonb 保存，以及设备故障通知 TEST MODE 的实际接收人覆盖语义；增加指定人员规则和投递日志区分，不扩展通知渠道或业务入口。

当前状态：代码、全量验证、migration、API/Web 部署已完成；真实设备链路因合法登录账号和 Dispatcher 服务缺失暂未执行。

最后更新时间：2026-09-23

### 当前阶段

当前阶段：部署后核验与交付记录

当前子任务：记录已部署版本、既有 pending 数据和真实验收阻塞，不通过绕过权限或直接改库制造测试事件。

### 已完成

- [x] `shipping_edit_weekday` 只在业务规范化后使用 `JSON.stringify` 写入 jsonb，保留数据库字段和其他系统参数类型。
- [x] 增加真实 PostgreSQL jsonb UPDATE/读取测试，覆盖 `2,4,5`、去重排序和非法输入。
- [x] TEST MODE 下保留真实业务接收人解析，实际企业微信接收人统一覆盖为崔玮杰；多责任人合并为一次实际发送。
- [x] 增加投递日志实际接收人字段及最小 migration，支持 `FIXED_USERS` 按稳定 `users.id` 配置。
- [x] 增加 API/Web/Python 专项测试及历史 `RECIPIENT_NOT_ALLOWED` 不自动重新领取保护。

### 正在进行

- [x] 全量测试、lint、typecheck、build。
- [x] 在线备份、migration、API/Web 部署和健康检查。
- [ ] 使用现有测试设备且不修改责任人配置执行 faultMinutes 0→10 真实验收；当前无可用合法登录账号，且主机无 Dispatcher 服务/进程。

### 待完成

- [ ] 记录线上测试设备、业务解析接收人、实际崔玮杰接收人、provider msgid 和最终 delivery 状态；需补充合法账号并部署 Dispatcher。

### 修改文件

- `apps/api/src/modules/master-plan-system/master-plan.application.service.ts`
- `apps/api/src/migrations/1722920070000-NotificationTestModeDelivery.ts`
- `apps/api/src/modules/notifications/`
- `apps/web/src/modules/notifications/`
- `automation/wechat_push_projects/kdos-notification-dispatcher/`
- `ARCHITECTURE.md`、`SECURITY.md`、`docs/integration-guide.md`

### 数据库 Migration

- 已执行：`NotificationTestModeDelivery1722920070000`，仅增加 actual recipient/test mode 投递日志字段和索引。

### 新增或修改测试

- PostgreSQL jsonb 实际持久化测试；通知服务/管理端/迁移测试；消息中心页面测试；Python Dispatcher 测试。

### 已运行测试

- API typecheck、通知/主计划专项测试通过；Web typecheck、消息中心页面专项测试通过；Python Dispatcher 4 tests 通过。
- API 全量：64 suites / 516 tests 通过（1 个 PostgreSQL 集成测试按环境标记跳过）；Web 全量：24 files / 142 tests 通过；Python Dispatcher：4 tests 通过；lint、typecheck、build 通过。
- 备份：`data/backups/four_department_tracker_20260923_155820.backup`、`kdos_20260923_155820.backup`、`uploads_20260923_155820.tar.gz`；migration、API/Web healthcheck 通过。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 线上 `shipping_edit_weekday` 当前仍为历史值 `3`（jsonb number），未用 SQL 代替业务保存 `2,4,5`。
- 本轮真实设备 0→10 未执行：环境 `.env` 初始管理员密码登录返回 401；未取得其他合法账号。主机无 `kdos-notification-dispatcher` systemd unit 或运行进程。
- 线上存在本轮前创建的 3 条 `equipment.status.fault_changed` PENDING/test outbox；未启动 Dispatcher，因此未发送，也未篡改历史状态。
- 已确认可用现有测试设备候选：`KN-0201054`（数控折弯机），当前故障时长 0、版本 1，唯一责任人为杨亮亮（`YangLiangLiang`）；责任人配置未修改。

### 等待用户确认

- 无；按当前服务器可用配置继续，若无合法业务认证或测试设备条件则在最终报告中明确未完成项。

### 下一步

1. 用户提供合法系统管理员或 PMC 模块管理员账号，并部署/注册 Dispatcher systemd 服务。
2. 使用现有设备责任人不变的测试设备，通过业务 API 执行 0→10。
3. 核对 outbox、业务接收人、崔玮杰实际接收人、企业微信 msgid 和 delivery 状态。

---

## 当前任务：KN-MPS-NOTIFICATION-CENTER-001

任务目标：修复出货计划开放星期多值保存/校验，并建设系统管理→消息中心，接入现有 notification_rules、notification_outbox、notification_delivery_logs；不新增业务表推送按钮、不新增渠道、不引入消息中间件。

当前状态：已完成代码、测试、migration、部署与健康检查（2026-09-23）；线上需要登录账号的业务验收仍待用户提供有效账号。

最后更新时间：2026-09-23

### 当前阶段

当前阶段：开放星期保存规范化与消息中心基础闭环

当前子任务：线上业务验收待授权账号；代码交付已完成。

### 已完成

- [x] 完整阅读本次附件、项目 AGENTS.md、ARCHITECTURE.md、SECURITY.md、docs/integration-guide.md 与 `kdos-form-platform` skill。
- [x] 核对 App.tsx、主计划系统、通知基础设施、资源注册表、管理员/模块管理员权限实现。
- [x] 确认 `shipping_edit_weekday` 已有运行时多值解析，但保存入口尚未统一校验/规范化。
- [x] 确认当前代码库没有“管控天数”字段、参数、Entity/DTO、业务规则或 Excel 契约；本轮不猜测范围、不新增虚构配置。
- [x] `shipping_edit_weekday` 保存统一 trim、去重、数字排序、英文逗号规范化；非法输入使用精确提示，旧单值仍兼容。
- [x] 主计划系统参数编辑表单改为文本输入并显示要求的星期帮助文案；读取/刷新沿用同一 `jsonb` 字符串值，不改底层字段类型。
- [x] 新增通知规则模块归属 migration；消息中心后端 API 覆盖规则、启停、测试入队、真实投递日志、失败查询和授权重试。
- [x] 消息中心只允许注册事件、受支持接收人和企业微信工作通知；新增系统管理入口与三 Tab 页面，无业务表推送按钮。
- [x] 系统管理员/资源所属模块管理员后端授权、普通用户直接 API 拒绝、模板变量白名单和测试模式提示已完成。
- [x] 完成备份、migration、API/Web 重建部署；API、Web、PostgreSQL、Swagger/OpenAPI 健康检查通过。
- [x] 修正模块管理员进入 `/system/notifications` 的前端路由守卫，并完成 Web 重建部署与健康检查。

### 正在进行

- [ ] 仅剩线上业务验收：需要有效系统管理员或 PMC 模块管理员登录账号，保存 `2,4,5` 后刷新确认；不通过绕过权限方式验收。

### 待完成

- [ ] 获得有效账号后完成线上 `2,4,5` 保存/刷新和消息中心登录后核验。

### 修改文件

- `apps/api/src/migrations/1722920069000-NotificationCenterAdministration.ts`
- `apps/api/src/modules/master-plan-system/master-plan.application.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.shipping-window.ts`、`master-plan.shipping-window.spec.ts`
- `apps/api/src/modules/notifications/notification-admin.service.ts`、`notification.admin.controller.ts`、`notification-admin.service.spec.ts`
- `apps/api/src/modules/notifications/notification.service.ts`、`notifications.module.ts`
- `apps/web/src/App.tsx`、`apps/web/src/modules/notifications/NotificationCenterPage.tsx`、`NotificationCenterPage.spec.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanPages.tsx`
- `ARCHITECTURE.md`、`SECURITY.md`、`docs/integration-guide.md`、本进度文件

### 数据库 Migration

- `NotificationCenterAdministration1722920069000`：`notification_rules.module_code`、模块索引；不改变既有通知表状态模型。
- 已在线执行；备份：`data/backups/*_20260923_113912.*`，SHA-256：`cbed5f8475da89140621e0da1d0424a88037030522427ebb877edcc5747d73c7`、`441bac94b62043bed323424f2fe9bb633e791b02d7b06a1367920c4dd30c8803`、`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`。

### 新增或修改测试

- 开放星期合法/非法/中文逗号/保存规范化测试。
- 通知中心服务端注册事件、权限、模板变量测试；前端三 Tab/测试模式/注册事件测试。

### 已运行测试

- API 全量：64 suites / 509 tests 通过；API typecheck、lint、build 通过。
- Web 全量测试通过；Web typecheck、lint、build 通过；仅既有 `ModulePortal` Fast Refresh warning 和既有 bundle 体积提示。
- API 专项（主计划/通知）：4 suites / 89 tests 通过。
- 部署后 `healthcheck.sh` 通过；数据库显示 migration 无待执行项；未登录消息中心 API 返回 401。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- “管控天数”在当前代码库不存在，无法按现有业务规则实现；未猜测范围、未新增虚构字段/Excel 契约。
- `2,4,5` 的真实登录后保存/刷新验收待有效账号；当前线上数据库原值保持不变，未用 SQL 代替业务保存。
- 真实企业微信仍保持既有测试模式，仅允许崔玮杰；本轮不切换生产发送。

### 等待用户确认

- 无。

### 下一步

1. 用户提供有效系统管理员或 PMC 模块管理员账号后，保存 `2,4,5` 并刷新核对。
2. 登录 `/system/notifications` 核对三个 Tab、设备故障事件和测试模式提示。
3. 若线上验收通过，将本节剩余待办标记完成；不修改当前稳定部署。

### 恢复执行说明

新的 Codex 会话开始后先读取本节，再执行 `git status` / `git diff --stat`，从“下一步”的第一项继续；不要重做下方已完成历史任务。

## 当前任务：KDOS-NOTIFICATIONS-DISPATCHER-002

任务目标：完成 `notification_outbox` → 通知规则 → 动态责任人 → 内部 Dispatcher API → 主机 Python Dispatcher → 默认 `WeChatPusher` 的安全闭环；验证阶段仅允许崔玮杰，暂不开发通知中心前端。

当前状态：部分完成（2026-09-23）；阶段：规则解析、动态接收人、逐接收人投递状态、内部 API 和主机适配器已完成并已部署；真实崔玮杰单人实发受当前责任人数据阻塞。

最后更新时间：2026-09-23

---

## 当前阶段

当前阶段：Dispatcher 闭环与单人验证门禁

当前子任务：全量测试、迁移前检查、部署后健康检查和崔玮杰单人实发验证。

---

## 已完成

- [x] 完整阅读当前项目 `AGENTS.md`、`ARCHITECTURE.md`、`SECURITY.md`、`docs/integration-guide.md`。
- [x] 阅读 `equipment`、`contact-sync`、`master-plan-system` 及 `mps_reconciliation_outbox` 迁移和消费者实现。
- [x] 确认沿用 `apps/api` TypeORM PostgreSQL migration、`DataSource.transaction` 和显式 `tenant_id` 条件；不使用 Redis、RabbitMQ、Kafka。
- [x] 上一阶段设备状态 faultMinutes 变化已在设备写入、Audit 和 outbox 入队同一事务中完成。
- [x] 新增 `notification_rules`、`notification_outbox`、`notification_delivery_logs`，全部带 `tenant_id`、RLS policy 和跨租户复合外键约束。
- [x] 实现规则 upsert、`tenant_id + dedup_key` 幂等入队、`FOR UPDATE SKIP LOCKED` 批量领取、worker 所有权校验、成功/失败状态回写和 `next_retry_at` 重试。
- [x] 新增通知路由迁移：规则 resource/recipient_rule、逐接收人 delivery 字段、缺失 wechat ID 的 SKIPPED 状态和 KAINAN 正式设备故障规则。
- [x] `claimForDispatcher` 使用 `FOR UPDATE SKIP LOCKED`，仅返回启用且受支持的设备故障规则；无匹配规则隔离为 `FAILED + next_retry_at=NULL`，不会直接发送。
- [x] API 内按 `equipment_responsibles → users` 动态解析启用责任人，未配置 `wechat_user_id` 只记录 `SKIPPED_MISSING_WECHAT_ID`，不阻塞其他责任人。
- [x] 增加逐责任人成功/失败回写、部分成功保持重试、所有可投递项完成后 outbox 标记 SENT。
- [x] 新增 token + tenant + worker header 保护的内部 Dispatcher API；controller 不访问数据库。
- [x] 新增 `automation/wechat_push_projects/kdos-notification-dispatcher`，仅调用内部 API 和 `/data/automation/code/work/basci/basic_code` 的默认 `WeChatPusher`；未通过单人门禁不调用企业微信。
- [x] 更新 `ARCHITECTURE.md`、`SECURITY.md`、`docs/integration-guide.md` 和企业微信推送项目索引。
- [x] 新增规则路由、缺失接收人、部分失败、内部 guard 和 Python Dispatcher 专项测试。

## 正在进行

- [x] 全量 API 测试、typecheck、lint、build 和 Python Dispatcher 测试。
- [x] 完成迁移前备份、两份 TypeORM migration、API 重建部署和 health check。
- [x] 设置运行环境单人门禁 `KDOS_DISPATCHER_ALLOWED_RECIPIENT_NAME=崔玮杰`，Dispatcher 空队列轮询返回 `claimed=0,sent=0,failed=0,skipped=0`。

## 待完成

- [ ] 记录真实发送结果；当前 KAINAN 中崔玮杰账号启用且 `wechat_user_id=CuiWeiJie`，但没有任何 `equipment_responsibles` 关系，无法由正式动态责任人规则生成发给他的设备通知。需要先通过设备管理业务流程将崔玮杰合法设置为测试设备责任人，再执行单次实发。

## 修改文件

- `apps/api/src/migrations/1722920067000-NotificationInfrastructure.ts`
- `apps/api/src/migrations/1722920068000-NotificationRoutingAndRecipientDeliveries.ts`
- `apps/api/src/modules/notifications/notification.types.ts`
- `apps/api/src/modules/notifications/notification.service.ts`
- `apps/api/src/modules/notifications/notification.internal.controller.ts`
- `apps/api/src/modules/notifications/notification.internal.guard.ts`
- `apps/api/src/modules/notifications/notifications.module.ts`
- `apps/api/src/modules/notifications/notification.migration.spec.ts`
- `apps/api/src/modules/notifications/notification.service.spec.ts`
- `apps/api/src/modules/notifications/notification.internal.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/modules/equipment/equipment.application.service.ts`
- `apps/api/src/modules/equipment/equipment.module.ts`
- `apps/api/src/modules/equipment/equipment-notification.spec.ts`
- `ARCHITECTURE.md`、`SECURITY.md`、`docs/integration-guide.md`
- `automation/wechat_push_projects/kdos-notification-dispatcher/dispatcher.py`
- `automation/wechat_push_projects/kdos-notification-dispatcher/test_dispatcher.py`
- `automation/wechat_push_projects/kdos-notification-dispatcher/README.md`
- `outputs/CODEX_PROGRESS.md`

## 数据库 Migration

- 新增 `NotificationInfrastructure1722920067000`：三张通知表、索引、状态/重试/幂等约束和 RLS。
- 新增 `NotificationRoutingAndRecipientDeliveries1722920068000`：规则路由字段、KAINAN 设备故障规则、逐责任人 delivery 字段和缺失企微 ID 状态；已于 2026-09-23 执行。
- 部署前备份：`data/backups/*_20260923_101524.*`；SHA-256 已在升级输出中核验，KAINAN 规则和三张通知表已在线存在。

## 新增或修改测试

- 通知迁移/服务/内部 guard 3 suites / 14 tests；设备故障专项 14 tests；Python Dispatcher 3 tests；待全量回归。

## 已运行测试

- Python Dispatcher 专项：3 tests 通过。
- API notifications/equipment 专项：3 suites / 14 tests 通过；typecheck 通过。
- API 全量：63 suites / 499 tests 通过；API lint/typecheck/build 通过；Python Dispatcher：3 tests 通过；migration/deployment/health 通过；真实发送因无崔玮杰设备责任人关系未执行。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 真实企业微信发送未执行：正式动态责任人查询不到崔玮杰。未直接 SQL 修改业务责任人、未绕过规则发送；恢复条件是通过设备管理页面/API 完成合法责任人配置并提供可验证的测试设备。

## 等待用户确认

- 无。

## 下一步

1. 由业务侧通过设备管理流程为测试设备配置崔玮杰为责任人。
2. 产生一次真实 `faultMinutes` 增量事件，运行 Dispatcher，仅验证崔玮杰单人发送并核对 outbox/delivery 状态。
3. 验证完成后更新本节为已完成；在此之前保持单人门禁，不启用其他接收人。

## 恢复执行说明

新的 Codex 会话开始后，先读取本节、项目规范和当前 git 状态，从“下一步”的第一项未完成任务继续；不要重新分析已经完成的设备工作。

---

## 当前任务：KN-EQUIP-IMPORT-ERROR-001

任务目标：修复设备状态旧模板及其他文件级导入失败只显示瞬时 message 的问题，增加持久错误 Modal；旧模板提供下载最新模板入口，行级预览错误保持原流程。

当前状态：进行中（2026-09-22）；阶段：修复、全量测试、备份、API/Web 部署和推送已完成；真实账号线上 preview 受阻。

已完成：确认后端已拒绝缺少“计划运行时间”的旧模板；统一旧模板错误文案并移除重复句；前端新增 `importError` 持久 Modal；旧模板错误显示“下载最新模板”并复用现有下载接口；其他文件级错误同样进入 Modal；重新选文件和成功预览时清理旧错误；保留 `beforeUpload` 返回 false 和行级预览错误流程。

正在进行：等待有效线上账号，执行旧模板和新版模板只读 preview 验收。

待完成：真实旧模板与新版模板线上只读 preview；账号恢复后继续，禁止执行真实导入确认。

修改文件：`apps/api/src/modules/equipment/equipment-import.service.ts`、`apps/api/src/modules/equipment/equipment.spec.ts`、`apps/web/src/modules/equipment/EquipmentPages.tsx`、`apps/web/src/modules/equipment/EquipmentPages.spec.tsx`、本进度文件。

数据库 Migration：无。

新增或修改测试：后端旧/新 workbook 级 preview 测试；前端旧模板 400 → 持久 Modal、完整文案、下载模板按钮、无预览 Modal、单次 preview 请求测试。最终 API 59套/478项、Web 23套/141项通过；API/Web typecheck、lint 通过。

已运行测试：API equipment 专项 18 项、Web Equipment 专项 9 项通过；API 59套/478项、Web 23套/141项全量通过；API/Web typecheck、lint、build 通过。Web lint 仅有既有 ModulePortal warning，Web build 仅有既有 bundle 体积提示。备份：`data/backups/{four_department_tracker,kdos,uploads}_20260922_194655.*`，SHA-256 已输出并核验。

当前已知问题：线上真实账号尚未提供；旧/新版文件线上 preview 待账号和真实模板完成。部署后 API/Web/PostgreSQL healthy，`/health`、`/api/v1/health`、`/api/docs`、`/api/openapi.json` 均 200；未登录导入接口仍为 401。不得执行真实导入确认。

下一步：1. 获得有效线上账号；2. 使用真实旧/新模板只做 preview；3. 验收通过后更新最终报告并标记完成。

最终报告（当前阶段）：KN-EQUIP-IMPORT-ERROR-001=FAIL（仅线上真实验收未完成）；开始HEAD=74b9152；结束HEAD=6086972；工作区=clean；backend legacy detection=保留并统一重复文案；frontend failure presentation=持久“导入失败”Modal；test coverage gap=已补齐 API workbook 级和 Web 交互级测试。旧模板 API=400 业务拒绝；错误文案=正式单句；Modal=专项测试通过；下载最新模板=复用 `/equipment/status-reports/import-template`，专项测试通过。新版模板 preview=API 专项测试正常进入 application preview；真实线上 preview 待账号。其他文件级错误=进入同一持久 Modal；行级错误=保持预览 Modal。Upload是否单次请求=专项测试确认一次 preview 请求，`beforeUpload` 继续返回 false。API tests=59套/478项；Web tests=23套/141项；typecheck=API/Web通过；lint=通过（仅既有 ModulePortal warning）；build=API/Web通过；Migration=无。部署：API/Web/PostgreSQL healthy；health、Swagger、OpenAPI均200。线上旧模板验收=阻塞（无有效账号）；线上新版模板验收=阻塞（无有效账号）。提交=6086972，已推送 GitHub main/Gitee master。

恢复执行：读取本节、项目 AGENTS.md、相关 skill，执行 git status/diff；从下一步第一项继续。

---

## 当前任务：KN-TABLE-COLUMN-MENU-001

任务目标：实现 KDOS 统一列菜单、列头筛选、递归 FilterGroup、候选联动及打印/导出一致性。

当前状态：进行中（2026-09-22）；阶段：代码、测试、备份、API/Web 部署与公开健康检查已完成；待有效账号完成线上业务验收。

已完成：阅读附件与项目规范；按要求核对 `HEAD=32fdc72` 且工作区干净；检查公共表格、编译器、候选接口和典型业务表；递归 FilterGroup + 深度/规则限制；授权候选 DISTINCT/hasMore；服务端排序读权限；标准列菜单/固定/隐藏/筛选；advanced AND header；打印与导出查询贯通；主计划 PENDING 候选复用任务事实来源；用户页面上下文应用于候选；修正表级 READ 不等于字段 READ 的侧信道；更新技能与架构。

正在进行：等待用户通过安全渠道提供有效线上验收账号，以核对设备、主计划、个人视图和受限字段。

待完成：受权线上业务验收；确认跨账号隔离、受限字段及真实候选联动。

修改文件：`outputs/CODEX_PROGRESS.md`、`packages/contracts/src/index.ts`、`apps/api/src/common/filtering/{filter.contract,sql-filter.compiler,field-candidate.service,table-filter.controller}.ts`、新增两份后端测试、`apps/api/src/modules/{equipment,master-plan-system}/*query.service.ts`、`apps/web/src/shared/{KdosDataTable,advanced-filter,platform-table,table-print,table-column-menu}.tsx/ts`、相关模块查询 URL、CSS/测试、`ARCHITECTURE.md`、技能文件。

数据库 Migration：无；如果确需变更，按附件要求停止。

新增或修改测试：递归筛选、候选/快速搜索权限、列菜单/打印、出库导出排序与模块管理员授权及旧 E2E 断言调整。最终 API 59套/477项、Web 23套/140项全量通过，Web 列菜单专项13项通过；API/Web typecheck、lint、build 通过；更新的 Playwright 两套/9个用例已完成收集，因缺有效账号未执行。Web lint 仅有 ModulePortal 既有 warning，Vite 大包提示。备份：`data/backups/{four_department_tracker,kdos,uploads}_20260922_185027.*`，SHA-256 已核验。

当前已知问题：最终 API/Web 部署后容器均 healthy，`/health`、`/api/v1/health`、`/api/docs`、`/api/openapi.json` 均 200，未登录 rows/candidates 返回 401；仍无法用真实账号核对设备/主计划筛选及跨账号个人视图。服务器管理员初始密码已失效，已请求用户通过安全渠道提供测试账号；不重置密码或绕过登录。候选高基数下的成员/部门标签采取保守策略（无正式标签时不展示、提示继续搜索）。

下一步：1. 获得测试账号后运行设备/主计划/权限账号线上验收；2. 如发现问题修复、复测和重部署；3. 验收通过后将状态改为已完成并记录最终报告。

恢复执行：先读 AGENTS.md、技能、本节，再运行 `git status` / `git diff --stat`，继续下一步；下方为已完成的前一设备任务历史记录。

---

## 任务

任务名称：KDOS 设备大屏集团与事业部七日趋势分层

任务目标：在保留已上线设备大屏、Apache ECharts、昨日两张表、Excel、数据库字段和统计口径的前提下，增加集团总览与各可见事业部独立七日趋势图；统一日期、Y 轴、权限与顶部筛选范围。

当前状态：已完成

最后更新时间：2026-09-22

---

## 当前阶段

当前阶段：集团与事业部七日趋势、测试、部署与线上核验已完成

当前子任务：无。

---

## 已完成

- [x] 读取本轮需求、项目规范、`kdos-form-platform` 技能、当前 Dashboard SQL、Equipment 页面、shared charts 与专项测试；保留既有昨日两表、Excel、数据库字段、权限和多租户边界。
- [x] 在同一 Dashboard 查询内新增 `operations_divisions`、`operations_division_daily`、`operations_division_trends`，按日期×当前可见事业部补齐七日序列。
- [x] `sevenDayTrend` 改为 `{ total, divisions }`；总览和每个事业部均返回 7 个相同日期，空填报日保留，百分比 NULL 语义保留。
- [x] 抽取前端 `EquipmentTrendChart`，总览使用 330px、事业部使用 250px，两条线和 Tooltip 语义统一，复用 `KdosChart`，未新增图表库或第二套 ECharts 初始化。
- [x] 实现全可见图统一 Y 轴：`max(100, ceil(maxRate / 20) * 20)`；105/110 均统一为 120，Y 轴从 0 开始并显示百分号，X 轴 7 天全部显示。
- [x] 页面改为 1 个总览大图 + 权限范围内事业部双列小图，事业部按一至四部业务顺序、其他事业部稳定置后；顶部事业部/部门筛选继续作用于所有趋势。
- [x] API 11 项、Web Equipment 8 项、KdosChart 2 项及 API/Web typecheck 已通过。
- [x] 新增上海时区日期滚动测试：2026-09-22 返回 09-15～09-21，日期前移后按连续 7 个完整自然日滚动。
- [x] 完成 Node 24 production build、部署前三份备份、API/Web 容器重建和健康检查；本轮无数据库 Migration。
- [x] 线上受权 Dashboard 核验通过：总览和全部可见事业部均为 7 行，日期轴完全一致；2026-09-21 总览实际运行 103557 分钟，事业部合计 103557 分钟，计划为空时稼动率保持 NULL。
- [x] 线上筛选核验通过：选择事业一部后仅返回事业一部总览和事业部趋势；当前用户可见四个标准事业部及研发中心，按业务顺序返回。
- [x] 读取本轮拆表需求、当前设备大屏实现、既有进度和 `kdos-form-platform` 规范；保留既有 ECharts、趋势、Excel、权限与多租户逻辑。
- [x] 将 `operationsMonitoring` 从混合 `yesterdayRows` 调整为 `yesterdayDivisionRows` 与 `yesterdayDepartmentRows`；两者复用同一个 `monitored` / `operations_reports` CTE 范围。
- [x] 部门聚合以事业部稳定 ID + 部门稳定 ID（NULL 时沿用“未指定部门”）分组，事业部聚合再以稳定事业部 ID 汇总；同名部门不会跨事业部合并。
- [x] 保持实际运行时长为未过滤的 `SUM(runtime_minutes)`，仅稼动率分子使用有效正计划记录；事业部、部门、KPI 和趋势的昨天日期继续由服务端上海时区固定计算。
- [x] 将页面改为“昨日事业部填报与稼动情况”在前、“昨日部门填报与稼动情况”在后；两张表均保持紧凑字段宽度和现有填报率/时长/空值展示。
- [x] 增加事业部 100/90/10/90.0%、部门同名跨事业部、420+480=900、计划为空仍显示实际 480 且稼动率 `—` 的 API/Web 回归断言。
- [x] 已通过 API query service 11 项、Web equipment 页面 8 项、API/Web typecheck、API lint、Web lint（仅既有 ModulePortal warning）。
- [x] 已完成部署前 legacy/KDOS/uploads 三份备份及 SHA-256 校验；本轮无数据库 Migration。
- [x] 已以 Node 24 重建 API/Web production images，重建并上线容器；API、Web、PostgreSQL 均 healthy。
- [x] 已通过 `/health`、`/api/v1/health`、Swagger、OpenAPI 和受权线上 Dashboard API 核验；线上 Web bundle 已包含两张新表标题。
- [x] 线上 2026-09-21 核验：集团为应填 409、已填 172、填报率 42.1%、实际运行 103557 分钟、计划 0、稼动率空；事业部表与部门表实际运行时长汇总均为 103557 分钟。
- [x] 线上筛选核验：选择事业一部后两表均只保留事业一部；选择下料中心后事业部表和部门表均重算为应填 48、实际 34800 分钟。
- [x] 读取本轮完整需求、项目 AGENTS.md、`kdos-form-platform` 技能及既有设备管理代码、迁移和测试。
- [x] 确认当前基线 HEAD 为 `84d6aa5`，开始时工作区干净；未回退或覆盖既有设备改动。
- [x] 确认现有台账 `equipment_assets.planned_startup_minutes` 保留，状态表当前没有每日计划字段。
- [x] 确认现有权限范围统一由 `equipmentScope` / `equipmentCreateScope` 派生，后续改造沿用该边界。
- [x] 完成 `planned_runtime_minutes` 实体字段、兼容 migration、正数校验和状态审计；历史 NULL 不被伪造填充。
- [x] 完成状态列表、导入预览/确认、导出/模板、筛选字段和旧模板升级提示。
- [x] 完成集团/事业部/使用部门加权稼动率与设备级 `equipmentRows`，均沿用现有日期、事业部、部门和权限 SQL 边界。
- [x] 完成状态填报前端默认值、必填编辑器、列表字段和驾驶舱展示。
- [x] 验证：API/Web typecheck、后端设备测试 5 套件/45 项、前端设备页面 7 项通过。
- [x] API/Web lint 通过；Web 仅保留既有 `ModulePortal.tsx` Fast Refresh warning。
- [x] API/Web production build 通过；Node 22 相对项目声明 Node >=24 的 warning 仍存在。
- [x] 已完成生产数据库、KDOS 数据库和上传目录备份，并记录 SHA-256 校验值。
- [x] 已执行并核验 `EquipmentStatusPlannedRuntimeMinutes1722920066000` migration。
- [x] 已重建并部署 API/Web，容器健康检查通过；线上设备状态列表与驾驶舱查询成功返回新字段。
- [x] 已完成本轮代码定位，确认数据库字段和 API 底层字段保持不变。
- [x] 已将设备状态表单、列表、导出、模板、填写说明、导入错误提示和驾驶舱相关名称统一为“实际运行时长”语义。
- [x] Excel 模板列顺序固定为：事业部、使用部门、设备编号、设备名称、填报日期、计划运行时间、实际运行时长、故障时长、故障原因。
- [x] 导入同时兼容“实际运行时长”和旧“运行时长”表头；没有“计划运行时间”仍返回模板升级提示。
- [x] 已加入稼动率业务描述：实际运行时长 ÷ 计划运行时间 × 100%。
- [x] 已确认底层 `runtimeMinutes`、`runtime_minutes` 和数据库结构未修改。
- [x] 新增大屏“设备运行与填报监控”区域：昨日填报率、昨日稼动率、层级填报明细和计划/实际时长。
- [x] 后端在同一个 dashboard API 响应中增加 `operationsMonitoring`，复用 `scoped_assets → eligible → monitored` 及现有权限/组织筛选。
- [x] 昨日固定使用上海时区前一天；趋势固定为最近 7 个完整自然日，不受当前大屏期间选择器影响且不包含今天。
- [x] 填报率使用去重有效填报设备数/监控应填设备数；稼动率使用有效正计划记录的 SUM(实际)/SUM(计划)，允许超过 100%，无有效计划时返回空值。
- [x] 使用无新增依赖的响应式 SVG 双折线图，悬浮提示展示原始填报、计划和实际时长数据。
- [x] 新增后端固定业务日期测试和前端昨日 KPI、层级表格、单图双线及超过 100% 稼动率测试。
- [x] 已完成真实 PostgreSQL 查询核验、部署前备份、API/Web 重建部署、健康检查和线上 dashboard 查询核验。
- [x] 通过 pnpm 正式安装 `echarts`，新增 KDOS `shared/charts` 公共图表层；图表初始化、option 更新、resize、卸载 dispose、loading、empty 和 Ant Design token 基础主题统一封装。
- [x] 更新 `ARCHITECTURE.md`：Apache ECharts 定义为 KDOS 标准业务图表底层，业务模块只能通过 shared charts 使用。
- [x] 设备最近 7 天趋势改为 `KdosChart` 单图双线，tooltip 展示日期、填报率、已填/应填设备、稼动率、实际/计划运行时长；Y 轴可超过 100%，NULL 保持空值。
- [x] 昨日表格改为紧凑的“所属事业部 + 使用部门/车间”明细，去除层级/集团/事业部汇总行；大屏专用 formatter 将明确映射的“凯南事业一至四部”显示为“事业一至四部”。
- [x] 根因定位：数据库和状态查询均正确保留 `runtime_minutes` / `runtimeMinutes`；dashboard 的 `operations_daily` 与 `operations_yesterday_org` 错将实际时长纳入 `planned_runtime_minutes>0` 过滤。已分离实际运行总时长与稼动率有效计划分子。
- [x] 真实数据核验：2026-09-21 数据库实际运行时长合计 103557 分钟，修复后 dashboard API 同为 103557 分钟；172 条已填/409 台应填，填报率 42.1%；计划时长均为 NULL，故稼动率正确为 `—`。
- [x] 已重新构建并部署 Node 24 API/Web 镜像，线上 API/Web health 通过，真实线上 status/dashboard 查询通过。

---

## 正在进行

- 无。

---

## 待完成

- [x] 前端状态表单、列表和驾驶舱展示文本。
- [x] Excel 模板/导出/填写说明/导入错误提示与测试断言。
- [x] 运行测试、构建，备份并部署到当前运行环境，完成线上核验。
- [x] 设备大屏昨日监控与近 7 日趋势实现、测试、备份、部署和线上核验。
- [x] 昨日事业部/部门拆表、测试、备份、部署和线上核验（前一阶段）。
- [x] 集团与事业部七日趋势、备份、部署和线上核验。

---

## 修改文件

- 本轮修改：`apps/api/src/modules/equipment/equipment-import.service.ts`
- 本轮修改：`apps/api/src/modules/equipment/equipment.application.service.ts`
- 本轮修改：`apps/api/src/modules/equipment/equipment-export.service.ts`
- 本轮修改：`apps/api/src/modules/equipment/equipment-export.service.spec.ts`
- 本轮修改：`apps/api/src/modules/equipment/equipment.spec.ts`
- 本轮修改：`apps/web/src/modules/equipment/EquipmentPages.tsx`
- 本轮修改：`packages/contracts/src/index.ts`
- 本轮大屏增强：`apps/api/src/modules/equipment/equipment.query.service.ts`
- 本轮大屏增强测试：`apps/api/src/modules/equipment/equipment.query.service.spec.ts`
- 本轮大屏增强前端：`apps/web/src/modules/equipment/EquipmentPages.tsx`
- 本轮大屏增强样式/测试：`apps/web/src/styles.css`、`apps/web/src/modules/equipment/EquipmentPages.spec.tsx`
- 本轮公共图表层：`apps/web/src/shared/charts/KdosChart.tsx`、`chart-theme.ts`、`chart-utils.ts`、`index.ts`
- 本轮公共图表测试：`apps/web/src/shared/charts/KdosChart.spec.tsx`
- 本轮依赖/架构：`apps/web/package.json`、`pnpm-lock.yaml`、`ARCHITECTURE.md`
- 本次拆表：`apps/api/src/modules/equipment/equipment.query.service.ts`、`apps/api/src/modules/equipment/equipment.query.service.spec.ts`、`apps/web/src/modules/equipment/EquipmentPages.tsx`、`apps/web/src/modules/equipment/EquipmentPages.spec.tsx`
- 前一阶段设备改造文件和 migration 保持不变。

---

## 数据库 Migration

- `1722920066000-EquipmentStatusPlannedRuntimeMinutes.ts`：增加可空 `planned_runtime_minutes integer`，非 NULL 时 CHECK `> 0`。

---

## 新增或修改测试

- 本轮新增/调整：后端断言明确的事业部/部门响应数组、稳定 ID 聚合及实际运行时长过滤边界；前端断言两张表的列边界、事业部显示转换、同名部门归属、NULL 稼动率和两种时长展示。
- 已增加/修改：模板精确列顺序、实际运行时长展示、旧/新表头兼容、稼动率公式说明和相关中文断言。
- 已增加/修改：昨日业务时区边界、监控范围 SQL、去重填报率、正计划 SUM 稼动率、7 日趋势和大屏交互展示断言。
- 已增加/修改：实际运行时长不受空计划过滤、420/480=87.5%、900/1080=83.3% 的展示回归、NULL 趋势值、稼动率超 100% 轴范围及 tooltip；KdosChart 生命周期、resize 和空态测试。

---

## 已运行测试

测试名称：设备专项测试、类型检查、lint、构建、线上核验

结果：API query service 12 项、Web equipment page 8 项、shared KdosChart 2 项、API/Web typecheck 通过；API lint 通过，Web lint 无 error，仅既有 `ModulePortal.tsx` Fast Refresh warning；Node 24 Docker production build 通过（仅既有主 bundle 体积提示）；备份、部署、健康检查、线上结构、日期轴、权限筛选和 103557 分钟汇总核验均通过。

---

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- Node 22 本地运行环境低于项目声明的 Node >=24，仅产生 warning；Docker 部署使用 Node 24 镜像。
- Web lint 的既有 `ModulePortal.tsx` Fast Refresh warning 和 Web build 的既有大包 warning 未影响交付。
- ECharts 引入后 Web 主 bundle 仍触发既有大包提示（约 3.58 MB 未压缩 / 1.12 MB gzip）；本轮未额外引入第二套图表依赖。
- 当前模型没有历史“监控生效日期”字段；本轮按需求复用当前 active/monitored 范围计算历史窗口，没有虚构历史范围。

---

## 等待用户确认

- 无。

---

## 下一步

1. 后续如继续设备模块，先读取本进度文件、项目规范和当前工作区，再从新需求开始。

本次趋势备份：

- `data/backups/four_department_tracker_20260922_140411.backup`
  SHA-256：`d5d67e4bbb698a10215c2a68e565659399cbf118cc5ff7c5dec11910ba86b011`
- `data/backups/kdos_20260922_140411.backup`
  SHA-256：`27a9f26512dca34f0990758f951ce4b91ca407e7abfc242f832a4b57a8eca421`
- `data/backups/uploads_20260922_140411.tar.gz`
  SHA-256：`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`

本次趋势部署镜像：

- API：`sha256:1099c704e4165e549500ced9a343a1fcb8e0a1286bbfc027ffcd8e3b0d0ffe17`
- Web：`sha256:cce9ccffe11257ec504095fa1245a86a6e33ff5d5461d94a9e9e10df759433de`

本次拆表备份：

- `data/backups/four_department_tracker_20260922_134925.backup`
  SHA-256：`43fe119746077b3db002470abb0b7b3f7d63b86eca8815637097c1664103eaa3`
- `data/backups/kdos_20260922_134925.backup`
  SHA-256：`ff4905487d18d01e7a40d13916e4dbbb1f5d2316568a92eb1668a5adfd03058a`
- `data/backups/uploads_20260922_134925.tar.gz`
  SHA-256：`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`

本次拆表部署镜像：

- API：`sha256:a01f52d93f7a934a5c722b10ac4db00dd1343514d5847ebe826cc5552f51bc26`
- Web：`sha256:4acffd4f436ba3b218a86cb909b84ccd283e4fd508c6abfd7573391542841823`

本轮 ECharts/大屏修复备份：

- `data/backups/four_department_tracker_20260922_125724.backup`
  SHA-256：`88106f8a9f100e021a9694644b7263cdc29890c92a0e3e6209e05f125f74f523`
- `data/backups/kdos_20260922_125724.backup`
  SHA-256：`736239be0f4ad8962f479f7913207cc86c9508141dd12c5fd01a2456a164a117`
- `data/backups/uploads_20260922_125724.tar.gz`
  SHA-256：`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`

本轮 ECharts/大屏修复部署镜像：

- API：`sha256:d58cdf7aea1147768d59580104193e6708a96e2ac7c240f69e21af33c957c812`
- Web：`sha256:25ca152e2abdf9daee7ca665936095197856e69fc16aa7e2092a61f1025cc5bc`

本轮新增备份：

- `data/backups/four_department_tracker_20260922_113850.backup`
  SHA-256：`41e478093568b637b168a01290b296395b81bb497b1e238ffdb06b9c2cdaaa64`
- `data/backups/kdos_20260922_113850.backup`
  SHA-256：`a3298dde1e5f18c4f3372b1cd2a48ea98fa612f7e9d993fe45b623237e237b13`
- `data/backups/uploads_20260922_113850.tar.gz`
  SHA-256：`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`

本轮部署镜像：

- API：`sha256:378b1c829cfb4a8a414433b210af3332c0d64c1bca908d34a1de37cf4bb8f7c1`
- Web：`sha256:b802f53e32df0d411d1e863364db6cf60904a07236c5d82b4a5215f540d2d3dc`

本轮大屏增强备份：

- `data/backups/four_department_tracker_20260922_120207.backup`
  SHA-256：`46fb99c0dfd7515dfefd83fec7ba2671ec993d1caf699a656277d6b60c7a8dde`
- `data/backups/kdos_20260922_120207.backup`
  SHA-256：`51aa5745a9427cb59279647590d013274fdfbd4c3e48e133ae812a8c87c6ba59`
- `data/backups/uploads_20260922_120207.tar.gz`
  SHA-256：`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`

本轮大屏增强部署镜像：

- API：`sha256:35aa7b5e6bee34869b3898b7d496774b593a36e6229808aa2a94bc0f91132b65`
- Web：`sha256:4fb6386edb0a7d8dfcb47fa6f31344a15e2ad7749099f2aa5b69c7642bc82c68`

本次备份：

- `data/backups/four_department_tracker_20260922_091118.backup`
  SHA-256：`9ebb21a3becd28d1cd0a53f8988adafd44d6b9bc991941806e1d91577988fe2c`
- `data/backups/kdos_20260922_091118.backup`
  SHA-256：`8f7e633e8893b74390fd0b2f16bcbcd2422966065b4db8789b854b12f2ccd334`
- `data/backups/uploads_20260922_091118.tar.gz`
  SHA-256：`089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`

部署镜像：

- API：`sha256:3ea41b0bf8dc7ae203b985306c85e2ebe9f06c5b5ea9043c76479ca95f309b3b`
- Web：`sha256:b7b94e9485308a981588c6cf0f3616f87f9cc01385ce16af1f3290adcbbf144d`

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md、`.agents/skills/kdos-form-platform/SKILL.md` 和本进度文件。
2. 执行 `git status`、`git diff --stat`，保留用户修改。
3. 从“下一步”的第一项未完成任务继续，不重复已完成工作。
# 当前任务：KDOS-RD-FULL-LIVE-CHECK-003

任务目标：将研发中心新物料快速检索的数据源改为当前租户 `rd_items` 全库；Top 5/Top 10 只控制最终返回数量；保持既有 normalize、category、attribute conflict、specification、score、threshold、reason、warnings 规则不变。

当前状态：全库查询、性能验证、完整测试、API/Web 部署、健康检查和浏览器验收均已完成。

最后更新时间：2026-09-29

## 实现对照

| 项目 | 当前实现 |
| --- | --- |
| 全库定义 | `rd_items WHERE tenant_id=$1`，保留既有租户边界；当前数据库 `KAINAN` 为 574,544 条 |
| 数据源截断 | 已删除 5,000/20,000 limit、修改时间排序和对应分支 |
| Top N | API `limit` 仅用于 `rankRecent(..., limit)` 最终返回数量，前端保留 Top 5 / Top 10 |
| 算法 | 未改变 `normalize`、`features`、`compare`、`rankRecent` 的业务规则及 score/reason/warnings 结果；仅做等价实现优化 |
| debounce | 保留 350ms；前端 AbortController 取消旧请求，只提交最后一次输入请求 |
| 性能优化 | 缓存租户全库标准化特征，使用物料数量与最大 `updated_at` 校验新鲜度；LCS 改为等价的单行 DP，避免每轮候选重复分配数组 |

## 修改文件

- `apps/api/src/modules/rd/rd.query.service.ts`
- `apps/api/src/modules/rd/rd-duplicate-algorithm.ts`
- `apps/api/src/modules/rd/rd.controller.ts`
- `apps/api/src/modules/rd/rd.query.service.spec.ts`
- `apps/web/src/modules/rd/RdPages.tsx`
- `apps/web/e2e/rd-ui.spec.ts`
- `outputs/CODEX_PROGRESS.md`

## 数据库 / 同步边界

- 无 migration、无数据库业务数据写入。
- 未修改 E10 同步、watermark、历史扫描结果或历史扫描算法。

## 已完成

- [x] 核对原 5,000/20,000 限制位于 `apps/api/src/modules/rd/rd.query.service.ts:40`，由 `LastModifiedDate` 映射字段排序并 `LIMIT` 截断。
- [x] 将实时查重 API 改为读取当前租户物料全库。
- [x] 将实时查重前端改为全库文案，删除“查找最近 2 万条”和范围分支。
- [x] 增加 API 单元测试：验证全库 SQL、无旧限制、Top N 只控制返回数量及全库后部候选仍可排序返回。
- [x] API 研发中心定向测试 10/10 通过。
- [x] API typecheck、Web typecheck 通过。
- [x] 真实全库查询：每次返回 `rowsScanned=574544`；冷启动约 13.34 秒，缓存命中 Top 5 约 2.16–2.34 秒、Top 10 约 2.21–2.26 秒；缓存命中样本 P50 约 2.23 秒、P95 约 2.34 秒。
- [x] 旧排序位置第 300,001 条真实物料 `RXDZ0119-01-09` 全库检索命中，score=100。
- [x] API 全量测试：75 个测试套件通过、1 个跳过，577 个测试通过。
- [x] Web 全量测试：27 个测试文件、164 个测试通过；一次并发超时重跑后通过。
- [x] API lint、Web lint、API typecheck、Web typecheck 通过；Web lint 保留项目原有 Fast Refresh warning。

## 正在进行

- [x] 真实 574,544 条物料全库 Top 5 / Top 10 查询耗时与 P50/P95 验证。
- [x] Web build、最终部署、健康检查和浏览器验收。

## 下一步

1. 后续如继续研发中心工作，先读取本进度文件和当前 Git 状态。

## 最终部署记录

- 提交：本轮最终提交，部署版本与仓库 HEAD 一致。
- API/Web：`./scripts/deploy.sh all` 成功，API Build、Web Build 与仓库 HEAD 一致。
- 健康检查：Web、API、Swagger、OpenAPI、PostgreSQL 通过。
- 浏览器验收：研发中心 UI 2 个场景通过。
- 未执行 migration、FULL 同步、watermark 变更或数据库业务数据写入。

# 当前任务：KDOS-RD-FULL-SCAN-UI-004

任务目标：删除研发中心一物多码检测页面的新物料实时查重入口，仅保留全量物料查重扫描和历史结果展示；用户可见状态、分类和统计全部使用中文，不修改实时查重 API、历史查重算法、同步链路或数据库。

当前状态：已完成前端代码、测试、构建、Web-only 部署、健康检查和部署后浏览器核验。

## 当前阶段

当前阶段：前端功能收敛

当前子任务：删除实时检索 UI/状态/请求逻辑，更新全量扫描页面和浏览器断言。

## 已完成

- [x] 删除新物料品名/规格输入、350ms debounce、Top 5/Top 10、实时请求取消和实时结果渲染。
- [x] 保留后端 `/rd/material-duplicates/check` API 未改，避免影响其他调用方；当前页面不再请求该接口。
- [x] 将页面主结构调整为“全量查重”和“查重结果”，保留全量扫描、筛选、分页、A/B 对照、字符差异、判断依据和提示信息。
- [x] 将扫描状态、分类、候选统计改为中文用户文案，并清理实时检索相关死样式。
- [x] 更新 R&D 浏览器测试，覆盖实时入口不存在、全量扫描中文状态和统计展示。

## 正在进行

- [x] Web tests、typecheck、lint、build。
- [x] Web-only 部署、健康检查和部署后浏览器核验。

## 待完成

- [x] 记录最终测试、部署和线上核验结果。

## 修改文件

- `apps/web/src/modules/rd/RdPages.tsx`
- `apps/web/src/modules/rd/rd-display.ts`
- `apps/web/src/styles.css`
- `apps/web/e2e/rd-ui.spec.ts`
- `outputs/CODEX_PROGRESS.md`

## 数据库 Migration

- 无。

## API / 算法 / 同步

- API、历史查重算法、score、candidate bucket、E10 同步、watermark、数据库业务数据和已有扫描结果均未修改。

## 已运行测试

- `git diff --check`：通过。
- Web 全量：27 个测试文件、164 个测试通过；首次运行有 1 个非研发中心 AdminWorkspace 时序超时，重跑后通过。
- Web typecheck：通过。
- Web lint：通过，保留项目原有 `ModulePortal.tsx` Fast Refresh warning。
- Web build：通过，保留项目原有大 chunk warning。
- 部署后研发中心浏览器：2 个场景通过，确认实时检索入口不存在、全量扫描中文状态/统计、A/B 对照可见。
- 健康检查：Web、API、Swagger、OpenAPI、PostgreSQL 通过。
- Web-only deploy：成功；部署时 Web Build 与仓库 HEAD 一致。
- `./scripts/deploy.sh check` 的 API 版本保持 `e8675fa`，与本次仅 Web 部署的新 HEAD 不一致是预期结果，API 未重启。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 无。

## 下一步

1. 后续如继续研发中心前端工作，先读取本进度文件和当前 Git 状态。

## 最终状态

已完成。未执行 migration、FULL/INCREMENTAL 同步、watermark 变更、数据库业务数据写入或历史扫描重建。

# 当前任务：KDOS-RD-HISTORY-SCAN-PERF-005

任务目标：在不缩小当前租户 574,544 条物料扫描范围、不改变历史查重规则和结果语义的前提下，将历史扫描重构为一次全量基线、日常增量维护和可手工全量重建，并完成阶段 profiling、等价性测试、部署与运行核验。

当前状态：已完成现状 profiling、特征缓存/增量扫描/批量快照实现、真实 migration、全库/增量性能验收、完整测试、API/Web 部署、健康检查和浏览器核验。

## 当前阶段

当前阶段：真实数据验收与交付

当前子任务：完成全量/增量扫描关系等价、前后端回归验证和最终部署。

## 已完成

- [x] 确认当前租户 `KAINAN` 的 `rd_items` 数量为 574,544。
- [x] 确认已有完整结果未被删除：98,926 个分组、284,021 个成员，规则版本 `history-1`。
- [x] 真实历史扫描实测完成一次：扫描记录显示 574,544 行、588,583 个比较候选对、56 个跳过分组、18,158,444 个跳过候选对。
- [x] 离线阶段 profiling：PostgreSQL 读取约 1.13 秒；normalize/feature 准备约 8.96 秒；exact/missing/code 分组约 1.85 秒；候选桶建立约 0.50 秒；候选比较约 1.33 秒；`scanRows` 端到端约 12.41 秒。
- [x] 发现当前持久化逻辑对每个分组、每个成员执行独立查询，存在约 98,926 次分组写入、约 284,021 次成员定位查询和约 284,021 次成员写入的 round-trip 风险。
- [x] 增加 `rd_item_features` 特征缓存，按物料版本和 `history-1` 复用特征；只为新增/变化/缓存缺失物料重新准备特征。
- [x] 增加全量基线/增量扫描元数据：扫描模式、base scan、source watermark、source version、item count 和真实进度字段。
- [x] 增量扫描只重新计算 changedItems 与完整物料库的关系，并通过新快照复制未涉及 changedItems 的旧关系；名称/规格变化会清除旧关系后重建。
- [x] 全量和增量结果写入改为 JSON recordset 分块批量插入，避免逐组/逐成员独立 SQL round-trip。
- [x] 增加“更新查重”和“全量重建”入口、无变化提示、规则版本变更提示、扫描阶段和进度展示。
- [x] 固定数据集覆盖新增、改名形成/解除关系、改规格解除关系、物料失效清除关系等全量/增量关系集合等价测试。
- [x] 执行 migration 并验证 `rd_item_features`、扫描元数据字段和 RLS 策略；未改 E10 或物料业务数据。
- [x] 真实全量重建覆盖 574,544 条物料；首次建立特征缓存耗时 91.19 秒，缓存复用全量重建耗时 16.86 秒。
- [x] 真实 20 条增量耗时 15.20 秒、100 条增量耗时 14.64 秒；两者均保留全库覆盖和完整关系规模。
- [x] 无变化请求耗时 0.21 秒，直接返回无需重新扫描。
- [x] 全量/增量结果均为 98,926 组、284,021 成员，统计均为 588,583 compared、56 skipped blocks、18,158,444 skipped pairs，分类计数完全一致。
- [x] 修复内部全量重建入口未传递 mode、批量 JSON recordset 驼峰/下划线字段映射问题，并重新部署 API 验证。

## 正在进行

- [x] 增加规则版本/数据版本/特征缓存/当前结果维护的数据结构。
- [x] 实现 changedItems 增量扫描和全量重建统一后台任务。
- [x] 添加固定小数据集全量/增量关系集合等价测试。

## 待完成

- [x] 真实测试无变化、20 条变化、100 条变化和 574,544 条全量重建耗时。
- [x] API/Web tests、typecheck、lint、build、API/Web 部署、健康检查和浏览器核验。

## 修改文件

- `apps/api/src/migrations/1722920080000-RdDuplicateScanMaintenance.ts`
- `apps/api/src/modules/rd/rd-duplicate-algorithm.ts`
- `apps/api/src/modules/rd/rd-duplicate-algorithm.spec.ts`
- `apps/api/src/modules/rd/rd-history-scan.service.ts`
- `apps/api/src/modules/rd/rd.application.service.ts`
- `apps/api/src/modules/rd/rd.controller.ts`
- `apps/api/src/modules/rd/rd.module.ts`
- `apps/api/src/modules/rd/rd.query.service.ts`
- `apps/web/src/modules/rd/RdPages.tsx`
- `apps/web/src/styles.css`
- `apps/web/e2e/rd-ui.spec.ts`
- `outputs/CODEX_PROGRESS.md`

## 数据库 Migration

- 已新增研发中心查重特征缓存表、扫描元数据和进度字段；不修改 E10 数据、既有物料字段、同步 watermark 语义或历史结果。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 首次全量重建需要建立 574,544 条特征缓存，实测约 91 秒；后续复用缓存约 17 秒。
- 本轮未做多次重复样本的正式 P50/P95 统计；已记录 20/100 条增量和缓存复用全量的实际单次耗时。

## 下一步

1. [x] 运行 API/Web 完整测试、typecheck、lint 和 build。
2. [x] 部署最终 Web，执行健康检查和研发中心浏览器核验。
3. [x] 更新最终交付记录并确认工作区干净。

## 最终交付记录

- 提交：最终交付提交（以仓库 HEAD 为准）。
- Migration：已执行 `1722920080000-RdDuplicateScanMaintenance`；未执行 FULL/INCREMENTAL E10 同步。
- API/Web：最终 API 与 Web 均部署，版本一致性检查通过。
- 健康检查：Web、API、Swagger、OpenAPI、PostgreSQL 通过。
- 浏览器：研发中心一物多码检测、物料数据页 2/2 通过。

# 当前任务：KDOS-RD-QUERY-PERMISSION-HIGHLIGHT-LAYOUT-006

任务目标：限制一物多码全量计算权限，普通用户只查询已保存结果；修复查询关键词与 A/B 差异高亮语义；将 A/B 物料基础字段调整为桌面端单行对照布局，并完成测试、部署和页面核验。

当前状态：已完成代码修改、API/Web 回归测试、浏览器测试、构建、API/Web 部署和健康检查。

## 当前阶段

当前阶段：已完成

当前子任务：记录最终交付结果。

## 已完成

- [x] 普通用户页面仅保留查询/重置；管理员按现有 `rd-material-duplicates` 更新权限显示全量计算入口。
- [x] 后端 FULL 计算统一使用 `canRd(..., "rd-material-duplicates", "update")`，普通只读调用直接返回 403；未改算法、同步、watermark、数据库业务数据或 migration。
- [x] 查询改为只读取已保存结果，草稿筛选不会自动请求，点击查询后才应用字段筛选。
- [x] 增加字段级查询关键词黄色高亮，保留原 A/B 差异红色下划线；同一字符可同时具有两种高亮。
- [x] A/B 品号、品名、规格改为每个物料一行的横向布局，品名占主要空间，窄屏下仅按布局规则换行。
- [x] 增加/调整权限、查询高亮、差异高亮、重叠高亮、A/B 单行与窄屏布局测试。
- [x] API 完整测试：76 个套件通过、1 个跳过；584 个测试通过、1 个跳过。
- [x] Web 完整测试：27 个文件通过、167 个测试通过；研发中心 Playwright 4/4 通过。
- [x] API/Web typecheck、lint、build 通过；lint 仅保留既有 Fast Refresh 警告。

## 正在进行

- [x] 提交并部署本轮 API/Web 变更。
- [x] 部署后执行健康检查、版本一致性和研发中心页面核验。

## 待完成

- [x] 更新本任务最终交付记录并确认工作区干净。

## 修改文件

- `apps/api/src/modules/rd/rd-history-scan.service.ts`
- `apps/api/src/modules/rd/rd-history-scan.service.spec.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/modules/rd/RdPages.tsx`
- `apps/web/src/modules/rd/rd-display.ts`
- `apps/web/src/modules/rd/rd-display.spec.ts`
- `apps/web/src/styles.css`
- `apps/web/e2e/rd-ui.spec.ts`
- `outputs/CODEX_PROGRESS.md`

## 数据库 Migration

- 无。本轮未修改 PostgreSQL 表结构，也未重新执行同步或历史扫描。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 无新增已知问题；Web lint 的既有 Fast Refresh 提示不影响通过结果。

## 下一步

1. [x] 提交本轮修改。
2. [x] 部署 API/Web 并执行健康检查。
3. [x] 完成最终交付记录。

## 最终交付记录

- 提交：最终交付提交（以仓库 HEAD 为准）。
- Migration：无；未重新执行 E10 FULL/INCREMENTAL 同步，未修改历史扫描结果。
- API/Web：API 与 Web 均部署，版本一致性检查通过。
- 健康检查：Web、API、Swagger、OpenAPI、PostgreSQL 通过。
- 浏览器：研发中心相关 Playwright 用例 4/4 通过。

# 当前任务：KDOS-RD-FILTER-LAYOUT-007

任务目标：将研发中心一物多码检测查询条件调整为桌面端单行紧凑布局，保留现有查询语义、API 参数、关键词高亮和权限逻辑，并完成 Web 测试、构建与 Web-only 部署。

当前状态：已完成前端布局调整、专项浏览器测试、完整 Web tests、typecheck、lint、build、Web-only 部署和健康检查。

## 当前阶段

当前阶段：已完成

当前子任务：记录最终交付结果。

## 已完成

- [x] 读取当前项目进度、工作区状态和 KDOS 表单/筛选规范。
- [x] 确认当前查询仍由 `draftFilters` / `appliedFilters` 驱动，未发现需要修改 API 参数或后端逻辑。
- [x] 将品号、品名、规格、最低匹配分、分类、每页条数和查询/重置按钮改为紧凑 Grid 筛选条，桌面端保持单行。
- [x] 窄屏使用响应式网格换行；查询、关键词高亮和管理员全量计算逻辑未改变。
- [x] 专项浏览器测试 4/4 通过。
- [x] Web 完整测试：27 个测试文件、167 个测试通过。
- [x] Web typecheck、lint、build 通过；lint 仅保留既有 Fast Refresh 警告。

## 正在进行

- [x] 修改筛选区 JSX/CSS 布局。
- [x] 补充桌面单行、紧凑间距和窄屏响应式测试。

## 待完成

- [x] 运行 Web tests、typecheck、lint、build。
- [x] Web-only 部署、健康检查和页面核验。
- [ ] 更新最终交付记录并确认工作区干净。

## 修改文件

- `apps/web/src/modules/rd/RdPages.tsx`
- `apps/web/src/styles.css`
- `apps/web/e2e/rd-ui.spec.ts`
- `outputs/CODEX_PROGRESS.md`

## 数据库 Migration

- 无。本轮只调整前端展示布局。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 无。

## 下一步

1. [x] 修改查询区布局并补充测试。
2. [x] 运行 Web 验证。
3. [x] Web-only 部署并完成交付记录。

## 最终交付记录

- 提交：最终交付提交（以仓库 HEAD 为准）。
- Migration：无；未修改 API、数据库、同步或历史查重结果。
- Web：Web-only 部署成功，Web build 与仓库 HEAD 一致。
- API：保持已部署版本不变；本轮无 API 修改。
- 健康检查：Web、API、Swagger、OpenAPI、PostgreSQL 通过。
- 浏览器：研发中心筛选布局、权限、查询高亮与 A/B 布局专项 Playwright 4/4 通过。

# 当前任务：KDOS-RD-FILTER-LAYOUT-008

任务目标：将研发中心一物多码检测查询区调整为两行布局：第一行放品号、品名、规格、最低匹配分、每页条数及查询/重置，第二行单独放四项分类筛选；保持查询、分类状态、关键词高亮、A/B 结果和权限逻辑不变。

当前状态：已完成布局修改、专项浏览器测试、完整 Web tests、typecheck、lint、build、Web-only 部署和健康检查。

## 当前阶段

当前阶段：已完成

当前子任务：记录最终交付结果。

## 已完成

- [x] 保留现有 `Segmented` 分类组件和筛选逻辑，仅调整其布局位置。
- [x] 第一行恢复可读宽度，品号、品名、规格、最低匹配分、每页条数及查询/重置同排。
- [x] 四项分类独立放到第二行，窄屏按响应式规则自然换行。
- [x] A/B 对照卡片及差异/关键词高亮未修改。
- [x] 专项浏览器测试 4/4 通过。
- [x] Web 完整测试：27 个测试文件、167 个测试通过。
- [x] Web typecheck、lint、build 通过；lint 仅保留既有 Fast Refresh 警告。

## 正在进行

- [x] Web-only 部署、健康检查和页面核验。

## 待完成

- [x] 更新最终交付记录并确认工作区干净。

## 修改文件

- `apps/web/src/modules/rd/RdPages.tsx`
- `apps/web/src/styles.css`
- `apps/web/e2e/rd-ui.spec.ts`
- `outputs/CODEX_PROGRESS.md`

## 数据库 Migration

- 无。本轮只调整前端布局，未修改 API、数据库、同步、watermark 或查重算法。

## 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。

- 无新增问题；完整 Web 测试首次并发运行时出现的非相关 AdminWorkspace 超时已通过重跑确认通过。

## 下一步

1. [x] 修改两行查询布局并补充测试。
2. [x] 运行 Web tests、typecheck、lint、build。
3. [x] Web-only 部署并完成交付记录。

## 最终交付记录

- 提交：最终交付提交（以仓库 HEAD 为准）。
- Migration：无；未修改 API、数据库、同步、watermark 或查重算法。
- Web：Web-only 部署成功，Web build 与仓库 HEAD 一致。
- API：保持已部署版本不变；本轮无 API 修改。
- 健康检查：Web、API、Swagger、OpenAPI、PostgreSQL 通过。
- 浏览器：两行筛选布局与研发中心回归用例 4/4 通过。

# 当前任务：PMC研发进度报表（Phase 1 + Phase 2 + Phase 2.5 + Phase 3）

任务目标：在不改变主计划科加订单 `2026-09-17` 准入规则的前提下，核对 PMC中心 → 报表 → 研发进度所需的现有架构和 E10 真实数据关系；本阶段只读分析，不开发正式页面。

当前状态：Phase 1、Phase 2、Phase 2.5、Phase 3 已完成；E10 只读验证工具、纯状态算法、指定生产样本、额外真实样本和正式候选范围全量统计均已通过。Phase 3 PASS，建议进入 Phase 4 正式数据模型、同步服务与 API 设计。

最后更新时间：2026-10-06

## 当前阶段

当前阶段：Phase 3 PASS / 建议进入 Phase 4

当前子任务：Phase 3 结论归档；等待用户授权进入 Phase 4，当前仍未开发正式页面、菜单、PostgreSQL 模型或同步服务。

## Phase 1：当前架构

- PMC 模块稳定代码为 `planning`，显示名称为“PMC中心”；导航树在 `apps/web/src/App.tsx`，表/报表资源统一注册在 `packages/contracts/src/index.ts`。
- 新报表应注册独立只读资源，建议资源代码 `pmc-rd-progress`、显示名“研发进度”、`moduleCode=planning`；正式命名在 Phase 4 前最终确认。
- 标准权限、字段权限、数据范围、高级筛选、打印/导出能力均由现有 Table Permission / `KdosDataTable` / `TableFilterModule` 体系承载，不能只靠前端隐藏。
- 可复用 `rd` 模块的设计思想：`MSSQLDatabase` 只读子进程、FULL/INCREMENTAL、复合 watermark、2 分钟 overlap、批量 upsert、失败不推进游标、同步运行记录；不得耦合或改动研发中心“一物多码”业务表和算法。
- 可复用 `data-operations/order-sync` 的只读 SQL 防护、staging/change-event/idempotency 思想，但其 E10 初始化范围按 `ORDER_DATE`/未关闭订单，不满足本报表 `CreateDate OR LastModifiedDate` 的独立候选范围，不能直接当作完整候选源。
- 推荐数据流：E10 SQL Server（独立只读批量读取） → 独立研发进度同步与集中状态计算 → PostgreSQL 租户隔离投影 → PMC 只读 Query Service/API → KPI、订单汇总和品项明细页面。
- PostgreSQL 现有 `rd_items`/`rd_sync_runs` 属于研发中心物料查重；`erp_*` 属于通用订单 staging；均不应承载本报表的业务状态。后续建议新增独立 `pmc_rd_progress_items`、`pmc_rd_progress_sync_runs`（最终表名以 migration 评审为准），核心粒度为 `tenant_id + source_database + order_line_id`，并启用 RLS、必要索引和版本/审计字段。
- 事业部可候选复用现有 `mps_customer_division_mappings`（按客户编码映射主责事业部），但必须先确认报表中的“事业部”是承接事业部还是 E10 销售部门祖先；不能直接复用主计划订单准入结果。

## 可以复用的代码

- `data-operations/e10/rd_reader.py` 和 `apps/api/src/modules/rd/rd-e10-reader.ts`：共享 basic_code 凭据、只读连接和 NDJSON 子进程边界。
- `apps/api/src/modules/rd/rd.application.service.ts`、`rd-watermark.ts`：FULL/INCREMENTAL、成功 watermark、失败记录和批量事务模式。
- `data-operations/order-sync/sync.py`：SELECT-only 守卫、批量读取、重叠窗口、游标精度与幂等模式。
- `TableFilterModule`、`KdosDataTable`、表权限页、标准导出/打印能力以及现有设备大屏/销售汇总页面的 KPI、筛选、空态、错误态实现。
- `mps_customer_division_mappings`：仅在业务确认“事业部=客户主责事业部”后作为映射来源。

## 不能修改的代码/规则

- `master-plan.erp-admission.ts` 和主计划同步服务中的科加订单下单日期 `>= 2026-09-17` 规则。
- 研发中心 `rd_*` 物料同步、一物多码算法、watermark 和已有数据。
- E10 数据及 basic_code 凭据；E10 连接继续保持只读。
- 现有 `erp_*` staging 的业务范围和正式订单投影语义，不能为了研发报表扩大或改写。

## Phase 2：E10 真实字段与关系

- 用户提示中的 `CreatedDate` 在真实表中不存在；候选范围必须使用 `SALES_ORDER_DOC.CreateDate >= '2026-09-01' OR SALES_ORDER_DOC.LastModifiedDate >= '2026-09-01'`。
- 订单：`SALES_ORDER_DOC.SALES_ORDER_DOC_ID` → `SALES_ORDER_DOC_D.SALES_ORDER_DOC_ID`；行主键 `SALES_ORDER_DOC_D_ID`，物料键 `ITEM_ID`，特征键 `ITEM_FEATURE_ID`，订单数量 `BUSINESS_QTY`。
- 物料：`SALES_ORDER_DOC_D.ITEM_ID = ITEM.ITEM_BUSINESS_ID`；`ITEM_PLANT.ITEM_ID = ITEM.ITEM_BUSINESS_ID`。`ITEM_PLANT.ITEM_BUSINESS_ID` 是 ITEM_PLANT 自身主键，不是 ITEM 外键。
- 设计 BOM：`BOM.BOM_ID` → `BOM_D.BOM_ID`；`BOM.ITEM_ID` 为主件。Schema 业务键为 `BOM(ITEM_ID, Owner_Org_ROid)`；当前 BOM 全部属于唯一“凯南工厂”。
- 工艺路线：`ITEM_ROUTING.ITEM_ROUTING_ID` → `ITEM_ROUTING_D.ITEM_ROUTING_ID`；工序键为 `ITEM_ROUTING_D.OPERATION_ID = OPERATION.OPERATION_ID`。Schema 业务键为 `ITEM_ROUTING(ITEM_ID, Owner_Org_ROid, ITEM_FEATURE_ID, ROUTING_CODE)`。
- `ITEM_PLANT.STANDARD_ROUTING_ID` 明确引用 `ITEM_ROUTING`。候选物料中有 23 个标准路线引用的路线主件与当前物料不同，说明不能额外强加“标准路线的 ITEM_ID 必须相同”；该字段可能表达复用标准路线，需由 E10 业务方确认。
- E10 只有一个工厂：`PLANT_ID=262F19F9-4050-4065-C93A-1715DD9EDA8B`、代码 `1`、名称“凯南工厂”。当前 `ITEM_PLANT` 每个 ITEM 恰好一行。
- 销售订单 `Owner_Org_RTK=SALES_CENTER`，BOM/Route `Owner_Org_RTK=PLANT`，不能按 `Owner_Org_ROid` 直接连接。销售部门可由 `SALES_ORDER_DOC.Owner_Dept → ADMIN_UNIT.ADMIN_UNIT_ID` 获取并沿 `SUPER_ADMIN_UNIT_ID` 向上找组织祖先。
- `SALES_ORDER_DOC_D.ITEM_FEATURE_ID` 当前全部为零 GUID；`ITEM_ROUTING.ITEM_FEATURE_ID` 当前也全部为零 GUID；`ITEM_FEATURE_PLANT` 仅 1 行。零 GUID 必须正规化为 NULL，当前生产数据不能验证按特征码的状态推导。
- 当前候选范围快照：2,502 个订单头、17,405 个订单品项、8,779 个左右的不同物料；其中 1,470 个订单在 2026-09-01 前创建、之后修改，证明不能依赖现有 PMC 主订单投影或只按创建日期取数。E10 在核对期间仍有业务写入，数量是 2026-10-06 的只读快照。

## ApproveStatus 确认结果

- 实际值只有 `Y / N / V`。现有正式客户导入代码把 `ApproveStatus='Y'` 作为“已审核”；生产数据中 BOM 的 Y 全部有真实审核时间和非零审核人，N 全部为 `1900-01-01` 且审核人零 GUID，因此本报表可把 Y 作为已审核、N 作为未审核。
- V 行普遍保留历史审核时间；Schema 对同类基础资料状态给出 `V=失效`、`Y=生效`，但 `ApproveStatus` 字段本身没有提供独立枚举说明。状态计算可以安全地把 V 视为“非当前有效/不满足已审核”，但 V 的正式中文业务名称仍需 E10 管理员确认，不能在 UI 中擅自固定为“作废”或“失效”。
- 2026-10-06 快照：BOM `Y=282132/N=31/V=14`；BOM_D `Y=975151/N=45/V=53`；ITEM_ROUTING `Y=360891/N=859/V=13890`；ITEM_ROUTING_D `Y=518638/N=993/V=1550`。

## 建议状态判断规则（当前可确认部分）

- 是否需研发：`ITEM_PROPERTY=P` 且 `ITEM_ROUTING_CONTROL=0` 可判 `NOT_APPLICABLE`。`M` 可作为需研发候选；`S/Y/F/O/T` 及 `P+routingControl=1` 需要业务确认后才能固化。当前候选实际只有 M/P，另有 4 个 P+control=1 和 1 个 M+control=0 的异常/例外组合。
- 设计 BOM：需设计 BOM的物料，没有 BOM → `NOT_STARTED`；存在 BOM 但没有 Y 头 → `DESIGN_IN_PROGRESS`；至少一个 Y 的 BOM，且存在 Y、`EFFECTIVE_DATE <= 统计时点 <= EXPRITY_DATE` 的 BOM_D → 设计 BOM完成。`E_CODE` 只显示工程版/正式版，不作为完成条件。当前生产 BOM 全部 `E_CODE=P`，没有可验证的工程版样本。
- 工艺路线：`ITEM_ROUTING_CONTROL=0` → 不适用；control=1 时优先核对非零 `STANDARD_ROUTING_ID` 指向的路线头 Y、至少一个路线明细 Y、明细 `OPERATION_ID` 能在 OPERATION 找到。未设置标准路线时，按 ITEM/工厂找路线；0 条为待工艺，唯一 Y 路线可继续，多条 Y 路线必须标异常或先确认选择规则。control=2 应加入 ITEM_FEATURE/ITEM_FEATURE_PLANT，但当前无真实样本可验证。
- 工艺 BOM：理论上应对有效 BOM_D 统计 `总数/已挂工序/未挂工序/无效工序`，并确认 BOM_D.OPERATION_ID 属于适用路线；但当前数据不满足实施条件，见下方阻塞项。
- 最后研发更新时间：取参与判定的 BOM、BOM_D、ITEM_ROUTING、ITEM_ROUTING_D 的 `LastModifiedDate` 最大值，不使用订单更新时间冒充研发更新时间。

## Phase 2 阶段的核心阻塞与风险（已由 Phase 2.5 调查解除）

- 现行 `BOM_D` 975,249 行的 `OPERATION_ID` 非零数量为 0；所有值都是零 GUID。`HISTORY_BOM_D`、`BOM_AUTO_CONFIG(_D)`、`BOM_MANUAL_CONFIG(_D)` 当前也都是空表。
- 带时间戳的 `BM_R049_QueryExpandBom...` 表属于查询临时结果，仅一张临时表有 375 行，不能作为稳定业务数据源；`MO_ROUTING_MATERIAL` 是生产工单执行数据，第一版按需求不应引入。
- 因此不能把“非 NULL”当成已挂工序，也不能证明生产现场使用另一张正式表维护 BOM→工序。若机械执行提示中的规则，所有有 BOM 的品项都会被判未挂工序，这是明显高风险结论。
- Phase 2 当时只允许将工艺 BOM 标记为 `ABNORMAL/待确认`；Phase 2.5 已证明该指标在当前 E10 中不存在，后续应移除工艺 BOM 门槛，并按设计 BOM + 工艺路线判断 `COMPLETE`。
- 事业部口径不清：E10 销售部门组织路径与 PMC 的客户→主责事业部不是同一概念，正式筛选/汇总前必须选定口径。
- 候选订单是否排除 N/V、关闭单也未由需求定义；候选日期条件本身不应偷偷附加审核/关闭过滤。

## 实际只读样本

- `2304-202610060005 / 行1 / 601000110`：P、routingControl=0，无 BOM/Route；按已确认规则为“不适用”。
- `2301-2026C1101-B061 / 行1 / ABL370CC0C375-1/1`：M、control=1，无 BOM、无 Route；可判“未开始”，原因“未找到设计 BOM”。
- `2307-260930008 / 行2 / RXA500J-V5-1/1`：M、有效正式 BOM 及 11 条有效 BOM_D，但无有效 Route；可判“待工艺”。
- `2307-260930008 / 行1 / RXA505F-HLLV5-1/1`：M、正式 BOM、1 条有效 BOM_D、标准路线 Y 且有 1 条有效工序；BOM_D.OPERATION_ID 仍为零 GUID，所以设计 BOM和路线可判完成，工艺 BOM只能判“待确认/异常”，不能判研发完成。
- 当前候选范围未找到可验证的工程 BOM、仅 N/V BOM、已审核 BOM 无有效明细、control=2 特征路线样本；这些场景后续需要固定测试夹具覆盖，不能用缺失的生产样本反推规则。

## Phase 2 新增文件预案（Phase 3 状态已更新）

- `data-operations/e10/pmc_rd_progress_probe.py`：[Phase 3 已创建] 输入 `--order-no` 的只读验证工具。
- `apps/api/src/migrations/*-PmcRdProgress.ts`
- `apps/api/src/modules/pmc-rd-progress/`：reader、calculator、application service、query service、controller、module、tests。
- `apps/web/src/modules/planning/pages/PmcRdProgressPage.tsx` 及对应测试。
- 还需修改 `apps/api/src/app.module.ts`、`apps/web/src/App.tsx`、`packages/contracts/src/index.ts` 和必要样式/端到端测试。

## 数据库 Migration

- 无。本阶段仅执行 E10 与 PostgreSQL 只读查询，没有修改任何数据库数据或结构。

## 新增或修改测试

- 无。Phase 1/2/2.5 均为只读分析；尚未进入 Phase 3。

## 已运行测试/验证

- E10 INFORMATION_SCHEMA/sys catalog 字段、主键候选、业务键、状态分布、组织/工厂、特征码、有效期、标准路线和 BOM 工序挂接只读核对：完成。
- E10 全库 OPERATION_ID 对象、MO/工单工艺/工单材料/领退料值域关系、5 个完工产品样本及 295,383 张符合条件完工工单的只读核对：完成。
- E10 候选日期范围和真实订单样本查询：完成。
- PostgreSQL `rd_*`、`erp_*`、`sales_orders` 表结构与 RLS 只读核对：完成。
- 未运行代码 tests/build/deploy；本阶段没有业务代码修改。

## Phase 2 当时等待用户/业务确认（当前以 Phase 2.5 清单为准）

1. [已完成调查] 当前没有实际维护 BOM 子件→工序的可靠数据源；具体管理/历史根因无法从数据库确定，但不再作为第一版阻塞项。
2. [不再适用] 第一版不计算工艺 BOM，因而无需定义哪些 BOM_D 行必须挂工序。
3. `ITEM_PROPERTY` 中 M/S/Y/F/O/T 哪些属于“需要研发”；4 个 P+control=1 和 1 个 M+control=0 如何处理？
4. `STANDARD_ROUTING_ID` 指向其他 ITEM 的路线是否是合法的标准路线复用；未设置标准路线但存在多条 Y 路线时如何选适用路线？
5. 报表“事业部”使用 E10 销售部门/祖先，还是现有 `mps_customer_division_mappings` 的客户主责事业部？
6. 候选日期命中但订单/行 `ApproveStatus=N/V` 或订单已关闭时，是保留显示、单独标状态，还是排除？
7. `ApproveStatus=V` 的正式中文名称请 E10 管理员确认。

## Phase 2 当时的下一步（已由 Phase 2.5 结论取代）

1. [已完成] 通过全库元数据和值域关系调查确认 BOM→工序不存在可靠来源。
2. 后续行动以下方 Phase 2.5 的“下一步”为准。

## 恢复执行说明

继续本任务时先读取本节以及下方 Phase 2.5/Phase 3，执行 `git status` / `git diff --stat`，不要重做 Phase 1/2/2.5/3。Phase 3 已 PASS；仍待确认的事业部、订单状态纳入范围等口径不得擅自固化。

## Phase 2.5 - 工艺BOM真实数据来源调查

### 调查范围与安全边界

- 调查时间：2026-10-06；E10 是持续写入的生产系统，以下数量是本次只读核对快照。
- 连接方式：统一使用 `/data/automation/code/work/basci/basic_code` 的 `MSSQLDatabase` 配置，以 pytds `readonly=True` 连接；查询使用 `READ COMMITTED`。
- 已反向搜索 `sys.tables`、`sys.views`、`sys.columns`、扩展属性和 E10 Schema，覆盖 `OPERATION / ROUTING / MATERIAL / ITEM / BOM / MO / ISSUE / FEED / PICK` 及“工序用料/工艺用料/工序物料/投料/发料/领料/材料”等名称和字段。
- 本阶段没有修改业务源码、E10/PostgreSQL 数据或结构、主计划同步规则；没有 migration、测试构建、提交或部署。

### 元数据搜索结论

- 没有找到一张已实际使用、同时具备“投入物料身份 + 工序身份 + 产品/路线或 BOM 来源”的基础资料表。
- E10 当前不存在 `PLM` 前缀业务对象；`BM` 前缀只发现 7 张 `BM_R049_QueryExpandBom...` 时间戳临时查询结果表，仅 1 张有 375 行且 `OPERATION_ID` 全零，不能作为稳定数据源。
- `sys.sql_modules` 中没有存储过程、函数或视图引用 `MO_ROUTING_MATERIAL` / `MO_ROUTING_WIP_MATERIAL`，没有发现由另一张基础资料表生成它们的数据库端逻辑。
- SQL Server 未为本次涉及的 BOM/MO/Routing 对象声明可用外键，因此同时做了值域关联：`MO_ROUTING.MO_ID → MO`、`MO_ROUTING_D.MO_ROUTING_ID → MO_ROUTING`、`MO_ROUTING_D.OPERATION_ID → OPERATION` 均 100% 匹配；`MO_D.MO_ID` 和 `MO_D.ITEM_ID` 也均可关联，但它的工序字段全零。

### 所有有实际记录的 OPERATION_ID 对象

| 表 | 总数 | OPERATION_ID 非零 | ITEM_ID | BOM 键 | Routing 键 | 业务判断 |
|---|---:|---:|:---:|:---:|:---:|---|
| `APS_OUT_DAILY_OP` | 17,496 | 17,496 | 否 | 否 | 否 | APS 每日工序产出计划；工序为字符串编号，无投入物料 |
| `APS_OUT_MO_D` | 15,120 | 0 | 否 | 否 | 否 | APS 工单明细，当前工序字段未使用 |
| `BM_R049_QueryExpandBom1702572825934` | 375 | 0 | 是 | 是 | 否 | 时间戳查询临时结果，不是稳定源 |
| `BOM_D` | 975,249 | 0 | 否（子件在 `SOURCE_ID`） | 是 | 否 | BOM 子件；工序字段当前未使用 |
| `ECN_SD` | 35,516 | 0 | 否 | 否 | 否 | 工程变更明细，当前工序字段未使用 |
| `INQUIRIES_D` | 72 | 0 | 是 | 否 | 否 | 询价明细，当前工序字段未使用 |
| `ISSUE_RECEIPT_D` | 764,641 | 0 | 是 | 否 | 是 | 领退料执行明细，工序/工单工序字段全零 |
| `ISSUE_RECEIPT_REQ_D` | 493,341 | 0 | 是 | 否 | 是 | 领退料申请明细，工序/工单工序字段全零 |
| `ITEM_ROUTING_D` | 521,181 | 521,181 | 否 | 否 | 是 | 产品工艺路线工序定义，不含投入物料 |
| `ITEM_SUPPLIER_PRICE` | 282,878 | 3,923 | 是 | 否 | 否 | 3,923 行全部为 `PRICE_TYPE=3` 工序委外价格，不是 BOM 投料关系 |
| `MO_CHANGE_D` | 40,211 | 0 | 是 | 否 | 是 | 工单变更明细，工序字段未使用 |
| `MO_D` | 1,858,966 | 0 | 是 | 否 | 是 | 工单材料行；`OPERATION_ID`、`MO_ROUTING_D_ID` 全零 |
| `MO_ROUTING_D` | 1,408,545 | 1,408,545 | 否 | 否 | 是 | 工单工艺工序定义，不含投入物料 |
| `OPERATION` | 185 | 185 | 否 | 否 | 否 | 工序主档 |
| `OPERATION_D` | 197 | 197 | 否 | 否 | 否 | 工序明细/关联资料 |
| `PO_CHANGE_D` | 173 | 1 | 是 | 否 | 否 | 采购变更；唯一非零行为工艺委外执行资料 |
| `PURCHASE_ARRIVAL_D` | 591,937 | 12,131 | 是 | 否 | 否 | 工艺委外到货，不是产品 BOM 投料定义 |
| `PURCHASE_ORDER_D` | 565,112 | 18,057 | 是 | 否 | 否 | 非零行全部 `PURCHASE_TYPE=3`，来源 `MO_ROUTING.MO_ROUTING_D`，属于工艺委外采购 |
| `SF_DATA_COLLECT_D` | 735,939 | 735,939 | 是 | 否 | 是 | 生产报工/资料收集执行事实，不是设计阶段投入物料分配 |
| `SUGGESTION_PLAN_BOM` | 1,457,001 | 0 | 是 | 否 | 否 | 建议计划 BOM，工序字段未使用 |
| `WIP_FACT_TABLE` | 68 | 68 | 否 | 否 | 否 | 在制量分析事实，不含物料 |

注：`PURCHASE_ORDER_D`、`PURCHASE_ARRIVAL_D`、`ITEM_SUPPLIER_PRICE` 中同时存在 ITEM 与 OPERATION 的非零数据，均由工艺委外采购/价格业务解释，不能误判为 BOM 子件在哪道工序投入。

### MO_ROUTING_MATERIAL 分析

- Schema 业务名称为“工单工艺用料信息”；主键 `MO_ROUTING_MATERIAL_ID`，唯一业务父键为 `MO_ROUTING_D_ID`。
- 数量字段只有 `SUM_QTY`、`ISSUED_QTY`、`TRNSFERED_QTY`、`SECEND_QTY`、`RESERVE_QTY`；另有 `CreateDate`、`LastModifiedDate`、`ApproveStatus` 和通用审计/UDF 字段。
- 不存在 `ITEM_ID`、`OPERATION_ID`、`MO_ID`、`MO_ROUTING_ID`、`BOM_ID`、`BOM_D_ID`、`SOURCE_ID`、`SOURCE_D_ID`、`SOURCE_TYPE`、`SOURCE_DOC_ID`、`SOURCE_DOC_D_ID`、`ITEM_ROUTING_ID` 或 `ITEM_ROUTING_D_ID`。
- 当前生产库行数为 **0**。同构的 `MO_ROUTING_WIP_MATERIAL`（工作中心生产用料信息）也为 **0**。
- 即使未来有记录，它也只能通过 `MO_ROUTING_D_ID` 表示某工单工序下的汇总数量，本表自身没有“哪个物料”的字段，无法表达或恢复 BOM 子件 → 工序关系。
- `MO_ROUTING_PRODUCT_D` 有 `MO_ROUTING_D_ID + ITEM_ID` 且有 604,048 行，但 Schema 明确它是“工单工艺期间产出信息单身”，`PRODUCT_TYPE` 表示主/联/副/回收产出，属于工序产出而非投入物料。
- 结论：`MO_ROUTING_MATERIAL` 属于**生产工单派生/执行域的空置汇总子表**，不是基础工艺资料。其实际生成时点因生产库从未产生记录而无法验证，但可以确定它不能作为研发阶段工艺 BOM 的数据源。

### 真实数据来源链与断点

```text
基础资料：BOM → BOM_D（有子件，无有效工序）
基础资料：ITEM_ROUTING → ITEM_ROUTING_D → OPERATION（有工序，无投入子件）

生产工单：MO → MO_D（有实际材料，工序键全零）
生产工单：MO → MO_ROUTING → MO_ROUTING_D → OPERATION（有实际工序，无投入子件）
                                       └→ MO_ROUTING_MATERIAL（0 行，且无 ITEM_ID）
生产执行：ISSUE_RECEIPT(_REQ)_D（有材料，工序键全零）
生产执行：SF_DATA_COLLECT_D（报工事实，不是 BOM 投入关系）
```

- `MO_ROUTING` 当前 715,089 行，全部 `MO_ID` 可匹配 `MO`；`MO_ROUTING_D` 1,408,545 行，父键和 `OPERATION_ID` 均可完整匹配。
- `MO_D` 1,858,966 行，材料 `ITEM_ID` 和父工单可完整匹配，但 `OPERATION_ID`、`MO_ROUTING_D_ID` 全为零 GUID。
- `ISSUE_RECEIPT_REQ_D` 493,341 行、`ISSUE_RECEIPT_D` 764,641 行，两者的工序和工单工序字段也全为零 GUID。
- `MO.ISSUE_BY_OP_SEQ` 只有 193 张工单为真；这些工单的 `MO_D.MO_ROUTING_D_ID` 仍全为零，不能形成结构化关系。
- `ITEM_PLANT.ISSUE_DESTINATION_TYPE` 的 Schema 枚举为 `1=工艺、2=工作中心/委外供应商、3=自定义、4=工单`。当前所有自制 `M` 物料都配置为 `4=工单`，没有配置为 `1=工艺`；这是当前按工单发料、未形成工序投料关系的直接配置证据。

### 已完工产品反查

以下 5 个自制产品都具备当前有效 BOM、有效标准路线和实际完工工单；均可看到工单材料、部分已领料、报工记录和工单工艺，但不存在任何材料 → 工单工序关联：

| 工单 | 产品 | BOM 子件 | 标准路线/工序 | MO_D | 已领料材料行 | 报工记录 | 工单工序 | 材料→工序 | MO_ROUTING_MATERIAL |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| `5103-202609280033` | `HK004-1/1` 1m收银前台抽屉柜 | 5 | `1000009` / 1 | 5 | 4 | 1 | 1 | 0 | 0 |
| `5103-202609280035` | `QCS206-1/1` 收银前台抽屉柜 | 5 | `1000207` / 1 | 5 | 4 | 1 | 1 | 0 | 0 |
| `5103-202609280097` | `CSHK001-1/1` 前柜1m | 19 | `1000122` / 1 | 19 | 11 | 1 | 1 | 0 | 0 |
| `5103-202609290006` | `CS700500001-A-1/1` 药妆&收银前台带抽屉 | 5 | `1000010` / 1 | 5 | 3 | 1 | 1 | 0 | 0 |
| `5103-202609300026` | `UGGL567-1/1` 谷歌终端展示桌 | 98 | `1000010` / 1 | 94 | 11 | 1 | 1 | 0 | 0 |

具体材料例证：`HK004-1/1` 工单包含 `5030200721 珍珠棉护角`（需求/领料 4/4）和 `5060101743 珍珠棉片`（2/2）；`QCS206-1/1` 包含 `5010216208 五层中封箱`（1/1）和 `5040101044 PE袋`（1/1）。这些材料都能按 `ITEM_ID`/数量与当前 BOM 对应，但其 `MO_D.OPERATION_ID`、`MO_D.MO_ROUTING_D_ID` 均为零 GUID。

全量量化结果：限定 `MO.ApproveStatus=Y`、`MO.STATUS=Y`、完成数量大于 0，并要求产品当前存在已审核 BOM/明细与已审核标准路线/工序，共得到 **295,383 张已完工工单、77,967 个产品**；其中 **156,799** 张有已领料材料，**182,325** 张有报工记录，**183,284** 张有工单工艺，但 `MO_D` 存在材料→工单工序链接的工单为 **0**。因此 `BOM_D.OPERATION_ID` 不是凯南当前正常领料、报工和完工的必要条件。

### 已知样本 2307-260930008 / RXA505F-HLLV5-1/1

- 当前基础资料仍为：有效正式 BOM（1 条子件）+ 有效标准路线 `1000000`（1 道工序）+ `BOM_D.OPERATION_ID=零 GUID`。
- 找到多张历史完工工单，包括 `5128-260924106`、`5128-260924101`、`5128-260918064`。以 `5128-260924106` 为例：计划/完成数量 1/1，工单材料为 `RXA505F-HLLV5`，可与当前 BOM 子件按 `ITEM_ID` 对应，但 `MO_D.OPERATION_ID` 和 `MO_D.MO_ROUTING_D_ID` 都为零。
- 这些历史工单本身没有 `MO_ROUTING` / `MO_ROUTING_D`，`MO_ROUTING_MATERIAL` 也没有记录；因此该产品在真实生产工单中**不存在可识别的“物料 → 工序”关系**。
- 用户要求“若存在则输出至少 10 条关系样例”；实际关系不存在，所以不能伪造 10 条样例。上述工单和材料行是反证样本。

### BOM_D.OPERATION_ID 全零的可确认边界

- 可以确定的技术事实：975,249 行 `BOM_D` 全部为零 GUID；自制物料统一按工单而不是按工艺作为发料目的；工单材料、领退料和变更明细的工序键也全零；大量产品在这种状态下已经正常领料、报工、完工。
- **无法从数据库确定**具体是 E10 功能从未启用、公司流程刻意不维护，还是客户端界面/版本配置所致；数据库也不能证明设计/工艺人员实际操作的 E10 菜单名称。不能把上述管理原因写成确定事实。
- 因此最严谨的结论是：凯南当前生产数据采用工单级材料管理，没有结构化维护 BOM 子件 → 工序；具体人为和历史原因需要 E10 管理员/工艺业务方补充，但不再阻塞第一版研发进度。

### 最终业务模型与 Phase 3 决策

1. 是否找到品号级工序用料表：**NO**。
2. `MO_ROUTING_MATERIAL` 性质：生产工单派生/执行域的空置汇总子表，不是基础工艺资料，也不能表示具体物料。
3. `BOM_D.OPERATION_ID` 全零原因：技术现状与工单级发料配置可以确认；具体管理/历史根因**无法从数据库确定**。
4. 推荐模型：**模型 C**。凯南当前 E10 没有可靠的“BOM 物料 → 工序”结构化数据，第一版不得展示或计算“工艺 BOM 完成率”，也不得把它设为研发完成门槛。
5. `Phase 3：GO`。Phase 3 的核心状态应调整为：
   - `NOT_APPLICABLE`：不适用；
   - `NOT_STARTED`：未开始；
   - `DESIGN_IN_PROGRESS`：设计 BOM 进行中；
   - `WAITING_ROUTING`：待工艺；
   - `ROUTING_IN_PROGRESS`：工艺设计中；
   - `COMPLETE`：研发完成（设计 BOM 已审核且适用工艺路线已审核）；
   - `ABNORMAL`：多有效 BOM/路线无法唯一选择、引用失效、缺失主数据等无法安全判定的异常。
- 正常主流程为：`未开始 → 设计 BOM 进行中 → 待工艺 → 工艺设计中 → 研发完成`。不适用和异常是旁路状态；不再保留 `PROCESS_BOM_IN_PROGRESS` 或任何工艺 BOM 完成状态。
- 数据事实支持“已审核设计 BOM + 已审核适用 Routing”作为当前 E10 可可靠识别的研发资料完成条件。它代表资料齐套信号，不应扩大解释为生产一定可下达或所有生产准备均已完成。

### Phase 2.5 后仍需业务确认

1. 报表“事业部”采用 E10 销售部门/组织祖先，还是 PMC `mps_customer_division_mappings` 的客户主责事业部。
2. `ITEM_PROPERTY` 中 M/S/Y/F/O/T 哪些属于“需要研发”，以及少量 P+control=1、M+control=0 例外如何处理。
3. `STANDARD_ROUTING_ID` 合法复用其他 ITEM 路线的规则；未设标准路线但存在多条 Y 路线时如何选用。
4. 候选日期命中但订单/行状态为 N/V 或订单已关闭时，保留、单列状态还是排除。
5. `ApproveStatus=V` 的正式中文业务名称。

### 下一步

1. [已完成] 按模型 C 实现 `--order-no` 只读 Phase 3 验证工具及固定规则测试。
2. [已完成] 用指定业务订单和额外生产样本逐行核对状态，未确认组合统一进入 `ABNORMAL`。
3. 下一阶段单独评审正式数据投影、权限、同步、API 和页面实施。

## Phase 3 - PMC研发进度验证工具

### 阶段结论

- `Phase 3：PASS`。
- 已实现单订单只读验证、机器可读 JSON、调试路径和正式候选范围只读汇总。
- 最终模型继续严格采用“设计 BOM + 工艺路线”，没有读取或判断 `BOM_D.OPERATION_ID`、`MO_ROUTING_MATERIAL` 或“工艺 BOM 完成率”。
- 建议进入 Phase 4 正式数据模型 + 同步服务 + API；正式上线前仍需确认事业部、订单 N/V/关闭状态等产品口径。

### 新增文件

- `data-operations/e10/pmc_rd_progress_probe.py`
  - `--order-no <订单号>`：不受正式日期范围限制，输出该订单全部品项。
  - `--json`：输出机器可读 JSON。
  - `--debug`：输出 ITEM 组合规则、全部 BOM/Route 候选、选择原因和最终判断路径。
  - `--candidate-summary`：按正式候选范围做全量只读统计并抽样。
  - `--as-of <ISO datetime>`：固定 BOM 有效期判断时点，便于可重复验证。
- `data-operations/e10/test_pmc_rd_progress_probe.py`：纯逻辑单元测试 27 项。

### 只读、安全与性能实现

- 使用 `/data/automation/code/work/basci/basic_code` 的 `MSSQLDatabase` 加载连接配置，pytds 连接固定 `readonly=True`，事务隔离为 `READ COMMITTED`，没有任何写 SQL 或 DDL。
- 单订单/候选订单先批量取得订单、客户、品项；随后按最多 500 个 ID 分批读取 `ITEM_PLANT`、BOM/BOM_D、Routing/Routing_D/OPERATION，不逐订单行连接数据库，也不逐 ITEM 执行 5—10 条查询。
- 所有外部输入参数化；动态 SQL 只生成固定数量的 `%s` 占位符。
- 正式候选范围作为唯一常量保留：`SALES_ORDER_DOC.CreateDate >= 2026-09-01 OR SALES_ORDER_DOC.LastModifiedDate >= 2026-09-01`；`--order-no` 直接查询不受此范围限制。
- `normalize_guid()` 是零 GUID 正规化的唯一入口；订单特征码、标准路线、路线特征码和所有实体 ID 共用。
- SQL 只批量取事实；BOM 多版本、Routing 选择、状态和异常解释均在 Python 纯函数中完成。不存在无排序 `TOP 1` 或其他随机选择。

### 最终状态模型

```text
NOT_APPLICABLE / 不适用
NOT_STARTED / 未开始
DESIGN_IN_PROGRESS / 设计 BOM 进行中
WAITING_ROUTING / 待工艺
ROUTING_IN_PROGRESS / 工艺设计中
COMPLETE / 研发完成
ABNORMAL / 异常
```

- 订单状态为 `NOT_APPLICABLE / IN_PROGRESS / COMPLETE / ABNORMAL`。
- 订单 `COMPLETE` 要求全部需研发品项完成；任一品项异常则订单异常；完成率分母排除 `NOT_APPLICABLE`，异常仍计入未完成。

### ITEM_PROPERTY / ITEM_ROUTING_CONTROL 组合规则

| ITEM_PROPERTY | ITEM_ROUTING_CONTROL | 规则 |
|---|---|---|
| `P` | `0` | 已验证为整体研发不适用 |
| `M` | `1` | 已验证为需要设计 BOM + 普通工艺路线 |
| `M` | `2` | 设计 BOM 正常判断；特征码路线因无真实生产样本进入 `ABNORMAL / UNSUPPORTED_FEATURE_ROUTING` |
| 其他组合 | 任意 | 不猜测，进入 `ABNORMAL / UNSUPPORTED_ITEM_RULE_COMBINATION` |

- 正式候选范围的未确认组合共 6 行：`P+1` 为 5 行，`M+0` 为 1 行。

### BOM 选择算法

1. 按订单品项 `ITEM_ID` 和唯一 `ITEM_PLANT.Owner_Org_ROid` 限定适用工厂。
2. 没有 BOM：`NOT_STARTED / NO_BOM`。
3. 有 BOM、没有审核状态 Y 的 BOM：`IN_PROGRESS / BOM_NOT_APPROVED`。
4. 头为 Y 后，明细必须为 Y，且 `EFFECTIVE_DATE <= asOf <= EXPRITY_DATE`；生产数据中的 `9998-12-31` 自然兼容，无需特殊魔法判断。
5. 唯一一个“已审核头 + 至少一条当前有效已审核明细”时才选择并判完成。
6. 多个同时满足的 BOM 不按 E_CODE、版次或修改时间猜优先级，直接 `ABNORMAL / MULTIPLE_ACTIVE_BOMS`。
7. `E_CODE` 和 `VERSION_TIMES` 只输出用于审计，不作为完成条件。

### Routing 选择算法

1. `control=0`：路线不适用；它与“整个品项研发不适用”分开判断。
2. `control=1` 且标准路线 ID 非零：只按该稳定 ID 读取，允许标准路线的 ITEM 与当前 ITEM 不同；来源标记 `STANDARD_ROUTING_REFERENCE`。
3. 标准路线必须存在、头为 Y、至少一条明细为 Y，且所有已审核明细的 `OPERATION_ID` 均能匹配 OPERATION。
4. 标准路线引用不存在：`ABNORMAL / STANDARD_ROUTING_NOT_FOUND`；头未审核、无已审核工序或工序引用无效则为路线进行中并返回精确 reasonCode。
5. 没有标准路线时，按 `ITEM_ID + Owner_Org_ROid + 正规化后的 ITEM_FEATURE_ID` 找候选；0 条为未开始，唯一已审核路线继续核验，多条已审核路线直接 `ABNORMAL / MULTIPLE_ACTIVE_ROUTINGS`。
6. `control=2` 当前固定 `ABNORMAL / UNSUPPORTED_FEATURE_ROUTING`，不伪装支持。

### 4 个指定真实样本

固定 `asOf=2026-10-06 12:00:00`：

| 订单 / 行 / 品号 | 设计 BOM | Routing | 最终状态 | 结果 |
|---|---|---|---|---|
| `2304-202610060005 / 1 / 601000110` | 不适用 | 不适用 | `NOT_APPLICABLE` | 符合预期 |
| `2301-2026C1101-B061 / 1 / ABL370CC0C375-1/1` | 未开始 | 未开始 | `NOT_STARTED` | 符合预期 |
| `2307-260930008 / 2 / RXA500J-V5-1/1` | 完成（11 条有效明细） | 未开始 | `WAITING_ROUTING` | 符合预期 |
| `2307-260930008 / 1 / RXA505F-HLLV5-1/1` | 完成（1 条有效明细） | 完成（标准路线 `1000000`、1 工序） | `COMPLETE` | 符合预期；未读取 BOM_D.OPERATION_ID |

### 额外真实生产样本

| 订单 / 行 / 品号 | 状态 | reasonCode |
|---|---|---|
| `2301-2025A012020 / 1 / 401031194` | `NOT_APPLICABLE` | `PURCHASE_ITEM_WITHOUT_ROUTING` |
| `2301-2025A012020 / 2 / 401040193` | `NOT_APPLICABLE` | `PURCHASE_ITEM_WITHOUT_ROUTING` |
| `2301-2021C001064 / 36 / VMA327G(9049ZA504888A00)-1/1` | `NOT_STARTED` | `NO_BOM` |
| `2301-2023A027018 / 1 / MJCOP014125` | `NOT_STARTED` | `NO_BOM` |
| `2301-2025A012008-7 / 3 / UMPI385-01-516F-1/1` | `WAITING_ROUTING` | `NO_ROUTING` |
| `2301-2025A012008-7 / 4 / UMPI385-01-524F-1/1` | `WAITING_ROUTING` | `NO_ROUTING` |
| `2301-2026A009022 / 18 / ROSS122-1/1` | `ROUTING_IN_PROGRESS` | `ROUTING_NOT_APPROVED` |
| `2301-2026A071017 / 4 / A23-1/1` | `ROUTING_IN_PROGRESS` | `ROUTING_NOT_APPROVED` |
| `2301-2021C001064 / 1 / C00138B-1/1` | `COMPLETE` | `RD_COMPLETE` |
| `2301-2021C001064 / 2 / VMA084A-1/1` | `COMPLETE` | `RD_COMPLETE` |
| `2304-202607090004 / 3 / 304010515` | `ABNORMAL` | `UNSUPPORTED_ITEM_RULE_COMBINATION`（M+0） |
| `2304-202609010012 / 1 / 301010304` | `ABNORMAL` | `UNSUPPORTED_ITEM_RULE_COMBINATION`（P+1） |

- 已覆盖 12 个额外真实品项和 6 种当前实际存在的最终状态。
- 当前正式候选数据中没有 `DESIGN_IN_PROGRESS` 真实样本；没有伪造生产数据，该状态由 `BOM 未审核`、`BOM 无已审核明细`、`BOM 无当前有效明细`等纯逻辑测试覆盖。

### 正式候选范围全量统计

E10 是实时生产系统；以下为 2026-10-06 本轮快照，BOM 判断时点固定为 `2026-10-06 12:00:00`：

| 品项研发状态 | 数量 |
|---|---:|
| `NOT_APPLICABLE` | 823 |
| `NOT_STARTED` | 2,908 |
| `DESIGN_IN_PROGRESS` | 0 |
| `WAITING_ROUTING` | 2,706 |
| `ROUTING_IN_PROGRESS` | 4 |
| `COMPLETE` | 11,015 |
| `ABNORMAL` | 6 |
| 合计 | 17,462 |

候选订单共 2,511 张；订单状态：`NOT_APPLICABLE=229`、`IN_PROGRESS=1,402`、`COMPLETE=874`、`ABNORMAL=6`。

### 异常类型与数量

- 当前生产候选范围只有 `UNSUPPORTED_ITEM_RULE_COMBINATION=6`：`P+1` 5 行、`M+0` 1 行。
- 当前未命中但已有显式算法和单元测试保护的异常包括：多有效 BOM、多有效 Routing、标准路线引用不存在、control=2 无验证样本、ITEM/ITEM_PLANT 缺失或多工厂行、未知路线控制值。
- 工序引用失效按需求归入 `ROUTING_IN_PROGRESS / INVALID_OPERATION_REFERENCE`，不是随机选路或静默完成。

### 测试与验证

- `python3 -m unittest discover -s data-operations/e10 -p 'test_pmc_rd_progress_probe.py' -v`：27/27 通过。
- `python3 -m py_compile data-operations/e10/pmc_rd_progress_probe.py data-operations/e10/test_pmc_rd_progress_probe.py`：通过。
- `--order-no`、`--json`、`--debug`、`--candidate-summary` 对生产 E10 只读验证：通过。
- 四个指定样本：4/4 符合预期。
- 额外真实品项：12 个，覆盖当前生产库实际存在的 6 种状态。
- 正式候选范围：2,511 订单 / 17,462 品项批量计算成功。
- `git diff --check`：通过。
- 未运行 Web/API tests、typecheck、lint、build：本阶段未修改 Web/API/TypeScript，且用户明确禁止正式页面和服务实施。

### 本阶段未执行

- 无 PostgreSQL migration，无数据库写入，无 E10 修改。
- 无正式同步表、同步服务、API、菜单或 React 页面。
- 未修改主计划订单同步及其 `2026-09-17` 规则。
- 未部署、未 commit、未 push。

### Phase 4 前仍需确认

1. 报表“事业部”使用 E10 销售部门祖先，还是 PMC 客户主责事业部映射。
2. 候选日期命中但订单/行状态为 N/V 或订单已关闭时，是保留展示、单列状态还是排除。
3. `P+1` 与 `M+0` 六个异常品项的正式业务含义；未确认前继续保留异常是安全策略。
4. `ApproveStatus=V` 的正式中文业务名称。

### 下一步

1. 用户确认是否启动 Phase 4。
2. 启动后先固化正式只读资源契约、租户/权限/筛选/导出边界和独立同步投影，再创建 migration 与 API。
3. 正式页面继续遵守 PMC 树形菜单和 KDOS 标准只读报表规范；不得把本验证脚本直接接到 Web 请求链路。

## Phase 4 - PMC研发进度正式数据模型、同步服务与API

任务目标：独立 E10 只读批量取数 → TypeScript Calculator → PostgreSQL 当前快照 → PMC 查询/KPI/订单汇总；不开发 React 页面，不改现有订单/rd 同步，不修改 E10。
当前状态：已完成。
最后更新时间：2026-10-07（Asia/Shanghai）。
当前阶段：正式部署、真实FULL/INCREMENTAL与一致性验收完成，Phase 4 PASS。

### 已完成
- [x] 阅读 Phase 1/2/2.5/3 进度、完整 Phase 3 Oracle 与27项测试，检查现有 RD reader、水位、Application/Query/Controller、迁移、权限注册和主责事业部映射。
- [x] 起始工作区已有 `outputs/CODEX_PROGRESS.md` 修改和两份未跟踪的 Phase 3 Python 文件，全部保留。
- [x] 采用独立 `pmc_rd_progress_items` + `pmc_rd_progress_sync_runs`，TypeORM raw SQL；UUIDv7、tenant/RLS、数量 numeric、业务键 tenant + source_order_line_id。
- [x] 复用 PMC `mps_customer_division_mappings` 客户主责事业部；缺映射为NULL，保留 E10 Owner_Dept，不猜组织祖先。
- [x] E10 适配器只提供原始事实；Python仅用于共享 MSSQLDatabase 的读取驱动，不运行 Oracle 或业务计算。生产状态统一由 TypeScript Calculator 计算。
- [x] 同步设计：源库时间、各表高精度复合游标、2分钟 overlap、批量受影响集合（含标准路线反向引用）、集中重算、单 PostgreSQL事务批量UPSERT、内容hash、软失效、成功才推进水位、事务审计、租户级并发锁。

### 正在进行
- [x] 新表 migration、集中 Calculator、独立源读取适配器、同步服务、API与权限契约。

### 待完成
- [x] 单元/集成测试、共享事实上的 Python/TS逐行一致性回归。
- [x] 备份、migration验证/应用、构建、部署、健康检查、真实 FULL/INCREMENTAL 与API核验。
- [x] 性能/指定及额外样本/全量状态计数报告与最终 PASS/FAIL。

### 修改文件
- 最终文件见 `outputs/PMC研发进度Phase4验收报告.md` 第1节；代码提交 `4dcf121` / `5d2faa1`，outputs验收记录保留工作区。

### 数据库 Migration
- 已应用 `1722920082000-PmcRdProgress` 与 `1722920083000-PmcRdProgressOrderCloseRaw`；只影响新两表，正式迁移80→82。

### 新增或修改测试 / 已运行测试
- API686/Contracts22/Web181/Python34通过；真实隔离集成及生产验收PASS，完整结果见最终报告。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。
- 源库RCSI不是整个事务历史冻结；无修改审计的BOM/路线硬删除需FULL。四项业务待确认按临时规则保留，详见最终报告。
- 当前会话不能自行切换主模型；未声称已切换到用户指定 GPT-5.6 Sol High。

### 等待用户确认
- 无。本阶段用户已授权直接编码、迁移、测试和验证。
- 业务待确认（不阻塞）：P+1/M+0继续异常；V保持中性原始值；关闭订单保留；事业部采用已存在客户主责映射。

### 下一步
1. Phase 4已完成，恢复时先阅读最终报告，不重新实现。
2. 用户启动Phase 5后确认四项业务默认展示并开发标准PMC只读页面。
3. 后续维护按现有内部API执行同步；无调度器，硬删除通过人工FULL校正。

### 恢复执行说明
先读 AGENTS.md、kdos-form-platform/SKILL.md、本节，再执行 git status / git diff --stat，继续已有实现；不要重做 Phase 1—3，不覆盖用户已有修改，不删除 Python Oracle。

### Phase 4 实现与第一组验证（2026-10-07）
- [x] 新增 `1722920082000-PmcRdProgress.ts`：当前快照/批次两表、5个实用查询索引、租户业务唯一键、RUNNING唯一索引、RLS。
- [x] TypeScript Calculator 迁移 Phase 3 的所有实际规则、原 reasonCode/reasonText/ITEM_PLANT_MATCH，允许完成状态倒退；没有增加工艺BOM字段。
- [x] 独立 `pmc_rd_progress_reader.py` 只读取原始事实，复用共享MSSQLDatabase；源表时间均为datetime2，按各表LastModifiedDate+UUID keyset/2分钟overlap扫描，含标准路线反查、OPERATION、客户/部门以及BOM有效期边界。
- [x] `PmcRdProgressApplicationService`：租户session advisory lock、崩溃RUNNING恢复、单事务250行JSON recordset批量UPSERT、内容hash、逐行/批次审计、失败回滚且水位不推进、保留软失效记录。
- [x] 注册 `pmc-rd-progress` / planning资源，字段只读，read权限遵循原 `resource:*:read`；查询复用平台字段权限/筛选/数据范围。
- [x] API：`/pmc/reports/rd-progress/items`、`items/:id`、`summary`、`orders`、`sync-status`；内部token+tenant的 `/internal/pmc/rd-progress/sync`。
- [x] 37组共用 JSON Oracle fixtures；62项API定向测试、原27项Python+新增6项适配器/fixtures测试通过；API typecheck/build通过，lint已修复未使用import，继续总体验证。
- [x] 原始全量采集观察时间 `2026-10-07 09:09:36.645056`（E10）：2539订单/17625行；Python与TS逐行20个字段对比0差异。
- [x] 该采集状态数量：NOT_APPLICABLE=834、NOT_STARTED=2979、DESIGN_IN_PROGRESS=0、WAITING_ROUTING=2721、ROUTING_IN_PROGRESS=4、COMPLETE=11081、ABNORMAL=6。
- [x] 确认源库snapshot_isolation_state=0、RCSI=true；不修改源库配置。`sourceSnapshotAt`明确是源库观察/游标截止时点，不能声称是时间旅行快照。全量Oracle比较复用同一采集事实，禁止对比两次实时读取后宣称完全相同时点。
- [x] 备份脚本已完成，结果位于ignored `data/pmc-rd-validation/backup-result.log`；正式数据库仍未应用新migration、未执行研发FULL。
- [ ] 隔离库 `pmc_rd_phase4_test_20261007` 已复制现有schema及必要用户/组织/映射，正在测试真实migration、FULL重放、倒退、分块回滚、软失效和非owner RLS。
- [ ] API全量/Contracts/Web兼容检查、最终构建、正式migration与部署、真实FULL/INCREMENTAL和最终验收报告。

下一步：先修正隔离集成测试发现的真实问题，再执行已授权的正式迁移/部署/真实同步；不要把当前仅本地实现表述为已交付。

### Phase 4 隔离验收与部署准备（2026-10-07）
- [x] 隔离PostgreSQL真实测试PASS（报告：ignored `data/pmc-rd-validation/integration-report.json`）：migration、17625行FULL、17625行全未变重放、INCREMENTAL、两种状态倒退、第二分块失败原子回滚/水位不推进、软失效/重新激活、同订单同品号不同源行分别保存、字段/表权限、CUSTOM/OWN范围、A/B租户和真实非owner RLS。
- [x] API全量：82 suites / 680 tests passed，另1 skipped；Contracts 22 tests passed，Web typecheck通过。首次全量测试识别新资源缺少聚合测试注册，已补充provider注册并重新通过。
- [x] API源datetime响应使用六位微秒墙上时间文本；统一筛选/导出绑定明确上海时区，避免运行机器UTC造成8小时偏移。
- [x] 平台筛选/导出provider设置租户事务上下文，动作数据范围保留read/export区别；不另写Excel导出逻辑。
- [x] 新增高精度游标不回退保护，GUID同时间排序直接采用SQL Server比较，不自行猜UUID排序。
- [x] 备份完成：`four_department_tracker_20261007_091204.backup` SHA256 `dd413dc40d2f595e215868ee54f447317ad32a3f916a75c2aff53af644543761`；`kdos_20261007_091204.backup` SHA256 `402b84c38ac2a51c750b74691261db5ad0c997be366809126fc92529a4ad81aa`；uploads SHA256 `089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`，均pg_restore目录验证成功。
- [x] 更新架构、安全、集成、runbook和专属 `docs/pmc-rd-progress.md`；明确源RCSI观察限制、无修改审计的BOM/路线硬删除需FULL校正、无新增定时器。
- [ ] 工作区源码/配置变更需要按标准deploy.sh提交后部署（脚本拒绝未提交源码）。用户未要求Git自行管理；只提交本任务源码和Phase3前置文件，不包含私有data、凭据或快照。
- [ ] 迁移与部署前再次确认结构仅新增PMC两表、同步SQL独立候选范围和源观察时点/候选数，随后正式迁移、上线与真实FULL/INCREMENTAL核验。

### Phase 4 最终回归复核
- [x] 标准导出专项2项通过，验证export操作权限、隐藏字段裁剪和租户RLS执行器；UTF8分块读取专项2项通过，防止中文跨stdout chunk损坏。
- [x] 全仓其他package测试已执行；Web初轮180/181通过，营销页面旧5秒超时；与构建并发后的API复跑发生主计划Spreadsheet旧5秒超时（此前完整680项通过）。不改无关业务代码，现以较宽运行时超时/API单进程、Web单worker复核。
- [x] 新实现不更改React源码，不改E10、主订单同步、rd水位与查重、不增加Redis/队列/历史表、不发企业微信。
- [ ] 最终测试完成后按标准部署脚本上线，再通过正式运行事实逐行比较Oracle与落库结果。

### Phase 4 上线前最后核对
- [x] API最终全量：84 suites / 684 tests passed（另1 suite / 1 test skipped），运行时单进程15秒测试超时复核，未更改测试业务断言。
- [x] API/Contracts/Web typecheck、lint、build通过；Web仅既有Fast Refresh与大chunk提示，本机Node22与声明Node24的提示保留，部署镜像使用Node24。
- [x] 上线前E10只读核对 `sourceSnapshotAt=2026-10-07 09:23:58.972811`：2540订单/17627行；独立候选SQL仍为CreateDate OR LastModifiedDate自2026-09-01。
- [x] 源码/配置边界审查与git diff --check通过：迁移仅新建PMC专属两表，源SQL只读，正式状态保持Oracle一致，源库配置未改，无删除旧业务数据操作。
- [ ] Web单worker全量回归即将完成；随后提交并标准构建→migration→deploy→healthcheck→正式FULL/INCREMENTAL及逐行Oracle验收。

### Phase 4 正式上线进行中
- [x] Web单worker/运行时15秒超时完整回归：28 files / 181 tests全部通过；失败复核已结束，未修改既有业务测试逻辑。
- [x] API最终完整684 passed、Python34 passed（含37共用fixtures）、Contracts22 passed，其余工作区测试已执行。
- [x] 代码提交 `4dcf121`，34文件，含保留的Phase3前置工具；未提交任何data、凭据、源快照、业务图片，没有push。
- [x] API/Web Node24正式镜像构建成功（SHA=`4dcf121`）。
- [ ] 正在执行标准 `scripts/migrate.sh`（会再次备份后只应用待执行新migration）；完成后运行 `scripts/deploy.sh all` / healthcheck。
- [ ] 上线后正式FULL → 捕获事实与PostgreSQL实际查询逐行Oracle回归 → 真实INCREMENTAL与内部HTTP接口、权限状态和性能核验。

### Phase 4 迁移与CLOSE原始值补全
- [x] 标准migrate脚本成功：`PmcRdProgress1722920082000` 已应用，正式迁移数量80→81，新两表已存在；尚未执行正式FULL。
- [x] 部署前复核现有 `data-operations/order-sync/sync.py` / `sources.json` 发现已稳定读取 `SALES_ORDER_DOC.[CLOSE]`。为避免仅保留ApproveStatus遗漏关闭资料，新增中性 `orderCloseRaw` 字段及 `orderClose` 筛选；仍不解释状态、不排除任何关闭单。
- [x] 不改已执行迁移历史，新增 `1722920083000-PmcRdProgressOrderCloseRaw.ts`，仅给新快照表增加一列；Calculator最终状态规则完全不变。
- [ ] 补充迁移/字段专项测试、隔离库验证、构建提交后应用补充迁移，再部署与正式同步。

### Phase 4 补充字段验证完成
- [x] CLOSE原始值补充迁移及字段专项通过；PMC定向5 suites / 68 tests通过，Python34项通过，隔离库重新执行真实集成PASS（总耗时12.184秒）。
- [x] 补充字段后的API/Contracts/Web typecheck、lint、build通过；代码提交 `5d2faa1`，最终API/Web Node24镜像构建完成。
- [ ] 正在标准migrate再次备份并应用仅新快照表增加一列的 `1722920083000`，随后部署同SHA镜像。
- [ ] 正式FULL、PostgreSQL逐行Oracle核验及真实INCREMENTAL尚待执行，当前不得标为已交付。

### Phase 4 生产部署已完成，正式同步验收开始
- [x] 最终API全量复核：84 suites / 686 tests passed，另1 suite / 1 test skipped，30.903秒。
- [x] 标准备份成功并验证目录：`four_department_tracker_20261007_093425.backup` SHA256 `9779ccf72d710013686b747014584bee26d259c897b90001b7cfd5a77c67171c`；`kdos_20261007_093425.backup` SHA256 `63e8d60286485c4b2bd86cea889fa9bebfb7bec03944c1740cc77c71cfd5449a`；uploads SHA256 `089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`。
- [x] 补充migration成功，正式库迁移81→82；只新增新快照CLOSE原始值列。
- [x] 标准 `scripts/deploy.sh all`成功，Repository HEAD / Web / API均为 `5d2faa1`，CONSISTENT；没有push。
- [x] 隔离库3行变化增量Application Command耗时0.181秒，无变更0.136秒（不包含E10读取，不能冒充端到端）。
- [ ] 正在生产执行FULL并捕获事实，随后检查真实PostgreSQL全量、样本、审计、Oracle0差异，再真实INCREMENTAL及内部HTTP成功调用。
- [ ] 验收报告草稿已创建 `outputs/PMC研发进度Phase4验收报告.md`；完成所有生产验证后才标记PASS。

### Phase 4 真实FULL与全量一致性已通过
- [x] 正式FULL：sourceSnapshotAt=2026-10-07 09:37:32.281503，2544订单/17644行；created=17644、updated=0、unchanged=0、failed=0、abnormal=6；源读取15.775秒、端到端25.876秒。
- [x] 同一捕获事实上的Python vs TypeScript、Python vs PostgreSQL正式QueryService结果，均17644行×20关键字段、差异0；四指定样本及12额外真实样本全部一致，新增审计17644条/批次审计1条。
- [x] 状态数量：{"NOT_APPLICABLE": 835, "NOT_STARTED": 2995, "DESIGN_IN_PROGRESS": 0, "WAITING_ROUTING": 2722, "ROUTING_IN_PROGRESS": 4, "COMPLETE": 11082, "ABNORMAL": 6}；总体完成率65.93%，设计82.15%，路线66.33%。
- [x] 正式INCREMENTAL第一次：rowsRead=31，created=0、updated=0、unchanged=31、failed=0；源读取17.857秒、端到端18.059秒，逐行Oracle差异0。
- [x] 标准healthcheck通过；真实匿名GET=401，内部错误token/tenant=401，合法凭据但缺mode=400；OpenAPI已出现所有6条新路由。
- [x] 实际查询计划使用订单/状态/品号索引，执行0.132/0.163/0.300ms；新两表RLS均开启。
- [ ] 第二次真实增量及内部HTTP成功同步、最终验收记录与隔离测试库移除待完成。

### Phase 4 最终交付记录（2026-10-07）
当前状态：已完成。Phase 4：PASS。
最终报告：`outputs/PMC研发进度Phase4验收报告.md`。
- [x] 正式内部HTTP INCREMENTAL成功（201）：sourceSnapshotAt=2026-10-07 09:39:21.889206，rowsRead=41、created=3、updated=18、unchanged=20、failed=0，端到端25.659秒；少量变化是真实E10自然生产变化，不是人为写源库。
- [x] 第二次无内容变化正式CLI增量：12.936秒，31行全未变，Oracle逐行差异0。
- [x] 最终查询确认2545订单/17647行；四指定及12额外样本仍一致；审计created=17647、updated=18、成功batch=4。
- [x] 最终部署版本检查Repository/Web/API均5d2faa1，CONSISTENT；标准健康检查通过。
- [x] 自建临时隔离库pmc_rd_phase4_test_20261007已移除；未删除正式数据，无额外永久数据库/角色。
- [x] 测试、模型、迁移、索引、FULL/INCREMENTAL、水位、源观察一致性、Calculator、权限、API、Oracle0差异和性能均已写入最终报告。
- [x] git diff --check通过，源码全部提交；仅outputs最终记录未提交，没有push。
当前仍存在的问题：四个业务项维持安全临时规则；源RCSI限制与无审计硬删除需FULL；无React页面/调度器（本阶段范围）；普通用户带JWT的线上成功GET未单独运行，真实QueryService与自动权限/RLS测试已通过。
等待用户确认：无Phase 4阻塞；后续Phase 5页面默认展示规则由业务确认。
下一步：用户启动Phase 5后接入既有数据/API；不要重新分析或重做已通过的Phase 4实现。

## 设备大屏未填报明细与六表Excel导出（2026-10-07）

### 任务
任务名称：设备大屏未填报明细与六表Excel导出。
任务目标：复用现有dashboard SQL、筛选与权限，添加未填报设备明细及六表全部匹配数据xlsx导出，不重构、不改业务公式，最终部署。
当前状态：已完成。
最后更新时间：2026-10-07（Asia/Shanghai）。

### 当前阶段
已阅读equipment Query/Application/Controller/types、EquipmentPages/测试、权限scope、现有ExcelJS导出和公共下载、平台表导出；现有聚合大屏未注册独立记录来源，最小扩展现有EquipmentExportService，六表共享列规格和一个写表方法。
当前子任务：代码、测试、备份部署、健康检查、原口径全字段比较、六表Excel及租户审计验收均完成。

### 已完成
- [x] 阅读项目AGENTS、kdos-form-platform技能及架构/安全/运维边界，检查Git状态。
- [x] 保留上一任务未提交outputs记录；不覆盖PMC研发进度代码或报告。
- [x] 确认统计口径：active+monitored设备，所选区间windowEnd当天没有active填报记录才未填报；零运行仍已填报。
- [x] 设计：在同一dashboard SQL的asset_state上投影unreportedEquipmentRows，和KPI/分组统计共享monitored/daily_reports；导出调用同一dashboard读模型，无分页截断。

### 正在进行
- [x] 代码与自动化测试。

### 待完成
- [x] 定向/阶段/完整回归、typecheck/lint/build。
- [x] 标准备份、无需迁移确认、部署、健康检查与线上核验。
- [x] 验收报告（含13项清单和人工步骤）。

### 修改文件
- 最终14个源码/测试/文档文件，提交f8b7387/743cad7；完整清单见outputs/设备大屏明细与Excel导出验收报告.md，另修改进度/报告。

### 数据库Migration
- 无需数据库结构改动；新增数据均复用equipment_assets/equipment_responsibles/users。

### 新增或修改测试
- 计划：10/7数量一致、全填报、事业部/部门筛选、六表导出头/类型/空值/文件名/100行不受20分页限制、权限、按钮交互。

### 已运行测试
- API699/Contracts22通过；Web设备16通过，完整184/185通过且唯一波动文件独立34/34复核通过；真实SQL/XLSX及部署验收PASS。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。
- 现有dashboard仅支持事业部数据授权，含不支持部门规则的权限配置按原helper失败关闭，不扩大授权。
- 公共平台导出当前将展示数值格式化为字符串，不改公共框架以免影响无关模块；复用已有设备ExcelJS服务导出聚合视图，数值/百分比以真实Excel类型输出。

### 等待用户确认
- 无，已授权完整实现与部署。

### 下一步
1. 本任务已完成，恢复时读取最终报告，不重新实现。
2. 按报告人工验收授权账号的页面与下载。
3. 有现有E2E凭据后可运行保留的线上登录态Playwright；无需创建账号或更改生产权限。

### 恢复执行说明
读取AGENTS/技能/本节，git status与git diff --stat，检查当前修改，从下一步首个未完事项继续；不要重新实现Phase4或覆盖已有outputs。

### 设备大屏实现与首组验收
- [x] 同一dashboard SQL的asset_state投影未填报明细；责任人实时关联equipment_responsibles/users，新字段服从字段read权限且不因隐藏字段减少记录数量。
- [x] 六表共享contracts导出规格与EquipmentExportService.dashboardExport；复用ExcelJS/原设备workbook样式、公共downloadApiFile/Button/KdosDataTable，无新依赖/迁移，不改其他统计公式。
- [x] 导出复用dashboard方法，read ∩ export数据范围，字段白名单与权限裁剪，后台拒绝无export权限和空数据。
- [x] 六按钮统一标题右侧/loading/重复点击锁；筛选URL与dashboard完全共用，不传分页。
- [x] API设备专项7 suites / 70 tests通过；Contracts22通过，API/Web typecheck已通过。
- [x] 真实PostgreSQL临时表事务验收PASS：10/7/3、全填报0、事业部/部门筛选、0运行算已填、失效/无需填/其他租户排除、责任人、read/export范围交集、六表头与文件名、pageSize20导出100行。事务已rollback，未修改正式业务数据。
- [x] 修复Excel工作表名不允许斜杠（仅输出sheet名替换，不改页面标题），修复lint正则无用转义。
- [ ] Web交互测试复核中；之后完整API/Web/Contracts回归、构建、备份部署与线上核验。

### 设备大屏阶段验证通过，准备部署
- [x] Web设备16项通过，含六按钮、字段、相同筛选URL、禁用/loading/重复点击、失败消息、无权限隐藏与空表禁用；改用项目AntApp消息上下文确保React19显示。
- [x] API全量84 suites / 698 tests passed（另1 suite / 1 test skipped）；Contracts22通过；API/Web/Contracts类型检查、API/Web lint和生产构建通过（Web既有Fast Refresh/chunk提示保留）。
- [x] 临时表真实SQL增加日期/按月末口径和文件名验收后再次PASS；从未提交临时业务记录。
- [x] 两项设备Playwright用例因没有现有登录凭据明确skipped，未创建测试用户或修改生产权限；线上业务查询/Excel验证将使用同一已部署服务，并检查匿名HTTP401。
- [ ] Web单worker全量回归与标准备份正在执行；最终通过后提交本任务源码并部署API/Web，保留上一任务outputs记录。

### 设备大屏上线准备检查
- [x] 本任务13个源码/测试/文档文件提交为f8b7387；上一任务outputs未纳入本提交，未push。
- [x] 标準备份20261007_125638完成并经pg_restore目录验证：
- f4c989952ea0638644e2eeb05c4b0ecefae4d05aaa7f160488d9eb792e0ae41c  data/backups/four_department_tracker_20261007_125638.backup
- cdb8448257943a72a9b221bfdf90c5f58517634ec2e8d6df767e9cc014d3c8f7  data/backups/kdos_20261007_125638.backup
- 089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533  data/backups/uploads_20261007_125638.tar.gz
- [x] 升级前正式dashboard基线（2026-10-06）：396应填/179已填/217未填，稼动率明细396行。
- [ ] 最终Node24镜像构建和Web全量回归进行中；通过后部署、全部旧字段基线对照及真实六表XLSX核验。

### 设备大屏镜像与迁移检查
- [x] 最终API/Web Node24镜像构建成功，版本f8b7387。
- [x] 正式库migration:show为82 applied / 0 pending；本需求无新增migration，无seed。
- [ ] Web全量回归尚在运行，未通过前不切换服务；标准备份已成功，部署后执行原有dashboard全字段对比和六份Excel线上服务验收。

### 设备大屏完整回归复核
- [x] Web完整28文件/185项已执行：184通过，唯一失败为未修改的MasterPlanPages.spec.tsx Case3（错误提示后立即断言loading类已移除的异步时序）；本需求设备16项全部通过。
- [ ] 正在独立复核该主计划测试文件；不更改无关业务代码或测试断言，不把初次完整回归描述为185全通过。

### 设备大屏回归复核结束，开始生产部署
- [x] 独立MasterPlanPages.spec.tsx复核34/34全部通过（71.40秒），无代码/断言改动；原完整Web184/185通过+失败文件复核通过，明确保留首轮波动记录。
- [x] API698/Contracts22/Web设备16与真实SQL+XLSX验收均通过；备份与最终镜像已准备，migration无pending。
- [ ] 正在标准scripts/deploy.sh all部署f8b7387；随后healthcheck、旧口径全字段比较、396行明细完整Excel及六表实际服务验收。

### 设备大屏首次上线验收与审计租户补充
- [x] 首次上线f8b7387健康/版本一致，原有dashboard所有字段与基线完全一致；六份真实xlsx217/5/20/5/20/396行，未填报统计=明细=Excel217，pageSize20没有截断。
- [x] 新导出接口匿名401，OpenAPI路由已注册。
- [ ] 审计复核发现原设备private audit助手不填tenantId，新导出应显式写租户；仅修改本次新增recordDashboardExport，补专属测试，不修改旧助手和已有审计。首次六条审计保留原记录，最终重新验收使用独立requestId。
- [ ] 该补充修复测试/备份/重新部署及最终报告待完成，不能在当前记录中直接标最终交付完成。

### 设备大屏审计租户修复验证与重新部署
- [x] 仅新recordDashboardExport显式manager.save tenantId，旧audit助手及已有记录保持不变；新增测试验证租户和export权限。
- [x] 最终API84 suites/699 passed（1 skipped），typecheck/lint/build通过；代码743cad7，Node24 API/Web最终镜像成功。
- [x] 标准最终备份20261007_130645已验证，SHA256见data/equipment-dashboard-validation/backup-final.log；无migration/seed。
- [ ] 正在部署743cad7，随后重新验收六份实际Excel和带tenant的六条导出审计，再更新最终报告与完成状态。

### 设备大屏最终交付（2026-10-07）
当前状态：已完成。最终报告：outputs/设备大屏明细与Excel导出验收报告.md。
- [x] 最终版本743cad7：Repository/Web/API一致，标准healthcheck通过，备份20261007_130645已校验，无migration/依赖/seed/push。
- [x] 2026-10-06正式查询396应填/179已填/217未填，未填报明细与Excel217；所有旧dashboard字段与升级前基线完全一致，运行/计划/稼动率公式未改。
- [x] 六xlsx实际217/5/20/5/20/396行，pageSize20不截断；文件重新读取校验成功，新导出tenant审计6条（KAINAN、独立equipment-online-final请求）。
- [x] 最终API699通过/1跳过；Contracts22，Web设备16通过；完整Web184/185通过，唯一无关异步时序波动文件独立34/34复核通过。
- [x] 类型/lint/build/Node24镜像与git diff --check通过，源码均已提交，工作区仅outputs最终记录。
仍存在的问题：缺现有E2E凭据，两项登录态Playwright skipped，普通JWT线上成功下载未单独运行；既有主计划测试存在独立复核已通过的时序波动。首轮旧助手产生的审计保持原样，最终新导出方法显式写tenant。
等待用户确认：无交付阻塞。
下一步：按报告第13节人工验收；后续沿用同源dashboard/列规格/导出方法，勿建立第二套判断口径。


## Knowledge Base / 知识库 Phase 1（2026-10-07）

### 任务
任务名称：知识库 Phase 1。
任务目标：独立 knowledge 模块，两级分类、文章工作副本/不可变发布快照、可信富文本、标签、ACL、私有附件、搜索、平台权限/表格、测试与正式部署。
当前状态：已正式部署，生产登录态验收待现有账号。
最后更新时间：2026-10-07 14:13 Asia/Shanghai。

### 当前阶段
当前阶段：开发、备份、正式迁移部署及健康/公开入口验收完成。
当前子任务：等待现有管理员/员工账号补充生产登录态业务验收。

### 已完成
- [x] 完整读取用户粘贴需求（2760行，原文件末尾为线上检查第9项），确认新任务取代已完成设备需求。
- [x] 读取已有进度和 git 状态；HEAD 743cad7，源码干净，仅先前任务 outputs 待提交，全部保留。

### 正在进行
- [x] 核对真实运行边界、权限/存储/表格/组织成员与迁移机制，实施最小复用。

### 待完成
- [x] migration / contracts / 授权 / application / query / controller / filter source。
- [x] Portal / 路由 / 分类 / 编辑阅读 / 私有附件 / 管理表。
- [x] 后端、前端和真实数据库测试（含RLS、EXPLAIN、中文搜索、权限隔离）。
- [x] 自动验证、标准双库/uploads备份、迁移、提交、标准部署、健康及线上公开入口/安全核验。
- [ ] 生产管理员与员工登录态业务验收（缺现有测试账号）。
- [x] 验收报告 outputs/知识库Phase1验收报告.md，含明确待验范围。

### 修改文件
- outputs/CODEX_PROGRESS.md（新增本任务恢复入口，保留历史）。

### 数据库 Migration
- 1722920084000-KnowledgeBasePhaseOne.ts，已正式执行，7表/pg_trgm/RLS/GIN/HR根；不更改已应用迁移。

### 新增或修改测试
- 新增Knowledge API安全/权限、真实DB 52项、Web21项、Chrome3项、私有存储6项；详见验收报告。

### 已运行测试
测试名称：API全量、Web全量、其他workspace、真实DB、Chrome、typecheck/lint/build、部署健康/线上安全。
结果：API733通过/1跳过；Web206通过；DB52通过；Chrome3通过/1账号项跳过；其他全部通过；lint0错误/1既有警告。

### 当前已知问题
- [x] 新scope初轮10~14s：EXPLAIN证明JIT占12.36s；采用JSON稳定复合键关联及报告只读事务内jit=off，最终799ms/EXPLAIN738.693ms；无索引/全局配置变化。
- LocalObjectStorage默认返回 /uploads 公共路径；知识附件必须在该实现做最小私有扩展，不能暴露storage key或公共URL。
- 不假定线上登录凭据可用；不得伪造JWT、重置生产密码或改变生产权限用于验收。

### 等待用户确认
- 无；用户授权实施、迁移和正式部署。

### 下一步
1. 获得现有管理员与员工测试账号后，通过正式前端完成分类创建、草稿、上传、发布及员工读取。
2. 更新验收报告及本进度状态；不要重做已经完成的实现、迁移或测试。

### 恢复执行说明
项目AGENTS → .agents/skills/kdos-form-platform/SKILL.md → 本节 → git status / git diff --stat → 检查半成品 → 从下一步首个未完事项继续。不要重做此前PMC和设备任务，不覆盖原outputs。

### Knowledge 后端首轮实现（未验证，不是交付完成）
- [x] 新增contracts知识资源/字段/状态协议；注册knowledge管理员模块，最小补齐Auth Portal白名单rd/knowledge。
- [x] 新增1722920084000 migration：7张知识表，UUIDv7/复合tenant FK/RLS/GIN，幂等HR根分类，不变更已应用migration。
- [x] Application/Query/Access/Controller/FilterSource首版：工作副本、不可变发布快照、ACL、版本、审计、中文trigram搜索和受控附件。
- [x] ObjectStorage兼容private参数，文件在uploads/.private内备份但无公共URL；API静态与Nginx拒绝私有路径。
- [x] 筛选平台buildScope增加Promise兼容（现有sync不变），用于知识ACL按现有组织成员helper即时解析；需回归平台筛选/导出。
- [ ] 首轮API类型检查中。尚未迁移正式库、尚未部署。
- [ ] 需要真实库验证原始SQL参数类型、历史权限、发布状态、字段裁剪和附件事务，前端/测试尚未实现。
已知复用注意：通用buildDataScopeClause存在planning模块管理员短路，知识入口清除该moduleAdminCodes后复用通用规则，避免跨模块越权；不修改其他模块行为。
下一步：先修复首轮类型错误，完成前端和专属测试；真实隔离库验收后再正式备份/迁移/部署。

### Knowledge 第一组验证结果
- [x] API首组4 suites / 44 tests通过（正文安全、ACL/组织成员、平台注册和Portal顺序）；Contracts22通过；API/Web类型检查通过。
- [x] 真实隔离库knowledge_test_phase1_20261007验收38项PASS（data/knowledge-validation/database-third.json），含发布快照、工作副本隔离、四类ACL、附件历史、字段裁剪、tenant/RLS、标准筛选/导出、审计及自然planner使用GIN的EXPLAIN。该库是本任务创建的可清理测试库，未操作正式文章数据。
- [x] 前端首版Portal/路由/分类树/TipTap结构化编辑器/管理表/阅读历史/受控附件已实现，新增Web3个TipTap依赖（实际lock3.31.4，package.json三项^3.31.4）。
- [ ] 新增前端20项测试正在执行；误用pnpm test --路径触发Web全套并发，既有设备测试受资源竞争两项超时，后续用pnpm exec vitest run明确定向和单worker完整回归，不修改无关测试。
- [ ] 首版真实验收后补强历史访问需同时当前发布ACL与历史ACL、browse数据范围使用已发布字段而非工作字段；这些补强需重新真实库验收。
- [ ] API lint两处控制字符正则已改为字符码检测；Web目前0错误5个Fast Refresh警告（4个新增待整理，1个既有Portal）。
- [ ] 旧API镜像缺sharp libvips目录。隔离验收临时只读挂载主机同版libvips；正式新镜像必须完整验证sharp运行库，不依赖此临时挂载，不可未验证上线。
下一步：完成前端定向测试修复、补强安全边界/真实图片测试、完整回归和构建；随后标准备份、迁移、部署。正式库尚无knowledge迁移。

### Knowledge 搜索/安全补强与第二组验证
- [x] Web知识库20/20定向测试通过；API首组44通过。前端拆分共享helper以移除新增Fast Refresh告警，分类保存增加同步锁，编辑器防后台刷新覆盖草稿。
- [x] 管理表/候选/标准导出增加可选资源搜索谓词，知识源与普通首页共用knowledgeSearchClause，真实GIN列搜索覆盖标签；其他资源保持旧行为。标准label resolver可接收可信actor，知识分类按tenant批量解析。
- [x] 历史权限补强为当前发布完整read/category/data scope/ACL AND历史ACL；导出read范围ANDexport范围，普通browse数据范围使用发布快照字段。
- [x] 新API预检镜像实际Sharp PNG生成PASS（92bytes），无主机libvips临时挂载；旧镜像依赖问题通过全新frozen install构建解决，不新增API依赖。
- [x] 扩展真实隔离库验收目前47项PASS，含三入口索引搜索、导出交集、历史ACL收紧、组织角色立即撤权、真实PNG重编码/伪图拒绝、跨文章文件、审计失败回滚+存储补偿；新加并发409与字段写入校验需要最后再跑。
- [ ] 全量API/Web回归、lint正在执行；新DB测试runner一个候选union类型编译错误已改数组断言，等待build。
- [x] 新增docs/knowledge-base.md，更新Architecture/Security/Integration/Runbook真实边界，正式兼容主库不等于文档理想kdos库；不复制第二套schema。
正式migration/deploy仍未执行。下一步：全部验证通过，备份→正式migration→提交后的标准all部署→健康/线上核验；已请求现有测试账号，尚无回复，不伪造JWT或改生产权限。

### Knowledge 最终开发验证（正式部署前）
- [x] API完整87 suites通过，733 tests通过/1既有跳过；其他非Web workspace test全部通过。
- [x] Web全量30文件/206项通过（单worker、testTimeout15000）；知识库定向21项通过。初次默认5秒超时的既有设备DOM测试最终回归通过，不修改无关测试。
- [x] 真实隔离PostgreSQL 52项通过；七表UUIDv7/tenant/审计/version、自然planner GIN中文短词、分页100 vs全部4000导出验证通过。
- [x] Chrome知识库浏览器3项通过/1现有账号登录项跳过；这些测试拦截API，不冒充生产登录态验收。
- [x] 全workspace typecheck、lint（0错误/1既有Portal Fast Refresh警告）、build通过。
- [x] 编辑器发布失败保留已提交工作副本最新version；初始查询未完成禁用上传，防路由快速切换旧文章状态。
- [ ] 正式备份、migration084、部署、SHA一致、健康/公开入口线上检查尚未执行。
当前已知问题：未收到现有管理员/员工验收账号；不会伪造生产JWT、重置密码、调整权限或通过CLI创建正式二级分类/文章。
下一步：提交本需求源码→带SHA镜像构建→标准备份迁移→标准all部署→线上验证→清理本任务隔离测试库→验收报告。

### Knowledge 正式迁移、部署与线上核验（2026-10-07 14:13）
- [x] 源码44文件提交8ca9330，Node24 API/Web镜像build通过，最终镜像Sharp PNG92bytes实际运行PASS。
- [x] scripts/migrate.sh标准备份双库/uploads 20261007_140954；SHA256重新核验全部OK，备份完整路径/hash见验收报告。唯一pending084迁移成功，无seed。
- [x] scripts/deploy.sh all成功；Repository/Web/API均8ca93306f76619f2fc22a897ca9cc87d8632cbd0；scripts/healthcheck.sh通过，所有容器healthy。
- [x] 正式只读schema核验7表/RLS/审计、GIN、immutable trigger；唯一HR一级分类，无二级分类/文章/附件生产fixture。
- [x] 26线上检查通过：17知识操作匿名401、统一导出401、私有普通/编码404、路由与编译入口/OpenAPI、SHA一致。
- [x] 实际私有storage canary无public URL，API/Nginx各普通/编码路径404；canary已清理。
- [x] 部署资产Chrome 3通过/1账号项跳过；接口fixture全部拦截，未伪造生产身份。
- [x] 本任务隔离测试库knowledge_test_phase1_20261007已清理；正式数据、用户/权限不改。
- [x] 验收报告：outputs/知识库Phase1验收报告.md；模块文档docs/knowledge-base.md。
- [ ] 唯一待验：现有管理员/普通员工生产登录态创建分类、文章草稿、上传附件、发布与员工阅读。未收到账号；不会伪造JWT/重置密码/改变权限来测试，因此状态不标“全部已完成”。
修改文件：详见验收报告44文件清单及本进度；新增Web三项TipTap^3.31.4依赖，API无新增依赖。
下一步（恢复唯一入口）：获得现有测试账号→按验收报告人工步骤完成生产登录态验证→补记结果并将本任务状态改为已完成。已部署URL http://192.168.1.249:15172/knowledge。

## PostgreSQL 本机回环访问（2026-10-07）

任务目标：只为 knplan PostgreSQL 增加 `127.0.0.1:15433:5432` 映射，保留历史数据与 API 容器内连接。
当前状态：已完成并验证。

已完成：
- [x] Compose 标签确认实际配置 `/data/automation/code/work/PMC/knweb/compose.yaml`，project `knplan`、service `postgres`。
- [x] 修改前检查宿主监听与Docker发布端口均显示15433空闲。15432冲突处理遵循用户新指示：不修改/停止Smart Stock，knweb使用15433。
- [x] 修改前价格基线和重建后宿主直连SQL均为 `1078|1078|13|98|2026-05-06|2026-09-30`，过滤tenant KAINAN、source MYSTEEL。
- [x] 修改前标准备份：`data/backups/four_department_tracker_20261007_174001.backup`、`kdos_20261007_174001.backup`、`uploads_20261007_174001.tar.gz`；SHA256已记在终端执行记录。Postgres备份有效性由脚本pg_restore --list核验。
- [x] Compose effective config只有目标 `127.0.0.1:15433:5432`；image postgres:18、volume源 `data/postgres`→`/var/lib/postgresql`、数据库环境与network/healthcheck保持原值；API DATABASE_HOST/PORT仍为postgres/5432。
- [x] 更新命令：`docker compose up -d --no-deps postgres`。仅knplan PostgreSQL容器重建，仍挂载原bind mount；没有执行down、volume删除或prune命令。
- [x] Docker最终端口为 `127.0.0.1:15433->5432/tcp`；ss仅监听 `127.0.0.1:15433`，无wildcard IPv4/IPv6监听。
- [x] Ubuntu宿主机Node pg客户端用项目既有 `.env` 安全读取凭据，通过127.0.0.1:15433连为 `four_department_tracker` / `knplan` 并成功执行查询；未打印数据库密码。
- [x] Knweb API从容器内部到postgres:5432 TCP成功，env为postgres/5432；API/Postgres/Web均healthy；标准healthcheck通过。
- [x] Smart Stock TimescaleDB保持原容器和原`0.0.0.0:15432`发布不变。
- [x] `git diff --check`及Compose invariants通过。

修改文件：`compose.yaml`仅新增postgres端口mapping；`outputs/CODEX_PROGRESS.md`任务记录。
异常：无。15432继续由Smart Stock使用；本任务不改变其监听。

下一步：无。

## Phase 5 - PMC研发进度正式页面

任务目标：PMC → 报表 → 研发进度，复用Phase4 items/summary/orders/sync-status/标准导出及平台权限，开发只读正式页面并测试、部署、真实样本验收。
当前状态：已完成。
当前阶段：开发、测试、备份、正式部署、生产页面与下载文件验收全部通过。
最后更新时间：2026-10-07 18:55（Asia/Shanghai）。
已完成：
- [x] 完整读取2074行Phase5需求、Phase4验收报告及Phase4最终进度。
- [x] 实际HEAD 8ca9330；已有localhost15433 Compose改动与历史outputs保留，不回退至5d2faa1。
- [x] 确認Phase4 API默认100分页、可选50/100/200/500/1000；按现有标准实现（需求50和20为建议）。
- [x] 状态/完成率/未完成原因全部来自服务端，不按BOM/路线字段或百分比推导。
- [x] 已请求现有生产PMC测试账号的安全凭据位置；不中止独立开发，不伪造生产JWT或改权限。
实现决定：新增/pmc/reports/rd-progress路由和PMC“报表”树组，KdosDataTable/KdosChart/React Query/URL参数。核心API参数通过导出context传递；Phase4当前通用导出没有消费这组参数，需要证明问题并最小衔接同一QueryService，不改Calculator/同步。
正在进行：前端状态meta、筛选、KPI、图表、明细、订单Drawer与标准导出同源衔接。
待完成：自动化测试、真实当前数据/指定样本、lint/typecheck/build、标准备份/必要API+Web部署/健康、Phase5验收报告。
数据库Migration：无计划。
新增npm依赖：无计划。
修改文件：待实现；不覆盖既有Compose localhost改动。
下一步：完成页面与必要导出契约适配→专项测试→全量回归/构建→正式部署/样本验收。

### Phase 5 首组开发与验证
- [x] 正式页面/PMC报表菜单/直接路由read保护、六KPI与三项环节指标、七状态图表、核心/URL/标准高级筛选、标准分页/列偏好、订单Drawer/品项Modal已实现。
- [x] 状态标签集中复用contract字典；原始V不翻译，原因/比例/订单状态直接使用API。E10墙钟源时间不经UTC转换。
- [x] 先新增测试复现标准导出忽略context问题，再增加资源printRows薄适配器复用QueryService.list；read与export范围强制取交集，无算法或同步改动。
- [x] API PMC5 suites/72 tests通过，含401行跨3批完整Excel、业务筛选/高级筛选/排序、tenant与字段权限、选中打印范围。Web15项专项通过，覆盖分页回第一页、URL、API错误与Drawer。
- [x] 现有账号E2E登录/只读权限验证通过；真实summary为2545订单/17647品项、65.92%、6异常，四样本API状态符合要求。敏感信息仅运行时读取，未记录账号/token/密码。
- [ ] 尚待最后全量回归、build、备份部署、Chrome正式页面业务/导出验收。
已知环境限制：凭据指定外部HTTPS地址本机TLS连接失败；本机同一生产15172端口健康，使用它进行本次E2E，不修改凭据文件或系统入口配置。
数据库Migration：无。新增依赖：无。HEAD现为用户提交6c1f025，已含之前Compose localhost15433，本任务不重复修改Compose。
下一步：全量自动化→构建/提交→标准备份→必要API+Web部署→现有账号实际Chrome验收与报告。

### Phase 5 全量验证与部署准备
- [x] 最终API全量87 suites/738 tests通过，1既有跳过；其他非Web workspace测试通过。PMC专项73项通过。
- [x] Web全量31文件/221项通过，含15个新增报表交互用例；lint/typecheck/build全workspace通过，0 lint error/1既有Portal告警。
- [x] 修复报表标准导出源时间附加上海时区，客户名称空值在授权时回退编码，新增真实workbook跨日回归。
- [x] 标准备份20261007_182625：legacy/kdos/uploads均成功，脚本pg_restore --list通过，hash见最终验收报告。
- [ ] Chrome预验收中：已验证真实登录/PMC菜单/汇总/默认分页；正在验证四样本和详情。
- [ ] 提交并scripts/deploy.sh all（后端只部署context/export/time薄适配，Calculator/E10同步不改），随后生产Chrome全套与健康。
最终源码范围：PMC报表新目录、App导航、KdosDataTable external resetKey、PMC Query/export适配与测试、专属E2E运行器、docs/pmc-rd-progress.md。无新增migration/依赖，未修改账号权限/密码。
下一步：完成浏览器检查→源码提交→部署API/Web→现有账号生产全套E2E/健康→验收报告。

### Phase 5 正式上线与端到端验证
- [x] scripts/deploy.sh all已部署API/Web f8d0b0e；标准healthcheck通过，Postgres/API/Web均healthy，localhost15433仍保持原映射。
- [x] 正式Chrome页面/四样本/Drawer/筛选/URL/桌面尺寸/sticky/未认证401等8项通过；专项实际下载文件验收也已通过（导出5730行，页面100行）。
- [x] 真实Chrome事业四部筛选与Excel均为38行；生产只读QueryService验证147行read范围，summary与全部export一致，export/read不相交为0；跨tenant为0、字段/状态汇总裁剪、隐藏筛选和无export权限拒绝通过。该项为服务层受限actor测试，不伪造HTTP JWT或调整生产账户。
- [x] 异常6条按API原因展示；P+1/M+0不改写为系统错误。未映射17609条，遵循Phase4数据，未猜测事业部。
- [x] 修正E2E与公共按钮图标/中文间距匹配，以及Chrome网络响应body为空时读取实际下载文件；产品导出本身正常。E2E只记录PASS/FAIL与业务计数，不含身份/凭据。
- [ ] E2E验收修正独立提交后，按SHA一致规则重新部署同一产品代码；随后最终9项Chrome与健康检查、写最终报告/将本任务改已完成。
下一步：最终SHA一致与9项Chrome→验收报告outputs/PMC研发进度Phase5验收报告.md→更新本进度已完成。

### Phase 5 最终交付（2026-10-07 18:55）
状态：已完成 / Phase 5 PASS。
- [x] 源码f8d0b0e与E2E补强ce0d659均已提交；最后scripts/deploy.sh all成功，API/Web/HEAD ce0d659（完整SHA见验收报告）。无push。
- [x] 最终生产Chrome 9/9通过（1.1分钟）：真实登录/菜单/7状态总数/默认分页、四样本/订单Drawer、onlyIncomplete/实际文件5730行/异常6条/URL、组合筛选、1920/1366/sticky/分页、匿名401和实际账号字段裁剪。
- [x] Chrome事业部实际筛选与导出38行；真实受限actor服务层147行、read/export交集/跨tenant/隐藏字段/汇总/拒绝过滤和export验证通过，不伪造生产JWT。
- [x] API87 suites/738 tests + PMC73、Web31文件/221 tests + 最终专项15、其余workspace全部通过；lint/typecheck/build、git diff --check通过。仅既有API1跳过/Portal1lint warning/Vite大bundle/宿主Nodeengine提示。
- [x] 标准备份20261007_182625的双库/uploads已验证pg_restore --list与SHA256；無migration/seed、无新增依赖，无业务算法/ERP同步/角色权限/密码/Compose/.env修改。
- [x] 最终scripts/healthcheck.sh与scripts/deploy.sh check通过；PostgreSQL/API/Web均healthy，SHA一致；保留postgres:5432内部连接与原localhost15433。
- [x] 临时开发5173服务已停止、临时Vite代理文件删除；未修改正式网络配置或其它项目。
最终报告：outputs/PMC研发进度Phase5验收报告.md。
最终修改：16个源码/测试/文档文件（报告完整清单）+本进度/报告/5份不含凭据的验收JSON。源码无未提交修改，仅outputs记录。
数据库Migration：无。新增npm依赖：无。新增API：无（只复用既有接口，补齐标准导出context）。
已知限制：映射现有事业四部38条/未映射17609条，未补猜；外部HTTPS入口本机TLS/直连失败，本次用同一已部署系统localhost15172与LAN入口；标准Excel格式沿用平台。详见报告。
等待用户确认：无。下一步：无；用户可按报告人工步骤直接验收使用。其它历史任务待验事项仍保留，不误改为完成。

## Phase 5.1 - 研发进度页面与报表Skill标准优化

任务目标：仅拆分当前研发进度图表看板/明细报表、下拉与四周期筛选、合并现有Skill标准，并测试部署。
当前状态：已完成 / Phase 5.1 PASS。最后更新时间：2026-10-07 21:30（Asia/Shanghai）。
当前阶段：开发、测试、备份、部署、LAN生产Chrome与健康检查全部完成；历史阶段记录保留，最终恢复入口见末尾。
已完成：
- [x] 读取当前AGENTS、实际生效kdos-form-platform/skill-creator、Phase5进度和报告、当前页面/标准筛选/导出/Chrome配置。
- [x] 确认既有后端日期口径为orderDate包含式from/to；候选客户名称和divisionId来自平台接口；不修改后端算法/同步/权限。
实现决定：前端周期归一化为既有API参数，URL保留周期/值/Tab；共享已应用条件和标准表格筛选；默认及重置使用上海昨天。明细延迟显示、保持已访问表格状态；复用平台Excel，不新增依赖。
正在进行：页面与周期/候选下拉实现，合并已有Skill而非追加重复导出规范。
待完成：专项/回归测试、Chrome六场景及实际XLSX、typecheck/lint/build、备份/部署/健康、Phase5.1报告。
修改文件：待实现。数据库Migration：无。新增npm依赖：无。
新增或修改测试：将补周期/时区/Tab/下拉/导出用例并更新既有真实账号E2E。
已运行测试：尚未运行本阶段测试。
当前已知问题：既有外部HTTPS本机无法访问，继续同一生产localhost15172验收；未映射事业部保持原数据。
等待用户确认：无。
下一步：完成最小前端和Skill→专项回归→构建备份→正式部署与Chrome下载验收→报告。
恢复执行说明：读取适用AGENTS/Skill、本阶段进度，git status及diff后继续第一项未完成工作。

### Phase 5.1 首组实现与验证
- [x] 当前页面两个Tab已实现，默认图表无大明细；已访问明细表状态保留，订单Drawer/品项详情仍在明细。
- [x] 客户/事业部由权限受控候选API动态搜索；状态复用contract中文；未完成改为全部/只看未完成下拉。
- [x] 四周期只转换包含式orderDateFrom/To，URL恢复模式/值；默认/重置上海昨天，UTC日界与闰月通过专项测试。
- [x] Skill合并维度下拉/周期/联动中文规则，并扩充原导出条款；没有全局强制两个Tab。quick_validate通过。
- [x] Web专项23项、PMC后端5 suites/73项通过；全workspace typecheck/lint通过（既有Portal warning1项）。
- [ ] 全量Web回归及15项Chrome预验收正在运行；构建和标准备份开始。
修改文件：PmcRdProgressPage.tsx/spec、ReportFilterControls.tsx（新增）、rd-progress.period.ts（新增）、rd-progress.css、既有PMC E2E、docs/pmc-rd-progress.md、.agents/skills/kdos-form-platform/SKILL.md和outputs记录。
数据库Migration/新增依赖/新增API：均无。未修改Calculator/ERP同步/候选订单/账号密码或权限/Compose/env。
下一步：完成全量回归与真实Chrome→按标准提交备份部署→生产15项与健康→报告。

### Phase 5.1 全量验证与浏览器问题修正
- [x] Web全量31文件/229项通过；API全量87 suites/738项通过，1项既有跳过；其他workspace通过。
- [x] TZ=UTC实际运行上海边界测试通过；全workspace typecheck/lint/build通过。
- [x] 标准备份20261007_205113双库与uploads成功，pg_restore --list与SHA256核验，hash将记录最终报告。
- [x] 真实Chrome下载全年只看未完成：页面100/总数5361/Excel5361，业务表头、文件名正确。
- [x] 预验收发现快速KPI→Tab可能用旧handler恢复旧URL筛选；增加最新已应用URL引用保护，并在真实Chrome断言切换后rdStatus仍ABNORMAL。首个针对性浏览器复测通过。
- [ ] 继续八项针对性Chrome（含四周期/默认重置/事业部组合/布局）；随后完整15项预验收。
- [ ] 小修后专项测试、lint/build、提交部署和生产最终验收。
异常处理：只修本页切换竞态与E2E的Ant下拉点击/等待，未修改公共组件、业务算法或API。
下一步：完成浏览器复测→提交标准部署all（保持API/Web/HEAD SHA一致）→生产15项/健康→报告。

### Phase 5.1 日期/组合导出最终预验收
- [x] 默认/重置/按日/按月/按年/自定义实际操作通过；自定义输入遵循RangePicker开始日Tab→结束日Enter提交。
- [x] URL归一化不再resetFields重挂控件；按新URL立即提交本地已应用快照，避免BrowserRouter transition期间马上导出使用旧context。浏览器断言context包含全部新状态通过。
- [x] 事业部候选沿用真实“凯南 / 事业四部”组织路径，不另造label；客户动态搜索实际请求/选择通过。
- [x] 实际组合导出：事业四部+2026全年+未开始+只看未完成，页面3/总数3/Excel3，逐行事业部、中文状态、下单日期核对通过。
- [x] 所有针对性Chrome问题已闭环；现在运行完整15项Chrome预验收和最终专项/lint/build。
下一步：全部通过后提交8个源码/测试/文档/Skill文件，标准deploy all，不更改数据库或运行同步；生产15项及健康检查后报告。

### Phase 5.1 部署准备（2026-10-07 21:19）
- [x] 完整真实账号Chrome预验收15/15通过（2.2分钟），客户搜索/全部周期/Tab/快速筛选导出/四样本/Drawer/两尺寸/sticky/匿名401均覆盖。
- [x] 最终页面专项23/23通过；最终build、typecheck、lint、git diff --check及Skill quick_validate通过。全量回归记录Web229/API738/其他workspace全通过。
- [x] 只提交本轮8个源码/测试/文档/Skill文件；outputs历史记录保留，不提交凭据/env/测试浏览器产物，无push。
- [ ] 标准deploy all→生产15项Chrome与健康/SHA一致→Phase5.1验收报告/进度已完成。
数据库Migration：无，未执行seed或同步。新增依赖/API：无。
下一步：部署并完成生产验收。

### Phase 5.1 正式部署与健康
- [x] 提交ac84fe3完成（8个源码/测试/文档/Skill文件）；scripts/deploy.sh all成功，API/Web/Repository SHA一致。API业务代码缓存构建未变，仅更新版本标识；未重建Postgres。
- [x] 标准healthcheck通过，Postgres/API/Web均healthy；LAN15172健康。API仍postgres:5432，Postgres保留localhost15433及原volume。
- [x] 本任务临时Vite5173进程已停止、代理临时文件已删除；正式env/Compose未修改。
- [ ] LAN正式入口192.168.1.249:15172正在运行15项Chrome生产验收；全部通过后将报告及本阶段状态改已完成。
最终报告草稿：outputs/PMC研发进度Phase5.1验收报告.md（含8文件清单、备份hash、测试、Skill和人工步骤；当前明确为部署中，等待最终Chrome）。
下一步：生产15项Chrome→最终健康/版本核对→报告/进度已完成。

### Phase 5.1 生产Chrome定位修正
- [x] ac84fe3生产Chrome14/15通过；第15项实际Excel已通过，只在客户选项点击时选中Ant虚拟列表隐藏ARIA节点。
- [x] E2E定位改为实际.ant-select-item-option-content；LAN生产专项1/1（8.3秒）通过，产品代码没有改动。
- [ ] 测试定位独立提交后按统一SHA规则再次部署相同产品代码；最终LAN15项与健康/SHA核验。
下一步：最终版本部署与15项→报告/进度已完成。

### Phase 5.1 最终交付（2026-10-07 21:30）
状态：已完成 / Phase 5.1 PASS。
- [x] 23项验收条件全部满足：本页两个Tab、维度下拉/动态客户事业部、四周期/上海昨天默认与重置/URL、标准明细分页搜索筛选导出、KPI联动、全部匹配记录及权限保留、Skill合并无全局两个Tab。
- [x] 最终LAN生产Chrome15/15通过（1.4分钟）；真实登录/权限验证通过，不输出或保存凭据。默认10-06汇总67订单/323品项，数据及七状态与API一致。
- [x] 最终生产实际XLSX：2026全年只看未完成，页面100/总数5361/Excel5361；事业四部+2026全年+未开始+只看未完成，页面3/总数3/Excel3，逐行业务值及日期通过。动态客户搜索通过。
- [x] Web全量31文件/229项通过；最终专项23项通过；API全量87 suites/738项通过（1既有skip）、PMC专项73及其他workspace通过；TZ=UTC边界验证、typecheck/lint/build、Skill validator与diff检查通过。
- [x] 标准备份20261007_205113双库与uploads已验证；两次标准deploy all成功，最终Repository/API/Web均7c320bcecd863126b8792275f34284654839d6d6，标准healthcheck/版本check通过，三服务healthy。
- [x] 提交ac84fe3产品与7c320bc可见选项E2E定位；无push。产品代码最终只涉及8个源码/测试/文档/Skill文件；源码工作区干净，仅outputs验收记录。
- [x] 临时Vite5173/代理文件已清理；没有修改Compose/env/数据库/账号权限或密码，未迁移/seed/运行同步，Postgres原volume及localhost15433保留，API仍内部postgres:5432。
数据库Migration：无。新增npm依赖：无。新增API：无。
最终修改文件：PmcRdProgressPage.tsx/spec、ReportFilterControls.tsx（新增）、rd-progress.period.ts（新增）、rd-progress.css、既有PMC E2E、docs/pmc-rd-progress.md、.agents/skills/kdos-form-platform/SKILL.md；加本进度/验收报告/3个phase51业务验收JSON。完整清单见报告。
最终报告：outputs/PMC研发进度Phase5.1验收报告.md（含备份hash、23项完成说明、自动测试/生产Chrome、导出计数与人工步骤）。
已知限制：保留既有未映射事业部数据、外部HTTPS本机连通问题、KdosChart无点击事件接口及既有构建/lint提示；LAN当前运行环境已验证，详见报告。
等待用户确认：无。下一步：无，本阶段已交付；其他历史任务状态保持原记录。
恢复执行说明：本阶段无需继续开发；后续任务先读取适用AGENTS/Skill、本进度最终记录及git状态，不重做已交付功能。


## Phase 5.3 - 图表筛选补充与明细筛选精简
任务名称：Phase 5.3 图表筛选补充与明细筛选精简
任务目标：三项远程多选、共享条件、明细仅保留现有高级筛选、完整筛选导出及Skill两条规范。
当前状态：进行中；最后更新时间：2026-10-08。
当前阶段：实现；当前子任务：复用平台候选与FilterGroup，扩充现有高级筛选面板。
已完成：读取需求/规范/现有进度/Git；确认源码Phase5.1，无Phase5.2；确认候选API及IN多值支持。
正在进行：前端多选和公共面板最小扩展。
待完成：专项与全量测试、真实Chrome、build、备份部署、健康及报告。
修改文件：实现后列出。数据库Migration：无。新增npm依赖：无。新增API：无，沿用filterGroup。
新增或修改测试：将覆盖候选、多值OR/AND、面板、共享和导出。
已运行测试：本阶段尚未运行。当前已知问题：无新增阻塞。等待用户确认：无。
下一步：实现→专项验证→回归和真实Chrome→构建备份部署→生产验收报告。
恢复执行说明：读取AGENTS/适用Skill/本进度、git status及diff后继续下一步首个未完成项。

### Phase 5.3 首组验证（2026-10-08）
- [x] 前端页面27项、公共高级筛选9项通过；API专项79项（新增6项）及全量744项通过，1项既有跳过。
- [x] 多选直接复用FilterGroup，core和标准条件AND到API与平台导出；同名品名按稳定名称DISTINCT/IN。候选keyword+50、RLS/active/OWN与读字段权限测试通过。
- [x] 全workspace typecheck/lint/build通过；保留Portal lint warning与Vite大chunk提示。Skill Creator validator通过。
- [x] 标准备份20261008_085215完成，双库pg_restore --list及hash核验；无migration/seed/ERP同步。
- [x] Chrome预验收16/18通过；两项样本错误是active全集的往年候选在2026日期范围内无匹配，已用同一候选API按2026取正样本。组合页面2条、修改后3条、Excel3条通过；新增原完整多选组合实际Excel核验。
- [ ] Web最终单线程全量、四项Chrome复测；随后完整Chrome与正式部署。
当前问题：最初Web完整回归命令多传分隔符导致没有限制worker，产生资源竞争/超时；已只停止自己的测试进程，正确单worker重跑，不修改无关测试。
下一步：完成Chrome及全量回归→部署→生产验收和报告。

### Phase 5.3 最终预验收与部署准备
- [x] 最终真实账号Chrome预验收18/18通过（3.0分钟）；新增三项远程多选、KPI及图表canvas变化、OR/AND真实结果、Tab无常驻卡片、高级草稿取消/恢复/修改/重置、客户动态搜索通过。
- [x] 实际XLSX：完整多选组合页面2/Excel2；清订单/品号保留事业部+双状态后页面3/Excel3；全年未完成分页100/总数5361/Excel5361。
- [x] 最终typecheck/lint通过；正式build通过，backup20261008_085215保留且600权限。
- [ ] Web全量最后若干文件→只提交本轮12源码/测试/Skill/文档文件（不push）→标准deploy all→LAN生产18项及健康/SHA一致→报告。
等待用户确认：无。未修改账号、密码、权限或数据库业务数据。

### Phase 5.3 全量验证通过（准备正式部署）
- [x] Web全量31文件/233项全部通过（单worker，419.83秒）；公共表格18项、公共高级9项和其他模块回归通过。
- [x] API全量87 suites/744项通过，1既有skip；其他workspace通过。
- [x] 最终Chrome预验收18/18、typecheck/lint/build、Skill validator与git diff --check通过。
- [ ] 只提交本轮12源码/测试/文档/Skill文件，标准scripts/deploy.sh all（不改Compose/Postgres/DB）→生产Chrome18项及健康/SHA一致。

### Phase 5.3 部署执行
- [x] 本轮12文件提交c235856ecf91f7b14b189d2641a49541ff300c7c；不push；outputs历史与报告保留未提交，未提交env/凭据/浏览器产物。
- [ ] scripts/deploy.sh all正在构建更新API/Web，等待健康及一致版本。
- [x] Postgres容器基线b679ba44dd75，启动时间2026-10-07T09:41:29.703189989Z，原挂载data/postgres→/var/lib/postgresql；部署不更新Postgres。
下一步：部署返回成功→标准healthcheck及LAN生产18项→完整验收报告。

### Phase 5.3 正式部署成功（生产验收进行中）
- [x] scripts/deploy.sh all完成，API/Web/Repository均c235856，STATUS CONSISTENT；只重建API和Web。
- [x] API、Web、Postgres均healthy；API仍内部15173/tcp，Postgres仍127.0.0.1:15433→5432，原挂载及容器保留。
- [x] 本次临时Vite5173已停止、临时代理文件按apply_patch删除；正式配置未改。
- [ ] scripts/healthcheck.sh与LAN真实账号Chrome18项正在运行；完成后将状态改为已完成并发布报告。
下一步：生产18项与最终health/SHA核验→报告及进度已完成。

### Phase 5.3 生产清空交互复核
- [x] 生产首轮15/18通过；原组合2/2、修改组合3/3及全年未完成5361/5361实际Excel均通过，健康/版本一致。
- [ ] 订单多选“移除单项→清空→查询”用例未清空到URL（保留一项），另两项因max-failures未执行；暂不PASS。
- [ ] 将E2E清空由force点击改为hover显示清空图标、正常点击、断言UI标签0后再应用；重复两次四项复测，以区分测试命中与真实状态覆盖。
下一步：定位清空问题→必要的最小修复/验证→最终统一SHA部署和完整生产18项。

### Phase 5.3 清空测试修正闭环
- [x] 产品代码不变；清空测试改为真实hover→可见图标普通点击→标签0断言，生产相关四项重复两轮8/8通过（56.7秒）。
- [x] 先前force点击没有保证命中可见清空控件；未发现需要变更业务组件的问题。
- [ ] 只提交E2E定位修正，按项目统一SHA规则再次deploy all；随后完整LAN生产18项及健康/SHA核验。
下一步：最终版本部署→生产18项→报告PASS与进度已完成。

### Phase 5.3 最终统一版本部署
- [x] E2E清空修正提交77e7a8cf40a60f2b743ae7947fdf11aaeb1018a5（不push）；产品实现保持c235856。
- [x] 最终scripts/deploy.sh all成功；Web/API/Repository均77e7a8c，STATUS CONSISTENT；仍只更新API/Web。
- [ ] 最终LAN正式Chrome18项正在运行；健康及check复核执行后完成报告。
下一步：最终生产18项→健康/版本与Postgres保留确认→报告和进度已完成。

### Phase 5.3 最终交付（2026-10-08 09:11:13 Asia/Shanghai）
状态：已完成 / Phase 5.3 PASS。
- [x] 用户26项条件全部满足；候选/IN/业务查询/权限/日期/导出均复用现有平台，不改Calculator/E10/同步/DB模型。
- [x] 最终LAN生产Chrome18/18通过（1.9分钟）；实际组合导出2/2、修改后3/3、全年度未完成5361/5361（页面100）。
- [x] Web全量233、API全量744（1既有skip）、其他workspace、typecheck/lint/build、Skill validator与diff检查通过。
- [x] backup20261008_085215保留600权限；最终deploy all后Web/API/Repository完整SHA均77e7a8cf40a60f2b743ae7947fdf11aaeb1018a5。
- [x] 最终标准healthcheck与deploy check通过；API/Web/Postgres healthy，Postgres原容器b679ba44dd75、原挂载与localhost15433保留，API继续postgres:5432。
- [x] E2E登录/权限验证通过；只读查询下载，不记录凭据，不修改账号/密码/权限，未push；临时5173与代理文件已清理。
修改文件：最终报告列出12源码/测试/Skill/文档及6个outputs记录，共18文件；历史Phase5/5.1记录保留。Migration/新依赖/新API：无。
已知问题：无未解决异常；平台50值/候选限制、同名名称语义与既有数据/外网边界见报告。
等待用户确认/待完成：均无。最终报告：outputs/PMC研发进度Phase5.3验收报告.md。
下一步：无开发遗留，用户可按报告人工验收。

## GitHub 同步（2026-10-23）
任务名称：同步当前 main 与 GitHub main，并在必要时安全解决冲突。
任务目标：保留本地及远端提交，完成普通合并与推送；不强推、不覆盖他人内容。
当前状态：已完成；本地 main 与 GitHub main 已同步。
当前阶段：合并、普通推送及远端核验完成。
已完成：检查分支、远端与双方提交；fetch GitHub main；无冲突合并并保留双方提交及远端验收文档；git diff --check 通过；普通 push 到 github/main 成功。推送核验提交：710afabda97111d3670181faf0f8d8b00b3f73cd；推送前后本地与远端一致。
待完成：无。
修改文件：本进度文件；合并双方已提交变更。
下一步：无。

## 创建 kdos-form-validation Skill（2026-10-23）
任务名称：KDOS 统一表单与表格验证 Skill。
任务目标：仅创建可发现、可复用的项目 Skill 与必要参考文件；不修改业务代码，不部署。
当前状态：已完成。
当前阶段：Skill 创建、校验与 GitHub 同步完成；未部署生产环境。
已完成：项目 Skills 目录确认无额外索引；阅读表单平台约定及仓库测试、浏览器、Migration、部署入口；创建 SKILL.md 和三份按需加载参考文件；skill-creator quick_validate 显示 `Skill is valid!`；git diff --check 通过；敏感文件检查无命中；仅改 Skill 和进度记录，未改业务代码；提交并推送到 `github/main`。Skill 提交 SHA：`5cf9b3b33189f734e3764d09fb22330607c55b88`。
修改文件：`.agents/skills/kdos-form-validation/SKILL.md`、`.agents/skills/kdos-form-validation/references/acceptance-checklist.md`、`.agents/skills/kdos-form-validation/references/validation-levels.md`、`.agents/skills/kdos-form-validation/references/report-template.md`、`outputs/CODEX_PROGRESS.md`。
数据库 Migration：无。
新增或修改测试：无；未运行业务测试。Skill quick_validate 与 diff 检查通过。
当前已知问题：无。
等待用户确认：无。
下一步：无。

## PMC 主计划系统第1期工序改造（2026-10-23）
任务目标：实现事业部工序配置、租户品号工艺路线及导入、周计划工艺继承/锁定、计划数量变更后完成状态重算、采购/外协排除、报工与技术周期兼容；完成针对性验证、Migration 前一次必要备份及正式部署。按用户要求不推送 GitHub。
当前状态：已完成并部署生产，未推送 GitHub。
当前阶段：主计划工序改造一期 Migration、部署与线上健康/SHA验收完成。
已完成：确认 `main` 与 `github/main` 起始于 `15ac5ad`；已阅读 Skills、架构、运行手册和 MPS 任务台账；只读核对生产 MPS 同步配置；仅调整既有 base-to-weekly 行为；没有 GitHub push 授权。
已完成：执行本地提交 `a564b44297eaee00d643fa17fadc2510a3903cf7` 以满足部署脚本门禁；未 push。`scripts/upgrade.sh` 只运行一次，主库/KDOS库/uploads 备份时间 `20261023_114506` 且 pg_restore 列表校验通过；哈希分别见升级输出及下方记录。Migration `MpsProcessRoutingV11722920107000` 执行成功；`scripts/deploy.sh all` 与 build SHA 完全一致。
修改文件：API migration、MPS API 服务与测试、Web 页面与测试、contracts、MPS 任务台账、进度文件。
数据库 Migration：`1722920107000-MpsProcessRoutingV1` 已应用；新表 RLS 与两项触发器存在；查询确认所有已有正数报工周计划均已锁定（未锁定数 0）。
新增或修改测试：API 6 suites / 115 tests、Web MasterPlanPages 36 tests、Contracts 33 tests，均通过。API/Web/Contracts typecheck、API/Web build、`git diff --check` 通过。生产容器使用 Node 24 构建；本地验证运行时为 Node v22.23.1（低于仓库声明 >=24）。
备份：`data/backups/four_department_tracker_20261023_114506.backup` SHA256 `ff6be70244795f7d7343ec2cab0f65c9b3d939044996ac9727bf950f5f2eac8e`；`kdos_20261023_114506.backup` SHA256 `e72bc3b8170fe6d45c7c9ce2c395543fe889d6425ed13ffa266786b7335aff40`；`uploads_20261023_114506.tar.gz` SHA256 `3c0818f235d5cb217ce325508f7f3c356e8ba43e91e52bf6759e1625a5845a35`。
线上验证：API/Web/Document Worker/PostgreSQL health 通过；`deploy.sh all` 显示 Repository/Web/API SHA 均为 `a564b44297eaee00d643fa17fadc2510a3903cf7`；Chrome 打开正式站登录页 HTTP 200、输入控件正常、无页面错误。
当前已知问题：未使用生产合成业务记录写入来模拟新增/报工流程；线上浏览器仅核对登录页与部署版本，业务页面流程由通过的 API/Web/Contracts 测试覆盖。
等待用户确认：无；用户已授权部署并禁止推送 GitHub。
下一步：无。

## PMC主计划周计划工序优化（2026-10-23）
任务目标：为存量未开工周计划提供批量工艺差异检查与确认；按周计划保存的工艺快照重算工序最迟理论交期；改善未选择工序展示并淡化历史品项周期维护入口；验证并部署，不推送GitHub。
当前状态：已完成并部署生产；未推送GitHub。
当前阶段：单次备份、Migration、部署与生产健康/版本验收完成。
已完成：检查工作区、先前第1期实现、MPS控制器/同步服务/查询契约/页面；复读kdos-form-platform、kdos-form-validation、kdos-task-orchestration；确认本轮不新增调度入口。新增批量工序预览/确认API及选中周计划页面入口；批量预览返回更新/跳过数量、跳过原因和按工序汇总主要差异。存量计划只按真实选中周计划处理，确认仍经单条既有版本/报工锁校验。
已完成：增加 `RECALCULATE_DATES` 数据库守卫模式，只允许更新工序记录的due_date、其余工艺结构字段必须原样；同步按周计划快照和最新评审交期重算交期，再按最新计划数量重算状态；未选择工序展示“不适用”，缺周期展示“未配置周期”；历史周期页面重命名为“历史品项周期表（含技术周期）”。
修改文件：`apps/api/src/migrations/1722920108000-MpsProcessDueDateRefresh.ts`、MPS同步服务/控制器及相关测试、`apps/web/src/modules/master-plan-system/MasterPlanPages.tsx`及测试、`packages/contracts/src/index.ts`、`docs/operations/TASK_REGISTRY.md`、本进度文件。
数据库Migration：`MpsProcessDueDateRefreshV11722920108000` 已成功应用；只修改工序快照守卫函数，不新增业务表/列。生产查询确认 migration 记录存在且 `RECALCULATE_DATES` 守卫已安装。
新增或修改测试：API 4 suites / 63 tests，Web MasterPlanPages 36 tests，Contracts 33 tests，均通过。
已运行测试：API/Web/Contracts typecheck、API/Web build、contracts build、改动范围 ESLint、git diff --check通过。本机Node v22.23.1低于仓库>=24要求；正式部署容器使用项目现有Node 24镜像构建。
备份：仅运行一次 `scripts/upgrade.sh`。`data/backups/four_department_tracker_20261023_150310.backup` SHA256 `6e7130fe2e9aae7c0af7808099ad1de2bd1569e535f99261e3006bda5a77ac41`；`kdos_20261023_150310.backup` SHA256 `e2299c39670fcb76f249c94fd640bc6be7537a7e82ee092b36d7f2d84feb9438`；`uploads_20261023_150310.tar.gz` SHA256 `3c0818f235d5cb217ce325508f7f3c356e8ba43e91e52bf6759e1625a5845a35`。脚本已用 `pg_restore --list` 校验两个数据库备份。
部署：本地提交 `5b1eaaf`；未推送。`scripts/upgrade.sh` 和 `scripts/deploy.sh all` 成功；生产 Repository/Web/API SHA 均为 `5b1eaaf`。`scripts/deploy.sh check` 与 `scripts/healthcheck.sh` 通过，API/Web/PostgreSQL/Document Worker 均 healthy；线上 Web 与 API health HTTP 200。
当前已知问题：未使用生产合成业务记录执行新增/报工写入验收；批量锁定与快照重算由API/UI针对性测试及生产守卫/Migration核验覆盖。没有其他遗留问题。
等待用户确认：无（本轮需求已授权开发和部署）。
下一步：无。


## 安装 Changjie T+ Reader Skill（2026-10-23）
任务目标：将现有畅捷通 T+ 只读 Skill 安装到 `.agents/skills/changjie-tplus-reader/` 并验证 Codex 可发现。
当前状态：已完成。
已完成：目标目录原先不存在；从已有本地 Skill 包安装完整内容，重命名 frontmatter 并修正内部目录引用；验证 `SKILL.md`、YAML/frontmatter、参考链接、Python 脚本语法和 CHM 资源；`quick_validate.py` 显示 `Skill is valid!`。
修改文件：`.agents/skills/changjie-tplus-reader/` 下8个文件。
Git：提交 `01dee20` 已推送至 `github/main`。
数据库 Migration/业务代码/部署：无。
遗留问题：无。

---

# Codex 工作进度

## 任务

任务名称：科加 T+ 工序数据分类、订单加工单链路说明及本地导出。
任务目标：只读核实科加账套中工序档案、路线/BOM工序、加工单实际工序及订单关联，提供中文说明和 Excel，并将本轮输出放到 `test/`。
当前状态：已完成。
最后更新时间：2026-10-26（Asia/Shanghai）。

## 当前阶段

当前阶段：调查、导出和验证完成。
当前子任务：无。

## 已完成

- [x] 阅读项目 AGENTS.md 与 `changjie-tplus-reader` Skill，保护既有工作区内容。
- [x] 复用 `tplus-kejia` 只读连接，`DB_NAME()` 确认 `UFTData418971_000003`。
- [x] 核实工序主档 `AA_Process`、标准路线明细 `AA_Routing_b`、BOM工序 `AA_BOMProcess`、加工单实际工序 `MP_ManufactureOrder_Process` 的职责边界及来源关联。
- [x] 核实订单/加工单头和行的 ID 关联并记录未匹配数量及证据限制。
- [x] 在 `test/` 生成中文报告、可复用只读导出脚本、Excel 导出和目录说明。
- [x] 导出 12,303 条 2026-09-01 以来的加工单实际工序；另外导出 8 条期间工序档案、193 条期间标准路线工序明细、172 条期间 BOM 工序明细。
- [x] 明确报告不声称确认了 T+ 前台具体按钮或加工单自动/手工生成方式；未修改源库。

## 正在进行

- [x] 无。

## 待完成

- [x] 无。

## 修改文件

- `test/README.md`
- `test/TPLUS_KEJIA_PROCESS_FLOW_AND_EXPORT.md`
- `test/export_tplus_kejia_processes.py`
- `test/tplus_kejia_process_operations_since_2026-09-01.xlsx`（本地导出，Git 忽略）
- `outputs/CODEX_PROGRESS.md`（本记录，保留历史任务）

## 数据库 Migration

- 无。SQL Server 仅 SELECT；无同步、写入、部署或迁移。

## 新增或修改测试

- 无测试框架测试；对导出脚本和工作簿执行针对性结构/行数验证。

## 已运行测试

测试名称：科加 T+ 只读导出及工作簿复核。
结果：数据库名正确；12,303 条实际工序，工序来源路线 11,931/11,931 匹配、BOM 372/372 匹配；期间主档 8 条、标准路线工序明细 193 条、BOM工序 172 条。无源数据写入。

测试名称：Python 脚本语法、Excel 工作簿可读性及 Git diff 检查。
结果：Python 编译通过；工作簿 6 个工作表均可读取，实际工序 12,303 行、当前工序档案 40 行、期间工序主档 8 行、标准路线明细 193 行、BOM工序 172 行；`git diff --check` 通过。

## 当前已知问题

- SQL 数据不能确认 T+ 前台用户如何触发加工单创建（手工、MRP建议转换或其他入口）；具体 UI 流程未核验。
- 工艺主数据日期按表行 `createdtime`/`updated` 判断，不代表业务生效日期或历史版本审计。
- 9 张期间加工单头未关联到当前销售订单头；加工单明细中有 71 行所匹配销售订单父项与加工单头订单不一致，原因未知。

## 等待用户确认

- 无。

## 下一步

1. 已完成；用户可查看 `test/TPLUS_KEJIA_PROCESS_FLOW_AND_EXPORT.md` 和 Excel。

## 恢复执行说明

本任务已完成；源 T+ 只读、未部署、未执行 Git 提交或推送。后续用户明确要求输出到 `test/` 时，继续使用该目录。

# 营销中心物流台账（2026-10-28）
## 任务
- 任务目标：23列Excel物流台账，主从存储、费用去重、权限、网页维护及本地验收。
- 当前状态：进行中，架构调查完成。与记录版本已变化问题无关。
- 最后更新时间：2026-10-28。
## 当前阶段
- 实现：复用营销模块、KdosDataTable、统一筛选/导出/权限；新增物流主表与装柜明细。
## 已完成
- [x] 阅读附件、项目规范和相关Skills；仅本地开发测试，不部署、不运行生产迁移、不提交推送。
- [x] 工作区初始仅本进度文件历史追加，完整保留。
## 正在进行
- [ ] 数据结构、Contracts及API实现。
## 待完成
- [ ] Excel、权限、页面、针对性自动化及本地验收、台账更新。
## 修改文件
- outputs/CODEX_PROGRESS.md（仅追加）。
## 数据库 Migration
- 计划新增物流主表、明细、导入幂等；只在隔离环境验证。
## 新增或修改测试
- 待新增物流专项。
## 已运行测试
- 无（调查阶段）。
## 当前已知问题
- 无阻塞，继续核实xls解析方式和客户来源。
## 等待用户确认
- 无。
## 下一步
1. 完成客户来源核实、资源/存储与应用命令。
2. 完成23列导入/导出、前端维护和权限。
3. 隔离数据验收、类型/构建/专项测试，更新任务登记与报告。
## 恢复执行说明
- 先读项目规范→本节→git status/diff，继续现有修改；不重做调查，不部署或Git同步。

## 物流台账实现检查点（2026-10-28）
- 已完成：Contracts严格23业务列/营销资源/筛选与打印登记；0019物流主表+明细+幂等表及RLS视图；Application命令/审计/版本/整文件事务；xls/xlsx预览确认；费用合计数据库精确计算；页面与菜单已接入。
- 关联来源：客户采用marketing.business_customer_mappings的租户唯一customer_code；用户使用当前租户启用KDOS账号；共享读取使用marketing.order_schedules的有效订单与salesperson_user_ids。
- 本地数据库：独立临时Docker容器kdos-logistics-local-test，127.0.0.1:15439/kdos_logistics_test，已成功执行0001—0019完整迁移；未连接生产执行迁移。
- 正在进行：专项单元测试、隔离PostgreSQL CRUD/权限/导出验收、页面交互与构建。
- 已知：开发机默认Node22，项目要求24；构建阶段使用现有Node24运行环境核验。无业务阻塞。
- 下一步：修正测试或类型发现的问题，完成隔离验收、更新任务登记和最终报告；不部署、不Git同步。

## 物流台账验证检查点
- PASS：隔离PostgreSQL+真实HTTP 7项；API物流/原营销/共享筛选/打印/加密文件相关回归共49项；Web物流页面6项；Drizzle schema 3项；API构建及类型；Node24 Web构建（含类型）通过。
- 已补齐：当前筛选范围按shipment_id去重的费用汇总；打印/导出显式数字解析器；成员候选继承当前actor租户；单元格同步提交保护。
- 发现既有不相关测试：packages/contracts/src/review-due-dates.spec.ts仍预期旧9业务列，现代码已有用户之前要求的两日期；Contracts全组32通过/1旧断言失败，不修改无关评审模块。
- 实际Chrome：新增必填/有效保存/连续点击、编辑刷新及同柜增加款号已通过；Excel API直接预览12行通过，浏览器代理最初丢失multipart文件，已改为独立Vite实际代理继续验收。该问题属于本地验收代理，不是功能服务端。
- 下一步：完成实际Chrome上传/下载/权限与sticky验收，清理本任务临时启动资源，登记任务及最终文件报告。

## 物流台账最终状态（2026-10-28）
- 当前状态：已完成（代码实现与本地验收；按用户要求未上线）。
- 已完成：主从存储、23列xls/xlsx新增适配、网页新增/编辑/删除/同柜加款号、标准筛选/列配置/导出/打印、整柜费用汇总、业务员共享及字段/租户/数据范围权限、审计/版本/幂等；任务台账已更新。
- 数据库Migration：0019_marketing_logistics.sql；独立临时库完整迁移及重跑SKIP通过。生产Migration、备份和部署均未执行。
- 新增/修改测试：API logistics.spec.ts、logistics.postgres.spec.ts，Web LogisticsLedgerPage.spec.tsx，Contracts logistics.spec.ts。
- 最终自动化：API相关回归49/49（含隔离PostgreSQL7）；Web7/7；物流Contracts3/3；Schema3/3，共62项相关检查通过。API/Web Node24类型及构建、定向lint、git diff --check通过。
- 实际Chrome：PASS。新增必填、有效新增及双击保护、编辑刷新、同柜增加款号、12条多订单Excel上传/确认、模板与导出真实下载、同柜费用仅导出一次、错误明确提示、普通用户不显示费用、sticky表头；14明细/2柜，JS异常0。只使用本地API和隔离数据，认证/目录为夹具。
- 验证中修复：使用AntApp消息上下文与表单内持久错误提示，保留失败输入；同步单元格保存防重。
- 已知不相关问题：Contracts整组的review-due-dates.spec.ts仍断言旧9列，与HEAD已存在的两日期字段不符（该次32通过/1失败）；本轮不修改评审交期或旧测试，物流专项通过。
- Git：未commit/push/PR，历史进度完整保留。临时Web入口已删除、专用测试API/Vite及临时PostgreSQL容器已清理；生产服务未动。
- 最终修改文件：见test/logistics/acceptance.md完整清单；技术合同docs/marketing-logistics.md。
- 最终报告：test/logistics/acceptance.md；浏览器证据test/logistics/browser-acceptance.json、browser-table.png；本轮无真实业务数据产物。
- 正在进行/待完成/等待用户确认：无；本轮授权范围完成。下一步：无，不自行发布。

## 物流台账生产发布（2026-10-28，用户追加授权）
- 当前状态：进行中。用户明确要求“部署，然后推送github”，授权生产Migration、部署与GitHub同步，替代上阶段仅本地交付限制。
- 已完成：恢复进度、检查工作区和现有发布规范；复用已通过的62项专项及Chrome本地验收，不重复全套测试。
- 当前阶段：确认仅本任务源码/依赖与远程状态；部署脚本需要先本地commit以注入版本，GitHub push在上线验收后执行。
- 数据库：本次新增0019；沿用既有backup.sh一次备份后执行待运行SQL迁移，不重复备份、不写正式物流测试行。
- 待完成：本地提交、备份/迁移、deploy.sh all、健康及真实生产浏览器验收、push github/main。
- 下一步：核实生产当前schema版本和待运行范围，提交本任务文件，执行一次必要备份与上线。
- 不夹带前期未提交的历史outputs进度内容；既有调度和历史业务数据保持原状。

## 恢复事业四部既有月计划持续入库同步（2026-10-28，用户明确授权）
- 任务：恢复已有事业四部月计划的入库事实同步，并持续运行；另核对并如实回答未来新订单是否按BOM工序匹配。
- 当前状态：进行中；复用已完成诊断和风险报告，不恢复旧plan-projections，不重新生成月计划。
- 已完成：读取适用AGENTS、表单验收/调度Skill、架构/安全/运行手册，工作区仅历史进度修改。
- 当前阶段：将月计划入库/欠数/完成率与集团汇总接入现有inbound-allocation任务，保留30分钟周期和全部6个enabled标志；明确租户/事业四部组织/科加有效来源范围，保留归档分配、人工字段、需求与锁定工艺。
- 正在进行：来源质量与范围核对、事务/逐行审计/幂等实现。
- 待完成：类型/构建、数据差异与受影响旧值保护、Git提交/标准部署、手工一次及连续幂等验收、真实页面与后续定时执行证据、GitHub同步。
- 数据库Migration：预计无；不新增定时器，不全库备份；保留受影响原值作为本次局部回退依据。
- 测试：用户本轮未要求新建/运行测试套件；使用类型/构建与针对性数据、应用入口和页面核验。
- 修改文件：待实现；真实数据及脚本均在test/monthly_inbound_restore/。
- 当前已知问题：新订单的周工序创建仍读取品项独立路线/事业部默认，BOM映射仅用于详情展示；本轮第2项是问题核查，不擅自改变已锁定结构。
- 下一步：实现持续回算→核验→提交/部署→线上回算/页面/定时证据→最终报告。
- 实现检查点：已新增monthly-inbound事务函数并接入既有inbound-allocation；逐行before/after审计、版本、租户RLS、事务锁和重跑无差异保护到位，未修改旧plan-projections入口或6项enabled。
- 来源状态真实核实：T+181=未审、189=生效。第一版预览识别额外15项下调来自未审；已改为包含未审/不稳定来源的品项整项保留原值并单独计数，避免自动冲减。最终生效来源预览366项/32订单，无下调（原368中另2项混有未审也跳过）。
- 本地API类型/构建、定向lint与diff空白检查通过；Node22主机有engine提示，最终生产镜像由现有Node24 Dockerfile构建验证。未运行用户未要求的软件测试套件。
- 已保存范围旧值before-approved.json（2.8MB）、全部人工业务字段/归档/报工/工艺哈希、6项配置及现有调度/n8n只读快照。准备本任务提交和API标准部署，之后真实管理员入口回算与Chrome验收。

## 在制订单进度筛选默认值与入库字段说明（2026-10-28）
- 任务：解释30分钟inbound-allocation职责/来源与允收数量映射；将订单进度默认未完成筛选改为不勾选、日期改为上海当月ORDER/MONTH，去掉“只看”文案。
- 当前状态：进行中。
- 已完成：读取规范/表单Skill与上一任务进度、Git状态；定位字段receivedQuantity→finished_goods_inbound.received_quantity→T+ST_RDRecord_b.quantity，入库回算只读KDOS canonical并非再次读取ERP；定位默认昨天和两项true。
- 当前阶段：仅调整前端默认值/名称及已有断言/文档；保留大屏明确带入的筛选上下文。
- 待完成：类型/构建/静态检查、提交/标准发布、真实Chrome初始/重置/带入条件/复选框行为核验、GitHub推送。
- 修改文件：待记录；验证脚本和结果只放test/order_progress_filter_defaults/。
- 数据库Migration/备份/业务写入/调度变更：无。
- 测试：不新增或运行未要求的测试套件；必要更新既有默认值断言，进行类型/构建与线上交互核验。
- 下一步：前端小改→构建→发布与页面核验。
- 实现检查点：在制订单进度直接打开/重置使用上海当月ORDER/MONTH，两项默认false；大屏明确日期上下文保留，两项仍false；复选框文案已去“只看”。已更新既有相关断言及运行手册/工序说明。
- Web类型检查、两修改TSX定向lint、diff空白检查通过；不新增/运行测试套件。准备本任务局部暂存、本地commit及标准部署，真实浏览器核对初始/重置/勾选/导航条件。

## 入库数量显示名称统一（2026-10-28）
- 任务名称：将入库表“允收数量”改为“入库数量”。
- 任务目标：页面、字段注册、导入模板与导出统一名称，保留receivedQuantity和旧表头兼容。
- 当前状态：进行中。
- 最后更新时间：2026-10-28。
- 当前阶段/子任务：已核实全部6处引用；实施显示名称与导入别名调整。
- 已完成：[x] 阅读规范、适用Skill、进度和Git状态；确认范围为3个源码文件。
- 正在进行：[ ] 标签及兼容别名修改。
- 待完成：[ ] 针对性类型检查/构建；[ ] 提交、标准部署、线上只读页面/Excel核验、GitHub推送。
- 修改文件：packages/contracts/src/index.ts；apps/web/src/shared/legacy-ui.tsx；apps/api/src/controllers.ts；本进度本节。
- 数据库Migration：无；无数据变更、备份或调度改动。
- 新增或修改测试：无。
- 已运行测试：尚未执行；仅做本变更相关静态及页面检查，不运行测试套件。
- 当前已知问题/等待用户确认：无。
- 下一步：完成3文件修改→类型检查→提交部署→线上核验→GitHub同步。
- 恢复执行说明：读取本节、规范及Git diff后从下一步未完成项继续；保留本进度历史未提交内容。

### 入库数量改名：实现与静态检查完成
- 完成3文件修改：页面/字段配置/模板/导出/校验提示统一“入库数量”；导入同时接受receivedQuantity、入库数量、允收数量、实收数量，保留0值语义。
- Contracts、API、Web typecheck与git diff --check全部通过；未新增或运行测试套件。
- 未触及Entity、数量、权限、同步、Migration或数据库；不增加备份。
- 当前阶段：准备提交本任务3个源码文件与本节进度，随后标准部署与线上只读核验。

## 恢复已确认分配到集团/月度计划链路（2026-10-29，用户授权）
- 任务名称/目标：恢复现有手工/Excel分配后的计划生成及持续对账；不恢复ERP自动写分配。
- 当前状态：进行中；最后更新时间：2026-10-29。
- 当前阶段：已完成中断恢复、规范/调度Skill/相关代码阅读；精确预览当前分配、现有计划、约束及风险。
- 已完成：[x] 定位run、execute、outbox与Application四处停用点；[x] 确认旧SQL不兼容追加批次与历史保护，不能直接启用。
- 正在进行：[ ] 生产只读范围预览；[ ] 复用现有事务/幂等/审计实现安全生成与持续同步。
- 待完成：[ ] 必要验证和构建；[ ] 更新TASK_REGISTRY；[ ] 最小范围保护、正式部署与版本检查；[ ] 审计API启用已有配置/正式同步；[ ] 2026A027449页面与重跑验证；[ ] GitHub同步。
- 修改文件：待实现；所有真实数据/临时脚本在test/plan_projection_restore/，保留既有进度未提交内容。
- 数据库Migration：预计无；新增或修改测试：待定；已运行测试：无，用户本轮未要求新增测试套件。
- 当前已知问题：新链路恢复前须处理重复分配/批次归属与已存在计划保护；无等待用户确认。
- 下一步：预览→实现→针对性验证→部署→启用与补齐→线上验收。
- 恢复执行说明：读取本节及test证据、Git状态，继续未完成项；不重做诊断或覆盖历史进度。

### 链路恢复：范围与实现完成
- 精确预览：当前2425条活动分配，2303个订单/品项键；其中372键匹配有效科加源，364无冲突键/20单可生成，8键重复合计超过ERP数量；1931非当前准入来源键不生成。
- 2106条既有月计划全部关联归档分配，本轮保留；本订单5键全部可生成。
- 已实现：恢复run/execute/outbox与Application事件入口；新增模块内helper复用事务、租户/共享advisory锁、稳定allocation_id、numeric汇总、幂等及逐行审计；不恢复ERP写分配，不复用已过期无外键/批次处理的旧SQL。
- 已更新TASK_REGISTRY与runbook，保留历史政策并说明本次新授权和回滚。
- 初次API类型检查/编译通过；正在进行部署前SQL/范围核验、受影响数据保护与发布准备。未新增/运行测试套件。

### 发布准备
- API最终typecheck通过；本地tsc构建通过，生产将使用现有Node24 Docker构建。
- 生产正式SQL的只读候选预览成功：364新增、20订单；已有受影响月/集团行均为空，不覆盖旧行。已留现有配置与保护哈希：4763分配、2106历史月计划、19836工序结构、4190真实报工。
- n8n只读实测16定义/11active；现有外部任务未改，新增调度定义0；恢复原应用配置，不新增入口。
- 不新增或运行测试套件；本轮以类型/构建、实际候选SQL和上线正式命令/重复执行/页面核验验收。
- 当前阶段：仅提交本任务源码/规范/本节进度，标准部署后再通过审计API启用已有配置。

### 首次运行回滚与审计身份参数修正
- c323de7标准部署及健康/SHA核对通过；原配置经审计API启用后，真实SCHEDULED首次运行因传入入库helper的updatedBy使用系统显示名而非UUID失败。
- 同一事务已完整回滚；只读实测分配/2106历史月计划/19836工序结构/4190报工保护哈希与发布前全部一致，本订单计划仍0。已通过同一审计API安全停用配置，未手工改库。
- 修正为传递稳定actor UUID至既有helper；成功恢复后自动resolve本任务失败异常，保留失败日志历史。正在类型检查并标准重发；不将失败版本称为交付完成。

## 安装table-delete-standard Skill（2026-10-29）
- 任务：从下载目录压缩包安装项目级Skill，追加AGENTS引用并核对冲突/触发。
- 当前状态：已完成；当前阶段：已阅读AGENTS/现有Skill结构/包内2文件与Skill创建规范，确认目标目录不存在。
- 已完成：[x] 下载目录zip存在且结构清晰；[x] 对照现有删除权限/表格能力/分级验收，发现行级删除例外与强制全层测试需适配。
- 正在进行：[ ] 安全解压/安装新Skill；[ ] 原样保留根AGENTS并追加包内引用/项目适配说明。
- 待完成：[ ] YAML结构与Codex实际发现/触发配置校验；[ ] 保留原Skill与业务文件验证；[ ] 清理临时解压与根目录安装包。
- 修改文件：新Skill目录、根AGENTS、本进度；验证产物在test/table_delete_standard_install/。
- 数据库Migration/业务测试/备份/部署/真实删除/权限变更：无。
- Git：用户本轮明确禁止commit/push，遵守本次限定，不执行。
- 当前已知问题/等待用户确认：适配上述2处规则，无待审批操作。
- 下一步/恢复说明：继续安装、静态/实际发现校验与清理，不启动业务改造。

### 安装完成及验证
- 已完成：[x] 安全解压并安装SKILL.md/AGENTS_REFERENCE.md；[x] 根AGENTS保留全部原文并追加包内4条规则及项目适配；[x] 冲突核对；[x] 格式校验与Codex实际识别；[x] 原文件保护与临时清理。
- 安装位置：.agents/skills/table-delete-standard/SKILL.md。原4个Skill文件哈希均一致；新Skill不强制所有资源删除、不授予权限、不改变删除/归档语义。
- 适配：遵守现有顶部工具栏删除，移除标准表行内删除例外；验证按kdos-form-validation分级，资源枚举/能力补齐受本次授权范围约束。原根AGENTS正文逐字保留。
- 验证结果：quick_validate PASS；Codex0.160.1 app-server skills/list(forceReload=true)真实返回table-delete-standard，路径正确、enabled=true、scope=repo、errors=[]。普通业务表新增修改/删除/批量/权限触发规则及显式$table-delete-standard入口已核对。
- 清理：本任务临时解压目录删除，根目录无安装zip；下载目录源文件保留。
- 最终修改文件：AGENTS.md；新Skill目录SKILL.md/AGENTS_REFERENCE.md；本进度本节。安装验收资料统一test/table_delete_standard_install/。
- Migration/业务表格改造/数据库操作/用户权限变更/真实删除/业务测试/生产部署：均无；Git commit/push均未执行，遵守本轮明确要求。
- 当前已知问题/等待用户确认/待完成/下一步：无，安装已完成。
- 最终报告路径：test/table_delete_standard_install/REPORT.md。
- 恢复说明：以后从本节和Git状态继续，无需重复安装；新Skill已能被项目发现。

### 用户追加授权：提交GitHub（2026-10-29）
- 用户现明确要求提交GitHub，覆盖安装阶段仅对Git的禁止；生产部署仍不执行。
- 本次提交仅包含新Skill的两个文件、根AGENTS新增规则及本任务进度节，不夹带此前历史未提交进度或业务数据。
- 安装结构校验、Codex实际发现及git diff --check已通过；正在提交并推送github/main。

## 月度计划直接生成基础计划（2026-10-29，代码与本地验收）
- 任务目标：月计划→自动基础→人工完善→周计划；出货独立保留，无新增来源字段。
- 当前状态：本地开发与验收已完成，正在按项目规范同步GitHub；最后更新时间：2026-10-29。
- 当前阶段：本地代码与验收完成，安全GitHub同步。
- 已完成：[x] 实际月计划唯一键tenant/order/item；基础唯一键tenant/order/item/delivery；shipping_plan_id已有可空；周计划按base_plan_id关联，无强制出货引用。
- 正在进行：[ ] 仅本任务文件提交、普通push与远端SHA确认。
- 已完成：[x] 同步入口/保护/必要Migration；[x] 针对性单元/隔离PG/页面闭环；[x] 类型/构建/文档。
- 设计：有效月计划required_quantity→基础planned_quantity；latest_customer_due_date→同名交期；latest_review_due_date保留人工，不映射其他评审/出货日期。已有唯一基础复用ID/交期编码；多批次/事业部冲突不合并不删除。
- 人工保护：使用既有审计中的上次同步值做三方对账，首次接管不覆盖无法证明的非空人工值；保持周计划/报工/工艺逻辑。
- 修改文件：见最终验收完成节；所有临时脚本/输出/合成资料放test/monthly_base_generation/。
- 数据库Migration：计划仅允许基础latest_customer_due_date为空以保存待完善数据，不增加字段、来源标记或新表；只在隔离环境验证。
- 测试：用户明确要求定向测试/类型/构建及隔离写入验证，不运行无关全套。
- 生产部署/历史数据修改/全库备份：本轮不执行，遵守用户暂不部署授权范围。
- 当前已知问题/等待用户确认：无待审批；具体冲突按业务键报告。
- 下一步/恢复说明：实现→定向本地验证→审查Git→报告，保护既有历史未提交进度。

### 月→基础核心实现完成，进入隔离验收
- 原shipping-to-base编码/定时/手工入口保留，唯一生成输入改为月计划；出货保存不再入队生成基础。月→基础变更同事务入队既有base-to-weekly补偿，不新增任务。
- 复用现有交期编码计数器/锁，抽出单一生成器供人工/导入/自动共用；新基础shipping_plan_id空，旧引用保留。
- 数量required_quantity、客户交期latest_customer_due_date；不填人工评审日期/完工日期。三方合并使用既有audit_logs，未增加来源字段/列/表。
- 唯一旧基础复用；多批次或事业部不符写明确异常并保留。旧非空人工值默认保护；后续手工覆盖与清空继续保护。
- Migration仅可空基础客户交期并更新原任务显示名称；缺客户交期进入统一weeklyAdmission缺失项，允许先保存待完善，不编造日期。
- 新建定向单元/隔离PostgreSQL用例，沿用现有真实页面组件；当前未部署、未执行生产写入。

### 本地业务闭环与构建已验收
- 已完成：[x] 月度直接生成/无出货/多品项/重复并发/租户隔离/旧基础复用/人工字段/多批次及事业部冲突/锁定报工保护；[x] Node24 API/Web类型与构建；[x] Web页面40/40；[x] Chrome真实页面编辑保存刷新及周计划/出货独立闭环。
- Chrome使用本地Vite+真实Application/Query/Sync+隔离PG18，合成会话，不验证生产登录；JS异常0、生产请求0。截图base-local.png与browser-result.json位于test/monthly_base_generation/。
- Node24专项7套86例已通过；补充权限拒绝/审计失败事务回滚2例后执行最终定向回归。API/Web改动文件lint通过；git diff --check通过。
- 扩展检查同步旧套件发现5个既有分配链路用例仍预期停用或旧模拟返回，与已恢复的plan-projections实现不符；保持无关业务与旧用例，单列记录。另1个本轮tenant context新增导致的SQL序号断言已更新为定位业务SQL。
- 无生产迁移/部署/数据修改/备份。自建本地API/Vite已停止，隔离数据库继续用于最后定向回归。
- 下一步：完成最终专项回归→记录验收→白名单审查/安全GitHub同步，保留既有未提交历史进度。

### 最终验收完成
- 当前阶段：本地开发与验收已完成；最后更新时间2026-10-29。生产未部署，用户明确暂不部署。
- 已完成：[x] 代码/文档/Migration；[x] API88专项（含隔离PG10）+同步矩阵24；[x] Web40；[x] Node24 API/Web类型与构建；[x] API新增文件及Web改动文件lint；[x] Chrome闭环；[x] 原历史修改保护。
- 基线核实：HEAD原始Service与原测试在忽略目录单独复现同样5个分配链路旧用例失败；不是本轮回归，不修改无关业务规则。证据baseline-tests.log。
- 最终修改文件：月度对账/共享编码两个helper、sync/Application/config、Migration111、MasterPlanPages、5个专项测试文件、TASK_REGISTRY/runbook及本进度本节。
- Migration：1722920111000仅可空客户交期与原任务名称，隔离环境验证通过；生产未执行。无新来源字段，无生产历史写入，无全库备份。
- 临时本地API/Vite与专用PG容器已停止清理，验收资料保留；生产调度和运行版本未改动。
- 当前已知问题：5个基线已有旧用例；多基础批次/事业部不符按冲突保护，需要业务核对；无本轮功能阻塞。
- 等待用户确认：无。本轮未授权生产部署，保持未上线状态。
- 最终报告路径：test/monthly_base_generation/acceptance.md。
- 下一步/恢复说明：仅提交本任务文件及本节进度、普通push到github/main；原有历史进度修改不夹带。完成后记录SHA，不部署。

## 项目与任务模块删除功能（2026-10-29）
- 任务目标：仅supervision-projects/tasks，复用KdosDataTable顶部删除、独立权限及Application事务审计；隔离测试，生产非破坏性核验。
- 当前状态：进行中；最后更新时间：2026-10-29。当前阶段：已读取AGENTS/SECURITY/删除/表单/验证Skill与现有Controller/Application/scope/页面/外键/部署规范。
- 已完成：[x] 两资源已注册独立delete，无需默认授权；[x] 项目→任务、任务→进展、项目→进展均RESTRICT，附件为JSON+对象存储，报表实时聚合，无已确认软删。
- 正在进行：[ ] 版本/租户/范围/关联安全的硬删除及同事务审计；[ ] 页面顶部单多选确认/准确反馈/关联缓存刷新。
- 待完成：[ ] 定向权限/HTTP/隔离PG/UI测试、类型/构建；[ ] 线上健康及非破坏性核验（视部署门禁）。
- 修改文件：待实现；仅supervision模块及本进度，临时脚本/输出放test/supervision_delete/。保护此前历史未提交进度。
- 数据库Migration：预计无；不改表结构/权限组/普通用户授权，不删除生产真实记录。
- 新增修改测试/已运行测试：待完成，按用户要求覆盖独立delete、跨租户/范围、版本、关联、审计回滚、统计及批量交互。
- 当前已知问题：scripts/deploy.sh的assert_deployable_worktree拒绝任何未提交源码且构建SHA取git HEAD；本轮用户禁止commit/push，不能按现有流程部署本次未提交源码。不得绕过门禁、伪报已上线或夹带此前未授权上线的月→基础改造。
- 等待用户确认：先完成可审查代码与本地验收；若用户仍要求上线，需要最小范围允许本次本地提交（不push），及使用既有干净来源发布，保留其余功能。
- 下一步/恢复说明：从本节+git状态继续实现与验收；不执行commit/push，不重新分析已确认关联，不修改生产业务数据。

### 删除功能代码与定向验证完成
- 已完成：[x] DELETE projects/tasks + expectedVersion；[x] 原delete权限/租户/范围/锁定后二次范围校验；[x] 独立行条件删除与同事务AuditLog；[x] 项目任务/进展/附件/结束状态阻止；[x] 23503/PG18 RESTRICT 23001友好409。
- 删除语义：仅无业务关联且未结束记录物理删除；不级联/不清理附件/不删历史审计。项目进度/责任人统计保持原实时聚合，剩余任务不重写。
- 已完成：[x] 顶部勾选删除/业务编号与数量确认/取消/同步防重复/部分失败业务编号原因/成功行取消选择/关联缓存失效；行内操作原样保留。
- 修复本模块范围隔离：非project-task的模块管理员不能通过通用scope编译器继承Planning范围绕过；不调整其他模块或普通用户授权。
- 测试：Node24 API6套59/59（含专用PG+HTTP21项）；Web本模块15/15；共享勾选/删除定向5/5；API/Web类型与构建通过（仅既有bundle体积提示）；改动文件lint与git diff --check通过。
- 修改文件：supervision.controller/application.service/scope、scope.spec、新delete.postgres.spec；SupervisionPages及spec；docs/supervision-deletion.md；本进度。
- 实际部署门禁：执行scripts/deploy.sh check只读核对被assert_deployable_worktree以未提交源码拒绝（exit1，deployment-gate.log）。不执行commit/push、不绕过门禁。生产Web/API只读health均607eaecce99647180b80990a03a5eb23c82973ee。
- 当前阶段：本地Chrome真实页面闭环，之后交付结果与部署所需最小授权；无生产写入/Migration/备份/部署。
- 下一步：完成Chrome→保存验收报告→说明本地提交门禁冲突，不重复已通过测试。

### Chrome通过，等待最小部署授权
- 当前状态：代码/本地验收PASS，生产部署BLOCKED。真实Chrome已验证单项目确认/取消/删除/刷新、多任务部分成功与失败勾选/原因、项目进度50→80、责任人统计2→1、无权限隐藏；JS异常0/生产请求0。使用合成会话，不冒充生产验收。
- 已通过：API59（隔离PG+HTTP21）+Web15+共享选择/删除5；类型/构建/lint/diff。未解决功能缺陷：无；本轮无Migration。
- 已向用户请求：允许隔离发布分支只做本次本地commit、不push，以满足deploy.sh门禁。用户未回答前不执行commit/部署；如保持禁止commit，保留已完成代码和测试。
- 发布基线：生产Web/API607eaecce99647180b80990a03a5eb23c82973ee，HEAD另含未上线月→基础功能。恢复部署时从生产commit隔离仅本轮supervision白名单，不夹带Migration111。
- 最终报告：test/supervision_delete/acceptance.md；补丁/文件哈希task.patch、scope-manifest.json。当前全部改动未提交，原历史进度保留。
- 下一步/恢复说明：等待部署门禁授权；若授权，仅按既有干净worktree部署流程执行本轮功能，健康/线上只读核验；不得生产尝试删除真实数据，不重复本轮已完成验证。

### 用户已授权本地提交并部署（2026-10-29）
- 用户明确追加允许：在隔离发布分支仅提交本次项目/任务删除改动，不push，然后按既有流程部署。覆盖先前只对本次local commit的禁止；不授权推送或生产真实删除。
- 当前状态：部署进行中；当前阶段：从生产607eaec创建隔离来源，白名单复制本轮代码/测试/文档，不带月→基础及Migration111。
- 已确认：本轮scope-manifest全部哈希与已验收代码一致；生产版本到HEAD的supervision/共享表格/contracts/filter依赖无变化，不重复全套测试。
- 下一步：本地发布commit→既有升级备份一次→deploy all/check→真实线上只读页面/确认取消/权限核验；不执行任何生产DELETE。


## 月度直接生成基础计划生产部署（2026-10-29）
- 任务目标：正式发布完整a7a63fd，保留已上线c324f3e项目删除功能；必要Migration→原任务生产同步→页面/去重/保护/周计划衔接验收。
- 当前状态：进行中；当前阶段：已读最新规范/技能/进度/部署脚本，核对Git和生产字段；最后更新时间2026-10-29。
- 已完成：[x] main及github/main均a7a63fd；生产Web/API为c324f3e，后者是基于607的有效发布分支；原工作区含该功能未提交源码/历史进度，保护不覆盖。[x] Migration111仅客户交期可空及原任务默认名称，无删除/覆盖。
- 生产基线与真实候选字段证据保存在忽略目录test/monthly_base_production/，不提交真实订单、品号或业务行。
- 发现必要兼容修复：实际audit_logs.record_id为varchar，原helper将b.id uuid直接等于该列，真实SQL会拒绝；隔离测试误设uuid。仅修正关联类型并将fixture对齐真实结构，定向重跑相关用例。
- 正在进行：[ ] 独立worktree正常合并a7与c324，保护当前有效版本；[ ] 必要兼容修复/定向测试；[ ] 生产Migration及deploy all/check。
- 待完成：[ ] 原任务一次必要同步及幂等对账；[ ] Chrome基础/周/出货验收；[ ] 正常push及报告。
- 修改文件：预计helper/PG fixture和任务文档进度；实际运行产物统一test/monthly_base_production/，不提交真实ERP资料。
- 数据库Migration：仅MpsMonthlyBaseGeneration1722920111000；不默认备份，无整库/第二套/额外备份流程，遵守用户本轮明确要求。
- 测试：复用原API112/Web40/类型构建/Chrome及历史5失败基线结论，不重复完整套件；新真实类型修复单独验证。
- 当前已知问题：审计ID类型修复待完成；无待用户确认事项。
- 下一步：合并有效发布→修复/定向验证→应用Migration→部署→原同步及生产验收，持续完成，不触碰既有未完成修改。

### 发布必要修复与验证
- 已合并已上线c324f3e，完整保留a7a63fd。真实audit_logs.record_id为varchar，原SQL只读EXPLAIN确认类型不兼容；关联改为b.id::text，隔离fixture对齐varchar。
- 仅复跑相关monthly-base两套18项，全部通过。原112/40/类型构建/Chrome与5项历史失败结论继续复用。
- 当前进入镜像构建、仅Migration111和生产发布；用户本轮明确不增加全库备份。无新来源标识、无新调度器，保护已有人工/工艺/报工及上轮已上线删除功能。

## 项目候选缓存一致性修复（2026-10-29）
- 任务目标：统一项目创建/修改/完成/中止/删除后的依赖失效；每次创建任务前主动重取候选，失败时不打开旧数据窗口；测试、GitHub同步、部署及实际页面闭环。
- 当前状态：进行中；当前阶段：已确认实现方式，准备最小前端修复；最后更新时间：2026-10-29。
- 已完成：[x] 阅读附件、AGENTS/SECURITY、form-platform/form-validation及删除规范；[x] 确认原options五分钟缓存，inline及form/action仅刷新projects；[x] 确认候选及列表名称从supervision_projects.project_name当前查询，任务未存名称副本。
- 正在进行：[ ] 前端统一依赖helper与创建前refetch/失败提示/防连点；[ ] 定向测试。
- 待完成：[ ] Web类型/build/lint及API候选权限回归；[ ] 隔离发布提交/push及既有脚本部署；[ ] Chrome实际改名到创建候选/刷新验证。
- 修改文件：预计SupervisionPages.tsx及spec、本进度；其他历史未提交代码与进度保护。
- 数据库Migration：无；不新增冗余名称、来源或同步字段，不改后端权限。
- 新增或修改测试：拟覆盖同浏览器改名、跨浏览器最新候选、失败/重复点击、成员/状态/新增及各变更依赖。已运行测试：本轮尚无。
- 当前已知问题/等待用户确认：无，用户已授权修复、Git同步、部署和指定实际改名验收。
- 下一步/恢复说明：继续最小实现→测试→仅白名单复制当前fbff基线隔离worktree→提交/push/web部署→Chrome验收。所有脚本与输出放test/supervision_options_cache/，不覆盖其他任务。

### 缓存修复实现完成与定向验收进行中
- 已完成：[x] 单一invalidateSupervisionProjectDependencies覆盖项目/候选/任务/进展/两大屏/责任人报表及下钻；inline保存、项目新增/弹窗修改/完成/中止及删除共用。
- 已完成：[x] 创建任务每次refetch(throwOnError)，完成后才打开；失败明确提示且不开旧数据窗口；按钮loading+同步ref防重复；保留常规5分钟缓存。
- 已验证：[x] API相关5套38项；[x] Node24 Web类型+生产构建；[x] 相关lint；前端28项通过，刷新失败保护用例正在解决测试fixture独立性后收尾。
- 已有功能保护：删除/权限/候选成员规则保留；后端名称查询为项目主表实时读取，不改历史task.projectId，不加Migration。
- 发布隔离：新worktree test/supervision_options_cache/release-source从当前github/main fbff2a3创建，只复制本次两个Web文件；原main及其他未提交内容不动。
- 下一步：完成Web29项最终回归→仅提交白名单与本节进度并普通push→保留原Web镜像回退→原脚本web部署→实际Chrome改名及候选检查后恢复原名称。无数据库结构/调度变更，不追加数据库备份。

### 定向验收全部通过，准备正式发布
- 已运行测试：Node24 SupervisionPages.spec.tsx 29/29（新增14项）；API相关5套38/38；Node24 Web类型与生产构建、最终相关lint及git diff --check均PASS。
- 测试等待问题已解决：公共表格250ms初始化筛选需要完成后再做刷新失败断言；没有扩大业务实现范围。
- 当前阶段：仅本次两个Web文件及本任务进度复制隔离发布源，安全审查后commit/push；旧Web镜像before-supervision-options-20261029保留供回退。
- 无Migration，不修改数据库结构、权限或调度，不执行额外数据库备份；部署使用原scripts/deploy.sh web，API/Worker保持当前已验证fbff版本。
- 下一步：提交/push→web部署→健康检查→真实Chrome同浏览器SPA改名/跨标签页候选刷新/失败提示/页面刷新/恢复原名。
