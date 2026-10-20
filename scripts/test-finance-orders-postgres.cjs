#!/usr/bin/env node
/** Synthetic business fixtures only; refuses production endpoints. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {createRequire}=require('node:module');const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json'));
const {DataSource}=req('typeorm'),{Client}=req('pg'),Decimal=req('decimal.js');
const {AuditLog}=req('./dist/entities'),{FinanceRepository}=req('./dist/modules/finance/finance.repository');
const {FinanceOrdersApplicationService}=req('./dist/modules/finance/finance-orders.application.service'),{FinanceOrdersQueryService}=req('./dist/modules/finance/finance-orders.query.service');
const {TableFilterRegistry}=req('./dist/common/filtering/table-filter.registry'),{TableFilterController}=req('./dist/common/filtering/table-filter.controller'),{TablePrintService}=req('./dist/common/printing/table-print.service');
const {FinanceCustomerMappings1722920088000:Customers}=req('./dist/migrations/1722920088000-FinanceCustomerMappings');
const {FinanceE10Analytics1722920089000:Analytics}=req('./dist/migrations/1722920089000-FinanceE10Analytics');
const {FinanceE10DeliveryDateConflicts1722920090000:DateConflicts}=req('./dist/migrations/1722920090000-FinanceE10DeliveryDateConflicts');
const {FinanceE10EarliestDeliveryDate1722920091000:EarliestDate}=req('./dist/migrations/1722920091000-FinanceE10EarliestDeliveryDate');
const {FinanceE10SpecifiedClose1722920095000:SpecifiedClose}=req('./dist/migrations/1722920095000-FinanceE10SpecifiedClose');
const {FinanceE10SpecifiedItems1722920096000:SpecifiedItems}=req('./dist/migrations/1722920096000-FinanceE10SpecifiedItems');
const {financeOrderFields,financeMonthlyFields,financeRankingFields}=req('@kdos/contracts');const ExcelJS=req('exceljs');
const host=process.env.FINANCE_TEST_POSTGRES_HOST;if(!host?.startsWith('/tmp/kdos-finance-pg-'))throw Error('Isolated socket required');
const name='finance_orders_test_'+Date.now(),user='knplan',actor={tenantId:'KAINAN',userId:'0199e000-0000-7000-8000-000000000001',username:'fixture',requestId:'finance-order-test',permissions:['*'],source:'web'};
const control=new Client({host,user,database:'postgres'}),checks=[];let db;const check=async(label,fn)=>{await fn();checks.push(label);};
const id=n=>'0199e000-0000-7000-8000-'+String(n).padStart(12,'0');
const line=(order,n,amount,customer='A140',year=2025)=>({...Object.fromEntries(financeOrderFields.map(f=>[f.key,f.type==='number'?'1':f.type==='boolean'?true:f.type==='date'?`${year}-01-01`:'合成测试'])),docType:'销售订单',approved:'Y',businessRemark:'订单头备注-'+order,sourceOrderId:id(order),sourceLineId:id(n),yearMonth:`${year}-01`,orderDate:`${year}-01-01`,deliveryDate:`${year}-02-01`,orderNo:'SYN-'+order,customerCode:customer,sequence:String(n),localNet:amount,localTax:'0',localGross:amount,scheduleCount:1,headerCloseCode:'0',hasSpecifiedCloseSchedule:false,headerModifiedAt:`${year}-01-01T00:00:00`,lineModifiedAt:`${year}-01-01T00:00:00`,scheduleModifiedAt:`${year}-01-01T00:00:00`});
let batch=[line(1,101,'0.10'),line(1,102,'0.20'),line(2,103,'0','A140-2'),line(3,104,'5','MISSING'),line(4,105,'-1','MISSING',2026)],failAfter=-1;
const reader={read:async(consume,options)=>{
 const coverage=[2025,2026].map(year=>{const rows=batch.filter(r=>r.yearMonth.startsWith(String(year)));return {year,orders:new Set(rows.map(r=>r.sourceOrderId)).size,lines:rows.length,localGross:rows.reduce((n,r)=>n.plus(r.localGross),new Decimal(0)).toString()};}).filter(r=>r.lines);
 await consume({kind:'source',database:'SYNTHETIC-E10',localCurrency:'RMB',observedAt:'2026-10-14T08:00:00',coverage,mode:options?.since?'INCREMENTAL':'FULL'});
 const rows=options?.cursor?batch.filter(r=>r.sourceLineId>options.cursor.lineId):batch;
 let count=0;for(const row of rows){await consume({kind:'page',rows:[row],cursor:{date:row.orderDate,lineId:row.sourceLineId}});if(++count===failAfter)throw Error('synthetic source failure');}await consume({kind:'complete'});
}};
(async()=>{
 await control.connect();await control.query(`CREATE DATABASE ${name}`);db=new DataSource({type:'postgres',host,username:user,database:name,entities:[AuditLog],synchronize:true,logging:false});await db.initialize();
 await db.query('CREATE TABLE users(id uuid PRIMARY KEY)');await db.query('INSERT INTO users VALUES($1)',[actor.userId]);const runner=db.createQueryRunner();await new Customers().up(runner);await new Analytics().up(runner);await new DateConflicts().up(runner);await runner.release();
 const repo=new FinanceRepository(db);const tx=repo.transaction.bind(repo);repo.transaction=(...args)=>tx(...args).catch(e=>{console.error('Synthetic test database error: '+e.message);throw e;});const registry=new TableFilterRegistry(),queries=new FinanceOrdersQueryService(repo,registry);queries.onModuleInit();
 // Historical migration scenarios below predate the added column; expose an empty
 // new contract field until the final current-schema upgrade, without rewriting old migrations.
 const legacyMonthly=registry.get('finance-e10-monthly');delete legacyMonthly.columns.businessRemark;legacyMonthly.expressions.businessRemark='NULL::text';
 const app=new FinanceOrdersApplicationService(repo,reader);await app.onModuleInit();
 const tables=new TableFilterController(null,registry,null,db),exporter=new TablePrintService(registry,db);
 const list=(resource,q={},a=actor)=>tables.rows({resource,page:'1',pageSize:'100',...q},{user:{...a,sub:a.userId}});
 const run=async(input={},a=actor)=>{const r=await app.refresh(a,input);for(let i=0;i<2000;i++){const [s]=await db.query('SELECT * FROM finance_e10_runs WHERE id=$1',[r.id]);if(s.status!=='RUNNING')return s;await new Promise(ok=>setTimeout(ok,5));}throw Error('Timed out synthetic run');};
 await repo.transaction(actor.tenantId,m=>m.query("INSERT INTO finance_customer_mappings(tenant_id,customer_code,department_category,sales_channel,source,created_by,updated_by) VALUES($1,'A140','业务一部','内销','INITIAL_IMPORT',$2,$2),($1,'A140-2','业务二部','外销','INITIAL_IMPORT',$2,$2)",[actor.tenantId,actor.userId]));
 await check('verified publication and exact per-item tax arithmetic',async()=>{assert.equal((await run()).status,'SUCCESS');assert.equal((await list('finance-e10-lines')).total,5);});
 await check('multi-line order sum is 0.30, not floating-point or duplicated',async()=>{const r=(await list('finance-e10-monthly')).rows.find(r=>r.orderNo==='SYN-1');assert.equal(r.orderTotal,'0.30');assert.equal((await list('finance-e10-monthly')).total,4);});
 await check('full suffix classifications are exact and pending values remain null',async()=>{const rows=(await list('finance-e10-monthly')).rows;assert.equal(rows.find(r=>r.customerCode==='A140-2').departmentCategory,'业务二部');assert.equal(rows.find(r=>r.customerCode==='MISSING').salesChannel,null);});
 await check('dashboard all dimensions, pending, zero and twelve months reconcile',async()=>{const d=await queries.dashboard({context:{year:2025}},actor);assert.equal(d.totals.amount,'5.30');assert.equal(d.totals.orders,3);assert.equal(d.totals.pendingAmount,'5.00');assert.equal(d.totals.zeroOrders,1);for(const group of [d.channels,d.departments,d.months,d.matrix])assert(new Decimal(group.reduce((v,r)=>v.plus(r.amount),new Decimal(0))).equals(d.totals.amount));assert.equal(d.months.length,12);assert.equal(d.months[11].amount,'0.00');});
 await check('2025 and 2026 scope use the same business month',async()=>{assert.equal((await queries.dashboard({context:{year:2026}},actor)).totals.amount,'-1.00');});
 await check('replay neither duplicates rows nor changes business versions/audits',async()=>{const before=await db.query('SELECT source_line_id,version FROM finance_e10_lines ORDER BY source_line_id');const audit=(await db.query("SELECT count(*)::integer n FROM audit_logs WHERE action='finance.e10.line.updated'"))[0].n;const r=await run();assert.equal(r.status,'SUCCESS');assert.equal(r.changed_count,0);assert.deepEqual(await db.query('SELECT source_line_id,version FROM finance_e10_lines ORDER BY source_line_id'),before);assert.equal((await db.query("SELECT count(*)::integer n FROM audit_logs WHERE action='finance.e10.line.updated'"))[0].n,audit);});
 await check('changed item recalculates order total with before and after audit',async()=>{batch=batch.map(r=>r.sourceLineId===id(101)?{...r,localNet:'10',localGross:'10'}:r);assert.equal((await run()).changed_count,1);assert.equal((await list('finance-e10-monthly')).rows.find(r=>r.orderNo==='SYN-1').orderTotal,'10.20');const [a]=await db.query("SELECT before_json,after_json FROM audit_logs WHERE action='finance.e10.line.updated' AND before_json IS NOT NULL ORDER BY created_at DESC LIMIT 1");assert.equal(a.before_json.localGross,'0.10');assert.equal(a.after_json.localGross,'10');});
 await check('current customer reclassification immediately updates historical analytics',async()=>{await repo.transaction(actor.tenantId,m=>m.query("UPDATE finance_customer_mappings SET department_category='业务四部' WHERE tenant_id=$1 AND customer_code='A140'",[actor.tenantId]));const d=await queries.dashboard({context:{year:2025}},actor);assert.equal(d.departments.find(r=>r.category==='业务四部').amount,'10.20');});
 await check('migration repairs existing conflicting dates using MIN without changing source rows or any financial dimension',async()=>{
  batch=batch.map(r=>r.sourceLineId===id(102)?{...r,deliveryDate:'2025-03-01'}:r);assert.equal((await run()).status,'SUCCESS');
  const before=await queries.dashboard({context:{year:2025}},actor);const raw=await db.query('SELECT * FROM finance_e10_lines ORDER BY id');
  assert.equal((await list('finance-e10-monthly')).rows.find(r=>r.orderNo==='SYN-1').deliveryDate,null);
  const runner=db.createQueryRunner();try{
   await new EarliestDate().up(runner);
   assert.deepEqual(await db.query('SELECT * FROM finance_e10_lines ORDER BY id'),raw);
   assert.deepEqual(await queries.dashboard({context:{year:2025}},actor),before);
   const orders=await list('finance-e10-monthly');assert.equal(orders.total,4);const multiple=orders.rows.find(r=>r.orderNo==='SYN-1');assert.equal(multiple.deliveryDate,'2025-02-01');assert.equal(multiple.orderTotal,'10.20');assert.equal(multiple.deliveryDateConflict,true);
   await new EarliestDate().down(runner);assert.equal((await list('finance-e10-monthly')).rows.find(r=>r.orderNo==='SYN-1').deliveryDate,null);
   await new EarliestDate().up(runner);await new EarliestDate().up(runner);assert.equal((await list('finance-e10-monthly')).rows.find(r=>r.orderNo==='SYN-1').deliveryDate,'2025-02-01');
  }finally{await runner.release();}
 });
 await check('earliest dates ignore nulls, handle all-null/repeated dates and propagate through filters and current-contract export',async()=>{
  const original=batch.map(r=>({...r}));const before=await queries.dashboard({context:{year:2025}},actor);
  for(const dates of [[null,'2025-03-01'],['2025-03-01',null],[null,null],['2025-03-01','2025-03-01'],['2025-03-01','2025-02-01']]){
   batch=batch.map(r=>r.sourceOrderId===id(1)?{...r,deliveryDate:dates[r.sourceLineId===id(101)?0:1]}:r);assert.equal((await run()).status,'SUCCESS');
   const expected=dates.filter(Boolean).sort()[0]??null;const monthly=(await list('finance-e10-monthly')).rows.find(r=>r.orderNo==='SYN-1');assert.equal(monthly.deliveryDate,expected);assert.equal(monthly.orderDate,'2025-01-01');
   assert.deepEqual(await queries.dashboard({context:{year:2025}},actor).then(d=>({...d,totals:{...d.totals,deliveryDateConflicts:before.totals.deliveryDateConflicts}})),before);
   assert.equal((await queries.dashboard({context:{year:2025}},actor)).totals.deliveryDateConflicts,new Set(dates.filter(Boolean)).size>1?1:0);
   const raw=(await list('finance-e10-lines')).rows.filter(r=>r.orderNo==='SYN-1');assert.deepEqual(raw.map(r=>r.deliveryDate).sort(),dates.slice().sort());
   const filterGroup={logic:'AND',rules:[{field:'orderNo',operator:'eq',value:'SYN-1'},{field:'deliveryDate',operator:expected?'eq':'is_empty',...(expected?{value:expected}:{})}]};assert.equal((await list('finance-e10-monthly',{filterGroup:JSON.stringify(filterGroup)})).total,1);
   const book=new ExcelJS.Workbook();await book.xlsx.load(await exporter.exportXlsx('finance-e10-monthly',{filterGroup},actor));assert.equal(book.worksheets[0].rowCount,2);assert.equal(book.worksheets[0].getCell('E2').text,expected??'');assert.equal(book.worksheets[0].getCell('F2').text,'10.20');
  }
  batch=original;await run();
 });
 await check('missing delivery plan stays null in raw data and enters exception report',async()=>{batch.push({...line(5,106,'2'),scheduleCount:0,closeCode:null,deliveredBusinessQty:null,deliveredPriceQty:null});assert.equal((await run()).status,'SUCCESS');assert((await queries.exceptions(actor)).some(r=>r.issueLines===1));});
 await check('failed source preserves published totals and resumable pages',async()=>{const before=await list('finance-e10-lines');failAfter=2;const failed=await run();assert.equal(failed.status,'FAILED');assert.equal(failed.page_count,2);assert.equal((await list('finance-e10-lines')).total,before.total);failAfter=-1;assert.equal((await run({resumeId:failed.id})).status,'SUCCESS');});
 await check('resuming legacy pages without header state fails atomically and requires a full reread',async()=>{
  const before=await db.query('SELECT id,version,payload FROM finance_e10_lines ORDER BY id');failAfter=1;const failed=await run();assert.equal(failed.status,'FAILED');failAfter=-1;
  await db.query("UPDATE finance_e10_pages p SET payload=(SELECT jsonb_agg(x-'headerCloseCode') FROM jsonb_array_elements(p.payload) x) WHERE run_id=$1",[failed.id]);
  const retried=await run({resumeId:failed.id});assert.equal(retried.status,'FAILED');assert(retried.error_summary.includes('请全量重新读取'));
  assert.deepEqual(await db.query('SELECT id,version,payload FROM finance_e10_lines ORDER BY id'),before);assert.equal((await run()).status,'SUCCESS');
 });
 await check('missing source rows retained and excluded rather than silently canceled',async()=>{batch=batch.filter(r=>r.sourceLineId!==id(104));assert.equal((await run()).status,'SUCCESS');assert.equal((await list('finance-e10-lines')).total,6);assert.equal((await db.query('SELECT count(*)::integer n FROM finance_e10_lines WHERE source_missing'))[0].n,1);});
 await check('field hiding and standard filters apply on list and export',async()=>{const resource='finance-e10-lines',viewer={...actor,permissions:[`${resource}:*:read`,`${resource}:*:export`,`${resource}:customerCode:read`],tableDataScopes:[{resource,scope:'ALL',actions:['read','export']}]};const r=await list(resource,{},viewer);assert.equal(r.rows[0].localGross,undefined);await assert.rejects(list(resource,{filterGroup:JSON.stringify({logic:'AND',rules:[{field:'localGross',operator:'gt',value:1}]})},viewer));const book=new ExcelJS.Workbook();await book.xlsx.load(await exporter.exportXlsx(resource,{},viewer));assert.deepEqual(book.worksheets[0].getRow(1).values.slice(1),['客户编号']);assert.equal(book.worksheets[0].rowCount,7);});
 await check('monetary custom authorization compares numeric values, not text',async()=>{const r='finance-e10-lines',limited={...actor,permissions:[`${r}:*:read`,...financeOrderFields.map(f=>`${r}:${f.key}:read`)],tableDataScopes:[{resource:r,scope:'CUSTOM',rules:[{fieldKey:'localGross',operator:'GT',value:'2'}]}]};const result=await list(r,{},limited);assert(result.rows.every(row=>new Decimal(row.localGross).gt(2)));assert(!result.rows.some(row=>row.localGross==='0.20'));});
 await check('no read/write/export bypass and no hidden dashboard money leakage',async()=>{const no={...actor,permissions:[]};await assert.rejects(list('finance-e10-lines',{},no));await assert.rejects(app.refresh(no));await assert.rejects(exporter.exportXlsx('finance-e10-lines',{},no));await assert.rejects(queries.dashboard({context:{year:2025}},{...actor,permissions:['finance-e10-dashboard:*:read']}));});
 await check('full Chinese 34 and ten headers export through platform',async()=>{for(const [resource,fields] of [['finance-e10-lines',financeOrderFields],['finance-e10-monthly',financeMonthlyFields]]){const book=new ExcelJS.Workbook();await book.xlsx.load(await exporter.exportXlsx(resource,{},actor));assert.deepEqual(book.worksheets[0].getRow(1).values.slice(1),fields.map(f=>f.label));}});
 await check('customer annual ranking is paged, filtered by aggregate and export matches',async()=>{const result=await queries.ranking({year:2026},actor);assert.equal(result.total,1);assert.equal(result.rows[0].orderTotal,'-1.00');const book=new ExcelJS.Workbook();await book.xlsx.load(await exporter.exportXlsx('finance-e10-ranking',{context:{year:2026}},actor));assert.equal(book.worksheets[0].rowCount,2);assert.equal(book.worksheets[0].getRow(1).getCell(2).value,'年累计本币总金额');});
 await check('ordinary dashboard division scope and customer ranking export intersect without changing administrator totals',async()=>{
  const resource='finance-e10-ranking',scoped={...actor,permissions:['finance-e10-dashboard:*:read',...financeMonthlyFields.map(f=>`finance-e10-dashboard:${f.key}:read`),`${resource}:*:read`,`${resource}:*:export`,...financeRankingFields.map(f=>`${resource}:${f.key}:read`)],tableDataScopes:[{resource:'finance-e10-dashboard',scope:'CUSTOM',rules:[{fieldKey:'departmentCategory',operator:'EQ',value:'业务四部'}]},{resource,scope:'CUSTOM',actions:['read'],rules:[{fieldKey:'customerCode',operator:'EQ',value:'A140'}]},{resource,scope:'CUSTOM',actions:['export'],rules:[{fieldKey:'customerCode',operator:'EQ',value:'MISSING'}]}]};
  const result=await queries.ranking({year:2025},scoped,{pageSize:100});assert.equal(result.total,1);assert.equal(result.rows[0].customerCode,'A140');assert.equal((await queries.dashboard({context:{year:2025}},scoped)).totals.amount,result.rows[0].orderTotal);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await exporter.exportXlsx(resource,{context:{year:2025}},scoped));assert.equal(book.worksheets[0].rowCount,1);
 });
 await check('freshness changes after an authorized classification write and successful sync, while the planner setting stays transaction-local',async()=>{
  const first=await queries.revision(actor);assert.match(first.revision,/^[a-f0-9]{64}$/);
  await repo.transaction(actor.tenantId,m=>m.query("UPDATE finance_customer_mappings SET version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND customer_code='A140'",[actor.tenantId]));
  const classified=await queries.revision(actor);assert.notEqual(classified.revision,first.revision);
  const [before]=await repo.transaction(actor.tenantId,m=>m.query("SELECT current_setting('enable_mergejoin') merge,current_setting('enable_nestloop') nested"));
  await queries.dashboard({context:{year:2026}},actor);
  const [after]=await repo.transaction(actor.tenantId,m=>m.query("SELECT current_setting('enable_mergejoin') merge,current_setting('enable_nestloop') nested"));assert.deepEqual(after,before);
  const prior=await queries.revision(actor);const last=await run();assert.equal(last.status,'SUCCESS');assert.notEqual((await queries.revision(actor)).revision,prior.revision);
  assert.notEqual((await queries.revision({...actor,tenantId:'OTHER'})).revision,(await queries.revision(actor)).revision);
 });
 await check('cross-tenant commands and views cannot read another tenant',async()=>{assert.equal((await queries.dashboard({context:{year:2025}},{...actor,tenantId:'OTHER'})).totals.orders,0);await db.query('CREATE ROLE finance_analytics_reader NOLOGIN NOSUPERUSER');await db.query('GRANT SELECT ON finance_e10_lines,finance_customer_mappings,finance_e10_raw,finance_e10_orders_all,finance_e10_monthly TO finance_analytics_reader');const q=db.createQueryRunner();await q.startTransaction();try{await q.query('SET LOCAL ROLE finance_analytics_reader');await q.query("SELECT set_config('app.tenant_id','OTHER',true)");assert.equal((await q.query('SELECT count(*)::integer n FROM finance_e10_monthly'))[0].n,0);}finally{await q.rollbackTransaction();await q.release();}});
 await check('specified-close migration preserves raw rows and excludes entire headers only, including tenant and account isolation',async()=>{
  const original=batch.map(r=>({...r}));
  const make=(order,n,amount,headerCloseCode,extra={})=>({...line(order,n,amount,'HEADER-TEST'),headerCloseCode,closeCode:'1',...extra});
  batch.push(make(5001,5101,'10','1',{closeCode:'2'}),make(5001,5102,'20','0',{closeCode:'2'}),make(5002,5103,'40','0'),make(5003,5104,'50','2'),make(5004,5105,'60',null),make(5005,5106,'70','0',{approved:'N'}),make(5006,5107,'80','1'),make(5007,5108,'10',null));
  assert.equal((await run()).status,'SUCCESS');
  const runner=db.createQueryRunner();
  const rawBefore=await db.query('SELECT * FROM finance_e10_lines ORDER BY id');
  try{
   await new SpecifiedClose().up(runner);
   assert.deepEqual(await db.query('SELECT * FROM finance_e10_lines ORDER BY id'),rawBefore);
   const filterGroup={logic:'AND',rules:[{field:'customerCode',operator:'eq',value:'HEADER-TEST'}]};
   const selected=()=>list('finance-e10-monthly',{filterGroup:JSON.stringify(filterGroup)});
   assert.equal((await selected()).total,5);assert.equal((await list('finance-e10-lines',{filterGroup:JSON.stringify(filterGroup)})).total,8);
   assert(!(await selected()).rows.some(r=>['SYN-5001','SYN-5006'].includes(r.orderNo)));
   for(const order of ['SYN-5002','SYN-5003','SYN-5004','SYN-5005'])assert((await selected()).rows.some(r=>r.orderNo===order));
   // Historical missing metadata and explicit NULL retain the old policy until refreshed.
   await db.query("UPDATE finance_e10_lines SET payload=payload-'headerCloseCode' WHERE source_line_id=$1",[id(5108)]);
   assert.equal((await selected()).total,5);
   // A specified header in a different tenant/account cannot exclude this tenant's normal order.
   const [runId]=await db.query("SELECT id FROM finance_e10_runs WHERE tenant_id='KAINAN' AND status='SUCCESS' ORDER BY completed_at DESC LIMIT 1");
   const [foreignRun]=await db.query("INSERT INTO finance_e10_runs(tenant_id,status,actor_id) VALUES('OTHER','SUCCESS',$1) RETURNING id",[actor.userId]);
   for(const [tenant,account,r]of [['KAINAN','OTHER-ACCOUNT',{...make(5001,6101,'100','0'),orderNo:'OTHER-ACCOUNT-HEADER',customerCode:'OTHER-ACCOUNT'}],['OTHER','SYNTHETIC-E10',make(5002,6102,'100','1')]])await db.query('INSERT INTO finance_e10_lines(tenant_id,source_database,source_order_id,source_line_id,payload,last_run_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7)',[tenant,account,r.sourceOrderId,r.sourceLineId,r,tenant==='OTHER'?foreignRun.id:runId.id,actor.userId]);
   assert((await list('finance-e10-monthly')).rows.some(r=>r.orderNo==='OTHER-ACCOUNT-HEADER'));
   assert((await selected()).rows.some(r=>r.orderNo==='SYN-5002'));
   const dashboard=await queries.dashboard({context:{year:2025,customerCode:'HEADER-TEST'}},actor);assert.equal(dashboard.totals.amount,'230.00');assert.equal(dashboard.totals.orders,5);
   for(const group of [dashboard.months,dashboard.departments,dashboard.channels,dashboard.matrix])assert(group.reduce((n,r)=>n.plus(r.amount),new Decimal(0)).equals('230'));
   assert.equal((await queries.ranking({year:2025,customerCode:'HEADER-TEST'},actor)).rows[0].orderTotal,'230.00');
   for(const [resource,options,rows,amountKey]of [['finance-e10-lines',{filterGroup},8,'本币合计金额'],['finance-e10-monthly',{filterGroup,page:99,pageSize:1},5,'本币总金额'],['finance-e10-ranking',{context:{year:2025,customerCode:'HEADER-TEST'}},1,'年累计本币总金额']]){
    const book=new ExcelJS.Workbook();await book.xlsx.load(await exporter.exportXlsx(resource,options,actor));const sheet=book.worksheets[0];assert.equal(sheet.rowCount-1,rows);
    const index=sheet.getRow(1).values.indexOf(amountKey);let total=new Decimal(0);for(let n=2;n<=sheet.rowCount;n++)total=total.plus(sheet.getRow(n).getCell(index).text);assert(total.equals(resource==='finance-e10-lines'?'340':'230'));
   }
   // A state change restores/excludes the same stable order without losing its raw items.
   batch=batch.map(r=>r.sourceOrderId===id(5001)?{...r,headerCloseCode:'2'}:r);assert.equal((await run()).status,'SUCCESS');assert.equal((await selected()).total,6);
   batch=batch.map(r=>r.sourceOrderId===id(5001)?{...r,headerCloseCode:'1'}:r);assert.equal((await run()).status,'SUCCESS');assert.equal((await selected()).total,5);assert.equal((await list('finance-e10-lines',{filterGroup:JSON.stringify(filterGroup)})).total,8);
   assert.equal((await run()).changed_count,0);
   await new SpecifiedClose().down(runner);assert.equal((await selected()).total,7);
   await new SpecifiedClose().up(runner);assert.equal((await selected()).total,5);
  }finally{batch=original;await run();await runner.release();}
 });
 await check('item-close migration retains other items, stable order ids and normal/null/zero/negative amounts',async()=>{
  const original=batch.map(r=>({...r}));
  const item=(order,n,amount,extra={})=>({...line(order,n,amount,'ITEM-TEST'),closeCode:'0',...extra});
  batch.push(item(6001,7101,'10',{closeCode:'1',hasSpecifiedCloseSchedule:true}),item(6001,7102,'40'),
   item(6002,7103,'20',{headerCloseCode:'2',closeCode:'1',hasSpecifiedCloseSchedule:true}),item(6002,7104,'30',{headerCloseCode:'2',closeCode:'2',approved:'N'}),
   item(6003,7105,'70',{closeCode:'1',hasSpecifiedCloseSchedule:true}),
   item(6004,7106,'9',{headerCloseCode:'1'}),item(6004,7107,'11'),
   item(6005,7108,'12',{headerCloseCode:null,closeCode:null}),item(6006,7109,'0'),item(6007,7110,'-3',{headerCloseCode:'2',closeCode:'2'}),
   item(6008,7111,'14',{closeCode:'冲突',hasSpecifiedCloseSchedule:true,itemCode:'SAME-CODE'}),item(6008,7112,'42',{itemCode:'SAME-CODE'}),
   item(6009,7113,'8',{closeCode:'冲突'}),item(6009,7114,'1'),item(6010,7115,'5',{scheduleCount:0}));
  assert.equal((await run()).status,'SUCCESS');
  const rawBefore=await db.query('SELECT * FROM finance_e10_lines ORDER BY id');
  const runner=db.createQueryRunner();
  const filterGroup={logic:'AND',rules:[{field:'customerCode',operator:'eq',value:'ITEM-TEST'}]};
  const selected=()=>list('finance-e10-monthly',{filterGroup:JSON.stringify(filterGroup)});
  try{
   await new SpecifiedItems().up(runner);
   assert.deepEqual(await db.query('SELECT * FROM finance_e10_lines ORDER BY id'),rawBefore);
   const actual=(await selected()).rows;
   assert.deepEqual(Object.fromEntries(actual.map(r=>[r.orderNo,r.orderTotal])),{'SYN-6001':'40.00','SYN-6002':'30.00','SYN-6005':'12.00','SYN-6006':'0.00','SYN-6007':'-3.00','SYN-6008':'42.00'});
   const [rawOrder]=await db.query('SELECT id FROM finance_e10_orders_all WHERE tenant_id=$1 AND source_order_id=$2',[actor.tenantId,id(6001)]);
   assert.equal(actual.find(r=>r.orderNo==='SYN-6001').id,rawOrder.id);
   assert.equal((await list('finance-e10-lines',{filterGroup:JSON.stringify(filterGroup)})).total,15);
   const [runId]=await db.query("SELECT id FROM finance_e10_runs WHERE tenant_id='KAINAN' AND status='SUCCESS' ORDER BY completed_at DESC LIMIT 1");
   const [foreignRun]=await db.query("SELECT id FROM finance_e10_runs WHERE tenant_id='OTHER' LIMIT 1");
   for(const [tenant,account,r]of [['KAINAN','ITEM-OTHER-ACCOUNT',{...item(6001,8101,'100'),customerCode:'ISOLATED',orderNo:'ITEM-ACCOUNT'}],['OTHER','SYNTHETIC-E10',item(6001,8102,'100',{hasSpecifiedCloseSchedule:true,headerCloseCode:'1'})]])await db.query('INSERT INTO finance_e10_lines(tenant_id,source_database,source_order_id,source_line_id,payload,last_run_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7)',[tenant,account,r.sourceOrderId,r.sourceLineId,r,tenant==='OTHER'?foreignRun.id:runId.id,actor.userId]);
   assert.equal((await selected()).rows.find(r=>r.orderNo==='SYN-6001').orderTotal,'40.00');
   assert.equal((await list('finance-e10-monthly')).rows.find(r=>r.orderNo==='ITEM-ACCOUNT').orderTotal,'100.00');
   const dashboard=await queries.dashboard({context:{year:2025,customerCode:'ITEM-TEST'}},actor);
   assert.equal(dashboard.totals.amount,'121.00');assert.equal(dashboard.totals.orders,6);
   for(const values of [dashboard.months,dashboard.channels,dashboard.departments,dashboard.matrix])assert(values.reduce((n,r)=>n.plus(r.amount),new Decimal(0)).equals('121'));
   assert.equal((await queries.ranking({year:2025,customerCode:'ITEM-TEST'},actor)).rows[0].orderTotal,'121.00');
   for(const [resource,options,rows,key,amount]of [['finance-e10-lines',{filterGroup},15,'本币合计金额','269'],['finance-e10-monthly',{filterGroup},6,'本币总金额','121'],['finance-e10-ranking',{context:{year:2025,customerCode:'ITEM-TEST'}},1,'年累计本币总金额','121']]){
    const book=new ExcelJS.Workbook();await book.xlsx.load(await exporter.exportXlsx(resource,options,actor));const sheet=book.worksheets[0];assert.equal(sheet.rowCount-1,rows);const col=sheet.getRow(1).values.indexOf(key);let total=new Decimal(0);for(let n=2;n<=sheet.rowCount;n++)total=total.plus(sheet.getRow(n).getCell(col).text);assert(total.equals(amount));
   }
   await assert.rejects(exporter.exportXlsx('finance-e10-monthly',{}, {...actor,permissions:[]}));
   assert(new Decimal((await queries.dashboard({context:{year:2025,customerCode:'ITEM-TEST'}},{...actor,tenantId:'OTHER'})).totals.amount).isZero());
   await new SpecifiedItems().down(runner);assert.equal((await selected()).rows.find(r=>r.orderNo==='SYN-6001').orderTotal,'50.00');
   await new SpecifiedItems().up(runner);
   batch=batch.map(r=>r.sourceLineId===id(7101)?{...r,closeCode:'2',hasSpecifiedCloseSchedule:false}:r);assert.equal((await run()).status,'SUCCESS');assert.equal((await selected()).rows.find(r=>r.orderNo==='SYN-6001').orderTotal,'50.00');
   batch=batch.map(r=>r.sourceOrderId===id(6001)?{...r,headerCloseCode:'1'}:r);assert.equal((await run()).status,'SUCCESS');assert(!(await selected()).rows.some(r=>r.orderNo==='SYN-6001'));
   batch=batch.map(r=>r.sourceOrderId===id(6001)?{...r,headerCloseCode:'2'}:r);await run();assert.equal((await selected()).rows.find(r=>r.orderNo==='SYN-6001').orderTotal,'50.00');assert.equal((await run()).changed_count,0);
   failAfter=1;const failed=await run();failAfter=-1;await db.query("UPDATE finance_e10_pages p SET payload=(SELECT jsonb_agg(x-'hasSpecifiedCloseSchedule') FROM jsonb_array_elements(p.payload) x) WHERE run_id=$1",[failed.id]);const before=await db.query('SELECT id,version FROM finance_e10_lines ORDER BY id');const resumed=await run({resumeId:failed.id});assert.equal(resumed.status,'FAILED');assert(resumed.error_summary.includes('请全量重新读取'));assert.deepEqual(await db.query('SELECT id,version FROM finance_e10_lines ORDER BY id'),before);
  }finally{batch=original;await run();await runner.release();}
 });
 await check('parallel refresh rejects overlap and failed source never publishes partial pages',async()=>{failAfter=1;const saved=reader.read;let release;const gate=new Promise(ok=>{release=ok;});reader.read=async(...args)=>{await gate;return saved(...args);};try{await app.refresh(actor);await assert.rejects(app.refresh(actor));}finally{release();}for(let i=0;i<500;i++){if(!(await db.query("SELECT 1 FROM finance_e10_runs WHERE status='RUNNING'")).length)break;await new Promise(r=>setTimeout(r,5));}reader.read=saved;failAfter=-1;});
 // Current business correction: all following records and events are synthetic.
 const correctionsRunner=db.createQueryRunner();
 for(const file of ['1722920097000-FinanceE10Movements','1722920098000-FinanceE10MovementJoin']){
  const migration=req('./dist/migrations/'+file);await new (Object.values(migration)[0])().up(correctionsRunner);
 }
 const sample=(order,n,total,patch={})=>({...line(order,n,total,'CORRECT'),...patch});
 batch=[sample(9001,9101,'100'),sample(9001,9102,'20'),
  sample(9002,9103,'10',{docType:'材料销售单'}),sample(9003,9104,'30',{approved:'N'}),
  sample(9004,9105,'5',{docType:'材料销售单',approved:'N'}),sample(9005,9106,'40',{approved:null}),
  sample(9006,9107,'50',{approved:'V'}),sample(9007,9108,'60',{headerCloseCode:'2',closeCode:'2'}),
  sample(9008,9109,'70',{headerCloseCode:'1'}),sample(9009,9110,'80',{hasSpecifiedCloseSchedule:true,closeCode:'1'}),
  sample(9009,9111,'90')];
 await run();
 for(const [order,lineId,delta]of [[9001,9101,'-20'],[9002,9103,'-5'],[9003,9104,'10']])await db.query(`INSERT INTO finance_e10_change_events(tenant_id,source_database,event_key,source_order_id,source_line_id,order_no,order_date,customer_code,effective_at,source_time,year_month,change_kind,time_basis,amount_before,amount_after,change_amount,included,evidence,payload,content_hash,created_by,updated_by)
 VALUES($1,'SYNTHETIC-E10',$2,$3,$4,$5,'2025-01-01','CORRECT','2025-02-01T10:00:00+08:00','2025-02-01T10:00:00','2025-02','REVISION','APPROVAL',100,100+$6::numeric,$6::numeric,true,'{}','{}',$2,$7,$7)`,[actor.tenantId,'SYN-EVENT-'+order,id(order),id(lineId),'SYN-'+order,delta,actor.userId]);
 const retainedLines=await db.query('SELECT * FROM finance_e10_lines ORDER BY id');
 const retainedEvents=await db.query('SELECT * FROM finance_e10_change_events ORDER BY id');
 const {FinanceE10BusinessEligibility1722920099000:BusinessEligibility}=req('./dist/migrations/1722920099000-FinanceE10BusinessEligibility');
 await check('eligibility migration preserves every raw item and posted source event without fabricated reversals',async()=>{
  await new BusinessEligibility().up(correctionsRunner);queries.onModuleInit();
  assert.deepEqual(await db.query('SELECT * FROM finance_e10_lines ORDER BY id'),retainedLines);
  assert.deepEqual(await db.query('SELECT * FROM finance_e10_change_events ORDER BY id'),retainedEvents);
 });
 await correctionsRunner.release();
 const correctFilter={logic:'AND',rules:[{field:'customerCode',operator:'eq',value:'CORRECT'}]};
 const correctRows=()=>list('finance-e10-monthly',{filterGroup:JSON.stringify(correctFilter)});
 await check('material and non-Y approval exclusions overlap only once while normal finished orders survive',async()=>{
  const rows=(await correctRows()).rows;assert.deepEqual(Object.fromEntries(rows.map(r=>[r.orderNo,r.orderTotal])),{'SYN-9001':'120.00','SYN-9007':'60.00','SYN-9009':'90.00'});
  assert.equal((await list('finance-e10-lines',{filterGroup:JSON.stringify(correctFilter)})).total,11);
 });
 await check('new monthly remark is the single header value, not concatenated or repeated per item',async()=>{
  const rows=(await correctRows()).rows;assert.equal(rows.find(r=>r.orderNo==='SYN-9001').businessRemark,'订单头备注-9001');
  assert.equal(financeMonthlyFields.at(-1).key,'businessRemark');assert.equal(financeMonthlyFields.length,10);
  for(const resource of ['finance-e10-monthly','finance-e10-lines']){
   const book=new ExcelJS.Workbook();await book.xlsx.load(await exporter.exportXlsx(resource,{filterGroup:correctFilter},actor));const sheet=book.worksheets[0];
   assert.equal(sheet.getRow(1).values.filter(v=>v==='备注-业务').length,1);
   const col=sheet.getRow(1).values.indexOf('备注-业务');assert.equal(col,resource==='finance-e10-monthly'?10:16);
   assert(sheet.getColumn(col).values.includes('订单头备注-9001'));
  }
 });
 await check('monthly dashboard ranking and occurrence legs reconcile under shared eligibility',async()=>{
  const d=await queries.dashboard({context:{year:2025,customerCode:'CORRECT'}},actor);assert.equal(d.totals.amount,'270.00');
  for(const group of [d.channels,d.departments,d.months,d.matrix])assert(group.reduce((n,r)=>n.plus(r.amount),new Decimal(0)).equals('270'));
  assert.equal((await queries.ranking({year:2025,customerCode:'CORRECT'},actor)).rows[0].orderTotal,'270.00');
  const legs=await db.query("SELECT sum(order_total)::text amount FROM finance_e10_movement_source WHERE tenant_id=$1 AND customer_code='CORRECT'",[actor.tenantId]);assert(new Decimal(legs[0].amount).equals(270));
  const events=await db.query("SELECT included,change_amount,raw_change FROM finance_e10_changes WHERE tenant_id=$1 ORDER BY order_no",[actor.tenantId]);
  assert.equal(events.filter(r=>r.included).length,1);assert.equal(events.filter(r=>r.included)[0].change_amount,'-20');
  assert(events.filter(r=>!r.included).every(r=>r.change_amount===null));
 });
 await check('approval and material type changes refresh balances and effective events without rewriting source postings',async()=>{
  batch=batch.map(r=>r.sourceOrderId===id(9003)?{...r,approved:'Y'}:r);assert.equal((await run({mode:'INCREMENTAL'})).status,'SUCCESS');
  assert.equal((await correctRows()).total,4);assert.equal((await queries.dashboard({context:{year:2025,customerCode:'CORRECT'}},actor)).totals.amount,'300.00');
  assert.equal((await db.query("SELECT included FROM finance_e10_changes WHERE event_key='SYN-EVENT-9003'"))[0].included,true);
  batch=batch.map(r=>r.sourceOrderId===id(9003)?{...r,approved:null}:r);await run({mode:'INCREMENTAL'});assert.equal((await correctRows()).total,3);
  batch=batch.map(r=>r.sourceOrderId===id(9002)?{...r,docType:'销售订单'}:r);await run({mode:'INCREMENTAL'});assert.equal((await correctRows()).total,4);
  batch=batch.map(r=>r.sourceOrderId===id(9002)?{...r,docType:'材料销售单'}:r);await run({mode:'INCREMENTAL'});assert.equal((await correctRows()).total,3);
  assert.deepEqual(await db.query('SELECT * FROM finance_e10_change_events ORDER BY id'),retainedEvents);
 });
 await check('default date order remains stable across server pages and full Excel with explicit sort override',async()=>{
  batch.push(...Array.from({length:110},(_,n)=>sample(10000+n,11000+n,'1',{orderDate:n%2?'2025-02-02':'2025-01-01',yearMonth:n%2?'2025-02':'2025-01',businessRemark:'排序备注-'+n})));
  await run({mode:'INCREMENTAL'});
  for(const resource of ['finance-e10-lines','finance-e10-monthly']){
   const pages=[];for(let page=1;page<=3;page++)pages.push(...(await list(resource,{filterGroup:JSON.stringify(correctFilter),page:String(page),pageSize:'50'})).rows);
   assert.equal(pages.length,new Set(pages.map(r=>r.id)).size);
   const expected=await db.query(`SELECT id FROM ${resource==='finance-e10-lines'?'finance_e10_raw':'finance_e10_monthly'} WHERE tenant_id=$1 AND customer_code='CORRECT' ORDER BY order_date,source_database,source_order_id,${resource==='finance-e10-lines'?'source_line_id,':''}id`,[actor.tenantId]);
   assert.deepEqual(pages.map(r=>r.id),expected.map(r=>r.id));
   const descending=(await list(resource,{filterGroup:JSON.stringify(correctFilter),sortField:'orderDate',sortOrder:'desc'})).rows;
   assert.equal(descending[0].orderDate,'2025-02-02');
   const book=new ExcelJS.Workbook();await book.xlsx.load(await exporter.exportXlsx(resource,{filterGroup:correctFilter},actor));const sheet=book.worksheets[0],dateColumn=sheet.getRow(1).values.indexOf('订单日期');
   assert.deepEqual(sheet.getColumn(dateColumn).values.slice(2),pages.map(r=>r.orderDate));
  }
 });
 await check('remark field authorization and tenant isolation remain enforced after migration',async()=>{
  const resource='finance-e10-monthly',viewer={...actor,permissions:[`${resource}:*:read`,`${resource}:*:export`,`${resource}:customerCode:read`],tableDataScopes:[{resource,scope:'ALL'}]};
  assert.equal((await list(resource,{},viewer)).rows[0].businessRemark,undefined);
  await assert.rejects(list(resource,{sortField:'businessRemark'},viewer));
  const book=new ExcelJS.Workbook();await book.xlsx.load(await exporter.exportXlsx(resource,{},viewer));assert(!book.worksheets[0].getRow(1).values.includes('备注-业务'));
  await db.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO finance_analytics_reader');
  const q=db.createQueryRunner();await q.startTransaction();try{await q.query('SET LOCAL ROLE finance_analytics_reader');await q.query("SELECT set_config('app.tenant_id','OTHER',true)");assert.equal((await q.query("SELECT count(*)::int n FROM finance_e10_monthly WHERE customer_code='CORRECT'"))[0].n,0);}finally{await q.rollbackTransaction();await q.release();}
 });
 fs.writeFileSync(path.join(root,'outputs/FINANCE_ORDER_POSTGRES_VALIDATION.json'),JSON.stringify({status:'PASS',scenarios:checks.length,checks,productionModified:false},null,2));console.log('Finance analytics PostgreSQL PASS: '+checks.length+' scenarios');
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(db?.isInitialized)await db.destroy();if(control._connected){await control.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await control.query('DROP ROLE IF EXISTS finance_analytics_reader');await control.end();}});
