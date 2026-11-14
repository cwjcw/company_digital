import path from 'node:path';
import { DataSource } from 'typeorm';
import dataSource from './data-source';
import { demandLinkServiceMigrationFiles, discoverMigrationFiles } from './migration-files';

/** Strict operator entry point: applies only 1722920122500, never120 or123. */
export async function migrateMpsDemandLinkService() {
  if (dataSource.options.type !== 'postgres') throw Error('Demand-link service authorization requires PostgreSQL');
  const dir = path.join(__dirname, 'migrations');
  const all = discoverMigrationFiles(dir);
  const selected = demandLinkServiceMigrationFiles(dir);
  const db = new DataSource({ ...dataSource.options, migrations: selected, migrationsRun: false, connectTimeoutMS: 10000,
    extra: { ...dataSource.options.extra, options: '-c lock_timeout=10s -c statement_timeout=120s -c transaction_timeout=180s' } });
  await db.initialize();
  try {
    const ledger = await db.query('SELECT timestamp FROM migrations');
    const applied = new Set<number>(ledger.map((r: { timestamp: string }) => Number(r.timestamp)));
    const required = [1722920118000, 1722920119000, 1722920121000, 1722920122000];
    if (required.some(n => !applied.has(n)) || applied.has(1722920120000) || [...applied].some(n => n > 1722920123000))
      throw Error('Requires 118/119/121/122; excludes120 and unknown future migrations; 123 may be applied independently');
    const [state] = await db.query(`SELECT to_regprocedure('mps_assert_demand_link(text,jsonb)') IS NOT NULL AS demand_guard,
      EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid IN(to_regclass('mps_monthly_plans'),to_regclass('mps_base_plans'),to_regclass('mps_weekly_plans')) AND attname='lifecycle_status' AND NOT attisdropped) AS lifecycle,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('mps_process_reports') AND tgname='trg_mps_report_context' AND tgenabled='O') AS guard119,
      to_regclass('mps_review_base_plan_links') IS NOT NULL AS guard122`);
    if (!state.demand_guard || state.lifecycle || !state.guard119 || !state.guard122)
      throw Error('Demand-link service schema does not match reviewed 119/121/122 baseline');
    // The selected array is exactly one migration; `all` is consulted only by the preflight above.
    if (selected.length !== 1 || Number(path.basename(selected[0]!).slice(0, 13)) !== 1722920122500 || all.length < 123)
      throw Error('Strict demand-link migration allowlist mismatch');
    return await db.runMigrations({ transaction: 'all' });
  } finally { await db.destroy(); }
}

if (require.main === module) migrateMpsDemandLinkService()
  .then(rows => console.log(JSON.stringify({ applied: rows.map(row => row.name) })))
  .catch(() => { console.error('Demand-link service migration refused or failed; inspect strict baseline and database availability.'); process.exitCode = 1; });
