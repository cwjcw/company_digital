import { calculateMovements,effective,sourceTime } from './finance-movements.calculator';
import { orderAuthorize,orderScope } from './finance-orders.types';
const id=(n:number)=>`0199e000-0000-7000-8000-${String(n).padStart(12,'0')}`;
const fact=(patch:Record<string,any>={})=>({docType:'销售订单',headerApproved:'Y',sourceKey:id(1),documentId:id(2),orderId:id(3),lineId:id(4),orderNo:'SYN-ORDER',orderDate:'2025-01-01T00:00:00',customerCode:'SYN-CUST',itemCode:'SYN-ITEM',approvalStatus:'Y',approvalTime:'2025-02-01T10:00:00.1234567',changeVersion:'01',changeType:'1',originalHeaderClose:'0',originalClosedSchedule:0,planCount:1,invalidPlans:0,typeMismatch:0,fullClose:false,grossBefore:'100',grossAfter:'80',...patch});
const state=(patch:Record<string,any>={})=>({...fact(),gross:'100',headerClose:'0',closedSchedule:false,...patch});
describe('Finance amount movement correctness (no history completeness gate)',()=>{
 it.each(['N','V','',null])('keeps an unapproved header %s out of current and new event effective amounts',headerApproved=>{
  expect(effective(state({headerApproved}))).toBe('0');
  const [event]=calculateMovements([fact({headerApproved})],[],[]);
  expect(event.included).toBe(false);expect(event.changeAmount).toBeNull();expect(event.rawChange).toBe('-20');
 });
 it('retains material sale source evidence without creating a reversal',()=>{
  expect(effective(state({docType:'材料销售单'}))).toBe('0');
  const [event]=calculateMovements([fact({docType:'材料销售单'})],[],[]);
  expect(event.included).toBe(false);expect(event.rawChange).toBe('-20');expect(event.changeAmount).toBeNull();
 });
 it('does not reinterpret old snapshots missing header eligibility as a zero balance',()=>{
  const old=state({_observedAt:'2025-02-05T09:00:00'});delete (old as any).headerApproved;
  expect(effective(old)).toBeNull();
  expect(calculateMovements([],[],[state({gross:'80'})],[old],[],'2025-02-05T10:00:00',id(30))).toEqual([]);
 });
 it.each([['N','Y','100'],['Y','N','-100']])('observes an evidenced approval transition %s to %s once', (before,after,delta)=>{
  const [event]=calculateMovements([],[],[state({headerApproved:after})],[state({headerApproved:before,_observedAt:'2025-02-05T09:00:00'})],[],'2025-02-05T10:00:00',id(30));
  expect(event.changeAmount).toBe(delta);expect(event.changeKind).toBe('OBSERVED');
 });
 it('does not double reduce an approval removal combined with specified closure and repricing',()=>{
  const [event]=calculateMovements([],[],[state({headerApproved:'N',headerClose:'1',closedSchedule:true,gross:'80'})],[state({_observedAt:'2025-02-05T09:00:00'})],[],'2025-02-05T10:00:00',id(30));
  expect(event.changeAmount).toBe('-100');expect(event.amountAfter).toBe('0');
 });
 it.each(['0','2',null])('keeps normal and NULL current header %s',headerClose=>expect(effective(state({headerClose}))).toBe('100'));
 it('excludes header specified closure and mixed schedule closure',()=>{expect(effective(state({headerClose:'1'}))).toBe('0');expect(effective(state({closedSchedule:true}))).toBe('0');});
 it('uses exact before and after values and includes zero and negative deltas',()=>{const [e]=calculateMovements([fact({grossBefore:'0.1',grossAfter:'0.3'})],[],[]);expect(e.changeAmount).toBe('0.2');expect(e.amountBefore).toBe('0.1');expect(calculateMovements([fact({grossAfter:'100'})],[],[])[0].changeAmount).toBe('0');});
 it('does not treat prefilled ORI as an existing added item',()=>{const [e]=calculateMovements([fact({changeType:'2',grossBefore:'100',grossAfter:'80'})],[],[]);expect(e.amountBefore).toBe('0');expect(e.changeAmount).toBe('80');});
 it('closes once when the raw amount also changes',()=>{const [e]=calculateMovements([fact({changeType:'3'})],[],[]);expect(e.rawChange).toBe('-20');expect(e.changeAmount).toBe('-100');expect(e.amountAfter).toBe('0');});
 it('reopens to the new amount, but cannot reopen a header-closed order',()=>{expect(calculateMovements([fact({changeType:'4',originalClosedSchedule:1})],[],[])[0].changeAmount).toBe('80');expect(calculateMovements([fact({changeType:'4',originalHeaderClose:'1',originalClosedSchedule:1})],[],[])[0].changeAmount).toBe('0');});
 it('does not call a partially listed whole-order closure a complete financial event',()=>expect(calculateMovements([fact({fullClose:true})],[],[])[0].included).toBe(false));
 it.each(['N','V'])('does not guess a reversal for approval status %s',approvalStatus=>expect(calculateMovements([fact({approvalStatus})],[],[])).toHaveLength(0));
 it('does not post missing original status or disagreeing schedule types',()=>{for(const patch of [{planCount:0},{invalidPlans:1},{typeMismatch:1},{originalHeaderClose:null}])expect(calculateMovements([fact(patch)],[],[])[0].included).toBe(false);});
 it('preserves all seven source fractional digits and chooses approval instead of save date',()=>{const [e]=calculateMovements([fact({modifiedTime:'2025-01-31T23:00:00'})],[],[]);expect(e.sourceTime).toBe('2025-02-01T10:00:00.1234567');expect(e.timeBasis).toBe('APPROVAL');expect(sourceTime('1900-01-01T00:00:00')).toBe(false);});
 it('rejects duplicate semantic nodes rather than doubling their amounts',()=>expect(()=>calculateMovements([fact(),fact()],[],[])).toThrow('Duplicate'));
 it('never posts draft SO logs or adds header and item raw amounts',()=>{
  const log=(entity:string,key:string,patch:Record<string,any>={})=>({sourceKey:key,eventId:id(20),primaryValue:entity==='SALES_ORDER_DOC'?id(3):id(4),entity,typeKey:'SALES_ORDER_DOC',eventTime:'2025-02-01T09:00:00',cols:{AMT_UNINCLUDE_TAX_BC:{old:'100',new:'80'}},...patch});
  const result=calculateMovements([fact()],[log('SALES_ORDER_DOC',id(21)),log('SALES_ORDER_DOC_D',id(22)),log('SO_CHANGE_DOC_D',id(23),{typeKey:'SO_CHANGE_DOC'})],[state()]);
  expect(result).toHaveLength(2);expect(result.filter(r=>r.included)).toHaveLength(1);expect(result[1].rawChange).toBe('-20');expect(result[1].changeAmount).toBeNull();
 });
 it('records future known within-month state transitions but never invents an initial history',()=>{const now='2025-02-05T10:00:00';expect(calculateMovements([],[],[state({gross:'80'})],[],[],now,id(30))).toHaveLength(0);const [e]=calculateMovements([],[],[state({gross:'80'})],[state({_observedAt:'2025-02-05T09:00:00'})],[],now,id(30));expect(e.changeAmount).toBe('-20');expect(e.timeBasis).toBe('OBSERVED');});
 it('does not assign an uncertain cross-month observation to a fabricated month',()=>expect(calculateMovements([],[],[state({gross:'80'})],[state({_observedAt:'2025-01-31T23:59:59'})],[],'2025-02-01T00:01:00',id(30))).toHaveLength(0));
 it('subtracts represented SO effects from the observed transition exactly once',()=>{const result=calculateMovements([fact() ],[],[state({gross:'80'})],[state({_observedAt:'2025-02-01T09:00:00'})],[],'2025-02-01T11:00:00',id(30));expect(result.filter(e=>e.included)).toHaveLength(1);expect(result[0].changeAmount).toBe('-20');});
 it('reapproval cannot count the same unchanged order amount twice',()=>{const first=calculateMovements([fact()],[],[])[0];const now='2025-02-05T12:00:00';const result=calculateMovements([fact({approvalTime:now})],[],[state({gross:'80'})],[state({gross:'80',_observedAt:'2025-02-05T11:00:00'})],[first],now,id(30));expect(result.filter(e=>e.included)).toHaveLength(0);expect(result[0].changeAmount).toBeNull();});
 it('same approval edits retain the original posting and produce only the observed new difference',()=>{const first=calculateMovements([fact()],[],[])[0];const result=calculateMovements([fact({grossAfter:'70'})],[],[state({gross:'70'})],[state({gross:'80',_observedAt:'2025-02-05T11:00:00'})],[first],'2025-02-05T12:00:00',id(30));expect(result.find(e=>e.timeBasis==='APPROVAL')?.changeAmount).toBe('-20');expect(result.find(e=>e.timeBasis==='OBSERVED')?.changeAmount).toBe('-10');});
 it('does not double count an approval read after the state within an overlapping capture window',()=>{const first=calculateMovements([fact({approvalTime:'2025-02-05T10:00:00'})],[],[])[0];const result=calculateMovements([fact({approvalTime:'2025-02-05T10:00:00'})],[],[state({gross:'80'})],[state({gross:'100',_observedAt:'2025-02-05T09:59:00',_observedUntil:'2025-02-05T10:01:00'})],[first],'2025-02-05T11:01:00',id(30),'2025-02-05T11:00:00');expect(result.filter(e=>e.timeBasis==='OBSERVED')).toHaveLength(0);expect(result.filter(e=>e.included)).toHaveLength(1);});
 it('keeps tenant/department scopes parameterized and does not grant new resources implicitly',()=>{const r='finance-e10-movements',a={tenantId:'T',userId:id(40),permissions:[],tableDataScopes:[{resource:r,scope:'CUSTOM',rules:[{fieldKey:'departmentCategory',operator:'EQ',value:"SYN' OR TRUE"}]}]};expect(()=>orderAuthorize(a,r)).toThrow();const p:unknown[]=['T'];expect(orderScope(a,r,p)).toContain('record.department_category');expect(p).toEqual(['T',"SYN' OR TRUE"]);});
});
