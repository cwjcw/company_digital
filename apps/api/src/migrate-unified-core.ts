import path from 'node:path';
import { DataSource } from 'typeorm';
import dataSource from './data-source';
import { discoverMigrationFiles, unifiedCoreMigrationFiles } from './migration-files';
/** Operator-only. API startup never executes migrations. No120 or historical backfill. */
export async function migrateUnifiedCore() {
    if (dataSource.options.type !== 'postgres')
        throw Error('Unified core requires PostgreSQL');
    const dir = path.join(__dirname, 'migrations');
    const db = new DataSource({ ...dataSource.options, migrations: unifiedCoreMigrationFiles(dir), migrationsRun: false, connectTimeoutMS: 10000, extra: { ...dataSource.options.extra, options: '-c lock_timeout=10s -c statement_timeout=120s -c transaction_timeout=180s' } });
    await db.initialize();
    try {
        const ledger = await db.query('SELECT timestamp FROM migrations'), applied = new Set<number>(ledger.map((r: {
            timestamp: string;
        }) => Number(r.timestamp)));
        const baseline = discoverMigrationFiles(dir).map(f => Number(path.basename(f).slice(0, 13))).filter(n => n <= 1722920119000);
        if (baseline.some(n => !applied.has(n)))
            throw Error('Unified core requires complete119 baseline; baseline is never auto-run');
        const [state] = await db.query(`SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid IN(to_regclass('mps_monthly_plans'),to_regclass('mps_base_plans'),to_regclass('mps_weekly_plans')) AND attname='lifecycle_status' AND NOT attisdropped) lifecycle,to_regclass('mps_review_base_plan_links') IS NOT NULL applications,EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('mps_base_plans') AND attname='monthly_plan_id' AND NOT attisdropped) links`);
        if (applied.has(1722920120000) || state.lifecycle || [...applied].some(n => n > 1722920122000))
            throw Error('Lifecycle/future schema requires a different reviewed release');
        if (state.links !== applied.has(1722920121000) || state.applications !== applied.has(1722920122000))
            throw Error('Ledger/schema disagreement; stop and inspect');
        return await db.runMigrations({ transaction: 'all' });
    }
    finally {
        await db.destroy();
    }
}
if (require.main === module)
    migrateUnifiedCore().then(rows => console.log(JSON.stringify({ applied: rows.map(r => r.name) }))).catch(() => { console.error('Unified core migration refused or failed; inspect prerequisite ledger, schema and database availability.'); process.exitCode = 1; });
