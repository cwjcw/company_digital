import { DataSource } from 'typeorm';
import db from './data-source';
import { RdTplusBomIndex1722920135000 } from './migrations/1722920135000-RdTplusBomIndex';

export async function migrateTplusBomIndex() {
  const selected=new DataSource({...db.options,migrations:[RdTplusBomIndex1722920135000],migrationsRun:false,
    extra:{connectionTimeoutMillis:10000,options:'-c lock_timeout=5s -c statement_timeout=60s -c transaction_timeout=120s'}});
  await selected.initialize();
  try {return await selected.runMigrations({transaction:'all'});}
  finally {await selected.destroy();}
}
if (require.main===module) migrateTplusBomIndex().then(rows=>console.log(JSON.stringify({applied:rows.map(r=>r.name)}))).catch(()=>{console.error('TPLUS_BOM_MIGRATION_FAILED');process.exitCode=1;});
