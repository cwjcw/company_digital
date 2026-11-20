import { abnormalAllowsVirtual,abnormalExpenseCategorySeeds } from '@kdos/contracts';
import { mergeOrderSources,normalizeOrderSource,type SourceOrderLine } from './abnormal-order.domain';
const line=(patch:Partial<SourceOrderLine>={}):SourceOrderLine=>({source_line_id:'1',order_no:'SYN-ORDER',item_code:'SYN-ITEM',item_name:'合成品名',required_quantity:'1.00000000000001',order_date:'2026-01-01',customer_due_date:'2026-06-01',header_approved:'Y',line_approved:'Y',header_close:'2',specified_close:0,voucher_state:189,cancelled:null,audited:1,header_stopped:0,line_stopped:0,commercial_stopped:false,...patch});
describe('Independent abnormal ERP order semantics',()=>{
 it('keeps completed orders, excludes draft/cancelled/specified-ended and pre-2026 rows',()=>{
  expect(normalizeOrderSource('e10-main',[line(),line({source_line_id:'2',header_approved:'N'}),line({source_line_id:'3',header_close:'1'}),line({source_line_id:'4',specified_close:1}),line({source_line_id:'5',order_date:'2025-12-31'})])).toMatchObject({validLines:1,excluded:4});
  expect(normalizeOrderSource('tplus-kainan',[line({voucher_state:189}),line({source_line_id:'2',cancelled:1}),line({source_line_id:'3',voucher_state:181})])).toMatchObject({validLines:1,excluded:2});
 });
 it('deduplicates identical join identities, sums actual distinct lines exactly and chooses earliest customer date',()=>{
  const a=line(),r=normalizeOrderSource('e10-main',[a,{...a},line({source_line_id:'2',required_quantity:'2.00000000000001',customer_due_date:'2026-05-01'})]);
  expect(r).toMatchObject({joinDuplicates:1,uniqueLines:2,internalDuplicateKeys:1,dateConflicts:1});expect(r.items[0]).toMatchObject({required_quantity:'3.00000000000002',customer_due_date:'2026-05-01',source_line_ids:['1','2']});
  expect(()=>normalizeOrderSource('e10-main',[a,{...a,required_quantity:'3'}])).toThrow('JOIN_CONFLICT');
 });
 it('preserves independent keys and chooses whole source rows E10 > Kainan > Kejia, with fallback',()=>{
  const e=normalizeOrderSource('e10-main',[line({required_quantity:'1',item_name:'E'})]),k=normalizeOrderSource('tplus-kainan',[line({required_quantity:'2',item_name:'K'})]),j=normalizeOrderSource('tplus-kejia',[line({required_quantity:'3',item_name:'J'}),line({source_line_id:'2',item_code:'OTHER'}),line({source_line_id:'3',order_no:'OTHER'})]);
  expect(mergeOrderSources([e,k,j])).toMatchObject({crossConflicts:2,items:expect.arrayContaining([expect.objectContaining({source:'e10-main',required_quantity:'1',item_name:'E'})])});
  expect(mergeOrderSources([e,k,j]).items).toHaveLength(3);expect(mergeOrderSources([k,j]).items[0].source).toBe('tplus-kainan');expect(mergeOrderSources([e,j]).items[0].source).toBe('e10-main');expect(mergeOrderSources([j,k,e]).items[0].source).toBe('e10-main');
 });
 it('rejects malformed data, unknown state and reserved synthetic source keys',()=>{
  for(const patch of [{required_quantity:'1e3'},{order_date:'2026-02-30'},{header_close:'X'},{order_no:'虚拟订单'},{item_code:''}])expect(()=>normalizeOrderSource('e10-main',[line(patch)])).toThrow('ABNORMAL_ORDER_');
 });
 it('initializes precisely 15 distinct pairs / six majors and permits only exact recovered powder',()=>{
  expect(new Set(abnormalExpenseCategorySeeds.map(p=>JSON.stringify(p))).size).toBe(15);expect(new Set(abnormalExpenseCategorySeeds.map(p=>p[0])).size).toBe(6);
  expect(abnormalAllowsVirtual('粉末报废',['回收粉'])).toBe(true);for(const [m,s] of [['粉末报废',['回收粉','呆滞废粉']],['异常工时',['回收粉']],['粉末报废',[]]])expect(abnormalAllowsVirtual(m,s)).toBe(false);
 });
});
