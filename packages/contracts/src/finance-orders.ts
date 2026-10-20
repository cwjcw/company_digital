import schema from './finance-order-fields.json';
import { financeDepartmentOptions, financeSalesChannelOptions } from './finance';
import type { TablePermissionFieldDefinition } from './index';
export const financeOrderResources = ['finance-e10-lines','finance-e10-monthly','finance-e10-dashboard','finance-e10-ranking'] as const;
export const financeOrderMinimumDate = schema.minimumOrderDate;
export const financeOrderFields: TablePermissionFieldDefinition[] = schema.fields.map(f => ({ key:f.key, label:f.label, type:f.type as TablePermissionFieldDefinition['type'], editable:false, ...(f.type==='number' ? {format:'decimal' as const}: {}) }));
export const financeMonthlyFields: TablePermissionFieldDefinition[] = [
 ...['yearMonth','customerCode','orderNo','orderDate','deliveryDate'].map(k=>financeOrderFields.find(f=>f.key===k)!),
 {key:'orderTotal',label:'本币总金额',type:'number',format:'currency',editable:false},
 financeOrderFields.find(f=>f.key==='customerOrderNo')!,
 {key:'departmentCategory',label:'事业部划分',type:'dictionary',options:financeDepartmentOptions,editable:false},
 {key:'salesChannel',label:'国内外划分',type:'dictionary',options:financeSalesChannelOptions,editable:false},
 financeOrderFields.find(f=>f.key==='businessRemark')!
];
export const financeDashboardLabels = {category:'分类',amount:'金额/本币含税',share:'年占比',customer:'客户编号',customerAmount:'年累计本币总金额',month:'年月',yuan:'本币合计金额/元',wan:'本币合计金额/万元',yearTotal:'年合计',total:'合计'} as const;
export const financeRankingFields: TablePermissionFieldDefinition[] = [{key:'customerCode',label:financeDashboardLabels.customer,type:'text',editable:false},{key:'orderTotal',label:financeDashboardLabels.customerAmount,type:'number',format:'currency',editable:false}];

/** Filter-only source dimension; the monthly view/export still has ten columns. */
export const financeMonthlyFilterFields: TablePermissionFieldDefinition[] = [...financeMonthlyFields,{key:'salesperson',label:'业务员姓名',type:'text',multiple:true,printable:false,editable:false},{key:'deliveryDateConflict',label:'多个预交货日',type:'boolean',printable:false,editable:false}];
