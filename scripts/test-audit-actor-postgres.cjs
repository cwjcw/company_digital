/** Disposable fixture database only; never run migrations or mutate production history. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const dotenv = require('dotenv');
const { FieldCandidateService } = require('../apps/api/dist/common/filtering/field-candidate.service');
const { SqlFilterCompiler } = require('../apps/api/dist/common/filtering/sql-filter.compiler');
const { AuditActorIdentityResolver } = require('../apps/api/dist/common/audit/audit-actor-identity.resolver');
const { auditPermissionFields } = require('../packages/contracts/dist');

const settings = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../.env')));
const database = `kdos_audit_actor_test_${process.pid}`;
const container = process.env.AUDIT_POSTGRES_CONTAINER || 'knplan-postgres-1';
const client = new Client({ host: '127.0.0.1', port: 15433, user: settings.DATABASE_USER, password: settings.DATABASE_PASSWORD, database });
const id = '04ada40c-21aa-496b-941c-8c4c969c477b';
const disabled = '0199e000-0000-7000-8000-000000000001';
const unknown = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

(async () => {
  let created = false;
  const results = [];
  try {
    assert.match(database, /^kdos_audit_actor_test_\d+$/);
    execFileSync('docker', ['exec', container, 'createdb', '-U', settings.DATABASE_USER, database], { stdio: 'pipe' });
    created = true;
    await client.connect();
    await client.query('CREATE TABLE users(id uuid PRIMARY KEY,username text,display_name text,enabled boolean); CREATE TABLE actor_test_rows(id integer,tenant_id text,division_id text,created_by text,updated_by text)');
    await client.query('INSERT INTO users VALUES($1,$2,$3,true),($4,$5,$6,false)', [id, '08977', '王家威', disabled, '__kdos_system__', 'KDOS系统任务']);
    const values = [id, disabled, 'system', unknown, 'migration'];
    for (let i = 0; i < values.length; i++) await client.query('INSERT INTO actor_test_rows VALUES($1,$2,$3,$4,$4)', [i, 'KAINAN', 'division-4', values[i]]);
    await client.query("INSERT INTO actor_test_rows VALUES(100,'OTHER','division-4','hidden-tenant','hidden-tenant'),(101,'KAINAN','division-1','hidden-division','hidden-division')");
    const query = async (sql, params) => (await client.query(sql, params)).rows;
    const source = { query };
    const service = new FieldCandidateService(source, new AuditActorIdentityResolver(source));
    const context = { fields: auditPermissionFields, expressions: { createdBy: 'record.created_by', updatedBy: 'record.updated_by' },
      canReadField: () => true, scopedSource: 'actor_test_rows record', scopedWhere: 'record.tenant_id=$1 AND record.division_id=$2', scopedParams: ['KAINAN', 'division-4'] };
    for (const field of ['createdBy', 'updatedBy']) {
      const candidates = await service.resolve(field, '', 200, context);
      assert.equal(candidates.length, 5);
      assert.equal(candidates.find(o => o.value === disabled).label, 'KDOS系统任务');
      assert.equal(candidates.find(o => o.value === unknown).label, '未知用户');
      assert.equal(candidates.find(o => o.value === 'system').label, '系统');
      assert.equal(candidates.some(o => o.value.startsWith('hidden-')), false);
      results.push(`${field}: actual DISTINCT SQL, disabled/system/unknown, tenant + division scope`);
    }
    const found = await service.resolve('updatedBy', '王家威', 200, context);
    assert.deepEqual(found, [{ value: id, label: '王家威' }]);
    const params = [...context.scopedParams];
    const clause = new SqlFilterCompiler(context.fields, context.expressions, () => true).compile({ logic: 'AND', rules: [{ field: 'updatedBy', operator: 'eq', value: found[0].value }] }, params);
    const hits = await query(`SELECT id FROM actor_test_rows record WHERE ${context.scopedWhere} AND ${clause}`, params);
    assert.deepEqual(hits, [{ id: 0 }]);
    results.push('name search + original value SQL filter hits exact authorized row');
    assert.deepEqual(await service.resolve('updatedBy', '', 200, { ...context, scopedParams: ['EMPTY', 'division-4'] }), []);
    results.push('empty authorized scope cannot leak directory candidates');
    const fillers = Array.from({ length: 240 }, (_, i) => `actor-${String(i).padStart(3, '0')}`);
    await client.query('INSERT INTO actor_test_rows SELECT 1000+ord::integer,\'KAINAN\',\'division-many\',value,value FROM unnest($1::text[]) WITH ORDINALITY f(value,ord)', [fillers]);
    await client.query('INSERT INTO actor_test_rows VALUES(2000,$1,$2,$3,$3)', ['KAINAN', 'division-many', 'z-user']);
    await client.query('INSERT INTO users VALUES($1,$2,$3,false)', ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'z-user', '第二批历史用户']);
    const moreContext = { ...context, scopedParams: ['KAINAN', 'division-many'] };
    assert.deepEqual(await service.resolveWithMeta('updatedBy', '第二批历史用户', 1, moreContext), { options: [{ value: 'z-user', label: '第二批历史用户' }], hasMore: false });
    results.push('keyset label search finds actor after first 200 values');
    assert.equal((await service.resolveWithMeta('updatedBy', 'actor-', 1, moreContext)).hasMore, true);
    assert.equal((await service.resolveWithMeta('updatedBy', 'actor-239', 1, moreContext)).hasMore, false);
    results.push('matching-only pagination hasMore accurate across keyset batches');
    const memberFields = [{ key: 'owner', label: '负责人', type: 'member', editable: true }];
    const memberCandidates = async () => (await query("SELECT id::text value,display_name label FROM users WHERE enabled=true", []) );
    assert.deepEqual(await service.resolve('owner', '', 200, { ...context, fields: memberFields, expressions: { owner: 'record.updated_by' }, memberCandidates }), [{ value: id, label: '王家威' }]);
    results.push('ordinary member enabled-only behavior unchanged');
    console.log(JSON.stringify({ status: 'checks passed', scenarios: results.length, results, disposableDatabase: database }));
  } finally {
    await client.end().catch(() => {});
    if (created) execFileSync('docker', ['exec', container, 'dropdb', '-U', settings.DATABASE_USER, database], { stdio: 'pipe' });
  }
})().catch(() => { console.error('Audit actor PostgreSQL validation failed (credentials omitted).'); process.exitCode = 1; });
