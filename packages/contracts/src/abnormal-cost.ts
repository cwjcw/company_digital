import type { TablePermissionFieldDefinition } from './index';

export const abnormalCostResources = [
  { code: 'abnormal-categories', label: '异常类别', table: 'abnormal_categories', kind: 'categories' },
  { code: 'incident-severity-levels', label: '事故级别', table: 'incident_severity_levels', kind: 'severities' },
  { code: 'abnormal-responsibility-requests', label: '发起异常责任判定', table: 'abnormal_responsibility_requests', kind: 'requests' },
  { code: 'abnormal-responsibility-judgments', label: '责任判定表', table: 'abnormal_responsibility_judgments', kind: 'judgments' }
] as const;
export type AbnormalCostResource = typeof abnormalCostResources[number]['code'];
export const abnormalSeverityOptions = ['特大', '重大', '严重', '一般'].map(value => ({ value, label: value }));
export const abnormalPersonnelOptions = ['管理/职能岗', '一线员工', '公司'].map(value => ({ value, label: value }));
export const abnormalPersonnelLevels = ['总经理', '副总', '总监', '经理', '课长', '组长', '一线员工'].map(value => ({ value, label: value }));
const text = (key: string, label: string, required = false): TablePermissionFieldDefinition => ({ key, label, type: 'text', editable: true, required });
const money = (key: string, label: string): TablePermissionFieldDefinition => ({ key, label, type: 'number', editable: true, required: true, format: 'decimal', exactNumeric: true });
const structured = (key: string, label: string): TablePermissionFieldDefinition => ({ key, label, type: 'structured', editable: true, filterable: false });
const ref = (key: string, label: string, referenceResource: string, labelField: string, editable = true): TablePermissionFieldDefinition => ({ key, label, type: 'reference', editable, required: true, filterBinding: { kind: 'relation', referenceResource, valueField: 'id', labelField } });
export const abnormalCostFields: Record<AbnormalCostResource, TablePermissionFieldDefinition[]> = {
  'abnormal-categories': [text('category_name', '异常类别', true), text('remark', '备注')],
  'incident-severity-levels': [money('amount_min', '金额下限'), money('amount_max', '金额上限'), { key: 'severity_name', label: '事故级别', type: 'dictionary', editable: true, required: true, options: abnormalSeverityOptions }],
  'abnormal-responsibility-requests': [
    { ...text('abnormal_no', '异常单号'), editable: false }, text('customer_code', '客户', true), text('order_no', '订单号', true),
    { key: 'division_id', label: '事业部', type: 'department', editable: true, required: true },
    { key: 'initiator_id', label: '发起人', type: 'member', editable: true, required: true }, text('abnormal_description', '异常描述', true),
    money('estimated_amount', '预估金额'), money('confirmed_amount', '核定金额'), ref('severity_level_id', '事故级别', 'incident-severity-levels', 'severity_name', false),
    {...structured('responsibility_judgments', '责任划分'),required:true},
    { key: 'detail_attachment', label: '明细附件', type: 'attachment', editable: true, required: true },
    { key: 'other_attachments', label: '其他附件', type: 'attachment', editable: true, multiple: true }
  ],
  'abnormal-responsibility-judgments': [
    { ...text('judgment_no', '子表单号'), editable: false }, ref('category_id', '异常类别', 'abnormal-categories', 'category_name'),
    { key: 'judgment_department_id', label: '判定部门', type: 'department', editable: true, required: true },
    { key: 'judge_user_id', label: '判定人', type: 'member', editable: true, required: true },
    { key: 'expense_bearing_ratio', label: '承担费用比例', type: 'number', format: 'percentage', percentageScale: 'percent', editable: true, exactNumeric: true },
    { ...text('abnormal_request_link', '异常信息'), editable: false, filterable: false },
    structured('responsibility_allocations', '责任划分'), text('responsibility_reason', '责任划分理由'),
    { key: 'judgment_evidence', label: '责任判定证据', type: 'attachment', editable: true, multiple: true },
    { key: 'judgment_status', label: '判定状态', type: 'dictionary', editable: false, options: [{value:'PENDING',label:'待判定'},{value:'COMPLETED',label:'已判定'}] }
  ]
};
