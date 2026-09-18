/**
 * KN-MPS-LIVE-002：主计划 ERP 订单准入的唯一权威定义。
 *
 * 最高优先级业务原则（在本文件集中表达，禁止在其它地方手写第二份）：
 * 1) PMC 主计划当前**只允许读取科加账套**；其他账套（E10、凯南 T+）全部暂停，直到用户明确要求导入。
 * 2) 新订单业务准入水位是**下单日期** `order_date >= 2026-09-17`，不是 created_at / updated_at。
 * 3) 增量变化判断继续使用 ERP 最后更新时间（`sales_orders.updated_at` ← `LastModifiedDate`）。
 * 4) 已关闭 / 已完成 / 已作废订单不得作为**新订单**准入，但已经进入计划链的历史记录必须保留。
 *
 * `sales_orders` 是三账套混合 canonical 表（ERP 采集层与销售看板等模块共用），因此
 * 「只读科加」必须在这里作为**主计划准入谓词**强制，而不是通过改动共享表实现。
 */
export const MASTER_PLAN_ERP_ADMISSION = {
  /** 唯一允许进入主计划的来源账套。 */
  sourceSystem: "T+",
  sourceDatabase: "UFTData418971_000003",
  sourceKey: "tplus-kejia",
  accountName: "科加智能",
  /** 业务准入水位（下单日期）：order_date >= 该日期才允许作为新订单进入主计划。 */
  orderDateFrom: "2026-09-17",
  /** 不得作为新订单准入的 ERP 订单状态（sales_orders.close_status 的实际取值口径）。 */
  blockedOrderStatuses: ["已关闭", "已完成", "已作废"],
  /** 允许被「来源身份别名」绑定的历史初始化来源（快照基线）。 */
  snapshotSourceSystems: ["KDOS_INIT"]
} as const;

/** 别名绑定原因：ERP 新来源身份与历史快照业务键相同，必须抑制第二条业务重复记录。 */
export const SNAPSHOT_BUSINESS_KEY_BINDING = "SNAPSHOT_BUSINESS_KEY_MATCH";

/** `source_key` 值内联进 SQL 时只允许安全字符；用于拒绝异常来源身份。 */
export function assertSafeSourceKey(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9._:|/-]{1,255}$/.test(text)) throw new Error(`非法的 ERP 来源身份 source_key：${text.slice(0, 64)}`);
  return text;
}

/** 统一构造「来源身份」SQL 片段，保证投影、别名绑定与对账使用完全相同的表达式。 */
export function erpSourceIdentitySql(alias: string) {
  return {
    sourceSystem: `coalesce(${alias}.source_system,'SYSTEM')`,
    sourceDatabase: `coalesce(${alias}.source_database,'KDOS')`,
    sourceKey: `coalesce(${alias}.source_key,${alias}.id::text)`
  };
}

/** 账套白名单谓词：主计划任何 ERP 读取都必须先满足它。 */
export function erpAccountWhitelistSql(alias: string) {
  return `${alias}.source_database='${MASTER_PLAN_ERP_ADMISSION.sourceDatabase}'`;
}

/** 禁止作为新订单准入的状态列表（SQL IN 片段）。 */
export function blockedOrderStatusSql() {
  return MASTER_PLAN_ERP_ADMISSION.blockedOrderStatuses.map((status) => `'${status}'`).join(",");
}

/** 订单是否处于可准入状态（ERP 状态为空时按未关闭处理，与 canonical 投影口径一致）。 */
export function erpOrderAdmissibleStatusSql(alias: string) {
  return `(${alias}.close_status IS NULL OR ${alias}.close_status NOT IN (${blockedOrderStatusSql()}))`;
}

/** 业务准入水位谓词：只用于**新来源身份**，不用于已准入记录的更新。 */
export function erpOrderDateAdmissionSql(alias: string) {
  return `(${alias}.order_date IS NOT NULL AND ${alias}.order_date >= DATE '${MASTER_PLAN_ERP_ADMISSION.orderDateFrom}')`;
}

/** 快照来源身份列表（SQL IN 片段）。 */
export function snapshotSourceSystemSql() {
  return MASTER_PLAN_ERP_ADMISSION.snapshotSourceSystems.map((value) => `'${value}'`).join(",");
}

/** 同步计数口径：日志与验收报告共用同一份键名，禁止各写一套。 */
export const MASTER_PLAN_ERP_ORDER_METRIC_KEYS = [
  "scanned", "eligible", "inserted", "updated", "unchanged", "duplicate_suppressed", "alias_bound",
  "blocked_by_source_database", "blocked_by_order_date", "blocked_by_status", "blocked_by_watermark"
] as const;

export const MASTER_PLAN_PROJECTION_METRIC_KEYS = [
  "allocations", "monthly_plans", "group_plans",
  "blocked_by_missing_customer_mapping", "inbound_recalculated", "division_defaulted"
] as const;
