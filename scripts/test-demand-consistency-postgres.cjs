#!/usr/bin/env node
// Synthetic, disposable PG18 database only. Never reads a production manifest or credentials.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module'),{randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json'));
req('reflect-metadata');const {DataSource}=req('typeorm');
const {MasterPlanSyncService,MASTER_PLAN_SYSTEM_USER_ID:system}=req('./dist/modules/master-plan-system/master-plan.sync.service');
const {MasterPlanApplicationService}=req('./dist/modules/master-plan-system/master-plan.application.service');
const {inspectDemandKey}=req('./dist/modules/master-plan-system/master-plan.consistency');
const socket=process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET;
if(!socket||!socket.includes('test/')||socket.includes('..'))throw Error('Dedicated test socket required');
const database='mps_consistency_'+Date.now(),tenant='SYN-CONSISTENCY',user='0199f100-0000-7000-8000-000000000001',division='0199f100-0000-7000-8000-000000000002';
let db;const passed=[];const check=async(name,fn)=>{await fn();passed.push(name);console.log('PASS '+name)};
(async()=>{
 const migrations=fs.readdirSync(path.join(root,'apps/api/dist/migrations')).filter(f=>/^\d{13}-\w+\.js$/.test(f)&&!f.startsWith('1722920120000-')).map(f=>path.join(root,'apps/api/dist/migrations',f));
 const schema='mps_schema_'+createHash('sha256').update(migrations.map(f=>fs.readFileSync(f)).join('')).digest('hex').slice(0,12);
 const admin=new DataSource({type:'postgres',host:socket,username:'knplan',database:'postgres'});await admin.initialize();
 const exists=(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[schema])).length>0;
 await admin.query('CREATE DATABASE '+database+(exists?' TEMPLATE '+schema:''));await admin.destroy();
 db=new DataSource({type:'postgres',host:socket,username:'knplan',database,migrations,poolSize:5,logging:false});await db.initialize();await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');await db.runMigrations({transaction:'all'});
 if(!exists){await db.destroy();await admin.initialize();await admin.query('CREATE DATABASE '+schema+' TEMPLATE '+database);await admin.destroy();await db.initialize();}
 const insert=async(table,values,m=db)=>{const entries=Object.entries({tenant_id:tenant,created_by:user,updated_by:user,...values});return(await m.query(`INSERT INTO ${table}(${entries.map(([k])=>k)})VALUES(${entries.map((_,i)=>'$'+(i+1))})RETURNING *`,entries.map(([,v])=>v)))[0]};
 await db.query("INSERT INTO users(id,tenant_id,username,password_hash,display_name,enabled)VALUES($1,$2,'synthetic-consistency','!','合成员工',true)",[user,tenant]);
 await db.query("INSERT INTO organization_units(id,name,level,enabled)VALUES($1,'合成事业部',1,true)",[division]);
 for(const key of ['plan-projections','shipping-to-base','base-to-weekly'])await insert('mps_sync_configs',{sync_key:key,name:'合成同步',enabled:true,interval_minutes:30});
 const sync=new MasterPlanSyncService(db),app=new MasterPlanApplicationService(db,sync);
 const actor=()=>({tenantId:tenant,userId:user,username:'合成员工',isSystemAdmin:true,permissions:['*'],tableDataScopes:[],requestId:randomUUID(),source:'web'});
 const alloc=(order,item,qty,values={})=>insert('mps_order_allocations',{order_number:order,item_code:item,division_id:division,customer_code:'SYN-CUSTOMER',item_name:'合成品项',order_date:'2026-10-01',allocated_quantity:qty,manually_maintained:true,order_status:'已审核',...values});
 const fixture=async(label,oldQty,newQty,{inbound=0,linked=false,oldSourceQty=0}={})=>{
  const order='SYN-'+label,item='SYN-ITEM-'+label;
  const archived=await alloc(order,item,oldSourceQty,{archived_at:new Date()});
  const monthly=await insert('mps_monthly_plans',{allocation_id:archived.id,order_number:order,item_code:item,division_id:division,customer_code:'SYN-CUSTOMER',required_quantity:oldQty,pending_quantity:oldQty,item_name:'合成品项',remark:'保留人工备注'});
  const base=await insert('mps_base_plans',{order_number:order,item_code:item,division_id:division,customer_code:'SYN-CUSTOMER',delivery_number:1,planned_quantity:oldQty,monthly_plan_id:linked?monthly.id:null,
   latest_customer_due_date:'2026-12-31',latest_review_due_date:'2026-12-15',product_attribute:'五金',surface_nature:'毛坯',manufacturing_method:'自制'});
  await insert('audit_logs',{actor_id:user,actor_name:'合成员工',resource:'mps-base-plans',record_id:base.id,action:'mps-base-plans.synchronized',request_id:randomUUID(),source:'api',after_json:JSON.stringify({...base,syncValues:{division_id:division,customer_code:'SYN-CUSTOMER',planned_quantity:String(oldQty)}})});
  let week;
  await db.transaction(async m=>{
    await m.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.mps_process_config_write_mode','INITIALIZE',true)",[tenant]);
    week=await insert('mps_weekly_plans',{base_plan_id:base.id,order_number:order,item_code:item,division_id:division,customer_code:'SYN-CUSTOMER',delivery_number:1,planned_quantity:oldQty,pending_quantity:oldQty,latest_customer_due_date:'2026-12-31',latest_review_due_date:'2026-12-15',manufacturing_method:'自制'},m);
    for(const [n,code]of ['bending','blank','surfaceTreatment','packaging'].entries())await insert('mps_weekly_process_plans',{weekly_plan_id:week.id,process_code:code,process_name:code,sequence:n+1,cycle_days:1,execution_enabled:true},m);
  });
  if(inbound){await db.query('UPDATE mps_monthly_plans SET cumulative_inbound_quantity=$2,pending_quantity=greatest(required_quantity-$2,0) WHERE id=$1',[monthly.id,inbound]);await db.query('UPDATE mps_weekly_plans SET allocated_inbound_quantity=$2,pending_quantity=greatest(planned_quantity-$2,0) WHERE id=$1',[week.id,inbound]);}
  const active=await alloc(order,item,newQty);
  const key={orderNumber:order,itemCode:item,divisionId:division};
  return {key,archived,active,monthly,base,week};
 };
 const event=async(f,scope={allocationKey:f.key},values={})=>insert('mps_reconciliation_outbox',{resource:'mps-order-allocations',record_id:f.active.id,sync_key:'plan-projections',scope_json:JSON.stringify(scope),idempotency_key:'synthetic:'+randomUUID(),actor_id:user,actor_name:'合成员工',...values});
 const run=async f=>{const e=await event(f);await sync.processOutboxEvent(tenant,e.id);return (await db.query('SELECT * FROM mps_reconciliation_outbox WHERE id=$1',[e.id]))[0]};
 const read=async f=>db.transaction(async m=>{await m.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);return inspectDemandKey(m,tenant,f.key)});
 const tasks=async f=>db.query('SELECT id,process_code,sequence,cycle_days,execution_enabled,daily_reported_quantity FROM mps_weekly_process_plans WHERE weekly_plan_id=$1 ORDER BY id',[f.week.id]);
 await check('strict schema installs only 129 additions, retains no lifecycle120',async()=>{assert.equal((await db.query("SELECT count(*)::int n FROM migrations WHERE timestamp=1722920120000"))[0].n,0);assert.equal((await db.query("SELECT count(*)::int n FROM migrations WHERE timestamp=1722920129000"))[0].n,1)});
 const a=await fixture('CASE-A',600,1200,{inbound:600});
 await check('case A: automatic provenance recovery preserves received600 and tasks, demand1200/pending600',async()=>{
  const before=await tasks(a);const e=await run(a);assert.equal(e.status,'SUCCESS',e.last_error);const s=await read(a);assert.deepEqual(s.reasons,[]);assert.equal(s.monthly.required_quantity,'1200.0000');assert.equal(s.bases[0].planned_quantity,'1200.0000');assert.equal(s.weeks[0].planned_quantity,'1200.0000');assert.equal(s.weeks[0].allocated_inbound_quantity,'600.0000');assert.equal(s.weeks[0].pending_quantity,'600.0000');assert.equal(s.monthly.id,a.monthly.id);assert.equal(s.bases[0].id,a.base.id);assert.equal(s.weeks[0].id,a.week.id);assert.deepEqual(await tasks(a),before);
 });
 const b=await fixture('CASE-B',4,8,{linked:true});
 await check('case B: existing stable base relation permits archived-zero source recovery',async()=>{assert.equal((await run(b)).status,'SUCCESS');const s=await read(b);assert.deepEqual(s.reasons,[]);assert.equal(s.monthly.allocation_id,b.active.id);assert.equal(s.bases[0].monthly_plan_id,b.monthly.id);assert.equal((await db.query('SELECT latest_review_due_date::text value_text FROM mps_base_plans WHERE id=$1',[b.base.id]))[0].value_text,'2026-12-15');});
 await check('repeat and two simultaneous consumers never duplicate plans/tasks/audits',async()=>{const before=await tasks(b),e=await event(b);await Promise.all([sync.processOutboxEvent(tenant,e.id),sync.processOutboxEvent(tenant,e.id)]);assert.equal((await db.query('SELECT status FROM mps_reconciliation_outbox WHERE id=$1',[e.id]))[0].status,'SUCCESS');assert.deepEqual(await tasks(b),before);assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE record_id=$1 AND action='allocation.source_recovered'",[b.monthly.id]))[0].n,1)});
 const multi=await fixture('MULTI',4,6);await alloc(multi.key.orderNumber,multi.key.itemCode,4);
 await check('multiple approved physical sources aggregate once and all link the same demand',async()=>{assert.equal((await run(multi)).status,'SUCCESS');const s=await read(multi);assert.equal(s.monthly.required_quantity,'10.0000');assert(s.allocations.every(a=>a.monthly_plan_id===s.monthly.id));});
 const conflict=await fixture('CONFLICT',4,8,{oldSourceQty:4});
 await check('nonzero archived independent demand remains BLOCKED without meaningless automatic retry',async()=>{const e=await run(conflict);assert.equal(e.status,'FAILED');assert.equal(e.next_attempt_at,Infinity);assert.equal((await read(conflict)).monthly.required_quantity,'4.0000');assert.equal((await read(conflict)).monthly.allocation_id,conflict.archived.id)});
 const manual=await fixture('MANUAL',4,8);
 await db.query('UPDATE mps_base_plans SET planned_quantity=3 WHERE id=$1',[manual.base.id]);
 await insert('audit_logs',{actor_id:user,actor_name:'合成员工',resource:'mps-base-plans',record_id:manual.base.id,action:'mps-base-plans.batch_item_updated',before_json:JSON.stringify({planned_quantity:'4'}),after_json:JSON.stringify({planned_quantity:'3'}),source:'web',request_id:randomUUID()});
 await check('manual base quantity stays3, demand8 and explicit unallocated gap5 remain visible',async()=>{const e=await run(manual);assert.equal(e.status,'FAILED');const s=await read(manual);assert.equal(s.monthly.required_quantity,'8.0000');assert.equal(s.bases[0].planned_quantity,'3.0000');assert.equal(s.bases[0].monthly_plan_id,manual.monthly.id);assert((await db.query("SELECT message FROM mps_data_exceptions WHERE record_id=$1 AND exception_type='DEMAND_ALLOCATION_GAP' AND active",[manual.monthly.id]))[0].message.includes('5.0000'));});
 const weekManual=await fixture('MANUAL-WEEK',4,8);
 await db.query('UPDATE mps_weekly_plans SET planned_quantity=3,pending_quantity=3 WHERE id=$1',[weekManual.week.id]);
 await insert('audit_logs',{actor_id:user,actor_name:'合成员工',resource:'mps-weekly-plans',record_id:weekManual.week.id,action:'mps-weekly-plans.updated',before_json:JSON.stringify({plannedQuantity:4}),after_json:JSON.stringify({plannedQuantity:3}),source:'web',request_id:randomUUID()});
 await check('manual weekly scheduling quantity is protected while upstream demand updates',async()=>{assert.equal((await run(weekManual)).status,'FAILED');const s=await read(weekManual);assert.equal(s.bases[0].planned_quantity,'8.0000');assert.equal(s.weeks[0].planned_quantity,'3.0000');});
 const json=await fixture('JSONB',4,8);const oldScope={allocation:{id:json.active.id,expectedVersion:1,orderNumber:json.key.orderNumber,itemCode:json.key.itemCode,divisionId:division}};
 const je=await event(json,oldScope);const config=(await db.query("SELECT id FROM mps_sync_configs WHERE tenant_id=$1 AND sync_key='plan-projections'",[tenant]))[0];
 await insert('mps_sync_logs',{sync_config_id:config.id,sync_key:'plan-projections',run_type:'EVENT',status:'FAILED',started_at:new Date(),idempotency_key:je.idempotency_key,attempts:1,scope_json:JSON.stringify({allocation:{divisionId:division,itemCode:json.key.itemCode,orderNumber:json.key.orderNumber,expectedVersion:1,id:json.active.id}})});
 await db.query('UPDATE mps_order_allocations SET allocated_quantity=9,version=version+1 WHERE id=$1',[json.active.id]);
 await check('JSONB key order and stale events recompute latest source instead of restoring old demand',async()=>{await sync.processOutboxEvent(tenant,je.id);assert.equal((await db.query('SELECT status,last_error FROM mps_reconciliation_outbox WHERE id=$1',[je.id]))[0].status,'SUCCESS');assert.equal((await read(json)).monthly.required_quantity,'9.0000');});
 const failed=await fixture('FAILED-RECOVERY',4,8);const old=await event(failed,undefined,{status:'FAILED',attempts:10,last_error:'synthetic old scope defect'});
 await check('bounded existing scheduler discovers missed demand and compensates exhausted events with retained evidence',async()=>{let scans=0;for(let n=0;n<4;n++){const r=await sync.scanConsistencyPage(tenant,100);scans+=r.scanned??0;}await sync.processOutbox();const s=await read(failed);assert.deepEqual(s.reasons,[]);const [o]=await db.query('SELECT status,superseded_by FROM mps_reconciliation_outbox WHERE id=$1',[old.id]);assert.equal(o.status,'FAILED');assert(o.superseded_by);assert(scans>0);});
 await check('same-key blocked job cannot stop an independent valid demand',async()=>{const healthy=await fixture('INDEPENDENT',2,9);assert.equal((await run(healthy)).status,'SUCCESS');assert.deepEqual((await read(healthy)).reasons,[]);assert.equal((await read(conflict)).monthly.required_quantity,'4.0000');});
 await check('public actor ID cannot acquire the internal automatic recovery capability',async()=>{await assert.rejects(()=>sync.run(tenant,'plan-projections','RECONCILIATION',system,'forged',randomUUID(),{allocationKey:b.key}),/系统消费者/);});
 await check('source guard rejects unaudited pointer swaps and forged service role writes',async()=>{const f=await fixture('GUARD',4,8,{inbound:2});await assert.rejects(()=>db.query('UPDATE mps_monthly_plans SET allocation_id=$2 WHERE id=$1',[f.monthly.id,f.active.id]),e=>e.code==='23514');await assert.rejects(()=>db.transaction(async m=>{await m.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);await m.query('SET LOCAL ROLE mps_demand_link_service');await m.query('UPDATE mps_monthly_plans SET allocation_id=$2 WHERE id=$1',[f.monthly.id,f.active.id]);}),e=>['23514','42501'].includes(e.code));});
 const split=await fixture('BATCHES',4,10,{linked:true});
 const extra=await insert('mps_base_plans',{order_number:split.key.orderNumber,item_code:split.key.itemCode,division_id:division,customer_code:'SYN-CUSTOMER',delivery_number:2,planned_quantity:6,monthly_plan_id:split.monthly.id});
 await check('legitimate stable 4+6 base batches conserve demand10 without overwriting either batch',async()=>{assert.equal((await run(split)).status,'SUCCESS');const s=await read(split);assert.deepEqual(s.bases.map(x=>x.planned_quantity).sort(),['4.0000','6.0000']);assert(s.bases.some(x=>x.id===extra.id));});
 const reported=await fixture('REPORTED',4,8);
 const report=await insert('mps_process_reports',{weekly_plan_id:reported.week.id,process_code:'bending',process_name:'bending',division_id:division,order_number:reported.key.orderNumber,item_code:reported.key.itemCode,delivery_number:1,planned_quantity:4,production_date:'2026-11-01',production_quantity:2});
 await check('positive report snapshots and locked process IDs survive safe demand increase',async()=>{assert.equal((await run(reported)).status,'SUCCESS');assert.deepEqual((await db.query('SELECT * FROM mps_process_reports WHERE id=$1',[report.id]))[0],report);assert.equal((await read(reported)).weeks[0].planned_quantity,'8.0000');});
 const customer=await fixture('CUSTOMER-CONFLICT',4,8);await db.query("UPDATE mps_order_allocations SET customer_code='SYN-OTHER' WHERE id=$1",[customer.active.id]);
 await check('real customer ownership conflict retains old demand and provenance',async()=>{assert.equal((await run(customer)).status,'FAILED');const s=await read(customer);assert.equal(s.monthly.required_quantity,'4.0000');assert.equal(s.monthly.allocation_id,customer.archived.id);});
 const grouped=await fixture('GROUP',4,8);const sibling=await alloc(grouped.key.orderNumber,'SYN-SIBLING',5);
 await check('whole-order summary includes independent sibling demand even before its monthly row exists',async()=>{assert.equal((await run(grouped)).status,'SUCCESS');assert.equal((await db.query('SELECT required_quantity FROM mps_group_plans WHERE tenant_id=$1 AND order_number=$2',[tenant,grouped.key.orderNumber]))[0].required_quantity,'13.0000');assert.equal((await db.query('SELECT allocated_quantity FROM mps_order_allocations WHERE id=$1',[sibling.id]))[0].allocated_quantity,'5.0000');});

 await check('multi-batch residual is visible and never claims success or overwrites scheduled batches',async()=>{
  await db.query('UPDATE mps_order_allocations SET allocated_quantity=12,version=version+1 WHERE id=$1',[split.active.id]);
  assert.equal((await run(split)).status,'FAILED');const s=await read(split);assert.equal(s.monthly.required_quantity,'12.0000');assert.deepEqual(s.bases.map(x=>x.planned_quantity).sort(),['4.0000','6.0000']);assert(s.reasons.includes('基础计划需求差异'));
 });
 await check('independent division demand and cross-tenant reads preserve identities and quantities',async()=>{
  const other=randomUUID();await db.query("INSERT INTO organization_units(id,name,level,enabled)VALUES($1,'合成第二事业部',1,true)",[other]);
  const source=await alloc(b.key.orderNumber,b.key.itemCode,5,{division_id:other});const f={...b,active:source,key:{...b.key,divisionId:other}};
  assert.equal((await run(f)).status,'SUCCESS');assert.equal((await read(f)).monthly.required_quantity,'5.0000');assert.equal((await read(b)).monthly.required_quantity,'8.0000');
  const stranger=await db.transaction(m=>inspectDemandKey(m,'SYN-OTHER-TENANT',b.key));assert.equal(stranger.allocations.length,0);assert.equal(stranger.monthly,null);assert.equal(stranger.bases.length,0);
 });
 await check('exhausted transient compensation is rediscovered after backoff without rewriting failed history',async()=>{
  const f=await fixture('TRANSIENT',4,8);const old=await event(f,undefined,{resource:'mps-demand-consistency',status:'FAILED',attempts:10,last_error:'synthetic transient',updated_at:new Date(Date.now()-7*3600000)});
  await sync.scanConsistencyPage(tenant,100);
  const [next]=await db.query("SELECT id FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND scope_json=$2::jsonb AND id<>$3 ORDER BY created_at DESC LIMIT 1",[tenant,JSON.stringify({allocationKey:f.key}),old.id]);assert(next);
  await sync.processOutboxEvent(tenant,next.id);assert.deepEqual((await read(f)).reasons,[]);const [kept]=await db.query('SELECT status,superseded_by FROM mps_reconciliation_outbox WHERE id=$1',[old.id]);assert.equal(kept.status,'FAILED');assert.equal(kept.superseded_by,next.id);
 });
 await check('legacy exhausted failures are prioritized without waiting for the historical sweep',async()=>{
  const f=await fixture('LEGACY-PRIORITY',4,8);const old=await event(f,undefined,{status:'FAILED',attempts:10,last_error:'synthetic legacy'});
  const [cp]=await db.query('SELECT source_updated_at::text cursor,source_id,sweep_id,last_sweep_at FROM mps_consistency_checkpoints WHERE tenant_id=$1',[tenant]);
  await db.query("UPDATE mps_consistency_checkpoints SET source_updated_at=now()+interval '1 hour',last_sweep_at=now() WHERE tenant_id=$1",[tenant]);
  await sync.scanConsistencyPage(tenant,100);const [next]=await db.query("SELECT id FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND resource='mps-demand-consistency' AND scope_json=$2::jsonb ORDER BY created_at DESC LIMIT 1",[tenant,JSON.stringify({allocationKey:f.key})]);assert(next);
  await sync.processOutboxEvent(tenant,next.id);assert.deepEqual((await read(f)).reasons,[]);
  await db.query('UPDATE mps_consistency_checkpoints SET source_updated_at=$2,source_id=$3,sweep_id=$4,last_sweep_at=$5 WHERE tenant_id=$1',[tenant,cp.cursor,cp.source_id,cp.sweep_id,cp.last_sweep_at]);
 });
 await check('retired empty keys verify cleanly, but retained plans without active sources stay protected',async()=>{
  const empty=await alloc('SYN-RETIRED','SYN-RETIRED-ITEM',0,{archived_at:new Date(),updated_at:new Date('2020-01-01')});const f={active:empty,key:{orderNumber:empty.order_number,itemCode:empty.item_code,divisionId:division}};
  const old=await event(f,undefined,{resource:'mps-demand-consistency',status:'FAILED',attempts:1,next_attempt_at:Infinity});
  assert.deepEqual((await read(f)).reasons,[]);await sync.scanConsistencyPage(tenant,100);
  const [next]=await db.query("SELECT id FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND scope_json=$2::jsonb AND status='PENDING' ORDER BY created_at DESC LIMIT 1",[tenant,JSON.stringify({allocationKey:f.key})]);assert(next);await sync.processOutboxEvent(tenant,next.id);
  assert.equal((await db.query('SELECT superseded_by FROM mps_reconciliation_outbox WHERE id=$1',[old.id]))[0].superseded_by,next.id);
  const retained=await fixture('RETIRED-RETAINED',4,8);await db.query('UPDATE mps_order_allocations SET archived_at=now() WHERE id=$1',[retained.active.id]);assert.equal((await run(retained)).status,'FAILED');const state=await read(retained);assert.equal(state.monthly.id,retained.monthly.id);assert(state.reasons.includes('没有可验证的有效分配来源'));assert.equal(state.monthly.required_quantity,'4.0000');
 });
 await check('real conflict marks order rollup incomplete while its independent healthy sibling still progresses',async()=>{
  const blocked=await fixture('SAME-ORDER-CONFLICT',4,8,{oldSourceQty:4});
  await insert('mps_group_plans',{order_number:blocked.key.orderNumber,customer_code:'SYN-CUSTOMER',required_quantity:4,pending_quantity:4});
  const source=await alloc(blocked.key.orderNumber,'SYN-HEALTHY-SIBLING',3);const healthy={active:source,key:{orderNumber:source.order_number,itemCode:source.item_code,divisionId:division}};
  assert.equal((await run(healthy)).status,'FAILED');const state=await read(healthy);assert.equal(state.monthly.required_quantity,'3.0000');assert.equal(state.bases[0].planned_quantity,'3.0000');assert(state.reasons.includes('集团汇总来源存在未完成范围'));
  assert.equal((await db.query('SELECT required_quantity FROM mps_group_plans WHERE tenant_id=$1 AND order_number=$2',[tenant,source.order_number]))[0].required_quantity,'4.0000');assert.equal((await read(blocked)).monthly.allocation_id,blocked.archived.id);
 });
 await check('manual base customer ownership is a permanent business conflict, not a transient retry loop',async()=>{
  const f=await fixture('BASE-CUSTOMER',4,8);await db.query("UPDATE mps_base_plans SET customer_code='SYN-OTHER' WHERE id=$1",[f.base.id]);const event=await run(f);assert.equal(event.status,'FAILED');assert.equal(event.next_attempt_at,Infinity);const state=await read(f);assert.equal(state.monthly.allocation_id,f.archived.id);assert.equal(state.monthly.required_quantity,'4.0000');assert.equal(state.bases[0].customer_code,'SYN-OTHER');
 });
 await check('consistent reruns keep row versions, IDs and audits stable',async()=>{
  const before=await read(a),taskBefore=await tasks(a);assert.equal((await run(a)).status,'SUCCESS');const after=await read(a);assert.equal(before.monthly.version,after.monthly.version);assert.equal(before.bases[0].version,after.bases[0].version);assert.equal(before.weeks[0].version,after.weeks[0].version);assert.deepEqual(await tasks(a),taskBefore);
 });
 const routes=await fixture('WRITES',4,8);await run(routes);
 const queued=Object.create(sync);queued.processOutbox=async()=>0;const commands=new MasterPlanApplicationService(db,queued);
 await check('single/API update, batch update and Excel confirm each persist the same bounded key workflow',async()=>{
   const current=async()=>(await db.query('SELECT * FROM mps_order_allocations WHERE id=$1',[routes.active.id]))[0];
   await commands.update('mps-order-allocations',routes.active.id,{expectedVersion:(await current()).version,allocatedQuantity:9},actor());
   await commands.batchUpdate('mps-order-allocations',{idempotencyKey:randomUUID(),fieldKey:'allocatedQuantity',value:10,records:[{id:routes.active.id,expectedVersion:(await current()).version}]},actor());
   const batch={id:randomUUID(),worksheet:'合成导入',fileHash:'a'.repeat(64)};
   await commands.importUpdates('mps-order-allocations',[{row:2,id:null,expectedVersion:null,values:{divisionId:division,orderNumber:routes.key.orderNumber,itemCode:routes.key.itemCode,customerCode:'SYN-CUSTOMER',allocatedQuantity:1,orderStatus:'已审核'}}],batch.fileHash,actor(),undefined,batch);
   const events=await db.query("SELECT id,scope_json FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND scope_json->'allocationKey'->>'orderNumber'=$2 AND status='PENDING' ORDER BY created_at",[tenant,routes.key.orderNumber]);assert.equal(events.length,3);assert(events.every(e=>e.scope_json.allocationKey&&e.scope_json.allocationKey.itemCode===routes.key.itemCode));
   for(const e of events)await sync.processOutboxEvent(tenant,e.id);assert.equal((await read(routes)).monthly.required_quantity,'11.0000');assert.deepEqual((await read(routes)).reasons,[]);
 });
 await check('policy upgrade restarts the historical sweep exactly once and persists its next-page cursor',async()=>{
  await db.query("UPDATE mps_consistency_checkpoints SET metrics=metrics-'policyVersion',sweep_id='ffffffff-ffff-ffff-ffff-ffffffffffff',last_sweep_at=now() WHERE tenant_id=$1",[tenant]);
  const first=await sync.scanConsistencyPage(tenant,1);assert.equal(first.sweepRows,1);const [one]=await db.query('SELECT sweep_id,metrics FROM mps_consistency_checkpoints WHERE tenant_id=$1',[tenant]);assert.equal(one.metrics.policyVersion,'v2');
  const second=await sync.scanConsistencyPage(tenant,1);assert.equal(second.sweepRows,1);const [two]=await db.query('SELECT sweep_id FROM mps_consistency_checkpoints WHERE tenant_id=$1',[tenant]);assert(two.sweep_id>one.sweep_id);
 });
 for(const lockKind of ['monthly-base','delivery'])await check('lock order with concurrent '+lockKind+' owner never holds the monthly row ahead of its predecessor',async()=>{
  const f=await fixture('LOCK-'+lockKind,4,8,{linked:true});await run(f);await db.query('UPDATE mps_order_allocations SET allocated_quantity=9,version=version+1 WHERE id=$1',[f.active.id]);
  const owner=db.createQueryRunner();await owner.connect();await owner.startTransaction();let pending;
  try{
   await owner.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
   if(lockKind==='monthly-base')await owner.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[tenant+':mps-monthly-base']);
   else await owner.query('SELECT pg_advisory_xact_lock(hashtext($1))',['mps-delivery-code:'+tenant+':'+f.key.orderNumber+':'+f.key.itemCode]);
   pending=run(f);let waiting=false;
   for(let n=0;n<100;n++){const [r]=await db.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) waiting");if(r.waiting){waiting=true;break}await new Promise(r=>setTimeout(r,10));}
   assert(waiting,'consumer must demonstrably wait at the predecessor advisory lock');
   await owner.query('SELECT id FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2 FOR SHARE NOWAIT',[tenant,f.monthly.id]);await owner.commitTransaction();
  }finally{if(owner.isTransactionActive)await owner.rollbackTransaction();await owner.release();}
  const result=await pending;assert.equal(result.status,'SUCCESS',result.last_error);assert.equal((await read(f)).monthly.required_quantity,'9.0000');
 });
 console.log(JSON.stringify({passed:passed.length,checks:passed}));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1}).finally(async()=>{if(db?.isInitialized)await db.destroy()});
