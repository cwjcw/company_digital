import { monthlyBasePatch, monthlyBaseValues } from "./master-plan.monthly-base";
import { MasterPlanSyncService } from "./master-plan.sync.service";

const monthly = { division_id:"division",customer_code:"C1",item_name:"品项",order_date:"2026-10-01",
  required_quantity:"12.5000",pending_quantity:"2.0000",latest_customer_due_date:"2026-11-03",
  customer_due_date:"2026-11-04",preproduction_review_date:"2026-10-02",image_refs:[],
  product_attribute:"五金",surface_nature:"烤漆",manufacturing_method:"自制",model_age:"新" };

describe("monthly to base mapping and manual value protection",()=>{
  it("maps full monthly demand and the matching customer due date without inventing review/completion dates",()=>{
    const values=monthlyBaseValues(monthly);
    expect(values).toMatchObject({planned_quantity:"12.5000",latest_customer_due_date:"2026-11-03"});
    expect(values).not.toHaveProperty("latest_review_due_date");
    expect(values).not.toHaveProperty("shipping_plan_id");
    expect(values).not.toHaveProperty("source_type");
  });
  it("keeps a missing customer due date empty and blocks invalid dictionary propagation",()=>{
    const values=monthlyBaseValues({...monthly,latest_customer_due_date:null,product_attribute:"无效选项"});
    expect(values.latest_customer_due_date).toBeNull();expect(values).not.toHaveProperty("product_attribute");
  });
  it("preserves nonempty legacy quantity, dates and manual attributes on first adoption",()=>{
    const target={...monthlyBaseValues(monthly),planned_quantity:"3.0000",latest_customer_due_date:"2026-12-01",product_attribute:"木作",latest_review_due_date:"2026-10-20"};
    expect(monthlyBasePatch(target,monthlyBaseValues(monthly))).toEqual({});
  });
  it("refreshes unchanged automatic values when the monthly source changes",()=>{
    const before=monthlyBaseValues(monthly),after=monthlyBaseValues({...monthly,required_quantity:"15",latest_customer_due_date:"2026-11-05"});
    expect(monthlyBasePatch(before,after,before)).toEqual({planned_quantity:"15.0000",latest_customer_due_date:"2026-11-05"});
  });
  it("preserves manual quantity/date overrides and intentional clears during later source changes",()=>{
    const previous=monthlyBaseValues(monthly),manual={...previous,planned_quantity:"7",latest_customer_due_date:null,product_attribute:null};
    const next=monthlyBaseValues({...monthly,required_quantity:"20",latest_customer_due_date:"2026-11-06",product_attribute:"木作"});
    expect(monthlyBasePatch(manual,next,previous)).toEqual({});
  });
  it("compares PostgreSQL numeric/date/JSON values semantically",()=>{
    const before={...monthlyBaseValues(monthly),image_refs:[{id:"a",name:"图纸"}]};
    const database={...before,planned_quantity:"12.5",order_date:new Date("2026-10-01T00:00:00Z"),image_refs:[{name:"图纸",id:"a"}]};
    expect(monthlyBasePatch(database,before,before)).toEqual({});
  });
  it("reuses the existing task entrypoint with a monthly input transaction",async()=>{
    const manager={query:jest.fn().mockResolvedValue([])},transaction=jest.fn(async work=>work(manager));
    const service=new MasterPlanSyncService({transaction} as never);
    await expect((service as any).shippingToBase("SYN",null,"系统任务")).resolves.toMatchObject({count:0,metrics:{base_created:0}});
    expect(transaction).toHaveBeenCalledTimes(1);
    const queries=manager.query.mock.calls.map(([sql])=>String(sql));
    expect(queries.some(sql=>sql.includes("FROM mps_monthly_plans"))).toBe(true);
    expect(queries.some(sql=>sql.includes("FROM mps_shipping_plans"))).toBe(false);
  });
  it("retains the original backend permission gate for manual synchronization",async()=>{
    const query=jest.fn(),service=new MasterPlanSyncService({query} as never);
    await expect(service.manual("shipping-to-base",{tenantId:"SYN",userId:null,username:"viewer",permissions:["mps-base-plans:*:read"],tableDataScopes:[],requestId:"denied",source:"web"})).rejects.toThrow("手工同步权限");
    expect(query).not.toHaveBeenCalled();
  });
});
