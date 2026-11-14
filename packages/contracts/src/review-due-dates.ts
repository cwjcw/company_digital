import type { TablePermissionFieldDefinition } from './index';

export const reviewDueDateResource = 'mps-review-due-dates' as const;
export const reviewDueDateBusinessFields: TablePermissionFieldDefinition[] = [
  { key: 'divisionId', label: '事业部', type: 'department', editable: true, required: true },
  { key: 'orderNumber', label: '订单号', type: 'text', editable: true, required: true },
  { key: 'batchNumber', label: '批次号', type: 'text', editable: true, required: true },
  { key: 'drawingNumber', label: '品项编码', type: 'text', editable: true, required: true },
  { key: 'orderDate', label: '下单日期', type: 'date', editable: true },
  // Stable permission key retained; the formerly live monthly projection is materialized locally by migration 124.
  { key: 'productReviewDueDate', label: '客户交期', type: 'date', editable: true },
  { key: 'inspectionTimeName', label: '品项名称', type: 'text', editable: true },
  { key: 'quantity', label: '数量', type: 'number', format: 'decimal', exactNumeric: true, editable: true, required: true },
  // Keep the stable field key and storage column for existing permissions/history.
  { key: 'inboundDate', label: '最新交期', type: 'date', editable: true },
];
/** This resource stores both audit actors as stable user UUIDs. */
export const reviewDueDateAuditFields: TablePermissionFieldDefinition[] = [
  { key: 'createdBy', label: '创建人', type: 'member', format: 'auditActor', editable: false, printable: true },
  { key: 'createdAt', label: '创建时间', type: 'datetime', format: 'plain', editable: false, printable: true },
  { key: 'updatedBy', label: '更新人', type: 'member', format: 'auditActor', editable: false, printable: true },
  { key: 'updatedAt', label: '更新时间', type: 'datetime', format: 'plain', editable: false, printable: true }
];
export const reviewDueDateFields: TablePermissionFieldDefinition[] = [...reviewDueDateBusinessFields, ...reviewDueDateAuditFields];
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

export type ReviewDueDateBulkImportRow = { row: number; values: Record<string, unknown> };
export type ReviewDueDateBulkImportRequest = { commandId: string; rows: ReviewDueDateBulkImportRow[] };
export type ReviewDueDateBulkImportResponse = {
  batchId: string; total: number; succeeded: number; failed: number; atomic: true; repeated: boolean;
  errors: Array<{ row: number; reason: string }>;
  records: Array<{ row: number; id: string; version: number }>;
};

/** Internal ledger compatibility only. New uploads always use STANDARD ID/version semantics. */
export const reviewDueDateTemplateFilename = 'mps_review_due_dates_import_template.xlsx';
export const reviewDueDateTemplateNotes = [
  '评审交期表为独立业务表；客户交期、下单日期是本表字段，不随其他计划变化。',
  '标准模板：记录ID和版本同时留空表示新增；更新必须同时填写原始记录ID和有效正整数版本；只填一个非法。',
  '事业部、订单号、批次号、品项编码、数量必填；下单日期、客户交期、最新交期、品项名称可空。事业部请选择企业微信组织目录中的正式事业部或采购部。',
  '日期使用YYYY-MM-DD；数量使用精确十进制文本（建议保持文本格式）。',
  '更新版本冲突时整批拒绝；请取得最新ID及版本后重新填写、上传和预览，不能猜测身份或覆盖。',
  '新增时可选字段空白保存NULL；更新时可选字段空白表示保留原值，明确填写“[清空]”才清空下单日期、客户交期、品项名称或最新交期。',
  '旧六列文件缺少事业部，不能直接导入；请使用当前模板补齐事业部。业务键已存在时冲突，不自动转为更新。',
  '记录ID、版本以及创建人、创建时间、更新人、更新时间不可填写或覆盖。下载模板不授予导入或写入权限。'
];
