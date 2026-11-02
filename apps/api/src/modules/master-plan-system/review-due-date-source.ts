import Decimal from 'decimal.js';
import { BadRequestException } from '@nestjs/common';
import { loadReviewDueWorkbook } from './review-due-date-workbook';

export type ReviewDueSourceRecord = {
  sourceRows: number[];
  divisionName: string;
  orderNumber: string;
  batchNumber: string;
  drawingNumber: string;
  inspectionTimeName: string | null;
  quantity: string;
  dueDate: string;
  latestDueDate: string | null;
  changeCount: 0;
  previousInboundDate: null;
};
export type ReviewDueSourceConflict = { orderNumber: string; drawingNumber: string; rows: number[]; reason: string };
export type ReviewDueSourceAnalysis = { sourceRows: number; records: ReviewDueSourceRecord[]; conflicts: ReviewDueSourceConflict[]; invalidRows: Array<{ row: number; reason: string }>; latestDueDateNulls: number };

function rawValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return (value as { result?: unknown }).result;
    if ('richText' in value) return (value as { richText: Array<{ text: string }> }).richText.map(part => part.text).join('');
    if ('text' in value) return (value as { text: string }).text;
  }
  return value;
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null;
}

export function parseReviewDueSourceDate(value: unknown, date1904 = false): string | null {
  const v = rawValue(value);
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v > 0 && v < 2958466) {
    const timestamp = (v - (date1904 ? 24107 : 25569)) * 86400000;
    const date = new Date(timestamp);
    return Number.isFinite(timestamp) ? date.toISOString().slice(0, 10) : null;
  }
  if (typeof v !== 'string') return null;
  const text = v.trim();
  let match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(text);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[/-](\d{1,2})$/.exec(text);
  if (match) return isoDate(2026, Number(match[1]), Number(match[2]));
  return null;
}

function text(cell: { value: unknown; text: string }) {
  const value = rawValue(cell.value);
  if (typeof value === 'number') return cell.text.trim();
  return String(value ?? cell.text ?? '').trim();
}

function quantity(cell: { value: unknown; text: string }) {
  const value = rawValue(cell.value);
  if (value == null || String(value).trim() === '') throw new Error('订单数量为空');
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || value.toString().replace(/[.e+-]/g, '').length > 15)) throw new Error('订单数量数值精度不可靠');
  try {
    const amount = new Decimal(String(value));
    if (!amount.isFinite()) throw new Error();
    return amount.toFixed();
  } catch {
    throw new Error('订单数量不是有效精确数值');
  }
}

type RawRecord = Omit<ReviewDueSourceRecord, 'batchNumber' | 'changeCount' | 'previousInboundDate' | 'dueDate' | 'latestDueDate'> & {
  sourceRow: number;
  rawDueDate: unknown;
  rawLatestDueDate: unknown;
};
const divisions: Record<string, string> = {
  '一部': '凯南 / 事业一部', '二部': '凯南 / 事业二部', '三部': '凯南 / 事业三部', '四部': '凯南 / 事业四部',
  '供应链': '凯南 / 计划中心 / 采购部'
};

/** Strict source adapter for the confirmed 1102 workbook column contract. */
export async function analyzeReviewDueSourceWorkbook(buffer: Buffer, requestId: string): Promise<ReviewDueSourceAnalysis> {
  const workbook = await loadReviewDueWorkbook(buffer, requestId);
  const sheet = workbook.getWorksheet('在手未完成订单明细') ?? workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('文件没有业务工作表');
  const expected: Record<number, string> = { 4: '订单号', 6: '交期', 7: '事业部评审交期', 8: '图号', 9: '品名', 10: '订单数量', 12: '生产单位' };
  for (const [column, label] of Object.entries(expected)) {
    const actual = sheet.getCell(1, Number(column)).text.replace(/\s+/g, '');
    if (actual !== label) throw new BadRequestException(`Excel第1行第${column}列应为“${label}”，实际为“${actual}”`);
  }
  const grouped = new Map<string, RawRecord[]>();
  const invalidRows: ReviewDueSourceAnalysis['invalidRows'] = [];
  let sourceRows = 0;
  for (let index = 2; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    const orderNumber = text(row.getCell(4)), drawingNumber = text(row.getCell(8));
    if (!orderNumber && !drawingNumber) continue;
    sourceRows++;
    try {
      if (!orderNumber || !drawingNumber) throw new Error('订单号或品项编码为空');
      const divisionSource = text(row.getCell(12)), divisionName = divisions[divisionSource];
      if (!divisionName) throw new Error(`生产单位“${divisionSource}”没有确认的组织映射`);
      const due = parseReviewDueSourceDate(row.getCell(6).value, workbook.properties.date1904);
      if (!due) throw new Error('交期无法转换为有效日期');
      const item: RawRecord = {
        sourceRow: index, sourceRows: [index], divisionName, orderNumber, drawingNumber,
        inspectionTimeName: text(row.getCell(9)) || null, quantity: quantity(row.getCell(10)),
        rawDueDate: due, rawLatestDueDate: parseReviewDueSourceDate(row.getCell(7).value, workbook.properties.date1904)
      };
      const key = JSON.stringify([orderNumber, drawingNumber]);
      const group = grouped.get(key) ?? [];
      group.push(item); grouped.set(key, group);
    } catch (error) {
      invalidRows.push({ row: index, reason: (error as Error).message });
    }
  }

  const records: ReviewDueSourceRecord[] = [], conflicts: ReviewDueSourceConflict[] = [];
  for (const group of grouped.values()) {
    const base = group[0]!;
    const conflict = (reason: string) => conflicts.push({ orderNumber: base.orderNumber, drawingNumber: base.drawingNumber, rows: group.map(row => row.sourceRow), reason });
    if (group.some(row => row.divisionName !== base.divisionName)) { conflict('同订单品项生产单位不一致'); continue; }
    const earliestDue = group.map(row => row.rawDueDate as string).sort()[0]!;
    const variants = new Map<string, RawRecord[]>();
    for (const row of group) {
      // Different quantities or latest review dates are distinct source batches.
      // Exact duplicate rows collapse, while their source row numbers remain traceable.
      const variantKey = JSON.stringify([row.quantity, row.rawLatestDueDate]);
      const batch = variants.get(variantKey) ?? [];
      batch.push(row);
      variants.set(variantKey, batch);
    }
    const batches = [...variants.values()];
    if (batches.some(batch => new Set(batch.map(row => row.inspectionTimeName)).size > 1)) {
      conflict('同一批次的品名不一致，无法安全合并');
      continue;
    }
    batches.sort((a, b) => a[0]!.sourceRow - b[0]!.sourceRow);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!, representative = batch[0]!;
      records.push({
        sourceRows: batch.map(row => row.sourceRow), divisionName: representative.divisionName,
        orderNumber: representative.orderNumber, batchNumber: String(i + 1).padStart(2, '0'),
        drawingNumber: representative.drawingNumber, inspectionTimeName: representative.inspectionTimeName,
        quantity: representative.quantity, dueDate: earliestDue, latestDueDate: representative.rawLatestDueDate as string | null,
        changeCount: 0, previousInboundDate: null
      });
    }
  }
  return { sourceRows, records, conflicts, invalidRows, latestDueDateNulls: records.filter(row => row.latestDueDate === null).length };
}
