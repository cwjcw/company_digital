import path from 'node:path';
import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import dataSource from './data-source';
import { rdBomReportMigrationFiles } from './migration-files';

/** Operator-only strict runner. It can execute migration 125 only; startup never migrates. */
export async function migrateRdBomReportCustomerDueDate() {
  const directory = path.join(__dirname, 'migrations');
  const selected = rdBomReportMigrationFiles(directory);
  const base = dataSource.options as PostgresConnectionOptions;
  const db = new DataSource({
    ...base,
    migrations: selected,
    migrationsRun: false,
    extra: { ...base.extra, connectionTimeoutMillis: 10000, options: '-c lock_timeout=5s -c statement_timeout=30s -c transaction_timeout=60s' }
  });
  await db.initialize();
  try {
    const rows = await db.query('SELECT timestamp FROM migrations');
    const applied = new Set<number>(rows.map((row: { timestamp: string }) => Number(row.timestamp)));
    const [state] = await db.query(`SELECT to_regclass('mps_order_allocations') IS NOT NULL AS table_exists,
      EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('mps_order_allocations') AND attname='customer_due_date' AND NOT attisdropped) AS column_exists`);
    if (!state.table_exists) throw new Error('Required order allocation table is absent');
    if (applied.has(1722920125000) !== state.column_exists) throw new Error('Migration 125 ledger/schema mismatch; inspect without changing the ledger');
    if (applied.has(1722920125000)) return [];
    return await db.runMigrations({ transaction: 'all' });
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  migrateRdBomReportCustomerDueDate()
    .then(rows => console.log(JSON.stringify({ applied: rows.map(row => row.name) })))
    .catch(() => { console.error('R&D BOM report migration refused or failed; verify the allocation table and migration 125 ledger/schema.'); process.exitCode = 1; });
}
