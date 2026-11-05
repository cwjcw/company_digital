import { mpsOrderProgressResource } from '@kdos/contracts';
import { MasterPlanOrderProgressService } from './master-plan.order-progress.service';
import ExcelJS from 'exceljs';
import { MasterPlanSpreadsheetService } from './master-plan-spreadsheet.service';
import { DataSource, type QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { createMpsTestDatabase } from './master-plan.test-database';
import { MasterPlanProcessReportException1722920061000 as ReportException } from '../../migrations/1722920061000-MasterPlanProcessReportException';
import { MasterPlanThreeDayWorkOrders1722920063000 as WorkOrders } from '../../migrations/1722920063000-MasterPlanThreeDayWorkOrders';
import { MpsExecutionFactProtection1722920119000 as Protection } from '../../migrations/1722920119000-MpsExecutionFactProtection';
import { MasterPlanApplicationService } from './master-plan.application.service';
import { MasterPlanSyncService } from './master-plan.sync.service';
import { MasterPlanQueryService } from './master-plan.query.service';
import { MASTER_PLAN_RESOURCE_MAP, queryColumnsFor, virtualColumns } from './master-plan.config';
import type { MasterPlanActor } from './master-plan.types';

const integration = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET ? describe : describe.skip;
const tenant = 'FACTS-1B-ISOLATED', legacyTenant = 'FACTS-1B-LEGACY';
const user = '0199bc00-0000-7000-8000-000000000003', division = '0199bc00-0000-7000-8000-000000000001';
const otherDivision = '0199bc00-0000-7000-8000-000000000002';
const principal = (who = tenant): MasterPlanActor => ({ tenantId: who, userId: user, username: '合成报工员', permissions: ['*'], isSystemAdmin: true, tableDataScopes: [], requestId: randomUUID(), source: 'web' });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve=r; }); return { promise, resolve }; };

integration('MPS 1B historical facts on isolated PG18 (no production DSN)', () => {
  let db: DataSource, sync: MasterPlanSyncService, app: MasterPlanApplicationService, query: MasterPlanQueryService;
  const resource = MASTER_PLAN_RESOURCE_MAP.get('mps-process-reports')!;
  const directory = { listEnabled: async () => [{ id: division, name: '合成一部', pathLabel: '合成一部' }, { id: otherDivision, name: '合成二部', pathLabel: '合成二部' }] };
  const allReports = () => db.query('SELECT * FROM mps_process_reports WHERE tenant_id=$1 ORDER BY id', [tenant]);
  const tasks = (id: string) => db.query('SELECT id,process_code,sequence,cycle_days,execution_enabled FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2 ORDER BY sequence', [tenant,id]);
  const makeWeek = async (method='自制', who=tenant) => {
    const [base] = await db.query(`INSERT INTO mps_base_plans(tenant_id,division_id,order_number,item_code,item_name,delivery_number,planned_quantity,
      latest_customer_due_date,latest_review_due_date,product_attribute,surface_nature,manufacturing_method,created_by,updated_by)
      VALUES($1,$2,'SYN-ORDER','SYN-ITEM','合成原品项',1,10,'2026-12-20','2026-12-01','五金','烤漆',$3,$4,$4) RETURNING *`, [who,division,method,user]);
    await sync.run(who,'base-to-weekly','MANUAL',user,'合成用户',randomUUID());
    const [week] = await db.query('SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2', [who,base.id]);
    return { base, week };
  };
  const report = (weeklyPlanId: string, n=3) => app.create('mps-process-reports', { weeklyPlanId,processCode:'bending',productionDate:'2026-11-01',productionQuantity:n,exceptionText:'合成异常' }, principal());
  const rawLegacyReport = (who: string, id: string, div=division) => db.query(`INSERT INTO mps_process_reports(tenant_id,weekly_plan_id,division_id,order_number,item_code,item_name,delivery_number,
    process_code,process_name,production_date,planned_quantity,production_quantity,created_by,updated_by)
    VALUES($1,$2,$3,'SYN-ORDER','SYN-ITEM','旧保存上下文',1,'bending','折弯','2026-11-01',8,3,$4,$4)`, [who,id,div,user]);

  beforeAll(async () => {
    db=await createMpsTestDatabase('facts_1b_fixture',user,division);
    const qr={query:(sql: string,args?: unknown[])=>db.query(sql,args)} as QueryRunner;
    await db.query(`ALTER TABLE mps_monthly_plans ADD COLUMN allocation_id uuid;
      ALTER TABLE mps_order_allocations ADD COLUMN archived_at timestamptz;

      CREATE TABLE roles(id uuid,permission_group_resource text);
      CREATE TABLE permissions(role_id uuid,resource text,field_key text,"read" boolean,"create" boolean,"copy" boolean,"update" boolean,"delete" boolean,batch_print boolean,batch_update boolean,"import" boolean,"export" boolean,updated_by text);
      CREATE TABLE erp_staging_raw_records(tenant_id text,order_number text,item_code text,record_type text,source_table text,order_link_stable boolean,status_code text,source_database text,source_system text,source_id text);
      CREATE TABLE finished_goods_inbound(source_database text,source_system text,source_key text,sales_order_number text,inventory_code text,received_quantity numeric);`);
    await new ReportException().up(qr); await new WorkOrders().up(qr);
    await db.query(`INSERT INTO organization_units(id,name) VALUES($1,'合成二部')`,[otherDivision]);
    await db.query(`CREATE TABLE idempotency_keys(key text PRIMARY KEY,request_hash text,response_json jsonb,created_by uuid,updated_by uuid)`);
    sync=new MasterPlanSyncService(db);
    // Execute actual commands; keep the HTTP after-commit consumer dormant in this synthetic fixture.
    app=new MasterPlanApplicationService(db,{processOutbox:async()=>0,refreshWeeklyExecution:sync.refreshWeeklyExecution.bind(sync)} as never);
    query=new MasterPlanQueryService(db,directory as never);
    await new Protection().up(qr);
  },30000);
  beforeEach(async () => {
    await db.query('TRUNCATE mps_group_plans,mps_reconciliation_outbox,mps_sync_logs,mps_data_exceptions,audit_logs,idempotency_keys,mps_order_allocations,mps_base_plans,erp_staging_raw_records,finished_goods_inbound CASCADE');
    await db.query('DELETE FROM mps_sync_configs WHERE tenant_id=$1',[tenant]);
    for(const key of ['base-to-weekly','execution-rollup']) await db.query(`INSERT INTO mps_sync_configs(tenant_id,sync_key,name,enabled,interval_minutes,created_by,updated_by)VALUES($1,$2,'合成任务',true,30,$3,$3)`,[tenant,key,user]);
  });
  afterAll(async()=>{if(db?.isInitialized)await db.destroy();});

  it('creates tasks and multiple reports; quantity/dates/product changes and repeated refresh preserve every report byte and process identity',async()=>{
    const {base,week}=await makeWeek(); const first=await report(week.id); await report(week.id,4);
    const before=await allReports(), structure=await tasks(week.id);
    await app.update('mps-base-plans',base.id,{expectedVersion:base.version,plannedQuantity:5,latestCustomerDueDate:'2026-12-25',latestReviewDueDate:'2026-12-10',productAttribute:'五金',itemName:'合成当前品项'},principal());
    for(let n=0;n<2;n++)await sync.run(tenant,'base-to-weekly','MANUAL',user,'系统投影',randomUUID());
    await db.transaction(m=>sync.refreshWeeklyExecution(m,week.id,tenant,user,user));
    expect(await allReports()).toEqual(before); expect(await tasks(week.id)).toEqual(structure);
    const result=await query.list('mps-process-reports',{},principal());
    expect(result.rows.find((r: Record<string, unknown>)=>r.id===first.id)).toMatchObject({plannedQuantity:'5.0000',snapshotPlannedQuantity:'10.0000',currentItemName:'合成当前品项',reportContextStatus:'创建审计已验证'});
    const [progress]=await db.query(`SELECT ${virtualColumns(MASTER_PLAN_RESOURCE_MAP.get('mps-weekly-plans')!).bendingProductionProgress} progress FROM mps_weekly_plans record WHERE id=$1`,[week.id]);
    expect(Number(progress.progress)).toBeCloseTo(1.4); // actual facts are never capped to demand
    expect((await query.list('mps-process-reports',{view:'PENDING'},principal())).rows.some((r: Record<string, unknown>)=>r.weeklyPlanId===week.id&&r.processCode==='bending')).toBe(false);
  });

  it.each([['division_id',otherDivision],['order_number','SYN-OTHER'],['item_code','SYN-OTHER'],['manufacturing_method','外协'],['delivery_number','2']])('blocks executed base and weekly identity change %s without touching facts',async(column,value)=>{
    const {base,week}=await makeWeek(); await report(week.id); const before=await allReports();
    for(const [table,id] of [['mps_base_plans',base.id],['mps_weekly_plans',week.id]])await expect(db.query(`UPDATE ${table} SET ${column}=$2 WHERE id=$1`,[id,value])).rejects.toMatchObject({constraint:'ck_mps_executed_identity'});
    expect(await allReports()).toEqual(before);
  });

  it('keeps 107/108 locks after reporting, rejects CONFIRM route regeneration, and recalculates dates only',async()=>{
    const {week}=await makeWeek(); await report(week.id); const structure=await tasks(week.id),before=await allReports();
    await expect(db.transaction(async m=>{await m.query("SELECT set_config('app.mps_process_config_write_mode','CONFIRM',true)");await m.query('UPDATE mps_weekly_process_plans SET cycle_days=99 WHERE weekly_plan_id=$1',[week.id]);})).rejects.toMatchObject({constraint:'ck_mps_process_config_write_guard'});
    await expect(sync.confirmWeeklyProcessConfig(week.id,{expectedVersion:1,previewHash:"invalid"},principal())).rejects.toBeDefined();
    expect(await tasks(week.id)).toEqual(structure);expect(await allReports()).toEqual(before);
  });

  it('permits authorized report correction with expectedVersion/audit and import update, but forbids stale correction and identity transfer',async()=>{
    const {week}=await makeWeek();const created=await report(week.id);const before=(await allReports())[0];
    await app.update('mps-process-reports',created.id,{expectedVersion:1,productionQuantity:6,productionDate:'2026-11-02',exceptionText:'正式纠错'},principal());
    await expect(app.update('mps-process-reports',created.id,{expectedVersion:1,productionQuantity:9},principal())).rejects.toThrow('记录已被其他用户修改');
    await expect(app.update('mps-process-reports',created.id,{expectedVersion:2,weeklyPlanId:randomUUID()},principal())).rejects.toBeDefined();
    await app.importUpdates('mps-process-reports',[{id:created.id,expectedVersion:2,values:{productionQuantity:7}}],'synthetic-hash',principal());
    const after=(await allReports())[0];expect(after).toMatchObject({id:before.id,weekly_plan_id:before.weekly_plan_id,division_id:before.division_id,planned_quantity:before.planned_quantity,production_quantity:'7.0000',version:3,updated_by:user});
    expect((await db.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action IN ('mps-process-reports.updated','mps-process-reports.import_updated')",[tenant]))[0].n).toBe(2);
    await sync.run(tenant,'execution-rollup','EVENT',user,'合成用户',randomUUID(),{weeklyPlanId:week.id,processCode:'bending'});
    expect(await allReports()).toEqual([after]);
  });

  it.each(['technical','material','outsourcing','work-order','inbound'])('protects %s execution, while placeholder rows do not count',async(kind)=>{
    const {base,week}=await makeWeek('自制+外协');
    expect((await db.query('SELECT mps_weekly_has_execution($1,$2) fact',[tenant,week.id]))[0].fact).toBe(false);
    if(kind==='technical')await db.query("UPDATE mps_technical_reports SET drawing_refs='[\"synthetic-file\"]' WHERE weekly_plan_id=$1",[week.id]);
    if(kind==='material')await db.query("UPDATE mps_material_reports SET received=true,actual_inbound_date='2026-11-01' WHERE weekly_plan_id=$1 AND material_name='五金'",[week.id]);
    if(kind==='outsourcing')await db.query("UPDATE mps_outsourcing_reports SET purchase_order_number='SYN-PO' WHERE weekly_plan_id=$1",[week.id]);
    if(kind==='inbound')await db.query('UPDATE mps_weekly_plans SET allocated_inbound_quantity=1 WHERE id=$1',[week.id]);
    if(kind==='work-order')await db.query(`INSERT INTO mps_three_day_work_orders(tenant_id,weekly_plan_id,division_id,order_number,item_code,production_start_date,production_end_date,created_by,updated_by) VALUES($1,$2,$3,'SYN-ORDER','SYN-ITEM','2026-11-01','2026-11-01',$4,$4)`,[tenant,week.id,division,user]);
    expect((await db.query('SELECT mps_weekly_has_execution($1,$2) fact',[tenant,week.id]))[0].fact).toBe(true);
    await expect(app.update('mps-base-plans',base.id,{expectedVersion:1,manufacturingMethod:'外协'},principal())).rejects.toThrow('已有生产执行事实');
    await expect(db.query('UPDATE mps_outsourcing_reports SET execution_enabled=false WHERE weekly_plan_id=$1',[week.id])).rejects.toMatchObject({constraint:'ck_mps_executed_identity'});
  });

  it('allows unexecuted identity/method changes despite technical/material/outsourcing placeholders',async()=>{
    const {base,week}=await makeWeek('自制+外协');
    await db.query("UPDATE mps_base_plans SET manufacturing_method='外协',item_code='SYN-NEW' WHERE id=$1",[base.id]);
    await sync.run(tenant,'base-to-weekly','MANUAL',user,'合成用户',randomUUID());
    expect((await db.query('SELECT item_code,manufacturing_method FROM mps_weekly_plans WHERE id=$1',[week.id]))[0]).toEqual({item_code:'SYN-NEW',manufacturing_method:'外协'});
  });

  it('keeps retained nonprocess/missing-task facts visible, marks unknown provenance, and isolates historical divisions and tenants',async()=>{
    await db.query("INSERT INTO mps_sync_configs(tenant_id,sync_key,name,enabled,interval_minutes,created_by,updated_by) VALUES($1,'base-to-weekly','旧合成任务',true,30,$2,$2) ON CONFLICT DO NOTHING",[legacyTenant,user]);
    const {week}=await makeWeek('外协',legacyTenant);
    // Raw SQL constructs a retained legacy anomaly; formal create commands reject this context.
    await rawLegacyReport(legacyTenant,week.id); await rawLegacyReport(legacyTenant,week.id,otherDivision);
    const limited=(div: string): MasterPlanActor=>({...principal(legacyTenant),permissions:['mps-process-reports:*:read',...Object.keys(queryColumnsFor(resource)).map(f=>`mps-process-reports:${f}:read`)],isSystemAdmin:false,tableDataScopes:[{resource:resource.code,scope:'CUSTOM',rules:[{fieldKey:'divisionId',operator:'EQ',value:div}]}]});
    const own=await query.list(resource.code,{},limited(division)),other=await query.list(resource.code,{},limited(otherDivision));
    expect(own.rows).toHaveLength(1);expect(other.rows).toHaveLength(1);expect(own.rows[0].id).not.toBe(other.rows[0].id);
    expect(own.rows[0].reportContextStatus).toBe('原始上下文未知（保留现值）');
    expect(other.rows[0]).toMatchObject({plannedQuantity:null,currentItemName:null,currentCustomerDueDate:null});
    expect((await query.list(resource.code,{},principal())).rows).toEqual([]);
    const [sum]=await db.query(`SELECT ${virtualColumns(MASTER_PLAN_RESOURCE_MAP.get('mps-weekly-plans')!).bendingReportedQuantity} n FROM mps_weekly_plans record WHERE tenant_id=$1`,[legacyTenant]);
    expect(Number(sum.n)).toBe(3); // another division's historical fact cannot flow into this plan
  });

  it('fences concurrent first execution against identity changes, including repeatable-read callers',async()=>{
    const {base,week}=await makeWeek();const ready=deferred(),finish=deferred();
    const saving=db.transaction(async m=>{await m.query("UPDATE mps_material_reports SET received=true,actual_inbound_date='2026-11-01' WHERE weekly_plan_id=$1 AND material_name='五金'",[week.id]);ready.resolve();await finish.promise;});
    await ready.promise;
    const changing=db.transaction('REPEATABLE READ',async m=>{await m.query('SELECT id FROM mps_weekly_plans WHERE id=$1',[week.id]);finish.resolve();await saving;await m.query("UPDATE mps_base_plans SET item_code='SYN-RACE' WHERE id=$1",[base.id]);});
    await expect(changing).rejects.toMatchObject({code:'40001'});
    expect((await db.query('SELECT item_code FROM mps_base_plans WHERE id=$1',[base.id]))[0].item_code).toBe('SYN-ITEM');
  });

  it('protects monthly and allocation identities even when base plans have no shipping parent',async()=>{
    const {week}=await makeWeek();
    const [allocation]=await db.query("INSERT INTO mps_order_allocations(tenant_id,division_id,order_number,item_code,allocated_quantity,created_by,updated_by)VALUES($1,$2,'SYN-ORDER','SYN-ITEM',10,$3,$3) RETURNING id",[tenant,division,user]);
    const [monthly]=await db.query("INSERT INTO mps_monthly_plans(tenant_id,division_id,order_number,item_code,allocation_id,required_quantity,created_by,updated_by)VALUES($1,$2,'SYN-ORDER','SYN-ITEM',$3,10,$4,$4) RETURNING id",[tenant,division,allocation.id,user]);
    await report(week.id);const before=await allReports();
    for(const [table,id] of [['mps_monthly_plans',monthly.id],['mps_order_allocations',allocation.id]]) {
      await expect(db.query(`UPDATE ${table} SET division_id=$2 WHERE id=$1`,[id,otherDivision])).rejects.toMatchObject({constraint:'ck_mps_executed_identity'});
    }
    expect(await allReports()).toEqual(before);
  });

  it('detects trusted raw inbound before allocation and cannot borrow another tenant stock linkage',async()=>{
    const {base,week}=await makeWeek();
    await db.query("INSERT INTO finished_goods_inbound VALUES('SYN-ERP','T+','SYN-INBOUND','SYN-ORDER','SYN-ITEM',1)");
    await db.query("INSERT INTO erp_staging_raw_records VALUES($1,'SYN-ORDER','SYN-ITEM','INBOUND_LINE','ST_RDRecord_b',true,'189','SYN-ERP','T+','SYN-INBOUND')",[tenant+'-OTHER']);
    expect((await db.query('SELECT mps_weekly_has_execution($1,$2) fact',[tenant,week.id]))[0].fact).toBe(false);
    await db.query('UPDATE erp_staging_raw_records SET tenant_id=$1',[tenant]);
    expect((await db.query('SELECT mps_weekly_has_execution($1,$2) fact',[tenant,week.id]))[0].fact).toBe(true);
    await expect(db.query("UPDATE mps_base_plans SET manufacturing_method='外协' WHERE id=$1",[base.id])).rejects.toMatchObject({constraint:'ck_mps_executed_identity'});
  });

  it('keeps historical nonprocess reports in production progress, explicitly marks inconsistent composite scope and filters division access',async()=>{
    await db.query("INSERT INTO mps_sync_configs(tenant_id,sync_key,name,enabled,created_by,updated_by)VALUES($1,'base-to-weekly','历史合成',true,$2,$2) ON CONFLICT DO NOTHING",[legacyTenant,user]);
    const {week}=await makeWeek('外协',legacyTenant);await rawLegacyReport(legacyTenant,week.id);
    await db.query("INSERT INTO mps_order_allocations(tenant_id,division_id,order_number,item_code,allocated_quantity,created_by,updated_by)VALUES($1,$2,'SYN-ORDER','SYN-ITEM',10,$3,$3)",[legacyTenant,division,user]);
    await db.query("INSERT INTO mps_monthly_plans(tenant_id,division_id,order_number,item_code,required_quantity,pending_quantity,created_by,updated_by)VALUES($1,$2,'SYN-ORDER','SYN-ITEM',10,10,$3,$3)",[legacyTenant,division,user]);
    await db.query("INSERT INTO mps_group_plans(tenant_id,primary_division_id,order_number,required_quantity,pending_quantity,created_by,updated_by)VALUES($1,$2,'SYN-ORDER',10,10,$3,$3)",[legacyTenant,division,user]);
    const progress=new MasterPlanOrderProgressService(db,query);
    const result=await progress.page({},principal(legacyTenant),'items');
    expect(result.rows).toHaveLength(1);expect(Number(result.rows[0].bendingReportedQuantity)).toBe(3);
    expect(result.rows[0].itemProductionProgress).toBeNull();expect(result.rows[0].itemProgressBasis).toContain('历史报工范围不一致');
    const scoped: MasterPlanActor={...principal(legacyTenant),isSystemAdmin:false,permissions:['*'],tableDataScopes:[]};
    // Field permissions are exercised separately above; this checks the progress resource's own division boundary.
    scoped.permissions=[mpsOrderProgressResource+':*:read',...Object.keys(result.rows[0]).map(f=>`${mpsOrderProgressResource}:${f}:read`)];
    scoped.tableDataScopes=[{resource:mpsOrderProgressResource,scope:'CUSTOM',rules:[{fieldKey:'divisionId',operator:'EQ',value:otherDivision}]}];
    const sql=progress.querySql({onlyUnfinishedOrders:'false',onlyUnfinishedItems:'false'},scoped,'items');
    const [restricted]=await db.query(sql.sql,sql.params);expect(restricted.data.rows).toEqual([]);
  });

  it('rejects direct historical snapshot rewrites and leaves every saved report field unchanged',async()=>{
    const {week}=await makeWeek();const created=await report(week.id);const before=await allReports();
    for(const [column,value] of [['planned_quantity',99],['item_name','SYN-MIGRATION'],['division_id',otherDivision]]) {
      await expect(db.query(`UPDATE mps_process_reports SET ${column}=$2,updated_by=$3,version=version+1 WHERE id=$1`,[created.id,value,user])).rejects.toMatchObject({constraint:'ck_mps_report_context'});
    }
    expect(await allReports()).toEqual(before);
  });

  it('blocks route rebuild after other execution facts without introducing another persistent process lock',async()=>{
    const {week}=await makeWeek();const structure=await tasks(week.id);
    await db.query("UPDATE mps_material_reports SET received=true,actual_inbound_date='2026-11-01' WHERE weekly_plan_id=$1 AND material_name='五金'",[week.id]);
    expect((await db.query('SELECT process_config_locked_at FROM mps_weekly_plans WHERE id=$1',[week.id]))[0].process_config_locked_at).toBeNull();
    await expect(db.transaction(async m=>{await m.query("SELECT set_config('app.mps_process_config_write_mode','CONFIRM',true)");await m.query('UPDATE mps_weekly_process_plans SET cycle_days=20 WHERE weekly_plan_id=$1',[week.id]);})).rejects.toMatchObject({constraint:'ck_mps_executed_identity'});
    expect(await tasks(week.id)).toEqual(structure);
  });

  it('exports current quantity and preserved snapshot from the same query, with field and export scopes enforced',async()=>{
    const {base,week}=await makeWeek();await report(week.id);const before=await allReports();
    await db.query('UPDATE mps_base_plans SET planned_quantity=12 WHERE id=$1',[base.id]);
    await sync.run(tenant,'base-to-weekly','MANUAL',user,'合成用户',randomUUID());
    const spreadsheets=new MasterPlanSpreadsheetService(db,query,app,directory as never);
    const buffer=await spreadsheets.export(resource.code,{},principal());const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer as never);
    const sheet=wb.worksheets[0],headers=sheet.getRow(1).values as string[];
    expect(Number(sheet.getRow(2).getCell(headers.indexOf('当前计划数量')).value)).toBe(12);
    expect(Number(sheet.getRow(2).getCell(headers.indexOf('保存上下文计划数量')).value)).toBe(10);
    const restricted: MasterPlanActor={...principal(),isSystemAdmin:false,permissions:[resource.code+':*:read',resource.code+':*:export',resource.code+':productionQuantity:read'],tableDataScopes:[{resource:resource.code,scope:'ALL',actions:['read']},{resource:resource.code,scope:'CUSTOM',actions:['export'],rules:[{fieldKey:'divisionId',operator:'EQ',value:otherDivision}]}]};
    expect((await query.exportRows(resource.code,{},restricted)).rows).toEqual([]);
    const visible=await query.list(resource.code,{},restricted);expect(visible.rows[0].productionQuantity).toBe('3.0000');expect(visible.rows[0].snapshotPlannedQuantity).toBeUndefined();expect(visible.rows[0].currentItemName).toBeUndefined();
    expect(await allReports()).toEqual(before);
  });

  it('Excel create and repeated confirmation remain idempotent and capture current lawful context',async()=>{
    const {week}=await makeWeek();const rows=[{id:null,expectedVersion:null,values:{weeklyPlanId:week.id,processCode:'bending',productionDate:'2026-11-01',productionQuantity:3}}];
    await app.importUpdates(resource.code,rows,'synthetic-create-hash',principal());
    expect((await app.importUpdates(resource.code,rows,'synthetic-create-hash',principal())).repeated).toBe(true);
    expect(await allReports()).toHaveLength(1);expect((await query.list(resource.code,{},principal())).rows[0].reportContextStatus).toBe('创建审计已验证');
  });

  it('does not physically rewrite the weekly parent for repeated placeholder refresh',async()=>{
    const {week}=await makeWeek('自制+外协');
    const before=await db.query('SELECT xmin::text,updated_at,updated_by,version FROM mps_weekly_plans WHERE id=$1',[week.id]);
    await sync.run(tenant,'base-to-weekly','MANUAL',user,'合成用户',randomUUID());
    expect(await db.query('SELECT xmin::text,updated_at,updated_by,version FROM mps_weekly_plans WHERE id=$1',[week.id])).toEqual(before);
  });

  it('concurrent/repeated synchronization preserves report IDs, audit actor and snapshot bytes',async()=>{
    const {week}=await makeWeek();await report(week.id);await report(week.id,2);const before=await allReports();
    const results=await Promise.allSettled([sync.run(tenant,'base-to-weekly','MANUAL',user,'后台甲',randomUUID()),sync.run(tenant,'base-to-weekly','MANUAL',user,'后台乙',randomUUID())]);
    expect(results.some(r=>r.status==='fulfilled')).toBe(true);
    for(const r of results)if(r.status==='rejected')expect(r.reason.message).toContain('该同步任务正在运行');
    await sync.run(tenant,'base-to-weekly','MANUAL',user,'后台重试',randomUUID());
    expect(await allReports()).toEqual(before);expect(await tasks(week.id)).toHaveLength(10);
  });
});
