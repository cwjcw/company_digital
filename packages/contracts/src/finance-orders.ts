import schema from './finance-order-fields.json';
import { financeDepartmentOptions, financeSalesChannelOptions } from './finance';
import { financeMovementAmounts } from './finance-movements';
import type { TablePermissionFieldDefinition } from './index';
export const financeOrderResources = ['finance-e10-lines','finance-e10-monthly','finance-e10-dashboard','finance-e10-ranking'] as const;
export const financeOrderMinimumDate = schema.minimumOrderDate;
export const financeOrderFields: TablePermissionFieldDefinition[] = schema.fields.map(f => ({ key:f.key, label:f.label, type:f.type as TablePermissionFieldDefinition['type'], editable:false, ...(f.type==='number' ? {format:'decimal' as const}: {}) }));
export const financeMonthlyFields: TablePermissionFieldDefinition[] = [
 {key:'yearMonth',label:'发生年月',type:'text',editable:false},
 ...['customerCode','orderNo','orderDate','deliveryDate'].map(k=>financeOrderFields.find(f=>f.key===k)!),
 {key:'businessType',label:'业务类型',type:'dictionary',options:[{value:'NEW',label:'新增'},{value:'CHANGE',label:'变更'},{value:'BOTH',label:'新增及变更'}],editable:false},
 ...financeMovementAmounts.map(f=>({...f,label:({baseAmount:'本月新增金额',increaseAmount:'本月变更增加',decreaseAmount:'本月变更减少',changeAmount:'本月变更净额',orderTotal:'本月发生额'} as Record<string,string>)[f.key]??f.label})),
 financeOrderFields.find(f=>f.key==='customerOrderNo')!,
 {key:'departmentCategory',label:'事业部划分',type:'dictionary',options:financeDepartmentOptions,editable:false},
 {key:'salesChannel',label:'国内外划分',type:'dictionary',options:financeSalesChannelOptions,editable:false},
 financeOrderFields.find(f=>f.key==='businessRemark')!
];
export const financeDashboardLabels = {category:'分类',amount:'接单发生额/本币含税',share:'期间占比',customer:'客户编号',customerAmount:'期间累计接单发生额',month:'发生年月',yuan:'接单发生额/元',wan:'接单发生额/万元',yearTotal:'期间合计',total:'合计'} as const;
export const financeRankingFields: TablePermissionFieldDefinition[] = [{key:'customerCode',label:financeDashboardLabels.customer,type:'text',editable:false},{key:'orderTotal',label:financeDashboardLabels.customerAmount,type:'number',format:'currency',editable:false}];

/** Dashboard aggregates do not require read access to unused monthly component fields. */
export const financeDashboardRequiredFields = financeMonthlyFields.filter(f=>!['businessRemark','businessType','baseAmount','increaseAmount','decreaseAmount','changeAmount'].includes(f.key));
/** Filter-only source dimensions are not exported as technical columns. */
export const financeMonthlyFilterFields: TablePermissionFieldDefinition[] = [...financeMonthlyFields,{key:'salesperson',label:'业务员姓名',type:'text',multiple:true,printable:false,editable:false},{key:'deliveryDateConflict',label:'多个预交货日',type:'boolean',printable:false,editable:false}];
