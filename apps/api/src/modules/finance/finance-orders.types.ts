import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { financeOrderFields, financeMonthlyFields, financeRankingFields } from '@kdos/contracts';
import type { TableFilterActor } from '../../common/filtering/table-filter.registry';
import { buildDataScopeClause } from '../../common/filtering/data-scope';
import { financeAdmin } from './finance.types';
export const snake=(key:string)=>key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
export function orderColumns(resource:string) {
 const fields=resource==='finance-e10-lines'?financeOrderFields:resource==='finance-e10-ranking'?financeRankingFields:financeMonthlyFields;
 return {id:'id',...Object.fromEntries(fields.map(f=>[f.key,snake(f.key)])),...(["finance-e10-monthly","finance-e10-dashboard"].includes(resource)?{salesperson:"salespeople"}:{})};
}
export function orderPermission(a:TableFilterActor,r:string,action='read'){return financeAdmin(a)||a.permissions.includes(`${r}:*:${action}`)||a.permissions.includes(`${r}:*:*`);}
export function orderAuthorize(a:TableFilterActor,r:string,action='read'){if(!orderPermission(a,r,action))throw new ForbiddenException('当前权限组不能执行销售订单统计操作');}
export function orderField(a:TableFilterActor,r:string,f:string){return financeAdmin(a)||a.permissions.includes(`${r}:${f}:read`);}
export function orderScope(a:TableFilterActor,r:string,p:unknown[],action='read'){return financeAdmin(a)?'1=1':buildDataScopeClause({resource:r,columns:orderColumns(r),actor:{...a,moduleAdminCodes:[]},params:p,action,numericFields:(r==='finance-e10-lines'?financeOrderFields:r==='finance-e10-ranking'?financeRankingFields:financeMonthlyFields).filter(f=>f.type==='number').map(f=>f.key)});}
export function orderContext(context:Record<string,unknown>,p:unknown[],resource:string){
 const allowed=['year','month','dateFrom','dateTo','departmentCategory','salesChannel','customerCode','salesperson'];
 if(Object.keys(context).some(k=>!allowed.includes(k)))throw new BadRequestException('销售订单统计上下文无效');
 const clauses:string[]=[];
 const add=(value:unknown,sql:(n:number)=>string)=>{p.push(value);clauses.push(sql(p.length));};
 if(context.year!==undefined){const y=Number(context.year);if(!Number.isInteger(y)||y<2025||y>2100)throw new BadRequestException('年度无效');add(String(y),n=>`left(record.year_month,4)=$${n}`);}
 if(context.month!==undefined){const m=Number(context.month);if(!Number.isInteger(m)||m<1||m>12)throw new BadRequestException('月份无效');add(String(m).padStart(2,'0'),n=>`right(record.year_month,2)=$${n}`);}
 for(const [k,op] of [['dateFrom','>='],['dateTo','<=']])if(context[k]){
  const v=String(context[k]);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new BadRequestException('日期无效');add(v,n=>`record.order_date${op}$${n}::date`);
 }
 for(const k of ['departmentCategory','salesChannel','customerCode'])if(context[k]){if(context[k]==='待分类'&&k!=='customerCode')clauses.push(`record.${snake(k)} IS NULL`);else add(String(context[k]),n=>`record.${snake(k)}=$${n}`);}
 if(context.salesperson){add(String(context.salesperson),n=>resource==='finance-e10-lines'?`record.salesperson=$${n}`:`record.salespeople ? $${n}`);}
 return clauses.join(' AND ')||'1=1';
}
