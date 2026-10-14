#!/usr/bin/env node
/** Isolated real PostgreSQL, synthetic fixtures; optional real source remains private. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json'));
const {DataSource}=req('typeorm'),{Client}=req('pg'),Excel=req('exceljs');
const {MasterPlanApplicationService}=req('./dist/modules/master-plan-system/master-plan.application.service');
const {MasterPlanSpreadsheetService}=req('./dist/modules/master-plan-system/master-plan-spreadsheet.service');
const {OrderAllocationConfigService}=req('./dist/modules/master-plan-system/order-allocation-config.service');
const {OrderAllocationDeliveryService}=req('./dist/modules/notifications/order-allocation.delivery.service');
const {NotificationService}=req('./dist/modules/notifications/notification.service');
const {allocationChange,parseAllocationWorkbook}=req('./dist/modules/master-plan-system/order-allocation.domain');
const host=process.env.PMC_TEST_POSTGRES_HOST;if(!host?.startsWith('/tmp/kdos-pmc-pg-'))throw Error('Isolated socket required');
const name='pmc_alloc_test_'+Date.now(),control=new Client({host,user:'knplan',database:'postgres'});let db;const checks=[];
const actor={tenantId:'KAINAN',userId:'0199f000-0000-7000-8000-000000000001',username:'isolated test',isSystemAdmin:true,permissions:['*'],tableDataScopes:[],requestId:'pmc-allocation-test',source:'web'};
const check=async(label,run)=>{await run();checks.push(label);console.log('PASS '+label);};
const id=n=>'0199e000-0000-7000-8000-'+String(n).padStart(12,'0');
(async()=>{
 await control.connect();await control.query(`CREATE DATABASE ${name}`);
 db=new DataSource({type:'postgres',host,username:'knplan',database:name,migrations:[path.join(root,'apps/api/dist/migrations/*.js')],logging:false});await db.initialize();await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');await db.runMigrations();checks.push('all 92 migrations on fresh PostgreSQL18');
 await db.query(`INSERT INTO users(id,username,display_name,password_hash,enabled,tenant_id,wechat_user_id) VALUES($1,'fixture','测试员工','unused',true,'KAINAN','synthetic-wecom')`,[actor.userId]);
 const units=['事业一部','事业二部','事业三部','事业四部','采购部'];for(let i=0;i<units.length;i++)await db.query(`INSERT INTO organization_units(id,name,level,enabled) VALUES($1::uuid,$2,1,true)`,[id(i+10),units[i]]);
 const delivery=new OrderAllocationDeliveryService(db),notifications=new NotificationService(db,delivery),config=new OrderAllocationConfigService(db,notifications);
 const sync={processOutbox:async()=>({}),run:async()=>({})};const app=new MasterPlanApplicationService(db,sync,notifications);
 const directory={listEnabled:async()=>units.map((name,i)=>({id:id(i+10),name,pathLabel:name})),resolve:(value,options)=>{const all=options.filter(o=>o.id===value||o.name===value);if(all.length!==1)throw Error('unit missing');return all[0];}};
 const spreadsheet=new MasterPlanSpreadsheetService(db,{},app,directory);
 await config.seed('KAINAN',actor.userId);
 await check('five exact mapping seeds, five units, one disabled rule; idempotent initialization',async()=>{await config.seed('KAINAN',actor.userId);const data=await config.read(actor);assert.equal(data.vendors.length,5);assert.equal(data.recipients.length,5);assert.equal(data.rule.enabled,false);assert.equal((await db.query("SELECT count(*)::int n FROM notification_rules WHERE event_type='mps.order_allocation.batch_changed'"))[0].n,1);});
 await check('raw create marks manual ownership without disabled-rule backlog or money audit',async()=>{const result=await app.create('mps-order-allocations',{orderNumber:'SYN-1',orderSequence:'001',itemCode:'00001',allocatedQuantity:'1',divisionId:id(10),salespersonName:'测试员工',remark:'人工保留'},actor);assert(result.id);const [row]=await db.query("SELECT * FROM mps_order_allocations WHERE order_number='SYN-1'");assert(row.manually_maintained);assert.equal((await db.query('SELECT count(*)::int n FROM notification_outbox'))[0].n,0);assert(!(await db.query("SELECT after_json FROM audit_logs WHERE action='mps-order-allocations.created'"))[0].after_json.tax_included_amount);});
 await db.query("UPDATE mps_order_allocations SET tax_included_unit_price='2.500000',tax_included_amount='55.50' WHERE order_number='SYN-1'");
 const buffer=async(rows)=>{const w=new Excel.Workbook(),s=w.addWorksheet('分配');s.addRow(['订单单号','订单序号','品号','业务员','供应商名称','已分配数量','备注','含税单价','含税金额','原币单价','采购金额']);s.addRows(rows);return Buffer.from(await w.xlsx.writeBuffer());};
 const preview=async(rows)=>spreadsheet.preview('mps-order-allocations',{originalname:'ERP.xlsx',buffer:await buffer(rows)},actor);
 await check('preview-only, blank preservation, price exclusion and new/change/nochange classification',async()=>{const p=await preview([['SYN-1','001','00001','测试员工','事业一部','1','','999','999','999','999'],['SYN-2','002','00002','测试员工','事业二部','2','新增']]);assert.equal(p.counts.created,1);assert.equal(p.counts.updated,1); // supplier metadata is new; remark survives blank
 assert(p.previewId);assert.equal((await db.query('SELECT count(*)::int n FROM mps_order_allocations'))[0].n,1);await spreadsheet.confirm('mps-order-allocations',p.previewId,actor);assert.equal((await db.query("SELECT remark FROM mps_order_allocations WHERE order_number='SYN-1'"))[0].remark,'人工保留');const repeat=await spreadsheet.confirm('mps-order-allocations',p.previewId,actor);assert(repeat.repeated);const replay=await preview([['SYN-1','001','00001','测试员工','事业一部','1','','777','777','777','777'],['SYN-2','002','00002','测试员工','事业二部','2','新增']]);assert.equal(replay.counts.unchanged,2);assert.equal(replay.counts.updated,0);const confirmed=await spreadsheet.confirm('mps-order-allocations',replay.previewId,actor);assert.equal(confirmed.updated,0);assert.equal(confirmed.created,0);});
 await check('preview blocks unknown supplier and split keys; no writes',async()=>{const p=await preview([['SYN-3','001','00001','测试员工','未知供应商','1']]);assert.equal(p.previewId,null);assert(p.errors.length);const split=await preview([['SYN-3','001','00001','测试员工','事业一部','1'],['SYN-3','002','00001','测试员工','事业二部','1']]);assert(split.errors.length);});
 await check('optimistic confirm rejects stale records atomically',async()=>{const p=await preview([['SYN-1','001','00001','测试员工','事业一部','3']]);await db.query("UPDATE mps_order_allocations SET version=version+1 WHERE order_number='SYN-1'");await assert.rejects(()=>spreadsheet.confirm('mps-order-allocations',p.previewId,actor));assert.equal((await db.query("SELECT allocated_quantity FROM mps_order_allocations WHERE order_number='SYN-1'"))[0].allocated_quantity,'1.0000');});
 if(process.env.PMC_REAL_EXCEL){await check('actual original source parses 163 rows/33 orders and imports/replays in isolation',async()=>{const original=fs.readFileSync(process.env.PMC_REAL_EXCEL);const parsed=await parseAllocationWorkbook(original);assert.equal(parsed.rows.length,163);assert.equal(parsed.orderCount,33);assert.equal(parsed.errors.length,0);const p=await spreadsheet.preview('mps-order-allocations',{originalname:'10.13.xlsx',buffer:original},actor);assert.equal(p.errors.length,0);assert.equal(p.counts.created,163);const beforeMoney=await db.query("SELECT id,tax_included_unit_price,tax_included_amount FROM mps_order_allocations ORDER BY id");const result=await spreadsheet.confirm('mps-order-allocations',p.previewId,actor);assert.equal(result.created,163);const again=await spreadsheet.preview('mps-order-allocations',{originalname:'10.13.xlsx',buffer:original},actor);assert.equal(again.counts.unchanged,163);await spreadsheet.confirm('mps-order-allocations',again.previewId,actor);for(const money of beforeMoney)assert.deepEqual((await db.query('SELECT id,tax_included_unit_price,tax_included_amount FROM mps_order_allocations WHERE id=$1',[money.id]))[0],money);assert.equal((await db.query("SELECT count(*)::int n FROM mps_order_allocations WHERE order_number NOT LIKE 'SYN-%' AND (tax_included_unit_price IS NOT NULL OR tax_included_amount IS NOT NULL)"))[0].n,0);});}
 await check('configuration rejects foreign tenant employees and stale versions, records audit',async()=>{await db.query(`INSERT INTO users(id,username,display_name,password_hash,tenant_id,enabled,wechat_user_id) VALUES($1,'foreign','测试员工','unused','OTHER',true,'foreign-wecom')`,[id(100)]);const data=await config.read(actor);const r=data.recipients[0];await assert.rejects(()=>config.save('recipients',{id:r.id,expectedVersion:r.version,enabled:true,userIds:[id(100)]},actor));await config.save('recipients',{id:r.id,expectedVersion:r.version,enabled:true,userIds:[actor.userId]},actor);await assert.rejects(()=>config.save('recipients',{id:r.id,expectedVersion:r.version,enabled:true,userIds:[]},actor));await assert.rejects(()=>config.read({...actor,isSystemAdmin:false,permissions:[]}));});
 await check('controlled singleton text and private XLSX despite disabled official rule, separate failure retry',async()=>{const test=await config.testDelivery({userId:actor.userId},actor);let claims=await notifications.claimForDispatcher('KAINAN','test-worker');const matching=claims.filter(c=>c.notificationId===test.outboxId);assert.equal(matching.length,2);assert(matching.every(c=>c.recipients.length===1&&c.recipients[0].userId===actor.userId));const text=matching.find(c=>c.messageType==='text'),file=matching.find(c=>c.messageType==='file');const content=await delivery.attachment('KAINAN',test.outboxId,file.attachment.id,'test-worker');const w=new Excel.Workbook();await w.xlsx.load(content.content);assert.equal(w.worksheets.length,3);await assert.rejects(()=>delivery.attachment('OTHER',test.outboxId,file.attachment.id,'test-worker'));await assert.rejects(()=>delivery.attachment('KAINAN',test.outboxId,file.attachment.id,'wrong-worker'));await notifications.markDeliverySuccess('KAINAN',test.outboxId,'test-worker',{deliveryId:text.recipients[0].deliveryId});await notifications.markDeliveryFailure('KAINAN',test.outboxId,'test-worker',{deliveryId:file.recipients[0].deliveryId,errmsg:'synthetic failure'});await db.query('UPDATE notification_outbox SET next_retry_at=now() WHERE id=$1',[test.outboxId]);claims=await notifications.claimForDispatcher('KAINAN','test-worker');assert.equal(claims.filter(c=>c.notificationId===test.outboxId).length,1);assert.equal(claims[0].messageType,'file');assert.equal(claims[0].attachment.id,file.attachment.id);await notifications.markDeliverySuccess('KAINAN',test.outboxId,'test-worker',{deliveryId:claims[0].recipients[0].deliveryId});assert.equal((await db.query('SELECT status FROM notification_outbox WHERE id=$1',[test.outboxId]))[0].status,'SENT');});
 await check('all four business commands emit one transactional event only for actual changes',async()=>{
  const data=await config.read(actor);
  for(const r of data.recipients) await config.save('recipients',{id:r.id,expectedVersion:r.version,enabled:true,userIds:[actor.userId]},actor);
  await config.save('rule',{expectedVersion:data.rule.version,enabled:true},actor);
  const count=async()=>(await db.query("SELECT count(*)::int n FROM notification_outbox WHERE payload->>'deliveryMode' IS DISTINCT FROM 'TEST'"))[0].n;
  const created=await app.create('mps-order-allocations',{orderNumber:'SYN-CMD',orderSequence:'001',itemCode:'00099',allocatedQuantity:'2',divisionId:id(10),salespersonName:'测试员工'},actor);assert.equal(await count(),1);
  const updated=await app.update('mps-order-allocations',created.id,{expectedVersion:created.version,remark:'actual change'},actor);assert.equal(await count(),2);
  await app.update('mps-order-allocations',created.id,{expectedVersion:updated.version,remark:'actual change'},actor);assert.equal(await count(),2);
  const batch=await app.batchUpdate('mps-order-allocations',{records:[{id:created.id,expectedVersion:updated.version}],fieldKey:'remark',value:'batch change',idempotencyKey:id(501)},actor);assert.equal(await count(),3);assert.equal(batch.succeeded,1);
  await app.batchUpdate('mps-order-allocations',{records:[{id:created.id,expectedVersion:updated.version}],fieldKey:'remark',value:'batch change',idempotencyKey:id(501)},actor);assert.equal(await count(),3);
  const p=await preview([['SYN-CMD','001','00099','测试员工','事业一部','5','import change'],['SYN-CMD-NEW','001','00098','测试员工','事业二部','1']]);assert.equal(p.errors.length,0);await spreadsheet.confirm('mps-order-allocations',p.previewId,actor);assert.equal(await count(),4);
  const [event]=await db.query("SELECT payload FROM notification_outbox WHERE payload->>'deliveryMode' IS DISTINCT FROM 'TEST' ORDER BY created_at DESC LIMIT 1");assert.equal(event.payload.changes.length,2);assert(!JSON.stringify(event.payload).match(/tax_included|taxIncluded|含税|采购金额/));
  const claims=await notifications.claimForDispatcher('KAINAN','command-worker');for(const claim of claims)await notifications.markDeliverySuccess('KAINAN',claim.notificationId,'command-worker',{deliveryId:claim.recipients[0].deliveryId});
 });
 await check('business row, event and preview confirmation roll back together',async()=>{
   const p=await preview([['SYN-ROLLBACK','001','ROLL01','测试员工','事业一部','1'],['SYN-1','001','00001','测试员工','事业一部','9']]);assert(p.previewId);
   await db.query("UPDATE mps_order_allocations SET version=version+1 WHERE order_number='SYN-1'");
   const before=(await db.query('SELECT count(*)::int n FROM notification_outbox'))[0].n;
   await assert.rejects(()=>spreadsheet.confirm('mps-order-allocations',p.previewId,actor));
   assert.equal((await db.query("SELECT count(*)::int n FROM mps_order_allocations WHERE order_number='SYN-ROLLBACK'"))[0].n,0);
   assert.equal((await db.query('SELECT count(*)::int n FROM notification_outbox'))[0].n,before);
   assert.equal((await db.query('SELECT confirmed_at FROM mps_import_previews WHERE id=$1',[p.previewId]))[0].confirmed_at,null);
 });
 await check('partial routing errors remain FAILED while valid recipient text and file succeed',async()=>{
   const data=await config.read(actor),r=data.recipients.find(r=>r.divisionName==='采购部');
   await config.save('recipients',{id:r.id,expectedVersion:r.version,enabled:true,userIds:[]},actor);
   await app.create('mps-order-allocations',{orderNumber:'SYN-ROUTE-ERROR',itemCode:'ROUTE01',allocatedQuantity:'1',divisionId:r.division_id,salespersonName:'测试员工'},actor);
   const claims=await notifications.claimForDispatcher('KAINAN','error-worker');assert.equal(claims.length,2);
   for(const c of claims)await notifications.markDeliverySuccess('KAINAN',c.notificationId,'error-worker',{deliveryId:c.recipients[0].deliveryId});
   const [outbox]=await db.query('SELECT status,next_retry_at FROM notification_outbox WHERE id=$1',[claims[0].notificationId]);assert.equal(outbox.status,'FAILED');assert.equal(outbox.next_retry_at,null);
   assert.equal((await db.query("SELECT count(*)::int n FROM notification_delivery_logs WHERE notification_outbox_id=$1 AND component='routing' AND status='FAILED'",[claims[0].notificationId]))[0].n,1);
 });
 await check('allocation data scopes block preview of foreign rows and field permissions',async()=>{
   const restricted={...actor,isSystemAdmin:false,permissions:['mps-order-allocations:*:import','mps-order-allocations:*:read'],tableDataScopes:[]};
   await assert.rejects(async()=>spreadsheet.preview('mps-order-allocations',{originalname:'ERP.xlsx',buffer:await buffer([['SYN-1','001','00001','测试员工','事业一部','8']])},restricted));
   const scopeActor={...actor,isSystemAdmin:false,permissions:['*'],tableDataScopes:[]};
   // wildcard is an administrator-equivalent bypass by existing contract; use explicit field permissions.
   const {ALLOCATION_FIELDS}=req('./dist/modules/master-plan-system/order-allocation.domain');scopeActor.permissions=['mps-order-allocations:*:import','mps-order-allocations:*:read',...ALLOCATION_FIELDS.flatMap(([key])=>[`mps-order-allocations:${key}:read`,`mps-order-allocations:${key}:update`])];
   const p=await spreadsheet.preview('mps-order-allocations',{originalname:'ERP.xlsx',buffer:await buffer([['SYN-1','001','00001','测试员工','事业一部','8']])},scopeActor);assert.equal(p.previewId,null);assert.equal(p.rows[0].fields.length,0);assert.equal(p.rows[0].id,null);assert.equal(p.recipients.length,0);
 });
 await check('FORCE RLS isolates vendor/recipient/attachment data for a non-owner role',async()=>{
   const role='pmc_alloc_rls_'+process.pid;
   await db.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER`);
   try {
     await db.query(`GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT ON mps_allocation_vendor_mappings,mps_allocation_recipients,notification_attachments TO ${role}`);
     await db.transaction(async m=>{await m.query(`SET LOCAL ROLE ${role}`);await m.query("SELECT set_config('app.tenant_id','OTHER',true)");for(const table of ['mps_allocation_vendor_mappings','mps_allocation_recipients','notification_attachments'])assert.equal((await m.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id='KAINAN'`))[0].n,0);});
     await assert.rejects(()=>db.transaction(async m=>{await m.query(`SET LOCAL ROLE ${role}`);await m.query("SELECT set_config('app.tenant_id','OTHER',true)");await m.query('INSERT INTO mps_allocation_vendor_mappings(tenant_id,supplier_name,division_id,created_by,updated_by) VALUES($1,$2,$3,$4,$4)',['KAINAN','cross-tenant',id(10),actor.userId]);}));
   } finally {await db.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`);}
 });
 await check('retained ERP projection never overwrites manual/import quantities, divisions or prices',async()=>{
   const {MasterPlanSyncService}=req('./dist/modules/master-plan-system/master-plan.sync.service');
   const before=(await db.query("SELECT * FROM mps_order_allocations WHERE order_number='SYN-1'"))[0];
   await db.query(`INSERT INTO mps_erp_order_lines(tenant_id,source_system,source_database,source_key,order_number,item_code,order_quantity,customer_code,tax_included_amount,created_by,updated_by) VALUES('KAINAN','fixture','fixture','manual-protection','SYN-1','00001',999,'UNKNOWN',999,$1,$1)`,[actor.userId]);
   await new MasterPlanSyncService(db).projectPlans('KAINAN',actor.userId,actor.userId);
   assert.deepEqual((await db.query("SELECT * FROM mps_order_allocations WHERE order_number='SYN-1'"))[0],before);
 });
 console.log(JSON.stringify({status:'PASS',checks}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(db?.isInitialized)await db.destroy();if(control._connected){await control.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await control.end();}});
