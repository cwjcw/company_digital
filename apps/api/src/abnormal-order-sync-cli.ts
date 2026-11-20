import 'reflect-metadata';
import db from './data-source';
import { AbnormalOrderSyncService } from './modules/abnormal-cost/abnormal-order-sync.service';
import { AbnormalOrderReader } from './integrations/abnormal-orders/abnormal-order.reader';
import { NotificationService } from './modules/notifications/notification.service';
async function main(){
 const tenant=process.env.ABNORMAL_ORDER_TENANT_ID;
 if(!tenant||tenant!==(process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN'))throw Error('ABNORMAL_ORDER_TENANT_REQUIRED');
 const mode=process.argv[2]??'RECONCILE';if(!['RECONCILE','REPORT_FAILURE'].includes(mode))throw Error('ABNORMAL_ORDER_MODE_INVALID');
 await db.initialize();try{const service=new AbnormalOrderSyncService(db,new AbnormalOrderReader(),new NotificationService(db));console.log(JSON.stringify(mode==='REPORT_FAILURE'?await service.reportInterrupted(tenant):await service.sync(tenant)));}finally{await db.destroy();}
}
if(require.main===module)main().catch(()=>{console.error('ABNORMAL_ORDER_COMMAND_FAILED');process.exitCode=1;});
