#!/usr/bin/env node
/*
 * KN-MPS-INIT-001 事业四部周计划一次性后台正式初始化（受控运维工具）
 *
 * 安全设计：
 * - **默认 dry-run**：不带 --execute 时只做读取、校验与报告，绝不写数据库。
 * - `--execute` 才写入，且必须满足：blocker=0、目标表为空、自动同步全部暂停、无相同 (tenant, 文件SHA256) 的幂等记录。
 * - 写入使用**单一事务**：base plans → 业务键映射 → weekly plans（base_plan_id 绑定）→ 业务键映射 → 工序计划 → 工序报工
 *   → 事务内完整性校验 → COMMIT；任何失败或校验不通过即 ROLLBACK。
 * - 不调用 base-to-weekly / ensureExecutionRows / execution-rollup；工序计划与报工完全来自初始化文件。
 * - 幂等：成功后在 mps_system_settings 写入 KN-MPS-INIT-001 记录（tenant + 文件SHA256 + 数量 + 执行时间）。
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
const REQUIRED_SHEETS = ["README_后台初始化", "01_weekly_plans", "02_weekly_process_plans", "03_process_reports", "04_unmapped_review", "05_source_trace"];
const CANONICAL_PROCESSES = [
  ["cutting", "下料", 1], ["machining", "机加", 2], ["bending", "折弯", 3], ["spotWelding", "点焊", 4],
  ["welding", "焊接", 5], ["woodworking", "木作", 6], ["grinding", "研磨", 7], ["blank", "毛坯", 8],
  ["surfaceTreatment", "表面处理", 9], ["packaging", "包装", 10]
];
const TABLES = ["mps_erp_order_lines", "mps_order_allocations", "mps_process_cycles", "mps_group_plans", "mps_monthly_plans", "mps_shipping_plans", "mps_base_plans", "mps_weekly_plans", "mps_weekly_process_plans", "mps_technical_reports", "mps_material_reports", "mps_outsourcing_reports", "mps_process_reports"];

const text = (value) => (value == null ? "" : String(value).trim());
const dateOnly = (value) => {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
};
const numberOrNull = (value) => {
  const raw = typeof value === "number" ? value : Number(text(value).replace(/,/g, ""));
  return text(value) === "" || !Number.isFinite(raw) ? null : raw;
};
const keyOf = (orderNumber, itemCode, deliveryNumber) => `${text(orderNumber)}\u0000${text(itemCode)}\u0000${text(deliveryNumber)}`;

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

async function main() {
  const report = { task: "KN-MPS-INIT-001", mode: execute ? "execute" : "dry-run", generatedAt: new Date().toISOString(), tenantId, file, blockers: [], validation: {}, expected: {}, actual: null, ledger: null };
  const bytes = readFileSync(file);
  report.fileBytes = bytes.length;
  report.fileSha256 = createHash("sha256").update(bytes).digest("hex");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes); /* 标准化文件必须能被官方读取器直接打开 */
  report.officialReader = "ok";
  const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
  for (const required of REQUIRED_SHEETS) if (!sheetNames.includes(required)) report.blockers.push(`缺少必需工作表：${required}`);

  const weekly = sheetValues(workbook, "01_weekly_plans");
  const plans = sheetValues(workbook, "02_weekly_process_plans");
  const reports = sheetValues(workbook, "03_process_reports");
  const trace = sheetValues(workbook, "05_source_trace");
  const unmapped = sheetValues(workbook, "04_unmapped_review");

  const weeklyRows = weekly.rows.map((row) => ({
    rowNumber: row.__rowNumber,
    orderNumber: text(row.orderNumber), itemCode: text(row.itemCode), itemName: text(row.itemName),
    customerCode: text(row.customerCode) || null, deliveryNumber: numberOrNull(row.deliveryNumber),
    orderDate: dateOnly(row.orderDate), latestCustomerDueDate: dateOnly(row.latestCustomerDueDate),
    plannedQuantity: numberOrNull(row.plannedQuantity),
    allocatedInboundQuantity: numberOrNull(row.allocatedInboundQuantity) ?? 0,
    latestReviewDueDate: dateOnly(row.latestReviewDueDate),
    manufacturingMethod: text(row.manufacturingMethod) || null,
    orderExceptionInfo: text(row.orderExceptionInfo) || null,
    inspectionQuantity: numberOrNull(row.inspectionQuantity), remark: text(row.remark) || null,
    sourceRows: text(row.sourceRows)
  }));
  const weeklyKeys = weeklyRows.map((row) => keyOf(row.orderNumber, row.itemCode, row.deliveryNumber));
  const duplicateKeys = [...new Set(weeklyKeys.filter((key, index) => weeklyKeys.indexOf(key) !== index))];
  const invalidWeekly = weeklyRows.filter((row) => !row.orderNumber || !row.itemCode || !row.itemName || !Number.isFinite(row.plannedQuantity) || row.deliveryNumber !== 1);
  if (duplicateKeys.length) report.blockers.push(`01 存在重复业务键 ${duplicateKeys.length} 组`);
  if (invalidWeekly.length) report.blockers.push(`01 存在不符合纳入条件的行 ${invalidWeekly.length}（订单号/品号/品名/计划数量/deliveryNumber）`);

  const planRows = plans.rows.map((row) => ({
    rowNumber: row.__rowNumber, key: keyOf(row.orderNumber, row.itemCode, row.deliveryNumber),
    processCode: text(row.processCode), processName: text(row.processName), sequence: numberOrNull(row.sequence),
    cycleDays: numberOrNull(row.cycleDays), dueDate: dateOnly(row.dueDate)
  }));
  const codesByKey = new Map();
  for (const plan of planRows) { if (!codesByKey.has(plan.key)) codesByKey.set(plan.key, new Set()); codesByKey.get(plan.key).add(plan.processCode); }
  const planInvalidCodes = [...new Set(planRows.map((plan) => plan.processCode))].filter((code) => !CANONICAL_PROCESSES.some(([canonical]) => canonical === code));
  const planOrphans = planRows.filter((plan) => !weeklyKeys.includes(plan.key));
  const wrongProcessCount = weeklyKeys.filter((key) => (codesByKey.get(key)?.size ?? 0) !== CANONICAL_PROCESSES.length);
  if (planInvalidCodes.length) report.blockers.push(`02 出现非标准工序编码：${planInvalidCodes.join("、")}`);
  if (planOrphans.length) report.blockers.push(`02 存在无法匹配 01 的行：${planOrphans.length}`);
  if (wrongProcessCount.length) report.blockers.push(`存在不是 10 个标准工序的周计划：${wrongProcessCount.length}`);

  const reportRows = reports.rows.map((row) => ({
    rowNumber: row.__rowNumber, key: keyOf(row.orderNumber, row.itemCode, row.deliveryNumber),
    processCode: text(row.processCode), processName: text(row.processName),
    productionDate: dateOnly(row.productionDate), productionQuantity: numberOrNull(row.productionQuantity),
    exceptionText: text(row.exceptionText) || null
  }));
  const reportInvalidCodes = [...new Set(reportRows.map((row) => row.processCode))].filter((code) => !CANONICAL_PROCESSES.some(([canonical]) => canonical === code));
  const reportOrphans = reportRows.filter((row) => !weeklyKeys.includes(row.key));
  const badReportQuantity = reportRows.filter((row) => !Number.isFinite(row.productionQuantity) || row.productionQuantity < 0);
  const badProductionDate = reportRows.filter((row) => row.productionDate !== PRODUCTION_DATE);
  const nonEmptyException = reportRows.filter((row) => row.exceptionText);
  if (reportInvalidCodes.length) report.blockers.push(`03 出现非标准工序编码：${reportInvalidCodes.join("、")}`);
  if (reportOrphans.length) report.blockers.push(`03 存在无法匹配 01 的报工：${reportOrphans.length}`);
  if (badReportQuantity.length) report.blockers.push(`03 存在非法报工数量：${badReportQuantity.length}`);
  if (badProductionDate.length) report.blockers.push(`03 存在非 ${PRODUCTION_DATE} 的 productionDate：${badProductionDate.length}`);
  if (nonEmptyException.length) report.blockers.push(`03 存在非空异常文本：${nonEmptyException.length}`);

  report.validation = {
    sheets: report.expected.sheetNames ?? sheetNames,
    weekly: { rows: weeklyRows.length, duplicateBusinessKeys: duplicateKeys.length, invalidRows: invalidWeekly.length, latestReviewDueDateNullRows: weeklyRows.filter((row) => row.latestReviewDueDate == null).length },
    processPlans: { rows: planRows.length, orphans: planOrphans.length, invalidCodes: planInvalidCodes, weeklyNotTenProcesses: wrongProcessCount.length, dueDateNullRows: planRows.filter((plan) => plan.dueDate == null).length },
    processReports: { rows: reportRows.length, orphans: reportOrphans.length, invalidCodes: reportInvalidCodes, badQuantity: badReportQuantity.length, badProductionDate: badProductionDate.length, nonEmptyException: nonEmptyException.length },
    sourceTrace: { rows: trace.rows.length, unmappedReviewRows: unmapped.rows.length },
    mergedBusinessKeys: [...new Set(weeklyKeys)].length !== weeklyRows.length ? weeklyRows.length - new Set(weeklyKeys).size : 0
  };
  report.expected = {
    basePlans: weeklyRows.length, weeklyPlans: weeklyRows.length, processPlans: planRows.length, processReports: reportRows.length,
    technicalReports: 0, materialReports: 0, outsourcingReports: 0
  };

  /* ---------- 只读数据库核对 ---------- */
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
    const { rows: divisions } = await client.query("SELECT id, name, enabled FROM organization_units WHERE btrim(name)=$1 AND enabled ORDER BY id", [DIVISION_NAME]);
    const { rows: syncs } = await client.query("SELECT sync_key, enabled FROM mps_sync_configs WHERE tenant_id=$1 ORDER BY sync_key", [tenantId]);
    const { rows: ledger } = await client.query("SELECT value_json FROM mps_system_settings WHERE setting_key='KN-MPS-INIT-001'");
    const { rows: nullable } = await client.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='mps_weekly_plans' AND column_name IN ('latest_review_due_date','base_plan_id','inspection_required')`);
    const { rows: systemUser } = await client.query("SELECT id FROM users WHERE id=$1", [SYSTEM_USER_ID]);
    report.db = { counts, divisions, syncs, ledger, nullable, systemUser };

    const nonEmpty = Object.entries(counts).filter(([, rows]) => rows > 0);
    if (nonEmpty.length) report.blockers.push(`目标表在 ${tenantId} 下并非空：${nonEmpty.map(([table, rows]) => `${table}=${rows}`).join("、")}`);
    if (divisions.length !== 1) report.blockers.push(`“${DIVISION_NAME}”组织唯一解析失败：匹配 ${divisions.length} 条`);
    if (syncs.some((row) => row.enabled)) report.blockers.push(`自动同步未全部暂停：${syncs.filter((row) => row.enabled).map((row) => row.sync_key).join("、")}`);
    if (!systemUser.length) report.blockers.push(`系统身份不存在：${SYSTEM_USER_ID}`);
    const nullableReview = nullable.some((row) => row.column_name === "latest_review_due_date" && row.is_nullable === "YES");
    if (!nullableReview) report.blockers.push("mps_weekly_plans.latest_review_due_date 仍为 NOT NULL（migration 未生效），历史 NULL 无法写入");
    if (nullable.some((row) => row.column_name === "base_plan_id" && row.is_nullable === "YES")) report.blockers.push("base_plan_id 不应为 NULLABLE（本次方案要求保持 NOT NULL + FK + UNIQUE）");
    const sameFile = ledger.find((row) => row.value_json && row.value_json.tenant === tenantId && row.value_json.fileSha256 === report.fileSha256);
    if (sameFile) report.blockers.push(`相同 tenant + 文件 SHA256 已成功初始化过（${sameFile.value_json.executedAt}），拒绝重复执行`);
    else if (ledger.length) report.warnings = [`已存在其它 KN-MPS-INIT-001 记录（${ledger.length} 条），本次文件 SHA256 不同`];

    if (!execute) {
      report.ledger = "dry-run：未写入数据库";
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      printSummary(report, reportPath);
      if (report.blockers.length) { console.error("dry-run 存在 blocker，禁止执行正式写入。"); process.exit(2); }
      return;
    }
    if (report.blockers.length) { writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`); printSummary(report, reportPath); console.error("blocker>0，拒绝执行。"); process.exit(2); }

    /* ---------- 单事务正式写入 ---------- */
    const divisionId = divisions[0].id;
    const inserted = { basePlans: 0, weeklyPlans: 0, processPlans: 0, processReports: 0 };
    /** 带上下文的执行包装：失败时能定位到具体语句与参数规模。 */
    const runSql = async (label, sql, params) => {
      try { return await client.query(sql, params); }
      catch (error) {
        const detail = `${label} 失败：${error instanceof Error ? error.message : String(error)} | params=${params.length} | sql=${String(sql).replace(/\s+/g, " ").slice(0, 220)}`;
        throw new Error(detail);
      }
    };
    await client.query("BEGIN");
    try {
      /* 1) 基础计划（与 01 同源值；未知字段保持 NULL；image_refs 使用数据库默认 '[]'） */
      const baseIdByKey = new Map();
      for (const batch of chunk(weeklyRows, 200)) {
        const params = [tenantId, divisionId, SYSTEM_USER_ID, SYSTEM_USER_ID];
        const tuples = batch.map((row) => {
          const values = [row.customerCode, row.orderNumber, row.itemCode, row.itemName, row.deliveryNumber, row.orderDate, row.latestCustomerDueDate, row.plannedQuantity];
          params.push(...values);
          /* 占位符是 1-based：第一个新参数的位置 = 当前长度 - 本行参数数 + 1 */
          const base = params.length - values.length + 1;
          return `($1,$2,$${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$3,$4)`;
        });
        const { rows } = await runSql("insert-base-plans", `
          INSERT INTO mps_base_plans(tenant_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,planned_quantity,created_by,updated_by)
          VALUES ${tuples.join(",")} RETURNING id, order_number, item_code, delivery_number`, params);
        for (const row of rows) baseIdByKey.set(keyOf(row.order_number, row.item_code, row.delivery_number), row.id);
        inserted.basePlans += rows.length;
      }

      /* 2) 周计划（base_plan_id 一对一绑定；latest_review_due_date 按用户决策保持 NULL；inspection_required 显式 false） */
      const weeklyIdByKey = new Map();
      for (const batch of chunk(weeklyRows, 200)) {
        const params = [tenantId, divisionId, SYSTEM_USER_ID, SYSTEM_USER_ID, false];
        const tuples = batch.map((row) => {
          const basePlanId = baseIdByKey.get(keyOf(row.orderNumber, row.itemCode, row.deliveryNumber));
          const pending = Math.max(Number(row.plannedQuantity) - Number(row.allocatedInboundQuantity ?? 0), 0);
          const values = [basePlanId, row.customerCode, row.orderNumber, row.itemCode, row.itemName, row.deliveryNumber, row.orderDate, row.latestCustomerDueDate, row.latestReviewDueDate, row.plannedQuantity, row.allocatedInboundQuantity, pending, row.manufacturingMethod, row.orderExceptionInfo, row.inspectionQuantity, row.remark];
          params.push(...values);
          /* 占位符是 1-based：第一个新参数的位置 = 当前长度 - 本行参数数 + 1 */
          const base = params.length - values.length + 1;
          /* 列顺序：tenant,base_plan_id,division,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,latest_review_due_date,planned_quantity,allocated_inbound_quantity,pending_quantity,manufacturing_method,order_exception_info,inspection_required,inspection_quantity,remark,created_by,updated_by */
          return `($1,$${base},$2,$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$5,$${base + 14},$${base + 15},$3,$4)`;
        });
        const { rows } = await runSql("insert-weekly-plans", `
          INSERT INTO mps_weekly_plans(tenant_id,base_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,latest_review_due_date,planned_quantity,allocated_inbound_quantity,pending_quantity,manufacturing_method,order_exception_info,inspection_required,inspection_quantity,remark,created_by,updated_by)
          VALUES ${tuples.join(",")} RETURNING id, order_number, item_code, delivery_number`, params);
        for (const row of rows) weeklyIdByKey.set(keyOf(row.order_number, row.item_code, row.delivery_number), row.id);
        inserted.weeklyPlans += rows.length;
      }

      /* 3) 周计划工序计划（每条 weekly 恰好 10 个标准工序；dueDate 仅来自文件日期，其余 NULL） */
      for (const batch of chunk(planRows, 400)) {
        const params = [tenantId, SYSTEM_USER_ID, SYSTEM_USER_ID];
        const tuples = batch.map((plan) => {
          const weeklyPlanId = weeklyIdByKey.get(plan.key);
          if (!weeklyPlanId) throw new Error(`工序计划无法解析 weeklyPlanId：${plan.key}`);
          const values = [weeklyPlanId, plan.processCode, plan.processName, plan.sequence, plan.cycleDays, plan.dueDate];
          params.push(...values);
          /* 占位符是 1-based：第一个新参数的位置 = 当前长度 - 本行参数数 + 1 */
          const base = params.length - values.length + 1;
          return `($1,$${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$2,$3)`;
        });
        const { rows } = await runSql("insert-weekly-process-plans", `
          INSERT INTO mps_weekly_process_plans(tenant_id,weekly_plan_id,process_code,process_name,sequence,cycle_days,due_date,created_by,updated_by)
          VALUES ${tuples.join(",")} RETURNING id`, params);
        inserted.processPlans += rows.length;
      }

      /* 4) 实际报工（历史 OK 的报工事实；planned_quantity 取所属周计划计划数量；异常保持 NULL） */
      const weeklyByKey = new Map(weeklyRows.map((row) => [keyOf(row.orderNumber, row.itemCode, row.deliveryNumber), row]));
      for (const batch of chunk(reportRows, 200)) {
        const params = [tenantId, divisionId, SYSTEM_USER_ID, SYSTEM_USER_ID];
        const tuples = batch.map((report0) => {
          const weeklyPlanId = weeklyIdByKey.get(report0.key);
          const weeklyRow = weeklyByKey.get(report0.key);
          if (!weeklyPlanId || !weeklyRow) throw new Error(`报工无法解析 weeklyPlanId：${report0.key}`);
          const values = [weeklyPlanId, weeklyRow.orderNumber, weeklyRow.itemCode, weeklyRow.itemName, weeklyRow.deliveryNumber, report0.processCode, report0.processName, report0.productionDate, weeklyRow.plannedQuantity, report0.productionQuantity];
          params.push(...values);
          /* 占位符是 1-based：第一个新参数的位置 = 当前长度 - 本行参数数 + 1 */
          const base = params.length - values.length + 1;
          /* 列顺序：tenant,weekly_plan_id,order_number,item_code,item_name,delivery_number,process_code,process_name,production_date,planned_quantity,production_quantity,exception_text(NULL),division_id,created_by,updated_by */
          return `($1,$${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},NULL,$2,$3,$4)`;
        });
        const { rows } = await runSql("insert-process-reports", `
          INSERT INTO mps_process_reports(tenant_id,weekly_plan_id,order_number,item_code,item_name,delivery_number,process_code,process_name,production_date,planned_quantity,production_quantity,exception_text,division_id,created_by,updated_by)
          VALUES ${tuples.join(",")} RETURNING id`, params);
        inserted.processReports += rows.length;
      }

      /* 5) 事务内完整性校验 */
      const [{ bases }] = (await client.query(`SELECT count(*)::integer AS bases FROM mps_base_plans WHERE tenant_id=$1`, [tenantId])).rows;
      const [{ weeklies }] = (await client.query(`SELECT count(*)::integer AS weeklies FROM mps_weekly_plans WHERE tenant_id=$1`, [tenantId])).rows;
      const [{ plansCount }] = (await client.query(`SELECT count(*)::integer AS "plansCount" FROM mps_weekly_process_plans WHERE tenant_id=$1`, [tenantId])).rows;
      const [{ reportsCount }] = (await client.query(`SELECT count(*)::integer AS "reportsCount" FROM mps_process_reports WHERE tenant_id=$1`, [tenantId])).rows;
      const [{ orphanPlans }] = (await client.query(`SELECT count(*)::integer AS "orphanPlans" FROM mps_weekly_process_plans p LEFT JOIN mps_weekly_plans w ON w.id=p.weekly_plan_id AND w.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND w.id IS NULL`, [tenantId])).rows;
      const [{ orphanReports }] = (await client.query(`SELECT count(*)::integer AS "orphanReports" FROM mps_process_reports r LEFT JOIN mps_weekly_plans w ON w.id=r.weekly_plan_id AND w.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND w.id IS NULL`, [tenantId])).rows;
      const [{ orphanWeeklies }] = (await client.query(`SELECT count(*)::integer AS "orphanWeeklies" FROM mps_weekly_plans w LEFT JOIN mps_base_plans b ON b.id=w.base_plan_id AND b.tenant_id=w.tenant_id WHERE w.tenant_id=$1 AND b.id IS NULL`, [tenantId])).rows;
      const [{ notTenProcesses }] = (await client.query(`SELECT count(*)::integer AS "notTenProcesses" FROM (SELECT weekly_plan_id FROM mps_weekly_process_plans WHERE tenant_id=$1 GROUP BY weekly_plan_id HAVING count(*)<>10) x`, [tenantId])).rows;
      const [{ duplicateProcess }] = (await client.query(`SELECT count(*)::integer AS "duplicateProcess" FROM (SELECT weekly_plan_id, process_code FROM mps_weekly_process_plans WHERE tenant_id=$1 GROUP BY 1,2 HAVING count(*)>1) x`, [tenantId])).rows;
      const [{ reusableBase }] = (await client.query(`SELECT count(*)::integer AS "reusableBase" FROM (SELECT base_plan_id FROM mps_weekly_plans WHERE tenant_id=$1 GROUP BY 1 HAVING count(*)>1) x`, [tenantId])).rows;
      const checks = { bases, weeklies, plansCount, reportsCount, orphanPlans, orphanReports, orphanWeeklies, notTenProcesses, duplicateProcess, reusableBase };
      report.actual = { ...inserted, checks };
      const expected = { bases: report.expected.basePlans, weeklies: report.expected.weeklyPlans, plansCount: report.expected.processPlans, reportsCount: report.expected.processReports };
      const failed = Object.entries(expected).filter(([name, value]) => checks[name] !== value).map(([name, value]) => `${name}: expected ${value}, got ${checks[name]}`);
      for (const field of ["orphanPlans", "orphanReports", "orphanWeeklies", "notTenProcesses", "duplicateProcess", "reusableBase"]) if (checks[field] !== 0) failed.push(`${field}=${checks[field]}`);
      if (failed.length) throw new Error(`事务内完整性校验失败：${failed.join("；")}`);

      /* 6) 幂等账本 */
      const ledgerValue = { tenant: tenantId, fileSha256: report.fileSha256, file: file.split("/").pop(), executedAt: new Date().toISOString(), counts: expected, checkConstraints: checks };
      /* 幂等账本：唯一约束是 (tenant_id, setting_key)，首次 INSERT，之后只更新（不新增记录）。 */
      const ledgerDescription = `KN-MPS-INIT-001 一次性历史初始化（文件 ${report.fileSha256.slice(0, 12)}…）`;
      const ledgerUpdate = await runSql("update-ledger", `UPDATE mps_system_settings SET value_json=$3::jsonb,description=$4,updated_at=now(),updated_by=$5,version=version+1 WHERE tenant_id=$1 AND setting_key=$2`,
        [tenantId, "KN-MPS-INIT-001", JSON.stringify(ledgerValue), ledgerDescription, SYSTEM_USER_ID]);
      if (!ledgerUpdate.rowCount) {
        await runSql("insert-ledger", `INSERT INTO mps_system_settings(tenant_id,setting_key,name,value_json,description,created_by,updated_by)
          VALUES($1,$2,'事业四部周计划初始化账本',$3::jsonb,$4,$5,$5)`,
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

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

function printSummary(report, reportPath) {
  console.log(`【KN-MPS-INIT-001 ${report.mode === "execute" ? "正式初始化" : "Dry Run（最终）"}】`);
  console.log(`文件：${report.file}（${report.fileBytes} bytes，sha256=${report.fileSha256}）`);
  console.log(`官方读取器：${report.officialReader}`);
  console.log(`Excel：01=${report.validation.weekly.rows}，02=${report.validation.processPlans.rows}，03=${report.validation.processReports.rows}`);
  console.log(`预计/实际：base=${report.expected.basePlans}/${report.actual ? report.actual.basePlans : "-"}，weekly=${report.expected.weeklyPlans}/${report.actual ? report.actual.weeklyPlans : "-"}，process plans=${report.expected.processPlans}/${report.actual ? report.actual.processPlans : "-"}，reports=${report.expected.processReports}/${report.actual ? report.actual.processReports : "-"}`);
  console.log(`latestReviewDueDate 为 NULL 的行：${report.validation.weekly.latestReviewDueDateNullRows}`);
  console.log(`blockers=${report.blockers.length}`);
  for (const blocker of report.blockers) console.log(`  - ${blocker}`);
  console.log(`报告：${reportPath}`);
}

main().catch((error) => { console.error("initialize failed:", error); process.exit(1); });
