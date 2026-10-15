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
  ["allocatedQuantity", "已分配数量", "number"],
  ["approvalDate", "审核日期", "date"], ["orderStatus", "订单状态", "text"],
  ["supplierCode", "供应商代码", "text"], ["supplierName", "供应商名称", "text"],
  ["planNumber", "计划单号", "text"], ["currency", "交易币种", "text"],
  ["financialExchangeRate", "财务汇率", "number"], ["settlementRatio", "结算比例", "number"],
  ["scheduledQuantity", "排产数量", "number"], ["divisionId", "承接事业部", "text"], ["remark", "备注", "text"]
] as const;
export const ALLOCATION_LINEAGE_FIELDS = ["importBatchId","sourceWorksheet","sourceRowNumber","importedAt","importedBy"] as const;
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
  return { id: row.id, ...Object.fromEntries(ALLOCATION_FIELDS.map(([key]) => [key, normalizedAllocationValue(key, row[allocationColumn(key)] ?? row[key])])), ...Object.fromEntries(ALLOCATION_LINEAGE_FIELDS.map(key=>{const value=row[allocationColumn(key)]??row[key]??null;return [key,value instanceof Date?value.toISOString():value];})) };
}
export function allocationChange(before: AllocationSnapshot | null, after: AllocationSnapshot): AllocationChange {
  const a = allocationSnapshot(after), b = before ? allocationSnapshot(before) : null;
  return { before: b, after: a, fields: ALLOCATION_FIELDS.filter(([key]) => b ? b[key] !== a[key] : a[key] != null).map(([key, label]) => ({ key, label, before: b?.[key] ?? null, after: a[key] })) };
}
export type AllocationParsedRow = { row: number; ignoredIdentity: boolean; values: Record<string, unknown> };
export async function parseAllocationWorkbook(buffer: Buffer) {
  assertSpreadsheetNotEncrypted(buffer);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as never); } catch { throw new BadRequestException("Excel 未解密或文件损坏，请解密或检查确保文件正确后导入。"); }
  const sheet = workbook.getWorksheet("分配") ?? workbook.getWorksheet("mps-order-allocations");
  if (!sheet) throw new BadRequestException("未找到分配工作表");
  if (sheet.rowCount > 50_001) throw new BadRequestException("单次最多导入50000行");
  const recognizedHeaders = new Set(["记录ID","版本","未分配数量",...ALLOCATION_FIELDS.map(f=>f[1]),...Object.values(aliases).flat()]);
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => { const label = normalizeAllocationHeader(cell.text); if (!label || !recognizedHeaders.has(label)) return; if (headers.has(label)) throw new BadRequestException(`表头重复：${label}`); headers.set(label, col); });
  const columns = new Map<string, number>();
  for (const [key, label] of ALLOCATION_FIELDS) { const match = [label, ...(aliases[key] ?? [])].find(h => headers.has(h)); if (match) columns.set(key, headers.get(match)!); }
  const quantitySource=headers.has("未分配数量")?"ERP_UNALLOCATED":"KDOS_ALLOCATED";
  if(quantitySource==="ERP_UNALLOCATED")columns.set("allocatedQuantity",headers.get("未分配数量")!);
  for (const key of ["orderNumber", "itemCode", "allocatedQuantity"]) if (!columns.has(key)) throw new BadRequestException(`缺少字段：${ALLOCATION_FIELDS.find(f => f[0] === key)![1]}`);
  if (!columns.has("supplierName") && !columns.has("divisionId")) throw new BadRequestException("缺少供应商名称或承接事业部");
  const rows: AllocationParsedRow[] = [], errors: Array<{ row: number; reason: string }> = [];
  sheet.eachRow((r, n) => {
    if (n === 1 || ![...columns.values()].some(col => r.getCell(col).text.trim())) return;
    const values: Record<string, unknown> = {};
    let quantityInvalid=false;
    for (const [key, label, type] of ALLOCATION_FIELDS) {
      const col = columns.get(key); if (!col) continue;
      const cell = r.getCell(col); if (cell.value == null || (cell.type !== ExcelJS.ValueType.Formula && cell.text.trim() === "")) continue;
      try {
        let text=cell.text.trim();
        if(cell.type===ExcelJS.ValueType.Error)throw Error("Excel错误值");
        if(cell.type===ExcelJS.ValueType.Formula){
          if(type!=="number")throw Error("该业务字段不能包含公式");
          const cached=(cell.value as {result?:unknown}).result;
          if(cached==null||cached==="")throw Error("公式缺少有效缓存结果，请在Excel重新计算并保存");
          if(typeof cached!=="string"&&typeof cached!=="number")throw Error("公式缓存是错误值或非数字");
          text=String(cached);
        }
        if (type === "date") {
          let day: string;
          if (cell.value instanceof Date) day = cell.value.toISOString().slice(0, 10);
          else if (typeof cell.value === "number") { const serial = cell.value; if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) throw Error("日期序列无效"); day = new Date(Date.UTC(workbook.properties.date1904 ? 1904 : 1899, workbook.properties.date1904 ? 0 : 11, workbook.properties.date1904 ? 1 : 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10); }
          else { const match = cell.text.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+00:00(?::00)?)?$/); if (!match) throw Error("日期格式无效"); day = `${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}`; }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) !== day) throw Error("日期无效");
          values[key] = day;
        } else if (type === "number") {
          const value = new Decimal(text.replace(/,/g, "")); if (!value.isFinite()) throw Error("数字无效");
          if (["orderQuantity","allocatedQuantity","scheduledQuantity"].includes(key) && value.isNegative()) throw Error("数量不能为负数");
          const scale = ["financialExchangeRate","settlementRatio"].includes(key) ? 8 : 4;
          if (value.decimalPlaces() > scale || value.abs().gte(new Decimal(10).pow(20-scale))) throw Error(`超出数据库精度（最多${scale}位小数）`);
          values[key] = value.toString();
        } else { const text = cell.text.trim(); values[key] = typeof cell.value === "number" && /^0+$/.test(cell.numFmt ?? "") ? text.padStart(cell.numFmt.length, "0") : text; }
      } catch (e) { if(key==="allocatedQuantity")quantityInvalid=true; errors.push({ row: n, reason: `${key==="allocatedQuantity"&&quantitySource==="ERP_UNALLOCATED"?"未分配数量（映射已分配数量）":label} (${cell.address})：${(e as Error).message}` }); }
    }
    for (const key of ["orderNumber", "itemCode"]) if (!values[key]) errors.push({row:n,reason:`${ALLOCATION_FIELDS.find(f=>f[0]===key)![1]}不能为空`});
    if(values.allocatedQuantity==null&&!quantityInvalid)errors.push({row:n,reason:`${quantitySource==="ERP_UNALLOCATED"?"未分配数量":"已分配数量"} (${r.getCell(columns.get("allocatedQuantity")!).address})不能为空`});
    const id=headers.has("记录ID")?r.getCell(headers.get("记录ID")!).text.trim():"";
    const version=headers.has("版本")?r.getCell(headers.get("版本")!).text.trim():"";
    rows.push({row:n,values,ignoredIdentity:Boolean(id||version)});
  });
  if (!rows.length) errors.push({row:2,reason:"文件中没有可导入的数据"});
  return { rows, errors, sourceWorksheet:sheet.name, fileTotalRows:Math.max(0,sheet.rowCount-1), quantitySource, ignoredIdentity:rows.some(r=>r.ignoredIdentity), orderCount: new Set(rows.map(r=>r.values.orderNumber)).size };
}

/** Only this mandatory supplier rule constrains the target name; other valid mappings remain configurable. */
export function allocationVendorTargetError(supplierName:string,unit:{name:string}) {
  return supplierName==="供应链"&&unit.name.trim()!=="采购部"?"供应链必须映射采购部，请选择正确的现有采购部组织":null;
}
