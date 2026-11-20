import 'reflect-metadata';
import db from './data-source';
import { TplusBomSyncService, TPLUS_BOM_DATABASES, type TplusBomSource } from './modules/rd/tplus-bom-sync.service';

async function main() {
  const tenant=process.env.RD_BOM_INDEX_TENANT_ID;
  if (!tenant || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(tenant)) throw Error('TPLUS_BOM_TENANT_REQUIRED');
  const mode=process.argv[2]??'RECONCILE';
  if (!['RECONCILE','ACTIVATE'].includes(mode)) throw Error('TPLUS_BOM_MODE_INVALID');
  await db.initialize();
  try {
    const service=new TplusBomSyncService(db);
    if (mode==='ACTIVATE') { console.log(JSON.stringify(await service.activate(tenant))); return; }
    const results=[];
    for (const source of Object.keys(TPLUS_BOM_DATABASES) as TplusBomSource[]) {
      try {results.push(await service.reconcile(tenant,source));}
      catch {results.push({source,status:'FAILED'});}
    }
    const success=results.every(r=>r.status==='SUCCESS');
    console.log(JSON.stringify({mode,status:success?'SUCCESS':'FAILED',sources:results}));
    if (!success) process.exitCode=1;
  } finally {await db.destroy();}
}
if (require.main===module) main().catch(()=>{console.error('TPLUS_BOM_COMMAND_FAILED');process.exitCode=1;});
