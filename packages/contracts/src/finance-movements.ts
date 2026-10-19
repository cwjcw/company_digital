import type { TablePermissionFieldDefinition as Field } from './index';
import { financeDepartmentOptions, financeSalesChannelOptions } from './finance';
export const financeMovementResources = ['finance-e10-changes','finance-e10-movements','finance-e10-movement-departments','finance-e10-movement-customers'] as const;
const text=(key:string,label:string):Field=>({key,label,type:'text',editable:false});
const money=(key:string,label:string):Field=>({key,label,type:'number',format:'currency',editable:false});
export const financeChangeKinds=[{value:'REVISION',label:'金额修订'},{value:'ADD',label:'新增品项'},{value:'CLOSE',label:'指定结束'},{value:'REOPEN',label:'取消指定结束'},{value:'LOG',label:'金额日志'},{value:'OBSERVED',label:'状态变更'}];
export const financeMovementDimensions:Field[]=[text('customerCode','客户编号'),{key:'departmentCategory',label:'事业部划分',type:'dictionary',options:financeDepartmentOptions,editable:false},{key:'salesChannel',label:'国内外划分',type:'dictionary',options:financeSalesChannelOptions,editable:false}];
export const financeChangeFields:Field[]=[
 {key:'effectiveAt',label:'生效时间',type:'datetime',editable:false},text('yearMonth','发生年月'),text('orderNo','订单号'),
 {key:'orderDate',label:'订单日期',type:'date',editable:false},...financeMovementDimensions,text('itemCode','品号'),text('changeNo','变更单号'),
 {key:'changeKind',label:'变更类型',type:'dictionary',options:financeChangeKinds,editable:false},
 {key:'timeBasis',label:'日期依据',type:'dictionary',options:[{value:'APPROVAL',label:'变更单审核'},{value:'LOG',label:'订单日志'},{value:'OBSERVED',label:'同月状态观测'}],editable:false},
 money('amountBefore','变更前有效金额'),money('amountAfter','变更后有效金额'),money('changeAmount','有效金额差额'),money('rawChange','源金额差额'),
 {key:'included',label:'计入发生额',type:'boolean',editable:false}
];
export const financeMovementAmounts:Field[]=[money('baseAmount','接单基数'),money('increaseAmount','变更增加'),money('decreaseAmount','变更减少'),money('changeAmount','变更净额'),money('orderTotal','接单发生额')];
export function financeMovementFields(resource:string):Field[]{
 if(resource==='finance-e10-changes')return financeChangeFields;
 const dimensions=financeMovementDimensions.map(f=>({...f,...(resource==='finance-e10-movements'||resource==='finance-e10-movement-departments'&&f.key==='customerCode'?{printable:false,filterable:false}:{})}));
 return [text('yearMonth','发生年月'),...dimensions,...financeMovementAmounts];
}
