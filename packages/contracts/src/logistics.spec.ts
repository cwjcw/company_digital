import { describe, expect, it } from 'vitest';
import { logisticsBusinessFields, logisticsFields, logisticsFeeKeys, logisticsResource, tableResourceRegistry, tablePermissionFieldsFor, tableFilterResourceCapabilities, tablePrintResourceCapabilityOf } from './index';
describe('物流台账正式合同', () => {
  it('注册到营销中心和现有筛选/打印/字段权限体系', () => {
    expect(tableResourceRegistry.find(r => r.code === logisticsResource)?.moduleCode).toBe('marketing');
    expect(tablePermissionFieldsFor(logisticsResource)).toEqual(logisticsFields);
    expect(tableFilterResourceCapabilities[logisticsResource]?.status).toBe('REGISTERED_AND_FILTERABLE');
    expect(tablePrintResourceCapabilityOf(logisticsResource).status).toBe('PRINTABLE');
  });
  it('23列按原17+6顺序，物流单号文本必填，用户/客户/日期类型正确', () => {
    expect(logisticsBusinessFields).toHaveLength(23);
    expect(logisticsBusinessFields.slice(17).map(f => f.label)).toEqual(['物流单号', '客户', '物流负责人', '出运日期', '费用合计', '订单号']);
    expect(logisticsBusinessFields.find(f => f.key === 'logisticsNumber')).toMatchObject({ type: 'text', required: true });
    for (const [key, type] of [['ownerUserId', 'member'], ['customerCode', 'reference'], ['shipmentDate', 'date']]) expect(logisticsFields.find(f => f.key === key)?.type).toBe(type);
    expect(logisticsFields.find(f => f.key === 'orderNumber')?.required).not.toBe(true);
  });
  it('六项费用可授权编辑，费用合计始终只读且精确数值，审计不入业务模板', () => {
    for (const key of logisticsFeeKeys) expect(logisticsFields.find(f => f.key === key)).toMatchObject({ type: 'number', exactNumeric: true, editable: true });
    expect(logisticsFields.find(f => f.key === 'totalFee')).toMatchObject({ editable: false, exactNumeric: true });
    expect(logisticsBusinessFields.some(f => f.key === 'createdBy')).toBe(false);
  });
});
