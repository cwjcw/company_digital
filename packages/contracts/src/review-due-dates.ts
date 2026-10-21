import type { TablePermissionFieldDefinition } from './index';

export const reviewDueDateResource = 'mps-review-due-dates' as const;
export const reviewDueDateFields: TablePermissionFieldDefinition[] = [
  { key: 'orderNumber', label: '订单号', type: 'text', editable: true },
  { key: 'batchNumber', label: '批次号', type: 'text', editable: true },
  { key: 'drawingNumber', label: '试制计划图号', type: 'text', editable: true },
  { key: 'inspectionTimeName', label: '验货时间名称', type: 'text', editable: true },
  { key: 'inboundDate', label: '入库时间', type: 'date', editable: true },
  { key: 'quantity', label: '数量', type: 'number', format: 'decimal', exactNumeric: true, editable: true },
  { key: 'changeCount', label: '交期变更次数', type: 'number', format: 'integer', editable: false },
  { key: 'previousInboundDate', label: '上次入库时间', type: 'date', editable: false },
  { key: 'lastChangedAt', label: '最近变更时间', type: 'datetime', editable: false },
  { key: 'lastSyncedAt', label: '最近同步时间', type: 'datetime', editable: false }
];
export const reviewDueDateEditableKeys = reviewDueDateFields.filter(field => field.editable).map(field => field.key);
export function reviewDueDateExportFilename(now = new Date()) {
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replace(/-/g, '');
  return `mps_review_due_dates_${date}.xlsx`;
}
export type ReviewDueDateHistoryRow = {
  id: string; changedAt: string; oldInboundDate: string; newInboundDate: string;
  changeDays: number; changeDirection: 'EARLIER' | 'LATER'; sourceKind: string;
  sourceBatchId: string; changedByName: string | null;
};
