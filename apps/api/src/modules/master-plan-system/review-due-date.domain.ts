import Decimal from 'decimal.js';

export type ReviewDueDateSnapshot = {
  orderNumber: string; batchNumber: string; drawingNumber: string;
  inspectionTimeName: string; inboundDate: string; quantity: string;
};
export function reviewDueDateSnapshot(input: ReviewDueDateSnapshot): ReviewDueDateSnapshot {
  for (const key of ['orderNumber','batchNumber','drawingNumber'] as const) if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error(`${key}不能为空`);
  if (typeof input.inspectionTimeName !== 'string') throw new Error('验货时间名称必须为文本');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.inboundDate) || !Number.isFinite(Date.parse(input.inboundDate)) || new Date(input.inboundDate).toISOString().slice(0,10) !== input.inboundDate) throw new Error('入库时间必须为有效业务日期');
  if (typeof input.quantity !== 'string') throw new Error('数量必须使用精确十进制文本');
  let quantity: Decimal;
  try { quantity = new Decimal(input.quantity); } catch { throw new Error('数量无效'); }
  if (!quantity.isFinite()) throw new Error('数量必须为有限精确数值');
  return { orderNumber: input.orderNumber, batchNumber: input.batchNumber, drawingNumber: input.drawingNumber, inspectionTimeName: input.inspectionTimeName, inboundDate: input.inboundDate, quantity: quantity.toFixed() };
}
export const reviewDueDateBusinessKey = (row: ReviewDueDateSnapshot) => JSON.stringify([row.orderNumber,row.batchNumber,row.drawingNumber]);
/** Future source adapters must validate the whole source before submitting any commands. */
export function assertUniqueReviewDueDates(rows: ReviewDueDateSnapshot[]) {
  const seen = new Set<string>();
  for (const row of rows) { const key=reviewDueDateBusinessKey(reviewDueDateSnapshot(row)); if (seen.has(key)) throw new Error('来源包含重复订单号、批次号及试制计划图号，拒绝冲突记录'); seen.add(key); }
}
export function reviewDueDateChange(oldDate: string, newDate: string) {
  if (oldDate === newDate) return null;
  const days=(Date.parse(newDate)-Date.parse(oldDate))/86400000;
  if (!Number.isInteger(days)) throw new Error('交期日期无效');
  return { oldInboundDate: oldDate, newInboundDate: newDate, changeDays: days, changeDirection: days>0?'LATER' as const:'EARLIER' as const };
}
