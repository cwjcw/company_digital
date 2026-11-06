import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MasterPlanController } from './master-plan.controller';
import { MasterPlanQueryService } from './master-plan.query.service';
import { AuthGuard } from '../../auth';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { discoverMigrationFiles, phaseAMigrationFiles } from '../../migration-files';
import { MasterPlanSyncService } from './master-plan.sync.service';
import { MasterPlanApplicationService } from './master-plan.application.service';
import { MasterPlanDemandLinkService } from './master-plan.demand-link.service';
import { MasterPlanLifecycleService } from './master-plan.lifecycle.service';
import { reconcileMonthlyBasePlans } from './master-plan.monthly-base';
import { ReviewDueDateApplicationService } from './review-due-date.application.service';
import type { MasterPlanActor } from './master-plan.types';
import { MpsDemandLinks1722920121000 as Links } from '../../migrations/1722920121000-MpsDemandLinks';
import { MpsPlanLifecycle1722920120000 as Lifecycle } from '../../migrations/1722920120000-MpsPlanLifecycle';

const integration=process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET?describe:describe.skip;
const tenant='UNIFIED-SYNTHETIC',user='0199be00-0000-7000-8000-000000000001',division='0199be00-0000-7000-8000-000000000002';
const actor=():MasterPlanActor=>({tenantId:tenant,userId:user,username:'合成关联用户',permissions:['*'],tableDataScopes:[],isSystemAdmin:true,requestId:randomUUID(),source:'web'});

integration('round1: real PG18 full 117 baseline → strict 118/119 → independent 121 → late 120',()=>{
  let db:DataSource,sync:MasterPlanSyncService,app:MasterPlanApplicationService,links:MasterPlanDemandLinkService;
  const directory={listEnabled:async()=>[{id:division,name:'事业三部',path:['凯南','事业三部'],pathLabel:'凯南/事业三部'}],resolve:()=>({id:division,name:'事业三部'})};
  const run=(key:string)=>sync.run(tenant,key,'MANUAL',user,'合成用户',randomUUID());
  const allocate=(qty=100,item='SYN-ITEM')=>app.create('mps-order-allocations',{divisionId:division,orderNumber:'SYN-ORDER',itemCode:item,itemName:'合成品项',customerCode:'SYN-CUSTOMER',allocatedQuantity:qty,orderStatus:'已审核',orderDate:'2026-11-01'},actor());
  const createBase=(qty=60,item='SYN-ITEM')=>app.create('mps-base-plans',{divisionId:division,orderNumber:'SYN-ORDER',itemCode:item,itemName:'合成品项',plannedQuantity:qty,latestCustomerDueDate:'2026-12-20',latestReviewDueDate:'2026-12-01',productAttribute:'五金',surfaceNature:'烤漆',manufacturingMethod:'自制'},actor());
  const parent=async(item='SYN-ITEM')=>(await db.query('SELECT * FROM mps_monthly_plans WHERE tenant_id=$1 AND item_code=$2',[tenant,item]))[0];
  const latest=async(table:string,id:string)=>(await db.query(`SELECT * FROM ${table} WHERE id=$1`,[id]))[0];
  const facts=()=>db.query('SELECT * FROM mps_process_reports ORDER BY id');
  const structure=()=>db.query('SELECT id,weekly_plan_id,process_code,sequence,cycle_days,execution_enabled FROM mps_weekly_process_plans ORDER BY id');
  const bind=(resource:string,row:any,m:any,key=randomUUID())=>links.bind(resource,row.id,{demandId:m.id,expectedVersion:row.version,expectedDemandVersion:m.version,idempotencyKey:key,reason:'合成数据核实首次关联'},actor());
  beforeAll(async()=>{
    const socket=process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET!;
    if(!socket.endsWith('/test/mps_sync_reliability/pg_socket'))throw Error('Only network-none isolated test socket');
    const common={type:'postgres' as const,host:socket,username:'postgres',entities:[],logging:false as const};
    const admin=new DataSource({...common,database:'postgres'});await admin.initialize();
    try{await admin.query('DROP DATABASE IF EXISTS mps_unified_round1_test WITH (FORCE)');await admin.query('CREATE DATABASE mps_unified_round1_test');}finally{await admin.destroy();}
    const files=discoverMigrationFiles(path.join(__dirname,'../../migrations'));
    db=new DataSource({...common,database:'mps_unified_round1_test',migrations:files.filter(f=>Number(path.basename(f).slice(0,13))<=1722920117000)});
    await db.initialize();await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    expect(await db.runMigrations({transaction:'all'})).toHaveLength(117);
    await db.destroy();
    db=new DataSource({...common,database:'mps_unified_round1_test',migrations:phaseAMigrationFiles(path.join(__dirname,'../../migrations'))});await db.initialize();
    expect((await db.runMigrations({transaction:'all'})).map(m=>m.name)).toEqual(['MpsSyncLeases1722920118000','MpsExecutionFactProtection1722920119000']);
    await db.query("INSERT INTO users(id,tenant_id,username,display_name,password_hash)VALUES($1,$2,'synthetic-unified','合成用户','invalid-synthetic-hash')",[user,tenant]);
    await db.query("INSERT INTO organization_units(id,name,level)VALUES($1,'事业三部',1)",[division]);
    for(const key of ['erp-orders','plan-projections','shipping-to-base','base-to-weekly','inbound-allocation','execution-rollup'])await db.query("INSERT INTO mps_sync_configs(tenant_id,sync_key,name,enabled,interval_minutes,created_by,updated_by)VALUES($1,$2,'合成任务',true,30,$3,$3)ON CONFLICT DO NOTHING",[tenant,key,user]);
    sync=new MasterPlanSyncService(db);app=new MasterPlanApplicationService(db,{processOutbox:async()=>0,refreshWeeklyExecution:sync.refreshWeeklyExecution.bind(sync)} as never);links=new MasterPlanDemandLinkService(db);
    process.env.JWT_ACCESS_SECRET='isolated-round1-signing-key';process.env.KDOS_DEFAULT_TENANT_CODE=tenant;
  },180000);
  afterAll(async()=>{if(db?.isInitialized)await db.destroy();});
  it('A has no120/no121: lifecycle returns business409, normal allocation/base/week/report and six scheduled jobs survive',async()=>{
    const l=new MasterPlanLifecycleService(db);
    expect(await l.availability('mps-base-plans')).toMatchObject({schemaReady:false,previewAvailable:false});
    await expect(l.preview('mps-base-plans',randomUUID(),'CANCEL',actor())).rejects.toMatchObject({status:409});
    await expect(l.preview('mps-base-plans',randomUUID(),'HOLD',actor())).rejects.toMatchObject({status:409});
    expect(await links.availability('mps-base-plans',actor())).toMatchObject({schemaReady:false});
    const providers:Record<string,unknown>={MasterPlanApplicationService:app,MasterPlanQueryService:new MasterPlanQueryService(db,directory as never),MasterPlanSyncService:sync,MasterPlanLifecycleService:l,MasterPlanDemandLinkService:links};
    const mod=await Test.createTestingModule({controllers:[MasterPlanController],providers:Reflect.getMetadata('design:paramtypes',MasterPlanController).map((token:any)=>({provide:token,useValue:providers[token.name]??{}}))}).overrideGuard(AuthGuard).useValue({canActivate:(ctx:any)=>{const req=ctx.switchToHttp().getRequest();req.user={sub:user,isSystemAdmin:true,permissions:['*'],tableDataScopes:[]};req.requestId=randomUUID();return true;}}).compile();
    const http=mod.createNestApplication({logger:false});await http.init();
    try {
      const meta=await request(http.getHttpServer()).get('/master-plan-system/resources/mps-base-plans/meta');expect(meta.status).toBe(200);expect(meta.body.lifecycle.schemaReady).toBe(false);
      for(const operation of ['HOLD','CANCEL']) {
        const r=await request(http.getHttpServer()).post(`/master-plan-system/resources/mps-base-plans/${randomUUID()}/lifecycle/preview`).send({operation});expect(r.status).toBe(409);expect(r.body.code).toBe('MPS_LIFECYCLE_SCHEMA_UNAVAILABLE');
      }
      const r=await request(http.getHttpServer()).post(`/master-plan-system/resources/mps-base-plans/${randomUUID()}/lifecycle/confirm`).send({operation:'HOLD',expectedVersion:1,reason:'合成请求',idempotencyKey:randomUUID(),previewToken:'not-a-token'});expect(r.status).toBe(409);expect(r.body.code).toBe('MPS_LIFECYCLE_SCHEMA_UNAVAILABLE');
    }finally{await http.close();}

    const a=await allocate(10,'SYN-A');expect((await run('plan-projections')).status).toBe('SUCCESS');
    expect((await run('shipping-to-base')).status).toBe('SUCCESS');
    const [b]=await db.query("SELECT * FROM mps_base_plans WHERE item_code='SYN-A'");
    await app.update('mps-base-plans',b.id,{expectedVersion:b.version,latestCustomerDueDate:'2026-12-20',latestReviewDueDate:'2026-12-01',productAttribute:'五金',surfaceNature:'烤漆',manufacturingMethod:'自制'},actor());
    expect((await run('base-to-weekly')).status).toBe('SUCCESS');
    const [w]=await db.query('SELECT * FROM mps_weekly_plans WHERE base_plan_id=$1',[b.id]);
    await app.create('mps-process-reports',{weeklyPlanId:w.id,processCode:'bending',productionDate:'2026-11-01',productionQuantity:2},actor());
    const before=await facts();const bs=await latest('mps_base_plans',b.id);
    await app.update('mps-base-plans',b.id,{expectedVersion:bs.version,plannedQuantity:12},actor());await run('base-to-weekly');expect(await facts()).toEqual(before);
    for(const key of ['erp-orders','plan-projections','shipping-to-base','base-to-weekly','inbound-allocation','execution-rollup'])expect((await run(key)).status).toBe('SUCCESS');
    await db.query("UPDATE mps_sync_configs SET last_started_at=clock_timestamp()-interval '31 minutes' WHERE tenant_id=$1",[tenant]);
    expect(await (sync as any).runner.dueConfigurations(tenant)).toHaveLength(6);await sync.runDue();
    const configs=await db.query('SELECT sync_key,status,interval_minutes FROM mps_sync_configs WHERE tenant_id=$1',[tenant]);expect(configs).toHaveLength(6);expect(configs.every((c:any)=>c.status==='SUCCESS'&&c.interval_minutes===30)).toBe(true);expect(await facts()).toEqual(before);
    await expect(bind('mps-order-allocations',a,await parent('SYN-A'))).rejects.toMatchObject({status:409});
  },60000);
  it('applies121 independently without120, keeps every old ID/fact/NULL and real ledger',async()=>{
    const before=await facts(),bases=await db.query('SELECT id,version,planned_quantity FROM mps_base_plans ORDER BY id');
    const migrated=new DataSource({...db.options,migrations:[Links]});await migrated.initialize();try{expect((await migrated.runMigrations()).map(m=>m.name)).toEqual(['MpsDemandLinks1722920121000']);}finally{await migrated.destroy();}
    expect(await facts()).toEqual(before);expect(await db.query('SELECT id,version,planned_quantity FROM mps_base_plans ORDER BY id')).toEqual(bases);
    expect((await db.query('SELECT count(*)::int n FROM mps_base_plans WHERE monthly_plan_id IS NOT NULL'))[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int n FROM migrations WHERE name='MpsPlanLifecycle1722920120000'"))[0].n).toBe(0);
  });
  it('new allocation links immediately; two sources aggregate once and keep one monthlyUUID',async()=>{
    const a=await allocate(60);const m=await parent();expect(a.monthly_plan_id).toBe(m.id);
    const b=await allocate(40);expect(b.monthly_plan_id).toBe(m.id);expect((await parent()).required_quantity).toBe('100.0000');
    await run('plan-projections');expect((await parent()).id).toBe(m.id);expect((await parent()).required_quantity).toBe('100.0000');
  });
  it('new imported source rows link once per group and repeated import receipt does not duplicate demand',async()=>{
    const batch={id:randomUUID(),worksheet:'合成来源',fileHash:'a'.repeat(64)};
    const rows=[60,40].map((quantity,i)=>({row:i+2,id:null,expectedVersion:null,values:{divisionId:division,orderNumber:'SYN-ORDER',itemCode:'SYN-IMPORT',customerCode:'SYN-CUSTOMER',allocatedQuantity:quantity,orderStatus:'已审核'}}));
    const first=await app.importUpdates('mps-order-allocations',rows,batch.fileHash,actor(),undefined,batch);expect(first.created).toBe(2);
    const repeat=await app.importUpdates('mps-order-allocations',rows,batch.fileHash,actor(),undefined,batch);expect(repeat.repeated).toBe(true);
    const m=await parent('SYN-IMPORT'),sources=await db.query("SELECT monthly_plan_id FROM mps_order_allocations WHERE item_code='SYN-IMPORT'");expect(sources).toHaveLength(2);expect(sources.every((r:any)=>r.monthly_plan_id===m.id)).toBe(true);expect(m.required_quantity).toBe('100.0000');
    const [old]=await db.query("SELECT monthly_plan_id FROM mps_order_allocations WHERE item_code='SYN-A'");expect(old.monthly_plan_id).toBeNull();
  });
  it('60+40 batches share demand; demand120 preserves quantities, IDs, creates no third batch and reports20 gap',async()=>{
    const b1=await createBase(60),b2=await createBase(40),m=await parent();expect(b1.monthly_plan_id).toBe(m.id);expect(b2.monthly_plan_id).toBe(m.id);
    await run('shipping-to-base');await run('base-to-weekly');
    await allocate(20);expect((await parent()).required_quantity).toBe('120.0000');
    expect((await run('shipping-to-base')).status).toBe('SUCCESS');
    const rows=await db.query("SELECT id,planned_quantity FROM mps_base_plans WHERE item_code='SYN-ITEM' ORDER BY planned_quantity");expect(rows).toEqual([{id:b2.id,planned_quantity:'40.0000'},{id:b1.id,planned_quantity:'60.0000'}]);
    const info=await links.info('mps-base-plans',b1.id,actor());expect(info.balance).toMatchObject({difference:'20.0000',allocated:'100.0000',unallocated:'20.0000'});
    const stats=await db.transaction(mgr=>reconcileMonthlyBasePlans(mgr,tenant,user,'合成用户',[m.id]));expect(stats.metrics.base_multi_batch).toBe(1);expect(stats.balance.unallocated).toBe('20.0000');
  });
  it('executed historical NULL base can bind once, preserves reports, weekly and locked process structure',async()=>{
    const [b]=await db.query("SELECT * FROM mps_base_plans WHERE item_code='SYN-A'");const m=await parent('SYN-A');const f=await facts(),t=await structure(),w=await db.query('SELECT * FROM mps_weekly_plans ORDER BY id');
    await expect(db.query('UPDATE mps_base_plans SET monthly_plan_id=$2 WHERE id=$1',[b.id,m.id])).rejects.toMatchObject({driverError:{constraint:'ck_mps_demand_command'}});
    const key=randomUUID(),r=await bind('mps-base-plans',b,m,key);expect(r.demandId).toBe(m.id);expect((await bind('mps-base-plans',b,m,key)).repeated).toBe(true);
    expect(await facts()).toEqual(f);expect(await structure()).toEqual(t);expect(await db.query('SELECT * FROM mps_weekly_plans ORDER BY id')).toEqual(w);
    await expect(bind('mps-base-plans',await latest('mps_base_plans',b.id),m)).rejects.toMatchObject({status:409});
    await expect(db.query('UPDATE mps_base_plans SET monthly_plan_id=NULL WHERE id=$1',[b.id])).rejects.toMatchObject({driverError:{constraint:'ck_mps_demand_rebind'}});
  });
  it('rejects wrong tenant, mismatched identity, unauthorized actor, hidden fields and NONE data scope',async()=>{
    const a=await allocate(1,'SYN-CONFLICT'),b=await createBase(1,'SYN-CONFLICT'),m=await parent();
    // Explicit nonempty links cannot be rebound by SQL or ordinary generic edit.
    await expect(db.query('UPDATE mps_base_plans SET monthly_plan_id=$2 WHERE id=$1',[b.id,m.id])).rejects.toBeDefined();
    await expect(app.update('mps-base-plans',b.id,{expectedVersion:b.version,monthlyPlanId:m.id},actor())).rejects.toBeDefined();
    const body={demandId:m.id,expectedVersion:a.version,expectedDemandVersion:m.version,idempotencyKey:randomUUID(),reason:'合成拒绝测试'};
    await expect(links.bind('mps-order-allocations',a.id,body,{...actor(),isSystemAdmin:false,permissions:[]})).rejects.toMatchObject({status:403});
    await expect(links.info('mps-base-plans',b.id,{...actor(),tenantId:'OTHER-SYNTHETIC'})).rejects.toMatchObject({status:404});
    const employee={...actor(),isSystemAdmin:false,permissions:['mps-demand-links:*:update','mps-base-plans:*:read','mps-base-plans:*:update','mps-monthly-plans:*:read'],tableDataScopes:[]};
    await expect(links.info('mps-base-plans',b.id,employee)).rejects.toMatchObject({status:403});
    const scopesActor:MasterPlanActor={...employee,permissions:[...employee.permissions,...['mps-base-plans','mps-monthly-plans'].flatMap(resource=>['orderNumber','itemCode','divisionId'].map(field=>`${resource}:${field}:read`))],tableDataScopes:[{resource:'mps-base-plans',scope:'NONE'},{resource:'mps-monthly-plans',scope:'ALL'}]};
    await expect(links.info('mps-base-plans',b.id,scopesActor)).rejects.toMatchObject({status:404});
    await expect(links.info('mps-base-plans',b.id,{...scopesActor,tableDataScopes:[{resource:'mps-base-plans',scope:'CUSTOM',rules:[{fieldKey:'divisionId',operator:'EQ',value:randomUUID()}]},{resource:'mps-monthly-plans',scope:'ALL'}]})).rejects.toMatchObject({status:404});

  });
  it('legal archived-source NULL binding works; illegal NULL identity and stale versions roll back',async()=>{
    const [a]=await db.query("SELECT * FROM mps_order_allocations WHERE item_code='SYN-A'");const m=await parent('SYN-A');
    await db.query('UPDATE mps_order_allocations SET archived_at=now() WHERE id=$1',[a.id]);
    await expect(bind('mps-order-allocations',{...a,version:999},m)).rejects.toMatchObject({status:409});
    const r=await bind('mps-order-allocations',a,m);expect(r.demandId).toBe(m.id);
    const [wrong]=await db.query(`INSERT INTO mps_base_plans(tenant_id,order_number,item_code,division_id,delivery_number,planned_quantity,created_by,updated_by)VALUES($1,'WRONG-ORDER','WRONG-ITEM',$2,999,1,$3,$3)RETURNING *`,[tenant,division,user]);
    await expect(bind('mps-base-plans',wrong,m)).rejects.toMatchObject({status:409});expect((await latest('mps_base_plans',wrong.id)).monthly_plan_id).toBeNull();
  });
  it('concurrent same request returns one result and one audit; conflicting writers do not change parent',async()=>{
    const m=await parent('SYN-CONFLICT');const [a]=await db.query("INSERT INTO mps_order_allocations(tenant_id,division_id,order_number,item_code,customer_code,allocated_quantity,created_by,updated_by)VALUES($1,$2,'SYN-ORDER','SYN-CONFLICT','SYN-CUSTOMER',0,$3,$3)RETURNING *",[tenant,division,user]);
    const key=randomUUID();const results=await Promise.all([bind('mps-order-allocations',a,m,key),bind('mps-order-allocations',a,m,key)]);expect(results.every(r=>r.demandId===m.id)).toBe(true);
    expect((await db.query("SELECT count(*)::int n FROM audit_logs WHERE record_id=$1 AND action='demand.first_link_confirmed'",[a.id]))[0].n).toBe(1);
  });
  it('different concurrent command keys allow one initial owner only',async()=>{
    const m=await parent('SYN-CONFLICT');
    const [b]=await db.query(`INSERT INTO mps_base_plans(tenant_id,division_id,order_number,item_code,delivery_number,planned_quantity,created_by,updated_by)VALUES($1,$2,'SYN-ORDER','SYN-CONFLICT',999,0,$3,$3)RETURNING *`,[tenant,division,user]);
    const outcomes=await Promise.allSettled([bind('mps-base-plans',b,m),bind('mps-base-plans',b,m)]);
    expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(o=>o.status==='rejected')).toHaveLength(1);
    expect((await latest('mps_base_plans',b.id)).monthly_plan_id).toBe(m.id);
    expect((await db.query("SELECT count(*)::int n FROM audit_logs WHERE record_id=$1 AND action='demand.first_link_confirmed'",[b.id]))[0].n).toBe(1);
  });
  it('review first link and query do not apply dates or quantities to any base',async()=>{
    const m=await parent(),base=await db.query('SELECT * FROM mps_base_plans ORDER BY id');
    const [r]=await db.query(`INSERT INTO mps_review_due_dates(tenant_id,division_id,order_number,batch_number,drawing_number,due_date,inbound_date,quantity,created_by,updated_by)VALUES($1,$2,'SYN-ORDER','01','SYN-ITEM','2026-12-01','2026-12-03',100,$3,$3)RETURNING *`,[tenant,division,user]);
    await bind('mps-review-due-dates',r,m);expect((await links.info('mps-review-due-dates',r.id,actor())).demandId).toBe(m.id);expect(await db.query('SELECT * FROM mps_base_plans ORDER BY id')).toEqual(base);
    await expect(db.query("UPDATE mps_review_due_dates SET order_number='SYN-OTHER' WHERE id=$1",[r.id])).rejects.toBeDefined();
    const review=new ReviewDueDateApplicationService(db,directory as never);
    const created=await review.manualCreate({commandId:randomUUID(),divisionId:division,orderNumber:'SYN-ORDER',batchNumber:'02',drawingNumber:'SYN-ITEM',dueDate:'2026-12-04',inboundDate:'2026-12-06',quantity:'30'},actor());
    expect((await latest('mps_review_due_dates',created.id)).monthly_plan_id).toBe(m.id);expect(await db.query('SELECT * FROM mps_base_plans ORDER BY id')).toEqual(base);
  });
  it('existing report remains editable through authorized normal correction after binding',async()=>{
    const [r]=await facts();const before=await structure();
    await app.update('mps-process-reports',r.id,{expectedVersion:r.version,productionQuantity:3,productionDate:'2026-11-02'},actor());
    const after=await latest('mps_process_reports',r.id);expect(after.id).toBe(r.id);expect(after.weekly_plan_id).toBe(r.weekly_plan_id);expect(after.production_quantity).toBe('3.0000');expect(after.version).toBe(r.version+1);expect(await structure()).toEqual(before);
  });
  it('late120 ledger applies honestly after121; historical IDs/facts retained and new links respect lifecycle',async()=>{
    const f=await facts(),t=await structure();
    const next=new DataSource({...db.options,migrations:[Lifecycle,Links]});await next.initialize();try{expect((await next.runMigrations()).map(m=>m.name)).toEqual(['MpsPlanLifecycle1722920120000']);expect(await next.runMigrations()).toEqual([]);}finally{await next.destroy();}
    expect(await facts()).toEqual(f);expect(await structure()).toEqual(t);
    expect(await new MasterPlanLifecycleService(db).availability('mps-base-plans')).toMatchObject({schemaReady:true});
    // Reads and unchanged historical links survive; existing 1C global sync block is deliberately preserved.
    const [b]=await db.query("SELECT * FROM mps_base_plans WHERE item_code='SYN-ITEM' LIMIT 1");expect((await links.info('mps-base-plans',b.id,actor())).schemaReady).toBe(true);
    await expect(run('base-to-weekly')).rejects.toThrow('LIFECYCLE_BLOCKED');
  });
  it('also installs121 after already-applied120 with facts intact and legal initial binding',async()=>{
    const common={type:'postgres' as const,host:process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET!,username:'postgres',entities:[],logging:false as const};
    const admin=new DataSource({...common,database:'postgres'});await admin.initialize();try{await admin.query('DROP DATABASE IF EXISTS mps_unified_after120_test WITH (FORCE)');await admin.query('CREATE DATABASE mps_unified_after120_test');}finally{await admin.destroy();}
    const other=new DataSource({...common,database:'mps_unified_after120_test',migrations:discoverMigrationFiles(path.join(__dirname,'../../migrations')).filter(f=>Number(path.basename(f).slice(0,13))<=1722920120000)});await other.initialize();
    try{
      await other.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');expect(await other.runMigrations()).toHaveLength(120);
      await other.query("INSERT INTO users(id,tenant_id,username,display_name,password_hash)VALUES($1,$2,'synthetic-reverse','合成用户','invalid-synthetic-hash')",[user,tenant]);
      await other.query("INSERT INTO organization_units(id,name,level)VALUES($1,'事业三部',1)",[division]);
      for(const key of ['plan-projections','base-to-weekly'])await other.query("INSERT INTO mps_sync_configs(tenant_id,sync_key,name,enabled,interval_minutes,created_by,updated_by)VALUES($1,$2,'合成任务',true,30,$3,$3)",[tenant,key,user]);
      const os=new MasterPlanSyncService(other),oa=new MasterPlanApplicationService(other,{processOutbox:async()=>0,refreshWeeklyExecution:os.refreshWeeklyExecution.bind(os)} as never);
      await oa.create('mps-order-allocations',{divisionId:division,orderNumber:'SYN-REVERSE',itemCode:'SYN-REVERSE',customerCode:'SYN-CUSTOMER',allocatedQuantity:10,orderStatus:'已审核'},actor());
      await os.run(tenant,'plan-projections','MANUAL',user,'合成用户',randomUUID());
      const b=await oa.create('mps-base-plans',{divisionId:division,orderNumber:'SYN-REVERSE',itemCode:'SYN-REVERSE',plannedQuantity:10,latestCustomerDueDate:'2026-12-20',latestReviewDueDate:'2026-12-01',productAttribute:'五金',surfaceNature:'烤漆',manufacturingMethod:'自制'},actor());
      await os.run(tenant,'base-to-weekly','MANUAL',user,'合成用户',randomUUID());
      const [w]=await other.query('SELECT * FROM mps_weekly_plans WHERE base_plan_id=$1',[b.id]);
      await oa.create('mps-process-reports',{weeklyPlanId:w.id,processCode:'bending',productionDate:'2026-11-01',productionQuantity:2},actor());
      const prior=await other.query('SELECT * FROM mps_process_reports');
      const upgrade=new DataSource({...common,database:'mps_unified_after120_test',migrations:[Links]});await upgrade.initialize();try{expect((await upgrade.runMigrations()).map(m=>m.name)).toEqual(['MpsDemandLinks1722920121000']);}finally{await upgrade.destroy();}
      const [m]=await other.query('SELECT * FROM mps_monthly_plans WHERE tenant_id=$1',[tenant]);
      const ol=new MasterPlanDemandLinkService(other);await ol.bind('mps-base-plans',b.id,{demandId:m.id,expectedVersion:b.version,expectedDemandVersion:m.version,idempotencyKey:randomUUID(),reason:'合成反向顺序验证'},actor());
      expect(await other.query('SELECT * FROM mps_process_reports')).toEqual(prior);
    }finally{await other.destroy();}
  },60000);

});
