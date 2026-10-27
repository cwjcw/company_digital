import { DataSource } from 'typeorm';
import original from '../../data-source';
import { TableFilterRegistry } from '../../common/filtering/table-filter.registry';
import { ReviewDueDateQueryService } from './review-due-date.query.service';
import { reviewDueDateCreateFields, reviewDueDateFields } from '@kdos/contracts';
import { MasterPlanApplicationService } from './master-plan.application.service';
import type { MasterPlanActor } from './master-plan.types';

const actor:MasterPlanActor={tenantId:'TEST',userId:'0199eb00-0000-7000-8000-000000000099',username:'fixture',permissions:['*'],tableDataScopes:[],requestId:'fixture',source:'web'};
it('preserves allocation import dates and excludes derived review dates from writable/template fields',async()=>{
  const app=new MasterPlanApplicationService({query:jest.fn().mockResolvedValue([])} as never,{} as never);
  await expect(app.validateImportUpdates('mps-order-allocations',[{row:2,id:null,expectedVersion:null,values:{orderNumber:'SO',itemCode:'ITEM',allocatedQuantity:'1',divisionId:actor.userId,orderDate:'2026-10-01'}}],actor)).resolves.toEqual([]);
  expect(reviewDueDateCreateFields).toHaveLength(9);
  expect(reviewDueDateFields.filter(f=>['orderDate','productReviewDueDate'].includes(f.key)).every(f=>!f.editable)).toBe(true);
});

const integration=process.env.KDOS_POSTGRES_INTEGRATION==='true'?describe:describe.skip;
/** The entire data set is a read-only CTE. No source or business table is read or written. */
integration('Review dates live monthly projections (synthetic PostgreSQL CTE)',()=>{
  let db:DataSource,service:ReviewDueDateQueryService;
  let orderDate='2026-10-01';
  const division='0199eb00-0000-7000-8000-000000000001',other='0199eb00-0000-7000-8000-000000000002';
  beforeAll(async()=>{
    db=new DataSource({...original.options,entities:[],migrations:[],subscribers:[]});await db.initialize();
    const adapter={transaction:async(_level:unknown,work:(m:unknown)=>Promise<unknown>)=>db.transaction('REPEATABLE READ',async m=>work({query:(sql:string,p:unknown[])=>{
      const cte=`WITH mps_monthly_plans(tenant_id,order_number,item_code,division_id,order_date,preproduction_review_date) AS (VALUES
        ('TEST','MATCH','I','${division}'::uuid,'${orderDate}'::date,'2026-11-01'::date),
        ('FOREIGN','MATCH','I','${division}'::uuid,'2000-01-01'::date,'2000-01-01'::date),
        ('TEST','CONFLICT','I','${division}'::uuid,'2026-01-01'::date,'2026-02-01'::date),
        ('TEST','CONFLICT','I','${division}'::uuid,'2026-01-02'::date,'2026-02-02'::date)),
        mps_review_due_dates AS (SELECT ('0199eb00-0000-7000-8000-'||lpad(n::text,12,'0'))::uuid id,1 version,'TEST'::text tenant_id,
          CASE WHEN n=4 THEN '${other}'::uuid ELSE '${division}'::uuid END division_id,
          CASE WHEN n=3 THEN 'MISSING' WHEN n=5 THEN 'CONFLICT' ELSE 'MATCH' END order_number,
          n::text batch_number,'I'::text drawing_number,NULL::text inspection_time_name,'2026-12-01'::date inbound_date,10::numeric quantity,0 change_count,NULL::date previous_inbound_date,
          NULL::uuid created_by,NULL::timestamptz created_at,NULL::uuid updated_by,NULL::timestamptz updated_at FROM generate_series(1,5) n),
        organization_units AS (SELECT '${division}'::uuid id,'事业部甲'::text name)
      `;
      return m.query(sql.includes('FROM mps_review_due_dates')?cte+sql:sql,p);
    }}))};
    const registry=new TableFilterRegistry();service=new ReviewDueDateQueryService(adapter as never,registry,{listEnabled:async()=>[]} as never);service.onModuleInit();
  });
  afterAll(async()=>{if(db?.isInitialized)await db.destroy();});
  it('matches tenant/order/item/division; repeated batches retain rows; missing/conflicting sources stay blank',async()=>{
    const r=await service.list({},actor);expect(r.total).toBe(5);
    for(const row of r.rows){
      if(['1','2'].includes(String(row.batchNumber)))expect(row).toMatchObject({orderDate:'2026-10-01',productReviewDueDate:'2026-11-01'});
      else expect(row).toMatchObject({orderDate:null,productReviewDueDate:null});
    }
  });
  it('reads source changes immediately and supports derived date filters/sorting without changing totals',async()=>{
    orderDate='2026-10-02';
    const r=await service.list({sortField:'orderDate',sortOrder:'desc',filterGroup:{logic:'AND',rules:[{field:'orderDate',operator:'eq',value:orderDate}]}},actor);
    expect(r.total).toBe(2);expect(r.rows.every((row:Record<string,unknown>)=>row.orderDate===orderDate)).toBe(true);
  });
  it('denies hidden date filtering and omits hidden date projection',async()=>{
    const reader={...actor,permissions:['mps-review-due-dates:*:read','mps-review-due-dates:orderNumber:read'],tableDataScopes:[{resource:'mps-review-due-dates',scope:'ALL'}]};
    const r=await service.list({},reader);expect(r.rows[0]).not.toHaveProperty('orderDate');
    await expect(service.list({sortField:'orderDate'},reader)).rejects.toMatchObject({status:403});
  });
});
