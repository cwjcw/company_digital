#!/usr/bin/env node
/** Trusted administrative runner. ERP credentials remain in basic_code; all writes use Application Commands. */
const path=require('node:path');
const root=process.env.FINANCE_API_ROOT||path.resolve(__dirname,'../../apps/api');const load=n=>require(path.join(root,'dist',n));
const ds=load('data-source').default;
const {FinanceRepository}=load('modules/finance/finance.repository'),{FinanceOrderReader}=load('integrations/e10/finance-order.reader'),{FinanceMovementReader}=load('integrations/e10/finance-movement.reader');
const {FinanceOrdersApplicationService}=load('modules/finance/finance-orders.application.service'),{FinanceMovementsApplicationService}=load('modules/finance/finance-movements.application.service');
(async()=>{
 const mode=process.argv[2]||'INCREMENTAL';if(!['FULL','INCREMENTAL'].includes(mode))throw Error('Usage: run-finance-movements-sync.cjs FULL|INCREMENTAL');
 await ds.initialize();const tenant=process.env.KDOS_DEFAULT_TENANT_CODE||'KAINAN';const repo=new FinanceRepository(ds);
 const [principal]=await repo.transaction(tenant,m=>m.query(`SELECT u.id,u.display_name,g.system_admin,g.module_codes FROM administrator_grants g JOIN users u ON u.id=g.user_id AND u.tenant_id=g.tenant_id
 WHERE g.tenant_id=$1 AND u.enabled AND (g.system_admin OR g.module_codes ? 'finance') ORDER BY g.system_admin,u.id LIMIT 1`,[tenant]));
 if(!principal)throw Error('No enabled authorized finance administrator; scheduled run denied');
 const actor={tenantId:tenant,userId:principal.id,username:'财务台账自动同步',requestId:`finance-movement-cli-${Date.now()}`,permissions:[],isSystemAdmin:principal.system_admin,moduleAdminCodes:principal.module_codes,source:'api'};
 const balance=new FinanceOrdersApplicationService(repo,new FinanceOrderReader());const app=new FinanceMovementsApplicationService(repo,new FinanceMovementReader(),balance);
 const run=await app.refresh(actor,{mode});
 for(let i=0;i<3000;i++){
  const [r]=await repo.query('SELECT status,changed_count FROM finance_e10_movement_runs WHERE tenant_id=$1 AND id=$2',[tenant,run.id]);
  if(r?.status!=='RUNNING'){if(r?.status!=='SUCCESS')throw Error('Finance movement synchronization failed; inspect authorized run history');console.log(JSON.stringify({id:run.id,status:r.status,changedCount:r.changed_count}));return;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error('Finance movement synchronization timed out');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(ds.isInitialized)await ds.destroy();});
