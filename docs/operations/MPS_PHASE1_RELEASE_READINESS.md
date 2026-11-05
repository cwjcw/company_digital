# 主计划第一阶段生产上线评估与发布方案

评估日期：2026-11-05（Asia/Shanghai）。评估源码：main `755f6db586d53f7edddeba281deaac45c88fc7cd`。本文件是发布门禁和未来获权窗口的操作方案，**不是生产发布记录**。本轮没有部署、生产迁移、生产同步、配置变更或业务修复。

## 1. 决策

| 方案 | 当前结论 | 推荐 |
| --- | --- | --- |
| A：当前main，执行118、119，暂不执行120 | **NO-GO**：核心同步及报工隔离兼容通过，但生命周期入口尚无schema能力门禁，缺少120时取消预览返回500；默认迁移发现还会装载测试文件 | **优先路线**：先完成下述小范围发布兼容修复，再复验A |
| B：当前main，执行118、119、120 | **NO-GO**：历史LEGACY_RETAINED使租户生成同步整体失败；关闭生命周期写入开关仍失败 | 暂不推荐生产发布；需先完成历史过渡和逐记录消费者保护 |

推荐A的理由：尽快交付真实重试、租约代际和历史报工保护，同时避免把16,373条历史计划立即送入当前尚不兼容的生命周期生成门禁。**当前两个方案均不具备完整生产上线条件；推荐路线不等于GO。**

| 证据层级 | 本轮结论 |
| --- | --- |
| 代码测试 | 当前main定向API 6套126项通过，包含真实PG的1A34、1B25、1C27，共86项；API构建通过 |
| 隔离发布预演 | A核心业务链通过，但完整A存在入口兼容缺口；B成功复现发布阻断，不能记为发布通过；恢复保护演练通过 |
| 生产就绪 | A NO-GO，B NO-GO；本轮只读生产检查没有改变这一结论 |

## 2. 基准及生产只读证据

四个指定提交均为当前main祖先：1A `232a18e1e7ce37a107355efd7573cf4456a510af`、1B `85024453b8bbf41bd7cb6dde56f25375143a4a0e`、1C `aaf4ecb811147361825ac8ba967531c01b4444c3`、验收记录 `55e8b62e`。未切换到历史版本，未使用订单定向清理隔离worktree的未提交实现作为评估基准。

2026-11-05 19:17～19:29 CST采集；数据库查询使用REPEATABLE READ、READ ONLY、语句超时和ROLLBACK。容器、systemd、n8n SQLite均只读检查。原始证据仅留ignored `test/mps_phase1_readiness/`，不提交生产明细、凭据、备份或ERP数据。

| 项目 | 实际状态 |
| --- | --- |
| API `/api/v1/health` | healthy，`eeaac326d010c198f0edfdde1ecc9aa01e57c035`，尚无1A/1B/1C |
| Web `/build-info.json` | `755f6db586d53f7edddeba281deaac45c88fc7cd`，已含生命周期前端；API/Web存在版本差异 |
| PostgreSQL | 18.4；满足1A使用transaction_timeout、UUIDv7等已验证运行条件 |
| TypeORM ledger | 已执行至117（含112，实际ledger插入顺序不等于Migration编号）；118、119、120均未执行 |
| 三类计划schema | 无lifecycle_status；三类同步表无lease_expires_at，日志无attempts/scope_json新增列 |
| 月度/基础/周计划 | KAINAN分别6,278 / 6,811 / 3,284；120会把这些现有行全部标为LEGACY_RETAINED，合计16,373 |
| 正常同步配置 | 6项均enabled=true、interval_minutes=30、采样时SUCCESS；近2小时6项均有SUCCESS日志 |
| 历史Outbox与日志矛盾 | 11项：plan-projections 9、base-to-weekly 2；只表示状态矛盾，未推断业务未完成 |
| 旧RUNNING事件 | execution-rollup 1项，创建于11月3日，attempts=1；尚无可信租约，不自动恢复 |
| 报工历史 | 采样时4,990条；25条所在周计划为非工序制造方式，3条无启用工序，3条全部包含于25条；历史事业部与周计划不一致为0 |
| 当前父子差异 | 3,284周计划相对基础计划的订单/品号/事业部/交期编码、双方非空制造方式、计划数量差异均0；外协任务启用状态与制造方式差异0 |
| 事业三部保护集 | 固定634个基础计划ID全部存在、事业部匹配；身份/关联和当前数量指纹与1B最终基线一致，包含3组后续人工数量更正；没有回退数量 |

652条原始来源明细是既有验收基线；本轮复用原固定ID集合核验634个计划，未重新从ERP逐条提取652条原始明细，不将SQL中原有“652”标签冒充本轮新查数量。

同步表规模仅作迁移锁风险参考：采样时日志约17,373行、Outbox约5,114行；月度表含索引约42MiB。它们不能替代停写窗口中的锁耗时验收。

### 2.1 实际调度入口

- 主计划6项任务由API内 `MasterPlanSyncService.runDue()` 每60秒检查到期配置，并消费持久Outbox；Application写入也可触发同一消费者。当前没有独立MPS Worker容器。
- `document-worker` 是文档工作进程，不承担MPS事件消费，不能把它的健康当作旧MPS Worker已退出。
- systemd用户级3项ERP staging、3项ERP投影Timer仍以30分钟运行；基础采集和canonical投影不是MPS生命周期命令，不擅自停用。
- n8n实际17个工作流、13个激活、4个未激活；实例时区Asia/Shanghai。已核查节点目标，未见直接调用MPS生成/生命周期接口的工作流。科加01:00脚本和既有ERP采集仍维持原调度，不按重复任务整改。
- 已读取系统/用户Timer、cron数量和Docker摘要；未对无法读取的其他用户私有cron作“绝无入口”的承诺。发布窗口须再次确认没有额外API实例或人工脚本正在消费MPS。

## 3. Migration依赖和前向兼容

| Migration | 内容 | 历史数据影响 | 版本及恢复要求 |
| --- | --- | --- | --- |
| 118 `MpsSyncLeases1722920118000` | configs/logs/outbox各增可空lease_expires_at及过期索引；logs增attempts默认0、scope_json | 不重放事件、不把旧RUNNING补租约；旧SUCCESS仍无本版验证凭据 | 1A Runner在118之前不可运行；旧Worker必须退出；down拒绝删除租约和代际元数据 |
| 119 `MpsExecutionFactProtection1722920119000` | 6个函数、16个触发器；冻结报告上下文、保护已执行身份/任务，父行MVCC fence | 无事实回填、数量修正或新事实表；未知历史上下文继续明确未知 | 依赖生产已有表/字段和107/108工艺锁；新API必须已取消旧报工快照UPDATE；旧API不能作为119后的直接回滚镜像 |
| 120 `MpsPlanLifecycle1722920120000` | 月度/基础/周计划状态、约束、索引及执行守卫 | 现有行LEGACY_RETAINED；后续新行默认ACTIVE；不清零、不改ID/报工/工艺 | 在118→119之后执行；需要消费者过渡兼容；down拒绝删除状态及守卫 |

118、119、120在完整117迁移合成结构上按顺序执行成功。119/120数据库保护保持107/108为唯一持久工艺锁；没有替换工艺集合、顺序或周期。

**默认迁移命令的独立阻塞**：`apps/api/src/data-source.ts`扫描`migrations/*.{ts,js}`；当前tsconfig把`1722920117000-UserTablePreferences.spec.ts`编成dist迁移目录中的`.spec.js`，装载时实际报`describe is not defined`。生产旧镜像没有该编译测试文件。严格筛选时间戳实现文件的完整117重放、及显式选择118/119/120的TypeORM `runMigrations`均成功；这不代表当前默认`db:migrate`已可直接生产使用。发布前须修复迁移发现或提供经过验证的严格白名单执行入口，不能通过给生产注入假的describe来绕过。

## 4. LEGACY_RETAINED及正常业务影响

证据入口：`master-plan.lifecycle.service.ts:assertMpsLifecycleSyncReady`对三类表逐一锁定本租户全部行；只要任一行status不为ACTIVE即抛LIFECYCLE_BLOCKED。不存在按订单/品项排除的逻辑，也不读取生命周期写入开关。

| 入口 | A：118+119、无120（核心链） | B：当前main+120 |
| --- | --- | --- |
| plan-projections | schema缺列被to_jsonb回退为ACTIVE，正常生成 | 6,278历史月度足以整项阻断；甚至新订单也无法生成需求投影 |
| shipping-to-base | 合法月度正常生成/调整，人工字段保留 | 三类历史计划任一存在即整项阻断；基础计划生成停止 |
| base-to-weekly | 正常准入及更新；快照、事实保留 | 同样阻断；新周计划无法生成、已有周计划不能同步数量/交期 |
| execution-rollup | 按事实重算 | 没有同一生成门禁；隔离SUCCESS，保留历史报工与派生重算 |
| erp-orders / inbound-allocation | 复用原链路 | 未调用该整租户门禁；预演未证明所有暂停/取消业务下的入库消费者已完整兼容，不以此放开状态写入 |
| 正常新增/修改订单分配 | Command保存、投影链通过 | 分配可保存并入Outbox，但下游生成失败；不得将保存成功等同全链成功 |
| 既有周计划普通报工 | 实际Command通过，119保护原快照 | LEGACY_RETAINED在120 DB执行守卫和PENDING筛选中允许；历史详情及普通新增报工实测通过 |
| 周计划关键字段编辑/执行刷新 | 正常受1B及107/108保护 | ensureExecutionRows拒绝所有非ACTIVE；历史周计划数量编辑实际回滚，执行刷新受阻 |
| 三天工单从周计划同步 | 正常链路兼容 | 复用同一整租户门禁，受阻 |
| 历史查询/导出/权限 | 当前计划投影与历史快照分开，read∩export及历史事业部边界保留 | 原历史详情不按新状态隐藏，查询仍可用；没有生产Chrome/全体角色验收，不能替代上线后验收 |
| 60秒检查/30分钟同步 | 合成到期6项全部SUCCESS | 频率未变，三项将持续真实FAILED，不因关闭写入开关而恢复 |

120数据库允许历史报工，不能推出所有旧计划操作都兼容：API内部执行刷新另有严格ACTIVE判断。两层规则的差异是实际业务风险。

## 5. 两种方案的最小缺口

### 5.1 A：推荐先补发布隔离能力

1A、1B没有不可拆分的120数据库依赖。当前main在只运行118/119的完整结构上，核心链和主计划Controller能启动、metadata返回200，订单分配、基础/周计划和报工均成功。**但原样main仍不能完整发布为“A、1C不可用”**：当前Web管理员可见生命周期菜单；HOLD预览缺currentStatus；CANCEL预览实际SQLSTATE42703、HTTP500。

最小后续修复范围（本轮仅记录，未修改代码）：

1. 统一“生命周期schema已就绪”能力：API metadata明确能力；生命周期预览/确认在120缺失时提前返回可理解的不可用响应，不能先访问不存在的列；不能把关闭写入开关当作schema门禁。
2. Web消费该能力，隐藏尚未发布的生命周期状态操作；普通报工和1B事实展示保留。管理员`*`权限也不能绕过schema门禁。不通过改员工授权来隐藏入口。
3. 修复默认迁移发现的测试文件装载；A发布执行名单明确仅118、119，禁止无条件扫描运行全部pending并顺带执行120。
4. 为以上缺口补定向无120/有120契约和HTTP验证，形成干净正式提交及可审阅发布清单。无需新增数据库Migration。

优先在当前main上增加兼容保护，不删除1C，不回退main、不覆盖其他功能。若组织要求专用发布分支，从当前main建立、仅加入上述兼容提交；禁止直接把API切回85024453或历史版本来拼装。

生产API到main的差异还包含财务查询/筛选及权限组校验的既有修改。构建当前main不会丢失它们，但会一起进入API镜像；发布前须复核这些差异的既有验收。Web已为755f6db，不为凑版本无条件重建；A需要新增Web能力判断时才发布对应Web。

### 5.2 B：历史过渡和消费者尚需修复

最小保护范围不是批量确认历史ACTIVE，而是把状态识别落到具体来源/目标记录及既有执行刷新：

- 为LEGACY_RETAINED明确历史连续报工/已保存工艺合法重算的过渡能力，维持未知来源标记；涉及新增需求必须核实合法有效来源，不能把所有历史记录视为已确认需求。
- 三段生成与工单消费者只处理允许的来源；暂停/取消记录和受保护目标不得upsert复活；一条异常不能冻结同租户全部正常订单。
- 部分完成、跳过/待核实必须返回真实计数与BLOCKED/失败原因，Outbox不能因“处理了其他行”误报全量SUCCESS；维持1A结果验证和并发锁。
- 核对集团有效需求、月度/基础取消消费者及入库/其他执行的历史关联；继续保持生命周期写入默认关闭、父计划取消/取消后恢复硬门禁。
- 完成全状态、混合历史/新计划、跨事业部、并发、暂停/取消后事实与查询回归，再评估是否GO；不必提前建设完整第二/三阶段级联平台。

现有120结构未发现必须新增字段的缺口，主要是API/消费者过渡规则。后续若需修正已应用的120，应新增兼容前向Migration，不修改已落地迁移或删除触发器。

## 6. 隔离预演结果和限制

环境：独立PG18.4容器`kdos-mps-phase1-readiness`，network=none、无发布端口、tmpfs数据盘，仅专用Unix socket；从空库完整执行117条迁移，合成订单/事业部/权限主体，不复制生产业务行或生产DSN。读取生产镜像中的编译代码用于旧版本基线，数据库连接始终指向隔离socket。

| 预演步骤 | 实际结果 |
| --- | --- |
| 生产版本代码+117结构 | 实际Application生成基础/周计划、10工序任务、保存报工成功 |
| 旧Worker退出 | 关闭旧DataSource及连接再迁移，未与新消费者并行；生产未停机 |
| 118、119顺序迁移 | TypeORM显式名单、ledger成功写入隔离库 |
| 新API相关服务及Controller | 真实Controller隔离Nest启动，业务Application/Query/Sync使用真实PG；没有启动整个生产Compose和全模块AppModule |
| 新分配→月度→基础→周计划 | A全部SUCCESS，周计划准入由正式Command补充；保留同一父子ID |
| 新报工、计划数量变化 | 报工ID、数量、日期、快照、updated_by/at/version完整行不变；当前周计划量合法更新 |
| 6任务恢复/30分钟到期 | 合成last_started_at回拨31分钟，真实runDue识别6项并全部SUCCESS，仍enabled/30分钟；未等待真实30分钟，不冒充生产自动恢复验收 |
| A生命周期入口 | metadata 200；无120的CANCEL预览HTTP500 / SQLSTATE42703，HOLD缺当前状态；完整A未通过 |
| 旧Worker误回退 | 119后旧代码重写报告计划快照被ck_mps_report_context /23514拒绝；事实未变化 |
| 120执行中断 | 事务内应用后模拟失败，schema和ledger前状态恢复，事实不变；证明未提交DDL可整笔回滚 |
| 120提交 | 历史计划LEGACY_RETAINED；新租户新计划ACTIVE；历史行身份/事实未改 |
| B三段生成及关闭开关 | 三段均LIFECYCLE_BLOCKED；HTTP同步409；新分配能保存但投影失败 |
| B历史报工/详情 | 普通新报工仍成功；实际报工查询和待报工查询可读；rollup SUCCESS |
| B旧周计划编辑 | 关键字段触发ensureExecutionRows，LIFECYCLE_BLOCKED并回滚 |
| B单条暂停与无关记录 | 同一新租户仅一周计划ON_HOLD，即使另有正常基础计划，整项base-to-weekly仍被阻断 |
| FAILED重试/再次失败、租约超时/迟到Worker、多Worker/并发 | 当前main既有真实PG34项1A回归全部通过；日志/Outbox/事务结果一致，旧无租约事件不自动补偿 |
| 1B/1C保护回归 | 25+27项真实PG通过；事实、工艺、身份、权限、纠错、幂等及预览保护通过 |
| down保护 | 118、119、120全部按设计拒绝down；没有删触发器来制造回滚成功 |
| 备份恢复 | 合成库pg_dump/pg_restore到独立新库成功；月度、基础、周计划、工序任务、报工、审计六表完整行/ID指纹一致（4条合成报工、30任务），119/120守卫保留 |
| 当前默认迁移发现 | 实际失败describe未定义；严格实现名单的完整重放成功，缺口保留 |

API定向命令（专用测试容器启动后，仅使用固定隔离socket）：

```bash
KDOS_SYNC_RELIABILITY_TEST_SOCKET="$PWD/test/mps_sync_reliability/pg_socket" pnpm --filter @tracker/api exec jest --runInBand --testPathPatterns='master-plan\.(sync-runner|fact-protection|lifecycle)\.postgres\.spec|mps-(sync-leases|execution-fact-protection)\.migration\.spec|master-plan\.sync\.service\.spec'
```

6套126/126通过；API build退出0。宿主Node22提示项目要求Node24，生产镜像为Node24构建目标；本轮不宣称完成新发布镜像的全模块启动、真实生产Chrome或生产规模压测。独立恢复/迁移预演和既有小夹具PG回归分库/分schema，未连接生产写测试。

## 7. 上线风险及门禁

| 风险/触发条件 | 严重程度 | 现有保护 | 缺失及发布前措施 |
| --- | --- | --- | --- |
| 120落地即产生历史状态，三段生成停摆 | 严重/P0 | 真实FAILED，不假成功、不复活 | B禁止上线；先完成逐记录兼容和历史过渡，禁止批量ACTIVE |
| 历史周计划关键字段编辑回滚 | 高/P1 | 事务回滚、事实保留 | B需统一合法历史刷新策略和回归 |
| A生命周期菜单调用缺列接口 | 高/P1 | 写入开关关闭，不实际改状态 | schema能力门禁、Web入口隐藏及HTTP契约 |
| 默认迁移装载spec导致升级失败 | 高/P1 | 装载失败发生在迁移执行前 | 严格实现发现/名单，先在构建镜像内验证 |
| 代码先启用但118未落地 | 严重/P0 | 查询报错，不可工作 | 旧API退出后迁移，随后启动新API；不能先deploy.sh启动再迁移 |
| 119后恢复旧API | 严重/P0 | DB拒绝快照/身份覆盖 | 禁止旧镜像回退；准备保留119的新版本恢复路径 |
| 旧/新Worker混跑、旧协议确认SUCCESS | 严重/P0 | 新Runner租约/版本栅栏 | 旧Runner不遵守新协议，必须停止所有旧API实例、连接排空后切换 |
| 旧无租约RUNNING或11矛盾被自动重放 | 高/P1 | 1A不自动消费旧SUCCESS或无租约RUNNING | 保留证据，独立获权业务核查；不得借上线重置状态 |
| 1B拒绝真实身份迁移，合法数量调整被误判 | 高/P1 | 事实判定、独立纠错、107/108 | A正常数量/纠错隔离通过；发布后观测约束错误并定位，不放松保护 |
| 25/3历史报工因制造方式被隐藏或泄露 | 高/P1 | 1B历史详情及事业部裁剪 | 历史基线只读复核、获权角色查询验收；不修复原事实 |
| DDL锁等待、索引影响在线写入 | 高/P1 | PostgreSQL事务DDL；生产规模已统计 | 维护窗口停MPS写入，设置锁/语句超时，锁失败整笔退出，不终止无关事务 |
| API自动调度抢在验收前运行 | 高/P1 | 六项配置可通过正式API版本化修改 | 未来发布窗口先排空事件、保存并受控关闭六项配置；新API验收后逐项恢复，不改本轮生产配置 |
| 合并main部署带入其他已完成功能 | 中/P2 | 干净source、SHA、独立部署范围 | 审阅实际差异；包含财务/权限组变更时复用其验收，禁止历史版本覆盖 |
| 备份回灌覆盖上线后新报工 | 严重/P0 | 前向保护、独立恢复库 | 不直接覆盖运行库；新事实必须先完整保全、对账，回灌须另行审批 |
| 现有脚本只有build/start没有迁移与排空 | 高/P1 | deploy.sh干净源码检查及SHA健康 | 在其构建和启用之间执行下述排空/备份/名单迁移，不误称deploy.sh会自动迁移 |

## 8. 推荐A的实际操作顺序（满足门禁并另获发布授权后执行）

本节命令供下一次发布窗口使用；本轮没有执行。任何检查不通过，停止后续步骤。当前仍缺5.1修复，因此**不能现在照抄启动发布**。

### 8.1 发布前准备

1. 完成5.1兼容修复及相应测试；形成正式提交R，确认118/119代码和1B保护完整、120暂不执行；复核main中其他差异验收。
2. 使用干净linked source，`KDOS_RUNTIME_ROOT`指向现有runtime。保留当前API镜像ID/digest、Web SHA、数据库ledger、六项配置ID/version/enabled/interval，以及634固定保护集的受限指纹；不要复制.env到source，不含订单清理worktree。
3. 生产只读预检确认仍只待118/119/120、107/108有效、无真实运行中的MPS配置/查询；旧1条历史Outbox RUNNING作为已知例外单独登记，不假定仍有Worker。
4. 对R再次跑本文件的合成发布预演，确认生命周期缺schema时无入口/无500，默认迁移加载安全，目标镜像在118/119结构启动，兼容恢复镜像或前向修复入口可用。
5. 安排包含API短暂停机的维护窗口，阻止Web/Excel/脚本MPS新写入；源ERP基础采集和无关调度维持原状。

### 8.2 先构建，后退出旧消费者

复用现有部署函数，保留原干净源码及环境安全门禁，仅准备镜像、不启动消费者：

```bash
# 在正式提交R的干净source中执行；linked worktree先设置KDOS_RUNTIME_ROOT。
bash -c 'source ./scripts/deploy.sh; require_safe_env; assert_deployable_worktree; REPOSITORY_HEAD="$(git rev-parse HEAD)"; build_services api document-worker'
```

先通过现有认证API停止MPS业务入口写入，确认Outbox没有新PENDING/FAILED可执行事件、六项配置不在真实执行。保存配置后，逐项使用原配置API `PATCH /api/v1/master-plan-system/resources/mps-sync-configs/:id`（`expectedVersion`及`enabled:false`）暂关原6项30分钟配置，写正式审计；不改变interval、不直接UPDATE数据库。若队列或旧事务无法排空，停止发布，不能把RUNNING改SUCCESS来过门禁。

随后停止现有所有API实例（当前为单个api服务；MPS Worker嵌入其中），等待旧业务事务退出；可使用现有Compose `stop -t 330 api`。检查容器进程和数据库活动连接，保证没有旧MPS消费者。document-worker健康不算此项证据。正常退出及其已提交结果保留，不重置旧日志。不存在可信新租约的旧RUNNING配置需另行核验，不能自动补租约。

### 8.3 备份与限定Migration

运行现有`./scripts/backup.sh`，校验两库和uploads的SHA256与恢复目录清单。将生产备份保留在受限目录，不能提交Git。按已验证空目标完成恢复验证；不能对当前生产库试恢复。

API停机时，用R的新镜像作为一次性迁移容器。必须显式运行118、119；不运行无边界的`db:migrate`。如下是既有TypeORM ledger/事务机制的限定名单调用，不是新任务系统；linked source应使用deploy-common构造的同一COMPOSE数组，以免产生第二个项目：

```bash
# 在已source scripts/deploy.sh、require_safe_env和源码门禁通过的同一维护shell中：
"${COMPOSE[@]}" run --rm --no-deps -T api node <<'JS'
const source = require('./dist/data-source').default;
const M118 = require('./dist/migrations/1722920118000-MpsSyncLeases').MpsSyncLeases1722920118000;
const M119 = require('./dist/migrations/1722920119000-MpsExecutionFactProtection').MpsExecutionFactProtection1722920119000;
source.setOptions({
  migrations: [M118, M119], logging: false,
  extra: { ...source.options.extra, options: '-c lock_timeout=5000 -c statement_timeout=120000' }
});
(async () => {
  await source.initialize();
  try {
    const legacy = await source.query('SELECT name FROM migrations WHERE timestamp=1722920120000');
    if (legacy.length) throw new Error('120 already applied; stop A and review forward recovery');
    const done = await source.runMigrations({ transaction: 'all' });
    console.log(JSON.stringify({ applied: done.map(m => m.name) }));
  } finally { await source.destroy(); }
})().catch(e => { console.error('Migration failed', e.code || e.name); process.exit(1); });
JS
```

连接选项对迁移池内每个新连接设置锁/语句超时，避免普通SET只作用于某个连接。本轮已在完整117合成基线上验证该DataSource名单入口及三个连接的超时配置，确实只执行118/119、120仍缺失；正式执行前须在R构建镜像内复验。迁移118/119在同一事务内按顺序提交；失败时检查ledger及DDL后停止，禁止盲重跑。120仍应pending，不能以“已有120字段”硬继续方案A。

### 8.4 启用新API及验收，再恢复自动同步

1. 核对118租约字段/索引、119函数/触发器和107/108；报工/入库/保护集只读指纹一致；无生命周期列符合A预期。
2. 从R使用既有`./scripts/deploy.sh api`启用新API（脚本会构建/更新api和document-worker）；原六项配置仍禁用，队列已排空。确认镜像内嵌SHA=R、健康和主计划读接口通过。
3. 如果5.1增加Web能力判断，再以同一发布R执行`deploy.sh web`；无需为了数字相同重发无变化组件。逐组件记录期望SHA。
4. Chrome管理员及普通报工员核查：1C未发布入口隐藏，历史实际报工、待报工、字段权限/事业部范围正常；真实业务报工按正式Command工作，不生成假生产事实作验收。无120状态字段不得展示成已确认ACTIVE。
5. 通过正式配置API逐项恢复原enabled值，保留30分钟间隔；每项启用后使用正式同步入口验证，顺序建议plan-projections→shipping-to-base→base-to-weekly→inbound-allocation→execution-rollup，erp-orders按原来源策略独立验收。人工触发与到期触发若重叠由新租约栅栏处理，不能无条件重复回放旧键。
6. 观测至少两个完整自动周期（约65分钟，覆盖60秒检查），逐项检查last_started/last_success、耗时、attempts、租约释放及Outbox/日志一致；区分新的真实成功和历史SUCCESS，不能仅看Timer LAST。
7. 恢复普通业务入口；确认六项配置与窗口前相同、未新增调度、已保存报工完整，记录发布版本、迁移ledger、验收与未解决历史例外。

如果需要在维护期先做真实业务Command验证，应使用正式隔离租户及授权数据，并控制不会驱动实际生产；不得在生产订单随意造报工、收货或更改既有数量。

## 9. B未来可执行的差异步骤

在5.2兼容完成、混合状态全链预演通过后重新给GO结论；先沿用8.1～8.3退出旧Worker和备份，迁移名单才可扩为118→119→120。保持`KDOS_MPS_LIFECYCLE_WRITES_ENABLED`关闭，确认历史计数仍为LEGACY_RETAINED、新记录ACTIVE；逐条合法源过渡不能被隐式批量确认。随后验证普通历史报工、关键字段编辑、部分阻断与无关新订单继续生成，暂停/取消不能重生，才恢复30分钟同步。生命周期写入启用属于后续独立验收，**整体代码发布不等于允许实际取消/恢复**。

## 10. 上线后验收清单

- [ ] 实际API/Web SHA与发布清单匹配；健康、身份和字段/数据权限有效。
- [ ] A仅118、119落地；B必须另行评审后方可有120；无遗漏/额外迁移。
- [ ] 正常分配及其修改能到合法月度/基础/周计划，不覆盖人工字段、未知来源或历史归属。
- [ ] 已有报工ID/快照/数量/日期/人员/附件/异常/审计不被计划同步更新，当前数量投影正常。
- [ ] 工艺集合/顺序/周期及107/108锁仍有效，正常新增报工/正式纠错/Excel不越权。
- [ ] 634保护ID/关联和发布前当前数量指纹保持；652原明细及3组人工更正不自动回退。
- [ ] 25/3历史事实可按权限查询；不因现制造方式或任务启用标志静默丢失。
- [ ] 新FAILED重试实际执行；有新租约RUNNING可超时恢复；迟到Worker不覆盖新结果；SUCCESS必须有本版验证日志。
- [ ] 11条旧矛盾、1条旧无租约RUNNING仍为受控例外，不被上线脚本重放或清空。
- [ ] 六项30分钟原配置恢复，至少两个自动周期成功，失败和部分完成准确可见。
- [ ] 无重复有效计划/工序任务，无暂停或取消复活，无其他订单/事业部历史事实变化。
- [ ] 没有新增/迁移/停用无关n8n、systemd、cron任务。

## 11. 安全恢复与回滚

| 失败时点 | 允许的恢复 |
| --- | --- |
| 构建/预检失败，尚未停旧API或迁移 | 保持原服务；记录失败，尚未形成数据库兼容变化 |
| 旧API已停，迁移事务未提交 | 整笔ROLLBACK，检查ledger/DDL确已回到基线；恢复原配置/旧服务前再做只读确认 |
| 118/119提交，尚未恢复业务 | 保留118/119；使用验证过的1A/1B兼容恢复镜像或前向修复。旧eeaac326会被119拒绝报工快照更新，禁止直接回退 |
| 120已经提交 | 保留状态和守卫；只允许具备120及历史过渡兼容的新版本前向恢复。关闭生命周期写入并不能修复现main生成阻断，必要时保持API停机，不在运行库删触发器/列 |
| 上线后已有新报工/收货/审计 | 先停止新增写入并保存新事实；恢复备份到独立空库对账，制定获权前向恢复，禁止旧备份覆盖运行库或用旧数量覆盖新事实 |

没有适配119/120的已验收恢复镜像时，应将维护窗口延长并前向修复；不得宣称“换回旧镜像即可零损恢复”。完整灾难恢复必须另行确认切换范围、RPO/RTO及新事实保全，不能通过删除生产事实来使恢复通过。

## 12. 本轮交付边界

仅新增本文、在联动设计追加结论、更新既有主进度文件并安全提交/推送这些文档。没有修改业务代码、Contracts、Web、迁移、部署脚本或生产环境；没有把隔离订单撤销实现带入main。隔离脚本/合成备份及原始只读证据不进入GitHub。后续先做A的最小发布兼容修复并重新评估；本轮评估结束后停止。
