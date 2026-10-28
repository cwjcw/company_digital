import * as XLSX from '@e965/xlsx';
import ExcelJS from 'exceljs';
import { logisticsBusinessFields, logisticsFeeKeys, logisticsResource as resource } from '@kdos/contracts';
import { LogisticsImportService } from './logistics-import.service';
import { LogisticsApplicationService, normalizeLogisticsValues } from './logistics.application.service';
import { logisticsAuthorize, logisticsField, logisticsScope, type LogisticsActor } from './logistics.policy';
import { isEncryptedSpreadsheet, ENCRYPTED_SPREADSHEET_MESSAGE } from '../../spreadsheet-upload';
const admin: LogisticsActor = { tenantId: 'KAINAN', userId: '0199aa00-0000-7000-8000-000000000001', permissions: ['*'] };
const directory = { references: jest.fn(async () => ({ customers: [{ code: 'C001' }], members: [{ id: admin.userId, username: 'alice', displayName: '张三', employeeNo: '01' }, { id: '0199aa00-0000-7000-8000-000000000002', username: 'bob', displayName: '张三', employeeNo: '02' }] })) };
const application = { assertAction: (a: LogisticsActor, action: string) => { if (!a.permissions.includes('*') && !a.permissions.includes(`${resource}:*:${action}`)) throw new Error('没有权限'); }, existing: jest.fn(async () => ({ numbers: [] as string[], repeated: false })), importCommands: jest.fn(async () => ({ shipments: 1, details: 2 })) };
const service = new LogisticsImportService(application as unknown as LogisticsApplicationService, directory as never);
function file(rows: Record<string, unknown>[], xls = false, secondHeader = true) {
  const wb = XLSX.utils.book_new();
  const data = [...(secondHeader ? [['装柜资料']] : []), logisticsBusinessFields.map(f => f.label), ...rows.map(row => logisticsBusinessFields.map(f => row[f.key] ?? null))];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), '物流台账');
  return { buffer: XLSX.write(wb, { type: 'buffer', bookType: xls ? 'biff8' : 'xlsx' }), originalname: xls ? 'test.xls' : 'test.xlsx' } as Express.Multer.File;
}
describe('物流台账：模板、归组、关联与权限', () => {
  beforeAll(() => { process.env.JWT_ACCESS_SECRET = 'local-logistics-test-signature-only'; });
  beforeEach(() => { jest.clearAllMocks(); application.existing.mockResolvedValue({ numbers: [], repeated: false }); });
  it('模板严格23列，原17列名称及顺序保留', async () => {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await service.template(admin) as any);
    expect(workbook.worksheets[0]!.getRow(1).values).toEqual([undefined, ...logisticsBusinessFields.map(f => f.label)]);
    expect(logisticsBusinessFields).toHaveLength(23);
    expect(logisticsBusinessFields.slice(0, 17).map(f => f.label)).toEqual(['序号', '款号', '品名', '材质', '数量（PCS）', '装箱量', '净重', '毛重', '柜型', '柜号', '港杂费', '报关费', '报检费', '拖车费', '熏蒸费', '异常费', '备注']);
  });
  it.each([false, true])('读取%s格式，第2行表头、多柜、多款号、多订单、前导零、精确原值、空订单', async xls => {
    const preview = await service.preview(file([
      { logisticsNumber: '0001', styleNumber: 'A', orderNumber: 'SO1', portFee: '1000', customsFee: '0', quantity: '1.23456789', packingQuantity: '12.5', netWeight: '0.10001', grossWeight: '0.2', ownerUserId: 'alice', customerCode: 'C001', shipmentDate: '2026/10/28', totalFee: 99999 },
      { logisticsNumber: '0001', styleNumber: 'B', orderNumber: 'SO2', portFee: '1000.0' },
      { logisticsNumber: '0001', styleNumber: 'C' },
      { logisticsNumber: '0002', styleNumber: 'D' }
    ], xls), admin);
    expect(preview.errors).toEqual([]); expect(preview.shipments).toBe(2); expect(preview.total).toBe(4);
    await service.confirm(preview.token, admin);
    const shipments = (application.importCommands.mock.calls as unknown as any[][])[0]![0] as any;
    expect(shipments[0].master.logisticsNumber).toBe('0001'); expect(shipments[0].master.portFee).toBe('1000'); expect(shipments[0].master.customsFee).toBe('0');
    expect(shipments[0].master.ownerUserId).toBe(admin.userId); expect(shipments[0].master.totalFee).toBeUndefined();
    expect(shipments[0].details).toHaveLength(3); expect(shipments[0].details[0]).toMatchObject({ quantity: '1.23456789', packingQuantity: '12.5', netWeight: '0.10001', grossWeight: '0.2' });
    expect(shipments[0].details[2].orderNumber).toBeNull(); expect(shipments[0].master.shipmentDate).toBe('2026-10-28');
  });
  it('冲突费用、柜号与备注保留原始行和值，不签发可提交token', async () => {
    const result = await service.preview(file([{ logisticsNumber: 'L', styleNumber: 'A', portFee: 100, containerNumber: 'X', remark: '备注1' }, { logisticsNumber: 'L', styleNumber: 'B', portFee: 200, containerNumber: 'Y', remark: '备注2' }]), admin);
    expect(result.token).toBeNull(); expect(result.errors).toHaveLength(3); expect(result.errors.find(e => e.field === '备注')?.values).toEqual([{ row: 3, value: '备注1' }, { row: 4, value: '备注2' }]);
  });
  it('同名用户、无效客户、无效日期、非数字、疑似重复有字段与行号', async () => {
    const result = await service.preview(file([{ logisticsNumber: 'L', styleNumber: 'A', ownerUserId: '张三', customerCode: '不存在', shipmentDate: '2026-02-30', quantity: 'ABC' }, { logisticsNumber: 'L', styleNumber: 'A', quantity: 'ABC' }]), admin);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ row: 3, field: '物流负责人' }), expect.objectContaining({ row: 3, field: '客户' }), expect.objectContaining({ row: 3, field: '出运日期' }), expect.objectContaining({ row: 3, field: '数量（PCS）' }), expect.objectContaining({ row: 4, field: '款号明细' })]));
  });
  it('已存在单号和重复文件明确拒绝，token不能跨用户或篡改', async () => {
    application.existing.mockResolvedValueOnce({ numbers: ['L'], repeated: true });
    const duplicate = await service.preview(file([{ logisticsNumber: 'L', styleNumber: 'A' }]), admin); expect(duplicate.token).toBeNull(); expect(duplicate.errors).toHaveLength(2);
    const ok = await service.preview(file([{ logisticsNumber: 'NEW', styleNumber: 'A' }]), admin);
    await expect(service.confirm(`${ok.token}tampered`, admin)).rejects.toThrow('签名');
    await expect(service.confirm(ok.token, { ...admin, userId: 'other' })).rejects.toThrow('不属于');
    await expect(service.confirm(ok.token, { ...admin, tenantId: 'OTHER' })).rejects.toThrow('不属于');
  });
  it('公式费用合计被忽略，其他无缓存公式/错误值明确提示', async () => {
    const wb = XLSX.read(file([{ logisticsNumber: 'F', styleNumber: 'A', portFee: 1 }]).buffer); const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    sheet.V3 = { t: 'n', f: 'SUM(K3:P3)', v: 999 }; sheet.E3 = { t: 'e', v: 7, w: '#DIV/0!' };
    const result = await service.preview({ buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), originalname: 'f.xlsx' } as Express.Multer.File, admin);
    expect(result.errors.some(e => e.field === '费用合计')).toBe(false); expect(result.errors.some(e => e.field === '数量（PCS）')).toBe(true);
  });
  it('先检测加密；legacy XLS FILEPASS也返回统一提示', async () => {
    await expect(service.preview({ buffer: Buffer.from([0x88, 0x7d, 0x1c]), originalname: 'bad.xlsx' } as Express.Multer.File, admin)).rejects.toThrow(ENCRYPTED_SPREADSHEET_MESSAGE);
    const cfb = XLSX.CFB.utils.cfb_new(); XLSX.CFB.utils.cfb_add(cfb, 'Workbook', Buffer.from([0x09, 0x08, 0x00, 0x00, 0x2f, 0x00, 0x02, 0x00, 0x01, 0x00]));
    const encrypted = XLSX.CFB.write(cfb, { type: 'buffer' }); expect(isEncryptedSpreadsheet(encrypted)).toBe(true);
    await expect(service.preview({ buffer: encrypted, originalname: 'bad.xls' } as Express.Multer.File, admin)).rejects.toThrow(ENCRYPTED_SPREADSHEET_MESSAGE);
  });
  it('只读费用合计不可写，空值/0/原始小数分别保存', () => {
    expect(normalizeLogisticsValues({ logisticsNumber: '0001', portFee: '0', customsFee: null, quantity: '1.00000001' })).toMatchObject({ logisticsNumber: '0001', portFee: '0', customsFee: null, quantity: '1.00000001' });
    expect(() => normalizeLogisticsValues({ logisticsNumber: 'X', totalFee: '1' })).toThrow('不可写');
    expect(() => normalizeLogisticsValues({ logisticsNumber: 123 })).toThrow('文本');
  });
  it('普通用户费用独立授权，合计不可推导；营销管理员继承，Planning管理员无越权', () => {
    const user = { ...admin, permissions: [`${resource}:*:read`, `${resource}:totalFee:read`, `${resource}:portFee:read`] };
    expect(logisticsField(user, 'portFee')).toBe(true); expect(logisticsField(user, 'totalFee')).toBe(false);
    logisticsAuthorize(user); expect(user.permissions).not.toContain(`${resource}:totalFee:read`);
    expect(logisticsField({ ...user, moduleAdminCodes: ['marketing'] }, 'customsFee', 'update')).toBe(true);
    expect(logisticsField({ ...user, moduleAdminCodes: ['planning'] }, 'customsFee')).toBe(false);
    expect(logisticsField(admin, 'totalFee', 'update')).toBe(false);
    expect(logisticsField({ ...user, permissions: [...user.permissions, ...logisticsFeeKeys.map(k => `${resource}:${k}:read`), `${resource}:totalFee:read`] }, 'totalFee')).toBe(true);
  });
  it('共享仅来自有效订单ID关联，export仍是read∩export且无权限费用不能导入', async () => {
    const p: unknown[] = ['KAINAN']; const sql = logisticsScope({ ...admin, permissions: [], moduleAdminCodes: ['planning'], tableDataScopes: [{ resource, scope: 'OWN', actions: ['read', 'export'] }] }, p, 'export');
    expect(sql).toContain("os.status='NORMAL'"); expect(sql).toContain('ANY(os.salesperson_user_ids)'); expect(sql).toContain('record.created_by'); expect(sql).not.toContain('customer_name');
    const result = await service.preview(file([{ logisticsNumber: 'L', portFee: 1 }]), { ...admin, permissions: [`${resource}:*:import`, `${resource}:*:create`, `${resource}:logisticsNumber:update`] });
    expect(result.errors.some(e => e.field === '港杂费')).toBe(true);
  });
});
