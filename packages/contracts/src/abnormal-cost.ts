import type { TablePermissionFieldDefinition } from './index';

export const abnormalCostResources = [
  { code: 'abnormal-cost-orders', label: '订单表', table: 'abnormal_cost_order_items', kind: 'orders' },
  { code: 'abnormal-expense-categories', label: '异常费用分类', table: 'abnormal_expense_categories', kind: 'expense-categories' },
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
  'abnormal-cost-orders': [
    ...['order_no','item_code','item_name'].map((key,i)=>({...text(key,['订单号','品号','品名'][i]!),editable:false})),
    {key:'required_quantity',label:'需求数量',type:'number',format:'decimal',exactNumeric:true,editable:false},
    {key:'order_date',label:'下单日期',type:'date',editable:false},{key:'customer_due_date',label:'客户交期',type:'date',editable:false}
  ],
  'abnormal-expense-categories': [text('major_category','异常大类',true),text('sub_category','异常二级分类',true),{key:'is_enabled',label:'是否启用',type:'boolean',editable:true,required:true}],
  'abnormal-categories': [text('category_name', '异常类别', true), text('remark', '备注')],
  'incident-severity-levels': [money('amount_min', '金额下限'), money('amount_max', '金额上限'), { key: 'severity_name', label: '事故级别', type: 'dictionary', editable: true, required: true, options: abnormalSeverityOptions }],
  'abnormal-responsibility-requests': [
    { ...text('abnormal_no', '异常单号'), editable: false }, text('customer_code', '客户', true), text('order_no', '订单号', true),
    {...text('item_codes','品号',true),multiple:true},
    {key:'abnormal_quantity',label:'异常数量',type:'number',format:'integer',editable:true,required:true,exactNumeric:true},
    text('major_category','异常大类',true),{...text('sub_categories','异常二级分类',true),multiple:true},
    { key: 'division_id', label: '事业部', type: 'department', editable: true, required: true },
    { key: 'initiator_id', label: '发起人', type: 'member', editable: true, required: true }, text('abnormal_description', '异常描述', true),
    money('estimated_amount', '预估金额'), money('confirmed_amount', '核定金额'), ref('severity_level_id', '事故级别', 'incident-severity-levels', 'severity_name', false),
    {...structured('responsibility_judgments', '责任划分'),required:true},
    { key: 'detail_attachment', label: '历史明细附件', type: 'attachment', editable: false, required: false },
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

/** Canonical exact exception; mixed secondary categories never qualify. */
export function abnormalAllowsVirtual(major:unknown,secondary:unknown):boolean {
  return major==='粉末报废'&&Array.isArray(secondary)&&secondary.length===1&&secondary[0]==='回收粉';
}
export const abnormalExpenseCategorySeeds = [
  ['内部制程不良补料','内部制程不良补料'],['呆滞物料报废','原材料'],['呆滞物料报废','半成品'],['呆滞物料报废','成品'],
  ['粉末报废','呆滞废粉'],['粉末报废','回收粉'],['异常工时','内部原因'],['异常工时','供应商原因'],['异常工时','客户原因'],
  ['设变费用','内部原因'],['设变费用','客户原因'],['额外运杂费','品质原因'],['额外运杂费','交付原因'],['额外运杂费','客情维护'],['额外运杂费','其它原因']
] as const;
