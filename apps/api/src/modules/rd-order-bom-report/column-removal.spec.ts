import { DataSource } from 'typeorm';
import { MpsRemoveAllocationCustomerDueDate1722920126000 } from '../../migrations/1722920126000-MpsRemoveAllocationCustomerDueDate';

const migration = new MpsRemoveAllocationCustomerDueDate1722920126000();
describe('allocation-only empty customer date removal', () => {
  it('refuses populated dates before issuing the drop', async () => {
    const query = jest.fn(async (sql: string) => sql.startsWith('SELECT') ? [{ populated: 1 }] : []);
    await expect(migration.up({ query } as never)).rejects.toThrow('contains data');
    expect(query.mock.calls.some(([sql]) => sql.includes('DROP COLUMN'))).toBe(false);
  });
});

const integration = process.env.KDOS_ALLOCATION_COLUMN_REMOVAL_TEST_SOCKET ? describe : describe.skip;
integration('isolated PostgreSQL empty-column removal', () => {
  let db: DataSource;
  beforeAll(async () => {
    const socket = process.env.KDOS_ALLOCATION_COLUMN_REMOVAL_TEST_SOCKET!;
    if (!socket.endsWith('/test/allocation_column_removal/pg_socket')) throw new Error('Only the dedicated isolated socket is allowed');
    db = new DataSource({ type: 'postgres', host: socket, username: 'postgres', database: 'postgres', logging: false });
    await db.initialize();
  });
  afterAll(async () => { await db?.destroy(); });
  beforeEach(async () => {
    await db.query('DROP VIEW IF EXISTS allocation_date_dependency; DROP TABLE IF EXISTS mps_order_allocations; DROP TABLE IF EXISTS mps_monthly_plans; DROP TABLE IF EXISTS audit_logs');
    await db.query(`CREATE TABLE mps_order_allocations(id integer PRIMARY KEY,item_code text,customer_due_date date,version integer);
      INSERT INTO mps_order_allocations VALUES(1,'SYNTHETIC',NULL,7);
      CREATE TABLE mps_monthly_plans(customer_due_date date);
      INSERT INTO mps_monthly_plans VALUES('2026-11-20');
      CREATE TABLE audit_logs(event text); INSERT INTO audit_logs VALUES('retained-synthetic-audit')`);
  });
  async function apply() {
    const runner = db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
    try { await migration.up(runner); await runner.commitTransaction(); }
    catch (e) { await runner.rollbackTransaction(); throw e; }
    finally { await runner.release(); }
  }
  it('removes only the empty allocation date, preserving IDs, versions, other tables and audits', async () => {
    await apply();
    expect(await db.query('SELECT * FROM mps_order_allocations')).toEqual([{ id: 1, item_code: 'SYNTHETIC', version: 7 }]);
    expect((await db.query("SELECT customer_due_date::text d FROM mps_monthly_plans"))[0].d).toBe('2026-11-20');
    expect(await db.query('SELECT * FROM audit_logs')).toEqual([{ event: 'retained-synthetic-audit' }]);
  });
  it('rolls back without losing values when a date has been entered', async () => {
    await db.query("UPDATE mps_order_allocations SET customer_due_date='2026-11-30'");
    await expect(apply()).rejects.toThrow('contains data');
    expect((await db.query('SELECT customer_due_date::text d FROM mps_order_allocations'))[0].d).toBe('2026-11-30');
  });
  it('aborts for an unexpected view dependency instead of cascading', async () => {
    await db.query('CREATE VIEW allocation_date_dependency AS SELECT customer_due_date FROM mps_order_allocations');
    await expect(apply()).rejects.toMatchObject({ code: '2BP01' });
    expect((await db.query('SELECT count(*)::int n FROM allocation_date_dependency'))[0].n).toBe(1);
  });
  it('can restore the empty compatible schema for a controlled application rollback', async () => {
    await apply();
    await migration.down(db.createQueryRunner());
    expect(await db.query('SELECT id,customer_due_date,version FROM mps_order_allocations')).toEqual([{ id: 1, customer_due_date: null, version: 7 }]);
  });
});
