import { matchE10Bom, naturalDayDifference, waitingDays, orderBomStatus, type E10BomBundle } from './rd-order-bom-report.calculator';

const base: E10BomBundle = {
  sourceSnapshotAt: '2026-11-09 12:00:00',
  items: [{ item_id: 'item-1', item_code: 'A' }],
  plants: [{ item_id: 'item-1', owner_org_id: 'org-1', item_property: 'M', item_routing_control: 1 }],
  boms: [{ bom_id: 'bom-1', item_id: 'item-1', owner_org_id: 'org-1', version_times: '1', approve_status: 'Y', approved_at: '2026-11-04 16:00:00', detail_approve_status: 'Y', effective_date: '2026-11-04', expiry_date: null }]
};

describe('R&D order BOM matching and waiting rules', () => {
  it('uses the exact item and unique production organization, never a cross-organization BOM', () => {
    expect(matchE10Bom('A', base, '2026-11-09')).toMatchObject({ status: 'HAS_BOM', approvalDate: '2026-11-04 16:00:00' });
    expect(matchE10Bom('A', { ...base, plants: [{ ...base.plants[0], owner_org_id: 'different' }] }, '2026-11-09').status).toBe('NO_BOM');
    expect(matchE10Bom('A', { ...base, plants: [...base.plants, { ...base.plants[0], owner_org_id: 'org-2' }] }, '2026-11-09').status).toBe('MATCH_ISSUE');
  });
  it('rejects ambiguous item masters and multiple active BOM versions', () => {
    expect(matchE10Bom('A', { ...base, items: [...base.items, { ...base.items[0], item_id: 'item-2' }] }, '2026-11-09').status).toBe('MATCH_ISSUE');
    expect(matchE10Bom('A', { ...base, boms: [...base.boms, { ...base.boms[0], bom_id: 'bom-2' }] }, '2026-11-09').status).toBe('MATCH_ISSUE');
  });
  it('honors approved state, detail validity, expiry and the confirmed no-BOM rule', () => {
    expect(matchE10Bom('A', { ...base, boms: [{ ...base.boms[0], approve_status: 'N' }] }, '2026-11-09').status).toBe('NO_BOM');
    expect(matchE10Bom('A', { ...base, boms: [{ ...base.boms[0], expiry_date: '2026-11-08' }] }, '2026-11-09').status).toBe('NO_BOM');
    expect(matchE10Bom('A', { ...base, plants: [{ ...base.plants[0], item_property: 'P', item_routing_control: 0 }] }, '2026-11-09').status).toBe('NOT_REQUIRED');
    expect(matchE10Bom('A', { ...base, plants: [{ ...base.plants[0], item_property: 'P', item_routing_control: 1 }] }, '2026-11-09')).toMatchObject({ status: 'MATCH_ISSUE', matchIssue: expect.stringContaining('组合') });
    expect(matchE10Bom('A', { ...base, plants: [{ ...base.plants[0], item_property: 'M', item_routing_control: 2 }] }, '2026-11-09').status).toBe('HAS_BOM');
  });
  it('calculates calendar days, clamps reused BOMs to zero and leaves unknown dates blank', () => {
    expect(naturalDayDifference('2026-11-01 10:00:00', '2026-11-04 16:00:00')).toBe(3);
    expect(naturalDayDifference('2026-11-05', '2026-11-04')).toBe(0);
    expect(waitingDays('2026-11-01', '2026-10-01 09:00:00', '2026-11-09', 'HAS_BOM')).toEqual({ bom: 0, current: null });
    expect(waitingDays(null, '2026-11-04', '2026-11-09', 'HAS_BOM')).toEqual({ bom: null, current: null });
    expect(waitingDays('2026-11-01', null, '2026-11-09', 'NO_BOM')).toEqual({ bom: null, current: 8 });
  });
  it('keeps order state pending when a required item has a match issue', () => {
    expect(orderBomStatus([{ bomStatus: 'HAS_BOM' }, { bomStatus: 'MATCH_ISSUE' }])).toBe('待确认');
    expect(orderBomStatus([{ bomStatus: 'NOT_REQUIRED' }])).toBe('无需BOM');
  });
});
