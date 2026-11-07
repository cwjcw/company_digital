import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import dataSource from './data-source';
import { MasterPlanSyncService, MASTER_PLAN_SYSTEM_USER_ID } from './modules/master-plan-system/master-plan.sync.service';

type Manifest={tenantId:string;requestId:string;monthlyPlans:Array<{id:string;expectedVersion:number}>};
const uuidFrom=(value:string)=>{const bytes=createHash('sha256').update(value).digest().subarray(0,16);bytes[6]=(bytes[6]&0x0f)|0x50;bytes[8]=(bytes[8]&0x3f)|0x80;const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;};

/** Explicit operator tool. It is inert unless both a reviewed external manifest and two execute gates are present. */
async function run(){
  if(process.argv.length!==3||process.argv[2]!=='--execute'||process.env.KDOS_MPS_TARGETED_RESTORE_ENABLED!=='true')throw Error('Refusing to execute without --execute and KDOS_MPS_TARGETED_RESTORE_ENABLED=true');
  const manifestPath=process.env.KDOS_MPS_RESTORE_MANIFEST;
  if(!manifestPath||!fs.existsSync(manifestPath))throw Error('A reviewed external restore manifest is required');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')) as Manifest;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!manifest||manifest.tenantId!==(process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN')||!uuid.test(manifest.requestId)||!Array.isArray(manifest.monthlyPlans)||manifest.monthlyPlans.length<1||manifest.monthlyPlans.length>300)throw Error('Manifest must contain 1..300 reviewed monthly-plan IDs for the configured tenant');
  if(manifest.monthlyPlans.some(row=>!uuid.test(row.id)||!Number.isInteger(row.expectedVersion)||row.expectedVersion<1)||new Set(manifest.monthlyPlans.map(row=>row.id)).size!==manifest.monthlyPlans.length)throw Error('Manifest has duplicate or invalid stable IDs/versions');
  const db=new DataSource({...dataSource.options,migrationsRun:false});await db.initialize();
  try{
    const ledger=await db.query('SELECT timestamp FROM migrations'),applied=new Set(ledger.map((row:{timestamp:string})=>Number(row.timestamp)));
    if([1722920118000,1722920119000,1722920121000,1722920122000,1722920122500].some(n=>!applied.has(n))||applied.has(1722920120000))throw Error('Restore requires118/119/121/122/repair migration and excludes120');
    const [service]=await db.query('SELECT username,enabled FROM users WHERE id=$1::uuid',[MASTER_PLAN_SYSTEM_USER_ID]);
    const [role]=await db.query("SELECT rolcanlogin,rolsuper,rolbypassrls,rolinherit FROM pg_roles WHERE rolname='mps_demand_link_service'");
    const [configs]=await db.query("SELECT count(*)::int n FROM mps_sync_configs WHERE tenant_id=$1 AND sync_key IN('shipping-to-base','base-to-weekly') AND enabled=true AND interval_minutes=30",[manifest.tenantId]);
    if(service?.username!=='__kdos_system__'||service.enabled!==false||!role||role.rolcanlogin||role.rolsuper||role.rolbypassrls||role.rolinherit||configs?.n!==2)throw Error('Service identity, DB role, or original synchronization configuration is not ready');
    const currentMissing=await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[manifest.tenantId]);
      return manager.query(`SELECT m.id,m.version FROM mps_monthly_plans m
        JOIN mps_order_allocations a ON a.tenant_id=m.tenant_id AND a.id=m.allocation_id
        JOIN organization_units o ON o.id=m.division_id AND o.enabled=true
        WHERE m.tenant_id=$1 AND m.required_quantity>0
          AND a.imported_at >= '2026-11-07 00:00:00+08'::timestamptz AND a.imported_at < '2026-11-08 00:00:00+08'::timestamptz
          AND a.archived_at IS NULL AND a.order_status='已审核' AND a.manually_maintained=true
          AND (a.order_number,a.item_code,a.division_id) IS NOT DISTINCT FROM (m.order_number,m.item_code,m.division_id)
          AND NOT EXISTS(SELECT 1 FROM mps_base_plans b WHERE b.tenant_id=m.tenant_id AND
            (b.monthly_plan_id=m.id OR (b.monthly_plan_id IS NULL AND
              (b.order_number,b.item_code,b.division_id) IS NOT DISTINCT FROM (m.order_number,m.item_code,m.division_id))))
        ORDER BY m.id` ,[manifest.tenantId]);
    });
    const expected=new Map(manifest.monthlyPlans.map(row=>[row.id,row.expectedVersion]));
    if(currentMissing.length!==manifest.monthlyPlans.length||currentMissing.some((row:any)=>expected.get(String(row.id))!==Number(row.version)))
      throw Error(`Fresh read-only scope mismatch; manifest ${manifest.monthlyPlans.length}, current eligible missing ${currentMissing.length}. Regenerate and review the manifest.`);
    const sync=new MasterPlanSyncService(db),results=[] as unknown[];
    for(let offset=0;offset<manifest.monthlyPlans.length;offset+=25){
      const rows=manifest.monthlyPlans.slice(offset,offset+25),batchId=uuidFrom(`${manifest.requestId}:${offset/25}`);
      const result=await sync.restoreMissingMonthlyBaseBatch(manifest.tenantId,batchId,rows);
      results.push({batch:offset/25+1,monthlyPlans:result.monthlyPlanCount,basePlans:result.basePlanCount,shipping:result.shipping.status,weekly:result.weekly.map((row:any)=>({status:row.status,count:row.count,metrics:row.metrics}))});
      if(result.shipping.status!=='SUCCESS')throw Error(`shipping-to-base did not complete successfully in batch ${offset/25+1}`);
    }
    console.log(JSON.stringify({tenantId:manifest.tenantId,requested:manifest.monthlyPlans.length,batches:results},null,2));
  }finally{await db.destroy();}
}
if(require.main===module)run().catch(error=>{console.error(error instanceof Error?error.message:'Targeted MPS restore failed');process.exitCode=1;});
