import 'reflect-metadata';
import { DataSource } from 'typeorm';
import original from './data-source';
import { MpsAllocationApprovalOptional1722920130000 } from './migrations/1722920130000-MpsAllocationApprovalOptional';

/** Applies only the reviewed forward migration; never runs the general pending set. */
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
    || (execute && args.get('--confirm') !== 'APPLY-MPS-ALLOCATION-APPROVAL-OPTIONAL-130'))
    throw new Error('Explicit preflight/execute, expected target, and migration confirmation are required');
  const options = original.options;
  if (options.type !== 'postgres' || options.host !== args.get('--expected-host') || options.database !== args.get('--expected-database'))
    throw new Error('Configured database differs from explicit target');
  const db = new DataSource({ ...options, entities: [], subscribers: [], migrations: [MpsAllocationApprovalOptional1722920130000], migrationsRun: false, logging: false,
    extra: { ...options.extra, options: '-c lock_timeout=5000 -c statement_timeout=120000' } });
  await db.initialize();
  try {
    const ledger: Array<{ timestamp: string }> = await db.query('SELECT timestamp FROM migrations');
    const applied = new Set(ledger.map(row => Number(row.timestamp)));
    const required = [1722920118000, 1722920119000, 1722920121000, 1722920122000, 1722920122500, 1722920128000, 1722920129000];
    if (required.some(timestamp => !applied.has(timestamp)) || applied.has(1722920120000)
      || [...applied].some(timestamp => timestamp > 1722920129000))
      throw new Error('Production migration ledger differs from the reviewed MPS baseline');
    const [state] = await db.query(`SELECT to_regprocedure('mps_allocation_source_recovery_allowed(jsonb,jsonb)') IS NOT NULL AS target_exists`);
    if (!state?.target_exists) throw new Error('Allocation source recovery guard is unavailable');
    const alreadyApplied = applied.has(1722920130000);
    let completed: string[] = [];
    if (execute && !alreadyApplied) {
      const rows = await db.runMigrations({ transaction: 'all' });
      completed = rows.map(row => row.name);
      if (completed.length !== 1 || completed[0] !== 'MpsAllocationApprovalOptional1722920130000')
        throw new Error('Unexpected migration set; inspect migration ledger');
    }
    console.log(JSON.stringify({ status: execute ? 'APPLIED' : 'PREFLIGHT_OK', migration: 1722920130000,
      alreadyApplied, completed, businessRowsChanged: false }));
  } finally {
    await db.destroy();
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Allocation approval migration failed');
  process.exitCode = 1;
});
