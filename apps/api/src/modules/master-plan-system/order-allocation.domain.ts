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
const aliases: Record<string, string[]> = { customerCode: ["客户编码"], orderNumber: ["订单编号"], itemCode: ["品项编码"], itemName: ["品项名称"], expectedShippingDate: ["预计出货日期", "预计发货日期"], allocatedQuantity: ["分配数量"] };
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
  const readHeaders = (rowNumber: number) => {
    const headers = new Map<string, number>(), duplicates = new Set<string>();
    sheet.getRow(rowNumber).eachCell((cell, col) => {
      const label = normalizeAllocationHeader(cell.text);
      if (!label || !recognizedHeaders.has(label)) return;
      if (headers.has(label)) duplicates.add(label); else headers.set(label, col);
    });
    return { headers, duplicates };
  };
  const isAllocationHeader = (headers: Map<string, number>) => {
    const has = (key: string) => [ALLOCATION_FIELDS.find(field => field[0] === key)![1], ...(aliases[key] ?? [])].some(label => headers.has(label));
    return has("orderNumber") && has("itemCode") && (has("allocatedQuantity") || headers.has("未分配数量"));
  };
  const headerSearchEnd = Math.min(sheet.rowCount, 10);
  let headerRow = 0, headers = new Map<string, number>(), duplicates = new Set<string>();
  for (let rowNumber = 1; rowNumber <= headerSearchEnd; rowNumber++) {
    const candidate = readHeaders(rowNumber);
    if (!isAllocationHeader(candidate.headers)) continue;
    headerRow = rowNumber; headers = candidate.headers; duplicates = candidate.duplicates; break;
  }
  if (!headerRow) { headerRow = 1; ({ headers, duplicates } = readHeaders(headerRow)); }
  if (duplicates.size) throw new BadRequestException(`表头重复：${[...duplicates].join("、")}`);
  const columns = new Map<string, number>();
  for (const [key, label] of ALLOCATION_FIELDS) { const match = [label, ...(aliases[key] ?? [])].find(h => headers.has(h)); if (match) columns.set(key, headers.get(match)!); }
  const quantitySource=headers.has("未分配数量")?"ERP_UNALLOCATED":"KDOS_ALLOCATED";
  if(quantitySource==="ERP_UNALLOCATED")columns.set("allocatedQuantity",headers.get("未分配数量")!);
  for (const key of ["orderNumber", "itemCode", "allocatedQuantity"]) if (!columns.has(key)) throw new BadRequestException(`缺少字段：${ALLOCATION_FIELDS.find(f => f[0] === key)![1]}`);
  if (!columns.has("supplierName") && !columns.has("divisionId")) throw new BadRequestException("缺少供应商名称或承接事业部");
  const rows: AllocationParsedRow[] = [], errors: Array<{ row: number; reason: string }> = [];
  let fileTotalRows = 0;
  sheet.eachRow((r, n) => {
    if (n <= headerRow) return;
    const orderNumberColumn = columns.get("orderNumber"), itemCodeColumn = columns.get("itemCode");
    const hasIdentityCell = [orderNumberColumn, itemCodeColumn].some(col => col != null && r.getCell(col).value != null);
    const hasMeaningfulNonIdentityValue = [...columns.entries()].some(([key, col]) => {
      if (key === "orderNumber" || key === "itemCode") return false;
      const cell = r.getCell(col);
      if (cell.value == null) return false;
      if (cell.type === ExcelJS.ValueType.Formula) {
        const cached: unknown = cell.result;
        if (cached == null || cached === false || cached === 0) return false;
        return typeof cached !== "string" || cached.trim() !== "";
      }
      if (typeof cell.value === "number") return cell.value !== 0;
      return cell.text.trim() !== "";
    });
    // ERP report exports can contain a formula-only spacer/total row. Ignore it only when both
    // required identifiers are completely absent and the remaining cells carry no business data.
    if (!hasIdentityCell && !hasMeaningfulNonIdentityValue) return;
    fileTotalRows++;
    const values: Record<string, unknown> = {};
    let quantityInvalid=false;
    for (const [key, label, type] of ALLOCATION_FIELDS) {
      const col = columns.get(key); if (!col) continue;
      const cell = r.getCell(col); if (cell.value == null || (cell.type !== ExcelJS.ValueType.Formula && cell.text.trim() === "")) continue;
      try {
        let value: unknown = cell.value;
        let text=cell.text.trim();
        if(cell.type===ExcelJS.ValueType.Error)throw Error("Excel错误值");
        if(cell.type===ExcelJS.ValueType.Formula){
          // ExcelJS cell.value drops falsy results; its public result getter preserves 0/false.
          const cached: unknown=cell.result;
          if(cached==null)throw Error("公式缺少有效缓存结果，请在Excel重新计算并保存");
          if(typeof cached==="object"&&"error" in cached)throw Error(`公式缓存为Excel错误值：${cached.error}`);
          if(!(cached instanceof Date)&&!["string","number","boolean"].includes(typeof cached))throw Error("公式缓存结果类型无效");
          // Read cached values only; formula expressions never enter business values or evaluation.
          value=cached;
          text=cached instanceof Date?cached.toISOString().slice(0,10):String(cached).trim();
        }
        if (type === "date") {
          let day: string;
          if (value instanceof Date) day = value.toISOString().slice(0, 10);
          else if (typeof value === "number") {
            const serial = Math.floor(value), date1904 = workbook.properties.date1904;
            if (!Number.isFinite(value) || serial < (date1904 ? 0 : 1) || serial > (date1904 ? 2957003 : 2958465) || (!date1904 && serial === 60)) throw Error("日期序列无效");
            day = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 31) + (serial - (!date1904 && serial > 60 ? 1 : 0)) * 86400000).toISOString().slice(0, 10);
          }
          else { const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+00:00(?::00)?)?$/); if (!match) throw Error("日期格式无效"); day = `${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}`; }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) !== day) throw Error("日期无效");
          values[key] = day;
        } else if (type === "number") {
          const value = new Decimal(text.replace(/,/g, "")); if (!value.isFinite()) throw Error("数字无效");
          if (["orderQuantity","allocatedQuantity","scheduledQuantity"].includes(key) && value.isNegative()) throw Error("数量不能为负数");
          const scale = ["financialExchangeRate","settlementRatio"].includes(key) ? 8 : 4;
          if (value.decimalPlaces() > scale || value.abs().gte(new Decimal(10).pow(20-scale))) throw Error(`超出数据库精度（最多${scale}位小数）`);
          values[key] = value.toString();
        } else { if (text !== "") values[key] = typeof value === "number" && /^0+$/.test(cell.numFmt ?? "") ? text.padStart(cell.numFmt.length, "0") : text; }
      } catch (e) { if(key==="allocatedQuantity")quantityInvalid=true; errors.push({ row: n, reason: `${key==="allocatedQuantity"&&quantitySource==="ERP_UNALLOCATED"?"未分配数量（映射已分配数量）":label} (${cell.address})：${(e as Error).message}` }); }
    }
    for (const key of ["orderNumber", "itemCode"]) if (!values[key]) errors.push({row:n,reason:`${ALLOCATION_FIELDS.find(f=>f[0]===key)![1]}不能为空`});
    if(values.allocatedQuantity==null&&!quantityInvalid)errors.push({row:n,reason:`${quantitySource==="ERP_UNALLOCATED"?"未分配数量":"已分配数量"} (${r.getCell(columns.get("allocatedQuantity")!).address})不能为空`});
    const id=headers.has("记录ID")?r.getCell(headers.get("记录ID")!).text.trim():"";
    const version=headers.has("版本")?r.getCell(headers.get("版本")!).text.trim():"";
    rows.push({row:n,values,ignoredIdentity:Boolean(id||version)});
  });
  if (!rows.length) errors.push({row:2,reason:"文件中没有可导入的数据"});
  return { rows, errors, sourceWorksheet:sheet.name, headerRow, fileTotalRows, quantitySource, ignoredIdentity:rows.some(r=>r.ignoredIdentity), orderCount: new Set(rows.map(r=>r.values.orderNumber)).size };
}

/** Normalize only Unicode compatibility forms and surrounding whitespace; never fuzzy-match suppliers. */
export function normalizeAllocationSupplierName(value:unknown):string {
  return String(value??"").normalize("NFKC").trim();
}

export function allocationVendorRequiredDivisionName(supplierName:unknown):string|null {
  const normalized=normalizeAllocationSupplierName(supplierName);
  if(normalized==="供应链") return "采购部";
  if(normalized==="贻居(厦门)智能科技有限公司") return "贻居";
  return null;
}

/** Known formal vendor rules resolve to a canonical enabled organization ID when options are supplied. */
export function allocationVendorTargetError(
  supplierName:unknown,
  unit:{id?:string;name:string},
  organizations?:Array<{id:string;name:string;enabled?:boolean}>
) {
  const expected=allocationVendorRequiredDivisionName(supplierName);
  if(!expected)return null;
  const supplier=normalizeAllocationSupplierName(supplierName);
  const message=`供应商“${supplier}”必须映射${expected}，请核实正式组织映射`;
  if(organizations){
    const matches=organizations.filter(item=>item.enabled!==false&&normalizeAllocationSupplierName(item.name)===expected);
    if(matches.length===0)return normalizeAllocationSupplierName(unit.name)===expected?`组织架构中不存在启用的“${expected}”组织`:message;
    if(!unit.id||!matches.some(item=>item.id===unit.id))return message;
    return null;
  }
  return normalizeAllocationSupplierName(unit.name)===expected?null:message;
}
