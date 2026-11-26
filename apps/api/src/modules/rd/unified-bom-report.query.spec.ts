import { RdOrderBomReportQueryService } from './rd-order-bom-report.query.service';
import { createUnifiedBomMatcher, type UnifiedBomHead } from './unified-bom.matcher';
import { TablePrintService } from '../../common/printing/table-print.service';
import ExcelJS from 'exceljs';

describe('Three-source existing report views',()=>{
 const heads:UnifiedBomHead[]=[
  {source:'tplus-kejia',bomId:'1',itemCode:'TPLUS-ONLY',version:'A',approved:true,disabled:false,modifiedAt:'2026-11-01',auditedAt:'2026-11-02'},
  {source:'tplus-kainan',bomId:'2',itemCode:'MULTI',version:'A',approved:true,disabled:false,modifiedAt:'2026-11-04',auditedAt:'2026-11-05'},
  {source:'e10-main',bomId:'3',itemCode:'MULTI',version:'B',approved:true,disabled:false,modifiedAt:'2026-11-01',auditedAt:'2026-11-02'}];
 const actor:any={tenantId:'TEST',userId:'u',permissions:['*'],isSystemAdmin:true,tableDataScopes:[]};
 const allocations=['TPLUS-ONLY','TPLUS-ONLY','MULTI','MISSING'].map((itemCode,i)=>({id:String(i),tenantId:'TEST',divisionId:'d',divisionName:'部门',orderNumber:'ORDER',itemCode,itemName:'产品',orderDate:'2026-11-01',allocationDate:'2026-11-01',trackedBomStatus:itemCode==='MISSING'?'N':'Y',lockedWaitingDays:itemCode==='TPLUS-ONLY'?1:null,initialBomStatus:null,expectedShippingDate:'2026-12-01'}));
 const sqls:string[]=[];
 const db:any={transaction:async(...args:any[])=>args.at(-1)({query:async(sql:string)=>{sqls.push(sql);return sql.includes('FROM mps_order_allocations')?allocations:[];}})};
 const registry:any={register:jest.fn()};const e10:any={read:jest.fn()};
 const unified:any={read:jest.fn().mockResolvedValue({enabled:true,match:createUnifiedBomMatcher(heads,true),syncText:'E10：正常；科加智能：正常；凯南智能：正常',warning:null})};
 const service=new RdOrderBomReportQueryService(db,registry,e10,unified);service.onModuleInit();
 const source=registry.register.mock.calls[0][0];
 const list=(view:string,extra:any={})=>source.listRows({actor,page:1,pageSize:100,search:'',filterGroup:null,context:{view},fieldKeys:['allocationDate','initialBomStatus','itemCode','bomStatus','bomSources','bomApprovalDate','bomWaitingDays','currentWaitingDays','bomSourceNote','sourceSyncStatus','itemCount','existingBomItemCount','missingBomItemCount','completionRate'],action:'read',...extra});
 it('uses local exact-code snapshots for T+ only, with Y/N and no live E10 prerequisite',async()=>{
  const result=await list('detail');expect(result.total).toBe(4);
  expect(result.rows[0]).toMatchObject({itemCode:'TPLUS-ONLY',bomStatus:'Y',bomSources:'科加智能',bomWaitingDays:1});
  expect(result.rows[2]).toMatchObject({itemCode:'MULTI',bomStatus:'Y',bomSources:'E10、凯南智能',bomApprovalDate:'2026-11-05 12:00:00',bomWaitingDays:null});
  expect(result.rows[3]).toMatchObject({bomStatus:'N'});expect(e10.read).not.toHaveBeenCalled();
 });
 it('deduplicates both sources and duplicate allocations consistently across all views',async()=>{
  for(const view of ['orders','divisions']){
   const result=await list(view);expect(result.total).toBe(1);
   expect(result.rows[0]).toMatchObject({itemCount:3,existingBomItemCount:2,missingBomItemCount:1,completionRate:66.67});
  }
 });
 it('uses new fields in shared advanced filters and complete export paging',async()=>{
  const result=await list('detail',{filterGroup:{logic:'AND',rules:[{field:'bomSources',operator:'contains',value:'科加智能'},{field:'bomStatus',operator:'eq',value:'Y'}]}});
  expect(result.total).toBe(2);
  const exported=await list('detail',{action:'export',filterGroup:{logic:'AND',rules:[{field:'bomStatus',operator:'eq',value:'N'}]}});
  expect(exported.rows).toHaveLength(1);expect(exported.rows[0].bomStatus).toBe('N');
 });
 it('does not return hidden fields or allow hidden-field filter/sort; applies read and export scopes',async()=>{
  const restricted={...actor,hasFieldPermission:(_r:string,key:string)=>key==='bomStatus'};
  const result=await list('detail',{actor:restricted});expect(Object.keys(result.rows[0]).sort()).toEqual(['bomStatus','id']);
  await expect(list('detail',{actor:restricted,filterGroup:{logic:'AND',rules:[{field:'bomSources',operator:'contains',value:'科加'}]}})).rejects.toThrow('不能按该字段筛选');
  await expect(list('detail',{actor:restricted,sortField:'bomSources'})).rejects.toThrow('不能按该字段排序');
  const scoped={...actor,isSystemAdmin:false,permissions:['rd-order-bom-report:*:read','rd-order-bom-report:*:export'],tableDataScopes:[{resource:'rd-order-bom-report',actions:['read'],scope:'OWN'},{resource:'rd-order-bom-report',actions:['export'],scope:'OWN'}]};
  await list('detail',{actor:scoped,action:'export'});expect(sqls.at(-1)).toContain('record.tenant_id=$1');
  expect(sqls.at(-1)?.match(/record.created_by/g)).toHaveLength(2);
 });
 it('unverified N stays N and does not accumulate a claimed confirmed missing-BOM wait',async()=>{
  unified.read.mockResolvedValueOnce({enabled:true,match:createUnifiedBomMatcher(heads,false),syncText:'科加智能：异常',warning:'科加智能：异常'});
  const result=await list('detail');expect(result.rows[3]).toMatchObject({bomStatus:'N',initialBomStatus:null});expect(result.syncWarning).toContain('异常');
 });
 it('removes retired detail fields from export/print and rejects their filter and sort',async()=>{
  const keys=['sourceModifiedTimes','sourceSyncStatus','bomSourceNote','currentWaitingDays'];
  for(const method of ['exportVariant','printVariant'])expect(source[method]({view:'detail'}).fields.map((f:any)=>f.key)).not.toEqual(expect.arrayContaining(keys));
  for(const key of keys){
   await expect(list('detail',{sortField:key})).rejects.toThrow('排序字段无效');
   await expect(list('detail',{filterGroup:{logic:'AND',rules:[{field:key,operator:'is_empty'}]}})).rejects.toThrow('不属于当前');
  }
  expect((await list('detail')).rows[0]).not.toHaveProperty('sourceSyncStatus');
 });
 it('filters initial blank separately from Y/N and sorts numeric waiting values',async()=>{
  const result=await list('detail',{filterGroup:{logic:'AND',rules:[{field:'initialBomStatus',operator:'is_empty'}]},sortField:'bomWaitingDays',sortOrder:'desc'});
  expect(result.total).toBe(4);expect(result.rows[0].bomWaitingDays).toBeGreaterThanOrEqual(1);
 });
 it('exports a real workbook with department display aliases and all matching Y/N rows',async()=>{
  const exports=new TablePrintService({has:()=>true,get:()=>source} as never,db);
  const buffer=await exports.exportXlsx('rd-order-bom-report',{context:{view:'detail'},columnKeys:['divisionId','itemCode','bomStatus','bomSources','allocationDate','initialBomStatus'],rangeType:'FILTERED'},actor);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as never);const sheet=workbook.worksheets[0];
  expect(sheet.rowCount).toBe(5);expect(sheet.getCell('A2').text).toBe('部门');
  expect(sheet.getCell('C2').text).toBe('Y');expect(sheet.getCell('C5').text).toBe('N');
  expect(sheet.getCell('D2').text).toBe('科加智能');
 });
 it('returns typed candidates from all authorized computed rows with current filters and stable department ids',async()=>{
  expect(await source.candidateValues({actor,context:{view:'detail'},tableSearch:'',search:'科加',limit:50,fieldKey:'bomSources',filterGroup:{logic:'AND',rules:[{field:'bomStatus',operator:'eq',value:'Y'}]}})).toEqual({options:[{value:'科加智能',label:'科加智能'}],hasMore:false});
  expect(await source.candidateValues({actor,context:{view:'divisions'},tableSearch:'',search:'',limit:50,fieldKey:'divisionId',filterGroup:null})).toEqual({options:[{value:'d',label:'部门'}],hasMore:false});
  expect(await source.printResolvers.divisionId([{id:'row1',divisionId:'部门'}])).toEqual(new Map([['row1','部门']]));
 });
});
