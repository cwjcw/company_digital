import { allocationBomDecision as decide, allocationBomWaiting as wait, type AllocationBomState } from './rd-allocation-bom-state';
const base:AllocationBomState={initial_capture_eligible:true,initial_bom_status:null,current_bom_status:null,allocation_date:'2026-11-20',locked_waiting_days:null};
describe('Allocation BOM observation decisions',()=>{
  it('new first Y locks zero even if its ERP approval or observation is later',()=>expect(decide(base,'Y','2026-11-25',99)).toMatchObject({initial:true,completion:true,locked:0}));
  it('new first N is captured once and remains dynamic',()=>{
    expect(decide(base,'N','2026-11-20',99)).toMatchObject({initial:true,completion:false,locked:null});
    for(const [day,n] of [['2026-11-20',0],['2026-11-21',1],['2026-11-25',5]] as const)expect(wait({...base,current_bom_status:'N'},day)).toBe(n);
  });
  it('N to Y locks actual confirmation day and preserves initial N',()=>expect(decide({...base,initial_bom_status:'N',current_bom_status:'N'},'Y','2026-11-24',99)).toMatchObject({initial:false,changed:true,completion:true,locked:4}));
  it('continuous Y never changes lock or creates repeated history',()=>{
    for(const day of ['2026-11-25','2026-11-30'])expect(decide({...base,initial_bom_status:'N',current_bom_status:'Y',locked_waiting_days:4},'Y',day,999)).toMatchObject({initial:false,completion:false,event:null,locked:4});
  });
  it('Y to N retains lock for history but displays original allocation to today',()=>{
    const s={...base,initial_bom_status:'Y' as const,current_bom_status:'Y' as const,locked_waiting_days:4};
    expect(decide(s,'N','2026-11-26',null)).toMatchObject({completion:false,locked:4,changed:true});
    expect(wait({...s,current_bom_status:'N'},'2026-11-26')).toBe(6);
    expect(decide({...s,current_bom_status:'N'},'Y','2026-11-28',null)).toMatchObject({completion:true,locked:8,initial:false});
  });
  it.each(['Y','N'] as const)('historical baseline %s never initializes initial or fabricates completion',status=>{
    expect(decide({...base,initial_capture_eligible:false},status,'2026-11-25',null)).toMatchObject({initial:false,completion:false,locked:null,event:'HISTORICAL_BASELINE'});
  });
  it('historical reliable legacy value survives with no fake completion',()=>expect(decide({...base,initial_capture_eligible:false},'Y','2026-11-25',7)).toMatchObject({completion:false,locked:7}));
  it('unknown dates stay null, and future allocation dates clamp at zero',()=>{
    expect(wait({...base,current_bom_status:'N',allocation_date:null},'2026-11-25')).toBeNull();
    expect(wait({...base,current_bom_status:'N'},'2026-11-19')).toBe(0);
    expect(wait({...base,current_bom_status:'Y'},'2026-11-25')).toBeNull();
  });
});
