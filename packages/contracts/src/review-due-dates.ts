import type { TablePermissionFieldDefinition } from './index';

export const reviewDueDateResource = 'mps-review-due-dates' as const;
export const reviewDueDateFields: TablePermissionFieldDefinition[] = [
  { key: 'orderNumber', label: '订单号', type: 'text', editable: true, required: true },
  { key: 'batchNumber', label: '批次号', type: 'text', editable: true, required: true },
  { key: 'drawingNumber', label: '试制计划图号', type: 'text', editable: true, required: true },
  { key: 'inspectionTimeName', label: '验货时间名称', type: 'text', editable: true },
  { key: 'inboundDate', label: '入库时间', type: 'date', editable: true, required: true },
  { key: 'quantity', label: '数量', type: 'number', format: 'decimal', exactNumeric: true, editable: true, required: true },
  { key: 'changeCount', label: '交期变更次数', type: 'number', format: 'integer', editable: false },
  { key: 'previousInboundDate', label: '上次入库时间', type: 'date', editable: false },
  { key: 'lastChangedAt', label: '最近变更时间', type: 'datetime', editable: false },
  { key: 'lastSyncedAt', label: '最近同步时间', type: 'datetime', editable: false }
];
export const reviewDueDateEditableKeys = reviewDueDateFields.filter(field => field.editable).map(field => field.key);
export const reviewDueDateCreateFields = reviewDueDateFields.filter(field => field.editable);
export const reviewDueDateRequiredCreateKeys = reviewDueDateCreateFields.filter(field => field.required).map(field => field.key);
export function reviewDueDateExportFilename(now = new Date()) {
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replace(/-/g, '');
  return `mps_review_due_dates_${date}.xlsx`;
}
export type ReviewDueDateHistoryRow = {
  id: string; changedAt: string; oldInboundDate: string; newInboundDate: string;
  changeDays: number; changeDirection: 'EARLIER' | 'LATER'; sourceKind: string;
  sourceBatchId: string; changedByName: string | null;
};

/** Internal ledger compatibility only. New uploads always use STANDARD ID/version semantics. */
export type ReviewDueImportMode = 'STANDARD' | 'SOURCE';
export const reviewDueDateTemplateFilename = 'mps_review_due_dates_import_template.xlsx';
export const reviewDueDateTemplateNotes = [
  '评审交期表：入库时间是评审计划入库日期，不是WMS实际入库。',
  '标准模板：记录ID和版本同时留空表示新增；更新必须同时填写原始记录ID和有效正整数版本；只填一个非法。',
  '订单号、批次号、试制计划图号、入库时间、数量必填；验货时间名称可空。日期YYYY-MM-DD，数量使用精确十进制文本（建议将数量列保持文本格式）。',
  '更新版本冲突时整批拒绝；请取得最新ID及版本后重新填写、上传和预览，不能猜测身份或覆盖。',
  '上传后核对预览并明确点击确认才写入；取消不修改正式业务记录。首次新增计数0；真实日期变更写IMPORT历史；数量或验货名称变化不增加改期次数。',
  '支持不含记录ID和版本的原始六列Excel，全部按新增处理；无需选择导入模式。业务键已存在时冲突，不自动转为更新；更新请填写有效ID和版本。',
  '系统累计、来源身份、审计字段不可填写。下载模板不授予导入或写入权限。'
];
