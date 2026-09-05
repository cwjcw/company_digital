#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { monthlyPlanColumns } = require("../../../packages/shared/dist/index.js");

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_SOURCE_DIR = path.join(PROJECT_ROOT, "docs/plan");
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, ".codex-tmp/september-plan-sync");
const SOURCE_PRIORITY = ["事业一部", "事业二部", "事业三部", "事业四部"];

const SOURCE_SPECS = [
  { division: "事业一部", file: "事业一部.xlsx", sheet: "周生产计划", parser: parseDivisionOne },
  { division: "事业二部", file: "事业二部.xlsx", sheet: "订单", parser: parseDivisionTwo },
  { division: "事业三部", file: "事业三部.xlsx", sheet: "在制订单汇总", parser: parseDivisionThree },
  { division: "事业四部", file: "事业四部.xlsx", sheet: "主计划", parser: parseDivisionFour },
];

function rawCell(row, index) {
  const value = row.getCell(index)?.value;
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? "").join("");
  if (Object.prototype.hasOwnProperty.call(value, "result")) return value.result ?? null;
  if (Object.prototype.hasOwnProperty.call(value, "text")) return value.text ?? null;
  // Error cells and formulas without a cached result are not business values.
  return null;
}

function textValue(value) {
  if (value == null) return null;
  const text = String(value).replace(/\u00a0/g, " ").replace(/\r/g, "").trim();
  return text && !["#N/A", "#VALUE!", "#REF!"].includes(text.toUpperCase()) ? text : null;
}

function idValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return textValue(value);
}

function numberValue(value) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dateValue(value, year = 2026) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return isoDate(value);
  if (typeof value === "number" && value > 20000 && value < 100000) {
    return isoDate(new Date(Math.round((value - 25569) * 86400000)));
  }
  const text = textValue(value);
  if (!text || ["/", "待定", "待评审"].includes(text)) return null;
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) match = text.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return null;
  const parts = match.length === 4
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : [year, Number(match[1]), Number(match[2])];
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() + 1 === parts[1] && date.getUTCDate() === parts[2]
    ? isoDate(date)
    : null;
}

function compact(values, separator = "；") {
  return [...new Set(values.map(textValue).filter(Boolean))].join(separator) || null;
}

function surfaceValue(...values) {
  const text = compact(values) ?? "";
  if (/电镀|镀铬|镀锌|镀铜/.test(text)) return "电镀";
  if (/烤漆|喷粉|粉末|喷塑|油漆/.test(text)) return "烤漆";
  return null;
}

function productValue(...values) {
  const text = compact(values) ?? "";
  const wood = /木|竹/.test(text);
  const metal = /铁|钢|五金|铝|金属/.test(text);
  if (wood && metal) return "五金+木作";
  if (wood) return "木作";
  if (metal) return "五金";
  return null;
}

function specialItemValue(...values) {
  return /亚克力/.test(compact(values) ?? "") ? "亚克力" : null;
}

function processValue(value) {
  if (value == null || value === "") return {};
  const dueDate = dateValue(value);
  if (dueDate) return { dueDate };
  const status = textValue(value);
  return status && status !== "/" ? { status } : {};
}

function assignProcess(target, code, value) {
  for (const [field, parsed] of Object.entries(processValue(value))) target[`processes.${code}.${field}`] = parsed;
}

function provenance(division, sheet, rowNumber, ...remarks) {
  return compact([`来源：${division}/${sheet.trim()}/第${rowNumber}行`, ...remarks]);
}

function baseRecord(division, sheet, rowNumber, orderNumber, itemNumber) {
  return {
    sequence: null,
    // The source specification is keyed by the original workbook filename. The API resolves
    // this display name to the canonical WeCom organization UUID during import.
    responsibleOrgId: division,
    orderNumber,
    itemNumber,
    relationKey: `${orderNumber}${itemNumber}`,
    month: 9,
    _source: { division, sheet: sheet.trim(), rowNumber },
  };
}

function isDetail(orderNumber, itemNumber, itemName, quantity) {
  return Boolean(orderNumber && itemNumber && itemName && quantity != null);
}

function parseDivisionOne(row, state) {
  if (row.number <= 5) return null;
  const c = (index) => rawCell(row, index);
  const orderNumber = idValue(c(3));
  const itemNumber = idValue(c(7));
  const itemName = textValue(c(8));
  const quantity = numberValue(c(11));
  if (orderNumber && quantity == null && (textValue(c(2)) || dateValue(c(5)) || dateValue(c(6)))) {
    state.orders.set(orderNumber, {
      customer: textValue(c(2)), orderDate: dateValue(c(5)), customerDueDate: dateValue(c(6)),
    });
    return null;
  }
  if (!isDetail(orderNumber, itemNumber, itemName, quantity)) return null;
  const context = state.orders.get(orderNumber) ?? {};
  const record = {
    ...baseRecord(state.division, state.sheet, row.number, orderNumber, itemNumber),
    orderDate: context.orderDate ?? dateValue(c(5)),
    customerDueDate: context.customerDueDate,
    modelAge: ["新", "旧"].includes(textValue(c(6))) ? textValue(c(6)) : null,
    itemName,
    productAttribute: productValue(c(14), itemName),
    surfaceNature: surfaceValue(c(9), c(14), itemName),
    specialItem: specialItemValue(c(9), c(14), itemName),
    productionQuantity: quantity,
    historicalInboundQuantity: numberValue(c(46)),
    todayInboundQuantity: numberValue(c(47)),
    handlingMethod: compact([c(40), c(41)]) ? "外协" : "自制",
    "outsourcing.method": compact([c(40), c(41)]) ? "成品" : null,
    "outsourcing.supplier": textValue(c(39)),
    inspection: textValue(c(15)),
    remark: provenance(state.division, state.sheet, row.number, c(36), c(41)),
    unitPrice: numberValue(c(80)),
    orderWeeks: numberValue(c(85)),
    customer: context.customer ?? textValue(c(2)),
  };
  assignProcess(record, "drawingBom", compact([c(16), c(17)]));
  assignProcess(record, "metalMain", compact([c(18), c(19)]));
  assignProcess(record, "rearPackingParts", compact([c(20), c(21), c(22), c(23)]));
  assignProcess(record, "machining", c(24));
  assignProcess(record, "welding", compact([c(25), c(26)]));
  assignProcess(record, "grinding", c(27));
  assignProcess(record, "blank", c(28));
  assignProcess(record, "woodMain", c(29));
  assignProcess(record, "painting", c(30));
  assignProcess(record, "bakingPlating", compact([c(31), c(32)]));
  assignProcess(record, "assemblyPacking", c(33));
  return record;
}

function parseDivisionTwo(row, state) {
  if (row.number <= 3) return null;
  const c = (index) => rawCell(row, index);
  const orderNumber = idValue(c(3));
  const itemNumber = idValue(c(7));
  const itemName = textValue(c(8));
  const quantity = numberValue(c(12));
  const possibleCustomer = textValue(c(2));
  if (orderNumber && quantity == null && possibleCustomer && /^[A-Z]+\d/i.test(possibleCustomer)) {
    state.orders.set(orderNumber, {
      customer: possibleCustomer, orderDate: dateValue(c(4)), customerDueDate: dateValue(c(5)), containerDate: dateValue(c(6)),
    });
    return null;
  }
  if (!isDetail(orderNumber, itemNumber, itemName, quantity)) return null;
  const context = state.orders.get(orderNumber) ?? {};
  const outsourcing = compact([c(33), c(34)]);
  const record = {
    ...baseRecord(state.division, state.sheet, row.number, orderNumber, itemNumber),
    orderDate: context.orderDate ?? dateValue(c(4)),
    customerDueDate: context.customerDueDate ?? dateValue(c(5)),
    containerDate: context.containerDate ?? dateValue(c(6)),
    itemName,
    productAttribute: productValue(c(11), itemName),
    surfaceNature: surfaceValue(c(9), c(11), itemName),
    specialItem: specialItemValue(c(9), c(11), itemName),
    productionQuantity: quantity,
    historicalInboundQuantity: numberValue(c(39)),
    handlingMethod: outsourcing ? "外协" : "自制",
    "outsourcing.method": outsourcing ? "成品" : null,
    inspection: null,
    remark: provenance(state.division, state.sheet, row.number, c(13), c(30), c(34), c(35), c(36)),
    customer: context.customer,
  };
  assignProcess(record, "drawingBom", compact([c(15), c(16)]));
  assignProcess(record, "woodMain", c(17));
  assignProcess(record, "metalMain", c(18));
  assignProcess(record, "rearPackingParts", compact([c(19), c(20)]));
  assignProcess(record, "woodwork", c(21));
  assignProcess(record, "machining", c(22));
  assignProcess(record, "acrylic", c(23));
  assignProcess(record, "painting", c(24));
  assignProcess(record, "bakingPlating", compact([c(25), c(26), c(27)]));
  assignProcess(record, "assemblyPacking", c(28));
  return record;
}

function parseDivisionThree(row, state) {
  if (row.number <= 4) return null;
  const c = (index) => rawCell(row, index);
  const customer = textValue(c(1));
  if (customer) state.customer = customer;
  const orderNumber = idValue(c(2));
  const itemNumber = idValue(c(5));
  const itemName = textValue(c(7));
  const quantity = numberValue(c(10));
  if (!isDetail(orderNumber, itemNumber, itemName, quantity)) return null;
  const record = {
    ...baseRecord(state.division, state.sheet, row.number, orderNumber, itemNumber),
    orderDate: dateValue(c(3)),
    customerDueDate: dateValue(c(4)),
    itemName,
    productAttribute: productValue(c(9), itemName),
    surfaceNature: surfaceValue(c(8), c(9), itemName),
    specialItem: specialItemValue(c(8), c(9), itemName),
    productionQuantity: quantity,
    handlingMethod: "自制",
    remark: provenance(state.division, state.sheet, row.number, c(13)),
    customer: state.customer,
  };
  assignProcess(record, "assemblyPacking", c(12));
  return record;
}

function parseDivisionFour(row, state) {
  if (row.number <= 2) return null;
  const c = (index) => rawCell(row, index);
  const orderNumber = idValue(c(2));
  const itemNumber = idValue(c(6));
  const itemName = textValue(c(8));
  const quantity = numberValue(c(10));
  if (orderNumber && quantity == null && (dateValue(c(3)) || dateValue(c(4)))) {
    state.orders.set(orderNumber, {
      orderDate: dateValue(c(3)), customerDueDate: dateValue(c(4)),
    });
    return null;
  }
  if (!isDetail(orderNumber, itemNumber, itemName, quantity)) return null;
  const context = state.orders.get(orderNumber) ?? {};
  const rowCustomer = textValue(c(39));
  if (rowCustomer) state.customer = rowCustomer;
  state.orders.set(orderNumber, {
    ...context,
    orderDate: context.orderDate ?? dateValue(c(3)),
    customerDueDate: context.customerDueDate ?? dateValue(c(4)),
    customer: context.customer ?? rowCustomer ?? state.customer,
  });
  const outsourcing = compact([c(25), c(26), c(40)]);
  const record = {
    ...baseRecord(state.division, state.sheet, row.number, orderNumber, itemNumber),
    orderDate: context.orderDate ?? dateValue(c(3)),
    customerDueDate: context.customerDueDate ?? dateValue(c(4)),
    modelAge: ["新", "旧"].includes(textValue(c(5))) ? textValue(c(5)) : null,
    itemName,
    productAttribute: productValue(itemName),
    surfaceNature: surfaceValue(itemName),
    specialItem: specialItemValue(itemName),
    productionQuantity: quantity,
    historicalInboundQuantity: numberValue(c(11)),
    todayInboundQuantity: numberValue(c(12)),
    handlingMethod: outsourcing ? "外协" : "自制",
    "outsourcing.method": outsourcing ? "成品" : null,
    "outsourcing.supplier": textValue(c(26)),
    planPage: numberValue(c(24)),
    orderException: textValue(c(29)),
    containerDate: dateValue(c(30)),
    inspection: textValue(c(31)),
    inspectionQuantity: numberValue(c(32)),
    remark: provenance(state.division, state.sheet, row.number, c(33), c(40)),
    orderWeeks: numberValue(c(34)),
    unitPrice: numberValue(c(36)),
    customer: rowCustomer ?? state.customer,
  };
  assignProcess(record, "drawingBom", c(14));
  assignProcess(record, "frontParts", c(15));
  assignProcess(record, "machining", c(16));
  assignProcess(record, "welding", c(17));
  assignProcess(record, "grinding", c(18));
  assignProcess(record, "blank", c(19));
  assignProcess(record, "bakingPlating", c(20));
  assignProcess(record, "rearPackingParts", c(21));
  assignProcess(record, "assemblyPacking", c(22));
  return record;
}

async function parseSource(spec, sourceDir = DEFAULT_SOURCE_DIR) {
  const sourcePath = path.join(sourceDir, spec.file);
  if (!fs.existsSync(sourcePath)) throw new Error(`缺少来源文件：${sourcePath}`);
  const signatureBuffer = Buffer.alloc(4);
  const descriptor = fs.openSync(sourcePath, "r");
  try { fs.readSync(descriptor, signatureBuffer, 0, 4, 0); } finally { fs.closeSync(descriptor); }
  const signature = signatureBuffer.toString("hex");
  if (signature !== "504b0304") throw new Error(`${spec.file} 不是可直接读取的标准 .xlsx；请先用 Excel 另存为标准 xlsx`);
  const state = { division: spec.division, sheet: spec.sheet, orders: new Map(), customer: null };
  const rows = [];
  let matchedSheet = null;
  let worksheetRows = 0;
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(sourcePath, {
    worksheets: "emit", sharedStrings: "cache", styles: "ignore", hyperlinks: "ignore",
  });
  for await (const worksheet of reader) {
    if (worksheet.name.trim() !== spec.sheet) continue;
    matchedSheet = worksheet.name;
    for await (const row of worksheet) {
      worksheetRows = row.number;
      const parsed = spec.parser(row, state);
      if (parsed) rows.push(parsed);
    }
  }
  if (!matchedSheet) throw new Error(`${spec.file} 未找到工作表“${spec.sheet}”（会自动忽略名称首尾空格）`);
  for (const row of rows) {
    const context = state.orders.get(row.orderNumber);
    if (!context) continue;
    row.customer ??= context.customer ?? null;
    row.orderDate ??= context.orderDate ?? null;
    row.customerDueDate ??= context.customerDueDate ?? null;
    row.containerDate ??= context.containerDate ?? null;
  }
  return { spec, sourcePath, matchedSheet, worksheetRows, rows };
}

function canonicalSignature(record) {
  return JSON.stringify({
    name: textValue(record.itemName)?.replace(/\s+/g, "") ?? null,
    quantity: numberValue(record.productionQuantity),
    customer: textValue(record.customer)?.replace(/\s+/g, "").toUpperCase() ?? null,
    dueDate: record.customerDueDate ?? null,
  });
}

function score(record) {
  return Object.entries(record).reduce((total, [key, value]) => total + (key.startsWith("_") || value == null || value === "" ? 0 : 1), 0);
}

function mergeNonEmpty(primary, records) {
  const merged = { ...primary };
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if ((merged[key] == null || merged[key] === "") && value != null && value !== "") merged[key] = value;
    }
  }
  return merged;
}

function reconcileRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.orderNumber}\u0000${row.itemNumber}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const output = [];
  const duplicates = [];
  for (const [key, candidates] of groups) {
    if (candidates.length === 1) {
      output.push(candidates[0]);
      continue;
    }
    const signatures = new Set(candidates.map(canonicalSignature));
    const sorted = [...candidates].sort((a, b) => score(b) - score(a)
      || SOURCE_PRIORITY.indexOf(a._source.division) - SOURCE_PRIORITY.indexOf(b._source.division)
      || a._source.rowNumber - b._source.rowNumber);
    let selected = mergeNonEmpty(sorted[0], sorted.slice(1));
    let rule = "EXACT_DUPLICATE_COLLAPSED";
    let requiresAcceptance = false;
    if (signatures.size > 1) {
      requiresAcceptance = true;
      const sameSource = new Set(candidates.map((row) => row._source.division)).size === 1;
      if (sameSource && candidates.every((row) => numberValue(row.productionQuantity) != null)) {
        const quantities = candidates.map((row) => numberValue(row.productionQuantity));
        const max = Math.max(...quantities);
        const otherSum = quantities.reduce((sum, value) => sum + value, 0) - max;
        const repeated = new Set(quantities).size !== quantities.length;
        const reconciledQuantity = repeated || Math.abs(max - otherSum) < 1e-9
          ? max
          : quantities.reduce((sum, value) => sum + value, 0);
        selected.productionQuantity = reconciledQuantity;
        rule = repeated ? "SAME_SOURCE_REPEAT_USE_MAX" : Math.abs(max - otherSum) < 1e-9
          ? "SAME_SOURCE_TOTAL_ROW_USE_MAX"
          : "SAME_SOURCE_SPLIT_ROWS_SUM";
      } else {
        rule = "CROSS_SOURCE_CONFLICT_USE_RICHEST_ROW";
      }
    }
    const sourceRefs = candidates.map((row) => `${row._source.division}:${row._source.rowNumber}`).join("、");
    selected.remark = compact([selected.remark, `归并来源行：${sourceRefs}`]);
    output.push(selected);
    duplicates.push({
      key: key.replace("\u0000", " / "), orderNumber: selected.orderNumber, itemNumber: selected.itemNumber,
      rule, requiresAcceptance, selectedQuantity: selected.productionQuantity,
      sources: candidates.map((row) => ({ ...row._source, customer: row.customer ?? null, itemName: row.itemName, quantity: row.productionQuantity })),
    });
  }
  output.sort((a, b) => SOURCE_PRIORITY.indexOf(a._source.division) - SOURCE_PRIORITY.indexOf(b._source.division)
    || a._source.rowNumber - b._source.rowNumber);
  output.forEach((row, index) => { row.sequence = (index + 1) * 10; });
  return { rows: output, duplicates, conflicts: duplicates.filter((row) => row.requiresAcceptance) };
}

function valueAt(record, key) {
  return record[key] ?? null;
}

async function writeNormalizedWorkbook(records, outputPath) {
  // The source workbooks need streaming reads, but the normalized result is small enough for
  // the regular writer. ExcelJS's streaming writer can emit zero CRC values on this runtime,
  // which makes the API's strict reader reject an otherwise readable workbook.
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("主计划", { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });
  sheet.addRow(monthlyPlanColumns.map((field) => field.group ?? "计划信息"));
  sheet.addRow(monthlyPlanColumns.map((field) => field.header));
  for (const record of records) sheet.addRow(monthlyPlanColumns.map((field) => valueAt(record, field.key)));
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: monthlyPlanColumns.length } };
  await workbook.xlsx.writeFile(outputPath);
}

function csvCell(value) {
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function writeDuplicateCsv(duplicates, outputPath) {
  const headers = ["订单号", "品号", "规则", "需人工接受", "归并数量", "来源行"];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of duplicates) lines.push([
    row.orderNumber, row.itemNumber, row.rule, row.requiresAcceptance ? "是" : "否", row.selectedQuantity,
    row.sources.map((source) => `${source.division}/${source.sheet}/${source.rowNumber}/数量=${source.quantity}`).join(" | "),
  ].map(csvCell).join(","));
  fs.writeFileSync(outputPath, `\uFEFF${lines.join("\n")}\n`);
}

function cliOptions(argv) {
  const value = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  return {
    sourceDir: path.resolve(value("--source-dir") ?? DEFAULT_SOURCE_DIR),
    outputDir: path.resolve(value("--output-dir") ?? DEFAULT_OUTPUT_DIR),
    baseUrl: (value("--base-url") ?? process.env.KNPLAN_API_URL ?? "http://127.0.0.1:15172/api/v1").replace(/\/$/, ""),
    versionId: value("--version-id") ?? null,
    preview: argv.includes("--preview") || argv.includes("--confirm"),
    confirm: argv.includes("--confirm"),
    acceptConflicts: argv.includes("--accept-reconciled-duplicates"),
  };
}

function authHeaders() {
  const token = process.env.KDOS_PLAN_SYNC_TOKEN;
  const apiKey = process.env.KDOS_PLAN_SYNC_API_KEY;
  if (token) return { Authorization: `Bearer ${token}`, "x-tenant-code": process.env.KDOS_TENANT_CODE ?? "KAINAN" };
  if (apiKey) return { "x-api-key": apiKey, "x-tenant-code": process.env.KDOS_TENANT_CODE ?? "KAINAN" };
  throw new Error("调用计划中心预览/确认接口需要 KDOS_PLAN_SYNC_TOKEN 或 KDOS_PLAN_SYNC_API_KEY");
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...authHeaders(), ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${url} 失败（${response.status}）：${body.message ?? JSON.stringify(body)}`);
  return body.data ?? body;
}

async function resolveVersionId(options) {
  if (options.versionId) return options.versionId;
  const period = await jsonRequest(`${options.baseUrl}/planning/periods/by-month?year=2026&month=9`);
  if (!period) throw new Error("计划中心尚未建立 2026 年 9 月计划周期");
  const draft = period.versions?.find((version) => version.status === "DRAFT");
  if (!draft) throw new Error("2026 年 9 月没有可导入的 DRAFT 计划版本");
  return draft.id;
}

async function previewAndMaybeConfirm(options, workbookPath, conflicts) {
  if (!options.preview) return null;
  if (options.confirm && conflicts.length && !options.acceptConflicts) {
    throw new Error(`存在 ${conflicts.length} 个非完全一致的重复键；确认写入前必须审核报告并显式增加 --accept-reconciled-duplicates`);
  }
  const versionId = await resolveVersionId(options);
  const buffer = fs.readFileSync(workbookPath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), path.basename(workbookPath));
  const preview = await jsonRequest(`${options.baseUrl}/planning/versions/${versionId}/imports/preview`, { method: "POST", body: form });
  if (!options.confirm) return { versionId, preview, confirmed: null };
  const confirmed = await jsonRequest(`${options.baseUrl}/planning/imports/${preview.jobId}/confirm`, { method: "POST" });
  return { versionId, preview, confirmed };
}

async function run(argv = process.argv.slice(2)) {
  const options = cliOptions(argv);
  fs.mkdirSync(options.outputDir, { recursive: true });
  const startedAt = new Date();
  const parsedSources = [];
  for (const spec of SOURCE_SPECS) parsedSources.push(await parseSource(spec, options.sourceDir));
  const parsedRows = parsedSources.flatMap((source) => source.rows);
  const reconciled = reconcileRows(parsedRows);
  const workbookPath = path.join(options.outputDir, "2026-09-事业部计划-标准化.xlsx");
  const duplicateCsvPath = path.join(options.outputDir, "2026-09-重复键复核.csv");
  const reportPath = path.join(options.outputDir, "2026-09-同步测试报告.json");
  await writeNormalizedWorkbook(reconciled.rows, workbookPath);
  writeDuplicateCsv(reconciled.duplicates, duplicateCsvPath);
  const api = await previewAndMaybeConfirm(options, workbookPath, reconciled.conflicts);
  const report = {
    mode: options.confirm ? "CONFIRM" : options.preview ? "PREVIEW" : "DRY_RUN",
    target: { year: 2026, month: 9, versionId: api?.versionId ?? options.versionId },
    startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    sources: parsedSources.map((source) => ({
      division: source.spec.division, file: source.spec.file, requestedSheet: source.spec.sheet,
      actualSheet: source.matchedSheet, worksheetRows: source.worksheetRows, validDetailRows: source.rows.length,
      customers: new Set(source.rows.map((row) => row.customer).filter(Boolean)).size,
      orders: new Set(source.rows.map((row) => row.orderNumber)).size,
    })),
    totals: {
      sourceDetailRows: parsedRows.length, normalizedRows: reconciled.rows.length,
      duplicateKeys: reconciled.duplicates.length, conflictsRequiringAcceptance: reconciled.conflicts.length,
      customers: new Set(reconciled.rows.map((row) => row.customer).filter(Boolean)).size,
      orders: new Set(reconciled.rows.map((row) => row.orderNumber)).size,
    },
    dataQuality: {
      missingCustomer: reconciled.rows.filter((row) => !row.customer).length,
      missingOrderDate: reconciled.rows.filter((row) => !row.orderDate).length,
      missingCustomerDueDate: reconciled.rows.filter((row) => !row.customerDueDate).length,
      missingRequiredKey: reconciled.rows.filter((row) => !row.orderNumber || !row.itemNumber).length,
    },
    duplicateRules: Object.fromEntries([...new Set(reconciled.duplicates.map((row) => row.rule))]
      .map((rule) => [rule, reconciled.duplicates.filter((row) => row.rule === rule).length])),
    api,
    outputs: { workbookPath, duplicateCsvPath, reportPath },
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

module.exports = {
  SOURCE_SPECS, rawCell, textValue, numberValue, dateValue, parseSource, reconcileRows,
  writeNormalizedWorkbook, cliOptions, run,
};

if (require.main === module) run().catch((error) => {
  console.error(`同步测试失败：${error.message}`);
  process.exitCode = 1;
});
