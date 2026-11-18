import 'reflect-metadata';
import { DataSource } from 'typeorm';
import original from './data-source';
import { MpsInboundOnlySnapshotInitialization1722920134000 } from './migrations/1722920134000-MpsInboundOnlySnapshotInitialization';

async function main() {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const [key, ...value] = arg.split('=');
    if (!['--preflight', '--execute', '--confirm', '--expected-host', '--expected-database'].includes(key!) || args.has(key!))
      throw new Error('Invalid migration argument');
    args.set(key!, value.join('=') || 'true');
  }
  const execute = args.has('--execute');
  if (execute === args.has('--preflight') || !args.get('--expected-host') || !args.get('--expected-database')
    || (execute && args.get('--confirm') !== 'APPLY-MPS-INBOUND-SNAPSHOT-134'))
    throw new Error('Explicit preflight/execute, expected target, and migration confirmation are required');
  if (original.options.type !== 'postgres' || original.options.host !== args.get('--expected-host')
    || original.options.database !== args.get('--expected-database'))
    throw new Error('Configured database differs from explicit target');

  const db = new DataSource({ ...original.options, entities: [], subscribers: [], migrations: [MpsInboundOnlySnapshotInitialization1722920134000], migrationsRun: false,
    logging: false, extra: { ...original.options.extra, options: '-c lock_timeout=5000 -c statement_timeout=120000' } });
  await db.initialize();
  try {
    const ledger: Array<{ timestamp: string }> = await db.query('SELECT timestamp FROM migrations');
    const applied = new Set(ledger.map(row => Number(row.timestamp)));
    const required = [1722920119000, 1722920120000, 1722920133000];
    if (required.some(timestamp => !applied.has(timestamp)) || applied.has(1722920134000)
      || [...applied].some(timestamp => timestamp > 1722920133000))
      throw new Error('Production migration ledger differs from the reviewed MPS baseline');
    const [state] = await db.query(`SELECT
      to_regprocedure('mps_weekly_has_execution(character varying,uuid)') IS NOT NULL AS execution_guard,
      to_regprocedure('mps_execution_content(text,jsonb)') IS NOT NULL AS content_guard,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('mps_weekly_process_plans')
        AND tgname='zz_mps_executed_process_identity' AND tgenabled='O') AS task_trigger`);
    if (!state?.execution_guard || !state?.content_guard || !state?.task_trigger)
      throw new Error('Required process execution protection is unavailable');
    const completed = execute ? (await db.runMigrations({ transaction: 'all' })).map(row => row.name) : [];
    if (completed.length > 1 || (completed.length === 1 && completed[0] !== MpsInboundOnlySnapshotInitialization1722920134000.name))
      throw new Error('Unexpected migration set');
    console.log(JSON.stringify({ status: execute ? 'APPLIED' : 'PREFLIGHT_OK', migration: 1722920134000, completed, businessRowsChanged: false }));
  } finally {
    await db.destroy();
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Process snapshot migration failed');
  process.exitCode = 1;
});
