import { ForbiddenException } from "@nestjs/common";
import { mpsDivisionOrderProgressColumns, mpsDivisionOrderProgressResource, tableResourceRegistry, tablePermissionFieldsFor } from "@kdos/contracts";
import { MasterPlanDivisionOrderProgressService } from "./master-plan.division-order-progress.service";
import type { MasterPlanActor } from "./master-plan.types";

const actor:MasterPlanActor={tenantId:"SYNTHETIC",userId:null,username:"test",permissions:["*"],tableDataScopes:[],requestId:"test",source:"web"};
const row={id:"allocation-id",customerCode:"C001",orderNumber:"0000123",itemCode:"0000456",itemName:"合成品项",orderDate:"2026-10-01",expectedShippingDate:"2026-12-01",orderQuantity:"1200.0000",reviewDueDate:"2026-11-01",reviewDueTooltip:"2026-11-01",weldingQuantity:"1199.9600",blankQuantity:"800.0000",surfaceTreatmentQuantity:"1250.0000",packagingQuantity:"0",inboundQuantity:"-1.2500",inboundVerified:true,weldingComplete:false,blankComplete:false,surfaceTreatmentComplete:true,packagingComplete:false,inboundComplete:false};

describe("事业部订单生产进度报表",()=>{
  const transactions:jest.Mock[]=[];
  let service:MasterPlanDivisionOrderProgressService;
  beforeEach(()=>{
    transactions.length=0;
    const database={transaction:jest.fn(async(...args:unknown[])=>{
      const callback=args[args.length-1] as (manager:{query:jest.Mock})=>Promise<unknown>;
      const query=jest.fn(async(sql:string)=>{
        if(sql.startsWith("SELECT id FROM organization_units"))return [{id:"d23442f9-4862-4641-b4a7-c8d470bc56ea"}];
        if(sql.includes("SELECT (SELECT count(*)::int FROM filtered)"))return [{total:1,rows:[row],base_unlinked:0,base_due_date_missing:0,inbound_unverified:0}];
        if(sql.includes("count(DISTINCT r.id)"))return [{count:0}];
        return [];
      });transactions.push(query);
      return callback({query});
    })};
    const bom={resolveBomStatuses:jest.fn(async(codes:string[])=>({statuses:new Map(codes.map(code=>[code,code==="0000456"?"HAS_BOM":null])),warning:null}))};
    service=new MasterPlanDivisionOrderProgressService(database as never,bom as never);
  });
  it("registers the exact 16-column read-only report under PMC",()=>{
    expect(tableResourceRegistry.find(r=>r.code===mpsDivisionOrderProgressResource)).toMatchObject({label:"事业部订单生产进度报表",moduleCode:"planning"});
    expect(mpsDivisionOrderProgressColumns.map(([,label])=>label)).toEqual(["客户代码","订单单号","品号","品名","下单日期","预计发货日期","订单数量","生管评审交期","图纸","物料齐套","下料","焊接","毛坯","表面处理","包装","入库"]);
    expect(tablePermissionFieldsFor(mpsDivisionOrderProgressResource)).toHaveLength(16);
  });
  it("returns one row from approved allocation identity, keeps raw precision and marks source states",async()=>{
    const result=await service.page("fourth",{page:1,pageSize:50},actor);
    expect(result.total).toBe(1);expect(result.rows[0]).toMatchObject({customerCode:"C001",orderNumber:"0000123",itemCode:"0000456",orderQuantity:"1200.0000",drawing:"Y",materialReady:"N",cutting:"N",weldingQuantity:"1199.9600",surfaceTreatmentQuantity:"1250.0000",inboundQuantity:"-1.2500",weldingComplete:false,surfaceTreatmentComplete:true});
    const sql=transactions[0]!.mock.calls.map(call=>String(call[0])).find(text=>text.includes("allocation AS MATERIALIZED"))!;
    expect(sql).toContain("record.archived_at IS NULL AND record.order_status='已审核'");
    expect(sql).toContain("r.process_code=ANY(ARRAY['welding','blank','surfaceTreatment','packaging']");
    expect(sql).toContain("raw.trusted AND raw.has_business_keys");
    expect(sql).toContain("sum(f.received_quantity)");
    expect(sql).not.toContain("GREATEST(f.received_quantity");
  });
  it("rejects missing report permission and validates dates, process codes, sorting and page inputs",async()=>{
    await expect(service.page("fourth",{}, {...actor,permissions:[]})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.page("fourth",{orderDateFrom:"2026-02-31"},actor)).rejects.toThrow("日期筛选格式无效");
    await expect(service.page("fourth",{processCode:"cutting",processStatus:"complete"},actor)).rejects.toThrow("工序编码无效");
    await expect(service.page("fourth",{sortField:"divisionId"},actor)).rejects.toThrow("排序字段无效");
    await expect(service.page("other",{},actor)).rejects.toThrow("事业部报表配置不存在");
    await expect(service.page("fourth",{sortField:"drawing"},actor)).rejects.toThrow("排序字段无效");
    expect(transactions).toHaveLength(0);
  });
});
