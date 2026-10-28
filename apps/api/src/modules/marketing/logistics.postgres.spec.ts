import { LogisticsQueryService } from "./logistics.query.service";
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import ExcelJS from 'exceljs';
import * as XLSX from '@e965/xlsx';
import { logisticsResource as resource, logisticsBusinessFields } from '@kdos/contracts';
import { AuthGuard } from '../../auth';
import { TableFilterRegistry } from '../../common/filtering/table-filter.registry';
import { TableFilterController } from '../../common/filtering/table-filter.controller';
import { FieldCandidateService } from '../../common/filtering/field-candidate.service';
import { TablePrintService } from '../../common/printing/table-print.service';
import { TableExportController } from '../../common/printing/table-export.controller';
import { TablePrintController } from '../../common/printing/table-print.controller';
import { DataSource } from 'typeorm';
import { OrganizationDirectoryService } from '../organization-directory/organization-directory.service';
import { DrizzleLogisticsRepository } from './drizzle-logistics.repository';
import { LogisticsApplicationService } from './logistics.application.service';
import { LogisticsImportService } from './logistics-import.service';
import { LogisticsDirectoryQueryService } from './logistics-directory.query.service';
import { LogisticsFilterSourceProvider } from './logistics.filter-sources';
import { LogisticsController } from './logistics.controller';
import type { LogisticsActor } from './logistics.policy';
import { randomUUID } from 'node:crypto';
const binary = (res: any, done: (err: Error | null, value?: Buffer) => void) => { const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk))); res.on('end', () => done(null, Buffer.concat(chunks))); res.on('error', done); };
const integration = process.env.KDOS_LOGISTICS_LOCAL_TEST === 'true' ? describe : describe.skip;
const user = '0199aa00-0000-7000-8000-000000000001', salesperson = '0199aa00-0000-7000-8000-000000000002';
const admin = (): LogisticsActor => ({ tenantId: 'KAINAN', userId: user, permissions: ['*'], requestId: 'local-logistics-acceptance' });
/** Only connects to a dedicated throwaway database on loopback. No project .env or production connection. */
integration('物流台账 PostgreSQL + HTTP 隔离验收', () => {
  let root: Pool, pool: Pool, repo: DrizzleLogisticsRepository, application: LogisticsApplicationService, imports: LogisticsImportService, app: INestApplication, registry: TableFilterRegistry;
  let actor = admin();
  const workbook = (rows: Record<string, unknown>[]) => { const b = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet([logisticsBusinessFields.map(f => f.label), ...rows.map(r => logisticsBusinessFields.map(f => r[f.key] ?? null))]), '物流台账'); return XLSX.write(b, { type: 'buffer', bookType: 'xlsx' }); };
  const create = async (number: string, more: Record<string, unknown> = {}) => application.create({ logisticsNumber: number, styleNumber: 'STYLE-A', ...more }, randomUUID(), admin());
  beforeAll(async () => {
    process.env.KDOS_DEFAULT_TENANT_CODE = 'KAINAN'; process.env.JWT_ACCESS_SECRET = 'isolated-test-only';
    const config = { host: '127.0.0.1', port: Number(process.env.KDOS_LOGISTICS_LOCAL_PORT ?? 15439), database: 'kdos_logistics_test' };
    root = new Pool({ ...config, user: 'postgres' });
    if ((await root.query('SELECT current_database() db')).rows[0].db !== 'kdos_logistics_test') throw new Error('Dedicated test database required');
    await root.query("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='logistics_fixture') THEN CREATE ROLE logistics_fixture LOGIN NOSUPERUSER; END IF; END $$; GRANT USAGE ON SCHEMA iam,marketing,audit TO logistics_fixture; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA iam,marketing,audit TO logistics_fixture");
    pool = new Pool({ ...config, user: 'logistics_fixture', max: 5 });
    repo = new DrizzleLogisticsRepository({ pool } as never);
    const directory = new LogisticsDirectoryQueryService({ find: async ({ where }: any) => where.tenantId === 'KAINAN' ? [{ id: user, displayName: '测试负责人', username: 'fixture', enabled: true }, { id: salesperson, displayName: '测试业务员', username: 'sales', enabled: true }] : [] } as never, repo);
    application = new LogisticsApplicationService(repo, directory); imports = new LogisticsImportService(application, directory);
    registry = new TableFilterRegistry(); new LogisticsFilterSourceProvider(registry, repo, directory).onModuleInit();
    const legacy = { query: async () => [] };
    const prints = new TablePrintService(registry, legacy as never, { resolve: async (ids: string[]) => new Map(ids.map(id => [id, '测试用户'])) } as never);
    const module = await Test.createTestingModule({ controllers: [LogisticsController, TableFilterController, TableExportController, TablePrintController], providers: [
      { provide: LogisticsQueryService, useValue: new LogisticsQueryService(repo, registry) }, { provide: LogisticsApplicationService, useValue: application }, { provide: LogisticsImportService, useValue: imports }, { provide: LogisticsDirectoryQueryService, useValue: directory },
      { provide: TableFilterRegistry, useValue: registry }, { provide: FieldCandidateService, useValue: new FieldCandidateService(legacy as never) },
      { provide: DataSource, useValue: legacy }, { provide: OrganizationDirectoryService, useValue: {} }, { provide: TablePrintService, useValue: prints }
    ] }).overrideGuard(AuthGuard).useValue({ canActivate: (context: any) => { context.switchToHttp().getRequest().user = { ...actor, sub: actor.userId }; return true; } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api/v1'); await app.init();
  });
  beforeEach(async () => {
    actor = admin(); await root.query('TRUNCATE marketing.logistics_imports,marketing.logistics_details,marketing.logistics_shipments,marketing.order_schedules,marketing.business_customer_mappings,audit.audit_logs');
    await root.query("INSERT INTO iam.tenants(code,name) VALUES('KAINAN','测试租户'),('OTHER','其他租户') ON CONFLICT(code) DO NOTHING");
    await root.query("INSERT INTO marketing.business_customer_mappings(tenant_id,department,section,customer_code) SELECT id,'测试部门','测试课室','C001' FROM iam.tenants WHERE code='KAINAN'");
  });
  afterAll(async () => { await app?.close(); await pool?.end(); await root?.end(); });
  it('整文件多柜导入，原值保存，费用只存一次、精确合计、重复确认幂等、审计', async () => {
    const data = workbook([{ logisticsNumber: '0001', styleNumber: 'A', orderNumber: 'SO1', portFee: '0.1', customsFee: '0.2', quantity: '12.00000001', packingQuantity: '6.5', netWeight: '0.0001', grossWeight: '0.2', ownerUserId: 'fixture', customerCode: 'C001', shipmentDate: '2026-10-28' }, { logisticsNumber: '0001', styleNumber: 'B', portFee: '0.1', customsFee: '0.2', orderNumber: 'SO2' }, { logisticsNumber: '0002', styleNumber: 'C' }]);
    const preview = await request(app.getHttpServer()).post('/api/v1/marketing/logistics-ledger/import-preview').attach('file', data, 'logistics.xlsx').expect(201);
    expect(preview.body.errors).toEqual([]);
    const [a, b] = await Promise.all([request(app.getHttpServer()).post('/api/v1/marketing/logistics-ledger/import-confirm').send({ token: preview.body.token }), request(app.getHttpServer()).post('/api/v1/marketing/logistics-ledger/import-confirm').send({ token: preview.body.token })]);
    expect(a.status).toBe(201); expect(b.status).toBe(201); expect([a.body.repeated, b.body.repeated].sort()).toEqual([false, true]);
    const { rows } = await root.query('SELECT logistics_number,port_fee,total_fee FROM marketing.logistics_shipments ORDER BY logistics_number');
    expect(rows).toEqual([{ logistics_number: '0001', port_fee: '0.1', total_fee: '0.3' }, { logistics_number: '0002', port_fee: null, total_fee: null }]);
    const d = (await root.query("SELECT * FROM marketing.logistics_details WHERE style_number='A'")).rows[0]; expect(d).toMatchObject({ quantity: '12.00000001', packing_quantity: '6.5', net_weight: '0.0001', gross_weight: '0.2', order_number: 'SO1' });
    expect((await root.query('SELECT count(*)::int n FROM audit.audit_logs')).rows[0].n).toBe(2);
    const again = await imports.preview({ buffer: data, originalname: 'again.xlsx' } as Express.Multer.File, admin()); expect(again.token).toBeNull();
  });
  it('网页新增→查询→编辑→刷新，费用合计更新，乐观锁和重复点击保护', async () => {
    const body = { commandKey: randomUUID(), values: { logisticsNumber: 'WEB-001', styleNumber: 'A', portFee: '0', customsFee: '0.2' } };
    const [a, b] = await Promise.all([request(app.getHttpServer()).post('/api/v1/marketing/logistics-ledger').send(body), request(app.getHttpServer()).post('/api/v1/marketing/logistics-ledger').send(body)]);
    expect(a.status).toBe(201); expect(b.status).toBe(201); expect((await root.query('SELECT count(*)::int n FROM marketing.logistics_shipments')).rows[0].n).toBe(1);
    const id = a.body.id;
    await request(app.getHttpServer()).patch(`/api/v1/marketing/logistics-ledger/${id}`).send({ expectedVersion: 1, values: { portFee: '0.1', orderNumber: 'SO-WEB' } }).expect(200);
    const listing = await request(app.getHttpServer()).get('/api/v1/table-filters/rows').query({ resource }).expect(200);
    expect(listing.body.rows[0]).toMatchObject({ id, totalFee: '0.3', orderNumber: 'SO-WEB', orderNumbers: 'SO-WEB', version: 2 });
    await request(app.getHttpServer()).patch(`/api/v1/marketing/logistics-ledger/${id}`).send({ expectedVersion: 1, values: { portFee: '9' } }).expect(409);
    await request(app.getHttpServer()).patch(`/api/v1/marketing/logistics-ledger/${id}`).send({ expectedVersion: 2, values: { totalFee: '99' } }).expect(400);
  });
  it('批量事务冲突不部分保存，同柜增加与批量删除使用同一主版本', async () => {
    const a = await create('EXISTING');
    await expect(application.importCommands([{ master: { logisticsNumber: 'NEW' }, details: [{ styleNumber: 'A' }] }, { master: { logisticsNumber: 'EXISTING' }, details: [{ styleNumber: 'B' }] }], randomUUID(), 'new-file-hash', admin())).rejects.toThrow('已存在');
    expect((await root.query("SELECT count(*)::int n FROM marketing.logistics_shipments WHERE logistics_number='NEW'")).rows[0].n).toBe(0);
    const b = await application.update(a.id!, { styleNumber: 'B' }, 1, admin(), true);
    await application.delete([{ id: a.id!, expectedVersion: 2 }, { id: b.id, expectedVersion: 2 }], admin());
    expect((await root.query('SELECT count(*)::int n FROM marketing.logistics_shipments')).rows[0].n).toBe(0);
  });
  it('业务员可看关联整柜所有款号订单，无费用；无关联/无操作权限/跨租户不可访问', async () => {
    const a = await create('SHARED', { orderNumber: 'SO-SHARED', portFee: '100' }); await application.update(a.id!, { styleNumber: 'B', orderNumber: 'SO-OTHER' }, 1, admin(), true);
    await create('PRIVATE', { portFee: '200' });
    await root.query("INSERT INTO marketing.order_schedules(tenant_id,customer_code,order_number,item_number,item_name,salesperson_user_ids) SELECT id,'C001','SO-SHARED','A','A',ARRAY[$1::uuid] FROM iam.tenants WHERE code='KAINAN'", [salesperson]);
    actor = { tenantId: 'KAINAN', userId: salesperson, permissions: [`${resource}:*:read`, ...['logisticsNumber', 'styleNumber', 'orderNumber', 'orderNumbers', 'totalFee'].map(k => `${resource}:${k}:read`)], tableDataScopes: [{ resource, scope: 'OWN', actions: ['read'] }] };
    const result = await request(app.getHttpServer()).get('/api/v1/table-filters/rows').query({ resource }).expect(200);
    expect(result.body.total).toBe(2); expect(result.body.rows.map((r: any) => r.orderNumber).sort()).toEqual(['SO-OTHER', 'SO-SHARED']);
    expect(result.body.rows.every((r: any) => !('portFee' in r) && !('totalFee' in r))).toBe(true);
    await request(app.getHttpServer()).get('/api/v1/table-filters/rows').query({ resource, sortField: 'totalFee' }).expect(403);
    await request(app.getHttpServer()).get('/api/v1/table-filters/rows').query({ resource, filterGroup: JSON.stringify({ logic: 'AND', rules: [{ field: 'portFee', operator: 'gt', value: '1' }] }) }).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/table-exports/${resource}`).buffer(true).parse(binary).expect(403);
    await request(app.getHttpServer()).post('/api/v1/marketing/logistics-ledger').send({ commandKey: randomUUID(), values: { logisticsNumber: 'DENIED' } }).expect(403);
    const other = await repo.query('SELECT count(*)::int n FROM marketing.logistics_ledger_rows WHERE $1::text IS NOT NULL', ['OTHER']); expect(other[0]!.n).toBe(0);
    await expect(application.update(a.id!, { remark: 'OTHER' }, 2, { ...admin(), tenantId: 'OTHER' })).rejects.toThrow('不存在');
  });
  it('费用字段/数据范围保护适用于export/print/筛选；营销模块管理员继承权限', async () => {
    await create('COST', { portFee: '123.45' });
    actor = { tenantId: 'KAINAN', userId: user, permissions: [], moduleAdminCodes: ['marketing'] };
    // AuthGuard normally expands module action grants; the API field rules also recognize module admins.
    actor.permissions = [`${resource}:*:read`];
    const list = await request(app.getHttpServer()).get('/api/v1/table-filters/rows').query({ resource }).expect(200); expect(list.body.rows[0].portFee).toBe('123.45');
    actor = { tenantId: 'KAINAN', userId: user, permissions: [`${resource}:*:read`, `${resource}:*:export`, `${resource}:*:batch_print`, `${resource}:*:update`, `${resource}:logisticsNumber:read`, `${resource}:totalFee:read`], tableDataScopes: [{ resource, scope: 'ALL', actions: ['read', 'export', 'update'] }] };
    const response = await request(app.getHttpServer()).get(`/api/v1/table-exports/${resource}`).buffer(true).parse(binary).expect(200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(response.body as any); expect(wb.worksheets[0]!.getRow(1).values).toEqual([undefined, '物流单号']);
    const summary = await request(app.getHttpServer()).get('/api/v1/marketing/logistics-ledger/summary').expect(200); expect(summary.body.fees).toEqual({});
    const manifest = await request(app.getHttpServer()).get('/api/v1/table-prints/manifest').query({ resource, rangeType: 'FILTERED' }).expect(200); expect(manifest.body.columns.some((c: any) => c.key === 'totalFee')).toBe(false);
    await request(app.getHttpServer()).patch(`/api/v1/marketing/logistics-ledger/${list.body.rows[0].id}`).send({ expectedVersion: 1, values: { portFee: '5' } }).expect(403);
  });
  it('统一导出全部匹配记录且同柜费用只列一次；重导明确重复；筛选/排序/分页同源', async () => {
    const a = await create('EX-001', { portFee: '100', customsFee: '0', ownerUserId: user, customerCode: 'C001' }); await application.update(a.id!, { styleNumber: 'B', orderNumber: 'SO2' }, 1, admin(), true); await create('EX-002', { portFee: '200' });
    const totals = await request(app.getHttpServer()).get('/api/v1/marketing/logistics-ledger/summary').query({search:'EX-001'}).expect(200); expect(totals.body).toMatchObject({containers:1,fees:{portFee:'100',totalFee:'100'}});
    const exportBuffer = (await request(app.getHttpServer()).get(`/api/v1/table-exports/${resource}`).buffer(true).parse(binary).query({ search: 'EX-001', columnKeys: logisticsBusinessFields.map(f => f.key).join(',') }).expect(200)).body;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(exportBuffer as any); const sheet = wb.worksheets[0]!;
    expect(sheet.rowCount).toBe(3); expect(sheet.getRow(1).values).toEqual([undefined, ...logisticsBusinessFields.map(f => f.label)]);
    expect([sheet.getCell('K2').text, sheet.getCell('K3').text].sort()).toEqual(['', '100']); expect([sheet.getCell('V2').text, sheet.getCell('V3').text].sort()).toEqual(['', '100']);
    expect(sheet.getCell('T2').text).toBe('测试负责人 (fixture)');
    expect((await imports.preview({ buffer: exportBuffer, originalname: 'export.xlsx' } as Express.Multer.File, admin())).errors.some(e => e.field === '物流单号')).toBe(true);
    const list = await request(app.getHttpServer()).get('/api/v1/table-filters/rows').query({ resource, page: 1, pageSize: 50, sortField: 'logisticsNumber', sortOrder: 'desc', filterGroup: JSON.stringify({ logic: 'AND', rules: [{ field: 'logisticsNumber', operator: 'eq', value: 'EX-001' }] }) }).expect(200); expect(list.body.total).toBe(2);
    const candidates = await request(app.getHttpServer()).get('/api/v1/table-filters/candidates').query({ resource, field: 'ownerUserId', search: '测试负责人' }).expect(200); expect(candidates.body).toEqual([{ value: user, label: '测试负责人 (fixture)' }]);
    const customers = await request(app.getHttpServer()).get('/api/v1/table-filters/candidates').query({resource,field:'customerCode',search:'C001'}).expect(200); expect(customers.body).toEqual([{value:'C001',label:'C001'}]);
  });
  it('read∩export范围不能通过共享或宽export绕过', async () => {
    await create('ALLOW'); await create('HIDDEN');
    actor = { tenantId: 'KAINAN', userId: user, permissions: [`${resource}:*:read`, `${resource}:*:export`, `${resource}:logisticsNumber:read`], tableDataScopes: [{ resource, scope: 'CUSTOM', actions: ['read'], rules: [{ fieldKey: 'logisticsNumber', operator: 'EQ', value: 'ALLOW' }] }, { resource, scope: 'ALL', actions: ['export'] }] };
    const res = await request(app.getHttpServer()).get(`/api/v1/table-exports/${resource}`).buffer(true).parse(binary).expect(200); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.body as any); expect(wb.worksheets[0]!.rowCount).toBe(2); expect(wb.worksheets[0]!.getCell('A2').text).toBe('ALLOW');
  });
});
