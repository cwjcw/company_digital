import { randomUUID } from 'node:crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import { mpsLifecycleCapabilities, type MpsLifecycleOperation, type MpsLifecyclePreview } from '@kdos/contracts';
import { createMpsTestDatabase } from './master-plan.test-database';
import { MasterPlanProcessReportException1722920061000 as ReportException } from '../../migrations/1722920061000-MasterPlanProcessReportException';
import { MasterPlanThreeDayWorkOrders1722920063000 as WorkOrders } from '../../migrations/1722920063000-MasterPlanThreeDayWorkOrders';
import { MpsExecutionFactProtection1722920119000 as Protection } from '../../migrations/1722920119000-MpsExecutionFactProtection';
import { MpsPlanLifecycle1722920120000 as Lifecycle } from '../../migrations/1722920120000-MpsPlanLifecycle';
import { MasterPlanLifecycleService } from './master-plan.lifecycle.service';
import { MasterPlanSyncService } from './master-plan.sync.service';
import { MasterPlanApplicationService } from './master-plan.application.service';
import { MasterPlanQueryService } from './master-plan.query.service';
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
  const makePlan = async (quantity=10, method='自制') => {
    const [allocation] = await db.query(`INSERT INTO mps_order_allocations(tenant_id,division_id,order_number,item_code,customer_code,allocated_quantity,order_status,manually_maintained,created_by,updated_by)
      VALUES($1,$2,'SYN-ORDER','SYN-ITEM','SYN-CUSTOMER',$3,'已审核',true,$4,$4) RETURNING *`, [tenant,division,quantity,user]);
    const [monthly] = await db.query(`INSERT INTO mps_monthly_plans(tenant_id,division_id,order_number,item_code,customer_code,allocation_id,required_quantity,created_by,updated_by)
      VALUES($1,$2,'SYN-ORDER','SYN-ITEM','SYN-CUSTOMER',$3,$4,$5,$5) RETURNING *`, [tenant,division,allocation.id,quantity,user]);
    const [base] = await db.query(`INSERT INTO mps_base_plans(tenant_id,division_id,order_number,item_code,item_name,delivery_number,planned_quantity,
      latest_customer_due_date,latest_review_due_date,product_attribute,surface_nature,manufacturing_method,created_by,updated_by)
      VALUES($1,$2,'SYN-ORDER','SYN-ITEM','合成品项',1,$3,'2026-12-20','2026-12-01','五金','烤漆',$4,$5,$5) RETURNING *`, [tenant,division,quantity,method,user]);
    const result=await sync.run(tenant,'base-to-weekly','MANUAL',user,'合成用户',randomUUID());
    expect(result.status).toBe('SUCCESS');
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
      ALTER TABLE mps_order_allocations ADD COLUMN archived_at timestamptz,ADD COLUMN manually_maintained boolean DEFAULT true;
      CREATE TABLE roles(id uuid,permission_group_resource text);
      CREATE TABLE permissions(role_id uuid,resource text,field_key text,"read" boolean,"create" boolean,"copy" boolean,"update" boolean,"delete" boolean,batch_print boolean,batch_update boolean,"import" boolean,"export" boolean,updated_by text);
      CREATE TABLE erp_staging_raw_records(tenant_id text,order_number text,item_code text,record_type text,source_table text,order_link_stable boolean,status_code text,source_database text,source_system text,source_id text);
      CREATE TABLE finished_goods_inbound(source_database text,source_system text,source_key text,sales_order_number text,inventory_code text,received_quantity numeric);
      CREATE TABLE idempotency_keys(key text PRIMARY KEY,request_hash text,response_json jsonb,created_by uuid,updated_by uuid);`);
    await new ReportException().up(qr); await new WorkOrders().up(qr); await new Protection().up(qr);
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
    await db.query('DELETE FROM mps_sync_configs WHERE tenant_id=$1',[tenant]);
    for(const key of ['base-to-weekly','execution-rollup']) await db.query(`INSERT INTO mps_sync_configs(tenant_id,sync_key,name,enabled,interval_minutes,created_by,updated_by)VALUES($1,$2,'合成任务',true,30,$3,$3)`,[tenant,key,user]);
  });
  afterAll(async()=>{
    if(originalGate===undefined)delete process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED;else process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED=originalGate;
    if(originalSecret===undefined)delete process.env.JWT_ACCESS_SECRET;else process.env.JWT_ACCESS_SECRET=originalSecret;
    if(db?.isInitialized)await db.destroy();
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
    const p=await lifecycle.preview(weekResource,week.id,'CANCEL',actor());expect(p.plannedQuantity).toBe('0.0000');expect(p.allowed).toBe(true);
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
  it('reports actual FAILED sync status for inactive plans instead of silently skipping or reactivating them',async()=>{
    const {week}=await makePlan();await change(week.id,'HOLD');const structure=await tasks();
    await expect(sync.run(tenant,'base-to-weekly','SCHEDULED',user,'合成任务',randomUUID())).rejects.toThrow('LIFECYCLE_BLOCKED');
    expect((await db.query("SELECT status FROM mps_sync_logs WHERE sync_key='base-to-weekly' ORDER BY created_at DESC LIMIT 1"))[0].status).toBe('FAILED');
    expect((await db.query('SELECT lifecycle_status FROM mps_weekly_plans WHERE id=$1',[week.id]))[0].lifecycle_status).toBe('ON_HOLD');expect(await tasks()).toEqual(structure);
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
