import path from 'node:path';
import { DataSource } from 'typeorm';
import dataSource from './data-source';
import { discoverMigrationFiles, reviewDueIndependenceMigrationFiles } from './migration-files';

/** Explicit operator entry point; never discovers and runs every pending migration. */
export async function migrateReviewDueIndependence() {
  const dir=path.join(__dirname,'migrations');
  const files=discoverMigrationFiles(dir),selected=reviewDueIndependenceMigrationFiles(dir);
  const db=new DataSource({...dataSource.options,migrations:selected,migrationsRun:false,extra:{...dataSource.options.extra,options:'-c lock_timeout=5s -c statement_timeout=120s -c transaction_timeout=180s'}});
  await db.initialize();
  try {
    const ledger=await db.query('SELECT timestamp FROM migrations'),applied=new Set<number>(ledger.map((row:{timestamp:string})=>Number(row.timestamp)));
    const baseline=[...new Set([...files.map(file=>Number(path.basename(file).slice(0,13))).filter(timestamp=>timestamp<=1722920123000&&timestamp!==1722920120000),1722920122500])];
    if(baseline.some(timestamp=>!applied.has(timestamp))||applied.has(1722920120000)||applied.has(1722920124000))
      throw Error('124 requires applied123 and the reviewed baseline, must be pending, and excludes120; no default pending migrations are selected');
    const [state]=await db.query(`SELECT
      to_regclass('mps_review_due_dates') IS NOT NULL review_table,
      to_regclass('mps_review_base_plan_links') IS NOT NULL application_table,
      EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('mps_review_due_dates') AND attname='monthly_plan_id' AND NOT attisdropped) demand_link,
      EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('mps_review_due_dates') AND attname IN('due_date','change_count','previous_inbound_date') AND NOT attisdropped) old_columns,
      (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('mps_review_due_dates') AND attname IN('customer_due_date','order_date') AND NOT attisdropped) new_columns,
      EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid IN(to_regclass('mps_monthly_plans'),to_regclass('mps_base_plans'),to_regclass('mps_weekly_plans')) AND attname='lifecycle_status' AND NOT attisdropped) lifecycle`);
    if(!state.review_table||!state.application_table||!state.demand_link||!state.old_columns||Number(state.new_columns)!==0||state.lifecycle)
      throw Error('Review independence migration ledger/schema mismatch; stop for manual inspection');
    return await db.runMigrations({transaction:'all'});
  } finally { await db.destroy(); }
}
if(require.main===module)migrateReviewDueIndependence().then(rows=>console.log(JSON.stringify({applied:rows.map(row=>row.name)}))).catch(()=>{console.error('Review independence migration refused or failed; inspect reviewed123 baseline, schema and database availability.');process.exitCode=1;});
