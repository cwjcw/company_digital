import 'reflect-metadata';
import db from './data-source';
import {PlmSyncService} from './modules/rd/plm-sync.service';
import {PlmClient,PlmFetchError} from './integrations/plm/plm.client';
async function main(){const tenant=process.env.PLM_TENANT_ID;if(!tenant||tenant!==(process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN'))throw new PlmFetchError('PLM_TENANT_REQUIRED');await db.initialize();try{console.log(JSON.stringify(await new PlmSyncService(db,new PlmClient()).sync(tenant)));}finally{await db.destroy();}}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({status:'FAILED',errorCode:e instanceof PlmFetchError?e.code:'PLM_COMMAND_FAILED'}));process.exitCode=1;});
