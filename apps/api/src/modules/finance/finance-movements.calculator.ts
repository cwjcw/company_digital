import DecimalBase from 'decimal.js';
import { financeFactEligibility } from './finance-order-eligibility';
const Decimal=DecimalBase.clone({precision:40});
export type MovementFact=Record<string,any>;
export type MovementEvent=Record<string,any>&{eventKey:string;orderId:string;lineId:string|null;sourceTime:string;included:boolean;changeAmount:string|null};
const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const zero='00000000-0000-0000-0000-000000000000';
export function sourceTime(v:unknown):v is string{return typeof v==='string'&&/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?$/.test(v)&&Number.isFinite(Date.parse(v+'+08:00'));}
export function exact(v:unknown):string|null{try{if(v===null||v===undefined||v==='')return null;const n=new Decimal(String(v));return n.isFinite()?n.toString():null;}catch{return null;}}
export function effective(f:MovementFact):string|null{const n=exact(f.gross),eligible=financeFactEligibility(f);return n===null||eligible===null?null:!eligible||f.headerClose==='1'||f.closedSchedule===true?'0':n;}
function identity(f:MovementFact){return guid.test(f.orderId)&&guid.test(f.lineId)&&f.lineId!==zero&&typeof f.orderNo==='string'&&f.orderNo&&typeof f.customerCode==='string'&&f.customerCode&&/^20\d\d-\d\d-\d\d/.test(f.orderDate);}
function envelope(f:MovementFact,time:string):MovementEvent{return {eventKey:'',orderId:f.orderId,lineId:f.lineId??null,orderNo:f.orderNo,orderDate:f.orderDate.slice(0,10),customerCode:f.customerCode,itemCode:f.itemCode??null,changeNo:null,sourceTime:time,changeKind:'REVISION',timeBasis:'APPROVAL',amountBefore:null,amountAfter:null,changeAmount:null,rawChange:null,included:false,evidence:{}};}
/** Pure calculation. Missing historical actions are never fabricated or investigated here. */
export function calculateMovements(changes:MovementFact[],logs:MovementFact[],states:MovementFact[],oldStates:MovementFact[]=[],oldEvents:MovementEvent[]=[],observedAt?:string,runId?:string,observedStartAt?:string):MovementEvent[]{
 const result:MovementEvent[]=[];const byLine=new Map(states.map(f=>[f.lineId,f]));const oldByLine=new Map(oldStates.map(f=>[f.lineId,f]));const oldByKey=new Map(oldEvents.map(e=>[e.eventKey,e]));
 for(const f of changes){
  if(!identity(f)||f.approvalStatus!=='Y'||!sourceTime(f.approvalTime)||f.approvalTime<'2025-01-01')continue;
  const old=exact(f.grossBefore),next=exact(f.grossAfter);if(old===null||next===null)continue;
  const e=envelope(f,f.approvalTime);Object.assign(e,{eventKey:`SO:${f.sourceKey}:${f.approvalTime}`,documentId:f.documentId,changeNo:`${f.orderNo} / ${f.changeVersion}`,changeKind:({1:'REVISION',2:'ADD',3:'CLOSE',4:'REOPEN'} as Record<string,string>)[f.changeType]??'REVISION',rawChange:new Decimal(next).minus(old).toString(),evidence:{sourceKey:f.sourceKey,originalHeaderClose:f.originalHeaderClose,originalClosedSchedule:f.originalClosedSchedule,changeType:f.changeType,approvalStatus:f.approvalStatus,fullClose:f.fullClose}});
  const valid=['1','2','3','4'].includes(f.changeType)&&Number(f.planCount)>0&&!f.invalidPlans&&!f.typeMismatch&&['0','1','2'].includes(f.originalHeaderClose);
  // A whole-document close cannot be derived from a partial changed-item set.
  if(valid&&!f.fullClose&&financeFactEligibility(f)===true){
   const beforeClosed=f.originalHeaderClose==='1'||Boolean(f.originalClosedSchedule);const before=f.changeType==='2'?'0':beforeClosed?'0':old;
   const afterClosed=f.originalHeaderClose==='1'||(f.changeType==='3'||f.changeType!=='2'&&f.changeType!=='4'&&beforeClosed);const after=afterClosed?'0':next;
   Object.assign(e,{amountBefore:before,amountAfter:after,changeAmount:new Decimal(after).minus(before).toString(),included:true});
  }
  const already=oldByKey.get(e.eventKey);
  // A recorded posting is immutable. Later edits of the same approval node are retained
  // as source facts; genuine new movements come from a new, evidenced transition.
  if(already?.included){result.push(already);continue;}
  const priorApproval=oldEvents.find(old=>old.included&&old.timeBasis==='APPROVAL'&&old.evidence?.sourceKey===f.sourceKey);
  if(priorApproval&&e.included){
   const before=oldByLine.get(f.lineId),after=byLine.get(f.lineId);
   const oldValue=before?effective(before):null,newValue=after?effective(after):null;
   const distinct=oldValue!==null&&newValue!==null&&!new Decimal(oldValue).equals(newValue);
   if(!distinct||oldValue!==e.amountBefore||newValue!==e.amountAfter||!sourceTime(before?._observedAt)||e.sourceTime<=before!._observedAt||observedAt&&e.sourceTime>observedAt){
    Object.assign(e,{included:false,changeAmount:null,evidence:{...e.evidence,reapprovalWithoutDistinctTransition:true}});
   }
  }
  result.push(e);
 }
 // Ordinary logs remain source evidence unless a complete effective state is available.
 // SO_CHANGE draft-save logs are not financial postings; header and item amounts are never added together.
 logs=[...logs].sort((a,b)=>String(a.sourceKey).localeCompare(String(b.sourceKey)));
 const logById=new Map(logs.map(l=>[l.sourceKey.toLowerCase(),l]));
 const orderFacts=new Map(states.map(f=>[f.orderId,f]));
 const resolve=(r:MovementFact,seen=new Set<string>()):MovementFact|undefined=>{
  if(seen.has(r.sourceKey))return;seen.add(r.sourceKey);
  const key=String(r.primaryValue).toLowerCase();if(r.entity==='SALES_ORDER_DOC_D'&&byLine.has(key))return byLine.get(key);
  if(r.entity==='SALES_ORDER_DOC'&&orderFacts.has(key))return orderFacts.get(key);
  const parent=logById.get(String(r.parentId).toLowerCase());return parent?resolve(parent,seen):undefined;
 };
 const selected=new Map<string,MovementFact[]>();
 for(const log of logs){if(log.typeKey!=='SALES_ORDER_DOC'||!sourceTime(log.eventTime))continue;
  if(!['SALES_ORDER_DOC_D','SALES_ORDER_DOC'].includes(log.entity))continue;
  const fields=log.cols??{};let delta=new Decimal(0),known=false,bad=false;
  for(const k of ['AMT_UNINCLUDE_TAX_BC','TAX_BC'])if(fields[k]){const a=exact(fields[k].old),b=exact(fields[k].new);if(a===null||b===null){bad=true;break;}known=true;delta=delta.plus(new Decimal(b).minus(a));}
  if(!known||bad)continue;const f=resolve(log);if(!f)continue;
  const line=log.entity==='SALES_ORDER_DOC_D'?String(log.primaryValue).toLowerCase():null;
  const key=`LOG:${log.eventId}:${f.orderId}:${line??'HEADER'}`;const rr=selected.get(key)??[];rr.push({...log,context:f,lineId:line,delta:delta.toString()});selected.set(key,rr);
 }
 const itemEventOrders=new Set([...selected.values()].filter(rr=>rr[0].lineId).map(rr=>`${rr[0].eventId}:${rr[0].context.orderId}`));
 for(const [key,rr] of selected){const r=rr[0];if(!r.lineId&&itemEventOrders.has(`${r.eventId}:${r.context.orderId}`))continue;
  const e=envelope({...r.context,lineId:r.lineId},r.eventTime);Object.assign(e,{eventKey:key,changeKind:'LOG',timeBasis:'LOG',rawChange:rr.reduce((v,r)=>v.plus(r.delta),new Decimal(0)).toString(),evidence:{dataLogIds:rr.map(r=>r.sourceKey),eventId:r.eventId}});result.push(e);
 }
 // Future snapshots can prove a net transition within one calendar month. Cross-month observation
 // alone is not a source occurrence date. No old snapshot => no invented historical transition.
 if(observedAt&&runId&&sourceTime(observedAt))for(const f of states){
  const old=oldByLine.get(f.lineId);if(!old||!identity(f)||!sourceTime(old._observedAt)||old._observedAt.slice(0,7)!==observedAt.slice(0,7))continue;
  const before=effective(old),after=effective(f);if(before===null||after===null||new Decimal(before).equals(after))continue;
  const oldEnd=old._observedUntil??old._observedAt,start=observedStartAt??observedAt;
  // Do not derive a residual when an approval overlaps either capture window: the
  // streamed item may have been read before or after that approval. Its explicit
  // source posting remains, and the next clean snapshot becomes the new anchor.
  if([...oldEvents,...result].some(e=>e.included&&e.timeBasis==='APPROVAL'&&e.lineId===f.lineId&&((e.sourceTime>=old._observedAt&&e.sourceTime<=oldEnd)||(e.sourceTime>=start&&e.sourceTime<=observedAt))))continue;
  let represented=new Decimal(0);
  for(const e of result)if(e.included&&e.lineId===f.lineId&&e.sourceTime>oldEnd&&e.sourceTime<start)represented=represented.plus(e.changeAmount!);
  const remaining=new Decimal(after).minus(before).minus(represented);if(remaining.isZero())continue;
  const e=envelope(f,observedAt);Object.assign(e,{eventKey:`OBS:${runId}:${f.lineId}`,changeKind:'OBSERVED',timeBasis:'OBSERVED',amountBefore:new Decimal(before).plus(represented).toString(),amountAfter:after,changeAmount:remaining.toString(),included:true,rawChange:new Decimal(f.gross).minus(old.gross).toString(),evidence:{before:old,after:f,observedFrom:old._observedAt,observedTo:observedAt,represented:represented.toString()}});result.push(e);
 }
 const unique=new Map<string,MovementEvent>();for(const e of result){if(unique.has(e.eventKey))throw new Error('Duplicate semantic event');unique.set(e.eventKey,e);}return [...unique.values()];
}
