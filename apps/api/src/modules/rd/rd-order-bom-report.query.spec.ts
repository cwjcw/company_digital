import { RdOrderBomReportQueryService } from './rd-order-bom-report.query.service';

describe('R&D order BOM report query source', () => {
  const division = '11111111-1111-4111-8111-111111111111';
  const actor: any = { tenantId: 'tenant-a', userId: 'u1', permissions: [], moduleAdminCodes: ['rd'], isSystemAdmin: false, tableDataScopes: [] };
  const allocations = [
    { id: 'allocation-1', tenantId: 'tenant-a', divisionId: division, divisionName: '事业一部', orderNumber: 'SO-1', itemCode: 'ITEM-1', itemName: '品项', orderDate: '2026-11-01' },
    { id: 'allocation-2', tenantId: 'tenant-a', divisionId: division, divisionName: '事业一部', orderNumber: 'SO-1', itemCode: 'ITEM-1', itemName: '品项', orderDate: '2026-11-01' }
  ];
  const e10 = { read: jest.fn().mockResolvedValue({ sourceSnapshotAt: '2026-11-09', items: [{ item_id: 'i1', item_code: 'ITEM-1' }], plants: [{ item_id: 'i1', owner_org_id: 'org1', item_property: 'M', item_routing_control: 1 }], boms: [{ bom_id: 'b1', item_id: 'i1', owner_org_id: 'org1', version_times: '1', approve_status: 'Y', approved_at: '2026-11-03 10:00:00', detail_approve_status: 'Y', effective_date: '2026-11-03', expiry_date: null }] }) };
  const registry = { register: jest.fn() } as any;
  const dataSource = { transaction: (callback: any) => callback({ query: async (sql: string) => sql.includes('set_config') ? [] : allocations }) } as any;
  const service = new RdOrderBomReportQueryService(dataSource, registry, e10 as any);
  service.onModuleInit();

  beforeEach(() => e10.read.mockClear());

  it('uses only approved, active KDOS allocations and returns the source six fields unchanged', async () => {
    const source = registry.register.mock.calls[0][0];
    const result = await source.listRows({ actor, page: 1, pageSize: 20, search: '', filterGroup: null, context: { view: 'detail' }, fieldKeys: ['divisionId','orderNumber','itemCode','itemName','orderDate','bomStatus','bomApprovalDate','bomWaitingDays','currentWaitingDays'], action: 'read' });
    expect(e10.read).toHaveBeenCalledWith(['ITEM-1','ITEM-1']);
    expect(result.total).toBe(2);
    expect(result.rows[0]).toMatchObject({ orderNumber: 'SO-1', itemCode: 'ITEM-1', itemName: '品项', orderDate: '2026-11-01 00:00:00', bomStatus: 'HAS_BOM' });
    expect(result.rows[0].bomWaitingDays).toBe(2);
  });

  it('preserves distinct detail allocations but deduplicates the same order item in summary', async () => {
    const source = registry.register.mock.calls[0][0];
    const result = await source.listRows({ actor, page: 1, pageSize: 20, search: '', filterGroup: null, context: { view: 'orders' }, fieldKeys: ['divisionId','orderNumber','orderDate','requiredBomItemCount','existingBomItemCount','missingBomItemCount','completionRate','orderBomStatus'], action: 'read' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ requiredBomItemCount: 1, existingBomItemCount: 1, orderBomStatus: '全部完成' });
    expect(result.rows[0].orderDate).toBe('2026-11-01 00:00:00');
    const selected = await source.printRows({ actor, page: 1, pageSize: 20, search: '', context: { view: 'orders' }, ids: [String(result.rows[0].id)], fieldKeys: ['orderNumber'], action: 'export' });
    expect(selected.total).toBe(1);
    const exported = await source.printRows({ actor, page: 1, pageSize: 20, search: '', context: { view: 'detail' }, fieldKeys: ['orderNumber'], action: 'export' });
    expect(exported.total).toBe(2);
  });

  it('uses view-appropriate search and does not lose order summaries when searching an item code', async () => {
    const source = registry.register.mock.calls[0][0];
    const result = await source.listRows({ actor, page: 1, pageSize: 20, search: 'SO-1', context: { view: 'orders' }, fieldKeys: ['orderNumber'], action: 'read' });
    expect(result.total).toBe(1);
    const divisions = await source.listRows({ actor, page: 1, pageSize: 20, search: '事业一部', context: { view: 'divisions' }, fieldKeys: ['divisionId'], action: 'read' });
    expect(divisions.total).toBe(1);
  });

  it('rejects invalid views and reports never read E10 sales order sources', async () => {
    const source = registry.register.mock.calls[0][0];
    await expect(source.listRows({ actor, page: 1, pageSize: 20, search: '', context: { view: 'sales-orders' }, fieldKeys: [], action: 'read' })).rejects.toThrow('视图无效');
    expect(source.table).toBe('mps_order_allocations');
    expect(e10.read).not.toHaveBeenCalled();
  });
});
