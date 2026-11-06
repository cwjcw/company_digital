import path from 'node:path';
import { DataSource } from 'typeorm';
import dataSource from './data-source';
import { discoverMigrationFiles, phaseAMigrationFiles } from './migration-files';

/** Explicit operator entry point; importing normal API never runs migrations. */
export async function migratePhaseA() {
  const directory=path.join(__dirname,'migrations');
  if(dataSource.options.type!=='postgres')throw new Error('Phase A requires PostgreSQL');
  const db=new DataSource({...dataSource.options,migrations:phaseAMigrationFiles(directory),migrationsRun:false,connectTimeoutMS:10000,extra:{...dataSource.options.extra,options:'-c lock_timeout=10s -c statement_timeout=120s -c transaction_timeout=180s'}});
  await db.initialize();
  try {
    const ledger=await db.query('SELECT timestamp FROM migrations');
    const applied=new Set(ledger.map((r:{timestamp:string})=>Number(r.timestamp)));
    const [deferred]=await db.query(`SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid IN(to_regclass('mps_monthly_plans'),to_regclass('mps_base_plans'),to_regclass('mps_weekly_plans')) AND attname IN('lifecycle_status','monthly_plan_id') AND NOT attisdropped) AS present`);
    if(applied.has(1722920120000)||applied.has(1722920121000)||deferred.present)throw new Error('Phase A expects no120/121; inspect the independent release profile');
    const baseline=discoverMigrationFiles(directory).map(file=>Number(path.basename(file).slice(0,13))).filter(n=>n<1722920118000);
    if(baseline.some(n=>!applied.has(n)))throw new Error('Phase A requires a complete117 baseline; no baseline migrations are auto-run');
    return await db.runMigrations({transaction:'all'});
  } finally { await db.destroy(); }
}
if(require.main===module)migratePhaseA().then(rows=>{console.log(JSON.stringify({applied:rows.map(row=>row.name)}));}).catch(()=>{console.error('Phase A migration failed; inspect database availability, prerequisite ledger and migration compatibility.');process.exitCode=1;});
