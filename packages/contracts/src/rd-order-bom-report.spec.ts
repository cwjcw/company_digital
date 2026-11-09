import { describe, expect, it } from 'vitest';
import { rdOrderBomDetailColumns, rdOrderBomDivisionColumns, rdOrderBomOrderColumns, rdOrderBomReportResource, tableFilterResourceCapabilities, tablePermissionFieldsFor, tablePrintResourceCapabilityOf, tableResourceRegistry } from './index';

describe('R&D order BOM report contract', () => {
  it('registers one read-only R&D resource with shared filtering and export/print support', () => {
    expect(tableResourceRegistry.find(row => row.code === rdOrderBomReportResource)?.moduleCode).toBe('rd');
    expect(tableFilterResourceCapabilities[rdOrderBomReportResource]?.status).toBe('REGISTERED_AND_FILTERABLE');
    expect(tablePrintResourceCapabilityOf(rdOrderBomReportResource).status).toBe('PRINTABLE');
    expect(tablePermissionFieldsFor(rdOrderBomReportResource).some(field => field.editable)).toBe(false);
  });
  it('keeps the formal ten detail columns and separate summary contracts', () => {
    expect(rdOrderBomDetailColumns.map(column => column[0])).toEqual(['divisionId','orderNumber','itemCode','itemName','orderDate','customerDueDate','bomStatus','bomApprovalDate','bomWaitingDays','currentWaitingDays']);
    expect(rdOrderBomOrderColumns.map(column => column[0])).toHaveLength(8);
    expect(rdOrderBomDivisionColumns.map(column => column[0])).toHaveLength(7);
  });
});
