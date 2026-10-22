/** Called only by the guarded disposable-PostgreSQL runner. All data below is synthetic. */
module.exports=async({r,db,app,query,spreadsheet,actor,editor,check,base,resource})=>{
 const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),Excel=r('exceljs');
 const {reviewDueDateCreateFields:fields}=r('@kdos/contracts');
 const importer={...editor,permissions:[resource+':*:import',resource+':*:create',...fields.flatMap(f=>[`${resource}:${f.key}:read`,`${resource}:${f.key}:update`])],tableDataScopes:[{resource,scope:'ALL',actions:['import','create']}]};
 const input={orderNumber:'IMPORT-NEW',batchNumber:'B-1/2',drawingNumber:'D-1/3',inspectionTimeName:'',inboundDate:'2026-11-10',quantity:'900719925474099312345.000000000000000000001'};
 const file=async(rows,mode='STANDARD',workbook)=>{const w=workbook??new Excel.Workbook(),s=w.getWorksheet(resource)??w.addWorksheet(resource);if(!s.rowCount)s.addRow([...(mode==='STANDARD'?['记录ID','版本']:[]),...fields.map(f=>f.label)]);for(const row of rows)s.addRow([...(mode==='STANDARD'?[row.id??null,row.expectedVersion??null]:[]),...fields.map(f=>row.values[f.key]??null)]);return {originalname:'synthetic.xlsx',buffer:Buffer.from(await w.xlsx.writeBuffer())};};
 const preview=async(rows,mode='STANDARD',who=importer,w)=>spreadsheet.preview(resource,await file(rows,mode,w),who);
 const get=async order=>(await db.query('SELECT *,inbound_date::text date_text FROM mps_review_due_dates WHERE tenant_id=$1 AND order_number=$2',[actor.tenantId,order]))[0];
 const n=async()=>(await db.query("SELECT count(*)::int n FROM mps_review_due_dates WHERE order_number LIKE 'IMPORT-%'"))[0].n;
 const status=async(fn,code)=>assert.rejects(fn,e=>e.getStatus?.()===code);
 const legacyPreview=async(rows,who=importer)=>db.transaction(async m=>{
   const {ReviewDueDateImportApplicationService}=r('./dist/modules/master-plan-system/review-due-date-import.application.service');
   const service=new ReviewDueDateImportApplicationService(),result=await service.prepare(rows.map((row,i)=>({row:i+2,id:null,expectedVersion:null,...row,values:Object.fromEntries(fields.map(f=>[f.key,row.values[f.key]]))})),'SOURCE',who,m);
   if(result.errors.length)return {...result,previewId:null};
   const [saved]=await m.query(`INSERT INTO mps_import_previews(tenant_id,user_id,resource,file_hash,payload_json,expires_at,created_by,updated_by) VALUES($1,$2::uuid,$3,'legacy-source-test',$4::jsonb,now()+interval '30 minutes',$2::uuid,$2::uuid) RETURNING id`,[who.tenantId,who.userId,resource,JSON.stringify({rows:result.rows,mode:'SOURCE'})]);
   return {...result,counts:result.publicCounts,rows:result.previewRows,previewId:saved.id};
 });
 let template,firstPreview,current;
 await check('import template downloads from empty-data metadata with eight ordered registry columns, exact text numeric, date format, notes and matching hidden schema',async()=>{
   template=await spreadsheet.template(resource,actor);if(process.env.REVIEW_DUE_EVIDENCE_DIR)require('fs').writeFileSync(require('path').join(process.env.REVIEW_DUE_EVIDENCE_DIR,'mps_review_due_dates_import_template.xlsx'),template,{mode:0o600});const w=new Excel.Workbook();await w.xlsx.load(template);const s=w.getWorksheet(resource);assert.equal(w.title,'评审交期表');assert.deepEqual(s.getRow(1).values.slice(1),['记录ID','版本',...fields.map(f=>f.label)]);assert.equal(s.rowCount,1);assert.equal(s.getColumn(8).numFmt,'@');assert.equal(s.getColumn(7).numFmt,'yyyy-mm-dd');assert(w.getWorksheet('填写说明').getCell('A2').text.includes('同时留空'));assert.equal(w.getWorksheet('_字段定义').getCell('B10').value,8);
   const readonly={...importer,permissions:[resource+':*:read',...fields.map(f=>`${resource}:${f.key}:read`)]};assert((await spreadsheet.template(resource,readonly)).length);await status(()=>spreadsheet.preview(resource,{originalname:'empty.xlsx',buffer:template},readonly,'STANDARD'),403);
   const hidden={...readonly,permissions:[resource+':*:read',resource+':quantity:read']},partial=new Excel.Workbook();await partial.xlsx.load(await spreadsheet.template(resource,hidden));assert.deepEqual(partial.getWorksheet(resource).getRow(1).values.slice(1),['记录ID','版本','数量']);assert(!partial.getWorksheet('填写说明').getRows(1,partial.getWorksheet('填写说明').rowCount).map(x=>x.values).join().includes('入库时间'));
 });
 await check('generated template previews without business writes, then ordinary import/create user confirms count-zero/no-history/audited exact row; duplicate confirms return one receipt',async()=>{
   const w=new Excel.Workbook();await w.xlsx.load(template);const before=await n();firstPreview=await preview([{values:input}],'STANDARD',importer,w);assert(firstPreview.previewId,JSON.stringify(firstPreview));assert.equal(firstPreview.counts.created,1);assert.equal(await n(),before);
   const results=await Promise.all(Array.from({length:3},()=>spreadsheet.confirm(resource,firstPreview.previewId,importer)));assert.equal(results[0].created,1);assert.equal(results.filter(x=>x.repeated).length,2);current=await get(input.orderNumber);assert.equal(current.quantity,input.quantity);assert.equal(current.change_count,0);assert.equal(current.last_synced_at,null);assert.equal(current.created_by,importer.userId);assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE record_id=$1 AND action='review_due_date.import_confirmed'",[firstPreview.previewId]))[0].n,1);assert.equal(current.source_order_number,input.orderNumber);assert.equal((await query.history(current.id,{},actor)).total,0);assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE record_id=$1 AND action='review_due_date.import_created'",[current.id]))[0].n,1);
 });
 await check('standard template accepts mixed real-ID updates and new rows, records IMPORT date/history once and keeps transaction identity',async()=>{
   const p=await preview([{id:current.id,expectedVersion:current.version,values:{...input,inboundDate:'2026-11-12'}},{values:{...input,orderNumber:'IMPORT-MIXED'}}],'STANDARD',actor);assert.equal(p.counts.updated,1);assert.equal(p.counts.created,1);assert.equal(p.counts.later,1);const result=await spreadsheet.confirm(resource,p.previewId,actor);assert.equal(result.updated,1);current=await get(input.orderNumber);assert.equal(current.change_count,1);assert.equal((await db.query('SELECT previous_inbound_date::text value FROM mps_review_due_dates WHERE id=$1',[current.id]))[0].value,'2026-11-10');const history=await query.history(current.id,{},actor);assert.equal(history.rows[0].sourceKind,'IMPORT');assert.equal(history.rows[0].sourceBatchId,p.previewId);assert.equal(current.id,firstPreview?current.id:null);
 });
 await check('identity pairing, malformed IDs/versions, file duplicate keys, required dates and nonfinite quantities reject previews with no submission token',async()=>{
   for(const row of [{id:current.id,values:input},{expectedVersion:1,values:input},{id:'forged',expectedVersion:1,values:input},{id:current.id,expectedVersion:0,values:input},{values:{...input,inboundDate:'2026-02-30'}},{values:{...input,quantity:'NaN'}},{values:{...input,orderNumber:'   '}}])assert.equal((await preview([row])).previewId,null);
   const p=await preview([{values:{...input,orderNumber:'IMPORT-DUP'}},{values:{...input,orderNumber:'IMPORT-DUP'}}]);assert.equal(p.counts.conflicts,1);assert.equal(p.previewId,null);
   const again=await spreadsheet.preview(resource,await file([{values:input}]),importer,'STANDARD');assert.equal(again.previewId,null);assert(again.errors[0].reason.includes('人工核实'));
 });
 await check('date equality and canonical Decimal equality are unchanged; quantity/name-only changes never count as delivery changes',async()=>{
   const values={...input,inboundDate:'2026-11-12',quantity:current.quantity+'0'};let p=await preview([{id:current.id,expectedVersion:current.version,values}],'STANDARD',actor);assert.equal(p.counts.unchanged,1);await spreadsheet.confirm(resource,p.previewId,actor);assert.equal((await get(input.orderNumber)).version,current.version);
   p=await preview([{id:current.id,expectedVersion:current.version,values:{...values,quantity:'7.00000000000000000001',inspectionTimeName:'Changed name'}}],'STANDARD',actor);assert.equal(p.counts.quantityChanged,1);assert.equal(p.counts.later+p.counts.earlier,0);await spreadsheet.confirm(resource,p.previewId,actor);current=await get(input.orderNumber);assert.equal(current.change_count,1);
 });
 let source;
 await check('historical SOURCE preview still matches immutable identities after manual rename without losing UUID/history or restoring current keys',async()=>{
   source=await app.observe({...base,orderNumber:'IMPORT-SOURCE',sourceBatchId:'import-source'},actor);await app.manualEdit(source.id,{orderNumber:'IMPORT-RENAMED',drawingNumber:'RENAMED-D',expectedVersion:1,commandId:randomUUID()},actor);
   const values={...base,orderNumber:'IMPORT-SOURCE',quantity:'12.00000000000000000001',inboundDate:'2026-11-08'};const p=await legacyPreview([{values}]);assert.equal(p.counts.earlier,null);assert.equal(p.restrictedComparison,true);assert.equal(p.rows[0].oldInboundDate,null);assert.equal(p.rows[0].orderNumber,'IMPORT-SOURCE');await spreadsheet.confirm(resource,p.previewId,importer);const row=await get('IMPORT-RENAMED');assert.equal(row.id,source.id);assert.equal(row.source_order_number,'IMPORT-SOURCE');assert.equal(row.drawing_number,'RENAMED-D');assert.equal(row.change_count,1);
   const raw=await file([{values}],'SOURCE');const duplicate=await spreadsheet.preview(resource,raw,importer);assert.equal(duplicate.previewId,null);assert.equal(duplicate.counts.conflicts,1);assert.equal((await get('IMPORT-RENAMED')).change_count,1);
 });
 await check('unified six columns create once, repeats conflict; eight-column real-ID changes and restoring old dates count, equality does not',async()=>{
   const values={...input,orderNumber:'IMPORT-SOURCE-NEW'};let p=await preview([{values}],'SOURCE');assert.equal(p.counts.created,1);await spreadsheet.confirm(resource,p.previewId,importer);
   const initial=await get(values.orderNumber);assert.equal(initial.last_synced_at,null);assert.equal(initial.change_count,0);const repeat=await preview([{values}],'SOURCE');assert.equal(repeat.previewId,null);assert.equal(repeat.counts.conflicts,1);
   await status(()=>app.observe({...base,...values,sourceBatchId:'must-review-unified-create',allowInitialCreate:false},actor),409);
   for(const date of ['2026-11-12','2026-11-08','2026-11-10']){const row=await get(values.orderNumber);p=await preview([{id:row.id,expectedVersion:row.version,values:{...values,inboundDate:date}}]);await spreadsheet.confirm(resource,p.previewId,importer);}
   const row=await get(values.orderNumber);assert.equal(row.change_count,3);p=await preview([{id:row.id,expectedVersion:row.version,values}]);assert.equal(p.counts.unchanged,1);await spreadsheet.confirm(resource,p.previewId,importer);assert.equal((await get(values.orderNumber)).change_count,3);
   const old=await legacyPreview([{values:{...input,orderNumber:'IMPORT-LEGACY-CREATE'}}]);const result=await spreadsheet.confirm(resource,old.previewId,importer);assert.equal(result.created,1);const receipt=await spreadsheet.confirm(resource,old.previewId,importer);assert.equal(receipt.repeated,true);assert.equal((await get('IMPORT-LEGACY-CREATE')).change_count,0);
 });
 await check('manual-origin/source-key/current-key collisions remain manual-review conflicts and never silently merge',async()=>{
   assert.equal((await preview([{values:input}],'SOURCE')).previewId,null);
   const manualValues={...input,orderNumber:'IMPORT-MANUAL'};await app.manualCreate({...manualValues,commandId:randomUUID()},actor);const p=await preview([{values:manualValues}],'SOURCE');assert.equal(p.previewId,null);assert(p.errors[0].reason.includes('不合并或覆盖'));
   const collision={...input,orderNumber:'IMPORT-RENAMED',drawingNumber:'RENAMED-D',batchNumber:base.batchNumber};assert.equal((await preview([{values:collision}],'SOURCE')).previewId,null);
 });
 await check('six-column query hints cannot revive source updates; paired identity headers are mandatory together',async()=>{
   const values={...input,orderNumber:'IMPORT-AUTO-SIX'};const raw=await file([{values}],'SOURCE');const p=await spreadsheet.preview(resource,raw,importer,'SOURCE');assert.equal(p.counts.created,1);assert.equal(p.mode,undefined);await spreadsheet.confirm(resource,p.previewId,importer);
   const repeated=await spreadsheet.preview(resource,raw,importer,'SOURCE');assert.equal(repeated.previewId,null);assert.equal(repeated.counts.conflicts,1);assert.equal((await get(values.orderNumber)).change_count,0);
   for(const identity of ['记录ID','版本']){const w=new Excel.Workbook();w.addWorksheet(resource).addRow([identity,...fields.map(f=>f.label)]);await assert.rejects(spreadsheet.preview(resource,{originalname:'partial.xlsx',buffer:Buffer.from(await w.xlsx.writeBuffer())},importer),/记录ID和版本列必须同时/);}
 });
 await check('mixed parse errors retain complete total/field/row diagnostics and valid-row counts but never create a confirm token',async()=>{
   const p=await preview([{values:{...input,orderNumber:'IMPORT-VALID-PREVIEW'}},{values:{...input,orderNumber:'IMPORT-BAD-PREVIEW',quantity:{formula:'1+1'}}}],'SOURCE');assert.equal(p.total,2);assert.equal(p.counts.total,2);assert.equal(p.counts.created,1);assert.equal(p.counts.errors,1);assert.equal(p.errors[0].row,3);assert(p.errors[0].reason.includes('数量'));assert.equal(p.previewId,null);assert.equal(await get('IMPORT-VALID-PREVIEW'),undefined);
 });
 await check('inspection-only standard update writes audit without a delivery event; existing source UUID/key/history survive ID updates',async()=>{
   const old=await get('IMPORT-RENAMED'),before=await query.history(old.id,{},actor),values={orderNumber:old.order_number,batchNumber:old.batch_number,drawingNumber:old.drawing_number,inspectionTimeName:'Name only',inboundDate:old.date_text,quantity:old.quantity};
   const p=await preview([{id:old.id,expectedVersion:old.version,values}],'STANDARD',actor);assert.equal(p.counts.updated,1);assert.equal(p.counts.quantityChanged,0);assert.equal(p.counts.earlier+p.counts.later,0);await spreadsheet.confirm(resource,p.previewId,actor);
   const after=await get('IMPORT-RENAMED');assert.equal(after.change_count,old.change_count);assert.equal(after.source_order_number,old.source_order_number);assert.equal(after.source_batch_number,old.source_batch_number);assert.equal(after.source_drawing_number,old.source_drawing_number);assert.deepEqual((await query.history(old.id,{},actor)).rows,before.rows);assert.equal(after.id,old.id);
 });
 await check('import/create/field/action-scope permissions and import-only metadata preserve no-read isolation',async()=>{
   const values={...input,orderNumber:'IMPORT-PERM'};await status(()=>preview([{values}],'STANDARD',{...importer,permissions:importer.permissions.filter(p=>p!==resource+':*:import')}),403);
   await status(()=>preview([{values}],'STANDARD',{...importer,permissions:importer.permissions.filter(p=>p!==resource+':*:create')}),403);
   await status(()=>preview([{values}],'STANDARD',{...importer,permissions:importer.permissions.filter(p=>!p.includes(':quantity:'))}),403);
   await status(()=>preview([{values}],'STANDARD',{...importer,tableDataScopes:[]}),403);
   await status(()=>preview([{values}],'STANDARD',{...importer,tableDataScopes:[{resource,scope:'CUSTOM',rules:[{fieldKey:'orderNumber',operator:'EQ',value:'OTHER'}]}]}),403);
   const old=await get(input.orderNumber);await status(()=>preview([{id:old.id,expectedVersion:old.version,values:{...input,inboundDate:'2026-12-01'}}],'STANDARD',{...importer,permissions:importer.permissions.filter(p=>p!==resource+':inboundDate:update')}),403);
   const dateScope=await preview([{id:old.id,expectedVersion:old.version,values:{...input,inboundDate:old.date_text,quantity:'19'}}],'STANDARD',{...importer,tableDataScopes:[{resource,scope:'CUSTOM',rules:[{fieldKey:'inboundDate',operator:'EQ',value:old.date_text}]}]});assert(dateScope.previewId);
   const metadata=spreadsheet.queries?.metadata?.(resource,importer);if(metadata){assert.equal(metadata.actions.import,true);assert.deepEqual(metadata.fields,[]);}await status(()=>query.list({},importer),403);
 });
 await check('tenant, preview ownership and enabled-user checks are revalidated and cannot leak or mutate other-tenant records',async()=>{
   const foreign={...importer,tenantId:'OTHER',userId:'0199ea00-0000-7000-8000-000000000002'};await status(()=>spreadsheet.confirm(resource,firstPreview.previewId,foreign),400);
   const old=await get(input.orderNumber),p=await preview([{id:old.id,expectedVersion:old.version,values:{...input,inboundDate:'2026-12-01'}}],'STANDARD',foreign);assert.equal(p.previewId,null);
   await status(()=>preview([{values:{...input,orderNumber:'IMPORT-NONMEMBER'}}],'STANDARD',{...importer,tenantId:'OTHER'}),403);
   await db.query('UPDATE users SET enabled=false WHERE id=$1',[importer.userId]);try{await status(()=>preview([{values:{...input,orderNumber:'IMPORT-DISABLED'}}]),403);}finally{await db.query('UPDATE users SET enabled=true WHERE id=$1',[importer.userId]);}
 });
 await check('confirm rejects stale versions and revoked permissions; valid multirow work is fully rolled back',async()=>{
   const old=await get(input.orderNumber),p=await preview([{values:{...input,orderNumber:'IMPORT-ROLLBACK'}},{id:old.id,expectedVersion:old.version,values:{...input,inboundDate:'2026-12-01'}}]);await app.manualEdit(old.id,{inspectionTimeName:'Concurrent',expectedVersion:old.version,commandId:randomUUID()},actor);await status(()=>spreadsheet.confirm(resource,p.previewId,importer),409);assert.equal(await get('IMPORT-ROLLBACK'),undefined);
   const p2=await preview([{values:{...input,orderNumber:'IMPORT-REVOKED'}}]);await status(()=>spreadsheet.confirm(resource,p2.previewId,{...importer,permissions:[]}),403);assert.equal(await get('IMPORT-REVOKED'),undefined);
 });
 await check('mid-transaction audit failure rolls back every new row, all receipts and the preview confirmation',async()=>{
   const p=await preview([{values:{...input,orderNumber:'IMPORT-ATOMIC-1'}},{values:{...input,orderNumber:'IMPORT-ATOMIC-2'}}]);await db.query("CREATE FUNCTION import_audit_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='review_due_date.import_created' AND NEW.after_json->>'order_number'='IMPORT-ATOMIC-2' THEN RAISE EXCEPTION 'synthetic import audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER import_audit_test_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION import_audit_test_fail()");
   try{await assert.rejects(spreadsheet.confirm(resource,p.previewId,importer),/synthetic import audit failure/);assert.equal(await get('IMPORT-ATOMIC-1'),undefined);assert.equal(await get('IMPORT-ATOMIC-2'),undefined);assert.equal((await db.query('SELECT confirmed_at FROM mps_import_previews WHERE id=$1',[p.previewId]))[0].confirmed_at,null);assert.equal((await db.query('SELECT count(*)::int n FROM idempotency_keys WHERE key LIKE $1',['%'+p.previewId+'%']))[0].n,0);}finally{await db.query('DROP TRIGGER import_audit_test_fail ON audit_logs; DROP FUNCTION import_audit_test_fail()');}
 });
 await check('audit failure after an IMPORT date event rolls back date/count/history/new rows/audit/receipt together',async()=>{
   const old=await get(input.orderNumber),history=await query.history(old.id,{},actor),beforeAudits=(await db.query('SELECT count(*)::int n FROM audit_logs'))[0].n;
   const p=await preview([{id:old.id,expectedVersion:old.version,values:{...input,inboundDate:'2027-01-08'}},{values:{...input,orderNumber:'IMPORT-DATE-ATOMIC'}}],'STANDARD',actor);
   await db.query("CREATE FUNCTION import_date_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='review_due_date.import_confirmed' THEN RAISE EXCEPTION 'synthetic final audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER import_date_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION import_date_fail()");
   try{await assert.rejects(spreadsheet.confirm(resource,p.previewId,actor),/synthetic final audit failure/);}finally{await db.query('DROP TRIGGER import_date_fail ON audit_logs; DROP FUNCTION import_date_fail()');}
   assert.deepEqual(await get(input.orderNumber),old);assert.deepEqual((await query.history(old.id,{},actor)).rows,history.rows);assert.equal(await get('IMPORT-DATE-ATOMIC'),undefined);assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs'))[0].n,beforeAudits);assert.equal((await db.query('SELECT confirmed_at FROM mps_import_previews WHERE id=$1',[p.previewId]))[0].confirmed_at,null);
 });
 await check('headers auto-detect six/eight columns, name missing fields and never trust stale hidden positions',async()=>{
   const w=new Excel.Workbook();await w.xlsx.load(template);const s=w.getWorksheet(resource);s.spliceColumns(1,2);s.addRow(fields.map(f=>input[f.key]));const noOptional=new Excel.Workbook(),partial=noOptional.addWorksheet(resource);partial.addRow(['记录ID','版本',...fields.filter(f=>f.key!=='inspectionTimeName').map(f=>f.label)]);const absent={originalname:'missing-column.xlsx',buffer:Buffer.from(await noOptional.xlsx.writeBuffer())};await status(()=>spreadsheet.preview(resource,absent,importer,'STANDARD'),400);
   const stale={originalname:'stale.xlsx',buffer:Buffer.from(await w.xlsx.writeBuffer())};for(const mode of ['STANDARD','SOURCE'])await status(()=>spreadsheet.preview(resource,stale,importer,mode),400);
 });
 await check('Excel cached formulas, native dates/serials, blanks and encrypted containers receive precise supported/rejected handling',async()=>{
   let p=await preview([{values:{...input,orderNumber:'IMPORT-FORMULA',quantity:{formula:'1+1',result:2},inboundDate:46336}}]);assert(p.previewId,JSON.stringify(p));assert.equal(p.rows[0].newQuantity,'2');
   p=await preview([{values:{...input,quantity:{formula:'1+1'}}}]);assert.equal(p.previewId,null);assert(p.errors[0].reason.includes('缓存'));
   p=await preview([{values:{...input,quantity:9007199254740992}}]);assert.equal(p.previewId,null);assert(p.errors[0].reason.includes('精度'));
   await assert.rejects(spreadsheet.preview(resource,{originalname:'encrypted.xlsx',buffer:Buffer.concat([Buffer.from('d0cf11e0a1b11ae1','hex'),Buffer.from('EncryptedPackage','utf16le')])},importer,'STANDARD'),/该文件被加密,请解密后再导入\./);
 });
 let realFile,realEncrypted;
 if(process.env.REVIEW_DUE_REAL_FILE){
   const fs=require('node:fs'),path=require('node:path');realFile={originalname:path.basename(process.env.REVIEW_DUE_REAL_FILE),buffer:fs.readFileSync(process.env.REVIEW_DUE_REAL_FILE)};realEncrypted=r('./dist/spreadsheet-upload').isEncryptedSpreadsheet(realFile.buffer);
   await check(realEncrypted?'provided real workbook is rejected as encrypted before preview, with no business or preview-ledger writes':'provided real unencrypted workbook previews every row without confirmation or business writes',async()=>{
     const totals=async()=>({main:(await db.query('SELECT count(*)::int n FROM mps_review_due_dates'))[0].n,history:(await db.query('SELECT count(*)::int n FROM mps_review_due_date_changes'))[0].n,previews:(await db.query('SELECT count(*)::int n FROM mps_import_previews'))[0].n});const before=await totals();
     if(realEncrypted){await assert.rejects(spreadsheet.preview(resource,realFile,actor),/该文件被加密,请解密后再导入\./);assert.deepEqual(await totals(),before);}
     else{const p=await spreadsheet.preview(resource,realFile,actor);assert(p.previewId);assert.equal(p.total,1114);assert.equal(p.counts.created,1114);assert.equal(p.errors.length,0);const Decimal=r('decimal.js').clone({precision:100});assert.equal(p.rows.reduce((sum,row)=>sum.plus(row.newQuantity),new Decimal(0)).toFixed(),'1009696');const after=await totals();assert.equal(after.main,before.main);assert.equal(after.history,before.history);}
   });
 }
 return {importer,file,input,realFile,realEncrypted};
};
