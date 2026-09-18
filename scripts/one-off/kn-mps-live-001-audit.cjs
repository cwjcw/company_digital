#!/usr/bin/env node
/*
 * KN-MPS-LIVE-001 主计划「快照模式 → 实时运行模式」上线边界只读审计 / dry-run 工具
 *
 * 安全边界：
 * - 全程 **只读**：所有查询在 `BEGIN TRANSACTION READ ONLY` 中执行；本工具没有任何写库路径，
 *   没有 `--apply`、没有写语句、不修改生产业务数据，也不启用/触发任何主计划同步。
 * - 不调用任何 MANUAL 同步接口；不对 mps_sync_configs 做任何改动。
 * - 输出的 JSON 只保留统计、hash 与脱敏业务键样例（订单号/品号只输出 sha256 短 hash 与掩码），
 *   不导出客户明细或大体积原始业务数据。
 *
 * 用法（在 api 容器内运行，Node 24 + pg 已就绪）：
 *   node scripts/one-off/kn-mps-live-001-audit.cjs --out-dir /tmp/kn-mps-live-001
 */
const { createHash } = require("node:crypto");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { Client } = require("pg");

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
if (args.includes("--apply")) {
  console.error("本工具不存在 --apply：KN-MPS-LIVE-001 只允许只读审计与 dry-run。");
  process.exit(2);
}

const outDir = argOf("--out-dir", "outputs");
const tenantId = argOf("--tenant", process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN");
const generatedAt = new Date().toISOString();

const hashOf = (value) => createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 16);
/** 只保留可核对形状的掩码：保留前 5 位与后 3 位，其余替换为 *。 */
const maskOf = (value) => {
  const text = String(value ?? "");
  if (text.length <= 8) return "*".repeat(text.length);
  return `${text.slice(0, 5)}${"*".repeat(Math.min(8, text.length - 8))}${text.slice(-3)}`;
};
const businessSample = (row) => ({
  orderHash: hashOf(row.order_number), orderMasked: maskOf(row.order_number),
  itemHash: hashOf(row.item_code), itemMasked: maskOf(row.item_code)
});
const round = (value, digits = 4) => (value == null ? null : Number(Number(value).toFixed(digits)));

async function main() {
  const client = new Client({
    host: process.env.DATABASE_HOST ?? "postgres", port: Number(process.env.DATABASE_PORT ?? 5432),
    user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME
  });
  await client.connect();
  /* 统一注入 tenant：只有真正带 $1 占位符的语句才传参，避免“supplies 1 parameters”错误。 */
  const q = async (sql) => (await client.query(sql, sql.includes("$1") ? [tenantId] : [])).rows;
  const report = { task: "KN-MPS-LIVE-001", mode: "read-only-audit+dry-run", generatedAt, tenantId };
  try {
    /* 只读事务：任何写语句都会直接报错，保证审计本身不可能改动生产库。 */
    await client.query("BEGIN TRANSACTION READ ONLY");

    /* ============================ 0. 基线 / 同步开关 ============================ */
    report.baseline = {
      tableCounts: await q(`SELECT 'mps_erp_order_lines' AS table_name, count(*)::integer AS rows FROM mps_erp_order_lines
        UNION ALL SELECT 'mps_order_allocations', count(*)::integer FROM mps_order_allocations
        UNION ALL SELECT 'mps_group_plans', count(*)::integer FROM mps_group_plans
        UNION ALL SELECT 'mps_monthly_plans', count(*)::integer FROM mps_monthly_plans
        UNION ALL SELECT 'mps_shipping_plans', count(*)::integer FROM mps_shipping_plans
        UNION ALL SELECT 'mps_base_plans', count(*)::integer FROM mps_base_plans
        UNION ALL SELECT 'mps_weekly_plans', count(*)::integer FROM mps_weekly_plans
        UNION ALL SELECT 'mps_weekly_process_plans', count(*)::integer FROM mps_weekly_process_plans
        UNION ALL SELECT 'mps_three_day_work_orders', count(*)::integer FROM mps_three_day_work_orders
        UNION ALL SELECT 'mps_process_reports', count(*)::integer FROM mps_process_reports
        UNION ALL SELECT 'mps_technical_reports', count(*)::integer FROM mps_technical_reports
        UNION ALL SELECT 'mps_material_reports', count(*)::integer FROM mps_material_reports
        UNION ALL SELECT 'mps_outsourcing_reports', count(*)::integer FROM mps_outsourcing_reports
        UNION ALL SELECT 'mps_process_cycles', count(*)::integer FROM mps_process_cycles
        UNION ALL SELECT 'sales_orders', count(*)::integer FROM sales_orders
        UNION ALL SELECT 'finished_goods_inbound', count(*)::integer FROM finished_goods_inbound
        ORDER BY 1`),
      syncConfigs: await q(`SELECT sync_key, enabled, status, last_started_at, last_success_at, last_sync_count, interval_minutes
        FROM mps_sync_configs WHERE tenant_id=$1 ORDER BY sync_key`),
      /* 检查是否有并发写入风险：审计期间行数应与任务基线一致（1169 等）。 */
      serverNow: (await q("SELECT now() AS utc_now, now() AT TIME ZONE 'Asia/Shanghai' AS shanghai_now"))[0]
    };

    /* ============================ 1. sales_orders 来源审计 ============================ */
    report.sourceAudit = {
      totals: (await q(`SELECT count(*)::integer AS rows, count(DISTINCT order_number)::integer AS distinct_orders,
          count(DISTINCT (order_number,item_number))::integer AS distinct_order_items,
          count(*) FILTER (WHERE order_date IS NULL)::integer AS null_order_date,
          count(*) FILTER (WHERE planned_delivery_date IS NULL)::integer AS null_planned_delivery,
          count(*) FILTER (WHERE source_key IS NULL)::integer AS null_source_key,
          count(*) FILTER (WHERE source_system IS NULL)::integer AS null_source_system,
          min(order_date) AS min_order_date, max(order_date) AS max_order_date,
          min(created_at) AS min_created_at, max(created_at) AS max_created_at,
          min(updated_at) AS min_updated_at, max(updated_at) AS max_updated_at
        FROM sales_orders`))[0],
      bySource: await q(`SELECT coalesce(source_system,'(null)') AS source_system, coalesce(source_database,'(null)') AS source_database,
          count(*)::integer AS rows, count(DISTINCT order_number)::integer AS orders,
          count(DISTINCT (order_number,item_number))::integer AS order_items,
          count(DISTINCT customer_code)::integer AS customers,
          min(order_date) AS min_order_date, max(order_date) AS max_order_date,
          min(created_at) AS min_created_at, max(created_at) AS max_created_at,
          min(updated_at) AS min_updated_at, max(updated_at) AS max_updated_at
        FROM sales_orders GROUP BY 1,2 ORDER BY rows DESC`),
      byYear: await q(`SELECT to_char(order_date,'YYYY') AS year, count(*)::integer AS rows,
          count(DISTINCT (order_number,item_number))::integer AS order_items
        FROM sales_orders GROUP BY 1 ORDER BY 1`),
      byRecency: (await q(`SELECT
          count(*) FILTER (WHERE order_date >= current_date - 7)::integer AS order_date_7d,
          count(*) FILTER (WHERE order_date >= current_date - 30)::integer AS order_date_30d,
          count(*) FILTER (WHERE order_date >= current_date - 60)::integer AS order_date_60d,
          count(*) FILTER (WHERE order_date >= current_date - 90)::integer AS order_date_90d,
          count(*) FILTER (WHERE order_date >= current_date - 180)::integer AS order_date_180d,
          count(*) FILTER (WHERE order_date > current_date)::integer AS order_date_future,
          count(*) FILTER (WHERE updated_at >= now() - interval '1 day')::integer AS updated_24h,
          count(*) FILTER (WHERE updated_at >= now() - interval '7 days')::integer AS updated_7d,
          count(*) FILTER (WHERE updated_at >= now() - interval '30 days')::integer AS updated_30d,
          count(*) FILTER (WHERE created_at >= now() - interval '30 days')::integer AS created_30d
        FROM sales_orders`))[0],
      statusDistribution: await q(`SELECT coalesce(source_system,'(null)') AS source_system, coalesce(close_status,'(null)') AS close_status,
          count(*)::integer AS rows, count(DISTINCT (order_number,item_number))::integer AS order_items
        FROM sales_orders GROUP BY 1,2 ORDER BY 1,3 DESC`),
      /* sales_orders 里没有文档级 order_status/document_status/audit_status/cancel 列，唯一状态列是 close_status。 */
      statusColumns: await q(`SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name IN ('sales_orders','finished_goods_inbound')
          AND (column_name ILIKE '%status%' OR column_name ILIKE '%cancel%' OR column_name ILIKE '%close%' OR column_name ILIKE '%audit%')
        ORDER BY table_name, column_name`),
      inbound: {
        totals: (await q(`SELECT count(*)::integer AS rows, count(DISTINCT sales_order_number)::integer AS orders,
            count(*) FILTER (WHERE sales_order_number IS NULL)::integer AS null_sales_order,
            min(inbound_date) AS min_inbound_date, max(inbound_date) AS max_inbound_date,
            min(updated_at) AS min_updated_at, max(updated_at) AS max_updated_at
          FROM finished_goods_inbound`))[0],
        bySource: await q(`SELECT coalesce(source_system,'(null)') AS source_system, coalesce(source_database,'(null)') AS source_database,
            count(*)::integer AS rows, count(DISTINCT sales_order_number)::integer AS orders,
            min(inbound_date) AS min_inbound_date, max(inbound_date) AS max_inbound_date
          FROM finished_goods_inbound GROUP BY 1,2 ORDER BY rows DESC`)
      }
    };

    /* ============================ 2. 增量水位 / staging 架构真实性 ============================ */
    report.architecture = {
      stagingTables: await q(`SELECT 'erp_staging_raw_records' AS table_name, count(*)::integer AS rows FROM erp_staging_raw_records
        UNION ALL SELECT 'erp_change_events', count(*)::integer FROM erp_change_events
        UNION ALL SELECT 'erp_projection_consumers', count(*)::integer FROM erp_projection_consumers
        UNION ALL SELECT 'erp_sync_sources', count(*)::integer FROM erp_sync_sources
        UNION ALL SELECT 'erp_sync_runs', count(*)::integer FROM erp_sync_runs
        UNION ALL SELECT 'erp_sync_cursors', count(*)::integer FROM erp_sync_cursors
        UNION ALL SELECT 'erp_sync_batches', count(*)::integer FROM erp_sync_batches ORDER BY 1`),
      stagingByRecordType: await q(`SELECT record_type, count(*)::integer AS rows, min(modified_at) AS min_modified_at, max(modified_at) AS max_modified_at
        FROM erp_staging_raw_records WHERE record_type IN ('ORDER_HEADER','ORDER_LINE') GROUP BY 1 ORDER BY 1`),
      sourceRegistrations: await q(`SELECT source_key, source_system, source_database, source_account_name, status,
          incremental_enabled, source_snapshot_at, initialization_completed_at, last_sync_at
        FROM erp_sync_sources WHERE tenant_id=$1 ORDER BY source_key`),
      projectionConsumers: await q(`SELECT consumer_key, target_resource, record_types, enabled, status, batch_size,
          last_event_created_at, retry_count, last_error, last_success_at FROM erp_projection_consumers WHERE tenant_id=$1 ORDER BY consumer_key`),
      cursors: await q(`SELECT s.source_key, c.phase, c.stream, c.source_table, c.initialization_business_date,
          c.last_processed_modified_at, c.last_successful_scan_upper_bound
        FROM erp_sync_cursors c JOIN erp_sync_sources s ON s.id=c.source_id WHERE c.tenant_id=$1 ORDER BY s.source_key, c.phase, c.stream`),
      changeEventRecency: (await q(`SELECT count(*) FILTER (WHERE created_at >= now() - interval '1 day')::integer AS last_24h,
          count(*) FILTER (WHERE created_at >= now() - interval '7 days')::integer AS last_7d,
          max(created_at) AS max_created_at FROM erp_change_events`))[0],
      /* 主计划 erp-orders 是否消费 staging：读取实际代码语义（全量 sales_orders 投影），此处只记录事实。 */
      masterPlanErpOrdersSource: "sales_orders（canonical 正式投影表），不使用 erp_change_events / erp_projection_consumers 游标"
    };

    /* ============================ 3. 快照元数据 ============================ */
    report.snapshot = {
      bySource: await q(`SELECT source_system, source_database, count(*)::integer AS rows,
          count(DISTINCT order_number)::integer AS orders, min(order_date) AS min_order_date, max(order_date) AS max_order_date,
          count(*) FILTER (WHERE source_updated_at IS NULL)::integer AS null_source_updated_at,
          count(*) FILTER (WHERE source_active)::integer AS active
        FROM mps_erp_order_lines WHERE tenant_id=$1 GROUP BY 1,2 ORDER BY rows DESC`),
      keyShape: (await q(`SELECT count(*) FILTER (WHERE source_key = order_number||'|'||item_code||'|'||'1')::integer AS key_is_order_item_delivery,
          count(*)::integer AS rows FROM mps_erp_order_lines WHERE tenant_id=$1`))[0],
      populatedColumns: (await q(`SELECT count(*)::integer AS rows,
          count(*) FILTER (WHERE customer_code IS NULL)::integer AS null_customer_code,
          count(*) FILTER (WHERE customer_name IS NULL)::integer AS null_customer_name,
          count(*) FILTER (WHERE salesperson_name IS NULL)::integer AS null_salesperson,
          count(*) FILTER (WHERE order_type IS NULL)::integer AS null_order_type,
          count(*) FILTER (WHERE customer_due_date IS NULL)::integer AS null_customer_due_date,
          count(*) FILTER (WHERE preproduction_review_date IS NULL)::integer AS null_review_date,
          count(*) FILTER (WHERE expected_shipping_date IS NULL)::integer AS null_expected_shipping,
          count(*) FILTER (WHERE unit IS NULL)::integer AS null_unit,
          count(*) FILTER (WHERE tax_included_unit_price IS NULL)::integer AS null_price,
          count(*) FILTER (WHERE tax_included_amount IS NULL)::integer AS null_amount,
          count(*) FILTER (WHERE order_status IS NULL)::integer AS null_order_status
        FROM mps_erp_order_lines WHERE tenant_id=$1`))[0]
    };

    /* ============================ 4. snapshot ↔ ERP overlap ============================ */
    const erpLines = `SELECT order_number, item_number, count(*) AS rows_,
        sum(coalesce(quantity,0)) AS quantity, min(order_date) AS first_order_date, max(order_date) AS last_order_date,
        max(customer_code) AS customer_code, max(close_status) AS close_status, max(item_name) AS item_name,
        max(planned_delivery_date) AS delivery_date, max(updated_at) AS updated_at
      FROM sales_orders GROUP BY 1,2`;
    report.overlap = {
      snapshotLines: (await q(`SELECT count(*)::integer AS snapshot_lines, count(DISTINCT order_number)::integer AS snapshot_orders,
          count(DISTINCT (order_number,item_code))::integer AS snapshot_order_items FROM mps_erp_order_lines WHERE tenant_id=$1`))[0],
      classification: (await q(`WITH snap AS (
          SELECT order_number, item_code, order_date, order_quantity, customer_code, item_name, expected_shipping_date
          FROM mps_erp_order_lines WHERE tenant_id=$1
        ), erp AS (${erpLines})
        SELECT
          count(*)::integer AS snapshot_lines,
          count(erp.order_number)::integer AS class_a_order_item_matched,
          count(*) FILTER (WHERE erp.order_number IS NULL)::integer AS class_b_snapshot_only,
          count(*) FILTER (WHERE erp.order_number IS NOT NULL AND snap.order_quantity IS DISTINCT FROM erp.quantity)::integer AS class_d_quantity_diff,
          count(*) FILTER (WHERE erp.order_number IS NOT NULL AND btrim(coalesce(snap.customer_code,'')) IS DISTINCT FROM btrim(coalesce(erp.customer_code,'')))::integer AS class_d_customer_diff,
          count(*) FILTER (WHERE erp.order_number IS NOT NULL AND snap.order_date IS DISTINCT FROM erp.first_order_date)::integer AS class_d_order_date_diff,
          count(*) FILTER (WHERE erp.order_number IS NOT NULL AND btrim(coalesce(snap.item_name,'')) IS DISTINCT FROM btrim(coalesce(erp.item_name,'')))::integer AS class_d_item_name_diff,
          count(*) FILTER (WHERE erp.order_number IS NOT NULL AND snap.expected_shipping_date IS DISTINCT FROM erp.delivery_date)::integer AS class_d_due_date_diff
        FROM snap LEFT JOIN erp ON erp.order_number=snap.order_number AND erp.item_number=snap.item_code`))[0],
      classCBySource: await q(`WITH snap AS (SELECT order_number, item_code FROM mps_erp_order_lines WHERE tenant_id=$1),
          erp AS (SELECT order_number, item_number, source_system, source_database FROM sales_orders GROUP BY 1,2,3,4)
        SELECT erp.source_system, erp.source_database, count(*)::integer AS erp_order_items,
          count(snap.order_number)::integer AS matched_snapshot,
          count(*) FILTER (WHERE snap.order_number IS NULL)::integer AS class_c_erp_only
        FROM erp LEFT JOIN snap ON snap.order_number=erp.order_number AND snap.item_code=erp.item_number
        GROUP BY 1,2 ORDER BY 3 DESC`),
      distinctKeyExcepts: (await q(`WITH snap AS (SELECT DISTINCT order_number||'|'||item_code AS key FROM mps_erp_order_lines WHERE tenant_id=$1),
          erp AS (SELECT DISTINCT order_number||'|'||item_number AS key FROM sales_orders)
        SELECT (SELECT count(*)::integer FROM (SELECT key FROM snap EXCEPT SELECT key FROM erp) x) AS snapshot_only_keys,
          (SELECT count(*)::integer FROM (SELECT key FROM erp EXCEPT SELECT key FROM snap) x) AS erp_only_keys,
          (SELECT count(*)::integer FROM (SELECT key FROM snap INTERSECT SELECT key FROM erp) x) AS shared_keys,
          (SELECT count(DISTINCT order_number)::integer FROM sales_orders) AS erp_distinct_orders`))[0],
      erpOnlyRecency: (await q(`WITH snap AS (SELECT order_number, item_code FROM mps_erp_order_lines WHERE tenant_id=$1),
          erp AS (SELECT order_number, item_number, max(updated_at) AS updated_at, min(order_date) AS order_date
            FROM sales_orders GROUP BY 1,2)
        SELECT count(*)::integer AS erp_only_order_items,
          count(*) FILTER (WHERE erp.updated_at >= now() - interval '1 day')::integer AS updated_24h,
          count(*) FILTER (WHERE erp.updated_at >= now() - interval '7 days')::integer AS updated_7d,
          count(*) FILTER (WHERE erp.updated_at >= timestamp with time zone '2026-09-17 00:00:00+08')::integer AS updated_since_0917,
          count(*) FILTER (WHERE erp.order_date >= date '2026-09-18')::integer AS order_date_0918,
          count(*) FILTER (WHERE erp.order_date >= date '2026-09-15')::integer AS order_date_0915,
          count(*) FILTER (WHERE erp.order_date >= date '2026-09-01')::integer AS order_date_0901
        FROM erp LEFT JOIN snap ON snap.order_number=erp.order_number AND snap.item_code=erp.item_number
        WHERE snap.order_number IS NULL`))[0],
      /* 双向分类样例（脱敏）。 */
      samples: {
        classB: (await q(`WITH snap AS (SELECT order_number,item_code FROM mps_erp_order_lines WHERE tenant_id=$1)
          SELECT snap.order_number, snap.item_code FROM snap WHERE NOT EXISTS (
            SELECT 1 FROM sales_orders o WHERE o.order_number=snap.order_number AND o.item_number=snap.item_code)
          ORDER BY snap.order_number LIMIT 10`)).map(businessSample),
        classD: (await q(`WITH snap AS (SELECT order_number,item_code,order_date,order_quantity,customer_code FROM mps_erp_order_lines WHERE tenant_id=$1),
          erp AS (SELECT order_number,item_number,sum(coalesce(quantity,0)) quantity,min(order_date) order_date,max(customer_code) customer_code
            FROM sales_orders GROUP BY 1,2)
          SELECT snap.order_number, snap.item_code, snap.order_date AS snapshot_order_date, erp.order_date AS erp_order_date,
            snap.order_quantity AS snapshot_quantity, erp.quantity AS erp_quantity
          FROM snap JOIN erp ON erp.order_number=snap.order_number AND erp.item_number=snap.item_code
          WHERE (snap.order_quantity,snap.order_date,btrim(coalesce(snap.customer_code,''))) IS DISTINCT FROM
            (erp.quantity,erp.order_date,btrim(coalesce(erp.customer_code,'')))
          ORDER BY random() LIMIT 10`)).map((row) => ({ ...businessSample(row), snapshotOrderDate: row.snapshot_order_date,
            erpOrderDate: row.erp_order_date, snapshotQuantity: round(row.snapshot_quantity), erpQuantity: round(row.erp_quantity) }))
      }
    };

    /* ============================ 5. erp-orders dry-run ============================ */
    const sourceIdentity = `coalesce(o.source_system,'SYSTEM') AS ss, coalesce(o.source_database,'KDOS') AS sd,
      coalesce(o.source_key,o.id::text) AS sk, o.order_number, o.item_number, o.id`;
    report.dryRunErpOrders = (await q(`WITH src AS (
        SELECT ${sourceIdentity}, o.employee_name, o.customer_code, o.updated_at AS source_updated_at FROM sales_orders o
        WHERE btrim(coalesce(o.order_number,''))<>'' AND btrim(coalesce(o.item_number,''))<>''
      ), matched AS (
        SELECT src.*, t.id AS existing_id,
          (t.salesperson_name,t.customer_code,t.order_number,t.item_code,t.order_quantity,t.source_updated_at)
            IS DISTINCT FROM (src.employee_name,src.customer_code,src.order_number,src.item_number,0::numeric,src.source_updated_at) AS payload_differs
        FROM src LEFT JOIN mps_erp_order_lines t ON t.tenant_id=$1 AND t.source_system=src.ss AND t.source_database=src.sd AND t.source_key=src.sk
      )
      SELECT count(*)::integer AS would_read,
        count(*) FILTER (WHERE existing_id IS NULL)::integer AS would_insert,
        count(*) FILTER (WHERE existing_id IS NOT NULL AND payload_differs)::integer AS would_update,
        count(*) FILTER (WHERE existing_id IS NOT NULL AND NOT payload_differs)::integer AS would_unchanged,
        count(*) FILTER (WHERE existing_id IS NOT NULL)::integer AS identity_conflicts
      FROM matched`))[0];
    report.dryRunErpOrders.businessDuplicates = (await q(`WITH snap AS (SELECT DISTINCT order_number,item_code FROM mps_erp_order_lines WHERE tenant_id=$1),
        src AS (SELECT order_number, item_number, coalesce(source_system,'SYSTEM') ss, coalesce(source_database,'KDOS') sd,
          coalesce(source_key,id::text) sk FROM sales_orders
          WHERE btrim(coalesce(order_number,''))<>'' AND btrim(coalesce(item_number,''))<>'')
      SELECT count(*)::integer AS would_insert_rows_sharing_business_key,
        count(DISTINCT src.order_number||'|'||src.item_number)::integer AS affected_snapshot_business_keys,
        count(DISTINCT src.order_number)::integer AS affected_orders
      FROM src JOIN snap ON snap.order_number=src.order_number AND snap.item_code=src.item_number
      WHERE NOT EXISTS (SELECT 1 FROM mps_erp_order_lines t WHERE t.tenant_id=$1 AND t.source_system=src.ss AND t.source_database=src.sd AND t.source_key=src.sk)`))[0];
    report.dryRunErpOrders.snapshotPostState = (await q(`SELECT
        (SELECT count(*)::integer FROM mps_erp_order_lines WHERE tenant_id=$1) AS snapshot_lines,
        (SELECT count(DISTINCT (order_number,item_code))::integer FROM mps_erp_order_lines WHERE tenant_id=$1) AS snapshot_business_keys,
        (SELECT count(*)::integer FROM sales_orders) AS would_add_lines,
        (SELECT count(DISTINCT (order_number,item_number))::integer FROM sales_orders) AS erp_business_keys,
        (SELECT count(DISTINCT order_number)::integer FROM sales_orders) AS erp_orders,
        (SELECT count(*)::integer FROM mps_erp_order_lines WHERE tenant_id=$1) + (SELECT count(*)::integer FROM sales_orders) AS post_total_lines`))[0];

    /* 增量边界候选的只读量化：每种候选筛选条件在“当前全量投影”下会放行多少行（仅统计，不改变任何开关）。 */
    report.dryRunErpOrders.boundaryScenarios = (await q(`WITH src AS (
        SELECT coalesce(source_system,'SYSTEM') ss, coalesce(source_database,'KDOS') sd,
          source_database, order_number, item_number, order_date, close_status, updated_at
        FROM sales_orders WHERE btrim(coalesce(order_number,''))<>'' AND btrim(coalesce(item_number,''))<>''
      ), snap AS (SELECT DISTINCT order_number, item_code FROM mps_erp_order_lines WHERE tenant_id=$1)
      SELECT
        count(*)::integer AS full_scan_rows,
        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM snap s WHERE s.order_number=src.order_number AND s.item_code=src.item_number))::integer AS excluding_snapshot_business_keys,
        count(*) FILTER (WHERE updated_at >= timestamp with time zone '2026-09-18 00:00:00+08')::integer AS watermark_since_20260918_cst,
        count(*) FILTER (WHERE updated_at >= now() - interval '7 days')::integer AS watermark_last_7d,
        count(*) FILTER (WHERE order_date >= date '2026-09-18')::integer AS order_date_today,
        count(*) FILTER (WHERE source_database='UFTData418971_000003')::integer AS only_kejia_account,
        count(*) FILTER (WHERE close_status='未关闭')::integer AS only_open_status,
        count(*) FILTER (WHERE source_database='UFTData418971_000003' AND updated_at >= timestamp with time zone '2026-09-18 00:00:00+08')::integer AS kejia_plus_watermark,
        count(*) FILTER (WHERE source_database='UFTData418971_000003' AND close_status='未关闭'
          AND NOT EXISTS (SELECT 1 FROM snap s WHERE s.order_number=src.order_number AND s.item_code=src.item_number))::integer AS kejia_open_non_snapshot
      FROM src`))[0];

    /* ============================ 6. plan-projections dry-run ============================ */
    report.dryRunPlanProjections = {
      assumptions: "假设 erp-orders 已按当前代码执行（全部 sales_orders 全量投影），再评估 plan-projections 的写入规模；未执行任何写库。",
      allocations: (await q(`WITH erp AS (SELECT DISTINCT order_number, item_number FROM sales_orders),
          snap AS (SELECT DISTINCT order_number, item_code FROM mps_erp_order_lines WHERE tenant_id=$1),
          target AS (SELECT order_number, item_number FROM erp UNION SELECT order_number, item_code FROM snap)
        SELECT count(*)::integer AS would_target_keys,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM mps_order_allocations a WHERE a.tenant_id=$1 AND a.order_number=t.order_number AND a.item_code=t.item_number))::integer AS existing_keys,
          count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM mps_order_allocations a WHERE a.tenant_id=$1 AND a.order_number=t.order_number AND a.item_code=t.item_number))::integer AS would_insert,
          count(DISTINCT t.order_number)::integer AS would_target_orders
        FROM target t`))[0],
      monthly: (await q(`WITH erp AS (SELECT DISTINCT order_number, item_number FROM sales_orders),
          snap AS (SELECT DISTINCT order_number, item_code FROM mps_erp_order_lines WHERE tenant_id=$1),
          target AS (SELECT order_number, item_number FROM erp UNION SELECT order_number, item_code FROM snap)
        SELECT count(*)::integer AS would_target_keys,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM mps_monthly_plans m WHERE m.tenant_id=$1 AND m.order_number=t.order_number AND m.item_code=t.item_number))::integer AS existing_keys,
          count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM mps_monthly_plans m WHERE m.tenant_id=$1 AND m.order_number=t.order_number AND m.item_code=t.item_number))::integer AS would_insert
        FROM target t`))[0],
      groupPlans: (await q(`WITH erp AS (SELECT DISTINCT order_number FROM sales_orders),
          snap AS (SELECT DISTINCT order_number FROM mps_erp_order_lines WHERE tenant_id=$1),
          target AS (SELECT order_number FROM erp UNION SELECT order_number FROM snap)
        SELECT count(*)::integer AS would_target_orders,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM mps_group_plans g WHERE g.tenant_id=$1 AND g.order_number=t.order_number))::integer AS existing_orders,
          count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM mps_group_plans g WHERE g.tenant_id=$1 AND g.order_number=t.order_number))::integer AS would_insert
        FROM target t`))[0],
      /* 当前 1169 快照会被 plan-projections 覆盖重算的规模（账套重名 + 同业务键重复行会放大数量）。 */
      snapshotDoubleCounting: (await q(`WITH snap AS (SELECT DISTINCT order_number,item_code,order_quantity FROM mps_erp_order_lines WHERE tenant_id=$1),
          erp AS (SELECT order_number,item_number,sum(coalesce(quantity,0)) quantity FROM sales_orders GROUP BY 1,2),
          a AS (SELECT m.id,m.order_number,m.item_code,m.required_quantity,coalesce(erp.quantity,0) erp_quantity
            FROM mps_monthly_plans m LEFT JOIN snap ON snap.order_number=m.order_number AND snap.item_code=m.item_code
            LEFT JOIN erp ON erp.order_number=m.order_number AND erp.item_number=m.item_code)
        SELECT count(*)::integer AS monthly_total,
          count(*) FILTER (WHERE erp_quantity <> 0)::integer AS monthly_matching_erp,
          /* 当前代码按 (order,item) 汇总 mps_erp_order_lines：快照行 + ERP 行会相加，因此这 1095 条需求数量近似翻倍。 */
          count(*) FILTER (WHERE erp_quantity <> 0)::integer AS required_quantity_would_change,
          sum(CASE WHEN erp_quantity <> 0 THEN erp_quantity ELSE 0 END)::numeric AS erp_quantity_sum,
          sum(required_quantity)::numeric AS snapshot_required_quantity_sum,
          sum(CASE WHEN erp_quantity <> 0 THEN required_quantity + erp_quantity ELSE required_quantity END)::numeric AS would_be_required_quantity_sum
        FROM a`))[0],
      divisionAssignment: (await q(`SELECT count(*)::integer AS allocations,
          count(*) FILTER (WHERE division_id IS NULL)::integer AS division_null,
          count(DISTINCT division_id)::integer AS distinct_division FROM mps_order_allocations WHERE tenant_id=$1`))[0],
      divisionColumnDefault: (await q(`SELECT column_name, column_default, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='mps_order_allocations' AND column_name='division_id'`))[0],
      divisionMappingCoverage: {
        mappings: (await q(`SELECT count(*)::integer AS mappings, count(DISTINCT customer_code)::integer AS mapped_customers
          FROM mps_customer_division_mappings WHERE tenant_id=$1 AND enabled`))[0],
        erpCustomers: (await q(`WITH erp AS (SELECT DISTINCT customer_code FROM sales_orders WHERE customer_code IS NOT NULL),
            snap AS (SELECT DISTINCT customer_code FROM mps_erp_order_lines WHERE tenant_id=$1 AND customer_code IS NOT NULL)
          SELECT count(*)::integer AS erp_customers,
            count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM mps_customer_division_mappings m WHERE m.tenant_id=$1 AND m.enabled AND m.customer_code=erp.customer_code))::integer AS unmapped_erp_customers,
            count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM snap WHERE snap.customer_code=erp.customer_code))::integer AS erp_only_customers
          FROM erp`))[0],
        erpBatch: (await q(`WITH erp AS (SELECT DISTINCT customer_code FROM sales_orders WHERE customer_code IS NOT NULL),
            snap AS (SELECT DISTINCT customer_code FROM mps_erp_order_lines WHERE tenant_id=$1 AND customer_code IS NOT NULL)
          SELECT count(DISTINCT o.order_number||'|'||o.item_number)::integer AS erp_order_items_unmapped_customers
          FROM erp JOIN sales_orders o ON o.customer_code=erp.customer_code
          WHERE NOT EXISTS (SELECT 1 FROM mps_customer_division_mappings m WHERE m.tenant_id=$1 AND m.enabled AND m.customer_code=erp.customer_code)
            AND NOT EXISTS (SELECT 1 FROM snap WHERE snap.customer_code=erp.customer_code)`))[0]
      }
    };

    /* ============================ 7. 入库覆盖 dry-run ============================ */
    const inboundTotals = `SELECT sales_order_number AS order_number, inventory_code AS item_code,
      sum(coalesce(received_quantity,0)) AS quantity FROM finished_goods_inbound WHERE sales_order_number IS NOT NULL GROUP BY 1,2`;
    report.dryRunInbound = {
      monthly: (await q(`WITH totals AS (${inboundTotals})
        SELECT count(*)::integer AS monthly_total,
          count(*) FILTER (WHERE t.order_number IS NOT NULL)::integer AS with_inbound,
          count(*) FILTER (WHERE t.order_number IS NULL)::integer AS without_inbound,
          count(*) FILTER (WHERE t.order_number IS NULL AND m.cumulative_inbound_quantity <> 0)::integer AS would_be_reset_to_zero,
          count(*) FILTER (WHERE t.order_number IS NOT NULL AND m.cumulative_inbound_quantity IS DISTINCT FROM t.quantity)::integer AS cumulative_would_change,
          count(*) FILTER (WHERE t.order_number IS NOT NULL AND t.quantity > m.cumulative_inbound_quantity)::integer AS cumulative_would_increase,
          count(*) FILTER (WHERE t.order_number IS NOT NULL AND t.quantity < m.cumulative_inbound_quantity)::integer AS cumulative_would_decrease,
          count(*) FILTER (WHERE m.pending_quantity IS DISTINCT FROM greatest(m.required_quantity - coalesce(t.quantity,0),0))::integer AS pending_would_change,
          count(*) FILTER (WHERE m.completion_rate IS DISTINCT FROM (CASE WHEN m.required_quantity<=0 THEN 0
            ELSE round(least(coalesce(t.quantity,0)/m.required_quantity,1),4) END))::integer AS completion_rate_would_change
        FROM mps_monthly_plans m LEFT JOIN totals t ON t.order_number=m.order_number AND t.item_code=m.item_code`))[0],
      weekly: (await q(`WITH totals AS (${inboundTotals}), ordered AS (
          SELECT w.id,w.planned_quantity,w.allocated_inbound_quantity,w.pending_quantity,coalesce(t.quantity,0) AS inbound_quantity,
            coalesce(sum(w.planned_quantity) OVER (PARTITION BY w.order_number,w.item_code
              ORDER BY w.latest_customer_due_date NULLS LAST,w.delivery_number,w.id
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior_planned
          FROM mps_weekly_plans w LEFT JOIN totals t ON t.order_number=w.order_number AND t.item_code=w.item_code WHERE w.tenant_id=$1)
        SELECT count(*)::integer AS weekly_total,
          count(*) FILTER (WHERE allocated_inbound_quantity IS DISTINCT FROM greatest(least(inbound_quantity-prior_planned,planned_quantity),0))::integer AS allocated_would_change,
          count(*) FILTER (WHERE pending_quantity IS DISTINCT FROM greatest(planned_quantity-greatest(least(inbound_quantity-prior_planned,planned_quantity),0),0))::integer AS pending_would_change,
          count(*) FILTER (WHERE allocated_inbound_quantity=0 AND greatest(least(inbound_quantity-prior_planned,planned_quantity),0)>0)::integer AS newly_allocated
        FROM ordered`))[0],
      /* 交付口径风险：inbound 聚合不区分 source_database，两个 T+ 账套同订单号/品号会互相加总。 */
      crossSourceRisk: {
        inboundKeysWithMultipleSources: (await q(`SELECT count(*)::integer AS keys_multi_source FROM (
            SELECT sales_order_number, inventory_code FROM finished_goods_inbound WHERE sales_order_number IS NOT NULL
            GROUP BY 1,2 HAVING count(DISTINCT source_database)>1) x`))[0],
        orderNumbersInMultipleErpDatabases: (await q(`SELECT count(*)::integer AS orders FROM (
            SELECT order_number FROM sales_orders GROUP BY 1 HAVING count(DISTINCT source_database)>1) x`))[0],
        orderNumbersInMultipleErpDatabasesHitSnapshot: (await q(`WITH multi AS (
            SELECT order_number FROM sales_orders GROUP BY 1 HAVING count(DISTINCT source_database)>1)
          SELECT count(DISTINCT m.order_number)::integer AS orders FROM multi m
          JOIN mps_erp_order_lines s ON s.tenant_id=$1 AND s.order_number=m.order_number`))[0]
      },
      samples: (await q(`WITH totals AS (${inboundTotals})
        SELECT m.order_number,m.item_code,m.required_quantity,m.cumulative_inbound_quantity,m.pending_quantity,m.completion_rate,
          t.quantity AS erp_quantity
        FROM mps_monthly_plans m LEFT JOIN totals t ON t.order_number=m.order_number AND t.item_code=m.item_code
        WHERE m.cumulative_inbound_quantity IS DISTINCT FROM coalesce(t.quantity,0)
        ORDER BY random() LIMIT 20`)).map((row) => ({ ...businessSample(row), requiredQuantity: round(row.required_quantity),
          currentCumulativeInbound: round(row.cumulative_inbound_quantity), wouldBeCumulativeInbound: round(row.erp_quantity ?? 0),
          currentPending: round(row.pending_quantity), currentCompletionRate: round(row.completion_rate) }))
    };

    /* ============================ 8. 计划链路 / 准入条件 ============================ */
    report.chain = {
      shippingPlans: (await q(`SELECT count(*)::integer AS rows FROM mps_shipping_plans WHERE tenant_id=$1`))[0],
      basePlans: (await q(`SELECT count(*)::integer AS rows,
          count(*) FILTER (WHERE latest_review_due_date IS NULL)::integer AS missing_latest_review_due_date,
          count(*) FILTER (WHERE product_attribute IS NULL OR btrim(product_attribute)='')::integer AS missing_product_attribute,
          count(*) FILTER (WHERE surface_nature IS NULL OR btrim(surface_nature)='')::integer AS missing_surface_nature,
          count(*) FILTER (WHERE manufacturing_method IS NULL OR btrim(manufacturing_method)='')::integer AS missing_manufacturing_method,
          count(*) FILTER (WHERE shipping_plan_id IS NULL)::integer AS without_shipping_plan
        FROM mps_base_plans WHERE tenant_id=$1`))[0],
      weeklyPlans: (await q(`SELECT count(*)::integer AS rows,
          count(*) FILTER (WHERE latest_review_due_date IS NULL)::integer AS missing_latest_review_due_date,
          count(*) FILTER (WHERE product_attribute IS NULL OR btrim(product_attribute)='')::integer AS missing_product_attribute,
          count(*) FILTER (WHERE surface_nature IS NULL OR btrim(surface_nature)='')::integer AS missing_surface_nature,
          count(*) FILTER (WHERE manufacturing_method IS NULL OR btrim(manufacturing_method)='')::integer AS missing_manufacturing_method
        FROM mps_weekly_plans WHERE tenant_id=$1`))[0],
      weeklyAdmissionRequiredFields: ["latestReviewDueDate", "productAttribute", "surfaceNature", "manufacturingMethod"],
      weeklyAdmissionCurrentlySatisfied: (await q(`SELECT count(*)::integer AS admitted FROM mps_base_plans base WHERE base.tenant_id=$1
        AND NULLIF(btrim(base.latest_review_due_date::text),'') IS NOT NULL
        AND NULLIF(btrim(base.product_attribute::text),'') IS NOT NULL
        AND NULLIF(btrim(base.surface_nature::text),'') IS NOT NULL
        AND NULLIF(btrim(base.manufacturing_method::text),'') IS NOT NULL`))[0],
      workOrders: (await q(`SELECT count(*)::integer AS rows,
          count(*) FILTER (WHERE production_start_date IS NOT NULL)::integer AS with_manual_production_date,
          count(*) FILTER (WHERE remark IS NOT NULL AND btrim(remark)<>'')::integer AS with_manual_remark,
          count(*) FILTER (WHERE processing_remark IS NOT NULL AND btrim(processing_remark)<>'')::integer AS with_manual_processing_remark
        FROM mps_three_day_work_orders WHERE tenant_id=$1`))[0],
      outbox: await q(`SELECT sync_key, status, count(*)::integer AS rows FROM mps_reconciliation_outbox WHERE tenant_id=$1 GROUP BY 1,2 ORDER BY 1,2`),
      syncLogs: await q(`SELECT sync_key, run_type, status, count(*)::integer AS runs, max(started_at) AS last_started
        FROM mps_sync_logs WHERE tenant_id=$1 GROUP BY 1,2,3 ORDER BY 1,2,3`)
    };

    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }

  const write = (name, payload) => {
    mkdirSync(outDir, { recursive: true });
    const target = join(outDir, name);
    writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
    return target;
  };
  report.writtenFiles = [
    write("KN-MPS-LIVE-001-source-audit.json", {
      task: report.task, mode: report.mode, generatedAt, tenantId,
      baseline: report.baseline, sourceAudit: report.sourceAudit, snapshot: report.snapshot
    }),
    write("KN-MPS-LIVE-001-overlap.json", { task: report.task, mode: report.mode, generatedAt, tenantId, overlap: report.overlap }),
    write("KN-MPS-LIVE-001-dry-run.json", {
      task: report.task, mode: report.mode, generatedAt, tenantId,
      architecture: report.architecture, dryRunErpOrders: report.dryRunErpOrders,
      dryRunPlanProjections: report.dryRunPlanProjections, dryRunInbound: report.dryRunInbound, chain: report.chain
    })
  ];
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`KN-MPS-LIVE-001 只读审计失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
