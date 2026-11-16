import { ForbiddenException } from "@nestjs/common";
import { mpsDivisionOrderProgressColumns, mpsDivisionOrderProgressResource, tableFilterResourceCapabilities, tableResourceRegistry, tablePermissionFieldsFor } from "@kdos/contracts";
import { MasterPlanDivisionOrderProgressService } from "./master-plan.division-order-progress.service";
import type { MasterPlanActor } from "./master-plan.types";

const actor:MasterPlanActor={tenantId:"SYNTHETIC",userId:null,username:"test",permissions:["*"],tableDataScopes:[],requestId:"test",source:"web"};
const row={id:"allocation-id",customerCode:"C001",orderNumber:"0000123",itemCode:"0000456",itemName:"合成品项",orderDate:"2026-10-01",expectedShippingDate:"2026-12-01",orderQuantity:"1200.0000",reviewDueDate:"2026-11-01",reviewDueTooltip:"2026-11-01",weldingQuantity:"1199.9600",blankQuantity:"800.0000",surfaceTreatmentQuantity:"1250.0000",packagingQuantity:"0",inboundQuantity:"-1.2500",inboundVerified:true,weldingComplete:false,blankComplete:false,surfaceTreatmentComplete:true,packagingComplete:false,inboundComplete:false};

describe("事业部订单生产进度报表",()=>{
  const transactions:jest.Mock[]=[];
  let service:MasterPlanDivisionOrderProgressService;
  let bomResolver:{resolveBomStatuses:jest.Mock};
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
    bomResolver={resolveBomStatuses:jest.fn(async(codes:string[])=>({statuses:new Map(codes.map(code=>[code,code==="0000456"?"HAS_BOM":null])),warning:null}))};
    service=new MasterPlanDivisionOrderProgressService(database as never,bomResolver as never);
  });
  it("registers the exact 16-column read-only report under PMC",()=>{
    expect(tableResourceRegistry.find(r=>r.code===mpsDivisionOrderProgressResource)).toMatchObject({label:"事业部订单生产进度报表",moduleCode:"planning"});
    expect(tableFilterResourceCapabilities[mpsDivisionOrderProgressResource]).toEqual({status:"REGISTERED_AND_FILTERABLE"});
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
    expect(sql).toContain("NOT COALESCE(raw.is_cancelled,false)");
    expect(sql).toContain("GROUP BY record.tenant_id,record.division_id,record.order_number,record.item_code");
    expect(sql).toContain("r.order_number=f.sales_order_number AND r.item_code=f.inventory_code");
    expect(sql).not.toContain("order_link_stable=true");
    expect(sql).not.toContain("GREATEST(f.received_quantity");
  });
  it("falls back to N when BOM query returns no status for a requested item code",async()=>{
    bomResolver.resolveBomStatuses.mockResolvedValueOnce({statuses:new Map(),warning:"E10 unavailable"});
    const result=await service.page("fourth",{},actor);
    expect(result.rows[0]?.drawing).toBe("N");
  });
  it("applies typed FilterGroup to the same server-side report WHERE used for count and rows",async()=>{
    const filterGroup={logic:"AND",rules:[{field:"orderQuantity",operator:"gte",value:"1000"}],groups:[{logic:"OR",rules:[{field:"weldingQuantity",operator:"lt",value:"1200"},{field:"reviewDueDate",operator:"eq",value:"2026-11-01"}]}]};
    await service.page("fourth",{filterGroup},actor);
    const calls=transactions[0]!.mock.calls;
    const sql=String(calls.map(call=>call[0]).find(value=>String(value).includes("SELECT (SELECT count(*)::int FROM filtered)")));
    expect(sql).toContain("order_quantity::text");expect(sql).toContain("welding_quantity::text");expect(sql).toContain("review_due_date::date");
    expect(sql.match(/FROM filtered/g)?.length).toBeGreaterThanOrEqual(3);
    expect(calls.find(call=>String(call[0]).includes("SELECT (SELECT count(*)::int FROM filtered)"))?.[1]).toContain("1000");
  });
  it("keeps standard pagination and sort server-side with the validated report sort map",async()=>{
    const result=await service.page("fourth",{page:2,pageSize:50,sortField:"orderQuantity",sortOrder:"desc"},actor);
    expect(result).toMatchObject({page:2,pageSize:50});
    const sql=String(transactions[0]!.mock.calls.map(call=>call[0]).find(value=>String(value).includes("SELECT (SELECT count(*)::int FROM filtered)")));
    expect(sql).toContain("ORDER BY order_quantity DESC NULLS LAST,order_number,item_code,id");
  });
  it("defaults to earliest order date descending, nulls last, with stable ties and one date for filter/sort/export rows",async()=>{
    await service.page("fourth",{page:1,orderDateFrom:"2026-11-03",orderDateTo:"2026-11-08",shippingDateFrom:"2026-12-01"},actor);
    const sql=String(transactions[0]!.mock.calls.map(call=>call[0]).find(value=>String(value).includes("SELECT (SELECT count(*)::int FROM filtered)")));
    expect(sql).toContain("min(record.order_date) order_date");
    expect(sql).toContain("min(record.expected_shipping_date) expected_shipping_date");
    expect(sql).toContain("order_date::text \"orderDate\"");
    expect(sql).toContain("expected_shipping_date::text \"expectedShippingDate\"");
    expect(sql).toContain("order_date>=");
    expect(sql).toContain("expected_shipping_date>=");
    expect(sql).toContain("ORDER BY order_date DESC NULLS LAST,order_number,item_code,id");
    expect(sql).not.toContain("order_date_values");
    expect(sql).not.toContain("shipping_date_values");
    expect(sql).not.toContain("多日期");
    expect(sql).not.toContain("unnest(");
  });
  it("rejects non-filterable derived BOM status and invalid page sizes use platform defaults",async()=>{
    await expect(service.page("fourth",{filterGroup:{logic:"AND",rules:[{field:"drawing",operator:"contains",value:"Y"}]}},actor)).rejects.toThrow("不支持筛选");
    const result=await service.page("fourth",{pageSize:37},actor);
    expect(result.pageSize).toBe(100);
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
