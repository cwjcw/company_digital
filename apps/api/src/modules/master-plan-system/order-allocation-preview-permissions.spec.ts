import ExcelJS from 'exceljs';
import { ENCRYPTED_SPREADSHEET_MESSAGE } from '../../spreadsheet-upload';
import { ALLOCATION_FIELDS } from './order-allocation.domain';
import { MasterPlanSpreadsheetService } from './master-plan-spreadsheet.service';
import type { MasterPlanActor } from './master-plan.types';

const resource = 'mps-order-allocations';
const division = { id: '11111111-1111-4111-8111-111111111111', name: '测试事业部', path: ['测试事业部'], pathLabel: '测试事业部' };
const actor: MasterPlanActor = {
  tenantId: 'SYNTHETIC', userId: '22222222-2222-4222-8222-222222222222', username: 'importer',
  source: 'web', requestId: 'synthetic-import', tableDataScopes: [],
  permissions: [`${resource}:*:import`, `${resource}:*:create`, `${resource}:*:read`,
    ...ALLOCATION_FIELDS.filter(([key]) => key !== 'remark').map(([key]) => `${resource}:${key}:read`)]
};

async function file(extraHeaders: string[] = [], extraValues: unknown[] = []) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('分配').addRows([
    ['订单单号', '品号', '供应商名称', '未分配数量', ...extraHeaders],
    ['SYNTHETIC-ORDER', 'SYNTHETIC-ITEM', '测试供应商', 14, ...extraValues]
  ]);
  return { originalname: 'synthetic.xlsx', buffer: Buffer.from(await book.xlsx.writeBuffer()) } as Express.Multer.File;
}

function setup() {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('SELECT uuidv7()')) return [{ id: '33333333-3333-4333-8333-333333333333' }];
    if (sql.includes('FROM mps_allocation_vendor_mappings')) return [{ supplier_name: '测试供应商', division_id: division.id, enabled: true }];
    if (sql.includes('SELECT EXISTS')) return [{ repeated: false }];
    if (sql.startsWith('INSERT INTO mps_import_previews')) return [{ id: '44444444-4444-4444-8444-444444444444' }];
    return [];
  });
  const db = { transaction: jest.fn(async (work: (manager: unknown) => unknown) => work({ query })) };
  const application = { validateImportUpdates: jest.fn().mockResolvedValue([]) };
  const directory = { listEnabled: jest.fn().mockResolvedValue([division]), resolve: jest.fn().mockReturnValue(division) };
  const service = new MasterPlanSpreadsheetService(db as never, {} as never, application as never, directory as never);
  return { service, db, application, query };
}

describe('allocation preview field permissions', () => {
  it('accepts existing import grants when the an unreadable optional field is absent', async () => {
    const { service, application } = setup();
    const result = await service.preview(resource, await file(), actor);
    expect(result.errors).toEqual([]);
    expect(result).toMatchObject({ total: 1, counts: { created: 1, errors: 0 } });
    expect(application.validateImportUpdates).toHaveBeenCalledWith(resource, [expect.objectContaining({
      values: { orderNumber: 'SYNTHETIC-ORDER', itemCode: 'SYNTHETIC-ITEM', supplierName: '测试供应商', allocatedQuantity: '14', divisionId: division.id }
    })], actor);
    expect(JSON.stringify(result)).not.toContain('remark');
  });

  it('permits a blank unreadable optional column without importing or returning it', async () => {
    const { service } = setup();
    const result = await service.preview(resource, await file(['备注'], ['']), actor);
    expect(result.errors).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('remark');
  });

  it('ignores a removed customer due date column instead of importing it', async () => {
    const { service } = setup();
    const result = await service.preview(resource, await file(['客户交期'], ['2026-11-20']), actor);
    expect(result.errors).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('customerDueDate');
  });

  it('does not require read grants for other absent optional fields', async () => {
    const { service } = setup();
    const restricted = { ...actor, permissions: actor.permissions.filter(p => !p.includes(':remark:') && !p.includes(':specification:')) };
    expect((await service.preview(resource, await file(), restricted)).errors).toEqual([]);
  });

  it.each([['备注', '受限备注', 'remark'], ['品名', '受限品名', 'itemName']])(
    'rejects a populated unreadable %s before database access', async (label, value, key) => {
      const { service, db } = setup();
      const restricted = { ...actor, permissions: actor.permissions.filter(p => !p.includes(`:${key}:`)) };
      await expect(service.preview(resource, await file([label], [value]), restricted)).rejects.toThrow(`导入预览没有字段读取权限：${label}`);
      expect(db.transaction).not.toHaveBeenCalled();
    }
  );

  it('protects the resolved division even when it is not uploaded as a column', async () => {
    const { service, db } = setup();
    const restricted = { ...actor, permissions: actor.permissions.filter(p => !p.includes(':divisionId:')) };
    await expect(service.preview(resource, await file(), restricted)).rejects.toThrow('导入预览没有字段读取权限：承接事业部');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('continues to apply command validation and does not persist invalid previews', async () => {
    const { service, application, query } = setup();
    application.validateImportUpdates.mockResolvedValue([{ row: 2, reason: '当前数据范围不允许新增' }]);
    const result = await service.preview(resource, await file(), actor);
    expect(result.previewId).toBeNull();
    expect(result.errors).toContainEqual({ row: 2, reason: '当前数据范围不允许新增' });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });

  it('retains the import action gate', async () => {
    const { service, db } = setup();
    await expect(service.preview(resource, await file(), { ...actor, permissions: [] })).rejects.toThrow('当前权限组没有该表导入权限');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('checks encryption before parsing or optional-field permission validation', async () => {
    const { service, db } = setup();
    const encrypted = { originalname: 'encrypted.xlsx', buffer: Buffer.from([0x88, 0x7d, 0x1c, 0xd6, 0x56, 0x02]) } as Express.Multer.File;
    await expect(service.preview(resource, encrypted, actor)).rejects.toThrow(ENCRYPTED_SPREADSHEET_MESSAGE);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
