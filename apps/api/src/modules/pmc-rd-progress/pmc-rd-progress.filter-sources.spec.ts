import ExcelJS from "exceljs";
import { TableFilterRegistry } from '../../common/filtering/table-filter.registry';
import { TablePrintService } from '../../common/printing/table-print.service';
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
