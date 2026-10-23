#!/usr/bin/env node
/** V2 integration acceptance: disposable PostgreSQL only, synthetic data, optional local Chrome. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),r=createRequire(root+'/apps/api/package.json'),{DataSource}=r('typeorm'),{Client}=r('pg'),Excel=r('exceljs');
const host=process.env.REVIEW_DUE_TEST_POSTGRES_HOST;
if(!host?.startsWith('/tmp/kdos-review-due-pg-'))throw Error('Disposable review-due PostgreSQL socket required');
if(process.env.REVIEW_DUE_BROWSER_BASE&&!/^http:\/\/127\.0\.0\.1:1518[0-9]$/.test(process.env.REVIEW_DUE_BROWSER_BASE))throw Error('Local isolated Web only');
const resource='mps-review-due-dates',name='review_v2_'+Date.now(),uid=n=>'0199ea00-0000-7000-8000-'+String(n).padStart(12,'0');
const rlsRole=name+'_rls';
const checks=[],control=new Client({host,user:'knplan',database:'postgres'});let db,upgrade,http,browser;
const check=async(label,fn)=>{await fn();checks.push(label);console.log('PASS '+label);};
const denied=async(fn,status)=>assert.rejects(fn,e=>e.getStatus?.()===status);
const {ReviewDueDateApplicationService:Application}=r('./dist/modules/master-plan-system/review-due-date.application.service');
const {ReviewDueDateQueryService:Query}=r('./dist/modules/master-plan-system/review-due-date.query.service');
const {ReviewDueDateImportApplicationService:Import}=r('./dist/modules/master-plan-system/review-due-date-import.application.service');
const {OrganizationDirectoryService:Directory}=r('./dist/modules/organization-directory/organization-directory.service');
const {TableFilterRegistry}=r('./dist/common/filtering/table-filter.registry');
const {MasterPlanQueryService:GenericQuery}=r('./dist/modules/master-plan-system/master-plan.query.service');
const {MasterPlanApplicationService:GenericApplication}=r('./dist/modules/master-plan-system/master-plan.application.service');
const {MasterPlanSpreadsheetService:Spreadsheet}=r('./dist/modules/master-plan-system/master-plan-spreadsheet.service');
const {reviewDueDateFields:fields,reviewDueDateCreateFields:inputs}=r('@kdos/contracts');
const actor={tenantId:'KAINAN',userId:uid(1),username:'Synthetic operator',isSystemAdmin:true,permissions:['*'],moduleAdminCodes:[],tableDataScopes:[],source:'web',requestId:'v2-isolated'};
const ordinary={...actor,isSystemAdmin:false,permissions:['create','read','update','import','export'].map(a=>`${resource}:*:${a}`).concat(fields.flatMap(f=>[`${resource}:${f.key}:read`,...(f.editable?[`${resource}:${f.key}:update`]:[])])),tableDataScopes:[{resource,scope:'ALL'}]};
const base={divisionId:uid(11),orderNumber:'V2-ORDER',batchNumber:'B-1/2',drawingNumber:'ITEM-1/3',inboundDate:'2026-11-10',quantity:'900719925474099312345.000000000000000000001'};
const workbook=async(rows,{omit=[],legacy=false}={})=>{const w=new Excel.Workbook(),s=w.addWorksheet(resource);s.columns=[{key:'id',header:'记录ID'},{key:'version',header:'版本'},...inputs.filter(f=>!omit.includes(f.key)&&(!legacy||!['divisionId','changeCount','previousInboundDate'].includes(f.key))).map(f=>({key:f.key,header:f.label}))];for(const row of rows)s.addRow(row);return {originalname:'synthetic.xlsx',buffer:Buffer.from(await w.xlsx.writeBuffer())};};
const createDb=async(dbname)=>{await control.query('CREATE DATABASE '+dbname);const d=new DataSource({type:'postgres',host,username:'knplan',database:dbname,entities:[root+'/apps/api/dist/entities.js'],migrations:[root+'/apps/api/dist/migrations/*.js']});await d.initialize();await d.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');return d;};
(async()=>{
 await control.connect();db=await createDb(name);await db.runMigrations();
 await check('forward migration refuses populated legacy rows atomically without guessing division or losing history',async()=>{
  upgrade=await createDb(name+'_upgrade');const all=upgrade.migrations;upgrade.migrations=all.filter(m=>!(m.name??m.constructor.name).includes('FieldsV2'));await upgrade.runMigrations();
  await upgrade.query("INSERT INTO users(id,username,display_name,password_hash,tenant_id) VALUES($1,'legacy-test','Legacy test','unused','KAINAN')",[uid(1)]);
  const [row]=await upgrade.query("INSERT INTO mps_review_due_dates(tenant_id,order_number,batch_number,drawing_number,inbound_date,quantity,created_by,updated_by) VALUES('KAINAN','OLD','B','ITEM','2026-01-01',1,$1::uuid,$1::text) RETURNING *",[uid(1)]);
  upgrade.migrations=all;await assert.rejects(upgrade.runMigrations(),/无法可靠判断事业部/);assert.deepEqual((await upgrade.query('SELECT * FROM mps_review_due_dates'))[0],row);
  assert.equal((await upgrade.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='mps_review_due_dates' AND column_name='division_id'"))[0].n,0);
  await upgrade.destroy();upgrade=null;
 });
 for(const [n,tenant]of[[1,'KAINAN'],[2,'OTHER'],[3,'KAINAN']])await db.query("INSERT INTO users(id,username,display_name,password_hash,tenant_id,enabled) VALUES($1,$2,$3,'unused',$4,true)",[uid(n),'v2-user-'+n,'测试操作人'+n,tenant]);
 await db.query("INSERT INTO organization_units(id,name,level,enabled,sort_order) VALUES($1,'凯南',1,true,0)",[uid(10)]);
 for(const[n,label]of[[11,'事业一部'],[12,'事业二部'],[13,'事业三部'],[14,'事业四部']])await db.query('INSERT INTO organization_units(id,name,parent_id,level,enabled,wechat_department_id,sort_order) VALUES($1,$2,$3,2,true,$4,$5)',[uid(n),label,uid(10),String(n),n]);
 await db.query("INSERT INTO organization_units(id,name,parent_id,level,enabled,sort_order) VALUES($1,'一部车间',$2,3,true,1),($3,'停用事业部',$4,2,false,1)",[uid(15),uid(11),uid(16),uid(10)]);
 const directory=new Directory(db.getRepository(r('./dist/entities').OrganizationUnit)),registry=new TableFilterRegistry(),query=new Query(db,registry,directory),app=new Application(db,directory),importer=new Import(directory);query.onModuleInit();
 const generic=new GenericQuery(db,directory,undefined,query),genericApp=new GenericApplication(db),sheet=new Spreadsheet(db,generic,genericApp,directory,query,importer);
 const state=async id=>(await db.query('SELECT *,inbound_date::text date_text,previous_inbound_date::text previous_date_text FROM mps_review_due_dates WHERE id=$1',[id]))[0];
 const count=async()=>Number((await db.query('SELECT count(*)::int n FROM mps_review_due_date_changes'))[0].n);
 const make=(v={},who=ordinary,commandId=randomUUID())=>app.manualCreate({...base,...v,commandId},who);
 const edit=async(id,v,who=ordinary)=>app.manualEdit(id,{...v,expectedVersion:(await state(id)).version,commandId:randomUUID()},who);
 const preview=async(rows,opts)=>sheet.preview(resource,await workbook(rows,opts),ordinary);
 const confirm=(p,who=ordinary)=>sheet.confirm(resource,p.previewId,who);
 let first;
 await check('new schema has nullable manual count, UUID audit actors, tenant RLS and historical immutability',async()=>{
  const columns=await db.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_name='mps_review_due_dates'");assert.equal(columns.find(c=>c.column_name==='updated_by').data_type,'uuid');assert.equal(columns.find(c=>c.column_name==='change_count').is_nullable,'YES');assert.equal(columns.find(c=>c.column_name==='change_count').column_default,null);
  assert((await db.query("SELECT relforcerowsecurity FROM pg_class WHERE relname=ANY($1)",[['mps_review_due_dates','mps_review_due_date_changes']])).every(x=>x.relforcerowsecurity));
 });
 await check('four directory divisions are available; Chinese names resolve to UUID; manual optional fields default NULL',async()=>{
  assert.equal((await generic.organizationOptions(resource,ordinary)).length,4);first=await make({divisionId:'事业一部'});const s=await state(first.id);assert.equal(s.division_id,uid(11));assert.equal(s.source_division_id,uid(11));assert.equal(s.id[14],'7');assert.equal(s.quantity,base.quantity);assert.equal(s.change_count,null);assert.equal(s.previous_inbound_date,null);assert.equal(s.inspection_time_name,null);assert.equal(s.last_synced_at,null);assert.equal(await count(),0);
 });
 await check('audit creation uses the real login and equal timestamps; no client audit/identity can be written',async()=>{
  const s=await state(first.id);assert.equal(s.created_by,ordinary.userId);assert.equal(s.updated_by,ordinary.userId);assert.equal(s.created_at.toISOString(),s.updated_at.toISOString());
  for(const key of ['createdBy','createdAt','updatedBy','updatedAt','id','version','sourceDivisionId','lastChangedAt','lastSyncedAt']){await denied(()=>make({[key]:'forged'}),400);await denied(()=>edit(first.id,{[key]:'forged'}),400);}
 });
 await check('invalid, disabled and non-division organizations are rejected; duplicate names require full path',async()=>{
  for(const divisionId of ['不存在',uid(15),uid(16)])await denied(()=>make({divisionId}),400);
  await db.query("INSERT INTO organization_units(id,name,parent_id,level,enabled,sort_order) VALUES($1,'事业一部',$2,3,true,1)",[uid(17),uid(12)]);
  await denied(()=>make({divisionId:'事业一部'}),400);await denied(()=>make({divisionId:'凯南 / 事业二部 / 事业一部'}),400);
  assert((await make({divisionId:'凯南 / 事业一部',orderNumber:'FULL-PATH'})).id);
 });
 await check('same business key can coexist across divisions; duplicate within one division returns 409',async()=>{
  const other=await make({divisionId:uid(12)});assert.notEqual(other.id,first.id);await denied(()=>make(),409);await denied(()=>edit(other.id,{divisionId:uid(11)}),409);
 });
 await check('manual count accepts NULL/zero/integer, rejects negative/decimal/invalid; previous date can set and clear',async()=>{
  for(const changeCount of [0,2,null]){await edit(first.id,{changeCount});assert.equal((await state(first.id)).change_count,changeCount);}
  for(const changeCount of [-1,0.1,'abc',true,'NaN'])await denied(()=>edit(first.id,{changeCount}),400);
  await edit(first.id,{previousInboundDate:'2026-01-01'});assert.equal((await state(first.id)).previous_date_text,'2026-01-01');await edit(first.id,{previousInboundDate:null});assert.equal((await state(first.id)).previous_date_text,null);
 });
 await check('date/quantity/key edits preserve manual values, stable UUID/source identity and original creation audit',async()=>{
  await edit(first.id,{changeCount:7,previousInboundDate:'2026-01-01'});const before=await state(first.id);
  await edit(first.id,{drawingNumber:'ITEM-EDITED',quantity:'0.000000000000000000000000001',inboundDate:'2027-01-05',inspectionTimeName:'业务品项名'});const s=await state(first.id);
  assert.equal(s.change_count,7);assert.equal(s.previous_date_text,'2026-01-01');assert.equal(s.source_drawing_number,base.drawingNumber);assert.equal(s.id,first.id);assert.equal(s.created_by,before.created_by);assert.equal(s.created_at.toISOString(),before.created_at.toISOString());assert(s.updated_at>=before.updated_at);assert.equal(await count(),0);assert.equal((await query.history(first.id,{},actor)).total,0);
 });
 await check('source identity remains reserved and cannot be changed through database updates',async()=>{
  await denied(()=>make(),409);await assert.rejects(db.query('UPDATE mps_review_due_dates SET source_division_id=$2 WHERE id=$1',[first.id,uid(12)]),/身份/);
  await assert.rejects(db.query('UPDATE mps_review_due_dates SET created_by=$2 WHERE id=$1',[first.id,uid(3)]),/身份/);
 });
 await check('another real actor changes only updater audit; disabled/renamed users remain traceable',async()=>{
  const before=await state(first.id);await edit(first.id,{inspectionTimeName:'第二操作人维护'},{...ordinary,userId:uid(3),username:'测试操作人3'});const after=await state(first.id);
  assert.equal(after.created_by,before.created_by);assert.equal(after.created_at.toISOString(),before.created_at.toISOString());assert.equal(after.updated_by,uid(3));
  await db.query("UPDATE users SET display_name='更名操作人3',enabled=false WHERE id=$1",[uid(3)]);
  const logs=await db.query("SELECT actor_id,actor_name FROM audit_logs WHERE record_id=$1 AND action='review_due_date.manually_updated' ORDER BY created_at DESC,id DESC LIMIT 1",[first.id]);assert.equal(logs[0].actor_id,uid(3));assert.equal(logs[0].actor_name,'测试操作人3');
  await db.query('UPDATE users SET enabled=true WHERE id=$1',[uid(3)]);await edit(first.id,{inspectionTimeName:'业务品项名'});
 });
 await check('resource/field/scope/tenant permissions deny writes and hidden audit cannot be exposed',async()=>{
  await denied(()=>make({}, {...ordinary,permissions:ordinary.permissions.filter(p=>p!==`${resource}:*:create`)}),403);
  await denied(()=>make({}, {...ordinary,permissions:ordinary.permissions.filter(p=>p!==`${resource}:quantity:read`&&p!==`${resource}:quantity:update`)}),403);
  await denied(()=>edit(first.id,{quantity:'2'},{...ordinary,permissions:ordinary.permissions.filter(p=>p!==`${resource}:*:update`)}),403);
  await denied(()=>edit(first.id,{changeCount:2},{...ordinary,permissions:ordinary.permissions.filter(p=>p!==`${resource}:changeCount:update`)}),403);
  const scoped={...ordinary,tableDataScopes:[{resource,scope:'CUSTOM',rules:[{fieldKey:'divisionId',operator:'EQ',value:uid(12)}]}]};
  await denied(()=>make({orderNumber:'SCOPE-NO'},scoped),403);await denied(()=>edit(first.id,{quantity:'2'},scoped),403);await denied(()=>edit(first.id,{divisionId:uid(12)},{...ordinary,tableDataScopes:[{resource,scope:'CUSTOM',rules:[{fieldKey:'divisionId',operator:'EQ',value:uid(11)}]}]}),403);
  await denied(()=>edit(first.id,{quantity:'2'},{...ordinary,tenantId:'OTHER',userId:uid(2)}),404);
  const hidden={...ordinary,permissions:ordinary.permissions.filter(p=>!p.includes(':createdBy:')&&!p.includes(':updatedBy:')&&!p.includes(':divisionId:'))};const result=await query.list({search:'V2-ORDER'},hidden);assert(result.rows.every(row=>!Object.hasOwn(row,'createdBy')&&!Object.hasOwn(row,'updatedBy')&&!Object.hasOwn(row,'divisionName')));
 });
 await check('optimistic version 409 and concurrent repeated requests commit exactly once',async()=>{
  const body={quantity:'3.00000000000000000001',expectedVersion:(await state(first.id)).version,commandId:randomUUID()};const results=await Promise.all([app.manualEdit(first.id,body,ordinary),app.manualEdit(first.id,body,ordinary)]);assert.equal(results.filter(x=>x.repeated).length,1);await denied(()=>app.manualEdit(first.id,{...body,commandId:randomUUID()},ordinary),409);
  const command=randomUUID(),created=await Promise.all([make({orderNumber:'IDEMPOTENT'},ordinary,command),make({orderNumber:'IDEMPOTENT'},ordinary,command)]);assert.equal(new Set(created.map(x=>x.id)).size,1);assert.equal(created.filter(x=>x.repeated).length,1);
 });
 await check('no-op edits preserve version/timestamp; disabled actors fail',async()=>{
  const before=await state(first.id);await edit(first.id,{quantity:before.quantity});assert.deepEqual(await state(first.id),before);
  await db.query('UPDATE users SET enabled=false WHERE id=$1',[uid(3)]);await denied(()=>make({orderNumber:'DISABLED'},{...ordinary,userId:uid(3)}),403);
 });
 await check('standard template has paired identity plus nine fields, no audit, and directory dropdown',async()=>{
  const w=new Excel.Workbook();await w.xlsx.load(await sheet.template(resource,ordinary));const s=w.getWorksheet(resource);assert.equal(s.columnCount,11);assert.equal(s.rowCount,1);assert.deepEqual(s.getRow(1).values.slice(1),['记录ID','版本',...inputs.map(f=>f.label)]);assert(w.getWorksheet('_选项').rowCount>1);
 });
 await check('old six-column uploads require division; audit/unknown headers and half ID/version are rejected',async()=>{
  await assert.rejects(preview([{...base}],{legacy:true}),/事业部/);
  const f=await workbook([{...base}]),w=new Excel.Workbook();await w.xlsx.load(f.buffer);w.getWorksheet(resource).getCell('L1').value='创建人';await assert.rejects(sheet.preview(resource,{...f,buffer:Buffer.from(await w.xlsx.writeBuffer())},ordinary),/表头/);
  const p=await preview([{...base,id:randomUUID(),version:null}]);assert.equal(p.previewId,null);assert(p.errors.length);
 });
 await check('Excel preview is read-only; Chinese division names and blank optional creates produce NULL',async()=>{
  const before=(await db.query('SELECT count(*)::int n FROM mps_review_due_dates'))[0].n,p=await preview([{...base,divisionId:'凯南 / 事业三部',orderNumber:'IMPORT-NEW'}]);assert(p.previewId);assert.equal(p.counts.created,1);assert.equal((await db.query('SELECT count(*)::int n FROM mps_review_due_dates'))[0].n,before);
  await confirm(p);const [s]=await db.query("SELECT * FROM mps_review_due_dates WHERE order_number='IMPORT-NEW'");assert.equal(s.division_id,uid(13));assert.equal(s.change_count,null);assert.equal(s.previous_inbound_date,null);assert.equal(s.inspection_time_name,null);assert.equal((await confirm(p)).repeated,true);assert.equal(await count(),0);
 });
 await check('Excel optional blank/omitted fields retain values, explicit [清空] clears, date updates never count',async()=>{
  let s=await state(first.id);const values={...base,id:first.id,version:s.version,drawingNumber:s.drawing_number,quantity:s.quantity,inboundDate:'2027-02-01'};
  let p=await preview([values]);assert(p.previewId);await confirm(p);s=await state(first.id);assert.equal(s.change_count,7);assert.equal(s.previous_date_text,'2026-01-01');assert.equal(s.inspection_time_name,'业务品项名');
  p=await preview([{...values,version:s.version,inboundDate:'2027-02-02'}],{omit:['inspectionTimeName','changeCount','previousInboundDate']});assert(p.previewId);await confirm(p);s=await state(first.id);assert.equal(s.change_count,7);
  p=await preview([{...values,version:s.version,changeCount:'[清空]',previousInboundDate:'[清空]',inspectionTimeName:'[清空]'}]);assert(p.previewId);await confirm(p);s=await state(first.id);assert.equal(s.change_count,null);assert.equal(s.previous_date_text,null);assert.equal(s.inspection_time_name,null);assert.equal(await count(),0);
 });
 await check('Excel sets manual zero/date and preserves Decimal; same key across different divisions is valid',async()=>{
  const p=await preview([{...base,orderNumber:'IMPORT-SAME',divisionId:'事业三部',changeCount:0,previousInboundDate:'2026-10-01'},{...base,orderNumber:'IMPORT-SAME',divisionId:'事业四部',changeCount:3}]);assert(p.previewId);await confirm(p);const rows=await db.query("SELECT * FROM mps_review_due_dates WHERE order_number='IMPORT-SAME' ORDER BY change_count");assert.equal(rows.length,2);assert.equal(rows[0].quantity,base.quantity);assert.equal(rows[0].change_count,0);
 });
 await check('Excel duplicates/invalid count/invalid org and stale versions have no confirmation token',async()=>{
  for(const rows of [[{...base,orderNumber:'DUP'},{...base,orderNumber:'DUP'}],[{...base,changeCount:-1}],[{...base,divisionId:'一部车间'}],[{...base,id:first.id,version:1}]]){const p=await preview(rows);assert.equal(p.previewId,null);assert(p.errors.length);}
 });
 await check('Excel confirm rechecks authorization/ownership/version and denied scope never changes rows',async()=>{
  const s=await state(first.id),p=await preview([{...base,drawingNumber:s.drawing_number,id:first.id,version:s.version,quantity:'88'}]);assert(p.previewId);
  await denied(()=>confirm(p,{...ordinary,userId:uid(2),tenantId:'OTHER'}),400);await denied(()=>confirm(p,{...ordinary,permissions:[]}),403);await edit(first.id,{quantity:'99'});await denied(()=>confirm(p),409);assert.equal((await state(first.id)).quantity,'99');
 });
 await check('mixed import audit failure rolls back all records, audit, receipts and preview confirmation',async()=>{
  const s=await state(first.id),p=await preview([{...base,drawingNumber:s.drawing_number,id:first.id,version:s.version,quantity:'12',changeCount:9},{...base,orderNumber:'ROLLBACK-NEW'}]);assert(p.previewId);
  await db.query("CREATE FUNCTION reject_v2_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource='mps-review-due-dates' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_v2_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_v2_audit()");
  try{await assert.rejects(confirm(p),/synthetic audit failure/);await assert.rejects(edit(first.id,{quantity:'13'}),/synthetic audit failure/);}finally{await db.query('DROP TRIGGER reject_v2_audit ON audit_logs; DROP FUNCTION reject_v2_audit()');}
  assert.deepEqual(await state(first.id),s);assert.equal((await db.query("SELECT count(*)::int n FROM mps_review_due_dates WHERE order_number='ROLLBACK-NEW'"))[0].n,0);assert.equal((await db.query('SELECT confirmed_at FROM mps_import_previews WHERE id=$1',[p.previewId]))[0].confirmed_at,null);
 });
 await check('legacy history stays immutable and independent of manually set count/current/previous date',async()=>{
  await db.query("INSERT INTO mps_review_due_date_changes(tenant_id,review_due_date_id,old_inbound_date,new_inbound_date,change_days,change_direction,changed_by,source_kind,source_batch_id) VALUES('KAINAN',$1,'2026-01-01','2026-01-02',1,'LATER',$2,'MANUAL','legacy-only')",[first.id,uid(1)]);
  await edit(first.id,{inboundDate:'2028-01-01',changeCount:100,previousInboundDate:'2020-01-01'});assert.equal(await count(),1);
  await assert.rejects(db.query('DELETE FROM mps_review_due_date_changes WHERE review_due_date_id=$1',[first.id]),/不可修改/);await assert.rejects(db.query('UPDATE mps_review_due_date_changes SET source_batch_id=\'lost\' WHERE review_due_date_id=$1',[first.id]),/不可修改/);
  assert.equal((await query.history(first.id,{},ordinary)).total,1);
 });
 await check('observe preserves manual counter/previous date and never creates new automatic events',async()=>{
  const s=await app.observe({...base,orderNumber:'SYNC-SYNTHETIC',sourceKind:'SYNC',sourceBatchId:'initial',allowInitialCreate:true},actor);await edit(s.id,{changeCount:3,previousInboundDate:'2026-01-01'});
  await app.observe({...base,orderNumber:'SYNC-SYNTHETIC',inboundDate:'2027-01-01',quantity:'2',sourceKind:'SYNC',sourceBatchId:'next'},actor);const after=await state(s.id);assert.equal(after.change_count,3);assert.equal(after.previous_date_text,'2026-01-01');assert.equal(await count(),1);
 });
 await check('server filter/sort/export shares division scopes, exact quantity and human audit names',async()=>{
  const f={logic:'AND',rules:[{field:'divisionId',operator:'eq',value:uid(13)}]},list=await query.list({filterGroup:f,sortField:'orderNumber',sortOrder:'desc'},ordinary);assert.equal(list.total,2);assert(list.rows.every(x=>x.divisionId===uid(13)));
  const w=new Excel.Workbook();await w.xlsx.load(await query.export({filterGroup:f,sortField:'orderNumber',sortOrder:'desc'},ordinary));const s=w.worksheets[0];assert.equal(s.columnCount,13);assert.equal(s.rowCount,3);assert.deepEqual(s.getRow(1).values.slice(1),fields.map(f=>f.label));assert(String(s.getCell('A2').value).includes('事业三部'));assert.equal(s.getCell('G2').value,base.quantity);assert.equal(s.getCell('J2').value,'测试操作人1');assert.equal(s.getCell('L2').value,'测试操作人1');assert(!JSON.stringify(s.getRow(2).values).includes(uid(1)));
 });
 await check('non-owner FORCE RLS preserves tenant isolation and generic write paths remain forbidden',async()=>{
  await db.query('CREATE ROLE '+rlsRole);await db.query('GRANT SELECT ON mps_review_due_dates,mps_review_due_date_changes TO '+rlsRole);await db.transaction(async m=>{await m.query('SET LOCAL ROLE '+rlsRole);await m.query("SELECT set_config('app.tenant_id','OTHER',true)");assert.equal((await m.query('SELECT count(*)::int n FROM mps_review_due_dates'))[0].n,0);assert.equal((await m.query('SELECT count(*)::int n FROM mps_review_due_date_changes'))[0].n,0);});
  await denied(()=>genericApp.create(resource,base,actor),403);await denied(()=>genericApp.update(resource,first.id,{quantity:'1'},actor),403);await denied(()=>genericApp.importUpdates(resource,[],'x',actor),403);await denied(()=>genericApp.remove(resource,first.id,1,actor),403);
 });
 await check('full export crosses the 200-row batch boundary; pagination/filter/sort stay stable and exact',async()=>{
  for(let n=0;n<215;n++)await make({orderNumber:'PAGE-'+String(n).padStart(3,'0'),divisionId:uid(14),quantity:n+'.0000000000000000001'});
  const a=await query.list({search:'PAGE-'},ordinary),b=await query.list({search:'PAGE-',page:2},ordinary);assert.equal(a.total,215);assert.equal(a.rows.length,100);assert.equal(b.rows.length,100);assert(!a.rows.some(row=>b.rows.some(other=>row.id===other.id)));
  const sorted=await query.list({search:'PAGE-',sortField:'quantity',sortOrder:'desc'},ordinary);assert.equal(sorted.rows[0].quantity,'214.0000000000000000001');
  const w=new Excel.Workbook();await w.xlsx.load(await query.export({search:'PAGE-'},ordinary));assert.equal(w.worksheets[0].rowCount,216);assert.equal(w.worksheets[0].columnCount,13);assert.equal(typeof w.worksheets[0].getCell('G2').value,'string');
 });
 await check('Excel intersects read/export scopes and excludes hidden fields; create-only access cannot read rows',async()=>{
  const who={...ordinary,permissions:ordinary.permissions.filter(p=>p!==resource+':inspectionTimeName:read'),tableDataScopes:[{resource,scope:'CUSTOM',actions:['read'],rules:[{fieldKey:'quantity',operator:'GT',value:'200'}]},{resource,scope:'CUSTOM',actions:['export'],rules:[{fieldKey:'quantity',operator:'LT',value:'210'}]}]};
  const w=new Excel.Workbook();await w.xlsx.load(await query.export({search:'PAGE-'},who));assert.equal(w.worksheets[0].rowCount,11);assert.equal(w.worksheets[0].columnCount,12);assert(!w.worksheets[0].getRow(1).values.includes('品项名称'));
  const creator={...ordinary,permissions:ordinary.permissions.filter(p=>!p.endsWith(':*:read'))};assert(generic.metadata(resource,creator).actions.create);await denied(()=>query.list({},creator),403);
 });
 if(process.env.REVIEW_DUE_BROWSER_BASE)await require('./review-due-fields-v2.browser-checks.cjs')({r,root,db,app,query,generic,genericApp,sheet,directory,registry,actor,ordinary,base,uid,resource,fields,inputs,workbook,check,state,setHttp:v=>http=v,setBrowser:v=>browser=v});
 const result={passed:checks.length,checks};if(process.env.REVIEW_DUE_EVIDENCE_DIR)fs.writeFileSync(path.join(process.env.REVIEW_DUE_EVIDENCE_DIR,'postgres-v2-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(http)await http.close();if(upgrade?.isInitialized)await upgrade.destroy();if(db?.isInitialized)await db.destroy();if(control._connected){await control.query('DROP DATABASE IF EXISTS '+name+'_upgrade WITH (FORCE)');await control.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');await control.query('DROP ROLE IF EXISTS '+rlsRole);await control.end();}});
