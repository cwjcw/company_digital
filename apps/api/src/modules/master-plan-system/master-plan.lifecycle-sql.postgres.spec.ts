import { DataSource } from 'typeorm';
import { weeklyLifecycleExecutableSql } from './master-plan.lifecycle-sql';
import { processReportPendingSourceSql } from './master-plan.config';

const integration = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET ? describe : describe.skip;
integration('pending lifecycle SQL: absent120 and protected ancestry', () => {
  let db: DataSource;
  beforeAll(async () => {
    const socket = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET!;
    if (!socket.endsWith('/test/mps_sync_reliability/pg_socket')) throw Error('Isolated socket required');
    const options = { type: 'postgres' as const, host: socket, username: 'postgres', entities: [], logging: false as const };
    const control = new DataSource({ ...options, database: 'postgres' });
    await control.initialize();
    try {
      await control.query('DROP DATABASE IF EXISTS pending_lifecycle_sql_test WITH (FORCE)');
      await control.query('CREATE DATABASE pending_lifecycle_sql_test');
    } finally { await control.destroy(); }
    db = new DataSource({ ...options, database: 'pending_lifecycle_sql_test' });
    await db.initialize();
    await db.query(`CREATE TABLE mps_monthly_plans(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id text,order_number text,item_code text,division_id uuid);
      CREATE TABLE mps_shipping_plans(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id text,monthly_plan_id uuid);
      CREATE TABLE mps_base_plans(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id text,shipping_plan_id uuid);
      CREATE TABLE mps_weekly_plans(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id text,base_plan_id uuid,division_id uuid,
        order_number text,item_code text,item_name text,delivery_number numeric,planned_quantity numeric,manufacturing_method text);
      CREATE TABLE mps_weekly_process_plans(id uuid PRIMARY KEY DEFAULT uuidv7(),version int DEFAULT 1,tenant_id text,
        weekly_plan_id uuid,process_code text,process_name text,execution_enabled boolean DEFAULT true,
        created_by uuid,created_at timestamptz,updated_by uuid,updated_at timestamptz);
      CREATE TABLE mps_process_reports(tenant_id text,weekly_plan_id uuid,process_code text,division_id uuid,production_quantity numeric);
      INSERT INTO mps_monthly_plans(tenant_id,order_number,item_code) SELECT 'SYN-PENDING','SYN-'||n,'ITEM' FROM generate_series(1,8000)n;
      INSERT INTO mps_shipping_plans(tenant_id,monthly_plan_id) SELECT tenant_id,id FROM mps_monthly_plans;
      INSERT INTO mps_base_plans(tenant_id,shipping_plan_id) SELECT tenant_id,id FROM mps_shipping_plans;
      INSERT INTO mps_weekly_plans(tenant_id,base_plan_id,order_number,item_code,item_name,delivery_number,planned_quantity,manufacturing_method)
        SELECT b.tenant_id,b.id,m.order_number,m.item_code,'合成品项',1,10,'自制' FROM mps_base_plans b
        JOIN mps_shipping_plans s ON s.id=b.shipping_plan_id JOIN mps_monthly_plans m ON m.id=s.monthly_plan_id;
      INSERT INTO mps_weekly_process_plans(tenant_id,weekly_plan_id,process_code,process_name)
        SELECT tenant_id,id,'bending','折弯' FROM mps_weekly_plans;
      ANALYZE; SET statement_timeout='4s'`);
  });
  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });
  const query = () => `WITH record AS (${processReportPendingSourceSql}) SELECT count(*)::int count FROM record WHERE tenant_id=$1`;
  it('loads8000 actual pending tasks without executing ancestry subplans when120 is absent', async () => {
    expect(await db.query(query(), ['SYN-PENDING'])).toEqual([{ count: 8000 }]);
    const [row] = await db.query('EXPLAIN(ANALYZE,FORMAT JSON) ' + query(), ['SYN-PENDING']);
    const plans = (p: any): any[] => [p, ...(p.Plans ?? []).flatMap(plans)];
    const nodes = plans(row['QUERY PLAN'][0].Plan);
    const ancestry = nodes.filter(p => ['lifecycle_base', 'lifecycle_month', 'lifecycle_parent', 'lifecycle_shipping'].includes(p.Alias));
    expect(ancestry.length).toBeGreaterThan(0);
    expect(ancestry.every(p => p['Actual Loops'] === 0)).toBe(true);
    expect(nodes.filter(p => p.Alias === 'lifecycle_schema').every(p => p['Actual Loops'] === 1)).toBe(true);
  });
  it('does not cache absence across a later schema activation and still protects weekly/base/month ancestry', async () => {
    for (const table of ['mps_weekly_plans', 'mps_base_plans', 'mps_monthly_plans']) await db.query(`ALTER TABLE ${table} ADD lifecycle_status text DEFAULT 'ACTIVE'`);
    // Only a small protected fixture is needed once the not-yet-released schema exists.
    await db.query("DELETE FROM mps_weekly_process_plans WHERE weekly_plan_id IN(SELECT id FROM mps_weekly_plans WHERE order_number NOT IN('SYN-1','SYN-2','SYN-3','SYN-4','SYN-5'))");
    await db.query("UPDATE mps_weekly_plans SET lifecycle_status='ON_HOLD' WHERE order_number='SYN-1'");
    await db.query("UPDATE mps_base_plans SET lifecycle_status='CANCELLED' WHERE id IN(SELECT base_plan_id FROM mps_weekly_plans WHERE order_number='SYN-2')");
    await db.query("UPDATE mps_monthly_plans SET lifecycle_status='CANCELLED' WHERE order_number='SYN-3'");
    await db.query("UPDATE mps_weekly_plans SET lifecycle_status='LEGACY_RETAINED' WHERE order_number='SYN-4'");
    expect(await db.query(query(), ['SYN-PENDING'])).toEqual([{ count: 2 }]);
    expect(await db.query(query(), ['OTHER-TENANT'])).toEqual([{ count: 0 }]);
  });
  it('keeps cancellation blocking with a partial schema instead of treating it as absent', async () => {
    await db.query('ALTER TABLE mps_base_plans DROP COLUMN lifecycle_status; ALTER TABLE mps_monthly_plans DROP COLUMN lifecycle_status');
    const rows = await db.query(`SELECT weekly.order_number FROM mps_weekly_plans weekly WHERE weekly.order_number='SYN-1' AND (${weeklyLifecycleExecutableSql('weekly')})`);
    expect(rows).toEqual([]);
  });
});
