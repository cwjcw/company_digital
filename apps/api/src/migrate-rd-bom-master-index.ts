import path from 'node:path';
import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import dataSource from './data-source';
import { rdBomMasterIndexMigrationFiles } from './migration-files';

/** Strict operator entry point: executes migration127 only, never all pending migrations. */
export async function migrateRdBomMasterIndex() {
  const selected = rdBomMasterIndexMigrationFiles(path.join(__dirname, 'migrations'));
  const base = dataSource.options as PostgresConnectionOptions;
  const db = new DataSource({ ...base, migrations: selected, migrationsRun: false,
    extra: { ...base.extra, connectionTimeoutMillis: 10000, options: '-c lock_timeout=5s -c statement_timeout=60s -c transaction_timeout=120s' } });
  await db.initialize();
  try {
    const ledger = await db.query(`SELECT timestamp FROM migrations`);
    if (ledger.some((row: { timestamp: string }) => Number(row.timestamp) === 1722920127000)) {
      const [state] = await db.query(`SELECT to_regclass('rd_bom_master_heads') IS NOT NULL AS heads,
        to_regclass('rd_bom_sync_state') IS NOT NULL AS state,
        to_regclass('rd_bom_sync_stage') IS NOT NULL AS stage,
        to_regclass('rd_bom_sync_runs') IS NOT NULL AS runs`);
      if (!state.heads || !state.state || !state.stage || !state.runs) throw new Error('Migration 127 ledger/schema mismatch');
      const columns = await db.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() AND
        ((table_name='rd_bom_sync_state' AND column_name='last_error_count') OR (table_name='rd_bom_sync_runs' AND column_name='error_count'))`);
      if (columns.length !== 2) throw new Error('Migration 127 schema columns mismatch');
      return [];
    }
    const [existing] = await db.query(`SELECT to_regclass('rd_bom_master_heads') IS NOT NULL AS exists`);
    if (existing.exists) throw new Error('Migration 127 schema exists without ledger entry; inspect without changing the ledger');
    return await db.runMigrations({ transaction: 'all' });
  } finally { await db.destroy(); }
}

if (require.main === module) migrateRdBomMasterIndex().then(rows => console.log(JSON.stringify({ applied: rows.map(row => row.name) })))
  .catch(() => { console.error('R&D BOM index migration refused or failed; verify migration127 ledger/schema.'); process.exitCode = 1; });
