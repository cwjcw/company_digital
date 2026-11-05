import { FinanceOrdersQueryService } from './finance-orders.query.service';
import { TableFilterRegistry } from '../../common/filtering/table-filter.registry';
import { financeMonthlyFields,financeRankingFields } from '@kdos/contracts';
const actor={tenantId:'SYN-T',userId:'0199e000-0000-7000-8000-000000000001',isSystemAdmin:true,permissions:['*']};
const repository=(query:any)=>({query,transaction:async(_t:string,work:any)=>work({query:(sql:string,p:any)=>sql.startsWith('SET LOCAL')?Promise.resolve([]):query(sql,p)})});
const ranked={total:2,rows:[{id:actor.userId,customerCode:'SYN-C',orderTotal:'0.30'}]};
describe('Finance dashboard performance without changing authorization or amounts',()=>{
 it('counts and pages one materialized authorized customer aggregate in one statement',async()=>{
  const query=jest.fn().mockResolvedValue([ranked]);const s=new FinanceOrdersQueryService(repository(query) as any,{} as any);
  expect(await s.ranking({year:2026,rankLimit:20},actor,{page:2,pageSize:100,sortField:'customerCode',sortOrder:'asc'})).toEqual({...ranked,page:2,pageSize:100});
  expect(query).toHaveBeenCalledTimes(1);const [sql,params]=query.mock.calls[0];expect(sql).toContain('grouped AS MATERIALIZED');expect(sql).toContain('selected AS MATERIALIZED');expect(sql).toContain('count(*)::integer FROM selected');expect(sql).toContain('ORDER BY order_total DESC,customer_code');expect(sql).toContain('record.tenant_id=$1');expect(params).toEqual(['SYN-T','2026',0,100]);
 });
 it('always caps the customer ranking at twenty and rejects requests for another range',async()=>{
  const query=jest.fn().mockResolvedValue([{total:30,rows:[]}]);const s=new FinanceOrdersQueryService(repository(query) as any,{} as any);
  expect((await s.ranking({year:2026},actor,{page:1,pageSize:100})).total).toBe(20);expect(query.mock.calls[0][1].slice(-2)).toEqual([20,0]);
  await expect(s.ranking({year:2026,rankLimit:0},actor,{page:1,pageSize:100})).rejects.toThrow('固定展示前20名');
 });
 it('intersects export with read scopes and still parameterizes search and aggregate filters',async()=>{
  const r='finance-e10-ranking',a={...actor,isSystemAdmin:false,permissions:['finance-e10-dashboard:*:read',...financeMonthlyFields.map(f=>`finance-e10-dashboard:${f.key}:read`),`${r}:*:read`,`${r}:*:export`,...financeRankingFields.map(f=>`${r}:${f.key}:read`)],tableDataScopes:[{resource:'finance-e10-dashboard',scope:'ALL'},{resource:r,scope:'CUSTOM',actions:['read'],rules:[{fieldKey:'customerCode',operator:'EQ',value:'SYN-READ'}]},{resource:r,scope:'CUSTOM',actions:['export'],rules:[{fieldKey:'customerCode',operator:'EQ',value:'SYN-EXPORT'}]}]};
  const query=jest.fn().mockResolvedValue([ranked]);const s=new FinanceOrdersQueryService(repository(query) as any,{} as any);
  await s.ranking({year:2026},a as any,{action:'export',search:"SYN' OR TRUE",filterGroup:{logic:'AND',rules:[{field:'orderTotal',operator:'gt',value:'0.10'}]}});
  const [sql,params]=query.mock.calls[0];expect(sql).not.toContain("SYN' OR TRUE");expect(params).toEqual(expect.arrayContaining(['SYN-READ','SYN-EXPORT',"%SYN' OR TRUE%",'0.10']));
 });
 it('does not let a list caller use export action to bypass missing export permission',async()=>{
  const r='finance-e10-ranking',a={...actor,isSystemAdmin:false,permissions:[`${r}:*:read`,...financeRankingFields.map(f=>`${r}:${f.key}:read`),'finance-e10-dashboard:*:read',...financeMonthlyFields.map(f=>`finance-e10-dashboard:${f.key}:read`)]};
  const query=jest.fn();await expect(new FinanceOrdersQueryService(repository(query) as any,{} as any).ranking({year:2026},a,{action:'export'})).rejects.toThrow();expect(query).not.toHaveBeenCalled();
 });
 it('limits the planner adjustment to the existing tenant transaction',async()=>{
  const manager={query:jest.fn().mockImplementation(async(sql:string)=>sql.startsWith('SET LOCAL')?[]:[{totals:{orders:0,customers:0,amount:'0'},groups:[],months:[],matrix:[],quality:null}])};
  const transaction=jest.fn(async(_t,fn)=>fn(manager));const s=new FinanceOrdersQueryService({transaction} as any,{} as any);const result=await s.dashboard({context:{year:2026}},actor);
  expect(transaction).toHaveBeenCalledWith('SYN-T',expect.any(Function));expect(manager.query.mock.calls[0][0]).toBe('SET LOCAL enable_mergejoin = off');expect(manager.query.mock.calls[1][0]).toBe('SET LOCAL enable_nestloop = off');expect(manager.query.mock.calls[3][0]).toContain('FROM finance_e10_order_monthly_movements');expect(result.months).toHaveLength(12);expect(result.totals.amount).toBe('0');
 });
 it('lets the dashboard skip unused administrator diagnostics while keeping the default response and amount query',async()=>{
  const calls:string[]=[];const manager={query:async(sql:string)=>{calls.push(sql);return sql.startsWith('SET LOCAL')?[]:[{totals:{orders:0,customers:0,amount:'0'},groups:[],months:[],matrix:[],quality:null}]}};
  const s=new FinanceOrdersQueryService({transaction:async(_t:string,fn:any)=>fn(manager)} as any,{} as any);
  await s.dashboard({context:{year:2026},includeQuality:false},actor);expect(calls[3]).toContain('FROM finance_e10_order_monthly_movements');expect(calls[3]).not.toContain('"excludedOrders"');
  await s.dashboard({context:{year:2026}},actor);expect(calls[7]).not.toContain('"excludedOrders"');
 });
 it('returns unqueried dashboard trend months as null instead of zero',async()=>{
  const manager={query:jest.fn().mockImplementation(async(sql:string)=>sql.startsWith('SET LOCAL')?[]:[{totals:{orders:1,customers:1,amount:'25.00'},groups:[],months:[{month:'2026-11',amount:'25.00',orders:1}],matrix:[],quality:null}])};
  const s=new FinanceOrdersQueryService({transaction:async(_t:string,fn:any)=>fn(manager)} as any,{} as any);const result=await s.dashboard({context:{year:2026,month:11}},actor);
  expect(result.months.find(x=>x.month==='2026-11')).toMatchObject({amount:'25.00'});expect(result.months.find(x=>x.month==='2026-10')).toMatchObject({amount:null,wan:null});
 });
 it('applies actual order-date bounds to both dashboard aggregates and customer ranking SQL',async()=>{
  const context={year:2026,month:11,orderDateFrom:'2026-10-01',orderDateTo:'2026-10-31'};
  const manager={query:jest.fn().mockImplementation(async(sql:string)=>sql.startsWith('SET LOCAL')?[]:[{totals:{orders:0,customers:0,amount:'0'},groups:[],months:[],matrix:[],quality:null}])};
  const dashboard=new FinanceOrdersQueryService({transaction:async(_t:string,fn:any)=>fn(manager)} as any,{} as any);
  await dashboard.dashboard({context},actor);const dashboardCall=manager.query.mock.calls.at(-1)!;
  expect(dashboardCall[0]).toContain('record.order_date>=$4::date AND record.order_date<=$5::date');expect(dashboardCall[1]).toEqual(['SYN-T','2026','11','2026-10-01','2026-10-31']);
  const query=jest.fn().mockResolvedValue([{total:0,rows:[]}]);const ranking=new FinanceOrdersQueryService(repository(query) as any,{} as any);
  await ranking.ranking({...context,rankLimit:20},actor,{page:1,pageSize:20});const [sql,params]=query.mock.calls[0];
  expect(sql).toContain('record.order_date>=$4::date AND record.order_date<=$5::date');expect(params).toEqual(['SYN-T','2026','11','2026-10-01','2026-10-31',20,0]);
 });
 it('uses the same materialized monthly view scan for count and page, with permission-filtered fields',async()=>{
  const query=jest.fn().mockResolvedValue([{total:1,rows:[{id:'SYN-ID',customerCode:'SYN-C',orderDate:'2026-11-02',orderTotal:'0.30'}]}]);const registry=new TableFilterRegistry();
  const s=new FinanceOrdersQueryService(repository(query) as any,registry as any);s.onModuleInit();const source=registry.get('finance-e10-monthly');
  const result=await source.listRows!({actor,page:1,pageSize:20,search:'',context:{},fieldKeys:['customerCode','orderDate','orderTotal','yearMonth','businessRemark'],filterGroup:{logic:'AND',rules:[{field:'orderDate',operator:'gte',value:'2026-11-01'}]}} as any);
  expect(result).toEqual({total:1,rows:[{id:'SYN-ID',customerCode:'SYN-C',orderDate:'2026-11-02',orderTotal:'0.30'}]});
  expect(query).toHaveBeenCalledTimes(1);const [sql,params]=query.mock.calls[0];expect(sql).toContain('selected AS MATERIALIZED');expect(sql).toContain('count(*)::integer FROM selected');expect(sql).toContain('jsonb_agg(row_to_json(p))');expect(sql).toContain('SELECT "id","customerCode","orderDate","orderTotal","yearMonth","businessRemark" FROM selected');expect(sql).toContain('record.order_date::text::date');expect(sql).toContain('record.order_total::text AS "orderTotal"');expect(sql).not.toContain('"__stable_source_database" FROM selected');expect(params).toEqual(['SYN-T','2026-11-01',20,0]);
 });
 it('sorts numeric monthly amounts numerically while returning exact amount strings',async()=>{
  const query=jest.fn().mockResolvedValue([{total:2,rows:[]}]),registry=new TableFilterRegistry();const s=new FinanceOrdersQueryService(repository(query) as any,registry as any);s.onModuleInit();
  await registry.get('finance-e10-monthly').listRows!({actor,page:1,pageSize:20,search:'',context:{},fieldKeys:['orderTotal'],sortField:'orderTotal',sortOrder:'desc'} as any);
  const [sql]=query.mock.calls[0];expect(sql).toContain('record.order_total AS "__sort_value"');expect(sql).toContain('ORDER BY "__sort_value" DESC NULLS LAST');expect(sql).toContain('record.order_total::text AS "orderTotal"');
 });
 it('returns only a tenant-local freshness hash and denies callers without dashboard read',async()=>{
  const query=jest.fn().mockResolvedValue([{revision:'synthetic-revision'}]);const s=new FinanceOrdersQueryService(repository(query) as any,{} as any);const initial=await s.revision(actor);expect(initial.revision).toMatch(/^[a-f0-9]{64}$/);expect(initial.accessRevision).toMatch(/^[a-f0-9]{64}$/);const [sql,p]=query.mock.calls[0];expect(p).toEqual(['SYN-T']);expect(sql.match(/tenant_id=\$1/g)).toHaveLength(3);expect(sql).toContain("status='SUCCESS'");expect(sql).toContain('version::text');expect(sql).toContain('updated_at::text');
  const altered=await s.revision({...actor,tableDataScopes:[{resource:'finance-e10-dashboard',scope:'CUSTOM',rules:[{fieldKey:'customerCode',operator:'EQ',value:'SYN-OTHER'}]}]});expect(altered.accessRevision).not.toBe(initial.accessRevision);expect(altered.revision).not.toBe(initial.revision);await expect(s.revision({...actor,isSystemAdmin:false,permissions:[]})).rejects.toThrow();expect(query).toHaveBeenCalledTimes(2);
 });
 it('exposes a monthly freshness token using monthly read permission without requiring dashboard permission',async()=>{
  const query=jest.fn().mockResolvedValue([{revision:'synthetic-monthly-revision'}]);const s=new FinanceOrdersQueryService(repository(query) as any,{} as any);const monthlyActor={tenantId:'SYN-T',userId:'SYN-U',isSystemAdmin:false,permissions:['finance-e10-monthly:*:read']};
  const result=await s.monthlyRevision(monthlyActor as any);expect(result.revision).toMatch(/^[a-f0-9]{64}$/);expect(result.accessRevision).toMatch(/^[a-f0-9]{64}$/);expect(query).toHaveBeenCalledWith(expect.stringContaining('finance_e10_movement_runs'),['SYN-T']);
  await expect(s.monthlyRevision({...monthlyActor,permissions:[]} as any)).rejects.toThrow();expect(query).toHaveBeenCalledTimes(1);
 });
});
