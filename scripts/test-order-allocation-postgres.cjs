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
 db=new DataSource({type:'postgres',host,username:'knplan',database:name,migrations:[path.join(root,'apps/api/dist/migrations/*.js')],logging:false});await db.initialize();await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');await db.runMigrations();checks.push('all migrations including allocation append batches on fresh PostgreSQL18');
 await db.query(`INSERT INTO users(id,username,display_name,password_hash,enabled,tenant_id,wechat_user_id) VALUES($1,'fixture','测试员工','unused',true,'KAINAN','synthetic-wecom')`,[actor.userId]);
 const units=['事业一部','事业二部','事业三部','事业四部','采购部'];for(let i=0;i<units.length;i++)await db.query(`INSERT INTO organization_units(id,name,level,enabled) VALUES($1::uuid,$2,1,true)`,[id(i+10),units[i]]);
 const delivery=new OrderAllocationDeliveryService(db),notifications=new NotificationService(db,delivery);
 const sync={processOutbox:async()=>({}),run:async()=>({})};const app=new MasterPlanApplicationService(db,sync,notifications);
 const directory={listEnabled:async()=>(await db.query('SELECT id,name FROM organization_units WHERE enabled=true')).map(u=>({...u,pathLabel:u.name})),resolve:(value,options)=>{const all=options.filter(o=>o.id===value||o.name===value);if(all.length!==1)throw Error('unit missing');return all[0];}};
 const config=new OrderAllocationConfigService(db,notifications,directory);
 const {MasterPlanQueryService}=req('./dist/modules/master-plan-system/master-plan.query.service');
 const spreadsheet=new MasterPlanSpreadsheetService(db,new MasterPlanQueryService(db,directory),app,directory);
 await config.seed('KAINAN',actor.userId);
 await check('five exact mapping seeds, five units, one disabled rule; idempotent initialization',async()=>{await config.seed('KAINAN',actor.userId);const data=await config.read(actor);assert.equal(data.vendors.length,5);assert.equal(data.recipients.length,5);assert.equal(data.rule.enabled,false);assert.equal((await db.query("SELECT count(*)::int n FROM notification_rules WHERE event_type='mps.order_allocation.batch_changed'"))[0].n,1);});
 await check('raw create marks manual ownership without disabled-rule backlog or money audit',async()=>{const result=await app.create('mps-order-allocations',{orderNumber:'SYN-1',orderSequence:'001',itemCode:'00001',allocatedQuantity:'1',divisionId:id(10),salespersonName:'测试员工',remark:'人工保留'},actor);assert(result.id);const [row]=await db.query("SELECT * FROM mps_order_allocations WHERE order_number='SYN-1'");assert(row.manually_maintained);assert.equal((await db.query('SELECT count(*)::int n FROM notification_outbox'))[0].n,0);assert(!(await db.query("SELECT after_json FROM audit_logs WHERE action='mps-order-allocations.created'"))[0].after_json.tax_included_amount);});
 await db.query("UPDATE mps_order_allocations SET tax_included_unit_price='2.500000',tax_included_amount='55.50' WHERE order_number='SYN-1'");
 const buffer=async(rows)=>{const w=new Excel.Workbook(),s=w.addWorksheet('分配');s.addRow(['订单单号','订单序号','品号','业务员','供应商名称','已分配数量','备注','含税单价','含税金额','原币单价','采购金额']);s.addRows(rows);return Buffer.from(await w.xlsx.writeBuffer());};
 const preview=async(rows)=>spreadsheet.preview('mps-order-allocations',{originalname:'ERP.xlsx',buffer:await buffer(rows)},actor);
 await check('each upload appends every source row; repeated confirmation is idempotent',async()=>{
  const rows=[['SYN-1','001','00001','测试员工','事业一部','80','','999','999','999','999'],['SYN-1','001','00001','测试员工','事业一部','80']];
  const importFile={originalname:"ERP.xlsx",buffer:await buffer(rows)};
  const p=await spreadsheet.preview("mps-order-allocations",importFile,actor);assert.deepEqual(p.counts,{created:2,updated:0,unchanged:0,errors:0});assert(p.importBatchId);assert.equal(p.rows.length,2);
  const before=await db.query("SELECT * FROM mps_order_allocations WHERE import_batch_id IS NULL ORDER BY id");
  const results=await Promise.all([spreadsheet.confirm('mps-order-allocations',p.previewId,actor),spreadsheet.confirm('mps-order-allocations',p.previewId,actor)]);assert.equal(results.filter(r=>r.repeated).length,1);
  const first=await db.query('SELECT * FROM mps_order_allocations WHERE import_batch_id=$1 ORDER BY source_row_number',[p.importBatchId]);assert.equal(first.length,2);assert.notEqual(first[0].id,first[1].id);assert.deepEqual(first.map(r=>r.source_row_number),[2,3]);assert(first.every(r=>r.allocated_quantity==='80.0000'&&r.imported_by===actor.userId&&r.source_worksheet==='分配'));
  const replay=await spreadsheet.preview("mps-order-allocations",importFile,actor);assert(replay.repeatedFile);assert.notEqual(replay.importBatchId,p.importBatchId);assert.equal(replay.counts.created,2);await spreadsheet.confirm('mps-order-allocations',replay.previewId,actor);
  assert.equal((await db.query("SELECT count(*)::int n FROM mps_order_allocations WHERE order_number='SYN-1'"))[0].n,5);
  assert.deepEqual(await db.query("SELECT * FROM mps_order_allocations WHERE import_batch_id IS NULL ORDER BY id"),before);
 });
 await check('unknown supplier blocks writes while repeated business keys remain valid',async()=>{const p=await preview([['SYN-3','001','00001','测试员工','未知供应商','1']]);assert.equal(p.previewId,null);assert(p.errors.length);const split=await preview([['SYN-3','001','00001','测试员工','事业一部','1'],['SYN-3','002','00001','测试员工','事业二部','1']]);assert.equal(split.errors.length,0);});
 await check('manual edits remain by ID/version and old export identities never update history',async()=>{
  const [original]=await db.query("SELECT * FROM mps_order_allocations WHERE order_number='SYN-1' AND import_batch_id IS NULL");
  const n=(await db.query('SELECT count(*)::int n FROM mps_order_allocations'))[0].n;
  const edited=await app.update('mps-order-allocations',original.id,{expectedVersion:original.version,remark:'manual ID edit'},actor);assert.equal((await db.query('SELECT count(*)::int n FROM mps_order_allocations'))[0].n,n);
  await assert.rejects(()=>app.update('mps-order-allocations',original.id,{expectedVersion:original.version,remark:'stale'},actor));
  for(const values of [{unallocatedQuantity:'90'},{importBatchId:id(700)},{sourceRowNumber:99}])await assert.rejects(()=>app.update('mps-order-allocations',original.id,{expectedVersion:edited.version,...values},actor));
  const w=new Excel.Workbook(),sheet=w.addWorksheet('分配');sheet.addRow(['记录ID','版本','订单单号','品号','供应商名称','已分配数量']);sheet.addRow([original.id,original.version,'SYN-1','00001','事业一部',20]);
  const p=await spreadsheet.preview('mps-order-allocations',{originalname:'old-export.xlsx',buffer:Buffer.from(await w.xlsx.writeBuffer())},actor);assert(p.ignoredIdentity);assert.equal(p.counts.created,1);await spreadsheet.confirm('mps-order-allocations',p.previewId,actor);
  assert.equal((await db.query('SELECT version,remark FROM mps_order_allocations WHERE id=$1',[original.id]))[0].remark,'manual ID edit');
 });
 await check('allocation template removes old quantity and overwrite identity columns',async()=>{const w=new Excel.Workbook();await w.xlsx.load(await spreadsheet.template('mps-order-allocations',actor));const h=w.worksheets[0].getRow(1).values;assert(h.includes('已分配数量'));assert(!h.includes('未分配数量'));assert(!h.includes('记录ID'));assert(!h.includes('版本'));const schema=w.getWorksheet('_字段定义');assert(!schema.getColumn(1).values.includes('id'));assert(!schema.getColumn(1).values.includes('version'));assert.equal(schema.getCell('B3').value,1);assert.equal(w.worksheets[0].getCell('E2').dataValidation.type,'date');
 const exported=new Excel.Workbook();await exported.xlsx.load(await spreadsheet.export('mps-order-allocations',{},actor));const eh=exported.worksheets[0].getRow(1).values;assert(eh.includes('导入批次ID'));assert(eh.includes('订单序号'));assert(eh.includes('已分配数量'));assert(!eh.includes('未分配数量'));assert(!eh.includes('记录ID'));assert(!eh.join(' ').match(/含税|采购金额|原币单价/));const operatorColumn=eh.indexOf('导入操作人');assert(exported.worksheets[0].getColumn(operatorColumn).values.includes('测试员工'));
 });
 if(process.env.PMC_REAL_EXCEL){await check('actual original 163 source rows/33 orders: batch A163 + replay0 + batch B163',async()=>{
  const original=fs.readFileSync(process.env.PMC_REAL_EXCEL),parsed=await parseAllocationWorkbook(original);assert.equal(parsed.rows.length,163);assert.equal(parsed.orderCount,33);assert.equal(parsed.errors.length,0);assert.equal(parsed.quantitySource,'ERP_UNALLOCATED');
  const beforeMoney=await db.query('SELECT id,tax_included_unit_price,tax_included_amount FROM mps_order_allocations ORDER BY id');
  const p=await spreadsheet.preview('mps-order-allocations',{originalname:'10.13.xlsx',buffer:original},actor);assert.equal(p.errors.length,0);assert.equal(p.counts.created,163);const result=await spreadsheet.confirm('mps-order-allocations',p.previewId,actor);assert.equal(result.created,163);assert((await spreadsheet.confirm('mps-order-allocations',p.previewId,actor)).repeated);
  const again=await spreadsheet.preview('mps-order-allocations',{originalname:'10.13.xlsx',buffer:original},actor);assert.equal(again.counts.created,163);assert(again.repeatedFile);await spreadsheet.confirm('mps-order-allocations',again.previewId,actor);
  const stored=await db.query('SELECT import_batch_id,source_row_number,allocated_quantity,tax_included_amount,tax_included_unit_price FROM mps_order_allocations WHERE import_batch_id=ANY($1::uuid[]) ORDER BY import_batch_id,source_row_number',[[p.importBatchId,again.importBatchId]]);assert.equal(stored.length,326);const expected=new Map(parsed.rows.map(r=>[r.row,String(r.values.allocatedQuantity)]));for(const r of stored){assert.equal(Number(r.allocated_quantity),Number(expected.get(r.source_row_number)));assert.equal(r.tax_included_amount,null);assert.equal(r.tax_included_unit_price,null);}
  for(const money of beforeMoney)assert.deepEqual((await db.query('SELECT id,tax_included_unit_price,tax_included_amount FROM mps_order_allocations WHERE id=$1',[money.id]))[0],money);
 });}
 await check('configuration rejects foreign tenant employees and stale versions, records audit',async()=>{await db.query(`INSERT INTO users(id,username,display_name,password_hash,tenant_id,enabled,wechat_user_id) VALUES($1,'foreign','测试员工','unused','OTHER',true,'foreign-wecom')`,[id(100)]);const data=await config.read(actor);const r=data.recipients[0];await assert.rejects(()=>config.save('recipients',{id:r.id,expectedVersion:r.version,enabled:true,userIds:[id(100)]},actor));await config.save('recipients',{id:r.id,expectedVersion:r.version,enabled:true,userIds:[actor.userId]},actor);await assert.rejects(()=>config.save('recipients',{id:r.id,expectedVersion:r.version,enabled:true,userIds:[]},actor));await assert.rejects(()=>config.read({...actor,isSystemAdmin:false,permissions:[]}));});
 await check('controlled singleton text and private XLSX despite disabled official rule, separate failure retry',async()=>{const test=await config.testDelivery({userId:actor.userId},actor);let claims=await notifications.claimForDispatcher('KAINAN','test-worker');const matching=claims.filter(c=>c.notificationId===test.outboxId);assert.equal(matching.length,2);assert(matching.every(c=>c.recipients.length===1&&c.recipients[0].userId===actor.userId));const text=matching.find(c=>c.messageType==='text'),file=matching.find(c=>c.messageType==='file');const content=await delivery.attachment('KAINAN',test.outboxId,file.attachment.id,'test-worker');const w=new Excel.Workbook();await w.xlsx.load(content.content);assert.deepEqual(w.worksheets.map(s=>s.name),["新增订单","变更订单","字段变更明细"]);assert.match(file.attachment.filename,/^订单分配_\d{12}_测试员工\.xlsx$/);await assert.rejects(()=>delivery.attachment('OTHER',test.outboxId,file.attachment.id,'test-worker'));await assert.rejects(()=>delivery.attachment('KAINAN',test.outboxId,file.attachment.id,'wrong-worker'));await notifications.markDeliverySuccess('KAINAN',test.outboxId,'test-worker',{deliveryId:text.recipients[0].deliveryId});await notifications.markDeliveryFailure('KAINAN',test.outboxId,'test-worker',{deliveryId:file.recipients[0].deliveryId,errmsg:'synthetic failure'});await db.query('UPDATE notification_outbox SET next_retry_at=now() WHERE id=$1',[test.outboxId]);claims=await notifications.claimForDispatcher('KAINAN','test-worker');assert.equal(claims.filter(c=>c.notificationId===test.outboxId).length,1);assert.equal(claims[0].messageType,'file');assert.equal(claims[0].attachment.id,file.attachment.id);assert.equal(claims[0].attachment.filename,file.attachment.filename);await notifications.markDeliverySuccess('KAINAN',test.outboxId,'test-worker',{deliveryId:claims[0].recipients[0].deliveryId});assert.equal((await db.query('SELECT status FROM notification_outbox WHERE id=$1',[test.outboxId]))[0].status,'SENT');});
 if(process.env.PMC_FORMULA_EXCEL){await check('actual 10.14 formula workbook: 87 cached quantities and text statuses, append-only persistence and replay',async()=>{
   const original=fs.readFileSync(process.env.PMC_FORMULA_EXCEL),parsed=await parseAllocationWorkbook(original);assert.equal(parsed.rows.length,87);assert.equal(parsed.orderCount,2);assert.equal(parsed.errors.length,0);assert.equal(parsed.quantitySource,'ERP_UNALLOCATED');assert(parsed.rows.every(r=>r.values.orderStatus==='已审核'));
   const w=new Excel.Workbook();await w.xlsx.load(original);const sheet=w.getWorksheet('分配');for(const row of parsed.rows)assert.equal(row.values.allocatedQuantity,String(sheet.getCell('O'+row.row).result));
   const before=await db.query('SELECT row_to_json(a) value FROM mps_order_allocations a ORDER BY id');
   const p=await spreadsheet.preview('mps-order-allocations',{originalname:'10.14.xlsx',buffer:original},actor);assert.equal(p.errors.length,0);assert.deepEqual(p.counts,{created:87,updated:0,unchanged:0,errors:0});
   const first=await spreadsheet.confirm('mps-order-allocations',p.previewId,actor);assert.equal(first.created,87);assert.equal((await spreadsheet.confirm('mps-order-allocations',p.previewId,actor)).repeated,true);
   const stored=await db.query('SELECT * FROM mps_order_allocations WHERE import_batch_id=$1 ORDER BY source_row_number',[p.importBatchId]);assert.equal(stored.length,87);
   for(let i=0;i<stored.length;i++){assert.equal(stored[i].order_status,'已审核');assert(new (req('decimal.js'))(stored[i].allocated_quantity).eq(parsed.rows[i].values.allocatedQuantity));assert(!JSON.stringify(stored[i]).includes('sharedFormula'));}
   assert.deepEqual(await db.query('SELECT row_to_json(a) value FROM mps_order_allocations a WHERE import_batch_id IS DISTINCT FROM $1::uuid ORDER BY id',[p.importBatchId]),before);
   const next=await spreadsheet.preview('mps-order-allocations',{originalname:'10.14.xlsx',buffer:original},actor);assert(next.repeatedFile);assert.equal(next.counts.created,87);assert.notEqual(next.importBatchId,p.importBatchId);await spreadsheet.confirm('mps-order-allocations',next.previewId,actor);
   assert.equal((await db.query('SELECT count(*)::int n FROM mps_order_allocations WHERE import_batch_id=ANY($1::uuid[])',[[p.importBatchId,next.importBatchId]]))[0].n,174);
 });}
 await check('same-second filename collision adds immutable batch and recipient IDs',async()=>{
   const [original]=await db.query("SELECT a.filename,b.payload->>'occurredAt' AS occurred_at FROM notification_attachments a JOIN notification_outbox b ON b.id=a.notification_outbox_id WHERE b.payload->>'deliveryMode'='TEST' ORDER BY a.created_at LIMIT 1");
   const next=await config.testDelivery({userId:actor.userId},actor);
   await db.query("UPDATE notification_outbox SET payload=jsonb_set(payload,'{occurredAt}',$2::jsonb) WHERE id=$1",[next.outboxId,JSON.stringify(original.occurred_at)]);
   const claims=(await notifications.claimForDispatcher('KAINAN','collision-worker')).filter(c=>c.notificationId===next.outboxId);
   const filename=claims.find(c=>c.messageType==='file').attachment.filename;
   assert.notEqual(filename,original.filename);assert(filename.startsWith(original.filename.slice(0,-5)+'_'));
   assert(filename.includes(actor.userId.replace(/-/g,'')));
   for(const claim of claims)await notifications.markDeliverySuccess('KAINAN',next.outboxId,'collision-worker',{deliveryId:claim.recipients[0].deliveryId});
 });
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
  const [event]=await db.query("SELECT id,payload FROM notification_outbox WHERE payload->>'deliveryMode' IS DISTINCT FROM 'TEST' ORDER BY created_at DESC LIMIT 1");assert.equal(event.payload.changes.length,2);assert(!JSON.stringify(event.payload).match(/tax_included|taxIncluded|含税|采购金额/));
  const claims=await notifications.claimForDispatcher('KAINAN','command-worker');
  const mixed=claims.find(c=>c.notificationId===event.id&&c.messageType==='file');assert(mixed);
  const workbook=new Excel.Workbook();await workbook.xlsx.load((await delivery.attachment('KAINAN',event.id,mixed.attachment.id,'command-worker')).content);
  assert.deepEqual(workbook.worksheets.map(s=>s.name),['新增订单','变更订单','字段变更明细']);
  assert.equal(workbook.getWorksheet('新增订单').rowCount,3);assert.equal(workbook.getWorksheet('新增订单').getCell('C2').text,'SYN-CMD');
  assert.equal(workbook.getWorksheet('变更订单').rowCount,1);
  const details=workbook.getWorksheet('字段变更明细');const remark=Array.from({length:details.rowCount-1},(_,i)=>details.getRow(i+2).values).find(r=>r[1]==='SYN-CMD'&&r[8]==='备注');assert.equal(remark[9],'');assert.equal(remark[10],'import change');
  assert(!workbook.worksheets.flatMap(s=>s.getRow(1).values).join(' ').match(/含税|采购金额|原币单价/));
  for(const claim of claims)await notifications.markDeliverySuccess('KAINAN',claim.notificationId,'command-worker',{deliveryId:claim.recipients[0].deliveryId});
 });
 await check('business row, event and preview confirmation roll back together',async()=>{
   const p=await preview([['SYN-ROLLBACK','001','ROLL01','测试员工','事业一部','1'],['SYN-1','001','00001','测试员工','事业一部','9']]);assert(p.previewId);
   await db.query("CREATE FUNCTION pmc_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.allocated_quantity=9 THEN RAISE EXCEPTION 'controlled transaction failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER pmc_test_failure BEFORE INSERT ON mps_order_allocations FOR EACH ROW EXECUTE FUNCTION pmc_test_failure()");
   const before=(await db.query('SELECT count(*)::int n FROM notification_outbox'))[0].n;
   await assert.rejects(()=>spreadsheet.confirm('mps-order-allocations',p.previewId,actor));
   assert.equal((await db.query("SELECT count(*)::int n FROM mps_order_allocations WHERE order_number='SYN-ROLLBACK'"))[0].n,0);
   assert.equal((await db.query('SELECT count(*)::int n FROM notification_outbox'))[0].n,before);
   assert.equal((await db.query('SELECT confirmed_at FROM mps_import_previews WHERE id=$1',[p.previewId]))[0].confirmed_at,null);
   assert.equal((await db.query('SELECT count(*)::int n FROM mps_allocation_import_batches WHERE id=$1',[p.importBatchId]))[0].n,0);await db.query('DROP TRIGGER pmc_test_failure ON mps_order_allocations; DROP FUNCTION pmc_test_failure()');
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
     await db.query(`GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT ON mps_allocation_vendor_mappings,mps_allocation_recipients,notification_attachments,mps_allocation_import_batches TO ${role}`);
     await db.transaction(async m=>{await m.query(`SET LOCAL ROLE ${role}`);await m.query("SELECT set_config('app.tenant_id','OTHER',true)");for(const table of ['mps_allocation_vendor_mappings','mps_allocation_recipients','notification_attachments','mps_allocation_import_batches'])assert.equal((await m.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id='KAINAN'`))[0].n,0);});
     await assert.rejects(()=>db.transaction(async m=>{await m.query(`SET LOCAL ROLE ${role}`);await m.query("SELECT set_config('app.tenant_id','OTHER',true)");await m.query('INSERT INTO mps_allocation_vendor_mappings(tenant_id,supplier_name,division_id,created_by,updated_by) VALUES($1,$2,$3,$4,$4)',['KAINAN','cross-tenant',id(10),actor.userId]);}));
   } finally {await db.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`);}
 });
 await check('retained ERP projection never overwrites manual/import quantities, divisions or prices',async()=>{
   const {MasterPlanSyncService}=req('./dist/modules/master-plan-system/master-plan.sync.service');
   const before=(await db.query("SELECT * FROM mps_order_allocations WHERE order_number='SYN-1'"))[0];
   await db.query(`INSERT INTO mps_erp_order_lines(tenant_id,source_system,source_database,source_key,order_number,item_code,order_quantity,customer_code,tax_included_amount,created_by,updated_by) VALUES('KAINAN','fixture','fixture','manual-protection','SYN-1','00001',999,'UNKNOWN',999,$1,$1)`,[actor.userId]);
   await db.query(`INSERT INTO mps_erp_order_lines(tenant_id,source_system,source_database,source_key,order_number,item_code,order_quantity,customer_code,created_by,updated_by) VALUES('KAINAN','fixture','fixture','erp-only-source','SYN-ERP-ONLY','ERP01',17,'UNKNOWN',$1,$1)`,[actor.userId]);
   const existing=await db.query('SELECT id,allocated_quantity,version FROM mps_order_allocations ORDER BY id');
   const plans=await db.query('SELECT row_to_json(p) value FROM mps_monthly_plans p ORDER BY id');
   const groups=await db.query('SELECT row_to_json(p) value FROM mps_group_plans p ORDER BY id');
   const outcome=await new MasterPlanSyncService(db).run('KAINAN','plan-projections','EVENT',actor.userId,actor.username);
   assert.equal(outcome.skipped,true);assert.equal(outcome.count,0);
   assert.deepEqual(await db.query('SELECT row_to_json(p) value FROM mps_monthly_plans p ORDER BY id'),plans);
   assert.deepEqual(await db.query('SELECT row_to_json(p) value FROM mps_group_plans p ORDER BY id'),groups);
   assert.equal((await db.query("SELECT count(*)::int n FROM mps_reconciliation_outbox WHERE sync_key='plan-projections'"))[0].n,0);
   assert.deepEqual(await db.query('SELECT id,allocated_quantity,version FROM mps_order_allocations ORDER BY id'),existing);
   assert.equal((await db.query("SELECT count(*)::int n FROM mps_order_allocations WHERE order_number='SYN-ERP-ONLY'"))[0].n,0);
   assert.deepEqual((await db.query("SELECT * FROM mps_order_allocations WHERE order_number='SYN-1'"))[0],before);
 });
 await check('same-name salespeople get separate unique filenames and merged per-user scopes',async()=>{
   for(const n of [201,202])await db.query("INSERT INTO users(id,username,display_name,password_hash,tenant_id,enabled,wechat_user_id) VALUES($1,$2,'同名员工','unused','KAINAN',true,$3)",[id(n),'same-name-'+n,'same-name-wecom-'+n]);
   await app.create('mps-order-allocations',{orderNumber:'SYN-SAME-NAME',itemCode:'SAME01',allocatedQuantity:'1',divisionId:id(10),salespersonName:'同名员工'},actor);
   const claims=await notifications.claimForDispatcher('KAINAN','same-name-worker');assert.equal(claims.length,6);
   const files=claims.filter(c=>c.messageType==='file');assert.equal(new Set(files.map(c=>c.attachment.filename)).size,3);
   for(const n of [201,202]){const file=files.find(c=>c.recipients[0].userId===id(n));assert.match(file.attachment.filename,/^订单分配_\d{12}_同名员工_/);assert(file.attachment.filename.includes(id(n).replace(/-/g,'')));}
   for(const c of claims)await notifications.markDeliverySuccess('KAINAN',c.notificationId,'same-name-worker',{deliveryId:c.recipients[0].deliveryId});
 });
 await check('supply-chain disabled mapping is explicit; versioned repair preserves all other mappings and organization rows',async()=>{
   // Finish prior notification tests first; this check must not emit production-style events.
   const cfg=await config.read(actor);await config.save('rule',{expectedVersion:cfg.rule.version,enabled:false},actor);
   const original=cfg.vendors.find(v=>v.supplier_name==='供应链'),other=cfg.vendors.filter(v=>v.id!==original.id);
   const procurementRecipient=cfg.recipients.find(r=>r.division_id===original.division_id);await config.save('recipients',{id:procurementRecipient.id,expectedVersion:procurementRecipient.version,enabled:true,userIds:[actor.userId]},actor);
   const orgBefore=await db.query('SELECT row_to_json(o) value FROM organization_units o ORDER BY id');
   await config.save('vendors',{id:original.id,expectedVersion:original.version,enabled:false,supplierName:'供应链',divisionId:original.division_id},actor);
   let data=await config.read(actor);assert(data.issues.some(i=>i.supplierName==='供应链'&&i.code==='DISABLED_MAPPING'));
   assert.equal(data.vendors.find(v=>v.id===original.id).enabled,false); // seed never silently overrides administrator settings
   const rows=Array.from({length:4},(_,i)=>['SYN-SUPPLY-'+i,'001','SUP'+i,'测试员工','供应链','80']);
   const disabled=await preview(rows);assert.equal(disabled.previewId,null);for(let row=2;row<=5;row++)assert(disabled.errors.some(e=>e.row===row&&e.reason.includes('映射已停用')));
   let current=data.vendors.find(v=>v.id===original.id);await config.save('vendors',{id:current.id,expectedVersion:current.version,enabled:true,supplierName:'供应链',divisionId:current.division_id},actor);
   data=await config.read(actor);assert(!data.issues.some(i=>i.supplierName==='供应链'));assert.deepEqual(data.vendors.filter(v=>v.id!==original.id),other);
   const valid=await preview(rows);assert.equal(valid.errors.length,0);assert.equal(valid.counts.created,4);assert(valid.rows.every(r=>r.values.divisionId===original.division_id));
   const before=(await db.query('SELECT count(*)::int n FROM mps_order_allocations'))[0].n;await spreadsheet.confirm('mps-order-allocations',valid.previewId,actor);await spreadsheet.confirm('mps-order-allocations',valid.previewId,actor);assert.equal((await db.query('SELECT count(*)::int n FROM mps_order_allocations'))[0].n,before+4);
   assert.equal((await db.query('SELECT count(*)::int n FROM mps_order_allocations WHERE import_batch_id=$1 AND division_id=$2',[valid.importBatchId,original.division_id]))[0].n,4);
   assert(valid.recipients.some(r=>r.userId===actor.userId&&r.identities.some(label=>label.includes('采购部'))));
   await db.query('UPDATE organization_units SET enabled=false WHERE id=$1',[original.division_id]);const invalid=await preview(rows);assert(invalid.errors.some(e=>e.reason.includes('承接组织不存在或已停用')));assert((await config.read(actor)).issues.some(i=>i.supplierName==='供应链'&&i.code==='INVALID_ORGANIZATION'));
   await db.query('UPDATE organization_units SET enabled=true WHERE id=$1',[original.division_id]);
   assert.deepEqual(await db.query('SELECT row_to_json(o) value FROM organization_units o ORDER BY id'),orgBefore);
   const after=await config.read(actor);assert.equal(after.rule.enabled,false);
   assert((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='order-allocation.config.vendors' AND record_id=$1",[original.id]))[0].n>=2);
 });
 await check('ambiguous required seed is visible, known IDs resolve it, arbitrary custom organizations remain configurable',async()=>{
   const cfg=await config.read(actor),procurement=cfg.vendors.find(v=>v.supplier_name==='供应链');
   // Use rollback to test missing/ambiguous setup without retiring any retained FK or historical allocation.
   await assert.rejects(()=>db.transaction(async m=>{
     await m.query('DELETE FROM mps_allocation_vendor_mappings WHERE id=$1',[procurement.id]);
     await m.query("INSERT INTO organization_units(id,name,level,enabled) VALUES($1,'采购部',2,true)",[id(810)]);
     const issues=await config.seed('KAINAN',actor.userId,m);assert(issues.some(i=>i.supplierName==='供应链'&&i.message.includes('重名')));assert.equal((await m.query("SELECT count(*)::int n FROM mps_allocation_vendor_mappings WHERE supplier_name='供应链'"))[0].n,0);
     throw Error('controlled fixture rollback');
   }),/controlled fixture rollback/);
   await db.query("INSERT INTO organization_units(id,name,level,enabled) VALUES($1,'仓储部',2,true)",[id(811)]);
   const saved=await config.save('vendors',{supplierName:'自定义仓储供应商',divisionId:id(811),enabled:true},actor);assert.equal(saved.division_id,id(811));
   let data=await config.read(actor);assert(data.unitOptions.some(o=>o.id===id(811)));const recipient=data.recipients.find(r=>r.division_id===id(811));assert(recipient);
   await config.save('recipients',{id:recipient.id,expectedVersion:recipient.version,divisionId:id(811),userIds:[actor.userId],enabled:true},actor);
   const custom=await preview([['SYN-CUSTOM','1','CUSTOM','测试员工','自定义仓储供应商','12']]);assert.equal(custom.errors.length,0);assert.equal(custom.rows[0].values.divisionId,id(811));assert(custom.recipients.some(r=>r.identities.includes('仓储部')));
   await config.seed('KAINAN',actor.userId);data=await config.read(actor);assert.equal(data.vendors.find(v=>v.id===saved.id).division_id,id(811));
   const p=data.vendors.find(v=>v.id===procurement.id);await assert.rejects(()=>config.save('vendors',{id:p.id,expectedVersion:p.version,supplierName:'供应链',divisionId:id(811),enabled:true},actor),/必须映射采购部/);
   await assert.rejects(()=>config.save('vendors',{supplierName:'自定义仓储供应商',divisionId:id(811),enabled:true},actor),/已存在/);
 });
 await check('archive clears current allocations while preserving historical plans, amounts, routing and tenant isolation',async()=>{
   const {FieldCandidateService}=req('./dist/common/filtering/field-candidate.service');
   const queries=new MasterPlanQueryService(db,directory,new FieldCandidateService(db));
   const pending=await preview([['SYN-PENDING','1','PEND','测试员工','供应链','8']]);assert(pending.previewId);
   const prior=await preview([['SYN-CONFIRMED','1','CONF','测试员工','供应链','8']]);await spreadsheet.confirm('mps-order-allocations',prior.previewId,actor);
   const rows=await db.query("SELECT * FROM mps_order_allocations WHERE tenant_id='KAINAN' AND archived_at IS NULL ORDER BY id");
   await db.query(`INSERT INTO mps_monthly_plans(tenant_id,allocation_id,order_number,item_code,division_id,required_quantity,created_by,updated_by)
     VALUES('KAINAN',$1,$2,$3,$4,1,$5,$5)`,[rows[0].id,rows[0].order_number,rows[0].item_code,rows[0].division_id,actor.userId]);
   await db.query("INSERT INTO mps_order_allocations(tenant_id,order_number,item_code,division_id,allocated_quantity,created_by,updated_by) VALUES('OTHER','OTHER','OTHER',$1,3,$2,$2)",[id(10),actor.userId]);
   const plans=await db.query('SELECT row_to_json(p) value FROM mps_monthly_plans p ORDER BY id');
   const configs=await db.query('SELECT row_to_json(p) value FROM mps_allocation_vendor_mappings p ORDER BY id');
   const notificationsBefore=await db.query('SELECT row_to_json(n) value FROM notification_outbox n ORDER BY id');
   const outboxBefore=await db.query('SELECT row_to_json(n) value FROM mps_reconciliation_outbox n ORDER BY id');
   const snapshot=rows.map(r=>({id:r.id,expectedVersion:r.version}));
   await assert.rejects(()=>app.archiveAllocations(snapshot,id(900),{...actor,isSystemAdmin:false}),/仅系统管理员/);
   await assert.rejects(()=>app.archiveAllocations(snapshot.slice(1),id(900),actor),/已变化/);
   await assert.rejects(()=>app.archiveAllocations(snapshot.map((r,i)=>i? r:{...r,expectedVersion:r.expectedVersion+1}),id(900),actor),/已变化/);
   assert.equal((await queries.list('mps-order-allocations',{},actor)).total,rows.length);
   await db.query("CREATE FUNCTION pmc_archive_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='mps-order-allocations.archive_completed' THEN RAISE EXCEPTION 'controlled archive failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER pmc_archive_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION pmc_archive_failure()");
   await assert.rejects(()=>app.archiveAllocations(snapshot,id(900),actor),/controlled archive failure/);
   assert.equal((await queries.list('mps-order-allocations',{},actor)).total,rows.length);
   assert.equal((await db.query("SELECT expires_at>now() valid FROM mps_import_previews WHERE id=$1",[pending.previewId]))[0].valid,true);
   await db.query('DROP TRIGGER pmc_archive_failure ON audit_logs; DROP FUNCTION pmc_archive_failure()');
   const concurrent=await Promise.all([app.archiveAllocations(snapshot,id(900),actor),app.archiveAllocations(snapshot,id(900),actor)]);assert.equal(concurrent.filter(r=>r.repeated).length,1);
   const archived=concurrent.find(r=>!r.repeated);assert.equal(archived.archived,rows.length);assert(archived.expiredPreviews>=1);
   assert.equal((await queries.list('mps-order-allocations',{},actor)).total,0);
   assert.equal((await queries.exportRows('mps-order-allocations',{},actor)).rows.length,0);
   assert.deepEqual(await queries.fieldCandidates('mps-order-allocations','orderNumber','',50,actor),[]);
   const {TableFilterRegistry}=req('./dist/common/filtering/table-filter.registry'),{MasterPlanFilterSourceProvider}=req('./dist/modules/master-plan-system/master-plan.filter-sources');
   const registry=new TableFilterRegistry();new MasterPlanFilterSourceProvider(registry,queries).onModuleInit();const params=[actor.tenantId],scope=await registry.get('mps-order-allocations').buildScope(actor,params);
   assert.equal((await db.query('SELECT count(*)::int n FROM mps_order_allocations record WHERE record.tenant_id=$1 AND '+scope,params))[0].n,0);
   const exported=new Excel.Workbook();await exported.xlsx.load(await spreadsheet.export('mps-order-allocations',{},actor));assert.equal(exported.worksheets[0].rowCount,1);
   assert.deepEqual(await db.query('SELECT row_to_json(p) value FROM mps_monthly_plans p ORDER BY id'),plans);
   assert.deepEqual(await db.query('SELECT row_to_json(p) value FROM mps_allocation_vendor_mappings p ORDER BY id'),configs);
   assert.deepEqual(await db.query('SELECT row_to_json(n) value FROM notification_outbox n ORDER BY id'),notificationsBefore);
   assert.deepEqual(await db.query('SELECT row_to_json(n) value FROM mps_reconciliation_outbox n ORDER BY id'),outboxBefore);
   const after=await db.query("SELECT * FROM mps_order_allocations WHERE tenant_id='KAINAN' ORDER BY id");
   for(let i=0;i<rows.length;i++){assert(after[i].archived_at);assert.equal(after[i].version,rows[i].version+1);for(const k of Object.keys(rows[i]).filter(k=>!['archived_at','version','updated_at','updated_by'].includes(k)))assert.deepEqual(after[i][k],rows[i][k]);}
   assert.equal((await db.query("SELECT archived_at FROM mps_order_allocations WHERE tenant_id='OTHER'"))[0].archived_at,null);
   await assert.rejects(()=>app.update('mps-order-allocations',after[0].id,{expectedVersion:after[0].version,remark:'must reject'},actor),/当前数据范围/);
   await assert.rejects(()=>spreadsheet.confirm('mps-order-allocations',pending.previewId,actor),/已过期/);
   assert.equal((await spreadsheet.confirm('mps-order-allocations',prior.previewId,actor)).repeated,true);
   assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='mps-order-allocations.archived'"))[0].n,rows.length);
   assert.equal((await app.archiveAllocations(snapshot,id(900),actor)).repeated,true);
   await assert.rejects(()=>app.archiveAllocations([],id(900),actor),/不同归档快照/);
   const {AllocationArchive1722920094000}=req('./dist/migrations/1722920094000-AllocationArchive');
   await assert.rejects(()=>db.transaction(m=>new AllocationArchive1722920094000().down(m)),/禁止回滚/);
   const fresh=await preview([['SYN-CONFIRMED','1','CONF','测试员工','供应链','8']]);assert.equal(fresh.errors.length,0);assert.equal(fresh.counts.created,1);await spreadsheet.confirm('mps-order-allocations',fresh.previewId,actor);
   assert.equal((await queries.list('mps-order-allocations',{},actor)).total,1);
   await app.archiveAllocations(snapshot,id(900),actor);assert.equal((await queries.list('mps-order-allocations',{},actor)).total,1); // retry cannot hide newer imports
   await app.create('mps-order-allocations',{orderNumber:'AFTER',itemCode:'AFTER',divisionId:id(10),allocatedQuantity:'1'},actor);
   assert.equal((await queries.list('mps-order-allocations',{},actor)).total,2);
 });
 console.log(JSON.stringify({status:'PASS',checks}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(db?.isInitialized)await db.destroy();if(control._connected){await control.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await control.end();}});
