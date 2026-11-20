import { DataSource } from 'typeorm';
import db from './data-source';
import { AbnormalCostOrders1722920137000 } from './migrations/1722920137000-AbnormalCostOrders';

export async function migrateAbnormalCostOrders() {
  const selected=new DataSource({...db.options,migrations:[AbnormalCostOrders1722920137000],migrationsRun:false,
    extra:{connectionTimeoutMillis:10000,options:'-c lock_timeout=5s -c statement_timeout=60s -c transaction_timeout=120s'}});
  await selected.initialize();
  try {return await selected.runMigrations({transaction:'all'});}
  finally {await selected.destroy();}
}
if (require.main===module) migrateAbnormalCostOrders().then(rows=>console.log(JSON.stringify({applied:rows.map(r=>r.name)}))).catch(()=>{console.error('ABNORMAL_ORDER_MIGRATION_FAILED');process.exitCode=1;});
