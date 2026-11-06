import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { financeDashboardRequiredFields } from '@kdos/contracts';
import { AuthGuard } from '../../auth';
import { TableFilterRegistry, type TableFilterActor } from '../../common/filtering/table-filter.registry';
import { FinanceOrdersController } from './finance-orders.controller';
import { FinanceOrdersApplicationService } from './finance-orders.application.service';
import { FinanceOrdersQueryService } from './finance-orders.query.service';
import { FinanceRepository } from './finance.repository';

const integration = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET ? describe : describe.skip;
const tenant = 'FINANCE-R4-SYNTHETIC', user = '0199d000-0000-7000-8000-000000000001';
const baseActor = { tenantId: tenant, userId: user, permissions: ['*'], isSystemAdmin: true };
const dashboardFields = financeDashboardRequiredFields.map(f => `finance-e10-dashboard:${f.key}:read`);
const employee: TableFilterActor = {
  tenantId: tenant, userId: user,
  permissions: ['finance-e10-dashboard:*:read', ...dashboardFields, 'finance-e10-dashboard:orderDate:read',
    'finance-e10-ranking:*:read', 'finance-e10-ranking:customerCode:read', 'finance-e10-ranking:orderTotal:read'],
  tableDataScopes: ['finance-e10-dashboard', 'finance-e10-ranking'].map(resource => ({
    resource, scope: 'CUSTOM' as const, rules: [{ fieldKey: 'customerCode', operator: 'EQ' as const, value: 'SYN-A' }]
  }))
};

/** Actual controller + SQL on an isolated synthetic relation; no ERP/ETL or production DSN. */
integration('finance month protocol: real HTTP and isolated PostgreSQL', () => {
  let db: DataSource, app: INestApplication;
  const database = 'finance_protocol_round4_test';
  const post = (endpoint: string, context: Record<string, unknown>, actor = 'admin') => request(app.getHttpServer())
    .post(`/finance/e10-orders/${endpoint}`).set('x-synthetic-actor', actor)
    .send(endpoint === 'ranking' ? { context, page: 1, pageSize: 20 } : { context });
  const dashboard = (context: Record<string, unknown>, actor = 'admin') => post('dashboard', context, actor);
  beforeAll(async () => {
    const socket = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET!;
    if (!socket.endsWith('/test/mps_sync_reliability/pg_socket')) throw Error('Dedicated network-none test socket only');
    const options = { type: 'postgres' as const, host: socket, username: 'postgres', entities: [], logging: false as const };
    const control = new DataSource({ ...options, database: 'postgres' });
    await control.initialize();
    try {
      await control.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await control.query(`CREATE DATABASE ${database}`);
    } finally { await control.destroy(); }
    db = new DataSource({ ...options, database }); await db.initialize();
    await db.query(`CREATE TABLE finance_e10_order_monthly_movements(
      tenant_id text,source_database text,source_order_id uuid,customer_code text,order_total numeric,
      department_category text,sales_channel text,year_month text,delivery_date_conflict boolean DEFAULT false,
      created_by uuid,order_date date,salespeople jsonb DEFAULT '[]')`);
    const rows = [
      [tenant, '2025-12', 'SYN-A', '10.00', 1, '2025-10-15'],
      [tenant, '2026-01', 'SYN-A', '100.00', 2, '2025-10-15'],
      [tenant, '2026-03', 'SYN-B', '200.00', 3, '2026-02-01'],
      [tenant, '2026-11', 'SYN-A', '-20.00', 2, '2025-10-15'],
      [tenant, '2026-12', 'SYN-C', '30.00', 4, '2026-12-01'],
      [tenant, '2027-01', 'SYN-A', '40.00', 5, '2026-12-01'],
      [tenant, '2026-01', 'SYN-ZERO', '0.00', 6, '2026-01-01'],
      ['OTHER-SYNTHETIC', '2026-01', 'SYN-A', '99999.00', 7, '2025-10-15']
    ];
    for (const [who, month, customer, amount, order, date] of rows) await db.query(`INSERT INTO finance_e10_order_monthly_movements
      (tenant_id,source_database,source_order_id,customer_code,order_total,year_month,created_by,order_date,department_category,sales_channel)
      VALUES($1,'SYNTHETIC',$2,$3,$4,$5,$6,$7,$8,$9)`,
    [who, `0199d000-0000-7000-8000-${String(order).padStart(12, '0')}`, customer, amount, month, user, date,
      customer === 'SYN-B' ? '业务二部' : customer === 'SYN-C' ? null : '业务一部', customer === 'SYN-B' ? '外销' : '内销']);
    const queries = new FinanceOrdersQueryService(new FinanceRepository(db), new TableFilterRegistry());
    const module = await Test.createTestingModule({ controllers: [FinanceOrdersController], providers: [
      { provide: FinanceOrdersQueryService, useValue: queries }, { provide: FinanceOrdersApplicationService, useValue: {} }
    ] }).overrideGuard(AuthGuard).useValue({ canActivate: (ctx: any) => {
      const req = ctx.switchToHttp().getRequest(); const mode = req.headers['x-synthetic-actor'];
      const actor = mode === 'employee' ? employee : mode === 'no-fields' ? { ...employee, permissions: ['finance-e10-dashboard:*:read'] }
        : mode === 'no-scope' ? { ...employee, tableDataScopes: [] }
          : mode === 'no-order-date' ? { ...employee, permissions: employee.permissions.filter(p => p !== 'finance-e10-dashboard:orderDate:read') }
            : mode === 'other-tenant' ? { ...baseActor, tenantId: 'EMPTY-SYNTHETIC' } : baseActor;
      // Test-only synthetic authentication; actual permission checks remain in the Query Service.
      req.user = { ...actor, sub: user }; return true;
    } }).compile();
    // The real controller derives tenant from the deployed environment, not client JSON.
    app = module.createNestApplication(); await app.init();
  }, 30000);
  const originalTenant = process.env.KDOS_DEFAULT_TENANT_CODE;
  beforeEach(() => { process.env.KDOS_DEFAULT_TENANT_CODE = tenant; });
  afterAll(async () => {
    if (originalTenant === undefined) delete process.env.KDOS_DEFAULT_TENANT_CODE; else process.env.KDOS_DEFAULT_TENANT_CODE = originalTenant;
    if (app) await app.close(); if (db?.isInitialized) await db.destroy();
  });

  it('accepts Jan–Nov, fills missing months with zero and reconciles amounts/ranking/categories', async () => {
    const context = { monthFrom: '2026-01', monthTo: '2026-11' };
    const d = await dashboard(context).expect(201), r = await post('ranking', context).expect(201);
    expect(d.body.totals.amount).toBe('280.00'); expect(d.body.months).toHaveLength(11);
    expect(d.body.months[1]).toEqual({ month: '2026-02', amount: '0.00', wan: '0.000000' });
    expect(d.body.months.at(-1)).toMatchObject({ month: '2026-11', amount: '-20.00' });
    expect(r.body.rows.map((v: any) => [v.customerCode, v.orderTotal])).toEqual([['SYN-B', '200.00'], ['SYN-A', '80.00'], ['SYN-ZERO', '0.00']]);
    for (const group of [d.body.channels, d.body.departments, d.body.months, d.body.matrix])
      expect(group.reduce((sum: number, v: any) => sum + Number(v.amount), 0)).toBe(280);
  });
  it.each([
    [{ monthFrom: '2026-11' }, '50.00', ['2026-11', '2026-12', '2027-01']],
    [{ monthTo: '2026-02' }, '110.00', ['2025-12', '2026-01', '2026-02']],
    [{}, '360.00', ['2025-12', '2026-01', '2026-03', '2026-11', '2026-12', '2027-01']],
    [{ monthFrom: '2025-12', monthTo: '2026-02' }, '110.00', ['2025-12', '2026-01', '2026-02']],
    [{ year: 2026, month: 11 }, '-20.00', ['2026-11']],
    [{ dateFrom: '2026-01-01', dateTo: '2026-03-31' }, '300.00', ['2026-01', '2026-02', '2026-03']]
  ])('preserves production range/legacy calendar semantics for %j', async (context, amount, months) => {
    const d = await dashboard(context).expect(201); expect(d.body.totals.amount).toBe(amount);
    expect(d.body.months.map((v: any) => v.month)).toEqual(months);
  });
  it('retains the full legacy year calendar and zero months', async () => {
    const d = await dashboard({ year: 2026 }).expect(201); expect(d.body.months).toHaveLength(12);
    expect(d.body.totals.amount).toBe('310.00'); expect(d.body.months[1].amount).toBe('0.00');
  });
  it('intersects order-date and occurrence bounds for dashboard and ranking', async () => {
    const context = { monthFrom: '2026-01', monthTo: '2026-11', orderDateFrom: '2025-10-01', orderDateTo: '2025-10-31' };
    const d = await dashboard(context).expect(201), r = await post('ranking', context).expect(201);
    expect(d.body.totals.amount).toBe('80.00'); expect(r.body.rows).toHaveLength(1); expect(r.body.rows[0].orderTotal).toBe('80.00');
  });
  it.each([
    { monthFrom: '2026-11', monthTo: '2026-01' }, { monthFrom: '2026-13' }, { monthTo: '2026-1' },
    { monthFrom: '2024-12' }, { monthFrom: "2026-01' OR TRUE" }, { year: 2026, monthFrom: '2026-01' }
  ])('rejects invalid/reversed or ambiguous range %j with business400', async context => {
    const d = await dashboard(context).expect(400); expect(d.body.message).toMatch(/发生月份/);
    await post('ranking', context).expect(400);
  });
  it('enforces ordinary employee custom data scopes in both dashboard and ranking', async () => {
    const context = { monthFrom: '2026-01', monthTo: '2026-11' };
    const d = await dashboard(context, 'employee').expect(201), r = await post('ranking', context, 'employee').expect(201);
    expect(d.body.totals.amount).toBe('80.00'); expect(r.body.rows.map((v: any) => v.customerCode)).toEqual(['SYN-A']);
    expect((await dashboard(context, 'no-scope').expect(201)).body.totals.amount).toBe('0');
  });
  it('denies hidden aggregate and order-date fields', async () => {
    await dashboard({}, 'no-fields').expect(403);
    await dashboard({ monthFrom: '2026-01', orderDateFrom: '2025-01-01' }, 'no-order-date').expect(403);
  });
  it('uses authenticated environment tenant and never includes other tenant amounts', async () => {
    process.env.KDOS_DEFAULT_TENANT_CODE = 'EMPTY-SYNTHETIC';
    const d = await dashboard({}).expect(201); expect(d.body.totals.amount).toBe('0'); expect(d.body.months).toEqual([]);
  });
  it('does not accept a client-selected tenant or unexpected context fields', async () => {
    await dashboard({ tenantId: 'OTHER-SYNTHETIC' }).expect(400);
  });
});
