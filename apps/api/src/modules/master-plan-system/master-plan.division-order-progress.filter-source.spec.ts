import { mpsDivisionOrderProgressResource, tableFilterResourceCapabilities } from "@kdos/contracts";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";
import { MasterPlanDivisionOrderProgressFilterSource } from "./master-plan.division-order-progress.filter-source";

describe("事业四部订单生产进度统一筛选资源",()=>{
  it("registers the report and delegates list/export rows with the same context, search, sort, paging and FilterGroup",async()=>{
    const registry=new TableFilterRegistry();
    const report={assert:jest.fn(),canReadFilterField:jest.fn(()=>true),filterCandidateScope:jest.fn(()=>"1=1"),page:jest.fn(async()=>({rows:[{id:"row-1"}],total:1,page:2,pageSize:50,diagnostics:{}}))};
    new MasterPlanDivisionOrderProgressFilterSource(registry,report as never).onModuleInit();
    const source=registry.get(mpsDivisionOrderProgressResource);
    expect(source.table).toBe("mps_order_allocations");
    expect(tableFilterResourceCapabilities[mpsDivisionOrderProgressResource].status).toBe("REGISTERED_AND_FILTERABLE");
    const actor={tenantId:"TENANT",userId:"member-1",permissions:[`${mpsDivisionOrderProgressResource}:*:read`],tableDataScopes:[]};
    const query={actor,page:2,pageSize:50,search:"ITEM-1",filterGroup:{logic:"AND",rules:[{field:"orderQuantity",operator:"gte",value:"10"}]},sortField:"orderQuantity",sortOrder:"desc" as const,context:{incomplete:"true"},fieldKeys:["orderQuantity"],action:"read"};
    await expect(source.listRows?.(query)).resolves.toMatchObject({rows:[{id:"row-1"}],total:1});
    expect(report.page).toHaveBeenCalledWith("fourth",expect.objectContaining({page:2,pageSize:50,search:"ITEM-1",filterGroup:query.filterGroup,sortField:"orderQuantity",sortOrder:"desc",incomplete:"true"}),expect.objectContaining({tenantId:"TENANT",userId:"member-1"}),"read");
    await expect(source.printRows?.({...query,action:"export",ids:["00000000-0000-4000-8000-000000000001"]})).resolves.toMatchObject({rows:[{id:"row-1"}],total:1});
    expect(report.page).toHaveBeenLastCalledWith("fourth",expect.objectContaining({filterGroup:query.filterGroup,ids:["00000000-0000-4000-8000-000000000001"],incomplete:"true"}),expect.objectContaining({tenantId:"TENANT"}),"export");
  });
});
