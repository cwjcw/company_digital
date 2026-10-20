import { financeOrderEligible } from './finance-order-eligibility';
import { registeredOrderBy, TableFilterRegistry } from '../../common/filtering/table-filter.registry';
import { FinanceOrdersQueryService } from './finance-orders.query.service';
import { FinanceE10BusinessEligibility1722920099000 } from '../../migrations/1722920099000-FinanceE10BusinessEligibility';

describe('finance business eligibility and stable default ordering',()=>{
 it.each(['Y',' Y '])('accepts only approved normal documents (%s)',approved=>{
  expect(financeOrderEligible('销售订单',approved)).toBe(true);
  expect(financeOrderEligible('材料销售单',approved)).toBe(false);
 });
 it.each(['N','V','',null,undefined])('rejects non-approved %s',approved=>expect(financeOrderEligible('销售订单',approved)).toBe(false));
 it.each(['finance-e10-lines','finance-e10-monthly'])('shares date order and stable unique ties between list and Excel for %s',resource=>{
  const registry=new TableFilterRegistry();new FinanceOrdersQueryService({} as never,registry).onModuleInit();const source=registry.get(resource);
  expect(registeredOrderBy(source,undefined,undefined,()=>true)).toMatch(/^record.order_date::text ASC NULLS LAST,record.source_database ASC,record.source_order_id ASC/);
  expect(registeredOrderBy(source,'record.order_no','desc',()=>true)).toMatch(/^record.order_no DESC NULLS LAST,record.source_database ASC/);
  expect(registeredOrderBy(source,undefined,undefined,()=>false)).toMatch(/^record.id ASC/);
  expect(registeredOrderBy(source,undefined,undefined,()=>true)).toContain('record.id ASC');
 });
 it('changes only derived views and keeps historical rows and existing closure conditions',async()=>{
  const query=jest.fn();await new FinanceE10BusinessEligibility1722920099000().up({query} as never);const sql=String(query.mock.calls[0][0]);
  expect(sql).toContain("coalesce(btrim(payload->>'approved'),'')='Y'");expect(sql).toContain("payload->>'docType')='材料销售单'");
  expect(sql).toContain("source.payload->>'headerCloseCode'='1'");expect(sql).toContain("source.payload->>'hasSpecifiedCloseSchedule'");
  expect(sql).toContain('qualification.business_remark');expect(sql).toContain('e.included AND coalesce(q.eligible,false) AS included');
  expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE|DROP|ALTER TABLE)\b/);
 });
 it('uses the tenant-local hash path for annual monthly rows, candidates and Excel without changing their SQL or scope',async()=>{
  const query=jest.fn().mockResolvedValue([{id:'SYN'}]),manager={query};
  const repository={query:jest.fn(),transaction:jest.fn(async(_tenant,run)=>run(manager))};
  const registry=new TableFilterRegistry();new FinanceOrdersQueryService(repository as never,registry).onModuleInit();
  const sql="SELECT id FROM finance_e10_monthly record WHERE tenant_id=$1 AND year_month LIKE $2 ORDER BY order_date,source_order_id,id LIMIT $3";
  const params=['TENANT-A','2026%',50];
  expect(await registry.get('finance-e10-monthly').runQuery!(sql,params)).toEqual([{id:'SYN'}]);
  expect(repository.transaction).toHaveBeenCalledWith('TENANT-A',expect.any(Function));
  expect(query.mock.calls).toEqual([['SET LOCAL enable_mergejoin = off'],['SET LOCAL enable_nestloop = off'],[sql,params]]);
  expect(repository.query).not.toHaveBeenCalled();
  await registry.get('finance-e10-lines').runQuery!('SELECT id FROM finance_e10_raw WHERE tenant_id=$1',['TENANT-A']);
  expect(repository.query).toHaveBeenCalledWith('SELECT id FROM finance_e10_raw WHERE tenant_id=$1',['TENANT-A']);
 });
});
