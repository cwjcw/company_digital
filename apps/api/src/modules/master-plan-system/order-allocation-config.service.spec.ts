import { allocationMappingIssues } from "./order-allocation-config.service";
import { allocationVendorTargetError, allocationVendorRequiredDivisionName, normalizeAllocationSupplierName } from "./order-allocation.domain";

const procurement={id:"procurement",name:"采购部",enabled:true};
const supply={id:"supply",supplier_name:"供应链",division_id:procurement.id,enabled:true};
const supplyIssues=(units:typeof procurement[],vendors:typeof supply[])=>allocationMappingIssues(units,vendors).filter(i=>i.supplierName==="供应链");
describe("allocation mapping diagnostics",()=>{
  it("accepts the known procurement ID even when another department has the same name",()=>{
    expect(supplyIssues([procurement,{...procurement,id:"other"}],[supply])).toEqual([]);
  });
  it("reports missing mappings and ambiguous organization names without choosing a row",()=>{
    expect(supplyIssues([procurement,{...procurement,id:"other"}],[])).toEqual([expect.objectContaining({code:"MISSING_MAPPING",message:expect.stringContaining("重名")})]);
  });
  it("reports absent, disabled and whitespace-variant target organizations explicitly",()=>{
    expect(supplyIssues([],[])[0].message).toContain("不存在");
    expect(supplyIssues([{...procurement,enabled:false}],[])[0].message).toContain("已停用");
    expect(supplyIssues([{...procurement,name:" 采购部 "}],[])[0].message).toContain("前后空格");
  });
  it("distinguishes disabled mapping from unavailable organization",()=>{
    expect(supplyIssues([procurement],[{...supply,enabled:false}])).toEqual([expect.objectContaining({code:"DISABLED_MAPPING",mappingId:supply.id})]);
    expect(supplyIssues([{...procurement,enabled:false}],[supply])).toEqual([expect.objectContaining({code:"INVALID_ORGANIZATION"})]);
    expect(supplyIssues([],[supply])).toEqual([expect.objectContaining({code:"INVALID_ORGANIZATION"})]);
  });
  it("flags wrong supply-chain target while allowing other legitimate custom defaults",()=>{
    const unit={...procurement,name:"事业一部"};
    expect(supplyIssues([unit],[supply])[0]).toMatchObject({code:"INVALID_ORGANIZATION",message:expect.stringContaining("必须映射采购部")});
    expect(allocationVendorTargetError("自定义供应商",unit)).toBeNull();
    expect(allocationVendorTargetError("事业二部",unit)).toBeNull();
    expect(allocationVendorTargetError("供应链",{name:" 采购部 "})).toBeNull();
  });
  it("normalizes exact supplier names and fullwidth parentheses without substring matches",()=>{
    expect(normalizeAllocationSupplierName("  贻居（厦门）智能科技有限公司  ")).toBe("贻居(厦门)智能科技有限公司");
    expect(allocationVendorRequiredDivisionName("贻居（厦门）智能科技有限公司")).toBe("贻居");
    expect(allocationVendorRequiredDivisionName("贻居（厦门）智能科技有限公司分公司")).toBeNull();
    expect(allocationVendorRequiredDivisionName("供应链物流商")).toBeNull();
  });
  it("requires the formal organization ID for both vendor rules",()=>{
    const organizations=[procurement,{id:"yiju",name:"贻居",enabled:true}];
    expect(allocationVendorTargetError("供应链",procurement,organizations)).toBeNull();
    expect(allocationVendorTargetError("贻居(厦门)智能科技有限公司",organizations[1]!,organizations)).toBeNull();
    expect(allocationVendorTargetError("供应链",{id:"other",name:"采购部"},organizations)).toContain("必须映射");
    expect(allocationVendorTargetError("贻居(厦门)智能科技有限公司",{id:"yiju",name:"贻居"},[...organizations,{id:"yiju2",name:"贻居",enabled:true}])).toBeNull();
  });
});
