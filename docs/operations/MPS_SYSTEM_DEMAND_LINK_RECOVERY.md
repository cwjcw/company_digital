# KDOS需求首次绑定服务身份修复与11月7日基础计划定向恢复

状态：**已按授权完成生产热修复Migration、API部署及后台自动同步恢复；300组缺失基础计划已全部恢复。周计划仍受业务准入字段限制，见第6节。**

主进度入口：`outputs/主计划系统修复进度.md` 首节。背景与架构决策：`MPS_UPSTREAM_DOWNSTREAM_LINKAGE_DESIGN.md` 第20节。

## 1. 已核实生产范围（只读）

- 生产API版本：用户给定`44f61d3`。生产数据库连接角色`knplan`为超级用户。
- 生产`migrations`已记录118、119、121、122；未记录120、`1722920122500`、123。
- `__kdos_system__`从初始化时起`enabled=false`且密码为`!`。保持现状，禁止交互登录。
- `mps_sync_configs`六项均启用、原间隔30分钟。生产配置未修改。
- 固定北京时间2026-11-07导入窗口：307行、6批、302个有效/月度需求组；2组有稳定关联基础计划，300组缺失、134,604件。全部300组当前没有稳定关联或文本匹配基础计划。
- 重点`2026A027296 / TGH038BD-1/1-2`：月度UUID `01a1b3d1-917f-7bd0-b3a2-4762c1f9375f`，14件，version 1，尚缺基础计划。
- 6批行数为196、52、2、14、19、24；这些是导入行，不是需求组数。

以上仅作为2026-11-08快照。获批执行前必须重新查询，不能沿用旧数量或旧版本写入。

## 2. Migration与发布兼容

新增Migration：`1722920122500-MpsDemandLinkServiceAuth`。

严格入口：`apps/api`的`db:migrate:mps-demand-link-service`，迁移文件白名单仅这一条；要求118、119、121、122已应用，拒绝120及未知未来结构。若123已经独立应用也不纳入本次执行。修复Migration编号处于122之后、计划中的123（`1722920123000`）之前。不得执行默认全部Pending migration。

Migration创建`NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`的`mps_demand_link_service`，只授予本次绑定必需的读、审计插入和父ID列更新权限。Migration121同事务审计、身份/租户/来源校验及不可重绑规则继续有效。Migration121文件不修改，Migration120/123不执行。该Migration为前向保护；执行失败按事务回滚，执行成功后不删除角色/触发器或回退权限作为恢复方法。

本热修复基于生产44。性能优化候选也修改`master-plan.sync.service.ts`、`master-plan.monthly-base.ts`、`master-plan.sync-runner.ts`、Migration发现器和`package.json`。正式发布前须将本修复逐段整合到获批候选并重跑测试；不能用旧生产分支整体覆盖候选，也不能假定无合并冲突。

## 3. 受控恢复入口

`apps/api/src/restore-mps-missing-bases.ts`不会由HTTP调用。它仅接受`--execute`且`KDOS_MPS_TARGETED_RESTORE_ENABLED=true`，读取项目外受审manifest，检查Migration账本/服务角色/系统账号和当前原30分钟同步配置。执行前只读重新计算固定导入窗口下的缺失集合，逐一核对manifest目标仍属于缺失集合且月度version一致，并确保每个目标没有稳定ID基础计划或文本匹配基础计划；已变化的目标即拒绝。manifest可以是当前缺失集合的受审子集，以支持先处理指定组。

manifest只包含`tenantId`、`requestId`及`monthlyPlans: [{id, expectedVersion}]`。不得提交manifest或生产业务ID到Git。目标最多300组，每批最多25组；工具默认每次最多处理一批，可用`--max-batches=N`显式增加单次上限。每次处理后应重新读取、校验并生成剩余manifest。使用确定性批次UUID及Application Service的`RECONCILIATION`路径：

1. `shipping-to-base`定向处理该批月度UUID。来源失效、身份冲突、版本变化、历史基础计划存在时整批停止。
2. 校验每个`monthly_plan_id`恰好关联一条基础计划，不能修改人工批次数量。
3. 使用这些基础计划稳定ID定向执行`base-to-weekly`。未满足正式周计划准入条件的记录返回BLOCKED并保留缺项；不强制造工序。
4. 每批核对Outbox、同步日志和真实记录；shipping失败立即停止后续批次。重复相同批次可以安全重入，不增加重复基础/周计划。

只有用户针对**候选SHA、Migration名单、维护窗口与300组目标**明确批准之后才可运行。没有生产写入验证环境时，不能用真实订单做试运行；先隔离验收，再执行生产受控恢复。

## 4. base-to-weekly三条23514事件

生产失败日志只保存SQLSTATE摘要，没有底层constraint文本。三条Outbox事件都未带scope，实际触发全租户任务；事件`record_id`是触发源，不足以证明该行就是事务中的失败行：

| Outbox事件 | 触发记录 | 当前只读事实 | 本次重试结果 |
|---|---|---|---|
| `05ed5ccc-921b-4d00-ad9e-9ba1da93d41e` | `2025A027115 / TGG930HT-1/1` | 周计划已存在；报工0、工序任务0；`mps_weekly_has_execution=true`（历史入库/上游累计入库事实） | BLOCKED；与受保护行隔离，不改写历史 |
| `b95852b1-2d2e-4206-bb90-a93401a97e97` | `2025A027131 / TGG919HT-1/1` | 周计划已存在；报工0、工序任务0；`mps_weekly_has_execution=true`（历史入库/上游累计入库事实） | BLOCKED；与受保护行隔离，不改写历史 |
| `82cdbcdd-ba42-4380-b2e3-f763546b70a8` | `TGG955HT-1/1` | 周计划已存在且有4条工序；报工0、事实函数false。事件scope为空，不能据此认定它触发23514 | BLOCKED；失败日志不保留原始constraint，未放宽保护 |

另有触发记录`2026A027408 / GFQ558KB-1/1`，周计划有4条任务、报工0、事实函数false；由于其事件同样scope为空，不能证明它是23514根因。热修复后这类全量重试真实返回`BLOCKED`，metrics显示2条执行事实周计划被保护；不把BLOCKED改写为SUCCESS。当前证据支持全量更新触及两条已有入库/累计入库事实的周计划，但数据库日志没有保存原始constraint名称，故不伪造更精确的SQL约束结论。

修复在upsert前逐条锁定/过滤已存在执行事实周计划，写入`PROCESS_SNAPSHOT_PROTECTED`并让本次任务真实返回BLOCKED；其他合法周计划继续同步。新建周计划若从月度/ERP链路检测到收货，则不生成工序及占位表。不得为了让状态SUCCESS而删除收货、降低事实保护或伪造任务。

## 5. 可信来源及执行事实边界

仅私有定时同步和受控恢复入口可以请求`mps_demand_link_service`。普通`run()`、HTTP手工同步及Outbox消费者一律不因`actor_id`等于系统账号而升级数据库身份。数据库触发器只认可实际`current_user=mps_demand_link_service`并再次核验同事务审计与来源身份。API数据库连接`knplan`当前是超级用户，因此该数据库角色可防止业务调用路径绕过，不构成API进程失陷时的隔离边界；生产预检须核对部署代码路径，后续应评估将API数据库登录降为受限角色。不得把角色切换开放为HTTP参数或普通GUC。

基础计划数量和允许更新的交期可以在保留报工事实、工艺快照的条件下同步；不能因存在报工/入库就阻断所有合法计划字段更新。自动写入导致执行身份变化、工艺快照缺失需要初始化时，继续按Migration119保护机制阻断，并留下真实失败/阻断原因。

## 6. 2026-11-08生产执行结果

- 最终生产API代码提交：`ba43b9275850eb282f7d76f19d8a95731f348781`。API镜像：`sha256:d62bcb23e4a1d4aefc234d884da9c4f9ed51cf2de594bc2fb08d05a176250eaa`。性能候选`0d1d7f6`及Migration123均未部署/执行；Web和document-worker镜像未切换。
- 严格入口只执行`1722920122500-MpsDemandLinkServiceAuth`。账本仍含118、119、121、122；120及123未执行。121三个需求绑定触发器保持启用。服务角色为`NOLOGIN/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT/NOBYPASSRLS`，无成员；仅有读取、审计插入、`monthly_plan_id`列更新和校验函数执行权，不能更新计划数量。
- `__kdos_system__`仍`enabled=false`且密码为`!`。数据库登录`knplan`现有配置是SUPERUSER；内部角色不能被普通HTTP actor参数或通用GUC伪造，HTTP手工同步调用不启用内部角色；数据库超级用户仍意味着API进程失陷时不构成隔离边界，后续应单独降低运行时DB权限，不能在本次热修复中贸然改动全平台授权。
- 备份脚本成功完成并用`pg_restore --list`校验：`four_department_tracker` SHA256 `2f1f620447e775a07fd5006dddc7961f156bb4660076bd1c7d7d7b6546e03584`；`kdos` SHA256 `8126ca55e67fd4f82e3804265e488a7250832a4165681fe9a0b17be3d64aba6c`；uploads SHA256 `03c61abee04f09fd4c4ded500ce5adac0d31a574550a4551c128c4795b0a198f`。迁移前需求绑定触发器定义另存于权限为600的`/tmp/mps-demand-link-before-20261108.sql`。
- API重启时Web反代短暂返回502，约4秒后健康恢复；未停止KDOS整体服务，Web与document-worker容器未重建。生产API `/api/v1/health`返回`ba43b927…`且health为healthy，Web `/health`正常。
- API恢复后，原60秒检查器按原30分钟配置自然启动`SCHEDULED shipping-to-base`，并在系统账号仍disabled时成功处理：`monthly_eligible=6666`、`base_created=300`、`base_updated=0`、`base_conflicts=0`、`base_multi_batch=0`。没有调用人工恢复脚本或执行全租户历史Outbox重放。当天307条分配/302组现为302个稳定基础关联，缺失0、重复0；300个新增基础计划数量合计134,604，与原需求一致。另2个原有关联保持不变，总计划需求/基础数量134,608（多出的4件属于原有2组）。
- 重点`2026A027296 / TGH038BD-1/1-2`已关联月度ID`01a1b3d1-917f-7bd0-b3a2-4762c1f9375f`与基础ID`01a1b8f7-f629-7123-9215-d306f08f1754`，两边数量14，稳定关联正确。
- 300个新增基础计划尚无周计划，且全部缺少周计划准入必填的客户交期、评审交期、产品属性、表面性质、制造方式。没有绕过准入强造周计划。目标范围仅有此前2条已有周计划；自动`base-to-weekly`将其识别为2条受执行事实保护记录并返回BLOCKED，不是授权失败。待补齐业务字段后，按现有准入规则继续同步。
- Migration执行后，没有新的`shipping-to-base`需求身份23514；上述自动任务以服务身份成功绑定了300条需求。历史`plan-projections`仍因已知历史归属歧义返回BLOCKED，未清理110组历史数据。原有`base-to-weekly`通用BLOCKED/旧23514事件没有被篡改为SUCCESS。
- 自动同步仅创建基础计划，没有更新基础计划或写入报工、工序、入库、财务、设备数据。生产当前`mps_process_reports`总数5350；历史入库事实保留，表未被本次同步修改。新API改动不包含财务或设备代码；Web镜像未变。

备份位于运行环境`data/backups/`，manifest及恢复数据未提交Git。此次未推送GitHub。API代码提交`ba43b927…`在本地热修复分支；仅限本地提交。

## 7. 后续事项

1. 补齐这300组基础计划缺少的业务准入字段后，验证对应周计划及工序任务，不得用默认值伪造。
2. 对全scope的旧base-to-weekly事件，继续保留实际`BLOCKED`。由于旧日志只保留SQLSTATE摘要，若需要原constraint名称，需在隔离副本复现；不得在生产关闭119触发器或盲目重放。
3. 单独评估把API数据库登录`knplan`降为受限角色；这是全平台权限变更，不纳入本次紧急热修复。
4. 继续观察两个完整原30分钟同步周期，核对新的合法分配、Outbox及同步日志；不调整六项同步配置。

若生产API后续异常，使用部署前API镜像tag `knplan-api:before-mps-demand-auth-20261108`仅恢复应用镜像；Migration是向前保护，保留服务角色/触发器，不删除Migration、不恢复整库覆盖上线后的新业务数据。
