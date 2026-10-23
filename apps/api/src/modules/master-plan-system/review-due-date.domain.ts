import Decimal from 'decimal.js';
import { reviewDueDateFields } from '@kdos/contracts';

export type ReviewDueDateSnapshot = {
  divisionId: string; orderNumber: string; batchNumber: string; drawingNumber: string;
  inspectionTimeName: string | null; inboundDate: string; quantity: string;
  changeCount: number | null; previousInboundDate: string | null;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date=(value:unknown,label:string,optional=false)=>{
  if(optional&&(value==null||String(value).trim()===''))return null;
  const text=String(value??'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(Date.parse(text))||new Date(text).toISOString().slice(0,10)!==text)throw new Error(`${label}必须为有效业务日期`);
  return text;
};
export function reviewDueDateSnapshot(input: ReviewDueDateSnapshot): ReviewDueDateSnapshot {
  if(typeof input.divisionId!=='string'||!uuid.test(input.divisionId))throw new Error('事业部必须使用有效组织ID');
  for (const key of ['orderNumber','batchNumber','drawingNumber'] as const) if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error(`${reviewDueDateFields.find(field=>field.key===key)!.label}不能为空`);
  if (input.inspectionTimeName != null && typeof input.inspectionTimeName !== 'string') throw new Error('品项名称必须为文本');
  const changeText=input.changeCount==null||String(input.changeCount).trim()===''?null:String(input.changeCount).trim();
  if(changeText!==null&&(!/^\d+$/.test(changeText)||!Number.isSafeInteger(Number(changeText))||Number(changeText)>2147483647))throw new Error('交期变更次数必须为非负整数');
  if (typeof input.quantity !== 'string') throw new Error('数量必须使用精确十进制文本');
  let quantity: Decimal;
  try { quantity = new Decimal(input.quantity); } catch { throw new Error('数量无效'); }
  if (!quantity.isFinite()) throw new Error('数量必须为有限精确数值');
  return { divisionId:input.divisionId,orderNumber:input.orderNumber.trim(),batchNumber:input.batchNumber.trim(),drawingNumber:input.drawingNumber.trim(),
    inspectionTimeName:input.inspectionTimeName?.trim()||null,inboundDate:date(input.inboundDate,'入库时间')!,quantity:quantity.toFixed(),
    changeCount:changeText===null?null:Number(changeText),previousInboundDate:date(input.previousInboundDate,'上次入库时间',true) };
}
export const reviewDueDateBusinessKey = (row: ReviewDueDateSnapshot) => JSON.stringify([row.divisionId,row.orderNumber,row.batchNumber,row.drawingNumber]);
/** Future source adapters must validate the whole source before submitting any commands. */
export function assertUniqueReviewDueDates(rows: ReviewDueDateSnapshot[]) {
  const seen = new Set<string>();
  for (const row of rows) { const key=reviewDueDateBusinessKey(reviewDueDateSnapshot(row)); if (seen.has(key)) throw new Error('来源包含重复事业部、订单号、批次号及品项编码，拒绝冲突记录'); seen.add(key); }
}
export type ReviewDueOrganizationOption={id:string;name:string;path:string[];pathLabel:string};
export const reviewDueDivisionOptions=(options:ReviewDueOrganizationOption[])=>options.filter(option=>option.path.length===2&&option.path[0]==='凯南'&&/^事业[一二三四]部$/.test(option.name));
export function assertReviewDueDivision(option:ReviewDueOrganizationOption|null|undefined,options:ReviewDueOrganizationOption[]) {
  if(!option||!reviewDueDivisionOptions(options).some(candidate=>candidate.id===option.id))throw new Error('事业部必须选择凯南直属且已启用的事业一部、事业二部、事业三部或事业四部');
  return option;
}
export function reviewDueDateChange(oldDate: string, newDate: string) {
  if (oldDate === newDate) return null;
  const days=(Date.parse(newDate)-Date.parse(oldDate))/86400000;
  if (!Number.isInteger(days)) throw new Error('交期日期无效');
  return { oldInboundDate: oldDate, newInboundDate: newDate, changeDays: days, changeDirection: days>0?'LATER' as const:'EARLIER' as const };
}
