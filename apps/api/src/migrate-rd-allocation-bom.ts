import { DataSource } from 'typeorm';
import db from './data-source';
import { RdAllocationBomTracking1722920138000 } from './migrations/1722920138000-RdAllocationBomTracking';
export async function migrateRdAllocationBom() {
  const selected = new DataSource({...db.options,migrations:[RdAllocationBomTracking1722920138000],migrationsRun:false,
    extra:{connectionTimeoutMillis:10000,options:'-c lock_timeout=5s -c statement_timeout=120s -c transaction_timeout=180s'}});
  await selected.initialize();
  try { return await selected.runMigrations({transaction:'all'}); } finally { await selected.destroy(); }
}
if (require.main===module) migrateRdAllocationBom().then(rows=>console.log(JSON.stringify({applied:rows.map(r=>r.name)}))).catch(()=>{console.error('RD_ALLOCATION_BOM_MIGRATION_FAILED');process.exitCode=1;});
