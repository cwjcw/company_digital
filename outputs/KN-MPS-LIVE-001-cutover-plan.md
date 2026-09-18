# KN-MPS-LIVE-001 主计划系统「快照模式 → 实时运行模式」上线边界审计与切换方案

任务关键字：`KN-MPS-LIVE-001`

性质：**只读审计 + dry-run 模拟 + 切换方案设计**。本任务未启用任何实时同步、未修改任何生产业务数据、未重新初始化、未删除 1169 条快照。

---

## 一、结论摘要

1. 当前系统仍是 **SNAPSHOT（快照）模式**：`erp-orders`、`plan-projections`、`shipping-to-base`、`base-to-weekly`、`inbound-allocation` 全部 `disabled`，只有 `execution-rollup` 为 `enabled`。
2. **不能直接打开 `erp-orders`。** 当前 `erp-orders` 是「全量源投影」：无日期下限、无 watermark、无状态过滤、无游标。只读 dry-run 证明它会读入全部 **121,485** 条 `sales_orders`，与现有快照 **0** 个来源身份冲突，因此会 **全部 INSERT = 121,485 行**，其中 **1,098 行**与现有 **1,095 个快照业务键（订单+品号）**业务重复。
3. 重复行会被 `plan-projections` 按 `(订单, 品号)` 求和：这 1,095 条月计划的需求数量将由 **369,415 → 727,663**（近似翻倍），并连带放大订单分配、集团计划。
4. 与「主计划同步」不同，**ERP 数据本身早已在实时同步**：`erp_staging_raw_records`（1,370,976 行）、`erp_change_events`（872,526 行）、`erp_projection_consumers`（3 个消费者，均 enabled/IDLE，最近成功 2026-09-18 06:07 UTC）真实在线运行，`sales_orders` / `finished_goods_inbound` / `finished_goods_outbound` 由独立游标持续维护。**可靠增量水位是存在的**（`sales_orders.updated_at` 只在内容真正变化时更新）。
5. 推荐策略：**「cutover 水位 + 快照业务键抑制 + 来源身份别名绑定」**，分 5 阶段启用，每阶段带 Go/No-Go 与回滚基线。不推荐「只按今天以后的订单日期」这种单一判据。

---

## 二、当前为什么不能直接打开同步

| 同步键 | 直接启用后的确定后果 |
| --- | --- |
| `erp-orders` | 全量重灌 121,485 行历史订单；制造 1,098 行业务重复；快照 1169 条一行都不会被 UPDATE，而是被「旁挂」第二份 |
| `plan-projections` | 订单分配 1169 → 118,216（新增 117,047）；月计划 1169 → 118,216；集团计划 99 → 15,851；且会把 1,095 条既有月计划需求翻倍 |
| 入库计算（在 `plan-projections` 内部） | **无需单独启用 `inbound-allocation`**，`plan-projections` 就会用 `finished_goods_inbound` 重算 1169 条月计划的累计入库/欠数/完成率，其中 121 条会立即变化 |
| `inbound-allocation` | 1169 条周计划中 121 条 `allocatedInboundQuantity`/`pendingQuantity` 变化，其中 95 条从 0 变为已分摊 |
| `shipping-to-base` | 当前 `mps_shipping_plans = 0`，无任何来源行，**启用后不会产生任何基础计划**（空转） |
| `base-to-weekly` | 当前 1169 条基础计划的 4 个准入字段全部为空，满足 `weeklyAdmissionSql` 的行为 **0** 条，启用后同样空转 |

结论：`erp-orders` 与 `plan-projections` 是高风险项，`shipping-to-base` / `base-to-weekly` 目前是空转项。**没有任何一个同步键可以在当前代码语义下直接打开。**

---

## 三、当前 source 真实结构（只读实测）

### 3.1 `sales_orders` 总量与来源

| 指标 | 值 |
| --- | --- |
| 总行数 | 121,485 |
| distinct 订单号 | 15,849 |
| distinct 订单+品号 | 118,142 |
| 订单日期范围 | 2020-08-31 ～ 2026-09-18（未来日期 0 条） |
| `created_at` 范围 | 2026-08-25 ～ 2026-09-18 |
| `updated_at` 范围 | 2026-09-01 07:01 ～ 2026-09-18 06:07（UTC） |
| `source_key` 为空的行 | 0（全部来自 ERP 正式投影，无手工行） |

| source_system | source_database | 行数 | 订单数 | 订单+品号 | 客户数 | 订单日期范围 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| E10 | `E10_6.0.0.1.NEW.CHS` | 95,752 | 13,324 | 93,138 | 389 | 2020-08-31 ～ 2026-09-18 |
| T+ | `UFTData418971_000003`（科加智能 / 事业四部） | 18,205 | 1,256 | 17,743 | 42 | 2025-05-20 ～ 2026-09-18 |
| T+ | `UFTData741219_000012`（凯南智能 / 事业三部） | 7,528 | 1,339 | 7,471 | 15 | 2024-11-20 ～ 2026-09-18 |

**`sales_orders` 是三个 ERP 账套的混合表**，不是「事业四部订单表」。

### 3.2 订单状态

`sales_orders` 唯一与状态相关的列是 `close_status`（无 `order_status` / `document_status` / `audit_status` / `cancel` 列）。

| source_system | close_status | 行数 |
| --- | --- | ---: |
| E10 | 未关闭 | 53,989 |
| E10 | 已关闭 | 41,763 |
| T+ | 未关闭 | 16,010 |
| T+ | 已关闭 | 9,723 |

语义可由代码确认：`formal-projection.repository.ts` 写入 `CASE WHEN is_cancelled THEN '已作废' WHEN is_closed OR is_completed THEN '已关闭' ELSE '未关闭' END`。即 **`已关闭` = ERP 判定已关闭或已完成**，`已作废` 当前 0 条。`已关闭` 是否等价于「可以不再进入主计划」，属于业务口径，见第十三节。

### 3.3 `finished_goods_inbound`

| 指标 | 值 |
| --- | --- |
| 总行数 | 80,318 |
| distinct 订单号 | 1,335（33,745 行 `sales_order_number` 为空） |
| 来源 | 仅 T+ 两账套：科加 41,825 / 凯南 38,493（**无 E10**） |
| 入库日期范围 | 2024-11-20 ～ 2026-09-19 |
| `updated_at` 范围 | 2026-08-25 ～ 2026-09-18 |

### 3.4 是否存在可靠增量水位

**存在**。优先级从高到低实测结论：

| 层级 | 载体 | 实测状态 | 可用性 |
| --- | --- | --- | --- |
| ERP 源变更时间 / 稳定游标 | `erp_sync_cursors.last_processed_modified_at` | 31 条游标，3 个来源 ACTIVE，最近扫描上界 2026-09-18 14:00（UTC） | 可用（最可靠，按 stream 独立） |
| staging 事件序号 | `erp_change_events.record_version` + `id`（UUIDv7） | 872,526 条；近 24h 9,610 条 | 可用（仅内容变化才产生事件） |
| canonical 表稳定 `updated_at` | `sales_orders.updated_at` | 只有 `content_hash` 变化才产生事件→投影→`updated_at=now()`；重叠窗口重放不产生事件 | 可用 |
| 业务 `order_date` | `sales_orders.order_date` | 存在 ±1～±17 天的回填/修正偏差（与原快照比对 514/1095 不一致） | 只能作候选条件之一 |
| 快照自带水位 | `mps_erp_order_lines.source_updated_at` | 1169 条**全部为 NULL** | 不可用 |
| 上线模式/水位开关 | `mps_system_settings` / `mps_sync_configs` | 只有 `KN-MPS-INIT-001`、`shipping_edit_weekday` 等，无 mode/watermark 字段 | 需 LIVE-002 扩展 |

---

## 四、架构文档中的 staging / change event / consumer 是否真实存在

**真实存在且已上线运行**（不是纸面设计）：

| 对象 | 实测 |
| --- | --- |
| `erp_staging_raw_records` | 1,370,976 行；`ORDER_HEADER` 15,955、`ORDER_LINE` 121,485 |
| `erp_change_events` | 872,526 行；近 24h 9,610 行 |
| `erp_projection_consumers` | 3 个：`sales-orders-v1`→`sales_orders`、`finished-goods-inbound-v1`→`finished_goods_inbound`、`finished-goods-outbound-v1`→`finished_goods_outbound`；全部 `enabled=true`、`status=IDLE`、`retry_count=0`、最近成功 2026-09-18 06:07 |
| `erp_sync_sources` | 3 个来源（e10-main / tplus-kainan / tplus-kejia）全部 `ACTIVE`、`incremental_enabled=true` |
| `erp_sync_cursors` | 31 条，含 INITIALIZATION 业务日期下限（e10 2026-08-31、科加 2026-08-29、凯南 2026-08-31）与 INCREMENTAL 最后处理时间 |

**但主计划 `erp-orders` 不使用这套增量能力**：它直接 `SELECT ... FROM sales_orders`（canonical 表）做全量投影，既不读 `erp_change_events`，也不维护自己的投影游标。

即：**ERP→canonical 一层已经是可靠的实时增量链路；缺的是 canonical→主计划的第二段准入边界。**

---

## 五、当前 1169 条快照与 ERP 的重叠情况

### 5.1 快照元数据

- `source_system = KDOS_INIT`、`source_database = FOURTH_DIVISION_20260917`、`source_key = orderNumber|itemCode|deliveryNumber`（1169/1169 符合该形状），代表事业四部 20260917 存量基线。
- `source_updated_at` 全为 NULL；`source_active` 全为 true。
- 快照只承载有限字段：`salesperson_name`、`customer_name`、`order_type`、`customer_due_date`、`preproduction_review_date`、`unit`、`tax_included_unit_price`、`tax_included_amount`、`order_status` 全部为 NULL；实际有值的是订单号、品号、品名、订单日期、预计出货日期、数量、客户编码。

### 5.2 重叠分类（A/B/C/D）

| 分类 | 定义 | 实测 |
| --- | --- | ---: |
| 快照行 | `mps_erp_order_lines`（KAINAN） | 1,169 |
| **A 类** | 订单+品号在 `sales_orders` 中存在 | **1,095** |
| **B 类** | 快照存在、`sales_orders` 不存在 | **74**（其中 52 行的订单号在 ERP 完全不存在） |
| **C 类** | `sales_orders` 存在、快照不存在（distinct 业务键） | **117,047** |
| **D 类** | 两边业务键相同但关键字段不同 | 见下表 |

| D 类字段 | 差异行数（/1095） |
| --- | ---: |
| `expected_shipping_date` ↔ `planned_delivery_date` | 1,053 |
| `order_status` ↔ `close_status`（快照侧全为 NULL） | 1,095 |
| `order_date` | 514（差值分布：0 天 581、±1 天 434、±2～5 天 49、-3～-17 天 31） |
| `unit` / `tax_included_unit_price` / `tax_included_amount`（快照侧全为 NULL） | 509 |
| `item_name` | 52 |
| `customer_code` | 32 |
| `order_quantity` | 3 |
| `salesperson_name`（快照侧全为 NULL） | 0（两边都空） |

双向 EXCEPT：

```
snapshot_only_keys = 74      erp_only_keys = 117047      shared_keys = 1095
```

### 5.3 C 类按来源拆分

| source_system | source_database | ERP 订单+品号 | 命中快照 | C 类（ERP-only） |
| --- | --- | ---: | ---: | ---: |
| E10 | `E10_6.0.0.1.NEW.CHS` | 93,138 | 0 | 93,138 |
| T+ | `UFTData418971_000003` | 17,743 | 1,095 | 16,648 |
| T+ | `UFTData741219_000012` | 7,471 | 0 | 7,471 |

**快照与 ERP 的重叠 100% 落在科加智能账套**，与 `KDOS_INIT / FOURTH_DIVISION_20260917` 的业务来源一致；E10 与凯南账套与快照 0 重叠。

### 5.4 来源身份不同导致的重复（核心数字）

| 项 | 值 |
| --- | ---: |
| 快照来源身份 | `KDOS_INIT / FOURTH_DIVISION_20260917 / 订单|品号|交期` |
| ERP 来源身份 | `E10|T+ / <账套> / <ERP 行主键>`（科加为 T+ `SA_SaleOrder_b.ID` 数值行 ID，**稳定**） |
| 直接运行 `erp-orders` 时命中现有身份的行 | **0** |
| `wouldInsert` | **121,485** |
| `wouldUpdate` | **0** |
| `wouldUnchanged` | **0** |
| 会制造业务重复的新增行（订单+品号已存在于快照） | **1,098 行 / 1,095 个业务键 / 90 个订单** |
| 投影后 `mps_erp_order_lines` | 1169 → 122,654 |

---

## 六、各同步键的真实行为审计（逐项）

| 同步键 | 来源表 | 目标表 | 读取范围 | 业务键 | INSERT | UPDATE | DELETE | 来源消失失效 | 是否覆盖人工字段 | 是否读历史全量 | 时间边界 | 状态边界 | source watermark |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `erp-orders` | `sales_orders` | `mps_erp_order_lines` | `order_number<>'' AND item_number<>''`（**无其他条件**） | `(tenant,source_system,source_database,source_key)`，`source_key=COALESCE(source_key,id::text)` | 是 | 是（仅 6 列 distinct 守卫） | 否 | 否（`source_active` 只会被写 true，代码中无任何位置写 false） | 不涉及计划字段，但会重写订单号/品号/数量/日期 | 是（全表） | 无 | 无（`已关闭`/`已作废` 照单全收） | 无 |
| `plan-projections` | `mps_erp_order_lines`(`source_active=true`) + `finished_goods_inbound` | `mps_order_allocations`、`mps_monthly_plans`、`mps_group_plans`、`mps_data_exceptions` | 全租户所有 `source_active=true` 行；入库按 `(sales_order_number, inventory_code)` 聚合（**不区分账套**） | 分配/月计划 `(tenant,order_number,item_code)`；集团计划 `(tenant,order_number)` | 是 | 是 | 否 | 否 | 会覆盖 `division_id`、`customer_code`、`order_date`、`customer_due_date`、`preproduction_review_date`、`latest_customer_due_date`、`item_name`、`required_quantity`、累计入库/欠数/完成率 | 是 | 无 | 无 | 无 |
| `shipping-to-base` | `mps_shipping_plans` | `mps_base_plans` | 全租户出货计划 | `(tenant,order_number,item_code,delivery_number)` | 是 | 是 | 否 | 否 | 字典字段仅当出货计划来源为空时从月计划补默认值 | 全量（但来源表当前 0 行） | 无 | 无 | 无 |
| `base-to-weekly` | `mps_base_plans`（**仅满足 `weeklyAdmissionSql` 的行**） | `mps_weekly_plans` + `mps_weekly_process_plans`/`mps_technical_reports`/`mps_material_reports`/`mps_outsourcing_reports`/`mps_process_reports`(快照字段) | 只处理关联 base 满足 admission 的 weekly（KN-MPS-SYNC-001 修复仍然有效） | `uq_mps_weekly_base (tenant,base_plan_id)` | 是 | 是 | 否 | 否 | 不覆盖周计划人工计划字段，但会重算执行行与工序周期 | 是（admission 范围内） | 无 | 有（准入字段） | 无 |
| `inbound-allocation` | `finished_goods_inbound` + `mps_weekly_plans` | `mps_weekly_plans.allocated_inbound_quantity/pending_quantity` | 全租户周计划；入库按 `(sales_order_number, inventory_code)` 聚合（**不区分账套**） | `mps_weekly_plans.id`，按 `(订单,品号)` FIFO | 否（只 UPDATE） | 是 | 否 | 否 | 覆盖 `allocated_inbound_quantity`、`pending_quantity` | 是 | 无 | 无 | 无 |
| `execution-rollup` | `mps_process_reports`、`mps_outsourcing_reports` | `mps_weekly_process_plans`、`mps_outsourcing_reports` | 全租户 | 记录 id | 否 | 是 | 否 | 否 | 只写状态/已收，不覆盖人工文本 | 是 | — | — | — |

**`inbound-allocation` 匹配与分摊规则（实测代码）**：按 `(order_number, item_code)` 精确匹配（**不使用 deliveryNumber 匹配**），FIFO 排序为 `latest_customer_due_date NULLS LAST, delivery_number, id`，用窗口函数计算 `prior_planned` 后按交期顺序依次吃入，公式 `greatest(least(inbound - prior_planned, planned_quantity), 0)`。当前 1169 条初始化记录全部 `delivery_number = 1`，未来同订单+品号出现多个交期时按上述顺序从最早交期开始分摊，直到入库量耗尽。

---

## 七、dry-run 结果（只读模拟，未写入任何数据）

### 7.1 `erp-orders` dry-run

| 指标 | 值 |
| --- | ---: |
| `wouldRead` | 121,485 |
| `wouldInsert` | **121,485** |
| `wouldUpdate` | 0 |
| `wouldUnchanged` | 0 |
| 身份冲突 | 0 |
| 新增中「订单+品号已存在于快照」 | 1,098 行 / 1,095 键 / 90 订单 |
| 历史订单风险 | 会一次性灌入 2020-08-31 起全部 121,485 行 |

边界候选的只读量化（用于第八节选型）：

| 候选条件 | 放行行数 |
| --- | ---: |
| 全量（当前代码行为） | 121,485 |
| 排除快照已存在的业务键 | 120,387 |
| `updated_at >= 2026-09-18 00:00 (CST)` | 1,456 |
| `updated_at >= now() - 7 days` | 10,437 |
| `order_date = 2026-09-18` | 123 |
| 仅科加账套 `UFTData418971_000003` | 18,205 |
| 仅 `close_status='未关闭'` | 69,999 |
| 科加账套 + `updated_at >= 2026-09-18 (CST)` | 326 |
| 科加账套 + `未关闭` + 排除快照业务键 | 12,581 |

### 7.2 `plan-projections` dry-run（假设 `erp-orders` 已按现状执行）

| 目标 | 现有 | 预计目标键/单 | 预计 INSERT |
| --- | ---: | ---: | ---: |
| `mps_order_allocations` | 1,169 | 118,216 | **117,047** |
| `mps_monthly_plans` | 1,169 | 118,216 | **117,047** |
| `mps_group_plans` | 99 | 15,851 | **15,752** |

快照被覆盖重算的规模：

| 指标 | 值 |
| --- | ---: |
| 快照业务键命中 ERP 的月计划 | 1,095 |
| 需求数量会被改变 | **1,095**（快照行 + ERP 行相加） |
| 当前需求合计 → 预计合计 | 369,415 → **727,663** |

事业部归属：

| 指标 | 值 |
| --- | ---: |
| 现有订单分配 | 1,169，`division_id` 为 NULL 的 **0** 条，distinct 事业部 1 个（事业四部） |
| `mps_order_allocations.division_id` 列默认值 | `d23442f9-4862-4641-b4a7-c8d470bc56ea` = **事业四部** |
| 客户→事业部映射 | 仅 **3** 条（A027 / C235 / C234） |
| ERP 客户总数 / 未映射 | 442 / **439** |
| 未映射客户涉及的 ERP 订单品项 | **101,440** |

⚠️ 关键风险：`plan-projections` 的订单分配 INSERT **不写 `division_id`**，因此新订单会落到列默认值「事业四部」，`MISSING_ALLOCATION_DIVISION` 异常**永远不会触发**。结果是 E10/凯南账套订单会被静默归入事业四部，而不是进入「待分配」。

### 7.3 入库 dry-run

| 指标 | 值 |
| --- | ---: |
| 月计划总数 | 1,169 |
| 有匹配入库行的月计划 | 213 |
| 无匹配入库行 | 956（当前累计入库已为 0，**本次会被重置为 0 的为 0 条**） |
| 累计入库数量会变化 | **121**（全部为增加，无减少） |
| 欠数会变化 | **121** |
| 完成率会变化 | **121** |
| 周计划分摊会变化 | **121**（其中 95 条从 0 变为已分摊） |

入库口径风险（只读实测）：

| 指标 | 值 |
| --- | ---: |
| 同一 `(订单,品号)` 出现在多个账套的入库键 | 12 |
| 同一订单号出现在多个 ERP 账套 | 70（其中 7 个与快照相关） |

`finished_goods_inbound` 的聚合 **不按 `source_database` 分组**，因此事业三部（凯南）与事业四部（科加）同订单号/品号的入库会互相加总。当前影响面有限（12 个键），但属于正式运行前必须收敛的口径缺口。

### 7.4 是否安全直接启用

| 同步键 | 直接启用是否安全 | 原因 |
| --- | --- | --- |
| `erp-orders` | 不安全 | 全量重灌 + 1,098 行业务重复 |
| `plan-projections` | 不安全 | 目标表数量级扩张 + 快照需求翻倍 + 事业部默认值兜底 |
| 入库计算（含在 `plan-projections`） | 不安全 | 即使 `inbound-allocation` 保持 disabled 也会被重算；且不区分账套 |
| `shipping-to-base` | 空转 | 出货计划 0 行 |
| `base-to-weekly` | 空转 | 准入字段 0 条满足 |

---

## 八、推荐方案

### 8.1 三种合并策略比较（第 29 项要求）

| 维度 | 方案 A：初始化永久 KDOS_INIT，只接 cutover 之后新来源 | 方案 B：把能一一匹配的初始化行正式改写为 ERP 来源身份 | **方案 C（推荐）：保留初始化身份 + 建立来源别名/映射 + cutover 水位** |
| --- | --- | --- | --- |
| 数据安全 | 高（完全不碰 1169 条） | 中（批量 UPDATE 1169 条来源列，需备份；`source_active` 无失效语义仍需另建） | 高（初始化行只增不改来源列；匹配关系落在独立映射表） |
| 实施复杂度 | 低 | 高（还要处理 74 条 B 类无对应、身份字段变更、审计追溯断裂） | 中（新增映射表 + 水位字段 + 准入过滤 SQL） |
| 追溯性 | 中（A/B 类重叠记录看不出对应关系） | 低（初始化来源被抹掉） | **高**（KDOS_INIT 与 ERP 身份同时可查，映射表记录绑定时间与置信依据） |
| 重复风险 | 低（但 1095 条重叠记录会长期并存两份） | 低（一对一绑定后由 ERP 维护） | **低**（准入时按业务键抑制，且映射可只用于「更新既有行」而不新增行） |
| 未来维护成本 | 中（长期双份记录） | 低 | 中（多一张映射表，但规则集中且可审计） |

匹配率实测：1095/1169 = **93.7%** 高匹配，74 条无对应。因此方案 A 完全弃用会把 93.7% 的重叠记录永久留成两份；方案 B 一次性改写来源身份风险过高（B 类 74 条、字段差异 1053/514 条、无 `source_active` 语义、审计链断裂）。

**推荐方案 C 的落地形态**：

1. 保留全部 1169 条 `KDOS_INIT / FOURTH_DIVISION_20260917` 行不动。
2. 新增「来源别名映射」（tenant + 初始化 source identity ↔ ERP source identity），用于把 ERP 的更新**指向既有初始化行**，而不是新增第二行。
3. `erp-orders` 增加准入谓词：`cutover watermark` **AND** `业务键未被快照占用（无别名映射时不新增）`。
4. 无法一一匹配的 74 条 B 类保持快照身份，永不因 ERP 侧缺失而被删除。

### 8.2 推荐实时准入边界（第 31 项 5 个候选的取舍）

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 1. `source update watermark`（`sales_orders.updated_at`） | 唯一能覆盖「今天补录旧订单 / 旧订单今天修改 / 未来订单提前创建」的判据；实测可靠（仅内容变化时推进） | 首次启用必须先把水位基线设为 cutover 时刻 | **采用（主判据）** |
| 2. staging/change event cursor | 理论最准确，可回放 | 目前主计划不消费事件；切换到事件驱动属于 LIVE-002 重构 | 保留为 LIVE-002 目标 |
| 3. ERP source key allowlist / seen set | 可精确控制哪些 ERP 行准入 | 需要维护列表；不能覆盖「修改」语义 | 与方案 1 组合使用（见 8.3） |
| 4. 业务 cutover date（`order_date >= 上线日`） | 简单 | 实测 `order_date` 有 514/1095 的偏差与回填，**不满足**业务严格可靠的前提 | 不采用（不可单独使用） |
| 5. **混合：cutover timestamp + snapshot 业务键抑制** | 覆盖补录/修改/新单，且天然避免与快照重复；无需改动 1169 条 | 需新增水位字段与抑制谓词 | **采用（推荐最终策略）** |

> 第 32 项：**不推荐**「只按 `order_date >= 某天`」。实测 `order_date` 与 ERP 修改时间不同步（±1～±17 天），单独使用必然漏掉「旧单今日修改」并误收「提前创建的未来订单」。

### 8.3 推荐的准入规则（伪代码）

```
准入 = sales_orders.source_database ∈ {业务确认的账套白名单}
   AND sales_orders.updated_at > cutover_watermark            -- 新增或修改
   AND (
         存在 source alias 映射 → UPDATE 映射到的初始化行（不新增）
       OR (不存在映射 AND 快照业务键未被占用) → INSERT 新 ERP 行
       OR (不存在映射 AND 快照业务键已被占用) → 不新增，记入「待人工绑定」数据异常
       )
```

### 8.4 订单关闭 / 撤单规则（第 33 项）

| 场景 | 主计划行为 |
| --- | --- |
| ERP `已关闭` / `已作废` | `mps_erp_order_lines.source_active=false` + 记录 `order_status`；**行保留** |
| 订单分配 / 月计划 | 保留（不删除）；月计划可标记为「已关闭来源」进入只读口径 |
| 集团计划 | 保留历史汇总值；不再因关闭而清零完成率 |
| 已进入 base / weekly | **保留**；不因 ERP 关闭删除周计划、工序报工、3 天工单或人工备注 |
| 新增准入 | `已关闭` 订单**不得**作为新订单准入（避免上线后一次性灌入 50,248 个已关闭品项） |

### 8.5 来源消失规则（第 34 项）

ERP 行从 `sales_orders` 消失时**绝不 DELETE 主计划历史**。建议 LIVE-002 增加：

- `source_active=false`（由专门的「对账扫描」写入，而不是由全量投影顺带写入）；
- 可选 `source_missing_at timestamptz` 记录首次未观察到的时刻；
- 对账扫描只比对**已被准入过**的来源身份，避免把从未准入的历史行误判为「消失」。

本任务只提出方案，不实施 Migration。

### 8.6 字段 Ownership（第 35 项）

| 归属 | 字段 |
| --- | --- |
| **ERP source-owned**（允许同步覆盖） | 客户编码/名称、品号、品名、数量、订单日期、交期、状态、金额、业务员、单位、单价 |
| **身份字段**（需专门设计，禁止当普通 UPDATE） | `orderNumber`、`itemCode`（`sales_orders.source_key` = ERP 行主键，稳定；因此身份以 `source identity` 为准，业务键变化只作为异常提示） |
| **Planning-owned**（同步绝不覆盖） | 事业部（`division_id`）、生产方式、产品属性、表面性质、评审日期、毛坯完成日期、包装完成日期、周计划人工计划、3 天工单生产日期/备注/加工备注、技术/主材/外协/工序报工 |

⚠️ 现状偏差：`plan-projections` 目前会覆盖 `division_id` 与若干交期/客户字段（这些字段在月计划上同时承担 ERP 与 Planning 职责），属于 LIVE-002 必须拆分的点。

### 8.7 3 天生产工单保护（第 26 项）

- `mps_three_day_work_orders` 只能由用户主动点击「从周计划同步」创建（`create: false`）；同步服务中**没有任何**自动生成 3 天工单的路径。
- 现状 1169 条，人工生产日期/备注/加工备注目前均为空（尚未人工维护），LIVE 设计必须保证实时 ERP 同步不会新增或覆盖这些字段。

---

## 九、计划链路缺口（第 39 项）

```
ERP (E10 / T+×2)
  |  erp_staging_raw_records -> erp_change_events -> erp_projection_consumers   已在实时运行
  v
sales_orders / finished_goods_inbound                                          可持续增量
  |  erp-orders（当前全量，需加准入）                                            待 LIVE-002
  v
mps_erp_order_lines
  |  plan-projections                                                           自动
  v
mps_order_allocations -> mps_monthly_plans -> mps_group_plans                  自动
  |  ？？？（当前无自动机制）                                                     缺口
  v
mps_shipping_plans
  |  shipping-to-base                                                          自动（但依赖上面）
  v
mps_base_plans
  |  base-to-weekly（需 4 个准入字段）                                           自动
  v
mps_weekly_plans -> 工序计划/技术/主材/外协/工序报工 -> 3 天工单                 自动 + 人工
```

**问号段的真实答案**：`mps_shipping_plans` 没有自动生成器。它只能由页面「新增」或 Excel 导入创建（资源 `create: true, remove: true`），当前 0 行。因此：

- 实时同步**只能自动到月计划/集团计划**；
- 「新订单从月计划进入基础计划」目前**没有完整自动链路**，必须由计划员排出货计划（可关联 `monthly_plan_id`），再由 `shipping-to-base` 生成基础计划；
- 这不是 bug，而是当前业务流程设计，但必须在正式上线时明确告知用户。

链路启用后的人工必填项：

1. 出货计划：客户编码、订单号、品号、品名、交期、数量、事业部（`requiredOnCreate`）。
2. 基础计划：在 `shipping-to-base` 生成后，还必须人工补齐 **`latestReviewDueDate`、`productAttribute`、`surfaceNature`、`manufacturingMethod`** 四个 `weeklyAdmissionRequiredFields`，`base-to-weekly` 才会准入。当前 1169 条基础计划这四个字段 **全部为空**，因此 `base-to-weekly` 现在满足 admission 的为 **0 条**（这正是「启用后空转」的原因，也说明 KN-MPS-SYNC-001 的修复仍然有效）。

### 运行模式（第 40 项）

当前不需要新增数据库 mode 字段：`mps_sync_configs.enabled`（5 个开关）+ `mps_system_settings` 已足够表达 SNAPSHOT / LIVE。本任务不新增 mode 字段；是否固化由 LIVE-002 决定。

---

## 十、同步启用顺序（第 41 项）与每阶段 Go/No-Go（第 42 项）

| 阶段 | 内容 | Go 条件 | No-Go / 停止条件 |
| --- | --- | --- | --- |
| **阶段 1** `erp-orders`（带准入） | 只启 `erp-orders`，验证准入边界 | 新增行数不超过 dry-run 预测上限；无「订单+品号已存在于快照」的新增；无 `order_date` 早于 cutover 的批量灌入 | 出现 Excel 之外的历史订单大规模进入 → **STOP**；出现 snapshot 业务重复 → **STOP**；新增行数显著高于预测（如 > 2 倍）→ **STOP** |
| **阶段 2** `plan-projections` | 验证分配/月计划/集团计划 | 分配/月计划新增量与阶段 1 一致；事业部归属错误为 0 | `division_id` 异常比例（落到默认事业四部而非正确事业部）异常 → **STOP**；月计划数量突然扩大（> 预期 1.1 倍）→ **STOP**；快照需求数量被改变 → **STOP** |
| **阶段 3** 入库计算 | 验证月计划累计入库/欠数/完成率 | 变化条数与 dry-run 预测同量级（当前 121 条）；无「差异减少」 | 出现累计入库被清零/减少 → **STOP**（当前存在「无入库行即重置为 0」语句）；跨账套加总导致完成率失真 → **STOP** |
| **阶段 4** `shipping-to-base` | 由计划员排出货计划后验证基础计划生成 | 生成的基础计划 1:1 对应出货计划；人工字段未被清空 | 出货计划数量与基础计划数量不符 → **STOP**；基础计划的人工日期/字典字段被覆盖 → **STOP** |
| **阶段 5** `base-to-weekly` | 验证 base→weekly 准入与执行行生成 | 仅准入行生成；未准入历史 weekly 未被改动；3 天工单与人工备注未被触碰 | 未准入 weekly 被改动 → **STOP**；出现自动 3 天工单 → **STOP**；人工备注/报工被覆盖 → **STOP** |

顺序依据真实依赖：`erp-orders → plan-projections(+入库) → shipping-to-base → base-to-weekly`，`execution-rollup` 保持现状。`inbound-allocation` 与阶段 3 是同一口径的两种落点（月计划 vs 周计划），建议在阶段 3 稳定后单独评估，不要与 `plan-projections` 同时开启。

---

## 十一、回滚方案（第 43 项，只设计不执行）

1. **切换前完整备份**：用 `scripts/backup.sh` 备份 `four_department_tracker`、`kdos` 与 uploads，并记录 SHA-256（沿用 KN-TEST-001 / PMC 退役任务的既有做法）。
2. **每阶段业务 hash**：切换前记录 19 张 `mps_*` 表精确行数 + 关键表业务 hash（例如 `md5(string_agg(id||version, ',' order by id))`）。
3. **每阶段新增 ID 集合**：阶段开始前记录基线 id 集合（或 `created_at` 水位），阶段结束后可精确圈定本次新增行。
4. **sync enabled state snapshot**：切换前导出 `mps_sync_configs(sync_key, enabled, status, last_sync_count)`，回滚时原样恢复。
5. **失败处置**：
   - 第一步：立即把对应 `mps_sync_configs.enabled` 置回 `false`（止血，秒级）；
   - 第二步：若仅新增了本阶段行且无跨表人工依赖 → 按第 3 步 ID 集合删除本次新增的 source rows；
   - 第三步：若已污染既有行（例如需求数量翻倍、入库被清零）→ 优先按第 1 步的整库备份 restore，而不是逐表修补。
6. 任一回滚完成后，重跑本任务新增的只读审计脚本，确认行数与业务 hash 回到基线。

---

## 十二、LIVE-002 需要改什么代码（第 48 项第 15 问）

1. **`erp-orders` 准入边界**（`master-plan.sync.service.ts#projectOrders`）：增加 `updated_at > cutover_watermark`、账套白名单、`close_status` 过滤与「快照业务键抑制」谓词；`source_active` 改为按 `close_status` 计算。
2. **来源别名/映射表**：新增初始化身份 ↔ ERP 身份映射（含绑定时间、依据、审计），`projectOrders` 在 INSERT 前先查映射，命中则 UPDATE 既有初始化行。
3. **水位与模式配置**：在 `mps_sync_configs` 或 `mps_system_settings` 固化 `cutover_watermark` / `admission_scope`（不新增独立 mode 表）。
4. **`plan-projections` 口径修复**：
   - 订单分配不再依赖列默认值，改为按客户映射显式写入，未映射时置 NULL 并进入 `MISSING_ALLOCATION_DIVISION` 异常；
   - 月计划区分 ERP-owned 与 Planning-owned 列，禁止覆盖 `division_id` 等计划字段；
   - `finished_goods_inbound` 聚合增加 `source_database` 维度，消除跨账套加总；
   - 「无入库行即重置为 0」语句改为只作用于**本租户已准入**的订单，避免误清零。
5. **对账/失效机制**：新增 `source_active=false` / `source_missing_at` 的对账扫描与审计，明确「关闭 ≠ 删除」。
6. **3 天工单保护**：保持 `create:false`，并补一条回归测试确认同步链路不触及 `production_start_date` / `remark` / `processing_remark`。
7. **测试**：为上述每条准入规则补单测/迁移测试，并保留 KN-MPS-SYNC-001 的 admission 回归测试。

**KN-MPS-LIVE-003（正式切换）**：按第十节 5 个阶段依次执行，每阶段做完第十一节备份/hash 与 Go/No-Go 判定，再进入下一阶段；`execution-rollup` 全程保持现状。

---

## 十三、需要业务确认（压缩到 5 项）

1. **【需要业务确认】主计划系统的账套归属**：主计划（事业四部）是否只应接入科加智能账套 `UFTData418971_000003`？E10（厦门凯南，93,138 个订单品项）与凯南账套 `UFTData741219_000012`（7,471 个）是否确定不进入主计划？（快照与 ERP 的重叠 100% 在科加账套）
2. **【需要业务确认】`close_status='已关闭'` 的业务边界**：已关闭/已作废订单是否一律不作为新订单准入？已进入 base/weekly 的订单在 ERP 关闭后是否保留原计划与报工（当前设计建议：保留，不删除）？
3. **【需要业务确认】客户→事业部映射的准入要求**：新订单是否必须先由业务维护客户映射才能进入月计划？未映射订单应进入「待分配」并阻塞进入生产计划链，还是允许按某个默认事业部先行计划？（当前列默认值会把未映射订单自动归入事业四部）
4. **【需要业务确认】同一订单+品号多交期的处理**：ERP 出现多交期/拆行时，主计划是否保留多行（`deliveryNumber > 1`）并按交期顺序分摊入库？（当前 1169 条全部 `deliveryNumber = 1`，尚无实际样本）
5. **【需要业务确认】累计入库口径**：月计划累计入库/欠数/完成率是否只统计事业四部（科加）账套？当前实现按订单号+品号聚合、不区分账套，存在跨账套加总风险（实测 12 个键）。

---

## 十四、审计结论

- 本任务**未改动任何生产业务数据**，未执行 Migration，生产库全程只读（所有查询在 `BEGIN TRANSACTION READ ONLY` 中执行）。
- 本任务**未启用任何实时同步**：`mps_sync_configs` 6 个开关保持原状（仅 `execution-rollup` enabled）。
- 1169 条快照保持原样，未删除、未重初始化。
- 剩余阻塞项：LIVE-002 的准入边界实现、来源别名映射、`plan-projections` 口径修复（事业部归属、入库账套维度）、来源失效语义。
- 本任务可以正式关闭；进入 KN-MPS-LIVE-002 前需先获得第十三节 5 项业务确认。
