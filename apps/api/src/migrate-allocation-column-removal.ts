import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import dataSource from './data-source';
import { MpsRemoveAllocationCustomerDueDate1722920126000 } from './migrations/1722920126000-MpsRemoveAllocationCustomerDueDate';

/** Strict operator entry: only the approved empty-column removal, never pending migrations. */
export async function migrateAllocationColumnRemoval() {
  const base = dataSource.options as PostgresConnectionOptions;
  const db = new DataSource({ ...base, migrations: [MpsRemoveAllocationCustomerDueDate1722920126000], migrationsRun: false,
    extra: { ...base.extra, connectionTimeoutMillis: 10000, options: '-c lock_timeout=3s -c statement_timeout=30s -c transaction_timeout=60s' } });
  await db.initialize();
  try {
    const applied = new Set((await db.query('SELECT timestamp FROM migrations')).map((row: { timestamp: string }) => Number(row.timestamp)));
    const [state] = await db.query(`SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('mps_order_allocations') AND attname='customer_due_date' AND NOT attisdropped) AS column_exists`);
    if (!applied.has(1722920125000)) throw new Error('Required allocation customer date migration is not recorded');
    if (applied.has(1722920126000) === state.column_exists) throw new Error('Allocation column removal ledger/schema mismatch');
    if (applied.has(1722920126000)) return [];
    return await db.runMigrations({ transaction: 'all' });
  } finally { await db.destroy(); }
}
if (require.main === module) {
  migrateAllocationColumnRemoval().then(rows => console.log(JSON.stringify({ applied: rows.map(row => row.name) })))
    .catch(() => { console.error('Allocation column removal refused or failed; inspect nonempty dates, dependencies, locks and ledger/schema.'); process.exitCode = 1; });
}
