# 统一需求ID集中开发进度

本文件记录集中开发各轮功能和验收；主恢复入口仍为 `outputs/主计划系统修复进度.md`。已确认设计见 `MPS_UNIFIED_PLAN_ID_ASSESSMENT.md`，第一阶段发布门禁见 `MPS_PHASE1_RELEASE_READINESS.md`。

> 最新状态（第3轮）：核心开发与隔离验收已完成；路线A仅118/119，统一ID路线B仅在119基线上执行121/122，均不含120。最终结论见文末第3轮；下列各轮记录保留当时状态。

## 第1轮（2026-11-06）：PASS（相关代码与隔离验收）

- 总目标：完成方案A兼容修复和统一需求ID核心关系，保留main成果；代码基准4b67c22。
- 当前状态：第1轮当时已完成；第2/3轮成果见后续记录。没有生产部署、生产Migration、生产同步、历史事件补偿或历史ID回填。
- 方案A技术GO：限118/119，仍须正式窗口的备份、旧Worker退出、现场只读复核和生产验收；不能把隔离通过等同于已经生产上线。
- 方案B仍NO-GO：120历史LEGACY_RETAINED全租户生成阻断未改变；生命周期写入/级联未启用。

### 1. 本轮完成

1. 生命周期catalog能力区分Schema、服务/事实保护、写开关与各操作支持。缺120时metadata明确不可用，预览/确认HTTP409（MPS_LIFECYCLE_SCHEMA_UNAVAILABLE），不查询缺失字段；旧API/不完整能力/管理员均不能绕过Web入口门禁。
2. Migration发现只加载时间戳实现，排除spec/test/d.ts/map并支持src/dist。新增`@tracker/api db:migrate:phase-a`正式严格名单入口：完整117前置，只执行118/119，120/121的意外ledger/schema拒绝；设置连接、锁、语句和事务超时。未修改部署脚本。
3. 月度UUID作为需求根、基础UUID作为批次；分配/基础/评审三表新增nullable monthly_plan_id。无需求主表、无周计划/报工重复demand_id、无需求父ID一对一唯一限制。
4. 首次关联专用Application Command：独立mps-demand-links:update＋原表read/update＋月度read，身份字段读取/双方数据范围、源与目标版本、原因、幂等和事务审计。非空父不得改绑/清空。数据库要求同事务授权审计（精确记录、目标、原版本和事务ID），校验租户/订单/品项/事业部/客户/旧shipping来源；不使用session绕过119。
5. 新建分配局部建立/维护当前需求根，集团/入库/下游仍走原Outbox；同一来源UUID只贡献一次。新建/导入分配、基础及正常新增评审在有可确认ACTIVE父需求时自动关联本次新行。旧NULL、已归档来源或未确认生命周期不批量自动绑定，不据此激活需求。
6. 来源和基础已有明确父ID时校验并优先使用ID，冲突不退回文本。无父ID保留旧匹配/待确认；多条未确认历史批次不擅自合并或生成第三批。
7. 已确认60＋40两个基础批次合法；需求100→120保持批次ID和数量，可精确返回差额20；不广播全量120。查询差额仅为已关联批次核对，可能遗漏未确认历史关系，标记provisional；取消/来源待确认时不推算可再排量，履约抵扣未实现。
8. Web同一行菜单提供需求关联查询；独立获权者可读取目标并确认首次关联，读取失败/提交失败保留输入与请求幂等键。UUID不加入普通可编辑/导入/默认导出字段，原字段显示/打印/Excel规则保持。
9. 评审仅绑定需求上下文，保留source_*、交期、数量、版本和历史；已绑定时禁止初始化删除重建。没有评审→基础批次应用关系，也没有日期广播。

### 2. Migration及依赖

- 新增：`1722920121000-MpsDemandLinks.ts` / `MpsDemandLinks1722920121000`（121）。
- 依赖119保护函数；118为1A运行前置；不依赖120。复用已有父租户复合唯一键，仅缺少时补充；三张表建立复合租户FK及非唯一索引。
- up只有结构/函数/触发器，没有历史业务UPDATE回填；不修改任何已交付Migration。down拒绝删除已确认关系和保护，须受控前向修复。

| 隔离路径 | 实际结果 |
|---|---|
| 完整117→118→119，不执行120/121 | 真实ledger119行，生命周期与需求关联新列不存在；Nest HTTP启动和正常业务通过 |
| 118/119→121，无120 | 真正执行121，120保持未执行；ledger总行数120不能误解为执行了Migration120 |
| 121之后补120 | TypeORM按未执行名单真实补120，重复执行无新增；不伪造ledger，原事实/工艺保留 |
| 120已存在后执行121 | 独立合成库全120基线→121；保留既有报工，首次绑定合法，生命周期保护继续存在 |
| 编译正式phase-a入口 | 完整117只执行118/119，重复为no-op，120/121不运行；实际执行120后该入口正确拒绝 |

### 3. API与权限契约

- `GET /api/v1/master-plan-system/resources/:resource/:id/demand-link`：关联状态、版本；获权且范围完整时给出临时数量核对。
- `POST`同路径：首次绑定，MpsBindDemandRequest包含demandId、expectedVersion、expectedDemandVersion、idempotencyKey、reason。
- `GET /api/v1/master-plan-system/demands/:id`：有月度/身份字段/数据范围读取权限时返回目标ID、版本和身份供确认。
- metadata包含demandLinks能力。新增权限资源仅注册能力，不向普通员工写入任何新授权；系统/计划模块管理员沿既有规则。
- 事务后重试40001/40P01有界重试；同键返回原结果并重检权限，不同键并发只有一次首次绑定成功。

### 4. 最终相关验收

使用Node24.22.2；PostgreSQL18为独立network=none/tmpfs容器，仅专用Unix socket，拒绝生产DSN。全部记录为合成。日志/JSON和正式CLI合成预演脚本仅ignored `test/mps_phase_a_compatibility/`。

| 检查 | 结果 |
|---|---|
| API定向12套 | **279/279 PASS**；导入索引优化后相关2套73项再次PASS |
| 其中真实PG测试 | **103项**：新关联14＋1A34＋1B25＋1C30，均PASS |
| Web计划/生命周期/首次关联3套 | **60/60 PASS**（单worker，20秒超时） |
| Web评审新增/编辑/权限3套 | **11/11 PASS** |
| Contracts全部9套 | **48/48 PASS** |
| API/Web/Contracts typecheck | PASS |
| API/Web lint、Contracts lint（类型检查） | PASS；Web保留既有ModulePortal热更新warning一项，无error |
| API/Web/Contracts build | PASS；Web保留既有bundle体积提示 |
| 严格phase-a编译CLI | PASS，119真实ledger、120/121不运行；重复无操作，120存在拒绝 |
| Git差异/敏感内容/历史Migration | 仅本任务34文件；118/119/120无改动；不提交日志、凭据、生产UUID/数据或其他任务修改 |

覆盖：新分配/同需求多来源、Excel重复确认、60＋40/增量20、显式父关系、合法与非法NULL绑定、归档来源、已有报工、重复/并发/乐观锁、专用权限/字段权限/NONE/跨事业部/跨租户范围、正常报工纠错、工序结构及报工整行不变、无120 HTTP门禁、121/120双顺序及1A/1B/1C回归。14个新PG测试包含完整链路多场景断言，不仅检查HTTP200。

额外执行记录：首轮误用`pnpm test -- 文件`参数，实际触发全Web568项，492通过/76失败，包含大量5000ms超时和其他模块失败。该轮不能作为通过证据，未逐项归因或修改无关模块。随后按明确文件、Node24、单worker复验，上表71项相关Web全部通过。**不宣称全仓库Web测试通过。**

### 5. 修改文件（34）

- `apps/api/package.json`
- `apps/api/src/data-source.ts`
- `apps/api/src/migrate-phase-a.ts`
- `apps/api/src/migration-files.spec.ts`
- `apps/api/src/migration-files.ts`
- `apps/api/src/migrations/1722920121000-MpsDemandLinks.ts`
- `apps/api/src/modules/master-plan-system/master-plan.allocation-projection.ts`
- `apps/api/src/modules/master-plan-system/master-plan.allocation-source.ts`
- `apps/api/src/modules/master-plan-system/master-plan.application.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.controller.ts`
- `apps/api/src/modules/master-plan-system/master-plan.demand-link.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.demand-links.postgres.spec.ts`
- `apps/api/src/modules/master-plan-system/master-plan.demand-links.ts`
- `apps/api/src/modules/master-plan-system/master-plan.lifecycle-availability.spec.ts`
- `apps/api/src/modules/master-plan-system/master-plan.lifecycle-availability.ts`
- `apps/api/src/modules/master-plan-system/master-plan.lifecycle.postgres.spec.ts`
- `apps/api/src/modules/master-plan-system/master-plan.lifecycle.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.module.ts`
- `apps/api/src/modules/master-plan-system/master-plan.monthly-base.ts`
- `apps/api/src/modules/master-plan-system/review-due-date-import.application.service.ts`
- `apps/api/src/modules/master-plan-system/review-due-date.application.service.ts`
- `apps/web/src/modules/master-plan-system/MasterPlanDemandLinkDialog.spec.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanDemandLinkDialog.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanPages.spec.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanPages.tsx`
- `docs/operations/MPS_PHASE1_RELEASE_READINESS.md`
- `docs/operations/MPS_UNIFIED_ID_IMPLEMENTATION_PROGRESS.md`
- `docs/operations/MPS_UPSTREAM_DOWNSTREAM_LINKAGE_DESIGN.md`
- `docs/operations/TASK_REGISTRY.md`
- `outputs/主计划系统修复进度.md`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/master-plan-demand-links.spec.ts`
- `packages/contracts/src/master-plan-demand-links.ts`
- `packages/contracts/src/master-plan-lifecycle.ts`

### 6. 历史保护、风险与发布条件

- 本轮未连接生产执行写入/迁移/同步；未回填4083候选、1981历史、744人工及3冲突。上述数字仍是2026-11-05评估快照，不能作为新回填清单。
- 652来源/634固定基础ID/3组人工计划数量变更及真实报工/入库未处理。本轮没有重读生产核数，不能把合成验收当成生产逐条核验。
- 原代表来源归档/身份不明的旧匹配仍保留阻断，不通过首次绑定命令擅自更换代表来源；完整来源失效/恢复联动留后续。
- 关联不是有效需求状态：归档来源、LEGACY_RETAINED、ON_HOLD、CANCELLED不能因绑定ID自动激活。历史歧义保持NULL或拒绝；不做正则别名强绑。
- 119/120及121有前向保护，不能删除触发器/降Migration或整库回滚覆盖新报工。生产故障使用已验证兼容镜像/受控前向修复；不清空关系或回退真实数量。
- 方案A技术GO限118/119；正式窗口须按发布评估备份、退出旧Worker、严格名单迁移、API/Web启用和真实健康/权限/报工/30分钟六配置验收。没有生产Chrome验收或实际发布版本，本轮不部署。
- 121是独立发布范围；必须明确批准名单及SQL锁窗口，保持无历史回填；120历史过渡未解决时不能混入。121不会解除方案B原NO-GO。
- 本轮只注册一个人工关联命令，没有新增任务系统、基础设施、第三方依赖、调度或默认员工授权。

### 7. 后续第2/3轮（尚未开发）

- 第2轮：需求差额视图与显式分配/拆合批命令、数量减少风险预览、ON_HOLD占用、已完成/入库去重抵扣；明确哪些批次变更，不覆盖人工排产。
- 历史分类确认须独立授权，按当时真实版本/身份重新预览，解决源别名/人工归属；不能自动批量回填或替换634个固定ID。
- 第3轮：评审版本→基础批次的显式应用关系、选定批次交期应用与历史追溯，不按批次号数值化或更新时间自动广播。

### 8. Git与结束

只提交上述文件，正常推送github/main，不强推；最终SHA及远程校验结果见本文件Git历史与最终回复。原outputs/CODEX_PROGRESS.md的260行修改、财务截图和订单定向清理记录保留。本轮完成后停止，不进入下一轮或生产操作。


## 集中开发第2轮（2026-11-06，已完成代码与隔离验收）

### 实现范围与安全边界

- 基准dd819335；不部署、不执行生产Migration、不修改生产权限/业务、不批量回填历史ID。
- 月度UUID仍为需求根、基础UUID仍为批次；不新增主表、周/报工需求ID、依赖或任务系统。无新增Migration，118～121原件保持。
- 双页面行菜单复用Modal/Table/Select，展示精确数量、关联可信度与阻断原因；首次未确认关联不按0。计划全量、履约、未执行占用、暂停占用、取消后履约分别核算。
- 显式INCREASE/NEW/REDUCE/SPLIT/MERGE先预览再确认。父/双方版本、完整快照摘要、原因、租户/字段/双方数据范围、事务审计、幂等及串行化有界重试；并发先锁父/批次/周计划。
- 新增或增加受可信待分配量限制；减少受超额和执行保护限制；拆批和合批仅部分安全未执行数量，原批次必须保留正数量及ID。任何已执行/工艺锁/入库源或目标不合批，不删除/重挂报工。
- 新批次复用业务字段、交期编码生成器与121正式关联；缺少必需属性明确阻断并要求核实模板，不猜测日期。
- 显式数量归属由现有审计标识，后续月度→基础不自动覆盖；基础→周仍为原1A Outbox，保存仅PENDING并查询真实结果。
- 成品履约核验canonical staging租户/来源/客户/稳定订单品项及数量，不求和工序报工。不认可旧FIFO周计划分摊为实际批次证据；多批次存在入库或证据不全时明确待确认，不自动分摊。取消后已证实履约仍占用；ON_HOLD保留占用，非ACTIVE需求不允许差额驱动新增。

### 权限保存根因与只读证据

- 生产真实目标组存在deliveryNumber.read=true/update=true，当前定义editable=false。Web旧状态与保存全字段携带true，操作修改触发后端全量字段校验；生产已部署校验代码只读重放返回HTTP400同一业务消息。
- 未发送真实生产PATCH，也未修改权限。异常74条字段授权，13组资源/类型、11个资源：只读编辑4条、未知旧字段70条；无员工隐私明细进入Git。
- 共享PATCH锁权限组，合并本次实际字段变更，保留合法未提交字段；旧非法字段收紧有独立审计，主动readonly=true仍400。UI打开/复制/全选/提交均裁剪readonly；认证实时claims过滤非法字段update，不改操作授权并集。
- 当前组create=false不代表员工无其他create来源。相同组ID、成员、范围、其他组与普通角色继承保留。

### 隔离验收入口

- 独立PG18容器network=none/tmpfs，仅专用Unix socket；合成数据，无生产连接。
- 新数量、共享权限及回归最终结果见下表；不得据此宣称全仓库PASS。
- 最终相关Web5套67项PASS，包含新增首批创建及权限旧状态。
- 第3轮评审批次应用未开发：不广播交期，不创建评审→基础应用关系。

### 通用权限只读影响汇总

以下为权限组字段授权条数，不是员工数或权限组数；没有执行生产修改。当前普通角色未发现相同异常。目标组取消create后仍须结合其他组/角色查授权来源。

| 资源 | 旧未知字段 | 只读字段编辑授权 |
|---|---:|---:|
| `mps-base-plans` | 2 | 1 |
| `mps-customer-divisions` | 1 | 0 |
| `mps-erp-orders` | 1 | 0 |
| `mps-group-plans` | 1 | 0 |
| `mps-monthly-plans` | 24 | 0 |
| `mps-order-allocations` | 0 | 0 |
| `mps-process-cycles` | 18 | 0 |
| `mps-process-reports` | 0 | 0 |
| `mps-review-due-dates` | 4 | 0 |
| `mps-shipping-plans` | 0 | 2 |
| `mps-weekly-plans` | 14 | 1 |
| `mps-weekly-process-plans` | 3 | 0 |
| `order-schedule` | 2 | 0 |

### 第2轮正式接口与文件边界

- `GET /master-plan-system/demands/:id/quantities`：受范围保护的正式数量核对。原需求数量独立保留；LEGACY有效需求待确认、CANCELLED有效需求为0只为查询派生，不修改原始数量。
- `POST .../quantities/preview`、`POST .../quantities/confirm`：MpsQuantityRequest/Confirm，显式操作、精确数量、可选源/目标、新批次受限业务属性、需求及批次版本、摘要、原因、幂等键。
- `GET .../quantities/status/:eventId`：仅本租户、该需求及获权范围的原Outbox事件状态与错误，不把命令提交当成下游成功。
- 没有批次时可填写获权的计划日期和生产属性创建首批；字段沿用普通新增的服务端类型、字典、权限和数据范围校验。模板或手工填写均不猜测评审日期。
- 已有入库但缺少稳定批次履约关联时，不允许用新增批次破坏原唯一归属；可合法增加原批次，不能虚构多批分摊。入库staging尚未投影时也不按零履约计算。
- 多批/执行风险不明、历史NULL、异事业部或租户、预览过期、版本及幂等冲突均拒绝；调整后数据范围重新检查。
- API核心：`master-plan.demand-quantity.service.ts`、`master-plan.demand-quantity.ts`、控制器/Module、原Application新增属性验证复用入口、`master-plan.monthly-base.ts`显式数量所有权保护、`master-plan.demand-link.service.ts`复用范围读取。
- Contracts：`master-plan-demand-quantity.ts`及index出口。Web：`MasterPlanDemandQuantityDialog.tsx`、原`MasterPlanPages.tsx`双页面行菜单；通用权限为`TablePermissionsPage.tsx`。
- 共享权限：`table-permission-group.application.service.ts`、`auth.ts`；保留未变更成员绑定记录ID及审计字段，新增限制提示与审计配置快照。Skill第7.5节补充保存兼容规则。

### 第1轮76个Web失败的对照

- 本轮完整Web命令明确使用`vitest run --maxWorkers=1 --testTimeout=20000`，不是将参数错误放在`--`之后。采样579项：530通过、49失败。
- 与第1轮76个失败按文件及用例标题逐项匹配：其中27项本次通过，49项仍失败，没有旧用例丢失或凭名称改动消除失败。
- 在独立detached工作区、基准`dd819335`原代码，对这49项精确标题重放：49项全部失败，失败集合与当前完全一致；另49项同文件无关用例被精确过滤跳过。新功能相关定向组件测试通过。
- 11个既有失败文件：AdminWorkspace、AdministratorsPage、EquipmentPages、LogisticsLedgerPage、MarketingPages、HumanResourcesPages、NotificationCenterPage、SupervisionPages、MasterPlanDashboard、MasterPlanDashboardDestination、master-plan-auxiliary-groups。
- 失败表现为既有页面fixture行/按钮不出现、105%断言、默认月份/日期预期及旧工序组字段预期。不是本轮修改了这些模块；相关源码与基准相同。严格结论为基准可复现、当前未增加失败，不能把旧76项全部归因于超时，也不能宣称全Web PASS。
- 诊断原件、JSON、单worker基线比较仅ignored `test/mps_round2/`，不提交真实权限记录、UUID、凭据或数据库。

### 第2轮最终验证与生产边界

| 检查 | 结果 |
|---|---|
| API相关17套 | 331/331 PASS；最终认证收紧另有认证定向复验 |
| 真实隔离PG | 121项：本轮18项（含真实权限事务）＋原103项 |
| Web计划/生命周期/需求/权限5套 | 最终67/67 PASS；新增/权限2套7项也单独通过 |
| Web全量一次 | 579项530PASS/49FAIL；49项全部在原dd819335复现，不宣称全仓库通过 |
| Contracts | 10套49项PASS |
| API/Web/Contracts typecheck、lint、build | PASS；Web既有ModulePortal热更新warning、bundle体积提示，以及测试环境React/pg/ts-jest兼容提示保留 |
| 严格phase-a编译入口 | 117真实基线，仅执行118、119；重复no-op，120/121不运行；实际120后拒绝 |

- 无新增Migration、不改118～121；121→120及120→121旧回归均通过。数量功能依赖121单独发布，不能混入118/119方案A名单。120历史过渡仍NO-GO，本轮不修复也不启用。
- 生产仅只读事务、只读代码校验重放；无部署、Migration、配置/权限/业务写入、同步触发或历史回填。未处理652/634/3组人工变更、11/1旧事件及既有历史异常。
- API/Web代码及隔离测试通过与生产上线条件不同；本轮没有生产浏览器验收或上线交付结论。
- 本轮安全Git同步只含任务文件，其他进度/财务截图/订单清理任务原样保留。最终SHA见本文件提交记录及最终答复。

### 明确保留的限制及第3轮

1. 完整合并至源批次零数量、关闭源批次、移动报工或库存不支持；本轮只做保留正数量及ID的部分安全合批。已执行、工艺锁、入库及生产属性不兼容均拒绝。
2. 多批次履约归属不足时，暂无自动分摊或新的履约事实表；显示待确认并阻断新增/释放。已有入库单批也不允许无稳定归属地再增加批次数量。
3. 120历史LEGACY过渡、全链暂停/取消恢复及历史ID批量回填不在本轮。数量查询不把LEGACY视为ACTIVE，保存不绕过原同步阻断。
4. 第3轮仍需评审批次应用：确认评审→基础批次关系、版本/选择/预览/授权/审计及批次化日期应用；本轮不会广播评审日期，停止等待后续安排。
5. 49个既有Web失败作为独立维护事项，包含fixture/页面期望差异；不为本轮通过而修改无关模块或减测试。

### 本轮修改文件（26项）

- `.agents/skills/kdos-form-platform/SKILL.md`
- `apps/api/src/auth.spec.ts`
- `apps/api/src/auth.ts`
- `apps/api/src/modules/admin/table-permission-group.application.service.spec.ts`
- `apps/api/src/modules/admin/table-permission-group.application.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.application.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.controller.ts`
- `apps/api/src/modules/master-plan-system/master-plan.demand-link.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.demand-links.postgres.spec.ts`
- `apps/api/src/modules/master-plan-system/master-plan.module.ts`
- `apps/api/src/modules/master-plan-system/master-plan.monthly-base.ts`
- `apps/web/src/modules/master-plan-system/MasterPlanPages.tsx`
- `apps/web/src/modules/permissions/ReviewDueDatePermissions.spec.tsx`
- `apps/web/src/modules/permissions/TablePermissionsPage.tsx`
- `docs/operations/MPS_UNIFIED_ID_IMPLEMENTATION_PROGRESS.md`
- `docs/operations/TASK_REGISTRY.md`
- `outputs/主计划系统修复进度.md`
- `packages/contracts/src/index.ts`
- `apps/api/src/modules/master-plan-system/master-plan.demand-quantity.postgres.spec.ts`
- `apps/api/src/modules/master-plan-system/master-plan.demand-quantity.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.demand-quantity.spec.ts`
- `apps/api/src/modules/master-plan-system/master-plan.demand-quantity.ts`
- `apps/web/src/modules/master-plan-system/MasterPlanDemandQuantityDialog.spec.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanDemandQuantityDialog.tsx`
- `packages/contracts/src/master-plan-demand-quantity.spec.ts`
- `packages/contracts/src/master-plan-demand-quantity.ts`

- 全Web579项为补充首批组件用例前的采样；新增1项已包含最终67项定向重验。最终数量/认证修订分别21项定向复验PASS，未将重复运行累计成额外覆盖数。隔离资源已清理，生产未发布。


## 集中开发第3轮（2026-11-06）：评审批次应用与完整联动验收

### 1. 实现及边界

基准 `e90cc480e0d743d30063f092761e48665613d935`，继续main，未回退前两轮。生产未部署、未迁移、未触发同步、未写业务或权限；未回填历史需求ID/评审批次。其他任务的outputs/CODEX_PROGRESS.md、财务截图、订单定向清理进度保持原样。

- 需求根为月度UUID；基础UUID为独立批次；周计划base_plan_id、报工weekly_plan_id保持。评审UUID与明确勾选的一个或多个基础UUID形成关系，未勾选不应用，绝不将评审批次号转换为基础交期编码自动绑定。
- 日期依据：既有评估第7.1节及Migration116将due_date定义为客户交期、inbound_date定义为最新评审交期。固定映射仅为 `review.inboundDate → base.latestReviewDueDate`；不修改客户交期，不使用previousInboundDate补造历史，不把inboundDate当仓库事实。SQL date按本地日历读取，避免中国时区UTC序列化退一天。
- 新增Application Service复用需求关联范围校验；要求评审read/update、基础read/update、月度read，身份和展示字段read、评审inboundDate和基础latestReviewDueDate的update，双方read∩update数据范围。NONE不作为放行范围；跨租户/事业部及改后超范围拒绝。没有新增授权或自动授予普通员工高风险能力。
- 预览包含当前评审/基础版本、候选数量/日期、执行或工艺保护、明确选择及差异、阻断原因和SHA256摘要。确认使用SERIALIZABLE、行锁、expectedVersion、原因、幂等键、摘要复核及同事务审计；陈旧预览和并发冲突409，校验或审计失败全部回滚。
- 已有应用的评审身份不能通过普通编辑或Excel修改。现有初始化替换在confirmed monthly_plan_id存在时本已拒绝，122的RESTRICT FK进一步保留关联事实；正常稀疏更新保留UUID、source_*、审计和版本，不触发任何日期广播。
- Web复用现有评审页面/弹窗/表格，显示“关联基础计划 / 应用交期”。默认无选中；旧API不提供能力、122缺失或无权限均隐藏入口。版本冲突可刷新评审与基础版本重新预览；失败保留选择、原因及同一幂等请求。保存和真实下游同步状态分开显示。

### 2. Migration122及不可变历史

`1722920122000-MpsReviewBatchApplications.ts`，依赖119/121，120可选但不作为本轮生产名单。

- 仅DDL：`mps_review_base_plan_links`、索引、租户RLS、复合租户FK、唯一应用键、两个保护触发器；无历史业务DML，不修改118～121。
- 每个实际应用版本追加一行UUIDv7证据：tenant、review、base、reviewVersion、应用日期、APPLIED状态、version=1、操作者/时间及对应Outbox UUID。关系由稳定review/base ID确定，同一对的多版本追加保留；不能UPDATE/DELETE旧证据。
- 数据库检查同一确认月度需求、订单/品项/事业部、当前评审版本/日期与实际基础日期、ACTIVE状态、同事务获权审计、匹配的定向Outbox；其他评审不能静默接管已有关联批次。
- 评审版本递增后，历史版本/日期保留，Web显示“有新评审待应用”，不会自动改基础计划。明确再次确认后新增版本证据，原证据不变。
- 同版本不同幂等键仍不新增应用/队列；相同键重发返回原回执；同键不同内容拒绝。NO_CHANGE只表示没有新应用，历史事件FAILED不能伪装成功。
- 已有评审需要换到另一评审或修正既有应用证据时，当前安全行为是阻断；本轮不提供抹除/覆盖历史的操作。这是受控业务边界，不影响指定批次采用及更新同一评审版本。

### 3. 原同步消费者的最小扩展

沿用1A现有三表、租约、版本代际、幂等、事务结果与消费者；不增加调度器、n8n、Timer或全局黑名单。

- 应用与原Outbox在同事务提交，scope_json为明确排序的basePlanIds，sync_key仍base-to-weekly。仅所选基础、对应周计划及执行任务进入刷新；未选B2即使存在合法人工周计划日期差异，也不会被该事件刷新。
- 定时全量调用scope=null保持原行为；execution-rollup保留weekly/process范围。非空非法范围拒绝，不得回退全租户执行。
- 定向范围每个目标都必须通过原weeklyAdmissionSql；缺少准入字段返回BLOCKED，按既有1A协议记录FAILED及BLOCKED原因，可修复后真实重试。不能把零行同步当完整SUCCESS。
- 已报工后的交期倒排继续依赖107/108保存工艺；不改顺序、集合、标准周期或真实报工任何字段。119保护继续有效。
- 120的全租户非ACTIVE阻断没有绕过；122结构能与120前后组合，但120生产仍NO-GO。

### 4. 隔离验收与发布预演

专用PG18 Docker：network=none、无host端口、tmpfs数据库，仅指定隔离Unix socket；只用合成账号/业务数据。诊断原件仅ignored `test/mps_round3/`。

| 场景 | 结果及断言 |
| --- | --- |
| A严格编译CLI | 真实117基线仅执行118/119，ledger119；重复no-op，无120/121/122；实际执行120后拒绝该入口 |
| A新版API/旧Schema | Nest HTTP启动、meta能力false、应用GET/预览/确认409无缺列500；正常分配/基础/周计划/报工与六项30分钟到期配置通过 |
| B严格编译CLI | 真实119基线只执行121/122，ledger总121（跳过编号120）；重复no-op，API能力和HTTP路由可用 |
| B迁移失败恢复 | 注入合成122函数名称冲突，121与122及ledger全部回滚至119；移除合成冲突后同一编译CLI重试成功。未删除任何保护触发器 |
| 正常全链 | 新分配→同一月度需求→基础→周计划→10工序→正式Application报工→进度查询，核对数量及UUID关联 |
| 60＋40与需求＋20 | 两基础/周计划/两组报工独立；需求增长保留批次数量，显式分配20后80＋40；原报工整行不变 |
| B1单独应用 | v1仅B1改变评审交期、客户交期保留；B2基础/周计划/工序整行不变，B1真实报工整行及锁定工艺结构不变 |
| v2待应用/历史 | 修改评审仅提示pending；未确认前基础日期不变；确认新增v2证据，v1原行不变 |
| 幂等/并发/越权 | 双目标两条证据/一事件，同版本不重复；并发仅一提交；跨需求/租户/事业部、NONE/缺字段/只读、版本过期拒绝 |
| 审计/队列/失败 | 审计失败全部回滚；准入失败真实FAILED/BLOCKED原因，修复后同事件重试SUCCESS；1A FAILED再失败、租约及旧Worker回归保留 |
| Excel与权限保存 | 同UUID正常日期导入升版本、原基础不变；已应用身份变更409。第2轮事业四部权限保存、成员ID/只读字段/继承回归，不重复开发 |
| 120组合 | 121/122→120，以及独立119→120→121/122真实迁移均兼容；LEGACY保持阻断且开关不能绕过，正式B入口发现120拒绝 |

### 5. 最终验证结果（核心功能验收PASS）

| 验证 | 最终结果 |
| --- | --- |
| 相关API（含真实PG） | 18套349项PASS，最终同一汇总运行；其中6套真实PG共138项，新评审PG17项 |
| Web定向组件/页面 | 6套27项PASS，包含评审应用/能力门禁、数量/关联/生命周期及权限保存回归 |
| Contracts | 11套50项PASS |
| 全Web | 587项538 PASS /49 FAIL，无跳过；与第2轮579项的49个失败按文件+完整用例名完全一致，新增失败0、旧失败减少0 |
| 类型检查 | API、Web、Contracts PASS；API最终构建亦完整检查测试源 |
| lint | API、Web、Contracts PASS；Web现有ModulePortal热更新1 warning保留，无新增错误 |
| 生产构建 | API、Web、Contracts PASS；Web已有大包提示保留 |
| 独立发布入口 | A严格118/119及B严格121/122、重复no-op、真实120拒绝、事务失败恢复PASS |

全Web实际采样为最终新增组件/页面用例全部存在后的587项，与旧579项差8（第2轮后补1项、本轮5项应用弹窗＋2项页面能力）。49项集中于原11个文件：AdminWorkspace3、AdministratorsPage1、EquipmentPages6、LogisticsLedgerPage2、MarketingPages2、HumanResourcesPages1、NotificationCenterPage4、SupervisionPages25、MasterPlanDashboard1、MasterPlanDashboardDestination1、master-plan-auxiliary-groups3。旧49已于第2轮在dd819335精确标题复现；本轮比较集合完全一致，未修改/删除/放宽它们，不将定向PASS称作全仓库PASS。

原始日志/JSON/逐标题集合比较仅ignored test/mps_round3（api-final.json、web-all.json、web-comparison.json、phase-a-final.log等）；不提交业务快照或数据库。Node24，真实PG无网络出口。现有ts-jest处理dist JS及pg并发查询弃用warning保留，均非用例失败。

### 6. 发布决策与操作顺序（本轮不执行）

- **路线A技术GO**：仅118→119，保护功能上线；新评审/数量/需求关联入口由Schema能力隐藏。不能把121/122混进A，不能用默认全pending `db:migrate`。
- **统一ID路线B技术GO的隔离依据**：在完整119基线上执行121→122，无120；使用 `pnpm --dir apps/api db:migrate:unified-core` 或相同构建产物的 `node dist/migrate-unified-core.js`。该路线B与原评估中“整体含120的方案B”不是同一名单，后者仍NO-GO。
- 技术GO只表示代码和合成发布协议通过；不表示生产已具备现场条件。需获权窗口重新核实生产ledger/schema/版本、配置实际启用状态、备份恢复可用性及消费者来源。

下一轮获权生产窗口：

1. 从最终已推送SHA建立干净发布工作区；记录API/Web/Contracts产物及SHA，检查敏感文件，不携带其他未完成修改。预构建镜像，核对现有 `scripts/deploy.sh` 的安全要求，不改脚本。
2. 只读复核生产ledger及119/121/122结构是否已执行；发现120/未来结构/ledger不一致立即停止。核实六项配置当时实际enabled和interval，不根据旧文档猜测；保留原状态。
3. 进入维护窗口，阻止新主计划写入；按现有正式配置命令保存并暂缓相关同步入口，排空已有事件，停止所有旧API内MPS消费者，验证不存在旧Worker/人工入口。ERP源采集等无关任务维持原状。
4. 完成正式数据库备份及恢复核验、锁超时监测。生产仍117时，先在无消费者条件运行构建产物 `node dist/migrate-phase-a.js`，严格118→119；重复安全。不得在已121/122的库上重新运行A入口。
5. 需要统一ID时再执行 `node dist/migrate-unified-core.js`，严格121→122；要求完整119、没有120，拒绝不一致结构。核对ledger迁移名称，不能把总行数121误当作执行了编号120。
6. 按既有发布流程从干净工作区发布匹配的API与Web（本轮涉及两者）：`./scripts/deploy.sh api`、`./scripts/deploy.sh web`、`./scripts/deploy.sh check`。实际生产配置由正式环境提供，不在命令或日志中暴露凭据；不改生命周期写开关、不迁移120。
7. 在受控测试范围验收：正常新增分配/统一关联、60＋40显式数量操作、正式报工/纠错、评审B1-only应用及v2待应用、真实队列结果、旧NULL历史可查、普通员工/跨事业部拒绝、前后Web/API SHA；真实Chrome验证可见效果。
8. 恢复原有已启用任务及频率，确认原60秒检查器和实际30分钟任务两轮日志/Outbox真实一致、无重复消费/重复计划。不能自动重放11条旧矛盾或1条NULL租约RUNNING；另行调查授权处理。
9. 对照保护基线/当时快照核验652/634/3组人工数量及真实报工/入库未改变；旧25/3分类异常只读保留，不为了验收凑数量或修复历史。

安全恢复：迁移事务失败时保持维护窗口，确认ledger/schema事务回滚后修正原因重试。119或122已成功后，保留保护和应用历史，使用经过119/121/122兼容验证的修复产物前向恢复；不降级到会重写报工的旧API、不删触发器、不撤销应用证据、不用整库旧备份覆盖窗口后新增事实。写入尚未恢复且确认没有新事实时才讨论受控恢复备份；任何新报工后均须专项恢复方案。

### 7. 剩余事项

- 未发现本轮核心功能新增P0/P1阻塞；未通过放宽事实/权限保护换取通过；120的历史状态消费者过渡仍为原方案B的P1/NO-GO，不属于本次生产名单。
- 历史NULL及归属冲突需逐笔正式确认，不自动关联；跨评审接管批次、完整取消/恢复及完整合批仍按既定安全边界另行处理。
- 全Web49历史失败和生产现场前置条件必须单独保留，不能把定向PASS、隔离预演PASS或技术GO写成生产验收通过。

### 第3轮修改文件（29项）

- `apps/api/package.json`
- `apps/api/src/migrate-unified-core.ts`
- `apps/api/src/migration-files.spec.ts`
- `apps/api/src/migration-files.ts`
- `apps/api/src/migrations/1722920122000-MpsReviewBatchApplications.ts`
- `apps/api/src/modules/master-plan-system/master-plan.controller.ts`
- `apps/api/src/modules/master-plan-system/master-plan.demand-links.postgres.spec.ts`
- `apps/api/src/modules/master-plan-system/master-plan.module.ts`
- `apps/api/src/modules/master-plan-system/master-plan.review-application.postgres.spec.ts`
- `apps/api/src/modules/master-plan-system/master-plan.review-application.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.sync-runner.ts`
- `apps/api/src/modules/master-plan-system/master-plan.sync.service.ts`
- `apps/api/src/modules/master-plan-system/review-due-date-import.application.service.ts`
- `apps/api/src/modules/master-plan-system/review-due-date.application.service.ts`
- `apps/api/src/modules/master-plan-system/review-due-date.controller.ts`
- `apps/api/src/modules/master-plan-system/review-due-date.create.spec.ts`
- `apps/api/src/modules/master-plan-system/review-due-date.manual.spec.ts`
- `apps/web/src/modules/master-plan-system/MasterPlanReviewApplicationDialog.spec.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanReviewApplicationDialog.tsx`
- `apps/web/src/modules/master-plan-system/ReviewDueDates.spec.tsx`
- `apps/web/src/modules/master-plan-system/ReviewDueDates.tsx`
- `docs/operations/MPS_PHASE1_RELEASE_READINESS.md`
- `docs/operations/MPS_UNIFIED_ID_IMPLEMENTATION_PROGRESS.md`
- `docs/operations/MPS_UPSTREAM_DOWNSTREAM_LINKAGE_DESIGN.md`
- `docs/operations/TASK_REGISTRY.md`
- `outputs/主计划系统修复进度.md`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/master-plan-review-applications.spec.ts`
- `packages/contracts/src/master-plan-review-applications.ts`

第3轮专用network=none/tmpfs PG容器已清理；ignored证据保留。本轮源码提交与远程核对结果补记于主要进度文件，未执行生产发布。

第3轮主实现提交 `d47e43bd295bf1f9f50eba5618296b3e2c59c538`，已正常推送github/main并核实远程一致；仅本任务29文件，未强推。随后仅补记完成进度。
