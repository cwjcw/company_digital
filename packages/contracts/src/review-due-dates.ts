import type { TablePermissionFieldDefinition } from './index';

export const reviewDueDateResource = 'mps-review-due-dates' as const;
export const reviewDueDateBusinessFields: TablePermissionFieldDefinition[] = [
  { key: 'divisionId', label: '事业部', type: 'department', editable: true, required: true },
  { key: 'orderNumber', label: '订单号', type: 'text', editable: true, required: true },
  { key: 'batchNumber', label: '批次号', type: 'text', editable: true, required: true },
  { key: 'drawingNumber', label: '品项编码', type: 'text', editable: true, required: true },
  { key: 'orderDate', label: '下单日期', type: 'date', editable: false },
  { key: 'productReviewDueDate', label: '产品评审交期', type: 'date', editable: false },
  { key: 'inspectionTimeName', label: '品项名称', type: 'text', editable: true },
  { key: 'inboundDate', label: '入库时间', type: 'date', editable: true, required: true },
  { key: 'quantity', label: '数量', type: 'number', format: 'decimal', exactNumeric: true, editable: true, required: true },
  { key: 'changeCount', label: '交期变更次数', type: 'number', format: 'integer', editable: true },
  { key: 'previousInboundDate', label: '上次入库时间', type: 'date', editable: true }
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

/** Internal ledger compatibility only. New uploads always use STANDARD ID/version semantics. */
export type ReviewDueImportMode = 'STANDARD' | 'SOURCE';
export const reviewDueDateTemplateFilename = 'mps_review_due_dates_import_template.xlsx';
export const reviewDueDateTemplateNotes = [
  '评审交期表：入库时间是评审计划入库日期，不是WMS实际入库。',
  '标准模板：记录ID和版本同时留空表示新增；更新必须同时填写原始记录ID和有效正整数版本；只填一个非法。',
  '事业部、订单号、批次号、品项编码、入库时间、数量必填；品项名称、交期变更次数、上次入库时间可空。事业部请选择企业微信组织目录中的正式事业部。',
  '日期使用YYYY-MM-DD；数量使用精确十进制文本（建议保持文本格式）；交期变更次数只能填写非负整数。',
  '更新版本冲突时整批拒绝；请取得最新ID及版本后重新填写、上传和预览，不能猜测身份或覆盖。',
  '新增时可选字段空白保存NULL；更新时可选字段空白表示保留原值，明确填写“[清空]”才清空品项名称、交期变更次数或上次入库时间。',
  '修改入库时间或数量不会自动改变交期变更次数、上次入库时间，也不会新增交期历史；只有文件明确提交对应字段时才修改。',
  '旧六列文件缺少事业部，不能直接导入；请使用当前模板补齐事业部。业务键已存在时冲突，不自动转为更新。',
  '来源身份和创建人、创建时间、更新人、更新时间不可填写或覆盖。下载模板不授予导入或写入权限。'
];
