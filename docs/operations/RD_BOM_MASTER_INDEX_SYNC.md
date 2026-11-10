# KDOS 研发 BOM 主档索引与每日同步

## 数据边界

- 报表订单行始终来自 `mps_order_allocations`，客户交期读取 `expected_shipping_date`。
- E10 只读 `dbo.ITEM` 与 `dbo.BOM`；同步仅保存已审核（`ApproveStatus='Y'`）的 BOM 主档，不读取 `dbo.BOM_D`。
- BOM 状态由精确 ITEM 编码/身份和本地有效 BOM 主档索引计算。E10 没有对应 ITEM 时返回空状态；E10 查询错误会使请求失败，不会转成“无 BOM”。
- 生产租户键采用主计划现有 `varchar(64)` 模型（当前租户为 `KAINAN`）；索引及同步审计表均启用并强制 RLS。

## 初始化与运行

1. 仅通过 `db:migrate:rd-bom-index` 执行 Migration 127；入口只选择 `1722920127000-RdBomMasterIndex`，会核对迁移台账、表和必要列。不得运行默认全量 pending migrations。
2. 首次初始化执行一次 `FULL`。全量写入新的 generation，读取开始水位后按主键分页，随后回放该期间 CT 事件，最后在单一事务切换活动 generation。失败保留旧索引，不推进水位。
3. n8n 工作流 `RdBomMasterIndexDailyV1` 使用 `Asia/Shanghai` 每日 01:00 触发 `INCREMENTAL`。执行命令位于 `automation/n8n/rd-bom-master-index-daily.json`，复用本机既有 SSH credential；不新增 systemd、cron 或应用内周期任务。
4. 应用数据库租约防止并发；失败保留 last success、水位及活动索引，写入失败码/错误计数。报表显示最后成功快照时间和失败提示。n8n 的失败执行保留在任务历史中；CT 保留期缺口必须人工受控重跑 `FULL`，不可静默推进水位。

## 受控命令

API 容器的工作目录为 `/app/apps/api`。单租户严格迁移：

```sh
node dist/migrate-rd-bom-master-index.js
```

首次全量：

```sh
RD_BOM_INDEX_TENANT_ID=KAINAN node dist/rd-bom-master-index-sync-cli.js FULL
```

每日增量：

```sh
RD_BOM_INDEX_TENANT_ID=KAINAN node dist/rd-bom-master-index-sync-cli.js INCREMENTAL
```

命令只输出执行 ID、安全计数、结果状态和 CT 水位，不输出 BOM 明细或连接凭据。只有成功的 run 才推进水位。报表“最近成功时间”可用于核对同步新鲜度。

## 验收与恢复

- 检查 `rd_bom_sync_state` 最近状态、水位、最后成功时间、计数和错误码；对比 `rd_bom_sync_runs` 的开始/结束时间及结果。
- 检查 `rd_bom_master_heads` 活动 generation 的主档数，只应包含 E10 当前审核通过的 BOM 头；撤审及物理删除由 CT 事件移除，审核通过/修改由 CT 幂等 Upsert。
- 若运行失败，先保留现场与错误码。增量阶段数据留在隔离 stage；失败清理该次 stage，不触碰活动索引或水位。全量失败清理未激活 generation。修复只读连接或环境后重试。
- 若出现 `CHANGE_TRACKING_RETENTION_GAP`，先确认 E10 当前 CT 读取授权及最小有效版本，然后运行受控全量建立新水位；全量成功切换前继续使用旧索引并显示失败/过期提示。
- 回退 API/Web 不需要删除索引或同步历史；Migration 127 为前向兼容。不得通过删除迁移台账或手工删除索引行修复问题。

## 安全与限制

- 绝不对 E10 执行写操作、DDL、CT 开关或授权修改；CT 读取权限由既有受控只读身份提供。
- Change Tracking 记录最近行变化，不提供字段级历史 before-image。系统按当前 BOM 头状态判定撤审与删除；它不还原已删除/撤审前的完整内容。
- BOM 审核日期为当前可查证的审核时间，不冒充历史首次结构完成时间。E10 日期哨兵不显示为可确认的审核日。
- 初次全量未完成时 API 返回服务不可用；CT 水位过期不伪装成空状态或 `NO_BOM`。
