const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { Client } = require("pg");
const dotenv = require("dotenv");

const projectRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(projectRoot, ".env") });

const PROCESS_COLUMNS = [
  { sourceIndex: 13, code: "drawingBom", sourceName: "图纸&BOM" },
  { sourceIndex: 14, code: "frontParts", sourceName: "前道配件" },
  { sourceIndex: 15, code: "machining", sourceName: "机加" },
  { sourceIndex: 16, code: "welding", sourceName: "焊接/点焊" },
  { sourceIndex: 17, code: "grinding", sourceName: "研磨" },
  { sourceIndex: 18, code: "blank", sourceName: "毛坯", quantityOnOk: true },
  { sourceIndex: 19, code: "bakingPlating", sourceName: "烤漆/电镀", quantityOnOk: true },
  { sourceIndex: 20, code: "rearPackingParts", sourceName: "后道包材&配件" },
  { sourceIndex: 21, code: "assemblyPacking", sourceName: "组装&包装", quantityOnOk: true },
];

const cliArgs = process.argv.slice(2);
const option = (name) => {
  const index = cliArgs.indexOf(name);
  return index >= 0 ? cliArgs[index + 1] : undefined;
};
const commit = cliArgs.includes("--commit");
const replaceAll = cliArgs.includes("--replace-all");
const sourcePath = path.resolve(option("--source") || path.join(projectRoot, ".codex-tmp/august-import/四部计划_8.5.xlsx"));
const reportPath = option("--report") ? path.resolve(option("--report")) : null;

function rawValue(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("");
  if (Object.prototype.hasOwnProperty.call(value, "result")) return value.result;
  if (Object.prototype.hasOwnProperty.call(value, "text")) return value.text;
  if (Object.prototype.hasOwnProperty.call(value, "error")) return value.error;
  return null;
}

function textValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\u00a0/g, " ").trim();
  return text || null;
}

function identifierValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? String(value) : String(value);
  return textValue(value);
}

function formatDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function parseDate(value, defaultYear = 2026) {
  if (value === null || value === undefined || value === "") return { value: null };
  if (value instanceof Date && !Number.isNaN(value.getTime())) return { value: formatDate(value) };
  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 100000) {
    const milliseconds = Math.round((value - 25569) * 86400 * 1000);
    return { value: formatDate(new Date(milliseconds)) };
  }
  const text = textValue(value);
  if (!text) return { value: null };
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s.*)?$/);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]), text);
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})(?:\s.*)?$/);
  if (match) return validDate(defaultYear, Number(match[1]), Number(match[2]), text);
  return { value: null, error: `无法识别日期“${text}”` };
}

function validDate(year, month, day, original) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return { value: null, error: `无效日期“${original}”` };
  }
  return { value: formatDate(date) };
}

function parseDecimal(value) {
  if (value === null || value === undefined || value === "") return { value: null };
  const normalized = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(normalized)) return { value: null, error: `无法识别数字“${textValue(value)}”` };
  return { value: String(normalized) };
}

function appendIssue(issues, rowNumber, field, message, level = "warning") {
  issues.push({ rowNumber, field, level, message });
}

function parsedField(parser, value, issues, rowNumber, field) {
  const result = parser(value);
  if (result.error) appendIssue(issues, rowNumber, field, `${result.error}，已跳过该字段`);
  return result.value;
}

function parseProcess(value, process, productionQuantity, issues, rowNumber) {
  if (value === null || value === undefined || value === "") return null;
  const text = textValue(value);
  if (text?.toUpperCase() === "OK") {
    if (process.quantityOnOk) {
      if (productionQuantity === null) {
        appendIssue(issues, rowNumber, process.sourceName, "完成时间为 OK，但订单需求数量为空，未写入工序数量");
        return null;
      }
      return { code: process.code, quantity: productionQuantity, dueDate: null, status: null, exception: null };
    }
    return { code: process.code, quantity: null, dueDate: null, status: "Y", exception: null };
  }
  const date = parseDate(value);
  if (date.value) return { code: process.code, quantity: null, dueDate: date.value, status: null, exception: null };
  return { code: process.code, quantity: null, dueDate: null, status: null, exception: text || String(value) };
}

function parseOutsourcingMethod(value, issues, rowNumber) {
  const text = textValue(value);
  if (!text) return { handlingMethod: "自制", outsourcingMethod: null };
  if (text === "毛坯") return { handlingMethod: "外协", outsourcingMethod: "毛坯" };
  if (text === "外协" || text === "完成") return { handlingMethod: "外协", outsourcingMethod: "成品" };
  if (text === "申请外协") return { handlingMethod: "外协", outsourcingMethod: null };
  appendIssue(issues, rowNumber, "外协方式", `未定义的外协方式“${text}”，制作方式按外协写入，外协方式留空`);
  return { handlingMethod: "外协", outsourcingMethod: null };
}

function supplierValue(value) {
  const text = textValue(value);
  if (!text || text.includes("未外发") || text.includes("未下外协")) return null;
  return text;
}

async function parseWorkbook() {
  if (!fs.existsSync(sourcePath)) throw new Error(`找不到临时转换文件：${sourcePath}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const worksheet = workbook.getWorksheet("8.5") || workbook.worksheets[0];
  if (!worksheet) throw new Error("找不到 8.5 工作表");
  const issues = [];
  const rows = [];
  const seen = new Set();
  let blankItemRows = 0;

  for (let rowNumber = 3; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const cell = (index) => rawValue(row.getCell(index));
    const itemNumber = identifierValue(cell(6));
    if (!itemNumber) {
      blankItemRows += 1;
      continue;
    }
    const orderNumber = identifierValue(cell(2));
    if (!orderNumber) {
      appendIssue(issues, rowNumber, "订单号", `品号 ${itemNumber} 没有订单号，整行已跳过`, "error");
      continue;
    }
    const uniqueKey = `${orderNumber}\u0000${itemNumber}`;
    if (seen.has(uniqueKey)) {
      appendIssue(issues, rowNumber, "关联信息", `订单号 ${orderNumber} 与品号 ${itemNumber} 重复，重复行已跳过`, "error");
      continue;
    }
    seen.add(uniqueKey);

    const productionQuantity = parsedField(parseDecimal, cell(9), issues, rowNumber, "订单需求数量");
    const outsourcing = parseOutsourcingMethod(cell(24), issues, rowNumber);
    const parsed = {
      sourceRow: rowNumber,
      orderNumber,
      itemNumber,
      relationKey: `${orderNumber}${itemNumber}`,
      orderDate: parsedField(parseDate, cell(3), issues, rowNumber, "下单日期"),
      exceptionDueDate: parsedField(parseDate, cell(4), issues, rowNumber, "异常后二次交期"),
      modelAge: textValue(cell(5)) === "新" ? "新" : "旧",
      itemName: textValue(cell(7)),
      productionQuantity,
      historicalInboundQuantity: parsedField(parseDecimal, cell(10), issues, rowNumber, "历史入库数据"),
      todayInboundQuantity: parsedField(parseDecimal, cell(11), issues, rowNumber, "当天入库数"),
      handlingMethod: outsourcing.handlingMethod,
      outsourcingMethod: outsourcing.outsourcingMethod,
      outsourcingSupplier: supplierValue(cell(25)),
      planPage: parsedField(parseDecimal, cell(23), issues, rowNumber, "对应计划页数"),
      orderException: textValue(cell(26)),
      containerDate: parsedField(parseDate, cell(27), issues, rowNumber, "装柜日期"),
      inspection: textValue(cell(28)),
      inspectionQuantity: parsedField(parseDecimal, cell(29), issues, rowNumber, "验货数量"),
      remark: textValue(cell(30)),
      orderWeeks: parsedField(parseDecimal, cell(31), issues, rowNumber, "订单周数"),
      month: 8,
      unitPrice: parsedField(parseDecimal, cell(33), issues, rowNumber, "单价"),
      customer: textValue(cell(36)),
      division: "事业四部",
      processes: [],
    };
    parsed.processes = PROCESS_COLUMNS.map((process) =>
      parseProcess(cell(process.sourceIndex), process, productionQuantity, issues, rowNumber)
    ).filter(Boolean);
    rows.push(parsed);
  }
  return { rows, issues, blankItemRows, worksheetName: worksheet.name, worksheetRows: worksheet.rowCount };
}

function chooseOrderValue(orderRows, field, issues) {
  const values = [...new Set(orderRows.map((row) => row[field]).filter((value) => value !== null && value !== undefined && value !== ""))];
  if (values.length > 1) {
    appendIssue(issues, orderRows[0].sourceRow, field,
      `订单 ${orderRows[0].orderNumber} 的 ${field} 存在多个值（${values.join("、")}），订单主记录采用首个值，月度明细仍保留各自行值`);
  }
  return values[0] ?? null;
}

async function insertBatch(client, table, columns, records, returning = "") {
  const returned = [];
  const chunkSize = Math.max(1, Math.floor(60000 / columns.length));
  for (let start = 0; start < records.length; start += chunkSize) {
    const chunk = records.slice(start, start + chunkSize);
    const values = [];
    const tuples = chunk.map((record) => {
      const placeholders = columns.map((column) => {
        values.push(record[column]);
        return `$${values.length}`;
      });
      return `(${placeholders.join(",")})`;
    });
    const result = await client.query(
      `insert into ${table} (${columns.join(",")}) values ${tuples.join(",")} ${returning ? `returning ${returning}` : ""}`,
      values
    );
    returned.push(...result.rows);
  }
  return returned;
}

async function importRows(parsed) {
  const client = new Client({
    host: process.env.DATABASE_HOST || "127.0.0.1",
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || "postgres",
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME || "four_department_tracker",
  });
  await client.connect();
  try {
    await client.query("begin");
    let clearedRows = 0;
    let clearedOrders = 0;
    let clearedPeriods = 0;
    if (replaceAll) {
      const before = await client.query(`
        select
          (select count(*)::int from order_items) as items,
          (select count(*)::int from orders) as orders,
          (select count(*)::int from plan_periods) as periods
      `);
      clearedRows = before.rows[0].items;
      clearedOrders = before.rows[0].orders;
      clearedPeriods = before.rows[0].periods;
      await client.query("delete from item_process_progress");
      await client.query("delete from outsourcing_details");
      await client.query("delete from order_items");
      await client.query("delete from orders");
      await client.query("delete from plan_periods");
    }
    const periodResult = await client.query(
      `insert into plan_periods (year,month,status) values (2026,8,'active')
       on conflict (year,month) do update set status='active' returning id`
    );
    const periodId = periodResult.rows[0].id;
    if (!replaceAll) {
      const oldCountResult = await client.query("select count(*)::int as count from order_items where period_id=$1", [periodId]);
      clearedRows = oldCountResult.rows[0].count;
      await client.query("delete from order_items where period_id=$1", [periodId]);
    }

    const byOrder = new Map();
    for (const row of parsed.rows) byOrder.set(row.orderNumber, [...(byOrder.get(row.orderNumber) || []), row]);
    const orderNumbers = [...byOrder.keys()];
    const existingResult = await client.query(
      "select id,order_number,created_at from orders where order_number = any($1::text[]) order by created_at,id",
      [orderNumbers]
    );
    const existingMap = new Map();
    for (const order of existingResult.rows) {
      if (existingMap.has(order.order_number)) {
        appendIssue(parsed.issues, byOrder.get(order.order_number)[0].sourceRow, "订单号", `数据库中订单号 ${order.order_number} 存在重复主记录，采用最早创建的记录`);
      } else existingMap.set(order.order_number, order.id);
    }

    const orderIdMap = new Map();
    for (const [orderNumber, orderRows] of byOrder) {
      const values = {
        orderDate: chooseOrderValue(orderRows, "orderDate", parsed.issues),
        exceptionDueDate: chooseOrderValue(orderRows, "exceptionDueDate", parsed.issues),
        customer: chooseOrderValue(orderRows, "customer", parsed.issues),
        division: "事业四部",
      };
      let orderId = existingMap.get(orderNumber);
      if (orderId) {
        const updated = await client.query(
          `update orders set order_date=coalesce($2,order_date), exception_due_date=coalesce($3,exception_due_date),
             customer=coalesce($4,customer), division=$5, version=version+1, updated_at=now()
           where id=$1 returning id`,
          [orderId, values.orderDate, values.exceptionDueDate, values.customer, values.division]
        );
        orderId = updated.rows[0].id;
      } else {
        const inserted = await client.query(
          `insert into orders (order_number,order_date,exception_due_date,customer,division,version)
           values ($1,$2,$3,$4,$5,1) returning id`,
          [orderNumber, values.orderDate, values.exceptionDueDate, values.customer, values.division]
        );
        orderId = inserted.rows[0].id;
      }
      orderIdMap.set(orderNumber, orderId);
    }

    const itemRecords = parsed.rows.map((row) => ({
      order_id: orderIdMap.get(row.orderNumber), period_id: periodId, item_number: row.itemNumber,
      relation_key: row.relationKey, item_name: row.itemName, customer_due_date: null, review_due_date: null,
      exception_due_date: row.exceptionDueDate, exception_delivery_method: null, customer: row.customer,
      division: row.division, container_date: row.containerDate, model_age: row.modelAge, image_refs: null,
      product_attribute: null, surface_nature: null, special_item: null,
      production_quantity: row.productionQuantity, historical_inbound_quantity: row.historicalInboundQuantity,
      today_inbound_quantity: row.todayInboundQuantity, handling_method: row.handlingMethod,
      plan_page: row.planPage, order_exception: row.orderException, inspection: row.inspection,
      inspection_quantity: row.inspectionQuantity, remark: row.remark, order_weeks: row.orderWeeks,
      source_month: 8, unit_price: row.unitPrice, active: true, version: 1,
    }));
    const itemColumns = Object.keys(itemRecords[0] || {});
    const insertedItems = await insertBatch(client, "order_items", itemColumns, itemRecords, "id,relation_key");
    const itemIdMap = new Map(insertedItems.map((item) => [item.relation_key, item.id]));

    const definitionResult = await client.query("select id,code from process_definitions");
    const definitionMap = new Map(definitionResult.rows.map((definition) => [definition.code, definition.id]));
    const progressRecords = [];
    const outsourcingRecords = [];
    for (const row of parsed.rows) {
      const itemId = itemIdMap.get(row.relationKey);
      if (row.outsourcingSupplier || row.outsourcingMethod) {
        outsourcingRecords.push({
          order_item_id: itemId, supplier: row.outsourcingSupplier, method: row.outsourcingMethod,
          due_date: null, exception_due_date: null,
        });
      }
      for (const process of row.processes) {
        const definitionId = definitionMap.get(process.code);
        if (!definitionId) {
          appendIssue(parsed.issues, row.sourceRow, process.code, `数据库缺少工序定义 ${process.code}，该工序已跳过`, "error");
          continue;
        }
        progressRecords.push({
          order_item_id: itemId, process_definition_id: definitionId, required_days: null,
          due_date: process.dueDate, quantity: process.quantity, status: process.status,
          exception: process.exception, version: 1,
        });
      }
    }
    if (outsourcingRecords.length) await insertBatch(client, "outsourcing_details", Object.keys(outsourcingRecords[0]), outsourcingRecords);
    if (progressRecords.length) await insertBatch(client, "item_process_progress", Object.keys(progressRecords[0]), progressRecords);

    const fileHash = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
    const summary = {
      sourceSheet: parsed.worksheetName, sourceRows: parsed.worksheetRows, blankItemRows: parsed.blankItemRows,
      replaceAll, clearedRows, clearedOrders, clearedPeriods,
      importedRows: parsed.rows.length, processRows: progressRecords.length,
      outsourcingRows: outsourcingRecords.length, issues: parsed.issues.length,
    };
    const jobResult = await client.query(
      "insert into import_jobs (file_name,file_hash,status,summary,preview_payload,created_by) values ($1,$2,'completed',$3,$4,null) returning id",
      ["四部计划.xls#8.5", fileHash, JSON.stringify(summary), JSON.stringify({ year: 2026, month: 8 })]
    );
    const jobId = jobResult.rows[0].id;
    const issueRecords = parsed.issues.map((issue) => ({
      job_id: jobId, sheet_name: "8.5", row_number: issue.rowNumber || null,
      field_key: issue.field || null, level: issue.level, message: issue.message,
    }));
    if (issueRecords.length) await insertBatch(client, "import_job_errors", Object.keys(issueRecords[0]), issueRecords);
    await client.query(
      `insert into audit_logs (actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source)
       values (null,'KN246','monthly-plan',$1,'import',$2,$3,$4,'import')`,
      [periodId, JSON.stringify({ replaceAll, clearedRows, clearedOrders, clearedPeriods }), JSON.stringify(summary), `local-import-${Date.now()}`]
    );
    await client.query("commit");
    return summary;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  if (commit && !replaceAll) throw new Error("本次全量导入必须同时指定 --replace-all，避免仅清理单个月份");
  const parsed = await parseWorkbook();
  const baseSummary = {
    mode: commit ? "commit" : "dry-run", replaceAll, sourcePath, sheet: parsed.worksheetName,
    worksheetRows: parsed.worksheetRows, blankItemRows: parsed.blankItemRows,
    importableRows: parsed.rows.length, processRows: parsed.rows.reduce((sum, row) => sum + row.processes.length, 0),
    outsourcingRows: parsed.rows.filter((row) => row.outsourcingSupplier || row.outsourcingMethod).length,
    issues: parsed.issues.length,
    issueSamples: parsed.issues.slice(0, 30),
  };
  const summary = commit ? { ...baseSummary, ...(await importRows(parsed)), issueSamples: parsed.issues.slice(0, 30) } : baseSummary;
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ summary, issues: parsed.issues }, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
