import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { BadRequestException } from "@nestjs/common";
import { assertSpreadsheetNotEncrypted } from "../../spreadsheet-upload";

/** The only import/event/attachment field allowlist. Money is never read. */
export const ALLOCATION_FIELDS = [
  ["salespersonName", "业务员", "text"], ["customerCode", "客户代码", "text"],
  ["orderNumber", "订单单号", "text"], ["orderDate", "下单日期", "date"],
  ["expectedShippingDate", "预计发货日期", "date"], ["orderSequence", "订单序号", "text"],
  ["itemCode", "品号", "text"], ["itemName", "品名", "text"], ["specification", "规格", "text"],
  ["unit", "单位", "text"], ["orderQuantity", "订单数量", "number"],
  ["allocatedQuantity", "已分配数量", "number"], ["unallocatedQuantity", "未分配数量", "number"],
  ["approvalDate", "审核日期", "date"], ["orderStatus", "订单状态", "text"],
  ["supplierCode", "供应商代码", "text"], ["supplierName", "供应商名称", "text"],
  ["planNumber", "计划单号", "text"], ["currency", "交易币种", "text"],
  ["financialExchangeRate", "财务汇率", "number"], ["settlementRatio", "结算比例", "number"],
  ["scheduledQuantity", "排产数量", "number"], ["divisionId", "承接事业部", "text"], ["remark", "备注", "text"]
] as const;
export const allocationColumn = (key: string) => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
export type AllocationSnapshot = Record<string, unknown>;
export type AllocationChange = { before: AllocationSnapshot | null; after: AllocationSnapshot; fields: Array<{ key: string; label: string; before: unknown; after: unknown }> };
export const normalizeAllocationHeader = (s: string) => s.replace(/\s+/g, "");
const aliases: Record<string, string[]> = { customerCode: ["客户编码"], orderNumber: ["订单编号"], itemCode: ["品项编码"], itemName: ["品项名称"], expectedShippingDate: ["预计出货日期"], allocatedQuantity: ["分配数量"] };
export function normalizedAllocationValue(key: string, value: unknown): unknown {
  if (value == null || value === "") return null;
  const field = ALLOCATION_FIELDS.find(f => f[0] === key)!;
  if (field[2] === "number") return new Decimal(String(value)).toString();
  if (field[2] === "date") return value instanceof Date ? value.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }) : String(value).slice(0, 10);
  return String(value).trim();
}
export function allocationSnapshot(row: AllocationSnapshot): AllocationSnapshot {
  return { id: row.id, ...Object.fromEntries(ALLOCATION_FIELDS.map(([key]) => [key, normalizedAllocationValue(key, row[allocationColumn(key)] ?? row[key])])) };
}
export function allocationChange(before: AllocationSnapshot | null, after: AllocationSnapshot): AllocationChange {
  const a = allocationSnapshot(after), b = before ? allocationSnapshot(before) : null;
  return { before: b, after: a, fields: ALLOCATION_FIELDS.filter(([key]) => b ? b[key] !== a[key] : a[key] != null).map(([key, label]) => ({ key, label, before: b?.[key] ?? null, after: a[key] })) };
}
export type AllocationParsedRow = { row: number; id?: string; expectedVersion?: number; values: Record<string, unknown> };
export async function parseAllocationWorkbook(buffer: Buffer) {
  assertSpreadsheetNotEncrypted(buffer);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as never); } catch { throw new BadRequestException("Excel 未解密或文件损坏，请解密或检查确保文件正确后导入。"); }
  const sheet = workbook.getWorksheet("分配") ?? workbook.getWorksheet("mps-order-allocations");
  if (!sheet) throw new BadRequestException("未找到分配工作表");
  if (sheet.rowCount > 50_001) throw new BadRequestException("单次最多导入50000行");
  const recognizedHeaders = new Set(["记录ID","版本",...ALLOCATION_FIELDS.map(f=>f[1]),...Object.values(aliases).flat()]);
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => { const label = normalizeAllocationHeader(cell.text); if (!label || !recognizedHeaders.has(label)) return; if (headers.has(label)) throw new BadRequestException(`表头重复：${label}`); headers.set(label, col); });
  const columns = new Map<string, number>();
  for (const [key, label] of ALLOCATION_FIELDS) { const match = [label, ...(aliases[key] ?? [])].find(h => headers.has(h)); if (match) columns.set(key, headers.get(match)!); }
  for (const key of ["orderNumber", "itemCode", "allocatedQuantity"]) if (!columns.has(key)) throw new BadRequestException(`缺少字段：${ALLOCATION_FIELDS.find(f => f[0] === key)![1]}`);
  if (!columns.has("supplierName") && !columns.has("divisionId")) throw new BadRequestException("缺少供应商名称或承接事业部");
  const rows: AllocationParsedRow[] = [], errors: Array<{ row: number; reason: string }> = [];
  const businessKeys = new Set<string>(), sequenceKeys = new Set<string>();
  sheet.eachRow((r, n) => {
    if (n === 1 || ![...columns.values()].some(col => r.getCell(col).text.trim())) return;
    const values: Record<string, unknown> = {};
    for (const [key, label, type] of ALLOCATION_FIELDS) {
      const col = columns.get(key); if (!col) continue;
      const cell = r.getCell(col); if (cell.value == null || cell.text.trim() === "") continue; // blank cells never erase human data
      try {
        if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error) throw Error("不能包含公式或错误值");
        if (type === "date") {
          let day: string;
          if (cell.value instanceof Date) day = cell.value.toISOString().slice(0, 10);
          else if (typeof cell.value === "number") { const serial = cell.value; if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) throw Error("日期序列无效"); day = new Date(Date.UTC(workbook.properties.date1904 ? 1904 : 1899, workbook.properties.date1904 ? 0 : 11, workbook.properties.date1904 ? 1 : 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10); }
          else { const match = cell.text.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+00:00(?::00)?)?$/); if (!match) throw Error("日期格式无效"); day = `${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}`; }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) !== day) throw Error("日期无效");
          values[key] = day;
        } else if (type === "number") {
          const value = new Decimal(cell.text.trim().replace(/,/g, "")); if (!value.isFinite()) throw Error("数字无效");
          if (["orderQuantity","allocatedQuantity","unallocatedQuantity","scheduledQuantity"].includes(key) && value.isNegative()) throw Error("数量不能为负数");
          const scale = ["financialExchangeRate","settlementRatio"].includes(key) ? 8 : 4;
          if (value.decimalPlaces() > scale || value.abs().gte(new Decimal(10).pow(20-scale))) throw Error(`超出数据库精度（最多${scale}位小数）`);
          values[key] = value.toString();
        } else { const text = cell.text.trim(); values[key] = typeof cell.value === "number" && /^0+$/.test(cell.numFmt ?? "") ? text.padStart(cell.numFmt.length, "0") : text; }
      } catch (e) { errors.push({ row: n, reason: `${label}：${(e as Error).message}` }); }
    }
    for (const key of ["orderNumber", "itemCode"]) if (!values[key]) errors.push({row:n,reason:`${ALLOCATION_FIELDS.find(f=>f[0]===key)![1]}不能为空`});
    const key = JSON.stringify([values.orderNumber, values.itemCode]);
    if (businessKeys.has(key)) errors.push({row:n,reason:"同一订单品号存在重复或分拆分配，现有计划关联不支持自动覆盖，请先复核"}); businessKeys.add(key);
    if (values.orderSequence) { const seq=JSON.stringify([values.orderNumber,values.orderSequence]); if (sequenceKeys.has(seq)) errors.push({row:n,reason:"订单序号重复，存在分拆或数据冲突，请先复核"}); sequenceKeys.add(seq); }
    const identityCol=headers.get("记录ID"),versionCol=headers.get("版本");
    const id=identityCol?r.getCell(identityCol).text.trim():"", version=versionCol?r.getCell(versionCol).text.trim():"";
    if(Boolean(id)!==Boolean(version))errors.push({row:n,reason:"记录ID与版本必须同时填写或同时留空"});
    if(id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))errors.push({row:n,reason:"记录ID格式无效"});
    if(version&&(!Number.isInteger(Number(version))||Number(version)<1))errors.push({row:n,reason:"版本必须为正整数"});
    rows.push({row:n,values,...(id?{id,expectedVersion:Number(version)}:{})});
  });
  if (!rows.length) errors.push({row:2,reason:"文件中没有可导入的数据"});
  return { rows, errors, orderCount: new Set(rows.map(r=>r.values.orderNumber)).size };
}
