# 集团及事业部月度计划：订单分配需求来源

2026-10-30 用户确认的来源改造。本轮仅本地验证、Git 提交和推送；生产部署待确认。运行调度事实与责任人仍以 [MPS-003 台账](operations/TASK_REGISTRY.md) 为准。

## 业务口径

- `plan-projections` 只汇总本租户 `mps_order_allocations` 中未归档、`manually_maintained=true`、`order_status='已审核'` 且客户/组织/数量合法的记录。未审核、撤销、失效及归档记录不生成有效新需求；审核后原任务自动纳入。分配记录由原有授权人工/Excel命令维护，投影不回写来源。
- 月度需求为每个租户＋订单＋品项＋承接事业部的 `SUM(allocated_quantity)`，同组追加行和批次各计一次。60/40 分到两部时分别生成 60/40 月计划。当前数据库没有独立月份键；沿用真实 `order_date` 与现有日期查询规则，不新增或猜测月份。
- 集团继续按订单汇总有效分配需求；品项跨事业部先合计，再沿用各品项完成比例的平均值计算订单完成率。入库仍来自既有可信入库链路，不把分配量当成入库量；其他账套/不可信事实不混入。
- ERP 明细是否存在、ERP 数量上限、旧日期水位、来源行 ID、客户主责映射都不再决定计划准入。承接事业部来自分配本身。新集团记录仅一个承接事业部时填该部；跨部时不虚构单一主责，保持 NULL。已有合法历史元数据保留。
- 下单日期直接读取分配表的物理日期字段。预计发货日期绝不代替客户交期。新计划未知客户交期、评审日期、来源账套、类型、金额保留 NULL；缺失日期/名称以任务 metrics 计数。现有计划只刷新匹配需求和派生进度，不覆盖人工日期、属性、备注等。
- 既有历史集团/月度/基础/周计划、锁定工艺和报工保留 ID；没有活动来源不会自动失效或删除。归档父记录、客户/事业部归属冲突保留原计划并生成稳定诊断；订单内有匹配冲突时保留该集团汇总，避免产生部分汇总。旧 ERP 门槛诊断在新规则下自动解除。

## 复用与边界

- `erp-orders` 独立继续从 canonical ERP 同步 `mps_erp_order_lines`，自身账套、状态、日期、别名和增量规则保持；不关闭、不冻结、不删除历史。规则常量的说明已限定到 ERP 明细采集。
- `shipping-to-base` 继续由月度计划生成基础计划。只补齐跨事业部匹配，沿用共享交期编码及审计三方合并：人工改过的数量、日期、属性或清空值继续保护。多批次/无法证明归属时仍诊断，不任挑一个。没有真实客户/评审交期的基础计划仍待人工完善，不绕过周计划准入。
- 出货计划独立保留；其月计划关联按同一事业部匹配。月度报工/辅助状态与综合大屏连接同样包含事业部，避免借用另一部报工或放大汇总。
- BOM 复用现有科加 T+ 只读适配器及固定账套范围。唯一有效订单行可继续提供执行版本；没有唯一可用行时用品项编码读取该物料范围的唯一默认有效 BOM及子件路线。同码物料或多个默认版本明确歧义，不选第一条。事业部仅用于工序映射责任/权限，不作为 BOM 物料身份。没有扩展其他账套自动择一或写入 T+。
- 原 30 分钟配置、手动同步授权、`runDue`、持久 outbox、失败日志与重试继续复用。投影使用 REPEATABLE READ、租户上下文、共享 advisory locks、来源/计划行锁、版本及审计；变更月度需求才入队现有基础同步。重复执行不新增计划、审计或 outbox。

## Migration 与本地复现

`MpsAllocationPlanSource1722920112000`：月度唯一约束加入事业部（NULLS NOT DISTINCT，保留未知事业部旧记录的唯一性），集团金额允许 NULL。无数据回填、清空或新来源字段。迁移前后保留 ID/日期/业务字段；跨事业部或未知金额生效后 down 会拒绝有损回退，优先前向修复。

沿用项目已有 PostgreSQL18 隔离验证方式；不得把生产连接用于以下脚本：

```bash
mkdir -p test/allocation_plan_source/pg_socket
chmod 777 test/allocation_plan_source/pg_socket
docker run -d --name kdos-allocation-plan-test --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=knplan \
  -v "$PWD/test/allocation_plan_source/pg_socket:/var/run/postgresql" postgres:18
pnpm --filter @tracker/shared build
pnpm --filter @kdos/contracts build
pnpm --filter @tracker/api build
KDOS_ALLOCATION_PLAN_TEST_SOCKET="$PWD/test/allocation_plan_source/pg_socket" \
  node scripts/test-allocation-plan-source-postgres.cjs
```

脚本只接受上述专用 Unix socket，创建独立带时间戳数据库和合成数据。覆盖无 ERP、超过 ERP、旧日期、审核转换、追加/跨部、历史冲突、幂等/并发、真实 SQL 入库回算、回滚原子性、人工/锁定工艺/报工、字段/租户/数据范围、出货关联及迁移兼容。BOM 查询由现有 Python/Jest 测试和独立只读来源验证覆盖。浏览器验收使用本地 Web→真实 Query/Sync Services→隔离数据库，API 请求全部拦截，避免连接生产。

## 待确认后上线的最短步骤（本轮未执行）

1. 在本任务 commit 的干净 linked worktree 中复用现有运行目录；保留无关未提交文件。评估本次非破坏性约束调整，不默认新增整库备份。
2. 复用原 `deploy.sh` 的构建函数构建新镜像，短暂停止 API 防止旧三列 ON CONFLICT 与新约束并行，然后用新镜像执行 TypeORM `migration:show/run`（只应新增112，不 seed）。
3. 原 `deploy.sh all` → `deploy.sh check` → `healthcheck.sh`，核对源码/Web/API SHA；脚本门禁与健康检查不改动。
4. 经原授权手动入口执行 `plan-projections`，核对日志/诊断/分配总量/历史保护，再验证原 `shipping-to-base` 和真实生产页面。配置启用及 30 分钟周期原样保持；ERP继续同步。未知字段仍待人工完善。

可复用脚本函数，避免复制 Compose5 构建兼容逻辑；仅在确认上线后运行：

```bash
export KDOS_RUNTIME_ROOT=/data/automation/code/work/PMC/knweb
source scripts/deploy.sh
require_safe_env
assert_deployable_worktree
REPOSITORY_HEAD="$(git rev-parse HEAD)"
build_services api web document-worker
"${COMPOSE[@]}" stop api
"${COMPOSE[@]}" run --rm --no-deps api node node_modules/typeorm/cli.js -d dist/data-source.js migration:show
"${COMPOSE[@]}" run --rm --no-deps api node node_modules/typeorm/cli.js -d dist/data-source.js migration:run
./scripts/deploy.sh all
./scripts/deploy.sh check
./scripts/healthcheck.sh
```

迁移失败则保持事务回滚并调查；不得启动依赖新唯一键的代码去访问旧结构。新数据产生后不得删除业务记录以强行执行 schema down，也不能直接回退依赖旧唯一键的应用。
