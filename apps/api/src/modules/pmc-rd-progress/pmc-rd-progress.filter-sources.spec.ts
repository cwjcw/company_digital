import ExcelJS from "exceljs";
import { TableFilterRegistry } from '../../common/filtering/table-filter.registry';
import { TablePrintService } from '../../common/printing/table-print.service';
import { FieldCandidateService } from '../../common/filtering/field-candidate.service';
import { TableFilterController } from '../../common/filtering/table-filter.controller';
import { PmcRdProgressFilterSources } from './pmc-rd-progress.filter-sources';
const actor={tenantId:'A',userId:'0199e000-0000-7000-8000-000000000001',permissions:['pmc-rd-progress:*:read','pmc-rd-progress:*:export','pmc-rd-progress:orderNo:read'],tableDataScopes:[{resource:'pmc-rd-progress',scope:'ALL',actions:['read','export']}]};
describe('PMC平台筛选导出授权',()=>{
  it('报表导出context的onlyIncomplete与订单/日期条件应使用items同一查询口径',async()=>{
    const registry=new TableFilterRegistry();
    const query=jest.fn<Promise<Array<Record<string,unknown>>>, [string, unknown[]?]>(async(sql:string)=>sql.includes('count(*)')?[{count:0,total:0}]:[]);
    const dataSource={transaction:jest.fn(async(first:any,second:any)=>(second ?? first)({query}))};
    new PmcRdProgressFilterSources(registry,dataSource as never).onModuleInit();
    await new TablePrintService(registry,dataSource as never).exportXlsx('pmc-rd-progress',{context:{onlyIncomplete:true,orderNo:'SO-1',orderDateFrom:'2026-09-01'}},{...actor,permissions:[...actor.permissions,'pmc-rd-progress:rdStatus:read','pmc-rd-progress:orderDate:read']});
    expect(query.mock.calls.some(([sql])=>sql.includes("NOT IN ('COMPLETE','NOT_APPLICABLE')"))).toBe(true);
    expect(query.mock.calls.some(([,params])=>(params as unknown[] | undefined)?.includes('2026-09-01'))).toBe(true);
  });
  it('登记真实列与微秒源时间的上海时区表达式，执行器设置RLS上下文',async()=>{const registry=new TableFilterRegistry(),query=jest.fn().mockResolvedValue([]),dataSource={transaction:jest.fn(async(first:any,second:any)=>(second ?? first)({query}))};new PmcRdProgressFilterSources(registry,dataSource as never).onModuleInit();const source=registry.get('pmc-rd-progress');expect(source.columns.id).toBe('id');expect(source.expressions?.sourceSnapshotAt).toContain("AT TIME ZONE 'Asia/Shanghai'");await source.runQuery!('SELECT 1',['A']);expect(query.mock.calls[0]).toEqual(["SELECT set_config('app.tenant_id',$1,true)",['A']]);expect(source.buildScope({...actor,tableDataScopes:[{resource:'pmc-rd-progress',scope:'OWN',actions:['export']}]},[],'export')).toContain('created_by');});
  it('统一导出检查export权限并裁剪隐藏字段，输出所有匹配行',async()=>{const registry=new TableFilterRegistry(),query=jest.fn<Promise<Array<Record<string,unknown>>>, [string, unknown[]?]>(async(sql:string)=>sql.includes('count(*)') ? [{count:2,total:2}] : sql.startsWith('SELECT set_config') ? [] : [{orderNo:'SO-1'},{orderNo:'SO-2'}]),dataSource={transaction:jest.fn(async(first:any,second:any)=>(second ?? first)({query}))};new PmcRdProgressFilterSources(registry,dataSource as never).onModuleInit();const exports=new TablePrintService(registry,dataSource as never);const buffer=await exports.exportXlsx('pmc-rd-progress',{},actor);expect(buffer.length).toBeGreaterThan(0);expect(query.mock.calls.some(call=>call[0].includes('customer_name'))).toBe(false);await expect(exports.exportXlsx('pmc-rd-progress',{},{...actor,permissions:actor.permissions.filter(p=>!p.endsWith(':export'))})).rejects.toThrow();});
  it('导出跨批全部401行，中文表头、业务字典、null和字段可见性保持平台格式',async()=>{
    const registry=new TableFilterRegistry();
    const query=jest.fn(async(sql:string,params:unknown[]=[])=>{
      if(sql.startsWith('SELECT set_config'))return [];
      if(sql.includes('count(*)'))return [{total:401}];
      const size=Number(params.at(-2)),offset=Number(params.at(-1));
      return Array.from({length:Math.min(size,401-offset)},(_,index)=>({id:`row-${index+offset}`,orderNo:`SO-${index+offset}`,rdStatus:'WAITING_ROUTING',reasonText:null}));
    });
    const dataSource={transaction:jest.fn(async(first:any,second:any)=>(second??first)({query}))};
    new PmcRdProgressFilterSources(registry,dataSource as never).onModuleInit();
    const buffer=await new TablePrintService(registry,dataSource as never).exportXlsx('pmc-rd-progress',{context:{page:2,pageSize:20},columnKeys:['orderNo','rdStatus','reasonText','customerName']},{...actor,permissions:[...actor.permissions,'pmc-rd-progress:rdStatus:read','pmc-rd-progress:reasonText:read']});
    const book=new ExcelJS.Workbook();await book.xlsx.load(buffer as any);const sheet=book.worksheets[0]!;
    expect(sheet.rowCount).toBe(402);expect(sheet.getRow(1).values).toEqual([undefined,'订单号','研发状态','原因说明']);expect(sheet.getCell('B2').value).toBe('待工艺');expect(sheet.getCell('C2').value).toBe('—');
    expect(query.mock.calls.filter(([sql])=>sql.includes(' LIMIT '))).toHaveLength(3);
  });
  it('页面与导出复用同一日期/订单/客户/事业部/环节/高级筛选/排序，导出必须AND read与export范围',async()=>{
    const registry=new TableFilterRegistry(),query=jest.fn<Promise<Array<Record<string,unknown>>>, [string, unknown[]?]>(async(sql:string)=>sql.includes('count(*)')?[{total:0}]:[]);
    const dataSource={transaction:jest.fn(async(first:any,second:any)=>(second??first)({query}))};new PmcRdProgressFilterSources(registry,dataSource as never).onModuleInit();
    const permissions=['pmc-rd-progress:*:read','pmc-rd-progress:*:export',...['orderNo','customerName','divisionId','rdStatus','designBomStatus','routingStatus','orderDate','itemCode'].map(key=>`pmc-rd-progress:${key}:read`)];
    await new TablePrintService(registry,dataSource as never).exportXlsx('pmc-rd-progress',{context:{orderNo:'SO-1',customer:'客户甲',division:'0199e000-0000-7000-8000-000000000002',designBomStatus:'COMPLETE',routingStatus:'NOT_STARTED',orderDateFrom:'2026-09-01',orderDateTo:'2026-10-07',onlyIncomplete:true,tenantId:'other'},filterGroup:{logic:'AND',rules:[{field:'itemCode',operator:'contains',value:'ITEM'}]},sortField:'orderNo',sortOrder:'desc'},{...actor,permissions,tableDataScopes:[{resource:'pmc-rd-progress',scope:'CUSTOM',actions:['read'],rules:[{fieldKey:'orderNo',operator:'STARTS_WITH',value:'READ'}]},{resource:'pmc-rd-progress',scope:'CUSTOM',actions:['export'],rules:[{fieldKey:'orderNo',operator:'STARTS_WITH',value:'EXPORT'}]}]});
    const [,params]=query.mock.calls.find(([sql])=>sql.includes('count(*)'))!;
    expect(params).toEqual(expect.arrayContaining(['A','READ%','EXPORT%','%SO-1%','%客户甲%','2026-09-01','2026-10-07','%ITEM%']));expect(params).not.toContain('other');
    const [sql]=query.mock.calls.find(([sql])=>sql.includes(' LIMIT '))!;expect(sql).toContain('record.order_no DESC');expect(sql).toContain("NOT IN ('COMPLETE','NOT_APPLICABLE')");
  });
  it('隐藏字段不能通过导出context进行筛选，选中打印IDs也交给同一查询',async()=>{
    const registry=new TableFilterRegistry(),query=jest.fn<Promise<Array<Record<string,unknown>>>, [string, unknown[]?]>(async(sql:string)=>sql.includes('count(*)')?[{total:0}]:[]);
    const dataSource={transaction:jest.fn(async(first:any,second:any)=>(second??first)({query}))};new PmcRdProgressFilterSources(registry,dataSource as never).onModuleInit();
    await expect(new TablePrintService(registry,dataSource as never).exportXlsx('pmc-rd-progress',{context:{onlyIncomplete:true}},actor)).rejects.toThrow('不能读取或筛选');
    await registry.get('pmc-rd-progress').printRows!({search:'',context:{},ids:['0199e000-0000-7000-8000-000000000002'],fieldKeys:['orderNo'],page:1,pageSize:100,actor});
    expect(query.mock.calls.some(([sql])=>sql.includes('record.id=ANY('))).toBe(true);
  });

  it.each(['orderNo','itemCode','itemName','customerName'])('PMC %s候选只读active授权集，模糊搜索最多50并设置tenant/RLS',async(field)=>{
    const registry=new TableFilterRegistry(),query=jest.fn(async(sql:string)=>sql.includes('SELECT DISTINCT')?Array.from({length:51},(_,index)=>({value:`value-${index}`})):[]);
    const dataSource={transaction:jest.fn(async(first:any,second:any)=>(second??first)({query}))};new PmcRdProgressFilterSources(registry,dataSource as never).onModuleInit();
    const controller=new TableFilterController(new FieldCandidateService({} as never),registry,{} as never,{} as never);
    const request={user:{sub:actor.userId,permissions:['pmc-rd-progress:*:read',`pmc-rd-progress:${field}:read`],tableDataScopes:[{resource:'pmc-rd-progress',scope:'OWN'}]}} as never;
    const result=await controller.candidateOptions({resource:'pmc-rd-progress',field,search:'part',limit:'50',withMeta:'1'},request);
    expect(result).toMatchObject({hasMore:true});expect((result as any).options).toHaveLength(50);
    const [sql,params]=query.mock.calls.find(([sql])=>sql.includes('SELECT DISTINCT'))! as unknown as [string,unknown[]];
    expect(sql).toContain('pmc_rd_progress_items record');expect(sql).toContain('record.tenant_id=$1');expect(sql).toContain('record.is_active');expect(sql).toContain('created_by');expect(sql).toContain('ILIKE');
    expect(params).toEqual(expect.arrayContaining([actor.userId,'%part%',51]));expect(query.mock.calls[0]?.[0]).toContain("set_config('app.tenant_id'");
    await expect(controller.candidateOptions({resource:'pmc-rd-progress',field:'itemSpec'},request)).rejects.toThrow();
    await expect(controller.candidateOptions({resource:'pmc-rd-progress',field},{user:{permissions:[]}} as never)).rejects.toThrow('查看权限');
  });
  it('全量401行导出继承订单/品号/品名及双状态IN，read/export范围AND且页100不截断',async()=>{
    const registry=new TableFilterRegistry(),query=jest.fn(async(sql:string,params:unknown[]=[])=>{
      if(sql.startsWith('SELECT set_config'))return [];if(sql.includes('count(*)'))return [{total:401}];
      const size=Number(params.at(-2)),offset=Number(params.at(-1));return Array.from({length:Math.min(size,401-offset)},(_,i)=>({orderNo:(i+offset)%2?'B':'A',itemCode:(i+offset)%2?'Y':'X',itemName:'同名',rdStatus:'WAITING_ROUTING'}));
    }),dataSource={transaction:jest.fn(async(first:any,second:any)=>(second??first)({query}))};new PmcRdProgressFilterSources(registry,dataSource as never).onModuleInit();
    const rules=[{field:'orderNo',operator:'in',values:['A','B']},{field:'itemCode',operator:'in',values:['X','Y']},{field:'itemName',operator:'in',values:['同名','名称乙']},{field:'rdStatus',operator:'in',values:['NOT_STARTED','WAITING_ROUTING']}];
    const exportActor={...actor,permissions:[...actor.permissions,...['itemCode','itemName','rdStatus'].map(key=>`pmc-rd-progress:${key}:read`)],tableDataScopes:[{resource:'pmc-rd-progress',scope:'CUSTOM',actions:['read'],rules:[{fieldKey:'orderNo',operator:'STARTS_WITH',value:'READ'}]},{resource:'pmc-rd-progress',scope:'CUSTOM',actions:['export'],rules:[{fieldKey:'orderNo',operator:'STARTS_WITH',value:'EXPORT'}]}]};
    const buffer=await new TablePrintService(registry,dataSource as never).exportXlsx('pmc-rd-progress',{filterGroup:{logic:'AND',rules},context:{page:2,pageSize:100},columnKeys:['orderNo','itemCode','itemName','rdStatus']},exportActor);
    const book=new ExcelJS.Workbook();await book.xlsx.load(buffer as any);expect(book.worksheets[0]!.rowCount-1).toBe(401);
    const [,params]=query.mock.calls.find(([sql])=>sql.includes('count(*)'))!;for(const rule of rules)expect(params).toContainEqual(rule.values);expect(params).toEqual(expect.arrayContaining(['A','READ%','EXPORT%']));
  });
  it('源墙钟时间导出不因服务器TZ而偏移，客户名称空值只在授权编码时回退',async()=>{
    const registry=new TableFilterRegistry(),query=jest.fn(async(sql:string)=>sql.includes('count(*)')?[{total:1}]:sql.startsWith('SELECT set_config')?[]:[{id:'1',orderNo:'SO-1',rdLastModifiedAt:'2026-10-06 23:59:59.123456',customerName:null,customerCode:'C01'}]);
    const dataSource={transaction:jest.fn(async(first:any,second:any)=>(second??first)({query}))};new PmcRdProgressFilterSources(registry,dataSource as never).onModuleInit();
    const authorized={...actor,permissions:[...actor.permissions,...['rdLastModifiedAt','customerName','customerCode'].map(key=>`pmc-rd-progress:${key}:read`)]};
    const result=await registry.get('pmc-rd-progress').printRows!({search:'',context:{},fieldKeys:['orderNo','rdLastModifiedAt','customerName'],page:1,pageSize:100,actor:authorized});
    expect(result.rows[0]?.rdLastModifiedAt).toBe('2026-10-06T23:59:59.123456+08:00');expect(result.rows[0]?.customerName).toBe('C01');
    const buffer=await new TablePrintService(registry,dataSource as never).exportXlsx('pmc-rd-progress',{columnKeys:['orderNo','rdLastModifiedAt','customerName']},authorized);const book=new ExcelJS.Workbook();await book.xlsx.load(buffer as any);
    expect(book.worksheets[0]!.getRow(2).values).toEqual([undefined,'SO-1','C01','2026-10-06 23:59:59']);
  });

});
