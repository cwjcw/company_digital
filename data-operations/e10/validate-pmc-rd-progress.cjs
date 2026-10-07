/* Real PostgreSQL acceptance, limited to an isolated phase-4 validation database. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const apiRoot = process.env.PMC_RD_API_ROOT || path.resolve(__dirname,'../../apps/api');
const load = name => require(path.join(apiRoot,'dist',name));
const dataSource = load('data-source').default;
const {PmcRdProgress1722920082000} = load('migrations/1722920082000-PmcRdProgress');
const {PmcRdProgressCalculator} = load('modules/pmc-rd-progress/pmc-rd-progress.calculator');
const {PmcRdProgressApplicationService} = load('modules/pmc-rd-progress/pmc-rd-progress.application.service');
const {PmcRdProgressQueryService} = load('modules/pmc-rd-progress/pmc-rd-progress.query.service');
const actor = tenantId => ({tenantId,userId:'0199e000-0000-7000-8000-000000000001',username:'phase4-validation',isSystemAdmin:true,permissions:['*'],tableDataScopes:[],requestId:'phase4-validation',source:'system'});
(async()=>{
  assert.match(process.env.DATABASE_NAME || '',/^pmc_rd_phase4_test_/,'Only isolated scratch databases are allowed');
  await dataSource.initialize();
  const runner=dataSource.createQueryRunner();await runner.connect();await runner.startTransaction();
  try {await runner.query("DROP TABLE IF EXISTS pmc_rd_progress_sync_runs,pmc_rd_progress_items");await new PmcRdProgress1722920082000().up(runner);await runner.commitTransaction();}catch(error){await runner.rollbackTransaction();throw error;}finally{await runner.release();}
  const facts=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));let current=facts;
  const reader={read:async()=>current};
  const calc=new PmcRdProgressCalculator();const app=new PmcRdProgressApplicationService(dataSource,reader,calc);const query=new PmcRdProgressQueryService(dataSource);
  const A=actor('PMC_RD_TEST_A'),B=actor('PMC_RD_TEST_B');
  const start=performance.now();const full=await app.sync('FULL',A);assert.equal(full.rowsCreated,facts.orders.length);
  const replay=await app.sync('FULL',A);assert.equal(replay.rowsCreated,0);assert.equal(replay.rowsUpdated,0);assert.equal(replay.rowsUnchanged,facts.orders.length);
  const summary=await query.summary({},A);assert.equal(summary.itemCount,facts.orders.length);
  const calculated=calc.calculate(facts);for(const sample of [['2304-202610060005','601000110','NOT_APPLICABLE'],['2301-2026C1101-B061','ABL370CC0C375-1/1','NOT_STARTED'],['2307-260930008','RXA500J-V5-1/1','WAITING_ROUTING'],['2307-260930008','RXA505F-HLLV5-1/1','COMPLETE']])assert.equal(calculated.find(r=>r.orderNo===sample[0]&&r.itemCode===sample[1]).rdStatus,sample[2]);
  const incomplete=await query.list({onlyIncomplete:'true',pageSize:1000},A);assert(incomplete.rows.every(r=>!['COMPLETE','NOT_APPLICABLE'].includes(r.rdStatus)));assert.equal(incomplete.total,summary.incompleteItemCount);
  assert.equal((await query.list({rdStatus:'待工艺'},A)).total,summary.statusCounts.WAITING_ROUTING);
  assert.equal((await query.list({orderNo:'2307-260930008'},A)).total,facts.orders.filter(r=>r.order_no.includes('2307-260930008')).length);
  assert.equal((await query.orders({orderNo:'2307-260930008'},A)).rows[0].orderRdStatus,'IN_PROGRESS');
  assert.equal((await query.list({},B)).total,0);
  const oneOrder=facts.orders.find(row=>row.order_no==='2307-260930008'&&row.item_code==='RXA505F-HLLV5-1/1');const line=oneOrder.order_line_id.toLowerCase();
  current={...facts,orders:[oneOrder]};await app.sync('FULL',B);assert.equal((await query.list({},B)).total,1);assert.equal((await query.list({},A)).total,facts.orders.length);
  // Same order/item on a second distinct source line must remain a separate row.
  const duplicate={...oneOrder,order_line_id:'0199e000-1234-7000-8000-000000000001'};
  current={...facts,orders:[oneOrder,duplicate],candidateLineIds:[line,duplicate.order_line_id]};const duplicateRun=await app.sync('FULL',B);assert.equal(duplicateRun.rowsCreated,1);assert.equal((await query.list({},B)).total,2);
  current={...facts,orders:[oneOrder],candidateLineIds:facts.candidateLineIds,plants:facts.plants.map(p=>({...p,standard_routing_id:null})),routings:[]};const backwardRouting=await app.sync('INCREMENTAL',A);assert.equal(backwardRouting.rowsUpdated,1);assert.equal((await query.list({orderNo:'2307-260930008',itemCode:'RXA505F-HLLV5-1/1'},A)).rows[0].rdStatus,'WAITING_ROUTING');
  current={...facts,orders:[oneOrder],boms:facts.boms.map(b=>({...b,approve_status:'N'}))};await app.sync('INCREMENTAL',A);assert.equal((await query.list({orderNo:'2307-260930008',itemCode:'RXA505F-HLLV5-1/1'},A)).rows[0].rdStatus,'DESIGN_IN_PROGRESS');
  current={...facts,orders:[oneOrder]};await app.sync('INCREMENTAL',A);
  // Verify real rollback of an earlier chunk when a later chunk fails.
  const beforeCount=(await query.list({},A)).total;let calls=0;const original=app.upsert.bind(app);
  app.upsert=async(...args)=>{if(++calls===2)throw new Error('forced-write-failure');return original(...args);};
  current={...facts,orders:facts.orders.map(row=>({...row,item_name:row.item_name+' changed'}))};await assert.rejects(app.sync('INCREMENTAL',A),/forced-write-failure/);app.upsert=original;
  assert.equal((await query.list({},A)).total,beforeCount);assert.equal((await query.list({orderNo:'2307-260930008',itemCode:'RXA505F-HLLV5-1/1'},A)).rows[0].itemName,oneOrder.item_name);
  const [failed]=await dataSource.query(`SELECT status,watermark_after FROM pmc_rd_progress_sync_runs WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 1`,[A.tenantId]);assert.equal(failed.status,'FAILED');assert.equal(failed.watermark_after,null);
  current={...facts,orders:[],candidateLineIds:facts.candidateLineIds};const empty=await app.sync('INCREMENTAL',A);assert.equal(empty.rowsCreated,0);assert.equal(empty.rowsUpdated,0);assert.equal((await query.list({},A)).total,beforeCount);
  // Soft deletion, retention, and reactivation.
  current={...facts,orders:[oneOrder],candidateLineIds:[line]};const soft=await app.sync('FULL',B);assert.equal(soft.rowsDeactivated,1);const [retained]=await dataSource.query('SELECT count(*)::int count FROM pmc_rd_progress_items WHERE tenant_id=$1',[B.tenantId]);assert.equal(retained.count,2);
  current={...facts,orders:[oneOrder,duplicate],candidateLineIds:[line,duplicate.order_line_id]};assert.equal((await app.sync('FULL',B)).rowsUpdated,1);
  const restricted={...A,isSystemAdmin:false,permissions:['pmc-rd-progress:*:read','pmc-rd-progress:orderNo:read'],tableDataScopes:[{resource:'pmc-rd-progress',scope:'CUSTOM',rules:[{fieldKey:'orderNo',operator:'EQ',value:'2307-260930008'}]}]};
  const restrictedRows=await query.list({},restricted);assert.equal(restrictedRows.total,facts.orders.filter(r=>r.order_no==='2307-260930008').length);assert(!('itemName' in restrictedRows.rows[0]));assert.equal((await query.summary({},restricted)).itemCount,facts.orders.filter(r=>r.order_no==='2307-260930008').length);await assert.rejects(query.list({customer:'客户'},restricted));await assert.rejects(app.sync('FULL',restricted));
  // RLS under a real non-owner PostgreSQL role, rolled back at the end.
  const security=dataSource.createQueryRunner();await security.connect();await security.startTransaction();
  try {
    await security.query('CREATE ROLE pmc_rd_phase4_rls_probe NOLOGIN');await security.query('GRANT USAGE ON SCHEMA public TO pmc_rd_phase4_rls_probe');await security.query('GRANT SELECT ON pmc_rd_progress_items TO pmc_rd_phase4_rls_probe');await security.query(`SELECT set_config('app.tenant_id',$1,true)`,[A.tenantId]);await security.query('SET LOCAL ROLE pmc_rd_phase4_rls_probe');
    const [count]=await security.query('SELECT count(*)::int count FROM pmc_rd_progress_items');assert.equal(count.count,facts.orders.length);const [cross]=await security.query('SELECT count(*)::int count FROM pmc_rd_progress_items WHERE tenant_id=$1',[B.tenantId]);assert.equal(cross.count,0);
  }finally{await security.rollbackTransaction();await security.release();}
  const report={status:'PASS',full,replay,summary,checks:['migration','same source line uniqueness','full','unchanged replay','incremental','routing rollback','design rollback','atomic chunk rollback','failed watermark','soft deletion/reactivation','query pagination/status/order/onlyIncomplete','summary','order summary','field permission','data scope','permission','two tenants','real non-owner RLS'],elapsedSeconds:Number(((performance.now()-start)/1000).toFixed(3))};
  if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{if(dataSource.isInitialized)await dataSource.destroy();});
