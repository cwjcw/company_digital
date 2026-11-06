import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { monthlyBaseLookupSql } from './master-plan.monthly-base';

const integration = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET ? describe : describe.skip;
integration('monthly base lookup: production-size synthetic index and schema compatibility', () => {
  let db: DataSource;
  const tenant = 'LOOKUP-SYNTHETIC', parent = randomUUID();
  beforeAll(async () => {
    const socket = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET!;
    if (!socket.endsWith('/test/mps_sync_reliability/pg_socket')) throw Error('Isolated socket required');
    const options = { type: 'postgres' as const, host: socket, username: 'postgres', entities: [], logging: false as const };
    const control = new DataSource({ ...options, database: 'postgres' });
    await control.initialize();
    try {
      await control.query('DROP DATABASE IF EXISTS monthly_lookup_test WITH (FORCE)');
      await control.query('CREATE DATABASE monthly_lookup_test');
    } finally { await control.destroy(); }
    db = new DataSource({ ...options, database: 'monthly_lookup_test' });
    await db.initialize();
    await db.query(`CREATE TABLE mps_base_plans(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id text NOT NULL,
      order_number text,item_code text,monthly_plan_id uuid,order_date date,latest_customer_due_date date);
      CREATE INDEX parent_lookup ON mps_base_plans(tenant_id,monthly_plan_id);
      CREATE UNIQUE INDEX identity_lookup ON mps_base_plans(tenant_id,order_number,item_code,id);
      INSERT INTO mps_base_plans(tenant_id,order_number,item_code)
        SELECT 'LOOKUP-SYNTHETIC','SYN-'||n,'SYN-ITEM' FROM generate_series(1,8000)n;
      INSERT INTO mps_base_plans(tenant_id,order_number,item_code)VALUES('OTHER-SYNTHETIC','SYN-42','SYN-ITEM');
      ANALYZE mps_base_plans`);
  });
  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });
  it('uses existing indexes with 8000 legacy rows rather than serializing/scanning the whole table', async () => {
    const [row] = await db.query('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ' + monthlyBaseLookupSql(true), [tenant, 'SYN-42', 'SYN-ITEM', parent]);
    const names = (plan: any): string[] => [plan['Node Type'], ...(plan.Plans ?? []).flatMap(names)];
    const nodes = names(row['QUERY PLAN'][0].Plan);
    expect(nodes.some(name => name.includes('Index'))).toBe(true);
    expect(nodes).not.toContain('Seq Scan');
  });
  it('returns the same parent plus legacy identity rows as the prior predicate, with tenant isolation', async () => {
    await db.query("INSERT INTO mps_base_plans(tenant_id,order_number,item_code,monthly_plan_id)VALUES($1,'SYN-PARENT','SYN-OTHER',$2)", [tenant, parent]);
    const params = [tenant, 'SYN-42', 'SYN-ITEM', parent];
    const current = await db.query(monthlyBaseLookupSql(true), params);
    const previous = await db.query(`SELECT *,order_date::text AS order_date,latest_customer_due_date::text AS latest_customer_due_date FROM mps_base_plans
      WHERE tenant_id=$1 AND ((to_jsonb(mps_base_plans)->>'monthly_plan_id')::uuid=$4::uuid OR (order_number=$2 AND item_code=$3)) ORDER BY id FOR UPDATE`, params);
    expect(current).toEqual(previous);
    expect(current).toHaveLength(2);
    expect(current.every((row: any) => row.tenant_id === tenant)).toBe(true);
  });
  it('continues to query before121 when the parent column does not exist', async () => {
    await db.query('ALTER TABLE mps_base_plans DROP COLUMN monthly_plan_id');
    const rows = await db.query(monthlyBaseLookupSql(false), [tenant, 'SYN-42', 'SYN-ITEM']);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(tenant);
  });
});
