import { describe, expect, it } from 'vitest';
import { rdOrderBomDetailColumns, rdOrderBomDivisionColumns, rdOrderBomOrderColumns, rdOrderBomReportResource, tableFilterResourceCapabilities, tablePermissionFieldsFor, tablePrintResourceCapabilityOf, tableResourceRegistry } from './index';

describe('R&D order BOM report contract', () => {
  it('registers one read-only R&D resource with shared filtering and export/print support', () => {
    expect(tableResourceRegistry.find(row => row.code === rdOrderBomReportResource)?.moduleCode).toBe('rd');
    expect(tableFilterResourceCapabilities[rdOrderBomReportResource]?.status).toBe('REGISTERED_AND_FILTERABLE');
    expect(tablePrintResourceCapabilityOf(rdOrderBomReportResource).status).toBe('PRINTABLE');
    expect(tablePermissionFieldsFor(rdOrderBomReportResource).some(field => field.editable)).toBe(false);
  });
  it('keeps ten detail columns and separate summary contracts with allocation due date', () => {
    expect(rdOrderBomDetailColumns.map(column => column[0])).toEqual(['divisionId','orderNumber','itemCode','itemName','orderDate','customerDueDate','bomStatus','bomApprovalDate','bomWaitingDays','currentWaitingDays']);
    expect(rdOrderBomOrderColumns.map(column => column[0])).toHaveLength(9);
    expect(rdOrderBomDivisionColumns.map(column => column[0])).toHaveLength(8);
    expect(tablePermissionFieldsFor('mps-order-allocations').map(field => field.key)).not.toContain('customerDueDate');
    expect(tablePermissionFieldsFor(rdOrderBomReportResource).map(field => field.key)).toContain('customerDueDate');
    expect(tablePermissionFieldsFor(rdOrderBomReportResource).find(field=>field.key==='bomStatus')?.options?.map(option=>option.value)).toEqual(['HAS_BOM','NO_BOM','']);
  });
});
