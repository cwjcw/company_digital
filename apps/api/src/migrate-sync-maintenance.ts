import path from 'node:path';
import { DataSource } from 'typeorm';
import dataSource from './data-source';
import { discoverMigrationFiles, syncMaintenanceMigrationFiles } from './migration-files';
export async function migrateSyncMaintenance() {
  const files=discoverMigrationFiles(path.join(__dirname,'migrations'));
  const selected=syncMaintenanceMigrationFiles(path.join(__dirname,'migrations'));
  if(selected.length!==1) throw Error('Exactly123 is required');
  const db=new DataSource({...dataSource.options,migrations:selected,migrationsRun:false,extra:{...dataSource.options.extra,options:'-c lock_timeout=5s -c statement_timeout=120s -c transaction_timeout=180s'}});
  await db.initialize();
  try {
    const rows=await db.query('SELECT timestamp FROM migrations'),applied=new Set(rows.map((r:{timestamp:string})=>Number(r.timestamp)));
    const required=[...new Set([...files.map(f=>Number(path.basename(f).slice(0,13))).filter(n=>n<=1722920122000&&n!==1722920120000),1722920122500])];
    if(required.some(n=>!applied.has(n))||applied.has(1722920120000)||applied.has(1722920123000)||applied.has(1722920124000)) throw Error('123 requires118/119/121/122/122.5, must be pending, and excludes120/124; no default pending migrations are selected');
    const [r]=await db.query(`SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('mps_sync_configs') AND attname='maintenance_state' AND NOT attisdropped) ready,
      EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid IN(to_regclass('mps_monthly_plans'),to_regclass('mps_base_plans'),to_regclass('mps_weekly_plans')) AND attname='lifecycle_status' AND NOT attisdropped) lifecycle,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('mps_process_reports') AND tgname='trg_mps_report_context' AND tgenabled='O') guard119,
      to_regprocedure('mps_assert_demand_link(text,jsonb)') IS NOT NULL guard121,to_regclass('mps_review_base_plan_links') IS NOT NULL guard122,
      EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('mps_review_due_dates') AND attname='monthly_plan_id' AND NOT attisdropped) review_demand_link,
      (SELECT count(*)::int FROM pg_index WHERE indexrelid IN(to_regclass('ix_mps_audit_sync_baseline'),to_regclass('ix_mps_inbound_changed')) AND indisvalid) indexes`);
    if(r.lifecycle || !r.guard119 || !r.guard121 || !r.guard122 || !r.review_demand_link || r.indexes!==0 || r.ready)throw Error('123 prerequisite schema mismatch; 120/123/124 must remain absent');
    return await db.runMigrations({transaction:'all'});
  } finally { await db.destroy(); }
}
if(require.main===module) migrateSyncMaintenance().then(r=>console.log(JSON.stringify({applied:r.map(x=>x.name)}))).catch(()=>{console.error('Sync maintenance migration refused or failed; verify reviewed baseline/schema and database availability');process.exitCode=1;});
