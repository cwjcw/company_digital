#!/usr/bin/env node
/** Real PostgreSQL18 fixtures only, requires this task's isolated networkless socket. */
const assert=require('node:assert/strict'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(root+'/apps/api/package.json'),{DataSource}=req('typeorm'),Excel=req('exceljs');
const {standardProcesses}=req('@tracker/shared'),{tablePermissionFieldsFor}=req('@kdos/contracts');
const {MasterPlanApplicationService}=req('./dist/modules/master-plan-system/master-plan.application.service');
const {MasterPlanDashboardService}=req('./dist/modules/master-plan-system/master-plan.dashboard.service');
const {MasterPlanDashboardExportService}=req('./dist/modules/master-plan-system/master-plan.dashboard-export.service');
const host=process.env.MPS_TEST_POSTGRES_HOST;if(!host?.startsWith('/tmp/kdos-mps-dashboard-pg/'))throw Error('Only isolated dashboard socket is allowed');
const id=n=>'0199d000-0000-7000-8000-'+String(n).padStart(12,'0');
const admin={tenantId:'KAINAN',userId:id(1),username:'synthetic test',permissions:['*'],tableDataScopes:[],requestId:'dashboard-test',source:'web'};
const resource='mps-overview-dashboard',fields=tablePermissionFieldsFor(resource).map(f=>`${resource}:${f.key}:read`);
const actor=(scope='ALL',div)=>({...admin,permissions:[`${resource}:*:read`,`${resource}:*:export`,...fields],tableDataScopes:[{resource,scope,actions:['read','export'],...(div?{rules:[{fieldKey:'divisionId',operator:'EQ',value:div}]}:{})}]});
const checks=[];const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
let control,db;const name='mps_dashboard_test_'+Date.now();
(async()=>{control=new DataSource({type:'postgres',host,username:'knplan',database:'postgres'});await control.initialize();await control.query(`CREATE DATABASE ${name}`);db=new DataSource({type:'postgres',host,username:'knplan',database:name,migrations:[root+'/apps/api/dist/migrations/*.js']});await db.initialize();await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');await db.runMigrations();
 const insert=async(table,values)=>{const keys=Object.keys(values);return (await db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(values)))[0]};
 await insert('users',{id:id(1),username:'fixture-mps-dashboard',display_name:'合成测试',password_hash:'unused',enabled:true,tenant_id:'KAINAN'});
 for(const n of [10,11])await insert('organization_units',{id:id(n),name:'Synthetic division '+n,level:1,enabled:true});
 const common=(tenant='KAINAN')=>({tenant_id:tenant,created_by:id(1),updated_by:id(1)});
 const make=async(n,tenant,div,required,completed)=>{
  const order='SYN-'+n,item='ITEM-'+n;await insert('mps_group_plans',{...common(tenant),order_number:order,primary_division_id:div,customer_code:'CUS-'+n,required_quantity:required,completed_quantity:completed,pending_quantity:required-completed});
  const allocation=await insert('mps_order_allocations',{...common(tenant),order_number:order,item_code:item,division_id:div,allocated_quantity:required});
  await insert('mps_monthly_plans',{...common(tenant),allocation_id:allocation.id,id:id(n+100),order_number:order,item_code:item,item_name:'合成品名'+n,division_id:div,customer_code:'CUS-'+n,required_quantity:required,cumulative_inbound_quantity:completed,pending_quantity:required-completed,latest_customer_due_date:'2020-01-01'});
  return {order,item,tenant,div};
 };
 const a=await make(20,'KAINAN',id(10),500,100),b=await make(21,'KAINAN',id(11),100,90);await make(22,'TENANT-B',id(10),10000,9999);
 const delivery=async(o,n,planned,weekly=true)=>{
  const c={...common(o.tenant),order_number:o.order,item_code:o.item,item_name:'合成品名',division_id:o.div,customer_code:'CUS-'+o.order.slice(4),delivery_number:String(n),latest_customer_due_date:'2020-01-01',planned_quantity:planned};
  const shipping=await insert('mps_shipping_plans',c);const base=await insert('mps_base_plans',{...c,shipping_plan_id:shipping.id,latest_review_due_date:weekly?'2020-01-01':null,product_attribute:weekly?'常规':null,surface_nature:weekly?'常规':null,manufacturing_method:weekly?'自制':null});
  if(!weekly)return base;
  const w=await insert('mps_weekly_plans',{...c,base_plan_id:base.id,latest_review_due_date:'2020-01-01',pending_quantity:planned});
  for(const p of standardProcesses)await insert('mps_weekly_process_plans',{...common(o.tenant),weekly_plan_id:w.id,process_code:p.code,process_name:p.name,sequence:p.order,status:'已完成',exception_text:'未维护周期（计划提示）'});
  return w;
 };
 const wa=await delivery(a,1,100),wb=await delivery(a,2,200);await delivery(b,1,50);const incomplete=await delivery(a,3,20,false);
 await insert('mps_reconciliation_outbox',{...common(),resource:'mps-base-plans',sync_key:'base-to-weekly',record_id:incomplete.id,idempotency_key:'synthetic-dashboard-issue',actor_id:id(1),actor_name:'合成测试',last_error:'未维护工序周期'});
 const yesterday=(await db.query("SELECT ((now() AT TIME ZONE 'Asia/Shanghai')::date-1)::text d"))[0].d;
 const report=async(w,quantity,offset=1,exception=null)=>{
  const p=standardProcesses[0];await db.query(`INSERT INTO mps_process_reports(tenant_id,created_by,updated_by,weekly_plan_id,division_id,order_number,item_code,delivery_number,process_code,process_name,production_date,planned_quantity,production_quantity,exception_text) VALUES('KAINAN',$1,$1,$2,$3,$4,$5,$6,$7,$8,(now() AT TIME ZONE 'Asia/Shanghai')::date-$9::int,$10,$11,$12)`,[id(1),w.id,w.division_id,w.order_number,w.item_code,w.delivery_number,p.code,p.name,offset,w.planned_quantity,quantity,exception]);
 };
 await report(wa,50,1,'人工异常');await report(wa,55,1,'人工异常');await report(wb,150,7);
 await insert('mps_data_exceptions',{...common(),exception_key:'synthetic-data-warning',resource:'mps-monthly-plans',record_id:id(120),business_key:'SYN-20',exception_type:'CONFIG',message:'同步失败和数据异常不计生产异常'});
 const s=new MasterPlanDashboardService(db);const scoped=actor('CUSTOM',id(10));
 await check('weighted order/dispatch/inbound rates; 255/500=51%, report SUM, independent completed status',async()=>{const d=await s.dashboard({},scoped);assert.equal(Number(d.orders.orderCompletionRate),.2);assert.equal(Number(d.plans.dispatchRate),.6);assert.equal(Number(d.plans.inboundRate),.2);assert.equal(Number(d.processes[0].values.productionProgress),.51);assert.equal(Number(d.processes[0].values.reportedQuantity),255);assert(d.processes[0].states.some(r=>r.status==='已完成'));assert.equal(d.orders.orderCount,1);assert(d.divisions.every(r=>r.divisionId===id(10)));});
 await check('same scope for readiness, risk, customers, trend and manual exceptions only',async()=>{const d=await s.dashboard({},scoped);assert.equal(d.plans.exceptionCount,1);assert(d.risks.rows.some(r=>r.weeklyPlanGenerationIssue==='未维护工序周期'));assert(d.risks.rows.filter(r=>r.riskType==='生产异常').every(r=>r.exceptionSummary.includes('人工异常')&&!r.exceptionSummary.includes('未维护')));assert.equal(d.trend.length,7);assert.equal(d.trend.at(-1).productionDate,yesterday);assert.equal(Number(d.trend.at(-1)[standardProcesses[0].code+'ReportedQuantity']),105);assert.equal(Number(d.trend[0][standardProcesses[0].code+'ReportedQuantity']),150);assert((await s.candidates('customerCode','',{},scoped)).options.every(r=>r.value==='CUS-20'));assert((await s.candidates('divisionId','',{},scoped)).options.every(r=>r.value===id(10)));});
 await check('all standard process names, order and count derive from shared registry',async()=>{const d=await s.dashboard({},scoped);assert.deepEqual(d.processes.map(p=>({code:p.code,name:p.name,order:p.order})),[...standardProcesses].sort((a,b)=>a.order-b.order).map(p=>({code:p.code,name:p.name,order:p.order})));});
 await check('customer/order/item filters reach all aggregates without missing report customer columns',async()=>{for(const input of [{customerCode:'CUS-20'},{orderNumber:'SYN-20'},{item:'ITEM-20'},{item:'合成品名20'},{divisionId:id(10)}]){const d=await s.dashboard(input,actor());assert.equal(d.orders.orderCount,1);assert.equal(Number(d.processes[0].values.productionProgress),.51);}});
 await check('60% and 105% are retained, status does not force progress to100%',async()=>{await report(wb,45);let d=await s.dashboard({},scoped);assert.equal(Number(d.processes[0].values.productionProgress),.6);assert(d.processes[0].states.some(r=>r.status==='已完成'));await report(wb,225);d=await s.dashboard({},scoped);assert.equal(Number(d.processes[0].values.productionProgress),1.05);});
 await check('today excluded; Shanghai previous 7 complete dates; old excluded',async()=>{await report(wa,1,0);await report(wa,2,8);const d=await s.dashboard({},scoped);assert.equal(d.trend.reduce((n,r)=>n+Number(r[standardProcesses[0].code+'ReportedQuantity']||0),0),525);});
 await check('ALL versus CUSTOM/OWN/no scope; cross tenant never included',async()=>{assert.equal((await s.dashboard({},actor())).orders.orderCount,2);assert.equal((await s.dashboard({},actor('OWN'))).orders.orderCount,2);const none={...actor(),tableDataScopes:[]};assert.equal((await s.dashboard({},none)).orders.orderCount,0);const other={...admin,tenantId:'TENANT-B'};assert.equal((await s.dashboard({},other)).orders.orderCount,1);assert.equal((await s.dashboard({divisionId:id(11)},scoped)).orders.orderCount,0);});
 await check('independent dashboard authorization, field privacy, invalid scope fails closed',async()=>{await assert.rejects(s.dashboard({},{...admin,permissions:['mps-monthly-plans:*:read']}),e=>e.getStatus()===403);const limited={...scoped,permissions:scoped.permissions.filter(p=>!p.includes(':orderRequiredQuantity:')&&!p.includes(':exceptionSummary:')&&!p.includes(':divisionId:')&&!p.includes('ReportedQuantity:'))};const d=await s.dashboard({},limited);assert(!('orderCompletionRate'in d.orders));assert(!('exceptionCount'in d.plans));assert.equal(d.divisions.length,0);assert(d.processes.every(p=>!('reportedQuantity'in p.values)&&!('productionProgress'in p.values)));assert(d.trend.every(r=>Object.keys(r).length===1));assert(!d.risks.rows.some(r=>r.riskType==='生产异常'));await assert.rejects(s.candidates('divisionId','',{},limited),e=>e.getStatus()===403);await assert.rejects(s.dashboard({},{...scoped,tableDataScopes:[{resource,scope:'CUSTOM',rules:[{fieldKey:'orderCount',operator:'EQ',value:'2'}]}]}),e=>e.getStatus()===403);});
 await check('read intersection export; full risk Excel and audit, field projection',async()=>{const exportActor={...actor(),tableDataScopes:[{resource,scope:'CUSTOM',actions:['read'],rules:[{fieldKey:'divisionId',operator:'EQ',value:id(10)}]},{resource,scope:'ALL',actions:['export']}]};const exporter=new MasterPlanDashboardExportService(s,new MasterPlanApplicationService(db,{}));const buffer=await exporter.export({},exportActor);const w=new Excel.Workbook();await w.xlsx.load(buffer);assert.equal(w.worksheets.length,2);assert.equal(w.getWorksheet('事业部汇总').rowCount,2);assert(w.getWorksheet('风险明细').rowCount>1);assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE resource=$1",[resource]))[0].n,1);await assert.rejects(exporter.export({},{...scoped,permissions:scoped.permissions.filter(p=>!p.endsWith(':export'))}),e=>e.getStatus()===403);});
 await check('aggregate derived states/due date/exception text equal formal monthly expressions',async()=>{
  const {columnsFor,MASTER_PLAN_RESOURCE_MAP}=req('./dist/modules/master-plan-system/master-plan.config');
  const keys=['latestCustomerDueDate','exceptionSummary','technicalStatus','hardwareStatus','woodStatus','outsourcingStatus',...standardProcesses.map(p=>p.code+'Status')];
  const columns=columnsFor(MASTER_PLAN_RESOURCE_MAP.get('mps-monthly-plans'));
  const [formal]=await db.query(`SELECT ${keys.map(k=>columns[k]+' "'+k+'"').join(',')} FROM mps_monthly_plans record WHERE record.id=$1`,[id(120)]);
  const d=await s.dashboard({},scoped);assert.equal(d.risks.rows.find(r=>r.riskType==='生产异常').exceptionSummary,formal.exceptionSummary);
  for(const p of standardProcesses)assert(d.processes.find(r=>r.code===p.code).states.some(r=>r.status===formal[p.code+'Status']));
  for(const key of ['technical','hardware','wood','outsourcing'])assert(d.auxiliary.find(r=>r.key===key).states.some(r=>r.status===formal[key+'Status']));
 });
 await check('risk paging and export include all rows, remote customers capped at30 with hasMore',async()=>{
  for(let i=40;i<72;i++)await make(i,'KAINAN',id(10),1,0);
  const d=await s.dashboard({},scoped);assert.equal(d.risks.rows.length,20);assert(d.risks.total>20);
  const page2=await s.dashboard({page:2},scoped);assert(page2.risks.rows.length>0);assert(!d.risks.rows.some(r=>page2.risks.rows.some(p=>p.id===r.id&&p.riskType===r.riskType)));
  const full=await s.dashboard({},scoped,'export',true);assert.equal(full.risks.rows.length,full.risks.total);
  const c=await s.candidates('customerCode','',{},scoped);assert.equal(c.options.length,30);assert.equal(c.hasMore,true);
 });
 await check('zero denominator returns null, unassigned/empty/error validation',async()=>{const d=await s.dashboard({customerCode:'NO-MATCH'},admin);assert.equal(d.orders.orderCompletionRate,null);assert.equal(d.plans.dispatchRate,null);assert(d.processes.every(p=>p.values.productionProgress===null));await assert.rejects(s.dashboard({divisionId:'not-uuid'},admin),e=>e.getStatus()===400);await assert.rejects(s.dashboard({riskType:'临期'},admin),e=>e.getStatus()===400);});
 console.log('TOTAL '+checks.length+' PostgreSQL dashboard checks PASS');
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{if(db?.isInitialized)await db.destroy();if(control?.isInitialized){await control.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await control.destroy();}});
