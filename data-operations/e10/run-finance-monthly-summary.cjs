#!/usr/bin/env node
/** Host-authorized daily command; no ERP reads, credentials or financial payloads in output. */
const path=require('node:path');
process.env.DOTENV_CONFIG_QUIET='true';
const root=process.env.FINANCE_API_ROOT||path.resolve(__dirname,'../../apps/api'),load=n=>require(path.join(root,'dist',n));
const ds=load('data-source').default;
const {FinanceRepository}=load('modules/finance/finance.repository');
const {FinanceMonthlyNotificationService}=load('modules/finance/finance-monthly-notification.service');
const {NotificationService}=load('modules/notifications/notification.service');
(async()=>{
 const mode=process.argv[2]||'--dispatch';
 if(!['--dispatch','--initialize'].includes(mode))throw Error('Usage: run-finance-monthly-summary.cjs --initialize|--dispatch');
 await ds.initialize();const tenant=process.env.KDOS_DEFAULT_TENANT_CODE||'KAINAN',repo=new FinanceRepository(ds);
 const [principal]=await repo.query(`SELECT u.id,g.system_admin,g.module_codes FROM administrator_grants g
  JOIN users u ON u.id=g.user_id AND u.tenant_id=g.tenant_id WHERE g.tenant_id=$1 AND u.enabled
  AND (g.system_admin OR g.module_codes ? 'finance') ORDER BY g.system_admin DESC,u.id LIMIT 1`,[tenant]);
 if(!principal)throw Error('No enabled authorized finance administrator; daily summary denied');
 const actor={tenantId:tenant,userId:principal.id,username:'财务月度汇总任务',requestId:`finance-monthly-summary-${Date.now()}`,permissions:[],isSystemAdmin:principal.system_admin,moduleAdminCodes:principal.module_codes,source:'api'};
 const app=new FinanceMonthlyNotificationService(repo,new NotificationService(ds));
 const result=await (mode==='--initialize'?app.initialize(actor):app.dispatch(actor));
 console.log(JSON.stringify(result));
})().catch(()=>{console.error('Finance monthly summary failed; inspect the scheduled task and message center');process.exitCode=1;}).finally(async()=>{if(ds.isInitialized)await ds.destroy();});
