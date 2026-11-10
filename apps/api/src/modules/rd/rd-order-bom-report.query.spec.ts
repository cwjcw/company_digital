import { RdOrderBomReportQueryService } from './rd-order-bom-report.query.service';

describe('R&D order BOM report query source', () => {
  const division='11111111-1111-4111-8111-111111111111', tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const itemId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const actor: any={tenantId:tenant,userId:'u1',permissions:[],moduleAdminCodes:['rd'],isSystemAdmin:false,tableDataScopes:[]};
  const allocations=[
    {id:'allocation-1',tenantId:tenant,divisionId:division,divisionName:'事业一部',orderNumber:'SO-1',itemCode:'ITEM-1',itemName:'品项',orderDate:'2026-11-01',expectedShippingDate:'2026-12-01'},
    {id:'allocation-2',tenantId:tenant,divisionId:division,divisionName:'事业一部',orderNumber:'SO-1',itemCode:'ITEM-1',itemName:'品项',orderDate:'2026-11-01',expectedShippingDate:'2026-12-01'}
  ];
  const e10={read:jest.fn().mockResolvedValue({sourceSnapshotAt:'2026-11-10',items:[{item_id:itemId,item_code:'ITEM-1'}]})};
  const registry={register:jest.fn()} as any;
  const state:any={activeGeneration:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',lastSuccessAt:new Date().toISOString(),lastStatus:'SUCCESS',lastErrorCode:null};
  const heads=[{bom_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',item_id:itemId,item_code:'ITEM-1',version_times:'1',approve_status:'Y',approved_at:'2026-11-03 10:00:00'}];
  const dataSource={transaction:async (...args:any[])=>{const callback=args.at(-1);return callback({query:async(sql:string)=>{
    if(sql.includes('set_config'))return [];
    if(sql.includes('DISTINCT record.division_id'))return [{value:division}];
    if(sql.includes('FROM mps_order_allocations'))return allocations;
    if(sql.includes('FROM rd_bom_sync_state'))return [state];
    if(sql.includes('FROM rd_bom_master_heads'))return heads;
    throw new Error(`unexpected query: ${sql}`);
  }});}} as any;
  const service=new RdOrderBomReportQueryService(dataSource,registry,e10 as any);service.onModuleInit();
  beforeEach(()=>e10.read.mockClear());

  it('uses only approved allocations, reads due date from expected_shipping_date and joins local approved headers',async()=>{
    const source=registry.register.mock.calls[0][0];
    const result=await source.listRows({actor,page:1,pageSize:20,search:'',filterGroup:null,context:{view:'detail'},fieldKeys:['divisionId','orderNumber','itemCode','itemName','orderDate','customerDueDate','bomStatus','bomApprovalDate','bomWaitingDays','currentWaitingDays'],action:'read'});
    expect(e10.read).toHaveBeenCalledWith(['ITEM-1','ITEM-1']);
    expect(result.total).toBe(2);
    expect(result.rows[0]).toMatchObject({orderNumber:'SO-1',itemCode:'ITEM-1',itemName:'品项',orderDate:'2026-11-01 00:00:00',customerDueDate:'2026-12-01 00:00:00',bomStatus:'HAS_BOM'});
    expect(result.rows[0].bomWaitingDays).toBe(2);
    expect(result).not.toHaveProperty('matchIssue');
  });

  it('deduplicates summary item counts and excludes null statuses from the completion denominator',async()=>{
    const source=registry.register.mock.calls[0][0];
    const result=await source.listRows({actor,page:1,pageSize:20,search:'',filterGroup:null,context:{view:'orders'},fieldKeys:['orderNumber','itemCount','existingBomItemCount','missingBomItemCount','unmatchedBomItemCount','completionRate','orderBomStatus'],action:'read'});
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({itemCount:1,existingBomItemCount:1,missingBomItemCount:0,unmatchedBomItemCount:0,completionRate:100,orderBomStatus:'全部完成'});
    const selected=await source.printRows({actor,page:1,pageSize:20,search:'',context:{view:'orders'},ids:[String(result.rows[0].id)],fieldKeys:['orderNumber'],action:'export'});
    expect(selected.total).toBe(1);
  });

  it('keeps three report views and does not read E10 sales-order sources',async()=>{
    const source=registry.register.mock.calls[0][0];
    await expect(source.listRows({actor,page:1,pageSize:20,search:'',filterGroup:null,context:{view:'sales-orders'},fieldKeys:[],action:'read'})).rejects.toThrow('视图无效');
    expect(source.table).toBe('mps_order_allocations');
    expect(e10.read).not.toHaveBeenCalled();
  });

  it('candidate queries keep RLS tenant context and use stable division ids',async()=>{
    const source=registry.register.mock.calls[0][0];
    const rows=await source.runQuery('SELECT DISTINCT record.division_id::text value FROM mps_order_allocations record WHERE record.tenant_id=$1',[tenant]);
    expect(rows).toEqual([{value:division}]);
  });

  it('exports and prints BOM report dates as Shanghai calendar dates while preserving local source dates',()=>{
    const source=registry.register.mock.calls[0][0];
    expect(source.exportDisplayValue({key:'orderDate'},'2026-11-10 00:00:00')).toBe('2026-11-10');
    expect(source.exportDisplayValue({key:'bomApprovalDate'},'2026-11-09T16:30:00.000Z')).toBe('2026-11-10');
    expect(source.exportDisplayValue({key:'customerDueDate'},null)).toBe('');
    expect(source.exportDisplayValue({key:'bomWaitingDays'},12)).toBeUndefined();
    expect(source.printDisplayValue({key:'bomApprovalDate'},'2026-11-03 10:00:00')).toBe('2026-11-03');
  });

  it('preserves the last usable index on sync failure and returns a visible freshness warning',async()=>{
    state.lastStatus='FAILED';state.lastErrorCode='E10_READ_OR_SYNC_FAILURE';
    const source=registry.register.mock.calls[0][0];
    const result=await source.listRows({actor,page:1,pageSize:20,search:'',filterGroup:null,context:{view:'detail'},fieldKeys:['orderNumber'],action:'read'});
    expect(result.total).toBe(2);expect(result.syncWarning).toContain('E10 BOM索引');
    state.lastStatus='SUCCESS';state.lastErrorCode=null;
  });
});
