#!/usr/bin/env node
/*
 * KN-MPS-INIT-001 只读审计 / dry-run 工具（一次性历史初始化用）
 *
 * 安全边界：
 * - **本工具没有任何写库路径**：只做 Excel 读取、格式/业务校验、只读数据库核对与报告输出。
 * - 原初始化文件只读使用，绝不修改/覆盖/移动/删除；若官方读取器无法解析，仅在内存中构建
 *   规范化分析副本（并记录所用规范化步骤），并把“官方读取失败”作为 blocker 报告。
 * - 正式写入必须在 blocker 全部消除并另行评审通过后执行；本工具不会替它放行。
 *
 * 用法（在 api 容器内运行，Node 24 与 exceljs 已就绪；CJS 解析可命中容器内的 jszip/exceljs/pg）：
 *   node scripts/one-off/kn-mps-init-001-audit.cjs --file /tmp/knm-init.xlsx --json outputs/KN-MPS-INIT-001-dry-run.json
 */
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { Client } = require("pg");
const JSZip = require("jszip");
const ExcelJS = require("exceljs");

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const file = argOf("--file", "/tmp/knm-init.xlsx");
const tenantId = argOf("--tenant", process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN");
const jsonOut = argOf("--json", "outputs/KN-MPS-INIT-001-dry-run.json");
const REQUIRED_SHEETS = ["README_后台初始化", "01_weekly_plans", "02_weekly_process_plans", "03_process_reports", "04_unmapped_review", "05_source_trace"];

/** 标准工序唯一来源（与 @tracker/shared standardProcesses 顺序一致）。 */
const canonicalProcesses = [
  ["cutting", "下料", 1], ["machining", "机加", 2], ["bending", "折弯", 3], ["spotWelding", "点焊", 4],
  ["welding", "焊接", 5], ["woodworking", "木作", 6], ["grinding", "研磨", 7], ["blank", "毛坯", 8],
  ["surfaceTreatment", "表面处理", 9], ["packaging", "包装", 10]
];

const text = (value) => (value == null ? "" : String(value).trim());
const isNumeric = (value) => text(value) !== "" && Number.isFinite(Number(text(value).replace(/,/g, "")));
const businessKey = (orderNumber, itemCode, deliveryNumber) => `${text(orderNumber)}\u0000${text(itemCode)}\u0000${text(deliveryNumber)}`;
const hasKey = (headers, key) => headers.includes(key);

async function readWithOfficialReader(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

/**
 * 分析用规范化副本（仅内存）：源文件由生成器写成 `x:` 前缀命名空间，且 Excel 表格关系使用绝对 Target，
 * 官方读取器无法直接解析。这里只做等价规范化（主命名空间前缀还原为默认命名空间、移除 Excel 表格对象），
 * 单元格数据完全不动。
 */
async function normalizeForAnalysis(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const steps = [];
  for (const name of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const content = await zip.file(name).async("string");
    if (content.includes("<x:") || content.includes('xmlns:x="')) {
      zip.file(name, content
        .replaceAll('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
        .replaceAll("<x:", "<").replaceAll("</x:", "</"));
      steps.push(`namespace-normalized:${name}`);
    }
  }
  for (const name of Object.keys(zip.files)) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) {
      const content = await zip.file(name).async("string");
      const stripped = content.replace(/<tableParts[\s\S]*?<\/tableParts>/g, "");
      if (stripped !== content) { zip.file(name, stripped); steps.push(`tableParts-removed:${name}`); }
    }
    if (/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/i.test(name)) {
      zip.file(name, '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
      steps.push(`table-rels-emptied:${name}`);
    }
    if (/^xl\/tables\/table\d+\.xml$/i.test(name)) { zip.remove(name); steps.push(`table-removed:${name}`); }
  }
  return { buffer: await zip.generateAsync({ type: "nodebuffer" }), steps: [...new Set(steps)] };
}

function sheetRows(worksheet) {
  const headers = [];
  worksheet.getRow(1).eachCell((cell) => { headers.push(String(cell.text).trim()); });
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = { __rowNumber: rowNumber };
    headers.forEach((header, index) => {
      if (!header) return;
      const cell = row.getCell(index + 1);
      record[header] = cell.text ? String(cell.text).trim() : "";
    });
    rows.push(record);
  });
  return { headers, rows };
}

async function readOnlyDbChecks() {
  const client = new Client({
    host: process.env.DATABASE_HOST ?? "postgres", port: Number(process.env.DATABASE_PORT ?? 5432),
    user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME
  });
  await client.connect();
  try {
    const tables = ["mps_erp_order_lines", "mps_order_allocations", "mps_process_cycles", "mps_group_plans", "mps_monthly_plans", "mps_shipping_plans", "mps_base_plans", "mps_weekly_plans", "mps_weekly_process_plans", "mps_technical_reports", "mps_material_reports", "mps_outsourcing_reports", "mps_process_reports"];
    const counts = {};
    for (const table of tables) {
      const { rows } = await client.query(`SELECT count(*)::integer AS rows FROM ${table} WHERE tenant_id=$1`, [tenantId]);
      counts[table] = rows[0].rows;
    }
    const { rows: division } = await client.query("SELECT id, name, enabled FROM organization_units WHERE btrim(name)='事业四部' ORDER BY enabled DESC");
    const { rows: nullability } = await client.query(`SELECT table_name, column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('mps_weekly_plans','mps_weekly_process_plans','mps_process_reports') ORDER BY table_name, column_name`);
    const { rows: syncConfigs } = await client.query("SELECT sync_key, enabled FROM mps_sync_configs WHERE tenant_id=$1 ORDER BY sync_key", [tenantId]);
    const { rows: systemUser } = await client.query("SELECT id, username, display_name FROM users WHERE id='0199e000-0000-7000-8000-000000000001'");
    const { rows: initLedger } = await client.query("SELECT setting_key, value_json FROM mps_system_settings WHERE setting_key='KN-MPS-INIT-001'");
    return { counts, division, nullability, syncConfigs, systemUser, initLedger };
  } finally {
    await client.end();
  }
}

async function main() {
  const report = {
    task: "KN-MPS-INIT-001", mode: "read-only-dry-run", generatedAt: new Date().toISOString(),
    tenantId, file, blockers: [], warnings: [], excel: {}, validation: {}, exclusions: {}, db: {}
  };
  const buffer = readFileSync(file);
  report.fileBytes = buffer.length;
  report.fileSha256 = createHash("sha256").update(buffer).digest("hex");

  let workbook;
  try {
    workbook = await readWithOfficialReader(buffer);
    report.excel.officialReader = "ok";
  } catch (error) {
    report.excel.officialReader = "failed";
    report.excel.officialReaderError = error instanceof Error ? error.message : String(error);
    const normalized = await normalizeForAnalysis(buffer);
    report.excel.analysisCopy = { used: true, sha256: createHash("sha256").update(normalized.buffer).digest("hex"), steps: normalized.steps };
    workbook = await readWithOfficialReader(normalized.buffer);
    report.blockers.push("初始化文件无法被平台官方读取器（exceljs）直接解析：主命名空间写成 `x:` 前缀且 Excel 表格关系使用绝对 Target；分析只能用规范化副本，正式导入前必须由生成器重新产出标准 xlsx。");
  }
  report.excel.sheets = workbook.worksheets.map((worksheet) => worksheet.name);
  const missing = REQUIRED_SHEETS.filter((name) => !report.excel.sheets.includes(name));
  if (missing.length) report.blockers.push(`缺少必需工作表：${missing.join("、")}`);

  const sheet = (name) => {
    const worksheet = workbook.worksheets.find((candidate) => candidate.name === name);
    if (!worksheet) throw new Error(`缺少工作表 ${name}`);
    return sheetRows(worksheet);
  };
  const weekly = sheet("01_weekly_plans");
  const plans = sheet("02_weekly_process_plans");
  const reports = sheet("03_process_reports");
  const unmapped = sheet("04_unmapped_review");
  const trace = sheet("05_source_trace");
  report.excel.counts = {
    weeklyPlans: weekly.rows.length, processPlans: plans.rows.length, processReports: reports.rows.length,
    unmappedReview: unmapped.rows.length, sourceTrace: trace.rows.length
  };

  const keys = weekly.rows.map((row) => businessKey(row.orderNumber, row.itemCode, row.deliveryNumber));
  const duplicateKeys = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  const reviewDatesMissing = weekly.rows.filter((row) => !text(row.latestReviewDueDate)).length;
  const deliveries = [...new Set(weekly.rows.map((row) => text(row.deliveryNumber)))];
  report.validation.weekly = {
    rows: weekly.rows.length,
    duplicateBusinessKeys: duplicateKeys.length,
    missingRequiredRows: weekly.rows.filter((row) => !text(row.orderNumber) || !text(row.itemCode) || !text(row.itemName) || !isNumeric(row.plannedQuantity)).length,
    latestReviewDueDateMissingRows: reviewDatesMissing,
    distinctDivisionValues: [...new Set(weekly.rows.map((row) => text(row.divisionId)))],
    distinctDeliveryNumbers: deliveries,
    excelHasWeeklyPlanIdColumn: hasKey(plans.headers, "weeklyPlanId"),
    excelWeeklyPlanIdAllEmpty: plans.rows.every((row) => !text(row.weeklyPlanId)),
    hasLatestReviewDueDateColumn: hasKey(weekly.headers, "latestReviewDueDate")
  };
  if (duplicateKeys.length) report.blockers.push(`01_weekly_plans 存在重复业务键 ${duplicateKeys.length} 组`);
  if (deliveries.some((value) => value !== "1")) report.blockers.push(`01 出现 deliveryNumber != 1：${deliveries.join(",")}`);

  const weeklyKeySet = new Set(keys);
  const planKeyCounts = new Map();
  const planCodes = new Set();
  const planOrphan = [];
  for (const row of plans.rows) {
    const key = businessKey(row.orderNumber, row.itemCode, row.deliveryNumber);
    planKeyCounts.set(key, (planKeyCounts.get(key) ?? 0) + 1);
    planCodes.add(text(row.processCode));
    if (!weeklyKeySet.has(key)) planOrphan.push(row.__rowNumber);
  }
  const badCounts = [...planKeyCounts.entries()].filter(([, count]) => count !== canonicalProcesses.length);
  const badCodes = [...planCodes].filter((code) => !canonicalProcesses.some(([canonical]) => canonical === code));
  report.validation.processPlans = {
    rows: plans.rows.length,
    weeklyKeysCovered: planKeyCounts.size,
    weeklyNotTenProcesses: badCounts.length,
    invalidProcessCodes: badCodes,
    orphanRows: planOrphan.length,
    dueDateNullRows: plans.rows.filter((row) => !text(row.dueDate)).length,
    dueDatePresentRows: plans.rows.filter((row) => text(row.dueDate)).length
  };
  if (badCounts.length) report.blockers.push(`存在不是 10 个标准工序的周计划：${badCounts.length}`);
  if (badCodes.length) report.blockers.push(`02 出现非标准工序编码：${badCodes.join("、")}`);
  if (planOrphan.length) report.blockers.push(`02 存在无法匹配 01 业务键的行：${planOrphan.length}`);
  if (planKeyCounts.size !== weekly.rows.length) report.blockers.push(`01 与 02 覆盖不一致：01=${weekly.rows.length}，02 覆盖=${planKeyCounts.size}`);

  const reportBadCodes = [...new Set(reports.rows.map((row) => text(row.processCode)))].filter((code) => !canonicalProcesses.some(([canonical]) => canonical === code));
  const reportOrphan = reports.rows.filter((row) => !weeklyKeySet.has(businessKey(row.orderNumber, row.itemCode, row.deliveryNumber)));
  report.validation.processReports = {
    rows: reports.rows.length,
    invalidProcessCodes: reportBadCodes,
    orphanRows: reportOrphan.length,
    nonNumericQuantity: reports.rows.filter((row) => !isNumeric(row.productionQuantity)).length,
    negativeQuantity: reports.rows.filter((row) => isNumeric(row.productionQuantity) && Number(text(row.productionQuantity)) < 0).length,
    distinctProductionDates: [...new Set(reports.rows.map((row) => text(row.productionDate)))].slice(0, 5),
    nonEmptyExceptionText: reports.rows.filter((row) => text(row.exceptionText)).length
  };
  if (reportBadCodes.length) report.blockers.push(`03 出现非标准工序编码：${reportBadCodes.join("、")}`);
  if (reportOrphan.length) report.blockers.push(`03 存在无法匹配 01 业务键的报工：${reportOrphan.length}`);

  const rowLevel = unmapped.rows.filter((row) => /订单级|整行|无品项/.test(`${row.sourceField} ${row.reason}`));
  const fieldLevel = unmapped.rows.length - rowLevel.length;
  const classify = (row) => {
    const reason = `${row.sourceField} ${row.reason} ${row.rawValue}`;
    if (/无品号|没有品号|缺少品号|品号为空|品项为空/.test(reason)) return "无品号";
    if (/无品名|没有品名|品名为空/.test(reason)) return "无品名";
    if (/数量为空|生产数量缺失|没有数量/.test(reason)) return "生产数量为空";
    if (/非数值|不是有效数值|数量.{0,4}(非|不是).{0,4}(数字|数值)/.test(reason)) return "生产数量非数值";
    return "其他订单级未映射";
  };
  const buckets = {};
  for (const row of rowLevel) { const bucket = classify(row); buckets[bucket] = (buckets[bucket] ?? 0) + 1; }
  /* 源行追溯：01/05 记录的纳入源行集合 vs 04 的排除源行集合（用于判断是否存在“有效却消失”的源行）。 */
  const parseSourceRows = (value) => String(value ?? "").split(/[、,，\/\s]+/).map((item) => item.trim()).filter(Boolean);
  const includedSourceRows = new Set();
  for (const row of weekly.rows) for (const sourceRow of parseSourceRows(row.sourceRows)) includedSourceRows.add(sourceRow);
  for (const row of trace.rows) for (const sourceRow of parseSourceRows(row.sourceRows)) includedSourceRows.add(sourceRow);
  const excludedSourceRows = new Set(rowLevel.map((row) => text(row.sourceRow)).filter(Boolean));
  const overlap = [...excludedSourceRows].filter((sourceRow) => includedSourceRows.has(sourceRow));
  const traceTotals = trace.rows.reduce((sum, row) => sum + (Number(text(row.sourceRowCount)) || 0), 0);
  report.exclusions = {
    unmappedReviewRows: unmapped.rows.length,
    rowLevelExcluded: rowLevel.length,
    fieldLevelUnmapped: fieldLevel,
    buckets,
    sourceFields: [...new Set(unmapped.rows.map((row) => text(row.sourceField)))],
    includedSourceRowCount: includedSourceRows.size,
    declaredSourceRowCountSum: traceTotals,
    excludedSourceRowCount: excludedSourceRows.size,
    sourceRowsBothIncludedAndExcluded: overlap.length,
    sourceRowList: [...excludedSourceRows],
    sample: rowLevel.slice(0, 20).map((row) => ({
      sourceRow: text(row.sourceRow), orderNumber: text(row.orderNumber), itemCode: text(row.itemCode),
      sourceField: text(row.sourceField), rawValue: text(row.rawValue), reason: text(row.reason)
    })),
    note: rowLevel.length
      ? "行级排除可追溯到 sourceRow；被排除源行的品名/生产数量在当前初始化包中没有对应列时无法完整还原，必须回看原始源 Excel（不猜测）"
      : "04 中没有行级排除记录，全部为字段级未映射"
  };

  const knownKeys = [
    businessKey("2026A027333", "TGH616KB-1/1", "1"),
    businessKey("2026A027333", "TGH642KB-1/1", "1")
  ];
  report.validation.knownDuplicateKeys = knownKeys.map((key) => {
    const [orderNumber, itemCode] = key.split("\u0000");
    const weeklyRows = weekly.rows.filter((row) => businessKey(row.orderNumber, row.itemCode, row.deliveryNumber) === key);
    const traceRow = trace.rows.find((row) => businessKey(row.orderNumber, row.itemCode, row.deliveryNumber) === key);
    return {
      orderNumber, itemCode, weeklyRows: weeklyRows.length,
      plannedQuantity: weeklyRows.map((row) => text(row.plannedQuantity)),
      sourceRows: traceRow ? text(traceRow.sourceRows) : null,
      sourceRowCount: traceRow ? text(traceRow.sourceRowCount) : null,
      mergedPlannedQuantity: traceRow ? text(traceRow.mergedPlannedQuantity) : null
    };
  });
  for (const entry of report.validation.knownDuplicateKeys) {
    if (entry.weeklyRows !== 1) report.blockers.push(`已知重复键 ${entry.orderNumber}/${entry.itemCode} 在 01 中不是 1 条`);
  }

  report.db = await readOnlyDbChecks();
  const nonEmptyTables = Object.entries(report.db.counts).filter(([, rows]) => rows > 0);
  if (nonEmptyTables.length) report.blockers.push(`目标表在 ${tenantId} 下并非空：${nonEmptyTables.map(([table, rows]) => `${table}=${rows}`).join("、")}`);
  const divisionMatches = report.db.division.filter((row) => row.enabled);
  if (divisionMatches.length !== 1) report.blockers.push(`“事业四部”组织唯一解析失败：匹配 ${divisionMatches.length} 条`);
  const syncsEnabled = report.db.syncConfigs.filter((row) => row.enabled);
  if (syncsEnabled.length) report.blockers.push(`自动同步未全部暂停：${syncsEnabled.map((row) => row.sync_key).join("、")}`);
  if (report.db.initLedger.length) report.blockers.push("已存在 KN-MPS-INIT-001 幂等记录，禁止重复初始化");
  const reviewNotNull = report.db.nullability.some((row) => row.table_name === "mps_weekly_plans" && row.column_name === "latest_review_due_date" && row.is_nullable === "NO");
  if (reviewNotNull && reviewDatesMissing > 0) {
    report.blockers.push(`mps_weekly_plans.latest_review_due_date 为 NOT NULL，但 01 有 ${reviewDatesMissing} 行留空；任务规则要求允许为空且发现 NOT NULL 必须停止（未修改 schema、未生成假日期）`);
  }
  const basePlanNotNull = report.db.nullability.some((row) => row.table_name === "mps_weekly_plans" && row.column_name === "base_plan_id" && row.is_nullable === "NO");
  if (basePlanNotNull) {
    report.blockers.push("mps_weekly_plans.base_plan_id 为 NOT NULL（且 UNIQUE(tenant_id, base_plan_id)+FK→mps_base_plans）：每条周计划都需一条专属基础计划；初始化包只有 01/02/03，不含基础计划，无法在不凭空造数据的前提下写入");
  }
  report.warnings.push(`mps_weekly_plans NOT NULL 列：${report.db.nullability.filter((row) => row.table_name === "mps_weekly_plans" && row.is_nullable === "NO").map((row) => row.column_name).join("、")}`);

  report.summary = {
    wouldInsertWeeklyPlans: weekly.rows.length,
    wouldInsertProcessPlans: plans.rows.length,
    wouldInsertProcessReports: reports.rows.length,
    excelRowLevelExcluded: rowLevel.length,
    blockerCount: report.blockers.length
  };
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);

  console.log("【KN-MPS-INIT-001 Dry Run】");
  console.log(`文件：${file}`);
  console.log(`大小：${report.fileBytes} bytes；SHA256：${report.fileSha256}`);
  console.log(`官方读取器：${report.excel.officialReader}${report.excel.analysisCopy ? "（分析使用规范化内存副本）" : ""}`);
  console.log(`Excel 数量：01=${report.excel.counts.weeklyPlans}，02=${report.excel.counts.processPlans}，03=${report.excel.counts.processReports}，04=${report.excel.counts.unmappedReview}，05=${report.excel.counts.sourceTrace}`);
  console.log(`预计插入：weekly=${weekly.rows.length}，process plans=${plans.rows.length}，process reports=${reports.rows.length}`);
  console.log(`排除：行级=${rowLevel.length}（${JSON.stringify(buckets)}），字段级未映射=${fieldLevel}`);
  console.log(`事业四部解析：${divisionMatches.length === 1 ? `${divisionMatches[0].id}（唯一）` : `失败（${divisionMatches.length} 条）`}`);
  console.log(`blockers=${report.blockers.length}`);
  for (const blocker of report.blockers) console.log(`  - ${blocker}`);
  console.log(`报告：${jsonOut}`);
}

main().catch((error) => { console.error("audit failed:", error); process.exit(1); });
