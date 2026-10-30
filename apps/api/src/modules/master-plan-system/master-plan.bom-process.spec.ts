import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { bindBomProcesses } from './master-plan.bom-process.domain';
import { MasterPlanBomProcessService } from './master-plan.bom-process.service';
import { MasterPlanApplicationService } from './master-plan.application.service';
import type { BomProcessFacts } from '@kdos/contracts';
import type { MasterPlanActor } from './master-plan.types';
const id='00000000-0000-7000-8000-000000000004',other='00000000-0000-7000-8000-000000000001';
const actor:MasterPlanActor={tenantId:'TEST',userId:id,username:'tester',permissions:[],tableDataScopes:[],requestId:'fixture',source:'web',isSystemAdmin:true};
function facts():BomProcessFacts{return {sourceKey:'tplus-kejia',sourceDatabase:'UFTData418971_000003',observedAt:'2026-01-01T00:00:00Z',orderNumber:'SYN',itemCode:'ROOT',orderLineId:'42',state:'READY',message:'',bomId:'77',bomVersion:'01',catalog:[],children:[1,2].map(n=>({id:String(n),bomId:'77',bomVersion:'01',itemCode:'C'+n,itemName:'子件'+n,routeCode:'R',routeName:'路线',source:'子件默认路线',state:'READY',processes:[{code:'S'+n,name:'来源'+n,sequence:1,source:'子件默认路线'}]}))};}
const mappings=[1,2].map(n=>({id:String(n),version:1,source_process_code:'S'+n,mapping_mode:'MATCH',process_code:'welding',enabled:true}));
describe('一级BOM事业部工序对应',()=>{
 it('多个子件/来源映射同一标准工序，仅生成一个产品工序',()=>{const r=bindBomProcesses(facts(),mappings);expect(r.processCodes).toEqual(['welding']);expect(r.bindings).toHaveLength(2)});
 it('忽略、停用、未绑定分别表达，不默认套用事业部全部工序',()=>{const r=bindBomProcesses(facts(),[{...mappings[0]!,mapping_mode:'IGNORE',process_code:null},{...mappings[1]!,enabled:false}]);expect(r.processCodes).toEqual([]);expect(r.bindings.map(b=>b.state)).toEqual(['IGNORED','UNMAPPED'])});
});
describe('BOM匹配读权限、来源与进度',()=>{
 const row={id,orderId:other,sourceKind:'月计划',divisionId:id,orderNumber:'SYN',itemCode:'ROOT',weldingRequiredQuantity:'500',weldingReportedQuantity:'300',weldingProductionProgress:'0.6',weldingStatus:'已完成',weldingLastReportDate:'2026-01-01'};
 function setup(){
  const query=jest.fn(async(sql:string)=>sql.includes('FROM mps_monthly_plans')?[{division_id:id,division_name:'事业四部'}]:sql.includes('FROM mps_erp_order_lines')?[{source_key:'42'}]:sql.includes('FROM mps_external_process_mappings')?mappings:[]);
  const db={transaction:jest.fn(async(...args:any[])=>args.at(-1)({query}))};
  const progress={allowed:jest.fn(()=>true),page:jest.fn(async()=>({rows:[row]}))};
  const reader={read:jest.fn(async()=>facts())};const app={externalProcessMappingCanWrite:jest.fn(()=>true),recordOrderProgressExport:jest.fn(async()=>undefined)};
  const service=new MasterPlanBomProcessService(db as any,progress as any,reader as any,app as any);
  return {service,query,db,progress,reader,app};
 }
 it('限定tenant/事业部/账套；直接沿用正式聚合300/500而非子件重复累计',async()=>{
  const x=setup(),v=await x.service.read({orderId:other,itemId:id},actor);
  expect(v.progress).toHaveLength(1);expect(v.progress[0]).toMatchObject({reportedQuantity:'300',productionProgress:'0.6',status:'已完成'});
  expect(x.query).toHaveBeenCalledWith(expect.stringContaining('source_key=\'tplus-kejia\''),['TEST',id]);
  expect(x.reader.read).toHaveBeenCalledWith({tenantId:'TEST',orderNumber:'SYN',itemCode:'ROOT',orderLineId:'42'});
  expect(x.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
 });
 it('隐藏BOM字段时拒绝并且不读取ERP',async()=>{const x=setup();x.progress.allowed.mockImplementation((_actor?:MasterPlanActor,key?:string)=>key!=='bomConfiguration');await expect(x.service.read({orderId:other,itemId:id},actor)).rejects.toBeInstanceOf(ForbiddenException);expect(x.reader.read).not.toHaveBeenCalled()});
 it('共享组织目录没有tenant列；租户约束仍落在正式月计划和映射上',async()=>{const x=setup();await x.service.read({orderId:other,itemId:id},actor);const sql=x.query.mock.calls.find(([sql])=>sql.includes('FROM mps_monthly_plans'))![0];expect(sql).toContain('o.id=p.division_id');expect(sql).not.toContain('o.tenant_id');expect(sql).toContain('p.tenant_id=$1');});
 it('越订单/数据范围时拒绝，不借全表源数据补回',async()=>{const x=setup();x.progress.page.mockResolvedValue({rows:[]});await expect(x.service.read({orderId:other,itemId:id},actor)).rejects.toBeInstanceOf(NotFoundException);expect(x.reader.read).not.toHaveBeenCalled()});
 it('事业部决定映射责任，不限制按品项匹配科加物料',async()=>{const x=setup();x.query.mockImplementation(async(sql:string)=>sql.includes('FROM mps_monthly_plans')?[{division_id:other,division_name:'事业一部'}]:[]);expect((await x.service.read({orderId:other,itemId:id},actor)).supported).toBe(true);expect(x.reader.read).toHaveBeenCalledWith({tenantId:'TEST',orderNumber:'SYN',itemCode:'ROOT'})});
 it('多个来源明细不能自动选择第一个',async()=>{const x=setup();x.query.mockImplementation(async(sql:string)=>sql.includes('FROM mps_monthly_plans')?[{division_id:id,division_name:'事业四部'}]:sql.includes('FROM mps_erp_order_lines')?[{source_key:'42'},{source_key:'43'}]:[]);await x.service.read({orderId:other,itemId:id},actor);expect(x.reader.read).toHaveBeenCalledWith({tenantId:'TEST',orderNumber:'SYN',itemCode:'ROOT'})});
 it('字段权限裁剪数量和进度；只读用户不获取可写映射ID/版本',async()=>{const x=setup();x.progress.allowed.mockImplementation((_actor?:MasterPlanActor,key?:string)=>!['weldingReportedQuantity','weldingProductionProgress'].includes(key??''));const v=await x.service.read({orderId:other,itemId:id},{...actor,isSystemAdmin:false});expect(v.progress[0]).not.toHaveProperty('reportedQuantity');expect(v.progress[0]).not.toHaveProperty('productionProgress');expect(v.bindings[0]).not.toHaveProperty('id');expect(v.canConfigure).toBe(false)});
 it('每表Excel继承正式export范围并记录审计',async()=>{const x=setup();const b=await x.service.export({orderId:other,itemId:id},'progress',actor);expect(b.length).toBeGreaterThan(100);expect(x.progress.page).toHaveBeenCalledWith(expect.anything(),actor,'items','export');expect(x.app.recordOrderProgressExport).toHaveBeenCalledWith(expect.objectContaining({tableKey:'bom-progress',rowCount:1}),actor)});
 it('未知导出表拒绝',async()=>{const x=setup();await expect(x.service.export({orderId:other,itemId:id},'users',actor)).rejects.toBeInstanceOf(BadRequestException);expect(x.reader.read).not.toHaveBeenCalled()});
});
describe('映射命令',()=>{
 const code='mps-external-process-mappings';
 const input={divisionId:id,sourceKey:'tplus-kejia',sourceProcessCode:'SYN1',sourceProcessName:'来源工序',mappingMode:'MATCH',processCode:'welding',enabled:true};
 function setup(){const query=jest.fn(async(sql:string)=>sql.startsWith('SELECT * FROM mps_external')?[{id,tenant_id:'TEST',division_id:id,source_key:'tplus-kejia',source_process_code:'SYN1',source_process_name:'来源工序',mapping_mode:'MATCH',process_code:'welding',enabled:true,version:1,created_by:id}]:sql.startsWith('INSERT INTO mps_external')?[{id,version:1}]:[]);return {query,service:new MasterPlanApplicationService({transaction:async(fn:any)=>fn({query})} as any,{} as any)}}
 it('绑定必选标准工序；IGNORE必须清空目标，所有创建入口共享规则',async()=>{const x=setup();await expect(x.service.create(code,{...input,processCode:null},actor)).rejects.toThrow('必须选择');await expect(x.service.create(code,{...input,mappingMode:'IGNORE'},actor)).rejects.toThrow('请清空');expect(x.query).not.toHaveBeenCalled()});
 it('创建映射具有租户上下文和审计，不触发工序重投影',async()=>{const x=setup();await x.service.create(code,input,actor);expect(x.query).toHaveBeenCalledWith(expect.stringContaining("set_config('app.tenant_id'"),['TEST']);expect(x.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'),expect.arrayContaining([code+'.created']));expect(x.query.mock.calls.some(([sql])=>sql.includes('mps_process_reports')||sql.includes('mps_weekly_process_plans'))).toBe(false)});
 it('旧版本拒绝覆盖',async()=>{const x=setup();await expect(x.service.update(code,id,{expectedVersion:2,processCode:'bending'},actor)).rejects.toThrow('其他用户修改')});
 it('有本部门修改权不能将记录移入另一个事业部',async()=>{const x=setup();const scoped={...actor,isSystemAdmin:false,permissions:[`${code}:*:update`,`${code}:divisionId:update`],tableDataScopes:[{resource:code,scope:'CUSTOM',actions:['update'],rules:[{fieldKey:'divisionId',operator:'EQ',value:id}]}]};await expect(x.service.update(code,id,{expectedVersion:1,divisionId:other},scoped)).rejects.toThrow('未授权');expect(x.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE mps_external'))).toBe(false)});
});
