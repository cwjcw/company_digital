import { dateOnly, matchE10Bom, naturalDayDifference, orderBomStatus, reliableApprovalDate, waitingDays, type E10BomBundle, type LocalBomHead } from './rd-order-bom-report.calculator';

const itemId='11111111-1111-4111-8111-111111111111';
const bomId='22222222-2222-4222-8222-222222222222';
const items: E10BomBundle={sourceSnapshotAt:'2026-11-10 01:00:00',items:[{item_id:itemId,item_code:'WHK472-1/1',item_name:'样件'}]};
const approved: LocalBomHead={bom_id:bomId,item_id:itemId,item_code:'WHK472-1/1',version_times:'1',approve_status:'Y',approved_at:'2026-01-31 19:32:12.552702'};

describe('R&D BOM report final matching and aggregation rules',()=>{
  it('preserves the E10 1900-01-01 value in the BOM-scoped date parser',()=>{
    expect(dateOnly('1900-01-01T00:00:00')).toBe('1900-01-01');
    expect(reliableApprovalDate('1900-01-01')).toBeNull();
    expect(reliableApprovalDate('2026-01-31 19:32:12.552702')).toBe('2026-01-31 19:32:12.552702');
  });
  it('matches WHK472-1/1 by ITEM identity and approved BOM head, without BOM_D or organization filters',()=>{
    expect(matchE10Bom('WHK472-1/1',items,[approved])).toEqual({status:'HAS_BOM',approvalDate:'2026-01-31 19:32:12.552702'});
    expect(matchE10Bom('WHK472-1/1',items,[{...approved,bom_id:'33333333-3333-4333-8333-333333333333',owner_org_id:'elsewhere'} as LocalBomHead])).toMatchObject({status:'HAS_BOM'});
  });
  it('matches E10 uppercase UUIDs to PostgreSQL lowercase UUIDs',()=>{
    const upperId='AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
    const lowerId=upperId.toLowerCase();
    const snapshot={...items,items:[{...items.items[0],item_id:upperId}]};
    expect(matchE10Bom('WHK472-1/1',snapshot,[{...approved,item_id:lowerId}])).toMatchObject({status:'HAS_BOM'});
  });
  it('returns empty for missing ITEM, NO_BOM for existing ITEM with no approved header',()=>{
    expect(matchE10Bom('NOT-IN-E10',{...items,items:[]},[])).toEqual({status:null,approvalDate:null});
    expect(matchE10Bom('WHK472-1/1',items,[])).toEqual({status:'NO_BOM',approvalDate:null});
    expect(matchE10Bom('WHK472-1/1',items,[{...approved,approve_status:'N'}])).toEqual({status:'NO_BOM',approvalDate:null});
  });
  it('uses the earliest reliable date across multiple approved BOMs and leaves sentinel dates unknown',()=>{
    expect(matchE10Bom('WHK472-1/1',items,[approved,{...approved,bom_id:'33333333-3333-4333-8333-333333333333',approved_at:'2025-12-31'}]).approvalDate).toBe('2025-12-31 00:00:00');
    expect(matchE10Bom('WHK472-1/1',items,[{...approved,approved_at:'1900-01-01'}])).toEqual({status:'HAS_BOM',approvalDate:null});
  });
  it('calculates waiting days with calendar dates and keeps null status blank',()=>{
    expect(naturalDayDifference('2026-01-30 23:59:00','2026-01-31 00:01:00')).toBe(1);
    expect(naturalDayDifference('2026-02-01','2026-01-31')).toBe(0);
    expect(waitingDays('2026-02-01','2026-01-31','2026-11-10','HAS_BOM')).toEqual({bom:0,current:null});
    expect(waitingDays('2026-11-01',null,'2026-11-10','NO_BOM')).toEqual({bom:null,current:9});
    expect(waitingDays('2026-11-01',null,'2026-11-10',null)).toEqual({bom:null,current:null});
    expect(waitingDays(null,'2026-01-31','2026-11-10','HAS_BOM')).toEqual({bom:null,current:null});
  });
  it('does not claim order completion when any item is missing or unmatched',()=>{
    expect(orderBomStatus([{bomStatus:'HAS_BOM'}])).toBe('全部完成');
    expect(orderBomStatus([{bomStatus:'HAS_BOM'},{bomStatus:'NO_BOM'}])).toBe('未全部完成');
    expect(orderBomStatus([{bomStatus:'HAS_BOM'},{bomStatus:null}])).toBe('待核实');
    expect(orderBomStatus([{bomStatus:null},{bomStatus:null}])).toBeNull();
  });
});
