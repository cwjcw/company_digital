import { FinanceOrdersQueryService } from './finance-orders.query.service';
import { financeMonthlyFields,financeRankingFields } from '@kdos/contracts';
const actor={tenantId:'SYN-T',userId:'0199e000-0000-7000-8000-000000000001',isSystemAdmin:true,permissions:['*']};
const ranked={total:2,rows:[{id:actor.userId,customerCode:'SYN-C',orderTotal:'0.30'}]};
describe('Finance dashboard performance without changing authorization or amounts',()=>{
 it('counts and pages one materialized authorized customer aggregate in one statement',async()=>{
  const query=jest.fn().mockResolvedValue([ranked]);const s=new FinanceOrdersQueryService({query} as any,{} as any);
  expect(await s.ranking({year:2026},actor,{page:2,pageSize:100,sortField:'customerCode',sortOrder:'asc'})).toEqual({...ranked,page:2,pageSize:100});
  expect(query).toHaveBeenCalledTimes(1);const [sql,params]=query.mock.calls[0];expect(sql).toContain('grouped AS MATERIALIZED');expect(sql).toContain('selected AS MATERIALIZED');expect(sql).toContain('count(*)::integer FROM selected');expect(sql).toContain('ORDER BY customer_code ASC');expect(sql).toContain('record.tenant_id=$1');expect(params).toEqual(['SYN-T','2026',100,100]);
 });
 it('keeps rankLimit and page bounds in the same counted dataset',async()=>{
  const query=jest.fn().mockResolvedValue([{total:30,rows:[]}]);const s=new FinanceOrdersQueryService({query} as any,{} as any);
  expect((await s.ranking({year:2026,rankLimit:10},actor,{page:2,pageSize:100})).total).toBe(10);expect(query.mock.calls[0][1].slice(-2)).toEqual([0,100]);
 });
 it('intersects export with read scopes and still parameterizes search and aggregate filters',async()=>{
  const r='finance-e10-ranking',a={...actor,isSystemAdmin:false,permissions:['finance-e10-dashboard:*:read',...financeMonthlyFields.map(f=>`finance-e10-dashboard:${f.key}:read`),`${r}:*:read`,`${r}:*:export`,...financeRankingFields.map(f=>`${r}:${f.key}:read`)],tableDataScopes:[{resource:'finance-e10-dashboard',scope:'ALL'},{resource:r,scope:'CUSTOM',actions:['read'],rules:[{fieldKey:'customerCode',operator:'EQ',value:'SYN-READ'}]},{resource:r,scope:'CUSTOM',actions:['export'],rules:[{fieldKey:'customerCode',operator:'EQ',value:'SYN-EXPORT'}]}]};
  const query=jest.fn().mockResolvedValue([ranked]);const s=new FinanceOrdersQueryService({query} as any,{} as any);
  await s.ranking({year:2026},a as any,{action:'export',search:"SYN' OR TRUE",filterGroup:{logic:'AND',rules:[{field:'orderTotal',operator:'gt',value:'0.10'}]}});
  const [sql,params]=query.mock.calls[0];expect(sql).not.toContain("SYN' OR TRUE");expect(params).toEqual(expect.arrayContaining(['SYN-READ','SYN-EXPORT',"%SYN' OR TRUE%",'0.10']));
 });
 it('does not let a list caller use export action to bypass missing export permission',async()=>{
  const r='finance-e10-ranking',a={...actor,isSystemAdmin:false,permissions:[`${r}:*:read`,...financeRankingFields.map(f=>`${r}:${f.key}:read`),'finance-e10-dashboard:*:read',...financeMonthlyFields.map(f=>`finance-e10-dashboard:${f.key}:read`)]};
  const query=jest.fn();await expect(new FinanceOrdersQueryService({query} as any,{} as any).ranking({year:2026},a,{action:'export'})).rejects.toThrow();expect(query).not.toHaveBeenCalled();
 });
 it('limits the planner adjustment to the existing tenant transaction',async()=>{
  const manager={query:jest.fn().mockImplementation(async(sql:string)=>sql.startsWith('SET LOCAL')?[]:[{totals:{orders:0,customers:0,amount:'0'},groups:[],months:[],matrix:[],quality:null}])};
  const transaction=jest.fn(async(_t,fn)=>fn(manager));const s=new FinanceOrdersQueryService({transaction} as any,{} as any);const result=await s.dashboard({context:{year:2026}},actor);
  expect(transaction).toHaveBeenCalledWith('SYN-T',expect.any(Function));expect(manager.query.mock.calls[0][0]).toBe('SET LOCAL enable_mergejoin = off');expect(manager.query.mock.calls[1][0]).toContain('FROM finance_e10_monthly');expect(result.months).toHaveLength(12);expect(result.totals.amount).toBe('0');
 });
 it('lets the dashboard skip unused administrator diagnostics while keeping the default response and amount query',async()=>{
  const calls:string[]=[];const manager={query:async(sql:string)=>{calls.push(sql);return sql.startsWith('SET LOCAL')?[]:[{totals:{orders:0,customers:0,amount:'0'},groups:[],months:[],matrix:[],quality:null}]}};
  const s=new FinanceOrdersQueryService({transaction:async(_t:string,fn:any)=>fn(manager)} as any,{} as any);
  await s.dashboard({context:{year:2026},includeQuality:false},actor);expect(calls[1]).toContain('FROM finance_e10_monthly');expect(calls[1]).not.toContain('"excludedOrders"');
  await s.dashboard({context:{year:2026}},actor);expect(calls[3]).toContain('"excludedOrders"');
 });
 it('returns only a tenant-local freshness hash and denies callers without dashboard read',async()=>{
  const query=jest.fn().mockResolvedValue([{revision:'synthetic-revision'}]);const s=new FinanceOrdersQueryService({query} as any,{} as any);expect(await s.revision(actor)).toEqual({revision:'synthetic-revision'});const [sql,p]=query.mock.calls[0];expect(p).toEqual(['SYN-T']);expect(sql.match(/tenant_id=\$1/g)).toHaveLength(2);expect(sql).toContain("status='SUCCESS'");expect(sql).toContain('version::text');expect(sql).toContain('updated_at::text');
  await expect(s.revision({...actor,isSystemAdmin:false,permissions:[]})).rejects.toThrow();expect(query).toHaveBeenCalledTimes(1);
 });
});
