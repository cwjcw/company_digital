import Decimal from 'decimal.js';
import { abnormalOrderSources,type AbnormalOrderSource,type SourceOrderLine } from '../../integrations/abnormal-orders/abnormal-order.facts';
export { abnormalOrderSources,type AbnormalOrderSource,type SourceOrderLine } from '../../integrations/abnormal-orders/abnormal-order.facts';
export type AbnormalOrderItem={order_no:string;item_code:string;item_name:string|null;required_quantity:string;order_date:string;customer_due_date:string|null;source:AbnormalOrderSource;source_line_ids:string[];conflicts:{dates:string[];names:string[];orderDates:string[]}};
const Exact=Decimal.clone({precision:60});
const date=(v:unknown,nullable=false)=>{if(nullable&&v===null)return true;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;};
export function normalizeOrderSource(source:AbnormalOrderSource,raw:SourceOrderLine[]){
 if(!abnormalOrderSources.includes(source)||!Array.isArray(raw)||raw.length>200000)throw Error('ABNORMAL_ORDER_SOURCE_INVALID');
 const ids=new Map<string,SourceOrderLine>(),groups=new Map<string,AbnormalOrderItem>();let joinDuplicates=0,excluded=0,trimmedKeys=0;
 for(const original of raw){
  const r={...original,order_no:typeof original?.order_no==='string'?original.order_no.trim():original?.order_no,item_code:typeof original?.item_code==='string'?original.item_code.trim():original?.item_code};
  if(r.order_no!==original?.order_no||r.item_code!==original?.item_code)trimmedKeys++;
  if(!r||typeof r.source_line_id!=='string'||!r.source_line_id||r.source_line_id.length>100)throw Error('ABNORMAL_ORDER_LINE_INVALID');
  const previous=ids.get(r.source_line_id);if(previous){if(JSON.stringify(previous)!==JSON.stringify(original))throw Error('ABNORMAL_ORDER_JOIN_CONFLICT');joinDuplicates++;continue;}ids.set(r.source_line_id,original);
  if(!date(r.order_date)||!date(r.customer_due_date,true))throw Error('ABNORMAL_ORDER_DATE_INVALID');
  let valid=false;
  if(source==='e10-main'){
   if(!['Y','N','V'].includes(r.header_approved!)||!['Y','N','V'].includes(r.line_approved!)||!['0','1','2'].includes(r.header_close!)||![0,1].includes(r.specified_close!))throw Error('ABNORMAL_ORDER_STATE_INVALID');
   valid=r.header_approved==='Y'&&r.line_approved==='Y'&&r.header_close!=='1'&&r.specified_close===0;
  }else{
   if(!Number.isInteger(r.voucher_state)||![181,182,183,184,185,186,187,188,189,190,191,231].includes(r.voucher_state!)||![null,0,1].includes(r.cancelled!))throw Error('ABNORMAL_ORDER_STATE_INVALID');
   if(![0,1].includes(r.audited!)||![0,1].includes(r.header_stopped!)||![0,1].includes(r.line_stopped!)||typeof r.commercial_stopped!=='boolean')throw Error('ABNORMAL_ORDER_STATE_INVALID');
   valid=[189,231].includes(r.voucher_state!)&&r.cancelled!==1&&r.audited===1&&r.header_stopped===0&&r.line_stopped===0&&!r.commercial_stopped;
  }
  if(r.order_date<'2026-01-01'||!valid){excluded++;continue;}
  for(const [key,max] of [['order_no',100],['item_code',128]] as const)if(typeof r[key]!=='string'||!r[key].trim()||r[key]!==r[key].trim()||r[key].length>max)throw Error('ABNORMAL_ORDER_BUSINESS_KEY_INVALID');
  if(r.order_no==='虚拟订单'||r.item_code==='虚拟品号'||r.item_name!==null&&(typeof r.item_name!=='string'||r.item_name.length>500))throw Error('ABNORMAL_ORDER_RESERVED_OR_NAME_INVALID');
  if(typeof r.required_quantity!=='string'||!/^[-+]?\d+(?:\.\d{1,14})?$/.test(r.required_quantity))throw Error('ABNORMAL_ORDER_QUANTITY_INVALID');
  const quantity=new Exact(r.required_quantity);if(quantity.abs().gte('1e24'))throw Error('ABNORMAL_ORDER_QUANTITY_INVALID');
  const key=JSON.stringify([r.order_no,r.item_code]),g=groups.get(key);
  if(g){g.required_quantity=new Exact(g.required_quantity).plus(quantity).toFixed();g.source_line_ids.push(r.source_line_id);if(r.customer_due_date&&!g.conflicts.dates.includes(r.customer_due_date))g.conflicts.dates.push(r.customer_due_date);if(r.item_name&&!g.conflicts.names.includes(r.item_name))g.conflicts.names.push(r.item_name);if(!g.conflicts.orderDates.includes(r.order_date))g.conflicts.orderDates.push(r.order_date);}
  else groups.set(key,{order_no:r.order_no,item_code:r.item_code,item_name:r.item_name,required_quantity:quantity.toFixed(),order_date:r.order_date,customer_due_date:r.customer_due_date,source,source_line_ids:[r.source_line_id],conflicts:{dates:r.customer_due_date?[r.customer_due_date]:[],names:r.item_name?[r.item_name]:[],orderDates:[r.order_date]}});
 }
 for(const g of groups.values()){g.conflicts.dates.sort();g.conflicts.orderDates.sort();g.customer_due_date=g.conflicts.dates[0]??null;g.order_date=g.conflicts.orderDates[0];if(new Exact(g.required_quantity).abs().gte('1e24'))throw Error('ABNORMAL_ORDER_QUANTITY_OVERFLOW');}
 return {source,businessItems:groups.size,items:[...groups.values()],lines:[...ids.values()],read:raw.length,uniqueLines:ids.size,validLines:ids.size-excluded,excluded,joinDuplicates,trimmedKeys,internalDuplicateKeys:[...groups.values()].filter(g=>g.source_line_ids.length>1).length,dateConflicts:[...groups.values()].filter(g=>g.conflicts.dates.length>1).length};
}
export function mergeOrderSources(sources:ReturnType<typeof normalizeOrderSource>[]){
 const winners=new Map<string,AbnormalOrderItem>();let crossConflicts=0;
 for(const src of [...sources].sort((a,b)=>abnormalOrderSources.indexOf(a.source)-abnormalOrderSources.indexOf(b.source)))for(const r of src.items){const key=JSON.stringify([r.order_no,r.item_code]);if(winners.has(key))crossConflicts++;else winners.set(key,r);}
 return {items:[...winners.values()],beforeDedup:sources.reduce((n,s)=>n+s.items.length,0),crossConflicts};
}
