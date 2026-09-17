#!/usr/bin/env node
/*
 * KN-MPS-INIT-001 事业四部「完整主计划快照」一次性后台初始化（受控运维工具）
 *
 * 目标：初始化完成后，当前主计划系统**有且仅有**这批快照数据，并且同一批 1169 个业务品项在
 *       ERP订单明细 → 订单分配 → 集团主计划 → 事业部月度计划 → 事业部基础计划 → 事业部周计划
 *       → 周计划工序明细 → 工序报工 各层一致。
 *
 * 安全设计：
 * - 默认 dry-run（只读取/校验/报告），必须显式 `--execute` 才写入。
 * - 写入前要求 blocker=0：标准文件可被 ExcelJS 直接读取、13 张目标表为空、自动同步处于快照模式
 *   （仅 execution-rollup 启用）、事业四部唯一解析、无相同 (tenant, 文件SHA256) 幂等记录。
 * - **单一事务**：ERP → 分配 → 月计划 → 集团计划 → 基础计划 → 周计划 → 工序计划 → 工序报工 →
 *   事务内完整性/集合一致性校验 → COMMIT；任何失败立即 ROLLBACK（系统回到 13 表全空或完整快照）。
 * - 不调用 erp-orders / plan-projections / shipping-to-base / base-to-weekly / inbound-allocation，
 *   也不调用 ensureExecutionRows：所有层都由本工具按同一份快照直接写入。
 *
 * 用法（api 容器内，Node 24）：
 *   node scripts/one-off/kn-mps-init-001-initialize.cjs --file /tmp/standard.xlsx --report outputs/KN-MPS-INIT-001-dry-run-final.json
 *   node scripts/one-off/kn-mps-init-001-initialize.cjs --file /tmp/standard.xlsx --execute
 */
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { Client } = require("pg");
const ExcelJS = require("exceljs");

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const index = args.indexOf(name); return index >= 0 && args[index + 1] ? args[index + 1] : fallback; };
const file = argOf("--file", "/tmp/standard.xlsx");
const tenantId = argOf("--tenant", process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN");
const reportPath = argOf("--report", "outputs/KN-MPS-INIT-001-dry-run-final.json");
const execute = args.includes("--execute");
const SYSTEM_USER_ID = "0199e000-0000-7000-8000-000000000001";
const DIVISION_NAME = "事业四部";
const PRODUCTION_DATE = "2026-09-17";
const SOURCE_SYSTEM = "KDOS_INIT";
const SOURCE_DATABASE = "FOURTH_DIVISION_20260917";
const SOURCE_ACCOUNT_NAME = "事业四部历史初始化";
const REQUIRED_SHEETS = ["README_后台初始化", "01_weekly_plans", "02_weekly_process_plans", "03_process_reports", "04_unmapped_review", "05_source_trace"];
const CANONICAL_PROCESSES = [
  ["cutting", "下料", 1], ["machining", "机加", 2], ["bending", "折弯", 3], ["spotWelding", "点焊", 4],
  ["welding", "焊接", 5], ["woodworking", "木作", 6], ["grinding", "研磨", 7], ["blank", "毛坯", 8],
  ["surfaceTreatment", "表面处理", 9], ["packaging", "包装", 10]
];
const TABLES = ["mps_erp_order_lines", "mps_order_allocations", "mps_process_cycles", "mps_group_plans", "mps_monthly_plans", "mps_shipping_plans", "mps_base_plans", "mps_weekly_plans", "mps_weekly_process_plans", "mps_technical_reports", "mps_material_reports", "mps_outsourcing_reports", "mps_process_reports"];
/** 快照模式下必须保持 disabled 的同步（仅 execution-rollup 允许 enabled）。 */
const SNAPSHOT_DISABLED_SYNCS = ["erp-orders", "plan-projections", "shipping-to-base", "base-to-weekly", "inbound-allocation"];

const text = (value) => (value == null ? "" : String(value).trim());
const dateOnly = (value) => {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
};
const numberOrNull = (value) => {
  if (value == null || text(value) === "") return null;
  const raw = typeof value === "number" ? value : Number(text(value).replace(/,/g, ""));
  return Number.isFinite(raw) ? raw : null;
};
const round4 = (value) => Math.round(Number(value) * 10000) / 10000;
const key3 = (orderNumber, itemCode, deliveryNumber) => `${text(orderNumber)}\u0000${text(itemCode)}\u0000${text(deliveryNumber)}`;
const key2 = (orderNumber, itemCode) => `${text(orderNumber)}\u0000${text(itemCode)}`;

function sheetValues(workbook, name) {
  const worksheet = workbook.worksheets.find((candidate) => candidate.name === name);
  if (!worksheet) throw new Error(`缺少工作表 ${name}`);
  const headers = [];
  worksheet.getRow(1).eachCell((cell) => headers.push(text(cell.value ?? cell.text)));
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = { __rowNumber: rowNumber };
    headers.forEach((header, index) => { if (header) record[header] = row.getCell(index + 1).value; });
    rows.push(record);
  });
  return { headers, rows };
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

/** 多行 INSERT 的占位符构造：values 按行给出，基础参数在前（$1..$n），新参数从 $n+1 开始。 */
function buildMultiInsert(baseParams, rowsOfValues, template) {
  const params = [...baseParams];
  const tuples = rowsOfValues.map((values) => {
    params.push(...values);
    const base = params.length - values.length + 1;
    return template(base);
  });
  return { params, tuples };
}

async function main() {
  const report = { task: "KN-MPS-INIT-001", goal: "事业四部完整主计划快照初始化", mode: execute ? "execute" : "dry-run", generatedAt: new Date().toISOString(), tenantId, file, blockers: [], warnings: [], validation: {}, expected: {}, actual: null, ledger: null };
  const bytes = readFileSync(file);
  report.fileBytes = bytes.length;
  report.fileSha256 = createHash("sha256").update(bytes).digest("hex");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  report.officialReader = "ok";
  const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
  for (const required of REQUIRED_SHEETS) if (!sheetNames.includes(required)) report.blockers.push(`缺少必需工作表：${required}`);

  const weekly = sheetValues(workbook, "01_weekly_plans");
  const plans = sheetValues(workbook, "02_weekly_process_plans");
  const reports = sheetValues(workbook, "03_process_reports");
  const trace = sheetValues(workbook, "05_source_trace");
  const unmapped = sheetValues(workbook, "04_unmapped_review");

  const weeklyRows = weekly.rows.map((row) => ({
    orderNumber: text(row.orderNumber), itemCode: text(row.itemCode), itemName: text(row.itemName),
    customerCode: text(row.customerCode) || null, deliveryNumber: numberOrNull(row.deliveryNumber),
    orderDate: dateOnly(row.orderDate), latestCustomerDueDate: dateOnly(row.latestCustomerDueDate),
    plannedQuantity: numberOrNull(row.plannedQuantity),
    allocatedInboundQuantity: numberOrNull(row.allocatedInboundQuantity) ?? 0,
    latestReviewDueDate: dateOnly(row.latestReviewDueDate),
    manufacturingMethod: text(row.manufacturingMethod) || null,
    orderExceptionInfo: text(row.orderExceptionInfo) || null,
    inspectionQuantity: numberOrNull(row.inspectionQuantity), remark: text(row.remark) || null
  }));
  const weeklyKey3 = weeklyRows.map((row) => key3(row.orderNumber, row.itemCode, row.deliveryNumber));
  const duplicateKeys = [...new Set(weeklyKey3.filter((key, index) => weeklyKey3.indexOf(key) !== index))];
  const invalidWeekly = weeklyRows.filter((row) => !row.orderNumber || !row.itemCode || !row.itemName || !Number.isFinite(row.plannedQuantity) || row.deliveryNumber !== 1);
  if (duplicateKeys.length) report.blockers.push(`01 存在重复业务键 ${duplicateKeys.length} 组`);
  if (invalidWeekly.length) report.blockers.push(`01 存在不符合纳入条件的行 ${invalidWeekly.length}`);

  const planRows = plans.rows.map((row) => ({
    key: key3(row.orderNumber, row.itemCode, row.deliveryNumber),
    processCode: text(row.processCode), processName: text(row.processName), sequence: numberOrNull(row.sequence),
    cycleDays: numberOrNull(row.cycleDays), dueDate: dateOnly(row.dueDate)
  }));
  const codesByKey = new Map();
  for (const plan of planRows) { if (!codesByKey.has(plan.key)) codesByKey.set(plan.key, new Set()); codesByKey.get(plan.key).add(plan.processCode); }
  const planInvalidCodes = [...new Set(planRows.map((plan) => plan.processCode))].filter((code) => !CANONICAL_PROCESSES.some(([canonical]) => canonical === code));
  const planOrphans = planRows.filter((plan) => !weeklyKey3.includes(plan.key));
  const wrongProcessCount = weeklyKey3.filter((key) => (codesByKey.get(key)?.size ?? 0) !== CANONICAL_PROCESSES.length);
  if (planInvalidCodes.length) report.blockers.push(`02 出现非标准工序编码：${planInvalidCodes.join("、")}`);
  if (planOrphans.length) report.blockers.push(`02 存在无法匹配 01 的行：${planOrphans.length}`);
  if (wrongProcessCount.length) report.blockers.push(`存在不是 10 个标准工序的周计划：${wrongProcessCount.length}`);

  const reportRows = reports.rows.map((row) => ({
    key: key3(row.orderNumber, row.itemCode, row.deliveryNumber),
    processCode: text(row.processCode), processName: text(row.processName),
    productionDate: dateOnly(row.productionDate), productionQuantity: numberOrNull(row.productionQuantity),
    exceptionText: text(row.exceptionText) || null
  }));
  const reportInvalidCodes = [...new Set(reportRows.map((row) => row.processCode))].filter((code) => !CANONICAL_PROCESSES.some(([canonical]) => canonical === code));
  const reportOrphans = reportRows.filter((row) => !weeklyKey3.includes(row.key));
  const badReportQuantity = reportRows.filter((row) => !Number.isFinite(row.productionQuantity) || row.productionQuantity < 0);
  const badProductionDate = reportRows.filter((row) => row.productionDate !== PRODUCTION_DATE);
  const nonEmptyException = reportRows.filter((row) => row.exceptionText);
  if (reportInvalidCodes.length) report.blockers.push(`03 出现非标准工序编码：${reportInvalidCodes.join("、")}`);
  if (reportOrphans.length) report.blockers.push(`03 存在无法匹配 01 的报工：${reportOrphans.length}`);
  if (badReportQuantity.length) report.blockers.push(`03 存在非法报工数量：${badReportQuantity.length}`);
  if (badProductionDate.length) report.blockers.push(`03 存在非 ${PRODUCTION_DATE} 的 productionDate：${badProductionDate.length}`);
  if (nonEmptyException.length) report.blockers.push(`03 存在非空异常文本：${nonEmptyException.length}`);

  /* 集团计划按订单号聚合（数量由文件实际计算，不写死） */
  const groupAggregates = new Map();
  for (const row of weeklyRows) {
    const bucket = groupAggregates.get(row.orderNumber) ?? { orderNumber: row.orderNumber, required: 0, completed: 0, pending: 0, customers: new Set(), orderDates: [] };
    const required = Number(row.plannedQuantity);
    const inbound = Number(row.allocatedInboundQuantity ?? 0);
    bucket.required += required;
    bucket.completed += inbound;
    bucket.pending += Math.max(required - inbound, 0);
    if (row.customerCode) bucket.customers.add(row.customerCode);
    if (row.orderDate) bucket.orderDates.push(row.orderDate);
    groupAggregates.set(row.orderNumber, bucket);
  }
  const groupRows = [...groupAggregates.values()].map((bucket) => ({
    orderNumber: bucket.orderNumber, requiredQuantity: round4(bucket.required), completedQuantity: round4(bucket.completed), pendingQuantity: round4(bucket.pending),
    customerCode: bucket.customers.size === 1 ? [...bucket.customers][0] : null,
    orderDate: bucket.orderDates.length ? bucket.orderDates.sort()[0] : null
  }));

  report.validation = {
    weekly: { rows: weeklyRows.length, duplicateBusinessKeys: duplicateKeys.length, invalidRows: invalidWeekly.length, latestReviewDueDateNullRows: weeklyRows.filter((row) => row.latestReviewDueDate == null).length, distinctOrders: groupAggregates.size },
    processPlans: { rows: planRows.length, orphans: planOrphans.length, invalidCodes: planInvalidCodes, weeklyNotTenProcesses: wrongProcessCount.length, dueDateNotNull: planRows.filter((plan) => plan.dueDate != null).length },
    processReports: { rows: reportRows.length, orphans: reportOrphans.length, invalidCodes: reportInvalidCodes, badQuantity: badReportQuantity.length, badProductionDate: badProductionDate.length, nonEmptyException: nonEmptyException.length },
    groupPlans: { rows: groupRows.length },
    sourceTrace: { rows: trace.rows.length, unmappedReviewRows: unmapped.rows.length }
  };
  report.expected = {
    erpOrderLines: weeklyRows.length, orderAllocations: weeklyRows.length, groupPlans: groupRows.length, monthlyPlans: weeklyRows.length,
    basePlans: weeklyRows.length, weeklyPlans: weeklyRows.length, weeklyProcessPlans: planRows.length, processReports: reportRows.length,
    processCycles: 0, shippingPlans: 0, technicalReports: 0, materialReports: 0, outsourcingReports: 0
  };

  const client = new Client({
    host: process.env.DATABASE_HOST ?? "postgres", port: Number(process.env.DATABASE_PORT ?? 5432),
    user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME
  });
  await client.connect();
  try {
    const counts = {};
    for (const table of TABLES) {
      const { rows } = await client.query(`SELECT count(*)::integer AS rows FROM ${table} WHERE tenant_id=$1`, [tenantId]);
      counts[table] = rows[0].rows;
    }
    const { rows: divisions } = await client.query("SELECT id, name FROM organization_units WHERE btrim(name)=$1 AND enabled ORDER BY id", [DIVISION_NAME]);
    const { rows: syncs } = await client.query("SELECT sync_key, enabled FROM mps_sync_configs WHERE tenant_id=$1 ORDER BY sync_key", [tenantId]);
    const { rows: ledger } = await client.query("SELECT value_json FROM mps_system_settings WHERE setting_key='KN-MPS-INIT-001'");
    const { rows: nullable } = await client.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='mps_weekly_plans' AND column_name IN ('latest_review_due_date','base_plan_id','inspection_required')`);
    const { rows: systemUser } = await client.query("SELECT id FROM users WHERE id=$1", [SYSTEM_USER_ID]);
    report.db = { counts, divisions, syncs, ledger, nullable, systemUser };

    const nonEmpty = Object.entries(counts).filter(([, rows]) => rows > 0);
    if (nonEmpty.length) report.blockers.push(`目标表在 ${tenantId} 下并非空：${nonEmpty.map(([table, rows]) => `${table}=${rows}`).join("、")}`);
    if (divisions.length !== 1) report.blockers.push(`“${DIVISION_NAME}”组织唯一解析失败：匹配 ${divisions.length} 条`);
    const wronglyEnabled = syncs.filter((row) => row.enabled && row.sync_key !== "execution-rollup");
    if (wronglyEnabled.length) report.blockers.push(`快照模式要求以下同步 disabled：${wronglyEnabled.map((row) => row.sync_key).join("、")}`);
    if (!syncs.some((row) => row.sync_key === "execution-rollup" && row.enabled)) report.blockers.push("execution-rollup 应为 enabled（快照模式下唯一允许运行的同步）");
    if (!systemUser.length) report.blockers.push(`系统身份不存在：${SYSTEM_USER_ID}`);
    if (!nullable.some((row) => row.column_name === "latest_review_due_date" && row.is_nullable === "YES")) report.blockers.push("mps_weekly_plans.latest_review_due_date 仍为 NOT NULL（migration 未生效）");
    if (nullable.some((row) => row.column_name === "base_plan_id" && row.is_nullable === "YES")) report.blockers.push("base_plan_id 不应为 NULLABLE（本次方案要求保持 NOT NULL + FK + UNIQUE）");
    /* 幂等：只有“同一目标（完整快照）+ 同一文件 SHA256”才拒绝重复执行；
       上一轮遗留的“周计划历史初始化”账本（同一文件、旧目标）在本轮按用户最终目标重构快照时允许被取代，
       并在成功后由本工具覆盖为完整快照账本。 */
    const sameFileLedgers = ledger.filter((row) => row.value_json && row.value_json.tenant === tenantId && row.value_json.fileSha256 === report.fileSha256);
    const sameGoalLedger = sameFileLedgers.find((row) => row.value_json.goal === report.goal);
    if (sameGoalLedger) report.blockers.push(`相同 tenant + 文件 SHA256 + 相同目标（${report.goal}）已成功初始化过，拒绝重复执行`);
    else if (sameFileLedgers.length) report.warnings.push(`存在同一文件的旧初始化账本（目标：${sameFileLedgers.map((row) => row.value_json.goal ?? "周计划历史初始化").join("、")}；执行时间 ${sameFileLedgers.map((row) => row.value_json.executedAt ?? "-").join("、")}），本轮按最终目标“${report.goal}”重构完整快照，成功后覆盖该账本。`);

    if (!execute) {
      report.ledger = "dry-run：未写入数据库";
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      printSummary(report, reportPath);
      if (report.blockers.length) { console.error("dry-run 存在 blocker，禁止执行正式写入。"); process.exit(2); }
      return;
    }
    if (report.blockers.length) { writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`); printSummary(report, reportPath); console.error("blocker>0，拒绝执行。"); process.exit(2); }

    const divisionId = divisions[0].id;
    const inserted = { erpOrderLines: 0, orderAllocations: 0, groupPlans: 0, monthlyPlans: 0, basePlans: 0, weeklyPlans: 0, processPlans: 0, processReports: 0 };
    const runSql = async (label, sql, params) => {
      try { return await client.query(sql, params); }
      catch (error) { throw new Error(`${label} 失败：${error instanceof Error ? error.message : String(error)} | params=${params.length} | sql=${String(sql).replace(/\s+/g, " ").slice(0, 240)}`); }
    };
    await client.query("BEGIN");
    try {
      /* 1) ERP 订单明细：同一份快照的 1169 个业务品项，来源元数据标记本次历史初始化 */
      for (const batch of chunk(weeklyRows, 200)) {
        const { params, tuples } = buildMultiInsert([tenantId, SOURCE_SYSTEM, SOURCE_DATABASE, SYSTEM_USER_ID, SYSTEM_USER_ID], batch.map((row) => [
          SOURCE_ACCOUNT_NAME, `${row.orderNumber}|${row.itemCode}|${row.deliveryNumber}`, row.customerCode, row.orderNumber, row.itemCode, row.itemName, row.orderDate, row.latestCustomerDueDate, row.plannedQuantity
        /* 列顺序：tenant,source_system,source_database,source_account_name,source_key,customer_code,order_number,item_code,item_name,order_date,expected_shipping_date,order_quantity,source_active,created_by,updated_by（15 列） */
        ]), (base) => `($1,$2,$3,$${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},true,$4,$5)`);
        const { rows } = await runSql("insert-erp-order-lines", `
          INSERT INTO mps_erp_order_lines(tenant_id,source_system,source_database,source_account_name,source_key,customer_code,order_number,item_code,item_name,order_date,expected_shipping_date,order_quantity,source_active,created_by,updated_by)
          VALUES ${tuples.join(",")} RETURNING id`, params);
        inserted.erpOrderLines += rows.length;
      }

      /* 2) 订单分配（同一集合；division_id=事业四部；order/allocated=planned；expected_shipping=装柜交期） */
      for (const batch of chunk(weeklyRows, 200)) {
        const { params, tuples } = buildMultiInsert([tenantId, divisionId, SYSTEM_USER_ID, SYSTEM_USER_ID], batch.map((row) => [
          row.orderNumber, row.itemCode, row.itemName, row.customerCode, row.orderDate, row.latestCustomerDueDate, row.plannedQuantity, row.plannedQuantity
        ]), (base) => `($1,$${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$2,$3,$4)`);
        const { rows } = await runSql("insert-order-allocations", `
          INSERT INTO mps_order_allocations(tenant_id,order_number,item_code,item_name,customer_code,order_date,expected_shipping_date,order_quantity,allocated_quantity,division_id,created_by,updated_by)
          VALUES ${tuples.join(",")} RETURNING id`, params);
        inserted.orderAllocations += rows.length;
      }

      /* 3) 月计划（required=planned；累计入库取 01 allocatedInboundQuantity；欠数=max(required-inbound,0)；完成率按正式口径并受 CHECK<=1 约束） */
      for (const batch of chunk(weeklyRows, 200)) {
        const { params, tuples } = buildMultiInsert([tenantId, divisionId, SYSTEM_USER_ID, SYSTEM_USER_ID], batch.map((row) => {
          const required = Number(row.plannedQuantity);
          const inbound = Number(row.allocatedInboundQuantity ?? 0);
          const pending = Math.max(required - inbound, 0);
          const rate = required > 0 ? Math.min(inbound / required, 1) : 0;
          return [row.orderNumber, row.itemCode, row.customerCode, row.itemName, row.orderDate, row.latestCustomerDueDate, required, inbound, pending, round4(rate), row.orderExceptionInfo, row.inspectionQuantity, row.remark];
        /* 列顺序：tenant,order_number,item_code,division_id,customer_code,item_name,order_date,latest_customer_due_date,required_quantity,cumulative_inbound_quantity,pending_quantity,completion_rate,order_exception_info,inspection_required,inspection_quantity,remark,created_by,updated_by（18 列） */
        }), (base) => `($1,$${base},$${base + 1},$2,$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},false,$${base + 11},$${base + 12},$3,$4)`);
        const { rows } = await runSql("insert-monthly-plans", `
          INSERT INTO mps_monthly_plans(tenant_id,order_number,item_code,division_id,customer_code,item_name,order_date,latest_customer_due_date,required_quantity,cumulative_inbound_quantity,pending_quantity,completion_rate,order_exception_info,inspection_required,inspection_quantity,remark,created_by,updated_by)
          VALUES ${tuples.join(",")} RETURNING id`, params);
        inserted.monthlyPlans += rows.length;
      }

      /* 4) 集团主计划（按 orderNumber 聚合，数量由文件计算；金额等无可靠来源保持默认/NULL） */
      for (const batch of chunk(groupRows, 200)) {
        const { params, tuples } = buildMultiInsert([tenantId, divisionId, SYSTEM_USER_ID, SYSTEM_USER_ID], batch.map((row) => [
          row.orderNumber, row.customerCode, row.orderDate, row.requiredQuantity, row.completedQuantity, row.pendingQuantity,
          row.requiredQuantity > 0 ? round4(Math.min(row.completedQuantity / row.requiredQuantity, 1)) : 0
        ]), (base) => `($1,$${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$2,$3,$4)`);
        const { rows } = await runSql("insert-group-plans", `
          INSERT INTO mps_group_plans(tenant_id,order_number,customer_code,order_date,required_quantity,completed_quantity,pending_quantity,completion_rate,primary_division_id,created_by,updated_by)
          VALUES ${tuples.join(",")} RETURNING id`, params);
        inserted.groupPlans += rows.length;
      }

      /* 5) 基础计划（与 01 同源；未知字段 NULL；shipping_plan_id 保持 NULL） */
      const baseIdByKey = new Map();
      for (const batch of chunk(weeklyRows, 200)) {
        const { params, tuples } = buildMultiInsert([tenantId, divisionId, SYSTEM_USER_ID, SYSTEM_USER_ID], batch.map((row) => [
          row.customerCode, row.orderNumber, row.itemCode, row.itemName, row.deliveryNumber, row.orderDate, row.latestCustomerDueDate, row.plannedQuantity
        ]), (base) => `($1,$2,$${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$3,$4)`);
        const { rows } = await runSql("insert-base-plans", `
          INSERT INTO mps_base_plans(tenant_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,planned_quantity,created_by,updated_by)
          VALUES ${tuples.join(",")} RETURNING id, order_number, item_code, delivery_number`, params);
        for (const row of rows) baseIdByKey.set(key3(row.order_number, row.item_code, row.delivery_number), row.id);
        inserted.basePlans += rows.length;
      }

      /* 6) 周计划（base_plan_id 一对一；latest_review_due_date=NULL；inspection_required=false） */
      const weeklyIdByKey = new Map();
      for (const batch of chunk(weeklyRows, 200)) {
        const { params, tuples } = buildMultiInsert([tenantId, divisionId, SYSTEM_USER_ID, SYSTEM_USER_ID, false], batch.map((row) => {
          const required = Number(row.plannedQuantity);
          const inbound = Number(row.allocatedInboundQuantity ?? 0);
          return [baseIdByKey.get(key3(row.orderNumber, row.itemCode, row.deliveryNumber)), row.customerCode, row.orderNumber, row.itemCode, row.itemName, row.deliveryNumber, row.orderDate, row.latestCustomerDueDate, row.latestReviewDueDate, required, inbound, Math.max(required - inbound, 0), row.manufacturingMethod, row.orderExceptionInfo, row.inspectionQuantity, row.remark];
        }), (base) => `($1,$${base},$2,$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$5,$${base + 14},$${base + 15},$3,$4)`);
        const { rows } = await runSql("insert-weekly-plans", `
          INSERT INTO mps_weekly_plans(tenant_id,base_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,latest_review_due_date,planned_quantity,allocated_inbound_quantity,pending_quantity,manufacturing_method,order_exception_info,inspection_required,inspection_quantity,remark,created_by,updated_by)
          VALUES ${tuples.join(",")} RETURNING id, order_number, item_code, delivery_number`, params);
        for (const row of rows) weeklyIdByKey.set(key3(row.order_number, row.item_code, row.delivery_number), row.id);
        inserted.weeklyPlans += rows.length;
      }

      /* 7) 周计划工序明细（每 weekly 恰好 10 个标准工序；历史初始化要求 execution_enabled=true；dueDate 仅来自文件日期） */
      for (const batch of chunk(planRows, 400)) {
        const { params, tuples } = buildMultiInsert([tenantId, SYSTEM_USER_ID, SYSTEM_USER_ID], batch.map((plan) => {
          const weeklyPlanId = weeklyIdByKey.get(plan.key);
          if (!weeklyPlanId) throw new Error(`工序计划无法解析 weeklyPlanId：${plan.key}`);
          return [weeklyPlanId, plan.processCode, plan.processName, plan.sequence, plan.cycleDays, plan.dueDate];
        }), (base) => `($1,$${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},true,$2,$3)`);
        const { rows } = await runSql("insert-weekly-process-plans", `
          INSERT INTO mps_weekly_process_plans(tenant_id,weekly_plan_id,process_code,process_name,sequence,cycle_days,due_date,execution_enabled,created_by,updated_by)
          VALUES ${tuples.join(",")} RETURNING id`, params);
        inserted.processPlans += rows.length;
      }

      /* 8) 工序报工（历史 OK 的报工事实；planned_quantity 取所属周计划；异常保持 NULL） */
      const weeklyByKey = new Map(weeklyRows.map((row) => [key3(row.orderNumber, row.itemCode, row.deliveryNumber), row]));
      for (const batch of chunk(reportRows, 200)) {
        const { params, tuples } = buildMultiInsert([tenantId, divisionId, SYSTEM_USER_ID, SYSTEM_USER_ID], batch.map((row) => {
          const weeklyPlanId = weeklyIdByKey.get(row.key);
          const weeklyRow = weeklyByKey.get(row.key);
          if (!weeklyPlanId || !weeklyRow) throw new Error(`报工无法解析 weeklyPlanId：${row.key}`);
          return [weeklyPlanId, weeklyRow.orderNumber, weeklyRow.itemCode, weeklyRow.itemName, weeklyRow.deliveryNumber, row.processCode, row.processName, row.productionDate, weeklyRow.plannedQuantity, row.productionQuantity];
        }), (base) => `($1,$${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},NULL,$2,$3,$4)`);
        const { rows } = await runSql("insert-process-reports", `
          INSERT INTO mps_process_reports(tenant_id,weekly_plan_id,order_number,item_code,item_name,delivery_number,process_code,process_name,production_date,planned_quantity,production_quantity,exception_text,division_id,created_by,updated_by)
          VALUES ${tuples.join(",")} RETURNING id`, params);
        inserted.processReports += rows.length;
      }

      /* 9) 事务内完整性 + 集合一致性校验 */
      const scalar = async (label, sql) => (await runSql(`check-${label}`, sql, [tenantId])).rows[0].value;
      const counts2 = {
        erpOrderLines: Number(await scalar("erp", "SELECT count(*)::integer AS value FROM mps_erp_order_lines WHERE tenant_id=$1")),
        orderAllocations: Number(await scalar("alloc", "SELECT count(*)::integer AS value FROM mps_order_allocations WHERE tenant_id=$1")),
        groupPlans: Number(await scalar("group", "SELECT count(*)::integer AS value FROM mps_group_plans WHERE tenant_id=$1")),
        monthlyPlans: Number(await scalar("monthly", "SELECT count(*)::integer AS value FROM mps_monthly_plans WHERE tenant_id=$1")),
        basePlans: Number(await scalar("base", "SELECT count(*)::integer AS value FROM mps_base_plans WHERE tenant_id=$1")),
        weeklyPlans: Number(await scalar("weekly", "SELECT count(*)::integer AS value FROM mps_weekly_plans WHERE tenant_id=$1")),
        weeklyProcessPlans: Number(await scalar("plans", "SELECT count(*)::integer AS value FROM mps_weekly_process_plans WHERE tenant_id=$1")),
        processReports: Number(await scalar("reports", "SELECT count(*)::integer AS value FROM mps_process_reports WHERE tenant_id=$1"))
      };
      const setDiff = async (sql) => Number(await scalar("setdiff", sql));
      const checks = {
        ...counts2,
        erpVsAllocationDiff: await setDiff(`SELECT (SELECT count(*) FROM (SELECT order_number,item_code FROM mps_erp_order_lines WHERE tenant_id=$1 EXCEPT SELECT order_number,item_code FROM mps_order_allocations WHERE tenant_id=$1) a) + (SELECT count(*) FROM (SELECT order_number,item_code FROM mps_order_allocations WHERE tenant_id=$1 EXCEPT SELECT order_number,item_code FROM mps_erp_order_lines WHERE tenant_id=$1) b) AS value`),
        erpVsMonthlyDiff: await setDiff(`SELECT (SELECT count(*) FROM (SELECT order_number,item_code FROM mps_erp_order_lines WHERE tenant_id=$1 EXCEPT SELECT order_number,item_code FROM mps_monthly_plans WHERE tenant_id=$1) a) + (SELECT count(*) FROM (SELECT order_number,item_code FROM mps_monthly_plans WHERE tenant_id=$1 EXCEPT SELECT order_number,item_code FROM mps_erp_order_lines WHERE tenant_id=$1) b) AS value`),
        monthlyVsWeeklyDiff: await setDiff(`SELECT (SELECT count(*) FROM (SELECT order_number,item_code FROM mps_monthly_plans WHERE tenant_id=$1 EXCEPT SELECT order_number,item_code FROM mps_weekly_plans WHERE tenant_id=$1) a) + (SELECT count(*) FROM (SELECT order_number,item_code FROM mps_weekly_plans WHERE tenant_id=$1 EXCEPT SELECT order_number,item_code FROM mps_monthly_plans WHERE tenant_id=$1) b) AS value`),
        baseVsWeeklyDiff: await setDiff(`SELECT (SELECT count(*) FROM (SELECT order_number,item_code,delivery_number FROM mps_base_plans WHERE tenant_id=$1 EXCEPT SELECT order_number,item_code,delivery_number FROM mps_weekly_plans WHERE tenant_id=$1) a) + (SELECT count(*) FROM (SELECT order_number,item_code,delivery_number FROM mps_weekly_plans WHERE tenant_id=$1 EXCEPT SELECT order_number,item_code,delivery_number FROM mps_base_plans WHERE tenant_id=$1) b) AS value`),
        quantityMismatch: await setDiff(`SELECT count(*) AS value FROM mps_erp_order_lines e JOIN mps_order_allocations a ON a.tenant_id=e.tenant_id AND a.order_number=e.order_number AND a.item_code=e.item_code JOIN mps_monthly_plans m ON m.tenant_id=e.tenant_id AND m.order_number=e.order_number AND m.item_code=e.item_code JOIN mps_base_plans b ON b.tenant_id=e.tenant_id AND b.order_number=e.order_number AND b.item_code=e.item_code JOIN mps_weekly_plans w ON w.tenant_id=e.tenant_id AND w.order_number=e.order_number AND w.item_code=e.item_code WHERE e.tenant_id=$1 AND (e.order_quantity<>a.allocated_quantity OR a.allocated_quantity<>m.required_quantity OR m.required_quantity<>b.planned_quantity OR b.planned_quantity<>w.planned_quantity)`),
        dueDateMismatch: await setDiff(`SELECT count(*) AS value FROM mps_monthly_plans m JOIN mps_weekly_plans w ON w.tenant_id=m.tenant_id AND w.order_number=m.order_number AND w.item_code=m.item_code WHERE m.tenant_id=$1 AND m.latest_customer_due_date IS DISTINCT FROM w.latest_customer_due_date`),
        groupOrderMismatch: await setDiff(`SELECT count(*) AS value FROM mps_group_plans g WHERE g.tenant_id=$1 AND (g.required_quantity <> (SELECT COALESCE(sum(m.required_quantity),0) FROM mps_monthly_plans m WHERE m.tenant_id=g.tenant_id AND m.order_number=g.order_number))`),
        groupExtraOrders: await setDiff(`SELECT count(*) AS value FROM (SELECT order_number FROM mps_group_plans WHERE tenant_id=$1 EXCEPT SELECT order_number FROM mps_monthly_plans WHERE tenant_id=$1) x`),
        groupMissingOrders: await setDiff(`SELECT count(*) AS value FROM (SELECT order_number FROM mps_monthly_plans WHERE tenant_id=$1 EXCEPT SELECT order_number FROM mps_group_plans WHERE tenant_id=$1) x`),
        orphanPlans: await setDiff(`SELECT count(*) AS value FROM mps_weekly_process_plans p LEFT JOIN mps_weekly_plans w ON w.id=p.weekly_plan_id WHERE p.tenant_id=$1 AND w.id IS NULL`),
        orphanReports: await setDiff(`SELECT count(*) AS value FROM mps_process_reports r LEFT JOIN mps_weekly_plans w ON w.id=r.weekly_plan_id WHERE r.tenant_id=$1 AND w.id IS NULL`),
        orphanWeeklies: await setDiff(`SELECT count(*) AS value FROM mps_weekly_plans w LEFT JOIN mps_base_plans b ON b.id=w.base_plan_id WHERE w.tenant_id=$1 AND b.id IS NULL`),
        notTenProcesses: await setDiff(`SELECT count(*) AS value FROM (SELECT weekly_plan_id FROM mps_weekly_process_plans WHERE tenant_id=$1 GROUP BY 1 HAVING count(*)<>10) x`),
        duplicateWeeklyProcess: await setDiff(`SELECT count(*) AS value FROM (SELECT weekly_plan_id,process_code FROM mps_weekly_process_plans WHERE tenant_id=$1 GROUP BY 1,2 HAVING count(*)>1) x`),
        reusableBase: await setDiff(`SELECT count(*) AS value FROM (SELECT base_plan_id FROM mps_weekly_plans WHERE tenant_id=$1 GROUP BY 1 HAVING count(*)>1) x`),
        plansDisabled: await setDiff(`SELECT count(*) AS value FROM mps_weekly_process_plans WHERE tenant_id=$1 AND execution_enabled=false`),
        plansWithDueDate: await setDiff(`SELECT count(*) AS value FROM mps_weekly_process_plans WHERE tenant_id=$1 AND due_date IS NOT NULL`),
        reportsWithException: await setDiff(`SELECT count(*) AS value FROM mps_process_reports WHERE tenant_id=$1 AND exception_text IS NOT NULL`),
        reportsNotOnInitDate: await setDiff(`SELECT count(*) AS value FROM mps_process_reports WHERE tenant_id=$1 AND production_date<>'2026-09-17'`),
        shippingPlans: await setDiff(`SELECT count(*) AS value FROM mps_shipping_plans WHERE tenant_id=$1`),
        processCycles: await setDiff(`SELECT count(*) AS value FROM mps_process_cycles WHERE tenant_id=$1`),
        technicalReports: await setDiff(`SELECT count(*) AS value FROM mps_technical_reports WHERE tenant_id=$1`),
        materialReports: await setDiff(`SELECT count(*) AS value FROM mps_material_reports WHERE tenant_id=$1`),
        outsourcingReports: await setDiff(`SELECT count(*) AS value FROM mps_outsourcing_reports WHERE tenant_id=$1`)
      };
      report.actual = { inserted, checks };
      const failures = [];
      for (const [name, expected] of Object.entries(report.expected)) if (checks[name] !== expected) failures.push(`${name}: expected ${expected}, got ${checks[name]}`);
      for (const name of ["erpVsAllocationDiff", "erpVsMonthlyDiff", "monthlyVsWeeklyDiff", "baseVsWeeklyDiff", "quantityMismatch", "dueDateMismatch", "groupOrderMismatch", "groupExtraOrders", "groupMissingOrders", "orphanPlans", "orphanReports", "orphanWeeklies", "notTenProcesses", "duplicateWeeklyProcess", "reusableBase", "plansDisabled", "reportsWithException", "reportsNotOnInitDate", "shippingPlans", "processCycles", "technicalReports", "materialReports", "outsourcingReports"]) {
        if (checks[name] !== 0) failures.push(`${name}=${checks[name]}`);
      }
      if (checks.plansWithDueDate !== report.validation.processPlans.dueDateNotNull) failures.push(`plansWithDueDate: expected ${report.validation.processPlans.dueDateNotNull}, got ${checks.plansWithDueDate}`);
      if (failures.length) throw new Error(`事务内完整性/集合一致性校验失败：${failures.join("；")}`);

      const ledgerValue = { tenant: tenantId, fileSha256: report.fileSha256, file: file.split("/").pop(), executedAt: new Date().toISOString(), goal: report.goal, counts: counts2, checks };
      const ledgerDescription = `KN-MPS-INIT-001 完整快照初始化（文件 ${report.fileSha256.slice(0, 12)}…）`;
      const ledgerUpdate = await runSql("update-ledger", `UPDATE mps_system_settings SET value_json=$3::jsonb,description=$4,updated_at=now(),updated_by=$5,version=version+1 WHERE tenant_id=$1 AND setting_key=$2`,
        [tenantId, "KN-MPS-INIT-001", JSON.stringify(ledgerValue), ledgerDescription, SYSTEM_USER_ID]);
      if (!ledgerUpdate.rowCount) {
        await runSql("insert-ledger", `INSERT INTO mps_system_settings(tenant_id,setting_key,name,value_json,description,created_by,updated_by)
          VALUES($1,$2,'事业四部完整快照初始化账本',$3::jsonb,$4,$5,$5)`,
          [tenantId, "KN-MPS-INIT-001", JSON.stringify(ledgerValue), ledgerDescription, SYSTEM_USER_ID]);
      }
      report.ledger = ledgerValue;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      report.rolledBack = true;
      report.error = error instanceof Error ? error.message : String(error);
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      console.error(`初始化失败并已 ROLLBACK：${report.error}`);
      process.exit(1);
    }
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    printSummary(report, reportPath);
  } finally {
    await client.end();
  }
}

function printSummary(report, reportPath) {
  console.log(`【KN-MPS-INIT-001 ${report.mode === "execute" ? "完整快照正式初始化" : "完整快照 Dry Run"}】`);
  console.log(`文件：${report.file}（${report.fileBytes} bytes，sha256=${report.fileSha256}）`);
  console.log(`官方读取器：${report.officialReader}`);
  console.log(`Excel：01=${report.validation.weekly.rows}，02=${report.validation.processPlans.rows}，03=${report.validation.processReports.rows}，集团订单数=${report.validation.groupPlans.rows}`);
  console.log(`预计/实际：${JSON.stringify(report.expected)}`);
  if (report.actual) console.log(`实际写入：${JSON.stringify(report.actual.inserted)}`);
  console.log(`latestReviewDueDate 为 NULL：${report.validation.weekly.latestReviewDueDateNullRows}；工序交期有值：${report.validation.processPlans.dueDateNotNull}`);
  console.log(`blockers=${report.blockers.length}`);
  for (const blocker of report.blockers) console.log(`  - ${blocker}`);
  if (report.actual) {
    const failed = Object.entries(report.actual.checks).filter(([name, value]) => name.endsWith("Diff") || name.startsWith("orphan") || name === "quantityMismatch" || name === "dueDateMismatch" ? value !== 0 : false);
    if (failed.length) console.log(`校验异常：${JSON.stringify(failed)}`);
  }
  console.log(`报告：${reportPath}`);
}

main().catch((error) => { console.error("initialize failed:", error); process.exit(1); });
