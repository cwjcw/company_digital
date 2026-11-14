import 'reflect-metadata';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import dataSource from './data-source';
import { auditedDemandIdentityTransferMigrationFiles, discoverMigrationFiles } from './migration-files';
import { MpsAuditedDemandIdentityTransfer1722920128000 } from './migrations/1722920128000-MpsAuditedDemandIdentityTransfer';

const MIGRATION = 'MpsAuditedDemandIdentityTransfer1722920128000';
const TIMESTAMP = 1722920128000;
const EXPECTED_SOURCE_SHA256 = '52d1f033d7f0abc68ded41b39ee8f10eb779cd7257abef68e153d50e553209f5';
const EXPECTED_COMPILED_SHA256 = 'b1278201d7c573f72e6af4317b2055548716643f8defe5da5dd2c139e2ca99d2';
const MIGRATION121_PARENT_SHA256 = '8b0062078c1faeef4ed6600e0d929ba6f0641b70aaee183b0095d7998d79b8c6';
const MIGRATION121_LINK_SHA256 = 'd9792db67628d1eeac70a210a37e4db077dde76b74e0bec3323fc5472212315a';
const MIGRATION128_PARENT_SHA256 = 'f41397671bbc7e8035a110c22eaecb20f4b1b301b7dc751ba7322b38ae0c160b';
const MIGRATION128_LINK_SHA256 = '533b7f310049d37b0df4f772907adb44a3bbb09bc29e7417da6e29b711c73f85';
const CONFIRMATION = 'APPLY-MIGRATION-128-to-four_department_tracker';

type Options = {
  environment: 'production' | 'isolated';
  migration: string;
  expectedHost: string;
  expectedDatabase: string;
  mode: 'preflight' | 'execute';
  confirmation?: string;
};

export function parseMigration128Args(args: string[]): Options {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const [key, inline] = args[i].split('=', 2);
    if (!key.startsWith('--') || values.has(key)) throw new Error('Invalid or duplicate argument');
    if (inline !== undefined) values.set(key, inline);
    else if (args[i + 1] && !args[i + 1].startsWith('--')) values.set(key, args[++i]);
    else values.set(key, 'true');
  }
  const mode = values.has('--preflight') === values.has('--execute') ? undefined : values.has('--preflight') ? 'preflight' : 'execute';
  const environment = values.get('--environment');
  const expectedHost = values.get('--expected-host');
  const expectedDatabase = values.get('--expected-database');
  const migration = values.get('--migration');
  const allowed = new Set(['--environment', '--expected-host', '--expected-database', '--migration', '--preflight', '--execute', '--confirm']);
  if ([...values.keys()].some(key => !allowed.has(key)) || !mode || (environment !== 'production' && environment !== 'isolated')
    || !expectedHost || !expectedDatabase || migration !== String(TIMESTAMP)) throw new Error('Explicit environment, target, migration 1722920128000, and one mode are required');
  if (mode === 'execute' && values.get('--confirm') !== CONFIRMATION) throw new Error('Exact execution confirmation is required');
  return { environment, migration, expectedHost, expectedDatabase, mode, confirmation: values.get('--confirm') };
}

function verifySource(): void {
  const directory = path.join(__dirname, 'migrations');
  const implementations = auditedDemandIdentityTransferMigrationFiles(directory);
  if (implementations.length !== 1) throw new Error('Migration selection must contain exactly one implementation');
  const sourcePath = path.join(directory, '1722920128000-MpsAuditedDemandIdentityTransfer.ts');
  const jsPath = sourcePath.replace(/\.ts$/, '.js');
  const actualPath = fs.existsSync(sourcePath) ? sourcePath : jsPath;
  const digest = createHash('sha256').update(fs.readFileSync(actualPath)).digest('hex');
  if (digest !== (actualPath === sourcePath ? EXPECTED_SOURCE_SHA256 : EXPECTED_COMPILED_SHA256)) throw new Error('Migration 128 source digest does not match the reviewed implementation');
}

async function validateTarget(db: DataSource, options: Options) {
  if (options.environment === 'production' && process.env.NODE_ENV !== 'production') throw new Error('Production mode requires NODE_ENV=production');
  if (options.environment === 'isolated' && process.env.NODE_ENV === 'production') throw new Error('Production runtime cannot be labeled isolated');
  const config = db.options as PostgresConnectionOptions;
  if (config.type !== 'postgres' || config.host !== options.expectedHost || config.database !== options.expectedDatabase) throw new Error('Configured connection target does not match explicit target');
  if (options.environment === 'production' && options.expectedDatabase !== 'four_department_tracker') throw new Error('Production target database is not approved');
  const [identity] = await db.query(`SELECT current_database() AS database, inet_server_addr()::text AS address,
      inet_server_port() AS port, current_schema() AS schema`);
  const [readOnly] = await db.query('SHOW transaction_read_only');
  if (options.mode === 'preflight' && readOnly.transaction_read_only !== 'on') throw new Error('Preflight connection is not read-only');
  if (identity.database !== options.expectedDatabase) throw new Error('Connected database does not match explicit target');
  const ledgerExists = await db.query(`SELECT to_regclass('migrations') IS NOT NULL AS exists`);
  if (!ledgerExists[0]?.exists) throw new Error('TypeORM migration ledger is missing');
  const ledger: Array<{ timestamp: string | number; name: string }> = await db.query('SELECT timestamp,name FROM migrations');
  const applied = new Set(ledger.map(row => Number(row.timestamp)));
  const [functions] = await db.query(`SELECT
    to_regprocedure('mps_guard_demand_parent()') IS NOT NULL AS parent_exists,
    to_regprocedure('mps_assert_demand_link(text,jsonb)') IS NOT NULL AS link_exists,
    to_regclass('audit_logs') IS NOT NULL AS audit_exists,
    CASE WHEN to_regprocedure('mps_guard_demand_parent()') IS NULL THEN '' ELSE pg_get_functiondef('mps_guard_demand_parent()'::regprocedure) END AS parent_definition,
    CASE WHEN to_regprocedure('mps_assert_demand_link(text,jsonb)') IS NULL THEN '' ELSE pg_get_functiondef('mps_assert_demand_link(text,jsonb)'::regprocedure) END AS link_definition`);
  const parentBase = /BEGIN\s+IF \(OLD\.order_number,OLD\.item_code,OLD\.division_id,OLD\.customer_code,OLD\.allocation_id\)/.test(functions.parent_definition);
  const linkBase = /BEGIN\s+IF r->>'monthly_plan_id' IS NULL THEN RETURN; END IF;/.test(functions.link_definition);
  const parentPatched = functions.parent_definition.includes('division_transfer.plan_identity_authorized');
  const linkPatched = functions.link_definition.includes('division_transfer.plan_identity_authorized');
  if (!functions.audit_exists || !functions.parent_exists || !functions.link_exists) throw new Error('Migration 121 prerequisite schema or functions are missing');
  const isApplied = applied.has(TIMESTAMP);
  if (!applied.has(1722920121000)) throw new Error('Migration 121 is not recorded as applied');
  const expectedParentDigest = isApplied ? MIGRATION128_PARENT_SHA256 : MIGRATION121_PARENT_SHA256;
  const expectedLinkDigest = isApplied ? MIGRATION128_LINK_SHA256 : MIGRATION121_LINK_SHA256;
  const parentDigest = createHash('sha256').update(functions.parent_definition).digest('hex');
  const linkDigest = createHash('sha256').update(functions.link_definition).digest('hex');
  if (parentDigest !== expectedParentDigest || linkDigest !== expectedLinkDigest) throw new Error('Current demand identity functions differ from the reviewed migration121/128 definition');
  if (!isApplied && (!parentBase || !linkBase)) throw new Error('Migration 121 function definitions do not match Migration 128 prerequisites');
  if (isApplied && !(parentPatched && linkPatched)) throw new Error('Migration 128 ledger/schema mismatch');
  return { identity, isApplied, applied, ledger, migration121: applied.has(1722920121000), migration120: applied.has(1722920120000), functionsPatched: parentPatched && linkPatched };
}

export async function runMpsAuditedDemandIdentityTransfer(args: string[]) {
  const options = parseMigration128Args(args);
  verifySource();
  const base = dataSource.options as PostgresConnectionOptions;
  const db = new DataSource({ ...base, migrations: [MpsAuditedDemandIdentityTransfer1722920128000], migrationsRun: false,
    connectTimeoutMS: 10000,
    extra: { ...base.extra, options: `-c default_transaction_read_only=${options.mode === 'preflight' ? 'on' : 'off'} -c lock_timeout=5s -c statement_timeout=60s -c transaction_timeout=90s` } });
  await db.initialize();
  try {
    const before = await validateTarget(db, options);
    const migrations = discoverMigrationFiles(path.join(__dirname, 'migrations'));
    const pending = migrations.map(file => ({ name: path.basename(file), timestamp: Number(path.basename(file).slice(0, 13)) })).filter(row => !before.applied.has(row.timestamp));
    if (options.mode === 'preflight' || before.isApplied) return { status: before.isApplied ? 'ALREADY_APPLIED' : 'PREFLIGHT_OK', target: before.identity, migration: MIGRATION,
      migration120Applied: before.migration120, migration121Applied: before.migration121, pendingMigrationCount: pending.length, pendingMigrationNames: pending.map(row => row.name) };
    const selected = db.options.migrations;
    if (!Array.isArray(selected) || selected.length !== 1 || selected[0] !== MpsAuditedDemandIdentityTransfer1722920128000 || db.options.migrationsRun !== false)
      throw new Error('Execution scope is not exactly Migration 128');
    const rows = await db.runMigrations({ transaction: 'all' });
    const after = await validateTarget(db, options);
    if (rows.length !== 1 || rows[0].name !== MIGRATION || !after.isApplied || !after.functionsPatched) throw new Error('Migration 128 postcondition failed');
    return { status: 'APPLIED', target: after.identity, migration: MIGRATION, applied: rows.map(row => row.name), migration120Applied: after.migration120 };
  } finally { await db.destroy(); }
}

if (require.main === module) {
  runMpsAuditedDemandIdentityTransfer(process.argv.slice(2))
    .then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('Migration 128 refused or failed; no unrelated migration was selected. Inspect the sanitized preflight result and database ledger.'); process.exitCode = 1; });
}
