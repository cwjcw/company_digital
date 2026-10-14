# PMC allocation append batches acceptance

验收时间：2026-10-14T22:45:13.526787+08:00

代码／部署版本：`38c3c7dfcf2ea0500e84070ae2c40f6206c8a234`（`38c3c7d`）。GitHub：`cwjcw/company_digital`，`main`；源码已安全推送，验收文档随本报告提交。API/Web/原Dispatcher均使用该源码版本，四个生产容器健康，标准 `all/check` 版本一致。

## 最终业务规则

- 订单分配仅由获权手工新增／编辑和Excel预览确认维护；ERP不再新增或覆盖分配记录。最新用户再次取消分配后的下游计划对账：相关命令不入队，所有 `plan-projections` 调用返回停用／0条，旧pending不消费，生产配置经版本及审计API停用。ERP原始采集及其他任务维持原状。
- ERP出现“未分配数量”表头时，仅取该列直接写入“已分配数量”，忽略ERP原“已分配数量”；KDOS单数量模板读取“已分配数量”。不做减法／求和；公式只读有效缓存，空值及缺少／错误缓存按单元格坐标阻断。
- 每个新预览建立独立UUIDv7批次，每个有效物理源行独立新增；相同订单／品号／序号或整行仍保留。相同文件另批确认全部追加；同预览重复或并发确认保持幂等。旧导出ID／版本忽略并提示；页面编辑仍按ID＋版本更新原记录。
- 删除本资源独立旧数量字段及权限／模板／导出／快照／通知字段；金额及单价不进入导入和附件。模板、导出及隐藏字段映射不再提供覆盖身份列；导出含批次来源，操作人显示姓名，时间按上海业务时区展示。
- 不新增通知定时器、汇总或监控。沿用中文文件名、冻结时间、重试原名、多身份去重和新增订单／变更订单／字段变更明细分类。正式规则继续停用（version 3）。本轮未向生产员工额外发送测试消息；原中文附件实际收件已在上一验收由用户确认，当前23字段附件及重试通过隔离集成验证。

## 迁移与实际数据验收

Migration：`AllocationAppendBatches1722920093000`（93号），生产已COMMIT。

- 迁移前重新生成来源修正预览；通过历史导入审计、同操作／事务确认的文件证据及无后续编辑，只修正210条已分配量为0且旧来源量有效的记录，版本递增并记录租户审计。
- 共2301条分配记录：210条修正，2091条原数据保持；全部ID、金额及其他业务字段哈希一致。人工编辑及无法证明来源的数量未覆盖。211条非空退役量保存历史审计，随后删除旧数据库列。
- 月计划回填稳定allocation-ID外键后解除分配业务键唯一约束；历史月／集团／出货／基础／周／工序计划记录、数量及财务订单／客户对应表的哈希一致，失效月计划关联为0。不自动创建或更新下游计划。
- Chrome桌面实际打开生产订单分配页：独立旧数量列不存在；原文件预览163行／33单、全部新增163／变更0／错误0，批次及O列映射提示可见。只预览并取消，未确认生产导入；生产新批次记录为0，浏览器验收后的分配／计划／财务基线再次相同。
- 下游停用接口实际返回 `skipped=true,count=0`；调用前后分配／月／集团哈希一致。匿名／权限及租户／字段范围保持既有边界，新增元数据只读。

## 验证结果

- 完整API：105套、940项通过，1项既有skip。
- 完整Web：48文件、368项通过；新增批次预览UI专项35项通过。第一次回归出现负载超时，降并发／15秒测试时限后复验；修正既有财务测试对重复月份文字的单元素查询，不修改财务业务代码。
- Contracts：22项通过。API及Web构建／类型检查／lint通过；既有Web lint及bundle提示保留。
- 隔离真实PostgreSQL18：完整空库迁移及18项业务检查通过；真实163／33源批次A新增163、同次重放新增0、批次B再新增163，共326；逐行与O列一致，金额不导入。
- 历史迁移专项：已证实来源修正、人工／未知来源保护、金额与ID／FK保留、旧值／权限归档，条件down/up及追加后拒绝破坏性回滚，均通过。
- 通知集成：四种原触发入口、同批事件、全新增入Sheet1／手动变更入Sheet2、字段差异、中文文件名冲突及分片／重试、独立文本／文件重试、权限／RLS及事务回滚通过。

## 备份、运行与恢复

迁移前备份：`20261014_222211`，标准迁移再次备份：`20261014_223437`；迁移后备份：`20261014_223843`。每组均含两个custom数据库备份及上传／私有附件／投递回执归档，`pg_restore --list` 验证通过，权限0600、备份目录0700，SHA保留在本机私有验收目录。无凭据复制／入Git。

仓库原定义：4个Timer模板／8个候选实例、6个Service文件、1个Dispatcher定义，未新增。当前已核实8个既有用户级业务Timer启用，原Dispatcher active且1秒轮询；n8n共14工作流／10激活，当前用户cron 1条；5个其他MPS配置的启用状态与30分钟频率保持。仅按本次用户取消指令停用plan-projections。没有强制迁移、合并其他调度。

已产生任何追加批次或重复身份后，禁止退回旧业务唯一键；保留数据并前向修复。仅在未追加且旧键安全时允许条件schema回滚；已确认量修正仍保留。运行回滚必须保留仅手工来源及下游停用限制，不重新启用旧自动写入。历史老预览需要重新上传；用户正式导入仍在页面确认。

私有实际证据：`data/pmc-batch-import/`，不提交真实工作簿、原始行、业务ID、数据库、维护会话或凭据。

## 修改文件

- `apps/api/src/migrations/1722920093000-AllocationAppendBatches.ts`
- `apps/api/src/modules/master-plan-system/master-plan-spreadsheet.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.application.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.config.ts`
- `apps/api/src/modules/master-plan-system/master-plan.live-projection.spec.ts`
- `apps/api/src/modules/master-plan-system/master-plan.query.service.ts`
- `apps/api/src/modules/master-plan-system/master-plan.sync.service.spec.ts`
- `apps/api/src/modules/master-plan-system/master-plan.sync.service.ts`
- `apps/api/src/modules/master-plan-system/order-allocation.domain.ts`
- `apps/api/src/modules/master-plan-system/order-allocation.spec.ts`
- `apps/web/src/modules/finance/FinanceOrders.spec.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanPages.spec.tsx`
- `apps/web/src/modules/master-plan-system/MasterPlanPages.tsx`
- `docs/operations/PMC_ORDER_ALLOCATION_NOTIFICATIONS.md`
- `docs/operations/TASK_REGISTRY.md`
- `packages/contracts/src/index.ts`
- `scripts/test-allocation-append-migration.cjs`
- `scripts/test-order-allocation-postgres.cjs`
- `outputs/CODEX_PROGRESS.md`
- `outputs/PMC_ALLOCATION_APPEND_BATCH_ACCEPTANCE.md`
