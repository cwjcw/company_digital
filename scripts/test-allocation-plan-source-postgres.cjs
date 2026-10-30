#!/usr/bin/env node
/** Existing isolated PostgreSQL integration pattern; synthetic records only, no production env. */
const assert=require('node:assert/strict'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json'));
const {DataSource}=req('typeorm'),{Client}=req('pg');
const {MasterPlanSyncService}=req('./dist/modules/master-plan-system/master-plan.sync.service');
const {MasterPlanQueryService}=req('./dist/modules/master-plan-system/master-plan.query.service');
const {MasterPlanDashboardService}=req('./dist/modules/master-plan-system/master-plan.dashboard.service');
const {MasterPlanApplicationService}=req('./dist/modules/master-plan-system/master-plan.application.service');
const {MpsAllocationPlanSource1722920112000:Change}=req('./dist/migrations/1722920112000-MpsAllocationPlanSource');
const socket=process.env.KDOS_ALLOCATION_PLAN_TEST_SOCKET;
if(socket!==path.join(root,'test/allocation_plan_source/pg_socket'))throw Error('Dedicated isolated socket required');
const id=n=>'0199bc00-0000-7000-8000-'+String(n).padStart(12,'0'),user=id(1),division=id(2),other=id(3),four='d23442f9-4862-4641-b4a7-c8d470bc56ea';
const database='allocation_plans_'+Date.now(),control=new Client({host:socket,user:'knplan',database:'postgres'}),checks=[];
const actor={tenantId:'KAINAN',userId:user,username:'合成验收',isSystemAdmin:true,permissions:['*'],tableDataScopes:[],requestId:'allocation-source-fixture',source:'web'};
let db;const check=async(name,run)=>{await run();checks.push(name);console.log('PASS '+name)};
(async()=>{
 await control.connect();await control.query(`CREATE DATABASE ${database}`);
 db=new DataSource({type:'postgres',host:socket,username:'knplan',database,migrations:[path.join(root,'apps/api/dist/migrations/*.js')],logging:false});await db.initialize();await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');await db.runMigrations();
 console.log('PASS all migrations on fresh PostgreSQL18');
 const insert=async(table,values,manager=db)=>{const entries=Object.entries({tenant_id:'KAINAN',created_by:user,updated_by:user,...values});return(await manager.query(`INSERT INTO ${table}(${entries.map(([k])=>k)})VALUES(${entries.map((_,i)=>'$'+(i+1))})RETURNING *`,entries.map(([,v])=>v)))[0]};
 await db.query("INSERT INTO users(id,username,password_hash,display_name,tenant_id)VALUES($1,'allocation-fixture','unused','合成验收','KAINAN')",[user]);
 for(const [i,name]of[[division,'合成一部'],[other,'合成二部'],[four,'事业四部']])await db.query('INSERT INTO organization_units(id,name,level,enabled)VALUES($1,$2,1,true)',[i,name]);
 const alloc=(order,item,qty,values={})=>insert('mps_order_allocations',{order_number:order,item_code:item,allocated_quantity:qty,division_id:division,customer_code:'SYN-CUSTOMER',item_name:'合成品项',manually_maintained:true,order_status:'已审核',order_date:'2020-01-01',expected_shipping_date:'2030-01-01',...values});
 const month=(a,values={})=>insert('mps_monthly_plans',{allocation_id:a.id,order_number:a.order_number,item_code:a.item_code,division_id:a.division_id,customer_code:a.customer_code,required_quantity:a.allocated_quantity,pending_quantity:a.allocated_quantity,...values});
 const sync=new MasterPlanSyncService(db),project=()=>sync.run('KAINAN','plan-projections','MANUAL',user,'合成验收','fixture:'+Date.now()+Math.random()),base=()=>sync.shippingToBase('KAINAN',user,'合成验收');
 const query=new MasterPlanQueryService(db,{listEnabled:async()=>(await db.query('SELECT id,name FROM organization_units WHERE enabled')).map(x=>({...x,pathLabel:x.name}))});
 const {NotificationService}=req('./dist/modules/notifications/notification.service');
 const app=new MasterPlanApplicationService(db,{processOutbox:async()=>0},new NotificationService(db));
 const snapshot=async()=>({monthly:await db.query("SELECT * FROM mps_monthly_plans ORDER BY id"),group:await db.query("SELECT * FROM mps_group_plans ORDER BY id"),base:await db.query('SELECT * FROM mps_base_plans ORDER BY id'),weekly:await db.query('SELECT * FROM mps_weekly_plans ORDER BY id'),tasks:await db.query('SELECT * FROM mps_weekly_process_plans ORDER BY id'),reports:await db.query('SELECT * FROM mps_process_reports ORDER BY id'),audit:await db.query("SELECT * FROM audit_logs WHERE resource IN('mps-monthly-plans','mps-group-plans','mps-base-plans') ORDER BY id"),outbox:await db.query('SELECT * FROM mps_reconciliation_outbox ORDER BY id')});
 const absent=await alloc('SYN-NO-ERP','ITEM-NO',12),over=await alloc('SYN-OVER','ITEM-OVER',80);
 await insert('mps_erp_order_lines',{source_system:'T+',source_database:'UFTData418971_000003',source_key:'123',order_number:'SYN-OVER',item_code:'ITEM-OVER',order_quantity:1,order_date:'2026-10-01',customer_code:'SYN-CUSTOMER'});
 await insert('mps_data_exceptions',{exception_key:'allocation-projection:'+JSON.stringify(['SYN-OVER','ITEM-OVER']),resource:'mps-order-allocations',record_id:over.id,business_key:'SYN-OVER/ITEM-OVER',exception_type:'ALLOCATION_PROJECTION_BLOCKED',severity:'WARNING',message:'重复分配合计超过ERP订单数量',active:true});
 const erpBefore=await db.query('SELECT * FROM mps_erp_order_lines ORDER BY id');
 const unapproved=await alloc('SYN-UNAPPROVED','ITEM-U',50,{order_status:'未审核'});
 await alloc('SYN-SPLIT','ITEM-S',20);await alloc('SYN-SPLIT','ITEM-S',40);await alloc('SYN-SPLIT','ITEM-S',40,{division_id:other});
 await alloc('SYN-SPLIT','ITEM-S',999,{archived_at:new Date()});await alloc('SYN-SPLIT','ITEM-S',999,{order_status:'已撤销'});await alloc('SYN-SPLIT','ITEM-S',999,{order_status:'未审核'});
 await alloc('SYN-SPLIT','ITEM-SECOND',50);
 await alloc('SYN-MISSING','ITEM-M',3,{order_date:null,item_name:null});
 await alloc('SYN-OTHER-TENANT','ITEM-T',700,{tenant_id:'ISOLATED-OTHER'});
 const old=await alloc('SYN-HISTORY','ITEM-H',7,{archived_at:new Date()}),history=await month(old,{remark:'历史人工计划',latest_customer_due_date:'2028-01-01'});
 const oldGroup=await insert('mps_group_plans',{order_number:'SYN-HISTORY',required_quantity:7,pending_quantity:7,order_amount:456,order_type:'历史集团'});
 const conflictAlloc=await alloc('SYN-CONFLICT','ITEM-C',9,{archived_at:new Date()}),conflict=await month(conflictAlloc,{remark:'不可覆盖历史'});await alloc('SYN-CONFLICT','ITEM-C',77);
 await alloc('SYN-BAD','ITEM-X',8,{customer_code:null});await alloc('SYN-BAD','ITEM-Y',8,{manually_maintained:false});
 await check('A/B/D: absent ERP, over quantity, old order date; dates/unknown money remain NULL',async()=>{
  const result=await project();assert.equal(result.status,'SUCCESS');assert.equal(result.metrics.unapproved_allocations,3);assert.equal(result.metrics.missing_order_dates,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM mps_data_exceptions WHERE message='重复分配合计超过ERP订单数量' AND active"))[0].n,0);
  for(const a of[absent,over]){const[p]=await db.query('SELECT *,order_date::text AS source_day FROM mps_monthly_plans WHERE allocation_id=$1',[a.id]);assert(p);assert.equal(p.required_quantity,a.allocated_quantity);assert.equal(p.source_day,'2020-01-01');assert.equal(p.customer_due_date,null);assert.equal(p.latest_customer_due_date,null);assert.equal(p.preproduction_review_date,null);const[g]=await db.query('SELECT * FROM mps_group_plans WHERE order_number=$1',[a.order_number]);for(const field of['order_amount','source_accounts','order_type','customer_due_date','preproduction_review_date'])assert.equal(g[field],null);assert.equal(g.primary_division_id,division);}
 });
 await check('C: unapproved excluded; approval joins next existing sync run',async()=>{
  assert.equal((await db.query("SELECT * FROM mps_monthly_plans WHERE order_number='SYN-UNAPPROVED'")).length,0);
  await db.query("UPDATE mps_order_allocations SET order_status='已审核' WHERE id=$1",[unapproved.id]);await project();assert.equal((await db.query("SELECT required_quantity FROM mps_monthly_plans WHERE order_number='SYN-UNAPPROVED'"))[0].required_quantity,'50.0000');
 });
 await check('E/F: split 60/40, repeated rows once, archived/revoked/unapproved ignored, item completion average',async()=>{
  const rows=await db.query("SELECT * FROM mps_monthly_plans WHERE order_number='SYN-SPLIT' AND item_code='ITEM-S' ORDER BY division_id");assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>x.required_quantity),['60.0000','40.0000']);
  await db.query("UPDATE mps_monthly_plans SET cumulative_inbound_quantity=required_quantity,pending_quantity=0,completion_rate=1 WHERE order_number='SYN-SPLIT' AND item_code='ITEM-S'");
  await project();const[g]=await db.query("SELECT * FROM mps_group_plans WHERE order_number='SYN-SPLIT'");assert.equal(g.required_quantity,'150.0000');assert.equal(g.completed_quantity,'100.0000');assert.equal(g.completion_rate,'0.5000');assert.equal(g.primary_division_id,null);
  await db.query("UPDATE mps_monthly_plans SET cumulative_inbound_quantity=CASE WHEN division_id=$1 THEN 80 ELSE 0 END WHERE order_number='SYN-SPLIT' AND item_code='ITEM-S'",[division]);
  await project();const [partial]=await db.query("SELECT * FROM mps_group_plans WHERE order_number='SYN-SPLIT'");assert.equal(partial.completed_quantity,'80.0000');assert.equal(partial.completion_rate,'0.4000');
  await db.query("UPDATE mps_monthly_plans SET cumulative_inbound_quantity=required_quantity WHERE order_number='SYN-SPLIT' AND item_code='ITEM-S'");await project();
  assert.equal((await db.query("SELECT * FROM mps_monthly_plans WHERE tenant_id='ISOLATED-OTHER'")).length,0);
 });
 await check('G: historical IDs/manual fields intact, archived-key collision diagnosed, no source deletion',async()=>{
  assert.deepEqual((await db.query('SELECT * FROM mps_monthly_plans WHERE id=$1',[history.id]))[0],history);assert.deepEqual((await db.query('SELECT * FROM mps_group_plans WHERE id=$1',[oldGroup.id]))[0],oldGroup);assert.deepEqual((await db.query('SELECT * FROM mps_monthly_plans WHERE id=$1',[conflict.id]))[0],conflict);
  const exceptions=await db.query("SELECT message FROM mps_data_exceptions WHERE active AND exception_type='ALLOCATION_PROJECTION_BLOCKED'");assert(exceptions.some(x=>x.message.includes('历史')));assert(exceptions.some(x=>x.message.includes('无效')));
 });
 await check('K: existing monthly→base, separate division batches, manual protection and weekly/report history',async()=>{
  await base();const bases=await db.query("SELECT * FROM mps_base_plans WHERE order_number='SYN-SPLIT' AND item_code='ITEM-S' ORDER BY division_id");assert.equal(bases.length,2);assert.deepEqual(bases.map(x=>x.planned_quantity),['60.0000','40.0000']);assert.notEqual(bases[0].delivery_number,bases[1].delivery_number);
  await db.query("UPDATE mps_base_plans SET planned_quantity=99,latest_customer_due_date='2028-01-01' WHERE id=$1",[bases[0].id]);
  await db.transaction(async m=>{
  await m.query("SELECT set_config('app.mps_process_config_write_mode','INITIALIZE',true)");
  const week=await insert('mps_weekly_plans',{base_plan_id:bases[0].id,division_id:division,order_number:'SYN-SPLIT',item_code:'ITEM-S',delivery_number:bases[0].delivery_number,planned_quantity:99,manufacturing_method:'自制',latest_customer_due_date:'2028-01-01',latest_review_due_date:'2027-01-01'},m);
  await insert('mps_weekly_process_plans',{weekly_plan_id:week.id,process_code:'welding',process_name:'焊接',sequence:1,cycle_days:2,execution_enabled:true},m);
  await insert('mps_process_reports',{weekly_plan_id:week.id,division_id:division,order_number:'SYN-SPLIT',item_code:'ITEM-S',delivery_number:week.delivery_number,process_code:'welding',process_name:'焊接',planned_quantity:99,production_quantity:4,production_date:'2026-10-01'},m);
  });
  const before=await snapshot();await db.query("UPDATE mps_order_allocations SET allocated_quantity=30 WHERE order_number='SYN-SPLIT' AND item_code='ITEM-S' AND division_id=$1 AND allocated_quantity=20",[division]);await project();await base();const after=await snapshot();
  assert.deepEqual(after.weekly,before.weekly);assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(after.reports,before.reports);assert.deepEqual(after.base.find(x=>x.id===bases[0].id),before.base.find(x=>x.id===bases[0].id));
  // Monthly process aggregates must not borrow the other division's report.
  const page=await query.list('mps-monthly-plans',{search:'SYN-SPLIT'},actor);const same=page.rows.filter(x=>x.itemCode==='ITEM-S');assert.equal(same.find(x=>x.divisionId===division).weldingReportedQuantity,'4.0000');assert.equal(Number(same.find(x=>x.divisionId===other).weldingReportedQuantity),0);
  const dashboard=await new MasterPlanDashboardService(db,query).summary({dateType:'NONE',orderNumbers:['SYN-SPLIT']},actor);assert.equal(Number(dashboard.plans.requiredQuantity),160);assert.equal(Number(dashboard.processes.find(x=>x.code==='welding').values.reportedQuantity),4);
 });
 await check('H: same-source rerun/concurrent calls preserve IDs, quantities, audits, outbox and versions',async()=>{
  const before=await snapshot();const first=await project();assert.equal(first.count,0);await base();assert.deepEqual(await snapshot(),before);
  const run=()=>db.transaction(m=>req('./dist/modules/master-plan-system/master-plan.allocation-projection').reconcileAllocationPlans(m,'KAINAN',user,'合成验收'));await Promise.all([run(),run()]);assert.deepEqual(await snapshot(),before);
 });
 await check('verified receipt facts stay independent of allocated demand and refresh group through existing inbound task',async()=>{
  const a=await alloc('SYN-INBOUND','ITEM-IN',10,{division_id:four});await project();
  const before=(await db.query('SELECT * FROM mps_monthly_plans WHERE allocation_id=$1',[a.id]))[0];assert.equal(before.cumulative_inbound_quantity,'0.0000');
  const source={source_system:'T+',source_database:'UFTData418971_000003',order_number:'SYN-INBOUND',item_code:'ITEM-IN',customer_code:'SYN-CUSTOMER',raw_payload:{},content_hash:'synthetic-only',is_cancelled:false,source_active:true};
  await insert('erp_staging_raw_records',{...source,source_table:'SA_SaleOrder_b',source_id:'SYN-OL',record_type:'ORDER_LINE'});
  await insert('erp_staging_raw_records',{...source,source_table:'ST_RDRecord_b',source_id:'SYN-STOCK',record_type:'INBOUND_LINE',status_code:'189',order_link_stable:true});
  await db.query(`INSERT INTO finished_goods_inbound(source_system,source_database,source_key,sales_order_number,inventory_code,document_number,relation_info,received_quantity)
    VALUES('T+','UFTData418971_000003','SYN-STOCK','SYN-INBOUND','ITEM-IN','SYN-STOCK','合成关联',4)`);
  await sync.allocateInbound('KAINAN',user);
  const [p]=await db.query('SELECT * FROM mps_monthly_plans WHERE id=$1',[before.id]);assert.equal(p.required_quantity,'10.0000');assert.equal(p.cumulative_inbound_quantity,'4.0000');assert.equal(p.pending_quantity,'6.0000');
  const [g]=await db.query("SELECT * FROM mps_group_plans WHERE order_number='SYN-INBOUND'");assert.equal(g.required_quantity,'10.0000');assert.equal(g.completed_quantity,'4.0000');assert.equal(g.completion_rate,'0.4000');
 });
 await check('shipping create/import/update resolve monthly association by division without changing its independent workflow',async()=>{
  await db.query(`UPDATE mps_system_settings SET value_json='"2040-01-01T00:00:00Z"' WHERE tenant_id='KAINAN' AND setting_key='shipping_temporary_unlock_until'`);
  const values={orderNumber:'SYN-SPLIT',itemCode:'ITEM-S',divisionId:division,customerCode:'SYN-CUSTOMER',latestCustomerDueDate:'2030-01-01',plannedQuantity:2};
  const shipment=await app.create('mps-shipping-plans',values,actor);
  const [target]=await db.query("SELECT id FROM mps_monthly_plans WHERE order_number='SYN-SPLIT' AND item_code='ITEM-S' AND division_id=$1",[division]);assert.equal(shipment.monthly_plan_id,target.id);
  await app.update('mps-shipping-plans',shipment.id,{expectedVersion:shipment.version,divisionId:other},actor);
  const [moved]=await db.query('SELECT * FROM mps_shipping_plans WHERE id=$1',[shipment.id]);const [otherTarget]=await db.query("SELECT id FROM mps_monthly_plans WHERE order_number='SYN-SPLIT' AND item_code='ITEM-S' AND division_id=$1",[other]);assert.equal(moved.monthly_plan_id,otherTarget.id);
  const config=req('./dist/modules/master-plan-system/master-plan.config').MASTER_PLAN_RESOURCE_MAP.get('mps-shipping-plans');
  const map=await app.shippingMonthlyPlanIds(config,[{values},{values:{...values,divisionId:other}}],'KAINAN',db.manager);
  for(const who of[division,other]){const payload={...values,divisionId:who};await app.fillReportSource(config,payload,'KAINAN',db.manager,map);assert.equal(payload.monthlyPlanId,who===division?target.id:otherTarget.id)}
 });
 await check('transaction failure rolls back monthly/group/audit/outbox atomically',async()=>{
  const a=await alloc('SYN-ROLLBACK','ITEM-R',5),before=await snapshot();
  const helper=req('./dist/modules/master-plan-system/master-plan.allocation-projection').reconcileAllocationPlans;
  await assert.rejects(()=>db.transaction(m=>helper({query:(sql,params)=>{if(sql.includes('INSERT INTO audit_logs'))throw Error('synthetic audit failure');return m.query(sql,params)}},'KAINAN',user,'合成验收')),/synthetic audit failure/);
  assert.deepEqual(await snapshot(),before);await db.query('UPDATE mps_order_allocations SET archived_at=now() WHERE id=$1',[a.id]);
 });
 await check('I: ERP enabled/30min retained; independent collector still writes and no allocation mutation',async()=>{
  assert.deepEqual(await db.query('SELECT * FROM mps_erp_order_lines ORDER BY id'),erpBefore);
  const cfg=(await db.query("SELECT enabled,interval_minutes FROM mps_sync_configs WHERE tenant_id='KAINAN' AND sync_key='erp-orders'"))[0];assert(cfg.enabled);assert.equal(cfg.interval_minutes,30);
  const allocationBefore=await db.query('SELECT * FROM mps_order_allocations ORDER BY id');
  await db.query(`INSERT INTO sales_orders(source_system,source_database,source_key,order_number,item_number,item_name,order_date,quantity,business_quantity,close_status,customer_code)
    VALUES('T+','UFTData418971_000003','SYN-COLLECT','SYN-COLLECT','ITEM-COLLECT','独立ERP采集','2026-10-01',35,35,'已审核','SYN-CUSTOMER')`);
  await sync.projectOrders('KAINAN',user,user);
  const collected=await db.query("SELECT * FROM mps_erp_order_lines WHERE order_number='SYN-COLLECT'");assert.equal(collected.length,1);assert.equal(collected[0].order_quantity,'35.0000');
  assert.deepEqual(await db.query("SELECT * FROM mps_erp_order_lines WHERE order_number<>'SYN-COLLECT' ORDER BY id"),erpBefore);
  assert.deepEqual(await db.query('SELECT * FROM mps_order_allocations ORDER BY id'),allocationBefore);
  assert.equal((await db.query("SELECT * FROM mps_monthly_plans WHERE order_number='SYN-COLLECT'")).length,0);
 });
 await check('migration: populated up preserves rows, unsafe down rejects without deleting divided/null plans',async()=>{
  const before=await snapshot();await assert.rejects(()=>db.transaction(m=>new Change().down({query:(...a)=>m.query(...a)})),/有损回退/);assert.deepEqual(await snapshot(),before);
  await db.transaction(async m=>{
   await m.query(`CREATE SCHEMA source_upgrade_fixture; SET LOCAL search_path=source_upgrade_fixture,public;
    CREATE TABLE mps_monthly_plans(id uuid PRIMARY KEY,tenant_id text,order_number text,item_code text,division_id uuid,order_date date,remark text,
      CONSTRAINT uq_mps_monthly_plan UNIQUE(tenant_id,order_number,item_code));
    CREATE TABLE mps_group_plans(id uuid PRIMARY KEY,order_amount numeric NOT NULL);
    INSERT INTO mps_monthly_plans VALUES('${id(901)}','SYN','ORDER','ITEM','${division}','2020-01-01','原人工字段');
    INSERT INTO mps_group_plans VALUES('${id(902)}',45);`);
   const original=await m.query('SELECT * FROM mps_monthly_plans');
   await new Change().up({query:(...a)=>m.query(...a)});
   assert.deepEqual(await m.query('SELECT * FROM mps_monthly_plans'),original);
   await m.query(`INSERT INTO mps_monthly_plans VALUES('${id(903)}','SYN','ORDER','ITEM','${other}',NULL,'另一部');
    INSERT INTO mps_group_plans VALUES('${id(904)}',NULL)`);
   await m.query('DROP SCHEMA source_upgrade_fixture CASCADE');
  });
  assert.deepEqual(await snapshot(),before);
 });
 await check('API query/data/field scope: separate divisions, no new admission path bypass',async()=>{
  const scoped={...actor,isSystemAdmin:false,permissions:['mps-monthly-plans:*:read',...['orderNumber','itemCode','divisionId','requiredQuantity'].map(k=>'mps-monthly-plans:'+k+':read')],tableDataScopes:[{resource:'mps-monthly-plans',scope:'CUSTOM',actions:['read'],rules:[{fieldKey:'divisionId',operator:'EQ',value:other}]}]};const page=await query.list('mps-monthly-plans',{search:'SYN-SPLIT'},scoped);assert(page.rows.length);assert(page.rows.every(x=>x.divisionId===other));
  await assert.rejects(()=>query.list('mps-monthly-plans',{}, {...actor,isSystemAdmin:false,permissions:[]}));
  await assert.rejects(()=>app.create('mps-monthly-plans',{orderNumber:'BAD'},actor));
 });
 console.log(JSON.stringify({database,checks:checks.length,passed:checks}));
 // Keep this isolated DB for real local browser queries; caller may drop it after acceptance.
 require('node:fs').writeFileSync(path.join(root,'test/allocation_plan_source/database.txt'),database);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(db?.isInitialized)await db.destroy();await control.end()});
