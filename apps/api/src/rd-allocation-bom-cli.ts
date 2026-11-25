import 'reflect-metadata';
import db from './data-source';
import { RdAllocationBomService } from './modules/rd/rd-allocation-bom.service';
import { UnifiedBomQueryService } from './modules/rd/unified-bom.query.service';
async function main() {
  const tenant=process.env.RD_BOM_INDEX_TENANT_ID;
  if (!tenant || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(tenant)) throw Error('TENANT_REQUIRED');
  const mode=process.argv[2];if (!['ACTIVATE','PROCESS'].includes(mode)) throw Error('MODE_INVALID');
  await db.initialize();
  try {
    const service=new RdAllocationBomService(db,new UnifiedBomQueryService(db));
    const boundary=mode==='ACTIVATE'?await service.activate(tenant):null;
    const result=await service.drain(tenant);
    console.log(JSON.stringify({status:result.deferred?'DEFERRED':'SUCCESS',mode,boundary,...result}));
    if(result.deferred)process.exitCode=1;
  } finally {await db.destroy();}
}
if(require.main===module)main().catch(()=>{console.error('RD_ALLOCATION_BOM_FAILED');process.exitCode=1;});
