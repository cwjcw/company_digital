import { randomUUID } from 'node:crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import { mpsLifecycleCapabilities, type MpsLifecycleOperation, type MpsLifecyclePreview } from '@kdos/contracts';
import { createMpsTestDatabase } from './master-plan.test-database';
import { MasterPlanProcessReportException1722920061000 as ReportException } from '../../migrations/1722920061000-MasterPlanProcessReportException';
import { MasterPlanThreeDayWorkOrders1722920063000 as WorkOrders } from '../../migrations/1722920063000-MasterPlanThreeDayWorkOrders';
import { MpsExecutionFactProtection1722920119000 as Protection } from '../../migrations/1722920119000-MpsExecutionFactProtection';
import { MpsPlanLifecycle1722920120000 as Lifecycle } from '../../migrations/1722920120000-MpsPlanLifecycle';
import { MpsInboundOnlySnapshotInitialization1722920134000 as InboundSnapshotInitialization } from '../../migrations/1722920134000-MpsInboundOnlySnapshotInitialization';
import { MasterPlanLifecycleService } from './master-plan.lifecycle.service';
import { MasterPlanSyncService } from './master-plan.sync.service';
import { STANDARD_PROCESSES } from './master-plan.domain';
import { MasterPlanApplicationService } from './master-plan.application.service';
import { MasterPlanQueryService } from './master-plan.query.service';
import { allocationProjectionCandidatesSql } from './master-plan.allocation-projection';
import { MASTER_PLAN_RESOURCE_MAP, fieldsFor } from './master-plan.config';
import type { MasterPlanActor } from './master-plan.types';

const integration = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET ? describe : describe.skip;
const tenant = 'LIFECYCLE-1C-SYNTHETIC';
const user = '0199bc00-0000-7000-8000-000000000003', division = '0199bc00-0000-7000-8000-000000000001';
const weekResource = 'mps-weekly-plans';
const actor = (): MasterPlanActor => ({ tenantId: tenant, userId: user, username: '合成生命周期用户', permissions: ['*'], isSystemAdmin: true, tableDataScopes: [], requestId: randomUUID(), source: 'web' });
const input = (p: MpsLifecyclePreview) => ({ operation: p.operation, expectedVersion: p.expectedVersion, reason: '隔离测试正式操作', idempotencyKey: randomUUID(), previewToken: p.previewToken });

integration('MPS 1C lifecycle: isolated PG18, migrations 118 + 119 + 120', () => {
  let db: DataSource, lifecycle: MasterPlanLifecycleService, sync: MasterPlanSyncService, app: MasterPlanApplicationService, query: MasterPlanQueryService;
  const originalGate = process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED, originalSecret = process.env.JWT_ACCESS_SECRET;
  const facts = () => db.query('SELECT * FROM mps_process_reports ORDER BY id');
  const tasks = () => db.query('SELECT id,weekly_plan_id,process_code,sequence,cycle_days,execution_enabled FROM mps_weekly_process_plans ORDER BY id');
  const report = (id: string, quantity=3) => app.create('mps-process-reports', { weeklyPlanId: id, processCode: 'bending', productionDate: '2026-11-01', productionQuantity: quantity, exceptionText: '合成历史异常' }, actor());
  const makePlan = async (quantity=10, method='自制', generateWeekly=true, item='SYN-ITEM') => {
    const [allocation] = await db.query(`INSERT INTO mps_order_allocations(tenant_id,division_id,order_number,item_code,customer_code,allocated_quantity,order_status,manually_maintained,created_by,updated_by)
      VALUES($1,$2,'SYN-ORDER',$5,'SYN-CUSTOMER',$3,'已审核',true,$4,$4) RETURNING *`, [tenant,division,quantity,user,item]);
    const [monthly] = await db.query(`INSERT INTO mps_monthly_plans(tenant_id,division_id,order_number,item_code,customer_code,allocation_id,required_quantity,created_by,updated_by)
      VALUES($1,$2,'SYN-ORDER',$6,'SYN-CUSTOMER',$3,$4,$5,$5) RETURNING *`, [tenant,division,allocation.id,quantity,user,item]);
    const [base] = await db.query(`INSERT INTO mps_base_plans(tenant_id,division_id,order_number,item_code,item_name,delivery_number,planned_quantity,
      latest_customer_due_date,latest_review_due_date,product_attribute,surface_nature,manufacturing_method,monthly_plan_id,created_by,updated_by)
      VALUES($1,$2,'SYN-ORDER',$7,'合成品项',1,$3,'2026-12-20','2026-12-01','五金','烤漆',$4,$5,$6,$6) RETURNING *`, [tenant,division,quantity,method,monthly.id,user,item]);
    if(generateWeekly){const result=await sync.run(tenant,'base-to-weekly','MANUAL',user,'合成用户',randomUUID());expect(result.status).toBe('SUCCESS');}
    const [week] = await db.query('SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,base.id]);
    return { allocation, monthly, base, week };
  };
  const change = async (id: string, operation: MpsLifecycleOperation, resource=weekResource) => {
    const preview=await lifecycle.preview(resource,id,operation,actor());
    expect(preview.blockers).toEqual([]);
    return lifecycle.confirm(resource,id,input(preview),actor());
  };
  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET='isolated-lifecycle-test-signing-key';
    db=await createMpsTestDatabase('lifecycle_1c_fixture',user,division);
    const qr={ query: (sql:string,args?:unknown[]) => db.query(sql,args) } as QueryRunner;
    await db.query(`ALTER TABLE mps_monthly_plans ADD COLUMN allocation_id uuid;
      ALTER TABLE mps_base_plans ADD COLUMN monthly_plan_id uuid;
      ALTER TABLE mps_order_allocations ADD COLUMN archived_at timestamptz,ADD COLUMN manually_maintained boolean DEFAULT true,ADD COLUMN monthly_plan_id uuid;
      CREATE TABLE mps_consistency_checkpoints(tenant_id varchar(64) PRIMARY KEY,metrics jsonb NOT NULL DEFAULT '{}'::jsonb,updated_at timestamptz DEFAULT now(),version integer DEFAULT 1);
      CREATE TABLE roles(id uuid,permission_group_resource text);
      CREATE TABLE permissions(role_id uuid,resource text,field_key text,"read" boolean,"create" boolean,"copy" boolean,"update" boolean,"delete" boolean,batch_print boolean,batch_update boolean,"import" boolean,"export" boolean,updated_by text);
      CREATE TABLE erp_staging_raw_records(tenant_id text,order_number text,item_code text,record_type text,source_table text,order_link_stable boolean,status_code text,source_database text,source_system text,source_id text);
      CREATE TABLE finished_goods_inbound(source_database text,source_system text,source_key text,sales_order_number text,inventory_code text,received_quantity numeric);
      CREATE TABLE idempotency_keys(key text PRIMARY KEY,request_hash text,response_json jsonb,created_by uuid,updated_by uuid);`);
    await new ReportException().up(qr); await new WorkOrders().up(qr); await new Protection().up(qr); await new InboundSnapshotInitialization().up(qr);
    await db.query(`INSERT INTO users(id,username,display_name,enabled,created_by,updated_by)
      VALUES('0199e000-0000-7000-8000-000000000001','__kdos_system__','KDOS系统任务',false,$1,$1)
      ON CONFLICT(id) DO NOTHING`, [user]);
    // Prove additive migration retains old IDs, quantities and version without a business-data UPDATE.
    const [old]=await db.query(`INSERT INTO mps_base_plans(tenant_id,order_number,item_code,delivery_number,planned_quantity,latest_customer_due_date,latest_review_due_date,product_attribute,surface_nature,manufacturing_method,created_by,updated_by)VALUES($1,'SYN-OLD','SYN-OLD',1,7,'2026-12-20','2026-12-01','五金','烤漆','自制',$2,$2)RETURNING *`,[tenant,user]);
    await new Lifecycle().up(qr);
    expect((await db.query('SELECT * FROM mps_base_plans WHERE id=$1',[old.id]))[0]).toEqual({...old,lifecycle_status:'LEGACY_RETAINED'});
    lifecycle=new MasterPlanLifecycleService(db);sync=new MasterPlanSyncService(db);
    app=new MasterPlanApplicationService(db,{processOutbox:async()=>0,refreshWeeklyExecution:sync.refreshWeeklyExecution.bind(sync)} as never);
    query=new MasterPlanQueryService(db,{listEnabled:async()=>[{id:division,name:'合成事业部',pathLabel:'合成事业部'}]} as never);
  },30000);
  beforeEach(async () => {
    process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED='true';
    await db.query('TRUNCATE mps_group_plans,mps_reconciliation_outbox,mps_sync_logs,mps_data_exceptions,audit_logs,idempotency_keys,mps_order_allocations,mps_monthly_plans,mps_base_plans,erp_staging_raw_records,finished_goods_inbound CASCADE');
    await db.query('DELETE FROM mps_division_process_configs WHERE tenant_id=$1',[tenant]);
    await db.query(`INSERT INTO mps_division_process_configs(tenant_id,division_id,process_code,cycle_days,default_enabled,sequence,created_by,updated_by)
      SELECT $1,$2,process_code,1,true,sequence,$3::uuid,$3 FROM unnest(ARRAY['cutting','machining','bending','spotWelding','welding','woodworking','grinding','blank','surfaceTreatment','packaging']::text[]) WITH ORDINALITY p(process_code,sequence)`,[tenant,division,user]);
    await db.query('DELETE FROM mps_sync_configs WHERE tenant_id=$1',[tenant]);
    for(const key of ['base-to-weekly','execution-rollup']) await db.query(`INSERT INTO mps_sync_configs(tenant_id,sync_key,name,enabled,interval_minutes,created_by,updated_by)VALUES($1,$2,'合成任务',true,30,$3,$3)`,[tenant,key,user]);
    await db.query(`INSERT INTO mps_consistency_checkpoints(tenant_id) VALUES($1) ON CONFLICT(tenant_id) DO UPDATE SET metrics='{}'::jsonb,version=1`,[tenant]);
  });
  afterAll(async()=>{
    if(originalGate===undefined)delete process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED;else process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED=originalGate;
    if(originalSecret===undefined)delete process.env.JWT_ACCESS_SECRET;else process.env.JWT_ACCESS_SECRET=originalSecret;
    if(db?.isInitialized)await db.destroy();
  });

  it('automatically confirms a verified legacy source and generates weekly process tasks through runDue despite inbound and the manual lifecycle flag being off', async()=>{
    const [allocation] = await db.query(`INSERT INTO mps_order_allocations(tenant_id,division_id,order_number,item_code,customer_code,allocated_quantity,order_status,manually_maintained,created_by,updated_by)
      VALUES($1,$2,'AUTO-LEGACY-1','AUTO-ITEM-1','AUTO-CUSTOMER',10,'待审核',true,$3,$3) RETURNING *`,[tenant,division,user]);
    const [monthly] = await db.query(`INSERT INTO mps_monthly_plans(tenant_id,division_id,order_number,item_code,customer_code,allocation_id,required_quantity,created_by,updated_by)
      VALUES($1,$2,'AUTO-LEGACY-1','AUTO-ITEM-1','AUTO-CUSTOMER',$3,10,$4,$4) RETURNING *`,[tenant,division,allocation.id,user]);
    await db.query(`UPDATE mps_order_allocations SET monthly_plan_id=$2 WHERE id=$1`,[allocation.id,monthly.id]);
    const [base] = await db.query(`INSERT INTO mps_base_plans(tenant_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,planned_quantity,
      latest_customer_due_date,latest_review_due_date,product_attribute,surface_nature,manufacturing_method,monthly_plan_id,created_by,updated_by)
      VALUES($1,$2,'AUTO-CUSTOMER','AUTO-LEGACY-1','AUTO-ITEM-1','合成品项',1,10,'2026-12-20','2026-12-01','五金','烤漆','自制',$3,$4,$4) RETURNING *`,[tenant,division,monthly.id,user]);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.mps_lifecycle_command','1',true),set_config('app.mps_lifecycle_enabled','1',true)");
      await manager.query(`UPDATE mps_monthly_plans SET lifecycle_status='LEGACY_RETAINED' WHERE id=$1`,[monthly.id]);
      await manager.query(`UPDATE mps_base_plans SET lifecycle_status='LEGACY_RETAINED' WHERE id=$1`,[base.id]);
    });
    await db.query(`INSERT INTO erp_staging_raw_records(tenant_id,order_number,item_code,record_type,source_table,order_link_stable,status_code,source_database,source_system,source_id)
      VALUES($1,'AUTO-LEGACY-1','AUTO-ITEM-1','INBOUND_LINE','ST_RDRecord_b',true,'189','fixture-db','fixture-erp','inbound-1')`,[tenant]);
    await db.query(`INSERT INTO finished_goods_inbound(source_database,source_system,source_key,sales_order_number,inventory_code,received_quantity)
      VALUES('fixture-db','fixture-erp','inbound-1','AUTO-LEGACY-1','AUTO-ITEM-1',2)`);
    const [event] = await db.query(`INSERT INTO mps_reconciliation_outbox(tenant_id,resource,record_id,sync_key,scope_json,idempotency_key,actor_id,actor_name,created_by,updated_by)
      VALUES($1,'mps-base-plans',$2::uuid,'base-to-weekly',$3::jsonb,$4,$5::uuid,'合成事件',$5::uuid,$5::uuid) RETURNING id`,
      [tenant,base.id,JSON.stringify({basePlanIds:[base.id]}),`legacy-runDue-${randomUUID()}`,user]);
    await sync.processOutboxEvent(tenant,String(event.id));
    const [blockedReceipt]=await db.query(`SELECT status,last_error,isfinite(next_attempt_at) retryable FROM mps_reconciliation_outbox WHERE id=$1`,[event.id]);
    expect(blockedReceipt).toMatchObject({status:'FAILED',last_error:'同步未完整成功：BLOCKED',retryable:true});
    expect(await db.query('SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,base.id])).toHaveLength(0);
    await db.query(`UPDATE mps_sync_configs SET last_started_at=NULL,status='FAILED' WHERE tenant_id=$1 AND sync_key='base-to-weekly'`,[tenant]);
    const priorTenant=process.env.KDOS_DEFAULT_TENANT_CODE;
    const priorGate=process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED;
    process.env.KDOS_DEFAULT_TENANT_CODE=tenant;
    process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED='false';
    jest.spyOn(sync,'scanConsistencyPage').mockResolvedValue({ready:false,scanned:0,inconsistent:0,enqueued:0} as never);
    try { await sync.runDue(); } finally {
      if(priorTenant===undefined)delete process.env.KDOS_DEFAULT_TENANT_CODE;else process.env.KDOS_DEFAULT_TENANT_CODE=priorTenant;
      if(priorGate===undefined)delete process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED;else process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED=priorGate;
    }
    await db.query('UPDATE mps_reconciliation_outbox SET next_attempt_at=clock_timestamp() WHERE id=$1',[event.id]);
    await sync.processOutboxEvent(tenant,String(event.id));
    const [restoredMonth]=await db.query('SELECT lifecycle_status FROM mps_monthly_plans WHERE id=$1',[monthly.id]);
    const [restoredBase]=await db.query('SELECT lifecycle_status FROM mps_base_plans WHERE id=$1',[base.id]);
    const weeks=await db.query('SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,base.id]);
    const taskRows=await db.query('SELECT * FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2',[tenant,weeks[0]?.id]);
    const [receipt]=await db.query(`SELECT o.status,l.status log_status,l.metrics FROM mps_reconciliation_outbox o
      JOIN mps_sync_logs l ON l.tenant_id=o.tenant_id AND l.sync_key=o.sync_key AND l.idempotency_key=o.idempotency_key WHERE o.id=$1`,[event.id]);
    const [scheduled]=await db.query(`SELECT metrics FROM mps_sync_logs WHERE tenant_id=$1 AND sync_key='base-to-weekly'
      AND idempotency_key LIKE 'scheduled:base-to-weekly:%' ORDER BY started_at DESC LIMIT 1`,[tenant]);
    expect(restoredMonth.lifecycle_status).toBe('ACTIVE');
    expect(restoredBase.lifecycle_status).toBe('ACTIVE');
    expect(weeks).toHaveLength(1);
    expect(taskRows).toHaveLength(10);
    expect(receipt).toMatchObject({status:'SUCCESS',log_status:'SUCCESS'});
    expect(Number(scheduled.metrics.process_tasks_initialized)).toBe(10);
    expect(Number(scheduled.metrics.legacy_lifecycle_restored)).toBe(1);
    expect((await db.query(`SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action='mps-monthly-plans.lifecycle.auto_source_confirmed'`,[tenant]))[0].n).toBe(1);
    expect((await db.query(`SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action='mps-base-plans.lifecycle.auto_source_confirmed'`,[tenant]))[0].n).toBe(1);
  });

  it.each(['ON_HOLD','CANCELLED'] as const)('never auto-confirms a source or generates a week for a %s monthly/base plan', async status=>{
    const {monthly,base}=await makePlan(10,'自制',false,`SYN-RECOVERY-${status}`);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.mps_lifecycle_command','1',true),set_config('app.mps_lifecycle_enabled','1',true)");
      await manager.query("UPDATE mps_monthly_plans SET lifecycle_status=$2 WHERE id=$1",[monthly.id,status]);
      await manager.query("UPDATE mps_base_plans SET lifecycle_status=$2 WHERE id=$1",[base.id,status]);
    });
    const previousTenant=process.env.KDOS_DEFAULT_TENANT_CODE;
    process.env.KDOS_DEFAULT_TENANT_CODE=tenant;
    try { await sync.runDue(); } finally {
      if(previousTenant===undefined)delete process.env.KDOS_DEFAULT_TENANT_CODE;else process.env.KDOS_DEFAULT_TENANT_CODE=previousTenant;
    }
    expect((await db.query('SELECT lifecycle_status FROM mps_monthly_plans WHERE id=$1',[monthly.id]))[0].lifecycle_status).toBe(status);
    expect((await db.query('SELECT lifecycle_status FROM mps_base_plans WHERE id=$1',[base.id]))[0].lifecycle_status).toBe(status);
    expect(await db.query('SELECT id FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,base.id])).toHaveLength(0);
    expect((await db.query(`SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND resource IN ('mps-monthly-plans','mps-base-plans')
      AND action IN ('mps-monthly-plans.lifecycle.auto_source_confirmed','mps-base-plans.lifecycle.auto_source_confirmed')`,[tenant]))[0].n).toBe(0);
  });

  it('keeps source lifecycle retained until the shared weekly admission fields are complete', async()=>{
    const {monthly,base}=await makePlan(10,'自制',false,'SYN-INCOMPLETE-RECOVERY');
    await db.query('UPDATE mps_base_plans SET latest_review_due_date=NULL WHERE id=$1',[base.id]);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.mps_lifecycle_command','1',true),set_config('app.mps_lifecycle_enabled','1',true)");
      await manager.query("UPDATE mps_monthly_plans SET lifecycle_status='LEGACY_RETAINED' WHERE id=$1",[monthly.id]);
      await manager.query("UPDATE mps_base_plans SET lifecycle_status='LEGACY_RETAINED' WHERE id=$1",[base.id]);
    });
    const previousTenant=process.env.KDOS_DEFAULT_TENANT_CODE;
    process.env.KDOS_DEFAULT_TENANT_CODE=tenant;
    try { await sync.runDue(); } finally {
      if(previousTenant===undefined)delete process.env.KDOS_DEFAULT_TENANT_CODE;else process.env.KDOS_DEFAULT_TENANT_CODE=previousTenant;
    }
    expect((await db.query('SELECT lifecycle_status FROM mps_monthly_plans WHERE id=$1',[monthly.id]))[0].lifecycle_status).toBe('LEGACY_RETAINED');
    expect((await db.query('SELECT lifecycle_status FROM mps_base_plans WHERE id=$1',[base.id]))[0].lifecycle_status).toBe('LEGACY_RETAINED');
    expect(await db.query('SELECT id FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,base.id])).toHaveLength(0);
  });

  it('runs the bounded operator recovery scope without falling back to a tenant-wide sync', async()=>{
    const {monthly,base}=await makePlan(10,'自制',false,'SYN-OPERATOR-RECOVERY');
    await db.query("UPDATE mps_base_plans SET customer_code='SYN-CUSTOMER' WHERE id=$1",[base.id]);
    const [candidate]=await db.query(`${allocationProjectionCandidatesSql} WHERE existing_id=$2::uuid`,[tenant,monthly.id]);
    expect(candidate).toMatchObject({valid:true,enabled_division_id:division,customer_count:'1',quantity:'10.0000',skip_reason:null});
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.mps_lifecycle_command','1',true),set_config('app.mps_lifecycle_enabled','1',true)");
      await manager.query("UPDATE mps_monthly_plans SET lifecycle_status='LEGACY_RETAINED' WHERE id=$1",[monthly.id]);
      await manager.query("UPDATE mps_base_plans SET lifecycle_status='LEGACY_RETAINED' WHERE id=$1",[base.id]);
    });
    const result=await sync.recoverVerifiedLegacyHistory(tenant,randomUUID(),10);
    expect(result).toMatchObject({scanned:1,restored:1,passComplete:true,maxPagesReached:false,outboxProcessed:1,outboxSucceeded:1,pendingRecoveryEvents:0});
    const [week]=await db.query('SELECT id FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,base.id]);
    expect(week).toBeDefined();
    expect(await db.query('SELECT id FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2',[tenant,week.id])).toHaveLength(10);
  });

  it('reports full schema, service and per-operation readiness independently of the write switch', async () => {
    delete process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED;
    expect(await lifecycle.availability(weekResource)).toMatchObject({ schemaReady: true, serviceReady: true, writesEnabled: false, previewAvailable: true,
      operations: { CANCEL: { writeSupported: true, confirmEnabled: false } } });
    process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED='true';
    expect((await lifecycle.availability('mps-base-plans')).operations.CANCEL).toMatchObject({ writeSupported: false, confirmEnabled: false });
  });

  it('creates a qualified plan from the real runDue entrypoint, exposes process tasks, and safely replays manual sync',async()=>{
    const {base}=await makePlan(14,'自制',false);
    const previousTenant=process.env.KDOS_DEFAULT_TENANT_CODE;
    process.env.KDOS_DEFAULT_TENANT_CODE=tenant;
    try{await sync.runDue();}finally{if(previousTenant===undefined)delete process.env.KDOS_DEFAULT_TENANT_CODE;else process.env.KDOS_DEFAULT_TENANT_CODE=previousTenant;}
    const [week]=await db.query('SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,base.id]);
    expect(week).toBeDefined();
    expect(await db.query('SELECT id,weekly_plan_id,process_code,sequence,cycle_days,execution_enabled FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2 ORDER BY id',[tenant,week.id])).toHaveLength(10);
    const reportTasks=await query.list('mps-weekly-process-plans',{page:1,pageSize:50,filters:{weeklyPlanId:week.id}},actor(),params=>{params.push(tenant);return `record.tenant_id=$${params.length}`;});
    expect(reportTasks.total).toBe(10);
    const automatic=await db.query("SELECT status FROM mps_sync_logs WHERE tenant_id=$1 AND sync_key='base-to-weekly' AND run_type='SCHEDULED' ORDER BY started_at DESC LIMIT 1",[tenant]);
    expect(automatic[0].status).toBe('SUCCESS');
    const first=await sync.run(tenant,'base-to-weekly','MANUAL',user,'合成用户',randomUUID());
    const second=await sync.run(tenant,'base-to-weekly','MANUAL',user,'合成用户',randomUUID());
    expect(first.status).toBe('SUCCESS');expect(second.status).toBe('SUCCESS');
    expect((await db.query('SELECT count(*)::int n FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,base.id]))[0].n).toBe(1);
    expect(await db.query('SELECT id,weekly_plan_id,process_code,sequence,cycle_days,execution_enabled FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2 ORDER BY id',[tenant,week.id])).toHaveLength(10);
  });

  it('keeps missing routes explicitly blocked without generic fallback and retries after a default route is saved',async()=>{
    await db.query('DELETE FROM mps_division_process_configs WHERE tenant_id=$1 AND division_id=$2',[tenant,division]);
    const {base}=await makePlan(14,'自制',false);
    const previousTenant=process.env.KDOS_DEFAULT_TENANT_CODE;
    process.env.KDOS_DEFAULT_TENANT_CODE=tenant;
    try{await sync.runDue();}finally{if(previousTenant===undefined)delete process.env.KDOS_DEFAULT_TENANT_CODE;else process.env.KDOS_DEFAULT_TENANT_CODE=previousTenant;}
    const [week]=await db.query('SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,base.id]);
    expect(week).toBeDefined();
    expect((await db.query('SELECT count(*)::int n FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2',[tenant,week.id]))[0].n).toBe(0);
    expect((await db.query("SELECT message FROM mps_data_exceptions WHERE tenant_id=$1 AND exception_key=$2 AND active=true",[tenant,`division-process-config-missing:${week.id}`]))[0].message).toContain('没有已启用的默认工序配置');
    expect((await db.query("SELECT status,metrics FROM mps_sync_logs WHERE tenant_id=$1 AND sync_key='base-to-weekly' AND run_type='SCHEDULED' ORDER BY started_at DESC LIMIT 1",[tenant]))[0]).toMatchObject({status:'SUCCESS',metrics:expect.objectContaining({process_routes_blocked:1})});

    for(const [index,[processCode]] of STANDARD_PROCESSES.entries())
      await app.create('mps-division-process-configs',{divisionId:division,processCode,defaultEnabled:true,sequence:index+1,cycleDays:2},actor());
    expect(await sync.processOutbox()).toBeGreaterThan(0);
    expect((await db.query('SELECT count(*)::int n FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2',[tenant,week.id]))[0].n).toBe(10);
    expect((await db.query("SELECT active FROM mps_data_exceptions WHERE tenant_id=$1 AND exception_key=$2",[tenant,`division-process-config-missing:${week.id}`]))[0].active).toBe(false);
  });

  it('treats manual-quantity preservation as a row-level outcome while syncing eligible peers',async()=>{
    const protectedPlan=await makePlan(10,'自制',true);
    await app.update('mps-weekly-plans',protectedPlan.week.id,{expectedVersion:protectedPlan.week.version,plannedQuantity:9},actor());
    const peer=await makePlan(11,'自制',false,'SYN-MANUAL-PEER');
    const result=await sync.run(tenant,'base-to-weekly','MANUAL',user,'合成用户',randomUUID());
    expect(result.status).toBe('SUCCESS');
    expect(result.metrics?.weekly_manual_quantity_protected).toBe(1);
    expect((await db.query('SELECT planned_quantity FROM mps_weekly_plans WHERE tenant_id=$1 AND id=$2',[tenant,protectedPlan.week.id]))[0].planned_quantity).toBe('9.0000');
    expect((await db.query('SELECT id FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,peer.base.id]))).toHaveLength(1);
    expect((await db.query("SELECT status FROM mps_sync_logs WHERE tenant_id=$1 AND sync_key='base-to-weekly' ORDER BY started_at DESC LIMIT 1",[tenant]))[0].status).toBe('SUCCESS');
  });

  it('hides a terminal failure older than weekly creation but keeps a new failure after generation',async()=>{
    const {base,week}=await makePlan();
    const currentIssue=async()=>{
      const result=await query.list('mps-base-plans',{},actor());
      return result.rows.find((row:any)=>row.id===base.id)?.weeklyPlanGenerationIssue;
    };
    const before=await db.query('SELECT (SELECT count(*) FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2) weekly,(SELECT count(*) FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$3) tasks',[tenant,base.id,week.id]);
    await db.query(`INSERT INTO mps_reconciliation_outbox(tenant_id,resource,record_id,sync_key,idempotency_key,actor_id,actor_name,status,attempts,last_error,completed_at,created_by,updated_by,created_at,updated_at)
      VALUES($1,'mps-base-plans',$2,'base-to-weekly',$3,$4,'合成测试','FAILED',10,'LIFECYCLE_BLOCKED: 历史失败',clock_timestamp(),$4,$4,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')`,[tenant,base.id,randomUUID(),user]);
    expect(await currentIssue()).toBeNull();
    await db.query(`INSERT INTO mps_reconciliation_outbox(tenant_id,resource,record_id,sync_key,idempotency_key,actor_id,actor_name,status,attempts,last_error,completed_at,created_by,updated_by)
      VALUES($1,'mps-base-plans',$2,'base-to-weekly',$3,$4,'合成测试','FAILED',1,'LIFECYCLE_BLOCKED: 新失败',clock_timestamp(),$4,$4)`,[tenant,base.id,randomUUID(),user]);
    expect(await currentIssue()).toBe('LIFECYCLE_BLOCKED: 新失败');
    expect(await db.query('SELECT (SELECT count(*) FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2) weekly,(SELECT count(*) FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$3) tasks',[tenant,base.id,week.id])).toEqual(before);
  });

  it.each([
    ['aa_mps_plan_lifecycle', 'mps_base_plans', 'schemaReady'],
    ['trg_mps_report_context', 'mps_process_reports', 'serviceReady']
  ])('rejects partial deployment with disabled %s before reading plan facts', async (trigger, table, property) => {
    await expect(db.transaction(async manager => {
      await manager.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      const availability = await lifecycle.assertAvailable(weekResource, manager);
      throw Error(`Unsafe availability: ${JSON.stringify(availability)}`);
    })).rejects.toMatchObject({ status: 409 });
    // Rollback restores the guard; no positive capability cache can outlive structural changes.
    expect(await lifecycle.availability(weekResource)).toMatchObject({ [property]: true, previewAvailable: true });
  });

  it('defaults new plans to ACTIVE, supports hold, removes pending execution, retains historical report and process identities',async()=>{
    const {week}=await makePlan();await report(week.id);const before=await facts(),structure=await tasks();
    expect(week.lifecycle_status).toBe('ACTIVE');
    await change(week.id,'HOLD');
    await expect(report(week.id)).rejects.toBeDefined();
    expect((await query.list('mps-process-reports',{view:'PENDING'},actor())).rows).toEqual([]);
    expect((await query.list('mps-process-reports',{},actor())).rows).toHaveLength(1);
    expect(await facts()).toEqual(before);expect(await tasks()).toEqual(structure);
  });
  it('restores source-confirmed legacy month and base despite a normalized inbound order alias, then generates one weekly route',async()=>{
    const {monthly,base}=await makePlan(10,'自制',false);
    await db.query('DELETE FROM mps_division_process_configs WHERE tenant_id=$1 AND division_id=$2',[tenant,division]);
    for(const [index,[processCode]] of STANDARD_PROCESSES.entries()) await app.create('mps-division-process-configs',
      {divisionId:division,processCode,defaultEnabled:true,sequence:index+1},actor());
    await db.query("SELECT set_config('app.mps_lifecycle_command','1',true),set_config('app.mps_lifecycle_enabled','1',true)");
    await db.transaction(async m=>{
      await m.query("SELECT set_config('app.mps_lifecycle_command','1',true),set_config('app.mps_lifecycle_enabled','1',true)");
      await m.query("UPDATE mps_monthly_plans SET lifecycle_status='LEGACY_RETAINED' WHERE id=$1",[monthly.id]);
      await m.query("UPDATE mps_base_plans SET lifecycle_status='LEGACY_RETAINED' WHERE id=$1",[base.id]);
    });
    await db.query(`INSERT INTO erp_staging_raw_records(tenant_id,order_number,item_code,record_type,source_table,order_link_stable,status_code,source_database,source_system,source_id)
      VALUES($1,'2301-SYN-ORDER','SYN-ITEM','INBOUND_LINE','ST_RDRecord_b',true,'189','synthetic','E10','inbound-1')`,[tenant]);
    await db.query("INSERT INTO finished_goods_inbound(source_database,source_system,source_key,sales_order_number,inventory_code,received_quantity)VALUES('synthetic','E10','inbound-1','2301-SYN-ORDER','SYN-ITEM',2)");
    const systemActor={...actor(),source:'system' as const};
    const monthPreview=await lifecycle.preview('mps-monthly-plans',monthly.id,'RESTORE',systemActor);
    expect(monthPreview).toMatchObject({allowed:true,facts:{hasInbound:true}});
    const baseBeforeParentRestore=await lifecycle.preview('mps-base-plans',base.id,'RESTORE',systemActor);
    expect(baseBeforeParentRestore).toMatchObject({allowed:true,facts:{hasInbound:true}});
    await lifecycle.confirm('mps-monthly-plans',monthly.id,input(monthPreview),systemActor);
    const basePreview=await lifecycle.preview('mps-base-plans',base.id,'RESTORE',systemActor);
    expect(basePreview).toMatchObject({allowed:true,facts:{hasInbound:true}});
    await lifecycle.confirm('mps-base-plans',base.id,input(basePreview),systemActor);
    expect(await db.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND source='api' AND resource IN ('mps-monthly-plans','mps-base-plans')",[tenant])).toEqual([{n:2}]);
    expect((await sync.run(tenant,'base-to-weekly','MANUAL',user,'合成用户',randomUUID())).status).toBe('SUCCESS');
    const weeks=await db.query('SELECT id,planned_quantity,pending_quantity FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,base.id]);
    expect(weeks).toHaveLength(1);
    expect(await db.query('SELECT process_code,sequence FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2 ORDER BY sequence',[tenant,weeks[0].id])).toHaveLength(10);
    expect((await db.query('SELECT lifecycle_status FROM mps_monthly_plans WHERE id=$1',[monthly.id]))[0].lifecycle_status).toBe('ACTIVE');
    expect((await db.query('SELECT lifecycle_status FROM mps_base_plans WHERE id=$1',[base.id]))[0].lifecycle_status).toBe('ACTIVE');
  });
  it('keeps legacy base plans quarantined from weekly generation while unrelated active sync succeeds',async()=>{
    const {monthly,base}=await makePlan(10,'自制',false);
    await db.transaction(async m=>{
      await m.query("SELECT set_config('app.mps_lifecycle_command','1',true),set_config('app.mps_lifecycle_enabled','1',true)");
      await m.query("UPDATE mps_monthly_plans SET lifecycle_status='LEGACY_RETAINED' WHERE id=$1",[monthly.id]);
      await m.query("UPDATE mps_base_plans SET lifecycle_status='LEGACY_RETAINED' WHERE id=$1",[base.id]);
    });
    const result=await sync.run(tenant,'base-to-weekly','MANUAL',user,'合成用户',randomUUID());
    expect(result.status).toBe('SUCCESS');
    expect(await db.query('SELECT id FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,base.id])).toHaveLength(0);
  });
  it('cancels an unexecuted leaf without zeroing quantities and restores the same IDs and tasks',async()=>{
    const {week}=await makePlan();const structure=await tasks();
    await change(week.id,'CANCEL');await expect(report(week.id)).rejects.toBeDefined();
    expect((await db.query('SELECT planned_quantity,lifecycle_status FROM mps_weekly_plans WHERE id=$1',[week.id]))[0]).toEqual({planned_quantity:'10.0000',lifecycle_status:'CANCELLED'});
    await change(week.id,'RESTORE');expect(await tasks()).toEqual(structure);await report(week.id);
  });
  it('requires the separate remaining-demand operation for executed plans and preserves all report facts',async()=>{
    const {week}=await makePlan();await report(week.id,3);await report(week.id,4);const before=await facts(),structure=await tasks();
    const p=await lifecycle.preview(weekResource,week.id,'CANCEL',actor());expect(p.allowed).toBe(false);expect(p.blockers.join()).toContain('剩余需求取消');
    await change(week.id,'CANCEL_REMAINING');expect(await facts()).toEqual(before);expect(await tasks()).toEqual(structure);
    const rollup=await sync.run(tenant,'execution-rollup','EVENT',user,'合成用户',randomUUID(),{weeklyPlanId:week.id,processCode:'bending'});
    expect(rollup.status).toBe('SUCCESS');expect(await facts()).toEqual(before);
  });
  it.each(['inbound','outsourcing','work-order'])('blocks unresolved %s dependencies without modifying facts',async kind=>{
    const {week}=await makePlan(10,kind==='outsourcing'?'自制+外协':'自制');
    if(kind==='inbound')await db.query('UPDATE mps_weekly_plans SET allocated_inbound_quantity=1 WHERE id=$1',[week.id]);
    if(kind==='outsourcing')await db.query("UPDATE mps_outsourcing_reports SET purchase_order_number='SYN-PO' WHERE weekly_plan_id=$1",[week.id]);
    if(kind==='work-order')await db.query(`INSERT INTO mps_three_day_work_orders(tenant_id,weekly_plan_id,division_id,order_number,item_code,production_start_date,production_end_date,created_by,updated_by)VALUES($1,$2,$3,'SYN-ORDER','SYN-ITEM','2026-11-01','2026-11-01',$4,$4)`,[tenant,week.id,division,user]);
    const p=await lifecycle.preview(weekResource,week.id,'CANCEL',actor());expect(p.allowed).toBe(false);
    await expect(lifecycle.confirm(weekResource,week.id,input(p),actor())).rejects.toThrow();
    expect((await db.query('SELECT lifecycle_status FROM mps_weekly_plans WHERE id=$1',[week.id]))[0].lifecycle_status).toBe('ACTIVE');
  });
  it.each(['mps-monthly-plans','mps-base-plans'])('blocks partial parent cancellation for %s but permits hold to fence all descendants',async resource=>{
    const {week,monthly,base}=await makePlan();const id=resource==='mps-monthly-plans'?monthly.id:base.id;
    const p=await lifecycle.preview(resource,id,'CANCEL',actor());expect(p.blockers.join()).toContain('消费者尚未完成');
    await expect(lifecycle.confirm(resource,id,input(p),actor())).rejects.toThrow();
    await change(id,'HOLD',resource);await expect(report(week.id)).rejects.toBeDefined();
    expect((await query.list('mps-process-reports',{view:'PENDING'},actor())).rows).toEqual([]);
    await change(id,'RESTORE',resource);await report(week.id);
  });
  it('keeps zero quantity independent of cancellation',async()=>{
    const {week}=await makePlan(0);expect(week.lifecycle_status).toBe('ACTIVE');
    const p=await lifecycle.preview(weekResource,week.id,'CANCEL',actor());expect(p.plannedQuantity).toBe('0.0000');expect(p.blockers).toEqual([]);expect(p.allowed).toBe(true);
  });
  it('fails closed when the write switch is missing, including preview and direct confirmation',async()=>{
    const {week}=await makePlan();const p=await lifecycle.preview(weekResource,week.id,'CANCEL',actor());
    delete process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED;
    expect((await lifecycle.preview(weekResource,week.id,'CANCEL',actor())).allowed).toBe(false);
    await expect(lifecycle.confirm(weekResource,week.id,input(p),actor())).rejects.toThrow();
    await expect(db.query("UPDATE mps_weekly_plans SET lifecycle_status='CANCELLED' WHERE id=$1",[week.id])).rejects.toMatchObject({constraint:'ck_mps_lifecycle'});
  });
  it('checks independent capabilities and read/update scopes on every related plan and prevents cross-tenant access',async()=>{
    const {week}=await makePlan();const codes=['mps-order-allocations','mps-monthly-plans','mps-base-plans','mps-weekly-plans','mps-process-reports','mps-technical-reports','mps-material-reports','mps-outsourcing-reports','mps-three-day-work-orders'];
    const limited:MasterPlanActor={...actor(),isSystemAdmin:false,permissions:codes.flatMap(code=>[`${code}:*:read`,`${code}:*:update`,...fieldsFor(MASTER_PLAN_RESOURCE_MAP.get(code as never)!).map(f=>`${code}:${f.key}:read`)]),tableDataScopes:codes.map(resource=>({resource,scope:'ALL'}))};
    await expect(lifecycle.preview(weekResource,week.id,'CANCEL',limited)).rejects.toMatchObject({status:403});
    limited.permissions.push('mps-plan-cancel:*:update');
    expect((await lifecycle.preview(weekResource,week.id,'CANCEL',limited)).allowed).toBe(true);
    limited.tableDataScopes=limited.tableDataScopes.map(s=>s.resource===weekResource?{...s,scope:'CUSTOM',rules:[{fieldKey:'divisionId',operator:'EQ',value:randomUUID()}]}:s);
    await expect(lifecycle.preview(weekResource,week.id,'CANCEL',limited)).rejects.toMatchObject({status:403});
    await expect(lifecycle.preview(weekResource,week.id,'CANCEL',{...actor(),tenantId:'OTHER-TENANT'})).rejects.toMatchObject({status:404});
    expect(mpsLifecycleCapabilities).toHaveLength(5);
  });
  it.each(['version','facts','source'])('rejects a preview after %s changed',async kind=>{
    const {week,base}=await makePlan();const p=await lifecycle.preview(weekResource,week.id,'CANCEL',actor());
    if(kind==='version')await db.query('UPDATE mps_weekly_plans SET version=version+1 WHERE id=$1',[week.id]);
    if(kind==='facts')await report(week.id);
    if(kind==='source')await db.query('UPDATE mps_base_plans SET planned_quantity=9 WHERE id=$1',[base.id]);
    await expect(lifecycle.confirm(weekResource,week.id,input(p),actor())).rejects.toMatchObject({status:409});
  });
  it('rejects expired, tampered, mismatched actor and stale optimistic versions',async()=>{
    const {week}=await makePlan();const p=await lifecycle.preview(weekResource,week.id,'CANCEL',actor());
    const now=jest.spyOn(Date,'now').mockReturnValue(p.expiresAt+1);
    await expect(lifecycle.confirm(weekResource,week.id,input(p),actor())).rejects.toMatchObject({status:409});now.mockRestore();
    await expect(lifecycle.confirm(weekResource,week.id,{...input(p),previewToken:p.previewToken+'x'},actor())).rejects.toMatchObject({status:409});
    await expect(lifecycle.confirm(weekResource,week.id,input(p),{...actor(),userId:randomUUID()})).rejects.toMatchObject({status:409});
    await expect(lifecycle.confirm(weekResource,week.id,{...input(p),expectedVersion:2},actor())).rejects.toMatchObject({status:409});
  });
  it('replays an identical command once, rejects key reuse and rechecks scopes even on an idempotent response',async()=>{
    const {week}=await makePlan();const p=await lifecycle.preview(weekResource,week.id,'CANCEL',actor());const body=input(p);
    const result=await lifecycle.confirm(weekResource,week.id,body,actor());expect(await lifecycle.confirm(weekResource,week.id,body,actor())).toEqual(result);
    await expect(lifecycle.confirm(weekResource,week.id,{...body,reason:'different'},actor())).rejects.toMatchObject({status:409});
    expect((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='mps-weekly-plans.lifecycle.cancel'"))[0].n).toBe(1);
    const limited={...actor(),isSystemAdmin:false,permissions:['mps-plan-cancel:*:update',`${weekResource}:*:read`,`${weekResource}:*:update`,...['orderNumber','itemCode','divisionId','plannedQuantity','lifecycleStatus'].map(f=>`${weekResource}:${f}:read`)],tableDataScopes:[]};
    await expect(lifecycle.confirm(weekResource,week.id,body,limited)).rejects.toMatchObject({status:403});
  });
  it('fences concurrent confirmation so at most one version and audit is committed',async()=>{
    const {week}=await makePlan();const p=await lifecycle.preview(weekResource,week.id,'CANCEL',actor());
    const results=await Promise.allSettled([lifecycle.confirm(weekResource,week.id,input(p),actor()),lifecycle.confirm(weekResource,week.id,input(p),actor())]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await db.query('SELECT version FROM mps_weekly_plans WHERE id=$1',[week.id]))[0].version).toBe(p.expectedVersion+1);
  });
  it('allows authorized historical correction with reason and audit, blocks ordinary correction while canceled, preserves process locks',async()=>{
    const {week}=await makePlan();const created=await report(week.id);await change(week.id,'CANCEL_REMAINING');const structure=await tasks();
    await expect(app.update('mps-process-reports',created.id,{expectedVersion:1,productionQuantity:4},actor())).rejects.toBeDefined();
    await expect(app.correctHistoricalReport(created.id,{expectedVersion:1,productionQuantity:4},actor())).rejects.toThrow('原因');
    await app.correctHistoricalReport(created.id,{expectedVersion:1,productionQuantity:4,correctionReason:'经确认的历史漏报纠错'},actor());
    expect((await facts())[0]).toMatchObject({id:created.id,weekly_plan_id:week.id,production_quantity:'4.0000',version:2});expect(await tasks()).toEqual(structure);
    expect((await db.query("SELECT after_json FROM audit_logs WHERE action='mps-process-reports.historical_corrected'"))[0].after_json.correctionReason).toBe('经确认的历史漏报纠错');
  });
  it.each([['HOLD','ON_HOLD'],['CANCEL','CANCELLED']] as const)('skips a %s plan without reactivating it or failing unrelated weekly reconciliation',async(operation,status)=>{
    const {week}=await makePlan();await change(week.id,operation);
    const structure=await db.query('SELECT id,weekly_plan_id,process_code,sequence,cycle_days,execution_enabled FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2 ORDER BY id',[tenant,week.id]);
    const peer=await makePlan(12,'自制',false,'SYN-LIFECYCLE-PEER');
    const result=await sync.run(tenant,'base-to-weekly','SCHEDULED',user,'合成任务',randomUUID());
    expect(result.status).toBe('SUCCESS');expect(result.metrics?.weekly_lifecycle_blocked).toBe(1);
    expect((await db.query("SELECT status FROM mps_sync_logs WHERE sync_key='base-to-weekly' ORDER BY created_at DESC LIMIT 1"))[0].status).toBe('SUCCESS');
    expect((await db.query('SELECT lifecycle_status FROM mps_weekly_plans WHERE id=$1',[week.id]))[0].lifecycle_status).toBe(status);expect(await db.query('SELECT id,weekly_plan_id,process_code,sequence,cycle_days,execution_enabled FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2 ORDER BY id',[tenant,week.id])).toEqual(structure);
    expect(await db.query('SELECT id FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,peer.base.id])).toHaveLength(1);
  });
  it('retains unknown historical plans, refuses unsupported direct cancellation/deletion, confirms only with verified source',async()=>{
    const {week}=await makePlan();
    await db.transaction(async m=>{await m.query("SELECT set_config('app.mps_lifecycle_command','1',true),set_config('app.mps_lifecycle_enabled','1',true)");await m.query("UPDATE mps_weekly_plans SET lifecycle_status='LEGACY_RETAINED' WHERE id=$1",[week.id]);});
    expect((await lifecycle.preview(weekResource,week.id,'CANCEL',actor())).allowed).toBe(false);
    await expect(db.query('DELETE FROM mps_weekly_plans WHERE id=$1',[week.id])).rejects.toBeDefined();
    await change(week.id,'RESTORE');expect((await db.query('SELECT lifecycle_status FROM mps_weekly_plans WHERE id=$1',[week.id]))[0].lifecycle_status).toBe('ACTIVE');
  });
  it('refuses restore after upstream archive, quantity conflict, or paused monthly ancestry',async()=>{
    const {week,base,monthly,allocation}=await makePlan();await change(week.id,'CANCEL');
    await db.query('UPDATE mps_order_allocations SET archived_at=now() WHERE id=$1',[allocation.id]);
    expect((await lifecycle.preview(weekResource,week.id,'RESTORE',actor())).allowed).toBe(false);
    await db.query('UPDATE mps_order_allocations SET archived_at=NULL WHERE id=$1',[allocation.id]);
    await db.query('UPDATE mps_base_plans SET planned_quantity=9 WHERE id=$1',[base.id]);
    expect((await lifecycle.preview(weekResource,week.id,'RESTORE',actor())).blockers.join()).toContain('数量冲突');
    await db.query('UPDATE mps_base_plans SET planned_quantity=10 WHERE id=$1',[base.id]);
    await db.query("UPDATE mps_base_plans SET manufacturing_method='外协' WHERE id=$1",[base.id]);
    expect((await lifecycle.preview(weekResource,week.id,'RESTORE',actor())).blockers.join()).toContain('制造方式');
    await db.query("UPDATE mps_base_plans SET manufacturing_method='自制' WHERE id=$1",[base.id]);
    await change(monthly.id,'HOLD','mps-monthly-plans');
    expect((await lifecycle.preview(weekResource,week.id,'RESTORE',actor())).allowed).toBe(false);
  });
  it('detects a synthetic retained duplicate during restore and never chooses or transfers its identity',async()=>{
    const {week}=await makePlan();await change(week.id,'CANCEL');
    // The formal unique keys already prevent duplicates. Drop them only inside a rolled-back
    // fixture transaction to exercise the defensive check for a corrupted legacy dataset.
    await db.transaction(async m=>{
      await m.query('SAVEPOINT legacy_fixture');
      await m.query('ALTER TABLE mps_weekly_plans DROP CONSTRAINT uq_mps_weekly_plan,DROP CONSTRAINT uq_mps_weekly_base');
      await m.query(`INSERT INTO mps_weekly_plans(tenant_id,base_plan_id,division_id,order_number,item_code,delivery_number,planned_quantity,latest_customer_due_date,latest_review_due_date,manufacturing_method,created_by,updated_by)
        SELECT tenant_id,base_plan_id,division_id,order_number,item_code,delivery_number,planned_quantity,latest_customer_due_date,latest_review_due_date,manufacturing_method,created_by,updated_by FROM mps_weekly_plans WHERE id=$1`,[week.id]);
      const inspection=await (lifecycle as any).inspect(m,weekResource,week.id,'RESTORE',actor());
      expect(inspection.result.allowed).toBe(false);expect(inspection.result.blockers.join()).toContain('重复有效计划');
      await m.query('ROLLBACK TO SAVEPOINT legacy_fixture');
    });
    expect((await db.query('SELECT count(*)::int n FROM mps_weekly_plans'))[0].n).toBe(1);
  });
  it('serializes an in-flight first report against cancellation and rejects the stale preview',async()=>{
    const {week}=await makePlan();const p=await lifecycle.preview(weekResource,week.id,'CANCEL',actor());
    let release!:()=>void,ready!:()=>void;const barrier=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{ready=r;});
    const reportSave=db.transaction(async m=>{
      await m.query(`INSERT INTO mps_process_reports(tenant_id,weekly_plan_id,division_id,order_number,item_code,item_name,delivery_number,process_code,process_name,production_date,planned_quantity,production_quantity,created_by,updated_by)
        VALUES($1,$2,$3,'SYN-ORDER','SYN-ITEM','合成品项',1,'bending','折弯','2026-11-01',10,3,$4,$4)`,[tenant,week.id,division,user]);
      ready();await barrier;
    });
    await started;
    const confirmation=lifecycle.confirm(weekResource,week.id,input(p),actor());
    release();await reportSave;
    await expect(confirmation).rejects.toMatchObject({status:409});
    expect(await facts()).toHaveLength(1);expect((await db.query('SELECT lifecycle_status FROM mps_weekly_plans'))[0].lifecycle_status).toBe('ACTIVE');
  });
  it('rolls back lifecycle and idempotency when the mandatory audit cannot be committed',async()=>{
    const {week}=await makePlan();const p=await lifecycle.preview(weekResource,week.id,'CANCEL',actor());
    await db.query(`CREATE FUNCTION fixture_fail_audit()RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER fixture_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_fail_audit()`);
    try {
      await expect(lifecycle.confirm(weekResource,week.id,input(p),actor())).rejects.toThrow('synthetic audit failure');
      expect((await db.query('SELECT lifecycle_status,version FROM mps_weekly_plans'))[0]).toEqual({lifecycle_status:'ACTIVE',version:p.expectedVersion});
      expect(await db.query('SELECT * FROM idempotency_keys')).toEqual([]);
    }finally{await db.query('DROP TRIGGER fixture_fail_audit ON audit_logs;DROP FUNCTION fixture_fail_audit()');}
  });
  it('blocks creation of new descendants beneath a paused parent without altering existing process snapshots',async()=>{
    const {monthly}=await makePlan();const before=await tasks();await change(monthly.id,'HOLD','mps-monthly-plans');
    await expect(db.query(`INSERT INTO mps_base_plans(tenant_id,division_id,order_number,item_code,delivery_number,planned_quantity,latest_customer_due_date,latest_review_due_date,created_by,updated_by)
      VALUES($1,$2,'SYN-ORDER','SYN-ITEM',2,10,'2026-12-20','2026-12-01',$3,$3)`,[tenant,division,user])).rejects.toMatchObject({constraint:'ck_mps_lifecycle'});
    expect(await tasks()).toEqual(before);
  });
  it('keeps historical progress and locks when actual quantities exceed remaining planned demand',async()=>{
    const {week}=await makePlan();await report(week.id,14);const before=await facts(),structure=await tasks();
    await change(week.id,'CANCEL_REMAINING');
    const view=await query.list('mps-weekly-plans',{},actor());expect(Number(view.rows[0].bendingProductionProgress)).toBeCloseTo(1.4);
    expect(await facts()).toEqual(before);expect(await tasks()).toEqual(structure);
    await expect(db.query('UPDATE mps_weekly_process_plans SET sequence=sequence+1 WHERE weekly_plan_id=$1',[week.id])).rejects.toBeDefined();
  });
  it('blocks technical completion, attachments and material receipt while paused, not just process reports',async()=>{
    const {week}=await makePlan();await change(week.id,'HOLD');
    for(const sql of ["UPDATE mps_technical_reports SET status='已完成' WHERE weekly_plan_id=$1", "UPDATE mps_technical_reports SET drawing_refs='[\"synthetic-file\"]' WHERE weekly_plan_id=$1", "UPDATE mps_material_reports SET received=true WHERE weekly_plan_id=$1"])
      await expect(db.query(sql,[week.id])).rejects.toMatchObject({constraint:'ck_mps_lifecycle_execution'});
    expect(await facts()).toEqual([]);
  });
});
